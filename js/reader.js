/* ══════════════════════════════════════════════════
   reader.js — Motor de lectura.
   · Reflow (EPUB/MOBI/FB2/TXT/MD/HTML/DOCX): paginación por
     columnas + animación 3D de pasa-página a 60 fps.
   · PDF: render por página a canvas (scroll continuo, zoom).
   · Imágenes (CBZ): visor vertical.
   Incluye TOC, tipografía, temas, brillo/cálido, subrayados,
   notas, modo concentración y guardado de progreso/sesión.
   ══════════════════════════════════════════════════ */
import { openBook } from './parsers/index.js';
import { storage } from './storage.js';
import { settings, db, uid } from './db.js';
import * as models from './models.js';
import { toast, haptic } from './toast.js';
import { renderNotesPanel, saveHighlight } from './notes.js';

let R = null; // estado del lector activo

export async function openReader(bookId, App) {
  const book = await models.getBook(bookId);
  const raw = await storage.getBook(bookId);
  if (!raw) return toast('No se encontró el archivo del libro');
  // El blob de OPFS se guarda con el id como nombre (sin extensión):
  // reconstruimos un File con el nombre/formato reales para detectar el parser.
  const fname = book.filename || (raw.name && /\.[a-z0-9]+$/i.test(raw.name) ? raw.name : `libro.${book.format || 'txt'}`);
  const file = new File([raw], fname, { type: raw.type || '' });
  const host = document.getElementById('reader');
  host.hidden = false;
  host.innerHTML = `<div class="r-loading" style="position:absolute;inset:0;display:grid;place-items:center"><div class="spinner"></div></div>`;
  document.documentElement.style.overflow = 'hidden';

  let doc;
  try { doc = await openBook(file); }
  catch (e) { host.hidden = true; document.documentElement.style.overflow = ''; return toast('No se pudo abrir: ' + e.message); }

  const progress = await models.getProgress(bookId);
  R = {
    App, book, doc, host, bookId,
    kind: doc.kind, page: 0, totalPages: 1, chromeVisible: true,
    settings: loadReaderSettings(book, progress),
    pagesReadCount: 0, startPercent: progress.percent || 0,
  };
  host.dataset.rtheme = R.settings.readerTheme;
  setReaderThemeColor(R.settings.readerTheme);

  models.startSession(bookId, progress.percent || 0);
  wakeLock(true);

  // Dentro del lector SÍ permitimos girar: en horizontal aparece el libro
  // abierto (dos hojas). El bloqueo vertical global se restaura al cerrar.
  allowReaderRotation();

  if (doc.kind === 'pdf') buildPdfReader(progress);
  else if (doc.kind === 'images') buildImagesReader(progress);
  else buildReflowReader(progress);
}

/* ── Ajustes por libro (con overrides) ── */
function loadReaderSettings(book, progress) {
  const per = (progress.perBook) || {};
  const g = (k) => per[k] !== undefined ? per[k] : settings.get(k);
  return {
    readerTheme: g('readerTheme'), fontSize: g('fontSize'), lineHeight: g('lineHeight'),
    margin: g('margin'), fontFamily: g('fontFamily'), wordSpacing: g('wordSpacing'),
    letterSpacing: g('letterSpacing'), textAlign: g('textAlign'), paragraphSpace: g('paragraphSpace'),
    textIndent: g('textIndent'), pageAnimation: g('pageAnimation'), brightness: g('brightness'),
    warmth: g('warmth'),
  };
}
function applyVars(el, s) {
  el.style.setProperty('--r-fs', s.fontSize + 'px');
  el.style.setProperty('--r-lh', s.lineHeight);
  el.style.setProperty('--r-margin', s.margin + 'px');
  el.style.setProperty('--r-font', s.fontFamily);
  el.style.setProperty('--r-ws', s.wordSpacing + 'em');
  el.style.setProperty('--r-ls', s.letterSpacing + 'em');
  el.style.setProperty('--r-align', s.textAlign);
  el.style.setProperty('--r-pspace', s.paragraphSpace + 'em');
  el.style.setProperty('--r-indent', s.textIndent + 'em');
}

/* El lector permite girar aunque la app esté bloqueada en vertical. */
function allowReaderRotation() {
  document.documentElement.classList.remove('force-portrait');
  try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (_) {}
}

/* Margen del "escritorio" (desde CSS) para alinear las columnas con las hojas. */
function getDeskMargin(el) {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--r-desk-m'));
  return isNaN(v) ? 12 : v;
}
/* Capa decorativa que convierte la superficie en un LIBRO real:
   hoja(s) de papel, sombra de canto, lomo central y pliegue en horizontal. */
function syncReflowBook(hostEl, isScroll) {
  let b = document.getElementById('rBook');
  if (isScroll) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('div'); b.id = 'rBook'; b.className = 'reader-book paper';
    const c = hostEl.querySelector('#rContent');
    hostEl.insertBefore(b, c);   // detrás del texto (el contenido es transparente)
  }
}

function chrome(book) {
  return `
  <div class="reader-chrome reader-top" id="rTop">
    <button class="icon-btn" id="rClose"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
    <div class="r-title">${esc(book.title)}</div>
    <button class="icon-btn" id="rBookmark"><svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg></button>
    <button class="icon-btn" id="rMenu"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></button>
  </div>
  <div class="reader-overlay dim-layer" id="rDim"></div>
  <div class="reader-overlay warm-layer" id="rWarm"></div>
  <div class="reader-runhead hide" id="rRunhead">${esc(book.title)}</div>
  <div class="reader-pageinfo" id="rPageInfo"></div>
  <div class="reader-chrome reader-bottom" id="rBottom">
    <div class="reader-progress"><input type="range" id="rSlider" min="0" max="1000" value="0"><span class="pct" id="rPct">0%</span></div>
    <div class="reader-toolbar" id="rToolbar"></div>
  </div>`;
}

const TB_ICONS = {
  toc: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M4 20l6-14 6 14M6 15h8"/></svg>',
  zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M11 8v6M8 11h6"/></svg>',
  theme: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 100 18 7 7 0 010-14 5 5 0 000 10"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4z"/></svg>',
};

// Barra inferior contextual: solo lo que aporta según el tipo de libro.
function buildToolbar(reRender) {
  const bar = document.getElementById('rToolbar'); if (!bar) return;
  const hasToc = (R.doc.toc || []).length > 0;
  const items = [];
  if (hasToc) items.push(['toc', 'Índice', () => openToc()]);
  if (R.kind === 'pdf') items.push(['zoom', 'Zoom', () => pdfZoomSheet()]);
  else if (R.kind !== 'images') items.push(['text', 'Texto', () => openTypography(reRender)]);
  items.push(['theme', 'Tema', () => openThemePicker()]);
  items.push(['light', 'Brillo', () => openBrightness()]);
  if (R.kind !== 'pdf' && R.kind !== 'images') items.push(['notes', 'Notas', () => openNotes()]);
  bar.innerHTML = items.map(([ic, label]) => `<button data-tb="${label}">${TB_ICONS[ic]}<span>${label}</span></button>`).join('');
  bar.querySelectorAll('button').forEach((b, i) => b.onclick = items[i][2]);
}

function bindChrome(reRender) {
  const $ = (id) => document.getElementById(id);
  $('rClose').onclick = () => closeReader();
  $('rMenu').onclick = () => openReaderMenu();
  $('rBookmark').onclick = () => addBookmark();
  buildToolbar(reRender);
  applyBrightness();
}

/* ═════════ Lector REFLOW ═════════ */
function buildReflowReader(progress) {
  const { host, book, doc } = R;
  host.innerHTML = `<div class="reader-page-host" id="rHost"><div class="reader-content" id="rContent"></div></div>${chrome(book)}`;
  const hostEl = document.getElementById('rHost');
  const content = document.getElementById('rContent');
  applyVars(content, R.settings);

  // ensamblar capítulos
  let html = '';
  doc.chapters.forEach((c) => { html += `<section data-chapter="${c.id}" id="ch-${c.id}">${c.html}</section>`; });
  content.innerHTML = html;
  content.querySelectorAll('a[href]').forEach((a) => a.removeAttribute('href')); // evita navegación externa

  const isScroll = R.settings.pageAnimation === 'scroll';
  syncReflowBook(hostEl, isScroll);
  if (isScroll) {
    hostEl.style.overflowY = 'auto'; content.classList.remove('paged');
    content.style.position = 'static'; content.style.height = 'auto';
    restoreScroll(progress); attachScrollTracking(hostEl);
  } else {
    setupPaged(hostEl, content, progress);
  }
  applyHighlights(content);
  bindChrome(() => rebuildReflow(progress));
  bindReaderGestures(hostEl, isScroll);
  bindSlider(isScroll, hostEl);
  startImmersive();
}

function setupPaged(hostEl, content, progress) {
  content.classList.add('paged');
  content.style.position = 'absolute';
  const layout = () => {
    const W = hostEl.clientWidth;
    const m = R.settings.margin;
    const two = isLandscape();                    // horizontal → libro abierto (dos hojas)
    const desk = getDeskMargin(hostEl);           // margen de escritorio alrededor del libro
    const pad = desk + m;                          // borde de hoja + margen de texto
    content.style.width = W + 'px';
    content.style.height = hostEl.clientHeight + 'px';
    content.style.paddingLeft = pad + 'px';
    content.style.paddingRight = pad + 'px';
    if (two) {
      // Dos columnas pegadas al lomo central: cada una cae sobre su hoja.
      content.style.columnGap = (2 * m) + 'px';
      content.style.columnWidth = ((W - 2 * pad - 2 * m) / 2) + 'px';
    } else {
      content.style.columnGap = '0px';
      content.style.columnWidth = (W - 2 * pad) + 'px';
    }
    content.style.setProperty('--r-margin', '0px');
    document.getElementById('rBook')?.classList.toggle('spread', two);
    R.pageW = W;
    // recalcula tras layout
    requestAnimationFrame(() => {
      R.totalPages = Math.max(1, Math.round(content.scrollWidth / W));
      // restaura por porcentaje
      const pct = progress.percent || 0;
      R.page = Math.min(R.totalPages - 1, Math.round(pct * (R.totalPages - 1)));
      goToPage(R.page, 0);
      updateProgressUI();
    });
  };
  R._layout = layout;
  layout();
  window.addEventListener('resize', R._resize = debounce(() => { const pct = currentPercent(); progress.percent = pct; layout(); }, 200));
}

// Reflow: se traslada TODO el contenido en columnas.
// Medios (PDF/cómic): carrusel — cada página es una capa absoluta que se
// traslada por su cuenta (evita el bug de pintado de filas flex enormes).
function isLandscape() {
  if (document.documentElement.classList.contains('force-portrait')) return false; // bloqueo por software
  return window.innerWidth > window.innerHeight * 1.15;
}
function stepSize() { return (R.mediaPaged && R.spread) ? 2 : 1; }
function setPageTransform(content, page) {
  if (R.mediaPaged && content.id === 'rContent') {
    // translateX(%) es relativo al ancho de la celda (= una ranura, sea
    // pantalla completa o media en doble página): siempre 100% por ranura.
    content.querySelectorAll('.rpage').forEach((c) => { c.style.transform = `translateX(${(+c.dataset.i - page) * 100}%)`; });
  } else {
    content.style.transform = `translateX(${-page * R.pageW}px)`;
  }
}
function setMediaTransition(t) { document.querySelectorAll('#rContent .rpage').forEach((c) => { c.style.transition = t; }); }

function goToPage(page, animate = 1, dir = 1) {
  const content = document.getElementById('rContent');
  page = Math.max(0, Math.min(R.totalPages - 1, page));
  // renderiza la página destino cuanto antes (evita ver blanco tras el giro)
  if (R.renderCell && !R.rendered.has(page)) { R.rendered.add(page); R.renderCell(page); }
  if (page === R.page && animate) return;
  // En doble página, el giro 3D de una sola hoja no aplica: usamos deslizamiento.
  const anim = (R.mediaPaged && R.spread) ? 'slide' : R.settings.pageAnimation;
  if (!animate || anim === 'none') { R.page = page; content.style.transition = 'none'; if (R.mediaPaged) setMediaTransition('none'); setPageTransform(content, page); afterPageChange(); return; }
  if (anim === 'slide') {
    R.page = page;
    const tr = 'transform .32s cubic-bezier(.22,1,.36,1)';
    content.style.transition = tr; if (R.mediaPaged) setMediaTransition(tr);
    setPageTransform(content, page); afterPageChange(); return;
  }
  // realistic flip (pasa-página de libro real) — funciona en reflow y en PDF/cómic
  flipPage(page, dir);
}

// Construye la "cara" que gira: en medios (PDF/cómic) clona solo la página
// actual (una imagen, ligera); en reflow clona el contenido y lo desplaza.
function buildFace(pageIndex) {
  if (R.mediaPaged) {
    const cell = document.querySelector('#rContent .rpage[data-i="' + pageIndex + '"]');
    const face = cell ? cell.cloneNode(true) : document.createElement('div');
    face.style.position = 'absolute'; face.style.inset = '0'; face.style.transform = 'none'; face.style.margin = '0';
    if (!cell) face.style.background = 'var(--r-bg)';
    return face;
  }
  const clone = document.getElementById('rContent').cloneNode(true);
  clone.style.transition = 'none'; setPageTransform(clone, pageIndex);
  return clone;
}

function flipPage(newPage, dir) {
  const content = document.getElementById('rContent');
  const host = document.getElementById('rHost');
  const oldPage = R.page;
  const flip = document.createElement('div'); flip.className = 'page-flip';
  const face = document.createElement('div'); face.className = 'pf-face';
  const shade = document.createElement('div'); shade.className = 'pf-shade';
  if (R.mediaPaged) face.style.padding = '0';
  face.appendChild(buildFace(dir > 0 ? oldPage : newPage));
  flip.appendChild(face); flip.appendChild(shade);
  host.appendChild(flip);

  if (dir > 0) {
    // avanza: la página actual gira hacia el lomo (izq), revela la nueva debajo
    content.style.transition = 'none'; if (R.mediaPaged) setMediaTransition('none'); R.page = newPage; setPageTransform(content, newPage);
    flip.style.transform = 'rotateY(0deg)';
    requestAnimationFrame(() => { flip.style.transition = 'transform .52s cubic-bezier(.4,0,.2,1)'; flip.style.transform = 'rotateY(-178deg)'; shade.style.transition = 'opacity .52s'; shade.style.opacity = '1'; });
  } else {
    // retrocede: la página anterior se despliega desde el lomo
    flip.style.transformOrigin = 'left center';
    flip.style.transform = 'rotateY(-178deg)';
    requestAnimationFrame(() => { flip.style.transition = 'transform .52s cubic-bezier(.4,0,.2,1)'; flip.style.transform = 'rotateY(0deg)'; });
  }
  let finished = false;
  const done = () => {
    if (finished) return; finished = true;
    if (!R) { flip.remove(); return; }
    if (dir < 0) { content.style.transition = 'none'; if (R.mediaPaged) setMediaTransition('none'); R.page = newPage; setPageTransform(content, newPage); }
    flip.remove(); afterPageChange();
  };
  flip.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 640); // fallback
}

function afterPageChange() {
  if (!R) return;
  R.pagesReadCount++;
  if (R.onPageChange) R.onPageChange();
  updateProgressUI();
  saveProgressDebounced();
}

function nextPage() { const s = stepSize(); if (R.page < R.totalPages - 1) { haptic(4); goToPage(Math.min(R.totalPages - 1, R.page + s), 1, 1); } }
function prevPage() { const s = stepSize(); if (R.page > 0) { haptic(4); goToPage(Math.max(0, R.page - s), 1, -1); } }

function currentPercent() {
  if (!R) return 0;
  if (R.settings.pageAnimation === 'scroll') { const h = document.getElementById('rHost'); return h && h.scrollHeight > h.clientHeight ? h.scrollTop / (h.scrollHeight - h.clientHeight) : 0; }
  return R.totalPages > 1 ? R.page / (R.totalPages - 1) : 0;
}
function updateProgressUI() {
  if (!R) return;
  const pct = currentPercent();
  const pctEl = document.getElementById('rPct'); const slider = document.getElementById('rSlider');
  const scroll = !R.mediaPaged && R.settings.pageAnimation === 'scroll';
  if (pctEl) pctEl.textContent = scroll ? Math.round(pct * 100) + '%' : `${R.page + 1}/${R.totalPages} · ${Math.round(pct * 100)}%`;
  if (slider) slider.value = Math.round(pct * 1000);
  const info = document.getElementById('rPageInfo');
  if (info) info.textContent = scroll ? `${Math.round(pct * 100)}%` : `${R.page + 1} · ${R.totalPages}`;
}

function rebuildReflow(progress) {
  // re-aplica ajustes y recalcula manteniendo porcentaje
  const content = document.getElementById('rContent');
  if (!content) return;
  progress.percent = currentPercent();
  applyVars(content, R.settings);
  R.host.dataset.rtheme = R.settings.readerTheme;
  const isScroll = R.settings.pageAnimation === 'scroll';
  const hostEl = document.getElementById('rHost');
  syncReflowBook(hostEl, isScroll);
  if (isScroll) { hostEl.style.overflowY = 'auto'; content.classList.remove('paged'); content.style.position = 'static'; content.style.transform = ''; content.style.height = 'auto'; }
  else if (R._layout) { hostEl.style.overflowY = 'hidden'; R._layout(); }
  applyBrightness();
}

/* ── Gestos y zonas táctiles (ratón + táctil) ── */
// Cuando el bloqueo por software rota la app -90°, el eje horizontal del
// contenido corresponde al eje vertical físico: convertimos coordenadas.
function rotatedLock() { return document.documentElement.classList.contains('force-portrait') && window.innerWidth > window.innerHeight; }
function logicalDelta(dxP, dyP) { return rotatedLock() ? { dx: -dyP, dy: dxP } : { dx: dxP, dy: dyP }; }
function logicalX(clientX, clientY) { return rotatedLock() ? { x: window.innerHeight - clientY, w: window.innerHeight } : { x: clientX, w: window.innerWidth }; }

function bindReaderGestures(hostEl, isScroll) {
  let sx = 0, sy = 0, moved = false, t0 = 0, suppressClick = false;
  hostEl.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = false; t0 = Date.now(); }, { passive: true });
  hostEl.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) moved = true; }, { passive: true });
  hostEl.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0]; const { dx, dy } = logicalDelta(t.clientX - sx, t.clientY - sy);
    if (window.getSelection && String(window.getSelection()).length) return;
    if (!isScroll && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { suppressClick = true; setTimeout(() => (suppressClick = false), 400); dx < 0 ? nextPage() : prevPage(); }
  }, { passive: true });
  // Zonas por clic: cubre ratón y el tap que sigue al touch
  hostEl.addEventListener('click', (e) => {
    if (suppressClick) return;
    if (e.target.closest('a, button, .txt-hl')) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    if (isScroll) { toggleChrome(); return; }
    const { x, w } = logicalX(e.clientX, e.clientY);
    if (settings.get('tapZones')) {
      if (x < w * 0.28) prevPage();
      else if (x > w * 0.72) nextPage();
      else toggleChrome();
    } else toggleChrome();
  });
  // teclado
  R._key = (e) => {
    if (!R || R.host.hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { nextPage(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { prevPage(); e.preventDefault(); }
    else if (e.key === 'Escape') closeReader();
  };
  window.addEventListener('keydown', R._key);
  // selección de texto → menú de subrayado
  hostEl.addEventListener('mouseup', onSelection);
  hostEl.addEventListener('touchend', () => setTimeout(onSelection, 10));
}

function toggleChrome(force) {
  if (R._autohide) { clearTimeout(R._autohide); R._autohide = null; }
  R.chromeVisible = force === undefined ? !R.chromeVisible : force;
  const vis = R.chromeVisible;
  document.getElementById('rTop')?.classList.toggle('hide', !vis);
  document.getElementById('rBottom')?.classList.toggle('hide', !vis);
  // El indicador persistente se oculta cuando la barra inferior está visible (evita solaparse)
  document.getElementById('rPageInfo')?.classList.toggle('hide', vis);
  document.getElementById('rRunhead')?.classList.toggle('hide', vis);
}
// Modo inmersivo: muestra los controles un momento al abrir y luego los oculta.
function startImmersive() {
  R.chromeVisible = true;
  if (R._autohide) clearTimeout(R._autohide);
  R._autohide = setTimeout(() => { if (R && R.chromeVisible) toggleChrome(false); }, 2600);
}

const READER_BG = { white: '#ffffff', sepia: '#f4ecd8', gray: '#33363b', amoled: '#000000', black: '#121212' };
let _savedThemeColors = null;
function setReaderThemeColor(rtheme) {
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  if (!_savedThemeColors) _savedThemeColors = metas.map((m) => ({ m, c: m.getAttribute('content'), media: m.getAttribute('media') }));
  metas.forEach((m) => { m.removeAttribute('media'); m.setAttribute('content', READER_BG[rtheme] || '#f4ecd8'); });
}
function restoreThemeColor() {
  if (!_savedThemeColors) return;
  _savedThemeColors.forEach(({ m, c, media }) => { if (c != null) m.setAttribute('content', c); if (media) m.setAttribute('media', media); });
  _savedThemeColors = null;
}
function toggleFocus() { R.host.classList.toggle('focus'); toast(R.host.classList.contains('focus') ? 'Modo concentración' : 'Modo normal'); }

function bindSlider(isScroll, hostEl) {
  const slider = document.getElementById('rSlider');
  slider.oninput = () => {
    const pct = slider.value / 1000;
    if (isScroll) hostEl.scrollTop = pct * (hostEl.scrollHeight - hostEl.clientHeight);
    else { const p = Math.round(pct * (R.totalPages - 1)); goToPage(p, 0); }
    updateProgressUI();
  };
  slider.onchange = () => saveProgressDebounced();
}
function restoreScroll(progress) { requestAnimationFrame(() => { const h = document.getElementById('rHost'); h.scrollTop = (progress.percent || 0) * (h.scrollHeight - h.clientHeight); updateProgressUI(); }); }
function attachScrollTracking(hostEl) { hostEl.addEventListener('scroll', debounce(() => { updateProgressUI(); saveProgressDebounced(); }, 200), { passive: true }); }

/* ═════════ Motor paginado de medios (PDF y cómic) ═════════
   Una página por pantalla, deslizar/tocar para avanzar, con la MISMA
   animación de pasa-página de libro real que el modo reflow. */
function setupMediaPaged(progress, renderCell) {
  const { host } = R;
  host.innerHTML = `<div class="reader-page-host" id="rHost"><div class="reader-content media" id="rContent"></div></div>${chrome(R.book)}`;
  R.mediaPaged = true;
  const hostEl = document.getElementById('rHost');
  const content = document.getElementById('rContent');
  content.style.position = 'absolute'; content.style.inset = '0';
  // Lomo/pliegue central para que la doble página parezca un libro abierto.
  const book = document.createElement('div'); book.id = 'rBook'; book.className = 'reader-book media';
  hostEl.appendChild(book);   // por encima de las páginas (z-index en CSS)
  R.rendered = new Set();
  R.renderCell = renderCell;
  const applySpread = () => {
    const sp = false;   // siempre UNA sola página (también en horizontal, más grande)
    if (sp !== R.spread) { R.rendered = new Set(); content.querySelectorAll('.rpage').forEach((c) => c.innerHTML = ''); }
    R.spread = sp;
    content.classList.toggle('spread', sp);
    document.getElementById('rBook')?.classList.toggle('spread', sp);
    if (sp && R.page % 2 === 1) R.page--;   // alinea a página izquierda
  };
  const layout = () => {
    const newW = hostEl.clientWidth;
    const widthChanged = Math.abs(newW - (R.pageW || 0)) > 2;
    R.pageW = newW; applySpread();
    // al girar / cambiar de ancho, re-renderiza las hojas al nuevo tamaño
    if (widthChanged) { R.rendered = new Set(); content.querySelectorAll('.rpage').forEach((c) => c.innerHTML = ''); }
    setPageTransform(content, R.page); ensureCells(); updateProgressUI();
  };
  // Carrusel: cada página es una capa absoluta (a pantalla completa, o mitad en doble página).
  for (let i = 0; i < R.totalPages; i++) {
    const cell = document.createElement('div'); cell.className = 'rpage'; cell.dataset.i = i;
    content.appendChild(cell);
  }
  R.pageW = hostEl.clientWidth;
  R.page = Math.min(R.totalPages - 1, Math.max(0, Math.round((progress.percent || 0) * (R.totalPages - 1))));
  applySpread();
  setPageTransform(content, R.page);
  bindChrome(() => {});
  bindReaderGestures(hostEl, false);
  bindSlider(false, hostEl);
  R.onPageChange = () => ensureCells();
  R._resize = debounce(layout, 200); window.addEventListener('resize', R._resize);
  ensureCells();
  updateProgressUI();
  startImmersive();
}
function ensureCells() {
  if (!R || !R.renderCell) return;
  for (let i = R.page - 2; i <= R.page + 4; i++) {
    if (i < 0 || i >= R.totalPages || R.rendered.has(i)) continue;
    R.rendered.add(i);
    R.renderCell(i);
  }
  // libera páginas lejanas para no agotar memoria en PDF grandes
  for (const i of [...R.rendered]) {
    if (i < R.page - 6 || i > R.page + 7) {
      const cell = document.querySelector('#rContent .rpage[data-i="' + i + '"]');
      if (cell) { const img = cell.querySelector('img'); if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); cell.innerHTML = ''; }
      R.rendered.delete(i);
    }
  }
}

/* ═════════ Lector PDF (paginado) ═════════ */
async function buildPdfReader(progress) {
  const { doc } = R;
  R.pdf = doc.pdfDoc; R.numPages = doc.numPages; R.totalPages = doc.numPages; R.zoom = (progress.pdfZoom || 1); R.kind = 'pdf';
  setupMediaPaged(progress, renderPdfCell);
  R._toc = doc.toc;
}
// Detecta el recuadro de CONTENIDO (recorta márgenes en blanco/transparentes).
// Devuelve fracciones [0..1] de la página, o null si no se puede analizar.
function detectContentBox(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const o0 = 0;                                   // esquina sup-izq = fondo
    const br = data[o0], bgc = data[o0 + 1], bb = data[o0 + 2], ba = data[o0 + 3];
    const transparentBg = ba < 16;
    const thr = 30;
    const isInk = (o) => {
      const a = data[o + 3];
      if (transparentBg) return a > 16;             // fondo transparente → tinta = algo pintado
      if (a < 16) return false;
      return Math.abs(data[o] - br) > thr || Math.abs(data[o + 1] - bgc) > thr || Math.abs(data[o + 2] - bb) > thr;
    };
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (isInk(row + x * 4)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    }
    if (maxX < 0) return null;                       // página en blanco
    const padX = w * 0.014, padY = h * 0.014;        // respiro mínimo alrededor
    minX = Math.max(0, minX - padX); minY = Math.max(0, minY - padY);
    maxX = Math.min(w, maxX + padX); maxY = Math.min(h, maxY + padY);
    return { x: minX / w, y: minY / h, w: (maxX - minX) / w, h: (maxY - minY) / h };
  } catch (_) { return null; }                       // canvas contaminado, etc.
}

async function renderPdfCell(i) {
  const cell = document.querySelector('#rContent .rpage[data-i="' + i + '"]');
  if (!cell) return;
  if (!cell.querySelector('canvas')) cell.innerHTML = '<div class="spinner"></div>';
  try {
    const hostEl = document.getElementById('rHost');
    const pw = (R.pageW || hostEl?.clientWidth || 400);
    const zoom = R.zoom || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const page = await R.pdf.getPage(i + 1);
    const vp0 = page.getViewport({ scale: 1 });

    // ── Recorte de márgenes (una vez por página, cacheado): render pequeño +
    //    detección del recuadro de contenido, para que el TEXTO llene el ancho.
    let box = (R._trimBoxes ||= {})[i];
    if (!box) {
      const detS = 520 / vp0.width;
      const dvp = page.getViewport({ scale: detS });
      const dc = document.createElement('canvas');
      dc.width = Math.max(1, Math.round(dvp.width)); dc.height = Math.max(1, Math.round(dvp.height));
      await page.render({ canvasContext: dc.getContext('2d', { willReadFrequently: true }), viewport: dvp }).promise;
      box = detectContentBox(dc) || { x: 0, y: 0, w: 1, h: 1 };
      // si el recorte es minúsculo (falso positivo), usa la página entera
      if (box.w < 0.4 || box.h < 0.2) box = { x: 0, y: 0, w: 1, h: 1 };
      R._trimBoxes[i] = box;
    }
    const cx = box.x * vp0.width, cy = box.y * vp0.height;
    const cw = box.w * vp0.width, ch = box.h * vp0.height;

    // escala para que el CONTENIDO (no la hoja) llene el ancho, más el zoom manual
    const displayScale = (pw / cw) * zoom;
    let renderScale = displayScale * dpr;
    const maxDim = 4096;
    const big = Math.max(vp0.width, vp0.height) * renderScale;
    if (big > maxDim) renderScale *= maxDim / big;
    const vp = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width)); canvas.height = Math.max(1, Math.round(vp.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if (!R || !document.querySelector('#rContent .rpage[data-i="' + i + '"]')) return; // lector cerrado

    // Recuadro visible = contenido llenando el ancho; se desplaza en vertical.
    const clip = document.createElement('div');
    clip.style.cssText = `position:relative;width:100%;height:${ch * displayScale}px;overflow:hidden;margin:0 auto;`;
    canvas.style.cssText = `position:absolute;left:${-cx * displayScale}px;top:${-cy * displayScale}px;width:${vp0.width * displayScale}px;height:auto;`;
    clip.appendChild(canvas);
    cell.innerHTML = ''; cell.appendChild(clip);
    cell.style.overflowX = 'hidden'; cell.style.overflowY = 'auto';
  } catch (e) { R.rendered.delete(i); cell.innerHTML = '<div class="muted center" style="margin:auto;font-size:12px">No se pudo mostrar esta página</div>'; }
}
function pdfZoomSheet() {
  R.App.sheet(`<h3>Zoom</h3><div class="field"><input type="range" min="70" max="300" value="${Math.round((R.zoom||1)*100)}" id="_z"><div class="center muted" id="_zv">${Math.round((R.zoom||1)*100)}%</div></div><p class="muted" style="font-size:12px">Con zoom puedes desplazar la página con el dedo.</p>`);
  const z = document.getElementById('_z'); const zv = document.getElementById('_zv');
  z.oninput = () => { zv.textContent = z.value + '%'; };
  z.onchange = async () => { R.zoom = z.value / 100; R.rendered.clear(); document.querySelectorAll('#rContent .rpage').forEach((c) => c.innerHTML = ''); ensureCells(); saveProgressDebounced(); };
}

/* ═════════ Lector IMÁGENES / cómic (paginado) ═════════ */
function buildImagesReader(progress) {
  const { doc } = R;
  R.totalPages = doc.images.length; R.kind = 'images';
  setupMediaPaged(progress, (i) => {
    const cell = document.querySelector('#rContent .rpage[data-i="' + i + '"]');
    if (!cell || cell.firstChild) return;
    const img = new Image();
    img.onload = () => { if (cell.isConnected) { cell.innerHTML = ''; cell.appendChild(img); } };
    img.src = doc.images[i];  // CSS ajusta la página completa (contain)
    if (!cell.querySelector('img')) cell.innerHTML = '<div class="spinner"></div>';
  });
}

/* ═════════ TOC / Tipografía / Tema / Brillo / Notas ═════════ */
function openToc() {
  const toc = R.doc.toc || [];
  const body = toc.length ? toc.map((t, i) =>
    `<div class="toc-item" data-i="${i}">${esc(t.label || 'Sección ' + (i + 1))}</div>`).join('') : '<p class="muted center" style="padding:40px">Este libro no tiene índice.</p>';
  rSheet('Índice', body);
  document.querySelectorAll('#rSheet .toc-item').forEach((el) => el.onclick = () => { jumpToToc(toc[parseInt(el.dataset.i, 10)]); closeRSheet(); });
}
function jumpToToc(entry) {
  if (!entry) return;
  if (R.mediaPaged) { if (entry.page != null) goToPage(entry.page, 0); return; }
  const content = document.getElementById('rContent'); if (!content) return;
  const sec = content.querySelector(`#ch-${entry.chapterId}`) || (entry.anchor && content.querySelector('#' + CSS.escape(entry.anchor)));
  if (!sec) return;
  if (R.settings.pageAnimation === 'scroll') sec.scrollIntoView();
  else { const page = Math.floor(sec.offsetLeft / R.pageW); goToPage(page, 0); }
  saveProgressDebounced();
}

function openTypography(reRender) {
  const s = R.settings;
  const fonts = [
    ['Georgia, "Times New Roman", serif', 'Georgia'], ['"Iowan Old Style", Palatino, serif', 'Palatino'],
    ['-apple-system, system-ui, sans-serif', 'Sistema'], ['"Helvetica Neue", Arial, sans-serif', 'Helvetica'],
    ['"Courier New", monospace', 'Mono'], ['"OpenDyslexic", var(--r-font)', 'OpenDyslexic'],
  ];
  rSheet('Texto', `
    <div class="field"><label>Fuente</label><select id="tyFont">${fonts.map(([v, l]) => `<option value='${v}' ${s.fontFamily === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Tamaño · <span id="tySizeV">${s.fontSize}px</span></label><input type="range" id="tySize" min="12" max="34" value="${s.fontSize}"></div>
    <div class="field"><label>Interlineado · <span id="tyLhV">${s.lineHeight}</span></label><input type="range" id="tyLh" min="12" max="26" value="${Math.round(s.lineHeight*10)}"></div>
    <div class="field"><label>Márgenes · <span id="tyMgV">${s.margin}px</span></label><input type="range" id="tyMg" min="8" max="72" value="${s.margin}"></div>
    <div class="field"><label>Separación de palabras · <span id="tyWsV">${s.wordSpacing}</span></label><input type="range" id="tyWs" min="0" max="8" value="${Math.round(s.wordSpacing*10)}"></div>
    <div class="field"><label>Sangría de párrafo · <span id="tyInV">${s.textIndent}</span></label><input type="range" id="tyIn" min="0" max="30" value="${Math.round(s.textIndent*10)}"></div>
    <div class="field"><label>Alineación</label><div class="seg" id="tyAlign">
      ${['justify','left','center'].map((a) => `<button data-a="${a}" class="${s.textAlign === a ? 'on' : ''}">${ {justify:'Justificado',left:'Izquierda',center:'Centro'}[a]}</button>`).join('')}</div></div>
    <div class="field"><label>Animación de página</label><div class="seg" id="tyAnim">
      ${[['realistic','Libro'],['slide','Deslizar'],['scroll','Continuo'],['none','Ninguna']].map(([a,l]) => `<button data-a="${a}" class="${s.pageAnimation === a ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <button class="btn ghost block" id="tyPerBook">Aplicar solo a este libro</button>`);
  const upd = (k, v, disp) => { s[k] = v; if (disp) document.getElementById(disp).textContent = (k === 'margin' ? v + 'px' : k === 'fontSize' ? v + 'px' : v); persistReaderSetting(k, v); reRender(); };
  document.getElementById('tyFont').onchange = (e) => upd('fontFamily', e.target.value);
  bindRange('tySize', 'tySizeV', (v) => upd('fontSize', v, 'tySizeV'), (v) => v + 'px');
  bindRange('tyLh', 'tyLhV', (v) => upd('lineHeight', v / 10, 'tyLhV'), (v) => (v / 10).toFixed(1), true);
  bindRange('tyMg', 'tyMgV', (v) => upd('margin', v, 'tyMgV'), (v) => v + 'px');
  bindRange('tyWs', 'tyWsV', (v) => upd('wordSpacing', v / 10, 'tyWsV'), (v) => (v / 10).toFixed(1), true);
  bindRange('tyIn', 'tyInV', (v) => upd('textIndent', v / 10, 'tyInV'), (v) => (v / 10).toFixed(1), true);
  document.querySelectorAll('#tyAlign [data-a]').forEach((b) => b.onclick = () => { document.querySelectorAll('#tyAlign [data-a]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); upd('textAlign', b.dataset.a); });
  document.querySelectorAll('#tyAnim [data-a]').forEach((b) => b.onclick = () => { document.querySelectorAll('#tyAnim [data-a]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); s.pageAnimation = b.dataset.a; persistReaderSetting('pageAnimation', b.dataset.a); closeRSheet(); rebuildReflow({ percent: currentPercent() }); });
  document.getElementById('tyPerBook').onclick = async () => { const p = await models.getProgress(R.bookId); p.perBook = { ...(p.perBook || {}), ...s }; await models.saveProgress(p); toast('Ajustes guardados solo para este libro'); };
}
function bindRange(id, vid, cb, fmt, isFloat) { const el = document.getElementById(id); el.oninput = () => { const v = parseInt(el.value, 10); if (fmt) document.getElementById(vid).textContent = fmt(v); cb(v); }; }

function openThemePicker() {
  const themes = [['sepia', '#f4ecd8', '#4a3f2e'], ['white', '#ffffff', '#111'], ['gray', '#33363b', '#d7d9dc'], ['black', '#121212', '#ccc'], ['amoled', '#000', '#c8c6c2']];
  rSheet('Tema del lector', `<div class="swatches" style="justify-content:center;margin:20px 0">
    ${themes.map(([k, bg, fg]) => `<button class="swatch ${R.settings.readerTheme === k ? 'on' : ''}" data-t="${k}" style="background:${bg};color:${fg};border-color:${R.settings.readerTheme === k ? 'var(--coral)' : 'rgba(128,128,128,.4)'}">Aa</button>`).join('')}</div>
    <p class="muted center" style="font-size:12px">Sepia · Blanco · Gris · Negro · AMOLED</p>`);
  document.querySelectorAll('#rSheet [data-t]').forEach((b) => b.onclick = () => { R.settings.readerTheme = b.dataset.t; R.host.dataset.rtheme = b.dataset.t; setReaderThemeColor(b.dataset.t); persistReaderSetting('readerTheme', b.dataset.t); closeRSheet(); });
}

function openBrightness() {
  rSheet('Brillo y calidez', `
    <div class="field"><label>Brillo · <span id="brV">${Math.round(R.settings.brightness*100)}%</span></label><input type="range" id="brR" min="20" max="100" value="${Math.round(R.settings.brightness*100)}"></div>
    <div class="field"><label>Filtro cálido (noche) · <span id="wmV">${Math.round(R.settings.warmth*100)}%</span></label><input type="range" id="wmR" min="0" max="80" value="${Math.round(R.settings.warmth*100)}"></div>
    <p class="muted" style="font-size:12px">Independiente del brillo del sistema. Reduce la luz azul en tus lecturas nocturnas.</p>`);
  const br = document.getElementById('brR'), wm = document.getElementById('wmR');
  br.oninput = () => { R.settings.brightness = br.value / 100; document.getElementById('brV').textContent = br.value + '%'; applyBrightness(); persistReaderSetting('brightness', R.settings.brightness); };
  wm.oninput = () => { R.settings.warmth = wm.value / 100; document.getElementById('wmV').textContent = wm.value + '%'; applyBrightness(); persistReaderSetting('warmth', R.settings.warmth); };
}
function applyBrightness() {
  const dim = document.getElementById('rDim'); const warm = document.getElementById('rWarm');
  if (dim) dim.style.opacity = String(1 - (R.settings.brightness ?? 1));
  if (warm) warm.style.opacity = String((R.settings.warmth ?? 0) * 0.6);
}

function openNotes() { rSheet('Notas y subrayados', '<div id="notesPanel"></div>'); renderNotesPanel(document.getElementById('notesPanel'), R, jumpToHighlight); }

/* ── Subrayados ── */
function onSelection() {
  const sel = window.getSelection(); const text = String(sel).trim();
  document.getElementById('rHlMenu')?.remove();
  if (!text || text.length < 2 || R.settings.pageAnimation === 'scroll' && false) { /* permitir en ambos */ }
  if (!text || text.length < 2) return;
  const range = sel.getRangeAt(0); const rect = range.getBoundingClientRect();
  const menu = document.createElement('div'); menu.className = 'hl-menu'; menu.id = 'rHlMenu';
  menu.style.left = Math.min(window.innerWidth - 20, Math.max(20, rect.left + rect.width / 2)) + 'px';
  menu.style.top = (rect.top) + 'px';
  ['yellow','green','blue','pink','coral'].forEach((c) => { const b = document.createElement('button'); b.className = 'hl-' + c; b.onclick = () => doHighlight(text, c); menu.appendChild(b); });
  const note = document.createElement('button'); note.className = 'tool'; note.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4z"/></svg>'; note.onclick = () => doHighlight(text, 'yellow', true);
  menu.appendChild(note);
  R.host.appendChild(menu);
}
async function doHighlight(quote, color, withNote = false) {
  document.getElementById('rHlMenu')?.remove();
  let noteText = '';
  if (withNote) { noteText = await R.App.prompt('Nota', 'Escribe tu nota', '') || ''; }
  const chapterId = currentChapterId();
  await saveHighlight({ bookId: R.bookId, chapterId, quote, color, note: noteText });
  const content = document.getElementById('rContent'); if (content) applyHighlights(content);
  window.getSelection().removeAllRanges();
  toast(withNote ? 'Nota guardada' : 'Subrayado guardado');
  haptic(8);
}
function currentChapterId() {
  const content = document.getElementById('rContent'); if (!content) return '';
  const secs = content.querySelectorAll('section[data-chapter]');
  if (R.settings.pageAnimation === 'scroll') { const host = document.getElementById('rHost'); for (const s of secs) { if (s.offsetTop + s.offsetHeight > host.scrollTop) return s.dataset.chapter; } }
  else { const x = R.page * R.pageW; for (const s of secs) { if (s.offsetLeft + s.offsetWidth > x) return s.dataset.chapter; } }
  return secs[0]?.dataset.chapter || '';
}
async function applyHighlights(content) {
  const notes = await db.byIndex('notes', 'bookId', R.bookId);
  content.querySelectorAll('.txt-hl').forEach((el) => { el.replaceWith(document.createTextNode(el.textContent)); });
  notes.filter((n) => n.type === 'highlight').forEach((n) => wrapFirst(content, n.quote, n));
}
function wrapFirst(root, quote, note) {
  if (!quote) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const idx = node.nodeValue.indexOf(quote);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx); range.setEnd(node, idx + quote.length);
      const span = document.createElement('span');
      span.className = 'txt-hl'; span.style.background = hlColor(note.color); span.dataset.noteId = note.id;
      span.title = note.note || '';
      try { range.surroundContents(span); span.onclick = () => showNotePop(note); } catch (_) {}
      return;
    }
  }
}
function hlColor(c) { return { yellow:'rgba(255,213,74,.5)', green:'rgba(126,224,129,.5)', blue:'rgba(107,197,255,.5)', pink:'rgba(255,142,194,.5)', coral:'rgba(255,111,97,.5)' }[c] || 'rgba(255,213,74,.5)'; }
function showNotePop(note) { R.App.sheet(`<h3>${note.note ? 'Nota' : 'Subrayado'}</h3><div class="note-card"><div class="q">"${esc(note.quote)}"</div>${note.note ? `<div class="n">${esc(note.note)}</div>` : ''}</div><button class="btn ghost block" id="_del">Eliminar</button>`); document.getElementById('_del').onclick = async () => { await db.del('notes', note.id); R.App.closeModal(); const c = document.getElementById('rContent'); if (c) applyHighlights(c); }; }
function jumpToHighlight(note) {
  closeRSheet();
  const content = document.getElementById('rContent'); if (!content) return;
  const span = content.querySelector(`[data-note-id="${note.id}"]`);
  if (span) { if (R.settings.pageAnimation === 'scroll') span.scrollIntoView({ block: 'center' }); else { const page = Math.floor(span.offsetLeft / R.pageW); goToPage(page, 0); } }
}

async function addBookmark() {
  const chapterId = currentChapterId();
  await saveHighlight({ bookId: R.bookId, chapterId, quote: '', color: 'coral', note: '', type: 'bookmark', percent: currentPercent() });
  toast('Marcador añadido', { icon: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>' });
  haptic(10);
}

function openReaderMenu() {
  R.App.sheet(`<h3>${esc(R.book.title)}</h3><p class="sub">${esc(R.book.author || '')}</p>
    <div class="menu-list">
      <button data-a="focus"><svg viewBox="0 0 24 24"><path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4"/></svg>Modo concentración</button>
      <button data-a="finish"><svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>Marcar como terminado</button>
      <button data-a="tts"><svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15 9a3 3 0 010 6"/></svg>Leer en voz alta (TTS)</button>
      <button data-a="info"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4"/></svg>Detalles del libro</button>
    </div>`);
  document.getElementById('modalHost').querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.a; R.App.closeModal();
    if (a === 'focus') toggleFocus();
    else if (a === 'finish') { await models.setStatus(R.bookId, 'finished'); toast('¡Terminado! 🎉'); }
    else if (a === 'tts') startTTS();
    else if (a === 'info') showBookInfo();
  });
}
function showBookInfo() {
  const b = R.book;
  R.App.sheet(`<h3>Detalles</h3>
    <div class="set-list">
      ${infoRow('Título', b.title)}${infoRow('Autor', b.author)}${infoRow('Serie', b.series)}
      ${infoRow('Idioma', b.language)}${infoRow('Editorial', b.publisher)}${infoRow('Año', b.year)}
      ${infoRow('ISBN', b.isbn)}${infoRow('Categoría', b.category)}${infoRow('Formato', (b.format || '').toUpperCase())}
      ${infoRow('Tamaño', (b.size/1048576).toFixed(2) + ' MB')}</div>
    ${b.description ? `<p class="muted" style="margin-top:14px;font-size:13px;line-height:1.6">${esc(b.description)}</p>` : ''}`);
}
function infoRow(k, v) { return v ? `<div class="set-item"><div class="si-body"><h4>${k}</h4><p>${esc(v)}</p></div></div>` : ''; }

/* ── TTS ── */
function startTTS() {
  if (!('speechSynthesis' in window)) return toast('Tu navegador no soporta lectura en voz alta');
  const content = document.getElementById('rContent');
  let text = '';
  if (content) { const secs = content.querySelectorAll('section'); const cid = currentChapterId(); const sec = content.querySelector(`[data-chapter="${cid}"]`) || secs[0]; text = (sec?.textContent || '').slice(0, 6000); }
  if (!text) return toast('Nada que leer aquí');
  const u = new SpeechSynthesisUtterance(text);
  u.rate = settings.get('ttsRate') || 1; u.lang = R.book.language || 'es';
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  toast('Leyendo en voz alta… toca de nuevo para parar');
  R._tts = true;
}

/* ── R-Sheet (panel dentro del lector) ── */
function rSheet(title, bodyHtml) {
  closeRSheet();
  const el = document.createElement('div'); el.className = 'r-sheet'; el.id = 'rSheet';
  el.innerHTML = `<div class="r-sheet-head"><button class="icon-btn" id="rsClose"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h3>${title}</h3></div><div class="r-sheet-body">${bodyHtml}</div>`;
  R.host.appendChild(el);
  document.getElementById('rsClose').onclick = () => closeRSheet();
}
function closeRSheet() { document.getElementById('rSheet')?.remove(); }

/* ── Persistencia ── */
function persistReaderSetting(key, value) { settings.set(key, value); }
let _saveT = null;
function saveProgressDebounced() { clearTimeout(_saveT); _saveT = setTimeout(saveProgressNow, 500); }
async function saveProgressNow() {
  if (!R) return;
  const p = await models.getProgress(R.bookId);
  p.percent = currentPercent();
  if (R.kind === 'pdf') { p.pdfPage = R.pdfPage || 1; p.pdfZoom = R.zoom || 1; }
  p.location = { chapterId: currentChapterIdSafe() };
  await models.saveProgress(p);
  const book = R.book;
  if (p.percent >= 0.99 && book.status !== 'finished') { await models.setStatus(R.bookId, 'finished'); }
}
function currentChapterIdSafe() { try { return currentChapterId(); } catch (_) { return ''; } }

async function closeReader() {
  if (!R) return;
  if (R._tts) speechSynthesis.cancel();
  await saveProgressNow();
  await models.endSession(currentPercent(), R.pagesReadCount);
  window.removeEventListener('keydown', R._key);
  window.removeEventListener('resize', R._resize);
  if (R._autohide) clearTimeout(R._autohide);
  restoreThemeColor();
  wakeLock(false);
  try { R.doc.pdfDoc && R.doc.pdfDoc.destroy(); } catch (_) {}
  (R.doc.resources || new Map()).forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
  (R.doc.images || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
  R.host.hidden = true; R.host.innerHTML = '';
  document.documentElement.style.overflow = '';
  const App = R.App; R = null;
  App.applyOrientation && App.applyOrientation();   // restaura el bloqueo vertical global
  await App.refresh(); App.render();
}

/* ── util ── */
let _wl = null;
async function wakeLock(on) {
  try {
    if (on && settings.get('keepScreenOn') && 'wakeLock' in navigator) _wl = await navigator.wakeLock.request('screen');
    else if (!on && _wl) { _wl.release(); _wl = null; }
  } catch (_) {}
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function esc(s = '') { return String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }
