/* What the stand-alone pages (Projects, Messenger) share: signing in on a
 * page opened from a link, the header links, and the unread-chat badge. */

import { api, project, chatBadge } from "./nav.js";

const $ = (s) => document.querySelector(s);

/* Signed in already, or the sign-in form until it works. Resolves /api/me. */
export async function ensureSignedIn() {
  let me = null;
  try { me = await api("/api/me"); } catch (e) { if (e.status !== 401) throw e; }
  if (me) return firstPassword(me);
  const info = await (await fetch("/api/ping")).json();
  const back = $("#gate-back");
  back.hidden = false;
  if (!info.accounts) {
    $("#gate-name").closest("label").firstChild.textContent = "Your name";
    $("#gate-pass").closest("label").firstChild.textContent = "Project passphrase";
    $("#gate-name").type = "text";
  }
  try { $("#gate-name").value = localStorage.getItem(info.accounts ? "lwk-viewer:email" : "lwk-viewer:name") || ""; } catch (e) {}
  await new Promise((resolve) => {
    const go = async () => {
      $("#gate-msg").textContent = "Signing in ...";
      try {
        const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: $("#gate-name").value.trim(), passphrase: $("#gate-pass").value }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Sign-in failed");
        localStorage.setItem("lwk-viewer:token", data.token);
        localStorage.setItem(info.accounts ? "lwk-viewer:email" : "lwk-viewer:name", $("#gate-name").value.trim());
        back.hidden = true;
        resolve();
      } catch (e) { $("#gate-msg").textContent = e.message; }
    };
    $("#gate-go").onclick = go;
    $("#gate-pass").onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } };
  });
  return firstPassword(await api("/api/me"));
}

/* A temporary password is changed before anything else. */
function firstPassword(me) {
  if (me.user && me.user.must_change) {
    location.href = "admin.html?first=1&next=" + encodeURIComponent(location.pathname + location.search) + "#account";
    throw new Error("Set your own password first");
  }
  return me;
}

/* Header: page links keep the project, who is signed in, sign out. */
export function header(me) {
  const p = project();
  const q = p ? "?project=" + encodeURIComponent(p) : "";
  for (const a of document.querySelectorAll("header a.seg-btn[data-page]")) a.href = a.dataset.page + q;
  if (me && me.user) {
    $("#h-who").textContent = me.user.name;
    $("#to-admin").hidden = !(me.site_admin || Object.values(me.projects || {}).includes("admin"));
  }
  const so = $("#h-signout");
  if (so) {
    so.hidden = !(me && me.accounts);
    so.onclick = async (ev) => {
      ev.preventDefault();
      try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
      try { localStorage.removeItem("lwk-viewer:token"); } catch (e) {}
      location.href = "index.html";
    };
  }
  chatBadge();
}
