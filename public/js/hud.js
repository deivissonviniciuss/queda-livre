// Interface sobre o jogo (DOM) e minimapa (canvas 2D).

import * as THREE from 'three';
import { WEAPONS, MAP_HALF, MAX_HP, MAX_ARMOR, MEDKIT_TIME, lootLabel, LOOT_NAMES } from '/shared/constants.js';

const $ = (id) => document.getElementById(id);
const CAUSE = { fist: 'Soco', grenade: 'Granada', zone: 'Zona', leave: 'Saiu' };
const causeName = (w) => CAUSE[w] || (WEAPONS[w] ? WEAPONS[w].name : w);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  constructor(game) {
    this.g = game;
    this.abort = new AbortController();
    const sig = { signal: this.abort.signal };
    this.root = $('hud');
    this.root.hidden = false;
    this.labelsEl = $('labels');
    this.labelsEl.innerHTML = '';
    $('killfeed').innerHTML = '';
    for (const id of ['death', 'final', 'menu']) $(id).hidden = true;
    $('minimap-wrap').classList.remove('big');
    this.labels = new Map();
    this.cache = {};
    this.hurtLevel = 0;
    this.hitT = 0;
    this.toastTimer = null;
    this.v = new THREE.Vector3();
    this.mmCtx = $('minimap').getContext('2d');
    this.staticMap = this.buildStaticMap();
    this.finalTimer = null;

    $('btn-spectate').addEventListener('click', () => { $('death').hidden = true; }, sig);
    $('btn-leave').addEventListener('click', () => game.leave(), sig);
    $('btn-final-leave').addEventListener('click', () => game.leave(), sig);
    $('btn-resume').addEventListener('click', () => game.setMenu(false), sig);
    $('btn-quit').addEventListener('click', () => game.leave(), sig);
    for (const [id, key] of [['m-assist', 'assist'], ['m-autofire', 'autofire']]) {
      const el = $(id);
      el.checked = !!game.settings[key];
      el.addEventListener('change', () => { game.settings[key] = el.checked; game.settings.save(); }, sig);
    }
    $('scene').addEventListener('mousedown', () => {
      if (game.dead && !game.over && $('death').hidden) game.spectateId = game.nextSpectate();
    }, sig);
  }

  destroy() {
    this.abort.abort();
    clearInterval(this.finalTimer);
    this.root.hidden = true;
    this.labelsEl.innerHTML = '';
    for (const id of ['death', 'final', 'menu']) $(id).hidden = true;
  }

  set(id, prop, value) {
    const k = id + prop;
    if (this.cache[k] === value) return;
    this.cache[k] = value;
    const el = $(id);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'width') el.style.width = value;
    else if (prop === 'class') el.className = value;
  }

  // ------------------------------------------------------------ minimapa
  toPx(v, size) { return ((v + MAP_HALF + 8) / (MAP_HALF * 2 + 16)) * size; }

  buildStaticMap() {
    const size = 360;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const P = (v) => this.toPx(v, size);
    const s = size / (MAP_HALF * 2 + 16);
    x.fillStyle = '#1e88b8'; x.fillRect(0, 0, size, size);
    x.fillStyle = '#e8d39a'; x.fillRect(P(-MAP_HALF - 5), P(-MAP_HALF - 5), (MAP_HALF * 2 + 10) * s, (MAP_HALF * 2 + 10) * s);
    x.fillStyle = '#69b450'; x.fillRect(P(-MAP_HALF), P(-MAP_HALF), MAP_HALF * 2 * s, MAP_HALF * 2 * s);
    for (const f of this.g.info.floors) { x.fillStyle = '#b69a7a'; x.fillRect(P(f.x - f.w / 2), P(f.y - f.h / 2), f.w * s, f.h * s); }
    for (const o of this.g.info.obstacles) {
      if (o.s === 'b') {
        x.fillStyle = o.k === 'crate' ? '#8a5a2b' : o.k === 'cover' ? '#6b7280' : '#475569';
        x.fillRect(P(o.x - o.hw), P(o.y - o.hh), Math.max(1, o.hw * 2 * s), Math.max(1, o.hh * 2 * s));
      } else {
        x.fillStyle = o.k === 'tree' ? '#2f7d3e' : '#8b929b';
        x.beginPath(); x.arc(P(o.x), P(o.y), Math.max(1.2, (o.k === 'tree' ? 1.4 : o.r) * s), 0, Math.PI * 2); x.fill();
      }
    }
    x.font = '700 13px "Barlow Condensed", sans-serif';
    x.textAlign = 'center';
    for (const t of this.g.info.towns) {
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fillText(t.name, P(t.x) + 1, P(t.y) - 22 + 1);
      x.fillStyle = '#fff'; x.fillText(t.name, P(t.x), P(t.y) - 22);
    }
    return c;
  }

  drawMinimap() {
    const x = this.mmCtx, size = 360, g = this.g;
    const P = (v) => this.toPx(v, size);
    const s = size / (MAP_HALF * 2 + 16);
    x.drawImage(this.staticMap, 0, 0);
    const z = g.zone;
    if (z) {
      // escurece fora da zona
      x.save();
      x.beginPath(); x.rect(0, 0, size, size); x.arc(P(z.x), P(z.y), Math.max(0, z.r * s), 0, Math.PI * 2, true);
      x.fillStyle = 'rgba(109, 40, 217, .38)'; x.fill();
      x.restore();
      x.strokeStyle = '#c084fc'; x.lineWidth = 2;
      x.beginPath(); x.arc(P(z.x), P(z.y), Math.max(0, z.r * s), 0, Math.PI * 2); x.stroke();
      if (z.nr < z.r - 0.5) {
        x.setLineDash([5, 4]); x.strokeStyle = '#fff';
        x.beginPath(); x.arc(P(z.nx), P(z.ny), Math.max(0, z.nr * s), 0, Math.PI * 2); x.stroke();
        x.setLineDash([]);
      }
    }
    const pl = g.info.plane;
    if (g.plane) {
      x.strokeStyle = 'rgba(255,255,255,.7)'; x.setLineDash([3, 4]); x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(P(pl.x0), P(pl.y0)); x.lineTo(P(pl.x1), P(pl.y1)); x.stroke(); x.setLineDash([]);
      x.fillStyle = '#fff';
      x.beginPath(); x.arc(P(g.plane.x), P(g.plane.y), 4, 0, Math.PI * 2); x.fill();
    }
    const f = g.focus();
    // seta do jogador
    x.save();
    x.translate(P(f.x), P(f.y));
    x.rotate(g.dead ? 0 : g.aim);
    x.fillStyle = g.dead ? '#94a3b8' : '#facc15'; x.strokeStyle = '#000'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(8, 0); x.lineTo(-6, 5); x.lineTo(-3, 0); x.lineTo(-6, -5); x.closePath(); x.fill(); x.stroke();
    x.restore();
  }

  toggleBigMap() { $('minimap-wrap').classList.toggle('big'); }

  // -------------------------------------------------------------- labels
  project(x, y, z) {
    this.v.set(x, y, z).project(this.g.camera);
    if (this.v.z > 1) return null;
    return { x: (this.v.x * 0.5 + 0.5) * innerWidth, y: (-this.v.y * 0.5 + 0.5) * innerHeight };
  }

  label(p, isMe) {
    if (isMe) return;
    let el = this.labels.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'nametag' + (p.isBot ? ' bot' : '');
      el.innerHTML = `<div class="nm"></div><div class="hpb"><i></i></div>`;
      el.querySelector('.nm').textContent = p.name;
      el.querySelector('.nm').style.color = p.isBot ? '' : p.color;
      this.labelsEl.appendChild(el);
      el._fill = el.querySelector('.hpb i');
      this.labels.set(p.id, el);
    }
    const s = this.project(p.rx, p.rz + 2.5, p.ry);
    if (!s || s.x < -50 || s.y < -50 || s.x > innerWidth + 50 || s.y > innerHeight + 50) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
    const w = Math.max(0, Math.min(100, p.hp)) + '%';
    if (el._w !== w) { el._fill.style.width = w; el._w = w; }
  }

  hideLabel(p) {
    const el = this.labels.get(p.id);
    if (el) el.style.display = 'none';
  }

  damageNumber(id, d) {
    const p = this.g.players.get(id);
    if (!p) return;
    const s = this.project(p.rx + (Math.random() - 0.5) * 0.8, p.rz + 2.0, p.ry);
    if (!s) return;
    const el = document.createElement('div');
    el.className = 'dmgnum' + (d >= 40 ? ' big' : '');
    el.textContent = d;
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    this.labelsEl.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  hitMarker() { this.hitT = 0.15; }
  hurt() { this.hurtLevel = Math.min(1, this.hurtLevel + 0.55); }

  toast(text, color = '#facc15') {
    const el = $('toast');
    el.textContent = text;
    el.style.color = color;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  pickupToast(type) {
    if (type === 'weapon') return; // a arma nova já aparece no slot
    this.toast('+ ' + LOOT_NAMES[type], '#e2e8f0');
  }

  killFeed(e) {
    const g = this.g;
    const el = document.createElement('div');
    el.className = 'kf' + (e.k === g.meId || e.v === g.meId ? ' me' : '');
    const victim = document.createElement('span');
    victim.textContent = g.nameOf(e.v);
    if (e.k) {
      const killer = document.createElement('span');
      killer.textContent = g.nameOf(e.k);
      el.append(killer);
    }
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = e.k ? `[${causeName(e.w)}]` : e.w === 'zone' ? 'morreu na zona' : 'saiu';
    el.append(w, victim);
    const feed = $('killfeed');
    feed.prepend(el);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 600); }, 6000);
  }

  // ------------------------------------------------------------ overlays
  showDeath(e) {
    const g = this.g;
    $('death-place').textContent = `#${e.n}`;
    $('death-by').textContent = e.k ? `Abatido por ${g.nameOf(e.k)} (${causeName(e.w)})` : e.w === 'zone' ? 'Eliminado pela zona' : 'Fora da partida';
    const kills = g.me ? g.me.kills : 0;
    $('death-stats').innerHTML = `<div><b>${kills}</b>abates</div><div><b>${fmt(g.time)}</b>sobreviveu</div><div><b>${g.players.size}</b>combatentes</div>`;
    $('death').hidden = false;
  }

  showFinal(e) {
    const g = this.g;
    $('death').hidden = true;
    const meRow = e.standings.find((s) => s.id === g.meId);
    const won = e.winner === g.meId;
    $('final-kicker').textContent = won ? 'Vitória' : 'Fim de partida';
    $('final-title').textContent = won ? 'ÚLTIMO DE PÉ!' : meRow ? `#${meRow.place}` : 'FIM';
    $('final-sub').textContent = won
      ? `${meRow.kills} abate${meRow.kills === 1 ? '' : 's'}. Ninguém segurou você.`
      : e.winner ? `Vencedor: ${g.nameOf(e.winner)}` : 'Todos os jogadores humanos caíram.';
    const ol = $('final-standings');
    ol.innerHTML = '';
    const rows = e.standings.slice(0, 8);
    if (meRow && !rows.includes(meRow)) rows.push(meRow);
    for (const s of rows) {
      const li = document.createElement('li');
      if (s.id === g.meId) li.className = 'me';
      li.innerHTML = `<span class="pos">#${s.place}</span><span class="nm"></span><span class="st">${s.kills} abates · ${s.dealt} dano</span>`;
      li.querySelector('.nm').textContent = s.name + (s.isBot ? ' 🤖' : '');
      ol.appendChild(li);
    }
    let left = 9;
    $('final-foot').textContent = `Voltando ao lobby em ${left}s`;
    clearInterval(this.finalTimer);
    this.finalTimer = setInterval(() => {
      left = Math.max(0, left - 1);
      $('final-foot').textContent = `Voltando ao lobby em ${left}s`;
    }, 1000);
    $('final').hidden = false;
  }

  showMenu(open) {
    $('menu').hidden = !open;
    $('m-assist').checked = !!this.g.settings.assist;
    $('m-autofire').checked = !!this.g.settings.autofire;
  }

  // -------------------------------------------------------------- update
  update(dt) {
    const g = this.g;
    const meP = g.mePlayer;
    const me = g.me;

    this.set('h-alive', 'text', String(g.alive));
    this.set('h-kills', 'text', String(me ? me.kills : 0));

    const z = g.zone;
    if (z) {
      let txt;
      if (z.r <= 0.01) txt = 'Zona final';
      else if (z.sh) txt = `Zona fechando · ${fmt(z.tm)}`;
      else txt = `Zona fecha em ${fmt(z.tm)}`;
      this.set('h-zone', 'text', txt);
      this.set('h-zone-pill', 'class', 'pill zone' + (z.sh || z.tm < 10 ? ' warn' : ''));
    }

    // mensagem central
    let center = '';
    if (meP && meP.alive && meP.inPlane) {
      center = g.input.usingPad ? 'Aperte A para saltar' : 'Aperte ESPAÇO para saltar';
      center += '<small>Escolha onde pousar pelo minimapa. No fim da rota você salta sozinho.</small>';
    } else if (meP && meP.alive && meP.rz > 0.3) {
      center = `${Math.ceil(meP.rz)} m<small>Use ${g.input.usingPad ? 'o analógico' : 'W A S D'} para planar até o pouso</small>`;
    } else if (g.dead && !g.over) {
      const s = g.spectateId && g.players.get(g.spectateId);
      if (s && s.alive && $('death').hidden) center = `<small>Assistindo</small>${escapeHtml(s.name)}<small>Clique para trocar de jogador</small>`;
    }
    this.set('center-msg', 'html', center);

    // vida e colete
    if (meP) {
      const hp = Math.max(0, meP.hp), ar = Math.max(0, meP.armor);
      this.set('hp-fill', 'width', (hp / MAX_HP) * 100 + '%');
      this.set('hp-txt', 'text', String(Math.ceil(hp)));
      this.set('armor-fill', 'width', (ar / MAX_ARMOR) * 100 + '%');
      const hpBar = $('hp-fill').parentElement;
      hpBar.classList.toggle('low', hp < 30);
    }

    // armas e itens
    if (me) {
      for (let i = 0; i < 2; i++) {
        const s = me.slots[i];
        const id = 'slot' + i;
        this.set(id, 'class', 'slot' + (me.cur === i ? ' on' : '') + (s ? '' : ' empty'));
        const el = $(id);
        const name = s ? WEAPONS[s.k].name : 'Vazio';
        const ammo = s ? `${s.m}<em> / ${me.ammo}</em>` : '';
        if (el._n !== name) { el.querySelector('.wname').textContent = name; el._n = name; }
        if (el._a !== ammo) { el.querySelector('.ammo').innerHTML = ammo; el._a = ammo; }
        el.style.borderLeftColor = s ? WEAPONS[s.k].color : '';
      }
      this.set('it-med', 'html', `<kbd>Q</kbd><span>✚</span><b>${me.med}</b>`);
      this.set('it-nade', 'html', `<kbd>G</kbd><span>●</span><b>${me.gr}</b>`);
      this.set('it-ammo', 'html', `<span>⁍</span><b>${me.ammo}</b>`);

      // barra de progresso (recarregar / curar)
      const prog = $('progress');
      if (me.rl > 0) {
        const s = me.slots[me.cur];
        const total = s ? WEAPONS[s.k].reload : 1;
        prog.hidden = false;
        this.set('progress-lbl', 'text', 'Recarregando…');
        this.set('progress-fill', 'width', Math.round((1 - me.rl / total) * 100) + '%');
      } else if (me.hl > 0) {
        prog.hidden = false;
        this.set('progress-lbl', 'text', 'Usando kit médico…');
        this.set('progress-fill', 'width', Math.round((1 - me.hl / MEDKIT_TIME) * 100) + '%');
      } else prog.hidden = true;
    }

    // aviso de pegar item
    let prompt = '';
    if (meP && meP.alive && !meP.inPlane && meP.rz < 0.3 && me) {
      const l = g.nearestLoot();
      if (l) {
        const key = g.input.usingPad ? 'A' : 'E';
        const full = l.type === 'weapon' && me.slots[0] && me.slots[1];
        const cur = me.slots[me.cur];
        prompt = full && cur ? `[${key}] Trocar ${WEAPONS[cur.k].name} por ${lootLabel(l)}` : `[${key}] Pegar ${lootLabel(l)}`;
      }
    }
    this.set('prompt', 'text', prompt);

    // mira
    const ch = $('crosshair');
    let cx = g.input.mouse.x, cy = g.input.mouse.y;
    if (g.input.usingPad && g.local) {
      const target = g.lock ? { x: g.lock.rx, y: g.lock.ry } : g.aimPoint;
      const s = this.project(target.x, 1.1, target.y);
      if (s) { cx = s.x; cy = s.y; }
    } else if (g.lock && g.settings.assist) {
      const s = this.project(g.lock.rx, 1.1, g.lock.ry);
      if (s) { cx = s.x; cy = s.y; }
    }
    ch.style.transform = `translate(${cx}px, ${cy}px)`;
    this.hitT -= dt;
    const showCh = meP && meP.alive && !meP.inPlane && meP.rz < 0.3 && !g.menuOpen;
    this.set('crosshair', 'class', !showCh ? 'hidden-ch' : this.hitT > 0 ? 'hit' : g.lock ? 'lock' : '');
    ch.style.display = showCh ? '' : 'none';

    // dano e zona
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.4);
    const lowHp = meP && meP.alive && meP.hp < 30 ? 0.35 + Math.sin(performance.now() / 250) * 0.12 : 0;
    $('vignette').style.opacity = Math.max(this.hurtLevel, lowHp).toFixed(2);
    const f = g.focus();
    const outside = z && meP && meP.alive && !meP.inPlane && Math.hypot(f.x - z.x, f.y - z.y) > z.r;
    $('zone-tint').classList.toggle('on', !!outside);

    if (g.frameCount % 2 === 0) this.drawMinimap();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

