/* toast.js — notificaciones efímeras con acción opcional (deshacer). */
const host = () => document.getElementById('toastHost');

export function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  const icon = opts.icon || '';
  el.innerHTML = `${icon}<span>${msg}</span>`;
  if (opts.actionLabel) {
    const b = document.createElement('button');
    b.className = 'undo'; b.textContent = opts.actionLabel;
    b.onclick = () => { opts.onAction && opts.onAction(); dismiss(el); };
    el.appendChild(b);
  }
  host().appendChild(el);
  const t = setTimeout(() => dismiss(el), opts.duration || 3200);
  el._t = t;
  return el;
}
function dismiss(el) {
  clearTimeout(el._t);
  el.classList.add('out');
  setTimeout(() => el.remove(), 300);
}
export function haptic(ms = 8) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {} }
