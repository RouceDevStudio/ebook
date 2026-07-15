/* fb2.js — FictionBook 2 (XML). Extrae portada base64, metadatos y cuerpo. */
export const kind = 'reflow';

function parseXML(text) { return new DOMParser().parseFromString(text, 'application/xml'); }

function b64ToBlob(b64, type) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'image/jpeg' });
}

function readMeta(xml) {
  const ti = xml.querySelector('description > title-info') || xml;
  const title = ti.querySelector('book-title')?.textContent?.trim() || '';
  const authors = [...ti.querySelectorAll('author')].map((a) =>
    [a.querySelector('first-name')?.textContent, a.querySelector('last-name')?.textContent].filter(Boolean).join(' ').trim()
  ).filter(Boolean);
  const lang = ti.querySelector('lang')?.textContent?.trim() || '';
  const seq = ti.querySelector('sequence');
  const series = seq?.getAttribute('name') || '';
  const volume = seq?.getAttribute('number') ? parseInt(seq.getAttribute('number'), 10) : null;
  const genre = ti.querySelector('genre')?.textContent?.trim() || '';
  const annotation = xml.querySelector('annotation')?.textContent?.trim() || '';
  return { title, author: authors.join(', '), language: lang, series, volume, category: genre, description: annotation };
}

function coverBlob(xml) {
  const cp = xml.querySelector('coverpage image');
  let id = cp?.getAttribute('l:href') || cp?.getAttribute('xlink:href') || cp?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  if (id) id = id.replace(/^#/, '');
  const bin = id ? xml.querySelector(`binary[id="${id}"]`) : xml.querySelector('binary');
  if (!bin) return null;
  try { return b64ToBlob(bin.textContent, bin.getAttribute('content-type') || 'image/jpeg'); } catch (_) { return null; }
}

export async function meta(file) {
  const xml = parseXML(await file.text());
  return { meta: readMeta(xml), coverBlob: coverBlob(xml) };
}

export async function open(file) {
  const xml = parseXML(await file.text());
  const m = readMeta(xml);
  // resuelve imágenes internas (binary) a blob URLs
  const resources = new Map();
  xml.querySelectorAll('binary').forEach((b) => {
    try { const id = b.getAttribute('id'); resources.set(id, URL.createObjectURL(b64ToBlob(b.textContent, b.getAttribute('content-type')))); } catch (_) {}
  });
  const bodies = [...xml.querySelectorAll('body')];
  const chapters = [];
  let idx = 0;
  const serializer = new XMLSerializer();
  function sectionToHtml(sec) {
    let html = '';
    sec.childNodes.forEach((node) => {
      if (node.nodeType !== 1) return;
      const t = node.tagName.toLowerCase();
      if (t === 'title') html += `<h2>${node.textContent.trim()}</h2>`;
      else if (t === 'p') html += `<p>${node.textContent}</p>`;
      else if (t === 'empty-line') html += '<br>';
      else if (t === 'subtitle') html += `<h3>${node.textContent.trim()}</h3>`;
      else if (t === 'image') {
        let href = node.getAttribute('l:href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        href = href.replace(/^#/, '');
        if (resources.has(href)) html += `<img src="${resources.get(href)}">`;
      } else if (t === 'section') { html += sectionToHtml(node); }
      else if (t === 'poem' || t === 'cite') html += `<blockquote>${node.textContent}</blockquote>`;
    });
    return html;
  }
  bodies.forEach((body) => {
    const sections = body.querySelectorAll(':scope > section');
    if (sections.length) {
      sections.forEach((sec) => {
        const label = sec.querySelector(':scope > title')?.textContent?.trim() || `Capítulo ${idx + 1}`;
        chapters.push({ id: 'c' + idx, label, html: sectionToHtml(sec) });
        idx++;
      });
    } else {
      chapters.push({ id: 'c' + idx, label: `Sección ${idx + 1}`, html: sectionToHtml(body) });
      idx++;
    }
  });
  return {
    kind, meta: m,
    chapters: chapters.length ? chapters : [{ id: 'c0', label: m.title || 'Documento', html: '<p>(vacío)</p>' }],
    toc: chapters.map((c) => ({ label: c.label, chapterId: c.id })), css: '', resources,
  };
}
