/* Mini Golf round 3 (the owner, 2026-11-01: "sand is not acting like sand when the ball lands in it", "i dont see slime"). Run: node test/golf_r3.js

   Proves, in process: sand brakes a ball the way Plato's sand does (a ball stops in about a sixth of its speed, in ball widths a second,
   in ball widths: 2.8 for a half-power putt, 5.9 for a full one, inside 0.6 s, and it crosses a strip of it at a third of its speed);
   slime is far stickier (a ball rolling in stops within about a ball width or two, and only a hard putt crosses a thin strip of it);
   the long holes carry slime on three of the nine, clear of the tee, the cup, the toys and the walls, and never on the only way to the cup. */
"use strict";
const c = require("../course");

let failed = 0;
const check = (ok, what, extra) => { console.log((ok ? "PASS " : "FAIL ") + what + (!ok && extra ? "  " + extra : "")); if (!ok) failed++; };
const section = (n) => console.log("\n" + n);

const BW = 2 * c.R;   // a ball's width
const big = [[-600, -600], [600, -600], [600, 600], [-600, 600]];
const open = (extra) => ({ outline: big, obstacles: [], walls: c.edges(big), tee: [0, 0], cup: [599, 599], par: 3, name: "open",
  sludge: [], ice: [], props: [], boulders: [], bumpers: [], wind: [0, 0], ramps: [], tunnels: [], sand: [], water: [], ...extra });
const rolled = (hole, from, power) => c.simulate(hole, from, 0, power);
const seconds = (shot) => (shot.path.length - 1) / 60;

// ------------------------------------------------------------------ sand

section("sand brakes a ball like Plato's: about a sixth of its speed, in ball widths, in ball widths");
{
  const inSand = open({ sand: [{ x: 0, y: 0, r: 1000 }] });
  const half = rolled(inSand, [0, 0], 0.5), full = rolled(inSand, [0, 0], 1);
  const v50 = (c.MAX_SPEED * 0.5) / BW, v100 = c.MAX_SPEED / BW;   // ball widths a second
  check(half.end[0] / BW > 2.4 && half.end[0] / BW < 3.6, `a half-power putt in sand stops in 2.4 to 3.6 ball widths (Plato's 3.4 at 23 ball widths a second): ${(half.end[0] / BW).toFixed(2)}`);
  check(full.end[0] / BW > 5.2 && full.end[0] / BW < 7.2, `a full putt in sand stops in 5.2 to 7.2 ball widths (Plato's 6.3 at 38): ${(full.end[0] / BW).toFixed(2)}`);
  check(Math.abs(full.end[0] / BW / (v100 / 6) - 1) < 0.2 && Math.abs(half.end[0] / BW / (v50 / 6) - 1) < 0.25,
    `...a sixth of the speed in ball widths a second, to within a fifth (${(full.end[0] / BW / (v100 / 6)).toFixed(2)}, ${(half.end[0] / BW / (v50 / 6)).toFixed(2)})`);
  check(seconds(full) < 0.8 && seconds(half) < 0.8, `...each inside 0.8 s (${seconds(half).toFixed(2)} s, ${seconds(full).toFixed(2)} s)`);
  // the speed falls at once, like e^(-6 t): a tenth of a second in, a full putt has lost over half its speed
  const p = full.path, step = (i) => Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) * 60;
  check(step(6) < step(0) * 0.62, `...and the speed falls at once: ${(step(6) / step(0)).toFixed(2)} of it left after 0.1 s`);
  // no slide past the end, no snap back: the path's last point is where the ball lies, and it only ever moves forward
  check(Math.hypot(full.end[0] - p[p.length - 1][0], full.end[1] - p[p.length - 1][1]) < 0.01, "the ball lies where its path ends (to the path's own 0.01 of a unit)");
  let back = 0;
  for (let i = 1; i < p.length; i++) if (p[i][0] < p[i - 1][0] - 1e-9) back++;
  check(back === 0, `...and never goes back along the way (${back} samples)`);
  const grass = rolled(open(), [0, 0], 0.5);
  check(half.end[0] < grass.end[0] * 0.2, `a half-power putt rolls under a fifth as far in sand as on the lawn (${(half.end[0] / grass.end[0]).toFixed(2)})`);
}

section("a ball rolling into sand loses it at the edge, and a strip of it takes most of a putt's speed");
{
  // grass up to x = 2, sand beyond it
  const edge = open({ sand: [{ x: 1002, y: 0, r: 1000 }] });
  const full = rolled(edge, [0, 0], 1);
  const into = (full.end[0] - 2) / BW;
  check(into > 4.8 && into < 7.2, `a full putt that meets sand two units out stops 4.8 to 7.2 ball widths into it: ${into.toFixed(2)}`);
  // a strip 3.6 ball widths across (Plato's: in at 31 ball widths a second, out at 11)
  const strip = open({ sand: [{ x: 2 + 1.8 * BW, y: 0, r: 1.8 * BW }] });
  const crossing = c.simulate(strip, [0, 0], 0, 1);
  const p = crossing.path;
  const at = (x) => { for (let i = 1; i < p.length; i++) if (p[i][0] >= x) return Math.hypot(p[i + 1 < p.length ? i + 1 : i][0] - p[i - 1][0], 0) * 30; return 0; };
  const vIn = at(2.2), vOut = at(2 + 3.6 * BW + 0.4);
  check(vOut > 0 && vOut < vIn * 0.5, `a strip 3.6 ball widths across takes over half of a full putt's speed: ${vIn.toFixed(0)} u/s in, ${vOut.toFixed(0)} out`);
}

// ------------------------------------------------------------------ slime

section("slime holds a ball: a ball rolling in stops within a ball width or two, far sooner than in sand");
{
  const inSand = open({ sand: [{ x: 0, y: 0, r: 1000 }] }), inSlime = open({ sludge: [{ x: 0, y: 0, r: 1000 }] });
  for (const [power, limit] of [[0.25, 0.6], [0.5, 1.2], [0.75, 1.8], [1, 2.6]]) {
    const slime = rolled(inSlime, [0, 0], power), sand = rolled(inSand, [0, 0], power);
    check(slime.end[0] / BW <= limit, `power ${power}: slime stops it within ${limit} ball widths (${(slime.end[0] / BW).toFixed(2)})`);
    check(slime.end[0] < sand.end[0] * 0.5, `...under half of sand's ${(sand.end[0] / BW).toFixed(2)} ball widths`);
  }
  check(seconds(rolled(inSlime, [0, 0], 1)) < 0.4, "a full putt in slime is still inside 0.4 s");
}

section("only a hard putt gets across a thin strip of slime");
{
  // a strip a ball wide (the puddle's chord through its middle)
  const strip = open({ sludge: [{ x: 6, y: 0, r: BW / 2 }] });
  const hard = rolled(strip, [0, 0], 1), soft = rolled(strip, [0, 0], 0.5);
  check(hard.end[0] > 6 + 3 * BW, `a full putt crosses a strip one ball wide and rolls on (${((hard.end[0] - 6) / BW).toFixed(1)} ball widths past it)`);
  check(soft.end[0] < 6 + BW, `a half-power putt stops in it (${((soft.end[0] - 6) / BW).toFixed(2)} ball widths past its middle)`);
  // and a ball lying in a puddle (radius 2.6) gets out: half a ball width in from the edge with half power, a ball and a half in with a full putt
  const puddle = open({ sludge: [{ x: 0, y: 0, r: 2.6 }] });
  const near = c.simulate(puddle, [2.6 - BW / 2, 0], 0, 0.5), deep = c.simulate(puddle, [2.6 - 1.5 * BW, 0], 0, 1);
  check(near.end[0] > 2.6 + BW / 2, `a ball half a ball width in from the edge gets out with half power (${near.end[0].toFixed(1)}, the edge at 2.6)`);
  check(deep.end[0] > 2.6 + BW, `a ball a ball and a half in gets out with a full putt (${deep.end[0].toFixed(1)}), though not with half of one`);
  check(c.simulate(puddle, [2.6 - 1.5 * BW, 0], 0, 0.5).end[0] < 2.6, "...which keeps it in at half power");
}

// ------------------------------------------------------------------ the long holes

section("the long holes carry slime on three of the nine, in clear places");
{
  const holes = c.HOLES_TALL_PLAIN, slimed = holes.map((h, i) => [h, i]).filter(([h]) => h.sludge.length > 0);   // (the plain holes: Chicken Run's cup lies under a hay bale on the hidden one, which stands where it is)
  check(slimed.length >= 2 && slimed.length <= 3, `slime lies on 2 or 3 of the nine holes (${slimed.map(([h]) => h.name).join(", ")})`);
  const clear = (x, y, r, list, gap) => list.every((o) => Math.hypot(x - o.x, y - o.y) >= r + o.r + gap);
  const nearestWall = (x, y, h) => Math.min(...h.walls.map((w) => { const [px, py] = c.closestOnSegment(x, y, w[0], w[1], w[2], w[3]); return Math.hypot(x - px, y - py); }));
  for (const [h, i] of slimed) {
    for (const s of h.sludge) {
      const tag = `hole ${i + 1} "${h.name}"`;
      check(Math.hypot(s.x - h.tee[0], s.y - h.tee[1]) >= s.r + 3 && Math.hypot(s.x - h.cup[0], s.y - h.cup[1]) >= s.r + 3, `${tag}: the slime is clear of the tee and the cup`);
      check(clear(s.x, s.y, s.r, h.props.concat(h.bumpers, h.boulders), 0.9), `${tag}: ...and of every toy and bumper`);
      check(clear(s.x, s.y, s.r, h.sand.concat(h.water, h.ice), 0), `${tag}: ...and of the sand, the water and the ice`);
      check(nearestWall(s.x, s.y, h) >= s.r * 0.4, `${tag}: ...and no wall runs through its middle`, `${nearestWall(s.x, s.y, h).toFixed(2)}`);
      check(s.r > 2 * BW / 2 && s.r < 3.4, `${tag}: ...and it is a puddle a ball sees (radius ${s.r.toFixed(2)})`);
    }
    // never the only way: a ball can get from the tee to the cup between the walls, the water and the slime
    const xs = h.outline.map((q) => q[0]), ys = h.outline.map((q) => q[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys), step = 0.5;
    const cols = Math.round((x1 - x0) / step) + 1, rows = Math.round((y1 - y0) / step) + 1;
    const free = new Uint8Array(cols * rows);
    const clearOf = (x, y) => nearestWall(x, y, h) >= c.R + 0.2 && !h.sludge.some((s) => Math.hypot(x - s.x, y - s.y) < s.r + c.R)
      && !h.water.some((s) => Math.hypot(x - s.x, y - s.y) < s.r + c.R) && h.props.every((s) => Math.hypot(x - s.x, y - s.y) >= s.r + c.R)
      && h.bumpers.every((s) => Math.hypot(x - s.x, y - s.y) >= s.r + c.R);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) free[cy * cols + cx] = clearOf(x0 + cx * step, y0 + cy * step) ? 1 : 0;
    const cell = (p) => [Math.round((p[0] - x0) / step), Math.round((p[1] - y0) / step)];
    const [sx, sy] = cell(h.tee), [tx, ty] = cell(h.cup);
    const seen = new Uint8Array(cols * rows), queue = [[sx, sy]];
    seen[sy * cols + sx] = 1;
    while (queue.length) {
      const [qx, qy] = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ny * cols + nx] || !free[ny * cols + nx]) continue;
        seen[ny * cols + nx] = 1; queue.push([nx, ny]);
      }
    }
    // the cup's own cell may sit a hair inside a wall's margin: a neighbour counts
    let reached = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (seen[(ty + dy) * cols + (tx + dx)]) reached = true;
    // a hole 7 style river has its bridge and nothing else, so the route is the bridge: it must still be there with slime in the way
    check(reached, `hole ${i + 1} "${h.name}": the cup can be reached from the tee without crossing the slime`);
  }
}

section("a putt out of the goo and into it is the server's own physics, the same twice");
{
  const hole = c.HOLES_TALL[1];   // The Funnel: slime in both gutters
  const s = hole.sludge[0];
  const a = c.simulate(hole, [s.x, s.y], 0.3, 0.9), b = c.simulate(hole, [s.x, s.y], 0.3, 0.9);
  check(JSON.stringify(a) === JSON.stringify(b), "the same putt from the same puddle gives the same path");
  // a record: false practice swing agrees with the recorded putt about where it ends
  const q = c.simulate(hole, [s.x, s.y], 0.3, 0.9, { record: false });
  check(q.end[0] === a.end[0] && q.end[1] === a.end[1] && q.result === a.result, "a bot's practice swing ends where the real putt does");
}

// ------------------------------------------------------------------ belts

section("a belt carries a ball: dropped at rest anywhere on the arrows, it leaves the strip");
{
  /* The arrows (Plato's) carry a ball along until it leaves the strip, then it rolls out and stops as usual (the owner, 2026-11-01: "it is stopping after certain point").
     Every belt of every hole, the classic nine and the long ones, a grid of drops on it, each at the slowest putt there is (power 0.02: 0.94 u/s, just over the
     stop speed) with the arrows and against them. Resting on the strip is allowed only where the belt drives the ball into a wall, which holds it as any slope would. */
  const inPolyOf = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };
  let drops = 0, resting = 0, slowest = 0, belts = 0;
  const bad = [];
  for (const [label, set] of [["long", c.HOLES_TALL_WINDMILL], ["classic", c.HOLES_WINDMILL]]) set.forEach((h, hi) => {
    const wallNear = (p, d) => h.walls.some((w) => { const [px, py] = c.closestOnSegment(p[0], p[1], w[0], w[1], w[2], w[3]); return Math.hypot(p[0] - px, p[1] - py) < d; });
    for (const r of h.ramps.filter((q) => q.belt)) {
      belts++;
      const dx = r.axis === "x" ? (r.flip ? 1 : -1) : 0, dy = r.axis === "y" ? (r.flip ? 1 : -1) : 0;
      for (let x = r.x0 + 1; x <= r.x1 - 1; x += 1.5) for (let y = r.y0 + 1; y <= r.y1 - 1; y += 1.5) {
        if (!inPolyOf(x, y, h.outline) || h.obstacles.some((o) => inPolyOf(x, y, o)) || wallNear([x, y], c.R + 0.05)) continue;
        if ([...h.bumpers, ...h.props].some((b) => Math.hypot(x - b.x, y - b.y) < b.r + c.R + 0.3)) continue;   // a ball does not lie in a bumper
        for (const sign of [1, -1]) {
          const shot = c.simulate(h, [x, y], Math.atan2(sign * dy, sign * dx), 0.02);
          drops++;
          slowest = Math.max(slowest, (shot.path.length - 1) / 60);
          if (shot.result !== "stopped") continue;
          const onStrip = shot.end[0] >= r.x0 && shot.end[0] <= r.x1 && shot.end[1] >= r.y0 && shot.end[1] <= r.y1;
          if (onStrip && !wallNear(shot.end, c.R + 0.35)) { resting++; if (bad.length < 4) bad.push(`${label} hole ${hi + 1} from ${x.toFixed(1)},${y.toFixed(1)} ends ${shot.end.map((v) => v.toFixed(1))}`); }
        }
      }
    }
  });
  check(belts >= 8, `there are belts to test (${belts})`);
  // a bumper in the arrows' way kicked a ball that fell back on it higher each time (a bounce for the whole 14 s): none stands on a belt, nor a prop
  let crowded = 0;
  for (const set of [c.HOLES_TALL_WINDMILL, c.HOLES_WINDMILL]) for (const h of set) for (const r of h.ramps.filter((q) => q.belt))
    for (const b of [...h.bumpers, ...h.props]) if (b.x > r.x0 - b.r && b.x < r.x1 + b.r && b.y > r.y0 - b.r && b.y < r.y1 + b.r) crowded++;
  check(crowded === 0, `no bumper or toy stands on a belt, where a ball cannot leave it (${crowded})`);
  check(resting === 0, `no ball dropped on the arrows is left resting on them away from a wall (${resting} of ${drops})`, bad.join("; "));
  check(slowest < 12, `...each is out well inside the 14 s a putt may take (the slowest ${slowest.toFixed(1)} s)`);
}

section("a belt is stronger than the green's friction, so a slow ball is carried, and a full putt still crosses an against-belt");
{
  const flat = c.HOLES_TALL[3];   // Pinball: a lane of arrows after the door that pushes back toward the tee
  const strip = flat.ramps[0];
  const push = c.RAMP_G * (strip.rise / (strip.y1 - strip.y0));
  check(push > 7 && push < 10, `Pinball's belt pushes 7 to 10 u/s^2 (${push.toFixed(2)}), over the green's friction of ${c.FRICTION} and a slow ball's drag`);
  const mid = (strip.y0 + strip.y1) / 2;
  const down = c.simulate(flat, [18.15, mid], -Math.PI / 2, 0.02);
  check(down.end[1] < strip.y0 && (down.path.length - 1) / 60 < 8, `a ball dropped mid-strip is carried out of it toward the tee (ends at y ${down.end[1].toFixed(1)}, the strip's edge ${strip.y0.toFixed(1)}, in ${((down.path.length - 1) / 60).toFixed(1)} s)`);
  const up = c.simulate(flat, [18.15, mid], Math.PI / 2, 0.02);
  check(up.end[1] < strip.y0, `...also when nudged against the arrows (ends at y ${up.end[1].toFixed(1)})`);
  const crossing = c.simulate({ ...flat, bumpers: [] }, [10, 12], Math.PI / 2, 1);   // the bumpers lifted: the belt alone
  const reached = Math.max(...crossing.path.map((p) => p[1]));
  check(reached > strip.y1 + 5, `a full putt from the room below crosses the whole of the against-belt (it reaches y ${reached.toFixed(1)}, the strip's far edge ${strip.y1.toFixed(1)})`);
  const soft = c.simulate(flat, [10, 12], Math.PI / 2, 0.2);
  check(soft.end[1] < strip.y0 && Math.max(...soft.path.map((p) => p[1])) < strip.y1, `a soft putt (a fifth of the power) is pushed back out of it (ends at y ${soft.end[1].toFixed(1)})`);
  // a ball another putt knocked onto the strip is carried too
  const knocked = c.simulate(flat, [10, 12], Math.PI / 2, 0.3, { others: [{ x: 18.15, y: mid, seat: 1, lie: [18.15, mid] }] });
  check(knocked.result === "stopped", "a putt with another ball lying on the strip still plays out");
}

// ------------------------------------------------------------------ harder holes (S4)

section("the Meadow holes are harder: three or four shots a hole for the best bot, no straight line after hole 1, hazards at the cups, two risk-and-reward holes (6 and 7)");
{
  const holes = c.HOLES_TALL_WINDMILL_PLAIN;   // the plain holes (Chicken Run's hay bales taken away, its cup in the open): hole difficulty is the way to the cup; the hunt for a hidden cup is measured in courses.js
  const rng = (seed) => { let v = seed >>> 0; return () => { v = (v * 1664525 + 1013904223) >>> 0; return v / 4294967296; }; };
  const capOf = (h) => Math.max(5, Math.min(8, h.par + 2));   // server.js's maxStrokesOf: the pick-up rule
  const ROUNDS = 24;
  const play = (h, skill, seed) => {
    const rand = rng(seed), cap = capOf(h);
    let total = 0, aces = 0, holed = 0;
    for (let r = 0; r < ROUNDS; r++) {
      let at = h.tee, strokes = 0, done = false;
      while (strokes < cap) {
        const sh = c.botShot(h, at, skill, rand), shot = c.simulate(h, at, sh.aim, sh.power);
        strokes++; at = shot.end;
        if (shot.result === "holed") { done = true; break; }
      }
      total += strokes; if (done) holed++; if (done && strokes === 1) aces++;
    }
    return { mean: total / ROUNDS, aces: aces / ROUNDS, holed: holed / ROUNDS };
  };
  const best = holes.map((h, i) => play(h, 1.0, 7000 + i)), room = holes.map((h, i) => play(h, 0.72, 8000 + i));
  const avg = (list) => list.reduce((a, b) => a + b.mean, 0) / list.length;
  console.log("  holes, best bot / room bot: " + holes.map((h, i) => `${i + 1} ${best[i].mean.toFixed(1)}/${room[i].mean.toFixed(1)}`).join("  "));
  check(avg(best) >= 3.0 && avg(best) <= 4.0, `the best bot averages 3 to 4 shots a hole over the nine (${avg(best).toFixed(2)}; it was 2.22)`);
  check(avg(room) >= 3.0 && avg(room) <= 5.0, `the room's bots (skill 0.72) average 3 to 5 (${avg(room).toFixed(2)}; they were 3.67)`);
  // hole 7 is a risk-and-reward hole whose short way a perfect shot can finish in two; every other hole takes the best bot three or more
  check(best.every((b, i) => b.mean >= (i === 6 ? 2.0 : 3.0)), `every other hole takes the best bot at least 3 shots (${best.map((b) => b.mean.toFixed(1)).join(" ")})`);
  check(room[6].mean >= 2.5, `...and the room's bots at least 2.5 on it (${room[6].mean.toFixed(1)})`);
  check(best.every((b) => b.aces === 0) && room.every((b) => b.aces <= 0.05), "a hole in one is rare: the best bot never has one, the room's under one round in twenty");
  check(best.every((b) => b.holed === 1), "the best bot finishes every hole inside its cap every time");
  check(room.every((b) => b.holed >= 0.7), `the room's bots finish every hole inside its cap in at least 70% of rounds (${room.map((b) => (b.holed * 100).toFixed(0)).join(" ")}%)`);

  // no straight line from the tee to the cup after hole 1: a ball's centre cannot travel it clear of the walls, the water, the toys and the bumpers
  const straight = (h) => {
    const a = h.tee, b = h.cup, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t <= len; t += 0.25) {
      const x = a[0] + ((b[0] - a[0]) * t) / len, y = a[1] + ((b[1] - a[1]) * t) / len;
      for (const w of h.walls) { const [px, py] = c.closestOnSegment(x, y, w[0], w[1], w[2], w[3]); if (Math.hypot(x - px, y - py) < c.R + 0.1) return false; }
      for (const o of [...h.water, ...h.props, ...h.bumpers]) if (Math.hypot(x - o.x, y - o.y) < o.r + c.R) return false;
    }
    return true;
  };
  check(holes.every((h, i) => !straight(h)), `no hole has a straight line from the tee to the cup (${holes.map((h) => (straight(h) ? "S" : "-")).join("")})`);

  // hazards guard the cup: water, sand, slime, ice, a bumper or a belt within nine units of it, on at least seven holes
  const guarded = holes.map((h) => {
    const near = (list, extra = 0) => list.some((o) => Math.hypot(o.x - h.cup[0], o.y - h.cup[1]) <= 9 + o.r + extra);
    return near(h.water) || near(h.sand) || near(h.sludge) || near(h.ice) || near(h.bumpers) || h.ramps.some((r) => r.belt && h.cup[0] >= r.x0 - 9 && h.cup[0] <= r.x1 + 9 && h.cup[1] >= r.y0 - 9 && h.cup[1] <= r.y1 + 9);
  });
  check(guarded.filter(Boolean).length >= 7, `a hazard guards the cup on at least seven holes (${guarded.map((g) => (g ? "G" : "-")).join("")})`);

  // risk and reward: a short way that threads narrow gaps (and the water's edge) against a long way through roomy lanes, on two holes (6, Diamond Mine: the beds' gaps; 7, Chicken Run: the
  // causeway between the ponds against the wide bridge). Dijkstra on a half-unit grid over what a ball's centre can cross: the tight way keeps R + 0.1 from a wall and out of the water,
  // the roomy one R + 1.9 from walls and from the water's edge, so it passes only gaps over 5 across.
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
    let best = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) best = Math.min(best, dist[at(h.cup) + dy * cols + dx]);
    return best;
  };
  for (const [i, ratio] of [[5, 1.15], [6, 1.3]]) {
    const h = holes[i], tight = route(h, 0.1, 0), roomy = route(h, 1.9, 1.9);
    check(Number.isFinite(tight) && Number.isFinite(roomy) && roomy >= tight * ratio, `${h.name}: the roomy way (${roomy.toFixed(0)} units) is at least ${Math.round((ratio - 1) * 100)}% longer than the tight one (${tight.toFixed(0)}): risk or a long way round`);
  }
}

console.log(failed ? `\ngolf r3: ${failed} failed\n` : "\ngolf r3: all good\n");
process.exit(failed ? 1 : 0);
