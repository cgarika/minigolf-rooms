/* Mini Golf — a bot's practice swings, off the event loop.

   A bot (and a timed-out player's auto-putt) chooses its putt by simulating a fan of 52
   candidate shots and keeping the best. That search was 88% of the server's CPU under
   load: 3-10 ms of blocking work per bot putt, on the one thread every socket shares, so
   one process saturated between 50 and 100 rooms and every player's putt queued behind
   the bots' thinking.

   Here the search runs on a small pool of worker threads. The event loop only posts the
   question and reads the answer; the one simulation that decides where the ball really
   goes still runs in server.js, on the putt, as before.

   If the pool is off (BOT_WORKERS=0), a worker dies, or an answer is late, the search
   runs on the main thread instead, so a bot always putts. */

"use strict";
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const { courseSet, botPlay } = require("./course");

const JOB_TIMEOUT_MS = Math.max(50, Number(process.env.BOT_JOB_TIMEOUT_MS || 2000));
const MAX_RESPAWNS = 20;

function defaultWorkers() {
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, cores - 1));
}

function holeOf(q) {
  const set = courseSet({ course: q.course, windmill: !!q.windmill, tall: !!q.tall, hidden: q.hidden !== false, vents: q.vents !== false });
  const h = set[((q.hole | 0) % set.length + set.length) % set.length];
  // The big balls where they lie now, not where the hole began them.
  return Array.isArray(q.boulders) && h.boulders && h.boulders.length ? { ...h, boulders: q.boulders } : h;
}

/* The same search, here and now. A hidden-cup hole's bot hunts the covers until the cup shows (botPlay): `broken` are the props knocked flat,
   `cupCover` the cover the cup lies under once it is found, and never before. */
function thinkHere(q) {
  return botPlay(holeOf(q), q.from, q.skill, Math.random, { wm0: q.wm0, vt0: q.vt0, broken: q.broken, cupCover: q.cupCover });
}

class BotPool {
  constructor(n, opts = {}) {
    this.size = Math.max(0, n | 0);
    this.timeoutMs = opts.timeoutMs || JOB_TIMEOUT_MS;
    this.workers = [];
    this.jobs = new Map();
    this.seq = 0;
    this.respawns = 0;
    this.stats = { posted: 0, answered: 0, local: 0, late: 0, failed: 0 };
    for (let i = 0; i < this.size; i++) this.spawn(i);
  }

  spawn(i) {
    let w;
    try { w = new Worker(path.join(__dirname, "bot-worker.js")); }
    catch (e) { this.workers[i] = null; return; }
    w.unref();                               // a pool never keeps the process alive
    w.pending = 0;
    w.on("message", (m) => {
      const job = m && this.jobs.get(m.id);
      if (!job) return;                      // answered already (it was late and ran here)
      this.jobs.delete(m.id);
      clearTimeout(job.timer);
      w.pending = Math.max(0, w.pending - 1);
      if (m.error || !Number.isFinite(m.aim) || !Number.isFinite(m.power)) { this.stats.failed++; this.stats.local++; job.resolve(thinkHere(job.q)); return; }
      this.stats.answered++;
      job.resolve({ aim: m.aim, power: m.power });
    });
    const lost = () => this.lost(w, i);
    w.on("error", lost);
    w.on("exit", lost);
    this.workers[i] = w;
  }

  /* A worker that died hands its questions back to the main thread, and is replaced. */
  lost(w, i) {
    if (this.workers[i] !== w) return;
    this.workers[i] = null;
    for (const [id, job] of this.jobs) {
      if (job.worker !== w) continue;
      this.jobs.delete(id);
      clearTimeout(job.timer);
      this.stats.failed++; this.stats.local++;
      job.resolve(thinkHere(job.q));
    }
    if (!this.closed && this.respawns < MAX_RESPAWNS) { this.respawns++; this.spawn(i); }
  }

  /* q: { hole, windmill, tall, course, hidden, vents, from: [x, y], skill, wm0, vt0, boulders, broken, cupCover }  ->  Promise<{ aim, power }> */
  think(q) {
    let best = null;
    for (const w of this.workers) if (w && (!best || w.pending < best.pending)) best = w;
    if (!best) { this.stats.local++; return Promise.resolve(thinkHere(q)); }
    return new Promise((resolve) => {
      const id = ++this.seq;
      const job = { q, resolve, worker: best, timer: null };
      job.timer = setTimeout(() => {
        if (!this.jobs.has(id)) return;
        this.jobs.delete(id);
        best.pending = Math.max(0, best.pending - 1);
        this.stats.late++; this.stats.local++;
        resolve(thinkHere(q));
      }, this.timeoutMs);
      job.timer.unref();
      this.jobs.set(id, job);
      best.pending++;
      this.stats.posted++;
      best.postMessage({ id, hole: q.hole, windmill: !!q.windmill, tall: !!q.tall, course: q.course, hidden: q.hidden, from: [Number(q.from[0]), Number(q.from[1])], skill: q.skill, wm0: q.wm0, vt0: q.vt0, vents: q.vents, boulders: q.boulders, broken: q.broken, cupCover: q.cupCover });
    });
  }

  live() { return this.workers.filter(Boolean).length; }

  close() {
    this.closed = true;
    for (const w of this.workers) if (w) w.terminate();
    this.workers = [];
  }
}

function createPool(n, opts) {
  const want = n != null ? n
    : process.env.BOT_WORKERS != null && process.env.BOT_WORKERS !== "" ? Math.min(16, Number(process.env.BOT_WORKERS) | 0)
    : defaultWorkers();
  return new BotPool(want, opts);
}

module.exports = { createPool, BotPool, thinkHere, holeOf, JOB_TIMEOUT_MS };
