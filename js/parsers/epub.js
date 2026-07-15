/* epub.js — EPUB 2/3. Descomprime con fflate, lee OPF + spine + TOC,
   reescribe imágenes internas a blob URLs y entrega capítulos limpios. */
export const kind = 'reflow';

const dec = new TextDecoder('utf-8');
function xml(str) { return new DOMParser().parseFromString(str, 'application/xml'); }

function unzip(u8) {
  return new Promise((resolve, reject) => {
    if (window.fflate && fflate.unzip) {
      fflate.unzip(u8, (err, data) => (err ? reject(err) : resolve(data)));
    } else if (window.fflate) {
      try { resolve(fflate.unzipSync(u8)); } catch (e) { reject(e); }
    } else reject(new Error('fflate no disponible'));
  });
}

function resolvePath(base, rel) {
  if (/^https?:|^data:/.test(rel)) return rel;
  const parts = (base.split('/').slice(0, -1)).concat(rel.split('/'));
  const stack = [];
  for (const p of parts) { if (p === '.' || p === '') continue; if (p === '..') stack.pop(); else stack.push(p); }
  return stack.join('/');
}

const MIME = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', css:'text/css' };
function mimeFor(path) { const e = path.split('.').pop().toLowerCase(); return MIME[e] || 'application/octet-stream'; }

async function loadCore(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = await unzip(buf);
  // localizar OPF
  const container = files['META-INF/container.xml'];
  let opfPath = null;
  if (container) {
    const c = xml(dec.decode(container));
    opfPath = c.querySelector('rootfile')?.getAttribute('full-path');
  }
  if (!opfPath) opfPath = Object.keys(files).find((k) => k.endsWith('.opf'));
  if (!opfPath) throw new Error('EPUB inválido: sin OPF');
  const opf = xml(dec.decode(files[opfPath]));
  return { files, opfPath, opf };
}

function readMetadata(opf) {
  const md = opf.querySelector('metadata') || opf;
  const t = (sel) => md.querySelector(sel)?.textContent?.trim() || '';
  const title = t('title') || t('*|title');
  const authors = [...md.querySelectorAll('creator, *|creator')].map((n) => n.textContent.trim()).filter(Boolean);
  const language = t('language') || t('*|language');
  const publisher = t('publisher') || t('*|publisher');
  const date = t('date') || t('*|date');
  const desc = t('description') || t('*|description');
  const subjects = [...md.querySelectorAll('subject, *|subject')].map((n) => n.textContent.trim());
  let isbn = '';
  md.querySelectorAll('identifier, *|identifier').forEach((n) => { const v = n.textContent.trim(); if (/97[89][\d\- ]{10,}/.test(v) || /isbn/i.test(n.getAttribute('id') || '') || /isbn/i.test(v)) isbn = v.replace(/[^0-9Xx]/g, ''); });
  const year = (date.match(/\d{4}/) || [''])[0];
  return { title, author: authors.join(', '), language, publisher, year, isbn, description: desc, subjects, category: subjects[0] || '' };
}

function findCoverPath(opf, opfPath) {
  const md = opf.querySelector('metadata');
  const metaCover = md?.querySelector('meta[name="cover"]')?.getAttribute('content');
  let item = null;
  if (metaCover) item = opf.querySelector(`manifest item[id="${metaCover}"]`);
  if (!item) item = [...opf.querySelectorAll('manifest item')].find((i) => (i.getAttribute('properties') || '').includes('cover-image'));
  if (!item) item = [...opf.querySelectorAll('manifest item')].find((i) => /cover/i.test(i.getAttribute('href') || '') && /image/.test(i.getAttribute('media-type') || ''));
  if (!item) return null;
  return resolvePath(opfPath, item.getAttribute('href'));
}

export async function meta(file) {
  const { files, opfPath, opf } = await loadCore(file);
  const m = readMetadata(opf);
  const coverPath = findCoverPath(opf, opfPath);
  let coverBlob = null;
  if (coverPath && files[coverPath]) coverBlob = new Blob([files[coverPath]], { type: mimeFor(coverPath) });
  return { meta: m, coverBlob };
}

function buildToc(files, opf, opfPath, idToHref) {
  // EPUB3 nav
  const navItem = [...opf.querySelectorAll('manifest item')].find((i) => (i.getAttribute('properties') || '').includes('nav'));
  const toc = [];
  if (navItem) {
    const navPath = resolvePath(opfPath, navItem.getAttribute('href'));
    const navDoc = files[navPath] && new DOMParser().parseFromString(dec.decode(files[navPath]), 'text/html');
    const nav = navDoc?.querySelector('nav[*|type="toc"], nav[epub\\:type="toc"], nav');
    nav?.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href'); if (!href) return;
      toc.push({ label: a.textContent.trim(), href: resolvePath(navPath, href.split('#')[0]), anchor: href.split('#')[1] || '' });
    });
  }
  if (!toc.length) {
    // EPUB2 NCX
    const ncxItem = [...opf.querySelectorAll('manifest item')].find((i) => (i.getAttribute('media-type') || '').includes('ncx')) ||
      opf.querySelector(`manifest item[id="${opf.querySelector('spine')?.getAttribute('toc')}"]`);
    if (ncxItem) {
      const ncxPath = resolvePath(opfPath, ncxItem.getAttribute('href'));
      const ncx = files[ncxPath] && xml(dec.decode(files[ncxPath]));
      ncx?.querySelectorAll('navPoint').forEach((np) => {
        const label = np.querySelector('navLabel text')?.textContent?.trim() || '';
        const src = np.querySelector('content')?.getAttribute('src') || '';
        if (src) toc.push({ label, href: resolvePath(ncxPath, src.split('#')[0]), anchor: src.split('#')[1] || '' });
      });
    }
  }
  return toc;
}

export async function open(file) {
  const { files, opfPath, opf } = await loadCore(file);
  const m = readMetadata(opf);

  // manifest id → path
  const idToHref = {}; const hrefToId = {};
  opf.querySelectorAll('manifest item').forEach((i) => {
    const p = resolvePath(opfPath, i.getAttribute('href'));
    idToHref[i.getAttribute('id')] = { path: p, type: i.getAttribute('media-type') };
    hrefToId[p] = i.getAttribute('id');
  });

  // recursos (imágenes) → blob URLs
  const resources = new Map();
  for (const [id, it] of Object.entries(idToHref)) {
    if (/^image\//.test(it.type || '') && files[it.path]) {
      resources.set(it.path, URL.createObjectURL(new Blob([files[it.path]], { type: it.type })));
    }
  }

  // spine order
  const spine = [...opf.querySelectorAll('spine itemref')].map((r) => r.getAttribute('idref'))
    .map((id) => idToHref[id]).filter((x) => x && /html|xml/.test(x.type || 'html'));

  const toc = buildToc(files, opf, opfPath, idToHref);
  const chapters = [];
  spine.forEach((item, i) => {
    const raw = files[item.path];
    if (!raw) return;
    let doc;
    try { doc = new DOMParser().parseFromString(dec.decode(raw), 'application/xhtml+xml'); if (doc.querySelector('parsererror')) throw 0; }
    catch (_) { doc = new DOMParser().parseFromString(dec.decode(raw), 'text/html'); }
    // limpiar
    doc.querySelectorAll('script, link, style').forEach((n) => n.remove());
    // reescribir imágenes
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src'); if (!src) return;
      const abs = resolvePath(item.path, src);
      if (resources.has(abs)) img.setAttribute('src', resources.get(abs)); else img.removeAttribute('src');
    });
    doc.querySelectorAll('image').forEach((im) => {
      const href = im.getAttribute('xlink:href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || im.getAttribute('href');
      if (!href) return; const abs = resolvePath(item.path, href);
      if (resources.has(abs)) { im.setAttribute('href', resources.get(abs)); im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', resources.get(abs)); }
    });
    doc.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
    const bodyHtml = (doc.body || doc.documentElement).innerHTML;
    // etiqueta desde TOC
    const tocEntry = toc.find((t) => t.href === item.path);
    const label = tocEntry?.label || `Capítulo ${i + 1}`;
    chapters.push({ id: 'c' + i, label, html: bodyHtml, path: item.path });
  });

  // mapear TOC → chapterId
  const tocMapped = toc.map((t) => {
    const ch = chapters.find((c) => c.path === t.href);
    return { label: t.label, chapterId: ch ? ch.id : (chapters[0] && chapters[0].id), anchor: t.anchor };
  });

  return {
    kind, meta: m, chapters,
    toc: tocMapped.length ? tocMapped : chapters.map((c) => ({ label: c.label, chapterId: c.id })),
    css: '', resources,
  };
}
