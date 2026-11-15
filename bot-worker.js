/* Mini Golf — one bot-thinking worker (see bots.js). It answers "which putt would a bot
   play from here?" and nothing else: it holds no rooms and decides no results. */

"use strict";
const { parentPort } = require("worker_threads");
const { courseSet, botPlay } = require("./course");

// test hook: a worker that never answers, so the pool's late-answer path can be proved
const HANG = process.env.BOT_WORKER_TEST_HANG === "1";

parentPort.on("message", (m) => {
  if (HANG) return;
  let out = null;
  try {
    const set = courseSet({ course: m.course, windmill: !!m.windmill, tall: !!m.tall, hidden: m.hidden !== false, vents: m.vents !== false });
    const base = set[((m.hole | 0) % set.length + set.length) % set.length];
    const h = Array.isArray(m.boulders) && base.boulders && base.boulders.length ? { ...base, boulders: m.boulders } : base;
    out = botPlay(h, m.from, m.skill, Math.random, { wm0: m.wm0, vt0: m.vt0, broken: m.broken, cupCover: m.cupCover });
  } catch (e) { out = null; }
  parentPort.postMessage(out ? { id: m.id, aim: out.aim, power: out.power } : { id: m.id, error: true });
});
