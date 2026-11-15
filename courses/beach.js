/* Mini Golf, course 2: Sunny Beach (the owner, 2026-11-01: picked the four new courses and the approved picture ref/golf_courses/beach_v1.png).

   Nine holes of our own, laid out 50 x 96 (the Meadow's long rooms are 66 x 96: the beach is narrower, because the approved picture has golden sand all round the
   course, about a ninth of the page on each side, and the walls, the ball and the cup keep their size on the page; course.js finishRoomHoles stretches, shrinks and
   clears them): driftwood planks (bars and rooms), golden sand, tide pools (water: the shot is lost, the ball goes back). Everything pretty (palms, a crab, a
   beach ball, starfish, a sandcastle, an umbrella) stands on the sand outside the walls, and the app draws it: inside the walls only play objects remain. Two holes
   hide their cup under one of several sandcastles (props with cover: true): knock one flat and see what lies under it. Each hole is its own idea, and harder than
   a room's easy line: no straight way from tee to cup after hole 1, a hazard at the cup, two risk-and-reward holes. */
"use strict";

module.exports = (K) => {
  const { rect, bar, ring, divider, belt, WALL_T: T } = K;
  const CAST = (x, y) => ({ x, y, r: 3.6, kind: "sandcastle", cover: true });   // a cover: a sandcastle the ball knocks flat
  const W = 50, H = 96;
  const h = [];

  // 1. Shore Break: the approved picture's hole. A plank across the lower left (open on the right), a clover of sand to the left and a tide pool low on it; the cup lies in a pocket of the
  //    right rail between two planks, open to the left, with a short plank standing in it: up through the gap, round the end of the pocket's floor, over the short plank, and down to the cup.
  h.push({
    name: "Shore Break", par: 4,
    tee: [35, 11], cup: [45, 66],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 38, 28, 38 + T), rect(30, 58, W, 58 + T), rect(30, 80, W, 80 + T), rect(36, 58 + T, 36 + T, 71)],
    sand: [{ x: 10, y: 66, r: 8 }, { x: 17.5, y: 61, r: 6.5 }, { x: 8, y: 54, r: 5.5 }, { x: 16.5, y: 72.5, r: 5.5 }, { x: 44, y: 74, r: 4 }],
    water: [{ x: 11, y: 19, r: 7 }],
    props: [],
  });

  // 2. Palm Bend: two driftwood planks slant across the beach, one off each rail, so the way zigzags: out round the first one's end, back under the second, then across to the cup in the far right
  //    corner past a bed of sand. The planks bank a ball well.
  h.push({
    name: "Palm Bend", par: 5, // 5 since 2026-11-13 (polish r4): with four balls on the green the best bot needs more than 4; MAX = par + 2
    tee: [14, 11], cup: [39.5, 86],
    outline: rect(0, 0, W, H),
    obstacles: [bar(1, 32, 35, 44, T), bar(W - 1, 62, 18, 74, T)],
    sand: [{ x: 44, y: 40, r: 5.5 }, { x: 6, y: 52, r: 5.5 }, { x: 35, y: 80, r: 5.5 }],
    water: [{ x: 42, y: 14, r: 6.5 }, { x: 4.5, y: 74, r: 4.5 }],
    props: [],
  });

  // 3. Lagoon Crossing: a lagoon across the beach with a causeway in it barely two balls wide, off the tee's line, and a wide land bridge a long way round on the far left (risk and reward);
  //    the cup lies past the lagoon's far shore behind a bed of sand.
  {
    const lagoon = [];
    for (let x = 17; x <= 33; x += 4) lagoon.push({ x, y: 50, r: 6 });                                  // the lagoon's west part, from the land bridge's edge (11) to the causeway's west edge (39)
    lagoon.push({ x: 47.5, y: 46.5, r: 2.5 }, { x: 47.5, y: 50, r: 2.5 }, { x: 47.5, y: 53.5, r: 2.5 });   // the east part, from the causeway's east edge (45) to the right rail
    h.push({
      name: "Lagoon Crossing", par: 5,
      tee: [41, 10], cup: [38, 84],
      outline: rect(0, 0, W, H),
      obstacles: [],
      water: lagoon,
      sand: [{ x: 38, y: 76, r: 5.5 }, { x: 23, y: 26, r: 5.5 }],
      props: [],
    });
  }

  // 4. Sandcastle Search: a beach of four sandcastles, and the cup lies under one of them. Two planks make rooms, with sand in each; knock them flat to find it, then putt.
  h.push({
    name: "Sandcastle Search", par: 5,
    tee: [25, 10], cup: [10.5, 82],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 33, 32, 33 + T), rect(18, 60, W, 60 + T)],
    sand: [{ x: 25, y: 46, r: 5.5 }, { x: 26, y: 74, r: 6 }, { x: 33.5, y: 16, r: 5 }],
    water: [{ x: 6, y: 20, r: 5 }],
    props: [CAST(10.5, 82), CAST(39.5, 46), CAST(9, 46), CAST(41, 82)],
    hidden: { plain: 0 },
  });

  // 5. Crab Alley: a long driftwood wall splits the beach in two lanes, the left one short and heavy with sand, the right one longer with a tide pool across half of it. They meet under a shell of
  //    planks at the top, whose only door is a narrow one in its floor, on the left: in through it, then across to the cup in the shell's far side.
  h.push({
    name: "Crab Alley", par: 4,
    tee: [25, 10], cup: [31, 89],
    outline: rect(0, 0, W, H),
    obstacles: [rect(23.3, 22, 26.7, 60), rect(14, 70, 19.5, 70 + T), rect(25.5, 70, 38, 70 + T), rect(14, 70 + T, 14 + T, H), rect(34.55, 70 + T, 38, H), rect(27, 79, 34.55, 79 + T)],
    sand: [{ x: 12, y: 38, r: 8 }, { x: 9, y: 58, r: 5.5 }, { x: 24, y: 80, r: 4 }],
    water: [{ x: 41, y: 48, r: 7.5 }, { x: 44.5, y: 82, r: 5 }],
    props: [],
  });

  // 6. Dune Bunker: a ring of driftwood in the upper middle of the beach, the cup in the middle of a bed of sand filling it, and two ways in (risk and reward): a slit low on the right, barely wider than
  //    two balls, close to the tee's line, or a wide gap high on the left a long way round. A firm putt across the sand either way.
  {
    const cx = 28.5, cy = 68, r = 17, gap1 = 3 * Math.PI / 4, gap2 = -4 * Math.PI / 9;   // the wide gap at 135 degrees, the slit at -80
    const half = (g) => Math.asin((g / 2 + T / 2) / r);
    const g1 = half(9), g2 = half(4.8), a2 = gap2 + 2 * Math.PI;
    h.push({
      name: "Dune Bunker", par: 4,
      tee: [7, 9], cup: [28.5, 68],
      outline: rect(0, 0, W, H),
      obstacles: [...K.arc(cx, cy, r, gap1 + g1, a2 - g2, T), ...K.arc(cx, cy, r, a2 + g2, gap1 - g1 + 2 * Math.PI, T)],
      sand: [{ x: 28.5, y: 68, r: 9 }, { x: 21, y: 62, r: 5.5 }, { x: 36, y: 62, r: 5.5 }, { x: 28.5, y: 77, r: 5.5 }],
      water: [{ x: 7.5, y: 38, r: 6 }, { x: 44, y: 90, r: 5.5 }],
      props: [],
    });
  }

  // 7. Coconut Cove: a ring of driftwood with one opening toward the tee, sand in it and three sandcastles round the inside: the cup lies under one. Tide pools in the lower corners and
  //    in the upper ones wait for a ball that is hit too hard.
  h.push({
    name: "Coconut Cove", par: 5,
    tee: [25, 10], cup: [17, 62],
    outline: rect(0, 0, W, H),
    obstacles: [...ring(25, 62, 20, -Math.PI / 2, 9, T)],
    sand: [{ x: 25, y: 53, r: 5 }, { x: 25, y: 22, r: 5 }],
    water: [{ x: 4.5, y: 34, r: 4.5 }, { x: 45.5, y: 34, r: 4.5 }, { x: 6, y: 90, r: 5 }],
    props: [CAST(17, 62), CAST(33, 62), CAST(25, 73)],
    hidden: { plain: 0 },
  });

  // 8. Tide Race: a pool in the middle of the beach and a lane round each side of it, each a belt: the right one carries a ball up, the left one down. Across the top the cup waits in the far
  //    left corner, past a plank that hangs from the top rail and a bed of sand.
  h.push({
    name: "Tide Race", par: 5,
    tee: [25, 10], cup: [7.5, 86],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 24, 15.5, 24 + T), rect(34.5, 24, W, 24 + T), rect(15, 80, 15 + T, H)],
    ramps: [belt(37.5, 30, 50, 70, "y", +1, 40), belt(0, 30, 12.5, 70, "y", -1, 40)],
    water: [{ x: 25, y: 50, r: 12.5 }, { x: 25, y: 62, r: 8.5 }],
    sand: [{ x: 7.5, y: 78.5, r: 5 }, { x: 25, y: 82, r: 5 }],
    props: [],
  });

  // 9. Lighthouse Point: the finale. A slanting plank and two tide pools on the way, and the cup in a walled yard in the top right corner whose only gate is a small one in its left side, with sand inside it.
  h.push({
    name: "Lighthouse Point", par: 5,
    tee: [10.5, 10], cup: [41, 86],
    outline: rect(0, 0, W, H),
    obstacles: [bar(1, 34, 24, 46, T), rect(27.3, 72, W, 72 + T), rect(27.3, 72 + T, 27.3 + T, 82), rect(27.3, 90, 27.3 + T, H)],
    water: [{ x: 38, y: 40, r: 9 }, { x: 10.5, y: 62, r: 7.5 }],
    sand: [{ x: 34, y: 86, r: 4 }, { x: 43, y: 79, r: 3.5 }, { x: 22.5, y: 20, r: 5.5 }],
    props: [],
  });

  return h;
};
