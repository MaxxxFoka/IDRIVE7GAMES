#!/usr/bin/env python3
"""
Lane Runner's HD textures (the realistic look): asphalt, verges with kerbs, the car, cones,
barriers and the fuel can, rendered with numpy at 2x the size they are shown (4x, then
downsampled, for clean edges) and written as .tex files (textures.js) into assets/.

    python3 apps/parked_games/games/lane-runner/make_textures.py

Everything is drawn here from shapes and noise: no photos, no outside art. Seeded: the same
files every run. Needs numpy and Pillow (only on the PC; the car reads the .tex files).
"""
import gzip, os, struct
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'assets')
rng = np.random.default_rng(7)

# logical sizes (screen px of the 1600 x 520 canvas); textures are 2x
ROAD_H = 390            # logic.js ROAD.bottom - ROAD.top
LANES = 5
TILE_W = 480            # a road tile (4 lane dashes of 120)
SCALE = 2


def save(name, rgba):
    a = np.clip(rgba, 0, 255).astype(np.uint8)
    h, w = a.shape[:2]
    assert w <= 1024 and h <= 1024, (name, w, h)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + '.tex'), 'wb') as f:
        f.write(gzip.compress(b'TEX1' + struct.pack('<II', w, h) + a.tobytes(), 9))
    Image.fromarray(a, 'RGBA').save(os.path.join('/tmp', 'lr-' + name + '.png'))
    print('%-10s %4d x %-4d %6.0f KB' % (name, w, h, os.path.getsize(os.path.join(OUT, name + '.tex')) / 1024))


def blur(a, r, wrap_x=False):
    """Gaussian blur of a float 2-D array, done in frequency space (so it wraps at the edges:
    seamless for the road tiles; sprites keep a margin)."""
    if r <= 0:
        return a
    if not wrap_x:
        p = int(r * 3) + 2
        return blur(np.pad(a, p), r, True)[p:-p, p:-p]
    h, w = a.shape
    fy, fx = np.fft.fftfreq(h)[:, None], np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * r) ** 2 * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def noise(h, w, scales, wrap_x=False):
    """Fractal noise: white noise blurred at several radii, weighted, normalised to -1..1."""
    out = np.zeros((h, w))
    for r, wt in scales:
        n = blur(rng.standard_normal((h, w)), r, wrap_x)
        n /= (np.abs(n).max() or 1)
        out += n * wt
    return out / (np.abs(out).max() or 1)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def down(rgba, k=2):
    """Downsample a float RGBA image by k (premultiplied, so edges stay clean)."""
    a = rgba[..., 3:4] / 255.0
    pm = np.concatenate([rgba[..., :3] * a, a * 255], axis=-1)
    h, w = pm.shape[0] // k * k, pm.shape[1] // k * k
    pm = pm[:h, :w].reshape(h // k, k, w // k, k, 4).mean(axis=(1, 3))
    al = pm[..., 3:4] / 255.0
    rgb = np.where(al > 1e-4, pm[..., :3] / np.maximum(al, 1e-4), 0)
    return np.concatenate([rgb, pm[..., 3:4]], axis=-1)


def over(dst, src):
    """src over dst, both float RGBA 0..255 straight."""
    sa, da = src[..., 3:4] / 255.0, dst[..., 3:4] / 255.0
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.concatenate([rgb, oa * 255], axis=-1)


def layer(h, w, color, alpha):
    out = np.zeros((h, w, 4))
    out[..., :3] = color
    out[..., 3] = np.clip(alpha, 0, 1) * 255
    return out


def sd_box(x, y, cx, cy, hw, hh, r):
    """Signed distance to a rounded box (negative inside)."""
    qx, qy = np.abs(x - cx) - hw + r, np.abs(y - cy) - hh + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def fill(sd, aa=1.0):
    return smooth(aa, -aa, sd)


# ---------------------------------------------------------------- road
def road():
    w, h = TILE_W * SCALE, ROAD_H * SCALE
    y, x = np.mgrid[0:h, 0:w].astype(float)
    lane_h = h / LANES
    # asphalt: base grey, fractal grain, aggregate speckles
    n = noise(h, w, [(40, 0.35), (12, 0.3), (3, 0.25), (0.8, 0.35)], wrap_x=True)
    base = 62 + 9 * n
    speck = rng.random((h, w))
    base = np.where(speck > 0.985, base + 26 * rng.random((h, w)), base)
    base = np.where(speck < 0.02, base - 18, base)
    # tyre tracks: two darker, smoother bands per lane
    lane_y = (y % lane_h) / lane_h
    tracks = np.exp(-((lane_y - 0.28) / 0.07) ** 2) + np.exp(-((lane_y - 0.72) / 0.07) ** 2)
    base = base - 9 * tracks * (0.7 + 0.3 * noise(h, w, [(30, 1)], wrap_x=True))
    # oil drips down the lane middles, patched seams
    oil = blur((rng.random((h, w)) > 0.9993).astype(float) * 1.0, 9, True)
    oil = oil / (oil.max() or 1) * np.exp(-((lane_y - 0.5) / 0.12) ** 2)
    base -= 22 * oil
    rgb = np.stack([base * 0.98, base * 1.0, base * 1.04], -1)
    img = np.concatenate([rgb, np.full((h, w, 1), 255.0)], -1)
    # paint: worn white, dashes between lanes, solid edge lines
    wear = 0.75 + 0.25 * noise(h, w, [(2, 0.6), (10, 0.4)], wrap_x=True)
    wear = np.clip(wear - (rng.random((h, w)) > 0.93) * 0.5, 0, 1)
    paint = np.zeros((h, w))
    for i in range(1, LANES):
        cy = i * lane_h
        for d in range(TILE_W // 120):
            x0 = (d * 120 + 30) * SCALE
            paint = np.maximum(paint, fill(sd_box(x, y, x0 + 30 * SCALE, cy, 30 * SCALE, 2.2 * SCALE, 1.5 * SCALE), 1.2))
    for cy in (9 * SCALE, h - 9 * SCALE):
        paint = np.maximum(paint, fill(np.abs(y - cy) - 3.2 * SCALE, 1.2))
    img = over(img, layer(h, w, (232, 232, 224), paint * wear * 0.92))
    # soft light from above: a touch brighter in the middle of the road
    shade = 0.92 + 0.08 * np.sin(np.pi * y / h)
    img[..., :3] *= shade[..., None]
    save('road', img)


def verge(name, flip):
    """Grass and gravel with a red and white kerb along the road (the kerb at the bottom; flipped for below)."""
    lw, lh = TILE_W, 64
    w, h = lw * SCALE, lh * SCALE
    y, x = np.mgrid[0:h, 0:w].astype(float)
    g = noise(h, w, [(14, 0.4), (4, 0.35), (1, 0.4)], wrap_x=True)
    grass = np.stack([46 + 14 * g, 72 + 22 * g, 38 + 10 * g], -1)
    blades = (rng.random((h, w)) > 0.97) * 18
    grass[..., 1] += blades
    img = np.concatenate([grass, np.full((h, w, 1), 255.0)], -1)
    # gravel strip by the kerb
    gy = h - 22 * SCALE
    gr = 120 + 30 * noise(h, w, [(1, 0.7), (3, 0.3)], wrap_x=True)
    gm = smooth(gy - 4 * SCALE, gy + 2 * SCALE, y) * (1 - smooth(h - 15 * SCALE, h - 13 * SCALE, y))
    img = over(img, layer(h, w, 0, 0) + 0)          # (no-op, keeps shapes)
    gravel = np.concatenate([np.stack([gr * 0.95, gr * 0.92, gr * 0.86], -1), (gm * 255)[..., None]], -1)
    img = over(img, gravel)
    # kerb: 14 px, blocks of 40 px, bevelled
    ky0 = h - 14 * SCALE
    block = ((x // (40 * SCALE)) % 2 == 0)
    kc = np.where(block[..., None], np.array([196, 38, 36]), np.array([236, 234, 228]))
    bevel = 1 - 0.35 * smooth(ky0 + 10 * SCALE, h, y) + 0.15 * (1 - smooth(ky0, ky0 + 3 * SCALE, y))
    edge = 1 - 0.3 * np.exp(-((x % (40 * SCALE)) / (1.2 * SCALE)) ** 2)
    kerb = np.concatenate([kc * (bevel * edge)[..., None] * (0.92 + 0.08 * g[..., None]), (smooth(ky0 - 1, ky0 + 1, y) * 255)[..., None]], -1)
    img = over(img, kerb)
    # a shadow line where the kerb meets the grass
    img = over(img, layer(h, w, 0, 0.35 * np.exp(-((y - ky0 + 2 * SCALE) / (2 * SCALE)) ** 2)))
    if flip:
        img = img[::-1]
    save(name, img)


# ---------------------------------------------------------------- lighting
LIGHT = np.array([-0.45, -0.55, 0.70]); LIGHT = LIGHT / np.linalg.norm(LIGHT)


def normals(hf, k):
    gy, gx = np.gradient(hf)
    n = np.stack([-gx * k, -gy * k, np.ones_like(hf)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def env(r):
    """What a glossy surface reflects: a bright overcast sky above, the dark road at the horizon."""
    up = np.clip(r[..., 2], 0, 1)
    sky = np.array([200, 214, 232]) * (0.55 + 0.45 * np.clip(-r[..., 1] * 0.6 + 0.6, 0, 1))[..., None]
    ground = np.array([40, 42, 46])
    t = smooth(0.05, 0.55, up)[..., None]
    return ground * (1 - t) + sky * t


def shade(n, albedo, gloss, refl):
    """Diffuse + sky reflection (Fresnel) + a sharp sun highlight."""
    ndl = np.clip((n * LIGHT).sum(-1), 0, 1)
    r = 2 * n[..., 2:3] * n - np.array([0, 0, 1.0])
    fres = refl + (1 - refl) * (1 - np.clip(n[..., 2], 0, 1)) ** 5
    spec = np.clip((r * LIGHT).sum(-1), 0, 1) ** gloss
    col = albedo * (0.35 + 0.75 * ndl)[..., None]
    col = col * (1 - fres[..., None]) + env(r) * fres[..., None]
    return col + 255 * spec[..., None] * 0.9


# ---------------------------------------------------------------- the car (top view, nose to the right)
def car():
    LW, LH = 132, 76                  # logical box incl. shadow; the body is 100 x 48
    K = SCALE * 2                     # drawn at 4x, saved at 2x
    w, h = LW * K, LH * K
    y, x = np.mgrid[0:h, 0:w].astype(float)
    cx, cy = w / 2 - 4 * K, h / 2
    bl, bw = 100 * K, 48 * K
    u = (x - (cx - bl / 2)) / bl      # 0 rear .. 1 nose
    v = (y - cy) / (bw / 2)           # -1 .. 1 across
    # plan shape: haunches at the rear wheels, a waist at the doors, a tapered nose
    half = 0.90 + 0.10 * smooth(0.0, 0.14, u) - 0.06 * np.exp(-((u - 0.52) / 0.12) ** 2) - 0.12 * smooth(0.80, 1.0, u)
    sd = np.maximum(sd_box(x, y, cx, cy, bl / 2, bw / 2, 11 * K), (np.abs(v) - half) * bw / 2)
    body = fill(sd, K * 0.8)
    # height: the body rounds over at its edges; the cabin sits on top, a little back of centre
    cab_half = np.interp(u, [0.22, 0.30, 0.50, 0.62, 0.74], [0.56, 0.70, 0.72, 0.68, 0.50])
    cab_sd = np.maximum(np.maximum((0.22 - u) * bl, (u - 0.74) * bl), (np.abs(v) - cab_half) * bw / 2)
    cab = fill(cab_sd, K * 2)
    hb = blur(body, 4 * K)
    hc = blur(cab, 3.5 * K)
    hf = hb * 14 * K + hc * 16 * K
    n = normals(hf, 0.55)
    # materials: paint, glass (windscreen, rear window, side glass), a painted roof
    glass_ws = fill(np.maximum(np.maximum((0.585 - u) * bl, (u - 0.725) * bl), (np.abs(v) - (cab_half - 0.07)) * bw / 2), K)
    glass_rw = fill(np.maximum(np.maximum((0.235 - u) * bl, (u - 0.32) * bl), (np.abs(v) - (cab_half - 0.08)) * bw / 2), K)
    side = fill(np.maximum(np.maximum((0.30 - u) * bl, (u - 0.58) * bl), (np.abs(np.abs(v) - (cab_half - 0.03)) - 0.035) * bw / 2), K * 0.8)
    glass = np.clip(glass_ws + glass_rw + side, 0, 1) * cab
    paint = np.array([18, 58, 150]) * (1 + 0.04 * noise(h, w, [(0.6, 1)]))[..., None]
    col_p = shade(n, paint, 90, 0.06)
    col_g = shade(n, np.array([10, 14, 20]), 140, 0.18)
    rgb = col_p * (1 - glass[..., None]) + col_g * glass[..., None]
    # panel gaps: bonnet and boot lines, door shut lines
    gaps = np.exp(-((u - 0.76) / 0.004) ** 2) * (np.abs(v) < half * 0.82) + np.exp(-((u - 0.18) / 0.004) ** 2) * (np.abs(v) < half * 0.8)
    gaps = gaps + np.exp(-((u - 0.46) / 0.003) ** 2) * (np.abs(v) > cab_half + 0.02)
    rgb = rgb * (1 - 0.6 * np.clip(gaps, 0, 1))[..., None]
    # shadow under the car, tyres, then the body
    shadow = blur(fill(sd_box(x, y, cx + 3 * K, cy + 4 * K, bl / 2 + 2 * K, bw / 2 + 1 * K, 14 * K), K), 5 * K)
    img = layer(h, w, (0, 0, 0), shadow * 0.6)
    for tx in (cx - bl * 0.30, cx + bl * 0.31):
        for ty in (cy - bw * 0.47, cy + bw * 0.47):
            t = fill(sd_box(x, y, tx, ty, 9.5 * K, 4 * K, 2 * K), K * 0.7)
            img = over(img, layer(h, w, (16, 16, 18), t))
    img = over(img, np.concatenate([rgb, (body * 255)[..., None]], -1))
    # mirrors, lights
    for sgn in (-1, 1):
        m = fill(sd_box(x, y, cx + bl * 0.14, cy + sgn * bw * 0.52, 3.5 * K, 2.6 * K, 1.8 * K), K * 0.6)
        img = over(img, layer(h, w, (16, 46, 120), m))
        hl = fill(sd_box(x, y, cx + bl / 2 - 6 * K, cy + sgn * bw * 0.30, 2.2 * K, 5.5 * K, 1.8 * K), K * 0.6)
        img = over(img, layer(h, w, (40, 48, 60), hl))
        led = fill(sd_box(x, y, cx + bl / 2 - 6.2 * K, cy + sgn * bw * 0.30, 0.9 * K, 4.6 * K, 0.9 * K), K * 0.5)
        img = over(img, layer(h, w, (235, 245, 255), led))
        tl = fill(sd_box(x, y, cx - bl / 2 + 2.6 * K, cy + sgn * bw * 0.27, 1.4 * K, 9 * K, 1.2 * K), K * 0.6)
        img = over(img, layer(h, w, (170, 12, 22), tl))
    save('car', down(img, 2))


def cone():
    LW = LH = 60
    K = SCALE * 2
    w, h = LW * K, LH * K
    y, x = np.mgrid[0:h, 0:w].astype(float)
    cx, cy = w / 2, h / 2 - 2 * K
    shadow = blur(fill(sd_box(x, y, cx + 4 * K, cy + 6 * K, 17 * K, 17 * K, 4 * K), K), 4 * K)
    img = layer(h, w, (0, 0, 0), shadow * 0.5)
    base = fill(sd_box(x, y, cx, cy, 18 * K, 18 * K, 3.5 * K), K * 0.7)
    bshade = 0.75 + 0.25 * smooth(18 * K, -18 * K, (x - cx) + (y - cy))
    img = over(img, np.concatenate([np.array([226, 92, 18]) * bshade[..., None] * 0.8, (base * 255)[..., None]], -1))
    r = np.hypot(x - cx, y - cy)
    body = fill(r - 13 * K, K * 0.7)
    lit = 0.6 + 0.5 * smooth(13 * K, -13 * K, (x - cx) * 0.7 + (y - cy) * 0.7)
    rgb = np.array([255, 110, 22]) * lit[..., None]
    band = smooth(5.2 * K, 5.6 * K, r) * (1 - smooth(8.4 * K, 8.8 * K, r))
    rgb = rgb * (1 - band[..., None]) + np.array([245, 245, 240]) * lit[..., None] * band[..., None]
    img = over(img, np.concatenate([rgb, (body * 255)[..., None]], -1))
    tip = fill(r - 2.6 * K, K * 0.6)
    img = over(img, layer(h, w, (255, 150, 70), tip))
    spec = np.exp(-(((x - cx + 5 * K) ** 2 + (y - cy + 5 * K) ** 2) / (4 * K) ** 2))
    img = over(img, layer(h, w, (255, 255, 255), spec * 0.35 * body))
    save('cone', down(img, 2))


def barrier():
    LW, LH = 52, 160
    K = SCALE * 2
    w, h = LW * K, LH * K
    y, x = np.mgrid[0:h, 0:w].astype(float)
    cx, cy = w / 2, h / 2
    shadow = blur(fill(sd_box(x, y, cx + 5 * K, cy + 6 * K, 19 * K, 74 * K, 6 * K), K), 5 * K)
    img = layer(h, w, (0, 0, 0), shadow * 0.55)
    sd = sd_box(x, y, cx, cy, 18 * K, 72 * K, 6 * K)
    body = fill(sd, K * 0.7)
    g = noise(h, w, [(0.8, 0.6), (4, 0.4)])
    # concrete: a ridge down the middle (jersey profile), lit from the top left
    prof = 1 - np.abs((x - cx) / (18 * K))
    lit = 0.55 + 0.45 * np.clip(prof * 1.6, 0, 1) - 0.15 * ((x - cx) / (18 * K))
    rgb = np.array([170, 168, 160]) * (lit * (1 + 0.08 * g))[..., None]
    img = over(img, np.concatenate([rgb, (body * 255)[..., None]], -1))
    # red and white reflective chevrons along the top
    stripe = ((((y - x * 0.6) // (14 * K)) % 2) == 0)
    band = fill(np.abs(x - cx) - 7 * K, K * 0.6) * fill(np.abs(y - cy) - 66 * K, K * 0.6)
    col = np.where(stripe[..., None], np.array([214, 34, 40]), np.array([240, 240, 236]))
    img = over(img, np.concatenate([col * (0.85 + 0.15 * lit[..., None]), (band * 255)[..., None]], -1))
    # end caps darker, a few chips
    img = over(img, layer(h, w, (40, 40, 40), body * smooth(66 * K, 72 * K, np.abs(y - cy)) * 0.4))
    save('barrier', down(img, 2))


def can():
    LW, LH = 50, 56
    K = SCALE * 2
    w, h = LW * K, LH * K
    y, x = np.mgrid[0:h, 0:w].astype(float)
    cx, cy = w / 2 - 1 * K, h / 2
    shadow = blur(fill(sd_box(x, y, cx + 4 * K, cy + 5 * K, 15 * K, 19 * K, 4 * K), K), 4 * K)
    img = layer(h, w, (0, 0, 0), shadow * 0.5)
    sd = sd_box(x, y, cx, cy, 15 * K, 19 * K, 4 * K)
    body = fill(sd, K * 0.7)
    lit = 0.6 + 0.4 * smooth(20 * K, -20 * K, (x - cx) * 0.6 + (y - cy) * 0.8)
    rgb = np.array([200, 26, 28]) * lit[..., None]
    img = over(img, np.concatenate([rgb, (body * 255)[..., None]], -1))
    # embossed X and the handle
    for s in (1, -1):
        d = np.abs((x - cx) * 0.79 - s * (y - cy + 2 * K) * 0.62) - 1.6 * K
        xm = fill(d, K * 0.6) * fill(sd_box(x, y, cx, cy + 2 * K, 11 * K, 13 * K, 2 * K), K)
        img = over(img, layer(h, w, (120, 10, 14), xm * 0.9))
    hd = fill(np.abs(sd_box(x, y, cx - 3 * K, cy - 14 * K, 8 * K, 3 * K, 2.5 * K)) - 1.2 * K, K * 0.6)
    img = over(img, layer(h, w, (90, 8, 10), hd))
    cap = fill(np.hypot(x - (cx + 10 * K), y - (cy - 15 * K)) - 3.2 * K, K * 0.6)
    img = over(img, layer(h, w, (230, 200, 60), cap))
    spec = np.exp(-(((x - cx + 7 * K) ** 2) / (3 * K) ** 2)) * body * (1 - smooth(14 * K, 18 * K, np.abs(y - cy)))
    img = over(img, layer(h, w, (255, 255, 255), spec * 0.3))
    save('can', down(img, 2))


if __name__ == '__main__':
    road()
    verge('verge-top', False)
    verge('verge-bottom', True)
    car()
    cone()
    barrier()
    can()
