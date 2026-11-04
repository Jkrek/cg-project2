// =====================================================================
//  math.js: vectors and 4×4 matrices, written by hand
// =====================================================================
//
// Every object in this project is the same 2×2×2 cube. What makes one
// cube a mountain, another a jet wing and another a star in the sky is
// only the MATRICES we multiply its corners by:
//
//   translation  moves a cube              (Level 1a: the grid)
//   scaling      makes it taller/thinner   (Level 1b: the heights)
//   rotation     turns it                  (Level 3: jet, rocket, planet)
//   lookAt       places the camera         (Level 1d: the orbit)
//   perspective  the pinhole camera        (far things look smaller)
//
// Like the class examples, matrices are stored as 16 numbers in
// COLUMN-MAJOR order (the first 4 numbers are the first column). That is
// the order WebGL expects in gl.uniformMatrix4fv, and it is why the
// translation (x, y, z) sits in elements 12, 13 and 14.
// =====================================================================

// ---------------------------------------------------------------------
// 1. Small vector helpers. A vector is a plain array [x, y, z].
// ---------------------------------------------------------------------
const vec3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize: (a) => {
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / len, a[1] / len, a[2] / len];
  },
  // The point a fraction t of the way from a to b (t = 0 gives a, t = 1 gives b).
  // This one function is the whole of de Casteljau's algorithm (see bezier.js).
  lerp: (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
  distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];


// ---------------------------------------------------------------------
// 2. The basic transforms.
// ---------------------------------------------------------------------
const mat4 = {};

mat4.identity = () => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// Move a point by (x, y, z).
mat4.translation = (x, y, z) => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

// Scale a point by (sx, sy, sz) about the origin.
mat4.scaling = (sx, sy, sz) => [
  sx, 0, 0, 0,
  0, sy, 0, 0,
  0, 0, sz, 0,
  0, 0, 0, 1,
];

// Rotations by `a` radians about one axis. Each one leaves its own axis
// fixed and turns the other two with cos/sin (a 2D rotation in that plane).
mat4.rotationX = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ];
};
mat4.rotationY = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
};
mat4.rotationZ = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
};

// Multiply two matrices: the result applies b FIRST, then a.
// So multiply(T, R) means "rotate, then translate".
mat4.multiply = (a, b) => {
  const r = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      r[col * 4 + row] = sum;
    }
  }
  return r;
};

// Multiply any number of matrices, right to left: chain(A, B, C) = A·B·C,
// which applies C first.
mat4.chain = (...ms) => ms.reduce((acc, m) => mat4.multiply(acc, m));

// A rotation built from three perpendicular unit axes. Its columns ARE
// the axes, so it turns the model's own x, y and z axes into `right`,
// `up` and `forward`, then moves the model to `position`.
//
// Used in Level 3: the forward axis is the Bézier curve's TANGENT, so
// the jet and the rocket always point the way they are moving.
mat4.fromBasis = (right, up, forward, position) => [
  right[0], right[1], right[2], 0,
  up[0], up[1], up[2], 0,
  forward[0], forward[1], forward[2], 0,
  position[0], position[1], position[2], 1,
];


// ---------------------------------------------------------------------
// 3. The camera.
// ---------------------------------------------------------------------

// Perspective projection: the pinhole camera from Project 1, as a matrix.
//   fovY   - VERTICAL field of view, in radians
//   aspect - canvas width / height
//   near, far - only depths between these are kept (the view frustum)
//
// The -1 in the last column copies -z (the depth in front of the
// camera) into w. The GPU later divides x and y by w, which is exactly
// the pinhole camera's "divide by depth": far things shrink.
mat4.perspective = (fovY, aspect, near, far) => {
  const f = 1 / Math.tan(fovY / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
};

// The view matrix for a camera at `eye` looking at `target`. It is the
// INVERSE of placing the camera in the world: instead of moving the
// camera, it moves the whole world so the camera sits at the origin
// looking down -z.
mat4.lookAt = (eye, target, up) => {
  const zAxis = vec3.normalize(vec3.sub(eye, target)); // points backward
  const xAxis = vec3.normalize(vec3.cross(up, zAxis)); // camera right
  const yAxis = vec3.cross(zAxis, xAxis);              // camera up
  return [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -vec3.dot(xAxis, eye), -vec3.dot(yAxis, eye), -vec3.dot(zAxis, eye), 1,
  ];
};
