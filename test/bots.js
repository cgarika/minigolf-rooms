/* Mini Golf — the bot-thinking pool (bots.js).
   Run: node test/bots.js

   Proves: the pool answers with a real putt for every hole, on both courses; with no
   workers it thinks on the main thread; a worker that dies or never answers never
   leaves a bot without a putt; and a burst of bot turns no longer holds the event loop
   the way thinking on it did. */

"use strict";
const { performance, monitorEventLoopDelay } = require("perf_hooks");
const c = require("../course");
const { createPool, thinkHere } = require("../bots");

let failures = 0;
const check = (ok, what, extra) => { if (!ok) { failures++; console.log("  FAIL: " + what + (extra ? "  " + extra : "")); } };
const section = (n) => console.log("\n" + n);
const valid = (s) => s && Number.isFinite(s.aim) && Number.isFinite(s.power) && s.power >= 0.05 && s.power <= 1;

(async () => {
  section("a pool answers with a real putt");
  {
    const pool = createPool(2);
    check(pool.live() === 2, "two workers did not start", String(pool.live()));
    const asks = [];
    for (let hole = 0; hole < c.HOLES.length; hole++)
      for (const windmill of [false, true])
        asks.push(pool.think({ hole, windmill, from: c.HOLES[hole].tee, skill: 1, wm0: 1.1 }).then((s) => ({ hole, windmill, s })));   // skill 1: no spray
    const out = await Promise.all(asks);
    for (const { hole, windmill, s } of out) {
      check(valid(s), `hole ${hole + 1}${windmill ? " (windmill)" : ""}: not a putt`, JSON.stringify(s));
      // a real search, not a guess: the chosen putt from the tee finishes nearer the cup than it started
      const h = (windmill ? c.HOLES_WINDMILL : c.HOLES)[hole];
      const shot = c.simulate(h, h.tee, s.aim, s.power, { wm0: 1.1 });
      const before = Math.hypot(h.cup[0] - h.tee[0], h.cup[1] - h.tee[1]);
      const after = shot.result === "holed" ? 0 : Math.hypot(h.cup[0] - shot.end[0], h.cup[1] - shot.end[1]);
      check(after < before, `hole ${hole + 1}: the pool's putt went backwards`, `${before.toFixed(1)} -> ${after.toFixed(1)}`);
    }
    check(pool.stats.answered === asks.length && pool.stats.local === 0, "the workers did not answer everything",
      JSON.stringify(pool.stats));
    pool.close();
    console.log(`  ${out.length} questions, all answered by the workers`);
  }

  section("no workers: the main thread thinks");
  {
    const pool = createPool(0);
    const s = await pool.think({ hole: 2, windmill: false, from: c.HOLES[2].tee, skill: 0.72, wm0: 0 });
    check(valid(s) && pool.stats.local === 1, "BOT_WORKERS=0 did not think locally", JSON.stringify(pool.stats));
    check(valid(thinkHere({ hole: 4, windmill: true, from: c.HOLES[4].tee, skill: 0.6, wm0: 0.2 })), "thinkHere is not a putt");
    console.log("  answered here");
  }

  section("a worker that dies hands its questions back");
  {
    const pool = createPool(1);
    const asks = [];
    for (let k = 0; k < 20; k++) asks.push(pool.think({ hole: 8, windmill: false, from: c.HOLES[8].tee, skill: 0.72, wm0: 0 }));
    pool.workers[0].terminate();
    const out = await Promise.all(asks);
    check(out.every(valid), "a question was lost with its worker");
    await new Promise((r) => setTimeout(r, 300));
    check(pool.live() === 1, "the dead worker was not replaced", String(pool.live()));
    const again = await pool.think({ hole: 0, windmill: false, from: c.HOLES[0].tee, skill: 0.72, wm0: 0 });
    check(valid(again), "the replacement does not answer");
    pool.close();
    console.log(`  20 of 20 answered (${pool.stats.failed} fell back), and a new worker took over`);
  }

  section("a worker that never answers is not waited on forever");
  {
    process.env.BOT_WORKER_TEST_HANG = "1";
    const pool = createPool(1, { timeoutMs: 150 });
    delete process.env.BOT_WORKER_TEST_HANG;
    const t0 = performance.now();
    const s = await pool.think({ hole: 1, windmill: false, from: c.HOLES[1].tee, skill: 0.72, wm0: 0 });
    const ms = performance.now() - t0;
    check(valid(s), "a hung worker left the bot without a putt");
    check(pool.stats.late === 1 && ms < 1000, "the late answer was not replaced in time", `${ms.toFixed(0)} ms ${JSON.stringify(pool.stats)}`);
    pool.close();
    console.log(`  answered here after ${ms.toFixed(0)} ms`);
  }

  section("a burst of bot turns leaves the event loop free");
  {
    /* 300 bot turns at once, hole 9 (the dearest to think about). On the main thread
       this is one long block; through the pool the loop stays responsive. */
    const lagOf = async (pool) => {
      const h = monitorEventLoopDelay({ resolution: 1 });
      h.enable();
      const t0 = performance.now();
      const asks = [];
      for (let k = 0; k < 300; k++) {
        asks.push(pool.think({ hole: 8, windmill: false, from: c.HOLES[8].tee, skill: 0.72, wm0: 0 }));
        if (k % 25 === 0) await new Promise((r) => setImmediate(r));
      }
      const out = await Promise.all(asks);
      h.disable();
      return { ms: performance.now() - t0, maxLag: h.max / 1e6, ok: out.every(valid) };
    };
    const local = createPool(0);
    await lagOf(local);                                // warm both up first: this measures
    const here = await lagOf(local);                   // steady running, not the JIT
    const pool = createPool(3);
    await new Promise((r) => setTimeout(r, 200));      // let the workers boot
    await lagOf(pool);
    const off = await lagOf(pool);
    pool.close();
    check(here.ok && off.ok, "a burst lost answers");
    check(off.maxLag < here.maxLag / 3, "the pool did not free the event loop",
      `main thread max lag ${here.maxLag.toFixed(1)} ms vs pool ${off.maxLag.toFixed(1)} ms`);
    console.log(`  300 turns: on the loop ${here.ms.toFixed(0)} ms with the loop held up to ${here.maxLag.toFixed(0)} ms;`
      + ` in the pool ${off.ms.toFixed(0)} ms with the loop held at most ${off.maxLag.toFixed(1)} ms`);
  }

  console.log(failures === 0 ? "\nbots: all good\n" : `\nbots: ${failures} failure(s)\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
