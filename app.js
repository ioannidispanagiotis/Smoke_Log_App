(() => {
'use strict';
const KEY = 'smk.v1';
const DEF = { limit: 10, packPrice: 0, packSize: 20, currency: '€', dayStart: 0, baseline: 0 };
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = load();
let tab = 'today', range = 7, sheetDay = null, histShown = 60, toastTimer = null;

function load() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r && Array.isArray(r.entries)) {
      return { entries: r.entries.filter(e => e && Number.isFinite(e.t)).sort((a, b) => a.t - b.t), settings: { ...DEF, ...(r.settings || {}) } };
    }
  } catch (e) {}
  return { entries: [], settings: { ...DEF } };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Could not save: storage unavailable'); }
}

/* ---------- dates ---------- */
const dateKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dayKey = t => dateKey(new Date(t - S.settings.dayStart * 3600000));
const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = keyToDate(k); d.setDate(d.getDate() + n); return dateKey(d); };
const todayKey = () => dayKey(Date.now());
const fmtTime = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
function daysBetween(a, b) { const out = []; for (let k = a; k <= b; k = addDays(k, 1)) out.push(k); return out; }
function dayLabel(k) {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, -1)) return 'Yesterday';
  return keyToDate(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function timeFor(k, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = keyToDate(k); d.setHours(h, m, 0, 0);
  if (h < S.settings.dayStart) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/* ---------- data ---------- */
function byDay() {
  const m = {};
  for (const e of S.entries) (m[dayKey(e.t)] ||= []).push(e);
  return m;
}
const entriesOn = k => byDay()[k] || [];
const firstDay = () => S.entries.length ? dayKey(S.entries[0].t) : null;
const cpc = () => S.settings.packSize > 0 ? S.settings.packPrice / S.settings.packSize : 0;
const money = n => (n < 0 ? '-' : '') + S.settings.currency + Math.abs(n).toFixed(2);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function addEntry(t) {
  S.entries.push({ id: newId(), t });
  S.entries.sort((a, b) => a.t - b.t);
  save();
}
function delEntry(id) { S.entries = S.entries.filter(e => e.id !== id); save(); }

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1m';
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
function avgGap(entries) {
  if (entries.length < 2) return null;
  let s = 0, n = 0;
  for (let i = 1; i < entries.length; i++) { s += entries[i].t - entries[i - 1].t; n++; }
  return s / n;
}

/* ---------- charts ---------- */
function barChart(items, limit, opts = {}) {
  const w = 340, h = opts.h || 170, pL = 24, pB = 20, pT = 10, pR = 4;
  const iw = w - pL - pR, ih = h - pB - pT;
  const max = Math.max(1, limit || 0, ...items.map(i => i.v));
  const bw = iw / items.length, gap = Math.min(4, bw * 0.25);
  const every = opts.every || 1;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">`;
  s += `<line class="grid" x1="${pL}" x2="${w - pR}" y1="${pT + ih}" y2="${pT + ih}"/>`;
  s += `<line class="grid" x1="${pL}" x2="${w - pR}" y1="${pT}" y2="${pT}"/>`;
  s += `<text x="${pL - 4}" y="${pT + 8}" text-anchor="end">${+max.toFixed(1)}</text><text x="${pL - 4}" y="${pT + ih}" text-anchor="end">0</text>`;
  items.forEach((it, i) => {
    const bh = it.v / max * ih, x = pL + i * bw + gap / 2;
    const over = limit > 0 && it.v > limit && !opts.noLimitColor;
    s += `<rect class="bar ${over ? 'over' : ''} ${opts.alt ? 'alt' : ''}" x="${x.toFixed(2)}" y="${(pT + ih - bh).toFixed(2)}" width="${Math.max(1, bw - gap).toFixed(2)}" height="${bh.toFixed(2)}" rx="${Math.min(3, bw / 3).toFixed(1)}"/>`;
    if (i % every === 0 && it.label) s += `<text x="${(x + (bw - gap) / 2).toFixed(2)}" y="${h - 5}" text-anchor="middle">${esc(it.label)}</text>`;
  });
  if (limit > 0 && !opts.noLimit) {
    const y = pT + ih - limit / max * ih;
    s += `<line class="lim" x1="${pL}" x2="${w - pR}" y1="${y}" y2="${y}"/>`;
  }
  return s + '</svg>';
}

/* ---------- views ---------- */
function renderToday() {
  const k = todayKey(), es = entriesOn(k), n = es.length, L = S.settings.limit;
  const pct = L > 0 ? n / L : 0;
  const state = L > 0 ? (n > L ? 'over' : pct >= 0.8 ? 'warn' : 'ok') : 'ok';
  const C = 2 * Math.PI * 84, dash = Math.min(pct, 1) * C;
  const lbl = L > 0 ? (n <= L ? `${L - n} left of ${L}` : `${n - L} over limit`) : 'today';
  const last = S.entries[S.entries.length - 1];
  const g = avgGap(es), c = cpc();
  return `<h1>Today</h1>
  <div class="ringwrap ${state}">
    <svg viewBox="0 0 200 200"><circle class="ring-bg" cx="100" cy="100" r="84"/><circle class="ring-fg" cx="100" cy="100" r="84" stroke-dasharray="${dash} ${C}"/></svg>
    <div class="ringtxt"><div class="big">${n}</div><div class="lbl">${lbl}</div></div>
  </div>
  <button class="logbtn" data-act="log">+1 Cigarette</button>
  <div class="row"><button class="btn" data-act="undo" ${n ? '' : 'disabled'}>Undo last</button><button class="btn" data-act="openDay" data-day="${k}">Edit today</button></div>
  <div class="grid" style="margin-top:12px">
    <div class="card"><div class="k">Since last</div><div class="v sm" id="since">${last ? ago(Date.now() - last.t) : '—'}</div><div class="sub">${last ? 'at ' + fmtTime(last.t) : 'nothing logged yet'}</div></div>
    <div class="card"><div class="k">Cost today</div><div class="v sm">${c > 0 ? money(n * c) : '—'}</div><div class="sub">${c > 0 ? money(c) + ' each' : 'set pack price in Settings'}</div></div>
    <div class="card"><div class="k">Avg gap today</div><div class="v sm">${g ? ago(g) : '—'}</div></div>
    <div class="card"><div class="k">Yesterday</div><div class="v sm">${entriesOn(addDays(k, -1)).length}</div></div>
  </div>
  ${n ? `<h2>Logged today</h2><div class="chips">${es.map(e => `<span class="chip">${fmtTime(e.t)}</span>`).join('')}</div>` : ''}`;
}

function rangeDays(n) {
  const today = todayKey(), first = firstDay();
  if (!first) return [];
  let start = n === 'all' ? first : addDays(today, -(n - 1));
  if (first > start) start = first;
  return daysBetween(start, today);
}

function renderStats() {
  const seg = `<div class="seg">${[7, 30, 90, 'all'].map(r => `<button data-act="range" data-r="${r}" class="${r === range ? 'on' : ''}">${r === 'all' ? 'All' : r + 'd'}</button>`).join('')}</div>`;
  const days = rangeDays(range);
  if (!days.length) return `<h1>Stats</h1>${seg}<div class="empty">No data yet. Log your first cigarette on the Today tab.</div>`;
  const map = byDay(), L = S.settings.limit, c = cpc();
  const counts = days.map(k => (map[k] || []).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const avg = total / days.length;
  const within = L > 0 ? counts.filter(x => x <= L).length : null;
  const best = Math.min(...counts), worst = Math.max(...counts);

  let streak = 0;
  if (L > 0) { for (let i = counts.length - 1; i >= 0 && counts[i] <= L; i--) streak++; }

  let delta = '—', deltaCls = '';
  if (range !== 'all') {
    const pStart = addDays(days[0], -range), pEnd = addDays(days[0], -1), first = firstDay();
    const pd = daysBetween(pStart < first ? first : pStart, pEnd);
    if (pd.length >= 3 && pStart <= pEnd && first <= pEnd) {
      const pavg = pd.reduce((a, k) => a + (map[k] || []).length, 0) / pd.length;
      if (pavg > 0) {
        const d = (avg - pavg) / pavg * 100;
        delta = (d > 0 ? '+' : '') + d.toFixed(0) + '%';
        deltaCls = d < 0 ? 'good' : d > 0 ? 'bad' : '';
      }
    }
  }

  const labelOf = (k, i) => {
    const d = keyToDate(k);
    return days.length <= 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.getDate() + '/' + (d.getMonth() + 1);
  };
  const every = days.length <= 7 ? 1 : Math.ceil(days.length / 6);
  const daily = barChart(days.map((k, i) => ({ v: counts[i], label: labelOf(k, i) })), L, { every });

  const hours = Array(24).fill(0);
  for (const k of days) for (const e of map[k] || []) hours[new Date(e.t).getHours()]++;
  const hourChart = barChart(hours.map((v, i) => ({ v, label: String(i) })), 0, { every: 3, h: 140, alt: true, noLimit: true });

  const wsum = Array(7).fill(0), wn = Array(7).fill(0);
  days.forEach((k, i) => { const wd = (keyToDate(k).getDay() + 6) % 7; wsum[wd] += counts[i]; wn[wd]++; });
  const wlabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const wk = barChart(wsum.map((s, i) => ({ v: wn[i] ? s / wn[i] : 0, label: wlabels[i] })), L, { h: 140 });

  const gaps = []; let gs = 0, gn = 0;
  for (const k of days) { const es = map[k] || []; for (let i = 1; i < es.length; i++) { gs += es[i].t - es[i - 1].t; gn++; } }
  const gapStr = gn ? ago(gs / gn) : '—';

  let moneyCards = '';
  if (c > 0) {
    let saved = '';
    if (S.settings.baseline > 0) {
      const sv = (S.settings.baseline * days.length - total) * c;
      saved = `<div class="card"><div class="k">vs baseline (${S.settings.baseline}/day)</div><div class="v sm ${sv >= 0 ? 'good' : 'bad'}">${sv >= 0 ? 'saved ' : 'extra '}${money(Math.abs(sv))}</div></div>`;
    }
    moneyCards = `<h2>Cost</h2><div class="grid">
      <div class="card"><div class="k">Spent (${range === 'all' ? 'all time' : 'period'})</div><div class="v sm">${money(total * c)}</div></div>
      <div class="card"><div class="k">Per day</div><div class="v sm">${money(avg * c)}</div></div>
      <div class="card"><div class="k">Projected / 30 days</div><div class="v sm">${money(avg * 30 * c)}</div></div>
      <div class="card"><div class="k">Packs used</div><div class="v sm">${(total / S.settings.packSize).toFixed(1)}</div></div>
      ${saved}</div>`;
  }

  return `<h1>Stats</h1>${seg}
  <div class="grid">
    <div class="card"><div class="k">Total</div><div class="v">${total}</div><div class="sub">${days.length} day${days.length > 1 ? 's' : ''}</div></div>
    <div class="card"><div class="k">Avg / day</div><div class="v">${avg.toFixed(1)}</div><div class="sub ${deltaCls}">${delta === '—' ? 'no prior period' : delta + ' vs prior'}</div></div>
    <div class="card"><div class="k">Days within limit</div><div class="v">${within === null ? '—' : within + '/' + days.length}</div></div>
    <div class="card"><div class="k">Current streak</div><div class="v">${L > 0 ? streak + 'd' : '—'}</div><div class="sub">days at or under limit</div></div>
    <div class="card"><div class="k">Best / worst day</div><div class="v sm">${best} / ${worst}</div></div>
    <div class="card"><div class="k">Avg gap</div><div class="v sm">${gapStr}</div></div>
  </div>
  <h2>Per day</h2><div class="card">${daily}</div>
  <h2>Time of day</h2><div class="card">${hourChart}</div>
  <h2>Average by weekday</h2><div class="card">${wk}</div>
  ${moneyCards}
  <p class="sub" style="margin-top:14px">Days before your first log are excluded. Days with no entries count as 0, so only skip logging when you actually didn't smoke.</p>`;
}

function renderHistory() {
  const first = firstDay();
  if (!first) return `<h1>History</h1><div class="empty">Nothing logged yet.</div>`;
  const map = byDay(), L = S.settings.limit, c = cpc();
  const all = daysBetween(first, todayKey()).reverse();
  const shown = all.slice(0, histShown);
  const rows = shown.map(k => {
    const n = (map[k] || []).length;
    const cls = L > 0 && n > L ? 'bad' : L > 0 && n === 0 ? 'good' : '';
    return `<button class="hrow" data-act="openDay" data-day="${k}"><span class="d">${dayLabel(k)}</span><span class="m">${c > 0 ? money(n * c) : ''}</span><span class="c ${cls}">${n}</span></button>`;
  }).join('');
  const more = all.length > shown.length ? `<button class="btn" style="width:100%" data-act="more">Show older (${all.length - shown.length} more)</button>` : '';
  return `<h1>History</h1>${rows}${more}`;
}

function renderSettings() {
  const s = S.settings;
  return `<h1>Settings</h1>
  <div class="card">
    <div class="field"><label>Daily limit (0 = no limit)</label><input type="number" inputmode="numeric" min="0" step="1" data-set="limit" value="${s.limit}"></div>
    <div class="field"><label>Pack price</label><input type="number" inputmode="decimal" min="0" step="0.01" data-set="packPrice" value="${s.packPrice}"></div>
    <div class="field"><label>Cigarettes per pack</label><input type="number" inputmode="numeric" min="1" step="1" data-set="packSize" value="${s.packSize}"></div>
    <div class="field"><label>Currency symbol</label><input type="text" maxlength="4" data-set="currency" value="${esc(s.currency)}"></div>
    <div class="field"><label>Baseline: cigarettes/day before you started reducing</label><input type="number" inputmode="decimal" min="0" step="0.5" data-set="baseline" value="${s.baseline}"><div class="hint">Optional. Used only for the "vs baseline" savings figure.</div></div>
    <div class="field" style="margin-bottom:0"><label>Day starts at (hour)</label>
      <select data-set="dayStart">${Array.from({ length: 13 }, (_, h) => `<option value="${h}" ${h === s.dayStart ? 'selected' : ''}>${pad(h)}:00${h === 0 ? ' (midnight)' : ''}</option>`).join('')}</select>
      <div class="hint">Set to e.g. 04:00 so a cigarette at 01:00 counts toward the previous day.</div></div>
  </div>
  <h2>Data (stored only on this device)</h2>
  <div class="row" style="margin-bottom:10px"><button class="btn" data-act="exportJson">Export backup</button><button class="btn" data-act="exportCsv">Export CSV</button></div>
  <div class="row"><button class="btn" data-act="importJson">Import backup</button><button class="btn danger" data-act="reset">Erase all</button></div>
  <p class="sub" style="margin-top:14px">${S.entries.length} entries stored. Export a backup occasionally: clearing Safari website data or deleting the home-screen app erases it.</p>`;
}

function renderSheet() {
  const el = $('#sheet');
  if (!sheetDay) { el.hidden = true; el.innerHTML = ''; return; }
  const es = entriesOn(sheetDay), now = new Date();
  el.hidden = false;
  el.innerHTML = `<div class="sheet" data-stop="1">
    <h3>${dayLabel(sheetDay)}</h3><div class="sub">${keyToDate(sheetDay).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${es.length} logged</div>
    <div style="margin:10px 0">${es.length ? es.map(e => `<div class="erow"><span>${fmtTime(e.t)}</span><button data-act="delEntry" data-id="${e.id}">Delete</button></div>`).join('') : '<div class="empty" style="padding:16px">No entries</div>'}</div>
    <div class="row"><input type="time" id="addTime" value="${pad(now.getHours())}:${pad(now.getMinutes())}"><button class="btn" data-act="addEntry" style="flex:0 0 auto;padding:12px 18px">Add</button></div>
    <button class="btn" data-act="closeSheet" style="width:100%;margin-top:12px">Done</button></div>`;
}

function render() {
  const v = $('#view');
  const y = window.scrollY;
  v.innerHTML = tab === 'today' ? renderToday() : tab === 'stats' ? renderStats() : tab === 'history' ? renderHistory() : renderSettings();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  renderSheet();
  window.scrollTo(0, y);
}

/* ---------- toast ---------- */
function toast(msg, undoId) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undoId ? `<button data-act="undoId" data-id="${undoId}">Undo</button>` : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

/* ---------- export / import ---------- */
async function shareOrDownload(name, text, type) {
  const file = new File([text], name, { type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function exportCsv() {
  const rows = ['date,time,day_bucket'];
  for (const e of S.entries) { const d = new Date(e.t); rows.push(`${dateKey(d)},${pad(d.getHours())}:${pad(d.getMinutes())},${dayKey(e.t)}`); }
  return rows.join('\n');
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  if (e.target.id === 'sheet') { sheetDay = null; renderSheet(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  switch (act) {
    case 'tab': tab = a.dataset.tab; window.scrollTo(0, 0); render(); break;
    case 'log': {
      const t = Date.now(); addEntry(t);
      const id = S.entries.find(x => x.t === t).id, n = entriesOn(todayKey()).length, L = S.settings.limit;
      let msg = `Logged ${fmtTime(t)}`;
      if (L > 0 && n === L) msg += ' · limit reached';
      else if (L > 0 && n > L) msg += ` · ${n - L} over limit`;
      render(); toast(msg, id); break;
    }
    case 'undo': { const es = entriesOn(todayKey()); if (es.length) { delEntry(es[es.length - 1].id); render(); toast('Removed last entry'); } break; }
    case 'undoId': delEntry(a.dataset.id); $('#toast').hidden = true; render(); break;
    case 'range': range = a.dataset.r === 'all' ? 'all' : Number(a.dataset.r); render(); break;
    case 'openDay': sheetDay = a.dataset.day; renderSheet(); break;
    case 'closeSheet': sheetDay = null; render(); break;
    case 'delEntry': delEntry(a.dataset.id); render(); break;
    case 'addEntry': {
      const v = $('#addTime').value;
      if (!v) { toast('Pick a time'); break; }
      const t = timeFor(sheetDay, v);
      if (t > Date.now() + 60000) { toast('That time is in the future'); break; }
      addEntry(t); render(); break;
    }
    case 'more': histShown += 60; render(); break;
    case 'exportJson': shareOrDownload(`smoke-log-${dateKey(new Date())}.json`, JSON.stringify(S, null, 2), 'application/json'); break;
    case 'exportCsv': shareOrDownload(`smoke-log-${dateKey(new Date())}.csv`, exportCsv(), 'text/csv'); break;
    case 'importJson': $('#importFile').click(); break;
    case 'reset':
      if (confirm('Erase ALL logged cigarettes and settings? This cannot be undone.') && confirm('Really erase everything?')) {
        S = { entries: [], settings: { ...DEF } }; save(); render(); toast('All data erased');
      }
      break;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'importFile') {
    const f = el.files[0]; if (!f) return;
    f.text().then(txt => {
      try {
        const r = JSON.parse(txt);
        if (!r || !Array.isArray(r.entries) || r.entries.some(x => !x || !Number.isFinite(x.t))) throw new Error('bad format');
        if (!confirm(`Replace current data with ${r.entries.length} entries from this backup?`)) return;
        S = { entries: r.entries.map(x => ({ id: x.id || newId(), t: x.t })).sort((a, b) => a.t - b.t), settings: { ...DEF, ...(r.settings || {}) } };
        save(); render(); toast('Backup imported');
      } catch (err) { toast('Import failed: not a valid backup file'); }
      el.value = '';
    });
    return;
  }
  const key = el.dataset && el.dataset.set;
  if (!key) return;
  let v = el.value;
  if (key === 'currency') v = v.trim() || '€';
  else {
    v = parseFloat(v);
    if (!Number.isFinite(v) || v < 0) { toast('Invalid number'); render(); return; }
    if (key === 'limit' || key === 'packSize' || key === 'dayStart') v = Math.round(v);
    if (key === 'packSize' && v < 1) { toast('Pack size must be at least 1'); render(); return; }
    if (key === 'dayStart' && v > 12) v = 12;
  }
  S.settings[key] = v; save(); render();
});

setInterval(() => {
  const el = $('#since');
  if (el && S.entries.length) el.textContent = ago(Date.now() - S.entries[S.entries.length - 1].t);
}, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheetDay && tab === 'today') render(); });

try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
})();
