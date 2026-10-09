// Constantes compartilhadas entre servidor e cliente.

export const MAP_HALF = 90;            // mapa vai de -90 a 90 nos dois eixos
export const PLAYER_RADIUS = 0.6;
export const PLAYER_SPEED = 7.5;
export const HEAL_MOVE_FACTOR = 0.45;
export const MAX_HP = 100;
export const MAX_ARMOR = 50;
export const MAX_AMMO = 240;
export const MAX_MEDKITS = 5;
export const MAX_GRENADES = 3;
export const MEDKIT_HEAL = 50;
export const MEDKIT_TIME = 2.4;

export const DROP_ALTITUDE = 55;
export const FALL_SPEED = 7.5;         // unidades de altitude por segundo
export const FALL_HSPEED = 16;         // velocidade horizontal durante a queda
export const PLANE_SPEED = 22;
export const PLANE_ALTITUDE = 62;

export const PICKUP_RADIUS = 2.3;      // alcance da tecla E
export const AUTO_PICKUP_RADIUS = 1.3; // munição, kits etc. são pegos ao passar por cima

export const GRENADE = { fuse: 1.7, flight: 0.9, radius: 6.5, damage: 90, maxThrow: 18 };

export const TICK_RATE = 30;

// Armas. dmg por projétil, rate em tiros/s, spread em radianos, speed em u/s.
export const WEAPONS = {
  fist:    { name: 'Soco',            melee: true, dmg: 16, rate: 2.2, range: 1.9, rank: 0 },
  pistol:  { name: 'Pistola',         dmg: 20, rate: 3.6, spread: 0.03,  mag: 12, reload: 1.2, speed: 85,  range: 40, pellets: 1, rank: 1, color: '#9ca3af' },
  smg:     { name: 'Submetralhadora', dmg: 11, rate: 11,  spread: 0.09,  mag: 30, reload: 1.8, speed: 80,  range: 32, pellets: 1, rank: 3, color: '#38bdf8' },
  shotgun: { name: 'Escopeta',        dmg: 10, rate: 1.2, spread: 0.26,  mag: 5,  reload: 2.2, speed: 70,  range: 16, pellets: 8, rank: 3, color: '#f97316' },
  rifle:   { name: 'Rifle',           dmg: 17, rate: 6.5, spread: 0.045, mag: 30, reload: 2.0, speed: 100, range: 55, pellets: 1, rank: 4, color: '#a855f7' },
  sniper:  { name: 'Sniper',          dmg: 82, rate: 0.75,spread: 0.004, mag: 5,  reload: 2.8, speed: 170, range: 95, pellets: 1, rank: 3, color: '#facc15', zoom: true },
};

export const WEAPON_WEIGHTS = { pistol: 30, smg: 22, shotgun: 20, rifle: 18, sniper: 8 };

// Cronograma da zona: espera, depois encolhe até o raio alvo. dps = dano por segundo fora dela.
export const ZONE_START_RADIUS = 135;
export const ZONE_PHASES = [
  { wait: 45, shrink: 25, radius: 70, dps: 2 },
  { wait: 30, shrink: 20, radius: 40, dps: 4 },
  { wait: 25, shrink: 15, radius: 20, dps: 7 },
  { wait: 20, shrink: 15, radius: 8,  dps: 10 },
  { wait: 15, shrink: 15, radius: 0,  dps: 16 },
];

export const COLORS = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#14b8a6', '#f5f5f4', '#27272a'];

export const SKINS = [
  { id: 'recruta',    name: 'Recruta',    desc: 'Boné e mochila' },
  { id: 'comando',    name: 'Comando',    desc: 'Capacete militar' },
  { id: 'ninja',      name: 'Ninja',      desc: 'Bandana e máscara' },
  { id: 'cowboy',     name: 'Cowboy',     desc: 'Chapéu de aba larga' },
  { id: 'astronauta', name: 'Astronauta', desc: 'Capacete bolha' },
  { id: 'chef',       name: 'Chef',       desc: 'Toque blanche' },
  { id: 'pirata',     name: 'Pirata',     desc: 'Chapéu de três pontas' },
  { id: 'robo',       name: 'Robô',       desc: 'Cabeça quadrada com antena' },
];

export const LOOT_NAMES = {
  ammo: 'Munição', medkit: 'Kit médico', armor: 'Colete', grenade: 'Granada',
};

export function lootLabel(l) {
  if (l.type === 'weapon') return WEAPONS[l.key].name;
  return LOOT_NAMES[l.type];
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Estado da zona em um instante t (segundos desde o início da partida).
// centers: lista de centros [{x,y}] com ZONE_PHASES.length + 1 entradas.
export function zoneAt(t, centers) {
  let r0 = ZONE_START_RADIUS;
  let c0 = centers[0];
  let start = 0;
  for (let i = 0; i < ZONE_PHASES.length; i++) {
    const ph = ZONE_PHASES[i];
    const c1 = centers[i + 1];
    const shrinkStart = start + ph.wait;
    const shrinkEnd = shrinkStart + ph.shrink;
    if (t < shrinkStart) {
      return { x: c0.x, y: c0.y, r: r0, nx: c1.x, ny: c1.y, nr: ph.radius, phase: i, shrinking: false, timer: shrinkStart - t, dps: i === 0 ? 1 : ZONE_PHASES[i - 1].dps };
    }
    if (t < shrinkEnd) {
      const k = (t - shrinkStart) / ph.shrink;
      return { x: c0.x + (c1.x - c0.x) * k, y: c0.y + (c1.y - c0.y) * k, r: r0 + (ph.radius - r0) * k, nx: c1.x, ny: c1.y, nr: ph.radius, phase: i, shrinking: true, timer: shrinkEnd - t, dps: ph.dps };
    }
    r0 = ph.radius; c0 = c1; start = shrinkEnd;
  }
  const last = ZONE_PHASES[ZONE_PHASES.length - 1];
  return { x: c0.x, y: c0.y, r: 0, nx: c0.x, ny: c0.y, nr: 0, phase: ZONE_PHASES.length, shrinking: false, timer: 0, dps: last.dps };
}
