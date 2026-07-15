/* fileexplorer.js — Explorador de archivos propio:
   carpetas anidadas, crear/renombrar/mover/eliminar,
   multiselección y búsqueda. */
import * as models from './models.js';
import { storage } from './storage.js';
import { toast, haptic } from './toast.js';
import { formatLabel } from './parsers/index.js';

let cur = null;      // carpeta actual (null = raíz)
let selectMode = false;
const selected = new Set();

export async function render(container, App) {
  const folders = await models.allFolders();
  const books = App.state.books.filter((b) => !b.trashed && !b.hidden);
  const subfolders = folders.filter((f) => (f.parentId || null) === cur);
  const here = books.filter((b) => (b.folderId || null) === cur);
  const curFolder = cur ? folders.find((f) => f.id === cur) : null;

  // Breadcrumb
  const crumbs = [];
  let node = curFolder;
  while (node) { crumbs.unshift(node); node = node.parentId ? folders.find((f) => f.id === node.parentId) : null; }

  container.innerHTML = `
    <div class="breadcrumb"><button data-go="root"><svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-3px"><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg> Inicio</button>
      ${crumbs.map((c) => `<span>/</span><button data-go="${c.id}">${c.id === cur ? '<b>' + esc(c.name) + '</b>' : esc(c.name)}</button>`).join('')}</div>
    <div class="chiprow">
      <button class="chip" id="fxNew"><svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px"><path d="M12 5v14M5 12h14"/></svg> Nueva carpeta</button>
      <button class="chip" id="fxImport"><svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px"><path d="M12 3v12M8 11l4 4 4-4"/></svg> Importar aquí</button>
      <button class="chip ${selectMode ? 'is-active' : ''}" id="fxSelect">${selectMode ? 'Cancelar' : 'Seleccionar'}</button>
    </div>
    <div id="fxList"></div>`;

  container.querySelector('[data-go="root"]').onclick = () => { cur = null; clearSel(); render(container, App); };
  container.querySelectorAll('.breadcrumb [data-go]:not([data-go="root"])').forEach((b) => b.onclick = () => { cur = b.dataset.go; clearSel(); render(container, App); });
  container.querySelector('#fxNew').onclick = async () => { const name = await App.prompt('Nueva carpeta', 'Nombre'); if (name) { await models.createFolder(name, cur); render(container, App); App.buildDrawer(); } };
  container.querySelector('#fxImport').onclick = () => { App.state.filter = cur ? 'folder:' + cur : 'all'; document.getElementById('fileInput').click(); };
  container.querySelector('#fxSelect').onclick = () => { selectMode = !selectMode; clearSel(); render(container, App); };

  const list = container.querySelector('#fxList');
  if (!subfolders.length && !here.length) {
    list.innerHTML = `<div class="empty"><div class="emoji">📂</div><h3>Carpeta vacía</h3><p>Crea subcarpetas o importa libros aquí.</p></div>`;
    return;
  }

  subfolders.forEach((f) => {
    const count = books.filter((b) => b.folderId === f.id).length + folders.filter((x) => x.parentId === f.id).length;
    const el = document.createElement('div'); el.className = 'fx-item';
    el.innerHTML = `<div class="fx-ic folder"><svg viewBox="0 0 24 24"><path d="M3 7h5l2 2h11v9H3z"/></svg></div>
      <div class="fx-body"><h4>${esc(f.name)}</h4><p>${count} elemento(s)</p></div>
      <button class="icon-btn" data-fmenu><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>`;
    el.querySelector('[data-fmenu]').onclick = (e) => { e.stopPropagation(); folderMenu(f, App, container); };
    el.onclick = () => { cur = f.id; clearSel(); render(container, App); };
    list.appendChild(el);
  });

  for (const b of here) {
    const el = document.createElement('div'); el.className = 'fx-item' + (selected.has(b.id) ? ' sel' : '');
    const cover = await storage.getCover(b.id);
    el.innerHTML = `<div class="fx-ic file">${cover ? `<img src="${URL.createObjectURL(cover)}" style="width:100%;height:100%;object-fit:cover">` : `<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/></svg>`}</div>
      <div class="fx-body"><h4>${esc(b.title)}</h4><p>${esc(b.author || '—')} · ${formatLabel(b.format)} · ${(b.size/1048576).toFixed(1)}MB</p></div>
      ${selectMode ? `<div class="fx-check">${selected.has(b.id) ? '✓' : ''}</div>` : `<button class="icon-btn" data-bmenu><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>`}`;
    if (selectMode) { el.onclick = () => { toggleSel(b.id); render(container, App); }; }
    else { el.onclick = (e) => { if (!e.target.closest('[data-bmenu]')) App.open(b.id); }; el.querySelector('[data-bmenu]').onclick = (e) => { e.stopPropagation(); fileMenu(b, App, container); }; }
    list.appendChild(el);
  }

  if (selectMode && selected.size) {
    const bar = document.createElement('div'); bar.className = 'row'; bar.style.marginTop = '14px';
    bar.innerHTML = `<button class="btn ghost" id="fxMove">Mover ${selected.size}</button><button class="btn" id="fxTrash" style="background:#e5484d">Papelera</button>`;
    list.appendChild(bar);
    bar.querySelector('#fxMove').onclick = () => moveSelected(App, container);
    bar.querySelector('#fxTrash').onclick = async () => { for (const id of selected) await models.trashBook(id); clearSel(); await App.refresh(); render(container, App); toast('Enviados a la papelera'); };
  }
}

function toggleSel(id) { selected.has(id) ? selected.delete(id) : selected.add(id); haptic(6); }
function clearSel() { selected.clear(); }

function folderMenu(f, App, container) {
  App.sheet(`<h3>${esc(f.name)}</h3><div class="menu-list">
    <button data-a="rename"><svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>Renombrar</button>
    <button data-a="delete" class="danger"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>Eliminar carpeta</button>
  </div>`);
  document.getElementById('modalHost').querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.a; App.closeModal();
    if (a === 'rename') { const name = await App.prompt('Renombrar', 'Nuevo nombre', '', f.name); if (name) { await models.renameFolder(f.id, name); render(container, App); App.buildDrawer(); } }
    else if (a === 'delete') { if (await App.confirm('Eliminar carpeta', 'Los libros que contiene volverán a la raíz.', 'Eliminar', true)) { await models.deleteFolder(f.id); await App.refresh(); render(container, App); App.buildDrawer(); } }
  });
}
function fileMenu(b, App, container) {
  App.sheet(`<h3>${esc(b.title)}</h3><div class="menu-list">
    <button data-a="open"><svg viewBox="0 0 24 24"><path d="M12 6v13"/></svg>Abrir</button>
    <button data-a="move"><svg viewBox="0 0 24 24"><path d="M3 7h5l2 2h11v9H3z"/></svg>Mover a…</button>
    <button data-a="rename"><svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>Renombrar</button>
    <button data-a="trash" class="danger"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>Papelera</button>
  </div>`);
  document.getElementById('modalHost').querySelectorAll('[data-a]').forEach((btn) => btn.onclick = async () => {
    const a = btn.dataset.a; App.closeModal();
    if (a === 'open') App.open(b.id);
    else if (a === 'rename') { const name = await App.prompt('Renombrar', 'Título', '', b.title); if (name) { const bk = await models.getBook(b.id); bk.title = name; await models.saveBook(bk); await App.refresh(); render(container, App); } }
    else if (a === 'trash') { await models.trashBook(b.id); await App.refresh(); render(container, App); toast('En la papelera'); }
    else if (a === 'move') { selected.clear(); selected.add(b.id); moveSelected(App, container); }
  });
}
async function moveSelected(App, container) {
  const folders = await models.allFolders();
  App.sheet(`<h3>Mover a…</h3><div class="menu-list">
    <button data-f="">📁 Raíz</button>
    ${folders.map((f) => `<button data-f="${f.id}">📁 ${esc(f.name)}</button>`).join('')}
    <button data-f="__new">➕ Nueva carpeta…</button></div>`);
  document.getElementById('modalHost').querySelectorAll('[data-f]').forEach((b) => b.onclick = async () => {
    let fid = b.dataset.f; App.closeModal();
    if (fid === '__new') { const name = await App.prompt('Nueva carpeta', 'Nombre'); if (!name) return; const f = await models.createFolder(name, cur); fid = f.id; }
    for (const id of selected) { const bk = await models.getBook(id); bk.folderId = fid || null; await models.saveBook(bk); }
    clearSel(); selectMode = false; await App.refresh(); render(container, App); App.buildDrawer(); toast('Movido(s)');
  });
}
function esc(s = '') { return String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }
