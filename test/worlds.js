/* Mini Golf — the Sunset Cove server changes, over real sockets.
   Run by test/run.js, which starts the three servers this needs:
     URL        legacy settings (BOT_MS 5, TURN_MS 600000, no hole intro, 1.8 s pause)
     URL_INTRO  HOLE_INTRO_MS 600, TURN_MS 1500, BOT_MS 20, HOLE_PAUSE_MS 100
     URL_FAST   no intro, HOLE_PAUSE_MS 150, long turns

   Proves: the honour (the last hole's winner putts first, a tied hole keeps the order,
   a winner who left passes it on, seat order round from it); the hole intro on the
   clock and on a bot's first putt, never locking input; no putt while a hole closes;
   the windmill only for rooms that can all draw it, played exactly as the state says;
   ball colours; refusal codes; a hostile payload cannot crash the process; one socket,
   one room; a reconnect is not undone by the old socket; 18-character names; the
   server's clock in every state; and an app that knows none of this sees what it did. */

"use strict";
const { io } = require("socket.io-client");
const c = require("../course");

const URL = process.env.URL || "http://localhost:3612";
const URL_INTRO = process.env.URL_INTRO || "http://localhost:3613";
const URL_FAST = process.env.URL_FAST || "http://localhost:3614";
const COLORS = ["#ff5757", "#33d17a", "#ffc233", "#5b8cff", "#a78bfa", "#ff8c42"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, checks = 0;
const check = (ok, what, extra) => { checks++; if (!ok) { failures++; console.log("  FAIL: " + what + (extra ? "  " + extra : "")); } };
const section = (n) => console.log("\n" + n);

const all = [];
function mk(url, name, opts = {}) {
  const s = io(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  s.nm = name; s.st = null; s.seat = -1; s.errs = []; s.hist = []; s.clockSkew = 0;
  s.pid = opts.playerId || ("p" + Math.random().toString(16).slice(2).padEnd(16, "0")).slice(0, 17);
  s.on("state", ({ room, mySeat }) => {
    s.st = room; s.seat = mySeat;
    s.hist.push(room); if (s.hist.length > 2000) s.hist.shift();
    if (typeof room.serverNow === "number") s.clockSkew = Math.max(s.clockSkew, Math.abs(room.serverNow - Date.now()));
  });
  s.on("err", (msg, detail) => s.errs.push({ msg, detail }));
  all.push(s);
  return s;
}
const connected = (s) => new Promise((res) => (s.connected ? res() : s.once("connect", res)));
async function waitFor(s, pred, ms = 6000, what = "state") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (s.st && pred(s.st)) return true; await sleep(10); }
  check(false, `timed out waiting for ${what}`);
  return false;
}
async function waitErr(s, n, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (s.errs.length >= n) return s.errs[n - 1]; await sleep(10); }
  return null;
}
async function create(url, name, extra = {}) {
  const s = mk(url, name, extra);
  await connected(s);
  s.emit("create", { name, playerId: s.pid, ...extra });
  await waitFor(s, (r) => r.code, 6000, `${name}'s room`);
  return s;
}
async function join(url, code, name, extra = {}) {
  const s = mk(url, name, extra);
  await connected(s);
  s.emit("join", { code, name, playerId: s.pid, ...extra });
  await waitFor(s, (r) => r.code === code && s.seat >= 0, 6000, `${name} joining`);
  return s;
}

/* A good putt: the bot's own search with no spray, so it is the best the fan finds. */
function goodShot(st, seat) {
  const set = st.windmill ? c.HOLES_WINDMILL : c.HOLES;
  const h = set[st.hole % set.length];
  return c.botShot(h, st.ball[seat], 1.0, () => 0.5);
}
const WEAK = { aim: 0, power: 0.02 };

/* Plays the current hole out: each human seat putts "good" or "weak" per `roles`.
   Returns the seats in the order they putted. */
async function playHole(socks, roles, opts = {}) {
  const w = socks[0];
  const hole = w.st.hole, round = w.st.card.length;
  const order = [];
  for (let guard = 0; guard < 80; guard++) {
    const st = w.st;
    if (st.status !== "playing" || st.hole !== hole) return order;
    if (st.holeDone) {
      if (!opts.stopAtClose) await waitFor(w, (r) => r.hole !== hole || r.status !== "playing", 8000, "the next hole");
      return order;
    }
    const seat = st.turn;
    const sock = socks.find((s) => s.seat === seat);
    if (!sock) { await sleep(10); continue; }
    const v = st.v;
    const shot = roles[seat] === "good" ? goodShot(st, seat) : WEAK;
    order.push(seat);
    sock.emit("shoot", shot);
    await waitFor(w, (r) => r.v > v, 6000, "a putt");
  }
  check(false, "a hole never finished", `hole ${hole + 1}, round card ${round}`);
  return order;
}
async function startRound(host, holes) {
  if (holes) { host.emit("settings", { holes }); await waitFor(host, (r) => r.holes === holes, 4000, "the hole count"); }
  host.emit("start");
  await waitFor(host, (r) => r.status === "playing", 6000, "the round");
}
const firstStateOf = (s, hole) => s.hist.find((r) => r.status === "playing" && r.hole === hole);

(async () => {
  // ------------------------------------------------------------ refusals
  section("refusals carry a code as well as the words");
  {
    const a = mk(URL, "Ana");
    await connected(a);
    a.emit("join", { code: "ZZZZZZ", name: "Ana" });
    let e = await waitErr(a, 1);
    check(e && e.msg === "No room with that code." && e.detail && e.detail.code === "not_found" && e.detail.op === "join",
      "an unknown code", JSON.stringify(e));
    a.emit("create", { name: "   " });
    e = await waitErr(a, 2);
    check(e && e.msg === "Pick a name first." && e.detail.code === "name", "no name", JSON.stringify(e));

    const host = await create(URL, "Hostess");
    for (let k = 0; k < 5; k++) host.emit("addBot");
    await waitFor(host, (r) => r.players.length === 6, 4000, "a full room");
    const late = mk(URL, "Late");
    await connected(late);
    late.emit("join", { code: host.st.code, name: "Late" });
    e = await waitErr(late, 1);
    check(e && e.msg === "Room is full (6)." && e.detail.code === "full", "a full room", JSON.stringify(e));

    const h2 = await create(URL, "Starter");
    await startRound(h2);
    late.emit("join", { code: h2.st.code, name: "Late" });
    e = await waitErr(late, 2);
    check(e && e.msg === "That round already started." && e.detail.code === "started", "a started round", JSON.stringify(e));

    h2.emit("shoot", { aim: "left", power: 0.5 });
    e = await waitErr(h2, 1);
    check(e && e.msg === "Bad shot." && e.detail.code === "bad_shot" && e.detail.op === "shoot", "a bad shot", JSON.stringify(e));
    check(typeof e.msg === "string", "the first argument is no longer the words today's app reads");
    console.log("  not_found, name, full, started, bad_shot: each with today's words first");
  }

  // ------------------------------------------------------------ hostile payloads
  section("a hostile payload cannot take the server down");
  {
    const x = mk(URL, "X");
    await connected(x);
    const events = ["create", "join", "settings", "ballColor", "addBot", "removeBot", "start", "shoot", "rematch",
      "takeSeat", "pushToken", "presence", "chat", "voice", "leave"];
    for (const ev of events) for (const bad of [null, 7, "text", [1, 2], true]) x.emit(ev, bad);
    x.emit("create", { name: "Mallory" });
    await waitFor(x, (r) => r.code, 4000, "a room after the junk");
    for (const ev of events) for (const bad of [null, 7, "text", [1, 2], true]) x.emit(ev, bad);
    await sleep(300);
    const y = await create(URL, "StillUp");
    check(!!y.st.code, "the server stopped answering after null, number, string and array payloads");
    console.log(`  ${events.length * 10} junk frames; the server still seats a new room`);
  }

  // ------------------------------------------------------------ one socket, one room
  section("one socket, one room");
  {
    const x = await create(URL, "Xena");
    const roomA = x.st.code;
    const y = await join(URL, roomA, "Yuri");
    x.emit("create", { name: "Xena", playerId: x.pid });
    await waitFor(x, (r) => r.code !== roomA, 4000, "Xena's second room");
    const roomB = x.st.code;
    await waitFor(y, (r) => r.players[0].connected === false, 4000, "Xena's old seat going dark");
    check(y.st.players[0].connected === false, "the socket that moved still holds its old seat");
    const before = x.hist.length;
    y.emit("chat", { text: "anyone here?" });
    await waitFor(y, (r) => (r.chat || []).length > 0, 4000, "a chat line in the old room");
    await sleep(200);
    check(x.hist.slice(before).every((r) => r.code === roomB), "a socket still hears the room it left",
      x.hist.slice(before).map((r) => r.code).join(","));
    // and back again, by playerId: the old seat lights up, the new one goes dark
    x.emit("join", { code: roomA, name: "Xena", playerId: x.pid });
    await waitFor(y, (r) => r.players[0].connected === true, 4000, "Xena back in the first room");
    check(x.st.code === roomA, "rejoining the first room did not take");
    console.log("  a create or join from inside a room leaves the old one, as a disconnect would");
  }

  section("a reconnect is not undone by the old socket going");
  {
    const host = await create(URL, "Holly");
    const old = await join(URL, host.st.code, "Rae");
    const fresh = mk(URL, "Rae", { playerId: old.pid });
    await connected(fresh);
    fresh.emit("join", { code: host.st.code, name: "Rae", playerId: old.pid });
    await waitFor(fresh, (r) => fresh.seat === 1, 4000, "the new socket seated");
    old.disconnect();
    await sleep(400);
    check(host.st.players[1].connected === true, "the old socket's timeout marked a connected player away");
    fresh.disconnect();
    await waitFor(host, (r) => r.players[1].connected === false, 4000, "the last socket going");
    console.log("  still connected while any socket holds the seat");
  }

  // ------------------------------------------------------------ names
  section("names: 18 whole characters, on every path");
  {
    const cases = [
      ["\u{1F44D}\u{1F3FD}".repeat(25), "\u{1F44D}\u{1F3FD}".repeat(18), "skin-toned thumbs"],
      ["abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqr", "plain letters"],
      ["é".repeat(20), "é".repeat(18), "accented letters"],
      ["x".repeat(100000), "x".repeat(18), "a 100 KB name"],
      ["<Tom & \"Jerry\">", "Tom  Jerry", "markup"],
      ["\u{1F1EE}\u{1F1F3}".repeat(20), "\u{1F1EE}\u{1F1F3}".repeat(18), "flags"],
    ];
    for (const [given, want, what] of cases) {
      const s = await create(URL, given);
      const got = s.st.players[0].name;
      check(got === want, `${what}: the name came back wrong`, `${JSON.stringify(got).slice(0, 80)} (${got.length} units)`);
      check(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(got), `${what}: a character was cut in half`);
      s.disconnect();
    }
    const fam = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const s = await create(URL, "Avi", { avatar: fam });
    check(s.st.players[0].avatar === fam, "a family emoji avatar was cut", JSON.stringify(s.st.players[0].avatar));
    const t = await join(URL, s.st.code, "Two", { avatar: "\u{1F60E}\u{1F60E}" });
    check(t.st.players[1].avatar === "\u{1F60E}", "an avatar is one character", JSON.stringify(t.st.players[1].avatar));
    t.emit("join", { code: s.st.code, name: "z".repeat(40), playerId: t.pid });
    await waitFor(s, (r) => r.players[1].name === "z".repeat(18), 4000, "a rejoin's name capped");
    console.log(`  ${cases.length} names and two avatars, none cut mid-character`);
  }

  // ------------------------------------------------------------ colours
  section("ball colours");
  {
    const host = await create(URL, "Hue");
    host.emit("addBot");
    await waitFor(host, (r) => r.players.length === 2, 4000, "the bot");
    const g = await join(URL, host.st.code, "Guest");
    await waitFor(host, (r) => r.players.length === 3, 4000, "the guest");
    check(JSON.stringify(host.st.palette) === JSON.stringify(COLORS), "no palette in the state");
    check(host.st.players.every((p, s) => p.color === COLORS[s] && p.colorPicked === false), "the default colours moved",
      JSON.stringify(host.st.players.map((p) => p.color)));

    host.emit("ballColor", { index: 1 });
    await waitFor(host, (r) => r.players[0].color === COLORS[1], 4000, "the host's pick");
    check(host.st.players[0].colorPicked === true, "a pick is not marked");
    check(host.st.players[1].color === COLORS[0], "the bot did not move to the free colour", host.st.players[1].color);
    check(host.st.players[2].color === COLORS[2], "the guest's colour moved for no reason");

    g.emit("ballColor", { color: "#33D17A" });
    let e = await waitErr(g, 1);
    check(e && e.detail.code === "color_taken" && e.msg === "That colour is taken.", "a picked colour was taken twice", JSON.stringify(e));
    g.emit("ballColor", { color: "#123456" });
    e = await waitErr(g, 2);
    check(e && e.detail.code === "bad_color", "a colour off the palette", JSON.stringify(e));
    g.emit("ballColor", { index: 9 });
    e = await waitErr(g, 3);
    check(e && e.detail.code === "bad_color", "an index off the palette", JSON.stringify(e));
    g.emit("ballColor", { color: "#5b8cff" });
    await waitFor(host, (r) => r.players[2].color === "#5b8cff", 4000, "the guest's pick");
    const colours = host.st.players.map((p) => p.color);
    check(new Set(colours).size === colours.length, "two balls share a colour", colours.join(","));

    await startRound(host, 3);
    check(host.st.players.map((p) => p.color).join() === colours.join(), "colours changed at the start");
    g.emit("ballColor", { index: 4 });
    e = await waitErr(g, 4);
    check(e && e.detail.code === "started", "a colour change mid-round", JSON.stringify(e));
    console.log("  defaults unchanged until a pick; picks exclusive; lobby only");
  }

  // ------------------------------------------------------------ the server's clock
  section("the server's clock rides in every state");
  {
    const s = await create(URL, "Clock");
    s.emit("addBot");
    await waitFor(s, (r) => r.players.length === 2, 4000, "a bot");
    const times = s.hist.map((r) => r.serverNow);
    check(times.every((t) => typeof t === "number"), "a state without serverNow");
    check(times.every((t, i) => i === 0 || t >= times[i - 1]), "serverNow went backwards");
    check(s.clockSkew < 2000, "serverNow is not the server's clock", `${s.clockSkew} ms off`);
    console.log(`  ${times.length} states, all stamped, within ${s.clockSkew} ms of this machine`);
  }

  // ------------------------------------------------------------ the honour
  section("the honour: the last hole's winner putts first");
  {
    const a = await create(URL_FAST, "Ada");
    const b = await join(URL_FAST, a.st.code, "Bea");
    await startRound(a, 6);
    const s1 = firstStateOf(a, 0);
    check(s1.turn === 0 && s1.honour === 0, "hole 1 is not in seat order", `turn ${s1.turn} honour ${s1.honour}`);

    await playHole([a, b], { 0: "weak", 1: "good" });                  // Bea takes hole 1
    const s2 = firstStateOf(a, 1);
    check(s2 && s2.turn === 1 && s2.honour === 1, "the winner of hole 1 does not putt first on hole 2",
      s2 && `turn ${s2.turn} honour ${s2.honour}`);
    check(a.st.card[0] && a.st.points[1] === 1, "Bea did not take hole 1", JSON.stringify(a.st.points));

    await playHole([a, b], { 0: "weak", 1: "weak" });                  // nobody holes hole 2
    const s3 = firstStateOf(a, 2);
    check(s3 && s3.turn === 1 && s3.honour === 1, "a tied hole did not keep the honour where it was",
      s3 && `turn ${s3.turn} honour ${s3.honour}`);
    // picked up at the hole's own cap (two over its par, 5 to 8: Plato's small sign)
    const row2 = a.st.card[1] || [];
    check(row2.length === 2 && row2[0] === row2[1] && row2[0] >= 5 && row2[0] <= 8, "hole 2 was not picked up by both at its cap", JSON.stringify(a.st.card[1]));

    await playHole([a, b], { 0: "good", 1: "weak" });                  // Ada takes hole 3
    const s4 = firstStateOf(a, 3);
    check(s4 && s4.turn === 0 && s4.honour === 0, "the honour did not come back to Ada", s4 && `turn ${s4.turn}`);
    a.disconnect(); b.disconnect();
    console.log("  winner first; a tied hole keeps the order; the card and points agree");
  }

  section("the honour: seat order round from it, and a winner who left");
  {
    const a = await create(URL_FAST, "Ari");
    const b = await join(URL_FAST, a.st.code, "Bo");
    const cc = await join(URL_FAST, a.st.code, "Cy");
    await startRound(a, 6);
    await playHole([a, b, cc], { 0: "weak", 1: "weak", 2: "good" });   // Cy takes hole 1
    const s2 = firstStateOf(a, 1);
    check(s2 && s2.turn === 2 && s2.honour === 2, "Cy does not have the honour", s2 && `turn ${s2.turn}`);
    const order = await playHole([a, b, cc], { 0: "weak", 1: "good", 2: "weak" }, { stopAtClose: true });   // Bo takes hole 2
    check(order.slice(0, 3).join() === "2,0,1", "the turn does not go round in seat order from the honour", order.join());

    // Bo won hole 2 but leaves while it closes: the honour stays with Cy, who had it
    check(a.st.holeDone && a.st.holeWinner === 1 && a.st.hole === 1, "Bo did not take hole 2", JSON.stringify({ d: a.st.holeDone, w: a.st.holeWinner }));
    b.emit("leave");
    await waitFor(a, (r) => r.hole === 2, 4000, "hole 3");
    const s3 = firstStateOf(a, 2);
    check(s3 && s3.turn === 2 && s3.honour === 2 && s3.players[1].left, "a departed winner's honour did not stay with Cy",
      s3 && `turn ${s3.turn} honour ${s3.honour}`);
    for (const s of [a, b, cc]) s.disconnect();
    console.log("  2, 0, 1 from Cy; Bo gone, Cy keeps it");
  }

  // ------------------------------------------------------------ closing
  section("no putt while a hole is closing");
  {
    const a = await create(URL, "Ace");
    const b = await join(URL, a.st.code, "Bob");
    await startRound(a, 3);
    for (let guard = 0; guard < 40 && !a.st.holeDone && a.st.hole === 0; guard++) {
      const st = a.st, seat = st.turn, v = st.v;
      (seat === 0 ? a : b).emit("shoot", seat === 0 ? goodShot(st, 0) : WEAK);
      await waitFor(a, (r) => r.v > v, 4000, "a putt");
    }
    check(a.st.holeDone === true && a.st.hole === 0, "the closing state does not say so", `holeDone ${a.st.holeDone}`);
    const closer = a.st.turn, v = a.st.v, strokes = a.st.strokes.slice();
    check(closer === 1 && !a.st.done[1], "Bob should have evened up without holing", JSON.stringify({ closer, done: a.st.done }));
    b.emit("shoot", WEAK);
    await sleep(300);
    check(a.st.v === v && a.st.strokes[1] === strokes[1], "a putt was played on a closing hole", JSON.stringify(a.st.strokes));
    await waitFor(a, (r) => r.hole === 1, 5000, "hole 2");
    check(a.st.card[0][1] === strokes[1] && a.st.card[0][1] === a.st.card[0][0], "the card took an extra stroke", JSON.stringify(a.st.card[0]));
    a.disconnect(); b.disconnect();
    console.log("  refused during the pause; the card evens up exactly");
  }

  // ------------------------------------------------------------ the intro
  section("the hole intro: on the clock, not on the input");
  /* The bot plays for real, so now and then it picks up on hole 1 without holing out (about 1 round in 40
     at its skill, 0.72, with the farmyard's props; 1 in 65 before), nobody takes the hole and there is no
     honour to test. Such a room is played again, up to four times, rather than failing a rule it never reached. */
  for (let attempt = 1; attempt <= 4; attempt++) {
    const h = await create(URL_INTRO, "Ivy");
    h.emit("addBot");
    await waitFor(h, (r) => r.players.length === 2, 4000, "a bot");
    h.emit("start");
    await waitFor(h, (r) => r.status === "playing", 4000, "the round");
    const s = h.st;
    check(s.introEndsAt && Math.abs(s.introEndsAt - s.serverNow - 600) < 80, "hole 1 has no 600 ms intro",
      `introEndsAt - serverNow = ${s.introEndsAt - s.serverNow}`);
    check(s.turnEndsAt - s.introEndsAt === 1500, "the first turn's clock does not start after the intro",
      `${s.turnEndsAt - s.introEndsAt}`);
    // input is never locked: a putt during the intro plays
    const v = s.v;
    h.emit("shoot", WEAK);
    await waitFor(h, (r) => r.v > v && r.strokes[0] === 1, 4000, "a putt during the intro");
    check(h.st.introEndsAt === null, "the intro outlived the first putt");
    check(Math.abs(h.st.turnEndsAt - h.st.serverNow - 1500) < 80, "the second turn still carries the intro",
      `${h.st.turnEndsAt - h.st.serverNow}`);

    // the bot takes hole 1, so it has the honour on hole 2: its first putt waits out the intro
    for (let guard = 0; guard < 60 && h.st.status === "playing" && h.st.hole === 0; guard++) {
      if (h.st.turn === 0 && !h.st.holeDone && !h.st.done[0]) { const vv = h.st.v; h.emit("shoot", WEAK); await waitFor(h, (r) => r.v > vv, 4000, "my putt"); }
      else await sleep(10);
    }
    await waitFor(h, (r) => r.hole === 1, 6000, "hole 2");
    const s2 = firstStateOf(h, 1);
    const took = s2 && s2.points && s2.points[1] === 1;
    if (!took && attempt < 4) { h.disconnect(); console.log(`  the bot did not hole out on hole 1 (attempt ${attempt}, card ${JSON.stringify(s2 && s2.card)}, points ${JSON.stringify(s2 && s2.points)}): again`); continue; }
    check(s2 && s2.turn === 1, "the bot won hole 1 but does not putt first", s2 && `turn ${s2.turn}`);
    await waitFor(h, (r) => r.lastShot && r.hole === 1, 6000, "the bot's first putt on hole 2");
    const shot = h.st.lastShot;
    check(shot.seat === 1 && shot.at >= s2.introEndsAt + 20, "the bot putted inside the intro",
      `putt at +${shot.at - (s2.introEndsAt - 600)} ms after the hole began`);
    h.disconnect();
    console.log(`  600 ms on the first clock; the bot's first putt ${shot.at - (s2.introEndsAt - 600)} ms into hole 2`);
    break;
  }

  // ------------------------------------------------------------ the windmill
  section("the windmill: only when every human can draw it");
  {
    const lone = await create(URL_FAST, "Wren", { caps: ["windmill", "something-else"] });
    lone.emit("addBot");
    await waitFor(lone, (r) => r.players.length === 2, 4000, "a bot");
    check(lone.st.opts && lone.st.opts.windmill === true, "the windmill setting is not on by default");
    await startRound(lone);
    check(lone.st.windmill === true, "a room of windmill apps did not get the windmill");
    lone.disconnect();

    const mixed = await create(URL_FAST, "New", { caps: ["windmill"] });
    const oldApp = await join(URL_FAST, mixed.st.code, "Old");
    await startRound(mixed);
    check(mixed.st.windmill === false, "a player on an older app got the windmill");
    mixed.disconnect(); oldApp.disconnect();

    const off = await create(URL_FAST, "Off", { caps: ["windmill"] });
    off.emit("settings", { windmill: false });
    await waitFor(off, (r) => r.opts.windmill === false, 4000, "the host turning it off");
    await startRound(off);
    check(off.st.windmill === false, "the host's off switch was ignored");
    off.disconnect();
    console.log("  on for windmill apps, off with any older app, off at the host's word");
  }

  section("the long holes: only when every human's app draws them");
  {
    const tall = await create(URL_FAST, "Tess", { caps: ["windmill", "tall"] });
    tall.emit("addBot");
    await waitFor(tall, (r) => r.players.length === 2, 4000, "a bot");
    await startRound(tall);
    const t1 = tall.st.course;
    check(tall.st.tall === true, "a room of tall apps did not get the long holes");
    check(t1 && JSON.stringify(t1.outline) === JSON.stringify(c.HOLES_TALL[0].outline) && JSON.stringify(t1.tee) === JSON.stringify(c.HOLES_TALL[0].tee),
      "the long room's hole 1 is not the tall hole 1", t1 && JSON.stringify(t1.outline));
    tall.disconnect();

    const mixed = await create(URL_FAST, "Tom", { caps: ["windmill", "tall"] });
    const oldApp = await join(URL_FAST, mixed.st.code, "Old", { caps: ["windmill"] });
    await startRound(mixed);
    check(mixed.st.tall === false, "a player on an older app got the long holes");
    check(JSON.stringify(mixed.st.course.outline) === JSON.stringify(c.HOLES[0].outline), "the mixed room's hole 1 is not the classic one");
    mixed.disconnect(); oldApp.disconnect();
    console.log("  long holes for rooms of tall apps, the classic ones with any older app");
  }

  section("the windmill on hole 5, played exactly as the state says");
  {
    const w = await create(URL_FAST, "Wynn", { caps: ["windmill"] });
    await startRound(w);
    check(w.st.windmill === true, "no windmill this round");
    while (w.st.status === "playing" && w.st.hole < 4) {
      check(!w.st.course.windmill, `hole ${w.st.hole + 1} has a windmill`);
      await playHole([w], { 0: "good" });
    }
    await waitFor(w, (r) => r.hole === 4, 6000, "hole 5");
    const wm = w.st.course.windmill;
    check(wm && wm.sails === 4 && wm.door.length === 2 && wm.piers.length === 2 && typeof wm.epoch === "number" && wm.a0 === 0,
      "hole 5's windmill is not in the state", JSON.stringify(wm));
    const classic = c.HOLES[4];
    check(JSON.stringify(w.st.course.obstacles) === JSON.stringify(classic.obstacles) && w.st.course.name === classic.name,
      "the windmill hole changed the rest of Lean Left");

    // a putt dated 100 ms back is played with the sails where they stood then (a date
    // before the hole began would be clamped to its start, so let the hole run a moment)
    await sleep(250);
    const from = w.st.ball[0].slice(), v = w.st.v;
    const aim = Math.PI / 2 - 0.08, power = 0.55;
    const sent = Date.now();
    w.emit("shoot", { aim, power, at: sent - 100 });
    await waitFor(w, (r) => r.v > v && r.lastShot, 4000, "the windmill putt");
    const shot = w.st.lastShot;
    check(shot.at === sent - 100, "the putt was not dated as asked", `${shot.at - sent}`);
    const want = c.sailAngle(0, shot.at - wm.epoch);
    check(Math.abs(shot.wm - want) < 1e-9, "the sails at the strike are not where the state says", `${shot.wm} vs ${want}`);
    const replay = c.simulate(c.HOLES_WINDMILL[4], from, aim, power, { wm0: shot.wm });
    check(JSON.stringify(replay.path) === JSON.stringify(shot.path), "the putt cannot be replayed from the state");

    // a date from long ago is clamped to the leeway
    if (w.st.status === "playing" && w.st.hole === 4 && w.st.turn === 0 && !w.st.holeDone) {
      const v2 = w.st.v, sent2 = Date.now();
      w.emit("shoot", { aim, power: 0.3, at: sent2 - 60000 });
      await waitFor(w, (r) => r.v > v2, 4000, "a putt dated a minute ago");
      const at2 = w.st.lastShot.at;
      check(at2 >= sent2 - 300 && at2 <= Date.now(), "an old date was not clamped", `${at2 - sent2} ms`);
    }
    w.disconnect();
    console.log("  course.windmill on hole 5 only; lastShot.at and .wm replay the putt exactly");
  }

  // ------------------------------------------------------------ heartbeat
  section("the heartbeat is the default unless asked for");
  {
    const d = mk(URL, "Beat"), f = mk(URL_INTRO, "Fast");
    await connected(d); await connected(f);
    const beat = (s) => [s.io.engine._pingInterval, s.io.engine._pingTimeout].join("/");   // from the handshake
    check(beat(d) === "25000/20000", "the default heartbeat changed", beat(d));
    check(beat(f) === "4000/3000", "PING_INTERVAL_MS / PING_TIMEOUT_MS were ignored", beat(f));
    d.disconnect(); f.disconnect();
    console.log("  25 s + 20 s by default; the env sets it");
  }

  // ------------------------------------------------------------ today's app
  section("an app that knows none of this still plays a full round");
  {
    const s = await create(URL_FAST, "Legacy");
    s.emit("addBot"); s.emit("addBot");
    await waitFor(s, (r) => r.players.length === 3, 4000, "two bots");
    await startRound(s, 3);
    check(s.st.windmill === false, "an older app got the windmill");
    check(s.st.players.every((p, i) => p.color === COLORS[i]), "an older app's colours moved");
    let guard = 0;
    while (s.st.status === "playing" && guard++ < 400) {
      if (s.st.turn === s.seat && !s.st.done[s.seat] && !s.st.holeDone) { const v = s.st.v; s.emit("shoot", goodShot(s.st, s.seat)); await waitFor(s, (r) => r.v > v, 6000, "my putt"); }
      else await sleep(10);
    }
    check(s.st.status === "over" && s.st.card.length === 3, "the round did not finish", `${s.st.status} ${s.st.card.length}`);
    check(s.errs.length === 0, "the round threw refusals at an older app", JSON.stringify(s.errs));
    s.disconnect();
    console.log("  three holes with two bots, the honour moving, no refusals");
  }

  for (const s of all) try { s.close(); } catch (_) {}
  console.log(failures === 0 ? `\nworlds: all good (${checks} checks)\n` : `\nworlds: ${failures} failure(s) of ${checks}\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
