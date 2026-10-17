// Character "looks": the real models a Zoi is displayed as (the mannequin is only a fallback).
//   builtin:* – models listed in assets/characters/index.json (the realistic posing figures)
//   inzoi     – the body-tracking Zoi that ships with inZOI (loaded from the player's game folder)
//   custom    – any FBX/GLB/VRM the user imported for this Zoi
import * as THREE from 'three';
import { parseModel, CharacterRig } from './io/import.js';
import { bridge } from './storage.js';

const buffers = new Map();
let builtins = null;

export async function listLooks() {
  if (!builtins) {
    builtins = [];
    try {
      const r = await fetch('assets/characters/index.json', { cache: 'no-store' });
      if (r.ok) builtins = (await r.json()).characters || [];
    } catch { /* none installed */ }
  }
  const looks = [];
  for (const c of builtins) looks.push({ id: 'builtin:' + c.id, label: c.label, file: c.file, credit: c.credit });
  if (bridge.info?.game?.vrm) looks.push({ id: 'inzoi', label: 'inZOI body (from your game)' });
  looks.push({ id: 'mannequin', label: 'Mannequin (skeleton view)' });
  return looks;
}

async function bufferFor(id) {
  if (buffers.has(id)) return buffers.get(id);
  let buf, ext, name;
  if (id === 'inzoi') {
    buf = await bridge.gameFile('vrm');
    ext = 'vrm'; name = 'inZOI body';
  } else if (id.startsWith('builtin:')) {
    const looks = await listLooks();
    const look = looks.find((l) => l.id === id);
    if (!look) throw new Error('Unknown character ' + id);
    const r = await fetch('assets/characters/' + look.file);
    if (!r.ok) throw new Error('Missing character file ' + look.file);
    buf = await r.arrayBuffer();
    ext = look.file.split('.').pop().toLowerCase(); name = look.label;
  } else throw new Error('Unknown character ' + id);
  const entry = { buf, ext, name };
  buffers.set(id, entry);
  return entry;
}

/** Loads a fresh CharacterRig for a look id (each Zoi gets its own copy). */
export async function loadLook(id) {
  const { buf, ext, name } = await bufferFor(id);
  const loaded = await parseModel(buf.slice(0), ext, name);
  const rig = new CharacterRig(loaded);
  rig.lookId = id;
  // Built-in figures stand in for the Zoi itself, so they take the Zoi's size.
  rig.matchSize = id.startsWith('builtin:');
  applyFigureLook(rig);
  return rig;
}

/**
 * Posing-figure finish: matte light grey with a thin orange line down the body's centre
 * (drawn in the bind pose, so it follows the body as it bends).
 */
export function applyFigureLook(rig) {
  const half = 0.0018 / (rig.retargeter.unit || 1);
  rig.model.traverse((o) => {
    if (!o.isMesh) return;
    const make = () => {
      // Less room light than other materials: matte grey needs the key light's shading to read as a form.
      const mat = new THREE.MeshStandardMaterial({ color: 0x9d9da3, roughness: 0.6, metalness: 0, envMapIntensity: 0.35 });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uLineHalf = { value: half };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
varying vec3 vBindPos;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
vBindPos = position;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
varying vec3 vBindPos;
uniform float uLineHalf;`)
          .replace('#include <map_fragment>', `#include <map_fragment>
{ float d = abs(vBindPos.x); float a = 1.0 - smoothstep(uLineHalf * 0.55, uLineHalf, d); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.42, 0.10), a); }`);
      };
      mat.customProgramCacheKey = () => 'zoi-figure';
      return mat;
    };
    o.material = Array.isArray(o.material) ? o.material.map(make) : make();
  });
}
