/* notes.js — Subrayados, notas y marcadores. */
import { db, uid } from './db.js';
import { toast } from './toast.js';

export async function saveHighlight({ bookId, chapterId, quote, color = 'yellow', note = '', type = 'highlight', percent = 0 }) {
  const rec = { id: uid(), bookId, chapterId, quote, color, note, type, percent, createdAt: Date.now() };
  await db.put('notes', rec);
  return rec;
}

export async function notesForBook(bookId) {
  return (await db.byIndex('notes', 'bookId', bookId)) || [];
}

export async function renderNotesPanel(container, R, onJump) {
  const notes = (await notesForBook(R.bookId)).sort((a, b) => b.createdAt - a.createdAt);
  const highlights = notes.filter((n) => n.type === 'highlight');
  const bookmarks = notes.filter((n) => n.type === 'bookmark');
  if (!notes.length) { container.innerHTML = `<p class="muted center" style="padding:40px">Aún no hay notas ni subrayados.<br>Selecciona texto mientras lees para crearlos.</p>`; return; }
  let html = '';
  if (bookmarks.length) {
    html += `<div class="result-group-title">Marcadores</div>`;
    bookmarks.forEach((b) => { html += `<div class="note-card" data-id="${b.id}"><div class="n">🔖 ${Math.round((b.percent||0)*100)}% · ${new Date(b.createdAt).toLocaleDateString()}</div></div>`; });
  }
  if (highlights.length) {
    html += `<div class="result-group-title">Subrayados y notas (${highlights.length})</div>`;
    highlights.forEach((n) => {
      html += `<div class="note-card" data-id="${n.id}" style="border-left-color:${hl(n.color)}">
        <div class="q">"${esc(n.quote)}"</div>${n.note ? `<div class="n">✍️ ${esc(n.note)}</div>` : ''}
        <div class="n" style="opacity:.6;font-size:11px">${new Date(n.createdAt).toLocaleString()}</div></div>`;
    });
  }
  html += `<button class="btn ghost block" id="expNotes" style="margin-top:16px">Exportar notas (.md)</button>`;
  container.innerHTML = html;
  container.querySelectorAll('.note-card').forEach((el) => el.onclick = () => { const n = notes.find((x) => x.id === el.dataset.id); if (n && onJump) onJump(n); });
  container.querySelector('#expNotes').onclick = () => exportNotes(R.book, notes);
}

export function exportNotes(book, notes) {
  let md = `# Notas de «${book.title}»\n\n_${book.author || ''}_\n\n`;
  notes.filter((n) => n.type === 'highlight').forEach((n) => {
    md += `> ${n.quote}\n`;
    if (n.note) md += `\n**Nota:** ${n.note}\n`;
    md += `\n---\n\n`;
  });
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `notas-${(book.title || 'libro').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Notas exportadas');
}

function hl(c) { return { yellow:'#ffd54a', green:'#7ee081', blue:'#6bc5ff', pink:'#ff8ec2', coral:'#ff6f61' }[c] || '#ffd54a'; }
function esc(s = '') { return String(s).replace(/[&<>]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); }
