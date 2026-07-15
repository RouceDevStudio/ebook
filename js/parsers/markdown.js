/* markdown.js — Markdown → HTML (parser propio, sin dependencias). */
import { guessFromFilename } from './index.js';
export const kind = 'reflow';

function esc(s) { return s.replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }

function inline(s) {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');
}

export function mdToHtml(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let out = '', inList = false, inCode = false, inQuote = false;
  const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };
  for (let raw of lines) {
    if (/^```/.test(raw)) { if (inCode) { out += '</code></pre>'; inCode = false; } else { closeList(); out += '<pre><code>'; inCode = true; } continue; }
    if (inCode) { out += esc(raw) + '\n'; continue; }
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); if (inQuote) { out += '</blockquote>'; inQuote = false; } continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^\s*>\s?/.test(line)) { if (!inQuote) { out += '<blockquote>'; inQuote = true; } out += `<p>${inline(line.replace(/^\s*>\s?/, ''))}</p>`; continue; }
    else if (inQuote) { out += '</blockquote>'; inQuote = false; }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(line.replace(/^\s*([-*+]|\d+\.)\s+/, ''))}</li>`; continue; }
    closeList();
    if (/^([-*_])\1{2,}$/.test(line.trim())) { out += '<hr>'; continue; }
    out += `<p>${inline(line)}</p>`;
  }
  closeList(); if (inCode) out += '</code></pre>'; if (inQuote) out += '</blockquote>';
  return out;
}

function splitByHeadings(html) {
  // divide en capítulos por h1/h2
  const parts = html.split(/(?=<h[12]>)/);
  if (parts.length <= 1) return [{ id: 'c0', label: 'Documento', html }];
  return parts.map((p, i) => {
    const m = p.match(/<h[12]>(.*?)<\/h[12]>/);
    const label = m ? m[1].replace(/<[^>]+>/g, '') : `Sección ${i + 1}`;
    return { id: 'c' + i, label, html: p };
  }).filter((c) => c.html.trim());
}

export async function meta(file) {
  const g = guessFromFilename(file.name);
  return { meta: { title: g.title || file.name, author: g.author, volume: g.volume }, coverBlob: null };
}
export async function open(file) {
  const src = await file.text();
  const html = mdToHtml(src);
  const chapters = splitByHeadings(html);
  const g = guessFromFilename(file.name);
  // primer h1 como título si existe
  const h1 = src.match(/^#\s+(.+)$/m);
  return {
    kind, meta: { title: (h1 && h1[1].trim()) || g.title || file.name, author: g.author },
    chapters, toc: chapters.map((c) => ({ label: c.label, chapterId: c.id })), css: '', resources: new Map(),
  };
}
