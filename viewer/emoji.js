/* Emoji for the Messenger: a picker for the message box, and the quick
 * reactions under a message. A built-in list (no CDN, works offline); the
 * ones used last come first.
 */

import { pop, closePop, esc } from "./tasks-util.js";

export const QUICK = ["👍", "❤️", "😂", "😮", "🙏", "✅"];

const GROUPS = [
  ["Smileys", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🥵 🥶 🥴 😵 🤯 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 💀 💩 🤡"],
  ["Hands", "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫡 🫶 👀 🧠"],
  ["People", "👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 👷 👷‍♀️ 👷‍♂️ 🧑‍💼 👨‍💼 👩‍💼 🧑‍💻 👨‍💻 👩‍💻 🧑‍🔧 🧑‍🎨 🧑‍🏫 🕵️ 💁 🙋 🙆 🙅 🤷 🤦 🙇 🧍 🚶 🏃 👥 🫂"],
  ["Work", "🏗️ 🏢 🏬 🏠 🏡 🏘️ 🏚️ 🏛️ 🏭 🏥 🏫 🏨 ⛪ 🌉 🏙️ 🌆 🛣️ 🚧 🧱 🪵 🔨 🪛 🔧 🔩 ⚙️ 🧰 🪜 📐 📏 🧮 🗜️ ⛏️ 🪚 🚪 🪟 🛗 🚿 🛁 🚽 💡 🔌 🔋 🧯 🚒 🚑 🚚 🚛 🏗"],
  ["Office", "💻 🖥️ 🖨️ ⌨️ 🖱️ 📱 ☎️ 📞 📠 📷 📹 🎥 💾 💿 📀 🗂️ 📁 📂 🗃️ 📄 📃 📑 📊 📈 📉 🗒️ 🗓️ 📅 📆 📇 📋 📌 📍 📎 🖇️ ✂️ 🖊️ 🖋️ ✏️ 📝 🔍 🔎 🔒 🔓 🔑 🗝️ 📦 📫 📬 📮 ✉️ 📧 📨 💼 🧾 💰 💵 💳"],
  ["Symbols", "✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❗ ❓ ❕ ❔ ‼️ ⁉️ ⚠️ 🚫 ⛔ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 ⭐ 🌟 ✨ 🔥 💯 💥 💢 💬 💭 🗨️ 🔔 🔕 📣 📢 ⏰ ⏳ ⌛ 🕐 ⏱️ ♻️ 🔄 🔁 ↩️ ↪️ ⬆️ ⬇️ ⬅️ ➡️ 🆗 🆕 🆙 🆒 🔝 🔜"],
  ["Hearts", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝"],
  ["Food & fun", "☕ 🍵 🧋 🍺 🍻 🥂 🍷 🍰 🎂 🍕 🍔 🍟 🍜 🍣 🍱 🥟 🍚 🍞 🥐 🍩 🍪 🍎 🍊 🍌 🍉 🎉 🎊 🎈 🎁 🏆 🥇 🥈 🥉 ⚽ 🏀 🎯 🎮 🎵 🎶 ☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌈 ☔ 🌀 🌙 🌏 ✈️ 🚗 🚕 🚌 🚇 🚢"],
  ["Flags", "🇭🇰 🇨🇳 🇵🇭 🇸🇬 🇲🇾 🇹🇼 🇯🇵 🇰🇷 🇬🇧 🇺🇸 🇦🇺 🇨🇦 🏁 🚩 🏳️ 🏴"],
].map(([name, s]) => [name, s.split(" ").filter(Boolean)]);

const KEY = "lwk-viewer:emoji-recent";

function recent() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]").slice(0, 24); } catch (e) { return []; }
}

export function remember(e) {
  try { localStorage.setItem(KEY, JSON.stringify([e].concat(recent().filter((x) => x !== e)).slice(0, 24))); } catch (err) {}
}

/* The picker under (or over) anchor; done(emoji) on a pick. keepOpen: the
   message box's picker stays open for a few in a row. */
export function emojiPicker(anchor, done, keepOpen) {
  const rec = recent();
  const groups = (rec.length ? [["Recent", rec]] : []).concat(GROUPS);
  const el = pop(anchor, `<div class="ej-tabs">${groups.map(([n, l], i) => `<button type="button" class="ghost" data-g="${i}" title="${esc(n)}">${l[0]}</button>`).join("")}</div>`
    + `<div class="ej-body">${groups.map(([n, l], i) => `<div class="ej-h" data-h="${i}">${esc(n)}</div><div class="ej-grid">`
      + l.map((e) => `<button type="button" class="ej" data-e="${esc(e)}">${e}</button>`).join("") + `</div>`).join("")}</div>`, 320);
  el.classList.add("ej-pop");
  el.addEventListener("click", (ev) => {
    const g = ev.target.closest("[data-g]");
    if (g) {
      const h = el.querySelector(`[data-h="${g.dataset.g}"]`);
      el.querySelector(".ej-body").scrollTop = h.offsetTop - el.querySelector(".ej-body").offsetTop;
      return;
    }
    const b = ev.target.closest("[data-e]");
    if (!b) return;
    remember(b.dataset.e);
    if (!keepOpen) closePop();
    done(b.dataset.e);
  });
  // a pick must not take the focus (and the phone's keyboard) from the box
  el.addEventListener("pointerdown", (ev) => { if (ev.target.closest("button")) ev.preventDefault(); });
  return el;
}

(function css() {
  if (document.getElementById("ej-css")) return;
  const st = document.createElement("style");
  st.id = "ej-css";
  st.textContent = `
.t-pop.ej-pop { padding: 0; display: flex; flex-direction: column; max-height: 340px; }
.ej-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--line, #e2e6ec); overflow-x: auto; scrollbar-width: none; flex: none; }
.ej-tabs button { padding: 6px 7px !important; font-size: 17px; border-radius: 0 !important; }
.ej-body { overflow-y: auto; padding: 4px 6px 8px; }
.ej-h { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; color: var(--muted, #6b7480); margin: 6px 2px 2px; }
.ej-grid { display: grid; grid-template-columns: repeat(8, 1fr); }
.ej { border: 0; background: none; font-size: 22px; line-height: 1; padding: 5px 0; border-radius: 6px; cursor: pointer; }
.ej:hover { background: var(--panel-2, #f5f6f8); }
`;
  document.head.appendChild(st);
})();
