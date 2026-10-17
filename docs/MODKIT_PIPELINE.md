# ModKit pipeline: from a studio pack to a permanent mod

Status: prototype working, checked on this PC on 2026-10-17 against inZOI ModKit `20261011.16078.W.MODKIT.EGS` (Unreal Engine 5.6.1 inside the ModKit).

## Short answer

**Yes, the manual ModKit step can be fully automated** for interaction and pose animations. `tools/modkit/build_mod.ps1` turns an exported pack (`Animations/*.fbx` + `zaf_pack.json`) into an installed mod in about 1.5 minutes. It never opens the ModKit window:

| Stage | What runs | Time on this PC |
|---|---|---|
| Check the pack | the ModKit's bundled `python.exe` | about 1 s |
| Project, FBX import, montages, data rows | `UnrealEditor-Cmd.exe -run=pythonscript` (the ModKit editor with no window) | 20-75 s (75 s on the first, cold run) |
| Cook, pak, install | the ModKit's own `RunUAT PackageUGC` (the Package button's command line) | 60-70 s |

What is **not** done yet (details in [Remaining work](#remaining-work)):

1. Nothing has been checked inside inZOI yet. This session was not allowed to launch the game.
2. Packs must be exported **bone-for-bone on the Zoi skeleton** (Skeleton: *Loaded character* with the Zoi body loaded). The studio's *Unreal mannequin names* preset gives the right bone names but the wrong bone axes, and the Zoi comes out twisted. The tool refuses such packs. Exporting the Zoi body for the studio is automated (`-ExportZoiSkeleton`), but loading it in the studio is still a manual click.
3. Locomotion and Stat Locomotion scenes are skipped (reported as such). Only Interaction and Pose rows are built.
4. The studio has no button for this yet. The bridge endpoints exist; the UI was out of scope for this task.

## Requirements

* **inZOI ModKit** from the Epic Games Store, free, about 100 GB installed (`InstallSize` 100,241,143,837 bytes). On this PC it is at `C:\Users\MSI\Documents\inZOIModKit`. The tool finds it from the Epic Launcher manifests (`C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item`, `DisplayName` = `inZOI ModKit`), or from `-ModKitRoot` / `%ZAF_MODKIT_ROOT%`.
* The ModKit window must be **closed** while a build runs. Both would write the same project; the tool checks for this and stops with a message.
* Nothing else. PowerShell 5.1 and the ModKit's own Python 3.11 are used; no extra installs.

## Using it

Command line:

```
powershell -ExecutionPolicy Bypass -File tools\modkit\build_mod.ps1 -Pack "C:\Users\<you>\Documents\Zoi Motion Studio\Exports\<pack id>"
```

| Option | Effect |
|---|---|
| `-OutDir <folder>` | Install somewhere else than `Documents\inZOI\Mods`. |
| `-NoPackage` | Stop after the ModKit project is built (it then opens in the ModKit GUI like any other project). |
| `-StatusFile <json>` | Write progress (`state` = running / done / error, `step`, `message`) for a UI. |
| `-ModName`, `-Author` | Override the project name and author (defaults come from `zaf_pack.json`). |
| `-ExportZoiSkeleton [-SkeletonOut <fbx>]` | Export the ModKit's Zoi body (`SKM_Base_Body` on `SK_Base`) to FBX, by default to `Documents\Zoi Motion Studio\Characters\Zoi body (inZOI ModKit).fbx`, for the studio's *Import > Use as character*. About 35 s. The file stays on this PC; it is KRAFTON content from the player's own ModKit. |

Studio bridge (`bridge/server.ps1`). Paths are relative to `Documents\Zoi Motion Studio`. POST requests must come from the studio page, like the other write endpoints:

| Endpoint | Does |
|---|---|
| `POST /api/modkit/build?path=Exports/<pack id>` | Starts a build of that pack in a hidden process and returns at once. 409 if a build is already running; 400 if the folder has no `zaf_pack.json`. |
| `POST /api/modkit/skeleton` | Starts `-ExportZoiSkeleton` into `Documents\Zoi Motion Studio\Characters`. |
| `GET /api/modkit/status?path=Exports/<pack id>` | The build's status JSON (`state`, `step`, `message`, and when done `plugin`, `installed`, `animations`, `seconds`). Without `path`, it reports the skeleton export (`Characters`). `{"state":"idle"}` if nothing ran. |

Both POST endpoints answer 503 with "The ModKit tools are not installed" when `tools\modkit` is missing next to `bridge\`. The bridge itself starts either way. For the installed app to build mods, the installer has to ship `tools\modkit\build_mod.ps1` and `tools\modkit\zaf_modkit.py`.

A build installs the mod as `Documents\inZOI\Mods\<project>` (for example `ZAF_Cute_Couple_1A2B3C4D`). This is the same top-level folder Vortex installs mods into on this PC. The ModKit's own Package button uses `Documents\inZOI\Mods\<CurseForge user id>` instead (`88849` here). Restart inZOI to load a new or rebuilt mod.

Rebuilding a pack updates the same project and mod folder: `<pack>\modkit_build.json` remembers the project name. Each build leaves `job.json`, `result.json`, `status.json` and the two logs (`modkit_editor.log`, `modkit_package.log`) in `<pack>\modkit_build\`.

## How it works

### 1. Check the pack (`zaf_modkit.py plan`)

* `zaf_pack.json` must be version 1 and exported with `skeleton: "character"` (see [Skeleton](#skeleton-bone-for-bone-or-nothing)).
* One Character Animation row is planned per animation used by an `interaction` or `pose` scene. Each row's id is the manifest's `anim_id`, which is what the Zoi Animation Framework panel plays. Ids must be letters, digits and `_`; the studio's `slug()` already guarantees this.
* Anim Info List entries come from the actor slot. Gender `Any` gives one `Female` and one `Male` entry; growth `Adult` and `Teen` use `AnimGrowthStep` `Adult`; `Child` uses gender `Default` with `AnimGrowthStep` `Youth`. This mirrors inZOI's own rows: the `Self_Angry` row has Female/Adult, Male/Adult and Default/Youth entries.
* A stage marked `loop` gets loop markers on its montage (see step 2).

### 2. Build the ModKit project, headless (`zaf_modkit.py` inside the editor)

```
UnrealEditor-Cmd.exe inZOIModKit\inZOIModKit.uproject -run=pythonscript -script=<zaf_modkit.py with forward slashes>
  -Installed -unattended -nop4 -nosourcecontrol -nosplash
```

The job file is passed in `%ZAF_MODKIT_JOB%`. The `-script` path must use forward slashes: the editor reads `\t` in `...framework\tools\...` as a tab character.

1. **Project.** `unreal.ModAutomationSubsystem.create_mod_project(name, author, description)` returns the plugin name `<name>_<8 hex>`. The ModKit mounts the new plugin on the spot, so `/<plugin>/` can be written to at once.
2. **FBX import onto the Zoi skeleton.** `AssetImportTask` with `FbxImportUI` (animation only, skeleton `/Game/Characters/Skeletons/SK_Base`, exported time range, no key reduction) into `/<plugin>/Animations/ANIM_<anim_id>`. This is the same API KRAFTON's own `Data/EditorScripts/CAZ/ImportSkeletalMesh.py` uses. The Interchange FBX importer is on by default in this ModKit (`Interchange.FeatureFlags.Import.FBX` = true), so the script switches it off for the run to get the legacy FBX importer these options belong to.
3. **Zoi-skeleton check.** The imported animation must have tracks for `spine_04`, `spine_05` and `neck_02`. Only the Zoi skeleton has these; the studio's canonical and Unreal-name rigs stop at `spine_03` / `neck_01`. Otherwise the build stops with an explanation instead of shipping a twisted Zoi.
4. **Montage.** `AnimMontageFactory` (source = the sequence, target skeleton = SK_Base) gives `ANIM_<anim_id>_Interaction_Montage` with one `Default` section on `DefaultSlot`, the slot inZOI's own montages use. For looping stages it adds `B1AnimNotify_LoopStart` at 0 s and `B1AnimNotify_LoopEnd` half a frame before the end on a `Loop` notify track. These are the notifies inZOI's own `..._StartLoopEnd_...` montages use.
5. **Workspace registration.** `add_workspace(plugin, "CHARACTER_ANIMATION", "Self_Angry", <anim_id>, <anim_id>, "", False, False, "Character_Interaction")` adds a Character_Interaction workspace to the project's `.mod` (TableName `AnimCharacter_Interaction`), so the project looks normal in the ModKit GUI. Workspaces that are no longer in the pack are removed with `delete_workspace`.
6. **Save.** `save_mod_project`, then `EditorAssetLibrary.save_directory`.
7. **Data files.** These are written by the script, in exactly the layout the ModKit produced in tests (see [Files](#files-in-a-built-project)), because the ModKit calls that fill them need the GUI (see [Automation surface](#modkit-automation-surface)). The `.mod` workspaces get `IsFirstCreated: 0`, so opening one in the GUI does not copy the book row over ours.

### 3. Cook, package, install (`RunUAT PackageUGC`)

The exact command line the ModKit's Package button runs (taken from its log), with our install folder:

```
RunUAT.bat PackageUGC -Prepare=true -ugc_cook -TargetPlatform=Windows -Migration
  -StagingDirectory="<ModKit>\inZOIModKit\Mods\<plugin>" -ExportToGameMods="<Documents>\inZOI\Mods"
  -nocompileeditor -skipbuildeditor -installed -NoCompile -NoZenDDC -ddc=NoZenLocalFallback -nocompile -nocompileuat
```

`PackageUGC` (source: `inZOIModKit\Build\Scripts\PackageUGC.automation\PackageUGC.cs`) runs these steps:
1. The `inZoiMigrationCommandlet` (about 30 s).
2. A DLC cook of the plugin against the `UGCExampleGame_v1` release (about 20 s).
3. UnrealPak into `.pak/.ucas/.utoc`.
4. `Content/**/*.json` copied to `non_ufs/`.
5. `mod_manifest.json` with file checksums.
6. `inZoiModKitExportAssetHashCommandlet` for `mod_assethash.json` (about 20 s).
7. A zip, which is then extracted into `-ExportToGameMods`, replacing any older copy of that mod.

## Files in a built project

`<ModKit>\inZOIModKit\Mods\<plugin>\`:

| File | Content |
|---|---|
| `<plugin>.uplugin` | Written by `create_mod_project`. The tool sets `Description`, `CreatedBy` and `VersionName`. **`FriendlyName` must stay as created**: the ModKit finds `Meta\<FriendlyName>.mod` through it, and changing it breaks the project (seen in testing). |
| `Meta\<name>.mod` | Project and workspace list (`Class: Character_Interaction`, `BookId: Self_Angry`, `TableName: AnimCharacter_Interaction`). |
| `Meta\<anim_id>.workspace` | Editor copy of each row, camelCase keys (`playingComponentName`, `startAnimSection`, `stopOtherComponentOnFinish`, `characterAnimConfigList`). |
| `Content\Animations\ANIM_<anim_id>.uasset` | AnimSequence on SK_Base. |
| `Content\Animations\ANIM_<anim_id>_Interaction_Montage.uasset` | AnimMontage (`Default` section, `DefaultSlot`, loop notifies when looping). |
| `Content\JsonPatch\AnimCharacter_Interaction_patch.autosave.json` | The rows. The `.autosave.json` name is what this ModKit version writes and ships (the third-party mods installed on this PC ship `.autosave.json` patches too). |
| `Content\JsonPatch\Montage_patch.json` | `{"Struct":"Montage", ..., "PatchList": []}`. The ModKit leaves it empty for new montages too. |
| `Content\MontageMeta\Montages.json` | `[{"MontagePath": "/<plugin>/Animations/..._Montage.<name>", "AnimationPath": "/<plugin>/Animations/ANIM_<id>.<name>", "Notifies": []}]`. The ModKit lists LoopStart/LoopEnd as `Notifies: []` as well. |

One row, here for an example pack (`Struct: AnimCharacter`, `Method: Append`, `Query: AnimCharacter_Interaction`, `BaseVersion`/`SaveVersion` = `MODKIT_VERSION` from `inZOIModKit\Build\Modkit.prop`):

```json
{
  "Id": "cutecouple_hug_s2_a",
  "Comment": "Studio: Hug / Hold / Zoi A",
  "AttachMeshInfos": [],
  "PlayingComponentName": "Root",
  "StopOtherComponentOnFinish": false,
  "StartAnimSection": "Default",
  "CharacterAnimConfigList": [{
    "AnimPostureId": ["Stand"],
    "AnimBodyParts": "None", "AnimGrabParts": "None", "AnimSlotDirection": "None",
    "AnimInfoList": [{
      "Gender": "Female", "AnimGrowthStep": "Adult",
      "Animation": "/ZAF_Cute_Couple_1A2B3C4D/Animations/ANIM_cutecouple_hug_s2_a_Interaction_Montage.ANIM_cutecouple_hug_s2_a_Interaction_Montage",
      "TotalPlayLength": 4.666667, "LoopPlayLength": 4.666667, "RateScale": 1, "RandomLoopAnims": []
    }]
  }]
}
```

`TotalPlayLength`, `LoopPlayLength` and `RateScale` are marked "auto-filled" in the ModKit; the editor fills them when you pick a montage in the details panel. Rows copied from the base game have 0 there, because the base game gets lengths from its cooked Montage table. A mod montage has no Montage table row, so the tool fills them from the montage: length, length again for looping stages, and the scene's rate scale.

The packaged mod (`Documents\inZOI\Mods\<plugin>\`) has the same layout as the ModKit-built mods already installed on this PC: `<plugin>.uplugin`, `mod_manifest.json`, `mod_assethash.json`, `Content\Paks\Windows\<plugin>inZOIModKit-Windows.pak/.ucas/.utoc` and `non_ufs\JsonPatch\*`, `non_ufs\MontageMeta\Montages.json`.

## What was verified

| Check | Result |
|---|---|
| Headless Python in the ModKit (`-run=pythonscript`) | Works: 75 s cold, 20-25 s warm. |
| `create_mod_project`, `add_workspace`, `delete_workspace`, `save_mod_project`, `duplicate_data_row` headless | Work. |
| FBX import onto SK_Base into a new mod plugin | Works. |
| Montage + LoopStart/LoopEnd notifies | Created and saved; the `Default` section is on `DefaultSlot`. |
| Full pack with 7 animations (1-Zoi, 2-Zoi with a looping stage, child pose, locomotion) | 6 rows built, locomotion skipped with a message, packaged and installed into a test folder (not the game): 82 s total. |
| **Round trip:** a game animation (`ANIM_F_Bath_Clean`) exported from the ModKit to FBX, built as a pack, then compared with the original | All 157 shared bones identical over 5 sampled frames: max 0.0003 deg rotation, 0.0 cm translation. Pelvis 93.14 cm in both. |
| Rebuild of the same pack | Reuses the project and mod folder; no duplicate workspaces or rows. |
| `-ExportZoiSkeleton` | Writes the Zoi body FBX (3.5 MB) in 34 s; needs `-AllowCommandletRendering`, which the tool passes. |
| Bridge endpoints (test instance on another port) | Status idle; 400 without `zaf_pack.json`; path traversal refused; 403 for a foreign Origin; 405 for GET on build. A full build through the bridge was not run, because it would install into the real game folder. |
| In-game playback | **Not checked** (inZOI must not be launched from this session). |

The test projects created in the ModKit while checking this were deleted afterwards.

## Skeleton: bone-for-bone or nothing

`SK_Base` uses UE-mannequin bone names (`root`, `pelvis`, `spine_01`...`spine_05`, `neck_01`, `neck_02`, `head`, `clavicle_l`, `upperarm_l`, ...) plus many helper and corrective bones. The fixture `tests/fixtures/walk_unreal.fbx` imports without errors (53 tracks). But evaluated on SK_Base, the head sits level with the pelvis instead of about 66 cm above it. The *Unreal mannequin names* preset keeps the studio's T-pose bone axes, while SK_Base's bones have their own axes, so every rotation lands in the wrong frame. Bone names alone are not enough.

The *Loaded character* preset bakes onto the loaded model's own rest pose and keeps its bone names. With the Zoi body FBX loaded, that is bone-for-bone, as the round-trip test shows. The tool therefore accepts only `skeleton: "character"` packs, and it double-checks the result with the Zoi-only bones.

Helper bones that game animations also key (for example `*_bulge`, `*_half`, `*_twistCor_*`; 207 of them in `ANIM_F_Bath_Clean`) are not in the studio's export. They stay at their reference pose unless the game's post-process animation drives them.

## ModKit automation surface

What the ModKit offers for automation, and what was used:

* **`unreal.ModAutomationSubsystem`** (editor subsystem in `inZOIModKitEditor`, callable from Python): `create_mod_project`, `get_mod_projects`, `get_mod_books`, `add_workspace`, `open_workspace`, `delete_workspace`, `duplicate_data_row`, `append_data_row`, `remove_data_row`, `override_data_field`, `override_data_field_number`, `set_workspace_field`, `save_mod_project`, `package_mod_project`, `import_mesh_asset`, `validate_workspace`, `inspect_workspace`, and BUILD/blueprint/material and Fab capture helpers. Behaviour in a commandlet (no UI):
  * Works: `create_mod_project`, `get_mod_books` (4,650 `CHARACTER_ANIMATION` books), `add_workspace` with `open_workspace=False`, `duplicate_data_row`, `delete_workspace`, `save_mod_project`.
  * Crashes the editor (`Assertion failed: IsValid()` in SharedPointer.h): `set_workspace_field` on a closed workspace, and `open_workspace`. Both need the workspace UI. Just before crashing, `open_workspace` writes the montage metadata; that output is how the `Montages.json` format above was learned.
  * Wrong for arrays: `override_data_field` stores an array value as a JSON string (`"CharacterAnimConfigList": "[...]"`), which the game cannot read. Rows are therefore written as JSON by the tool.
* **ModKit MCP server**: an HTTP MCP server built into the editor at `http://127.0.0.1:11213/mcp` (128 tools; docs in `inZOIModKit\Data\Tools\mcp\modkit\`). It covers projects, workspaces, data rows, mesh import, Lua, packaging and CurseForge publishing, but has no animation FBX import tool. It is built for an AI client talking to a running editor session. It also starts inside commandlets, but driving it there was not tried, because the subsystem above gives the same calls directly. It is not needed for this pipeline. The animation workspace docs it serves are `workspace_docs/ws_animation.md` and `datatable_docs/18_anim.md`.
* **Packaging**: `package_ugc.bat <ModName>` in the ModKit root wraps the same `PackageUGC` command, but always exports to `<ModKit>\output`. The tool calls `RunUAT` directly to pick the install folder.
* **Editor commandlets used by packaging**: `inZoiMigrationCommandlet`, `Cook`, `inZoiModKitExportAssetHashCommandlet`.
* **Mod discovery**: every `Mods\*\*.uplugin` is mounted at editor start ("Mounting Mod plugin ..."), and `create_mod_project` mounts new ones on the spot.
* **Docs**: mod-docs.playinzoi.com's Character Animation pages only list the fields (Playing Component Name, Start Anim Section, Anim Posture Type, Anim Info List: Gender, Anim Growth Step, Animation, Total/Loop Play Length, Rate Scale). They do not cover import, montage setup or ids. Everything above was worked out from the ModKit's own files, logs and test runs.

## Remaining work

These are the exact remaining steps, in the order they block a true one-click flow from the studio:

1. **Test in inZOI** (needs the player). Build a real pack, restart inZOI, then check:
   * the mod appears in the mod list;
   * the Zoi Animation Framework panel plays each `anim_id`;
   * looping stages loop, through the framework's `PlayLoopAnim` hidden interaction;
   * female, male and child Zois get their entries, and teens use the Adult entries.
   If `PlayLoopAnim` turns out to need a real `Loop` montage section, see item 5.
2. **Studio export with the Zoi skeleton.** Either:
   * (a) after `POST /api/modkit/skeleton`, have the studio load `Characters\Zoi body (inZOI ModKit).fbx` as the character automatically and preselect *Loaded character*; or
   * (b) ship SK_Base's rest pose (bone names, parents, local rest transforms; extractable headlessly from the ModKit) inside the studio, so the export can bake onto it without the FBX.
   (b) also makes the *Unreal mannequin names* preset obsolete for inZOI. Until one of them lands, the user loads the FBX by hand once (*Import > Use as character*).
3. **Studio button.** An *Export > Build permanent mod* action that saves the pack, calls `POST /api/modkit/build?path=Exports/<pack id>`, and polls `GET /api/modkit/status` (states: running / done / error; builds take about 1.5 minutes). It should show the ModKit-not-installed and ModKit-is-open messages as they come back.
4. **Locomotion / Stat Locomotion.** These rows replace how all Zois of a gender and age idle or walk, so they need a design decision first (override the default `Adult_F`/`Adult_M` rows, or add `IdleRandomAnims` / `StatLocomotions` entries). They also take AnimSequences rather than montages. Today they are skipped with a message, and the setup sheet still covers them.
5. **Montage sections.** Stock UE Python cannot add montage sections (`CompositeSections` is not exposed), so each montage has one `Default` section, and loops are marked only with inZOI's LoopStart/LoopEnd notifies. This fits the framework, which plays every stage as its own row. If inZOI needs real `Loop`/`End` sections, the options are:
   * a small editor plugin;
   * duplicating one of KRAFTON's `StartLoopEnd` template montages, which cannot be re-pointed from Python either.
6. **Root motion.** `rootMotion: keep` packs import with root motion off (the default), so travel is played as pelvis motion. Turning it on per scene is one property (`enable_root_motion`) once in-game tests show which inZOI expects.
7. **ModKit updates.** The tool depends on `ModAutomationSubsystem` names, the `Self_Angry` book, `SK_Base` and the file layouts above. A ModKit update that renames them makes the build stop with a message, and the editor log path is in the status. `MODKIT_VERSION` is read at build time, so patch version stamps follow the installed ModKit.
