/* Shared by the course suites (volcano.js, icecave.js): a room of balls on one hole, played the way server.js plays it, in process.

   A hole is judged alone (the best bot, a ball on its own) and in a ROOM: four balls on the green at once. The other balls are solid (a putt that meets one knocks it away, into lava, off the cup's lie),
   the bots plan their putts without them (course.js botShot: practice swings do not know of them), so a hole that is a narrow lane or a room with a pool at its door is much harder with four balls
   than with one: the owner's iPad (0.295, 0.304) played Volcano hole 2 to "6 OUT" for all four seats and "3 NOT IN" for three of them, where the best bot alone needed 3.08 shots. playRoom returns each
   ball's own count, played out to its cap (par + 2, 5 to 8) whatever the others do; the best bot is put in each seat in turn, because the first to putt is knocked about by all the others.

   Not a suite: run.js starts the suites by name. */
"use strict";

const capOf = (h) => Math.max(5, Math.min(8, h.par + 2));
const rng = (seed) => { let v = seed >>> 0; return () => { v = (v * 1664525 + 1013904223) >>> 0; return v / 4294967296; }; };

function playRoom(c, h, skills, rand) {
  const n = skills.length, cap = capOf(h);
  const ball = skills.map(() => h.tee.slice()), lie = skills.map(() => h.tee.slice());
  const strokes = skills.map(() => 0), done = skills.map(() => false), out = skills.map(() => false), placed = skills.map(() => false);
  let broken = [], boulders = (h.boulders || []).map((b) => ({ x: b.x, y: b.y, r: b.r }));
  const cupCover = h.hidden ? h.hidden.covers[Math.floor(rand() * h.hidden.covers.length)] : null;
  let found = false, turn = 0, shots = 0, lava = 0;
  while (!done.every(Boolean) && shots < 200) {
    const s = turn, vt0 = rand() * c.VENT_PERIOD;
    let live = c.liveHole(h, broken, cupCover);
    if (h.boulders && h.boulders.length) live = { ...live, boulders };
    const sh = c.botPlay(h, ball[s], skills[s], rand, { broken, cupCover: found ? cupCover : null, vt0 });
    const others = [];
    for (let k = 0; k < n; k++) { if (k === s || done[k]) continue; if (!(placed[k] || strokes[k] > 0)) continue; others.push({ x: ball[k][0], y: ball[k][1], seat: k, lie: lie[k] || ball[k] }); }
    const shot = c.simulate(live, ball[s], sh.aim, sh.power, { vt0, others });
    shots++;
    for (const k of shot.broke || []) if (!broken.includes(k)) broken.push(k);
    if (cupCover != null && broken.includes(cupCover)) found = true;
    if (shot.boulders) boulders = shot.boulders;
    strokes[s]++; lie[s] = ball[s].slice(); ball[s] = shot.end; placed[s] = true;
    for (const kb of shot.knock || []) { ball[kb.seat] = kb.end; if (kb.result === "water") lava++; if (kb.result === "holed" && !done[kb.seat]) done[kb.seat] = true; }
    if (shot.result === "holed") done[s] = true; else if (strokes[s] >= cap) { done[s] = true; out[s] = true; }
    const act = done.map((d, k) => (d ? -1 : k)).filter((k) => k >= 0);
    if (!act.length) break;
    const after = act.filter((k) => k > turn);
    turn = after.length ? after[0] : act[0];
  }
  return { strokes, out, lava };
}

/* The best bot (skill 1) and three room bots (.72), the best bot in each seat in turn: `rooms` rooms in all. */
function measureRoom(c, h, rooms, seed) {
  const rand = rng(seed);
  const SKILLS = [1, 0.72, 0.72, 0.72];
  let bestSum = 0, bestHoled = 0, roomSum = 0, roomHoled = 0, lava = 0, nobody = 0, n = 0;
  for (let rot = 0; rot < 4; rot++) {
    const skills = SKILLS.map((_, k) => SKILLS[(k + rot) % 4]);
    const best = skills.indexOf(1);
    for (let r = 0; r < Math.ceil(rooms / 4); r++) {
      const g = playRoom(c, h, skills, rand); n++;
      g.strokes.forEach((x, s) => { if (s === best) { bestSum += x; if (!g.out[s]) bestHoled++; } else { roomSum += x; if (!g.out[s]) roomHoled++; } });
      lava += g.lava; if (g.out.every(Boolean)) nobody++;
    }
  }
  return { best: bestSum / n, bestHoled: bestHoled / n, room: roomSum / (3 * n), roomHoled: roomHoled / (3 * n), lava: lava / n, nobody: nobody / n, rooms: n };
}

module.exports = { capOf, rng, playRoom, measureRoom };
