/* Gear (2026-11-10, gear step 4): the table's Mini Golf slots, the clamps, the physics (the putter's power, the ball's roll), the shot clock (the grip), the host's gear switch, the bands quick
   play matches within, the bots' gear, and that no gear is exactly the base values. In process on TEST_PORT10 (default 3691; never 3111-3126). */
"use strict";
const { io } = require("socket.io-client");
const G = require("../gear");
const c = require("../course");
const PORT = Number(process.env.TEST_PORT10 || 3691);
if (PORT >= 3111 && PORT <= 3126) { console.error("refusing " + PORT); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (ok, what, extra) => { if (ok) passed++; else failed++; console.log((ok ? "PASS " : "FAIL ") + what + (!ok && extra !== undefined ? "  " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : "")); return !!ok; };
const section = (n) => console.log("\n" + n);
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };
const pid = () => "r" + Math.random().toString(36).slice(2, 12);
const COST = { 2: 300, 3: 600, 4: 1000, 5: 1500, 6: 2500, 7: 4000, 8: 6000, 9: 9000, 10: 13000, 11: 18000, 12: 24000 };
const SAP = { putter: { item: "putter:sapphire", level: 10 }, gball: { item: "gball:sapphire", level: 6 }, grip: { item: "grip:sapphire", level: 8 } };

function mk(url, name) {
  const s = io(url, { transports: ["websocket"], reconnection: false, forceNew: true });
  s.nm = name; s.st = null; s.seat = -1; s.errors = []; s.playerId = pid();
  s.on("state", (f) => { s.st = f.room; s.seat = f.mySeat; });
  s.on("err", (m, info) => s.errors.push(info || { message: m }));
  return s;
}
const open = (big) => ({ outline: big, obstacles: [], walls: c.edges(big), tee: [0, 0], cup: [599, 599], par: 3, name: "open", sludge: [], ice: [], props: [], boulders: [], bumpers: [], wind: [0, 0], ramps: [], tunnels: [], sand: [], water: [] });

(async () => {
  section("the table: Mini Golf's and Bowling's slots, items, rarities, costs and caps");
  {
    for (const [L, cost] of Object.entries(COST)) check(G.T.levelCost[L] === cost, `level ${L} costs ${cost}`, G.T.levelCost[L]);
    check(JSON.stringify(G.slotsOf("golf")) === '["putter","gball","grip"]' && JSON.stringify(G.T.games.golf.stats) === '["power","aim","roll","shot"]', "Mini Golf: putter, ball, grip; power, aim, roll, shot");
    check(JSON.stringify(G.slotsOf("bowling")) === '["bball","shoes","wrist"]' && JSON.stringify(G.T.games.bowling.stats) === '["hook","power","steady","aim"]', "Bowling: ball, shoes, wrist guard; hook, power, steady, aim");
    for (const game of ["golf", "bowling"]) for (const slot of G.slotsOf(game)) {
      const items = Object.keys(G.T.items).filter((k) => G.T.items[k].slot === slot);
      check(items.length === 4, `${slot}: four items`, items);
      check(["common", "rare", "epic", "legendary"].every((x, i) => G.rarityOf(items[i]) === x), `${slot}: one COMMON, RARE, EPIC and LEGENDARY, in that order`, items.map(G.rarityOf));
      check(G.rarityOf(G.starterOf(slot)) === "common" && items[0] === G.starterOf(slot), `${slot}: everyone starts with the COMMON one (${G.starterOf(slot)})`);
      check(items.every((k) => !G.T.items[k].plus && !G.T.items[k].pass), `${slot}: no Plus or pass items`);
    }
    check(G.T.items["putter:dragon"].name === "Dragon putter" && G.T.items["gball:pearl"].name === "Pearl ball" && G.T.items["wrist:sapphire"].name === "Sapphire guard", "the names");
    check(G.pieceStats("putter", 1).power === 0 && G.pieceStats("putter", 6).power === 5 && G.pieceStats("putter", 6).aim === 5, "the putter gives power and aim, level 1 is the base");
    check(G.pieceStats("gball", 11).roll === 10 && Object.keys(G.pieceStats("gball", 4)).join() === "roll", "the ball: roll, never over 10");
    check(G.pieceStats("grip", 8).shot === 7 && Object.keys(G.pieceStats("grip", 8)).join() === "shot", "the grip: shot time only");
    check(G.pieceStats("bball", 7).hook === 6 && G.pieceStats("bball", 7).power === 6, "the bowling ball gives hook and power");
    check(Object.keys(G.pieceStats("shoes", 3)).join() === "steady" && Object.keys(G.pieceStats("wrist", 3)).join() === "aim", "shoes: steadiness; the wrist guard: the aim line");
  }

  section("clean(): clamps and fallbacks");
  {
    const g = G.clean("golf", { putter: { item: "putter:sapphire", level: 99 }, gball: { item: "nope", level: 7 }, grip: { item: "putter:pearl", level: 5 } });
    check(g.slots.putter.level === 10, "a sapphire (EPIC) at 99 is 10", g.slots.putter);
    check(g.slots.gball.item === "gball:classic" && g.slots.gball.level === 6, "an unknown item is the starter, held to COMMON's 6", g.slots.gball);
    check(g.slots.grip.item === "grip:classic", "an item from another slot is the starter", g.slots.grip);
    check(G.clean("golf", { putter: { item: "putter:dragon", level: 1 } }).slots.putter.level === 5, "a LEGENDARY below its floor is 5");
    check(G.clean("golf", null) === null && G.clean("bowling", "x") === null && G.clean("chess", SAP) === null, "no gear is null, and no gear in other games");
    check(G.clean("golf", {}).score === 3 && G.clean("bowling", {}).score === 3, "an empty object is the starter set, score 3");
    check(G.clean("bowling", SAP).slots.bball.item === "bball:classic", "Mini Golf's slots mean nothing to Bowling");
    const full = G.clean("golf", SAP);
    check(full.score === 24 && full.stats.power === 9 && full.stats.aim === 9 && full.stats.roll === 5 && full.stats.shot === 7, "gear score is the sum of the levels; stats from the pieces", full);
    const b = G.clean("bowling", { bball: { item: "bball:dragon", level: 12 }, shoes: { item: "shoes:pearl", level: 8 }, wrist: { item: "wrist:classic", level: 3 } });
    check(b.score === 23 && b.stats.hook === 10 && b.stats.power === 10 && b.stats.steady === 7 && b.stats.aim === 2, "Bowling's stats from its pieces", b);
  }

  section("the effects: Mini Golf +3% speed, -3% friction, +1 s, +8% aim; Bowling +3% top speed (the cap), +4% hook, -4% wobble, +8% aim");
  {
    const fx = G.golfEffects({ power: 10, roll: 10, shot: 10, aim: 10 });
    check(Math.abs(fx.speed - 1.3) < 1e-9 && Math.abs(fx.roll - 0.7) < 1e-9 && fx.shotMs === 10000 && Math.abs(fx.aim - 1.8) < 1e-9, "Mini Golf at 10 points: 1.3x speed, 0.7x friction, +10 s, 1.8x aim", fx);
    const none = G.golfEffects(null);
    check(none.speed === 1 && none.roll === 1 && none.shotMs === 0 && none.aim === 1, "no stats are the base", none);
    const bw = G.bowlingEffects({ hook: 10, power: 10, steady: 10, aim: 10 });
    check(Math.abs(bw.speed - 1.3) < 1e-9 && bw.speedMax === 12740 && Math.abs(bw.hook - 1.4) < 1e-9 && Math.abs(bw.steady - 0.6) < 1e-9 && Math.abs(bw.aim - 1.8) < 1e-9, "Bowling at 10 points: the cap 12,740 mm/s, 1.4x hook, 0.6x wobble, 1.8x aim", bw);
    const bn = G.bowlingEffects(null);
    check(bn.speed === 1 && bn.speedMax === 9800 && bn.hook === 1 && bn.steady === 1, "no stats: the base cap 9,800 and no scaling", bn);
    check(G.bowlingEffects({ power: 5 }).speedMax === 11270, "power 5: Math.round(9800 * 1.15) = 11,270");
    // the wobble: deterministic, inside its bounds, scaled, and nothing at 0
    const w = { x: 1234, angle: -250, speed: 8200, spin: 600 };
    const a = G.wobbleRelease(w, 1), b = G.wobbleRelease(w, 1), s6 = G.wobbleRelease(w, 0.6);
    check(JSON.stringify(a) === JSON.stringify(b), "the same release wobbles the same way twice", [a, b]);
    check(a.x === w.x && Math.abs(a.angle - w.angle) <= 80 && Math.abs(a.speed - w.speed) <= 60 && Math.abs(a.spin - w.spin) <= 20, "the wobble is inside 0.08 degrees, 0.06 m/s and 0.02 of spin, and never moves the stance", a);
    check(Math.abs(s6.angle - w.angle) <= 48 && Math.abs(s6.speed - w.speed) <= 36 && Math.abs(s6.spin - w.spin) <= 12, "at steadiness 10 (0.6) it is 60% of that", s6);
    check(JSON.stringify(G.wobbleRelease(w, 0)) === JSON.stringify(w), "a mul of 0 is the release as sent");
    check(G.wobbleRelease({ x: 0, angle: 3490, speed: 9790, spin: 995 }, 1).angle <= 3500 && G.wobbleRelease({ x: 0, angle: 3490, speed: 9790, spin: 995 }, 1).speed <= 9800, "the wobble stays inside the wire's clamps");
    check(G.wobbleRelease({ x: 0, angle: 0, speed: 12000, spin: 0 }, 1, 12740).speed <= 12740 && G.wobbleRelease({ x: 0, angle: 0, speed: 12000, spin: 0 }, 1, 12740).speed >= 11940, "and inside the seat's own cap");
    const seen = new Set(); for (let i = 0; i < 200; i++) seen.add(G.wobbleRelease({ x: i * 10, angle: 0, speed: 7400, spin: 0 }, 1).angle);
    check(seen.size > 40, "different releases wobble differently", seen.size);
  }

  section("the bots' gear fits the band");
  {
    for (const score of [3, 7, 12, 20, 29, 36]) { const b = G.botGear("golf", score); check(b.score === score, `a golf bot at score ${score}`, b.score); }
    check(G.botGear("bowling", 100).score === 36 && G.botGear("bowling", 0).score === 3, "clamped to 3..36");
    check(G.bandOk(10, 16) && !G.bandOk(10, 17) && G.bandOk(3, G.scoreFor(null, "golf")), "a band is 6 points; no gear counts as 3");
  }

  section("the physics: the putter's power and the ball's roll, and no gear is the base");
  {
    const big = [[-600, -600], [600, -600], [600, 600], [-600, 600]];
    const h = open(big);
    const base = c.simulate(h, [0, 0], 0, 0.5), nul = c.simulate(h, [0, 0], 0, 0.5, { gear: null }), ones = c.simulate(h, [0, 0], 0, 0.5, { gear: { speed: 1, roll: 1 } });
    check(JSON.stringify(base) === JSON.stringify(nul) && JSON.stringify(base) === JSON.stringify(ones), "no gear (null, or 1 and 1) is byte-for-byte the base");
    const fast = c.simulate(h, [0, 0], 0, 0.5, { gear: { speed: 1.3, roll: 1 } });
    const v0 = (s) => Math.hypot(s.path[1][0] - s.path[0][0], s.path[1][1] - s.path[0][1]);
    check(Math.abs(v0(fast) / v0(base) - 1.3) < 0.03, `power 10: the putt leaves about 30% faster (${(v0(fast) / v0(base)).toFixed(3)}; the first sample is a sixtieth of a second of friction in)`);
    check(fast.end[0] > base.end[0] * 1.2, `and carries further (${base.end[0].toFixed(1)} -> ${fast.end[0].toFixed(1)})`);
    const roll = c.simulate(h, [0, 0], 0, 0.5, { gear: { speed: 1, roll: 0.7 } });
    check(Math.abs(v0(roll) / v0(base) - 1) < 0.01, "roll 10: the putt leaves at the same speed");
    check(Math.abs(roll.end[0] / base.end[0] - 1 / 0.7) < 0.03, `roll 10: the ball carries 1/0.7 as far (${(roll.end[0] / base.end[0]).toFixed(3)}, the friction and the drag both 0.7)`);
    check(roll.path.length > base.path.length, "and rolls for longer");
    // sand brakes a geared ball as it brakes any ball, only a little less
    const sandy = { ...h, sand: [{ x: 20, y: 0, r: 8 }] };
    const sb = c.simulate(sandy, [0, 0], 0, 0.5), sr = c.simulate(sandy, [0, 0], 0, 0.5, { gear: { speed: 1, roll: 0.7 } });
    check(sr.end[0] > sb.end[0] && sr.end[0] < sb.end[0] * 1.6, `in sand the roll still helps, and still brakes (${sb.end[0].toFixed(1)} -> ${sr.end[0].toFixed(1)})`);
    // the base physics of every hole are what they were: a putt with no gear on each of the Meadow's holes is the same as a putt with gear 1, 1
    let same = 0;
    for (const hole of c.HOLES) { const a = c.simulate(hole, hole.tee, 0.7, 0.8), b = c.simulate(hole, hole.tee, 0.7, 0.8, { gear: { speed: 1, roll: 1 } }); if (JSON.stringify(a) === JSON.stringify(b)) same++; }
    check(same === c.HOLES.length, "on every Meadow hole a gear of 1 and 1 is the putt it always was", same);
  }

  // ---- the server, in this process
  Object.assign(process.env, { PORT: String(PORT), ROLL_REST: "0", BOT_MS: "20", HOLE_INTRO_MS: "0", HOLE_PAUSE_MS: "100", TURN_MS: "45000", QUICK_FILL_MS: "900", QUICK_FILL_MAX_MS: "900" });
  const App = require("../server");
  const { newRoom, startGame, playStroke, publicRoom, addBotTo } = App._tools;
  await sleep(700);
  const URL = `http://localhost:${PORT}`;

  section("playStroke: a person's gear reaches the putt, a bot's never does");
  {
    const mkRoom = (gearA, botSeat) => {
      const room = newRoom("GEARAA", "a");
      room.players.push({ id: "a", name: "Ava", avatar: "x", left: false, connected: true, gear: G.clean("golf", gearA) });
      if (botSeat) addBotTo(room); else room.players.push({ id: "b", name: "Bo", avatar: "x", left: false, connected: true, gear: null });
      startGame(room);
      return room;
    };
    const launch = (room) => { const p = room.lastShot.path; return Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]); };
    const r0 = mkRoom(null, true);
    check(playStroke(r0, 0, 0.3, 1, Date.now(), "human") && r0.lastShot, "a person with no gear putts");
    const baseV = launch(r0);
    const r1 = mkRoom(SAP, true);
    check(playStroke(r1, 0, 0.3, 1, Date.now(), "human") && Math.abs(launch(r1) / baseV - 1.27) < 0.01, `putter power 9 (+27%) rides on the putt (${(launch(r1) / baseV).toFixed(3)})`);
    const r2 = mkRoom(SAP, true); r2.gearOn = false;
    check(playStroke(r2, 0, 0.3, 1, Date.now(), "human") && Math.abs(launch(r2) / baseV - 1) < 1e-9, "with the host's gear switch off a geared person putts the base");
    const r3 = mkRoom(SAP, true);
    check(r3.players[1].bot && r3.players[1].gear && r3.players[1].gear.score === 24, "the bot wears the human's score (24)", r3.players[1].gear && r3.players[1].gear.score);
    r3.turn = 1;
    check(playStroke(r3, 1, 0.3, 1, Date.now(), "bot") && Math.abs(launch(r3) / baseV - 1) < 1e-9, "but a bot's putt is on the base physics (it plans them)");
    const r4 = mkRoom(SAP, true); r4.players[0].botControlled = true;
    check(playStroke(r4, 0, 0.3, 1, Date.now(), "bot") && Math.abs(launch(r4) / baseV - 1) < 1e-9, "and so is a person's a bot plays for");
    const r5 = mkRoom(SAP, false), r6 = mkRoom(null, false);
    check(r5.players[1].gear === null && r6.players[1].gear === null, "a second person has their own gear, none here");
    check(JSON.stringify(publicRoom(r1).players[0].gear.items) === '{"putter":"putter:sapphire","gball":"gball:sapphire","grip":"grip:sapphire"}', "the room tells every seat's items (the ball each wears)");
    check(publicRoom(r2).players[0].gear.stats.power === 0 && publicRoom(r2).players[0].gear.score === 24 && publicRoom(r2).gearOn === false, "gear off: the stats are nothing, the score is still shown");
    const r7 = mkRoom(SAP, false); addBotTo(r7);
    check(r7.players[2].bot && r7.players[2].gear && r7.players[2].gear.score === Math.round((24 + 3) / 2), "a bot added later fits the humans' mean (24 and none: 14)", r7.players[2].gear && r7.players[2].gear.score);
  }

  section("gear is accepted on create and join, clamped, and shown to the table; the switch; the clock; the bots");
  {
    const a = mk(URL, "a"); await until(() => a.connected);
    a.emit("create", { name: "Ava", playerId: a.playerId, gear: { ...SAP, putter: { item: "putter:sapphire", level: 500 } } });
    await until(() => a.st);
    const me = a.st.players[0];
    check(me.gear && me.gear.score === 24 && me.gear.levels.putter === 10 && me.gear.items.gball === "gball:sapphire", "Ava's gear is on her seat, clamped", me.gear);
    check(me.gear.stats.power === 9 && me.gear.stats.roll === 5 && a.st.gearOn === true, "stats are in force, the gear switch is on", me.gear && me.gear.stats);
    const old = mk(URL, "old"); await until(() => old.connected);
    old.emit("join", { code: a.st.code, name: "Old", playerId: old.playerId });
    await until(() => a.st.players.length === 2);
    check(a.st.players[1].gear === null, "an old app that sends no gear has none", a.st.players[1].gear);
    const j = mk(URL, "j"); await until(() => j.connected);
    j.emit("join", { code: a.st.code, name: "Jo", playerId: j.playerId, gear: { putter: { item: "putter:classic", level: 9 }, gball: "x", grip: null } });
    await until(() => a.st.players.length === 3);
    const jo = a.st.players[2].gear;
    check(jo && jo.levels.putter === 6 && jo.levels.gball === 1 && jo.score === 8, "Jo's classic putter (COMMON) is held at 6, the rest are the starters", jo);
    // a change on the gear page reaches the table, clamped; in a round it is refused
    j.emit("gear", { putter: { item: "putter:dragon", level: 99 }, grip: { item: "grip:pearl", level: 4 } });
    check(await until(() => a.st.players[2].gear && a.st.players[2].gear.levels.putter === 12), "the Dragon putter is held at the LEGENDARY top");
    check(a.st.players[2].gear.levels.grip === 4 && a.st.players[2].gear.levels.gball === 1, "the grip as sent, the ball the starter", a.st.players[2].gear.levels);
    // the host's switch: a guest cannot, the host can; off, the stats are nothing and the clock is the base
    old.emit("settings", { gear: false }); await sleep(150);
    check(a.st.gearOn === true, "a guest cannot switch gear off");
    a.emit("settings", { gear: false });
    check(await until(() => a.st.gearOn === false), "the host can");
    check(a.st.players[0].gear.stats.power === 0 && a.st.players[0].gear.score === 24, "off: the stats are nothing, the score is still shown", a.st.players[0].gear);
    a.emit("addBot"); await until(() => a.st.players.length === 4);
    a.emit("start"); await until(() => a.st.status === "playing");
    let clock = a.st.turnEndsAt - a.st.serverNow;
    check(clock > 43000 && clock < 45500, `gear off: the shot clock is the base 45 s (${clock} ms)`, clock);
    check(a.st.players[3].bot && a.st.players[3].gear && a.st.players[3].gear.score === Math.round((24 + 3 + 17) / 3), "the bot's score is the humans' mean (24, none, 17: 15)", a.st.players[3].gear && a.st.players[3].gear.score);
    j.emit("gear", { putter: { item: "putter:sapphire", level: 3 } }); await sleep(150);
    check(a.st.players[2].gear.levels.putter === 12, "in a round a gear change is refused");
    for (const s of [a, old, j]) s.close();
  }
  section("the grip adds seconds to the shot clock; the bot has none when nobody sent gear");
  {
    const h = mk(URL, "h"); await until(() => h.connected);
    h.emit("create", { name: "Grip", playerId: h.playerId, gear: { grip: { item: "grip:sapphire", level: 8 } } });
    await until(() => h.st);
    h.emit("start"); await until(() => h.st.status === "playing");
    const clock = h.st.turnEndsAt - h.st.serverNow;
    check(clock > 50500 && clock < 52500, `grip level 8 (+7 s): 52 s (${clock} ms)`, clock);
    h.close();
    const n = mk(URL, "n"); await until(() => n.connected);
    n.emit("create", { name: "None", playerId: n.playerId }); await until(() => n.st);
    n.emit("addBot"); await until(() => n.st.players.length === 2);
    n.emit("start"); await until(() => n.st.status === "playing");
    const c2 = n.st.turnEndsAt - n.st.serverNow;
    check(c2 > 43000 && c2 < 45500 && n.st.players[1].gear === null, `45 s, and the bot has no gear (${c2} ms)`);
    n.close();
  }
  section("a putt with gear is harder and carries further: over a socket");
  {
    const run = async (gear) => {
      const s = mk(URL, "s"); await until(() => s.connected);
      s.emit("create", { name: "S", playerId: s.playerId, ...(gear ? { gear } : {}) }); await until(() => s.st);
      s.emit("start"); await until(() => s.st.status === "playing" && s.st.turn === 0);
      s.emit("shoot", { aim: 0.4, power: 0.5 });
      await until(() => s.st.lastShot && s.st.lastShot.seat === 0);
      const p = s.st.lastShot.path, v = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), end = s.st.lastShot.path.length;
      s.close();
      return { v, end };
    };
    const base = await run(null);
    const gear = await run({ putter: { item: "putter:sapphire", level: 10 }, gball: { item: "gball:sapphire", level: 10 } });
    check(Math.abs(gear.v / base.v - 1.27) < 0.01, `level 10 putter: power 9 = +27% (${base.v.toFixed(3)} -> ${gear.v.toFixed(3)})`);
    check(gear.end > base.end, `a level 10 ball: roll 9 rolls for longer (${base.end} -> ${gear.end} samples)`);
  }
  section("quick play matches within a gear-score band");
  {
    const lo = mk(URL, "lo"), hi = mk(URL, "hi"), mid = mk(URL, "mid"), ng = mk(URL, "ng");
    for (const s of [lo, hi, mid, ng]) await until(() => s.connected);
    lo.emit("quick", { name: "Lo", playerId: lo.playerId }); await until(() => lo.st && lo.st.quick);                                     // score 3
    hi.emit("quick", { name: "Hi", playerId: hi.playerId, gear: SAP }); await until(() => hi.st && hi.st.quick);                         // 24: outside the band of 3
    check(hi.st.code !== lo.st.code, "a score of 24 does not join a score of 3", [hi.st.code, lo.st.code]);
    mid.emit("quick", { name: "Mid", playerId: mid.playerId, gear: { putter: { item: "putter:pearl", level: 4 }, gball: { item: "gball:classic", level: 3 } } });   // 4 + 3 + 1 = 8
    await until(() => mid.st && mid.st.quick);
    check(mid.st.code === lo.st.code, "a score of 8 does join a score of 3", [mid.st.code, lo.st.code]);
    ng.emit("quick", { name: "Ng", playerId: ng.playerId, gear: SAP }); await until(() => ng.st && ng.st.quick);
    check(ng.st.code === hi.st.code, "the same band meets", [ng.st.code, hi.st.code]);
    for (const s of [lo, hi, mid, ng]) s.close();
  }
  console.log(`\ngear: ${passed} checks passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
