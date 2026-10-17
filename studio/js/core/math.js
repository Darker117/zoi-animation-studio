// Small math helpers shared by the animation core. Quaternions are plain [x, y, z, w] arrays
// in the data model so projects serialize cleanly; THREE types are used only at the edges.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export const EASINGS = {
  auto: { label: 'Smooth (auto)', fn: (t) => t },
  linear: { label: 'Linear', fn: (t) => t },
  easeInOut: { label: 'Ease in & out', fn: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) },
  easeIn: { label: 'Ease in (speed up)', fn: (t) => t * t * t },
  easeOut: { label: 'Ease out (slow down)', fn: (t) => 1 - Math.pow(1 - t, 3) },
  back: { label: 'Overshoot', fn: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); } },
  step: { label: 'Hold (snap)', fn: () => 0 },
};

export function qIdentity() { return [0, 0, 0, 1]; }

export function qDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; }

export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qNeg(q) { return [-q[0], -q[1], -q[2], -q[3]]; }

/** Returns b flipped onto the same hemisphere as a, so blends take the short way round. */
export function qAlign(a, b) { return qDot(a, b) < 0 ? qNeg(b) : b; }

export function qSlerp(a, b, t) {
  const qa = new THREE.Quaternion(a[0], a[1], a[2], a[3]);
  const qb = new THREE.Quaternion(b[0], b[1], b[2], b[3]);
  qa.slerp(qb, t);
  return [qa.x, qa.y, qa.z, qa.w];
}

export function qMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qInvert(q) { return [-q[0], -q[1], -q[2], q[3]]; }

export function qFromEulerDeg(x, y, z, order = 'XYZ') {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, order));
  return [q.x, q.y, q.z, q.w];
}

export function qToEulerDeg(q, order = 'XYZ') {
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]), order);
  return [e.x / DEG, e.y / DEG, e.z / DEG];
}

export function qEquals(a, b, eps = 1e-5) { return Math.abs(Math.abs(qDot(a, b)) - 1) < eps; }

export function vEquals(a, b, eps = 1e-6) {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
}

/** Mirror a local rotation across the character's left/right (YZ) plane. */
export function qMirrorX(q) { return [q[0], -q[1], -q[2], q[3]]; }

/** Cubic Hermite on arrays (component-wise). */
export function hermite(p0, m0, p1, m1, t) {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const out = new Array(p0.length);
  for (let i = 0; i < p0.length; i++) out[i] = h00 * p0[i] + h10 * m0[i] + h01 * p1[i] + h11 * m1[i];
  return out;
}

/** Shortest-arc rotation taking unit vector a to unit vector b, as [x,y,z,w]. */
export function qFromUnitVectors(a, b) {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(...a).normalize(), new THREE.Vector3(...b).normalize());
  return [q.x, q.y, q.z, q.w];
}

export const toQ = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
export const fromQ = (q) => [q.x, q.y, q.z, q.w];
export const toV = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const fromV = (v) => [v.x, v.y, v.z];

export function round(v, digits = 6) {
  const m = Math.pow(10, digits);
  return Math.round(v * m) / m;
}

let _uid = 0;
export function uid(prefix = 'id') {
  _uid++;
  return `${prefix}_${Date.now().toString(36)}${_uid.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
