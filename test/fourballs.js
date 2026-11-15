/* Four balls on the green, every long hole of every course (2026-11-13, polish r4). Run: node test/fourballs.js (in process, no server).

   The pick-up rule is MAX = par + 2 (server.js's maxStrokesOf, 5 to 8): a hole's par must hold for the best bot with four balls on the green, not only alone, or a room's
   good players are picked up before they are in. The lead's table (golf E, GE1) found The Funnel and Conveyor Belts (the Meadow's long holes 2 and 3), Palm Bend (Sunny
   Beach 2) and the Caldera (Volcano 6) over it with four balls, and this suite found Crystal Island (Ice Cave 6) too: each is par 5 now (MAX 7). For every hole the best bot,
   put in each seat in turn among three room bots (test/rooms.js's measureRoom, seeded, so the numbers are the same every run), needs at most its par on average, and most of
   its balls get in.

   ROOMS (default 40) sets how many rooms a hole is played in; FOURBALLS_ONLY=meadow2,beach2 limits the run to those holes. */
"use strict";
const c = require("../course");
const { measureRoom, capOf } = require("./rooms");

const ROOMS = Number(process.env.ROOMS || 40);
const ONLY = process.env.FOURBALLS_ONLY ? process.env.FOURBALLS_ONLY.split(",") : null;
let failed = 0, ran = 0;
const check = (ok, what) => { console.log((ok ? "PASS " : "FAIL ") + what); if (!ok) failed++; };

const COURSES = {
  meadow: c.HOLES_TALL,
  beach: c.courseSet({ course: "beach", tall: true, hidden: true }),
  slimelab: c.courseSet({ course: "slimelab", tall: true, hidden: true }),
  icecave: c.courseSet({ course: "icecave", tall: true, hidden: true }),
  volcano: c.courseSet({ course: "volcano", tall: true, hidden: true }),
};

console.log("\nevery long hole holds its par with four balls on the green (MAX = par + 2)");
for (const [name, holes] of Object.entries(COURSES)) {
  holes.forEach((h, i) => {
    const key = `${name}${i + 1}`;
    if (ONLY && !ONLY.includes(key)) return;
    ran++;
    const m = measureRoom(c, h, ROOMS, 20261113);
    check(capOf(h) === Math.max(5, Math.min(8, h.par + 2)), `${key} ${h.name}: MAX ${capOf(h)} is par ${h.par} + 2 (5 to 8)`);
    check(m.best <= capOf(h) - 2 && m.bestHoled >= 0.85, `${key} ${h.name}: the best bot needs ${m.best.toFixed(2)} shots with four balls (par ${h.par}), ${(m.bestHoled * 100).toFixed(0)}% in`);
  });
}
// The five holes the rule moved (2026-11-13) are par 5 now.
const parOf = (holes, name) => (holes.find((h) => h.name === name) || {}).par;
check(parOf(COURSES.meadow, "The Funnel") === 5 && parOf(COURSES.meadow, "Conveyor Belts") === 5 && parOf(COURSES.beach, "Palm Bend") === 5
  && parOf(COURSES.volcano, "Caldera") === 5 && parOf(COURSES.icecave, "Crystal Island") === 5, "The Funnel, Conveyor Belts, Palm Bend, the Caldera and Crystal Island are par 5 (MAX 7)");

console.log(`\nfourballs: ${ran} holes, ${failed} failed`);
console.log(`#RESULT ${JSON.stringify({ suite: "fourballs", passed: failed === 0 ? 1 : 0, failed })}`);
process.exit(failed ? 1 : 0);
