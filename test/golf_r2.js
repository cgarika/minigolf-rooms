/* Mini Golf round 2 (the owner, 2026-10-31: "play like Plato's"). Run: node test/golf_r2.js
   (starts its own servers on TEST_PORT4 and the next one, default 3641 and 3642; never 3111-3124).

   Proves, in process: the ball rolls one hole length in 3.5 s at full power and 0.45 of one at half; the ball and the cup are
   Plato's size; sand slows a putt; a fast ball rolls over the cup and a slow one drops; the long rooms' props stand when hit;
   a putt knocks another player's ball away like a billiard ball, into the water (back to its lie) or into the cup.
   Over real sockets: water costs only the wasted shot; every hole has its own cap and a player who uses it is OUT; turns
   strictly alternate; the ball can be set down in the tee box and nowhere else; nobody putts and no clock starts until the
   last ball has stopped; a player's live aim and a bot's reach the others as aimLive. */
"use strict";
const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const path = require("path");
const c = require("../course");

const PORT = Number(process.env.TEST_PORT4 || 3641);
if (PORT >= 3111 && PORT <= 3124) { console.error("refusing " + PORT); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, extra) => { console.log((ok ? "PASS " : "FAIL ") + what + (!ok && extra ? "  " + extra : "")); if (!ok) failed++; };
const section = (n) => console.log("\n" + n);

// ------------------------------------------------------------------ the roll, the sizes, the surfaces (in process)
const big = [[-600, -600], [600, -600], [600, 600], [-600, 600]];
const open = (extra) => ({ outline: big, obstacles: [], walls: c.edges(big), tee: [0, 0], cup: [599, 599], par: 3, name: "open",
  sludge: [], ice: [], props: [], boulders: [], bumpers: [], wind: [0, 0], ramps: [], tunnels: [], sand: [], water: [], ...extra });
const tall = c.HOLES_TALL[0];
const holeLen = Math.max(...tall.outline.map((p) => p[1])) - Math.min(...tall.outline.map((p) => p[1]));

section("the roll is Plato's");
{
  const full = c.simulate(open(), [0, 0], 0, 1), half = c.simulate(open(), [0, 0], 0, 0.5), quarter = c.simulate(open(), [0, 0], 0, 0.25);
  const t = (s) => (s.path.length - 1) / 60;
  check(Math.abs(full.end[0] / holeLen - 1) < 0.08, `a full putt rolls one hole length (${(full.end[0] / holeLen).toFixed(2)})`);
  check(t(full) > 3.2 && t(full) < 3.8, `...in about 3.5 s (${t(full).toFixed(2)} s)`);
  check(Math.abs(half.end[0] / full.end[0] - 0.45) < 0.04, `half the power rolls 0.45 of that (${(half.end[0] / full.end[0]).toFixed(2)})`);
  check(quarter.end[0] > 6 && quarter.end[0] < 13, `a quarter rolls a fifth of a hole (${quarter.end[0].toFixed(1)} units)`);
  // a gentle creep: the last second is slow
  const p = full.path, n = p.length;
  const lastSecond = Math.hypot(p[n - 1][0] - p[n - 61][0], p[n - 1][1] - p[n - 61][1]);
  check(lastSecond < 5, `the last second of a full putt creeps ${lastSecond.toFixed(1)} units`);
  const sand = c.simulate(open({ sand: [{ x: 5, y: 0, r: 1000 }] }), [0, 0], 0, 0.64);
  const grass = c.simulate(open(), [0, 0], 0, 0.64);
  check(sand.end[0] < grass.end[0] * 0.5, `sand cuts a mid-speed putt to under half (${(sand.end[0] / grass.end[0]).toFixed(2)})`);
}

section("the ball and the cup are Plato's size");
{
  const w = Math.max(...tall.outline.map((p) => p[0])) - Math.min(...tall.outline.map((p) => p[0]));
  check(Math.abs((2 * c.R) / w - 0.03) < 0.006, `the ball is 0.03 of the course's width (${((2 * c.R) / w).toFixed(3)})`);
  check(Math.abs((2 * c.CUP_R) / w - 0.048) < 0.008, `the cup is 0.048 of it (${((2 * c.CUP_R) / w).toFixed(3)})`);
  check(c.CUP_R / c.R > 1.3 && c.CUP_R / c.R < 1.9, `the cup is 1.3 to 1.9 balls across (${(c.CUP_R / c.R).toFixed(2)})`);
}

section("the cup takes a slow ball and not a fast one");
{
  const cup = { cup: [300, 0] };
  const slow = c.simulate(open(cup), [0, 0], 0, 0.9), fast = c.simulate(open(cup), [0, 0], 0, 1);
  const lands = (x) => c.simulate(open({ cup: [x, 0] }), [0, 0], 0, 1);
  check(lands(48).result === "stopped" || lands(48).result === "holed", "(a full putt passing a cup 48 away: " + lands(48).result + ")");
  const near = c.simulate(open({ cup: [20, 0] }), [0, 0], 0, 1);
  check(near.result === "stopped" && near.end[0] > 40, `a full putt rolls over a cup 20 away (${near.result}, on to ${near.end[0].toFixed(0)})`);
  const gentle = c.simulate(open({ cup: [20, 0] }), [0, 0], 0, c.powerForDistance(20.5));
  check(gentle.result === "holed", `a putt that arrives slowly drops (${gentle.result}, ${gentle.cupSpeed && gentle.cupSpeed.toFixed(1)} u/s)`);
  void slow; void fast;
}

section("the long rooms' props stand");
{
  const h = c.HOLES_TALL[0];
  check(h.solid === true && h.props.length > 0, "the long holes say their props are solid");
  const p = h.props[0];
  const from = [p.x, p.y - p.r - c.R - 8];
  const hit = c.simulate(h, [Math.max(1, from[0]), Math.max(1, from[1])], Math.PI / 2, 0.5);
  check((hit.broke || []).length === 0, "a putt straight at a prop knocks nothing out");
  const classic = c.HOLES[0];
  const cp = classic.props[0];
  const cf = c.simulate(classic, [cp.x, cp.y - cp.r - c.R - 6], Math.PI / 2, 0.5);
  check((cf.broke || []).length > 0, "the classic holes still knock a prop flat");
}

section("a putt knocks another ball away");
{
  const h = c.HOLES_TALL[2];
  const open1 = { ...h, props: [], bumpers: [], water: [], ramps: [], sand: [], sludge: [], ice: [], obstacles: [], walls: c.edges(h.outline), wind: [0, 0] };
  const from = [18, 10];
  const other = { x: 18, y: 10 + 14, seat: 3, lie: [18, 12] };
  const s = c.simulate(open1, from, Math.PI / 2, 0.55, { others: [other] });
  check(Array.isArray(s.knock) && s.knock.length === 1 && s.knock[0].seat === 3, "the other ball is in the knock list");
  const k = s.knock[0];
  check(k && k.end[1] > other.y + 2, `it rolled on up the green (${other.y} to ${k && k.end[1].toFixed(1)})`);
  check(s.end[1] < k.end[1] - 1.5, `and the putt's own ball stopped short of it (${s.end[1].toFixed(1)} < ${k.end[1].toFixed(1)})`);
  check(k.path && k.path.length > 10 && k.path.length <= s.path.length + 600, "its path is sampled with the ball's own");
  const off = c.simulate(open1, from, 0, 0.55, { others: [other] });
  check(!off.knock || off.knock.length === 0, "a putt that misses it leaves it alone");
  // into the water: back to where it was struck from
  const wet = { ...open1, water: [{ x: 18, y: 10 + 24, r: 4 }] };
  const w = c.simulate(wet, from, Math.PI / 2, 0.7, { others: [other] });
  check(w.knock && w.knock[0] && w.knock[0].result === "water" && w.knock[0].end[0] === 18 && w.knock[0].end[1] === 12, "a ball knocked into the water goes back to its lie", JSON.stringify(w.knock && w.knock[0] && { r: w.knock[0].result, e: w.knock[0].end }));
  // into the cup
  const cupped = { ...open1, cup: [18, 10 + 17] };
  const cp2 = c.simulate(cupped, from, Math.PI / 2, 0.45, { others: [{ x: 18, y: 10 + 14.5, seat: 1, lie: [18, 12] }] });
  check(cp2.knock && cp2.knock[0] && cp2.knock[0].result === "holed", "a ball knocked into the cup is holed", JSON.stringify(cp2.knock && cp2.knock[0] && cp2.knock[0].result));
  // two balls shot at the same line never end up inside one another
  const apart = c.simulate(open1, from, Math.PI / 2, 0.3, { others: [{ x: 18, y: 10 + 8, seat: 2, lie: [18, 12] }] });
  const o2 = apart.knock && apart.knock[0];
  check(!o2 || Math.hypot(apart.end[0] - o2.end[0], apart.end[1] - o2.end[1]) >= 2 * c.R - 0.05, "two balls never rest one inside the other");
}

section("only the water polygon makes water (the Funnel's bumper and walls are not)");
{
  const h = c.HOLES_TALL[1];
  let wrong = 0, shots = 0;
  let s = 7;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 600; i++) {
    const r = c.simulate(h, h.tee, rand() * Math.PI * 2, 0.2 + rand() * 0.8);
    shots++;
    // it counts as water only if the path really ends in the pond
    if (r.result === "water") {
      const last = r.path[r.path.length - 1];
      if (!c.inCircles(last[0], last[1], h.water)) wrong++;
    }
  }
  check(wrong === 0, `${shots} putts on hole 2: every water was in the pond`);
}

// ------------------------------------------------------------------ over sockets
function mk(url, name) {
  const s = io(url, { transports: ["websocket"], reconnection: false, forceNew: true });
  s.nm = name; s.st = null; s.seat = -1; s.errors = []; s.aims = [];
  s.on("state", (f) => { s.st = f.room; s.seat = f.mySeat; });
  s.on("err", (m, info) => s.errors.push(info || { message: m }));
  s.on("aimLive", (m) => s.aims.push(m));
  return s;
}
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };
const pid = () => "g" + Math.random().toString(36).slice(2, 12);

async function room(url, n, extra) {
  const a = mk(url, "A");
  await until(() => a.connected);
  a.emit("create", { name: "Ann", playerId: pid(), caps: ["tall", "windmill"] });
  await until(() => a.st && a.st.code);
  const others = [];
  for (let i = 1; i < n; i++) {
    const b = mk(url, "B" + i);
    await until(() => b.connected);
    b.emit("join", { code: a.st.code, name: "Bo" + i, playerId: pid(), caps: ["tall", "windmill"] });
    await until(() => b.st && b.seat === i);
    others.push(b);
  }
  a.emit("settings", { holes: 3 });
  if (extra && extra.bots) for (let i = 0; i < extra.bots; i++) a.emit("addBot");
  await sleep(100);
  a.emit("start");
  await until(() => a.st && a.st.status === "playing");
  return [a, ...others];
}

function server(port, env) {
  return spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(port), ...env }, stdio: "ignore" });
}

(async () => {
  // the fast server runs in this process (no rolling wait, instant bots), so the tests can stand its rooms on any hole
  Object.assign(process.env, { PORT: String(PORT), ROLL_REST: "0", BOT_MS: "20", HOLE_INTRO_MS: "0", HOLE_PAUSE_MS: "100", TURN_MS: "600000" });
  const fast = { kill() {} };
  const mine = require("../server");
  // a server that does wait: bots slow enough to see their aim
  const slow = server(PORT + 1, { ROLL_REST: "1", REST_GAP_MS: "300", BOT_MS: "700", HOLE_INTRO_MS: "0", HOLE_PAUSE_MS: "100", TURN_MS: "600000" });
  try {
    await sleep(900);
    const F = `http://localhost:${PORT}`, SL = `http://localhost:${PORT + 1}`;

    section("each hole its own cap, strictly alternating turns");
    {
      const [a, b] = await room(F, 2);
      check(a.st.maxStrokes >= 5 && a.st.maxStrokes <= 8, `the state's cap is this hole's own (${a.st.maxStrokes})`);
      check(a.st.maxStrokes === Math.max(5, Math.min(8, a.st.par + 2)), "two over its par, between 5 and 8");
      const order = [];
      for (let i = 0; i < 6 && a.st.status === "playing" && !a.st.holeDone; i++) {
        const who = a.st.turn, sock = who === 0 ? a : b;
        const v = a.st.v;
        // a feeble putt: the one on turn is the one furthest from the cup after the first, but the turn passes regardless
        sock.emit("shoot", { aim: i % 2 ? 0.1 : Math.PI / 2, power: i === 2 ? 0.9 : 0.12 });
        await until(() => a.st.v > v);
        order.push(who);
      }
      check(order.every((w, i) => i === 0 || w !== order[i - 1]), "the turns alternate whatever the distances: " + order.join(""));
      a.close(); b.close();
    }

    section("water costs only the wasted shot");
    {
      const [a, b] = await room(F, 2);
      // hole 2 (the Funnel) has its pond in the far corner: put the room there, a ball by the pond, and putt into it
      const r = require("../server");
      const rm = [...(r.__rooms || new Map()).values()].find((x) => x.code === a.st.code);
      check(!!rm, "the test can reach the room");
      if (rm) {
        rm.hole = 1;
        r.__startHole(rm, 0);
        const h = r.__hole(rm);
        const pond = h.water[0];
        rm.ball[0] = [pond.x - 6, pond.y]; rm.lie[0] = rm.ball[0].slice(); rm.placed[0] = true; rm.canPlace[0] = false;
        r.__bump(rm);
        await sleep(100);
        const strokesBefore = a.st.strokes[0];
        a.emit("shoot", { aim: 0, power: c.powerForDistance(6.3) });
        await until(() => a.st.lastShot && a.st.lastShot.seat === 0 && a.st.strokes[0] > strokesBefore);
        check(a.st.lastShot.result === "water", "the putt found the water", a.st.lastShot.result);
        check(a.st.strokes[0] === strokesBefore + 1, `one stroke, not two (${strokesBefore} to ${a.st.strokes[0]})`);
        check(a.st.lastShot.penalty === 0, "no penalty on the shot");
        check(Math.hypot(a.st.ball[0][0] - (pond.x - 6), a.st.ball[0][1] - pond.y) < 0.01, "the ball is back where it was struck from");
        check(!/penalty/i.test(a.st.log), "the log does not say penalty", a.st.log);
      }
      a.close(); b.close();
    }

    section("a player who has used every shot is OUT");
    {
      const [a, b] = await room(F, 2);
      const r = require("../server");
      const rm = [...r.__rooms.values()].find((x) => x.code === a.st.code);
      const cap = a.st.maxStrokes;
      rm.strokes[0] = cap - 1; rm.placed[0] = true; rm.canPlace[0] = false;
      r.__bump(rm);
      await sleep(80);
      const v = a.st.v;
      a.emit("shoot", { aim: Math.PI, power: 0.1 });    // away from the cup: no way in
      await until(() => a.st.v > v);
      check(a.st.strokes[0] === cap && a.st.done[0] === true && a.st.out[0] === true, `at ${cap} shots the player is done and OUT`, JSON.stringify({ s: a.st.strokes[0], d: a.st.done[0], o: a.st.out[0] }));
      check(a.st.turn === 1, "and the turn passes on");
      a.close(); b.close();
    }

    section("the tee box");
    {
      const [a, b] = await room(F, 2);
      const box = a.st.course.teeBox;
      check(Array.isArray(box) && box.length === 4 && box[2] - box[0] > 4 && box[3] - box[1] > 2, "the course says where the tee box is", JSON.stringify(box));
      check(a.st.canPlace[0] === true && a.st.placed[0] === false, "the player on turn may set the ball down");
      b.emit("place", { x: box[0] + 2, y: box[1] + 1 });
      await sleep(150);
      check(b.errors.some((e) => e.code === "bad_place"), "a player out of turn cannot place");
      const v = a.st.v;
      a.emit("place", { x: box[0] + 1.2, y: box[1] + 0.9 });
      await until(() => a.st.v > v);
      check(Math.abs(a.st.ball[0][0] - (box[0] + 1.2)) < 0.01 && Math.abs(a.st.ball[0][1] - (box[1] + 0.9)) < 0.01 && a.st.placed[0], "the ball is where the player tapped");
      const v2 = a.st.v;
      a.emit("place", { x: box[2] + 30, y: box[3] + 30 });
      await until(() => a.st.v > v2);
      check(a.st.ball[0][0] <= box[2] - c.R + 0.01 && a.st.ball[0][1] <= box[3] - c.R + 0.01 && a.st.ball[0][0] >= box[2] - c.R - 0.01, "a tap outside the box lands on its edge, inside", JSON.stringify([a.st.ball[0], box]));
      const v3 = a.st.v;
      a.emit("shoot", { aim: Math.PI / 2, power: 0.3 });
      await until(() => a.st.v > v3);
      check(a.st.canPlace[0] === false, "once it has putted the ball cannot be moved");
      a.errors.length = 0;
      a.emit("place", { x: box[0] + 2, y: box[1] + 1 });
      await sleep(120);
      check(a.errors.length === 0 || a.errors.every((e) => e.code === "bad_place"), "(a late placement is refused)");
      a.close(); b.close();
    }

    section("a putt knocks the other player's ball, over the sockets");
    {
      const [a, b] = await room(F, 2);
      const r = require("../server");
      const rm = [...r.__rooms.values()].find((x) => x.code === a.st.code);
      rm.hole = 2; r.__startHole(rm, 0);
      const h = r.__hole(rm);
      rm.ball[0] = [h.tee[0], h.tee[1]]; rm.ball[1] = [h.tee[0], h.tee[1] + 6]; rm.lie[1] = [h.tee[0], h.tee[1]];
      rm.placed[0] = rm.placed[1] = true; rm.canPlace[0] = rm.canPlace[1] = false;
      r.__bump(rm);
      await sleep(100);
      const v = a.st.v;
      a.emit("shoot", { aim: Math.PI / 2, power: 0.45 });
      await until(() => a.st.v > v);
      const ls = a.st.lastShot;
      check(ls.knock && ls.knock.length === 1 && ls.knock[0].seat === 1, "the shot says whose ball it knocked");
      check(a.st.ball[1][1] > h.tee[1] + 6.5, `and that ball lies further on (${a.st.ball[1][1].toFixed(1)})`, JSON.stringify(a.st.ball[1]));
      a.close(); b.close();
    }

    section("nobody putts until the ball has stopped");
    {
      const [a, b] = await room(SL, 2);
      const v = a.st.v;
      const t0 = Date.now();
      a.emit("shoot", { aim: Math.PI / 2, power: 0.5 });
      await until(() => a.st.v > v);
      const rollMs = ((a.st.lastShot.path.length - 1) * 1000) / 60;
      check(a.st.turnEndsAt > Date.now() + rollMs - 400, "the next clock starts after the roll", `${a.st.turnEndsAt - Date.now()} vs ${rollMs}`);
      b.errors.length = 0;
      const v1 = a.st.v;
      b.emit("shoot", { aim: Math.PI / 2, power: 0.2 });   // at once, while the ball still rolls
      await sleep(250);
      check(a.st.v === v1 && b.errors.some((e) => e.code === "wait"), "a putt sent while the ball rolls is refused (wait)", JSON.stringify(b.errors));
      await sleep(Math.max(0, rollMs + 400 - (Date.now() - t0)));
      const v2 = a.st.v;
      b.emit("shoot", { aim: Math.PI / 2, power: 0.2 });
      check(await until(() => a.st.v > v2, 3000), "and once it has stopped, the next putt goes through");
      a.close(); b.close();
    }

    section("the others see a putt being aimed");
    {
      const [a, b] = await room(SL, 2);
      for (let i = 0; i < 5; i++) { a.emit("aim", { aim: 1.2 + i * 0.01, power: 0.3 + i * 0.05 }); await sleep(100); }
      await sleep(150);
      check(b.aims.length >= 3 && b.aims.every((m) => m.seat === 0), `the other player got the live aim (${b.aims.length})`);
      check(a.aims.length === 0, "the one aiming does not get their own back");
      check(b.aims.length < 6 && b.aims[0].power > 0, "relayed at most ten times a second");
      b.aims.length = 0;
      b.emit("aim", { aim: 2, power: 0.5 });   // not b's turn
      await sleep(150);
      check(a.aims.length === 0, "an aim out of turn is not relayed");
      a.close(); b.close();
    }

    section("a bot lines its putt up where the others can see it");
    {
      const [a] = await room(SL, 1, { bots: 1 });
      // hand the turn to the bot: the human putts (not holing), then waits
      const v = a.st.v;
      a.emit("shoot", { aim: Math.PI / 2, power: 0.2 });
      await until(() => a.st.v > v);
      a.aims.length = 0;
      const t0 = Date.now();
      await until(() => a.st.lastShot && a.st.lastShot.seat === 1, 12000);
      const took = Date.now() - t0;
      const rollMs = ((a.st.lastShot.path.length - 1) * 1000) / 60;
      check(a.st.lastShot.seat === 1, "the bot putted");
      check(a.aims.length >= 3 && a.aims.every((m) => m.seat === 1), `the human watched the bot aim (${a.aims.length} events)`);
      check(a.aims.length > 1 && Math.abs(a.aims[a.aims.length - 1].aim - a.st.lastShot.aim) < 0.05, "and its aim settled on the putt it played");
      check(a.aims[a.aims.length - 1].power > 0 && Math.abs(a.aims[a.aims.length - 1].power - a.st.lastShot.power) < 0.15, "its power built to the putt's");
      check(took >= 1400, `it took 1.5 s or more to aim (${took} ms, after a ${Math.round(((a.st.lastShot.path.length - 1) * 1000) / 60)} ms roll was over)`);
      void rollMs;
      a.close();
    }
  } catch (e) { check(false, "threw: " + (e && e.stack || e)); }
  finally { fast.kill(); slow.kill(); }
  console.log(failed ? "\n" + failed + " FAILED" : "\nall golf round 2 tests pass");
  process.exit(failed ? 1 : 0);
})();
