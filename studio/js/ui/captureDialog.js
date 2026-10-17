// "Act it out": record a motion with the webcam or from a video file.
import { h, modal, toast, pickFile } from './dom.js';
import { icon } from './icons.js';
import { prefGet, prefSet } from '../storage.js';
import { createScene, syncStageTiming } from '../core/project.js';
import { jointsToPoses } from '../core/fromJoints.js';

const BONES_2D = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32], [7, 8]];

export async function captureDialog(app) {
  const cap = await import('../capture/videoCapture.js');
  let stream = null, raf = 0, samples = [], recording = false, recStart = 0, lastClipSamples = null, lastFps = 30;
  const before = app.activeActor.capturePose();

  const video = h('video', { autoplay: true, muted: true, playsInline: true, style: { width: '100%', borderRadius: '10px', background: '#000', transform: 'scaleX(-1)', display: 'block' } });
  const overlay = h('canvas', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%', transform: 'scaleX(-1)', pointerEvents: 'none' } });
  const stage = h('div', { style: { position: 'relative', minHeight: '220px', background: 'radial-gradient(#1b2033,#0f121a)', borderRadius: '10px', display: 'grid', placeItems: 'center' } },
    h('div.muted', { style: { position: 'absolute' } }, 'Camera preview appears here'), video, overlay);
  const status = h('div.hint-text', { style: { margin: '8px 0' } }, 'Stand back so your whole body (feet included) is in the picture, with good light.');
  const bigCount = h('div', { style: { position: 'absolute', fontSize: '72px', fontWeight: 800, color: '#fff', textShadow: '0 4px 24px #000', display: 'none' } });
  stage.append(bigCount);
  const secs = h('input.inline-num', { type: 'number', min: 2, max: 30, step: 1, value: prefGet('cap.secs', 6) });
  const quality = h('select', {}, h('option', { value: 'full' }, 'Fast'), h('option', { value: 'heavy', selected: prefGet('cap.quality', 'full') === 'heavy' }, 'Accurate (slower)'));
  const mirror = h('input', { type: 'checkbox', checked: prefGet('cap.mirror', false) });
  const smoothSel = h('select', {}, [['0', 'None'], ['1', 'Light'], ['2', 'Medium'], ['4', 'Strong']].map(([v, l]) => h('option', { value: v, selected: v === String(prefGet('cap.smooth', 2)) }, l)));
  const bar = h('div.progress', { style: { marginTop: '8px', display: 'none' } }, h('div'));
  const useBtn = h('button.btn.primary', { disabled: true, onclick: () => useRecording() }, 'Use recording');
  const camBtn = h('button.btn', { onclick: () => startCamera(), html: icon('video', 15) + 'Start camera' });
  const recBtn = h('button.btn.rec', { disabled: true, onclick: () => startRecording() }, h('span.rec-dot'), h('span', {}, 'Record'));
  const fileBtn = h('button.btn', { onclick: () => fromVideo(), html: icon('film', 15) + 'Use a video file…' });

  const drawOverlay = (lms) => {
    const r = video.getBoundingClientRect();
    overlay.width = r.width; overlay.height = r.height;
    const g = overlay.getContext('2d');
    g.clearRect(0, 0, overlay.width, overlay.height);
    if (!lms) return;
    g.strokeStyle = '#7c8cff'; g.lineWidth = 3; g.fillStyle = '#ffcb57';
    for (const [a, b] of BONES_2D) { g.beginPath(); g.moveTo(lms[a].x * r.width, lms[a].y * r.height); g.lineTo(lms[b].x * r.width, lms[b].y * r.height); g.stroke(); }
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) { g.beginPath(); g.arc(lms[i].x * r.width, lms[i].y * r.height, 4, 0, Math.PI * 2); g.fill(); }
  };

  const livePose = (world) => {
    try {
      const J = cap.MEDIAPIPE_LAYOUT;
      const tmp = cap.recordingToClip([world, world], 30, app.activeActor, { mirror: mirror.checked, smoothing: 0, simplify: 0 });
      app.activeActor.applyPose(tmp.samplePose(0));
      void J; void jointsToPoses;
    } catch { /* person not fully visible */ }
  };

  async function startCamera() {
    try {
      status.textContent = 'Loading the pose tracker (first time takes a few seconds)…';
      const lm = await cap.loadLandmarker(quality.value, 'VIDEO');
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      video.srcObject = stream;
      await video.play();
      recBtn.disabled = false;
      camBtn.disabled = true;
      status.textContent = 'Tracking. Your Zoi copies you live' + (app.vmc.active ? ' (and so does your Zoi in inZOI).' : '.') + ' Press Record when ready.';
      let lastT = -1;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        if (video.readyState < 2) return;
        const t = Math.round(performance.now());
        if (t === lastT) return;
        lastT = t;
        const r = lm.detectForVideo(video, t);
        const world = r.worldLandmarks?.[0] || null;
        drawOverlay(r.landmarks?.[0]);
        if (world) livePose(world);
        if (recording) {
          const el = (performance.now() - recStart) / 1000;
          // Resample to a steady 30 fps.
          while (samples.length <= el * 30) samples.push(world);
          status.textContent = `Recording… ${el.toFixed(1)} s`;
          if (el >= +secs.value) stopRecording();
        }
      };
      loop();
    } catch (e) {
      status.textContent = 'Could not start the camera: ' + (e.message || e);
    }
  }

  function startRecording() {
    prefSet('cap.secs', +secs.value);
    let n = 3;
    recBtn.disabled = true;
    bigCount.style.display = 'block';
    bigCount.textContent = n;
    const tick = setInterval(() => {
      n--;
      if (n > 0) { bigCount.textContent = n; return; }
      clearInterval(tick);
      bigCount.style.display = 'none';
      samples = [];
      recording = true;
      recStart = performance.now();
    }, 1000);
  }

  function stopRecording() {
    recording = false;
    recBtn.disabled = false;
    lastClipSamples = samples.slice();
    lastFps = 30;
    const found = lastClipSamples.filter(Boolean).length;
    status.textContent = `Recorded ${(lastClipSamples.length / 30).toFixed(1)} s (${Math.round((found / Math.max(1, lastClipSamples.length)) * 100)}% of frames tracked). Use it, or record again.`;
    useBtn.disabled = found < 2;
  }

  async function fromVideo() {
    const file = await pickFile('video/*');
    if (!file) return;
    bar.style.display = '';
    status.textContent = `Reading ${file.name}…`;
    try {
      const res = await cap.processVideoFile(file, { fps: 30, quality: quality.value, onProgress: (p) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; } });
      lastClipSamples = res.samples;
      lastFps = res.fps;
      const found = res.samples.filter(Boolean).length;
      status.textContent = `Processed ${(res.samples.length / res.fps).toFixed(1)} s of video (${Math.round((found / res.samples.length) * 100)}% of frames had a person).`;
      useBtn.disabled = found < 2;
      app._captureName = file.name.replace(/\.[^.]+$/, '');
    } catch (e) {
      status.textContent = e.message || String(e);
    }
  }

  function useRecording() {
    prefSet('cap.mirror', mirror.checked); prefSet('cap.smooth', +smoothSel.value); prefSet('cap.quality', quality.value);
    try {
      app.activeActor.applyPose(before);
      const clip = cap.recordingToClip(lastClipSamples, lastFps, app.activeActor, { mirror: mirror.checked, smoothing: +smoothSel.value, name: app._captureName || 'Captured motion' });
      app.structural('Captured motion', () => {
        const scene = createScene({ name: clip.name, actors: 1 });
        const st = scene.stages[0];
        st.frames = clip.frames; st.fps = clip.fps; st.loop = false;
        st.clips[scene.actors[0].id] = clip;
        syncStageTiming(st);
        app.project.scenes.push(scene);
        app.sceneIdx = app.project.scenes.length - 1;
        app.stageIdx = 0;
        app.buildActors();
      });
      app.setFrame(0);
      app.timeline.fit();
      toast(`Added "${clip.name}" (${(clip.frames / clip.fps).toFixed(1)} s). Clean it up like any animation.`, { type: 'ok', timeout: 5000 });
      m.close(true);
    } catch (e) { toast(e.message, { type: 'err', timeout: 6000 }); }
  }

  const m = modal({
    title: 'Act it out', wide: true,
    content: h('div', {},
      h('p.hint-text', { style: { marginTop: 0 } }, 'Perform the motion in front of your webcam, or use any video of a person (a dance, a sport move…). It becomes a normal animation you can edit and export. Hands are tracked as wrist direction only; the face is not captured.'),
      stage, status, bar,
      h('div.row', { style: { marginTop: '6px' } }, camBtn, recBtn, h('span.muted', {}, 'for'), secs, h('span.muted', {}, 'seconds'), h('span.grow'), fileBtn),
      h('div.row', {}, h('label', {}, 'Tracker'), quality, h('label', { style: { width: 'auto', marginLeft: '12px' } }, 'Smoothing'), smoothSel),
      h('div.row', {}, h('label', {}, 'Mirror'), mirror, h('span.muted.small', {}, 'Zoi moves like your reflection (your right hand → its left hand)'))),
    buttons: [{ label: 'Close' }],
    footLeft: useBtn,
    onClose: (used) => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      if (!used) { app.activeActor.applyPose(before); app.applyFrame(); }
    },
  });
}
