/* The outline of a section cut: wide brown lines where the cutting planes
 * pass through closed solids (walls, slabs, columns ...), drawn over the
 * orange hatched fill so the cut reads at a glance, as in a drawing.
 *
 * WebGL draws lines one pixel wide whatever is asked for, so each segment
 * is a small quad, widened on screen in the vertex shader. The depth is
 * written the same logarithmic way the model's is, a hair nearer the eye,
 * so a line sits on top of the cut face it traces but still hides behind
 * whatever stands in front of it.
 */

const VS = `
  attribute vec3 iA;
  attribute vec3 iB;
  uniform vec2 viewport;
  uniform float width;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  #include <clipping_planes_pars_vertex>
  void main() {
    vec4 a = modelViewMatrix * vec4(iA, 1.0);
    vec4 b = modelViewMatrix * vec4(iB, 1.0);
    vec4 mvPosition = position.x < 0.5 ? a : b;
    vec4 ca = projectionMatrix * a, cb = projectionMatrix * b;
    vec2 sa = ca.xy / ca.w * viewport * 0.5, sb = cb.xy / cb.w * viewport * 0.5;
    vec2 d = normalize(sb - sa + vec2(1e-6));
    vec2 nrm = vec2(-d.y, d.x);
    vec4 c = position.x < 0.5 ? ca : cb;
    // widen across the line, and a little along it so the ends meet
    vec2 off = (nrm * position.y + d * (position.x < 0.5 ? -0.5 : 0.5)) * width;
    c.xy += off / (viewport * 0.5) * c.w;
    gl_Position = c;
    #include <logdepthbuf_vertex>
    #ifdef USE_LOGDEPTHBUF
      vFragDepth *= 0.997;
    #endif
    #include <clipping_planes_vertex>
  }`;
const FS = `
  uniform vec3 color;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }`;

export function createCutLines(THREE, scene) {
  const group = new THREE.Group();
  group.name = "__cutlines";
  group.renderOrder = 995;
  scene.add(group);
  const quad = new THREE.InstancedBufferGeometry();
  // x: 0 = start, 1 = end; y: -1 / +1 side
  quad.setAttribute("position", new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);

  function material(clipPlanes, widthPx, colorHex) {
    return new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, clipping: true,
      uniforms: { viewport: { value: new THREE.Vector2(1, 1) }, width: { value: widthPx },
                  color: { value: new THREE.Color(colorHex) } },
      clippingPlanes: clipPlanes, depthTest: true, depthWrite: false, transparent: false,
    });
  }

  const api = {
    /* sets: [{ segs: Float32Array (6 per segment), clip: [planes] }] */
    set(sets, opt = {}) {
      api.clear();
      for (const s of sets) {
        if (!s.segs || !s.segs.length) continue;
        const n = s.segs.length / 6;
        const g = new THREE.InstancedBufferGeometry();
        g.setAttribute("position", quad.attributes.position);
        g.setIndex(quad.index);
        const A = new Float32Array(n * 3), B = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          A[i * 3] = s.segs[i * 6]; A[i * 3 + 1] = s.segs[i * 6 + 1]; A[i * 3 + 2] = s.segs[i * 6 + 2];
          B[i * 3] = s.segs[i * 6 + 3]; B[i * 3 + 1] = s.segs[i * 6 + 4]; B[i * 3 + 2] = s.segs[i * 6 + 5];
        }
        g.setAttribute("iA", new THREE.InstancedBufferAttribute(A, 3));
        g.setAttribute("iB", new THREE.InstancedBufferAttribute(B, 3));
        g.instanceCount = n;
        const m = new THREE.Mesh(g, material(s.clip || [], opt.width || 3, opt.color || 0x7a3b10));
        m.frustumCulled = false;
        m.renderOrder = 995;
        group.add(m);
      }
    },
    /* every frame: the size of the view, for the width in pixels */
    update(w, h) {
      for (const m of group.children) m.material.uniforms.viewport.value.set(w, h);
    },
    clear() {
      for (const m of group.children.slice()) { group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    },
    get count() { return group.children.length; },
  };
  return api;
}
