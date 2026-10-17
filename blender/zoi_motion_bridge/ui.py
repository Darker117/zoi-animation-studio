# SPDX-License-Identifier: MIT
"""Properties, operators and the sidebar panel (View3D > N panel > "Zoi Motion")."""

import json
import os

import bpy
from bpy.props import BoolProperty, CollectionProperty, EnumProperty, IntProperty, PointerProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup
from bpy_extras.io_utils import ExportHelper, ImportHelper

from . import bake
from .clip import ProjectError, load_project
from .rig import BODY_TYPES, BONE_MAP, BONE_NAMES, ESSENTIAL, GROUPS, NAMING

# ------------------------------------------------------------------ project cache

_cache = {"path": None, "mtime": None, "project": None, "error": None}
_enum_keep = {}  # Blender needs Python to keep dynamic enum strings alive


def get_project(path):
    """Parsed project for `path` (cached by modification time). None if it can't be read."""
    if not path:
        return None
    ap = bpy.path.abspath(path)
    try:
        mtime = os.path.getmtime(ap)
    except OSError:
        _cache.update(path=ap, mtime=None, project=None, error="File not found")
        return None
    if _cache["path"] == ap and _cache["mtime"] == mtime:
        return _cache["project"]
    try:
        project = load_project(ap)
        err = None
    except (ProjectError, OSError, ValueError, KeyError, TypeError) as ex:
        project, err = None, str(ex)
    _cache.update(path=ap, mtime=mtime, project=project, error=err)
    return project


def _index(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _scene_items(self, context):
    p = get_project(self.project_path)
    items = []
    if p:
        for i, s in enumerate(p["scenes"]):
            desc = f"{len(s['actors'])} Zoi(s), {len(s['stages'])} stage(s), kind: {s.get('kind', '')}"
            items.append((str(i), f"{i + 1}. {s.get('name') or 'Scene'}", desc, i))
    if not items:
        items = [("0", "(load a .zmotion file)", "", 0)]
    _enum_keep["scene"] = items
    return items


def _current_scene(settings):
    p = get_project(settings.project_path)
    if not p or not p["scenes"]:
        return p, None
    si = min(_index(settings.scene_choice), len(p["scenes"]) - 1)
    return p, p["scenes"][si]


def _stage_items(self, context):
    p, s = _current_scene(self)
    items = []
    if s:
        for i, st in enumerate(s["stages"]):
            desc = f"{st.get('frames')} frames @ {st.get('fps')} fps{' (loop)' if st.get('loop') else ''}"
            items.append((str(i), f"{i + 1}. {st.get('name') or 'Stage'}", desc, i))
        if len(s["stages"]) > 1:
            items.append(("ALL", "All stages in sequence", "Every stage of the scene, one after another", 9999))
    if not items:
        items = [("0", "(no stages)", "", 0)]
    _enum_keep["stage"] = items
    return items


def _actor_items(self, context):
    p, s = _current_scene(self)
    items = []
    if s:
        for i, a in enumerate(s["actors"]):
            bt = BODY_TYPES.get(a.get("bodyType"), BODY_TYPES["adult"])["label"]
            items.append((str(i), f"{a.get('name') or 'Zoi'}", f"Body: {bt}", i))
    if not items:
        items = [("0", "(no Zois)", "", 0)]
    _enum_keep["actor"] = items
    return items


def _on_scene_changed(self, context):
    try:
        self.stage_choice = "0"
        self.actor_choice = "0"
    except TypeError:
        pass


_NAMING_ITEMS = [(k, v[0], "") for k, v in NAMING.items()]
_GROUP_ITEMS = [("ALL", "All bones", "")] + [(g, label, "") for g, label in GROUPS]

# ------------------------------------------------------------------ properties


class ZOIMB_BoneMapItem(PropertyGroup):
    canonical: StringProperty(name="Zoi bone")
    target: StringProperty(name="Armature bone", description="Bone of this armature that plays this role")


class ZOIMB_Settings(PropertyGroup):
    project_path: StringProperty(name="Project", subtype="FILE_PATH",
                                 description="Studio project (.zmotion)")
    scene_choice: EnumProperty(name="Scene", items=_scene_items, update=_on_scene_changed,
                               description="Animation (scene) from the project")
    stage_choice: EnumProperty(name="Stage", items=_stage_items, description="Stage of the scene")
    actor_choice: EnumProperty(name="Zoi", items=_actor_items, description="Which Zoi (actor slot) to apply")
    frame_offset: IntProperty(name="Frame offset", default=0,
                              description="Studio frame 0 lands on this Blender frame")
    bake_mode: EnumProperty(
        name="Keys", default="BAKE",
        items=[("BAKE", "Bake every frame", "A key on every frame: exact copy of the studio motion"),
               ("KEYS", "Keep keyframes only", "Only frames where the studio clip has keys (easier to edit, "
                                              "in-betweens are approximated by Blender curves)")])
    root_motion: EnumProperty(
        name="Root motion", default="KEEP",
        items=[("KEEP", "Keep", "Keep forward/sideways travel of the hips"),
               ("IN_PLACE", "In place", "Remove forward/sideways travel (up/down bobbing is kept)")])
    apply_placement: BoolProperty(
        name="Use scene placement", default=False,
        description="Include the Zoi's offset/turn inside the scene (for previewing multi-Zoi scenes). "
                    "Keep off for ModKit export: placement is set up in the ModKit")
    set_scene_range: BoolProperty(name="Set scene FPS & range", default=True,
                                  description="Match the scene frame rate and frame range to the animation")
    reset_pose: BoolProperty(name="Reset other bones", default=True,
                             description="Put every bone back to its rest pose before applying")
    naming_preset: EnumProperty(name="Naming", items=_NAMING_ITEMS, default="unreal",
                                description="Built-in bone naming convention")
    show_mapping: BoolProperty(name="Show bone list", default=False)
    mapping_group: EnumProperty(name="Show", items=_GROUP_ITEMS, default="ALL")
    export_include_meshes: BoolProperty(name="Include meshes", default=False,
                                        description="Also export meshes skinned to / parented to the armature")
    export_deform_only: BoolProperty(name="Deform bones only", default=True,
                                     description="Skip helper bones that do not deform the mesh")
    export_rename: BoolProperty(
        name="Name armature 'Armature'", default=True,
        description="Temporarily name the armature object 'Armature' while exporting, so Unreal does not "
                    "add an extra root bone")
    rig_body_type: EnumProperty(name="Body", default="ACTOR",
                                items=[("ACTOR", "From chosen Zoi", "")] +
                                      [(k, v["label"], "") for k, v in BODY_TYPES.items()])


# ------------------------------------------------------------------ operators


def _settings(context):
    return context.scene.zoi_motion


class ZOIMB_OT_load_project(Operator, ImportHelper):
    bl_idname = "zoimb.load_project"
    bl_label = "Open .zmotion"
    bl_description = "Open a Studio project file"
    bl_options = {"REGISTER"}

    filename_ext = ".zmotion"
    filter_glob: StringProperty(default="*.zmotion;*.json", options={"HIDDEN"})

    def execute(self, context):
        st = _settings(context)
        path = self.filepath
        try:
            project = load_project(bpy.path.abspath(path))
        except (ProjectError, OSError, ValueError) as ex:
            self.report({"ERROR"}, f"Could not open project: {ex}")
            return {"CANCELLED"}
        st.project_path = path
        get_project(path)
        try:
            st.scene_choice = "0"
            st.stage_choice = "0"
            st.actor_choice = "0"
        except TypeError:
            pass
        n = len(project["scenes"])
        self.report({"INFO"}, f"Loaded '{project['pack'].get('name', '')}': {n} animation(s)")
        return {"FINISHED"}


class ZOIMB_OT_apply_motion(Operator):
    bl_idname = "zoimb.apply_motion"
    bl_label = "Apply to Armature"
    bl_description = "Retarget the chosen scene / stage / Zoi onto the active armature as a new Action"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return bake.find_armature(context) is not None and bool(_settings(context).project_path)

    def execute(self, context):
        st = _settings(context)
        arm = bake.find_armature(context)
        project = get_project(st.project_path)
        if project is None:
            self.report({"ERROR"}, f"Could not read the project: {_cache.get('error') or 'unknown error'}")
            return {"CANCELLED"}
        if not project["scenes"]:
            self.report({"ERROR"}, "The project has no animations")
            return {"CANCELLED"}
        if context.mode != "OBJECT" and context.mode != "POSE":
            bpy.ops.object.mode_set(mode="OBJECT")
        si = min(_index(st.scene_choice), len(project["scenes"]) - 1)
        scene = project["scenes"][si]
        if not scene["stages"] or not scene["actors"]:
            self.report({"ERROR"}, "This animation has no stages or no Zois")
            return {"CANCELLED"}
        stage_sel = st.stage_choice if st.stage_choice == "ALL" else str(min(_index(st.stage_choice), len(scene["stages"]) - 1))
        ai = min(_index(st.actor_choice), len(scene["actors"]) - 1)
        mapping = bake.get_mapping(arm)
        if not mapping:
            mapping = bake.auto_map_armature(arm)
            bake.set_mapping(arm, mapping)
            self.report({"INFO"}, f"Auto-mapped {len(mapping)} bones")
        missing, invalid = bake.mapping_problems(arm, mapping)
        if invalid:
            self.report({"WARNING"}, "Mapped bones not found in armature: " + ", ".join(invalid[:6]))
            mapping = {c: n for c, n in mapping.items() if c not in invalid}
        if "hips" not in mapping:
            self.report({"ERROR"}, "No hips bone mapped. Open Bone Mapping and pick the hips/pelvis bone")
            return {"CANCELLED"}
        opts = bake.BakeOptions(frame_offset=st.frame_offset, bake_every_frame=(st.bake_mode == "BAKE"),
                                root_motion=st.root_motion, apply_placement=st.apply_placement,
                                reset_unmapped=st.reset_pose, set_scene=st.set_scene_range)
        try:
            info = bake.bake_to_action(context, arm, project, si, stage_sel, ai, mapping, opts)
        except (ValueError, KeyError, IndexError) as ex:
            self.report({"ERROR"}, str(ex))
            return {"CANCELLED"}
        context.scene.frame_set(info["frames"][0])
        msg = f"Created action '{info['action'].name}' (frames {info['frames'][0]}-{info['frames'][1]}, " \
              f"{info['mapped']} bones mapped)"
        if missing:
            msg += ". Not mapped: " + ", ".join(missing)
            self.report({"WARNING"}, msg)
        else:
            self.report({"INFO"}, msg)
        return {"FINISHED"}


class ZOIMB_OT_auto_map(Operator):
    bl_idname = "zoimb.auto_map"
    bl_label = "Auto-map"
    bl_description = "Guess the bone mapping from bone names and the skeleton hierarchy"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return bake.find_armature(context) is not None

    def execute(self, context):
        arm = bake.find_armature(context)
        mapping = bake.auto_map_armature(arm)
        bake.set_mapping(arm, mapping)
        missing = [c for c in ESSENTIAL if c not in mapping]
        if missing:
            self.report({"WARNING"}, f"Mapped {len(mapping)}/52 bones. Please pick: " + ", ".join(missing))
        else:
            self.report({"INFO"}, f"Mapped {len(mapping)}/52 bones")
        return {"FINISHED"}


class ZOIMB_OT_apply_naming(Operator):
    bl_idname = "zoimb.apply_naming_preset"
    bl_label = "Use Naming Preset"
    bl_description = "Map bones by a built-in naming convention"
    bl_options = {"REGISTER", "UNDO"}

    preset: EnumProperty(name="Naming", items=_NAMING_ITEMS)

    @classmethod
    def poll(cls, context):
        return bake.find_armature(context) is not None

    def invoke(self, context, event):
        self.preset = _settings(context).naming_preset
        return self.execute(context)

    def execute(self, context):
        arm = bake.find_armature(context)
        mapping = bake.naming_preset_mapping(arm, self.preset)
        if not mapping:
            self.report({"WARNING"}, f"No bone of this armature matches the {NAMING[self.preset][0]} names")
            return {"CANCELLED"}
        bake.set_mapping(arm, mapping)
        self.report({"INFO"}, f"Mapped {len(mapping)}/52 bones by name")
        return {"FINISHED"}


class ZOIMB_OT_clear_mapping(Operator):
    bl_idname = "zoimb.clear_mapping"
    bl_label = "Clear"
    bl_description = "Remove the bone mapping of this armature"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return bake.find_armature(context) is not None

    def execute(self, context):
        bake.set_mapping(bake.find_armature(context), {})
        return {"FINISHED"}


class ZOIMB_OT_save_mapping(Operator, ExportHelper):
    bl_idname = "zoimb.save_mapping"
    bl_label = "Save Mapping Preset"
    bl_description = "Save this bone mapping as a JSON preset"
    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        return bake.find_armature(context) is not None

    def execute(self, context):
        arm = bake.find_armature(context)
        data = {"format": "zoi-motion-bone-map", "version": 1, "armature": arm.name, "map": bake.get_mapping(arm)}
        try:
            with open(bpy.path.abspath(self.filepath), "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2)
        except OSError as ex:
            self.report({"ERROR"}, str(ex))
            return {"CANCELLED"}
        self.report({"INFO"}, f"Saved {len(data['map'])} bones")
        return {"FINISHED"}


class ZOIMB_OT_load_mapping(Operator, ImportHelper):
    bl_idname = "zoimb.load_mapping"
    bl_label = "Load Mapping Preset"
    bl_description = "Load a bone mapping JSON preset"
    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        return bake.find_armature(context) is not None

    def execute(self, context):
        arm = bake.find_armature(context)
        try:
            with open(bpy.path.abspath(self.filepath), "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as ex:
            self.report({"ERROR"}, f"Could not read preset: {ex}")
            return {"CANCELLED"}
        m = data.get("map", data) if isinstance(data, dict) else None
        if not isinstance(m, dict):
            self.report({"ERROR"}, "Not a bone mapping preset")
            return {"CANCELLED"}
        mapping = {c: str(n) for c, n in m.items() if c in BONE_MAP and n}
        names = set(arm.data.bones.keys())
        missing = [n for n in mapping.values() if n not in names]
        bake.set_mapping(arm, mapping)
        if missing:
            self.report({"WARNING"}, f"Loaded {len(mapping)} bones; not in this armature: " + ", ".join(missing[:6]))
        else:
            self.report({"INFO"}, f"Loaded {len(mapping)} bones")
        return {"FINISHED"}


class ZOIMB_OT_create_rig(Operator):
    bl_idname = "zoimb.create_zoi_rig"
    bl_label = "Create Zoi Rig"
    bl_description = "Add the studio's own 52-bone Zoi skeleton (handy for previews or as a reference)"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        st = _settings(context)
        body = st.rig_body_type
        if body == "ACTOR":
            body = "adult"
            p, s = _current_scene(st)
            if s and s["actors"]:
                body = s["actors"][min(_index(st.actor_choice), len(s["actors"]) - 1)].get("bodyType") or "adult"
        if context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        obj = bake.create_zoi_rig(context, body_type=body, naming=st.naming_preset)
        self.report({"INFO"}, f"Created '{obj.name}' ({BODY_TYPES.get(body, BODY_TYPES['adult'])['label']})")
        return {"FINISHED"}


class ZOIMB_OT_export_modkit(Operator, ExportHelper):
    bl_idname = "zoimb.export_modkit"
    bl_label = "Export for inZOI ModKit"
    bl_description = "Export the armature and its current action as an FBX with Unreal-friendly settings"
    filename_ext = ".fbx"
    filter_glob: StringProperty(default="*.fbx", options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        return bake.find_armature(context) is not None

    def invoke(self, context, event):
        arm = bake.find_armature(context)
        ad = arm.animation_data if arm else None
        if ad and ad.action:
            self.filepath = bpy.path.clean_name(ad.action.name) + ".fbx"
        return ExportHelper.invoke(self, context, event)

    def execute(self, context):
        st = _settings(context)
        arm = bake.find_armature(context)
        ad = arm.animation_data
        if not ad or not ad.action:
            self.report({"ERROR"}, "The armature has no action. Apply a .zmotion animation first")
            return {"CANCELLED"}
        if context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        path = bpy.path.abspath(self.filepath)
        try:
            bake.export_modkit_fbx(context, arm, path, include_meshes=st.export_include_meshes,
                                   deform_only=st.export_deform_only, rename_to_armature=st.export_rename)
        except RuntimeError as ex:
            self.report({"ERROR"}, f"FBX export failed: {ex}")
            return {"CANCELLED"}
        self.report({"INFO"}, f"Exported {os.path.basename(path)}")
        return {"FINISHED"}


# ------------------------------------------------------------------ panels


class ZOIMB_PT_main(Panel):
    bl_idname = "ZOIMB_PT_main"
    bl_label = "Zoi Motion Bridge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Zoi Motion"

    def draw(self, context):
        layout = self.layout
        arm = bake.find_armature(context)
        if arm is None:
            layout.label(text="Select an armature", icon="ERROR")
        else:
            layout.label(text=f"Target: {arm.name}", icon="ARMATURE_DATA")


class ZOIMB_PT_import(Panel):
    bl_idname = "ZOIMB_PT_import"
    bl_label = "Import .zmotion"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Zoi Motion"
    bl_parent_id = "ZOIMB_PT_main"

    def draw(self, context):
        layout = self.layout
        st = _settings(context)
        row = layout.row(align=True)
        row.operator(ZOIMB_OT_load_project.bl_idname, icon="FILEBROWSER")
        project = get_project(st.project_path)
        if st.project_path:
            layout.label(text=os.path.basename(bpy.path.abspath(st.project_path)), icon="FILE")
        if st.project_path and project is None:
            layout.label(text=_cache.get("error") or "Cannot read file", icon="ERROR")
            return
        if project is None:
            layout.label(text="Open a project saved by Studio")
            return
        col = layout.column(align=True)
        col.label(text="Animation (scene):")
        col.prop(st, "scene_choice", text="")
        split = layout.split(factor=0.3, align=True)
        split.label(text="Stage")
        split.prop(st, "stage_choice", text="")
        split = layout.split(factor=0.3, align=True)
        split.label(text="Zoi")
        split.prop(st, "actor_choice", text="")
        _, s = _current_scene(st)
        if s and s["stages"]:
            if st.stage_choice == "ALL":
                total = sum(x.get("frames", 0) for x in s["stages"])
                layout.label(text=f"{len(s['stages'])} stages, {total} frames", icon="TIME")
            else:
                sg = s["stages"][min(_index(st.stage_choice), len(s["stages"]) - 1)]
                layout.label(text=f"{sg.get('frames')} frames @ {sg.get('fps')} fps"
                                  f"{' - loops' if sg.get('loop') else ''}", icon="TIME")
        box = layout.box()
        col = box.column(align=True)
        col.label(text="Keys:")
        col.prop(st, "bake_mode", expand=True)
        col = box.column(align=True)
        col.label(text="Root motion:")
        col.row(align=True).prop(st, "root_motion", expand=True)
        col = box.column(align=True)
        col.prop(st, "frame_offset")
        col.prop(st, "set_scene_range")
        col.prop(st, "reset_pose")
        if s and len(s["actors"]) > 1:
            col.prop(st, "apply_placement")
        row = layout.row()
        row.scale_y = 1.4
        row.operator(ZOIMB_OT_apply_motion.bl_idname, icon="ARMATURE_DATA")
        arm = bake.find_armature(context)
        if arm is None:
            layout.label(text="Select the target armature first", icon="INFO")
        sub = layout.row(align=True)
        sub.prop(st, "rig_body_type", text="")
        sub.operator(ZOIMB_OT_create_rig.bl_idname, icon="OUTLINER_OB_ARMATURE")


class ZOIMB_PT_mapping(Panel):
    bl_idname = "ZOIMB_PT_mapping"
    bl_label = "Bone Mapping"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Zoi Motion"
    bl_parent_id = "ZOIMB_PT_main"

    def draw(self, context):
        layout = self.layout
        st = _settings(context)
        arm = bake.find_armature(context)
        if arm is None:
            layout.label(text="Select an armature", icon="INFO")
            return
        row = layout.row(align=True)
        row.scale_y = 1.2
        row.operator(ZOIMB_OT_auto_map.bl_idname, icon="AUTO")
        row.operator(ZOIMB_OT_clear_mapping.bl_idname, icon="X")
        row = layout.row(align=True)
        row.prop(st, "naming_preset", text="")
        row.operator(ZOIMB_OT_apply_naming.bl_idname, text="Use Names")
        row = layout.row(align=True)
        row.operator(ZOIMB_OT_load_mapping.bl_idname, text="Load Preset", icon="IMPORT")
        row.operator(ZOIMB_OT_save_mapping.bl_idname, text="Save Preset", icon="EXPORT")
        mapping = bake.get_mapping(arm)
        missing, invalid = bake.mapping_problems(arm, mapping)
        if not mapping:
            layout.label(text="Not mapped yet (Apply will auto-map)", icon="INFO")
        else:
            layout.label(text=f"{len(mapping)}/52 bones mapped", icon="CHECKMARK" if not missing else "ERROR")
            if missing:
                col = layout.column(align=True)
                col.label(text="Missing: " + ", ".join(BONE_MAP[c].label for c in missing[:4]) +
                               ("..." if len(missing) > 4 else ""))
            if invalid:
                layout.label(text=f"{len(invalid)} bone name(s) not in this armature", icon="ERROR")
        layout.prop(st, "show_mapping", icon="TRIA_DOWN" if st.show_mapping else "TRIA_RIGHT", emboss=False)
        if not st.show_mapping:
            return
        if len(arm.zoi_bone_map) != len(BONE_NAMES):
            layout.label(text="Press Auto-map or Use Names to edit bones", icon="INFO")
            return
        layout.prop(st, "mapping_group")
        col = layout.column(align=True)
        last_group = None
        for it in arm.zoi_bone_map:
            bd = BONE_MAP.get(it.canonical)
            if bd is None:
                continue
            if st.mapping_group != "ALL" and bd.group != st.mapping_group:
                continue
            if bd.group != last_group:
                col.separator()
                col.label(text=dict(GROUPS)[bd.group] + ":")
                last_group = bd.group
            row = col.row(align=True)
            split = row.split(factor=0.4, align=True)
            short = bd.label.split(" ", 1)[1] if bd.side else bd.label  # group heading names the side
            split.label(text=short[:1].upper() + short[1:], icon="BLANK1" if it.target else "DOT")
            split.prop_search(it, "target", arm.data, "bones", text="")


class ZOIMB_PT_export(Panel):
    bl_idname = "ZOIMB_PT_export"
    bl_label = "Export for inZOI ModKit"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Zoi Motion"
    bl_parent_id = "ZOIMB_PT_main"

    def draw(self, context):
        layout = self.layout
        st = _settings(context)
        arm = bake.find_armature(context)
        if arm is None:
            layout.label(text="Select an armature", icon="INFO")
            return
        ad = arm.animation_data
        layout.label(text=f"Action: {ad.action.name}" if ad and ad.action else "No action yet", icon="ACTION")
        col = layout.column(align=True)
        col.prop(st, "export_include_meshes")
        col.prop(st, "export_deform_only")
        col.prop(st, "export_rename")
        row = layout.row()
        row.scale_y = 1.4
        row.operator(ZOIMB_OT_export_modkit.bl_idname, icon="EXPORT")


classes = (
    ZOIMB_BoneMapItem,
    ZOIMB_Settings,
    ZOIMB_OT_load_project,
    ZOIMB_OT_apply_motion,
    ZOIMB_OT_auto_map,
    ZOIMB_OT_apply_naming,
    ZOIMB_OT_clear_mapping,
    ZOIMB_OT_save_mapping,
    ZOIMB_OT_load_mapping,
    ZOIMB_OT_create_rig,
    ZOIMB_OT_export_modkit,
    ZOIMB_PT_main,
    ZOIMB_PT_import,
    ZOIMB_PT_mapping,
    ZOIMB_PT_export,
)


def register():
    for c in classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.zoi_motion = PointerProperty(type=ZOIMB_Settings)
    bpy.types.Object.zoi_bone_map = CollectionProperty(type=ZOIMB_BoneMapItem)


def unregister():
    del bpy.types.Object.zoi_bone_map
    del bpy.types.Scene.zoi_motion
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
