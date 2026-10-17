// Reference props for lining up contact animations (sitting, lying, leaning…).
// Dimensions follow typical life-sim furniture (seat height ~45 cm, bed ~50 cm).
import * as THREE from 'three';

const mat = (color, rough = 0.7) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
const M = { wood: mat(0x8a6a52, 0.6), fabric: mat(0x5d6aa8, 0.9), light: mat(0xd9d4cc, 0.8), dark: mat(0x3a3f52, 0.7), sheet: mat(0xe8e6f0, 0.95) };

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const PROP_TYPES = {
  chair: { label: 'Chair', build: () => {
    const g = new THREE.Group();
    g.add(box(0.46, 0.05, 0.46, M.wood, 0, 0.42, 0));
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(box(0.04, 0.42, 0.04, M.wood, x, 0, z));
    g.add(box(0.46, 0.5, 0.04, M.wood, 0, 0.47, -0.21));
    return g;
  } },
  sofa: { label: 'Sofa', build: () => {
    const g = new THREE.Group();
    g.add(box(1.8, 0.2, 0.85, M.dark, 0, 0.05, 0));
    g.add(box(1.6, 0.18, 0.7, M.fabric, 0, 0.25, 0.06));
    g.add(box(1.8, 0.5, 0.2, M.fabric, 0, 0.25, -0.33));
    g.add(box(0.15, 0.32, 0.85, M.fabric, -0.83, 0.25, 0));
    g.add(box(0.15, 0.32, 0.85, M.fabric, 0.83, 0.25, 0));
    return g;
  } },
  bed: { label: 'Double bed', build: () => {
    const g = new THREE.Group();
    g.add(box(1.6, 0.3, 2.1, M.wood, 0, 0.0, 0));
    g.add(box(1.5, 0.22, 2.0, M.sheet, 0, 0.3, 0));
    g.add(box(1.6, 0.9, 0.08, M.wood, 0, 0, -1.05));
    g.add(box(0.6, 0.12, 0.35, M.light, -0.38, 0.52, -0.8));
    g.add(box(0.6, 0.12, 0.35, M.light, 0.38, 0.52, -0.8));
    return g;
  } },
  table: { label: 'Table', build: () => {
    const g = new THREE.Group();
    g.add(box(1.2, 0.05, 0.75, M.wood, 0, 0.72, 0));
    for (const [x, z] of [[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]]) g.add(box(0.05, 0.72, 0.05, M.wood, x, 0, z));
    return g;
  } },
  counter: { label: 'Counter', build: () => box(1.2, 0.9, 0.6, M.light) },
  step: { label: 'Step / stair', build: () => box(1.0, 0.18, 0.3, M.light) },
  wall: { label: 'Wall', build: () => box(2.4, 2.4, 0.12, M.light) },
  stool: { label: 'Bar stool', build: () => {
    const g = new THREE.Group();
    g.add(box(0.36, 0.05, 0.36, M.fabric, 0, 0.72, 0));
    g.add(box(0.05, 0.72, 0.05, M.dark, 0, 0, 0));
    g.add(box(0.36, 0.03, 0.36, M.dark, 0, 0, 0));
    return g;
  } },
};

export function buildProp(type) {
  const t = PROP_TYPES[type];
  if (!t) return null;
  const obj = t.build();
  obj.userData.propType = type;
  return obj;
}
