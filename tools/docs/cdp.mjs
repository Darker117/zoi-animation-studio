// Minimal Chrome DevTools Protocol driver for a headless Microsoft Edge (no extra packages: Node 22+
// has fetch and WebSocket built in). Used by screens.mjs to render the documentation screenshots.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export async function launch({ width = 1600, height = 1000, port = 9333 } = {}) {
  const edge = EDGE_PATHS.find((p) => fs.existsSync(p));
  if (!edge) throw new Error('Microsoft Edge not found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-docs-'));
  const proc = spawn(edge, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
    if (!target) await sleep(200);
  }
  if (!target) { proc.kill(); throw new Error('Edge did not open a debugging port'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) rej(new Error(d.error.message)); else res(d.result);
    } else if (d.method) listeners.forEach((l) => l(d));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const consoleErrors = [];
  listeners.push((e) => {
    if (e.method === 'Runtime.exceptionThrown') consoleErrors.push(e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text);
  });

  const page = {
    send,
    consoleErrors,
    async goto(url) {
      const loaded = new Promise((res) => listeners.push((e) => { if (e.method === 'Page.loadEventFired') res(); }));
      await send('Page.navigate', { url });
      await loaded;
    },
    /** Runs `body` as an async function in the page and returns its JSON-able result. */
    async run(body, arg = null) {
      if (process.env.DOCS_VERBOSE) console.log('run', body.trim().split(/\r?\n/)[0].slice(0, 70));
      const expression = `(async (arg) => { ${body} })(${JSON.stringify(arg)})`;
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async key(key, code = key, keyCode = 0) {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode });
    },
    async click(x, y, button = 'left') {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1 });
      }
    },
    /** Saves a PNG of the page, or of a region: a CSS selector or {x, y, width, height}. */
    async shot(file, region = null, pad = 0) {
      if (process.env.DOCS_VERBOSE) console.log('shot', path.basename(file));
      await page.run('await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 800))]);');
      let clip;
      if (typeof region === 'string') {
        clip = await page.run(`const r = document.querySelector(arg).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };`, region);
      } else if (region) clip = region;
      const params = { format: 'png' };
      if (clip) {
        params.clip = {
          x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad),
          width: Math.min(width, clip.width + 2 * pad), height: Math.min(height, clip.height + 2 * pad), scale: 1,
        };
      }
      const { data } = await send('Page.captureScreenshot', params);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    async close() {
      try { ws.close(); } catch { }
      proc.kill();
      await sleep(500);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
    },
  };
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
