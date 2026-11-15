/* Mini Golf — the course, and the physics that decides where a ball ends up.

   The server owns the rules here exactly as it does in the other GameNest games: a
   client sends an aim and a power, and the server simulates the putt and sends back
   the whole path. Nothing about the result is the client's to choose, and the Unity
   client just plays the path back.

   Space is top-down: x across the green, y from the tee end (0) towards the far end.
   The client maps one unit to 3.2 cm, so a hole is a few metres long and wide. */

const R = 0.6;                     // ball radius: Plato's ball is 0.03 of the screen's width, a hole drawn 36 across (the owner, 2026-10-31: about a third of the ball before; 1.15; 0.027 W measured at 0.55)
const CUP_R = 0.9;                 // cup radius: Plato's cup is 0.048 of the width, 1.6 balls across (2.0 until 2026-10-31)
/* The ball feels like Plato's (the owner, 2026-10-31: "the ball and the game experience"). A putt at full power rolls one hole
   length (50 units on a 50-unit hole) in 3.5 s, one at half power 0.45 of one (22.5 units) in 2.7 s, one at a quarter 9.5 units
   in 2 s: fast at first, then easing into a long gentle creep and a clean stop, and the distance nearly in step with the power,
   so a fine drag is a fine putt. A rolling ball loses FRICTION + DRAG * speed every second (dv/dt = -(FRICTION + DRAG v)), which
   stops a putt of speed v after (v - a ln(1 + v / a)) / DRAG units, a = FRICTION / DRAG. Ice lets it skate twice as far, and the
   pushes that act on a rolling ball (belts, slopes, the breeze) stay at 0.4 of what they were at 175 u/s.
   Sand and slime brake it by the same law with a drag of their own (the owner, 2026-11-01: "sand is not acting like sand", "i dont
   see slime"). Plato's sand, measured off its recordings (a ball is 0.030 of the screen across): three putts that met sand in them
   lost their speed like e^(-6 t), a ball coming at 38 ball widths a second stopping in 6.3 of them, one at 23 in 3.4, and one at 31
   crossing a strip of 3.6 and leaving at 11, so a ball goes about a sixth of its speed (in ball widths a second) in ball widths.
   Ours is DRAG 6 with a little FRICTION 4 for a clean stop: a half-power putt stops in 2.8 ball widths, a full one in 5.9, both
   inside 0.6 s. Slime (Plato's pink sticky zones) is stickier still, DRAG 14 and FRICTION 60: 0.9 ball widths for half power, 2.0
   for a full putt, so a ball only crosses a thin strip of it. */
const CUP_SPEED = 15;              // faster than this and the ball rims out instead of dropping (a third of a full putt)
const MAX_SPEED = 47;              // a full-power putt
const STOP_SPEED = 0.8;
const FRICTION = 1.7;              // green, units/s^2 (the part that does not depend on speed)
const DRAG = 0.8;                  // per second: the faster the ball rolls the more it loses
const SAND_FRICTION = 4;           // sand and slime follow Plato's, measured off its recordings (2026-11-01): see the note below
const SAND_DRAG = 6;               // per second
const ICE_FRICTION = 0.5;          // ice (Plato's): barely any grip and hardly any drag, a ball skates on
const ICE_DRAG = 0.4;
/* Steam vents (the Volcano, 2026-11-01): a grate in the floor that puffs steam on a fixed cycle, 1.5 s on and 2 s off, and kicks a ball that is over it while it puffs: once for
   each time the ball is over it, `kick` units/s away from the grate's middle. The cycle is a pure function of time, as the windmill's sails are: a hole's clock starts when the hole does
   (room.holeStartedAt), a vent's own `phase` (ms) puts it out of step with its neighbours, and a putt is simulated with `vt0`, where the cycle stands at the strike, so the server decides every
   putt and a client draws the steam from the state alone. */
const VENT = Object.freeze({ on: 1500, off: 2000, kick: 22 });
const VENT_PERIOD = VENT.on + VENT.off;
function ventActive(ms, phase) {
  let m = (ms + (phase || 0)) % VENT_PERIOD;
  if (m < 0) m += VENT_PERIOD;
  return m < VENT.on;
}
/* Where the cycle stands `ms` after the hole began, 0 to the period. */
function ventClock(ms) {
  const m = ms % VENT_PERIOD;
  return m < 0 ? m + VENT_PERIOD : m;
}
const SLUDGE_FRICTION = 60;        // slime holds the ball (Plato's sticky zones): a ball rolling in stops within about a ball width or two
const SLUDGE_DRAG = 14;
const PUSH_SCALE = 0.4;            // belts, slopes and the breeze, against what they were at 175 u/s
/* A belt carries a ball (Plato's arrows, the owner 2026-11-01: "it is stopping after certain point"): at least this much push, in the units belt() takes
   (times PUSH_SCALE it is 8 u/s^2, over the green's 1.7 and a slow ball's drag, so a ball dropped on the arrows picks up speed to 7 u/s, about the 6.6 ball widths a
   second Plato's carries one at in its first recording). Below 14 a belt's push sat inside the green's friction and a slow ball stopped on it, or crept on it for the
   whole 14 s. */
const BELT_MIN_ACCEL = 20;
const PROP_RESTITUTION = 0.55;     // a tree, a house or a bird on the green: the ball bounces off it, and it stands (Plato's props are solid, 2026-10-31)
const BOULDER_MASS = 3;            // a big ball (Plato's) weighs three golf balls: a putt moves it, but not far
const BOULDER_RESTITUTION = 0.8;
const BOULDER_FRICTION = 4;        // it rolls heavily and stops sooner than a golf ball
const BALL_RESTITUTION = 0.92;     // two golf balls meeting: nearly billiard balls (Plato's balls are solid, 2026-10-31)
const BUMPER_RESTITUTION = 1.45;   // above 1: a bumper gives back more than it took
const RAMP_G_REF = 95;             // what a ramp's rise and a belt's accel were drawn against (a belt's rise is accel * span / RAMP_G_REF, unchanged)
const RAMP_G = RAMP_G_REF * PUSH_SCALE;   // gravity along a slope, units/s^2 at gradient 1
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

/* Walls at any angle (Plato's diagonals, funnels and rings). Every corner is snapped to
   1/1024 of a unit, exact in a float and a double alike, so the app's copy of the course
   (written out from this file by the app's Tools/golf_holes_cpp.js) is the same to the bit. */
const snap = (v) => Math.round(v * 1024) / 1024;

/* A straight wall of thickness w from one point to another, square at both ends. */
function bar(x1, y1, x2, y2, w = 3) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / len) * (w / 2), ny = ((x2 - x1) / len) * (w / 2);
  return [[x1 - nx, y1 - ny], [x2 - nx, y2 - ny], [x2 + nx, y2 + ny], [x1 + nx, y1 + ny]]
    .map(([x, y]) => [snap(x), snap(y)]);
}

/* A curved wall: short straight pieces round a circle from angle a0 to a1 (radians,
   0 = +x, pi/2 = +y, up the course), each a little longer than its share so no
   seam opens between them. */
function arc(cx, cy, r, a0, a1, w = 3) {
  const n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 12)));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const ext = i === 0 || i === n - 1 ? 0 : 0.5;    // overlap inside the ring; the gap's own ends stay square
    const e0 = t0 - (i === 0 ? 0 : ext / r), e1 = t1 + (i === n - 1 ? 0 : ext / r);
    out.push(bar(cx + Math.cos(e0) * r, cy + Math.sin(e0) * r, cx + Math.cos(e1) * r, cy + Math.sin(e1) * r, w));
  }
  return out;
}

/* A ring wall with one opening `gap` units wide, centred at angle `at`. */
function ring(cx, cy, r, at, gap, w = 3) {
  const half = Math.asin(Math.min(1, (gap / 2 + w / 2) / r));
  return arc(cx, cy, r, at + half, at + 2 * Math.PI - half, w);
}

/* A diamond: a square stood on its point, half-diagonal s. */
function diamond(cx, cy, s) {
  return [[cx, cy - s], [cx + s, cy], [cx, cy + s], [cx - s, cy]];
}

/* A conveyor belt (Plato's arrow bands): a flat strip that pushes the ball along one
   axis at `accel` units/s^2 — +1 dir is +x / +y, -1 is -x / -y. It is a ramp to the
   physics (the same push) and drawn flat, with rows of arrows, never as a slope. */
function belt(x0, y0, x1, y1, axis, dir, accel) {
  const span = axis === "y" ? y1 - y0 : x1 - x0;
  accel = Math.max(accel, BELT_MIN_ACCEL);
  return { x0, y0, x1, y1, axis, rise: Math.round((accel * span) / RAMP_G_REF), flip: dir > 0, belt: true };
}

/* ---------- the nine holes ----------
   Each: par, tee, cup, the fairway outline, any obstacles standing in it,
   and sand or water. Walls are every edge of the outline plus every obstacle.

   Every outline is a phone's own portrait shape, tee near the bottom, cup near the
   top, and every hole is its own idea (Plato's, the owner's ask, 2026-09-30): a picket
   fence, a funnel, conveyor belts, a pinball field, the windmill, a diamond mine, a
   chicken run, rings round the cup, and a finale. Each makes the ball thread a small
   gap — about twice its own width — somewhere on the way, and three hide a hole
   under a tree or a cottage: knock it flat and the hole is there. */

function buildHoles() {
  const h = [];

  // 1. A picket fence across the whole green, open only at two narrow gates near the
  //    rails, and a low wall guarding the cup's front: through a gate, then round.
  h.push({
    name: "Picket Fence", par: 3,
    tee: [29, 10], cup: [29, 82],
    outline: rect(0, 0, 58, 94),
    obstacles: [
      rect(0, 44, 9, 47), rect(14, 44, 44, 47), rect(49, 44, 58, 47),   // gates 9-14 and 44-49
      rect(19, 71, 39, 74),                                              // the cup's front wall
    ],
    props: [{ x: 29, y: 26, r: 4, kind: "tree" }, { x: 40, y: 60, r: 2.5, kind: "bird" }, { x: 8, y: 86, r: 4, kind: "tree" },
      // the farmyard (Plato's full boards; GPT, Grok and Gemini, 2026-10-15: "too empty"), each one where a
      // bot's balls seldom run, so the hole stays about as hard (600 rounds at skill 0.85: 3.19 strokes to 3.51)
      { x: 8, y: 10, r: 4.5, kind: "barn" }, { x: 4, y: 54, r: 2.5, kind: "sheep" },
      { x: 29, y: 52, r: 2.5, kind: "chicken" }, { x: 29, y: 66, r: 2.5, kind: "chicken" }, { x: 16, y: 90, r: 2.5, kind: "chicken" }],
    sand: [], water: [],
  });

  // 2. A funnel. Two long diagonal walls narrow to a throat barely two balls wide, and a
  //    bumper stands guard beyond it. The tree by the tee hides a hole: knock it flat
  //    and a secret way opens up to the cup's side.
  h.push({
    name: "The Funnel", par: 3,
    tee: [30, 10], cup: [30, 88],
    outline: rect(0, 0, 60, 98),
    obstacles: [bar(0, 30, 25.5, 60), bar(60, 30, 34.5, 60)],
    bumpers: [{ x: 30, y: 73, r: 3 }],
    sand: [{ x: 9, y: 76, r: 7 }, { x: 51, y: 76, r: 7 }],
    props: [{ x: 52, y: 13, r: 4, kind: "tree" }, { x: 44, y: 8, r: 2.5, kind: "bird" }, { x: 46, y: 20, r: 2.5, kind: "bird" }, { x: 56, y: 22, r: 2.5, kind: "bird" }],
    tunnels: [{ ax: 52, ay: 13, bx: 44, by: 90, r: 2.25, hidden: true, under: 0 }],
    water: [],
  });

  // 3. Conveyor belts. Three bands of arrows run across the green, each the other way,
  //    and a fence at the top leaves one small gate on the left: aim upstream of it.
  h.push({
    name: "Conveyor Belts", par: 4,
    tee: [30, 8], cup: [14, 88],
    outline: rect(0, 0, 60, 98),
    obstacles: [rect(0, 70, 8, 73), rect(13, 70, 60, 73)],             // the gate: 8-13
    ramps: [
      belt(0, 18, 60, 28, "x", +1, 70),
      belt(0, 36, 60, 46, "x", -1, 70),
      belt(0, 54, 60, 64, "x", +1, 70),
    ],
    props: [{ x: 46, y: 32, r: 2.5, kind: "bird" }, { x: 14, y: 50, r: 2.5, kind: "bird" }, { x: 44, y: 86, r: 4, kind: "tree" }],
    sand: [], water: [],
  });

  // 4. Pinball. A field of bumpers on a belt running back toward the tee: hit it hard
  //    and let the bumpers do what they like. The cup sits in the middle of three
  //    pockets, behind a narrow mouth; the side pockets are full of slime.
  {
    const bumpers = [];
    for (const [y, xs] of [[36, [10, 22, 38, 50]], [50, [16, 30, 44]], [64, [10, 22, 38, 50]]])
      for (const x of xs) bumpers.push({ x, y, r: 3.5 });
    h.push({
      name: "Pinball", par: 5,
      tee: [30, 8], cup: [30, 91],
      outline: rect(0, 0, 60, 98),
      obstacles: [
        rect(19, 82, 22, 98), rect(38, 82, 41, 98),                    // the pockets' walls
        rect(22, 82, 26, 85), rect(34, 82, 38, 85),                    // the middle pocket's mouth: 26-34
      ],
      ramps: [belt(0, 14, 60, 30, "y", -1, 22)],   // a lane of arrows after the tee, clear of the bumpers (a ball falling back on one under the push bounced there for ever). 8 on 26 to 78 from 2026-10-31 to 2026-11-01 so a slow ball was not pushed back, and it then rested on the arrows: a belt carries a ball out of the strip now, so a putt has to cross the whole of it
      bumpers,
      sludge: [{ x: 10, y: 90, r: 6 }, { x: 50, y: 90, r: 6 }],
      sand: [{ x: 10, y: 88, r: 7 }, { x: 56, y: 88, r: 7 }], water: [],
    });
  }

  // 5. The windmill. Walls run from both rails to the mill, leaving a narrow gate on
  //    each side of it — or time a putt through the door. A breeze leans every putt right.
  h.push({
    name: "Mill Race", par: 3,
    tee: [26, 12], cup: [12, 92],
    outline: rect(0, 0, 64, 102),
    obstacles: [rect(0, 54, 9, 62), rect(43, 54, 64, 62)],             // gates 9-14 and 38-43 beside the mill
    wind: [6, 0],
    boulders: [{ x: 52, y: 74, r: 3.5 }],                              // a big ball past the right gate: shove it or go round
    sand: [{ x: 24, y: 86, r: 6 }],
    props: [{ x: 50, y: 92, r: 4, kind: "tree" }],
    water: [],
  });

  // 6. A diamond mine. Rows of diamond beds stand staggered across the green, so no
  //    straight line runs through: weave between them.
  {
    const obstacles = [];
    for (const [y, xs] of [[28, [10, 30, 50]], [44, [20, 40]], [60, [10, 30, 50]], [76, [20, 40]]])
      for (const x of xs) obstacles.push(diamond(x, y, 7.5));
    h.push({
      name: "Diamond Mine", par: 4,
      tee: [30, 8], cup: [30, 90],
      outline: rect(0, 0, 60, 98),
      obstacles,
      sand: [{ x: 30, y: 44, r: 4 }],
      props: [{ x: 20, y: 60, r: 2.5, kind: "bird" }, { x: 8, y: 90, r: 4, kind: "tree" }, { x: 52, y: 90, r: 4, kind: "tree" },
        // a hen and a sheep in the lanes by the right rail (anything by the tee cost the bots up to a stroke)
        { x: 56, y: 44, r: 2.5, kind: "chicken" }, { x: 55, y: 76, r: 3, kind: "sheep" }],
      water: [],
    });
  }

  // 7. A chicken run. A wall off the left rail, a pond by the tee, a sand island in the
  //    middle ringed with chickens, and a wall off the right rail that leaves only a
  //    narrow gap by the left rail. The tree on the island hides a hole straight to the cup.
  {
    const props = [{ x: 28, y: 50, r: 4, kind: "tree" }];
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      props.push({ x: Math.round(28 + Math.cos(a) * 12), y: Math.round(50 + Math.sin(a) * 12), r: 2.5, kind: "bird" });
    }
    h.push({
      name: "Chicken Run", par: 5,
      tee: [10, 10], cup: [48, 88],
      outline: rect(0, 0, 60, 98),
      obstacles: [rect(0, 30, 38, 33), rect(6, 68, 60, 71), bar(18, 82, 30, 76)],
      water: [{ x: 47, y: 16, r: 8 }],
      sand: [{ x: 28, y: 50, r: 9 }],
      props,
      tunnels: [{ ax: 28, ay: 50, bx: 40, by: 86, r: 2.25, hidden: true, under: 0 }],
    });
  }

  // 8. Rings round the cup. The outer ring opens toward the tee, the inner one away
  //    from it, and the floor between them is ice: in, round, and through.
  h.push({
    name: "Rings", par: 5,
    tee: [32, 10], cup: [32, 66],
    outline: rect(0, 0, 64, 104),
    obstacles: [...ring(32, 66, 20, -Math.PI / 2, 5), ...ring(32, 66, 9, Math.PI / 2, 5)],
    ice: [{ x: 32, y: 66, r: 18 }],
    props: [{ x: 8, y: 94, r: 4, kind: "tree" }, { x: 56, y: 94, r: 4, kind: "tree" }, { x: 54, y: 28, r: 2.5, kind: "bird" },
      // sheep in the meadow wide of the line up to the rings' mouth; a barn and two hens past the far side,
      // where play never goes (a hen in a corner by the tee trapped balls and cost the bots a fifth of their rounds)
      { x: 46, y: 38, r: 3, kind: "sheep" }, { x: 14, y: 40, r: 3, kind: "sheep" },
      { x: 32, y: 97, r: 5, kind: "barn" }, { x: 19.5, y: 97, r: 2.5, kind: "chicken" }, { x: 44.5, y: 97, r: 2.5, kind: "chicken" }],
    sand: [], water: [],
  });

  // 9. The finale. A land bridge between two ponds, a funnel, a belt across the green,
  //    and the cup in a walled box in the top right corner whose only gate is a small
  //    one in its left side. The cottage hides a hole that comes out in the lane by it.
  h.push({
    name: "Grand Finale", par: 5,
    tee: [33, 10], cup: [52, 100],
    outline: rect(0, 0, 66, 110),
    obstacles: [
      bar(0, 50, 27, 66), bar(66, 50, 39, 66),                          // the funnel
      rect(36, 88, 66, 91),                                              // the box's floor
      rect(36, 91, 39, 96), rect(36, 101, 39, 110),                      // its left side, gate 96-101
    ],
    water: [{ x: 14, y: 32, r: 15 }, { x: 52, y: 32, r: 15 }],          // the land bridge: 29-37
    ramps: [belt(0, 70, 66, 78, "x", +1, 60)],
    props: [{ x: 58, y: 82, r: 4, kind: "house" }, { x: 6, y: 104, r: 3, kind: "tree" }],
    tunnels: [{ ax: 58, ay: 82, bx: 22, by: 99, r: 2.25, hidden: true, under: 0 }],
    bumpers: [{ x: 14, y: 88, r: 3 }],
    sand: [],
  });

  for (const hole of h) {
    hole.walls = edges(hole.outline);
    for (const o of hole.obstacles) hole.walls = hole.walls.concat(edges(o));
  }
  return h;
}

/* ---------- the long holes: rooms (the owner, 2026-10-18) ----------

   The long holes are seen from 80 degrees, nearly straight down (the owner, 2026-10-18,
   off the 50-degree camera), and drawn as Plato draws its own: not one open green but
   rooms, three or four to a hole, each with its own idea, joined by doorways that change
   sides, so a ball works its way room by room to the cup ("plato has multiple room
   before the ball goes to the hole"). They are laid out here at their own size, about
   1.55 times a classic hole's length; the windmill's hole keeps the place its mill has
   stood at since the 50-degree holes (WINDMILL_TALL). Every corner is snapped like a bar's. */
const LENGTH_TALL = 1.55;

/* A wall right across the room at height y, open only between each [from, to] pair. */
function divider(y, doors, W, t = WALL_T) {
  const out = [];
  let x = 0;
  for (let [a, b] of doors) {
    // every door at least GAP wide once the room is drawn at ROOM_SCALE, widened about its own middle
    const w = Math.max(b - a, GAP / ROOM_SCALE), m = Math.min(Math.max((a + b) / 2, w / 2), W - w / 2);
    a = snap(m - w / 2); b = snap(m + w / 2);
    if (a > x) out.push(rect(x, y, a, y + t)); x = b;
  }
  if (x < W) out.push(rect(x, y, W, y + t));
  return out;
}

function buildRoomHoles() {
  /* Plato's boards (the owner, 2026-10-28: "I like how the mini golf in Plato looks"): one open field a phone's width
     wide and about 1.45 times as long, 66 x 96 as laid out, a little over 36 x 53 drawn, so the course fills the screen
     and the camera is near top-down. Every hole is an idea you read at a glance: an L-shaped pocket round the cup, a
     split path, an island, a belt, a ring. Walls are thin; the hazards are big and organic; the toys are small. */
  const P = (x, y, r, kind) => ({ x, y, r, kind });
  const W = 66, H = 96, T = WALL_T;
  const h = [];

  // 1. Picket Fence: a fence across the lawn, open on the right; a C-shaped pocket round the cup open to the tee side; a big sand blob.
  h.push({
    name: "Picket Fence", par: 4,
    tee: [16, 11], cup: [54, 70],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 34, 38, 34 + T), rect(40, 56, W, 56 + T), rect(40, 79, W, 79 + T)],
    sand: [{ x: 16, y: 62, r: 9 }, { x: 26, y: 58, r: 7 }, { x: 9, y: 70, r: 6 }, { x: 22, y: 69, r: 6 }, { x: 13, y: 53, r: 5 }],
    props: [P(9, 88, 3.2, "barn"), P(30, 90, 2.4, "tree"), P(52, 22, 2.0, "sheep"), P(58, 38, 2.0, "chicken"), P(30, 22, 2.0, "chicken")],
    water: [],
  });

  // 2. The Funnel: two long diagonal walls narrow to a throat with a bumper beyond it; a wall across the room above leaves a door on the right under the water, and the
  //    cup lies in the far left corner past it, with goo and a sand bed between (S4, 2026-11-01: no straight line, a cup guarded, three shots).
  h.push({
    name: "The Funnel", par: 5, // 5 since 2026-11-13 (polish r4): with four balls on the green the best bot needs more than 4; MAX = par + 2
    tee: [33, 11], cup: [18, 87],
    outline: rect(0, 0, W, H),
    obstacles: [bar(0, 36, 25, 58, T), bar(W, 36, 41, 58, T), ...divider(76, [[45, 62]], W)],
    bumpers: [{ x: 33, y: 66, r: 3.6 }],
    water: [{ x: 59, y: 91, r: 6 }, { x: 52, y: 92, r: 4 }],
    sand: [{ x: 8, y: 66, r: 7 }, { x: 58, y: 66, r: 6 }],
    // slime in the gutters under the funnel's walls (2026-11-01: where a shot that misses the throat runs down to, off the way to the cup), and a puddle between the door and the cup
    sludge: [{ x: 12, y: 36, r: SLIME_R }, { x: 54, y: 36, r: SLIME_R }, { x: 33, y: 87, r: SLIME_R }],
    props: [P(8, 16, 2.6, "tree"), P(15, 30, 2.0, "chicken"), P(46, 90, 2.0, "sheep")],
  });

  // 3. Conveyor Belts: a belt in each room, each against you; the doors left then right; the cup in a channel of its own along the top, at the far left, past the pond.
  h.push({
    name: "Conveyor Belts", par: 5, // 5 since 2026-11-13 (polish r4): with four balls on the green the best bot needs more than 4; MAX = par + 2
    tee: [33, 8], cup: [12, 91],
    outline: rect(0, 0, W, H),
    obstacles: [...divider(38, [[4, 16]], W), ...divider(66, [[48, 60]], W), rect(0, 83, 28, 83 + T)],
    ramps: [belt(0, 14, W, 28, "x", +1, 70), belt(0, 46, W, 58, "x", -1, 70), belt(0, 72, W, 80, "x", +1, 70)],
    water: [{ x: 44, y: 91, r: 6 }],
    props: [P(58, 32, 2.0, "chicken"), P(60, 90, 2.4, "tree"), P(56, 6, 2.0, "sheep")],
    sand: [],
  });

  // 4. Pinball: a wide door to the left, a short lane of arrows back toward the tee, a field of bumpers, a second door to the right, then the cup in the middle of three pockets
  //    behind a narrow mouth, sand either side.
  {
    const bumpers = [];
    for (const [y, xs] of [[46, [10, 22, 44, 56]], [57, [16.5, 33, 49.5]]])
      for (const x of xs) bumpers.push({ x, y, r: 3 });
    h.push({
      name: "Pinball", par: 5,
      tee: [33, 8], cup: [33, 88],
      outline: rect(0, 0, W, H),
      obstacles: [
        ...divider(26, [[6, 28]], W),
        ...divider(65, [[46, 62]], W),
        rect(23 - T, 78, 23, H), rect(43, 78, 43 + T, H),
        rect(23, 78, 27, 78 + T), rect(39, 78, 43, 78 + T),
      ],
      ramps: [belt(0, 32, W, 40, "y", -1, 20)],   // a lane of arrows after the door, clear of the bumpers (a belt carries a ball out)
      bumpers,
      sludge: [],
      props: [P(8, 12, 2.6, "tree"), P(58, 14, 2.0, "chicken")],
      sand: [{ x: 10, y: 88, r: 7 }, { x: 56, y: 88, r: 7 }], water: [],
    });
  }

  // 5. Mill Race: a pond, then the windmill across the lane with a gate either side of it; a second wall above it leaves a door on the left, and the cup sits far right, past sand and a bumper.
  {
    const hy = 46, top = hy + 10;   // WINDMILL_TALL's front face and depth
    h.push({
      name: "Mill Race", par: 4,
      tee: [33, 10], cup: [12, 91],
      outline: rect(0, 0, W, H),
      obstacles: [rect(0, hy, 6, top), rect(60, hy, W, top), ...divider(72, [[50, 64]], W), rect(0, 82, 30, 82 + T)],   // gates 6-19 and 47-60 beside the mill; the door to the cup's room 42-62, a ledge in it: the cup lies in a channel above
      wind: [0, 0],   // Plato has no wind (the owner, 2026-10-31: shots travel true); it blew right at 6 before
      water: [{ x: 50, y: 12, r: 9 }, { x: 56, y: 20, r: 5 }],
      sand: [{ x: 26, y: 91, r: 5 }, { x: 33, y: 62, r: 6 }],
      bumpers: [{ x: 46, y: 84, r: 3.6 }],
      props: [P(10, 34, 2.2, "sheep"), P(58, 64, 2.0, "chicken"), P(58, 92, 2.6, "tree")],
    });
  }

  // 6. Diamond Mine: a room with two doors, a field of beds to weave through to a door on the right, and the cup far left behind sand and the last beds.
  h.push({
    name: "Diamond Mine", par: 5,
    tee: [33, 8], cup: [20, 87],
    outline: rect(0, 0, W, H),
    obstacles: [
      ...divider(26, [[6, 18], [48, 60]], W),
      diamond(16, 42, 6), diamond(50, 42, 6), diamond(33, 51, 6),
      ...divider(66, [[48, 60]], W),
      diamond(10, 82, 6), diamond(46, 80, 6),
    ],
    props: [P(54, 14, 2.4, "sheep"), P(10, 54, 2.0, "chicken")],
    sand: [{ x: 8, y: 36, r: 5 }, { x: 33, y: 78, r: 5 }, { x: 24, y: 94, r: 4 }], water: [],
  });

  // 7. Chicken Run: a split river (Plato's), a land bridge across it near the middle, and a narrow causeway at the top between the water for a risk: the cup is up the far bank.
  {
    /* The river is a chain of overlapping ponds down the middle, 14 across, open for two stretches: a causeway in the middle, 6 wide (a strip two balls across, water on both sides:
       the short way and the risk), and a bridge near the top, 12 wide (the long way round, dry). Tee on the near bank's left, the cup on the far bank's right, just over the causeway (S4, 2026-11-01). */
    const river = [];
    for (let y = 4; y <= 40; y += 6) river.push({ x: 33, y, r: 7 });   // from the bottom rail up, so there is no way round its foot
    for (let y = 60; y <= 72; y += 6) river.push({ x: 33, y, r: 7 });   // a causeway between them, 6 across: the short way, with water either side
    river.push({ x: 33, y: 96, r: 5 });   // and a wide bridge up under this one, 12 across, far above the cup: the long way, dry
    /* The hay bales (2026-11-01, the hidden cups the Meadow lacked): the cup lies under one of four bales on the far bank, the server picks which each game, and a ball that touches a bale knocks
       it flat for everyone, showing the cup or plain ground. The first bale stands where the cup always was (the plain hole's cup, which an app that cannot draw bales plays). */
    const bale = (x, y) => ({ x, y, r: 3.2, kind: "haybale", cover: true });
    const props = [bale(54, 62), bale(46, 58), bale(47, 71), bale(47, 40),
      P(10, 56, 2.8, "tree"), P(9, 30, 2.0, "chicken"), P(22, 40, 2.0, "chicken"), P(57, 34, 2.0, "sheep"), P(59, 52, 2.0, "chicken"), P(48, 80, 2.0, "chicken"), P(10, 90, 2.0, "chicken")];
    h.push({
      name: "Chicken Run", par: 6,   // (5 before the hay bales: a hunt for the cup takes a shot or two more)
      tee: [10, 10], cup: [54, 62],   // the cup right across the causeway: a few units from it, a long way from the wide bridge
      outline: rect(0, 0, W, H),
      obstacles: [],
      water: river,
      sand: [{ x: 52, y: 48, r: 7 }, { x: 56, y: 76, r: 7 }, { x: 12, y: 74, r: 6 }],
      sludge: [{ x: 20, y: 32, r: SLIME_R }],   // on the near bank, on the straight line from the tee to the bridge: round it, left or right
      bumpers: [],   // (it had one hay-bale bumper beside the cup's sand island; the long holes draw a bumper as a hay bale, and the covers are hay bales now: a bale that bounces a ball and a bale that hides the cup must not look alike)
      props,
      hidden: { plain: 0 },
    });
  }

  // 8. Rings: a grass room, its door off to the left, then a room of ice round the cup, two rings about it, the outer open toward the tee and the inner away from it.
  {
    const ice = [];
    for (let y = 40; y <= 96; y += 13) for (let x = 4; x <= 66; x += 8) if (Math.hypot(x - 33, y - 66) < 36) ice.push({ x, y, r: 10.5 });   // the ice round the rings, not the whole room (S4, 2026-11-01)
    h.push({
      name: "Rings", par: 5,
      tee: [33, 9], cup: [33, 66],
      outline: rect(0, 0, W, H),
      obstacles: [...divider(26, [[6, 18]], W), ...ring(33, 66, 23.5, -Math.PI / 2, GAP / ROOM_SCALE * 1.3, WALL_T), ...ring(33, 66, 10, 0, GAP / ROOM_SCALE * 1.6, WALL_T)],
      ice,
      props: [P(54, 14, 2.4, "sheep"), P(8, 14, 2.0, "chicken"), P(6, 92, 2.0, "chicken"), P(60, 92, 2.0, "chicken")],
      sand: [], water: [],
    });
  }

  // 9. Grand Finale: a land bridge between two ponds, a funnel and a belt, the cup in a walled box with a small gate in its left side and a wall hanging over the cup, sand inside the gate.
  h.push({
    name: "Grand Finale", par: 5,
    tee: [33, 8], cup: [60, 90],
    outline: rect(0, 0, W, H),
    obstacles: [
      bar(0, 38, 27, 50, T), bar(W, 38, 39, 50, T),
      rect(36, 72, W, 72 + T),   // the box's floor
      rect(36, 72 + T, 36 + T, 80), rect(36, 90, 36 + T, H),   // its left side, a gate between 80 and 90
      rect(50, 86, 50 + T, H),   // a wall hanging from its top: the cup lies behind it, reached from under it
    ],
    water: [{ x: 14, y: 22, r: 14 }, { x: 52, y: 22, r: 14 }],
    ramps: [belt(0, 54, W, 64, "x", +1, 60)],
    props: [P(10, 90, 2.6, "tree"), P(20, 74, 2.2, "sheep")],
    bumpers: [{ x: 14, y: 78, r: 3 }],
    sand: [{ x: 44, y: 80, r: 5 }],
  });

  return finishRoomHoles(h, [3]);   // Pinball's field is the hole itself: its bumpers shrink with it
}

/* What every course of long rooms goes through after its holes are laid out (66 x 96 as laid out, a little over 36 x 52 drawn), so a new
   course is only its holes and its theme: stretched, shrunk, the toys sized and cleared, the tee box, the walls. `fieldBumperHoles` are
   the holes whose bumpers are the hole itself (they shrink with it and keep their toys as drawn). A hole with covers (hidden: the cup
   lies under one of them) takes its plain cup at the spot of the cover its data names, once the toys have been cleared. */
function finishRoomHoles(h, fieldBumperHoles = []) {
  // a little taller than the layouts above: every y is stretched by KY, so the course climbs nearer the header
  for (const hole of h) stretchY(hole, KY);
  for (const hole of h) shrinkHole(hole, ROOM_SCALE);
  for (const i of fieldBumperHoles) h[i].bumpers = h[i].bumpers.map((b) => ({ ...b, r: snap(b.r * ROOM_SCALE) }));
  // the toys, bumpers and big balls elsewhere as big on the page as they were at a ROOM_SCALE of 0.7 (only the ball and the cup grow)
  for (let i = 0; i < h.length; i++) for (const key of ["props", "bumpers", "boulders"])
    if (h[i][key] && !fieldBumperHoles.includes(i)) h[i][key] = h[i][key].map((p) => ({ ...p, r: snap(p.r * TOY_SCALE) }));
  for (const hole of h) clearToys(hole);
  for (const hole of h) hole.solid = true;   // props stand when hit (simulate, solidProps), but a cover is knocked flat
  for (const hole of h) if (hole.hidden) coverTheCup(hole);
  /* The tee box (Plato's checkered start box): a player taps inside it to put the ball where they like before the first putt,
     5.2 by 3.4 units of the 36 by 50 the hole is drawn at, which is Plato's 0.15 of the width. */
  for (const hole of h) hole.teeBox = [snap(hole.tee[0] - TEE_HALF[0]), snap(hole.tee[1] - TEE_HALF[1]), snap(hole.tee[0] + TEE_HALF[0]), snap(hole.tee[1] + TEE_HALF[1])];
  for (const hole of h) {
    hole.walls = edges(hole.outline);
    for (const o of hole.obstacles) hole.walls = hole.walls.concat(edges(o));
  }
  return h;
}

/* A hidden-cup hole (the owner, 2026-11-01: "some courses on plato hide the holes and we have to clear the obstacles to find the holes"):
   the cup lies under one of 3 to 5 covers (props with `cover: true`: sandcastles, hay bales), the server picks which at random each game, and a
   ball that touches a cover knocks it flat for everyone, showing the cup or plain ground. The hole's data says only which cover the cup sits
   at when the hole is played plain (hidden.plain, an index into the covers as listed): that cover's spot is the cup then, and an app that
   cannot draw covers plays the plain hole (plainHole), where the covers are gone. */
function coverTheCup(hole) {
  const covers = [];
  hole.props.forEach((p, i) => { if (p.cover) covers.push(i); });
  const plain = covers[hole.hidden.plain || 0];
  hole.hidden = { covers, plain };
  hole.cup = [hole.props[plain].x, hole.props[plain].y];
}

/* The same hole with its covers taken away and the cup in the open, where a room that cannot play hidden cups plays it. */
function plainHole(h) {
  if (!h.hidden) return h;
  const { hidden, ...rest } = h;
  return { ...rest, props: h.props.filter((_, i) => !hidden.covers.includes(i)) };
}

/* The same hole with its steam vents taken away, where a room plays that has an app that cannot draw them (a hole without vents has none to lose: it is itself). */
function noVents(h) {
  if (!h.vents || !h.vents.length) return h;
  return { ...h, vents: [] };
}

/* The rooms are drawn at ROOM_SCALE of the size they are laid out at above, and the ball, the cup, the toys, the
   bumpers and the tunnels' mouths are not: the camera fits the smaller hole to the same page, so every one of them
   stands that much bigger on it (the owner, 2026-10-18: "make the ball and toys bigger"). A belt keeps its push. */
const ROOM_SCALE = 0.55;   // 0.7 at first; the owner, 2026-10-18: "the ball still looks small make it bigger"
const TOY_SCALE = ROOM_SCALE / 0.7 * 0.55;   // Plato's toys are 0.05 to 0.08 of the screen wide, half of what they were (the owner, 2026-10-31); only the ball and the cup shrank more
const GAP = 3.6;   // the narrowest doorway, gate, throat or mouth once drawn: about three balls across (Plato's doors are two and a half to three)
const WALL_T = 1.9 / ROOM_SCALE;   // every wall 1.9 thick once drawn, Plato's 0.046 of the width: still more than a ball and a half (1.2), so a ball cannot be passed through from both faces at once
const TEE_HALF = [2.6, 1.7];   // half the tee box's width and depth, in drawn units
const SLIME_R = 4.7;   // a slime puddle's radius as laid out, 2.6 drawn: about 4 balls across, 0.13 of the board's width
const KY = 0.98;   // 96 -> 94 as laid out: 66 x 94 (drawn 36 x 52 and 1 : 1.43 with its walls) fills the board between Plato's header and its chat bar (it was 66 x 102 until 2026-10-31)
function stretchY(o, k) {
  const sy = (v) => snap(v * k);
  const pts = (list) => list.map(([x, y]) => [x, sy(y)]);
  o.tee = [o.tee[0], sy(o.tee[1])];
  o.cup = [o.cup[0], sy(o.cup[1])];
  o.outline = pts(o.outline);
  o.obstacles = o.obstacles.map(pts);
  for (const key of ["sand", "water", "sludge", "ice", "vents", "props", "bumpers", "boulders"]) if (o[key]) o[key] = o[key].map((c) => ({ ...c, y: sy(c.y) }));
  if (o.ramps) o.ramps = o.ramps.map((r) => ({ ...r, y0: sy(r.y0), y1: sy(r.y1), rise: r.axis === "y" ? snap(r.rise * k) : r.rise }));
  if (o.tunnels) o.tunnels = o.tunnels.map((t) => ({ ...t, ay: sy(t.ay), by: sy(t.by) }));
}
function shrinkHole(o, s) {
  const sc = (v) => snap(v * s);
  const pts = (list) => list.map(([x, y]) => [sc(x), sc(y)]);
  o.tee = [sc(o.tee[0]), sc(o.tee[1])];
  o.cup = [sc(o.cup[0]), sc(o.cup[1])];
  o.outline = pts(o.outline);
  o.obstacles = o.obstacles.map(pts);
  for (const key of ["sand", "water", "sludge", "ice", "vents"]) if (o[key]) o[key] = o[key].map((c) => ({ ...c, x: sc(c.x), y: sc(c.y), r: sc(c.r) }));
  for (const key of ["props", "bumpers", "boulders"]) if (o[key]) o[key] = o[key].map((c) => ({ ...c, x: sc(c.x), y: sc(c.y) }));
  if (o.ramps) o.ramps = o.ramps.map((r) => ({ ...r, x0: sc(r.x0), y0: sc(r.y0), x1: sc(r.x1), y1: sc(r.y1), rise: snap(r.rise * s) }));
  if (o.tunnels) o.tunnels = o.tunnels.map((t) => ({ ...t, ax: sc(t.ax), ay: sc(t.ay), bx: sc(t.bx), by: sc(t.by) }));
  if (o.wind) o.wind = o.wind.map(sc);   // a breeze as strong for the smaller hole as it was for the larger
}

/* Every toy, bumper and big ball at least `gap` clear of every wall, of each other, of the tee and of the cup: nudged
   apart a little at a time until nothing is closer. A ball must never be squeezed between a toy and a wall (it was
   pushed out through the rail), and the bigger toys of the smaller rooms would otherwise crowd one another. */
function clearToys(o, gap = 3) {
  const walls = edges(o.outline);
  for (const ob of o.obstacles) walls.push(...edges(ob));
  const round = [...(o.props || []), ...(o.bumpers || []), ...(o.boulders || [])];
  const keep = (a, px, py, need) => {
    const dx = a.x - px, dy = a.y - py, d = Math.hypot(dx, dy);
    if (d >= need || d < 1e-9) return false;
    a.x += (dx / d) * (need - d); a.y += (dy / d) * (need - d);
    return true;
  };
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (const a of round) {
      for (const w of walls) { const [px, py] = closestOnSegment(a.x, a.y, w[0], w[1], w[2], w[3]); moved = keep(a, px, py, a.r + gap) || moved; }
      for (const [px, py] of [o.tee, o.cup]) { if (!(a.cover && px === o.cup[0] && py === o.cup[1])) moved = keep(a, px, py, a.r + gap + R) || moved; }   // (a cover stands over the cup it may hide)
      for (const s of o.sludge || []) moved = keep(a, s.x, s.y, a.r + s.r + 1) || moved;   // a toy never stands in the goo
    }
    for (let i = 0; i < round.length; i++) for (let j = i + 1; j < round.length; j++) {
      const a = round[i], b = round[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), need = a.r + b.r + gap;
      if (d < need && d > 1e-9) { const k = (need - d) / (2 * d); a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; moved = true; }
    }
    if (!moved) break;
  }
  for (const a of round) { a.x = snap(a.x); a.y = snap(a.y); }
  // a hidden hole stays under the toy that hides it
  for (const tn of o.tunnels || []) if (tn.hidden && o.props && o.props[tn.under]) { tn.ax = o.props[tn.under].x; tn.ay = o.props[tn.under].y; }
}

const withDefaults = (h) => ({
  sludge: [], ice: [], props: [], boulders: [], bumpers: [], wind: [0, 0], ramps: [], tunnels: [], ...h,
});
const HOLES = buildHoles().map(withDefaults);
const HOLES_TALL = buildRoomHoles().map(withDefaults);

/* ---------- the windmill (hole 5, for clients that can draw it) ----------

   A model windmill stands across the lane on Lean Left. Its base is solid apart from a
   doorway, and four sails turn in front of the door: while a sail sweeps the bottom of
   its circle it closes the doorway and a ball bounces off it; otherwise the ball rolls
   straight through. The long way round is the right-hand lane, the tight one is the
   left rail.

   Everything about it is a pure function of time, so the server decides every putt and
   a client draws the sails from the state alone. Angles are measured from straight
   down, seen from the tee looking up the course (+y): a sail's tip sits at
   (hub.x + sin(a) * L, hubHeight - cos(a) * L), so a = 0 points at the ground and closes
   the door, and a = pi/2 points right (+x, downwind). Sail k is at a0 + k * 2pi / sails.
   The sails turn at `omega` rad/s, so a(t) = a0 + omega * t.

   Only rooms whose every human can draw it get it (server.js), so a player on an older
   app never sees a ball bounce off something that is not there. The classic hole 5 in
   HOLES is untouched. */
const WINDMILL = Object.freeze({
  hole: 4,                          // index into HOLES: hole 5, Mill Race
  hub: [26, 54],                    // the middle of the doorway's front face
  door: [22, 30],                   // the doorway: x from and to, at the front face
  base: [14, 38],                   // the base: x from and to — 14 clear on the left, 26 on the right
  depth: 8,                         // how far the base runs up the course from the front face
  sails: 4,
  omega: 0.35 * 2 * Math.PI,        // rad/s: 0.35 turns a second, the zone's idle speed
  block: 0.3,                       // a sail closes the door within this many radians of straight down
});

/* Is the doorway shut when sail 0 stands at angle a? */
function sailClosed(a, wm = WINDMILL) {
  const gap = (2 * Math.PI) / wm.sails;
  let m = a % gap;
  if (m < 0) m += gap;
  return m <= wm.block || m >= gap - wm.block;
}

/* Sail 0's angle, normalised to 0..2pi, `ms` after the moment it stood at a0. */
function sailAngle(a0, ms, wm = WINDMILL) {
  const a = (a0 + wm.omega * (ms / 1000)) % (2 * Math.PI);
  return a < 0 ? a + 2 * Math.PI : a;
}

function withWindmill(h, wm = WINDMILL) {
  const hy = wm.hub[1];
  const piers = [rect(wm.base[0], hy, wm.door[0], hy + wm.depth), rect(wm.door[1], hy, wm.base[1], hy + wm.depth)];
  let walls = h.walls;
  for (const p of piers) walls = walls.concat(edges(p));
  return {
    ...h, walls,
    windmill: {
      hub: wm.hub.slice(), door: wm.door.slice(), base: wm.base.slice(), depth: wm.depth,
      sails: wm.sails, omega: wm.omega, block: wm.block,
      piers, gate: [wm.door[0], hy, wm.door[1], hy],
    },
  };
}

/* The same nine holes with the windmill standing on hole 5. */
const HOLES_WINDMILL = HOLES.map((h, i) => (i === WINDMILL.hole ? withWindmill(h) : h));

/* The windmill on the tall hole 5: where it stands and how deep its base runs both double
   with the hole (so it reads the same from the 60-degree camera); its sails do not change. */
const WINDMILL_TALL = Object.freeze({
  ...WINDMILL,
  hub: [snap(33 * ROOM_SCALE), snap(snap(46 * KY) * ROOM_SCALE)],     // the middle of the doorway's front face (laid out 33, 46, stretched)
  door: [snap(27 * ROOM_SCALE), snap(39 * ROOM_SCALE)],
  base: [snap(19 * ROOM_SCALE), snap(47 * ROOM_SCALE)],
  depth: snap(snap(10 * KY) * ROOM_SCALE),
});
const HOLES_TALL_WINDMILL = HOLES_TALL.map((h, i) => (i === WINDMILL_TALL.hole ? withWindmill(h, WINDMILL_TALL) : h));
/* The same long holes with the covers taken away and the cup in the open, which a room plays where an app cannot draw covers (hidden: false). The Meadow's Chicken Run is the one hole with covers. */
const HOLES_TALL_PLAIN = HOLES_TALL.map(plainHole);
const HOLES_TALL_WINDMILL_PLAIN = HOLES_TALL_WINDMILL.map(plainHole);

/* ---------- the courses (the owner, 2026-11-01: "there are multiple courses in plato which are really awesome") ----------

   A course is its nine holes and its theme (the app's look), and the holes are data: courses/<id>.js lays them out in the same 66 x 96 as
   the Meadow's long rooms, with the same helpers (KIT), and finishRoomHoles makes them what every room plays. Meadow, the green
   course, is course 1 and stays as it was (HOLES_TALL). A course is drawn by every app as a hole it is sent (the geometry is the
   server's), and an app that does not know the course draws its holes as the Meadow's, so an older app in a room of any course plays on,
   in the Meadow's paint. Only a hidden-cup hole needs an app that knows covers (plainHole: the same hole with the cup in the open). */
const COURSES = [
  { id: "meadow", name: "Meadow" },
  { id: "beach", name: "Sunny Beach" },
  { id: "slimelab", name: "Slime Lab" },
  { id: "icecave", name: "Ice Cave" },
  { id: "volcano", name: "Volcano" },
];
const KIT = { rect, lshape, bar, arc, ring, diamond, belt, divider, snap, edges, WALL_T, GAP, ROOM_SCALE, SLIME_R, KY, TOY_SCALE, R, CUP_R };
const COURSE_SETS = {};
for (const { id } of COURSES) {
  if (id === "meadow") continue;
  const holes = finishRoomHoles(require("./courses/" + id)(KIT)).map(withDefaults);
  /* plain: the covers taken away (an app that cannot draw them); ventless: the steam vents taken away (an app that cannot draw those, so no ball is kicked by what it cannot see); both. */
  const plain = holes.map(plainHole), ventless = holes.map(noVents);
  COURSE_SETS[id] = { holes, plain, ventless, plainVentless: plain.map(noVents) };
}
const HOLES_BEACH = COURSE_SETS.beach.holes;
const HOLES_SLIMELAB = COURSE_SETS.slimelab.holes;
const HOLES_ICECAVE = COURSE_SETS.icecave.holes;
const HOLES_VOLCANO = COURSE_SETS.volcano.holes;

/* The nine holes a room plays: a course (the Meadow by default), tall or not, with the windmill or not. Only the Meadow has classic holes
   and a windmill; another course is long rooms, and hidden: false gives its holes with the covers taken away (an app that cannot draw them). */
function courseSet(opts = {}) {
  const set = opts.course && COURSE_SETS[opts.course];
  if (set) {
    const ventless = opts.vents === false;
    return opts.hidden === false ? (ventless ? set.plainVentless : set.plain) : (ventless ? set.ventless : set.holes);
  }
  if (opts.tall) {
    if (opts.hidden === false) return opts.windmill ? HOLES_TALL_WINDMILL_PLAIN : HOLES_TALL_PLAIN;
    return opts.windmill ? HOLES_TALL_WINDMILL : HOLES_TALL;
  }
  return opts.windmill ? HOLES_WINDMILL : HOLES;
}

/* A hole as a room has it right now: the props already knocked out are gone (null), and a hidden-cup hole has its cup under the cover the
   room chose (cupCover, an index into props; the cup is shut while that cover stands). `broken` lists the props knocked flat. */
function liveHole(h, broken, cupCover) {
  let live = h.props && h.props.length ? { ...h, props: h.props.map((p, i) => ((broken || []).includes(i) ? null : p)) } : h;
  if (h.hidden && cupCover != null && h.props[cupCover]) live = { ...live, cup: [h.props[cupCover].x, h.props[cupCover].y], cupCover };
  return live;
}

/* How high the ground is at a point.

   The simulation is strictly 2D — there is no z anywhere in it — so a ramp is modelled
   as an acceleration field rather than as geometry the ball climbs. This is the one
   function that turns that field back into a height, and both the physics (for the
   slope) and the client (for where to draw the ball) read it, so they cannot drift
   apart. */
function heightAt(hole, x, y) {
  let h = 0;
  for (const r of hole.ramps) {
    if (r.belt) continue;                // a conveyor belt is flat: it pushes, it does not rise
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

/* Rails, precomputed once per hole: x1 y1 x2 y2 dx dy len2 per wall, the same numbers
   closestOnSegment works out on every call. */
const wallCache = new WeakMap();
function compileWalls(walls) {
  let c = wallCache.get(walls);
  if (c) return c;
  c = new Float64Array(walls.length * 7);
  for (let k = 0; k < walls.length; k++) {
    const w = walls[k], dx = w[2] - w[0], dy = w[3] - w[1];
    c[k * 7] = w[0]; c[k * 7 + 1] = w[1]; c[k * 7 + 2] = w[2]; c[k * 7 + 3] = w[3];
    c[k * 7 + 4] = dx; c[k * 7 + 5] = dy; c[k * 7 + 6] = dx * dx + dy * dy;
  }
  wallCache.set(walls, c);
  return c;
}

/* A hair over 1: a squared distance past (limit^2 * SLACK) is certainly past the limit,
   so the exact Math.hypot test can be skipped without ever changing its answer. */
const SLACK = 1 + 1e-9;
const R2_OUT = R * R * SLACK;

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

/* Whether a belt carries a ball resting at (x, y): it lies on one, and no wall stands in the way of the push (a belt that drives a ball into a rail holds it
   there, as any slope would). The push is the sum of the belts under it, the same as the loop's. */
function carriedByBelt(hole, belts, x, y) {
  let bx = 0, by = 0;
  for (let k = 0; k < belts.length; k++) {
    const r = belts[k];
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

/* Simulates one putt. Returns the path, where it stopped, and why it stopped.
   `aim` is radians (0 = +x, pi/2 = +y), `power` is 0..1.

   `opts` (all optional):
     record  false skips the path (a bot's practice swings only need where it stops)
     wm0     where sail 0 stands at the strike, on a hole with a windmill (see WINDMILL)
     vt0     where the steam vents' cycle stands at the strike, in ms (ventClock), on a hole with vents (see VENT)
     gear    { speed, roll } (gear.js golfEffects, gear step 4): the putter's multiple of the putt's launch speed and the ball's multiple of the green's friction and drag, for this
             ball alone (a knocked ball and a boulder roll on the base); none, or 1 and 1, is exactly the base, bit for bit

   It was made faster without changing a single result: the same arithmetic in the same
   order, with the square roots skipped only where a squared distance already settles the
   test. test/physics.js holds it to the frozen original, bit for bit. */
function simulate(hole, from, aim, power, opts) {
  const record = !(opts && opts.record === false);
  const wm = hole.windmill || null;
  const wm0 = wm && opts && Number.isFinite(opts.wm0) ? opts.wm0 : 0;

  power = Number(power);
  aim = Number(aim);
  if (!Number.isFinite(power)) power = 0;
  if (!Number.isFinite(aim)) aim = 0;
  power = Math.max(0.02, Math.min(1, power));

  const gear = opts && opts.gear ? opts.gear : null;
  const gSpeed = gear && gear.speed > 0 && gear.speed !== 1 ? gear.speed : 0;
  const gRoll = gear && gear.roll > 0 && gear.roll !== 1 ? gear.roll : 0;
  let x = from[0], y = from[1];
  let vx = gSpeed ? trig.cos(aim) * MAX_SPEED * power * gSpeed : trig.cos(aim) * MAX_SPEED * power;
  let vy = gSpeed ? trig.sin(aim) * MAX_SPEED * power * gSpeed : trig.sin(aim) * MAX_SPEED * power;

  const path = record ? [[round(x), round(y)]] : null;
  const steps = Math.floor(MAX_SECONDS / DT);
  const launch = Math.hypot(vx, vy);
  let peak = 0;                      // fastest the ball ever goes after launch
  let cupSpeed = null;               // how fast it was when it dropped
  let result = "stopped";

  const W = compileWalls(hole.walls), nW = W.length;
  const { sludge, sand, water, ramps, bumpers, tunnels } = hole;
  const ice = hole.ice || [];
  const vents = hole.vents || [], nV = vents.length;
  const vt0 = nV && opts && Number.isFinite(opts.vt0) ? opts.vt0 : 0;
  const ventHit = nV ? new Uint8Array(nV) : null;   // 1 while the ball is over a grate that has already kicked it
  let kicks = null;
  const belts = ramps.filter((r) => r.belt);
  /* Props standing on the green (Plato's trees, houses, birds; barns, sheep and hens since 2026-10-15): the ball bounces off one and
     knocks it out; it is gone for the rest of the putt, and the server keeps it gone for the
     rest of the hole (a null in hole.props). broke lists them, in the order they fell. */
  const props = (hole.props || []).slice();
  const broke = [];
  /* The long rooms' props stand (Plato's trees, sheep and hens are solid: the ball bounces off, nothing bursts or vanishes);
     the classic holes keep knocking them flat, since their hidden holes lie under them. */
  const solidProps = !!hole.solid;
  /* Big balls (Plato's): they stand in the way, and a putt that meets one knocks it
     rolling. They roll off the rails and stop where they stop, and the server keeps them
     there for the rest of the hole. Each keeps a path sampled with the ball's own (and on
     after the ball is done, until it stops); moved lists the ones that moved. */
  const boulders = (hole.boulders || []).map((b) => ({ x: b.x, y: b.y, r: b.r, vx: 0, vy: 0, hit: false,
    path: record ? [[round(b.x), round(b.y)]] : null }));
  const nB = boulders.length;
  /* The other players' balls lying on the green (Plato's balls are solid, 2026-10-31): a putt that meets one knocks it away like a
     billiard ball (the same weight, BALL_RESTITUTION), and it rolls on by the green's own rules to rest, into the water (back to
     its own lie) or into the cup (holed for its owner). Each keeps a path sampled with the ball's own. A bot's practice swings do
     not know of them, only the putt that is really played. */
  const others = (opts && Array.isArray(opts.others) ? opts.others : []).map((o) => ({ x: o.x, y: o.y, vx: 0, vy: 0, seat: o.seat,
    lie: o.lie || [o.x, o.y], hit: false, gone: false, result: "stopped", path: record ? [[round(o.x), round(o.y)]] : null }));
  const nO = others.length;
  const mark = (px, py) => {
    path.push([round(px), round(py)]);
    for (let k = 0; k < nB; k++) boulders[k].path.push([round(boulders[k].x), round(boulders[k].y)]);
    for (let k = 0; k < nO; k++) others[k].path.push([round(others[k].x), round(others[k].y)]);
  };
  let end = null;
  const windX = hole.wind[0] * PUSH_SCALE * DT, windY = hole.wind[1] * PUSH_SCALE * DT;
  const cupX = hole.cup[0], cupY = hole.cup[1];
  const cupCover = hole.cupCover;   // the cover the cup lies under on a hidden-cup hole (an index into props), else undefined
  const gate = wm ? wm.gate : null;
  let gdx = 0, gdy = 0, glen2 = 0;
  if (gate) { gdx = gate[2] - gate[0]; gdy = gate[3] - gate[1]; glen2 = gdx * gdx + gdy * gdy; }

  for (let i = 1; i <= steps; i++) {
    const speed = Math.hypot(vx, vy);
    // a ball on a belt is never at rest on it: the arrows carry it on until it leaves the strip (or a wall ends the way)
    if (speed < STOP_SPEED && !(belts.length && carriedByBelt(hole, belts, x, y))) { vx = vy = 0; break; }

    // friction, heavier in sand and heavier still in sludge
    let grip = FRICTION, drag = DRAG;
    if (inCircles(x, y, sludge)) { grip = SLUDGE_FRICTION; drag = SLUDGE_DRAG; }
    else if (inCircles(x, y, sand)) { grip = SAND_FRICTION; drag = SAND_DRAG; }
    else if (inCircles(x, y, ice)) { grip = ICE_FRICTION; drag = ICE_DRAG; }
    if (gRoll) { grip *= gRoll; drag *= gRoll; }   // the ball's roll (gear): less friction and drag on every surface, for this ball alone
    const scale = speed > 0 ? Math.max(0, (speed - (grip + drag * speed) * DT) / speed) : 1;
    vx *= scale; vy *= scale;

    /* Wind pushes only while the ball is rolling — the loop already stops below
       STOP_SPEED, so a ball at rest cannot be blown across the green. */
    vx += windX;
    vy += windY;

    // and a ramp pushes downhill, so a putt that runs out of legs rolls back down
    let rx = 0, ry = 0;
    for (let k = 0; k < ramps.length; k++) {
      const r = ramps[k];
      if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
      const span = r.axis === "y" ? r.y1 - r.y0 : r.x1 - r.x0;
      const push = RAMP_G * (r.rise / span) * (r.flip ? 1 : -1);
      if (r.axis === "y") ry += push; else rx += push;
    }
    vx += rx * DT;
    vy += ry * DT;

    // steam vents: a ball over a grate that is puffing (or that rolls onto one as it starts to) is kicked away from its middle, once for each time it is over it
    if (nV) {
      const tms = vt0 + i * DT * 1000;
      for (let k = 0; k < nV; k++) {
        const v = vents[k];
        const ex = x - v.x, ey = y - v.y;
        if (ex * ex + ey * ey >= v.r * v.r) { ventHit[k] = 0; continue; }
        if (ventHit[k] || !ventActive(tms, v.phase)) continue;
        ventHit[k] = 1;
        const d = Math.hypot(ex, ey);
        if (d > 0) { vx += (ex / d) * VENT.kick; vy += (ey / d) * VENT.kick; }
        else { const sp = Math.hypot(vx, vy); if (sp > 0) { vx += (vx / sp) * VENT.kick; vy += (vy / sp) * VENT.kick; } }   // dead centre: on the way it was going
        (kicks || (kicks = [])).push([k, i]);
      }
    }

    x += vx * DT;
    y += vy * DT;
    if (i > 1) peak = Math.max(peak, speed);

    // rails: push the ball out and reflect whatever went into the wall
    for (let k = 0; k < nW; k += 7) {
      const x1 = W[k], y1 = W[k + 1], dx = W[k + 4], dy = W[k + 5], len2 = W[k + 6];
      let cx, cy;
      if (len2 === 0) { cx = x1; cy = y1; }
      else {
        let t = ((x - x1) * dx + (y - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        cx = x1 + t * dx; cy = y1 + t * dy;
      }
      let nx = x - cx, ny = y - cy;
      if (nx * nx + ny * ny > R2_OUT) continue;
      const d = Math.hypot(nx, ny);
      if (d >= R || d === 0) continue;
      nx /= d; ny /= d;
      x = cx + nx * R;
      y = cy + ny * R;
      const along = vx * nx + vy * ny;
      if (along < 0) { vx -= (1 + RESTITUTION) * along * nx; vy -= (1 + RESTITUTION) * along * ny; }
    }

    /* The windmill's door: a rail across the doorway while a sail is down, nothing while
       the sails are clear. A sail is modelled as a wall that appears; it does not throw
       the ball sideways as it passes. */
    if (gate && sailClosed(wm0 + wm.omega * (i * DT), wm)) {
      let t = ((x - gate[0]) * gdx + (y - gate[1]) * gdy) / glen2;
      t = Math.max(0, Math.min(1, t));
      const cx = gate[0] + t * gdx, cy = gate[1] + t * gdy;
      let nx = x - cx, ny = y - cy;
      const d = Math.hypot(nx, ny);
      if (d < R && d !== 0) {
        nx /= d; ny /= d;
        x = cx + nx * R;
        y = cy + ny * R;
        const along = vx * nx + vy * ny;
        if (along < 0) { vx -= (1 + RESTITUTION) * along * nx; vy -= (1 + RESTITUTION) * along * ny; }
      }
    }

    for (let k = 0; k < props.length; k++) {
      const b = props[k];
      if (!b) continue;
      let nx = x - b.x, ny = y - b.y;
      const reach = b.r + R;
      if (nx * nx + ny * ny >= reach * reach) continue;
      const d = Math.hypot(nx, ny);
      if (d === 0) continue;
      nx /= d; ny /= d;
      x = b.x + nx * reach;
      y = b.y + ny * reach;
      const along = vx * nx + vy * ny;
      if (along < 0) {
        vx -= (1 + PROP_RESTITUTION) * along * nx;
        vy -= (1 + PROP_RESTITUTION) * along * ny;
      }
      if (!solidProps || b.cover) { props[k] = null; broke.push(k); }   // a cover is knocked flat on every hole
    }
    for (let k = 0; k < nB; k++) {
      const b = boulders[k];
      let nx = x - b.x, ny = y - b.y;
      const reach = b.r + R;
      if (nx * nx + ny * ny >= reach * reach) continue;
      const d = Math.hypot(nx, ny);
      if (d === 0) continue;
      nx /= d; ny /= d;
      x = b.x + nx * reach;
      y = b.y + ny * reach;
      const rel = (vx - b.vx) * nx + (vy - b.vy) * ny;
      if (rel < 0) {
        const j = -(1 + BOULDER_RESTITUTION) * rel / (1 + 1 / BOULDER_MASS);
        vx += j * nx; vy += j * ny;
        b.vx -= (j / BOULDER_MASS) * nx; b.vy -= (j / BOULDER_MASS) * ny;
        b.hit = true;
      }
    }
    for (let k = 0; k < nB; k++) rollBoulder(boulders[k], W, nW, null);

    // the others' balls: met by this one, then rolling on their own
    if (nO) {
      for (let k = 0; k < nO; k++) {
        const o = others[k];
        if (o.gone) continue;
        let nx = x - o.x, ny = y - o.y;
        const reach = 2 * R;
        if (nx * nx + ny * ny >= reach * reach) continue;
        const d = Math.hypot(nx, ny);
        if (d === 0) continue;
        nx /= d; ny /= d;
        const half = (reach - d) * 0.5;
        x += nx * half; y += ny * half; o.x -= nx * half; o.y -= ny * half;
        const rel = (vx - o.vx) * nx + (vy - o.vy) * ny;
        if (rel < 0) {
          const j = -(1 + BALL_RESTITUTION) * rel * 0.5;
          vx += j * nx; vy += j * ny; o.vx -= j * nx; o.vy -= j * ny;
          o.hit = true;
        }
      }
      for (let k = 0; k < nO; k++) rollBall(others[k], hole, W, nW);
      ballsApart(others);
    }

    // bumpers give back more than they took, so the ball leaves faster than it arrived
    for (let k = 0; k < bumpers.length; k++) {
      const b = bumpers[k];
      let nx = x - b.x, ny = y - b.y;
      const reach = b.r + R;
      if (nx * nx + ny * ny > reach * reach * SLACK) continue;
      const d = Math.hypot(nx, ny);
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
    for (let k = 0; k < tunnels.length; k++) {
      const t = tunnels[k];
      if (t.under != null && props[t.under]) continue;   // still hidden under its prop: no hole there yet
      const ax = x - t.ax, ay = y - t.ay, bx = x - t.bx, by = y - t.by, lim = t.r * t.r * SLACK;
      if (ax * ax + ay * ay > lim && bx * bx + by * by > lim) continue;
      const da = Math.hypot(x - t.ax, y - t.ay), db = Math.hypot(x - t.bx, y - t.by);
      const inA = da <= t.r, inB = db <= t.r;
      if (!inA && !inB) continue;
      const sp = Math.hypot(vx, vy);
      if (sp < STOP_SPEED) break;
      const ex = inA ? t.bx : t.ax, ey = inA ? t.by : t.ay;
      if (record) mark(x, y);
      x = ex + (vx / sp) * (t.r + R + 1);
      y = ey + (vy / sp) * (t.r + R + 1);
      if (record) mark(x, y);
      break;
    }

    // the cup: has to be slow enough to drop rather than rim out (and not under a cover that still stands)
    const dcx = x - cupX, dcy = y - cupY;
    if (dcx * dcx + dcy * dcy <= CUP_R * CUP_R && Math.hypot(vx, vy) <= CUP_SPEED && !(cupCover != null && props[cupCover])) {
      cupSpeed = Math.hypot(vx, vy);
      if (record) mark(cupX, cupY);
      result = "holed"; end = [cupX, cupY];
      break;
    }

    if (inCircles(x, y, water)) {
      if (record) mark(x, y);
      result = "water"; end = [from[0], from[1]];   // penalty, replay from where it was struck
      break;
    }

    if (record && i % RECORD_EVERY === 0) mark(x, y);
  }

  if (!end) {
    if (record) mark(x, y);
    end = [x, y];
  }
  const out = { path, end, result, launch, peak, cupSpeed, broke };
  if (kicks) out.kicks = kicks;   // [vent, step] for each kick, a step being 1/240 s after the strike
  if (nB === 0 && nO === 0) return out;

  // The big balls and the knocked balls still rolling roll on to rest; a golf ball left on the green stops one dead.
  const rest = result === "holed" ? null : end;
  const moving = () => boulders.some((b) => b.vx !== 0 || b.vy !== 0) || others.some((o) => !o.gone && (o.vx !== 0 || o.vy !== 0));
  let rolling = moving();
  for (let i = 1; rolling && i <= steps; i++) {
    for (let k = 0; k < nB; k++) rollBoulder(boulders[k], W, nW, rest);
    for (let k = 0; k < nO; k++) {
      const o = others[k];
      if (o.gone || !rest) continue;
      // the putt's own ball, now lying still: the knocked ball bounces off it
      let nx = o.x - rest[0], ny = o.y - rest[1];
      if (nx * nx + ny * ny < 4 * R * R) {
        const d = Math.hypot(nx, ny);
        if (d !== 0) {
          nx /= d; ny /= d;
          o.x = rest[0] + nx * 2 * R; o.y = rest[1] + ny * 2 * R;
          const along = o.vx * nx + o.vy * ny;
          if (along < 0) { o.vx -= (1 + BALL_RESTITUTION) * along * nx; o.vy -= (1 + BALL_RESTITUTION) * along * ny; }
        }
      }
    }
    for (let k = 0; k < nO; k++) rollBall(others[k], hole, W, nW);
    ballsApart(others);
    rolling = moving();
    if (record && (i % RECORD_EVERY === 0 || !rolling)) {
      for (let k = 0; k < nB; k++) boulders[k].path.push([round(boulders[k].x), round(boulders[k].y)]);
      for (let k = 0; k < nO; k++) others[k].path.push([round(others[k].x), round(others[k].y)]);
    }
  }
  if (nB) {
    out.boulders = boulders.map((b) => ({ x: b.x, y: b.y, r: b.r }));
    out.moved = [];
    for (let k = 0; k < nB; k++) if (boulders[k].hit) out.moved.push({ k, path: record ? boulders[k].path : null });
  }
  if (nO) {
    out.knock = [];
    for (const o of others) {
      if (!o.hit) continue;
      const end2 = o.result === "water" ? [o.lie[0], o.lie[1]] : [o.x, o.y];
      out.knock.push({ seat: o.seat, result: o.result, end: end2, path: record ? o.path : null });
    }
  }
  return out;
}

/* One step of a golf ball that was knocked away (see simulate's others): the green's own friction, the breeze, the slopes, the
   rails and the props, then the cup (slow enough) or the water, both of which end its roll. */
function rollBall(o, hole, W, nW) {
  if (o.gone) return;
  const sp = Math.hypot(o.vx, o.vy);
  const belts = hole.ramps.filter((r) => r.belt);
  const carried = belts.length > 0 && o.hit && carriedByBelt(hole, belts, o.x, o.y);   // a ball a putt has knocked, on the arrows
  if (sp === 0 && !carried) return;
  if (sp < STOP_SPEED && !carried) { o.vx = o.vy = 0; return; }
  let grip = FRICTION, drag = DRAG;
  if (inCircles(o.x, o.y, hole.sludge)) { grip = SLUDGE_FRICTION; drag = SLUDGE_DRAG; }
  else if (inCircles(o.x, o.y, hole.sand)) { grip = SAND_FRICTION; drag = SAND_DRAG; }
  else if (inCircles(o.x, o.y, hole.ice || [])) { grip = ICE_FRICTION; drag = ICE_DRAG; }
  const s = sp > 0 ? Math.max(0, (sp - (grip + drag * sp) * DT) / sp) : 1;
  o.vx *= s; o.vy *= s;
  o.vx += hole.wind[0] * PUSH_SCALE * DT;
  o.vy += hole.wind[1] * PUSH_SCALE * DT;
  for (const r of hole.ramps) {
    if (o.x < r.x0 || o.x > r.x1 || o.y < r.y0 || o.y > r.y1) continue;
    const span = r.axis === "y" ? r.y1 - r.y0 : r.x1 - r.x0;
    const push = RAMP_G * (r.rise / span) * (r.flip ? 1 : -1);
    if (r.axis === "y") o.vy += push * DT; else o.vx += push * DT;
  }
  o.x += o.vx * DT;
  o.y += o.vy * DT;
  for (let k = 0; k < nW; k += 7) {
    const x1 = W[k], y1 = W[k + 1], dx = W[k + 4], dy = W[k + 5], len2 = W[k + 6];
    let cx, cy;
    if (len2 === 0) { cx = x1; cy = y1; }
    else {
      let t = ((o.x - x1) * dx + (o.y - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      cx = x1 + t * dx; cy = y1 + t * dy;
    }
    let nx = o.x - cx, ny = o.y - cy;
    if (nx * nx + ny * ny >= R * R) continue;
    const d = Math.hypot(nx, ny);
    if (d === 0) continue;
    nx /= d; ny /= d;
    o.x = cx + nx * R; o.y = cy + ny * R;
    const along = o.vx * nx + o.vy * ny;
    if (along < 0) { o.vx -= (1 + RESTITUTION) * along * nx; o.vy -= (1 + RESTITUTION) * along * ny; }
  }
  for (const b of hole.props || []) {
    if (!b || !hole.solid) continue;
    let nx = o.x - b.x, ny = o.y - b.y;
    const reach = b.r + R;
    if (nx * nx + ny * ny >= reach * reach) continue;
    const d = Math.hypot(nx, ny);
    if (d === 0) continue;
    nx /= d; ny /= d;
    o.x = b.x + nx * reach; o.y = b.y + ny * reach;
    const along = o.vx * nx + o.vy * ny;
    if (along < 0) { o.vx -= (1 + PROP_RESTITUTION) * along * nx; o.vy -= (1 + PROP_RESTITUTION) * along * ny; }
  }
  const dcx = o.x - hole.cup[0], dcy = o.y - hole.cup[1];
  if (dcx * dcx + dcy * dcy <= CUP_R * CUP_R && Math.hypot(o.vx, o.vy) <= CUP_SPEED && !(hole.cupCover != null && hole.props[hole.cupCover])) {
    o.gone = true; o.result = "holed"; o.x = hole.cup[0]; o.y = hole.cup[1]; o.vx = o.vy = 0;
    return;
  }
  if (inCircles(o.x, o.y, hole.water)) { o.gone = true; o.result = "water"; o.vx = o.vy = 0; }
}

/* Knocked balls meeting each other: the same billiard exchange as the putt's, and pushed apart so none sits in another. */
function ballsApart(list) {
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const p = list[a], q = list[b];
      if (p.gone || q.gone) continue;
      let nx = p.x - q.x, ny = p.y - q.y;
      if (nx * nx + ny * ny >= 4 * R * R) continue;
      const d = Math.hypot(nx, ny);
      if (d === 0) continue;
      nx /= d; ny /= d;
      const half = (2 * R - d) * 0.5;
      p.x += nx * half; p.y += ny * half; q.x -= nx * half; q.y -= ny * half;
      const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
      if (rel < 0) {
        const j = -(1 + BALL_RESTITUTION) * rel * 0.5;
        p.vx += j * nx; p.vy += j * ny; q.vx -= j * nx; q.vy -= j * ny;
        p.hit = q.hit = true;
      }
    }
  }
}

/* One step of a big ball: its own heavy friction, off the rails as a golf ball comes off
   them, and off a golf ball lying still (Rest), which it cannot shift. */
function rollBoulder(b, W, nW, rest) {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp === 0) return;
  if (sp < STOP_SPEED) { b.vx = b.vy = 0; return; }
  const s = Math.max(0, (sp - (BOULDER_FRICTION + DRAG * sp) * DT) / sp);
  b.vx *= s; b.vy *= s;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  const r2 = b.r * b.r;
  for (let k = 0; k < nW; k += 7) {
    const x1 = W[k], y1 = W[k + 1], dx = W[k + 4], dy = W[k + 5], len2 = W[k + 6];
    let cx, cy;
    if (len2 === 0) { cx = x1; cy = y1; }
    else {
      let t = ((b.x - x1) * dx + (b.y - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      cx = x1 + t * dx; cy = y1 + t * dy;
    }
    let nx = b.x - cx, ny = b.y - cy;
    if (nx * nx + ny * ny >= r2) continue;
    const d = Math.hypot(nx, ny);
    if (d === 0) continue;
    nx /= d; ny /= d;
    b.x = cx + nx * b.r;
    b.y = cy + ny * b.r;
    const along = b.vx * nx + b.vy * ny;
    if (along < 0) { b.vx -= (1 + RESTITUTION) * along * nx; b.vy -= (1 + RESTITUTION) * along * ny; }
  }
  if (rest) {
    let nx = b.x - rest[0], ny = b.y - rest[1];
    const reach = b.r + R;
    if (nx * nx + ny * ny < reach * reach) {
      const d = Math.hypot(nx, ny);
      if (d !== 0) {
        nx /= d; ny /= d;
        b.x = rest[0] + nx * reach;
        b.y = rest[1] + ny * reach;
        const along = b.vx * nx + b.vy * ny;
        if (along < 0) { b.vx -= 1.5 * along * nx; b.vy -= 1.5 * along * ny; }
      }
    }
  }
}

const round = (n) => Math.round(n * 100) / 100;

/* How far a ball has to roll to reach the cup from each spot on the green, round the
   walls rather than through them: a grid one unit square over the hole, a cell open if
   a ball can sit there (inside the fairway, clear of every wall by a ball's radius, not
   in the water), and Dijkstra from the cup's cell in whole numbers (10 a step, 14 a
   diagonal; no cutting a corner), so the app's port gets the same numbers to the bit.
   Hidden holes, tunnels, bumpers and big balls are left out: a bot finds those by
   trying putts, not from the map. Kept per set of walls, which every copy of a hole
   with the big balls moved still shares, and per cup (a hidden-cup hole's cup lies under a different cover each game). */
const fields = new WeakMap();
function routeField(hole) {
  let byCup = fields.get(hole.walls);
  if (!byCup) { byCup = new Map(); fields.set(hole.walls, byCup); }
  const cupKey = Math.floor(hole.cup[0]) + "," + Math.floor(hole.cup[1]);   // a hidden-cup hole's cup lies somewhere else each game
  let f = byCup.get(cupKey);
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
  byCup.set(cupKey, f);
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

/* How far a putt of this speed rolls on the green, the way simulate() slows it (the same arithmetic in the same order, a flat green and no
   walls), and the power that rolls a given distance: found by halving, so the bot's first guess is as good as the physics. */
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
function botShot(hole, from, skill = 0.7, rnd = Math.random, opts) {   // opts.hit: the index of a cover to knock flat, when the cup is not yet found
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
  const practice = { record: false, wm0: opts && Number.isFinite(opts.wm0) ? opts.wm0 : 0, vt0: opts && Number.isFinite(opts.vt0) ? opts.vt0 : 0 };
  const hit = opts && Number.isInteger(opts.hit) ? opts.hit : -1;

  let best = null;
  search:
  for (const aim of aims) {
    for (const power of powers) {
      const shot = simulate(hole, from, aim, Math.max(0.05, Math.min(1, power)), practice);
      let score;
      if (shot.result === "holed") score = -1000;
      else if (shot.result === "water") score = 10000;
      else if (hit >= 0 && shot.broke.includes(hit)) score = -999;   // the cover it hunts, knocked flat
      else score = routeLength(hole, shot.end[0], shot.end[1]);
      if (!best || score < best.score) best = { aim, power, score };
      if (score <= -999) break search;    // nothing beats holing it, and a hunt wants nothing more than the cover down
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

/* A bot's putt on a hole as a room has it. `st`: { broken, cupCover, wm0 }: the props knocked flat, the cover the cup lies under once it is
   found (never before: a bot hunts like a player), and the windmill's sails. On a hidden-cup hole whose cup is not found yet, the bot hunts:
   it goes for the cover that is nearest by the way the ball rolls and knocks it flat, then plays the cup it shows (botShot's hit). */
function botPlay(h, from, skill, rnd, st = {}) {
  const broken = st.broken || [];
  if (!h.hidden || (st.cupCover != null && broken.includes(st.cupCover))) return botShot(liveHole(h, broken, st.cupCover), from, skill, rnd, st);
  let best = null;
  for (const k of h.hidden.covers) {
    if (broken.includes(k)) continue;
    const live = liveHole(h, broken, k);   // the cup, as far as this hunt goes, lies under that cover
    const d = routeLength(live, from[0], from[1]);
    if (!best || d < best.d) best = { k, d, live };
  }
  return best ? botShot(best.live, from, skill, rnd, { ...st, hit: best.k }) : botShot(liveHole(h, broken, h.hidden.plain), from, skill, rnd, st);
}

module.exports = {
  rollDistance, powerForDistance, botPlay,
  VENT, VENT_PERIOD, ventActive, ventClock, noVents, HOLES_VOLCANO,
  HOLES, HOLES_WINDMILL, WINDMILL, HOLES_TALL, HOLES_TALL_WINDMILL, HOLES_TALL_PLAIN, HOLES_TALL_WINDMILL_PLAIN, WINDMILL_TALL, LENGTH_TALL, ROOM_SCALE, courseSet, COURSES, HOLES_BEACH, HOLES_SLIMELAB, HOLES_ICECAVE, liveHole, plainHole, sailClosed, sailAngle, simulate, botShot, routeField, routeLength,
  heightAt, rampPush,
  BOULDER_MASS, BOULDER_RESTITUTION, BOULDER_FRICTION,
  R, CUP_R, MAX_SPEED, FRICTION, DRAG, PUSH_SCALE, SAND_FRICTION, SAND_DRAG, SLUDGE_FRICTION, SLUDGE_DRAG, ICE_FRICTION, ICE_DRAG, PROP_RESTITUTION, BALL_RESTITUTION, BUMPER_RESTITUTION, RAMP_G, RAMP_G_REF,
  RESTITUTION, STOP_SPEED, CUP_SPEED, DT,
  closestOnSegment, inCircles, edges, rect, lshape, bar, arc, ring, diamond, belt, snap, trig,
};
