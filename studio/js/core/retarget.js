// Retargeting between the canonical Zoi rig and any other humanoid skeleton.
//
// Math (all rotations are "model space" = relative to the character's root object):
//   R      aligns the other skeleton's facing/up/left axes with the canonical frame.
//   G0     the other bone's rest rotation (aligned: G0' = R·G0).
//   E      aligns the other bone's rest direction with the canonical rest direction
//          (this absorbs T-pose vs A-pose differences).
//   W      the canonical bone's posed world rotation (canonical rest rotations are identity).
// canonical -> other:  G' = W · E · G0'
// other -> canonical:  W  = (G' · G0'^-1) · E^-1
import * as THREE from 'three';
import { BONES, BONE_MAP } from './rig.js';

// ------------------------------------------------------------------ name analysis

const EXCLUDE = new Set(['twist', 'roll', 'ik', 'fk', 'end', 'nub', 'tip', 'target', 'pole', 'helper', 'corrective', 'adj', 'eye', 'jaw', 'teeth', 'tongue', 'bust', 'breast', 'hair', 'skirt', 'cloth', 'weapon', 'prop', 'attach', 'socket', 'mch', 'org', 'ctrl', 'ctl', 'vb', 'sec', 'secondary', 'top', 'headtop']);
const FINGER_WORDS = { Thumb: ['thumb'], Index: ['index', 'pointer'], Middle: ['middle', 'mid'], Ring: ['ring'], Little: ['pinky', 'little', 'pinkie'] };

export function tokens(name) {
  const base = name.replace(/^.*[:|]/, '');
  return base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function sideOf(tk) {
  if (tk.includes('left') || tk.includes('l') || tk.includes('lf') || tk.includes('lft')) return 'left';
  if (tk.includes('right') || tk.includes('r') || tk.includes('rt') || tk.includes('rgt')) return 'right';
  return null;
}

const isExcluded = (tk) => tk.some((t) => EXCLUDE.has(t));
const isFinger = (tk) => tk.some((t) => ['thumb', 'index', 'middle', 'ring', 'pinky', 'little', 'finger', 'pinkie'].includes(t));

// ------------------------------------------------------------------ skeleton description

/**
 * Collects the joints of a loaded model. Works for skinned meshes (THREE.Bone) and for
 * plain node hierarchies (glTF without skin, BVH).
 */
export function describeSkeleton(model) {
  model.updateMatrixWorld(true);
  const objs = [];
  let hasBones = false;
  model.traverse((o) => { if (o.isBone) hasBones = true; });
  model.traverse((o) => {
    if (o === model) return;
    if (hasBones ? o.isBone : !(o.isMesh || o.isLight || o.isCamera || o.isLine || o.isPoints)) objs.push(o);
  });
  const index = new Map(objs.map((o, i) => [o, i]));
  const rootInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const bones = objs.map((o, i) => {
    let p = o.parent;
    while (p && p !== model && !index.has(p)) p = p.parent;
    const m = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    m.decompose(pos, quat, scl);
    const parentObj = o.parent;
    const pm = new THREE.Matrix4().multiplyMatrices(rootInv, parentObj.matrixWorld);
    return {
      i, name: o.name, object: o, tk: tokens(o.name),
      parent: p && p !== model ? index.get(p) : -1,
      restLocalPos: o.position.clone(), restLocalQuat: o.quaternion.clone(), restLocalScale: o.scale.clone(),
      modelPos: pos, modelQuat: quat, modelMatrix: m,
      parentModelMatrix: pm, parentModelQuat: new THREE.Quaternion().setFromRotationMatrix(pm),
      depth: 0, children: [],
    };
  });
  for (const b of bones) if (b.parent >= 0) bones[b.parent].children.push(b.i);
  for (const b of bones) { let d = 0, p = b.parent; while (p >= 0) { d++; p = bones[p].parent; } b.depth = d; }
  const byName = new Map(bones.map((b) => [b.name, b]));
  return { model, bones, byName };
}

function ancestors(skel, i) {
  const out = [];
  let p = skel.bones[i].parent;
  while (p >= 0) { out.push(p); p = skel.bones[p].parent; }
  return out;
}

function pathBetween(skel, top, bottom) {
  // Bones strictly below `top` down to and including `bottom`.
  const chain = [];
  let p = bottom;
  while (p >= 0 && p !== top) { chain.unshift(p); p = skel.bones[p].parent; }
  return p === top ? chain : null;
}

/** Guesses which bone of `skel` plays each canonical role. Returns { canonical: boneName }. */
export function autoMap(skel) {
  const B = skel.bones;
  const map = {};
  const pick = (pred) => {
    const c = B.filter((b) => pred(b.tk, b) && !isExcluded(b.tk));
    c.sort((a, b) => a.depth - b.depth || a.name.length - b.name.length);
    return c[0] || null;
  };
  const sides = {};
  for (const side of ['left', 'right']) {
    const S = side[0].toUpperCase() + side.slice(1);
    const hand = pick((tk) => (tk.includes('hand') || tk.includes('wrist')) && !isFinger(tk) && sideOf(tk) === side);
    const foot = pick((tk) => (tk.includes('foot') || tk.includes('ankle')) && !tk.includes('toe') && sideOf(tk) === side);
    const res = { hand, foot };
    const up = (b) => {
      let p = b ? b.parent : -1;
      while (p >= 0 && isExcluded(B[p].tk)) p = B[p].parent;
      return p >= 0 ? B[p] : null;
    };
    if (hand) {
      map[`${side}Hand`] = hand.name;
      const lower = up(hand); if (lower) map[`${side}LowerArm`] = lower.name;
      const upper = up(lower); if (upper) map[`${side}UpperArm`] = upper.name;
      const clav = up(upper);
      if (clav && clav.tk.some((t) => ['clavicle', 'shoulder', 'collar', 'clav'].includes(t))) map[`${side}Shoulder`] = clav.name;
      res.armTop = clav && map[`${side}Shoulder`] ? clav : upper;
      // Fingers: descendant chains of the hand.
      for (const [F, words] of Object.entries(FINGER_WORDS)) {
        const chain = B.filter((b) => b.tk.some((t) => words.includes(t)) && !isExcluded(b.tk) && ancestors(skel, b.i).includes(hand.i));
        chain.sort((a, b) => a.depth - b.depth);
        let list = chain;
        if (list.length >= 4 && (list[0].tk.includes('metacarpal') || list[0].tk.includes('0') || list[0].tk.includes('meta'))) list = list.slice(1);
        ['Proximal', 'Intermediate', 'Distal'].forEach((seg, k) => { if (list[k]) map[`${side}${F}${seg}`] = list[k].name; });
      }
    }
    if (foot) {
      map[`${side}Foot`] = foot.name;
      const lower = up(foot); if (lower) map[`${side}LowerLeg`] = lower.name;
      const upper = up(lower); if (upper) map[`${side}UpperLeg`] = upper.name;
      res.legTop = upper;
      const toe = B.find((b) => b.parent === foot.i && !isExcluded(b.tk)) || B.find((b) => b.tk.some((t) => t === 'toe' || t === 'toes' || t === 'ball') && ancestors(skel, b.i).includes(foot.i));
      if (toe) map[`${side}Toes`] = toe.name;
    }
    sides[side] = res;
    void S;
  }
  // Hips: common parent of the thighs (fallback: a bone named hips/pelvis).
  let hips = null;
  const lt = sides.left.legTop, rt = sides.right.legTop;
  if (lt && rt && lt.parent === rt.parent && lt.parent >= 0) hips = B[lt.parent];
  if (!hips) hips = pick((tk) => tk.includes('hips') || tk.includes('pelvis') || tk.includes('hip'));
  if (hips) map.hips = hips.name;
  // Head.
  const head = pick((tk) => tk.includes('head') && !tk.includes('top'));
  if (head) map.head = head.name;
  // Spine chain: hips -> parent of the arm chains.
  const armTop = sides.left.armTop || sides.right.armTop;
  if (hips && armTop && armTop.parent >= 0) {
    const chain = pathBetween(skel, hips.i, armTop.parent);
    if (chain && chain.length) {
      const n = chain.length;
      map.spine = B[chain[0]].name;
      if (n === 2) map.chest = B[chain[1]].name;
      if (n >= 3) { map.chest = B[chain[Math.round((n - 1) / 2)]].name; map.upperChest = B[chain[n - 1]].name; }
      if (head) {
        const neckChain = pathBetween(skel, chain[n - 1], head.i);
        if (neckChain && neckChain.length > 1) map.neck = B[neckChain[0]].name;
      }
    }
  }
  if (!map.neck) { const neck = pick((tk) => tk.includes('neck')); if (neck) map.neck = neck.name; }
  return map;
}

export function missingBones(map) {
  const essential = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
  return essential.filter((b) => !map[b]);
}

// ------------------------------------------------------------------ retargeter

const _m = new THREE.Matrix4();

export class Retargeter {
  /**
   * @param skel     result of describeSkeleton()
   * @param mapping  { canonicalBone: otherBoneName }
   */
  constructor(skel, mapping) {
    this.skel = skel;
    this.mapping = { ...mapping };
    this.canonToIdx = {};
    for (const [c, n] of Object.entries(this.mapping)) {
      const b = skel.byName.get(n);
      if (b && BONE_MAP.has(c)) this.canonToIdx[c] = b.i;
    }
    this.idxToCanon = new Map(Object.entries(this.canonToIdx).map(([c, i]) => [i, c]));
    // Extra uniform scale on top of the unit (used to show a character at the Zoi's size).
    this.sizeScale = 1;
    this._computeFrame();
  }

  _p(c) { const i = this.canonToIdx[c]; return i == null ? null : this.skel.bones[i].modelPos; }

  /**
   * Body frame from joint positions: left axis from the thighs (or upper arms), up axis from
   * hips to head. Returned as the rotation whose columns are (left, up, forward).
   */
  static bodyFrame(P) {
    let left = null;
    if (P('leftUpperLeg') && P('rightUpperLeg')) left = P('leftUpperLeg').clone().sub(P('rightUpperLeg'));
    else if (P('leftUpperArm') && P('rightUpperArm')) left = P('leftUpperArm').clone().sub(P('rightUpperArm'));
    const top = P('head') || P('neck') || P('upperChest') || P('chest');
    let up = top && P('hips') ? top.clone().sub(P('hips')) : null;
    if (!left || left.lengthSq() < 1e-12) left = new THREE.Vector3(1, 0, 0);
    if (!up || up.lengthSq() < 1e-12) up = new THREE.Vector3(0, 1, 0);
    left.normalize();
    up.sub(left.clone().multiplyScalar(up.dot(left))).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up, fwd));
  }

  _computeFrame(canonFrame = null) {
    const P = (c) => this._p(c);
    this.frameOther = Retargeter.bodyFrame(P);
    // R maps the other skeleton's body frame onto the Zoi rig's own body frame (which leans
    // slightly, like a real standing pose), so identical skeletons give R = identity.
    const canon = canonFrame || new THREE.Quaternion();
    this.R = canon.clone().multiply(this.frameOther.clone().invert());
    this.Rinv = this.R.clone().invert();
    // Units: canonical is meters.
    const legLen = this._legLength((c) => P(c));
    this.legLenRaw = legLen;
    this.unit = (legLen > 20 ? 0.01 : legLen > 3 ? 0.1 : 1) * this.sizeScale;
    this.legLen = legLen * this.unit;
    // Aligned rest data (meters, canonical frame).
    this.restAligned = this.skel.bones.map((b) => ({
      pos: b.modelPos.clone().applyQuaternion(this.R).multiplyScalar(this.unit),
      quat: this.R.clone().multiply(b.modelQuat),
    }));
    // Mocap files (BVH) often put the hips at the origin in their rest pose and carry the
    // standing height in the animation; then hips positions are absolute, not rest-relative.
    const hi = this.canonToIdx.hips;
    this.absoluteHips = hi != null && Math.abs(this.restAligned[hi].pos.y) < 0.3 * this.legLen;
  }

  _legLength(P) {
    let n = 0, sum = 0;
    for (const s of ['left', 'right']) {
      const a = P(s + 'UpperLeg'), b = P(s + 'LowerLeg'), c = P(s + 'Foot');
      if (a && b && c) { sum += a.distanceTo(b) + b.distanceTo(c); n++; }
    }
    if (n) return sum / n;
    const h = P('hips'), hd = P('head');
    return h && hd ? h.distanceTo(hd) * 1.6 : 1;
  }

  /** Canonical rest offsets that give the Zoi rig this character's proportions (T-pose kept). */
  fittedRestOffsets(actor) {
    const out = {};
    const s = this.legLen / this._legLength((c) => actor.restWorld(c));
    for (const b of BONES) {
      const def = actor.rest[b.name].clone();
      if (!b.parent) {
        const hp = this._alignedPos('hips');
        out[b.name] = hp ? [0, hp.y, hp.z] : def.multiplyScalar(s).toArray();
        continue;
      }
      const me = this._alignedPos(b.name);
      // Find the nearest mapped ancestor to measure the segment length against.
      let pb = BONE_MAP.get(b.parent), steps = 1;
      while (pb && !this._alignedPos(pb.name) && pb.parent) { pb = BONE_MAP.get(pb.parent); steps++; }
      const pp = pb ? this._alignedPos(pb.name) : null;
      const len = me && pp && steps === 1 ? me.distanceTo(pp) : def.length() * s;
      out[b.name] = def.normalize().multiplyScalar(len).toArray();
    }
    return out;
  }

  _alignedPos(c) {
    const i = this.canonToIdx[c];
    return i == null ? null : this.restAligned[i].pos;
  }

  /** Computes per-bone rest alignment against the actor's current canonical rest. Call after the actor's body changes. */
  bindActor(actor) {
    this.E = {};
    const restW = {};
    for (const b of BONES) restW[b.name] = actor.restWorld(b.name);
    this._computeFrame(Retargeter.bodyFrame((c) => restW[c]));
    for (const b of BONES) {
      const c = b.name;
      const i = this.canonToIdx[c];
      let E = null;
      // The hips keep their facing exactly; every other mapped bone is aligned by direction.
      if (c === 'hips') E = new THREE.Quaternion();
      else if (i != null && b.primaryChild) {
        // Direction to the first mapped bone below (fingers may be missing for hands).
        let child = b.primaryChild;
        while (child && this.canonToIdx[child] == null) child = BONE_MAP.get(child).primaryChild;
        if (child) {
          const dO = this.restAligned[this.canonToIdx[child]].pos.clone().sub(this.restAligned[i].pos);
          const dc = restW[child].clone().sub(restW[c]);
          if (dO.lengthSq() > 1e-12 && dc.lengthSq() > 1e-12) E = new THREE.Quaternion().setFromUnitVectors(dO.normalize(), dc.normalize());
        }
      }
      if (!E) E = b.parent && this.E[b.parent] && !['hips', 'spine', 'head', 'neck'].includes(c) ? this.E[b.parent].clone() : new THREE.Quaternion();
      this.E[c] = E;
      this.E[c + ':inv'] = E.clone().invert();
    }
    this.actorLegLen = this._legLength((c) => restW[c]);
    this.actorHipsRest = restW.hips.clone();
    return this;
  }

  /** Canonical world rotations (actor space) from the actor's current local rotations. */
  static canonicalWorld(actor) {
    const W = {};
    for (const b of BONES) {
      const q = actor.bones[b.name].quaternion;
      W[b.name] = b.parent ? W[b.parent].clone().multiply(q) : q.clone();
    }
    return W;
  }

  /**
   * Poses the other skeleton from the canonical pose.
   * Returns per-bone local transforms { quat[], pos[] } and writes them to the objects when `apply`.
   */
  driveFrom(W, hipsPos, { apply = true } = {}) {
    const B = this.skel.bones;
    const G = new Array(B.length);
    const outQ = new Array(B.length), outP = new Array(B.length);
    const tmp = new THREE.Quaternion();
    for (const b of B) {
      const parentG = b.parent >= 0 ? G[b.parent] : b.parentModelQuat;
      const c = this.idxToCanon.get(b.i);
      let local;
      if (c && W[c]) {
        // G = R^-1 · W · E · R · G0
        const g = this.Rinv.clone().multiply(W[c]).multiply(this.E[c]).multiply(this.restAligned[b.i].quat);
        local = tmp.copy(parentG).invert().multiply(g).clone();
        G[b.i] = g;
      } else {
        local = b.restLocalQuat.clone();
        G[b.i] = parentG.clone().multiply(local);
      }
      outQ[b.i] = local;
      outP[b.i] = b.restLocalPos.clone();
    }
    const hi = this.canonToIdx.hips;
    if (hi != null && hipsPos) {
      const k = this.legLen / this.actorLegLen;
      const modelPos = this.absoluteHips
        ? hipsPos.clone().multiplyScalar(k).applyQuaternion(this.Rinv).multiplyScalar(1 / this.unit)
        : hipsPos.clone().sub(this.actorHipsRest).multiplyScalar(k).applyQuaternion(this.Rinv).multiplyScalar(1 / this.unit).add(B[hi].modelPos);
      const pinv = _m.copy(B[hi].parentModelMatrix).invert();
      outP[hi] = modelPos.applyMatrix4(pinv);
    }
    if (apply) {
      for (const b of B) { b.object.quaternion.copy(outQ[b.i]); b.object.position.copy(outP[b.i]); }
    }
    return { quat: outQ, pos: outP };
  }

  /** Reads the other skeleton's current pose (e.g. driven by an AnimationMixer) as a canonical pose. */
  readCanonical(actor) {
    const B = this.skel.bones;
    const model = this.skel.model;
    model.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const G = new Array(B.length);
    for (const b of B) {
      const parentG = b.parent >= 0 ? G[b.parent] : (() => {
        const pm = new THREE.Matrix4().multiplyMatrices(rootInv, b.object.parent.matrixWorld);
        return new THREE.Quaternion().setFromRotationMatrix(pm);
      })();
      G[b.i] = parentG.clone().multiply(b.object.quaternion);
    }
    const W = {};
    const pose = { rot: {}, pos: {} };
    for (const bd of BONES) {
      const c = bd.name;
      const i = this.canonToIdx[c];
      if (i != null) {
        // W = R·G·G0^-1·R^-1 · E^-1
        const g0inv = this.skel.bones[i].modelQuat.clone().invert();
        W[c] = this.R.clone().multiply(G[i]).multiply(g0inv).multiply(this.Rinv).multiply(this.E[c + ':inv']);
      } else {
        W[c] = bd.parent ? W[bd.parent].clone() : new THREE.Quaternion();
      }
      const local = bd.parent ? W[bd.parent].clone().invert().multiply(W[c]) : W[c].clone();
      pose.rot[c] = [local.x, local.y, local.z, local.w];
    }
    const hi = this.canonToIdx.hips;
    if (hi != null) {
      const m = new THREE.Matrix4().multiplyMatrices(rootInv, B[hi].object.matrixWorld);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const k = this.unit * (this.actorLegLen / this.legLen);
      pose.pos.hips = this.absoluteHips
        ? p.applyQuaternion(this.R).multiplyScalar(k).toArray()
        : actor.rest.hips.clone().add(p.sub(B[hi].modelPos).applyQuaternion(this.R).multiplyScalar(k)).toArray();
    }
    return pose;
  }
}
