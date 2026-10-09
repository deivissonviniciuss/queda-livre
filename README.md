# 🪂 Queda Livre

Mini battle royale multiplayer que roda no navegador. Salte do avião, pegue armas, fuja da zona e seja o **último de pé**.

- 1 a 20 combatentes por partida. Bots completam as vagas, então dá para jogar sozinho.
- Multiplayer na rede local: um computador roda o servidor e os colegas entram pelo navegador.
- Mira assistida e tiro automático opcionais, pensados para quem está acostumado com jogos de celular.
- Também funciona com controle de videogame.

## Como rodar

Requisito: [Node.js](https://nodejs.org) 18 ou mais recente.

```bash
npm install
npm start
```

No Windows, também dá para dar dois cliques em `iniciar.bat`.

O terminal mostra os endereços:

```
Neste computador:  http://localhost:3001
Na rede (colegas): http://10.75.0.68:3001
```

Mande o endereço "Na rede" para a galera. Se o Windows perguntar sobre o firewall na primeira vez, permita o acesso em **redes privadas**. Para usar outra porta: `PORT=4000 npm start`.

## Como jogar

| Ação | Teclado e mouse | Controle |
|---|---|---|
| Mover | W A S D | Analógico esquerdo |
| Mirar / atirar | Mouse / botão esquerdo | Analógico direito / RT |
| Saltar do avião | Espaço | A |
| Pegar / trocar arma | E | A |
| Recarregar | R | X |
| Trocar arma | 1, 2, roda do mouse ou Tab | Y |
| Kit médico | Q | B |
| Granada | G ou botão direito | LB |
| Mapa grande | M | Select |
| Menu | Esc | Start |

Munição, kits médicos, coletes e granadas são pegos automaticamente ao passar por cima. Armas também, se houver espaço vazio.

**Fluxo da partida:** o avião cruza a ilha → você escolhe onde saltar → plana até o chão → pega loot → a zona roxa fecha em 5 fases e causa dano fora dela → o último vivo vence.

**Armas:** Pistola, Submetralhadora, Escopeta, Rifle e Sniper (a câmera afasta quando a sniper está em mãos). A cor do brilho no chão indica a arma.

## Estrutura

```
server/
  index.js     servidor HTTP + WebSocket, lobby e loop da partida (30 ticks/s)
  game.js      simulação autoritativa: avião, queda, tiros, loot, zona, abates
  bot.js       IA dos bots (saltar, lootear, combater, fugir da zona, curar)
  map.js       gerador procedural da ilha (vilas, casas, caixas, árvores)
  selftest.js  simula partidas só com bots (npm test)
shared/
  constants.js armas, zona, velocidades. É o lugar para balancear o jogo
  physics.js   colisão e raycast (usado pelo servidor e pelo cliente)
public/
  index.html, style.css
  js/main.js   conexão e lobby
  js/game.js   partida no cliente (previsão de movimento, mira, câmera)
  js/render.js modelos 3D low-poly, mapa, efeitos (three.js)
  js/hud.js    HUD, minimapa, telas de morte/vitória
  js/audio.js  sons sintetizados (WebAudio, sem arquivos)
  js/input.js  teclado, mouse e gamepad
```

O servidor é autoritativo: dano, loot e zona são calculados nele. O cliente só prevê o próprio movimento para não ter atraso.

## Ajustes rápidos

Tudo fica em `shared/constants.js`:

- `WEAPONS`: dano, cadência, dispersão, pente e alcance de cada arma
- `WEAPON_WEIGHTS`: chance de cada arma aparecer no mapa
- `ZONE_PHASES`: tempos, raios e dano da zona (deixe as fases mais curtas para partidas mais rápidas)
- `PLAYER_SPEED`, `MAX_HP`, `MEDKIT_HEAL`, `GRENADE`…

A dificuldade dos bots (Fácil/Normal/Difícil) fica em `DIFF`, no topo de `server/bot.js`.

## Teste

```bash
npm test
```

Simula partidas inteiras só com bots, nas três dificuldades, e confirma que todos pousam e que a partida termina com um vencedor.
