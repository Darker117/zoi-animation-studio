// Top bar: pack/animation picker, stages, undo/redo, live link, import/export.
import { h, $, iconBtn, contextMenu, promptDialog } from './dom.js';
import { icon } from './icons.js';
import * as dialogs from './dialogs.js';

export function mountTopbar(app) {
  const root = $('#topbar');

  const sceneSelect = h('select', { title: 'Animation in this pack', onchange: () => app.setScene(+sceneSelect.value) });
  const stageTabs = h('div.stage-tabs');
  const undoBtn = iconBtn('undo', 'Undo (Ctrl+Z)', () => app.undo(), 'ghost');
  const redoBtn = iconBtn('redo', 'Redo (Ctrl+Y)', () => app.redo(), 'ghost');
  const livePill = h('button.live-pill', { title: 'Stream the studio to your Zoi in inZOI', onclick: () => dialogs.liveDialog(app) },
    h('span.dot'), h('span.live-label', {}, 'Live in inZOI'));

  const fileMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 4, [
      { label: 'New pack', icon: 'newFile', onClick: () => app.newProject() },
      { label: 'Open project…', icon: 'open', shortcut: 'Ctrl+O', onClick: () => app.openProject() },
      { label: 'Save project', icon: 'save', shortcut: 'Ctrl+S', onClick: () => app.saveProject() },
      '-',
      { label: 'Import animation or character…', icon: 'upload', shortcut: 'Ctrl+I', onClick: () => dialogs.importPicker(app) },
      { label: 'Load the inZOI body', icon: 'user', onClick: () => dialogs.loadInzoiBody(app) },
      '-',
      { label: 'Pack settings…', icon: 'package', onClick: () => dialogs.packSettings(app) },
      { label: 'Export…', icon: 'download', shortcut: 'Ctrl+E', onClick: () => dialogs.exportDialog(app) },
    ]);
  };

  const sceneMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 4, [
      { label: 'New animation', icon: 'plus', onClick: () => app.newScene() },
      '-',
      { label: 'Rename…', icon: 'text', onClick: async () => { const n = await promptDialog('Rename animation', 'Name shown in the pack and the in-game menu', app.scene.name); if (n) app.renameScene(n); } },
      { label: 'Duplicate', icon: 'copy', onClick: () => app.duplicateScene() },
      { label: 'Delete', icon: 'trash', onClick: () => app.deleteScene() },
    ]);
  };

  root.append(
    h('div.brand', { title: 'Studio' },
      h('img.brand-mark', { src: 'assets/logo-mark.png', alt: '' }),
      h('img.brand-word', { src: 'assets/wordmark.png', alt: 'Studio' })),
    h('button.btn.ghost.small', { onclick: fileMenu, title: 'File' }, 'File', h('span', { html: icon('chevronDown', 14) })),
    h('div.tb-sep'),
    h('div.scene-picker', {}, h('span', { html: icon('film', 16), style: { color: 'var(--muted)' } }), sceneSelect,
      h('button.btn.ghost.small.icon-only', { title: 'Animation options', onclick: sceneMenu, html: icon('more', 16) })),
    h('div.tb-sep'),
    stageTabs,
    h('div.tb-spacer'),
    h('div.tb-group', {}, undoBtn, redoBtn),
    h('div.tb-sep'),
    livePill,
    h('button.btn', { onclick: () => dialogs.importPicker(app), title: 'Import animation or character (Ctrl+I)', html: icon('upload') + '<span>Import</span>' }),
    h('button.btn.primary', { onclick: () => dialogs.exportDialog(app), title: 'Export for inZOI (Ctrl+E)', html: icon('package') + '<span>Export</span>' }),
    iconBtn('help', 'Help & shortcuts', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      contextMenu(r.right - 220, r.bottom + 4, [
        { label: 'Quick tour', icon: 'sparkles', onClick: () => app.startTour() },
        { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', onClick: () => dialogs.shortcuts() },
        { label: 'How to get it into inZOI', icon: 'gamepad', onClick: () => dialogs.inzoiGuide(app) },
        { label: 'Start screen', icon: 'film', onClick: () => dialogs.welcome(app) },
      ]);
    }, 'ghost'),
  );

  const renderScenes = () => {
    sceneSelect.innerHTML = '';
    app.project.scenes.forEach((s, i) => {
      const n = s.actors.length;
      sceneSelect.append(h('option', { value: i, selected: i === app.sceneIdx }, `${s.name}${n > 1 ? `  (${n} Zois)` : ''}`));
    });
  };

  const renderStages = () => {
    stageTabs.innerHTML = '';
    const stages = app.scene.stages;
    stages.forEach((st, i) => {
      const tab = h('button.stage-tab' + (i === app.stageIdx ? '.active' : ''), {
        title: `${st.name} · ${(st.frames / st.fps).toFixed(1)}s${st.loop ? ' · loops' : ''}`,
        onclick: () => app.setStage(i),
        oncontextmenu: (e) => {
          e.preventDefault();
          app.setStage(i);
          contextMenu(e.clientX, e.clientY, [
            { label: st.name, header: true },
            { label: 'Rename…', icon: 'text', onClick: async () => { const n = await promptDialog('Rename stage', 'Stage name', st.name); if (n) app.structural('Rename stage', () => { st.name = n; }); } },
            { label: 'Duplicate stage', icon: 'copy', onClick: () => app.addStage({ copy: true }) },
            { label: 'Move left', icon: 'prevKey', disabled: i === 0, onClick: () => app.moveStage(i, -1) },
            { label: 'Move right', icon: 'nextKey', disabled: i === stages.length - 1, onClick: () => app.moveStage(i, 1) },
            '-',
            { label: 'Delete stage', icon: 'trash', disabled: stages.length < 2, onClick: () => app.deleteStage(i) },
          ]);
        },
      }, stages.length > 1 ? h('span.num', {}, String(i + 1)) : null, st.name, st.loop ? h('span', { html: icon('loop', 12), style: { color: 'var(--muted)' } }) : null);
      stageTabs.append(tab);
    });
    stageTabs.append(h('button.btn.ghost.small.icon-only', { title: 'Add a stage (multi-part animations: intro → loop → outro)', onclick: () => app.addStage(), html: icon('plus', 15) }));
  };

  const renderHistory = () => {
    undoBtn.disabled = !app.history.canUndo;
    redoBtn.disabled = !app.history.canRedo;
    undoBtn.title = app.history.canUndo ? `Undo ${app.history.peekUndo()} (Ctrl+Z)` : 'Nothing to undo';
    redoBtn.title = app.history.canRedo ? `Redo ${app.history.peekRedo()} (Ctrl+Y)` : 'Nothing to redo';
  };

  const renderLive = () => {
    const on = app.vmc.active;
    livePill.classList.toggle('on', on && !app.vmc.lastError);
    livePill.classList.toggle('err', on && !!app.vmc.lastError);
    livePill.querySelector('.live-label').textContent = on ? (app.vmc.lastError ? 'Live: no bridge' : 'Live: streaming') : 'Live in inZOI';
  };

  renderScenes(); renderStages(); renderHistory(); renderLive();
  app.on('scene', () => { renderScenes(); renderStages(); });
  app.on('project', () => { renderScenes(); renderStages(); });
  app.on('stage', renderStages);
  app.on('history', renderHistory);
  app.on('live', renderLive);
}
