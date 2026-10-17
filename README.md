# Zoi Animation Studio

Make any animation for inZOI's Zois — no 3D experience needed.

Zoi Animation Studio has two halves:

* **Studio**: make animations on your PC.
* **The Zoi Animation Studio mod**: an in-game Animations panel that plays them on any Zoi, including multi-Zoi scenes.

**Studio** is a Windows animation editor. You pose your Zoi like a doll, set keys on a timeline, act motions out on a webcam, describe them in words, or bring in Mixamo, mocap and VRM animations. Then you can:

* **see it live on your Zoi in the running game** through inZOI's built-in Motion Capture, or
* **export an inZOI pack**: FBX files, a pack manifest and a step-by-step ModKit setup sheet, to make it a permanent mod.

> Unofficial fan project. Not affiliated with KRAFTON or inZOI Studio.

## Documentation

* **[Studio user guide](docs/USER_GUIDE.md)**: install, every panel, tool, menu, shortcut and dialog, Describe a motion (AI), Act it out, import, multi-Zoi scenes, export and troubleshooting, with screenshots.
* **[Getting your animations into inZOI](docs/ANIMATIONS_IN_INZOI.md)**: the live link, a step-by-step inZOI ModKit walkthrough, the in-game Animations panel, multi-Zoi scenes and a reference for modders who ship packs.
* [File formats](docs/PACK_FORMAT.md) (`.zmotion`, `zaf_pack.json`) and the [automatic ModKit build prototype](docs/MODKIT_PIPELINE.md).

The guides are also installed with the app, in the `docs` folder of Studio's install folder.

---

## Install

Run **`Studio-Setup-1.1.1.exe`** (or newer) and follow the setup wizard. It installs for your Windows account only (no administrator prompt), adds **Studio** to the Start menu (and the desktop if you tick it), and can optionally install the in-game framework mod when inZOI is found.

* Needs Windows 10 or 11 (64-bit) and the Microsoft Edge WebView2 Runtime, which is built into Windows 11. Setup tells you if it's missing.
* Windows may show "Windows protected your PC" the first time, because the installer isn't code-signed yet: choose **More info → Run anyway**.
* **The AI for Describe a motion** is downloaded during setup (the "Download the AI" box, ticked by default). Setup installs a private copy of Python and PyTorch (the NVIDIA GPU build when your PC has a supported card) and the MSFlow model, all inside Studio's own folder: about 4 GB to download (6.5 GB on disk) with an NVIDIA card, about 1 GB without. On an RTX 4080 a 5-second motion takes about 2 seconds; without an NVIDIA card it runs on the processor and takes longer. It needs the internet once and runs offline afterwards. If you untick it or the download fails, open **Describe a motion** in Studio and click **Download AI model** later. Uninstalling removes it.
* Your work is kept when you uninstall: projects and exports in `Documents\Zoi Motion Studio`, autosave, preferences and saved poses in `%LOCALAPPDATA%\Zoi Motion Studio`.

To build the installer yourself: install [Inno Setup](https://jrsoftware.org/isinfo.php) 6.7 or newer, then run `powershell -ExecutionPolicy Bypass -File installer\build.ps1`. The result is in `dist\`. The app's icon comes from `studio\assets\logo.png` when that file exists.

## Quick start

1. Open **Studio** from the Start menu. (From a downloaded folder instead, double-click **`Start Studio.bat`**: a small window opens, keep it open, and the studio opens in your browser.)
2. Click a body part on the Zoi and **drag it**. Hands and feet reach (IK); drag the hips to crouch while the feet stay planted.
3. Move the teal playhead on the timeline, pose again. **Auto-key** saves every change as a key.
4. Press **Space** to play.
5. **Live in inZOI** (top bar) streams to your Zoi; **Export** builds a pack.

The app opens in its own window and also works offline. Behind it, a small helper runs on Windows PowerShell (which every Windows PC has) for the live link, saving and inZOI detection; it starts and stops with the window.

---

## What's inside

### Characters
* Every Zoi is shown as a **realistic anatomical posing figure** (male or female, grey with a centre line, like a drawing-reference model), scaled to the Zoi's size so contacts and partner poses line up. You can pick a different look per Zoi: the real inZOI body (loaded from your game folder when inZOI is installed), your own FBX/GLB/VRM character, the ModKit's Zoi bodies, or the posing mannequin.
* A see-through skeleton overlay shows exactly which joint you are grabbing.

### Posing
* Direct manipulation: drag limbs to swing them, drag hands and feet to reach with IK, drag the hips to move the body with planted feet.
* Rotation rings and a Move tool for precise control (`E` / `W`).
* Friendly sliders per body part ("Raise arm", "Bend knee", "Turn head") that behave predictably at any angle.
* Live pose viewer with clickable joints, finger-by-finger control, mirror left ↔ right, copy/paste poses, save your own poses.

### Animating
* Dope-sheet timeline: summary row, body-part rows that expand into single bones, box select, drag keys to retime, right-click easing (smooth, linear, ease in/out, overshoot, hold).
* Auto-key, onion skin, motion paths, playback speed, loops.
* **Stages**: chain parts (approach → loop → let go). They map to the montage sections `Default` / `Loop` / `End` used by inZOI.
* **Multi-Zoi scenes**: up to 6 Zois per scene, each with its own track, placed relative to each other (hugs, handshakes, dances).
* Tools: mirror the animation, reverse it, make the loop seamless, simplify keys, change the speed or frame rate.
* Undo/redo everything, plus autosave.

### Library
* **My poses**: save any pose you make and reuse it on any frame or Zoi (mirrored too), shown as 3D thumbnails.
* **Motions**: describe a motion in words (AI), act it out on a webcam or video, or import an animation file.
* Reference props (chair, sofa, bed, table, counter, stool, step, wall) for lining up contact animations.

### Act it out
* Record yourself with a **webcam**, or turn **any video of a person** (a dance, a sport move…) into an editable animation. Your Zoi copies you live while you record, and on your Zoi in inZOI too when the live link is on. This uses Google's MediaPipe pose tracker; the first use needs an internet connection to fetch it.

### Import
* FBX (Mixamo and others), GLB/glTF, VRM, VRMA (VRM Animation) and BVH mocap. The skeleton is recognised and retargeted automatically (Unreal, Mixamo, VRM, Blender-style and mocap naming), with a bone-mapping table for anything unusual.
* Load a character as the display model, such as the real inZOI body-tracking Zoi, found automatically in your game folder.

### Get it into inZOI
* **Live link**: streams the studio to the selected Zoi through inZOI's Motion Capture receiver (VMC protocol, UDP 39539). Great for photos, videos and testing.
* **Export**: FBX on the skeleton of your choice (a loaded character such as the ModKit's Zoi skeleton, Unreal mannequin names, inZOI body-tracking names, VRM or Mixamo names), GLB, BVH, plus `zaf_pack.json` and a **ModKit setup sheet** listing exactly what to enter in the inZOI ModKit (Interaction / Locomotion / Stat Locomotion, Gender, Growth Step, play lengths…).

---

## In-game: the Zoi Animation Studio mod

`runtime/ZoiAnimFramework` is an inZOI mod (Lua + UI) that adds an **Animations** panel to the game:

* **Animations**: search and play any animation the game knows, or your packs' animations, on any Zoi (you, your household, or anyone nearby). Favorites, loop and *Hold still* (pauses free will).
* **Scenes**: pick a multi-Zoi scene from a pack and assign a Zoi to each role. The framework lines them up face to face, freezes their free will and plays the stages in order. Skip to the next stage or stop at any time.
* **Studio**: shows whether Studio and the framework's Lua director are running, and reloads packs.
* **Packs** appear under *My packs* and on the Scenes tab. Install them from the studio (**Export → Install into my game**), or ship them as separate mods: a pack mod registers its manifest from `lua/B2/ZAF_Packs.lua` returning `{ register = function(api) api.add(<pack manifest table>) end }`. The framework collects every installed pack, like AAF packs in Fallout 4. See [the modder reference](docs/ANIMATIONS_IN_INZOI.md#8-for-modders-shipping-a-pack-as-its-own-mod).

The studio's **Export → Install into my game** installs the framework mod into `Documents\inZOI\Mods\InGame\ZoiAnimFramework` the first time.

How it plays animations: inZOI's console animation commands (`motion.play`, `pose.set_bone`, `movement.teleport`) are cheat-only, so they do nothing for normal players. The framework therefore uses only supported routes. It creates a hidden "play this animation" interaction at runtime with `data.patch` (never written to your save), the Lua director queues it on the Zoi, and the director aligns Zois with the Lua `Teleport` call.

> Status: built on inZOI's official Lua/UI-mod templates and API definitions (game v0.11, Oct 2026). Testing inside the game is the next step.

## Blender add-on (Zoi Motion Bridge)

For creators who use Blender with KRAFTON's official inZOI Blender plugin: `blender/zoi_motion_bridge.zip` adds a **Zoi Motion** tab to Blender's sidebar (`N`).

* **Import .zmotion**: puts any scene, stage and Zoi from a studio project onto any armature. That includes the inZOI skeleton imported with the official plugin, rigs in A-pose or T-pose, and any scale or bone naming, with automatic bone mapping and editable presets.
* **Export for inZOI ModKit**: one click writes an FBX with Unreal-friendly settings.

Install it from *Edit → Preferences → Get Extensions → ⌄ → Install from Disk* (Blender 4.2 or newer). Details are in `blender/README.md`. The test suite (`tests/blender/test_zoi_motion_bridge.py`) runs headless and checks retargeting to within 0.01 mm.

## Getting animations into the game

| Way | Effort | Permanent? |
|---|---|---|
| **Live link** | Turn on Motion Capture in inZOI, press *Start streaming* | No: lasts while the studio streams |
| **ModKit** | Export a pack, follow the setup sheet in the inZOI ModKit (free on the Epic Games Store) | Yes: a real mod you can share on CurseForge |

For a bone-for-bone match with in-game Zois, export the ModKit's Zoi body (`SKM_Base_Body` on `SK_Base`) to FBX once, load it on every Zoi in the studio (**Import → Use as character**), and export with **Skeleton: Loaded character**. The whole route, step by step, is in [Getting your animations into inZOI](docs/ANIMATIONS_IN_INZOI.md).

---

## Folder layout

```
Start Studio.bat               launcher for running from this folder (no install)
installer/                     Windows app (native window, installer/launcher) and installer (Inno Setup)
ai/                            Describe a motion: AI server (MSFlow), setup script, pinned model list
studio/                        the studio (HTML/JS, three.js vendored in studio/vendor)
bridge/server.ps1              local helper: serves the studio, live link, saving, inZOI detection
runtime/ZoiAnimFramework/      the in-game mod (Lua director + Animations panel)
blender/                       Blender add-on: apply .zmotion projects to any armature, export for the ModKit
docs/USER_GUIDE.md             the Studio user guide (screenshots in docs/images)
docs/ANIMATIONS_IN_INZOI.md    live link, ModKit walkthrough, in-game panel, modder reference
docs/PACK_FORMAT.md            .zmotion and zaf_pack.json formats, live-link details
docs/MODKIT_PIPELINE.md        the automatic ModKit build prototype (tools/modkit)
tools/docs/                    renders the documentation screenshots (headless Edge)
tools/vmc_monitor.py           debug listener for the live link
tools/figures/                 Blender scripts that rig the posing figures from Human Base Meshes
tests/fixtures/                regression files (walk cycle in several formats)
```

Your projects and exports go to `Documents\Zoi Motion Studio\`.

---

## Keyboard shortcuts

`Space` play · `←/→` frame · `↓/↑` previous/next key · `K` key part (`Shift+K` whole pose) · `Del` delete keys · `Ctrl+C/V` copy/paste · `Ctrl+Shift+V` paste mirrored · `M` flip pose · `E` rotate · `W` move · `F` focus · `1 3 5 7` views · `Tab` next Zoi · `O` onion skin · `P` motion path · `Ctrl+Z/Y` undo/redo · `Ctrl+S/O` save/open · `Ctrl+I/E` import/export · `?` all shortcuts.

---

## Troubleshooting

* **The studio didn't open:** open `http://localhost:47820/` yourself. If that port is busy the launcher picks the next one; the launcher window shows the address.
* **Live link: my Zoi doesn't move:** in inZOI open *Motion Capture (Experimental)* and click *Turn On*; keep the address at `127.0.0.1` and port `39539`. If it still doesn't move, untick *Bundle* in the live dialog.
* **"Load the inZOI body" can't find the file:** pick it by hand from `…\steamapps\common\inZOI\Guides\MotionCapture\BodyTrackingVrm.vrm`.
* **Imported animation looks twisted:** open *Map bones…* in the import dialog and fix the highlighted rows.

---

## Credits & licences

* [three.js](https://threejs.org) r160 (MIT), vendored in `studio/vendor/three`.
* Posing figures: bodies from Blender Studio's [Human Base Meshes](https://www.blender.org/download/demo-files/#assets) v1.4.1 (CC0), rigged to the Zoi skeleton by `tools/figures/`.
* The inZOI body-tracking model is loaded from **your own** game folder at runtime and never copied or redistributed.
* Describe a motion: [MSFlow](https://github.com/yu1ut/MSFlow) (MotionSpaceFlow) by Qing Yu and Kent Fujiwara, LY Corporation. Generation code CC0 1.0 (copied in `ai/msflow`), model weights Apache-2.0, downloaded from Hugging Face with the [DistilBERT](https://huggingface.co/distilbert/distilbert-base-uncased) text encoder (Apache-2.0), PyTorch (BSD) and [uv](https://github.com/astral-sh/uv) (MIT/Apache-2.0).
* Windows app window: Microsoft Edge WebView2 SDK (BSD licence, shipped in the app's `licenses` folder). Installer built with Inno Setup.
* The installer banner uses inZOI key art and the inZOI logo, which belong to KRAFTON, Inc.; check KRAFTON's fan-content rules before distributing builds publicly.
* inZOI is a trademark of KRAFTON, Inc.
