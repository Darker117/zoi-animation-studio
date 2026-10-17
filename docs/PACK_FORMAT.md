# Zoi Animation Framework — file formats

Two formats make up the framework:

| File | Who writes it | Who reads it | Purpose |
|---|---|---|---|
| `*.zmotion` | Studio | Studio, Blender add-on | Editable project (keyframes, stages, Zois, settings) |
| `zaf_pack.json` | Studio export | In-game runtime, tools | What a pack contains: scenes, actor slots, stages, timing, tags, files |

Both are plain JSON, UTF-8.

---

## Shared conventions

* **Canonical rig** — 52 bones named after the VRM humanoid spec (`hips`, `spine`, `chest`, `upperChest`, `neck`, `head`, `leftShoulder`, `leftUpperArm`, `leftLowerArm`, `leftHand`, `leftThumbProximal` … `leftLittleDistal`, `leftUpperLeg`, `leftLowerLeg`, `leftFoot`, `leftToes`, and the `right…` mirror).
* **Space** — Y up, the character faces +Z, the character's left is +X, meters.
* **Rest pose** — a T-pose where every bone's rest rotation is the identity, so a stored quaternion directly says how far a bone has turned from the T-pose. This is the normalized-VRM convention that inZOI's Motion Capture (VMC) receiver uses.
* **Default proportions** — measured from inZOI's body-tracking reference body (`Guides/MotionCapture/BodyTrackingVrm.vrm`), hips at 1.0127 m. Body types (`adult`, `tall`, `teen`, `child`) scale those proportions.

---

## `.zmotion` project

```jsonc
{
  "format": "zoi-motion-project",
  "version": 1,
  "pack": { "id": "yourname_couple", "name": "…", "author": "…", "version": "1.0.0", "description": "…" },
  "scenes": [
    {
      "id": "scene_…",
      "name": "Hug",
      "kind": "interaction",            // interaction | pose | locomotion | statLocomotion
      "tags": ["romance", "couple"],
      "inzoi": { "posture": "Stand", "rateScale": 1, "statId": "", "statValue": 0, "emotionId": "", "chanceToPlay": 1 },
      "actors": [
        { "id": "actor_…", "name": "Zoi A", "bodyType": "adult", "gender": "Any", "growth": "Adult",
          "color": "#7c8cff", "offset": { "x": 0, "z": 0, "yaw": 0 } }
      ],
      "props": [ { "id": "prop_…", "type": "chair", "x": 0, "z": -0.12, "yaw": 0 } ],
      "stages": [
        { "id": "stage_…", "name": "Stage 1", "frames": 60, "fps": 30, "loop": false, "loopCount": 1,
          "clips": { "<actor id>": CLIP } }
      ]
    }
  ]
}
```

`CLIP`:

```jsonc
{
  "name": "Hug – Zoi A", "fps": 30, "frames": 60, "loop": false,
  "tracks": {
    "<bone>": {
      "rot": [[frame, x, y, z, w, "ease"], …],   // local rotation (quaternion) of the canonical bone
      "pos": [[frame, x, y, z, "ease"], …]       // hips only: actor-space position in meters
    }
  },
  "expr": { "Joy": [[frame, weight, "ease"], …] }, // VRM expression weights (live link only)
  "markers": []
}
```

* Frames are integers from `0` to `frames` (inclusive). Duration = `frames / fps` seconds.
* `ease` controls the segment **leaving** a key: `auto` (smooth clamped cubic through the keys, flat at the clip ends, wraps around for loops whose first and last frames are keyed), `linear`, `easeInOut`, `easeIn`, `easeOut`, `back` (overshoot) and `step` (hold).
* A bone without rotation keys stays at rest (identity). No hips position keys means the hips stay at their rest position.
* Every actor of a stage shares the stage's `frames`, `fps` and `loop`.

---

## `zaf_pack.json` (pack manifest)

Written next to the exported animation files. Version field: `"zaf": 1`.

```jsonc
{
  "zaf": 1,
  "generator": "Studio",
  "id": "yourname_couple",              // unique; lowercase letters, digits and _ ; prefixes every animation id
  "name": "Cute Couple Animations",
  "author": "…", "version": "1.0.0", "description": "…",
  "skeleton": "unreal",                 // character | unreal | inzoiVrm | vrm | mixamo
  "rootMotion": "keep",                 // keep | inPlace
  "scenes": [
    {
      "id": "yourname_couple.hug",       // <pack id>.<lowercase animation name>
      "name": "Hug",
      "kind": "interaction",
      "tags": ["romance"],
      "description": "",
      "inzoi": { "posture": "Stand", "rateScale": 1, "statId": "", "statValue": 0, "emotionId": "", "chanceToPlay": 1 },
      "actors": [
        { "slot": 0, "name": "Zoi A", "gender": "Any", "growth": "Adult", "offset": { "x": 0, "z": 0,    "yaw": 0 } },
        { "slot": 1, "name": "Zoi B", "gender": "Any", "growth": "Adult", "offset": { "x": 0, "z": 0.75, "yaw": 180 } }
      ],
      "stages": [
        {
          "index": 0, "name": "Stage 1",
          "section": "Default",             // montage section: Default → Loop → End
          "fps": 30, "frames": 140, "duration": 4.6667,
          "loop": false, "loopCount": 1,    // -1 = loop until stopped
          "animations": ["yourname_couple_Hug_a", "yourname_couple_Hug_b"]   // one per actor slot, in slot order; null = no clip
        }
      ]
    }
  ],
  "animations": [
    { "id": "yourname_couple_Hug_a",
      "anim_id": "yourname_couple_Hug_a",  // the Character Animation entry the in-game panel plays
      "file": "Animations/yourname_couple_Hug_a.fbx", "fps": 30, "frames": 140,
      "duration": 4.6667, "loop": false, "scene": "Hug", "stage": "Stage 1", "actor": "Zoi A" }
  ]
}
```

### Ids

| What | Pattern | Example |
|---|---|---|
| Pack id | `slug(pack id)`, lowercase. Studio removes every character other than letters, digits, `_`, `-` and spaces, then turns spaces and `-` into `_`. Dots are removed. | `yourname_couple` |
| Scene id | `<pack id>.<lowercase slug of the animation name>` | `yourname_couple.hug` |
| Animation id | `<pack id>_<slug of the animation name>`, plus `_s<N>` when the scene has several stages, plus `_a`, `_b`… when it has several actor slots | `yourname_couple_Hug_s2_b` |

`anim_id` is the name of the Character Animation entry to create in the ModKit. The in-game panel plays `anim_id` (falling back to `id`). Studio writes the same value in both. Two animations whose names slug to the same text get the same ids, so give every animation in a pack a different name.

### Actor placement

`offset` places each actor slot relative to slot 0 when the scene starts: `x` to slot 0's left (meters), `z` forward (meters), `yaw` in degrees (180 = facing slot 0). The runtime anchors the scene on the Zoi playing slot 0 and moves the others into place before playing. Slot 0's own offset is ignored, so keep it at `0, 0, 0`.

### Stages and sections

Stages play in order. The in-game panel plays each stage's animations as their own Character Animation entries, one stage after another, so each entry's montage needs only its single `Default` section (looping stages are marked with inZOI's `B1AnimNotify_LoopStart` / `B1AnimNotify_LoopEnd` notifies, as in [MODKIT_PIPELINE.md](MODKIT_PIPELINE.md)).

`section` gives the stage's role in inZOI's `Default` / `Loop` / `End` montage-section convention, for tools that build one montage per Zoi with a section per stage:

* One stage: `Loop` if it loops, otherwise `Default`.
* Several stages: the **first** looping stage is `Loop`. Stages before it are `Default`, `Default2`, `Default3`…; stages after it are `End` for the last one and `End<index>` for the others (for example `Default → Default2 → Loop → End3 → End`). A second looping stage is not called `Loop`. Without a looping stage there is no `End`: `Default → Default2 → Default3`.

A looping stage repeats `loopCount` times (`-1` = until the scene is stopped). Non-looping stages always have `loopCount: 1`.

### Kinds

| kind | Plays | ModKit config |
|---|---|---|
| `interaction` | when triggered | Character Animation → Interaction (Animation Montage) |
| `pose` | held / gently looping | Interaction or random idle |
| `locomotion` | default idle / walk | Character Animation → Locomotion |
| `statLocomotion` | when a stat or mood is active | Character Animation → Stat Locomotion (`inzoi.statId`, `inzoi.statValue`) |

---

### Where manifests live in the game

* **Installed from Studio** (*Export → Install into my game*): `Documents\inZOI\Mods\InGame\ZoiAnimFramework\ui\zaf\packs\<pack id>.json`. Studio's helper then regenerates `packs\installed.js`, which pushes every manifest into `window.ZAF_PACKS` for the in-game panel.
* **Shipped as a separate mod:** a Lua module `lua/B2/ZAF_Packs.lua` that registers the manifest as a Lua table. See [Getting your animations into inZOI → For modders](ANIMATIONS_IN_INZOI.md#8-for-modders-shipping-a-pack-as-its-own-mod).

The runtime reads `id`, `name`, `scenes[].id`, `name`, `tags`, `actors[]` (`name`, `offset`), `stages[]` (`name`, `duration`, `loop`, `loopCount`, `animations`) and `animations[]` (`id`, `anim_id`). Other fields are for tools and people.

---

## Live link (VMC)

The studio streams the selected Zoi to inZOI's Motion Capture receiver (UDP port 39539) using the VMC protocol: `/VMC/Ext/Bone/Pos` (Unity HumanBodyBones names, local position and rotation in Unity's left-handed space), `/VMC/Ext/Root/Pos`, `/VMC/Ext/Blend/Val` and `/VMC/Ext/Blend/Apply` for expressions, plus `/VMC/Ext/OK` and `/VMC/Ext/T`. inZOI's receiver has no `UpperChest` slot, so that rotation is folded into `Chest`. Conversion from studio space: position `(x, y, z) → (-x, y, z)`, rotation `(x, y, z, w) → (x, -y, -z, w)`.
