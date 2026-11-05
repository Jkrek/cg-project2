# Skyport Archipelago – Cube World

Computer Graphics I - (CS5160), Project 2: Cube World. Jared Krekeler.

**Live app:** https://jkrek.github.io/cg-project2/

A volcanic island chain made entirely from one 2×2×2 cube model, drawn with plain JavaScript and WebGL 2 (no three.js, no libraries, no build step). Heights and colors are sampled from two PNG images. Three jets fly a looping Bézier route, a rocket launches along a Bézier arc, and a ringed gas giant spins in the sky through a full day/night cycle.

## Levels (tabs across the top)

| Tab | What it shows | Graphics concept |
| --- | --- | --- |
| 0 | One 2×2×2 cube (24 vertices, 36 indices) | 3D objects as vertices, edges, triangles |
| 1a | n × n grid of cubes on the x-z plane, 10² to 512² | Translation, instanced drawing |
| 1b | Heights from fractal value noise / random / ripples | Scaling in y |
| 1c | Vertex colors from procedures, unlit | Interpolation (barycentric) in the rasterizer |
| 1d | Camera orbiting the center | lookAt, perspective (pinhole camera) |
| 2 | Terrain from `assets/heightmap.png` + `assets/colormap.png`, 64² to 512² | Image sampling: box filter vs nearest, gray → height |
| 3 | Jets on a closed C1 loop of 6 cubic Béziers; rocket on 1 cubic; ringed planet | De Casteljau, tangents → rotation, arc-length parameterization, recursive subdivision |
| 4 | Day/night: moving sun and moon, cube skybox, stars, fog, waves, glowing lava | Lambert + hemisphere ambient, Blinn-Phong glint, skybox, exponential fog |

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit the camera |
| Scroll | Zoom (orbit radius) |
| 0–7 | Switch level |
| Space | Pause / resume the automatic orbit |
| P | Show Bézier paths, control points and subdivision points |
| C | Cycle camera: orbit / chase jet / launch camera |
| H | Hide the UI (for screenshots and video) |

Level 2 also accepts your own height map and color map through the file pickers.

## Run locally

The page reads pixels from the PNGs with `getImageData`, which browsers block on `file://` pages (a "tainted canvas"). Serve the folder instead:

```
python3 -m http.server 8000
```

then open http://localhost:8000. (VS Code's Live Server extension works too.)

## Files

| File | Contents |
| --- | --- |
| `index.html`, `style.css` | Page, header, level tabs, control panel |
| `js/math.js` | Vectors and column-major 4×4 matrices (translation, scaling, rotation, lookAt, perspective) |
| `js/bezier.js` | De Casteljau evaluation, tangents, subdivision, multi-segment paths, arc-length table |
| `js/renderer.js` | Shaders, the cube's buffers, instanced `CubeBatch`, the skybox |
| `js/terrain.js` | Procedural grids, value noise, image loading, box-filter sampling, gray → height |
| `js/sky.js` | Jet, rocket, launch tower, planet and moon models; their motion |
| `js/main.js` | Levels, camera, day/night lighting, the animation loop |
| `assets/` | 1024×1024 height map and color map (generated with a Python script: fractal noise, island masks, a volcano crater and a launch pad) |

## Performance

Every batch of cubes is ONE `drawElementsInstanced` call, so the full scene is about 10 draw calls regardless of grid size. 128 × 128 (16k cubes) is the default; 512 × 512 (262k cubes) needs a reasonably fast GPU.
