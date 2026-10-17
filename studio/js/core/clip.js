// Keyframed animation clip for one actor.
//
// tracks[bone] = { rot: Key[], pos: Key[] }   (pos is only used for the hips)
// Key = { f: frame (integer), v: [x,y,z,w] | [x,y,z], e: easing id (see EASINGS) }
// The easing on a key controls the segment that LEAVES that key.
import {
  EASINGS, qAlign, qNormalize, qSlerp, qEquals, vEquals, lerp, qMirrorX, qIdentity, qDot,
} from './math.js';
import { BONE_NAMES, mirrorName } from './rig.js';

export const EXPRESSIONS = [
  { id: 'Joy', label: 'Happy' }, { id: 'Fun', label: 'Smile' }, { id: 'Angry', label: 'Angry' },
  { id: 'Sorrow', label: 'Sad' }, { id: 'Surprised', label: 'Surprised' }, { id: 'Blink', label: 'Blink' },
  { id: 'A', label: 'Mouth A' }, { id: 'I', label: 'Mouth I' }, { id: 'U', label: 'Mouth U' },
  { id: 'E', label: 'Mouth E' }, { id: 'O', label: 'Mouth O' },
];

const cloneKeys = (keys) => keys.map((k) => ({ f: k.f, v: k.v.slice(), e: k.e }));

export class Clip {
  constructor({ name = 'New animation', fps = 30, frames = 60, loop = false } = {}) {
    this.name = name;
    this.fps = fps;
    this.frames = frames;
    this.loop = loop;
    this.tracks = {};
    this.expr = {};
    this.markers = [];
  }

  get duration() { return this.frames / this.fps; }

  track(bone, create = false) {
    let t = this.tracks[bone];
    if (!t && create) t = this.tracks[bone] = { rot: [], pos: [] };
    return t;
  }

  keys(bone, ch = 'rot') {
    if (ch === 'expr') return this.expr[bone] || [];
    const t = this.tracks[bone];
    return t ? t[ch] : [];
  }

  _keysRef(bone, ch, create) {
    if (ch === 'expr') {
      if (!this.expr[bone] && create) this.expr[bone] = [];
      return this.expr[bone];
    }
    const t = this.track(bone, create);
    return t ? t[ch] : null;
  }

  setKey(bone, ch, f, v, e) {
    f = Math.round(f);
    const keys = this._keysRef(bone, ch, true);
    let i = keys.findIndex((k) => k.f === f);
    if (i >= 0) {
      keys[i].v = v.slice();
      if (e) keys[i].e = e;
      return keys[i];
    }
    const prev = this._keyBefore(keys, f);
    const key = { f, v: v.slice(), e: e || (prev ? prev.e : 'auto') };
    i = keys.findIndex((k) => k.f > f);
    if (i < 0) keys.push(key); else keys.splice(i, 0, key);
    return key;
  }

  _keyBefore(keys, f) {
    let best = null;
    for (const k of keys) if (k.f < f) best = k;
    return best;
  }

  getKey(bone, ch, f) {
    const keys = this.keys(bone, ch);
    return keys.find((k) => k.f === f) || null;
  }

  deleteKey(bone, ch, f) {
    const keys = this._keysRef(bone, ch, false);
    if (!keys) return false;
    const i = keys.findIndex((k) => k.f === f);
    if (i < 0) return false;
    keys.splice(i, 1);
    this._prune(bone, ch);
    return true;
  }

  clearTrack(bone, ch) {
    if (ch === 'expr') { delete this.expr[bone]; return; }
    const t = this.tracks[bone];
    if (!t) return;
    if (ch) t[ch] = []; else delete this.tracks[bone];
    this._prune(bone, ch);
  }

  _prune(bone, ch) {
    if (ch === 'expr') { if (this.expr[bone] && !this.expr[bone].length) delete this.expr[bone]; return; }
    const t = this.tracks[bone];
    if (t && !t.rot.length && !t.pos.length) delete this.tracks[bone];
  }

  /** All key frames for the given bones (defaults to every bone), sorted. */
  keyFrames(bones = null, channels = ['rot', 'pos']) {
    const set = new Set();
    const list = bones || Object.keys(this.tracks);
    for (const b of list) {
      const t = this.tracks[b];
      if (!t) continue;
      for (const ch of channels) for (const k of t[ch] || []) set.add(k.f);
    }
    return [...set].sort((a, b) => a - b);
  }

  exprFrames() {
    const set = new Set();
    for (const keys of Object.values(this.expr)) for (const k of keys) set.add(k.f);
    return [...set].sort((a, b) => a - b);
  }

  isEmpty() { return !Object.keys(this.tracks).length && !Object.keys(this.expr).length; }

  // ---------------------------------------------------------------- sampling

  _neighbors(keys, i) {
    const n = keys.length;
    let k0 = keys[i - 1] || null;
    let k3 = keys[i + 2] || null;
    // Seamless loops: when the clip loops and both ends are keyed, tangents wrap around.
    if (this.loop && n > 2 && keys[0].f === 0 && keys[n - 1].f === this.frames) {
      if (!k0 && i === 0) k0 = { f: keys[n - 2].f - this.frames, v: keys[n - 2].v };
      if (!k3 && i + 2 === n) k3 = { f: keys[1].f + this.frames, v: keys[1].v };
    }
    return [k0, k3];
  }

  _sampleKeys(keys, f, isQuat) {
    const n = keys.length;
    if (!n) return null;
    if (n === 1 || f <= keys[0].f) return keys[0].v;
    if (f >= keys[n - 1].f) return keys[n - 1].v;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (keys[mid].f <= f) lo = mid; else hi = mid;
    }
    const k1 = keys[lo], k2 = keys[hi];
    const t = (f - k1.f) / (k2.f - k1.f);
    const e = k1.e || 'auto';
    if (e === 'step') return k1.v;
    const v1 = k1.v;
    const v2 = isQuat ? qAlign(v1, k2.v) : k2.v;
    if (e !== 'auto') {
      const te = (EASINGS[e] || EASINGS.linear).fn(t);
      return isQuat ? qSlerp(v1, v2, te) : v1.map((x, i) => lerp(x, v2[i], te));
    }
    if (isQuat ? qEquals(v1, v2) : vEquals(v1, v2)) return v1;
    // Auto: clamped cubic Hermite through the neighbouring keys (no overshoot at extremes,
    // flat tangents at the clip ends so motion eases in and out naturally).
    const [k0, k3] = this._neighbors(keys, lo);
    const v0 = k0 ? (isQuat ? qAlign(v1, k0.v) : k0.v) : null;
    const v3 = k3 ? (isQuat ? qAlign(v2, k3.v) : k3.v) : null;
    const dt = k2.f - k1.f;
    const m1 = new Array(v1.length), m2 = new Array(v1.length);
    for (let c = 0; c < v1.length; c++) {
      if (v0) {
        const a = v1[c] - v0[c], b = v2[c] - v1[c];
        m1[c] = a * b <= 0 ? 0 : ((v2[c] - v0[c]) / (k2.f - k0.f)) * dt;
      } else m1[c] = 0;
      if (v3) {
        const a = v2[c] - v1[c], b = v3[c] - v2[c];
        m2[c] = a * b <= 0 ? 0 : ((v3[c] - v1[c]) / (k3.f - k1.f)) * dt;
      } else m2[c] = 0;
    }
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const out = new Array(v1.length);
    for (let c = 0; c < v1.length; c++) out[c] = h00 * v1[c] + h10 * m1[c] + h01 * v2[c] + h11 * m2[c];
    return isQuat ? qNormalize(out) : out;
  }

  sampleRot(bone, f) {
    const t = this.tracks[bone];
    return t && t.rot.length ? this._sampleKeys(t.rot, f, true) : null;
  }

  samplePos(bone, f) {
    const t = this.tracks[bone];
    return t && t.pos.length ? this._sampleKeys(t.pos, f, false) : null;
  }

  sampleExpr(name, f) {
    const keys = this.expr[name];
    if (!keys || !keys.length) return 0;
    return Math.max(0, Math.min(1, this._sampleKeys(keys, f, false)[0]));
  }

  /** Returns { rot: {bone: q}, pos: {bone: v}, expr: {name: w} } at frame f (fractional ok). */
  samplePose(f) {
    const pose = { rot: {}, pos: {}, expr: {} };
    for (const [bone, t] of Object.entries(this.tracks)) {
      if (t.rot.length) pose.rot[bone] = this._sampleKeys(t.rot, f, true);
      if (t.pos.length) pose.pos[bone] = this._sampleKeys(t.pos, f, false);
    }
    for (const name of Object.keys(this.expr)) pose.expr[name] = this.sampleExpr(name, f);
    return pose;
  }

  // ---------------------------------------------------------------- editing helpers

  /** Writes every bone of `pose` as keys at frame f. */
  keyPose(pose, f, { bones = null, ease } = {}) {
    for (const [bone, q] of Object.entries(pose.rot || {})) {
      if (bones && !bones.includes(bone)) continue;
      this.setKey(bone, 'rot', f, q, ease);
    }
    for (const [bone, v] of Object.entries(pose.pos || {})) {
      if (bones && !bones.includes(bone)) continue;
      this.setKey(bone, 'pos', f, v, ease);
    }
  }

  /** Moves a set of keys by `delta` frames. sel: [{bone, ch, f}] */
  moveKeys(sel, delta) {
    if (!delta) return sel;
    const moved = [];
    const byTrack = new Map();
    for (const s of sel) {
      const id = s.bone + '|' + s.ch;
      if (!byTrack.has(id)) byTrack.set(id, []);
      byTrack.get(id).push(s.f);
    }
    for (const [id, frames] of byTrack) {
      const [bone, ch] = id.split('|');
      const keys = this._keysRef(bone, ch, false);
      if (!keys) continue;
      const moving = keys.filter((k) => frames.includes(k.f));
      const staying = keys.filter((k) => !frames.includes(k.f));
      for (const k of moving) {
        k.f = Math.max(0, k.f + delta);
        const clash = staying.findIndex((s) => s.f === k.f);
        if (clash >= 0) staying.splice(clash, 1);
        moved.push({ bone, ch, f: k.f });
      }
      const merged = [...staying, ...moving].sort((a, b) => a.f - b.f);
      keys.length = 0;
      keys.push(...merged);
    }
    return moved;
  }

  setEase(sel, ease) {
    for (const s of sel) {
      const k = this.getKey(s.bone, s.ch, s.f);
      if (k) k.e = ease;
    }
  }

  /** Scales all key times so the clip lasts `newFrames` frames. */
  retime(newFrames) {
    const s = newFrames / this.frames;
    const scaleKeys = (keys) => {
      const seen = new Map();
      for (const k of keys) { k.f = Math.round(k.f * s); seen.set(k.f, k); }
      return [...seen.values()].sort((a, b) => a.f - b.f);
    };
    for (const t of Object.values(this.tracks)) { t.rot = scaleKeys(t.rot); t.pos = scaleKeys(t.pos); }
    for (const n of Object.keys(this.expr)) this.expr[n] = scaleKeys(this.expr[n]);
    for (const m of this.markers) m.f = Math.round(m.f * s);
    this.frames = newFrames;
  }

  /** Swaps left and right: the animation plays as its mirror image. */
  mirror() {
    const out = {};
    for (const [bone, t] of Object.entries(this.tracks)) {
      out[mirrorName(bone)] = {
        rot: t.rot.map((k) => ({ f: k.f, e: k.e, v: qMirrorX(k.v) })),
        pos: t.pos.map((k) => ({ f: k.f, e: k.e, v: [-k.v[0], k.v[1], k.v[2]] })),
      };
    }
    this.tracks = out;
  }

  /** Plays the animation backwards. */
  reverse() {
    const flip = (keys) => {
      const r = keys.map((k) => ({ f: this.frames - k.f, v: k.v, e: k.e })).sort((a, b) => a.f - b.f);
      // Easing belongs to the outgoing segment, so shift it one key back.
      const eases = keys.map((k) => k.e).reverse();
      r.forEach((k, i) => { k.e = eases[i + 1] || eases[i] || 'auto'; });
      return r;
    };
    for (const t of Object.values(this.tracks)) { t.rot = flip(t.rot); t.pos = flip(t.pos); }
    for (const n of Object.keys(this.expr)) this.expr[n] = flip(this.expr[n]);
  }

  /** Makes the last frame match the first so the animation loops without a pop. */
  makeSeamless() {
    for (const t of Object.values(this.tracks)) {
      for (const ch of ['rot', 'pos']) {
        const keys = t[ch];
        if (!keys.length) continue;
        const v0 = this._sampleKeys(keys, 0, ch === 'rot');
        if (keys[0].f !== 0) keys.unshift({ f: 0, v: v0.slice(), e: keys[0].e });
        const last = keys[keys.length - 1];
        if (last.f === this.frames) last.v = v0.slice();
        else keys.push({ f: this.frames, v: v0.slice(), e: last.e });
      }
    }
    this.loop = true;
  }

  /**
   * Removes keys that can be recreated by interpolation within `tolerance`
   * (radians for rotations, meters for positions). Used after importing mocap.
   */
  reduceKeys(tolerance = 0.01) {
    const reduce = (keys, isQuat) => {
      if (keys.length < 3) return keys;
      const errOf = (a, b) => isQuat
        ? 2 * Math.acos(Math.min(1, Math.abs(qDot(a, b))))
        : Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      // Douglas-Peucker style recursion on linear/slerp interpolation.
      const keep = new Array(keys.length).fill(false);
      keep[0] = keep[keys.length - 1] = true;
      const stack = [[0, keys.length - 1]];
      while (stack.length) {
        const [a, b] = stack.pop();
        let worst = -1, worstErr = tolerance;
        for (let i = a + 1; i < b; i++) {
          const t = (keys[i].f - keys[a].f) / (keys[b].f - keys[a].f);
          const v = isQuat ? qSlerp(keys[a].v, qAlign(keys[a].v, keys[b].v), t)
            : keys[a].v.map((x, c) => lerp(x, keys[b].v[c], t));
          const err = errOf(v, keys[i].v);
          if (err > worstErr) { worstErr = err; worst = i; }
        }
        if (worst >= 0) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
      }
      return keys.filter((_, i) => keep[i]).map((k) => ({ ...k, e: 'auto' }));
    };
    for (const t of Object.values(this.tracks)) {
      t.rot = reduce(t.rot, true);
      t.pos = reduce(t.pos, false);
    }
  }

  /** Removes rotation tracks that never leave the rest pose. */
  pruneRestTracks() {
    for (const [bone, t] of Object.entries(this.tracks)) {
      if (t.rot.length && t.rot.every((k) => qEquals(k.v, qIdentity(), 1e-6))) t.rot = [];
      this._prune(bone, 'rot');
    }
  }

  /** Inserts `src` clip keys at frame offset (overwrites keys in that range for the same bones). */
  paste(src, at = 0, { bones = null } = {}) {
    const span = src.frames;
    for (const [bone, t] of Object.entries(src.tracks)) {
      if (bones && !bones.includes(bone)) continue;
      for (const ch of ['rot', 'pos']) {
        if (!t[ch].length) continue;
        const dst = this._keysRef(bone, ch, true);
        for (let i = dst.length - 1; i >= 0; i--) if (dst[i].f >= at && dst[i].f <= at + span) dst.splice(i, 1);
        for (const k of t[ch]) this.setKey(bone, ch, k.f + at, k.v, k.e);
      }
    }
    for (const [name, keys] of Object.entries(src.expr)) {
      for (const k of keys) this.setKey(name, 'expr', k.f + at, k.v, k.e);
    }
    if (at + span > this.frames) this.frames = at + span;
  }

  // ---------------------------------------------------------------- serialization

  clone() { return Clip.fromJSON(this.toJSON()); }

  toJSON() {
    const tracks = {};
    for (const [bone, t] of Object.entries(this.tracks)) {
      const o = {};
      if (t.rot.length) o.rot = t.rot.map((k) => [k.f, ...k.v.map((x) => +x.toFixed(6)), k.e]);
      if (t.pos.length) o.pos = t.pos.map((k) => [k.f, ...k.v.map((x) => +x.toFixed(5)), k.e]);
      tracks[bone] = o;
    }
    const expr = {};
    for (const [n, keys] of Object.entries(this.expr)) expr[n] = keys.map((k) => [k.f, +k.v[0].toFixed(4), k.e]);
    return { name: this.name, fps: this.fps, frames: this.frames, loop: this.loop, tracks, expr, markers: this.markers.map((m) => ({ ...m })) };
  }

  static fromJSON(j) {
    const c = new Clip({ name: j.name, fps: j.fps, frames: j.frames, loop: !!j.loop });
    const parse = (arr, n) => (arr || []).map((a) => ({ f: a[0], v: a.slice(1, 1 + n), e: a[1 + n] || 'auto' }));
    for (const [bone, t] of Object.entries(j.tracks || {})) {
      c.tracks[bone] = { rot: parse(t.rot, 4), pos: parse(t.pos, 3) };
      c._prune(bone);
    }
    for (const [n, keys] of Object.entries(j.expr || {})) c.expr[n] = parse(keys, 1);
    c.markers = (j.markers || []).map((m) => ({ ...m }));
    return c;
  }

  snapshotTracks(bones) {
    const snap = { meta: { frames: this.frames, fps: this.fps, loop: this.loop, name: this.name }, tracks: {}, expr: null };
    const list = bones || [...new Set([...Object.keys(this.tracks), ...BONE_NAMES])];
    for (const b of list) {
      const t = this.tracks[b];
      snap.tracks[b] = t ? { rot: cloneKeys(t.rot), pos: cloneKeys(t.pos) } : null;
    }
    if (!bones) {
      snap.expr = {};
      for (const [n, keys] of Object.entries(this.expr)) snap.expr[n] = cloneKeys(keys);
      snap.markers = this.markers.map((m) => ({ ...m }));
    }
    return snap;
  }

  restoreTracks(snap) {
    Object.assign(this, { frames: snap.meta.frames, fps: snap.meta.fps, loop: snap.meta.loop, name: snap.meta.name });
    for (const [b, t] of Object.entries(snap.tracks)) {
      if (t) this.tracks[b] = { rot: cloneKeys(t.rot), pos: cloneKeys(t.pos) };
      else delete this.tracks[b];
    }
    if (snap.expr) {
      this.expr = {};
      for (const [n, keys] of Object.entries(snap.expr)) this.expr[n] = cloneKeys(keys);
      this.markers = snap.markers.map((m) => ({ ...m }));
    }
  }
}
