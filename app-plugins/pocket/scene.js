// The pocket cast for Yeet, PR opened, Plan reveal and All settled: the
// little hero of the game inside the handheld, stepped out into the world as
// a sprite given depth. It saves the page to a cartridge, hauls a link cable,
// opens a treasure chest and dances a stage clear beside the handheld as tall
// as it is, while a cartridge turns in the air and loose pixels drift up off
// the ground. Every scene hits the beats ui/js/scene-poses.js times its overlay to.
import {
  BackSide, BoxGeometry, CylinderGeometry, Euler, Group, IcosahedronGeometry, InstancedMesh, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NearestFilter, Object3D, PlaneGeometry, Quaternion, Vector3,
} from 'three';
import { back, clamp, createStage, keys, mix, out, pulse, range, smooth, wobble } from '../../ui/yeet/stage.js';
import { contactShadow, createFlecks, fling, keyframes, paint, sample, wrap } from '../../ui/yeet/cast.js';
import { CLEAR_LANDS, createFireworks } from '../../ui/yeet/party.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

const SHELL = 0x7c54e8;
const GLOW = 0xc9a8ff;
const GOLD = 0xf0cf7a;
const RUBBER = 0x2a2536;
const SCREEN = 0x6a48c8;
const PIXELS = [GLOW, GOLD, 0x6ee79a, 0x6fb6ff];
const GREEN = PIXELS[2];
const BLUE = PIXELS[3];
const SKIN = 0xfbf3ff;
const HAIR = 0x2a1f4a;
const INK = 0x1a1030;
const TAU = Math.PI * 2;
const P = .125;
const hex = colour => '#' + colour.toString(16).padStart(6, '0');

// Poses are held for a twelfth of a second at a time, as a sprite animated on
// twos, counted from the scene's beat so the hit lands on its own frame.
const onTwos = (t, beat) => beat + Math.floor((t - beat) * 12) / 12;

// The stage's lights tinted to the handheld's backlight.
function dress({ scene, key, glow }) {
  scene.traverse(light => {
    if (light.isHemisphereLight) {
      light.color.set(0xf1e9ff);
      light.groundColor.set(0x2a1838);
    } else if (light.isAmbientLight) light.color.set(0xe6dcff);
    else if (light.isDirectionalLight && light !== key) light.color.set(light.position.z < 0 ? GLOW : 0xb9c8ff);
  });
  key.color.set(0xfff4e6);
  glow.color.set(GLOW);
}

// ---- pixel art ----

const SWATCH = {
  H: hex(HAIR), S: hex(SKIN), K: hex(INK), G: hex(GOLD), B: hex(BLUE), D: hex(RUBBER), W: '#ffffff',
  V: hex(GLOW), N: hex(GREEN), R: '#ff6fa8', O: '#c48a2a', L: '#e8e4f4', A: '#9a6038', M: '#5a3a1c',
};

function crisp(texture) {
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function drawSprite(ctx, rows, x, y) {
  rows.forEach((row, j) => [...row].forEach((code, i) => {
    if (code === '.') return;
    ctx.fillStyle = SWATCH[code];
    ctx.fillRect(x + i, y + j, 1, 1);
  }));
}

const sprite = rows => crisp(paint(rows[0].length, rows.length, ctx => drawSprite(ctx, rows, 0, 0)));

const HERO_SPRITE = [
  '..HHHHH..', '.HHHHHHH.', '.HSSSSSH.', '.SKSSSKS.', '.SKSSSKS.', '.SSSKSSS.',
  '.GGGGGGG.', 'SBBBBBBBS', '..BBBBB..', '..BB.BB..', '..DD.DD..',
];
const HERO_HOP = [
  '..HHHHH..', '.HHHHHHH.', 'SHSSSSSHS', 'BSKSSSKSB', 'BSKSSSKSB', '.SSKKKSS.',
  '.GGGGGGG.', '.BBBBBBB.', '..BBBBB..', '.BB...BB.', '.DD...DD.',
];
const HEART = ['.RR.RR.', 'RWRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'];
const COIN = ['.GGGG.', 'GWGGGO', 'GWGGGO', 'GGGGGO', 'GGGGGO', '.GOOO.'];
const STAR = ['....G....', '...GGG...', 'GGGGWGGGG', '.GGGWGGG.', '..GGGGG..', '..GG.GG..', '.GG...GG.'];
const SAVE_ICON = [
  'VVVVVVVVVVV.', 'VVLLLLLLLVVV', 'VVLLLLDLLVVV', 'VVLLLLDLLVVV', 'VVLLLLLLLVVV', 'VVVVVVVVVVVV',
  'VWWWWWWWWWWV', 'VWKKKKKKKKWV', 'VWWWWWWWWWWV', 'VWKKKKKWWWWV', 'VWWWWWWWWWWV', 'VVVVVVVVVVVV',
];
const CHEST_ICON = [
  '.AAAAAAAAA.', 'AMAAAAAAAMA', 'AMAAAAAAAMA', 'GGGGGWGGGGG', 'AMAAGGGAAMA', 'AMAAAGAAAMA', 'AMAAAAAAAMA', 'AAAAAAAAAAA',
];
const HANDHELD_ICON = ['VVVVV', 'VKKKV', 'VKNKV', 'VKKKV', 'VVVVV', 'VDVGV', 'VVVVV'];

// The handheld's 80 by 64 dot screen, painted once per state.
function screenArt(draw, background = hex(SCREEN)) {
  return crisp(paint(80, 64, ctx => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 80, 64);
    draw(ctx);
    ctx.fillStyle = 'rgba(20,8,48,.12)';
    for (let y = 1; y < 64; y += 2) ctx.fillRect(0, y, 80, 1);
  }));
}

// The game the hero lives in: a hill, a cloud and a floor, with the hero on it
// or gone from it.
function gameScreen(ctx, hero, lift = 0) {
  ctx.fillStyle = '#8f6ee6';
  ctx.fillRect(52, 40, 20, 12);
  ctx.fillRect(56, 36, 12, 4);
  ctx.fillStyle = hex(GLOW);
  ctx.fillRect(10, 10, 14, 4);
  ctx.fillRect(13, 7, 7, 3);
  ctx.fillStyle = hex(GREEN);
  ctx.fillRect(0, 52, 80, 3);
  ctx.fillStyle = '#3e2a8c';
  ctx.fillRect(0, 55, 80, 9);
  for (let x = 2; x < 80; x += 8) {
    ctx.fillStyle = '#5c40b4';
    ctx.fillRect(x, 58, 4, 2);
  }
  ctx.fillStyle = hex(GOLD);
  ctx.fillRect(60, 22, 3, 3);
  if (hero) drawSprite(ctx, hero, 34, 41 - lift);
}

function saveScreen(ctx, progress, blink) {
  if (!blink) drawSprite(ctx, SAVE_ICON, 34, 12);
  ctx.fillStyle = '#3e2a8c';
  ctx.fillRect(20, 34, 40, 6);
  ctx.fillStyle = hex(GOLD);
  ctx.fillRect(21, 35, Math.round(38 * progress), 4);
  if (progress >= 1) {
    ctx.fillStyle = hex(GREEN);
    [[30, 50], [31, 51], [32, 52], [33, 51], [34, 50], [35, 49], [36, 48], [37, 47]].forEach(([x, y]) => ctx.fillRect(x + 4, y - 2, 2, 2));
  }
}

function linkScreen(ctx, beat) {
  drawSprite(ctx, HANDHELD_ICON, 12, 30);
  drawSprite(ctx, HANDHELD_ICON, 63, 30);
  ctx.fillStyle = hex(GOLD);
  for (let x = 18; x < 62; x += 2) ctx.fillRect(x, 40 + (x % 4 ? 0 : 1), 2, 1);
  ctx.fillStyle = hex(GLOW);
  ctx.fillRect(18 + (beat * 11) % 44, 39, 3, 3);
  const size = beat % 2 ? 2 : 1;
  ctx.save();
  ctx.translate(40 - 3.5 * size, 14 - 3 * size);
  ctx.scale(size, size);
  drawSprite(ctx, HEART, 0, 0);
  ctx.restore();
}

// ---- the set ----

// A handheld as tall as the hero: its clear purple shell lit from inside,
// the board showing through. `states` are the screen's painted pictures.
function handheld(states) {
  const stand = new Group();
  const unit = new Group();
  stand.add(unit);
  unit.position.y = 3.1;
  const shell = new MeshStandardMaterial({
    color: SHELL, roughness: .18, metalness: .05, transparent: true, opacity: .62,
    emissive: SHELL, emissiveIntensity: .3, depthWrite: false,
  });
  const dark = new MeshStandardMaterial({ color: 0x08060e, roughness: .4 });
  const gold = new MeshStandardMaterial({ color: GOLD, roughness: .35, metalness: .45 });
  const cap = new MeshStandardMaterial({ color: GLOW, roughness: .25, emissive: GLOW, emissiveIntensity: .35 });
  // The board first, so it shows through the shell in front of it.
  const board = new Mesh(new BoxGeometry(3.3, 5.4, .08), new MeshStandardMaterial({ color: 0x2a1466, roughness: .6 }));
  board.position.z = -.08;
  unit.add(board);
  for (const [x, y, w, h] of [[-.9, -1.2, .9, .5], [.8, -2, .6, .6], [-.2, -2.3, .5, .3]]) {
    const chip = new Mesh(new BoxGeometry(w, h, .12), dark);
    chip.position.set(x, y, 0);
    const feet = new Mesh(new BoxGeometry(w + .16, h * .7, .03), gold);
    feet.position.set(x, y, -.03);
    unit.add(chip, feet);
  }
  unit.add(new Mesh(new BoxGeometry(3.8, 6.2, .7), shell));
  const bezel = new Mesh(new BoxGeometry(3.2, 2.8, .08), dark);
  bezel.position.set(0, 1.3, .36);
  const screen = new Mesh(new BoxGeometry(2.6, 2.1, .04), new MeshBasicMaterial({ color: 0x24124f, toneMapped: false }));
  screen.position.set(0, 1.3, .41);
  const power = new Mesh(new BoxGeometry(.12, .12, .04), new MeshBasicMaterial({ color: 0x5cff8a, toneMapped: false }));
  power.position.set(-1.35, 2.52, .41);
  unit.add(bezel, screen, power);
  const planes = {};
  for (const [name, texture] of Object.entries(states)) {
    const plane = new Mesh(new PlaneGeometry(2.6, 2.1), new MeshBasicMaterial({ map: texture, toneMapped: false }));
    plane.position.set(0, 1.3, .435);
    plane.visible = false;
    unit.add(plane);
    planes[name] = plane;
  }
  for (const [x, y] of [[.55, -1.75], [1.25, -1.2]]) {
    const button = new Mesh(new CylinderGeometry(.34, .34, .2, 24), cap);
    button.rotation.x = Math.PI / 2;
    button.position.set(x, y, .42);
    unit.add(button);
  }
  for (const [x, turn] of [[-.65, -.32], [-.05, -.32]]) {
    const pill = new Mesh(new BoxGeometry(.46, .13, .08), new MeshStandardMaterial({ color: RUBBER, roughness: .8 }));
    pill.rotation.z = turn;
    pill.position.set(x, -2.55, .38);
    unit.add(pill);
  }
  // The cartridge slot along the top, and the link port in the right side.
  const lip = new Mesh(new BoxGeometry(2.3, .16, .56), dark);
  lip.position.set(0, 3.12, -.02);
  const socket = new Mesh(new BoxGeometry(.14, .5, .4), dark);
  socket.position.set(1.92, -.6, 0);
  const pins = new Mesh(new BoxGeometry(.04, .3, .2), gold);
  pins.position.set(1.97, -.6, 0);
  unit.add(lip, socket, pins);
  const slot = new Object3D();
  slot.position.set(0, 3.1, -.02);
  const port = new Object3D();
  port.position.set(1.99, -.6, 0);
  unit.add(slot, port);
  unit.traverse(part => { if (part.isMesh && !part.material.transparent) part.castShadow = true; });
  return {
    stand, unit, slot, port, power,
    show(name, light = 1) {
      for (const key in planes) planes[key].visible = key === name;
      if (planes[name]) planes[name].material.color.setScalar(light);
    },
  };
}

function cartridge() {
  const cart = new Group();
  const body = new Mesh(new BoxGeometry(1.5, 1.7, .26), new MeshStandardMaterial({ color: 0xcfcbe0, roughness: .5 }));
  body.castShadow = true;
  cart.add(body);
  const rim = new Mesh(new BoxGeometry(1.62, 1.82, .2), new MeshBasicMaterial({ color: INK, side: BackSide }));
  cart.add(rim);
  const art = crisp(paint(23, 16, ctx => {
    ctx.fillStyle = hex(SHELL);
    ctx.fillRect(0, 0, 23, 16);
    drawSprite(ctx, STAR, 7, 2);
    ctx.fillStyle = hex(GLOW);
    ctx.fillRect(3, 11, 17, 1);
    ctx.fillRect(3, 13, 11, 1);
  }));
  const label = new Mesh(new PlaneGeometry(1.15, .8), new MeshBasicMaterial({ map: art, toneMapped: false }));
  label.position.set(0, .22, .135);
  cart.add(label);
  for (const y of [-.45, -.6]) {
    const grip = new Mesh(new BoxGeometry(1.1, .05, .02), new MeshStandardMaterial({ color: RUBBER }));
    grip.position.set(0, y, .14);
    cart.add(grip);
  }
  return { cart, label, art };
}

// Loose pixels rising off the ground, placed by stride so every replay runs
// the same.
function pixels(scene) {
  const cloud = new Group();
  const geometry = new BoxGeometry(.16, .16, .16);
  const materials = PIXELS.map(color => new MeshBasicMaterial({ color, toneMapped: false }));
  const bits = Array.from({ length: 34 }, (_, i) => {
    const mesh = new Mesh(geometry, materials[i % materials.length]);
    cloud.add(mesh);
    return { mesh, x: ((i * 7.31) % 17) - 8.5, z: -3 - ((i * 3.7) % 9), phase: (i * .618034) % 1, speed: .07 + ((i * 13) % 5) * .012 };
  });
  scene.add(cloud);
  return t => {
    for (const bit of bits) {
      const rise = (bit.phase + t * bit.speed) % 1;
      bit.mesh.position.set(bit.x, .2 + rise * 8, bit.z);
      bit.mesh.scale.setScalar(Math.sin(rise * Math.PI));
    }
  };
}

function pixelParts() {
  const cube = new BoxGeometry(1, 1, 1);
  const lit = PIXELS.map(color => new MeshBasicMaterial({ color, toneMapped: false }));
  const white = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  return {
    puff: { geometry: cube, materials: [lit[0], white, lit[3]], size: .1 },
    spark: { geometry: cube, materials: [lit[1], white, lit[2], lit[0]], size: .1 },
    gold: { geometry: cube, materials: [lit[1], white], size: .09 },
  };
}

// A burst set that replays at each of `events` ([time, origin, power]),
// the newest one that has started winning.
function burst(flecks, t, events, up = 1, gravity = 2.4, life = .9, flatten = 1) {
  let current = null;
  for (const event of events) if (t >= event[0]) current = event;
  if (!current) return fling(flecks, -1, events[0][1], 1, up, gravity, life, flatten);
  fling(flecks, t - current[0], current[1], current[2], up, gravity, life, flatten);
}

// Little pickups (hearts, coins) that pop out of the screen and float up,
// turned to the camera.
function pickups(scene, maps, count) {
  const geometry = new PlaneGeometry(1, 1);
  return Array.from({ length: count }, (_, i) => {
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: maps[i % maps.length], transparent: true, depthWrite: false, toneMapped: false }));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, delay: i * .19, drift: ((i * 5) % 7 - 3) * .16, size: .34 + (i % 3) * .06 };
  });
}

function floatPickups(list, t, start, origin, camera) {
  for (const p of list) {
    const age = t - start - p.delay;
    p.mesh.visible = age > 0 && age < 1.4;
    if (!p.mesh.visible) continue;
    const step = Math.floor(age * 12) / 12;
    p.mesh.position.set(origin.x + p.drift * step * 2 + Math.sin(step * 7 + p.delay * 9) * .08, origin.y + step * 1.3, origin.z + .3);
    p.mesh.quaternion.copy(camera.quaternion);
    p.mesh.scale.setScalar(p.size * Math.min(1, Math.ceil(age * 24) / 3) * (1 - range(age, 1.1, 1.4)));
  }
}

// A square shockwave of pixels, for a hit.
function squareRing(scene) {
  const map = sprite([
    'VVVVVVVVVVVV', 'V..........V', 'V..........V', 'V..........V', 'V..........V', 'V..........V',
    'V..........V', 'V..........V', 'V..........V', 'V..........V', 'V..........V', 'VVVVVVVVVVVV',
  ]);
  const ring = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
  scene.add(ring);
  return (t, at, origin, camera, reach = 4.5) => {
    const age = t - at;
    ring.visible = age > 0 && age < .45;
    ring.position.copy(origin);
    ring.quaternion.copy(camera.quaternion);
    ring.scale.setScalar(.4 + Math.ceil(age * 24) / 24 * reach);
    ring.material.opacity = 1 - clamp(age / .45);
  };
}

// ---- the hero ----

const HIP = .4;
const CORE = 1;
const SHOULDER = .5;
const NECK = .62;
const ARM = .48;
const EYE_Y = .44;
const MOUTH_Y = .2;
const FACE_Z = .47;
const LINE = .028;
const HERO_SCALE = 1.15;

// Everything but where the hero stands: `lf`/`rf` swing an arm forward
// (pi is straight up) and `lo`/`ro` lift it out to the side; `lk`/`rk` swing
// a leg. The face counts in pixels: `eye` is how tall the eyes are (under 0.6
// is shut), `look` and `gaze` shift them a pixel, `mouth` opens it.
const POSE = {
  yaw: 0, lean: 0, roll: 0, flip: 0, sq: 1, bend: 0, twist: 0, nod: 0, turn: 0, tilt: 0,
  lf: 0, lo: .08, rf: 0, ro: .08, lk: 0, rk: 0, wide: .04, walk: 0, swing: 1, churn: 0,
  eye: 2, glint: 0, look: 0, gaze: 0, mouth: 0, smile: .6, blush: 1, wind: .2,
};
const MOVE = { x: 0, y: 0, z: 0, size: 1 };

function createHero() {
  const solid = (color, glow = 0) => new MeshStandardMaterial({ color, roughness: .62, emissive: color, emissiveIntensity: glow });
  const skin = solid(SKIN, .14);
  const tunic = solid(BLUE, .1);
  const hair = solid(HAIR, .12);
  const scarf = solid(GOLD, .14);
  const boot = solid(RUBBER, .05);
  const ink = new MeshBasicMaterial({ color: INK });
  const rim = new MeshBasicMaterial({ color: INK, side: BackSide });
  const white = new MeshBasicMaterial({ color: 0xffffff });
  const pink = new MeshBasicMaterial({ color: 0xff9ecf });
  // A box with a dark shell just bigger than it, culled from the front, so
  // every block is outlined like a sprite on either background.
  const block = (parent, [w, h, d], [x, y, z], material, outline = true) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    if (outline) {
      const edge = new Mesh(new BoxGeometry(w + LINE * 2, h + LINE * 2, d + LINE * 2), rim);
      edge.position.set(x, y, z);
      parent.add(edge);
    }
    return mesh;
  };

  const root = new Group();
  root.rotation.order = 'YXZ';
  root.scale.setScalar(HERO_SCALE);
  const core = new Group();
  core.position.y = CORE;
  root.add(core);
  const rig = new Group();
  rig.position.y = -CORE;
  core.add(rig);

  const legs = [-1, 1].map(side => {
    const mount = new Group();
    mount.position.set(side * .2, HIP, 0);
    block(mount, [.3, .28, .32], [0, -.14, 0], tunic);
    block(mount, [.32, .13, .42], [0, -.335, .04], boot);
    rig.add(mount);
    return mount;
  });
  const torso = new Group();
  torso.position.y = HIP;
  rig.add(torso);
  block(torso, [.8, .6, .56], [0, .3, 0], tunic);
  block(torso, [.84, .1, .6], [0, .08, 0], solid(RUBBER, .05), false);
  block(torso, [.16, .12, .04], [0, .08, .3], scarf, false);

  // The scarf: a wrap at the neck and two tails that stream out behind.
  block(torso, [.86, .15, .62], [0, NECK - .02, 0], scarf);
  const tails = [-1, 1].map(side => {
    let parent = new Group();
    parent.position.set(side * .14, NECK - .02, -.3);
    torso.add(parent);
    const first = parent;
    const links = [];
    for (let i = 0; i < 3; i++) {
      const link = i ? new Group() : parent;
      if (i) {
        link.position.z = -.22;
        parent.add(link);
      }
      block(link, [.15, .09, .24], [0, 0, -.11], scarf, true);
      links.push(link);
      parent = link;
    }
    return { side, first, links };
  });

  const head = new Group();
  head.position.y = NECK;
  torso.add(head);
  block(head, [1.06, .96, .92], [0, .48, 0], skin);
  block(head, [1.12, .24, .98], [0, .9, -.01], hair);
  block(head, [1.12, .64, .22], [0, .62, -.39], hair);
  block(head, [.13, .44, .74], [-.53, .62, -.08], hair, false);
  block(head, [.13, .44, .74], [.53, .62, -.08], hair, false);
  block(head, [1.12, .12, .1], [0, .74, .45], hair, false);
  block(head, [.16, .12, .08], [-.3, .64, .46], hair, false);
  block(head, [.16, .1, .08], [.16, .65, .46], hair, false);
  block(head, [.14, .16, .14], [.14, 1.08, .02], hair);
  const eyeShape = new BoxGeometry(P, P, .04);
  const eyes = [-1, 1].map(side => {
    const eye = new Mesh(eyeShape, ink);
    head.add(eye);
    const glint = new Mesh(new BoxGeometry(.05, .05, .02), white);
    head.add(glint);
    return { eye, glint, side };
  });
  const mouth = new Mesh(new BoxGeometry(P, P, .04), ink);
  const tongue = new Mesh(new BoxGeometry(P * 2, P * .7, .02), pink);
  head.add(mouth, tongue);
  const corners = [-1, 1].map(side => {
    const corner = new Mesh(new BoxGeometry(P, P, .04), ink);
    corner.position.x = side * 1.5 * P;
    head.add(corner);
    return corner;
  });
  const cheeks = [-1, 1].map(side => {
    const cheek = new Mesh(new BoxGeometry(.16, .08, .02), pink);
    cheek.position.set(side * .35, .27, FACE_Z - .005);
    head.add(cheek);
    return cheek;
  });

  const arms = [-1, 1].map(side => {
    const mount = new Group();
    mount.position.set(side * .52, SHOULDER, 0);
    block(mount, [.22, .36, .24], [0, -.17, 0], tunic);
    block(mount, [.25, .22, .27], [0, -.44, 0], skin);
    const grip = new Object3D();
    grip.position.y = -ARM;
    mount.add(grip);
    torso.add(mount);
    return { side, mount, grip };
  });

  const forward = new Vector3();
  return {
    root, rig, head, arms, left: arms[0], right: arms[1],
    pose(p, t) {
      const walking = Math.floor(t * 10) % 4;
      const split = (walking === 0 ? 1 : walking === 2 ? -1 : 0) * p.walk;
      const scramble = (Math.floor(t * 16) % 2 ? 1 : -1) * p.churn;
      root.position.set(p.x, p.y + (walking % 2) * .07 * Math.min(1, p.walk) + Math.abs(scramble) * .03, p.z);
      root.rotation.set(p.lean, p.yaw, p.roll);
      core.rotation.set(p.flip, 0, 0);
      const girth = 1 / Math.sqrt(p.sq);
      rig.scale.set(p.size * girth, p.size * p.sq, p.size * girth);
      torso.rotation.set(p.bend, p.twist, 0);
      head.rotation.set(p.nod, p.turn, p.tilt);
      const swing = split * .5 * p.swing;
      arms[0].mount.rotation.set(-(p.lf - swing), 0, -p.lo);
      arms[1].mount.rotation.set(-(p.rf + swing), 0, p.ro);
      legs[0].rotation.set(-(p.lk + split * .6 + scramble * .7), 0, -p.wide);
      legs[1].rotation.set(-(p.rk - split * .6 - scramble * .7), 0, p.wide);

      const tall = Math.max(.35, Math.round(p.eye * 2) / 2);
      const shut = tall < .6;
      const across = tall >= 2.5 ? 1.5 : 1;
      for (const { eye, glint, side } of eyes) {
        const x = side * .21 + Math.round(p.look) * .07;
        const y = EYE_Y + Math.round(p.gaze) * .06 + (shut ? .05 : 0);
        eye.scale.set(across, tall, 1);
        eye.position.set(x, y, FACE_Z + .01);
        glint.visible = p.glint > .5 && tall >= 2;
        glint.position.set(x - side * .02, y + tall * P * .3, FACE_Z + .04);
      }
      const open = Math.round(clamp(p.mouth / 2) * 2);
      const grin = p.smile > .35, frown = p.smile < -.35;
      const gape = open ? 1 + open * .6 : 1;
      mouth.scale.set(open && grin ? 3 : 2, gape, 1);
      mouth.position.set(0, MOUTH_Y - (gape - 1) * P * .5, FACE_Z + .01);
      tongue.visible = open > 0 && grin;
      tongue.position.set(0, MOUTH_Y - (gape - .85) * P, FACE_Z + .025);
      for (const corner of corners) {
        corner.visible = !open && (grin || frown);
        corner.position.set(corner.position.x, MOUTH_Y + (grin ? P : -P) * .9, FACE_Z + .01);
      }
      cheeks.forEach(cheek => { cheek.visible = p.blush > .5; });

      const flutter = Math.floor(t * 12) / 12;
      for (const tail of tails) {
        tail.links.forEach((link, i) => {
          const flap = Math.sin(flutter * 17 + i * 1.3 + tail.side * 2) * (.12 + .3 * p.wind);
          link.rotation.x = (i ? mix(-.3, .06, p.wind) : mix(-1.25, -.2, p.wind)) + flap * (i ? 1 : .4);
          link.rotation.y = i ? 0 : tail.side * .22;
        });
      }
      root.updateMatrixWorld(true);
    },
    grip(arm, target) {
      return arm.grip.getWorldPosition(target);
    },
    // Halfway between the hands, a little ahead of them.
    hands(target, ahead = .1) {
      arms[0].grip.getWorldPosition(target);
      arms[1].grip.getWorldPosition(forward);
      target.add(forward).multiplyScalar(.5);
      return target.addScaledVector(forward.set(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y)), ahead);
    },
    // Above the head, where a sprite holds up what it has found.
    overhead(target, lift = 2.32, ahead = .15) {
      return rig.localToWorld(target.set(0, lift, ahead));
    },
  };
}

// One frame of the hero: where it stands at `t` itself, its pose held on twos.
function poser(hero, moves, poses, beat) {
  const p = { ...POSE, ...MOVE };
  const held = {}, moving = {};
  return (t, blinks = []) => {
    Object.assign(p, sample(poses, onTwos(t, beat), held), sample(moves, t, moving));
    // It grows in eighths, a pixel at a time.
    p.size = Math.min(1, Math.ceil(p.size * 8 - 1e-6) / 8);
    for (const blink of blinks) if (t >= blink && t < blink + .1) p.eye = .35;
    hero.pose(p, t);
    return p;
  };
}

function shadowUnder(shadow, p) {
  shadow.position.set(p.x, .012, p.z);
  shadow.scale.set(.86, .58, 1).multiplyScalar(p.size * (1 - clamp(p.y / 2) * .4));
  shadow.material.opacity = .3 * (1 - clamp(p.y / 2.5)) * clamp(p.size * 1.5 - .3);
}

function shake(camera, home, amount, t) {
  camera.position.x = .25 + Math.sin(t * 90) * amount;
  camera.position.y = home + Math.sin(t * 75) * amount;
}

// ---- Yeet ----

// Beats: the hero leaps out of the handheld's screen with a flip (0.42-0.88),
// throws its arms out, hops up and snatches the cartridge out of the air (1.42-1.84),
// steps under the crumpled page and catches it in the cartridge, where it
// breaks into pixels and saves (2.3-2.62), dashes back, leaps, and spikes the
// cartridge into the handheld's slot at 3.32, landing as the screen saves,
// then holds a victory pose and hops for joy.
const SAVE = 3.32;
const SPIKE = 3.12;
const LANDED = 3.36;
const CATCH_AT = 2.52;
const SET_SIZE = .42;
const CART_SIZE = .38;

function createSaveScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const textures = [];
  const keep = texture => { textures.push(texture); return texture; };
  const states = {
    game: keep(screenArt(ctx => gameScreen(ctx, HERO_SPRITE))),
    hop: keep(screenArt(ctx => gameScreen(ctx, HERO_HOP, 3))),
    empty: keep(screenArt(ctx => gameScreen(ctx, null))),
    flash: keep(screenArt(() => {}, '#f4ecff')),
  };
  for (let i = 0; i <= 4; i++) states['save' + i] = keep(screenArt(ctx => saveScreen(ctx, i / 4, false)));
  states.blink = keep(screenArt(ctx => saveScreen(ctx, 1, true)));
  const set = handheld(states);
  set.stand.scale.setScalar(SET_SIZE);
  set.stand.position.set(-1.75, 0, .25);
  set.stand.rotation.y = .3;
  scene.add(set.stand);
  const { cart, label, art } = cartridge();
  textures.push(art);
  cart.scale.setScalar(CART_SIZE);
  scene.add(cart);
  const drift = pixels(scene);
  const hero = createHero();
  scene.add(hero.root);
  const shadow = contactShadow(scene, .3, 0x140a2a);

  const pageMap = keep(paint(256, 256, ctx => {
    ctx.fillStyle = '#fbf8ff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = hex(INK);
    ctx.font = 'bold 26px system-ui';
    ctx.fillText('SHIP', 20, 40);
    ctx.font = 'bold 15px system-ui';
    wrap(title.trim() || 'This run', 210, 2, ctx.font).forEach((line, i) => ctx.fillText(line, 20, 70 + i * 19));
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#b9a8e0' : '#8a74c8';
      ctx.fillRect(20, 120 + i * 24, 140 + Math.sin(i * 3) * 40, 7);
    }
  }));
  const ball = new Mesh(new IcosahedronGeometry(.3, 1), new MeshStandardMaterial({ map: pageMap, roughness: .95, flatShading: true }));
  ball.castShadow = true;
  scene.add(ball);
  const paperBits = createFlecks(scene, 18, [{ geometry: new BoxGeometry(1, 1, 1), materials: [new MeshBasicMaterial({ color: 0xfbf8ff }), new MeshBasicMaterial({ color: 0x8a74c8 }), new MeshBasicMaterial({ color: GOLD, toneMapped: false })], size: .09 }]);
  const trails = [0, 1, 2].map(i => {
    const ghost = new Mesh(new BoxGeometry(1.5, 1.7, .26), new MeshBasicMaterial({ color: GLOW, transparent: true, opacity: .35 - i * .1, depthWrite: false }));
    scene.add(ghost);
    return ghost;
  });
  const ring = squareRing(scene);
  const parts = pixelParts();
  const puffs = createFlecks(scene, 26, [parts.puff]);
  const slam = createFlecks(scene, 40, [parts.spark, parts.gold]);
  const sparkle = createFlecks(scene, 16, [parts.gold]);
  const treats = pickups(scene, [keep(sprite(HEART)), keep(sprite(COIN)), keep(sprite(STAR))], 7);

  // Where the host gathers the page into a ball: 67% across, 45% down.
  camera.updateMatrixWorld();
  const ray = new Vector3(.34, .1, .5).unproject(camera).sub(camera.position).normalize();
  const gather = camera.position.clone().addScaledVector(ray, (1.6 - camera.position.z) / ray.z);
  const catchX = Math.min(1.4, gather.x - .4);

  const moves = keyframes(MOVE, [
    [0, { x: -1.69, y: 1.5, z: .42, size: .3 }],
    [.42, {}],
    [.66, { x: -.8, y: 2.25, z: .8, size: .75 }, 'o'],
    [.88, { x: .4, y: 0, z: 1.1, size: 1 }, 'i'],
    [1.42, {}],
    [1.62, { y: .95 }, 'o'],
    [1.84, { y: 0 }, 'i'],
    [2.04, {}],
    [2.34, { x: catchX }, 'l'],
    [2.66, {}],
    [2.84, { x: .3 }, 'l'],
    [2.9, {}],
    [3.06, { x: -.05, y: 1.05 }, 'o'],
    [LANDED, { x: -.25, y: 0 }, 'i'],
    [4.12, {}],
    [4.26, { y: .3 }, 'o'],
    [4.4, { y: 0 }, 'i'],
  ]);
  const poses = keyframes({ ...POSE, carry: 0 }, [
    [0, { lf: .2, rf: .2, wind: .5 }],
    [.42, {}],
    [.48, { sq: 1.25, lf: 2.75, rf: 2.75, lo: .6, ro: .6, eye: 3, glint: 1, mouth: 1.5, smile: .8 }, 'o'],
    [.62, { sq: 1, flip: Math.PI, lk: .7, rk: .7 }],
    [.86, { flip: TAU, lf: 1.4, rf: 1.4, lo: 1, ro: 1, lk: 0, rk: 0, sq: 1.12 }],
    [.9, { sq: .66, eye: .35 }, 'o'],
    [.98, { sq: 1.08, eye: 2, glint: 0, mouth: 0, smile: 1 }, 'o'],
    [1.06, { sq: 1, lf: .25, rf: .25, lo: 1.15, ro: 1.15, wind: .2 }],
    [1.22, {}],
    [1.26, { nod: -.38, gaze: 1, eye: 3, glint: 1, mouth: 1, smile: .3, lf: .3, rf: .3, lo: .2, ro: .2 }, 'o'],
    [1.34, {}],
    [1.38, { sq: .78, bend: .12, lf: -.5, rf: -.5, lo: .15, ro: .15, mouth: 0, smile: .6, eye: 1.5, glint: 0 }, 'o'],
    [1.44, { sq: 1.2, bend: 0, lf: 2.75, rf: 2.75, lo: .6, ro: .6, eye: 2, wind: .7 }, 'o'],
    [1.62, { sq: 1, lk: .5, rk: .5, carry: 1, eye: 3, glint: 1, mouth: 1.5, smile: 1 }],
    [1.82, { sq: 1.05, lk: 0, rk: 0 }],
    [1.86, { sq: .72, eye: .35 }, 'o'],
    [1.94, { sq: 1.04, nod: -.2, eye: 2 }, 'o'],
    [2.02, { sq: 1, carry: 0, lf: 1.55, rf: 1.55, lo: -.3, ro: -.3, swing: 0, turn: .3, look: 1, gaze: 1, mouth: 0, smile: .7, glint: 0, wind: .3 }],
    [2.04, { walk: 1 }],
    [2.34, { walk: 0 }],
    [2.38, { lf: 1.75, rf: 1.75, nod: -.32, turn: .15, gaze: 1, eye: 3, glint: 1 }, 'o'],
    [2.5, { nod: .12, turn: 0, gaze: -1, look: 0 }],
    [2.58, {}],
    [2.62, { sq: .9, smile: 1, mouth: 1.5, eye: .5, glint: 0, nod: 0, gaze: 1 }, 'o'],
    [2.64, {}],
    [2.67, { sq: 1, yaw: -1.25, eye: 1.5, gaze: 0, mouth: 0, smile: .5, lf: 1.4, rf: 1.4, wind: .8, walk: 1.3 }, 'o'],
    [2.84, { walk: 0 }],
    [2.87, { sq: .76, bend: .2, lf: .7, rf: .7 }, 'o'],
    [2.92, { sq: 1.2, bend: -.1, lf: 2.75, rf: 2.75, lo: .6, ro: .6, carry: 1, eye: 2.5, glint: 1 }, 'o'],
    [3.05, { sq: 1, lk: .6, rk: -.2, mouth: 1, smile: .2 }],
    [SPIKE, { lf: .7, rf: .7, lo: .1, ro: .1, bend: .45, mouth: 2, eye: 1.5, glint: 0 }, 'c'],
    [3.3, { bend: .2, lk: .3, rk: .3 }],
    [LANDED, { sq: 1.05 }],
    [3.4, { sq: .7, bend: .2, eye: .35 }, 'o'],
    [3.48, { sq: 1.06, bend: 0, eye: 2, yaw: 0, lf: .2, rf: .2, lo: .3, ro: .3, lk: 0, rk: 0, mouth: 1, smile: 1, wind: .3 }, 'o'],
    [3.58, { sq: 1, rf: 2.75, ro: .62, lf: -.15, lo: .75, wide: .2, tilt: .12, eye: .5, gaze: 1, mouth: 1.5 }, 'b'],
    [4.1, {}],
    [4.14, { sq: .84 }, 'o'],
    [4.2, { sq: 1.1, rf: 2.4, ro: .72, wind: .6 }, 'o'],
    [4.36, { sq: 1, rf: 2.8, ro: .6 }],
    [4.42, { sq: .86 }, 'o'],
    [4.5, { sq: 1, eye: 3, glint: 1, mouth: 0, smile: 1, gaze: 0, wind: .2 }],
  ]);
  const pose = poser(hero, moves, poses, SAVE);

  // Where the cartridge is at each handoff, measured once from the poses.
  const hovering = new Vector3();
  const caught = new Vector3();
  const released = new Vector3();
  const seatTurn = new Quaternion();
  const turn = new Quaternion();
  const euler = new Euler();
  const held = new Vector3();
  const inFront = new Vector3();
  const above = new Vector3();
  function carried(p, target) {
    hero.hands(inFront, .08);
    hero.overhead(above);
    return target.lerpVectors(inFront, above, p.carry);
  }
  carried(pose(1.62), hovering);
  carried(pose(CATCH_AT), caught).y += .32;
  carried(pose(SPIKE), released);
  function seated(target) {
    set.stand.updateMatrixWorld(true);
    set.slot.getWorldPosition(target);
    target.y += 1.7 * CART_SIZE * .5 - .26;
    return target;
  }
  set.unit.getWorldQuaternion(seatTurn);
  const flight = new Vector3();
  const slot = new Vector3();
  const screenAt = new Vector3(-1.69, 1.85, .5);
  const home = camera.position.y;

  function render(t) {
    const p = pose(t, [1.16, 2.24]);
    // The handheld squashes as the cartridge goes home.
    const jolt = pulse(t, SAVE, SAVE + .12) * .1 + wobble(t, SAVE + .12, 20, 7) * .05;
    set.stand.scale.set(SET_SIZE * (1 + jolt * .5), SET_SIZE * (1 - jolt), SET_SIZE * (1 + jolt * .5));
    const blinkOn = Math.floor((t - 3.8) * 4) % 2 === 1;
    if (t < .42) set.show(Math.floor(t * 4) % 2 ? 'hop' : 'game');
    else if (t < .52) set.show('flash', 1.2);
    else if (t < SAVE) set.show('empty', .8 + .15 * Math.sin(t * 2.1));
    else if (t < SAVE + .08) set.show('flash', 1.3);
    else if (t < 3.8) set.show('save' + Math.min(4, Math.floor((t - SAVE - .08) * 10)), 1.1);
    else set.show(blinkOn ? 'blink' : 'save4', 1.1);
    set.power.material.color.setHex(t >= SAVE ? 0x5cff8a : 0x2f8a4a);

    // The cartridge turns in the air until the hero snatches it, rides along
    // in its hands, flies into the slot and stays there.
    label.material.color.setScalar(1 + pulse(t, 2.6, 2.86) * 1.2 + pulse(t, SAVE, SAVE + .3));
    trails.forEach(trail => { trail.visible = false; });
    if (t < 1.62) {
      const bob = Math.sin(t * 2.2) * .06 * (1 - range(t, 1.3, 1.62));
      cart.position.copy(hovering).y += .08 + bob;
      cart.rotation.set(Math.sin(t * 1.3) * .12 * (1 - range(t, 1.3, 1.62)), (t - 1.62) * 2.4, 0);
    } else if (t < SPIKE) {
      carried(p, cart.position);
      cart.rotation.set(0, p.yaw * .25, 0);
    } else {
      seated(slot);
      const u = range(t, SPIKE, SAVE) ** 2;
      flight.lerpVectors(released, slot, u);
      flight.y += Math.sin(u * Math.PI) * .25;
      cart.position.copy(flight);
      euler.set((1 - u) * -TAU * .75, mix(-1.25 * .25, .3, u), 0);
      turn.setFromEuler(euler);
      cart.quaternion.copy(t >= SAVE ? seatTurn : turn);
      trails.forEach((trail, i) => {
        const back = range(t - (i + 1) * .025, SPIKE, SAVE) ** 2;
        trail.visible = t < SAVE + .02 && back > 0;
        trail.position.lerpVectors(released, slot, back);
        trail.quaternion.copy(cart.quaternion);
        trail.scale.setScalar(CART_SIZE * (1 - i * .12));
      });
    }

    // The page ball comes off the host's crumple, drops into the cartridge
    // and breaks into pixels on the way in.
    ball.visible = t > 2.28 && t < CATCH_AT;
    const drop = range(t, 2.36, CATCH_AT);
    held.lerpVectors(gather, caught, drop * drop);
    held.y += Math.sin(drop * Math.PI) * .4;
    ball.position.copy(held);
    ball.scale.setScalar(back(range(t, 2.28, 2.4), 2.4) * (1 - drop * .45));
    ball.rotation.set(t * 4, t * 3, t * 2);
    paperBits.forEach((bit, i) => {
      const u = range(t, CATCH_AT - .06 + (i % 6) * .012, CATCH_AT + .1 + (i % 6) * .012);
      bit.mesh.visible = u > 0 && u < 1;
      bit.mesh.position.set(caught.x + bit.x * .3 * (1 - u), caught.y + bit.y * .3 * (1 - u) - u * .3, caught.z + bit.z * .3 * (1 - u));
      bit.mesh.scale.setScalar(bit.size * (1 - u * .6));
    });

    seated(slot);
    burst(slam, t, [[SAVE, slot, 7]], 1.4, 2.6, 1.1);
    burst(puffs, t, [[.9, new Vector3(.4, .08, 1.15), 3.4], [1.86, new Vector3(.4, .08, 1.15), 3], [3.38, new Vector3(-.25, .08, 1.15), 3.6], [4.4, new Vector3(-.25, .08, 1.15), 2.2]], .3, 1.6, .7, .4);
    burst(sparkle, t, [[2.6, caught, 2.6]], .8, 1.2, .7);
    ring(t, SAVE, slot, camera);
    floatPickups(treats, t, 3.5, screenAt, camera);

    shadowUnder(shadow, p);
    drift(t);
    glow.position.set(-1.2, 2, 1.6);
    glow.intensity = 8 + Math.sin(t * 3) * 2 + pulse(t, .42, .7) * 12 + pulse(t, SAVE, SAVE + .45) * 22;
    shake(camera, home, pulse(t, SAVE, SAVE + .24) * .06 + pulse(t, .88, 1) * .02 + pulse(t, LANDED, LANDED + .12) * .025, t);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// ---- PR opened ----

// Beats: the hero hauls a link cable in from the right, walking backwards
// (0.15-1.25); the cable snags and yanks it forward (1.29), it leans back and
// tugs (1.46-1.8), slips onto its bottom (1.92), bounces up and shakes it
// off, heaves again until the snag gives (2.6) and tumbles backwards into the
// handheld (2.86), spins round and plugs the cable in at 3.05: a pulse of
// light runs down the cable and the screen lights up. It hops for joy and
// stands proud.
const LINKED = 3.05;
const BUMP = 2.86;
const FAR = new Vector3(7, .05, 1.3);
const LINKS = 64;

function createLinkScene(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const textures = [];
  const keep = texture => { textures.push(texture); return texture; };
  const states = {
    off: keep(screenArt(() => {}, '#24124f')),
    flash: keep(screenArt(() => {}, '#f4ecff')),
  };
  for (let i = 0; i < 4; i++) states['link' + i] = keep(screenArt(ctx => linkScreen(ctx, i)));
  const set = handheld(states);
  set.stand.scale.setScalar(SET_SIZE);
  set.stand.position.set(-2.35, 0, .35);
  set.stand.rotation.y = -.12;
  scene.add(set.stand);
  const { cart, art } = cartridge();
  textures.push(art);
  cart.scale.setScalar(.5);
  scene.add(cart);
  const drift = pixels(scene);
  const hero = createHero();
  scene.add(hero.root);
  const shadow = contactShadow(scene, .3, 0x140a2a);

  // The cable: voxel links strung along a curve each frame, and a brighter
  // copy of the ones the pulse is passing.
  const linkShape = new BoxGeometry(.1, .1, 1);
  const cable = new InstancedMesh(linkShape, new MeshStandardMaterial({ color: 0xd9d4ea, roughness: .55 }), LINKS);
  const cableEdge = new InstancedMesh(linkShape, new MeshBasicMaterial({ color: INK, side: BackSide }), LINKS);
  const charge = new InstancedMesh(linkShape, new MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false }), LINKS);
  for (const mesh of [cable, cableEdge, charge]) {
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  cable.castShadow = true;
  const plug = new Group();
  const plugBody = new Mesh(new BoxGeometry(.22, .18, .3), new MeshStandardMaterial({ color: RUBBER, roughness: .5 }));
  const plugTip = new Mesh(new BoxGeometry(.13, .09, .14), new MeshStandardMaterial({ color: GOLD, roughness: .35, metalness: .45 }));
  plugTip.position.z = .21;
  const plugEdge = new Mesh(new BoxGeometry(.27, .23, .35), new MeshBasicMaterial({ color: INK, side: BackSide }));
  plug.add(plugBody, plugTip, plugEdge);
  plug.scale.setScalar(1.5);
  scene.add(plug);
  const ring = squareRing(scene);
  const alarm = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: keep(sprite(['.GG.', '.GG.', '.GG.', '.GG.', '....', '.GG.'])), transparent: true, depthWrite: false, toneMapped: false }));
  scene.add(alarm);
  const parts = pixelParts();
  const puffs = createFlecks(scene, 24, [parts.puff]);
  const zap = createFlecks(scene, 36, [parts.spark, parts.gold]);
  const snag = createFlecks(scene, 20, [parts.puff, parts.gold]);
  const sweat = createFlecks(scene, 10, [{ geometry: new BoxGeometry(1, 1, 1), materials: [new MeshBasicMaterial({ color: BLUE, toneMapped: false })], size: .07 }]);
  const treats = pickups(scene, [keep(sprite(HEART)), keep(sprite(HEART)), keep(sprite(STAR))], 6);

  set.stand.updateMatrixWorld(true);
  const port = set.port.getWorldPosition(new Vector3());
  const outward = new Vector3(1, 0, 0).applyQuaternion(set.unit.getWorldQuaternion(new Quaternion()));
  const plugged = port.clone().addScaledVector(outward, .2);
  const plugTurn = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), outward.clone().negate());

  const build = spot => ({
    moves: keyframes(MOVE, [
      [0, { x: 3.7, z: 1 }],
      [.15, {}],
      [1.25, { x: 1.3 }, 'l'],
      [1.32, { x: 1.5 }, 'o'],
      [1.84, {}],
      [1.92, { x: 1.36, y: -.25 }, 'o'],
      [2.08, {}],
      [2.18, { y: .28 }, 'o'],
      [2.3, { y: 0 }, 'i'],
      [2.6, { x: 1.42 }],
      [BUMP, { x: spot.x + .3, z: spot.z }, 'o'],
      [2.98, { x: spot.x }, 'o'],
      [3.2, {}],
      [3.32, { x: spot.x + .45 }, 'o'],
      [3.38, {}],
      [3.52, { y: .36 }, 'o'],
      [3.68, { y: 0 }, 'i'],
    ]),
    poses: keyframes({ ...POSE, hold: 1 }, [
      [0, { yaw: 1, lean: -.22, lf: 1.3, rf: 1.3, lo: -.3, ro: -.3, swing: 0, eye: 1.5, smile: .3, wind: .3 }],
      [.15, { walk: 1 }],
      [1.25, { walk: 0 }],
      [1.29, { lean: .3, sq: 1.08, eye: 3, glint: 1, mouth: 1.5, smile: 0, nod: .1 }, 'o'],
      [1.42, {}],
      [1.46, { lean: -.42, sq: 1, lk: .4, rk: -.3, eye: .6, mouth: .5, smile: -.5, glint: 0, nod: 0, churn: .25, bend: -.05 }, 'o'],
      [1.8, {}],
      [1.84, { lean: -.6, lk: 1.1, rk: .9, eye: 3, glint: 1, mouth: 2, smile: 0, lf: 2.2, rf: 2, lo: .4, ro: .5, churn: 0 }, 'o'],
      [1.92, { lean: -.12, sq: .78, lk: 1.45, rk: 1.45, wide: .2, bend: 0, eye: .35, glint: 0, mouth: 1, smile: -.6, lf: 1, rf: 1, lo: .5, ro: .5 }, 'o'],
      [2, { sq: 1 }],
      [2.08, {}],
      [2.12, { sq: 1.15, lean: 0, lk: 0, rk: 0, wide: .04, eye: 2, mouth: 0, smile: -.2, lf: .4, rf: .4, lo: .3, ro: .3 }, 'o'],
      [2.28, { sq: 1 }],
      [2.3, { turn: .4, eye: 1 }],
      [2.34, { turn: -.4 }],
      [2.38, { turn: 0, eye: 1.2, smile: -.5 }],
      [2.42, { lean: -.5, lf: 1.3, rf: 1.3, lo: -.3, ro: -.3, lk: .5, rk: -.2, eye: .7, mouth: .5, churn: 1 }, 'o'],
      [2.6, {}],
      [2.64, { lean: -.3, churn: 0, lk: 0, rk: 0, walk: 1.6, lf: 2.6, rf: 1.4, lo: .75, ro: .1, hold: 0, eye: 3, glint: 1, mouth: 2, smile: 0, wind: .9 }, 'o'],
      [BUMP - .02, { walk: 0 }],
      [BUMP, { sq: .84, lean: .15, eye: .35 }, 'o'],
      [2.9, { sq: 1, eye: 3 }],
      [2.94, { yaw: -1.22, lean: .2, lf: 1.5, rf: 1.5, lo: -.25, ro: -.25, hold: 1, rk: .75, lk: -.35, bend: .12, turn: .6, eye: 1.2, mouth: 1, smile: .2, glint: 0 }, 'o'],
      [LINKED, {}],
      [3.08, { sq: .92, turn: 1, eye: 3, glint: 1, mouth: 1.5, smile: .6 }, 'o'],
      [3.22, {}],
      [3.3, { yaw: 0, turn: 0, lean: 0, bend: 0, lk: 0, rk: 0, lf: .3, rf: .3, lo: .5, ro: .5, sq: 1, wind: .3 }, 'o'],
      [3.38, { sq: .82 }, 'o'],
      [3.44, { sq: 1.15, lf: 2.75, rf: 2.75, lo: .62, ro: .62, eye: .5, gaze: 1, mouth: 1.5, smile: 1, glint: 0 }, 'o'],
      [3.66, { sq: 1.05 }],
      [3.7, { sq: .76 }, 'o'],
      [3.8, { sq: 1, lf: -.15, rf: -.15, lo: .8, ro: .8, bend: -.08, wide: .2 }, 'o'],
      [4.3, {}],
      [4.36, { tilt: .14, eye: 2, gaze: 0, mouth: 0, glint: 1 }],
    ]),
  });
  const tip = new Vector3();
  const facing = new Vector3();
  const plugAt = (p, target) => {
    if (p.hold > .5) return hero.hands(target, .14);
    return hero.grip(hero.right, target).addScaledVector(facing.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)), .06);
  };
  let plan = build(new Vector3(0, 0, 1));
  plugAt(poser(hero, plan.moves, plan.poses, LINKED)(LINKED), tip);
  const spot = new Vector3(plugged.x - tip.x, 0, 1 + plugged.z - tip.z);
  plan = build(spot);
  const pose = poser(hero, plan.moves, plan.poses, LINKED);

  const slack = [[0, 1], [1.22, 1], [1.27, 0, out], [1.84, 0], [1.92, .7], [2.38, .7], [2.44, 0, out], [2.6, 0], [2.72, .9], [5.1, .9]];
  const dummy = new Object3D();
  const from = new Vector3();
  const points = Array.from({ length: LINKS + 1 }, () => new Vector3());
  const plugDir = new Vector3();
  const heading = new Vector3();
  const snagAt = new Vector3(4.5, .25, 1.25);
  const screenAt = set.unit.localToWorld(new Vector3(0, 1.3, .5));
  const sweatAt = new Vector3();
  const home = camera.position.y;

  function render(t) {
    const p = pose(t, [.7, 4.6]);
    if (t < LINKED) {
      plugAt(p, plug.position);
      // Hauling, the plug points back at the hero and the cable runs on
      // ahead; dangling from one hand, it hangs.
      heading.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(p.yaw > 0 ? -1 : 1);
      if (p.hold < .5) heading.set(Math.sin(p.yaw) * .4, -.6, Math.cos(p.yaw) * .4).normalize();
      plug.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), heading);
    } else {
      plug.position.copy(plugged);
      plug.quaternion.copy(plugTurn);
    }
    plugDir.set(0, 0, -1).applyQuaternion(plug.quaternion);
    from.copy(plug.position).addScaledVector(plugDir, .16);

    const loose = keys(t, slack);
    const whipAge = t - 2.6;
    for (let i = 0; i <= LINKS; i++) {
      const u = i / LINKS;
      const point = points[i];
      point.lerpVectors(from, FAR, u);
      const lying = .05 + (from.y - .05) * (1 - smooth(Math.min(1, u / .14)));
      const wave = Math.sin(u * 9 + 1) * .14 * loose * smooth(range(u, .1, .3));
      point.y = mix(point.y, lying, loose);
      point.z += wave;
      if (whipAge > 0) point.y += Math.max(0, Math.sin(u * 16 - whipAge * 34)) * .3 * Math.exp(-whipAge * 5) * range(u, .05, .3);
    }
    const pulses = [LINKED, LINKED + .26, LINKED + .52];
    for (let i = 0; i < LINKS; i++) {
      const a = points[i], b = points[i + 1];
      dummy.position.lerpVectors(a, b, .5);
      dummy.lookAt(b);
      const length = a.distanceTo(b) * 1.08;
      dummy.scale.set(1, 1, length);
      dummy.updateMatrix();
      cable.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(1.5, 1.5, length + .02);
      dummy.updateMatrix();
      cableEdge.setMatrixAt(i, dummy.matrix);
      let lit = 0;
      for (const start of pulses) lit = Math.max(lit, 1 - Math.abs(i / LINKS - (t - start) * 1.8) * 14);
      dummy.scale.set(2.1, 2.1, length * 1.1).multiplyScalar(lit > 0 ? 1 : 0);
      dummy.updateMatrix();
      charge.setMatrixAt(i, dummy.matrix);
    }
    cable.instanceMatrix.needsUpdate = cableEdge.instanceMatrix.needsUpdate = charge.instanceMatrix.needsUpdate = true;

    if (t < LINKED) set.show('off', 1);
    else if (t < LINKED + .08) set.show('flash', 1.3);
    else set.show('link' + Math.floor((t - LINKED) * 5) % 4, 1.1);
    set.power.material.color.setHex(t >= LINKED ? 0x5cff8a : 0x1c2a22);
    const jolt = pulse(t, LINKED, LINKED + .12) * .05;
    set.stand.scale.set(SET_SIZE * (1 + jolt), SET_SIZE * (1 - jolt), SET_SIZE);
    set.stand.rotation.z = wobble(t, BUMP, 16, 6) * .1;
    cart.position.set(4.4, 4.5 + Math.sin(t * 1.1) * .2, -4.6);
    cart.rotation.set(Math.sin(t * .6) * .2, t * .7, .15);

    const surprised = t > 1.29 && t < 1.62;
    alarm.visible = surprised;
    hero.overhead(alarm.position, 2.45, 0);
    alarm.quaternion.copy(camera.quaternion);
    alarm.scale.set(.26, .44, 1).multiplyScalar(Math.min(1, Math.ceil((t - 1.29) * 24) / 2));
    hero.overhead(sweatAt, 1.9, 0);
    burst(sweat, t, [[1.5, sweatAt, 2.2], [2.45, sweatAt, 2.4]], 1.4, 2.6, .5);
    burst(zap, t, [[LINKED, port, 5.5]], 1, 2, 1);
    ring(t, LINKED, port, camera, 3);
    burst(snag, t, [[2.6, snagAt, 4]], 1.2, 2, .8);
    burst(puffs, t, [[1.92, new Vector3(1.36, .1, 1.1), 3], [3.68, new Vector3(spot.x + .45, .1, spot.z + .1), 3]], .3, 1.6, .7, .4);
    floatPickups(treats, t, 3.3, screenAt, camera);

    shadowUnder(shadow, p);
    drift(t);
    glow.position.set(-1.2, 1.8, 1.6);
    glow.intensity = 7 + Math.sin(t * 3) * 2 + pulse(t, LINKED, LINKED + .5) * 24;
    shake(camera, home, pulse(t, LINKED, LINKED + .22) * .045 + pulse(t, 1.92, 2.04) * .025 + pulse(t, 2.6, 2.72) * .015 + pulse(t, BUMP, BUMP + .1) * .02, t);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// ---- Plan reveal ----

// Beats: the hero strolls up to a treasure chest (0.15-0.9), jumps with
// excitement, digs its fingers under the lid and strains (1.28-1.82) until it
// bursts open (1.88); the map rises out of it rolled up and spinning, the
// hero hops up for it and lands holding it up as it unrolls, all there at
// 2.55, the overlay's `lands`. At 3.22 it throws the map to `FRONT`, where
// the overlay pushes in on it, and cheers.
const UNLOCKED = 2.55;
const OPENS = 1.88;
const THROWN = 3.22;
const FLIGHT = [THROWN, 4.1];
// Centred on the camera's line of sight, about half the view tall.
const FRONT = new Vector3(.25, 2.36, 6);
const MAP = { w: .88, h: .66, front: 2.56 };
// Low enough over the head that the map stays under the word.
const HELD_UP = 2.08;
const CHEST = new Vector3(1.4, 0, .5);

function mapPage(title) {
  return paint(640, 480, ctx => {
    ctx.fillStyle = '#fdf8ee';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = hex(SHELL);
    for (let x = 0; x < 640; x += 16) {
      ctx.fillRect(x, 0, 12, 12);
      ctx.fillRect(x, 468, 12, 12);
    }
    for (let y = 16; y < 468; y += 16) {
      ctx.fillRect(0, y, 12, 12);
      ctx.fillRect(628, y, 12, 12);
    }
    ctx.fillStyle = hex(GOLD);
    for (const [x, y] of [[0, 0], [628, 0], [0, 468], [628, 468]]) ctx.fillRect(x, y, 12, 12);
    ctx.fillStyle = '#7a52c8';
    ctx.font = 'bold 26px ui-monospace, Menlo, monospace';
    ctx.fillText('QUEST MAP', 44, 62);
    ctx.fillStyle = hex(INK);
    ctx.font = '900 42px system-ui';
    wrap(title.trim() || 'This run', 550, 2, ctx.font).forEach((line, i) => ctx.fillText(line, 44, 118 + i * 48));
    // The route: stages along a dotted path to an X.
    const stops = [[70, 300], [200, 250], [330, 330], [460, 270], [575, 360]];
    ctx.fillStyle = '#b9a8e0';
    for (let i = 0; i < stops.length - 1; i++) {
      const [x0, y0] = stops[i], [x1, y1] = stops[i + 1];
      for (let s = 0; s <= 1; s += .08) ctx.fillRect(x0 + (x1 - x0) * s - 4, y0 + (y1 - y0) * s - 4, 8, 8);
    }
    stops.slice(0, -1).forEach(([x, y], i) => {
      ctx.fillStyle = i < 3 ? hex(GREEN) : '#d9cdf2';
      ctx.fillRect(x - 16, y - 16, 32, 32);
      ctx.fillStyle = hex(INK);
      ctx.fillRect(x - 16, y - 16, 32, 4);
      ctx.fillRect(x - 16, y + 12, 32, 4);
      ctx.fillRect(x - 16, y - 16, 4, 32);
      ctx.fillRect(x + 12, y - 16, 4, 32);
      if (i < 3) {
        ctx.fillStyle = hex(INK);
        [[-6, 0], [-2, 4], [2, 0], [6, -4]].forEach(([dx, dy]) => ctx.fillRect(x + dx - 2, y + dy - 2, 4, 4));
      }
    });
    const [xx, xy] = stops[stops.length - 1];
    ctx.fillStyle = '#e0506e';
    for (let i = -3; i <= 3; i++) {
      ctx.fillRect(xx + i * 7 - 5, xy + i * 7 - 5, 10, 10);
      ctx.fillRect(xx + i * 7 - 5, xy - i * 7 - 5, 10, 10);
    }
    ctx.fillStyle = '#a99ac8';
    for (let i = 0; i < 3; i++) ctx.fillRect(44, 400 + i * 22, 300 + Math.sin(i * 2.3) * 90, 10);
  });
}

// A wooden chest with gold bands, its lid hinged at the back.
function chest() {
  const box = new Group();
  const wood = new MeshStandardMaterial({ color: 0x9a6038, roughness: .7 });
  const dark = new MeshStandardMaterial({ color: 0x5a3a1c, roughness: .8 });
  const gold = new MeshStandardMaterial({ color: GOLD, roughness: .35, metalness: .4, emissive: GOLD, emissiveIntensity: .15 });
  const rim = new MeshBasicMaterial({ color: INK, side: BackSide });
  const glowing = new MeshBasicMaterial({ color: 0xfff1c0, toneMapped: false });
  const add = (parent, [w, h, d], [x, y, z], material, outline) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    if (outline) {
      const edge = new Mesh(new BoxGeometry(w + .05, h + .05, d + .05), rim);
      edge.position.set(x, y, z);
      parent.add(edge);
    }
    return mesh;
  };
  add(box, [1.1, .6, .72], [0, .3, 0], wood, true);
  add(box, [.98, .04, .6], [0, .59, 0], glowing);
  for (const x of [-.4, .4]) add(box, [.1, .62, .74], [x, .3, 0], gold);
  add(box, [1.12, .08, .74], [0, .06, 0], dark);
  const lid = new Group();
  lid.position.set(0, .6, -.36);
  box.add(lid);
  add(lid, [1.12, .24, .74], [0, .12, .37], wood, true);
  for (const x of [-.4, .4]) add(lid, [.1, .26, .76], [x, .12, .37], gold);
  add(lid, [.18, .2, .06], [0, .02, .76], gold, true);
  const keyhole = new Mesh(new BoxGeometry(.04, .08, .02), new MeshBasicMaterial({ color: INK }));
  keyhole.position.set(0, -.01, .8);
  lid.add(keyhole);
  return { box, lid, inside: glowing };
}

function createMapScene(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const textures = [];
  const keep = texture => { textures.push(texture); return texture; };
  const states = {
    chest0: keep(screenArt(ctx => { drawSprite(ctx, CHEST_ICON, 34, 30); ctx.fillStyle = hex(GOLD); ctx.fillRect(38, 20, 2, 2); })),
    chest1: keep(screenArt(ctx => { drawSprite(ctx, CHEST_ICON, 34, 30); ctx.fillStyle = hex(GOLD); ctx.fillRect(44, 22, 2, 2); })),
    star0: keep(screenArt(ctx => drawSprite(ctx, STAR, 36, 26))),
    star1: keep(screenArt(ctx => { drawSprite(ctx, STAR, 36, 24); ctx.fillStyle = hex(GOLD); ctx.fillRect(28, 20, 2, 2); ctx.fillRect(50, 24, 2, 2); })),
  };
  const set = handheld(states);
  set.stand.scale.setScalar(.55);
  set.stand.position.set(-3, 0, -1.4);
  set.stand.rotation.y = .4;
  scene.add(set.stand);
  const { cart, art } = cartridge();
  textures.push(art);
  cart.scale.setScalar(.5);
  scene.add(cart);
  const drift = pixels(scene);
  const hero = createHero();
  scene.add(hero.root);
  const shadow = contactShadow(scene, .3, 0x140a2a);
  const treasure = chest();
  treasure.box.position.copy(CHEST);
  treasure.box.rotation.y = -.35;
  scene.add(treasure.box);
  const chestShadow = contactShadow(scene, .25, 0x140a2a);
  chestShadow.position.set(CHEST.x, .011, CHEST.z);
  chestShadow.scale.set(.75, .5, 1);

  const pageMap = keep(mapPage(title));
  const scroll = new Group();
  const sheet = new Mesh(new PlaneGeometry(MAP.w, MAP.h), new MeshStandardMaterial({ map: pageMap, roughness: .85, emissive: 0xffffff, emissiveMap: pageMap, emissiveIntensity: .25 }));
  scroll.add(sheet);
  const rollMaterial = new MeshStandardMaterial({ color: 0xc48a2a, roughness: .5, emissive: 0x5a3a00, emissiveIntensity: .25 });
  const rolls = [-1, 1].map(side => {
    const roll = new Mesh(new CylinderGeometry(.05, .05, MAP.h + .08, 10), rollMaterial);
    roll.userData.side = side;
    scroll.add(roll);
    return roll;
  });
  scene.add(scroll);
  const beam = new Mesh(new BoxGeometry(.6, 3.2, .4), new MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: .3, depthWrite: false, toneMapped: false }));
  scene.add(beam);
  const shine = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: keep(crisp(paint(25, 25, ctx => {
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      for (let r = 5; r < 13; r++) {
        if (r % 3 === 0) continue;
        ctx.fillStyle = k % 2 ? '#ffffff' : hex(GOLD);
        ctx.fillRect(Math.round(12 + Math.cos(a) * r), Math.round(12 + Math.sin(a) * r), 1, 1);
      }
    }
  }))), transparent: true, depthWrite: false, toneMapped: false }));
  scene.add(shine);
  const parts = pixelParts();
  const puffs = createFlecks(scene, 22, [parts.puff]);
  const pop = createFlecks(scene, 36, [parts.gold, parts.spark]);
  const get = createFlecks(scene, 30, [parts.spark, parts.gold]);
  const toss = createFlecks(scene, 20, [parts.spark]);

  const moves = keyframes(MOVE, [
    [0, { x: -2.9, z: 1 }],
    [.15, {}],
    [.9, { x: .1 }, 'l'],
    [.95, {}],
    [1.06, { y: .32 }, 'o'],
    [1.18, { y: 0 }, 'i'],
    [1.24, {}],
    [1.32, { x: .22 }],
    [OPENS, {}],
    [1.98, { x: -.08 }, 'o'],
    [2.22, {}],
    [2.34, { y: .5, x: .02 }, 'o'],
    [2.47, { y: 0 }, 'i'],
    [3.42, {}],
    [3.56, { y: .3 }, 'o'],
    [3.7, { y: 0 }, 'i'],
    [3.9, {}],
    [4.04, { y: .3 }, 'o'],
    [4.18, { y: 0 }, 'i'],
  ]);
  const poses = keyframes(POSE, [
    [0, { yaw: 1.2, smile: .8, wind: .4 }],
    [.15, { walk: 1 }],
    [.9, { walk: 0 }],
    [.94, { yaw: .3, eye: 3, glint: 1, mouth: 1.5, smile: 1, lf: 2.4, rf: 2.4, lo: .5, ro: .5, sq: .9 }, 'o'],
    [1.04, { sq: 1.1 }],
    [1.18, { sq: .8 }, 'o'],
    [1.24, { sq: 1 }],
    [1.3, { yaw: 1.05, bend: .45, lf: 1.15, rf: 1.15, lo: -.2, ro: -.2, eye: 1.5, glint: 0, mouth: 0, smile: .6, nod: .2 }, 'o'],
    [1.42, { bend: .28, lean: -.12, eye: .5, mouth: .5, smile: -.5, churn: .2 }],
    [1.82, {}],
    [OPENS, { bend: -.15, lean: -.3, yaw: .6, lf: 2.6, rf: 2.6, lo: .6, ro: .6, eye: 3, glint: 1, mouth: 2, smile: 0, nod: -.2, churn: 0 }, 'o'],
    [2.1, { lean: 0, bend: 0, nod: -.35, gaze: 1, mouth: 1.5, smile: .7, lf: .5, rf: .5, lo: .3, ro: .3 }],
    [2.16, {}],
    [2.22, { sq: .8, lf: -.45, rf: -.45 }, 'o'],
    [2.28, { sq: 1.15, lf: 2.75, rf: 2.75, lo: .6, ro: .6, yaw: .1 }, 'o'],
    [2.44, { sq: 1.04, lk: .3, rk: .3 }],
    [2.48, { sq: .8, lk: 0, rk: 0 }, 'o'],
    [UNLOCKED, { sq: 1.02, yaw: 0, lo: .62, ro: .62, nod: 0, gaze: 0, eye: 3, glint: 1, mouth: 2, smile: 1, wind: .5 }, 'o'],
    [3.14, {}],
    [3.18, { lf: 2.2, rf: 2.2, lo: .05, ro: .05, lean: -.15, eye: 1.5, mouth: 0, glint: 0 }, 'o'],
    [THROWN + .02, { lf: 1.35, rf: 1.35, lean: .2, eye: 3, glint: 1, mouth: 1.5 }, 'c'],
    [3.4, { lean: 0 }],
    [3.46, { lf: 2.75, rf: 2.75, lo: .62, ro: .62, eye: .5, gaze: 1, smile: 1, mouth: 1.5, glint: 0 }],
    [3.66, { rf: 1.2 }],
    [3.9, { rf: 2.75, lf: 1.2 }],
    [4.2, { lf: 2.75 }],
  ]);
  const pose = poser(hero, moves, poses, UNLOCKED);

  const inChest = new Vector3(CHEST.x, .45, CHEST.z);
  const risen = new Vector3(CHEST.x - .25, 2.05, CHEST.z + .3);
  const lifted = new Vector3();
  const releasedAt = new Vector3();
  const square = new Quaternion();
  const spin = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  pose(THROWN);
  hero.overhead(releasedAt, 1.75, .45);
  const beamAt = new Vector3();
  const gotAt = new Vector3();
  const home = camera.position.y;

  function render(t) {
    const p = pose(t, [.6, 4.5]);
    const crack = range(t, 1.42, 1.82);
    const rattle = Math.abs(Math.sin(Math.floor(t * 24) * 2.1)) * .12 * crack;
    const lid = t < OPENS ? crack * .15 + rattle : 2 * back(range(t, OPENS, OPENS + .12), 2) + wobble(t, OPENS + .12, 16, 6) * .2;
    treasure.lid.rotation.x = -lid;
    treasure.inside.color.setScalar(1 + crack + (t >= OPENS ? 1 : 0));
    beam.visible = t > OPENS && t < 3;
    beamAt.set(CHEST.x, .6 + 1.6, CHEST.z);
    beam.position.copy(beamAt);
    beam.rotation.y = -.35;
    beam.scale.set(back(range(t, OPENS, OPENS + .15)), 1, 1);
    beam.material.opacity = .3 * (1 - range(t, 2.5, 3));

    // The map: rolled and spinning up out of the chest, caught overhead and
    // unrolled for the beat, then thrown to the front.
    let width = .12;
    scroll.visible = t > OPENS + .04;
    if (t < 2.3) {
      const rise = out(range(t, OPENS + .04, 2.24));
      scroll.position.lerpVectors(inChest, risen, rise);
      scroll.position.y += Math.sin(t * 6) * .03;
      spin.setFromAxisAngle(axis, Math.floor(t * 12) / 12 * TAU * 1.5);
      scroll.quaternion.copy(spin);
      scroll.scale.setScalar(.6 + .4 * rise);
    } else if (t <= THROWN) {
      hero.overhead(lifted, HELD_UP, .3);
      const catchUp = smooth(range(t, 2.3, 2.42));
      scroll.position.lerpVectors(risen, lifted, catchUp);
      if (t > 3.14) {
        const dip = range(t, 3.14, 3.2);
        scroll.position.copy(hero.overhead(lifted, mix(HELD_UP, 1.75, dip), mix(.3, .45, dip)));
      }
      scroll.quaternion.identity();
      scroll.scale.setScalar(1);
      width = mix(.12, 1, back(range(t, 2.44, UNLOCKED), 1.4));
    } else {
      const lift = 1 - (1 - range(t, FLIGHT[0], FLIGHT[1])) ** 3;
      scroll.position.lerpVectors(releasedAt, FRONT, lift);
      scroll.position.y += Math.sin(lift * Math.PI) * .5;
      square.copy(camera.quaternion);
      scroll.quaternion.identity().slerp(square, lift);
      scroll.scale.setScalar(mix(1, MAP.front / MAP.w, lift));
      width = 1;
    }
    sheet.scale.x = Math.max(.02, width);
    pageMap.repeat.x = Math.max(.02, width);
    pageMap.offset.x = (1 - pageMap.repeat.x) / 2;
    rolls.forEach(roll => {
      roll.position.x = roll.userData.side * (MAP.w * Math.max(.02, width) / 2 + .03);
      roll.scale.setScalar(1 + (1 - width) * .5);
      roll.scale.y = 1;
    });

    shine.visible = t > UNLOCKED - .05 && t < 3.2;
    shine.position.copy(scroll.position);
    shine.position.z -= .1;
    shine.rotation.set(0, 0, Math.floor(t * 6) % 2 ? Math.PI / 8 : 0);
    shine.scale.setScalar(2.1 * back(range(t, UNLOCKED - .05, UNLOCKED + .1)) * (1 - range(t, 3.05, 3.2)));
    gotAt.copy(scroll.position);
    burst(pop, t, [[OPENS, beamAt.clone().setY(.8), 4.5]], 1.4, 2, 1);
    burst(get, t, [[UNLOCKED, gotAt.clone(), 4]], .6, 1.4, .9);
    burst(toss, t, [[THROWN, releasedAt, 3]], .6, 1.2, .7);
    burst(puffs, t, [[1.18, new Vector3(.1, .1, 1.1), 2.4], [2.48, new Vector3(.02, .1, 1.1), 3]], .3, 1.6, .7, .4);

    set.show((t > OPENS ? 'star' : 'chest') + Math.floor(t * 3) % 2, 1.05);
    cart.position.set(3.6, 4.2 + Math.sin(t * 1.1) * .2, -3.6);
    cart.rotation.set(Math.sin(t * .6) * .2, t * .7, .15);
    shadowUnder(shadow, p);
    drift(t);
    glow.position.set(CHEST.x, 1.6, 1.2);
    glow.intensity = 6 + Math.sin(t * 3) * 2 + crack * 10 + pulse(t, OPENS, 2.6) * 16 + pulse(t, UNLOCKED - .1, UNLOCKED + .4) * 14;
    shake(camera, home, pulse(t, OPENS, OPENS + .2) * .03 + pulse(t, UNLOCKED, UNLOCKED + .2) * .02, t);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// ---- All settled ----

// Beats: the hero blinks into being like a sprite respawning (0.15-0.6),
// looks about, crouches (1.05-1.38) and leaps into a spin as the fireworks
// burst (1.45), lands (2.0), dances a stage clear (side steps, a turn on the
// spot, two hops) and lands its final hop (4.26) in a held pose, one fist
// in the air.
const CLEARED = CLEAR_LANDS;
const FINAL = 4.26;

function createClearScene(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  dress(stage);
  const textures = [];
  const keep = texture => { textures.push(texture); return texture; };
  const states = {
    star0: keep(screenArt(ctx => drawSprite(ctx, STAR, 36, 26))),
    star1: keep(screenArt(ctx => { drawSprite(ctx, STAR, 36, 24); ctx.fillStyle = hex(GOLD); [[24, 16], [54, 20], [30, 46], [52, 44]].forEach(([x, y]) => ctx.fillRect(x, y, 2, 2)); })),
  };
  const set = handheld(states);
  set.stand.scale.setScalar(.55);
  set.stand.position.set(-3.2, 0, -2.3);
  set.stand.rotation.y = .42;
  scene.add(set.stand);
  const { cart, art } = cartridge();
  textures.push(art);
  cart.scale.setScalar(.55);
  scene.add(cart);
  const drift = pixels(scene);
  const hero = createHero();
  scene.add(hero.root);
  const shadow = contactShadow(scene, .3, 0x140a2a);
  const parts = pixelParts();
  const spawn = createFlecks(scene, 26, [parts.puff, parts.spark]);
  const puffs = createFlecks(scene, 24, [parts.puff]);
  const twinkle = createFlecks(scene, 12, [parts.gold]);
  const fireworks = createFireworks(scene, camera, { colors: [GLOW, GOLD, GREEN, BLUE, 0xffffff], geometry: new BoxGeometry(1, 1, 1), sparks: 30, size: .16 });

  const moves = keyframes(MOVE, [
    [0, { x: 0, z: .9, size: .25 }],
    [.15, {}],
    [.55, { size: 1 }, 'l'],
    [1.38, {}],
    [1.68, { y: .72 }, 'o'],
    [2, { y: 0 }, 'i'],
    [2.12, {}],
    [2.2, { x: .32, y: .08 }, 'o'],
    [2.28, { y: 0 }, 'i'],
    [2.45, {}],
    [2.53, { x: -.32, y: .08 }, 'o'],
    [2.61, { y: 0 }, 'i'],
    [2.78, {}],
    [2.86, { x: .2, y: .08 }, 'o'],
    [2.94, { y: 0 }, 'i'],
    [3.35, { x: 0 }],
    [3.4, {}],
    [3.52, { y: .28 }, 'o'],
    [3.64, { y: 0 }, 'i'],
    [3.68, {}],
    [3.8, { y: .28 }, 'o'],
    [3.92, { y: 0 }, 'i'],
    [3.98, {}],
    [4.12, { y: .5 }, 'o'],
    [FINAL, { y: 0 }, 'i'],
  ]);
  const poses = keyframes(POSE, [
    [0, { eye: 2, smile: .6 }],
    [.6, {}],
    [.66, { turn: .55, look: 1 }],
    [.8, {}],
    [.84, { turn: -.55, look: -1 }],
    [.98, {}],
    [1.02, { turn: 0, look: 0, smile: 1, eye: 2, glint: 1 }],
    [1.08, {}],
    [1.14, { sq: .78, bend: .12, lf: -.6, rf: -.6, lo: .2, ro: .2, eye: 1, glint: 0, smile: .4, mouth: 0 }, 'o'],
    [1.38, {}],
    [1.44, { sq: 1.2, bend: 0, lf: 2.75, rf: 2.75, lo: .62, ro: .62, eye: 3, glint: 1, mouth: 2, smile: 1, wind: .8 }, 'o'],
    [1.56, { sq: 1, lk: .6, rk: .6 }],
    [1.95, { yaw: TAU, lk: .2, rk: .2 }, 'l'],
    [1.98, { sq: 1.04 }],
    [2.02, { sq: .7, eye: .35, lk: 0, rk: 0 }, 'o'],
    [2.1, { sq: 1, eye: .5, gaze: 1, mouth: 1.5, lf: .3, rf: .3, wind: .3 }, 'o'],
    [2.14, {}],
    [2.2, { rf: 2.75, ro: .62, lf: .2, lo: .35, tilt: -.18, roll: .08, rk: .45 }, 'o'],
    [2.45, {}],
    [2.51, { lf: 2.75, lo: .62, rf: .2, ro: .35, tilt: .18, roll: -.08, lk: .45, rk: 0 }, 'o'],
    [2.78, {}],
    [2.84, { rf: 2.75, ro: .62, lf: .2, lo: .35, tilt: -.18, roll: .08, rk: .45, lk: 0 }, 'o'],
    [2.92, {}],
    [2.98, { lf: 0, rf: 0, lo: 1.5, ro: 1.5, tilt: 0, roll: 0, rk: .7, wind: .7, eye: 3, glint: 1 }, 'o'],
    [3.36, { yaw: TAU * 2, rk: .7 }, 'l'],
    [3.4, { rk: 0, lo: .3, ro: .3, lf: .3, rf: .3, sq: .85, eye: .5, glint: 0 }, 'o'],
    [3.46, { sq: 1.1, rf: 2.75, ro: .62 }, 'o'],
    [3.62, { sq: 1 }],
    [3.66, { sq: .85, rf: .3 }, 'o'],
    [3.74, { sq: 1.1, lf: 2.75, lo: .62 }, 'o'],
    [3.9, { sq: 1 }],
    [3.94, { sq: .82, lf: .3, lo: .3 }, 'o'],
    [4.02, { sq: 1.15, lf: 2.75, rf: 2.75, lo: .62, ro: .62, wind: .8, eye: 3, glint: 1, mouth: 2 }, 'o'],
    [4.22, { sq: 1.05 }],
    [FINAL, { sq: .72 }, 'o'],
    [4.34, { sq: 1, rf: 2.8, ro: .6, lf: -.12, lo: .78, wide: .24, tilt: .14, roll: .06, eye: .5, gaze: 1, mouth: 1.5, smile: 1, glint: 0, wind: .4 }, 'b'],
  ]);
  const pose = poser(hero, moves, poses, CLEARED);
  const fist = new Vector3();
  const home = camera.position.y;

  function render(t) {
    const p = pose(t, [4.9]);
    // Respawn flicker: on and off every other twelfth of a second.
    hero.root.visible = t >= .15 && (t >= .55 || Math.floor(t * 12) % 2 === 0);
    burst(spawn, t, [[.55, new Vector3(0, 1.1, .9), 4]], .4, 1.2, .8);
    burst(puffs, t, [[2.02, new Vector3(0, .1, 1.05), 3.4], [3.64, new Vector3(0, .1, 1.05), 2.2], [3.92, new Vector3(0, .1, 1.05), 2.2], [FINAL, new Vector3(0, .1, 1.05), 3.4]], .3, 1.6, .7, .4);
    hero.grip(hero.right, fist);
    burst(twinkle, t, [[4.4, fist.clone(), 2], [4.95, fist.clone(), 2]], .8, .6, .8);
    fireworks.update(t);
    const flash = fireworks.flash(t);
    set.show('star' + Math.floor(t * 3) % 2, 1 + flash * .3);
    cart.position.set(3.4, 4 + Math.sin(t * 1.1) * .2, -3.2);
    cart.rotation.set(Math.sin(t * .6) * .2, t * .7, .15);
    shadowUnder(shadow, p);
    shadow.visible = hero.root.visible;
    drift(t);
    glow.position.set(0, 2.2, 1.2);
    glow.intensity = 7 + Math.sin(t * 3) * 2 + flash * 12;
    shake(camera, home, pulse(t, 2, 2.14) * .03 + pulse(t, FINAL, FINAL + .14) * .03, t);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  yeet: createSaveScene, pr: createLinkScene, plan: createMapScene, clear: createClearScene,
  look: {
    words: { yeet: 'GAME SAVED.', pr: 'PR LINKED UP.', plan: 'MAP UNLOCKED.', clear: 'ALL CLEAR.' },
    background: 'radial-gradient(ellipse at 50% 60%,light-dark(#fbf8ff,#3a1c78) 0%,light-dark(#d9c9f8,#1d0b3c) 50%,light-dark(#b79cf2,#08060e) 100%)',
    ink: 'light-dark(#1a1030,#ffffff)',
    glow: '0 5px 0 light-dark(#6a3fc0,#3a2178),0 0 70px light-dark(#6a3fc050,#c9a8ff50)',
    flash: 'light-dark(#6a3fc0,#c9a8ff)',
    flashGlow: 'light-dark(#6a3fc090,#c9a8ff90)',
  },
};
