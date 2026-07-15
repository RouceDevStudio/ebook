/* mobi.js — MOBI / AZW / AZW3 (Palm Database).
   Soporta PalmDOC (compresión 2) y sin compresión (1).
   HUFF/CDIC (17480) y DRM se detectan y avisan con elegancia.
   Extrae título (fullName), texto y portada (EXTH 201). */
export const kind = 'reflow';

/* ── PalmDOC LZ77 ── */
function palmDocDecompress(bytes) {
  const out = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i++];
    if (b >= 0xc0) { out.push(32, b ^ 0x80); }
    else if (b >= 0x80) {
      const b2 = bytes[i++];
      const pair = (b << 8) | b2;
      const dist = (pair >> 3) & 0x7ff;
      const len = (b2 & 0x07) + 3;
      let src = out.length - dist;
      for (let j = 0; j < len; j++) out.push(out[src++]);
    } else if (b >= 0x09) { out.push(b); }
    else if (b >= 0x01) { for (let j = 0; j < b && i < n; j++) out.push(bytes[i++]); }
    else { out.push(0); }
  }
  return Uint8Array.from(out);
}

/* ── Trailing data entries (multibyte) ── */
function sizeOfTrailingEntry(data, len) {
  let num = 0;
  const start = Math.max(0, len - 4);
  for (let p = start; p < len; p++) { const v = data[p]; if (v & 0x80) num = 0; num = (num << 7) | (v & 0x7f); }
  return num;
}
function trimTrailing(data, flags) {
  let end = data.length;
  let t = flags >> 1;
  while (t) {
    if (t & 1) { const num = sizeOfTrailingEntry(data.subarray(0, end), end); end -= num; }
    t >>= 1;
  }
  if (flags & 1) { const a = (data[end - 1] & 0x3) + 1; end -= a; }
  return data.subarray(0, Math.max(0, end));
}

function readPalmDB(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const numRecords = dv.getUint16(76);
  const offsets = [];
  for (let i = 0; i < numRecords; i++) offsets.push(dv.getUint32(78 + i * 8));
  offsets.push(buf.byteLength);
  const rec = (i) => u8.subarray(offsets[i], offsets[i + 1]);
  return { dv, u8, numRecords, rec };
}

function imageSig(u8) {
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png';
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image/gif';
  return null;
}

function parse(buf) {
  const { dv, rec, numRecords } = readPalmDB(buf);
  const r0 = rec(0);
  const r0dv = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
  const compression = r0dv.getUint16(0);
  const textLength = r0dv.getUint32(4);
  const textRecordCount = r0dv.getUint16(8);
  const encryption = r0dv.getUint16(12);

  const mobiMagic = String.fromCharCode(r0[16], r0[17], r0[18], r0[19]);
  let encoding = 'utf-8', fullName = '', mobiHeaderLen = 0, exthFlags = 0, extraFlags = 0, coverIndex = -1, firstImageRec = -1;
  if (mobiMagic === 'MOBI') {
    mobiHeaderLen = r0dv.getUint32(20);
    const enc = r0dv.getUint32(28);
    encoding = enc === 65001 ? 'utf-8' : enc === 1252 ? 'windows-1252' : 'utf-8';
    const fnOff = r0dv.getUint32(0x54);       // full name offset (desde record0)
    const fnLen = r0dv.getUint32(0x58);
    try { fullName = new TextDecoder(encoding).decode(r0.subarray(fnOff, fnOff + fnLen)); } catch (_) {}
    exthFlags = r0dv.getUint32(0x80);
    if (r0.length >= 0xf4) extraFlags = r0dv.getUint16(0xf2);
    try { firstImageRec = r0dv.getUint32(0x6c); } catch (_) {}
    // EXTH
    if (exthFlags & 0x40) {
      const exthStart = 16 + mobiHeaderLen;
      if (String.fromCharCode(r0[exthStart], r0[exthStart + 1], r0[exthStart + 2], r0[exthStart + 3]) === 'EXTH') {
        const count = r0dv.getUint32(exthStart + 8);
        let p = exthStart + 12;
        for (let i = 0; i < count && p + 8 <= r0.length; i++) {
          const type = r0dv.getUint32(p);
          const len = r0dv.getUint32(p + 4);
          if (type === 201 && len >= 12) coverIndex = r0dv.getUint32(p + 8);
          p += len;
        }
      }
    }
  }

  if (encryption !== 0) { const e = new Error('Este libro tiene DRM y no puede abrirse.'); e.code = 'DRM'; throw e; }
  if (compression === 17480) { const e = new Error('Compresión HUFF/CDIC no soportada. Convierte a EPUB.'); e.code = 'HUFF'; throw e; }

  // Texto
  const chunks = [];
  for (let i = 1; i <= textRecordCount && i < numRecords; i++) {
    let data = rec(i);
    data = trimTrailing(data, extraFlags);
    chunks.push(compression === 2 ? palmDocDecompress(data) : data);
  }
  let total = 0; chunks.forEach((c) => total += c.length);
  const merged = new Uint8Array(total);
  let off = 0; chunks.forEach((c) => { merged.set(c, off); off += c.length; });
  let html = '';
  try { html = new TextDecoder(encoding).decode(merged.subarray(0, textLength || merged.length)); }
  catch (_) { html = new TextDecoder('utf-8').decode(merged); }

  // Portada
  let coverBlob = null;
  try {
    const images = [];
    for (let i = textRecordCount + 1; i < numRecords; i++) {
      const d = rec(i); const sig = imageSig(d);
      if (sig) images.push(new Blob([d], { type: sig }));
    }
    if (coverIndex >= 0 && images[coverIndex]) coverBlob = images[coverIndex];
    else if (images.length) coverBlob = images[0];
  } catch (_) {}

  return { html, fullName, coverBlob };
}

function cleanMobiHtml(html) {
  return html
    .replace(/<\?xml[^>]*>/gi, '')
    .replace(/<mbp:pagebreak\s*\/?>/gi, '<hr class="pb">')
    .replace(/<mbp:[^>]*>/gi, '').replace(/<\/mbp:[^>]*>/gi, '')
    .replace(/<guide>[\s\S]*?<\/guide>/gi, '')
    .replace(/ (filepos|recindex)="[^"]*"/gi, '');
}

function titleFrom(html, fullName, fileName) {
  const t = html.match(/<title>([^<]+)<\/title>/i);
  return (t && t[1].trim()) || (fullName || '').trim() || fileName.replace(/\.[^.]+$/, '');
}

export async function meta(file) {
  try {
    const p = parse(await file.arrayBuffer());
    return { meta: { title: titleFrom(p.html, p.fullName, file.name), author: '', category: '' }, coverBlob: p.coverBlob };
  } catch (e) {
    return { meta: { title: file.name.replace(/\.[^.]+$/, ''), note: e.code || '' }, coverBlob: null };
  }
}

export async function open(file) {
  let p;
  try { p = parse(await file.arrayBuffer()); }
  catch (e) {
    return { kind, meta: { title: file.name.replace(/\.[^.]+$/, '') },
      chapters: [{ id: 'c0', label: 'Aviso', html: `<p style="text-align:center;opacity:.7">${e.message}</p>` }],
      toc: [], css: '', resources: new Map() };
  }
  const clean = cleanMobiHtml(p.html);
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('script, style, link').forEach((n) => n.remove());
  const body = doc.body || doc.documentElement;
  // dividir por pagebreak o encabezados
  let parts = body.innerHTML.split(/<hr class="pb">/i);
  if (parts.length < 2) parts = body.innerHTML.split(/(?=<h[12][\s>])/i);
  const chapters = (parts.length ? parts : [body.innerHTML]).map((h, i) => {
    const m = h.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
    return { id: 'c' + i, label: m ? m[1].replace(/<[^>]+>/g, '').trim() : `Sección ${i + 1}`, html: h };
  }).filter((c) => c.html.replace(/<[^>]+>/g, '').trim());
  return {
    kind, meta: { title: titleFrom(p.html, p.fullName, file.name) },
    chapters: chapters.length ? chapters : [{ id: 'c0', label: 'Documento', html: body.innerHTML }],
    toc: chapters.map((c) => ({ label: c.label, chapterId: c.id })), css: '', resources: new Map(),
  };
}
