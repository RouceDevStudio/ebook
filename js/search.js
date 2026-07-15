/* search.js — Búsqueda global: título, autor, ISBN, etiquetas, notas. */
import { settings, db } from './db.js';
import * as models from './models.js';

const $ = (id) => document.getElementById(id);

export function openSearch(App) {
  const ov = $('searchOverlay'); ov.hidden = false;
  const input = $('searchInput'); input.value = ''; input.focus();
  renderRecents(App);
  $('searchResults').innerHTML = '';
  input.oninput = () => run(App, input.value.trim());
  input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) { saveRecent(input.value.trim()); renderRecents(App); } };
}

function renderRecents(App) {
  const recents = settings.get('recentSearches') || [];
  const el = $('searchRecents');
  if (!recents.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="muted" style="font-size:12px;width:100%">Búsquedas recientes</span>` +
    recents.map((r) => `<button class="chip" data-r="${attr(r)}">${esc(r)}</button>`).join('') +
    `<button class="chip" data-clear>Borrar</button>`;
  el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { $('searchInput').value = b.dataset.r; run(App, b.dataset.r); });
  el.querySelector('[data-clear]').onclick = () => { settings.set('recentSearches', []); renderRecents(App); };
}
function saveRecent(q) {
  let r = settings.get('recentSearches') || [];
  r = [q, ...r.filter((x) => x !== q)].slice(0, 8);
  settings.set('recentSearches', r);
}

async function run(App, q) {
  const res = $('searchResults');
  if (!q) { res.innerHTML = ''; return; }
  const ql = q.toLowerCase();
  const books = App.state.books.filter((b) => !b.trashed);
  const byBook = books.filter((b) =>
    (b.title || '').toLowerCase().includes(ql) ||
    (b.author || '').toLowerCase().includes(ql) ||
    (b.series || '').toLowerCase().includes(ql) ||
    (b.isbn || '').toLowerCase().includes(ql) ||
    (b.publisher || '').toLowerCase().includes(ql) ||
    (b.tags || []).some((t) => t.toLowerCase().includes(ql)) ||
    (b.description || '').toLowerCase().includes(ql));
  // notas
  const allNotes = await db.all('notes');
  const noteHits = allNotes.filter((n) => (n.quote || '').toLowerCase().includes(ql) || (n.note || '').toLowerCase().includes(ql));

  let html = '';
  if (byBook.length) {
    html += `<div class="result-group-title">Libros (${byBook.length})</div>`;
    byBook.slice(0, 40).forEach((b) => {
      html += `<div class="list-item" data-open="${b.id}"><div class="lc" style="background:linear-gradient(135deg,#ff6f61,#e8564a)"></div>
        <div class="list-body"><h4>${mark(b.title, q)}</h4><p>${mark(b.author || '—', q)} · ${(b.format || '').toUpperCase()}</p></div></div>`;
    });
  }
  if (noteHits.length) {
    html += `<div class="result-group-title">En tus notas (${noteHits.length})</div>`;
    for (const n of noteHits.slice(0, 20)) {
      const b = books.find((x) => x.id === n.bookId);
      html += `<div class="list-item" data-open="${n.bookId}"><div class="lc" style="display:grid;place-items:center;background:var(--surface-2)">✍️</div>
        <div class="list-body"><h4>${mark(n.quote || n.note, q)}</h4><p>${esc(b ? b.title : '')}</p></div></div>`;
    }
  }
  if (!byBook.length && !noteHits.length) html = `<div class="empty"><div class="emoji">🔍</div><p>Sin resultados para «${esc(q)}»</p></div>`;
  res.innerHTML = html;
  res.querySelectorAll('[data-open]').forEach((el) => el.onclick = () => { saveRecent(q); $('searchOverlay').hidden = true; App.open(el.dataset.open); });
}

function mark(s = '', q) { const i = s.toLowerCase().indexOf(q.toLowerCase()); if (i < 0) return esc(s); return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length)); }
function esc(s = '') { return String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }
function attr(s = '') { return String(s).replace(/"/g, '&quot;'); }
