// Minimal binary FBX (7.4) writer and a small reader for scene settings / model names.
// The writer mirrors the layout produced by Blender's exporter (io_scene_fbx/encode_bin.py),
// which the Autodesk FBX SDK (used by Unreal / the inZOI ModKit) reads without complaint.

const HEAD_MAGIC = [...'Kaydara FBX Binary  '].map((c) => c.charCodeAt(0)).concat([0x00, 0x1a, 0x00]);
const FILE_ID = [0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1];
const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOT_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
export const TIME_ID = '1970-01-01 10:00:00:000';
export const KTIME_PER_SECOND = 46186158000n;
const ALWAYS_SENTINEL = new Set(['AnimationStack', 'AnimationLayer']);
const SENTINEL = 13;
const enc = new TextEncoder();

// ------------------------------------------------------------------ property constructors
export const I = (v) => ({ t: 'I', v: v | 0 });
export const L = (v) => ({ t: 'L', v: BigInt(v) });
export const D = (v) => ({ t: 'D', v: +v });
export const F = (v) => ({ t: 'F', v: +v });
export const C = (v) => ({ t: 'C', v: v ? 1 : 0 });
export const S = (v) => ({ t: 'S', v: typeof v === 'string' ? enc.encode(v) : v });
export const R = (bytes) => ({ t: 'R', v: Uint8Array.from(bytes) });
export const Ai = (arr) => ({ t: 'i', v: Int32Array.from(arr) });
export const Al = (arr) => ({ t: 'l', v: BigInt64Array.from(arr.map((x) => BigInt(x))) });
export const Af = (arr) => ({ t: 'f', v: Float32Array.from(arr) });
export const Ad = (arr) => ({ t: 'd', v: Float64Array.from(arr) });
/** "name\x00\x01Class" object names. */
export const nameClass = (name, cls) => {
  const a = enc.encode(name), b = enc.encode(cls);
  const out = new Uint8Array(a.length + 2 + b.length);
  out.set(a, 0); out[a.length] = 0; out[a.length + 1] = 1; out.set(b, a.length + 2);
  return { t: 'S', v: out };
};

export class Node {
  constructor(name, props = [], children = []) { this.name = name; this.props = props; this.children = children; }
  add(child) { this.children.push(child); return child; }
}
export const N = (name, props = [], children = []) => new Node(name, props, children);

/** Properties70 "P" record helpers. */
export const P = {
  int: (name, v) => N('P', [S(name), S('int'), S('Integer'), S(''), I(v)]),
  bool: (name, v) => N('P', [S(name), S('bool'), S(''), S(''), I(v ? 1 : 0)]),
  enum: (name, v) => N('P', [S(name), S('enum'), S(''), S(''), I(v)]),
  double: (name, v) => N('P', [S(name), S('double'), S('Number'), S(''), D(v)]),
  number: (name, v, anim = true) => N('P', [S(name), S('Number'), S(''), S(anim ? 'A' : ''), D(v)]),
  time: (name, v) => N('P', [S(name), S('KTime'), S('Time'), S(''), L(v)]),
  string: (name, v) => N('P', [S(name), S('KString'), S(''), S(''), S(v)]),
  colorRGB: (name, v) => N('P', [S(name), S('ColorRGB'), S('Color'), S(''), D(v[0]), D(v[1]), D(v[2])]),
  vector3: (name, v) => N('P', [S(name), S('Vector3D'), S('Vector'), S(''), D(v[0]), D(v[1]), D(v[2])]),
  lcl: (kind, v) => N('P', [S('Lcl ' + kind), S('Lcl ' + kind), S(''), S('A'), D(v[0]), D(v[1]), D(v[2])]),
  object: (name) => N('P', [S(name), S('object'), S(''), S('')]),
  datetime: (name, v) => N('P', [S(name), S('DateTime'), S(''), S(''), S(v)]),
  compound: (name) => N('P', [S(name), S('Compound'), S(''), S('')]),
};

// ------------------------------------------------------------------ writer

function propSize(p) {
  switch (p.t) {
    case 'C': return 1 + 1;
    case 'Y': return 1 + 2;
    case 'I': case 'F': return 1 + 4;
    case 'D': case 'L': return 1 + 8;
    case 'S': case 'R': return 1 + 4 + p.v.length;
    default: return 1 + 12 + p.v.byteLength; // arrays, uncompressed
  }
}

function measure(node, offset, isLast) {
  let o = offset + 12 + 1 + enc.encode(node.name).length;
  node._propLen = node.props.reduce((s, p) => s + propSize(p), 0);
  o += node._propLen;
  if (node.children.length) {
    node.children.forEach((c, i) => { o = measure(c, o, i === node.children.length - 1); });
    o += SENTINEL;
  } else if ((!node.props.length && !isLast) || ALWAYS_SENTINEL.has(node.name)) {
    o += SENTINEL;
  }
  node._end = o;
  node._isLast = isLast;
  return o;
}

class ByteWriter {
  constructor(size) { this.buf = new ArrayBuffer(size); this.dv = new DataView(this.buf); this.u8 = new Uint8Array(this.buf); this.o = 0; }
  u8s(arr) { this.u8.set(arr, this.o); this.o += arr.length; }
  u32(v) { this.dv.setUint32(this.o, v, true); this.o += 4; }
  i32(v) { this.dv.setInt32(this.o, v, true); this.o += 4; }
  i16(v) { this.dv.setInt16(this.o, v, true); this.o += 2; }
  i64(v) { this.dv.setBigInt64(this.o, v, true); this.o += 8; }
  f32(v) { this.dv.setFloat32(this.o, v, true); this.o += 4; }
  f64(v) { this.dv.setFloat64(this.o, v, true); this.o += 8; }
  zeros(n) { this.o += n; }
  byte(v) { this.u8[this.o++] = v; }
}

function writeNode(w, node) {
  const name = enc.encode(node.name);
  w.u32(node._end);
  w.u32(node.props.length);
  w.u32(node._propLen);
  w.byte(name.length);
  w.u8s(name);
  for (const p of node.props) {
    w.byte(p.t.charCodeAt(0));
    switch (p.t) {
      case 'C': w.byte(p.v); break;
      case 'Y': w.i16(p.v); break;
      case 'I': w.i32(p.v); break;
      case 'F': w.f32(p.v); break;
      case 'D': w.f64(p.v); break;
      case 'L': w.i64(p.v); break;
      case 'S': case 'R': w.u32(p.v.length); w.u8s(p.v); break;
      default: {
        w.u32(p.v.length); w.u32(0); w.u32(p.v.byteLength);
        w.u8s(new Uint8Array(p.v.buffer, p.v.byteOffset, p.v.byteLength));
      }
    }
  }
  if (node.children.length) {
    for (const c of node.children) writeNode(w, c);
    w.zeros(SENTINEL);
  } else if ((!node.props.length && !node._isLast) || ALWAYS_SENTINEL.has(node.name)) {
    w.zeros(SENTINEL);
  }
  if (w.o !== node._end) throw new Error(`FBX writer: size mismatch in ${node.name} (${w.o} vs ${node._end})`);
}

/** Encodes top-level nodes into a binary FBX file (Uint8Array). */
export function encodeFBX(topNodes, version = 7400) {
  let o = 27;
  topNodes.forEach((n, i) => { o = measure(n, o, i === topNodes.length - 1); });
  o += SENTINEL;
  const afterFootId = o + 16 + 4;
  let pad = ((afterFootId + 15) & ~15) - afterFootId;
  if (pad === 0) pad = 16;
  const total = afterFootId + pad + 4 + 120 + 16;
  const w = new ByteWriter(total);
  w.u8s(HEAD_MAGIC);
  w.u32(version);
  for (const n of topNodes) writeNode(w, n);
  w.zeros(SENTINEL);
  w.u8s(FOOT_ID);
  w.zeros(4);
  w.zeros(pad);
  w.u32(version);
  w.zeros(120);
  w.u8s(FOOT_MAGIC);
  return w.u8;
}

export const FBX_FILE_ID = FILE_ID;

// ------------------------------------------------------------------ reader (settings + names)

const dec = new TextDecoder();

/**
 * Reads GlobalSettings and the model list from an FBX (binary or ASCII).
 * Returns { version, settings: {UpAxis,…,UnitScaleFactor}, models: [{id, name, type}] }.
 */
export function readFBXInfo(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const head = dec.decode(u8.slice(0, 18));
  if (head === 'Kaydara FBX Binary') return readBinary(arrayBuffer);
  return readAscii(dec.decode(u8));
}

function readBinary(buf) {
  const dv = new DataView(buf);
  const version = dv.getUint32(23, true);
  const wide = version >= 7500;
  let o = 27;
  const readNode = () => {
    const end = wide ? Number(dv.getBigUint64(o, true)) : dv.getUint32(o, true);
    const numProps = wide ? Number(dv.getBigUint64(o + 8, true)) : dv.getUint32(o + 4, true);
    const propLen = wide ? Number(dv.getBigUint64(o + 16, true)) : dv.getUint32(o + 8, true);
    o += wide ? 24 : 12;
    const nameLen = dv.getUint8(o); o += 1;
    if (end === 0) return null;
    const name = dec.decode(new Uint8Array(buf, o, nameLen)); o += nameLen;
    const propsStart = o;
    const props = [];
    for (let i = 0; i < numProps; i++) {
      const t = String.fromCharCode(dv.getUint8(o)); o += 1;
      switch (t) {
        case 'C': props.push(dv.getUint8(o) !== 0); o += 1; break;
        case 'Y': props.push(dv.getInt16(o, true)); o += 2; break;
        case 'I': props.push(dv.getInt32(o, true)); o += 4; break;
        case 'F': props.push(dv.getFloat32(o, true)); o += 4; break;
        case 'D': props.push(dv.getFloat64(o, true)); o += 8; break;
        case 'L': props.push(dv.getBigInt64(o, true)); o += 8; break;
        case 'S': case 'R': {
          const len = dv.getUint32(o, true); o += 4;
          props.push(t === 'S' ? dec.decode(new Uint8Array(buf, o, len)) : null);
          o += len; break;
        }
        default: { // arrays: skip
          const compLen = dv.getUint32(o + 8, true);
          o += 12 + compLen; props.push(null);
        }
      }
    }
    o = propsStart + propLen;
    const children = [];
    while (o < end) {
      const c = readNode();
      if (!c) break;
      children.push(c);
    }
    o = end;
    return { name, props, children };
  };
  const top = [];
  while (o < buf.byteLength - 160) {
    const n = readNode();
    if (!n) break;
    top.push(n);
  }
  const info = { version, settings: {}, models: [] };
  const gs = top.find((n) => n.name === 'GlobalSettings');
  const p70 = gs?.children.find((c) => c.name === 'Properties70');
  for (const p of p70?.children || []) info.settings[p.props[0]] = p.props[4];
  const objects = top.find((n) => n.name === 'Objects');
  for (const m of objects?.children || []) {
    if (m.name !== 'Model') continue;
    const [id, full, type] = m.props;
    info.models.push({ id, name: String(full).split('\u0000\u0001')[0], type });
  }
  return info;
}

function readAscii(text) {
  const info = { version: +(text.match(/FBXVersion:\s*(\d+)/)?.[1] || 0), settings: {}, models: [] };
  const gs = text.match(/GlobalSettings:\s*{[\s\S]*?Properties70:\s*{([\s\S]*?)}\s*}/);
  if (gs) {
    for (const m of gs[1].matchAll(/P:\s*"([^"]+)",\s*"[^"]*",\s*"[^"]*",\s*"[^"]*",\s*([^\n]+)/g)) {
      const v = m[2].trim().replace(/^"|"$/g, '');
      info.settings[m[1]] = isNaN(+v) ? v : +v;
    }
  }
  for (const m of text.matchAll(/Model:\s*(\d+),\s*"Model::([^"]*)",\s*"([^"]*)"/g)) {
    info.models.push({ id: BigInt(m[1]), name: m[2], type: m[3] });
  }
  return info;
}
