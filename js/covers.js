/* ══════════════════════════════════════════════════
   covers.js — Portadas: generación local (canvas) y
   búsqueda automática online (Google Books / Open Library).
   ══════════════════════════════════════════════════ */

/* Paleta natural y sobria — tonos tierra, bosque, piedra y arcilla */
const PALETTES = [
  ['#6b7350', '#454d33'], // oliva
  ['#566349', '#38432e'], // musgo
  ['#7a6a52', '#4f4232'], // madera
  ['#8a7d5f', '#5c5138'], // arena
  ['#586b62', '#37473f'], // salvia
  ['#6d5f52', '#463b30'], // tierra
  ['#7c5c50', '#523a30'], // terracota
  ['#5b5a6b', '#3a3947'], // pizarra
  ['#6b5560', '#443440'], // ciruela
  ['#4f606b', '#323e48'], // azul niebla
  ['#70714c', '#494a2f'], // oliva dorado
  ['#4f6152', '#324034'], // bosque
  ['#7d7157', '#544a37'], // lino
  ['#5a5347', '#3a352b'], // carbón cálido
  ['#63705f', '#3f4a3c'], // helecho
];
function hash(str = '') { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }

export function paletteFor(title) { return PALETTES[hash(title) % PALETTES.length]; }

/* Portada generada en canvas → Blob (para guardar) */
export async function generateCoverBlob(book, W = 480, H = 720) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const [c1, c2] = paletteFor(book.title || book.author || 'x');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // textura sutil
  ctx.globalAlpha = 0.06; ctx.fillStyle = '#fff';
  for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  ctx.globalAlpha = 1;
  // franja
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(0, H * 0.62, W, 3);
  // título
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  const title = (book.title || 'Sin título').trim();
  wrapText(ctx, title, 40, 120, W - 80, 52, 'bold 46px Georgia, serif', 5);
  // autor
  ctx.shadowBlur = 4;
  if (book.author) { ctx.font = '600 26px -apple-system, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText(truncate(book.author, 26), 40, H - 80); }
  // marca coral
  ctx.shadowBlur = 0; ctx.globalAlpha = 0.5; ctx.font = '24px Georgia, serif'; ctx.textAlign = 'right';
  ctx.fillText('coral', W - 30, H - 34);
  ctx.globalAlpha = 1;
  return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.9));
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function wrapText(ctx, text, x, y, maxW, lh, font, maxLines) {
  ctx.font = font;
  const words = text.split(/\s+/); let line = '', lines = [];
  for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; }
  if (line) lines.push(line);
  lines = lines.slice(0, maxLines);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
}

/* ── Búsqueda online de metadatos + portada ── */
export async function searchOnline(book, { signal } = {}) {
  if (!navigator.onLine) return null;
  const q = [book.title, book.author].filter(Boolean).join(' ').trim();
  if (!q) return null;
  // 1) Google Books (metadatos ricos + portada)
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent((book.title ? 'intitle:' + book.title : '') + (book.author ? ' inauthor:' + book.author : q))}&maxResults=3`;
    const r = await fetch(url, { signal });
    if (r.ok) {
      const j = await r.json();
      const v = j.items && j.items[0] && j.items[0].volumeInfo;
      if (v) {
        const isbn = (v.industryIdentifiers || []).map((i) => i.identifier).find((i) => /\d{10,13}/.test(i)) || '';
        let coverUrl = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
        if (coverUrl) coverUrl = coverUrl.replace(/^http:/, 'https:').replace('zoom=1', 'zoom=2');
        return {
          source: 'Google Books',
          meta: {
            title: v.title, author: (v.authors || []).join(', '),
            publisher: v.publisher || '', year: (v.publishedDate || '').slice(0, 4),
            description: v.description || '', category: (v.categories || [])[0] || '',
            language: v.language || '', isbn, pages: v.pageCount || 0,
          },
          coverUrl,
        };
      }
    }
  } catch (_) {}
  // 2) Open Library
  try {
    const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(book.title || '')}&author=${encodeURIComponent(book.author || '')}&limit=1`;
    const r = await fetch(url, { signal });
    if (r.ok) {
      const j = await r.json(); const d = j.docs && j.docs[0];
      if (d) {
        const coverUrl = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null;
        return {
          source: 'Open Library',
          meta: {
            title: d.title, author: (d.author_name || []).join(', '),
            year: d.first_publish_year ? String(d.first_publish_year) : '',
            publisher: (d.publisher || [])[0] || '', language: (d.language || [])[0] || '',
            isbn: (d.isbn || [])[0] || '', category: (d.subject || [])[0] || '',
          },
          coverUrl,
        };
      }
    }
  } catch (_) {}
  return null;
}

/* Descarga un coverUrl a Blob (si CORS lo permite). */
export async function fetchCoverBlob(coverUrl, { signal } = {}) {
  try {
    const r = await fetch(coverUrl, { signal, mode: 'cors' });
    if (r.ok) { const b = await r.blob(); if (b.size > 500) return b; }
  } catch (_) {}
  return null;
}
