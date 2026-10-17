// Loading characters and animations from FBX / GLB / glTF / VRM / VRMA / BVH and converting
// them to and from the canonical Zoi rig.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { describeSkeleton, autoMap, Retargeter, missingBones } from '../core/retarget.js';
import { Clip } from '../core/clip.js';
import { BONES } from '../core/rig.js';
import { readFBXInfo } from './fbx-binary.js';

export const SUPPORTED_EXT = ['fbx', 'glb', 'gltf', 'vrm', 'vrma', 'bvh'];

/**
 * Parses a model/animation file. Returns
 * { name, format, model, animations[], fbxInfo?, originalNames?, humanoid? (canonical->node name) }
 */
export async function loadModelFile(file) {
  const name = file.name;
  const ext = name.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  return parseModel(buf, ext, name);
}

export async function parseModel(buf, ext, name = 'model') {
  if (ext === 'fbx') {
    const model = new FBXLoader().parse(buf, '');
    let fbxInfo = null;
    try { fbxInfo = readFBXInfo(buf); } catch (e) { console.warn('FBX info', e); }
    const originalNames = new Map();
    for (const m of fbxInfo?.models || []) originalNames.set(THREE.PropertyBinding.sanitizeNodeName(m.name), m.name);
    return { name, format: 'fbx', model, animations: model.animations || [], fbxInfo, originalNames };
  }
  if (ext === 'bvh') {
    const text = new TextDecoder().decode(buf);
    const res = new BVHLoader().parse(text);
    const model = new THREE.Group();
    model.name = name;
    model.add(res.skeleton.bones[0]);
    const helper = new THREE.SkeletonHelper(model);
    helper.visible = false;
    return { name, format: 'bvh', model, animations: [res.clip] };
  }
  if (['glb', 'gltf', 'vrm', 'vrma'].includes(ext)) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => loader.parse(buf, '', resolve, reject));
    const model = gltf.scene;
    const humanoid = vrmHumanoid(gltf);
    return { name, format: ext === 'vrm' || ext === 'vrma' ? ext : 'gltf', model, animations: gltf.animations || [], humanoid };
  }
  throw new Error(`Unsupported file type ".${ext}". Use FBX, GLB/glTF, VRM, VRMA or BVH.`);
}

/** Reads the VRM 0.x / 1.0 / VRMA humanoid table as { canonicalBone: objectName }. */
function vrmHumanoid(gltf) {
  const json = gltf.parser.json;
  const ext = json.extensions || {};
  const byIndex = new Map();
  for (const [obj, assoc] of gltf.parser.associations) if (assoc && assoc.nodes != null && obj.isObject3D) byIndex.set(assoc.nodes, obj);
  const out = {};
  const put = (vrmName, nodeIdx) => {
    const obj = byIndex.get(nodeIdx);
    if (!obj) return;
    let c = vrmName;
    if (vrmName.endsWith('ThumbMetacarpal')) c = vrmName.replace('ThumbMetacarpal', 'ThumbProximal');
    else if (/ThumbProximal$/.test(vrmName) && isV1) c = vrmName.replace('ThumbProximal', 'ThumbIntermediate');
    else if (/ThumbDistal$/.test(vrmName)) c = vrmName;
    out[c] = obj.name;
  };
  let isV1 = false;
  if (ext.VRM?.humanoid?.humanBones) {
    for (const hb of ext.VRM.humanoid.humanBones) put(hb.bone, hb.node);
  } else if (ext.VRMC_vrm?.humanoid?.humanBones) {
    isV1 = true;
    for (const [k, v] of Object.entries(ext.VRMC_vrm.humanoid.humanBones)) put(k, v.node);
  } else if (ext.VRMC_vrm_animation?.humanoid?.humanBones) {
    isV1 = true;
    for (const [k, v] of Object.entries(ext.VRMC_vrm_animation.humanoid.humanBones)) put(k, v.node);
  } else return null;
  return out;
}

/** Bone mapping for a loaded file: exact for VRM, automatic otherwise. */
export function mappingFor(loaded, skel) {
  if (loaded.humanoid && Object.keys(loaded.humanoid).length > 8) {
    const valid = {};
    for (const [c, n] of Object.entries(loaded.humanoid)) if (skel.byName.has(n) && BONES.some((b) => b.name === c)) valid[c] = n;
    return valid;
  }
  return autoMap(skel);
}

// ------------------------------------------------------------------ animation import

/**
 * Converts one animation of a loaded file into a Clip on the canonical rig.
 * opts: { animIndex, fps, simplify (radians tolerance, 0 = keep every frame), mapping }
 */
export function importAnimation(loaded, actor, { animIndex = 0, fps = 30, simplify = 0.004, mapping = null, name } = {}) {
  const anim = loaded.animations[animIndex];
  if (!anim) throw new Error('This file has no animation in it.');
  const model = loaded.model;
  // Measure the rest pose before the mixer touches anything.
  model.position.set(0, 0, 0); model.quaternion.identity(); model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);
  const skel = describeSkeleton(model);
  const map = mapping || mappingFor(loaded, skel);
  const missing = missingBones(map);
  if (missing.length > 4) throw new Error(`Could not recognise this skeleton (missing: ${missing.join(', ')}). Use "Map bones" to match them by hand.`);
  const rt = new Retargeter(skel, map).bindActor(actor);
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(anim);
  action.play();
  const frames = Math.max(1, Math.round(anim.duration * fps));
  const clip = new Clip({ name: name || anim.name || loaded.name.replace(/\.[^.]+$/, ''), fps, frames, loop: false });
  for (let f = 0; f <= frames; f++) {
    mixer.setTime(Math.min(anim.duration, f / fps));
    const pose = rt.readCanonical(actor);
    for (const [bone, q] of Object.entries(pose.rot)) clip.setKey(bone, 'rot', f, q, 'linear');
    if (pose.pos.hips) clip.setKey('hips', 'pos', f, pose.pos.hips, 'linear');
  }
  mixer.stopAllAction();
  // Restore rest so the model can be reused.
  for (const b of skel.bones) { b.object.position.copy(b.restLocalPos); b.object.quaternion.copy(b.restLocalQuat); b.object.scale.copy(b.restLocalScale); }
  if (simplify > 0) clip.reduceKeys(simplify);
  clip.pruneRestTracks();
  // A clip whose last pose matches its first is probably a loop.
  const a = clip.samplePose(0), b = clip.samplePose(frames);
  let diff = 0;
  for (const k of Object.keys(a.rot)) diff += 1 - Math.abs(a.rot[k][0] * b.rot[k][0] + a.rot[k][1] * b.rot[k][1] + a.rot[k][2] * b.rot[k][2] + a.rot[k][3] * b.rot[k][3]);
  clip.loop = diff < 0.02;
  return { clip, mapping: map, missing };
}

// ------------------------------------------------------------------ attached characters

/** A real character model that follows an Actor's canonical pose. */
export class CharacterRig {
  constructor(loaded, mapping = null) {
    this.loaded = loaded;
    this.format = loaded.format;
    this.fbxInfo = loaded.fbxInfo;
    this.originalNames = loaded.originalNames;
    this.model = loaded.model;
    this.model.position.set(0, 0, 0); this.model.quaternion.identity(); this.model.scale.set(1, 1, 1);
    this.model.updateMatrixWorld(true);
    this.skel = describeSkeleton(this.model);
    this.mapping = mapping || mappingFor(loaded, this.skel);
    this.missing = missingBones(this.mapping);
    this.retargeter = new Retargeter(this.skel, this.mapping);
    this.model.quaternion.copy(this.retargeter.R);
    this.model.scale.setScalar(this.retargeter.unit);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
      // VRM/unlit materials look flat in a lit scene: give them simple shading, keeping textures.
      const mats = [].concat(o.material);
      const lit = mats.map((m) => (m.isMeshBasicMaterial || m.isShaderMaterial
        ? new THREE.MeshStandardMaterial({ map: m.map || null, color: m.color ? m.color.clone() : 0xffffff, roughness: 0.62, metalness: 0, transparent: m.transparent, alphaTest: m.alphaTest || 0, side: m.side })
        : m));
      // Pure-white untextured surfaces blow out under the studio lights; use a soft clay tone.
      for (const m of lit) if (!m.map && m.color && m.color.r > 0.95 && m.color.g > 0.95 && m.color.b > 0.95) m.color.set(0xe3cfc2);
      o.material = Array.isArray(o.material) ? lit : lit[0];
    });
  }

  attach(actor) {
    this.actor = actor;
    actor.character = this;
    actor.root.add(this.model);
    this.fitTo(actor);
  }

  /**
   * Re-aligns to the actor's rest pose (call after the actor's body changes). With `matchSize`
   * the model is scaled so its legs match the Zoi's, which keeps joints, contacts and partner
   * poses lined up with the rig.
   */
  fitTo(actor) {
    const rt = this.retargeter;
    if (this.matchSize) {
      rt.sizeScale = 1;
      rt.bindActor(actor);
      rt.sizeScale = rt.actorLegLen / rt.legLen;
    }
    rt.bindActor(actor);
    this.model.scale.setScalar(rt.unit);
    this.model.quaternion.copy(rt.R);
    this.update(actor);
  }

  /** World position of the model's joint for a canonical bone (null when it is not mapped). */
  jointWorld(name, target = new THREE.Vector3()) {
    const i = this.retargeter.canonToIdx[name];
    return i == null ? null : this.skel.bones[i].object.getWorldPosition(target);
  }

  remap(mapping) {
    this.mapping = mapping;
    this.missing = missingBones(mapping);
    this.retargeter = new Retargeter(this.skel, mapping);
    this.model.scale.setScalar(this.retargeter.unit);
    if (this.actor) this.fitTo(this.actor);
  }

  update(actor) {
    const W = Retargeter.canonicalWorld(actor);
    this.retargeter.driveFrom(W, actor.bones.hips.position);
    this.model.updateMatrixWorld(true);
  }

  setVisible(v) { this.model.visible = v; }

  dispose() {
    this.model.removeFromParent();
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) m.dispose?.();
      }
    });
  }
}
