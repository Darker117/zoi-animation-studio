// Renders small 3D thumbnails of poses for the library (offscreen, cached).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Actor } from '../core/actor.js';
import { BONES } from '../core/rig.js';
import { loadLook } from '../characters.js';

let R = null;
let lookRig = null;
let lookResolve;
const lookReady = new Promise((r) => { lookResolve = r; });

/** Thumbnails show the same character as the studio (the real inZOI body when available). */
export async function setThumbLook(id) {
  if (id && id !== 'mannequin') {
    try { lookRig = await loadLook(id); } catch (e) { console.warn('thumb look', e); }
  }
  lookResolve();
}
const cache = new Map();
const queue = [];
let busy = false;

function init() {
  if (R) return R;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(176, 186, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb7a8ff, 0.8);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 176 / 186, 0.05, 50);
  const actor = new Actor({ name: 'thumb' });
  scene.add(actor.root);
  if (lookRig) { lookRig.attach(actor); actor.setMannequinVisible(false); }
  R = { renderer, scene, camera, actor };
  return R;
}

/** Frames the whole body regardless of pose (sitting, lying…). */
function frame(r) {
  // Frame by the joints (skinned meshes report their bind-pose bounds, which is wrong for lying poses).
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const b of BONES) box.expandByPoint(r.actor.worldPos(b.name, v));
  box.expandByScalar(0.12);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.y * 0.55, size.x * 0.6, size.z * 0.6, 0.45);
  const dist = radius / Math.tan((r.camera.fov * Math.PI) / 360) * 1.05;
  const dir = new THREE.Vector3(0.45, 0.18, 1).normalize();
  r.camera.position.copy(c).add(dir.multiplyScalar(dist));
  r.camera.up.set(0, 1, 0);
  r.camera.lookAt(c);
}

function renderNow(item) {
  const r = init();
  r.actor.applyPose(item.pose);
  r.actor.character?.update(r.actor);
  frame(r);
  r.renderer.render(r.scene, r.camera);
  return r.renderer.domElement.toDataURL('image/png');
}

function pump() {
  if (busy) return;
  busy = true;
  const step = () => {
    const item = queue.shift();
    if (!item) { busy = false; return; }
    try {
      const url = cache.get(item.key) || renderNow(item);
      cache.set(item.key, url);
      item.resolve(url);
    } catch (e) { item.resolve(null); console.warn('thumb', e); }
    if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 80 });
    else setTimeout(step, 0);
  };
  step();
}

/** Returns a promise of a data URL. key must change when the pose changes. */
export function poseThumb(key, { pose }) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return lookReady.then(() => new Promise((resolve) => { queue.push({ key, pose, resolve }); pump(); }));
}

export function forgetThumb(key) { cache.delete(key); }
