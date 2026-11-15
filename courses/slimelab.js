/* Mini Golf, course 3: Slime Lab (the owner, 2026-11-01: picked the four new courses and the approved picture ref/golf_courses/slimelab_v1.png).

   Nine holes of our own, laid out 50 x 96 as the Beach's are (course.js finishRoomHoles stretches, shrinks and clears them: 27.5 x 52 drawn, so the app's per-course camera leaves a
   ninth of the page of dark lab floor at each side and the walls, the ball and the cup keep the Meadow's size on the page). Chrome pipe walls on hazard-striped bases (bars and rooms),
   big glossy slime puddles (sludge: the ball stops in them, a hard putt crosses only a thin strip), conveyor belts, and lab crates a ball knocks flat. Everything pretty (flasks, test-tube
   racks, beakers, the robots, the purple button) stands on the dark floor outside the walls, and the app draws it: inside the walls only play objects remain. Two holes hide their cup under
   one of several crates (props with cover: true). Each hole is its own idea and harder than a room's easy line: no straight way from tee to cup after hole 1, slime at the cup, two
   risk-and-reward holes, and a dry way round every puddle (slime is never on the only way to the cup). */
"use strict";

module.exports = (K) => {
  const { rect, bar, divider, belt, WALL_T: T } = K;
  const CRATE = (x, y) => ({ x, y, r: 3.6, kind: "crate", cover: true });   // a cover: a lab crate the ball knocks flat
  const W = 50, H = 96;
  const h = [];

  /* A ring of puddles round (cx, cy) at ring radius R, each of radius r, open where the gaps are: gap = [angle, width], the width between the edges of the puddles either side of it, in units.
     Puddles stand along each arc of the ring a little over a radius apart, so a moat reads as one smooth belt of slime, and the end puddle of every arc stands exactly where its gap begins. */
  const moat = (cx, cy, R, r, gaps) => {
    const out = [], TAU = Math.PI * 2;
    const g = gaps.map(([a, w]) => ({ a: ((a % TAU) + TAU) % TAU, half: 2 * Math.asin(Math.min(1, (w / 2 + r) / (2 * R))) })).sort((p, q) => p.a - q.a);
    for (let i = 0; i < g.length; i++) {
      const from = g[i].a + g[i].half, to = g[(i + 1) % g.length].a - g[(i + 1) % g.length].half + (i + 1 === g.length ? TAU : 0);
      if (to <= from) continue;
      const n = Math.max(1, Math.ceil(((to - from) * R) / (r * 1.1)));
      for (let k = 0; k <= n; k++) {
        const a = from + ((to - from) * k) / n;
        out.push({ x: Math.round((cx + Math.cos(a) * R) * 10) / 10, y: Math.round((cy + Math.sin(a) * R) * 10) / 10, r });
      }
    }
    return out;
  };

  // 1. Spill Zone: the approved picture's hole. A pipe across the lower left (open on the right), a big clover of slime to the left of the middle, and the cup in a pocket of the right rail between two
  //    pipes, open to the left, a small puddle in the pocket's mouth: up the right lane, left above the pipe, up past the slime's edge, then across into the pocket.
  h.push({
    name: "Spill Zone", par: 4,
    tee: [38, 11], cup: [44, 70],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 36, 33, 36 + T), rect(29, 58, W, 58 + T), rect(29, 80, W, 80 + T)],
    sludge: [{ x: 9, y: 66, r: 7.5 }, { x: 16, y: 62, r: 5.5 }, { x: 7, y: 53, r: 5 }, { x: 15, y: 73, r: 5 }, { x: 35, y: 70.5, r: 3.2 }],
    sand: [], water: [], props: [],
  });

  // 2. Beaker Bend: three pipes hang off alternate rails and the way zigzags: right through the first gap, back left through the second, right again to the cup in the far right corner.
  //    A puddle waits in each turn where a ball that runs on lands.
  h.push({
    name: "Beaker Bend", par: 4,
    tee: [10, 11], cup: [41, 87],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 30, 33, 30 + T), rect(17, 52, W, 52 + T), rect(0, 74, 30, 74 + T)],
    sludge: [{ x: 42, y: 41, r: 5 }, { x: 8, y: 63, r: 5 }, { x: 37.5, y: 82, r: 3.8 }],
    sand: [], water: [], props: [],
  });

  // 3. Goo Lake: a lake of slime right across the lab. A narrow causeway straight up from the tee (barely two balls wide: the risk) and a wide dry bridge a long way round on the far left
  //    (the safe way); a pipe hangs off the right rail in front of the cup.
  {
    const lake = [];
    [[16, 5.6], [20.4, 5.9], [24.8, 5.5], [29.2, 6.0], [33.5, 6.1]].forEach(([x, r], k) => lake.push({ x, y: 48 + (k % 2 ? 1.5 : -1.2), r }));   // from the wide bridge's edge (10.4) to the causeway's west edge (39.6)
    lake.push({ x: 47.4, y: 44.5, r: 2.6 }, { x: 47.4, y: 48, r: 2.6 }, { x: 47.4, y: 51.5, r: 2.6 });                                            // east of the causeway (its east edge 44.8 .. the right rail)
    h.push({
      name: "Goo Lake", par: 5,
      tee: [42.5, 10], cup: [40, 83],
      outline: rect(0, 0, W, H),
      obstacles: [rect(35, 72, W, 72 + T), rect(0, 65, 20, 65 + T)],
      sludge: [...lake, { x: 35.5, y: 78.5, r: 3.8 }],
      sand: [], water: [], props: [],
    });
  }

  // 4. Crate Search: a store room of four lab crates, and the cup lies under one of them. Two pipes make three rooms, a puddle in each; knock the crates flat to find it, then putt.
  h.push({
    name: "Crate Search", par: 5,
    tee: [25, 10], cup: [9, 80],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 33, 34, 33 + T), rect(16, 60, W, 60 + T)],
    sludge: [{ x: 26, y: 47, r: 5 }, { x: 40, y: 20, r: 4.6 }, { x: 28, y: 78, r: 5.2 }],
    props: [CRATE(9, 80), CRATE(41, 47), CRATE(8, 46), CRATE(41, 80)],
    sand: [], water: [],
    hidden: { plain: 0 },
  });

  // 5. Tube Rack: two long pipes stand like the dividers of a test-tube rack, one from the floor, one from the ceiling: up the left lane, across the top, down the middle, under the second
  //    pipe, and up the right lane to the cup, a puddle in each turn.
  h.push({
    name: "Tube Rack", par: 5,
    tee: [8, 10], cup: [43, 84],
    outline: rect(0, 0, W, H),
    obstacles: [rect(17, 0, 17 + T, 56), rect(33, 42, 33 + T, H)],
    sludge: [{ x: 8, y: 74, r: 5 }, { x: 25, y: 12, r: 4.4 }, { x: 43, y: 24, r: 4.8 }, { x: 42, y: 68, r: 4.2 }],
    sand: [], water: [], props: [],
  });

  // 6. Reactor Core: a dry island with the cup on it, and a moat of slime round the island with two ways in (risk and reward): a causeway barely two balls wide on the side of the tee's line, or a wide
  //    gap high on the far left, a long way round. Pipes stand in the lower left and the upper right.
  {
    const cx = 26, cy = 62;
    h.push({
      name: "Reactor Core", par: 4,
      tee: [14, 10], cup: [cx, cy],
      outline: rect(0, 0, W, H),
      obstacles: [rect(0, 28, 27, 28 + T), rect(32, 82, W, 82 + T)],
      sludge: moat(cx, cy, 12, 4.4, [[-Math.PI / 2 + 0.5, 4.6], [Math.PI * 0.82, 9.5]]),
      sand: [], water: [], props: [],
    });
  }

  // 7. Beaker Rack: a pipe across the lab with a wide door on the left, and above it a rack of four crates, one of them over the cup. Puddles lie beside the door and between the crates.
  h.push({
    name: "Beaker Rack", par: 5,
    tee: [30, 10], cup: [11, 66],
    outline: rect(0, 0, W, H),
    obstacles: [...divider(34, [[3, 22]], W)],
    sludge: [{ x: 42, y: 22, r: 4.6 }, { x: 40, y: 47, r: 5 }, { x: 25, y: 58, r: 4.2 }],
    props: [CRATE(11, 66), CRATE(38, 62), CRATE(24, 82), CRATE(41, 84)],
    sand: [], water: [],
    hidden: { plain: 0 },
  });

  // 8. Assembly Line: a belt in each of the lower rooms, each against you; the door on the left, then on the right; the cup in the top room's far left corner behind a puddle.
  h.push({
    name: "Assembly Line", par: 5,
    tee: [25, 10], cup: [8, 86],
    outline: rect(0, 0, W, H),
    obstacles: [...divider(32, [[4, 16]], W), ...divider(60, [[34, 46]], W)],
    ramps: [belt(0, 17, W, 28, "x", +1, 40), belt(0, 38, W, 54, "x", -1, 40)],
    sludge: [{ x: 45, y: 19, r: 4.2 }, { x: 15, y: 77, r: 4.6 }],
    sand: [], water: [], props: [],
  });

  // 9. The Vat: the finale. A big vat of slime in the middle of the lab, a slanting pipe above it, and the cup in a walled yard in the top right corner whose only gate is a small one in its left
  //    side, a puddle at the gate.
  h.push({
    name: "The Vat", par: 5,
    tee: [10.5, 10], cup: [41, 87],
    outline: rect(0, 0, W, H),
    obstacles: [bar(1, 34, 22, 46, T), rect(27.3, 70, W, 70 + T), rect(27.3, 70 + T, 27.3 + T, 79), rect(27.3, 88, 27.3 + T, H)],
    sludge: [{ x: 36, y: 38, r: 7.5 }, { x: 30, y: 46, r: 5.5 }, { x: 24, y: 28, r: 4.4 }, { x: 22, y: 82, r: 4.6 }],
    sand: [], water: [], props: [],
  });

  return h;
};
