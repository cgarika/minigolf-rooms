/* Mini Golf courses (the owner, 2026-11-01: "there are multiple courses in plato which are really awesome"). Run: node test/courses.js
   (starts its server in this process on TEST_PORT6, default 3661; never 3111-3124).

   Proves, in process: every course loads nine holes, each with a tee and a cup inside the walls and clear of every hazard, hazards and toys inside the walls, a ball that
   can leave the tee box; a bot finishes every Sunny Beach hole inside its cap, in three to four shots a hole on average with a hole in one rare (the best bot never has one),
   no straight line from tee to cup after hole 1, a hazard guarding most cups, two risk-and-reward holes (a short risky line, a long safe one), decor clear of hazards and of the line;
   the arrows carry a ball out of the strip; a hidden-cup hole: a ball that touches a cover knocks it flat, the cup stays shut under one that stands, every cover can be reached,
   a bot hunts the covers and always finishes. Over real sockets: the host's pick (and nobody else's), an older app in a beach room (long holes in the Meadow's paint, hidden cups
   played plain, never a missing cup), a hole's cup never sent before its cover is knocked flat, and a round that always finishes. */
"use strict";
const crypto = require("crypto");
const { io } = require("socket.io-client");
const c = require("../course");

const PORT = Number(process.env.TEST_PORT6 || 3661);
if (PORT >= 3111 && PORT <= 3124) { console.error("refusing " + PORT); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, extra) => { console.log((ok ? "PASS " : "FAIL ") + what + (!ok && extra ? "  " + extra : "")); if (!ok) failed++; };
const section = (n) => console.log("\n" + n);
const rng = (seed) => { let v = seed >>> 0; return () => { v = (v * 1664525 + 1013904223) >>> 0; return v / 4294967296; }; };
const capOf = (h) => Math.max(5, Math.min(8, h.par + 2));   // server.js's maxStrokesOf: the pick-up rule

const inPoly = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
const nearestWall = (x, y, h) => Math.min(...h.walls.map((w) => { const [px, py] = c.closestOnSegment(x, y, w[0], w[1], w[2], w[3]); return Math.hypot(x - px, y - py); }));
const beach = c.courseSet({ course: "beach", tall: true, hidden: true });
const beachPlain = c.courseSet({ course: "beach", tall: true, hidden: false });

// ------------------------------------------------------------------ the courses
section("the courses: a registry, nine holes each, the Meadow untouched");
{
  check(c.COURSES.length >= 2 && c.COURSES[0].id === "meadow" && c.COURSES.some((k) => k.id === "beach" && k.name === "Sunny Beach"), "Meadow is course 1, Sunny Beach course 2", JSON.stringify(c.COURSES));
  for (const { id } of c.COURSES) check(c.courseSet({ course: id, tall: true }).length === 9, `${id} has nine holes`);
  check(c.courseSet({ course: "nowhere", tall: true }) === c.HOLES_TALL && c.courseSet({}) === c.HOLES, "an unknown course, or none, is the Meadow as before");
  // the Meadow's sets, frozen hole by hole: a course framework changes nothing about the course that was already there. The one change since: Chicken Run (the long holes' seventh) hides its cup
  // under one of four hay bales (the owner, 2026-11-01: hidden cups for the Meadow too), and the sha1 of that hole alone moved; the other eight, the classic nine and both windmill sets are what they were.
  const sha = (o) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex");
  check(sha({ HOLES: c.HOLES, WIND: c.HOLES_WINDMILL }) === "8c441ecb276c73daf5dc551efe966ec44a47560b", "the Meadow's classic nine (and with the windmill) are exactly what they were before the courses");
  const frozenTall = ["ab68cfae43ff08ca6449e1aa1822b28cc741c61f", "dc0f1a15faa8afcbd38c310d91bff0a7a2a9ffc3", "7dfd2bd20be0335043c05453f2382f41fca95f72", "6fb82dc7191c6829c83490145706c60988b53459",
    "1a605024e0157fb4863e4b13ff3a82943c404914", "05d19d44843f7268983dfac7b86c4c711e77d5da", null, "13437008141ba46cb9e86257e9dd8f16ee9ad009", "19a067738fa18f0defbbdcc05996c5b1b3c62304"];
  frozenTall.forEach((want, i) => { if (want) check(sha(c.HOLES_TALL[i]) === want, `the Meadow's long hole ${i + 1} (${c.HOLES_TALL[i].name}) is exactly what it was`, sha(c.HOLES_TALL[i])); });
  check(sha(c.HOLES_TALL_WINDMILL[4]) === "192773b31810c536a31040de91a431ec1ea7ba6b", "the long holes' windmill hole is exactly what it was");
  check(sha(c.HOLES_TALL[6]) === "b6e6e63e5544cadad2fab3e7ba28b5d78916f629" && sha(c.HOLES_TALL_WINDMILL[6]) === sha(c.HOLES_TALL[6]), "Chicken Run is the one Meadow hole that changed: four hay bales hide its cup", sha(c.HOLES_TALL[6]));
}

section("every Sunny Beach hole: a tee and a cup inside the walls, hazards and toys inside the walls, clear of one another");
{
  beach.forEach((h, i) => {
    const tag = `hole ${i + 1} "${h.name}"`;
    check(h.par >= 3 && h.par <= 6 && capOf(h) >= 5 && capOf(h) <= 8, `${tag}: a par and a cap`);
    for (const [label, [x, y]] of [["tee", h.tee], ["cup", h.cup]]) {
      check(inPoly(x, y, h.outline) && !h.obstacles.some((o) => inPoly(x, y, o)), `${tag}: the ${label} is on the beach, in no wall`);
      check(!c.inCircles(x, y, h.water) && !c.inCircles(x, y, h.sludge), `${tag}: the ${label} is not in water or goo`);
      check(nearestWall(x, y, h) >= c.R + 0.4, `${tag}: the ${label} has room for a ball beside the walls (${nearestWall(x, y, h).toFixed(2)})`);
    }
    check(!c.inCircles(h.tee[0], h.tee[1], h.sand) && h.teeBox[0] > 0, `${tag}: the tee box is on the grass`);
    const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const inside = (o) => o.x - o.r >= x0 - 0.01 && o.x + o.r <= x1 + 0.01 && o.y - o.r >= y0 - 0.01 && o.y + o.r <= y1 + 0.01;
    check([...h.sand, ...h.water, ...h.sludge, ...h.ice].every(inside), `${tag}: every sand bed, pool and puddle lies inside the walls`);
    check(h.props.every((p) => inPoly(p.x, p.y, h.outline) && !h.obstacles.some((o) => inPoly(p.x, p.y, o))), `${tag}: every toy stands on the beach`);
    check(h.obstacles.every((o) => o.every(([x, y]) => x >= x0 - 0.01 && x <= x1 + 0.01 && y >= y0 - 0.01 && y <= y1 + 0.01)), `${tag}: every plank lies inside the walls`);
    // the cup can be reached from the tee on foot (route field), and the arrows' strips stay on the beach
    check(c.routeLength(h, h.tee[0], h.tee[1]) < 500, `${tag}: a ball can roll from the tee to the cup (${c.routeLength(h, h.tee[0], h.tee[1]).toFixed(0)} units)`);
    // decor in the corners and along the edges, never in water or sand and never on the line from tee to cup (a cover stands where a cup may be: it is no decor)
    const bad = [];
    h.props.forEach((p, k) => {
      for (const o of [...h.water, ...h.sludge, ...h.bumpers]) if (Math.hypot(p.x - o.x, p.y - o.y) < p.r + o.r + 0.3) bad.push(`${p.kind}${k} on a hazard`);
      if (!p.cover) for (const o of h.sand) if (Math.hypot(p.x - o.x, p.y - o.y) < p.r + o.r) bad.push(`${p.kind}${k} on sand`);
      if (p.cover) return;
      const len = Math.hypot(h.cup[0] - h.tee[0], h.cup[1] - h.tee[1]);
      for (let t = 0; t <= len; t += 0.5) {
        const x = h.tee[0] + ((h.cup[0] - h.tee[0]) * t) / len, y = h.tee[1] + ((h.cup[1] - h.tee[1]) * t) / len;
        if (Math.hypot(x - p.x, y - p.y) < p.r + c.R + 1) { bad.push(`${p.kind}${k} on the line`); break; }
      }
    });
    check(bad.length === 0, `${tag}: decor stands clear of the hazards and of the line from tee to cup`, bad.join("; "));
  });
  // all decor (palms, a crab, a beach ball, starfish, a sandcastle, an umbrella) stands on the sand outside the walls, and the app draws it: inside the walls only play objects remain
  check(beach.every((h) => h.props.every((p) => p.cover && p.kind === "sandcastle" && p.r >= 1.0 && p.r <= 1.6)), "inside the walls the only toys are covers: sandcastles 0.055 to 0.09 of the width across");
  check(beach.every((h) => h.props.length === 0 || h.hidden), "only a hidden-cup hole has covers");
  // the beach is as wide as the picture's course: 50 laid out, 27.5 drawn, a ninth of the page of golden sand on each side once the camera has the walls where the picture has them
  check(beach.every((h) => Math.abs(Math.max(...h.outline.map((p) => p[0])) - 27.5) < 1e-6), "every hole is 27.5 across drawn (the Meadow's long rooms are 36.3)");
}

// ------------------------------------------------------------------ harder holes, measured
section("Sunny Beach is hard: three to four shots a hole for the best bot, a hole in one rare, no straight line after hole 1, hazards at the cups, two risk-and-reward holes");
{
  const ROUNDS = 24;
  const playHole = (h, skill, rand) => {
    const cap = capOf(h);
    const cupCover = h.hidden ? h.hidden.covers[Math.floor(rand() * h.hidden.covers.length)] : null;
    let at = h.tee, strokes = 0, broken = [], found = false, holed = false;
    while (strokes < cap) {
      const live = c.liveHole(h, broken, cupCover);
      const sh = c.botPlay(h, at, skill, rand, { broken, cupCover: found ? cupCover : null });
      const shot = c.simulate(live, at, sh.aim, sh.power);
      strokes++; at = shot.end;
      for (const k of shot.broke) if (!broken.includes(k)) broken.push(k);
      if (cupCover != null && broken.includes(cupCover)) found = true;
      if (shot.result === "holed") { holed = true; break; }
    }
    return { strokes, holed };
  };
  const play = (h, skill, seed) => {
    const rand = rng(seed);
    let total = 0, aces = 0, holed = 0;
    for (let r = 0; r < ROUNDS; r++) { const g = playHole(h, skill, rand); total += g.strokes; if (g.holed) holed++; if (g.holed && g.strokes === 1) aces++; }
    return { mean: total / ROUNDS, aces: aces / ROUNDS, holed: holed / ROUNDS };
  };
  const best = beach.map((h, i) => play(h, 1.0, 7100 + i)), room = beach.map((h, i) => play(h, 0.72, 8100 + i)), mid = beach.map((h, i) => play(h, 0.85, 9100 + i));
  const avg = (list) => list.reduce((a, b) => a + b.mean, 0) / list.length;
  console.log("  holes, best bot / skill .85 / room bot (shots over " + ROUNDS + " games): " + beach.map((h, i) => `${i + 1} ${best[i].mean.toFixed(1)}/${mid[i].mean.toFixed(1)}/${room[i].mean.toFixed(1)}`).join("  "));
  check(avg(best) >= 3.0 && avg(best) <= 4.0, `the best bot averages 3 to 4 shots a hole over the nine (${avg(best).toFixed(2)})`);
  check(avg(mid) >= 3.0 && avg(mid) <= 5.0 && avg(room) >= 3.0 && avg(room) <= 5.0, `the room's bots average 3 to 5 (${avg(mid).toFixed(2)} at skill .85, ${avg(room).toFixed(2)} at .72)`);
  // two holes (the risk-and-reward ones: 3 and 6) can be finished by a perfect bot in two; every other hole takes it three or more
  const quick = best.map((b, i) => [b, i]).filter(([b]) => b.mean < 3.0).map(([, i]) => i + 1);
  check(best.every((b) => b.mean >= 2.0) && quick.length <= 2 && quick.every((i) => i === 3 || i === 6), `only the two risk-and-reward holes take the best bot under three shots (${quick.join(", ") || "none"})`);
  check(room.every((b, i) => b.mean >= (i === 2 || i === 5 ? 2.5 : 3.0)), `...and the room's bots at least 3 shots (2.5 on the risky ones): ${room.map((b) => b.mean.toFixed(1)).join(" ")}`);
  check(best.every((b) => b.aces === 0) && room.every((b) => b.aces <= 0.05), "a hole in one is rare: the best bot never has one, the room's under one round in twenty");
  check(best.every((b) => b.holed === 1), "the best bot finishes every hole inside its cap every time");
  check(room.every((b) => b.holed >= 0.7) && mid.every((b) => b.holed >= 0.85), `the room's bots finish every hole inside the cap (pick-up rule) in at least 70% of rounds (${room.map((b) => (b.holed * 100).toFixed(0)).join(" ")}%)`);

  // no straight line from tee to cup after hole 1 (the plain cup, where a hole hides it): a ball's centre cannot travel it clear of the walls, the water, the toys and the bumpers
  const straight = (h) => {
    const a = h.tee, b = h.cup, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t <= len; t += 0.25) {
      const x = a[0] + ((b[0] - a[0]) * t) / len, y = a[1] + ((b[1] - a[1]) * t) / len;
      for (const w of h.walls) { const [px, py] = c.closestOnSegment(x, y, w[0], w[1], w[2], w[3]); if (Math.hypot(x - px, y - py) < c.R + 0.1) return false; }
      for (const o of [...h.water, ...h.props.filter((p) => !p.cover), ...h.bumpers]) if (Math.hypot(x - o.x, y - o.y) < o.r + c.R) return false;
    }
    return true;
  };
  check(beachPlain.every((h, i) => i === 0 || !straight(h)), `no hole after the first has a straight line from the tee to the cup (${beachPlain.map((h) => (straight(h) ? "S" : "-")).join("")})`);

  // hazards guard the cup: water, sand, slime, a bumper or a belt within nine units of it (a cover stands for the cup on a hidden hole: it counts), on at least seven holes
  const guarded = beachPlain.map((h) => {
    const near = (list, extra = 0) => list.some((o) => Math.hypot(o.x - h.cup[0], o.y - h.cup[1]) <= 9 + o.r + extra);
    return near(h.water) || near(h.sand) || near(h.sludge) || near(h.bumpers) || h.ramps.some((r) => r.belt && h.cup[0] >= r.x0 - 9 && h.cup[0] <= r.x1 + 9 && h.cup[1] >= r.y0 - 9 && h.cup[1] <= r.y1 + 9)
      || h.obstacles.some((o) => o.some(([x, y]) => Math.hypot(x - h.cup[0], y - h.cup[1]) < 7));   // or a wall right beside it
  });
  check(guarded.filter(Boolean).length >= 7, `a hazard or a wall guards the cup on at least seven holes (${guarded.map((g) => (g ? "G" : "-")).join("")})`);

  // risk and reward: a short way that threads narrow gaps (and the water's edge) against a long way through roomy lanes, on holes 3 and 6. Dijkstra on a half-unit grid over what a ball's centre can cross:
  // the tight way keeps R + 0.1 from a wall and out of the water, the roomy one R + 1.9 from walls and from the water's edge, so it passes only gaps over 5 across.
  const route = (h, margin, waterMargin) => {
    const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
    const x1 = Math.max(...xs), y1 = Math.max(...ys), step = 0.5, cols = Math.round(x1 / step) + 1, rows = Math.round(y1 / step) + 1;
    const ok = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x = cx * step, y = cy * step;
      let free = !h.water.some((o) => Math.hypot(x - o.x, y - o.y) < o.r + waterMargin);
      for (const w of h.walls) { if (!free) break; const [px, py] = c.closestOnSegment(x, y, w[0], w[1], w[2], w[3]); if (Math.hypot(x - px, y - py) < c.R + margin) free = false; }
      ok[cy * cols + cx] = free ? 1 : 0;
    }
    const dist = new Float64Array(cols * rows).fill(Infinity), q = [];
    const at = (p) => Math.round(p[1] / step) * cols + Math.round(p[0] / step);
    dist[at(h.tee)] = 0; q.push(at(h.tee));
    while (q.length) {
      let bi = 0; for (let i = 1; i < q.length; i++) if (dist[q[i]] < dist[q[bi]]) bi = i;
      const u = q.splice(bi, 1)[0], ux = u % cols, uy = (u - ux) / cols;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = ux + dx, ny = uy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !ok[ny * cols + nx]) continue;
        const nd = dist[u] + Math.hypot(dx, dy) * step;
        if (nd < dist[ny * cols + nx]) { if (dist[ny * cols + nx] === Infinity) q.push(ny * cols + nx); dist[ny * cols + nx] = nd; }
      }
    }
    let bestD = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) bestD = Math.min(bestD, dist[at(h.cup) + dy * cols + dx]);
    return bestD;
  };
  for (const [i, ratio] of [[2, 1.3], [5, 1.3]]) {
    const h = beachPlain[i], tight = route(h, 0.1, 0), roomy = route(h, 1.9, 1.9);
    check(Number.isFinite(tight) && Number.isFinite(roomy) && roomy >= tight * ratio, `${h.name}: the roomy way (${roomy.toFixed(0)} units) is at least ${Math.round((ratio - 1) * 100)}% longer than the tight one (${tight.toFixed(0)}): risk or a long way round`);
  }
}

section("the arrows carry a ball: dropped at rest anywhere on a belt of the beach, it leaves the strip");
{
  let drops = 0, resting = 0, belts = 0;
  beachPlain.forEach((h) => {
    const wallNear = (p, d) => h.walls.some((w) => { const [px, py] = c.closestOnSegment(p[0], p[1], w[0], w[1], w[2], w[3]); return Math.hypot(p[0] - px, p[1] - py) < d; });
    for (const r of h.ramps.filter((q) => q.belt)) {
      belts++;
      const dx = r.axis === "x" ? (r.flip ? 1 : -1) : 0, dy = r.axis === "y" ? (r.flip ? 1 : -1) : 0;
      for (let x = r.x0 + 1; x <= r.x1 - 1; x += 1.5) for (let y = r.y0 + 1; y <= r.y1 - 1; y += 1.5) {
        if (!inPoly(x, y, h.outline) || h.obstacles.some((o) => inPoly(x, y, o)) || wallNear([x, y], c.R + 0.05) || c.inCircles(x, y, h.water)) continue;
        for (const sign of [1, -1]) {
          const shot = c.simulate(h, [x, y], Math.atan2(sign * dy, sign * dx), 0.02);
          drops++;
          if (shot.result !== "stopped") continue;
          const onStrip = shot.end[0] >= r.x0 && shot.end[0] <= r.x1 && shot.end[1] >= r.y0 && shot.end[1] <= r.y1;
          if (onStrip && !wallNear(shot.end, c.R + 0.35)) resting++;
        }
      }
    }
  });
  check(belts >= 2, `the beach has belts (${belts})`);
  check(resting === 0, `no ball dropped on the arrows is left resting on them away from a wall (${resting} of ${drops})`);
}

// ------------------------------------------------------------------ hidden cups
section("a cover is knocked flat by a ball, and the cup lies shut under one that stands");
{
  const flat = (extra) => ({ outline: [[-60, -60], [60, -60], [60, 60], [-60, 60]], obstacles: [], walls: c.edges([[-60, -60], [60, -60], [60, 60], [-60, 60]]), tee: [0, 0], cup: [30, 0], par: 3, name: "flat",
    sludge: [], ice: [], props: [], boulders: [], bumpers: [], wind: [0, 0], ramps: [], tunnels: [], sand: [], water: [], solid: true, ...extra });
  const rolled = (hole, power) => c.simulate(hole, [0, 0], 0, power);
  const tree = { x: 10, y: 0, r: 1.2, kind: "palm" }, cover = { x: 10, y: 0, r: 1.2, kind: "sandcastle", cover: true };
  const a = rolled(flat({ props: [tree] }), 0.8), b = rolled(flat({ props: [cover] }), 0.8);
  check(a.broke.length === 0 && b.broke.length === 1 && b.broke[0] === 0, `a palm on a solid hole stands when hit; a cover is knocked flat (palm: ${a.broke.length}, cover: ${JSON.stringify(b.broke)})`);
  // the cup lies under the cover that stands: a slow ball rolling over the spot does not drop; once the cover is gone, it does
  const lane = { cup: [10, 0], props: [{ x: 40, y: 40, r: 1.2, kind: "sandcastle", cover: true }, { x: 10, y: 0, r: 0.1, kind: "sandcastle", cover: true }], hidden: { covers: [0, 1], plain: 1 } };
  const power = c.powerForDistance(10.2);
  const shut = rolled(flat({ cup: [10, 0], props: [{ x: 40, y: 40, r: 1.2, kind: "sandcastle", cover: true }, null], cupCover: 0 }), power);
  const open = rolled(flat({ cup: [10, 0], props: [null, null], cupCover: 0 }), power);
  const never = rolled(flat({ cup: [10, 0], props: [{ x: 40, y: 40, r: 1.2, kind: "sandcastle", cover: true }, null] }), power);
  check(shut.result === "stopped" && open.result === "holed" && never.result === "holed", `the cup is shut while its cover stands, open when it is flat, and a hole with no cover is as before (${shut.result}, ${open.result}, ${never.result})`);
  void lane;
}

section("hidden-cup holes: covers, a plain variant, a cup that moves");
{
  const sets = [
    { name: "Sunny Beach", holes: beach, plains: beachPlain, kind: "sandcastle", most: 2 },
    { name: "the Meadow", holes: c.HOLES_TALL, plains: c.HOLES_TALL_PLAIN, kind: "haybale", most: 1 },   // its Chicken Run hides its cup under one of four hay bales (the Meadow's one such hole)
  ];
  for (const set of sets) {
    const hidden = set.holes.filter((h) => h.hidden);
    check(hidden.length >= 1 && hidden.length <= set.most, `${set.name} has ${set.most === 1 ? "one" : "one or two"} hidden-cup hole${set.most === 1 ? "" : "s"} (${hidden.map((h) => h.name).join(", ")})`);
    for (const h of hidden) {
      const tag = `"${h.name}"`;
      const covers = h.hidden.covers.map((k) => h.props[k]);
      check(covers.length >= 3 && covers.length <= 5 && covers.every((p) => p.cover && p.kind === set.kind), `${tag}: the cup lies under one of 3 to 5 ${set.kind === "haybale" ? "hay bales" : "sandcastles"} (${covers.length})`);
      check(h.props.filter((p) => p.cover).length === covers.length, `${tag}: every cover is listed`);
      const spots = covers.map((p) => [p.x, p.y]);
      check(spots.every((a, i) => spots.every((b, j) => i === j || Math.hypot(a[0] - b[0], a[1] - b[1]) > 2 * 1.4 + 2 * c.R + 1)), `${tag}: the covers stand far enough apart for a ball between them`);
      check(covers.every((p) => nearestWall(p.x, p.y, h) >= p.r + 2 * c.R && !c.inCircles(p.x, p.y, h.water) && !c.inCircles(p.x, p.y, h.sludge)), `${tag}: every cover has room round it and none stands in water`);
      const pl = set.plains[set.holes.indexOf(h)];
      check(!pl.hidden && pl.props.every((p) => !p.cover) && pl.props.length === h.props.length - covers.length, `${tag}: the plain variant has no covers and no hidden mark`);
      check(pl.cup[0] === h.cup[0] && pl.cup[1] === h.cup[1] && pl.cup[0] === covers[h.hidden.covers.indexOf(h.hidden.plain)].x, `${tag}: its cup is in the open at the plain cover's spot`);
      check(!c.inCircles(pl.cup[0], pl.cup[1], pl.sand), `${tag}: ...and not in the sand`);
      // a cover is hit and knocked flat from the tee, by the bot's own search, for every cover in turn (every cover can be reached); then the cup is played
      covers.forEach((cv, ci) => {
        const k = h.hidden.covers[ci];
        let at = h.tee, broken = [], strokes = 0, hit = false;
        const rand = rng(5000 + ci);
        while (strokes < capOf(h) && !hit) {
          const live = c.liveHole(h, broken, null);
          const sh = c.botShot({ ...live, cup: [cv.x, cv.y], cupCover: k }, at, 1.0, rand, { hit: k });
          const shot = c.simulate(live, at, sh.aim, sh.power);
          strokes++; at = shot.end;
          for (const j of shot.broke) if (!broken.includes(j)) broken.push(j);
          hit = broken.includes(k);
        }
        check(hit, `${tag}: cover ${ci + 1} is reached and knocked flat from the tee (${strokes} shots)`);
      });
      // the hunt: whichever cover hides the cup, a bot finds it and finishes inside the cap, never getting stuck; the cup is never in the bot's hands before it shows
      const rand = rng(77);
      let done = 0, games = 0;
      for (const k of h.hidden.covers) for (const skill of [1.0, 0.72]) for (let g = 0; g < 6; g++) {
        games++;
        let at = h.tee, broken = [], found = false, strokes = 0;
        while (strokes < capOf(h)) {
          const live = c.liveHole(h, broken, k);
          const sh = c.botPlay(h, at, skill, rand, { broken, cupCover: found ? k : null });
          const shot = c.simulate(live, at, sh.aim, sh.power);
          strokes++; at = shot.end;
          for (const j of shot.broke) if (!broken.includes(j)) broken.push(j);
          found = broken.includes(k);
          if (shot.result === "holed") { done++; break; }
        }
      }
      check(done / games >= 0.8, `${tag}: a bot that hunts the covers finishes the hole inside the cap ${done} of ${games} games, whichever cover hides the cup`);
    }
  }
}

// ------------------------------------------------------------------ over sockets
function mk(url, name) {
  const s = io(url, { transports: ["websocket"], reconnection: false, forceNew: true });
  s.nm = name; s.st = null; s.seat = -1; s.errors = []; s.states = [];
  s.on("state", (f) => { s.st = f.room; s.seat = f.mySeat; s.states.push(f.room); if (s.states.length > 4000) s.states.shift(); });
  s.on("err", (m, info) => s.errors.push(info || { message: m }));
  return s;
}
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };
const pid = () => "c" + Math.random().toString(36).slice(2, 12);
async function open(url, caps, name = "Ann") {
  const a = mk(url, name);
  await until(() => a.connected);
  a.emit("create", { name, playerId: pid(), caps });
  await until(() => a.st && a.st.code);
  return a;
}
async function join(url, code, caps, name) {
  const b = mk(url, name);
  await until(() => b.connected);
  b.emit("join", { code, name, playerId: pid(), caps });
  await until(() => b.st && b.seat >= 0);
  return b;
}
const NEW = ["windmill", "tall", "courses", "waitList"], OLD = ["windmill", "tall"], OLDEST = ["windmill"];
const jsonHas = (st, needle) => JSON.stringify(st).includes(needle);

// play through hidden-cup holes as a hunting player would, from what the state says alone, and watch every state: the cup is never sent before its cover is knocked flat
async function huntHoles(a, rooms, server, stats, holes, tag) {
  const room = [...rooms.values()].find((r) => r.code === a.st.code);
  const rand = rng(31);
  for (const hole of holes) {
    const at = a.states.length;   // every state of the hole from its first, the bump that starts it included
    room.hole = hole;
    server.__startHole(room, 0);
    server.__bump(room);
    await until(() => a.st.hole === hole && a.st.turn === 0);
    const stat = stats[hole], h = server.__hole(room);
    check(h.hidden && room.cupCover != null && h.hidden.covers.includes(room.cupCover), `${tag} hole ${hole + 1} ("${h.name}") hides its cup under one of its covers`);
    const secretIdx = room.cupCover, secret = h.props[secretIdx];   // read now: the room moves on to the next hole's cover
    const t0 = Date.now();
    while (a.st.status === "playing" && a.st.hole === hole && Date.now() - t0 < 60000) {
      if (a.st.turn === a.seat && !a.st.holeDone && !a.st.done[a.seat]) {
        const st = a.st, cupAt = st.course.cup;
        const cupCover = cupAt ? stat.props.findIndex((p) => p.cover && Math.abs(p.x - cupAt[0]) < 1e-6 && Math.abs(p.y - cupAt[1]) < 1e-6) : null;
        const sh = c.botPlay(stat, st.ball[a.seat], 0.9, rand, { broken: st.course.broken, cupCover });
        const v = st.v;
        a.emit("shoot", { aim: sh.aim, power: sh.power });
        await until(() => a.st.v > v, 3000);
      } else await sleep(10);
    }
    const seen = a.states.slice(at).filter((s) => s.hole === hole);
    const firstCup = seen.findIndex((s) => s.course.cup !== undefined);
    const early = seen.slice(0, firstCup < 0 ? seen.length : firstCup);
    check(early.length > 0 && early.every((s) => s.course.hidden === true && s.course.cup === undefined && !("cup" in s.course)), `${tag} hole ${hole + 1}: no cup in any of the ${early.length} states before its cover fell`);
    check(early.every((s) => !s.course.broken.includes(secretIdx) && !("cupCover" in s) && !("cupCover" in s.course) && !("hiddenCover" in s.course)), `${tag} hole ${hole + 1}: nothing in the state names the cover that hides the cup`);
    const blob = JSON.stringify(early.map((s) => s.course));
    check(!blob.includes('"cup"'), `${tag} hole ${hole + 1}: not one "cup" among the ${early.length} states' courses`);
    if (firstCup >= 0) {
      const s = seen[firstCup];
      check(s.course.broken.includes(secretIdx) && Math.abs(s.course.cup[0] - secret.x) < 1e-6 && Math.abs(s.course.cup[1] - secret.y) < 1e-6, `${tag} hole ${hole + 1}: the cup shows once the cover over it is flat, where that cover stood`);
    } else {
      check(false, `${tag} hole ${hole + 1}: the cup never showed`);
    }
    check(a.st.hole !== hole || a.st.holeDone || a.st.status === "over", `${tag} hole ${hole + 1}: it finishes (a round that always finishes)`);
    await until(() => a.st.hole !== hole || a.st.status === "over", 4000);
    if (a.st.status !== "playing") break;
  }
}

(async () => {
  Object.assign(process.env, { PORT: String(PORT), ROLL_REST: "0", BOT_MS: "10", HOLE_INTRO_MS: "0", HOLE_PAUSE_MS: "60", TURN_MS: "600000" });
  const server = require("../server");
  const rooms = server.__rooms;
  await sleep(500);
  const URL = `http://localhost:${PORT}`;
  const opened = [];
  const keep = (s) => { opened.push(s); return s; };
  try {
    section("the lobby: the host picks the course, nobody else does, an unknown course is ignored");
    {
      const a = keep(await open(URL, NEW));
      check(a.st.courseId === "meadow" && Array.isArray(a.st.courses) && a.st.courses.includes("meadow") && a.st.courses.includes("beach"), "a new room is on the Meadow, and the state lists the courses", `${a.st.courseId} ${JSON.stringify(a.st.courses)}`);
      const b = keep(await join(URL, a.st.code, NEW, "Bo"));
      b.emit("settings", { course: "beach" });
      await sleep(150);
      check(a.st.courseId === "meadow", "a guest cannot pick the course");
      a.emit("settings", { course: "nowhere" });
      await sleep(150);
      check(a.st.courseId === "meadow", "an unknown course is ignored");
      a.emit("settings", { course: "beach" });
      check(await until(() => a.st.courseId === "beach" && b.st.courseId === "beach"), "the host picks Sunny Beach and the guest sees it");
      // the pick is the host's even after a round: the lobby state of a finished round shows the course that was played
    }

    section("a round of apps that know courses: Sunny Beach, its own nine holes, the hidden cups hidden");
    {
      const a = keep(await open(URL, NEW));
      a.emit("settings", { course: "beach" });
      a.emit("addBot");
      await until(() => a.st.players.length === 2 && a.st.courseId === "beach");
      a.emit("start");
      await until(() => a.st.status === "playing");
      check(a.st.courseId === "beach" && a.st.tall === true && a.st.windmill === false, `the round is on the beach, long holes, no windmill (${a.st.courseId})`);
      check(JSON.stringify(a.st.course.outline) === JSON.stringify(beach[0].outline) && a.st.course.name === "Shore Break", "hole 1 is Shore Break");
      check(!a.st.course.hidden && Array.isArray(a.st.course.cup) && !a.st.course.props.some((p) => p.cover), "hole 1 hides nothing: its cup is in the state");

      await huntHoles(a, rooms, server, beach, [3, 6], "");
    }

    section("a round on the Meadow: its hay bales hide the cup of Chicken Run, and the state never says where");
    {
      const a = keep(await open(URL, NEW));
      a.emit("addBot");
      await until(() => a.st.players.length === 2);
      a.emit("start");
      await until(() => a.st.status === "playing");
      check(a.st.courseId === "meadow" && a.st.tall === true, `the round is on the Meadow's long holes (${a.st.courseId})`);
      await huntHoles(a, rooms, server, c.HOLES_TALL, [6], "the Meadow's");
    }

    section("an older app in a beach room: the long holes in the Meadow's paint, hidden cups played plain, never a missing cup");
    {
      const old = keep(await open(URL, OLD, "Old"));
      old.emit("settings", { course: "beach" });
      old.emit("addBot");
      await until(() => old.st.players.length === 2 && old.st.courseId === "beach");
      old.emit("start");
      await until(() => old.st.status === "playing");
      check(old.st.courseId === "beach" && old.st.tall === true, "a long-hole app plays the beach too");
      const room = [...rooms.values()].find((r) => r.code === old.st.code);
      check(room.hidden === false, "...with the covers down: no hidden cups for an app that cannot draw them");
      for (const hole of [0, 3, 6]) {
        room.hole = hole;
        server.__startHole(room, 0);
        server.__bump(room);
        await sleep(80);
        const s = old.st;
        check(s.hole === hole && Array.isArray(s.course.cup) && s.course.cup.length === 2 && !s.course.hidden && !s.course.props.some((p) => p.cover), `hole ${hole + 1}: the old app is sent a cup, and no covers`);
        check(JSON.stringify(s.course.outline) === JSON.stringify(beach[hole].outline) && s.course.tee.length === 2, `hole ${hole + 1}: and the beach hole's own walls`);
        check(s.course.props.every((p) => typeof p.kind === "string" && p.r > 0), `hole ${hole + 1}: every toy has a kind and a size`);
      }
      // it plays a whole round without a stuck ball: the host plays too
      const status = await new Promise((resolve) => {
        const t0 = Date.now(), iv = setInterval(() => {
          if (old.st.status === "over" || Date.now() - t0 > 40000) { clearInterval(iv); resolve(old.st.status); return; }
          if (old.st.status === "playing" && old.st.turn === 0 && !old.st.holeDone) { old.emit("shoot", { aim: 1.2, power: 0.6 }); }
        }, 40);
      });
      check(status === "over", `a round with an older app on the beach finishes (${status})`);

      const oldest = keep(await open(URL, OLDEST, "Oldest"));
      oldest.emit("settings", { course: "beach" });
      await until(() => oldest.st.courseId === "beach");
      oldest.emit("start");
      await until(() => oldest.st.status === "playing");
      check(oldest.st.courseId === "meadow" && oldest.st.tall === false, "an app that cannot draw long holes plays the Meadow's classic ones, whatever was picked");
      check(JSON.stringify(oldest.st.course.outline) === JSON.stringify(c.HOLES[0].outline), "...hole 1 of the classic Meadow");

      const mixed = keep(await open(URL, NEW, "New"));
      mixed.emit("settings", { course: "beach" });
      const mate = keep(await join(URL, mixed.st.code, OLD, "Mate"));
      await until(() => mixed.st.courseId === "beach");
      mixed.emit("start");
      await until(() => mixed.st.status === "playing");
      const mroom = [...rooms.values()].find((r) => r.code === mixed.st.code);
      check(mixed.st.courseId === "beach" && mroom.hidden === false, "a new app with an older one plays the beach with the covers down");
      void mate;
    }

    section("a hidden-cup round: an older app in the waiting line is not seated into it");
    {
      const host = keep(await open(URL, NEW, "Hana"));
      host.emit("settings", { course: "beach" });
      const mate = keep(await join(URL, host.st.code, NEW, "Mia"));
      await until(() => host.st.courseId === "beach");
      host.emit("start");
      await until(() => host.st.status === "playing");
      const hroom = [...rooms.values()].find((r) => r.code === host.st.code);
      check(hroom.hidden === true, "a room of apps that know courses has its covers up");
      const late = keep(await join(URL, host.st.code, ["windmill", "tall", "waitList"], "Lee"));
      await until(() => late.st && late.st.waitPos === 1);
      mate.emit("leave");
      await sleep(300);
      check(host.st.players.filter((p) => !p.left).length === 1 && late.st.waitPos === 1, "the seat the leaver left stays empty: an app that cannot draw covers keeps waiting");
    }

    section("an older app on the Meadow's Chicken Run: the hay bales are down and its cup stands in the open");
    {
      const old = keep(await open(URL, OLD, "Old"));
      old.emit("addBot");
      await until(() => old.st.players.length === 2);
      old.emit("start");
      await until(() => old.st.status === "playing");
      const room = [...rooms.values()].find((r) => r.code === old.st.code);
      check(room.hidden === false && old.st.courseId === "meadow", "an app that cannot draw covers plays the Meadow with them down");
      room.hole = 6;
      server.__startHole(room, 0);
      server.__bump(room);
      await sleep(80);
      const st = old.st;
      check(st.hole === 6 && Array.isArray(st.course.cup) && st.course.cup.length === 2 && !st.course.hidden && !st.course.props.some((p) => p.cover), "hole 7: the old app is sent a cup, and no bales");
      check(JSON.stringify(st.course.outline) === JSON.stringify(c.HOLES_TALL[6].outline) && st.course.props.every((p) => typeof p.kind === "string" && p.r > 0), "...and the hole's own walls and toys");
    }

    section("the Meadow as it was: no courses cap, no pick, the same holes and the same state");
    {
      const m = keep(await open(URL, OLD, "Meadow"));
      m.emit("start");
      await until(() => m.st.status === "playing");
      check(m.st.courseId === "meadow" && JSON.stringify(m.st.course.outline) === JSON.stringify(c.HOLES_TALL[0].outline), "a room that never picked plays the Meadow's long hole 1");
      check(!m.st.course.hidden && Array.isArray(m.st.course.cup), "...with its cup in the state");
    }
  } finally {
    for (const s of opened) try { s.close(); } catch (_) {}
  }
  console.log(failed ? `\ncourses: ${failed} failed\n` : "\ncourses: all good\n");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
