// Renders the screenshots used by the guides in docs/ (docs/images/*.png).
//
//   1. Start the studio from this folder:  Start Studio.bat   (serves http://localhost:47820/)
//   2. node tools/docs/screens.mjs [studio-url]
//
// Uses a hidden Microsoft Edge window at 1600x1000 with a fresh profile, so your own studio data is
// never touched. Each shot sets the studio up the way a user would (poses, keys, dialogs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'docs', 'images');
const URL = process.argv[2] || 'http://localhost:47820/';
fs.mkdirSync(OUT, { recursive: true });

const page = await launch({ width: 1600, height: 1000 });
const out = (name) => path.join(OUT, name);
const settle = (ms = 400) => sleep(ms);
const closeOverlays = () => page.run(`
  document.querySelectorAll('#modalRoot > *').forEach((n) => n.remove());
  document.getElementById('menuRoot').innerHTML = '';
  document.querySelectorAll('.color-pop, .tour, .tour-spot, .zdoc-callouts').forEach((n) => n.remove());
`);

try {
  await page.goto(URL);
  await page.run(`
    for (let i = 0; i < 300; i++) { if (window.zms && zms.actors[0] && zms.actors[0].character) break; await new Promise((r) => setTimeout(r, 100)); }
    if (!zms.actors[0].character) throw new Error('figure did not load');
  `);
  await settle(1200);

  // ---------------------------------------------------------------- first launch
  await page.shot(out('welcome.png'), '.modal', 0);
  await closeOverlays();

  // ---------------------------------------------------------------- a short wave animation
  await page.run(`
    const P = await import('./js/core/params.js');
    const app = zms, a = app.activeActor;
    const pose = (labels) => {
      for (const b of Object.keys(a.bones)) a.bones[b].quaternion.identity();
      for (const [bone, l] of Object.entries(labels)) { const q = P.quatFromLabels(bone, l); a.bones[bone].quaternion.set(q[0], q[1], q[2], q[3]); }
      a.root.updateMatrixWorld(true);
    };
    const base = {
      leftUpperArm: { Raise: -76, Swing: 4 }, rightUpperArm: { Raise: -76, Swing: 4 },
      leftLowerArm: { 'Bend elbow': 12 }, rightLowerArm: { 'Bend elbow': 12 },
      spine: { Bend: 2 }, head: { Nod: 3 },
    };
    const wave = (side) => ({ ...base,
      rightUpperArm: { Raise: 62, Swing: 18 }, rightLowerArm: { 'Bend elbow': 92 },
      rightHand: { 'Side bend': side }, head: { Tilt: -6, Nod: -2 }, spine: { Lean: 3 } });
    app.setStageLength(48);
    const keys = [[0, base], [12, wave(-22)], [20, wave(22)], [28, wave(-22)], [36, wave(22)], [48, base]];
    for (const [f, p] of keys) { app.setFrame(f); pose(p); app.keyBones(null, { label: 'Key pose' }); }
    app.scene.name = 'Wave hello';
    app.setFrame(16);
    app.select('rightLowerArm');
    app.emit('project');
  `);
  await settle(1000);

  // ---------------------------------------------------------------- overview with numbered areas
  await page.run(`
    const layer = document.createElement('div');
    layer.className = 'zdoc-callouts';
    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 999 });
    const areas = [['#topbar', 1], ['#library', 2], ['#viewportWrap', 3], ['#inspector', 4], ['#transport', 5], ['#timelineHost', 6]];
    for (const [sel, n] of areas) {
      const r = document.querySelector(sel).getBoundingClientRect();
      const box = document.createElement('div');
      Object.assign(box.style, { position: 'absolute', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
        border: '2px solid #3cdac1', borderRadius: '9px', boxSizing: 'border-box' });
      const tag = document.createElement('div');
      tag.textContent = n;
      Object.assign(tag.style, { position: 'absolute', left: (r.left + 8) + 'px', top: (r.top + 8) + 'px', width: '26px', height: '26px',
        borderRadius: '13px', background: '#3cdac1', color: '#111215', font: '700 14px/26px Segoe UI, sans-serif', textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,.5)' });
      if (sel === '#topbar') { tag.style.left = (r.left + r.width / 2) + 'px'; tag.style.top = (r.top + 11) + 'px'; }
      layer.append(box, tag);
    }
    document.body.append(layer);
  `);
  await page.shot(out('overview.png'));
  await closeOverlays();

  // ---------------------------------------------------------------- panels close up
  await page.shot(out('topbar.png'), '#topbar');
  await page.shot(out('viewport-selected.png'), '#viewportWrap');
  await page.run(`zms.inspector.setTab('pose');`); await settle();
  await page.shot(out('inspector-pose.png'), '#inspector');
  await page.run(`zms.inspector.setTab('anim');`); await settle();
  await page.shot(out('inspector-animation.png'), '#inspector');
  await page.run(`zms.inspector.setTab('scene');`); await settle();
  await page.shot(out('inspector-scene.png'), '#inspector');
  await page.run(`zms.inspector.setTab('pose');`); await settle();
  await page.run(`zms.timeline.expanded.add('armR'); zms.timeline.dirty = true;`); await settle();
  await page.shot(out('timeline.png'), '#timelineWrap');
  await page.shot(out('transport.png'), '#transport');
  await page.run(`zms.timeline.expanded.delete('armR'); zms.timeline.dirty = true;`);

  // Library tabs (with one saved pose).
  await page.run(`
    const S = await import('./js/storage.js');
    const a = zms.activeActor, p = a.capturePose();
    const rel = { rot: p.rot, hips: [p.pos.hips[0] - a.rest.hips.x, p.pos.hips[1] - a.rest.hips.y, p.pos.hips[2] - a.rest.hips.z] };
    S.prefSet('userPoses', [{ id: 'pose_doc1', label: 'Wave hello', pose: rel }]);
    zms.library.setTab('poses');
  `);
  await settle(2500);
  await page.shot(out('library-poses.png'), '#library');
  for (const tab of ['motions', 'face', 'pack']) {
    await page.run(`zms.library.setTab(arg);`, tab); await settle();
    await page.shot(out(`library-${tab}.png`), '#library');
  }
  await page.run(`zms.library.setTab('poses');`);

  // Menus.
  const menuShot = async (name, js) => { await page.run(js); await settle(); await page.shot(out(name), '#menuRoot .menu', 6); await closeOverlays(); };
  await menuShot('menu-bone.png', `const r = document.getElementById('viewport').getBoundingClientRect(); zms.showBoneMenu(r.left + r.width / 2, r.top + 140, 'rightUpperArm');`);
  await menuShot('menu-key.png', `const r = document.getElementById('timeline').getBoundingClientRect(); zms.timeline.selection = new Set(['rightLowerArm|rot|12']); zms.showKeyMenu(r.left + 500, r.top + 60, 12);`);
  await menuShot('menu-timeline.png', `const r = document.getElementById('timeline').getBoundingClientRect(); const row = zms.timeline._rows.find((x) => x.id === 'armR'); zms.showTimelineMenu(r.left + 700, r.top + 60, 30, row);`);
  await menuShot('menu-file.png', `[...document.querySelectorAll('#topbar button')].find((b) => b.textContent.trim().startsWith('File')).click();`);
  await menuShot('menu-animation.png', `const b = [...document.querySelectorAll('#topbar button')].find((x) => x.title && /animation/i.test(x.title) && x.textContent.trim() === ''); (b || document.querySelectorAll('#topbar button')[3]).click();`);

  // Track colour picker.
  await page.run(`
    const c = document.getElementById('timeline').getBoundingClientRect();
    const rows = zms.timeline._rows; const i = rows.findIndex((x) => x.id === 'armR');
    zms.timeline._pickColor(rows[i], c.left + 14, c.top + 26 + i * 22 + 11 - zms.timeline.scrollY);
  `);
  await settle(600);
  await page.shot(out('track-colour.png'), '.color-pop', 8);
  await closeOverlays();

  // Dialogs.
  const dialogShot = async (name, js, wait = 700) => { await page.run(js); await settle(wait); await page.shot(out(name), '#modalRoot .modal', 0); await closeOverlays(); };
  await dialogShot('dialog-shortcuts.png', `(await import('./js/ui/dialogs.js')).shortcuts();`);
  await dialogShot('dialog-export.png', `(await import('./js/ui/dialogs.js')).exportDialog(zms);`);
  await dialogShot('dialog-live.png', `(await import('./js/ui/dialogs.js')).liveDialog(zms);`);
  await dialogShot('dialog-pack-settings.png', `(await import('./js/ui/dialogs.js')).packSettings(zms);`);
  // Describe a motion: the "not downloaded yet" state (the page is told the AI is missing), then the
  // real AI once it is ready.
  await dialogShot('dialog-ai-download.png', `
    const real = window.fetch;
    window.fetch = (url, opts) => String(url).includes('/api/ai/status')
      ? Promise.resolve(new Response(JSON.stringify({ ok: true, ready: false, state: 'missing', installed: false, message: 'The AI model is not downloaded yet.' }), { status: 200 }))
      : real(url, opts);
    await (await import('./js/ui/dialogs.js')).textToMotion(zms);
    window.fetch = real;
  `, 900);
  const aiReady = await page.run(`
    for (let i = 0; i < 120; i++) {
      const s = await (await fetch('/api/ai/status', { cache: 'no-store' })).json();
      if (s.ready) return true;
      if (['missing', 'unavailable', 'error'].includes(s.state)) return false;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  `);
  if (!aiReady) console.log('The AI is not available here: skipping the Describe a motion result shots.');
  await dialogShot('dialog-text-to-motion.png', `
    await (await import('./js/ui/dialogs.js')).textToMotion(zms);
    document.querySelector('#modalRoot textarea').value = 'a person waves with the right hand, then bows';
    document.querySelector('#modalRoot input.inline-num').value = 5;
  `, 900);
  if (aiReady) {
    await page.run(`
      const ai = await import('./js/ai/text2motion.js');
      await ai.generateFromText(zms, 'a person waves with the right hand, then bows', 5);
      zms.setFrame(22);
      zms.select('rightUpperArm');
      zms.library.setTab('pack');
    `);
    await settle(1500);
    await page.shot(out('ai-result.png'));
    // Back to the wave animation for the remaining shots.
    await page.run(`zms.setScene(0); zms.library.setTab('poses');`);
    await settle(800);
  }
  await dialogShot('dialog-character.png', `(await import('./js/ui/dialogs.js')).characterMenu(zms, zms.activeSlot.id);`, 1200);
  await dialogShot('dialog-capture.png', `(await import('./js/ui/captureDialog.js')).captureDialog(zms);`, 2500);
  await dialogShot('dialog-inzoi-guide.png', `(await import('./js/ui/dialogs.js')).inzoiGuide();`);

  // Import dialog with a real Mixamo walk from the test fixtures.
  const fbx = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'walk_mixamo.fbx')).toString('base64');
  await dialogShot('dialog-import.png', `
    const bytes = Uint8Array.from(atob(arg), (c) => c.charCodeAt(0));
    (await import('./js/ui/dialogs.js')).importFile(zms, new File([bytes], 'walk_mixamo.fbx'));
    await new Promise((r) => setTimeout(r, 2500));
  `.replace('arg', JSON.stringify(fbx)), 500);

  // Guided tour, first step.
  await page.run(`zms.startTour();`); await settle(800);
  await page.shot(out('tour.png'));
  await closeOverlays();

  // Two Zois in one animation.
  await page.run(`zms.addActor();`);
  await settle(2500);
  await page.run(`zms.inspector.setTab('scene');`); await settle(600);
  await page.shot(out('two-zois.png'), { x: 300, y: 56, width: 1300, height: 680 });

  const errs = page.consoleErrors.filter(Boolean);
  if (errs.length) console.log('Page errors:\n' + errs.join('\n'));
  console.log('Saved to ' + OUT);
} finally {
  await page.close();
}
