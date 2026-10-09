// Simula partidas só com bots (sem rede) para verificar que a simulação termina bem.
// Uso: npm test

import { Game } from './game.js';
import { TICK_RATE } from '../shared/constants.js';

const RUNS = Number(process.argv[2]) || 3;
const dt = 1 / TICK_RATE;
let ok = true;

for (let run = 0; run < RUNS; run++) {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const g = new Game({ humans: [], botCount: 12, difficulty });
    const kinds = {};
    let shots = 0, landed = 0, over = null;
    const t0 = performance.now();
    while (g.time < 600 && !over) {
      g.tick(dt);
      const snap = g.snapshot();
      JSON.stringify(snap);
      for (const e of snap.ev) {
        if (e.e === 's') shots++;
        if (e.e === 'ld') landed++;
        if (e.e === 'k') kinds[e.w] = (kinds[e.w] || 0) + 1;
        if (e.e === 'over') over = e;
      }
    }
    const ms = performance.now() - t0;
    const winner = over && over.winner ? g.players.get(over.winner) : null;
    console.log(`[${difficulty}] fim em ${g.time.toFixed(0)}s | pousaram ${landed}/12 | tiros ${shots} | mortes por: ${JSON.stringify(kinds)} | vencedor: ${winner ? `${winner.name} (${winner.kills} abates)` : 'nenhum'} | ${(ms / (g.time * TICK_RATE)).toFixed(3)} ms/tick`);
    if (!over || landed !== 12) ok = false;
  }
}
if (!ok) { console.error('FALHOU'); process.exit(1); }
console.log('OK');
