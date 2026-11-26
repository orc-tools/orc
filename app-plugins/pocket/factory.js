// Pocket's Factory floor: the handheld's own main board, seen through the
// shell. The floor is purple solder mask with traces and gold pads, and the
// aisle is the data bus. The main agent is the processor, a black package on
// gold legs with a fan on its lid and the cartridge slot for a door. Each
// subagent is a capacitor and each worker a smaller chip under a heat sink,
// and a part still queued is only its silkscreen outline. Finished jobs come
// home as cartridges, carried up the bus by a spark.
import { CircleGeometry, Group, Mesh, PlaneGeometry, SphereGeometry, Vector3 } from 'three';

const PALETTE = {
  light: {
    ground: '#a98be8', horizon: '#c9b3f5', zenith: '#f5f2fc',
    line: '#b8862a', aisle: '#9a78e0', body: '#2a1f4a', trim: '#d9d6e6', roof: '#6a3fc0',
    accent: '#6a3fc0', worker: '#b8862a', busy: '#1763c9', ok: '#197a3c', fail: '#c8283c', idle: '#6f6090',
    crate: '#d9d6e6', tape: '#6a3fc0', smoke: '#6f6090', glow: '#6a3fc0', window: '#9be6b4', door: '#17121f',
    sky: '#ffffff', sun: '#fff8ff', mask: '#8f6ee6', silk: '#f5f2fc',
    sunIntensity: 1.5, skyIntensity: 1.9, envIntensity: 0.5, exposure: 1.02, fogNear: 16, fogSpan: 34,
  },
  dark: {
    ground: '#2e1260', horizon: '#1d0b3c', zenith: '#100c1d',
    line: '#f0cf7a', aisle: '#3a1c78', body: '#0d0620', trim: '#b9b6c9', roof: '#c9a8ff',
    accent: '#c9a8ff', worker: '#f0cf7a', busy: '#6fb6ff', ok: '#6ee79a', fail: '#ff7a8a', idle: '#9d8cc8',
    crate: '#cfcbe0', tape: '#c9a8ff', smoke: '#9d8cc8', glow: '#c9a8ff', window: '#6ee79a', door: '#08060e',
    sky: '#c9a8ff', sun: '#f3e6ff', mask: '#4f2496', silk: '#cdb6ff',
    sunIntensity: 1.6, skyIntensity: 1.5, envIntensity: 0.7, exposure: 1.1, fogNear: 16, fogSpan: 34,
  },
};

// Behind the board is the shell's own plastic: lit from above by day, dark
// round a glow by night.
function backdrop(mode) {
  return mode === 'dark'
    ? 'radial-gradient(ellipse 80% 70% at 50% 15%, #3a1c78, #1d0b3c 60%, #100c1d)'
    : 'linear-gradient(180deg, #f5f2fc, #c9b3f5 55%, #b79cf2)';
}

// A board is laid out square, and the camera sits high so the floor reads as
// one.
const layout = { turn: 0.08 };
const view = { elevation: 0.7, azimuth: 0.09 };

const TAU = Math.PI * 2;
const css = colour => '#' + colour.getHexString();

// The engine frees whatever is in the kit's material map with the scene, so
// the painted sheets live there, one of each per look.
function shared(kit, key, make) {
  if (!kit.materials.has(key)) kit.materials.set(key, make());
  return kit.materials.get(key);
}

const gold = kit => kit.mat('line', { rough: 0.35, metal: 0.7, emissive: 'line', glow: kit.mode === 'dark' ? 0.25 : 0.05 });
const lit = (kit, colour, glow) => kit.mat(colour, { rough: 0.5, emissive: colour, glow: kit.mode === 'dark' ? glow : glow * 0.2 });
const pack = kit => kit.mat('body', { rough: 0.55, metal: 0.1 });
const silver = kit => kit.mat('trim', { rough: 0.3, metal: 0.75 });

// A row of gold legs down one side of a package, from its body to the board.
function legs(kit, group, { x, z, depth, count, height, out = 0.12 }) {
  const step = depth / count;
  for (let i = 0; i < count; i += 1) {
    const at = z - depth / 2 + step * (i + 0.5);
    group.add(kit.box(out, 0.05, step * 0.5, gold(kit), [x + Math.sign(x) * out / 2, height, at]));
    group.add(kit.box(0.05, height, step * 0.5, gold(kit), [x + Math.sign(x) * out, height / 2, at]));
  }
}

// The solder mask: square traces that turn at 45 degrees, each ending in a
// pad, drawn once on a tile and repeated across the board.
function floor(kit) {
  const group = new Group();
  const trace = css(kit.palette.mask);
  const pad = css(kit.palette.line);
  group.add(kit.ground({
    rough: 0.5, metal: 0.12, repeat: [16, 16],
    draw(ctx, w, h) {
      ctx.fillStyle = css(kit.palette.ground);
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = trace;
      ctx.lineJoin = 'round';
      const grid = w / 16;
      const runs = [
        [[2, 2], [2, 6], [5, 9], [9, 9]], [[13, 2], [13, 5], [10, 5], [8, 3]], [[3, 13], [7, 13], [9, 11], [14, 11]],
        [[6, 2], [6, 4], [8, 6], [11, 6]], [[14, 14], [11, 14], [11, 12]], [[2, 9], [2, 11], [4, 11]],
      ];
      for (const [index, run] of runs.entries()) {
        ctx.lineWidth = index % 3 === 0 ? 9 : 5;
        ctx.beginPath();
        run.forEach(([x, y], i) => (i ? ctx.lineTo(x * grid, y * grid) : ctx.moveTo(x * grid, y * grid)));
        ctx.stroke();
        const [x, y] = run.at(-1);
        ctx.fillStyle = pad;
        ctx.beginPath(); ctx.arc(x * grid, y * grid, 9, 0, TAU); ctx.fill();
        ctx.fillStyle = css(kit.palette.ground);
        ctx.beginPath(); ctx.arc(x * grid, y * grid, 3.5, 0, TAU); ctx.fill();
      }
    },
  }));
  // The data bus up the middle: five traces from the edge of the board to the
  // processor's slot, with a via where each one starts.
  const bus = gold(kit);
  for (let lane = -2; lane <= 2; lane += 1) {
    group.add(kit.box(0.07, 0.016, 12.6, bus, [lane * 0.32, 0.012, 3.5]));
    group.add(kit.cylinder(0.11, 0.11, 0.02, bus, [lane * 0.32, 0.014, 9.8], 12));
  }
  const edge = lit(kit, 'accent', 0.9);
  for (const side of [-1, 1]) group.add(kit.box(0.04, 0.018, 12.6, edge, [side * 0.98, 0.012, 3.5]));
  return group;
}

// The label printed on the processor's lid.
function lid(kit) {
  return shared(kit, 'pocket-lid', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = css(kit.palette.trim);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css(kit.palette.body);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = css(kit.palette.body);
    ctx.font = '700 34px Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ORC-CPU', w / 2, h * 0.42);
    ctx.font = '600 20px Menlo, monospace';
    ctx.fillText('MAIN AGENT  REV C', w / 2, h * 0.66);
    ctx.beginPath(); ctx.arc(30, 30, 9, 0, TAU); ctx.fill();
  }, { width: 384, height: 256, rough: 0.35, metal: 0.6 }));
}

// The processor: a black package standing on its legs, a silver lid with its
// name on, a fan turning on the lid and the cartridge slot facing the bus.
// The light on the lid blinks while the run waits on you, and the lid's rim
// flashes as a job lands.
function hall(kit) {
  const group = new Group();
  const body = pack(kit);
  group.add(kit.box(4.3, 0.06, 2.9, gold(kit), [0, 0.03, 0]));
  group.add(kit.box(4.0, 1.5, 2.6, body, [0, 0.98, 0]));
  legs(kit, group, { x: -2.0, z: 0, depth: 2.4, count: 7, height: 0.5 });
  legs(kit, group, { x: 2.0, z: 0, depth: 2.4, count: 7, height: 0.5 });
  const top = new Mesh(new PlaneGeometry(3.4, 2.0), lid(kit));
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, 1.795, 0);
  group.add(kit.box(3.5, 0.06, 2.1, silver(kit), [0, 1.76, 0]), top);
  const rim = kit.box(3.62, 0.03, 2.22, lit(kit, 'accent', 1.1), [0, 1.74, 0]);
  group.add(rim);
  group.add(kit.box(1.9, 1.5, 0.3, kit.mat('roof', { rough: 0.5 }), [0, 0.98, 1.28]));
  group.add(kit.box(1.62, 1.32, 0.05, kit.mat('door', { rough: 1 }), [0, 0.92, 1.43]));
  const door = kit.box(1.56, 1.28, 0.06, silver(kit), [0, 0, 0]);
  door.geometry.translate(0, -0.64, 0);
  door.position.set(0, 1.57, 1.47);
  group.add(door);
  const fan = new Group();
  fan.position.set(-1.25, 1.92, -0.55);
  for (let blade = 0; blade < 4; blade += 1) {
    const arm = kit.box(0.5, 0.03, 0.14, body, [0.25, 0, 0]);
    const turn = new Group();
    turn.rotation.y = blade * TAU / 4;
    turn.add(arm);
    fan.add(turn);
  }
  group.add(kit.cylinder(0.62, 0.62, 0.12, body, [-1.25, 1.85, -0.55], 24), fan);
  group.add(kit.cylinder(0.1, 0.1, 0.08, silver(kit), [-1.25, 1.95, -0.55], 12));
  const beacon = kit.sphere(0.17, kit.beacon, [1.3, 1.9, -0.6]);
  group.add(beacon);
  // A crystal beside the package, where the heat comes off.
  group.add(kit.box(0.5, 0.42, 1.0, silver(kit), [-2.75, 0.24, -0.7]));
  let pulse = -Infinity;
  let clock = 0;
  group.userData = {
    door,
    beacon,
    spin: [[fan, 'y', 2.4]],
    chimney: new Vector3(-2.75, 0.6, -0.7),
    labelY: 3.3,
    react() { pulse = clock; },
    frame(time) {
      clock = time;
      const kick = Math.max(0, 1 - (time - pulse) / 0.8);
      rim.scale.set(1 + kick * 0.06, 1, 1 + kick * 0.08);
    },
  };
  return kit.shadows(group);
}

// A part not yet fitted: its outline in silkscreen and its two bare pads.
function ghost(kit) {
  const group = new Group();
  const silk = kit.basic('silk', { opacity: 0.7 });
  for (const [w, d, x, z] of [[1.3, 0.04, 0, -0.5], [1.3, 0.04, 0, 0.5], [0.04, 1.0, -0.65, 0], [0.04, 1.0, 0.65, 0]]) {
    group.add(kit.box(w, 0.012, d, silk, [x, 0.03, z]));
  }
  for (const x of [-0.3, 0.3]) group.add(kit.box(0.34, 0.012, 0.5, gold(kit), [x, 0.03, 0]));
  return group;
}

// A fitted part on its gold footprint. A subagent is a capacitor: a can in a
// purple sleeve with a trimmer on its top that turns while it works. A
// worker is a chip under a heat sink, with a small fan and a lit strip along
// its front. Both carry a state light on a stalk.
function station(kit, kind) {
  const group = new Group();
  const worker = kind === 'worker';
  const trim = silver(kit);
  const spin = [];
  group.add(kit.box(worker ? 1.5 : 1.2, 0.03, worker ? 1.2 : 1.1, gold(kit), [0, 0.015, 0]));
  let top = 1.02;
  if (worker) {
    group.add(kit.box(1.14, 0.44, 0.9, pack(kit), [0, 0.5, 0]));
    legs(kit, group, { x: -0.57, z: 0, depth: 0.8, count: 4, height: 0.3, out: 0.1 });
    legs(kit, group, { x: 0.57, z: 0, depth: 0.8, count: 4, height: 0.3, out: 0.1 });
    for (let fin = -3; fin <= 3; fin += 1) group.add(kit.box(0.05, 0.22, 0.7, trim, [fin * 0.13 + 0.1, 0.83, 0]));
    group.add(kit.box(0.7, 0.1, 0.03, kit.windows, [-0.1, 0.52, 0.455]));
    const fan = new Group();
    fan.position.set(0.1, 0.98, 0);
    for (let blade = 0; blade < 3; blade += 1) {
      const turn = new Group();
      turn.rotation.y = blade * TAU / 3;
      turn.add(kit.box(0.3, 0.02, 0.1, pack(kit), [0.15, 0, 0]));
      fan.add(turn);
    }
    group.add(fan);
    spin.push([fan, 'y', 5]);
    top = 0.98;
  } else {
    group.add(kit.cylinder(0.4, 0.4, 0.86, kit.mat('accent', { rough: 0.45, metal: 0.2 }), [0, 0.47, 0], 24));
    group.add(kit.cylinder(0.405, 0.405, 0.12, pack(kit), [0, 0.2, 0], 24));
    group.add(kit.cylinder(0.36, 0.36, 0.04, trim, [0, 0.91, 0], 24));
    // The stripe down the sleeve that marks the negative leg.
    group.add(kit.box(0.16, 0.6, 0.02, kit.mat('silk', { rough: 0.6 }), [0, 0.55, 0.4]));
    const trimmer = new Group();
    trimmer.position.set(0, 0.95, 0);
    trimmer.add(kit.box(0.44, 0.04, 0.09, pack(kit)), kit.box(0.09, 0.04, 0.44, pack(kit)));
    group.add(trimmer);
    spin.push([trimmer, 'y', 2.2]);
  }
  const lamp = new Mesh(new SphereGeometry(0.1, 12, 8), kit.lamp());
  const lampAt = [worker ? -0.52 : 0.5, top + 0.2, worker ? -0.36 : 0.32];
  group.add(kit.cylinder(0.018, 0.018, lampAt[1], trim, [lampAt[0], lampAt[1] / 2, lampAt[2]], 6));
  lamp.position.set(...lampAt);
  group.add(lamp);
  group.userData = {
    lamp, spin, swing: [],
    puff: new Vector3(0, top + 0.1, -0.2),
    labelY: top + 0.62,
  };
  return kit.shadows(group);
}

// The edge connector beside the slot, where delivered cartridges are stood:
// a strip of board with a row of gold fingers. HALL is at z -5 on the floor.
function dock(kit) {
  const group = new Group();
  group.position.set(3.5, 0, -3.58);
  group.add(kit.box(1.94, 0.08, 1.34, kit.mat('mask', { rough: 0.5 }), [0, 0.2, 0]));
  for (let finger = -4; finger <= 4; finger += 1) group.add(kit.box(0.12, 0.02, 0.5, gold(kit), [finger * 0.2, 0.25, 0.36]));
  return kit.shadows(group);
}

// A finished job is a cartridge: a grey shell with a label and a grip.
function crate(kit) {
  const group = new Group();
  group.add(kit.box(0.4, 0.44, 0.12, kit.mat('crate', { rough: 0.6 }), [0, 0, 0]));
  group.add(kit.box(0.3, 0.2, 0.02, lit(kit, 'tape', 0.6), [0, 0.06, 0.065]));
  for (const y of [-0.12, -0.16]) group.add(kit.box(0.3, 0.015, 0.02, pack(kit), [0, y, 0.065]));
  return kit.shadows(group);
}

// What carries it: a spark running along the bus, with the cartridge riding
// just above it.
function carrier(kit) {
  const object = new Group();
  const core = kit.sphere(0.16, lit(kit, 'worker', 1.6), [0, 0.2, 0], 12);
  const flare = kit.halo('worker', 1.3, 1.3, { opacity: 0.6, at: [0, 0.03, 0] });
  object.add(core, flare);
  const hold = new Group();
  hold.position.y = 0.62;
  object.add(hold);
  return {
    object, hold, route: 'ground',
    pose(target, { time, speed }) {
      const beat = 1 + Math.sin(time * 14) * 0.12 + speed * 0.2;
      core.scale.setScalar(beat);
      flare.scale.setScalar(0.8 + speed * 0.5 + Math.sin(time * 9) * 0.08);
      hold.rotation.y = time * 1.6;
    },
  };
}

// Off the edge of the floor: the coin battery in its clip, the speaker can,
// the two round buttons seen from underneath as domes, and a screw at each
// corner.
function decor(kit) {
  const group = new Group();
  const trim = silver(kit);
  const cell = shared(kit, 'pocket-cell', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = css(kit.palette.trim);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css(kit.palette.body);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.4, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = css(kit.palette.body);
    ctx.font = '700 46px Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('+ 3V', w / 2, h / 2 + 16);
  }, { width: 256, height: 256, rough: 0.3, metal: 0.7 }));
  group.add(kit.cylinder(1.9, 1.9, 0.36, trim, [-12.4, 0.2, -3], 40));
  const face = new Mesh(new CircleGeometry(1.86, 40), cell);
  face.rotation.x = -Math.PI / 2;
  face.position.set(-12.4, 0.385, -3);
  group.add(face, kit.box(0.5, 0.5, 1.4, gold(kit), [-10.3, 0.25, -3]));
  group.add(kit.cylinder(1.5, 1.6, 0.5, pack(kit), [12.3, 0.25, -3.5], 32));
  group.add(kit.cylinder(1.1, 1.1, 0.06, trim, [12.3, 0.52, -3.5], 32));
  const cap = kit.mat('accent', { rough: 0.25, metal: 0.1, opacity: 0.8, emissive: 'accent', glow: kit.mode === 'dark' ? 0.35 : 0.05 });
  for (const [x, z] of [[11.6, 5.6], [13.4, 3.9]]) {
    const dome = kit.sphere(0.85, cap, [x, 0, z], 20);
    dome.scale.y = 0.55;
    group.add(dome, kit.cylinder(1.0, 1.0, 0.05, gold(kit), [x, 0.025, z], 24));
  }
  for (const [x, z] of [[-10.6, -6.4], [10.6, -6.4], [-10.6, 9.4], [10.6, 9.4]]) {
    group.add(kit.cylinder(0.34, 0.34, 0.16, trim, [x, 0.08, z], 16));
    group.add(kit.box(0.5, 0.03, 0.08, pack(kit), [x, 0.17, z]), kit.box(0.08, 0.03, 0.5, pack(kit), [x, 0.17, z]));
  }
  return kit.shadows(group);
}

// The advisor's LED face: a dot matrix on a dark window, its eyes lit and
// looking down at the page, or shut in a line as it blinks.
function ledFace(kit, shut) {
  return shared(kit, `pocket-led-${shut ? 'shut' : 'open'}`, () => kit.painted((ctx, w, h) => {
    const cols = 16;
    const rows = 10;
    const cell = w / cols;
    ctx.fillStyle = '#0b0716';
    ctx.fillRect(0, 0, w, h);
    const on = new Set();
    const light = (x, y) => on.add(`${x},${y}`);
    for (const left of [3, 10]) {
      if (shut) for (let x = 0; x < 3; x += 1) light(left + x, 5);
      else for (let x = 0; x < 3; x += 1) for (let y = 4; y < 7; y += 1) if (y === 5 || x === 1) light(left + x, y);
    }
    for (const x of [6, 7, 8, 9]) light(x, 8);
    light(5, 7); light(10, 7);
    const lit = kit.mode === 'dark' ? '#6ee79a' : '#3fd27a';
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const glow = on.has(`${x},${y}`);
        ctx.fillStyle = glow ? lit : '#1f3a2c';
        ctx.beginPath();
        ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * (glow ? 0.4 : 0.26), 0, TAU);
        ctx.fill();
      }
    }
  }, { width: 256, height: 160, nearest: false, emissive: true, glow: kit.mode === 'dark' ? 1.1 : 0.6, rough: 0.3 }));
}

// The manual's open spread: the cartridge's instructions, a diagram of the
// handheld on one page and lines of print on the other.
function manualPages(kit) {
  return shared(kit, 'pocket-manual', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#f5f2fc';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d9d0f0';
    ctx.fillRect(w / 2 - 2, 0, 4, h);
    ctx.strokeStyle = '#6a3fc0';
    ctx.lineWidth = 4;
    ctx.strokeRect(w * 0.12, h * 0.18, w * 0.26, h * 0.62);
    ctx.fillStyle = '#9be6b4';
    ctx.fillRect(w * 0.16, h * 0.24, w * 0.18, h * 0.2);
    ctx.fillStyle = '#6a3fc0';
    ctx.beginPath(); ctx.arc(w * 0.31, h * 0.62, 7, 0, TAU); ctx.fill();
    ctx.fillRect(w * 0.15, h * 0.6, 18, 6); ctx.fillRect(w * 0.18, h * 0.55, 6, 18);
    ctx.fillStyle = '#2a1f4a';
    ctx.font = '700 20px Menlo, monospace';
    ctx.fillText('MANUAL', w * 0.58, h * 0.2);
    for (let line = 0; line < 6; line += 1) ctx.fillRect(w * 0.58, h * (0.3 + line * 0.1), w * (line % 3 === 2 ? 0.22 : 0.32), 5);
  }, { width: 256, height: 160, rough: 0.85, metal: 0 }));
}

// The advisor is the co-processor: a chip stood on end on its gold
// footprint, its pins bent down as legs and two bent out as arms that hold
// up the cartridge's manual. Its face is an LED matrix that reads down the
// page and blinks, the activity light on its top flickers while it thinks,
// and every few seconds it turns a leaf of the manual.
function advisor(kit) {
  const root = new Group();
  const body = pack(kit);
  const trim = silver(kit);
  const pin = gold(kit);
  root.add(kit.box(1.3, 0.03, 1.2, pin, [0, 0.015, 0]));
  root.add(kit.box(1.1, 0.012, 1.0, kit.mat('mask', { rough: 0.5 }), [0, 0.034, 0]));
  // Its feet: four bent pins on each side down to the pads.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i += 1) {
      const x = side * (0.18 + i * 0.16);
      root.add(kit.box(0.06, 0.5, 0.06, pin, [x, 0.27, -0.2]));
      root.add(kit.box(0.1, 0.03, 0.16, pin, [x, 0.045, -0.15]));
    }
  }
  const chip = new Group();
  chip.position.set(0, 0.5, -0.2);
  root.add(chip);
  chip.add(kit.box(0.92, 0.86, 0.3, body, [0, 0.43, 0]));
  chip.add(kit.box(0.96, 0.05, 0.34, trim, [0, 0.87, 0]));
  // The notch that says which way up it goes.
  chip.add(kit.cylinder(0.07, 0.07, 0.06, kit.mat('door', { rough: 1 }), [0, 0.86, 0.12], 12));
  // Side pins, five a side.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i += 1) chip.add(kit.box(0.08, 0.05, 0.08, pin, [side * 0.5, 0.18 + i * 0.13, 0]));
  }
  const open = ledFace(kit, false);
  const shut = ledFace(kit, true);
  const face = new Mesh(new PlaneGeometry(0.74, 0.46), open);
  face.position.set(0, 0.5, 0.158);
  chip.add(face, kit.box(0.8, 0.52, 0.02, trim, [0, 0.5, 0.142]));
  chip.add(kit.box(0.5, 0.05, 0.02, kit.mat('silk', { rough: 0.6 }), [0, 0.14, 0.152]));
  // The activity light on its lid.
  const led = kit.sphere(0.06, lit(kit, 'busy', 1.6), [0.32, 0.92, 0], 10);
  chip.add(led);
  // The arms and the manual they hold up to its face.
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new Group();
    arm.position.set(side * 0.5, 0.16, 0.04);
    arm.add(kit.box(0.06, 0.06, 0.5, pin, [0, 0, 0.25]));
    arm.add(kit.box(0.06, 0.06, 0.06, pin, [-side * 0.03, 0.02, 0.5]));
    chip.add(arm);
    arms.push(arm);
  }
  const book = new Group();
  book.position.set(0, 0.69, 0.4);
  book.rotation.x = 0.4;
  root.add(book);
  book.add(kit.box(1.04, 0.04, 0.6, kit.mat('accent', { rough: 0.5 }), [0, -0.025, 0]));
  const spread = new Mesh(new PlaneGeometry(0.96, 0.54), manualPages(kit));
  spread.rotation.x = -Math.PI / 2;
  spread.position.y = 0.004;
  book.add(spread);
  const leaf = new Group();
  leaf.position.y = 0.012;
  leaf.add(kit.box(0.46, 0.008, 0.52, kit.mat('silk', { rough: 0.9 }), [0.24, 0, 0]));
  book.add(leaf);
  const shadowed = kit.shadows(root);
  root.add(kit.shadow(1.6, 1.4, 0.3));
  root.scale.setScalar(1.4);
  shadowed.userData = {
    labelY: 2.35,
    page: new Vector3(0, 0.71 * 1.4, 0.4 * 1.4),
    frame(time, dt, state) {
      const reading = state.activity;
      chip.rotation.x = 0.22 * reading + Math.sin(time * 0.8) * 0.02;
      chip.rotation.z = Math.sin(time * 0.6) * 0.05 * reading;
      face.material = (time % 3.7) < 0.14 ? shut : open;
      led.visible = reading < 0.5 || Math.sin(time * 23) + Math.sin(time * 7.3) > -0.4;
      const turn = Math.min(1, Math.max(0, ((time * 0.3) % 1 - 0.72) / 0.28)) * reading;
      leaf.rotation.z = -Math.PI * (turn * turn * (3 - 2 * turn));
      for (const [i, arm] of arms.entries()) arm.rotation.x = Math.sin(time * 1.1 + i) * 0.04 * reading;
    },
  };
  return shadowed;
}

export default { palette: PALETTE, backdrop, layout, view, pad: false, ghost, floor, hall, station, crate, carrier, dock, decor, advisor };
