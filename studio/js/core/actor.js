// An Actor is one posable character in the scene: a THREE.Bone hierarchy built from the
// canonical rig, a segmented mannequin attached to the bones, and optionally a real
// character model (e.g. the inZOI body) that follows the rig through retargeting.
import * as THREE from 'three';
import { BONES, BONE_MAP, bodyRestOffsets, BODY_TYPES } from './rig.js';
import { qIdentity } from './math.js';

const SIDE_COLORS = { left: 0x6ea8ff, right: 0xff8a9f, center: 0xb9a7e8 };
const Y = new THREE.Vector3(0, 1, 0);

function taperedCapsule(r1, r2, len, radial = 22) {
  const pts = [];
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r1), Math.sin(a) * r1));
  }
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r2), len + Math.sin(a) * r2));
  }
  return new THREE.LatheGeometry(pts, radial);
}

const sphereGeo = new THREE.SphereGeometry(1, 28, 20);

export class Actor {
  constructor({ id, name = 'Zoi', bodyType = 'adult', ghost = false, ghostColor = 0x88aaff } = {}) {
    this.id = id;
    this.name = name;
    this.bodyType = bodyType;
    this.ghost = ghost;
    this.root = new THREE.Group();
    this.root.name = 'actor:' + name;
    this.bones = {};
    this.rest = {};
    this.pickables = [];
    this.segments = {}; // bone -> meshes owned by that bone
    this.character = null; // attached retargeted model
    this.showMannequin = true;
    this.highlighted = null;
    this.hovered = null;

    this.materials = ghost
      ? { body: new THREE.MeshBasicMaterial({ color: ghostColor, transparent: true, opacity: 0.16, depthWrite: false }) }
      : {
        body: new THREE.MeshStandardMaterial({ color: 0xeceaf2, roughness: 0.42, metalness: 0.0 }),
        joint: {
          left: new THREE.MeshStandardMaterial({ color: SIDE_COLORS.left, roughness: 0.35 }),
          right: new THREE.MeshStandardMaterial({ color: SIDE_COLORS.right, roughness: 0.35 }),
          center: new THREE.MeshStandardMaterial({ color: SIDE_COLORS.center, roughness: 0.35 }),
        },
        face: new THREE.MeshStandardMaterial({ color: 0x3a3550, roughness: 0.3 }),
        select: new THREE.MeshStandardMaterial({ color: 0x8fd0ff, roughness: 0.35, emissive: 0x2a76c9, emissiveIntensity: 0.55 }),
        hover: new THREE.MeshStandardMaterial({ color: 0xf6f2ff, roughness: 0.38, emissive: 0x6a5acd, emissiveIntensity: 0.18 }),
      };

    this._buildSkeleton();
    this._buildMannequin();
  }

  _buildSkeleton() {
    const off = bodyRestOffsets(this.bodyType);
    this.skeletonRoot = null;
    for (const b of BONES) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(off[b.name]);
      this.rest[b.name] = new THREE.Vector3().fromArray(off[b.name]);
      this.bones[b.name] = bone;
      if (b.parent) this.bones[b.parent].add(bone);
      else { this.root.add(bone); this.skeletonRoot = bone; }
    }
    this.root.updateMatrixWorld(true);
  }

  /** World-space rest joint position (actor space, ignoring current pose). */
  restWorld(name) {
    const v = new THREE.Vector3();
    let b = BONE_MAP.get(name);
    while (b) { v.add(this.rest[b.name]); b = b.parent ? BONE_MAP.get(b.parent) : null; }
    return v;
  }

  _addSegment(bone, mesh, pick = true) {
    mesh.userData.bone = bone;
    mesh.castShadow = !this.ghost;
    mesh.receiveShadow = false;
    this.bones[bone].add(mesh);
    (this.segments[bone] ||= []).push(mesh);
    if (pick && !this.ghost) this.pickables.push(mesh);
    return mesh;
  }

  _limb(bone, to, r1, r2, inset = 0) {
    const a = new THREE.Vector3(0, 0, 0);
    const b = typeof to === 'string' ? this.rest[to].clone() : new THREE.Vector3().fromArray(to);
    const dir = b.clone().sub(a);
    const len = Math.max(0.001, dir.length() - inset * 2);
    dir.normalize();
    const m = new THREE.Mesh(taperedCapsule(r1, r2, len), this.materials.body);
    m.quaternion.setFromUnitVectors(Y, dir);
    m.position.copy(dir.clone().multiplyScalar(inset));
    m.userData.baseMat = this.materials.body;
    return this._addSegment(bone, m);
  }

  _blob(bone, center, radii, mat = this.materials.body, pick = true) {
    const m = new THREE.Mesh(sphereGeo, mat);
    m.position.copy(center);
    m.scale.set(radii[0], radii[1], radii[2]);
    m.userData.baseMat = mat;
    return this._addSegment(bone, m, pick);
  }

  _joint(bone, r, side) {
    if (this.ghost) return null;
    const m = this._blob(bone, new THREE.Vector3(), [r, r, r], this.materials.joint[side || 'center']);
    m.userData.isJoint = true;
    return m;
  }

  _buildMannequin() {
    const bt = BODY_TYPES[this.bodyType] || BODY_TYPES.adult;
    const s = bt.scale;
    const W = (name) => this.restWorld(name);
    const local = (bone, worldPoint) => worldPoint.clone().sub(W(bone));
    const mid = (a, b, t = 0.5) => W(a).lerp(W(b), t);

    // Torso: flattened tapered capsules that overlap at every joint, so bending the spine
    // stays smooth like a sculpted posing mannequin.
    const torso = (bone, from, to, r1, r2, depth) => {
      const a = local(bone, from), b = local(bone, to);
      const dir = b.clone().sub(a);
      const len = Math.max(0.001, dir.length());
      dir.normalize();
      const m = new THREE.Mesh(taperedCapsule(r1, r2, len, 28), this.materials.body);
      m.quaternion.setFromUnitVectors(Y, dir);
      m.position.copy(a);
      m.scale.set(1, 1, depth);
      m.userData.baseMat = this.materials.body;
      return this._addSegment(bone, m);
    };
    const V = (x, y, z) => new THREE.Vector3(x * s, y * s, z * s);
    torso('hips', W('hips').add(V(0, -0.05, 0)), W('spine'), 0.122 * s, 0.108 * s, 0.8);
    torso('spine', W('spine'), W('chest'), 0.105 * s, 0.115 * s, 0.78);
    torso('chest', W('chest'), W('upperChest'), 0.118 * s, 0.13 * s, 0.74);
    // Shoulder girdle: a wide ellipsoid gives a clean shoulder line.
    this._blob('upperChest', local('upperChest', W('upperChest').add(V(0, 0.065, -0.008))), [0.158 * s, 0.085 * s, 0.1 * s]);
    this._limb('neck', 'head', 0.043 * s, 0.04 * s);

    // Head with a simple face so it is always obvious which way the Zoi is looking.
    const hs = s * bt.headScale;
    const head = this._blob('head', new THREE.Vector3(0, 0.098 * hs, 0.012 * hs), [0.083 * hs, 0.107 * hs, 0.094 * hs]);
    head.userData.isHead = true;
    if (!this.ghost) {
      for (const sx of [1, -1]) {
        const eye = new THREE.Mesh(sphereGeo, this.materials.face);
        eye.scale.set(0.011 * hs, 0.015 * hs, 0.008 * hs);
        eye.position.set(sx * 0.032 * hs, 0.11 * hs, 0.098 * hs);
        eye.userData.bone = 'head';
        this.bones.head.add(eye);
        (this.segments.head ||= []).push(eye);
      }
      const nose = new THREE.Mesh(sphereGeo, this.materials.body);
      nose.scale.set(0.012 * hs, 0.016 * hs, 0.012 * hs);
      nose.position.set(0, 0.085 * hs, 0.103 * hs);
      nose.userData.bone = 'head';
      nose.userData.baseMat = this.materials.body;
      this.bones.head.add(nose);
      (this.segments.head ||= []).push(nose);
    }

    for (const side of ['left', 'right']) {
      const P = (n) => side + n;
      const fx = side === 'left' ? 1 : -1;
      this._limb(P('Shoulder'), P('UpperArm'), 0.042 * s, 0.046 * s);
      this._joint(P('UpperArm'), 0.052 * s, side);
      this._limb(P('UpperArm'), P('LowerArm'), 0.05 * s, 0.04 * s, 0.01 * s);
      this._joint(P('LowerArm'), 0.041 * s, side);
      this._limb(P('LowerArm'), P('Hand'), 0.04 * s, 0.03 * s, 0.008 * s);
      this._joint(P('Hand'), 0.031 * s, side);
      // Palm reaches from the wrist to the knuckles.
      const knuckles = W(P('MiddleProximal'));
      const palmCenter = W(P('Hand')).lerp(knuckles, 0.55);
      palmCenter.z -= 0.004 * s;
      this._blob(P('Hand'), local(P('Hand'), palmCenter), [0.047 * s, 0.016 * s, 0.043 * s]);
      for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
        const r = (f === 'Thumb' ? 0.0118 : f === 'Little' ? 0.0082 : 0.0094) * s;
        this._limb(P(f + 'Proximal'), P(f + 'Intermediate'), r, r * 0.94);
        this._limb(P(f + 'Intermediate'), P(f + 'Distal'), r * 0.94, r * 0.86);
        const tail = BONE_MAP.get(P(f + 'Distal')).tail.map((v) => v * s);
        this._limb(P(f + 'Distal'), tail, r * 0.86, r * 0.75);
      }
      this._joint(P('UpperLeg'), 0.072 * s, side);
      this._limb(P('UpperLeg'), P('LowerLeg'), 0.074 * s, 0.054 * s, 0.012 * s);
      this._joint(P('LowerLeg'), 0.054 * s, side);
      this._limb(P('LowerLeg'), P('Foot'), 0.052 * s, 0.038 * s, 0.01 * s);
      this._joint(P('Foot'), 0.04 * s, side);
      // Foot: heel to ball.
      const heel = W(P('Foot')).add(new THREE.Vector3(0, -0.07 * s, -0.045 * s));
      const ball = W(P('Toes'));
      const footCenter = heel.clone().lerp(ball, 0.5);
      const foot = this._blob(P('Foot'), local(P('Foot'), footCenter), [0.045 * s, 0.038 * s, 0.1 * s]);
      foot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ball.clone().sub(heel).normalize());
      this._blob(P('Toes'), new THREE.Vector3(0, -0.006 * s, 0.03 * s), [0.042 * s, 0.026 * s, 0.045 * s]);
      void fx;
    }
    this._joint('neck', 0.045 * s, 'center');
  }

  setBodyType(type) {
    const pose = this.capturePose();
    for (const name of Object.keys(this.bones)) this.bones[name].removeFromParent();
    this.root.clear();
    this.bones = {}; this.rest = {}; this.pickables = []; this.segments = {};
    this.bodyType = type;
    this._buildSkeleton();
    this._buildMannequin();
    this.applyPose(pose);
    this.setMannequinVisible(this.showMannequin);
    if (this.character) this.character.fitTo?.(this);
  }

  // ---------------------------------------------------------------- pose IO

  /** Applies a sampled pose. Bones missing from the pose return to rest. */
  applyPose(pose, { partial = false } = {}) {
    for (const b of BONES) {
      const q = pose.rot?.[b.name];
      if (q) this.bones[b.name].quaternion.set(q[0], q[1], q[2], q[3]);
      else if (!partial) this.bones[b.name].quaternion.identity();
    }
    const hp = pose.pos?.hips;
    if (hp) this.bones.hips.position.set(hp[0], hp[1], hp[2]);
    else if (!partial) this.bones.hips.position.copy(this.rest.hips);
    this.expr = pose.expr || {};
    this.root.updateMatrixWorld(true);
    this.character?.update(this);
  }

  capturePose(bones = null) {
    const pose = { rot: {}, pos: {} };
    for (const b of BONES) {
      if (bones && !bones.includes(b.name)) continue;
      const q = this.bones[b.name].quaternion;
      pose.rot[b.name] = [q.x, q.y, q.z, q.w];
    }
    if (!bones || bones.includes('hips')) {
      const p = this.bones.hips.position;
      pose.pos.hips = [p.x, p.y, p.z];
    }
    return pose;
  }

  restPose() {
    const pose = { rot: {}, pos: { hips: this.rest.hips.toArray() } };
    for (const b of BONES) pose.rot[b.name] = qIdentity();
    return pose;
  }

  worldPos(name, target = new THREE.Vector3()) {
    return this.bones[name].getWorldPosition(target);
  }

  worldQuat(name, target = new THREE.Quaternion()) {
    return this.bones[name].getWorldQuaternion(target);
  }

  // ---------------------------------------------------------------- display

  setMannequinVisible(v) {
    this.showMannequin = v;
    for (const list of Object.values(this.segments)) for (const m of list) m.visible = v;
  }

  setHighlight(selected, hovered) {
    if (this.ghost) return;
    if (this.highlighted === selected && this.hovered === hovered) return;
    this.highlighted = selected;
    this.hovered = hovered;
    for (const [bone, list] of Object.entries(this.segments)) {
      for (const m of list) {
        if (!m.userData.baseMat) continue;
        if (bone === selected) m.material = this.materials.select;
        else if (bone === hovered) m.material = m.userData.isJoint ? m.userData.baseMat : this.materials.hover;
        else m.material = m.userData.baseMat;
      }
    }
  }

  setGhostColor(color, opacity) {
    if (!this.ghost) return;
    this.materials.body.color.set(color);
    if (opacity != null) this.materials.body.opacity = opacity;
  }

  dispose() {
    this.root.removeFromParent();
    this.character?.dispose?.();
    for (const m of Object.values(this.materials)) {
      if (m.dispose) m.dispose();
      else for (const mm of Object.values(m)) mm.dispose?.();
    }
  }
}
