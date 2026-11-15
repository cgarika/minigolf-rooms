/* Mini Golf — the wide-hole design suite (test/holes.js).
   Run: node test/holes.js

   Proves the nine holes read as Plato-style wide holes: tee and cup sit inside the
   fairway and outside every obstacle and hazard; every outline is a portrait
   rectangle roughly a phone's own shape; every hole offers at least one route from
   tee to cup that is never narrower than 12 units; a full-power putt aimed straight
   at the cup cannot trivially hole out on holes 3-9; and bots at a spread of skills
   can still finish every hole inside the stroke cap the server enforces (8). */

const c = require("../course");

/* GOLF_TALL=1 runs the same suite on the long holes (the 60-degree camera, 2026-10-16):
   every length along the course is LENGTH_TALL times longer, so the portrait range is too. */
const TALL = process.env.GOLF_TALL === "1";
const HOLES = TALL ? c.HOLES_TALL : c.HOLES;
const HOLES_WINDMILL = TALL ? c.HOLES_TALL_WINDMILL : c.HOLES_WINDMILL;
const K = TALL ? c.LENGTH_TALL : 1;
const SIZE = TALL ? c.ROOM_SCALE : 1;   // the rooms are drawn smaller, the ball and the toys not (course.js, ROOM_SCALE)
if (TALL) console.log("(the tall holes)");

let failures = 0;
function check(ok, what, extra) { if (!ok) { failures++; console.log("  FAIL: " + what + (extra ? "  " + extra : "")); } }
function section(name) { console.log("\n" + name); }

/* even-odd point in polygon (same test as physics.js uses) */
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToEdges(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const [px, py] = c.closestOnSegment(x, y, a[0], a[1], b[0], b[1]);
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
}

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const MAX_STROKES = 8;             // matches server.js's MAX_STROKES: pick it up after this
const MIN_CORRIDOR = 4;           // a ball (2.3 across) gets through, with room to spare
const MAX_SQUEEZE = TALL ? 12 : 9;            // and somewhere on the way it has to thread a gap no wider than this (the owner: harder)

// ---------------------------------------------------------------- tee and cup

section("tee and cup sit inside the fairway, clear of every hazard");
{
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    for (const [label, [x, y]] of [["tee", h.tee], ["cup", h.cup]]) {
      check(inPoly(x, y, h.outline), `hole ${hi + 1} "${h.name}": ${label} is outside the outline`, `${x},${y}`);
      for (const ob of h.obstacles)
        check(!inPoly(x, y, ob), `hole ${hi + 1} "${h.name}": ${label} is inside an obstacle`, `${x},${y}`);
      check(!c.inCircles(x, y, h.water), `hole ${hi + 1} "${h.name}": ${label} is in the water`, `${x},${y}`);
      check(!c.inCircles(x, y, h.sludge), `hole ${hi + 1} "${h.name}": ${label} is in the sludge`, `${x},${y}`);
    }
  }
  console.log(`  ${HOLES.length} holes, tee and cup both clear`);
}

// ---------------------------------------------------------------- the shape of the field

section("every outline reads as a phone's own portrait shape");
{
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), ht = Math.max(...ys) - Math.min(...ys);
    const ratio = ht / w;
    check(TALL ? (ratio >= 1.3 && ratio <= 1.6) : (ratio >= 1.45 && ratio <= 1.75), `hole ${hi + 1} "${h.name}": outline is not portrait-shaped`,
      `${w.toFixed(0)} x ${ht.toFixed(0)}, ratio ${ratio.toFixed(2)}`);
    check(w >= (TALL ? 33 : 50) && w <= (TALL ? 40 : 72), `hole ${hi + 1} "${h.name}": width is off Plato's scale`, `${w}`);
    check(ht >= (TALL ? 48 : 85) && ht <= (TALL ? 58 : 115), `hole ${hi + 1} "${h.name}": length is off Plato's scale`, `${ht}`);
    // the tee near the bottom, the cup nearer the top — the camera looks up the hole
    check(h.tee[1] < h.cup[1], `hole ${hi + 1} "${h.name}": the tee is not below the cup`, `tee ${h.tee} cup ${h.cup}`);
  }
  console.log(`  ${HOLES.length} outlines within Plato's portrait range, tee low, cup high`);
}

// ---------------------------------------------------------------- corridor width

section("every hole has a route a ball fits through, and a small gap it has to thread");
{
  /* A grid over the outline's own bounding box: a cell is open if its centre sits
     inside the fairway and outside every obstacle. Each open cell's clearance is its
     distance to the nearest wall (an outline or obstacle edge). Cells are revealed in
     decreasing order of clearance and union-found with their already-revealed
     neighbours; the clearance at the moment tee and cup first join the same group is
     the bottleneck of the WIDEST path between them — doubled, the narrowest that best
     route ever gets. A hole may still hide a narrower shortcut (a bridge over a pond,
     a squeeze past the windmill); this only asks that some honest route never drops
     below the minimum, which is the property a sampled walk down the intended path
     would otherwise be checking by hand. */
  const STEP = 1;
  for (let hi = 0; hi < HOLES.length; hi++) {
    // the course every current app plays: hole 5 with its windmill standing, piers and all
    const hw = HOLES_WINDMILL[hi];
    const h = hw.windmill ? { ...hw, obstacles: hw.obstacles.concat(hw.windmill.piers) } : hw;
    const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cols = Math.round((x1 - x0) / STEP) + 1, rows = Math.round((y1 - y0) / STEP) + 1;
    const idx = (cx, cy) => cy * cols + cx;
    const cellOf = (px, py) => [Math.round((px - x0) / STEP), Math.round((py - y0) / STEP)];

    const clearance = new Float64Array(cols * rows).fill(-1);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x = x0 + cx * STEP, y = y0 + cy * STEP;
      if (!inPoly(x, y, h.outline)) continue;
      if (h.obstacles.some((ob) => inPoly(x, y, ob))) continue;
      let d = distToEdges(x, y, h.outline);
      for (const ob of h.obstacles) d = Math.min(d, distToEdges(x, y, ob));
      clearance[idx(cx, cy)] = d;
    }

    const cells = [];
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const d = clearance[idx(cx, cy)];
      if (d >= 0) cells.push([cx, cy, d]);
    }
    cells.sort((a, b) => b[2] - a[2]);

    const parent = new Int32Array(cols * rows).fill(-1);
    const find = (a) => { while (parent[a] !== a) a = parent[a]; return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    const revealed = new Uint8Array(cols * rows);

    const [teeCx, teeCy] = cellOf(h.tee[0], h.tee[1]);
    const [cupCx, cupCy] = cellOf(h.cup[0], h.cup[1]);
    const teeIdx = idx(teeCx, teeCy), cupIdx = idx(cupCx, cupCy);

    let bottleneck = -1;
    for (const [cx, cy, d] of cells) {
      const i2 = idx(cx, cy);
      revealed[i2] = 1; parent[i2] = i2;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ni = idx(nx, ny);
        if (revealed[ni]) union(i2, ni);
      }
      if (revealed[teeIdx] && revealed[cupIdx] && find(teeIdx) === find(cupIdx)) { bottleneck = d; break; }
    }
    check(bottleneck >= 0, `hole ${hi + 1} "${h.name}": no route at all joins tee and cup on the grid`, "");
    check(bottleneck * 2 >= MIN_CORRIDOR - 1e-6, `hole ${hi + 1} "${h.name}": the best route narrows below ${MIN_CORRIDOR} units`,
      `widest route is ${(bottleneck * 2).toFixed(1)} units wide there`);
    check(bottleneck * 2 <= MAX_SQUEEZE + 1e-6, `hole ${hi + 1} "${h.name}": no small gap on the way — a route ${(bottleneck * 2).toFixed(1)} wide runs the whole hole`);
    console.log(`  hole ${hi + 1} ${h.name.padEnd(16)} narrowest gap on the best route: ${(bottleneck * 2).toFixed(1)}`);
  }
}

// ---------------------------------------------------------------- no gimme

section("holes 3-9: a full-power putt straight at the cup cannot trivially hole out");
{
  for (let hi = 2; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    const aim = Math.atan2(h.cup[1] - h.tee[1], h.cup[0] - h.tee[0]);
    const shot = c.simulate(h, h.tee, aim, 1);
    check(shot.result !== "holed", `hole ${hi + 1} "${h.name}": a blind full-power putt from the tee holes out`,
      `result ${shot.result}`);
  }
  console.log("  no hole from 3 to 9 folds to a single blind full-power putt from the tee");
}

// ---------------------------------------------------------------- finishable at a spread of skills

section("every hole finishes inside the stroke cap, at a spread of bot skills");
{
  const SKILLS = [1.0, 0.85, 0.72, 0.5];
  for (let hi = 0; hi < HOLES.length; hi++) {
    const h = HOLES[hi];
    const line = [];
    for (const skill of SKILLS) {
      const rand = rng(5000 + hi * 97 + Math.round(skill * 100));
      const rounds = 40;
      let holedIn = 0;
      for (let r = 0; r < rounds; r++) {
        let at = h.tee, strokes = 0;
        while (strokes < MAX_STROKES) {
          const s = c.botShot(h, at, skill, rand);
          const shot = c.simulate(h, at, s.aim, s.power);
          strokes++;
          at = shot.end;
          if (shot.result === "holed") { holedIn++; break; }
        }
      }
      // a weaker bot is meant to be beatable, not shut out: the bar drops with skill,
      // but every skill level still has to get round some of the time
      const need = skill >= 0.8 ? 0.5 : skill >= 0.6 ? 0.3 : 0.12;
      check(holedIn >= rounds * need, `hole ${hi + 1} "${h.name}" at skill ${skill}: only finished ${holedIn}/${rounds} inside ${MAX_STROKES} strokes`);
      line.push(`${skill}:${holedIn}/${rounds}`);
    }
    console.log(`  hole ${hi + 1} ${h.name.padEnd(16)} ${line.join("  ")}`);
  }
}

console.log(failures === 0 ? "\nholes: all good\n" : `\nholes: ${failures} failure(s)\n`);
process.exit(failures ? 1 : 0);
