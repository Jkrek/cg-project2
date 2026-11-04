// =====================================================================
//  terrain.js: building the grid of cubes (Levels 1 and 2)
// =====================================================================
//
// The terrain always covers the same square of the world, WORLD_SIZE
// units wide, centered on the origin. A finer grid uses more, smaller
// cubes, so changing the resolution never changes the size of the island.
// =====================================================================

const WORLD_SIZE = 100;

// ---------------------------------------------------------------------
// 1. Value noise: smooth "random" heights for Level 1b
// ---------------------------------------------------------------------
// Random numbers at the corners of a coarse lattice, smoothly
// interpolated in between. Adding several lattices (octaves), each twice
// as fine and half as strong, gives natural-looking hills ("fractal" or
// fBm noise). A pseudo-random hash keeps it repeatable.
function hash2(ix, iz, seed) {
  let h = ix * 374761393 + iz * 668265263 + seed * 982451653;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz); // smoothstep
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return mix(mix(a, b, sx), mix(c, d, sx), sz);
}
function fbm(x, z, seed, octaves = 5) {
  let sum = 0, amp = 1, freq = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + o * 17);
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

// Height color ramp for the procedural levels: deep blue → sand →
// green → brown → snow, by height fraction 0..1.
const HEIGHT_RAMP = [
  [0.00, [0.10, 0.25, 0.55]],
  [0.25, [0.20, 0.55, 0.75]],
  [0.32, [0.90, 0.84, 0.60]],
  [0.40, [0.40, 0.68, 0.30]],
  [0.65, [0.22, 0.45, 0.22]],
  [0.80, [0.50, 0.44, 0.38]],
  [0.92, [0.95, 0.96, 0.98]],
];
function rampColor(f) {
  for (let i = 1; i < HEIGHT_RAMP.length; i++) {
    if (f <= HEIGHT_RAMP[i][0]) {
      const [f0, c0] = HEIGHT_RAMP[i - 1], [f1, c1] = HEIGHT_RAMP[i];
      return mixColor(c0, c1, (f - f0) / (f1 - f0));
    }
  }
  return HEIGHT_RAMP[HEIGHT_RAMP.length - 1][1];
}


// ---------------------------------------------------------------------
// 2. Procedural grids (Levels 1a, 1b, 1c)
// ---------------------------------------------------------------------
// options:
//   n         grid resolution (n × n cubes)
//   heights   'flat' | 'random' | 'noise' | 'ripples'
//   colors    'checker' | 'height'
//   gap       0..1, fraction of each cell the cube fills (1 = touching)
//   maxHeight tallest cube
//   seed      changes the random numbers
function buildProceduralGrid({ n, heights, colors, gap = 0.9, maxHeight = 18, seed = 1 }) {
  const cell = WORLD_SIZE / n;
  const data = new Float32Array(n * n * FLOATS_PER_INSTANCE);
  let k = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      // TRANSLATION: the center of cell (row, col), with the grid
      // centered on the origin.
      const x = (col + 0.5) * cell - WORLD_SIZE / 2;
      const z = (row + 0.5) * cell - WORLD_SIZE / 2;

      // SCALING in y: pick a height fraction f (0..1) by a procedure.
      let f;
      if (heights === 'flat') f = 0.02;
      else if (heights === 'random') f = hash2(col, row, seed);
      else if (heights === 'ripples') {
        const r = Math.hypot(x, z);
        f = 0.5 + 0.5 * Math.cos(r * 0.25) * Math.exp(-r * 0.02);
      } else {
        // Noise sampled in WORLD units, so the hills keep their shape at
        // any resolution; the island falloff sinks the edges into the sea.
        const falloff = 1 - smoothstep(25, 50, Math.hypot(x, z));
        f = clamp(Math.pow(fbm(x * 0.03 + 7, z * 0.03 + 3, seed), 1.6) * 1.6 * falloff, 0, 1);
      }
      const h = Math.max(0.3, f * maxHeight);

      let color;
      if (colors === 'checker') {
        const even = (row + col) % 2 === 0;
        color = even ? [0.85, 0.82, 0.74] : [0.55, 0.60, 0.66];
      } else {
        color = rampColor(f);
      }

      // Cube is 2×2×2 (corners at ±1), so scale = half the size.
      // Its center sits at y = h/2, so its bottom is on the ground (y = 0).
      data[k++] = x; data[k++] = h / 2; data[k++] = z;
      data[k++] = (cell / 2) * gap; data[k++] = h / 2; data[k++] = (cell / 2) * gap;
      data[k++] = color[0]; data[k++] = color[1]; data[k++] = color[2];
      data[k++] = 0;
    }
  }
  return { data, count: n * n };
}


// ---------------------------------------------------------------------
// 3. Loading the two PNG images (Level 2)
// ---------------------------------------------------------------------
// To read pixel values we draw the image onto a hidden 2D canvas and
// call getImageData. Browsers block this for pages opened as file://
// ("the canvas has been tainted by cross-origin data"), because the
// image counts as coming from a different origin. Served from a web
// server (GitHub Pages, or `python3 -m http.server`) it works. Images
// the viewer uploads with the file picker are read as data: URLs, which
// never taint the canvas, so uploads work everywhere.
function loadImagePixels(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        resolve({ width: c.width, height: c.height, data, src });
      } catch (err) {
        reject(new Error('Could not read the image pixels (tainted canvas). Open this page through a web server, not file://.'));
      }
    };
    img.onerror = () => reject(new Error('Could not load ' + src));
    img.src = src;
  });
}

// ---------------------------------------------------------------------
// 4. SAMPLING: one value per grid cell from a big image
// ---------------------------------------------------------------------
// The spec's question: "Suppose your grid is 100×100 but your images are
// 1000×1000. How will you choose the color?"
//
// Each grid cell covers a BLOCK of pixels (here 10×10). Two methods:
//
//   'nearest' - take the single pixel at the block's center. Fast, but
//               it ignores 99 of the 100 pixels, so thin features (a
//               shoreline, the launch-pad stripes) flicker in and out
//               as the resolution changes. That is ALIASING.
//   'box'     - average every pixel in the block (a box filter). Each
//               cube gets the average color of the land it stands for.
//               This is a simple form of the low-pass filtering (or
//               mipmapping) used to shrink textures.
//
// Cell boundaries come from floor(col * W / n), so the method works for
// any grid size, even when W / n is not a whole number.
function sampleImage(image, n, method) {
  const { width: W, height: H, data } = image;
  const out = new Float32Array(n * n * 3); // r, g, b in 0..255, per cell
  for (let row = 0; row < n; row++) {
    const y0 = Math.floor((row * H) / n), y1 = Math.max(y0 + 1, Math.floor(((row + 1) * H) / n));
    for (let col = 0; col < n; col++) {
      const x0 = Math.floor((col * W) / n), x1 = Math.max(x0 + 1, Math.floor(((col + 1) * W) / n));
      let r = 0, g = 0, b = 0, count = 0;
      if (method === 'nearest') {
        const px = Math.floor((x0 + x1) / 2), py = Math.floor((y0 + y1) / 2);
        const i = (py * W + px) * 4;
        r = data[i]; g = data[i + 1]; b = data[i + 2]; count = 1;
      } else {
        for (let y = y0; y < y1; y++) {
          let i = (y * W + x0) * 4;
          for (let x = x0; x < x1; x++, i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2];
          }
        }
        count = (x1 - x0) * (y1 - y0);
      }
      const o = (row * n + col) * 3;
      out[o] = r / count; out[o + 1] = g / count; out[o + 2] = b / count;
    }
  }
  return out;
}

// The gray value (0..255) at a world position, read from the full-size
// height map (used to sit the rocket's launch pad on the ground).
function grayAt(image, u, v) {
  const x = clamp(Math.floor(u * image.width), 0, image.width - 1);
  const y = clamp(Math.floor(v * image.height), 0, image.height - 1);
  return image.data[(y * image.width + x) * 4];
}

// ---------------------------------------------------------------------
// 5. Gray value → height
// ---------------------------------------------------------------------
// The spec's second question: "Gray values go from 0 to 255. How do you
// turn them into real heights?"
//
//   f = gray / 255                     normalize to 0..1
//   f = f ^ curve                      curve > 1 flattens lowlands and
//                                      sharpens peaks; < 1 does the opposite
//   height = f × maxHeight
//
// Everything darker than the SEA LEVEL gray value is underwater: its cube
// is cut off at the water surface and marked as water (kind = 1), so the
// shader can animate it and add a sun glint. The color map still decides
// its color, so deep water is dark blue and shallow water turquoise.
function grayToHeight(gray, { maxHeight, curve, seaLevel }) {
  const f = Math.pow(gray / 255, curve);
  const seaHeight = Math.pow(seaLevel / 255, curve) * maxHeight;
  const isWater = gray < seaLevel;
  const h = isWater ? seaHeight : Math.max(seaHeight + 0.05, f * maxHeight);
  return { h: Math.max(0.2, h), isWater };
}

function buildImageGrid(heightImage, colorImage, { n, method, maxHeight, curve, seaLevel, gap = 1 }) {
  const heights = sampleImage(heightImage, n, method);
  const colors = sampleImage(colorImage, n, method);
  const cell = WORLD_SIZE / n;
  const data = new Float32Array(n * n * FLOATS_PER_INSTANCE);
  let k = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = (row * n + col) * 3;
      const { h, isWater } = grayToHeight(heights[i], { maxHeight, curve, seaLevel });
      const x = (col + 0.5) * cell - WORLD_SIZE / 2;
      const z = (row + 0.5) * cell - WORLD_SIZE / 2;
      // Bright orange-red cells in the color map are lava: make them glow.
      const r = colors[i] / 255, g = colors[i + 1] / 255, b = colors[i + 2] / 255;
      const isLava = r > 0.85 && g < 0.5 && b < 0.3;
      data[k++] = x; data[k++] = h / 2; data[k++] = z;
      data[k++] = (cell / 2) * gap; data[k++] = h / 2; data[k++] = (cell / 2) * gap;
      data[k++] = r; data[k++] = g; data[k++] = b;
      data[k++] = isLava ? 2 : isWater ? 1 : 0;
    }
  }
  return { data, count: n * n };
}
