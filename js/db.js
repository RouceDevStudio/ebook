/* ══════════════════════════════════════════════════
   db.js — Capa IndexedDB (metadatos, progreso, notas,
   sesiones de lectura, colecciones, carpetas, ajustes)
   Los blobs pesados (archivos de libro, portadas) viven
   en OPFS vía storage.js; aquí solo referencias/metadatos.
   ══════════════════════════════════════════════════ */

const DB_NAME = 'coral-reader';
const DB_VERSION = 1;

const STORES = {
  books:       { keyPath: 'id', indexes: [['folderId','folderId'],['status','status'],['addedAt','addedAt'],['favorite','favorite'],['hidden','hidden'],['trashed','trashed'],['hash','hash']] },
  progress:    { keyPath: 'bookId' },
  notes:       { keyPath: 'id', indexes: [['bookId','bookId'],['createdAt','createdAt']] },
  sessions:    { keyPath: 'id', indexes: [['bookId','bookId'],['day','day'],['startedAt','startedAt']] },
  collections: { keyPath: 'id' },
  folders:     { keyPath: 'id', indexes: [['parentId','parentId']] },
  settings:    { keyPath: 'key' },
  covers:      { keyPath: 'bookId' },   // fallback si OPFS no está
  blobs:       { keyPath: 'id' },       // fallback de archivos si OPFS no está
};

let _dbp = null;

function openDB() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const st = db.createObjectStore(name, { keyPath: def.keyPath });
          (def.indexes || []).forEach(([idx, kp]) => st.createIndex(idx, kp));
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbp;
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export const db = {
  async put(store, val) { return reqP((await tx(store, 'readwrite')).put(val)); },
  async get(store, key) { return reqP((await tx(store)).get(key)); },
  async del(store, key) { return reqP((await tx(store, 'readwrite')).delete(key)); },
  async all(store) { return reqP((await tx(store)).getAll()); },
  async clear(store) { return reqP((await tx(store, 'readwrite')).clear()); },
  async byIndex(store, index, value) {
    const st = await tx(store);
    return reqP(st.index(index).getAll(value));
  },
  async count(store) { return reqP((await tx(store)).count()); },
  async bulkPut(store, arr) {
    const st = await tx(store, 'readwrite');
    await Promise.all(arr.map((v) => reqP(st.put(v))));
    return arr.length;
  },
};

/* ───── Settings helpers (key/value) ───── */
const _defaults = {
  theme: 'system',              // system|light|dark|amoled
  readerTheme: 'sepia',
  fontSize: 19,
  lineHeight: 1.65,
  margin: 24,
  fontFamily: '"Literata", Georgia, "Times New Roman", serif',
  wordSpacing: 0,
  letterSpacing: 0,
  textAlign: 'justify',
  paragraphSpace: 1,
  textIndent: 0,
  pageAnimation: 'realistic',   // realistic|slide|scroll|none
  brightness: 1,
  warmth: 0,
  nightBrightness: false,
  orientation: 'portrait',      // portrait|auto|landscape — bloqueo por defecto
  libView: 'grid',              // grid|list|shelf
  libSort: 'addedAt',
  libSortDir: 'desc',
  tapZones: true,
  keepScreenOn: false,
  haptics: true,
  ttsRate: 1,
  dyslexia: false,
  highContrast: false,
  coralUrl: '',                 // endpoint de Coral (Nexus)
  coralToken: '',
  autoCovers: true,
  goalMinutes: 20,
  goalPages: 20,
  lastBookId: null,
  recentSearches: [],
  installedFonts: [],           // [{name, dataUrl}]
};

export const settings = {
  _cache: null,
  async load() {
    if (this._cache) return this._cache;
    const rows = await db.all('settings');
    const obj = { ..._defaults };
    rows.forEach((r) => { obj[r.key] = r.value; });
    this._cache = obj;
    return obj;
  },
  get(key) { return this._cache ? this._cache[key] : _defaults[key]; },
  async set(key, value) {
    if (this._cache) this._cache[key] = value;
    return db.put('settings', { key, value });
  },
  async setMany(obj) {
    for (const [k, v] of Object.entries(obj)) await this.set(k, v);
  },
  defaults: _defaults,
};

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(36).slice(2));
}
