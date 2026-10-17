// Undo/redo. Each entry stores only what an edit touched (a few bone tracks, or the
// whole project for structural edits), so even long motion-capture clips stay cheap.
export class History {
  constructor(limit = 120) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  /** Records an edit to one clip. `bones` = list of touched bones, or null for "everything". */
  clipEdit(clip, bones, label, fn, onChange) {
    const before = clip.snapshotTracks(bones);
    const result = fn();
    const after = clip.snapshotTracks(bones);
    this.push({
      label,
      undo: () => { clip.restoreTracks(before); onChange?.(); },
      redo: () => { clip.restoreTracks(after); onChange?.(); },
    });
    return result;
  }

  /** Records a structural change using full before/after snapshots supplied by the caller. */
  snapshotEdit(label, takeSnapshot, restoreSnapshot, fn) {
    const before = takeSnapshot();
    const result = fn();
    const after = takeSnapshot();
    this.push({ label, undo: () => restoreSnapshot(before), redo: () => restoreSnapshot(after) });
    return result;
  }

  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._emit();
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    e.undo();
    this.redoStack.push(e);
    this._emit();
    return e.label;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    e.redo();
    this.undoStack.push(e);
    this._emit();
    return e.label;
  }

  clear() { this.undoStack.length = 0; this.redoStack.length = 0; this._emit(); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  peekUndo() { return this.undoStack[this.undoStack.length - 1]?.label; }
  peekRedo() { return this.redoStack[this.redoStack.length - 1]?.label; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this); }
}
