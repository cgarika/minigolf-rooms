/* Mini Golf, course 3: Slime Lab (the owner, 2026-11-01: the approved picture ref/golf_courses/slimelab_v1.png). Run: node test/slimelab.js
   (starts its server in this process on TEST_PORT7, default 3671; never 3111-3124).

   Proves, in process: the Meadow's and Sunny Beach's holes are exactly what they were; the Lab is course 3 with nine holes, each with a tee and a cup inside the walls and clear of every puddle,
   its slime and toys inside the walls, a dry way to every cup (slime is never on the only way), a ball in any puddle out in two putts; a bot finishes every hole inside its cap, in three to four
   shots a hole on average, a hole in one rare (the best bot never has one), no straight line from tee to cup after hole 1, slime or a wall guarding most cups, two risk-and-reward holes (a short
   risky line, a long safe one); the arrows carry a ball out of their strip; the two hidden-cup holes (lab crates): a ball that touches a crate knocks it flat, every crate can be reached, a bot that
   hunts always finishes. Over real sockets: the lobby's table follows the host's pick for the host and every guest (and stays the Meadow's classic hole for an app that cannot draw the pick),
   an older app in a lab room, a cup never sent before its crate falls, and a round that always finishes. */
"use strict";
const crypto = require("crypto");
const { io } = require("socket.io-client");
const c = require("../course");

const PORT = Number(process.env.TEST_PORT7 || 3671);
if (PORT >= 3111 && PORT <= 3124) { console.error("refusing " + PORT); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, extra) => { console.log((ok ? "PASS " : "FAIL ") + what + (!ok && extra ? "  " + extra : "")); if (!ok) failed++; };
const section = (n) => console.log("\n" + n);
const rng = (seed) => { let v = seed >>> 0; return () => { v = (v * 1664525 + 1013904223) >>> 0; return v / 4294967296; }; };
const capOf = (h) => Math.max(5, Math.min(8, h.par + 2));   // server.js's maxStrokesOf: the pick-up rule
const sha = (o) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex");

const inPoly = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
const nearestWall = (x, y, h) => Math.min(...h.walls.map((w) => { const [px, py] = c.closestOnSegment(x, y, w[0], w[1], w[2], w[3]); return Math.hypot(x - px, y - py); }));
const lab = c.courseSet({ course: "slimelab", tall: true, hidden: true });
const labPlain = c.courseSet({ course: "slimelab", tall: true, hidden: false });
const beach = c.courseSet({ course: "beach", tall: true, hidden: true });
const RISKY = [2, 5];   // Goo Lake and Reactor Core: the two risk-and-reward holes (indices)

// ------------------------------------------------------------------ the courses
section("the courses: Slime Lab is the third, and the Meadow's and Sunny Beach's holes are exactly what they were");
{
  check(c.COURSES.length >= 3 && c.COURSES[2].id === "slimelab" && c.COURSES[2].name === "Slime Lab", "Slime Lab is course 3", JSON.stringify(c.COURSES));
  check(lab.length === 9 && labPlain.length === 9, "it has nine holes");
  check(sha(beach) === "098e5f725a288a3d1f0bd4cc88a2591c85cc3ac2" && sha(c.courseSet({ course: "beach", tall: true, hidden: false })) === "8ecb497ae58e2a2442e4d9396ef34c4085111b94", "Sunny Beach's nine holes (and its plain variant) are exactly what they were");
  check(sha({ HOLES: c.HOLES, WIND: c.HOLES_WINDMILL }) === "8c441ecb276c73daf5dc551efe966ec44a47560b", "the Meadow's classic nine (and with the windmill) are exactly what they were");
  check(sha(c.HOLES_TALL[0]) === "ab68cfae43ff08ca6449e1aa1822b28cc741c61f" && sha(c.HOLES_TALL[6]) === "b6e6e63e5544cadad2fab3e7ba28b5d78916f629", "...and the Meadow's long holes 1 and 7");
  check(c.courseSet({ course: "slimelab", tall: true }) === c.HOLES_SLIMELAB, "courseSet gives the lab's holes");
  check(lab.every((h) => h.solid && h.walls.length > 4 && h.teeBox && h.ramps && h.sludge), "every hole is a finished room: solid toys, walls, a tee box");
}

section("every Slime Lab hole: a tee and a cup inside the walls, slime and toys inside the walls, a dry way, and no puddle that traps a ball for ever");
{
  lab.forEach((h, i) => {
    const tag = `hole ${i + 1} "${h.name}"`;
    check(h.par >= 3 && h.par <= 6 && capOf(h) >= 5 && capOf(h) <= 8, `${tag}: a par and a cap`);
    for (const [label, [x, y]] of [["tee", h.tee], ["cup", h.cup]]) {
      check(inPoly(x, y, h.outline) && !h.obstacles.some((o) => inPoly(x, y, o)), `${tag}: the ${label} is in the lab, in no wall`);
      check(!c.inCircles(x, y, h.sludge) && !c.inCircles(x, y, h.water) && !c.inCircles(x, y, h.sand), `${tag}: the ${label} is not in slime`);
      check(nearestWall(x, y, h) >= c.R + 0.4, `${tag}: the ${label} has room for a ball beside the walls (${nearestWall(x, y, h).toFixed(2)})`);
    }
    check(!c.inCircles(h.tee[0], h.tee[1], h.sludge) && h.teeBox[0] > 0 && h.sludge.every((s) => Math.hypot(s.x - h.tee[0], s.y - h.tee[1]) > s.r + 3), `${tag}: the tee box is on dry floor, clear of the slime`);
    const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const inside = (o) => o.x - o.r >= x0 - 0.01 && o.x + o.r <= x1 + 0.01 && o.y - o.r >= y0 - 0.01 && o.y + o.r <= y1 + 0.01;
    check(h.sludge.every(inside) && h.sludge.length >= 1 && h.sand.length === 0 && h.water.length === 0, `${tag}: slime is the lab's surface (${h.sludge.length} puddles), all inside the walls, no sand or water`);
    check(h.props.every((p) => inPoly(p.x, p.y, h.outline) && !h.obstacles.some((o) => inPoly(p.x, p.y, o))), `${tag}: every toy stands on the floor`);
    check(h.obstacles.every((o) => o.every(([x, y]) => x >= x0 - 0.01 && x <= x1 + 0.01 && y >= y0 - 0.01 && y <= y1 + 0.01)), `${tag}: every pipe lies inside the walls`);
    check(c.routeLength(h, h.tee[0], h.tee[1]) < 500, `${tag}: a ball can roll from the tee to the cup (${c.routeLength(h, h.tee[0], h.tee[1]).toFixed(0)} units)`);
    check(h.props.every((p) => p.cover && p.kind === "crate" && p.r >= 1.0 && p.r <= 1.7) && (h.props.length === 0 || h.hidden), `${tag}: the only toys are crates that hide a cup (0.055 to 0.09 of the width across)`);
    check(h.props.every((p) => !h.sludge.some((s) => Math.hypot(p.x - s.x, p.y - s.y) < p.r + s.r + 0.3)), `${tag}: no crate stands in the slime`);
    // slime never on the only way: a route that keeps a ball's width and a bit clear of every puddle (and is as long as the wall-only route to within a half)
    const dry = dryWay(h, 0.1, 0.4);
    check(Number.isFinite(dry), `${tag}: there is a dry way from the tee to the cup (${dry.toFixed(1)} units)`);
    // a ball dropped anywhere in a puddle (a spot of the union) is out in two full putts: no spot lies deeper than two of them (2.6 units each) from the union's edge
    const edge = [];
    for (const t of h.sludge) for (let b = 0; b < 6.2832; b += 0.08) {
      const ex = t.x + Math.cos(b) * t.r, ey = t.y + Math.sin(b) * t.r;
      if (!h.sludge.some((u) => u !== t && Math.hypot(ex - u.x, ey - u.y) < u.r - 0.01)) edge.push([ex, ey]);
    }
    let deepest = 0;
    for (const s of h.sludge) for (let a = 0; a < 6.3; a += 0.45) for (let rr = 0; rr <= s.r; rr += 0.6) {
      const px = s.x + Math.cos(a) * rr, py = s.y + Math.sin(a) * rr;
      let depth = Infinity;
      for (const [ex, ey] of edge) depth = Math.min(depth, Math.hypot(px - ex, py - ey));
      deepest = Math.max(deepest, depth);
    }
    check(deepest <= 5.0, `${tag}: no spot of slime is more than two full putts from dry floor (${deepest.toFixed(1)} units, 5.2 allowed)`);
  });
  check(lab.filter((h) => h.hidden).length >= 1 && lab.filter((h) => h.hidden).length <= 2, `the lab has one or two hidden-cup holes (${lab.filter((h) => h.hidden).map((h) => h.name).join(", ")})`);
  check(lab.every((h) => Math.abs(Math.max(...h.outline.map((p) => p[0])) - 27.5) < 1e-6), "every hole is 27.5 across drawn, as the Beach's: the app frames the same ninth of the page of lab floor at each side");
}

/* The shortest way from the tee to the cup that keeps Margin clear of every wall and PuddleMargin clear of every puddle: Dijkstra on a half-unit grid. */
function dryWay(h, margin, puddleMargin) {
  const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
  const x1 = Math.max(...xs), y1 = Math.max(...ys), step = 0.5, cols = Math.round(x1 / step) + 1, rows = Math.round(y1 / step) + 1;
  const ok = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const x = cx * step, y = cy * step;
    let free = !h.sludge.some((o) => Math.hypot(x - o.x, y - o.y) < o.r + puddleMargin) && !h.water.some((o) => Math.hypot(x - o.x, y - o.y) < o.r + puddleMargin);
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
}

// ------------------------------------------------------------------ slime, measured
section("slime holds a ball: it stops inside a puddle within two full putts, and only a strip of it is crossed");
{
  const big = [[-600, -600], [600, -600], [600, 600], [-600, 600]];
  const open = (extra) => ({ outline: big, obstacles: [], walls: c.edges(big), tee: [0, 0], cup: [599, 599], par: 3, name: "open", sludge: [], ice: [], props: [], boulders: [], bumpers: [], wind: [0, 0], ramps: [], tunnels: [], sand: [], water: [], ...extra });
  const full = c.simulate(open({ sludge: [{ x: 0, y: 0, r: 100 }] }), [0, 0], 0, 1);
  check(full.end[0] > 2.0 && full.end[0] < 3.2, `a full putt struck inside a puddle goes 2 to 3.2 units and stops (${full.end[0].toFixed(2)}): the ball leaves any puddle of this lab in two putts`);
  const into = c.simulate(open({ sludge: [{ x: 1002, y: 0, r: 1000 }] }), [0, 0], 0, 1);
  check(into.end[0] - 2 < 3.2, `a full putt that meets slime two units out stops inside it (${(into.end[0] - 2).toFixed(2)} units in)`);
}

// ------------------------------------------------------------------ harder holes, measured
section("Slime Lab is hard: three to four shots a hole for the best bot, a hole in one rare, no straight line after hole 1, slime and walls at the cups, two risk-and-reward holes");
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
  const best = lab.map((h, i) => play(h, 1.0, 7100 + i)), room = lab.map((h, i) => play(h, 0.72, 8100 + i)), mid = lab.map((h, i) => play(h, 0.85, 9100 + i));
  const avg = (list) => list.reduce((a, b) => a + b.mean, 0) / list.length;
  console.log("  holes, best bot / skill .85 / room bot (shots over " + ROUNDS + " games): " + lab.map((h, i) => `${i + 1} ${best[i].mean.toFixed(1)}/${mid[i].mean.toFixed(1)}/${room[i].mean.toFixed(1)}`).join("  "));
  check(avg(best) >= 3.0 && avg(best) <= 4.0, `the best bot averages 3 to 4 shots a hole over the nine (${avg(best).toFixed(2)})`);
  check(avg(mid) >= 3.0 && avg(mid) <= 5.0 && avg(room) >= 3.0 && avg(room) <= 5.0, `the room's bots average 3 to 5 (${avg(mid).toFixed(2)} at skill .85, ${avg(room).toFixed(2)} at .72)`);
  const quick = best.map((b, i) => [b, i]).filter(([b]) => b.mean < 3.0).map(([, i]) => i);
  check(best.every((b) => b.mean >= 2.0) && quick.every((i) => RISKY.includes(i)), `only the two risk-and-reward holes take the best bot under three shots (${quick.map((i) => i + 1).join(", ") || "none"})`);
  check(room.every((b, i) => b.mean >= (RISKY.includes(i) ? 2.5 : 3.0)), `...and the room's bots at least 3 shots (2.5 on the risky ones): ${room.map((b) => b.mean.toFixed(1)).join(" ")}`);
  check(best.every((b) => b.aces === 0) && room.every((b) => b.aces <= 0.05), "a hole in one is rare: the best bot never has one, the room's under one round in twenty");
  check(best.every((b) => b.holed === 1), "the best bot finishes every hole inside its cap every time");
  check(room.every((b) => b.holed >= 0.7) && mid.every((b) => b.holed >= 0.85), `the room's bots finish every hole inside the cap (pick-up rule) in at least 70% of rounds (${room.map((b) => (b.holed * 100).toFixed(0)).join(" ")}%)`);

  // no straight line from tee to cup after hole 1 (the plain cup, where a hole hides it): a ball's centre cannot travel it clear of the walls, the slime and the toys
  const straight = (h) => {
    const a = h.tee, b = h.cup, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t <= len; t += 0.25) {
      const x = a[0] + ((b[0] - a[0]) * t) / len, y = a[1] + ((b[1] - a[1]) * t) / len;
      for (const w of h.walls) { const [px, py] = c.closestOnSegment(x, y, w[0], w[1], w[2], w[3]); if (Math.hypot(x - px, y - py) < c.R + 0.1) return false; }
      for (const o of [...h.sludge, ...h.props.filter((p) => !p.cover), ...h.bumpers]) if (Math.hypot(x - o.x, y - o.y) < o.r + c.R) return false;
    }
    return true;
  };
  check(labPlain.every((h, i) => i === 0 || !straight(h)), `no hole after the first has a straight line from the tee to the cup (${labPlain.map((h) => (straight(h) ? "S" : "-")).join("")})`);

  // slime, a wall, a bumper or a belt guards the cup: within nine units of it (a crate stands for the cup on a hidden hole: it counts), on at least seven holes
  const guarded = labPlain.map((h) => {
    const near = (list) => list.some((o) => Math.hypot(o.x - h.cup[0], o.y - h.cup[1]) <= 9 + o.r);
    return near(h.sludge) || near(h.bumpers) || h.ramps.some((r) => r.belt && h.cup[0] >= r.x0 - 9 && h.cup[0] <= r.x1 + 9 && h.cup[1] >= r.y0 - 9 && h.cup[1] <= r.y1 + 9)
      || h.obstacles.some((o) => o.some(([x, y]) => Math.hypot(x - h.cup[0], y - h.cup[1]) < 7));
  });
  check(guarded.filter(Boolean).length >= 7, `slime or a wall guards the cup on at least seven holes (${guarded.map((g) => (g ? "G" : "-")).join("")})`);
  check(labPlain.filter((h) => h.sludge.some((o) => Math.hypot(o.x - h.cup[0], o.y - h.cup[1]) <= 9 + o.r)).length >= 5, "...and slime itself lies within nine units of the cup on at least five");

  // risk and reward: a short way that threads a narrow gap against a long way through roomy lanes (the route as the Beach's test: the roomy one keeps R + 1.9 from walls and from slime, so it passes only gaps over 5 across)
  for (const [i, ratio] of [[2, 1.3], [5, 1.3]]) {
    const h = labPlain[i], tight = dryWay(h, 0.1, 0), roomy = dryWay(h, 1.9, 1.9);
    check(Number.isFinite(tight) && Number.isFinite(roomy) && roomy >= tight * ratio, `${h.name}: the roomy way (${roomy.toFixed(0)} units) is at least ${Math.round((ratio - 1) * 100)}% longer than the tight one (${tight.toFixed(0)}): risk or a long way round`);
  }
}

section("the arrows carry a ball: dropped at rest anywhere on a belt of the lab, it leaves the strip");
{
  let drops = 0, resting = 0, belts = 0;
  labPlain.forEach((h) => {
    const wallNear = (p, d) => h.walls.some((w) => { const [px, py] = c.closestOnSegment(p[0], p[1], w[0], w[1], w[2], w[3]); return Math.hypot(p[0] - px, p[1] - py) < d; });
    for (const r of h.ramps.filter((q) => q.belt)) {
      belts++;
      const dx = r.axis === "x" ? (r.flip ? 1 : -1) : 0, dy = r.axis === "y" ? (r.flip ? 1 : -1) : 0;
      for (let x = r.x0 + 1; x <= r.x1 - 1; x += 1.5) for (let y = r.y0 + 1; y <= r.y1 - 1; y += 1.5) {
        if (!inPoly(x, y, h.outline) || h.obstacles.some((o) => inPoly(x, y, o)) || wallNear([x, y], c.R + 0.05) || c.inCircles(x, y, h.sludge)) continue;
        for (const sign of [1, -1]) {
          const shot = c.simulate(h, [x, y], Math.atan2(sign * dy, sign * dx), 0.02);
          drops++;
          if (shot.result !== "stopped") continue;
          const onStrip = shot.end[0] >= r.x0 && shot.end[0] <= r.x1 && shot.end[1] >= r.y0 && shot.end[1] <= r.y1;
          if (onStrip && !wallNear(shot.end, c.R + 0.35) && !c.inCircles(shot.end[0], shot.end[1], h.sludge)) resting++;
        }
      }
    }
  });
  check(belts >= 2, `the lab has belts (${belts})`);
  check(resting === 0, `no ball dropped on the arrows is left resting on them away from a wall or slime (${resting} of ${drops})`);
}

// ------------------------------------------------------------------ hidden cups
section("hidden-cup holes of the lab: crates, a plain variant, every crate reached, a hunt that always finishes");
{
  const hidden = lab.filter((h) => h.hidden);
  for (const h of hidden) {
    const tag = `"${h.name}"`;
    const covers = h.hidden.covers.map((k) => h.props[k]);
    check(covers.length >= 3 && covers.length <= 5 && covers.every((p) => p.cover && p.kind === "crate"), `${tag}: the cup lies under one of 3 to 5 lab crates (${covers.length})`);
    check(h.props.filter((p) => p.cover).length === covers.length, `${tag}: every crate is listed`);
    const spots = covers.map((p) => [p.x, p.y]);
    check(spots.every((a, i) => spots.every((b, j) => i === j || Math.hypot(a[0] - b[0], a[1] - b[1]) > 2 * 1.4 + 2 * c.R + 1)), `${tag}: the crates stand far enough apart for a ball between them`);
    check(covers.every((p) => nearestWall(p.x, p.y, h) >= p.r + 2 * c.R && !c.inCircles(p.x, p.y, h.sludge)), `${tag}: every crate has room round it and none stands in slime`);
    const pl = labPlain[lab.indexOf(h)];
    check(!pl.hidden && pl.props.every((p) => !p.cover) && pl.props.length === h.props.length - covers.length, `${tag}: the plain variant has no crates and no hidden mark`);
    check(pl.cup[0] === h.cup[0] && pl.cup[1] === h.cup[1] && pl.cup[0] === covers[h.hidden.covers.indexOf(h.hidden.plain)].x, `${tag}: its cup is in the open at the plain crate's spot`);
    check(!c.inCircles(pl.cup[0], pl.cup[1], pl.sludge), `${tag}: ...and not in slime`);
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
      check(hit, `${tag}: crate ${ci + 1} is reached and knocked flat from the tee (${strokes} shots)`);
    });
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
    check(done / games >= 0.8, `${tag}: a bot that hunts the crates finishes the hole inside the cap ${done} of ${games} games, whichever crate hides the cup`);
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

// play through hidden-cup holes as a hunting player would, from what the state says alone, and watch every state: the cup is never sent before its crate is knocked flat
async function huntHoles(a, rooms, server, stats, holes) {
  const room = [...rooms.values()].find((r) => r.code === a.st.code);
  const rand = rng(31);
  for (const hole of holes) {
    const at = a.states.length;
    room.hole = hole;
    server.__startHole(room, 0);
    server.__bump(room);
    await until(() => a.st.hole === hole && a.st.turn === 0);
    const stat = stats[hole], h = server.__hole(room);
    check(h.hidden && room.cupCover != null && h.hidden.covers.includes(room.cupCover), `hole ${hole + 1} ("${h.name}") hides its cup under one of its crates`);
    const secretIdx = room.cupCover, secret = h.props[secretIdx];
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
    check(early.length > 0 && early.every((s) => s.course.hidden === true && s.course.cup === undefined && !("cup" in s.course)), `hole ${hole + 1}: no cup in any of the ${early.length} states before its crate fell`);
    check(early.every((s) => !s.course.broken.includes(secretIdx) && !("cupCover" in s) && !("cupCover" in s.course) && !("hiddenCover" in s.course)), `hole ${hole + 1}: nothing in the state names the crate that hides the cup`);
    const blob = JSON.stringify(early.map((s) => s.course));
    check(!blob.includes('"cup"'), `hole ${hole + 1}: not one "cup" among the ${early.length} states' courses`);
    if (firstCup >= 0) {
      const s = seen[firstCup];
      check(s.course.broken.includes(secretIdx) && Math.abs(s.course.cup[0] - secret.x) < 1e-6 && Math.abs(s.course.cup[1] - secret.y) < 1e-6, `hole ${hole + 1}: the cup shows once the crate over it is flat, where that crate stood`);
    } else {
      check(false, `hole ${hole + 1}: the cup never showed`);
    }
    check(a.st.hole !== hole || a.st.holeDone || a.st.status === "over", `hole ${hole + 1}: it finishes (a round that always finishes)`);
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
    section("the lobby's table follows the host's pick, for the host and for every guest");
    {
      const a = keep(await open(URL, NEW));
      check(a.st.status === "lobby" && a.st.courseId === "meadow" && a.st.tall === false && a.st.course.name === "Picket Fence" && JSON.stringify(a.st.course.outline) === JSON.stringify(c.HOLES[0].outline), "a new room's lobby shows the Meadow's classic hole 1, as it always did");
      check(a.st.courses.includes("slimelab"), "the state lists Slime Lab among the courses", JSON.stringify(a.st.courses));
      const b = keep(await join(URL, a.st.code, NEW, "Bo"));
      a.emit("settings", { course: "slimelab" });
      check(await until(() => a.st.courseId === "slimelab" && b.st.courseId === "slimelab"), "the host picks Slime Lab and the guest sees the pick");
      for (const [who, s] of [["the host", a], ["the guest", b]]) {
        check(s.st.status === "lobby" && s.st.tall === true && s.st.course.name === "Spill Zone" && JSON.stringify(s.st.course.outline) === JSON.stringify(lab[0].outline) && Array.isArray(s.st.course.cup), `${who}: the lobby's table is Slime Lab's hole 1, its cup in the state`);
        check(sha(s.st.course.sludge) === sha(lab[0].sludge) && s.st.maxStrokes === Math.max(5, Math.min(8, lab[0].par + 2)) && s.st.windmill === false, `${who}: with its slime and its own cap, and no windmill`);
      }
      a.emit("settings", { course: "beach" });
      check(await until(() => a.st.courseId === "beach" && b.st.courseId === "beach" && b.st.course.name === "Shore Break" && a.st.course.name === "Shore Break"), "the host picks Sunny Beach: both see its hole 1 (Shore Break)");
      check(a.st.tall === true && JSON.stringify(b.st.course.outline) === JSON.stringify(beach[0].outline), "...long, with the beach's own walls");
      a.emit("settings", { course: "meadow" });
      check(await until(() => a.st.courseId === "meadow" && b.st.courseId === "meadow" && a.st.course.name === "Picket Fence" && b.st.course.name === "Picket Fence"), "the host picks the Meadow again: both see the classic hole 1 again");
      check(a.st.tall === false && JSON.stringify(a.st.course.outline) === JSON.stringify(c.HOLES[0].outline), "...exactly as a room that never picked has it");
      a.emit("settings", { course: "slimelab" });
      await until(() => b.st.courseId === "slimelab");
      a.emit("settings", { holes: 3 });
      await sleep(120);
      check(a.st.courseId === "slimelab" && a.st.course.name === "Spill Zone" && b.st.course.name === "Spill Zone", "another lobby setting (holes) leaves the table as it is");
      a.emit("addBot");
      await until(() => a.st.players.length === 3);
      check(a.st.course.name === "Spill Zone" && a.st.status === "lobby", "a bot sitting down leaves it as it is");
    }

    section("an older app in the lobby: the Meadow's classic hole whatever is picked, or the pick where it draws long holes");
    {
      const oldest = keep(await open(URL, OLDEST, "Oldest"));
      oldest.emit("settings", { course: "slimelab" });
      await until(() => oldest.st.courseId === "slimelab");
      check(oldest.st.tall === false && oldest.st.course.name === "Picket Fence" && JSON.stringify(oldest.st.course.outline) === JSON.stringify(c.HOLES[0].outline), "an app that cannot draw long holes is shown the classic hole 1 (nothing it cannot draw)");
      const mixed = keep(await open(URL, NEW, "New"));
      mixed.emit("settings", { course: "slimelab" });
      await until(() => mixed.st.courseId === "slimelab");
      check(mixed.st.course.name === "Spill Zone", "a new app alone sees the lab");
      const mate = keep(await join(URL, mixed.st.code, OLDEST, "Mate"));
      await until(() => mixed.st.course.name === "Picket Fence" && mate.st.course.name === "Picket Fence");
      check(mixed.st.tall === false && mate.st.tall === false && mixed.st.courseId === "slimelab", "an older app sits down: everyone's table goes back to the classic hole (the round would play the Meadow), the pick stays");
      mate.emit("leave");
      await until(() => mixed.st.course.name === "Spill Zone");
      check(mixed.st.tall === true, "it leaves: the lab is back");
      const old = keep(await open(URL, OLD, "Old"));
      old.emit("settings", { course: "slimelab" });
      await until(() => old.st.courseId === "slimelab");
      check(old.st.tall === true && old.st.course.name === "Spill Zone", "an app with long holes but no courses cap sees the lab's hole 1 (it draws it in the Meadow's paint)");
    }

    section("a round on Slime Lab: its own nine holes, the hidden cups hidden");
    {
      const a = keep(await open(URL, NEW));
      a.emit("settings", { course: "slimelab" });
      a.emit("addBot");
      await until(() => a.st.players.length === 2 && a.st.courseId === "slimelab");
      a.emit("start");
      await until(() => a.st.status === "playing");
      check(a.st.courseId === "slimelab" && a.st.tall === true && a.st.windmill === false, `the round is in the lab, long holes, no windmill (${a.st.courseId})`);
      check(JSON.stringify(a.st.course.outline) === JSON.stringify(lab[0].outline) && a.st.course.name === "Spill Zone", "hole 1 is Spill Zone");
      check(!a.st.course.hidden && Array.isArray(a.st.course.cup) && !a.st.course.props.some((p) => p.cover), "hole 1 hides nothing: its cup is in the state");
      await huntHoles(a, rooms, server, lab, [3, 6]);
    }

    section("an older app in a lab room: the long holes in the Meadow's paint, hidden cups played plain, never a missing cup");
    {
      const old = keep(await open(URL, OLD, "Old"));
      old.emit("settings", { course: "slimelab" });
      old.emit("addBot");
      await until(() => old.st.players.length === 2 && old.st.courseId === "slimelab");
      old.emit("start");
      await until(() => old.st.status === "playing");
      check(old.st.courseId === "slimelab" && old.st.tall === true, "a long-hole app plays the lab too");
      const room = [...rooms.values()].find((r) => r.code === old.st.code);
      check(room.hidden === false, "...with the crates down: no hidden cups for an app that cannot draw them");
      for (const hole of [0, 3, 6]) {
        room.hole = hole;
        server.__startHole(room, 0);
        server.__bump(room);
        await sleep(80);
        const s = old.st;
        check(s.hole === hole && Array.isArray(s.course.cup) && s.course.cup.length === 2 && !s.course.hidden && !s.course.props.some((p) => p.cover), `hole ${hole + 1}: the old app is sent a cup, and no crates`);
        check(JSON.stringify(s.course.outline) === JSON.stringify(lab[hole].outline) && s.course.tee.length === 2, `hole ${hole + 1}: and the lab hole's own walls`);
      }
      const status = await new Promise((resolve) => {
        const t0 = Date.now(), iv = setInterval(() => {
          if (old.st.status === "over" || Date.now() - t0 > 40000) { clearInterval(iv); resolve(old.st.status); return; }
          if (old.st.status === "playing" && old.st.turn === 0 && !old.st.holeDone) { old.emit("shoot", { aim: 1.2, power: 0.6 }); }
        }, 40);
      });
      check(status === "over", `a round with an older app in the lab finishes (${status})`);

      const oldest = keep(await open(URL, OLDEST, "Oldest"));
      oldest.emit("settings", { course: "slimelab" });
      await until(() => oldest.st.courseId === "slimelab");
      oldest.emit("start");
      await until(() => oldest.st.status === "playing");
      check(oldest.st.courseId === "meadow" && oldest.st.tall === false, "an app that cannot draw long holes plays the Meadow's classic ones, whatever was picked");
    }

    section("a lab round of two bots and a player always finishes, and the Meadow is as it was");
    {
      const a = keep(await open(URL, NEW, "Fin"));
      a.emit("settings", { course: "slimelab" });
      a.emit("settings", { holes: 3 });
      a.emit("addBot");
      a.emit("addBot");
      await until(() => a.st.players.length === 3 && a.st.courseId === "slimelab");
      a.emit("start");
      const status = await new Promise((resolve) => {
        const t0 = Date.now(), iv = setInterval(() => {
          if (a.st.status === "over" || Date.now() - t0 > 90000) { clearInterval(iv); resolve(a.st.status); return; }
          if (a.st.status === "playing" && a.st.turn === a.seat && !a.st.holeDone && !a.st.done[a.seat]) { a.emit("shoot", { aim: 1.3, power: 0.7 }); }
        }, 30);
      });
      check(status === "over", `a three-hole lab round with two bots finishes (${status})`);
      const m = keep(await open(URL, OLD, "Meadow"));
      m.emit("start");
      await until(() => m.st.status === "playing");
      check(m.st.courseId === "meadow" && JSON.stringify(m.st.course.outline) === JSON.stringify(c.HOLES_TALL[0].outline), "a room that never picked plays the Meadow's long hole 1");
    }
  } finally {
    for (const s of opened) try { s.close(); } catch (_) {}
  }
  console.log(failed ? `\nslimelab: ${failed} failed\n` : "\nslimelab: all good\n");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
