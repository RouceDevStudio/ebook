/* settings.js — Ajustes: apariencia, lector, Coral (Nexus),
   accesibilidad, almacenamiento y copias de seguridad. */
import { settings, db } from './db.js';
import { storage } from './storage.js';
import * as models from './models.js';
import { coral, DEFAULT_CORAL_URL } from './coral.js';
import { toast } from './toast.js';

export async function render(container, App) {
  const est = await storage.estimate();
  const usedMB = (est.usage / 1048576).toFixed(1);
  const quotaMB = est.quota ? (est.quota / 1048576).toFixed(0) : '—';
  const st = coral.status();

  container.innerHTML = `
    <div class="section-title">Apariencia</div>
    <div class="card"><div class="field"><label>Tema de la app</label>
      <div class="seg" id="setTheme">
        ${['system','light','dark','amoled'].map((t) => `<button data-t="${t}" class="${settings.get('theme')===t?'on':''}">${ {system:'Auto',light:'Claro',dark:'Oscuro',amoled:'AMOLED'}[t]}</button>`).join('')}
      </div></div>
      ${toggleRow('haptics', 'Vibración sutil', 'Respuesta háptica al pasar página y tocar')}
    </div>

    <div class="section-title">Lector · valores por defecto</div>
    <div class="card">
      <div class="field"><label>Tema de lectura</label><select id="setRTheme">
        ${['sepia','white','gray','black','amoled'].map((t) => `<option value="${t}" ${settings.get('readerTheme')===t?'selected':''}>${ {sepia:'Sepia',white:'Blanco',gray:'Gris',black:'Negro',amoled:'AMOLED'}[t]}</option>`).join('')}</select></div>
      <div class="field"><label>Tamaño de letra · <span id="fsV">${settings.get('fontSize')}px</span></label><input type="range" id="setFs" min="12" max="34" value="${settings.get('fontSize')}"></div>
      <div class="field"><label>Animación de página</label><select id="setAnim">
        ${[['curl','Pliegue de esquina'],['realistic','Libro real (giro)'],['slide','Deslizar'],['scroll','Continuo'],['none','Ninguna']].map(([v,l]) => `<option value="${v}" ${settings.get('pageAnimation')===v?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Orientación</label><select id="setOrient">
        ${[['portrait','Vertical (bloqueada)'],['auto','Automática'],['landscape','Horizontal']].map(([v,l]) => `<option value="${v}" ${settings.get('orientation')===v?'selected':''}>${l}</option>`).join('')}</select></div>
      ${toggleRow('pdfReflow', 'Ajustar texto en PDF', 'Maqueta el PDF como ebook: llena la pantalla y letra ajustable (los escaneados se ven como imagen)')}
      ${toggleRow('tapZones', 'Zonas táctiles', 'Toca los bordes para pasar página')}
      ${toggleRow('keepScreenOn', 'Mantener pantalla encendida', 'Evita que se apague mientras lees')}
    </div>

    <div class="section-title">Coral · el cerebro</div>
    <div class="card">
      <div class="coral-say" style="box-shadow:none;border:none;padding:0 0 12px">
        <div class="av"><svg viewBox="0 0 24 24"><path d="M12 3c4.5 0 8 3 8 7 0 2.5-1.6 4-3 5-1 .7-1 2-1 3H8c0-1 0-2.3-1-3-1.4-1-3-2.5-3-5 0-4 3.5-7 8-7z"/></svg></div>
        <div class="txt">${st.label}. Coral se conecta <b>automáticamente</b> — no tienes que configurar nada. Completa metadatos y portadas con IA y organiza tu biblioteca.</div>
      </div>
      <div class="field"><label>Servidor Coral <span class="muted" style="font-weight:400">· avanzado (opcional)</span></label><input id="setCoralUrl" placeholder="${attr(DEFAULT_CORAL_URL)} · automático" value="${attr(settings.get('coralUrl'))}"><p class="muted" style="font-size:12px;margin:6px 2px 0">Déjalo vacío para usar Coral automáticamente. Pon tu propio Nexus para usarlo, o escribe <b>off</b> para desconectar.</p></div>
      <div class="field"><label>Token (opcional)</label><input id="setCoralToken" placeholder="Bearer token si tu Coral lo pide" value="${attr(settings.get('coralToken'))}"></div>
      <div class="row"><button class="btn ghost" id="testCoral">Probar conexión</button><button class="btn" id="saveCoral">Guardar</button></div>
      ${toggleRow('autoCovers', 'Carátulas automáticas', 'Descarga portadas al importar')}
    </div>

    <div class="section-title">Accesibilidad</div>
    <div class="card">
      ${toggleRow('dyslexia', 'Modo dislexia', 'Fuente y espaciado más legibles')}
      ${toggleRow('highContrast', 'Alto contraste', 'Aumenta el contraste del texto')}
      <div class="field"><label>Velocidad de lectura en voz alta · <span id="ttsV">${settings.get('ttsRate')}×</span></label><input type="range" id="setTts" min="5" max="20" value="${Math.round(settings.get('ttsRate')*10)}"></div>
    </div>

    <div class="section-title">Fuentes</div>
    <div class="card">
      <div class="set-item"><div class="si-ic"><svg viewBox="0 0 24 24"><path d="M4 20l6-14 6 14M6 15h8"/></svg></div>
        <div class="si-body"><h4>Instalar fuente</h4><p>Importa un .ttf/.otf/.woff para leer con ella</p></div>
        <button class="btn ghost" id="impFont">Importar</button></div>
      <div id="fontList"></div>
    </div>

    <div class="section-title">Almacenamiento y copias</div>
    <div class="card">
      <div class="set-item"><div class="si-ic"><svg viewBox="0 0 24 24"><path d="M4 7h16v10H4z"/></svg></div>
        <div class="si-body"><h4>${usedMB} MB usados</h4><p>de ${quotaMB} MB · ${storage.hasOPFS() ? 'OPFS activo' : 'IndexedDB'}</p></div></div>
      <div class="menu-list">
        <button data-a="backup"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M4 21h16"/></svg>Exportar copia de seguridad completa (.zip)</button>
        <button data-a="backupJson"><svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/></svg>Exportar solo datos (.json)</button>
        <button data-a="restore"><svg viewBox="0 0 24 24"><path d="M12 21V9M8 13l4-4 4 4M4 3h16"/></svg>Restaurar desde archivo</button>
      </div>
    </div>

    <div class="section-title">Acerca de</div>
    <div class="card">
      <p style="margin:0 0 6px"><b>Coral Reader</b> · v1.0.0</p>
      <p class="muted" style="font-size:13px;line-height:1.6;margin:0">El sistema operativo para lectores. La PWA es la interfaz; Coral es el cerebro. Funciona 100% offline: tus libros nunca salen de tu dispositivo.</p>
      <div class="pillrow"><span class="tag">PWA</span><span class="tag">Offline</span><span class="tag">IndexedDB + OPFS</span><span class="tag">Sin rastreo</span></div>
      <button class="btn ghost block" id="wipe" style="margin-top:14px;color:#e5484d">Borrar todos los datos</button>
    </div>
    <div style="height:20px"></div>`;

  // Apariencia
  container.querySelectorAll('#setTheme [data-t]').forEach((b) => b.onclick = () => { settings.set('theme', b.dataset.t); App.applyTheme(); render(container, App); });
  bindToggles(container, App);
  // Lector
  container.querySelector('#setRTheme').onchange = (e) => { settings.set('readerTheme', e.target.value); App.applyTheme(); };
  const fs = container.querySelector('#setFs'); fs.oninput = () => { container.querySelector('#fsV').textContent = fs.value + 'px'; }; fs.onchange = () => settings.set('fontSize', parseInt(fs.value, 10));
  container.querySelector('#setAnim').onchange = (e) => settings.set('pageAnimation', e.target.value);
  container.querySelector('#setOrient').onchange = (e) => { settings.set('orientation', e.target.value); App.applyOrientation(); toast(e.target.value === 'portrait' ? 'Orientación bloqueada en vertical' : 'Orientación: ' + e.target.value); };
  const tts = container.querySelector('#setTts'); tts.oninput = () => { container.querySelector('#ttsV').textContent = (tts.value / 10) + '×'; }; tts.onchange = () => settings.set('ttsRate', tts.value / 10);
  // Coral
  container.querySelector('#saveCoral').onclick = () => { settings.set('coralUrl', container.querySelector('#setCoralUrl').value.trim()); settings.set('coralToken', container.querySelector('#setCoralToken').value.trim()); toast('Conexión Coral guardada'); render(container, App); };
  container.querySelector('#testCoral').onclick = async () => {
    const typed = container.querySelector('#setCoralUrl').value.trim();
    const url = (typed && typed.toLowerCase() !== 'off') ? typed.replace(/\/$/, '') : (typed.toLowerCase() === 'off' ? '' : coral.baseUrl());
    if (!url) return toast('Coral está desconectado (escrito "off")');
    const t = toast('Probando…', { duration: 15000, icon: '<div class="spinner"></div>' });
    try { const r = await fetch(url + '/health'); t.remove(); toast(r.ok ? '✅ Coral responde' : `Responde ${r.status}`); }
    catch (e) { t.remove(); toast('No se pudo conectar: ' + e.message); }
  };
  // Fuentes
  container.querySelector('#impFont').onclick = () => importFont(container, App);
  renderFonts(container.querySelector('#fontList'));
  // Backups
  container.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'backup') exportZip();
    else if (a === 'backupJson') exportJson();
    else if (a === 'restore') restore(App);
  });
  container.querySelector('#wipe').onclick = async () => {
    if (await App.confirm('Borrar todo', 'Se eliminarán TODOS tus libros, notas y estadísticas de este dispositivo. No se puede deshacer.', 'Borrar todo', true)) {
      for (const s of ['books','progress','notes','sessions','collections','folders','covers','blobs']) await db.clear(s);
      toast('Datos borrados'); setTimeout(() => location.reload(), 800);
    }
  };
}

function toggleRow(key, title, sub) {
  const on = settings.get(key);
  return `<div class="set-item"><div class="si-body"><h4>${title}</h4><p>${sub}</p></div>
    <div class="toggle ${on ? 'on' : ''}" data-toggle="${key}"></div></div>`;
}
function bindToggles(container, App) {
  container.querySelectorAll('[data-toggle]').forEach((t) => t.onclick = () => {
    const k = t.dataset.toggle; const v = !settings.get(k); settings.set(k, v); t.classList.toggle('on', v);
    if (['dyslexia', 'highContrast'].includes(k)) App.applyTheme();
  });
}

/* ── Fuentes ── */
function importFont(container, App) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.ttf,.otf,.woff,.woff2';
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    const name = f.name.replace(/\.[^.]+$/, '');
    const fonts = settings.get('installedFonts') || [];
    fonts.push({ name, dataUrl });
    await settings.set('installedFonts', fonts);
    injectFont(name, dataUrl);
    toast(`Fuente «${name}» instalada`);
    render(container, App);
  };
  input.click();
}
function renderFonts(el) {
  const fonts = settings.get('installedFonts') || [];
  fonts.forEach((f) => injectFont(f.name, f.dataUrl));
  el.innerHTML = fonts.length ? fonts.map((f) => `<div class="set-item"><div class="si-body"><h4 style="font-family:'${f.name}'">${f.name}</h4><p>Instalada</p></div></div>`).join('') : '';
}
export function injectFont(name, dataUrl) {
  if (document.getElementById('font-' + name)) return;
  const st = document.createElement('style'); st.id = 'font-' + name;
  st.textContent = `@font-face{font-family:'${name}';src:url('${dataUrl}');font-display:swap}`;
  document.head.appendChild(st);
}

/* ── Copias de seguridad ── */
async function collectData() {
  return {
    version: 1, exportedAt: Date.now(),
    books: await db.all('books'), progress: await db.all('progress'),
    notes: await db.all('notes'), sessions: await db.all('sessions'),
    collections: await db.all('collections'), folders: await db.all('folders'),
    settings: await db.all('settings'),
  };
}
async function exportJson() {
  const data = await collectData();
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'coral-backup.json');
  toast('Datos exportados');
}
async function exportZip() {
  const t = toast('Creando copia completa…', { duration: 600000, icon: '<div class="spinner"></div>' });
  try {
    const data = await collectData();
    const files = { 'manifest.json': strToU8(JSON.stringify(data)) };
    for (const b of data.books) {
      const blob = await storage.getBook(b.id); if (blob) files['books/' + b.id] = new Uint8Array(await blob.arrayBuffer());
      const cover = await storage.getCover(b.id); if (cover) files['covers/' + b.id] = new Uint8Array(await cover.arrayBuffer());
    }
    const zipped = await new Promise((res, rej) => fflate.zip(files, { level: 0 }, (e, d) => e ? rej(e) : res(d)));
    t.remove();
    download(new Blob([zipped], { type: 'application/zip' }), 'coral-biblioteca.zip');
    toast('Copia completa lista');
  } catch (e) { t.remove(); toast('Error: ' + e.message); }
}
function restore(App) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.zip';
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    const t = toast('Restaurando…', { duration: 600000, icon: '<div class="spinner"></div>' });
    try {
      if (f.name.endsWith('.zip')) await restoreZip(f); else await restoreJson(f);
      t.remove(); toast('Restaurado'); await App.refresh(); setTimeout(() => location.reload(), 700);
    } catch (e) { t.remove(); toast('Error al restaurar: ' + e.message); }
  };
  input.click();
}
async function restoreJson(file) {
  const data = JSON.parse(await file.text());
  await applyData(data);
}
async function restoreZip(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  const files = await new Promise((res, rej) => fflate.unzip(u8, (e, d) => e ? rej(e) : res(d)));
  const data = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  await applyData(data);
  for (const b of data.books) {
    if (files['books/' + b.id]) await storage.saveBook(b.id, new Blob([files['books/' + b.id]]));
    if (files['covers/' + b.id]) await storage.saveCover(b.id, new Blob([files['covers/' + b.id]], { type: 'image/jpeg' }));
  }
}
async function applyData(data) {
  if (data.books) await db.bulkPut('books', data.books);
  if (data.progress) await db.bulkPut('progress', data.progress);
  if (data.notes) await db.bulkPut('notes', data.notes);
  if (data.sessions) await db.bulkPut('sessions', data.sessions);
  if (data.collections) await db.bulkPut('collections', data.collections);
  if (data.folders) await db.bulkPut('folders', data.folders);
  if (data.settings) await db.bulkPut('settings', data.settings);
}

function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function strToU8(s) { return new TextEncoder().encode(s); }
function attr(s = '') { return String(s || '').replace(/"/g, '&quot;'); }
