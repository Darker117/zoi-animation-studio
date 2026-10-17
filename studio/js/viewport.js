// 3D viewport: rendering, camera, picking and direct-manipulation posing.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { solveTwoBone, IK_CHAINS } from './core/ik.js';
import { BONE_MAP, BONES } from './core/rig.js';
import { Actor } from './core/actor.js';
import { buildProp } from './props.js';

const IK_FOR_BONE = { leftHand: 'leftHand', rightHand: 'rightHand', leftFoot: 'leftFoot', rightFoot: 'rightFoot' };

export class Viewport {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    this.scene.environmentIntensity = 0.6;

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2.5, 4.5, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 12;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xd6c8ff, 0.6);
    rim.position.set(-3, 2.5, -3);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1c26, 0.35));

    this._buildFloor();

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    this.camera.position.set(2.1, 1.55, 3.4);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 25;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.update();

    this.actorsGroup = new THREE.Group();
    this.scene.add(this.actorsGroup);
    this.propsGroup = new THREE.Group();
    this.scene.add(this.propsGroup);
    this.helpersGroup = new THREE.Group();
    this.scene.add(this.helpersGroup);

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.75);
    this.gizmo.setSpace('local');
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (e.value) this._gizmoStart();
      else this._gizmoEnd();
    });
    this.gizmo.addEventListener('objectChange', () => this._gizmoChange());
    this.scene.add(this.gizmo);
    this.ikTarget = new THREE.Object3D();
    this.scene.add(this.ikTarget);

    this.mode = 'rotate'; // rotate | move
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drag = null;
    this.hoverBone = null;
    this.ghosts = [];
    this.pathLine = null;
    this.showGrid = true;
    this.plantFeet = true;
    this.showSkeleton = true;
    this._buildSkeletonOverlay();

    this._bindPointer();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  _buildFloor() {
    const size = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(62,65,72,0.95)');
    grd.addColorStop(0.55, 'rgba(43,45,51,0.7)');
    grd.addColorStop(1, 'rgba(34,36,41,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6, 96), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.renderOrder = -2;
    this.scene.add(disc);
    this.floorDisc = disc;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.34 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.001;
    shadow.receiveShadow = true;
    this.scene.add(shadow);
    const grid = new THREE.GridHelper(8, 32, 0x4f535b, 0x3a3d43);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    grid.material.depthWrite = false;
    grid.position.y = 0.002;
    this.grid = grid;
    this.scene.add(grid);
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, r.width), hgt = Math.max(1, r.height);
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ actors & scene

  setActors(actors) {
    this.actorsGroup.clear();
    for (const a of actors) this.actorsGroup.add(a.root);
    this.clearGhosts();
  }

  setProps(props = []) {
    this.propsGroup.clear();
    for (const p of props) {
      const obj = buildProp(p.type);
      if (!obj) continue;
      obj.position.set(p.x || 0, 0, p.z || 0);
      obj.rotation.y = ((p.yaw || 0) * Math.PI) / 180;
      obj.userData.propId = p.id;
      this.propsGroup.add(obj);
    }
  }

  setGridVisible(v) { this.showGrid = v; this.grid.visible = v; }

  // ------------------------------------------------------------------ selection & gizmo

  updateGizmo() {
    const actor = this.app.activeActor;
    const bone = this.app.selectedBone;
    this.gizmo.detach();
    if (!actor || !bone || this.app.playing) return;
    if (this.mode === 'move') {
      if (bone === 'hips') {
        this.gizmo.setMode('translate');
        this.gizmo.setSpace('world');
        this.gizmo.attach(actor.bones.hips);
      } else if (IK_FOR_BONE[bone]) {
        actor.worldPos(bone, this.ikTarget.position);
        actor.worldQuat(bone, this.ikTarget.quaternion);
        this.ikTarget.updateMatrixWorld(true);
        this.gizmo.setMode('translate');
        this.gizmo.setSpace('world');
        this.gizmo.attach(this.ikTarget);
      } else {
        this.gizmo.setMode('rotate');
        this.gizmo.setSpace('local');
        this.gizmo.attach(actor.bones[bone]);
      }
    } else {
      this.gizmo.setMode('rotate');
      this.gizmo.setSpace('local');
      this.gizmo.attach(actor.bones[bone]);
    }
  }

  setMode(mode) { this.mode = mode; this.updateGizmo(); }

  _gizmoStart() {
    const actor = this.app.activeActor;
    this._gizmoBone = this.app.selectedBone;
    this._feet = this._captureFeet(actor);
    this.app.beginInteractiveEdit();
  }

  _gizmoChange() {
    const actor = this.app.activeActor;
    const bone = this._gizmoBone;
    if (!actor || !bone) return;
    if (this.gizmo.object === this.ikTarget) {
      solveTwoBone(actor, IK_FOR_BONE[bone], this.ikTarget.position, { keepEndRotation: /Foot/.test(bone) });
      this.app.interactiveChanged([...ikBones(IK_FOR_BONE[bone])]);
    } else if (bone === 'hips' && this.gizmo.mode === 'translate') {
      if (this.plantFeet) this._restoreFeet(actor, this._feet);
      this.app.interactiveChanged(['hips', ...(this.plantFeet ? [...ikBones('leftFoot'), ...ikBones('rightFoot')] : [])]);
    } else {
      this.app.interactiveChanged([bone]);
    }
  }

  _gizmoEnd() {
    this.app.commitInteractiveEdit();
    if (this.gizmo.object === this.ikTarget) this.updateGizmo();
  }

  _captureFeet(actor) {
    if (!actor) return null;
    actor.root.updateMatrixWorld(true);
    const out = {};
    for (const s of ['left', 'right']) out[s] = { pos: actor.worldPos(s + 'Foot', new THREE.Vector3()), quat: actor.worldQuat(s + 'Foot', new THREE.Quaternion()) };
    return out;
  }

  _restoreFeet(actor, feet) {
    if (!feet) return;
    actor.root.updateMatrixWorld(true);
    for (const s of ['left', 'right']) {
      solveTwoBone(actor, s + 'Foot', feet[s].pos, { keepEndRotation: false });
      const foot = actor.bones[s + 'Foot'];
      const pq = foot.parent.getWorldQuaternion(new THREE.Quaternion());
      foot.quaternion.copy(pq.invert().multiply(feet[s].quat));
      foot.updateMatrixWorld(true);
    }
  }

  // ------------------------------------------------------------------ pointer interaction

  _bindPointer() {
    const el = this.canvas;
    el.addEventListener('pointermove', (e) => this._onMove(e));
    el.addEventListener('pointerdown', (e) => this._onDown(e), true);
    window.addEventListener('pointerup', (e) => this._onUp(e));
    el.addEventListener('dblclick', (e) => {
      const hit = this._pick(e);
      if (hit) this.focusBone(hit.bone);
    });
    el.addEventListener('contextmenu', (e) => {
      if (this._rightDragged) { e.preventDefault(); return; }
      const hit = this._pick(e);
      if (hit) { e.preventDefault(); this.app.select(hit.bone, hit.actor); this.app.showBoneMenu(e.clientX, e.clientY, hit.bone); }
    });
  }

  _ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return this.pointer;
  }

  _pick(e) {
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const targets = [];
    for (const a of this.app.actors) if (a.showMannequin) targets.push(...a.pickables);
    const hits = this.raycaster.intersectObjects(targets, false);
    let hit = hits[0];
    if (!hit) {
      // Picking on an attached character mesh: choose the nearest joint of that actor.
      const chars = this.app.actors.filter((a) => a.character && a.character.model.visible);
      for (const a of chars) {
        const ch = this.raycaster.intersectObject(a.character.model, true)[0];
        if (ch && (!hit || ch.distance < hit.distance)) hit = { ...ch, object: { userData: { bone: nearestBone(a, ch.point) } }, actorRef: a };
      }
      if (!hit) return null;
    }
    const bone = hit.object.userData.bone;
    const actor = hit.actorRef || this.app.actors.find((a) => a.pickables.includes(hit.object));
    return { bone, actor, point: hit.point.clone() };
  }

  _onDown(e) {
    this._rightDragged = false;
    if (e.button === 2) { this._rightStart = [e.clientX, e.clientY]; return; }
    if (e.button !== 0 || this.app.playing) return;
    if (this.gizmo.axis) return; // the gizmo handles it
    if (e.altKey) return; // Alt + drag always orbits
    const hit = this._pick(e);
    if (!hit) { this._downEmpty = [e.clientX, e.clientY]; return; }
    e.stopPropagation();
    e.preventDefault();
    this.controls.enabled = false;
    if (hit.actor !== this.app.activeActor) this.app.setActiveActor(hit.actor.slotId, { keepBone: true });
    this.app.select(hit.bone);
    const actor = this.app.activeActor;
    actor.root.updateMatrixWorld(true);
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hit.point);
    const bone = hit.bone;
    let kind = 'swing';
    if (IK_FOR_BONE[bone] && !e.shiftKey) kind = 'ik';
    if (bone === 'hips') kind = 'hips';
    this.drag = {
      kind, bone, actor, plane, start: hit.point.clone(), moved: false, x: e.clientX, y: e.clientY,
      jointStart: actor.worldPos(bone, new THREE.Vector3()),
      startQuat: actor.bones[bone].quaternion.clone(),
      hipsStart: actor.bones.hips.position.clone(),
      feet: this._captureFeet(actor),
    };
    this.canvas.setPointerCapture(e.pointerId);
    this.app.beginInteractiveEdit();
  }

  _onMove(e) {
    if (this._rightStart && Math.hypot(e.clientX - this._rightStart[0], e.clientY - this._rightStart[1]) > 4) this._rightDragged = true;
    if (!this.drag) {
      if (this.app.playing || e.buttons) return;
      const hit = this._pick(e);
      const hb = hit ? hit.bone : null;
      const ha = hit ? hit.actor : null;
      if (hb !== this.hoverBone || ha !== this._hoverActor) {
        this.hoverBone = hb;
        this._hoverActor = ha;
        for (const a of this.app.actors) a.setHighlight(a === this.app.activeActor ? this.app.selectedBone : null, a === ha ? hb : null);
        this.canvas.style.cursor = hb ? 'grab' : '';
        this.app.setHint(hb ? hintFor(hb) : null);
      }
      return;
    }
    const d = this.drag;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
    d.moved = true;
    this.canvas.style.cursor = 'grabbing';
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(d.plane, p)) return;
    const delta = p.clone().sub(d.start);
    const actor = d.actor;
    if (d.kind === 'ik') {
      const target = d.jointStart.clone().add(delta);
      // Feet keep their angle to the floor; hands keep their angle to the forearm.
      solveTwoBone(actor, IK_FOR_BONE[d.bone], target, { keepEndRotation: /Foot/.test(d.bone) });
      this.app.interactiveChanged([...ikBones(IK_FOR_BONE[d.bone])]);
    } else if (d.kind === 'hips') {
      const local = delta.clone();
      const inv = actor.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      local.applyQuaternion(inv);
      actor.bones.hips.position.copy(d.hipsStart).add(local);
      actor.bones.hips.updateMatrixWorld(true);
      if (this.plantFeet) this._restoreFeet(actor, d.feet);
      this.app.interactiveChanged(['hips', ...(this.plantFeet ? [...ikBones('leftFoot'), ...ikBones('rightFoot')] : [])]);
    } else {
      const bone = actor.bones[d.bone];
      bone.quaternion.copy(d.startQuat);
      bone.updateMatrixWorld(true);
      const pivot = actor.worldPos(d.bone, new THREE.Vector3());
      const from = d.start.clone().sub(pivot);
      const to = p.clone().sub(pivot);
      if (from.lengthSq() > 1e-8 && to.lengthSq() > 1e-8) {
        const r = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
        const wq = bone.getWorldQuaternion(new THREE.Quaternion());
        const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
        bone.quaternion.copy(pq.invert().multiply(r.multiply(wq)));
        bone.updateMatrixWorld(true);
      }
      this.app.interactiveChanged([d.bone]);
    }
  }

  _onUp(e) {
    if (e.button === 2) { this._rightStart = null; }
    if (this._downEmpty && e.button === 0) {
      const moved = Math.hypot(e.clientX - this._downEmpty[0], e.clientY - this._downEmpty[1]) > 4;
      this._downEmpty = null;
      if (!moved && !this.gizmo.dragging) this.app.select(null);
    }
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    this.canvas.style.cursor = '';
    if (d.moved) this.app.commitInteractiveEdit();
    else this.app.cancelInteractiveEdit();
    this.updateGizmo();
  }

  // ------------------------------------------------------------------ camera

  viewPreset(name) {
    const actor = this.app.activeActor;
    const c = actor ? actor.worldPos('hips', new THREE.Vector3()) : new THREE.Vector3(0, 1, 0);
    c.y = Math.max(0.6, c.y - 0.05);
    const yaw = actor ? actor.root.rotation.y : 0;
    const dist = 3.6;
    const dirs = {
      front: [0, 0.08, 1], back: [0, 0.08, -1], left: [1, 0.05, 0], right: [-1, 0.05, 0],
      top: [0.001, 1, 0.001], three: [0.62, 0.3, 1],
    };
    const d = new THREE.Vector3(...(dirs[name] || dirs.three)).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.animateCamera(c.clone().add(d.multiplyScalar(dist)), c);
  }

  focusBone(bone) {
    const actor = this.app.activeActor;
    if (!actor) return;
    const p = actor.worldPos(bone || 'hips', new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const isSmall = /Hand|Thumb|Index|Middle|Ring|Little|head|Foot|Toes/.test(bone || '');
    const dist = isSmall ? 1.1 : 2.6;
    this.animateCamera(p.clone().add(dir.multiplyScalar(dist)), p);
  }

  frameAll() {
    const box = new THREE.Box3();
    for (const a of this.app.actors) box.expandByObject(a.root);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.animateCamera(c.clone().add(dir.multiplyScalar(Math.max(2.6, size * 1.4))), c);
  }

  animateCamera(pos, target, ms = 380) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const start = performance.now();
    this._camAnim = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const k = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(p0, pos, k);
      this.controls.target.lerpVectors(t0, target, k);
      if (t >= 1) this._camAnim = null;
    };
  }

  // ------------------------------------------------------------------ onion skin & motion path

  clearGhosts() {
    for (const g of this.ghosts) g.dispose();
    this.ghosts = [];
  }

  updateOnion(enabled, poses = []) {
    if (!enabled || !poses.length) { this.clearGhosts(); return; }
    const actor = this.app.activeActor;
    while (this.ghosts.length < poses.length) {
      const g = new Actor({ ghost: true, bodyType: actor.bodyType });
      this.helpersGroup.add(g.root);
      this.ghosts.push(g);
    }
    while (this.ghosts.length > poses.length) this.ghosts.pop().dispose();
    poses.forEach((p, i) => {
      const g = this.ghosts[i];
      if (g.bodyType !== actor.bodyType) g.setBodyType(actor.bodyType);
      g.root.position.copy(actor.root.position);
      g.root.quaternion.copy(actor.root.quaternion);
      g.setGhostColor(p.color, p.opacity);
      g.applyPose(p.pose);
    });
  }

  updateMotionPath(points, keyIdx = []) {
    if (this.pathLine) { this.pathLine.geometry.dispose(); this.pathLine.removeFromParent(); this.pathLine = null; }
    if (this.pathDots) { this.pathDots.geometry.dispose(); this.pathDots.removeFromParent(); this.pathDots = null; }
    if (!points || points.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const colors = [];
    const c0 = new THREE.Color(0x3cdac1), c1 = new THREE.Color(0xf673fb);
    points.forEach((_, i) => { const c = c0.clone().lerp(c1, i / (points.length - 1)); colors.push(c.r, c.g, c.b); });
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.pathLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }));
    this.pathLine.renderOrder = 10;
    this.helpersGroup.add(this.pathLine);
    const kp = keyIdx.filter((i) => points[i]).map((i) => points[i]);
    if (kp.length) {
      const dg = new THREE.BufferGeometry().setFromPoints(kp);
      this.pathDots = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xd9bc5f, size: 7, sizeAttenuation: false, depthTest: false }));
      this.pathDots.renderOrder = 11;
      this.helpersGroup.add(this.pathDots);
    }
  }

  // ------------------------------------------------------------------ skeleton overlay
  // On a real character the mannequin is hidden; faint bones and joint dots drawn on top show
  // what you are grabbing, and the selected joint glows.

  _buildSkeletonOverlay() {
    const pairs = BONES.filter((b) => b.parent && !/Intermediate|Distal/.test(b.name));
    this._skelPairs = pairs.map((b) => [b.parent, b.name]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this._skelPairs.length * 6), 3));
    this.skelLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x3cdac1, transparent: true, opacity: 0.6, depthTest: false }));
    this.skelLines.renderOrder = 20;
    this.skelLines.frustumCulled = false;
    this._skelJoints = BONES.filter((b) => !/Intermediate|Distal|Proximal/.test(b.name)).map((b) => b.name);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(this._skelJoints.length * 3), 3));
    this.skelPoints = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xf1edf4, size: 7, sizeAttenuation: false, transparent: true, opacity: 0.9, depthTest: false }));
    this.skelPoints.renderOrder = 21;
    this.skelPoints.frustumCulled = false;
    this.selMarker = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 14), new THREE.MeshBasicMaterial({ color: 0x25c8e8, transparent: true, opacity: 0.95, depthTest: false }));
    this.selMarker.renderOrder = 22;
    this.hoverMarker = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false }));
    this.hoverMarker.renderOrder = 22;
    this.helpersGroup.add(this.skelLines, this.skelPoints, this.selMarker, this.hoverMarker);
  }

  _updateSkeletonOverlay() {
    const actor = this.app.activeActor;
    const show = !!(actor && actor.character && actor.character.model.visible && !actor.showMannequin);
    this.skelLines.visible = this.skelPoints.visible = show && this.showSkeleton && !this.app.playing;
    const v = new THREE.Vector3();
    if (this.skelLines.visible) {
      const lp = this.skelLines.geometry.attributes.position;
      this._skelPairs.forEach(([a, b], i) => {
        jointPos(actor, a, v); lp.setXYZ(i * 2, v.x, v.y, v.z);
        jointPos(actor, b, v); lp.setXYZ(i * 2 + 1, v.x, v.y, v.z);
      });
      lp.needsUpdate = true;
      const pp = this.skelPoints.geometry.attributes.position;
      this._skelJoints.forEach((b, i) => { jointPos(actor, b, v); pp.setXYZ(i, v.x, v.y, v.z); });
      pp.needsUpdate = true;
    }
    const sel = this.app.selectedBone;
    this.selMarker.visible = !!(show && sel && !this.app.playing);
    if (this.selMarker.visible) jointPos(actor, sel, this.selMarker.position);
    const hov = this.hoverBone;
    this.hoverMarker.visible = !!(show && hov && hov !== sel && this._hoverActor === actor && !this.app.playing);
    if (this.hoverMarker.visible) jointPos(actor, hov, this.hoverMarker.position);
  }

  // ------------------------------------------------------------------ render

  render(now = performance.now()) {
    if (this._camAnim) this._camAnim(now);
    this.controls.update();
    this._updateSkeletonOverlay();
    this.renderer.render(this.scene, this.camera);
  }
}

export function ikBones(chainId) {
  const c = IK_CHAINS[chainId];
  return [c.upper, c.lower, c.end];
}

/** Where a joint is shown: on the visible character model when there is one, else on the rig. */
function jointPos(actor, name, target) {
  const ch = actor.character;
  if (ch && ch.model.visible && !actor.showMannequin && ch.jointWorld(name, target)) return target;
  return actor.worldPos(name, target);
}

function nearestBone(actor, point) {
  let best = 'hips', bd = Infinity;
  const v = new THREE.Vector3();
  for (const name of Object.keys(actor.bones)) {
    if (/Intermediate|Distal/.test(name)) continue;
    jointPos(actor, name, v);
    const d = v.distanceToSquared(point);
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

function hintFor(bone) {
  const def = BONE_MAP.get(bone);
  if (!def) return null;
  if (IK_FOR_BONE[bone]) return `<b>${def.label}</b> · drag to reach (IK) · <kbd>Shift</kbd>+drag to swing · right-click for options`;
  if (bone === 'hips') return `<b>Hips</b> · drag to move the whole body (feet stay planted) · gizmo to turn`;
  return `<b>${def.label}</b> · drag to swing · use the rings or the sliders on the right for precise control`;
}
