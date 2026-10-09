// Geração procedural da ilha. Tudo sai de uma seed, mas o servidor envia
// a lista pronta aos clientes, então só ele precisa rodar isto.

import { MAP_HALF } from '../shared/constants.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALL = 0.5;
const DOOR = 2.8;
const HOUSE_COLORS = ['#e8d5b7', '#c9d6df', '#f1c6b6', '#d8e2c4', '#e5c9e0', '#f3e1a6', '#cfd4da'];

export function generateMap(seed) {
  const rnd = mulberry32(seed);
  const R = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const obstacles = [];   // colisores ({ s, x, y, ... , k: tipo visual })
  const floors = [];      // pisos das casas (só visual)
  const lootSpots = [];
  const reserved = [];    // retângulos já ocupados (x0,y0,x1,y1)

  const lim = MAP_HALF - 6;
  const free = (x0, y0, x1, y1) => {
    if (x0 < -lim || y0 < -lim || x1 > lim || y1 > lim) return false;
    return !reserved.some((r) => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]);
  };
  const box = (x, y, hw, hh, k, extra = {}) => obstacles.push({ s: 'b', x, y, hw, hh, k, ...extra });

  // --- Casas agrupadas em vilas ---
  const towns = [
    { name: 'Vila Norte', x: R(-15, 15), y: R(-62, -50) },
    { name: 'Porto', x: R(48, 60), y: R(-55, -40) },
    { name: 'Fazenda', x: R(-62, -48), y: R(-10, 10) },
    { name: 'Centro', x: R(-8, 8), y: R(-6, 6) },
    { name: 'Usina', x: R(45, 60), y: R(30, 50) },
    { name: 'Bairro Sul', x: R(-45, -25), y: R(45, 60) },
  ];

  for (const town of towns) {
    const count = 3 + Math.floor(rnd() * 3);
    let placed = 0;
    for (let attempt = 0; attempt < 60 && placed < count; attempt++) {
      const w = R(9, 13), h = R(8, 12);
      const cx = town.x + R(-18, 18), cy = town.y + R(-18, 18);
      if (!free(cx - w / 2 - 3, cy - h / 2 - 3, cx + w / 2 + 3, cy + h / 2 + 3)) continue;
      reserved.push([cx - w / 2 - 2, cy - h / 2 - 2, cx + w / 2 + 2, cy + h / 2 + 2]);
      buildHouse(cx, cy, w, h);
      placed++;
    }
  }

  function buildHouse(cx, cy, w, h) {
    const color = pick(HOUSE_COLORS);
    floors.push({ x: cx, y: cy, w, h, color: rnd() < 0.5 ? '#a47551' : '#8d99a6' });
    // portas: 1 ou 2 lados
    const sides = ['n', 's', 'e', 'w'];
    const doors = new Set([pick(sides)]);
    if (rnd() < 0.6) doors.add(pick(sides));
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
    const horizontal = (y, hasDoor) => {
      if (!hasDoor) return box(cx, y, w / 2, WALL / 2, 'wall', { color });
      const d = R(x0 + 1.5 + DOOR / 2, x1 - 1.5 - DOOR / 2);
      const a = d - DOOR / 2 - x0, b = x1 - (d + DOOR / 2);
      box(x0 + a / 2, y, a / 2, WALL / 2, 'wall', { color });
      box(x1 - b / 2, y, b / 2, WALL / 2, 'wall', { color });
    };
    const vertical = (x, hasDoor) => {
      const iy0 = y0 + WALL / 2, iy1 = y1 - WALL / 2; // sem sobrepor os cantos
      const len = iy1 - iy0;
      if (!hasDoor) return box(x, cy, WALL / 2, len / 2, 'wall', { color });
      const d = R(iy0 + 1.5 + DOOR / 2, iy1 - 1.5 - DOOR / 2);
      const a = d - DOOR / 2 - iy0, b = iy1 - (d + DOOR / 2);
      box(x, iy0 + a / 2, WALL / 2, a / 2, 'wall', { color });
      box(x, iy1 - b / 2, WALL / 2, b / 2, 'wall', { color });
    };
    horizontal(y0, doors.has('n'));
    horizontal(y1, doors.has('s'));
    vertical(x0, doors.has('w'));
    vertical(x1, doors.has('e'));
    // móvel/caixa interna e loot
    if (rnd() < 0.7) box(cx + R(-w / 4, w / 4), cy + R(-h / 4, h / 4), 0.7, 0.7, 'crate');
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) lootSpots.push({ x: cx + R(-w / 2 + 1.5, w / 2 - 1.5), y: cy + R(-h / 2 + 1.5, h / 2 - 1.5) });
  }

  // --- Muros soltos (cobertura) ---
  for (let i = 0, made = 0; i < 200 && made < 18; i++) {
    const vertical = rnd() < 0.5;
    const len = R(5, 10);
    const x = R(-lim, lim), y = R(-lim, lim);
    const hw = vertical ? 0.4 : len / 2, hh = vertical ? len / 2 : 0.4;
    if (!free(x - hw - 2, y - hh - 2, x + hw + 2, y + hh + 2)) continue;
    reserved.push([x - hw - 1, y - hh - 1, x + hw + 1, y + hh + 1]);
    box(x, y, hw, hh, 'cover');
    if (rnd() < 0.5) lootSpots.push({ x: x + (vertical ? 1.6 : 0), y: y + (vertical ? 0 : 1.6) });
    made++;
  }

  // --- Caixas (sozinhas ou em grupos) ---
  for (let i = 0, made = 0; i < 400 && made < 45; i++) {
    const x = R(-lim, lim), y = R(-lim, lim);
    const n = 1 + Math.floor(rnd() * 3);
    if (!free(x - 3, y - 3, x + 3, y + 3)) continue;
    reserved.push([x - 2.5, y - 2.5, x + 2.5, y + 2.5]);
    for (let j = 0; j < n; j++) {
      const ox = j === 1 ? 1.45 : 0, oy = j === 2 ? 1.45 : 0;
      box(x + ox, y + oy, 0.7, 0.7, 'crate');
    }
    if (rnd() < 0.55) lootSpots.push({ x: x - 1.8, y: y + 0.4 });
    made++;
  }

  // --- Pedras ---
  for (let i = 0, made = 0; i < 400 && made < 40; i++) {
    const r = R(1.0, 2.2);
    const x = R(-lim, lim), y = R(-lim, lim);
    if (!free(x - r - 1.5, y - r - 1.5, x + r + 1.5, y + r + 1.5)) continue;
    reserved.push([x - r - 0.5, y - r - 0.5, x + r + 0.5, y + r + 0.5]);
    obstacles.push({ s: 'c', x, y, r, k: 'rock', rot: rnd() * 6.28 });
    made++;
  }

  // --- Árvores ---
  for (let i = 0, made = 0; i < 1500 && made < 150; i++) {
    const x = R(-MAP_HALF + 3, MAP_HALF - 3), y = R(-MAP_HALF + 3, MAP_HALF - 3);
    const r = 0.55;
    if (!free(x - 1.6, y - 1.6, x + 1.6, y + 1.6)) continue;
    reserved.push([x - 1.2, y - 1.2, x + 1.2, y + 1.2]);
    obstacles.push({ s: 'c', x, y, r, k: 'tree', size: R(0.85, 1.35), variant: Math.floor(rnd() * 3) });
    made++;
  }

  // --- Loot espalhado em campo aberto ---
  for (let i = 0, made = 0; i < 400 && made < 35; i++) {
    const x = R(-lim, lim), y = R(-lim, lim);
    if (!free(x - 1, y - 1, x + 1, y + 1)) continue;
    lootSpots.push({ x, y });
    made++;
  }

  return { seed, obstacles, floors, lootSpots, towns: towns.map((t) => ({ name: t.name, x: t.x, y: t.y })) };
}
