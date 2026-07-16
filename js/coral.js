/* ══════════════════════════════════════════════════
   coral.js — El bibliotecario. Enriquece metadatos,
   organiza la biblioteca y genera "insights" humanos.
   Cerebro: endpoint de Coral (Nexus) cuando está
   configurado y online; si no, Google Books/Open Library;
   y siempre, heurísticas locales que funcionan offline.
   ══════════════════════════════════════════════════ */
import { settings } from './db.js';
import { searchOnline } from './covers.js';
import { STATUS } from './models.js';

// Coral se conecta SOLO, sin que el usuario configure nada (como UpGames).
// El usuario puede sobrescribir con su propio Nexus en Ajustes → Coral.
export const DEFAULT_CORAL_URL = 'https://nexus-production-781b.up.railway.app';

const STOP = {
  es: ['de','la','que','el','en','y','los','las','del','se','por','con','una','para','como'],
  en: ['the','and','of','to','in','is','that','for','with','was','you','this','have'],
  fr: ['le','la','les','des','une','que','pour','dans','avec','sur','est','vous'],
  pt: ['de','que','os','as','uma','para','com','não','por','mais','como','também'],
  de: ['der','die','und','den','das','ist','mit','auf','für','ein','nicht','auch'],
  it: ['che','di','la','il','un','per','con','non','una','sono','come','anche'],
};

export const coral = {
  // URL efectiva del cerebro: la del usuario si la puso, si no la de por defecto.
  baseUrl() { return ((settings.get('coralUrl') || '').trim() || DEFAULT_CORAL_URL).replace(/\/$/, ''); },
  // Siempre hay cerebro configurado (autoconexión); solo se desactiva si el
  // usuario borra la URL a propósito con la palabra "off".
  configured() { return this.baseUrl() !== '' && (settings.get('coralUrl') || '').trim().toLowerCase() !== 'off'; },
  online() { return navigator.onLine; },
  status() {
    if (this.configured() && this.online()) return { level: 'brain', label: 'Coral conectado' };
    if (this.online()) return { level: 'online', label: 'Coral (catálogos web)' };
    return { level: 'local', label: 'Coral offline (heurístico)' };
  },

  /* ── Detección de idioma por frecuencia de stopwords ── */
  detectLanguage(text = '') {
    const words = text.toLowerCase().match(/[a-záéíóúñàèìòùâêôçüö]+/g) || [];
    if (words.length < 20) return '';
    const sample = words.slice(0, 800);
    let best = '', bestScore = 0;
    for (const [lang, list] of Object.entries(STOP)) {
      const set = new Set(list); let s = 0;
      for (const w of sample) if (set.has(w)) s++;
      if (s > bestScore) { bestScore = s; best = lang; }
    }
    return bestScore > 5 ? best : '';
  },

  /* ── Saga / volumen desde título ── */
  detectSeries(title = '', filename = '') {
    const src = title + ' ' + filename;
    const vol = src.match(/\b(?:vol(?:umen|ume)?|tomo|book|libro|parte|part|#)\s*\.?\s*(\d{1,3})\b/i);
    const paren = title.match(/^(.*?)\s*[:\-–]\s*(.*)$/);
    return {
      volume: vol ? parseInt(vol[1], 10) : null,
      series: paren ? paren[1].trim() : '',
    };
  },

  /* ── Llama al cerebro de Coral (Nexus) ── */
  async callBrain(payload) {
    if (!this.configured()) return null;
    const base = this.baseUrl();
    if (!base) return null;
    const headers = { 'Content-Type': 'application/json' };
    const token = settings.get('coralToken'); if (token) headers['Authorization'] = 'Bearer ' + token;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(base + '/api/coral/librarian', { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return null;
      const j = await r.json();
      return j && (j.result || j);
    } catch (_) { return null; }
  },

  /* ── Enriquecer un libro ── */
  async enrich(book, { textSample = '', signal } = {}) {
    const out = { fields: {}, source: 'local', coverUrl: null };
    // 1) heurística local siempre
    const lang = book.language || this.detectLanguage(textSample);
    const ser = this.detectSeries(book.title, book.filename || '');
    if (lang && !book.language) out.fields.language = lang;
    if (ser.volume && !book.volume) out.fields.volume = ser.volume;
    if (ser.series && !book.series) out.fields.series = ser.series;

    // 2) cerebro Coral (si está configurado)
    if (this.configured() && this.online()) {
      const brain = await this.callBrain({
        title: book.title, author: book.author, filename: book.filename || '',
        language: lang, sample: (textSample || '').slice(0, 1200),
      });
      if (brain && brain.meta) {
        out.source = 'Coral';
        for (const k of ['author','description','publisher','year','isbn','category','series','language']) {
          if (brain.meta[k] && !book[k]) out.fields[k] = brain.meta[k];
        }
        if (brain.meta.volume && !book.volume) out.fields.volume = brain.meta.volume;
        if (brain.coverUrl) out.coverUrl = brain.coverUrl;
        if (brain.suggestedStatus) out.fields.suggestedStatus = brain.suggestedStatus;
        return out;
      }
    }
    // 3) catálogos web
    if (this.online()) {
      const web = await searchOnline(book, { signal });
      if (web) {
        out.source = web.source;
        for (const [k, v] of Object.entries(web.meta)) { if (v && !book[k]) out.fields[k] = v; }
        if (web.coverUrl) out.coverUrl = web.coverUrl;
      }
    }
    return out;
  },

  /* ── Organización automática (colecciones inteligentes) ── */
  organize(books) {
    const active = books.filter((b) => !b.trashed && !b.hidden);
    const groups = {
      reading:  { label: 'Leyendo', books: [] },
      unread:   { label: 'Pendientes', books: [] },
      finished: { label: 'Terminados', books: [] },
      abandoned:{ label: 'Abandonados', books: [] },
      favorite: { label: 'Favoritos', books: [] },
      reread:   { label: 'Para releer', books: [] },
      wishlist: { label: 'Por comprar', books: [] },
    };
    active.forEach((b) => {
      if (b.favorite) groups.favorite.books.push(b);
      if (groups[b.status]) groups[b.status].books.push(b);
    });
    return groups;
  },

  /* ── Insights humanos por libro ── */
  insight(book, progress, stats) {
    const pct = Math.round((progress?.percent || 0) * 100);
    const now = Date.now();
    const days = book.lastOpenedAt ? Math.floor((now - book.lastOpenedAt) / 86400000) : null;
    if (book.status === 'finished') return `Terminaste este libro${book.finishedAt ? ' el ' + new Date(book.finishedAt).toLocaleDateString() : ''}. ¿Lo relees?`;
    if (pct === 0) return `Aún no lo empiezas. Un buen momento es ahora.`;
    if (pct >= 95) return `Estás al ${pct}%. Te queda un suspiro para el final.`;
    if (days !== null && days >= 7) return `Hace ${days} días que no lo continúas. Vas por el ${pct}% — retomarlo cuesta menos de lo que crees.`;
    if (pct >= 70 && stats && stats.wpm > 0) return `Vas por el ${pct}%. A tu ritmo, probablemente lo termines pronto.`;
    if (pct > 0) return `Vas por el ${pct}%. Sigue, que la historia te espera.`;
    return `Listo para leer.`;
  },

  /* ── Frase de bienvenida contextual ── */
  greeting(stats, continueBook) {
    const h = new Date().getHours();
    const part = h < 6 ? 'Madrugando' : h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    if (continueBook) return `${part}. Tienes «${continueBook.title}» a medias — ¿seguimos?`;
    if (stats && stats.streak > 1) return `${part}. Llevas ${stats.streak} días seguidos leyendo. Cuídalo.`;
    if (stats && stats.booksTotal === 0) return `${part}. Tu biblioteca está vacía — importa tus libros y la ordeno por ti.`;
    return `${part}. ¿Qué leemos hoy?`;
  },
};
