# SPDX-License-Identifier: MIT
"""Keyframed clips and .zmotion projects (port of studio/js/core/clip.js + project.js).

Pure Python: no bpy / mathutils imports.

A key is (frame, value tuple, ease). Rotation values are LOCAL quaternions [x, y, z, w] of the
canonical rig, positions are [x, y, z] (meters, actor space, hips only). The ease applies to the
segment that LEAVES the key.
"""

import json
import math

from .rig import BONES, body_rest_world

EPSILON = 2.220446049250313e-16  # JavaScript Number.EPSILON

# ------------------------------------------------------------------ easing (math.js EASINGS)


def _ease_in_out(t):
    return 4 * t * t * t if t < 0.5 else 1 - math.pow(-2 * t + 2, 3) / 2


def _back(t):
    c1 = 1.70158
    c3 = c1 + 1
    return 1 + c3 * math.pow(t - 1, 3) + c1 * math.pow(t - 1, 2)


EASINGS = {
    "auto": lambda t: t,
    "linear": lambda t: t,
    "easeInOut": _ease_in_out,
    "easeIn": lambda t: t * t * t,
    "easeOut": lambda t: 1 - math.pow(1 - t, 3),
    "back": _back,
    "step": lambda t: 0,
}

# ------------------------------------------------------------------ quaternion helpers ([x,y,z,w])


def q_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]


def q_normalize(q):
    n = math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) or 1.0
    return (q[0] / n, q[1] / n, q[2] / n, q[3] / n)


def q_align(a, b):
    """b flipped onto the same hemisphere as a."""
    return (-b[0], -b[1], -b[2], -b[3]) if q_dot(a, b) < 0 else b


def q_equals(a, b, eps=1e-5):
    return abs(abs(q_dot(a, b)) - 1) < eps


def v_equals(a, b, eps=1e-6):
    return abs(a[0] - b[0]) < eps and abs(a[1] - b[1]) < eps and abs(a[2] - b[2]) < eps


def q_slerp(a, b, t):
    """Exact port of THREE.Quaternion.slerp (a.slerp(b, t))."""
    if t == 0:
        return tuple(a)
    if t == 1:
        return tuple(b)
    x, y, z, w = a
    cos_half = w * b[3] + x * b[0] + y * b[1] + z * b[2]
    if cos_half < 0:
        bx, by, bz, bw = -b[0], -b[1], -b[2], -b[3]
        cos_half = -cos_half
    else:
        bx, by, bz, bw = b
    if cos_half >= 1.0:
        return (x, y, z, w)
    sqr_sin = 1.0 - cos_half * cos_half
    if sqr_sin <= EPSILON:
        s = 1 - t
        return q_normalize((s * x + t * bx, s * y + t * by, s * z + t * bz, s * w + t * bw))
    sin_half = math.sqrt(sqr_sin)
    half = math.atan2(sin_half, cos_half)
    ra = math.sin((1 - t) * half) / sin_half
    rb = math.sin(t * half) / sin_half
    return (x * ra + bx * rb, y * ra + by * rb, z * ra + bz * rb, w * ra + bw * rb)


def lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------ clip


class Key:
    __slots__ = ("f", "v", "e")

    def __init__(self, f, v, e="auto"):
        self.f = f
        self.v = tuple(v)
        self.e = e or "auto"


class Clip:
    def __init__(self, name="New animation", fps=30, frames=60, loop=False):
        self.name = name
        self.fps = fps
        self.frames = frames
        self.loop = loop
        self.tracks = {}  # bone -> {'rot': [Key], 'pos': [Key]}
        self.expr = {}
        self.markers = []

    @property
    def duration(self):
        return self.frames / self.fps

    @staticmethod
    def from_json(j):
        c = Clip(name=j.get("name", "animation"), fps=j.get("fps", 30), frames=j.get("frames", 60),
                 loop=bool(j.get("loop", False)))

        def parse(arr, n):
            keys = []
            for a in arr or []:
                e = a[1 + n] if len(a) > 1 + n else None
                keys.append(Key(a[0], [float(x) for x in a[1:1 + n]], e or "auto"))
            keys.sort(key=lambda k: k.f)  # stable; files written by the studio are sorted already
            return keys

        for bone, t in (j.get("tracks") or {}).items():
            rot = parse(t.get("rot"), 4)
            pos = parse(t.get("pos"), 3)
            if rot or pos:
                c.tracks[bone] = {"rot": rot, "pos": pos}
        for n, keys in (j.get("expr") or {}).items():
            c.expr[n] = parse(keys, 1)
        c.markers = [dict(m) for m in (j.get("markers") or [])]
        return c

    def is_empty(self):
        return not self.tracks and not self.expr

    def key_frames(self, bones=None, channels=("rot", "pos")):
        s = set()
        for b in (bones if bones is not None else list(self.tracks.keys())):
            t = self.tracks.get(b)
            if not t:
                continue
            for ch in channels:
                for k in t.get(ch) or []:
                    s.add(k.f)
        return sorted(s)

    def key_at(self, bone, ch, f):
        t = self.tracks.get(bone)
        if not t:
            return None
        for k in t[ch]:
            if k.f == f:
                return k
        return None

    # -------------------------------------------------------------- sampling (exact port)

    def _neighbors(self, keys, i):
        n = len(keys)
        k0 = keys[i - 1] if i - 1 >= 0 else None
        k3 = keys[i + 2] if i + 2 < n else None
        # Seamless loops: when the clip loops and both ends are keyed, tangents wrap around.
        if self.loop and n > 2 and keys[0].f == 0 and keys[n - 1].f == self.frames:
            if k0 is None and i == 0:
                k0 = Key(keys[n - 2].f - self.frames, keys[n - 2].v)
            if k3 is None and i + 2 == n:
                k3 = Key(keys[1].f + self.frames, keys[1].v)
        return k0, k3

    def _sample_keys(self, keys, f, is_quat):
        n = len(keys)
        if not n:
            return None
        if n == 1 or f <= keys[0].f:
            return keys[0].v
        if f >= keys[n - 1].f:
            return keys[n - 1].v
        lo, hi = 0, n - 1
        while hi - lo > 1:
            mid = (lo + hi) >> 1
            if keys[mid].f <= f:
                lo = mid
            else:
                hi = mid
        k1, k2 = keys[lo], keys[hi]
        t = (f - k1.f) / (k2.f - k1.f)
        e = k1.e or "auto"
        if e == "step":
            return k1.v
        v1 = k1.v
        v2 = q_align(v1, k2.v) if is_quat else k2.v
        if e != "auto":
            te = EASINGS.get(e, EASINGS["linear"])(t)
            if is_quat:
                return q_slerp(v1, v2, te)
            return tuple(lerp(x, v2[i], te) for i, x in enumerate(v1))
        if (q_equals(v1, v2) if is_quat else v_equals(v1, v2)):
            return v1
        # Auto: clamped cubic Hermite through the neighbouring keys.
        k0, k3 = self._neighbors(keys, lo)
        v0 = (q_align(v1, k0.v) if is_quat else k0.v) if k0 else None
        v3 = (q_align(v2, k3.v) if is_quat else k3.v) if k3 else None
        dt = k2.f - k1.f
        dim = len(v1)
        m1 = [0.0] * dim
        m2 = [0.0] * dim
        for c in range(dim):
            if v0 is not None:
                a = v1[c] - v0[c]
                b = v2[c] - v1[c]
                m1[c] = 0.0 if a * b <= 0 else ((v2[c] - v0[c]) / (k2.f - k0.f)) * dt
            if v3 is not None:
                a = v2[c] - v1[c]
                b = v3[c] - v2[c]
                m2[c] = 0.0 if a * b <= 0 else ((v3[c] - v1[c]) / (k3.f - k1.f)) * dt
        t2 = t * t
        t3 = t2 * t
        h00 = 2 * t3 - 3 * t2 + 1
        h10 = t3 - 2 * t2 + t
        h01 = -2 * t3 + 3 * t2
        h11 = t3 - t2
        out = tuple(h00 * v1[c] + h10 * m1[c] + h01 * v2[c] + h11 * m2[c] for c in range(dim))
        return q_normalize(out) if is_quat else out

    def sample_rot(self, bone, f):
        t = self.tracks.get(bone)
        return self._sample_keys(t["rot"], f, True) if t and t["rot"] else None

    def sample_pos(self, bone, f):
        t = self.tracks.get(bone)
        return self._sample_keys(t["pos"], f, False) if t and t["pos"] else None

    def sample_pose(self, f):
        """{'rot': {bone: q}, 'pos': {bone: v}} at frame f (fractional frames are fine)."""
        pose = {"rot": {}, "pos": {}}
        for bone, t in self.tracks.items():
            if t["rot"]:
                pose["rot"][bone] = self._sample_keys(t["rot"], f, True)
            if t["pos"]:
                pose["pos"][bone] = self._sample_keys(t["pos"], f, False)
        return pose


IDENTITY = (0.0, 0.0, 0.0, 1.0)


def canonical_frame(clip, f, rest_hips, root_motion="KEEP"):
    """One baked canonical frame (port of export.js bakeCanonical for a single frame).

    Returns (quat dict for all 52 bones, hips position)."""
    pose = clip.sample_pose(f)
    quat = {b.name: pose["rot"].get(b.name) or IDENTITY for b in BONES}
    hp = pose["pos"].get("hips")
    hips = list(hp) if hp else [rest_hips[0], rest_hips[1], rest_hips[2]]
    if root_motion == "IN_PLACE":
        hips[0] = rest_hips[0]
        hips[2] = rest_hips[2]
    return quat, tuple(hips)


# ------------------------------------------------------------------ project


class ProjectError(Exception):
    pass


def load_project(path):
    with open(path, "r", encoding="utf-8") as fh:
        try:
            j = json.load(fh)
        except ValueError as ex:
            raise ProjectError(f"Not a valid .zmotion file (JSON error: {ex})")
    return project_from_json(j)


def project_from_json(j):
    if not isinstance(j, dict) or j.get("format") != "zoi-motion-project":
        raise ProjectError("This is not a Studio project file.")
    pack = {"id": "mypack", "name": "Pack", "author": "", "version": "1.0.0", "description": ""}
    pack.update(j.get("pack") or {})
    scenes = []
    for s in j.get("scenes") or []:
        actors = []
        for a in s.get("actors") or []:
            off = {"x": 0, "z": 0, "yaw": 0}
            off.update(a.get("offset") or {})
            a2 = dict(a)
            a2["offset"] = off
            a2.setdefault("bodyType", "adult")
            a2.setdefault("name", "Zoi")
            actors.append(a2)
        stages = []
        for st in s.get("stages") or []:
            stage = {"loopCount": 1}
            stage.update({k: v for k, v in st.items() if k != "clips"})
            stage.setdefault("name", "Stage")
            stage.setdefault("frames", 60)
            stage.setdefault("fps", 30)
            stage.setdefault("loop", False)
            stage["clips"] = {k: Clip.from_json(c) for k, c in (st.get("clips") or {}).items()}
            stages.append(stage)
        s2 = dict(s)
        s2["actors"] = actors
        s2["stages"] = stages
        s2.setdefault("name", "Scene")
        scenes.append(s2)
    return {"format": j["format"], "version": j.get("version", 1), "pack": pack, "scenes": scenes}


def stage_clip(stage, actor, scene_name=""):
    """The clip of `actor` in `stage` (an empty rest-pose clip when the actor has none)."""
    c = stage["clips"].get(actor["id"])
    if c is None:
        c = Clip(name=f"{scene_name} - {actor.get('name', '')}", fps=stage.get("fps", 30),
                 frames=stage.get("frames", 60), loop=bool(stage.get("loop")))
    return c


def actor_rest_world(actor):
    return body_rest_world(actor.get("bodyType") or "adult")
