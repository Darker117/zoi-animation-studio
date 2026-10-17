# Zoi Motion Bridge (Blender add-on)

Put animations made in **Studio** onto any character skeleton in Blender (for example the
official inZOI skeleton you import with KRAFTON's inZOI Blender plugin). Then export an FBX that the
**inZOI ModKit** (Unreal Engine) can import.

Works with Blender 4.2 or newer, including Blender 5.x.

---

## 1. Install

1. Download `zoi_motion_bridge.zip`. **Do not unzip it.**
2. In Blender, open **Edit > Preferences > Get Extensions**.
3. Click the small **v** arrow in the top-right corner and choose **Install from Disk...**
4. Pick `zoi_motion_bridge.zip`. The add-on is now installed and switched on.

(Older way, which also works: **Preferences > Add-ons > Install from Disk...**, then tick **Zoi Motion Bridge**.)

## 2. Put an animation on your character

1. Import your character. For inZOI, use KRAFTON's official inZOI Blender plugin to import the inZOI
   skeleton. Any armature works (Unreal, Mixamo, VRM and others).
2. **Click the armature** (the skeleton) in the 3D view.
3. Press **N** to open the sidebar and click the **Zoi Motion** tab.
4. In **Import .zmotion**, click **Open .zmotion** and pick the project you saved in Studio.
5. Choose the **Animation (scene)**, the **Stage** and the **Zoi**.
6. Click **Apply to Armature**.

You get a new Action named `<scene>_<stage>_<Zoi>`, for example `My first animation_Stage 1_Zoi A`.
Press **Space** to play it.

### Options

| Option | What it does |
|---|---|
| **Bake every frame** (default) | Puts a key on every frame. This is an exact copy of the studio motion. |
| **Keep keyframes only** | Only keys the frames where you set keys in the studio (plus the first and last frame). The motion between them is close but not identical. It is easier to edit by hand. |
| **Root motion: Keep / In place** | *Keep* lets the Zoi travel. *In place* removes forward and sideways travel, but keeps the up/down bounce. |
| **Frame offset** | Studio frame `f` goes on Blender frame `offset + f`. The default is **0**, so studio frame 0 is Blender frame 0. |
| **Set scene FPS & range** | Matches Blender's frame rate and start/end frame to the animation. This is needed for a correct export. |
| **Reset other bones** | Puts every bone back to its rest pose first, so old poses don't leak into the animation. |
| **Use scene placement** | Only shows for scenes with 2 or more Zois. It moves and turns each Zoi to its place in the scene, which is useful for previews. **Turn it off for ModKit export.** You set placement up in the ModKit instead. |
| **All stages in sequence** | This is in the Stage list when a scene has more than one stage. It plays the stages one after another in one Action. |

**Scenes with two or more Zois (hugs and other interactions):** apply each Zoi to its own armature.
Then export one FBX per Zoi.

## 3. Bone mapping (only if something looks wrong)

The add-on works out which of your bones is the hips, the arms, the fingers and so on.
It does this automatically the first time you click Apply. You can check or change it in **Bone Mapping**:

* **Auto-map**: guesses again from the bone names and the skeleton shape.
* **Naming preset + Use Names**: maps bones by a known naming style. The styles are VRM, Unity/VMC,
  inZOI body tracking (`J_Bip_...`), Unreal mannequin (`pelvis`, `upperarm_l`...) and Mixamo.
* **Show bone list**: lists all 52 Zoi bones. Click a field to pick a different bone of your armature,
  or clear it with **x** to leave that bone out. Use **Show** to see one body part at a time.
* **Save Preset / Load Preset**: saves your mapping as a `.json` file so you can reuse it on other files.

T-pose and A-pose characters both work. The add-on lines up the arms and legs by itself. Characters
of any size and unit (meters or centimeters) also work.

## 4. Export for the inZOI ModKit

1. Select the armature that has the animation.
2. In **Export for inZOI ModKit**, click **Export for inZOI ModKit** and choose where to save the `.fbx`.
3. In the ModKit (Unreal), import the FBX as an **Animation** and pick the inZOI skeleton.

The export uses Unreal-friendly settings. They are: bake animation on, no leaf bones, deform bones
only, current action only (no NLA, no "all actions"), apply unit scale on, default axes (-Z forward,
Y up), and no key reduction. The armature is exported only, unless you tick **Include meshes**.
While exporting, the armature object is briefly renamed to `Armature`, which stops Unreal from adding
an extra root bone. Its real name comes back right after.

## Extras

* **Create Zoi Rig** adds the studio's own 52-bone Zoi skeleton, for previews or as a reference.
  It uses the chosen Zoi's body type and the selected naming preset.

## Troubleshooting

* **"Select an armature"**: click the skeleton itself, or a mesh that is attached to it.
* **The animation is twisted or mirrored**: open **Bone Mapping**, check the left/right arms and legs,
  and fix any bone that is wrong.
* **The character slides when you play it in game**: use **Root motion: In place** for walk and idle
  styles (locomotion), unless your ModKit setup expects root motion.
* **Apply onto the deform skeleton**, not onto a control rig (Rigify or other rigs with IK controls).
  The add-on writes directly onto the bones.

## For developers

* Run the tests (headless):
  `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 --python tests\blender\test_zoi_motion_bridge.py`
* Rebuild the zip after editing the add-on: `python blender\build_zip.py`
* The math is a direct port of the studio's `rig.js`, `clip.js` (`_sampleKeys`) and `retarget.js` (`autoMap`, `Retargeter`).
