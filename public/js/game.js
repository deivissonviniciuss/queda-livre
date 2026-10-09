// Partida no cliente: recebe snapshots do servidor, prevê o próprio movimento,
// calcula a mira (com assistência opcional) e desenha tudo.

import * as THREE from 'three';
import {
  WEAPONS, PLAYER_RADIUS, PLAYER_SPEED, HEAL_MOVE_FACTOR, FALL_HSPEED, PICKUP_RADIUS,
  PLANE_ALTITUDE, lootLabel, angleDiff, MAP_HALF, clamp,
} from '/shared/constants.js';
import { World } from '/shared/physics.js';
import { buildWorld, buildCharacter, buildPlane, buildLoot, ZoneView, Effects, setupLights } from './render.js';
import { Hud } from './hud.js';

const WEAPON_KEYS = ['fist', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper'];
const SEND_INTERVAL = 1 / 30;
const KICK = { pistol: 0.12, smg: 0.08, shotgun: 0.45, rifle: 0.14, sniper: 0.6 };
// tranco visual da arma na mão de cada personagem
const RECOIL = { pistol: 0.6, smg: 0.45, shotgun: 1, rifle: 0.55, sniper: 1.2 };
// quanto a mira abre a cada tiro (px)
const BLOOM = { pistol: 7, smg: 4, shotgun: 14, rifle: 5, sniper: 18 };
const CORPSE_TIME = 9;   // segundos que o corpo fica no chão
const FX_RANGE = 45;     // efeitos pequenos (cápsulas, poeira) só perto da câmera

export class ClientGame {
  constructor({ info, meId, renderer, net, input, sfx, settings, onLeave }) {
    this.info = info;
    this.meId = meId;
    this.renderer = renderer;
    this.net = net;
    this.input = input;
    this.sfx = sfx;
    this.settings = settings;
    this.onLeave = onLeave;

    this.scene = new THREE.Scene();
    this.lights = setupLights(this.scene);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 600);
    this.camPos = new THREE.Vector3(0, 80, 50);
    this.camLook = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);

    this.world = new World(info.obstacles);
    this.worldView = buildWorld(info);
    this.scene.add(this.worldView.root);
    this.zoneView = new ZoneView(this.scene);
    this.fx = new Effects(this.scene);
    this.planeMesh = buildPlane();
    this.planeMesh.rotation.y = -info.plane.ang;
    this.planeMesh.position.set(info.plane.x0, PLANE_ALTITUDE, info.plane.y0);
    this.scene.add(this.planeMesh);

    this.players = new Map();
    for (const p of info.players) this.addPlayer(p);
    this.loot = new Map();
    for (const l of info.loot) this.addLoot(l);

    this.local = null;          // posição prevista do próprio jogador
    this.me = null;             // estado privado (inventário)
    this.zone = null;
    this.plane = { x: info.plane.x0, y: info.plane.y0 };
    this.alive = info.players.length;
    this.time = 0;
    this.aim = 0;
    this.aimPoint = { x: 0, y: 0 };
    this.lock = null;
    this.shake = 0;
    this.camKick = new THREE.Vector2();
    this.fovPunch = 0;
    this.slowMo = 0;
    this.lastBoom = null;
    this.sendAcc = 0;
    this.dead = false;
    this.over = false;
    this.spectateId = null;
    this.lastZoneShrinking = false;
    this.lastZoneWarnPhase = -1;
    this.menuOpen = false;
    this.frameCount = 0;

    this.hud = new Hud(this);
    this.input.takePresses(); // descarta teclas apertadas no lobby
    this.input.active = true;
    this.input.enabled = true;
    document.body.classList.add('playing');
    this.sfx.planeDrone(true);
  }

  // ---------------------------------------------------------- entidades
  addPlayer(p) {
    const char = buildCharacter(p.color, p.skin, p.id);
    char.group.visible = false;
    this.scene.add(char.group);
    this.players.set(p.id, {
      ...p, char, x: this.info.plane.x0, y: this.info.plane.y0, z: 0, rx: 0, ry: 0, rz: 0,
      aim: 0, ra: 0, hp: 100, armor: 0, alive: true, inPlane: true, healing: false, reloading: false,
      moving: false, w: 'fist', walk: 0, label: null,
      kick: 0, hitT: 0, stepT: 0, trailT: 0, landedDust: false,
    });
  }

  addLoot(l) {
    const m = buildLoot(l);
    this.scene.add(m);
    this.loot.set(l.id, { l, m });
  }

  removeLoot(id) {
    const e = this.loot.get(id);
    if (!e) return;
    this.scene.remove(e.m);
    this.loot.delete(id);
  }

  get mePlayer() { return this.players.get(this.meId); }

  nameOf(id) {
    const p = this.players.get(id);
    return p ? p.name : '???';
  }

  // ------------------------------------------------------------- rede
  onSnapshot(s) {
    this.time = s.time;
    this.zone = s.zone;
    this.plane = s.plane;
    this.alive = s.alive;
    for (const [id, x, y, z, a, hp, ar, flags, wi] of s.players) {
      const p = this.players.get(id);
      if (!p) continue;
      const wasInPlane = p.inPlane;
      p.x = x; p.y = y; p.z = z; p.aim = a; p.hp = hp; p.armor = ar;
      p.alive = !!(flags & 1);
      p.inPlane = !!(flags & 2);
      p.healing = !!(flags & 4);
      p.reloading = !!(flags & 8);
      p.moving = !!(flags & 16);
      p.w = WEAPON_KEYS[wi] || 'fist';
      if (wasInPlane && !p.inPlane) { p.rx = x; p.ry = y; }
      if (id === this.meId) {
        if (p.inPlane || !p.alive) this.local = null;
        else if (!this.local) this.local = { x, y };
      }
    }
    if (s.me) {
      this.me = s.me;
      if (s.me.corr && this.local) { this.local.x = s.me.corr.x; this.local.y = s.me.corr.y; }
    }
    for (const e of s.ev) this.onEvent(e);

    const z = this.zone;
    if (z && z.sh && !this.lastZoneShrinking) { this.hud.toast('A zona está fechando!', '#d8b4fe'); this.sfx.zoneWarn(); }
    if (z && !z.sh && z.tm < 10 && this.lastZoneWarnPhase !== z.ph && z.r > 0) { this.lastZoneWarnPhase = z.ph; this.sfx.zoneWarn(); }
    this.lastZoneShrinking = z && z.sh;
  }

  onEvent(e) {
    const me = this.meId;
    switch (e.e) {
      case 's': {
        e.b.forEach(([id, a]) => this.fx.tracer(id, e.x, e.y, a, e.w, this.world));
        const a0 = e.b[0][1];
        this.fx.muzzle(e.x, e.y, a0, e.w === 'sniper' ? 1.9 : e.w === 'shotgun' ? 1.6 : 1.2, e.w === 'sniper' || e.w === 'shotgun');
        this.sfx.shot(e.w, e.x, e.y);
        const p = this.players.get(e.id);
        if (p) p.kick = RECOIL[e.w] || 0.5;
        if (this.nearFocus(e.x, e.y)) this.fx.casing(e.x, e.y, a0, e.w);
        if (e.id === me) {
          this.shake = Math.max(this.shake, (KICK[e.w] || 0.1) * 0.6);
          // a câmera é empurrada para trás, contra a direção do tiro
          const k = (KICK[e.w] || 0.1) * 1.4;
          this.camKick.x -= Math.cos(a0) * k;
          this.camKick.y -= Math.sin(a0) * k;
          this.hud.bloomKick(BLOOM[e.w] || 6);
        }
        break;
      }
      case 'm': {
        const p = this.players.get(e.id);
        if (p) { p.punchT = 0.25; this.sfx.punch(p.x, p.y); }
        break;
      }
      case 'h': {
        if (e.b) this.fx.endTracer(e.b, e.x, e.y, 'flesh');
        else this.fx.burst(e.x, 1.1, e.y, ['#dc2626', '#991b1b'], 6, 4, 0.4, 0.1);
        const victim = this.players.get(e.v);
        if (victim) victim.hitT = 0.14;
        if (e.v === me) {
          this.hud.hurt(); this.sfx.hurt(); this.shake = Math.max(this.shake, 0.25);
          // de onde veio o dano: o ponto da explosão (granada) ou a posição do atacante
          const boom = !e.b && this.lastBoom && performance.now() - this.lastBoom.t < 200 ? this.lastBoom : null;
          const src = boom || (e.by && e.by !== me ? this.players.get(e.by) : null);
          if (src) this.hud.damageFrom(boom ? boom.x : src.rx, boom ? boom.y : src.ry);
        }
        if (e.by === me && e.v !== me) {
          this.hud.hitMarker();
          this.hud.damageNumber(e.v, e.d);
          this.sfx.hitConfirm();
        } else this.sfx.impact(e.x, e.y);
        break;
      }
      case 'bx':
        this.fx.endTracer(e.b, e.x, e.y, 'wall');
        break;
      case 'k': {
        const v = this.players.get(e.v);
        if (v) {
          v.alive = false; v.deadT = 0; v.z = 0;
          // o corpo cai de costas, para longe de quem atirou, e escorrega um pouco
          const killer = e.k && this.players.get(e.k);
          v.fallAng = killer && killer !== v ? Math.atan2(killer.ry - v.ry, killer.rx - v.rx) : v.ra;
          v.ra = v.fallAng;
          v.slide = { x: v.rx, y: v.ry, dx: -Math.cos(v.fallAng), dy: -Math.sin(v.fallAng), d: e.w === 'shotgun' || e.w === 'sniper' || e.w === 'grenade' ? 1.4 : 0.7 };
          v.landedDust = false;
          if (!v.inPlane) this.fx.burst(v.x, 1.0, v.y, [v.color, '#dc2626', '#1f2937'], 22, 7, 0.9, 0.16);
        }
        this.hud.killFeed(e);
        if (e.k === me && e.v !== me) {
          this.hud.toast(`Você abateu ${this.nameOf(e.v)}!`, '#facc15'); this.sfx.killConfirm();
          this.fovPunch = 4;
        }
        if (e.v === me) this.onDeath(e);
        else if (this.dead && e.v === this.spectateId) this.spectateId = e.k && this.players.get(e.k)?.alive ? e.k : this.nextSpectate();
        break;
      }
      case 'la': this.addLoot(e.l); break;
      case 'lr':
        this.removeLoot(e.id);
        if (e.by === me) { this.sfx.pickup(); this.hud.pickupToast(e.t); }
        break;
      case 'j':
        if (e.id === me) { this.sfx.jump(); this.sfx.planeDrone(false); }
        break;
      case 'ld': {
        const p = this.players.get(e.id);
        if (p) { this.fx.dust(p.x, p.y); this.sfx.land(p.x, p.y); }
        break;
      }
      case 'rl': if (e.id === me) this.sfx.reload(); break;
      case 'he': if (e.id === me) this.sfx.heal(); break;
      case 'sw': if (e.id === me) this.sfx.swap(); break;
      case 'em': if (e.id === me) { this.sfx.empty(); this.hud.toast('Sem munição!', '#f87171'); } break;
      case 'nd':
        this.fx.grenade(e.id, e.x0, e.y0, e.x1, e.y1, e.fl);
        if (e.by === me) this.sfx.throwNade();
        break;
      case 'bm': {
        this.lastBoom = { x: e.x, y: e.y, t: performance.now() };
        this.fx.removeNade(e.id, e.x, e.y);
        this.fx.explosion(e.x, e.y);
        this.sfx.explosion(e.x, e.y);
        const f = this.focus();
        const d = Math.hypot(f.x - e.x, f.y - e.y);
        if (d < 30) this.shake = Math.max(this.shake, 0.9 * (1 - d / 30));
        break;
      }
      case 'over': this.onOver(e); break;
    }
  }

  onDeath(e) {
    this.dead = true;
    this.local = null;
    this.spectateId = e.k && this.players.get(e.k)?.alive ? e.k : this.nextSpectate();
    if (!this.over) {
      this.sfx.defeat();
      this.hud.showDeath(e);
    }
  }

  onOver(e) {
    this.over = true;
    this.winnerId = e.winner;
    // último abate em câmera lenta, e a câmera vai até o vencedor
    this.slowMo = 1.6;
    if (this.dead && e.winner) this.spectateId = e.winner;
    this.sfx.planeDrone(false);
    if (e.winner === this.meId) this.sfx.victory(); else if (!this.dead) this.sfx.defeat();
    this.hud.showFinal(e);
  }

  nearFocus(x, y) {
    return Math.abs(x - this.camLook.x) < FX_RANGE && Math.abs(y - this.camLook.z) < FX_RANGE;
  }

  nextSpectate() {
    const alive = [...this.players.values()].filter((p) => p.alive && p.id !== this.meId);
    if (!alive.length) return null;
    const humans = alive.filter((p) => !p.isBot);
    const list = humans.length ? humans : alive;
    const i = list.findIndex((p) => p.id === this.spectateId);
    return list[(i + 1) % list.length].id;
  }

  leave() {
    this.net.send({ t: 'leave' });
  }

  setMenu(open) {
    this.menuOpen = open;
    this.input.enabled = !open;
    this.hud.showMenu(open);
  }

  // ----------------------------------------------------------- comandos
  act(a, extra = {}) { this.net.send({ t: 'act', a, ...extra }); }

  handlePresses() {
    for (const p of this.input.takePresses()) {
      const meP = this.mePlayer;
      switch (p) {
        case 'menu': this.setMenu(!this.menuOpen); break;
        case 'map': this.hud.toggleBigMap(); break;
        case 'jump': if (meP && meP.inPlane && meP.alive) this.act('jump'); break;
        case 'pickup': {
          const l = this.nearestLoot();
          if (l) this.act('pickup', { id: l.id });
          break;
        }
        case 'reload': this.act('reload'); break;
        case 'heal': this.act('heal'); break;
        case 'swap': this.act('swap'); break;
        case 'slot0': this.act('slot', { i: 0 }); break;
        case 'slot1': this.act('slot', { i: 1 }); break;
        case 'nade':
          if (this.me && this.me.gr > 0) this.act('nade', { tx: this.aimPoint.x, ty: this.aimPoint.y });
          break;
      }
    }
  }

  nearestLoot() {
    if (!this.local) return null;
    let best = null, bd = PICKUP_RADIUS;
    for (const { l } of this.loot.values()) {
      const d = Math.hypot(l.x - this.local.x, l.y - this.local.y);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  currentWeaponKey() {
    if (!this.me) return 'fist';
    const s = this.me.slots[this.me.cur];
    return s ? s.k : 'fist';
  }

  // -------------------------------------------------------------- mira
  updateAim() {
    const origin = this.local;
    if (!origin) return { shoot: false };
    const pad = this.input.pad;
    let raw;
    if (this.input.usingPad && pad && Math.hypot(pad.ax, pad.ay) > 0.3) {
      raw = Math.atan2(pad.ay, pad.ax);
      this.aimPoint = { x: origin.x + Math.cos(raw) * 12, y: origin.y + Math.sin(raw) * 12 };
    } else if (this.input.usingPad && pad) {
      const mv = this.input.move();
      raw = Math.hypot(mv.x, mv.y) > 0.3 ? Math.atan2(mv.y, mv.x) : this.aim;
      this.aimPoint = { x: origin.x + Math.cos(raw) * 12, y: origin.y + Math.sin(raw) * 12 };
    } else {
      const ndc = new THREE.Vector2((this.input.mouse.x / innerWidth) * 2 - 1, -(this.input.mouse.y / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.aimPlane, hit)) {
        this.aimPoint = { x: hit.x, y: hit.z };
        raw = Math.atan2(hit.z - origin.y, hit.x - origin.x);
      } else raw = this.aim;
    }

    // mira assistida: trava no inimigo mais alinhado com a mira, dentro do alcance e com visão livre
    this.lock = null;
    const key = this.currentWeaponKey();
    const W = WEAPONS[key];
    const range = W.melee ? 3.5 : W.range;
    if (this.settings.assist) {
      let best = null, bestScore = Infinity;
      const cone = this.input.usingPad ? 0.5 : 0.32;
      for (const p of this.players.values()) {
        if (p.id === this.meId || !p.alive || p.inPlane || p.z > 0.5) continue;
        const dx = p.rx - origin.x, dy = p.ry - origin.y;
        const d = Math.hypot(dx, dy);
        if (d > range || d < 0.01) continue;
        const ang = Math.atan2(dy, dx);
        const tol = Math.max(cone, Math.atan(1.6 / d));
        const diff = Math.abs(angleDiff(ang, raw));
        if (diff > tol) continue;
        if (!this.world.lineOfSight(origin.x, origin.y, p.rx, p.ry)) continue;
        const score = diff + d * 0.004;
        if (score < bestScore) { bestScore = score; best = { p, d }; }
      }
      if (best) {
        const { p, d } = best;
        // antecipa o movimento do alvo pelo tempo de voo do projétil
        const tof = W.speed ? d / W.speed : 0;
        const lx = p.rx + (p.vx || 0) * tof, ly = p.ry + (p.vy || 0) * tof;
        raw = Math.atan2(ly - origin.y, lx - origin.x);
        this.lock = p;
      }
    }
    this.aim = raw;

    let shoot = this.input.firing();
    if (this.settings.autofire && this.lock && !this.menuOpen) {
      const s = this.me && this.me.slots[this.me.cur];
      if (W.melee || (s && s.m > 0)) shoot = true;
    }
    return { shoot: !!shoot && this.input.enabled };
  }

  // ------------------------------------------------------------- frame
  frame(dt) {
    this.frameCount++;
    // câmera lenta no fim da partida: só os efeitos e animações desaceleram
    let gdt = dt;
    if (this.slowMo > 0) {
      this.slowMo -= dt;
      gdt = dt * (this.slowMo > 0.5 ? 0.25 : 0.25 + (0.5 - Math.max(0, this.slowMo)) * 1.5);
    }
    this.input.pollPad();
    this.handlePresses();

    const meP = this.mePlayer;
    const { shoot } = this.updateAim();

    // movimento local (previsão)
    if (this.local && meP && meP.alive && !meP.inPlane) {
      const mv = this.input.enabled ? this.input.move() : { x: 0, y: 0 };
      const falling = meP.z > 0;
      const speed = falling ? FALL_HSPEED : PLAYER_SPEED * (this.me && this.me.hl > 0 ? HEAL_MOVE_FACTOR : 1);
      this.local.x += mv.x * speed * dt;
      this.local.y += mv.y * speed * dt;
      if (!falling) this.world.resolveCircle(this.local, PLAYER_RADIUS);
      else {
        const lim = MAP_HALF - PLAYER_RADIUS;
        this.local.x = clamp(this.local.x, -lim, lim);
        this.local.y = clamp(this.local.y, -lim, lim);
      }
    }

    this.sendAcc += dt;
    if (this.sendAcc >= SEND_INTERVAL && meP && meP.alive) {
      this.sendAcc = 0;
      const msg = { t: 'input', a: +this.aim.toFixed(3), s: shoot && !meP.inPlane };
      if (this.local) { msg.x = +this.local.x.toFixed(3); msg.y = +this.local.y.toFixed(3); }
      this.net.send(msg);
    }

    this.updatePlayers(gdt);
    this.updateLoot(dt);

    if (this.plane) {
      this.planeMesh.visible = true;
      this.planeMesh.position.set(this.plane.x, PLANE_ALTITUDE, this.plane.y);
    } else {
      this.planeMesh.position.x += Math.cos(this.info.plane.ang) * 22 * dt;
      this.planeMesh.position.z += Math.sin(this.info.plane.ang) * 22 * dt;
      if (Math.abs(this.planeMesh.position.x) > 200 || Math.abs(this.planeMesh.position.z) > 200) this.planeMesh.visible = false;
      if (meP && meP.inPlane === false) this.sfx.planeDrone(false);
    }
    if (this.zone) this.zoneView.update(this.zone);
    this.fx.update(gdt);

    const f = this.focus();
    this.sfx.listener = { x: f.x, y: f.y };
    if (this.frameCount % 3 === 0) this.worldView.fadeNear([{ x: f.x, y: f.y }]);
    this.updateCamera(dt, f);
    this.lights.follow(f.x, f.y);
    this.hud.update(dt);

    this.renderer.render(this.scene, this.camera);
  }

  updatePlayers(dt) {
    const k = Math.min(1, dt * 14);
    for (const p of this.players.values()) {
      const isMe = p.id === this.meId;
      const px = p.rx, py = p.ry;
      if (isMe && this.local) { p.rx = this.local.x; p.ry = this.local.y; }
      else if (p.inPlane && this.plane) { p.rx = this.plane.x; p.ry = this.plane.y; }
      else { p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k; }
      p.rz += (p.z - p.rz) * Math.min(1, dt * 10);
      // velocidade estimada (usada pela mira assistida)
      if (dt > 0) {
        p.vx = (p.vx || 0) * 0.8 + ((p.rx - px) / dt) * 0.2;
        p.vy = (p.vy || 0) * 0.8 + ((p.ry - py) / dt) * 0.2;
      }
      const targetAim = isMe && this.local ? this.aim : p.aim;
      p.ra += angleDiff(targetAim, p.ra) * Math.min(1, dt * 20);

      const c = p.char;
      if (!p.alive) { this.updateCorpse(p, dt); continue; }
      c.group.visible = !p.inPlane;
      if (!c.group.visible) { this.hud.hideLabel(p); continue; }
      c.group.position.set(p.rx, p.rz, p.ry);
      c.body.rotation.y = -p.ra;
      const falling = p.rz > 0.3;
      c.parachute.visible = falling;
      c.parachute.rotation.y = -p.ra;
      c.setWeapon(p.w);
      const near = this.nearFocus(p.rx, p.ry);
      const speed = Math.hypot(p.vx || 0, p.vy || 0);
      if (speed > 1 && !falling) {
        p.walk += dt * 13;
        const s = Math.sin(p.walk) * 0.6;
        c.legs[0].rotation.z = s; c.legs[1].rotation.z = -s;
        c.body.position.y = Math.abs(Math.cos(p.walk)) * 0.06;
        // inclina o corpo na direção em que corre
        c.group.rotation.x = clamp((p.vy || 0) * 0.012, -0.09, 0.09);
        c.group.rotation.z = clamp(-(p.vx || 0) * 0.012, -0.09, 0.09);
        p.stepT -= dt;
        if (p.stepT <= 0 && near) { p.stepT = 0.26; this.fx.step(p.rx, p.ry); }
      } else {
        c.legs[0].rotation.z *= 0.8; c.legs[1].rotation.z *= 0.8;
        c.group.rotation.x *= 0.85; c.group.rotation.z *= 0.85;
        c.body.position.y = falling ? 0 : Math.sin(performance.now() / 400) * 0.015;
      }
      if (falling) {
        // pernas balançando e o paraquedas oscilando com o vento
        const t = performance.now() / 1000 + p.ra;
        c.legs[0].rotation.z = Math.sin(t * 3) * 0.25; c.legs[1].rotation.z = Math.sin(t * 3 + 1.2) * 0.25;
        c.parachute.rotation.z = Math.sin(t * 1.3) * 0.06;
        p.trailT -= dt;
        if (p.trailT <= 0 && near) {
          p.trailT = 0.05;
          const a = -p.ra;
          for (const side of [1, -1]) this.fx.trail(p.rx + Math.sin(a) * 1.7 * side, p.rz + 3.2, p.ry + Math.cos(a) * 1.7 * side);
        }
      }
      // tranco da arma ao atirar: recua e levanta o cano
      p.kick *= Math.exp(-dt * 16);
      let gx = 0.46 - p.kick * 0.22;
      if (p.punchT > 0) {
        p.punchT -= dt;
        gx += Math.sin((1 - p.punchT / 0.25) * Math.PI) * 0.45;
      }
      c.gunMount.position.x = gx;
      // inclina levemente ao curar/recarregar
      c.gunMount.rotation.z = (p.reloading ? -0.6 : p.healing ? 0.8 : 0) + p.kick * 0.32;
      c.body.rotation.z = p.kick * 0.05;
      // "amassa" um instante ao levar dano
      if (p.hitT > 0) {
        p.hitT -= dt;
        const k = Math.sin((Math.max(0, p.hitT) / 0.14) * Math.PI);
        c.body.scale.set(1 + k * 0.14, 1 - k * 0.1, 1 + k * 0.14);
      } else c.body.scale.set(1, 1, 1);
      this.hud.label(p, isMe);
    }
  }

  // corpo cai de costas, quica, fica no chão e afunda antes de sumir
  updateCorpse(p, dt) {
    const c = p.char;
    this.hud.hideLabel(p);
    if (p.deadT === undefined) p.deadT = CORPSE_TIME;
    p.deadT += dt;
    const t = p.deadT;
    if (p.inPlane || t > CORPSE_TIME) { c.group.visible = false; return; }
    c.group.visible = true;
    c.parachute.visible = false;
    c.gunMount.visible = false;
    c.body.scale.set(1, 1, 1);
    c.body.rotation.y = -p.ra;
    c.group.rotation.set(0, 0, 0);
    let ang;
    if (t < 0.38) ang = (Math.PI / 2) * (t / 0.38) ** 2;
    else ang = Math.PI / 2 - Math.sin(Math.min(1, (t - 0.38) / 0.3) * Math.PI) * 0.18 * Math.exp(-(t - 0.38) * 3);
    c.body.rotation.z = ang;
    c.body.position.y = 0.24 * Math.min(1, t / 0.38);
    c.legs[0].rotation.z = 0.25; c.legs[1].rotation.z = -0.1;
    const sl = p.slide;
    const k = sl ? 1 - (1 - Math.min(1, t / 0.4)) ** 2 : 0;
    const x = sl ? sl.x + sl.dx * sl.d * k : p.rx, y = sl ? sl.y + sl.dy * sl.d * k : p.ry;
    const sink = t > CORPSE_TIME - 1.2 ? (t - (CORPSE_TIME - 1.2)) * 0.6 : 0;
    c.group.position.set(x, -sink, y);
    if (!p.landedDust && t >= 0.38) {
      p.landedDust = true;
      if (this.nearFocus(x, y)) this.fx.dust(x - Math.cos(p.ra) * 1.2, y - Math.sin(p.ra) * 1.2, 6);
    }
  }

  updateLoot(dt) {
    const t = performance.now() / 1000;
    for (const { m } of this.loot.values()) {
      const item = m.userData.item;
      item.rotation.y = t * 1.2 + m.userData.phase;
      item.position.y = 0.5 + Math.sin(t * 2.4 + m.userData.phase) * 0.1;
    }
  }

  focus() {
    const meP = this.mePlayer;
    if (meP && meP.alive) {
      if (meP.inPlane && this.plane) return { x: this.plane.x, y: this.plane.y, z: PLANE_ALTITUDE, plane: true };
      if (this.local) return { x: this.local.x, y: this.local.y, z: meP.rz };
      return { x: meP.rx, y: meP.ry, z: meP.rz };
    }
    const s = this.spectateId && this.players.get(this.spectateId);
    if (s && s.alive) {
      if (s.inPlane && this.plane) return { x: this.plane.x, y: this.plane.y, z: PLANE_ALTITUDE, plane: true };
      return { x: s.rx, y: s.ry, z: s.rz };
    }
    return meP ? { x: meP.rx, y: meP.ry, z: 0 } : { x: 0, y: 0, z: 0 };
  }

  updateCamera(dt, f) {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (this.camera.aspect !== w / h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    const key = this.currentWeaponKey();
    let H = 25;
    if (f.plane) H = 95;
    else if (f.z > 0.3) H = 25 + f.z * 1.0;
    else if (key === 'sniper' && !this.dead) H = 42;
    // fim de partida: câmera desce até o vencedor
    if (this.over && this.winnerId && this.players.get(this.winnerId)?.alive) H = 15;

    // olha um pouco para onde a mira aponta
    let lx = f.x, ly = f.y;
    if (!f.plane && this.local && !this.dead) {
      const look = key === 'sniper' ? 9 : 4;
      lx += Math.cos(this.aim) * look;
      ly += Math.sin(this.aim) * look * 0.8;
    }
    const target = new THREE.Vector3(lx, H, ly + H * 0.62);
    const k = Math.min(1, dt * (f.plane ? 3 : 8));
    this.camPos.lerp(target, k);
    this.camLook.lerp(new THREE.Vector3(lx, 0, ly), k);
    this.camera.position.copy(this.camPos);
    this.camera.position.x += this.camKick.x;
    this.camera.position.z += this.camKick.y;
    this.camKick.multiplyScalar(Math.exp(-dt * 12));
    if (this.fovPunch > 0.01 || this.camera.fov !== 50) {
      this.fovPunch *= Math.exp(-dt * 6);
      this.camera.fov = 50 - (this.fovPunch > 0.01 ? this.fovPunch : 0);
      this.camera.updateProjectionMatrix();
    }
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.0005, dt);
    }
    this.camera.lookAt(this.camLook);
  }

  destroy() {
    this.input.enabled = false;
    this.input.active = false;
    this.input.mouse.down = false;
    this.sfx.planeDrone(false);
    document.body.classList.remove('playing');
    this.hud.destroy();
    // libera a memória da GPU; geometrias/materiais compartilhados são
    // reenviados automaticamente pelo three.js se forem usados de novo
    this.scene.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    });
    this.renderer.renderLists.dispose();
  }
}
