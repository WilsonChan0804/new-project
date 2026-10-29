/* "Show me this issue" from Revit, in the page already open.
 *
 * LWK Issues in Revit used to start the browser with a link, and a browser
 * given a link always opens a new tab. Now Revit leaves a note on the
 * server for the person signed in; this page keeps one request waiting for
 * it (the server answers the moment a note comes, or after 25 s, and the
 * page asks again at once), claims it (the first page to claim it wins, a
 * page on screen before one in the background) and goes to the issue
 * itself. Revit only opens a new tab when no page of that person is waiting.
 * It used to ask every two seconds: a third of a million requests a week.
 */

export function startGoto(Store, show) {
  let seq = null;              // the first answer only sets where we start

  async function once() {
    const r = await Store.api("/api/goto?after=" + (seq === null ? -1 : seq) + (seq === null ? "" : "&wait=25"));
    if (seq === null) { seq = r.seq || 0; return; }
    const g = r.goto;
    seq = Math.max(seq, r.seq || 0);
    if (!g) return;
    // a page in the background lets one on screen claim it first
    if (document.visibilityState !== "visible") await new Promise((res) => setTimeout(res, 1500));
    const c = await Store.api("/api/goto/claim", {
      method: "POST", body: JSON.stringify({ seq: g.seq }),
    });
    if (!c.ok) return;
    try { window.focus(); } catch (e) {}
    await show(g);
  }
  (async function loop() {
    for (;;) {
      if (!Store.currentProject || !Store.api) { await new Promise((res) => setTimeout(res, 2000)); continue; }
      const t0 = Date.now();
      try { await once(); }
      catch (e) {
        /* signed out or offline: try again a little later */
        await new Promise((res) => setTimeout(res, 5000));
        continue;
      }
      // an answer far sooner than the wait (an older server, or a proxy
      // cutting it short): not a tight loop
      if (Date.now() - t0 < 1000) await new Promise((res) => setTimeout(res, 1500));
    }
  })();
}

/* Where an issue lives, as a link: used when the page open is not the one
   the issue belongs on (a 3D issue while the sheets are open, or another
   project). */
export function issueLink(g) {
  const q = "project=" + encodeURIComponent(g.project || "");
  if (g.kind === "3d") return "model.html?" + q + "&select=" + encodeURIComponent(g.id);
  return "index.html?" + q + "&sheet=" + encodeURIComponent(g.sheet || "")
    + "&select=" + encodeURIComponent(g.id);
}
