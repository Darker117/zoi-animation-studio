// Converts joint POSITIONS (from text-to-motion AI, video pose estimation…) into rotations
// on the canonical Zoi rig. Each bone is swung from its parent's orientation to point at the
// next joint (minimal twist); the hips take their full orientation from the hip line + spine.
import * as THREE from 'three';
import { BONES, BONE_MAP } from './rig.js';
import { Clip } from './clip.js';

/**
 * The 22-joint SMPL/HumanML3D layout used by most text-to-motion models (MSFlow, MoMask,
 * MotionGPT…). Y up, the person starts facing +Z, the person's left is +X, meters.
 */
export const SMPL22 = {
  names: ['pelvis', 'left_hip', 'right_hip', 'spine1', 'left_knee', 'right_knee', 'spine2', 'left_ankle', 'right_ankle', 'spine3',
    'left_foot', 'right_foot', 'neck', 'left_collar', 'right_collar', 'head', 'left_shoulder', 'right_shoulder', 'left_elbow',
    'right_elbow', 'left_wrist', 'right_wrist'],
  // canonical bone -> joint index where the bone starts
  joints: {
    hips: 0, spine: 3, chest: 6, upperChest: 9, neck: 12, head: 15,
    leftShoulder: 13, leftUpperArm: 16, leftLowerArm: 18, leftHand: 20,
    rightShoulder: 14, rightUpperArm: 17, rightLowerArm: 19, rightHand: 21,
    leftUpperLeg: 1, leftLowerLeg: 4, leftFoot: 7, leftToes: 10,
    rightUpperLeg: 2, rightLowerLeg: 5, rightFoot: 8, rightToes: 11,
  },
};

/** Canonical "joint layout" built from the studio rig itself (used for self-tests). */
export function rigLayout() {
  const names = BONES.map((b) => b.name);
  const joints = {};
  names.forEach((n, i) => { joints[n] = i; });
  return { names, joints };
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/**
 * frames: array of frames, each an array of [x,y,z] per joint (layout order).
 * Returns a pose { rot, pos } per frame for `actor`'s proportions.
 */
export function jointsToPoses(frames, actor, layout = SMPL22, { scale = null, facingFix = true } = {}) {
  const J = layout.joints;
  const has = (b) => J[b] != null;
  const P = (fr, b) => new THREE.Vector3(...fr[J[b]]);
  // Canonical rest directions (actor space).
  const restW = {};
  for (const b of BONES) restW[b.name] = actor.restWorld(b.name);
  const restDir = (b, child) => restW[child].clone().sub(restW[b]).normalize();
  // Proportions: match leg length so hips height is right.
  const f0 = frames[0];
  const legLenSrc = (P(f0, 'leftUpperLeg').distanceTo(P(f0, 'leftLowerLeg')) + P(f0, 'leftLowerLeg').distanceTo(P(f0, 'leftFoot'))
    + P(f0, 'rightUpperLeg').distanceTo(P(f0, 'rightLowerLeg')) + P(f0, 'rightLowerLeg').distanceTo(P(f0, 'rightFoot'))) / 2;
  const legLenRig = restW.leftUpperLeg.distanceTo(restW.leftLowerLeg) + restW.leftLowerLeg.distanceTo(restW.leftFoot);
  const k = scale ?? legLenRig / legLenSrc;
  // Rest frame of the hips (canonical): left = hip line, up = hips -> spine.
  const basis = (left, up) => {
    left = left.clone().normalize();
    up = up.clone().sub(left.clone().multiplyScalar(up.dot(left))).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, up);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));
  };
  const hipsRestQ = basis(restW.leftUpperLeg.clone().sub(restW.rightUpperLeg), restW.chest.clone().sub(restW.hips));
  const hipsRestInv = hipsRestQ.clone().invert();
  // Which joint each bone aims at.
  const aim = (b) => {
    let c = BONE_MAP.get(b).primaryChild;
    while (c && !has(c)) c = BONE_MAP.get(c).primaryChild;
    return c && has(c) ? c : null;
  };

  const poses = [];
  for (const fr of frames) {
    const W = {};
    const rot = {};
    const hipsUp = has('chest') ? P(fr, 'chest').sub(P(fr, 'hips')) : P(fr, 'spine').sub(P(fr, 'hips'));
    W.hips = basis(P(fr, 'leftUpperLeg').sub(P(fr, 'rightUpperLeg')), hipsUp).multiply(hipsRestInv);
    for (const bd of BONES) {
      const b = bd.name;
      if (b === 'hips') continue;
      const parentW = W[bd.parent];
      const target = aim(b);
      if (!has(b) || !target) { W[b] = parentW.clone(); continue; }
      const d0 = restDir(b, BONE_MAP.get(b).primaryChild && has(BONE_MAP.get(b).primaryChild) ? BONE_MAP.get(b).primaryChild : target).applyQuaternion(parentW);
      _v.copy(P(fr, target)).sub(P(fr, b));
      if (_v.lengthSq() < 1e-10) { W[b] = parentW.clone(); continue; }
      _w.copy(_v).normalize();
      W[b] = new THREE.Quaternion().setFromUnitVectors(d0.normalize(), _w).multiply(parentW);
    }
    for (const bd of BONES) {
      const local = bd.parent ? W[bd.parent].clone().invert().multiply(W[bd.name]) : W[bd.name].clone();
      rot[bd.name] = [local.x, local.y, local.z, local.w];
    }
    const hp = P(fr, 'hips').multiplyScalar(k);
    poses.push({ rot, pos: { hips: [hp.x, hp.y, hp.z] } });
  }
  void facingFix;
  return poses;
}

/** Builds an editable clip from joint positions. */
export function jointsToClip(frames, fps, actor, { name = 'Generated motion', layout = SMPL22, targetFps = 30, simplify = 0.006 } = {}) {
  const poses = jointsToPoses(frames, actor, layout);
  const dur = (frames.length - 1) / fps;
  const n = Math.max(1, Math.round(dur * targetFps));
  const clip = new Clip({ name, fps: targetFps, frames: n, loop: false });
  const src = new Clip({ fps, frames: frames.length - 1 });
  poses.forEach((p, i) => src.keyPose(p, i, { ease: 'linear' }));
  for (let f = 0; f <= n; f++) {
    const t = (f / targetFps) * fps;
    const pose = src.samplePose(t);
    clip.keyPose(pose, f, { ease: 'linear' });
  }
  if (simplify > 0) clip.reduceKeys(simplify);
  clip.pruneRestTracks();
  return clip;
}
