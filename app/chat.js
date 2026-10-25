'use strict';
// Chat: text (multi-line, emoji), photos, videos, stickers, voice notes; edit/delete with undo;
// select messages to make a moment; custom quick replies and backgrounds.
// Messages are stored locally. Real-time delivery to the other person needs a server (see README).

let activeChat = null;
let editingMsg = null;
let selecting = null; // Set of selected message ids while in selection mode
let panelTab = 'emoji';

const DEFAULT_REPLIES = LANG === 'yue' ? ['掛住你', '今晚食咩？', '返緊屋企', '到咗未？', '愛你 ❤️'] : ['Miss you', 'Dinner tonight?', 'On my way home', 'Love you ❤️'];
const quickReplies = () => settings.quickReplies || DEFAULT_REPLIES;
const isDesktop = () => matchMedia('(pointer: fine)').matches;

const EMOJI = {
  '😀': ['😀', '😄', '😁', '😆', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😜', '🤪', '🤗', '🤭', '🤔', '😴', '😌', '😎', '🥳', '😏', '😬', '🙄', '😮', '😲', '🥹', '😢', '😭', '😤', '😡', '🥺', '😳', '🤯', '😱', '🤒', '🤧', '🙈', '🙉', '🙊'],
  '❤️': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💋', '💌', '🫶', '🤟', '👍', '👎', '👏', '🙌', '🙏', '💪', '👌', '✌️', '🤞', '👋', '🫡', '💯', '✨', '🔥', '⭐', '🌈', '☀️', '🌙', '⚡'],
  '🐱': ['🐱', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🐈', '🐈‍⬛', '🐾', '🐶', '🐰', '🐻', '🐼', '🐨', '🐯', '🦊', '🐹', '🐭', '🐧', '🐥', '🐢', '🐟', '🐠', '🦋', '🌸', '🌷', '🌹', '🌻', '🍀', '🌿', '🌵'],
  '🍜': ['🍜', '🍣', '🍱', '🍚', '🍛', '🥟', '🍤', '🍙', '🍲', '🥗', '🥑', '🍅', '🌽', '🥦', '🍌', '🍎', '🍓', '🍉', '🍑', '🥐', '🍞', '🧀', '🥚', '🍳', '🥓', '🍔', '🍟', '🍕', '🌮', '🍰', '🎂', '🧁', '🍩', '🍪', '🍫', '🍦', '☕', '🧋', '🍵', '🍺', '🍷', '🥂'],
  '🎉': ['🎉', '🎊', '🎁', '🎈', '🎄', '🎃', '🏠', '🛒', '🚗', '🚕', '🚌', '🚇', '✈️', '🏖️', '⛰️', '🎬', '🎮', '🎧', '🎵', '📷', '📱', '💻', '📚', '✏️', '💼', '⏰', '📅', '💤', '🛁', '🛏️', '🏃', '🧘', '⚽', '🏀', '🎾', '🏸', '💊', '🩺', '🧹', '🧺'],
};
const isEmojiOnly = t => /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && [...t.replace(/\s/g, '')].length <= 8;

const BACKGROUNDS = [
  { id: 'default', label: 'Default', css: '' },
  { id: 'blush', label: 'Blush', css: 'background:#F6E3E0' },
  { id: 'sage', label: 'Sage', css: 'background:#E3EADF' },
  { id: 'sky', label: 'Sky', css: 'background:#DFE7F1' },
  { id: 'sand', label: 'Sand', css: 'background:#F1E8D9' },
  { id: 'lavender', label: 'Lavender', css: 'background:#ECE2EE' },
  { id: 'night', label: 'Night', css: 'background:#1E1A24' },
  { id: 'dots', label: 'Dots', css: 'background:radial-gradient(circle at 1px 1px, rgba(194,65,91,.18) 1.2px, transparent 0) 0 0/18px 18px, #FFF8F3' },
  { id: 'hearts', label: 'Hearts', css: `background:url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><text x="8" y="22" font-size="14" opacity=".22">♥</text><text x="30" y="44" font-size="10" opacity=".16">♥</text></svg>')}") 0 0/48px 48px, #FBEDEF` },
  { id: 'paws', label: 'Paws', css: `background:url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><text x="6" y="22" font-size="16" opacity=".18">🐾</text><text x="32" y="50" font-size="12" opacity=".14">🐾</text></svg>')}") 0 0/56px 56px, #F4EEE6` },
];
function chatBgCss(chat) {
  const bg = chat?.bg;
  if (!bg) return '';
  if (bg.photo) return `background:linear-gradient(rgba(0,0,0,.08),rgba(0,0,0,.08)),url("${bg.photo}") center/cover`;
  return BACKGROUNDS.find(b => b.id === bg.id)?.css || '';
}

// Generic bottom sheet with a list of actions.
function openSheet(title, rows, extra = null) {
  const close = () => $('#sheet').close();
  fill($('#sheet-body'), title && h('h2', { className: 'sheet-title', textContent: title }), extra,
    h('div', { className: 'actions' }, rows.filter(Boolean).map(r => r === '-' ? h('hr') :
      h('button', { className: r.danger ? 'danger' : '', onclick: () => { close(); r.run(); } },
        h('span', { className: 'ico', style: `background:${r.color || 'var(--accent)'}` }, typeof r.icon === 'string' && r.icon.length > 2 ? icon(r.icon) : r.icon), r.label))));
  $('#sheet').showModal();
}

// ---------- Chats ----------
async function partnerChat(create = false) {
  if (!settings.them) return null;
  const chats = await db.all('chats');
  let c = chats.find(x => x.id === settings.partnerChat) || chats.find(x => x.name === settings.them);
  if (!c && create) {
    c = { id: uid(), name: settings.them, created: Date.now() };
    await db.put('chats', c);
  }
  if (c && settings.partnerChat !== c.id) {
    settings.partnerChat = c.id;
    if (c.name !== settings.them) { c.name = settings.them; await db.put('chats', c); }
    await db.put('settings', settings);
  }
  return c;
}
async function enterChat() {
  if (!activeChat) activeChat = (await partnerChat(true))?.id || null;
  $('#chat-layout').classList.toggle('show-thread', !!activeChat);
  renderChats();
}
$('#new-chat').addEventListener('submit', async e => {
  e.preventDefault();
  const chat = { id: uid(), name: $('#new-chat-name').value.trim(), created: Date.now() };
  await db.put('chats', chat);
  e.target.reset();
  openChat(chat.id);
});
$('#chat-back').onclick = () => { $('#chat-layout').classList.remove('show-thread'); endSelect(); renderChats(); };
function openChat(id) {
  activeChat = id;
  editingMsg = null;
  endSelect();
  $('#chat-layout').classList.add('show-thread');
  renderChats();
}

async function deleteChat(chat) {
  if (!confirm(T(`Delete the chat with ${chat.name} and all its messages?`))) return;
  for (const m of (await db.all('messages')).filter(m => m.chat === chat.id)) {
    await db.del('messages', m.id);
    if (m.media) await db.del('media', m.media);
  }
  await db.del('chats', chat.id);
  if (settings.partnerChat === chat.id) { delete settings.partnerChat; await db.put('settings', settings); }
  if (activeChat === chat.id) { activeChat = null; $('#chat-layout').classList.remove('show-thread'); }
  toast('Chat deleted');
  renderChats();
  renderHome();
}
function chatMenu(chat) {
  openSheet(chat.name, [
    { icon: 'image', label: 'Change background', color: '#3C6E91', run: () => backgroundPicker(chat) },
    { icon: 'pen', label: 'Rename', color: '#9A4A8C', run: async () => {
      const name = prompt(T('Chat name'), chat.name);
      if (name?.trim()) { chat.name = name.trim(); await db.put('chats', chat); renderChats(); }
    } },
    { icon: 'check', label: 'Select messages', color: '#5E8C4A', run: () => startSelect() },
    '-',
    { icon: 'trash', label: 'Delete chat', color: '#D2384F', danger: true, run: () => deleteChat(chat) },
  ]);
}
$('#chat-menu').onclick = async () => { const c = await db.get('chats', activeChat); if (c) chatMenu(c); };

function backgroundPicker(chat) {
  const save = async bg => { chat.bg = bg; await db.put('chats', chat); $('#sheet').close(); renderChats(); };
  const photo = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
    const f = e.target.files[0];
    if (f) save({ photo: await readImage(f, 1400) });
  } });
  fill($('#sheet-body'), h('h2', { className: 'sheet-title', textContent: 'Chat background' }),
    h('div', { className: 'bg-grid' },
      BACKGROUNDS.map(b => h('button', { className: 'bg-swatch' + ((chat.bg?.id || 'default') === b.id && !chat.bg?.photo ? ' on' : ''), style: b.css || 'background:var(--bg)', onclick: () => save(b.id === 'default' ? null : { id: b.id }) },
        h('span', { textContent: b.label }))),
      h('label', { className: 'bg-swatch photo' + (chat.bg?.photo ? ' on' : ''), style: chat.bg?.photo ? `background:url("${chat.bg.photo}") center/cover` : '' }, photo, icon('image'), h('span', { textContent: 'Your photo' }))));
  $('#sheet').showModal();
}

async function renderChats() {
  const [chats, all] = await Promise.all([db.all('chats'), db.all('messages')]);
  const last = {};
  all.forEach(m => { if (!last[m.chat] || m.at > last[m.chat].at) last[m.chat] = m; });
  chats.sort((a, b) => (last[b.id]?.at || b.created) - (last[a.id]?.at || a.created));
  const preview = m => !m ? 'Say hi 👋' : m.kind === 'text' ? m.body : { sticker: 'Sticker', photo: '📷 Photo', video: '🎬 Video', voice: '🎙 Voice message' }[m.kind] || '';

  fill($('#chat-list'), chats.map(c => h('li', { className: c.id === activeChat ? 'active' : '' },
    chatAvatar(c),
    h('div', { className: 't', onclick: () => openChat(c.id) }, h('strong', { textContent: c.name }), h('span', { className: 'last', textContent: preview(last[c.id]) })),
    roundBtn('more', `Options for ${c.name}`, () => chatMenu(c)))));

  const chat = chats.find(c => c.id === activeChat);
  $('#chat-title').textContent = chat ? chat.name : 'Chat';
  fill($('#chat-avatar'), chat ? chatAvatar(chat) : null);
  $('#msg-text').placeholder = chat ? `Message ${chat.name}` : 'Message';
  $('#messages').style.cssText = chatBgCss(chat);
  $('#messages').classList.toggle('dark-bg', chat?.bg?.id === 'night' || !!chat?.bg?.photo);
  renderQuickReplies();

  const msgs = chat ? all.filter(m => m.chat === chat.id).sort((a, b) => a.at - b.at) : [];
  let lastDay = '';
  const nodes = [];
  msgs.forEach(m => {
    const day = isoDate(new Date(m.at));
    if (day !== lastDay) nodes.push(h('span', { className: 'day-sep', textContent: day === today() ? 'Today' : fmtDate(day) }));
    lastDay = day;
    nodes.push(messageNode(m, chat));
  });
  const lastMsg = msgs.at(-1);
  if (lastMsg) nodes.push(h('span', { className: 'seen', textContent: `Sent ${new Date(lastMsg.at).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })}` }));
  const box = $('#messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  fill(box, nodes.length ? nodes : [h('p', { className: 'empty', textContent: chat ? `Say hi to ${chat.name} 👋` : 'Start a chat.' })]);
  if (atBottom || !renderChats.didScroll) box.scrollTop = box.scrollHeight;
  renderChats.didScroll = true;
}
function chatAvatar(c) {
  if (c.id === settings.partnerChat) return avatar('them', 'sm-av');
  return h('div', { className: 'av', style: tileVars(c.id).replace('--tile-bg', 'background').replace(';--tile-fg', ';color'), textContent: initial(c.name) });
}

// Text with clickable links; a lone link from a known app gets a small card.
function richText(text) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map(p => /^https?:\/\//.test(p) ? h('a', { href: p, target: '_blank', rel: 'noopener', textContent: p }) : p);
}
function messageNode(m, chat) {
  const time = h('time', { textContent: new Date(m.at).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' }) + (m.edited ? ' · edited' : '') });
  let body;
  if (m.kind === 'text') {
    const big = isEmojiOnly(m.body);
    const link = extractUrl(m.body), s = link && detectSource(link);
    body = h('div', { className: 'msg' + (big ? ' big-emoji' : ''), translate: false }, richText(m.body),
      s && s.id !== 'web' ? h('a', { className: 'msg-link', href: link, target: '_blank', rel: 'noopener' }, h('span', { className: 'badge', style: `background:${s.color}`, textContent: s.name.slice(0, 2) }), `Open in ${s.name}`) : null,
      time);
  } else {
    const media = m.kind === 'video' ? mediaEl('video', m.media, { poster: m.poster || '', className: 'video' }) :
      m.kind === 'voice' ? mediaEl('audio', m.media, { className: 'voice' }) :
      h('img', { src: m.body, alt: m.kind, className: m.kind });
    body = h('div', { className: 'msg-media' }, media,
      h('div', { className: 'saved-row' },
        m.saved ? [h('span', { className: 'saved-chip', textContent: `♥ ${settings.me || 'You'}` }), h('span', { className: 'sm muted', textContent: 'Saved to Moments' })] :
          (m.kind === 'photo' || m.kind === 'video') && h('button', { className: 'saved-chip', textContent: '♡ Save to Moments', onclick: e => { e.stopPropagation(); messagesToMoment([m], chat); } }),
        time));
  }
  const wrap = h('div', { className: 'msg-wrap' + (selecting?.has(m.id) ? ' selected' : '') + (selecting ? ' selecting' : '') }, selecting && h('span', { className: 'tick' }, icon('check')), body);
  // Tap (or right-click) a message for options; in selection mode, tap toggles it.
  wrap.addEventListener('click', e => {
    if (selecting) { e.preventDefault(); selecting.has(m.id) ? selecting.delete(m.id) : selecting.add(m.id); updateSelect(); renderChats(); return; }
    if (e.target.closest('a, button, video, audio')) return;
    messageMenu(m, chat);
  });
  wrap.addEventListener('contextmenu', e => { e.preventDefault(); if (!selecting) messageMenu(m, chat); });
  return wrap;
}

function messageMenu(m, chat) {
  openSheet(null, [
    m.kind === 'text' && { icon: 'copy', label: 'Copy', color: '#3C6E91', run: () => { navigator.clipboard?.writeText(m.body); toast('Copied'); } },
    m.kind === 'text' && { icon: 'pen', label: 'Edit', color: '#9A4A8C', run: () => startEdit(m) },
    { icon: 'heart', label: 'Save to Moments', run: () => messagesToMoment([m], chat) },
    { icon: 'check', label: 'Select more…', color: '#5E8C4A', run: () => { startSelect(); selecting.add(m.id); updateSelect(); renderChats(); } },
    '-',
    { icon: 'trash', label: 'Delete', color: '#D2384F', danger: true, run: () => deleteMessages([m]) },
  ], h('div', { className: 'sheet-preview' }, m.kind === 'text' ? m.body.slice(0, 160) : { photo: '📷 Photo', video: '🎬 Video', sticker: 'Sticker', voice: '🎙 Voice message' }[m.kind]));
}

async function deleteMessages(list) {
  for (const m of list) await db.del('messages', m.id); // media kept until undo window passes
  renderChats(); renderHome();
  const timer = setTimeout(() => list.forEach(m => m.media && db.del('media', m.media)), 6000);
  toast(list.length > 1 ? `${list.length} messages deleted` : 'Message deleted', { label: 'Undo', run: async () => {
    clearTimeout(timer);
    for (const m of list) await db.put('messages', m);
    renderChats(); renderHome();
  } });
}

// ---------- Edit ----------
function startEdit(m) {
  editingMsg = m;
  $('#edit-bar').hidden = false;
  $('#msg-text').value = m.body;
  autoGrow();
  $('#msg-text').focus();
}
function cancelEdit() { editingMsg = null; $('#edit-bar').hidden = true; $('#msg-text').value = ''; autoGrow(); }
$('#edit-cancel').onclick = cancelEdit;

// ---------- Selection → moment ----------
function startSelect() { selecting = new Set(); $('#select-bar').hidden = false; updateSelect(); renderChats(); }
function endSelect() { selecting = null; $('#select-bar').hidden = true; }
function updateSelect() { $('#select-count').textContent = `${selecting?.size || 0} selected`; }
$('#select-cancel').onclick = () => { endSelect(); renderChats(); };
$('#select-delete').onclick = async () => {
  const list = (await db.all('messages')).filter(m => selecting?.has(m.id));
  if (!list.length) return toast('Tap messages to select them');
  endSelect();
  deleteMessages(list);
};
$('#select-moment').onclick = async () => {
  const list = (await db.all('messages')).filter(m => selecting?.has(m.id)).sort((a, b) => a.at - b.at);
  if (!list.length) return toast('Tap messages to select them');
  const chat = await db.get('chats', activeChat);
  endSelect();
  messagesToMoment(list, chat);
};
// Open the moment composer pre-filled with the messages' words, photos, videos and links.
async function messagesToMoment(list, chat) {
  const texts = list.filter(m => m.kind === 'text').map(m => m.body);
  const link = texts.map(extractUrl).find(Boolean) || '';
  const photos = list.filter(m => m.kind === 'photo' || m.kind === 'sticker').map(m => m.body);
  const videos = [];
  for (const m of list.filter(m => m.kind === 'video')) {
    const media = await db.get('media', m.media);
    if (media) videos.push({ blob: media.blob, poster: m.poster }); // a copy, so deleting the moment keeps the chat intact
  }
  openComposer({
    text: texts.map(t => t.replace(link, '').trim()).filter(Boolean).join('\n'),
    link, photos, videos, tags: ['chat'],
    onSaved: async () => { for (const m of list) await db.put('messages', { ...m, saved: true }); renderChats(); },
  });
  $('#c-date').value = isoDate(new Date(list[0].at));
}

// ---------- Composer bar ----------
const input = $('#msg-text');
function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  const hasText = !!input.value.trim();
  $('#send-btn').hidden = !hasText && !editingMsg;
  $('#mic-btn').hidden = hasText || !!editingMsg;
}
input.addEventListener('input', autoGrow);
// Computer: Enter sends, Shift+Enter adds a line. Phone: the return key adds a line; tap send.
// Never send while an input method (Chinese, Japanese…) is still composing.
input.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  if (isDesktop() && !e.shiftKey) { e.preventDefault(); $('#msg-form').requestSubmit(); }
});
$('#msg-form').addEventListener('submit', async e => {
  e.preventDefault();
  const text = input.value.replace(/\s+$/, '');
  if (editingMsg) {
    const before = editingMsg;
    if (text.trim() && text !== before.body) {
      await db.put('messages', { ...before, body: text, edited: true });
      toast('Message edited', { label: 'Undo', run: async () => { await db.put('messages', before); renderChats(); } });
    }
    cancelEdit();
    return renderChats();
  }
  if (text.trim()) sendMessage('text', text);
  input.value = '';
  autoGrow();
});

async function sendMessage(kind, body, extra = {}) {
  if (!activeChat) return toast('Start a chat first');
  await db.put('messages', { id: uid(), chat: activeChat, kind, body, at: Date.now(), ...extra });
  renderChats.didScroll = false;
  renderChats();
  renderHome();
}
$('#msg-photo').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    try {
      if (isVideoFile(f)) {
        if (f.size > 300 * 1048576) { toast(`${f.name} is over 300 MB`); continue; }
        const poster = await videoPoster(f);
        await sendMessage('video', '', { media: await putMedia(f, { kind: 'video' }), poster });
      } else await sendMessage('photo', await readImage(f, 1200));
    } catch {}
  }
});

// Quick replies (editable)
function renderQuickReplies() {
  fill($('#quick-replies'), quickReplies().map(r => h('button', { type: 'button', textContent: r, onclick: () => sendMessage('text', r) })),
    h('button', { type: 'button', className: 'edit-chip', ariaLabel: 'Edit quick replies', onclick: editQuickReplies }, icon('pen')));
}
function editQuickReplies() {
  let list = [...quickReplies()];
  const draw = () => fill($('#sheet-body'),
    h('h2', { className: 'sheet-title', textContent: 'Quick replies' }),
    h('p', { className: 'sm muted', textContent: 'Tap one in the chat to send it instantly.' }),
    h('div', { className: 'list-card' }, list.map((r, i) => h('div', {},
      h('input', { value: r, className: 'grow plain-input', oninput: e => { list[i] = e.target.value; } }),
      roundBtn('back', 'Move up', () => { if (i) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); } }),
      roundBtn('trash', 'Remove', () => { list.splice(i, 1); draw(); })))),
    h('form', { className: 'inline-form', onsubmit: e => { e.preventDefault(); const v = e.target.elements[0].value.trim(); if (v) { list.push(v); draw(); } } },
      h('input', { placeholder: 'Add a reply, e.g. 到咗未？' }), h('button', { className: 'round accent', ariaLabel: 'Add' }, icon('plus'))),
    h('div', { className: 'row' },
      h('button', { className: 'pill-btn', textContent: 'Reset to default', onclick: () => { list = [...DEFAULT_REPLIES]; draw(); } }),
      h('button', { className: 'cta grow', textContent: 'Save', onclick: async () => {
        settings.quickReplies = list.map(s => s.trim()).filter(Boolean);
        await db.put('settings', settings);
        $('#sheet').close();
        renderQuickReplies();
      } })));
  draw();
  $('#sheet').showModal();
}

// ---------- Emoji & sticker panel ----------
$('#toggle-panel').onclick = () => { $('#chat-panel').hidden = !$('#chat-panel').hidden; if (!$('#chat-panel').hidden) renderPanel(); };
async function renderPanel() {
  const stickers = await db.all('stickers');
  const groups = [...new Set(stickers.map(s => s.group || 'Stickers'))];
  const tabs = [...Object.keys(EMOJI).map(k => ({ id: 'emoji:' + k, label: k })), ...groups.map(g => ({ id: 'st:' + g, label: g }))];
  if (!tabs.some(t => t.id === panelTab)) panelTab = tabs[0].id;
  fill($('#panel-tabs'), tabs.map(t => h('button', { type: 'button', className: t.id === panelTab ? 'on' : '', textContent: t.label, onclick: () => { panelTab = t.id; renderPanel(); } })),
    !stickers.length && h('button', { type: 'button', className: 'hint-tab', textContent: '+ Make stickers', onclick: () => openUs('stickers') }));
  if (panelTab.startsWith('emoji:')) {
    fill($('#panel-body'), h('div', { className: 'emoji-grid' }, EMOJI[panelTab.slice(6)].map(e => h('button', { type: 'button', textContent: e, onclick: () => insertAtCursor(e) }))));
  } else {
    const g = panelTab.slice(3);
    fill($('#panel-body'), h('div', { className: 'sticker-tray' }, stickers.filter(s => (s.group || 'Stickers') === g).sort((a, b) => b.created - a.created)
      .map(s => h('img', { src: s.src, alt: 'Sticker', onclick: () => sendMessage('sticker', s.src) }))));
  }
}
function insertAtCursor(text) {
  const { selectionStart: a = input.value.length, selectionEnd: b = input.value.length } = input;
  input.value = input.value.slice(0, a) + text + input.value.slice(b);
  input.selectionStart = input.selectionEnd = a + text.length;
  autoGrow();
  if (isDesktop()) input.focus();
}

// ---------- Voice: record a voice message, or speak to type ----------
let recorder = null, recChunks = [], recStart = 0, recTimer = null;
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
$('#mic-btn').onclick = () => openSheet(null, [
  { icon: 'mic', label: 'Record a voice message', run: startRecording },
  { icon: '粵', label: 'Speak to type · 廣東話', color: '#3C6E91', run: () => dictate('zh-HK') },
  { icon: '普', label: 'Speak to type · 普通話', color: '#5E8C4A', run: () => dictate('zh-TW') },
  { icon: 'En', label: 'Speak to type · English', color: '#9A4A8C', run: () => dictate('en-HK') },
], h('p', { className: 'sm muted sheet-preview', textContent: 'On iPhone you can also tap the 🎤 key on the keyboard to dictate in Cantonese.' }));

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Voice recording is not supported in this browser');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
    recChunks = [];
    recorder.ondataavailable = e => e.data.size && recChunks.push(e.data);
    recorder.start(250);
    recStart = Date.now();
    $('#rec-bar').hidden = false;
    $('#msg-form').hidden = true;
    recTimer = setInterval(() => { const s = Math.floor((Date.now() - recStart) / 1000); $('#rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
  } catch {
    toast('Microphone permission was not given');
  }
}
function stopRecording(send) {
  if (!recorder) return;
  clearInterval(recTimer);
  recorder.onstop = async () => {
    recorder.stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
    recorder = null;
    $('#rec-bar').hidden = true;
    $('#msg-form').hidden = false;
    if (send && blob.size) await sendMessage('voice', '', { media: await putMedia(blob, { kind: 'voice' }), duration: Math.round((Date.now() - recStart) / 1000) });
  };
  recorder.stop();
}
$('#rec-cancel').onclick = () => stopRecording(false);
$('#rec-send').onclick = () => stopRecording(true);

function dictate(lang) {
  if (!Speech) return toast('Speech-to-text is not available here. On iPhone, tap the 🎤 key on the keyboard instead.');
  const rec = new Speech();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  const base = input.value ? input.value.replace(/\s*$/, ' ') : '';
  $('#mic-btn').classList.add('listening');
  toast('Listening… speak now');
  rec.onresult = e => {
    input.value = base + [...e.results].map(r => r[0].transcript).join('');
    autoGrow();
  };
  rec.onerror = e => toast(e.error === 'not-allowed' ? 'Microphone permission was not given' : 'Could not hear that, try again');
  rec.onend = () => { $('#mic-btn').classList.remove('listening'); autoGrow(); };
  rec.start();
}

autoGrow();
renderers.push(renderChats);
