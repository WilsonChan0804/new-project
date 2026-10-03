/* Walking through the model at eye level.
 *
 * Orbiting is the right way to look AT a building; walking is the right
 * way to check it from the inside - head height under a beam, what can be
 * seen from a door, whether a corridor reads. So this is a first-person
 * camera: stand on a floor, look around by dragging, move with the keys.
 *
 * Gravity keeps the eye a fixed height above whatever floor is underneath,
 * so stairs and ramps are followed. It is deliberately forgiving: a rise
 * bigger than a stair riser in one step (a desk, a bed, a worktop) is
 * ignored rather than climbed, and where no floor is found at all - a
 * shaft, a gap between models - the walker stays at the height it had
 * instead of falling out of the building.
 *
 * Walls do not stop the walker unless "Walls block" is ticked. Doors in an
 * IFC are closed leaves, so collision on by default would make every room
 * a prison; it is there for checking clearances.
 *
 * Geometry lives in the fragments worker, so every ray here is an async
 * question (ctx.rayHit). Gravity and collision therefore run a few times a
 * second on their own timers and the movement uses the last answer. That
 * lag is a few centimetres at walking speed.
 */

export const WALK_DEFAULTS = {
  eye: 1.6,          // m above the floor
  speed: 1.5,        // m/s, a brisk walk
  gravity: true,
  collide: false,
};

const KEYS = {
  forward: ["w", "arrowup"], back: ["s", "arrowdown"],
  left: ["a"], right: ["d"],
  turnL: ["arrowleft"], turnR: ["arrowright"],
  up: ["e"], down: ["q"],
};
const MAX_STEP_UP = 0.45;     // m in one gravity check: a stair, not a desk
const LOOK = 0.0035;          // rad per pixel dragged
const TURN = 1.6;             // rad/s for the arrow keys
const CLEAR = 0.3;            // m kept from a wall when walls block

export function createWalk(ctx) {
  const { THREE, S } = ctx;
  const W = {
    on: false, picking: false,
    eye: WALK_DEFAULTS.eye, speed: WALK_DEFAULTS.speed,
    gravity: WALK_DEFAULTS.gravity, collide: WALK_DEFAULTS.collide,
    yaw: 0, pitch: 0,
    keys: new Set(), pad: new Set(),
    floorY: null,          // last floor found under the walker
    wantY: null,           // eye height gravity is moving towards
    lastGravity: 0, gravBusy: false, moved: true,
    blockPoint: null, blockDir: null, collBusy: false, lastColl: 0,
    land: false,           // next floor found is accepted whatever its height
    anchor: null,          // where the last floor was accepted
    landNear: null,        // level height just jumped to with Page Up / Down
    hold: false, movedSinceHold: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem("lwk.walk") || "{}");
    for (const k of ["eye", "speed", "gravity", "collide"]) {
      if (saved[k] !== undefined) W[k] = saved[k];
    }
  } catch (e) { /* first time, or storage blocked */ }
  const save = () => {
    try {
      localStorage.setItem("lwk.walk", JSON.stringify(
        { eye: W.eye, speed: W.speed, gravity: W.gravity, collide: W.collide }));
    } catch (e) {}
  };

  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);

  /* ------------------------------------------------------------ entering */

  /* Step 1: ask where to stand. The next click in the model answers. */
  function begin() {
    if (W.on) { stop(); return; }
    W.picking = true;
    ctx.onState();
    ctx.status("Walk: put the person down where you want to stand - click a floor "
      + "(clicking a wall puts you on the floor in front of it). Esc cancels.");
  }

  /* Step 2: stand at a clicked point. `found` is a pick result. */
  async function startAt(point, normal) {
    W.picking = false;
    if (!point) { ctx.status("Walk: nothing there - click a floor."); ctx.onState(); return; }
    const p = point.clone();
    // The direction being looked in now, flattened; from straight above
    // (a plan) the top of the screen is "forward".
    const cam = S.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    if (Math.abs(fwd.y) > 0.95) {
      fwd.set(0, 1, 0).applyQuaternion(cam.quaternion);
    }
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();

    /* A click on a wall or on furniture is a click on where to stand NEAR:
       step back half a metre towards the viewer and find the floor below. */
    let floor = null;
    const flat = normal && Math.abs(normal.y) > 0.7 && normal.y > 0;
    if (flat) {
      floor = p.y;
    } else {
      const back = p.clone().addScaledVector(fwd, -0.5);
      back.y += 0.2;
      const hit = await ctx.rayHit(back, DOWN, 30);
      if (hit) { floor = hit.point.y; p.x = back.x; p.z = back.z; }
      else floor = p.y;
    }

    ctx.prepare();                          // perspective, no plan cut
    W.on = true;
    W.floorY = floor;
    W.wantY = null;
    W.yaw = Math.atan2(-fwd.x, -fwd.z);
    W.pitch = 0;
    W.blockPoint = null;
    W.landNear = null; W.hold = false; W.land = false;
    W.anchor = new THREE.Vector3(p.x, floor, p.z);
    const c = S.camera;
    c.position.set(p.x, floor + W.eye, p.z);
    c.rotation.order = "YXZ";
    applyLook();
    S.controls.enabled = false;
    W.moved = true;
    ctx.onState();
    ctx.status("Walking. W A S D or the arrow keys to move, drag to look around, "
      + "Shift to go faster, Page Up / Page Down for the floor above or below, "
      + "Esc to stop.");
  }

  function stop() {
    const was = W.on || W.picking;
    W.on = false; W.picking = false;
    W.keys.clear(); W.pad.clear();
    // Leave the camera where it is and put the orbit centre a few metres in
    // front, so orbiting carries on naturally from the spot walked to.
    const c = S.camera;
    const f = new THREE.Vector3(); c.getWorldDirection(f);
    S.controls.target.copy(c.position).addScaledVector(f, 5);
    S.controls.enabled = true;
    S.controls.update();
    S.dirty = true;
    ctx.onState();
    if (was) ctx.status("Walk finished. Orbiting from where you stopped.");
  }

  function applyLook() {
    const c = S.camera;
    c.rotation.order = "YXZ";
    c.rotation.set(W.pitch, W.yaw, 0);
    c.updateMatrixWorld(true);
    // Keeps the readouts (floor, distance) and anything reading the target
    // meaningful while the orbit controls are switched off.
    const f = new THREE.Vector3(); c.getWorldDirection(f);
    S.controls.target.copy(c.position).addScaledVector(f, 2);
  }

  /* ------------------------------------------------------------- looking */

  let drag = null;
  function onPointerDown(ev) {
    if (!W.on) return;
    drag = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
  }
  function onPointerMove(ev) {
    if (!W.on || !drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.x = ev.clientX; drag.y = ev.clientY;
    W.yaw -= dx * LOOK;
    W.pitch = Math.max(-1.45, Math.min(1.45, W.pitch - dy * LOOK));
    applyLook();
    S.dirty = true;
  }
  function onPointerUp() { drag = null; }
  function onWheel(ev) {
    if (!W.on) return;
    ev.preventDefault();
    // A wheel notch is a step: people reach for it to move, not to zoom.
    const step = (ev.deltaY < 0 ? 1 : -1) * Math.max(0.4, W.speed * 0.4);
    move(new THREE.Vector3(0, 0, -step), 1);
  }

  /* ----------------------------------------------------------- keyboard */

  const keyName = (ev) => (ev.key || "").toLowerCase();
  const isField = (ev) =>
    /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || "")
    || (ev.target && ev.target.isContentEditable);

  function onKeyDown(ev) {
    if (!W.on && !W.picking) return;
    if (isField(ev)) return;
    const k = keyName(ev);
    if (k === "escape") { ev.preventDefault(); stop(); return; }
    if (!W.on) return;
    if (k === "pageup" || k === "pagedown") {
      ev.preventDefault(); ev.stopImmediatePropagation();
      floorStep(k === "pageup" ? 1 : -1);
      return;
    }
    for (const list of Object.values(KEYS)) {
      if (list.includes(k)) {
        ev.preventDefault();
        W.keys.add(k);
        return;
      }
    }
  }
  function onKeyUp(ev) { W.keys.delete(keyName(ev)); }
  function onBlur() { W.keys.clear(); W.pad.clear(); }

  const held = (name) => KEYS[name].some((k) => W.keys.has(k)) || W.pad.has(name);

  /* -------------------------------------------------------------- moving */

  /* The walker's own frame: -z forward along the flattened view, +x right. */
  function move(local, dt) {
    const c = S.camera;
    const fwd = new THREE.Vector3(-Math.sin(W.yaw), 0, -Math.cos(W.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const d = new THREE.Vector3()
      .addScaledVector(right, local.x * dt)
      .addScaledVector(fwd, -local.z * dt);
    if (W.collide && d.lengthSq() > 0) {
      const dn = d.clone().normalize();
      /* The last wall found in roughly this direction, measured from where
         the walker is NOW (the answer may be a few frames old). */
      if (W.blockPoint && W.blockDir && W.blockDir.dot(dn) > 0.7) {
        const ahead = W.blockPoint.clone().sub(c.position).setY(0).dot(dn);
        const room = Math.max(0, ahead - CLEAR);
        if (d.length() > room) d.setLength(room);
      }
      checkCollision(dn);
    }
    c.position.add(d);
    if (local.y) {
      if (!W.gravity) c.position.y += local.y * dt;
      else {
        // Flying up or down with gravity on would be undone at once; the
        // floors are one key away instead.
        hintOnce("gravity",
          "Gravity is on: Page Up / Page Down go a floor up or down "
          + "(or untick Gravity to fly with Q and E).");
      }
    }
    if (d.lengthSq() > 0 || local.y) { W.moved = true; W.movedSinceHold = true; S.dirty = true; }
    applyLook();
  }

  function step(dt) {
    if (!W.on) return;
    dt = Math.min(dt, 0.25);                      // a stalled frame is not a leap
    const v = W.speed * (W.shift ? 3 : 1);
    const local = new THREE.Vector3(
      (held("right") ? 1 : 0) - (held("left") ? 1 : 0),
      (held("up") ? 1 : 0) - (held("down") ? 1 : 0),
      (held("back") ? 1 : 0) - (held("forward") ? 1 : 0));
    const turn = (held("turnL") ? 1 : 0) - (held("turnR") ? 1 : 0);
    if (turn) { W.yaw += turn * TURN * dt; S.dirty = true; }
    if (local.lengthSq() > 0) {
      const h = Math.hypot(local.x, local.z);
      if (h > 1) { local.x /= h; local.z /= h; }
      local.multiplyScalar(v);
      move(local, dt);
    } else if (turn) {
      applyLook();
    }

    // Ease towards the height gravity asked for.
    if (W.gravity && W.wantY !== null) {
      const c = S.camera;
      const diff = W.wantY - c.position.y;
      if (Math.abs(diff) < 0.005) { c.position.y = W.wantY; W.wantY = null; }
      else {
        const rate = diff > 0 ? 2.5 : 6;          // m/s: climb gently, drop briskly
        c.position.y += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      }
      applyLook();
      S.dirty = true;
    }

    const now = performance.now();
    if (W.gravity && (W.moved || now - W.lastGravity > 1000) && now - W.lastGravity > 120) {
      W.moved = false;
      W.lastGravity = now;
      checkGravity();
    }
  }

  async function checkGravity() {
    if (W.gravBusy) return;
    W.gravBusy = true;
    try {
      const c = S.camera;
      const from = c.position.clone();
      from.y -= 0.05;                               // start just under the eye
      const hit = await ctx.rayHit(from, DOWN, 40);
      if (!W.on || !hit) return;                    // nothing below: stay put
      const floor = hit.point.y;
      // Compared with the floor last stood on, not the eye as it eases up a
      // flight: otherwise a quick walk up stairs outruns its own check.
      if (W.landNear !== null) {
        /* Just arrived by Page Up / Down. The level line is where the floor
           should be; a floor far below it means a void here (a stair well,
           a double-height space), and dropping through it would undo the
           key press. Stay at the level and say so. */
        const near = W.landNear;
        W.landNear = null;
        if (Math.abs(floor - near) > 0.6) {
          W.land = false;
          W.floorY = near;
          W.anchor = new THREE.Vector3(from.x, near, from.z);
          ctx.status("No floor under you here on this level - standing at its "
            + "height. Walk onto a floor, or untick Gravity to look around.");
          W.hold = true;
          return;
        }
      }
      if (W.hold) {
        // Standing in a void after a floor change: stay until the walker
        // moves, then carry on as normal (and fall if there is no floor).
        if (!W.movedSinceHold) return;
        W.hold = false;
      }
      const ref = W.floorY !== null ? W.floorY : c.position.y - W.eye;
      if (!W.land && floor > ref + MAX_STEP_UP) {
        /* Too big a rise since the last floor stood on. A desk - or a
           flight of stairs taken quickly, several risers between two
           checks. Look at the floor along the way: a stair rises a little
           at a time, a desk jumps at its edge. */
        if (!(await climbable(ref, from, floor))) return;
      }
      W.land = false;
      W.anchor = new THREE.Vector3(from.x, floor, from.z);
      W.floorY = floor;
      const want = floor + W.eye;
      if (Math.abs(want - c.position.y) > 0.005) W.wantY = want;
    } catch (e) {
      /* a failed ray is a missed step, not a reason to stop walking */
    } finally {
      W.gravBusy = false;
    }
  }

  async function climbable(ref, to, floor) {
    const a = W.anchor;
    if (!a) return false;
    const dx = to.x - a.x, dz = to.z - a.z;
    const dist = Math.hypot(dx, dz);
    const n = Math.min(10, Math.ceil(dist / 0.2));
    if (n < 2) return false;
    const probes = [];
    for (let i = 1; i < n; i++) {
      const o = new THREE.Vector3(a.x + dx * i / n, to.y, a.z + dz * i / n);
      probes.push(ctx.rayHit(o, DOWN, 40).catch(() => null));
    }
    const ys = (await Promise.all(probes)).map((h) => (h ? h.point.y : null));
    let prev = ref;
    for (const y of [...ys, floor]) {
      if (y === null) return false;
      if (y > prev + MAX_STEP_UP) return false;
      prev = y;
    }
    return true;
  }

  async function checkCollision(dir) {
    const now = performance.now();
    const same = W.blockDir && W.blockDir.dot(dir) > 0.94;
    if (W.collBusy || (same && now - W.lastColl < 120)) return;
    W.collBusy = true;
    W.lastColl = now;
    try {
      const from = S.camera.position.clone();
      from.y -= W.eye * 0.5;                        // waist height
      const hit = await ctx.rayHit(from, dir, 5);
      W.blockDir = dir.clone();
      W.blockPoint = hit ? hit.point.clone() : null;
    } catch (e) {
      W.blockPoint = null;
    } finally {
      W.collBusy = false;
    }
  }

  /* Page Up / Page Down: stand on the next floor up or down, at the same
     spot in plan. The level list gives the height; gravity then finds the
     actual slab top, which is where finishes and set-downs show. */
  function floorStep(delta) {
    const rows = ctx.floors() || [];
    if (!rows.length) { ctx.status("No floor list for this model yet."); return; }
    const c = S.camera;
    const feet = (W.floorY !== null ? W.floorY : c.position.y - W.eye);
    let idx = -1;
    rows.forEach((r, i) => { if (r.y <= feet + 0.3) idx = i; });
    const to = Math.max(0, Math.min(rows.length - 1, idx + delta));
    if (to === idx) { ctx.status(delta > 0 ? "Already on the top floor." : "Already on the lowest floor."); return; }
    const r = rows[to];
    W.floorY = r.y;
    W.wantY = null;
    W.anchor = new THREE.Vector3(c.position.x, r.y, c.position.z);
    W.land = true;              // the level line is near, the slab top decides
    W.landNear = r.y;
    W.hold = false; W.movedSinceHold = false;
    c.position.y = r.y + W.eye;
    applyLook();
    W.moved = true;
    S.dirty = true;
    ctx.status("Walking on " + r.name + ".");
  }

  const hinted = new Set();
  function hintOnce(key, text) {
    if (hinted.has(key)) return;
    hinted.add(key);
    ctx.status(text);
  }

  /* ---------------------------------------------------------- settings */

  function set(opts) {
    for (const k of ["eye", "speed", "gravity", "collide"]) {
      if (opts[k] === undefined) continue;
      if (k === "eye" && W.on) {
        // Keep standing on the same floor at the new height.
        const floor = W.floorY !== null ? W.floorY : S.camera.position.y - W.eye;
        W.eye = opts.eye;
        S.camera.position.y = floor + W.eye;
        applyLook();
        S.dirty = true;
      } else {
        // Gravity switched back on after flying: land on whatever is below.
        if (k === "gravity" && opts.gravity && !W.gravity) { W.land = true; W.moved = true; }
        W[k] = opts[k];
      }
    }
    if (!W.collide) W.blockPoint = null;
    save();
  }

  function attach(dom) {
    dom.addEventListener("pointerdown", onPointerDown);
    addEventListener("pointermove", onPointerMove);
    addEventListener("pointerup", onPointerUp);
    addEventListener("pointercancel", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    // Capture phase, so Page Up / Page Down reach the walker before the
    // floor-plan shortcut does.
    addEventListener("keydown", onKeyDown, true);
    addEventListener("keyup", onKeyUp, true);
    addEventListener("blur", onBlur);
    addEventListener("keydown", (ev) => { if (ev.key === "Shift") W.shift = true; }, true);
    addEventListener("keyup", (ev) => { if (ev.key === "Shift") W.shift = false; }, true);
  }

  return {
    get on() { return W.on; },
    get picking() { return W.picking; },
    get settings() { return { eye: W.eye, speed: W.speed, gravity: W.gravity, collide: W.collide }; },
    get state() { return W; },
    begin, startAt, stop, step, set, attach, floorStep,
    press(name, on) { if (on) W.pad.add(name); else W.pad.delete(name); },
  };
}
