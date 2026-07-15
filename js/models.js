/* ══════════════════════════════════════════════════
   models.js — Modelo de dominio: libros, carpetas,
   colecciones, progreso, sesiones de lectura y stats.
   ══════════════════════════════════════════════════ */
import { db, uid } from './db.js';
import { storage } from './storage.js';

export const STATUS = {
  unread:   { label: 'Pendiente',  emoji: '📕' },
  reading:  { label: 'Leyendo',    emoji: '📖' },
  finished: { label: 'Terminado',  emoji: '✅' },
  abandoned:{ label: 'Abandonado', emoji: '🌙' },
  reread:   { label: 'Releer',     emoji: '🔁' },
  wishlist: { label: 'Pendiente de comprar', emoji: '🛒' },
};

export function today() { return new Date().toISOString().slice(0, 10); }

/* ── Hash rápido para detectar duplicados (tamaño + muestreo) ── */
export async function quickHash(file) {
  const size = file.size;
  const slice = await file.slice(0, Math.min(size, 65536)).arrayBuffer();
  const buf = new Uint8Array(slice);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < buf.length; i += 7) { h ^= buf[i]; h = Math.imul(h, 16777619) >>> 0; }
  return `${size.toString(36)}-${h.toString(36)}`;
}

/* ═════════ Libros ═════════ */
export async function allBooks() { return (await db.all('books')) || []; }

export function newBookRecord(partial = {}) {
  const now = Date.now();
  return {
    id: uid(), hash: '', format: '', kind: 'reflow',
    title: 'Sin título', author: '', series: '', volume: null,
    language: '', publisher: '', year: '', isbn: '',
    description: '', category: '', subjects: [], tags: [],
    coverType: 'generated', coverPalette: null,
    status: 'unread', favorite: false, hidden: false, trashed: false, trashedAt: null,
    folderId: null, collections: [],
    addedAt: now, lastOpenedAt: null, finishedAt: null,
    size: 0, pages: 0, wordCount: 0, coralEnriched: false,
    ...partial,
  };
}

export async function saveBook(book) { await db.put('books', book); return book; }
export async function getBook(id) { return db.get('books', id); }

export async function findDuplicate(hash) {
  const rows = await db.byIndex('books', 'hash', hash);
  return rows && rows[0];
}

export async function trashBook(id) {
  const b = await getBook(id); if (!b) return;
  b.trashed = true; b.trashedAt = Date.now(); await saveBook(b);
}
export async function restoreBook(id) {
  const b = await getBook(id); if (!b) return;
  b.trashed = false; b.trashedAt = null; await saveBook(b);
}
export async function deleteBookForever(id) {
  await storage.deleteBook(id);
  await storage.deleteCover(id);
  await db.del('books', id);
  await db.del('progress', id);
  const notes = await db.byIndex('notes', 'bookId', id);
  for (const n of notes) await db.del('notes', n.id);
}

export async function setStatus(id, status) {
  const b = await getBook(id); if (!b) return;
  b.status = status;
  if (status === 'finished') b.finishedAt = Date.now();
  await saveBook(b);
  return b;
}
export async function toggleFavorite(id) {
  const b = await getBook(id); if (!b) return;
  b.favorite = !b.favorite; await saveBook(b); return b;
}

/* ═════════ Carpetas ═════════ */
export async function allFolders() { return (await db.all('folders')) || []; }
export async function createFolder(name, parentId = null) {
  const f = { id: uid(), name, parentId, createdAt: Date.now() };
  await db.put('folders', f); return f;
}
export async function renameFolder(id, name) { const f = await db.get('folders', id); if (f) { f.name = name; await db.put('folders', f); } }
export async function deleteFolder(id) {
  // mueve libros a raíz
  const books = await db.byIndex('books', 'folderId', id);
  for (const b of books) { b.folderId = null; await saveBook(b); }
  await db.del('folders', id);
}

/* ═════════ Colecciones ═════════ */
export async function allCollections() { return (await db.all('collections')) || []; }
export async function createCollection(name) {
  const c = { id: uid(), name, bookIds: [], createdAt: Date.now() };
  await db.put('collections', c); return c;
}
export async function addToCollection(collectionId, bookId) {
  const c = await db.get('collections', collectionId); if (!c) return;
  if (!c.bookIds.includes(bookId)) c.bookIds.push(bookId);
  await db.put('collections', c);
}
export async function toggleInCollection(collectionId, bookId) {
  const c = await db.get('collections', collectionId); if (!c) return false;
  const i = c.bookIds.indexOf(bookId);
  if (i >= 0) c.bookIds.splice(i, 1); else c.bookIds.push(bookId);
  await db.put('collections', c);
  return i < 0; // true si quedó añadido
}
export async function deleteCollection(id) { await db.del('collections', id); }

/* ═════════ Progreso ═════════ */
export async function getProgress(bookId) {
  return (await db.get('progress', bookId)) || { bookId, percent: 0, location: null, pdfPage: 1, cbzPage: 0, updatedAt: 0, perBook: {} };
}
export async function saveProgress(p) { p.updatedAt = Date.now(); await db.put('progress', p); }

/* ═════════ Sesiones de lectura ═════════ */
let _activeSession = null;
export function startSession(bookId, startPercent = 0) {
  _activeSession = { id: uid(), bookId, startedAt: Date.now(), day: today(), startPercent, endPercent: startPercent, pagesRead: 0 };
  return _activeSession;
}
export async function endSession(endPercent, pagesRead = 0) {
  if (!_activeSession) return;
  const s = _activeSession; _activeSession = null;
  s.endedAt = Date.now();
  s.seconds = Math.round((s.endedAt - s.startedAt) / 1000);
  s.endPercent = endPercent; s.pagesRead = pagesRead;
  if (s.seconds >= 5) await db.put('sessions', s);   // ignora toques accidentales
  return s;
}
export async function allSessions() { return (await db.all('sessions')) || []; }

/* ═════════ Estadísticas ═════════ */
export async function computeStats() {
  const sessions = await allSessions();
  const books = await allBooks();
  const active = books.filter((b) => !b.trashed);
  let totalSeconds = 0, totalPages = 0;
  const byDay = {}, byHour = new Array(24).fill(0);
  sessions.forEach((s) => {
    totalSeconds += s.seconds || 0;
    totalPages += s.pagesRead || 0;
    byDay[s.day] = (byDay[s.day] || 0) + (s.seconds || 0);
    const h = new Date(s.startedAt).getHours(); byHour[h] += s.seconds || 0;
  });
  const days = Object.keys(byDay).sort();
  // racha
  let streak = 0; { const d = new Date(); for (;;) { const key = d.toISOString().slice(0, 10); if (byDay[key]) { streak++; d.setDate(d.getDate() - 1); } else { if (key === today() && streak === 0) { d.setDate(d.getDate() - 1); continue; } break; } } }
  const finished = active.filter((b) => b.status === 'finished').length;
  const started = active.filter((b) => b.status === 'reading' || b.finishedAt || b.lastOpenedAt).length;
  const readingDays = days.length;
  const avgSessionMin = sessions.length ? (totalSeconds / sessions.length) / 60 : 0;
  const wpm = totalSeconds > 0 ? (totalPages * 275) / (totalSeconds / 60) : 0; // ~275 palabras/página
  const favHour = byHour.indexOf(Math.max(...byHour));
  return {
    totalSeconds, totalHours: totalSeconds / 3600, totalPages,
    finished, started, streak, readingDays, byDay, byHour,
    avgSessionMin, pagesPerDay: readingDays ? totalPages / readingDays : 0,
    wpm, favHour, sessionsCount: sessions.length,
    booksTotal: active.length,
  };
}

/* ═════════ Consultas de biblioteca ═════════ */
export function sortBooks(books, key, dir = 'desc') {
  const s = [...books];
  const cmp = {
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    author: (a, b) => (a.author || '').localeCompare(b.author || ''),
    addedAt: (a, b) => (a.addedAt || 0) - (b.addedAt || 0),
    lastOpenedAt: (a, b) => (a.lastOpenedAt || 0) - (b.lastOpenedAt || 0),
    finishedAt: (a, b) => (a.finishedAt || 0) - (b.finishedAt || 0),
    size: (a, b) => (a.size || 0) - (b.size || 0),
    pages: (a, b) => (a.pages || 0) - (b.pages || 0),
  }[key] || ((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  s.sort(cmp);
  if (dir === 'desc') s.reverse();
  return s;
}
