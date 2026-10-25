'use strict';
// Cat diary: quick behaviour logs, health records with due dates, weight, photos, and simple trend notes.
// Ideas from Moggie (activity & wellbeing changes), Meowow (mood diary with clips) and Cat Buddy (weight, vet, meds, vaccines, milestones).

const PET_TYPES = [
  { id: 'meal', emoji: '🍽️', label: 'Ate' },
  { id: 'water', emoji: '💧', label: 'Drank' },
  { id: 'litter', emoji: '🚽', label: 'Litter' },
  { id: 'nap', emoji: '😴', label: 'Nap' },
  { id: 'play', emoji: '🎾', label: 'Play' },
  { id: 'cuddle', emoji: '😻', label: 'Affection' },
  { id: 'grumpy', emoji: '😾', label: 'Grumpy' },
  { id: 'vomit', emoji: '🤮', label: 'Vomit' },
  { id: 'weight', emoji: '⚖️', label: 'Weight', form: 'weight' },
  { id: 'meds', emoji: '💊', label: 'Medicine', form: 'due' },
  { id: 'vaccine', emoji: '💉', label: 'Vaccine', form: 'due' },
  { id: 'vet', emoji: '🩺', label: 'Vet visit', form: 'due' },
  { id: 'groom', emoji: '✂️', label: 'Grooming', form: 'due' },
  { id: 'diary', emoji: '📷', label: 'Diary', form: 'diary' },
];
const ptype = id => PET_TYPES.find(t => t.id === id) || { emoji: '🐾', label: id };
const PET_COLOR = '#9A4A8C';

let pets = [];
let activePet = null;
let editingLog = null;
let logPhoto = null;
let diaryDays = 7;

const petAge = birthday => {
  if (!birthday) return '';
  const months = Math.floor(daysBetween(birthday, today()) / 30.44);
  return months < 12 ? plural(months, 'month') + ' old' : plural(Math.floor(months / 12), 'year') + ' old';
};
const timeOf = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ago = at => {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// ---------- Profiles ----------
function openPetForm(pet = null) {
  $('#pet-form').reset();
  $('#pet-form-title').textContent = pet ? `Edit ${pet.name}` : 'Add your cat';
  $('#pf-name').value = pet?.name || '';
  $('#pf-birthday').value = pet?.birthday || '';
  $('#pf-vet').value = pet?.vet || '';
  $('#pf-notes').value = pet?.notes || '';
  $('#pf-delete').hidden = !pet;
  $('#pet-form').dataset.id = pet?.id || '';
  $('#pet-form-dialog').showModal();
}
$('#pet-form').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#pet-form').dataset.id || uid();
  const old = pets.find(p => p.id === id);
  await db.put('pets', { ...old, id, name: $('#pf-name').value.trim(), birthday: $('#pf-birthday').value, vet: $('#pf-vet').value.trim(), notes: $('#pf-notes').value.trim(), created: old?.created || Date.now() });
  activePet = id;
  $('#pet-form-dialog').close();
  refresh();
});
$('#pf-delete').onclick = async () => {
  const id = $('#pet-form').dataset.id;
  if (!confirm('Delete this cat and all of its diary entries?')) return;
  for (const l of (await db.all('petlogs')).filter(l => l.pet === id)) await db.del('petlogs', l.id);
  await db.del('pets', id);
  activePet = null;
  $('#pet-form-dialog').close();
  refresh();
};

// ---------- Logging ----------
async function quickLog(type) {
  const log = { id: uid(), pet: activePet, type: type.id, at: Date.now(), date: today() };
  await db.put('petlogs', log);
  toast(`${type.emoji} ${type.label} logged`, { label: 'Undo', run: async () => { await db.del('petlogs', log.id); refresh(); } });
  refresh();
}
function openLogForm(type, log = null) {
  editingLog = log;
  logPhoto = log?.photo || null;
  const t = ptype(log?.type || type.id);
  $('#pet-log').reset();
  $('#pet-log').dataset.type = t.id;
  $('#pl-title').textContent = `${t.emoji} ${t.label}`;
  const at = new Date(log?.at || Date.now());
  $('#pl-date').value = isoDate(at);
  $('#pl-time').value = at.toTimeString().slice(0, 5);
  $('#pl-value-wrap').hidden = t.form !== 'weight';
  $('#pl-value').value = log?.value || '';
  $('#pl-due-wrap').hidden = t.form !== 'due';
  $('#pl-due').value = log?.due || '';
  $('#pl-note').value = log?.note || '';
  $('#pl-note').placeholder = t.form === 'due' ? 'e.g. drug name & dose, vaccine type, clinic' : t.form === 'diary' ? 'What happened? A milestone, a funny moment…' : 'Add a note (optional)';
  $('#pl-delete').hidden = !log;
  renderLogPhoto();
  $('#pet-log-dialog').showModal();
}
function renderLogPhoto() {
  fill($('#pl-photo-view'), logPhoto && h('figure', {}, h('img', { src: logPhoto, alt: '' }),
    h('button', { type: 'button', ariaLabel: 'Remove photo', onclick: () => { logPhoto = null; renderLogPhoto(); } }, icon('x'))));
}
$('#pl-photo').addEventListener('change', async e => {
  if (e.target.files[0]) logPhoto = await readImage(e.target.files[0], 1400);
  e.target.value = '';
  renderLogPhoto();
});
$('#pet-log').addEventListener('submit', async e => {
  e.preventDefault();
  const type = $('#pet-log').dataset.type;
  const at = new Date(`${$('#pl-date').value || today()}T${$('#pl-time').value || '12:00'}`).getTime();
  const value = $('#pl-value').value ? +$('#pl-value').value : undefined;
  if (type === 'weight' && !value) return toast('Enter the weight');
  await db.put('petlogs', { ...editingLog, id: editingLog?.id || uid(), pet: editingLog?.pet || activePet, type, at, date: isoDate(new Date(at)),
    value, due: $('#pl-due').value || undefined, note: $('#pl-note').value.trim() || undefined, photo: logPhoto || undefined });
  $('#pet-log-dialog').close();
  toast('Saved to the diary');
  refresh();
});
$('#pl-delete').onclick = async () => {
  await db.del('petlogs', editingLog.id);
  $('#pet-log-dialog').close();
  refresh();
};

// ---------- Trend notes (simple comparisons with this cat's own usual pattern; not a diagnosis) ----------
function insights(logs) {
  const out = [];
  const now = Date.now();
  const inDays = (a, b) => logs.filter(l => l.at > now - a * DAY && l.at <= now - b * DAY);
  const first = logs.reduce((m, l) => Math.min(m, l.at), now);
  const history = (now - first) / DAY;
  const week = inDays(7, 0), before = inDays(35, 7);
  const count = (arr, t) => arr.filter(l => l.type === t).length;

  const vomits = count(week, 'vomit');
  if (vomits >= 2) out.push({ level: 'warn', text: `${vomits} vomits in the last 7 days. If it keeps happening, check with your vet.` });
  if (history >= 14) {
    const weeks = Math.min(4, (history - 7) / 7);
    for (const [t, label, dir] of [['play', 'Play', 'down'], ['meal', 'Meals', 'down'], ['cuddle', 'Affection', 'down'], ['litter', 'Litter visits', 'up'], ['water', 'Drinking', 'up'], ['nap', 'Naps', 'up']]) {
      const usual = count(before, t) / weeks, now7 = count(week, t);
      if (usual < 3) continue;
      const change = (now7 - usual) / usual;
      if (dir === 'down' && change <= -0.4) out.push({ level: 'warn', text: `${label} logged ${Math.round(-change * 100)}% less than usual this week.` });
      if (dir === 'up' && change >= 0.5) out.push({ level: 'warn', text: `${label} logged ${Math.round(change * 100)}% more than usual this week.` });
    }
  }
  const weights = logs.filter(l => l.type === 'weight').sort((a, b) => a.at - b.at);
  if (weights.length >= 2) {
    const last = weights.at(-1), ref = [...weights].reverse().find(w => w.at <= last.at - 25 * DAY) || weights[0];
    const pct = (last.value - ref.value) / ref.value * 100;
    if (Math.abs(pct) >= 5 && ref !== last) out.push({ level: 'warn', text: `Weight ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)}% since ${fmtDate(ref.date, { day: 'numeric', month: 'short' })}.` });
  }
  if (!out.length) out.push({ level: 'ok', text: history >= 14 ? 'Everything looks like their usual pattern this week.' : 'Keep logging for two weeks and changes from their usual pattern will show here.' });
  return out;
}

// ---------- Render ----------
async function renderPets() {
  pets = (await db.all('pets')).sort((a, b) => a.created - b.created);
  if (!pets.find(p => p.id === activePet)) activePet = pets[0]?.id || null;
  const body = $('#pet-body');
  if (!pets.length) {
    return fill(body, h('div', { className: 'soft-card pet-empty' },
      h('span', { className: 'kicker', textContent: 'Cat diary' }),
      h('span', { className: 'today-q', textContent: 'Track meals, litter, play, moods, weight and vet visits' }),
      h('p', { className: 'sm muted', textContent: 'Quick taps build a picture of their normal routine, so you can spot changes early.' }),
      h('button', { className: 'cta', onclick: () => openPetForm() }, icon('plus'), 'Add your cat')));
  }
  const pet = pets.find(p => p.id === activePet);
  const logs = (await db.all('petlogs')).filter(l => l.pet === pet.id).sort((a, b) => b.at - a.at);
  const todays = logs.filter(l => l.date === today());
  const lastOf = t => logs.find(l => l.type === t);
  const weight = lastOf('weight');
  const upcomingCare = logs.filter(l => l.due && l.due >= today()).sort((a, b) => a.due.localeCompare(b.due));

  // Group the recent diary by day.
  const days = [];
  logs.forEach(l => { if (days.at(-1)?.date !== l.date) days.push({ date: l.date, logs: [] }); days.at(-1).logs.push(l); });

  fill(body,
    h('div', { className: 'chips pet-chips' },
      pets.map(p => h('button', { className: 'chip' + (p.id === activePet ? ' on' : ''), textContent: `🐱 ${p.name}`, onclick: () => { activePet = p.id; renderPets(); } })),
      h('button', { className: 'chip', textContent: '+ Add cat', onclick: () => openPetForm() })),
    h('section', { className: 'card pet-profile' },
      h('div', { className: 'av pet-av', style: tileVars(pet.id).replace('--tile-bg', 'background').replace(';--tile-fg', ';color'), textContent: '🐱' }),
      h('div', { className: 't' },
        h('strong', { className: 'display', textContent: pet.name }),
        h('span', { className: 'sm muted', textContent: [petAge(pet.birthday), weight && `${weight.value} kg`].filter(Boolean).join(' · ') || 'Tap edit to add a birthday' }),
        pet.vet && h('span', { className: 'sm muted', textContent: `Vet: ${pet.vet}` })),
      roundBtn('pen', 'Edit profile', () => openPetForm(pet), 'outline')),
    h('section', { className: 'insights' }, insights(logs).map(i => h('p', { className: 'insight ' + i.level }, h('span', { textContent: i.level === 'ok' ? '✓' : '!' }), i.text))),
    h('div', { className: 'sec-head' }, h('h2', { textContent: 'Log now' }), h('span', { className: 'sm muted', textContent: `${todays.length} ${todays.length === 1 ? 'entry' : 'entries'} today` })),
    h('div', { className: 'log-grid' }, PET_TYPES.map(t => {
      const n = todays.filter(l => l.type === t.id).length;
      return h('button', { className: 'log-btn', onclick: () => t.form ? openLogForm(t) : quickLog(t) },
        h('span', { className: 'e', textContent: t.emoji }), h('span', { textContent: t.label }), n ? h('i', { textContent: n }) : null);
    })),
    h('p', { className: 'sm muted', textContent: ['meal', 'litter', 'play'].map(t => { const l = lastOf(t); return l ? `Last ${ptype(t).label.toLowerCase()}: ${ago(l.at)}` : null; }).filter(Boolean).join(' · ') }),
    upcomingCare.length ? h('section', {},
      h('div', { className: 'sec-head' }, h('h2', { textContent: 'Coming up' })),
      h('div', { className: 'list-card' }, upcomingCare.map(l => h('div', { onclick: () => openLogForm(ptype(l.type), l), style: 'cursor:pointer' },
        h('span', { className: 'e', textContent: ptype(l.type).emoji }),
        h('div', { className: 'grow' }, h('strong', { textContent: `${ptype(l.type).label} due` }), h('div', { className: 'sm muted', textContent: l.note || '' })),
        h('span', { className: 'sm', textContent: fmtDate(l.due, { day: 'numeric', month: 'short' }) }))))) : null,
    h('div', { className: 'sec-head' }, h('h2', { textContent: 'Diary' })),
    days.length ? days.slice(0, diaryDays).map(d => {
      // Plain taps are counted; entries with details get their own line.
      const counts = {};
      d.logs.forEach(l => { counts[l.type] = (counts[l.type] || 0) + 1; });
      const detailed = d.logs.filter(l => l.note || l.photo || l.value || l.due);
      return h('section', { className: 'pet-day' },
        h('h3', { textContent: dayLabel(d.date) }),
        h('div', { className: 'card day-sum' },
          h('div', { className: 'tally' }, PET_TYPES.filter(t => counts[t.id]).map(t => h('span', { title: t.label, textContent: `${t.emoji}${counts[t.id] > 1 ? ' ×' + counts[t.id] : ''}` }))),
          detailed.map(l => h('div', { className: 'detail-row', onclick: () => openLogForm(ptype(l.type), l) },
            h('span', { className: 'e', textContent: ptype(l.type).emoji }),
            h('div', { className: 'grow' },
              h('strong', { textContent: ptype(l.type).label + (l.value ? ` · ${l.value} kg` : '') }),
              (l.note || l.due) && h('div', { className: 'sm muted', textContent: [l.note, l.due && `Next due ${fmtDate(l.due, { day: 'numeric', month: 'short' })}`].filter(Boolean).join(' · ') })),
            l.photo && h('img', { src: l.photo, alt: '' }),
            h('span', { className: 'sm muted', textContent: timeOf(l.at) })))));
    }).concat(days.length > diaryDays ? [h('button', { className: 'pill-btn', textContent: 'Show earlier days', onclick: () => { diaryDays += 14; renderPets(); } })] : []) :
      h('p', { className: 'sm muted', textContent: `Tap a button above to start ${pet.name}'s diary.` }),
  );
}

// Calendar: diary entries and due dates. Home countdown: upcoming care.
calendarSources.push(async () => {
  const [ps, logs] = await Promise.all([db.all('pets'), db.all('petlogs')]);
  const name = id => ps.find(p => p.id === id)?.name || 'Cat';
  const byDay = {};
  logs.forEach(l => (byDay[`${l.date}|${l.pet}`] ||= []).push(l));
  const entries = Object.values(byDay).map(ls => ({
    date: ls[0].date, color: PET_COLOR, sort: '2',
    render: () => h('div', { className: 'item', style: 'cursor:pointer', onclick: () => { activePet = ls[0].pet; openUs('cat'); } },
      h('i', { className: 'k', style: `background:${PET_COLOR}` }),
      h('div', { className: 't' }, h('span', { textContent: `🐾 ${name(ls[0].pet)}` }),
        h('span', { className: 's', textContent: ls.sort((a, b) => a.at - b.at).map(l => `${ptype(l.type).emoji} ${ptype(l.type).label}${l.value ? ' ' + l.value + 'kg' : ''}`).join(' · ') }))),
  }));
  const dues = logs.filter(l => l.due).map(l => ({
    date: l.due, color: PET_COLOR, sort: '0',
    render: () => h('div', { className: 'item' }, h('i', { className: 'k', style: `background:${PET_COLOR}` }),
      h('div', { className: 't' }, h('span', { textContent: `${ptype(l.type).emoji} ${ptype(l.type).label} due · ${name(l.pet)}` }), h('span', { className: 's', textContent: l.note || 'Reminder' }))),
  }));
  return [...entries, ...dues];
});
upcomingSources.push(async () => {
  const [ps, logs] = await Promise.all([db.all('pets'), db.all('petlogs')]);
  return logs.filter(l => l.due).map(l => ({ label: `${ps.find(p => p.id === l.pet)?.name || 'Cat'}'s ${ptype(l.type).label.toLowerCase()}`, date: l.due }));
});
renderers.push(renderPets);
