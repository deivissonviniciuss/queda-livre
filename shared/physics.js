// Colisão e raycast 2D compartilhados (servidor e cliente usam o mesmo código,
// assim a movimentação prevista no cliente bate com a do servidor).
// Obstáculos: { s: 'b', x, y, hw, hh } (caixa centrada) ou { s: 'c', x, y, r } (círculo).

import { MAP_HALF } from './constants.js';

const CELL = 8;

export class World {
  constructor(obstacles) {
    this.obstacles = obstacles;
    this.cols = Math.ceil((MAP_HALF * 2) / CELL) + 2;
    this.cells = new Map();
    this.stamp = 0;
    this.marks = new Uint32Array(obstacles.length);
    obstacles.forEach((o, i) => {
      const [x0, y0, x1, y1] = bounds(o);
      this.forCells(x0, y0, x1, y1, (k) => {
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(i);
      });
    });
  }

  forCells(x0, y0, x1, y1, fn) {
    const cx0 = Math.floor((x0 + MAP_HALF) / CELL), cy0 = Math.floor((y0 + MAP_HALF) / CELL);
    const cx1 = Math.floor((x1 + MAP_HALF) / CELL), cy1 = Math.floor((y1 + MAP_HALF) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cy * 1000 + cx);
  }

  // Chama fn(obstáculo) uma única vez para cada obstáculo que toca o retângulo.
  query(x0, y0, x1, y1, fn) {
    const stamp = ++this.stamp;
    this.forCells(x0, y0, x1, y1, (k) => {
      const list = this.cells.get(k);
      if (!list) return;
      for (const i of list) {
        if (this.marks[i] === stamp) continue;
        this.marks[i] = stamp;
        fn(this.obstacles[i]);
      }
    });
  }

  // Empurra o círculo (p.x, p.y, r) para fora dos obstáculos e mantém dentro do mapa.
  resolveCircle(p, r) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(p.x - r, p.y - r, p.x + r, p.y + r, (o) => {
        if (pushOut(p, r, o)) moved = true;
      });
      if (!moved) break;
    }
    const lim = MAP_HALF - r;
    if (p.x < -lim) p.x = -lim; else if (p.x > lim) p.x = lim;
    if (p.y < -lim) p.y = -lim; else if (p.y > lim) p.y = lim;
  }

  circleFree(x, y, r) {
    let free = true;
    this.query(x - r, y - r, x + r, y + r, (o) => {
      if (free && overlaps(x, y, r, o)) free = false;
    });
    return free;
  }

  // Retorna a fração t (0..1) do segmento até o primeiro obstáculo, ou 1 se livre.
  raycast(x1, y1, x2, y2) {
    let best = 1;
    const dx = x2 - x1, dy = y2 - y1;
    this.query(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), (o) => {
      const t = o.s === 'b' ? rayBox(x1, y1, dx, dy, o) : rayCircle(x1, y1, dx, dy, o.x, o.y, o.r);
      if (t < best) best = t;
    });
    return best;
  }

  lineOfSight(x1, y1, x2, y2) {
    return this.raycast(x1, y1, x2, y2) >= 1;
  }
}

function bounds(o) {
  if (o.s === 'b') return [o.x - o.hw, o.y - o.hh, o.x + o.hw, o.y + o.hh];
  return [o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r];
}

function overlaps(x, y, r, o) {
  if (o.s === 'b') {
    const cx = Math.max(o.x - o.hw, Math.min(x, o.x + o.hw));
    const cy = Math.max(o.y - o.hh, Math.min(y, o.y + o.hh));
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  }
  return (x - o.x) ** 2 + (y - o.y) ** 2 < (r + o.r) ** 2;
}

function pushOut(p, r, o) {
  if (o.s === 'b') {
    const cx = Math.max(o.x - o.hw, Math.min(p.x, o.x + o.hw));
    const cy = Math.max(o.y - o.hh, Math.min(p.y, o.y + o.hh));
    const dx = p.x - cx, dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (r - d);
      p.y += (dy / d) * (r - d);
    } else {
      // centro dentro da caixa: sai pela borda mais próxima
      const left = p.x - (o.x - o.hw), right = o.x + o.hw - p.x;
      const top = p.y - (o.y - o.hh), bottom = o.y + o.hh - p.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) p.x = o.x - o.hw - r;
      else if (m === right) p.x = o.x + o.hw + r;
      else if (m === top) p.y = o.y - o.hh - r;
      else p.y = o.y + o.hh + r;
    }
    return true;
  }
  const dx = p.x - o.x, dy = p.y - o.y;
  const rr = r + o.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return false;
  const d = Math.sqrt(d2) || 1e-6;
  p.x = o.x + (dx / d) * rr;
  p.y = o.y + (dy / d) * rr;
  return true;
}

function rayBox(x, y, dx, dy, o) {
  let tmin = 0, tmax = 1;
  const minX = o.x - o.hw, maxX = o.x + o.hw, minY = o.y - o.hh, maxY = o.y + o.hh;
  if (Math.abs(dx) < 1e-9) {
    if (x < minX || x > maxX) return 1;
  } else {
    let t1 = (minX - x) / dx, t2 = (maxX - x) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return 1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y < minY || y > maxY) return 1;
  } else {
    let t1 = (minY - y) / dy, t2 = (maxY - y) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return 1;
  }
  return tmin;
}

// Interseção segmento x círculo; retorna t (0..1) ou 1 se não acerta.
export function rayCircle(x, y, dx, dy, cx, cy, r) {
  const fx = x - cx, fy = y - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return 1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // começou dentro
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : 1;
}
