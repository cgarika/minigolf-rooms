/* Mini Golf, course 4: Ice Cave (the owner, 2026-11-01: picked the four new courses and the approved picture ref/golf_courses/icecave_v1.png).

   Nine holes of our own, laid out 50 x 96 as the Beach's and the Lab's are (course.js finishRoomHoles stretches, shrinks and clears them: 27.5 x 52 drawn, so the app's per-course
   camera leaves a ninth of the page of snow at each side and the walls, the ball and the cup keep the Meadow's size on the page). Walls are rows of ice blocks (bars and rooms), the
   floor is snow, and the signature is the ICE: glossy patches (circles, drawn as clouds) where a ball keeps sliding (course.js ICE_FRICTION and ICE_DRAG: a full putt runs two holes'
   lengths on ice, one on snow), so a shot over ice runs on and a wall bank off ice is a choice. Water is cracked ice (a hole in the ice with floes: in is a stroke and back to the last
   spot). Everything pretty (penguins, blue crystals, a snowman, snowballs) stands on the snow outside the walls, and the app draws it: inside the walls only play objects remain. Two
   holes hide their cup under one of several snowmen or ice blocks (props with cover: true). Each hole is its own idea and harder than a room's easy line: no straight way from tee to
   cup after hole 1, water or a wall at the cup, two risk-and-reward holes. */
"use strict";

module.exports = (K) => {
  const { rect, bar, divider, WALL_T: T } = K;
  const MAN = (x, y) => ({ x, y, r: 3.6, kind: "snowman", cover: true });   // a cover: a snowman the ball knocks flat
  const BLOCK = (x, y) => ({ x, y, r: 3.6, kind: "iceblock", cover: true });   // a cover: a big block of ice the ball knocks flat
  const W = 50, H = 96;
  const h = [];

  /* A row of ice circles, a causeway or a lane of ice: `n` circles of radius r along a line, evenly spaced. */
  const line = (x0, y0, x1, y1, r, n) => {
    const out = [];
    for (let k = 0; k < n; k++) out.push({ x: Math.round((x0 + ((x1 - x0) * k) / Math.max(1, n - 1)) * 10) / 10, y: Math.round((y0 + ((y1 - y0) * k) / Math.max(1, n - 1)) * 10) / 10, r });
    return out;
  };

  // 1. Frozen Pond: the approved picture's hole. A wall of ice blocks across the lower left (open on the right), a cloud of ice to the left of the middle, a cracked-ice pool low on the right, and the cup in
  //    a pocket of the right rail between two walls, open to the left: up the right lane past the pool, left above the wall, over the ice and across into the pocket.
  h.push({
    name: "Frozen Pond", par: 4,
    tee: [12, 11], cup: [41, 74],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 40, 28.5, 40 + T), rect(30, 62, W, 62 + T), rect(30, 84, W, 84 + T)],
    ice: [{ x: 9.5, y: 70, r: 7.5 }, { x: 17, y: 65.5, r: 6 }, { x: 8, y: 58, r: 5.5 }, { x: 16.5, y: 76, r: 5.5 }],
    water: [{ x: 38.5, y: 22.5, r: 6.5 }],
    sand: [], sludge: [], props: [],
  });

  // 2. Glacier Lane: a long wall of ice blocks stands from the middle of the left lane up to the top, so the cave splits in two lanes joined at the foot and just below the top. The left lane is a sheet of ice that
  //    ends at a wall with a door on its right, and above it a room in the top left holds the cup beside a pool; the right lane has a pool in its middle and leads round the top to the same room.
  h.push({
    name: "Glacier Lane", par: 4,
    tee: [40, 11], cup: [9, 87],
    outline: rect(0, 0, W, H),
    obstacles: [rect(22, 22, 22 + T, H), rect(0, 73, 14.5, 73 + T)],
    ice: line(10.5, 27, 10.5, 61, 6.5, 6),
    water: [{ x: 37, y: 50, r: 7 }, { x: 19.5, y: 90, r: 4.6 }],
    sand: [], sludge: [], props: [],
  });

  // 3. Floe Run: a lake of cracked ice right across the cave. A causeway of ice a ball slides across, barely two balls wide, off the tee's line (risk), and a wide dry bridge a long way round on the far
  //    right (the safe way). Above the lake a wall of ice blocks closes the cave but for a door on the left, and the cup lies in the room above it, past a sheet of ice, with a pool at the far end.
  {
    const lake = [];
    [[5.8, 5.8], [11.6, 5.9], [17.2, 5.6], [19.6, 5.9]].forEach(([x, r], k) => lake.push({ x, y: 49 + (k % 2 ? 1.2 : -1), r }));   // the lake's west part, from the left rail to the causeway's west edge (25.5)
    lake.push({ x: 36, y: 46, r: 4.6 }, { x: 36, y: 50.5, r: 4.6 }, { x: 36, y: 55, r: 4.6 });                              // its east part, from the causeway's east edge (31.4) to the wide bridge (40.6)
    h.push({
      name: "Floe Run", par: 5,
      tee: [8, 10], cup: [41, 87],
      outline: rect(0, 0, W, H),
      obstacles: [rect(14, 72, W, 72 + T)],
      ice: [...line(28.4, 40, 28.4, 60, 2.9, 5), { x: 20, y: 86, r: 6 }],
      water: [...lake, { x: 46.4, y: 91, r: 3.4 }],
      sand: [], sludge: [], props: [],
    });
  }

  // 4. Snowman Search: a cave of four snowmen, and the cup lies under one of them. Two walls make three rooms, with ice in each; knock the snowmen flat to find it, then putt.
  h.push({
    name: "Snowman Search", par: 5,
    tee: [25, 10], cup: [10, 84],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 33, 34, 33 + T), rect(16, 60, W, 60 + T)],
    ice: [{ x: 28, y: 20, r: 6 }, { x: 24, y: 47, r: 6 }, { x: 31, y: 78, r: 6 }],
    water: [{ x: 44, y: 46, r: 3.8 }],
    props: [MAN(10, 84), MAN(41, 74), MAN(9, 47), MAN(41, 23)],
    sand: [], sludge: [],
    hidden: { plain: 0 },
  });

  // 5. Switchback: two long walls hang off alternate rails and the way zigzags: out round the first one's end, back under the second. Ice lies in every lane, so a ball slides to the turn, and a pool
  //    waits at the second turn for one that slides on.
  h.push({
    name: "Switchback", par: 5,
    tee: [8, 10], cup: [41, 86],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 30, 36, 30 + T), rect(14, 58, W, 58 + T)],
    ice: [{ x: 22, y: 18, r: 6.5 }, { x: 28, y: 44, r: 6.5 }, { x: 22, y: 76, r: 6.5 }],
    water: [{ x: 6, y: 52, r: 4.4 }, { x: 44, y: 70, r: 4 }],
    sand: [], sludge: [], props: [],
  });

  // 6. Crystal Island: a dry island with the cup on it in a cracked-ice lake, with two ways in (risk and reward): a causeway of ice barely two balls wide on the side of the tee's line, or a wide
  //    gap on the far left, a long way round. A wall of ice blocks stands in the lower left and the upper right.
  {
    const cx = 27, cy = 62;
    const lake = [];
    const n = 15, gaps = [[-Math.PI / 2 + 0.5, 4.6], [Math.PI * 0.82, 9.5]];
    // a ring of cracked ice round the island, open where the gaps are
    const TAU = Math.PI * 2, Rr = 12, r = 4.2;
    const g = gaps.map(([a, w]) => ({ a: ((a % TAU) + TAU) % TAU, half: 2 * Math.asin(Math.min(1, (w / 2 + r) / (2 * Rr))) })).sort((p, q) => p.a - q.a);
    for (let i = 0; i < g.length; i++) {
      const from = g[i].a + g[i].half, to = g[(i + 1) % g.length].a - g[(i + 1) % g.length].half + (i + 1 === g.length ? TAU : 0);
      if (to <= from) continue;
      const m = Math.max(1, Math.ceil(((to - from) * Rr) / (r * 1.1)));
      for (let k = 0; k <= m; k++) { const a = from + ((to - from) * k) / m; lake.push({ x: Math.round((cx + Math.cos(a) * Rr) * 10) / 10, y: Math.round((cy + Math.sin(a) * Rr) * 10) / 10, r }); }
    }
    void n;
    h.push({
      name: "Crystal Island", par: 5, // 5 since 2026-11-13 (polish r4): with four balls on the green the best bot needs more than 4; MAX = par + 2
      tee: [14, 10], cup: [cx, cy],
      outline: rect(0, 0, W, H),
      obstacles: [rect(0, 28, 27, 28 + T), rect(32, 82, W, 82 + T)],
      ice: [{ x: 14, y: 46, r: 6 }, { x: cx, y: cy - 1, r: 5.4 }],
      water: lake,
      sand: [], sludge: [], props: [],
    });
  }

  // 7. Ice Block Rack: a wall across the cave with a wide door on the left, and above it a rack of four ice blocks, one of them over the cup. Ice lies beside the door and between the blocks.
  h.push({
    name: "Ice Block Rack", par: 5,
    tee: [32, 10], cup: [11, 66],
    outline: rect(0, 0, W, H),
    obstacles: [...divider(34, [[3, 22]], W)],
    ice: [{ x: 41, y: 20, r: 6 }, { x: 36, y: 49, r: 6 }, { x: 24, y: 59, r: 5 }],
    water: [{ x: 46.4, y: 91, r: 3.4 }],
    props: [BLOCK(11, 66), BLOCK(38, 62), BLOCK(24, 82), BLOCK(41, 84)],
    sand: [], sludge: [],
    hidden: { plain: 0 },
  });

  // 8. Rink Rumble: a rink of ice across the middle of the cave with two slanting walls of ice blocks to bank off. The cup lies in the top left corner behind a wall that opens on its right, past a sheet
  //    of ice along the top, and a pool waits at the end of the slide.
  h.push({
    name: "Rink Rumble", par: 5,
    tee: [25, 10], cup: [7, 87],
    outline: rect(0, 0, W, H),
    obstacles: [bar(1, 36, 30, 46, T), bar(W - 1, 58, 22, 68, T), rect(0, 76, 27, 76 + T)],
    ice: [{ x: 14, y: 24, r: 7 }, { x: 36, y: 24, r: 6 }, { x: 40, y: 50, r: 7 }, { x: 10, y: 56, r: 7 }, { x: 34, y: 86, r: 6.5 }],
    water: [{ x: 45, y: 90, r: 4 }, { x: 5, y: 66, r: 3.6 }],
    sand: [], sludge: [], props: [],
  });

  // 9. The Deep Freeze: the finale. A channel of cracked ice across the middle with a bridge of ice a ball slides over, and past it a walled yard in the top right corner whose only gate is a small one in
  //    its left side, with the cup inside on a sheet of ice and a pool at the gate.
  h.push({
    name: "The Deep Freeze", par: 5,
    tee: [10.5, 10], cup: [41, 87],
    outline: rect(0, 0, W, H),
    obstacles: [rect(27.3, 66, W, 66 + T), rect(27.3, 66 + T, 27.3 + T, 76), rect(27.3, 85, 27.3 + T, H)],
    ice: [{ x: 38, y: 78, r: 6 }, ...line(24, 38, 24, 52, 3.2, 3)],
    water: [{ x: 7, y: 46, r: 6.5 }, { x: 15, y: 46, r: 6.5 }, { x: 36, y: 46, r: 6 }, { x: 44, y: 46, r: 6 }, { x: 22, y: 80.5, r: 3.8 }],
    sand: [], sludge: [], props: [],
  });

  return h;
};
