// IA dos bots. Cada tick produz o mesmo tipo de comando que um jogador humano
// (direção de movimento, mira, atirar e ações).

import { WEAPONS, MAX_AMMO, MAP_HALF, GRENADE, clamp } from '../shared/constants.js';

const DIFF = {
  easy:   { reaction: 0.85, aimErr: 0.16, view: 24, nade: 0.03, heal: 45 },
  normal: { reaction: 0.45, aimErr: 0.085, view: 30, nade: 0.07, heal: 55 },
  hard:   { reaction: 0.22, aimErr: 0.045, view: 36, nade: 0.14, heal: 65 },
};
const IDEAL = { fist: 0.9, pistol: 11, smg: 9, shotgun: 4.5, rifle: 17, sniper: 30 };
const AVOID_ANGLES = [0.45, 0.9, 1.35, 1.8, 2.3, 2.8];

function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

export class Bot {
  constructor(game, p, difficulty) {
    this.g = game;
    this.p = p;
    this.cfg = DIFF[difficulty] || DIFF.normal;
    this.jumpAt = game.r(0.1, 0.88);
    this.landTarget = null;
    this.thinkIn = game.r(0, 0.2);
    this.target = null;
    this.targetVisible = false;
    this.fireAt = 0;
    this.goal = null;
    this.ignored = new Map(); // lootId -> até quando ignorar
    this.wander = null;
    this.wanderUntil = 0;
    this.strafe = 1;
    this.strafeUntil = 0;
    this.aimErr = 0;
    this.aimErrUntil = 0;
    this.avoidSide = Math.random() < 0.5 ? 1 : -1;
    this.lastPos = { x: p.x, y: p.y };
    this.stuckCheckAt = 0;
    this.unstuckUntil = 0;
    this.unstuckAng = 0;
    this.lastHp = p.hp;
    this.threat = null;
    this.threatUntil = 0;
    this.wantsMove = false;
  }

  update(dt) {
    const p = this.p, g = this.g;
    p.input.mx = 0; p.input.my = 0;
    p.shootHeld = false;
    this.wantsMove = false;
    if (!p.alive || g.over) return;

    if (p.inPlane) {
      if (g.planePos().k >= this.jumpAt) g.act(p, 'jump');
      return;
    }
    if (p.z > 0) {
      if (!this.landTarget) this.landTarget = this.pickLanding();
      this.moveTo(this.landTarget.x, this.landTarget.y, false);
      return;
    }

    if (p.hp < this.lastHp - 0.5 && p.lastAttacker) {
      this.threat = p.lastAttacker;
      this.threatUntil = g.time + 3;
    }
    this.lastHp = p.hp;

    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = 0.2;
      this.decide();
    }
    this.behave();
    this.checkStuck();
  }

  pickLanding() {
    const g = this.g, p = this.p;
    const near = [...g.loot.values()].filter((l) => Math.hypot(l.x - p.x, l.y - p.y) < 70 && l.type === 'weapon');
    if (near.length && Math.random() < 0.85) {
      const l = near[Math.floor(Math.random() * near.length)];
      return { x: l.x + g.r(-3, 3), y: l.y + g.r(-3, 3) };
    }
    return { x: p.x + g.r(-40, 40), y: p.y + g.r(-40, 40) };
  }

  hasUsableGun() {
    const p = this.p;
    return p.slots.some((s) => s && (s.mag > 0 || p.ammo > 0));
  }

  safeCircle() {
    const z = this.g.zone;
    if (z.shrinking || z.timer < 22) return { x: z.nx, y: z.ny, r: z.nr };
    return { x: z.x, y: z.y, r: z.r };
  }

  decide() {
    const g = this.g, p = this.p, cfg = this.cfg;

    // percepção: inimigo visível mais próximo (prioriza quem está atirando nele)
    let best = null, bd = Infinity;
    for (const q of g.players.values()) {
      if (q === p || !q.alive || q.inPlane || q.z > 0.5) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      const range = q.id === this.threat && g.time < this.threatUntil ? cfg.view * 1.5 : cfg.view;
      if (d > range) continue;
      if (!g.world.lineOfSight(p.x, p.y, q.x, q.y)) continue;
      const score = q.id === this.threat ? d * 0.5 : d;
      if (score < bd) { bd = score; best = q; }
    }
    if (best !== this.target) {
      this.target = best;
      this.fireAt = g.time + cfg.reaction * g.r(0.7, 1.3);
    }
    this.targetVisible = !!best;

    // escolhe a melhor arma para a distância
    if (best && !p.reloadUntil) {
      const d = Math.hypot(best.x - p.x, best.y - p.y);
      let bi = -1, bs = -Infinity;
      p.slots.forEach((s, i) => {
        if (!s || (s.mag <= 0 && p.ammo <= 0)) return;
        const w = WEAPONS[s.key];
        const sc = w.rank * 2 - Math.abs(d - IDEAL[s.key]) / 6 + (s.mag > 0 ? 2 : 0) - (d > w.range ? 8 : 0);
        if (sc > bs) { bs = sc; bi = i; }
      });
      if (bi >= 0 && bi !== p.cur) g.act(p, 'slot', { i: bi });
      // granada
      if (p.grenades > 0 && d > 6 && d < GRENADE.maxThrow && Math.random() < cfg.nade) {
        g.act(p, 'nade', { tx: best.x + g.r(-1.5, 1.5), ty: best.y + g.r(-1.5, 1.5) });
      }
    }

    // objetivo de loot
    if (!this.target || !this.hasUsableGun()) this.goal = this.pickLoot();
    else this.goal = null;
  }

  lootScore(l) {
    const p = this.p;
    switch (l.type) {
      case 'weapon': {
        const w = WEAPONS[l.key];
        if (p.slots.some((s) => s && s.key === l.key)) return 0;
        if (p.slots.some((s) => !s)) return 12 + w.rank;
        const worst = Math.min(...p.slots.map((s) => WEAPONS[s.key].rank));
        return w.rank > worst ? 4 + (w.rank - worst) * 2 : 0;
      }
      case 'ammo':
        if (!p.slots.some((s) => s) || p.ammo >= MAX_AMMO - 10) return 0;
        return p.ammo < 40 ? 9 : p.ammo < 120 ? 5 : 1;
      case 'medkit': return p.medkits >= 3 ? 0 : p.hp < 60 ? 8 : 4;
      case 'armor': return p.armor < l.amount - 10 ? 7 : 0;
      case 'grenade': return p.grenades < 2 ? 3 : 0;
    }
    return 0;
  }

  pickLoot() {
    const g = this.g, p = this.p;
    const maxD = this.hasUsableGun() ? 35 : 60;
    const z = g.zone;
    let best = null, bs = 0;
    for (const l of g.loot.values()) {
      const d = Math.hypot(l.x - p.x, l.y - p.y);
      if (d > maxD) continue;
      const ig = this.ignored.get(l.id);
      if (ig && ig > g.time) continue;
      if (Math.hypot(l.x - z.x, l.y - z.y) > z.r - 2) continue;
      const s = this.lootScore(l);
      if (s <= 0) continue;
      const v = s / (d + 6);
      if (v > bs) { bs = v; best = l; }
    }
    return best;
  }

  behave() {
    const g = this.g, p = this.p;
    const z = g.zone;
    const distZone = Math.hypot(p.x - z.x, p.y - z.y);
    const outside = distZone > z.r - 1.5;
    const safe = this.safeCircle();
    const needZone = outside || Math.hypot(p.x - safe.x, p.y - safe.y) > Math.max(2, safe.r * 0.85);

    const t = this.target;
    if (t && t.alive) {
      const dx = t.x - p.x, dy = t.y - p.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const w = g.weaponOf(p);
      const key = p.slots[p.cur] ? p.slots[p.cur].key : 'fist';

      if (g.time > this.aimErrUntil) {
        this.aimErr = gauss() * this.cfg.aimErr * (t.moving ? 1.4 : 1) * (key === 'sniper' ? 0.5 : 1);
        this.aimErrUntil = g.time + 0.35;
      }
      p.aim = Math.atan2(dy, dx) + this.aimErr;

      const armed = this.hasUsableGun();
      if (!armed && this.goal && d > 4) {
        this.goTo(this.goal);
      } else if (outside) {
        this.moveTo(z.x, z.y);
      } else {
        const ideal = IDEAL[key];
        const radial = d > ideal + 2.5 ? 1 : d < ideal - 2.5 ? -1 : 0;
        if (g.time > this.strafeUntil) {
          this.strafe = Math.random() < 0.5 ? 1 : -1;
          this.strafeUntil = g.time + g.r(0.6, 1.8);
        }
        const mx = (radial * dx) / d + (this.strafe * 0.85 * -dy) / d;
        const my = (radial * dy) / d + (this.strafe * 0.85 * dx) / d;
        this.moveDir(mx, my);
      }
      const inRange = w.melee ? d <= w.range + 0.7 : d <= w.range * 0.95;
      if (this.targetVisible && inRange && g.time >= this.fireAt) p.shootHeld = true;
      return;
    }

    // sem alvo: curar, recarregar, zona, loot, passear
    if (p.healUntil) return; // parado curando
    if (p.hp < this.cfg.heal && p.medkits > 0 && !outside) { g.act(p, 'heal'); return; }
    const s = p.slots[p.cur];
    if (s && s.mag < WEAPONS[s.key].mag * 0.6 && p.ammo > 0 && !p.reloadUntil) g.act(p, 'reload');
    if (!s && p.slots[1 - p.cur]) g.act(p, 'slot', { i: 1 - p.cur });

    if (needZone && (outside || z.shrinking || z.timer < 22)) {
      this.moveTo(safe.x, safe.y);
      p.aim = Math.atan2(safe.y - p.y, safe.x - p.x);
      return;
    }
    if (this.goal && g.loot.has(this.goal.id)) {
      this.goTo(this.goal);
      return;
    }
    if (!this.wander || g.time > this.wanderUntil || Math.hypot(this.wander.x - p.x, this.wander.y - p.y) < 3) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * safe.r * 0.7;
      const lim = MAP_HALF - 4;
      this.wander = { x: clamp(safe.x + Math.cos(a) * r, -lim, lim), y: clamp(safe.y + Math.sin(a) * r, -lim, lim) };
      this.wanderUntil = g.time + 10;
    }
    this.moveTo(this.wander.x, this.wander.y);
    p.aim = Math.atan2(this.wander.y - p.y, this.wander.x - p.x);
  }

  goTo(l) {
    const g = this.g, p = this.p;
    const d = Math.hypot(l.x - p.x, l.y - p.y);
    if (!this.target) p.aim = Math.atan2(l.y - p.y, l.x - p.x);
    if (d < 1.4) {
      if (l.type === 'weapon' && p.slots[0] && p.slots[1]) {
        // troca a pior arma
        const worst = WEAPONS[p.slots[0].key].rank <= WEAPONS[p.slots[1].key].rank ? 0 : 1;
        if (p.cur !== worst) g.act(p, 'slot', { i: worst });
      }
      g.act(p, 'pickup', { id: l.id });
      if (g.loot.has(l.id)) this.ignored.set(l.id, g.time + 15);
      this.goal = null;
      return;
    }
    this.moveTo(l.x, l.y);
  }

  moveTo(x, y, avoid = true) {
    const dx = x - this.p.x, dy = y - this.p.y;
    if (Math.hypot(dx, dy) < 0.3) return;
    if (avoid) this.moveDir(dx, dy);
    else { this.p.input.mx = dx; this.p.input.my = dy; }
  }

  moveDir(dx, dy) {
    const p = this.p, g = this.g;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) return;
    this.wantsMove = true;
    if (g.time < this.unstuckUntil) {
      p.input.mx = Math.cos(this.unstuckAng); p.input.my = Math.sin(this.unstuckAng);
      return;
    }
    let ux = dx / len, uy = dy / len;
    if (!this.clear(ux, uy)) {
      let found = false;
      for (const a of AVOID_ANGLES) {
        for (const side of [this.avoidSide, -this.avoidSide]) {
          const c = Math.cos(a * side), s = Math.sin(a * side);
          const rx = ux * c - uy * s, ry = ux * s + uy * c;
          if (this.clear(rx, ry)) { ux = rx; uy = ry; this.avoidSide = side; found = true; break; }
        }
        if (found) break;
      }
      if (!found) { ux = -ux; uy = -uy; }
    }
    p.input.mx = ux; p.input.my = uy;
  }

  clear(ux, uy) {
    const p = this.p, w = this.g.world;
    const L = 2.2, o = 0.5;
    const px = -uy * o, py = ux * o;
    return w.raycast(p.x, p.y, p.x + ux * L, p.y + uy * L) >= 1 &&
      w.raycast(p.x + px, p.y + py, p.x + px + ux * L, p.y + py + uy * L) >= 1 &&
      w.raycast(p.x - px, p.y - py, p.x - px + ux * L, p.y - py + uy * L) >= 1;
  }

  checkStuck() {
    const g = this.g, p = this.p;
    if (g.time < this.stuckCheckAt) return;
    this.stuckCheckAt = g.time + 1;
    const moved = Math.hypot(p.x - this.lastPos.x, p.y - this.lastPos.y);
    this.lastPos = { x: p.x, y: p.y };
    if (this.wantsMove && moved < 1.2 && !p.healUntil) {
      this.unstuckUntil = g.time + 0.8;
      this.unstuckAng = Math.random() * Math.PI * 2;
      if (this.goal) { this.ignored.set(this.goal.id, g.time + 8); this.goal = null; }
      this.wander = null;
    }
  }
}

