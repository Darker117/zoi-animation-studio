// All modal dialogs.
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';
import { h, modal, toast, pickFile, downloadBlob, esc } from './dom.js';
import { icon } from './icons.js';
import { prefGet, prefSet, bridge } from '../storage.js';
import { loadModelFile, parseModel, importAnimation, CharacterRig, mappingFor, SUPPORTED_EXT } from '../io/import.js';
import { describeSkeleton, missingBones } from '../core/retarget.js';
import { exportCanonicalFBX, exportTargetFBX, exportBVH, exportGLB, ROOT_MOTION } from '../io/export.js';
import { NAMING, BONES, BONE_MAP } from '../core/rig.js';
import { Actor } from '../core/actor.js';
import { SCENE_KINDS, projectToJSON, slug, createScene, syncStageTiming } from '../core/project.js';
import { buildPackManifest, buildSetupSheet, buildReadme } from '../io/pack.js';

// ------------------------------------------------------------------ welcome

export function welcome(app) {
  const card = (ic, title, text, fn) => h('button.welcome-card', { onclick: () => { m.close(); fn(); } }, h('div.wi', { html: icon(ic, 18) }), h('b', {}, title), h('span', {}, text));
  const m = modal({
    title: 'Welcome to Studio',
    wide: true,
    content: h('div', {},
      h('div.welcome-brand', {},
        h('img', { src: 'assets/logo-mark.png', alt: '', class: 'wb-mark' }),
        h('img', { src: 'assets/wordmark.png', alt: 'Studio', class: 'wb-word' })),
      h('p', { style: { margin: '0 0 6px', color: 'var(--text-2)', fontSize: '13px' } }, 'Make any animation for your Zois: pose them like a doll, set keys on the timeline, and send it to inZOI.'),
      h('div.welcome-grid', {},
        card('hand', 'Pose it yourself', 'Click any body part and drag it. Hands and feet reach on their own.', () => document.getElementById('viewport')?.focus()),
        card('wand', 'Describe a motion', 'Type what your Zoi should do and the AI animates it.', () => textToMotion(app)),
        card('upload', 'Import an animation', 'Mixamo FBX, BVH mocap, GLB, VRM/VRMA: retargeted automatically.', () => importPicker(app)),
        card('video', 'Act it out', 'Record yourself on a webcam, or use any video of a person.', async () => (await import('./captureDialog.js')).captureDialog(app)),
        card('live', 'See it live in inZOI', "Stream to your Zoi through the game's Motion Capture.", () => liveDialog(app)),
        card('info', 'Take the 1-minute tour', 'Learn the basics with a guided walkthrough.', () => app.startTour()),
      )),
    buttons: [{ label: 'Just let me in', primary: true }],
    onClose: () => prefSet('welcomed', true),
  });
}

// ------------------------------------------------------------------ shortcuts

export function shortcuts() {
  const rows = [
    ['Space', 'Play / pause'], ['← →', 'Previous / next frame (Shift = 10)'], ['↓ ↑', 'Previous / next key'], ['Home / End', 'First / last frame'],
    ['K', 'Key the selected part (Shift+K: whole pose)'], ['Del', 'Delete selected keys'], ['Ctrl+C / Ctrl+V', 'Copy / paste pose (or keys)'], ['Ctrl+Shift+V', 'Paste pose mirrored'],
    ['M', 'Flip pose left ↔ right'], ['E / R', 'Rotate tool'], ['W / G', 'Move tool (IK for hands & feet)'], ['F / Shift+F', 'Focus selection / frame everything'],
    ['1 · 3 · 5 · 7', 'Front · side · ¾ · top view'], ['Tab', 'Next Zoi'], ['O / P', 'Onion skin / motion path'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['Ctrl+S / Ctrl+O', 'Save / open project'], ['Ctrl+I / Ctrl+E', 'Import / export'], ['Alt+drag', 'Orbit even over the Zoi'], ['Right-drag · wheel', 'Pan · zoom'],
  ];
  modal({
    title: 'Keyboard shortcuts',
    content: h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '7px 14px', alignItems: 'center' } },
      ...rows.flatMap(([k, d]) => [h('div', { html: k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' / ') }), h('div.muted', {}, d)])),
    buttons: [{ label: 'Close', primary: true }],
  });
}

// ------------------------------------------------------------------ import

export async function importPicker(app) {
  const file = await pickFile(SUPPORTED_EXT.map((e) => '.' + e).concat(['.zmotion']).join(','));
  if (file) app.importFiles([file]);
}

export async function importFile(app, file) {
  let loaded;
  const busy = toast(`Reading ${file.name}…`, { timeout: 60000 });
  try { loaded = await loadModelFile(file); } catch (e) { busy.remove(); toast(`Could not read ${file.name}: ${e.message}`, { type: 'err', timeout: 7000 }); return; } finally { busy.remove(); }
  showImport(app, loaded);
}

function hasMesh(model) { let m = false; model.traverse((o) => { if (o.isSkinnedMesh) m = true; }); return m; }

function showImport(app, loaded) {
  loaded.model.updateMatrixWorld(true);
  const skel = describeSkeleton(loaded.model);
  let mapping = mappingFor(loaded, skel);
  const anims = loaded.animations;
  const canAnim = anims.length > 0;
  const canChar = hasMesh(loaded.model);
  const status = h('div');
  const renderStatus = () => {
    const miss = missingBones(mapping);
    const n = Object.keys(mapping).length;
    status.innerHTML = '';
    status.append(h('div.row', {},
      miss.length ? h('span.badge.warn', {}, `${miss.length} key bones not found`) : h('span.badge.ok', {}, 'Skeleton recognised'),
      h('span.muted.small', {}, `${n} of ${BONES.length} Zoi bones matched${loaded.humanoid ? ' (VRM humanoid)' : ''}`),
      h('span.grow'), h('button.btn.small', { onclick: () => mapBones(skel, mapping, (m) => { mapping = m; renderStatus(); }) }, 'Map bones…')));
    if (miss.length) status.append(h('p.hint-text', {}, `Missing: ${miss.join(', ')}. Open "Map bones…" to pick them by hand.`));
  };
  renderStatus();

  const animSel = h('select', {}, anims.map((a, i) => h('option', { value: i }, `${a.name || 'Animation ' + (i + 1)} · ${a.duration.toFixed(1)} s`)));
  let target = 'new';
  const targetSeg = h('div.seg', {}, ...[['new', 'New animation'], ['replace', 'Replace current'], ['insert', 'Insert at playhead']].map(([id, l]) => {
    const b = h('button' + (id === target ? '.on' : ''), { onclick: () => { target = id; [...targetSeg.children].forEach((c) => c.classList.toggle('on', c === b)); } }, l);
    return b;
  }));
  const simplify = h('select', {}, [['0', 'Keep every frame (exact)'], ['0.002', 'Light clean-up'], ['0.006', 'Medium (recommended)'], ['0.015', 'Strong (easiest to edit)']].map(([v, l]) => h('option', { value: v, selected: v === '0.006' }, l)));
  const fps = h('select', {}, [24, 30, 60].map((v) => h('option', { value: v, selected: v === app.stage.fps }, `${v} fps`)));

  const doImport = () => {
    const a = app.activeActor;
    try {
      const res = importAnimation(loaded, a, { animIndex: +animSel.value, fps: +fps.value, simplify: +simplify.value, mapping });
      const clip = res.clip;
      if (target === 'new') {
        app.structural('Import animation', () => {
          const scene = createScene({ name: clip.name || loaded.name, actors: 1 });
          const st = scene.stages[0];
          st.frames = clip.frames; st.fps = clip.fps; st.loop = clip.loop;
          const slotId = scene.actors[0].id;
          clip.name = scene.name;
          st.clips[slotId] = clip;
          syncStageTiming(st);
          app.project.scenes.push(scene);
          app.sceneIdx = app.project.scenes.length - 1;
          app.stageIdx = 0;
          app.buildActors();
        });
        app.setFrame(0);
        app.timeline.fit();
      } else {
        app.clipOp('Import animation', (c) => {
          if (target === 'replace') { c.tracks = clip.tracks; c.frames = clip.frames; c.fps = clip.fps; c.loop = clip.loop; }
          else c.paste(clip, Math.round(app.frame));
        });
        app.timeline.fit();
      }
      toast(`Imported "${clip.name}" (${clip.frames} frames). Everything is editable now.`, { type: 'ok', timeout: 5000 });
      return true;
    } catch (e) {
      console.error(e);
      toast(e.message, { type: 'err', timeout: 7000 });
      return false;
    }
  };
  const useAsChar = () => {
    try {
      const rig = new CharacterRig(loaded, mapping);
      app.attachCharacter(app.activeSlotId, rig);
      toast(`${loaded.name} now follows ${app.activeSlot.name}. Exports can target its skeleton.`, { type: 'ok', timeout: 5000 });
    } catch (e) { console.error(e); toast(e.message, { type: 'err' }); }
  };

  const content = h('div', {},
    h('div.card', {}, h('b', {}, loaded.name), h('div.muted.small', {}, `${loaded.format.toUpperCase()} · ${skel.bones.length} bones · ${anims.length} animation${anims.length === 1 ? '' : 's'}${canChar ? ' · has a character mesh' : ''}`), h('div', { style: { marginTop: '8px' } }, status)),
    canAnim ? h('div.section', { style: { marginTop: '14px' } }, h('div.section-title', {}, 'Import the animation'), h('div.card', {},
      anims.length > 1 ? h('div.row', {}, h('label', {}, 'Animation'), animSel) : null,
      h('div.row', {}, h('label', {}, 'Put it in'), targetSeg),
      h('div.row', {}, h('label', {}, 'Keyframes'), simplify),
      h('div.row', {}, h('label', {}, 'Frame rate'), fps))) : null,
    canChar ? h('div.section', { style: { marginTop: '14px' } }, h('div.section-title', {}, 'Use as character'), h('p.hint-text', { style: { margin: 0 } },
      `Show this model on ${app.activeSlot.name} instead of the mannequin. If it is the inZOI skeleton from the ModKit, the Export can write FBX files that match it bone for bone.`)) : null,
    !canAnim && !canChar ? h('p.muted', {}, 'This file has no animation or skinned character in it.') : null);
  const buttons = [{ label: 'Cancel' }];
  if (canChar) buttons.push({ label: 'Use as character', primary: !canAnim, onClick: useAsChar });
  if (canAnim) buttons.push({ label: 'Import animation', primary: true, onClick: doImport });
  modal({ title: 'Import', content, buttons });
}

function mapBones(skel, mapping, onDone) {
  const m = { ...mapping };
  const names = skel.bones.map((b) => b.name);
  const table = h('table.map-table');
  const essential = new Set(missingBones({}));
  for (const b of BONES) {
    const sel = h('select', { onchange: () => { if (sel.value) m[b.name] = sel.value; else delete m[b.name]; tr.classList.toggle('missing', !sel.value && essential.has(b.name)); } },
      h('option', { value: '' }, '— none —'), names.map((n) => h('option', { value: n, selected: m[b.name] === n }, n)));
    const tr = h('tr' + (!m[b.name] && essential.has(b.name) ? '.missing' : ''), {}, h('td', {}, b.label), h('td', {}, sel));
    table.append(tr);
  }
  modal({
    title: 'Map bones', wide: true,
    content: h('div', {}, h('p.hint-text', { style: { marginTop: 0 } }, 'Match each Zoi body part to a bone in the file. Orange rows are needed for a good result; fingers and toes are optional.'), table),
    buttons: [{ label: 'Cancel' }, { label: 'Use this mapping', primary: true, onClick: () => onDone(m) }],
  });
}

// ------------------------------------------------------------------ characters

export async function characterMenu(app, slotId) {
  app.setActiveActor(slotId);
  const { listLooks } = await import('../characters.js');
  const looks = await listLooks();
  const slot = app.scene.actors.find((s) => s.id === slotId);
  const current = slot.look || app.defaultLook;
  const cards = looks.map((l) => h('button.option-card' + (current === l.id ? '.on' : ''), { onclick: () => { m.close(); app.setLook(slotId, l.id); } },
    h('b', { html: icon(l.id === 'mannequin' ? 'bone' : 'user', 16) + esc(l.label) }),
    h('span', {}, l.id === 'inzoi' ? 'The Zoi body inZOI uses for motion capture (loaded from your game folder).'
      : l.id === 'mannequin' ? 'Segmented posing dummy: every joint visible.' : (l.credit || 'Built-in character'))));
  cards.push(h('button.option-card' + (current === 'custom' ? '.on' : ''), { onclick: () => { m.close(); importPicker(app); } },
    h('b', { html: icon('upload', 16) + 'From a file…' }), h('span', {}, "FBX / GLB / VRM. Use the ModKit's Zoi body for an exact in-game match.")));
  const m = modal({
    title: 'Character for ' + slot.name,
    content: h('div', {}, h('div.option-cards', {}, cards),
      h('p.hint-text', {}, 'The character only changes how the Zoi looks while you animate; the animation itself works on every body.')),
    buttons: [{ label: 'Close' }],
  });
}

export async function loadInzoiBody(app) {
  if (!bridge.available) await bridge.detect();
  if (bridge.available && bridge.info?.game?.vrm) {
    app.setLook(app.activeSlotId, 'inzoi');
    toast('Using the inZOI body.', { type: 'ok' });
    return;
  }
  modal({
    title: 'Load the inZOI body',
    content: h('div', {},
      h('p', { style: { marginTop: 0 } }, 'inZOI ships its body-tracking Zoi with the game. Pick this file:'),
      h('div.code', {}, '…\steamapps\common\inZOI\Guides\MotionCapture\BodyTrackingVrm.vrm'),
      h('p.hint-text', {}, 'It stays on your PC (the studio never uploads or redistributes it). Start the studio with "Start Studio.bat" and it is found automatically.')),
    buttons: [{ label: 'Cancel' }, { label: 'Choose file…', primary: true, onClick: async () => { const f = await pickFile('.vrm'); if (f) attachVrm(app, await f.arrayBuffer(), f.name); } }],
  });
}

async function attachVrm(app, buf, name) {
  try {
    const loaded = await parseModel(buf, 'vrm', name);
    const rig = new CharacterRig(loaded);
    app.attachCharacter(app.activeSlotId, rig);
    toast('The inZOI body now follows your animation.', { type: 'ok' });
  } catch (e) { console.error(e); toast('Could not load the body: ' + e.message, { type: 'err' }); }
}

// ------------------------------------------------------------------ pack settings

export function packSettings(app) {
  const p = app.project.pack;
  const f = {};
  const field = (key, label, ph = '', type = 'text') => {
    f[key] = type === 'textarea' ? h('textarea', { rows: 3, placeholder: ph }, p[key]) : h('input', { type, value: p[key], placeholder: ph });
    return h('div.row', {}, h('label', {}, label), f[key]);
  };
  modal({
    title: 'Pack settings',
    content: h('div', {},
      field('name', 'Pack name', 'Cute Couple Animations'),
      field('author', 'Author', 'your name'),
      field('id', 'Pack id', 'author.packname'),
      field('version', 'Version', '1.0.0'),
      field('description', 'Description', 'What is in this pack?', 'textarea'),
      h('p.hint-text', {}, 'The pack id must be unique; it prefixes every exported file so packs never clash in the game.')),
    buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => {
      app.structural('Pack settings', () => {
        for (const k of Object.keys(f)) p[k] = f[k].value.trim();
        p.id = slug(p.id || `${p.author}.${p.name}`, 'mypack').toLowerCase();
      });
      app.emit('project');
    } }],
  });
}

// ------------------------------------------------------------------ export

export function exportDialog(app) {
  const anyChar = [...app.characters.values()][0];
  const opts = {
    what: prefGet('exp.what', 'pack'),
    format: prefGet('exp.format', 'modkit'),
    skeleton: anyChar ? 'character' : prefGet('exp.skeleton', 'unreal'),
    rootMotion: prefGet('exp.rootMotion', 'keep'),
  };
  const body = h('div');
  const render = () => {
    body.innerHTML = '';
    const cards = (key, items) => h('div.option-cards', {}, items.map(([id, title, text, ic]) => h('button.option-card' + (opts[key] === id ? '.on' : ''), { onclick: () => { opts[key] = id; render(); } }, h('b', { html: icon(ic, 16) + esc(title) }), h('span', {}, text))));
    body.append(h('div.section-title', {}, 'Export'),
      cards('what', [['pack', 'Whole pack', `${app.project.scenes.length} animation(s) with every stage and Zoi`, 'package'], ['scene', 'This animation', `"${app.scene.name}"`, 'film']]));
    body.append(h('div.section-title', { style: { marginTop: '14px' } }, 'Format'),
      cards('format', [
        ['modkit', 'inZOI pack (recommended)', 'FBX per animation + pack manifest + a ModKit setup sheet that says exactly what to fill in.', 'gamepad'],
        ['fbx', 'FBX only', 'For Blender, Maya, Unreal or the ModKit.', 'bone'],
        ['glb', 'GLB', 'Preview anywhere (Windows 3D Viewer, Blender, web).', 'eye'],
        ['bvh', 'BVH', 'Classic motion-capture format.', 'film'],
      ]));
    if (opts.format === 'modkit' || opts.format === 'fbx' || opts.format === 'bvh') {
      const sk = [];
      if (anyChar) sk.push(['character', `Loaded character (${anyChar.loaded.name})`, 'Bone-for-bone match. Use the inZOI skeleton from the ModKit here.', 'user']);
      if (opts.format !== 'bvh') sk.push(['unreal', 'Unreal mannequin names', 'root/pelvis/spine_01… Retarget in Unreal if inZOI\'s skeleton differs.', 'bone']);
      sk.push(['inzoiVrm', 'inZOI body-tracking names', 'J_Bip_C_Hips… (the BodyTrackingVrm skeleton)', 'bone'], ['vrm', 'VRM humanoid names', 'hips, leftUpperArm…', 'bone'], ['mixamo', 'Mixamo names', 'mixamorig:Hips…', 'bone']);
      if (!sk.find((s) => s[0] === opts.skeleton)) opts.skeleton = sk[0][0];
      body.append(h('div.section-title', { style: { marginTop: '14px' } }, 'Skeleton'), cards('skeleton', sk));
    }
    const rm = h('select', { onchange: () => { opts.rootMotion = rm.value; } }, Object.entries(ROOT_MOTION).map(([id, l]) => h('option', { value: id, selected: opts.rootMotion === id }, l)));
    body.append(h('div.row', { style: { marginTop: '14px' } }, h('label', {}, 'Movement'), rm));
    body.append(h('p.hint-text', {}, bridge.available
      ? 'Files are written to Documents\\Zoi Motion Studio\\Exports and the folder opens when done.'
      : 'Files download as a .zip (start the studio with "Start Studio.bat" to save straight into a folder).'));
  };
  render();
  modal({
    title: 'Export', wide: true, content: body,
    footLeft: h('div', { style: { display: 'flex', gap: '6px' } },
      h('button.btn.ghost', { onclick: () => inzoiGuide(app), html: icon('help', 15) + 'How do I get this into inZOI?' }),
      bridge.available ? h('button.btn', { title: 'Adds this pack to the Animations panel of the Zoi Animation Framework mod in your game', onclick: () => installToGame(app, opts) , html: icon('gamepad', 15) + 'Install into my game' }) : null),
    buttons: [{ label: 'Cancel' }, { label: 'Export', primary: true, onClick: async () => {
      for (const k of Object.keys(opts)) prefSet('exp.' + k, opts[k]);
      await runExport(app, opts);
    } }],
  });
}

async function runExport(app, opts) {
  const pack = app.project.pack;
  const packId = slug(pack.id || pack.name, 'pack').toLowerCase();
  const scenes = opts.what === 'pack' ? app.project.scenes : [app.scene];
  const files = {}; // relPath -> Uint8Array|string
  const animations = [];
  const charFor = (slotId) => app.characters.get(slotId) || [...app.characters.values()][0];
  const busy = toast('Exporting…', { timeout: 120000 });
  try {
    for (const scene of scenes) {
      const sid = slug(scene.name, 'anim');
      scene.stages.forEach((st, si) => {
        scene.actors.forEach((slot, ai) => {
          const clip = st.clips[slot.id];
          if (!clip) return;
          const id = `${packId}_${sid}${scene.stages.length > 1 ? `_s${si + 1}` : ''}${scene.actors.length > 1 ? `_${String.fromCharCode(97 + ai)}` : ''}`;
          const proxy = new Actor({ bodyType: slot.bodyType });
          let rel, data;
          if (opts.format === 'glb') {
            animations.push({ id, scene, st, slot, clip, rel: `Animations/${id}.glb`, pending: exportGLB(clip, () => new Actor({ bodyType: slot.bodyType }), proxy.rest, { rootMotion: opts.rootMotion }) });
            proxy.dispose();
            return;
          }
          if (opts.format === 'bvh') {
            rel = `Animations/${id}.bvh`;
            data = exportBVH(clip, proxy.rest, { naming: opts.skeleton === 'character' ? 'vrm' : opts.skeleton, rootMotion: opts.rootMotion });
          } else if (opts.skeleton === 'character' && charFor(slot.id)) {
            const ch = charFor(slot.id);
            const actor = app.actors.find((a) => a.slotId === slot.id) || proxy;
            ch.retargeter.bindActor(actor);
            rel = `Animations/${id}.fbx`;
            data = exportTargetFBX(ch, actor, clip, { rootMotion: opts.rootMotion, name: id });
          } else {
            rel = `Animations/${id}.fbx`;
            data = exportCanonicalFBX(clip, proxy.rest, { naming: opts.skeleton === 'character' ? 'unreal' : opts.skeleton, rootMotion: opts.rootMotion, name: id });
          }
          proxy.dispose();
          files[rel] = data;
          animations.push({ id, scene, st, slot, clip, rel });
        });
      });
    }
    for (const a of animations) if (a.pending) files[a.rel] = await a.pending;
    if (opts.format === 'modkit') {
      const manifest = buildPackManifest(app.project, scenes, animations, { skeleton: opts.skeleton, rootMotion: opts.rootMotion });
      files['zaf_pack.json'] = JSON.stringify(manifest, null, 2);
      files['ModKit setup sheet.html'] = buildSetupSheet(app.project, manifest);
      files['README.txt'] = buildReadme(app.project, manifest);
      files[`Source/${packId}.zmotion`] = JSON.stringify(projectToJSON({ ...app.project, scenes }));
    }
    const folder = `Exports/${packId}`;
    if (bridge.available) {
      for (const [rel, data] of Object.entries(files)) await bridge.save(`${folder}/${rel}`, typeof data === 'string' ? data : data);
      busy.remove();
      toast(`Exported ${animations.length} animation${animations.length === 1 ? '' : 's'} to Documents\\Zoi Motion Studio\\${folder.replace(/\//g, '\\')}`, { type: 'ok', timeout: 7000, action: () => bridge.reveal(folder), actionLabel: 'Open folder' });
      bridge.reveal(folder);
    } else {
      const zipIn = {};
      for (const [rel, data] of Object.entries(files)) zipIn[`${packId}/${rel}`] = typeof data === 'string' ? strToU8(data) : data;
      const single = Object.keys(files).length === 1;
      if (single) {
        const [rel, data] = Object.entries(files)[0];
        downloadBlob(data, rel.split('/').pop());
      } else downloadBlob(zipSync(zipIn, { level: 6 }), `${packId}.zip`, 'application/zip');
      busy.remove();
      toast(`Exported ${animations.length} animation${animations.length === 1 ? '' : 's'}.`, { type: 'ok' });
    }
  } catch (e) {
    busy.remove();
    console.error(e);
    toast('Export failed: ' + e.message, { type: 'err', timeout: 8000 });
  }
}

// ------------------------------------------------------------------ install into the game

async function installToGame(app, opts) {
  try {
    const pack = app.project.pack;
    const packId = slug(pack.id || pack.name, 'pack').toLowerCase();
    const scenes = opts.what === 'pack' ? app.project.scenes : [app.scene];
    const animations = [];
    for (const scene of scenes) {
      const sid = slug(scene.name, 'anim');
      scene.stages.forEach((st, si) => scene.actors.forEach((slot, ai) => {
        const id = `${packId}_${sid}${scene.stages.length > 1 ? `_s${si + 1}` : ''}${scene.actors.length > 1 ? `_${String.fromCharCode(97 + ai)}` : ''}`;
        animations.push({ id, scene, st, slot, clip: st.clips[slot.id], rel: `Animations/${id}.fbx` });
      }));
    }
    const manifest = buildPackManifest(app.project, scenes, animations, { skeleton: opts.skeleton, rootMotion: opts.rootMotion });
    const r = await fetch('/api/runtime/pack', { method: 'POST', body: JSON.stringify(manifest) });
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();
    toast(`"${pack.name}" is in your game's Animations panel (${res.packs.length} pack${res.packs.length === 1 ? '' : 's'} installed). Its animations play once the pack's ModKit mod is installed.`, { type: 'ok', timeout: 8000 });
  } catch (e) { toast('Install failed: ' + e.message, { type: 'err', timeout: 8000 }); }
}

// ------------------------------------------------------------------ live link

export function liveDialog(app) {
  const v = app.vmc;
  const body = h('div');
  const render = async () => {
    body.innerHTML = '';
    const ok = bridge.available || (await bridge.detect());
    const host = h('input', { type: 'text', value: v.host, onchange: () => { v.host = host.value.trim() || '127.0.0.1'; app.saveVmcPrefs(); } });
    const port = h('input.inline-num', { type: 'number', value: v.port, onchange: () => { v.port = +port.value || 39539; app.saveVmcPrefs(); } });
    const fps = h('select', { onchange: () => { v.fps = +fps.value; app.saveVmcPrefs(); } }, [24, 30, 60].map((x) => h('option', { value: x, selected: v.fps === x }, `${x} per second`)));
    const who = h('select', { onchange: () => { app.liveSlotId = who.value; } }, app.scene.actors.map((s) => h('option', { value: s.id, selected: (app.liveSlotId || app.activeSlotId) === s.id }, s.name)));
    const bundle = h('input', { type: 'checkbox', checked: v.bundle, onchange: () => { v.bundle = bundle.checked; app.saveVmcPrefs(); } });
    body.append(
      h('div.card', {}, h('div.row', {},
        ok ? h('span.badge.ok', {}, 'Bridge running') : h('span.badge.warn', {}, 'Bridge not running'),
        v.active ? h('span.badge.accent', {}, `Streaming · ${v.sent} sent${v.lastError ? ' · ' + v.lastError : ''}`) : h('span.muted.small', {}, 'Not streaming'))),
      h('div.section', { style: { marginTop: '12px' } }, h('div.section-title', {}, 'In inZOI'),
        h('ol.steps', {},
          h('li', {}, 'Open inZOI and select the Zoi you want to drive.'),
          h('li', {}, 'Open the game\'s ', h('b', {}, 'Motion Capture (Experimental)'), ' window and click ', h('b', {}, 'Turn On'), '.'),
          h('li', {}, 'Leave the address here at 127.0.0.1 when inZOI runs on this PC (or type the "Current IP Address" shown in the game).'),
          h('li', {}, 'Press ', h('b', {}, 'Start streaming'), '. Whatever you pose or play here, your Zoi does in the game.'))),
      h('div.section', {}, h('div.section-title', {}, 'Connection'), h('div.card', {},
        h('div.row', {}, h('label', {}, 'Game address'), host, h('span.muted', {}, ':'), port),
        h('div.row', {}, h('label', {}, 'Send rate'), fps),
        h('div.row', {}, h('label', {}, 'Drive'), who),
        h('div.row', {}, h('label', {}, 'Bundle'), bundle, h('span.muted.small', {}, 'one packet per frame (turn off if your Zoi does not move)')))),
      !ok ? h('p.hint-text', {}, 'Live streaming needs the small local bridge. Close this tab and start the studio with "Start Studio.bat".') : null);
  };
  render();
  const m = modal({
    title: 'Live in inZOI', content: body,
    buttons: [{ label: 'Close' }, { label: v.active ? 'Stop streaming' : 'Start streaming', primary: true, onClick: async () => { await app.setLive(!v.active); } }],
  });
  return m;
}

export function bridgeHelp() {
  modal({
    title: 'Start the bridge',
    content: h('div', {},
      h('p', { style: { marginTop: 0 } }, 'Web pages cannot talk to games directly, so the studio uses a tiny helper that runs on your PC.'),
      h('ol.steps', {}, h('li', {}, 'Close this browser tab.'), h('li', {}, 'Double-click ', h('b', {}, 'Start Studio.bat'), ' in the studio folder.'), h('li', {}, 'The studio opens again with live streaming, folder export and inZOI body loading enabled.')),
      h('p.hint-text', {}, 'The helper only listens on this PC (localhost) and only sends to the address you choose.')),
    buttons: [{ label: 'OK', primary: true }],
  });
}

// ------------------------------------------------------------------ guide

export function inzoiGuide() {
  modal({
    title: 'Getting animations into inZOI', wide: true,
    content: h('div', {},
      h('div.option-cards', {},
        h('div.option-card', {}, h('b', { html: icon('live', 16) + 'Instantly: Live link' }), h('span', {}, 'Stream to your Zoi through the game\'s built-in Motion Capture. Perfect for photos, videos and testing. Nothing to install in the game.')),
        h('div.option-card', {}, h('b', { html: icon('gamepad', 16) + 'Permanently: ModKit' }), h('span', {}, 'Export an inZOI pack, then follow the setup sheet inside it to build a mod with the inZOI ModKit (free on the Epic Games Store).'))),
      h('div.section-title', { style: { marginTop: '16px' } }, 'ModKit in short'),
      h('ol.steps', {},
        h('li', {}, 'In the ModKit, export the Zoi skeleton/body once (Resources → Provided Unreal Assets) and load it here with Import → "Use as character". Then export with Skeleton = "Loaded character" for a perfect match.'),
        h('li', {}, 'Import each FBX from the pack\'s Animations folder onto the Zoi skeleton.'),
        h('li', {}, 'Create the animation config the setup sheet tells you: Interaction (Animation Montage), Locomotion (idle / walk) or Stat Locomotion (mood walks), with the Gender and Growth Step listed.'),
        h('li', {}, 'Export the mod locally or to CurseForge from the ModKit.')),
      h('p.hint-text', {}, 'Official docs: mod-docs.playinzoi.com → ModKit → How To → Animation.')),
    buttons: [{ label: 'Close', primary: true }],
  });
}

// ------------------------------------------------------------------ AI text to motion

export async function textToMotion(app) {
  const ai = await import('../ai/text2motion.js');
  const prompt = h('textarea', { rows: 3, placeholder: 'a person waves both hands excitedly, then jumps' }, prefGet('ai.prompt', ''));
  const secs = h('input.inline-num', { type: 'number', min: 2, max: 9.8, step: 0.5, value: prefGet('ai.secs', 4) });
  const bar = h('div.progress', {}, h('div'));
  const barLabel = h('div.muted.small', { style: { marginTop: '6px', minHeight: '16px' } });
  const card = h('div.card', { style: { marginBottom: '12px' } });
  let status = await ai.aiStatus();
  let polling = null;
  let busy = false;

  const setBar = (fraction, label = '') => { bar.firstChild.style.width = Math.round(fraction * 100) + '%'; barLabel.textContent = label; };
  // The card above the prompt explains what the AI is doing when it is not ready yet.
  const renderCard = () => {
    card.innerHTML = '';
    card.style.display = status.ready ? 'none' : '';
    if (status.ready) return;
    const title = { loading: 'Starting the AI', starting: 'Starting the AI', installing: 'Downloading the AI model',
      missing: 'The AI model is not downloaded yet', unavailable: 'AI not included', error: 'The AI could not start', offline: 'Studio\'s helper is not running' }[status.state] || 'AI not ready';
    card.append(h('b', {}, title), h('p.hint-text', { style: { margin: '4px 0 0' } }, status.message || ''));
    if (status.state === 'installing') {
      const p = h('div.progress', { style: { marginTop: '10px' } }, h('div'));
      p.firstChild.style.width = (status.percent || 0) + '%';
      card.append(p);
    }
    if (status.state === 'missing') {
      card.append(h('p.hint-text', {}, 'Studio downloads Python, PyTorch and the MSFlow model once (about 4 GB with an NVIDIA graphics card, about 1 GB without) and keeps them on this PC. Everything runs offline afterwards.'),
        h('button.btn.primary.small', { style: { marginTop: '8px' }, onclick: async () => {
          try { await ai.startAiSetup(); toast('Downloading the AI model. You can keep working while it downloads.', { type: 'ok' }); poll(); }
          catch (e) { toast(e.message, { type: 'err', timeout: 8000 }); }
        } }, 'Download AI model'));
    }
  };
  const poll = () => {
    if (polling) return;
    polling = setInterval(async () => {
      if (!card.isConnected) { clearInterval(polling); return; }
      status = await ai.aiStatus();
      if (!busy) renderCard();
      // Once the download finishes, wake the AI so it is ready when you press Generate.
      if (['ready', 'missing', 'unavailable', 'error', 'offline'].includes(status.state)) { if (status.state !== 'missing') { clearInterval(polling); polling = null; } }
    }, 1500);
  };
  renderCard();
  if (!status.ready && ['loading', 'starting', 'installing'].includes(status.state)) poll();

  modal({
    title: 'Describe a motion',
    content: h('div', {},
      card,
      h('div.row', {}, h('label', {}, 'Motion'), prompt),
      h('div.row', {}, h('label', {}, 'Length'), secs, h('span.muted', {}, 'seconds (2 to 9.8)')),
      h('p.hint-text', {}, 'Describe the body movement in plain English, for example "a person jumps forward and lands softly". The result arrives as a new animation you can edit like any other. Fingers and face are not generated.'),
      bar, barLabel),
    footLeft: h('span.muted.small', {}, 'MSFlow by LY Corporation'),
    buttons: [{ label: 'Close' }, { label: 'Generate', primary: true, onClick: async () => {
      if (busy) return false;
      const text = prompt.value.trim();
      if (!text) { toast('Describe the motion first.'); return false; }
      if (['missing', 'unavailable', 'offline'].includes(status.state)) { toast(status.message, { type: 'warn', timeout: 6000 }); return false; }
      prefSet('ai.prompt', prompt.value); prefSet('ai.secs', +secs.value);
      busy = true;
      try {
        await ai.generateFromText(app, text, Math.min(9.8, Math.max(2, +secs.value || 4)), setBar);
        toast(`Added "${app.scene.name}". Press Space to play it.`, { type: 'ok', timeout: 5000 });
        return true;
      } catch (e) {
        toast(e.message, { type: 'err', timeout: 8000 });
        setBar(0);
        return false;
      } finally { busy = false; }
    } }],
  });
}

export { BONE_MAP, NAMING, SCENE_KINDS };
