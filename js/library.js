/* ══════════════════════════════════════════════════
   library.js — Vista Biblioteca: cuadrícula, lista y
   estantería; orden, chips, menú contextual, editor de
   metadatos y cambio de portada.
   ══════════════════════════════════════════════════ */
import * as models from './models.js';
import { storage } from './storage.js';
import { settings } from './db.js';
import { paletteFor, generateCoverBlob, searchOnline, fetchCoverBlob } from './covers.js';
import { coral } from './coral.js';
import { toast, haptic } from './toast.js';
import { formatLabel } from './parsers/index.js';

const coverURLs = new Map();
async function coverUrl(book) {
  if (coverURLs.has(book.id)) return coverURLs.get(book.id);
  const blob = await storage.getCover(book.id);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  coverURLs.set(book.id, u);
  return u;
}
export function invalidateCover(id) { if (coverURLs.has(id)) { URL.revokeObjectURL(coverURLs.get(id)); coverURLs.delete(id); } }

const io = new IntersectionObserver((entries, obs) => {
  entries.forEach(async (e) => {
    if (!e.isIntersecting) return;
    const el = e.target; obs.unobserve(el);
    const book = el._book;
    const u = await coverUrl(book);
    if (u) { const img = new Image(); img.onload = () => { el.style.backgroundImage = ''; el.innerHTML = ''; img.className = ''; el.appendChild(img); el.appendChild(el._overlay); }; img.src = u; }
  });
}, { rootMargin: '200px' });

function coverEl(book, withOverlay = true) {
  const wrap = document.createElement('div');
  wrap.className = 'book-cover';
  const [c1, c2] = paletteFor(book.title);
  wrap.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
  const overlay = document.createElement('div');
  if (withOverlay) {
    let ov = '';
    if (book.favorite) ov += `<div class="book-fav"><svg viewBox="0 0 24 24"><path d="M12 21l-1.5-1.3C5 14.7 2 12 2 8.5A4.5 4.5 0 0112 5a4.5 4.5 0 0110 3.5c0 3.5-3 6.2-8.5 11.2z"/></svg></div>`;
    ov += `<div class="book-badge">${formatLabel(book.format)}</div>`;
    overlay.innerHTML = ov;
  }
  wrap._overlay = overlay;
  wrap._book = book;
  wrap.appendChild(overlay);
  io.observe(wrap);
  return wrap;
}

async function progressOf(book) { return models.getProgress(book.id); }

export async function render(container, App) {
  const filter = App.state.filter;

  // Papelera
  if (filter === 'trash') return renderTrash(container, App);
  if (filter === 'hidden') return renderHidden(container, App);

  let books = App.visibleBooks();
  // Colección
  if (filter && filter.startsWith('coll:')) {
    const coll = (await models.allCollections()).find((c) => c.id === filter.slice(5));
    const ids = new Set(coll ? coll.bookIds : []);
    books = App.state.books.filter((b) => !b.trashed && ids.has(b.id));
  }

  // Chips de filtro + orden
  const chips = document.createElement('div');
  chips.className = 'chiprow';
  const chipDefs = [
    ['all', 'Todos'], ['reading', 'Leyendo'], ['unread', 'Pendientes'],
    ['finished', 'Terminados'], ['favorite', 'Favoritos'], ['abandoned', 'Abandonados'],
  ];
  chips.innerHTML = chipDefs.map(([k, l]) =>
    `<button class="chip ${filter === k ? 'is-active' : ''}" data-f="${k}">${l}</button>`).join('') +
    `<button class="chip" data-sort="1"><svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px"><path d="M3 6h18M6 12h12M9 18h6"/></svg> Ordenar</button>`;
  container.appendChild(chips);
  chips.querySelectorAll('[data-f]').forEach((c) => c.onclick = () => { haptic(); App.go('library', { filter: c.dataset.f }); });
  chips.querySelector('[data-sort]').onclick = () => openSortSheet(App);

  if (!books.length) {
    container.appendChild(emptyState(App, filter));
    return;
  }

  const wrap = document.createElement('div');
  const mode = App.state.view3;
  if (mode === 'grid') { wrap.className = 'lib-grid'; }
  else if (mode === 'list') { wrap.className = 'lib-list'; }
  else { wrap.className = 'shelf'; }

  for (const book of books) {
    const p = await progressOf(book);
    const pct = Math.round((p.percent || 0) * 100);
    if (mode === 'list') wrap.appendChild(listItem(book, pct, App));
    else wrap.appendChild(gridItem(book, pct, App, mode));
  }
  container.appendChild(wrap);
}

function gridItem(book, pct, App, mode) {
  const el = document.createElement('div');
  el.className = 'book';
  const cover = coverEl(book);
  if (pct > 0 && pct < 100) { const pr = document.createElement('div'); pr.className = 'prog'; pr.innerHTML = `<i style="width:${pct}%"></i>`; cover._overlay.appendChild(pr); }
  el.appendChild(cover);
  if (mode !== 'shelf') {
    el.insertAdjacentHTML('beforeend',
      `<div class="book-meta"><p class="book-title">${esc(book.title)}</p><p class="book-author">${esc(book.author || '—')}</p></div>`);
  }
  bindOpen(el, book, App);
  return el;
}

function listItem(book, pct, App) {
  const el = document.createElement('div');
  el.className = 'list-item';
  el.innerHTML = `<div class="lc"></div>
    <div class="list-body"><h4>${esc(book.title)}</h4><p>${esc(book.author || '—')} · ${formatLabel(book.format)}${book.pages ? ' · ' + book.pages + ' pág' : ''}</p>
    ${pct > 0 ? `<div class="lp"><i style="width:${pct}%"></i></div>` : ''}</div>
    <button class="icon-btn" data-menu><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>`;
  const lc = el.querySelector('.lc');
  coverUrl(book).then((u) => { if (u) lc.innerHTML = `<img src="${u}">`; else { const [c1, c2] = paletteFor(book.title); lc.style.background = `linear-gradient(135deg,${c1},${c2})`; } });
  el.querySelector('[data-menu]').onclick = (e) => { e.stopPropagation(); openBookMenu(book, App); };
  el.onclick = () => App.open(book.id);
  return el;
}

function bindOpen(el, book, App) {
  let timer = null, longPressed = false;
  const start = () => { longPressed = false; timer = setTimeout(() => { longPressed = true; haptic(12); openBookMenu(book, App); }, 480); };
  const cancel = () => clearTimeout(timer);
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel);
  el.addEventListener('touchmove', cancel);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); openBookMenu(book, App); });
  el.addEventListener('click', () => { if (!longPressed) App.open(book.id); });
}

function emptyState(App, filter) {
  const el = document.createElement('div');
  el.className = 'empty';
  const msgs = {
    all: ['📚', 'Tu biblioteca está vacía', 'Importa tus libros y Coral los ordenará, buscará sus carátulas y completará sus datos.'],
    reading: ['📖', 'No estás leyendo nada ahora', 'Abre un libro y aparecerá aquí, justo donde lo dejaste.'],
    finished: ['✅', 'Aún no terminas ningún libro', 'Cuando acabes uno, vivirá aquí como un trofeo.'],
    favorite: ['❤️', 'Sin favoritos todavía', 'Marca con corazón los libros que amas.'],
    unread: ['📕', 'Nada pendiente', 'Los libros por empezar aparecen aquí.'],
    abandoned: ['🌙', 'Ninguno abandonado', 'Está bien dejar reposar un libro.'],
  };
  const [emoji, h, p] = msgs[filter] || msgs.all;
  el.innerHTML = `<div class="emoji">${emoji}</div><h3>${h}</h3><p>${p}</p>`;
  const btn = document.createElement('button');
  btn.className = 'btn'; btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Añadir libros';
  btn.onclick = () => App.openAddSheet();
  el.appendChild(btn);
  return el;
}

/* ── Menú contextual del libro ── */
async function openBookMenu(book, App) {
  const p = await progressOf(book);
  const pct = Math.round((p.percent || 0) * 100);
  App.sheet(`
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:6px">
      <div class="lc" id="_mc" style="width:56px;height:84px;border-radius:8px;overflow:hidden;flex:0 0 auto"></div>
      <div style="min-width:0"><h3 style="font-size:17px;margin:0 0 2px">${esc(book.title)}</h3>
        <p class="sub" style="margin:0">${esc(book.author || '—')} · ${formatLabel(book.format)} · ${models.STATUS[book.status]?.label || ''}</p>
        <div class="coral-say" style="margin-top:10px;padding:10px"><div class="txt" style="font-size:12.5px">${coral.insight(book, p)}</div></div>
      </div>
    </div>
    <div class="menu-list">
      <button data-a="open"><svg viewBox="0 0 24 24"><path d="M12 6v13M3 6h6a3 3 0 013 3M21 6h-6a3 3 0 00-3 3"/></svg>Abrir${pct ? ` · ${pct}%` : ''}</button>
      <button data-a="fav"><svg viewBox="0 0 24 24"><path d="M12 21l-1.5-1.3C5 14.7 2 12 2 8.5A4.5 4.5 0 0112 5a4.5 4.5 0 0110 3.5c0 3.5-3 6.2-8.5 11.2z"/></svg>${book.favorite ? 'Quitar de favoritos' : 'Marcar favorito'}</button>
      <button data-a="status"><svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>Estado de lectura</button>
      <button data-a="edit"><svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>Editar metadatos</button>
      <button data-a="cover"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>Cambiar portada</button>
      <button data-a="coral"><svg viewBox="0 0 24 24"><path d="M12 3c4.5 0 8 3 8 7 0 2.5-1.6 4-3 5-1 .7-1 2-1 3H8c0-1 0-2.3-1-3-1.4-1-3-2.5-3-5 0-4 3.5-7 8-7z"/></svg>Que Coral complete datos</button>
      <button data-a="folder"><svg viewBox="0 0 24 24"><path d="M3 7h5l2 2h11v9H3z"/></svg>Mover a carpeta</button>
      <button data-a="coll"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>Añadir a colección</button>
      <button data-a="hide"><svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/></svg>${book.hidden ? 'Mostrar' : 'Ocultar'}</button>
      <button data-a="trash" class="danger"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>Enviar a papelera</button>
    </div>`);
  coverUrl(book).then((u) => { const mc = document.getElementById('_mc'); if (mc && u) mc.innerHTML = `<img src="${u}" style="width:100%;height:100%;object-fit:cover">`; });
  const host = document.getElementById('modalHost');
  host.querySelectorAll('.menu-list button').forEach((b) => b.onclick = async () => {
    const a = b.dataset.a; App.closeModal();
    if (a === 'open') App.open(book.id);
    else if (a === 'fav') { await models.toggleFavorite(book.id); invalidateCover(book.id); await App.refresh(); App.render(); }
    else if (a === 'status') openStatusSheet(book, App);
    else if (a === 'edit') editMetadata(book, App);
    else if (a === 'cover') changeCover(book, App);
    else if (a === 'coral') coralComplete(book, App);
    else if (a === 'folder') moveToFolder(book, App);
    else if (a === 'coll') addToCollectionSheet(book, App);
    else if (a === 'hide') { const bk = await models.getBook(book.id); bk.hidden = !bk.hidden; await models.saveBook(bk); await App.refresh(); App.render(); toast(bk.hidden ? 'Libro oculto' : 'Libro visible'); }
    else if (a === 'trash') { await models.trashBook(book.id); await App.refresh(); App.render(); toast('En la papelera', { actionLabel: 'Deshacer', onAction: async () => { await models.restoreBook(book.id); await App.refresh(); App.render(); } }); }
  });
}

function openStatusSheet(book, App) {
  const items = Object.entries(models.STATUS).map(([k, v]) =>
    `<button data-s="${k}" class="${book.status === k ? 'is-active' : ''}">${v.emoji} ${v.label}</button>`).join('');
  App.sheet(`<h3>Estado de lectura</h3><div class="menu-list">${items}</div>`);
  document.getElementById('modalHost').querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => {
    await models.setStatus(book.id, b.dataset.s); App.closeModal(); await App.refresh(); App.render(); toast('Estado actualizado');
  });
}

function editMetadata(book, App) {
  App.sheet(`<h3>Editar metadatos</h3>
    <div class="field"><label>Título</label><input id="m_title" value="${attr(book.title)}"></div>
    <div class="field"><label>Autor</label><input id="m_author" value="${attr(book.author)}"></div>
    <div class="row"><div class="field"><label>Serie</label><input id="m_series" value="${attr(book.series)}"></div>
      <div class="field"><label>Volumen</label><input id="m_vol" type="number" value="${book.volume ?? ''}"></div></div>
    <div class="row"><div class="field"><label>Año</label><input id="m_year" value="${attr(book.year)}"></div>
      <div class="field"><label>Editorial</label><input id="m_pub" value="${attr(book.publisher)}"></div></div>
    <div class="field"><label>Categoría</label><input id="m_cat" value="${attr(book.category)}"></div>
    <div class="field"><label>Etiquetas (separadas por coma)</label><input id="m_tags" value="${attr((book.tags||[]).join(', '))}"></div>
    <div class="field"><label>Descripción</label><textarea id="m_desc" rows="3">${esc(book.description || '')}</textarea></div>
    <button class="btn block" id="m_save">Guardar</button>`);
  document.getElementById('m_save').onclick = async () => {
    const bk = await models.getBook(book.id);
    bk.title = val('m_title') || bk.title; bk.author = val('m_author');
    bk.series = val('m_series'); bk.volume = val('m_vol') ? parseInt(val('m_vol'), 10) : null;
    bk.year = val('m_year'); bk.publisher = val('m_pub'); bk.category = val('m_cat');
    bk.tags = val('m_tags').split(',').map((s) => s.trim()).filter(Boolean);
    bk.description = val('m_desc');
    await models.saveBook(bk); App.closeModal(); invalidateCover(book.id); await App.refresh(); App.render(); toast('Metadatos guardados');
  };
}

function changeCover(book, App) {
  App.sheet(`<h3>Portada de «${esc(book.title)}»</h3>
    <div class="menu-list">
      <button data-a="online"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>Buscar carátula automáticamente</button>
      <button data-a="image"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>Usar una imagen de mi galería</button>
      <button data-a="generate"><svg viewBox="0 0 24 24"><path d="M12 3c4.5 0 8 3 8 7 0 2.5-1.6 4-3 5-1 .7-1 2-1 3H8c0-1 0-2.3-1-3-1.4-1-3-2.5-3-5 0-4 3.5-7 8-7z"/></svg>Generar portada con Coral</button>
    </div>`);
  document.getElementById('modalHost').querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'generate') {
      App.closeModal();
      const blob = await generateCoverBlob(book); await storage.saveCover(book.id, blob);
      const bk = await models.getBook(book.id); bk.coverType = 'generated'; await models.saveBook(bk);
      invalidateCover(book.id); await App.refresh(); App.render(); toast('Portada generada');
    } else if (a === 'image') {
      const input = document.getElementById('coverInput');
      input.onchange = async () => {
        const f = input.files[0]; input.value = '';
        if (!f) return;
        await storage.saveCover(book.id, f);
        const bk = await models.getBook(book.id); bk.coverType = 'image'; await models.saveBook(bk);
        App.closeModal(); invalidateCover(book.id); await App.refresh(); App.render(); toast('Portada actualizada');
      };
      input.click();
    } else if (a === 'online') {
      App.closeModal();
      if (!navigator.onLine) return toast('Necesitas conexión para buscar carátulas');
      const t = toast('Buscando carátula…', { duration: 30000, icon: '<div class="spinner"></div>' });
      const res = await searchOnline(book);
      const blob = res && res.coverUrl ? await fetchCoverBlob(res.coverUrl) : null;
      t.remove();
      if (blob) { await storage.saveCover(book.id, blob); const bk = await models.getBook(book.id); bk.coverType = 'image'; await models.saveBook(bk); invalidateCover(book.id); await App.refresh(); App.render(); toast(`Carátula de ${res.source}`); }
      else toast('No encontré una carátula. Prueba con otra imagen.');
    }
  });
}

async function coralComplete(book, App) {
  const st = coral.status();
  const t = toast(`${st.label}: completando…`, { duration: 30000, icon: '<div class="spinner"></div>' });
  const res = await coral.enrich(book, {});
  const bk = await models.getBook(book.id);
  let changed = 0;
  for (const [k, v] of Object.entries(res.fields || {})) { if (k !== 'suggestedStatus' && v) { bk[k] = v; changed++; } }
  bk.coralEnriched = true;
  if (res.coverUrl && bk.coverType === 'generated') { const blob = await fetchCoverBlob(res.coverUrl); if (blob) { await storage.saveCover(book.id, blob); bk.coverType = 'image'; invalidateCover(book.id); changed++; } }
  await models.saveBook(bk);
  t.remove();
  await App.refresh(); App.render();
  toast(changed ? `Coral completó ${changed} dato${changed === 1 ? '' : 's'} (${res.source})` : 'No encontré datos nuevos');
}

async function moveToFolder(book, App) {
  const folders = await models.allFolders();
  const items = folders.map((f) => `<button data-f="${f.id}">📁 ${esc(f.name)}</button>`).join('');
  App.sheet(`<h3>Mover a carpeta</h3><div class="menu-list">
    <button data-f=""><svg viewBox="0 0 24 24"><path d="M3 12h18"/></svg>Raíz (sin carpeta)</button>
    ${items}
    <button data-f="__new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nueva carpeta…</button>
  </div>`);
  document.getElementById('modalHost').querySelectorAll('[data-f]').forEach((b) => b.onclick = async () => {
    let fid = b.dataset.f; App.closeModal();
    if (fid === '__new') { const name = await App.prompt('Nueva carpeta', 'Nombre'); if (!name) return; const f = await models.createFolder(name); fid = f.id; }
    const bk = await models.getBook(book.id); bk.folderId = fid || null; await models.saveBook(bk);
    await App.refresh(); App.render(); toast('Libro movido');
  });
}

async function addToCollectionSheet(book, App) {
  const colls = await models.allCollections();
  const items = colls.map((c) => `<button data-c="${c.id}">${(c.bookIds || []).includes(book.id) ? '✅' : '📚'} ${esc(c.name)} <span style="margin-left:auto;opacity:.5">${(c.bookIds || []).length}</span></button>`).join('');
  App.sheet(`<h3>Añadir a colección</h3><div class="menu-list">
    ${items || '<p class="muted center" style="padding:16px 0">Aún no tienes colecciones.</p>'}
    <button data-c="__new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nueva colección…</button></div>`);
  document.getElementById('modalHost').querySelectorAll('[data-c]').forEach((b) => b.onclick = async () => {
    let id = b.dataset.c; App.closeModal();
    if (id === '__new') { const name = await App.prompt('Nueva colección', 'Nombre de la colección', 'Mis favoritos de fantasía'); if (!name) return; const c = await models.createCollection(name); await models.addToCollection(c.id, book.id); App.buildDrawer(); toast('Colección creada'); return; }
    const added = await models.toggleInCollection(id, book.id);
    App.buildDrawer(); toast(added ? 'Añadido a la colección' : 'Quitado de la colección');
  });
}

function openSortSheet(App) {
  const opts = [['addedAt', 'Fecha añadida'], ['title', 'Título'], ['author', 'Autor'], ['lastOpenedAt', 'Última apertura'], ['finishedAt', 'Fecha de lectura'], ['size', 'Tamaño'], ['pages', 'Nº de páginas']];
  App.sheet(`<h3>Ordenar por</h3><div class="menu-list">
    ${opts.map(([k, l]) => `<button data-s="${k}" class="${App.state.sort === k ? 'is-active' : ''}">${l}</button>`).join('')}
    </div><div class="seg" style="margin-top:10px"><button data-d="desc" class="${App.state.sortDir === 'desc' ? 'on' : ''}">Descendente</button><button data-d="asc" class="${App.state.sortDir === 'asc' ? 'on' : ''}">Ascendente</button></div>`);
  const host = document.getElementById('modalHost');
  host.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { App.state.sort = b.dataset.s; settings.set('libSort', b.dataset.s); App.closeModal(); App.render(); });
  host.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { App.state.sortDir = b.dataset.d; settings.set('libSortDir', b.dataset.d); App.closeModal(); App.render(); });
}

/* ── Papelera y ocultos ── */
async function renderTrash(container, App) {
  const books = App.state.books.filter((b) => b.trashed);
  container.innerHTML = `<div class="section-title">🗑️ Papelera <small>${books.length} elemento(s)</small></div>`;
  if (!books.length) { container.insertAdjacentHTML('beforeend', `<div class="empty"><div class="emoji">✨</div><h3>Papelera vacía</h3></div>`); return; }
  const bar = document.createElement('button'); bar.className = 'btn ghost block'; bar.textContent = 'Vaciar papelera';
  bar.onclick = async () => { if (await App.confirm('Vaciar papelera', 'Se eliminarán definitivamente. No se puede deshacer.', 'Eliminar', true)) { for (const b of books) await models.deleteBookForever(b.id); await App.refresh(); App.render(); toast('Papelera vaciada'); } };
  container.appendChild(bar);
  const list = document.createElement('div'); list.className = 'lib-list'; list.style.marginTop = '10px';
  books.forEach((book) => {
    const el = document.createElement('div'); el.className = 'list-item';
    el.innerHTML = `<div class="lc"></div><div class="list-body"><h4>${esc(book.title)}</h4><p>${esc(book.author || '—')}</p></div>
      <button class="icon-btn" data-r title="Restaurar"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9 9 9 0 00-6 2.3L3 8"/><path d="M3 3v5h5"/></svg></button>
      <button class="icon-btn" data-d title="Eliminar"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>`;
    coverUrl(book).then((u) => { if (u) el.querySelector('.lc').innerHTML = `<img src="${u}">`; });
    el.querySelector('[data-r]').onclick = async () => { await models.restoreBook(book.id); await App.refresh(); App.render(); toast('Restaurado'); };
    el.querySelector('[data-d]').onclick = async () => { if (await App.confirm('Eliminar libro', 'Se borrará el archivo y su progreso.', 'Eliminar', true)) { await models.deleteBookForever(book.id); await App.refresh(); App.render(); } };
    list.appendChild(el);
  });
  container.appendChild(list);
}

async function renderHidden(container, App) {
  const books = App.state.books.filter((b) => b.hidden && !b.trashed);
  container.innerHTML = `<div class="section-title">👁️ Libros ocultos <small>${books.length}</small></div>`;
  if (!books.length) { container.insertAdjacentHTML('beforeend', `<div class="empty"><div class="emoji">🙈</div><h3>Nada oculto</h3></div>`); return; }
  const list = document.createElement('div'); list.className = 'lib-list';
  books.forEach((book) => {
    const el = document.createElement('div'); el.className = 'list-item';
    el.innerHTML = `<div class="lc"></div><div class="list-body"><h4>${esc(book.title)}</h4><p>${esc(book.author || '—')}</p></div>
      <button class="icon-btn" data-s><svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
    coverUrl(book).then((u) => { if (u) el.querySelector('.lc').innerHTML = `<img src="${u}">`; });
    el.querySelector('[data-s]').onclick = async () => { const bk = await models.getBook(book.id); bk.hidden = false; await models.saveBook(bk); await App.refresh(); App.render(); toast('Visible de nuevo'); };
    el.onclick = (e) => { if (!e.target.closest('[data-s]')) App.open(book.id); };
    list.appendChild(el);
  });
  container.appendChild(list);
}

/* helpers */
function esc(s = '') { return String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }
function attr(s = '') { return String(s || '').replace(/"/g, '&quot;'); }
function val(id) { return document.getElementById(id).value.trim(); }
