/* txt.js — texto plano. Divide en "capítulos" por saltos grandes / marcadores. */
import { guessFromFilename } from './index.js';
export const kind = 'reflow';

function esc(s) { return s.replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }

function toChapters(text) {
  const norm = text.replace(/\r\n?/g, '\n');
  // Detecta encabezados tipo "Capítulo N" / "CHAPTER" o separadores largos
  const parts = norm.split(/\n(?=\s*(?:cap[íi]tulo|chapter|parte|part)\s+[\dIVXLC]+)/i);
  const chapters = [];
  const chunks = parts.length > 1 ? parts : chunkByLength(norm, 40000);
  chunks.forEach((chunk, i) => {
    const lines = chunk.split('\n');
    let label = `Sección ${i + 1}`;
    const firstNonEmpty = lines.find((l) => l.trim());
    if (firstNonEmpty && firstNonEmpty.length < 60 && /cap[íi]tulo|chapter|parte|part/i.test(firstNonEmpty)) label = firstNonEmpty.trim();
    const html = lines.map((l) => (l.trim() ? `<p>${esc(l)}</p>` : '')).join('');
    chapters.push({ id: 'c' + i, label, html });
  });
  return chapters;
}
function chunkByLength(text, n) {
  const paras = text.split(/\n{2,}/);
  const out = []; let buf = '';
  for (const p of paras) { buf += p + '\n\n'; if (buf.length > n) { out.push(buf); buf = ''; } }
  if (buf.trim()) out.push(buf);
  return out.length ? out : [text];
}

export async function meta(file) {
  const g = guessFromFilename(file.name);
  return { meta: { title: g.title || file.name, author: g.author, series: g.series, volume: g.volume, language: '' }, coverBlob: null };
}

export async function open(file) {
  const text = await file.text();
  const chapters = toChapters(text);
  const g = guessFromFilename(file.name);
  return {
    kind, meta: { title: g.title || file.name, author: g.author },
    chapters, toc: chapters.map((c) => ({ label: c.label, chapterId: c.id })),
    css: '', resources: new Map(),
  };
}
