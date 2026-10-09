import { DEER_FS, DEER_VS, MAX_PUPPETS, MAX_RIPPLES, QUAD_VS, plateFS } from './shaders';
import type { DeerPose, PuppetPose, VariantData } from './types';

type GL = WebGLRenderingContext;

export interface FrameUniforms {
  time: number;
  look: [number, number];
  parallax: number;
  wind: number;
  cursor: [number, number, number, number];
  cursorVel: [number, number];
  ripples: Float32Array; // MAX_RIPPLES * 4
  puppets: Record<string, PuppetPose>;
  amp: [number, number, number, number];
  flow: [number, number, number, number];
  fade: number;
  deer?: DeerPose;
}

function compile(gl: GL, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader compile failed: ${log}`);
  }
  return s;
}

function program(gl: GL, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link failed: ${gl.getProgramInfoLog(p)}`);
  return p;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

function texture(gl: GL, img: HTMLImageElement, opts: { raw?: boolean; premultiply?: boolean }) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!opts.premultiply);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, opts.raw ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
  gl.texImage2D(gl.TEXTURE_2D, 0, opts.premultiply ? gl.RGBA : gl.RGB, opts.premultiply ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export class LivingRenderer {
  private gl: GL;
  private plateProg!: WebGLProgram;
  private deerProg?: WebGLProgram;
  private quad!: WebGLBuffer;
  private deerVB?: WebGLBuffer;
  private deerIB?: WebGLBuffer;
  private deerCount = 0;
  private tex: { img?: WebGLTexture; ctrl?: WebGLTexture; sprite?: WebGLTexture } = {};
  private u: Record<string, WebGLUniformLocation | null> = {};
  private du: Record<string, WebGLUniformLocation | null> = {};
  private puppetNames: string[];
  private pA: Float32Array;
  private pB: Float32Array;
  private pC: Float32Array;
  private pT: Float32Array;
  private view: [number, number, number] = [0, 0, 1];
  lost = false;

  constructor(private canvas: HTMLCanvasElement, private data: VariantData) {
    const gl = (canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' }) ||
      canvas.getContext('experimental-webgl')) as GL | null;
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.puppetNames = Object.keys(data.puppets).slice(0, MAX_PUPPETS);
    this.pA = new Float32Array(MAX_PUPPETS * 4);
    this.pB = new Float32Array(MAX_PUPPETS * 4);
    this.pC = new Float32Array(MAX_PUPPETS * 4);
    this.pT = new Float32Array(MAX_PUPPETS);
    this.puppetNames.forEach((n, i) => {
      const p = data.puppets[n];
      this.pA.set([p.c[0], p.c[1], p.ax[0], p.ax[1]], i * 4);
      this.pB.set([p.pivot[0], p.pivot[1], p.angle, p.feather], i * 4);
      this.pT[i] = p.taper;
    });
    canvas.addEventListener('webglcontextlost', this.onLost);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  async load() {
    const gl = this.gl;
    const f = this.data.features;
    const defs: string[] = [];
    if (f.flow) defs.push('FLOW');
    if (f.cloud) defs.push('CLOUD');
    if (f.cloth) defs.push('CLOTH');
    if (f.stars) defs.push('STARS');
    if (f.mist === 'rise') defs.push('MIST_RISE');
    if (f.mist === 'drift') defs.push('MIST_DRIFT');
    if (f.glow === 'sun') defs.push('SUN');
    if (f.glow === 'rays') defs.push('RAYS');
    this.plateProg = program(gl, QUAD_VS, plateFS(defs));
    for (const name of ['u_img', 'u_ctrl', 'u_size', 'u_view', 'u_canvasH', 'u_time', 'u_look', 'u_parallax', 'u_wind', 'u_cursor', 'u_cursorVel', 'u_ripple', 'u_pA', 'u_pB', 'u_pC', 'u_pT', 'u_pCount', 'u_amp', 'u_flow', 'u_rayDir', 'u_fade'])
      this.u[name] = gl.getUniformLocation(this.plateProg, name);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const deer = this.data.deer;
    const [plate, ctrl, sprite] = await Promise.all([
      loadImage(this.data.plate),
      loadImage(this.data.ctrl),
      deer ? loadImage(deer.sprite) : Promise.resolve(null),
    ]);
    this.tex.img = texture(gl, plate, {});
    this.tex.ctrl = texture(gl, ctrl, { raw: true });
    if (deer && sprite) {
      this.tex.sprite = texture(gl, sprite, { premultiply: true });
      this.deerProg = program(gl, DEER_VS, DEER_FS);
      for (const name of ['u_view', 'u_canvas', 'u_cut', 'u_blend', 'u_jaw', 'u_shoulder', 'u_head', 'u_neckRot', 'u_headRot', 'u_shift', 'u_bA', 'u_bB', 'u_sprite', 'u_rect', 'u_earL', 'u_earR', 'u_earRot', 'u_eyes', 'u_eyeR', 'u_fade'])
        this.du[name] = gl.getUniformLocation(this.deerProg, name);
      // grid mesh over the sprite rectangle, in image pixels
      const [rx, ry, rw, rh] = deer.rect;
      const nx = 30, ny = 34;
      const verts = new Float32Array((nx + 1) * (ny + 1) * 2);
      let k = 0;
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { verts[k++] = rx + (rw * i) / nx; verts[k++] = ry + (rh * j) / ny; }
      const idx = new Uint16Array(nx * ny * 6);
      k = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.set([a, b, c, b, d, c], k);
        k += 6;
      }
      this.deerVB = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.deerVB);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      this.deerIB = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.deerIB);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      this.deerCount = idx.length;
    }
  }

  /** Size the drawing buffer and set the image->canvas mapping (CSS px). */
  layout(cssW: number, cssH: number, dpr: number, offX: number, offY: number, scale: number) {
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.view = [offX * dpr, offY * dpr, scale * dpr];
  }

  render(f: FrameUniforms) {
    if (this.lost || !this.tex.img) return;
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.plateProg);
    const u = this.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.img!);
    gl.uniform1i(u.u_img, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.ctrl!);
    gl.uniform1i(u.u_ctrl, 1);
    gl.uniform2f(u.u_size, this.data.size[0], this.data.size[1]);
    gl.uniform3f(u.u_view, this.view[0], this.view[1], this.view[2]);
    gl.uniform1f(u.u_canvasH, H);
    gl.uniform1f(u.u_time, f.time);
    gl.uniform2f(u.u_look, f.look[0], f.look[1]);
    gl.uniform1f(u.u_parallax, f.parallax);
    gl.uniform1f(u.u_wind, f.wind);
    gl.uniform4f(u.u_cursor, f.cursor[0], f.cursor[1], f.cursor[2], f.cursor[3]);
    gl.uniform2f(u.u_cursorVel, f.cursorVel[0], f.cursorVel[1]);
    gl.uniform4fv(u.u_ripple, f.ripples);
    this.puppetNames.forEach((n, i) => {
      const p = f.puppets[n];
      this.pC.set(p ? [p.rot, p.tx, p.ty, p.sy] : [0, 0, 0, 0], i * 4);
    });
    gl.uniform4fv(u.u_pA, this.pA);
    gl.uniform4fv(u.u_pB, this.pB);
    gl.uniform4fv(u.u_pC, this.pC);
    gl.uniform1fv(u.u_pT, this.pT);
    gl.uniform1i(u.u_pCount, this.puppetNames.length);
    gl.uniform4f(u.u_amp, f.amp[0], f.amp[1], f.amp[2], f.amp[3]);
    gl.uniform4f(u.u_flow, f.flow[0], f.flow[1], f.flow[2], f.flow[3]);
    const rd = this.data.rayDir || [1, 0.6];
    gl.uniform2f(u.u_rayDir, rd[0], rd[1]);
    gl.uniform1f(u.u_fade, f.fade);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(this.plateProg, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const deer = this.data.deer;
    if (deer && this.deerProg && f.deer && this.tex.sprite) {
      const d = f.deer, du = this.du;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.deerProg);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.sprite);
      gl.uniform1i(du.u_sprite, 2);
      gl.uniform3f(du.u_view, this.view[0], this.view[1], this.view[2]);
      gl.uniform2f(du.u_canvas, W, H);
      gl.uniform4f(du.u_cut, deer.cut[0][0], deer.cut[0][1], deer.cut[1][0], deer.cut[1][1]);
      gl.uniform1f(du.u_blend, deer.blend);
      gl.uniform4f(du.u_jaw, deer.jaw[0][0], deer.jaw[0][1], deer.jaw[1][0], deer.jaw[1][1]);
      gl.uniform2f(du.u_shoulder, deer.shoulder[0], deer.shoulder[1]);
      gl.uniform2f(du.u_head, deer.head[0], deer.head[1]);
      gl.uniform1f(du.u_neckRot, d.neckRot);
      gl.uniform1f(du.u_headRot, d.headRot);
      gl.uniform2f(du.u_shift, d.shift[0], d.shift[1]);
      const b = this.data.puppets.deerBreath;
      const bp = f.puppets.deerBreath;
      if (b) {
        gl.uniform4f(du.u_bA, b.c[0], b.c[1], b.ax[0], b.ax[1]);
        gl.uniform4f(du.u_bB, b.pivot[0], b.pivot[1], b.feather, bp ? bp.sy : 0);
      } else {
        gl.uniform4f(du.u_bA, 0, 0, 1, 1);
        gl.uniform4f(du.u_bB, 0, 0, 0.3, 0);
      }
      gl.uniform4f(du.u_rect, deer.rect[0], deer.rect[1], deer.rect[2], deer.rect[3]);
      gl.uniform4f(du.u_earL, deer.ears[0].base[0], deer.ears[0].base[1], deer.ears[0].tip[0], deer.ears[0].tip[1]);
      gl.uniform4f(du.u_earR, deer.ears[1].base[0], deer.ears[1].base[1], deer.ears[1].tip[0], deer.ears[1].tip[1]);
      gl.uniform2f(du.u_earRot, d.earRot[0], d.earRot[1]);
      gl.uniform4f(du.u_eyes, deer.eyes[0][0], deer.eyes[0][1], deer.eyes[1][0], deer.eyes[1][1]);
      gl.uniform3f(du.u_eyeR, deer.eyeR[0], deer.eyeR[1], d.blink);
      gl.uniform1f(du.u_fade, f.fade);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.deerVB!);
      const dl = gl.getAttribLocation(this.deerProg, 'a_pos');
      gl.enableVertexAttribArray(dl);
      gl.vertexAttribPointer(dl, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.deerIB!);
      gl.drawElements(gl.TRIANGLES, this.deerCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  destroy() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}

export const RIPPLE_SLOTS = MAX_RIPPLES;
