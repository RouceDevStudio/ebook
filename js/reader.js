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

  models.startSession(bookId, progress.percent || 0);
  wakeLock(true);

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
  <div class="reader-chrome reader-bottom" id="rBottom">
    <div class="reader-progress"><input type="range" id="rSlider" min="0" max="1000" value="0"><span class="pct" id="rPct">0%</span></div>
    <div class="reader-toolbar">
      <button id="tbToc"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span>Índice</span></button>
      <button id="tbAa"><svg viewBox="0 0 24 24"><path d="M4 20l6-14 6 14M6 15h8"/></svg><span>Texto</span></button>
      <button id="tbTheme"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 100 18 7 7 0 010-14 5 5 0 000 10"/></svg><span>Tema</span></button>
      <button id="tbLight"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg><span>Brillo</span></button>
      <button id="tbNotes"><svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4z"/></svg><span>Notas</span></button>
      <button id="tbFocus"><svg viewBox="0 0 24 24"><path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4"/></svg><span>Enfoque</span></button>
    </div>
  </div>`;
}

function bindChrome(reRender) {
  const $ = (id) => document.getElementById(id);
  $('rClose').onclick = () => closeReader();
  $('rMenu').onclick = () => openReaderMenu();
  $('rBookmark').onclick = () => addBookmark();
  $('tbToc').onclick = () => openToc();
  $('tbAa').onclick = () => openTypography(reRender);
  $('tbTheme').onclick = () => openThemePicker();
  $('tbLight').onclick = () => openBrightness();
  $('tbNotes').onclick = () => openNotes();
  $('tbFocus').onclick = () => toggleFocus();
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
}

function setupPaged(hostEl, content, progress) {
  content.classList.add('paged');
  content.style.position = 'absolute';
  const layout = () => {
    const W = hostEl.clientWidth;
    const m = R.settings.margin;
    content.style.width = W + 'px';
    content.style.height = hostEl.clientHeight + 'px';
    content.style.columnWidth = (W - 2 * m) + 'px';
    content.style.columnGap = (2 * m) + 'px';
    content.style.paddingLeft = m + 'px';
    content.style.paddingRight = m + 'px';
    content.style.setProperty('--r-margin', '0px');
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

function setPageTransform(content, page) { content.style.transform = `translateX(${-page * R.pageW}px)`; }

function goToPage(page, animate = 1, dir = 1) {
  const content = document.getElementById('rContent');
  page = Math.max(0, Math.min(R.totalPages - 1, page));
  if (page === R.page && animate) return;
  const anim = R.settings.pageAnimation;
  if (!animate || anim === 'none') { R.page = page; content.style.transition = 'none'; setPageTransform(content, page); afterPageChange(); return; }
  if (anim === 'slide') {
    R.page = page; content.style.transition = 'transform .32s cubic-bezier(.22,1,.36,1)'; setPageTransform(content, page); afterPageChange(); return;
  }
  // realistic flip
  flipPage(content, page, dir);
}

function flipPage(content, newPage, dir) {
  const host = document.getElementById('rHost');
  const oldPage = R.page;
  const flip = document.createElement('div'); flip.className = 'page-flip';
  const face = document.createElement('div'); face.className = 'pf-face';
  const shade = document.createElement('div'); shade.className = 'pf-shade';
  const clone = content.cloneNode(true);
  clone.style.transition = 'none';
  face.appendChild(clone); flip.appendChild(face); flip.appendChild(shade);
  host.appendChild(flip);

  if (dir > 0) {
    // avanza: la página vieja gira hacia el lomo (izq), revela la nueva debajo
    setPageTransform(clone, oldPage);
    content.style.transition = 'none'; R.page = newPage; setPageTransform(content, newPage);
    flip.style.transform = 'rotateY(0deg)';
    requestAnimationFrame(() => { flip.style.transition = 'transform .5s cubic-bezier(.4,0,.2,1)'; flip.style.transform = 'rotateY(-175deg)'; shade.style.transition = 'opacity .5s'; shade.style.opacity = '1'; });
  } else {
    // retrocede: la página nueva se despliega desde el lomo
    setPageTransform(clone, newPage);
    flip.style.transformOrigin = 'left center';
    flip.style.transform = 'rotateY(-175deg)';
    requestAnimationFrame(() => { flip.style.transition = 'transform .5s cubic-bezier(.4,0,.2,1)'; flip.style.transform = 'rotateY(0deg)'; });
  }
  let finished = false;
  const done = () => {
    if (finished) return; finished = true;
    if (!R) { flip.remove(); return; }
    if (dir < 0) { content.style.transition = 'none'; R.page = newPage; setPageTransform(content, newPage); }
    flip.remove(); afterPageChange();
  };
  flip.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 620); // fallback
}

function afterPageChange() {
  if (!R) return;
  R.pagesReadCount++;
  updateProgressUI();
  saveProgressDebounced();
}

function nextPage() { if (R.page < R.totalPages - 1) { haptic(4); goToPage(R.page + 1, 1, 1); } }
function prevPage() { if (R.page > 0) { haptic(4); goToPage(R.page - 1, 1, -1); } }

function currentPercent() {
  if (!R) return 0;
  if (R.settings.pageAnimation === 'scroll') { const h = document.getElementById('rHost'); return h && h.scrollHeight > h.clientHeight ? h.scrollTop / (h.scrollHeight - h.clientHeight) : 0; }
  return R.totalPages > 1 ? R.page / (R.totalPages - 1) : 0;
}
function updateProgressUI() {
  if (!R) return;
  const pct = currentPercent();
  const pctEl = document.getElementById('rPct'); const slider = document.getElementById('rSlider');
  if (pctEl) pctEl.textContent = R.settings.pageAnimation === 'scroll' ? Math.round(pct * 100) + '%' : `${R.page + 1}/${R.totalPages} · ${Math.round(pct * 100)}%`;
  if (slider) slider.value = Math.round(pct * 1000);
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
  if (isScroll) { hostEl.style.overflowY = 'auto'; content.classList.remove('paged'); content.style.position = 'static'; content.style.transform = ''; content.style.height = 'auto'; }
  else if (R._layout) { hostEl.style.overflowY = 'hidden'; R._layout(); }
  applyBrightness();
}

/* ── Gestos y zonas táctiles (ratón + táctil) ── */
function bindReaderGestures(hostEl, isScroll) {
  let sx = 0, sy = 0, moved = false, t0 = 0, suppressClick = false;
  hostEl.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = false; t0 = Date.now(); }, { passive: true });
  hostEl.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) moved = true; }, { passive: true });
  hostEl.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0]; const dx = t.clientX - sx; const dy = t.clientY - sy;
    if (window.getSelection && String(window.getSelection()).length) return;
    if (!isScroll && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { suppressClick = true; setTimeout(() => (suppressClick = false), 400); dx < 0 ? nextPage() : prevPage(); }
  }, { passive: true });
  // Zonas por clic: cubre ratón y el tap que sigue al touch
  hostEl.addEventListener('click', (e) => {
    if (suppressClick) return;
    if (e.target.closest('a, button, .txt-hl')) return;
    if (window.getSelection && String(window.getSelection()).length) return;
    if (isScroll) { toggleChrome(); return; }
    const x = e.clientX, w = window.innerWidth;
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

function toggleChrome() {
  R.chromeVisible = !R.chromeVisible;
  document.getElementById('rTop')?.classList.toggle('hide', !R.chromeVisible);
  document.getElementById('rBottom')?.classList.toggle('hide', !R.chromeVisible);
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

/* ═════════ Lector PDF ═════════ */
async function buildPdfReader(progress) {
  const { host, book, doc } = R;
  host.innerHTML = `<div class="reader-canvas-host" id="rCanvasHost"></div>${chrome(book)}`;
  const ch = document.getElementById('rCanvasHost');
  R.pdf = doc.pdfDoc; R.numPages = doc.numPages; R.zoom = (progress.pdfZoom || 1);
  bindChrome(() => {});
  document.getElementById('tbAa').innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 21l-4-4M11 8v6M8 11h6"/><circle cx="11" cy="11" r="7"/></svg><span>Zoom</span>';
  document.getElementById('tbAa').onclick = () => pdfZoomSheet(ch);
  const placeholders = [];
  for (let i = 1; i <= R.numPages; i++) {
    const c = document.createElement('canvas'); c.dataset.page = i; c.style.width = '100%'; c.height = 10; ch.appendChild(c); placeholders.push(c);
  }
  const obs = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { renderPdfPage(parseInt(e.target.dataset.page, 10), e.target); obs.unobserve(e.target); } }), { root: ch, rootMargin: '300px' });
  placeholders.forEach((c) => obs.observe(c));
  // progreso
  ch.addEventListener('scroll', debounce(() => {
    const pct = ch.scrollHeight > ch.clientHeight ? ch.scrollTop / (ch.scrollHeight - ch.clientHeight) : 0;
    R.pdfPage = Math.max(1, Math.round(pct * R.numPages));
    document.getElementById('rPct').textContent = `${R.pdfPage}/${R.numPages} · ${Math.round(pct * 100)}%`;
    document.getElementById('rSlider').value = Math.round(pct * 1000);
    saveProgressDebounced();
  }, 150), { passive: true });
  document.getElementById('rSlider').oninput = (e) => { const pct = e.target.value / 1000; ch.scrollTop = pct * (ch.scrollHeight - ch.clientHeight); };
  bindChromeToggleOnTap(ch);
  requestAnimationFrame(() => { ch.scrollTop = (progress.percent || 0) * (ch.scrollHeight - ch.clientHeight); });
  R._toc = doc.toc;
}
async function renderPdfPage(num, canvas) {
  try {
    const page = await R.pdf.getPage(num);
    const host = document.getElementById('rCanvasHost');
    const baseW = Math.min(host.clientWidth - 10, 900);
    const vp0 = page.getViewport({ scale: 1 });
    const scale = (baseW / vp0.width) * (R.zoom || 1) * (window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale });
    canvas.width = vp.width; canvas.height = vp.height; canvas.height = vp.height;
    canvas.style.width = (vp.width / (window.devicePixelRatio || 1)) + 'px';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  } catch (_) {}
}
function pdfZoomSheet(ch) {
  R.App.sheet(`<h3>Zoom</h3><div class="field"><input type="range" min="50" max="300" value="${Math.round((R.zoom||1)*100)}" id="_z"><div class="center muted" id="_zv">${Math.round((R.zoom||1)*100)}%</div></div>`);
  const z = document.getElementById('_z'); const zv = document.getElementById('_zv');
  z.oninput = () => { zv.textContent = z.value + '%'; };
  z.onchange = async () => { R.zoom = z.value / 100; ch.querySelectorAll('canvas').forEach((c) => { c.height = 10; }); ch.querySelectorAll('canvas').forEach((c) => renderPdfPage(parseInt(c.dataset.page, 10), c)); saveProgressDebounced(); };
}

/* ═════════ Lector IMÁGENES (CBZ) ═════════ */
function buildImagesReader(progress) {
  const { host, book, doc } = R;
  host.innerHTML = `<div class="reader-canvas-host" id="rCanvasHost"></div>${chrome(book)}`;
  const ch = document.getElementById('rCanvasHost');
  doc.images.forEach((src, i) => { const img = new Image(); img.loading = 'lazy'; img.src = src; img.dataset.page = i; ch.appendChild(img); });
  bindChrome(() => {});
  bindChromeToggleOnTap(ch);
  ch.addEventListener('scroll', debounce(() => {
    const pct = ch.scrollHeight > ch.clientHeight ? ch.scrollTop / (ch.scrollHeight - ch.clientHeight) : 0;
    document.getElementById('rPct').textContent = `${Math.round(pct * (doc.images.length))}/${doc.images.length}`;
    document.getElementById('rSlider').value = Math.round(pct * 1000);
    saveProgressDebounced();
  }, 150), { passive: true });
  document.getElementById('rSlider').oninput = (e) => { ch.scrollTop = (e.target.value / 1000) * (ch.scrollHeight - ch.clientHeight); };
  requestAnimationFrame(() => { ch.scrollTop = (progress.percent || 0) * (ch.scrollHeight - ch.clientHeight); });
}
function bindChromeToggleOnTap(el) {
  let sy = 0, moved = false;
  el.addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; moved = false; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (Math.abs(e.touches[0].clientY - sy) > 10) moved = true; }, { passive: true });
  el.addEventListener('touchend', () => { if (!moved) toggleChrome(); }, { passive: true });
  el.addEventListener('click', (e) => { if (e.target === el) toggleChrome(); });
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
  if (R.kind === 'pdf' && entry.page != null) { const ch = document.getElementById('rCanvasHost'); const target = ch.querySelector(`canvas[data-page="${entry.page + 1}"]`); target && target.scrollIntoView(); return; }
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
  document.querySelectorAll('#rSheet [data-t]').forEach((b) => b.onclick = () => { R.settings.readerTheme = b.dataset.t; R.host.dataset.rtheme = b.dataset.t; persistReaderSetting('readerTheme', b.dataset.t); closeRSheet(); });
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
      <button data-a="finish"><svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>Marcar como terminado</button>
      <button data-a="tts"><svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15 9a3 3 0 010 6"/></svg>Leer en voz alta (TTS)</button>
      <button data-a="info"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4"/></svg>Detalles del libro</button>
    </div>`);
  document.getElementById('modalHost').querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.a; R.App.closeModal();
    if (a === 'finish') { await models.setStatus(R.bookId, 'finished'); toast('¡Terminado! 🎉'); }
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
  wakeLock(false);
  try { R.doc.pdfDoc && R.doc.pdfDoc.destroy(); } catch (_) {}
  (R.doc.resources || new Map()).forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
  (R.doc.images || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
  R.host.hidden = true; R.host.innerHTML = '';
  document.documentElement.style.overflow = '';
  const App = R.App; R = null;
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
