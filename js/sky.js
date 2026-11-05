// =====================================================================
//  sky.js: the skyscape (Level 3). Jets, a rocket and a ringed planet,
//  all built from scaled and translated cubes, moved by Bézier curves.
// =====================================================================
//
// Every object below is a list of boxes in its OWN local coordinates
// (its "model space"): the jet's nose points along +z, its wings span x,
// and up is +y. Each object is one CubeBatch, uploaded once. To move the
// whole object we change ONE matrix, uObject, which the vertex shader
// applies after each box's own scale and translation:
//
//   world = uObject × (box offset + corner × box scale)
//
// so a box is SCALED, then TRANSLATED into its place on the model, and
// then the model is ROTATED and TRANSLATED into the world. The jets and
// the rocket get their rotation from the Bézier curve's tangent.
// =====================================================================

const COLORS = {
  hull: [0.90, 0.92, 0.95], darkHull: [0.22, 0.26, 0.34], trim: [1.0, 0.55, 0.12],
  glass: [0.35, 0.90, 1.0], plasma: [0.45, 0.85, 1.0], portLight: [1.0, 0.15, 0.15],
  starLight: [0.2, 1.0, 0.35], rocketWhite: [0.96, 0.96, 0.97], rocketBlack: [0.12, 0.12, 0.14],
  rocketRed: [0.85, 0.12, 0.10], gantryRed: [0.75, 0.18, 0.12], steel: [0.62, 0.64, 0.68],
  padLight: [1.0, 0.85, 0.3],
};

// ---------------------------------------------------------------------
// 1. Models
// ---------------------------------------------------------------------

// A futuristic delta-wing jet, about 11 units long before scaling.
function buildJetModel() {
  const m = new InstanceList();
  m.box(0, 0, 0, 1.3, 1.0, 8.0, COLORS.hull);                  // fuselage
  m.box(0, -0.05, 4.6, 0.9, 0.75, 1.4, COLORS.hull);           // nose
  m.box(0, -0.1, 5.6, 0.45, 0.4, 0.9, COLORS.darkHull);        // nose tip
  m.box(0, 0.62, 2.2, 0.75, 0.45, 2.0, COLORS.glass, 2);       // cockpit canopy (glows)
  m.box(0, 0.52, -1.0, 0.32, 0.06, 5.0, COLORS.trim);          // racing stripe
  // Delta wing: a staircase of boxes, each wider than the one before.
  for (let i = 0; i < 5; i++) {
    const span = 2.0 + i * 2.3;
    m.box(0, -0.15, 0.6 - i * 0.9, span, 0.18, 0.9, i % 2 ? COLORS.darkHull : [0.30, 0.35, 0.46]);
  }
  const tip = (2.0 + 4 * 2.3) / 2;
  m.box(tip, -0.05, -3.0, 0.3, 0.3, 0.3, COLORS.portLight, 2);   // port light (red, left)
  m.box(-tip, -0.05, -3.0, 0.3, 0.3, 0.3, COLORS.starLight, 2);  // starboard light (green, right)
  m.box(tip - 0.4, -0.15, -3.2, 0.8, 0.2, 0.6, COLORS.trim);      // wingtip trim
  m.box(-tip + 0.4, -0.15, -3.2, 0.8, 0.2, 0.6, COLORS.trim);
  m.box(0, -0.05, 3.1, 3.2, 0.12, 0.5, COLORS.darkHull);         // canards
  // Twin tail fins.
  m.box(0.75, 1.0, -3.3, 0.15, 1.7, 1.5, COLORS.darkHull);
  m.box(-0.75, 1.0, -3.3, 0.15, 1.7, 1.5, COLORS.darkHull);
  m.box(0.75, 1.7, -3.6, 0.17, 0.3, 0.8, COLORS.trim);
  m.box(-0.75, 1.7, -3.6, 0.17, 0.3, 0.8, COLORS.trim);
  // Two engines with glowing plasma exhausts.
  for (const x of [0.6, -0.6]) {
    m.box(x, -0.1, -4.2, 0.75, 0.75, 1.0, COLORS.darkHull);
    m.box(x, -0.1, -4.85, 0.55, 0.55, 0.4, COLORS.plasma, 2);
  }
  return m;
}

// A rocket standing on its tail. Its long axis is local +z (so the same
// "forward = tangent" rule as the jet points its nose along the curve).
// A round body is suggested by overlapping a square box with two
// narrower, taller ones (a "plus" cross section).
function buildRocketModel() {
  const m = new InstanceList();
  const body = (z, len, w, color) => {
    m.box(0, 0, z, w, w, len, color);
    m.box(0, 0, z, w * 1.22, w * 0.72, len, color);
    m.box(0, 0, z, w * 0.72, w * 1.22, len, color);
  };
  body(0, 10, 1.7, COLORS.rocketWhite);         // main body
  body(2.4, 0.45, 1.78, COLORS.rocketBlack);    // stripes
  body(-2.6, 0.45, 1.78, COLORS.rocketBlack);
  body(5.6, 1.2, 1.45, COLORS.rocketRed);       // nose cone, in steps
  body(6.6, 0.9, 1.0, COLORS.rocketRed);
  body(7.35, 0.7, 0.55, COLORS.rocketRed);
  body(-5.5, 1.0, 1.4, COLORS.rocketBlack);     // engine section
  m.box(0, 0.95, 3.6, 0.55, 0.2, 0.55, COLORS.glass, 2); // window
  // Four fins.
  m.box(1.45, 0, -4.4, 1.3, 0.18, 2.2, COLORS.rocketRed);
  m.box(-1.45, 0, -4.4, 1.3, 0.18, 2.2, COLORS.rocketRed);
  m.box(0, 1.45, -4.4, 0.18, 1.3, 2.2, COLORS.rocketRed);
  m.box(0, -1.45, -4.4, 0.18, 1.3, 2.2, COLORS.rocketRed);
  return m;
}

// The launch gantry: a lattice tower of thin cubes beside the pad.
function buildLaunchSite(pad) {
  const m = new InstanceList();
  const [px, py, pz] = pad;
  m.box(px, py + 0.15, pz, 7, 0.3, 7, COLORS.steel);                // pad slab
  const tx = px + 4.2, tz = pz;                                      // tower center
  const height = 16;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    m.box(tx + dx * 0.9, py + height / 2, tz + dz * 0.9, 0.25, height, 0.25, COLORS.gantryRed);
  }
  for (let y = 1.5; y < height; y += 1.6) {
    m.box(tx, py + y, tz - 0.9, 2.0, 0.18, 0.18, COLORS.gantryRed);
    m.box(tx, py + y, tz + 0.9, 2.0, 0.18, 0.18, COLORS.gantryRed);
    m.box(tx - 0.9, py + y, tz, 0.18, 0.18, 2.0, COLORS.gantryRed);
    m.box(tx + 0.9, py + y, tz, 0.18, 0.18, 2.0, COLORS.gantryRed);
  }
  m.box(tx - 2.0, py + 11, tz, 3.0, 0.3, 0.6, COLORS.steel);          // service arm
  m.box(tx, py + height + 0.4, tz, 0.4, 0.8, 0.4, COLORS.padLight, 2); // beacon
  for (const [dx, dz] of [[-3.3, -3.3], [3.3, -3.3], [3.3, 3.3], [-3.3, 3.3]]) {
    m.box(px + dx, py + 0.5, pz + dz, 0.35, 0.7, 0.35, COLORS.padLight, 2);
  }
  return m;
}

// A gas giant made of cubes. We test every cell of a 3D grid and keep
// the cells inside a thin spherical SHELL (the inside can never be seen,
// so skipping it saves thousands of cubes). Color comes from latitude
// bands plus a storm, like Jupiter; a flat ring of cubes circles it.
function buildPlanetModel(R) {
  const m = new InstanceList();
  const bands = [[0.94, 0.87, 0.72], [0.82, 0.63, 0.43], [0.95, 0.91, 0.82], [0.68, 0.42, 0.26], [0.88, 0.76, 0.58]];
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      for (let z = -R; z <= R; z++) {
        const d = Math.hypot(x, y, z);
        if (d > R || d < R - 1.8) continue;
        const lat = y / R;
        const wobble = 0.08 * Math.sin(Math.atan2(z, x) * 3 + lat * 9);
        const band = Math.floor(((lat + wobble) * 0.5 + 0.5) * 9);
        let c = bands[((band % bands.length) + bands.length) % bands.length];
        // The storm: an oval near latitude -0.35, on one side of the planet.
        const lon = Math.atan2(z, x);
        if (Math.hypot((lat + 0.35) / 0.1, (lon - 0.9) / 0.35) < 1) c = [0.85, 0.35, 0.18];
        const shade = 0.92 + 0.08 * hash2(x * 7 + z, y * 13, 5);
        m.box(x, y, z, 1, 1, 1, [c[0] * shade, c[1] * shade, c[2] * shade]);
      }
    }
  }
  // The ring: cells between 1.45R and 2.25R in the planet's equator plane,
  // with a gap (the "Cassini division") and a few random holes.
  for (let x = -Math.ceil(2.3 * R); x <= 2.3 * R; x++) {
    for (let z = -Math.ceil(2.3 * R); z <= 2.3 * R; z++) {
      const r = Math.hypot(x, z) / R;
      if (r < 1.45 || r > 2.25 || (r > 1.78 && r < 1.86)) continue;
      if (hash2(x, z, 9) < 0.18) continue;
      const t = (r - 1.45) / 0.8;
      const c = mixColor([0.80, 0.74, 0.64], [0.55, 0.50, 0.46], t);
      m.box(x, 0, z, 1, 0.35, 1, c);
    }
  }
  return m;
}

function buildMoonModel(R) {
  const m = new InstanceList();
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
    const d = Math.hypot(x, y, z);
    if (d > R || d < R - 1.6) continue;
    const g = 0.55 + 0.3 * hash2(x * 3 + y, z * 5 - y, 2);
    m.box(x, y, z, 1, 1, 1, [g, g, g * 1.04]);
  }
  return m;
}


// ---------------------------------------------------------------------
// 2. Orientation from a tangent
// ---------------------------------------------------------------------
// Build an object matrix that puts the model at `position` with its +z
// axis along `forward` (the curve's unit tangent). We still need an up
// direction: start from world up, tilt it sideways by `roll` radians so
// the jet BANKS into turns, then use cross products to make the three
// axes perpendicular (Gram-Schmidt, like lookAt).
function poseAlong(position, forward, roll = 0, size = 1) {
  const worldUp = Math.abs(forward[1]) > 0.97 ? [1, 0, 0] : [0, 1, 0];
  const flatRight = vec3.normalize(vec3.cross(worldUp, forward));
  const upRef = vec3.add(vec3.scale(worldUp, Math.cos(roll)), vec3.scale(flatRight, Math.sin(roll)));
  const right = vec3.normalize(vec3.cross(upRef, forward));
  const up = vec3.cross(forward, right);
  return mat4.multiply(mat4.fromBasis(right, up, forward, position), mat4.scaling(size, size, size));
}


// ---------------------------------------------------------------------
// 3. The skyscape: builds everything and moves it each frame
// ---------------------------------------------------------------------
class SkyScape {
  constructor(padPosition, seaHeight) {
    this.pad = padPosition;
    this.jetBatch = buildJetModel().toBatch();
    this.rocketBatch = buildRocketModel().toBatch();
    this.siteBatch = buildLaunchSite(padPosition).toBatch();
    this.planetBatch = buildPlanetModel(15).toBatch();
    this.moonBatch = buildMoonModel(4).toBatch();
    this.flameBatch = new CubeBatch(true);
    this.smokeBatch = new CubeBatch(true);
    this.debugBatch = new CubeBatch(true);
    this.smoke = [];

    // The jets' route: six anchors around the archipelago, joined into a
    // closed loop of six cubic Bézier segments (see BezierPath).
    // It dives low between the volcano and the launch-pad island.
    this.jetPath = new BezierPath([
      [-38, 34, -40], [10, 42, -46], [44, 30, -18], [30, 16, 8],
      [-2, 14, 40], [-42, 26, 22],
    ], { closed: true });

    this.buildRocketPath();

    this.jetDistance = 0;          // distance flown along the path
    this.jetSpeed = 22;            // world units per second
    this.rocketState = 'waiting';
    this.rocketTimer = 2.5;
    this.rocketT = 0;
    this.planetCenter = [250, 55, -300];
    this.debugTolerance = 0.5;  // matches the slider's starting value
    this.showPaths = false;
  }

  // Called when the terrain changes height (new settings or new images),
  // so the launch site and the rocket's path stay on the ground.
  setPad(padPosition) {
    this.pad = padPosition;
    this.siteBatch.dispose();
    this.siteBatch = buildLaunchSite(padPosition).toBatch();
    this.buildRocketPath();
    if (this.showPaths) this.rebuildDebug();
  }

  // The rocket's flight is ONE cubic Bézier segment:
  //   P0 on the pad, P1 straight above it   → it lifts off vertically
  //   P2 high and to the side, P3 far away  → it pitches over and leaves
  // Because P1 - P0 points straight up, the tangent at t = 0 is vertical,
  // so the rocket starts upright with no special case.
  buildRocketPath() {
    const [px, py, pz] = this.pad;
    const p0 = [px, py + 4.8, pz];
    this.rocketPath = new BezierPath(null, {
      closed: false,
      segments: [[p0, [px, py + 70, pz], [px - 60, py + 150, pz - 90], [px - 260, py + 230, pz - 380]]],
    });
  }

  rebuildDebug() {
    const list = new InstanceList();
    const addPath = (path, curveColor) => {
      const { curve, anchors, handles } = path.debugPoints(this.debugTolerance);
      // Subdivision points: dense where the curve bends, sparse where it is straight.
      for (const p of curve) list.box(p[0], p[1], p[2], 0.45, 0.45, 0.45, curveColor, 2);
      for (const p of anchors) list.box(p[0], p[1], p[2], 1.3, 1.3, 1.3, [1, 1, 1], 2);
      // Handles, with a dotted line back to their anchor.
      path.segments.forEach((seg) => {
        for (const [a, h] of [[seg[0], seg[1]], [seg[3], seg[2]]]) {
          list.box(h[0], h[1], h[2], 0.9, 0.9, 0.9, [1, 0.2, 0.9], 2);
          for (let i = 1; i < 10; i++) {
            const q = vec3.lerp(a, h, i / 10);
            list.box(q[0], q[1], q[2], 0.2, 0.2, 0.2, [1, 0.5, 0.95], 2);
          }
        }
      });
      return curve.length;
    };
    this.debugCounts = {
      jet: addPath(this.jetPath, [1, 0.85, 0.2]),
      rocket: addPath(this.rocketPath, [0.4, 1, 0.6]),
    };
    this.debugBatch.upload(new Float32Array(list.data), list.count);
  }

  update(dt, time, { constantSpeed }) {
    this.time = time;
    // ---- Jets: move along the loop ----
    this.jetDistance += this.jetSpeed * dt;
    const poseAt = (distance, lateral = 0, lift = 0) => {
      // With constant speed on, convert distance → u through the arc
      // length table. Off, use u directly, so the jet speeds up on long
      // segments and slows down on short ones.
      const u = constantSpeed
        ? this.jetPath.uAtDistance(distance)
        : (distance / this.jetPath.length) * this.jetPath.segments.length;
      const { point, tangent } = this.jetPath.evaluate(u);
      // Bank: compare this tangent with one a little further ahead. The
      // vertical part of their cross product says how fast and which way
      // the path is turning.
      const ahead = this.jetPath.evaluate(u + 0.08).tangent;
      const turn = vec3.cross(tangent, ahead)[1];
      const roll = clamp(turn * 5, -0.8, 0.8);
      const right = vec3.normalize(vec3.cross([0, 1, 0], tangent));
      const pos = vec3.add(vec3.add(point, vec3.scale(right, lateral)), [0, lift, 0]);
      return { matrix: poseAlong(pos, tangent, roll, 0.8), point: pos, tangent };
    };
    this.jets = [poseAt(this.jetDistance), poseAt(this.jetDistance - 9, 7, -1), poseAt(this.jetDistance - 9, -7, -1)];

    // ---- Rocket: wait on the pad → fly → vanish far away → reset ----
    this.rocketTimer -= dt;
    if (this.rocketState === 'waiting' && this.rocketTimer <= 0) {
      this.rocketState = 'flying';
      this.rocketFlightTime = 0;
    }
    if (this.rocketState === 'flying') {
      this.rocketFlightTime += dt;
      // Ease-in: t = τ², so the rocket starts slowly and ACCELERATES,
      // like a real launch (τ is the fraction of the 11 s flight).
      const tau = this.rocketFlightTime / 11;
      this.rocketT = tau * tau;
      if (this.rocketT >= 1) {
        // "Far away": hide it, then put it back on the pad.
        this.rocketState = 'gone';
        this.rocketTimer = 3;
      }
    } else if (this.rocketState === 'gone' && this.rocketTimer <= 0) {
      this.rocketState = 'waiting';
      this.rocketTimer = 5;
      this.rocketT = 0;
    }
    const seg = this.rocketPath.segments[0];
    const { point, tangent } = bezierPointAndTangent(seg, Math.min(this.rocketT, 1));
    this.rocketPose = { point, tangent, matrix: poseAlong(point, tangent, 0, 0.6) };

    // Flame: a few glowing cubes behind the engine, with random sizes
    // every frame so it flickers. Drawn with the rocket's own matrix.
    const flame = new InstanceList();
    if (this.rocketState === 'flying' || (this.rocketState === 'waiting' && this.rocketTimer < 1.2)) {
      const power = this.rocketState === 'flying' ? 1 : 0.4;
      for (let i = 0; i < 6; i++) {
        const w = (1.4 - i * 0.18) * (0.8 + Math.random() * 0.4) * power;
        const color = mixColor([1.0, 0.95, 0.6], [1.0, 0.35, 0.05], i / 5);
        flame.box((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, -6.3 - i * 0.9 * power, w, w, 1.0 * power, color, 2);
      }
    }
    this.flameBatch.upload(new Float32Array(flame.data), flame.count);

    // Smoke: drop a puff at the tail while flying; puffs grow and fade.
    if (this.rocketState === 'flying') {
      const tail = vec3.sub(point, vec3.scale(tangent, 4.5));
      for (let k = 0; k < 2; k++) {
        this.smoke.push({ p: vec3.add(tail, [(Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2]), age: 0, life: 3 + Math.random() * 2 });
      }
    }
    const smoke = new InstanceList();
    this.smoke = this.smoke.filter((s) => (s.age += dt) < s.life);
    for (const s of this.smoke) {
      const f = s.age / s.life;
      const size = (0.8 + f * 5) * (1 - f * f);           // grows, then shrinks to nothing
      const g = mix(0.95, 0.6, f);
      s.p[1] += dt * 0.6;                                  // smoke drifts upward
      smoke.box(s.p[0], s.p[1], s.p[2], size, size, size, [g, g, g], 3);
    }
    this.smokeBatch.upload(new Float32Array(smoke.data), smoke.count);
  }

  // The planet and its moon are far away, so they use lighter fog.
  planetMatrix() {
    return mat4.chain(
      mat4.translation(...this.planetCenter),
      mat4.rotationZ(0.42),                    // axial tilt
      mat4.rotationY(this.time * 0.04),        // slow spin
      mat4.scaling(3.0, 3.0, 3.0),             // 1 cube cell = 3 world units
    );
  }
  moonMatrix() {
    // A circular orbit around the planet: rotate, then push out.
    return mat4.chain(
      mat4.translation(...this.planetCenter),
      mat4.rotationZ(0.42),
      mat4.rotationY(this.time * 0.12),
      mat4.translation(112, 10, 0),
      mat4.rotationY(this.time * 0.3),
      mat4.scaling(2.6, 2.6, 2.6),
    );
  }

  drawGround() {
    this.siteBatch.draw();
    if (this.rocketState !== 'gone') {
      this.rocketBatch.draw(this.rocketPose.matrix);
      this.flameBatch.draw(this.rocketPose.matrix);
    }
    this.smokeBatch.draw();
    for (const jet of this.jets) this.jetBatch.draw(jet.matrix);
    if (this.showPaths) this.debugBatch.draw();
  }

  drawSpace() {
    this.planetBatch.draw(this.planetMatrix());
    this.moonBatch.draw(this.moonMatrix());
  }
}
