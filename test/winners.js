/* Mini Golf shared wins (the owner's phone, 2026-10-31: Birdie and Chip level on 3 holes and 22 shots, and Birdie was WINNER on seat order
   alone). Run: node test/winners.js   (starts its own server in process on TEST_PORT5, default 3651; never 3111-3124).

   Proves, over real sockets with the round ended on a chosen card: a round level on everything that decides the mode is a shared win
   (`winners` holds every seat level at the top, `winner` the first of them, for older apps) in the race, in stroke play and in closest
   to the pin; a tie that the strokes (or the holes, or the distance) break is one winner, whichever seat it is; the last line says
   what they share, or that the shots decided it with the holes level; every co-winner gets the win reaction; `winners` is empty
   until the round ends and again after a rematch. */
"use strict";
const { io } = require("socket.io-client");

const PORT = Number(process.env.TEST_PORT5 || 3651);
if (PORT >= 3111 && PORT <= 3124) { console.error("refusing " + PORT); process.exit(2); }
Object.assign(process.env, { PORT: String(PORT), ROLL_REST: "0", BOT_MS: "20", HOLE_INTRO_MS: "0", HOLE_PAUSE_MS: "100", TURN_MS: "600000", REACT_BOTS_ALWAYS: "1" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, extra) => { console.log((ok ? "PASS " : "FAIL ") + what + (!ok && extra ? "  " + extra : "")); if (!ok) failed++; };
const section = (n) => console.log("\n" + n);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };
const pid = () => "w" + Math.random().toString(36).slice(2, 12);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// every call to the reactions module, to see who was told "win"
const Reactions = require("../reactions");
const events = [];
const realEvent = Reactions.event;
Reactions.event = (room, seat, mood, ...rest) => { events.push({ seat, mood }); return realEvent(room, seat, mood, ...rest); };
const mine = require("../server");

function mk() {
  const s = io(`http://localhost:${PORT}`, { transports: ["websocket"], reconnection: false, forceNew: true });
  s.st = null; s.seat = -1; s.states = [];
  s.on("state", (f) => { s.st = f.room; s.seat = f.mySeat; s.states.push(f.room); });
  return s;
}

/* A started room of three people (Ann, Bo, Cy): hole 3 of 3 is under way. */
async function round() {
  const a = mk();
  await until(() => a.connected);
  a.emit("create", { name: "Ann", playerId: pid() });
  await until(() => a.st && a.st.code);
  const others = [];
  for (const name of ["Bo", "Cy"]) {
    const b = mk();
    await until(() => b.connected);
    b.emit("join", { code: a.st.code, name, playerId: pid() });
    await until(() => b.st && b.seat === others.length + 1);
    others.push(b);
  }
  a.emit("settings", { holes: 3 });
  await sleep(100);
  a.emit("start");
  await until(() => a.st && a.st.status === "playing");
  const rm = [...mine.__rooms.values()].find((x) => x.code === a.st.code);
  return { a, all: [a, ...others], rm };
}

/* Ends the round on a card: card[h][seat] are the strokes of the first two holes, last the third's, points the holes taken. */
function endOn(rm, { scoring = "holes", card, last, points, pin }) {
  rm.opts.scoring = scoring;
  rm.holes = 3; rm.hole = 2;
  rm.card = card.map((r) => r.slice());
  rm.strokes = last.slice(); rm.done = last.map(() => true);
  rm.points = points.slice();
  if (pin) rm.pinTotal = pin.slice();
  mine.__advance(rm);
  mine.__bump(rm);
}

async function finishWith(spec) {
  const { a, all, rm } = await round();
  endOn(rm, spec);
  await until(() => a.st.status === "over");
  const st = a.st;
  // everyone is told the same
  const alike = all.every((c) => c.st.status === "over" && same(c.st.winners, st.winners) && c.st.winner === st.winner);
  return { a, all, rm, st, alike };
}
const close = ({ all }) => all.forEach((c) => c.close());

// a round of three holes: seat totals are the card plus the last hole
const lastOf = (...v) => v;

(async () => {
  try {
    await new Promise((r) => (mine.server.listening ? r() : mine.server.once("listening", r)));

    section("an ordinary round has no winners until it ends");
    {
      const { a, all, rm } = await round();
      check(same(a.st.winners, []) && a.st.winner === null, "while it is played, winner is null and winners is empty", JSON.stringify([a.st.winner, a.st.winners]));
      check(Array.isArray(rm.winners), "the room carries the list from the start");
      close({ all });
    }

    section("a full tie in the race: 3 holes and 22 shots each");
    {
      // Ann and Bo level on 3 holes and 22 shots (7+7+8 each), Cy behind on 1 hole
      const r = await finishWith({ card: [[7, 7, 9], [7, 7, 9]], last: lastOf(8, 8, 9), points: [3, 3, 1] });
      check(same(r.st.winners, [0, 1]), "both seats are in winners", JSON.stringify(r.st.winners));
      check(r.st.winner === 0, "winner is the first of them, for older apps", String(r.st.winner));
      check(r.st.log === "Ann and Bo share it: 3 holes, 22 shots each!", "the line says what they share", r.st.log);
      check(r.alike, "everyone at the table is told the same");
      check(r.st.status === "over", "the round is over");
      close(r);
    }

    section("a three way tie, and a seat that left is no winner");
    {
      const r = await finishWith({ card: [[6, 6, 6], [6, 6, 6]], last: lastOf(6, 6, 6), points: [2, 2, 2] });
      check(same(r.st.winners, [0, 1, 2]), "all three share it", JSON.stringify(r.st.winners));
      check(r.st.log === "Ann, Bo and Cy share it: 2 holes, 18 shots each!", "three names read as a list", r.st.log);
      close(r);
      const q = await round();
      q.rm.players[1].left = true;
      endOn(q.rm, { card: [[5, 5, 5], [5, 5, 5]], last: lastOf(5, 5, 5), points: [2, 2, 2] });
      await until(() => q.a.st.status === "over");
      check(same(q.a.st.winners, [0, 2]), "the seat that left is not among them", JSON.stringify(q.a.st.winners));
      close(q);
    }

    section("level on holes, the shots decide: one winner, whichever seat");
    {
      const r = await finishWith({ card: [[7, 7, 9], [7, 7, 9]], last: lastOf(7, 8, 9), points: [3, 3, 1] });
      check(same(r.st.winners, [0]) && r.st.winner === 0, "fewer shots wins: Ann (21) over Bo (22)", JSON.stringify([r.st.winner, r.st.winners]));
      check(r.st.log === "Ann wins it on shots: level on 3 holes, 21 shots to 22!", "the line says the shots decided it, not holes to spare", r.st.log);
      close(r);
      const s = await finishWith({ card: [[7, 7, 9], [7, 7, 9]], last: lastOf(9, 8, 9), points: [3, 3, 1] });
      check(same(s.st.winners, [1]) && s.st.winner === 1, "and it is the later seat when that seat has fewer shots (Bo, 22 over Ann, 23)", JSON.stringify([s.st.winner, s.st.winners]));
      close(s);
    }

    section("more holes wins outright");
    {
      const r = await finishWith({ card: [[7, 7, 9], [7, 7, 9]], last: lastOf(9, 8, 9), points: [4, 2, 0] });
      check(same(r.st.winners, [0]) && r.st.winner === 0, "Ann takes it with the most holes whatever the shots", JSON.stringify([r.st.winner, r.st.winners]));
      check(r.st.log === "Ann wins it, 4 holes to spare!", "and the line is the old one, the holes", r.st.log);
      close(r);
    }

    section("stroke play");
    {
      // strokes level (22 each) and holes level: shared
      const r = await finishWith({ scoring: "strokes", card: [[7, 7, 9], [7, 7, 9]], last: lastOf(8, 8, 9), points: [1, 1, 0] });
      check(same(r.st.winners, [0, 1]) && r.st.winner === 0, "level on strokes and holes: shared", JSON.stringify([r.st.winner, r.st.winners]));
      check(r.st.log === "Ann and Bo share it: 22 strokes, 1 hole each!", "the line names the strokes and holes", r.st.log);
      close(r);
      // strokes level, the holes break it
      const s = await finishWith({ scoring: "strokes", card: [[7, 7, 9], [7, 7, 9]], last: lastOf(8, 8, 9), points: [1, 2, 0] });
      check(same(s.st.winners, [1]) && s.st.winner === 1, "level on strokes, more holes wins: Bo", JSON.stringify([s.st.winner, s.st.winners]));
      close(s);
      // fewest strokes wins
      const t = await finishWith({ scoring: "strokes", card: [[7, 7, 9], [7, 7, 9]], last: lastOf(8, 7, 9), points: [2, 0, 0] });
      check(same(t.st.winners, [1]) && /Bo wins it in 21 strokes!/.test(t.st.log), "the fewest strokes wins, whatever the holes", t.st.log);
      close(t);
    }

    section("closest to the pin");
    {
      const r = await finishWith({ scoring: "pin", card: [[1, 1, 1], [1, 1, 1]], last: lastOf(1, 1, 1), points: [2, 2, 1], pin: [120.5, 120.5, 300] });
      check(same(r.st.winners, [0, 1]) && r.st.winner === 0, "level on holes and distance: shared", JSON.stringify([r.st.winner, r.st.winners]));
      check(r.st.log === "Ann and Bo share it, closest on 2 holes each!", "the line says so", r.st.log);
      close(r);
      const s = await finishWith({ scoring: "pin", card: [[1, 1, 1], [1, 1, 1]], last: lastOf(1, 1, 1), points: [2, 2, 1], pin: [130, 120.5, 300] });
      check(same(s.st.winners, [1]) && s.st.winner === 1 && /Bo wins it, closest on 2 holes!/.test(s.st.log), "the nearer total takes a tie on holes: Bo", s.st.log);
      close(s);
    }

    section("every co-winner gets the win reaction");
    {
      events.length = 0;
      const { a, all, rm } = await round();
      // two bots in the seats that tie, a person in the other
      rm.players[0].bot = true; rm.players[1].bot = true;
      endOn(rm, { card: [[7, 7, 9], [7, 7, 9]], last: lastOf(8, 8, 9), points: [3, 3, 1] });
      await until(() => a.st.status === "over");
      const wins = events.filter((e) => e.mood === "win").map((e) => e.seat).sort();
      check(same(wins, [0, 1]), "the win event is raised for each of them, once", JSON.stringify(wins));
      await until(() => (rm.reactions || []).some((x) => x.seat === 0) && (rm.reactions || []).some((x) => x.seat === 1), 4000);
      check((rm.reactions || []).some((x) => x.seat === 0) && (rm.reactions || []).some((x) => x.seat === 1), "and each bot throws a sticker", JSON.stringify(rm.reactions));
      close({ all });
    }

    section("a rematch clears them");
    {
      const r = await finishWith({ card: [[7, 7, 9], [7, 7, 9]], last: lastOf(8, 8, 9), points: [3, 3, 1] });
      check(same(r.st.winners, [0, 1]), "level at the end");
      r.a.emit("rematch");
      await until(() => r.a.st.status === "playing");
      check(same(r.a.st.winners, []) && r.a.st.winner === null, "after the rematch there is no winner and no winners", JSON.stringify([r.a.st.winner, r.a.st.winners]));
      close(r);
    }
  } catch (e) { check(false, "threw: " + (e && e.stack || e)); }
  console.log(failed ? "\n" + failed + " FAILED" : "\nall shared win tests pass");
  process.exit(failed ? 1 : 0);
})();
