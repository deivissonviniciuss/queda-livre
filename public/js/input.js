// Teclado, mouse e controle (gamepad). Ações pontuais viram uma fila de "presses".

const KEYMAP = {
  KeyE: 'pickup', KeyF: 'pickup', KeyR: 'reload', KeyQ: 'heal', KeyG: 'nade',
  Digit1: 'slot0', Digit2: 'slot1', Space: 'jump', KeyM: 'map', Escape: 'menu', Tab: 'swap',
};
// botões padrão do gamepad (layout Xbox)
const PAD = { 0: 'jump', 2: 'reload', 3: 'swap', 1: 'heal', 4: 'nade', 8: 'map', 9: 'menu' };

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
    this.presses = [];
    this.padPrev = [];
    this.pad = null;          // { mx, my, ax, ay, fire }
    this.usingPad = false;
    this.enabled = false;     // controles de jogo ativos (falso com o menu aberto)
    this.active = false;      // há uma partida em andamento

    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      // Esc funciona mesmo com o menu aberto (para poder fechá-lo)
      if (!this.enabled) { if (e.code === 'Escape' && this.active) this.presses.push('menu'); return; }
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat && KEYMAP[e.code]) this.presses.push(KEYMAP[e.code]);
      this.keys.add(e.code);
      this.usingPad = false;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.usingPad = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.presses.push('nade');
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { if (this.enabled) this.presses.push('swap'); }, { passive: true });
  }

  move() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (this.pad && Math.hypot(this.pad.mx, this.pad.my) > 0.2) { x = this.pad.mx; y = this.pad.my; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  firing() {
    return this.mouse.down || (this.pad && this.pad.fire);
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) { this.pad = null; return; }
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    const b = gp.buttons.map((x) => x.pressed);
    this.pad = { mx: dz(gp.axes[0]), my: dz(gp.axes[1]), ax: dz(gp.axes[2] || 0), ay: dz(gp.axes[3] || 0), fire: b[7] || b[5] };
    if (b.some((x) => x) || Math.hypot(this.pad.ax, this.pad.ay) > 0.3 || Math.hypot(this.pad.mx, this.pad.my) > 0.3) this.usingPad = true;
    if (this.active && !this.enabled && b[9] && !this.padPrev[9]) this.presses.push('menu');
    if (this.enabled) {
      for (const [i, act] of Object.entries(PAD)) if (b[i] && !this.padPrev[i]) this.presses.push(act);
      // A também pega itens no chão quando não está no avião
      if (b[0] && !this.padPrev[0]) this.presses.push('pickup');
    }
    this.padPrev = b;
  }

  takePresses() {
    const p = this.presses;
    this.presses = [];
    return p;
  }
}
