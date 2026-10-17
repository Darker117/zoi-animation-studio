// Project = an animation pack. A pack contains scenes; a scene has actor slots (Zoi A, Zoi B…)
// placed relative to each other, and a sequence of stages. Every stage holds one clip per actor.
// A plain single-character animation is simply a scene with one actor and one stage.
import { Clip } from './clip.js';
import { uid } from './math.js';

export const SCENE_KINDS = {
  interaction: { label: 'Interaction / action', hint: 'Plays when triggered (wave, dance, hug…). Built as an Animation Montage in the ModKit.' },
  pose: { label: 'Pose (held)', hint: 'A still or gently looping pose for photos and idles.' },
  locomotion: { label: 'Walk / idle style', hint: 'Replaces the default idle or walk (ModKit "Locomotion").' },
  statLocomotion: { label: 'Mood walk / idle', hint: 'Walk/idle used when a stat or mood is active, e.g. tired or drunk (ModKit "Stat Locomotion").' },
};

export const ACTOR_COLORS = ['#7c8cff', '#ff7cab', '#4cc9a0', '#f5a54a', '#b388ff', '#5ec2f0'];

export function newClip(stage, name) {
  return new Clip({ name, fps: stage.fps, frames: stage.frames, loop: stage.loop });
}

export function createStage({ name = 'Stage 1', frames = 60, fps = 30, loop = false } = {}) {
  return { id: uid('stage'), name, frames, fps, loop, loopCount: 1, clips: {} };
}

export function createScene({ name = 'New animation', actors = 1, kind = 'interaction' } = {}) {
  const scene = {
    id: uid('scene'),
    name,
    kind,
    tags: [],
    description: '',
    inzoi: { posture: 'Stand', rateScale: 1, statId: '', statValue: 0, emotionId: '', chanceToPlay: 1 },
    actors: [],
    stages: [createStage()],
  };
  for (let i = 0; i < actors; i++) addActorSlot(scene);
  return scene;
}

export function addActorSlot(scene, opts = {}) {
  const n = scene.actors.length;
  const slot = {
    id: uid('actor'),
    name: opts.name || `Zoi ${String.fromCharCode(65 + n)}`,
    bodyType: opts.bodyType || 'adult',
    gender: opts.gender || 'Any',
    growth: opts.growth || 'Adult',
    color: ACTOR_COLORS[n % ACTOR_COLORS.length],
    // Placement relative to the scene origin (meters / degrees). Second actor faces the first by default.
    offset: opts.offset || (n === 0 ? { x: 0, z: 0, yaw: 0 } : { x: 0, z: 0.75 * n, yaw: 180 }),
  };
  scene.actors.push(slot);
  for (const st of scene.stages) st.clips[slot.id] = newClip(st, `${scene.name} – ${slot.name}`);
  return slot;
}

export function removeActorSlot(scene, slotId) {
  scene.actors = scene.actors.filter((a) => a.id !== slotId);
  for (const st of scene.stages) delete st.clips[slotId];
}

export function addStage(scene, afterIndex = scene.stages.length - 1, copyFrom = null) {
  const prev = copyFrom || scene.stages[afterIndex];
  const st = createStage({ name: `Stage ${scene.stages.length + 1}`, frames: prev ? prev.frames : 60, fps: prev ? prev.fps : 30, loop: prev ? prev.loop : false });
  for (const a of scene.actors) {
    if (copyFrom && copyFrom.clips[a.id]) st.clips[a.id] = copyFrom.clips[a.id].clone();
    else {
      st.clips[a.id] = newClip(st, `${scene.name} – ${a.name}`);
      // Start the new stage from the pose the previous stage ended on, so stages chain smoothly.
      const pc = prev && prev.clips[a.id];
      if (pc && !pc.isEmpty()) st.clips[a.id].keyPose(pc.samplePose(pc.frames), 0);
    }
  }
  scene.stages.splice(afterIndex + 1, 0, st);
  return st;
}

/** Keeps every actor clip in a stage in sync with the stage timing. */
export function syncStageTiming(stage) {
  for (const c of Object.values(stage.clips)) { c.fps = stage.fps; c.frames = stage.frames; c.loop = stage.loop; }
}

export function createProject() {
  const scene = createScene({ name: 'My first animation' });
  return {
    format: 'zoi-motion-project',
    version: 1,
    pack: { id: 'mypack', name: 'My Animation Pack', author: '', version: '1.0.0', description: '' },
    scenes: [scene],
  };
}

export function projectToJSON(p) {
  return {
    format: 'zoi-motion-project',
    version: 1,
    pack: { ...p.pack },
    scenes: p.scenes.map((s) => ({
      ...s,
      tags: [...s.tags],
      inzoi: { ...s.inzoi },
      actors: s.actors.map((a) => ({ ...a, offset: { ...a.offset } })),
      stages: s.stages.map((st) => ({
        ...st,
        clips: Object.fromEntries(Object.entries(st.clips).map(([k, c]) => [k, c.toJSON()])),
      })),
    })),
  };
}

export function projectFromJSON(j) {
  if (!j || j.format !== 'zoi-motion-project') throw new Error('This is not a Studio project file.');
  return {
    format: j.format,
    version: j.version,
    pack: { id: 'mypack', name: 'Pack', author: '', version: '1.0.0', description: '', ...j.pack },
    scenes: j.scenes.map((s) => ({
      ...s,
      tags: s.tags || [],
      inzoi: { posture: 'Stand', rateScale: 1, statId: '', statValue: 0, emotionId: '', chanceToPlay: 1, ...(s.inzoi || {}) },
      actors: s.actors.map((a) => ({ ...a, offset: { x: 0, z: 0, yaw: 0, ...a.offset } })),
      stages: s.stages.map((st) => {
        const stage = { loopCount: 1, ...st, clips: {} };
        for (const [k, c] of Object.entries(st.clips || {})) stage.clips[k] = Clip.fromJSON(c);
        return stage;
      }),
    })),
  };
}

/** Safe id fragment for file names and pack ids. */
export function slug(s, fallback = 'item') {
  const v = String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+/g, '_');
  return v || fallback;
}
