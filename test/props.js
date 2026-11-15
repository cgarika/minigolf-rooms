/* Props on the green (Plato's trees, houses and birds; the owner, 2026-09-30): a ball that hits one
   bounces off and knocks it out; a prop already knocked out (a null) is no longer there. */
const C = require("../course");
let failed = 0;
const ok = (c, m) => { console.log((c ? "  ok " : "  FAIL: ") + m); if (!c) failed++; };
const hole = C.HOLES.find((h) => h.props && h.props.length);
ok(!!hole, `a hole has props (${hole && hole.name})`);
const p = hole.props[0];
// Aim from the tee straight at the first prop, firmly.
const aim = Math.atan2(p.y - hole.tee[1], p.x - hole.tee[0]);
const hit = C.simulate(hole, hole.tee, aim, 0.8);
ok(hit.broke.includes(0), `a putt at the ${p.kind} knocks it out (broke ${JSON.stringify(hit.broke)})`);
const gone = { ...hole, props: hole.props.map((q, i) => (i === 0 ? null : q)) };
const again = C.simulate(gone, hole.tee, aim, 0.8);
ok(!again.broke.includes(0), "once knocked out it is not there to hit again");
ok(JSON.stringify(again.end) !== JSON.stringify(hit.end), "and the ball runs on where the prop stood");
console.log(failed ? `props: ${failed} failure(s)` : "props: all good");
process.exit(failed ? 1 : 0);
