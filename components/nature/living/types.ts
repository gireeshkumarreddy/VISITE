export type Vec2 = readonly [number, number];

export interface PuppetDef {
  c: Vec2;
  ax: Vec2;
  angle: number;
  pivot: Vec2;
  feather: number;
  taper: number;
}

export interface DeerDef {
  sprite: string;
  rect: readonly [number, number, number, number];
  cut: readonly [Vec2, Vec2];
  blend: number;
  shoulder: Vec2;
  jaw: readonly [Vec2, Vec2];
  head: Vec2;
  eyes: readonly [Vec2, Vec2];
  eyeR: Vec2;
  ears: readonly [{ base: Vec2; tip: Vec2 }, { base: Vec2; tip: Vec2 }];
  nose: Vec2;
}

export interface VariantData {
  size: Vec2;
  plate: string;
  ctrl: string;
  features: {
    flow?: boolean;
    cloud?: boolean;
    cloth?: boolean;
    stars?: boolean;
    deer?: boolean;
    mist?: 'rise' | 'drift';
    glow?: 'sun' | 'rays';
  };
  puppets: Record<string, PuppetDef>;
  flock?: readonly { x: number; y: number; s: number; glide: number }[];
  deer?: DeerDef;
  fisher?: { hands: Vec2; tip: Vec2; entry: Vec2 };
  rayDir?: Vec2;
}

/** Per-frame transform of one puppet region: rotation (rad, clockwise on screen), translation and vertical stretch. */
export interface PuppetPose {
  rot: number;
  tx: number;
  ty: number;
  sy: number;
}

export interface DeerPose {
  neckRot: number;
  headRot: number;
  earRot: [number, number];
  blink: number;
  shift: [number, number];
}

export type SceneKind = 'hero' | 'waterfall' | 'forest';
