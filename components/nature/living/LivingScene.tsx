'use client';
import { useEffect, useRef, useState } from 'react';
import { ART_MANIFEST } from './art-manifest';
import { createDirector, type PointerState } from './behaviors';
import { Flock } from './flock';
import { LivingRenderer, RIPPLE_SLOTS } from './renderer';
import type { SceneKind, VariantData } from './types';

const MOBILE_ART = '(max-width: 760px)'; // must match the <picture> source media
const OVERSCAN = 1.018; // a little bleed so parallax never samples past the painting's edge
const INTERACTIVE = 'a,button,input,select,textarea,summary,details,dialog,[role="button"]';

function objectPosition(img: HTMLImageElement): [number, number] {
  const words: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  const parts = getComputedStyle(img).objectPosition.split(/\s+/);
  const read = (v: string | undefined) => (v === undefined ? 0.5 : v in words ? words[v] : v.endsWith('%') ? parseFloat(v) / 100 : 0.5);
  return [read(parts[0]), read(parts[1])];
}

/**
 * Turns the still painting in the surrounding `.scene-art` into a living one:
 * WebGL for the painting itself (water, wind, cloth, clouds, light, puppets,
 * the deer) and an SVG layer of flying birds. The plain image stays underneath
 * as the fallback when motion is reduced or WebGL is unavailable.
 */
export default function LivingScene({ scene }: { scene: SceneKind }) {
  const [variant, setVariant] = useState<'desktop' | 'mobile' | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const q = window.matchMedia(MOBILE_ART);
    const sync = () => setVariant(q.matches ? 'mobile' : 'desktop');
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);

  if (!variant) return null;
  return <LivingLayer key={variant} scene={scene} mobile={variant === 'mobile'} />;
}

function LivingLayer({ scene, mobile }: { scene: SceneKind; mobile: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const root = wrap.current, canvas = canvasRef.current, svg = svgRef.current;
    const section = root?.closest('section');
    const img = root?.parentElement?.querySelector('img');
    if (!root || !canvas || !svg || !section || !img) return;

    const data = ART_MANIFEST[`${scene}${mobile ? '-mobile' : ''}` as keyof typeof ART_MANIFEST] as unknown as VariantData;
    const [IW, IH] = data.size;
    const unit = IW / 1672;
    const portrait = IW < IH;
    const director = createDirector(scene, data);
    const view = { offX: 0, offY: 0, scale: 1, boxW: 1, boxH: 1 };
    const ripples = new Float32Array(RIPPLE_SLOTS * 4);
    const look: [number, number] = [0, 0];
    const pointer: PointerState = { x: -1e4, y: -1e4, active: false, speed: 0 };
    const vel: [number, number] = [0, 0];
    const prev = { x: NaN, y: NaN };
    const client = { x: 0, y: 0, inside: false, lastMove: 0 };
    const fine = window.matchMedia('(pointer: fine)').matches;
    // ?living-realtime keeps simulated time in step with the wall clock on very slow (software) GL
    const maxDt = /[?&]living-realtime\b/.test(window.location.search) ? 1 : 0.05;
    const parallax = (scene === 'hero' ? 26 : 22) * unit * (portrait ? 1.25 : 1);
    const amp: [number, number, number, number] = portrait ? [8.5, 8, 7, 1.6] : [7, 7, 6, 1.4];
    const flow: [number, number, number, number] = [0.85, 80 * (portrait ? 1.1 : 1), 2.4, 0];

    let disposed = false, running = false, visible = false, raf = 0;
    let renderer: LivingRenderer | null = null;
    let flock: Flock | null = null;
    let rippleSlot = 0, t = 0, last = 0;
    // adaptive resolution: weaker GPUs trade sharpness for a steady frame rate
    let quality = 1, frameAvg = 1 / 60, slowFor = 0, fastFor = 0;
    let wind = 0.85, gust = 0, gustT = -99, nextGust = 4, scrollBoost = 0, lastScroll = window.scrollY;

    const spawnRipple = (x: number, y: number, a: number) => {
      ripples.set([x, y, t, a], rippleSlot * 4);
      rippleSlot = (rippleSlot + 1) % RIPPLE_SLOTS;
    };

    const layout = () => {
      const boxW = root.clientWidth, boxH = root.clientHeight;
      if (!boxW || !boxH) return;
      const scale = Math.max(boxW / IW, boxH / IH) * OVERSCAN;
      const [px, py] = objectPosition(img);
      Object.assign(view, { boxW, boxH, scale, offX: (boxW - IW * scale) * px, offY: (boxH - IH * scale) * py });
      // The paintings carry ~1 detail per source pixel: render no finer than that.
      const dpr = Math.max(0.5, Math.max(0.75, Math.min(window.devicePixelRatio || 1, 1.5, 1.1 / scale)) * quality);
      renderer?.layout(boxW, boxH, dpr, view.offX, view.offY, scale);
      Object.assign(svg.style, { left: `${view.offX}px`, top: `${view.offY}px`, width: `${IW * scale}px`, height: `${IH * scale}px` });
    };

    // client px -> painting px (accounts for GSAP's transforms on .scene-art)
    const toImage = (cx: number, cy: number): [number, number] => {
      const r = root.getBoundingClientRect();
      const k = view.boxW / (r.width || 1);
      return [((cx - r.left) * k - view.offX) / view.scale, ((cy - r.top) * k - view.offY) / view.scale];
    };

    const onMove = (e: PointerEvent) => {
      Object.assign(client, { x: e.clientX, y: e.clientY, inside: true, lastMove: performance.now() });
      [pointer.x, pointer.y] = toImage(e.clientX, e.clientY);
      pointer.active = true;
    };
    const onLeave = () => {
      client.inside = false;
      pointer.active = false;
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest(INTERACTIVE)) return;
      const [x, y] = toImage(e.clientX, e.clientY);
      if (director.tap) director.tap(x, y, { t, dt: 0, wind, pointer, spawnRipple });
      else spawnRipple(x, y, 1);
      flock?.tap(x, y);
      if (e.pointerType !== 'mouse') {
        Object.assign(pointer, { x, y, active: true });
        client.lastMove = performance.now();
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!running || !renderer || renderer.lost) return;
      const raw = last ? (now - last) / 1000 : 1 / 60;
      const dt = Math.min(maxDt, raw);
      last = now;
      t += dt;
      frameAvg += (Math.min(raw, 0.2) - frameAvg) * 0.05;
      slowFor = frameAvg > 1 / 42 ? slowFor + raw : 0;
      fastFor = frameAvg < 1 / 57 ? fastFor + raw : 0;
      if ((slowFor > 1.5 && quality > 0.55) || (fastFor > 6 && quality < 1)) {
        quality = slowFor > 1.5 ? quality * 0.82 : Math.min(1, quality * 1.12);
        slowFor = fastFor = 0;
        layout();
      }

      // wind: slow swell, occasional gusts, and a push when the page scrolls fast
      if (t > nextGust) {
        gustT = t;
        nextGust = t + 6 + Math.random() * 9;
        gust = 0.45 + Math.random() * 0.5;
      }
      const ga = t - gustT;
      const gustNow = gust * Math.min(1, ga / 1.3) * Math.exp(-Math.max(0, ga - 1.3) / 2.6);
      const sv = Math.abs(window.scrollY - lastScroll) / dt;
      lastScroll = window.scrollY;
      scrollBoost += (Math.min(0.9, sv / 2600) - scrollBoost) * Math.min(1, dt * (sv > 0 ? 6 : 1.5));
      wind = 0.82 + 0.22 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.1) + gustNow + scrollBoost;

      // touch has no hover: let the last touch linger, then let go
      if (!fine && pointer.active && performance.now() - client.lastMove > 2500) pointer.active = false;

      // camera: follows the mouse, drifts on its own otherwise; scrolling adds vertical depth
      const r = section.getBoundingClientRect();
      const prog = Math.min(1, Math.max(0, (window.innerHeight - r.top) / (window.innerHeight + r.height)));
      let lx = 0.32 * Math.sin(t * 0.13), ly = 0.2 * Math.sin(t * 0.09 + 1);
      if (fine && client.inside) {
        lx = -(client.x / window.innerWidth - 0.5) * 1.7;
        ly = -(client.y / window.innerHeight - 0.5) * 1.3;
      }
      ly -= (prog - 0.5) * 1.1;
      const kl = 1 - Math.exp(-dt * 2.4);
      look[0] += (lx - look[0]) * kl;
      look[1] += (ly - look[1]) * kl;

      // pointer velocity drives the wake it leaves in grass and leaves
      if (pointer.active && !Number.isNaN(prev.x)) {
        const k = Math.min(1, dt * 10);
        vel[0] += ((pointer.x - prev.x) / dt - vel[0]) * k;
        vel[1] += ((pointer.y - prev.y) / dt - vel[1]) * k;
      } else {
        vel[0] *= 0.9;
        vel[1] *= 0.9;
      }
      prev.x = pointer.active ? pointer.x : NaN;
      prev.y = pointer.y;
      pointer.speed = Math.hypot(vel[0], vel[1]);

      director.update({ t, dt, wind, pointer, spawnRipple });
      if (director.deer) director.deer.shift = [look[0] * 0.21 * parallax, look[1] * 0.21 * parallax];
      renderer.render({
        time: t,
        look,
        parallax,
        wind,
        cursor: [pointer.x, pointer.y, 95 * unit * (portrait ? 1.3 : 1), pointer.active ? Math.min(1, pointer.speed / (500 * unit)) : 0],
        cursorVel: vel,
        ripples,
        puppets: director.puppets,
        amp,
        flow,
        fade: 1,
        deer: director.deer,
      });
      flock?.update(t, dt, [look[0] * -0.35 * parallax, look[1] * -0.35 * parallax], pointer);
      if (!root.classList.contains('is-ready')) {
        root.classList.add('is-ready');
        section.setAttribute('data-living', 'on');
      }
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
      else running = false;
    };

    const start = () => {
      if (running || !renderer || disposed) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !document.hidden) start();
      else stop();
    });
    const ro = new ResizeObserver(layout);
    const onVisibility = () => (document.hidden ? stop() : visible && start());

    const boot = async () => {
      try {
        renderer = new LivingRenderer(canvas, data);
        await renderer.load();
      } catch (err) {
        console.warn('[living art] keeping the still painting:', err);
        renderer?.destroy();
        renderer = null;
        return;
      }
      if (disposed) return;
      if (data.flock) flock = new Flock(svg, data, 'crane');
      else if (scene === 'waterfall') flock = new Flock(svg, data, 'dove');
      layout();
      ro.observe(root);
      io.observe(section);
      section.addEventListener('pointermove', onMove, { passive: true });
      section.addEventListener('pointerleave', onLeave, { passive: true });
      section.addEventListener('pointerdown', onDown, { passive: true });
      document.addEventListener('visibilitychange', onVisibility);
    };
    // Only spin up GL (and fetch the extra textures) once the scene is about a screen away.
    const nearby = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      nearby.disconnect();
      void boot();
    }, { rootMargin: '100% 0px' });
    nearby.observe(section);

    return () => {
      disposed = true;
      stop();
      nearby.disconnect();
      io.disconnect();
      ro.disconnect();
      section.removeEventListener('pointermove', onMove);
      section.removeEventListener('pointerleave', onLeave);
      section.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisibility);
      flock?.destroy();
      renderer?.destroy();
      root.classList.remove('is-ready');
      section.removeAttribute('data-living');
    };
  }, [scene, mobile]);

  return (
    <div ref={wrap} className="living-layer" aria-hidden="true">
      <canvas ref={canvasRef} />
      <svg ref={svgRef} className="living-flock" />
    </div>
  );
}
