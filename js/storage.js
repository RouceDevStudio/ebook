/* ══════════════════════════════════════════════════
   storage.js — Almacenamiento de blobs pesados.
   Prefiere OPFS (Origin Private File System); si no está
   disponible, cae a IndexedDB (store 'blobs' / 'covers').
   ══════════════════════════════════════════════════ */
import { db } from './db.js';

let _opfsRoot = null;
let _opfsChecked = false;

async function opfs() {
  if (_opfsChecked) return _opfsRoot;
  _opfsChecked = true;
  try {
    if (navigator.storage && navigator.storage.getDirectory) {
      _opfsRoot = await navigator.storage.getDirectory();
      // asegura persistencia si el navegador lo permite
      if (navigator.storage.persist) { try { await navigator.storage.persist(); } catch (_) {} }
    }
  } catch (_) { _opfsRoot = null; }
  return _opfsRoot;
}

async function dir(name) {
  const root = await opfs();
  if (!root) return null;
  return root.getDirectoryHandle(name, { create: true });
}

export const storage = {
  hasOPFS() { return !!_opfsRoot; },

  /* ── Archivos de libro ── */
  async saveBook(id, blob) {
    const d = await dir('books');
    if (d) {
      const fh = await d.getFileHandle(id, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return { store: 'opfs' };
    }
    await db.put('blobs', { id, blob });
    return { store: 'idb' };
  },
  async getBook(id) {
    const d = await dir('books');
    if (d) {
      try { const fh = await d.getFileHandle(id); return await fh.getFile(); }
      catch (_) { /* cae abajo */ }
    }
    const rec = await db.get('blobs', id);
    return rec ? rec.blob : null;
  },
  async deleteBook(id) {
    const d = await dir('books');
    if (d) { try { await d.removeEntry(id); } catch (_) {} }
    try { await db.del('blobs', id); } catch (_) {}
  },

  /* ── Portadas ── */
  async saveCover(bookId, blob) {
    const d = await dir('covers');
    if (d) {
      const fh = await d.getFileHandle(bookId, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      await db.put('covers', { bookId, store: 'opfs' });
      return;
    }
    await db.put('covers', { bookId, blob, store: 'idb' });
  },
  async getCover(bookId) {
    const meta = await db.get('covers', bookId);
    if (meta && meta.blob) return meta.blob;
    const d = await dir('covers');
    if (d) { try { const fh = await d.getFileHandle(bookId); return await fh.getFile(); } catch (_) {} }
    return null;
  },
  async deleteCover(bookId) {
    const d = await dir('covers');
    if (d) { try { await d.removeEntry(bookId); } catch (_) {} }
    try { await db.del('covers', bookId); } catch (_) {}
  },

  /* ── Cuota / uso ── */
  async estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try { return await navigator.storage.estimate(); } catch (_) {}
    }
    return { usage: 0, quota: 0 };
  },
};

/* URL cache para no recrear objectURLs constantemente */
const _urlCache = new Map();
export function blobUrl(key, blob) {
  if (_urlCache.has(key)) return _urlCache.get(key);
  const u = URL.createObjectURL(blob);
  _urlCache.set(key, u);
  return u;
}
export function revokeUrl(key) {
  if (_urlCache.has(key)) { URL.revokeObjectURL(_urlCache.get(key)); _urlCache.delete(key); }
}
