/* Mini Golf Rooms — self-hosted multiplayer mini golf.

   Same shape as the other GameNest game servers: rooms behind a 6-letter code, the
   server owns the rules, bots fill empty seats, and a turn that times out is played
   for you. What is different here is that the server also owns the physics — a client
   sends an aim and a power, the server simulates the putt and broadcasts the ball's
   whole path, so no client can decide where its own ball ends up.

   Everything added for the Sunset Cove world (the honour, the hole intro, the windmill,
   ball colours, refusal codes, the server clock) is additive: an app that has never
   heard of it sees the same messages with the same meaning, and plays correctly. */

const http = require("http");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { HOLES, courseSet, COURSES, liveHole, sailAngle, simulate, routeLength, VENT, ventClock, R: BALL_R } = require("./course");   // BALL_R: a ball's radius, in the units the tee box and every putt are in
const { createPool } = require("./bots");
const Reactions = require("./reactions");   // the cartoon stickers (2026-10-15)
const Quick = require("./quickmatch");   // quick play and ranked (2026-10-24)
const Plus = require("./plus");   // GameNest Plus: the room's flag and each player's look (2026-10-16)
const Gear = require("./gear");   // the gear table and what it does (gear.js; gear step 4, 2026-11-10)
const Moderation = require("./moderation");   // what players type, kept friendly (2026-10-18)

const app = express();
const BASE = (process.env.BASE_PATH || "").replace(/\/$/, "");
if (BASE) app.use((req, res, next) => { if (req.path === BASE) return res.redirect(301, BASE + "/"); next(); });
app.use(BASE || "/", express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
/* Heartbeat. socket.io's defaults (25 s + 20 s) notice a dead link only after up to 45 s;
   QA T9 asks for 5 s + 5 s. Opt in with PING_INTERVAL_MS / PING_TIMEOUT_MS: the app
   answers pings on its game thread, so a load hitch longer than the timeout would drop
   the socket (it rejoins), and that wants a check on the phone before it is the default. */
const PING = {};
if (Number(process.env.PING_INTERVAL_MS) > 0) PING.pingInterval = Number(process.env.PING_INTERVAL_MS);
if (Number(process.env.PING_TIMEOUT_MS) > 0) PING.pingTimeout = Number(process.env.PING_TIMEOUT_MS);
const io = new Server(server, { path: BASE + "/socket.io", cors: { origin: true }, ...PING });

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 1;                 // golf is fine on your own
const MAX_PLAYERS = 6;
const TURN_MS = Number(process.env.TURN_MS || 45000);
const AFK_MS = Math.max(200, Number(process.env.AFK_MS || 6000));
const TIMEOUTS_TO_BOT = 3;
const BOT_MS = Math.max(1, Number(process.env.BOT_MS || 1500));   // a bot's thinking is scaled by BOT_MS / 1500: the tests that set it small think in no time
/* Golf pacing (2026-11-01, the outside review's first item: with three bots a median of 17 s passed between the human's own putts, a bot's think 5 s and more):
   a bot thinks 1 to 2.5 s by how hard the putt is, starting at the putt before it (so it overlaps that ball's roll and the table is putted on the moment it is still), and
   a bot's ball, never a person's, rolls out up to 1.5 times as fast once it has rolled for a second (the app plays it so). */
const BOT_THINK_MIN_MS = Number(process.env.BOT_THINK_MIN_MS ?? 1000);
const BOT_THINK_MAX_MS = Number(process.env.BOT_THINK_MAX_MS ?? 2500);
const BOT_ROLL_SPEEDUP = Math.max(1, Number(process.env.BOT_ROLL_SPEEDUP ?? 1.5));
const BOT_ROLL_NORMAL_MS = 1000;   // a bot's ball rolls at its own pace for this long, then faster
const BOT_REST_FRACTION = Math.min(1, Math.max(0.5, Number(process.env.BOT_REST_FRACTION ?? 0.65)));   // the next bot putts when the last ball has rolled this much of its roll (the creep to a stop is not waited on)
const botRollOut = (ms) => (ms <= BOT_ROLL_NORMAL_MS ? ms : BOT_ROLL_NORMAL_MS + (ms - BOT_ROLL_NORMAL_MS) / BOT_ROLL_SPEEDUP);
const ROOM_IDLE_MS = 2 * 3600e3;
const MAX_STROKES = 8;                 // the most any hole allows: pick it up after this and take the score
/* Each hole its own cap (Plato's small sign: 5, 6, 7 or 8 shots a hole): two over its par, never under 5 or over 8. A player who
   has used them all is OUT of the hole (done, with out[seat]). */
const maxStrokesOf = (h) => Math.max(5, Math.min(MAX_STROKES, (h && h.par ? h.par : 3) + 2));
/* A putt plays on the screens for as long as the ball rolls (its path is 60 samples a second): nobody putts, and no clock or bot
   starts, until every ball has come to rest and a beat has passed (Plato: one active player at a time). ROLL_REST=0 turns it off,
   for the test suites that putt as fast as they can. */
const ROLL_REST = process.env.ROLL_REST !== "0";
const REST_GAP_MS = Math.max(0, Number(process.env.REST_GAP_MS || 150));   // a beat between one ball's stop and the next putt (450 until 2026-11-01: golf pacing)
const SHOT_EARLY_MS = 350;             // a putt sent this much before the balls rest is let through (the clock's own slack)
const HOLE_PAUSE_MS = Math.max(0, Number(process.env.HOLE_PAUSE_MS || 1800));   // let the winning putt be seen (and at least until its ball has rolled in)
const AIM_RELAY_MS = 90;               // a player's live aim goes on to the others at most this often
/* Added to each hole's first turn and to a bot's first putt on it, so the app's change of hole (the scorecard and the new
   course fading in) is over before the clock or a bot starts. Input is never locked by it. It was 6 s for the swoop, which the
   app no longer plays (Plato: the next hole appears at once, 2026-10-31). */
const HOLE_INTRO_MS = Math.max(0, Number(process.env.HOLE_INTRO_MS ?? 1500));
/* How far back a client may date its putt (`at`, server time), so the windmill is played
   as the player saw it on screen. Older or future times are clamped to this window. */
const SHOT_LEEWAY_MS = Math.max(0, Number(process.env.SHOT_LEEWAY_MS ?? 250));
const NAME_GRAPHEMES = 18;             // one cap on every GameNest server, in whole characters
const CAPS = ["windmill", "tall", "courses", "vents"];     // what a client may say it can draw (tall: the 60-degree camera's long holes; courses: the other courses' own look and hidden-cup holes, 2026-11-01; vents: the Volcano's steam vents)

const COLORS = ["#ff5757", "#33d17a", "#ffc233", "#5b8cff", "#a78bfa", "#ff8c42"];
const BOT_NAMES = ["Birdie", "Chip", "Putter", "Ace", "Bogey"];
const AVATARS = ["\u{1F60E}", "\u{1F913}", "\u{1F451}", "\u{1F42F}", "\u{1F43C}", "\u{1F98A}"];
const CODE_ALPHABET = "ABCDEFGHJKMNPRTWXYZ";

const rooms = new Map();
app.get("/internal/roster/:code", Plus.rosterHandler((code) => rooms.get(code)));   // who is at a table, for the wallet's Treat the room (404 without GN_INTERNAL_SECRET)
/* GameNest Plus: a player says on create and join that they own Plus; a room
   whose host owns it is a Plus room, and every client shows its extras.
   The client's word is taken for now (checking Apple's receipt is a later step). */
function stampPlus(code, socket, said) {
  const room = rooms.get(code);
  const p = room && socket && socket.data && room.players.find((q) => q.id === socket.data.playerId);
  if (p) { Plus.stampFor(p, said, socket); Plus.dedupe(room, p); }
}
const roomSockets = new Map();
const timers = new Map();
const botTimers = new Map();
const holePauses = new Map();
const pool = createPool();             // a bot's practice swings run here (bots.js)

const newId = () => crypto.randomBytes(8).toString("hex");
function genCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}
function clearT(map, code) { const t = map.get(code); if (t) { clearTimeout(t); map.delete(code); } }

/* A payload is an object or nothing. `42["create",null]` used to throw inside the
   handler and take the whole process, and every room in it, down. */
const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

/* ---------- text ---------- */

const SEGMENTER = typeof Intl === "object" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/* At most `max` whole characters (grapheme clusters: an emoji with its skin tone, a flag,
   a letter and its accents) in at most `units` UTF-16 units, never cutting one in half. */
function graphemes(s, max, units) {
  s = String(s == null ? "" : s);
  if (s.length > 4 * units) s = s.slice(0, 4 * units);    // bounds the work on a 100 KB name
  let out = "", n = 0;
  const parts = SEGMENTER ? Array.from(SEGMENTER.segment(s), (x) => x.segment) : Array.from(s);
  for (const g of parts) {
    if (n >= max || out.length + g.length > units) break;
    out += g; n++;
  }
  return out;
}
const strip = (s) => String(s == null ? "" : s).replace(/[<>&"'`\u0000-\u001f\u007f]/g, "").trim();
const cleanName = (s) => { const c = graphemes(strip(s), NAME_GRAPHEMES, 96).trim(); return c ? Moderation.name(c) : c; };   // a bad name is "Player"
const cleanAvatar = (s) => graphemes(strip(s), 1, 16);
const cleanId = (s) => (typeof s === "string" && s.length > 0 && s.length <= 128 ? s : null);
const cleanCaps = (c) => (Array.isArray(c) ? CAPS.filter((k) => c.includes(k)) : []);

/* A refusal: today's words for today's app, and a code a newer one can switch on without
   reading English. The code rides as a second argument, which an app that reads only the
   first never sees. Codes: not_found, started, full, name, nobody, bad_shot, bad_color,
   color_taken. */
function refuse(socket, op, code, message) { socket.emit("err", message, { code, op }); }

/* ---------- chat, voice and push ----------

   Copied from ludo-rooms rather than reinvented, because a client that already
   speaks these seven servers must not find an eighth that is subtly different.
   Mini Golf is the newest server and shipped without any of them. */

const CHAT_KEEP = 60;
const CHAT_COOLDOWN_MS = 800;
const STICKERS = ["lol","cry","fire","dice","snail","devil","pray","skull","party","angry","pinch","run"];
const cleanChat = (n) => graphemes(String(n || "").replace(/[<>&"'`]/g, "").trim(), 140, 140);

const PUSH_URL = process.env.PUSH_URL || "";
const PUSH_TITLE = "Mini Golf";

function pushTo(p, body, data, collapse) {
  if (!PUSH_URL || !p || !p.pushToken || p.bot || p.left) return;
  // only someone who cannot see the screen
  if (!(p.away || !p.connected)) return;
  const now = Date.now();
  if (p._lastPush && now - p._lastPush < 4000) return;
  p._lastPush = now;
  fetch(PUSH_URL + "/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: p.pushToken, title: PUSH_TITLE, body, data: data || {}, collapse: collapse || undefined }),
  }).catch(() => {});
}

/* Fires on a change of situation, not on every broadcast: a putt animating for
   four seconds must not send four notifications. */
function pushTurn(room) {
  const key = room.status + "|" + room.turn;
  if (room._pushKey === key) return;
  room._pushKey = key;
  if (room.status !== "playing") return;
  const p = room.players[room.turn];
  if (!p) return;
  pushTo(p, "Your turn in " + PUSH_TITLE + ", room " + room.code,
    { code: room.code, game: PUSH_TITLE }, room.code + "-turn");
}

/* ---------- room shape ---------- */

function newRoom(code, host) {
  return {
    v: 1, code, host, status: "lobby",
    players: [],
    holes: Number(process.env.HOLE_COUNT || 9),
    hole: 0,                       // index into HOLES
    turn: 0,
    honour: null,                  // the seat that putts first on this hole
    ball: [],                      // per seat: [x, y]
    strokes: [],                   // per seat: strokes on the current hole
    done: [],                      // per seat: finished this hole
    card: [],                      // card[hole][seat] = strokes
    lastShot: null,
    winner: null,
    winners: [],                   // every seat that shares the win on a full tie; winner is the first of them (older apps read only that)
    log: "Share the code with your friends.",
    chat: [],
    turnEndsAt: null,
    gearOn: true,                  // the host's "gear" switch (private rooms); quick and ranked rooms always play with gear
    introEndsAt: null,             // the hole's first turn gets its intro until then
    holeStartedAt: null,           // server ms; the windmill's sails count from here
    opts: { windmill: true, scoring: "holes" },      // the host's choices
    windmill: false,               // is the windmill up this round (every human can draw it)
    tall: false,                   // are the long holes up this round (every human's app draws them, 2026-10-16)
    course: "meadow",              // the host's pick in the lobby (2026-11-01): one of COURSES
    playedCourse: "meadow",        // the course this round plays: the pick, or the Meadow where an app cannot draw long holes
    hidden: false,                 // are the covers up this round: every human's app draws them (a hidden-cup hole hides its cup under one)
    vents: true,                   // are the steam vents up this round: every human's app draws them (a hole's vents kick a ball)
    cupCover: null,                // the prop (a cover) the cup lies under on a hidden-cup hole: the server's secret until it is knocked flat
    round: 0,                      // counts rounds, so a bot's late answer cannot cross one
    touched: Date.now(),
  };
}

/* ---------- gear (gear.js, gear step 4) ---------- */
/* What a seat's gear does on this green: its stats when the room's gear switch is on, nothing (the base values) when it is off or the player sent none. A bot, and a person a bot putts
   for, plays the base physics (it plans its putts on them): its gear is the ball it wears and the score it shows, never an advantage. */
const NO_GEAR = Gear.golfEffects(null);
const gearStats = (room, p) => (room.gearOn !== false && p && p.gear ? p.gear.stats : null);
const gearFx = (room, p) => (p && !p.bot && !p.botControlled && !p.left ? Gear.golfEffects(gearStats(room, p)) : NO_GEAR);
const gearView = (room, p) => (p && p.gear ? { score: p.gear.score, items: Object.fromEntries(Object.entries(p.gear.slots).map(([k, v]) => [k, v.item])), levels: Object.fromEntries(Object.entries(p.gear.slots).map(([k, v]) => [k, v.level])), stats: room.gearOn !== false ? p.gear.stats : { power: 0, aim: 0, roll: 0, shot: 0 } } : null);
/* The bots' gear fits the humans' band: the mean of the humans' gear scores (a human with none counts as the starter set), and none at all when no human sent any (old apps: everyone at the base).
   Set when a game starts (a rematch follows who is there now) and for a bot added later. */
function botGearFor(room) {
  const hs = room.players.filter((p) => !p.bot && !p.left);
  if (!hs.some((p) => p.gear)) return null;
  return Gear.botGear("golf", Math.round(hs.reduce((n, p) => n + Gear.scoreFor(p.gear, "golf"), 0) / hs.length));
}
function gearBots(room) { for (const p of room.players) if (p.bot) p.gear = botGearFor(room); }

function holeSet(room) { return courseSet({ course: room.playedCourse, windmill: !!room.windmill, tall: !!room.tall, hidden: !!room.hidden, vents: room.vents !== false }); }
function hole(room) { const set = holeSet(room); return set[room.hole % set.length]; }

/* The lobby's table (the owner, 2026-11-01): behind the settings card the lobby shows hole 1 of the course the host has picked, as the round will play it, so a pick changes the table at
   once, for the host and for every guest. The Meadow's lobby is what it always was (the classic hole 1), and a room with an app that cannot draw the picked course (courseFor would play the
   Meadow) keeps that too. The state then says tall, as the round will. */
function lobbyLook(room) { return room.status === "lobby" && room.course !== "meadow" && courseFor(room) === room.course; }
function lobbyHole(room) { return courseSet({ course: room.course, tall: true, hidden: hiddenFor(room), vents: ventsFor(room) })[0]; }
function activeSeats(room) { return room.players.map((p, i) => i).filter((i) => !room.players[i].left); }

/* Ball colours. Until somebody picks, every seat has exactly the colour it always had
   (COLORS[seat]); a pick is exclusive, and a seat whose colour was picked by someone
   else takes the first one still free. */
function colorsOf(room) {
  const picked = room.players.filter((p) => p.colorPick != null).map((p) => p.colorPick);
  if (!picked.length) return room.players.map((_, s) => COLORS[s % COLORS.length]);
  const used = new Set(picked);
  return room.players.map((p, s) => {
    if (p.colorPick != null) return COLORS[p.colorPick];
    let k = s % COLORS.length;
    if (used.has(k)) { const free = COLORS.findIndex((_, j) => !used.has(j)); k = free >= 0 ? free : k; }
    used.add(k);
    return COLORS[k];
  });
}

/* The windmill, as a client needs it to draw the sails: sail 0 stands at
   a0 + omega * (serverTime - epoch) / 1000 radians from straight down. */
function windmillState(room, h) {
  const w = h.windmill;
  return {
    hub: w.hub, door: w.door, base: w.base, depth: w.depth, piers: w.piers, gate: w.gate,
    sails: w.sails, omega: w.omega, block: w.block,
    epoch: room.holeStartedAt, a0: 0,
  };
}

function publicRoom(room) {
  const lobbyTable = lobbyLook(room);
  const h = lobbyTable ? lobbyHole(room) : hole(room);
  const colors = colorsOf(room);
  const course = {
    tee: h.tee, cup: h.cup, outline: h.outline, obstacles: h.obstacles,
    sand: h.sand, water: h.water, sludge: h.sludge, ice: h.ice || [], props: h.props || [], broken: room.broken || [], bumpers: h.bumpers, wind: h.wind,
    boulders: room.boulders || h.boulders || [],
    ramps: h.ramps, tunnels: h.tunnels,
    par: h.par, name: h.name,
  };
  /* A hidden-cup hole (2026-11-01) never says where its cup is until the cover over it is knocked flat: no cup in the state, no flag on the
     course or the progress strip, and nothing in the props or anywhere else that tells the covers apart. */
  if (h.hidden) {
    course.hidden = true;
    if (cupFound(room, h)) course.cup = liveHole(h, room.broken, room.cupCover).cup; else delete course.cup;
  }
  if (h.solid) course.solid = true;               // props stand when hit (the long holes')
  if (h.teeBox) course.teeBox = h.teeBox;         // where a ball may be placed before the first putt (x0, y0, x1, y1)
  if (h.windmill) course.windmill = windmillState(room, h);
  /* The steam vents (the Volcano): where the grates are and the cycle they puff on, which a client draws from the server's clock as the windmill's sails are (the cycle stands at
     (serverTime - epoch + phase) mod (on + off), puffing for the first `on` ms of it). */
  if (h.vents && h.vents.length) { course.vents = h.vents; course.ventCycle = { epoch: room.holeStartedAt, on: VENT.on, off: VENT.off }; }
  return {
    code: room.code, status: room.status,
    players: room.players.map((p, s) => ({
      name: p.name, avatar: p.avatar, ...Plus.seat(p), bot: !!p.bot, botControlled: !!p.botControlled,
      left: p.left, connected: p.connected, color: colors[s], colorPicked: p.colorPick != null, gear: gearView(room, p),
    })),
    hostSeat: room.players.findIndex((p) => p.id === room.host),
    gearOn: room.gearOn !== false,
    minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, maxStrokes: maxStrokesOf(h),
    holes: room.holes, hole: room.hole, par: h.par, holeName: h.name,
    course,
    turn: room.turn, ball: room.ball, strokes: room.strokes, done: room.done,
    out: room.out || [], placed: room.placed || [], canPlace: room.canPlace || [],   // OUT (used every shot), on the course, and may still be placed in the tee box
    card: room.card, lastShot: room.lastShot, winner: room.winner, winners: room.winners || [],
    chat: room.chat, voice: room.voice ? Array.from(room.voice) : [],
    totals: totals(room), points: room.points, holeWinner: room.holeWinner,
    log: room.log, turnEndsAt: room.turnEndsAt,
    // additive, for newer apps
    serverNow: Date.now(),
    readyAt: ROLL_REST && room.restUntil ? room.restUntil : undefined,   // when every ball is still (server ms): a turn that arrives before it is waiting on the roll, not on the player
    honour: room.honour,
    introEndsAt: room.introEndsAt,
    holeDone: !!room.holeDone,
    windmill: !!room.windmill,
    tall: lobbyTable || !!room.tall,
    courseId: room.status === "lobby" ? room.course : room.playedCourse,   // the pick in the lobby, the course in play after (2026-11-01)
    courses: COURSES.map((c) => c.id),
    opts: { windmill: !!room.opts.windmill, scoring: isStrokePlay(room) ? "strokes" : isClosest(room) ? "pin" : "holes" },
    pinCm: isClosest(room) ? room.pinCm || null : null,   // closest to the pin: each ball's distance from the cup this hole, null before its putt
    palette: COLORS,
    v: room.v,
    ...Reactions.view(room),   // 2026-10-15: reactionsOn and the last reactions
    ...Quick.view(room),   // quick play and ranked (2026-10-24)
  };
}

function totals(room) {
  return room.players.map((_, seat) =>
    room.card.reduce((sum, row) => sum + (row && row[seat] != null ? row[seat] : 0), 0));
}

/* ---------- the waiting line (the owner, 2026-09-29) ----------
   Someone who joins a round already under way (and whose app says "waitList") waits in line,
   watching. A seat someone leaves mid-round goes to the first in line at once, keeping its
   scores (they play from the next hole: the leaver's hole is done); the rest are seated at the
   rematch, bots making room if the table is full. */
function takeLeftSeats(room) {
  if (!room.waiting || !room.waiting.length || room.status !== "playing") return false;
  let seated = false;
  for (let seat = 0; seat < room.players.length && room.waiting.length; seat++) {
    const old = room.players[seat];
    if (!old.left) continue;
    if (room.hidden && !(room.waiting[0].caps || []).includes("courses")) break;   // a hole with covers is not for an app that cannot draw them: it waits for the next round
    const w = room.waiting.shift();
    room.players[seat] = Object.assign({}, old, { id: w.id, name: w.name, avatar: w.avatar, bot: false, botControlled: false,
      left: false, connected: true, plus: w.plus, acct: w.acct, look: w.look, caps: w.caps, gear: w.gear || null, timeouts: 0 });
    room.log = `${w.name} took ${old.name}'s seat.`;
    seated = true;
  }
  return seated;
}
function seatTheLine(room) {
  while (room.waiting && room.waiting.length) {
    if (room.players.length >= MAX_PLAYERS) {
      const bot = room.players.findIndex((p) => p.bot);
      if (bot < 0) break;
      room.players.splice(bot, 1);
    }
    const w = room.waiting.shift();
    room.players.push({ id: w.id, name: w.name, avatar: w.avatar, left: false, connected: true, caps: w.caps, plus: w.plus, acct: w.acct, look: w.look, gear: w.gear || null });
  }
}
function lineState(room, st, playerId, seat) {
  st.waiting = (room.waiting || []).map((w) => ({ name: w.name, avatar: w.avatar }));
  st.waitPos = seat < 0 ? (room.waiting || []).findIndex((w) => w.id === playerId) + 1 : 0;
  return st;
}

function sendState(code) {
  const room = rooms.get(code), sockets = roomSockets.get(code);
  if (!room || !sockets) return;
  const pub = publicRoom(room);
  try { pushTurn(room); } catch (_) {}
  for (const s of sockets) {
    const mySeat = room.players.findIndex((p) => p.id === s.data.playerId);
    s.emit("state", { room: lineState(room, Object.assign({}, pub), s.data.playerId, mySeat), mySeat });
  }
}
function bump(room) { room.v++; room.touched = Date.now(); sendState(room.code); }

/* ---------- play ---------- */

/* Who has the honour on the next hole (golf/WORLD.md 6.6): whoever took the last hole.
   With no winner (everyone picked up) the order stands, as golf keeps the honour on a
   tied hole: the last hole's first putter keeps it, or, if they have gone, the next
   seat round from them. Hole 1 goes in seat order. */
function honourAfter(room, winner, honour) {
  const act = activeSeats(room);
  if (!act.length) return 0;
  if (winner != null && act.includes(winner)) return winner;
  if (honour == null) return act[0];
  if (act.includes(honour)) return honour;
  const after = act.filter((s) => s > honour);
  return after.length ? after[0] : act[0];
}

function startHole(room, first) {
  const h = hole(room);
  room.ball = room.players.map(() => [h.tee[0], h.tee[1]]);
  room.strokes = room.players.map(() => 0);
  room.done = room.players.map((p) => !!p.left);
  room.out = room.players.map(() => false);
  room.placed = room.players.map(() => false);          // on the green (placed in the tee box, or struck): the others' putts meet it
  room.canPlace = room.players.map(() => !!h.teeBox);   // may still choose the spot in the tee box
  room.lie = room.players.map(() => [h.tee[0], h.tee[1]]);   // where the last putt was struck from: where a knocked ball goes back to out of the water
  room.restUntil = 0;
  room.lastShot = null;
  room.broken = [];
  // a hidden-cup hole: the server picks which cover hides the cup, at random each game, and tells nobody until it is knocked flat
  room.cupCover = h.hidden ? h.hidden.covers[crypto.randomInt(h.hidden.covers.length)] : null;
  room.boulders = (h.boulders || []).map((b) => ({ x: b.x, y: b.y, r: b.r }));   // the big balls start where the hole puts them
  room.holeWinner = null;
  room.holeDone = false;
  room.pinCm = room.players.map(() => null);
  const act = activeSeats(room);
  room.turn = first != null && act.includes(first) ? first : (act.length ? act[0] : 0);
  room.honour = room.turn;
  const now = Date.now();
  room.holeStartedAt = now;
  room.introEndsAt = HOLE_INTRO_MS > 0 ? now + HOLE_INTRO_MS : null;
}

/* Only rooms where every human can draw the windmill get it, so nobody on an older app
   watches a ball bounce off something that is not there. Decided once a round. */
function windmillFor(room) {
  if (!room.opts.windmill) return false;
  const humans = room.players.filter((p) => !p.bot && !p.left);
  return humans.length > 0 && humans.every((p) => (p.caps || []).includes("windmill"));
}

/* The long holes (the 60-degree camera, 2026-10-16) only where every human's app draws
   them: an older app would frame a hole twice as long under its straight-down camera.
   Decided once a round, as the windmill is. */
function tallFor(room) {
  const humans = room.players.filter((p) => !p.bot && !p.left);
  return humans.length > 0 && humans.every((p) => (p.caps || []).includes("tall"));
}

/* The course a round plays (the owner, 2026-11-01): the host's pick, where every human's app can draw long holes (every course but the Meadow
   is long rooms); an older app that cannot gets the Meadow, as it gets the classic holes. Another course's holes are plain geometry, so an app
   that does not know the course draws them in the Meadow's paint and plays on. */
function courseFor(room) {
  const humans = room.players.filter((p) => !p.bot && !p.left);
  const ok = COURSES.some((c) => c.id === room.course) && humans.length > 0 && humans.every((p) => (p.caps || []).includes("tall"));
  return ok ? room.course : "meadow";
}

/* Covers (a hidden-cup hole) only where every human's app draws them, as the windmill is: an app that cannot would see a hole without a cup.
   Closest to the pin needs the cup in the open. Where they are off, a hole with covers is played plain, its cup in the open. */
function hiddenFor(room) {
  const humans = room.players.filter((p) => !p.bot && !p.left);
  return !isClosest(room) && humans.length > 0 && humans.every((p) => (p.caps || []).includes("courses"));
}

/* Steam vents (the Volcano's) only where every human's app draws them: a ball kicked by a puff of steam that is not on a screen would be a mystery. Where one cannot, the holes are played without them. */
function ventsFor(room) {
  const humans = room.players.filter((p) => !p.bot && !p.left);
  return humans.length > 0 && humans.every((p) => (p.caps || []).includes("vents"));
}

/* Has the cup of a hidden-cup hole been found: the cover it lies under is knocked flat. */
function cupFound(room, h) { return !h.hidden || (room.broken || []).includes(room.cupCover); }

function startGame(room) {
  room.status = "playing";
  room.round = (room.round || 0) + 1;
  room.holeDone = false;
  room.hole = 0;
  room.card = [];
  room.points = room.players.map(() => 0);
  room.pinTotal = room.players.map(() => 0);   // closest to the pin: each ball's distance over the round, for a tie
  room.winner = null;
  room.winners = [];
  room.windmill = windmillFor(room);
  room.tall = tallFor(room);
  room.playedCourse = courseFor(room);
  room.hidden = hiddenFor(room);
  room.vents = ventsFor(room);
  if (room.playedCourse !== "meadow") room.windmill = false;   // another course has no windmill
  gearBots(room);
  startHole(room, null);
  room.log = `Hole 1 — ${hole(room).name}, par ${hole(room).par}.`;
}

/* Whose turn is next on this hole: seat order round from the honour, skipping anyone
   already in. */
function nextTurn(room) {
  const act = activeSeats(room).filter((s) => !room.done[s]);
  if (act.length === 0) return false;
  const after = act.filter((s) => s > room.turn);
  room.turn = after.length ? after[0] : act[0];
  return true;
}

/* A hole ends once someone has sunk it AND everyone has had the same number of shots
   at it.

   "First to sink takes the hole" on its own is not a race, it is a seat draw: seat 0
   holing out in one would end the hole before seat 1 had played at all. Waiting for the
   turn cycle to even up costs nothing in feel — the putts still happen — and means the
   player who wins the hole beat everyone over the same number of strokes. */
/* Stroke play (the owner, 2026-10-15, "more reasons to replay"): the host's other way to score. Everyone plays every
   hole out (or picks up at the cap), and the fewest strokes over the round wins; holes taken break a tie. */
function isStrokePlay(room) { return !!room.opts && room.opts.scoring === "strokes"; }
/* Closest to the pin (the same day): one putt each a hole, and the ball nearest the cup takes it (in the cup is
   nearest of all); the round's total distance breaks a tie. A course unit is the ball's radius over a real ball's
   2.135 cm, so the state says it in centimetres. */
function isClosest(room) { return !!room.opts && room.opts.scoring === "pin"; }
const CM_PER_UNIT = 2.135 / BALL_R;

function holeFinished(room) {
  if (room.holeWinner == null || isStrokePlay(room) || isClosest(room)) return activeSeats(room).every((s) => room.done[s]);
  const need = room.strokes[room.holeWinner];
  return activeSeats(room).every((s) => room.done[s] || room.strokes[s] >= need);
}

function recordHole(room) {
  room.card[room.hole] = room.players.map((_, seat) => (room.strokes[seat] > 0 || room.done[seat] ? room.strokes[seat] : null));
}

/* How seat a stands against seat b at the end of the round, by what decides the mode: above 0 when a is ahead, 0 when the two
   are level on all of it. A race (the default): the most holes, then the fewest strokes. Stroke play: the fewest strokes, then
   the most holes. Closest to the pin: the most holes, then the least distance over the round. */
function standing(room, t, a, b) {
  const pts = (s) => room.points[s] || 0, far = (s) => (room.pinTotal || [])[s] || 0;
  if (isClosest(room)) return (pts(a) - pts(b)) || (far(b) - far(a));
  if (isStrokePlay(room)) return (t[b] - t[a]) || (pts(a) - pts(b));
  return (pts(a) - pts(b)) || (t[b] - t[a]);
}

/* Every active seat level at the top on everything that decides the mode, in seat order. One seat is a plain win; two or more
   share it (the owner's phone, 2026-10-31: Birdie and Chip level on 3 holes and 22 shots, and Birdie won on seat order alone). */
function roundWinners(room, t) {
  let winners = [];
  activeSeats(room).forEach((s) => {
    if (!winners.length) { winners = [s]; return; }
    const d = standing(room, t, s, winners[0]);
    if (d > 0) winners = [s]; else if (d === 0) winners.push(s);
  });
  return winners;
}

const joinNames = (names) => names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* The round's last line. A shared win says what they share; a race won on shots with the holes level says so, not "holes to spare". */
function roundLog(room, t, winners) {
  if (!winners.length) return "That's the round.";
  const w = winners[0], p = room.players, pts = room.points[w] || 0;
  if (winners.length > 1) {
    const who = joinNames(winners.map((s) => p[s].name));
    return isStrokePlay(room) ? `${who} share it: ${count(t[w], "stroke", "strokes")}, ${count(pts, "hole", "holes")} each!`
      : isClosest(room) ? `${who} share it, closest on ${count(pts, "hole", "holes")} each!`
      : `${who} share it: ${count(pts, "hole", "holes")}, ${count(t[w], "shot", "shots")} each!`;
  }
  if (isStrokePlay(room)) return `${p[w].name} wins it in ${t[w]} strokes!`;
  if (isClosest(room)) return `${p[w].name} wins it, closest on ${count(pts, "hole", "holes")}!`;
  const level = activeSeats(room).filter((s) => s !== w && (room.points[s] || 0) === pts);
  if (level.length) return `${p[w].name} wins it on shots: level on ${count(pts, "hole", "holes")}, ${count(t[w], "shot", "shots")} to ${Math.min(...level.map((s) => t[s]))}!`;
  return `${p[w].name} wins it, ${count(pts, "hole", "holes")} to spare!`;
}

function advance(room) {
  recordHole(room);
  room.holeDone = false;
  if (room.hole + 1 >= Math.min(room.holes, HOLES.length)) {
    room.status = "over";
    /* Most holes taken, not fewest strokes: the point is for sinking it first. Strokes
       break a tie, so being quick about it still counts for something. A tie that nothing
       breaks is shared: every seat level at the top wins. */
    const t = totals(room);
    const winners = roundWinners(room, t);
    room.winner = winners.length ? winners[0] : null;
    room.winners = winners;
    for (const s of winners) Reactions.event(room, s, "win", bump, 1200);
    room.turnEndsAt = null;
    room.introEndsAt = null;
    clearT(timers, room.code); clearT(botTimers, room.code);
    room.log = roundLog(room, t, winners);
    return;
  }
  const first = honourAfter(room, room.holeWinner, room.honour);
  room.hole++;
  startHole(room, first);
  const h = hole(room);
  room.log = `Hole ${room.hole + 1} — ${h.name}, par ${h.par}.`;
}

/* When a putt was struck, in server time: now, or the client's own `at` if it is within
   SHOT_LEEWAY_MS behind now (the windmill as the player saw it). Never before the hole. */
function strikeTime(room, at) {
  const now = Date.now();
  let t = Number.isFinite(at) ? Math.min(now, Math.max(now - SHOT_LEEWAY_MS, at)) : now;
  if (room.holeStartedAt != null) t = Math.max(t, room.holeStartedAt);
  return t;
}

/* Where sail 0 stands at time `t`, or undefined on a hole without the windmill. */
function sailsAt(room, t) {
  const h = hole(room);
  if (!h.windmill || room.holeStartedAt == null) return undefined;
  return sailAngle(0, t - room.holeStartedAt, h.windmill);
}

/* Where the steam vents' cycle stands at time `t` (ms into it), or undefined on a hole without vents. */
function ventsAt(room, t) {
  const h = hole(room);
  if (!h.vents || !h.vents.length || room.holeStartedAt == null) return undefined;
  return ventClock(t - room.holeStartedAt);
}

/* The one place a stroke happens. Returns false if it was not this seat's to play. `who`: "human" for a putt the seat's own phone sent (its gear rides on it: the putter's power, the
   ball's roll), anything else for a bot's or a timed-out seat's (planned on the base physics, played on them). */
function playStroke(room, seat, aim, power, at, who) {
  if (room.status !== "playing" || room.turn !== seat || room.done[seat]) return false;
  if (room.holeDone) return false;            // the hole is closing; the next one has not begun
  const h = hole(room);
  const when = at != null ? at : Date.now();
  const wm = sailsAt(room, when);
  const vt = ventsAt(room, when);
  // The props already knocked out this hole stand no longer (and a hidden-cup hole's cup is where the room put it).
  room.broken = room.broken || [];
  let live = liveHole(h, room.broken, room.cupCover);
  // The big balls stand wherever the last putt that moved them left them.
  if (h.boulders && h.boulders.length) live = { ...live, boulders: room.boulders || h.boulders };
  /* The other balls on the green are solid (Plato's, 2026-10-31): the putt meets them and knocks them away. Balls still in the rack
     (not placed, not struck) and balls already in are not on the green. Closest to the pin leaves every ball where it stopped. */
  const others = [];
  if (!isClosest(room)) {
    for (let s = 0; s < room.players.length; s++) {
      if (s === seat || room.done[s] || room.players[s].left) continue;
      if (!(room.placed[s] || room.strokes[s] > 0)) continue;
      others.push({ x: room.ball[s][0], y: room.ball[s][1], seat: s, lie: room.lie[s] || room.ball[s] });
    }
  }
  const fx = who === "human" ? gearFx(room, room.players[seat]) : NO_GEAR;
  const shot = simulate(live, room.ball[seat], aim, power, { wm0: wm, vt0: vt, others, gear: fx.speed !== 1 || fx.roll !== 1 ? { speed: fx.speed, roll: fx.roll } : null });
  for (const k of shot.broke || []) if (!room.broken.includes(k)) room.broken.push(k);
  if (shot.boulders) room.boulders = shot.boulders;
  room.strokes[seat]++;
  room.introEndsAt = null;                    // the intro is the first turn's alone

  /* Water costs only the putt it swallowed: the ball goes back to where it was struck from and the count stays one up
     (Plato's, 2026-10-31; it was one more on top). */
  const penalty = 0;
  const struckFrom = room.ball[seat].slice();
  room.lie[seat] = struckFrom;
  room.ball[seat] = shot.end;
  room.placed[seat] = true;
  // The ball may be set down again in the tee box only after a splash from inside it.
  const box = h.teeBox;
  const fromBox = !!box && struckFrom[0] >= box[0] && struckFrom[0] <= box[2] && struckFrom[1] >= box[1] && struckFrom[1] <= box[3];
  room.canPlace[seat] = shot.result === "water" && fromBox && room.strokes[seat] < maxStrokesOf(h);

  // Whatever the putt knocked: each ball lands where it rolled to, goes back out of the water, or drops in the cup.
  const knocked = [];
  for (const kb of shot.knock || []) {
    const s = kb.seat;
    knocked.push({ seat: s, result: kb.result, path: kb.path, end: kb.end });
    room.ball[s] = kb.end;
    if (kb.result === "water") room.canPlace[s] = false;
  }

  room.lastShot = {
    seat, aim, power, path: shot.path, result: shot.result, penalty,
    strokes: room.strokes[seat], mv: (room.lastShot ? room.lastShot.mv : 0) + 1, broke: shot.broke || [],
    moved: shot.moved || [],
    at: when,
  };
  if (knocked.length) room.lastShot.knock = knocked;
  if (wm !== undefined) room.lastShot.wm = wm;   // sail 0 at the strike; path point i is i/60 s later
  if (vt !== undefined) { room.lastShot.vt = vt; if (shot.kicks) room.lastShot.kicks = shot.kicks; }   // the vents' cycle at the strike (ms), and which grate kicked it at which step (1/240 s)

  const name = room.players[seat].name;
  // The bots' reactions (2026-10-15), once the app has rolled the ball home (its path is 60 points a second). A bot's own ball rolls out faster after its first second (BOT_ROLL_SPEEDUP); a person's, and any ball a bot knocks, never.
  const ownMs = (((shot.path && shot.path.length) || 0) * 1000) / 60;
  const knockMs = Math.max(0, ...knocked.map((k) => (((k.path && k.path.length) || 0) * 1000) / 60));
  const byBot = !!(room.players[seat].bot || room.players[seat].botControlled);
  const rolled = Math.round(Math.max(byBot ? botRollOut(ownMs) : ownMs, knockMs)) + 300;
  room.restFrom = Date.now();
  room.restMs = ROLL_REST ? rolled - 300 : 0;
  room.restUntil = ROLL_REST ? room.restFrom + room.restMs + REST_GAP_MS : 0;   // every ball is still until then (the clock waits for it)
  room.botRestUntil = ROLL_REST ? room.restFrom + room.restMs * BOT_REST_FRACTION + REST_GAP_MS : 0;   // and a bot putts a little before, once the last ball has all but stopped
  // A ball in waits for the app's hole-out card too (the big word, about 1.5 s), so a sticker never lands on it.
  if (shot.result === "holed" && room.holeWinner == null) Reactions.event(room, seat, room.strokes[seat] === 1 ? "win" : "good", bump, rolled + 1700);
  else if (shot.result === "water") Reactions.event(room, seat, "bad", bump, rolled);
  const cap = maxStrokesOf(h);
  if (shot.result === "holed") {
    room.done[seat] = true;
    const n = room.strokes[seat];
    /* The point goes to the first ball in and only the first. The others still get
       their shot, because the turn cycle evens up before the hole closes — so a later
       player can hole out too. They just do not get paid for it. */
    if (room.holeWinner == null && !isClosest(room)) {
      room.holeWinner = seat;
      room.points[seat]++;
      room.log = isStrokePlay(room) ? `${name} sank it in ${n}.` : `${name} sank it in ${n}. Takes the hole.`;
    } else {
      room.log = isStrokePlay(room) ? `${name} holed out in ${n}.` : `${name} holed out in ${n}, one behind.`;
    }
  } else if (shot.result === "water") {
    room.log = `${name} found the water.`;
    /* The cap holds in the water too (2026-10-17: a ball that kept finding a pond was never picked up, and
       the hole never closed; the autopilot found it on the long hole 7). */
    if (room.strokes[seat] >= cap) {
      room.done[seat] = true;
      room.out[seat] = true;
      room.log = `${name} found the water and is out of shots.`;
    }
  } else if (room.strokes[seat] >= cap) {
    room.done[seat] = true;
    room.out[seat] = true;
    room.log = `${name} is out of shots.`;
  } else {
    room.log = `${name} putted.`;
  }
  // A ball knocked into the cup counts for its owner (Plato's): the first ball in takes the hole's point, as it would have.
  for (const kb of knocked) {
    if (kb.result !== "holed" || room.done[kb.seat]) continue;
    room.done[kb.seat] = true;
    room.canPlace[kb.seat] = false;
    const who = room.players[kb.seat].name;
    if (room.holeWinner == null && !isClosest(room)) {
      room.holeWinner = kb.seat;
      room.points[kb.seat]++;
      room.log = `${name} knocked ${who} in. ${who} takes the hole.`;
    } else {
      room.log = `${name} knocked ${who} in.`;
    }
  }

  // the hole change waits a beat: clients need to show this putt going in before the
  // course underneath it is replaced
  if (isClosest(room)) {
    // One putt: wherever it stops is this hole's answer (the water's is the far end of nowhere).
    const cup = h.cup;
    const dist = shot.result === "holed" ? 0 : shot.result === "water" ? 9999 : Math.round(Math.hypot(room.ball[seat][0] - cup[0], room.ball[seat][1] - cup[1]) * CM_PER_UNIT);
    room.pinCm[seat] = dist;
    room.done[seat] = true;
    if (shot.result !== "holed") room.log = dist >= 9999 ? `${name} found the water — out of this one.` : `${name} stops ${dist} cm from the pin.`;
    if (activeSeats(room).every((s) => room.done[s])) {
      let best = -1;
      for (const s of activeSeats(room)) if (room.pinCm[s] != null && (best < 0 || room.pinCm[s] < room.pinCm[best])) best = s;
      if (best >= 0 && room.pinCm[best] < 9999) {
        room.holeWinner = best;
        room.points[best]++;
        room.log += ` ${room.players[best].name} is closest${room.pinCm[best] === 0 ? " — in the cup" : `, ${room.pinCm[best]} cm`}! Takes the hole.`;
      }
      room.pinTotal = room.pinTotal || room.players.map(() => 0);
      for (const s of activeSeats(room)) room.pinTotal[s] = (room.pinTotal[s] || 0) + Math.min(room.pinCm[s] == null ? 9999 : room.pinCm[s], 9999);
    }
  }
  if (holeFinished(room)) room.holeDone = true;
  else nextTurn(room);
  return true;
}

/* Arm the next turn's clock, then broadcast the stroke, or hold before the next hole.

   The clock is armed BEFORE the broadcast on every path (QA GN-10): a state must carry
   the deadline of the turn it shows. Broadcasting first sent each putt with the last
   turn's deadline, and a new hole with none at all, so the app's timer ring (and the
   hole intro) could never be read from the state. */
function afterStroke(room) {
  if (room.status === "playing" && !room.holeDone) { armTimer(room.code); bump(room); return; }
  if (room.status !== "playing") { bump(room); return; }

  clearT(timers, room.code);
  clearT(botTimers, room.code);
  clearT(holePauses, room.code);
  room.turnEndsAt = null;
  bump(room);
  // the winning putt rolls in before the course is replaced: the pause is at least as long as the ball's roll
  const pause = Math.max(HOLE_PAUSE_MS, ROLL_REST ? Math.max(0, (room.restUntil || 0) - Date.now()) + 800 : 0);
  holePauses.set(room.code, setTimeout(() => {
    holePauses.delete(room.code);
    const r = rooms.get(room.code);
    if (!r || !r.holeDone) return;
    advance(r);
    if (r.status === "playing") armTimer(r.code);
    bump(r);
  }, pause));
}

function scoreName(strokes, par) {
  const d = strokes - par;
  if (strokes === 1) return "hole in one!";
  if (d <= -3) return "albatross";
  if (d === -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  if (d === 2) return "double bogey";
  return `${d} over`;
}

/* ---------- timers and bots ---------- */

/* What a bot's answer was worked out for. Anything that changes whose putt it is, or
   from where, changes this, and an answer for an old key is thrown away. */
function turnKey(room) {
  return `${room.round}|${room.status}|${room.hole}|${room.turn}|${room.lastShot ? room.lastShot.mv : 0}|${room.holeDone ? 1 : 0}`;
}

/* Ask the pool which putt a bot would play for the seat whose turn it is. */
function think(room, skill, at) {
  const seat = room.turn;
  const h = hole(room);
  return pool.think({
    hole: room.hole % HOLES.length, windmill: !!room.windmill, tall: !!room.tall, course: room.playedCourse, hidden: !!room.hidden,
    from: room.ball[seat], skill, wm0: sailsAt(room, at), vt0: ventsAt(room, at), vents: room.vents !== false, boulders: room.boulders,
    // a bot hunts the covers like a player until the cup shows: it is told which cover hides it only then
    broken: room.broken || [], cupCover: h.hidden && cupFound(room, h) ? room.cupCover : null,
  });
}

function armTimer(code) {
  const room = rooms.get(code);
  clearT(timers, code);
  scheduleBot(code);
  if (!room || room.status !== "playing" || room.holeDone) { if (room) room.turnEndsAt = null; return; }
  const cur = room.players[room.turn];
  const ms = cur && !cur.bot && !cur.botControlled && !cur.connected ? AFK_MS : TURN_MS + (cur && !cur.bot && !cur.botControlled && !cur.left ? gearFx(room, cur).shotMs : 0);   // the grip adds seconds to a person's shot clock
  const now = Date.now();
  const from = Math.max(now, room.introEndsAt || 0, ROLL_REST ? room.restUntil || 0 : 0);   // the hole's first turn starts after its intro, every turn after the balls are still
  room.turnEndsAt = from + ms;
  timers.set(code, setTimeout(() => onTimeout(code), room.turnEndsAt - now));
}

function onTimeout(code) {
  timers.delete(code);
  const room = rooms.get(code);
  if (!room || room.status !== "playing" || room.holeDone) return;
  const p = room.players[room.turn];
  if (!p) return;
  let note = "";
  if (!p.bot && !p.botControlled) {
    p.timeouts = (p.timeouts || 0) + 1;
    if (p.timeouts >= TIMEOUTS_TO_BOT) { p.botControlled = true; note = `A bot is playing for ${p.name}.`; }
    else note = `${p.name} ran out of time; the shot was played for them.`;
  }
  const seat = room.turn, key = turnKey(room), at = Date.now();
  think(room, 0.6, at).then((shot) => {
    const r = rooms.get(code);
    if (!r || turnKey(r) !== key) return;         // someone putted meanwhile
    if (!playStroke(r, seat, shot.aim, shot.power, at)) return;
    if (note) r.log = `${note} ${r.log}`;
    afterStroke(r);
  });
}

/* How hard a putt looks, 0 to 1: the way round to the cup (walls, a door to find) against the way as the crow flies, and how far it is. A tap-in is 0; a long bank round walls is 1. On a
   hole whose cup is still hidden the bot hunts the covers, which is neither: it takes a middling think. */
function botThinkMs(room, seat) {
  const h = hole(room);
  let d = 0.5;
  if (!h.hidden || cupFound(room, h)) {
    const from = room.ball[seat], cup = h.hidden ? liveHole(h, room.broken || [], room.cupCover).cup : h.cup;
    const straight = Math.max(1, Math.hypot(cup[0] - from[0], cup[1] - from[1]));
    const route = routeLength({ ...h, cup }, from[0], from[1]);
    d = 0.5 * Math.max(0, Math.min(1, (route - 8) / 45)) + 0.5 * Math.max(0, Math.min(1, (route / straight - 1) / 0.8));
  }
  const scale = BOT_MS / 1500;
  const ms = (BOT_THINK_MIN_MS + (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS) * d) * (0.94 + 0.12 * Math.random());
  return Math.round(Math.max(BOT_THINK_MIN_MS, Math.min(BOT_THINK_MAX_MS, ms)) * scale);
}

/* A bot's putt: its thinking starts now, off the event loop, and the putt lands when
   the balls are still and its think time is up (plus the hole's intro, on the first turn). */
function scheduleBot(code) {
  clearT(botTimers, code);
  const room = rooms.get(code);
  if (!room) return;
  room.botPlan = null;
  if (room.status !== "playing" || room.holeDone) return;
  const p = room.players[room.turn];
  if (!p || !(p.bot || p.botControlled)) return;
  const now = Date.now();
  const intro = Math.max(0, (room.introEndsAt || 0) - now, ROLL_REST ? (room.botRestUntil || 0) - now : 0);   // not before the last ball has all but stopped
  /* The bot starts to think now, at the putt before its own, so its thinking overlaps that ball's roll: it putts the moment the table is still, or when it has thought for as long as the putt
     is hard if that is later (a tap-in a second, a long bank round walls two and a half). */
  const delay = Math.max(intro + 60, botThinkMs(room, room.turn));   // (a beat after the intro or the roll, never inside it)
  const plan = { key: turnKey(room), at: now + delay, shot: null, due: false, seat: room.turn };
  room.botPlan = plan;
  think(room, p.skill || 0.72, plan.at).then((shot) => {
    plan.shot = shot;
    if (plan.due) playPlan(code, plan); else animateBotAim(code, plan, 0);
  });
  botTimers.set(code, setTimeout(() => {
    botTimers.delete(code);
    plan.due = true;
    if (plan.shot) playPlan(code, plan);
  }, delay));
}

/* The others watch a bot line its putt up (Plato: the opponent's white aim line moves before they strike): from the end of the
   wait (the roll, the intro) to a beat before the strike, its aim settles on the putt it chose and its power builds, ten times a
   second, as aimLive events. The putt itself is unchanged: this only draws it. */
function animateBotAim(code, plan, wait) {
  const room = rooms.get(code);
  if (!room || room.botPlan !== plan || !plan.shot) return;
  const t0 = Math.max(Date.now() + wait, plan.at - 1300), t1 = plan.at - 200;   // it lines the putt up in the second before it strikes, as the last ball comes to rest
  if (t1 - t0 < 300) return;
  const wobble = (plan.seat % 2 ? 1 : -1) * (0.45 + 0.1 * (plan.seat % 3));
  const step = () => {
    const r = rooms.get(code);
    if (!r || r.botPlan !== plan || !plan.shot) return;
    const now = Date.now();
    if (now < t0) { setTimeout(step, Math.min(100, t0 - now)).unref(); return; }
    const u = Math.max(0, Math.min(1, (now - t0) / (t1 - t0)));
    const e = 1 - (1 - u) * (1 - u);
    emitAim(r, plan.seat, plan.shot.aim + wobble * (1 - e) * (1 - e) + 0.04 * Math.sin(u * 14) * (1 - u), plan.shot.power * (0.3 + 0.7 * Math.pow(u, 0.8)), null);
    if (u < 1) setTimeout(step, 100).unref();
  };
  step();
}

/* A live aim goes to everyone but the one aiming: { seat, aim, power } as aimLive; power 0 means they let go without a putt. */
function emitAim(room, seat, aim, power, exceptId) {
  const sockets = roomSockets.get(room.code);
  if (!sockets) return;
  const msg = { seat, aim: Math.round(aim * 1000) / 1000, power: Math.round(Math.max(0, Math.min(1, power)) * 1000) / 1000 };
  for (const s of sockets) if (!exceptId || s.data.playerId !== exceptId) s.emit("aimLive", msg);
}

function playPlan(code, plan) {
  const r = rooms.get(code);
  if (!r || r.botPlan !== plan) return;
  r.botPlan = null;
  if (r.status !== "playing" || turnKey(r) !== plan.key) return;
  const cur = r.players[r.turn];
  if (!cur || !(cur.bot || cur.botControlled)) return;
  if (!playStroke(r, r.turn, plan.shot.aim, plan.shot.power, plan.at)) return;
  afterStroke(r);
}

function humanIsBack(room, p, reason) {
  const wasBot = !!p.botControlled;
  p.timeouts = 0;
  if (!wasBot) return false;
  p.botControlled = false;
  room.log = `${p.name} is back${reason ? " (" + reason + ")" : ""}.`;
  if (room.status === "playing" && room.players[room.turn] === p) { clearT(botTimers, room.code); room.botPlan = null; armTimer(room.code); }
  return true;
}

function addBotTo(room) {
  if (room.players.length >= MAX_PLAYERS) return null;
  const used = room.players.map((q) => q.name);
  const name = BOT_NAMES.find((n) => !used.includes(n)) || "Bot" + (room.players.length + 1);
  const p = { id: "bot_" + newId(), name, avatar: "\u{1F916}", bot: true, skill: 0.72, left: false, connected: true, gear: botGearFor(room) };
  room.players.push(p);
  if (room.status === "playing") {
    const h = hole(room);
    room.ball.push([h.tee[0], h.tee[1]]); room.strokes.push(0); room.done.push(false);
    room.out.push(false); room.placed.push(false); room.canPlace.push(!!h.teeBox); room.lie.push([h.tee[0], h.tee[1]]);
  }
  return p;
}

/* ---------- sockets ---------- */

/* Seat a socket in a room. A socket already listening to another room leaves it first,
   and its seat there goes dark, exactly as if it had disconnected: one socket, one room. */
function attach(socket, code, playerId) {
  const was = socket.data.roomCode;
  if (was && (was !== code || socket.data.playerId !== playerId)) dropFromRoom(socket);
  socket.data.playerId = playerId;
  socket.data.roomCode = code;
  if (!roomSockets.has(code)) roomSockets.set(code, new Set());
  roomSockets.get(code).add(socket);
}
function detach(socket) {
  const code = socket.data.roomCode;
  const set = roomSockets.get(code);
  if (set) { set.delete(socket); if (!set.size) roomSockets.delete(code); }
  socket.data.roomCode = null;
}
/* Is this player still here on another socket (a reconnect that beat the old socket's
   timeout)? Then the old socket going says nothing about them. */
function heldElsewhere(room, id) {
  const set = roomSockets.get(room.code);
  if (set) for (const s of set) if (s.data.playerId === id) return true;
  return false;
}
function dropFromRoom(socket) {
  const room = rooms.get(socket.data.roomCode);
  const p = room ? room.players.find((q) => q.id === socket.data.playerId) : null;
  const id = socket.data.playerId;
  detach(socket);
  // A watcher in the waiting line who goes away leaves the line (they can join again).
  if (room && !p && room.waiting && room.waiting.some((w) => w.id === id)) { room.waiting = room.waiting.filter((w) => w.id !== id); bump(room); return; }
  if (!room || !p || heldElsewhere(room, p.id)) return;
  p.connected = false;
  if (room.status === "playing" && room.players[room.turn] === p) armTimer(room.code);
  bump(room);
}

Quick.init({ game: 'golf', model: 'openskill', seats: 4, codeKey: 'roomCode', app, io, rooms, base: BASE, broadcast: sendState,
  /* Quick and ranked play match within gear-score bands (gear.js BAND): an open room takes a player whose gear score is within it of the host's. Nothing on screen says so. */
  accept: (room, payload) => { const host = room.players.find((p) => p.id === room.host); return Gear.bandOk(Gear.scoreFor(host && host.gear, "golf"), Gear.scoreFor(Gear.clean("golf", payload.gear), "golf")); } });
io.on("connection", (socket) => {
  Plus.guardSocket(socket);   // the wallet's signed entitlement: every event's `plus` is the checked answer (the Nest Wallet repo, contrib/ROLLOUT.md)
  Quick.hook(socket); Quick.connection(socket);   // before the server's own events
  const currentRoom = () => rooms.get(socket.data.roomCode);
  Reactions.wire({ on: (ev, fn) => socket.on(ev, (payload) => fn(obj(payload))), room: currentRoom, me: () => socket.data.playerId,
    isHost: (r) => r.host === socket.data.playerId, bump });
  const me = () => { const r = currentRoom(); return r ? r.players.find((p) => p.id === socket.data.playerId) : null; };

  socket.on("create", (payload) => {
    const { name: rawName, playerId, avatar, caps, plus, look, crew, gear } = obj(payload);
    const name = cleanName(rawName);
    if (!name) return refuse(socket, "create", "name", "Pick a name first.");
    let code = genCode(); let guard = 0;
    while (rooms.has(code) && guard++ < 10) code = genCode();
    code = Plus.crewCode({ plus, crew }, rooms, () => code);   // GameNest Plus's crew code (2026-10-17)
    const id = cleanId(playerId) || newId();
    const room = newRoom(code, id);
    room.players.push({ id, name, avatar: cleanAvatar(avatar) || AVATARS[0], left: false, connected: true, caps: cleanCaps(caps), gear: Gear.clean("golf", gear) });
    rooms.set(code, room);
    attach(socket, code, id);
    stampPlus(code, socket, { plus, look }); socket.emit("joined", { code, playerId: id });
    bump(room);
  });

  socket.on("join", (payload) => {
    const { code: rawCode, name, playerId, avatar, caps, plus, look, gear } = obj(payload);
    const code = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return refuse(socket, "join", "not_found", "No room with that code.");
    const known = cleanId(playerId);
    let p = known ? room.players.find((q) => q.id === known) : null;
    if (p) {
      p.connected = true; p.left = false;
      p.caps = cleanCaps(caps);
      if (gear !== undefined && room.status === "lobby") p.gear = Gear.clean("golf", gear);   // gear changes between rounds, never in one
      humanIsBack(room, p, "reconnected");
      const n = cleanName(name);
      if (n) p.name = n;
    } else {
      if (room.status !== "lobby") {
        // A round under way: an app that knows the line waits in it; an older one hears the round has started.
        const capList = Array.isArray(caps) ? caps : [];
        if (!capList.includes("waitList")) return refuse(socket, "join", "started", "That round already started.");
        const n = cleanName(name);
        if (!n) return refuse(socket, "join", "name", "Pick a name first.");
        const id = known || newId();
        room.waiting = room.waiting || [];
        if (!room.waiting.some((q) => q.id === id)) {
          if (room.waiting.length >= MAX_PLAYERS) return refuse(socket, "join", "full", "Room is full.");
          room.waiting.push({ id, name: n, avatar: cleanAvatar(avatar) || AVATARS[0], caps: cleanCaps(caps), plus: plus === true, acct: Plus.acctOf(socket), look: Plus.cleanLook(look), gear: Gear.clean("golf", gear) });
          room.log = `${n} is waiting for a seat.`;
        }
        attach(socket, code, id);
        socket.emit("joined", { code, playerId: id, waiting: true });
        takeLeftSeats(room);
        bump(room);
        return;
      }
      if (room.players.length >= MAX_PLAYERS) return refuse(socket, "join", "full", `Room is full (${MAX_PLAYERS}).`);
      const n = cleanName(name);
      if (!n) return refuse(socket, "join", "name", "Pick a name first.");
      const id = known || newId();
      p = { id, name: n, avatar: cleanAvatar(avatar) || AVATARS[room.players.length % AVATARS.length], left: false, connected: true, caps: cleanCaps(caps), gear: Gear.clean("golf", gear) };
      room.players.push(p);
      room.log = `${n} joined.`;
    }
    attach(socket, code, p.id);
    stampPlus(code, socket, { plus, look }); socket.emit("joined", { code, playerId: p.id });
    bump(room);
  });

  /* The host's lobby choices: { holes: 3 | 6 | 9 } as before, { windmill: bool }, { scoring: "holes" | "strokes" | "pin" }, and { course: "meadow" | "beach" | ... }. */
  socket.on("settings", (payload) => {
    const { holes, windmill, scoring, course, gear } = obj(payload);
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    let changed = false;
    if (typeof gear === "boolean" && !room.quick && gear !== (room.gearOn !== false)) { room.gearOn = gear; room.log = gear ? "Gear is on." : "Gear is off: everyone plays at the base."; changed = true; }
    const n = Number(holes);
    if ([3, 6, 9].includes(n)) { room.holes = n; room.log = `Playing ${n} holes.`; changed = true; }
    if (typeof windmill === "boolean" && windmill !== room.opts.windmill) { room.opts.windmill = windmill; changed = true; }
    if ((scoring === "holes" || scoring === "strokes" || scoring === "pin") && scoring !== (room.opts.scoring || "holes")) {
      room.opts.scoring = scoring;
      room.log = scoring === "strokes" ? "Fewest strokes wins." : scoring === "pin" ? "Closest to the pin: one putt a hole." : "First in takes the hole.";
      changed = true;
    }
    if (typeof course === "string" && course !== room.course && COURSES.some((c) => c.id === course)) {
      room.course = course;
      room.log = `${COURSES.find((c) => c.id === course).name}.`;
      changed = true;
    }
    if (changed) bump(room);
  });

  /* A player's gear changed while they sat in the lobby (they upgraded or bought something on the gear page): { putter: { item, level }, gball, grip }. Clamped as on join. */
  socket.on("gear", (payload) => {
    const room = currentRoom(), self = me();
    if (!room || !self || room.status !== "lobby") return;
    self.gear = Gear.clean("golf", obj(payload));
    room.log = `${self.name} changed their gear.`;
    bump(room);
  });

  /* A ball colour, in the lobby or between rounds: { color: "#33d17a" } or { index: 1 },
     one of `palette`. A colour somebody else picked is theirs. */
  socket.on("ballColor", (payload) => {
    const { color, index } = obj(payload);
    const room = currentRoom(), p = me();
    if (!room || !p) return;
    if (room.status === "playing") return refuse(socket, "ballColor", "started", "Pick a colour before the round starts.");
    const i = Number.isInteger(index) ? index : COLORS.indexOf(String(color || "").toLowerCase());
    if (!(i >= 0 && i < COLORS.length)) return refuse(socket, "ballColor", "bad_color", "Pick one of the six colours.");
    if (room.players.some((q) => q !== p && q.colorPick === i)) return refuse(socket, "ballColor", "color_taken", "That colour is taken.");
    if (p.colorPick === i) return;
    p.colorPick = i;
    bump(room);
  });

  socket.on("addBot", () => {
    const room = currentRoom();
    if (!room || room.host !== socket.data.playerId) return;
    const b = addBotTo(room);
    if (!b) return;
    room.log = `${b.name} (bot) joined.`;
    bump(room);
  });

  socket.on("removeBot", () => {
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    for (let i = room.players.length - 1; i >= 0; i--) {
      if (room.players[i].bot) { room.log = `${room.players[i].name} left.`; room.players.splice(i, 1); break; }
    }
    bump(room);
  });

  socket.on("start", () => {
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    if (room.players.filter((p) => !p.left).length < MIN_PLAYERS) return refuse(socket, "start", "nobody", "Nobody to play.");
    startGame(room);
    armTimer(room.code);
    bump(room);
  });

  /* A shot: an aim in radians and a power 0..1, and optionally `at`, the server time the
     player struck it (for the windmill). Everything else is the server's. */
  socket.on("shoot", (payload) => {
    const { aim, power, at } = obj(payload);
    const room = currentRoom();
    const self = me();
    if (!room || !self || room.status !== "playing") return;
    const seat = room.players.indexOf(self);
    if (seat !== room.turn) return;
    if (humanIsBack(room, self, "took the shot")) clearT(botTimers, room.code);
    if (!Number.isFinite(aim) || !Number.isFinite(power)) return refuse(socket, "shoot", "bad_shot", "Bad shot.");
    // one ball at a time: the last putt is still rolling on the screens (a player who tapped to fast-forward it may putt a little early: after a third of its roll)
    if (ROLL_REST && Date.now() < (room.restFrom || 0) + 0.35 * (room.restMs || 0)) return refuse(socket, "shoot", "wait", "Wait for the ball.");
    if (!playStroke(room, seat, aim, power, strikeTime(room, at), "human")) return;
    afterStroke(room);
  });

  /* The ball set down in the tee box before the first putt (Plato: tap inside the checkered box): { x, y } in course units, kept
     inside the box by a ball's radius, and never on top of a ball already on the green. */
  socket.on("place", (payload) => {
    const { x, y } = obj(payload);
    const room = currentRoom(), self = me();
    if (!room || !self || room.status !== "playing" || room.holeDone) return;
    const seat = room.players.indexOf(self);
    const h = hole(room);
    if (seat !== room.turn || !h.teeBox || !room.canPlace[seat] || room.done[seat]) return refuse(socket, "place", "bad_place", "You cannot move the ball now.");
    if (!Number.isFinite(x) || !Number.isFinite(y)) return refuse(socket, "place", "bad_place", "Bad spot.");
    if (ROLL_REST && Date.now() < (room.restFrom || 0) + 0.35 * (room.restMs || 0)) return refuse(socket, "place", "wait", "Wait for the ball.");
    const [x0, y0, x1, y1] = h.teeBox;
    const px = Math.max(x0 + BALL_R, Math.min(x1 - BALL_R, x)), py = Math.max(y0 + BALL_R, Math.min(y1 - BALL_R, y));
    for (let s = 0; s < room.players.length; s++) {
      if (s === seat || room.done[s] || room.players[s].left || !(room.placed[s] || room.strokes[s] > 0)) continue;
      if (Math.hypot(room.ball[s][0] - px, room.ball[s][1] - py) < 2 * BALL_R + 0.02) return refuse(socket, "place", "bad_place", "Another ball is there.");
    }
    room.ball[seat] = [Math.round(px * 100) / 100, Math.round(py * 100) / 100];
    room.lie[seat] = room.ball[seat].slice();
    room.placed[seat] = true;
    bump(room);
  });

  /* A player's own aim while they line the putt up (about ten times a second): { aim, power }, relayed to the others as
     aimLive so they watch the pointer move (Plato). Power 0 says they let go without putting. */
  socket.on("aim", (payload) => {
    const { aim, power } = obj(payload);
    const room = currentRoom(), self = me();
    if (!room || !self || room.status !== "playing" || room.holeDone || !Number.isFinite(aim) || !Number.isFinite(power)) return;
    const seat = room.players.indexOf(self);
    if (seat !== room.turn) return;
    const now = Date.now();
    if (power > 0 && now - (socket.data.lastAim || 0) < AIM_RELAY_MS) return;
    socket.data.lastAim = now;
    emitAim(room, seat, aim, power, self.id);
  });

  socket.on("rematch", () => {
    const room = currentRoom();
    if (!room || room.status !== "over" || room.host !== socket.data.playerId) return;
    // Those who left give their seats up now, and the waiting line sits down.
    if (room.waiting && room.waiting.length) { room.players = room.players.filter((q) => !q.left); seatTheLine(room); }
    startGame(room);
    room.log = `Rematch! ${room.log}`;
    armTimer(room.code);
    bump(room);
  });

  socket.on("takeSeat", () => {
    const room = currentRoom(), p = me();
    if (room && p && humanIsBack(room, p, "took the seat back")) bump(room);
  });

  function handleLeave() {
    const room = currentRoom(), p = me();
    const id = socket.data.playerId;
    detach(socket);
    if (room && !p && room.waiting && room.waiting.some((w) => w.id === id)) {
      // Out of the waiting line.
      room.waiting = room.waiting.filter((w) => w.id !== id);
      bump(room);
      return;
    }
    if (!room || !p) return;
    p.left = true; p.connected = false;
    room.log = `${p.name} left.`;
    if (room.status === "playing") {
      const seat = room.players.indexOf(p);
      room.done[seat] = true;
      if (holeFinished(room)) { clearT(holePauses, room.code); advance(room); }
      else if (room.turn === seat) nextTurn(room);
      // The first in line takes the seat (from the next hole: this one is done for it).
      takeLeftSeats(room);
    }
    if (room.players.every((q) => q.left || q.bot)) { rooms.delete(room.code); clearT(timers, room.code); clearT(botTimers, room.code); clearT(holePauses, room.code); return; }
    if (room.status === "playing") armTimer(room.code);
    bump(room);
  }

  socket.on("pushToken", (payload) => {
    const { token } = obj(payload);
    const room = currentRoom();
    if (!room) return;
    const p = room.players.find((q) => q.id === socket.data.playerId);
    if (p && typeof token === "string" && /^[0-9a-f]{32,200}$/i.test(token)) p.pushToken = token;
  });

  socket.on("presence", (payload) => {
    const { away } = obj(payload);
    const room = currentRoom();
    if (!room) return;
    const p = room.players.find((q) => q.id === socket.data.playerId);
    if (p) p.away = !!away;
  });

  socket.on("chat", (payload) => {
    let { text, sticker } = obj(payload);
    const room = currentRoom();
    if (!room) return;
    const p = room.players.find((q) => q.id === socket.data.playerId);
    if (!p) return;
    const now = Date.now();
    if (now - (socket.data.lastChat || 0) < CHAT_COOLDOWN_MS) return;

    let msg = null;
    if (sticker) {
      if (!STICKERS.includes(sticker)) return;
      msg = { k: "s", s: sticker };
    } else {
      text = cleanChat(text);
      if (!text) return;
      msg = { k: "t", x: text };
    }
    socket.data.lastChat = now;
    const finish = () => {
      const room = rooms.get(code), p = room && room.players.find((q) => q.id === pid);   // gone while it was read
      if (!p) return;
      msg.n = p.name; msg.c = p.color; msg.a = p.avatar; msg.t = now;
      room.chat.push(msg);
      // a sticker is not worth waking someone for; words are
      if (msg.k === "t") {
        for (const q of room.players) {
          if (q !== p) pushTo(q, p.name + ": " + msg.x, { code: room.code, game: PUSH_TITLE }, room.code + "-chat");
        }
      }
      if (room.chat.length > CHAT_KEEP) room.chat.shift();
      room.touched = Date.now();
      bump(room);
    };
    const code = room.code, pid = p.id;
    if (msg.k === "t") Moderation.chat(msg.x).then((shown) => { msg.x = shown; finish(); }); else finish();
  });

  /* Voice is peer to peer; the server only carries the handshake, never audio.
     The 20k ceiling is what stops a signal being used as a data channel. */
  socket.on("voice", (payload) => {
    const { kind, to, data } = obj(payload);
    const room = currentRoom();
    if (!room) return;
    const seat = room.players.findIndex((p) => p.id === socket.data.playerId);
    if (seat < 0) return;

    if (kind === "join" || kind === "leave") {
      if (!room.voice) room.voice = new Set();
      if (kind === "join") room.voice.add(seat);
      else room.voice.delete(seat);
      room.touched = Date.now();
      bump(room);
      return;
    }

    if (kind === "signal" && Number.isInteger(to) && data) {
      let size = 0;
      try { size = JSON.stringify(data).length; } catch (e) { return; }
      if (size > 20000) return;
      const sockets = roomSockets.get(room.code);
      if (!sockets) return;
      for (const s of sockets) {
        const sSeat = room.players.findIndex((p) => p.id === s.data.playerId);
        if (sSeat === to) s.emit("voice", { kind: "signal", from: seat, data });
      }
    }
  });

  socket.on("leave", handleLeave);
  socket.on("disconnect", () => dropFromRoom(socket));
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touched > ROOM_IDLE_MS) { rooms.delete(code); clearT(timers, code); clearT(botTimers, code); clearT(holePauses, code); }
  }
}, 60000).unref();

server.listen(PORT, () => console.log(`Mini Golf Rooms running on port ${PORT}${BASE ? " under " + BASE : ""}`));

module.exports = { app, server, io, pool, __rooms: rooms, __startHole: startHole, __hole: hole, __bump: bump, __advance: advance, _tools: { newRoom, startGame, playStroke, publicRoom, addBotTo, armTimer } };   // the __ ones are for test/golf_r2.js, which stands a room on any hole, and test/winners.js, which ends a round on a chosen card
