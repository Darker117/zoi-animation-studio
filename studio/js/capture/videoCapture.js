// Turn a webcam performance or a video file into an editable animation.
// Uses Google's MediaPipe Pose Landmarker (Apache-2.0), loaded on demand from a CDN, and
// the joint-position converter in core/fromJoints.js.
import { BONES } from '../core/rig.js';
import { jointsToClip } from '../core/fromJoints.js';

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODELS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

let landmarker = null;
let landmarkerMode = null;

export async function loadLandmarker(quality = 'full', mode = 'VIDEO') {
  if (landmarker && landmarkerMode === quality + mode) return landmarker;
  const vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  landmarker?.close?.();
  landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODELS[quality] || MODELS.full, delegate: 'GPU' },
    runningMode: mode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  landmarkerMode = quality + mode;
  return landmarker;
}

// MediaPipe world landmarks: meters, hip-centred, x = image right, y = down, z = away from camera.
// For a person facing the camera that becomes studio space as (x, -y, -z).
const L = { nose: 0, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnk: 27, rAnk: 28, lToe: 31, rToe: 32 };

/** Builds the canonical joint layout (one position per rig bone) from 33 world landmarks. */
function toRigJoints(lm, mirror) {
  const p = (i) => {
    const v = lm[i];
    return [mirror ? -v.x : v.x, -v.y, -v.z];
  };
  // When mirrored (selfie view), the person's left/right swap on screen; swap labels back.
  const S = mirror ? { l: 'r', r: 'l' } : { l: 'l', r: 'r' };
  const get = (side, part) => p(L[S[side] + part]);
  const mid = (a, b, t = 0.5) => a.map((v, i) => v + (b[i] - v) * t);
  const hips = mid(p(L.lHip), p(L.rHip));
  const shMid = mid(get('l', 'Sh'), get('r', 'Sh'));
  const head = mid(p(L.lEar), p(L.rEar));
  const J = {
    hips, spine: mid(hips, shMid, 0.2), chest: mid(hips, shMid, 0.45), upperChest: mid(hips, shMid, 0.7),
    neck: shMid, head,
  };
  for (const [side, s] of [['left', 'l'], ['right', 'r']]) {
    J[side + 'Shoulder'] = mid(shMid, get(s, 'Sh'), 0.18);
    J[side + 'UpperArm'] = get(s, 'Sh');
    J[side + 'LowerArm'] = get(s, 'El');
    J[side + 'Hand'] = get(s, 'Wr');
    J[side + 'MiddleProximal'] = mid(get(s, 'Index'), get(s, 'Pinky'));
    J[side + 'UpperLeg'] = get(s, 'Hip');
    J[side + 'LowerLeg'] = get(s, 'Knee');
    J[side + 'Foot'] = get(s, 'Ank');
    J[side + 'Toes'] = get(s, 'Toe');
  }
  return J;
}

const LAYOUT_BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  ...['left', 'right'].flatMap((s) => ['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'MiddleProximal', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes'].map((p) => s + p))];
export const MEDIAPIPE_LAYOUT = { names: LAYOUT_BONES, joints: Object.fromEntries(LAYOUT_BONES.map((b, i) => [b, i])) };

/** Smooths jittery landmark tracks (centered moving average, keeps the ends). */
function smooth(frames, radius) {
  if (radius < 1) return frames;
  return frames.map((fr, i) => fr.map((_, j) => {
    const acc = [0, 0, 0];
    let n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(frames.length - 1, i + radius); k++) {
      const w = radius + 1 - Math.abs(k - i);
      acc[0] += frames[k][j][0] * w; acc[1] += frames[k][j][1] * w; acc[2] += frames[k][j][2] * w; n += w;
    }
    return [acc[0] / n, acc[1] / n, acc[2] / n];
  }));
}

/**
 * Converts recorded landmark frames (array of 33-landmark arrays or null) to a clip.
 * Keeps the feet on the floor: hip height follows the lowest ankle.
 */
export function recordingToClip(samples, fps, actor, { mirror = false, smoothing = 2, simplify = 0.008, name = 'Captured motion' } = {}) {
  let frames = [];
  let last = null;
  for (const lm of samples) {
    if (lm) last = toRigJoints(lm, mirror);
    if (last) frames.push(LAYOUT_BONES.map((b) => last[b]));
  }
  if (frames.length < 2) throw new Error('No person was detected. Stand fully in view with good lighting.');
  frames = smooth(frames, smoothing);
  // Ground contact: put the lowest ankle at the rig's ankle height.
  const ankleH = actor.restWorld('leftFoot').y;
  const legRig = actor.restWorld('leftUpperLeg').distanceTo(actor.restWorld('leftLowerLeg')) + actor.restWorld('leftLowerLeg').distanceTo(actor.restWorld('leftFoot'));
  const ji = MEDIAPIPE_LAYOUT.joints;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const f0 = frames[Math.floor(frames.length / 2)];
  const legSrc = (dist(f0[ji.leftUpperLeg], f0[ji.leftLowerLeg]) + dist(f0[ji.leftLowerLeg], f0[ji.leftFoot]) + dist(f0[ji.rightUpperLeg], f0[ji.rightLowerLeg]) + dist(f0[ji.rightLowerLeg], f0[ji.rightFoot])) / 2;
  const k = legRig / legSrc;
  for (const fr of frames) {
    const low = Math.min(fr[ji.leftFoot][1], fr[ji.rightFoot][1]);
    const lift = ankleH / k - low;
    for (const j of fr) { j[1] += lift; }
    // In place: the capture is hip-centred, so keep the hips over the origin.
    const hx = fr[ji.hips][0], hz = fr[ji.hips][2];
    for (const j of fr) { j[0] -= hx; j[2] -= hz; }
  }
  return jointsToClip(frames, fps, actor, { name, layout: MEDIAPIPE_LAYOUT, simplify });
}

/** Processes a video file frame by frame. onProgress(0..1). */
export async function processVideoFile(file, { fps = 30, quality = 'full', onProgress } = {}) {
  const lm = await loadLandmarker(quality, 'VIDEO');
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = () => rej(new Error('This video format is not supported by the browser. Try MP4 (H.264) or WebM.')); });
  const duration = video.duration;
  const n = Math.max(2, Math.floor(duration * fps));
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    video.currentTime = t;
    await new Promise((res) => { video.onseeked = res; });
    const r = lm.detectForVideo(video, Math.round(t * 1000) + 1);
    samples.push(r.worldLandmarks?.[0] || null);
    onProgress?.((i + 1) / n);
  }
  URL.revokeObjectURL(url);
  return { samples, fps };
}

export { BONES };
