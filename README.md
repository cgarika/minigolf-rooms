# Mini Golf Rooms (self-hosted)

Multiplayer mini golf you run yourself. Share a 6-letter room code, play 3, 6 or 9 holes
with up to 6 friends. Bots fill empty seats. No ads.

Played in the GameNest app: the course is 3D, so unlike the other games there is no
browser version.

## The server owns the physics

The other GameNest servers roll the dice; this one simulates the putt. A client sends
only an aim (radians) and a power (0..1). The server runs the ball — friction, rails,
sand, water, and whether it was slow enough to drop rather than rim out — and broadcasts
the whole path. The client plays that path back. Nothing about where a ball ends up is
the client's to decide, so a modified client cannot sink a putt it did not earn.

| Piece | What |
|---|---|
| `course.js` | The nine holes and the physics: `simulate(hole, from, aim, power, opts)` returns the path, where it stopped and why. Also `botShot`, which tries a fan of aims and keeps the best, and `HOLES_WINDMILL`, the same course with the windmill on hole 5. |
| `courses/<id>.js` | A course's nine holes (the Meadow's are in `course.js`), laid out with `course.js`'s own helpers (the Meadow's long rooms are 66 x 96; Sunny Beach's are 50 x 96, narrower, because the approved picture has a ninth of the page of sand on each side of the course and the walls, the ball and the cup keep their size); `finishRoomHoles` finishes them. Sunny Beach is `courses/beach.js` and Slime Lab `courses/slimelab.js` (50 x 96 too: chrome pipe walls, big puddles of slime that hold a ball, conveyor belts, lab crates; the flasks, test-tube racks, robots and the purple button are the app's, on the dark floor outside the walls). Ice Cave is `courses/icecave.js` (50 x 96 too: walls of ice blocks, glossy ice that keeps a ball sliding (`ICE_FRICTION` 0.5 and `ICE_DRAG` 0.4 against the snow's 1.7 and 0.8, so a full putt runs two holes' lengths on it), cracked-ice pools that are water, snowmen and blocks of ice over two hidden cups; the penguins, blue crystals, snowman and snowballs are the app's, on the snow outside the walls). Only play objects stand inside a course's walls, its palms, crab, beach ball, starfish, sandcastle and umbrella are the app's, on the sand outside. A hole may hide its cup under one of 3 to 5 covers (props with `cover: true`, `hidden: { plain }`): the room picks the cover at random, a ball that touches one knocks it flat for everyone, and the state has no cup (nor a flag) until it shows. Two Sunny Beach holes hide their cup under sandcastles, two Slime Lab holes under lab crates, two Ice Cave holes under snowmen and blocks of ice, and the Meadow's seventh (Chicken Run) under four hay bales; in the lobby the state's course is hole 1 of the course the host has picked (the Meadow's classic hole 1 for the Meadow, and for any room with an app that cannot draw long holes), an app without the `courses` capability is sent such a hole plain (`HOLES_TALL_PLAIN`, the cup in the open). Volcano (`courses/volcano.js`, 2026-11-01) is the fifth: lava is its water, and its signature is the steam vent (`course.js` `VENT`, `hole.vents`: a grate that puffs 1.5 s in 3.5 and kicks a ball over it, a pure function of the putt's strike time, `simulate`'s `opts.vt0`; a client that cannot draw vents (`vents` cap) plays the holes without them, `courseSet`'s `vents: false`). |
| `server.js` | Rooms, turn order and the honour, strokes, the card, bots and the AFK policy. |
| `bots.js`, `bot-worker.js` | A bot's practice swings (52 simulations a putt) on a small worker-thread pool, so they never block the event loop. |
| `test/physics.js` | Containment, energy, the cup, water, determinism, playability; the faster `simulate` against the frozen original (`test/fixtures/course-reference.js`), bit for bit; the windmill. |
| `test/bots.js` | The pool: answers, a dead or silent worker, the event loop under a burst. |
| `test/rules.js` | A real socket client: turn order, out-of-turn refusal, the card adding up, the stroke cap, and rematch. |
| `test/slimelab.js` | Slime Lab: its nine holes measured with the bots, the slime (a dry way to every cup, a ball out of any puddle in two putts), the crates and the hunting bot, the lobby's table following the host's pick (and staying the classic hole for an older app), an older app in a lab room. |
| `test/courses.js` | The Meadow's holes frozen hash by hash (one changed: the hay bales), every Sunny Beach hole measured with the bots (shots a hole, holes in one, risk and reward, the arrows), the covers (sandcastles and hay bales) and the hunting bot, the host's pick, an older app in a beach room or on Chicken Run, and a cup that is never sent before its cover falls. |
| `test/icecave.js` | Ice Cave: its nine holes measured with the bots (shots a hole, holes in one, risk and reward), the ice that slides a ball (a rink a bot holes in one), the snowmen and ice blocks and the hunting bot, the lobby's table following the pick, an older app in a cave room, and a cup that is never sent before its cover falls; the Meadow's, Beach's and Lab's holes frozen hash by hash. |
| `test/rooms.js` | Not a suite: the courses' suites' shared room (four balls on one hole, played the way `server.js` plays it: solid balls, knocks into water, the cap), with the best bot put in each seat in turn. A hole is judged alone and in a room: Volcano's Vent Alley took 3.08 shots from the best bot alone and 4.85 (71% in) with four balls, which is what the owner's iPad played (0.295: all four seats OUT; 0.304: three of four NOT IN). |
| `test/volcano.js` | Volcano: its nine holes measured with the bots (shots a hole, holes in one, risk and reward; Vent Alley also with four balls on the green), the steam vents (a ball over a puffing one is kicked away from its middle, once for each time it is over it; the cycle is a pure function of the putt's strike time; a vent's phase; the same holes without vents), the boulders and the hunting bot, the lobby's table following the pick, an app that cannot draw vents and an older app in a volcano room. Starts its own server on `TEST_PORT9` (default 3682). |
| `test/worlds.js` | The honour, the hole intro, the windmill, colours, refusal codes, hostile payloads, one socket one room, names, the server clock, the heartbeat, and an older app playing a full round. |

## Run it

```bash
npm install
node server.js                    # http://localhost:3000
BASE_PATH=/golf PORT=3197 node server.js    # behind the GameNest reverse proxy
```

## Tests

```bash
npm test                                  # starts its own servers on 3612-3614
TEST_PORTS=3271,3272,3273 npm test        # or on other ports
```

## Settings

| Env | Default | What |
|---|---|---|
| `TURN_MS`, `AFK_MS`, `BOT_MS`, `HOLE_PAUSE_MS` | 45000, 6000, 1200, 1800 | as before |
| `HOLE_INTRO_MS` | 6000 | added to each hole's first clock and to a bot's first putt on it |
| `SHOT_LEEWAY_MS` | 250 | how far back a client may date a putt (`shoot.at`) |
| `BOT_WORKERS` | cores - 1, at most 4 | bot-thinking threads; 0 thinks on the main thread |
| `BOT_JOB_TIMEOUT_MS` | 2000 | a worker slower than this is answered on the main thread |
| `PING_INTERVAL_MS`, `PING_TIMEOUT_MS` | socket.io's 25000, 20000 | the heartbeat |

## Rules

- Everyone plays the same hole; strokes go in seat order round from the player with the
  honour, skipping anyone already in. Hole 1 starts at seat 0; after that the last hole's
  winner has the honour, a hole nobody won leaves it where it was, and a winner who has
  left passes it round.
- Each hole's first turn gets `HOLE_INTRO_MS` extra on its clock (a bot's first putt
  waits it out too) so the app can walk to the new hole. Input is never locked.
- The windmill stands on hole 5 in rooms whose every human sent `caps: ["windmill"]`
  (the host can turn it off); its sails shut the doorway on a clock the state carries.
- A putt that finishes a hole is broadcast on its own, and the next hole follows
  `HOLE_PAUSE_MS` later (1.8 s by default) — otherwise clients would swap the course out
  from under the ball and nobody would see their winning putt drop.
- Water costs a penalty stroke and the ball goes back to where it was played from.
- Sand is roughly four times the friction of the green.
- Pick up at 8 strokes and take the 8.
- Lowest total over the round wins.

## Notes

- Rooms live in memory; a restart loses open rooms.
- A turn times out after 45 s and is played with the bot heuristic; three in a row and a
  bot takes the seat until the player acts again.
- Empty rooms are cleaned up after two hours.
