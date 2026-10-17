# SPDX-License-Identifier: MIT
"""Retargeting from the canonical Zoi rig onto any skeleton (port of the Retargeter class in
studio/js/core/retarget.js). Uses mathutils (Blender) for the quaternion math.

Math (all rotations in "model space" = the armature space of the target):
  R    maps the target's body frame (left/up/forward from joint positions) onto the canonical one.
  G0   target bone rest rotation; G0' = R * G0 (aligned).
  E    shortest-arc rotation taking the aligned target rest direction (bone -> first mapped child)
       to the canonical rest direction (absorbs T-pose vs A-pose differences).
  W    canonical posed world rotation, W(bone) = W(parent) * q_local.
  canonical -> target:  G = R^-1 * W * E * R * G0 ; local = G_parent^-1 * G
"""

from mathutils import Matrix, Quaternion, Vector

from .rig import BONES, BONE_MAP

EPSILON = 2.220446049250313e-16  # JavaScript Number.EPSILON

QI = Quaternion((1.0, 0.0, 0.0, 0.0))


def q_from_unit_vectors(v_from, v_to):
    """Exact port of THREE.Quaternion.setFromUnitVectors (inputs must be unit length)."""
    r = v_from.dot(v_to) + 1
    if r < EPSILON:
        r = 0.0
        if abs(v_from.x) > abs(v_from.z):
            x, y, z, w = -v_from.y, v_from.x, 0.0, r
        else:
            x, y, z, w = 0.0, -v_from.z, v_from.y, r
    else:
        x = v_from.y * v_to.z - v_from.z * v_to.y
        y = v_from.z * v_to.x - v_from.x * v_to.z
        z = v_from.x * v_to.y - v_from.y * v_to.x
        w = r
    q = Quaternion((w, x, y, z))
    q.normalize()
    return q


def body_frame(P):
    """Body frame from joint positions: columns (left, up, forward). P(name) -> Vector or None."""
    left = None
    if P("leftUpperLeg") is not None and P("rightUpperLeg") is not None:
        left = P("leftUpperLeg") - P("rightUpperLeg")
    elif P("leftUpperArm") is not None and P("rightUpperArm") is not None:
        left = P("leftUpperArm") - P("rightUpperArm")
    top = None
    for n in ("head", "neck", "upperChest", "chest"):
        if P(n) is not None:
            top = P(n)
            break
    up = (top - P("hips")) if (top is not None and P("hips") is not None) else None
    if left is None or left.length_squared < 1e-12:
        left = Vector((1.0, 0.0, 0.0))
    if up is None or up.length_squared < 1e-12:
        up = Vector((0.0, 1.0, 0.0))
    left = left.normalized()
    up = up - left * up.dot(left)
    up.normalize()
    fwd = left.cross(up)
    fwd.normalize()
    m = Matrix((left, up, fwd)).transposed()  # rows -> columns
    return m.to_quaternion()


def leg_length(P):
    n = 0
    total = 0.0
    for s in ("left", "right"):
        a, b, c = P(s + "UpperLeg"), P(s + "LowerLeg"), P(s + "Foot")
        if a is not None and b is not None and c is not None:
            total += (a - b).length + (b - c).length
            n += 1
    if n:
        return total / n
    h, hd = P("hips"), P("head")
    return (h - hd).length * 1.6 if (h is not None and hd is not None) else 1.0


class TargetBone:
    """One bone of the target skeleton, in depth-first pre-order."""

    __slots__ = ("i", "name", "tk", "parent", "depth", "children", "head", "rest_q", "rest_local_q")

    def __init__(self, i, name, tk, parent, head, rest_q, rest_local_q):
        self.i = i
        self.name = name
        self.tk = tk
        self.parent = parent
        self.depth = 0
        self.children = []
        self.head = head            # rest head position, armature space (Vector)
        self.rest_q = rest_q        # rest rotation, armature space (G0)
        self.rest_local_q = rest_local_q  # rest rotation relative to the parent bone


class Retargeter:
    def __init__(self, bones, mapping, rest_world):
        """bones: [TargetBone] in pre-order; mapping: {canonical: target bone name};
        rest_world: canonical rest joint positions {name: (x, y, z)} for the actor's body type."""
        self.bones = bones
        by_name = {b.name: b for b in bones}
        self.canon_to_idx = {}
        for c, n in mapping.items():
            b = by_name.get(n) if n else None
            if b is not None and c in BONE_MAP:
                self.canon_to_idx[c] = b.i
        self.idx_to_canon = {i: c for c, i in self.canon_to_idx.items()}

        restW = {k: Vector(v) for k, v in rest_world.items()}
        self.restW = restW
        P = self._p
        self.frame_other = body_frame(P)
        self.frame_canon = body_frame(lambda c: restW.get(c))
        self.R = self.frame_canon @ self.frame_other.inverted()
        self.Rinv = self.R.inverted()
        leg = leg_length(P)
        self.leg_len_raw = leg
        self.unit = 0.01 if leg > 20 else 0.1 if leg > 3 else 1.0
        self.leg_len = leg * self.unit
        self.rest_aligned_pos = [(self.R @ b.head) * self.unit for b in bones]
        self.rest_aligned_q = [self.R @ b.rest_q for b in bones]
        hi = self.canon_to_idx.get("hips")
        self.absolute_hips = hi is not None and abs(self.rest_aligned_pos[hi].y) < 0.3 * self.leg_len

        # Per-bone rest alignment (bindActor).
        E = {}
        for bd in BONES:
            c = bd.name
            i = self.canon_to_idx.get(c)
            e = None
            if c == "hips":
                e = QI.copy()
            elif i is not None and bd.primary_child:
                child = bd.primary_child
                while child and self.canon_to_idx.get(child) is None:
                    child = BONE_MAP[child].primary_child
                if child:
                    dO = self.rest_aligned_pos[self.canon_to_idx[child]] - self.rest_aligned_pos[i]
                    dc = restW[child] - restW[c]
                    if dO.length_squared > 1e-12 and dc.length_squared > 1e-12:
                        e = q_from_unit_vectors(dO.normalized(), dc.normalized())
            if e is None:
                if bd.parent and bd.parent in E and c not in ("hips", "spine", "head", "neck"):
                    e = E[bd.parent].copy()
                else:
                    e = QI.copy()
            E[c] = e
        self.E = E
        self.actor_leg_len = leg_length(lambda c: restW.get(c))
        self.actor_hips_rest = restW["hips"].copy()
        # G = Rinv * W * K  with  K = E * R * G0 (constant per mapped bone)
        self.K = {i: E[c] @ self.rest_aligned_q[i] for c, i in self.canon_to_idx.items()}
        # Bones whose pose must be evaluated: mapped bones and all their ancestors.
        needed = set()
        for i in self.canon_to_idx.values():
            p = i
            while p >= 0 and p not in needed:
                needed.add(p)
                p = bones[p].parent
        self.needed = sorted(needed)
        self.rest_local_inv = {i: bones[i].rest_local_q.inverted() for i in self.needed}

    def _p(self, c):
        i = self.canon_to_idx.get(c)
        return None if i is None else self.bones[i].head

    @staticmethod
    def canonical_world(quat):
        """{bone: (x,y,z,w)} local canonical rotations -> {bone: Quaternion} world rotations."""
        W = {}
        for bd in BONES:
            x, y, z, w = quat[bd.name]
            q = Quaternion((w, x, y, z))
            W[bd.name] = (W[bd.parent] @ q) if bd.parent else q
        return W

    def drive(self, W, hips_pos):
        """Poses the target from canonical world rotations W and the canonical hips position.

        Returns ({bone index: basis Quaternion}, hips basis location Vector or None) where the
        basis values are Blender pose-bone channels (relative to the bone's rest pose)."""
        bones = self.bones
        G = {}
        basis = {}
        for i in self.needed:
            b = bones[i]
            parent_g = G.get(b.parent, QI) if b.parent >= 0 else QI
            c = self.idx_to_canon.get(i)
            if c is not None:
                g = self.Rinv @ W[c] @ self.K[i]
                G[i] = g
                local = parent_g.inverted() @ g
                basis[i] = self.rest_local_inv[i] @ local
            else:
                G[i] = parent_g @ b.rest_local_q
        loc = None
        hi = self.canon_to_idx.get("hips")
        if hi is not None and hips_pos is not None:
            k = self.leg_len / self.actor_leg_len
            hp = Vector(hips_pos)
            if self.absolute_hips:
                model_pos = (self.Rinv @ (hp * k)) / self.unit
            else:
                model_pos = (self.Rinv @ ((hp - self.actor_hips_rest) * k)) / self.unit + bones[hi].head
            # Expressed relative to the hips' own rest frame (its parents stay at rest).
            loc = bones[hi].rest_q.inverted() @ (model_pos - bones[hi].head)
        return basis, loc
