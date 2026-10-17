# SPDX-License-Identifier: MIT
"""The canonical "Zoi" humanoid rig (port of studio/js/core/rig.js).

Conventions (canonical space):
  * Y is up, the character faces +Z, the character's LEFT side is +X (three.js, right-handed).
  * Every bone's rest rotation is the identity.
  * Bone names follow the VRM humanoid spec (hips, leftUpperArm, rightIndexProximal, ...).

Pure Python: no bpy / mathutils imports, so it can be used and tested anywhere.
"""

import re

REST_CENTER = {
    "hips": (0.0, 1.0127, 0.0036),
    "spine": (0.0, 1.0703, 0.0174),
    "chest": (0.0, 1.1954, 0.0208),
    "upperChest": (0.0, 1.3144, 0.0046),
    "neck": (0.0, 1.4608, -0.0378),
    "head": (0.0, 1.5526, -0.0272),
}

REST_LEFT = {
    "Shoulder": (0.0248, 1.4314, -0.0286),
    "UpperArm": (0.1489, 1.4137, -0.0286),
    "LowerArm": (0.3687, 1.4137, -0.0286),
    "Hand": (0.6185, 1.4137, -0.0281),
    "ThumbProximal": (0.6224, 1.4026, -0.0105),
    "ThumbIntermediate": (0.6616, 1.4003, 0.0230),
    "ThumbDistal": (0.6865, 1.3993, 0.0426),
    "IndexProximal": (0.6910, 1.4219, -0.0064),
    "IndexIntermediate": (0.7278, 1.4219, -0.0071),
    "IndexDistal": (0.7504, 1.4212, -0.0080),
    "MiddleProximal": (0.6920, 1.4219, -0.0259),
    "MiddleIntermediate": (0.7330, 1.4219, -0.0259),
    "MiddleDistal": (0.7583, 1.4219, -0.0259),
    "RingProximal": (0.6911, 1.4219, -0.0432),
    "RingIntermediate": (0.7292, 1.4219, -0.0432),
    "RingDistal": (0.7511, 1.4219, -0.0432),
    "LittleProximal": (0.6861, 1.4219, -0.0604),
    "LittleIntermediate": (0.7209, 1.4219, -0.0604),
    "LittleDistal": (0.7410, 1.4219, -0.0604),
    "UpperLeg": (0.0854, 0.9687, -0.0005),
    "LowerLeg": (0.0854, 0.5803, -0.0086),
    "Foot": (0.0854, 0.1247, -0.0360),
    "Toes": (0.0854, 0.0466, 0.1011),
}

GROUPS = [
    ("body", "Body (hips)"),
    ("spine", "Spine"),
    ("head", "Head & neck"),
    ("armL", "Left arm"),
    ("handL", "Left hand"),
    ("armR", "Right arm"),
    ("handR", "Right hand"),
    ("legL", "Left leg"),
    ("legR", "Right leg"),
]


class BoneDef:
    __slots__ = ("name", "parent", "group", "label", "primary_child", "tail", "side", "finger")

    def __init__(self, name, parent, group, label, primary_child=None, tail=None, side=None, finger=None):
        self.name = name
        self.parent = parent
        self.group = group
        self.label = label
        self.primary_child = primary_child
        self.tail = tail
        self.side = side
        self.finger = finger


#: Bone definitions in hierarchy order (parents before children), identical to rig.js BONES.
BONES = []


def _def(name, parent, group, label, **kw):
    BONES.append(BoneDef(name, parent, group, label, **kw))


_def("hips", None, "body", "Hips", primary_child="spine")
_def("spine", "hips", "spine", "Lower spine", primary_child="chest")
_def("chest", "spine", "spine", "Chest", primary_child="upperChest")
_def("upperChest", "chest", "spine", "Upper chest", primary_child="neck")
_def("neck", "upperChest", "head", "Neck", primary_child="head")
_def("head", "neck", "head", "Head", tail=(0.0, 0.2, 0.0))

for _side in ("left", "right"):
    _S = "L" if _side == "left" else "R"
    _sl = "Left" if _side == "left" else "Right"
    _fx = 1.0 if _side == "left" else -1.0

    def _P(n, side=_side):
        return side + n

    _def(_P("Shoulder"), "upperChest", "arm" + _S, f"{_sl} shoulder", primary_child=_P("UpperArm"), side=_side)
    _def(_P("UpperArm"), _P("Shoulder"), "arm" + _S, f"{_sl} upper arm", primary_child=_P("LowerArm"), side=_side)
    _def(_P("LowerArm"), _P("UpperArm"), "arm" + _S, f"{_sl} forearm", primary_child=_P("Hand"), side=_side)
    _def(_P("Hand"), _P("LowerArm"), "arm" + _S, f"{_sl} hand", primary_child=_P("MiddleProximal"), side=_side)
    for _f in ("Thumb", "Index", "Middle", "Ring", "Little"):
        _fl = "pinky" if _f == "Little" else _f.lower()
        _def(_P(_f + "Proximal"), _P("Hand"), "hand" + _S, f"{_sl} {_fl} 1",
             primary_child=_P(_f + "Intermediate"), side=_side, finger=_f)
        _def(_P(_f + "Intermediate"), _P(_f + "Proximal"), "hand" + _S, f"{_sl} {_fl} 2",
             primary_child=_P(_f + "Distal"), side=_side, finger=_f)
        _tail = (_fx * 0.02, 0.0, 0.014) if _f == "Thumb" else (_fx * 0.022, 0.0, 0.0)
        _def(_P(_f + "Distal"), _P(_f + "Intermediate"), "hand" + _S, f"{_sl} {_fl} 3",
             tail=_tail, side=_side, finger=_f)
    _def(_P("UpperLeg"), "hips", "leg" + _S, f"{_sl} thigh", primary_child=_P("LowerLeg"), side=_side)
    _def(_P("LowerLeg"), _P("UpperLeg"), "leg" + _S, f"{_sl} shin", primary_child=_P("Foot"), side=_side)
    _def(_P("Foot"), _P("LowerLeg"), "leg" + _S, f"{_sl} foot", primary_child=_P("Toes"), side=_side)
    _def(_P("Toes"), _P("Foot"), "leg" + _S, f"{_sl} toes", tail=(0.0, -0.01, 0.06), side=_side)

BONE_MAP = {b.name: b for b in BONES}
BONE_NAMES = [b.name for b in BONES]
BONE_INDEX = {n: i for i, n in enumerate(BONE_NAMES)}
CHILDREN = {n: [] for n in BONE_NAMES}
for _b in BONES:
    if _b.parent:
        CHILDREN[_b.parent].append(_b.name)

ESSENTIAL = [
    "hips", "spine", "head", "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm",
    "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg",
    "rightLowerLeg", "rightFoot",
]


def missing_bones(mapping):
    """Essential canonical bones that have no target bone (port of retarget.js missingBones)."""
    return [b for b in ESSENTIAL if not mapping.get(b)]


def mirror_name(name):
    if name.startswith("left"):
        return "right" + name[4:]
    if name.startswith("right"):
        return "left" + name[5:]
    return name


def default_rest_world():
    """Rest joint positions (canonical actor space, meters) for the default adult body."""
    out = {}
    for k, v in REST_CENTER.items():
        out[k] = tuple(v)
    for k, v in REST_LEFT.items():
        out["left" + k] = tuple(v)
        out["right" + k] = (-v[0], v[1], v[2])
    return out


BODY_TYPES = {
    "adult": {"label": "Adult", "scale": 1.0, "headScale": 1.0},
    "tall": {"label": "Adult (tall)", "scale": 1.06, "headScale": 1.0},
    "teen": {"label": "Teen", "scale": 0.93, "headScale": 1.04},
    "child": {"label": "Child", "scale": 0.66, "headScale": 1.28},
}


def rest_offsets_from_world(world):
    out = {}
    for b in BONES:
        w = world[b.name]
        if not b.parent:
            out[b.name] = tuple(w)
            continue
        p = world[b.parent]
        out[b.name] = (w[0] - p[0], w[1] - p[1], w[2] - p[2])
    return out


def body_rest_offsets(body_type="adult"):
    """Parent-relative rest offsets for a built-in body type (port of bodyRestOffsets)."""
    bt = BODY_TYPES.get(body_type) or BODY_TYPES["adult"]
    off = rest_offsets_from_world(default_rest_world())
    s = bt["scale"]
    return {k: (v[0] * s, v[1] * s, v[2] * s) for k, v in off.items()}


def body_rest_world(body_type="adult"):
    """World (actor-space) rest positions for a body type, exactly like Actor.restWorld()."""
    off = body_rest_offsets(body_type)
    out = {}
    for b in BONES:
        o = off[b.name]
        if b.parent:
            p = out[b.parent]
            out[b.name] = (p[0] + o[0], p[1] + o[1], p[2] + o[2])
        else:
            out[b.name] = tuple(o)
    return out


# ------------------------------------------------------------------ naming presets

_SEG = {"Proximal": 1, "Intermediate": 2, "Distal": 3}
_FINGER_RE = re.compile(r"^(Thumb|Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$")


def _strip_side(n):
    return re.sub(r"^(left|right)", "", n)


def _vrm(n):
    return n


def _vmc(n):
    return n[0].upper() + n[1:]


def _inzoi_vrm(n):
    center = {"hips": "J_Bip_C_Hips", "spine": "J_Bip_C_Spine", "chest": "J_Bip_C_Chest",
              "upperChest": "J_Bip_C_UpperChest", "neck": "J_Bip_C_Neck", "head": "J_Bip_C_Head"}
    if n in center:
        return center[n]
    side = "L" if n.startswith("left") else "R"
    rest = _strip_side(n)
    m = _FINGER_RE.match(rest)
    if m:
        return f"J_Bip_{side}_{m.group(1)}{_SEG[m.group(2)]}"
    return f"J_Bip_{side}_{'ToeBase' if rest == 'Toes' else rest}"


def _unreal(n):
    center = {"hips": "pelvis", "spine": "spine_01", "chest": "spine_02", "upperChest": "spine_03",
              "neck": "neck_01", "head": "head"}
    if n in center:
        return center[n]
    s = "l" if n.startswith("left") else "r"
    rest = _strip_side(n)
    m = _FINGER_RE.match(rest)
    if m:
        f = "pinky" if m.group(1) == "Little" else m.group(1).lower()
        return f"{f}_0{_SEG[m.group(2)]}_{s}"
    return {"Shoulder": "clavicle", "UpperArm": "upperarm", "LowerArm": "lowerarm", "Hand": "hand",
            "UpperLeg": "thigh", "LowerLeg": "calf", "Foot": "foot", "Toes": "ball"}[rest] + "_" + s


def _mixamo(n):
    center = {"hips": "Hips", "spine": "Spine", "chest": "Spine1", "upperChest": "Spine2",
              "neck": "Neck", "head": "Head"}
    if n in center:
        return "mixamorig:" + center[n]
    side = "Left" if n.startswith("left") else "Right"
    rest = _strip_side(n)
    m = _FINGER_RE.match(rest)
    if m:
        f = "Pinky" if m.group(1) == "Little" else m.group(1)
        return f"mixamorig:{side}Hand{f}{_SEG[m.group(2)]}"
    return "mixamorig:" + side + {"Shoulder": "Shoulder", "UpperArm": "Arm", "LowerArm": "ForeArm",
                                  "Hand": "Hand", "UpperLeg": "UpLeg", "LowerLeg": "Leg", "Foot": "Foot",
                                  "Toes": "ToeBase"}[rest]


#: id -> (label, mapping function, optional extra root bone name)
NAMING = {
    "vrm": ("VRM humanoid (hips, leftUpperArm...)", _vrm, None),
    "vmc": ("Unity / VMC (Hips, LeftUpperArm...)", _vmc, None),
    "inzoiVrm": ("inZOI body tracking (J_Bip_...)", _inzoi_vrm, None),
    "unreal": ("Unreal mannequin (pelvis, upperarm_l...)", _unreal, "root"),
    "mixamo": ("Mixamo (mixamorig:Hips...)", _mixamo, None),
}


def preset_name(preset, canonical):
    return NAMING[preset][1](canonical)
