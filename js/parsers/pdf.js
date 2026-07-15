/* pdf.js — envoltura de pdf.js (vendorizado). Metadatos + portada (render pág.1),
   y apertura perezosa: el lector renderiza páginas a canvas bajo demanda. */
export const kind = 'pdf';

function lib() {
  if (!window.pdfjsLib) throw new Error('pdf.js no cargó');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.js', import.meta.url).href;
  return pdfjsLib;
}

async function getDoc(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  return lib().getDocument({ data, disableAutoFetch: true, disableStream: true }).promise;
}

async function renderCover(pdf) {
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 640 / vp.width);
  const v = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(v.width); canvas.height = Math.round(v.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: v }).promise;
  return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.85));
}

export async function meta(file) {
  try {
    const pdf = await getDoc(file);
    let info = {}; try { info = (await pdf.getMetadata()).info || {}; } catch (_) {}
    let coverBlob = null; try { coverBlob = await renderCover(pdf); } catch (_) {}
    const m = {
      title: (info.Title || '').trim() || file.name.replace(/\.[^.]+$/, ''),
      author: (info.Author || '').trim(),
      publisher: (info.Producer || '').trim(),
      pages: pdf.numPages,
      category: (info.Subject || '').trim(),
      language: '',
    };
    pdf.destroy?.();
    return { meta: m, coverBlob, kind };
  } catch (e) {
    return { meta: { title: file.name.replace(/\.[^.]+$/, ''), pages: 0 }, coverBlob: null, kind };
  }
}

export async function open(file) {
  const pdf = await getDoc(file);
  let outline = []; try { outline = (await pdf.getOutline()) || []; } catch (_) {}
  const toc = [];
  for (const o of outline) {
    let pageIndex = null;
    try { if (o.dest) { const d = typeof o.dest === 'string' ? await pdf.getDestination(o.dest) : o.dest; if (d && d[0]) pageIndex = await pdf.getPageIndex(d[0]); } } catch (_) {}
    toc.push({ label: o.title, page: pageIndex });
  }
  return { kind, meta: { title: file.name.replace(/\.[^.]+$/, ''), pages: pdf.numPages }, pdfDoc: pdf, numPages: pdf.numPages, toc };
}
