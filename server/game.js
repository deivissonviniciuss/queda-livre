// Simulação autoritativa de uma partida.

import {
  WEAPONS, WEAPON_WEIGHTS, MAP_HALF, PLAYER_RADIUS, PLAYER_SPEED, HEAL_MOVE_FACTOR,
  MAX_HP, MAX_ARMOR, MAX_AMMO, MAX_MEDKITS, MAX_GRENADES, MEDKIT_HEAL, MEDKIT_TIME,
  DROP_ALTITUDE, FALL_SPEED, FALL_HSPEED, PLANE_SPEED, PICKUP_RADIUS, AUTO_PICKUP_RADIUS,
  GRENADE, ZONE_PHASES, ZONE_START_RADIUS, COLORS, SKINS, zoneAt, clamp,
} from '../shared/constants.js';
import { World, rayCircle } from '../shared/physics.js';
import { generateMap, mulberry32 } from './map.js';
import { Bot } from './bot.js';

const BOT_NAMES = [
  'Zé Bala', 'Tonhão', 'Mira Torta', 'Rato de Loot', 'Vovó Sniper', 'Capitão Pixel', 'Jacaré',
  'Pé de Pano', 'Marretinha', 'Noob Mestre', 'Campeiro', 'Dona Granada', 'Coxinha', 'Tio Rush',
  'Bigode', 'Fumaça', 'Lagartixa', 'Trovão', 'Chapolim', 'Biscoito',
];

const HIT_RADIUS = 0.75;
const WEAPON_KEYS = ['fist', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper'];

export class Game {
  constructor({ humans, botCount = 9, difficulty = 'normal' }) {
    this.seed = Math.floor(Math.random() * 1e9);
    this.map = generateMap(this.seed);
    this.world = new World(this.map.obstacles);
    this.rnd = mulberry32(this.seed ^ 0x51ed);
    this.time = 0;
    this.over = false;
    this.overAt = 0;
    this.players = new Map();
    this.bullets = [];
    this.grenades = [];
    this.loot = new Map();
    this.events = [];
    this.nextId = 1;
    this.bots = [];
    this.difficulty = difficulty;
    this.hadHumans = humans.length > 0;

    this.setupPlane();
    this.setupZone();
    this.spawnLoot();

    for (const h of humans) this.addPlayer({ ...h, isBot: false });
    const names = [...BOT_NAMES].sort(() => this.rnd() - 0.5);
    for (let i = 0; i < botCount; i++) {
      const p = this.addPlayer({
        id: 'b' + (i + 1),
        name: names[i % names.length],
        color: COLORS[Math.floor(this.rnd() * COLORS.length)],
        skin: SKINS[Math.floor(this.rnd() * SKINS.length)].id,
        isBot: true,
      });
      this.bots.push(new Bot(this, p, difficulty));
    }
  }

  r(a, b) { return a + this.rnd() * (b - a); }

  // ---------------------------------------------------------------- setup
  setupPlane() {
    const ang = this.r(0, Math.PI * 2);
    const cx = this.r(-25, 25), cy = this.r(-25, 25);
    const L = 240;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    this.plane = { x0: cx - dx * L / 2, y0: cy - dy * L / 2, x1: cx + dx * L / 2, y1: cy + dy * L / 2, dur: L / PLANE_SPEED, ang };
  }

  planePos() {
    const k = clamp(this.time / this.plane.dur, 0, 1);
    return { x: this.plane.x0 + (this.plane.x1 - this.plane.x0) * k, y: this.plane.y0 + (this.plane.y1 - this.plane.y0) * k, k };
  }

  setupZone() {
    const centers = [{ x: 0, y: 0 }];
    let r = ZONE_START_RADIUS, c = centers[0];
    for (const ph of ZONE_PHASES) {
      const maxOff = Math.max(0, (r - ph.radius) * 0.75);
      const a = this.r(0, Math.PI * 2), d = this.r(0, maxOff);
      const lim = Math.max(0, MAP_HALF - ph.radius - 4);
      const n = { x: clamp(c.x + Math.cos(a) * d, -lim, lim), y: clamp(c.y + Math.sin(a) * d, -lim, lim) };
      // se o clamp tirou o novo círculo de dentro do anterior, puxa de volta
      const dd = Math.hypot(n.x - c.x, n.y - c.y);
      if (dd > r - ph.radius) { const k = (r - ph.radius) / dd; n.x = c.x + (n.x - c.x) * k; n.y = c.y + (n.y - c.y) * k; }
      centers.push(n);
      r = ph.radius; c = n;
    }
    this.zoneCenters = centers;
    this.zone = zoneAt(0, centers);
  }

  randomWeaponKey() {
    const total = Object.values(WEAPON_WEIGHTS).reduce((a, b) => a + b, 0);
    let roll = this.rnd() * total;
    for (const [k, w] of Object.entries(WEAPON_WEIGHTS)) { if ((roll -= w) < 0) return k; }
    return 'pistol';
  }

  spawnLoot() {
    for (const s of this.map.lootSpots) {
      if (this.rnd() > 0.88) continue;
      const roll = this.rnd();
      if (roll < 0.44) {
        const key = this.randomWeaponKey();
        this.addLoot({ x: s.x, y: s.y, type: 'weapon', key, amount: WEAPONS[key].mag }, false);
        if (this.rnd() < 0.6) this.addLoot({ x: s.x + this.r(-1, 1), y: s.y + this.r(0.6, 1.2), type: 'ammo', amount: 40 }, false);
      } else if (roll < 0.66) this.addLoot({ x: s.x, y: s.y, type: 'ammo', amount: 40 }, false);
      else if (roll < 0.8) this.addLoot({ x: s.x, y: s.y, type: 'medkit', amount: 1 }, false);
      else if (roll < 0.9) this.addLoot({ x: s.x, y: s.y, type: 'armor', amount: MAX_ARMOR }, false);
      else this.addLoot({ x: s.x, y: s.y, type: 'grenade', amount: 1 }, false);
    }
  }

  addLoot(l, announce = true) {
    l.id = this.nextId++;
    l.x = clamp(l.x, -MAP_HALF + 1, MAP_HALF - 1);
    l.y = clamp(l.y, -MAP_HALF + 1, MAP_HALF - 1);
    this.loot.set(l.id, l);
    if (announce) this.events.push({ e: 'la', l });
    return l;
  }

  removeLoot(l, by) {
    this.loot.delete(l.id);
    this.events.push({ e: 'lr', id: l.id, by: by ? by.id : null, t: l.type });
  }

  addPlayer({ id, name, color, skin, isBot }) {
    const pp = this.planePos();
    const p = {
      id, name, color, skin, isBot,
      x: pp.x, y: pp.y, z: 0, inPlane: true, alive: true,
      hp: MAX_HP, armor: 0, slots: [null, null], cur: 0, ammo: 0, medkits: 0, grenades: 0,
      aim: 0, shootHeld: false, nextShot: 0, reloadUntil: 0, healUntil: 0, nadeReady: 0,
      kills: 0, dealt: 0, place: 0, moving: false, reqX: null, reqY: null, moveBudget: 0,
      input: { mx: 0, my: 0 }, lastAttacker: null, correction: false, killedBy: null,
    };
    this.players.set(id, p);
    return p;
  }

  // ------------------------------------------------------------- comandos
  handleInput(id, m) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    if (Number.isFinite(m.x) && Number.isFinite(m.y)) { p.reqX = m.x; p.reqY = m.y; }
    if (Number.isFinite(m.a)) p.aim = m.a;
    p.shootHeld = !!m.s;
  }

  handleAction(id, m) {
    const p = this.players.get(id);
    if (p) this.act(p, m.a, m);
  }

  act(p, a, m = {}) {
    if (!p.alive || this.over) return;
    if (a === 'jump') { if (p.inPlane) this.eject(p); return; }
    if (p.inPlane || p.z > 0) return;
    switch (a) {
      case 'pickup': {
        let best = null, bd = PICKUP_RADIUS;
        if (m.id && this.loot.has(m.id)) {
          const l = this.loot.get(m.id);
          if (Math.hypot(l.x - p.x, l.y - p.y) <= PICKUP_RADIUS + 0.5) best = l;
        } else {
          for (const l of this.loot.values()) {
            const d = Math.hypot(l.x - p.x, l.y - p.y);
            if (d < bd) { bd = d; best = l; }
          }
        }
        if (best) this.tryPickup(p, best, true);
        break;
      }
      case 'reload': this.startReload(p); break;
      case 'swap': this.selectSlot(p, 1 - p.cur); break;
      case 'slot': if (m.i === 0 || m.i === 1) this.selectSlot(p, m.i); break;
      case 'heal':
        if (p.medkits > 0 && p.hp < MAX_HP && !p.healUntil) {
          p.healUntil = this.time + MEDKIT_TIME;
          p.reloadUntil = 0;
          this.events.push({ e: 'hs', id: p.id });
        }
        break;
      case 'nade': this.throwGrenade(p, m.tx, m.ty); break;
    }
  }

  selectSlot(p, i) {
    if (p.cur === i) return;
    p.cur = i;
    p.reloadUntil = 0;
    p.healUntil = 0;
    p.nextShot = Math.max(p.nextShot, this.time + 0.25);
    this.events.push({ e: 'sw', id: p.id });
  }

  weaponOf(p) {
    const s = p.slots[p.cur];
    return s ? WEAPONS[s.key] : WEAPONS.fist;
  }

  eject(p) {
    const pp = this.planePos();
    p.inPlane = false;
    p.x = pp.x; p.y = pp.y;
    p.z = DROP_ALTITUDE;
    p.correction = true;
    this.events.push({ e: 'j', id: p.id });
  }

  startReload(p) {
    const s = p.slots[p.cur];
    if (!s || p.reloadUntil || p.ammo <= 0) return;
    const w = WEAPONS[s.key];
    if (s.mag >= w.mag) return;
    p.reloadUntil = this.time + w.reload;
    p.healUntil = 0;
    this.events.push({ e: 'rl', id: p.id, d: w.reload });
  }

  throwGrenade(p, tx, ty) {
    if (p.grenades <= 0 || this.time < p.nadeReady) return;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) { tx = p.x + Math.cos(p.aim) * 12; ty = p.y + Math.sin(p.aim) * 12; }
    let dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > GRENADE.maxThrow) { dx *= GRENADE.maxThrow / d; dy *= GRENADE.maxThrow / d; }
    // para antes de paredes
    const t = this.world.raycast(p.x, p.y, p.x + dx, p.y + dy);
    const k = t < 1 ? Math.max(0, t - 0.05) : 1;
    const g = { id: this.nextId++, owner: p.id, x: p.x + dx * k, y: p.y + dy * k, at: this.time + GRENADE.fuse };
    this.grenades.push(g);
    p.grenades--;
    p.nadeReady = this.time + 0.9;
    p.healUntil = 0;
    this.events.push({ e: 'nd', id: g.id, by: p.id, x0: p.x, y0: p.y, x1: g.x, y1: g.y, fl: GRENADE.flight, fu: GRENADE.fuse });
  }

  tryPickup(p, l, manual) {
    switch (l.type) {
      case 'weapon': {
        const empty = p.slots.findIndex((s) => !s);
        if (empty >= 0) {
          if (!manual && p.slots.some((s) => s && s.key === l.key)) return false;
          p.slots[empty] = { key: l.key, mag: l.amount };
          if (!p.slots[p.cur]) p.cur = empty;
        } else {
          if (!manual) return false;
          const old = p.slots[p.cur];
          p.slots[p.cur] = { key: l.key, mag: l.amount };
          this.addLoot({ x: p.x + this.r(-0.6, 0.6), y: p.y + this.r(-0.6, 0.6), type: 'weapon', key: old.key, amount: old.mag });
          p.reloadUntil = 0;
        }
        break;
      }
      case 'ammo': {
        if (p.ammo >= MAX_AMMO) return false;
        p.ammo = Math.min(MAX_AMMO, p.ammo + l.amount);
        break;
      }
      case 'medkit':
        if (p.medkits >= MAX_MEDKITS) return false;
        p.medkits += l.amount; if (p.medkits > MAX_MEDKITS) p.medkits = MAX_MEDKITS;
        break;
      case 'grenade':
        if (p.grenades >= MAX_GRENADES) return false;
        p.grenades += l.amount; if (p.grenades > MAX_GRENADES) p.grenades = MAX_GRENADES;
        break;
      case 'armor':
        if (p.armor >= l.amount) return false;
        p.armor = l.amount;
        break;
      default: return false;
    }
    this.removeLoot(l, p);
    // pegou arma vazia sem munição? recarrega automaticamente depois
    return true;
  }

  // ------------------------------------------------------------------ tick
  tick(dt) {
    if (this.over) { this.time += dt; return; }
    this.time += dt;
    const pp = this.planePos();
    this.zone = zoneAt(this.time, this.zoneCenters);

    for (const b of this.bots) b.update(dt);

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.inPlane) {
        p.x = pp.x; p.y = pp.y;
        if (pp.k >= 1) this.eject(p);
        continue;
      }
      this.movePlayer(p, dt);
      if (p.z > 0) continue;
      this.updateCombat(p);
      this.autoPickup(p);
      // zona
      const dz = Math.hypot(p.x - this.zone.x, p.y - this.zone.y);
      if (dz > this.zone.r) this.damage(p, this.zone.dps * dt, null, 'zone');
    }

    this.updateBullets(dt);
    this.updateGrenades();
    this.checkEnd();
  }

  movePlayer(p, dt) {
    const falling = p.z > 0;
    let speed = falling ? FALL_HSPEED : PLAYER_SPEED;
    if (p.healUntil) speed *= HEAL_MOVE_FACTOR;
    const ox = p.x, oy = p.y;

    if (p.isBot) {
      const { mx, my } = p.input;
      const len = Math.hypot(mx, my);
      if (len > 0.01) { p.x += (mx / len) * speed * dt; p.y += (my / len) * speed * dt; }
    } else if (p.reqX !== null) {
      // movimento informado pelo cliente, limitado pela velocidade máxima
      p.moveBudget = Math.min(p.moveBudget + speed * dt * 1.4, speed * 0.6);
      const dx = p.reqX - p.x, dy = p.reqY - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= p.moveBudget) { p.x = p.reqX; p.y = p.reqY; p.moveBudget -= d; }
      else if (d > 0) {
        if (d - p.moveBudget > 3) p.correction = true;
        p.x += (dx / d) * p.moveBudget; p.y += (dy / d) * p.moveBudget; p.moveBudget = 0;
      }
    }

    if (falling) {
      p.z -= FALL_SPEED * dt;
      const lim = MAP_HALF - PLAYER_RADIUS;
      p.x = clamp(p.x, -lim, lim); p.y = clamp(p.y, -lim, lim);
      if (p.z <= 0) {
        p.z = 0;
        const bx = p.x, by = p.y;
        this.world.resolveCircle(p, PLAYER_RADIUS);
        if (Math.hypot(p.x - bx, p.y - by) > 0.01) p.correction = true;
        this.events.push({ e: 'ld', id: p.id });
      }
    } else {
      const bx = p.x, by = p.y;
      this.world.resolveCircle(p, PLAYER_RADIUS);
      if (!p.isBot && Math.hypot(p.x - bx, p.y - by) > 0.8) p.correction = true;
    }
    p.moving = Math.hypot(p.x - ox, p.y - oy) > speed * dt * 0.3;
  }

  updateCombat(p) {
    const t = this.time;
    if (p.reloadUntil && t >= p.reloadUntil) {
      p.reloadUntil = 0;
      const s = p.slots[p.cur];
      if (s) {
        const take = Math.min(WEAPONS[s.key].mag - s.mag, p.ammo);
        s.mag += take; p.ammo -= take;
      }
    }
    if (p.healUntil && t >= p.healUntil) {
      p.healUntil = 0;
      if (p.medkits > 0) { p.medkits--; p.hp = Math.min(MAX_HP, p.hp + MEDKIT_HEAL); this.events.push({ e: 'he', id: p.id }); }
    }
    if (!p.shootHeld || t < p.nextShot || p.reloadUntil) return;

    const s = p.slots[p.cur];
    const w = s ? WEAPONS[s.key] : WEAPONS.fist;
    if (w.melee) {
      p.nextShot = t + 1 / w.rate;
      p.healUntil = 0;
      this.melee(p, w);
      return;
    }
    if (s.mag <= 0) {
      p.nextShot = t + 0.3;
      if (p.ammo > 0) this.startReload(p);
      else this.events.push({ e: 'em', id: p.id });
      return;
    }
    p.healUntil = 0;
    p.nextShot = t + 1 / w.rate;
    s.mag--;
    const spread = w.spread * (p.moving ? 1.6 : 1);
    const shots = [];
    for (let i = 0; i < w.pellets; i++) {
      const a = p.aim + (this.rnd() - 0.5) * 2 * spread;
      const b = { id: this.nextId++, owner: p.id, x: p.x, y: p.y, dx: Math.cos(a), dy: Math.sin(a), speed: w.speed, left: w.range, dmg: w.dmg, w: s.key };
      this.bullets.push(b);
      shots.push([b.id, +a.toFixed(3)]);
    }
    this.events.push({ e: 's', id: p.id, w: s.key, x: +p.x.toFixed(2), y: +p.y.toFixed(2), b: shots });
    if (s.mag === 0 && p.ammo > 0) this.startReload(p);
  }

  melee(p, w) {
    let best = null, bd = w.range + HIT_RADIUS;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.inPlane || q.z > 0) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > bd) continue;
      let da = Math.atan2(dy, dx) - p.aim;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 1.0) continue;
      bd = d; best = q;
    }
    this.events.push({ e: 'm', id: p.id, hit: best ? best.id : null });
    if (best) {
      this.events.push({ e: 'h', b: 0, x: +best.x.toFixed(2), y: +best.y.toFixed(2), v: best.id, d: w.dmg, by: p.id });
      this.damage(best, w.dmg, p.id, 'fist');
    }
  }

  autoPickup(p) {
    for (const l of this.loot.values()) {
      if (Math.abs(l.x - p.x) > AUTO_PICKUP_RADIUS || Math.abs(l.y - p.y) > AUTO_PICKUP_RADIUS) continue;
      if (Math.hypot(l.x - p.x, l.y - p.y) <= AUTO_PICKUP_RADIUS) this.tryPickup(p, l, false);
    }
  }

  updateBullets(dt) {
    const keep = [];
    for (const b of this.bullets) {
      const step = Math.min(b.speed * dt, b.left);
      const sx = b.dx * step, sy = b.dy * step;
      const tObs = this.world.raycast(b.x, b.y, b.x + sx, b.y + sy);
      let tHit = tObs, victim = null;
      for (const q of this.players.values()) {
        if (!q.alive || q.inPlane || q.z > 0.5 || q.id === b.owner) continue;
        if (Math.abs(q.x - b.x) > step + 2 || Math.abs(q.y - b.y) > step + 2) continue;
        const t = rayCircle(b.x, b.y, sx, sy, q.x, q.y, HIT_RADIUS);
        if (t < tHit) { tHit = t; victim = q; }
      }
      const hx = b.x + sx * tHit, hy = b.y + sy * tHit;
      if (victim) {
        // dano cai um pouco com a distância percorrida (exceto sniper)
        const w = WEAPONS[b.w];
        const traveled = w.range - b.left;
        const falloff = b.w === 'sniper' ? 1 : 1 - 0.35 * clamp(traveled / w.range, 0, 1);
        const dmg = Math.max(1, Math.round(b.dmg * falloff));
        this.events.push({ e: 'h', b: b.id, x: +hx.toFixed(2), y: +hy.toFixed(2), v: victim.id, d: dmg, by: b.owner });
        this.damage(victim, dmg, b.owner, b.w);
        continue;
      }
      if (tObs < 1) {
        this.events.push({ e: 'bx', b: b.id, x: +hx.toFixed(2), y: +hy.toFixed(2) });
        continue;
      }
      b.x += sx; b.y += sy; b.left -= step;
      if (b.left > 0.01) keep.push(b);
    }
    this.bullets = keep;
  }

  updateGrenades() {
    const keep = [];
    for (const g of this.grenades) {
      if (this.time < g.at) { keep.push(g); continue; }
      this.events.push({ e: 'bm', id: g.id, x: +g.x.toFixed(2), y: +g.y.toFixed(2) });
      for (const q of this.players.values()) {
        if (!q.alive || q.inPlane || q.z > 0.5) continue;
        const d = Math.hypot(q.x - g.x, q.y - g.y);
        if (d > GRENADE.radius) continue;
        if (!this.world.lineOfSight(g.x, g.y, q.x, q.y)) continue;
        const dmg = Math.round(GRENADE.damage * (1 - (d / GRENADE.radius) * 0.7));
        this.events.push({ e: 'h', b: 0, x: +q.x.toFixed(2), y: +q.y.toFixed(2), v: q.id, d: dmg, by: g.owner });
        this.damage(q, dmg, g.owner, 'grenade');
      }
    }
    this.grenades = keep;
  }

  damage(p, amount, attackerId, cause) {
    if (!p.alive || amount <= 0) return;
    if (cause !== 'zone' && p.armor > 0) {
      const absorbed = Math.min(p.armor, amount * 0.6);
      p.armor -= absorbed;
      amount -= absorbed;
    }
    p.hp -= amount;
    if (attackerId && attackerId !== p.id) {
      p.lastAttacker = attackerId;
      const a = this.players.get(attackerId);
      if (a) a.dealt += amount;
    }
    if (p.hp <= 0) this.kill(p, attackerId, cause);
  }

  aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive) n++;
    return n;
  }

  kill(p, killerId, cause) {
    p.place = this.aliveCount();
    p.alive = false;
    p.hp = 0;
    p.shootHeld = false;
    p.healUntil = 0;
    p.reloadUntil = 0;
    const killer = killerId && killerId !== p.id ? this.players.get(killerId) : null;
    if (killer) killer.kills++;
    p.killedBy = killer ? killer.id : null;
    this.events.push({ e: 'k', k: killer ? killer.id : null, v: p.id, w: cause, n: p.place });
    if (p.inPlane) return;
    // derruba o inventário
    const drops = [];
    for (const s of p.slots) if (s) drops.push({ type: 'weapon', key: s.key, amount: s.mag });
    if (p.ammo > 0) drops.push({ type: 'ammo', amount: p.ammo });
    if (p.medkits > 0) drops.push({ type: 'medkit', amount: p.medkits });
    if (p.grenades > 0) drops.push({ type: 'grenade', amount: p.grenades });
    drops.forEach((d, i) => {
      const a = (i / Math.max(1, drops.length)) * Math.PI * 2 + this.r(0, 0.5);
      const pos = { x: p.x + Math.cos(a) * 1.3, y: p.y + Math.sin(a) * 1.3 };
      this.world.resolveCircle(pos, 0.3);
      this.addLoot({ ...d, ...pos });
    });
    p.slots = [null, null]; p.ammo = 0; p.medkits = 0; p.grenades = 0; p.armor = 0;
  }

  // jogador humano saiu no meio da partida
  removeHuman(id) {
    const p = this.players.get(id);
    if (p && p.alive) this.kill(p, null, 'leave');
    if (p) p.left = true;
  }

  checkEnd() {
    const alive = [...this.players.values()].filter((p) => p.alive);
    const humansAlive = alive.filter((p) => !p.isBot).length;
    if (alive.length <= 1 || (this.hadHumans && humansAlive === 0)) {
      this.over = true;
      this.overAt = this.time;
      // quem ainda está vivo é ordenado por abates e vida
      alive.sort((a, b) => b.kills - a.kills || b.hp - a.hp);
      alive.forEach((p, i) => { p.place = i + 1; });
      const winner = alive.length === 1 ? alive[0] : null;
      const standings = [...this.players.values()]
        .sort((a, b) => a.place - b.place)
        .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, place: p.place, kills: p.kills, dealt: Math.round(p.dealt) }));
      this.events.push({ e: 'over', winner: winner ? winner.id : null, standings });
    }
  }

  // ---------------------------------------------------------------- rede
  startInfo() {
    return {
      t: 'start',
      seed: this.seed,
      obstacles: this.map.obstacles,
      floors: this.map.floors,
      towns: this.map.towns,
      loot: [...this.loot.values()],
      plane: this.plane,
      zoneCenters: this.zoneCenters,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, skin: p.skin, isBot: p.isBot })),
    };
  }

  // parte comum do snapshot (igual para todos)
  snapshot() {
    const pp = this.planePos();
    const z = this.zone;
    const players = [];
    for (const p of this.players.values()) {
      if (!p.alive && p.deadSent) continue;
      if (!p.alive) p.deadSent = true;
      const s = p.slots[p.cur];
      const flags = (p.alive ? 1 : 0) | (p.inPlane ? 2 : 0) | (p.healUntil ? 4 : 0) | (p.reloadUntil ? 8 : 0) | (p.moving ? 16 : 0);
      players.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(1), +p.aim.toFixed(2), Math.ceil(p.hp), Math.ceil(p.armor), flags, WEAPON_KEYS.indexOf(s ? s.key : 'fist')]);
    }
    const ev = this.events;
    this.events = [];
    return {
      t: 's',
      time: +this.time.toFixed(2),
      plane: pp.k < 1 ? { x: +pp.x.toFixed(1), y: +pp.y.toFixed(1) } : null,
      zone: { x: +z.x.toFixed(2), y: +z.y.toFixed(2), r: +z.r.toFixed(2), nx: z.nx, ny: z.ny, nr: z.nr, sh: z.shrinking, tm: +z.timer.toFixed(1), ph: z.phase },
      alive: this.aliveCount(),
      players,
      ev,
    };
  }

  privateState(id) {
    const p = this.players.get(id);
    if (!p) return null;
    const out = {
      slots: p.slots.map((s) => (s ? { k: s.key, m: s.mag } : null)),
      cur: p.cur, ammo: p.ammo, med: p.medkits, gr: p.grenades, kills: p.kills,
      rl: p.reloadUntil ? +(p.reloadUntil - this.time).toFixed(2) : 0,
      hl: p.healUntil ? +(p.healUntil - this.time).toFixed(2) : 0,
      place: p.place, killedBy: p.killedBy,
    };
    if (p.correction) { out.corr = { x: p.x, y: p.y }; p.correction = false; }
    return out;
  }
}

export { WEAPON_KEYS };
