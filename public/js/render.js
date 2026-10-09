// Tudo que é visual em 3D: modelos low-poly, mapa, efeitos e a cena do lobby.

import * as THREE from 'three';
import { MAP_HALF, WEAPONS } from '/shared/constants.js';

export function createRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  r.setSize(innerWidth, innerHeight, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  return r;
}

// ------------------------------------------------------------- materiais
const matCache = new Map();
export function mat(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra }); matCache.set(key, m); }
  return m;
}
const basicCache = new Map();
function basic(color, opacity = 1) {
  const key = color + opacity;
  let m = basicCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    basicCache.set(key, m);
  }
  return m;
}

function mesh(geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}
const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w},${h},${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}
const box = (w, h, d, color, x, y, z) => mesh(boxGeo(w, h, d), mat(color), x, y, z);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ----------------------------------------------------------------- armas
const METAL = '#2b2f36', METAL2 = '#4b5563', WOOD = '#7c4a1e';

export function buildGun(key) {
  const g = new THREE.Group();
  if (key === 'fist' || !WEAPONS[key]) return g;
  const accent = WEAPONS[key].color;
  switch (key) {
    case 'pistol':
      g.add(box(0.34, 0.1, 0.08, METAL, 0.12, 0, 0), box(0.08, 0.18, 0.07, METAL2, 0, -0.1, 0), box(0.12, 0.03, 0.085, accent, 0.16, 0.05, 0));
      break;
    case 'smg':
      g.add(box(0.55, 0.13, 0.1, METAL, 0.2, 0, 0), box(0.07, 0.24, 0.06, METAL2, 0.24, -0.16, 0), box(0.22, 0.06, 0.05, METAL2, -0.14, 0, 0), box(0.25, 0.03, 0.105, accent, 0.22, 0.07, 0));
      break;
    case 'shotgun':
      g.add(box(0.95, 0.08, 0.08, METAL, 0.38, 0.02, 0), box(0.26, 0.1, 0.12, WOOD, 0.46, -0.05, 0), box(0.38, 0.14, 0.08, WOOD, -0.16, -0.02, 0), box(0.18, 0.03, 0.09, accent, 0.05, 0.07, 0));
      break;
    case 'rifle': {
      g.add(box(0.8, 0.13, 0.1, METAL, 0.3, 0, 0), box(0.3, 0.15, 0.08, WOOD, -0.18, -0.02, 0), box(0.2, 0.06, 0.06, METAL2, 0.78, 0.01, 0));
      const magz = box(0.09, 0.26, 0.07, METAL2, 0.3, -0.17, 0); magz.rotation.z = 0.28; g.add(magz);
      g.add(box(0.3, 0.03, 0.105, accent, 0.3, 0.075, 0));
      break;
    }
    case 'sniper': {
      g.add(box(1.3, 0.08, 0.08, METAL, 0.6, 0.02, 0), box(0.5, 0.15, 0.1, '#3f4a3a', 0.12, 0, 0), box(0.36, 0.16, 0.08, '#3f4a3a', -0.28, -0.02, 0));
      const scope = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 6), mat(METAL), 0.14, 0.14, 0);
      scope.rotation.z = Math.PI / 2; g.add(scope);
      g.add(box(0.3, 0.03, 0.105, accent, 0.12, 0.08, 0));
      break;
    }
  }
  return g;
}

// ---------------------------------------------------------- personagens
const SKIN_TONES = ['#f2c79b', '#d9a066', '#a86b3c', '#7a4a2a', '#f5d6b8', '#c68642'];
const headGeo = new THREE.IcosahedronGeometry(0.3, 1);

function addSkin(root, skin, color) {
  const c = new THREE.Color(color);
  switch (skin) {
    case 'recruta': {
      root.add(mesh(new THREE.CylinderGeometry(0.31, 0.32, 0.14, 10), mat(color), 0, 1.84, 0));
      root.add(box(0.26, 0.04, 0.4, color, 0.27, 1.79, 0));
      break;
    }
    case 'comando': {
      const h = mesh(new THREE.SphereGeometry(0.36, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#4d5a2c'), 0, 1.66, 0);
      root.add(h, box(0.05, 0.06, 0.66, '#3b4522', 0.05, 1.67, 0));
      break;
    }
    case 'ninja': {
      root.add(mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 14), mat('#111827'), 0, 1.72, 0).rotateX(Math.PI / 2));
      root.add(box(0.12, 0.14, 0.5, '#111827', 0.24, 1.53, 0));
      const tail = box(0.3, 0.05, 0.1, color, -0.4, 1.7, 0.08); tail.rotation.y = 0.4; root.add(tail);
      break;
    }
    case 'cowboy': {
      root.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 14), mat('#7c4a1e'), 0, 1.84, 0));
      root.add(mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.3, 10), mat('#8b5a2b'), 0, 2.0, 0));
      root.add(mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.06, 10), mat(color), 0, 1.89, 0));
      break;
    }
    case 'astronauta': {
      const glass = new THREE.MeshLambertMaterial({ color: '#bfe3ff', transparent: true, opacity: 0.35 });
      const b = mesh(new THREE.SphereGeometry(0.44, 14, 10), glass, 0, 1.64, 0, false);
      root.add(b, mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.12, 12), mat('#e5e7eb'), 0, 1.28, 0));
      root.add(box(0.06, 0.3, 0.06, '#e5e7eb', -0.12, 2.1, 0.18));
      root.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), mat(color), -0.12, 2.27, 0.18));
      break;
    }
    case 'chef': {
      root.add(mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.32, 10), mat('#f8fafc'), 0, 1.98, 0));
      root.add(mesh(new THREE.SphereGeometry(0.34, 10, 6), mat('#f8fafc'), 0, 2.2, 0));
      break;
    }
    case 'pirata': {
      const hat = mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.2, 3), mat('#111827'), 0, 1.86, 0);
      hat.rotation.y = 0.5; root.add(hat);
      root.add(mesh(new THREE.SphereGeometry(0.3, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat('#111827'), 0, 1.86, 0));
      root.add(box(0.04, 0.1, 0.1, '#111827', 0.29, 1.67, 0.1));
      root.add(box(0.02, 0.05, 0.08, '#f8fafc', 0.42, 1.92, 0));
      break;
    }
    case 'robo':
      // a cabeça já é substituída em buildCharacter
      root.add(box(0.05, 0.28, 0.05, '#9ca3af', 0, 2.02, 0));
      root.add(mesh(new THREE.SphereGeometry(0.07, 6, 4), basic('#ef4444'), 0, 2.18, 0));
      break;
  }
  return c;
}

export function buildCharacter(color, skin, id = '') {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const darker = '#' + new THREE.Color(color).multiplyScalar(0.55).getHexString();
  const tone = SKIN_TONES[hashStr(id) % SKIN_TONES.length];

  const legs = [];
  for (const z of [0.16, -0.16]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.62, z);
    pivot.add(box(0.22, 0.6, 0.22, '#2d3748', 0, -0.3, 0));
    pivot.add(box(0.28, 0.1, 0.24, '#1f2937', 0.04, -0.57, 0));
    body.add(pivot);
    legs.push(pivot);
  }
  body.add(box(0.46, 0.72, 0.62, color, 0, 0.98, 0));
  body.add(box(0.48, 0.08, 0.64, '#1f2937', 0, 0.66, 0));
  body.add(box(0.24, 0.5, 0.46, darker, -0.34, 1.02, 0));

  if (skin === 'robo') {
    body.add(box(0.5, 0.46, 0.5, '#9ca3af', 0, 1.62, 0));
    body.add(box(0.04, 0.08, 0.32, '#22d3ee', 0.26, 1.66, 0));
  } else {
    body.add(mesh(headGeo, mat(tone), 0, 1.62, 0));
    body.add(box(0.05, 0.08, 0.06, '#111', 0.27, 1.67, 0.1), box(0.05, 0.08, 0.06, '#111', 0.27, 1.67, -0.1));
  }
  addSkin(body, skin, color);

  // braços apontando para a frente (+x), segurando a arma
  const rArm = box(0.5, 0.16, 0.16, color, 0.2, 1.08, 0.22); rArm.rotation.y = 0.38; body.add(rArm);
  const lArm = box(0.58, 0.16, 0.16, color, 0.25, 1.08, -0.12); lArm.rotation.y = -0.55; body.add(lArm);
  const hand = mesh(new THREE.IcosahedronGeometry(0.1, 0), mat(tone), 0.5, 1.06, 0.08); body.add(hand);

  const gunMount = new THREE.Group();
  gunMount.position.set(0.46, 1.1, 0.08);
  body.add(gunMount);

  // paraquedas
  const parachute = new THREE.Group();
  const canopy = mesh(new THREE.SphereGeometry(1.8, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, flatShading: true }), 0, 3.4, 0);
  canopy.scale.y = 0.65;
  parachute.add(canopy);
  const stripe = mesh(new THREE.SphereGeometry(1.82, 10, 4, 0, Math.PI * 0.4, 0, Math.PI * 0.42), new THREE.MeshLambertMaterial({ color: '#f8fafc', side: THREE.DoubleSide, flatShading: true }), 0, 3.4, 0, false);
  stripe.scale.y = 0.65;
  parachute.add(stripe);
  const lineMat = basic('#e5e7eb');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(a) * 1.25, 3.3, Math.sin(a) * 1.25);
    const bottom = new THREE.Vector3(0, 1.3, 0);
    const len = top.distanceTo(bottom);
    const l = mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 3), lineMat, 0, 0, 0, false);
    l.position.copy(top).add(bottom).multiplyScalar(0.5);
    l.lookAt(top);
    l.rotateX(Math.PI / 2);
    parachute.add(l);
  }
  parachute.visible = false;
  group.add(parachute);

  let currentGun = null, currentKey = null;
  function setWeapon(key) {
    if (key === currentKey) return;
    currentKey = key;
    if (currentGun) gunMount.remove(currentGun);
    currentGun = buildGun(key);
    gunMount.add(currentGun);
    hand.visible = key === 'fist';
  }
  setWeapon('fist');

  return { group, body, legs, gunMount, parachute, setWeapon };
}

// ---------------------------------------------------------------- avião
export function buildPlane() {
  const g = new THREE.Group();
  const fus = mesh(new THREE.CylinderGeometry(0.9, 0.65, 10, 8), mat('#f1f5f9'), 0, 0, 0);
  fus.rotation.z = Math.PI / 2; g.add(fus);
  const nose = mesh(new THREE.ConeGeometry(0.9, 1.6, 8), mat('#ef4444'), 5.8, 0, 0);
  nose.rotation.z = -Math.PI / 2; g.add(nose);
  g.add(box(2.2, 0.16, 14, '#e2e8f0', 0.6, -0.2, 0));
  g.add(box(2.3, 0.18, 0.8, '#ef4444', 0.6, -0.19, 6.4), box(2.3, 0.18, 0.8, '#ef4444', 0.6, -0.19, -6.4));
  g.add(box(1.2, 0.12, 4.4, '#e2e8f0', -4.6, 0.2, 0));
  g.add(box(1.5, 1.8, 0.14, '#ef4444', -4.6, 1.1, 0));
  for (const z of [3.2, -3.2]) {
    const eng = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.6, 8), mat('#94a3b8'), 1.0, -0.6, z);
    eng.rotation.z = Math.PI / 2; g.add(eng);
  }
  g.add(box(1.6, 0.3, 1.2, '#1e293b', 3.6, 0.55, 0));
  // a sombra do avião cobriria metade da tela lá embaixo
  g.traverse((o) => { o.castShadow = false; });
  return g;
}

// ----------------------------------------------------------------- loot
const LOOT_GLOW = { ammo: '#facc15', medkit: '#f87171', armor: '#60a5fa', grenade: '#4ade80' };

export function buildLoot(l) {
  const g = new THREE.Group();
  const glowColor = l.type === 'weapon' ? WEAPONS[l.key].color : LOOT_GLOW[l.type];
  const disc = mesh(new THREE.CircleGeometry(0.8, 18), basic(glowColor, 0.32), 0, 0.04, 0, false);
  disc.rotation.x = -Math.PI / 2;
  g.add(disc);
  const item = new THREE.Group();
  item.position.y = 0.5;
  g.add(item);
  switch (l.type) {
    case 'weapon': {
      const gun = buildGun(l.key);
      gun.scale.setScalar(1.5);
      gun.position.x = -0.35;
      item.add(gun);
      break;
    }
    case 'ammo':
      item.add(box(0.5, 0.3, 0.32, '#a16207', 0, 0, 0), box(0.52, 0.06, 0.34, '#facc15', 0, 0.12, 0));
      break;
    case 'medkit':
      item.add(box(0.5, 0.34, 0.36, '#f8fafc', 0, 0, 0), box(0.3, 0.02, 0.09, '#dc2626', 0, 0.18, 0), box(0.09, 0.02, 0.3, '#dc2626', 0, 0.18, 0));
      break;
    case 'armor':
      item.add(box(0.2, 0.55, 0.5, '#1d4ed8', 0, 0, 0), box(0.22, 0.12, 0.52, '#93c5fd', 0, 0.14, 0));
      break;
    case 'grenade':
      item.add(mesh(new THREE.IcosahedronGeometry(0.2, 0), mat('#3f6212'), 0, 0, 0), box(0.08, 0.1, 0.08, '#9ca3af', 0, 0.22, 0));
      break;
  }
  item.scale.setScalar(1.35);
  g.position.set(l.x, 0, l.y);
  g.userData.item = item;
  g.userData.phase = (l.id % 17) * 0.4;
  return g;
}

// ----------------------------------------------------------------- mapa
function crateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#b07a3f'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#9a6533';
  for (let i = 0; i < 4; i++) x.fillRect(0, i * 16 + 14, 64, 2);
  x.strokeStyle = '#6b4220'; x.lineWidth = 6; x.strokeRect(3, 3, 58, 58);
  x.beginPath(); x.moveTo(6, 6); x.lineTo(58, 58); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(x, y) {
  return Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) * 0.5 + Math.sin(y * 0.13 + x * 0.05) * 0.35 + Math.sin((x + y) * 0.31) * 0.15;
}

export function buildWorld(info) {
  const root = new THREE.Group();
  const S = MAP_HALF * 2;

  const water = mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: '#1e88b8' }), 0, -0.6, 0, false);
  water.rotation.x = -Math.PI / 2;
  root.add(water);
  const sand = mesh(new THREE.BoxGeometry(S + 14, 1, S + 14), mat('#e8d39a'), 0, -0.55, 0, false);
  sand.receiveShadow = true;
  root.add(sand);

  const groundGeo = new THREE.PlaneGeometry(S, S, 60, 60);
  groundGeo.rotateX(-Math.PI / 2);
  const colors = [];
  const pos = groundGeo.attributes.position;
  const ca = new THREE.Color('#5fae4a'), cb = new THREE.Color('#7cc35a'), cc = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const n = noise(pos.getX(i), pos.getZ(i)) * 0.5 + 0.5;
    cc.copy(ca).lerp(cb, n);
    colors.push(cc.r, cc.g, cc.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  root.add(ground);

  const obstacles = info.obstacles;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  // pisos
  if (info.floors.length) {
    const floors = new THREE.InstancedMesh(boxGeo(1, 1, 1), new THREE.MeshLambertMaterial(), info.floors.length);
    info.floors.forEach((f, i) => {
      dummy.position.set(f.x, 0.03, f.y); dummy.scale.set(f.w, 0.06, f.h); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      floors.setMatrixAt(i, dummy.matrix);
      floors.setColorAt(i, col.set(f.color));
    });
    floors.receiveShadow = true;
    root.add(floors);
  }

  const byKind = (k) => obstacles.filter((o) => o.k === k);
  function instancedBoxes(list, height, material, colorFn) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(boxGeo(1, 1, 1), material, list.length);
    list.forEach((o, i) => {
      dummy.position.set(o.x, height / 2, o.y); dummy.scale.set(o.hw * 2, height, o.hh * 2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (colorFn) im.setColorAt(i, col.set(colorFn(o)));
    });
    im.castShadow = true; im.receiveShadow = true;
    root.add(im);
    return im;
  }
  instancedBoxes(byKind('wall'), 2.8, new THREE.MeshLambertMaterial(), (o) => o.color);
  instancedBoxes(byKind('cover'), 1.5, mat('#8b939c'));
  instancedBoxes(byKind('crate'), 1.4, new THREE.MeshLambertMaterial({ map: crateTexture() }));

  // pedras
  const rocks = byKind('rock');
  if (rocks.length) {
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat('#9ca3af'), rocks.length);
    rocks.forEach((o, i) => {
      dummy.position.set(o.x, o.r * 0.35, o.y); dummy.scale.set(o.r * 1.05, o.r * 0.8, o.r * 1.05); dummy.rotation.set(0, o.rot, 0); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      im.setColorAt(i, col.set(i % 3 ? '#9ca3af' : '#878f99'));
    });
    im.castShadow = true; im.receiveShadow = true;
    root.add(im);
  }

  // árvores
  const trees = byKind('tree');
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6), mat('#7c5230'), trees.length);
  const canopyGeos = [new THREE.ConeGeometry(1.6, 3.4, 7), new THREE.IcosahedronGeometry(1.7, 0), new THREE.DodecahedronGeometry(1.55, 0)];
  const canopyY = [3.2, 3.0, 2.8];
  const greens = ['#2f8f46', '#3fa34d', '#4c9a2a', '#37944f'];
  const canopyMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const canopies = canopyGeos.map((g, v) => new THREE.InstancedMesh(g, canopyMat, Math.max(1, trees.filter((t) => t.variant === v).length)));
  const counters = [0, 0, 0];
  const treeInfo = [];
  trees.forEach((o, i) => {
    const s = o.size;
    dummy.position.set(o.x, 1.1 * s, o.y); dummy.scale.set(s, s, s); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    const v = o.variant, idx = counters[v]++;
    dummy.position.set(o.x, canopyY[v] * s, o.y); dummy.rotation.set(0, (i * 1.7) % 6.28, 0); dummy.updateMatrix();
    canopies[v].setMatrixAt(idx, dummy.matrix);
    const green = greens[i % greens.length];
    canopies[v].setColorAt(idx, col.set(green));
    treeInfo.push({ x: o.x, y: o.y, v, idx, matrix: dummy.matrix.clone(), green });
  });
  canopies.forEach((c, v) => { c.count = counters[v]; c.castShadow = true; root.add(c); });
  trunks.castShadow = true;
  root.add(trunks);

  // copas perto do jogador ficam transparentes para não esconder ninguém
  const fadeMats = greens.map((g) => new THREE.MeshLambertMaterial({ color: g, transparent: true, opacity: 0.28, depthWrite: false, flatShading: true }));
  const pool = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(canopyGeos[0], fadeMats[0]);
    m.visible = false; m.matrixAutoUpdate = false;
    root.add(m); pool.push(m);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let faded = new Map();
  function fadeNear(points) {
    const next = new Map();
    for (const t of treeInfo) {
      for (const p of points) {
        if (Math.abs(t.x - p.x) < 3.6 && Math.abs(t.y - p.y) < 3.6 && next.size < pool.length) { next.set(t, true); break; }
      }
    }
    for (const t of faded.keys()) if (!next.has(t)) { canopies[t.v].setMatrixAt(t.idx, t.matrix); canopies[t.v].instanceMatrix.needsUpdate = true; }
    let pi = 0;
    pool.forEach((m) => { m.visible = false; });
    for (const t of next.keys()) {
      if (!faded.has(t)) { canopies[t.v].setMatrixAt(t.idx, zero); canopies[t.v].instanceMatrix.needsUpdate = true; }
      const m = pool[pi++];
      m.geometry = canopyGeos[t.v];
      m.material = fadeMats[greens.indexOf(t.green)];
      m.matrix.copy(t.matrix);
      m.visible = true;
    }
    faded = next;
  }

  return { root, fadeNear };
}

// ----------------------------------------------------------------- zona
export class ZoneView {
  constructor(scene) {
    this.wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 40, 128, 1, true),
      new THREE.MeshBasicMaterial({ color: '#a855f7', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.wall.position.y = 20;
    this.outsideMat = new THREE.MeshBasicMaterial({ color: '#6d28d9', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.outside = new THREE.Mesh(new THREE.RingGeometry(1, 2, 8), this.outsideMat);
    this.outside.rotation.x = -Math.PI / 2;
    this.outside.position.y = 0.08;
    const pts = [];
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
    this.next = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }));
    this.next.position.y = 0.15;
    scene.add(this.wall, this.outside, this.next);
    this.lastR = -1;
  }

  update(z) {
    const r = Math.max(0.01, z.r);
    this.wall.scale.set(r, 1, r);
    this.wall.position.set(z.x, 20, z.y);
    if (Math.abs(r - this.lastR) > 0.05) {
      this.outside.geometry.dispose();
      this.outside.geometry = new THREE.RingGeometry(r, 420, 96, 1);
      this.lastR = r;
    }
    this.outside.position.set(z.x, 0.08, z.y);
    const nr = Math.max(0.01, z.nr);
    this.next.scale.set(nr, 1, nr);
    this.next.position.set(z.nx, 0.15, z.ny);
    this.next.visible = z.nr < z.r - 0.5;
  }
}

// --------------------------------------------------------------- efeitos
const particleGeo = new THREE.BoxGeometry(1, 1, 1);
const tracerGeo = new THREE.BoxGeometry(1, 0.07, 0.07);
const TRACER_COLOR = { pistol: '#fde68a', smg: '#bae6fd', shotgun: '#fdba74', rifle: '#e9d5ff', sniper: '#fef08a' };

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];
    this.tracers = new Map();
    this.nades = new Map();
    this.flashes = [];
    this.decals = [];
    this.flashGeo = new THREE.IcosahedronGeometry(0.28, 0);
    this.boomGeo = new THREE.IcosahedronGeometry(1, 1);
  }

  tracer(id, x, y, a, w, world) {
    const W = WEAPONS[w];
    const m = new THREE.Mesh(tracerGeo, basic(TRACER_COLOR[w] || '#fff'));
    m.scale.x = w === 'sniper' ? 3.5 : 1.6;
    m.rotation.y = -a;
    m.position.set(x, 1.1, y);
    this.scene.add(m);
    const dx = Math.cos(a), dy = Math.sin(a);
    // fim previsto pelo raycast local (o servidor confirma com o evento de impacto)
    const t = world.raycast(x, y, x + dx * W.range, y + dy * W.range);
    this.tracers.set(id, { m, x, y, dx, dy, speed: W.speed, left: W.range * t, hitWall: t < 1 });
  }

  endTracer(id, x, y, kind) {
    const t = this.tracers.get(id);
    if (t) { this.scene.remove(t.m); this.tracers.delete(id); }
    if (kind === 'wall') this.burst(x, 1.0, y, ['#d6d3d1', '#a8a29e', '#fde68a'], 5, 4, 0.35, 0.09);
    if (kind === 'flesh') this.burst(x, 1.1, y, ['#dc2626', '#991b1b', '#f87171'], 8, 5, 0.45, 0.11);
  }

  muzzle(x, y, a, len = 1.1) {
    const m = new THREE.Mesh(this.flashGeo, basic('#fde047'));
    m.position.set(x + Math.cos(a) * len, 1.12, y + Math.sin(a) * len);
    this.scene.add(m);
    this.flashes.push({ m, life: 0.05 });
  }

  burst(x, y, z, colors, n, speed, life, size) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length > 400) break;
      const m = new THREE.Mesh(particleGeo, basic(colors[i % colors.length]));
      m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      m.position.set(x, y, z);
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ m, vx: Math.cos(a) * s, vy: speed * (0.2 + Math.random() * 0.8), vz: Math.sin(a) * s, life, max: life, g: 14 });
    }
  }

  dust(x, y, n = 10) {
    this.burst(x, 0.3, y, ['#d6c7a1', '#c2b280', '#e7e5e4'], n, 3, 0.6, 0.18);
  }

  explosion(x, y) {
    const m = new THREE.Mesh(this.boomGeo, new THREE.MeshBasicMaterial({ color: '#fb923c', transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.set(x, 1, y);
    this.scene.add(m);
    this.flashes.push({ m, life: 0.45, max: 0.45, boom: true });
    this.burst(x, 0.8, y, ['#f97316', '#facc15', '#ef4444', '#57534e', '#78716c'], 40, 11, 0.9, 0.3);
    const d = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14), new THREE.MeshBasicMaterial({ color: '#1c1917', transparent: true, opacity: 0.5, depthWrite: false }));
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, 0.07, y);
    this.scene.add(d);
    this.decals.push({ m: d, life: 12 });
    this.removeNade(null, x, y);
  }

  grenade(id, x0, y0, x1, y1, flight) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), mat('#3f6212'));
    m.castShadow = true;
    m.position.set(x0, 1, y0);
    this.scene.add(m);
    this.nades.set(id, { m, x0, y0, x1, y1, flight, t: 0 });
  }

  removeNade(id, x, y) {
    if (id !== null && this.nades.has(id)) {
      this.scene.remove(this.nades.get(id).m);
      this.nades.delete(id);
      return;
    }
    // sem id: remove a granada mais próxima do ponto
    let best = null, bd = 3;
    for (const [k, n] of this.nades) { const d = Math.hypot(n.x1 - x, n.y1 - y); if (d < bd) { bd = d; best = k; } }
    if (best !== null) { this.scene.remove(this.nades.get(best).m); this.nades.delete(best); }
  }

  update(dt) {
    for (const [id, t] of this.tracers) {
      const step = t.speed * dt;
      t.x += t.dx * step; t.y += t.dy * step; t.left -= step;
      t.m.position.set(t.x, 1.1, t.y);
      if (t.left <= 0) {
        this.scene.remove(t.m); this.tracers.delete(id);
        if (t.hitWall) this.burst(t.x, 1.0, t.y, ['#d6d3d1', '#a8a29e', '#fde68a'], 4, 4, 0.3, 0.09);
      }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      p.vy -= p.g * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.vx *= 0.6; p.vz *= 0.6; p.vy = 0; }
      if (p.life <= 0) { this.scene.remove(p.m); this.parts.splice(i, 1); }
      else p.m.scale.multiplyScalar(0.985);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.boom) {
        const k = 1 - f.life / f.max;
        f.m.scale.setScalar(1 + k * 6);
        f.m.material.opacity = 0.9 * (1 - k);
      }
      if (f.life <= 0) { this.scene.remove(f.m); if (f.boom) f.m.material.dispose(); this.flashes.splice(i, 1); }
    }
    for (const n of this.nades.values()) {
      n.t += dt;
      const k = Math.min(1, n.t / n.flight);
      n.m.position.set(n.x0 + (n.x1 - n.x0) * k, 1 + Math.sin(k * Math.PI) * 4 - k * 0.8, n.y0 + (n.y1 - n.y0) * k);
      n.m.rotation.x += dt * 10;
      if (k >= 1) n.m.material = (Math.floor(n.t * 8) % 2) ? basic('#ef4444') : mat('#3f6212');
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life < 2) d.m.material.opacity = 0.5 * (d.life / 2);
      if (d.life <= 0) { this.scene.remove(d.m); d.m.material.dispose(); this.decals.splice(i, 1); }
    }
  }
}

// ------------------------------------------------------- iluminação/céu
export function setupLights(scene) {
  scene.background = new THREE.Color('#8ec9ea');
  scene.fog = new THREE.Fog('#8ec9ea', 90, 220);
  const hemi = new THREE.HemisphereLight('#e0f2fe', '#4d7c3a', 1.7);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);
  return { sun, follow(x, z) { sun.position.set(x + 30, 60, z + 20); sun.target.position.set(x, 0, z); } };
}

// ----------------------------------------------------------- lobby (3D)
export class PreviewScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    const lights = setupLights(this.scene);
    lights.sun.shadow.camera.left = lights.sun.shadow.camera.bottom = -20;
    lights.sun.shadow.camera.right = lights.sun.shadow.camera.top = 20;
    lights.follow(0, 0);
    this.scene.fog = new THREE.Fog('#8ec9ea', 30, 110);

    const ground = mesh(new THREE.CircleGeometry(90, 40), new THREE.MeshLambertMaterial({ color: '#6db851' }), 0, 0, 0, false);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // cenário ao redor
    const deco = { obstacles: [], floors: [] };
    const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, d = 9 + rnd() * 45;
      deco.obstacles.push({ s: 'c', k: 'tree', x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.5, size: 0.9 + rnd() * 0.5, variant: Math.floor(rnd() * 3) });
    }
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2, d = 6 + rnd() * 20;
      deco.obstacles.push({ s: 'c', k: 'rock', x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.8 + rnd(), rot: rnd() * 6 });
    }
    deco.obstacles.push({ s: 'b', k: 'crate', x: -3.2, y: -2.5, hw: 0.7, hh: 0.7 }, { s: 'b', k: 'crate', x: -3.2, y: -1.05, hw: 0.7, hh: 0.7 }, { s: 'b', k: 'cover', x: 4, y: -5, hw: 3, hh: 0.4 });
    const w = buildWorld({ ...deco, obstacles: deco.obstacles });
    // remove água/areia/chão quadrado do buildWorld: no lobby só usamos os objetos
    w.root.children.slice(0, 3).forEach((c) => w.root.remove(c));
    this.scene.add(w.root);

    this.plane = buildPlane();
    this.plane.position.set(-80, 32, -60);
    this.scene.add(this.plane);
    this.planeT = 0;

    this.char = null;
    this.t = 0;
  }

  setCharacter(color, skin, weapon = 'rifle') {
    if (this.char) this.scene.remove(this.char.group);
    this.char = buildCharacter(color, skin, 'preview');
    this.char.setWeapon(weapon);
    this.char.group.scale.setScalar(1.6);
    this.scene.add(this.char.group);
  }

  frame(renderer, dt) {
    this.t += dt;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    this.camera.aspect = w / h;
    // personagem fica à direita do painel do lobby
    const panel = w > 900 ? Math.min(560, w) : 0;
    if (panel) this.camera.setViewOffset(w, h, -panel / 2, 0, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const a = this.t * 0.08;
    this.camera.position.set(Math.cos(a) * 10, 3.6, Math.sin(a) * 10);
    this.camera.lookAt(0, 1.9, 0);
    if (this.char) {
      this.char.group.rotation.y = -a - Math.PI / 2 + Math.sin(this.t * 0.7) * 0.5;
      this.char.body.position.y = Math.sin(this.t * 2) * 0.03;
    }
    this.planeT += dt;
    const k = (this.planeT % 26) / 26;
    this.plane.position.set(-90 + k * 180, 30, -50 + k * 30);
    this.plane.rotation.y = -Math.atan2(30, 180);
    renderer.render(this.scene, this.camera);
  }
}
