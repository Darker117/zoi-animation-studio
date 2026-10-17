// Tiny DOM helpers: element builder, modals, toasts, context menus, file pickers.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** h('div.card#id', {onclick}, children...) */
export function h(tag, attrs = {}, ...children) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function iconBtn(name, title, onclick, cls = '') {
  return h('button.btn.icon-only' + (cls ? '.' + cls.split(' ').join('.') : ''), { title, 'aria-label': title, onclick, html: icon(name) });
}

// ------------------------------------------------------------------ toasts

export function toast(msg, { type = '', action = null, actionLabel = 'Undo', timeout = 3200 } = {}) {
  const root = $('#toastRoot');
  const el = h('div.toast' + (type ? '.' + type : ''), {},
    h('span', { html: icon(type === 'err' ? 'alert' : type === 'ok' ? 'check' : 'info', 15) }),
    h('span', {}, msg));
  if (action) el.append(h('button.act', { onclick: () => { action(); el.remove(); } }, actionLabel));
  root.append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, timeout);
  return el;
}

// ------------------------------------------------------------------ modals

let openModals = 0;
export function modalOpen() { return openModals > 0; }

/**
 * Opens a modal. content: Node or function(close) => Node. Returns { close, el }.
 * buttons: [{label, primary, danger, onClick(close) => (false to keep open)}]
 */
export function modal({ title, content, buttons = [], wide = false, onClose, dismissable = true, footLeft = null }) {
  const root = $('#modalRoot');
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    openModals--;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.(result);
  };
  const body = h('div.modal-body');
  const box = h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', {}, h('h2', {}, title), dismissable ? iconBtn('x', 'Close', () => close(null), 'ghost') : null),
    body);
  const c = typeof content === 'function' ? content(close) : content;
  if (c) body.append(c);
  if (buttons.length || footLeft) {
    const foot = h('div.modal-foot');
    if (footLeft) { footLeft.classList.add('left'); foot.append(footLeft); }
    for (const b of buttons) {
      foot.append(h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), {
        onclick: async () => { const r = await b.onClick?.(close); if (r !== false) close(b.value ?? true); },
      }, b.label));
    }
    box.append(foot);
  }
  const back = h('div.modal-backdrop', { onmousedown: (e) => { if (e.target === back && dismissable) close(null); } }, box);
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(null); }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      const primary = buttons.find((b) => b.primary);
      if (primary && !e.target.matches('button')) { e.preventDefault(); box.querySelector('.modal-foot .btn.primary')?.click(); }
    }
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  root.append(back);
  openModals++;
  setTimeout(() => box.querySelector('input, select, textarea, .btn.primary')?.focus(), 30);
  return { close, el: box, body };
}

export function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      content: h('p', { style: { margin: '4px 0 8px', color: 'var(--text-2)' } }, message),
      buttons: [{ label: 'Cancel', value: false }, { label: okLabel, primary: !danger, danger, value: true }],
      onClose: (r) => resolve(!!r),
    });
  });
}

export function promptDialog(title, label, value = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value });
    modal({
      title,
      content: h('div', {}, h('div.muted', { style: { marginBottom: '6px' } }, label), input),
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onClick: () => { resolve(input.value.trim()); } }],
      onClose: (r) => { if (r == null) resolve(null); },
    });
    setTimeout(() => input.select(), 40);
  });
}

// ------------------------------------------------------------------ context menus

export function contextMenu(x, y, items) {
  const root = $('#menuRoot');
  root.innerHTML = '';
  const menu = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.append(h('div.sep')); continue; }
    if (it.label && it.header) { menu.append(h('div.label', {}, it.label)); continue; }
    menu.append(h('button', { disabled: it.disabled, role: 'menuitem', onclick: () => { close(); it.onClick?.(); } },
      it.icon ? h('span', { html: icon(it.icon, 15) }) : h('span', { style: { width: '15px' } }),
      h('span', {}, it.label), it.shortcut ? h('span.sc', {}, it.shortcut) : null));
  }
  root.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  const close = () => { menu.remove(); window.removeEventListener('mousedown', outside, true); window.removeEventListener('keydown', esc_, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const esc_ = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => { window.addEventListener('mousedown', outside, true); window.addEventListener('keydown', esc_, true); });
  return close;
}

// ------------------------------------------------------------------ files

export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(multiple ? [...input.files] : input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function downloadBlob(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
