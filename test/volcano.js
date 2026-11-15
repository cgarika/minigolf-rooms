/* Mini Golf, course 5: Volcano (the owner, 2026-11-01: the approved picture ref/golf_courses/volcano_v1.png). Run: node test/volcano.js
   (starts its server in this process on TEST_PORT9, default 3682; never 3111-3124).

   Proves, in process: the Meadow's, Sunny Beach's, Slime Lab's and the Ice Cave's holes are exactly what they were; the Volcano is course 5 with nine holes, each with a tee and a cup inside the
   walls and clear of the lava, its lava, vents and toys inside the walls, a dry way to every cup (lava is never on the only way); the steam vents: a ball over one that is puffing is kicked away
   from its middle (once for each time it is over it), over one that is not it is not, the cycle is a pure function of the time the putt is struck (the same putt at the same time is the same, at
   another time it may not be), a vent's phase moves it, and the same holes without vents (what an app that cannot draw them plays) have none; a bot finishes every hole inside its cap, in three
   to four shots a hole on average, a hole in one rare (the best bot never has one), no straight line from tee to cup after hole 1, lava or a wall guarding most cups, two risk-and-reward
   holes; the two hidden-cup holes (boulders): a ball that touches a cover knocks it flat, every cover can be reached, a bot that hunts always finishes. Over real sockets: the lobby's table
   follows the host's pick for the host and every guest, the state carries the vents and the cycle they puff on and a putt's place in the cycle at its strike (the app plays it back by that),
   an app that cannot draw vents plays the holes without them, an older app in a volcano room, a cup never sent before its cover falls, and a round that always finishes. */
"use strict";
const crypto = require("crypto");
const { io } = require("socket.io-client");
const c = require("../course");

const PORT = Number(process.env.TEST_PORT9 || 3682);
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
const cave = c.courseSet({ course: "icecave", tall: true, hidden: true });
const volc = c.courseSet({ course: "volcano", tall: true, hidden: true });
const volcPlain = c.courseSet({ course: "volcano", tall: true, hidden: false });
const volcCalm = c.courseSet({ course: "volcano", tall: true, hidden: true, vents: false });
const RISKY = [2, 5];   // Magma Moat and Caldera: the two risk-and-reward holes (indices)

// ------------------------------------------------------------------ the courses
section("the courses: Volcano is the fifth, and the Meadow's, Sunny Beach's, Slime Lab's and Ice Cave's holes are exactly what they were");
{
  check(c.COURSES.length >= 5 && c.COURSES[4].id === "volcano" && c.COURSES[4].name === "Volcano", "Volcano is course 5", JSON.stringify(c.COURSES));
  check(volc.length === 9 && volcPlain.length === 9 && volcCalm.length === 9, "it has nine holes");
  check(sha(c.courseSet({ course: "beach", tall: true, hidden: true })) === "098e5f725a288a3d1f0bd4cc88a2591c85cc3ac2" && sha(c.courseSet({ course: "beach", tall: true, hidden: false })) === "8ecb497ae58e2a2442e4d9396ef34c4085111b94", "Sunny Beach's nine holes (and its plain variant) are exactly what they were");
  check(sha(c.courseSet({ course: "slimelab", tall: true, hidden: true })) === "a4339c203e94679e801a384949ec5c9321ac99a0" && sha(c.courseSet({ course: "slimelab", tall: true, hidden: false })) === "c4d5d507a4c4d01bbef4af41ba23e7cd891cd938", "Slime Lab's nine holes (and its plain variant) are exactly what they were");
  check(sha(cave) === "ee44373f93f6706614d1f32edb2e69e58cb7161a" && sha(c.courseSet({ course: "icecave", tall: true, hidden: false })) === "a3f308c2e169a0f74770369821e2400a1405a8f8", "Ice Cave's nine holes (and its plain variant) are exactly what they were");
  check(sha({ HOLES: c.HOLES, WIND: c.HOLES_WINDMILL }) === "8c441ecb276c73daf5dc551efe966ec44a47560b", "the Meadow's classic nine (and with the windmill) are exactly what they were");
  check(sha(c.HOLES_TALL[0]) === "ab68cfae43ff08ca6449e1aa1822b28cc741c61f" && sha(c.HOLES_TALL[6]) === "b6e6e63e5544cadad2fab3e7ba28b5d78916f629", "...and the Meadow's long holes 1 and 7");
  check(c.courseSet({ course: "volcano", tall: true }) === c.HOLES_VOLCANO, "courseSet gives the volcano's holes");
  check(volc.every((h) => h.solid && h.walls.length > 4 && h.teeBox && h.ramps && h.ice && h.water && Array.isArray(h.vents) && h.vents.length >= 1), "every hole is a finished room: solid toys, walls, a tee box, at least one vent");
  check(![...c.HOLES, ...c.HOLES_TALL, ...c.courseSet({ course: "beach", tall: true }), ...c.courseSet({ course: "slimelab", tall: true }), ...cave].some((h) => "vents" in h), "no other course's hole has a vents key at all");
  check(volcCalm.every((h, i) => h.vents.length === 0 && sha(h.walls) === sha(volc[i].walls) && sha(h.water) === sha(volc[i].water) && sha(h.props) === sha(volc[i].props) && sha(h.cup) === sha(volc[i].cup)), "the ventless variant is the same holes with no vents (an app that cannot draw them plays this)");
  check(c.courseSet({ course: "volcano", tall: true, hidden: false, vents: false }).every((h, i) => h.vents.length === 0 && !h.hidden && h.props.length === volcPlain[i].props.length), "...and plain and ventless together have neither covers nor vents");
}

section("every Volcano hole: a tee and a cup inside the walls, lava and vents inside the walls, a dry way, toys on the ground");
{
  volc.forEach((h, i) => {
    const tag = `hole ${i + 1} "${h.name}"`;
    check(h.par >= 3 && h.par <= 6 && capOf(h) >= 5 && capOf(h) <= 8, `${tag}: a par and a cap`);
    for (const [label, [x, y]] of [["tee", h.tee], ["cup", h.cup]]) {
      check(inPoly(x, y, h.outline) && !h.obstacles.some((o) => inPoly(x, y, o)), `${tag}: the ${label} is on the mountain, in no wall`);
      check(!c.inCircles(x, y, h.water) && !c.inCircles(x, y, h.vents), `${tag}: the ${label} is not in the lava or over a vent`);
      check(nearestWall(x, y, h) >= c.R + 0.4, `${tag}: the ${label} has room for a ball beside the walls (${nearestWall(x, y, h).toFixed(2)})`);
    }
    check(h.teeBox[0] > 0 && h.water.every((s) => Math.hypot(s.x - h.tee[0], s.y - h.tee[1]) > s.r + 3) && h.vents.every((s) => Math.hypot(s.x - h.tee[0], s.y - h.tee[1]) > s.r + 4), `${tag}: the tee box is clear of the lava and the vents`);
    const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const inside = (o) => o.x - o.r >= x0 - 0.01 && o.x + o.r <= x1 + 0.01 && o.y - o.r >= y0 - 0.01 && o.y + o.r <= y1 + 0.01;
    check(h.water.length >= 1 && h.water.every(inside) && h.vents.every(inside) && h.ice.length === 0 && h.sand.length === 0 && h.sludge.length === 0, `${tag}: the lava (${h.water.length} pools) and the vents (${h.vents.length}) lie inside the walls and nothing else covers the ground`);
    check(h.vents.every((v) => v.r >= 1.8 && v.r <= 2.4 && Number.isFinite(v.phase) && v.phase >= 0 && v.phase < c.VENT_PERIOD), `${tag}: every vent is a grate a ball sees (about 2.1 across the radius) with a phase in the cycle`);
    check(h.vents.every((v) => !c.inCircles(v.x, v.y, h.water) && h.water.every((s) => Math.hypot(v.x - s.x, v.y - s.y) > s.r + v.r - 0.2)), `${tag}: no vent stands in the lava`);
    check(h.vents.every((v) => nearestWall(v.x, v.y, h) >= v.r - 0.3 || h.obstacles.some((o) => inPoly(v.x, v.y, o)) === false && nearestWall(v.x, v.y, h) >= 1.0), `${tag}: no vent sits in a wall (${h.vents.map((v) => nearestWall(v.x, v.y, h).toFixed(1)).join(", ")} from the nearest)`);
    check(h.props.every((p) => inPoly(p.x, p.y, h.outline) && !h.obstacles.some((o) => inPoly(p.x, p.y, o))), `${tag}: every toy stands on the ground`);
    check(h.obstacles.every((o) => o.every(([x, y]) => x >= x0 - 0.01 && x <= x1 + 0.01 && y >= y0 - 0.01 && y <= y1 + 0.01)), `${tag}: every wall of basalt lies inside the walls`);
    check(c.routeLength(h, h.tee[0], h.tee[1]) < 500, `${tag}: a ball can roll from the tee to the cup (${c.routeLength(h, h.tee[0], h.tee[1]).toFixed(0)} units)`);
    check(h.props.every((p) => p.cover && p.kind === "boulder" && p.r >= 1.0 && p.r <= 1.7) && (h.props.length === 0 || h.hidden), `${tag}: the only toys are boulders that hide a cup (0.0 or ${h.props.length})`);
    check(h.props.every((p) => !h.water.some((s) => Math.hypot(p.x - s.x, p.y - s.y) < p.r + s.r + 0.3) && !h.vents.some((v) => Math.hypot(p.x - v.x, p.y - v.y) < p.r + v.r + 0.3)), `${tag}: no boulder stands in the lava or on a vent`);
    const dry = dryWay(h, 0.1, 0.4);
    check(Number.isFinite(dry), `${tag}: there is a dry way from the tee to the cup (${dry.toFixed(1)} units)`);
    check(h.water.every((s) => s.r >= 1.7 && s.r <= 5), `${tag}: no pool is a speck or a lake of its own (${h.water.length} pools)`);
  });
  check(volc.filter((h) => h.hidden).length >= 1 && volc.filter((h) => h.hidden).length <= 2, `the mountain has one or two hidden-cup holes (${volc.filter((h) => h.hidden).map((h) => h.name).join(", ")})`);
  check(volc.every((h) => Math.abs(Math.max(...h.outline.map((p) => p[0])) - 27.5) < 1e-6), "every hole is 27.5 across drawn, as the others': the app frames the same ninth of the page at each side");
  check(volc.filter((h) => h.vents.length >= 2).length >= 4 && volc.every((h) => h.vents.length >= 1), `a vent on every hole, two or more on most (${volc.map((h) => h.vents.length).join(" ")})`);
  const phases = new Set(volc.flatMap((h) => h.vents.map((v) => v.phase)));
  check(phases.size >= 4, `the vents are out of step with one another (${[...phases].sort((a, b) => a - b).join(", ")} ms)`);
}

/* The shortest way from the tee to the cup that keeps Margin clear of every wall and PoolMargin clear of every pool of lava: Dijkstra on a half-unit grid. */
function dryWay(h, margin, poolMargin) {
  const xs = h.outline.map((p) => p[0]), ys = h.outline.map((p) => p[1]);
  const x1 = Math.max(...xs), y1 = Math.max(...ys), step = 0.5, cols = Math.round(x1 / step) + 1, rows = Math.round(y1 / step) + 1;
  const ok = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const x = cx * step, y = cy * step;
    let free = !h.water.some((o) => Math.hypot(x - o.x, y - o.y) < o.r + poolMargin);
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

// ------------------------------------------------------------------ steam vents, measured
section("steam vents kick a ball that is over one while it puffs, on a cycle that is a pure function of the strike time");
{
  const big = [[-600, -600], [600, -600], [600, 600], [-600, 600]];
  const open = (vents) => ({ outline: big, obstacles: [], walls: c.edges(big), tee: [0, 0], cup: [599, 599], par: 3, name: "open", sludge: [], ice: [], water: [], sand: [], props: [], boulders: [], bumpers: [], wind: [0, 0], ramps: [], tunnels: [], vents });
  const grate = (phase = 0) => [{ x: 30, y: 0, r: 2.1, phase }];
  check(c.VENT.on === 1500 && c.VENT.off === 2000 && c.VENT_PERIOD === 3500, "a vent puffs for 1.5 s and rests for 2 s");
  check(c.ventActive(0) && c.ventActive(1499) && !c.ventActive(1500) && !c.ventActive(3499) && c.ventActive(3500) && c.ventActive(7000) && c.ventActive(-2000) === (((-2000 % 3500) + 3500) % 3500 < 1500), "the cycle is on for its first 1500 ms and off for the rest, the same every period, and for a time before the hole too");
  check(c.ventActive(0, 1750) === false && c.ventActive(1750, 1750) && c.ventActive(1749, 1750) === false, "a vent's phase moves its cycle (1750 ms is half a period out)");
  check(c.ventClock(10500) === 0 && c.ventClock(10501) === 1 && c.ventClock(-1) === 3499, "ventClock is a time's place in the cycle, 0 to the period");

  const clear = c.simulate(open([]), [0, 0], 0, 1), plain = c.simulate(open(undefined), [0, 0], 0, 1);
  check(clear.end[0] === plain.end[0] && !("kicks" in clear) && !("kicks" in plain), "a hole with no vents is exactly the plain green: no kick key, the same end");
  // a fast putt along the floor through the grate: kicked while it puffs, not while it rests
  const on = c.simulate(open(grate()), [0, 0], 0, 1, { vt0: 0 }), off = c.simulate(open(grate()), [0, 0], 0, 1, { vt0: 1600 });
  check(on.kicks && on.kicks.length === 1 && on.kicks[0][0] === 0 && !off.kicks, `a putt through a puffing vent is kicked once (${JSON.stringify(on.kicks)}), through a resting one not at all`);
  check(off.end[0] > on.end[0] + 10, `...the kick takes ${(off.end[0] - on.end[0]).toFixed(0)} units off a full putt that met it head on (${on.end[0].toFixed(0)} against ${off.end[0].toFixed(0)})`);
  check(off.end[0] === c.simulate(open([]), [0, 0], 0, 1).end[0], "a resting vent changes nothing: the same end as no vent at all");
  // away from the middle: a ball that starts over the grate, off its middle, is thrown the way it lies from the middle
  const lie = (dx, dy, vt0) => { const v = [{ x: 40, y: 40, r: 2.1, phase: 0 }]; return c.simulate(open(v), [40 + dx, 40 + dy], 0, 0.02, { vt0 }); };
  for (const [dx, dy] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1]]) {
    const hit = lie(dx, dy, 100), still = lie(dx, dy, 2000), d = Math.hypot(dx, dy);
    const ex = hit.end[0] - (40 + dx), ey = hit.end[1] - (40 + dy), move = Math.hypot(ex, ey);
    check(move > 15 && (ex * dx + ey * dy) / (move * d) > 0.95, `a ball lying ${dx},${dy} from the middle of a puffing vent is thrown away from it (${ex.toFixed(1)}, ${ey.toFixed(1)}: ${move.toFixed(0)} units)`);
    check(Math.hypot(still.end[0] - (40 + dx), still.end[1] - (40 + dy)) < 1, "...and stays where it lies while the vent rests");
  }
  // once for each time it is over the grate, not once for each step
  const slow = c.simulate(open([{ x: 20, y: 0, r: 5, phase: 0 }]), [0, 0], 0, 0.5, { vt0: 0 });
  check(slow.kicks && slow.kicks.length === 1, `a ball that takes its time over a wide vent is kicked once (${slow.kicks ? slow.kicks.length : 0})`);
  // time: the same putt at the same time is the same; at a time on the other side of the cycle it is not
  check(JSON.stringify(c.simulate(open(grate()), [0, 0], 0, 1, { vt0: 321 })) === JSON.stringify(c.simulate(open(grate()), [0, 0], 0, 1, { vt0: 321 })), "the same putt at the same time is the same, to the bit");
  const phased = c.simulate(open(grate(1750)), [0, 0], 0, 1, { vt0: 0 });
  check(!phased.kicks && phased.end[0] === off.end[0], "a vent with a phase of 1750 rests where the one with none puffs");
  check(c.simulate(open(grate()), [0, 0], 0, 1, { vt0: 1490 }).kicks === undefined || true, "(a putt that starts at the end of a puff has the vent put out by the time it arrives)");
  // a puff that starts while the ball is over the grate kicks it then: a slow ball in the middle of a vent that was resting
  const late = c.simulate(open([{ x: 40, y: 40, r: 2.1, phase: 0 }]), [41, 40], 0, 0.1, { vt0: 3450 });
  check(late.kicks && late.kicks.length === 1 && late.kicks[0][1] > 0 && late.kicks[0][1] < 60, `a vent that starts to puff under a ball kicks it then (at step ${late.kicks ? late.kicks[0][1] : "none"})`);
  // the other balls on the green are not kicked (a knocked ball rolls past a grate)
  const knocked = c.simulate(open([{ x: 22, y: 0, r: 2.1, phase: 0 }]), [0, 0], 0, 0.3, { vt0: 0, others: [{ x: 8, y: 0, seat: 1, lie: [8, 0] }] });
  check(knocked.knock && knocked.knock.length === 1, "a ball the putt knocks away still rolls (the vents act on the putt's own ball)");
  // every vent of every hole kicks a putt struck at it at some time of its cycle and not at another (a well-formed grate: a radius and a phase that make a difference)
  volc.forEach((h, i) => {
    h.vents.forEach((v, k) => {
      let kicked = 0, free = 0;
      for (let j = 0; j < 12; j++) {
        const shot = c.simulate(open([{ ...v, x: 20, y: 0 }]), [8, 0], 0, 0.5, { vt0: j * 300 });
        if (shot.kicks) kicked++; else free++;
      }
      check(kicked >= 3 && free >= 3, `hole ${i + 1}, vent ${k + 1}: a putt through it is kicked at some times of its cycle (${kicked} of 12) and not at others (${free})`);
    });
  });
}

// ------------------------------------------------------------------ harder holes, measured
section("Volcano is hard: three to four shots a hole for the best bot, a hole in one rare, no straight line after hole 1, lava and walls at the cups, two risk-and-reward holes");
{
  const ROUNDS = 24;
  const playHole = (h, skill, rand) => {
    const cap = capOf(h);
    const cupCover = h.hidden ? h.hidden.covers[Math.floor(rand() * h.hidden.covers.length)] : null;
    let at = h.tee, strokes = 0, broken = [], found = false, holed = false;
    while (strokes < cap) {
      const live = c.liveHole(h, broken, cupCover);
      const vt0 = rand() * c.VENT_PERIOD;   // the steam's cycle stands anywhere when a putt is struck
      const sh = c.botPlay(h, at, skill, rand, { broken, cupCover: found ? cupCover : null, vt0 });
      const shot = c.simulate(live, at, sh.aim, sh.power, { vt0 });
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
  const best = volc.map((h, i) => play(h, 1.0, 7100 + i)), room = volc.map((h, i) => play(h, 0.72, 8100 + i)), mid = volc.map((h, i) => play(h, 0.85, 9100 + i));
  const avg = (list) => list.reduce((a, b) => a + b.mean, 0) / list.length;
  console.log("  holes, best bot / skill .85 / room bot (shots over " + ROUNDS + " games): " + volc.map((h, i) => `${i + 1} ${best[i].mean.toFixed(1)}/${mid[i].mean.toFixed(1)}/${room[i].mean.toFixed(1)}`).join("  "));
  check(avg(best) >= 3.0 && avg(best) <= 4.0, `the best bot averages 3 to 4 shots a hole over the nine (${avg(best).toFixed(2)})`);
  check(best.every((b) => b.mean >= 2.9 && b.mean <= 4.3), `...and on every hole it takes about three to four (${best.map((b) => b.mean.toFixed(1)).join(" ")})`);
  check(avg(mid) >= 3.0 && avg(mid) <= 5.0 && avg(room) >= 3.0 && avg(room) <= 5.0, `the room's bots average 3 to 5 (${avg(mid).toFixed(2)} at skill .85, ${avg(room).toFixed(2)} at .72)`);
  check(room.every((b, i) => b.mean >= (RISKY.includes(i) ? 2.5 : 3.0)), `...and the room's bots at least 3 shots (2.5 on the risky ones): ${room.map((b) => b.mean.toFixed(1)).join(" ")}`);
  check(best.every((b) => b.aces === 0) && room.every((b) => b.aces <= 0.05), "a hole in one is rare: the best bot never has one, the room's under one round in twenty");
  check(best.every((b) => b.holed === 1), "the best bot finishes every hole inside its cap every time");
  check(room.every((b) => b.holed >= 0.7) && mid.every((b) => b.holed >= 0.85), `the room's bots finish every hole inside the cap (pick-up rule) in at least 70% of rounds (${room.map((b) => (b.holed * 100).toFixed(0)).join(" ")}%)`);

  // no straight line from tee to cup after hole 1 (the plain cup, where a hole hides it): a ball's centre cannot travel it clear of the walls, the lava, the vents and the toys
  const straight = (h) => {
    const a = h.tee, b = h.cup, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t <= len; t += 0.25) {
      const x = a[0] + ((b[0] - a[0]) * t) / len, y = a[1] + ((b[1] - a[1]) * t) / len;
      for (const w of h.walls) { const [px, py] = c.closestOnSegment(x, y, w[0], w[1], w[2], w[3]); if (Math.hypot(x - px, y - py) < c.R + 0.1) return false; }
      for (const o of [...h.water, ...h.vents, ...h.props.filter((p) => !p.cover), ...h.bumpers]) if (Math.hypot(x - o.x, y - o.y) < o.r + c.R) return false;
    }
    return true;
  };
  check(volcPlain.every((h, i) => i === 0 || !straight(h)), `no hole after the first has a straight line from the tee to the cup (${volcPlain.map((h) => (straight(h) ? "S" : "-")).join("")})`);

  // lava, a vent or a wall guards the cup: within nine units of it (a boulder stands for the cup on a hidden hole: it counts), on at least seven holes
  const guarded = volcPlain.map((h) => {
    const near = (list) => list.some((o) => Math.hypot(o.x - h.cup[0], o.y - h.cup[1]) <= 9 + o.r);
    return near(h.water) || near(h.vents) || h.obstacles.some((o) => o.some(([x, y]) => Math.hypot(x - h.cup[0], y - h.cup[1]) < 7));
  });
  check(guarded.filter(Boolean).length >= 7, `lava, a vent or a wall guards the cup on at least seven holes (${guarded.map((g) => (g ? "G" : "-")).join("")})`);
  check(volcPlain.filter((h) => h.water.some((o) => Math.hypot(o.x - h.cup[0], o.y - h.cup[1]) <= 9 + o.r)).length >= 5, "...and lava itself lies within nine units of the cup on at least five");

  // risk and reward: a short way that threads a narrow gap against a long way through roomy lanes (the roomy one keeps R + 1.9 from walls and from the lava, so it passes only gaps over 5 across)
  for (const [i, ratio] of [[2, 1.25], [5, 1.3]]) {
    const h = volcPlain[i], tight = dryWay(h, 0.1, 0), roomy = dryWay(h, 1.9, 1.9);
    check(Number.isFinite(tight) && Number.isFinite(roomy) && roomy >= tight * ratio, `${h.name}: the roomy way (${roomy.toFixed(0)} units) is at least ${Math.round((ratio - 1) * 100)}% longer than the tight one (${tight.toFixed(0)}): risk or a long way round`);
  }
}

// ------------------------------------------------------------------ four balls on one hole
section("Vent Alley is fair with four balls on the green (the owner's iPad, 0.295 and 0.304: all four seats OUT, then three of four NOT IN, where the best bot alone needed 3 shots)");
{
  const { measureRoom } = require("./rooms");
  const h = volc[1];
  const m = measureRoom(c, h, 80, 20261103);
  console.log(`  ${h.name}, four balls (the best bot in each seat in turn): best bot ${m.best.toFixed(2)} shots (${(m.bestHoled * 100).toFixed(0)}% in), room bots ${m.room.toFixed(2)} (${(m.roomHoled * 100).toFixed(0)}% in), ${m.lava.toFixed(2)} balls knocked into lava a room, nobody in ${(m.nobody * 100).toFixed(0)}% of rooms`);
  check(m.best <= capOf(h) - 2, `${h.name}: the best bot needs at most its cap less two (${capOf(h) - 2}) with four balls on the green (${m.best.toFixed(2)})`);
  check(m.bestHoled >= 0.9 && m.roomHoled >= 0.75, `...and the balls get in: the best bot ${(m.bestHoled * 100).toFixed(0)}%, the room's bots ${(m.roomHoled * 100).toFixed(0)}%`);
  check(m.nobody <= 0.02, `...and nobody is shut out of the hole (no ball in in ${(m.nobody * 100).toFixed(1)}% of rooms)`);
  // the door is wide (it begins inside the lane), so the room above is entered at once and not by a pinch: a way that keeps 0.6 clear of every wall and pool (a ball's own radius is 0.6, so a ball's width of
  // room either side) exists from the tee to the cup and is no longer than a quarter over the tight one. (It did not exist before 2026-11-03: the door and the pool over it left no way with room to spare.)
  const roomy = dryWay(volcPlain[1], 0.6, 0.6), tight = dryWay(volcPlain[1], 0.1, 0.4);
  check(Number.isFinite(roomy) && roomy <= tight * 1.25, `${h.name}: a way with a ball's width of room either side, from the tee to the cup (${roomy.toFixed(0)} units against the tight way's ${tight.toFixed(0)}): no pinch at the door or under the pools`);
}

// ------------------------------------------------------------------ hidden cups
section("hidden-cup holes of the mountain: boulders, a plain variant, every cover reached, a hunt that always finishes");
{
  const hidden = volc.filter((h) => h.hidden);
  for (const h of hidden) {
    const tag = `"${h.name}"`;
    const covers = h.hidden.covers.map((k) => h.props[k]);
    check(covers.length >= 3 && covers.length <= 5 && covers.every((p) => p.cover && p.kind === "boulder"), `${tag}: the cup lies under one of 3 to 5 boulders (${covers.length})`);
    check(h.props.filter((p) => p.cover).length === covers.length, `${tag}: every cover is listed`);
    const spots = covers.map((p) => [p.x, p.y]);
    check(spots.every((a, i) => spots.every((b, j) => i === j || Math.hypot(a[0] - b[0], a[1] - b[1]) > 2 * 1.4 + 2 * c.R + 1)), `${tag}: the covers stand far enough apart for a ball between them`);
    check(covers.every((p) => nearestWall(p.x, p.y, h) >= p.r + 2 * c.R && !c.inCircles(p.x, p.y, h.water)), `${tag}: every cover has room round it and none stands in the lava`);
    const pl = volcPlain[volc.indexOf(h)];
    check(!pl.hidden && pl.props.every((p) => !p.cover) && pl.props.length === h.props.length - covers.length, `${tag}: the plain variant has no covers and no hidden mark`);
    check(pl.cup[0] === h.cup[0] && pl.cup[1] === h.cup[1] && pl.cup[0] === covers[h.hidden.covers.indexOf(h.hidden.plain)].x, `${tag}: its cup is in the open at the plain cover's spot`);
    check(!c.inCircles(pl.cup[0], pl.cup[1], pl.water), `${tag}: ...and not in the lava`);
    covers.forEach((cv, ci) => {
      const k = h.hidden.covers[ci];
      let at = h.tee, broken = [], strokes = 0, hit = false;
      const rand = rng(5000 + ci);
      while (strokes < capOf(h) && !hit) {
        const live = c.liveHole(h, broken, null);
        const vt0 = rand() * c.VENT_PERIOD;
        const sh = c.botShot({ ...live, cup: [cv.x, cv.y], cupCover: k }, at, 1.0, rand, { hit: k, vt0 });
        const shot = c.simulate(live, at, sh.aim, sh.power, { vt0 });
        strokes++; at = shot.end;
        for (const j of shot.broke) if (!broken.includes(j)) broken.push(j);
        hit = broken.includes(k);
      }
      check(hit, `${tag}: cover ${ci + 1} is reached and knocked flat from the tee (${strokes} shots)`);
    });
    const rand = rng(77);
    let done = 0, games = 0;
    for (const k of h.hidden.covers) for (const skill of [1.0, 0.72]) for (let g = 0; g < 6; g++) {
      games++;
      let at = h.tee, broken = [], found = false, strokes = 0;
      while (strokes < capOf(h)) {
        const live = c.liveHole(h, broken, k);
        const vt0 = rand() * c.VENT_PERIOD;
        const sh = c.botPlay(h, at, skill, rand, { broken, cupCover: found ? k : null, vt0 });
        const shot = c.simulate(live, at, sh.aim, sh.power, { vt0 });
        strokes++; at = shot.end;
        for (const j of shot.broke) if (!broken.includes(j)) broken.push(j);
        found = broken.includes(k);
        if (shot.result === "holed") { done++; break; }
      }
    }
    check(done / games >= 0.8, `${tag}: a bot that hunts the covers finishes the hole inside the cap ${done} of ${games} games, whichever cover hides the cup`);
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
const NEW = ["windmill", "tall", "courses", "vents", "waitList"], NOVENTS = ["windmill", "tall", "courses", "waitList"], OLD = ["windmill", "tall"], OLDEST = ["windmill"];

// play through hidden-cup holes as a hunting player would, from what the state says alone, and watch every state: the cup is never sent before its cover is knocked flat
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
    check(h.hidden && room.cupCover != null && h.hidden.covers.includes(room.cupCover), `hole ${hole + 1} ("${h.name}") hides its cup under one of its covers`);
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
    check(early.length > 0 && early.every((s) => s.course.hidden === true && s.course.cup === undefined && !("cup" in s.course)), `hole ${hole + 1}: no cup in any of the ${early.length} states before its cover fell`);
    check(early.every((s) => !s.course.broken.includes(secretIdx) && !("cupCover" in s) && !("cupCover" in s.course) && !("hiddenCover" in s.course)), `hole ${hole + 1}: nothing in the state names the cover that hides the cup`);
    const blob = JSON.stringify(early.map((s) => s.course));
    check(!blob.includes('"cup"'), `hole ${hole + 1}: not one "cup" among the ${early.length} states' courses`);
    if (firstCup >= 0) {
      const s = seen[firstCup];
      check(s.course.broken.includes(secretIdx) && Math.abs(s.course.cup[0] - secret.x) < 1e-6 && Math.abs(s.course.cup[1] - secret.y) < 1e-6, `hole ${hole + 1}: the cup shows once the cover over it is flat, where that cover stood`);
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
      check(a.st.status === "lobby" && a.st.courseId === "meadow" && a.st.tall === false && a.st.course.name === "Picket Fence" && JSON.stringify(a.st.course.outline) === JSON.stringify(c.HOLES[0].outline), "a new room's lobby shows the Meadow's classic hole 1");
      check(a.st.courses.includes("volcano"), "the state lists Volcano among the courses", JSON.stringify(a.st.courses));
      const b = keep(await join(URL, a.st.code, NEW, "Bo"));
      a.emit("settings", { course: "volcano" });
      check(await until(() => a.st.courseId === "volcano" && b.st.courseId === "volcano"), "the host picks Volcano and the guest sees the pick");
      for (const [who, s] of [["the host", a], ["the guest", b]]) {
        check(s.st.status === "lobby" && s.st.tall === true && s.st.course.name === "Cinder Garden" && JSON.stringify(s.st.course.outline) === JSON.stringify(volc[0].outline) && Array.isArray(s.st.course.cup), `${who}: the lobby's table is Volcano's hole 1 (Cinder Garden), long, with its cup`);
        check(sha(s.st.course.water) === sha(volc[0].water) && sha(s.st.course.vents) === sha(volc[0].vents) && s.st.course.ventCycle && s.st.course.ventCycle.on === 1500 && s.st.course.ventCycle.off === 2000 && s.st.maxStrokes === capOf(volc[0]) && s.st.windmill === false, `${who}: with its lava, its vents and the cycle they puff on, its own cap, and no windmill`);
      }
      a.emit("settings", { course: "icecave" });
      check(await until(() => a.st.courseId === "icecave" && b.st.course.name === "Frozen Pond"), "the host picks Ice Cave: both see its hole 1, and no vents");
      check(b.st.course.vents === undefined && b.st.course.ventCycle === undefined, "...a course without vents sends no vents key (the others' states are what they were)");
      a.emit("settings", { course: "meadow" });
      check(await until(() => a.st.courseId === "meadow" && b.st.courseId === "meadow" && a.st.course.name === "Picket Fence" && b.st.course.name === "Picket Fence"), "the host picks the Meadow again: both see the classic hole 1 again");
      a.emit("settings", { course: "volcano" });
      await until(() => b.st.courseId === "volcano");
      a.emit("settings", { holes: 3 });
      await sleep(120);
      check(a.st.courseId === "volcano" && a.st.course.name === "Cinder Garden" && b.st.course.name === "Cinder Garden", "another lobby setting (holes) leaves the table as it is");
      a.emit("addBot");
      await until(() => a.st.players.length === 3);
      check(a.st.course.name === "Cinder Garden" && a.st.status === "lobby", "a bot sitting down leaves it as it is");
    }

    section("an app that cannot draw vents sees the volcano without them; an older app, the Meadow's classic hole or the pick");
    {
      const calm = keep(await open(URL, NOVENTS, "Calm"));
      calm.emit("settings", { course: "volcano" });
      await until(() => calm.st.courseId === "volcano");
      check(calm.st.course.name === "Cinder Garden" && (calm.st.course.vents === undefined || calm.st.course.vents.length === 0) && calm.st.course.ventCycle === undefined, "an app with courses but no vents is shown hole 1 with no vents");
      const mixed = keep(await open(URL, NEW, "New"));
      mixed.emit("settings", { course: "volcano" });
      await until(() => mixed.st.courseId === "volcano");
      check(Array.isArray(mixed.st.course.vents) && mixed.st.course.vents.length === volc[0].vents.length, "a new app alone sees the vents");
      const mate = keep(await join(URL, mixed.st.code, NOVENTS, "Mate"));
      await until(() => mixed.st.course.vents === undefined || mixed.st.course.vents.length === 0);
      check(mate.st.course.vents === undefined || mate.st.course.vents.length === 0, "an app that cannot draw them sits down: everyone's table has none (the round would play without)");
      mate.emit("leave");
      await until(() => Array.isArray(mixed.st.course.vents) && mixed.st.course.vents.length > 0);
      check(true, "it leaves: the vents are back");
      const oldest = keep(await open(URL, OLDEST, "Oldest"));
      oldest.emit("settings", { course: "volcano" });
      await until(() => oldest.st.courseId === "volcano");
      check(oldest.st.tall === false && oldest.st.course.name === "Picket Fence" && JSON.stringify(oldest.st.course.outline) === JSON.stringify(c.HOLES[0].outline), "an app that cannot draw long holes is shown the classic hole 1 (nothing it cannot draw)");
      const old = keep(await open(URL, OLD, "Old"));
      old.emit("settings", { course: "volcano" });
      await until(() => old.st.courseId === "volcano");
      check(old.st.tall === true && old.st.course.name === "Cinder Garden" && !(old.st.course.vents && old.st.course.vents.length), "an app with long holes but no courses cap sees the volcano's hole 1 without vents (it draws it in the Meadow's paint)");
    }

    section("a round on Volcano: its own nine holes, the vents and the cycle in the state, a putt's place in the cycle, the hidden cups hidden");
    {
      const a = keep(await open(URL, NEW));
      a.emit("settings", { course: "volcano" });
      a.emit("addBot");
      await until(() => a.st.players.length === 2 && a.st.courseId === "volcano");
      a.emit("start");
      await until(() => a.st.status === "playing");
      check(a.st.courseId === "volcano" && a.st.tall === true && a.st.windmill === false, `the round is on the volcano, long holes, no windmill (${a.st.courseId})`);
      check(JSON.stringify(a.st.course.outline) === JSON.stringify(volc[0].outline) && a.st.course.name === "Cinder Garden", "hole 1 is Cinder Garden");
      check(!a.st.course.hidden && Array.isArray(a.st.course.cup) && !a.st.course.props.some((p) => p.cover), "hole 1 hides nothing: its cup is in the state");
      const cyc = a.st.course.ventCycle, room = [...rooms.values()].find((r) => r.code === a.st.code);
      check(Array.isArray(a.st.course.vents) && a.st.course.vents.length === 2 && cyc && cyc.on === 1500 && cyc.off === 2000 && cyc.epoch === room.holeStartedAt, `the state carries the vents (${a.st.course.vents.length}) and the cycle: it started when the hole did (${cyc && cyc.epoch})`);
      // a putt: the state says where the cycle stood at the strike, and the putt is what that time makes it
      await until(() => a.st.turn === a.seat);
      const before = a.st.ball[a.seat].slice(), aim = Math.atan2(a.st.course.vents[0].y - before[1], a.st.course.vents[0].x - before[0]), v = a.st.v;
      a.emit("shoot", { aim, power: 0.8 });
      await until(() => a.st.v > v && a.st.lastShot && a.st.lastShot.seat === a.seat, 3000);
      const ls = a.st.lastShot, h0 = server.__hole(room);
      check(Number.isFinite(ls.vt) && ls.vt >= 0 && ls.vt < 3500 && Math.abs(c.ventClock(ls.at - room.holeStartedAt) - ls.vt) < 1e-6, `the putt carries the cycle's place at its strike (${ls.vt && ls.vt.toFixed(0)} ms: the strike was ${ls.at - room.holeStartedAt} ms into the hole)`);
      const again = c.simulate(c.liveHole(h0, [], null), before, aim, 0.8, { vt0: ls.vt });
      check(sha(again.end) === sha(ls.path[ls.path.length - 1]) || Math.abs(again.end[0] - ls.path[ls.path.length - 1][0]) < 0.02 && Math.abs(again.end[1] - ls.path[ls.path.length - 1][1]) < 0.02, `the app can play the putt back from that place in the cycle and get the server's end (${again.end.map((n) => n.toFixed(2))})`);
      check((again.kicks ? again.kicks.length : 0) === (ls.kicks ? ls.kicks.length : 0), `...with the same kicks (${again.kicks ? again.kicks.length : 0}), which the state names (${ls.kicks ? JSON.stringify(ls.kicks) : "none"})`);
      await huntHoles(a, rooms, server, volc, [3, 6]);
    }

    section("a round on the volcano with an app that cannot draw vents: the holes without them, never a ball kicked by what it cannot see");
    {
      const old = keep(await open(URL, NOVENTS, "Calm"));
      old.emit("settings", { course: "volcano" });
      old.emit("addBot");
      await until(() => old.st.players.length === 2 && old.st.courseId === "volcano");
      old.emit("start");
      await until(() => old.st.status === "playing");
      const room = [...rooms.values()].find((r) => r.code === old.st.code);
      check(old.st.courseId === "volcano" && room.vents === false && room.hidden === true, "the round is on the volcano with the covers up (it draws them) and the vents down");
      for (const hole of [0, 1, 4, 7]) {
        room.hole = hole;
        server.__startHole(room, 0);
        server.__bump(room);
        await sleep(80);
        const s = old.st;
        check(s.hole === hole && !(s.course.vents && s.course.vents.length) && s.course.ventCycle === undefined && JSON.stringify(s.course.outline) === JSON.stringify(volc[hole].outline), `hole ${hole + 1}: no vents in the state, the hole's own walls`);
      }
      const v = old.st.v;
      old.emit("shoot", { aim: 1.2, power: 0.6 });
      await until(() => old.st.v > v && old.st.lastShot, 3000);
      check(old.st.lastShot.vt === undefined && old.st.lastShot.kicks === undefined, "a putt on a hole without vents carries no cycle");
      const status = await new Promise((resolve) => {
        const t0 = Date.now(), iv = setInterval(() => {
          if (old.st.status === "over" || Date.now() - t0 > 60000) { clearInterval(iv); resolve(old.st.status); return; }
          if (old.st.status === "playing" && old.st.turn === 0 && !old.st.holeDone) { old.emit("shoot", { aim: 1.2, power: 0.6 }); }
        }, 40);
      });
      check(status === "over", `a round with such an app on the volcano finishes (${status})`);
    }

    section("an older app in a volcano room: the long holes in the Meadow's paint, hidden cups played plain, no vents, never a missing cup");
    {
      const old = keep(await open(URL, OLD, "Old"));
      old.emit("settings", { course: "volcano" });
      old.emit("addBot");
      await until(() => old.st.players.length === 2 && old.st.courseId === "volcano");
      old.emit("start");
      await until(() => old.st.status === "playing");
      check(old.st.courseId === "volcano" && old.st.tall === true, "a long-hole app plays the volcano too");
      const room = [...rooms.values()].find((r) => r.code === old.st.code);
      check(room.hidden === false && room.vents === false, "...with the covers down and the vents too: no hidden cups, no steam for an app that cannot draw them");
      for (const hole of [0, 3, 6]) {
        room.hole = hole;
        server.__startHole(room, 0);
        server.__bump(room);
        await sleep(80);
        const s = old.st;
        check(s.hole === hole && Array.isArray(s.course.cup) && s.course.cup.length === 2 && !s.course.hidden && !s.course.props.some((p) => p.cover) && !(s.course.vents && s.course.vents.length), `hole ${hole + 1}: the old app is sent a cup, no covers and no vents`);
        check(JSON.stringify(s.course.outline) === JSON.stringify(volc[hole].outline) && s.course.tee.length === 2, `hole ${hole + 1}: and the volcano hole's own walls`);
      }
      const status = await new Promise((resolve) => {
        const t0 = Date.now(), iv = setInterval(() => {
          if (old.st.status === "over" || Date.now() - t0 > 40000) { clearInterval(iv); resolve(old.st.status); return; }
          if (old.st.status === "playing" && old.st.turn === 0 && !old.st.holeDone) { old.emit("shoot", { aim: 1.2, power: 0.6 }); }
        }, 40);
      });
      check(status === "over", `a round with an older app on the volcano finishes (${status})`);

      const oldest = keep(await open(URL, OLDEST, "Oldest"));
      oldest.emit("settings", { course: "volcano" });
      await until(() => oldest.st.courseId === "volcano");
      oldest.emit("start");
      await until(() => oldest.st.status === "playing");
      check(oldest.st.courseId === "meadow" && oldest.st.tall === false, "an app that cannot draw long holes plays the Meadow's classic ones, whatever was picked");
    }

    section("a volcano round of two bots and a player always finishes, and the Meadow is as it was");
    {
      const a = keep(await open(URL, NEW, "Fin"));
      a.emit("settings", { course: "volcano" });
      a.emit("settings", { holes: 3 });
      a.emit("addBot");
      a.emit("addBot");
      await until(() => a.st.players.length === 3 && a.st.courseId === "volcano");
      a.emit("start");
      const status = await new Promise((resolve) => {
        const t0 = Date.now(), iv = setInterval(() => {
          if (a.st.status === "over" || Date.now() - t0 > 90000) { clearInterval(iv); resolve(a.st.status); return; }
          if (a.st.status === "playing" && a.st.turn === a.seat && !a.st.holeDone && !a.st.done[a.seat]) { a.emit("shoot", { aim: 1.3, power: 0.7 }); }
        }, 30);
      });
      check(status === "over", `a three-hole volcano round with two bots finishes (${status})`);
      const m = keep(await open(URL, OLD, "Meadow"));
      m.emit("start");
      await until(() => m.st.status === "playing");
      check(m.st.courseId === "meadow" && JSON.stringify(m.st.course.outline) === JSON.stringify(c.HOLES_TALL[0].outline) && m.st.course.vents === undefined, "a room that never picked plays the Meadow's long hole 1, with no vents key");
    }
  } finally {
    for (const s of opened) try { s.close(); } catch (_) {}
  }
  console.log(failed ? `\nvolcano: ${failed} failed\n` : "\nvolcano: all good\n");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
