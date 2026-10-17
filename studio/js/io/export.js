// Export: bakes clips frame-by-frame onto a target skeleton and writes FBX / BVH / GLB.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { BONES, NAMING } from '../core/rig.js';
import { Retargeter } from '../core/retarget.js';
import {
  N, P, I, L, D, S, C, R, Ai, Al, Af, nameClass, encodeFBX, FBX_FILE_ID, TIME_ID, KTIME_PER_SECOND,
} from './fbx-binary.js';

export const ROOT_MOTION = {
  keep: 'Keep movement (hips travel)',
  inPlace: 'In place (remove forward/sideways travel)',
};

// ------------------------------------------------------------------ baking

/**
 * Samples a clip on the canonical rig. Returns per-frame { quat: {bone: [x,y,z,w]}, hips: [x,y,z] }.
 * `rest` = actor.rest (THREE.Vector3 offsets).
 */
export function bakeCanonical(clip, rest, { rootMotion = 'keep' } = {}) {
  const frames = [];
  const hr = rest.hips;
  for (let f = 0; f <= clip.frames; f++) {
    const pose = clip.samplePose(f);
    const quat = {};
    for (const b of BONES) quat[b.name] = pose.rot[b.name] || [0, 0, 0, 1];
    let hips = pose.pos.hips ? pose.pos.hips.slice() : [hr.x, hr.y, hr.z];
    if (rootMotion === 'inPlace') { hips[0] = hr.x; hips[2] = hr.z; }
    frames.push({ quat, hips, expr: pose.expr });
  }
  return frames;
}

/** Canonical skeleton description using a naming preset. Positions in meters. */
export function canonicalSkeleton(rest, naming = 'vrm') {
  const preset = NAMING[naming] || NAMING.vrm;
  const bones = [];
  const index = {};
  if (preset.root) {
    bones.push({ name: preset.root, parent: -1, pos: [0, 0, 0], quat: [0, 0, 0, 1], canonical: null });
  }
  for (const b of BONES) {
    index[b.name] = bones.length;
    bones.push({
      name: preset.map(b.name),
      parent: b.parent ? index[b.parent] : (preset.root ? 0 : -1),
      pos: rest[b.name].toArray(),
      quat: [0, 0, 0, 1],
      canonical: b.name,
    });
  }
  return { bones, index };
}

/** Per-frame local transforms for the canonical skeleton. */
export function framesForCanonical(skel, baked) {
  return baked.map((fr) => ({
    quat: skel.bones.map((b) => (b.canonical ? fr.quat[b.canonical] : [0, 0, 0, 1])),
    pos: skel.bones.map((b) => (b.canonical === 'hips' ? fr.hips : b.pos)),
  }));
}

/**
 * Bakes onto a loaded character via its Retargeter.
 * Returns { bones:[{name,parent,pos,quat,scale,isBone}], frames:[{quat[],pos[]}] } in model units.
 */
export function bakeOntoTarget(retargeter, actor, clip, { rootMotion = 'keep', originalNames = null } = {}) {
  const skel = retargeter.skel;
  const baked = bakeCanonical(clip, actor.rest, { rootMotion });
  const bones = skel.bones.map((b) => ({
    name: originalNames?.get(b.name) || b.name,
    parent: b.parent,
    pos: b.restLocalPos.toArray(),
    quat: b.restLocalQuat.toArray(),
    scale: b.restLocalScale.toArray(),
    parentNull: b.parent < 0 && b.object.parent !== skel.model ? b.object.parent : null,
  }));
  const frames = [];
  const W = {};
  for (const fr of baked) {
    for (const bd of BONES) {
      const q = new THREE.Quaternion().fromArray(fr.quat[bd.name]);
      W[bd.name] = bd.parent ? W[bd.parent].clone().multiply(q) : q;
    }
    const out = retargeter.driveFrom(W, new THREE.Vector3().fromArray(fr.hips), { apply: false });
    frames.push({ quat: out.quat.map((q) => q.toArray()), pos: out.pos.map((p) => p.toArray()) });
  }
  // Non-bone ancestors (e.g. an "Armature" null with axis/scale conversion) must be kept.
  const nulls = [];
  const top = skel.bones.filter((b) => b.parent < 0);
  for (const b of top) {
    let o = b.object.parent;
    const chain = [];
    while (o && o !== skel.model) { chain.unshift(o); o = o.parent; }
    for (const n of chain) if (!nulls.includes(n)) nulls.push(n);
  }
  return { bones, frames, nulls: nulls.map((n) => ({ name: n.name || 'Root', obj: n })) };
}

// ------------------------------------------------------------------ euler helpers

const RAD2DEG = 180 / Math.PI;
function quatToEulerDeg(q, order) {
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q[0], q[1], q[2], q[3]), order);
  return [e.x * RAD2DEG, e.y * RAD2DEG, e.z * RAD2DEG];
}
function wrapNear(a, ref) { while (a - ref > 180) a -= 360; while (a - ref < -180) a += 360; return a; }
/** Picks the euler solution closest to the previous frame (prevents 360° flips). */
function eulerFilter(prev, cur) {
  if (!prev) return cur;
  const a = cur.map((v, i) => wrapNear(v, prev[i]));
  const alt = [cur[0] + 180, 180 - cur[1], cur[2] + 180].map((v, i) => wrapNear(v, prev[i]));
  const d = (e) => Math.abs(e[0] - prev[0]) + Math.abs(e[1] - prev[1]) + Math.abs(e[2] - prev[2]);
  return d(alt) < d(a) ? alt : a;
}

// ------------------------------------------------------------------ FBX

const TIME_MODES = { 120: 1, 100: 2, 60: 3, 50: 4, 48: 5, 30: 6, 25: 10, 24: 11, 96: 15, 72: 16 };

/**
 * Writes an animation FBX.
 * data: { bones:[{name,parent,pos,quat,scale?}], frames:[{quat[],pos[]}], nulls? }
 * opts: { fps, name, positionScale (units->file units), settings (GlobalSettings overrides) }
 */
export function writeAnimationFBX(data, { fps = 30, name = 'Take 001', positionScale = 100, settings = {} } = {}) {
  let nextId = 1000000n;
  const id = () => (nextId += 7n);
  const nFrames = data.frames.length;
  const ktime = (f) => (BigInt(f) * KTIME_PER_SECOND) / BigInt(fps);
  const stop = ktime(nFrames - 1);
  const now = new Date();
  const gs = {
    UpAxis: 1, UpAxisSign: 1, FrontAxis: 2, FrontAxisSign: 1, CoordAxis: 0, CoordAxisSign: 1,
    OriginalUpAxis: 1, OriginalUpAxisSign: 1, UnitScaleFactor: 1, OriginalUnitScaleFactor: 1, ...settings,
  };

  const header = N('FBXHeaderExtension', [], [
    N('FBXHeaderVersion', [I(1003)]),
    N('FBXVersion', [I(7400)]),
    N('EncryptionType', [I(0)]),
    N('CreationTimeStamp', [], [
      N('Version', [I(1000)]), N('Year', [I(now.getFullYear())]), N('Month', [I(now.getMonth() + 1)]),
      N('Day', [I(now.getDate())]), N('Hour', [I(now.getHours())]), N('Minute', [I(now.getMinutes())]),
      N('Second', [I(now.getSeconds())]), N('Millisecond', [I(0)]),
    ]),
    N('Creator', [S('Studio')]),
    N('SceneInfo', [nameClass('GlobalInfo', 'SceneInfo'), S('UserData')], [
      N('Type', [S('UserData')]), N('Version', [I(100)]),
      N('MetaData', [], [N('Version', [I(100)]), N('Title', [S(name)]), N('Subject', [S('')]), N('Author', [S('')]), N('Keywords', [S('')]), N('Revision', [S('')]), N('Comment', [S('Made with Studio')])]),
      N('Properties70', [], [
        P.string('DocumentUrl', '/anim.fbx'), P.string('SrcDocumentUrl', '/anim.fbx'), P.compound('Original'),
        P.string('Original|ApplicationVendor', 'Zoi Animation Framework'), P.string('Original|ApplicationName', 'Studio'),
        P.string('Original|ApplicationVersion', '1.0'), P.datetime('Original|DateTime_GMT', '01/01/1970 00:00:00.000'),
        P.string('Original|FileName', '/anim.fbx'), P.compound('LastSaved'),
        P.string('LastSaved|ApplicationVendor', 'Zoi Animation Framework'), P.string('LastSaved|ApplicationName', 'Studio'),
        P.string('LastSaved|ApplicationVersion', '1.0'), P.datetime('LastSaved|DateTime_GMT', '01/01/1970 00:00:00.000'),
      ]),
    ]),
  ]);

  const timeMode = TIME_MODES[fps] ?? 14;
  const globalSettings = N('GlobalSettings', [], [
    N('Version', [I(1000)]),
    N('Properties70', [], [
      P.int('UpAxis', gs.UpAxis), P.int('UpAxisSign', gs.UpAxisSign), P.int('FrontAxis', gs.FrontAxis),
      P.int('FrontAxisSign', gs.FrontAxisSign), P.int('CoordAxis', gs.CoordAxis), P.int('CoordAxisSign', gs.CoordAxisSign),
      P.int('OriginalUpAxis', gs.OriginalUpAxis), P.int('OriginalUpAxisSign', gs.OriginalUpAxisSign),
      P.double('UnitScaleFactor', gs.UnitScaleFactor), P.double('OriginalUnitScaleFactor', gs.OriginalUnitScaleFactor),
      P.colorRGB('AmbientColor', [0, 0, 0]), P.string('DefaultCamera', 'Producer Perspective'),
      P.enum('TimeMode', timeMode), P.enum('TimeProtocol', 2), P.enum('SnapOnFrameMode', 0),
      P.time('TimeSpanStart', 0n), P.time('TimeSpanStop', stop), P.double('CustomFrameRate', fps),
      N('P', [S('TimeMarker'), S('Compound'), S(''), S('')]), P.int('CurrentTimeMarker', -1),
    ]),
  ]);

  const objects = N('Objects');
  const conns = N('Connections');
  const counts = { Model: 0, NodeAttribute: 0, AnimationCurveNode: 0, AnimationCurve: 0 };

  const modelIds = [];
  const writeModel = (mname, type, pos, rotDeg, scl, attr = true) => {
    const mid = id();
    if (attr) {
      const aid = id();
      objects.add(N('NodeAttribute', [L(aid), nameClass(mname, 'NodeAttribute'), S(type)], [
        N('Properties70', [], [P.double('Size', 100)]),
        N('TypeFlags', [S(type === 'LimbNode' ? 'Skeleton' : 'Null')]),
      ]));
      counts.NodeAttribute++;
      conns.add(N('C', [S('OO'), L(aid), L(mid)]));
    }
    objects.add(N('Model', [L(mid), nameClass(mname, 'Model'), S(type)], [
      N('Version', [I(232)]),
      N('Properties70', [], [
        P.bool('RotationActive', true), P.enum('InheritType', 1), P.int('DefaultAttributeIndex', 0),
        P.lcl('Translation', pos), P.lcl('Rotation', rotDeg), P.lcl('Scaling', scl),
      ]),
      N('MultiLayer', [I(0)]), N('MultiTake', [I(0)]), N('Shading', [C(true)]), N('Culling', [S('CullingOff')]),
    ]));
    counts.Model++;
    return mid;
  };

  // Null ancestors (static).
  const nullIds = new Map();
  for (const n of data.nulls || []) {
    const o = n.obj;
    const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'ZYX');
    const mid = writeModel(n.name, 'Null', o.position.toArray().map((v) => v * positionScale), [e.x * RAD2DEG, e.y * RAD2DEG, e.z * RAD2DEG], o.scale.toArray(), true);
    nullIds.set(o, mid);
    const parentId = o.parent && nullIds.has(o.parent) ? nullIds.get(o.parent) : 0n;
    conns.add(N('C', [S('OO'), L(mid), L(parentId)]));
  }

  // Bones: the model's own transform is the rest pose; the animation lives in the curves.
  data.bones.forEach((b) => {
    const mid = writeModel(b.name, 'LimbNode', b.pos.map((v) => v * positionScale), quatToEulerDeg(b.quat, 'ZYX'), b.scale || [1, 1, 1]);
    modelIds.push(mid);
  });
  data.bones.forEach((b, i) => {
    let parentId = 0n;
    if (b.parent >= 0) parentId = modelIds[b.parent];
    else if (b.parentNull && nullIds.has(b.parentNull)) parentId = nullIds.get(b.parentNull);
    conns.add(N('C', [S('OO'), L(modelIds[i]), L(parentId)]));
  });

  // Animation stack / layer.
  const stackId = id(), layerId = id();
  objects.add(N('AnimationStack', [L(stackId), nameClass(name, 'AnimStack'), S('')], [
    N('Properties70', [], [P.time('LocalStart', 0n), P.time('LocalStop', stop), P.time('ReferenceStart', 0n), P.time('ReferenceStop', stop)]),
  ]));
  objects.add(N('AnimationLayer', [L(layerId), nameClass('BaseLayer', 'AnimLayer'), S('')]));
  conns.add(N('C', [S('OO'), L(layerId), L(stackId)]));

  const times = Array.from({ length: nFrames }, (_, f) => ktime(f));
  const addCurveNode = (boneIdx, kind, valuesPerFrame) => {
    const cnId = id();
    const label = kind === 'Translation' ? 'T' : 'R';
    const v0 = valuesPerFrame[0];
    objects.add(N('AnimationCurveNode', [L(cnId), nameClass(label, 'AnimCurveNode'), S('')], [
      N('Properties70', [], [P.number('d|X', v0[0]), P.number('d|Y', v0[1]), P.number('d|Z', v0[2])]),
    ]));
    counts.AnimationCurveNode++;
    conns.add(N('C', [S('OO'), L(cnId), L(layerId)]));
    conns.add(N('C', [S('OP'), L(cnId), L(modelIds[boneIdx]), S('Lcl ' + kind)]));
    ['X', 'Y', 'Z'].forEach((axis, c) => {
      const cid = id();
      objects.add(N('AnimationCurve', [L(cid), nameClass('', 'AnimCurve'), S('')], [
        N('Default', [D(v0[c])]),
        N('KeyVer', [I(4008)]),
        N('KeyTime', [Al(times)]),
        N('KeyValueFloat', [Af(valuesPerFrame.map((v) => v[c]))]),
        N('KeyAttrFlags', [Ai([24836])]),
        N('KeyAttrDataFloat', [Af([0, 0, 9.419963346924634e-30, 0])]),
        N('KeyAttrRefCount', [Ai([nFrames])]),
      ]));
      counts.AnimationCurve++;
      conns.add(N('C', [S('OP'), L(cid), L(cnId), S('d|' + axis)]));
    });
  };
  data.bones.forEach((b, i) => {
    let prev = null;
    const rot = data.frames.map((fr) => (prev = eulerFilter(prev, quatToEulerDeg(fr.quat[i], 'ZYX'))));
    addCurveNode(i, 'Rotation', rot);
    addCurveNode(i, 'Translation', data.frames.map((fr) => fr.pos[i].map((v) => v * positionScale)));
  });

  const total = 1 + counts.Model + counts.NodeAttribute + 2 + counts.AnimationCurveNode + counts.AnimationCurve;
  const defs = N('Definitions', [], [
    N('Version', [I(100)]), N('Count', [I(total)]),
    N('ObjectType', [S('GlobalSettings')], [N('Count', [I(1)])]),
    N('ObjectType', [S('Model')], [N('Count', [I(counts.Model)])]),
    N('ObjectType', [S('NodeAttribute')], [N('Count', [I(counts.NodeAttribute)])]),
    N('ObjectType', [S('AnimationStack')], [N('Count', [I(1)])]),
    N('ObjectType', [S('AnimationLayer')], [N('Count', [I(1)])]),
    N('ObjectType', [S('AnimationCurveNode')], [N('Count', [I(counts.AnimationCurveNode)])]),
    N('ObjectType', [S('AnimationCurve')], [N('Count', [I(counts.AnimationCurve)])]),
  ]);

  const docId = id();
  const documents = N('Documents', [], [
    N('Count', [I(1)]),
    N('Document', [L(docId), S('Scene'), S('Scene')], [
      N('Properties70', [], [P.object('SourceObject'), P.string('ActiveAnimStackName', name)]),
      N('RootNode', [L(0)]),
    ]),
  ]);

  const takes = N('Takes', [], [
    N('Current', [S('')]),
    N('Take', [S(name)], [
      N('FileName', [S(name.replace(/\s+/g, '_') + '.tak')]),
      N('LocalTime', [L(0), L(stop)]),
      N('ReferenceTime', [L(0), L(stop)]),
    ]),
  ]);

  return encodeFBX([
    header,
    N('FileId', [R(FBX_FILE_ID)]),
    N('CreationTime', [S(TIME_ID)]),
    N('Creator', [S('Studio')]),
    globalSettings,
    documents,
    N('References'),
    defs,
    objects,
    conns,
    takes,
  ]);
}

/** Convenience: FBX on the canonical rig with a naming preset. */
export function exportCanonicalFBX(clip, rest, { naming = 'vrm', rootMotion = 'keep', name } = {}) {
  const skel = canonicalSkeleton(rest, naming);
  const baked = bakeCanonical(clip, rest, { rootMotion });
  const frames = framesForCanonical(skel, baked);
  return writeAnimationFBX({ bones: skel.bones, frames }, { fps: clip.fps, name: name || clip.name, positionScale: 100 });
}

/** FBX on a loaded character (e.g. the inZOI skeleton from the ModKit). */
export function exportTargetFBX(target, actor, clip, { rootMotion = 'keep', name } = {}) {
  const data = bakeOntoTarget(target.retargeter, actor, clip, { rootMotion, originalNames: target.originalNames });
  const isFbx = target.format === 'fbx';
  // FBX sources: keep their own axes/units (positions are already in file units).
  // glTF/VRM sources: meters, Y-up -> write centimeters.
  const settings = isFbx ? pickSettings(target.fbxInfo?.settings) : {};
  return writeAnimationFBX(data, { fps: clip.fps, name: name || clip.name, positionScale: isFbx ? 1 : 100, settings });
}

function pickSettings(s = {}) {
  const keys = ['UpAxis', 'UpAxisSign', 'FrontAxis', 'FrontAxisSign', 'CoordAxis', 'CoordAxisSign', 'OriginalUpAxis', 'OriginalUpAxisSign', 'UnitScaleFactor', 'OriginalUnitScaleFactor'];
  const out = {};
  for (const k of keys) if (s[k] != null) out[k] = Number(s[k]);
  return out;
}

// ------------------------------------------------------------------ BVH

export function exportBVH(clip, rest, { naming = 'vrm', rootMotion = 'keep' } = {}) {
  const skel = canonicalSkeleton(rest, naming);
  const baked = bakeCanonical(clip, rest, { rootMotion });
  const frames = framesForCanonical(skel, baked);
  const children = skel.bones.map(() => []);
  skel.bones.forEach((b, i) => { if (b.parent >= 0) children[b.parent].push(i); });
  const cm = (v) => (v * 100).toFixed(4);
  const lines = ['HIERARCHY'];
  const order = [];
  const walk = (i, depth) => {
    const b = skel.bones[i];
    const pad = '  '.repeat(depth);
    lines.push(`${pad}${depth === 0 ? 'ROOT' : 'JOINT'} ${b.name.replace(/[:\s]/g, '_')}`);
    lines.push(`${pad}{`);
    // The root's position channels carry its absolute position, so its OFFSET stays zero.
    lines.push(`${pad}  OFFSET ${(depth === 0 ? [0, 0, 0] : b.pos).map(cm).join(' ')}`);
    lines.push(`${pad}  CHANNELS ${depth === 0 ? '6 Xposition Yposition Zposition Zrotation Xrotation Yrotation' : '3 Zrotation Xrotation Yrotation'}`);
    order.push(i);
    if (children[i].length) for (const c of children[i]) walk(c, depth + 1);
    else {
      const def = b.canonical ? BONES.find((x) => x.name === b.canonical) : null;
      const tail = def?.tail || [0, 0.05, 0];
      lines.push(`${pad}  End Site`, `${pad}  {`, `${pad}    OFFSET ${tail.map(cm).join(' ')}`, `${pad}  }`);
    }
    lines.push(`${pad}}`);
  };
  walk(0, 0);
  lines.push('MOTION', `Frames: ${frames.length}`, `Frame Time: ${(1 / clip.fps).toFixed(6)}`);
  const prevE = new Map();
  for (const fr of frames) {
    const vals = [];
    for (const i of order) {
      if (i === 0) vals.push(...fr.pos[0].map(cm));
      let e = quatToEulerDeg(fr.quat[i], 'ZXY');
      e = eulerFilter(prevE.get(i), e);
      prevE.set(i, e);
      vals.push(e[2].toFixed(4), e[0].toFixed(4), e[1].toFixed(4));
    }
    lines.push(vals.join(' '));
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ GLB

/** GLB with the canonical skeleton (+ the mannequin meshes) and the animation. */
export async function exportGLB(clip, actorFactory, rest, { includeMannequin = true, rootMotion = 'keep' } = {}) {
  const actor = actorFactory();
  if (!includeMannequin) actor.setMannequinVisible(false);
  const baked = bakeCanonical(clip, rest, { rootMotion });
  const times = baked.map((_, f) => f / clip.fps);
  const tracks = [];
  for (const b of BONES) {
    const vals = [];
    for (const fr of baked) vals.push(...fr.quat[b.name]);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, vals));
  }
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, baked.flatMap((fr) => fr.hips)));
  const anim = new THREE.AnimationClip(clip.name || 'animation', clip.duration, tracks);
  const scene = new THREE.Scene();
  scene.add(actor.root);
  if (!includeMannequin) for (const list of Object.values(actor.segments)) for (const m of list) m.removeFromParent();
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true, animations: [anim], onlyVisible: true });
  actor.dispose();
  return new Uint8Array(result);
}

export { quatToEulerDeg, eulerFilter, Retargeter };
