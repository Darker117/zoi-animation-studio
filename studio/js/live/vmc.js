// Live link to inZOI's built-in Motion Capture receiver (VMC protocol = OSC over UDP).
//
// inZOI listens on UDP port 39539 and maps the Unity HumanBodyBones names (Hips, Spine, Chest,
// Neck, Head, LeftUpperArm, …, finger bones) onto the selected Zoi. Browsers cannot send UDP,
// so packets go to the local bridge (bridge/server.ps1), which forwards them.
//
// Conversion from the studio (three.js, right-handed, character faces +Z, left = +X) to Unity
// (left-handed, character faces +Z, left = -X): position (x,y,z) -> (-x,y,z),
// rotation (x,y,z,w) -> (x,-y,-z,w).
import { BONES, vmcName } from '../core/rig.js';
import { EXPRESSIONS } from '../core/clip.js';

const enc = new TextEncoder();

function oscString(s) {
  const b = enc.encode(s);
  const len = (b.length + 4) & ~3; // includes at least one null terminator
  const out = new Uint8Array(len);
  out.set(b);
  return out;
}

/** Encodes one OSC message. args: numbers are floats unless wrapped as {i: n}; strings as-is. */
export function oscMessage(address, args) {
  let tags = ',';
  const parts = [];
  for (const a of args) {
    if (typeof a === 'string') { tags += 's'; parts.push(oscString(a)); }
    else if (typeof a === 'object' && a && 'i' in a) {
      tags += 'i';
      const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, a.i, false); parts.push(b);
    } else {
      tags += 'f';
      const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, a, false); parts.push(b);
    }
  }
  const head = [oscString(address), oscString(tags)];
  const all = head.concat(parts);
  const size = all.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

export function oscBundle(messages) {
  const head = oscString('#bundle');
  const size = head.length + 8 + messages.reduce((s, m) => s + 4 + m.length, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(head, 0);
  let o = head.length;
  dv.setUint32(o, 0, false); dv.setUint32(o + 4, 1, false); // timetag: immediately
  o += 8;
  for (const m of messages) { dv.setInt32(o, m.length, false); o += 4; out.set(m, o); o += m.length; }
  return out;
}

const toUnityPos = (p) => [-p[0], p[1], p[2]];
const toUnityQuat = (q) => [q[0], -q[1], -q[2], q[3]];

function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/**
 * Builds the VMC messages for one actor pose.
 * opts.foldUpperChest: inZOI's receiver has no UpperChest slot, so its rotation is merged into Chest.
 */
export function vmcMessages(actor, { time = 0, foldUpperChest = true, expressions = true, sendRoot = false } = {}) {
  const msgs = [];
  msgs.push(oscMessage('/VMC/Ext/OK', [{ i: 1 }]));
  msgs.push(oscMessage('/VMC/Ext/T', [time]));
  if (sendRoot) {
    const p = actor.root.position, q = actor.root.quaternion;
    msgs.push(oscMessage('/VMC/Ext/Root/Pos', ['root', ...toUnityPos([p.x, p.y, p.z]), ...toUnityQuat([q.x, q.y, q.z, q.w])]));
  } else {
    msgs.push(oscMessage('/VMC/Ext/Root/Pos', ['root', 0, 0, 0, 0, 0, 0, 1]));
  }
  for (const b of BONES) {
    if (foldUpperChest && b.name === 'upperChest') continue;
    const bone = actor.bones[b.name];
    let q = [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w];
    if (foldUpperChest && b.name === 'chest') {
      const u = actor.bones.upperChest.quaternion;
      q = qmul(q, [u.x, u.y, u.z, u.w]);
    }
    let p = [bone.position.x, bone.position.y, bone.position.z];
    if (foldUpperChest && (b.parent === 'upperChest')) {
      // Children of the upper chest now hang off the chest: add the upper chest offset.
      const u = actor.bones.upperChest.position;
      p = [p[0] + u.x, p[1] + u.y, p[2] + u.z];
    }
    msgs.push(oscMessage('/VMC/Ext/Bone/Pos', [vmcName(b.name), ...toUnityPos(p), ...toUnityQuat(q)]));
  }
  if (expressions) {
    for (const e of EXPRESSIONS) msgs.push(oscMessage('/VMC/Ext/Blend/Val', [e.id, actor.expr?.[e.id] || 0]));
    msgs.push(oscMessage('/VMC/Ext/Blend/Apply', []));
  }
  return msgs;
}

/** Packs packets for the bridge: [u32 length][bytes]… */
function frameForBridge(packets) {
  const size = packets.reduce((s, p) => s + 4 + p.length, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (const p of packets) { dv.setUint32(o, p.length, false); o += 4; out.set(p, o); o += p.length; }
  return out;
}

export class VmcLink {
  constructor({ bridgeUrl = '', host = '127.0.0.1', port = 39539, fps = 30, bundle = true } = {}) {
    this.bridgeUrl = bridgeUrl;
    this.host = host;
    this.port = port;
    this.fps = fps;
    this.bundle = bundle;
    this.active = false;
    this.inFlight = false;
    this.sent = 0;
    this.dropped = 0;
    this.lastError = null;
    this.startTime = performance.now();
    this._last = 0;
  }

  async ping() {
    try {
      const r = await fetch(`${this.bridgeUrl}/api/status`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  /** Call every animation frame; sends at most `fps` times per second. */
  tick(actor, opts = {}) {
    if (!this.active) return;
    const now = performance.now();
    if (now - this._last < 1000 / this.fps - 1) return;
    this._last = now;
    if (this.inFlight) { this.dropped++; return; }
    const msgs = vmcMessages(actor, { time: (now - this.startTime) / 1000, ...opts });
    const packets = this.bundle ? [oscBundle(msgs)] : msgs;
    this.send(packets);
  }

  async send(packets) {
    this.inFlight = true;
    try {
      const r = await fetch(`${this.bridgeUrl}/api/vmc?host=${encodeURIComponent(this.host)}&port=${this.port}`, {
        method: 'POST', body: frameForBridge(packets), headers: { 'Content-Type': 'application/octet-stream' },
      });
      if (!r.ok) throw new Error(`Bridge answered ${r.status}`);
      this.sent++;
      this.lastError = null;
    } catch (e) {
      this.lastError = e.message || String(e);
    } finally {
      this.inFlight = false;
    }
  }
}
