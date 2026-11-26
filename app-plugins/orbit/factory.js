// Orbit's Factory floor: a ring station in orbit over the theme's own ringed
// planet, drawn as its own schematic. There is no ground, only a faint
// plotting grid and a range plot, and the camera looks down through them at
// the planet, its moon and drifting rock. The main agent is the station's
// core, a habitat wheel turning over it, solar wings on a long truss, a dish
// that tracks, a service drone on the dotted orbit and a crew member out on a
// tether. Each worker docks as a lab, a greenhouse or an observatory, each
// subagent as a pod, a cubesat, a probe or a repair bay, all on lit pads.
// Shuttles fly the approach corridor through its gates. Every hull is a flat
// fill with its edges inked over it: cyan line on navy by night, an engraving
// in ink on paper by day.
import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CircleGeometry, ConeGeometry, DoubleSide, EdgesGeometry, Group, IcosahedronGeometry,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, PlaneGeometry, RingGeometry,
  SphereGeometry, TorusGeometry, Vector3,
} from 'three';

const PALETTE = {
  light: {
    ground: '#efe6d0', horizon: '#efe6d0', zenith: '#f9f3e3',
    line: '#2a2620', aisle: '#f4ecd8', body: '#f9f3e3', trim: '#d9cfb6', roof: '#d8480f',
    accent: '#1f5f7a', worker: '#d8480f', busy: '#d8480f', ok: '#2f6b3c', fail: '#b3261e', idle: '#9a8d72',
    crate: '#f9f3e3', tape: '#d8480f', smoke: '#6b6150', moss: '#7fb3c8', glow: '#d8480f', window: '#f4ecd8', door: '#2a2620',
    sky: '#fffaf0', sun: '#fff4dc', panel: '#d5dfdc', star: '#2a2620',
    sunIntensity: 1.5, skyIntensity: 1.9, envIntensity: 0.5, exposure: 1.02, fogNear: 16, fogSpan: 34,
  },
  dark: {
    ground: '#060a18', horizon: '#060a18', zenith: '#03050c',
    line: '#62d6e8', aisle: '#0c1326', body: '#16224a', trim: '#26355a', roof: '#ffb347',
    accent: '#62d6e8', worker: '#ffb347', busy: '#ffb347', ok: '#7be0a0', fail: '#ff7a6b', idle: '#7486b0',
    crate: '#ffe2b8', tape: '#ffb347', smoke: '#7486b0', moss: '#a8dcff', glow: '#62d6e8', window: '#ffd59a', door: '#060a18',
    sky: '#8fb4ff', sun: '#e8efff', panel: '#12306a', star: '#dfe8ff',
    sunIntensity: 1.6, skyIntensity: 1.5, envIntensity: 0.7, exposure: 1.1, fogNear: 16, fogSpan: 34,
  },
};

// The stage's backdrop is the theme's own sky: by night theme.css's
// --orbit-night-sky, so the floor stands under the same stars as the chrome
// around it, and by day its graph paper.
function backdrop(mode) {
  return mode === 'dark'
    ? 'var(--orbit-night-sky), '
      + 'radial-gradient(ellipse 70% 70% at 20% 0%, rgb(27 42 107 / .55), transparent 100%), #060a18'
    : 'repeating-linear-gradient(0deg, transparent 0 39px, rgb(42 38 32 / .09) 39px 40px), '
      + 'repeating-linear-gradient(90deg, transparent 0 39px, rgb(42 38 32 / .09) 39px 40px), #efe6d0';
}

// The outer modules swing back towards the hub, like arms of a station, and
// the camera sits high so the floor reads as a plan.
// The navigator who advises stands past the tips of the hub's port wings,
// which fill the stock spot.
const layout = { bend: -0.25, turn: 0.2, advisor: { x: -6.1, z: -5.2, yaw: 0.75 } };
const view = { elevation: 0.72, azimuth: 0.1 };

const TAU = Math.PI * 2;
const seeded = i => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// The engine frees whatever is in the kit's material map with the scene, so
// the line materials and the painted sheets live there, one of each per look.
function shared(kit, key, make) {
  if (!kit.materials.has(key)) kit.materials.set(key, make());
  return kit.materials.get(key);
}

function ink(kit, colour = 'line') {
  return shared(kit, 'orbit-ink:' + kit.color(colour).getHexString(), () => new LineBasicMaterial({ color: kit.color(colour) }));
}

// Inks a mesh's edges over its fill. Call it once the geometry is final: the
// edges are taken from the geometry as it stands.
function inked(kit, mesh, colour = 'line', angle = 24) {
  mesh.add(new LineSegments(new EdgesGeometry(mesh.geometry, angle), ink(kit, colour)));
  return mesh;
}

// The still parts of a model drawn as one mesh per material. Every mesh
// directly in `group`, bar those in `keep` (the parts that move, blink or that
// the engine looks for), is laid into one geometry per material, and so are
// the inked edges over them. Parts in their own groups are left alone, so a
// turning wheel is welded on its own. A busy floor draws about a third as many.
function weld(group, keep = []) {
  const held = new Set(keep);
  const runs = new Map();
  const take = (object, matrix) => {
    const key = (object.isLineSegments ? 'line:' : 'mesh:') + object.material.uuid;
    if (!runs.has(key)) runs.set(key, { line: object.isLineSegments, material: object.material, parts: [] });
    const flat = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    runs.get(key).parts.push(flat.applyMatrix4(matrix));
    object.geometry.dispose();
  };
  for (const child of [...group.children]) {
    if (!child.isMesh || held.has(child) || child.children.some(edge => !edge.isLineSegments || edge.children.length)) continue;
    child.updateMatrix();
    take(child, child.matrix);
    for (const edge of child.children) {
      edge.updateMatrix();
      take(edge, child.matrix.clone().multiply(edge.matrix));
    }
    group.remove(child);
  }
  for (const { line, material, parts } of runs.values()) {
    const geometry = new BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      if (!parts.every(part => part.attributes[name])) continue;
      const array = new Float32Array(parts.reduce((sum, part) => sum + part.attributes[name].array.length, 0));
      let at = 0;
      for (const part of parts) {
        array.set(part.attributes[name].array, at);
        at += part.attributes[name].array.length;
      }
      geometry.setAttribute(name, new BufferAttribute(array, parts[0].attributes[name].itemSize));
    }
    parts.forEach(part => part.dispose());
    group.add(line ? new LineSegments(geometry, material) : new Mesh(geometry, material));
  }
  return group;
}

const hull = kit => kit.mat('body', { rough: 0.9, metal: 0 });
const lit = (kit, colour, glow) => kit.mat(colour, { rough: 0.5, emissive: colour, glow: kit.mode === 'dark' ? glow : glow * 0.2 });

// A solar wing's face: cells ruled off in the line colour.
function cells(kit) {
  return shared(kit, 'orbit-cells', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = '#' + kit.palette.panel.getHexString();
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#' + kit.palette.line.getHexString();
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    for (const y of [0.25, 0.5, 0.75]) { ctx.moveTo(0, h * y); ctx.lineTo(w, h * y); }
    ctx.stroke();
  }, { width: 64, height: 128, rough: 0.6, metal: 0.1, emissive: kit.mode === 'dark', glow: 0.5 }));
}

function wing(kit, width, depth, at) {
  return inked(kit, kit.box(width, 0.03, depth, cells(kit), at));
}

// The corridor's gates: hoops of this radius standing at this height, at
// these places along it. The shuttles fly through their middle.
const GATES = { z: [-2.55, 0.35, 3.25, 6.15], y: 0.8, radius: 1.2 };

// The plotting grid: a sheet of fine squares with a cross at every corner,
// and nothing between the lines, so the sky shows through it. The approach
// corridor is two rails with landing lights and a dashed centre line.
function floor(kit) {
  const group = new Group();
  const line = '#' + kit.palette.line.getHexString();
  const sheet = new Mesh(new CircleGeometry(60, 64), shared(kit, 'orbit-grid', () => kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = line;
    ctx.globalAlpha = kit.mode === 'dark' ? 0.16 : 0.2;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h);
    ctx.globalAlpha = kit.mode === 'dark' ? 0.5 : 0.55;
    ctx.beginPath();
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y);
      ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9);
    }
    ctx.stroke();
  }, { width: 256, height: 256, repeat: [40, 40], basic: true, transparent: true })));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0, 0, -5);
  group.add(sheet);
  const rail = lit(kit, 'accent', 0.9);
  for (const side of [-1, 1]) group.add(kit.box(0.04, 0.02, 13.8, rail, [side * 0.98, 0.012, 3.3]));
  const light = lit(kit, 'roof', 1.5);
  for (let z = -2.4; z < 9.9; z += 1.2) {
    for (const side of [-1, 1]) group.add(kit.box(0.12, 0.03, 0.12, light, [side * 0.98, 0.03, z]));
  }
  const dash = kit.basic('line', { opacity: 0.55 });
  for (let z = -2.5; z < 9.9; z += 0.8) {
    const mark = new Mesh(new PlaneGeometry(0.05, 0.36), dash);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.012, z);
    group.add(mark);
  }
  // Approach gates: lit hoops the shuttles fly through on their way in. Each
  // stands just hub-side of where a row's shuttles join the corridor (the gap
  // at row z - 1.45), so even a first-row delivery passes one.
  const hoop = lit(kit, 'accent', 0.55);
  const { y, radius } = GATES;
  for (const z of GATES.z) {
    const gate = new Mesh(new TorusGeometry(radius, 0.024, 6, 40), hoop);
    gate.position.set(0, y, z);
    group.add(gate);
    for (const a of [0.5, 1.1, Math.PI - 1.1, Math.PI - 0.5]) {
      group.add(kit.sphere(0.06, light, [Math.cos(a) * radius, y + Math.sin(a) * radius, z], 8));
    }
  }
  group.add(rangePlot(kit));
  group.userData.gates = GATES;
  return weld(group);
}


// The range plot a flight controller keeps round the station: two fine rings
// ticked every five degrees, with bearings lettered round the inner one.
function rangePlot(kit) {
  const sheet = new Mesh(new PlaneGeometry(24, 24), shared(kit, 'orbit-plot', () => kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    const unit = w / 24;
    ctx.strokeStyle = ctx.fillStyle = '#' + kit.palette.line.getHexString();
    for (const [radius, alpha] of [[7.2, 0.34]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, radius * unit, 0, TAU); ctx.stroke();
      for (let step = 0; step < 72; step += 1) {
        const a = (step / 72) * TAU;
        const long = step % 9 === 0 ? 0.5 : step % 3 === 0 ? 0.3 : 0.16;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * radius * unit, Math.sin(a) * radius * unit);
        ctx.lineTo(Math.cos(a) * (radius + long) * unit, Math.sin(a) * (radius + long) * unit);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.5;
    ctx.font = '600 ' + Math.round(unit * 0.34) + 'px Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [label, a] of [['090', 0], ['270', Math.PI], ['045', -Math.PI / 4], ['135', Math.PI / 4], ['225', Math.PI * 0.75], ['315', -Math.PI * 0.75]]) {
      ctx.fillText(label, Math.cos(a) * 8.2 * unit, Math.sin(a) * 8.2 * unit);
    }
  }, { width: 2048, height: 2048, basic: true, transparent: true })));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(0, 0.014, -5);
  return sheet;
}

// The dotted orbit a schematic draws round the station it describes.
function orbitRing(kit, size) {
  const sheet = new Mesh(new PlaneGeometry(size, size), shared(kit, 'orbit-ring', () => kit.painted((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#' + kit.palette.line.getHexString();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 14]);
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 6, 0, TAU); ctx.stroke();
  }, { width: 512, height: 512, basic: true, transparent: true })));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 0.016;
  return sheet;
}

// A crew member on a spacewalk: a round suit, a gold visor and a pack.
function astronaut(kit) {
  const group = new Group();
  const suit = kit.mat(kit.mode === 'dark' ? '#eef2fb' : '#fffaf0', { rough: 0.7 });
  const visor = kit.mat('roof', { rough: 0.25, metal: 0.4, emissive: 'roof', glow: kit.mode === 'dark' ? 0.5 : 0.1 });
  group.add(kit.sphere(0.12, suit, [0, 0.36, 0], 12));
  group.add(kit.sphere(0.075, visor, [0, 0.365, 0.07], 10));
  group.add(kit.cylinder(0.095, 0.085, 0.2, suit, [0, 0.17, 0], 10));
  group.add(kit.box(0.17, 0.2, 0.09, kit.mat('trim', { rough: 0.8 }), [0, 0.2, -0.1]));
  for (const side of [-1, 1]) {
    const arm = kit.cylinder(0.035, 0.035, 0.17, suit, [side * 0.13, 0.24, 0.02], 6);
    arm.rotation.z = side * 0.9;
    group.add(arm);
    group.add(kit.cylinder(0.04, 0.04, 0.14, suit, [side * 0.05, 0.02, 0], 6));
  }
  return weld(group);
}

// A truss: two chords with rungs between, the way a schematic draws a girder.
function truss(kit, length, at, colour = 'trim') {
  const group = new Group();
  const bar = kit.mat(colour, { rough: 0.8 });
  for (const z of [-0.09, 0.09]) group.add(kit.box(length, 0.03, 0.03, bar, [0, 0, z]));
  for (let x = -length / 2; x <= length / 2 + 0.01; x += 0.3) group.add(kit.box(0.03, 0.03, 0.2, bar, [x, 0, 0]));
  group.position.set(...at);
  return weld(group);
}

// The hub: a stacked core on a docking collar with its port facing the
// corridor, a habitat ring turning over its deck, a long truss carrying four
// solar wings and two radiators, a dish that tracks, a service drone flying
// the dotted orbit and a crew member out on a tether.
function hall(kit) {
  const group = new Group();
  const body = hull(kit);
  const trim = kit.mat('trim', { rough: 0.8 });
  const flare = kit.mat('roof', { rough: 0.6 });
  const strut = lit(kit, 'accent', 0.5);
  // The engine finds the dotted orbit as a ground decal, so it stays a plane.
  const plot = orbitRing(kit, 7.6);
  group.add(plot);
  group.add(inked(kit, kit.cylinder(1.05, 1.15, 0.16, trim, [0, 0.08, 0], 32)));
  group.add(inked(kit, kit.cylinder(1.3, 1.3, 1.5, body, [0, 0.9, 0], 40)));
  // A band of lit ports round the core, clear of the docking port.
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * TAU + 0.22;
    if (Math.cos(a) > 0.6) continue;
    const port = kit.box(0.2, 0.13, 0.03, kit.windows, [Math.sin(a) * 1.305, 1.25, Math.cos(a) * 1.305]);
    port.rotation.y = a;
    group.add(port);
  }
  group.add(kit.cylinder(1.32, 1.32, 0.09, flare, [0, 0.42, 0], 40));
  group.add(inked(kit, kit.cylinder(0.86, 1.1, 0.34, trim, [0, 1.82, 0], 32)));
  group.add(inked(kit, kit.cylinder(0.62, 0.62, 0.42, body, [0, 2.2, 0], 24)));
  const ring = new Mesh(new TorusGeometry(0.86, 0.03, 6, 48), lit(kit, 'accent', 1.1));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.0;
  group.add(ring);
  // The habitat ring: a wheel on four spokes, lit ports round its rim.
  const wheel = new Group();
  wheel.position.y = 2.72;
  const tyre = new Mesh(new TorusGeometry(2.0, 0.16, 8, 56), body);
  tyre.rotation.x = Math.PI / 2;
  wheel.add(tyre);
  for (const radius of [1.84, 2.16]) {
    const edge = new Mesh(new TorusGeometry(radius, 0.012, 4, 56), kit.basic('line'));
    edge.rotation.x = Math.PI / 2;
    wheel.add(edge);
  }
  for (let i = 0; i < 4; i += 1) {
    const spoke = kit.box(3.7, 0.07, 0.07, trim);
    spoke.rotation.y = (i / 4) * Math.PI;
    wheel.add(spoke);
  }
  for (let i = 0; i < 20; i += 1) {
    const a = (i / 20) * TAU;
    const port = kit.box(0.16, 0.07, 0.03, i % 5 === 0 ? lit(kit, 'roof', 1.4) : kit.windows, [Math.sin(a) * 2.165, 0.02, Math.cos(a) * 2.165]);
    port.rotation.y = a;
    wheel.add(port);
  }
  wheel.add(inked(kit, kit.cylinder(0.3, 0.3, 0.22, trim, [0, 0, 0], 12)));
  group.add(weld(wheel));
  group.add(kit.cylinder(0.06, 0.06, 0.5, trim, [0, 2.6, 0], 8));
  // The long truss behind the core: two solar wings and a radiator each side.
  for (const side of [-1, 1]) {
    group.add(truss(kit, 3.0, [side * 2.75, 1.1, -0.35]));
    for (const x of [2.55, 3.75]) {
      group.add(wing(kit, 0.9, 1.25, [side * x, 1.1, -1.27]));
      group.add(wing(kit, 0.9, 1.25, [side * x, 1.1, 0.57]));
    }
    group.add(inked(kit, kit.box(0.5, 0.03, 0.9, kit.mat('crate', { rough: 0.7 }), [side * 1.72, 1.1, -0.95]), 'roof'));
    // Navigation lamps at the truss tips: red to port, green to starboard.
    group.add(kit.sphere(0.07, lit(kit, side < 0 ? 'fail' : 'ok', 1.6), [side * 4.3, 1.16, -0.35], 8));
  }
  // A dish on a boom at the back, tracking.
  const dish = new Group();
  dish.position.set(-0.75, 2.5, -0.95);
  const bowl = new Mesh(new ConeGeometry(0.42, 0.2, 20, 1, true), kit.mat('crate', { rough: 0.7, doubleSide: true }));
  bowl.rotation.x = -2.2;
  dish.add(bowl);
  dish.add(kit.sphere(0.05, lit(kit, 'roof', 1.5), [0, 0.2, -0.26], 8));
  group.add(dish);
  group.add(kit.cylinder(0.03, 0.03, 0.5, trim, [-0.75, 2.25, -0.95], 6));
  // Struts either side, each ending in a docking collar.
  for (const side of [-1, 1]) {
    group.add(kit.box(0.7, 0.14, 0.14, strut, [side * 1.65, 0.7, 0.35]));
    const collar = inked(kit, kit.cylinder(0.3, 0.3, 0.16, body, [side * 2.05, 0.7, 0.35], 16));
    collar.rotation.z = Math.PI / 2;
    group.add(collar);
  }
  // The docking port: a flare collar with a door that rolls up into the hull,
  // and two guide arms with running lamps.
  group.add(inked(kit, kit.box(1.9, 1.56, 0.3, flare, [0, 0.95, 1.18])));
  group.add(kit.box(1.62, 1.32, 0.05, kit.mat('door', { rough: 1 }), [0, 0.92, 1.33]));
  const door = kit.box(1.56, 1.28, 0.06, body, [0, 0, 0]);
  door.geometry.translate(0, -0.64, 0);
  door.position.set(0, 1.57, 1.37);
  group.add(inked(kit, door));
  const guides = [];
  for (const side of [-1, 1]) {
    group.add(kit.box(0.06, 0.06, 0.9, trim, [side * 1.05, 0.2, 1.78]));
    for (let i = 0; i < 3; i += 1) {
      const lamp = kit.sphere(0.055, lit(kit, 'accent', 1.3), [side * 1.05, 0.27, 1.5 + i * 0.3], 8);
      group.add(lamp);
      guides.push([lamp, i]);
    }
  }
  // The service drone on the dotted orbit.
  const drone = new Group();
  drone.add(inked(kit, kit.box(0.26, 0.2, 0.34, body)));
  drone.add(wing(kit, 0.7, 0.2, [0, 0.02, 0]));
  drone.add(kit.sphere(0.05, lit(kit, 'roof', 1.6), [0, 0.02, 0.2], 8));
  group.add(weld(drone));
  // A crew member out on a tether.
  const walker = astronaut(kit);
  walker.scale.setScalar(1.25);
  const tether = kit.cylinder(0.008, 0.008, 1.0, kit.basic('line', { opacity: 0.8 }), [0, 0, 0], 4);
  group.add(walker, tether);
  const beacon = kit.sphere(0.2, kit.beacon, [0, 2.5, 0]);
  group.add(beacon);
  let pulse = -Infinity;
  let clock = 0;
  const up = new Vector3(0, 1, 0);
  const from = new Vector3(-1.25, 1.3, 0.35);
  const to = new Vector3();
  const along = new Vector3();
  const place = time => {
    const a = time * 0.35 + 0.9;
    drone.position.set(Math.sin(a) * 3.62, 0.5 + Math.sin(time * 1.3) * 0.05, Math.cos(a) * 3.62);
    drone.rotation.y = a + Math.PI / 2;
    walker.position.set(-2.3, 1.75 + Math.sin(time * 0.7) * 0.08, 1.2);
    walker.rotation.set(Math.sin(time * 0.5) * 0.25, 0.5, Math.sin(time * 0.4) * 0.3);
    to.copy(walker.position).setY(walker.position.y + 0.25);
    tether.position.copy(from).add(to).multiplyScalar(0.5);
    tether.scale.y = from.distanceTo(to);
    tether.quaternion.setFromUnitVectors(up, along.subVectors(to, from).normalize());
    guides.forEach(([lamp, i]) => lamp.scale.setScalar(0.6 + 0.7 * Math.max(0, Math.sin(time * 4 - i * 1.1))));
  };
  place(0);
  group.userData = {
    door,
    beacon,
    spin: [[wheel, 'y', 0.22]],
    swing: [[dish, 'y', 0.5, 0.35]],
    chimney: new Vector3(-1.2, 1.8, -1.0),
    labelY: 4.5,
    react() { pulse = clock; },
    frame(time) {
      clock = time;
      if (kit.reducedMotion) return;
      const kick = Math.max(0, 1 - (time - pulse) / 0.8);
      ring.scale.setScalar(1 + kick * 0.12);
      place(time);
    },
  };
  return kit.shadows(weld(group, [plot, ring, door, beacon, tether, ...guides.map(([lamp]) => lamp)]));
}

function ghost(kit) {
  const group = new Group();
  const outline = kit.basic('accent', { opacity: 0.6 });
  for (const y of [0.25, 0.95]) {
    const hoop = new Mesh(new TorusGeometry(0.6, 0.02, 4, 24), outline);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    group.add(hoop);
  }
  group.add(kit.cylinder(0.6, 0.6, 0.7, kit.basic('glow', { opacity: 0.08, additive: kit.mode === 'dark' }), [0, 0.6, 0], 24));
  return group;
}

// Every module stands on a six-sided pad with a lamp at three corners and a
// gangway towards the corridor.
function pad(kit) {
  const group = new Group();
  group.add(inked(kit, kit.cylinder(0.92, 0.92, 0.05, kit.mat('aisle', { rough: 0.9 }), [0, 0.03, 0], 6)));
  group.add(inked(kit, kit.box(0.34, 0.03, 0.42, kit.mat('trim', { rough: 0.8 }), [0, 0.03, 0.98])));
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU + TAU / 12;
    group.add(kit.sphere(0.05, lit(kit, 'accent', 1.2), [Math.sin(a) * 0.92, 0.08, Math.cos(a) * 0.92], 8));
  }
  return weld(group);
}

// A docked module on its pad. Workers are a lab with a dish, a greenhouse
// under glass or an observatory; subagents are a pod, a foil-wrapped cubesat,
// a deep-space probe or a repair bay with a crew member welding. Each has a
// state lamp on a stalk and parts that move while its agent works.
function station(kit, kind, spot = { index: 0 }) {
  const group = new Group();
  const worker = kind === 'worker';
  const body = hull(kit);
  const trim = kit.mat('trim', { rough: 0.8 });
  const band = kit.mat(worker ? 'worker' : 'accent', { rough: 0.6 });
  const spin = [];
  const swing = [];
  const occupants = [];
  let top = 1;
  let lampAt = [0.3, 1.2, 0.2];
  let frame = null;
  group.add(pad(kit));
  const variant = worker ? spot.index % 3 : spot.index % 4;
  const boomWings = (y, z, span, depth) => {
    const boom = new Group();
    boom.position.set(0, y, z);
    boom.add(kit.box(span, 0.035, 0.035, trim));
    for (const side of [-1, 1]) boom.add(wing(kit, 0.3, depth, [side * (span / 2 - 0.15), 0, 0]));
    group.add(weld(boom));
    spin.push([boom, 'x', worker ? 1.2 : 1.6]);
  };
  if (worker && variant === 0) {
    // The lab: a long compartment with a comms dish.
    top = 1.0;
    group.add(inked(kit, kit.box(1.14, 0.72, 0.9, body, [0, 0.64, 0])));
    group.add(kit.box(1.16, 0.07, 0.92, band, [0, 0.36, 0]));
    group.add(kit.box(0.74, 0.13, 0.03, kit.windows, [-0.1, 0.8, 0.455]));
    group.add(inked(kit, kit.cylinder(0.2, 0.24, 0.24, trim, [0, 0.17, 0.12], 12)));
    boomWings(0.64, -0.12, 1.84, 0.62);
    const dish = new Mesh(new ConeGeometry(0.22, 0.13, 16, 1, true), kit.mat('crate', { rough: 0.8, doubleSide: true }));
    const mount = new Group();
    mount.position.set(-0.3, top + 0.12, -0.15);
    dish.rotation.z = 0.9;
    mount.add(dish);
    mount.add(kit.cylinder(0.015, 0.015, 0.18, trim, [0, -0.06, 0], 6));
    group.add(mount);
    swing.push([mount, 'y', 0.8, 0.9 + seeded(spot.index) * 0.6]);
    lampAt = [0.42, top + 0.26, 0.2];
  } else if (worker && variant === 1) {
    // The greenhouse: a planter drum under a glass dome, with a grow lamp.
    top = 1.05;
    group.add(inked(kit, kit.cylinder(0.62, 0.62, 0.34, body, [0, 0.25, 0], 20)));
    group.add(kit.cylinder(0.64, 0.64, 0.07, band, [0, 0.38, 0], 20));
    const glass = new Mesh(new SphereGeometry(0.58, 20, 10, 0, TAU, 0, Math.PI / 2), kit.mat('accent', { rough: 0.15, metal: 0.1, opacity: 0.28, doubleSide: true }));
    glass.position.y = 0.42;
    group.add(glass);
    const rib = new Mesh(new TorusGeometry(0.58, 0.014, 4, 32), kit.basic('line'));
    rib.rotation.x = Math.PI / 2;
    rib.position.y = 0.43;
    group.add(rib);
    for (const turn of [0, Math.PI / 2]) {
      const arch = new Mesh(new TorusGeometry(0.58, 0.012, 4, 24, Math.PI), kit.basic('line'));
      arch.position.y = 0.42;
      arch.rotation.y = turn;
      group.add(arch);
    }
    const leaf = kit.mat('ok', { rough: 0.8, emissive: 'ok', glow: kit.mode === 'dark' ? 0.35 : 0.05 });
    const plants = new Group();
    for (const [x, z, h] of [[-0.24, 0.1, 0.3], [0.2, 0.2, 0.24], [0.08, -0.22, 0.34], [-0.1, -0.1, 0.2], [0.3, -0.1, 0.22]]) {
      const cone = new Mesh(new ConeGeometry(0.11, h, 6), leaf);
      cone.position.set(x, 0.42 + h / 2, z);
      plants.add(cone);
    }
    group.add(plants);
    occupants.push(plants);
    group.add(kit.sphere(0.06, lit(kit, 'window', 1.6), [0, 0.94, 0], 8));
    boomWings(0.2, -0.5, 1.9, 0.5);
    lampAt = [0.5, top + 0.2, 0.35];
  } else if (worker) {
    // The observatory: a telescope on a fork that sweeps while it works.
    top = 1.15;
    group.add(inked(kit, kit.cylinder(0.5, 0.56, 0.4, body, [0, 0.28, 0], 16)));
    group.add(kit.cylinder(0.58, 0.58, 0.07, band, [0, 0.2, 0], 16));
    const mount = new Group();
    mount.position.set(0, 0.5, 0);
    for (const side of [-1, 1]) mount.add(kit.box(0.06, 0.5, 0.2, trim, [side * 0.3, 0.25, 0]));
    const scope = new Group();
    scope.position.y = 0.42;
    scope.rotation.x = -0.75;
    scope.add(inked(kit, kit.cylinder(0.24, 0.2, 0.95, body, [0, 0.12, 0], 14)));
    scope.add(kit.cylinder(0.255, 0.255, 0.08, band, [0, 0.56, 0], 14));
    const lens = new Mesh(new CircleGeometry(0.2, 16), kit.basic('glow', { opacity: 0.85, additive: kit.mode === 'dark' }));
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = 0.602;
    scope.add(lens);
    mount.add(scope);
    group.add(mount);
    swing.push([mount, 'y', 0.7, 0.5 + seeded(spot.index) * 0.4]);
    boomWings(0.26, -0.55, 1.9, 0.5);
    lampAt = [0.48, top + 0.1, 0.42];
  } else if (variant === 0) {
    // The pod: eight sides and a window strip.
    top = 0.84;
    const pod = inked(kit, kit.cylinder(0.46, 0.46, 0.56, body, [0, 0.56, 0], 8));
    pod.rotation.y = TAU / 16;
    group.add(pod);
    group.add(kit.cylinder(0.47, 0.47, 0.07, band, [0, 0.36, 0], 8)).rotation.y = TAU / 16;
    group.add(kit.box(0.3, 0.13, 0.03, kit.windows, [0, 0.64, 0.43]));
    group.add(inked(kit, kit.cylinder(0.2, 0.24, 0.24, trim, [0, 0.17, 0.12], 12)));
    boomWings(0.56, -0.12, 1.84, 0.5);
    lampAt = [0.24, top + 0.26, 0.2];
  } else if (variant === 1) {
    // The cubesat: a foil-wrapped cube turning on a stalk, whips at its corners.
    top = 1.0;
    group.add(kit.cylinder(0.03, 0.05, 0.4, trim, [0, 0.25, 0], 6));
    const sat = new Group();
    sat.position.y = 0.7;
    sat.add(inked(kit, kit.box(0.44, 0.44, 0.44, kit.mat('roof', { rough: 0.35, metal: 0.5 })), 'line'));
    sat.add(kit.box(0.2, 0.2, 0.02, kit.windows, [0, 0, 0.225]));
    for (const side of [-1, 1]) sat.add(wing(kit, 0.62, 0.36, [side * 0.55, 0, 0]));
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
      const whip = kit.cylinder(0.008, 0.008, 0.4, trim, [x * 1.2, 0.38, z * 1.2], 4);
      whip.rotation.set(z * 1.5, 0, -x * 1.5);
      sat.add(whip);
    }
    sat.rotation.set(0.25, 0.5, 0.15);
    group.add(weld(sat));
    spin.push([sat, 'y', 0.7]);
    lampAt = [0.5, top + 0.1, 0.4];
  } else if (variant === 2) {
    // The probe: a big dish on a small bus, an instrument boom to one side.
    top = 1.05;
    group.add(inked(kit, kit.cylinder(0.3, 0.3, 0.26, body, [0, 0.36, 0], 10)));
    group.add(kit.cylinder(0.31, 0.31, 0.06, band, [0, 0.3, 0], 10));
    group.add(kit.cylinder(0.04, 0.06, 0.24, trim, [0, 0.12, 0], 6));
    const aim = new Group();
    aim.position.y = 0.52;
    const bowl = new Mesh(new ConeGeometry(0.56, 0.22, 24, 1, true), kit.mat('crate', { rough: 0.75, doubleSide: true }));
    bowl.rotation.x = Math.PI + 0.35;
    bowl.position.y = 0.16;
    aim.add(bowl);
    aim.add(kit.cylinder(0.012, 0.012, 0.4, trim, [0, 0.3, 0.06], 4));
    aim.add(kit.sphere(0.045, lit(kit, 'accent', 1.5), [0, 0.5, 0.09], 8));
    group.add(aim);
    swing.push([aim, 'y', 0.6, 0.7 + seeded(spot.index) * 0.5]);
    group.add(kit.box(1.1, 0.025, 0.025, trim, [0.6, 0.4, -0.1]));
    group.add(inked(kit, kit.box(0.14, 0.14, 0.14, kit.mat('roof', { rough: 0.5 }), [1.12, 0.4, -0.1])));
    lampAt = [-0.45, top + 0.05, 0.4];
  } else {
    // The repair bay: an open frame round a panel, and a crew member welding.
    top = 0.95;
    for (const [x, z] of [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.3], [0.5, 0.3]]) group.add(kit.box(0.04, 0.8, 0.04, trim, [x, 0.45, z]));
    for (const z of [-0.4, 0.3]) group.add(kit.box(1.04, 0.04, 0.04, trim, [0, 0.85, z]));
    for (const x of [-0.5, 0.5]) group.add(kit.box(0.04, 0.04, 0.74, trim, [x, 0.85, -0.05]));
    const panel = wing(kit, 0.7, 0.44, [0, 0.42, -0.1]);
    panel.rotation.x = 0.5;
    group.add(panel);
    const crew = astronaut(kit);
    crew.position.set(0.12, 0.2, 0.34);
    crew.rotation.y = Math.PI;
    crew.scale.setScalar(1.15);
    group.add(crew);
    occupants.push(crew);
    const spark = kit.sphere(0.06, kit.basic('window', { additive: kit.mode === 'dark' }), [0.04, 0.5, 0.1], 8);
    group.add(spark);
    occupants.push(spark);
    frame = (time, dt, record) => {
      spark.visible = !kit.reducedMotion && record.activity > 0.2 && Math.sin(time * 23 + spot.index) > 0.2;
      if (!kit.reducedMotion) crew.position.y = 0.2 + Math.sin(time * 1.1 + spot.index) * 0.03;
    };
    lampAt = [0.5, top + 0.2, 0.3];
  }
  // A worker's crew stands by on the pad.
  if (worker) {
    const crew = astronaut(kit);
    crew.position.set(0.62, 0.06, 0.52);
    crew.rotation.y = -0.5;
    group.add(crew);
    occupants.push(crew);
  }
  const lamp = new Mesh(new SphereGeometry(0.1, 12, 8), kit.lamp());
  group.add(kit.cylinder(0.018, 0.018, lampAt[1] - 0.06, trim, [lampAt[0], (lampAt[1] + 0.06) / 2, lampAt[2]], 6));
  lamp.position.set(...lampAt);
  group.add(lamp);
  group.userData = {
    lamp, spin, swing, occupants,
    puff: new Vector3(0, top + 0.1, -0.3),
    labelY: top + 0.62,
  };
  if (frame) group.userData.frame = frame;
  return kit.shadows(weld(group, [lamp, ...occupants]));
}

// The cargo bay beside the hub's port, where delivered canisters are stacked:
// an inked tray with a lamp at each corner. HALL is at z -5 on the floor.
function dock(kit) {
  const group = new Group();
  group.position.set(3.5, 0, -3.58);
  group.add(inked(kit, kit.box(1.94, 0.06, 1.34, hull(kit), [0, 0.2, 0])));
  group.add(inked(kit, kit.box(1.5, 0.02, 0.9, kit.mat('trim', { rough: 0.8 }), [0, 0.24, 0])));
  const lamp = lit(kit, 'accent', 1.2);
  for (const [x, z] of [[-0.92, -0.62], [0.92, -0.62], [-0.92, 0.62], [0.92, 0.62]]) {
    group.add(kit.sphere(0.055, lamp, [x, 0.27, z], 8));
  }
  const trim = kit.mat('trim', { rough: 0.8 });
  const arm = kit.mat('roof', { rough: 0.6 });
  group.add(inked(kit, kit.cylinder(0.13, 0.16, 0.22, trim, [1.15, 0.31, -0.5], 10)));
  const lower = kit.box(0.07, 0.9, 0.07, arm, [1.0, 0.8, -0.42]);
  lower.rotation.z = 0.35;
  const upper = kit.box(0.06, 0.8, 0.06, arm, [0.5, 1.3, -0.3]);
  upper.rotation.z = 1.25;
  group.add(lower, upper, kit.sphere(0.07, trim, [0.86, 1.2, -0.38], 8), kit.box(0.14, 0.1, 0.14, trim, [0.14, 1.16, -0.24]));
  return group;
}

// A cargo canister, banded in the flare.
function crate(kit) {
  const group = new Group();
  const shell = inked(kit, kit.cylinder(0.2, 0.2, 0.42, kit.mat('crate', { rough: 0.8 }), [0, 0, 0], 12), 'tape');
  shell.rotation.z = Math.PI / 2;
  group.add(shell);
  for (const x of [-0.12, 0.12]) {
    const band = kit.cylinder(0.205, 0.205, 0.05, kit.mat('tape', { rough: 0.6 }), [x, 0, 0], 12);
    band.rotation.z = Math.PI / 2;
    group.add(band);
  }
  return kit.shadows(group);
}

// How high a shuttle flies: through the middle of the gates in the corridor,
// and up over the modules' wings and booms on the cross streets, climbing as it
// leaves the corridor's edge.
const FLIGHT = { corridor: 0.72, street: 1.7, from: 0.9, span: 0.8 };
const flightHeight = x => {
  const u = Math.min(1, Math.max(0, (Math.abs(x) - FLIGHT.from) / FLIGHT.span));
  return FLIGHT.corridor + (FLIGHT.street - FLIGHT.corridor) * u * u * (3 - 2 * u);
};

// A shuttle: the delta dart a schematic draws on a return path, inked in the
// flare, with its engine burning behind it.
function carrier(kit) {
  const object = new Group();
  const craft = new Group();
  craft.position.y = FLIGHT.corridor;
  object.add(craft);
  const dart = new Mesh(new ConeGeometry(0.52, 1.2, 3), kit.mat('crate', { rough: 0.8 }));
  dart.geometry.rotateX(Math.PI / 2);
  dart.geometry.rotateZ(Math.PI);
  dart.geometry.scale(1, 0.3, 1);
  craft.add(inked(kit, dart, 'roof', 1));
  craft.add(kit.box(0.05, 0.26, 0.4, kit.mat('roof', { rough: 0.6 }), [0, 0.14, -0.36]));
  const flame = new Mesh(new CircleGeometry(0.15, 16), kit.basic('roof', { opacity: 0.9, additive: kit.mode === 'dark' }));
  flame.position.z = -0.61;
  flame.rotation.y = Math.PI;
  craft.add(flame);
  const hold = new Group();
  hold.position.y = -0.3;
  craft.add(hold);
  kit.shadows(object);
  return {
    object, hold, route: 'ground', cruise: 2.6,
    pose(target, { time, speed }) {
      craft.rotation.z = Math.sin(time * 2.4) * 0.1;
      craft.position.y = flightHeight(target.position.x) + Math.sin(time * 3.1) * 0.05;
      flame.scale.setScalar(0.6 + speed * 0.9 + Math.sin(time * 40) * 0.12);
    },
  };
}

// Beyond the grid, and under it: there is no ground here, so the camera looks
// down through the plot at whatever the station is flying over. That is the
// theme's own ringed planet, with a moon, drifting rock and passing traffic.
const PLANET = { at: [25, -35, -12], radius: 24 };
const ROCKS = [
  // x, y, z, size: all in the far field, clear of where modules stand
  [-19, -8, -16, 0.95], [-14, -4, -9, 0.5], [-9, -6, -22, 0.65], [10, -4, -22, 0.65],
  [4, -7, -26, 0.8], [-21, -12, -22, 1.2], [-16.5, -6, -12.5, 0.3],
];
const scenes = new WeakMap();

function unfogged(kit, key, make) {
  return shared(kit, key, () => {
    const material = make();
    material.fog = false;
    // A painted sheet keeps its inks: the tone curve greys paper.
    if (material.isMeshBasicMaterial) material.toneMapped = false;
    return material;
  });
}

// The planet's face, wrapped once round it: bands of cloud, a storm and a
// pale belt by night; ruled parallels and hatching by day.
function planetFace(kit) {
  const dark = kit.mode === 'dark';
  return unfogged(kit, 'orbit-planet', () => kit.painted((ctx, w, h) => {
    if (dark) {
      const bands = ['#10255a', '#17357a', '#22509c', '#2f64b4', '#22509c', '#5a8ccf', '#2b5aa8', '#1d4288', '#22509c', '#3f76c2', '#214a94', '#17357a', '#10255a'];
      const step = h / bands.length;
      bands.forEach((colour, i) => { ctx.fillStyle = colour; ctx.fillRect(0, i * step, w, step + 1); });
      // Soften each band's edge into wavy streaks.
      for (let i = 0; i < 90; i += 1) {
        const y = seeded(i) * h;
        const amplitude = 2 + seeded(i + 40) * 7;
        ctx.strokeStyle = seeded(i + 80) > 0.5 ? 'rgba(160, 205, 255, 0.16)' : 'rgba(8, 20, 60, 0.2)';
        ctx.lineWidth = 2 + seeded(i + 120) * 9;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 16) {
          const wave = Math.sin((x / w) * TAU * (2 + Math.floor(seeded(i + 7) * 4)) + i) * amplitude;
          if (x === 0) ctx.moveTo(x, y + wave); else ctx.lineTo(x, y + wave);
        }
        ctx.stroke();
      }
      // The pale belt and the storm on it.
      ctx.fillStyle = 'rgba(255, 213, 154, 0.2)';
      ctx.fillRect(0, h * 0.415, w, h * 0.05);
      for (const [x, y, rx, ry] of [[0.16, 0.57, 0.05, 0.03], [0.62, 0.36, 0.035, 0.02], [0.84, 0.6, 0.026, 0.015]]) {
        ctx.fillStyle = 'rgba(190, 225, 255, 0.5)';
        ctx.beginPath(); ctx.ellipse(x * w, y * h, rx * w, ry * h, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(20, 40, 100, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(x * w, y * h, rx * w * 0.6, ry * h * 0.6, 0, 0, TAU); ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#f6eedb';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(216, 72, 15, 0.16)';
      ctx.fillRect(0, h * 0.415, w, h * 0.05);
      ctx.fillStyle = 'rgba(31, 95, 122, 0.12)';
      for (const y of [0.2, 0.62, 0.78]) ctx.fillRect(0, h * y, w, h * 0.07);
      ctx.strokeStyle = '#2a2620';
      ctx.lineWidth = 2;
      for (let i = 1; i < 12; i += 1) {
        ctx.globalAlpha = i % 3 === 0 ? 0.7 : 0.32;
        ctx.setLineDash(i % 3 === 0 ? [] : [10, 9]);
        ctx.beginPath(); ctx.moveTo(0, (i / 12) * h); ctx.lineTo(w, (i / 12) * h); ctx.stroke();
      }
      ctx.setLineDash([10, 9]);
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 24; i += 1) {
        ctx.beginPath(); ctx.moveTo((i / 24) * w, 0); ctx.lineTo((i / 24) * w, h); ctx.stroke();
      }
    }
  }, { width: 2048, height: 1024, rough: 1, metal: 0, emissive: dark, glow: 0.1, basic: !dark }));
}

function planet(kit) {
  const dark = kit.mode === 'dark';
  const { radius } = PLANET;
  const world = new Group();
  world.position.set(...PLANET.at);
  const tilt = new Group();
  tilt.rotation.set(-0.37, 0, -0.2);
  world.add(tilt);
  const ball = new Mesh(new SphereGeometry(radius, 96, 64), planetFace(kit));
  tilt.add(ball);
  // The limb: a glow of air by night, an inked outline by day.
  const shell = (scale, colour, opacity, additive) => {
    const material = unfogged(kit, 'orbit-limb:' + scale, () => new MeshBasicMaterial({
      color: kit.color(colour), side: BackSide, transparent: opacity < 1, opacity, depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    }));
    world.add(new Mesh(new SphereGeometry(radius * scale, 96, 64), material));
  };
  if (dark) {
    // Night falls across the far side: a shade that does not turn with the planet.
    const shade = new Group();
    shade.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), new Vector3(-0.47, -0.03, -0.88).normalize());
    shade.add(new Mesh(new SphereGeometry(radius * 1.002, 96, 64), unfogged(kit, 'orbit-night-side', () => kit.painted((ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      for (let x = 0; x < w; x += 1) {
        const off = Math.abs(x / w - 0.5);
        const t = Math.min(1, Math.max(0, (off - 0.035) / 0.17));
        ctx.fillStyle = 'rgba(3, 6, 18, ' + (0.94 * t * t * (3 - 2 * t)).toFixed(3) + ')';
        ctx.fillRect(x, 0, 1, h);
      }
    }, { width: 512, height: 4, basic: true, transparent: true }))));
    world.add(shade);
    shell(1.008, '#62d6e8', 0.3, true);
  } else shell(1.006, '#2a2620', 1, false);
  // The rings, in the flare colour: fine ringlets by night, ruled by day.
  const lines = [1.3, 1.34, 1.42, 1.45, 1.5, 1.61, 1.64, 1.72, 1.76];
  const fine = dark ? 0.006 : 0.004;
  const bands = [
    ...lines.map((at, i) => [at, at + fine, dark ? 0.5 - (i % 3) * 0.12 : 0.55]),
    [1.34, 1.42, dark ? 0.07 : 0.07], [1.5, 1.61, dark ? 0.1 : 0.1], [1.64, 1.72, dark ? 0.05 : 0.05],
  ];
  for (const [inner, outer, opacity] of bands) {
    const material = unfogged(kit, 'orbit-rings:' + inner + ':' + opacity, () => new MeshBasicMaterial({
      color: kit.color(dark ? '#ffd59a' : '#d8480f'), side: DoubleSide, transparent: true, opacity, depthWrite: false,
      blending: dark ? AdditiveBlending : NormalBlending,
    }));
    const band = new Mesh(new RingGeometry(radius * inner, radius * outer, 160), material);
    band.rotation.x = Math.PI / 2;
    tilt.add(band);
  }
  return { world, ball };
}

// A rock: a lumpy handful of flat faces with a faint inked edge.
function rock(kit, size, index) {
  const geometry = new IcosahedronGeometry(size, 1);
  const at = geometry.attributes.position;
  for (let i = 0; i < at.count; i += 1) {
    const key = Math.round(at.getX(i) * 31 / size) * 7 + Math.round(at.getY(i) * 31 / size) * 131 + Math.round(at.getZ(i) * 31 / size) * 1009 + index * 17;
    const push = 0.78 + seeded(key) * 0.42;
    at.setXYZ(i, at.getX(i) * push, at.getY(i) * push * 0.72, at.getZ(i) * push * 0.9);
  }
  geometry.computeVertexNormals();
  const material = unfogged(kit, 'orbit-rock', () => new MeshStandardMaterial({
    color: kit.color(kit.mode === 'dark' ? '#2e3858' : '#efe6d0'), roughness: 1, metalness: 0, flatShading: true,
  }));
  const mesh = new Mesh(geometry, material);
  mesh.add(new LineSegments(new EdgesGeometry(geometry, 12), unfogged(kit, 'orbit-rock-ink', () => new LineBasicMaterial({ color: kit.color('line'), transparent: true, opacity: kit.mode === 'dark' ? 0.3 : 0.5 }))));
  mesh.rotation.set(index * 1.3, index * 0.7, index * 2.1);
  return mesh;
}

function decor(kit) {
  const group = new Group();
  const dark = kit.mode === 'dark';
  const { world, ball } = planet(kit);
  group.add(world);
  // The moon, cratered, off to the other side.
  const moonFace = unfogged(kit, 'orbit-moon', () => kit.painted((ctx, w, h) => {
    ctx.fillStyle = dark ? '#5f6c94' : '#f6eedb';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i += 1) {
      const r = 6 + seeded(i + 3) * 26;
      ctx.fillStyle = dark ? 'rgba(60, 72, 110, 0.5)' : 'rgba(42, 38, 32, 0.12)';
      ctx.strokeStyle = dark ? 'rgba(210, 222, 250, 0.35)' : 'rgba(42, 38, 32, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(seeded(i) * w, seeded(i + 60) * h, r, r * 0.8, 0, 0, TAU); ctx.fill(); ctx.stroke();
    }
  }, { width: 512, height: 256, rough: 1, metal: 0, emissive: dark, glow: 0.05, basic: !dark }));
  const moon = new Mesh(new SphereGeometry(1.7, 32, 20), moonFace);
  const moonArm = new Group();
  moonArm.position.set(-15, -10, -24);
  moon.position.set(0, 0, 0);
  moonArm.add(moon);
  if (!dark) {
    moonArm.add(new Mesh(new SphereGeometry(1.7 * 1.025, 32, 20), unfogged(kit, 'orbit-moon-limb', () => new MeshBasicMaterial({ color: kit.color('#2a2620'), side: BackSide }))));
  }
  group.add(moonArm);
  const rocks = ROCKS.map(([x, y, z, size], index) => {
    const mesh = rock(kit, size, index);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  });
  // A relay satellite crossing under the grid on a long loop.
  const relay = new Group();
  relay.add(inked(kit, kit.box(0.5, 0.4, 0.7, hull(kit))));
  relay.add(wing(kit, 1.5, 0.5, [-1.1, 0, 0]));
  relay.add(wing(kit, 1.5, 0.5, [1.1, 0, 0]));
  relay.add(kit.sphere(0.08, lit(kit, 'roof', 1.6), [0, 0.26, 0], 8));
  relay.position.set(6.5, -5, -21);
  relay.rotation.set(0.3, 0.7, 0.2);
  relay.scale.setScalar(0.8);
  group.add(relay);
  // Marker buoys at the grid's corners.
  const trim = kit.mat('trim', { rough: 0.8 });
  for (const [x, z] of [[-10.6, -6], [10.6, -6], [-10.6, 9], [10.6, 9]]) {
    group.add(inked(kit, kit.cylinder(0.16, 0.16, 0.3, trim, [x, 0.7, z], 6)));
    group.add(kit.sphere(0.12, lit(kit, 'worker', 1.4), [x, 1.0, z], 10));
  }
  scenes.set(kit, { ball, moon, rocks, relay });
  return weld(group, rocks);
}

// What moves out there: the planet turns, the moon swings round, rocks tumble,
// the relay crosses and, by night, a shooting star falls now and then.
function weather(kit) {
  const scene = scenes.get(kit);
  if (kit.reducedMotion || !scene) return null;
  const object = new Group();
  const streak = kit.mode === 'dark'
    ? new Mesh(new PlaneGeometry(2.6, 0.05), unfogged(kit, 'orbit-streak', () => new MeshBasicMaterial({ color: kit.color('#dfe8ff'), transparent: true, opacity: 0.9, side: DoubleSide, blending: AdditiveBlending, depthWrite: false })))
    : null;
  if (streak) object.add(streak);
  return {
    object,
    frame(time, dt) {
      scene.ball.rotation.y = time * 0.02;
      scene.moon.rotation.y = time * 0.03;
      scene.rocks.forEach((mesh, index) => {
        mesh.rotation.x += dt * (0.05 + seeded(index) * 0.12);
        mesh.rotation.y += dt * (0.04 + seeded(index + 5) * 0.1);
      });
      const lap = (time * 0.012) % 1;
      scene.relay.position.set(-18 + lap * 36, -5 + Math.sin(lap * TAU) * 0.6, -23 + lap * 4);
      if (streak) {
        const fall = (time % 11) / 0.9;
        streak.visible = fall < 1;
        streak.position.set(-14 + fall * 9, -8, -24 + fall * 5);
        streak.rotation.set(-Math.PI / 2, 0, -0.5);
        streak.material.opacity = 0.9 * Math.sin(Math.min(1, fall) * Math.PI);
      }
    },
  };
}

// The navigator's chart: a plot of the run's sky ruled in the line colour,
// with dotted orbits, a constellation and the signal it is reading traced
// along the bottom in the glow colour.
function starChart(kit) {
  return shared(kit, 'orbit-chart', () => kit.painted((ctx, w, h) => {
    const line = '#' + kit.palette.line.getHexString();
    ctx.fillStyle = '#' + (kit.mode === 'dark' ? '0c1630' : 'fffaf0');
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    for (let x = 32; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, h - 4); ctx.stroke(); }
    for (let y = 32; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(w - 4, y); ctx.stroke(); }
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([4, 6]);
    for (const r of [34, 58]) { ctx.beginPath(); ctx.ellipse(w * 0.3, h * 0.38, r * 1.3, r * 0.7, -0.3, 0, TAU); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = line;
    ctx.beginPath(); ctx.arc(w * 0.3, h * 0.38, 9, 0, TAU); ctx.fill();
    const stars = [[0.62, 0.18], [0.7, 0.3], [0.8, 0.24], [0.88, 0.4], [0.74, 0.46]];
    ctx.lineWidth = 2;
    ctx.beginPath();
    stars.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    ctx.stroke();
    for (const [x, y] of stars) { ctx.beginPath(); ctx.arc(x * w, y * h, 5, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#' + kit.palette.glow.getHexString();
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 12; x < w - 12; x += 4) {
      const y = h * 0.78 - Math.sin(x * 0.09) * 10 * Math.sin(x * 0.013) - (seeded(x) - 0.5) * 8;
      if (x === 12) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, { width: 256, height: 192, rough: 0.8, metal: 0, emissive: kit.mode === 'dark', glow: 0.55 }));
}

// The advisor is the station's navigator: a crew member in the round suit,
// standing on a lit pad at a chart table, reading the star chart as it
// unrolls, with a listening dish on a mast that sweeps for the signal. The
// navigator leans in and turns along the chart, the table lamp brightens
// while it reads and the chart's roll turns as more comes in.
function advisor(kit) {
  const root = new Group();
  const body = hull(kit);
  const trim = kit.mat('trim', { rough: 0.8 });
  const still = new Group();
  root.add(still);
  still.add(inked(kit, kit.cylinder(0.8, 0.8, 0.05, kit.mat('aisle', { rough: 0.9 }), [0, 0.03, 0], 6)));
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU + TAU / 12;
    still.add(kit.sphere(0.045, lit(kit, 'accent', 1.2), [Math.sin(a) * 0.8, 0.08, Math.cos(a) * 0.8], 8));
  }
  // The chart table: a pedestal and a slanted top with the chart on it.
  still.add(inked(kit, kit.cylinder(0.08, 0.12, 0.62, trim, [0, 0.36, 0.38], 8)));
  still.add(inked(kit, kit.box(0.4, 0.05, 0.3, trim, [0, 0.07, 0.38])));
  // The mast and its listening dish, off the table's corner.
  still.add(inked(kit, kit.cylinder(0.025, 0.025, 1.3, trim, [0.62, 0.7, -0.22], 6)));
  root.add(weld(still));
  const desk = new Group();
  desk.position.set(0, 0.72, 0.42);
  desk.rotation.x = 0.55;
  desk.add(inked(kit, kit.box(0.84, 0.05, 0.5, body)));
  const chart = new Mesh(new PlaneGeometry(0.72, 0.42), starChart(kit));
  chart.rotation.x = -Math.PI / 2;
  chart.position.y = 0.028;
  desk.add(chart);
  // The roll the chart comes off, along the table's far edge.
  const roll = inked(kit, kit.cylinder(0.05, 0.05, 0.8, kit.mat('crate', { rough: 0.8 }), [0, 0.05, -0.25], 10));
  roll.rotation.z = Math.PI / 2;
  desk.add(roll);
  root.add(desk);
  // The table lamp, on a crooked arm.
  const lamp = kit.sphere(0.06, lit(kit, 'window', 1.6), [-0.38, 1.12, 0.3], 8);
  root.add(kit.cylinder(0.012, 0.012, 0.36, trim, [-0.38, 0.92, 0.4], 5), lamp);
  const dish = new Group();
  dish.position.set(0.62, 1.38, -0.22);
  const bowl = new Mesh(new ConeGeometry(0.24, 0.14, 16, 1, true), kit.mat('crate', { rough: 0.8, doubleSide: true }));
  bowl.rotation.x = -0.9;
  dish.add(bowl);
  dish.add(kit.cylinder(0.012, 0.012, 0.2, trim, [0, 0.05, 0.08], 5));
  root.add(dish);
  // The navigator.
  const suit = kit.mat(kit.mode === 'dark' ? '#eef2fb' : '#fffaf0', { rough: 0.7 });
  const visor = kit.mat('roof', { rough: 0.25, metal: 0.4, emissive: 'roof', glow: kit.mode === 'dark' ? 0.5 : 0.1 });
  const crew = new Group();
  crew.position.set(0, 0.06, -0.16);
  root.add(crew);
  for (const side of [-1, 1]) crew.add(inked(kit, kit.cylinder(0.08, 0.07, 0.44, suit, [side * 0.11, 0.22, 0], 8)));
  const torso = new Group();
  torso.position.y = 0.44;
  crew.add(torso);
  torso.add(inked(kit, kit.cylinder(0.2, 0.18, 0.42, suit, [0, 0.21, 0], 10)));
  torso.add(kit.cylinder(0.205, 0.205, 0.06, kit.mat('worker', { rough: 0.6 }), [0, 0.06, 0], 10));
  torso.add(inked(kit, kit.box(0.32, 0.36, 0.14, trim, [0, 0.24, -0.2])));
  // A chest panel of switches and its badge.
  torso.add(kit.box(0.16, 0.1, 0.03, kit.windows, [0, 0.28, 0.19]));
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new Group();
    arm.position.set(side * 0.22, 0.36, 0);
    arm.add(kit.cylinder(0.055, 0.055, 0.34, suit, [0, -0.15, 0.04], 6));
    arm.add(kit.sphere(0.065, kit.mat('trim', { rough: 0.8 }), [0, -0.32, 0.08], 8));
    arm.rotation.x = -0.9;
    torso.add(arm);
    arms.push(arm);
  }
  const head = new Group();
  head.position.y = 0.58;
  torso.add(head);
  head.add(inked(kit, kit.sphere(0.2, suit, [0, 0.08, 0], 14), 'line', 40));
  const glass = kit.sphere(0.135, visor, [0, 0.08, 0.14], 12);
  glass.scale.set(1.1, 0.8, 0.85);
  head.add(glass);
  head.add(kit.cylinder(0.01, 0.01, 0.16, trim, [0.13, 0.3, -0.04], 4));
  head.add(kit.sphere(0.025, lit(kit, 'accent', 1.4), [0.13, 0.38, -0.04], 6));
  const scale = 1.3;
  root.scale.setScalar(scale);
  root.userData = {
    labelY: 1.72 * scale,
    page: new Vector3(0, 0.78 * scale, 0.46 * scale),
    frame(time, dt, state) {
      const reading = state.activity;
      torso.rotation.x = 0.22 * reading + Math.sin(time * 0.7) * 0.02;
      head.rotation.x = 0.35 * reading;
      head.rotation.y = Math.sin(time * 0.45) * 0.3 * reading;
      for (const [i, arm] of arms.entries()) arm.rotation.x = -0.9 - 0.2 * reading + Math.sin(time * 0.9 + i * 2) * 0.05 * reading;
      dish.rotation.y = Math.sin(time * 0.4) * 0.9;
      roll.rotation.x = time * 0.6 * reading;
      lamp.scale.setScalar(0.8 + 0.4 * reading + Math.sin(time * 3) * 0.05);
      crew.position.y = 0.06 + Math.sin(time * 1.1) * 0.012;
    },
  };
  return kit.shadows(root);
}

export default { palette: PALETTE, backdrop, layout, view, pad: false, ghost, floor, hall, station, crate, carrier, dock, decor, weather, advisor };
