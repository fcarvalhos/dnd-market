// Shared helpers for the sections that sync with a Google Sheet (Experience, Factions).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10);

export function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.querySelector('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3800);
}

// DM keys live only in this browser, never in the code.
export const getKey = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
export function askKey(k, what) {
  const v = prompt(`DM key for ${what} (leave empty to clear):`, getKey(k));
  if (v === null) return false;
  try { localStorage.setItem(k, v.trim()); } catch { /* storage blocked */ }
  toast(v.trim() ? 'DM key saved in this browser' : 'DM key cleared', 'ok');
  return true;
}

// GET reads the sheet; POST (no content-type header, so no CORS preflight) writes to it.
export async function sheet(url, body) {
  const r = await fetch(url, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

export function shell(el) {
  el.innerHTML = `
    <div class="row-between tracker-bar">
      <span class="status" data-status>Consulting the sheet…</span>
      <button type="button" class="btn tiny ghost" data-act="key">🔑 DM key</button>
    </div>
    <nav class="subtabs" data-nav role="tablist"></nav>
    <div class="tracker-body" data-body></div>`;
}
export const tabs = (list, cur) => list.map(([k, n]) => `
  <button type="button" role="tab" aria-selected="${cur === k}" class="mode ${cur === k ? 'active' : ''}" data-act="tab" data-t="${k}">${n}</button>`).join('');
export function setStatus(el, text, cls = '') {
  const s = el.querySelector('[data-status]');
  s.textContent = text;
  s.className = `status ${cls}`;
}
export const typing = (el) => el.contains(document.activeElement) && document.activeElement.matches('input,select');
