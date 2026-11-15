/* Mini Golf, course 5: Volcano (the owner, 2026-11-01: picked the four new courses and the approved picture ref/golf_courses/volcano_v1.png).

   Nine holes of our own, laid out 50 x 96 as the Beach's, the Lab's and the Cave's are (course.js finishRoomHoles stretches, shrinks and clears them: 27.5 x 52 drawn). Walls are dark basalt
   blocks (bars and rooms), the floor is a dark jungle green, LAVA is the water of this course (a pool the ball goes into is a stroke and back to where it was struck from), and the signature
   is the STEAM VENT: a grate in the floor that puffs on a cycle the player can read (course.js VENT: 1.5 s on, 2 s off, each vent with a phase of its own) and kicks a ball that is over it
   while it puffs. A vent sits where it gates a way (a lane with room for the ball to go round it would not gate anything), so a shot is a matter of timing as well as of aim, and the
   cycle is a pure function of the time the putt is struck, so the server decides every putt and the app draws the steam from the state. Everything pretty (volcano cones, boulders, glowing
   crystals, ferns) stands outside the walls, and the app draws it: inside the walls only play objects remain. Two holes hide their cup under one of several boulders (props with
   cover: true). Each hole is its own idea and harder than a room's easy line: no straight way from tee to cup after hole 1, lava or a vent at the cup, two risk-and-reward holes. */
"use strict";

module.exports = (K) => {
  const { rect, bar, divider, WALL_T: T } = K;
  const ROCK = (x, y) => ({ x, y, r: 3.6, kind: "boulder", cover: true });   // a cover: a dark boulder the ball knocks flat
  const W = 50, H = 96;
  const VENT_R = 3.8;                                                          // a grate as laid out: 2.1 drawn, the picture's
  const vent = (x, y, phase = 0) => ({ x, y, r: VENT_R, phase });
  const h = [];

  /* A row of lava circles, a river or a pool's shore: `n` circles of radius r along a line, evenly spaced. */
  const line = (x0, y0, x1, y1, r, n) => {
    const out = [];
    for (let k = 0; k < n; k++) out.push({ x: Math.round((x0 + ((x1 - x0) * k) / Math.max(1, n - 1)) * 10) / 10, y: Math.round((y0 + ((y1 - y0) * k) / Math.max(1, n - 1)) * 10) / 10, r });
    return out;
  };

  // 1. Cinder Garden: the approved picture's hole. A wall of basalt across the lower left (open on the right), a cloverleaf of lava to the left of the middle, a steam vent in front of the tee's
  //    way up, and the cup in a pocket of the right rail between two walls, open to the left: past the vent, up the lane between the lava and the wall, then right into the pocket.
  h.push({
    name: "Cinder Garden", par: 4,
    tee: [12, 11], cup: [41, 74],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 40, 28.5, 40 + T), rect(30, 62, W, 62 + T), rect(30, 84, W, 84 + T)],
    water: [{ x: 9.5, y: 67, r: 7.5 }, { x: 17, y: 62.5, r: 5.5 }, { x: 8, y: 55, r: 5.5 }, { x: 18.5, y: 74, r: 6 }, { x: 40, y: 51, r: 3.6 }],
    vents: [vent(23, 25, 0), vent(26.5, 52, 1000)],
    sand: [], sludge: [], props: [],
  });

  // 2. Vent Alley: a lane twelve wide through the middle of the mountain with two grates across it, each puffing out of step with the next, so there is no going round one: time the putt to cross
  //    them between puffs, or stop in the lane between two and cross again. Above it a wall with a door 22 wide on the right (it begins three units inside the lane's right wall, so the lane runs straight into it), and the cup in the room at the top, far
  //    left, with a pool of lava beside it and another over the door's far end. (2026-11-03, the owner's iPad, 0.295 and 0.304: the door was 14 wide with a pool 5.5 across right over it and another over
  //    the wall's far end, a pinch under one and over the other: four balls on the green knocked each other into the lava, the best bot took 4.85 shots with four balls where it took 3.1 alone, and the
  //    four seats ended "6 OUT" and "3 NOT IN". Now the best bot takes 3.6 with four, and 99% of its balls are in.)
  h.push({
    name: "Vent Alley", par: 4,
    tee: [25, 10], cup: [10, 88],
    outline: rect(0, 0, W, H),
    obstacles: [rect(15.6, 24, 19, 72), rect(31, 24, 34.4, 72), ...divider(78, [[28, 50]], W)],
    water: [{ x: 22, y: 90.5, r: 4 }, { x: 44, y: 91, r: 3.2 }],
    vents: [vent(25, 38, 0), vent(25, 58, 1750)],
    sand: [], sludge: [], props: [],
  });

  // 3. Magma Moat: a lake of lava right across the mountain. A causeway of rock a ball can cross, barely two balls wide, with a grate in front of it (risk: time it, and a kick on to it is the lake), and a
  //    wide dry strip a long way round on the far right (the safe way). Above the lake a wall of basalt closes the mountain but for a door on the left, and the cup lies in the room above it.
  {
    const lake = line(6.8, 49, 13.4, 49, 6.8, 2);                                     // the lake's west part, from the left rail to the causeway's west edge (20.2)
    lake.push({ x: 30.2, y: 46, r: 3.2 }, { x: 30.2, y: 49.3, r: 3.2 }, { x: 30.2, y: 52.6, r: 3.2 }, { x: 34, y: 49.3, r: 3.2 });   // its east part, from the causeway's east edge (27) to the wide strip (37.2)
    h.push({
      name: "Magma Moat", par: 5,
      tee: [8, 10], cup: [41, 87],
      outline: rect(0, 0, W, H),
      obstacles: [rect(18, 72, W, 72 + T)],
      water: lake,
      vents: [vent(23.6, 37.5, 600)],
      sand: [], sludge: [], props: [],
    });
  }

  // 4. Boulder Hunt: a mountain of four dark boulders, and the cup lies under one of them. Two walls make three rooms; knock the boulders flat to find it, then putt. Lava in two corners, a grate in the middle room.
  h.push({
    name: "Boulder Hunt", par: 5,
    tee: [25, 10], cup: [10, 84],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 33, 29, 33 + T)],
    water: [{ x: 44, y: 62, r: 4 }],
    vents: [vent(25, 50, 900)],
    props: [ROCK(10, 84), ROCK(36, 70), ROCK(40, 88), ROCK(12, 56)],
    hidden: { plain: 0 },
    sand: [], sludge: [],
  });

  // 5. Switchback: three walls across the mountain, each with its door at the other end, a grate in every door and a pool of lava in the corner behind it. The cup is in the top room, far left.
  h.push({
    name: "Switchback", par: 5,
    tee: [10, 10], cup: [10, 88],
    outline: rect(0, 0, W, H),
    obstacles: [...divider(28, [[32, 50]], W), ...divider(50, [[0, 18]], W), ...divider(72, [[32, 50]], W)],
    water: [{ x: 44, y: 40, r: 4 }, { x: 30, y: 87, r: 4 }],
    vents: [vent(42, 29.7, 0), vent(8, 51.7, 1750)],
    sand: [], sludge: [], props: [],
  });

  // 6. Caldera: the cup on an island in a ring of lava with two ways in. The short way is the narrow opening on the south east, with a grate in front of it, a gap to thread between puffs; the long way is
  //    the wide one on the north west, round the ring. A wall of basalt across the foot leaves a door on the right, a second above it a door in the middle, so the grate is the first thing past them.
  {
    const ring = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * 2 * Math.PI + 0.2;
      const x = 25 + 12 * Math.cos(a), y = 72 + 12 * Math.sin(a);
      const sector = ((a * 180) / Math.PI) % 360;
      if ((sector > 290 && sector < 310) || (sector > 110 && sector < 160)) continue;   // the two openings: one circle out on the south east (narrow), two out on the north west (wide)
      ring.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: 4.6 });
    }
    h.push({
      name: "Caldera", par: 5, // 5 since 2026-11-13 (polish r4): with four balls on the green the best bot needs more than 4; MAX = par + 2
      tee: [10, 10], cup: [25, 72],
      outline: rect(0, 0, W, H),
      obstacles: [...divider(28, [[34, 50]], W), ...divider(46, [[16, 30]], W)],
      water: ring,
      vents: [vent(33.5, 58.5, 0)],
      sand: [], sludge: [], props: [],
    });
  }

  // 7. Rock Slide: an open mountainside strewn with four boulders, the cup under one, lava in two hollows, a grate between the walls. A short wall at each side leaves the way through the middle.
  h.push({
    name: "Rock Slide", par: 5,
    tee: [38, 10], cup: [40, 74],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 46, 36, 46 + T), rect(20, 70, W, 70 + T)],
    water: [{ x: 8, y: 22, r: 6 }, { x: 44, y: 28, r: 5 }, { x: 8, y: 84, r: 5 }, { x: 31, y: 82, r: 3.2 }],
    vents: [vent(36, 55, 1200), vent(40, 47.7, 0)],
    props: [ROCK(40, 74), ROCK(12, 60), ROCK(40, 40), ROCK(14, 36)],
    hidden: { plain: 0 },
    sand: [], sludge: [],
  });

  // 8. Geyser Field: five grates in a loose band across the middle, each a beat behind the one beside it (a wave of steam that crosses the field), walls at either side to funnel a ball into it, and the cup
  //    top left behind a pool.
  h.push({
    name: "Geyser Field", par: 5,
    tee: [38, 10], cup: [9, 86],
    outline: rect(0, 0, W, H),
    obstacles: [rect(0, 30, 17, 30 + T), rect(33, 30, W, 30 + T), rect(0, 62, 17, 62 + T), rect(33, 62, W, 62 + T), ...divider(78, [[26, 50]], W)],
    water: [{ x: 18, y: 88, r: 4.5 }, { x: 44, y: 70, r: 3.5 }],
    vents: [vent(25, 38, 0), vent(14, 46, 700), vent(36, 46, 1400), vent(25, 54, 2100), vent(25, 70, 2800)],
    sand: [], sludge: [], props: [],
  });

  // 9. The Eruption: a lake of lava across the mountain with a crossing in it and a grate in the crossing, and above it the cup in a walled yard in the top right corner whose only gate has a grate in it too.
  h.push({
    name: "The Eruption", par: 5,
    tee: [10, 10], cup: [41, 84],
    outline: rect(0, 0, W, H),
    obstacles: [rect(28, 66, 28 + T, 81.7), rect(28, 88.3, 28 + T, H), rect(28, 66, W, 66 + T), ...divider(34, [[0, 34]], W)],
    water: [...line(6, 52, 18, 52, 6, 3), { x: 43.5, y: 52, r: 6.5 }, { x: 44, y: 59, r: 3.4 }, { x: 13, y: 84, r: 5 }],   // the lake, from the left rail to 24 and from the right rail to 37: the crossing is the 13 between
    vents: [vent(29.7, 85, 0), vent(31, 52, 1750)],
    sand: [], sludge: [], props: [],
  });

  return h;
};
