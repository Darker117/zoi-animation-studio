// Right panel: Pose · Animation · Scene.
import * as THREE from 'three';
import { h, $, toast, confirmDialog, promptDialog } from './dom.js';
import { icon } from './icons.js';
import { BONE_MAP, GROUPS, BODY_TYPES, BONES } from '../core/rig.js';
import { slidersFor, quatWithSlider } from '../core/params.js';
import { SCENE_KINDS } from '../core/project.js';
import { EASINGS, uid } from '../core/math.js';
import { PROP_TYPES } from '../props.js';
import { prefGet, prefSet } from '../storage.js';
import * as dialogs from './dialogs.js';
import { PoseViewer } from './poseViewer.js';

export function mountInspector(app) {
  const root = $('#inspector');
  const state = { tab: prefGet('inspTab', 'pose') };
  const tabs = [
    { id: 'pose', label: 'Pose', icon: 'bone' },
    { id: 'anim', label: 'Animation', icon: 'film' },
    { id: 'scene', label: 'Scene', icon: 'users' },
  ];
  const tabBar = h('div.tabs');
  const body = h('div.panel-body');
  root.append(tabBar, body);
  const poseViewer = new PoseViewer(app);

  const renderTabs = () => {
    tabBar.innerHTML = '';
    for (const t of tabs) {
      tabBar.append(h('button.tab' + (state.tab === t.id ? '.active' : ''), {
        'data-tab': t.id,
        onclick: () => { state.tab = t.id; prefSet('inspTab', t.id); renderTabs(); render(); },
        html: icon(t.icon, 15) + `<span>${t.label}</span>`,
      }));
    }
  };

  // ---------------------------------------------------------------- pose tab
  let sliderEls = [];
  const renderPose = () => {
    const bone = app.selectedBone;
    const actor = app.activeActor;
    const clip = app.activeClip;
    body.append(poseViewer.el);
    poseViewer.update();
    if (!bone || !actor) {
      body.append(h('div.empty', {},
        h('div', {}, 'Click a body part on the Zoi (or on the map above) to pose it.'),
        h('div.hint-text', { style: { marginTop: '8px' } }, 'Drag hands and feet to reach. Drag the hips to crouch or sit; the feet stay planted.')));
      return;
    }
    const def = BONE_MAP.get(bone);
    const group = GROUPS.find((g) => g.id === def.group);
    const f = Math.round(app.frame);
    const keyed = !!clip.getKey(bone, 'rot', f);
    const hasTrack = clip.keys(bone, 'rot').length > 0;
    body.append(h('div.bone-header', {},
      h('div.swatch', { style: { background: group.color } }),
      h('div', { style: { flex: 1 } }, h('b', {}, def.label), h('div.muted.small', {}, group.label)),
      keyed ? h('span.badge.ok', { title: 'This part has a key on this frame' }, 'Keyed') : hasTrack ? h('span.badge', { title: 'Between keys (interpolated)' }, 'In-between') : h('span.badge', {}, 'Not animated')));

    const q = actor.bones[bone].quaternion;
    const sliders = slidersFor(bone, q);
    sliderEls = [];
    const card = h('div.card');
    for (const s of sliders) {
      const num = h('input', { type: 'number', step: 1, value: Math.round(s.value) });
      const range = h('input', { type: 'range', min: s.min, max: s.max, step: 0.5, value: s.value });
      const set = (v, commit) => {
        const cur = actor.bones[bone].quaternion;
        const nq = quatWithSlider(bone, cur, s.axis, s.sign, v);
        app.setBoneQuat(bone, [nq.x, nq.y, nq.z, nq.w], { commit, label: `${def.label}: ${s.label}` });
      };
      range.addEventListener('input', () => { num.value = Math.round(range.value); set(+range.value, false); });
      range.addEventListener('change', () => set(+range.value, true));
      num.addEventListener('change', () => { range.value = num.value; set(+num.value, true); });
      sliderEls.push({ s, num, range });
      card.append(h('div.ctrl', {},
        h('div.ctrl-top', {}, h('span.name', {}, s.label), num),
        range,
        h('div.ctrl-ends', {}, h('span', {}, s.neg), h('span', {}, s.pos))));
    }
    if (bone === 'hips') card.append(hipsPosition(app));
    body.append(card);

    const btns = h('div.btn-row', { style: { marginTop: '10px' } },
      h('button.btn', { onclick: () => app.keyBones([bone]), title: 'Key this part (K)', html: icon('key', 14) + 'Key' }),
      h('button.btn', { onclick: () => app.resetBones([bone], 'Reset ' + def.label), html: icon('reset', 14) + 'Reset' }));
    if (def.side) btns.append(h('button.btn', { title: 'Copy this side to the other side', onclick: () => app.mirrorSide(BONES.filter((b) => b.group === def.group).map((b) => b.name)), html: icon('mirror', 14) + 'Mirror' }));
    body.append(btns);

    if (keyed) {
      const key = clip.getKey(bone, 'rot', f);
      const sel = h('select', { onchange: () => {
        app.timeline.selection = new Set([`${bone}|rot|${f}`]);
        app.setSelectedEase(sel.value);
      } }, Object.entries(EASINGS).map(([id, e]) => h('option', { value: id, selected: key.e === id }, e.label)));
      body.append(h('div.section', { style: { marginTop: '14px' } }, h('div.section-title', {}, 'Motion after this key'), sel,
        h('p.hint-text', { style: { marginTop: '6px' } }, '"Smooth" flows through the keys. "Ease in & out" starts and stops gently. "Hold" snaps to the next key.')));
    }
  };

  const refreshSliders = () => {
    if (state.tab !== 'pose' || !app.selectedBone || !sliderEls.length) return;
    const actor = app.activeActor;
    if (!actor) return;
    const s2 = slidersFor(app.selectedBone, actor.bones[app.selectedBone].quaternion);
    sliderEls.forEach((el, i) => {
      if (document.activeElement === el.range || document.activeElement === el.num) return;
      el.range.value = s2[i].value;
      el.num.value = Math.round(s2[i].value);
    });
  };

  // ---------------------------------------------------------------- animation tab
  const renderAnim = () => {
    const scene = app.scene, st = app.stage;
    const nameIn = h('input', { type: 'text', value: scene.name, onchange: () => app.renameScene(nameIn.value.trim()) });
    const kindSel = h('select', { onchange: () => app.structural('Change type', () => { scene.kind = kindSel.value; }) },
      Object.entries(SCENE_KINDS).map(([id, k]) => h('option', { value: id, selected: scene.kind === id }, k.label)));
    body.append(h('div.section', {}, h('div.section-title', {}, 'Animation'),
      h('div.card', {},
        h('div.row', {}, h('label', {}, 'Name'), nameIn),
        h('div.row', {}, h('label', {}, 'Type'), kindSel),
        h('p.hint-text', { style: { margin: '8px 0 0' } }, SCENE_KINDS[scene.kind]?.hint || ''))));

    const secs = h('input.inline-num', { type: 'number', step: 0.1, min: 0.1, value: (st.frames / st.fps).toFixed(2), onchange: () => app.setStageLength(Math.round(+secs.value * st.fps)) });
    const frames = h('input.inline-num', { type: 'number', step: 1, min: 1, value: st.frames, onchange: () => app.setStageLength(+frames.value) });
    const fps = h('select', { onchange: () => app.setFps(+fps.value) }, [24, 30, 60].map((v) => h('option', { value: v, selected: st.fps === v }, `${v} fps`)));
    const loop = h('input', { type: 'checkbox', checked: st.loop, onchange: () => app.setStageProp('loop', loop.checked, loop.checked ? 'Loop on' : 'Loop off') });
    const stName = h('input', { type: 'text', value: st.name, onchange: () => app.structural('Rename stage', () => { st.name = stName.value.trim() || st.name; }) });
    const loopCount = h('input.inline-num', { type: 'number', min: -1, step: 1, value: st.loopCount ?? 1, title: '-1 = loop until stopped', onchange: () => app.structural('Loop count', () => { st.loopCount = +loopCount.value; }) });
    body.append(h('div.section', {}, h('div.section-title', {}, `Stage ${app.stageIdx + 1} of ${scene.stages.length}`),
      h('div.card', {},
        h('div.row', {}, h('label', {}, 'Stage name'), stName),
        h('div.row', {}, h('label', {}, 'Length'), secs, h('span.muted', {}, 'seconds')),
        h('div.row', {}, h('label', {}, 'Frames'), frames),
        h('div.row', {}, h('label', {}, 'Frame rate'), fps),
        h('div.row', {}, h('label', {}, 'Loops'), loop, h('span.muted.small', {}, 'plays seamlessly on repeat')),
        st.loop ? h('div.row', {}, h('label', {}, 'Plays'), loopCount, h('span.muted.small', {}, 'times in-game (-1 = until stopped)')) : null)));

    const speed = h('input.inline-num', { type: 'number', min: 10, max: 400, step: 5, value: 100 });
    body.append(h('div.section', {}, h('div.section-title', {}, 'Tools'),
      h('div.card', {},
        h('div.row', {}, h('label', {}, 'Speed'), speed, h('span.muted', {}, '%'),
          h('button.btn.small', { onclick: () => { const pct = Math.max(10, +speed.value); app.retimeStage(Math.max(1, Math.round(st.frames * 100 / pct))); } }, 'Apply')),
        h('div.btn-row', { style: { marginTop: '10px' } },
          h('button.btn.small', { onclick: () => app.clipOp('Mirror animation', (c) => c.mirror()), html: icon('mirror', 14) + 'Mirror' }),
          h('button.btn.small', { onclick: () => app.clipOp('Reverse', (c) => c.reverse()), html: icon('rotate', 14) + 'Reverse' })),
        h('div.btn-row', { style: { marginTop: '6px' } },
          h('button.btn.small', { title: 'Copies the first pose to the end so the loop has no pop', onclick: () => app.clipOp('Make seamless loop', (c) => c.makeSeamless()), html: icon('loop', 14) + 'Seamless loop' }),
          h('button.btn.small', { title: 'Removes keys that are not needed (great after importing mocap)', onclick: () => app.clipOp('Simplify keys', (c) => c.reduceKeys(0.01)), html: icon('sparkles', 14) + 'Simplify' })),
        h('div.btn-row', { style: { marginTop: '6px' } },
          h('button.btn.small.danger', { onclick: async () => { if (await confirmDialog('Clear all keys?', 'Removes every key of this Zoi in this stage.', { okLabel: 'Clear', danger: true })) app.clipOp('Clear keys', (c) => { c.tracks = {}; c.expr = {}; }); }, html: icon('trash', 14) + 'Clear keys' })),
        h('p.hint-text', { style: { marginTop: '8px' } }, 'Tools apply to the selected Zoi in this stage.'))));

    const tags = h('input', { type: 'text', value: scene.tags.join(', '), placeholder: 'dance, happy, couple', onchange: () => app.structural('Tags', () => { scene.tags = tags.value.split(',').map((t) => t.trim()).filter(Boolean); }) });
    const z = scene.inzoi;
    const posture = h('select', { onchange: () => app.structural('Posture', () => { z.posture = posture.value; }) },
      ['Stand', 'Sit', 'SitOnFloor', 'Lie', 'Kneel', 'Swim'].map((p) => h('option', { value: p, selected: z.posture === p }, p)));
    const rate = h('input.inline-num', { type: 'number', step: 0.05, min: 0.1, max: 4, value: z.rateScale, onchange: () => app.structural('Rate scale', () => { z.rateScale = +rate.value; }) });
    const rows = [
      h('div.row', {}, h('label', {}, 'Menu tags'), tags),
      h('div.row', {}, h('label', {}, 'Posture'), posture),
      h('div.row', {}, h('label', {}, 'Rate scale'), rate, h('span.muted.small', {}, '1 = normal speed')),
    ];
    if (scene.kind === 'statLocomotion') {
      const statId = h('input', { type: 'text', value: z.statId, placeholder: 'e.g. Tired, Drunk', onchange: () => app.structural('Stat', () => { z.statId = statId.value.trim(); }) });
      const statVal = h('input.inline-num', { type: 'number', value: z.statValue, onchange: () => app.structural('Stat value', () => { z.statValue = +statVal.value; }) });
      rows.push(h('div.row', {}, h('label', {}, 'Stat id'), statId), h('div.row', {}, h('label', {}, 'Stat value'), statVal));
    }
    if (scene.kind === 'locomotion') {
      const emo = h('input', { type: 'text', value: z.emotionId, placeholder: 'optional, e.g. Happy', onchange: () => app.structural('Emotion', () => { z.emotionId = emo.value.trim(); }) });
      const chance = h('input.inline-num', { type: 'number', min: 0, step: 0.1, value: z.chanceToPlay, onchange: () => app.structural('Chance', () => { z.chanceToPlay = +chance.value; }) });
      rows.push(h('div.row', {}, h('label', {}, 'Emotion'), emo), h('div.row', {}, h('label', {}, 'Chance'), chance, h('span.muted.small', {}, 'for random idles')));
    }
    body.append(h('div.section', {}, h('div.section-title', {}, 'inZOI settings'),
      h('div.card', {}, ...rows, h('p.hint-text', { style: { marginTop: '8px' } }, 'These are filled into the ModKit setup sheet when you export.'))));
  };

  // ---------------------------------------------------------------- scene tab
  const renderScene = () => {
    const scene = app.scene;
    body.append(h('div.section-title', {}, 'Zois in this scene', h('span.grow'),
      h('button.btn.small', { onclick: () => app.addActor(), html: icon('plus', 14) + 'Add Zoi' })));
    for (const slot of scene.actors) {
      const active = slot.id === app.activeSlotId;
      const rig = app.characters.get(slot.id);
      const name = h('input', { type: 'text', value: slot.name, onchange: () => app.setSlotProp(slot.id, 'name', name.value.trim() || slot.name, 'Rename Zoi') });
      const body_ = h('select', { onchange: () => app.setSlotProp(slot.id, 'bodyType', body_.value, 'Body type') },
        Object.entries(BODY_TYPES).map(([id, b]) => h('option', { value: id, selected: slot.bodyType === id }, b.label)));
      const gender = h('select', { onchange: () => app.setSlotProp(slot.id, 'gender', gender.value, 'Gender') },
        ['Any', 'Female', 'Male'].map((g) => h('option', { value: g, selected: slot.gender === g }, g)));
      const growth = h('select', { onchange: () => app.setSlotProp(slot.id, 'growth', growth.value, 'Life stage') },
        ['Adult', 'Teen', 'Child'].map((g) => h('option', { value: g, selected: slot.growth === g }, g)));
      const num = (key, step, label) => {
        const el = h('input.inline-num', { type: 'number', step, value: +(slot.offset[key] ?? 0).toFixed(3) });
        el.addEventListener('change', () => {
          const old = { ...slot.offset };
          const nv = { ...slot.offset, [key]: +el.value };
          app.history.push({ label, undo: () => { slot.offset = old; app.updateActorPlacement(slot.id); }, redo: () => { slot.offset = nv; app.updateActorPlacement(slot.id); } });
          slot.offset = nv;
          app.updateActorPlacement(slot.id);
        });
        return el;
      };
      body.append(h('div.card', { style: active ? { borderColor: 'var(--accent)' } : {}, onclick: (e) => { if (!active && !e.target.closest('input,select,button')) app.setActiveActor(slot.id); } },
        h('div.row', {}, h('span', { style: { width: '12px', height: '12px', borderRadius: '50%', background: slot.color, flex: 'none' } }), name,
          scene.actors.length > 1 ? h('button.btn.ghost.small.icon-only', { title: 'Remove this Zoi', onclick: () => app.removeActor(slot.id), html: icon('trash', 14) }) : null),
        h('div.row', {}, h('label', {}, 'Body'), body_),
        h('div.row', {}, h('label', {}, 'For'), gender, growth),
        h('div.row', {}, h('label', {}, 'Position'), h('span.muted.small', {}, 'X'), num('x', 0.05, 'Move Zoi'), h('span.muted.small', {}, 'Z'), num('z', 0.05, 'Move Zoi')),
        h('div.row', {}, h('label', {}, 'Facing'), num('yaw', 5, 'Turn Zoi'), h('span.muted.small', {}, '°')),
        h('div.row', {}, h('label', {}, 'Character'),
          h('span.small', { style: { flex: 1, color: rig ? 'var(--text)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: rig ? rig.loaded.name : '' },
            rig ? rig.loaded.name : (slot.look || app.defaultLook) === 'mannequin' || !app.defaultLook ? 'Mannequin' : 'Loading…'),
          h('button.btn.small', { onclick: () => dialogs.characterMenu(app, slot.id) }, 'Change')),
        rig ? h('div.row', {}, h('label', {}, ''), h('label.small', { style: { display: 'flex', gap: '6px', alignItems: 'center', width: 'auto' } },
          h('input', { type: 'checkbox', checked: !!slot.showMannequin, onchange: (e) => { slot.showMannequin = e.target.checked; app.actors.find((a) => a.slotId === slot.id)?.setMannequinVisible(e.target.checked); } }), 'Show posing mannequin')) : null,
      ));
    }
    if (scene.actors.length > 1) body.append(h('p.hint-text', { style: { margin: '6px 2px 0' } }, 'Each Zoi has its own track. Click a Zoi (or press Tab) to edit it; the timeline follows the selected Zoi.'));

    // Props.
    const props = scene.props || [];
    const addSel = h('select', { style: { flex: 1 } }, h('option', { value: '' }, 'Add a reference prop…'), Object.entries(PROP_TYPES).map(([id, p]) => h('option', { value: id }, p.label)));
    addSel.addEventListener('change', () => {
      if (!addSel.value) return;
      const type = addSel.value;
      app.structural('Add prop', () => { (scene.props ||= []).push({ id: uid('prop'), type, x: 0, z: type === 'chair' || type === 'sofa' ? -0.12 : 0.6, yaw: 0 }); });
      app.viewport.setProps(scene.props);
      renderAll();
    });
    body.append(h('div.section', { style: { marginTop: '16px' } }, h('div.section-title', {}, 'Reference props'),
      h('div.row', {}, addSel),
      ...props.map((p) => {
        const n = (key, step) => {
          const el = h('input.inline-num', { type: 'number', step, value: p[key] });
          el.addEventListener('change', () => { p[key] = +el.value; app.viewport.setProps(scene.props); app.markDirty(); });
          return el;
        };
        return h('div.row', {}, h('span', { style: { width: '92px' } }, PROP_TYPES[p.type]?.label || p.type), n('x', 0.05), n('z', 0.05), n('yaw', 15),
          h('button.btn.ghost.small.icon-only', { onclick: () => { app.structural('Remove prop', () => { scene.props = scene.props.filter((x) => x !== p); }); app.viewport.setProps(scene.props); renderAll(); }, html: icon('x', 14) }));
      }),
      props.length ? h('p.hint-text', {}, 'X / Z position in meters and rotation in degrees. Props are only a guide; they are not exported.') : null));

    // Display.
    const toggle = (label, get, set) => h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0', cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked: get(), onchange: (e) => set(e.target.checked) }), label);
    body.append(h('div.section', { style: { marginTop: '16px' } }, h('div.section-title', {}, 'Display'),
      h('div.card', {},
        toggle('Floor grid', () => app.viewport.showGrid, (v) => app.viewport.setGridVisible(v)),
        toggle('See-through skeleton on characters', () => app.viewport.showSkeleton, (v) => { app.viewport.showSkeleton = v; }),
        toggle('Onion skin (ghosts of the previous and next keys) — O', () => app.onion, (v) => { app.onion = v; prefSet('onion', v); app.updateHelpers(); app.emit('toggles'); }),
        toggle('Motion path of the selected part — P', () => app.motionPath, (v) => { app.motionPath = v; prefSet('motionPath', v); app.updateHelpers(); app.emit('toggles'); }),
        toggle('Keep feet planted when moving the hips', () => app.viewport.plantFeet, (v) => { app.viewport.plantFeet = v; }))));
  };

  const render = () => {
    body.innerHTML = '';
    sliderEls = [];
    ({ pose: renderPose, anim: renderAnim, scene: renderScene })[state.tab]();
  };
  const renderAll = () => { renderTabs(); render(); };

  renderAll();
  app.on('selection', () => { if (state.tab !== 'pose' && app.selectedBone) { state.tab = 'pose'; renderTabs(); } render(); });
  app.on('frame', () => { if (state.tab === 'pose') render(); });
  app.on('frame-tick', () => {});
  app.on('pose-live', refreshSliders);
  app.on('clip', () => { if (state.tab === 'pose') render(); });
  app.on('scene', render);
  app.on('stage', () => { if (state.tab === 'anim') render(); });
  app.on('actors', () => { if (state.tab === 'scene') render(); });
  app.on('actor', render);
  app.on('toggles', () => { if (state.tab === 'scene') render(); });
  app.inspector = { render, setTab: (t) => { state.tab = t; renderAll(); } };
}

// ------------------------------------------------------------------ hips position

function hipsPosition(app) {
  const actor = app.activeActor;
  const wrap = h('div', { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--line)' } });
  const rest = actor.rest.hips;
  const p = actor.bones.hips.position;
  const axes = [['y', 'Height', 'lower', 'higher', -1, 0.5], ['z', 'Forward', 'back', 'forward', -1, 1], ['x', 'Sideways', 'right', 'left', -1, 1]];
  for (const [ax, label, neg, pos, min, max] of axes) {
    const v = p[ax] - rest[ax];
    const num = h('input', { type: 'number', step: 0.01, value: v.toFixed(2) });
    const range = h('input', { type: 'range', min, max, step: 0.005, value: v });
    const set = (val, commit) => {
      actor.bones.hips.position[ax] = rest[ax] + val;
      actor.root.updateMatrixWorld(true);
      actor.character?.update(actor);
      app.emit('pose-live');
      if (commit) app.keyBones(['hips'], { label: 'Move hips' });
    };
    range.addEventListener('input', () => { num.value = (+range.value).toFixed(2); set(+range.value, false); });
    range.addEventListener('change', () => set(+range.value, true));
    num.addEventListener('change', () => { range.value = num.value; set(+num.value, true); });
    wrap.append(h('div.ctrl', {}, h('div.ctrl-top', {}, h('span.name', {}, label + ' (m)'), num), range, h('div.ctrl-ends', {}, h('span', {}, neg), h('span', {}, pos))));
  }
  return wrap;
}

export { THREE, promptDialog, toast };
