/* ══════════════════════════════════════════════════
   app.js — Controlador principal de Coral Reader.
   Router de vistas, tema, drawer, búsqueda, modales,
   importación y arranque del Service Worker.
   ══════════════════════════════════════════════════ */
import { settings, db } from './db.js';
import { storage } from './storage.js';
import * as models from './models.js';
import { toast, haptic } from './toast.js';
import { coral } from './coral.js';
import { importFiles } from './importer.js';
import * as LibraryView from './library.js';
import * as StatsView from './stats.js';
import * as SettingsView from './settings.js';
import * as ExplorerView from './fileexplorer.js';
import * as CoralView from './coralview.js';
import { openReader } from './reader.js';
import { openSearch } from './search.js';

const $ = (id) => document.getElementById(id);

export const App = {
  state: { view: 'library', filter: 'all', folderId: null, books: [], sort: 'addedAt', sortDir: 'desc', view3: 'grid' },
  models, storage, db, coral, toast, haptic,

  async init() {
    await settings.load();
    this.state.sort = settings.get('libSort');
    this.state.sortDir = settings.get('libSortDir');
    this.state.view3 = settings.get('libView');
    this.applyTheme();
    this.applyOrientation();
    this.registerSW();
    this.bindChrome();
    await this.refresh();
    this.handleLaunchParams();
    this.hideSplash();
    this.render();
    // Enriquecimiento diferido de libros sin metadatos (en segundo plano)
    this.backgroundEnrich();
    window.addEventListener('online', () => this.render());
    window.addEventListener('offline', () => this.render());
  },

  hideSplash() { setTimeout(() => { $('splash').classList.add('hide'); $('app').hidden = false; }, 550); },

  registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // Recarga automática (una vez) cuando un SW nuevo toma el control.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !hadController) return;
      refreshing = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // busca updates al abrir
      reg.update?.();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Actualizando a la última versión…');
            nw.postMessage('skip-waiting');
          }
        });
      });
    }).catch(() => {});
  },

  /* ── Tema ── */
  applyTheme() {
    const t = settings.get('theme');
    document.body.dataset.theme = t;
    const rt = settings.get('readerTheme');
    document.body.dataset.readerTheme = rt;
    if (settings.get('dyslexia')) document.body.classList.add('dyslexia'); else document.body.classList.remove('dyslexia');
  },

  /* ── Orientación (evita rotación accidental) ── */
  applyOrientation() {
    const o = settings.get('orientation') || 'portrait';
    try {
      const so = screen.orientation;
      if (so && so.lock) {
        if (o === 'portrait') so.lock('portrait').catch(() => {});
        else if (o === 'landscape') so.lock('landscape').catch(() => {});
        else if (so.unlock) so.unlock();
      }
    } catch (_) {}
  },

  /* ── Datos ── */
  async refresh() {
    this.state.books = await models.allBooks();
    const total = this.state.books.filter((b) => !b.trashed).length;
    $('drawerCount').textContent = `${total} libro${total === 1 ? '' : 's'}`;
  },

  visibleBooks() {
    let books = this.state.books.filter((b) => !b.trashed && !b.hidden);
    const f = this.state.filter;
    if (f === 'favorite') books = books.filter((b) => b.favorite);
    else if (f === 'reading') books = books.filter((b) => b.status === 'reading');
    else if (f === 'unread') books = books.filter((b) => b.status === 'unread');
    else if (f === 'finished') books = books.filter((b) => b.status === 'finished');
    else if (f === 'abandoned') books = books.filter((b) => b.status === 'abandoned');
    else if (f && f.startsWith('folder:')) { const id = f.slice(7); books = this.state.books.filter((b) => !b.trashed && b.folderId === id); }
    else if (f && f.startsWith('tag:')) { const t = f.slice(4); books = books.filter((b) => (b.tags || []).includes(t)); }
    else if (f && f.startsWith('coll:')) { const id = f.slice(5); /* filtrado en library */ this.state.collFilter = id; }
    return models.sortBooks(books, this.state.sort, this.state.sortDir);
  },

  /* ── Router ── */
  go(view, params = {}) {
    this.state.view = view;
    if (params.filter !== undefined) this.state.filter = params.filter;
    if (params.folderId !== undefined) this.state.folderId = params.folderId;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('is-active', n.dataset.view === view));
    document.querySelectorAll('.drawer-item[data-view]').forEach((n) => n.classList.toggle('is-active', n.dataset.view === view && (!n.dataset.filter || n.dataset.filter === this.state.filter)));
    this.closeDrawer();
    this.render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  },

  render() {
    const c = $('content');
    const titles = { library: 'Biblioteca', explorer: 'Archivos', stats: 'Estadísticas', coral: 'Coral', settings: 'Ajustes' };
    $('topbarTitle').textContent = titles[this.state.view] || 'Coral';
    $('btnViewMode').style.display = this.state.view === 'library' ? '' : 'none';
    $('fab').style.display = ['library', 'explorer'].includes(this.state.view) ? '' : 'none';
    c.innerHTML = '';
    const view = document.createElement('div');
    view.className = 'view';
    c.appendChild(view);
    ({
      library: () => LibraryView.render(view, this),
      explorer: () => ExplorerView.render(view, this),
      stats: () => StatsView.render(view, this),
      coral: () => CoralView.render(view, this),
      settings: () => SettingsView.render(view, this),
    }[this.state.view] || (() => LibraryView.render(view, this)))();
    this.buildDrawer();
  },

  /* ── Chrome (topbar, nav, drawer, fab, búsqueda) ── */
  bindChrome() {
    $('btnMenu').onclick = () => this.openDrawer();
    $('scrim').onclick = () => this.closeDrawer();
    $('btnSearch').onclick = () => openSearch(this);
    $('btnSearchClose').onclick = () => { $('searchOverlay').hidden = true; };
    $('btnCoral').onclick = () => this.go('coral');
    $('btnViewMode').onclick = () => this.cycleView();
    document.querySelectorAll('.nav-item').forEach((n) => n.onclick = () => { haptic(); this.go(n.dataset.view, { filter: 'all', folderId: null }); });
    $('fab').onclick = () => this.openAddSheet();
    $('fileInput').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) this.doImport(files); };
    $('folderInput').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) this.doImport(files); };
  },

  cycleView() {
    const order = ['grid', 'list', 'shelf'];
    this.state.view3 = order[(order.indexOf(this.state.view3) + 1) % order.length];
    settings.set('libView', this.state.view3);
    toast(`Vista: ${ { grid: 'cuadrícula', list: 'lista', shelf: 'estantería' }[this.state.view3] }`);
    this.render();
  },

  openDrawer() { $('drawer').hidden = false; requestAnimationFrame(() => $('drawer').classList.add('open')); $('scrim').hidden = false; },
  closeDrawer() { $('drawer').classList.remove('open'); $('scrim').hidden = true; if (window.innerWidth < 900) setTimeout(() => { if (!$('drawer').classList.contains('open')) $('drawer').hidden = true; }, 320); },

  async buildDrawer() {
    const folders = await models.allFolders();
    const collections = await models.allCollections();
    const books = this.state.books.filter((b) => !b.trashed);
    const cnt = (fn) => books.filter(fn).length;
    const trashed = this.state.books.filter((b) => b.trashed).length;
    const item = (view, filter, icon, label, badge) =>
      `<button class="drawer-item ${this.state.view === view && this.state.filter === filter ? 'is-active' : ''}" data-view="${view}" data-filter="${filter}">
        ${icon}<span>${label}</span>${badge != null ? `<span class="badge">${badge}</span>` : ''}</button>`;
    const I = {
      all: '<svg viewBox="0 0 24 24"><path d="M4 5h6v14H4zM14 5h6v14h-6z"/></svg>',
      reading: '<svg viewBox="0 0 24 24"><path d="M12 6v13M3 6h6a3 3 0 013 3M21 6h-6a3 3 0 00-3 3"/></svg>',
      unread: '<svg viewBox="0 0 24 24"><path d="M6 4h11l3 3v13H6z"/></svg>',
      finished: '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>',
      fav: '<svg viewBox="0 0 24 24"><path d="M12 21l-1.5-1.3C5 14.7 2 12 2 8.5A4.5 4.5 0 0112 5a4.5 4.5 0 0110 3.5c0 3.5-3 6.2-8.5 11.2z"/></svg>',
      abandoned: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111 3a7 7 0 0010 9.8z"/></svg>',
      folder: '<svg viewBox="0 0 24 24"><path d="M3 7h5l2 2h11v9H3z"/></svg>',
      coll: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
      trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
      hidden: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    };
    let html = `<div class="drawer-group">Biblioteca</div>
      ${item('library', 'all', I.all, 'Todos', books.length)}
      ${item('library', 'reading', I.reading, 'Leyendo', cnt((b) => b.status === 'reading'))}
      ${item('library', 'unread', I.unread, 'Pendientes', cnt((b) => b.status === 'unread'))}
      ${item('library', 'finished', I.finished, 'Terminados', cnt((b) => b.status === 'finished'))}
      ${item('library', 'favorite', I.fav, 'Favoritos', cnt((b) => b.favorite))}
      ${item('library', 'abandoned', I.abandoned, 'Abandonados', cnt((b) => b.status === 'abandoned'))}`;
    if (folders.length) {
      html += `<div class="drawer-group">Carpetas</div>`;
      folders.forEach((f) => { html += item('library', 'folder:' + f.id, I.folder, f.name, cnt((b) => b.folderId === f.id)); });
    }
    if (collections.length) {
      html += `<div class="drawer-group">Colecciones</div>`;
      collections.forEach((c) => { html += item('library', 'coll:' + c.id, I.coll, c.name, (c.bookIds || []).length); });
    }
    html += `<div class="drawer-group">Sistema</div>
      <button class="drawer-item" data-view="stats" data-filter=""> ${'<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>'}<span>Estadísticas</span></button>
      <button class="drawer-item" data-view="coral" data-filter=""> ${'<svg viewBox="0 0 24 24"><path d="M12 3c4.5 0 8 3 8 7 0 2.5-1.6 4-3 5-1 .7-1 2-1 3H8c0-1 0-2.3-1-3-1.4-1-3-2.5-3-5 0-4 3.5-7 8-7z"/></svg>'}<span>Coral</span></button>
      ${item('library', 'trash', I.trash, 'Papelera', trashed)}
      ${item('library', 'hidden', I.hidden, 'Ocultos', this.state.books.filter((b) => b.hidden && !b.trashed).length)}
      <button class="drawer-item" data-view="settings" data-filter=""> ${'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2"/></svg>'}<span>Ajustes</span></button>`;
    $('drawerBody').innerHTML = html;
    $('drawerBody').querySelectorAll('.drawer-item').forEach((el) => {
      el.onclick = () => { haptic(); this.go(el.dataset.view, { filter: el.dataset.filter || 'all' }); };
    });
  },

  /* ── Importación ── */
  openAddSheet() {
    this.sheet(`
      <h3>Añadir a tu biblioteca</h3>
      <p class="sub">Coral organizará y buscará las carátulas por ti.</p>
      <div class="sheet-actions">
        <button class="sheet-action" data-act="files"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><div>Elegir archivos<small>EPUB · PDF · MOBI · CBZ · FB2 · TXT · DOCX…</small></div></button>
        <button class="sheet-action" data-act="folder"><svg viewBox="0 0 24 24"><path d="M3 7h5l2 2h11v9H3z"/></svg><div>Importar carpeta completa<small>Cientos de libros de una vez</small></div></button>
        <button class="sheet-action" data-act="url"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></svg><div>Desde una URL<small>Pega el enlace directo a un libro</small></div></button>
        <button class="sheet-action" data-act="newfolder"><svg viewBox="0 0 24 24"><path d="M3 7h5l2 2h11v9H3z"/><path d="M12 12v4M10 14h4"/></svg><div>Crear carpeta<small>Organiza antes de importar</small></div></button>
      </div>`);
    $('modalHost').querySelectorAll('.sheet-action').forEach((b) => b.onclick = () => {
      const act = b.dataset.act; this.closeModal();
      if (act === 'files') $('fileInput').click();
      else if (act === 'folder') $('folderInput').click();
      else if (act === 'url') this.importFromUrl();
      else if (act === 'newfolder') this.promptNewFolder();
    });
  },

  async promptNewFolder() {
    const name = await this.prompt('Nueva carpeta', 'Nombre de la carpeta', 'Mis novelas');
    if (name) { await models.createFolder(name); toast('Carpeta creada'); this.buildDrawer(); this.render(); }
  },

  async importFromUrl() {
    const url = await this.prompt('Importar desde URL', 'Enlace directo (.epub, .pdf, …)', 'https://');
    if (!url) return;
    const t = toast('Descargando…', { duration: 60000, icon: '<div class="spinner"></div>' });
    try {
      const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'libro';
      const file = new File([blob], name, { type: blob.type });
      t.remove(); await this.doImport([file]);
    } catch (e) { t.remove(); toast('No se pudo descargar: ' + e.message); }
  },

  async doImport(files, opts = {}) {
    const folderId = this.state.filter && this.state.filter.startsWith('folder:') ? this.state.filter.slice(7) : (opts.folderId || null);
    await importFiles(files, { folderId, App: this });
    await this.refresh();
    this.render();
  },

  async backgroundEnrich() {
    const pend = this.state.books.filter((b) => !b.trashed && !b.coralEnriched).slice(0, 8);
    for (const b of pend) {
      try {
        const res = await coral.enrich(b, {});
        let changed = false;
        for (const [k, v] of Object.entries(res.fields || {})) { if (k !== 'suggestedStatus' && v && !b[k]) { b[k] = v; changed = true; } }
        b.coralEnriched = true;
        if (res.coverUrl && b.coverType === 'generated' && settings.get('autoCovers')) {
          const { fetchCoverBlob } = await import('./covers.js');
          const blob = await fetchCoverBlob(res.coverUrl);
          if (blob) { await storage.saveCover(b.id, blob); b.coverType = 'image'; changed = true; }
        }
        await models.saveBook(b);
        if (changed && this.state.view === 'library') this.render();
      } catch (_) { b.coralEnriched = true; await models.saveBook(b); }
    }
  },

  handleLaunchParams() {
    const p = new URLSearchParams(location.search);
    if (p.get('action') === 'continue') { const last = settings.get('lastBookId'); if (last) setTimeout(() => this.open(last), 700); }
    if (p.get('view')) this.state.view = p.get('view');
    if (p.get('action') === 'import') setTimeout(() => this.openAddSheet(), 700);
    // File Handler API
    if ('launchQueue' in window) {
      launchQueue.setConsumer(async (params) => {
        if (!params.files || !params.files.length) return;
        const files = [];
        for (const fh of params.files) files.push(await fh.getFile());
        this.doImport(files);
      });
    }
  },

  async open(bookId) {
    const book = await models.getBook(bookId);
    if (!book) return toast('Libro no encontrado');
    book.lastOpenedAt = Date.now();
    if (book.status === 'unread') book.status = 'reading';
    await models.saveBook(book);
    await settings.set('lastBookId', bookId);
    openReader(bookId, this);
  },

  /* ── Modales / sheets / prompts ── */
  sheet(html) {
    const host = $('modalHost'); host.hidden = false;
    host.innerHTML = `<div class="modal-scrim"></div><div class="sheet"><div class="sheet-grip"></div>${html}</div>`;
    host.querySelector('.modal-scrim').onclick = () => this.closeModal();
  },
  closeModal() { const h = $('modalHost'); h.hidden = true; h.innerHTML = ''; },
  prompt(title, label, placeholder = '', value = '') {
    return new Promise((res) => {
      this.sheet(`<h3>${title}</h3><div class="field"><label>${label}</label><input id="_pin" placeholder="${placeholder}" value="${value.replace(/"/g,'&quot;')}"></div>
        <div class="row"><button class="btn ghost" id="_pc">Cancelar</button><button class="btn" id="_pk">Aceptar</button></div>`);
      const inp = $('_pin'); setTimeout(() => inp.focus(), 100);
      const done = (v) => { this.closeModal(); res(v); };
      $('_pk').onclick = () => done(inp.value.trim());
      $('_pc').onclick = () => done(null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value.trim()); };
    });
  },
  confirm(title, msg, okLabel = 'Aceptar', danger = false) {
    return new Promise((res) => {
      this.sheet(`<h3>${title}</h3><p class="sub">${msg}</p>
        <div class="row"><button class="btn ghost" id="_cc">Cancelar</button><button class="btn ${danger ? '' : ''}" id="_ck" ${danger ? 'style="background:#e5484d"' : ''}>${okLabel}</button></div>`);
      $('_ck').onclick = () => { this.closeModal(); res(true); };
      $('_cc').onclick = () => { this.closeModal(); res(false); };
    });
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
window.CoralApp = App; // acceso desde consola/depuración
