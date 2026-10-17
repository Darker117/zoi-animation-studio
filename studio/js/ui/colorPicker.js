// Colour picker popover: quick swatches, a chroma wheel (hue around the circle, saturation
// outward from the centre), a brightness slider and a hex field. Every change applies live.
import { h } from './dom.js';

export const SWATCHES = [
  '#3cdac1', '#25c8e8', '#4c8dff', '#9064fa', '#f673fb', '#f1b9fd',
  '#ff6b8b', '#ff9f43', '#d9bc5f', '#a3e05c', '#f1edf4', '#8b8f98',
];

let current = null;

/**
 * Opens the picker near (x, y) in page pixels.
 * opts: { title, value: '#rrggbb', onInput(hex), onReset() | null }
 */
export function colorPicker(x, y, { title = 'Colour', value = '#9064fa', onInput, onReset = null }) {
  current?.close();
  let [hue, sat, val] = hexToHsv(value);
  const SIZE = 172;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const wheel = h('canvas.cp-wheel', { width: Math.round(SIZE * dpr), height: Math.round(SIZE * dpr) });
  const marker = h('div.cp-marker');
  const wheelWrap = h('div.cp-wheel-wrap', { title: 'Drag to pick any colour' }, wheel, marker);
  const bright = h('input.cp-bright', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(val * 100), title: 'Brightness' });
  const preview = h('div.cp-preview');
  const hex = h('input.cp-hex', { type: 'text', spellcheck: false, maxLength: 7, 'aria-label': 'Hex colour' });
  const swatches = SWATCHES.map((c) => h('button.cp-swatch', { title: c, style: { background: c }, onclick: () => set(c) }));
  const reset = onReset ? h('button.btn.small', { onclick: () => { onReset(); close(); } }, 'Default') : null;
  const pop = h('div.color-pop', { role: 'dialog', 'aria-label': title },
    h('div.cp-title', {}, title),
    h('div.cp-swatches', {}, swatches),
    wheelWrap,
    bright,
    h('div.cp-row', {}, preview, hex, reset));
  document.body.append(pop);

  const ctx = wheel.getContext('2d');
  const drawWheel = () => {
    const n = wheel.width, R = n / 2;
    const img = ctx.createImageData(n, n), d = img.data;
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) {
        const dx = px + 0.5 - R, dy = py + 0.5 - R;
        const r = Math.hypot(dx, dy) / R;
        const i = (py * n + px) * 4;
        if (r > 1) continue;
        const [cr, cg, cb] = hsvToRgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, r, val);
        d[i] = cr; d[i + 1] = cg; d[i + 2] = cb;
        d[i + 3] = r > 0.985 ? Math.round(255 * (1 - r) / 0.015) : 255; // soft rim
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  const sync = ({ wheelToo = false, fromHex = false } = {}) => {
    const c = hsvToHex(hue, sat, val);
    const a = (hue * Math.PI) / 180, R = SIZE / 2;
    marker.style.left = R + Math.cos(a) * sat * R + 'px';
    marker.style.top = R + Math.sin(a) * sat * R + 'px';
    marker.style.background = c;
    preview.style.background = c;
    bright.style.setProperty('--cp-grad', `linear-gradient(to right, #000, ${hsvToHex(hue, sat, 1)})`);
    if (!fromHex) hex.value = c;
    swatches.forEach((s, i) => s.classList.toggle('on', SWATCHES[i] === c));
    if (wheelToo) drawWheel();
    onInput?.(c);
  };
  const set = (c) => {
    const hsv = hexToHsv(c);
    if (!hsv) return;
    [hue, sat, val] = hsv;
    bright.value = Math.round(val * 100);
    sync({ wheelToo: true });
  };

  // Wheel dragging.
  const pick = (e) => {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    sat = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    if (val < 0.05) { val = 1; bright.value = 100; sync({ wheelToo: true }); } else sync();
  };
  wheelWrap.addEventListener('pointerdown', (e) => { wheelWrap.setPointerCapture(e.pointerId); pick(e); });
  wheelWrap.addEventListener('pointermove', (e) => { if (wheelWrap.hasPointerCapture(e.pointerId)) pick(e); });
  bright.addEventListener('input', () => { val = bright.value / 100; sync({ wheelToo: true }); });
  hex.addEventListener('input', () => {
    const hsv = hexToHsv(hex.value);
    if (!hsv) return;
    [hue, sat, val] = hsv;
    bright.value = Math.round(val * 100);
    sync({ wheelToo: true, fromHex: true });
  });
  hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(); });

  // Placement: beside the click, kept on screen.
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(x + 10, window.innerWidth - r.width - 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(y - 20, window.innerHeight - r.height - 8)) + 'px';

  const outside = (e) => { if (!pop.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (current !== handle) return;
    current = null;
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
  }
  const handle = { close };
  current = handle;
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
  });
  drawWheel();
  // Show the starting colour without reporting a change.
  const report = onInput;
  onInput = null;
  sync();
  onInput = report;
  return handle;
}

// ------------------------------------------------------------------ colour maths

export function hexToHsv(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const r = parseInt(s.slice(0, 2), 16) / 255, g = parseInt(s.slice(2, 4), 16) / 255, b = parseInt(s.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) {
    if (max === r) hh = ((g - b) / d) % 6;
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh = (hh * 60 + 360) % 360;
  }
  return [hh, max ? d / max : 0, max];
}

function hsvToRgb(hh, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function hsvToHex(hh, s, v) {
  return '#' + hsvToRgb(hh, s, v).map((n) => n.toString(16).padStart(2, '0')).join('');
}
