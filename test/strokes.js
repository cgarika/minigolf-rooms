/*
 Golf — stroke play and closest to the pin (the owner, 2026-10-15: "more reasons to replay"), over real sockets.
 Run:  node test/strokes.js   (starts its own server on TEST_PORT3, default 3631; never 3111-3120)
 Proves: the host (only) switches scoring to "strokes" and back, the state says so; in stroke play every ball plays
 each hole out before the next, and the round goes to the fewest strokes (holes taken break a tie); the default
 stays "holes" and its winner rule is unchanged.
*/
"use strict";
const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const path = require("path");
const PORT = Number(process.env.TEST_PORT3 || 3631), URL = "http://localhost:" + PORT;
if (PORT >= 3111 && PORT <= 3120) { console.error("refusing " + PORT); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };
let failed = 0;
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };
const pid = () => "s" + Math.random().toString(36).slice(2, 12);
function mk() {
  const c = io(URL, { transports: ["websocket"], reconnection: false, forceNew: true });
  c.st = null; c.seat = -1; c.joined = null; c.holesSeen = [];
  c.on("state", (f) => { c.st = f.room; c.seat = f.mySeat; });
  c.on("joined", (j) => { c.joined = j.code; });
  return c;
}
async function round(scoring) {
  const A = mk(), B = mk();
  await until(() => A.connected && B.connected);
  A.emit("create", { name: "Host", playerId: pid() }); await until(() => A.joined && A.st);
  B.emit("join", { code: A.joined, name: "Guest", playerId: pid() }); await until(() => A.st.players.length === 2);
  A.emit("addBot"); await until(() => A.st.players.length === 3);
  A.emit("settings", { holes: 3 });
  if (scoring) {
    B.emit("settings", { scoring });
    await sleep(200);
    check(A.st.opts.scoring === "holes", "a guest cannot change the scoring");
    A.emit("settings", { scoring });
    await until(() => B.st.opts.scoring === scoring);
    check(B.st.opts.scoring === scoring, "the host sets scoring to " + scoring + ", and everyone's state says so");
  } else check(A.st.opts.scoring === "holes", "the default is holes taken");
  A.emit("start"); await until(() => A.st.status === "playing");
  let lastHole = 0, wholeHoles = true;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && A.st.status === "playing") {
    const s = A.st;
    if (s.hole !== lastHole) {
      // The card of the hole just left: in stroke play nobody is missing a finished score.
      const row = s.card[lastHole] || [];
      if (scoring === "strokes" && row.some((x) => x == null)) wholeHoles = false;
      lastHole = s.hole;
    }
    for (const c of [A, B]) if (c.st.status === "playing" && c.st.turn === c.seat && !c.st.holeDone) c.emit("shoot", { aim: Math.random() * Math.PI * 2, power: 0.4 + Math.random() * 0.6 });
    await sleep(60);
  }
  check(A.st.status === "over", scoring + ": the round ends");
  const t = A.st.totals, pts = A.st.points, w = A.st.winner;
  const live = A.st.players.map((p, i) => i).filter((i) => !A.st.players[i].left);
  if (scoring === "pin") {
    check(A.st.card.every((row) => row.every((x, i) => A.st.players[i].left || x === 1)), "closest: one putt each on every hole: " + JSON.stringify(A.st.card));
    check(live.every((i) => pts[w] >= pts[i]), `closest: the most holes taken wins (points ${pts}, winner ${w})`);
    check(/closest on/.test(A.st.log), "closest: the last line says so: " + A.st.log);
  } else if ((scoring || "holes") === "strokes") {
    check(wholeHoles, "stroke play: every ball has a score on every hole");
    check(live.every((i) => t[w] < t[i] || (t[w] === t[i] && pts[w] >= pts[i])), `stroke play: the fewest strokes wins (totals ${t}, points ${pts}, winner ${w})`);
    check(/strokes[!,]/.test(A.st.log), "stroke play: the last line names the strokes: " + A.st.log);   // "wins it in 22 strokes!", or "A and B share it: 22 strokes, 3 holes each!"
  } else {
    check(live.every((i) => pts[w] > pts[i] || (pts[w] === pts[i] && t[w] <= t[i])), `holes: the most holes wins, strokes break a tie (totals ${t}, points ${pts}, winner ${w})`);
  }
  A.close(); B.close();
}
(async () => {
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(PORT), BOT_MS: "20", HOLE_INTRO_MS: "0", HOLE_PAUSE_MS: "100", TURN_MS: "600000" }, stdio: "ignore" });
  try {
    await sleep(800);
    await round("strokes");
    await round("pin");
    await round(null);
  } catch (e) { check(false, "threw: " + (e && e.stack || e)); }
  finally { srv.kill(); }
  console.log(failed ? failed + " FAILED" : "all stroke play tests pass");
  process.exit(failed ? 1 : 0);
})();
