// Experience section: roster, session XP and log, synced with the XP tracker's Google Sheet.
import { esc, toast, getKey, askKey, sheet, shell, tabs, setStatus, typing } from './sheet.js';

const API = 'https://script.google.com/macros/s/AKfycbyWjsIheFjOCT1d5oUDOtv7d6Y_FgzQ_l9Ee8gbHHuFYinsDzdZBOAJJhKFtBfsiSD7XA/exec';
const KEY = 'dmKey'; // same name the standalone XP tracker used, so a saved key carries over
const POLL_MS = 30000;
const LV = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
const ROLE = { player: 'Player', dm: 'DM', both: 'Player & DM' };

export const levelOf = (xp) => { let l = 1; for (let i = 0; i < 20; i++) if (xp >= LV[i]) l = i + 1; return l; };
export function progress(xp) {
  const level = levelOf(xp);
  if (level >= 20) return { level, pct: 100, toNext: 0, next: null };
  const a = LV[level - 1];
  const next = LV[level];
  return { level, pct: ((xp - a) / (next - a)) * 100, toNext: next - xp, next };
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const today = () => new Date().toLocaleDateString('sv-SE');

let el;
let S = { people: [], log: [], meta: {} };
let tab = 'roster';
let busy = false;
let last = null;
let loaded = false;
const sess = { dm: '', date: today(), note: '', sel: {}, same: '' };
const watchers = [];

/** Calls fn with the roster now (if loaded) and whenever it changes. */
export const onRoster = (fn) => { watchers.push(fn); if (loaded) fn(S.people); };
export const heroes = () => S.people.filter((p) => p.role !== 'dm');

function setState(s) {
  S = { people: [], log: [], meta: {}, ...s };
  loaded = true;
  watchers.forEach((fn) => fn(S.people));
}

export async function load() {
  try {
    setState(await sheet(API));
    setStatus(el, getKey(KEY) ? '● Synced with Google Sheets' : '● Synced with Google Sheets · enter the DM key to record changes', 'ok');
  } catch (e) {
    setStatus(el, `● Could not reach the sheet: ${e.message}`, 'bad');
  }
  if (!typing(el)) render();
}

async function run(action, data, msg) {
  if (busy) return null;
  busy = true;
  el.classList.add('busy');
  let j = null;
  try {
    j = await sheet(API, { key: getKey(KEY), action, ...data });
    setState(j.state);
    if (j.warnings?.length) toast(j.warnings.join(' | '), 'bad'); else if (msg) toast(msg, 'ok');
  } catch (e) {
    toast(e.message, 'bad');
  }
  busy = false;
  el.classList.remove('busy');
  render();
  return j;
}

// ---------- Views ----------

const lvTxt = (a, b) => (b > a ? `<span class="up">⬆ Level up! ${a} → ${b} (+${b - a})</span>`
  : b < a ? `<span class="down">⬇ Level ${a} → ${b}</span>` : `Level ${b}`);

function preview(p, d) {
  d = Math.round(+d) || 0;
  const to = Math.max(0, p.xp + d);
  const a = levelOf(p.xp);
  const b = levelOf(to);
  let h = `${fmt(p.xp)} → <b>${fmt(to)}</b> XP · ${lvTxt(a, b)}`;
  if (b === a) h += b < 20 ? ` · ${fmt(LV[b] - to)} XP to next` : ' (max)';
  return h;
}

const entry = (en) => `<p class="hint">${esc(en.date)} · DM: ${esc(en.dm)}${en.note ? ` · ${esc(en.note)}` : ''}</p>${
  en.changes.map((c) => `<div><b>${esc(c.name)}</b> ${c.delta > 0 ? '+' : ''}${fmt(c.delta)} XP (${fmt(c.from)} → ${fmt(c.to)}) ${lvTxt(c.lvFrom, c.lvTo)}</div>`).join('')}`;

function heroRow(p) {
  const del = `<button type="button" class="btn tiny danger" data-act="delp" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button>`;
  const head = (extra) => `<div class="hero-head"><b>${esc(p.name)}</b><span class="ab-tag">${ROLE[p.role] || 'Player'}</span><span class="grow"></span>${extra}${del}</div>`;
  if (p.role === 'dm') return `<li class="hero">${head('')}</li>`;
  const g = progress(p.xp);
  return `<li class="hero">${head(`<span class="hero-lv">Level ${g.level}</span>`)}
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(g.pct)}" aria-label="${esc(p.name)}: progress to the next level"><div class="meter-fill" style="width:${g.pct.toFixed(1)}%"></div></div>
    <small class="muted">${g.next ? `${fmt(p.xp)} / ${fmt(g.next)} XP · ${fmt(g.toNext)} to level ${g.level + 1}` : `${fmt(p.xp)} XP · max level`}</small></li>`;
}

function partySummary() {
  const lv = heroes().map((p) => levelOf(p.xp));
  if (!lv.length) return '';
  const avg = lv.reduce((a, b) => a + b, 0) / lv.length;
  const lo = Math.min(...lv);
  const hi = Math.max(...lv);
  return `<div class="search-info"><span>Adventurers <b>${lv.length}</b></span><span>Average level <b>${avg.toFixed(1)}</b></span><span>Levels <b>${lo === hi ? lo : `${lo}–${hi}`}</b></span></div>`;
}

function rosterView() {
  return `
    <section class="card"><h2><span class="glyph">✚</span> Register a hero or a Dungeon Master</h2>
      <div class="form-row">
        <label class="field">Name<input type="text" id="xp-name" maxlength="60" placeholder="Character or person" autocomplete="off"></label>
        <label class="field">Role<select id="xp-role"><option value="player">Player</option><option value="dm">DM</option><option value="both">Player &amp; DM</option></select></label>
        <label class="field">Starting level<select id="xp-level">${Array.from({ length: 20 }, (_, i) => `<option>${i + 1}</option>`).join('')}</select></label>
        <button type="button" class="btn gold" data-act="addp">Add to the roster</button>
      </div></section>
    <section class="card"><h2><span class="glyph">⚔</span> The Roster</h2>
      ${partySummary()}
      ${S.people.length ? `<ul class="hero-list">${S.people.map(heroRow).join('')}</ul>` : `<p class="hint">${loaded ? 'The roster is empty. Register your first adventurer above.' : 'Loading the roster…'}</p>`}
    </section>`;
}

function sessionView() {
  const dms = S.people.filter((p) => p.role !== 'player');
  const pls = S.people.filter((p) => p.role !== 'dm' && p.id !== sess.dm);
  let h = '';
  if (last) h += `<section class="card"><h2><span class="glyph">✓</span> Session recorded</h2>${entry(last)}</section>`;
  h += `<section class="card"><h2><span class="glyph">📅</span> Session details</h2><div class="form-row">
      <label class="field">Dungeon Master<select id="xp-dm"><option value="">— choose —</option>${dms.map((p) => `<option value="${esc(p.id)}"${p.id === sess.dm ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">Date<input type="date" id="xp-date" value="${esc(sess.date)}"></label>
      <label class="field">Note<input type="text" id="xp-note" maxlength="200" placeholder="Optional" value="${esc(sess.note)}"></label>
    </div></section>
    <section class="card"><h2><span class="glyph">✧</span> Players &amp; XP earned</h2>`;
  if (!pls.length) h += '<p class="hint">No players yet. Register them in the Roster tab.</p>';
  else {
    h += `<div class="form-row">
        <label class="field">Same XP for all (or for those ticked)<input id="xp-same" type="number" step="1" value="${esc(sess.same)}" placeholder="e.g. 450"></label>
        <button type="button" class="btn" data-act="applySame">Fill in XP</button>
        <button type="button" class="btn" data-act="selAll">Select all</button>
        <button type="button" class="btn" data-act="selNone">Clear</button>
      </div>${pls.map((p) => {
    const on = p.id in sess.sel;
    return `<div class="xp-row">
        <label class="check"><input type="checkbox" data-chk="${esc(p.id)}"${on ? ' checked' : ''}> <b>${esc(p.name)}</b></label>
        <small class="muted">Lv ${levelOf(p.xp)}</small>
        <input type="number" step="1" data-d="${esc(p.id)}" placeholder="XP ±" value="${on ? esc(sess.sel[p.id]) : ''}"${on ? '' : ' disabled'} aria-label="XP for ${esc(p.name)}">
        <div class="xp-pv" data-pv="${esc(p.id)}">${on ? preview(p, sess.sel[p.id]) : `${fmt(p.xp)} XP`}</div>
      </div>`;
  }).join('')}
      <div class="form-row end"><button type="button" class="btn gold" data-act="submit">Record session</button></div>`;
  }
  return `${h}</section>`;
}

function logView() {
  const url = S.meta?.logUrl || '';
  return `<section class="card"><h2><span class="glyph">📖</span> Recent sessions</h2>
    ${/^https:\/\/docs\.google\.com\//.test(url) ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">Open the full log in Google Drive ↗</a></p>` : ''}
    ${S.log.map((en) => `<div class="log-entry">${entry(en)}</div>`).join('') || '<p class="hint">No sessions recorded yet.</p>'}</section>`;
}

function render() {
  el.querySelector('[data-nav]').innerHTML = tabs([['roster', 'Roster'], ['session', 'Session XP'], ['log', 'Log']], tab);
  el.querySelector('[data-body]').innerHTML = { roster: rosterView, session: sessionView, log: logView }[tab]();
}

// ---------- Events ----------

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  const others = () => S.people.filter((p) => p.role !== 'dm' && p.id !== sess.dm);
  if (a === 'tab') { tab = b.dataset.t; render(); }
  else if (a === 'key') { if (askKey(KEY, 'the XP sheet')) load(); }
  else if (a === 'addp') {
    const n = el.querySelector('#xp-name').value.trim();
    if (!n) return toast('Enter a name first.', 'bad');
    await run('addPerson', { name: n, role: el.querySelector('#xp-role').value, level: el.querySelector('#xp-level').value }, `${n} registered`);
  } else if (a === 'delp') {
    if (confirm('Remove this person from the roster?')) { delete sess.sel[b.dataset.id]; await run('removePerson', { id: b.dataset.id }); }
  } else if (a === 'selAll') { others().forEach((p) => { if (!(p.id in sess.sel)) sess.sel[p.id] = sess.same; }); render(); }
  else if (a === 'selNone') { sess.sel = {}; render(); }
  else if (a === 'applySame') {
    if (sess.same === '') return toast('Type an XP amount first.', 'bad');
    const ids = Object.keys(sess.sel).length ? Object.keys(sess.sel) : others().map((p) => p.id);
    ids.forEach((id) => { sess.sel[id] = sess.same; });
    render();
  } else if (a === 'submit') {
    const entries = Object.entries(sess.sel).map(([id, d]) => ({ id, delta: Math.round(+d) || 0 })).filter((x) => x.delta);
    if (!sess.dm) return toast('Choose the DM first.', 'bad');
    if (!entries.length) return toast('Select players and enter XP.', 'bad');
    const j = await run('session', { dm: sess.dm, date: sess.date, note: sess.note, entries }, 'Session recorded');
    if (j) { last = S.log[0]; sess.sel = {}; sess.note = ''; render(); el.scrollIntoView({ behavior: 'smooth' }); }
  }
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.chk) { if (t.checked) sess.sel[t.dataset.chk] = sess.same; else delete sess.sel[t.dataset.chk]; render(); }
  else if (t.id === 'xp-dm') { sess.dm = t.value; delete sess.sel[t.value]; render(); }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.d) {
    sess.sel[t.dataset.d] = t.value;
    const p = S.people.find((x) => x.id === t.dataset.d);
    el.querySelector(`[data-pv="${CSS.escape(t.dataset.d)}"]`).innerHTML = preview(p, t.value);
  } else if (t.id === 'xp-same') sess.same = t.value;
  else if (t.id === 'xp-date') sess.date = t.value;
  else if (t.id === 'xp-note') sess.note = t.value;
}

export function mount(node) {
  el = node;
  shell(el);
  render();
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'xp-name') el.querySelector('[data-act=addp]').click(); });
  setInterval(() => { if (!el.hidden && !busy && !document.hidden) load(); }, POLL_MS);
  return load();
}
