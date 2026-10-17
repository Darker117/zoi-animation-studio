"""Studio -> inZOI ModKit: turns an exported pack into a permanent animation mod.

The same file runs in two places (build_mod.ps1 drives both):

  * plain Python (the ModKit's bundled python.exe), to check the pack and write the build job:
        python zaf_modkit.py plan --pack <pack folder> --out <job.json> [--mod-name N] [--author A] [--plugin P]

  * inside the ModKit editor, headless, with ZAF_MODKIT_JOB=<job.json>:
        UnrealEditor-Cmd.exe inZOIModKit.uproject -run=pythonscript -script=zaf_modkit.py
    It creates (or updates) the mod project, imports every FBX onto the Zoi skeleton, makes one
    Animation Montage per animation and writes the Character Animation -> Interaction rows.

Cooking and packaging is done afterwards by the ModKit's own PackageUGC automation (see build_mod.ps1).

The file formats written here are the ones the ModKit itself produces for a Character_Interaction
workspace (checked against ModKit 20261011.16078): docs/MODKIT_PIPELINE.md has the details.
"""

import json
import os
import re
import sys
import traceback

SKELETON = "/Game/Characters/Skeletons/SK_Base"
ZOI_BODY = "/Game/Characters/Skeletons/SKM_Base_Body"
BOOK = "Self_Angry"                      # the in-game row a new interaction row is modelled on
TABLE = "AnimCharacter_Interaction"
WORKSPACE_CLASS = "Character_Interaction"
INTERACTION_KINDS = ("interaction", "pose")
# Bones only the Zoi skeleton has (the studio's canonical and Unreal-name rigs stop at spine_03 / neck_01).
ZOI_ONLY_BONES = ("spine_04", "spine_05", "neck_02")
LOOP_START = "/Script/BlueClient.B1AnimNotify_LoopStart"
LOOP_END = "/Script/BlueClient.B1AnimNotify_LoopEnd"
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,95}$")
GENDERS = {"Any": ["Female", "Male"], "Female": ["Female"], "Male": ["Male"]}


class PackError(Exception):
    """The pack cannot be built as it is; the message says what to change."""


# ------------------------------------------------------------------ helpers

def read_json(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent="\t", ensure_ascii=False)
        f.write("\n")


def safe_name(s, fallback="Anim"):
    v = re.sub(r"[^A-Za-z0-9_]+", "_", str(s or "")).strip("_")
    return v or fallback


def lower_first(s):
    return s[:1].lower() + s[1:]


def camel(value):
    """PascalCase JSON (data patches) -> camelCase JSON (.workspace files), recursively."""
    if isinstance(value, dict):
        return {lower_first(k): camel(v) for k, v in value.items()}
    if isinstance(value, list):
        return [camel(v) for v in value]
    return value


def anim_entries(gender, growth):
    """Anim Info List entries for one Zoi role. inZOI's own rows use Adult for teens and adults
    (one entry per gender) and Youth with gender Default for children."""
    if growth == "Child":
        return [{"gender": "Default", "growth": "Youth"}]
    return [{"gender": g, "growth": "Adult"} for g in GENDERS.get(gender, GENDERS["Any"])]


# ------------------------------------------------------------------ plan (plain Python)

def plan(pack_dir, mod_name=None, author=None, plugin=None, book=BOOK):
    pack_dir = os.path.abspath(pack_dir)
    manifest_path = os.path.join(pack_dir, "zaf_pack.json")
    if not os.path.isfile(manifest_path):
        raise PackError("No zaf_pack.json in %s. Export the pack from Studio with Format: inZOI pack." % pack_dir)
    m = read_json(manifest_path)
    if m.get("zaf") != 1:
        raise PackError("zaf_pack.json has an unknown format version (%r); this tool reads version 1." % m.get("zaf"))
    if m.get("skeleton") != "character":
        # Imported onto SK_Base, the 'unreal' preset's T-pose bone axes leave the spine lying flat: names alone are not enough.
        raise PackError(
            "This pack was exported with the '%s' skeleton. The ModKit needs animations baked bone-for-bone on the Zoi "
            "skeleton: in the studio use Import > Use as character on the Zoi body FBX (build_mod.ps1 -ExportZoiSkeleton "
            "writes it), then export again with Skeleton: 'Loaded character'." % m.get("skeleton"))

    uses = {}
    for sc in m.get("scenes", []):
        for st in sc.get("stages", []):
            for slot, aid in enumerate(st.get("animations", [])):
                if aid and aid not in uses:
                    uses[aid] = (sc, st, slot)

    anims, skipped, assets = [], [], set()
    for a in m.get("animations", []):
        sc, st, slot = uses.get(a.get("id"), (None, None, 0))
        kind = (sc or {}).get("kind", "interaction")
        if kind not in INTERACTION_KINDS:
            skipped.append({"id": a.get("id"), "reason": "%s animations are not automated yet: set them up in the ModKit with the setup sheet." % kind})
            continue
        anim_id = a.get("anim_id") or a.get("id")
        if not anim_id or not ID_RE.match(anim_id):
            raise PackError("Animation id %r must start with a letter and use only letters, numbers and _." % anim_id)
        fbx = os.path.normpath(os.path.join(pack_dir, a.get("file") or ""))
        if not fbx.lower().endswith(".fbx") or not fbx.startswith(pack_dir + os.sep) or not os.path.isfile(fbx):
            raise PackError("Animation %s: FBX file not found in the pack (%s)." % (anim_id, a.get("file")))
        asset = "ANIM_" + safe_name(anim_id)
        n = 2
        while asset.lower() in assets:
            asset = "ANIM_%s_%d" % (safe_name(anim_id), n)
            n += 1
        assets.add(asset.lower())
        actor = (sc or {}).get("actors", [])[slot] if sc and slot < len(sc.get("actors", [])) else {}
        loop = bool(st.get("loop")) if st else bool(a.get("loop"))
        anims.append({
            "anim_id": anim_id,
            "label": "%s / %s / %s" % (a.get("scene") or (sc or {}).get("name", ""), a.get("stage") or (st or {}).get("name", ""), a.get("actor") or actor.get("name", "")),
            "fbx": fbx,
            "asset": asset,
            "montage": asset + "_Interaction_Montage",
            "fps": a.get("fps") or (st or {}).get("fps") or 30,
            "loop": loop,
            "posture": ((sc or {}).get("inzoi") or {}).get("posture") or "Stand",
            "rate_scale": ((sc or {}).get("inzoi") or {}).get("rateScale") or 1,
            "entries": anim_entries(actor.get("gender", "Any"), actor.get("growth", "Adult")),
        })
    if not anims:
        raise PackError("Nothing to build: the pack has no interaction or pose animations.")

    name = mod_name or safe_name(m.get("name") or m.get("id"), "Pack")
    if not mod_name and not name.upper().startswith("ZAF"):
        name = "ZAF_" + name
    return {
        "zaf_modkit": 1,
        "pack_dir": pack_dir,
        "pack_id": m.get("id"),
        "mod_name": safe_name(name)[:32],
        "author": author or m.get("author") or "",
        "description": (m.get("description") or "") or ("Animations made with Studio (pack %s)." % m.get("id")),
        "version": m.get("version") or "1.0.0",
        "plugin": plugin or "",
        "book": book,
        "animations": anims,
        "skipped": skipped,
    }


# ------------------------------------------------------------------ data files (plain Python)

def anim_row(a, montage_path, length):
    """One AnimCharacter_Interaction row, in the layout the ModKit writes for a Character_Interaction workspace."""
    rate = float(a.get("rate_scale") or 1)
    return {
        "Id": a["anim_id"],
        "Comment": ("Studio: " + a["label"]).strip(),
        "AttachMeshInfos": [],
        "PlayingComponentName": "Root",
        "StopOtherComponentOnFinish": False,
        "StartAnimSection": "Default",
        "CharacterAnimConfigList": [{
            "AnimPostureId": [a["posture"]],
            "AnimBodyParts": "None",
            "AnimGrabParts": "None",
            "AnimSlotDirection": "None",
            "AnimInfoList": [{
                "Gender": e["gender"],
                "AnimGrowthStep": e["growth"],
                "Animation": montage_path,
                "TotalPlayLength": round(length, 6),
                "LoopPlayLength": round(length, 6) if a["loop"] else 0,
                "RateScale": rate,
                "RandomLoopAnims": [],
            } for e in a["entries"]],
        }],
    }


def workspace_doc(row):
    """The editor-side copy of a row (Meta/<id>.workspace)."""
    return camel({k: row[k] for k in ("PlayingComponentName", "StartAnimSection", "StopOtherComponentOnFinish", "CharacterAnimConfigList")})


def patch_doc(table_struct, query, rows, version, keep=()):
    return {
        "Struct": table_struct,
        "BaseVersion": version,
        "SaveVersion": version,
        "PatchList": list(keep) + [{"Method": "Append", "Query": query, "Value": r, "Enabled": True} for r in rows],
    }


def write_data_files(mod_dir, rows, montages, version, dropped_ids=()):
    """Writes the Character Animation rows, their .workspace files and the montage metadata."""
    jp = os.path.join(mod_dir, "Content", "JsonPatch")
    auto = os.path.join(jp, TABLE + "_patch.autosave.json")
    real = os.path.join(jp, TABLE + "_patch.json")
    target = real if (os.path.isfile(real) and not os.path.isfile(auto)) else auto
    ours = {r["Id"] for r in rows} | set(dropped_ids)
    keep = []
    for p in (auto, real):
        if os.path.isfile(p):
            for e in read_json(p).get("PatchList", []):
                if (e.get("Value") or {}).get("Id") not in ours and e not in keep:
                    keep.append(e)
    write_json(target, patch_doc("AnimCharacter", TABLE, rows, version, keep))
    if target == auto and os.path.isfile(real):
        os.remove(real)   # one copy only, like the ModKit's own autosave sync

    mp = os.path.join(jp, "Montage_patch.json")
    if not os.path.isfile(mp):
        write_json(mp, patch_doc("Montage", "Montage", [], version))
    write_json(os.path.join(mod_dir, "Content", "MontageMeta", "Montages.json"),
               [{"MontagePath": mon, "AnimationPath": seq, "Notifies": []} for mon, seq in montages])

    meta = os.path.join(mod_dir, "Meta")
    for r in rows:
        write_json(os.path.join(meta, r["Id"] + ".workspace"), workspace_doc(r))
    for wid in dropped_ids:
        p = os.path.join(meta, wid + ".workspace")
        if os.path.isfile(p):
            os.remove(p)


def finish_project_files(mod_dir, plugin, job, ids):
    """Marks the workspaces as set up (so opening them in the ModKit does not re-copy the book row)
    and fills in the mod's details. FriendlyName stays as the ModKit made it: the ModKit finds the
    project's Meta/<FriendlyName>.mod file through it."""
    meta = os.path.join(mod_dir, "Meta")
    for f in os.listdir(meta):
        if f.endswith(".mod"):
            p = os.path.join(meta, f)
            doc = read_json(p)
            for w in doc.get("ModWorkspaces", []):
                if w.get("Id") in ids:
                    w["IsFirstCreated"] = 0
            write_json(p, doc)
    up = os.path.join(mod_dir, plugin + ".uplugin")
    doc = read_json(up)
    doc["Description"] = job["description"]
    doc["CreatedBy"] = job["author"]
    doc["VersionName"] = job["version"]
    write_json(up, doc)


def mod_workspaces(mod_dir):
    out = []
    meta = os.path.join(mod_dir, "Meta")
    if os.path.isdir(meta):
        for f in os.listdir(meta):
            if f.endswith(".mod"):
                out += read_json(os.path.join(meta, f)).get("ModWorkspaces", [])
    return out


# ------------------------------------------------------------------ editor stage (inside the ModKit)

def run_in_editor(job):
    import unreal

    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    sub = unreal.get_editor_subsystem(unreal.ModAutomationSubsystem)
    if sub is None:
        raise PackError("The ModKit automation subsystem is not available in this ModKit version.")
    mods_root = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir()), "Mods")
    version = read_modkit_version(mods_root)
    warnings = []

    plugin = job.get("plugin") or ""
    if plugin and not os.path.isfile(os.path.join(mods_root, plugin, plugin + ".uplugin")):
        warnings.append("The mod project %s from the last build is gone; creating a new one." % plugin)
        plugin = ""
    if not plugin:
        plugin = sub.create_mod_project(job["mod_name"], job["author"], job["description"])
        if not plugin:
            raise PackError("The ModKit could not create the mod project %s." % job["mod_name"])
    mod_dir = os.path.join(mods_root, plugin)
    dest = "/%s/Animations" % plugin
    anims = job["animations"]

    # Assets from earlier builds that are no longer in the pack.
    wanted = {a["asset"] for a in anims} | {a["montage"] for a in anims}
    if eal.does_directory_exist(dest):
        for p in eal.list_assets(dest, recursive=True, include_folder=False):
            if p.rsplit("/", 1)[-1].split(".")[0] not in wanted:
                eal.delete_asset(p)

    unreal.SystemLibrary.execute_console_command(None, "Interchange.FeatureFlags.Import.FBX False")
    skeleton = unreal.load_asset(SKELETON)
    if skeleton is None:
        raise PackError("The Zoi skeleton %s was not found in the ModKit." % SKELETON)
    loop_start = unreal.load_class(None, LOOP_START)
    loop_end = unreal.load_class(None, LOOP_END)

    rows, montages, built = [], [], []
    for a in anims:
        seq = import_fbx(unreal, tools, a["fbx"], dest, a["asset"], skeleton)
        names = {str(n) for n in unreal.AnimationLibrary.get_animation_track_names(seq)}
        tracks = len(names)
        if not all(b in names for b in ZOI_ONLY_BONES):
            raise PackError("%s was not exported on the Zoi skeleton (it has no %s bones), so it would twist the Zoi. Load "
                            "the Zoi body FBX as the character in the studio and export with Skeleton: 'Loaded character'."
                            % (a["anim_id"], "/".join(ZOI_ONLY_BONES)))
        mon = make_montage(unreal, tools, eal, seq, dest, a["montage"], a["loop"], a["fps"], loop_start, loop_end)
        length = mon.get_play_length()
        mon_path, seq_path = mon.get_path_name(), seq.get_path_name()
        rows.append(anim_row(a, mon_path, length))
        montages.append((mon_path, seq_path))
        built.append({"anim_id": a["anim_id"], "montage": mon_path, "sequence": seq_path, "length": round(length, 4),
                      "bone_tracks": tracks, "pelvis_height_cm": pelvis_height(unreal, seq)})

    ids = {a["anim_id"] for a in anims}
    existing = mod_workspaces(mod_dir)
    dropped = [w["Id"] for w in existing if w.get("Class") == WORKSPACE_CLASS and w.get("Id") not in ids]
    for wid in dropped:
        sub.delete_workspace(plugin, wid)
    have = {w.get("Id") for w in existing}
    for a in anims:
        if a["anim_id"] not in have:
            if not sub.add_workspace(plugin, "CHARACTER_ANIMATION", job["book"], a["anim_id"], a["anim_id"], "", False, False, "Character_Interaction"):
                raise PackError("The ModKit could not add the Character Animation entry %s (book %s)." % (a["anim_id"], job["book"]))

    if not sub.save_mod_project(plugin):
        warnings.append("The ModKit reported a problem saving the project; continuing with the files written by this tool.")
    eal.save_directory("/%s/" % plugin, only_if_is_dirty=False, recursive=True)
    write_data_files(mod_dir, rows, montages, version, dropped)
    finish_project_files(mod_dir, plugin, job, ids)
    return {"plugin": plugin, "mod_dir": mod_dir, "animations": built, "removed": dropped, "warnings": warnings, "modkit_version": version}


def read_modkit_version(mods_root):
    prop = os.path.join(os.path.dirname(mods_root), "Build", "Modkit.prop")
    if os.path.isfile(prop):
        with open(prop, encoding="utf-8-sig") as f:
            for line in f:
                if line.startswith("MODKIT_VERSION="):
                    return line.split("=", 1)[1].strip()
    return ""


def import_fbx(unreal, tools, fbx, dest, name, skeleton):
    ui = unreal.FbxImportUI()
    ui.set_editor_property("automated_import_should_detect_type", False)
    ui.set_editor_property("import_mesh", False)
    ui.set_editor_property("import_as_skeletal", True)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_ANIMATION)
    ui.set_editor_property("import_animations", True)
    ui.set_editor_property("import_materials", False)
    ui.set_editor_property("import_textures", False)
    ui.set_editor_property("skeleton", skeleton)
    ad = ui.get_editor_property("anim_sequence_import_data")
    ad.set_editor_property("animation_length", unreal.FBXAnimationLengthImportType.FBXALIT_EXPORTED_TIME)
    ad.set_editor_property("import_bone_tracks", True)
    ad.set_editor_property("remove_redundant_keys", False)
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", fbx)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    task.set_editor_property("options", ui)
    tools.import_asset_tasks([task])
    for p in task.get_editor_property("imported_object_paths"):
        asset = unreal.load_asset(p)
        if isinstance(asset, unreal.AnimSequence):
            return asset
    raise PackError("Importing %s produced no animation (the ModKit log has the FBX importer's reason)." % os.path.basename(fbx))


def make_montage(unreal, tools, eal, seq, dest, name, loop, fps, loop_start, loop_end):
    path = "%s/%s" % (dest, name)
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
        unreal.SystemLibrary.collect_garbage()
    fac = unreal.AnimMontageFactory()
    fac.set_editor_property("source_animation", seq)
    fac.set_editor_property("target_skeleton", seq.get_editor_property("skeleton"))
    mon = tools.create_asset(name, dest, unreal.AnimMontage, fac)
    if mon is None:
        raise PackError("The ModKit could not create the montage %s." % name)
    if loop and loop_start and loop_end:
        # inZOI marks the looping part of a montage with these two notifies (see its StartLoopEnd montages).
        unreal.AnimationLibrary.add_animation_notify_track(mon, "Loop")
        unreal.AnimationLibrary.add_animation_notify_event(mon, "Loop", 0.0, loop_start)
        unreal.AnimationLibrary.add_animation_notify_event(mon, "Loop", max(0.0, mon.get_play_length() - 0.5 / float(fps or 30)), loop_end)
    eal.save_asset(mon.get_path_name(), only_if_is_dirty=False)
    return mon


def export_zoi_body(out_path):
    """Writes the ModKit's Zoi body (SKM_Base_Body on SK_Base) as FBX, for the studio's Import > Use as character.
    The file stays on this PC; it is KRAFTON content from the player's own ModKit install."""
    import unreal
    mesh = unreal.load_asset(ZOI_BODY)
    if mesh is None:
        raise PackError("The Zoi body %s was not found in the ModKit." % ZOI_BODY)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    opts = unreal.FbxExportOption()
    opts.set_editor_property("ascii", False)
    opts.set_editor_property("collision", False)
    opts.set_editor_property("level_of_detail", False)
    opts.set_editor_property("export_morph_targets", False)
    task = unreal.AssetExportTask()
    task.set_editor_property("object", mesh)
    task.set_editor_property("filename", out_path)
    task.set_editor_property("automated", True)
    task.set_editor_property("prompt", False)
    task.set_editor_property("replace_identical", True)
    task.set_editor_property("options", opts)
    if not unreal.Exporter.run_asset_export_task(task) or not os.path.isfile(out_path):
        raise PackError("The ModKit could not export the Zoi body to %s." % out_path)
    return {"fbx": out_path, "size": os.path.getsize(out_path)}


def pelvis_height(unreal, seq):
    """Height of the pelvis above the root on frame 0 in cm (about 90-100 for a standing adult)."""
    try:
        al = unreal.AnimationLibrary
        w = unreal.MathLibrary.compose_transforms(al.get_bone_pose_for_frame(seq, "pelvis", 0, False),
                                                  al.get_bone_pose_for_frame(seq, "root", 0, False))
        return round(w.translation.z, 2)
    except Exception:
        return None


def editor_main():
    job_path = os.environ["ZAF_MODKIT_JOB"]
    job = read_json(job_path)
    result_path = job.get("result") or os.path.join(os.path.dirname(job_path), "result.json")
    try:
        res = export_zoi_body(job["out"]) if job.get("task") == "export_skeleton" else run_in_editor(job)
        res["ok"] = True
    except PackError as e:
        res = {"ok": False, "error": str(e)}
    except Exception as e:
        res = {"ok": False, "error": "%s: %s" % (type(e).__name__, e), "trace": traceback.format_exc()[-2000:]}
    write_json(result_path, res)
    import unreal
    unreal.log("ZAF_MODKIT_RESULT " + json.dumps({"ok": res.get("ok"), "error": res.get("error")}))


def cli_main(argv):
    import argparse
    ap = argparse.ArgumentParser(description="Check a Studio pack and write the ModKit build job.")
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("plan")
    p.add_argument("--pack", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--mod-name")
    p.add_argument("--author")
    p.add_argument("--plugin")
    p.add_argument("--book", default=BOOK)
    p.add_argument("--result")
    a = ap.parse_args(argv)
    try:
        job = plan(a.pack, a.mod_name, a.author, a.plugin, a.book)
    except PackError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 2
    job["result"] = a.result or os.path.join(os.path.dirname(os.path.abspath(a.out)), "result.json")
    write_json(a.out, job)
    print(json.dumps({"ok": True, "mod_name": job["mod_name"], "animations": len(job["animations"]), "skipped": job["skipped"]}))
    return 0


if __name__ == "__main__":
    try:
        import unreal  # noqa: F401  (only importable inside the editor)
        IN_EDITOR = True
    except ImportError:
        IN_EDITOR = False
    if IN_EDITOR:
        editor_main()
    else:
        sys.exit(cli_main(sys.argv[1:]))
