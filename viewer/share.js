/* "Copy link": a link to exactly this - a sheet, an issue, a 3D view, a
   project, a file - for a chat, an e-mail or WhatsApp. Only people who
   can open that project can open the link (they sign in as usual). */

export async function copyLink(url, what) {
  const href = new URL(url, location.href).href;
  let done = false;
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(href); done = true; } catch (e) {}
  }
  if (!done) {
    // no clipboard (an http address, an old browser): the link to copy by hand
    window.prompt("Copy this link" + (what ? " to " + what : ""), href);
    return href;
  }
  say((what ? "Link to " + what + " copied" : "Link copied") + " - only the project's people can open it");
  return href;
}

function say(msg) {
  let t = document.getElementById("lwk-share-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "lwk-share-toast";
    t.setAttribute("role", "status");
    t.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2000;"
      + "background:#1f2430;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;"
      + "box-shadow:0 6px 20px rgba(0,0,0,.25);transition:opacity .2s;max-width:90vw;text-align:center";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.opacity = "0"; }, 2600);
}
