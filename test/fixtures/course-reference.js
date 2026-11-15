/* FROZEN REFERENCE — do not edit. This is course.js exactly as it stood at 89ff46c,
   before the physics was made faster (re-frozen on 2026-10-31 for the golf-feel physics only: the ball's slowing, its
   constants and the pushes on it, as course.js now has them, so the faster code is still held to the plain one; and on 2026-11-01 for sand and slime,
   each with a drag of its own, and for the belts (a ball on one is carried, never left resting)). test/physics.js fires thousands of shots through
   both and requires bit-identical results, so the speed-up can never change a putt.

   Mini Golf — the course, and the physics that decides where a ball ends up.

   The server owns the rules here exactly as it does in the other GameNest games: a
   client sends an aim and a power, and the server simulates the putt and sends back
   the whole path. Nothing about the result is the client's to choose, and the Unity
   client just plays the path back.

   Space is top-down: x across the green, y from the tee end (0) towards the far end.
   One unit is roughly 5 cm, so a hole is a few metres long. */

const R = 0.6;                     // ball radius (golf-r2, 2026-10-31: Plato's ball; course.js says why)
const CUP_R = 0.9;                 // cup radius
const CUP_SPEED = 15;              // faster than this and the ball rims out instead of dropping
const MAX_SPEED = 47;              // a full-power putt
const STOP_SPEED = 0.8;
const FRICTION = 1.7;              // green, units/s^2
const DRAG = 0.8;                  // per second: the faster the ball rolls the more it loses
const SAND_FRICTION = 4;
const SAND_DRAG = 6;
const ICE_FRICTION = 0.5;          // 2026-09-30, a rule added with course.js: ice
const ICE_DRAG = 0.4;
const SLUDGE_FRICTION = 60;
const SLUDGE_DRAG = 14;
const PUSH_SCALE = 0.4;
const PROP_RESTITUTION = 0.55;     // 2026-09-30, a rule added with course.js: props knocked out when hit       // 2026-09-30, a rule change (not a speed-up): slime holds the ball, as course.js now says
const BUMPER_RESTITUTION = 1.45;   // above 1: a bumper gives back more than it took
const RAMP_G = 95 * PUSH_SCALE;    // gravity along a slope, units/s^2 at gradient 1
const RESTITUTION = 0.74;          // how much a rail gives back
const DT = 1 / 240;
const RECORD_EVERY = 4;            // record at 60 Hz
const MAX_SECONDS = 14;

/* ---------- shapes ---------- */

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/* An L-shaped fairway: a leg up from the tee, then a leg across. */
function lshape(x0, y0, x1, yBend, x2, y2) {
  return [[x0, y0], [x1, y0], [x1, yBend], [x2, yBend], [x2, y2], [x0, y2]];
}

function edges(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    out.push([a[0], a[1], b[0], b[1]]);
  }
  return out;
}

/* ---------- the nine holes ----------
   Each: par, tee, cup, the fairway outline, any obstacles standing in it,
   and sand or water. Walls are every edge of the outline plus every obstacle. */

function buildHoles() {
  const h = [];

// 1. Nothing but green. The cup sits off the tee's axis, so aim and power both have to
  //    be judged, and the top rail is a visible backboard to learn banking on.
  h.push({
    name: "Easy Does It", par: 2,
    tee: [16, 12], cup: [40, 84],
    outline: rect(8, 4, 52, 96),
    obstacles: [], sand: [], water: [],
  });

  // 2. A ramp, and a wall so the climb cannot be dodged. The hill taxes pace and the cup
  //    sits up top on the far side of the gap, so the climb has to be aimed as well as hit.
  h.push({
    name: "Hill Start", par: 2,
    tee: [26, 12], cup: [42, 98],
    outline: rect(8, 4, 52, 110),
    obstacles: [rect(8, 54, 36, 62)],                            // squeeze right to start the climb
    ramps: [{ x0: 8, y0: 40, x1: 52, y1: 80, axis: "y", rise: 9, flip: false }],
    sand: [], water: [],
  });

  // 3. Sand. One beach fills the inside of the dogleg and runs out past the right rail, so
  //    there is no lane round it: carry the corner for a two, or walk the clean left lane
  //    for a three.
  h.push({
    name: "Sandbar Shortcut", par: 3,
    tee: [14, 12], cup: [52, 110],
    outline: lshape(8, 4, 30, 64, 58, 118),                      // dogleg right
    obstacles: [],
    sand: [{ x: 33, y: 84, r: 15 }, { x: 48, y: 90, r: 17 }],    // fills the elbow, seals the rail
    water: [],
  });

  // 4. Bumpers. A nine-unit plate blocks the mouth of the alley, so every ball off the tee
  //    has to deal with it: its face fires you back down, its shoulder slings you across
  //    the chamber at the cup. The backstop above the cup saves the greedy version.
  h.push({
    name: "The Kickplate", par: 3,
    tee: [44, 12], cup: [22, 75],
    outline: [[34, 4], [56, 4], [56, 100], [10, 100], [10, 64], [34, 64]],
    obstacles: [],
    bumpers: [
      { x: 42, y: 74, r: 9 },                                    // the kickplate, plugging the alley
      { x: 22, y: 88, r: 6 },                                    // backstop above the cup
    ],
    sand: [], water: [],
  });

  // 5. Wind. It blows right the whole way and the cup sits on the upwind rail, so every
  //    putt starts left of where it should finish. Two walls stand where the drift takes
  //    you: thread inside them, or go downwind and putt back into the wind's teeth.
  h.push({
    name: "Lean Left", par: 3,
    tee: [38, 10], cup: [16, 116],
    outline: rect(8, 4, 56, 128),
    obstacles: [rect(22, 96, 38, 104), rect(8, 56, 26, 62)],     // both sit in the drift
    wind: [8, 0],
    sand: [], water: [],
  });

  // 6. A tunnel. The wall reaches most of the way across, so the dry way round is a narrow
  //    gap at the right rail; the mouth sits dead on the cup line, right under the wall.
  h.push({
    name: "The Underpass", par: 3,
    tee: [18, 10], cup: [16, 104],
    outline: rect(8, 4, 56, 116),
    obstacles: [rect(8, 58, 48, 66)],                            // long way is the right-hand gap
    tunnels: [{ ax: 18, ay: 48, bx: 26, by: 80, r: 2.5 }],       // short way, straight underneath
    sand: [], water: [],
  });

  // 7. Sludge, with the sand from hole 3 as the toll on the way in. A beach seals the
  //    fairway across, then the bog fills the cup's pocket: punch through it, or go right
  //    and round the dry shelf.
  h.push({
    name: "Beach Then Bog", par: 3,
    tee: [30, 10], cup: [18, 106],
    outline: rect(8, 4, 52, 118),
    obstacles: [rect(8, 58, 34, 74), rect(34, 96, 52, 108)],     // blind corner, then the dry shelf
    sand: [{ x: 17, y: 34, r: 9 }, { x: 30, y: 34, r: 9 }, { x: 43, y: 34, r: 9 }],
    sludge: [{ x: 18, y: 86, r: 10 }, { x: 31, y: 88, r: 9 }],
    water: [],
  });

  // 8. Water, and the first hazard that costs a stroke. A lake splits the fairway: the left
  //    shore is a squeeze that runs straight to the gate, the right side is wide and dry
  //    but dead-ends under the rock. The cup sits on the top lake's beach, so anything
  //    pushed past it is wet.
  h.push({
    name: "Shore Leave", par: 4,
    tee: [44, 12], cup: [16, 96],
    outline: rect(8, 4, 56, 120),
    obstacles: [rect(20, 78, 56, 86)],                           // rock bar; the gate is on the left
    sand: [],
    water: [
      { x: 30, y: 50, r: 13 },                                   // splits the fairway in two
      { x: 17, y: 113, r: 11 },                                  // the top lake, just behind the cup
      { x: 32, y: 113, r: 11 },
      { x: 47, y: 113, r: 11 },
    ],
  });

  // 9. Everything at once. A fork round the pond, a bumper to swing you back on line, a
  //    funnel whose only gap is full of bog, a long climb, and the cup hiding behind one
  //    last wall with a bumper to bank off.
  h.push({
    name: "The Last Word", par: 5,
    tee: [32, 12], cup: [20, 126],
    outline: rect(6, 4, 58, 132),
    obstacles: [
      rect(20, 46, 46, 56),                                      // the fork: left past the pond, or wide right
      rect(6, 86, 20, 96),                                       // the funnel, and its only gap is full of sludge
      rect(38, 86, 58, 96),
      rect(12, 116, 28, 122),                                    // the last wall; the cup hides behind its end
    ],
    water: [{ x: 24, y: 66, r: 10 }],
    bumpers: [{ x: 40, y: 76, r: 5 }, { x: 40, y: 123, r: 5 }],  // lane kicker, and a backboard by the cup
    sludge: [{ x: 29, y: 91, r: 11 }],
    ramps: [{ x0: 6, y0: 98, x1: 58, y1: 116, axis: "y", rise: 6, flip: false }],
    sand: [],
  });

  for (const hole of h) {
    hole.walls = edges(hole.outline);
    for (const o of hole.obstacles) hole.walls = hole.walls.concat(edges(o));
  }
  return h;
}

const HOLES = buildHoles().map((h) => ({
  sludge: [], ice: [], props: [], bumpers: [], wind: [0, 0], ramps: [], tunnels: [], ...h,
}));

/* How high the ground is at a point.

   The simulation is strictly 2D — there is no z anywhere in it — so a ramp is modelled
   as an acceleration field rather than as geometry the ball climbs. This is the one
   function that turns that field back into a height, and both the physics (for the
   slope) and the client (for where to draw the ball) read it, so they cannot drift
   apart. */
function heightAt(hole, x, y) {
  let h = 0;
  for (const r of hole.ramps) {
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const along = r.axis === "y" ? (y - r.y0) / (r.y1 - r.y0) : (x - r.x0) / (r.x1 - r.x0);
    h = Math.max(h, r.rise * (r.flip ? 1 - along : along));
  }
  return h;
}

/* The downhill push inside a ramp: gradient times gravity, pointing down the slope. */
function rampPush(hole, x, y) {
  let ax = 0, ay = 0;
  for (const r of hole.ramps) {
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const span = r.axis === "y" ? r.y1 - r.y0 : r.x1 - r.x0;
    const push = RAMP_G * (r.rise / span) * (r.flip ? 1 : -1);
    if (r.axis === "y") ay += push; else ax += push;
  }
  return [ax, ay];
}

/* ---------- physics ---------- */

function closestOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return [x1, y1];
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return [x1 + t * dx, y1 + t * dy];
}

function inCircles(x, y, circles) {
  for (const c of circles) {
    const dx = x - c.x, dy = y - c.y;
    if (dx * dx + dy * dy <= c.r * c.r) return true;
  }
  return false;
}

/* Sine and cosine for a putt's direction, in plain arithmetic (fdlibm's, as FreeBSD
   ships it), never Math.sin / Math.cos. Every engine's own trig is free to differ in the
   last bit, and the app's C++ copy of this physics (GolfPhysics) has to start every putt
   at the very same speed: a field of bumpers turns one bit into a different bounce. The
   app carries this same code, line for line. */
const trig = (() => {
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const hi = (x) => { f[0] = x; return u[1] | 0; };
  const make = (h, l) => { u[1] = h >>> 0; u[0] = l >>> 0; return f[0]; };
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
    S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
    C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  const INVPIO2 = 6.36619772367581382433e-01, PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11,
    PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21, PIO2_3 = 2.02226624871116645580e-21,
    PIO2_3T = 8.47842766036889956997e-32;
  const NPIO2_HW = [0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
    0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B,
    0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C,
    0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB];
  function ksin(x, y, iy) {
    const ix = hi(x) & 0x7fffffff;
    if (ix < 0x3e400000 && (x | 0) === 0) return x;
    const z = x * x, v = z * x;
    const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if (iy === 0) return x + v * (S1 + z * r);
    return x - ((z * (0.5 * y - v * r) - y) - v * S1);
  }
  function kcos(x, y) {
    const ix = hi(x) & 0x7fffffff;
    if (ix < 0x3e400000 && (x | 0) === 0) return 1;
    const z = x * x;
    const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
    const qx = ix > 0x3fe90000 ? 0.28125 : make(ix - 0x00200000, 0);
    const iz = 0.5 * z - qx, a = 1 - qx;
    return a - (iz - (z * r - x * y));
  }
  // x reduced by multiples of pi/2 into y[0] + y[1]; returns the multiple. |x| up to 2^19 pi/2 (any aim there is).
  function rem(x, y) {
    const hx = hi(x), ix = hx & 0x7fffffff;
    let z;
    if (ix <= 0x3fe921fb) { y[0] = x; y[1] = 0; return 0; }
    if (ix < 0x4002d97c) {
      if (hx > 0) {
        z = x - PIO2_1;
        if (ix !== 0x3ff921fb) { y[0] = z - PIO2_1T; y[1] = (z - y[0]) - PIO2_1T; }
        else { z -= PIO2_2; y[0] = z - PIO2_2T; y[1] = (z - y[0]) - PIO2_2T; }
        return 1;
      }
      z = x + PIO2_1;
      if (ix !== 0x3ff921fb) { y[0] = z + PIO2_1T; y[1] = (z - y[0]) + PIO2_1T; }
      else { z += PIO2_2; y[0] = z + PIO2_2T; y[1] = (z - y[0]) + PIO2_2T; }
      return -1;
    }
    let t = Math.abs(x);
    const n = (t * INVPIO2 + 0.5) | 0, fn = n;
    let r = t - fn * PIO2_1, w = fn * PIO2_1T;
    if (n < 32 && ix !== NPIO2_HW[n - 1]) y[0] = r - w;
    else {
      const j = ix >> 20;
      y[0] = r - w;
      let i = j - ((hi(y[0]) >> 20) & 0x7ff);
      if (i > 16) {
        t = r; w = fn * PIO2_2; r = t - w; w = fn * PIO2_2T - ((t - r) - w); y[0] = r - w;
        i = j - ((hi(y[0]) >> 20) & 0x7ff);
        if (i > 49) { t = r; w = fn * PIO2_3; r = t - w; w = fn * PIO2_3T - ((t - r) - w); y[0] = r - w; }
      }
    }
    y[1] = (r - y[0]) - w;
    if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
    return n;
  }
  const y = [0, 0];
  const big = (x) => !(Math.abs(x) <= 823549.6);   // past 2^19 pi/2, or not a number: no aim is
  return {
    sin(x) {
      if (big(x)) return Math.sin(x);
      if ((hi(x) & 0x7fffffff) <= 0x3fe921fb) return ksin(x, 0, 0);
      const n = rem(x, y);
      switch (n & 3) { case 0: return ksin(y[0], y[1], 1); case 1: return kcos(y[0], y[1]); case 2: return -ksin(y[0], y[1], 1); default: return -kcos(y[0], y[1]); }
    },
    cos(x) {
      if (big(x)) return Math.cos(x);
      const n = rem(x, y);
      switch (n & 3) { case 0: return kcos(y[0], y[1]); case 1: return -ksin(y[0], y[1], 1); case 2: return -kcos(y[0], y[1]); default: return ksin(y[0], y[1], 1); }
    },
  };
})();

/* Simulates one putt. Returns the path, where it stopped, and why it stopped.
   `aim` is radians (0 = +x, pi/2 = +y), `power` is 0..1. */
/* golf-r3: whether a belt carries a ball resting at (x, y) (course.js's carriedByBelt, written plainly). */
function carriedByBelt(hole, x, y) {
  let bx = 0, by = 0;
  for (const r of hole.ramps) {
    if (!r.belt) continue;
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const span = r.axis === "y" ? r.y1 - r.y0 : r.x1 - r.x0;
    const push = RAMP_G * (r.rise / span) * (r.flip ? 1 : -1);
    if (r.axis === "y") by += push; else bx += push;
  }
  if (bx === 0 && by === 0) return false;
  const len = Math.hypot(bx, by), ax = x + (bx / len) * 0.15, ay = y + (by / len) * 0.15;
  for (const w of hole.walls) {
    const [px, py] = closestOnSegment(ax, ay, w[0], w[1], w[2], w[3]);
    if (Math.hypot(ax - px, ay - py) < R - 1e-6) return false;
  }
  return true;
}

function simulate(hole, from, aim, power) {
  const props = (hole.props || []).slice();
  const broke = [];
  power = Number(power);
  aim = Number(aim);
  if (!Number.isFinite(power)) power = 0;
  if (!Number.isFinite(aim)) aim = 0;
  power = Math.max(0.02, Math.min(1, power));

  let x = from[0], y = from[1];
  let vx = trig.cos(aim) * MAX_SPEED * power;
  let vy = trig.sin(aim) * MAX_SPEED * power;

  const path = [[round(x), round(y)]];
  const steps = Math.floor(MAX_SECONDS / DT);
  const launch = Math.hypot(vx, vy);
  let peak = 0;                      // fastest the ball ever goes after launch
  let cupSpeed = null;               // how fast it was when it dropped
  let result = "stopped";

  for (let i = 1; i <= steps; i++) {
    const speed = Math.hypot(vx, vy);
    if (speed < STOP_SPEED && !carriedByBelt(hole, x, y)) { vx = vy = 0; break; }

    // friction, heavier in sand and heavier still in sludge
    let grip = FRICTION, drag = DRAG;
    if (inCircles(x, y, hole.sludge)) { grip = SLUDGE_FRICTION; drag = SLUDGE_DRAG; }
    else if (inCircles(x, y, hole.sand)) { grip = SAND_FRICTION; drag = SAND_DRAG; }
    else if (inCircles(x, y, hole.ice || [])) { grip = ICE_FRICTION; drag = ICE_DRAG; }
    const scale = speed > 0 ? Math.max(0, (speed - (grip + drag * speed) * DT) / speed) : 1;
    vx *= scale; vy *= scale;

    /* Wind pushes only while the ball is rolling — the loop already stops below
       STOP_SPEED, so a ball at rest cannot be blown across the green. */
    vx += hole.wind[0] * PUSH_SCALE * DT;
    vy += hole.wind[1] * PUSH_SCALE * DT;

    // and a ramp pushes downhill, so a putt that runs out of legs rolls back down
    const [rx, ry] = rampPush(hole, x, y);
    vx += rx * DT;
    vy += ry * DT;

    x += vx * DT;
    y += vy * DT;
    if (i > 1) peak = Math.max(peak, speed);

    // rails: push the ball out and reflect whatever went into the wall
    for (const w of hole.walls) {
      const [cx, cy] = closestOnSegment(x, y, w[0], w[1], w[2], w[3]);
      let nx = x - cx, ny = y - cy;
      const d = Math.hypot(nx, ny);
      if (d >= R || d === 0) continue;
      nx /= d; ny /= d;
      x = cx + nx * R;
      y = cy + ny * R;
      const along = vx * nx + vy * ny;
      if (along < 0) { vx -= (1 + RESTITUTION) * along * nx; vy -= (1 + RESTITUTION) * along * ny; }
    }

    for (let k = 0; k < props.length; k++) {
      const b = props[k];
      if (!b) continue;
      let nx = x - b.x, ny = y - b.y;
      const d = Math.hypot(nx, ny), reach = b.r + R;
      if (d >= reach || d === 0) continue;
      nx /= d; ny /= d;
      x = b.x + nx * reach;
      y = b.y + ny * reach;
      const along = vx * nx + vy * ny;
      if (along < 0) {
        vx -= (1 + PROP_RESTITUTION) * along * nx;
        vy -= (1 + PROP_RESTITUTION) * along * ny;
      }
      props[k] = null;
      broke.push(k);
    }
    // bumpers give back more than they took, so the ball leaves faster than it arrived
    for (const b of hole.bumpers) {
      let nx = x - b.x, ny = y - b.y;
      const d = Math.hypot(nx, ny), reach = b.r + R;
      if (d >= reach || d === 0) continue;
      nx /= d; ny /= d;
      x = b.x + nx * reach;
      y = b.y + ny * reach;
      const along = vx * nx + vy * ny;
      if (along < 0) {
        vx -= (1 + BUMPER_RESTITUTION) * along * nx;
        vy -= (1 + BUMPER_RESTITUTION) * along * ny;
        /* A bumper adds energy by design, so the no-free-energy invariant that holds
           for rails cannot hold here. It still needs a ceiling: two bumpers facing each
           other would otherwise let a ball ping-pong itself faster every bounce. Nothing
           on the course may exceed a full-power putt. */
        const out = Math.hypot(vx, vy);
        if (out > MAX_SPEED) { vx *= MAX_SPEED / out; vy *= MAX_SPEED / out; }
      }
    }

    /* Tunnels. Either mouth leads to the other, and the ball comes out travelling the
       way it went in, just beyond the far mouth so it cannot fall straight back in. */
    for (const t of hole.tunnels) {
      const da = Math.hypot(x - t.ax, y - t.ay), db = Math.hypot(x - t.bx, y - t.by);
      const inA = da <= t.r, inB = db <= t.r;
      if (!inA && !inB) continue;
      const sp = Math.hypot(vx, vy);
      if (sp < STOP_SPEED) break;
      const ex = inA ? t.bx : t.ax, ey = inA ? t.by : t.ay;
      path.push([round(x), round(y)]);
      x = ex + (vx / sp) * (t.r + R + 1);
      y = ey + (vy / sp) * (t.r + R + 1);
      path.push([round(x), round(y)]);
      break;
    }

    // the cup: has to be slow enough to drop rather than rim out
    const dcx = x - hole.cup[0], dcy = y - hole.cup[1];
    if (dcx * dcx + dcy * dcy <= CUP_R * CUP_R && Math.hypot(vx, vy) <= CUP_SPEED) {
      cupSpeed = Math.hypot(vx, vy);
      path.push([round(hole.cup[0]), round(hole.cup[1])]);
      return { path, end: [hole.cup[0], hole.cup[1]], result: "holed", launch, peak, cupSpeed, broke };
    }

    if (inCircles(x, y, hole.water)) {
      path.push([round(x), round(y)]);
      return { path, end: [from[0], from[1]], result: "water", launch, peak, cupSpeed, broke };   // penalty, replay from where it was struck
    }

    if (i % RECORD_EVERY === 0) path.push([round(x), round(y)]);
  }

  path.push([round(x), round(y)]);
  return { path, end: [x, y], result, launch, peak, cupSpeed, broke };
}

const round = (n) => Math.round(n * 100) / 100;

/* How far a ball has to roll to reach the cup from each spot on the green, round the
   walls rather than through them: a grid one unit square over the hole, a cell open if
   a ball can sit there (inside the fairway, clear of every wall by a ball's radius, not
   in the water), and Dijkstra from the cup's cell in whole numbers (10 a step, 14 a
   diagonal; no cutting a corner), so the app's port gets the same numbers to the bit.
   Hidden holes, tunnels, bumpers and big balls are left out: a bot finds those by
   trying putts, not from the map. Kept per set of walls, which every copy of a hole
   with the big balls moved still shares. */
const fields = new WeakMap();
function routeField(hole) {
  let f = fields.get(hole.walls);
  if (f) return f;
  const xs = hole.outline.map((p) => p[0]), ys = hole.outline.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys));
  const cols = Math.ceil(Math.max(...xs)) - x0, rows = Math.ceil(Math.max(...ys)) - y0;
  const open = new Uint8Array(cols * rows);
  const inPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const x = x0 + cx + 0.5, y = y0 + cy + 0.5;
    if (!inPoly(x, y, hole.outline) || hole.obstacles.some((o) => inPoly(x, y, o)) || inCircles(x, y, hole.water)) continue;
    let clear = true;
    for (const w of hole.walls) {
      const [px, py] = closestOnSegment(x, y, w[0], w[1], w[2], w[3]);
      if ((x - px) * (x - px) + (y - py) * (y - py) < R * R) { clear = false; break; }
    }
    if (clear) open[cy * cols + cx] = 1;
  }
  const dist = new Int32Array(cols * rows).fill(-1);
  const at = (x, y) => [Math.floor(x) - x0, Math.floor(y) - y0];
  const [ccx, ccy] = at(hole.cup[0], hole.cup[1]);
  // a binary heap of [cost, cell], ties broken by cell so the order is fixed
  const heap = [];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
      }
    }
    return top;
  };
  if (ccx >= 0 && ccx < cols && ccy >= 0 && ccy < rows) push([0, ccy * cols + ccx]);
  const ok = (cx, cy) => cx >= 0 && cx < cols && cy >= 0 && cy < rows && open[cy * cols + cx] === 1;
  while (heap.length) {
    const [d, i] = pop();
    if (dist[i] !== -1) continue;
    dist[i] = d;
    const cx = i % cols, cy = (i - cx) / cols;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!ok(nx, ny)) continue;
      if (dx && dy && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue;
      const ni = ny * cols + nx;
      if (dist[ni] === -1) push([d + (dx && dy ? 14 : 10), ni]);
    }
  }
  f = { x0, y0, cols, rows, dist };
  fields.set(hole.walls, f);
  return f;
}

/* The route's length from a point to the cup, in units; off the map, the straight line
   plus a long way, so a bot never prefers it. */
function routeLength(hole, x, y) {
  const f = routeField(hole);
  const cx = Math.floor(x) - f.x0, cy = Math.floor(y) - f.y0;
  const d = cx >= 0 && cx < f.cols && cy >= 0 && cy < f.rows ? f.dist[cy * f.cols + cx] : -1;
  return d >= 0 ? d / 10 : 1000 + Math.hypot(x - hole.cup[0], y - hole.cup[1]);
}

/* How far a putt of this speed rolls on the green, the way simulate() slows it, and the power that rolls a given distance. */
function rollDistance(speed) {
  let v = speed, d = 0;
  for (let i = 0; i < 4000 && v >= STOP_SPEED; i++) {
    v = Math.max(0, (v - (FRICTION + DRAG * v) * DT));
    d += v * DT;
  }
  return d;
}
function powerForDistance(dist) {
  if (rollDistance(MAX_SPEED) <= dist) return 1;
  let lo = 0, hi = MAX_SPEED;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid) < dist) lo = mid; else hi = mid;
  }
  return Math.min(1, (lo + hi) / 2 / MAX_SPEED);
}

/* A bot's putt. It tries a fan of aims — a close spread toward the cup and a full
   circle round it — at a spread of powers, and keeps the one that ends with the
   shortest roll left round the walls (routeLength), not the nearest as the crow flies:
   on a hole of gates and rings the nearest spot is often the wrong side of a wall. */
function botShot(hole, from, skill = 0.7, rnd = Math.random, opts) {
  const dx = hole.cup[0] - from[0], dy = hole.cup[1] - from[1];
  const dist = Math.hypot(dx, dy);
  const direct = Math.atan2(dy, dx);
  const ideal = powerForDistance(dist * 1.12);

  const aims = [];
  for (let k = -6; k <= 6; k++) aims.push(direct + k * 0.26);
  for (let k = 1; k < 16; k++) aims.push(direct + (k * Math.PI) / 8);
  const powers = [ideal * 0.75, ideal, Math.min(1, ideal * 1.25), Math.min(1, ideal * 1.6), 0.3, 0.5, 0.7, 1];
  // practice swings need only where the ball stops; on the windmill, the sails as they
  // will stand when this putt is struck
  const practice = { record: false, wm0: opts && Number.isFinite(opts.wm0) ? opts.wm0 : 0 };

  let best = null;
  search:
  for (const aim of aims) {
    for (const power of powers) {
      const shot = simulate(hole, from, aim, Math.max(0.05, Math.min(1, power)), practice);
      let score;
      if (shot.result === "holed") score = -1000;
      else if (shot.result === "water") score = 10000;
      else score = routeLength(hole, shot.end[0], shot.end[1]);
      if (!best || score < best.score) best = { aim, power, score };
      if (score === -1000) break search;    // nothing beats holing it
    }
  }
  if (!best) best = { aim: direct, power: ideal };

  // a worse bot wanders off the line it found
  const spray = (1 - skill) * 0.34;
  return {
    aim: best.aim + (rnd() - 0.5) * spray,
    power: Math.max(0.05, Math.min(1, best.power * (1 + (rnd() - 0.5) * spray))),
  };
}

module.exports = {
  HOLES, simulate, botShot,
  heightAt, rampPush,
  R, CUP_R, MAX_SPEED, FRICTION, SAND_FRICTION, SLUDGE_FRICTION, BUMPER_RESTITUTION, RAMP_G,
  RESTITUTION, STOP_SPEED, CUP_SPEED, DT,
  closestOnSegment, inCircles, edges, rect, lshape,
};
