# Getting your animations into inZOI

This guide takes an animation you made in Studio and puts it on your Zois in the game. It covers:

* the instant **live link**;
* the permanent **inZOI ModKit** mod, step by step;
* the in-game **Animations panel** of the Zoi Animation Framework mod;
* scenes with several Zois;
* a reference for modders who ship packs.

For how to make animations in the first place, see the **[Studio user guide](USER_GUIDE.md)**.

> **What has been tested.**
> * The live link uses inZOI's own Motion Capture feature. Studio's side is checked; streaming into the running game has not been tried yet.
> * The ModKit steps follow the official ModKit documentation and a build tested against inZOI ModKit `20261011.16078` ([MODKIT_PIPELINE.md](MODKIT_PIPELINE.md)).
> * The **Zoi Animation Framework mod (the in-game Animations panel) has not been tested inside the game yet.**
>
> [Section 12](#12-what-has-been-tested) lists exactly what has and has not been checked.

## Contents

1. [Three ways into the game](#1-three-ways-into-the-game)
2. [Live link: see it in the game now](#2-live-link-see-it-in-the-game-now)
3. [Load the Zoi skeleton once](#3-load-the-zoi-skeleton-once)
4. [Export an inZOI pack](#4-export-an-inzoi-pack)
5. [Build the mod in the inZOI ModKit](#5-build-the-mod-in-the-inzoi-modkit)
6. [The in-game Animations panel](#6-the-in-game-animations-panel)
7. [Scenes with several Zois](#7-scenes-with-several-zois)
8. [For modders: shipping a pack as its own mod](#8-for-modders-shipping-a-pack-as-its-own-mod)
9. [Other routes: Blender and the automatic ModKit build](#9-other-routes-blender-and-the-automatic-modkit-build)
10. [Checklist](#10-checklist)
11. [Troubleshooting](#11-troubleshooting)
12. [What has been tested](#12-what-has-been-tested)

---

## 1. Three ways into the game

| Way | What you get | Effort | Lasts |
|---|---|---|---|
| **Live link** | Your Zoi copies whatever Studio shows, in real time | About a minute | Only while Studio streams |
| **ModKit mod** | A real inZOI mod that contains your animations | 20 to 60 minutes the first time, less after that | Permanent; shareable on CurseForge |
| **Zoi Animation Framework panel** | An in-game menu that plays any animation, including your packs, on any Zoi, and runs multi-Zoi scenes | Install once | Permanent (it plays the animations your ModKit mod adds) |

The game can only play an animation permanently when that animation is inside a mod built with the **inZOI ModKit**. Studio cannot skip that step. What it does is make it as short as possible:

* it writes the animation files on the Zoi's own skeleton;
* it writes a **setup sheet** listing every value to enter in the ModKit.

The live link needs no mod at all, because it drives your Zoi through the game's own Motion Capture feature.

```
                  live link (VMC over UDP 39539)
   Studio  ─────────────────────────────────────────▶  inZOI Motion Capture  ─▶  your Zoi (temporary)
     │
     │ Export → inZOI pack
     ▼
   Animations\*.fbx + ModKit setup sheet ──▶  inZOI ModKit  ──▶  your mod (animations + Character Animation entries)
     │                                                                   │
     │ Export → Install into my game                                     │ installed in Documents\inZOI\Mods
     ▼                                                                   ▼
   zaf_pack.json ──▶  Zoi Animation Framework mod: Animations panel ──▶ plays the entries on any Zoi, lines up scenes
```

---

## 2. Live link: see it in the game now

The live link streams the Zoi on your Studio screen to a Zoi in the running game. That includes posing, playback, scrubbing and webcam capture. It uses inZOI's built-in **Motion Capture (Experimental)** receiver, so nothing needs to be installed in the game.

![The live dialog](images/dialog-live.png)

### Steps

1. Start inZOI and load a household. Select the Zoi you want to drive.
2. In the game, open **Motion Capture (Experimental)** and click **Turn On**. The game now listens for motion data, and shows its **Current IP Address**.
3. In Studio, click **Live in inZOI** at the top.
4. Check the **Game address**:
   * **inZOI on the same PC:** leave it at `127.0.0.1` and port `39539`.
   * **inZOI on another PC on your network:** type the game's *Current IP Address*. Port `39539`. If Windows Firewall on the game PC asks, allow inZOI on private networks.
5. Pick the Zoi to stream under **Drive** if your animation has several Zois.
6. Click **Start streaming**. Studio says *Live link on: your Zoi in inZOI now follows the studio.* The top-bar pill reads **Live: streaming**.
7. Press Space to play your animation, or pose it, and watch the game. Click the pill and **Stop streaming** when you are done.

### Settings

| Setting | Default | When to change it |
|---|---|---|
| **Send rate** | 30 per second | 60 for very fast moves on a strong PC; 24 if the game stutters |
| **Drive** | the selected Zoi | Pick which Zoi of a multi-Zoi animation is streamed. One Zoi at a time. |
| **Bundle** | on | Turn it off if your Zoi does not move. Each frame is then sent as many small packets instead of one. |

### What is sent

On every frame the live link sends:
* the rotation and position of 51 bones (body, fingers, toes), with Upper chest merged into Chest because inZOI's receiver has no separate upper chest;
* the hips movement, including travel and bounce;
* the 11 face expressions: Happy, Smile, Angry, Sad, Surprised, Blink and the five mouth shapes.

It uses the standard VMC protocol (`/VMC/Ext/Bone/Pos`, `/VMC/Ext/Blend/Val`…) on UDP port 39539. A web page cannot send UDP itself, so Studio's helper forwards the packets for it.

### Good to know

* **It is temporary.** The Zoi goes back to normal when you stop streaming or close Studio.
* **One Zoi at a time.** Placement between Zois in a scene is not streamed.
* **Face keys** from the Face tab play through the live link. This is the only place they play, because exports are body-only.
* If the connection is slow, Studio drops frames rather than letting them pile up, so the Zoi always shows the current pose.
* **Great for:** screenshots and videos, checking timing on the real Zoi body, and live puppeteering with **Act it out**: your Zoi in inZOI copies you on the webcam.
* **For modders debugging the stream:** `tools\vmc_monitor.py` in the project folder listens on port 39540 and prints what arrives. Set Studio's port to 39540 to use it (`python tools\vmc_monitor.py 39540 10`).

---

## 3. Load the Zoi skeleton once

inZOI's Zois use a skeleton called **`SK_Base`**. Its bones are named like Unreal's mannequin (`pelvis`, `spine_01`, `upperarm_l`…), and it has extra bones (`spine_04`, `spine_05`, `neck_02`) and many helper bones. Studio's own rig is a simpler 52-bone humanoid.

**To make files that match `SK_Base` bone for bone, load the real Zoi body into Studio once, then export with Skeleton: Loaded character.**
* A test round trip through Studio and back into the ModKit matched the game's own animation to within 0.0003 degrees.
* The *Unreal mannequin names* preset is **not** a shortcut. It has the right names but different bone axes, so the Zoi comes out twisted in the ModKit.

### Get the Zoi body as an FBX

The Zoi body is part of the inZOI ModKit, so you need the ModKit installed (free on the Epic Games Store; about 100 GB). Then use either route:

* **In the ModKit editor:**
  1. Open the ModKit's **Content Browser** and search for **`SKM_Base_Body`**, the Zoi body mesh on `SK_Base`.
  2. Right-click it, choose **Asset Actions → Export…**, and save it as an `.fbx` file, for example in `Documents\Zoi Motion Studio\Characters`.
* **With the project's ModKit tool:** if you have the project folder, not only the installed app, close the ModKit and run:

  ```bash
  powershell -ExecutionPolicy Bypass -File tools\modkit\build_mod.ps1 -ExportZoiSkeleton
  ```

  It writes `Documents\Zoi Motion Studio\Characters\Zoi body (inZOI ModKit).fbx` in about 35 seconds.

The file is KRAFTON content from your own ModKit. Keep it on your PC; don't share it.

### Load it in Studio

1. Press **Ctrl+I** (or **Import**) and pick the Zoi body FBX.
2. The import dialog says the file *has a character mesh*. Click **Use as character**. Studio says *\<file\> now follows Zoi A. Exports can target its skeleton.*
3. **In a scene with several Zois, do this for every Zoi**: press **Tab** to select the next Zoi and import the FBX again. Each Zoi exports on its own loaded character. A Zoi still showing a posing figure would export on the posing figure's skeleton.
4. Studio does not keep characters loaded from files after a restart, so **load the body again in each session before you export**.

You can keep animating with the Zoi body showing, or switch the look back for posing. Only the character loaded on each Zoi at export time matters.

---

## 4. Export an inZOI pack

### Before you export

* **Pack settings** (Pack tab → Settings):
  * a **Pack name** players will see;
  * an **Author**;
  * a unique **Pack id**, using letters, numbers and `_`, for example `yourname_couple`;
  * a **Version**.
* **Every animation has a different name.** The name becomes part of the file names and the ModKit entry names.
* **Type** and **inZOI settings** are set for each animation (Animation tab): Interaction, Pose, Walk / idle style or Mood walk / idle; tags, posture and rate scale.
* **For** is set for each Zoi (Scene tab): which gender and life stage can play that role.
* **Zoi A is at position 0, 0, facing 0°.** Other Zois are placed relative to Zoi A.
* **Stages and loops are final**: names, lengths, which stage loops and how many times it plays.
* **The Zoi body is loaded on every Zoi** ([section 3](#3-load-the-zoi-skeleton-once)).

### Export settings

![The Export dialog](images/dialog-export.png)

Press **Ctrl+E** (or **Export**) and choose:

| Setting | Choose | Why |
|---|---|---|
| Export | **Whole pack** | Exports every animation together |
| Format | **inZOI pack (recommended)** | Adds the setup sheet and the manifest |
| Skeleton | **Loaded character (Zoi body…)** | Bone-for-bone on `SK_Base`. The label shows the first Zoi's character; make sure it is the Zoi body, not *Posing figure*. |
| Movement | **Keep movement** for interactions and poses; **In place** for walks and idles | *In place* removes forward and sideways travel but keeps the up and down bounce. inZOI moves walking Zois itself. |

Click **Export**. Studio writes the pack and opens the folder.

### What you get

```
Documents\Zoi Motion Studio\Exports\yourname_couple\
  Animations\
    yourname_couple_Wave_hello.fbx         one file per animation × stage × Zoi
    yourname_couple_Hug_s1_a.fbx
    yourname_couple_Hug_s1_b.fbx
    yourname_couple_Hug_s2_a.fbx
    ...
  ModKit setup sheet.html                  every value to enter in the ModKit
  zaf_pack.json                            the pack manifest for the in-game panel
  README.txt                               what is in the pack
  Source\yourname_couple.zmotion           the editable project
```

**File names** are `<pack id>_<Animation_name>`:
* plus `_s1`, `_s2`… when the animation has several stages;
* plus `_a`, `_b`… for Zoi A, Zoi B… when it has several Zois.

These names are also the **entry names** you create in the ModKit. The in-game panel plays animations by them, so they must match exactly.

| Animation | Stages | Zois | Files |
|---|---|---|---|
| Wave hello | 1 | 1 | `yourname_couple_Wave_hello.fbx` |
| Hug | 3 | 2 | `yourname_couple_Hug_s1_a.fbx`, `…_s1_b`, `…_s2_a`, `…_s2_b`, `…_s3_a`, `…_s3_b` |

The FBX files are binary FBX 7.4, Y-up, in centimetres, with every frame baked. Face keys are not included: inZOI drives faces itself.

**Exporting again** overwrites files with the same names but never deletes old ones. If you rename or remove an animation, delete its old files from `Animations` yourself.

### The setup sheet

Open **`ModKit setup sheet.html`** in your browser. It has a short "How to use this sheet" box, then one card per animation:

* the steps for that animation's type;
* the values to enter;
* a table of every entry to create, with its Zoi, stage, loop flag, gender, growth step and play lengths.

Keep it open next to the ModKit while you work through [section 5](#5-build-the-mod-in-the-inzoi-modkit).

---

## 5. Build the mod in the inZOI ModKit

The inZOI ModKit is KRAFTON's free mod editor, based on Unreal Engine. Official docs: [mod-docs.playinzoi.com](https://mod-docs.playinzoi.com/docs/modkit-docs/). The menu and field names below come from those docs and from the ModKit itself; a future ModKit update may move things around.

### 5.1 Install the ModKit and create a project

1. Install **inZOI ModKit** from the Epic Games Store. It needs about 100 GB.
2. Open it. In **My Mod Projects**, right-click an empty spot and choose **Create Empty Project**.
3. Enter a **Project Name** (for example your pack name), a save path, the **Author** and a **Description**. Click **Create**.

### 5.2 Import the animations

1. In the **Content Browser**, open your project's folder and create a folder named `Animations`.
2. Import the FBX files from your pack's `Animations` folder. You can drag them in from Windows Explorer.
3. In the import options:
   * set **Skeleton** to **`SK_Base`** (`/Game/Characters/Skeletons/SK_Base`), the inZOI template skeleton;
   * import the **animation only**, with no mesh;
   * keep the whole exported time range, without key reduction.

   **Never create a new skeleton.**
4. Each file becomes an **Animation Sequence**. A tidy naming scheme is `ANIM_<entry name>`, for example `ANIM_yourname_couple_Wave_hello`.
5. Double-click a sequence to preview it. The Zoi should move exactly as in Studio. If it is twisted, the pack was exported on the wrong skeleton; see [section 3](#3-load-the-zoi-skeleton-once).

### 5.3 Make a montage for each interaction

Interactions and poses play from an **Animation Montage**. Walks and idles use the sequence directly.

1. Right-click a sequence and choose **Create → AnimMontage**. Name it `ANIM_<entry name>_Interaction_Montage`.
2. Keep the montage's single **`Default`** section on the default slot. You don't need more sections: the framework plays every stage as its own entry.
3. **For a looping stage** (the sheet's *Loops* column says *yes*):
   1. Open the montage and add a notify track named `Loop`.
   2. Add **`B1AnimNotify_LoopStart`** at 0 seconds.
   3. Add **`B1AnimNotify_LoopEnd`** just before the end, about half a frame earlier.

   These are the notifies inZOI's own looping montages use.

### 5.4 Create the Character Animation entries

Every row of the sheet's entry table becomes one **Character Animation (Interaction)** entry. These live in the `AnimCharacter_Interaction` table.

1. Right-click your project in **My Mod Projects** and choose **Open Data Editor**.
2. Add a Character Animation (Interaction) entry. The ModKit creates new entries from an existing game interaction; `Self_Angry` is a simple one to start from.
3. Set its **Id** to **exactly** the entry name from the sheet, for example `yourname_couple_Hug_s2_a`.
4. Fill in the fields:

| Field | Value | Notes |
|---|---|---|
| **Playing Component Name** | `Root` | |
| **Start Anim Section** | `Default` | |
| **Stop Other Component on Finish** | off | |
| **Character Anim Config List** | one element | |
| ↳ **Anim Posture Type** | the animation's **Posture** (`Stand` unless you changed it) | |
| ↳ **Anim Body Parts**, **Grab Parts**, **Slot Direction** | `None` | |
| ↳ **Anim Info List** | one entry per gender in the sheet's row | See the table below |
| ↳↳ **Gender**, **Anim Growth Step** | from the sheet | |
| ↳↳ **Animation** | the montage you made for this entry | |
| ↳↳ **Total Play Length**, **Loop Play Length** | filled in by the ModKit when you pick the montage | Check them against the sheet |
| ↳↳ **Rate Scale** | the animation's **Rate scale** (`1` = normal) | |
| ↳↳ **Random Loop Anims** | leave empty | |

How Studio's **For** setting becomes Anim Info List entries. This mirrors inZOI's own rows; for example, the game's `Self_Angry` has Female/Adult, Male/Adult and Default/Youth entries.

| For (gender, life stage) in Studio | Anim Info List entries |
|---|---|
| Any, Adult | Female / Adult and Male / Adult |
| Female, Adult | Female / Adult |
| Male, Adult | Male / Adult |
| Any or Female or Male, Teen | the same as Adult: teens use the Adult entries |
| any gender, Child | Default / Youth |

### 5.5 Walks and idles (Locomotion and Stat Locomotion)

These change how Zois idle or walk all the time, not when triggered. Think about who should get them before you add them.

**Walk / idle style** (Character Animation → **Locomotion**):
1. For each row of the sheet, set **Gender** and **Anim Growth Step**.
2. Either set your sequence as the **Idle Anim** (replacing the default idle), or add it under **Idle Random Anims** with:
   * **Animation:** your sequence;
   * **Emotion Id:** the Emotion you set in Studio, or empty;
   * **Emotion Level:** `0`;
   * **Chance to Play:** the Chance you set in Studio.

**Mood walk / idle** (Character Animation → **Stat Locomotion**):
1. For each row, set **Gender** and **Anim Growth Step**.
2. Add an entry under **Stat Locomotions**:
   * **Stat Id** (for example `Tired`) and **Stat Value** from Studio;
   * your sequence as **Stat Walk Anim** if it is a walk cycle, or under **Idle Random Anims** if it is an idle.
3. Leave **Min/Max Normal Walk Time**, the swim fields, the face fields and **Disable Jog** as they are unless you need them.

**Optional:** to also play a walk or idle from the in-game Animations panel (handy for testing), make a montage from it and create a Character Animation (Interaction) entry with its entry name, the same way as for interactions.

### 5.6 Package and install the mod

1. In the toolbar's **Package MOD** drop-down, click **Create Local Mod Package**.
2. Choose `This PC > Documents > inZOI > Mods` as the output folder and confirm the notice.
3. Wait for **"Packaging successful"** in the bottom-right corner. If you see *"Packaging failed!"*, check the ModKit's message log for the asset it names.
4. Start inZOI. Open **Mod** in the left-side menu (under the Creative Mode area). On **My Mod Management**:
   1. Tick your mod's card.
   2. Click **Validate**; new mods show *Validation Required* until you do.
   3. Switch it to **Enabled**.
5. Restart the game if your mod was already installed and you rebuilt it.

To share it, use **Upload UGC to CurseForge** in the ModKit toolbar (see the official [CurseForge guide](https://mod-docs.playinzoi.com/docs/modkit-docs/modkit/export/curseforge)). Include your pack's `zaf_pack.json` so players can add the pack to the in-game panel; see [section 8](#8-for-modders-shipping-a-pack-as-its-own-mod).

### Stages in the game

Each stage of each Zoi is a separate entry, and the in-game panel plays them in order:

* A stage that does not loop plays once, then the next stage starts.
* A looping stage with **Plays** set to a number repeats that many times, then moves on.
* A looping stage with **Plays** `-1` repeats until the player presses **Next stage** or **Stop**.

`zaf_pack.json` also labels each stage with inZOI's montage-section convention: **Default** before the loop, **Loop** for the first looping stage, **End** after it. Tools that build one montage per Zoi with a section per stage use these labels; the framework doesn't need them. Details: [PACK_FORMAT.md](PACK_FORMAT.md#stages-and-sections).

---

## 6. The in-game Animations panel

The **Zoi Animation Framework** mod adds an **Animations** panel to the game:
* play any animation the game knows, or your packs' animations, on any Zoi;
* keep favourites;
* run multi-Zoi scenes.

It is the in-game half of this project.

> **Experimental:** the panel is built on inZOI's official Lua and UI mod templates, but it has not been tested inside the game yet.

### 6.1 Install the framework mod

Either way works:
* **During Studio's Setup:** tick *Install the Zoi Animation Framework mod into inZOI*. This option only appears when inZOI is found.
* **From Studio:** **Export → Install into my game** installs the mod the first time you use it.

The mod goes to `Documents\inZOI\Mods\InGame\ZoiAnimFramework`.
* In the game, check that it is **Validated** and **Enabled** on the **Mod** screen, like any other mod.
* After updating Studio, run Setup again with the mod box ticked to update the framework. *Install into my game* only installs it when it is missing.

### 6.2 Add your pack to the panel

1. In Studio, open the pack and press **Ctrl+E**.
2. Choose **Whole pack**, then click **Install into my game** (bottom left).

Studio says *"\<pack\>" is in your game's Animations panel (N packs installed). Its animations play once the pack's ModKit mod is installed.*

* This writes the pack manifest to `ZoiAnimFramework\ui\zaf\packs\<pack id>.json` and refreshes the panel's list. It does not copy animation files: the animations come from your ModKit mod ([section 5](#5-build-the-mod-in-the-inzoi-modkit)).
* **Use Whole pack.** With *This animation* selected, the pack's entry in the panel is replaced by that one animation.
* Restart inZOI so the panel reads the new list.
* **To remove a pack from the panel,** delete its `<pack id>.json` from that folder, then use *Install into my game* once more for any pack to rebuild the list.

### 6.3 Using the panel

The panel opens by itself during gameplay, by default at the top right.
* Drag it by its title bar.
* Resize it from the bottom-right corner.
* Shrink it with **_**, and click the title bar to restore it.

The dot in the title bar turns teal once the framework's Lua director answers.

**Animations tab**

| Control | What it does |
|---|---|
| Zoi picker | The Zoi to animate: you, your household, or anyone nearby. **Refresh** looks again. |
| Search box | Search the game's animations by words, for example *dance*, *wave*, *sit*. All words must match. |
| **Stop** | Stops the current animation |
| **Loop: on / off** | Repeats the animation until you press Stop |
| **Hold still: on / off** | Turns the Zoi's free will off so it doesn't wander away. Turn it off again before you pick another Zoi. |
| **All** / **Favorites** / **My packs** | All animations, your starred ones, or your packs' single-Zoi animations (one row per stage) |
| A row | Click to play it on the selected Zoi. Click the star to add it to Favorites. |

**Scenes tab** (multi-Zoi scenes from packs):

1. Click a scene card. It shows `<pack> · N Zois · N stages`.
2. Assign a Zoi to each role. The first role starts with your current Zoi.
3. Click **Start scene**.
   * The framework lines the Zois up around the first role's Zoi and pauses their free will.
   * It then plays the stages in order.
   * **Now playing** shows the current stage, with **Next stage** and **Stop**.
4. When the scene ends or you stop it, the Zois get their free will back.

**Studio tab**
* Shows whether Studio is running on this PC.
* Shows whether the framework's Lua director is running, and how many packs are installed.
* **Reload packs** asks for packs registered by other mods again.

### 6.4 How it plays animations

* inZOI's console animation commands (`motion.play` and similar) are cheat-only and do nothing for normal players, so the framework uses only supported routes.
* When you play an animation, the panel creates a hidden "play this animation" interaction for it with the game's `data.patch` command. That interaction is never written to your save. The framework's Lua director then queues it on the Zoi.
* That is why a pack animation plays only when a Character Animation entry with exactly its name exists: the entry comes from your ModKit mod.

---

## 7. Scenes with several Zois

A hug, a handshake or a group dance is one animation with several Zois. Here is how it carries through each step.

**In Studio**
* Add Zois with **+ Zoi**, up to 6.
* Keep **Zoi A at 0, 0, facing 0°**. Place the others relative to Zoi A with **Position** and **Facing** in the Scene tab. In-game, the others are moved into place around the Zoi playing Zoi A's role.
* Set each Zoi's **Body** so heights match, and **For** to say who can play each role.
* Use stages for approach → hold → release.

**Export**
* Load the Zoi body on **every** Zoi first ([section 3](#3-load-the-zoi-skeleton-once)).
* You get one file per Zoi per stage, for example `…_Hug_s2_a` for Zoi A in stage 2.

**ModKit**
* Every Zoi's file gets its own montage and its own Character Animation entry, as listed in the sheet.

**In the game** (Scenes tab):
1. **Line up.** The first role's Zoi stays where it is. Each other Zoi is moved to its offset: X metres to the first Zoi's left, Z metres in front of it, turned by the facing angle. Facing 180° means face to face.
2. **Free will off** for every Zoi in the scene.
3. **Stages** play in order. All Zois start each stage together.
4. At the end, free will comes back on.

**Limits**
* Each Zoi plays its own entry, and stage changes are timed by the panel, so Zois are not frame-locked to each other. Keep contact moments clear of stage boundaries.
* If the framework's Lua director is not running, the scene still plays after a short wait, but without lining the Zois up.

---

## 8. For modders: shipping a pack as its own mod

To share a pack on CurseForge, players need two things:

1. **Your ModKit mod**, holding the animations and the Character Animation entries ([section 5](#5-build-the-mod-in-the-inzoi-modkit)).
2. **The pack's manifest**, so the framework's panel lists your scenes. It can be registered from Lua inside your mod, as below.

### Register the pack from Lua

Ship a Lua module named exactly **`ZAF_Packs`** at `lua/B2/ZAF_Packs.lua` in your mod. It returns a table with a `register` function. The framework calls it with an `api` object and you add your pack manifest as a Lua table. It is the same data as `zaf_pack.json`:

```lua
-- lua/B2/ZAF_Packs.lua : registers this mod's animations with the Zoi Animation Framework.
return {
  register = function(api)
    api.add({
      zaf = 1,
      id = "yourname_couple",
      name = "Cute Couple Animations",
      author = "You",
      version = "1.0.0",
      scenes = {
        {
          id = "yourname_couple.wave_hello",
          name = "Wave hello",
          kind = "interaction",
          tags = { "greeting" },
          actors = { { slot = 0, name = "Zoi A", gender = "Any", growth = "Adult", offset = { x = 0, z = 0, yaw = 0 } } },
          stages = {
            { index = 0, name = "Stage 1", section = "Default", fps = 30, frames = 48, duration = 1.6,
              loop = false, loopCount = 1, animations = { "yourname_couple_Wave_hello" } },
          },
        },
      },
      animations = {
        { id = "yourname_couple_Wave_hello", anim_id = "yourname_couple_Wave_hello",
          file = "Animations/yourname_couple_Wave_hello.fbx", fps = 30, frames = 48, duration = 1.6, loop = false },
      },
    })
  end,
}
```

* Convert your `zaf_pack.json` field for field. JSON arrays become Lua lists `{ ... }` and objects become tables with `key = value`. Keep `stages[].animations` free of `null`; Studio always gives every Zoi a clip in every stage.
* `api.add` ignores a pack whose `id` was already added, so the first registration of an id wins. Keep your pack id unique: prefix it with your name.
* `api.version` is the framework version (`"1.0.0"`).
* The panel asks for Lua packs at start and when the player presses **Reload packs** in its Studio tab.
* **Not verified yet:**
  * the framework expects the game's Lua loader to merge same-named modules from every installed mod;
  * whether your mod must also list `lua/B2/ZAF_Packs.lua` under `NonAssets` in its `mod_manifest.json`, as the framework's own mod does for its Lua files. Listing it does no harm.

  Test with two pack mods installed before relying on the first point. Until this is confirmed, players who have Studio can always add your pack with **Install into my game**: open your `Source\<pack id>.zmotion` and export the whole pack.

### Manifest reference

The full format is in [PACK_FORMAT.md](PACK_FORMAT.md). The panel reads these fields:

| Field | Used for |
|---|---|
| `id`, `name` | Telling packs apart; the pack name shown on rows and scene cards |
| `scenes[].name`, `tags` | Scene cards and search |
| `scenes[].actors[]` (`name`, `offset.x`, `offset.z`, `offset.yaw`) | Roles and line-up. Slot 0's offset is ignored. |
| `scenes[].stages[]` (`name`, `duration`, `loop`, `loopCount`, `animations`) | Stage order, timing and which entry each role plays |
| `animations[]` (`id`, `anim_id`) | The Character Animation entry to play (`anim_id`, falling back to `id`) |

Single-Zoi scenes also appear under **My packs** in the Animations tab, one row per stage.

### Framework internals

For modders who want to extend the framework, or talk to it from their own UI mod.

**Files** (`Documents\inZOI\Mods\InGame\ZoiAnimFramework`):

| File | Role |
|---|---|
| `mod_manifest.json`, `ZoiAnimFramework.uplugin` | Mod metadata (`ProjectName` `ZoiAnimFramework`, category UGC) |
| `lua/lua_manifest.json`, `lua/B2/Main.lua` | The Lua director in the B2 (simulation) context |
| `lua/B2/ZAF/json.lua` | A small JSON encoder/decoder for the sandbox |
| `ui/uimod_apps.json`, `ui/zaf/*` | The UI app `zaf`: `index.html`, `window.js` (window frame), `app.js` (the panel) |
| `ui/zaf/packs/<id>.json`, `installed.js` | Packs added by Studio; `installed.js` pushes them into `window.ZAF_PACKS` |

**Mailbox between the panel and the Lua director.**
* **Panel to Lua:** `uimod.cfg_save` with `mod_id=ZoiAnimFramework`, `section=box`, `key=cmd` and a JSON value `{"seq": n, "ops": [{"op": "...", "req": "...", ...}]}`. Lua polls it 10 times a second and runs the ops when `seq` changes.
* **Lua to panel:** `inzoi.message.send_to_client(<your Zoi>, "zaf", <json>)`, which arrives as the UI event `lua_message.zaf`. Every reply carries `v` (version) and the `req` it answers. A heartbeat `{"type": "alive"}` is sent every 3 seconds.

| op | Input | Does | Reply |
|---|---|---|---|
| `ping` | | | `pong` |
| `packs` | | Collects packs registered through `ZAF_Packs` | `packs` with the list |
| `freeze` | `ids` or `id`, `on` | Turns free will (autonomy and schedule) off or back on | `ok` |
| `place` | `id`, `x`, `y`, `z`, `yaw` (cm, degrees) | Teleports a Zoi | `ok` |
| `face` | `id`, `yaw` | Turns a Zoi on the spot | `ok` |
| `where` | `id` | | `where` with `x, y, z, yaw` |
| `align` | `anchor`, `actors[{id, x, z, yaw}]`, `scene` | Lines Zois up around the anchor (x left, z forward in metres; yaw in degrees) | `aligned` |
| `queue` | `id`, `bag`, `cancel` | Queues an interaction bag on a Zoi | `queued` |
| `queue_many` | `items[{id, bag, cancel}]` | Queues several at once | `queued_many` |
| `cancel` | `ids` or `id` | Cancels and clears a Zoi's interactions | `ok` |
| `release` | `ids` | Cancel, then free will back on | `ok` |

The mailbox is a single slot: two writes within 100 ms can lose the first. Send related ops together in one `ops` list.

---

## 9. Other routes: Blender and the automatic ModKit build

### Blender add-on (Zoi Motion Bridge)

For creators who already work in Blender with KRAFTON's official inZOI Blender plugin. The add-on puts any Studio animation on any armature and exports an FBX with Unreal-friendly settings.
* **Where to get it:** `zoi_motion_bridge.zip` is in Studio's install folder under `blender`, and in the release.
* **Install:** Blender 4.2 or newer: **Edit → Preferences → Get Extensions → ⌄ → Install from Disk…**.
* **Use:**
  1. In the 3D view's sidebar (`N`), open the **Zoi Motion** tab.
  2. **Open .zmotion**, then choose the animation, stage and Zoi.
  3. **Apply to Armature**.
  4. **Export for inZOI ModKit**.
* **Naming:** the add-on names the action and file `<animation>_<stage>_<Zoi>`. That does not match the pack's entry names, so when you build the ModKit entries, name them after `anim_id` in `zaf_pack.json`, not after the Blender file.
* **Multi-Zoi scenes:** apply each Zoi to its own armature and export one FBX per Zoi. Keep *Use scene placement* off for ModKit exports.

Full instructions are in [blender/README.md](../blender/README.md).

### Automatic ModKit build (prototype)

The project folder contains a prototype that does all of [section 5](#5-build-the-mod-in-the-inzoi-modkit) automatically: `tools\modkit\build_mod.ps1`.
* It takes an exported pack and builds the ModKit project, sequences, montages and Character Animation entries without opening the ModKit window, then packages and installs the mod. This takes about 1.5 minutes.
* It needs the ModKit installed and closed, and a pack exported with **Skeleton: Loaded character** on the Zoi body.
* It builds Interaction and Pose animations; walks and idles are skipped.

```bash
powershell -ExecutionPolicy Bypass -File tools\modkit\build_mod.ps1 -Pack "C:\Users\<you>\Documents\Zoi Motion Studio\Exports\<pack id>"
```

It is not part of the installed app yet, and the mods it builds have not been tested in the game. Details: [MODKIT_PIPELINE.md](MODKIT_PIPELINE.md).

---

## 10. Checklist

**In Studio**
- [ ] Pack name, author, unique pack id (`letters_numbers_underscores`) and version are set
- [ ] Every animation has a unique name, the right Type and its inZOI settings
- [ ] For each Zoi: Body and For (gender, life stage) are set; Zoi A is at 0, 0, 0°
- [ ] Stages, loops and Plays are final
- [ ] The Zoi body FBX (`SKM_Base_Body`) is loaded on every Zoi with *Use as character*
- [ ] Export: Whole pack · inZOI pack · Loaded character (Zoi body) · Keep movement or In place

**In the ModKit**
- [ ] Every FBX is imported on `SK_Base`, animation only, and previews correctly
- [ ] One montage per interaction file, with a single `Default` section; loop notifies on looping stages
- [ ] One Character Animation (Interaction) entry per sheet row, with its Id exactly the entry name
- [ ] Each entry has Root, Default, posture, Anim Info List entries (gender, growth, montage) and rate scale
- [ ] Walks and idles are added under Locomotion or Stat Locomotion if you made any
- [ ] Packaged locally to `Documents\inZOI\Mods`

**In the game**
- [ ] Your mod and the Zoi Animation Framework are Validated and Enabled on the Mod screen
- [ ] The pack is added with Export → Install into my game (Whole pack)
- [ ] The game was restarted after installing or rebuilding

---

## 11. Troubleshooting

**The animation is twisted in the ModKit preview**
* The pack was exported on the wrong skeleton. The usual cause is that *Posing figure* or *Unreal mannequin names* was selected.
* Load the Zoi body on every Zoi, export with **Loaded character**, and import again.

**The ModKit asks to create a skeleton, or the import fails**
* Pick `SK_Base` as the Skeleton in the import options and import animation only.

**The panel lists my pack, but clicking an animation does nothing**
* Check that your ModKit mod is installed, Validated and Enabled.
* Check that the Character Animation entry's Id matches the entry name in the sheet exactly, including capital letters.
* Check that the entry's Anim Info List covers the Zoi you clicked: its gender, and Adult (teens) or Youth (children).

**The panel says "Waiting for the framework director (is the mod enabled?)"**
* The framework's Lua part is not running. Check that the Zoi Animation Framework mod is Enabled, then restart the game.

**My pack is not in the panel**
* Use **Install into my game** with **Whole pack**, then restart the game.

**The panel's Studio tab says Studio is not running, although it is**
* The panel only checks Studio's usual port (47820). If another program uses that port, Studio picks the next free port and the panel can't see it. Nothing else depends on this check.

**Zois in a scene stand in the wrong places**
* Keep Zoi A at 0, 0, 0° in Studio; the game ignores Zoi A's own offset.
* Check that the other Zois' X, Z and Facing are relative to Zoi A.

**The live link does nothing**
* Motion Capture must be turned on in the game.
* Use address `127.0.0.1` and port `39539` on the same PC.
* Try with **Bundle** off.

---

## 12. What has been tested

| Part | Status |
|---|---|
| Live link from Studio | Checked with `toolsmc_monitor.py`: about 30 packets a second, all 51 bones, expressions, no drops. |
| Live link into the game's Motion Capture receiver | **Not tested with the game yet.** |
| FBX export on the loaded Zoi body | Round trip through the ModKit matches a game animation to within 0.0003°. |
| Import onto `SK_Base`, montages, Character Animation rows, packaging | Done headlessly by the ModKit build tool against ModKit `20261011.16078`. |
| Field names | From the official ModKit docs (Character Animation, Interaction, Locomotion, Stat Locomotion). |
| The in-game panel, Lua director, pack registration and scene line-up | **Not tested in the game yet.** |
| Mods built from Studio packs playing in the game | **Not tested yet.** |
| `ZAF_Packs.lua` merging across several mods | **Not tested yet.** |

If you try any of the untested parts, please report what happened. In particular: whether pack animations play from the panel, whether looping stages loop, and whether female, male, teen and child Zois each get the right entry.
