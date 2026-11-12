// Factions section: reputation per adventurer, faction relations with ripple, synced with the faction tracker's Google Sheet.
import { esc, uid, toast, getKey, askKey, sheet, shell, tabs, setStatus, typing } from './sheet.js';
import { load as loadRoster, heroes } from './xp.js';

const API = 'https://script.google.com/macros/s/AKfycbxuioNirDUGmwh9j8lHOlqtgcKzh6zDkYvqOmv9v-aMg1QleInnCLcLnM8EZ19DWjvV5A/exec';
const KEY = 'factionKey';
const POLL_MS = 30000;
const RELS = ['n', 'f', 'h'];
const SYM = { n: '—', f: '🤝', h: '⚔' };
const REL_NAME = { n: 'indifferent', f: 'friendly', h: 'hostile' };

const rk = (a, b) => [a, b].sort().join('|');
export const tier = (v) => (v >= 75 ? 'Exalted' : v >= 40 ? 'Honored' : v >= 10 ? 'Friendly' : v > -10 ? 'Neutral' : v > -40 ? 'Unfriendly' : v > -75 ? 'Hostile' : 'Hated');
const clamp = (v) => Math.max(-100, Math.min(100, v));

function defaults() {
  const factions = [['harpers', 'The Harpers', '🌙'], ['zhent', 'The Zhentarim', '🐍'], ['alliance', "Lords' Alliance", '👑'], ['enclave', 'Emerald Enclave', '🌿'], ['gauntlet', 'Order of the Gauntlet', '🛡']]
    .map(([id, name, icon]) => ({ id, name, icon }));
  return {
    factions, players: [], ratio: 50, log: [],
    relations: {
      [rk('harpers', 'zhent')]: 'h', [rk('harpers', 'alliance')]: 'f', [rk('harpers', 'enclave')]: 'f',
      [rk('zhent', 'gauntlet')]: 'h', [rk('zhent', 'alliance')]: 'h', [rk('alliance', 'gauntlet')]: 'f',
    },
  };
}

// The sheet hands numbers back as text ("100"), and "100" + 10 is "10010", which clamps to 100.
export function normalize(s) {
  s.ratio = Number(s.ratio) || 0;
  for (const p of s.players) {
    p.rep = Object.fromEntries(Object.entries(p.rep || {}).map(([k, v]) => [k, clamp(Number(v) || 0)]));
  }
  return s;
}

let el;
let S = defaults();
let tab = 'rep';
let dirty = false;
let saving = false;
const rel = (a, b) => S.relations[rk(a, b)] || 'n';
const canEdit = () => !!getKey(KEY);
const off = () => (canEdit() ? '' : ' disabled title="Enter the DM key to edit"');

async function load() {
  try {
    const d = await sheet(API);
    if (d?.factions) S = normalize({ ...defaults(), ...d });
    setStatus(el, canEdit() ? '● Synced with the Google Sheet' : '● Synced with the Google Sheet · read-only until you enter the DM key', 'ok');
  } catch (e) {
    setStatus(el, `● Could not reach the sheet: ${e.message}`, 'bad');
  }
  if (!typing(el)) render();
}

async function save() {
  dirty = true;
  saving = true;
  setStatus(el, 'Saving…');
  try {
    await sheet(API, { key: getKey(KEY), state: S });
    setStatus(el, '● Saved to the Google Sheet', 'ok');
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'bad');
    saving = false;
    dirty = false;
    return load(); // drop the change the sheet refused
  }
  saving = false;
  dirty = false;
}

function adjust(pid, fid, delta) {
  const p = S.players.find((x) => x.id === pid);
  const f = S.factions.find((x) => x.id === fid);
  if (!p || !f) return;
  p.rep[fid] = clamp((p.rep[fid] || 0) + delta);
  const eff = [];
  for (const g of S.factions) {
    const r = g.id === fid ? 'n' : rel(fid, g.id);
    if (r === 'n') continue;
    const d = delta * (S.ratio / 100) * (r === 'f' ? 1 : -1);
    p.rep[g.id] = clamp((p.rep[g.id] || 0) + d);
    eff.push(`${g.name} ${d > 0 ? '+' : ''}${+d.toFixed(1)}`);
  }
  S.log.unshift({ t: Date.now(), p: p.name, f: f.name, d: delta, eff });
  S.log = S.log.slice(0, 200);
  save();
  render();
}

// ---------- Views ----------

function repView() {
  if (!S.players.length) return '<section class="card"><h2><span class="glyph">⚜</span> No heroes yet</h2><p class="hint">Add the first adventurer in the “Company” tab.</p></section>';
  return `<div class="rep-grid">${S.players.map((p) => `<section class="card"><h2><span class="glyph">⚜</span> ${esc(p.name)}</h2>${S.factions.map((f) => {
    const v = p.rep[f.id] || 0;
    return `<div class="rep-row">
        <div><b>${esc(f.icon)} ${esc(f.name)}</b> <small class="muted">${tier(v)}</small></div>
        <div class="rep-btns">${[-10, -5, -1, 1, 5, 10].map((d) => `<button type="button" class="btn tiny" data-act="adj" data-p="${esc(p.id)}" data-f="${esc(f.id)}" data-d="${d}" aria-label="${d > 0 ? 'Raise' : 'Lower'} ${esc(f.name)} by ${Math.abs(d)}"${off()}>${d > 0 ? '+' : ''}${d}</button>`).join('')}<span class="rep-val">${Math.round(v)}</span></div>
        <div class="rep-bar"><div class="rep-fill ${v >= 0 ? 'pos' : 'neg'}" style="width:${Math.abs(v) / 2}%"></div></div>
      </div>`;
  }).join('')}</section>`).join('')}</div>`;
}

function factionView() {
  const F = S.factions;
  const head = `<tr><th></th>${F.map((f) => `<th>${esc(f.icon)}<br>${esc(f.name)}</th>`).join('')}</tr>`;
  const body = F.map((a) => `<tr><th class="rel-name">${esc(a.icon)} ${esc(a.name)} <button type="button" class="btn tiny danger" data-act="delf" data-f="${esc(a.id)}" aria-label="Remove ${esc(a.name)}"${off()}>✕</button></th>${
    F.map((b) => (a.id === b.id ? '<td class="self"></td>'
      : `<td><button type="button" class="rel-btn ${rel(a.id, b.id)}" data-act="rel" data-a="${esc(a.id)}" data-b="${esc(b.id)}" aria-label="${esc(a.name)} and ${esc(b.name)}: ${REL_NAME[rel(a.id, b.id)]}. Click to change"${off()}>${SYM[rel(a.id, b.id)]}</button></td>`)).join('')}</tr>`).join('');
  return `<section class="card"><h2><span class="glyph">⚖</span> Relations between factions</h2>
      <p class="hint">Click a cell to cycle: <b>—</b> indifferent → <b>🤝</b> friendly → <b>⚔</b> hostile. Friends share a rise in standing; foes lose it.</p>
      <div class="scroll"><table class="rel-table">${head}${body}</table></div>
      <label class="field inline ratio">Ripple strength <input id="fa-ratio" type="range" min="0" max="100" step="5" value="${S.ratio}"${off()}> <b id="fa-rv">${S.ratio}%</b></label>
    </section>
    <section class="card"><h2><span class="glyph">✚</span> Add a faction</h2><div class="form-row">
      <label class="field icon">Icon<input type="text" id="fa-icon" maxlength="4" value="🏰"></label>
      <label class="field">Faction name<input type="text" id="fa-name" maxlength="60" autocomplete="off"></label>
      <button type="button" class="btn gold" data-act="addf"${off()}>Add faction</button>
    </div></section>`;
}

function companyView() {
  return `<section class="card"><h2><span class="glyph">⚔</span> The Company</h2>
    ${S.players.length ? `<ul class="hero-list">${S.players.map((p) => `<li class="hero"><div class="hero-head"><b>${esc(p.name)}</b><span class="grow"></span><button type="button" class="btn tiny danger" data-act="delp" data-p="${esc(p.id)}" aria-label="Remove ${esc(p.name)}"${off()}>✕</button></div></li>`).join('')}</ul>` : '<p class="hint">No adventurers have signed the roll.</p>'}
    <div class="form-row">
      <label class="field">Adventurer name<input type="text" id="fa-pname" maxlength="40" list="roster-names" autocomplete="off"></label>
      <button type="button" class="btn gold" data-act="addp"${off()}>Add to the roll</button>
      <button type="button" class="btn" data-act="import"${off()}>Import from the XP roster</button>
    </div>
    <p class="hint">Importing adds every player from the Experience roster who isn't in the Company yet.</p></section>`;
}

function logView() {
  return `<section class="card"><h2><span class="glyph">📖</span> Chronicle</h2>${S.log.map((l) => `<div class="log-entry"><b>${esc(l.p)}</b> ${l.d > 0 ? 'gained' : 'lost'} ${Math.abs(l.d)} with <b>${esc(l.f)}</b>
    ${l.eff?.length ? `<div class="muted">Ripples: ${l.eff.map(esc).join(', ')}</div>` : ''}<small class="muted">${new Date(l.t).toLocaleString()}</small></div>`).join('') || '<p class="hint">Nothing recorded yet.</p>'}</section>`;
}

function render() {
  el.querySelector('[data-nav]').innerHTML = tabs([['rep', 'Reputation'], ['fac', 'Factions'], ['pl', 'Company'], ['log', 'Chronicle']], tab);
  el.querySelector('[data-body]').innerHTML = { rep: repView, fac: factionView, pl: companyView, log: logView }[tab]();
}

// ---------- Events ----------

const newPlayer = (name) => ({ id: uid(), name, rep: Object.fromEntries(S.factions.map((f) => [f.id, 0])) });

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = b.dataset;
  if (d.act === 'tab') { tab = d.t; render(); return; }
  if (d.act === 'key') { if (askKey(KEY, 'the faction sheet')) load(); return; }
  if (!canEdit()) return;
  if (d.act === 'adj') adjust(d.p, d.f, +d.d);
  else if (d.act === 'rel') { S.relations[rk(d.a, d.b)] = RELS[(RELS.indexOf(rel(d.a, d.b)) + 1) % 3]; save(); render(); }
  else if (d.act === 'addp') {
    const n = el.querySelector('#fa-pname').value.trim();
    if (!n) return;
    S.players.push(newPlayer(n)); save(); render();
  } else if (d.act === 'import') {
    await loadRoster();
    const have = new Set(S.players.map((p) => p.name.toLowerCase()));
    const fresh = heroes().filter((p) => !have.has(p.name.toLowerCase()));
    if (!fresh.length) return toast('Everyone in the XP roster is already in the Company.');
    fresh.forEach((p) => S.players.push(newPlayer(p.name)));
    save(); render();
    toast(`Added ${fresh.map((p) => p.name).join(', ')}`, 'ok');
  } else if (d.act === 'addf') {
    const n = el.querySelector('#fa-name').value.trim();
    if (!n) return;
    S.factions.push({ id: uid(), name: n, icon: el.querySelector('#fa-icon').value || '🏰' }); save(); render();
  } else if (d.act === 'delp') {
    if (confirm('Remove this player?')) { S.players = S.players.filter((p) => p.id !== d.p); save(); render(); }
  } else if (d.act === 'delf') {
    if (confirm('Remove this faction and its relations?')) {
      S.factions = S.factions.filter((f) => f.id !== d.f);
      S.players.forEach((p) => delete p.rep[d.f]);
      Object.keys(S.relations).forEach((k) => k.split('|').includes(d.f) && delete S.relations[k]);
      save(); render();
    }
  }
}

export function mount(node) {
  el = node;
  shell(el);
  render();
  el.addEventListener('click', onClick);
  el.addEventListener('input', (e) => { if (e.target.id === 'fa-ratio') { S.ratio = +e.target.value; el.querySelector('#fa-rv').textContent = `${S.ratio}%`; } });
  el.addEventListener('change', (e) => { if (e.target.id === 'fa-ratio') save(); });
  el.addEventListener('keydown', (e) => {
    const act = e.key !== 'Enter' ? null : e.target.id === 'fa-pname' ? 'addp' : e.target.id === 'fa-name' ? 'addf' : null;
    if (act) el.querySelector(`[data-act=${act}]`).click();
  });
  setInterval(() => { if (!el.hidden && !dirty && !saving && !document.hidden && !typing(el)) load(); }, POLL_MS);
  return load();
}
