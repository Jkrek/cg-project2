// =====================================================================
//  main.js: levels, camera, day/night, and the animation loop
// =====================================================================
//
// Each tab shows one level of the project. They all share ONE renderer:
// a level only decides which cubes to build, which colors and lights to
// use, and where the camera goes.
// =====================================================================

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// 1. Level descriptions (shown in the side panel)
// ---------------------------------------------------------------------
const LEVELS = {
  L0: {
    title: 'Level 0 · One cube',
    concept: '3D objects as vertices, edges and triangles',
    text: 'A single 2×2×2 cube: 8 corners, 12 edges, 6 faces, drawn as 12 triangles. It is stored as 24 vertices (each corner once per face, because each face needs its own normal) and 36 indices. Colors show each vertex normal. Every other object in this project is this same cube.',
  },
  L1a: {
    title: 'Level 1a · A grid of cubes',
    concept: '3D transform: translation',
    text: 'The cube is translated to the center of every cell of an n × n grid on the x-z plane. Try 10 × 10 up to 512 × 512: all cubes are drawn with ONE instanced draw call, so even 262,144 cubes stay interactive. The "cube size" slider leaves gaps so you can see the individual cubes.',
  },
  L1b: {
    title: 'Level 1b · Heights',
    concept: '3D transform: scaling in y',
    text: 'Each cube is scaled along y, the axis orthogonal to the x-z plane, then translated up by half its height so it stands on the ground. Heights come from a procedure: fractal value noise (smooth random hills with an island-shaped falloff), plain random numbers, or cos(distance) ripples.',
  },
  L1c: {
    title: 'Level 1c · Vertex colors',
    concept: 'Interpolation in the rasterizer',
    text: 'Each VERTEX gets a color from a procedure in the vertex shader. The rasterizer then interpolates those colors across every triangle, using barycentric coordinates, so each fragment gets a mix of its triangle\'s three vertex colors. Lighting is off so you see the raw interpolated colors.',
  },
  L1d: {
    title: 'Level 1d · Orbit camera',
    concept: 'Pinhole camera, lookAt, perspective',
    text: 'The camera moves on a circle around the landscape, always looking at its center: eye = (r·cos θ, h, r·sin θ), target = (0, 0, 0). Each frame, lookAt builds the view matrix and perspective() projects through a pinhole. Drag to change the orbit, scroll to change its radius.',
  },
  L2: {
    title: 'Level 2 · Terrain from images',
    concept: 'Image sampling, filtering, height mapping',
    text: 'Two 1024×1024 PNGs, drawn outside the program: a grayscale height map and a color map. Each cube samples the block of pixels it covers. The box filter averages them all; nearest takes one pixel and aliases (compare thin features while changing the resolution). Gray 0–255 → height via (gray/255)^k × max; anything below the sea-level gray becomes a water cube.',
  },
  L3: {
    title: 'Level 3 · Skyscape',
    concept: 'Bézier curves (de Casteljau), rotation',
    text: 'Three jets fly a closed loop of six cubic Bézier segments with C1-smooth joins; a rocket launches along one cubic segment, vanishes when it is far away, and resets. Each point comes from de Casteljau\'s construction, and its tangent (from the last two de Casteljau points) rotates the model to face its direction of travel. A ringed planet spins far away.',
  },
  L4: {
    title: 'Level 4 · Day and night',
    concept: 'Lighting, skybox, atmospheric fog',
    text: 'The sun circles the sky and drives everything: the light direction and color (Lambert diffuse plus hemisphere ambient), the skybox (the same cube, drawn around the camera with a sky color computed per fragment), sunsets, stars and the moon at night, and fog that fades distant cubes into the horizon. Lava, rocket flames and jet lights glow at night.',
  },
};
const LEVEL_KEYS = Object.keys(LEVELS);


// ---------------------------------------------------------------------
// 2. State
// ---------------------------------------------------------------------
const state = {
  level: 'L0',
  seed: 1,
  orbit: { theta: 0.6, phi: 0.42, radius: 120, target: [0, 4, 0] },
  timeOfDay: 17.2,
  rocketKick: false,
};

const terrainBatch = new CubeBatch();
const singleCube = new InstanceList().box(0, 0, 0, 2, 2, 2, [1, 1, 1]).toBatch(); // the 2×2×2 cube
let oceanBatch = null;
let sky = null;
let images = { height: null, color: null };
const DEFAULT_MAPS = { height: 'assets/heightmap.png', color: 'assets/colormap.png' };
const PAD_UV = [0.78, 0.75]; // where the launch pad is painted on the images


// ---------------------------------------------------------------------
// 3. Building the terrain for the current level
// ---------------------------------------------------------------------
function terrainSettings() {
  return {
    n: Number($('imgRes').value),
    method: $('sampling').value,
    maxHeight: Number($('maxH').value),
    curve: Number($('curve').value),
    seaLevel: Number($('sea').value),
    gap: Number($('imgGap').value),
  };
}

function rebuildTerrain() {
  const start = performance.now();
  const lvl = state.level;
  if (lvl === 'L0') {
    terrainBatch.count = 0;
  } else if (lvl.startsWith('L1')) {
    const grid = buildProceduralGrid({
      n: Number($('procRes').value),
      heights: lvl === 'L1a' ? 'flat' : $('heightMode').value,
      colors: lvl === 'L1a' ? 'checker' : 'height',
      gap: Number($('gap').value),
      maxHeight: Number($('procMax').value),
      seed: state.seed,
    });
    terrainBatch.upload(grid.data, grid.count);
  } else {
    if (!images.height || !images.color) { terrainBatch.count = 0; return; }
    const settings = terrainSettings();
    const grid = buildImageGrid(images.height, images.color, settings);
    terrainBatch.upload(grid.data, grid.count);
    // Sea surface and launch pad depend on the height settings.
    const sea = grayToHeight(settings.seaLevel - 1, settings).h;
    state.seaHeight = sea;
    oceanBatch?.dispose();
    // The open ocean beyond the island: one huge, flat cube.
    oceanBatch = new InstanceList().box(0, sea / 2 - 0.04, 0, 6000, sea - 0.08, 6000, [0.05, 0.20, 0.38], 1).toBatch();
    const padGray = grayAt(images.height, PAD_UV[0], PAD_UV[1]);
    const padH = grayToHeight(padGray, settings).h;
    const pad = [(PAD_UV[0] - 0.5) * WORLD_SIZE, padH, (PAD_UV[1] - 0.5) * WORLD_SIZE];
    if (!sky) sky = new SkyScape(pad, sea);
    else sky.setPad(pad);
  }
  $('hudBuild').textContent = (performance.now() - start).toFixed(0) + ' ms';
}

async function loadMaps(heightSrc, colorSrc) {
  try {
    const [h, c] = await Promise.all([loadImagePixels(heightSrc), loadImagePixels(colorSrc)]);
    images = { height: h, color: c };
    $('thumbH').src = heightSrc;
    $('thumbC').src = colorSrc;
    showMessage('');
    rebuildTerrain();
  } catch (err) {
    showMessage(err.message + '<br><br>Locally, run <code>python3 -m http.server 8000</code> in the project folder and open <code>http://localhost:8000</code>. Or use the file pickers in Level 2, which work anywhere.');
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}

function showMessage(html) {
  const el = $('message');
  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';
}


// ---------------------------------------------------------------------
// 4. The sky and the light, from the time of day
// ---------------------------------------------------------------------
// The sun moves on a tilted circle: hour 6 rises in the east (+x),
// hour 12 is highest, hour 18 sets in the west (-x). Everything else
// (sky colors, light color, ambient light, fog, how much the stars and
// glowing cubes show) is a smooth function of the sun's height above
// the horizon, sunDir.y.
function skyAt(hour) {
  const angle = ((hour - 6) / 24) * Math.PI * 2;
  const sunDir = vec3.normalize([Math.cos(angle), Math.sin(angle), -0.38]);
  const moonDir = vec3.normalize([-Math.cos(angle), -Math.sin(angle), 0.3]);
  const elev = sunDir[1];
  const day = smoothstep(-0.15, 0.3, elev);
  const night = 1 - smoothstep(-0.25, 0.05, elev);
  // "sunset" is 1 when the sun is on the horizon and 0 well above/below it.
  const sunset = (1 - smoothstep(0.0, 0.35, Math.abs(elev + 0.03))) * smoothstep(-0.3, -0.02, elev);

  const zenith = mixColor([0.01, 0.015, 0.05], [0.16, 0.40, 0.85], day);
  let horizon = mixColor([0.03, 0.05, 0.11], [0.66, 0.80, 0.95], day);
  horizon = mixColor(horizon, [1.0, 0.48, 0.24], sunset * 0.8);
  const sunColor = mixColor([1.0, 0.42, 0.16], [1.0, 0.96, 0.88], smoothstep(0.0, 0.45, elev));

  // The main light: the sun while it is up, the moon when it is down.
  // Both fade to zero at the horizon, so switching between them is smooth.
  let lightDir, lightColor;
  if (elev > 0) {
    lightDir = sunDir;
    lightColor = vec3.scale(sunColor, 1.05 * smoothstep(0.0, 0.12, elev));
  } else {
    lightDir = moonDir;
    lightColor = vec3.scale([0.55, 0.65, 0.95], 0.45 * smoothstep(0.0, 0.12, -elev));
  }
  let skyAmbient = mixColor([0.05, 0.06, 0.12], [0.40, 0.46, 0.58], day);
  skyAmbient = mixColor(skyAmbient, [0.55, 0.36, 0.30], sunset * 0.35);
  const groundAmbient = mixColor([0.02, 0.02, 0.035], [0.20, 0.18, 0.14], day);
  return { sunDir, moonDir, zenith, horizon, sunColor, night, lightDir, lightColor, skyAmbient, groundAmbient, glow: mix(1.0, 1.7, night) };
}

// Fixed light for the early levels (no sky yet): the class example's
// light, from above and slightly to the side.
const STUDIO_LIGHT = {
  lightDir: vec3.normalize([0.5, 1.0, 0.3]),
  lightColor: [0.78, 0.78, 0.76],
  skyAmbient: [0.34, 0.35, 0.40],
  groundAmbient: [0.18, 0.17, 0.16],
  horizon: [0.05, 0.06, 0.1],
  glow: 1.0,
};


// ---------------------------------------------------------------------
// 5. The camera
// ---------------------------------------------------------------------
function orbitEye() {
  const { theta, phi, radius, target } = state.orbit;
  return [
    target[0] + radius * Math.cos(phi) * Math.cos(theta),
    target[1] + radius * Math.sin(phi),
    target[2] + radius * Math.cos(phi) * Math.sin(theta),
  ];
}

function cameraFor(level) {
  const mode = (level === 'L3' || level === 'L4') ? $('cameraMode').value : 'orbit';
  if (mode === 'jet' && sky?.jets) {
    // Chase camera: behind and above the lead jet, looking ahead of it.
    const { point, tangent } = sky.jets[0];
    const flat = vec3.normalize([tangent[0], 0, tangent[2]]);
    return { eye: vec3.add(vec3.sub(point, vec3.scale(flat, 34)), [0, 9, 0]), target: vec3.add(point, vec3.scale(tangent, 14)) };
  }
  if (mode === 'rocket' && sky) {
    // A camera on the ground near the pad that tracks the rocket.
    const [px, py, pz] = sky.pad;
    const eye = [px + 22, py + 6, pz + 30];
    const target = sky.rocketState === 'gone' ? [px, py + 30, pz] : sky.rocketPose.point;
    return { eye, target };
  }
  return { eye: orbitEye(), target: state.orbit.target };
}

// Mouse/touch: drag to orbit, wheel to zoom.
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.orbit.theta += (e.clientX - drag.x) * 0.006;
  state.orbit.phi = clamp(state.orbit.phi + (e.clientY - drag.y) * 0.004, 0.05, 1.45);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const min = state.level === 'L0' ? 4 : 20, max = state.level === 'L0' ? 30 : 400;
  state.orbit.radius = clamp(state.orbit.radius * Math.exp(e.deltaY * 0.001), min, max);
}, { passive: false });


// ---------------------------------------------------------------------
// 6. Switching levels
// ---------------------------------------------------------------------
function setLevel(level) {
  state.level = level;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.level === level));
  document.querySelectorAll('[data-show]').forEach((el) => {
    el.style.display = el.dataset.show.split(' ').includes(level) ? '' : 'none';
  });
  const d = LEVELS[level];
  $('desc').innerHTML = `<div class="concept">${d.concept}</div><h2>${d.title}</h2><p>${d.text}</p>`;
  $('clock').style.display = level === 'L4' ? 'block' : 'none';
  // Good default camera distance per level.
  if (level === 'L0') { state.orbit.radius = 7; state.orbit.target = [0, 0, 0]; state.orbit.phi = 0.45; }
  else if (level === 'L3' || level === 'L4') { state.orbit.radius = 118; state.orbit.target = [0, 14, 0]; state.orbit.phi = 0.26; }
  else { state.orbit.radius = 120; state.orbit.target = [0, 2, 0]; state.orbit.phi = 0.5; }
  try { history.replaceState(null, '', '#' + level); } catch (_) { /* ignore */ }
  rebuildTerrain();
}


// ---------------------------------------------------------------------
// 7. Controls
// ---------------------------------------------------------------------
function bindOutput(inputId, outputId, format = (v) => v) {
  const update = () => { $(outputId).textContent = format(Number($(inputId).value)); };
  $(inputId).addEventListener('input', update);
  update();
}
bindOutput('gap', 'gapOut', (v) => Math.round(v * 100) + '%');
bindOutput('imgGap', 'imgGapOut', (v) => Math.round(v * 100) + '%');
bindOutput('procMax', 'procMaxOut');
bindOutput('maxH', 'maxHOut');
bindOutput('curve', 'curveOut', (v) => v.toFixed(1));
bindOutput('sea', 'seaOut');
bindOutput('tol', 'tolOut', (v) => v.toFixed(2));
bindOutput('timeOfDay', 'timeOut', formatHour);
bindOutput('dayLen', 'dayLenOut', (v) => v + ' s');
bindOutput('wave', 'waveOut', (v) => v.toFixed(2));
bindOutput('fog', 'fogOut', (v) => v.toFixed(2) + '×');
bindOutput('orbitSpeed', 'orbitSpeedOut', (v) => v.toFixed(2) + ' rad/s');

function formatHour(h) {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// Inputs that change the terrain. 'change' for selects, debounced 'input'
// for sliders so dragging stays smooth at high resolutions.
let rebuildTimer = null;
const scheduleRebuild = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildTerrain, 60); };
['procRes', 'heightMode', 'imgRes', 'sampling'].forEach((id) => $(id).addEventListener('change', rebuildTerrain));
['gap', 'procMax', 'maxH', 'curve', 'sea', 'imgGap'].forEach((id) => $(id).addEventListener('input', scheduleRebuild));
$('reseed').addEventListener('click', () => { state.seed++; rebuildTerrain(); });

$('showPaths').addEventListener('change', () => { if (sky) { sky.showPaths = $('showPaths').checked; sky.rebuildDebug(); updateSubdivInfo(); } });
$('tol').addEventListener('input', () => { if (sky) { sky.debugTolerance = Number($('tol').value); sky.rebuildDebug(); updateSubdivInfo(); } });
function updateSubdivInfo() {
  if (!sky || !sky.debugCounts || !$('showPaths').checked) { $('subdivInfo').textContent = ''; return; }
  $('subdivInfo').textContent = `Recursive subdivision: jet loop drawn with ${sky.debugCounts.jet} points, rocket path with ${sky.debugCounts.rocket}. White = anchors, pink = handles (P1, P2).`;
}
$('launch').addEventListener('click', () => {
  if (sky && sky.rocketState !== 'flying') { sky.rocketState = 'waiting'; sky.rocketTimer = 1.0; sky.rocketT = 0; }
});
$('timeOfDay').addEventListener('input', () => { state.timeOfDay = Number($('timeOfDay').value); });

$('fileH').addEventListener('change', async (e) => {
  if (!e.target.files[0]) return;
  const url = await readFileAsDataURL(e.target.files[0]);
  loadMaps(url, images.color?.src || DEFAULT_MAPS.color);
});
$('fileC').addEventListener('change', async (e) => {
  if (!e.target.files[0]) return;
  const url = await readFileAsDataURL(e.target.files[0]);
  loadMaps(images.height?.src || DEFAULT_MAPS.height, url);
});
$('resetMaps').addEventListener('click', () => loadMaps(DEFAULT_MAPS.height, DEFAULT_MAPS.color));

$('hideUi').addEventListener('click', () => document.body.classList.toggle('clean'));
let screenshotRequested = false;
$('screenshot').addEventListener('click', () => { screenshotRequested = true; });

document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setLevel(b.dataset.level)));
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key >= '0' && e.key <= '7') setLevel(LEVEL_KEYS[Number(e.key)]);
  else if (e.key === ' ') { e.preventDefault(); $('autoOrbit').checked = !$('autoOrbit').checked; }
  else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
  else if (e.key === 'p' || e.key === 'P') { $('showPaths').checked = !$('showPaths').checked; $('showPaths').dispatchEvent(new Event('change')); }
  else if (e.key === 'c' || e.key === 'C') {
    const sel = $('cameraMode');
    sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
  }
});


// ---------------------------------------------------------------------
// 8. The animation loop
// ---------------------------------------------------------------------
gl.enable(gl.DEPTH_TEST);   // keep the nearest fragment at each pixel
gl.enable(gl.CULL_FACE);    // skip triangles facing away from the camera
gl.cullFace(gl.BACK);

let lastTime = performance.now();
let fpsFrames = 0, fpsTime = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const time = now / 1000;
  const level = state.level;
  stats.drawCalls = 0;
  stats.cubes = 0;

  // ---- a. Size the canvas to its CSS size × the device pixel ratio
  // (clientWidth is in CSS pixels; high-DPI screens need more).
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, canvas.width, canvas.height);

  // ---- b. Animate the camera orbit (Level 1d and every level after).
  if ($('autoOrbit').checked && !drag) state.orbit.theta += Number($('orbitSpeed').value) * dt;

  // ---- c. Time of day and sky objects.
  const skyLevel = level === 'L3' || level === 'L4';
  if (level === 'L4' && $('playTime').checked) {
    state.timeOfDay = (state.timeOfDay + (24 / Number($('dayLen').value)) * dt) % 24;
    $('timeOfDay').value = state.timeOfDay;
    $('timeOut').textContent = formatHour(state.timeOfDay);
  }
  const hour = level === 'L4' ? state.timeOfDay : 15.5;
  const light = skyLevel ? skyAt(hour) : STUDIO_LIGHT;
  if (skyLevel && sky) sky.update(dt, time, { constantSpeed: $('constantSpeed').checked });
  if (level === 'L4') $('clock').textContent = formatHour(state.timeOfDay);

  // ---- d. Camera matrices.
  const cam = cameraFor(level);
  const view = mat4.lookAt(cam.eye, cam.target, [0, 1, 0]);
  const near = level === 'L0' ? 0.1 : 0.5;
  const projection = mat4.perspective((50 * Math.PI) / 180, canvas.width / canvas.height, near, 4000);

  // ---- e. Clear, then draw the sky first (it sits at the far plane).
  const bg = skyLevel ? light.horizon : [0.035, 0.045, 0.08];
  gl.clearColor(bg[0], bg[1], bg[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (skyLevel) drawSky(view, projection, light, time);

  // ---- f. Set the cube program's uniforms for this frame.
  gl.useProgram(cubeProgram.program);
  const u = cubeProgram.uniforms;
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniformMatrix4fv(u.uProjection, false, projection);
  gl.uniform3fv(u.uCameraPos, cam.eye);
  gl.uniform1f(u.uTime, time);
  gl.uniform3fv(u.uLightDir, light.lightDir);
  gl.uniform3fv(u.uLightColor, light.lightColor);
  gl.uniform3fv(u.uSkyAmbient, light.skyAmbient);
  gl.uniform3fv(u.uGroundAmbient, light.groundAmbient);
  gl.uniform3fv(u.uFogColor, light.horizon);
  gl.uniform1f(u.uGlow, light.glow);
  const haze = level === 'L4' ? Number($('fog').value) : 1;
  gl.uniform1f(u.uFogDensity, skyLevel ? 0.0032 * haze : 0);
  gl.uniform1f(u.uWaveHeight, level === 'L4' ? Number($('wave').value) : level === 'L3' ? 0.3 : 0);

  let colorMode = 0, lit = 1;
  if (level === 'L0') colorMode = 3;
  if (level === 'L1c') { colorMode = Number($('colorMode').value); lit = $('lit').checked ? 1 : 0; }
  gl.uniform1i(u.uColorMode, colorMode);
  gl.uniform1i(u.uLit, lit);

  // ---- g. Draw.
  if (level === 'L0') {
    // Spin the cube so all six faces show: rotate about y, tilt about x.
    singleCube.draw(mat4.multiply(mat4.rotationY(time * 0.6), mat4.rotationX(0.35)));
  } else {
    terrainBatch.draw();
    if (skyLevel && sky) {
      oceanBatch?.draw();
      sky.drawGround();
      // Far-away objects: thinner fog, so the planet reads as "in the sky".
      gl.uniform1f(u.uFogDensity, 0.0006 * haze);
      sky.drawSpace();
    }
  }

  // ---- h. HUD (updated twice a second).
  fpsFrames++; fpsTime += dt;
  if (fpsTime > 0.5) {
    $('hudFps').textContent = Math.round(fpsFrames / fpsTime);
    $('hudCubes').textContent = stats.cubes.toLocaleString();
    $('hudCalls').textContent = stats.drawCalls;
    fpsFrames = 0; fpsTime = 0;
  }

  // Screenshots must be taken in the same frame as drawing, before the
  // browser clears the canvas for the next one.
  if (screenshotRequested) {
    screenshotRequested = false;
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cube-world-${level}-${Date.now()}.png`;
      a.click();
    });
  }
  requestAnimationFrame(frame);
}


// ---------------------------------------------------------------------
// 9. Start
// ---------------------------------------------------------------------
const startLevel = LEVEL_KEYS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'L0';
setLevel(startLevel);
loadMaps(DEFAULT_MAPS.height, DEFAULT_MAPS.color);
requestAnimationFrame(frame);
