# SPDX-License-Identifier: MIT
"""Blender side: armature description, auto mapping, baking a .zmotion clip into an Action,
and the ModKit FBX export."""

import math

import bpy
from mathutils import Quaternion, Vector

from . import automap
from .clip import IDENTITY, actor_rest_world, canonical_frame, stage_clip
from .retarget import Retargeter, TargetBone
from .rig import BONE_NAMES, BONES, NAMING, ESSENTIAL

# ------------------------------------------------------------------ armature helpers


def find_armature(context):
    """Active armature, or the armature that deforms / parents the active object."""
    ob = context.active_object if context else None
    if ob is None:
        return None
    if ob.type == "ARMATURE":
        return ob
    if ob.parent is not None and ob.parent.type == "ARMATURE":
        return ob.parent
    for m in getattr(ob, "modifiers", []):
        if m.type == "ARMATURE" and m.object is not None:
            return m.object
    return None


def describe_armature(arm_obj):
    """Bones of an armature (rest pose, armature space) in depth-first pre-order."""
    arm = arm_obj.data
    order = []
    stack = [b for b in reversed(arm.bones) if b.parent is None]
    while stack:
        b = stack.pop()
        order.append(b)
        stack.extend(reversed(list(b.children)))
    idx = {b.name: i for i, b in enumerate(order)}
    out = []
    for i, b in enumerate(order):
        m = b.matrix_local
        rest_q = m.to_quaternion()
        if b.parent is not None:
            rest_local_q = (b.parent.matrix_local.inverted() @ m).to_quaternion()
            parent = idx[b.parent.name]
        else:
            rest_local_q = rest_q.copy()
            parent = -1
        tb = TargetBone(i, b.name, automap.tokens(b.name), parent, b.head_local.copy(), rest_q, rest_local_q)
        out.append(tb)
    for tb in out:
        if tb.parent >= 0:
            out[tb.parent].children.append(tb.i)
        d, p = 0, tb.parent
        while p >= 0:
            d += 1
            p = out[p].parent
        tb.depth = d
    return out


def auto_map_armature(arm_obj):
    return automap.auto_map(describe_armature(arm_obj))


def _base(n):
    return n.rsplit(":", 1)[-1].rsplit("|", 1)[-1].lower()


def naming_preset_mapping(arm_obj, preset):
    """Mapping from a naming preset; tolerant to case and namespaces (mixamorig1: etc.)."""
    fn = NAMING[preset][1]
    names = [b.name for b in arm_obj.data.bones]
    exact = set(names)
    lower = {}
    base = {}
    for n in names:
        lower.setdefault(n.lower(), n)
        base.setdefault(_base(n), n)
    out = {}
    for c in BONE_NAMES:
        want = fn(c)
        if want in exact:
            out[c] = want
        elif want.lower() in lower:
            out[c] = lower[want.lower()]
        elif _base(want) in base:
            out[c] = base[_base(want)]
    return out


def get_mapping(arm_obj):
    """{canonical: target bone} from the mapping stored on the armature object (BONES order)."""
    stored = {it.canonical: it.target for it in arm_obj.zoi_bone_map}
    return {c: stored[c] for c in BONE_NAMES if stored.get(c)}


def set_mapping(arm_obj, mapping):
    coll = arm_obj.zoi_bone_map
    coll.clear()
    for c in BONE_NAMES:
        it = coll.add()
        it.canonical = c
        it.target = mapping.get(c, "") or ""


def ensure_mapping_items(arm_obj):
    if len(arm_obj.zoi_bone_map) != len(BONE_NAMES) or \
            [it.canonical for it in arm_obj.zoi_bone_map] != BONE_NAMES:
        set_mapping(arm_obj, get_mapping(arm_obj) if len(arm_obj.zoi_bone_map) else {})


def mapping_problems(arm_obj, mapping):
    names = set(arm_obj.data.bones.keys())
    missing = [c for c in ESSENTIAL if not mapping.get(c)]
    invalid = [c for c, n in mapping.items() if n and n not in names]
    return missing, invalid


# ------------------------------------------------------------------ action / fcurve helpers


def action_fcurves(action):
    """All F-Curves of an action (legacy and layered/slotted actions)."""
    if action is None:
        return []
    out = []
    layers = getattr(action, "layers", None)
    if layers is not None and len(layers):
        for layer in layers:
            for strip in layer.strips:
                for cb in getattr(strip, "channelbags", []):
                    out.extend(cb.fcurves)
        return out
    fcs = getattr(action, "fcurves", None)
    return list(fcs) if fcs is not None else out


def _new_fcurve(action, obj, data_path, index, group):
    if hasattr(action, "fcurve_ensure_for_datablock"):  # Blender 4.4+
        return action.fcurve_ensure_for_datablock(obj, data_path, index=index, group_name=group)
    fc = action.fcurves.find(data_path, index=index)
    if fc is None:
        fc = action.fcurves.new(data_path, index=index, action_group=group)
    return fc


_INTERP = None


def _interp_value(name):
    global _INTERP
    if _INTERP is None:
        items = bpy.types.Keyframe.bl_rna.properties["interpolation"].enum_items
        _INTERP = {it.identifier: it.value for it in items}
    return _INTERP[name]


_EASE_TO_BLENDER = {
    # studio ease -> (interpolation, easing)
    "auto": ("BEZIER", None),
    "linear": ("LINEAR", None),
    "step": ("CONSTANT", None),
    "easeIn": ("CUBIC", "EASE_IN"),
    "easeOut": ("CUBIC", "EASE_OUT"),
    "easeInOut": ("CUBIC", "EASE_IN_OUT"),
    "back": ("BACK", "EASE_OUT"),
}


def _write_fcurve(fc, frames, values, interps=None, linear=False):
    kps = fc.keyframe_points
    while len(kps):
        kps.remove(kps[len(kps) - 1], fast=True)
    n = len(frames)
    kps.add(n)
    co = [0.0] * (2 * n)
    co[0::2] = frames
    co[1::2] = values
    kps.foreach_set("co", co)
    if interps is None:
        mode = "LINEAR" if linear else "BEZIER"
        try:
            kps.foreach_set("interpolation", [_interp_value(mode)] * n)
        except Exception:
            for k in kps:
                k.interpolation = mode
    else:
        for k, (ip, easing) in zip(kps, interps):
            k.interpolation = ip
            if easing:
                k.easing = easing
            k.handle_left_type = "AUTO_CLAMPED"
            k.handle_right_type = "AUTO_CLAMPED"
    fc.update()


# ------------------------------------------------------------------ baking


class BakeOptions:
    def __init__(self, frame_offset=0, bake_every_frame=True, root_motion="KEEP", apply_placement=False,
                 reset_unmapped=True, set_scene=True, overwrite=True, action_name=None):
        self.frame_offset = frame_offset
        self.bake_every_frame = bake_every_frame
        self.root_motion = root_motion
        self.apply_placement = apply_placement
        self.reset_unmapped = reset_unmapped
        self.set_scene = set_scene
        self.overwrite = overwrite
        self.action_name = action_name


def _placement(actor):
    off = actor.get("offset") or {}
    yaw = math.radians(float(off.get("yaw") or 0.0))
    q = Quaternion((0.0, 1.0, 0.0), yaw)  # rotation about canonical +Y (up)
    return q, Vector((float(off.get("x") or 0.0), 0.0, float(off.get("z") or 0.0)))


def build_segments(scene, stage_sel, actor):
    """[(clip, stage)] for one stage or all stages in sequence."""
    stages = scene["stages"]
    if stage_sel == "ALL":
        chosen = stages
    else:
        chosen = [stages[int(stage_sel)]]
    return [(stage_clip(st, actor, scene.get("name", "")), st) for st in chosen]


def action_name_for(scene, stage_sel, actor):
    stage_name = "All" if stage_sel == "ALL" else scene["stages"][int(stage_sel)].get("name", "Stage")
    return f"{scene.get('name', 'Scene')}_{stage_name}_{actor.get('name', 'Zoi')}"


def bake_to_action(context, arm_obj, project, scene_index, stage_sel, actor_index, mapping, opts):
    """Retargets the chosen clip(s) onto `arm_obj` and writes a new Action.

    Studio frame f of the first segment lands on Blender frame (opts.frame_offset + f).
    With several stages, each stage starts on the frame where the previous one ends."""
    scene = project["scenes"][scene_index]
    actor = scene["actors"][actor_index]
    segments = build_segments(scene, stage_sel, actor)
    if not segments:
        raise ValueError("The chosen scene has no stages.")
    rest_world = actor_rest_world(actor)
    tbones = describe_armature(arm_obj)
    rt = Retargeter(tbones, mapping, rest_world)
    if not rt.canon_to_idx:
        raise ValueError("No bones are mapped. Run Auto-map or pick bones in Bone Mapping.")
    rest_hips = rest_world["hips"]
    place_q, place_t = _placement(actor) if opts.apply_placement else (None, None)
    fps0 = segments[0][0].fps or 30

    # ---- which (blender frame, clip, studio frame) samples to evaluate
    samples = []  # (blender_frame, clip, studio_frame, segment index)
    start = 0.0
    for si, (clip, st) in enumerate(segments):
        scale = fps0 / float(clip.fps or fps0)  # blender frames per studio frame
        if opts.bake_every_frame:
            n = int(round(clip.frames * scale))
            fr = [(start + j, j / scale) for j in range(n + 1)]
        else:
            kf = set(clip.key_frames())
            kf.update((0, clip.frames))
            fr = [(start + f * scale, f) for f in sorted(kf) if 0 <= f <= clip.frames]
        for bf, sf in fr:
            samples.append((bf, clip, sf, si))
        start += clip.frames * scale
    # Later segments overwrite the shared boundary frame of the previous one.
    by_frame = {}
    for s in samples:
        by_frame[round(s[0], 6)] = s
    samples = [by_frame[k] for k in sorted(by_frame)]

    # ---- evaluate
    pbones = arm_obj.pose.bones
    mapped = sorted(rt.idx_to_canon.keys())
    hips_idx = rt.canon_to_idx.get("hips")
    hips_pb = pbones.get(tbones[hips_idx].name) if hips_idx is not None else None
    can_move_hips = hips_pb is not None and not hips_pb.bone.use_connect
    rot_vals = {i: [] for i in mapped}
    loc_vals = []
    frames = []
    eases = []
    for bf, clip, sf, si in samples:
        quat, hips = canonical_frame(clip, sf, rest_hips, opts.root_motion)
        W = Retargeter.canonical_world(quat)
        if place_q is not None:
            for k in W:
                W[k] = place_q @ W[k]
            hips = tuple(place_q @ Vector(hips) + place_t)
        basis, loc = rt.drive(W, hips)
        frames.append(opts.frame_offset + bf)
        for i in mapped:
            rot_vals[i].append(basis[i])
        loc_vals.append(loc)
        if not opts.bake_every_frame:
            eases.append((clip, sf))

    # ---- action
    name = opts.action_name or action_name_for(scene, stage_sel, actor)
    old = bpy.data.actions.get(name) if opts.overwrite else None
    if old is not None:
        # Replace the previous result only when nothing else (another rig, NLA strip) uses it.
        own = 1 if (arm_obj.animation_data and arm_obj.animation_data.action == old) else 0
        if old.users - (1 if old.use_fake_user else 0) - own <= 0:
            if own:
                arm_obj.animation_data.action = None
            bpy.data.actions.remove(old)
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    ad = arm_obj.animation_data or arm_obj.animation_data_create()
    ad.action = action

    if opts.reset_unmapped:
        for pb in pbones:
            pb.location = (0.0, 0.0, 0.0)
            pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
            pb.rotation_euler = (0.0, 0.0, 0.0)
            pb.rotation_axis_angle = (0.0, 0.0, 1.0, 0.0)
            pb.scale = (1.0, 1.0, 1.0)

    def interps_for(canon):
        if opts.bake_every_frame:
            return None
        out = []
        for clip, sf in eases:
            k = clip.key_at(canon, "rot", sf) if canon else None
            if k is None and canon == "hips":
                k = clip.key_at("hips", "pos", sf)
            e = k.e if k is not None else "auto"
            out.append(_EASE_TO_BLENDER.get(e, ("BEZIER", None)))
        return out

    for i in mapped:
        tb = tbones[i]
        pb = pbones.get(tb.name)
        if pb is None:
            continue
        canon = rt.idx_to_canon[i]
        group = tb.name
        dp = f'pose.bones["{_escape(tb.name)}"]'
        interps = interps_for(canon)
        mode = pb.rotation_mode
        qs = rot_vals[i]
        if mode == "QUATERNION":
            prev = None
            chans = [[], [], [], []]
            for q in qs:
                q = q.copy()
                if prev is not None and prev.dot(q) < 0:
                    q.negate()
                prev = q
                for c in range(4):
                    chans[c].append(q[c])
            for c in range(4):
                _write_fcurve(_new_fcurve(action, arm_obj, dp + ".rotation_quaternion", c, group),
                              frames, chans[c], interps, linear=opts.bake_every_frame)
        elif mode == "AXIS_ANGLE":
            chans = [[], [], [], []]
            prev = None
            for q in qs:
                q = q.copy()
                if prev is not None and prev.dot(q) < 0:
                    q.negate()
                prev = q
                axis, angle = q.to_axis_angle()
                for c, v in enumerate((angle, axis.x, axis.y, axis.z)):
                    chans[c].append(v)
            for c in range(4):
                _write_fcurve(_new_fcurve(action, arm_obj, dp + ".rotation_axis_angle", c, group),
                              frames, chans[c], interps, linear=opts.bake_every_frame)
        else:
            chans = [[], [], []]
            prev = None
            for q in qs:
                e = q.to_euler(mode, prev) if prev is not None else q.to_euler(mode)
                prev = e
                for c in range(3):
                    chans[c].append(e[c])
            for c in range(3):
                _write_fcurve(_new_fcurve(action, arm_obj, dp + ".rotation_euler", c, group),
                              frames, chans[c], interps, linear=opts.bake_every_frame)
        if i == hips_idx and can_move_hips and loc_vals and loc_vals[0] is not None:
            for c in range(3):
                _write_fcurve(_new_fcurve(action, arm_obj, dp + ".location", c, group),
                              frames, [v[c] for v in loc_vals], interps, linear=opts.bake_every_frame)

    sc = context.scene
    first = int(math.floor(frames[0]))
    last = int(math.ceil(frames[-1]))
    if opts.set_scene:
        if abs(fps0 - round(fps0)) < 1e-6:
            sc.render.fps = int(round(fps0))
            sc.render.fps_base = 1.0
        else:
            sc.render.fps = int(math.ceil(fps0))
            sc.render.fps_base = sc.render.fps / fps0
        sc.frame_start = first
        sc.frame_end = last
    try:
        action.use_frame_range = True
        action.frame_start = first
        action.frame_end = last
    except Exception:
        pass
    info = {
        "action": action,
        "frames": (first, last),
        "fps": fps0,
        "mapped": len(rt.canon_to_idx),
        "unit": rt.unit,
        "loop": bool(segments[-1][0].loop),
        "hips_moved": can_move_hips,
    }
    return info


def _escape(name):
    return name.replace("\\", "\\\\").replace('"', '\\"')


# ------------------------------------------------------------------ canonical rig builder


def canon_to_blender(v):
    """Canonical (Y-up, faces +Z) -> Blender (Z-up, faces -Y): (x, y, z) -> (x, -z, y)."""
    return Vector((v[0], -v[2], v[1]))


def blender_to_canon(v):
    return Vector((v[0], v[2], -v[1]))


def create_zoi_rig(context, body_type="adult", naming="vrm", name="ZoiRig"):
    """Builds the canonical 52-bone Zoi skeleton (meters, Z-up, facing -Y) and maps it."""
    from .rig import body_rest_world, BODY_TYPES
    rest = body_rest_world(body_type)
    s = (BODY_TYPES.get(body_type) or BODY_TYPES["adult"])["scale"]
    fn = NAMING[naming][1]
    arm = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, arm)
    context.collection.objects.link(obj)
    for o in context.view_layer.objects:
        o.select_set(False)
    context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    for bd in BONES:
        eb = arm.edit_bones.new(fn(bd.name))
        head = canon_to_blender(rest[bd.name])
        if bd.primary_child:
            tail = canon_to_blender(rest[bd.primary_child])
        else:
            t = bd.tail or (0.0, 0.05, 0.0)
            tail = head + canon_to_blender((t[0] * s, t[1] * s, t[2] * s))
        if (tail - head).length < 1e-4:
            tail = head + Vector((0.0, 0.0, 0.02))
        eb.head = head
        eb.tail = tail
        eb.roll = 0.0
        eb.use_connect = False
        if bd.parent:
            eb.parent = ebs[bd.parent]
        ebs[bd.name] = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    set_mapping(obj, {c: fn(c) for c in BONE_NAMES})
    return obj


# ------------------------------------------------------------------ export


def export_modkit_fbx(context, arm_obj, filepath, include_meshes=False, deform_only=True,
                      rename_to_armature=True, use_action_range=True):
    """Exports the armature (+ optional child meshes) with its current action for the inZOI ModKit."""
    view_layer = context.view_layer
    prev_sel = [o for o in view_layer.objects if o.select_get()]
    prev_active = view_layer.objects.active
    sc = context.scene
    prev_range = (sc.frame_start, sc.frame_end)
    renamed = []
    try:
        for o in view_layer.objects:
            o.select_set(False)
        arm_obj.select_set(True)
        types = {"ARMATURE"}
        if include_meshes:
            types.add("MESH")
            for o in view_layer.objects:
                if o.type == "MESH" and (o.parent == arm_obj or any(
                        m.type == "ARMATURE" and m.object == arm_obj for m in o.modifiers)):
                    o.select_set(True)
        view_layer.objects.active = arm_obj
        ad = arm_obj.animation_data
        if use_action_range and ad and ad.action:
            fr = ad.action.frame_range
            sc.frame_start = int(math.floor(fr[0]))
            sc.frame_end = int(math.ceil(fr[1]))
        # Unreal treats a top node called "Armature" as the skeleton container (no extra root bone).
        if rename_to_armature and arm_obj.name != "Armature":
            other = bpy.data.objects.get("Armature")
            if other is not None:
                renamed.append((other, other.name))
                other.name = "__zoi_tmp_armature__"
            renamed.append((arm_obj, arm_obj.name))
            arm_obj.name = "Armature"
        res = bpy.ops.export_scene.fbx(
            filepath=filepath,
            use_selection=True,
            object_types=types,
            apply_unit_scale=True,
            apply_scale_options="FBX_SCALE_NONE",
            axis_forward="-Z",
            axis_up="Y",
            add_leaf_bones=False,
            primary_bone_axis="Y",
            secondary_bone_axis="X",
            use_armature_deform_only=deform_only,
            armature_nodetype="NULL",
            bake_anim=True,
            bake_anim_use_all_bones=True,
            bake_anim_use_nla_strips=False,
            bake_anim_use_all_actions=False,
            bake_anim_force_startend_keying=True,
            bake_anim_step=1.0,
            bake_anim_simplify_factor=0.0,
            mesh_smooth_type="FACE",
            use_mesh_modifiers=True,
            path_mode="AUTO",
        )
        return res
    finally:
        for o, n in reversed(renamed):
            o.name = n
        sc.frame_start, sc.frame_end = prev_range
        for o in view_layer.objects:
            o.select_set(o in prev_sel)
        view_layer.objects.active = prev_active
