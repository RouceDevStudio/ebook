/* ══════════════════════════════════════════════════
   parsers/index.js — Detección de formato y despacho.
   Cada parser expone:  open(file) -> doc   y  meta(file) -> {meta, coverBlob}
   ══════════════════════════════════════════════════ */
import * as epub from './epub.js';
import * as pdf from './pdf.js';
import * as txt from './txt.js';
import * as md from './markdown.js';
import * as html from './html.js';
import * as fb2 from './fb2.js';
import * as cbz from './cbz.js';
import * as docx from './docx.js';
import * as mobi from './mobi.js';

const BY_EXT = {
  epub, pdf,
  txt, text: txt,
  md, markdown: md, mdx: md,
  html, htm: html, xhtml: html,
  fb2,
  cbz, cbr: cbz,           // cbr intenta zip; si es rar, avisa
  docx,
  mobi, azw: mobi, azw3: mobi, prc: mobi,
};

export const SUPPORTED = Object.keys(BY_EXT);

export function extOf(name = '') {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function formatLabel(ext) {
  const map = { epub:'EPUB', pdf:'PDF', mobi:'MOBI', azw:'AZW', azw3:'AZW3', prc:'PRC',
    cbz:'CBZ', cbr:'CBR', fb2:'FB2', txt:'TXT', md:'MD', markdown:'MD', html:'HTML', htm:'HTML',
    docx:'DOCX' };
  return map[ext] || (ext || '?').toUpperCase();
}

function pick(file) {
  const ext = extOf(file.name);
  const p = BY_EXT[ext];
  if (!p) throw new Error(`Formato no soportado: .${ext}`);
  return { p, ext };
}

export async function extractMeta(file) {
  const { p, ext } = pick(file);
  const r = await p.meta(file);
  return {
    format: ext,
    meta: r.meta || {},
    coverBlob: r.coverBlob || null,
    kind: r.kind || p.kind || 'reflow',
  };
}

export async function openBook(file) {
  const { p, ext } = pick(file);
  const doc = await p.open(file);
  doc.format = ext;
  return doc;
}

/* Utilidad compartida: intenta deducir título/autor del nombre de archivo */
export function guessFromFilename(name) {
  let base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  // patrones "Autor - Título" o "Título - Autor"
  let author = '', title = base, series = '', volume = null;
  const seriesM = base.match(/\b(vol(?:umen|ume)?|tomo|book|parte|part)\s*\.?\s*(\d{1,3})\b/i);
  if (seriesM) volume = parseInt(seriesM[2], 10);
  const dash = base.split(/\s+[-–—]\s+/);
  if (dash.length === 2) {
    // heurística: si la primera parte parece nombre propio (2-3 palabras capitalizadas) → autor
    const [a, b] = dash;
    if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ.]+){1,2}$/.test(a.trim())) { author = a.trim(); title = b.trim(); }
    else { title = a.trim(); author = b.trim(); }
  }
  title = title.replace(/\s{2,}/g, ' ').trim();
  return { title, author, series, volume };
}
