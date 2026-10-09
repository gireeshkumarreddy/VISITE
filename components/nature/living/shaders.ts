// GLSL for the living paintings. GLSL ES 1.00 so it runs on WebGL1 and WebGL2.
// Everything works in source-image pixel space (y down); the control atlas holds
// three RGB bands: [flow, sway, depth] [ripple, cloud, glow] [cloth, mist, sparkle].

export const MAX_PUPPETS = 14;
export const MAX_RIPPLES = 6;

export const QUAD_VS = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s / 0.9375;
}
`;

export function plateFS(defs: string[]) {
  return `
${defs.map((d) => `#define ${d}`).join('\n')}
precision highp float;
uniform sampler2D u_img;
uniform sampler2D u_ctrl;
uniform vec2 u_size;
uniform vec3 u_view;      // offset.xy (device px from top-left), scale (device px per image px)
uniform float u_canvasH;
uniform float u_time;
uniform vec2 u_look;      // camera parallax direction
uniform float u_parallax; // image px of shift between near and far
uniform float u_wind;
uniform vec4 u_cursor;    // x, y (image px), radius, strength
uniform vec2 u_cursorVel; // image px / s
uniform vec4 u_ripple[${MAX_RIPPLES}];
uniform vec4 u_pA[${MAX_PUPPETS}];
uniform vec4 u_pB[${MAX_PUPPETS}];
uniform vec4 u_pC[${MAX_PUPPETS}];
uniform float u_pT[${MAX_PUPPETS}];
uniform int u_pCount;
uniform vec4 u_amp;       // sway px, cloth px, cloud px, ripple px
uniform vec4 u_flow;      // speed (cycles/s), length (px), streak speed, unused
uniform vec2 u_rayDir;
uniform float u_fade;
${NOISE}

vec3 img(vec2 p){ return texture2D(u_img, clamp(p / u_size, vec2(0.0005), vec2(0.9995))).rgb; }
vec3 ctrl(vec2 p, float band){
  vec2 uv = clamp(p / u_size, vec2(0.002), vec2(0.998));
  return texture2D(u_ctrl, vec2(uv.x, (uv.y + band) / 3.0)).rgb;
}

vec2 puppet(vec2 p, vec4 A, vec4 B, vec4 C, float taper){
  vec2 d = p - A.xy;
  float ca = cos(B.z), sa = sin(B.z);
  vec2 l = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / A.zw;
  float w = 1.0 - smoothstep(1.0 - B.w, 1.0, length(l));
  if (taper > 0.5) w *= clamp(0.5 - 0.5 * l.x, 0.0, 1.0);
  if (w <= 0.0) return p;
  vec2 q = p - C.yz * w - B.xy;
  float a = -C.x * w; float cr = cos(a), sr = sin(a);
  q = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
  q.y /= (1.0 + C.w * w);
  return B.xy + q;
}

float windField(vec2 p){
  float t = u_time;
  float band = 0.5 + 0.5 * sin(p.x * 0.0042 - t * 1.25 + sin(p.y * 0.006 + t * 0.31) * 1.4);
  band *= band;
  float n = vnoise(p * 0.009 + vec2(-t * 0.7, t * 0.13));
  float flutter = sin(t * 3.3 + p.x * 0.05 + p.y * 0.031) * 0.16 + sin(t * 5.1 + p.y * 0.08) * 0.07;
  return u_wind * (0.25 + 1.25 * band * (0.45 + n) + flutter);
}

#ifdef CLOTH
vec2 clothDisp(vec2 p){
  float t = u_time;
  float ph = p.x * 0.05 - t * 7.5;
  float n = vnoise(vec2(p.x * 0.025 - t * 2.8, p.y * 0.06));
  float g = 0.55 + 0.6 * u_wind;
  return vec2(sin(ph * 0.5 + 1.3) * 0.7 + (n - 0.5) * 0.8, sin(ph) + (n - 0.5) * 1.5) * u_amp.y * g;
}
#endif

vec2 rippleDisp(vec2 p, out float crest){
  float t = u_time;
  float a = sin(p.y * 0.33 + t * 1.7 + sin(p.x * 0.016 + t * 0.45) * 2.0);
  float b = vnoise(vec2(p.x * 0.022, p.y * 0.1) + vec2(t * 0.3, 0.0)) - 0.5;
  vec2 d = vec2(a * 0.9 + b * 2.2, b * 0.5) * u_amp.w;
  crest = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = u_ripple[i];
    float age = u_time - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 5.0) continue;
    vec2 v = p - r.xy; v.y *= 2.6;
    float dist = length(v);
    float front = age * 70.0;
    float env = exp(-abs(dist - front) * 0.035) * exp(-age * 0.85) * r.w;
    float ring = sin((dist - front) * 0.24) * env;
    d += normalize(v + 0.0001) * ring * 5.0;
    crest += max(ring, 0.0);
  }
  return d;
}

#ifdef FLOW
vec3 flowColor(vec2 p, vec3 base){
  float off = vnoise(vec2(p.x * 0.07, p.y * 0.0035)) * 0.9;
  float ph0 = fract(u_time * u_flow.x + off);
  float ph1 = fract(u_time * u_flow.x + off + 0.5);
  vec2 s0 = p - vec2(0.0, u_flow.y * ph0);
  vec2 s1 = p - vec2(0.0, u_flow.y * ph1);
  float w0 = 1.0 - abs(1.0 - 2.0 * ph0);
  vec3 a = mix(base, img(s0), smoothstep(0.25, 0.75, ctrl(s0, 0.0).r));
  vec3 b = mix(base, img(s1), smoothstep(0.25, 0.75, ctrl(s1, 0.0).r));
  vec3 col = a * w0 + b * (1.0 - w0);
  float s = vnoise(vec2(p.x * 0.42, p.y * 0.011 - u_time * u_flow.z));
  float s2 = vnoise(vec2(p.x * 0.85 + 13.0, p.y * 0.021 - u_time * u_flow.z * 1.35));
  col += (smoothstep(0.6, 0.95, s) * 0.17 + smoothstep(0.72, 1.0, s2) * 0.13) * vec3(0.96, 0.97, 1.0);
  col -= smoothstep(0.7, 1.0, 1.0 - s) * 0.06;
  return col;
}
#endif

float motes(vec2 p, float scale, vec2 drift){
  vec2 q = p * scale + drift * u_time;
  vec2 id = floor(q); vec2 f = fract(q) - 0.5;
  vec2 h = hash22(id) - 0.5;
  float d = length(f - h * 0.7);
  float tw = 0.5 + 0.5 * sin(u_time * (1.5 + hash12(id + 7.0) * 2.0) + hash12(id) * 6.28);
  return smoothstep(0.1, 0.0, d) * step(0.62, hash12(id + 3.1)) * tw;
}

void main(){
  vec2 fc = vec2(gl_FragCoord.x, u_canvasH - gl_FragCoord.y);
  vec2 p0 = (fc - u_view.xy) / u_view.z;
  vec3 c0 = ctrl(p0, 0.0);
  vec2 p = p0 - u_look * (c0.b - 0.45) * u_parallax;

  for (int i = 0; i < ${MAX_PUPPETS}; i++) {
    if (i >= u_pCount) break;
    p = puppet(p, u_pA[i], u_pB[i], u_pC[i], u_pT[i]);
  }

  vec3 cA = ctrl(p, 0.0);
  vec3 cB = ctrl(p, 1.0);
  vec3 cC = ctrl(p, 2.0);

  if (cA.g > 0.002) {
    float g = windField(p);
    vec2 d = vec2(g, abs(g) * 0.22 + sin(u_time * 2.3 + p.x * 0.03) * 0.12) * u_amp.x;
    vec2 dc = p - u_cursor.xy;
    float fall = exp(-dot(dc, dc) / (u_cursor.z * u_cursor.z)) * u_cursor.w;
    vec2 push = u_cursorVel * 0.012 + normalize(dc + 0.001) * min(length(u_cursorVel) * 0.008, 4.5);
    d += push * fall;
    p -= d * cA.g;
  }
#ifdef CLOTH
  if (cC.r > 0.002) p -= clothDisp(p) * cC.r;
#endif
#ifdef CLOUD
  if (cB.g > 0.002) {
    float t = u_time * 0.045;
    vec2 q = p * 0.0062;
    vec2 bill = vec2(fbm(q + vec2(t, 0.0)) - 0.5, fbm(q + vec2(5.2, 1.3) - vec2(0.0, t * 0.8)) - 0.5);
    p -= (bill * u_amp.z + vec2(sin(u_time * 0.11 + p.y * 0.01) * u_amp.z * 0.35, 0.0)) * cB.g;
  }
#endif
  float crest = 0.0;
  if (cB.r > 0.002) p -= rippleDisp(p, crest) * cB.r;

  vec3 col = img(p);

#ifdef FLOW
  if (cA.r > 0.01) col = mix(col, flowColor(p, col), cA.r);
#endif

  // still water: glints + ripple crests
  if (cB.r > 0.01) {
    // sun glints: sparse, horizontally stretched, and only where the reflection is already bright
    float gl = pow(vnoise(p * vec2(0.045, 0.5) + vec2(u_time * 0.5, -u_time * 0.1)), 16.0);
    gl *= smoothstep(0.35, 0.75, vnoise(p * 0.006 + vec2(u_time * 0.05, 0.0)));
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col += (gl * smoothstep(0.3, 0.75, lum) * 1.6 + crest * 0.2) * cB.r * vec3(1.0, 0.95, 0.9);
  }

#ifdef SUN
  {
    float s = fract(u_time / 16.0);
    vec2 uv = p / u_size;
    float sweep = exp(-pow((dot(uv, normalize(vec2(1.0, -0.75))) - mix(-0.5, 1.2, s)) * 6.0, 2.0));
    float breath = 0.5 + 0.5 * sin(u_time * 0.42);
    float shimmer = vnoise(p * 0.01 + vec2(u_time * 0.08, 0.0));
    col *= 1.0 + cB.b * (0.05 * breath + 0.12 * sweep + 0.05 * (shimmer - 0.5));
  }
#endif
#ifdef RAYS
  {
    vec2 rd = normalize(u_rayDir);
    float k = dot(p, vec2(-rd.y, rd.x));
    float along = dot(p, rd);
    float st = vnoise(vec2(k * 0.022, u_time * 0.16)) * 0.65 + vnoise(vec2(k * 0.06 + 4.0, along * 0.002 - u_time * 0.1)) * 0.35;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col *= 1.0 + cB.b * (st - 0.42) * 0.55 * smoothstep(0.08, 0.35, lum);
    col += vec3(1.0, 0.82, 0.5) * cB.b * (st - 0.3) * 0.06;
    // dust only shows where the beam actually lights it
    float beam = smoothstep(0.02, 0.12, (col.r + col.g) * 0.5 - col.b) * st;
    col += vec3(1.0, 0.88, 0.62) * motes(p, 0.034, vec2(0.04, -0.07)) * cB.b * beam * 1.4;
  }
#endif

#ifdef MIST_RISE
  if (cC.g > 0.01) {
    float m = fbm(p * vec2(0.0075, 0.006) + vec2(sin(u_time * 0.2) * 0.3, u_time * 0.22));
    float m2 = fbm(p * 0.014 + vec2(3.0, u_time * 0.45));
    float a = smoothstep(0.38, 0.9, m * 0.65 + m2 * 0.45) * cC.g * 0.55;
    col = mix(col, vec3(0.94, 0.93, 1.0), a);
    col += vec3(0.95, 0.97, 1.0) * motes(p, 0.08, vec2(0.08, 0.5)) * cC.g * 0.5;
  }
#endif
#ifdef MIST_DRIFT
  if (cC.g > 0.01) {
    float m = fbm(p * vec2(0.0032, 0.011) + vec2(-u_time * 0.025, sin(u_time * 0.05) * 0.2));
    float a = smoothstep(0.45, 0.85, m) * cC.g * 0.3;
    col = mix(col, vec3(0.78, 0.7, 0.95), a);
  }
#endif
#ifdef CLOUD
  {
    // thin high wisps drifting across the open sky
    float sky = (1.0 - smoothstep(0.03, 0.12, c0.b)) * (1.0 - cB.g) * smoothstep(0.62, 0.3, p0.y / u_size.y);
    if (sky > 0.01) {
      float w = fbm(p0 * vec2(0.0021, 0.0105) + vec2(-u_time * 0.016, 0.0));
      float w2 = fbm(p0 * vec2(0.004, 0.02) + vec2(-u_time * 0.028, 3.0));
      float a = smoothstep(0.58, 0.86, w * 0.7 + w2 * 0.35) * sky * 0.22;
      col = mix(col, vec3(0.86, 0.66, 0.85), a);
    }
  }
#endif
#ifdef STARS
  if (cC.b > 0.01) {
    float tw = 0.5 + 0.5 * sin(u_time * (2.0 + hash12(floor(p0 / 4.0)) * 3.0) + hash12(floor(p0 / 4.0) + 9.0) * 6.28);
    col += cC.b * (tw - 0.35) * 0.55 * vec3(1.0, 0.95, 0.85);
  }
#endif

  gl_FragColor = vec4(col * u_fade, u_fade);
}
`;
}

// Deer head + neck: a skinned grid mesh drawn over the plate.
export const DEER_VS = `
attribute vec2 a_pos;
uniform vec3 u_view;
uniform vec2 u_canvas;
uniform vec4 u_cut;
uniform float u_blend;
uniform vec4 u_jaw;
uniform vec2 u_shoulder;
uniform vec2 u_head;
uniform float u_neckRot;
uniform float u_headRot;
uniform vec2 u_shift;
uniform vec4 u_bA; // breathing puppet: c.xy ax.xy
uniform vec4 u_bB; // pivot.xy, feather, scaleY
varying vec2 v_rest;
float lineDist(vec2 p, vec2 a, vec2 b){ vec2 d = b - a; return -(d.x * (p.y - a.y) - d.y * (p.x - a.x)) / length(d); }
vec2 rot(vec2 p, vec2 c, float a){ float s = sin(a), co = cos(a); p -= c; return c + vec2(co * p.x - s * p.y, s * p.x + co * p.y); }
void main(){
  vec2 p = a_pos;
  float wN = smoothstep(0.0, u_blend, lineDist(p, u_cut.xy, u_cut.zw));
  float wH = smoothstep(-6.0, 12.0, lineDist(p, u_jaw.xy, u_jaw.zw));
  vec2 q = rot(p, u_shoulder, u_neckRot * wN);
  vec2 hj = rot(u_head, u_shoulder, u_neckRot);
  q = rot(q, hj, u_headRot * wH * wN);
  vec2 l = (p - u_bA.xy) / u_bA.zw;
  float wb = 1.0 - smoothstep(1.0 - u_bB.z, 1.0, length(l));
  q.y = u_bB.y + (q.y - u_bB.y) * (1.0 + u_bB.w * wb);
  q += u_shift;
  v_rest = a_pos;
  vec2 dev = u_view.xy + q * u_view.z;
  gl_Position = vec4(dev.x / u_canvas.x * 2.0 - 1.0, 1.0 - dev.y / u_canvas.y * 2.0, 0.0, 1.0);
}
`;

export const DEER_FS = `
precision highp float;
uniform sampler2D u_sprite;
uniform vec4 u_rect;
uniform vec4 u_earL;
uniform vec4 u_earR;
uniform vec2 u_earRot;
uniform vec4 u_eyes;
uniform vec3 u_eyeR; // rx, ry, blink 0..1
uniform float u_fade;
varying vec2 v_rest;
vec2 earWarp(vec2 p, vec4 ear, float a){
  vec2 base = ear.xy; vec2 ax = ear.zw - base; float L = length(ax);
  float t = dot(p - base, ax) / (L * L);
  float side = abs(ax.x * (p.y - base.y) - ax.y * (p.x - base.x)) / L;
  float w = smoothstep(-0.05, 0.4, t) * (1.0 - smoothstep(L * 0.5, L * 0.85, side));
  float s = sin(-a * w), c = cos(-a * w); vec2 d = p - base;
  return base + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
}
vec4 spr(vec2 p){ return texture2D(u_sprite, (p - u_rect.xy) / u_rect.zw); }
vec4 lid(vec4 c, vec2 p, vec2 e){
  vec2 d = (p - e) / u_eyeR.xy;
  float r = length(d);
  if (r > 1.25 || u_eyeR.z <= 0.001) return c;
  float closed = step((d.y + 1.25) / 2.5, u_eyeR.z);
  vec4 fur = spr(e + vec2(0.0, -u_eyeR.y * 2.4));
  float m = closed * (1.0 - smoothstep(1.0, 1.25, r));
  return mix(c, fur * c.a, m);
}
void main(){
  vec2 p = earWarp(v_rest, u_earL, u_earRot.x);
  p = earWarp(p, u_earR, u_earRot.y);
  vec4 c = spr(p);
  c = lid(c, p, u_eyes.xy);
  c = lid(c, p, u_eyes.zw);
  gl_FragColor = c * u_fade;
}
`;
