// Servidor HTTP (arquivos do jogo) + WebSocket (lobby e partida).

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { TICK_RATE, COLORS, SKINS } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3001;

const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/build')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.join(dir, url.slice(prefix.length));
    if (!file.startsWith(dir)) break;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Não encontrado'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('Não encontrado');
});

// ------------------------------------------------------------------- lobby
const clients = new Map(); // id -> { id, ws, name, color, skin, inMatch, joined }
let nextClientId = 1;
let hostId = null;
let settings = { total: 10, difficulty: 'normal' };
let game = null;
let lastResults = null;
let returnTimer = null;

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

function send(c, msg) {
  if (c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function lobbyState(forId) {
  return {
    t: 'lobby',
    you: forId,
    host: hostId,
    state: game ? 'match' : 'lobby',
    players: [...clients.values()].filter((c) => c.joined).map((c) => ({ id: c.id, name: c.name, color: c.color, skin: c.skin, inMatch: c.inMatch })),
    settings,
    alive: game ? game.aliveCount() : 0,
    results: lastResults,
    addresses: addresses(),
  };
}

function broadcastLobby() {
  for (const c of clients.values()) if (!c.inMatch) send(c, lobbyState(c.id));
}

function pickHost() {
  if (hostId && clients.has(hostId)) return;
  const first = [...clients.values()].find((c) => c.joined);
  hostId = first ? first.id : null;
}

function cleanName(n) {
  const s = String(n || '').replace(/[<>]/g, '').trim().slice(0, 16);
  return s || 'Recruta';
}

function startMatch() {
  if (game) return;
  const humans = [...clients.values()].filter((c) => c.joined);
  if (!humans.length) return;
  const total = Math.max(2, Math.min(20, settings.total | 0));
  const botCount = Math.max(0, total - humans.length);
  game = new Game({
    humans: humans.map((c) => ({ id: c.id, name: c.name, color: c.color, skin: c.skin })),
    botCount: humans.length === 1 ? Math.max(1, botCount) : botCount,
    difficulty: settings.difficulty,
  });
  lastResults = null;
  const info = JSON.stringify(game.startInfo());
  for (const c of humans) { c.inMatch = true; send(c, info); }
  console.log(`Partida iniciada: ${humans.length} humano(s), ${game.bots.length} bot(s), dificuldade ${settings.difficulty}`);
}

function endMatch() {
  if (!game) return;
  const g = game;
  game = null;
  clearTimeout(returnTimer);
  returnTimer = null;
  lastResults = g.over ? g.finalStandings : null;
  for (const c of clients.values()) {
    if (c.inMatch) { c.inMatch = false; }
  }
  broadcastLobby();
}

// ------------------------------------------------------------------- loop
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (!game) return;
  game.tick(dt);
  const snap = game.snapshot();
  const overEv = snap.ev.find((e) => e.e === 'over');
  if (overEv) {
    game.finalStandings = overEv.standings;
    clearTimeout(returnTimer);
    returnTimer = setTimeout(endMatch, 9000);
  }
  for (const c of clients.values()) {
    if (!c.inMatch) continue;
    send(c, JSON.stringify({ ...snap, me: game.privateState(c.id) }));
  }
  // ninguém mais assistindo a partida
  if (![...clients.values()].some((c) => c.inMatch)) endMatch();
}, 1000 / TICK_RATE);

// -------------------------------------------------------------- websocket
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const c = { id: 'p' + nextClientId++, ws, name: 'Recruta', color: COLORS[0], skin: SKINS[0].id, inMatch: false, joined: false };
  clients.set(c.id, c);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'hello':
      case 'profile':
        c.name = cleanName(m.name);
        if (COLORS.includes(m.color)) c.color = m.color;
        if (SKINS.some((s) => s.id === m.skin)) c.skin = m.skin;
        if (!c.joined) { c.joined = true; pickHost(); }
        broadcastLobby();
        break;
      case 'settings':
        if (c.id !== hostId) break;
        if (Number.isFinite(m.total)) settings.total = Math.max(2, Math.min(20, m.total | 0));
        if (['easy', 'normal', 'hard'].includes(m.difficulty)) settings.difficulty = m.difficulty;
        broadcastLobby();
        break;
      case 'start':
        if (c.id === hostId && !game) startMatch();
        break;
      case 'input':
        if (game && c.inMatch) game.handleInput(c.id, m);
        break;
      case 'act':
        if (game && c.inMatch) game.handleAction(c.id, m);
        break;
      case 'leave':
        if (game && c.inMatch) {
          c.inMatch = false;
          game.removeHuman(c.id);
          send(c, lobbyState(c.id));
        }
        break;
      case 'log':
        console.log(`[cliente ${c.name}]`, String(m.msg).slice(0, 2000));
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(c.id);
    if (game && c.inMatch) game.removeHuman(c.id);
    if (hostId === c.id) { hostId = null; pickHost(); }
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log('\n  QUEDA LIVRE rodando!\n');
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  for (const a of addresses()) console.log(`  Na rede (colegas): ${a}`);
  console.log('');
});
