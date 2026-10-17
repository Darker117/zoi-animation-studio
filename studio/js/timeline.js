// Dope-sheet timeline (canvas).
import { GROUPS, BONES, BONE_MAP } from './core/rig.js';
import { EXPRESSIONS } from './core/clip.js';
import { EASINGS } from './core/math.js';
import { prefGet, prefSet } from './storage.js';
import { contextMenu } from './ui/dom.js';
import { colorPicker } from './ui/colorPicker.js';

const LW = 178;  // label column
const RH = 26;   // ruler
const ROW = 22;
const DIAMOND = 5.5;
const CHIP_HIT = 24; // label-column x below which a click on a top-level row opens its colour

// Range-bar colours used until the user picks their own (prefs 'trackColors': { rowGroup: '#rrggbb' }).
const BAR_DEFAULT = { summary: '#f673fb', expr: '#f1b9fd', other: '#9064fa' };
const trackColors = () => prefGet('trackColors', {});

export class Timeline {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.expanded = new Set();
    this.scrollY = 0;
    this.offset = 0;       // first visible frame (fractional)
    this.ppf = 8;          // pixels per frame
    this.selection = new Set(); // "bone|ch|f"
    this.dirty = true;
    this.drag = null;
    this.hoverKey = null;
    this._fitPending = true;
    this._bind();
    new ResizeObserver(() => { this.resize(); }).observe(canvas.parentElement);
    this.resize();
  }

  get clip() { return this.app.activeClip; }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this._fitPending) this.fit();
    this.dirty = true;
  }

  fit() {
    const clip = this.clip;
    if (!clip || this.w < 50) { this._fitPending = true; return; }
    this._fitPending = false;
    this.ppf = Math.max(1.2, (this.w - LW - 40) / Math.max(10, clip.frames + 2));
    this.offset = -1;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ rows

  rows() {
    const rows = [{ id: 'summary', group: 'summary', label: 'All keys', bones: null, level: 0, kind: 'summary', color: BAR_DEFAULT.summary }];
    for (const g of GROUPS) {
      const bones = BONES.filter((b) => b.group === g.id).map((b) => b.name);
      rows.push({ id: g.id, group: g.id, label: g.label, bones, level: 0, kind: 'group', color: g.color, expandable: true });
      if (this.expanded.has(g.id)) {
        for (const b of bones) {
          rows.push({ id: b, group: g.id, label: BONE_MAP.get(b).label.replace(/^(Left|Right) /, ''), bones: [b], level: 1, kind: 'bone', color: g.color });
          if (b === 'hips') rows.push({ id: 'hips:pos', group: g.id, label: 'Hips position', bones: ['hips'], ch: 'pos', level: 1, kind: 'bone', color: g.color });
        }
      }
    }
    rows.push({ id: 'expr', group: 'expr', label: 'Face (live link)', level: 0, kind: 'group', color: '#e0a3ff', expandable: true, expr: true });
    if (this.expanded.has('expr')) for (const e of EXPRESSIONS) rows.push({ id: 'expr:' + e.id, group: 'expr', label: e.label, level: 1, kind: 'expr', expr: e.id, color: '#e0a3ff' });
    return rows;
  }

  /** Key frames shown on a row → Map(frame -> [{bone,ch,f}]) */
  rowKeys(row) {
    const clip = this.clip;
    const out = new Map();
    if (!clip) return out;
    const push = (bone, ch, f) => { if (!out.has(f)) out.set(f, []); out.get(f).push({ bone, ch, f }); };
    if (row.kind === 'expr') { for (const k of clip.keys(row.expr, 'expr')) push(row.expr, 'expr', k.f); return out; }
    if (row.expr) { for (const [n, keys] of Object.entries(clip.expr)) for (const k of keys) push(n, 'expr', k.f); return out; }
    const bones = row.bones || Object.keys(clip.tracks);
    for (const b of bones) {
      const t = clip.tracks[b];
      if (!t) continue;
      if (row.ch !== 'pos') for (const k of t.rot) push(b, 'rot', k.f);
      if (row.ch === 'pos' || row.kind !== 'bone') for (const k of t.pos) push(b, 'pos', k.f);
    }
    if (row.kind === 'summary') for (const [n, keys] of Object.entries(clip.expr)) for (const k of keys) push(n, 'expr', k.f);
    return out;
  }

  fx(f) { return LW + (f - this.offset) * this.ppf; }
  xf(x) { return (x - LW) / this.ppf + this.offset; }

  // ------------------------------------------------------------------ drawing

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const { ctx, w, h } = this;
    const clip = this.clip;
    const C = { panel: '#2b2d33', alt: '#2f3238', field: '#1c1d22', line: '#383c40', text: '#f1edf4', text2: '#c9c6cf', muted: '#9a9ca4', faint: '#6c6f77', teal: '#3cdac1', pink: '#f673fb', purple: '#9064fa', pinkLight: '#f1b9fd', gold: '#d9bc5f' };
    const FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, 0, w, h);
    if (!clip) return;
    const rows = this.rows();
    this._rows = rows;
    const maxScroll = Math.max(0, rows.length * ROW - (h - RH) + 8);
    this.scrollY = Math.min(Math.max(0, this.scrollY), maxScroll);
    const endX = this.fx(clip.frames);
    const startX = this.fx(0);

    // Rows: alternating stripes, range bar from first to last key, keys on top.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, RH, w, h - RH); ctx.clip();
    const sel = this.app.selectedBone;
    const custom = trackColors();
    rows.forEach((row, i) => {
      const y = RH + i * ROW - this.scrollY;
      if (y + ROW < RH || y > h) return;
      const isSel = row.bones && sel && (row.kind === 'bone' ? row.bones[0] === sel : row.bones.includes(sel));
      ctx.fillStyle = isSel ? '#353840' : i % 2 ? C.alt : C.panel;
      ctx.fillRect(0, y, w, ROW);
      // Label.
      let lx = 10 + row.level * 14;
      if (row.color) {
        // Colour chip: top-level chips are a little wider and open the colour picker.
        ctx.fillStyle = custom[row.group] || row.color;
        const cw = row.level ? 3 : 5;
        roundRect(ctx, lx, y + ROW / 2 - 5, cw, 10, 1.5);
        ctx.fill();
        lx += cw + 7;
      }
      if (row.expandable) {
        ctx.fillStyle = C.muted;
        const open = this.expanded.has(row.id);
        const ax = LW - 16, ay = y + ROW / 2;
        ctx.beginPath();
        if (open) { ctx.moveTo(ax - 4, ay - 2); ctx.lineTo(ax + 4, ay - 2); ctx.lineTo(ax, ay + 3); }
        else { ctx.moveTo(ax - 2, ay - 4); ctx.lineTo(ax + 3, ay); ctx.lineTo(ax - 2, ay + 4); }
        ctx.fill();
      }
      ctx.font = `${row.level ? 400 : 600} 11.5px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = row.kind === 'summary' ? C.text : row.level ? C.muted : C.text2;
      ctx.fillText(row.label, lx, y + ROW / 2 + 0.5);
      // Range bar.
      const keys = this.rowKeys(row);
      if (keys.size) {
        const frames = [...keys.keys()];
        const f0 = Math.min(...frames), f1 = Math.max(...frames);
        const bx = Math.max(LW, this.fx(f0)), bx1 = Math.min(w, this.fx(f1));
        if (bx1 > bx) {
          ctx.fillStyle = custom[row.group] || this._defaultBar(row);
          ctx.globalAlpha = row.kind === 'summary' ? 0.95 : row.level ? 0.45 : 0.75;
          roundRect(ctx, bx, y + ROW / 2 - 4, bx1 - bx, 8, 4);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      for (const [f, list] of keys) {
        const x = this.fx(f);
        if (x < LW - 6 || x > w + 6) continue;
        const selected = list.every((k) => this.selection.has(keyId(k)));
        const partSel = !selected && list.some((k) => this.selection.has(keyId(k)));
        const k0 = list[0];
        const key = this.clip.getKey(k0.bone, k0.ch, f);
        drawDiamond(ctx, x, y + ROW / 2, row.kind === 'summary' ? DIAMOND + 0.8 : DIAMOND,
          selected ? C.teal : partSel ? '#9fe9dc' : C.text, key?.e || 'auto');
      }
    });
    ctx.restore();

    // Outside the clip range.
    ctx.fillStyle = 'rgba(20, 21, 25, 0.35)';
    if (endX < w) ctx.fillRect(Math.max(LW, endX), RH, w - Math.max(LW, endX), h - RH);
    if (startX > LW) ctx.fillRect(LW, RH, startX - LW, h - RH);

    // Label column divider.
    ctx.fillStyle = C.line;
    ctx.fillRect(LW - 1, 0, 1, h);

    // Ruler.
    ctx.fillStyle = C.field;
    ctx.fillRect(0, 0, w, RH);
    ctx.fillStyle = C.muted;
    ctx.font = `600 10.5px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${clip.fps} fps · ${(clip.frames / clip.fps).toFixed(2)} s`, 10, RH / 2 + 1);
    const step = niceStep(this.ppf);
    const f0 = Math.floor(this.offset / step) * step;
    ctx.save();
    ctx.beginPath(); ctx.rect(LW, 0, w - LW, h); ctx.clip();
    for (let f = f0; this.fx(f) < w; f += step) {
      const x = Math.round(this.fx(f)) + 0.5;
      const major = f % (step * 4) === 0;
      ctx.strokeStyle = major ? '#4a4e56' : '#33363c';
      ctx.beginPath(); ctx.moveTo(x, major ? RH - 9 : RH - 5); ctx.lineTo(x, RH); ctx.stroke();
      ctx.strokeStyle = 'rgba(56, 60, 64, 0.55)';
      ctx.beginPath(); ctx.moveTo(x, RH); ctx.lineTo(x, h); ctx.stroke();
      if (f >= 0 && major) {
        ctx.fillStyle = C.muted;
        ctx.font = `10.5px ${FONT}`;
        ctx.fillText(String(f).padStart(2, '0') + 'f', x + 4, 9);
      }
    }
    // Markers.
    for (const m of clip.markers || []) {
      const x = this.fx(m.f);
      ctx.fillStyle = C.gold;
      ctx.beginPath(); ctx.moveTo(x - 4, RH - 8); ctx.lineTo(x + 4, RH - 8); ctx.lineTo(x, RH - 3); ctx.fill();
    }
    // End handle.
    ctx.fillStyle = C.pinkLight;
    ctx.fillRect(endX - 1, RH, 2, h - RH);
    roundRect(ctx, endX - 1, 4, 8, RH - 8, 2);
    ctx.fill();
    // Playhead: teal line with a rounded tab.
    const px = Math.round(this.fx(this.app.frame));
    ctx.fillStyle = C.teal;
    ctx.fillRect(px - 1, RH - 2, 2, h);
    const label = String(Math.round(this.app.frame)).padStart(2, '0') + 'f';
    ctx.font = `700 10.5px ${FONT}`;
    const tw = Math.max(26, ctx.measureText(label).width + 12);
    roundRect(ctx, px - tw / 2, 3, tw, RH - 7, 4);
    ctx.fill();
    ctx.fillStyle = '#15161a';
    ctx.textAlign = 'center';
    ctx.fillText(label, px, (RH - 4) / 2 + 1.5);
    ctx.textAlign = 'left';
    // Box select.
    if (this.drag?.kind === 'box' && this.drag.moved) {
      const d = this.drag;
      ctx.fillStyle = 'rgba(60, 218, 193, 0.12)';
      ctx.strokeStyle = 'rgba(60, 218, 193, 0.8)';
      const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
      ctx.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    if (this.drag?.kind === 'move' && this.drag.delta) {
      ctx.fillStyle = C.text;
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(`${this.drag.delta > 0 ? '+' : ''}${this.drag.delta} frames`, this.drag.x1 + 10, this.drag.y1 - 8);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ track colours

  _defaultBar(row) { return BAR_DEFAULT[row.group] || BAR_DEFAULT.other; }

  /** Opens the swatch / chroma-wheel picker for a track; changes show live. */
  _pickColor(row, cx, cy) {
    const setColor = (c) => {
      const t = { ...trackColors() };
      if (c) t[row.group] = c; else delete t[row.group];
      prefSet('trackColors', t);
      this.dirty = true;
    };
    colorPicker(cx, cy, {
      title: `${row.label} colour`,
      value: trackColors()[row.group] || this._defaultBar(row),
      onInput: setColor,
      onReset: () => setColor(null),
    });
  }

  // ------------------------------------------------------------------ hit testing

  _rowAt(y) {
    if (y < RH) return null;
    const i = Math.floor((y - RH + this.scrollY) / ROW);
    return this._rows?.[i] || null;
  }

  _keyAt(x, y) {
    const row = this._rowAt(y);
    if (!row || x < LW) return null;
    const keys = this.rowKeys(row);
    let best = null, bd = 8;
    for (const [f, list] of keys) {
      const d = Math.abs(this.fx(f) - x);
      if (d < bd) { bd = d; best = { row, f, list }; }
    }
    return best;
  }

  // ------------------------------------------------------------------ interaction

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('dblclick', (e) => this._dbl(e));
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this._context(e); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x } = this._pos(e);
      if (e.ctrlKey || (x > LW && this._pos(e).y < RH)) {
        const f = this.xf(x);
        this.ppf = Math.min(60, Math.max(0.5, this.ppf * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        this.offset = f - (x - LW) / this.ppf;
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.offset += (e.deltaX || e.deltaY) / this.ppf;
      } else {
        this.scrollY += e.deltaY;
      }
      this.dirty = true;
    }, { passive: false });
  }

  _pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  _down(e) {
    if (e.button !== 0) return;
    const { x, y } = this._pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    const clip = this.clip;
    if (!clip) return;
    // End handle.
    if (Math.abs(x - this.fx(clip.frames)) < 6 && y < RH + 4 && x > LW) { this.drag = { kind: 'end', startFrames: clip.frames }; return; }
    if (y < RH && x > LW) { this.drag = { kind: 'scrub' }; this.app.setFrame(Math.round(this.xf(x))); return; }
    if (x < LW) {
      const row = this._rowAt(y);
      if (!row) return;
      if (!row.level && x < CHIP_HIT) { this._pickColor(row, e.clientX, e.clientY); return; }
      if (row.kind === 'bone') this.app.select(row.bones[0]);
      else if (row.expandable) this._toggle(row);
      return;
    }
    const hit = this._keyAt(x, y);
    if (hit) {
      const ids = hit.list.map(keyId);
      const allSel = ids.every((id) => this.selection.has(id));
      if (e.shiftKey || e.ctrlKey) { for (const id of ids) allSel ? this.selection.delete(id) : this.selection.add(id); }
      else if (!allSel) { this.selection.clear(); ids.forEach((id) => this.selection.add(id)); }
      this.drag = { kind: 'move', x0: x, y0: y, x1: x, y1: y, startF: hit.f, delta: 0, moved: false };
      this.app.onKeySelectionChanged();
      this.dirty = true;
      return;
    }
    this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, moved: false, additive: e.shiftKey };
  }

  _toggle(row) {
    if (this.expanded.has(row.id)) this.expanded.delete(row.id); else this.expanded.add(row.id);
    this.dirty = true;
  }

  _move(e) {
    const { x, y } = this._pos(e);
    const d = this.drag;
    if (!d) {
      const hit = this._keyAt(x, y);
      const onEnd = this.clip && Math.abs(x - this.fx(this.clip.frames)) < 6 && y < RH + 4 && x > LW;
      const onChip = x < CHIP_HIT && y >= RH && this._rowAt(y) && !this._rowAt(y).level;
      this.canvas.style.cursor = onEnd ? 'ew-resize' : hit || onChip ? 'pointer' : y < RH && x > LW ? 'col-resize' : '';
      return;
    }
    if (d.kind === 'scrub') { this.app.setFrame(Math.max(0, Math.round(this.xf(x)))); return; }
    if (d.kind === 'end') {
      const f = Math.max(1, Math.round(this.xf(x)));
      this.app.setStageLength(f, { live: true });
      this.dirty = true;
      return;
    }
    d.x1 = x; d.y1 = y;
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 3) d.moved = true;
    if (d.kind === 'move') d.delta = Math.round(this.xf(x) - this.xf(d.x0));
    this.dirty = true;
  }

  _up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const { x } = this._pos(e);
    if (d.kind === 'end') { this.app.setStageLength(Math.max(1, Math.round(this.xf(x))), { commitFrom: d.startFrames }); return; }
    if (d.kind === 'move') {
      if (d.moved && d.delta) this.app.moveSelectedKeys(d.delta);
      else if (!d.moved) this.app.setFrame(d.startF);
    } else if (d.kind === 'box') {
      if (!d.moved) {
        this.selection.clear();
        this.app.onKeySelectionChanged();
        this.app.setFrame(Math.max(0, Math.round(this.xf(d.x0))));
      } else {
        if (!d.additive) this.selection.clear();
        const fa = this.xf(Math.min(d.x0, d.x1)), fb = this.xf(Math.max(d.x0, d.x1));
        const ya = Math.min(d.y0, d.y1), yb = Math.max(d.y0, d.y1);
        (this._rows || []).forEach((row, i) => {
          const ry = RH + i * ROW - this.scrollY + ROW / 2;
          if (ry < ya || ry > yb) return;
          for (const [f, list] of this.rowKeys(row)) if (f >= fa && f <= fb) list.forEach((k) => this.selection.add(keyId(k)));
        });
        this.app.onKeySelectionChanged();
      }
    }
    this.dirty = true;
  }

  _dbl(e) {
    const { x, y } = this._pos(e);
    if (x < LW || y < RH) return;
    const row = this._rowAt(y);
    if (!row) return;
    const f = Math.max(0, Math.round(this.xf(x)));
    this.app.setFrame(f);
    if (row.kind === 'expr') this.app.keyExpression(row.expr);
    else this.app.keyBones(row.bones || null, { label: `Key ${row.label}` });
  }

  _context(e) {
    const { x, y } = this._pos(e);
    if (x < LW && y >= RH) {
      const row = this._rowAt(y);
      if (!row) return;
      const top = row.level ? this._rows.find((r) => !r.level && r.group === row.group) : row;
      contextMenu(e.clientX, e.clientY, [
        { label: top.label, header: true },
        { label: 'Track colour…', icon: 'palette', onClick: () => this._pickColor(top, e.clientX, e.clientY) },
        { label: 'Default colour', icon: 'reset', disabled: !trackColors()[top.group], onClick: () => { const t = { ...trackColors() }; delete t[top.group]; prefSet('trackColors', t); this.dirty = true; } },
      ]);
      return;
    }
    if (x < LW || y < RH) return;
    const hit = this._keyAt(x, y);
    if (hit) {
      const ids = hit.list.map(keyId);
      if (!ids.every((id) => this.selection.has(id))) { this.selection.clear(); ids.forEach((id) => this.selection.add(id)); this.app.onKeySelectionChanged(); }
      this.dirty = true;
      this.app.showKeyMenu(e.clientX, e.clientY, hit.f);
    } else {
      const row = this._rowAt(y);
      const f = Math.max(0, Math.round(this.xf(x)));
      this.app.showTimelineMenu(e.clientX, e.clientY, f, row);
    }
  }

  selectedKeys() {
    return [...this.selection].map((id) => { const [bone, ch, f] = id.split('|'); return { bone, ch, f: +f }; });
  }

  ensureVisible(f) {
    const x = this.fx(f);
    if (x < LW + 10) this.offset = f - 4;
    else if (x > this.w - 20) this.offset = f - (this.w - LW - 60) / this.ppf;
    this.dirty = true;
  }
}

export const keyId = (k) => `${k.bone}|${k.ch}|${k.f}`;

function niceStep(ppf) {
  const target = 60 / ppf;
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s >= target) return s;
  return 600;
}

function drawDiamond(ctx, x, y, r, color, ease) {
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(21, 22, 26, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ease === 'step') {
    ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  } else if (ease === 'linear') {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  } else if (ease === 'auto') {
    ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
  } else {
    ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x + r, y - r, x + r, y); ctx.quadraticCurveTo(x + r, y + r, x, y + r);
    ctx.quadraticCurveTo(x - r, y + r, x - r, y); ctx.quadraticCurveTo(x - r, y - r, x, y - r);
  }
  ctx.fill();
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export { EASINGS };
