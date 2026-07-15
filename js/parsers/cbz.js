/* cbz.js — Cómics CBZ (zip de imágenes). CBR (rar) se detecta y avisa. */
export const kind = 'images';
const IMG_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const MIME = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', avif:'image/avif' };

function isRar(u8) { return u8[0] === 0x52 && u8[1] === 0x61 && u8[2] === 0x72 && u8[3] === 0x21; } // "Rar!"

function unzip(u8) {
  return new Promise((resolve, reject) => {
    if (window.fflate && fflate.unzip) fflate.unzip(u8, (e, d) => (e ? reject(e) : resolve(d)));
    else if (window.fflate) { try { resolve(fflate.unzipSync(u8)); } catch (e) { reject(e); } }
    else reject(new Error('fflate no disponible'));
  });
}

async function loadImages(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  if (isRar(u8)) { const e = new Error('CBR (RAR) no se puede abrir en el navegador. Convierte a CBZ.'); e.code = 'RAR'; throw e; }
  const files = await unzip(u8);
  const names = Object.keys(files).filter((n) => IMG_RE.test(n) && !/__MACOSX/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return names.map((n) => new Blob([files[n]], { type: MIME[n.split('.').pop().toLowerCase()] || 'image/jpeg' }));
}

export async function meta(file) {
  try {
    const blobs = await loadImages(file);
    return { meta: { title: file.name.replace(/\.[^.]+$/, ''), author: '', category: 'Cómic', pages: blobs.length }, coverBlob: blobs[0] || null, kind };
  } catch (e) {
    return { meta: { title: file.name.replace(/\.[^.]+$/, ''), category: 'Cómic', note: e.code === 'RAR' ? 'CBR/RAR' : '' }, coverBlob: null, kind };
  }
}

export async function open(file) {
  const blobs = await loadImages(file);
  const images = blobs.map((b) => URL.createObjectURL(b));
  return { kind, meta: { title: file.name.replace(/\.[^.]+$/, ''), pages: images.length }, images, toc: [] };
}
