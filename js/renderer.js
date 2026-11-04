// =====================================================================
//  renderer.js: the ONE cube, its shaders, and instanced drawing
// =====================================================================
//
// THE BIG PICTURE
// ---------------
// The only model in this project is a 2×2×2 cube. Its 24 vertices (4 per
// face) and 36 indices (2 triangles per face) are copied into GPU memory
// once. Everything else (terrain, jet, rocket, planet, even the sky) is
// that cube drawn again with different numbers.
//
// INSTANCED DRAWING
// The class example draws a grid with one draw call PER CUBE, setting a
// uModel uniform each time. That is fine for 100 cubes, but 512 × 512 =
// 262,144 cubes would be 262,144 draw calls per frame: the CPU spends all
// its time talking to the GPU, and the frame rate collapses.
//
// Instead, each batch of cubes gets a second buffer, the INSTANCE buffer,
// with one row per cube:
//
//     offset (x, y, z)   where the cube's center goes   → translation
//     scale  (x, y, z)   half its width, height, depth  → scaling
//     color  (r, g, b)   its color, sampled from the color map
//     kind              0 = solid, 1 = water, 2 = glowing (lava, flames, lights), 3 = smoke
//
// gl.vertexAttribDivisor(location, 1) tells WebGL "advance this attribute
// once per CUBE, not once per vertex". Then ONE call,
//     gl.drawElementsInstanced(TRIANGLES, 36, ..., cubeCount)
// draws every cube in the batch. The vertex shader does the
// translate-and-scale itself: world = offset + corner × scale.
//
// VERTEX ARRAY OBJECTS (VAOs)
// Each batch (terrain, jet, rocket smoke...) and the sky use different
// buffers. A VAO remembers ALL the bindBuffer / enableVertexAttribArray /
// vertexAttribPointer / divisor settings for one batch, so switching
// batches is a single gl.bindVertexArray call. That avoids the class of
// bug where one draw call accidentally reads another program's buffers.
// =====================================================================

// ---------------------------------------------------------------------
// 0. Get a WebGL 2 context
// ---------------------------------------------------------------------
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
if (!gl) {
  document.getElementById('fallback').style.display = 'block';
  throw new Error('WebGL 2 is not available in this browser.');
}

// Attribute locations, fixed so every VAO and program agree on them.
const LOC = { position: 0, normal: 1, offset: 2, scale: 3, color: 4, kind: 5 };


// ---------------------------------------------------------------------
// 1. SHADERS
//    "// language=GLSL" and "/* glsl */" only turn on GLSL syntax
//    highlighting in JetBrains IDEs and VS Code. They change nothing.
// ---------------------------------------------------------------------

// language=GLSL
const cubeVertexSource = /* glsl */ `#version 300 es
  layout(location = 0) in vec3 aPosition;  // cube corner, from -1 to 1 (the 2×2×2 cube)
  layout(location = 1) in vec3 aNormal;    // per-vertex normal (the face's direction)
  layout(location = 2) in vec3 iOffset;    // PER INSTANCE: center of this cube
  layout(location = 3) in vec3 iScale;     // PER INSTANCE: half-size in x, y, z
  layout(location = 4) in vec3 iColor;     // PER INSTANCE: color
  layout(location = 5) in float iKind;     // PER INSTANCE: 0 solid, 1 water, 2 glowing, 3 smoke

  uniform mat4 uObject;      // places a whole object (identity for terrain; jet's pose in Level 3)
  uniform mat4 uView;        // camera
  uniform mat4 uProjection;  // perspective (pinhole camera)
  uniform int  uColorMode;   // 0 instance color, 1 height gradient, 2 world-position rainbow, 3 normals
  uniform float uTime;
  uniform float uWaveHeight; // 0 = still water

  out vec3 vColor;
  out vec3 vNormal;
  out vec3 vWorld;
  out float vKind;

  // Hue (0..1) to an RGB color, for the rainbow mode.
  vec3 hue(float h) {
    vec3 k = abs(fract(h + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0;
    return clamp(k, 0.0, 1.0);
  }

  void main() {
    // --- Model transform for this instance: SCALE, then TRANSLATE. ---
    // Same as  translation(iOffset) * scaling(iScale) * corner,
    // written out because a diagonal scaling matrix just multiplies
    // each coordinate.
    vec3 local = iOffset + aPosition * iScale;

    // Water cubes bob up and down. Only the top corners move, so each
    // water column's height changes and the bottom stays on the ground.
    // The wave only lifts (0..uWaveHeight), so the open-ocean cube just
    // below the water surface never pokes through. That ocean cube is
    // thousands of units wide (iScale.x > 50) and is left still.
    if (iKind > 0.5 && iKind < 1.5 && aPosition.y > 0.0 && iScale.x < 50.0) {
      float wave = sin(iOffset.x * 0.35 + uTime * 1.3) + cos(iOffset.z * 0.29 + uTime * 1.1); // -2..2
      local.y += uWaveHeight * (wave * 0.25 + 0.5);
    }

    vec4 world = uObject * vec4(local, 1.0);
    vWorld = world.xyz;

    // Turn the normal with the object. mat3(uObject) is enough here
    // because uObject only rotates, translates and scales uniformly, and
    // each instance's own scaling is along the cube's axes, which does
    // not change the direction of an axis-aligned face normal.
    // (In general you need the inverse transpose of the model matrix.)
    vNormal = mat3(uObject) * aNormal;
    // Water columns are lit as one flat surface (their walls use the top
    // face's normal), so the steps between water cubes don't show.
    if (iKind > 0.5 && iKind < 1.5) vNormal = vec3(0.0, 1.0, 0.0);
    vKind = iKind;

    // --- Vertex colors (Level 1c). Each mode is a procedure that gives
    // each VERTEX its own color; the rasterizer then INTERPOLATES the
    // colors across each triangle. ---
    if (uColorMode == 1) {
      // Height gradient: bottom corners dark, top corners the cube's color.
      float up = aPosition.y * 0.5 + 0.5;                    // 0 bottom, 1 top
      vColor = mix(iColor * 0.18, iColor, up);
    } else if (uColorMode == 2) {
      // Rainbow from WORLD position: every corner of every cube differs,
      // so each face shows a smooth interpolated gradient.
      vColor = hue(world.x * 0.012 + world.z * 0.008 + world.y * 0.03);
    } else if (uColorMode == 3) {
      vColor = aNormal * 0.5 + 0.5;                           // face direction as color
    } else {
      // Instance color, with the lower part of each column slightly
      // darker so the side walls of neighboring cubes are easy to read.
      float up = aPosition.y * 0.5 + 0.5;
      vColor = iColor * (iKind > 0.5 ? 1.0 : mix(0.55, 1.0, up));
    }

    // model → world → camera → clip space
    gl_Position = uProjection * uView * world;
  }
`;

// language=GLSL
const cubeFragmentSource = /* glsl */ `#version 300 es
  precision highp float;

  in vec3 vColor;
  in vec3 vNormal;
  in vec3 vWorld;
  in float vKind;

  uniform vec3 uLightDir;      // unit vector TOWARD the sun (or moon)
  uniform vec3 uLightColor;
  uniform vec3 uSkyAmbient;    // light from the whole sky (fills shadows)
  uniform vec3 uGroundAmbient; // light bounced up from the ground
  uniform vec3 uCameraPos;
  uniform vec3 uFogColor;
  uniform float uFogDensity;   // 0 = no fog
  uniform float uGlow;         // how bright glowing cubes are (more at night)
  uniform int uLit;            // 0 = show the raw interpolated color (Level 1c)

  out vec4 fragColor;

  void main() {
    // The rasterizer interpolated vNormal between the triangle's vertices;
    // after interpolation it can be shorter than 1, so normalize again.
    vec3 n = normalize(vNormal);
    vec3 color = vColor;

    if (uLit == 1) {
      if (vKind > 1.5 && vKind < 2.5) {
        // Glowing cubes ignore lighting: lava, rocket flame, jet lights.
        color = vColor * uGlow;
      }
      if (vKind < 1.5 || vKind > 2.5) {
        // Lambert's cosine law: brightness = n · l (both unit vectors).
        float diffuse = max(dot(n, uLightDir), 0.0);
        // Smoke (kind 3) uses "half-Lambert" wrap lighting, n·l × ½ + ½,
        // so faces turned away from the sun stay soft instead of black.
        if (vKind > 2.5) diffuse = dot(n, uLightDir) * 0.5 + 0.5;
        // Hemisphere ambient: faces pointing up see the sky, faces
        // pointing down see the ground.
        vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);
        vec3 light = ambient + uLightColor * diffuse;
        color = vColor * light;

        // Water: add a sun glint (Blinn-Phong specular highlight).
        if (vKind > 0.5 && vKind < 1.5) {
          vec3 v = normalize(uCameraPos - vWorld);
          vec3 h = normalize(uLightDir + v);
          color += uLightColor * pow(max(dot(n, h), 0.0), 60.0) * 0.6;
        }
      }
      // Distance fog: the farther the fragment, the more it fades into
      // the sky's horizon color (exponential-squared falloff).
      float d = length(uCameraPos - vWorld);
      float fog = 1.0 - exp(-pow(d * uFogDensity, 2.0));
      color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));
    }

    fragColor = vec4(color, 1.0);
  }
`;

// ----- The sky: the SAME cube, drawn around the camera (a skybox) -----
// We draw the cube with the camera at its center, ignoring the camera's
// position (only its rotation), so the sky never gets closer. The
// fragment shader receives the interpolated direction from the center to
// each fragment and computes the sky color for that direction.
// language=GLSL
const skyVertexSource = /* glsl */ `#version 300 es
  layout(location = 0) in vec3 aPosition;
  uniform mat4 uViewRotation;  // the view matrix with its translation removed
  uniform mat4 uProjection;
  out vec3 vDirection;
  void main() {
    vDirection = aPosition;
    vec4 clip = uProjection * uViewRotation * vec4(aPosition, 1.0);
    // z = w puts every sky fragment at the far plane (depth 1.0), so the
    // terrain and sky objects are always drawn in front of it.
    gl_Position = clip.xyww;
  }
`;

// language=GLSL
const skyFragmentSource = /* glsl */ `#version 300 es
  precision highp float;
  in vec3 vDirection;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;      // color straight up
  uniform vec3 uHorizon;     // color at the horizon (also the fog color)
  uniform vec3 uSunColor;
  uniform float uNight;      // 0 day, 1 full night (stars visible)
  uniform float uTime;
  out vec4 fragColor;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDirection);
    // Gradient from horizon to zenith by elevation.
    float up = clamp(d.y, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(up, 0.55));
    // Below the horizon, fade to a darker version of the horizon color.
    if (d.y < 0.0) sky = mix(uHorizon, uHorizon * 0.55, clamp(-d.y * 3.0, 0.0, 1.0));

    // Sun: a bright disc plus a wide glow, which is what turns the
    // horizon orange at sunrise and sunset.
    float sunDot = max(dot(d, uSunDir), 0.0);
    sky += uSunColor * pow(sunDot, 8.0) * 0.35;
    sky += uSunColor * smoothstep(0.9993, 0.9997, sunDot) * 4.0;

    // Moon: a pale disc with a soft halo.
    float moonDot = max(dot(d, uMoonDir), 0.0);
    sky += vec3(0.85, 0.9, 1.0) * smoothstep(0.9990, 0.9994, moonDot) * uNight * 1.4;
    sky += vec3(0.3, 0.35, 0.5) * pow(moonDot, 30.0) * uNight * 0.3;

    // Stars: hash the direction into small cells; a few cells get a star.
    vec3 cell = floor(d * 220.0);
    float h = hash(cell);
    if (h > 0.9965 && d.y > -0.05) {
      float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + h * 100.0);
      sky += vec3(1.0) * twinkle * uNight * smoothstep(0.0, 0.15, d.y + 0.05);
    }
    fragColor = vec4(sky, 1.0);
  }
`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(vsSource, fsSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  // Look up every active uniform once; programs[name] gives its location.
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

const cubeProgram = createProgram(cubeVertexSource, cubeFragmentSource);
const skyProgram = createProgram(skyVertexSource, skyFragmentSource);


// ---------------------------------------------------------------------
// 2. THE CUBE: 24 vertices (4 corners × 6 faces) and 36 indices
//    A cube has 8 corners, but each corner touches 3 faces that point
//    different ways. A vertex can only carry ONE normal, so every corner
//    is stored once per face: 6 faces × 4 = 24 vertices.
//    The 2 triangles of each face reuse 2 of its 4 vertices, so an index
//    buffer lists 36 indices instead of storing 36 vertices.
// ---------------------------------------------------------------------
const cubeData = (() => {
  // For each face: its normal, and two axes that span it.
  const faces = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },   // front  (+z)
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }, // back   (-z)
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },  // right  (+x)
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },  // left   (-x)
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },  // top    (+y)
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },  // bottom (-y)
  ];
  const vertices = [];
  const indices = [];
  faces.forEach(({ n, u, v }, f) => {
    // Four corners: center of face (= n) ± u ± v, counter-clockwise
    // when seen from outside, so back-face culling can discard the
    // faces that point away from the camera.
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      vertices.push(
        n[0] + su * u[0] + sv * v[0], n[1] + su * u[1] + sv * v[1], n[2] + su * u[2] + sv * v[2],
        n[0], n[1], n[2],
      );
    }
    const b = f * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
})();
const CUBE_INDEX_COUNT = 36;

const cubeVertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, cubeVertexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, cubeData.vertices, gl.STATIC_DRAW);

const cubeIndexBuffer = gl.createBuffer();
// (The index buffer is attached to each VAO below; binding it here with
// no VAO bound is only to upload the data.)
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIndexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cubeData.indices, gl.STATIC_DRAW);

// Point attributes 0 and 1 at the shared cube buffer (per VERTEX).
function attachCubeGeometry() {
  const stride = 6 * 4; // 6 floats × 4 bytes
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeVertexBuffer);
  gl.enableVertexAttribArray(LOC.position);
  gl.vertexAttribPointer(LOC.position, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(LOC.normal);
  gl.vertexAttribPointer(LOC.normal, 3, gl.FLOAT, false, stride, 12);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIndexBuffer);
}

// The sky uses only the cube's corners, no instances.
const skyVAO = gl.createVertexArray();
gl.bindVertexArray(skyVAO);
attachCubeGeometry();
gl.bindVertexArray(null);


// ---------------------------------------------------------------------
// 3. A BATCH OF CUBES: one instance buffer + one VAO + one draw call
// ---------------------------------------------------------------------
const FLOATS_PER_INSTANCE = 10; // offset 3 + scale 3 + color 3 + kind 1

class CubeBatch {
  constructor(dynamic = false) {
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    this.count = 0;
    this.capacity = 0;
    this.usage = dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW; // a hint to the driver, not a rule
    gl.bindVertexArray(this.vao);
    attachCubeGeometry();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = FLOATS_PER_INSTANCE * 4;
    const attr = (loc, size, offsetFloats) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offsetFloats * 4);
      gl.vertexAttribDivisor(loc, 1); // advance once per CUBE, not per vertex
    };
    attr(LOC.offset, 3, 0);
    attr(LOC.scale, 3, 3);
    attr(LOC.color, 3, 6);
    attr(LOC.kind, 1, 9);
    gl.bindVertexArray(null);
  }

  // Upload `count` instances from a Float32Array (10 floats each).
  upload(data, count) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (count > this.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * FLOATS_PER_INSTANCE), this.usage);
      this.capacity = count;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * FLOATS_PER_INSTANCE));
    }
    this.count = count;
  }

  dispose() {
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
  }

  draw(objectMatrix = mat4.identity()) {
    if (this.count === 0) return;
    gl.uniformMatrix4fv(cubeProgram.uniforms.uObject, false, objectMatrix);
    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, CUBE_INDEX_COUNT, gl.UNSIGNED_SHORT, 0, this.count);
    stats.drawCalls++;
    stats.cubes += this.count;
  }
}

// A helper for building instance arrays on the CPU.
class InstanceList {
  constructor() { this.data = []; }
  // Add one box: center (x, y, z), FULL size (w, h, d), color, kind.
  box(x, y, z, w, h, d, color, kind = 0) {
    this.data.push(x, y, z, w / 2, h / 2, d / 2, color[0], color[1], color[2], kind);
    return this;
  }
  get count() { return this.data.length / FLOATS_PER_INSTANCE; }
  toBatch(dynamic = false) {
    const batch = new CubeBatch(dynamic);
    batch.upload(new Float32Array(this.data), this.count);
    return batch;
  }
}

// Per-frame counters shown in the HUD.
const stats = { drawCalls: 0, cubes: 0 };


// ---------------------------------------------------------------------
// 4. Drawing the sky
// ---------------------------------------------------------------------
function drawSky(view, projection, sky, time) {
  gl.useProgram(skyProgram.program);
  const u = skyProgram.uniforms;
  // Remove the camera's translation: keep only the top-left 3×3 (rotation).
  const viewRotation = view.slice();
  viewRotation[12] = viewRotation[13] = viewRotation[14] = 0;
  gl.uniformMatrix4fv(u.uViewRotation, false, viewRotation);
  gl.uniformMatrix4fv(u.uProjection, false, projection);
  gl.uniform3fv(u.uSunDir, sky.sunDir);
  gl.uniform3fv(u.uMoonDir, sky.moonDir);
  gl.uniform3fv(u.uZenith, sky.zenith);
  gl.uniform3fv(u.uHorizon, sky.horizon);
  gl.uniform3fv(u.uSunColor, sky.sunColor);
  gl.uniform1f(u.uNight, sky.night);
  gl.uniform1f(u.uTime, time);
  // We look at the cube from INSIDE, so its front faces point away from
  // us: cull the front faces instead of the back faces. Depth test
  // LEQUAL lets depth 1.0 pass, and we don't write depth for the sky.
  gl.cullFace(gl.FRONT);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(false);
  gl.bindVertexArray(skyVAO);
  gl.drawElements(gl.TRIANGLES, CUBE_INDEX_COUNT, gl.UNSIGNED_SHORT, 0);
  stats.drawCalls++;
  stats.cubes++;
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
  gl.cullFace(gl.BACK);
}
