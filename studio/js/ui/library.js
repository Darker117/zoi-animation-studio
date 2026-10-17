// Left panel: My poses · Motions (text, video, files) · Face · Pack.
import { h, $, contextMenu, promptDialog, toast, confirmDialog } from './dom.js';
import { icon } from './icons.js';
import { EXPRESSIONS } from '../core/clip.js';
import { SCENE_KINDS } from '../core/project.js';
import { poseThumb, forgetThumb } from './thumbs.js';
import { prefGet, prefSet } from '../storage.js';
import * as dialogs from './dialogs.js';
import { uid } from '../core/math.js';

export function mountLibrary(app) {
  const root = $('#library');
  const tabs = [
    { id: 'poses', label: 'Poses', icon: 'user' },
    { id: 'motions', label: 'Motions', icon: 'sparkles' },
    { id: 'face', label: 'Face', icon: 'smile' },
    { id: 'pack', label: 'Pack', icon: 'package' },
  ];
  const saved = prefGet('libTab', 'poses');
  const state = { tab: tabs.some((t) => t.id === saved) ? saved : 'poses', query: '' };
  const tabBar = h('div.tabs', { role: 'tablist' });
  const body = h('div.panel-body');
  root.append(tabBar, body);

  const renderTabs = () => {
    tabBar.innerHTML = '';
    for (const t of tabs) {
      tabBar.append(h('button.tab' + (state.tab === t.id ? '.active' : ''), {
        role: 'tab', 'aria-selected': String(state.tab === t.id), 'data-tab': t.id,
        onclick: () => { state.tab = t.id; prefSet('libTab', t.id); renderTabs(); render(); },
        html: icon(t.icon, 15) + `<span>${t.label}</span>`,
      }));
    }
  };

  const userPoses = () => prefGet('userPoses', []);

  // ---------------------------------------------------------------- my poses
  const renderPoses = () => {
    const search = h('div.search', { html: icon('search', 15) }, h('input', {
      type: 'search', placeholder: 'Search your poses…', value: state.query,
      oninput: (e) => { state.query = e.target.value; renderGrid(); },
    }));
    const grid = h('div.grid');
    const tip = h('p.hint-text', { style: { margin: '0 2px 10px' } }, 'Pose your Zoi in the viewport, then save it here. Click a saved pose to put it on the selected Zoi at the current frame; right-click for more.');
    body.append(tip, search, grid);

    const renderGrid = () => {
      grid.innerHTML = '';
      const q = state.query.trim().toLowerCase();
      let list = userPoses();
      if (q) list = list.filter((p) => p.label.toLowerCase().includes(q));
      grid.append(h('button.tile', { onclick: saveCurrentPose, title: 'Save the current pose to your library' },
        h('div.thumb', { html: icon('plus', 34) }), h('div.label', {}, 'Save current pose')));
      if (q && !list.length) grid.append(h('div.empty', { style: { gridColumn: '1 / -1' } }, 'No poses match.'));
      for (const p of list) {
        const img = h('img', { alt: '' });
        const thumb = h('div.thumb', {}, img);
        poseThumb('user:' + p.id, { pose: absPose(app, p.pose) }).then((url) => { if (url) img.src = url; });
        const apply = (opts = {}) => applyUserPose(app, p, opts);
        const menu = (e) => {
          e.preventDefault();
          contextMenu(e.clientX, e.clientY, [
            { label: p.label, header: true },
            { label: 'Apply', icon: 'check', onClick: () => apply() },
            { label: 'Apply mirrored', icon: 'mirror', onClick: () => apply({ mirror: true }) },
            '-',
            { label: 'Rename…', icon: 'text', onClick: () => renameUserPose(p) },
            { label: 'Delete', icon: 'trash', onClick: () => deleteUserPose(p) },
          ]);
        };
        grid.append(h('button.tile', { title: p.label, onclick: () => apply(), oncontextmenu: menu },
          thumb, h('div.label', {}, p.label),
          h('div.corner', {}, h('button', { title: 'Apply mirrored', html: icon('mirror', 13), onclick: (e) => { e.stopPropagation(); apply({ mirror: true }); } }))));
      }
    };
    renderGrid();
  };

  const saveCurrentPose = async () => {
    const a = app.activeActor;
    if (!a) return;
    const name = await promptDialog('Save pose', 'Name for this pose', 'My pose ' + (userPoses().length + 1));
    if (!name) return;
    const pose = a.capturePose();
    const rel = { rot: pose.rot, hips: [pose.pos.hips[0] - a.rest.hips.x, pose.pos.hips[1] - a.rest.hips.y, pose.pos.hips[2] - a.rest.hips.z] };
    const list = userPoses();
    list.unshift({ id: uid('pose'), label: name, pose: rel });
    prefSet('userPoses', list);
    toast(`Saved "${name}" to My poses.`, { type: 'ok' });
    render();
  };
  const renameUserPose = async (p) => {
    const name = await promptDialog('Rename pose', 'Pose name', p.label);
    if (!name) return;
    prefSet('userPoses', userPoses().map((x) => (x.id === p.id ? { ...x, label: name } : x)));
    render();
  };
  const deleteUserPose = async (p) => {
    if (!(await confirmDialog('Delete pose?', `Remove "${p.label}" from My poses?`, { okLabel: 'Delete', danger: true }))) return;
    prefSet('userPoses', userPoses().filter((x) => x.id !== p.id));
    forgetThumb('user:' + p.id);
    render();
  };

  // ---------------------------------------------------------------- motions
  const renderMotions = () => {
    body.append(h('p.hint-text', { style: { margin: '0 2px 10px' } }, 'Make motion without keying every frame. Whatever comes in becomes normal keys, so you can edit every part afterwards.'));
    const item = (ic, title, text, onclick) => h('button.list-item', { onclick, style: { marginTop: '4px' } },
      h('div.lead.accent', { html: icon(ic, 18) }), h('div.meta', {}, h('b', {}, title), h('span', {}, text)));
    body.append(h('div.list', {},
      item('sparkles', 'Describe a motion (AI)', 'Type "a person waves excitedly" and get an animation', () => dialogs.textToMotion(app)),
      item('video', 'Act it out', 'Record yourself on webcam, or use any video', async () => (await import('./captureDialog.js')).captureDialog(app)),
      item('upload', 'Import an animation', 'Mixamo FBX, BVH mocap, GLB, VRM/VRMA: retargeted automatically', () => dialogs.importPicker(app))));
  };

  // ---------------------------------------------------------------- face
  const renderFace = () => {
    const face = h('div.card');
    const clip = app.activeClip;
    for (const e of EXPRESSIONS) {
      const val = clip ? clip.sampleExpr(e.id, app.frame) : 0;
      const out = h('span.muted.small', {}, Math.round(val * 100) + '%');
      face.append(h('div.ctrl', {},
        h('div.ctrl-top', {}, h('span.name', {}, e.label), out),
        h('input', {
          type: 'range', min: 0, max: 1, step: 0.01, value: val,
          oninput: (ev) => { out.textContent = Math.round(ev.target.value * 100) + '%'; app.activeActor.expr = { ...app.activeActor.expr, [e.id]: +ev.target.value }; },
          onchange: (ev) => app.setExpression(e.id, +ev.target.value),
        })));
    }
    body.append(h('div.section', {}, h('div.section-title', {}, 'Face expressions'),
      h('p.hint-text', { style: { margin: '0 2px 8px' } }, 'Face keys play on your Zoi through the live link. ModKit exports are body-only (inZOI drives faces with its own face animations).'),
      face));
  };

  // ---------------------------------------------------------------- pack
  const renderPack = () => {
    const p = app.project.pack;
    body.append(h('div.card', {},
      h('div.row', {}, h('b', { style: { flex: 1, fontSize: '14px' } }, p.name), h('button.btn.small', { onclick: () => dialogs.packSettings(app), html: icon('sliders', 14) + 'Settings' })),
      h('div.muted.small', { style: { marginTop: '4px' } }, `${app.project.scenes.length} animation${app.project.scenes.length === 1 ? '' : 's'} · by ${p.author || 'you'} · v${p.version}`)));
    body.append(h('div.section-title', { style: { marginTop: '14px' } }, 'Animations in this pack'));
    const list = h('div.list');
    app.project.scenes.forEach((s, i) => {
      const len = s.stages.reduce((t, st) => t + st.frames / st.fps, 0);
      list.append(h('button.list-item' + (i === app.sceneIdx ? '.active' : ''), {
        onclick: () => app.setScene(i),
        oncontextmenu: (e) => {
          e.preventDefault();
          contextMenu(e.clientX, e.clientY, [
            { label: 'Duplicate', icon: 'copy', onClick: () => app.duplicateScene(i) },
            { label: 'Delete', icon: 'trash', onClick: () => app.deleteScene(i) },
          ]);
        },
      },
      h('div.lead.accent', { html: icon(s.actors.length > 1 ? 'users' : s.kind === 'locomotion' || s.kind === 'statLocomotion' ? 'footprints' : s.kind === 'pose' ? 'user' : 'film', 18) }),
      h('div.meta', {}, h('b', {}, s.name), h('span', {}, `${SCENE_KINDS[s.kind]?.label || s.kind} · ${s.stages.length} stage${s.stages.length > 1 ? 's' : ''} · ${len.toFixed(1)} s`)),
      s.actors.length > 1 ? h('span.badge', {}, `${s.actors.length} Zois`) : null));
    });
    body.append(list, h('div.btn-row', { style: { marginTop: '10px' } },
      h('button.btn', { onclick: () => app.addActor(), title: `Add a Zoi to "${app.scene.name}"`, html: icon('plus', 15) + 'Zoi' })));
    body.append(h('p.hint-text', { style: { marginTop: '14px' } }, 'A pack is what players install. Select an animation and press + Zoi to add another Zoi to it (hugs, dances, group scenes). Animations can also have several stages (for example: approach → hug loop → let go). Start a new animation from the menu next to its name at the top, and export the whole pack from the Export button.'));
  };

  const render = () => {
    body.innerHTML = '';
    ({ poses: renderPoses, motions: renderMotions, face: renderFace, pack: renderPack })[state.tab]();
  };

  renderTabs();
  render();
  app.on('scene', () => { if (state.tab === 'pack' || state.tab === 'face') render(); });
  app.on('project', render);
  app.on('frame', () => { if (state.tab === 'face') render(); });
  app.on('actor', () => { if (state.tab === 'face') render(); });
  app.library = { render, setTab: (t) => { state.tab = t; renderTabs(); render(); } };
}

function absPose(app, rel) {
  const a = app.activeActor;
  const hr = a ? a.rest.hips : { x: 0, y: 1.0127, z: 0.0036 };
  return { rot: rel.rot, pos: { hips: [hr.x + rel.hips[0], hr.y + rel.hips[1], hr.z + rel.hips[2]] } };
}

function applyUserPose(app, p, { mirror = false } = {}) {
  const a = app.activeActor;
  let pose = absPose(app, p.pose);
  if (mirror) {
    const out = { rot: {}, pos: {} };
    for (const [b, q] of Object.entries(pose.rot)) {
      const m = b.startsWith('left') ? 'right' + b.slice(4) : b.startsWith('right') ? 'left' + b.slice(5) : b;
      out.rot[m] = [q[0], -q[1], -q[2], q[3]];
    }
    out.pos.hips = [2 * a.rest.hips.x - pose.pos.hips[0], pose.pos.hips[1], pose.pos.hips[2]];
    pose = out;
  }
  a.applyPose(pose);
  app.keyBones(null, { label: `Pose: ${p.label}` });
}
