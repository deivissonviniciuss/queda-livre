// Ponto de entrada: conexão, lobby e loop de renderização.

import { COLORS, SKINS } from '/shared/constants.js';
import { createRenderer, PreviewScene } from './render.js';
import { ClientGame } from './game.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------ perfil
const STORE = 'queda-livre-perfil';
function loadProfile() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { /* sem storage */ }
  return {
    name: saved.name || 'Recruta' + Math.floor(100 + Math.random() * 900),
    color: COLORS.includes(saved.color) ? saved.color : COLORS[Math.floor(Math.random() * 8)],
    skin: SKINS.some((s) => s.id === saved.skin) ? saved.skin : SKINS[0].id,
    assist: saved.assist !== false,
    autofire: !!saved.autofire,
    sound: saved.sound !== false,
  };
}
const profile = loadProfile();
if (params.get('name')) profile.name = params.get('name').slice(0, 16);
profile.save = () => {
  try {
    const { save, ...data } = profile;
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch { /* sem storage */ }
};

// -------------------------------------------------------------- rede
class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connect();
  }
  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    this.ws = ws;
    ws.onopen = () => { $('conn').hidden = true; this.handlers.open?.(); };
    ws.onclose = () => {
      $('conn').hidden = false;
      $('conn').textContent = 'Sem conexão com o servidor. Tentando de novo…';
      this.handlers.close?.();
      setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.handlers[m.t]?.(m);
    };
  }
  on(t, fn) { this.handlers[t] = fn; }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
}

const net = new Net();
const sfx = new Sfx();
sfx.setEnabled(profile.sound);
const renderer = createRenderer($('scene'));
const input = new Input($('scene'));
const preview = new PreviewScene();
preview.setCharacter(profile.color, profile.skin);

let game = null;
let lobby = null;
let myId = null;
let autoStarted = false;

const report = (msg) => net.send({ t: 'log', msg });
addEventListener('error', (e) => report(`${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => report('Promise: ' + (e.reason && (e.reason.stack || e.reason))));

// ------------------------------------------------------------- lobby
function sendProfile() {
  net.send({ t: 'profile', name: profile.name, color: profile.color, skin: profile.skin });
}

function buildLobbyUi() {
  const nameIn = $('in-name');
  nameIn.value = profile.name;
  let tmr;
  nameIn.addEventListener('input', () => {
    profile.name = nameIn.value.slice(0, 16) || 'Recruta';
    profile.save();
    clearTimeout(tmr);
    tmr = setTimeout(sendProfile, 300);
  });

  const skins = $('skins');
  for (const s of SKINS) {
    const b = document.createElement('button');
    b.className = 'opt';
    b.dataset.id = s.id;
    b.innerHTML = `<b>${s.name}</b><small>${s.desc}</small>`;
    b.addEventListener('click', () => { profile.skin = s.id; profile.save(); refreshPicks(); sendProfile(); });
    skins.appendChild(b);
  }
  const colors = $('colors');
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.dataset.c = c;
    b.title = c;
    b.addEventListener('click', () => { profile.color = c; profile.save(); refreshPicks(); sendProfile(); });
    colors.appendChild(b);
  }
  for (const [id, key] of [['opt-assist', 'assist'], ['opt-autofire', 'autofire']]) {
    const el = $(id);
    el.checked = profile[key];
    el.addEventListener('change', () => { profile[key] = el.checked; profile.save(); });
  }

  $('in-total').addEventListener('input', (e) => {
    $('total-val').textContent = e.target.value;
    net.send({ t: 'settings', total: Number(e.target.value) });
  });
  for (const b of $('difficulty').querySelectorAll('button')) {
    b.addEventListener('click', () => net.send({ t: 'settings', difficulty: b.dataset.v }));
  }
  $('btn-play').addEventListener('click', () => {
    sfx.unlock();
    net.send({ t: 'start' });
  });
  $('btn-sound').addEventListener('click', () => {
    sfx.unlock();
    profile.sound = !profile.sound;
    profile.save();
    sfx.setEnabled(profile.sound);
    updateSoundBtn();
  });
  addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  updateSoundBtn();
  refreshPicks();
}

function updateSoundBtn() { $('btn-sound').textContent = profile.sound ? 'Som: ligado' : 'Som: desligado'; }

function refreshPicks() {
  for (const b of $('skins').children) b.classList.toggle('on', b.dataset.id === profile.skin);
  for (const b of $('colors').children) b.classList.toggle('on', b.dataset.c === profile.color);
  preview.setCharacter(profile.color, profile.skin);
}

function renderLobby() {
  const L = lobby;
  if (!L) return;
  const isHost = L.host === myId;
  const host = L.players.find((p) => p.id === L.host);

  $('host-tag').textContent = isHost ? 'você é o anfitrião' : host ? `anfitrião: ${host.name}` : '';
  const total = $('in-total');
  if (document.activeElement !== total) total.value = L.settings.total;
  $('total-val').textContent = total.value;
  total.disabled = !isHost;
  for (const b of $('difficulty').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === L.settings.difficulty);
    b.disabled = !isHost;
  }

  const room = $('room');
  room.innerHTML = '';
  for (const p of L.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span><span class="nm"></span><small></small>`;
    li.querySelector('.nm').textContent = p.name + (p.id === myId ? ' (você)' : '');
    li.querySelector('small').textContent = p.inMatch ? 'em partida' : p.id === L.host ? 'anfitrião' : '';
    room.appendChild(li);
  }
  const humans = L.players.length;
  const bots = Math.max(humans === 1 ? 1 : 0, L.settings.total - humans);
  const share = $('share');
  share.innerHTML = '';
  const info = document.createElement('div');
  info.textContent = `${humans} jogador${humans === 1 ? '' : 'es'} + ${bots} bot${bots === 1 ? '' : 's'} na próxima partida.`;
  share.appendChild(info);
  if (L.addresses.length) {
    const d = document.createElement('div');
    d.innerHTML = 'Chame a galera: ';
    L.addresses.forEach((a, i) => {
      const c = document.createElement('code');
      c.textContent = a;
      d.append(i ? ' ou ' : '', c);
    });
    share.appendChild(d);
  }

  const resCard = $('results-card');
  if (L.results && L.results.length) {
    resCard.hidden = false;
    const ol = $('results');
    ol.innerHTML = '';
    const rows = L.results.slice(0, 5);
    const mine = L.results.find((r) => r.id === myId);
    if (mine && !rows.includes(mine)) rows.push(mine);
    for (const r of rows) {
      const li = document.createElement('li');
      li.value = r.place;
      if (r.id === myId) li.className = 'me';
      li.textContent = `${r.name}${r.isBot ? ' (bot)' : ''} · ${r.kills} abate${r.kills === 1 ? '' : 's'}`;
      ol.appendChild(li);
    }
  } else resCard.hidden = true;

  const btn = $('btn-play');
  const hint = $('play-hint');
  if (L.state === 'match') {
    btn.disabled = true;
    btn.textContent = 'PARTIDA EM ANDAMENTO';
    hint.textContent = `${L.alive} ainda vivos. Você entra na próxima partida.`;
  } else if (isHost) {
    btn.disabled = false;
    btn.textContent = 'SALTAR!';
    hint.textContent = humans > 1 ? 'Todos na sala entram juntos.' : 'Você contra os bots. Chame a galera pelo link acima.';
  } else {
    btn.disabled = true;
    btn.textContent = 'AGUARDANDO…';
    hint.textContent = host ? `${host.name} inicia a partida.` : '';
  }

  if (params.has('auto') && isHost && L.state === 'lobby' && !autoStarted) {
    autoStarted = true;
    net.send({ t: 'start' });
  }
}

function showLobby() {
  $('lobby').hidden = false;
}

// ----------------------------------------------------------- mensagens
net.on('open', () => {
  net.send({ t: 'hello', name: profile.name, color: profile.color, skin: profile.skin });
});

net.on('close', () => {
  if (game) { game.destroy(); game = null; showLobby(); }
});

net.on('lobby', (m) => {
  myId = m.you;
  lobby = m;
  if (game) { game.destroy(); game = null; }
  showLobby();
  renderLobby();
});

net.on('start', (info) => {
  if (game) game.destroy();
  sfx.unlock();
  $('lobby').hidden = true;
  game = new ClientGame({ info, meId: myId, renderer, net, input, sfx, settings: profile });
});

net.on('s', (snap) => { if (game) game.onSnapshot(snap); });

// -------------------------------------------------------------- loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (game) game.frame(dt);
    else preview.frame(renderer, dt);
  } catch (err) {
    console.error(err);
    if (!loop.reported) { loop.reported = true; report('frame: ' + (err.stack || err)); }
  }
  requestAnimationFrame(loop);
}

addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight, false));

buildLobbyUi();
requestAnimationFrame(loop);
