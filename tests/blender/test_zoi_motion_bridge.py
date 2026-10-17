# SPDX-License-Identifier: MIT
"""Headless end-to-end test for the Zoi Motion Bridge Blender add-on.

Run (from anywhere):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup ^
      --python-exit-code 1 --python "tests\\blender\\test_zoi_motion_bridge.py"

Optional arguments after "--":  --keep <dir>   keep the exported FBX / presets in <dir>

Frame convention: the add-on puts studio frame f on Blender frame (frame_offset + f); the default
frame offset is 0, so studio frame 9 is Blender frame 9. (Blender's own FBX importer puts studio
frame f of the fixture FBX files on Blender frame f + 1 because of its "Animation Offset" = 1;
the fixture self-check below accounts for that.)

Joint positions are compared in canonical space (meters, Y-up, facing +Z): a Blender world
position (x, y, z) = armature.matrix_world @ pose_bone.head becomes (x, z, -y).
"""

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ADDON_PARENT = os.path.join(ROOT, "blender")
ADDON_DIR = os.path.join(ADDON_PARENT, "zoi_motion_bridge")
FIX = os.path.join(ROOT, "tests", "fixtures")
PROJECT = os.path.join(FIX, "project.zmotion")
TRUTH = json.load(open(os.path.join(FIX, "walk_joint_positions.json"), encoding="utf-8"))
TOL_MM = 1.0

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
KEEP = argv[argv.index("--keep") + 1] if "--keep" in argv else None
TMP = KEEP or tempfile.mkdtemp(prefix="zoi_motion_bridge_test_")
os.makedirs(TMP, exist_ok=True)

# ------------------------------------------------------------------ register the add-on from the folder

sys.dont_write_bytecode = True  # keep the add-on folder clean (no __pycache__)
if ADDON_PARENT not in sys.path:
    sys.path.insert(0, ADDON_PARENT)
import zoi_motion_bridge as zmb  # noqa: E402

zmb.register()
from zoi_motion_bridge import bake, rig  # noqa: E402
from zoi_motion_bridge.clip import load_project  # noqa: E402

RESULTS = []  # (name, worst_mm, where, passed)


def record(name, worst, where, tol=TOL_MM, note=""):
    ok = worst < tol
    RESULTS.append((name, worst, where, ok, note))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: worst error {worst:.4f} mm at {where} {note}")


def check(name, cond, note=""):
    RESULTS.append((name, 0.0 if cond else float("inf"), "-", bool(cond), note))
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {note}")


# ------------------------------------------------------------------ helpers


def clean_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.armatures, bpy.data.actions, bpy.data.meshes):
        for d in list(coll):
            coll.remove(d)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, 250


def activate(obj):
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    vl.objects.active = obj
    obj.select_set(True)


def import_fbx(path, **kw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, **kw)
    arms = [o for o in bpy.data.objects if o not in before and o.type == "ARMATURE"]
    assert arms, "FBX import produced no armature"
    return arms[0]


def clear_animation(arm):
    ad = arm.animation_data
    act = ad.action if ad else None
    arm.animation_data_clear()
    if act is not None and act.users - (1 if act.use_fake_user else 0) == 0:
        bpy.data.actions.remove(act)
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def canonical_pos(arm, bone_name):
    w = arm.matrix_world @ arm.pose.bones[bone_name].head
    return Vector((w.x, w.z, -w.y))


def compare(arm, mapping, offset=0, scale=1.0, frames=None):
    worst, where = 0.0, None
    sc = bpy.context.scene
    for fs, joints in TRUTH["frames"].items():
        f = int(fs)
        if frames is not None and f not in frames:
            continue
        sc.frame_set(offset + f)
        for c, v in joints.items():
            p = canonical_pos(arm, mapping[c])
            d = (p - Vector(v) * scale).length * 1000.0
            if d > worst:
                worst, where = d, f"frame {f} {c}"
    return worst, where


def setup_project(scene="0", stage="0", actor="0", offset=0, mode="BAKE", root="KEEP", placement=False,
                  path=PROJECT):
    r = bpy.ops.zoimb.load_project(filepath=path)
    assert r == {"FINISHED"}, r
    st = bpy.context.scene.zoi_motion
    st.scene_choice = scene
    st.stage_choice = stage
    st.actor_choice = actor
    st.frame_offset = offset
    st.bake_mode = mode
    st.root_motion = root
    st.apply_placement = placement
    return st


def apply_auto(arm, **kw):
    activate(arm)
    setup_project(**kw)
    assert bpy.ops.zoimb.auto_map() == {"FINISHED"}
    t0 = time.perf_counter()
    r = bpy.ops.zoimb.apply_motion()
    dt = time.perf_counter() - t0
    assert r == {"FINISHED"}, r
    return bake.get_mapping(arm), dt


# ------------------------------------------------------------------ 0. canonical sampling vs ground truth


def canonical_fk(clip, f, body_type="adult", placement=None):
    """Canonical joint positions (actor or scene space) from the add-on's clip sampler."""
    from zoi_motion_bridge.clip import canonical_frame
    from zoi_motion_bridge.retarget import Retargeter
    off = rig.body_rest_offsets(body_type)
    rest_world = rig.body_rest_world(body_type)
    quat, hips = canonical_frame(clip, f, rest_world["hips"])
    W = Retargeter.canonical_world(quat)
    pos = {}
    for bd in rig.BONES:
        if bd.parent is None:
            pos[bd.name] = Vector(hips)
        else:
            pos[bd.name] = pos[bd.parent] + W[bd.parent] @ Vector(off[bd.name])
    if placement:
        q = Quaternion((0.0, 1.0, 0.0), math.radians(placement.get("yaw", 0)))
        t = Vector((placement.get("x", 0), 0.0, placement.get("z", 0)))
        pos = {k: q @ v + t for k, v in pos.items()}
    return pos


def test_canonical_sampling():
    p = load_project(PROJECT)
    sc = p["scenes"][0]
    actor = sc["actors"][0]
    clip = sc["stages"][0]["clips"][actor["id"]]
    worst, where = 0.0, None
    for fs, joints in TRUTH["frames"].items():
        pos = canonical_fk(clip, int(fs), actor["bodyType"])
        for c, v in joints.items():
            d = (pos[c] - Vector(v)).length * 1000
            if d > worst:
                worst, where = d, f"frame {fs} {c}"
    record("canonical sampling (clip.js port) vs JSON", worst, where)
    return clip


# ------------------------------------------------------------------ 1. fixture FBX files


def test_fixture(fbx_name, naming, **import_kw):
    clean_scene()
    arm = import_fbx(os.path.join(FIX, fbx_name), **import_kw)
    preset_map = bake.naming_preset_mapping(arm, naming)
    # The fixture's own animation (Blender frame = studio frame + 1) should match the JSON too.
    if arm.animation_data and arm.animation_data.action:
        w, wh = compare(arm, preset_map, offset=1)
        record(f"{fbx_name}: fixture self-check (its own FBX animation)", w, wh)
    clear_animation(arm)
    mapping, dt = apply_auto(arm)
    same = {c: mapping.get(c) for c in rig.BONE_NAMES} == {c: preset_map.get(c) for c in rig.BONE_NAMES}
    check(f"{fbx_name}: auto-map finds all 52 bones like the '{naming}' preset", same and len(mapping) == 52,
          f"({len(mapping)} mapped)")
    w, wh = compare(arm, mapping, offset=0)
    record(f"{fbx_name}: retargeted .zmotion scene0/stage0/actor0 vs JSON", w, wh, note=f"(apply {dt:.2f}s)")
    return arm, mapping


# ------------------------------------------------------------------ 2. variants that stress the math


def rotate_chain(arm, root_name, pivot, angle_deg, axis="Z"):
    m = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(angle_deg), 4, axis) @ Matrix.Translation(-pivot)
    ebs = arm.data.edit_bones
    stack = [ebs[root_name]]
    while stack:
        eb = stack.pop()
        eb.transform(m)
        stack.extend(eb.children)


def test_variants():
    unreal = os.path.join(FIX, "walk_unreal.fbx")

    # a) bones oriented towards their children (non-identity rest rotations)
    clean_scene()
    arm = import_fbx(unreal, automatic_bone_orientation=True)
    clear_animation(arm)
    mapping, _ = apply_auto(arm)
    record("unreal, automatic bone orientation (rest rotations != identity)", *compare(arm, mapping))

    # b) rotation & scale applied: armature space becomes Z-up meters (R != identity, unit = 1)
    clean_scene()
    arm = import_fbx(unreal)
    clear_animation(arm)
    activate(arm)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    mapping, _ = apply_auto(arm)
    record("unreal, transforms applied (Z-up meters armature)", *compare(arm, mapping))

    # c) A-pose rest: arms rotated 45 degrees down in edit mode (E must absorb it)
    clean_scene()
    arm = import_fbx(unreal)
    clear_animation(arm)
    activate(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = arm.data.edit_bones
    rotate_chain(arm, "upperarm_l", ebs["upperarm_l"].head.copy(), -45.0)
    rotate_chain(arm, "upperarm_r", ebs["upperarm_r"].head.copy(), 45.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    mapping, _ = apply_auto(arm)
    record("unreal, A-pose rest (arms 45 deg down)", *compare(arm, mapping))

    # d) child-sized skeleton (all bones x0.66): hips travel scales with leg length
    clean_scene()
    arm = import_fbx(unreal)
    clear_animation(arm)
    activate(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in arm.data.edit_bones:
        eb.transform(Matrix.Scale(0.66, 4))
    bpy.ops.object.mode_set(mode="OBJECT")
    mapping, _ = apply_auto(arm)
    record("unreal, skeleton scaled x0.66 (vs JSON x0.66)", *compare(arm, mapping, scale=0.66))

    # e) Euler rotation mode bones
    clean_scene()
    arm = import_fbx(unreal)
    clear_animation(arm)
    for pb in arm.pose.bones:
        pb.rotation_mode = "ZXY"
    mapping, _ = apply_auto(arm)
    record("unreal, Euler (ZXY) pose bones", *compare(arm, mapping))

    # f) keep keyframes only, frame offset 10
    clean_scene()
    arm = import_fbx(unreal)
    clear_animation(arm)
    mapping, _ = apply_auto(arm, offset=10, mode="KEYS")
    p = load_project(PROJECT)
    clip = p["scenes"][0]["stages"][0]["clips"][p["scenes"][0]["actors"][0]["id"]]
    kf = set(clip.key_frames())
    ad = arm.animation_data
    keyed = sorted({round(k.co[0]) for fc in bake.action_fcurves(ad.action) for k in fc.keyframe_points})
    check("keys-only mode keys exactly the studio key frames (+offset 10)",
          keyed == sorted(f + 10 for f in kf | {0, clip.frames}), f"keys at {keyed}")
    record("unreal, keys only + frame offset 10 (at key frames)", *compare(arm, mapping, offset=10, frames=kf))

    # g) the add-on's own Zoi rig (Z-up meters, bones pointing to children)
    clean_scene()
    bpy.context.scene.zoi_motion.naming_preset = "vrm"
    bpy.context.scene.zoi_motion.rig_body_type = "adult"
    assert bpy.ops.zoimb.create_zoi_rig() == {"FINISHED"}
    arm = bpy.context.view_layer.objects.active
    mapping, _ = apply_auto(arm)
    check("Zoi rig: auto-map finds all 52 VRM bones",
          mapping == {c: c for c in rig.BONE_NAMES}, f"({len(mapping)} mapped)")
    record("created Zoi rig (VRM names)", *compare(arm, mapping))

    # h) in place root motion keeps x/z of the hips at rest
    clean_scene()
    arm = import_fbx(unreal)
    clear_animation(arm)
    mapping, _ = apply_auto(arm, root="IN_PLACE")
    worst = 0.0
    for f in range(0, 35):
        bpy.context.scene.frame_set(f)
        p = canonical_pos(arm, mapping["hips"])
        worst = max(worst, abs(p.x - 0.0) * 1000, abs(p.z - 0.0036) * 1000)
    record("in-place root motion: hips x/z stay at rest", worst, "all frames")


# ------------------------------------------------------------------ 3. stages in sequence, multi-Zoi scene


def test_sequence_and_scene():
    p = json.load(open(PROJECT, encoding="utf-8"))
    sc = p["scenes"][0]
    st2 = json.loads(json.dumps(sc["stages"][0]))
    st2["id"] = st2["id"] + "_b"
    st2["name"] = "Stage 2"
    sc["stages"].append(st2)
    p["scenes"] = [sc]
    path = os.path.join(TMP, "two_stages.zmotion")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(p, fh)
    clean_scene()
    arm = import_fbx(os.path.join(FIX, "walk_unreal.fbx"))
    clear_animation(arm)
    mapping, _ = apply_auto(arm, stage="ALL", path=path)
    s = bpy.context.scene
    check("all stages in sequence: frame range 0-68", (s.frame_start, s.frame_end) == (0, 68),
          f"(got {s.frame_start}-{s.frame_end})")
    w1, wh1 = compare(arm, mapping, offset=0)
    w2, wh2 = compare(arm, mapping, offset=34)
    record("all stages in sequence: stage 2 matches JSON at 34+f", max(w1, w2), wh2 if w2 > w1 else wh1)
    check("action name is <scene>_<stage>_<actor>",
          arm.animation_data.action.name == "My first animation_All_Zoi A", arm.animation_data.action.name)

    # Two-Zoi hug: both actors on two Zoi rigs, with scene placement (Zoi B: z 0.42 m, yaw 180).
    clean_scene()
    st = bpy.context.scene.zoi_motion
    st.naming_preset = "unreal"
    st.rig_body_type = "ACTOR"
    proj = load_project(PROJECT)
    hug = proj["scenes"][1]
    rigs = []
    for ai in ("0", "1"):
        setup_project(scene="1", actor=ai)
        bpy.ops.zoimb.create_zoi_rig()
        a = bpy.context.view_layer.objects.active
        setup_project(scene="1", actor=ai, placement=True)
        assert bpy.ops.zoimb.apply_motion() == {"FINISHED"}
        rigs.append(a)
    worst, where = 0.0, None
    joints = ["hips", "head", "leftHand", "rightHand", "leftFoot", "rightFoot", "leftIndexDistal"]
    for f in (0, 35, 70, 105, 140):
        bpy.context.scene.frame_set(f)
        for ai, a in enumerate(rigs):
            actor = hug["actors"][ai]
            clip = hug["stages"][0]["clips"][actor["id"]]
            exp = canonical_fk(clip, f, actor["bodyType"], placement=actor["offset"])
            for c in joints:
                d = (canonical_pos(a, rig.preset_name("unreal", c)) - exp[c]).length * 1000
                if d > worst:
                    worst, where = d, f"frame {f} {actor['name']} {c}"
    record("hug scene (2 Zois, scene placement) vs canonical FK", worst, where)
    names = sorted(a.animation_data.action.name for a in rigs)
    check("hug scene: one action per Zoi", names == ["Hug_Stage 1_Zoi A", "Hug_Stage 1_Zoi B"], str(names))


# ------------------------------------------------------------------ 4. presets


def test_presets(arm, mapping):
    activate(arm)
    path = os.path.join(TMP, "mapping_preset.json")
    assert bpy.ops.zoimb.save_mapping(filepath=path) == {"FINISHED"}
    assert bpy.ops.zoimb.clear_mapping() == {"FINISHED"}
    assert bake.get_mapping(arm) == {}
    assert bpy.ops.zoimb.load_mapping(filepath=path) == {"FINISHED"}
    check("mapping preset save / clear / load round-trip", bake.get_mapping(arm) == mapping)
    ok = True
    for preset in rig.NAMING:
        names = {rig.preset_name(preset, c) for c in rig.BONE_NAMES}
        ok &= len(names) == 52
    check("built-in naming presets give 52 unique names each", ok)


# ------------------------------------------------------------------ 5. export


def test_export():
    clean_scene()
    arm = import_fbx(os.path.join(FIX, "walk_unreal.fbx"))
    clear_animation(arm)
    mapping, _ = apply_auto(arm)
    n_bones = len(arm.data.bones)
    out = os.path.join(TMP, "walk_modkit.fbx")
    if os.path.exists(out):
        os.remove(out)
    arm.name = "Walker"
    activate(arm)
    r = bpy.ops.zoimb.export_modkit(filepath=out)
    check("export button writes an FBX", r == {"FINISHED"} and os.path.isfile(out) and os.path.getsize(out) > 1000,
          f"({os.path.getsize(out) if os.path.isfile(out) else 0} bytes)")
    check("export restores the armature object name", arm.name == "Walker", f"({arm.name})")
    clean_scene()
    arm2 = import_fbx(out, anim_offset=0.0)
    ad = arm2.animation_data
    check("re-imported armature is called 'Armature' (no extra root bone in Unreal)",
          arm2.name.startswith("Armature"), f"({arm2.name})")
    check("re-imported FBX has an armature with animation",
          ad is not None and ad.action is not None and len(bake.action_fcurves(ad.action)) > 0,
          f"({len(arm2.data.bones)} bones, original {n_bones})")
    m2 = {c: n for c, n in mapping.items() if n in arm2.pose.bones}
    record("exported FBX re-imported vs JSON", *compare(arm2, m2, offset=0))


# ------------------------------------------------------------------ 5b. re-applying, UI drawing


def test_reapply():
    clean_scene()
    a1 = import_fbx(os.path.join(FIX, "walk_unreal.fbx"))
    clear_animation(a1)
    apply_auto(a1)
    apply_auto(a1)
    names = [a.name for a in bpy.data.actions]
    check("re-applying replaces the add-on's own action (no .001 copies)",
          names == ["My first animation_Stage 1_Zoi A"], str(names))
    a2 = import_fbx(os.path.join(FIX, "walk_mixamo.fbx"))
    clear_animation(a2)
    apply_auto(a2)
    ok = a1.animation_data.action is not None and a2.animation_data.action is not None and         a1.animation_data.action != a2.animation_data.action
    check("applying the same Zoi to a 2nd armature keeps the 1st armature's action", ok,
          str(sorted(a.name for a in bpy.data.actions)))


class _MockLayout:
    """Stands in for bpy.types.UILayout and validates every call against Blender's RNA."""

    ICONS = set(bpy.types.UILayout.bl_rna.functions["prop"].parameters["icon"].enum_items.keys())

    def __init__(self, log):
        self.log = log
        self.scale_y = 1.0
        self.enabled = True
        self.alert = False

    def _icon(self, kw):
        ic = kw.get("icon", "NONE")
        if ic not in self.ICONS:
            self.log.append(f"unknown icon {ic}")

    def row(self, **kw):
        return _MockLayout(self.log)

    column = box = split = row

    def separator(self, **kw):
        pass

    def label(self, text="", **kw):
        self._icon(kw)

    def prop(self, data, name, **kw):
        self._icon(kw)
        if name not in data.bl_rna.properties:
            self.log.append(f"no property {name} on {data}")
        else:
            getattr(data, name)

    def prop_search(self, data, name, sdata, sname, **kw):
        self._icon(kw)
        if name not in data.bl_rna.properties or sname not in sdata.bl_rna.properties:
            self.log.append(f"bad prop_search {name}/{sname}")

    def operator(self, idname, **kw):
        self._icon(kw)
        mod, op = idname.split(".")
        try:
            getattr(getattr(bpy.ops, mod), op).get_rna_type()
        except (AttributeError, KeyError) as ex:
            self.log.append(f"no operator {idname}: {ex}")
        return None


def test_ui_draw():
    from zoi_motion_bridge import ui
    log = []

    class FakePanel:
        def __init__(self):
            self.layout = _MockLayout(log)

    def draw_all():
        for cls in (ui.ZOIMB_PT_main, ui.ZOIMB_PT_import, ui.ZOIMB_PT_mapping, ui.ZOIMB_PT_export):
            cls.draw(FakePanel(), bpy.context)

    clean_scene()
    st = bpy.context.scene.zoi_motion
    st.project_path = ""
    draw_all()                              # nothing selected, no project
    arm = import_fbx(os.path.join(FIX, "walk_unreal.fbx"))
    activate(arm)
    clear_animation(arm)
    st.show_mapping = True
    draw_all()                              # armature, not mapped, no project
    setup_project(scene="1")
    draw_all()                              # 2-Zoi scene (placement option visible)
    bpy.ops.zoimb.auto_map()
    st.scene_choice = "0"
    for g in ("ALL", "armL", "handR"):
        st.mapping_group = g
        draw_all()
    bpy.ops.zoimb.apply_motion()
    st.project_path = os.path.join(TMP, "missing.zmotion")
    draw_all()                              # unreadable project
    items = [i[0] for i in ui._scene_items(st, bpy.context)]
    check("UI panels draw without errors in every state (mock layout)", not log, "; ".join(sorted(set(log))[:5]))
    check("unreadable project falls back to a placeholder scene list", items == ["0"], str(items))
    st.project_path = PROJECT


# ------------------------------------------------------------------ 6. manifest


def test_manifest_and_zip():
    exe = bpy.app.binary_path
    zip_path = os.path.join(ADDON_PARENT, "zoi_motion_bridge.zip")
    for target in (ADDON_DIR, zip_path):
        if not os.path.exists(target):
            check(f"extension validate {os.path.basename(target)}", False, "(missing)")
            continue
        try:
            r = subprocess.run([exe, "--factory-startup", "-c", "extension", "validate", target],
                               capture_output=True, text=True, timeout=120)
            txt = (r.stdout + r.stderr).strip().splitlines()
            check(f"blender extension validate {os.path.basename(target)}", r.returncode == 0,
                  "| " + (txt[-1] if txt else ""))
        except (OSError, subprocess.TimeoutExpired) as ex:
            check(f"blender extension validate {os.path.basename(target)}", False, str(ex))


# ------------------------------------------------------------------ main


def main():
    print(f"Blender {bpy.app.version_string}; add-on from {ADDON_DIR}; temp {TMP}")
    test_canonical_sampling()
    arm_u, map_u = test_fixture("walk_unreal.fbx", "unreal")
    test_presets(arm_u, map_u)
    test_fixture("walk_mixamo.fbx", "mixamo")
    test_variants()
    test_sequence_and_scene()
    test_export()
    test_reapply()
    test_ui_draw()
    test_manifest_and_zip()
    zmb.unregister()
    print("\n================ SUMMARY ================")
    worst = max((r[1] for r in RESULTS if r[2] != "-"), default=0.0)
    for name, w, where, ok, note in RESULTS:
        val = f"{w:9.4f} mm" if where != "-" else "         "
        print(f"{'PASS' if ok else 'FAIL'}  {val}  {name} {note}")
    failed = [r for r in RESULTS if not r[3]]
    print(f"\nWorst position error over all retarget comparisons: {worst:.4f} mm (tolerance {TOL_MM} mm)")
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if not KEEP:
        shutil.rmtree(TMP, ignore_errors=True)
    if failed:
        sys.exit(1)


try:
    main()
except SystemExit:
    raise
except Exception:
    import traceback
    traceback.print_exc()
    sys.exit(1)
