/* html.js — documentos HTML sueltos. */
import { guessFromFilename } from './index.js';
export const kind = 'reflow';

function sanitize(doc) {
  doc.querySelectorAll('script, style, link, iframe, object, embed').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); });
  });
}

export async function meta(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const g = guessFromFilename(file.name);
  const title = (doc.querySelector('title')?.textContent || '').trim() || doc.querySelector('h1')?.textContent?.trim() || g.title || file.name;
  const author = doc.querySelector('meta[name="author"]')?.content || g.author || '';
  return { meta: { title, author }, coverBlob: null };
}

export async function open(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'text/html');
  sanitize(doc);
  const g = guessFromFilename(file.name);
  const title = (doc.querySelector('title')?.textContent || '').trim() || g.title || file.name;
  const body = doc.body ? doc.body.innerHTML : text;
  // divide por h1/h2
  const parts = body.split(/(?=<h[12][\s>])/i);
  const chapters = (parts.length > 1 ? parts : [body]).map((p, i) => {
    const m = p.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
    return { id: 'c' + i, label: m ? m[1].replace(/<[^>]+>/g, '').trim() : `Sección ${i + 1}`, html: p };
  }).filter((c) => c.html.trim());
  return {
    kind, meta: { title, author: doc.querySelector('meta[name="author"]')?.content || g.author || '' },
    chapters: chapters.length ? chapters : [{ id: 'c0', label: title, html: body }],
    toc: chapters.map((c) => ({ label: c.label, chapterId: c.id })), css: '', resources: new Map(),
  };
}
