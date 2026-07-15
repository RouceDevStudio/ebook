/* coralview.js — Panel de Coral: bibliotecario con IA.
   Saludo contextual, organización automática, sugerencias
   de continuación, detección de duplicados y enriquecimiento. */
import * as models from './models.js';
import { coral } from './coral.js';
import { settings } from './db.js';
import { storage } from './storage.js';
import { toast } from './toast.js';
import { fetchCoverBlob } from './covers.js';

export async function render(container, App) {
  const books = App.state.books.filter((b) => !b.trashed);
  const stats = await models.computeStats();
  const st = coral.status();

  // libro para continuar
  const reading = books.filter((b) => b.status === 'reading' && b.lastOpenedAt).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const cont = reading[0];
  const contProg = cont ? await models.getProgress(cont.id) : null;

  container.innerHTML = `
    <div class="coral-hero">
      <h2>Coral</h2>
      <p>${coral.greeting(stats, cont)}</p>
    </div>
    <div style="height:14px"></div>
    <div class="coral-say">
      <div class="av"><svg viewBox="0 0 24 24"><path d="M12 3c4.5 0 8 3 8 7 0 2.5-1.6 4-3 5-1 .7-1 2-1 3H8c0-1 0-2.3-1-3-1.4-1-3-2.5-3-5 0-4 3.5-7 8-7z"/></svg></div>
      <div class="txt"><b>Estado:</b> <span class="${st.level==='local'?'offline-dot':'online-dot'} online-dot" style="${st.level==='local'?'background:#e5a23d':''}"></span>${st.label}.
      ${st.level==='brain' ? 'Estoy conectado a tu cerebro Coral (Nexus) y completo metadatos con IA.' : st.level==='online' ? 'Uso catálogos web para completar datos y carátulas.' : 'Sin conexión, organizo con heurísticas locales. Todo funciona igual.'}</div>
    </div>`;

  if (cont) {
    const pct = Math.round((contProg.percent || 0) * 100);
    const c = document.createElement('div'); c.className = 'card'; c.style.marginTop = '14px';
    c.innerHTML = `<div class="section-title" style="margin-top:0">Seguir leyendo</div>
      <div class="list-item" style="padding:0"><div class="lc" id="_cc"></div>
      <div class="list-body"><h4>${esc(cont.title)}</h4><p>${esc(cont.author || '')}</p>
      <div class="lp" style="max-width:none"><i style="width:${pct}%"></i></div>
      <p style="margin-top:8px">${esc(coral.insight(cont, contProg, stats))}</p></div></div>
      <button class="btn block" id="_contBtn" style="margin-top:12px">Continuar · ${pct}%</button>`;
    container.appendChild(c);
    storage.getCover(cont.id).then((b) => { if (b) document.getElementById('_cc').innerHTML = `<img src="${URL.createObjectURL(b)}">`; });
    document.getElementById('_contBtn').onclick = () => App.open(cont.id);
  }

  // Organización automática
  const groups = coral.organize(books);
  const org = document.createElement('div');
  org.innerHTML = `<div class="section-title">Organizado por Coral</div>`;
  const grid = document.createElement('div'); grid.className = 'stat-grid';
  Object.entries(groups).forEach(([k, g]) => {
    if (!g.books.length) return;
    const t = document.createElement('div'); t.className = 'stat-tile'; t.style.cursor = 'pointer';
    t.innerHTML = `<div class="val">${g.books.length}</div><div class="lbl">${g.label}</div>`;
    t.onclick = () => App.go('library', { filter: { reading:'reading', unread:'unread', finished:'finished', abandoned:'abandoned', favorite:'favorite' }[k] || 'all' });
    grid.appendChild(t);
  });
  org.appendChild(grid);
  container.appendChild(org);

  // Acciones del bibliotecario
  const actions = document.createElement('div');
  actions.innerHTML = `<div class="section-title">El bibliotecario puede…</div>`;
  const list = document.createElement('div'); list.className = 'card';
  list.innerHTML = `<div class="menu-list">
    <button data-a="enrich"><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/></svg>Completar metadatos y carátulas de todos</button>
    <button data-a="dupes"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="12" height="12" rx="2"/><rect x="8" y="8" width="12" height="12" rx="2"/></svg>Buscar duplicados</button>
    <button data-a="connect"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/></svg>Conectar mi cerebro Coral (Nexus)</button>
  </div>`;
  actions.appendChild(list);
  container.appendChild(actions);
  container.insertAdjacentHTML('beforeend', '<div style="height:24px"></div>');

  list.querySelector('[data-a="enrich"]').onclick = () => enrichAll(App);
  list.querySelector('[data-a="dupes"]').onclick = () => findDupes(App, books);
  list.querySelector('[data-a="connect"]').onclick = () => App.go('settings');
}

async function enrichAll(App) {
  const books = App.state.books.filter((b) => !b.trashed);
  const t = toast(`Coral trabajando 0/${books.length}…`, { duration: 600000, icon: '<div class="spinner"></div>' });
  let done = 0, filled = 0;
  for (const b of books) {
    t.querySelector('span').textContent = `Coral trabajando ${++done}/${books.length}…`;
    try {
      const res = await coral.enrich(b, {});
      const bk = await models.getBook(b.id);
      for (const [k, v] of Object.entries(res.fields || {})) { if (k !== 'suggestedStatus' && v && !bk[k]) { bk[k] = v; filled++; } }
      bk.coralEnriched = true;
      if (res.coverUrl && bk.coverType === 'generated' && settings.get('autoCovers')) { const blob = await fetchCoverBlob(res.coverUrl); if (blob) { await storage.saveCover(b.id, blob); bk.coverType = 'image'; } }
      await models.saveBook(bk);
    } catch (_) {}
  }
  t.remove();
  await App.refresh();
  toast(`Coral completó ${filled} dato(s) en ${books.length} libro(s)`);
  App.render();
}

async function findDupes(App, books) {
  const map = {};
  books.forEach((b) => { const key = (b.title || '').toLowerCase().trim() + '|' + (b.author || '').toLowerCase().trim(); (map[key] = map[key] || []).push(b); });
  const dupes = Object.values(map).filter((a) => a.length > 1);
  if (!dupes.length) return toast('No encontré duplicados 🎉');
  const html = dupes.map((group) => `<div class="note-card"><b>${esc(group[0].title)}</b><div class="n">${group.length} copias · ${esc(group[0].author || '')}</div></div>`).join('');
  App.sheet(`<h3>Posibles duplicados</h3><p class="sub">${dupes.length} grupo(s). Revísalos y envía a la papelera los que sobren.</p>${html}<button class="btn ghost block" id="_gotoLib">Ir a la biblioteca</button>`);
  document.getElementById('_gotoLib').onclick = () => { App.closeModal(); App.go('library'); };
}

function esc(s = '') { return String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }
