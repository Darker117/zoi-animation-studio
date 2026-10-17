// Friendly joint parameters.
//
// Each bone rotation is split into SWING (where the bone points) and TWIST (rotation around
// the bone itself). Swing is stored as a rotation vector in the plane perpendicular to the
// bone, so "Raise 40°" + "Swing 30°" behave predictably from any starting pose, with no
// gimbal lock. Slider labels/signs come from rig.js (BONES[].axes).
import * as THREE from 'three';
import { BONE_MAP } from './rig.js';
import { DEG } from './math.js';

const TWIST = {
  hips: 'y', spine: 'y', chest: 'y', upperChest: 'y', neck: 'y', head: 'y',
};
export function twistAxisOf(bone) {
  if (TWIST[bone]) return TWIST[bone];
  if (/(Shoulder|UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(bone)) return 'x';
  if (/(UpperLeg|LowerLeg)/.test(bone)) return 'y';
  if (/(Foot|Toes)/.test(bone)) return 'z';
  return 'y';
}

const AXV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** raw = {x, y, z} in degrees (swing components on the two non-twist axes + twist angle). */
export function quatFromRaw(bone, raw) {
  const t = twistAxisOf(bone);
  const r = new THREE.Vector3(t === 'x' ? 0 : raw.x || 0, t === 'y' ? 0 : raw.y || 0, t === 'z' ? 0 : raw.z || 0).multiplyScalar(DEG);
  const ang = r.length();
  const swing = ang > 1e-9 ? new THREE.Quaternion().setFromAxisAngle(r.clone().divideScalar(ang), ang) : new THREE.Quaternion();
  const twist = new THREE.Quaternion().setFromAxisAngle(AXV[t], (raw[t] || 0) * DEG);
  return swing.multiply(twist);
}

export function rawFromQuat(bone, q) {
  const t = twistAxisOf(bone);
  const T = AXV[t];
  const v = new THREE.Vector3(q.x, q.y, q.z);
  const d = v.dot(T);
  let tw = new THREE.Quaternion(T.x * d, T.y * d, T.z * d, q.w);
  const len = Math.hypot(tw.x, tw.y, tw.z, tw.w);
  if (len < 1e-9) tw = new THREE.Quaternion(); else tw.set(tw.x / len, tw.y / len, tw.z / len, tw.w / len);
  let twistAngle = 2 * Math.atan2(tw.x * T.x + tw.y * T.y + tw.z * T.z, tw.w);
  const sw = q.clone().multiply(tw.clone().invert());
  if (sw.w < 0) sw.set(-sw.x, -sw.y, -sw.z, -sw.w);
  const s = Math.hypot(sw.x, sw.y, sw.z);
  const ang = 2 * Math.atan2(s, sw.w);
  const r = s > 1e-9 ? new THREE.Vector3(sw.x, sw.y, sw.z).multiplyScalar(ang / s) : new THREE.Vector3();
  const wrap = (a) => { a /= DEG; while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
  const raw = { x: wrap(r.x), y: wrap(r.y), z: wrap(r.z) };
  raw[t] = wrap(twistAngle);
  return raw;
}

/** Slider descriptors for a bone with current values. */
export function slidersFor(bone, q) {
  const def = BONE_MAP.get(bone);
  const raw = rawFromQuat(bone, q);
  return def.axes.map(([axis, sign, label, neg, pos, min, max]) => ({
    axis, sign, label, neg, pos, min, max, value: raw[axis] * sign,
  }));
}

/** Sets one friendly slider value and returns the new quaternion. */
export function quatWithSlider(bone, q, axis, sign, value) {
  const raw = rawFromQuat(bone, q);
  raw[axis] = value * sign;
  return quatFromRaw(bone, raw);
}

/** Builds a quaternion from friendly labels, e.g. { Raise: -80, Swing: 20 }. */
export function quatFromLabels(bone, labels) {
  const def = BONE_MAP.get(bone);
  const raw = { x: 0, y: 0, z: 0 };
  for (const [label, value] of Object.entries(labels)) {
    const ax = def.axes.find((a) => a[2].toLowerCase() === label.toLowerCase());
    if (ax) raw[ax[0]] += value * ax[1];
    else if (label === 'x' || label === 'y' || label === 'z') raw[label] += value;
    else console.warn(`Unknown control "${label}" for ${bone}`);
  }
  const q = quatFromRaw(bone, raw);
  return [q.x, q.y, q.z, q.w];
}
