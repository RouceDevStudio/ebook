/* ══════════════════════════════════════════════════
   importer.js — Importa archivos a la biblioteca:
   extrae metadatos, detecta duplicados, guarda el blob,
   crea/gena portada y prepara el registro del libro.
   ══════════════════════════════════════════════════ */
import { extractMeta, extOf, guessFromFilename, SUPPORTED, formatLabel } from './parsers/index.js';
import * as models from './models.js';
import { storage } from './storage.js';
import { settings } from './db.js';
import { generateCoverBlob } from './covers.js';
import { toast } from './toast.js';

export async function importFiles(fileList, { folderId = null, App } = {}) {
  const files = [...fileList].filter((f) => SUPPORTED.includes(extOf(f.name)));
  const skippedFormat = fileList.length - files.length;
  if (!files.length) { toast(skippedFormat ? 'Ningún formato compatible en la selección' : 'No hay archivos'); return; }

  const t = toast(`Importando 0/${files.length}…`, { duration: 600000, icon: '<div class="spinner"></div>' });
  const bar = t.querySelector('span');
  let added = 0, dupes = 0, errors = 0;
  const folderCache = {};

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (bar) bar.textContent = `Importando ${i + 1}/${files.length}… ${file.name.slice(0, 24)}`;
    try {
      const hash = await models.quickHash(file);
      const dup = await models.findDuplicate(hash);
      if (dup) { dupes++; continue; }

      // carpeta según webkitRelativePath (importación de carpeta)
      let fid = folderId;
      const rel = file.webkitRelativePath || '';
      if (rel && rel.includes('/')) {
        const parts = rel.split('/'); const dirName = parts[parts.length - 2];
        if (dirName) {
          if (!folderCache[dirName]) {
            const existing = (await models.allFolders()).find((f) => f.name === dirName);
            folderCache[dirName] = existing || await models.createFolder(dirName);
          }
          fid = folderCache[dirName].id;
        }
      }

      let extracted = { meta: {}, coverBlob: null, format: extOf(file.name), kind: 'reflow' };
      try { extracted = await extractMeta(file); } catch (_) {}
      const g = guessFromFilename(file.name);
      const m = extracted.meta || {};

      const book = models.newBookRecord({
        hash, format: extracted.format, kind: extracted.kind || 'reflow',
        title: (m.title || g.title || file.name).trim(),
        author: (m.author || g.author || '').trim(),
        series: m.series || g.series || '', volume: m.volume || g.volume || null,
        language: m.language || '', publisher: m.publisher || '', year: m.year || '',
        isbn: m.isbn || '', description: m.description || '', category: m.category || '',
        subjects: m.subjects || [], size: file.size, pages: m.pages || 0,
        folderId: fid, filename: file.name,
      });

      await storage.saveBook(book.id, file);

      // portada
      if (extracted.coverBlob) { await storage.saveCover(book.id, extracted.coverBlob); book.coverType = 'image'; }
      else { const gen = await generateCoverBlob(book); await storage.saveCover(book.id, gen); book.coverType = 'generated'; }

      await models.saveBook(book);
      added++;
    } catch (e) { console.error('import', file.name, e); errors++; }
  }

  t.remove();
  const parts = [`${added} añadido${added === 1 ? '' : 's'}`];
  if (dupes) parts.push(`${dupes} duplicado${dupes === 1 ? '' : 's'} omitido${dupes === 1 ? '' : 's'}`);
  if (skippedFormat) parts.push(`${skippedFormat} sin soporte`);
  if (errors) parts.push(`${errors} con error`);
  toast(parts.join(' · '), { icon: '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>' });
}
