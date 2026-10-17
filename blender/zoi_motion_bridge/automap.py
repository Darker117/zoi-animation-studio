# SPDX-License-Identifier: MIT
"""Automatic bone mapping (port of autoMap() in studio/js/core/retarget.js).

Pure Python. A skeleton is a list of SkelBone-like objects with the attributes
``i`` (index), ``name``, ``tk`` (tokens), ``parent`` (index or -1) and ``depth``, listed in
depth-first pre-order (the order three.js traverses a hierarchy).
"""

import math
import re

EXCLUDE = {
    "twist", "roll", "ik", "fk", "end", "nub", "tip", "target", "pole", "helper", "corrective", "adj",
    "eye", "jaw", "teeth", "tongue", "bust", "breast", "hair", "skirt", "cloth", "weapon", "prop",
    "attach", "socket", "mch", "org", "ctrl", "ctl", "vb", "sec", "secondary", "top", "headtop",
}
FINGER_WORDS = {
    "Thumb": ["thumb"],
    "Index": ["index", "pointer"],
    "Middle": ["middle", "mid"],
    "Ring": ["ring"],
    "Little": ["pinky", "little", "pinkie"],
}
_FINGER_TOKENS = {"thumb", "index", "middle", "ring", "pinky", "little", "finger", "pinkie"}


def tokens(name):
    base = re.sub(r"^.*[:|]", "", name)
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", base)
    s = re.sub(r"([A-Za-z])(\d)", r"\1 \2", s)
    s = re.sub(r"(\d)([A-Za-z])", r"\1 \2", s)
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def side_of(tk):
    if "left" in tk or "l" in tk or "lf" in tk or "lft" in tk:
        return "left"
    if "right" in tk or "r" in tk or "rt" in tk or "rgt" in tk:
        return "right"
    return None


def is_excluded(tk):
    return any(t in EXCLUDE for t in tk)


def is_finger(tk):
    return any(t in _FINGER_TOKENS for t in tk)


def _js_round(x):
    """JavaScript Math.round (halves round up)."""
    return int(math.floor(x + 0.5))


class SimpleBone:
    """Minimal skeleton entry for auto_map (used for tests and non-Blender callers)."""

    def __init__(self, i, name, parent):
        self.i = i
        self.name = name
        self.tk = tokens(name)
        self.parent = parent
        self.depth = 0


def build_simple_skeleton(names_and_parents):
    """[(name, parent_name or None), ...] -> list of SimpleBone in DFS pre-order."""
    children = {}
    roots = []
    for name, parent in names_and_parents:
        children.setdefault(name, [])
        if parent:
            children.setdefault(parent, []).append(name)
        else:
            roots.append(name)
    order = []
    stack = list(reversed(roots))
    while stack:
        n = stack.pop()
        order.append(n)
        stack.extend(reversed(children.get(n, [])))
    idx = {n: i for i, n in enumerate(order)}
    parent_of = dict(names_and_parents)
    out = []
    for i, n in enumerate(order):
        p = parent_of.get(n)
        b = SimpleBone(i, n, idx[p] if p in idx else -1)
        out.append(b)
    for b in out:
        d, p = 0, b.parent
        while p >= 0:
            d += 1
            p = out[p].parent
        b.depth = d
    return out


def _ancestors(B, i):
    out = []
    p = B[i].parent
    while p >= 0:
        out.append(p)
        p = B[p].parent
    return out


def _path_between(B, top, bottom):
    """Bones strictly below `top` down to and including `bottom` (None when not related)."""
    chain = []
    p = bottom
    while p >= 0 and p != top:
        chain.insert(0, p)
        p = B[p].parent
    return chain if p == top else None


def auto_map(B):
    """Guesses which bone plays each canonical role. Returns {canonical: bone name}."""
    mapping = {}

    def pick(pred):
        c = [b for b in B if pred(b.tk, b) and not is_excluded(b.tk)]
        c.sort(key=lambda b: (b.depth, len(b.name)))  # stable, like Array.prototype.sort
        return c[0] if c else None

    def up(b):
        p = b.parent if b is not None else -1
        while p >= 0 and is_excluded(B[p].tk):
            p = B[p].parent
        return B[p] if p >= 0 else None

    sides = {}
    for side in ("left", "right"):
        hand = pick(lambda tk, b: ("hand" in tk or "wrist" in tk) and not is_finger(tk) and side_of(tk) == side)
        foot = pick(lambda tk, b: ("foot" in tk or "ankle" in tk) and "toe" not in tk and side_of(tk) == side)
        res = {"hand": hand, "foot": foot, "armTop": None, "legTop": None}
        if hand is not None:
            mapping[f"{side}Hand"] = hand.name
            lower = up(hand)
            if lower is not None:
                mapping[f"{side}LowerArm"] = lower.name
            upper = up(lower)
            if upper is not None:
                mapping[f"{side}UpperArm"] = upper.name
            clav = up(upper)
            if clav is not None and any(t in ("clavicle", "shoulder", "collar", "clav") for t in clav.tk):
                mapping[f"{side}Shoulder"] = clav.name
            res["armTop"] = clav if (clav is not None and mapping.get(f"{side}Shoulder")) else upper
            for F, words in FINGER_WORDS.items():
                chain = [b for b in B if any(t in words for t in b.tk) and not is_excluded(b.tk)
                         and hand.i in _ancestors(B, b.i)]
                chain.sort(key=lambda b: b.depth)
                lst = chain
                if len(lst) >= 4 and ("metacarpal" in lst[0].tk or "0" in lst[0].tk or "meta" in lst[0].tk):
                    lst = lst[1:]
                for k, seg in enumerate(("Proximal", "Intermediate", "Distal")):
                    if k < len(lst):
                        mapping[f"{side}{F}{seg}"] = lst[k].name
        if foot is not None:
            mapping[f"{side}Foot"] = foot.name
            lower = up(foot)
            if lower is not None:
                mapping[f"{side}LowerLeg"] = lower.name
            upper = up(lower)
            if upper is not None:
                mapping[f"{side}UpperLeg"] = upper.name
            res["legTop"] = upper
            toe = next((b for b in B if b.parent == foot.i and not is_excluded(b.tk)), None)
            if toe is None:
                toe = next((b for b in B if any(t in ("toe", "toes", "ball") for t in b.tk)
                            and foot.i in _ancestors(B, b.i)), None)
            if toe is not None:
                mapping[f"{side}Toes"] = toe.name
        sides[side] = res

    # Hips: common parent of the thighs (fallback: a bone named hips/pelvis).
    hips = None
    lt, rt = sides["left"]["legTop"], sides["right"]["legTop"]
    if lt is not None and rt is not None and lt.parent == rt.parent and lt.parent >= 0:
        hips = B[lt.parent]
    if hips is None:
        hips = pick(lambda tk, b: "hips" in tk or "pelvis" in tk or "hip" in tk)
    if hips is not None:
        mapping["hips"] = hips.name
    head = pick(lambda tk, b: "head" in tk and "top" not in tk)
    if head is not None:
        mapping["head"] = head.name
    # Spine chain: hips -> parent of the arm chains.
    arm_top = sides["left"]["armTop"] or sides["right"]["armTop"]
    if hips is not None and arm_top is not None and arm_top.parent >= 0:
        chain = _path_between(B, hips.i, arm_top.parent)
        if chain:
            n = len(chain)
            mapping["spine"] = B[chain[0]].name
            if n == 2:
                mapping["chest"] = B[chain[1]].name
            if n >= 3:
                mapping["chest"] = B[chain[_js_round((n - 1) / 2)]].name
                mapping["upperChest"] = B[chain[n - 1]].name
            if head is not None:
                neck_chain = _path_between(B, chain[n - 1], head.i)
                if neck_chain and len(neck_chain) > 1:
                    mapping["neck"] = B[neck_chain[0]].name
    if not mapping.get("neck"):
        neck = pick(lambda tk, b: "neck" in tk)
        if neck is not None:
            mapping["neck"] = neck.name
    return mapping
