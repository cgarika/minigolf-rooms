/* Big balls and hidden holes (Plato's; the owner, 2026-09-30). A putt that meets a big
   ball knocks it rolling; it stays on the green, clear of every wall, and stays where it
   stopped. A hidden hole is a tunnel with nothing drawn over it. */
const C = require("../course");
let failed = 0;
const ok = (c, m) => { console.log((c ? "  ok " : "  FAIL: ") + m); if (!c) failed++; };

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function toEdges(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const withBalls = C.HOLES.filter((h) => h.boulders.length);
ok(withBalls.length >= 1, `holes with big balls: ${withBalls.map((h) => h.name).join(", ")}`);

for (const hole of withBalls) {
  const b = hole.boulders[0];
  // Straight at it from a little below it, firmly: it moves, the ball's path and its own line up.
  const start = [b.x, b.y - 12];
  const aim = Math.PI / 2;
  let hit = null;
  for (const da of [0, 0.02, -0.02, 0.05, -0.05]) for (const pw of [0.6, 0.8, 1.0]) {
    const s = C.simulate(hole, start, aim + da, pw);
    if (!hit && s.moved.length) hit = s;
  }
  ok(!!hit, `${hole.name}: a putt at the big ball moves it`);
  if (!hit) continue;
  const m = hit.moved[0], at = hit.boulders[m.k];
  ok(Math.hypot(at.x - b.x, at.y - b.y) > 1, `${hole.name}: it rolled ${Math.hypot(at.x - b.x, at.y - b.y).toFixed(1)} units`);
  ok(m.path.length >= hit.path.length, `${hole.name}: its path is sampled with the ball's (${m.path.length} >= ${hit.path.length})`);
  const last = m.path[m.path.length - 1];
  ok(Math.abs(last[0] - at.x) < 0.01 && Math.abs(last[1] - at.y) < 0.01, `${hole.name}: its path ends where it lies`);
  // Where it lies is where the next putt finds it.
  const moved = { ...hole, boulders: hit.boulders };
  const again = C.simulate(moved, start, aim, 0.8);
  const before = C.simulate(hole, start, aim, 0.8);
  ok(JSON.stringify(again.path) !== JSON.stringify(before.path), `${hole.name}: the next putt meets it where it stopped`);
  // A practice swing (no path) ends exactly where the recorded putt does.
  const q = C.simulate(hole, start, aim, 0.8, { record: false });
  ok(q.end[0] === before.end[0] && q.end[1] === before.end[1] && JSON.stringify(q.boulders) === JSON.stringify(before.boulders),
    `${hole.name}: a practice swing ends where the putt does`);

  // Knocked about from anywhere, a big ball never leaves the green or sinks into a wall.
  const rand = rng(4242);
  let bad = 0, moves = 0;
  let state = hole;
  for (let i = 0; i < 1500; i++) {
    const from = i % 4 === 0 ? hole.tee : [2 + rand() * 56, 2 + rand() * 94];
    if (!inPoly(from[0], from[1], hole.outline) || hole.obstacles.some((o) => inPoly(from[0], from[1], o))) continue;
    const s = C.simulate(state, from, rand() * Math.PI * 2, rand(), { record: false });
    if (s.moved.length) moves++;
    for (const p of s.boulders) {
      const clear = inPoly(p.x, p.y, hole.outline) && toEdges(p.x, p.y, hole.outline) >= p.r - 0.05
        && hole.obstacles.every((o) => !inPoly(p.x, p.y, o) && toEdges(p.x, p.y, o) >= p.r - 0.05);
      if (!clear) { bad++; if (bad <= 3) console.log(`    lies at ${p.x.toFixed(2)},${p.y.toFixed(2)}`); }
    }
    state = { ...hole, boulders: s.boulders };
  }
  ok(bad === 0, `${hole.name}: over ${moves} knocks it always lies on the green, clear of every wall (${bad} bad)`);
}

// The same on Mill Race with the windmill standing: its piers are walls too, and the sails
// stand anywhere at the strike.
{
  const hole = C.HOLES_WINDMILL[C.WINDMILL.hole];
  ok(!!hole.windmill && hole.boulders.length > 0, `${hole.name} (windmill): has its big ball`);
  const walls = hole.obstacles.concat(hole.windmill.piers);
  const rand = rng(777);
  let bad = 0, moves = 0;
  let state = hole;
  for (let i = 0; i < 1500; i++) {
    const from = i % 4 === 0 ? hole.tee : [2 + rand() * 56, 2 + rand() * 94];
    if (!inPoly(from[0], from[1], hole.outline) || walls.some((o) => inPoly(from[0], from[1], o))) continue;
    const s = C.simulate(state, from, rand() * Math.PI * 2, rand(), { record: false, wm0: rand() * Math.PI * 2 });
    if (s.moved.length) moves++;
    for (const p of s.boulders) {
      const clear = inPoly(p.x, p.y, hole.outline) && toEdges(p.x, p.y, hole.outline) >= p.r - 0.05
        && walls.every((o) => !inPoly(p.x, p.y, o) && toEdges(p.x, p.y, o) >= p.r - 0.05);
      if (!clear) { bad++; if (bad <= 3) console.log(`    lies at ${p.x.toFixed(2)},${p.y.toFixed(2)}`); }
    }
    state = { ...hole, boulders: s.boulders };
  }
  ok(moves > 20, `${hole.name} (windmill): knocked ${moves} times`);
  ok(bad === 0, `${hole.name} (windmill): over ${moves} knocks it always lies on the green, clear of every wall and pier (${bad} bad)`);
}

// Hidden holes (the owner, 2026-09-30): each lies under a prop. While the prop stands no
// putt ever drops in; knock it flat and the hole is there, and a putt can find it.
const hidden = C.HOLES.filter((h) => h.tunnels.some((t) => t.hidden));
ok(hidden.length >= 3, `holes with a hidden hole: ${hidden.map((h) => h.name).join(", ")}`);
const jumped = (s) => s.path.some((p, i) => i > 0 && Math.hypot(p[0] - s.path[i - 1][0], p[1] - s.path[i - 1][1]) > 6);
for (const hole of hidden) {
  const t = hole.tunnels.find((u) => u.hidden);
  const cover = hole.props[t.under];
  ok(!!cover && cover.x === t.ax && cover.y === t.ay && cover.r > t.r, `${hole.name}: the hole lies right under a ${cover && cover.kind}, which covers it`);
  // Putts all round the prop, from close by: it stands, so none drops in.
  let through = 0, flat = 0;
  for (let a = 0; a < 72; a++) for (const pw of [0.3, 0.5, 0.8]) {
    const from = [t.ax + Math.cos((a * Math.PI) / 36) * 12, t.ay + Math.sin((a * Math.PI) / 36) * 12];
    if (!inPoly(from[0], from[1], hole.outline) || hole.obstacles.some((o) => inPoly(from[0], from[1], o))) continue;
    const covered = { ...hole, props: hole.props.map((p, i) => (i === t.under ? p : null)) };
    const s = C.simulate(covered, from, (a * Math.PI) / 36 + Math.PI, pw);
    if (s.broke.includes(t.under)) flat++;
    // the putt that knocks the prop flat may roll on into the hole it uncovers; one that misses the prop never goes in
    if (!s.broke.includes(t.under) && jumped(s)) through++;
  }
  ok(through === 0, `${hole.name}: while the ${cover.kind} stands, no putt finds the hole (${through})`);
  ok(flat > 0, `${hole.name}: a putt at the ${cover.kind} knocks it flat (${flat} did)`);
  // Knocked flat: a putt from somewhere on the green finds the hole.
  const open = { ...hole, props: hole.props.map((p, i) => (i === t.under ? null : p)) };
  let found = null;
  for (let a = 0; a < 360 && !found; a++) for (const pw of [0.3, 0.4, 0.5, 0.8, 1]) {   // 0.8 and 1: Chicken Run's hole lies in a sand island, which brakes a putt hard now (2026-11-01)
    const from = [t.ax + Math.cos((a * Math.PI) / 180) * 10, t.ay + Math.sin((a * Math.PI) / 180) * 10];
    if (!inPoly(from[0], from[1], hole.outline) || hole.obstacles.some((o) => inPoly(from[0], from[1], o))) continue;
    const s = C.simulate(open, from, (a * Math.PI) / 180 + Math.PI, pw);
    if (jumped(s)) { found = s; break; }
  }
  ok(!!found, `${hole.name}: with the ${cover.kind} gone, a putt finds the hole`);
}

console.log(failed ? `boulders: ${failed} failure(s)` : "boulders: all good");
process.exit(failed ? 1 : 0);
