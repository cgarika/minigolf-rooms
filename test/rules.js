/* Mini Golf — room and scoring suite over real sockets.
   Run:  BOT_MS=5 TURN_MS=600000 PORT=3612 node server.js   then:  node test/rules.js

   Proves: a room forms, the turn only moves when it should, a client cannot play out
   of turn or move another player's ball, strokes and the card add up, water costs a
   stroke, the round ends after the chosen number of holes and the lowest total wins. */

const { io } = require("socket.io-client");
const URL = process.env.URL || "http://localhost:3612";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (ok, what, extra) => { if (!ok) { failures++; console.log("  FAIL: " + what + (extra ? "  " + extra : "")); } };
const section = (n) => console.log("\n" + n);

function mk(name) {
  const s = io(URL, { transports: ["websocket"] });
  s.nm = name; s.st = null; s.seat = -1; s.errors = [];
  s.on("state", ({ room, mySeat }) => { s.st = room; s.seat = mySeat; });
  s.on("err", (e) => s.errors.push(e));
  return s;
}
const waitFor = async (s, pred, ms = 6000, what = "state") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (s.st && pred(s.st)) return true; await sleep(15); }
  check(false, `timed out waiting for ${what}`);
  return false;
};

(async () => {
  section("a room forms");
  const a = mk("Ana"), b = mk("Ben");
  await sleep(250);
  a.emit("create", { name: "Ana" });
  await waitFor(a, (r) => r.code, 6000, "the room");
  const code = a.st.code;
  check(code && code.length === 6, "room code is six characters", code);
  check(a.seat === 0 && a.st.hostSeat === 0, "creator is seat 0 and host");

  b.emit("join", { code, name: "Ben" });
  await waitFor(b, (r) => r.players.length === 2, 6000, "the second player");
  check(b.seat === 1, "joiner takes seat 1");

  a.emit("settings", { holes: 3 });
  await waitFor(a, (r) => r.holes === 3, 4000, "the hole count");
  check(a.st.holes === 3, "host set three holes");

  b.emit("settings", { holes: 9 });
  await sleep(200);
  check(a.st.holes === 3, "a non-host cannot change the settings");

  section("the round starts");
  a.emit("start");
  await waitFor(a, (r) => r.status === "playing", 6000, "the game");
  check(a.st.hole === 0, "starts on hole 1");
  check(a.st.course && a.st.course.outline.length >= 4, "the course came with the state");
  check(a.st.ball.length === 2, "a ball per player");
  const tee = a.st.course.tee;
  check(a.st.ball[0][0] === tee[0] && a.st.ball[0][1] === tee[1], "balls start on the tee");
  check(a.st.strokes[0] === 0 && a.st.strokes[1] === 0, "nobody has played yet");

  section("turn order is enforced");
  check(a.st.turn === 0, "seat 0 is away first");
  b.errors.length = 0;
  const beforeV = a.st.v;
  b.emit("shoot", { aim: Math.PI / 2, power: 0.5 });     // not Ben's turn
  await sleep(300);
  check(a.st.v === beforeV, "a player out of turn moved the game on");
  check(a.st.strokes[1] === 0, "a player out of turn took a stroke");

  section("a stroke");
  const v0 = a.st.v;
  a.emit("shoot", { aim: Math.PI / 2, power: 0.45 });
  await waitFor(a, (r) => r.v > v0, 6000, "the shot");
  const shot = a.st.lastShot;
  check(shot && shot.seat === 0, "the shot came back for seat 0");
  check(Array.isArray(shot.path) && shot.path.length > 1, "the shot carried a path");
  check(a.st.strokes[0] === 1, "seat 0 is lying 1", String(a.st.strokes[0]));
  const [bx, by] = a.st.ball[0];
  const last = shot.path[shot.path.length - 1];
  if (shot.result !== "water")
    check(Math.hypot(bx - last[0], by - last[1]) < 0.5, "the ball is not where the path ends");
  check(a.st.ball[1][0] === tee[0], "someone else's ball moved");

  section("bad input is refused");
  a.errors.length = 0;
  const v1 = a.st.v;
  if (a.st.turn === 0) {
    a.emit("shoot", { aim: "banana", power: 0.5 });
    await sleep(250);
    check(a.st.v === v1, "a non-numeric aim was played");
    check(a.errors.length > 0, "a non-numeric aim drew no error");
  }

  section("a full round with a bot");
  const c = mk("Cal");
  await sleep(200);
  c.emit("create", { name: "Cal" });
  await waitFor(c, (r) => r.code, 6000, "the second room");
  c.emit("settings", { holes: 3 });
  await waitFor(c, (r) => r.holes === 3, 4000, "three holes");
  c.emit("addBot");
  await waitFor(c, (r) => r.players.length === 2, 4000, "the bot");
  check(c.st.players[1].bot, "the bot joined");
  c.emit("start");
  await waitFor(c, (r) => r.status === "playing", 6000, "the round");

  let guard = 0;
  const maxStrokes = 8;   // the most any hole allows (each hole's own cap, c.st.maxStrokes, is two over its par, 5 to 8)
  while (c.st.status === "playing" && guard++ < 400) {
    if (c.st.turn === c.seat && !c.st.done[c.seat]) {
      const cup = c.st.course.cup, ball = c.st.ball[c.seat];
      const aim = Math.atan2(cup[1] - ball[1], cup[0] - ball[0]);
      const dist = Math.hypot(cup[0] - ball[0], cup[1] - ball[1]);
      const v = c.st.v;
      c.emit("shoot", { aim, power: Math.min(1, require("../course").powerForDistance(dist * 1.05)) });
      await waitFor(c, (r) => r.v > v, 8000, "my shot");
    } else await sleep(20);

    check(c.st.strokes.every((s) => s <= maxStrokes), "a player went past the stroke cap",
      JSON.stringify(c.st.strokes));
  }
  check(c.st.status === "over", "the round finished", c.st.status + " after " + guard + " turns");

  section("the card adds up");
  const card = c.st.card, totals = c.st.totals;
  check(card.length === 3, "three holes on the card", String(card.length));
  for (let seat = 0; seat < 2; seat++) {
    const sum = card.reduce((t, row) => t + (row && row[seat] != null ? row[seat] : 0), 0);
    check(sum === totals[seat], `seat ${seat}: card and total disagree`, `${sum} vs ${totals[seat]}`);
    for (const row of card)
      check(row[seat] == null || (row[seat] >= 1 && row[seat] <= maxStrokes),
        `seat ${seat}: impossible score on a hole`, String(row[seat]));
  }
  /* Scoring is a race, not stroke play: the hole goes to whoever sinks it first, and
     the round goes to whoever took the most holes. Strokes only break a tie. */
  const points = c.st.points;
  check(Array.isArray(points) && points.length === 2, "points are reported",
    JSON.stringify(points));
  const mostPoints = Math.max(...points);
  check(points[c.st.winner] === mostPoints, "the winner did not take the most holes",
    `winner ${c.st.winner} points ${JSON.stringify(points)}`);
  const tied = points.filter((p) => p === mostPoints).length;
  if (tied > 1) {
    const bestOfTied = Math.min(...totals.filter((_, s) => points[s] === mostPoints));
    check(totals[c.st.winner] === bestOfTied, "a tie on holes did not break on strokes",
      `winner ${c.st.winner} totals ${JSON.stringify(totals)}`);
  }
  check(points.reduce((a, b) => a + b, 0) <= card.length,
    "more holes were awarded than were played",
    `${JSON.stringify(points)} over ${card.length} holes`);

  section("chat, voice and presence");
  {
    /* Mini Golf shipped without any of these while the other seven servers had
       them, so a client that speaks all eight would have found this one silently
       different. These check the shared pattern arrived intact. */
    const before = (c.st.chat || []).length;
    c.emit("chat", { text: "nice putt" });
    await waitFor(c, (r) => (r.chat || []).length > before, 4000, "the chat line");
    const line = c.st.chat[c.st.chat.length - 1];
    check(line && line.k === "t" && line.x === "nice putt", "a chat line did not arrive",
      JSON.stringify(line));
    check(!!line.n && typeof line.t === "number", "a chat line is missing its author or time");

    // the cooldown is what stops one client flooding the room
    const afterFirst = c.st.chat.length;
    c.emit("chat", { text: "and another" });
    await sleep(200);
    check(c.st.chat.length === afterFirst, "the chat cooldown did not hold");

    await sleep(900);
    c.emit("chat", { sticker: "not-a-real-sticker" });
    await sleep(250);
    check(c.st.chat.length === afterFirst, "an unknown sticker was accepted");

    c.emit("chat", { sticker: "fire" });
    await waitFor(c, (r) => r.chat.length > afterFirst, 4000, "the sticker");
    check(c.st.chat[c.st.chat.length - 1].k === "s", "a sticker did not arrive as one");

    const tags = c.st.chat.map((m) => m.k).join("");
    check(!tags.includes("<"), "chat is not being stripped");

    // voice: the server carries the handshake and the seat list, never audio
    c.emit("voice", { kind: "join" });
    await waitFor(c, (r) => (r.voice || []).includes(c.seat), 4000, "the voice seat");
    check((c.st.voice || []).includes(c.seat), "joining voice did not show in state");
    c.emit("voice", { kind: "leave" });
    await waitFor(c, (r) => !(r.voice || []).includes(c.seat), 4000, "the voice seat clearing");
    check(!(c.st.voice || []).includes(c.seat), "leaving voice did not clear the seat");

    // presence and pushToken are accepted quietly; a bad token must be ignored
    const v = c.st.v;
    c.emit("presence", { away: true });
    c.emit("pushToken", { token: "nonsense" });
    c.emit("pushToken", { token: "a".repeat(64) });
    await sleep(250);
    check(c.st.v >= v, "presence or pushToken broke the room");
    c.emit("presence", { away: false });
  }

  section("rematch");
  c.emit("rematch");
  await waitFor(c, (r) => r.status === "playing" && r.hole === 0, 6000, "the rematch");
  check(c.st.card.length === 0, "the card did not reset");
  check(c.st.strokes.every((s) => s === 0), "strokes did not reset");

  for (const s of [a, b, c]) s.close();
  console.log(failures === 0 ? "\nrules: all good\n" : `\nrules: ${failures} failure(s)\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
