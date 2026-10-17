// Transport bar above the timeline + viewport overlays (actor chips, view tools, hints).
import { h, $, contextMenu } from './dom.js';
import { icon } from './icons.js';
import { prefSet } from '../storage.js';

export function mountTransport(app) {
  const root = $('#transport');
  const b = (name, title, onclick, cls = '') => h('button.btn.ghost.icon-only' + cls, { title, 'aria-label': title, onclick, html: icon(name, 16) });

  const playBtn = h('button.btn.play-btn', { title: 'Play / pause (Space)', 'aria-label': 'Play', onclick: () => app.togglePlay(), html: icon('play', 18) });
  const frameIn = h('input', { type: 'number', min: 0, step: 1, title: 'Current frame', onchange: () => app.setFrame(+frameIn.value) });
  const total = h('span.muted');
  const time = h('span.time');
  const loopBtn = h('button.btn.small.toggle', { title: 'Loop playback in the studio', onclick: () => { app.loopPlayback = !app.loopPlayback; render(); }, html: icon('loop', 15) });
  const stagesBtn = h('button.btn.small.toggle', { title: 'Play all stages in order (preview the whole scene)', onclick: () => { app.playAllStages = !app.playAllStages; render(); }, html: icon('layers', 15) + '<span>All stages</span>' });
  const speedBtn = h('button.btn.small', { title: 'Playback speed', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.top - 190, [0.25, 0.5, 1, 1.5, 2].map((s) => ({ label: `${s}×`, icon: app.speed === s ? 'check' : null, onClick: () => { app.speed = s; render(); } })));
  } });
  const autoKey = h('button.btn.small.rec', { title: 'Auto-key: every pose change is saved as a key on the current frame', onclick: () => { app.autoKey = !app.autoKey; prefSet('autoKey', app.autoKey); render(); } },
    h('span.rec-dot'), h('span', {}, 'Auto-key'));
  const keyBtn = h('button.btn.small', { title: 'Key the whole pose on this frame (Shift+K)', onclick: () => app.keyBones(null, { label: 'Key whole pose' }), html: icon('key', 14) + '<span>Key pose</span>' });
  const dirty = h('span.badge.warn', { style: { display: 'none' }, title: 'You changed the pose but it is not keyed yet' }, 'Unkeyed changes');
  const onionBtn = h('button.btn.small.toggle', { title: 'Onion skin: ghosts of the previous/next key (O)', onclick: () => { app.onion = !app.onion; prefSet('onion', app.onion); app.updateHelpers(); render(); }, html: icon('ghost', 15) });
  const pathBtn = h('button.btn.small.toggle', { title: 'Motion path of the selected part (P)', onclick: () => { app.motionPath = !app.motionPath; prefSet('motionPath', app.motionPath); app.updateHelpers(); render(); }, html: icon('route', 15) });
  const fitBtn = b('focus', 'Fit timeline', () => app.timeline.fit());

  root.append(
    b('first', 'First frame (Home)', () => app.setFrame(0)),
    b('prevKey', 'Previous key (↓)', () => app.jumpKey(-1)),
    playBtn,
    b('nextKey', 'Next key (↑)', () => app.jumpKey(1)),
    b('last', 'Last frame (End)', () => app.setFrame(app.stage.frames)),
    h('div.frame-box', {}, frameIn, total, time),
    h('div.tb-sep'),
    loopBtn, stagesBtn, speedBtn,
    h('div.tb-sep'),
    autoKey, keyBtn, dirty,
    h('div.tb-spacer'),
    onionBtn, pathBtn, fitBtn,
  );

  const render = () => {
    playBtn.innerHTML = icon(app.playing ? 'pause' : 'play', 18);
    if (document.activeElement !== frameIn) frameIn.value = Math.round(app.frame);
    frameIn.max = app.stage.frames;
    total.textContent = `/ ${app.stage.frames}`;
    time.textContent = `${(app.frame / app.stage.fps).toFixed(2)} s`;
    loopBtn.classList.toggle('on', app.loopPlayback);
    stagesBtn.classList.toggle('on', app.playAllStages);
    stagesBtn.style.display = app.scene.stages.length > 1 ? '' : 'none';
    speedBtn.innerHTML = icon('gauge', 15) + `<span>${app.speed}×</span>`;
    autoKey.classList.toggle('on', app.autoKey);
    dirty.style.display = app.poseDirty ? '' : 'none';
    onionBtn.classList.toggle('on', app.onion);
    pathBtn.classList.toggle('on', app.motionPath);
  };
  render();
  for (const ev of ['frame', 'frame-tick', 'play', 'stage', 'scene', 'toggles']) app.on(ev, render);

  mountOverlays(app);
}

function mountOverlays(app) {
  // Actor chips (top-left).
  const chips = $('#actorChips');
  const renderChips = () => {
    chips.innerHTML = '';
    if (app.actors.length < 2) return;
    for (const a of app.actors) {
      const slot = a.slot;
      chips.append(h('button.actor-chip' + (a.slotId === app.activeSlotId ? '.active' : ''), {
        title: `Edit ${slot.name} (Tab cycles)`, onclick: () => app.setActiveActor(a.slotId),
      }, h('span.av', { style: { background: slot.color } }, slot.name.replace('Zoi ', '').slice(0, 2)), slot.name));
    }
  };
  renderChips();
  app.on('actors', renderChips);
  app.on('actor', renderChips);
  app.on('scene', renderChips);

  // View tools (top-right).
  const tools = $('#viewTools');
  const rot = h('button.btn.small', { title: 'Rotate tool (E or R)', onclick: () => { app.viewport.setMode('rotate'); renderTools(); }, html: icon('rotate', 15) });
  const mov = h('button.btn.small', { title: 'Move tool (W or G): move hands/feet with IK, move the hips', onclick: () => { app.viewport.setMode('move'); renderTools(); }, html: icon('move', 15) });
  const view = (name, label, title) => h('button.btn.small', { title, onclick: () => app.viewport.viewPreset(name) }, label);
  tools.append(
    h('div.vp-toolbar', {}, rot, mov),
    h('div.vp-toolbar', {}, view('front', 'Front', 'Front view (1)'), view('left', 'Side', 'Side view (3)'), view('three', '3/4', 'Three-quarter view (5)'), view('top', 'Top', 'Top view (7)'),
      h('button.btn.small', { title: 'Focus on selection (F)', onclick: () => app.viewport.focusBone(app.selectedBone), html: icon('focus', 15) })),
  );
  const renderTools = () => {
    rot.classList.toggle('on', app.viewport.mode === 'rotate');
    mov.classList.toggle('on', app.viewport.mode === 'move');
  };
  renderTools();
  app.on('tool', renderTools);

  // Hint (bottom-left).
  const hint = $('#hint');
  const def = 'Click a body part to select it · drag it to pose · <kbd>Space</kbd> play · <kbd>K</kbd> key · right-drag pans · wheel zooms';
  const setHint = (html) => { hint.innerHTML = `<div class="hint-box">${html || def}</div>`; };
  setHint(null);
  app.on('hint', setHint);

  // Status (bottom-right).
  const status = $('#vpStatus');
  const renderStatus = () => {
    const live = app.vmc.active ? ` · live ${app.vmc.sent} pkts${app.vmc.lastError ? ' (error)' : ''}` : '';
    status.innerHTML = `<span class="vp-status">${app.scene.name} · ${app.stage.name}${live}</span>`;
  };
  renderStatus();
  for (const ev of ['scene', 'stage', 'live']) app.on(ev, renderStatus);
}
