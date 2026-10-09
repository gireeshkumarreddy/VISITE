import type { DeerPose, PuppetPose, SceneKind, VariantData, Vec2 } from './types';

export interface PointerState {
  x: number;
  y: number;
  active: boolean;
  speed: number;
}

export interface DirectorCtx {
  t: number;
  dt: number;
  wind: number;
  pointer: PointerState;
  spawnRipple: (x: number, y: number, amp: number) => void;
}

export interface Director {
  puppets: Record<string, PuppetPose>;
  deer?: DeerPose;
  update(c: DirectorCtx): void;
  tap?(x: number, y: number, c: DirectorCtx): void;
}

const TAU = Math.PI * 2;
const pose = (): PuppetPose => ({ rot: 0, tx: 0, ty: 0, sy: 0 });
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (v: number, target: number, k: number, dt: number) => v + (target - v) * (1 - Math.exp(-k * dt));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const dist = (x: number, y: number, p: Vec2) => Math.hypot(x - p[0], y - p[1]);
/** decaying oscillation used for flicks and twitches */
const flick = (age: number, freq: number, decay: number) => (age < 0 ? 0 : Math.sin(age * freq) * Math.exp(-age * decay));
const pulse = (age: number, at: number, width: number) => Math.exp(-Math.pow((age - at) / width, 2));

function rotateAround(p: Vec2, c: Vec2, a: number): [number, number] {
  const s = Math.sin(a), co = Math.cos(a);
  const x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + co * x - s * y, c[1] + s * x + co * y];
}

function heroDirector(d: VariantData): Director {
  const P: Record<string, PuppetPose> = { travBreath: pose(), travHat: pose() };
  const unit = d.size[0] / 1672;
  return {
    puppets: P,
    update({ t, wind }) {
      P.travBreath.sy = 0.0065 * Math.sin((t * TAU) / 4.4);
      P.travBreath.tx = 0.6 * unit * Math.sin(t * 0.45);
      P.travHat.rot = 0.016 * Math.sin(t * 0.85) + 0.02 * (wind - 0.85) + 0.005 * Math.sin(t * 3.4);
      P.travHat.tx = 0.9 * unit * Math.sin(t * 1.25) * wind;
    },
  };
}

function waterfallDirector(d: VariantData): Director {
  const names = Object.keys(d.puppets);
  const P: Record<string, PuppetPose> = Object.fromEntries(names.map((n) => [n, pose()]));
  const f = d.fisher!;
  const head = d.puppets.fishHead?.c ?? f.hands;
  const unit = d.size[0] / 1672;
  let nextBite = rand(3, 6);
  let biteT = -99;
  let nextRipple = 1.5;
  let lookUp = 0;
  const dips = [0, 0.5, 1.05];
  const bite = (age: number) => dips.reduce((s, at, i) => s + pulse(age, at + 0.12, 0.13) * (1 - i * 0.25), 0);
  return {
    puppets: P,
    update({ t, dt, pointer, spawnRipple }) {
      if (t > nextBite) {
        biteT = t;
        nextBite = t + rand(6, 12);
      }
      const age = t - biteT;
      if (age >= 0 && age < 1.6) {
        for (const at of dips) if (age - dt < at && age >= at) spawnRipple(f.entry[0], f.entry[1], 0.65);
      }
      if (t > nextRipple) {
        spawnRipple(f.entry[0], f.entry[1], 0.28);
        nextRipple = t + rand(2.5, 4.5);
      }
      const near = pointer.active ? 1 - smoothstep(60 * unit, 300 * unit, dist(pointer.x, pointer.y, head)) : 0;
      lookUp = damp(lookUp, near, 3, dt);
      const b = age >= 0 && age < 2.4 ? bite(age) : 0;
      P.fishBreath.sy = 0.009 * Math.sin((t * TAU) / 3.6);
      // he faces left, so a clockwise turn lifts his face toward you; bites pull his gaze to the line
      P.fishHead.rot = 0.03 * Math.sin(t * 0.55) + 0.01 * Math.sin(t * 1.7) + 0.08 * lookUp - 0.03 * b;
      const rod = 0.014 * Math.sin(t * 1.15) + 0.007 * Math.sin(t * 2.9) - 0.075 * b;
      P.rod.rot = rod;
      const tip = rotateAround(f.tip, f.hands, rod);
      P.line.tx = tip[0] - f.tip[0];
      P.line.ty = tip[1] - f.tip[1];
      P.footL.rot = 0.1 * Math.sin(t * 1.5);
      P.footR.rot = 0.1 * Math.sin(t * 1.5 + 2.4);
      // painted doves: hover in place with fluttering wings
      const u = unit;
      if (P.doveA) {
        P.doveA.ty = 2.6 * u * Math.sin(t * 2.2);
        P.doveA.tx = 1.2 * u * Math.sin(t * 1.1);
        P.doveAL.rot = 0.22 * Math.sin(t * 8.5);
        P.doveAR.rot = -0.22 * Math.sin(t * 8.5);
      }
      if (P.doveB) {
        P.doveB.ty = 2.0 * u * Math.sin(t * 2.6 + 1);
        P.doveBL.rot = 0.2 * Math.sin(t * 9 + 1);
      }
      if (P.doveC) {
        P.doveC.ty = 2.2 * u * Math.sin(t * 2.4 + 2);
        P.doveCL.rot = 0.22 * Math.sin(t * 8 + 2);
      }
      if (P.doveD) P.doveD.ty = 1.8 * u * Math.sin(t * 3 + 0.5);
    },
    tap(x, y, { t, spawnRipple }) {
      spawnRipple(x, y, 1);
      if (dist(x, y, f.entry) < 220 * unit) biteT = t; // something took the bait
    },
  };
}

type DeerState = 'look' | 'lower' | 'eat' | 'raise';

function forestDirector(d: VariantData): Director {
  const P: Record<string, PuppetPose> = { deerBreath: pose(), tail: pose(), bush: pose() };
  const deer = d.deer!;
  const unit = d.size[0] / 1672;
  const EAT = { neck: -0.62, head: 0.34 };
  const pose0 = { neck: 0, head: 0 };
  let state: DeerState = 'look';
  let st = 0;
  let dur = rand(2.5, 4);
  let from = { ...pose0 };
  let cur = { ...pose0 };
  let alert = 0;
  let chew = 0;
  let nextEar = rand(1.5, 3);
  let earT = -99;
  let earSide = 0;
  let nextBlink = rand(1.5, 3.5);
  let blinkT = -99;
  let nextTail = rand(2, 4);
  let tailT = -99;
  const out: DeerPose = { neckRot: 0, headRot: 0, earRot: [0, 0], blink: 0, shift: [0, 0] };

  const go = (s: DeerState, t: number, len: number) => {
    state = s;
    st = t;
    dur = len;
    from = { ...cur };
  };

  return {
    puppets: P,
    deer: out,
    update({ t, dt, pointer }) {
      const near = pointer.active && dist(pointer.x, pointer.y, deer.head) < 260 * unit;
      alert = damp(alert, near ? 1 : 0, near ? 6 : 1.2, dt);
      const k = clamp((t - st) / dur, 0, 1);
      switch (state) {
        case 'look':
          cur = { neck: 0, head: 0 };
          if (near) st = t; // keep watching you while you're close
          if (k >= 1) go('lower', t, rand(1.5, 1.9));
          break;
        case 'lower':
          cur = { neck: from.neck + (EAT.neck - from.neck) * ease(k), head: from.head + (EAT.head - from.head) * ease(k) };
          if (near) go('raise', t, 0.7);
          else if (k >= 1) go('eat', t, rand(3.2, 5.5));
          break;
        case 'eat':
          cur = { ...EAT };
          if (near) go('raise', t, 0.65);
          else if (k >= 1) go('raise', t, rand(1.2, 1.5));
          break;
        case 'raise':
          cur = { neck: from.neck * (1 - ease(k)), head: from.head * (1 - ease(k)) };
          if (k >= 1) {
            go('look', t, rand(3.5, 6.5));
            blinkT = t + 0.15;
            earT = t + 0.35;
            earSide = Math.random() < 0.5 ? 0 : 1;
          }
          break;
      }
      chew = damp(chew, state === 'eat' ? 1 : 0, 4, dt);
      const chewing = chew * (0.6 + 0.4 * Math.sin(t * 1.3)) * (Math.sin(t * 2.1) > -0.6 ? 1 : 0.2);
      const follow = near ? clamp((pointer.x - deer.head[0]) / (520 * unit), -1, 1) * 0.07 : 0;
      out.neckRot = cur.neck + 0.012 * Math.sin(t * 0.7) + 0.02 * chew * Math.sin(t * 4.6);
      out.headRot = cur.head + 0.02 * Math.sin(t * 0.9 + 1) + 0.05 * chewing * Math.sin(t * 12) + follow * alert;

      if (t > nextEar) {
        earT = t;
        earSide = Math.random() < 0.5 ? 0 : 1;
        nextEar = t + rand(1.6, 4.2);
      }
      const ea = flick(t - earT, 26, 6) * 0.32;
      const perk = 0.13 * alert;
      out.earRot[0] = (earSide === 0 ? ea : ea * 0.25) + perk + 0.02 * Math.sin(t * 1.4);
      out.earRot[1] = -(earSide === 1 ? ea : ea * 0.25) - perk - 0.02 * Math.sin(t * 1.2 + 1);

      if (t > nextBlink) {
        blinkT = t;
        nextBlink = t + rand(2.2, 5.5);
      }
      const ba = t - blinkT;
      out.blink = ba < 0 ? 0 : ba < 0.07 ? ba / 0.07 : ba < 0.19 ? 1 - (ba - 0.07) / 0.12 : 0;

      if (t > nextTail || (near && t - tailT > 1.5 && alert > 0.6)) {
        tailT = t;
        nextTail = t + rand(2.5, 6);
      }
      P.tail.rot = 0.28 * flick(t - tailT, 22, 4) + 0.04 * Math.sin(t * 1.3);
      P.deerBreath.sy = (0.005 + 0.003 * alert) * Math.sin((t * TAU) / (3.2 - alert * 0.9));
      P.bush.rot = 0.045 * chewing * Math.sin(t * 15) + 0.012 * Math.sin(t * 1.7);
    },
    tap(x, y, { t, spawnRipple }) {
      spawnRipple(x, y, 1);
      if (dist(x, y, deer.head) < 300 * unit) {
        earT = t;
        earSide = x < deer.head[0] ? 0 : 1;
        tailT = t;
        if (state === 'lower' || state === 'eat') go('raise', t, 0.6);
      }
    },
  };
}

export function createDirector(kind: SceneKind, d: VariantData): Director {
  if (kind === 'waterfall') return waterfallDirector(d);
  if (kind === 'forest') return forestDirector(d);
  return heroDirector(d);
}
