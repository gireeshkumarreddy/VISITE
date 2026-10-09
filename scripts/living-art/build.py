#!/usr/bin/env python3
"""Build the "living art" assets used by components/nature/living.

For every scene illustration (desktop + mobile composition) this produces:
  public/art/live/<name>-ctrl.png   control-map atlas, 3 RGB bands stacked vertically:
                                      band 0: flow (waterfall), sway (wind), depth
                                      band 1: ripple (still water), cloud, glow (light)
                                      band 2: cloth (flutter), mist, sparkle (stars)
  public/art/live/<name>-plate.webp clean plate (painted cranes / deer head removed)
  public/art/live/<name>-deer.png   cut-out deer head + neck sprite (forest only)
  components/nature/living/art-manifest.ts  geometry + rig data for the runtime

All coordinates below are in source-image pixels.
Run:  python scripts/living-art/build.py [--preview]
Needs numpy, pillow and opencv-contrib-python (cv2.xphoto).
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(ROOT, "public", "art")
OUT = os.path.join(ART, "live")
MANIFEST = os.path.join(ROOT, "components", "nature", "living", "art-manifest.ts")
PREVIEW = os.path.join(ROOT, ".tmp", "living-preview")
CTRL_SCALE = 0.5


# ----------------------------------------------------------------------------- helpers
def smooth(v, a, b):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(m, s):
    return cv2.GaussianBlur(m, (0, 0), s) if s > 0 else m


def dilate(m, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(m, k)


class Img:
    def __init__(self, name):
        self.name = name
        self.rgb = np.array(Image.open(os.path.join(ART, name + ".webp")).convert("RGB"))
        self.refresh()

    def refresh(self):
        f = self.rgb.astype(np.float32) / 255
        self.H, self.W = f.shape[:2]
        self.r, self.g, self.b = f[..., 0], f[..., 1], f[..., 2]
        self.lum = 0.299 * self.r + 0.587 * self.g + 0.114 * self.b
        self.yy, self.xx = np.mgrid[0 : self.H, 0 : self.W].astype(np.float32)

    def zeros(self):
        return np.zeros((self.H, self.W), np.float32)

    def shape(self, spec):
        """Rasterise a region spec into a 0..1 mask (gain and gradient applied)."""
        m = self.zeros()
        if "poly" in spec:
            cv2.fillPoly(m, [np.round(np.array(spec["poly"], np.float32)).astype(np.int32)], 1.0)
        elif "ellipse" in spec:
            (cx, cy, ax, ay), ang = spec["ellipse"], spec.get("angle", 0)
            cv2.ellipse(m, (int(cx), int(cy)), (int(ax), int(ay)), ang, 0, 360, 1.0, -1)
        elif "rect" in spec:
            x0, y0, x1, y1 = spec["rect"]
            m[int(y0) : int(y1), int(x0) : int(x1)] = 1
        g = spec.get("grad")
        if g:
            axis, p0, v0, p1, v1 = g
            coord = self.yy if axis == "y" else self.xx
            t = np.clip((coord - p0) / (p1 - p0), 0, 1)
            m *= v0 + (v1 - v0) * t
        return m * spec.get("gain", 1.0)

    def union(self, specs):
        m = self.zeros()
        for s in specs or []:
            m = np.maximum(m, self.shape(s))
        return m


# ----------------------------------------------------------------------------- removal
def remove_birds(im, region, extra_boxes=None, min_area=10, max_area=2400):
    """Find painted birds (small high-contrast blobs) in region, inpaint them, return list."""
    x0, y0, x1, y1 = region
    rgb = im.rgb.astype(np.float32)
    bgc = np.stack([cv2.medianBlur(im.rgb[..., k], 31) for k in range(3)], -1).astype(np.float32)
    diff = np.abs(rgb - bgc).sum(-1)
    cand = np.zeros(im.rgb.shape[:2], np.uint8)
    cand[y0:y1, x0:x1] = (diff[y0:y1, x0:x1] > 55).astype(np.uint8)
    # join wing tips to bodies before labelling
    joined = cv2.dilate(cand, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(joined, 8)
    birds, mask = [], np.zeros_like(cand)
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if a < min_area or a > max_area or w > 110 or h > 70 or w < 6:
            continue
        comp = (lab == i) & (cand > 0)
        ys, xs = np.nonzero(comp)
        mask[comp] = 255
        birds.append({
            "x": round(float(xs.mean()), 1), "y": round(float(ys.mean()), 1),
            "w": int(xs.max() - xs.min() + 1), "h": int(ys.max() - ys.min() + 1),
        })
    # Birds overlapping the cloud edge defeat the median test: use colour inside explicit boxes.
    for bx0, by0, bx1, by1 in extra_boxes or []:
        sub = np.zeros_like(cand)
        white = (im.lum > 0.84).astype(np.uint8)
        sub[by0:by1, bx0:bx1] = white[by0:by1, bx0:bx1]
        near = cv2.dilate(sub, np.ones((25, 25), np.uint8)) > 0
        inbox = np.zeros_like(near)
        inbox[by0:by1, bx0:bx1] = True
        tips = near & inbox & ((im.lum < 0.26) | ((im.r - im.b) > 0.12) | (im.lum > 0.8))
        mask[(cv2.dilate(sub, np.ones((5, 5), np.uint8)) > 0) | tips] = 255
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8))
    bgr = cv2.cvtColor(im.rgb, cv2.COLOR_RGB2BGR)
    fixed = cv2.inpaint(bgr, mask, 7, cv2.INPAINT_TELEA)
    im.rgb = cv2.cvtColor(fixed, cv2.COLOR_BGR2RGB)
    im.refresh()
    birds.sort(key=lambda b: b["x"])
    return birds, mask


def line_dist(xx, yy, a, b):
    """Signed distance to the line a->b; positive on the left of travel (image coords)."""
    ax, ay = a
    bx, by = b
    L = math.hypot(bx - ax, by - ay)
    return ((bx - ax) * (yy - ay) - (by - ay) * (xx - ax)) / L * -1


def grabcut(im, poly, core, sure_bg=None, iters=10):
    H, W = im.H, im.W
    poly = np.array(poly, np.int32)
    x, y, w, h = cv2.boundingRect(poly)
    pad = 40
    X0, Y0, X1, Y1 = max(0, x - pad), max(0, y - pad), min(W, x + w + pad), min(H, y + h + pad)
    mask = np.full((H, W), cv2.GC_BGD, np.uint8)
    cv2.fillPoly(mask, [poly], cv2.GC_PR_FGD)
    if sure_bg is not None:
        mask[(mask == cv2.GC_PR_FGD) & sure_bg] = cv2.GC_BGD
    if core is not None:
        cm = np.zeros((H, W), np.uint8)
        cv2.fillPoly(cm, [np.array(core, np.int32)], 1)
        mask[cm == 1] = cv2.GC_FGD
    sub = cv2.cvtColor(im.rgb[Y0:Y1, X0:X1], cv2.COLOR_RGB2BGR)
    m = mask[Y0:Y1, X0:X1].copy()
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(sub, m, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    fg = ((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD)).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n > 1:
        fg = (lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    # close tiny pinholes only (eye highlights); real gaps stay open
    inv = (1 - fg).astype(np.uint8)
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
    for i in range(1, n2):
        if st2[i][4] < 30:
            fg[lab2 == i] = 1
    full = np.zeros((H, W), np.uint8)
    full[Y0:Y1, X0:X1] = fg
    return full


def deer_masks(im, spec):
    # Lavender/blue rock and the pale waterfall never belong to the deer;
    # cream spots are warmer (r > b) than the pinkish-white falls.
    never = (((im.b - im.r) > 0.03) & (im.lum > 0.18)) | ((im.lum > 0.8) & ((im.r - im.b) < 0.06))
    head = grabcut(im, spec["poly"], spec["core"], never)
    body = grabcut(im, spec["body"], spec["core"], never, iters=6)
    # GrabCut drops the thin dark ink outline around the ears; add it back.
    inside = np.zeros_like(head)
    cv2.fillPoly(inside, [np.array(spec["poly"], np.int32)], 1)
    ink = (im.lum < 0.42) & (cv2.dilate(head, np.ones((21, 21), np.uint8)) > 0) & (inside > 0) & ((im.b - im.r) < 0.02)
    head = ((head > 0) | ink).astype(np.uint8)
    head = cv2.morphologyEx(head, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    rig = spec["rig"]
    d = line_dist(im.xx, im.yy, rig["cut"][0], rig["cut"][1])
    head = (head > 0) & (d > -4)
    return head.astype(np.uint8), ((body > 0) | head).astype(np.uint8), d


def deer_sprite(im, head):
    H, W = im.H, im.W
    # sprite colours: push interior colours over the 1-2px fringe to avoid halos
    inner = cv2.erode(head, np.ones((3, 3), np.uint8))
    band = (cv2.dilate(head, np.ones((5, 5), np.uint8)) > 0) & (inner == 0)
    bgr = cv2.cvtColor(im.rgb, cv2.COLOR_RGB2BGR)
    deco = cv2.inpaint(bgr, band.astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
    deco = np.where(inner[..., None] > 0, bgr, deco)
    alpha = np.clip(cv2.GaussianBlur(head.astype(np.float32), (0, 0), 0.7) * 1.15, 0, 1)
    fy, fx = np.nonzero(head)
    sp = 28  # transparent margin so flicking ears can leave the original bbox
    rx0, ry0 = max(0, fx.min() - sp), max(0, fy.min() - sp)
    rx1, ry1 = min(W, fx.max() + sp + 1), min(H, fy.max() + sp + 1)
    sprite = np.dstack([cv2.cvtColor(deco, cv2.COLOR_BGR2RGB), (alpha * 255).astype(np.uint8)])[ry0:ry1, rx0:rx1]
    return sprite, (int(rx0), int(ry0), int(rx1 - rx0), int(ry1 - ry0))


def deer_plate(im, spec, head, deer, d):
    """Replace the head/neck with background so the neck can move away from it."""
    bgr = cv2.cvtColor(im.rgb, cv2.COLOR_RGB2BGR)
    deer_d = cv2.dilate(deer, np.ones((9, 9), np.uint8))
    # fill only from real background: the whole deer is unknown here
    fill = cv2.inpaint(bgr, deer_d * 255, 11, cv2.INPAINT_TELEA).astype(np.float32)
    hole = (cv2.dilate(head, np.ones((13, 13), np.uint8)) > 0) & (d > 1)
    # falling water behind the neck: rebuild vertical streaks from clean columns
    fz = spec.get("fallZone")
    if fz:
        x0, lip, x1, y1 = fz["rect"]
        s0, s1 = fz["src"]
        rng = np.random.default_rng(7)
        block, xs = 9, np.arange(x0, x1)
        offs = {}
        src_cols = []
        for x in xs:
            b = x // block
            if b not in offs:
                offs[b] = int(rng.integers(0, max(1, s1 - s0 - block)))
            src_cols.append(s0 + offs[b] + (x % block))
        streak = bgr[lip:y1, src_cols].astype(np.float32)
        streak = cv2.GaussianBlur(streak, (0, 0), 0.6)
        zone = np.zeros(hole.shape, np.float32)
        zone[lip:y1, x0:x1] = 1
        zone = cv2.GaussianBlur(zone, (0, 0), 3)
        canvas = fill.copy()
        canvas[lip:y1, x0:x1] = streak
        fill = fill * (1 - zone[..., None]) + canvas * zone[..., None]
    # painterly grain so the filled area doesn't read as airbrushed
    grain = cv2.GaussianBlur(np.random.default_rng(3).normal(0, 4.5, fill.shape).astype(np.float32), (0, 0), 0.8)
    fill = fill + grain
    soft = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 1.5)[..., None]
    soft = np.maximum(soft, hole[..., None].astype(np.float32))
    out = bgr.astype(np.float32) * (1 - soft) + fill * soft
    im.rgb = cv2.cvtColor(out.clip(0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB)
    im.refresh()


# ----------------------------------------------------------------------------- channels
def stars(im, sky):
    l8 = (im.lum * 255).astype(np.uint8)
    med = cv2.medianBlur(l8, 7).astype(np.float32) / 255
    s = ((im.lum - med) > 0.1).astype(np.float32) * im.union(sky)
    return np.clip(blur(dilate(s, 1), 0.8) * 1.6, 0, 1)


def build_channels(im, cfg):
    ex = im.union(cfg.get("exclude"))
    keep = 1 - np.clip(blur(ex, 3), 0, 1)

    ch = {}
    # waterfall flow: polygon ∩ bright pixels, minus rocks in front
    f = im.union(cfg.get("flow"))
    lo, hi = cfg.get("flowLum", (0.62, 0.72))
    f = f * smooth(im.lum, lo, hi) * (1 - im.union(cfg.get("flowExclude")))
    # Let water start moving a little below every lip / rock bottom, otherwise the
    # flow drags those horizontal edges down into wavy copies.
    wet = f > 0.35
    run = np.zeros_like(f)
    acc = np.zeros(im.W, np.float32)
    for y in range(im.H):
        acc = np.where(wet[y], acc + 1, 0)
        run[y] = acc
    ramp = cfg.get("flowRamp", 26 * im.W / 1672)
    f = f * smooth(run, 2, ramp)
    ch["flow"] = np.clip(blur(f, 1.2), 0, 1) * keep

    sw = im.union(cfg.get("sway")) * (1 - im.union(cfg.get("swayExclude")))
    ch["sway"] = np.clip(blur(sw, 6), 0, 1) * keep

    d = np.full((im.H, im.W), cfg.get("depthBase", 0.0), np.float32)
    for spec in cfg.get("depth", []):
        m = im.shape({k: v for k, v in spec.items() if k not in ("v", "grad")})
        val = spec.get("v", 0)
        if "grad" in spec:
            axis, p0, v0, p1, v1 = spec["grad"]
            coord = im.yy if axis == "y" else im.xx
            val = v0 + (v1 - v0) * np.clip((coord - p0) / (p1 - p0), 0, 1)
        d = np.where(m > 0, val, d)
    ch["depth"] = blur(d.astype(np.float32), 9)

    rp = im.union(cfg.get("ripple")) * (1 - im.union(cfg.get("rippleExclude")))
    if "rippleLum" in cfg:
        rp *= smooth(im.lum, *cfg["rippleLum"])
    ch["ripple"] = np.clip(blur(rp, 3), 0, 1)

    cl = im.union(cfg.get("cloud"))
    if cl.any():
        cl *= smooth(im.lum, *cfg.get("cloudLum", (0.3, 0.55)))
    ch["cloud"] = np.clip(blur(cl, 3), 0, 1)

    gl = im.union(cfg.get("glow"))
    if cfg.get("glowKey") == "warm":
        warm = smooth(im.r - im.b, 0.02, 0.3) * smooth(im.lum, 0.3, 0.7)
        gl = gl * warm
    ch["glow"] = np.clip(blur(gl, cfg.get("glowBlur", 6)), 0, 1)

    clo = im.union(cfg.get("cloth"))
    ch["cloth"] = np.clip(blur(dilate(clo, 4), 4), 0, 1)

    ch["mist"] = np.clip(blur(im.union(cfg.get("mist")), 18), 0, 1)

    ch["sparkle"] = stars(im, cfg["stars"]) if cfg.get("stars") else im.zeros()
    return ch


def save_ctrl(ch, path):
    bands = [("flow", "sway", "depth"), ("ripple", "cloud", "glow"), ("cloth", "mist", "sparkle")]
    H, W = ch["flow"].shape
    w2, h2 = int(round(W * CTRL_SCALE)), int(round(H * CTRL_SCALE))
    rows = []
    for band in bands:
        rgb = np.dstack([cv2.resize(ch[k], (w2, h2), interpolation=cv2.INTER_AREA) for k in band])
        rows.append((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    Image.fromarray(np.concatenate(rows, 0)).save(path, optimize=True)


def preview(im, ch, cfg, path, extra=None):
    base = im.rgb.astype(np.float32) * 0.45
    tint = {
        "flow": (0, 255, 255), "sway": (60, 255, 60), "ripple": (40, 90, 255), "cloud": (255, 255, 255),
        "glow": (255, 220, 0), "cloth": (255, 30, 30), "mist": (255, 0, 255), "sparkle": (255, 255, 160),
    }
    out = base.copy()
    for k, c in tint.items():
        a = (ch[k] * 0.6)[..., None]
        out = out * (1 - a) + np.array(c, np.float32) * a
    out = out.clip(0, 255).astype(np.uint8)
    for name, p in (cfg.get("puppets") or {}).items():
        cx, cy = p["c"]
        ax, ay = p["ax"]
        cv2.ellipse(out, (int(cx), int(cy)), (int(ax), int(ay)), p.get("angle", 0), 0, 360, (255, 128, 0), 1)
        px, py = p["pivot"]
        cv2.circle(out, (int(px), int(py)), 3, (255, 0, 0), -1)
        cv2.putText(out, name, (int(cx - ax), int(cy - ay - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 200, 120), 1)
    if extra is not None:
        extra(out)
    dep = (np.clip(ch["depth"], 0, 1) * 255).astype(np.uint8)
    dep = np.dstack([dep] * 3)
    scale = 900 / max(im.W, im.H)
    a = cv2.resize(out, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    b = cv2.resize(dep, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    sheet = np.concatenate([a, b], 1 if im.W < im.H else 0)
    Image.fromarray(sheet).save(path)


# ----------------------------------------------------------------------------- scene data
def P(*pts):
    return {"poly": list(pts)}


HERO_D = {
    "src": "hero",
    "birds": (495, 295, 1095, 380),
    "birdBoxes": [(772, 296, 872, 352)],
    # painted crane positions (centre x, y, wingspan, gliding) -> animated flock start
    "flock": [(538, 331, 42, 0), (635, 358, 42, 0), (718, 314, 54, 1), (737, 357, 36, 0), (802, 318, 34, 0), (797, 338, 34, 0),
              (848, 312, 30, 0), (875, 342, 48, 1), (956, 340, 32, 0), (1005, 321, 46, 0), (1060, 313, 32, 1)],
    "depth": [
        {"poly": [(0, 560), (150, 500), (400, 430), (600, 330), (800, 210), (950, 170), (1100, 150), (1240, 120), (1320, 110), (1450, 160), (1672, 240), (1672, 941), (0, 941)], "v": 0.2},
        {"poly": [(0, 590), (100, 560), (200, 525), (300, 545), (450, 600), (550, 640), (650, 600), (790, 560), (900, 600), (1000, 640), (1110, 615), (1200, 640), (1300, 600), (1400, 520), (1530, 430), (1672, 470), (1672, 941), (0, 941)], "v": 0.36},
        {"poly": [(0, 742), (1000, 742), (1000, 941), (0, 941)], "grad": ("y", 742, 0.44, 941, 0.62)},
        {"poly": [(0, 752), (110, 760), (190, 795), (280, 850), (318, 900), (310, 941), (0, 941)], "v": 0.68},
        {"poly": [(770, 941), (800, 895), (850, 845), (905, 785), (955, 740), (1005, 695), (1055, 662), (1115, 645), (1180, 640), (1240, 648), (1285, 662), (1290, 700), (1300, 725), (1440, 712), (1470, 700), (1520, 670), (1570, 625), (1620, 595), (1672, 575), (1672, 941)], "grad": ("y", 600, 0.82, 941, 1.0)},
        {"poly": [(1278, 474), (1442, 474), (1446, 548), (1452, 590), (1600, 575), (1612, 640), (1565, 695), (1470, 705), (1455, 770), (1290, 775), (1276, 700), (1272, 600), (1276, 540)], "v": 0.86},
    ],
    "sway": [
        {"poly": [(770, 941), (800, 895), (850, 845), (905, 785), (955, 740), (1005, 695), (1055, 662), (1115, 645), (1180, 640), (1240, 648), (1285, 662), (1290, 700), (1300, 725), (1440, 712), (1470, 700), (1520, 670), (1570, 625), (1620, 595), (1672, 575), (1672, 941)], "grad": ("y", 640, 1.0, 941, 0.75)},
    ],
    "swayExclude": [{"poly": [(1282, 474), (1440, 474), (1446, 548), (1452, 600), (1470, 640), (1450, 700), (1300, 712), (1280, 700), (1272, 600)]}],
    "cloth": [
        {"poly": [(1380, 565), (1440, 558), (1500, 572), (1560, 583), (1603, 598), (1608, 632), (1585, 630), (1545, 614), (1485, 602), (1430, 597), (1392, 592)], "grad": ("x", 1388, 0.12, 1605, 1.0)},
        {"poly": [(1428, 610), (1470, 612), (1520, 628), (1562, 648), (1568, 684), (1530, 692), (1478, 683), (1440, 668), (1428, 640)], "grad": ("x", 1430, 0.15, 1565, 0.85)},
        {"poly": [(1276, 600), (1302, 600), (1312, 690), (1305, 762), (1282, 762), (1270, 700)], "gain": 0.28},
    ],
    "cloud": [
        P((0, 520), (60, 505), (150, 498), (230, 478), (330, 450), (430, 428), (520, 378), (600, 318), (680, 278), (760, 228), (830, 188), (900, 168), (965, 178), (985, 250), (900, 330), (820, 420), (760, 470), (700, 520), (560, 560), (400, 575), (250, 565), (120, 565), (0, 565)),
        P((1250, 165), (1290, 118), (1340, 105), (1400, 145), (1450, 185), (1520, 215), (1600, 245), (1672, 265), (1672, 385), (1600, 372), (1500, 302), (1400, 262), (1330, 222), (1280, 205)),
        P((1248, 348), (1280, 328), (1330, 322), (1392, 332), (1438, 378), (1248, 382)),
        {"ellipse": (1040, 174, 50, 7)}, {"ellipse": (950, 208, 58, 7)}, {"ellipse": (815, 218, 32, 6)},
        {"ellipse": (1260, 265, 80, 8)}, {"ellipse": (372, 422, 48, 6)}, {"ellipse": (525, 445, 80, 7)}, {"ellipse": (140, 481, 98, 7)},
    ],
    "cloudLum": (0.3, 0.5),
    "ripple": [{"poly": [(0, 742), (990, 742), (990, 752), (940, 790), (890, 840), (840, 890), (800, 941), (0, 941)], "grad": ("y", 742, 0.45, 941, 1.0)}],
    "rippleExclude": [
        P((378, 800), (392, 768), (430, 760), (462, 775), (475, 815), (460, 828), (385, 828)),
        P((540, 862), (552, 825), (585, 810), (625, 815), (662, 855), (650, 866)),
        P((770, 795), (782, 765), (805, 755), (828, 780), (832, 797)),
    ],
    "rippleLum": (0.2, 0.32),
    "glow": [P((500, 0), (1672, 0), (1672, 640), (500, 640))],
    "glowKey": "warm",
    "mist": [{"poly": [(0, 600), (1120, 600), (1120, 700), (1010, 760), (0, 760)], "grad": ("y", 600, 0.2, 745, 1.0)}],
    "stars": [P((0, 0), (1150, 0), (1100, 120), (950, 170), (700, 270), (500, 330), (300, 420), (0, 470))],
    "puppets": {
        "travBreath": {"c": (1362, 640), "ax": (95, 150), "pivot": (1365, 772), "feather": 0.35},
        "travHat": {"c": (1360, 506), "ax": (100, 46), "pivot": (1358, 550), "feather": 0.3},
    },
    "features": {"cloud": True, "cloth": True, "mist": "drift", "stars": True, "glow": "sun"},
}

HERO_M = {
    "src": "hero-mobile",
    "birds": (170, 755, 615, 835),
    "birdBoxes": [(400, 758, 478, 812)],
    "flock": [(203, 781, 30, 0), (287, 814, 32, 0), (358, 772, 46, 1), (374, 813, 28, 0), (425, 780, 30, 0), (424, 798, 30, 0),
              (460, 771, 18, 0), (478, 803, 42, 1), (532, 804, 24, 0), (572, 788, 36, 0)],
    "depth": [
        {"poly": [(0, 850), (300, 800), (560, 640), (735, 612), (900, 680), (1024, 700), (1024, 1536), (0, 1536)], "v": 0.2},
        {"poly": [(0, 1000), (100, 960), (250, 1040), (430, 990), (600, 1050), (780, 1010), (980, 900), (1024, 920), (1024, 1536), (0, 1536)], "v": 0.36},
        {"poly": [(0, 1187), (1024, 1187), (1024, 1536), (0, 1536)], "grad": ("y", 1187, 0.44, 1536, 0.62)},
        {"poly": [(120, 1536), (200, 1480), (280, 1430), (380, 1360), (480, 1300), (560, 1260), (640, 1225), (720, 1200), (772, 1190), (780, 1250), (800, 1290), (890, 1280), (940, 1230), (980, 1190), (1024, 1160), (1024, 1536)], "grad": ("y", 1160, 0.82, 1536, 1.0)},
        {"poly": [(772, 1088), (886, 1088), (892, 1125), (900, 1150), (985, 1156), (992, 1190), (958, 1232), (900, 1240), (895, 1292), (790, 1296), (772, 1240), (766, 1160)], "v": 0.86},
    ],
    "sway": [{"poly": [(120, 1536), (200, 1480), (280, 1430), (380, 1360), (480, 1300), (560, 1260), (640, 1225), (720, 1200), (772, 1190), (780, 1250), (800, 1290), (890, 1280), (940, 1230), (980, 1190), (1024, 1160), (1024, 1536)], "grad": ("y", 1190, 1.0, 1536, 0.75)}],
    "swayExclude": [{"poly": [(774, 1088), (886, 1088), (892, 1125), (905, 1170), (900, 1250), (800, 1262), (772, 1240), (766, 1160)]}],
    "cloth": [
        {"poly": [(828, 1138), (880, 1136), (930, 1146), (975, 1156), (994, 1170), (990, 1192), (960, 1186), (920, 1176), (880, 1166), (838, 1160)], "grad": ("x", 834, 0.12, 990, 1.0)},
        {"poly": [(888, 1178), (930, 1183), (958, 1203), (962, 1232), (930, 1237), (893, 1226)], "grad": ("x", 890, 0.15, 960, 0.85)},
        {"poly": [(770, 1190), (800, 1190), (808, 1250), (800, 1290), (778, 1290), (766, 1240)], "gain": 0.28},
    ],
    "cloud": [
        P((0, 850), (80, 830), (160, 860), (250, 850), (330, 800), (420, 760), (480, 700), (560, 640), (620, 610), (700, 600), (740, 640), (640, 760), (560, 860), (480, 930), (380, 980), (250, 1000), (0, 960)),
        P((740, 610), (790, 575), (860, 585), (920, 635), (1024, 675), (1024, 805), (940, 785), (860, 725), (780, 685)),
        P((748, 852), (778, 815), (830, 798), (882, 818), (908, 855)),
        {"ellipse": (560, 700, 70, 9)}, {"ellipse": (700, 735, 70, 8)}, {"ellipse": (800, 500, 90, 10)}, {"ellipse": (450, 685, 40, 6)},
        {"ellipse": (100, 590, 80, 9)}, {"ellipse": (120, 750, 90, 9)}, {"ellipse": (100, 820, 80, 8)}, {"ellipse": (640, 625, 50, 6)},
    ],
    "cloudLum": (0.3, 0.5),
    "ripple": [{"poly": [(0, 1186), (765, 1186), (765, 1200), (640, 1225), (560, 1260), (480, 1300), (380, 1360), (280, 1430), (200, 1480), (120, 1536), (0, 1536)], "grad": ("y", 1186, 0.45, 1536, 1.0)}],
    "rippleLum": (0.2, 0.32),
    "glow": [P((300, 0), (1024, 0), (1024, 1050), (300, 1050))],
    "glowKey": "warm",
    "mist": [{"poly": [(0, 1010), (1024, 1010), (1024, 1150), (760, 1190), (0, 1195)], "grad": ("y", 1010, 0.2, 1180, 1.0)}],
    "stars": [P((0, 0), (1024, 0), (1024, 340), (800, 500), (500, 640), (200, 740), (0, 790))],
    "puppets": {
        "travBreath": {"c": (830, 1192), "ax": (72, 110), "pivot": (832, 1298), "feather": 0.35},
        "travHat": {"c": (828, 1106), "ax": (64, 26), "pivot": (826, 1130), "feather": 0.3},
    },
    "features": {"cloud": True, "cloth": True, "mist": "drift", "stars": True, "glow": "sun"},
}

FISHER_D = [(1210, 535), (1340, 535), (1345, 600), (1360, 690), (1290, 722), (1282, 758), (1195, 742), (1200, 700), (1240, 650), (1250, 600)]
WATERFALL_D = {
    "src": "waterfall",
    "flow": [P((205, 0), (505, 0), (500, 90), (495, 400), (498, 560), (470, 700), (440, 765), (220, 765), (212, 600), (200, 400), (195, 200))],
    "flowLum": (0.64, 0.74),
    "flowExclude": [
        P((326, 592), (338, 578), (358, 585), (366, 640), (362, 702), (328, 702)),
        P((450, 440), (470, 425), (490, 432), (498, 470), (498, 702), (452, 702)),
        P((492, 90), (560, 90), (560, 565), (492, 565)),
    ],
    "mist": [{"poly": [(190, 640), (530, 640), (580, 720), (580, 800), (190, 800)], "grad": ("y", 640, 0.25, 745, 1.0)}],
    "ripple": [{"poly": [(440, 775), (520, 765), (700, 790), (800, 800), (900, 790), (1000, 800), (1100, 810), (1200, 800), (1300, 812), (1450, 830), (1505, 862), (1505, 941), (440, 941)], "grad": ("y", 770, 0.6, 941, 1.0)}],
    "rippleLum": (0.36, 0.5),
    "glow": [P((390, 0), (770, 0), (1180, 380), (1230, 570), (920, 650), (560, 610), (480, 300))],
    "glowBlur": 30,
    "sway": [
        {"poly": [(0, 270), (120, 300), (250, 450), (255, 560), (205, 650), (0, 655)], "grad": ("y", 300, 1.0, 655, 0.35)},
        {"poly": [(0, 640), (200, 640), (330, 700), (560, 800), (640, 860), (680, 941), (0, 941)], "grad": ("y", 640, 0.8, 941, 0.45)},
        {"poly": [(560, 560), (640, 530), (720, 540), (820, 560), (862, 610), (842, 662), (560, 662)], "grad": ("y", 530, 0.9, 662, 0.3)},
        {"poly": [(1380, 400), (1500, 380), (1672, 380), (1672, 780), (1550, 760), (1480, 700), (1400, 560)], "grad": ("y", 390, 1.0, 780, 0.35)},
        {"poly": [(1100, 480), (1250, 470), (1380, 520), (1380, 565), (1100, 565)], "gain": 0.45},
        {"poly": [(1440, 780), (1672, 760), (1672, 941), (1440, 941)], "grad": ("y", 770, 1.0, 941, 0.5)},
        {"poly": [(520, 858), (690, 858), (705, 941), (520, 941)], "grad": ("y", 858, 1.0, 941, 0.4)},
        {"poly": [(1318, 572), (1385, 568), (1452, 608), (1445, 662), (1362, 682), (1330, 642)], "grad": ("x", 1330, 0.0, 1450, 0.55)},
        {"poly": [(1390, 645), (1452, 638), (1505, 680), (1485, 722), (1400, 722)], "gain": 0.6},
    ],
    "swayExclude": [
        P(*FISHER_D),
        {"ellipse": (537, 636, 70, 46)}, {"ellipse": (280, 757, 78, 30)}, {"ellipse": (482, 797, 50, 34)}, {"ellipse": (368, 566, 22, 16)},
    ],
    "depthBase": 0.1,
    "depth": [
        {"rect": (0, 0, 1672, 941), "grad": ("y", 300, 0.15, 941, 0.75)},
        {"poly": [(195, 0), (505, 0), (500, 760), (210, 760)], "v": 0.25},
        {"poly": [(0, 640), (200, 640), (330, 700), (560, 800), (640, 860), (680, 941), (0, 941)], "v": 0.85},
        {"poly": [(1440, 780), (1672, 760), (1672, 941), (1440, 941)], "v": 0.92},
        {"poly": FISHER_D, "v": 0.62},
    ],
    "puppets": {
        "fishBreath": {"c": (1300, 642), "ax": (82, 76), "pivot": (1290, 706), "feather": 0.4},
        "fishHead": {"c": (1293, 592), "ax": (84, 54), "pivot": (1290, 642), "feather": 0.35},
        "rod": {"c": (1198, 616), "ax": (92, 11), "angle": 33.8, "pivot": (1266, 662), "feather": 0.45},
        "line": {"c": (1024, 704), "ax": (178, 30), "angle": 128.8, "pivot": (1130, 571), "feather": 0.3, "taper": 1},
        "footL": {"c": (1218, 720), "ax": (25, 21), "pivot": (1236, 698), "feather": 0.4},
        "footR": {"c": (1259, 736), "ax": (27, 22), "pivot": (1278, 712), "feather": 0.4},
        "doveA": {"c": (537, 636), "ax": (66, 44), "pivot": (537, 630), "feather": 0.35},
        "doveAL": {"c": (502, 613), "ax": (30, 13), "angle": -15, "pivot": (528, 624), "feather": 0.4},
        "doveAR": {"c": (572, 613), "ax": (30, 13), "angle": 15, "pivot": (546, 624), "feather": 0.4},
        "doveB": {"c": (280, 757), "ax": (74, 28), "pivot": (288, 752), "feather": 0.35},
        "doveBL": {"c": (240, 749), "ax": (36, 11), "pivot": (276, 752), "feather": 0.4},
        "doveC": {"c": (482, 797), "ax": (46, 32), "pivot": (484, 793), "feather": 0.35},
        "doveCL": {"c": (456, 788), "ax": (20, 11), "angle": -25, "pivot": (474, 795), "feather": 0.4},
        "doveD": {"c": (368, 566), "ax": (20, 14), "pivot": (368, 566), "feather": 0.35},
    },
    "fisher": {"hands": (1266, 662), "tip": (1130, 571), "entry": (915, 838)},
    "rayDir": (1.0, 0.62),
    "features": {"flow": True, "mist": "rise", "glow": "rays"},
}

FISHER_M = [(720, 1060), (840, 1060), (852, 1110), (852, 1180), (802, 1202), (792, 1236), (718, 1232), (724, 1180), (744, 1150), (735, 1110)]
WATERFALL_M = {
    "src": "waterfall-mobile",
    "flow": [P((28, 0), (152, 0), (150, 200), (160, 500), (172, 800), (182, 1000), (195, 1200), (206, 1262), (40, 1262), (30, 1000), (24, 600))],
    "flowLum": (0.64, 0.74),
    "mist": [{"poly": [(40, 1170), (330, 1170), (340, 1310), (40, 1310)], "grad": ("y", 1170, 0.3, 1260, 1.0)}],
    "ripple": [{"poly": [(150, 1272), (400, 1270), (560, 1300), (700, 1290), (905, 1300), (905, 1445), (150, 1445)], "grad": ("y", 1270, 0.6, 1445, 1.0)}],
    "rippleLum": (0.36, 0.5),
    "glow": [P((150, 450), (420, 540), (820, 940), (840, 1085), (500, 1110), (160, 820))],
    "glowBlur": 30,
    "sway": [
        {"poly": [(0, 930), (110, 950), (125, 1100), (0, 1155)], "grad": ("y", 940, 1.0, 1155, 0.4)},
        {"poly": [(0, 1240), (300, 1300), (380, 1400), (400, 1536), (0, 1536)], "grad": ("y", 1240, 0.8, 1536, 0.45)},
        {"poly": [(220, 970), (400, 960), (480, 1050), (452, 1150), (220, 1150)], "grad": ("y", 960, 0.9, 1150, 0.3)},
        {"poly": [(820, 880), (1024, 850), (1024, 1150), (880, 1150)], "grad": ("y", 860, 1.0, 1150, 0.35)},
        {"poly": [(750, 1330), (1024, 1280), (1024, 1536), (750, 1536)], "grad": ("y", 1290, 1.0, 1536, 0.5)},
        {"poly": [(800, 1082), (905, 1110), (905, 1177), (820, 1170)], "grad": ("x", 805, 0.0, 905, 0.55)},
        {"poly": [(100, 0), (225, 0), (225, 200), (140, 250), (100, 150)], "gain": 0.5},
        {"poly": [(150, 200), (232, 200), (232, 320), (150, 320)], "gain": 0.5},
        {"poly": [(160, 530), (242, 530), (242, 622), (160, 622)], "gain": 0.5},
    ],
    "swayExclude": [P(*FISHER_M), {"ellipse": (266, 1141, 56, 40)}, {"ellipse": (118, 1287, 46, 30)}],
    "depthBase": 0.1,
    "depth": [
        {"rect": (0, 0, 1024, 1536), "grad": ("y", 500, 0.15, 1536, 0.75)},
        {"poly": [(20, 0), (160, 0), (205, 1260), (35, 1260)], "v": 0.25},
        {"poly": [(0, 1240), (300, 1300), (380, 1400), (400, 1536), (0, 1536)], "v": 0.85},
        {"poly": [(750, 1330), (1024, 1280), (1024, 1536), (750, 1536)], "v": 0.92},
        {"poly": FISHER_M, "v": 0.62},
    ],
    "puppets": {
        "fishBreath": {"c": (790, 1162), "ax": (62, 56), "pivot": (785, 1206), "feather": 0.4},
        "fishHead": {"c": (785, 1106), "ax": (58, 40), "pivot": (780, 1150), "feather": 0.35},
        "rod": {"c": (719, 1112), "ax": (62, 9), "angle": 31.7, "pivot": (770, 1143), "feather": 0.45},
        "line": {"c": (582, 1208), "ax": (160, 24), "angle": 124.2, "pivot": (668, 1080), "feather": 0.3, "taper": 1},
        "footL": {"c": (740, 1214), "ax": (19, 15), "pivot": (752, 1196), "feather": 0.4},
        "footR": {"c": (772, 1222), "ax": (19, 15), "pivot": (786, 1201), "feather": 0.4},
        "doveA": {"c": (266, 1141), "ax": (54, 38), "pivot": (266, 1138), "feather": 0.35},
        "doveAL": {"c": (236, 1122), "ax": (24, 10), "angle": -20, "pivot": (258, 1134), "feather": 0.4},
        "doveAR": {"c": (296, 1120), "ax": (24, 10), "angle": 20, "pivot": (274, 1134), "feather": 0.4},
        "doveB": {"c": (118, 1287), "ax": (44, 28), "pivot": (118, 1285), "feather": 0.35},
        "doveBL": {"c": (95, 1280), "ax": (18, 9), "angle": -15, "pivot": (112, 1286), "feather": 0.4},
    },
    "fisher": {"hands": (770, 1143), "tip": (668, 1080), "entry": (495, 1335)},
    "rayDir": (1.0, 0.75),
    "features": {"flow": True, "mist": "rise", "glow": "rays"},
}

DEER_BODY_D = [(950, 478), (1092, 478), (1132, 568), (1340, 568), (1372, 620), (1366, 700), (1372, 822), (1330, 832), (1300, 762), (1180, 742), (1132, 842), (1078, 842), (1100, 742), (1040, 732), (998, 692), (984, 610), (974, 560)]
FOREST_D = {
    "src": "forest",
    "deer": {
        "poly": [(940, 476), (1000, 503), (1020, 528), (1040, 503), (1097, 476), (1084, 540), (1066, 576), (1110, 568), (1142, 566), (1146, 592), (1040, 738), (1012, 728), (994, 692), (988, 632), (980, 602), (976, 562), (962, 536), (943, 488)],
        "core": [(1000, 552), (1045, 552), (1050, 600), (1060, 620), (1080, 610), (1100, 600), (1040, 700), (1020, 690), (1010, 620), (1000, 590)],
        "body": DEER_BODY_D,
        "rig": {"cut": [(1032, 736), (1114, 572)], "blend": 46, "shoulder": (1080, 660),
                "jaw": [(988, 626), (1072, 606)], "head": (1032, 572)},
        "fallZone": {"rect": (898, 614, 1215, 800), "src": (935, 998)},
        "eyes": [(1005, 569), (1045, 569)], "eyeR": (8, 6),
        "ears": [{"base": (992, 540), "tip": (955, 488)}, {"base": (1048, 540), "tip": (1083, 488)}],
        "nose": (1040, 603),
    },
    "flow": [
        P((1430, 0), (1672, 0), (1672, 330), (1600, 318), (1530, 328), (1485, 345), (1450, 380), (1440, 260), (1434, 120)),
        P((1212, 380), (1440, 370), (1490, 380), (1490, 560), (1470, 640), (1440, 700), (1420, 780), (1215, 780)),
        P((898, 610), (1215, 610), (1215, 800), (898, 800)),
    ],
    "flowLum": (0.66, 0.76),
    "flowExclude": [P(*DEER_BODY_D)],
    "mist": [
        {"poly": [(890, 760), (1470, 760), (1480, 845), (890, 845)], "grad": ("y", 760, 0.4, 815, 1.0)},
        {"poly": [(1440, 315), (1672, 300), (1672, 385), (1440, 400)], "gain": 0.6},
        {"poly": [(1470, 820), (1672, 800), (1672, 900), (1470, 900)], "gain": 0.7},
    ],
    "ripple": [{"poly": [(0, 790), (300, 805), (560, 815), (700, 800), (900, 790), (1100, 820), (1100, 860), (880, 941), (0, 941)], "grad": ("y", 790, 0.5, 941, 0.9)}],
    "rippleLum": (0.25, 0.4),
    "exclude": [P(*DEER_BODY_D)],
    "sway": [
        {"poly": [(0, 330), (150, 380), (300, 420), (420, 460), (520, 520), (560, 640), (560, 760), (450, 800), (300, 780), (0, 800)], "grad": ("y", 380, 1.0, 800, 0.35)},
        {"poly": [(580, 420), (700, 430), (780, 520), (760, 620), (640, 640), (580, 560)], "grad": ("y", 430, 1.0, 640, 0.3)},
        {"poly": [(1032, 128), (1112, 128), (1114, 300), (1032, 300)], "grad": ("y", 130, 1.0, 300, 0.2)},
        {"poly": [(988, 282), (1078, 282), (1078, 342), (988, 342)], "gain": 0.6},
        {"poly": [(760, 330), (1000, 300), (1050, 420), (980, 470), (760, 440)], "gain": 0.5},
        {"poly": [(1150, 0), (1430, 0), (1430, 240), (1300, 200), (1150, 150)], "gain": 0.55},
        {"poly": [(1120, 400), (1240, 400), (1240, 560), (1120, 560)], "gain": 0.5},
        {"poly": [(902, 552), (1000, 552), (1000, 628), (902, 628)], "gain": 0.55},
        {"poly": [(1500, 345), (1605, 345), (1605, 405), (1500, 405)], "gain": 0.6},
        {"poly": [(1578, 578), (1672, 560), (1672, 702), (1578, 702)], "gain": 0.7},
        {"poly": [(578, 790), (842, 790), (862, 941), (560, 941)], "grad": ("y", 790, 1.0, 941, 0.4)},
        {"poly": [(878, 820), (1012, 820), (1012, 941), (878, 941)], "grad": ("y", 820, 1.0, 941, 0.4)},
        {"poly": [(1060, 810), (1672, 800), (1672, 941), (1060, 941)], "gain": 0.35},
        {"poly": [(0, 780), (560, 800), (560, 941), (0, 941)], "gain": 0.55},
    ],
    "depthBase": 0.1,
    "depth": [
        {"rect": (0, 0, 1672, 941), "grad": ("y", 280, 0.2, 941, 0.7)},
        {"poly": [(1405, 0), (1672, 0), (1672, 340), (1440, 400)], "v": 0.22},
        {"poly": DEER_BODY_D, "v": 0.66},
        {"poly": [(578, 790), (842, 790), (862, 941), (560, 941)], "v": 1.0},
        {"poly": [(1060, 810), (1672, 800), (1672, 941), (1060, 941)], "v": 0.9},
    ],
    "puppets": {
        "deerBreath": {"c": (1205, 650), "ax": (165, 92), "pivot": (1220, 832), "feather": 0.3},
        "tail": {"c": (1352, 642), "ax": (24, 48), "pivot": (1345, 598), "feather": 0.4},
        "bush": {"c": (952, 590), "ax": (56, 42), "pivot": (952, 628), "feather": 0.4},
    },
    "features": {"flow": True, "mist": "rise", "deer": True},
}

DEER_BODY_M = [(546, 1036), (660, 1036), (700, 1115), (860, 1118), (882, 1160), (876, 1230), (882, 1345), (850, 1350), (830, 1270), (760, 1240), (700, 1250), (652, 1346), (620, 1346), (640, 1250), (600, 1230), (580, 1180), (570, 1110)]
FOREST_M = {
    "src": "forest-mobile",
    "deer": {
        "poly": [(542, 1034), (586, 1054), (604, 1076), (624, 1054), (662, 1034), (648, 1082), (632, 1118), (662, 1116), (692, 1114), (696, 1136), (632, 1242), (606, 1234), (588, 1202), (578, 1162), (572, 1130), (568, 1092), (558, 1076), (544, 1044)],
        "core": [(586, 1096), (622, 1096), (626, 1134), (640, 1150), (662, 1140), (676, 1132), (636, 1218), (616, 1208), (600, 1160), (590, 1130)],
        "body": DEER_BODY_M,
        "rig": {"cut": [(634, 1238), (670, 1124)], "blend": 37, "shoulder": (650, 1186),
                "jaw": [(572, 1158), (642, 1146)], "head": (602, 1104)},
        "fallZone": {"rect": (480, 1138, 702, 1292), "src": (510, 576)},
        "eyes": [(590, 1112), (623, 1110)], "eyeR": (7, 5),
        "ears": [{"base": (586, 1086), "tip": (553, 1043)}, {"base": (624, 1084), "tip": (651, 1046)}],
        "nose": (617, 1140),
    },
    "flow": [
        P((884, 0), (1024, 0), (1024, 868), (940, 860), (900, 880), (890, 600), (886, 300)),
        P((700, 898), (940, 893), (940, 1150), (700, 1150)),
        P((480, 1098), (702, 1098), (702, 1292), (480, 1292)),
    ],
    "flowLum": (0.66, 0.76),
    "flowExclude": [P(*DEER_BODY_M)],
    "exclude": [P(*DEER_BODY_M)],
    "mist": [{"poly": [(470, 1250), (1024, 1250), (1024, 1335), (470, 1335)], "grad": ("y", 1250, 0.4, 1300, 1.0)}],
    "ripple": [{"poly": [(150, 1290), (500, 1300), (700, 1290), (700, 1385), (400, 1425), (150, 1405)], "gain": 0.8}],
    "rippleLum": (0.25, 0.4),
    "sway": [
        {"poly": [(0, 600), (200, 700), (330, 800), (420, 900), (470, 1050), (470, 1250), (300, 1350), (0, 1350)], "grad": ("y", 640, 1.0, 1350, 0.35)},
        {"poly": [(240, 930), (380, 930), (450, 1040), (420, 1100), (250, 1080)], "grad": ("y", 930, 1.0, 1100, 0.3)},
        {"poly": [(598, 640), (682, 640), (682, 792), (598, 792)], "grad": ("y", 640, 1.0, 792, 0.2)},
        {"poly": [(680, 250), (900, 250), (900, 640), (760, 640), (680, 560)], "gain": 0.55},
        {"poly": [(540, 800), (642, 800), (642, 862), (540, 862)], "gain": 0.6},
        {"poly": [(470, 1068), (546, 1068), (546, 1136), (470, 1136)], "gain": 0.55},
        {"poly": [(280, 1380), (620, 1380), (640, 1536), (260, 1536)], "grad": ("y", 1380, 1.0, 1536, 0.4)},
        {"poly": [(450, 1320), (1024, 1310), (1024, 1536), (450, 1536)], "gain": 0.35},
    ],
    "depthBase": 0.1,
    "depth": [
        {"rect": (0, 0, 1024, 1536), "grad": ("y", 600, 0.2, 1536, 0.7)},
        {"poly": [(880, 0), (1024, 0), (1024, 880), (890, 880)], "v": 0.22},
        {"poly": DEER_BODY_M, "v": 0.66},
        {"poly": [(280, 1380), (620, 1380), (640, 1536), (260, 1536)], "v": 1.0},
        {"poly": [(450, 1320), (1024, 1310), (1024, 1536), (450, 1536)], "v": 0.9},
    ],
    "puppets": {
        "deerBreath": {"c": (742, 1190), "ax": (132, 72), "pivot": (752, 1342), "feather": 0.3},
        "tail": {"c": (866, 1166), "ax": (17, 38), "pivot": (858, 1134), "feather": 0.4},
        "bush": {"c": (506, 1102), "ax": (42, 34), "pivot": (506, 1132), "feather": 0.4},
    },
    "features": {"flow": True, "mist": "rise", "deer": True},
}

SCENES = {
    "hero": HERO_D, "hero-mobile": HERO_M,
    "waterfall": WATERFALL_D, "waterfall-mobile": WATERFALL_M,
    "forest": FOREST_D, "forest-mobile": FOREST_M,
}


# ----------------------------------------------------------------------------- main
def r1(v):
    return [round(float(x), 1) for x in v] if isinstance(v, (list, tuple)) else round(float(v), 2)


def build(key, cfg, want_preview):
    im = Img(cfg["src"])
    entry = {"size": [im.W, im.H], "features": cfg.get("features", {})}
    plate = None
    if "birds" in cfg:
        remove_birds(im, cfg["birds"], cfg.get("birdBoxes"))
        entry["flock"] = [{"x": x, "y": y, "s": s, "glide": g} for x, y, s, g in cfg["flock"]]
        plate = True
    if "deer" in cfg:
        d = cfg["deer"]
        head, deer, dist = deer_masks(im, d)
        sprite, rect = deer_sprite(im, head)
        Image.fromarray(sprite, "RGBA").save(os.path.join(OUT, f"{key}-deer.png"), optimize=True)
        deer_plate(im, d, head, deer, dist)
        plate = True
        rig = d["rig"]
        entry["deer"] = {
            "sprite": f"/art/live/{key}-deer.png", "rect": list(rect),
            "cut": [r1(p) for p in rig["cut"]], "blend": rig["blend"], "shoulder": r1(rig["shoulder"]),
            "jaw": [r1(p) for p in rig["jaw"]], "head": r1(rig["head"]),
            "eyes": [r1(e) for e in d["eyes"]], "eyeR": r1(d["eyeR"]),
            "ears": [{"base": r1(e["base"]), "tip": r1(e["tip"])} for e in d["ears"]],
            "nose": r1(d["nose"]),
        }
    if plate:
        Image.fromarray(im.rgb).save(os.path.join(OUT, f"{key}-plate.webp"), quality=92, method=6)
        entry["plate"] = f"/art/live/{key}-plate.webp"
    else:
        entry["plate"] = f"/art/{key}.webp"
    ch = build_channels(im, cfg)
    save_ctrl(ch, os.path.join(OUT, f"{key}-ctrl.png"))
    entry["ctrl"] = f"/art/live/{key}-ctrl.png"
    entry["puppets"] = {
        n: {
            "c": r1(p["c"]), "ax": r1(p["ax"]), "angle": round(math.radians(p.get("angle", 0)), 4),
            "pivot": r1(p["pivot"]), "feather": p.get("feather", 0.35), "taper": p.get("taper", 0),
        }
        for n, p in (cfg.get("puppets") or {}).items()
    }
    for k in ("fisher",):
        if k in cfg:
            entry[k] = {a: r1(b) for a, b in cfg[k].items()}
    if "rayDir" in cfg:
        entry["rayDir"] = r1(cfg["rayDir"])
    if want_preview:
        os.makedirs(PREVIEW, exist_ok=True)

        def extra(out):
            for b in entry.get("flock", []):
                cv2.circle(out, (int(b["x"]), int(b["y"])), int(b["s"] / 2), (255, 80, 80), 1)
            dd = entry.get("deer")
            if dd:
                for a, b in (dd["cut"], dd["jaw"]):
                    cv2.line(out, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), (255, 60, 60), 1)

        preview(im, ch, cfg, os.path.join(PREVIEW, f"{key}.png"), extra)
        Image.fromarray(im.rgb).save(os.path.join(PREVIEW, f"{key}-plate.jpg"), quality=90)
    print(f"built {key}: {im.W}x{im.H}")
    return entry


def main():
    want_preview = "--preview" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    if only and os.path.exists(MANIFEST):
        txt = open(MANIFEST, encoding="utf8").read()
        manifest = json.loads(txt[txt.index("{") : txt.rindex("}") + 1])
    for key, cfg in SCENES.items():
        if only and key not in only:
            continue
        manifest[key] = build(key, cfg, want_preview)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf8", newline="\n") as fh:
        fh.write("// Generated by scripts/living-art/build.py. Do not edit by hand.\n")
        fh.write("export const ART_MANIFEST = ")
        fh.write(json.dumps(manifest, indent=1))
        fh.write(" as const;\n")


if __name__ == "__main__":
    main()
