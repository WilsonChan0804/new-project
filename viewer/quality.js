/* Picture quality that follows the frame rate.
 *
 * While the view moves, the time between frames is measured. When the
 * device cannot keep up (an iPhone orbiting a whole tower, an old laptop),
 * the moving picture is made cheaper one step at a time: fewer pixels,
 * then small and far things left out sooner and coarser copies used
 * earlier. When it keeps up easily again for a while, a step comes back.
 *
 * Only the MOVING picture changes. As soon as the view stops, the still
 * frame is drawn at full quality, so what is read and measured is always
 * sharp - and a still frame costs nothing after it is drawn.
 *
 *   level 0   as before (full resolution; a very big model already drops
 *             to 1x while moving)
 *   level 1   1x pixels while moving, details culled a little sooner
 *   level 2   0.8x pixels, small things and far copies sooner
 *   level 3   0.65x pixels, coarser still
 *   level 4   0.5x pixels, only what matters most while moving
 */

export const LEVELS = [
  { ratio: null, q: 1 },
  { ratio: 1, q: 1.3 },
  { ratio: 0.8, q: 1.7 },
  { ratio: 0.65, q: 2.2 },
  { ratio: 0.5, q: 3 },
];

export function createQuality(opt = {}) {
  const target = opt.targetFps || 30;      // frames a second worth holding while moving
  const st = {
    on: opt.on !== false,
    level: Math.max(0, Math.min(LEVELS.length - 1, opt.start || 0)),
    fps: 0,                 // the last window's frame rate while moving
    samples: 0,
    changedAt: 0,
    history: [],            // [time, level, fps] of each change, for the report
  };
  let winStart = 0, winFrames = 0, winTime = 0, goodWins = 0, lastT = 0;
  let winDts = [];
  const failedAt = [];      // when each level last proved too slow

  const api = {
    get level() { return st.on ? st.level : 0; },
    get on() { return st.on; },
    get fps() { return st.fps; },
    get target() { return target; },
    get samples() { return st.samples; },
    get history() { return st.history.slice(-12); },
    /* back to full, measured afresh (after the models have finished
       loading: frames while building them say nothing about drawing) */
    reset() { st.level = 0; winFrames = 0; winTime = 0; winDts = []; lastT = 0; goodWins = 0; failedAt.length = 0; },
    setOn(v) {
      st.on = !!v;
      if (!st.on) { st.level = 0; winFrames = 0; }
    },
    /* what the moving picture uses now */
    settings(moving) {
      const L = LEVELS[api.level];
      return moving ? L : LEVELS[0];
    },
    /* every animation frame: whether it was drawn, and whether the view
       was moving. Returns true when the level changed. */
    frame(now, drawn, moving) {
      if (!st.on) return false;
      if (!moving || !drawn) {
        // a pause: the next moving frame starts a fresh window
        lastT = 0;
        return false;
      }
      if (!lastT) { lastT = now; if (!winStart) winStart = now; return false; }
      const dt = now - lastT;
      lastT = now;
      // a stall of more than 1.5 s (a model arriving, the tab in the
      // background) says nothing about drawing: start again
      if (dt > 1500) { winStart = now; winFrames = 0; winTime = 0; winDts = []; return false; }
      winFrames++; winTime += dt; winDts.push(dt);
      if (winTime < 1000 || winFrames < 3) return false;
      /* the typical frame, not the average: one long hitch (a shader
         being made, a model arriving) is not the rate the view moves at */
      winDts.sort((a, b) => a - b);
      const fps = 1000 / Math.max(1, winDts[winDts.length >> 1]);
      winDts = [];
      st.fps = fps; st.samples++;
      winFrames = 0; winTime = 0; winStart = now;
      // a new level needs a moment before it is judged
      if (now - st.changedAt < 1200) return false;
      if (fps < target * 0.85 && st.level < LEVELS.length - 1) {
        // well short: two steps at once
        failedAt[st.level] = now;
        st.level = Math.min(LEVELS.length - 1, st.level + (fps < target * 0.5 ? 2 : 1));
        goodWins = 0;
        st.changedAt = now;
        st.history.push([Math.round(now / 1000), st.level, Math.round(fps)]);
        return true;
      }
      if (fps > Math.min(54, target * 1.35) && st.level > 0) {
        // keeping up easily: three good seconds in a row, then one step back up
        // (not back to a level that was too slow in the last half minute)
        if (++goodWins >= 3 && now - (failedAt[st.level - 1] || -1e9) > 30000) {
          st.level--; goodWins = 0; st.changedAt = now;
          st.history.push([Math.round(now / 1000), st.level, Math.round(fps)]);
          return true;
        }
      } else goodWins = 0;
      return false;
    },
  };
  return api;
}
