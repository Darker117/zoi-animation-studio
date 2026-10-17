// Analytic two-bone IK (arms and legs) working directly on an Actor's THREE bones.
import * as THREE from 'three';

export const IK_CHAINS = {
  leftHand: { upper: 'leftUpperArm', lower: 'leftLowerArm', end: 'leftHand', pole: [0, -0.3, -1] },
  rightHand: { upper: 'rightUpperArm', lower: 'rightLowerArm', end: 'rightHand', pole: [0, -0.3, -1] },
  leftFoot: { upper: 'leftUpperLeg', lower: 'leftLowerLeg', end: 'leftFoot', pole: [0, 0, 1] },
  rightFoot: { upper: 'rightUpperLeg', lower: 'rightLowerLeg', end: 'rightFoot', pole: [0, 0, 1] },
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _at = new THREE.Vector3(), _ba = new THREE.Vector3(), _bc = new THREE.Vector3();
const _axis0 = new THREE.Vector3(), _axis1 = new THREE.Vector3(), _pole = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _r0 = new THREE.Quaternion(), _r1 = new THREE.Quaternion(), _r2 = new THREE.Quaternion();
const _endWorld = new THREE.Quaternion();

const acosC = (x) => Math.acos(Math.min(1, Math.max(-1, x)));

/** Rotates `bone` by world-space rotation `r` (keeps children attached). */
function rotateWorld(bone, r) {
  bone.getWorldQuaternion(_qa);
  bone.parent.getWorldQuaternion(_qp);
  _qb.copy(r).multiply(_qa); // new world rotation
  bone.quaternion.copy(_qp.invert().multiply(_qb));
  bone.updateMatrixWorld(true);
}

/**
 * Solves a two-bone chain so the end bone reaches `target` (world space).
 * keepEndRotation keeps the hand/foot's world orientation (feet stay flat, palms stay put).
 */
export function solveTwoBone(actor, chainId, target, { keepEndRotation = true, poleHint = null } = {}) {
  const ch = IK_CHAINS[chainId];
  const A = actor.bones[ch.upper], B = actor.bones[ch.lower], C = actor.bones[ch.end];
  actor.root.updateMatrixWorld(true);
  if (keepEndRotation) C.getWorldQuaternion(_endWorld);

  A.getWorldPosition(_a); B.getWorldPosition(_b); C.getWorldPosition(_c);
  const lab = _b.distanceTo(_a), lcb = _c.distanceTo(_b);
  const lat = Math.min(Math.max(target.distanceTo(_a), 0.01), (lab + lcb) * 0.9995);

  _ac.subVectors(_c, _a).normalize();
  _ab.subVectors(_b, _a).normalize();
  _ba.subVectors(_a, _b).normalize();
  _bc.subVectors(_c, _b).normalize();
  _at.subVectors(target, _a).normalize();

  const ac_ab_0 = acosC(_ac.dot(_ab));
  const ba_bc_0 = acosC(_ba.dot(_bc));
  const ac_at_0 = acosC(_ac.dot(_at));
  const ac_ab_1 = acosC((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat));
  const ba_bc_1 = acosC((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb));

  // Bend plane: from the current elbow/knee, or the pole hint when the limb is straight.
  _axis0.crossVectors(_ac, _ab);
  if (_axis0.lengthSq() < 1e-8) {
    _pole.fromArray(poleHint || ch.pole);
    actor.root.getWorldQuaternion(_qp);
    _pole.applyQuaternion(_qp);
    _axis0.crossVectors(_ac, _pole);
  }
  _axis0.normalize();
  _axis1.crossVectors(_ac, _at);
  if (_axis1.lengthSq() < 1e-10) _axis1.copy(_axis0); else _axis1.normalize();

  _r0.setFromAxisAngle(_axis0, ac_ab_1 - ac_ab_0);
  _r1.setFromAxisAngle(_axis0, ba_bc_1 - ba_bc_0);
  _r2.setFromAxisAngle(_axis1, ac_at_0);

  rotateWorld(A, _r0);
  rotateWorld(B, _r1);
  rotateWorld(A, _r2);

  if (keepEndRotation) {
    B.getWorldQuaternion(_qp);
    C.quaternion.copy(_qp.invert().multiply(_endWorld));
    C.updateMatrixWorld(true);
  }
}

/** Rotates `bone` so that the point `grab` (world, rigidly attached to the bone) moves toward `to`. */
export function swingBoneToward(actor, boneName, pivot, grab, to) {
  const bone = actor.bones[boneName];
  const from = grab.clone().sub(pivot);
  const dest = to.clone().sub(pivot);
  if (from.lengthSq() < 1e-8 || dest.lengthSq() < 1e-8) return;
  const r = new THREE.Quaternion().setFromUnitVectors(from.normalize(), dest.normalize());
  rotateWorld(bone, r);
}

export { rotateWorld };
