import type { VariantData } from './types';

const NS = 'http://www.w3.org/2000/svg';

// Unit birds face +x with a wingspan of about 50 units; wings hinge on y = 0.
const CRANE = {
  wing: 'M-3.5,-0.4 C-5,-7 -7,-15 -9.5,-23.5 C-5.6,-21.4 -1.4,-15.6 3.2,-7 C3.4,-4 2.2,-1.4 0.4,-0.3 Z',
  tip: 'M-9.5,-23.5 C-8.4,-20.2 -6.8,-17.6 -5.1,-15.6 L-3.4,-17.9 C-5.6,-19.9 -7.6,-21.7 -9.5,-23.5 Z',
  body: 'M-12.5,0.2 C-7,-3.2 5,-3.8 10.2,-1.3 C6.4,1.9 -6,2.6 -12.5,0.2 Z',
  neck: 'M9.4,-1.5 Q15,-2.9 20.6,-2.4',
  beak: 'M22.4,-2.5 L26.4,-1.9 L22.4,-1.5 Z',
  legs: 'M-11,0.5 L-24.5,1.9 M-11,0 L-24.5,0.9',
  tail: 'M-12.2,0 L-17,-1.8 L-15.4,0.9 Z',
};
const DOVE = {
  wing: 'M-3,-0.3 C-4.6,-6 -6.2,-12.5 -8.6,-19 C-4.6,-17.2 -0.6,-12.4 3.4,-5.6 C3.6,-3.2 2.4,-1.2 0.4,-0.2 Z',
  body: 'M-11,0.8 C-6,-3.4 5,-4.4 9.6,-1.6 C11.4,-0.4 10.4,1.2 8.6,1.6 C3,3.2 -5,3 -11,0.8 Z',
  tail: 'M-10.4,0.6 L-17.5,-1.6 L-17.8,2.8 Z',
  beak: 'M10.8,-1.2 L13.2,-0.6 L10.8,-0.2 Z',
};

interface Bird {
  g: SVGGElement;
  near: SVGGElement;
  far: SVGGElement;
  x: number;
  y: number;
  x0: number;
  y0: number;
  scale: number;
  phase: number;
  rate: number;
  glide: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  life: number;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export class Flock {
  private birds: Bird[] = [];
  private startle = 0;
  private nextDove = 2;
  private W: number;
  private H: number;

  constructor(private svg: SVGSVGElement, private data: VariantData, private kind: 'crane' | 'dove') {
    [this.W, this.H] = data.size as [number, number];
    svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const defs = el('defs', {}, svg);
    const grad = el('linearGradient', { id: `wingshade-${kind}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': '#fffaf4' }, grad);
    el('stop', { offset: 1, 'stop-color': '#e8dcef' }, grad);
    if (kind === 'crane') for (const b of data.flock ?? []) this.birds.push(this.makeCrane(b.x, b.y, b.s / 50, b.glide > 0));
  }

  private makeCrane(x: number, y: number, scale: number, glide: boolean): Bird {
    const g = el('g', {}, this.svg);
    const far = el('g', {}, g);
    el('path', { d: CRANE.wing, fill: '#ddd2e4', transform: 'translate(2.4,-0.6) scale(0.86,1)' }, far);
    el('path', { d: CRANE.tip, fill: '#2c2538', transform: 'translate(2.4,-0.6) scale(0.86,1)' }, far);
    el('path', { d: CRANE.legs, stroke: '#3a2f42', 'stroke-width': 0.9, fill: 'none', 'stroke-linecap': 'round' }, g);
    el('path', { d: CRANE.tail, fill: '#2c2538' }, g);
    el('path', { d: CRANE.body, fill: '#fbf6f1' }, g);
    el('path', { d: CRANE.neck, stroke: '#fbf6f1', 'stroke-width': 1.7, fill: 'none', 'stroke-linecap': 'round' }, g);
    el('circle', { cx: 21.2, cy: -2.4, r: 1.5, fill: '#fbf6f1' }, g);
    el('circle', { cx: 21, cy: -3.2, r: 0.7, fill: '#d8473b' }, g);
    el('path', { d: CRANE.beak, fill: '#e9b45b' }, g);
    const near = el('g', {}, g);
    el('path', { d: CRANE.wing, fill: `url(#wingshade-crane)` }, near);
    el('path', { d: CRANE.tip, fill: '#2c2538' }, near);
    return {
      g, near, far, x, y, x0: x, y0: y, scale,
      phase: Math.random() * Math.PI * 2, rate: 1.35 + Math.random() * 0.35,
      glide: glide ? 1 : 0, ox: 0, oy: 0, vx: 0, vy: 0, life: 1,
    };
  }

  private makeDove(): Bird {
    const g = el('g', { opacity: 0 }, this.svg);
    const far = el('g', {}, g);
    el('path', { d: DOVE.wing, fill: '#d9d2ea', transform: 'translate(2,-0.6) scale(0.86,1)' }, far);
    el('path', { d: DOVE.tail, fill: '#f1ecf7' }, g);
    el('path', { d: DOVE.body, fill: '#fbf8ff' }, g);
    el('circle', { cx: 8.4, cy: -1.6, r: 0.55, fill: '#2a2440' }, g);
    el('path', { d: DOVE.beak, fill: '#e8b38f' }, g);
    const near = el('g', {}, g);
    el('path', { d: DOVE.wing, fill: `url(#wingshade-dove)` }, near);
    const fromLeft = Math.random() < 0.7;
    const s = (this.W / 1672) * (0.75 + Math.random() * 0.5) * (this.W < this.H ? 1.25 : 1);
    const x = fromLeft ? -40 : this.W * (0.15 + Math.random() * 0.2);
    const y = this.H * (fromLeft ? 0.35 + Math.random() * 0.25 : 0.72);
    const b: Bird = {
      g, near, far, x, y, x0: x, y0: y, scale: s,
      phase: Math.random() * 6, rate: 3.6 + Math.random(), glide: 0, ox: 0, oy: 0,
      vx: (90 + Math.random() * 50) * (this.W / 1672), vy: (fromLeft ? -12 : -55) * (this.W / 1672), life: 0,
    };
    return b;
  }

  /** tap/click in image px: nearby birds startle */
  tap(x: number, y: number) {
    if (this.kind !== 'crane') {
      this.nextDove = 0;
      return;
    }
    const close = this.birds.some((b) => Math.hypot(b.x - x, b.y - y) < this.W * 0.18);
    if (close) this.startle = 1;
  }

  update(t: number, dt: number, shift: [number, number], pointer: { x: number; y: number; active: boolean }) {
    const W = this.W;
    this.startle = Math.max(0, this.startle - dt * 0.45);
    if (this.kind === 'dove' && t > this.nextDove) {
      if (this.birds.length < 3) this.birds.push(this.makeDove());
      this.nextDove = t + 9 + Math.random() * 10;
    }
    const speed = (W / 1672) * 15;
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      if (this.kind === 'crane') {
        b.x += (speed * (1 + this.startle * 1.6)) * dt;
        b.y += (-2.2 - this.startle * 14) * (W / 1672) * dt;
        if (b.x > W + 70) {
          b.x -= W + 300;
          b.y = b.y0 + (Math.random() - 0.5) * 40;
        }
        // keep a little personal space from the pointer
        let tx = 0, ty = 0;
        if (pointer.active) {
          const dx = b.x - pointer.x, dy = b.y - pointer.y;
          const d = Math.hypot(dx, dy);
          const r = W * 0.075;
          if (d < r) {
            const f = (1 - d / r) * r * 0.9;
            tx = (dx / (d || 1)) * f;
            ty = (dy / (d || 1)) * f - f * 0.3;
            this.startle = Math.max(this.startle, 0.35);
          }
        }
        b.ox += (tx - b.ox) * Math.min(1, dt * 3);
        b.oy += (ty - b.oy) * Math.min(1, dt * 3);
        // cranes alternate steady flapping with short glides
        const cycle = (t * 0.18 + b.phase * 0.31) % 1;
        const gliding = (b.glide ? cycle < 0.55 : cycle < 0.22) && this.startle < 0.3;
        b.life += ((gliding ? 0 : 1) - b.life) * Math.min(1, dt * 2.5);
        b.phase += dt * Math.PI * 2 * b.rate * (1 + this.startle * 0.9);
      } else {
        b.x += b.vx * dt;
        b.y += (b.vy + Math.sin(t * 1.3 + b.phase) * 18) * dt;
        b.vy += 6 * dt * (W / 1672);
        b.phase += dt * Math.PI * 2 * b.rate;
        b.life = 1;
        const fadeIn = Math.min(1, (b.x - b.x0) / 80 + 0.2);
        const out = b.x > W + 60 || b.y < -60;
        b.g.setAttribute('opacity', String(Math.max(0, Math.min(1, fadeIn))));
        if (out) {
          b.g.remove();
          this.birds.splice(i, 1);
          continue;
        }
      }
      const flap = Math.cos(b.phase);
      const k = b.life > 0.01 ? 0.12 * (1 - b.life) + b.life * (0.18 + 0.92 * flap) : 0.12;
      const bob = -Math.sin(b.phase) * 1.4 * b.life;
      b.near.setAttribute('transform', `scale(1,${k.toFixed(3)})`);
      b.far.setAttribute('transform', `scale(1,${(k * 0.9 + 0.05).toFixed(3)})`);
      const x = b.x + b.ox + shift[0];
      const y = b.y + b.oy + shift[1] + Math.sin(t * 0.9 + b.phase * 0.1) * 2 + bob * 0.3;
      const tilt = this.kind === 'crane' ? -4 - this.startle * 10 : -8 + Math.sin(t * 2 + b.phase) * 4;
      b.g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${tilt.toFixed(1)}) scale(${b.scale.toFixed(3)})`);
    }
  }

  destroy() {
    this.svg.replaceChildren();
  }
}
