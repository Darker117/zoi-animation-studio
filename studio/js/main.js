// Studio — application core.
import * as THREE from 'three';
import { Actor } from './core/actor.js';
import { History } from './core/history.js';
import { Clip } from './core/clip.js';
import { BONES, BONE_MAP, GROUPS, mirrorName } from './core/rig.js';
import { qMirrorX, uid } from './core/math.js';
import {
  createProject, createScene, addActorSlot, removeActorSlot, addStage, syncStageTiming,
  projectToJSON, projectFromJSON, slug,
} from './core/project.js';
import { mirrorPose } from './core/pose.js';
import { Viewport, ikBones } from './viewport.js';
import { Timeline } from './timeline.js';
import { VmcLink } from './live/vmc.js';
import { kvGet, kvSet, prefGet, prefSet, bridge } from './storage.js';
import { $, toast, contextMenu, modalOpen, confirmDialog, promptDialog, downloadBlob, pickFile } from './ui/dom.js';
import { EASINGS } from './core/math.js';
import { mountTopbar } from './ui/topbar.js';
import { mountLibrary } from './ui/library.js';
import { mountInspector } from './ui/inspector.js';
import { mountTransport } from './ui/transport.js';
import * as dialogs from './ui/dialogs.js';
import { startTour } from './ui/tour.js';
import { loadLook, listLooks } from './characters.js';

class App extends EventTarget {
  constructor() {
    super();
    this.project = createProject();
    this.sceneIdx = 0;
    this.stageIdx = 0;
    this.actors = [];
    this.activeSlotId = null;
    this.selectedBone = null;
    this.frame = 0;
    this.playing = false;
    this.speed = 1;
    this.loopPlayback = true;
    this.playAllStages = false;
    this.autoKey = prefGet('autoKey', true);
    this.onion = prefGet('onion', false);
    this.motionPath = prefGet('motionPath', false);
    this.history = new History();
    this.poseClipboard = null;
    this.keyClipboard = null;
    this.characters = new Map(); // slotId -> CharacterRig
    this.defaultLook = null;     // decided once the bridge is detected (the posing figure when it is installed)
    this.vmc = new VmcLink({ ...prefGet('vmc', {}) });
    this.liveSlotId = null;
    this.poseDirty = false;
    this._touched = new Set();
    this._lastTick = performance.now();

    this.viewport = new Viewport(this, $('#viewport'));
    this.timeline = new Timeline(this, $('#timeline'));
    this.history.onChange(() => this.emit('history'));

    this.buildActors();
    this.applyFrame();

    mountTopbar(this);
    mountLibrary(this);
    mountInspector(this);
    mountTransport(this);
    this._bindKeys();
    this._bindDrop();
    this._bindTimelineResize();
    requestAnimationFrame((t) => this._loop(t));
    this._initAsync();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }

  async _initAsync() {
    await bridge.detect();
    // Default body: the realistic posing figure, then the inZOI body from the game, then the mannequin.
    const looks = await listLooks();
    const has = (id) => looks.some((l) => l.id === id);
    this.defaultLook = ['builtin:zoi-figure-male', 'inzoi'].find(has) || 'mannequin';
    import('./ui/thumbs.js').then((t) => t.setThumbLook(this.defaultLook));
    this.emit('bridge');
    this.ensureLooks();
    const saved = await kvGet('autosave');
    if (saved && saved.scenes?.length) {
      try {
        this.loadProjectJSON(saved, { silent: true });
        toast('Restored your last session.', { type: 'ok' });
      } catch (e) { console.warn('autosave restore failed', e); }
    }
    if (!prefGet('welcomed', false)) dialogs.welcome(this);
  }

  // ------------------------------------------------------------------ accessors

  get scene() { return this.project.scenes[this.sceneIdx]; }
  get stage() { return this.scene.stages[this.stageIdx]; }
  get activeActor() { return this.actors.find((a) => a.slotId === this.activeSlotId) || this.actors[0] || null; }
  get activeSlot() { return this.scene.actors.find((s) => s.id === this.activeSlotId) || this.scene.actors[0]; }
  get activeClip() { const a = this.activeActor; return a ? this.stage.clips[a.slotId] : null; }
  clipFor(slotId) { return this.stage.clips[slotId]; }

  // ------------------------------------------------------------------ actors

  buildActors() {
    for (const a of this.actors) { if (a.character) a.character.model.removeFromParent(); a.character = null; a.dispose(); }
    // Drop models of Zois that are not in this scene (custom imports are kept; they cannot be reloaded).
    const ids = new Set(this.scene.actors.map((s) => s.id));
    for (const [id, rig] of this.characters) if (!ids.has(id) && !rig.custom) { rig.dispose(); this.characters.delete(id); }
    this.actors = this.scene.actors.map((slot) => {
      const a = new Actor({ id: slot.id, name: slot.name, bodyType: slot.bodyType });
      a.slotId = slot.id;
      a.slot = slot;
      this._placeActor(a);
      const ch = this.characters.get(slot.id);
      if (ch) { ch.attach(a); a.setMannequinVisible(slot.showMannequin ?? false); }
      return a;
    });
    if (!this.actors.find((a) => a.slotId === this.activeSlotId)) this.activeSlotId = this.actors[0]?.slotId || null;
    this.viewport.setActors(this.actors);
    this.viewport.setProps(this.scene.props || []);
    this.emit('actors');
    this.ensureLooks();
  }

  /** Gives every Zoi its real character model (inZOI body by default) instead of the mannequin. */
  async ensureLooks() {
    for (const a of this.actors) {
      const slot = a.slot;
      if (this.characters.has(slot.id)) continue;
      const look = slot.look || this.defaultLook;
      if (!look || look === 'mannequin' || look === 'custom') { a.setMannequinVisible(true); continue; }
      if (a._loadingLook === look) continue;
      a._loadingLook = look;
      try {
        const rig = await loadLook(look);
        if (!this.actors.includes(a) || this.characters.has(slot.id) || (slot.look || this.defaultLook) !== look) { rig.dispose(); continue; }
        this.characters.set(slot.id, rig);
        rig.attach(a);
        a.setMannequinVisible(!!slot.showMannequin);
        this.applyFrame();
        this.emit('actors');
      } catch (e) {
        console.warn('Could not load character', look, e);
        a.setMannequinVisible(true);
      } finally { a._loadingLook = null; }
    }
  }

  /** Switches a Zoi to another look ('inzoi', 'builtin:…', 'mannequin'). */
  setLook(slotId, look) {
    const slot = this.scene.actors.find((s) => s.id === slotId);
    if (!slot) return;
    const old = this.characters.get(slotId);
    if (old) { old.dispose(); this.characters.delete(slotId); }
    const a = this.actors.find((x) => x.slotId === slotId);
    if (a) a.character = null;
    slot.look = look;
    delete slot.character;
    if (look === 'mannequin' && a) a.setMannequinVisible(true);
    this.markDirty();
    this.ensureLooks();
    this.emit('actors');
  }

  _placeActor(a) {
    const o = a.slot.offset;
    a.root.position.set(o.x || 0, 0, o.z || 0);
    a.root.rotation.set(0, ((o.yaw || 0) * Math.PI) / 180, 0);
    a.root.updateMatrixWorld(true);
  }

  updateActorPlacement(slotId) {
    const a = this.actors.find((x) => x.slotId === slotId);
    if (a) { this._placeActor(a); this.applyFrame(); }
    this.markDirty();
  }

  setActiveActor(slotId, { keepBone = false } = {}) {
    if (this.activeSlotId === slotId) return;
    this.activeSlotId = slotId;
    if (!keepBone) this.selectedBone = null;
    this.timeline.selection.clear();
    this.timeline.dirty = true;
    this._refreshHighlights();
    this.viewport.updateGizmo();
    this.updateHelpers();
    this.emit('actor');
    this.emit('selection');
  }

  // ------------------------------------------------------------------ selection

  select(bone, actor = null) {
    if (actor && actor.slotId !== this.activeSlotId) this.setActiveActor(actor.slotId, { keepBone: true });
    this.selectedBone = bone;
    this._refreshHighlights();
    this.viewport.updateGizmo();
    this.timeline.dirty = true;
    this.updateHelpers();
    this.emit('selection');
  }

  _refreshHighlights() {
    for (const a of this.actors) a.setHighlight(a.slotId === this.activeSlotId ? this.selectedBone : null, null);
  }

  setHint(html) { this.emit('hint', html); }

  // ------------------------------------------------------------------ frames & sampling

  setFrame(f, { keepDirty = false } = {}) {
    const max = this.stage.frames;
    f = Math.max(0, Math.min(max, f));
    if (this.poseDirty && !keepDirty && Math.round(f) !== Math.round(this.frame)) {
      this.poseDirty = false;
      toast('Unkeyed pose changes were discarded (turn on Auto-key or press K to keep them).', { type: 'warn', timeout: 4500 });
    }
    this.frame = f;
    this.applyFrame();
    this.timeline.ensureVisible(f);
    this.emit('frame');
  }

  applyFrame() {
    for (const a of this.actors) {
      const clip = this.clipFor(a.slotId);
      if (!clip) continue;
      a.applyPose(clip.samplePose(this.frame));
    }
    this.timeline.dirty = true;
    if (!this.playing) {
      this.viewport.updateGizmo();
      this.updateHelpers();
    }
  }

  updateHelpers() {
    clearTimeout(this._helpersT);
    this._helpersT = setTimeout(() => {
      this._updateOnion();
      this._updateMotionPath();
    }, 30);
  }

  _updateOnion() {
    const actor = this.activeActor, clip = this.activeClip;
    if (!this.onion || !actor || !clip || this.playing) { this.viewport.updateOnion(false); return; }
    const frames = clip.keyFrames();
    const f = Math.round(this.frame);
    const prev = [...frames].reverse().find((k) => k < f);
    const next = frames.find((k) => k > f);
    const poses = [];
    if (prev != null) poses.push({ pose: clip.samplePose(prev), color: '#25c8e8', opacity: 0.2 });
    if (next != null) poses.push({ pose: clip.samplePose(next), color: '#f673fb', opacity: 0.2 });
    this.viewport.updateOnion(true, poses);
  }

  _updateMotionPath() {
    const actor = this.activeActor, clip = this.activeClip, bone = this.selectedBone;
    if (!this.motionPath || !actor || !clip || !bone || this.playing) { this.viewport.updateMotionPath(null); return; }
    const helper = this._pathHelper && this._pathHelper.bodyType === actor.bodyType ? this._pathHelper : (this._pathHelper = new Actor({ ghost: true, bodyType: actor.bodyType }));
    helper.root.position.copy(actor.root.position);
    helper.root.quaternion.copy(actor.root.quaternion);
    const pts = [];
    const step = clip.frames > 300 ? 2 : 1;
    for (let f = 0; f <= clip.frames; f += step) {
      helper.applyPose(clip.samplePose(f));
      pts.push(helper.worldPos(bone, new THREE.Vector3()));
    }
    const keys = clip.keyFrames([bone]).map((f) => Math.round(f / step));
    this.viewport.updateMotionPath(pts, keys);
    actor.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ interactive editing

  beginInteractiveEdit() {
    this._touched.clear();
    this._editStartPose = this.activeActor?.capturePose();
  }

  interactiveChanged(bones) {
    for (const b of bones) this._touched.add(b);
    const a = this.activeActor;
    a?.character?.update(a);
    this.emit('pose-live');
  }

  commitInteractiveEdit() {
    const bones = [...this._touched];
    this._touched.clear();
    if (!bones.length) return;
    if (this.autoKey) this.keyBones(bones, { label: 'Pose ' + (BONE_MAP.get(bones[0])?.label || bones[0]), fromCurrent: true });
    else {
      this.poseDirty = true;
      if (!this._warnedAutoKey) { this._warnedAutoKey = true; toast('Auto-key is off: press K to keep this pose.', { type: 'warn' }); }
      this.emit('frame');
    }
    this.emit('pose-live');
  }

  cancelInteractiveEdit() { this._touched.clear(); }

  /** Keys the active actor's current pose for `bones` (null = whole body) at the current frame. */
  keyBones(bones = null, { label = 'Key pose', actor = this.activeActor } = {}) {
    if (!actor) return;
    const clip = this.clipFor(actor.slotId);
    const f = Math.round(this.frame);
    const pose = actor.capturePose(bones);
    const touched = bones || BONES.map((b) => b.name);
    this.history.clipEdit(clip, touched, label, () => {
      for (const [b, q] of Object.entries(pose.rot)) clip.setKey(b, 'rot', f, q);
      if (pose.pos.hips && (!bones || bones.includes('hips'))) clip.setKey('hips', 'pos', f, pose.pos.hips);
    }, () => this.afterClipChange());
    this.poseDirty = false;
    this.afterClipChange();
  }

  keyExpression(name, value = null) {
    const clip = this.activeClip;
    const f = Math.round(this.frame);
    const v = value ?? clip.sampleExpr(name, f);
    this.history.clipEdit(clip, [], `Key ${name}`, () => clip.setKey(name, 'expr', f, [v]), () => this.afterClipChange());
    this.afterClipChange();
  }

  setExpression(name, value) {
    const clip = this.activeClip;
    const f = Math.round(this.frame);
    this.history.clipEdit(clip, [], `Face: ${name}`, () => {
      if (!clip.expr[name] || !clip.expr[name].length) clip.setKey(name, 'expr', 0, [0]);
      clip.setKey(name, 'expr', f, [value]);
    }, () => this.afterClipChange());
    this.afterClipChange();
  }

  /** Called after any keyframe change: re-sample, redraw, autosave. */
  afterClipChange() {
    this.applyFrame();
    this.timeline.dirty = true;
    this.markDirty();
    this.emit('clip');
  }

  markDirty() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => kvSet('autosave', projectToJSON(this.project)), 1200);
    this.emit('project-dirty');
  }

  // ------------------------------------------------------------------ bone-level helpers

  setBoneQuat(bone, q, { commit = false, label } = {}) {
    const a = this.activeActor;
    if (!a) return;
    a.bones[bone].quaternion.set(q[0], q[1], q[2], q[3]);
    a.root.updateMatrixWorld(true);
    a.character?.update(a);
    if (commit) {
      if (this.autoKey) this.keyBones([bone], { label: label || 'Adjust ' + BONE_MAP.get(bone).label });
      else { this.poseDirty = true; this.emit('frame'); }
    }
    this.emit('pose-live');
  }

  resetBones(bones, label = 'Reset') {
    const a = this.activeActor;
    for (const b of bones) a.bones[b].quaternion.identity();
    if (bones.includes('hips')) a.bones.hips.position.copy(a.rest.hips);
    a.root.updateMatrixWorld(true);
    this.keyBones(bones, { label });
  }

  /** Copies one side's pose onto the other side (e.g. left arm -> right arm). */
  mirrorSide(fromBones, label = 'Mirror to other side') {
    const a = this.activeActor;
    const targets = [];
    for (const b of fromBones) {
      const m = mirrorName(b);
      if (m === b) continue;
      const q = a.bones[b].quaternion;
      const mq = qMirrorX([q.x, q.y, q.z, q.w]);
      a.bones[m].quaternion.set(mq[0], mq[1], mq[2], mq[3]);
      targets.push(m);
    }
    a.root.updateMatrixWorld(true);
    this.keyBones(targets, { label });
  }

  flipPose() {
    const a = this.activeActor;
    const pose = mirrorPose(a.capturePose(), a);
    a.applyPose(pose);
    this.keyBones(null, { label: 'Flip pose' });
  }

  copyPose() {
    this.poseClipboard = this.activeActor.capturePose();
    toast('Pose copied. Ctrl+V pastes it on any frame or Zoi.', { type: 'ok' });
  }

  pastePose({ mirrored = false } = {}) {
    if (!this.poseClipboard) { toast('Copy a pose first (Ctrl+C).'); return; }
    const a = this.activeActor;
    a.applyPose(mirrored ? mirrorPose(this.poseClipboard, a) : this.poseClipboard);
    this.keyBones(null, { label: mirrored ? 'Paste mirrored pose' : 'Paste pose' });
  }

  // ------------------------------------------------------------------ keys (timeline selection)

  selectedKeys() { return this.timeline.selectedKeys(); }

  onKeySelectionChanged() { this.emit('keys'); }

  deleteSelectedKeys() {
    const sel = this.selectedKeys();
    if (!sel.length) return false;
    const clip = this.activeClip;
    const bones = [...new Set(sel.filter((k) => k.ch !== 'expr').map((k) => k.bone))];
    this.history.clipEdit(clip, bones.length ? bones : [], 'Delete keys', () => {
      for (const k of sel) clip.deleteKey(k.bone, k.ch, k.f);
    }, () => this.afterClipChange());
    this.timeline.selection.clear();
    this.afterClipChange();
    toast(`Deleted ${sel.length} key${sel.length > 1 ? 's' : ''}.`, { action: () => this.undo() });
    return true;
  }

  moveSelectedKeys(delta) {
    const sel = this.selectedKeys();
    if (!sel.length) return;
    const clip = this.activeClip;
    const bones = [...new Set(sel.filter((k) => k.ch !== 'expr').map((k) => k.bone))];
    let moved = [];
    this.history.clipEdit(clip, bones, 'Move keys', () => { moved = clip.moveKeys(sel, delta); }, () => this.afterClipChange());
    this.timeline.selection = new Set(moved.map((k) => `${k.bone}|${k.ch}|${k.f}`));
    this.afterClipChange();
  }

  setSelectedEase(ease) {
    const sel = this.selectedKeys();
    const clip = this.activeClip;
    const bones = [...new Set(sel.map((k) => k.bone))];
    this.history.clipEdit(clip, bones, 'Change easing', () => clip.setEase(sel, ease), () => this.afterClipChange());
    this.afterClipChange();
  }

  copyKeys() {
    const sel = this.selectedKeys();
    if (!sel.length) return false;
    const clip = this.activeClip;
    const f0 = Math.min(...sel.map((k) => k.f));
    this.keyClipboard = sel.map((k) => {
      const key = clip.getKey(k.bone, k.ch, k.f);
      return { bone: k.bone, ch: k.ch, df: k.f - f0, v: key.v.slice(), e: key.e };
    });
    toast(`Copied ${sel.length} keys.`, { type: 'ok' });
    return true;
  }

  pasteKeys() {
    if (!this.keyClipboard) return false;
    const clip = this.activeClip;
    const f = Math.round(this.frame);
    const bones = [...new Set(this.keyClipboard.map((k) => k.bone))];
    this.history.clipEdit(clip, bones, 'Paste keys', () => {
      for (const k of this.keyClipboard) clip.setKey(k.bone, k.ch, f + k.df, k.v, k.e);
    }, () => this.afterClipChange());
    this.afterClipChange();
    return true;
  }

  // ------------------------------------------------------------------ clip-wide operations

  clipOp(label, fn) {
    const clip = this.activeClip;
    this.history.clipEdit(clip, null, label, () => fn(clip), () => { syncFromClip(this); this.afterClipChange(); });
    syncFromClip(this);
    this.afterClipChange();
  }

  setStageLength(frames, { live = false, commitFrom = null } = {}) {
    frames = Math.max(1, Math.round(frames));
    const st = this.stage;
    if (live) { st.frames = frames; syncStageTiming(st); this.timeline.dirty = true; this.emit('stage'); return; }
    const from = commitFrom ?? st.frames;
    if (from === frames && commitFrom == null) return;
    st.frames = frames;
    syncStageTiming(st);
    this.history.push({
      label: 'Change length',
      undo: () => { st.frames = from; syncStageTiming(st); this.afterClipChange(); this.emit('stage'); },
      redo: () => { st.frames = frames; syncStageTiming(st); this.afterClipChange(); this.emit('stage'); },
    });
    if (this.frame > frames) this.frame = frames;
    this.afterClipChange();
    this.emit('stage');
  }

  setStageProp(prop, value, label) {
    const st = this.stage;
    const old = st[prop];
    st[prop] = value;
    syncStageTiming(st);
    this.history.push({ label, undo: () => { st[prop] = old; syncStageTiming(st); this.afterClipChange(); this.emit('stage'); }, redo: () => { st[prop] = value; syncStageTiming(st); this.afterClipChange(); this.emit('stage'); } });
    this.afterClipChange();
    this.emit('stage');
  }

  /** Changes frame rate keeping the same duration in seconds. */
  setFps(fps) {
    const st = this.stage;
    const seconds = st.frames / st.fps;
    const newFrames = Math.max(1, Math.round(seconds * fps));
    this.structural('Change frame rate', () => {
      for (const c of Object.values(st.clips)) { c.retime(newFrames); }
      st.fps = fps; st.frames = newFrames;
      syncStageTiming(st);
    });
    this.timeline.fit();
  }

  /** Stretches the animation in time (all actors of the stage). */
  retimeStage(newFrames) {
    const st = this.stage;
    this.structural('Change speed', () => {
      for (const c of Object.values(st.clips)) c.retime(newFrames);
      st.frames = newFrames;
      syncStageTiming(st);
    });
    this.timeline.fit();
  }

  /** Records a project-wide undo step around fn. */
  structural(label, fn) {
    const snapTake = () => projectToJSON(this.project);
    this.history.snapshotEdit(label, snapTake, (s) => this.loadProjectJSON(s, { silent: true, keepView: true }), fn);
    this.buildActorsIfNeeded();
    this.afterClipChange();
    this.emit('scene');
    this.emit('stage');
  }

  buildActorsIfNeeded() {
    const ids = this.scene.actors.map((s) => s.id).join();
    const have = this.actors.map((a) => a.slotId).join();
    const bodies = this.scene.actors.map((s) => s.bodyType).join();
    const haveBodies = this.actors.map((a) => a.bodyType).join();
    if (ids !== have || bodies !== haveBodies) this.buildActors();
    else for (const a of this.actors) { a.slot = this.scene.actors.find((s) => s.id === a.slotId); a.name = a.slot.name; this._placeActor(a); }
  }

  // ------------------------------------------------------------------ scenes, stages, actors

  setScene(idx) {
    if (idx === this.sceneIdx) return;
    this.sceneIdx = Math.max(0, Math.min(this.project.scenes.length - 1, idx));
    this.stageIdx = 0;
    this.frame = 0;
    this.selectedBone = null;
    this.timeline.selection.clear();
    this.buildActors();
    this.applyFrame();
    this.timeline.fit();
    this.emit('scene');
    this.emit('stage');
  }

  setStage(idx) {
    this.stageIdx = Math.max(0, Math.min(this.scene.stages.length - 1, idx));
    this.frame = Math.min(this.frame, this.stage.frames);
    this.timeline.selection.clear();
    this.applyFrame();
    this.timeline.fit();
    this.emit('stage');
  }

  newScene({ actors = 1, name } = {}) {
    this.structural('New animation', () => {
      const s = createScene({ name: name || `Animation ${this.project.scenes.length + 1}`, actors });
      this.project.scenes.push(s);
      this.sceneIdx = this.project.scenes.length - 1;
      this.stageIdx = 0;
      this.buildActors();
    });
    this.frame = 0;
    this.timeline.fit();
    this.applyFrame();
  }

  duplicateScene(idx = this.sceneIdx) {
    this.structural('Duplicate animation', () => {
      const j = projectToJSON({ ...this.project, scenes: [this.project.scenes[idx]] });
      const copy = projectFromJSON(j).scenes[0];
      copy.id = uid('scene');
      copy.name = this.project.scenes[idx].name + ' (copy)';
      this.project.scenes.splice(idx + 1, 0, copy);
      this.sceneIdx = idx + 1;
      this.stageIdx = 0;
      this.buildActors();
    });
  }

  async deleteScene(idx = this.sceneIdx) {
    if (this.project.scenes.length <= 1) { toast('A pack needs at least one animation.'); return; }
    if (!(await confirmDialog('Delete animation?', `"${this.project.scenes[idx].name}" will be removed from the pack. You can undo this.`, { okLabel: 'Delete', danger: true }))) return;
    this.structural('Delete animation', () => {
      this.project.scenes.splice(idx, 1);
      this.sceneIdx = Math.min(this.sceneIdx, this.project.scenes.length - 1);
      this.stageIdx = 0;
      this.buildActors();
    });
  }

  renameScene(name) {
    const s = this.scene;
    const old = s.name;
    if (!name || name === old) return;
    s.name = name;
    this.history.push({ label: 'Rename', undo: () => { s.name = old; this.emit('scene'); }, redo: () => { s.name = name; this.emit('scene'); } });
    this.markDirty();
    this.emit('scene');
  }

  addStage({ copy = false } = {}) {
    this.structural('Add stage', () => {
      addStage(this.scene, this.stageIdx, copy ? this.stage : null);
      this.stageIdx++;
    });
    this.frame = 0;
    this.applyFrame();
    this.timeline.fit();
  }

  async deleteStage(idx = this.stageIdx) {
    if (this.scene.stages.length <= 1) { toast('An animation needs at least one stage.'); return; }
    this.structural('Delete stage', () => {
      this.scene.stages.splice(idx, 1);
      this.stageIdx = Math.min(this.stageIdx, this.scene.stages.length - 1);
    });
    this.applyFrame();
  }

  moveStage(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= this.scene.stages.length) return;
    this.structural('Reorder stages', () => {
      const s = this.scene.stages;
      [s[idx], s[j]] = [s[j], s[idx]];
      this.stageIdx = j;
    });
  }

  addActor() {
    if (this.scene.actors.length >= 6) { toast('Up to 6 Zois per scene.'); return; }
    this.structural('Add Zoi', () => {
      const slot = addActorSlot(this.scene);
      this.buildActors();
      this.activeSlotId = slot.id;
    });
    this.applyFrame();
    toast('Added a Zoi. Drag its hips, or set its position in the Scene tab.', { type: 'ok' });
  }

  async removeActor(slotId) {
    if (this.scene.actors.length <= 1) { toast('A scene needs at least one Zoi.'); return; }
    const slot = this.scene.actors.find((s) => s.id === slotId);
    if (!(await confirmDialog('Remove Zoi?', `Remove ${slot.name} and its animation from this scene?`, { okLabel: 'Remove', danger: true }))) return;
    this.structural('Remove Zoi', () => {
      removeActorSlot(this.scene, slotId);
      this.characters.get(slotId)?.dispose();
      this.characters.delete(slotId);
      this.buildActors();
    });
    this.applyFrame();
  }

  setSlotProp(slotId, prop, value, label) {
    const slot = this.scene.actors.find((s) => s.id === slotId);
    const old = slot[prop];
    slot[prop] = value;
    const apply = () => { this.buildActorsIfNeeded(); this.applyFrame(); this.emit('actors'); };
    this.history.push({ label, undo: () => { slot[prop] = old; apply(); }, redo: () => { slot[prop] = value; apply(); } });
    apply();
    this.markDirty();
  }

  // ------------------------------------------------------------------ characters

  attachCharacter(slotId, rig) {
    this.characters.get(slotId)?.dispose();
    this.characters.set(slotId, rig);
    const a = this.actors.find((x) => x.slotId === slotId);
    const slot = this.scene.actors.find((s) => s.id === slotId);
    slot.character = rig.loaded.name;
    slot.look = 'custom';
    slot.showMannequin = false;
    rig.custom = true;
    if (a) { rig.attach(a); a.setMannequinVisible(false); }
    this.applyFrame();
    this.emit('actors');
  }

  detachCharacter(slotId) {
    const rig = this.characters.get(slotId);
    if (!rig) return;
    rig.dispose();
    this.characters.delete(slotId);
    const a = this.actors.find((x) => x.slotId === slotId);
    if (a) { a.character = null; a.setMannequinVisible(true); }
    const slot = this.scene.actors.find((s) => s.id === slotId);
    delete slot.character;
    slot.look = 'mannequin';
    slot.showMannequin = true;
    this.emit('actors');
  }

  // ------------------------------------------------------------------ playback

  togglePlay(force) {
    this.playing = force ?? !this.playing;
    if (this.playing) {
      if (this.poseDirty) { this.poseDirty = false; }
      if (this.frame >= this.stage.frames - 0.01 && !this.loopPlayback) this.frame = 0;
      this.viewport.gizmo.detach();
      this.viewport.updateOnion(false);
      this.viewport.updateMotionPath(null);
    } else {
      this.frame = Math.round(this.frame);
      this.applyFrame();
    }
    this._lastTick = performance.now();
    this.emit('play');
    this.emit('frame');
  }

  _loop(now) {
    const dt = Math.min(0.1, (now - this._lastTick) / 1000);
    this._lastTick = now;
    if (this.playing) {
      let f = this.frame + dt * this.stage.fps * this.speed;
      if (f > this.stage.frames) {
        if (this.playAllStages && this.stageIdx < this.scene.stages.length - 1) {
          this.stageIdx++;
          f = 0;
          this.emit('stage');
        } else if (this.playAllStages && this.loopPlayback) {
          this.stageIdx = 0;
          f = 0;
          this.emit('stage');
        } else if (this.loopPlayback || this.stage.loop) f = f % Math.max(1, this.stage.frames);
        else { f = this.stage.frames; this.togglePlay(false); }
      }
      this.frame = f;
      this.applyFrame();
      this.emit('frame-tick');
    }
    // Live link: stream whatever is on screen.
    if (this.vmc.active) {
      const a = this.actors.find((x) => x.slotId === this.liveSlotId) || this.activeActor;
      if (a) this.vmc.tick(a, { expressions: true });
      if ((this._liveUi = (this._liveUi || 0) + 1) % 30 === 0) this.emit('live');
    }
    this.timeline.draw();
    this.viewport.render(now);
    requestAnimationFrame((t) => this._loop(t));
  }

  jumpKey(dir) {
    const clip = this.activeClip;
    const bones = this.selectedBone ? [this.selectedBone] : null;
    const frames = clip.keyFrames(bones);
    const f = Math.round(this.frame);
    const target = dir > 0 ? frames.find((k) => k > f) : [...frames].reverse().find((k) => k < f);
    if (target != null) this.setFrame(target);
  }

  // ------------------------------------------------------------------ live link

  async setLive(on) {
    if (on) {
      if (!bridge.available) await bridge.detect();
      if (!bridge.available) { dialogs.bridgeHelp(this); this.emit('live'); return; }
      this.vmc.active = true;
      this.vmc.startTime = performance.now();
      this.liveSlotId = this.liveSlotId || this.activeSlotId;
      toast('Live link on: your Zoi in inZOI now follows the studio.', { type: 'ok' });
    } else {
      this.vmc.active = false;
    }
    this.emit('live');
  }

  saveVmcPrefs() { prefSet('vmc', { host: this.vmc.host, port: this.vmc.port, fps: this.vmc.fps, bundle: this.vmc.bundle }); }

  // ------------------------------------------------------------------ undo / redo

  undo() { const l = this.history.undo(); if (l) { this._afterHistory(); toast(`Undid: ${l}`); } }
  redo() { const l = this.history.redo(); if (l) { this._afterHistory(); toast(`Redid: ${l}`); } }
  _afterHistory() {
    this.buildActorsIfNeeded();
    this.timeline.selection.clear();
    this.afterClipChange();
    this.emit('scene');
    this.emit('stage');
  }

  // ------------------------------------------------------------------ project IO

  loadProjectJSON(json, { silent = false, keepView = false } = {}) {
    const p = projectFromJSON(json);
    this.project = p;
    this.sceneIdx = keepView ? Math.min(this.sceneIdx, p.scenes.length - 1) : 0;
    this.stageIdx = keepView ? Math.min(this.stageIdx, this.scene.stages.length - 1) : 0;
    if (!keepView) { this.frame = 0; this.selectedBone = null; }
    this.buildActorsIfNeeded();
    if (!keepView) this.buildActors();
    this.applyFrame();
    if (!keepView) { this.timeline.fit(); this.history.clear(); }
    this.emit('scene');
    this.emit('stage');
    this.emit('project');
    if (!silent) this.markDirty();
  }

  async newProject() {
    if (!(await confirmDialog('Start a new pack?', 'Your current work stays in your browser autosave until you start editing the new pack. Save it first if you want a file copy.', { okLabel: 'New pack' }))) return;
    this.project = createProject();
    this.characters.forEach((c) => c.dispose());
    this.characters.clear();
    this.sceneIdx = 0; this.stageIdx = 0; this.frame = 0; this.selectedBone = null;
    this.buildActors();
    this.applyFrame();
    this.history.clear();
    this.timeline.fit();
    this.emit('scene'); this.emit('stage'); this.emit('project');
    this.markDirty();
  }

  async saveProject() {
    const json = JSON.stringify(projectToJSON(this.project));
    const name = slug(this.project.pack.name, 'pack') + '.zmotion';
    if (bridge.available) {
      try {
        const path = await bridge.save(`Projects/${name}`, json);
        toast(`Saved to ${path}`, { type: 'ok', action: () => bridge.reveal('Projects'), actionLabel: 'Show' });
        return;
      } catch (e) { console.warn(e); }
    }
    downloadBlob(json, name, 'application/json');
    toast('Project downloaded.', { type: 'ok' });
  }

  async openProject() {
    const file = await pickFile('.zmotion,.json');
    if (!file) return;
    try {
      this.loadProjectJSON(JSON.parse(await file.text()));
      toast(`Opened ${file.name}`, { type: 'ok' });
    } catch (e) { toast(e.message, { type: 'err' }); }
  }

  async importFiles(files) {
    for (const f of files) {
      if (/\.(zmotion|json)$/i.test(f.name)) {
        try { this.loadProjectJSON(JSON.parse(await f.text())); toast(`Opened ${f.name}`, { type: 'ok' }); }
        catch (e) { toast(e.message, { type: 'err' }); }
      } else {
        await dialogs.importFile(this, f);
      }
    }
  }

  // ------------------------------------------------------------------ menus

  showBoneMenu(x, y, bone) {
    const def = BONE_MAP.get(bone);
    const groupBones = BONES.filter((b) => b.group === def.group).map((b) => b.name);
    const side = def.side;
    const items = [
      { label: def.label, header: true },
      { label: 'Key this part', icon: 'key', shortcut: 'K', onClick: () => this.keyBones([bone]) },
      { label: `Key ${GROUPS.find((g) => g.id === def.group).label.toLowerCase()}`, icon: 'key', onClick: () => this.keyBones(groupBones) },
      { label: 'Reset this part', icon: 'reset', onClick: () => this.resetBones([bone], 'Reset ' + def.label) },
      { label: 'Reset whole ' + GROUPS.find((g) => g.id === def.group).label.toLowerCase(), icon: 'reset', onClick: () => this.resetBones(groupBones, 'Reset group') },
    ];
    if (side) {
      items.push('-', { label: `Copy to ${side === 'left' ? 'right' : 'left'} side`, icon: 'mirror', onClick: () => this.mirrorSide(groupBones.concat(def.group.startsWith('arm') ? BONES.filter((b) => b.group === 'hand' + def.group.slice(3)).map((b) => b.name) : [])) });
    }
    items.push('-', { label: 'Focus camera here', icon: 'focus', shortcut: 'F', onClick: () => this.viewport.focusBone(bone) });
    contextMenu(x, y, items);
  }

  showKeyMenu(x, y, f) {
    const items = [{ label: `Keys at frame ${f}`, header: true }];
    for (const [id, e] of Object.entries(EASINGS)) items.push({ label: e.label, onClick: () => this.setSelectedEase(id) });
    items.push('-',
      { label: 'Copy keys', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => this.copyKeys() },
      { label: 'Delete keys', icon: 'trash', shortcut: 'Del', onClick: () => this.deleteSelectedKeys() });
    contextMenu(x, y, items);
  }

  showTimelineMenu(x, y, f, row) {
    contextMenu(x, y, [
      { label: `Frame ${f}`, header: true },
      { label: 'Key whole pose here', icon: 'key', onClick: () => { this.setFrame(f); this.keyBones(null); } },
      row?.bones ? { label: `Key ${row.label} here`, icon: 'key', onClick: () => { this.setFrame(f); this.keyBones(row.bones); } } : null,
      { label: 'Paste keys here', icon: 'paste', disabled: !this.keyClipboard, onClick: () => { this.setFrame(f); this.pasteKeys(); } },
      '-',
      { label: 'Set animation end here', icon: 'scissors', onClick: () => this.setStageLength(Math.max(1, f)) },
    ].filter(Boolean));
  }

  // ------------------------------------------------------------------ input

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (modalOpen()) return;
      const t = e.target;
      if (t.matches?.('input, textarea, select') && !(t.type === 'range')) return;
      const k = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      if (ctrl && (k === 'z' || k === 'Z')) { handled(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (ctrl && (k === 'y' || k === 'Y')) { handled(); this.redo(); return; }
      if (ctrl && k.toLowerCase() === 's') { handled(); this.saveProject(); return; }
      if (ctrl && k.toLowerCase() === 'o') { handled(); this.openProject(); return; }
      if (ctrl && k.toLowerCase() === 'e') { handled(); dialogs.exportDialog(this); return; }
      if (ctrl && k.toLowerCase() === 'i') { handled(); dialogs.importPicker(this); return; }
      if (ctrl && k.toLowerCase() === 'c') { handled(); if (!this.copyKeys()) this.copyPose(); return; }
      if (ctrl && k.toLowerCase() === 'v') { handled(); if (e.shiftKey) this.pastePose({ mirrored: true }); else if (!(this.timeline.selection.size && this.pasteKeys())) this.pastePose(); return; }
      if (ctrl) return;
      switch (k) {
        case ' ': handled(); this.togglePlay(); break;
        case 'ArrowRight': handled(); this.setFrame(Math.round(this.frame) + (e.shiftKey ? 10 : 1)); break;
        case 'ArrowLeft': handled(); this.setFrame(Math.round(this.frame) - (e.shiftKey ? 10 : 1)); break;
        case 'ArrowUp': handled(); this.jumpKey(1); break;
        case 'ArrowDown': handled(); this.jumpKey(-1); break;
        case 'Home': handled(); this.setFrame(0); break;
        case 'End': handled(); this.setFrame(this.stage.frames); break;
        case 'k': case 'K': case 'i': case 'I':
          handled();
          if (e.shiftKey || !this.selectedBone) this.keyBones(null, { label: 'Key whole pose' });
          else this.keyBones([this.selectedBone]);
          break;
        case 'Delete': case 'Backspace': if (this.timeline.selection.size) { handled(); this.deleteSelectedKeys(); } break;
        case 'e': case 'E': case 'r': case 'R': handled(); this.viewport.setMode('rotate'); this.emit('tool'); break;
        case 'w': case 'W': case 'g': case 'G': handled(); this.viewport.setMode('move'); this.emit('tool'); break;
        case 'f': case 'F': handled(); e.shiftKey ? this.viewport.frameAll() : this.viewport.focusBone(this.selectedBone); break;
        case 'm': case 'M': handled(); this.flipPose(); break;
        case 'o': case 'O': handled(); this.onion = !this.onion; prefSet('onion', this.onion); this.updateHelpers(); this.emit('toggles'); break;
        case 'p': case 'P': handled(); this.motionPath = !this.motionPath; prefSet('motionPath', this.motionPath); this.updateHelpers(); this.emit('toggles'); break;
        case 'Escape': this.select(null); this.timeline.selection.clear(); this.timeline.dirty = true; break;
        case 'Tab': {
          handled();
          const i = this.actors.findIndex((a) => a.slotId === this.activeSlotId);
          const n = this.actors[(i + (e.shiftKey ? -1 : 1) + this.actors.length) % this.actors.length];
          if (n) this.setActiveActor(n.slotId, { keepBone: true });
          break;
        }
        case '1': handled(); this.viewport.viewPreset('front'); break;
        case '3': handled(); this.viewport.viewPreset(e.shiftKey ? 'right' : 'left'); break;
        case '7': handled(); this.viewport.viewPreset('top'); break;
        case '5': handled(); this.viewport.viewPreset('three'); break;
        case '?': case 'h': case 'H': handled(); dialogs.shortcuts(); break;
        default: break;
      }
    });
  }

  _bindDrop() {
    const ov = $('#dropOverlay');
    let depth = 0;
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; ov.classList.add('show'); } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove('show'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      ov.classList.remove('show');
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) this.importFiles(files);
    });
  }

  _bindTimelineResize() {
    const handle = $('#timelineResize');
    let startY = 0, startH = 0;
    const saved = prefGet('timelineH', null);
    if (saved) document.documentElement.style.setProperty('--timeline-h', saved + 'px');
    const move = (e) => {
      const hgt = Math.min(innerHeight * 0.65, Math.max(130, startH + (startY - e.clientY)));
      document.documentElement.style.setProperty('--timeline-h', hgt + 'px');
    };
    handle.addEventListener('pointerdown', (e) => {
      startY = e.clientY;
      startH = $('#timelineWrap').getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', () => {
        handle.removeEventListener('pointermove', move);
        prefSet('timelineH', $('#timelineWrap').getBoundingClientRect().height);
      }, { once: true });
    });
  }

  startTour() { startTour(this); }
}

function syncFromClip(app) {
  const c = app.activeClip;
  const st = app.stage;
  if (c.frames !== st.frames || c.loop !== st.loop || c.fps !== st.fps) {
    st.frames = c.frames; st.loop = c.loop; st.fps = c.fps;
    syncStageTiming(st);
    app.emit('stage');
  }
}

/** Browser-tab icon: the head mark cropped from assets/logo.png. */
function setFavicon() {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 64);
    // The head mark: a square at (35.6%, 15.75%) of the logo, 50.7% of its height on each side.
    const s = img.naturalHeight * 0.507;
    g.drawImage(img, img.naturalWidth * 0.3559, img.naturalHeight * 0.1575, s, s, 0, 0, 64, 64);
    document.getElementById('favicon').href = c.toDataURL('image/png');
  };
  img.src = 'assets/logo.png';
}
setFavicon();

const app = new App();
window.zms = app; // handy for debugging from the console
export default app;
