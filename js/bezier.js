// =====================================================================
//  bezier.js: Bézier curves in 3D, by de Casteljau's construction
// =====================================================================
//
// WHICH BÉZIER FUNCTION?
// Every moving object in the sky follows CUBIC Bézier curves: four
// control points P0, P1, P2, P3 in 3D. The curve starts at P0 heading
// toward P1, and ends at P3 arriving from the direction of P2. It never
// passes through P1 or P2; they only pull the curve toward themselves.
//
// We evaluate a point on the curve the same way as the class's guided
// Bézier activity: DE CASTELJAU'S CONSTRUCTION. To find the point at a
// parameter t (0..1), repeatedly cut every segment of the control
// polygon at the fraction t:
//
//   level 0:  P0      P1      P2      P3        (4 control points)
//   level 1:    P01     P12     P23             (cut each segment at t)
//   level 2:       P012    P123                 (cut again)
//   level 3:          P0123  = B(t)             (one point: on the curve)
//
// This gives exactly the same points as the Bernstein form
//   B(t) = (1-t)³P0 + 3(1-t)²t P1 + 3(1-t)t² P2 + t³P3
// but it is built only from "the point a fraction t along a segment",
// so it is easy to reason about geometrically.
//
// De Casteljau also gives us two things for free:
//   * The TANGENT (the direction of motion): the segment P012 → P123
//     from level 2 points along the curve at B(t). Its length × 3 is
//     the derivative B'(t). Level 3 objects use it to face forward.
//   * SUBDIVISION: the left and right edges of the triangle above are
//     the control points of the two halves of the curve, which lets us
//     draw the path by recursive subdivision (see `subdivide`).
// =====================================================================

// ---------------------------------------------------------------------
// 1. One cubic segment
// ---------------------------------------------------------------------

// All levels of de Casteljau's construction at t.
// levels[0] is the control polygon; the last level is the single point B(t).
function deCasteljauLevels(points, t) {
  const levels = [points];
  let current = points;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length - 1; i++) {
      next.push(vec3.lerp(current[i], current[i + 1], t));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

// The point on the curve at t, plus the unit tangent (direction of travel).
function bezierPointAndTangent(points, t) {
  const levels = deCasteljauLevels(points, t);
  const n = levels.length;
  const point = levels[n - 1][0];
  // The two points on the second-to-last level. For a cubic that is
  // P012 and P123; the curve's tangent at B(t) runs from one to the other.
  const [a, b] = levels[n - 2];
  let tangent = vec3.sub(b, a);
  // At a few special t values the segment can have zero length (e.g. when
  // control points coincide). Fall back to the chord in that case.
  if (vec3.length(tangent) < 1e-9) tangent = vec3.sub(points[points.length - 1], points[0]);
  return { point, tangent: vec3.normalize(tangent) };
}

// Cut the curve at t into two Bézier curves that together trace exactly
// the same shape. The left piece's control points run down the left edge
// of de Casteljau's triangle; the right piece's run up the right edge.
function cutCurve(points, t) {
  const levels = deCasteljauLevels(points, t);
  const left = levels.map((level) => level[0]);
  const right = levels.map((level) => level[level.length - 1]).reverse();
  return { left, right };
}

// "Is this piece flat enough to draw as one straight segment?"
// Measure how far the inner control points stray from the chord P0→P3.
// Because the curve stays inside the convex hull of its control points,
// if they are close to the chord the curve is too.
function distanceToLine(q, a, b) {
  const ab = vec3.sub(b, a);
  const len = vec3.length(ab);
  if (len < 1e-9) return vec3.distance(q, a);
  return vec3.length(vec3.cross(vec3.sub(q, a), ab)) / len;
}
function flatness(points) {
  const a = points[0], b = points[points.length - 1];
  let worst = 0;
  for (let i = 1; i < points.length - 1; i++) worst = Math.max(worst, distanceToLine(points[i], a, b));
  return worst;
}

// Recursive subdivision: keep cutting at t = ½ until each piece is flat
// enough, then keep that piece's end point. The returned list of points
// is a polyline that follows the curve: dense where it bends, sparse
// where it is straight. (Same algorithm as the class's guided activity.)
function subdivide(points, tolerance, out = [points[0]], depth = 0) {
  if (flatness(points) <= tolerance || depth >= 10) {
    out.push(points[points.length - 1]);
    return out;
  }
  const { left, right } = cutCurve(points, 0.5);
  subdivide(left, tolerance, out, depth + 1);
  subdivide(right, tolerance, out, depth + 1);
  return out;
}


// ---------------------------------------------------------------------
// 2. A PATH: several cubic segments joined end to end
// ---------------------------------------------------------------------
//
// A single cubic can only bend so much, so long flight paths chain
// several together. Segment i runs from anchor A[i] to A[i+1].
//
// SMOOTH JOINS (C1 continuity). For a join to have no kink, the incoming
// handle P2, the shared anchor and the outgoing handle P1 must lie on ONE
// straight line, at equal distances. We pick each anchor's direction
// from its two neighbors (A[i+1] - A[i-1]), the way a Catmull-Rom spline
// does, and place the handles one third of that direction away:
//
//   P0 = A[i]              P1 = A[i]   + T[i]   / 3
//   P3 = A[i+1]            P2 = A[i+1] - T[i+1] / 3
//
// With `closed` = true the path loops back to its first anchor.
//
// CONSTANT SPEED. Moving t at a constant rate does NOT move an object at
// constant speed: points crowd together where the control points are
// close, and spread out where they are far apart (the guided activity's
// "does t = ½ cut the curve in equal lengths?" question). So we measure
// the path's length once, store a table of (t, distance) pairs, and
// look up t by distance. That is called ARC-LENGTH PARAMETERIZATION.
// The "constant speed" checkbox in Level 3 turns it on and off.
class BezierPath {
  constructor(anchors, { closed = true, tension = 1, segments = null } = {}) {
    this.closed = closed;
    this.segments = [];
    // Option: give the cubic segments' control points directly.
    if (segments) {
      this.segments = segments;
      this.buildLengthTable(64);
      return;
    }
    const n = anchors.length;
    const get = (i) => anchors[closed ? (i + n) % n : clamp(i, 0, n - 1)];
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const p0 = get(i), p3 = get(i + 1);
      const t0 = vec3.scale(vec3.sub(get(i + 1), get(i - 1)), 0.5 * tension);
      const t1 = vec3.scale(vec3.sub(get(i + 2), get(i)), 0.5 * tension);
      const p1 = vec3.add(p0, vec3.scale(t0, 1 / 3));
      const p2 = vec3.sub(p3, vec3.scale(t1, 1 / 3));
      this.segments.push([p0, p1, p2, p3]);
    }
    this.buildLengthTable(64);
  }

  // A global parameter u runs from 0 to segments.length.
  // Its whole part picks the segment; its fraction is that segment's t.
  evaluate(u) {
    const count = this.segments.length;
    if (this.closed) u = ((u % count) + count) % count;
    else u = clamp(u, 0, count - 1e-6);
    const i = Math.floor(u);
    return bezierPointAndTangent(this.segments[i], u - i);
  }

  // Sample each segment at evenly spaced t, and add up the straight
  // distances between samples (a polyline estimate of the arc length).
  buildLengthTable(samplesPerSegment) {
    this.table = [{ u: 0, s: 0 }];
    let s = 0;
    let prev = this.evaluate(0).point;
    const total = this.segments.length * samplesPerSegment;
    for (let k = 1; k <= total; k++) {
      const u = (k / total) * this.segments.length;
      const p = this.evaluate(Math.min(u, this.segments.length - 1e-6)).point;
      s += vec3.distance(prev, p);
      this.table.push({ u, s });
      prev = p;
    }
    this.length = s;
  }

  // Distance along the path → parameter u, by binary search in the
  // table and linear interpolation between the two nearest entries.
  uAtDistance(s) {
    if (this.closed) s = ((s % this.length) + this.length) % this.length;
    else s = clamp(s, 0, this.length);
    const tbl = this.table;
    let lo = 0, hi = tbl.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tbl[mid].s < s) lo = mid; else hi = mid;
    }
    const a = tbl[lo], b = tbl[hi];
    const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return a.u + (b.u - a.u) * f;
  }

  // Everything needed to draw the path for the "show paths" option:
  // the subdivision polyline and the control points of every segment.
  debugPoints(tolerance) {
    const curve = [], anchors = [], handles = [];
    for (const seg of this.segments) {
      curve.push(...subdivide(seg, tolerance));
      anchors.push(seg[0]);
      handles.push(seg[1], seg[2]);
    }
    if (!this.closed) anchors.push(this.segments[this.segments.length - 1][3]);
    return { curve, anchors, handles };
  }
}
