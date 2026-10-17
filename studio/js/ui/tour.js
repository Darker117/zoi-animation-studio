// A short guided tour that spotlights the main areas.
import { h, $ } from './dom.js';

const STEPS = [
  { sel: '#viewportWrap', title: '1 · Pose your Zoi', text: 'Click any body part to select it, then drag it. Hands and feet reach with IK; dragging the hips crouches or sits while the feet stay planted. Use the coloured rings for precise turns.' },
  { sel: '#library', title: '2 · Your library', text: 'Save poses you make and reuse them on any frame or Zoi. Under Motions, describe a motion, act it out on a webcam, or import Mixamo and mocap files. Everything becomes normal keys you can tweak.' },
  { sel: '#timelineWrap', title: '3 · Animate on the timeline', text: 'With Auto-key on (the default), move the teal playhead, change the pose, and a key is saved. Drag keys to retime them, right-click for easing, Space to play.' },
  { sel: '#inspector', title: '4 · Fine-tune', text: 'Friendly sliders for the selected part ("Raise arm", "Bend knee"), timing and loop settings, inZOI settings, and the Zois in the scene.' },
  { sel: '#topbar .live-pill', title: '5 · See it on your Zoi', text: 'Stream straight into inZOI through the game\'s Motion Capture: your Zoi copies the studio in real time.' },
  { sel: '#topbar .btn.primary', title: '6 · Export a pack', text: 'One click builds an inZOI pack: FBX files, a pack manifest for the in-game Zoi Animation Studio mod and a ModKit setup sheet.' },
];

export function startTour() {
  let i = 0;
  const spot = h('div.tour-spot');
  const box = h('div.tour');
  document.body.append(spot, box);
  const end = () => { spot.remove(); box.remove(); window.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); end(); } if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next(); } };
  window.addEventListener('keydown', key, true);
  const next = () => { i++; if (i >= STEPS.length) end(); else show(); };
  const show = () => {
    const s = STEPS[i];
    const el = $(s.sel);
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2 - 100, top: innerHeight / 2 - 50, width: 200, height: 100 };
    const pad = 6;
    Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    box.innerHTML = '';
    box.append(h('h3', {}, s.title), h('p', {}, s.text), h('div.foot', {},
      h('span.count', {}, `${i + 1} / ${STEPS.length}`),
      h('button.btn.ghost.small', { onclick: end }, 'Skip'),
      h('button.btn.primary.small', { onclick: next }, i === STEPS.length - 1 ? 'Done' : 'Next')));
    const bw = 300, bh = box.offsetHeight || 160;
    let x = r.left + r.width + 16, y = r.top + 10;
    if (x + bw > innerWidth - 10) x = r.left - bw - 16;
    if (x < 10) { x = Math.min(innerWidth - bw - 10, Math.max(10, r.left + r.width / 2 - bw / 2)); y = r.top + r.height + 16; }
    if (y + bh > innerHeight - 10) y = Math.max(10, r.top - bh - 16);
    Object.assign(box.style, { left: x + 'px', top: y + 'px' });
  };
  show();
}
