/* Undo and redo for the pages that change shared things: Tasks, the
 * Messenger and Folders. (The Sheets and 3D pages have their own history
 * for markups.)
 *
 * A page records each change as { label, undo, redo } right after making
 * it; Ctrl+Z (Cmd+Z on a Mac) runs the last undo, Ctrl+Y or Ctrl+Shift+Z
 * runs the redo. Text boxes keep their own typing undo: the keys are left
 * alone while one has the focus. A small note says what was undone, with
 * a Redo link.
 *
 * Changes recorded within a moment of each other (a drag that also
 * re-sorts its neighbours) go back as one step.
 */

const MAX = 60;
const done = [], undone = [];
let busy = false;
let last = 0;

/* entry: { label, undo: async () => {}, redo: async () => {} } */
export function record(entry, opts) {
  if (!entry || typeof entry.undo !== "function") return;
  const now = Date.now();
  const top = done[done.length - 1];
  if (top && !(opts && opts.separate) && now - last < 120 && top._merge && entry.merge !== false) {
    // part of the same gesture: undone together, newest first
    const a = top, b = entry;
    done[done.length - 1] = {
      label: a.label, _merge: true,
      undo: async () => { await b.undo(); await a.undo(); },
      redo: async () => { await a.redo(); await b.redo(); },
    };
  } else {
    done.push(Object.assign({ _merge: entry.merge !== false }, entry));
    if (done.length > MAX) done.shift();
  }
  last = now;
  undone.length = 0;
}

/* while undoing, the page's own record() calls are ignored (the undo
   itself makes changes through the same functions) */
export const replaying = () => busy;

export async function undo() {
  if (busy) return;
  const e = done.pop();
  if (!e) { note("Nothing to undo"); return; }
  busy = true;
  try {
    await e.undo();
    undone.push(e);
    note("Undone: " + e.label, e.redo ? redo : null);
  } catch (err) {
    note("Could not undo: " + (err && err.message || err), null, true);
  } finally { busy = false; }
}

export async function redo() {
  if (busy) return;
  const e = undone.pop();
  if (!e) { note("Nothing to redo"); return; }
  busy = true;
  try {
    await e.redo();
    done.push(e);
    note("Redone: " + e.label);
  } catch (err) {
    note("Could not redo: " + (err && err.message || err), null, true);
  } finally { busy = false; }
}

export const canUndo = () => done.length > 0;

function typing(t) {
  return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
}

document.addEventListener("keydown", (ev) => {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k !== "z" && k !== "y") return;
  if (typing(ev.target) || typing(document.activeElement)) return;
  ev.preventDefault();
  if (k === "y" || (k === "z" && ev.shiftKey)) redo(); else undo();
});

let box = null, timer = null;
function note(text, action, bad) {
  if (!box) {
    box = document.createElement("div");
    box.className = "undo-note";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;"
      + "background:#1f2937;color:#fff;padding:9px 14px;border-radius:8px;font:13px system-ui,sans-serif;"
      + "box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;gap:14px;align-items:center;max-width:calc(100vw - 32px)";
    document.body.appendChild(box);
  }
  box.innerHTML = "";
  const s = document.createElement("span");
  s.textContent = text;
  if (bad) box.style.background = "#b42318"; else box.style.background = "#1f2937";
  box.appendChild(s);
  if (action) {
    const a = document.createElement("button");
    a.type = "button";
    a.textContent = "Redo";
    a.style.cssText = "background:none;border:0;color:#fdba74;font-weight:600;cursor:pointer;padding:0;font:inherit";
    a.onclick = () => { box.hidden = true; action(); };
    box.appendChild(a);
  }
  const k = document.createElement("small");
  k.textContent = action ? "Ctrl+Y" : "";
  k.style.opacity = ".6";
  box.appendChild(k);
  box.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { box.hidden = true; }, 5000);
}
