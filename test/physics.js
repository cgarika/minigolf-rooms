/* Mini Golf — physics suite.
   Run: node test/physics.js

   The server is the only thing deciding where a ball ends up, so the things that
   matter are: a ball never escapes the fairway or tunnels through a wall, a putt never
   gains energy, the cup only takes a ball that is slow enough, and the same shot always
   gives the same answer (rejoins and replays have to agree). */

const c = require("../course");

/* GOLF_TALL=1: the same suite on the long holes (the 60-degree camera, 2026-10-16). The frozen
   reference below plays its own holes either way. */
const TALL = process.env.GOLF_TALL === "1";
const HOLES = TALL ? c.HOLES_TALL : c.HOLES;
const HOLES_WINDMILL = TALL ? c.HOLES_TALL_WINDMILL : c.HOLES_WINDMILL;
const WINDMILL = TALL ? c.WINDMILL_TALL : c.WINDMILL;
if (TALL) console.log("(the tall holes)");

let failures = 0;
function check(ok, what, extra) {
  if (ok) return;
  failures++;
  console.log("  FAIL: " + what + (extra ? "  " + extra : ""));
}
function section(name) { console.log("\n" + name); }

/* even-odd point in polygon */
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* distance from a point to the nearest edge of a polygon */
function distToEdges(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const [px, py] = c.closestOnSegment(x, y, a[0], a[1], b[0], b[1]);
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
}

/* a small deterministic generator, so a failure can be reproduced */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- containment

section("the ball stays on the hole");
{
  const TOL = 0.35;          // a hair of slack for the push-out at a corner
  let shots = 0;
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    const rand = rng(1000 + hi);
    for (let i = 0; i < 400; i++) {
      // fire from the tee and from a scatter of legal spots, at every angle and power
      const from = i < 200 ? h.tee : randomSpotOn(h, rand);
      const aim = rand() * Math.PI * 2;
      const power = 0.15 + rand() * 0.85;
      const shot = c.simulate(h, from, aim, power);
      shots++;

      for (const [x, y] of shot.path) {
        check(inPoly(x, y, h.outline) || distToEdges(x, y, h.outline) < TOL,
          `hole ${hi + 1} "${h.name}": ball left the fairway`,
          `at ${x},${y} from ${from} aim ${aim.toFixed(3)} power ${power.toFixed(3)}`);
        for (const ob of h.obstacles)
          check(!inPoly(x, y, ob) || distToEdges(x, y, ob) < TOL,
            `hole ${hi + 1} "${h.name}": ball inside an obstacle`,
            `at ${x},${y} from ${from} aim ${aim.toFixed(3)} power ${power.toFixed(3)}`);
      }

      const [ex, ey] = shot.end;
      check(inPoly(ex, ey, h.outline) || distToEdges(ex, ey, h.outline) < TOL,
        `hole ${hi + 1}: rest position off the fairway`, `${ex},${ey}`);
    }
  }
  console.log(`  ${shots} shots across ${HOLES.length} holes`);
}

function randomSpotOn(h, rand) {
  for (let tries = 0; tries < 200; tries++) {
    const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
    const x = Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs));
    const y = Math.min(...ys) + rand() * (Math.max(...ys) - Math.min(...ys));
    if (!inPoly(x, y, h.outline)) continue;
    if (distToEdges(x, y, h.outline) < c.R * 2) continue;
    if (h.obstacles.some((o) => inPoly(x, y, o) || distToEdges(x, y, o) < c.R * 2)) continue;
    if (c.inCircles(x, y, h.water)) continue;
    // a bumper pushes a ball to its rim, so the simulation can never leave one resting
    // inside; starting a shot there is a state the game cannot reach
    if (h.bumpers.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + c.R * 2)) continue;
    return [x, y];
  }
  return h.tee;
}

// ---------------------------------------------------------------- no free energy

section("a bumper has room to push into");
{
  /* A bumper resolves a hit by placing the ball on a circle of r + R around it. If a
     wall is closer than that, the push-out puts the ball THROUGH the wall — which is
     how hole 9 started flinging balls to (-389, 381). Same shape of bug as a tunnel
     mouth with no clearance, and just as silent. */
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    for (const b of h.bumpers) {
      const reach = b.r + c.R;
      for (let a = 0; a < 64; a++) {
        const ang = (a / 64) * Math.PI * 2;
        const ex = b.x + Math.cos(ang) * reach, ey = b.y + Math.sin(ang) * reach;
        const ok = inPoly(ex, ey, h.outline)
          && h.obstacles.every((ob) => !inPoly(ex, ey, ob));
        check(ok, `hole ${hi + 1} "${h.name}": bumper at ${b.x},${b.y} can push a ball out of bounds`,
          `${ex.toFixed(1)},${ey.toFixed(1)}`);
      }
    }
  }
  console.log("  every bumper can seat a ball without pushing it through a wall");
}

section("a tunnel always opens somewhere legal");
{
  /* simulate() puts the ball at `r + R + 1` beyond the far mouth, along whatever
     direction it was travelling — so a mouth needs that much clearance in EVERY
     direction, not just towards its partner. Getting this wrong does not crash: the
     ball is quietly born inside a wall and the wall resolver shoves it somewhere
     surprising, which is exactly how hole 9 started spitting balls into an obstacle. */
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    for (const t of h.tunnels) {
      const reach = t.r + c.R + 1;
      for (const [mx, my, which] of [[t.ax, t.ay, "A"], [t.bx, t.by, "B"]]) {
        for (let a = 0; a < 64; a++) {
          const ang = (a / 64) * Math.PI * 2;
          const ex = mx + Math.cos(ang) * reach, ey = my + Math.sin(ang) * reach;
          check(inPoly(ex, ey, h.outline) && distToEdges(ex, ey, h.outline) >= c.R,
            `hole ${hi + 1} "${h.name}": tunnel mouth ${which} can open outside the hole`,
            `${ex.toFixed(1)},${ey.toFixed(1)}`);
          for (const ob of h.obstacles)
            check(!inPoly(ex, ey, ob) && distToEdges(ex, ey, ob) >= c.R,
              `hole ${hi + 1} "${h.name}": tunnel mouth ${which} can open inside an obstacle`,
              `${ex.toFixed(1)},${ey.toFixed(1)}`);
        }
      }
    }
  }
  console.log("  every mouth has room to let a ball out in any direction");
}

section("a putt never gains speed");
{
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    const rand = rng(50 + hi);
    for (let i = 0; i < 80; i++) {
      const shot = c.simulate(h, h.tee, rand() * Math.PI * 2, 0.3 + rand() * 0.7);
      /* Rails may never return more than they took. Bumpers are built to, so on a hole
         that has one the bound is the course-wide ceiling instead: a bumper can kick a
         ball along but never past a full-power putt, which is what stops two of them
         facing each other from accelerating a ball forever. */
      /* A ball let go near the top of a ramp turns height into speed, so on a hole
         with one the honest ceiling is launch plus what the drop is worth. Today's
         ramps all sit above the tee, so a putt from the tee only ever climbs them —
         but relying on that is relying on where the tee happens to be, and this test
         also fires from random spots. */
      const rise = h.ramps.reduce((m, r) => Math.max(m, r.rise), 0);
      const withDrop = Math.sqrt(shot.launch * shot.launch + 2 * c.RAMP_G * rise);
      const ceiling = h.bumpers.length ? c.MAX_SPEED + 1e-6 : withDrop + 1e-6;
      check(shot.peak <= ceiling,
        `hole ${hi + 1}: ${h.bumpers.length ? "a bumper exceeded a full-power putt" : "a bounce sped the ball up"}`,
        `launch ${shot.launch.toFixed(2)} peak ${shot.peak.toFixed(2)}`);
    }
  }
  console.log("  no rail returns more than it took, and no bumper beats a full putt");
}

// ---------------------------------------------------------------- the cup

section("the cup");
{
  const h = HOLES[0];
  // just short, clear of the wall that guards the cup's front (the tall holes' pocket opens to the left)
  const near = TALL ? [h.cup[0] - 6, h.cup[1]] : [h.cup[0], h.cup[1] - 6];
  const toward = TALL ? 0 : Math.PI / 2;

  let holed = 0;
  for (let p = 0.08; p <= 0.30; p += 0.01) {
    if (c.simulate(h, near, toward, p).result === "holed") holed++;
  }
  check(holed > 0, "a gentle straight putt never drops");

  // however a ball drops, it must have been slow enough to
  const rand = rng(4242);
  let fast = 0;
  for (let i = 0; i < 400; i++) {
    const shot = c.simulate(h, near, Math.PI / 2 + (rand() - 0.5) * 0.6, 0.1 + rand() * 0.9);
    if (shot.result !== "holed") continue;
    check(shot.cupSpeed <= c.CUP_SPEED + 1e-6, "a ball dropped while moving too fast",
      `${shot.cupSpeed.toFixed(1)} > ${c.CUP_SPEED}`);
    if (shot.cupSpeed > c.CUP_SPEED * 0.5) fast++;
  }

  // a ball hammered straight over the cup must run past it, not drop on that pass.
  // The stand-in cup sits 20 units up the tee's own line to the real cup — clear of
  // anything standing in hole 1, whatever hole 1 happens to look like today.
  const aimTC = Math.atan2(h.cup[1] - h.tee[1], h.cup[0] - h.tee[0]);
  const midCup = [h.tee[0] + Math.cos(aimTC) * 20, h.tee[1] + Math.sin(aimTC) * 20];
  const long = { ...h, cup: midCup, walls: h.walls };
  const blast = c.simulate(long, h.tee, aimTC, 1);
  const firstNear = blast.path.findIndex(([x, y]) => Math.hypot(x - midCup[0], y - midCup[1]) <= c.CUP_R);
  check(firstNear === -1 || blast.result !== "holed" || firstNear < blast.path.length - 2,
    "a full-speed ball dropped on its first pass over the cup");

  if (c.simulate(h, near, Math.PI / 2, 0.22).result === "holed") {
    const soft = c.simulate(h, near, Math.PI / 2, 0.22);
    check(Math.hypot(soft.end[0] - h.cup[0], soft.end[1] - h.cup[1]) < 1e-6, "holed but not in the cup");
  }
  console.log(`  ${holed} of 15 gentle putts dropped; every drop was under the speed limit`);
}

// ---------------------------------------------------------------- water

section("water");
{
  /* Found by hazard rather than by name. This used to name a hole, and naming a hole
     means the test breaks the day the course is redesigned rather than the day the
     physics does — which is exactly what happened. */
  const h = HOLES.find((x) => x.water.length);
  const pond = h.water[0];

  // start just short of the pond, on the line back towards the tee, and roll into it
  const back = Math.atan2(h.tee[1] - pond.y, h.tee[0] - pond.x);
  const gap = pond.r + 5;
  const from = [pond.x + Math.cos(back) * gap, pond.y + Math.sin(back) * gap];
  // (a gentle putt, then firmer ones: a bunker in the way holds a soft one back)
  const tries = [0.32, 0.6, 1].map((power) => c.simulate(h, from, back + Math.PI, power));
  const shot = tries.find((t) => t.result === "water") || tries[0];
  check(shot.result === "water", "a putt straight into the pond did not find it", shot.result);
  check(shot.end[0] === from[0] && shot.end[1] === from[1], "a watered ball did not come back to where it was struck");
  console.log("  ball returns to the spot it was played from");
}

// ---------------------------------------------------------------- determinism

section("the same shot gives the same answer");
{
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    const a = c.simulate(h, h.tee, 1.05, 0.63);
    const b = c.simulate(h, h.tee, 1.05, 0.63);
    check(JSON.stringify(a) === JSON.stringify(b), `hole ${hi + 1}: two identical shots differed`);
  }
  console.log("  every hole replays identically");
}

// ---------------------------------------------------------------- input hygiene

section("bad input cannot break it");
{
  const h = HOLES[0];
  for (const [aim, power] of [[NaN, 0.5], [0, NaN], [1e9, 1e9], [-1e9, -5], [0, 0], [Infinity, Infinity]]) {
    const shot = c.simulate(h, h.tee, aim, power);
    check(Number.isFinite(shot.end[0]) && Number.isFinite(shot.end[1]),
      `aim=${aim} power=${power} produced a non-finite position`);
    check(shot.path.length > 0, `aim=${aim} power=${power} produced no path`);
  }
  console.log("  NaN, Infinity and out-of-range values are all survivable");
}

// ---------------------------------------------------------------- playability

section("every hole is playable");
{
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    const rand = rng(777 + hi);
    let holedIn = 0, rounds = 60;
    for (let r = 0; r < rounds; r++) {
      let at = h.tee, strokes = 0;
      while (strokes < 8) {
        const s = c.botShot(h, at, 0.85, rand);
        const shot = c.simulate(h, at, s.aim, s.power);
        strokes++;
        at = shot.end;
        if (shot.result === "holed") { holedIn++; break; }
      }
    }
    check(holedIn >= rounds * 0.5, `hole ${hi + 1} "${h.name}": a good bot only finished ${holedIn}/${rounds}`);
    console.log(`  hole ${hi + 1} ${h.name.padEnd(16)} par ${h.par}  bot finished ${holedIn}/${rounds}`);
  }
}

// ---------------------------------------------------------------- the speed-up changed nothing

section("the faster physics is the same physics");
{
  /* simulate() was rewritten for speed (no allocation per rail, square roots skipped
     where a squared distance settles the test, practice swings without a path). The
     original is frozen in test/fixtures/course-reference.js; every result here must be
     identical to it, bit for bit, or a replay, a rejoin or the client's parity data
     could disagree with a live putt.

     This is a check on the ENGINE, not on the course: both the fast simulate() (c)
     and the frozen original (ref) are fed the reference's own frozen holes (hr), never
     today's HOLES, so a course redesign can never make this suite fail — only a change
     to the arithmetic itself can. */
  const ref = require("./fixtures/course-reference");
  let shots = 0, differ = 0;
  for (let hi = 0; hi < ref.HOLES.length; hi++) {
    const hr = ref.HOLES[hi];
    const rand = rng(31337 + hi);
    for (let i = 0; i < 1500; i++) {
      const from = i % 3 === 0 ? hr.tee : randomSpotOn(hr, rand);
      const aim = rand() * Math.PI * 2, power = rand() * 1.1;
      const a = c.simulate(hr, from, aim, power), b = ref.simulate(hr, from, aim, power);
      const q = c.simulate(hr, from, aim, power, { record: false });
      shots++;
      const same = JSON.stringify(a) === JSON.stringify(b)
        && q.path === null && q.result === b.result && q.end[0] === b.end[0] && q.end[1] === b.end[1]
        && q.launch === b.launch && q.peak === b.peak && q.cupSpeed === b.cupSpeed;
      if (!same) { differ++; if (differ <= 3) check(false, `hole ${hi + 1}: a shot differs from the reference`, `from ${from} aim ${aim} power ${power}`); }
    }
    // a bot fed the same dice chooses the same putt
    for (let k = 0; k < 6; k++) {
      const from = k === 0 ? hr.tee : randomSpotOn(hr, rand);
      const x = c.botShot(hr, from, 0.72, rng(900 + k)), y = ref.botShot(hr, from, 0.72, rng(900 + k));
      check(x.aim === y.aim && x.power === y.power, `hole ${hi + 1}: a bot chose differently from the reference`,
        `${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
    }
  }
  check(differ === 0, `${differ} of ${shots} shots differ from the reference`);
  console.log(`  ${shots} shots and 54 bot choices identical to the original physics, on the reference's own holes`);
}

// ---------------------------------------------------------------- the windmill

section("the windmill stands only where it was asked for");
{
  const W = WINDMILL;
  check(HOLES.every((h) => !h.windmill), "a classic hole grew a windmill");
  check(HOLES_WINDMILL.length === HOLES.length, "the windmill course lost or gained a hole");
  HOLES_WINDMILL.forEach((h, i) => {
    if (i === W.hole) check(!!h.windmill, "hole 5 has no windmill on the windmill course");
    else check(h === HOLES[i], `hole ${i + 1} differs on the windmill course`);
  });
  const h = HOLES_WINDMILL[W.hole];
  const [d0, d1] = h.windmill.door;
  check(d1 - d0 >= 2 * c.R + 2, "the doorway is too narrow for a ball", `${d1 - d0}`);
  // the base sits inside the fairway, clear of the other walls, with room round both sides
  for (const p of h.windmill.piers) for (const [x, y] of p)
    check(inPoly(x, y, h.outline) || distToEdges(x, y, h.outline) < 1e-9, "a pier corner is off the fairway", `${x},${y}`);
  // the rails either side of the base, read from the hole's own outline rather than
  // pinned to a coordinate, so a redesign of the hole can never make this stale
  const railXs = h.outline.map((p) => p[0]);
  const railL = Math.min(...railXs), railR = Math.max(...railXs);
  const left = W.base[0] - railL, right = railR - W.base[1];
  check(left >= 2 * c.R + 2 && right >= 2 * c.R + 2, "no lane round the windmill", `left ${left} right ${right}`);
  check(!c.inCircles(h.cup[0], h.cup[1], []) && !(h.cup[1] >= W.hub[1] && h.cup[1] <= W.hub[1] + W.depth && h.cup[0] >= W.base[0] && h.cup[0] <= W.base[1]),
    "the cup is under the windmill");
  console.log("  hole 5 only, a ball-and-a-half doorway, a lane either side");
}

section("the sails open and close the door");
{
  const h = HOLES_WINDMILL[WINDMILL.hole], W = h.windmill;
  const gap = (2 * Math.PI) / W.sails;
  check(c.sailClosed(0) && c.sailClosed(gap) && c.sailClosed(-0.1) && c.sailClosed(W.block - 1e-9), "a sail pointing down does not close the door");
  check(!c.sailClosed(gap / 2) && !c.sailClosed(W.block + 0.01), "the door is shut with every sail clear of it");
  // a fixed sail makes the gate a plain wall (shut) or nothing (open)
  const held = (a) => ({ ...h, windmill: { ...W, omega: 0 } });
  const at = [W.hub[0], W.hub[1] - 14], up = Math.PI / 2;
  const shut = c.simulate(held(), at, up, 0.75, { wm0: 0 });
  const open = c.simulate(held(), at, up, 0.75, { wm0: gap / 2 });
  check(shut.path.every(([, y]) => y <= W.hub[1] - c.R + 0.35), "a ball went through a shut door",
    `max y ${Math.max(...shut.path.map((p) => p[1]))}`);
  check(open.path.some(([, y]) => y > W.hub[1] + W.depth), "a ball could not roll through an open door",
    `max y ${Math.max(...open.path.map((p) => p[1]))}`);

  // with the sails turning, when you strike decides whether you get through
  let through = 0, back = 0;
  for (let k = 0; k < 48; k++) {
    const wm0 = (k / 48) * gap;
    const s = c.simulate(h, at, up, 0.75, { wm0 });
    if (s.path.some(([, y]) => y > W.hub[1] + W.depth)) through++; else back++;
    const again = c.simulate(h, at, up, 0.75, { wm0 });
    check(JSON.stringify(s) === JSON.stringify(again), "the same strike on the windmill gave two answers");
  }
  check(through > 0 && back > 0, "timing does not matter at the windmill", `through ${through} back ${back}`);
  console.log(`  a shut door is a wall, an open one is not; ${through} of 48 strike times got through`);
}

section("nothing gets inside the windmill");
{
  const h = HOLES_WINDMILL[WINDMILL.hole], W = h.windmill, TOL = 0.35;
  const rand = rng(2468);
  const solids = h.obstacles.concat(W.piers);
  const probe = { ...h, obstacles: solids };
  let shots = 0;
  for (let i = 0; i < 1500; i++) {
    const from = i < 400 ? h.tee : randomSpotOn(probe, rand);
    const aim = rand() * Math.PI * 2, power = 0.15 + rand() * 0.85, wm0 = rand() * Math.PI * 2;
    const shot = c.simulate(h, from, aim, power, { wm0 });
    shots++;
    for (const [x, y] of shot.path) {
      check(inPoly(x, y, h.outline) || distToEdges(x, y, h.outline) < TOL, "the ball left Lean Left with the windmill up", `${x},${y}`);
      for (const ob of solids)
        check(!inPoly(x, y, ob) || distToEdges(x, y, ob) < TOL, "the ball went inside the windmill or a wall", `${x},${y} wm0 ${wm0}`);
    }
  }
  console.log(`  ${shots} shots at random strike times, none through a pier`);
}

section("the windmill hole is playable");
{
  const h = HOLES_WINDMILL[WINDMILL.hole];
  const rand = rng(1357);
  let holedIn = 0, strokesIn = 0;
  const rounds = 60;
  for (let r = 0; r < rounds; r++) {
    let at = h.tee, strokes = 0;
    while (strokes < 8) {
      const wm0 = rand() * Math.PI * 2;                     // the sails wherever they happen to be
      const s = c.botShot(h, at, 0.85, rand, { wm0 });
      const shot = c.simulate(h, at, s.aim, s.power, { wm0 });
      strokes++;
      at = shot.end;
      if (shot.result === "holed") { holedIn++; strokesIn += strokes; break; }
    }
  }
  check(holedIn >= rounds * 0.5, `the windmill hole: a good bot only finished ${holedIn}/${rounds}`);
  console.log(`  bot finished ${holedIn}/${rounds}, ${(strokesIn / Math.max(1, holedIn)).toFixed(2)} strokes on average (par ${h.par})`);
}

console.log(failures === 0 ? "\nphysics: all good\n" : `\nphysics: ${failures} failure(s)\n`);
process.exit(failures ? 1 : 0);
