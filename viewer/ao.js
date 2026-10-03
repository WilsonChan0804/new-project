/* "Depth" display: soft shadow in corners and a fine line on edges.
 *
 * Plain shading lights every face of a building by its angle alone, so a
 * wall meeting a floor, a reveal or a set-back reads flat. Here the model is
 * drawn as usual into an off-screen picture with its depth, and two cheap
 * screen passes are laid over it:
 *
 *   ambient occlusion  - each pixel looks at the depth around it; where
 *                        nearby surfaces close in (an inside corner, under
 *                        a slab edge, a window reveal) it is darkened a
 *                        little, as soft daylight would;
 *   edges              - where the surface bends or steps (the depth stops
 *                        changing evenly), a thin dark line, so corners
 *                        read sharp at any distance.
 *
 * Only the depth the model itself wrote is used - no second drawing of the
 * model - so section boxes, hidden elements, streaming pieces and the
 * viewer's own materials all come out right. The depth is written back to
 * the screen, so issue pins and grips are still hidden behind the building.
 *
 * WebGL only (the WebGPU trial draws plain). While the view moves on a
 * device that is struggling, the caller skips it: the still view gets it.
 */

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// shared: depth -> distance and view-space position
const DEPTH = `
uniform sampler2D tDepth;
uniform float uFar, uNear, uP00, uP11, uPersp;
float viewDist(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  // logarithmic depth (perspective) - see three's logdepthbuf_fragment
  if (uPersp > 0.5) return pow(uFar + 1.0, d) - 1.0;
  return uNear + d * (uFar - uNear);
}
vec3 viewPos(vec2 uv) {
  float z = viewDist(uv);
  vec2 n = uv * 2.0 - 1.0;
  if (uPersp > 0.5) return vec3(n.x * z / uP00, n.y * z / uP11, -z);
  return vec3(n.x / uP00, n.y / uP11, -z);
}
`;

const AO_FRAG = `
varying vec2 vUv;
uniform vec2 uRes;
uniform float uIntensity;
${DEPTH}
#define NUM 12
void main() {
  float d0 = texture2D(tDepth, vUv).r;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec2 px = 1.0 / uRes;
  vec3 P = viewPos(vUv);
  // the surface's normal from its neighbours (the flatter side of each)
  vec3 r = viewPos(vUv + vec2(px.x, 0.0)), l = viewPos(vUv - vec2(px.x, 0.0));
  vec3 t = viewPos(vUv + vec2(0.0, px.y)), b = viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l;
  vec3 dy = abs(t.z - P.z) < abs(P.z - b.z) ? t - P : P - b;
  vec3 N = normalize(cross(dx, dy));
  // reach in the model: grows gently with distance, so a whole tower still
  // shows its floors and a room shows its skirting
  float dist = -P.z;
  float R = clamp(dist * 0.03, 0.35, 5.0);
  float rPx = uPersp > 0.5 ? R * uP11 * uRes.y * 0.5 / dist : R * uP11 * uRes.y * 0.5;
  rPx = clamp(rPx, 2.0, 90.0);
  float R2 = R * R;
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float sum = 0.0;
  for (int i = 0; i < NUM; i++) {
    float a = (float(i) + 0.5) / float(NUM);
    float ang = a * 6.2831853 * 7.0 + noise * 6.2831853;
    vec2 off = vec2(cos(ang), sin(ang)) * rPx * a * px;
    vec3 S = viewPos(vUv + off);
    vec3 v = S - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    float f = max(R2 - vv, 0.0);
    sum += f * f * f * max((vn - 0.04 * R) / (0.01 * R2 + vv), 0.0);
  }
  float ao = max(0.0, 1.0 - sum * uIntensity / (R2 * R2 * R2) * (5.0 / float(NUM)));
  gl_FragColor = vec4(vec3(ao), 1.0);
}
`;

const COMP_FRAG = `
varying vec2 vUv;
uniform sampler2D tColor, tAO;
uniform vec2 uRes, uAORes;
uniform float uAO, uEdge;
uniform vec3 uShadeCol, uEdgeCol;
${DEPTH}
float invDepth(vec2 uv) {
  float z = viewDist(uv);
  return uPersp > 0.5 ? 1.0 / max(z, 1e-4) : z;
}
void main() {
  vec4 col = texture2D(tColor, vUv);
  float d0 = texture2D(tDepth, vUv).r;
  gl_FragDepth = d0;
  if (d0 >= 0.99999) {
    gl_FragColor = col;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  // soften the shadow's grain: a 4 x 4 average that keeps to this surface
  float z0 = viewDist(vUv);
  vec2 apx = 1.0 / uAORes;
  float acc = 0.0, wsum = 0.0;
  for (int y = -2; y < 2; y++) {
    for (int x = -2; x < 2; x++) {
      vec2 o = (vec2(float(x), float(y)) + 0.5) * apx;
      float zs = viewDist(vUv + o);
      float w = 1.0 / (1e-3 + abs(zs - z0) / max(z0, 1e-3) * 60.0);
      w = min(w, 1.0);
      acc += texture2D(tAO, vUv + o).r * w;
      wsum += w;
    }
  }
  float ao = wsum > 0.0 ? acc / wsum : 1.0;
  // edges: where depth stops changing evenly (1/depth is even on a flat face)
  vec2 px = 1.0 / uRes;
  float c = invDepth(vUv);
  float lap = abs(invDepth(vUv + vec2(px.x, 0.0)) + invDepth(vUv - vec2(px.x, 0.0))
                + invDepth(vUv + vec2(0.0, px.y)) + invDepth(vUv - vec2(0.0, px.y)) - 4.0 * c) / max(abs(c), 1e-6);
  float edge = smoothstep(0.004, 0.03, lap);
  // the shadow tints towards its colour; the edge line towards its own
  float aoF = mix(1.0, ao, uAO);
  vec3 rgb = col.rgb * mix(uShadeCol, vec3(1.0), aoF);
  rgb = mix(rgb, uEdgeCol, edge * uEdge);
  gl_FragColor = vec4(rgb, col.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createAO(THREE, opts = {}) {
  const st = {
    color: null, ao: null, w: 0, h: 0, samples: -1,
    intensity: opts.intensity || 1.1, aoStrength: opts.strength == null ? 0.55 : opts.strength,
    edge: opts.edge == null ? 0.4 : opts.edge,
    shadeColor: new THREE.Color(opts.shadeColor || "#000000"), edgeColor: new THREE.Color(opts.edgeColor || "#2b2f36"),
  };
  const qScene = new THREE.Scene();
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new THREE.PlaneGeometry(2, 2);
  const depthU = () => ({ tDepth: { value: null }, uFar: { value: 1000 }, uNear: { value: 0.1 },
    uP00: { value: 1 }, uP11: { value: 1 }, uPersp: { value: 1 } });
  const aoMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: AO_FRAG,
    uniforms: Object.assign(depthU(), { uRes: { value: new THREE.Vector2() }, uIntensity: { value: st.intensity } }),
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const compMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: COMP_FRAG,
    uniforms: Object.assign(depthU(), {
      tColor: { value: null }, tAO: { value: null },
      uRes: { value: new THREE.Vector2() }, uAORes: { value: new THREE.Vector2() },
      uAO: { value: st.aoStrength }, uEdge: { value: st.edge },
      uShadeCol: { value: new THREE.Color() }, uEdgeCol: { value: new THREE.Color() },
    }),
    // depth is written (gl_FragDepth) so pins drawn after stay behind walls;
    // writing needs the test on, so it always passes
    depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true,
  });
  const quad = new THREE.Mesh(geo, aoMat);
  quad.frustumCulled = false;
  qScene.add(quad);

  function targets(renderer) {
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, v.x | 0), h = Math.max(1, v.y | 0);
    const samples = renderer.getContext().getContextAttributes().antialias ? 4 : 0;
    if (st.color && st.w === w && st.h === h && st.samples === samples) return;
    dispose();
    const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    st.color = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthTexture, depthBuffer: true });
    // the shadow at half size on big screens: it is blurred anyway
    const k = w * h > 1.0e6 ? 0.5 : 1;
    st.ao = new THREE.WebGLRenderTarget(Math.max(1, (w * k) | 0), Math.max(1, (h * k) | 0), { type: THREE.UnsignedByteType, depthBuffer: false });
    st.w = w; st.h = h; st.samples = samples;
  }

  function setDepthUniforms(u, cam) {
    const p = cam.projectionMatrix.elements;
    u.tDepth.value = st.color.depthTexture;
    u.uFar.value = cam.far; u.uNear.value = cam.near;
    u.uP00.value = p[0]; u.uP11.value = p[5];
    u.uPersp.value = cam.isPerspectiveCamera ? 1 : 0;
  }

  /* Glass and other see-through surfaces are drawn after the shading, onto
     the finished picture: shaded, they took the shadow of the reveal behind
     them and every window went dark grey. */
  const drawable = (o) => o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isLine || o.isPoints || o.isSprite;
  function splitSeeThrough(scene) {
    const glass = [];
    scene.traverseVisible((o) => {
      const m = o.material;
      if (!m || !drawable(o)) return;
      // lines, points and labels (the ground grid, outlines) are laid over
      // afterwards too: in the depth they read as steps and got edge lines
      if (o.isLine || o.isPoints || o.isSprite) { glass.push(o); return; }
      if (Array.isArray(m)) return;
      if (m.transparent && (m.opacity < 0.999 || m.depthWrite === false)) glass.push(o);
    });
    return glass;
  }

  /* Once: build both shaders with error checking on, so a graphics card
     that cannot run them turns Depth off (the caller catches) instead of
     drawing an empty picture. */
  let checked = false;
  function check(renderer) {
    checked = true;
    const was = renderer.debug.checkShaderErrors;
    renderer.debug.checkShaderErrors = true;
    try {
      for (const m of [aoMat, compMat]) {
        quad.material = m;
        renderer.compile(qScene, qCam);
        const pr = renderer.properties.get(m);
        const prog = pr && pr.currentProgram;
        if (prog && prog.diagnostics && prog.diagnostics.runnable === false) {
          throw new Error("depth shading shader: " + (prog.diagnostics.fragmentShader && prog.diagnostics.fragmentShader.log || "failed"));
        }
      }
    } finally {
      renderer.debug.checkShaderErrors = was;
    }
  }

  function render(renderer, scene, cam) {
    targets(renderer);
    if (!checked) check(renderer);
    const prevTarget = renderer.getRenderTarget();
    const prevClip = renderer.clippingPlanes;
    const glass = splitSeeThrough(scene);
    for (const o of glass) o.visible = false;
    try {
      renderer.setRenderTarget(st.color);
      renderer.clear();
      renderer.render(scene, cam);
    } finally {
      for (const o of glass) o.visible = true;
    }
    renderer.clippingPlanes = [];
    // the shadow
    setDepthUniforms(aoMat.uniforms, cam);
    aoMat.uniforms.uRes.value.set(st.ao.width, st.ao.height);
    aoMat.uniforms.uIntensity.value = st.intensity;
    quad.material = aoMat;
    renderer.setRenderTarget(st.ao);
    renderer.render(qScene, qCam);
    // colour x shadow x edges, and the depth, onto the screen
    setDepthUniforms(compMat.uniforms, cam);
    compMat.uniforms.tColor.value = st.color.texture;
    compMat.uniforms.tAO.value = st.ao.texture;
    compMat.uniforms.uRes.value.set(st.w, st.h);
    compMat.uniforms.uAORes.value.set(st.ao.width, st.ao.height);
    compMat.uniforms.uAO.value = st.aoStrength;
    compMat.uniforms.uEdge.value = st.edge;
    // colours are picked in sRGB; the shading works in linear
    compMat.uniforms.uShadeCol.value.copy(st.shadeColor).convertSRGBToLinear();
    compMat.uniforms.uEdgeCol.value.copy(st.edgeColor).convertSRGBToLinear();
    quad.material = compMat;
    renderer.setRenderTarget(prevTarget);
    renderer.render(qScene, qCam);
    renderer.clippingPlanes = prevClip;
    // the glass, over the shaded picture, behind whatever stands in front
    if (glass.length) {
      const glassSet = new Set(glass);
      const others = [];
      scene.traverseVisible((o) => { if (drawable(o) && !glassSet.has(o)) others.push(o); });
      for (const o of others) o.visible = false;
      const bg = scene.background, ac = renderer.autoClear;
      scene.background = null;
      renderer.autoClear = false;
      try { renderer.render(scene, cam); }
      finally {
        renderer.autoClear = ac;
        scene.background = bg;
        for (const o of others) o.visible = true;
      }
    }
  }

  function dispose() {
    if (st.color) { st.color.depthTexture && st.color.depthTexture.dispose(); st.color.dispose(); }
    if (st.ao) st.ao.dispose();
    st.color = st.ao = null; st.w = st.h = 0;
  }

  /* strength, edge: 0..1; shadeColor, edgeColor: "#rrggbb" */
  function set(o) {
    if (o.strength != null) st.aoStrength = Math.max(0, Math.min(1, o.strength));
    if (o.edge != null) st.edge = Math.max(0, Math.min(1, o.edge));
    if (o.shadeColor) st.shadeColor.set(o.shadeColor);
    if (o.edgeColor) st.edgeColor.set(o.edgeColor);
  }

  return { render, dispose, set, state: st };
}
