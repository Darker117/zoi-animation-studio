// Describe a motion: text to motion with the MSFlow AI (ai/server.py), reached through the Studio
// helper at /api/ai/*. The AI returns 22 joint positions per frame (20 fps); they become a normal,
// editable animation on the Zoi rig.
import { jointsToClip } from '../core/fromJoints.js';
import { createScene, syncStageTiming } from '../core/project.js';

/** The AI's state: { ready, state: ready|loading|starting|installing|missing|unavailable|error|offline, message, percent? }. */
export async function aiStatus() {
  try {
    const r = await fetch('/api/ai/status', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* the helper is not running */ }
  return { ok: false, ready: false, state: 'offline', message: 'Studio\'s helper is not running. Open Studio from the Start menu (or "Start Studio.bat").' };
}

/** Starts the AI download and setup (the same one the installer runs). */
export async function startAiSetup() {
  const r = await fetch('/api/ai/setup', { method: 'POST' });
  const res = await r.json().catch(() => null);
  if (!r.ok || !res?.ok) throw new Error(res?.message || 'Could not start the AI download.');
  return res;
}

/** Polls until the AI is ready. onWait(status) runs on every poll. Throws if it fails or is not installed. */
export async function waitForAi(onWait = () => {}, timeoutMs = 15 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    const s = await aiStatus();
    if (s.ready) return s;
    if (['missing', 'unavailable', 'error', 'offline'].includes(s.state)) throw new Error(s.message);
    onWait(s);
    if (Date.now() - t0 > timeoutMs) throw new Error('The AI took too long to start.');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/**
 * Generates a motion from a description and adds it to the pack as a new animation (undoable).
 * onProgress(fraction, label) reports progress.
 */
export async function generateFromText(app, text, seconds, onProgress = () => {}) {
  if (!text) throw new Error('Describe the motion first.');
  onProgress(0.05, 'Waking up the AI');
  await waitForAi((s) => onProgress(0.1, s.message));
  onProgress(0.25, 'Generating the motion');
  const r = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, seconds, seed: Math.floor(Math.random() * 1e6) }),
  });
  const res = await r.json().catch(() => null);
  if (!r.ok || !res?.ok) throw new Error(res?.message || 'The AI could not make that motion.');
  onProgress(0.85, 'Building the animation');

  const name = text.length > 48 ? text.slice(0, 47).trimEnd() + '…' : text;
  const clip = jointsToClip(res.joints, res.fps, app.activeActor, { name, targetFps: app.stage.fps || 30 });
  app.structural('Describe a motion', () => {
    const scene = createScene({ name: name.charAt(0).toUpperCase() + name.slice(1), actors: 1 });
    const st = scene.stages[0];
    st.frames = clip.frames; st.fps = clip.fps; st.loop = false;
    clip.name = scene.name;
    st.clips[scene.actors[0].id] = clip;
    syncStageTiming(st);
    app.project.scenes.push(scene);
    app.sceneIdx = app.project.scenes.length - 1;
    app.stageIdx = 0;
    app.buildActors();
  });
  app.setFrame(0);
  app.timeline.fit();
  onProgress(1, 'Done');
  return clip;
}
