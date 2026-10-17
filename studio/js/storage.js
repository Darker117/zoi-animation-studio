// Autosave (IndexedDB, falls back to nothing if unavailable) and the local bridge client.
const DB = 'zoi-motion-studio';
const STORE = 'kv';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet(key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch { return undefined; }
}

export async function kvSet(key, value) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
}

export function prefGet(key, fallback) {
  try { const v = localStorage.getItem('zms.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function prefSet(key, value) {
  try { localStorage.setItem('zms.' + key, JSON.stringify(value)); } catch { /* private mode */ }
}

// ------------------------------------------------------------------ bridge (bridge/server.ps1)

export const bridge = {
  available: false,
  info: null,
  async detect() {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      this.info = await r.json();
      this.available = !!this.info?.ok;
    } catch { this.available = false; this.info = null; }
    return this.available;
  },
  /** Saves bytes to <Documents>\Zoi Motion Studio\<relPath>. Returns the absolute path. */
  async save(relPath, data) {
    const r = await fetch('/api/save?path=' + encodeURIComponent(relPath), { method: 'POST', body: data });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).path;
  },
  async reveal(relPath = '') {
    await fetch('/api/reveal?path=' + encodeURIComponent(relPath), { method: 'POST' });
  },
  async gameFile(name) {
    const r = await fetch('/api/game/' + name, { cache: 'no-store' });
    if (!r.ok) throw new Error(await r.text());
    return await r.arrayBuffer();
  },
};
