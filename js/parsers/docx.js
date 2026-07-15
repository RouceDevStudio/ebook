/* docx.js — Word (.docx = zip OOXML). Extrae texto de word/document.xml
   con estilos básicos (encabezados, negrita, cursiva, listas) e imágenes. */
export const kind = 'reflow';
const dec = new TextDecoder('utf-8');

function unzip(u8) {
  return new Promise((resolve, reject) => {
    if (window.fflate && fflate.unzip) fflate.unzip(u8, (e, d) => (e ? reject(e) : resolve(d)));
    else if (window.fflate) { try { resolve(fflate.unzipSync(u8)); } catch (e) { reject(e); } }
    else reject(new Error('fflate no disponible'));
  });
}
function esc(s) { return s.replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }

function docToHtml(xml, rels, files) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paras = doc.getElementsByTagNameNS(W, 'p');
  let html = ''; let listOpen = false;
  const resources = new Map();
  for (const p of paras) {
    const styleEl = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const style = styleEl?.getAttributeNS(W, 'val') || '';
    const isHeading = /^Heading(\d)/i.exec(style);
    const isList = p.getElementsByTagNameNS(W, 'numPr').length > 0;
    let inner = '';
    const runs = p.getElementsByTagNameNS(W, 'r');
    for (const r of runs) {
      const texts = r.getElementsByTagNameNS(W, 't');
      let txt = ''; for (const t of texts) txt += t.textContent;
      if (!txt && r.getElementsByTagNameNS(W, 'br').length) inner += '<br>';
      if (!txt) continue;
      const rpr = r.getElementsByTagNameNS(W, 'rPr')[0];
      let s = esc(txt);
      if (rpr) {
        if (rpr.getElementsByTagNameNS(W, 'b').length) s = `<strong>${s}</strong>`;
        if (rpr.getElementsByTagNameNS(W, 'i').length) s = `<em>${s}</em>`;
        if (rpr.getElementsByTagNameNS(W, 'u').length) s = `<u>${s}</u>`;
      }
      inner += s;
    }
    if (isList) { if (!listOpen) { html += '<ul>'; listOpen = true; } html += `<li>${inner}</li>`; continue; }
    if (listOpen) { html += '</ul>'; listOpen = false; }
    if (isHeading) { const lvl = Math.min(3, parseInt(isHeading[1], 10) || 2); html += `<h${lvl}>${inner}</h${lvl}>`; }
    else if (inner.trim()) html += `<p>${inner}</p>`;
  }
  if (listOpen) html += '</ul>';
  return html;
}

async function extract(file) {
  const files = await unzip(new Uint8Array(await file.arrayBuffer()));
  const docXml = files['word/document.xml'] ? dec.decode(files['word/document.xml']) : '';
  const coreXml = files['docProps/core.xml'] ? dec.decode(files['docProps/core.xml']) : '';
  return { files, docXml, coreXml };
}
function coreMeta(coreXml, fallbackName) {
  const doc = coreXml ? new DOMParser().parseFromString(coreXml, 'application/xml') : null;
  const g = (tag) => doc?.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  return { title: g('dc:title') || fallbackName.replace(/\.[^.]+$/, ''), author: g('dc:creator'), description: g('dc:description'), category: g('cp:category') };
}

export async function meta(file) {
  try { const { coreXml } = await extract(file); return { meta: coreMeta(coreXml, file.name), coverBlob: null }; }
  catch (_) { return { meta: { title: file.name.replace(/\.[^.]+$/, '') }, coverBlob: null }; }
}
export async function open(file) {
  const { files, docXml, coreXml } = await extract(file);
  const html = docToHtml(docXml, null, files);
  // partir por h1/h2
  const parts = html.split(/(?=<h[12]>)/);
  const chapters = (parts.length > 1 ? parts : [html]).map((p, i) => {
    const m = p.match(/<h[12]>(.*?)<\/h[12]>/);
    return { id: 'c' + i, label: m ? m[1].replace(/<[^>]+>/g, '') : `Sección ${i + 1}`, html: p };
  }).filter((c) => c.html.trim());
  return { kind, meta: coreMeta(coreXml, file.name), chapters: chapters.length ? chapters : [{ id:'c0', label:'Documento', html }], toc: chapters.map((c) => ({ label: c.label, chapterId: c.id })), css: '', resources: new Map() };
}
