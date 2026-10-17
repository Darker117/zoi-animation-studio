// Live pose viewer for the inspector: a small front/side render of the active character in its
// current pose, with clickable joint hotspots (selected = cyan, keyed on this frame = pink ring).
import * as THREE from 'three';
import { BONE_MAP } from '../core/rig.js';
import { h } from './dom.js';

const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const HOTSPOTS = ['head', 'neck', 'upperChest', 'spine', 'hips',
  ...['left', 'right'].flatMap((s) => ['UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot'].map((p) => s + p))];

export class PoseViewer {
  constructor(app) {
    this.app = app;
    this.view = 'front';
    this.canvas = h('canvas');
    this.hotLayer = h('div', { style: { position: 'absolute', inset: '0' } });
    const viewBtn = (id, label) => h('button.btn.small' + (id === this.view ? '.on' : ''), { onclick: () => { this.view = id; this._renderViews(); this.update(); } }, label);
    this.views = h('div.views.seg');
    this._renderViews = () => { this.views.innerHTML = ''; this.views.append(viewBtn('front', 'Front'), viewBtn('side', 'Side')); };
    this._renderViews();
    this.el = h('div.pose-viewer', {}, this.canvas, this.hotLayer, this.views,
      h('div.caption', {}, 'Click a joint to select it'));
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 50);
    // Lights that follow this view (the scene's lights are fixed in the world, so a Zoi facing
    // away from them would render dark here).
    this.lights = new THREE.Group();
    this.lightTarget = new THREE.Object3D();
    const light = (color, intensity) => { const l = new THREE.DirectionalLight(color, intensity); l.target = this.lightTarget; this.lights.add(l); return l; };
    this.keyLight = light(0xffffff, 1.7);
    this.fillLight = light(0xffffff, 0.55);
    this.rimLight = light(0xd6c8ff, 0.6);
    this.lights.add(this.lightTarget);
    this.hots = {};
    for (const b of HOTSPOTS) {
      const btn = h('button.hot', { title: BONE_MAP.get(b).label, onclick: () => app.select(b) });
      this.hots[b] = btn;
      this.hotLayer.append(btn);
    }
    this._pending = false;
    const req = () => this.update();
    for (const ev of ['frame', 'frame-tick', 'pose-live', 'selection', 'clip', 'actor', 'actors', 'scene', 'stage']) app.on(ev, req);
  }

  /** Re-renders on the next animation frame (coalesces bursts of changes). */
  update() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this._draw(); });
  }

  _draw() {
    const app = this.app;
    const actor = app.activeActor;
    if (!actor || !this.el.isConnected) return;
    const W = Math.max(120, this.el.clientWidth || 280);
    const H = Math.round(W * 1.18);
    if (this._w !== W || this._h !== H) { this.renderer.setSize(W, H, false); this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px'; this._w = W; this._h = H; }

    // Fit the whole body from the front (or the side) of this Zoi.
    actor.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const q = actor.root.getWorldQuaternion(new THREE.Quaternion());
    const dir = new THREE.Vector3(this.view === 'side' ? -1 : 0, 0, this.view === 'side' ? 0 : 1).applyQuaternion(q);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const pts = [];
    for (const name of Object.keys(actor.bones)) { actor.worldPos(name, v); pts.push(v.clone()); box.expandByPoint(v); }
    const head = actor.worldPos('head', new THREE.Vector3());
    box.expandByPoint(head.clone().add(new THREE.Vector3(0, 0.24, 0)));
    const center = box.getCenter(new THREE.Vector3());
    let halfW = 0, halfH = 0;
    for (const p of pts) { const d = p.clone().sub(center); halfW = Math.max(halfW, Math.abs(d.dot(right))); halfH = Math.max(halfH, Math.abs(d.y)); }
    halfH = Math.max(halfH + 0.16, (halfW + 0.16) * (H / W), 0.6);
    halfW = halfH * (W / H);
    this.camera.left = -halfW; this.camera.right = halfW; this.camera.top = halfH; this.camera.bottom = -halfH;
    this.camera.position.copy(center).add(dir.clone().multiplyScalar(6));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();

    // Render only this Zoi: hide helpers, props, other Zois and the floor guides for a clean figure.
    const vp = app.viewport;
    const hide = [vp.helpersGroup, vp.gizmo, vp.propsGroup, vp.grid, vp.floorDisc, ...app.actors.filter((a) => a !== actor).map((a) => a.root),
      ...vp.scene.children.filter((o) => o.isDirectionalLight)];
    const prev = hide.map((o) => o && o.visible);
    hide.forEach((o) => { if (o) o.visible = false; });
    this.lightTarget.position.copy(center);
    this.keyLight.position.copy(center).addScaledVector(dir, 3).addScaledVector(right, -2).add(_up.set(0, 3.5, 0));
    this.fillLight.position.copy(center).addScaledVector(dir, 3).addScaledVector(right, 2.5).add(_up.set(0, 0.5, 0));
    this.rimLight.position.copy(center).addScaledVector(dir, -3).add(_up.set(0, 2, 0));
    vp.scene.add(this.lights);
    this.renderer.render(vp.scene, this.camera);
    vp.scene.remove(this.lights);
    hide.forEach((o, i) => { if (o) o.visible = prev[i]; });

    // Hotspots.
    const clip = app.activeClip;
    const f = Math.round(app.frame);
    const ch = actor.character && actor.character.model.visible ? actor.character : null;
    for (const [b, btn] of Object.entries(this.hots)) {
      // Sit on the visible body's own joints; the head spot goes to the middle of the head.
      if (!ch || !ch.jointWorld(b, v)) actor.worldPos(b, v);
      if (b === 'head') v.add(_up.set(0, 0.085, 0).applyQuaternion(actor.worldQuat('head', _q)));
      v.project(this.camera);
      btn.style.left = ((v.x + 1) / 2) * W + 'px';
      btn.style.top = ((1 - v.y) / 2) * H + 'px';
      btn.classList.toggle('sel', app.selectedBone === b);
      btn.classList.toggle('keyed', !!clip?.getKey(b, 'rot', f));
    }
  }
}
