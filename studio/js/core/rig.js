// The canonical "Zoi" humanoid rig.
//
// Conventions (used everywhere in the studio):
//   * Y is up, the character faces +Z, the character's LEFT side is +X (three.js, right-handed).
//   * Every bone's rest rotation is the identity, so a bone's local quaternion directly says
//     how far it has turned away from the T-pose. This is exactly the convention of a
//     normalized VRM humanoid, which is what inZOI's Motion Capture (VMC) receiver expects.
//   * Bone names follow the VRM humanoid spec (hips, leftUpperArm, rightIndexProximal, ...).
//
// Default proportions were measured from the inZOI body-tracking reference body
// (Guides/MotionCapture/BodyTrackingVrm.vrm in the game folder), so poses that touch
// (hands on hips, sitting, hugging) line up with in-game Zois.

const L = (name) => 'left' + name;
const R = (name) => 'right' + name;

// Rest joint positions in actor space (meters), left side only; the right side is mirrored.
const REST_CENTER = {
  hips: [0, 1.0127, 0.0036],
  spine: [0, 1.0703, 0.0174],
  chest: [0, 1.1954, 0.0208],
  upperChest: [0, 1.3144, 0.0046],
  neck: [0, 1.4608, -0.0378],
  head: [0, 1.5526, -0.0272],
};
const REST_LEFT = {
  Shoulder: [0.0248, 1.4314, -0.0286],
  UpperArm: [0.1489, 1.4137, -0.0286],
  LowerArm: [0.3687, 1.4137, -0.0286],
  Hand: [0.6185, 1.4137, -0.0281],
  ThumbProximal: [0.6224, 1.4026, -0.0105],
  ThumbIntermediate: [0.6616, 1.4003, 0.0230],
  ThumbDistal: [0.6865, 1.3993, 0.0426],
  IndexProximal: [0.6910, 1.4219, -0.0064],
  IndexIntermediate: [0.7278, 1.4219, -0.0071],
  IndexDistal: [0.7504, 1.4212, -0.0080],
  MiddleProximal: [0.6920, 1.4219, -0.0259],
  MiddleIntermediate: [0.7330, 1.4219, -0.0259],
  MiddleDistal: [0.7583, 1.4219, -0.0259],
  RingProximal: [0.6911, 1.4219, -0.0432],
  RingIntermediate: [0.7292, 1.4219, -0.0432],
  RingDistal: [0.7511, 1.4219, -0.0432],
  LittleProximal: [0.6861, 1.4219, -0.0604],
  LittleIntermediate: [0.7209, 1.4219, -0.0604],
  LittleDistal: [0.7410, 1.4219, -0.0604],
  UpperLeg: [0.0854, 0.9687, -0.0005],
  LowerLeg: [0.0854, 0.5803, -0.0086],
  Foot: [0.0854, 0.1247, -0.0360],
  Toes: [0.0854, 0.0466, 0.1011],
};

// Slider axes. Each entry: [axis, sign, label, negativeEnd, positiveEnd, min, max].
// The slider value v maps to a local euler angle of (sign * v) around `axis`.
const AX = {
  torso: [['x', 1, 'Bend', 'back', 'forward', -60, 90], ['z', -1, 'Lean', 'right', 'left', -45, 45], ['y', 1, 'Twist', 'right', 'left', -60, 60]],
  hips: [['x', 1, 'Tilt', 'back', 'forward', -60, 90], ['z', -1, 'Lean', 'right', 'left', -45, 45], ['y', 1, 'Turn', 'right', 'left', -180, 180]],
  neck: [['x', 1, 'Nod', 'up', 'down', -50, 60], ['y', 1, 'Turn', 'right', 'left', -80, 80], ['z', -1, 'Tilt', 'right', 'left', -40, 40]],
  head: [['x', 1, 'Nod', 'up', 'down', -50, 60], ['y', 1, 'Turn', 'right', 'left', -80, 80], ['z', -1, 'Tilt', 'right', 'left', -40, 40]],
  shoulderL: [['z', 1, 'Shrug', 'down', 'up', -15, 35], ['y', -1, 'Reach', 'back', 'forward', -25, 30]],
  shoulderR: [['z', -1, 'Shrug', 'down', 'up', -15, 35], ['y', 1, 'Reach', 'back', 'forward', -25, 30]],
  upperArmL: [['z', 1, 'Raise', 'down', 'up', -85, 90], ['y', -1, 'Swing', 'back', 'forward', -60, 120], ['x', -1, 'Twist', 'in', 'out', -90, 90]],
  upperArmR: [['z', -1, 'Raise', 'down', 'up', -85, 90], ['y', 1, 'Swing', 'back', 'forward', -60, 120], ['x', -1, 'Twist', 'in', 'out', -90, 90]],
  lowerArmL: [['y', -1, 'Bend elbow', 'straight', 'bent', -5, 150], ['x', -1, 'Twist forearm', 'palm down', 'palm up', -90, 120]],
  lowerArmR: [['y', 1, 'Bend elbow', 'straight', 'bent', -5, 150], ['x', -1, 'Twist forearm', 'palm down', 'palm up', -90, 120]],
  handL: [['z', 1, 'Flex wrist', 'down', 'up', -70, 70], ['y', -1, 'Side bend', 'back', 'forward', -30, 30], ['x', 1, 'Roll', 'in', 'out', -45, 45]],
  handR: [['z', -1, 'Flex wrist', 'down', 'up', -70, 70], ['y', 1, 'Side bend', 'back', 'forward', -30, 30], ['x', -1, 'Roll', 'in', 'out', -45, 45]],
  fingerL: [['z', -1, 'Curl', 'open', 'curled', -15, 100], ['y', -1, 'Spread', 'in', 'out', -25, 25]],
  fingerR: [['z', 1, 'Curl', 'open', 'curled', -15, 100], ['y', 1, 'Spread', 'in', 'out', -25, 25]],
  thumbL: [['y', 1, 'Curl', 'open', 'curled', -20, 80], ['z', -1, 'Fold', 'up', 'under palm', -30, 60], ['x', 1, 'Twist', 'in', 'out', -45, 45]],
  thumbR: [['y', -1, 'Curl', 'open', 'curled', -20, 80], ['z', 1, 'Fold', 'up', 'under palm', -30, 60], ['x', -1, 'Twist', 'in', 'out', -45, 45]],
  upperLegL: [['x', -1, 'Lift leg', 'back', 'forward', -40, 130], ['z', 1, 'Spread', 'in', 'out', -30, 80], ['y', 1, 'Twist', 'in', 'out', -45, 45]],
  upperLegR: [['x', -1, 'Lift leg', 'back', 'forward', -40, 130], ['z', -1, 'Spread', 'in', 'out', -30, 80], ['y', -1, 'Twist', 'in', 'out', -45, 45]],
  lowerLeg: [['x', 1, 'Bend knee', 'straight', 'bent', -5, 155]],
  footL: [['x', 1, 'Point', 'flex up', 'point down', -40, 60], ['z', 1, 'Roll', 'in', 'out', -30, 30], ['y', 1, 'Turn', 'in', 'out', -30, 30]],
  footR: [['x', 1, 'Point', 'flex up', 'point down', -40, 60], ['z', -1, 'Roll', 'in', 'out', -30, 30], ['y', -1, 'Turn', 'in', 'out', -30, 30]],
  toes: [['x', -1, 'Bend toes', 'down', 'up', -30, 60]],
};

export const GROUPS = [
  { id: 'body', label: 'Body (hips)', color: '#f1edf4' },
  { id: 'spine', label: 'Spine', color: '#9064fa' },
  { id: 'head', label: 'Head & neck', color: '#f1b9fd' },
  { id: 'armL', label: 'Left arm', color: '#25c8e8' },
  { id: 'handL', label: 'Left hand', color: '#3cdac1' },
  { id: 'armR', label: 'Right arm', color: '#f673fb' },
  { id: 'handR', label: 'Right hand', color: '#f1b9fd' },
  { id: 'legL', label: 'Left leg', color: '#3cdac1' },
  { id: 'legR', label: 'Right leg', color: '#d9bc5f' },
];

/** Bone definitions in hierarchy order (parents before children). */
export const BONES = [];
function def(name, parent, group, label, axes, extra = {}) {
  BONES.push({ name, parent, group, label, axes: AX[axes] || [], ...extra });
}

def('hips', null, 'body', 'Hips', 'hips', { primaryChild: 'spine', canTranslate: true });
def('spine', 'hips', 'spine', 'Lower spine', 'torso', { primaryChild: 'chest' });
def('chest', 'spine', 'spine', 'Chest', 'torso', { primaryChild: 'upperChest' });
def('upperChest', 'chest', 'spine', 'Upper chest', 'torso', { primaryChild: 'neck' });
def('neck', 'upperChest', 'head', 'Neck', 'neck', { primaryChild: 'head' });
def('head', 'neck', 'head', 'Head', 'head', { tail: [0, 0.2, 0] });

for (const side of ['left', 'right']) {
  const S = side === 'left' ? 'L' : 'R';
  const P = (n) => side + n;
  const sideLabel = side === 'left' ? 'Left' : 'Right';
  const fx = side === 'left' ? 1 : -1;
  def(P('Shoulder'), 'upperChest', 'arm' + S, `${sideLabel} shoulder`, 'shoulder' + S, { primaryChild: P('UpperArm'), side });
  def(P('UpperArm'), P('Shoulder'), 'arm' + S, `${sideLabel} upper arm`, 'upperArm' + S, { primaryChild: P('LowerArm'), side });
  def(P('LowerArm'), P('UpperArm'), 'arm' + S, `${sideLabel} forearm`, 'lowerArm' + S, { primaryChild: P('Hand'), side });
  def(P('Hand'), P('LowerArm'), 'arm' + S, `${sideLabel} hand`, 'hand' + S, { primaryChild: P('MiddleProximal'), side, ikEnd: true });
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    const fl = f === 'Little' ? 'pinky' : f.toLowerCase();
    const axes = f === 'Thumb' ? 'thumb' + S : 'finger' + S;
    def(P(f + 'Proximal'), P('Hand'), 'hand' + S, `${sideLabel} ${fl} 1`, axes, { primaryChild: P(f + 'Intermediate'), side, finger: f });
    def(P(f + 'Intermediate'), P(f + 'Proximal'), 'hand' + S, `${sideLabel} ${fl} 2`, axes, { primaryChild: P(f + 'Distal'), side, finger: f });
    def(P(f + 'Distal'), P(f + 'Intermediate'), 'hand' + S, `${sideLabel} ${fl} 3`, axes, { tail: f === 'Thumb' ? [fx * 0.02, 0, 0.014] : [fx * 0.022, 0, 0], side, finger: f });
  }
  def(P('UpperLeg'), 'hips', 'leg' + S, `${sideLabel} thigh`, 'upperLeg' + S, { primaryChild: P('LowerLeg'), side });
  def(P('LowerLeg'), P('UpperLeg'), 'leg' + S, `${sideLabel} shin`, 'lowerLeg', { primaryChild: P('Foot'), side });
  def(P('Foot'), P('LowerLeg'), 'leg' + S, `${sideLabel} foot`, 'foot' + S, { primaryChild: P('Toes'), side, ikEnd: true });
  def(P('Toes'), P('Foot'), 'leg' + S, `${sideLabel} toes`, 'toes', { tail: [0, -0.01, 0.06], side });
}

export const BONE_MAP = new Map(BONES.map((b) => [b.name, b]));
export const BONE_NAMES = BONES.map((b) => b.name);
export const BONE_INDEX = new Map(BONE_NAMES.map((n, i) => [n, i]));

export const CHILDREN = new Map(BONE_NAMES.map((n) => [n, []]));
for (const b of BONES) if (b.parent) CHILDREN.get(b.parent).push(b.name);

/** Name of the bone on the opposite side (or the same name for center bones). */
export function mirrorName(name) {
  if (name.startsWith('left')) return 'right' + name.slice(4);
  if (name.startsWith('right')) return 'left' + name.slice(5);
  return name;
}

/** Unity HumanBodyBones name used by the VMC protocol. */
export function vmcName(name) { return name[0].toUpperCase() + name.slice(1); }

/** Rest joint positions (actor space) for the default inZOI adult body. */
export function defaultRestWorld() {
  const out = {};
  for (const [k, v] of Object.entries(REST_CENTER)) out[k] = v.slice();
  for (const [k, v] of Object.entries(REST_LEFT)) {
    out[L(k)] = v.slice();
    out[R(k)] = [-v[0], v[1], v[2]];
  }
  return out;
}

/** Converts world rest positions to parent-relative offsets. */
export function restOffsetsFromWorld(world) {
  const out = {};
  for (const b of BONES) {
    const w = world[b.name];
    if (!b.parent) { out[b.name] = w.slice(); continue; }
    const p = world[b.parent];
    out[b.name] = [w[0] - p[0], w[1] - p[1], w[2] - p[2]];
  }
  return out;
}

export const BODY_TYPES = {
  adult: { label: 'Adult', scale: 1, headScale: 1 },
  tall: { label: 'Adult (tall)', scale: 1.06, headScale: 1 },
  teen: { label: 'Teen', scale: 0.93, headScale: 1.04 },
  child: { label: 'Child', scale: 0.66, headScale: 1.28 },
};

/** Rest offsets for one of the built-in body types. */
export function bodyRestOffsets(bodyType = 'adult') {
  const bt = BODY_TYPES[bodyType] || BODY_TYPES.adult;
  const off = restOffsetsFromWorld(defaultRestWorld());
  for (const k of Object.keys(off)) off[k] = off[k].map((v) => v * bt.scale);
  return off;
}

/** Standard naming presets for exporting to other skeletons. */
export const NAMING = {
  vrm: { label: 'VRM humanoid (hips, leftUpperArm…)', map: (n) => n },
  vmc: { label: 'Unity / VMC (Hips, LeftUpperArm…)', map: vmcName },
  inzoiVrm: {
    label: 'inZOI body tracking (J_Bip_…)',
    map: (n) => {
      const center = { hips: 'J_Bip_C_Hips', spine: 'J_Bip_C_Spine', chest: 'J_Bip_C_Chest', upperChest: 'J_Bip_C_UpperChest', neck: 'J_Bip_C_Neck', head: 'J_Bip_C_Head' };
      if (center[n]) return center[n];
      const side = n.startsWith('left') ? 'L' : 'R';
      const rest = n.replace(/^(left|right)/, '');
      const m = rest.match(/^(Thumb|Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$/);
      if (m) return `J_Bip_${side}_${m[1]}${{ Proximal: 1, Intermediate: 2, Distal: 3 }[m[2]]}`;
      return `J_Bip_${side}_${rest === 'Toes' ? 'ToeBase' : rest}`;
    },
  },
  unreal: {
    label: 'Unreal mannequin (pelvis, upperarm_l…)',
    root: 'root',
    map: (n) => {
      const center = { hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_03', neck: 'neck_01', head: 'head' };
      if (center[n]) return center[n];
      const s = n.startsWith('left') ? 'l' : 'r';
      const rest = n.replace(/^(left|right)/, '');
      const m = rest.match(/^(Thumb|Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$/);
      if (m) return `${m[1] === 'Little' ? 'pinky' : m[1].toLowerCase()}_0${{ Proximal: 1, Intermediate: 2, Distal: 3 }[m[2]]}_${s}`;
      return { Shoulder: 'clavicle', UpperArm: 'upperarm', LowerArm: 'lowerarm', Hand: 'hand', UpperLeg: 'thigh', LowerLeg: 'calf', Foot: 'foot', Toes: 'ball' }[rest] + '_' + s;
    },
  },
  mixamo: {
    label: 'Mixamo (mixamorig:Hips…)',
    map: (n) => {
      const center = { hips: 'Hips', spine: 'Spine', chest: 'Spine1', upperChest: 'Spine2', neck: 'Neck', head: 'Head' };
      if (center[n]) return 'mixamorig:' + center[n];
      const side = n.startsWith('left') ? 'Left' : 'Right';
      const rest = n.replace(/^(left|right)/, '');
      const m = rest.match(/^(Thumb|Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$/);
      if (m) return `mixamorig:${side}Hand${m[1] === 'Little' ? 'Pinky' : m[1]}${{ Proximal: 1, Intermediate: 2, Distal: 3 }[m[2]]}`;
      return 'mixamorig:' + side + { Shoulder: 'Shoulder', UpperArm: 'Arm', LowerArm: 'ForeArm', Hand: 'Hand', UpperLeg: 'UpLeg', LowerLeg: 'Leg', Foot: 'Foot', Toes: 'ToeBase' }[rest];
    },
  },
};
