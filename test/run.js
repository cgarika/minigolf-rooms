/* Runs every suite: the physics and the bot pool in process, and the socket suites
   against server copies this script starts and stops itself.

     node test/run.js                     ports 3612-3614
     TEST_PORTS=3271,3272,3273 node test/run.js

   Each server gets the settings its suite was written for; see SERVERS below. */

"use strict";
const { spawn, spawnSync } = require("child_process");
const net = require("net");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORTS = String(process.env.TEST_PORTS || "3612,3613,3614").split(",").map(Number);
/* The suites putt as fast as they can: the server's wait for the ball to roll (ROLL_REST) is off for every server this starts
   (test/golf_r2.js starts its own, with it on). */
if (process.env.ROLL_REST === undefined) process.env.ROLL_REST = "0";

/* legacy: the settings test/rules.js always ran with, and no hole intro (its loop
   guard is 8 s of waiting, shorter than a 6 s intro on two holes).
   intro:  a short intro, clock and pause, to watch them work; a fast heartbeat.
   fast:   no intro, a short pause, long turns: whole rounds quickly. */
const SERVERS = {
  legacy: { port: PORTS[0], env: { BOT_MS: "5", TURN_MS: "600000", HOLE_INTRO_MS: "0" } },
  intro:  { port: PORTS[1], env: { BOT_MS: "20", TURN_MS: "1500", AFK_MS: "300", HOLE_INTRO_MS: "600", HOLE_PAUSE_MS: "100", PING_INTERVAL_MS: "4000", PING_TIMEOUT_MS: "3000" } },
  fast:   { port: PORTS[2], env: { BOT_MS: "5", TURN_MS: "600000", HOLE_INTRO_MS: "0", HOLE_PAUSE_MS: "150" } },
};

function free(port) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once("error", () => res(false));
    s.once("listening", () => s.close(() => res(true)));
    s.listen(port, "127.0.0.1");
  });
}
function listening(port) {
  return new Promise((res) => {
    const c = net.connect(port, "127.0.0.1");
    c.once("connect", () => { c.destroy(); res(true); });
    c.once("error", () => res(false));
  });
}

function runNode(file, env) {
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: "inherit" });
  return r.status === 0;
}

(async () => {
  const children = [];
  const stopAll = () => { for (const c of children) try { c.kill("SIGTERM"); } catch (_) {} };
  process.on("exit", stopAll);
  let ok = true;

  ok = runNode("physics.js", {}) && ok;
  ok = runNode("physics.js", { GOLF_TALL: "1" }) && ok;
  ok = runNode("gear.js", {}) && ok;        // gear (2026-11-10, gear step 4): the table, the clamps, the putter's power and the ball's roll in the physics, the grip on the clock, the switch, the bands, the bots; starts its own server on TEST_PORT10
  ok = runNode("props.js", {}) && ok;
  ok = runNode("boulders.js", {}) && ok;
  ok = runNode("holes.js", {}) && ok;
  ok = runNode("holes.js", { GOLF_TALL: "1" }) && ok;
  ok = runNode("bots.js", {}) && ok;
  ok = runNode("reactions.js", {}) && ok;   // starts its own server on TEST_PORT3
  ok = runNode("strokes.js", {}) && ok;     // stroke play: starts its own server on TEST_PORT3
  ok = runNode("golf_r2.js", {}) && ok;     // round 2 (2026-10-31): water, solid balls, the tee box, the cap, the rest, the live aim; starts its own servers
  ok = runNode("golf_r3.js", {}) && ok;     // round 3 (2026-11-01): sand brakes like Plato's, slime holds, and three of the long holes carry it; in process
  ok = runNode("winners.js", {}) && ok;     // shared wins (2026-10-31): a round level on everything that decides it; starts its own server in process on TEST_PORT5
  ok = runNode("courses.js", {}) && ok;     // the courses (2026-11-01): Sunny Beach's nine holes measured, the hidden cups, an older app in a beach room; starts its own server in process on TEST_PORT6
  ok = runNode("slimelab.js", {}) && ok;    // Slime Lab (2026-11-01): its nine holes measured, the crates, the lobby's table following the pick, an older app in a lab room; starts its own server in process on TEST_PORT7
  ok = runNode("icecave.js", {}) && ok;     // Ice Cave (2026-11-01): its nine holes measured, the snowmen and ice blocks, ice that slides, the lobby's table following the pick, an older app in a cave room; starts its own server in process on TEST_PORT8
  ok = runNode("fourballs.js", {}) && ok;   // four balls on the green (2026-11-13, polish r4): every long hole of every course holds its par (MAX = par + 2) for the best bot among three room bots; in process, about six minutes
  ok = runNode("volcano.js", {}) && ok;     // Volcano (2026-11-01): its nine holes measured, the steam vents that kick a ball (a cycle of the strike time), the boulders and the hunting bot, an app that cannot draw vents, an older app in a volcano room; starts its own server in process on TEST_PORT9

  for (const [name, s] of Object.entries(SERVERS)) {
    if (!(await free(s.port))) { console.error(`port ${s.port} (${name}) is busy: not starting a server there`); process.exit(2); }
    const c = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, ...s.env, PORT: String(s.port) }, stdio: ["ignore", "ignore", "inherit"] });
    children.push(c);
  }
  for (const s of Object.values(SERVERS)) {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { up = await listening(s.port); if (!up) await new Promise((r) => setTimeout(r, 100)); }
    if (!up) { console.error(`server on ${s.port} never came up`); stopAll(); process.exit(2); }
  }

  const url = (k) => `http://localhost:${SERVERS[k].port}`;
  ok = runNode("rules.js", { URL: url("legacy") }) && ok;
  ok = runNode("worlds.js", { URL: url("legacy"), URL_INTRO: url("intro"), URL_FAST: url("fast") }) && ok;

  stopAll();
  console.log(ok ? "all suites green" : "SOME SUITES FAILED");
  process.exit(ok ? 0 : 1);
})();
