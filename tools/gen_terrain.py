# Generates assets/heightmap.png and assets/colormap.png (run from the project folder).
# Fractal noise + domain-warped island masks + a volcano crater + a flattened launch pad.
import numpy as np
from PIL import Image
from scipy.ndimage import zoom, gaussian_filter, sobel
rng = np.random.default_rng(7)
N = 1024
yy, xx = np.mgrid[0:N, 0:N] / N

def fbm(octaves=6, base=4, persistence=0.5, seed=0):
    r = np.random.default_rng(seed)
    out = np.zeros((N, N)); amp = 1.0; tot = 0
    for o in range(octaves):
        g = base * 2**o
        grid = r.random((g + 3, g + 3))
        up = zoom(grid, (N + 3 * N / g) / (g + 3), order=3)[:N, :N]
        out += amp * up; tot += amp; amp *= persistence
    out /= tot
    return (out - out.min()) / (out.max() - out.min())

n1 = fbm(7, 3, 0.52, 1)
n2 = fbm(5, 6, 0.5, 2)
ridge = 1 - np.abs(fbm(6, 4, 0.55, 3) * 2 - 1)

wx = xx + (fbm(5, 3, 0.55, 11) - 0.5) * 0.16
wy = yy + (fbm(5, 3, 0.55, 12) - 0.5) * 0.16
def blob(cx, cy, r, sharp=2.0):
    d = np.hypot(wx - cx, wy - cy) / r
    return np.clip(1 - d, 0, 1) ** sharp

def ring(cx, cy, r, w):
    d = np.hypot(wx - cx, wy - cy)
    return np.exp(-((d - r) / w) ** 2)

# land "elevation" in 0..1 before noise
land = np.zeros((N, N))
# main volcano island
volc = np.maximum(blob(0.40, 0.42, 0.27, 1.25), blob(0.52, 0.55, 0.16, 1.4) * 0.6)
land = np.maximum(land, volc * 1.0)
# crescent island SW
cres = np.clip(blob(0.20, 0.76, 0.20, 1.2) - blob(0.28, 0.68, 0.15, 0.8) * 1.2, 0, 1)
land = np.maximum(land, cres * 0.55)
# atoll NE
atoll = ring(0.80, 0.22, 0.09, 0.025) * 0.34
land = np.maximum(land, atoll)
# launch pad island SE (broad, plateau)
pad_isl = blob(0.77, 0.75, 0.17, 1.0) * 0.5
land = np.maximum(land, pad_isl)
# scattered small rocky islets
for cx, cy, r, h in [(0.60, 0.12, 0.06, 0.26), (0.92, 0.50, 0.06, 0.28), (0.10, 0.30, 0.07, 0.25),
                     (0.50, 0.90, 0.06, 0.24), (0.62, 0.50, 0.05, 0.27), (0.05, 0.95, 0.05, 0.22),
                     (0.30, 0.10, 0.05, 0.26)]:
    land = np.maximum(land, blob(cx, cy, r, 0.9) * h)

h = land * (0.55 + 0.65 * n1) + 0.18 * ridge * land
h = h + (n2 - 0.5) * 0.10
# volcano crater on the main peak
py, px = np.unravel_index(np.argmax(gaussian_filter(h, 12)), h.shape); PX, PY = px / N, py / N
crater = np.clip(1 - np.hypot(xx-PX, yy-PY)/0.04, 0, 1)
h = h - crater * 0.22
# launch-pad plateau: flatten a square
pad = (np.abs(xx - 0.78) < 0.035) & (np.abs(yy - 0.75) < 0.035)
padsoft = gaussian_filter(pad.astype(float), 6)
h = h * (1 - padsoft) + 0.36 * padsoft
h = gaussian_filter(h, 1.2)

# map to grayscale: ocean floor 20..63, land 64..255
SEA = 0.16
g = np.where(h < SEA, 20 + (h / SEA) * 43, 64 + (h - SEA) / (h.max() - SEA) * 191)
g = np.clip(g, 0, 255)
Image.fromarray(g.astype(np.uint8), 'L').save('assets/heightmap.png')

# ---- color map ----
def hexc(s): return np.array([int(s[i:i+2], 16) for i in (1, 3, 5)], float)
C = lambda s: hexc(s)
col = np.zeros((N, N, 3))
deep, shallow = C('#0a2f5c'), C('#2bb3c0')
t = np.clip(g / 63.0, 0, 1) ** 2.2
water = deep[None, None] * (1 - t[..., None]) + shallow[None, None] * t[..., None]
slope = np.hypot(sobel(g, 0), sobel(g, 1)) / 8.0
var = (n2[..., None] - 0.5) * 30

sand, grass, grass2, forest, rock, snow = C('#e9d9a1'), C('#6bb04b'), C('#9cc45a'), C('#2e6a35'), C('#7f786e'), C('#f3f5f7')
landc = np.zeros_like(col)
hh = g
forest_mask = (fbm(5, 8, 0.5, 9) > 0.55)
grass_mix = np.clip((hh - 72) / 70, 0, 1)[..., None]
landc[:] = grass * (1 - grass_mix) + grass2 * grass_mix
landc[forest_mask & (hh < 175)] = forest
landc[hh < 74] = sand
rocky = (hh > 175) | (slope > 9)
landc[rocky] = rock
landc[hh > 222] = snow
landc = landc + var
col = np.where((g < 64)[..., None], water, landc)
# lava in the crater
lava = np.hypot(xx-PX, yy-PY) < 0.022
col[lava] = C('#ff5a1f')
# launch pad: concrete with yellow cross markings
col[pad] = C('#9a9da3')
mark = pad & ((np.abs(xx - 0.78) < 0.004) | (np.abs(yy - 0.75) < 0.004))
col[mark] = C('#ffd23f')
# white foam line at the shore
shore = (g >= 60) & (g < 64)
col[shore] = C('#d8f3f2')
Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), 'RGB').save('assets/colormap.png')
print('land frac', (g >= 64).mean(), 'max', g.max())
