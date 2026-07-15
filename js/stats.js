/* stats.js — Estadísticas de lectura: horas, racha, metas,
   calendario tipo GitHub, ritmo, récords y exportación. */
import * as models from './models.js';
import { settings } from './db.js';
import { toast } from './toast.js';

export async function render(container, App) {
  const s = await models.computeStats();
  const goalMin = settings.get('goalMinutes');
  const todayKey = models.today();
  const todaySec = s.byDay[todayKey] || 0;
  const goalPct = Math.min(1, (todaySec / 60) / goalMin);

  container.innerHTML = `
    <div class="section-title">Hoy</div>
    <div class="card" style="display:flex;align-items:center;gap:18px">
      ${ring(goalPct)}
      <div style="flex:1">
        <div style="font-size:26px;font-weight:800">${fmtDur(todaySec)}</div>
        <div class="muted" style="font-size:13px">de tu meta de ${goalMin} min · ${Math.round(goalPct*100)}%</div>
        <div class="pillrow"><span class="tag">🔥 ${s.streak} día${s.streak===1?'':'s'} de racha</span></div>
      </div>
    </div>

    <div class="section-title">Resumen</div>
    <div class="stat-grid">
      ${tile(fmtHours(s.totalHours), 'Horas leídas', '', true)}
      ${tile(s.finished, 'Libros terminados')}
      ${tile(s.started, 'Libros empezados')}
      ${tile(s.streak, 'Racha (días)')}
      ${tile(Math.round(s.pagesPerDay), 'Páginas / día')}
      ${tile(s.wpm ? Math.round(s.wpm) : '—', 'Palabras / min')}
      ${tile(Math.round(s.avgSessionMin), 'Min / sesión')}
      ${tile(s.sessionsCount, 'Sesiones')}
    </div>

    <div class="section-title">Actividad · último año</div>
    <div class="card"><div class="heat" id="heat"></div>
      <div style="display:flex;justify-content:flex-end;gap:4px;align-items:center;margin-top:8px;font-size:11px" class="muted">menos
        <span class="cell" style="width:11px;height:11px;border-radius:3px;background:var(--surface-2)"></span>
        <span class="cell l1" style="width:11px;height:11px;border-radius:3px"></span>
        <span class="cell l2" style="width:11px;height:11px;border-radius:3px"></span>
        <span class="cell l3" style="width:11px;height:11px;border-radius:3px"></span>
        <span class="cell l4" style="width:11px;height:11px;border-radius:3px"></span> más</div>
    </div>

    <div class="section-title">Últimos 14 días</div>
    <div class="card"><div class="bars" id="bars"></div><div class="bars-x" id="barsx"></div></div>

    <div class="section-title">Tus horas favoritas</div>
    <div class="card">
      <div class="bars" id="hours" style="height:80px"></div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Sueles leer más alrededor de las <b>${s.favHour}:00</b>.</p>
    </div>

    <div class="section-title">Metas</div>
    <div class="card">
      <div class="field"><label>Meta diaria (minutos)</label><input type="range" id="gMin" min="5" max="180" value="${goalMin}"><div class="center muted" id="gMinV">${goalMin} min</div></div>
    </div>

    <div class="section-title">Exportar</div>
    <div class="row"><button class="btn ghost" id="expCsv">CSV</button><button class="btn ghost" id="expPdf">PDF / Imprimir</button></div>
    <div style="height:20px"></div>`;

  buildHeat(container.querySelector('#heat'), s.byDay);
  buildBars(container.querySelector('#bars'), container.querySelector('#barsx'), s.byDay);
  buildHours(container.querySelector('#hours'), s.byHour);

  const g = container.querySelector('#gMin');
  g.oninput = () => { container.querySelector('#gMinV').textContent = g.value + ' min'; };
  g.onchange = () => { settings.set('goalMinutes', parseInt(g.value, 10)); toast('Meta actualizada'); render(container, App); };
  container.querySelector('#expCsv').onclick = () => exportCsv(App);
  container.querySelector('#expPdf').onclick = () => window.print();
}

function tile(val, lbl, ic = '', accent = false) {
  return `<div class="stat-tile ${accent ? 'accent' : ''}"><div class="val">${val}</div><div class="lbl">${lbl}</div></div>`;
}
function ring(pct) {
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - pct);
  return `<svg class="ring" width="84" height="84" viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="${r}"/><circle class="val" cx="42" cy="42" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>`;
}
function buildHeat(el, byDay) {
  const days = 371; const now = new Date(); const max = Math.max(1, ...Object.values(byDay));
  // alinear a inicio de semana
  const start = new Date(now); start.setDate(start.getDate() - days);
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const v = byDay[key] || 0;
    const lvl = v === 0 ? 0 : v / max > 0.66 ? 4 : v / max > 0.4 ? 3 : v / max > 0.15 ? 2 : 1;
    const cell = document.createElement('div');
    cell.className = 'cell' + (lvl ? ' l' + lvl : '');
    cell.title = `${key}: ${fmtDur(v)}`;
    el.appendChild(cell);
  }
}
function buildBars(bars, barsx, byDay) {
  const now = new Date(); const arr = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); const key = d.toISOString().slice(0, 10); arr.push({ key, v: byDay[key] || 0, d }); }
  const max = Math.max(1, ...arr.map((a) => a.v));
  bars.innerHTML = arr.map((a) => `<div class="bar" style="height:${Math.max(3, (a.v / max) * 100)}%"><i></i></div>`).join('');
  barsx.innerHTML = arr.map((a, i) => `<span>${i % 2 === 0 ? a.d.getDate() : ''}</span>`).join('');
}
function buildHours(el, byHour) {
  const max = Math.max(1, ...byHour);
  el.innerHTML = byHour.map((v) => `<div class="bar" style="height:${Math.max(2, (v / max) * 100)}%"><i></i></div>`).join('');
}

async function exportCsv(App) {
  const sessions = await models.allSessions();
  const books = await models.allBooks();
  const bmap = Object.fromEntries(books.map((b) => [b.id, b.title]));
  let csv = 'fecha,inicio,libro,minutos,paginas,porcentaje_inicio,porcentaje_fin\n';
  sessions.sort((a, b) => a.startedAt - b.startedAt).forEach((s) => {
    csv += `${s.day},${new Date(s.startedAt).toISOString()},"${(bmap[s.bookId] || '').replace(/"/g, '""')}",${((s.seconds || 0) / 60).toFixed(1)},${s.pagesRead || 0},${((s.startPercent || 0) * 100).toFixed(0)},${((s.endPercent || 0) * 100).toFixed(0)}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'coral-estadisticas.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('CSV exportado');
}

function fmtDur(sec) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; }
function fmtHours(h) { return h < 1 ? Math.round(h * 60) + 'm' : h.toFixed(1) + 'h'; }
