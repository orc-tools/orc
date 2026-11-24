// The phosphor cast for Yeet, PR opened, Plan reveal and All settled: a hacker in black
// shades who materialises at a floating keyboard, types far too fast and
// ships with a flourish. Every surface keeps its own lightness but takes the
// phosphor's green, the lights glow green, and he performs on a vector grid
// that scrolls toward the glass under a curtain of hex rain.
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Group, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Plane, PlaneGeometry, RepeatWrapping, SRGBColorSpace,
  CanvasTexture, TorusGeometry, Vector3,
} from 'three';
import { back, clamp, createStage, mix, pulse, range, smooth, wearSkin, wobble } from '../../ui/yeet/stage.js';
import {
  DESK, GLYPHS, INK, PALE, createHacker, createKeyboard, createMonitor, createPixels, font, glowTexture, hash, lit,
  paint, pose, sample, shadowBlob, wrap,
} from './hacker.js';
import { CLEAR_LANDS, createFireworks } from '../../ui/yeet/party.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

const DEEP = new Color(0x02130a);
const LIT = new Color(INK);
const LIGHT = new Color(PALE);
const GRID_STEP = 1;
const HEX = '0123456789ABCDEF';
const SCREEN = '#020a04';
const GREEN = '#39ff6a';
const WASH = '#d2ffdc';
const out = u => 1 - (1 - u) * (1 - u);

// A surface's lightness, kept, on the phosphor's ramp: black stays the dead
// tube, mid tones glow green and the brightest wash out to pale.
function phosphorTone(color) {
  const light = Math.pow(.2126 * color.r + .7152 * color.g + .0722 * color.b, .45);
  return light < .62 ? DEEP.clone().lerp(LIT, light / .62) : LIT.clone().lerp(LIGHT, (light - .62) / .38);
}

function retone(scene, own) {
  const seen = new Set();
  scene.traverse(object => {
    if (own.has(object)) return;
    if (object.isLight) {
      object.color.copy(phosphorTone(object.color).lerp(LIT, .5));
      object.groundColor?.copy(DEEP);
      return;
    }
    for (const material of [object.material].flat()) {
      if (!material || seen.has(material) || material.isShadowMaterial || material.userData.lit) continue;
      seen.add(material);
      material.color?.copy(phosphorTone(material.color));
      if (material.emissive && material.emissive.getHex()) material.emissive.copy(phosphorTone(material.emissive));
    }
  });
}

// A floor of glowing lines, one step longer than it shows, so sliding it a
// step toward the camera loops.
function phosphorGrid() {
  const points = [];
  for (let x = -9; x <= 9; x += GRID_STEP) points.push(x, 0, -14, x, 0, 4);
  for (let z = -14; z <= 4; z += GRID_STEP) points.push(-9, 0, z, 9, 0, z);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const grid = new LineSegments(geometry, new LineBasicMaterial({
    color: INK, transparent: true, opacity: .32, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }));
  grid.position.y = .005;
  return grid;
}

// Columns of hex glyphs on a tall strip that wraps, picked by stride so every
// replay rains the same.
function phosphorRainTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 26px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (let column = 0; column < 16; column++) {
    const x = 16 + column * 32;
    const head = (column * 397) % 1024;
    for (let row = 0; row < 34; row++) {
      const y = (head + row * 30) % 1024;
      const age = row / 34;
      ctx.fillStyle = row === 33 ? 'rgba(210,255,220,.95)' : `rgba(57,255,106,${(.08 + age * .7).toFixed(2)})`;
      ctx.fillText(HEX[(column * 7 + row * 5) % 16], x, y);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

function phosphorSkin({ scene, glow }) {
  const grid = phosphorGrid();
  const rain = [[-7, -5.5, 1], [-11, -3, .7]].map(([z, x, speed]) => {
    const curtain = new Mesh(new PlaneGeometry(26, 14), new MeshBasicMaterial({
      map: phosphorRainTexture(), transparent: true, opacity: .55, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    }));
    curtain.material.map.repeat.set(2, 1);
    curtain.position.set(x, 5.5, z);
    curtain.userData.speed = speed;
    return curtain;
  });
  scene.add(grid, ...rain);
  const own = new Set([grid, ...rain]);
  let toned = false;
  return t => {
    // The scene builds its cast after the stage, so the first frame retones it.
    if (!toned) {
      retone(scene, own);
      glow.color.set(INK);
      toned = true;
    }
    grid.position.z = (t * 1.6) % GRID_STEP;
    for (const curtain of rain) curtain.material.map.offset.y = t * .22 * curtain.userData.speed;
  };
}

// Builds him out of scanlines from the floor up: everything under the line
// is drawn, and a bright ring rides the line.
function materialiser(stage, textures, parts) {
  stage.renderer.localClippingEnabled = true;
  const cut = new Plane(new Vector3(0, -1, 0), 0);
  const clipped = new Set();
  for (const part of parts) part.traverse(object => {
    for (const material of [object.material].flat()) if (material && !clipped.has(material)) {
      clipped.add(material);
      material.clippingPlanes = [cut];
    }
  });
  const ring = new Mesh(new TorusGeometry(.78, .025, 6, 48).rotateX(Math.PI / 2), lit(PALE));
  const disc = new Mesh(new PlaneGeometry(2.6, 2.6), lit(INK, .5, glowTexture(textures)));
  disc.rotation.x = -Math.PI / 2;
  stage.scene.add(ring, disc);
  return (t, from, to, at) => {
    const u = range(t, from, to);
    const height = u >= 1 ? 99 : mix(-.05, 4.3, smooth(u));
    cut.constant = height;
    ring.visible = u > 0 && u < 1;
    ring.position.set(at.x, height, at.z);
    ring.scale.setScalar(1 + .12 * Math.sin(t * 30));
    disc.position.set(at.x, .02, at.z);
    disc.material.opacity = .55 * pulse(t, from - .05, to + .25);
  };
}

function codeLines(count, seed) {
  return Array.from({ length: count }, (_, row) => {
    const width = 8 + Math.floor(hash(row, seed) * 18);
    let line = '';
    for (let i = 0; i < width; i++) line += hash(row * 31 + seed, i) > .82 ? ' ' : GLYPHS[Math.floor(hash(row + seed, i * 3) * GLYPHS.length)];
    return line;
  });
}

// A monitor's idle face: rows of code that scroll up as he types.
function drawCode(ctx, w, h, lines, offset, colour = GREEN) {
  ctx.fillStyle = SCREEN;
  ctx.fillRect(0, 0, w, h);
  ctx.font = font(22);
  ctx.fillStyle = colour;
  const rows = Math.ceil(h / 28) + 1;
  for (let i = 0; i < rows; i++) {
    const line = lines[(i + Math.floor(offset)) % lines.length];
    ctx.globalAlpha = .45 + hash(i + Math.floor(offset), 9) * .55;
    ctx.fillText(line, 18, 30 + i * 28 - (offset % 1) * 28);
  }
  ctx.globalAlpha = 1;
  scanlines(ctx, w, h);
}

function scanlines(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
}

// CRTs floating around him, each scrolling its own code.
function sideMonitors(scene, textures, layout) {
  return layout.map(([x, y, z, turn, seed]) => {
    const lines = codeLines(24, seed);
    const monitor = createMonitor(textures, 1.4, 1.02, (ctx, w, h) => drawCode(ctx, w, h, lines, 0));
    monitor.group.position.set(x, y, z);
    monitor.group.rotation.y = turn;
    scene.add(monitor.group);
    let shown = -1;
    return {
      ...monitor,
      update(t, speed = 1) {
        monitor.group.position.y = y + Math.sin(t * 1.3 + seed) * .05;
        const step = Math.floor(t * 6 * speed);
        if (step !== shown) {
          shown = step;
          monitor.screen.redraw((ctx, w, h) => drawCode(ctx, w, h, lines, step * .5));
        }
      },
    };
  });
}

const camShake = (camera, base, t, amount) => {
  camera.position.x = base.x + Math.sin(t * 90) * amount;
  camera.position.y = base.y + Math.sin(t * 77) * amount * .7;
};

// The stance he types in: hands on the keys, leaning in, chin down.
const TYPE = { nod: .2, lean: .08, rw: .5, lw: .5 };

// Yeet: scan in at the keyboard (0.1-1.0), snap awake and type far too fast,
// pluck the page out of the air as it balls up (2.38) and crunch it into a
// floppy, push the shades up his nose, wind up a backhand and flick it away
// at LANDS like a frisbee, watch it blink out, then cross his arms.
const YEET_LANDS = 3.32;
const GONE = 4.02;
const Y = {
  spawn: pose({ ...TYPE, nod: .5, lean: .14, drop: -.06 }),
  wake: pose({ ...TYPE, nod: -.12, drop: -.12, brow: .6 }),
  type: pose({ ...TYPE, rt: 1, lt: 1 }),
  look: pose({ ...TYPE, rt: 1, turn: .45, nod: -.3, twist: .08, lhx: .95, lhy: 2.85, lhz: .72, lc: 0, lw: -.1, brow: .5 }),
  catch: pose({ ...TYPE, rt: .5, turn: .55, nod: -.4, twist: .12, lhx: 1.18, lhy: 3.2, lhz: .74, lc: .3, lw: -.3, brow: .7 }),
  inspect: pose({ ...TYPE, turn: .15, nod: -.02, twist: .05, lhx: .55, lhy: 2.82, lhz: 1.05, lc: .75, lw: .1, brow: .3, grin: .2 }),
  shades: pose({ ...TYPE, turn: .1, nod: .06, lhx: .55, lhy: 2.78, lhz: 1.05, lc: .75, lw: .1, rhx: -.06, rhy: 2.98, rhz: .66, rc: 1, ri: 1, rw: -.9, shades: 1, grin: .1 }),
  wind: pose({ drop: -.14, twist: -.5, lean: .04, turn: -.25, nod: .05, side: -.05, lhx: -.55, lhy: 2.55, lhz: .5, lc: .8, lw: .3, rhx: -.55, rhy: 2.05, rhz: .2, rc: .7, rfx: -.08, lfx: .1, brow: -.3 }),
  release: pose({ drop: -.18, twist: .42, lean: .2, turn: .35, nod: -.12, side: .06, lhx: 1.45, lhy: 3, lhz: 1.05, lc: .25, lw: -.2, rhx: -.6, rhy: 2.3, rhz: .1, rc: .7, lfx: .18, lfz: .18, rfx: -.05, brow: -.2, grin: .5 }),
  follow: pose({ drop: -.14, twist: .5, lean: .22, turn: .45, nod: -.3, side: .08, lhx: 1.55, lhy: 3.15, lhz: .65, lc: 0, lw: -.4, rhx: -.55, rhy: 2.3, rhz: .15, rc: .7, lfx: .18, lfz: .18, grin: .6 }),
  watch: pose({ drop: -.06, twist: .25, lean: .04, turn: .6, nod: -.5, lhx: 1.05, lhy: 3.35, lhz: .8, lc: 0, lw: -.9, rhx: -.5, rhy: 2.2, rhz: .2, rc: .7, lfx: .1, lfz: .1, brow: .4, grin: .4 }),
  cross: pose({ drop: -.04, lean: -.12, tilt: .1, turn: .06, nod: .06, rhx: .28, rhy: 2.4, rhz: .46, rc: .85, rw: 1.3, lhx: -.26, lhy: 2.47, lhz: .5, lc: .85, lw: 1.3, rfx: -.06, lfx: .06, grin: 1, brow: .7 }),
};
const YEET_KEYS = [
  [.1, Y.spawn], [.98, Y.spawn], [1.08, Y.wake, 'o'], [1.25, Y.type], [1.85, Y.type], [2.12, Y.look], [2.38, Y.catch, 'o'],
  [2.6, Y.inspect], [2.76, Y.shades, 'o'], [2.92, Y.shades], [3.17, Y.wind], [YEET_LANDS, Y.release, 'i'],
  [3.6, Y.follow, 'o'], [3.95, Y.watch], [4.32, Y.cross, 'b'],
];

function createYeet(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const textures = [];
  const hacker = createHacker(textures);
  const keyboard = createKeyboard(textures);
  keyboard.group.position.copy(DESK);
  keyboard.group.rotation.x = .4;
  hacker.root.add(keyboard.group);
  scene.add(hacker.root);
  const monitors = sideMonitors(scene, textures, [[-2.45, 3.05, -1.4, .5, 3], [2.5, 3.3, -1.8, -.45, 11]]);
  const blob = shadowBlob(scene);
  const scan = materialiser(stage, textures, [hacker.root]);

  const paperTexture = paint(textures, 256, 256, (ctx, w) => {
    ctx.fillStyle = '#e8e6d8';
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = '#2b3a30';
    ctx.font = font(26);
    ctx.fillText('SHIP', 20, 40);
    for (let i = 0; i < 6; i++) ctx.fillRect(20, 70 + i * 28, 150 + hash(i, 4) * 70, 8);
  });
  const paper = new Mesh(new BoxGeometry(.5, .5, .5, 2, 2, 2), new MeshStandardMaterial({ map: paperTexture, roughness: .95, flatShading: true }));
  const crumple = paper.geometry.attributes.position;
  for (let i = 0; i < crumple.count; i++) {
    const v = new Vector3().fromBufferAttribute(crumple, i).normalize().multiplyScalar(.3 + hash(i, 7) * .08);
    crumple.setXYZ(i, v.x, v.y, v.z);
  }
  paper.geometry.computeVertexNormals();
  scene.add(paper);

  const label = paint(textures, 256, 160, (ctx, w, h) => {
    ctx.fillStyle = '#f1efe4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1c2a20';
    ctx.font = font(40);
    ctx.fillText('SHIP', 16, 52);
    ctx.font = font(20);
    wrap(ctx, title.trim(), w - 32, 3).forEach((line, i) => ctx.fillText(line, 16, 88 + i * 24));
  });
  const floppy = new Group();
  const shell = new MeshStandardMaterial({ color: 0x3a3d40, roughness: .5, metalness: .1 });
  floppy.add(new Mesh(new BoxGeometry(.56, .58, .04), shell));
  const shutter = new Mesh(new BoxGeometry(.3, .17, .046), new MeshStandardMaterial({ color: 0xb9bcc0, roughness: .3, metalness: .8 }));
  shutter.position.set(.04, .2, 0);
  const sticker = new Mesh(new PlaneGeometry(.46, .29), new MeshStandardMaterial({ map: label, roughness: .8 }));
  sticker.position.set(0, -.1, .022);
  floppy.add(shutter, sticker);
  floppy.traverse(object => { object.castShadow = true; });
  scene.add(floppy);
  const ghosts = Array.from({ length: 5 }, (_, i) => {
    const ghost = new Mesh(new BoxGeometry(.56, .58, .04), lit(i % 2 ? PALE : INK, .35));
    scene.add(ghost);
    return ghost;
  });
  const morph = new Mesh(new TorusGeometry(1, .035, 6, 40), lit(PALE));
  scene.add(morph);

  const starTexture = paint(textures, 128, 128, ctx => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
      ctx.quadraticCurveTo(64, 64, 64 + Math.cos(a + Math.PI / 2) * 62, 64 + Math.sin(a + Math.PI / 2) * 62);
    }
    ctx.fill();
  });
  const star = new Mesh(new PlaneGeometry(1, 1), lit(PALE, 1, starTexture));
  const flare = new Mesh(new PlaneGeometry(1, 1), lit(INK, 1, glowTexture(textures)));
  const shock = new Mesh(new TorusGeometry(1, .04, 6, 48), lit(INK));
  scene.add(star, flare, shock);
  const pixels = createPixels(scene);

  const p = pose({});
  const v = new Vector3();
  const base = camera.position.clone();
  const far = new Vector3(5.8, 7.4, -30);

  function act(t) {
    sample(YEET_KEYS, t, p);
    const bob = Math.abs(Math.sin(t * Math.PI * 4)) * (pulse(t, 1.15, 1.95) + range(t, 4.32, 4.5) * .4);
    p.nod += bob * .08;
    p.drop -= bob * .03;
    const snap = wobble(t, 1.08, 14, 6) + wobble(t, 2.38, 16, 7) * .6;
    p.lhy -= snap * .06 * range(t, 2.2, 2.4);
    p.nod += wobble(t, 1.08, 14, 6) * .1;
    p.shades = pulse(t, 2.7, 2.95);
    hacker.apply(p, t);
  }

  act(YEET_LANDS);
  const origin = hacker.grip(1, new Vector3());
  act(2.5);
  const morphAt = hacker.grip(1, new Vector3());
  function flight(t, target) {
    const s = 1 - Math.exp(-Math.max(0, t - YEET_LANDS) * 4.4);
    target.lerpVectors(origin, far, s);
    target.y += Math.sin(s * Math.PI) * 1.2;
    return target;
  }

  function render(t) {
    act(t);
    scan(t, .1, .98, hacker.root.position);
    keyboard.update(t, Math.max(p.rt, p.lt));
    monitors.forEach(monitor => monitor.update(t, 1 + pulse(t, 1.1, 2) * 2));
    hacker.lenses(t, range(t, 4.3, 4.65));
    hacker.gauntlet(t, pulse(t, 2.7, 2.95));

    paper.visible = t > 2.26 && t < 2.56;
    if (paper.visible) {
      hacker.grip(1, paper.position);
      paper.scale.setScalar(back(range(t, 2.26, 2.38)) * (1 - range(t, 2.46, 2.56)));
      paper.rotation.set(t * 3, t * 2.2 + range(t, 2.46, 2.56) * 6, t);
    }
    const thrown = t >= YEET_LANDS;
    floppy.visible = t > 2.48 && t < GONE;
    if (thrown) {
      flight(t, floppy.position);
      // Spins flat about its face, frisbee style, and tips away into the distance.
      floppy.rotation.set(-1.1 + (t - YEET_LANDS) * .6, 0, -(t - YEET_LANDS) * 26);
      floppy.scale.setScalar(1 - range(t, 3.8, GONE) * .7);
    } else {
      hacker.grip(1, floppy.position);
      const flip = range(t, 2.95, 3.17);
      floppy.rotation.set(-.15 - flip * .9, -.25 + flip * .6, .1 - flip * 1.2);
      floppy.scale.setScalar(back(range(t, 2.48, 2.62), 2.2));
    }
    ghosts.forEach((ghost, i) => {
      const at = t - (i + 1) * .03;
      ghost.visible = thrown && at > YEET_LANDS && t < 3.85;
      flight(at, ghost.position);
      ghost.rotation.copy(floppy.rotation);
      ghost.scale.setScalar(floppy.scale.x * (1 - i * .14));
    });
    morph.visible = t > 2.48 && t < 2.8;
    morph.position.copy(morphAt);
    morph.quaternion.copy(camera.quaternion);
    morph.scale.setScalar(.15 + out(range(t, 2.48, 2.8)) * 1.2);
    morph.material.opacity = 1 - range(t, 2.48, 2.8);

    flight(GONE, v);
    const pop = range(t, GONE, GONE + .12), fade = 1 - range(t, GONE + .12, 4.6);
    star.visible = flare.visible = shock.visible = t > GONE && fade > 0;
    for (const mesh of [star, flare, shock]) {
      mesh.position.copy(v);
      mesh.quaternion.copy(camera.quaternion);
    }
    star.rotateZ(t * 3);
    star.scale.setScalar(6 * back(pop, 2.4) * fade);
    star.material.opacity = fade;
    flare.scale.setScalar(12 * out(pop) * fade);
    flare.material.opacity = fade * .8;
    shock.scale.setScalar(1 + out(range(t, GONE, 4.6)) * 7);
    shock.material.opacity = 1 - range(t, GONE, 4.6);

    if (t > YEET_LANDS - .03) pixels.burst(t, YEET_LANDS - .03, origin, 1, .8);
    else if (t > 2.48) pixels.burst(t, 2.48, morphAt, .5, .6);
    else pixels.burst(t, 1.02, v.set(0, 3.3, .3), .8, .9);

    hacker.root.getWorldPosition(v);
    blob.position.set(v.x, .012, v.z + .1);
    blob.material.opacity = .35 * range(t, .3, 1);
    glow.intensity = 10 + Math.sin(t * 3) * 3 + pulse(t, YEET_LANDS, 3.7) * 10;
    camShake(camera, base, t, pulse(t, 1.04, 1.2) * .03 + pulse(t, YEET_LANDS, 3.55) * .035);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// PR opened: he jabs two keys (1.5, 1.95) that each push the big CRT's
// firewall bar along, hammers the rest out, raises one hand high and slams
// Enter on LANDS. The screen flashes ACCESS GRANTED, spits out the pull
// request as a card, and he fires finger guns at it.
const STRIKES = [1.5, 1.95, 3.05];
const PR_LANDS = STRIKES[2];
const ENTER = new Vector3(DESK.x - .66, DESK.y + .12, DESK.z - .02);
const R = {
  spawn: pose({ ...TYPE, nod: .5, lean: .14, drop: -.06 }),
  type: pose({ ...TYPE, rt: 1, lt: 1, turn: .2 }),
  raiseR: pose({ ...TYPE, turn: .3, rhx: -.6, rhy: 2.8, rhz: 1.1, rc: 1, ri: 1, rw: .2, lt: .3 }),
  jabR: pose({ ...TYPE, turn: .3, nod: .3, lean: .14, rhx: -.2, rhy: 2.12, rhz: .78, rc: 1, ri: 1, rw: .3, drop: -.08 }),
  raiseL: pose({ ...TYPE, turn: .3, lhx: .65, lhy: 2.85, lhz: 1.1, lc: 1, li: 1, lw: .2, rt: .3 }),
  jabL: pose({ ...TYPE, turn: .3, nod: .3, lean: .14, lhx: .24, lhy: 2.12, lhz: .8, lc: 1, li: 1, lw: .3, drop: -.08 }),
  frenzy: pose({ ...TYPE, rt: 1, lt: 1, turn: .25, nod: .3, lean: .16, drop: -.08 }),
  windup: pose({ ...TYPE, lean: -.12, nod: -.2, turn: .15, side: .06, rhx: -.55, rhy: 3.55, rhz: .4, rc: 1, rw: -.2, lt: .5, drop: .04, brow: .6 }),
  slam: pose({ ...TYPE, lean: .26, nod: .35, turn: .2, side: -.04, rhx: ENTER.x, rhy: ENTER.y, rhz: ENTER.z, rc: 1, rw: .9, drop: -.2, brow: -.4 }),
  lean: pose({ lean: -.14, nod: -.1, turn: .35, tilt: .08, rhx: -.1, rhy: 2.75, rhz: 1.0, rc: 1, ri: 1, rw: -.4, lhx: .75, lhy: 2.8, lhz: 1.0, lc: 1, li: 1, lw: -.4, grin: 1, brow: .6, drop: -.04 }),
  shades: pose({ lean: -.08, nod: .04, turn: .15, rhx: -.06, rhy: 2.98, rhz: .66, rc: 1, ri: 1, rw: -.9, lhx: .5, lhy: 2.3, lhz: .45, lc: .8, lw: .8, grin: .2, shades: 1 }),
  cross: pose({ lean: -.12, tilt: .1, turn: .2, nod: .05, rhx: .28, rhy: 2.4, rhz: .46, rc: .85, rw: 1.3, lhx: -.26, lhy: 2.47, lhz: .5, lc: .85, lw: 1.3, grin: 1, brow: .5 }),
};
const PR_KEYS = [
  [.1, R.spawn], [.9, R.spawn], [1.08, R.type, 'o'], [1.3, R.type], [1.42, R.raiseR, 'o'], [STRIKES[0], R.jabR, 'i'],
  [1.7, R.type], [1.86, R.raiseL, 'o'], [STRIKES[1], R.jabL, 'i'], [2.12, R.frenzy], [2.62, R.frenzy],
  [2.9, R.windup, 'o'], [2.96, R.windup], [PR_LANDS, R.slam, 'i'], [3.25, R.slam], [3.5, R.lean, 'b'],
  [3.85, R.lean], [4.05, R.shades, 'o'], [4.2, R.shades], [4.55, R.cross, 'b'],
];

function createPr(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const textures = [];
  const hacker = createHacker(textures);
  const keyboard = createKeyboard(textures);
  keyboard.group.position.copy(DESK);
  keyboard.group.rotation.x = .4;
  hacker.root.add(keyboard.group);
  scene.add(hacker.root);
  const blob = shadowBlob(scene);
  const scan = materialiser(stage, textures, [hacker.root]);
  const side = sideMonitors(scene, textures, [[-2.9, 3.4, -2, .55, 5]])[0];

  const lines = codeLines(30, 17);
  let shown = '';
  const drawBig = (ctx, w, h, state, t) => {
    if (state.granted) {
      ctx.fillStyle = state.blink ? GREEN : SCREEN;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = state.blink ? SCREEN : GREEN;
      ctx.textAlign = 'center';
      ctx.font = font(54, '800');
      ctx.fillText('ACCESS', w / 2, h / 2 - 14);
      ctx.fillText('GRANTED', w / 2, h / 2 + 50);
      ctx.textAlign = 'left';
      scanlines(ctx, w, h);
      return;
    }
    drawCode(ctx, w, h, lines, t);
    ctx.fillStyle = SCREEN;
    ctx.fillRect(30, h - 132, w - 60, 102);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 3;
    ctx.strokeRect(30, h - 132, w - 60, 102);
    ctx.fillStyle = WASH;
    ctx.font = font(24);
    ctx.fillText(state.bar < 1 ? 'BYPASSING FIREWALL' : 'PUSHING BRANCH', 48, h - 100);
    ctx.fillStyle = GREEN;
    ctx.fillRect(48, h - 80, (w - 96) * state.bar, 30);
    ctx.font = font(22);
    ctx.fillStyle = state.bar > .5 ? SCREEN : GREEN;
    ctx.fillText(`${Math.round(state.bar * 99)}%`, 58, h - 57);
  };
  const big = createMonitor(textures, 1.9, 1.38, (ctx, w, h) => drawBig(ctx, w, h, { bar: 0 }, 0));
  big.group.position.set(1.5, 2.75, -.3);
  big.group.rotation.y = -.5;
  scene.add(big.group);

  const cardTexture = paint(textures, 512, 288, (ctx, w, h) => {
    ctx.fillStyle = SCREEN;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = GREEN;
    ctx.fillRect(6, 6, w - 12, 58);
    ctx.fillStyle = SCREEN;
    ctx.font = font(32, '800');
    ctx.fillText('PULL REQUEST', 26, 46);
    ctx.fillStyle = WASH;
    ctx.font = font(26);
    wrap(ctx, title.trim(), w - 60, 3).forEach((line, i) => ctx.fillText(line, 28, 108 + i * 34));
    ctx.fillStyle = GREEN;
    ctx.font = font(22);
    ctx.fillText('+ OPEN  > ready for review_', 28, h - 30);
  });
  const card = new Mesh(new PlaneGeometry(1.5, .84), lit(0xffffff, 1, cardTexture, false));
  const cardGlow = new Mesh(new PlaneGeometry(3, 1.9), lit(INK, .5, glowTexture(textures)));
  scene.add(card, cardGlow);
  const pixels = createPixels(scene, 44);

  const p = pose({});
  const v = new Vector3(), from = new Vector3(), rest = new Vector3(1.05, 4.15, 1.4);
  const base = camera.position.clone();
  big.glass.getWorldPosition(from);

  function act(t) {
    sample(PR_KEYS, t, p);
    p.x = -.8;
    p.ry = .28;
    const bob = Math.abs(Math.sin(t * Math.PI * 5)) * pulse(t, 2.05, 2.7);
    p.nod += bob * .1;
    p.drop -= bob * .03 + STRIKES.reduce((sum, at, i) => sum + Math.abs(wobble(t, at, 20, 9)) * (i === 2 ? .06 : .03), 0);
    const recoil = pulse(t, 3.55, 3.66) + pulse(t, 3.7, 3.81);
    p.rhy += recoil * .12;
    p.lhy += recoil * .12;
    hacker.apply(p, t);
  }

  function render(t) {
    act(t);
    scan(t, .1, .9, hacker.root.position);
    const slam = Math.abs(wobble(t, PR_LANDS, 18, 6)) + pulse(t, PR_LANDS - .02, PR_LANDS + .2);
    keyboard.update(t, Math.max(p.rt, p.lt, pulse(t, STRIKES[0] - .02, STRIKES[0] + .12), pulse(t, STRIKES[1] - .02, STRIKES[1] + .12)), clamp(slam));
    side.update(t, 1 + pulse(t, 2, 2.8) * 2);
    hacker.lenses(t, range(t, 4.1, 4.45));
    hacker.gauntlet(t, pulse(t, PR_LANDS - .05, PR_LANDS + .3));

    const bar = t < STRIKES[0] ? 0 : t < STRIKES[1] ? .34 : t < 2.12 ? .67 : t < PR_LANDS ? mix(.67, 1, range(t, 2.12, 2.85)) : 1;
    const granted = t >= PR_LANDS;
    const blink = granted && Math.floor((t - PR_LANDS) * 6) % 2 === 0;
    const key = granted ? `g${blink}` : `${Math.floor(t * 8)}:${bar.toFixed(2)}`;
    if (key !== shown) {
      shown = key;
      big.screen.redraw((ctx, w, h) => drawBig(ctx, w, h, { bar, granted, blink }, Math.floor(t * 8) * .5));
    }
    big.halo.material.opacity = .18 + pulse(t, PR_LANDS, PR_LANDS + .5) * .6;
    big.group.position.y = 2.75 + Math.sin(t * 1.2) * .04 + Math.abs(wobble(t, PR_LANDS, 22, 8)) * .08;

    const eject = range(t, PR_LANDS + .08, PR_LANDS + .5);
    card.visible = cardGlow.visible = eject > 0;
    card.position.lerpVectors(from, rest, out(eject));
    card.position.y += Math.sin(t * 2.4) * .05 * range(t, 3.6, 4);
    card.quaternion.copy(camera.quaternion);
    card.rotateZ((1 - out(eject)) * -.8 + Math.sin(t * 1.8) * .03);
    card.rotateY((1 - out(eject)) * -.6);
    card.scale.setScalar(.25 + back(eject, 1.8) * .75);
    cardGlow.position.copy(card.position);
    cardGlow.position.z -= .05;
    cardGlow.quaternion.copy(card.quaternion);
    cardGlow.material.opacity = .25 + pulse(t, PR_LANDS + .1, 3.8) * .5;

    if (t > PR_LANDS - .03) pixels.burst(t, PR_LANDS - .03, from, 1.1, .9);
    else if (t > STRIKES[1] - .03) pixels.burst(t, STRIKES[1] - .03, from, .4, .5);
    else if (t > STRIKES[0] - .03) pixels.burst(t, STRIKES[0] - .03, from, .4, .5);
    else pixels.hide();

    hacker.root.getWorldPosition(v);
    blob.position.set(v.x, .012, v.z + .1);
    blob.material.opacity = .35 * range(t, .3, .9);
    glow.intensity = 10 + Math.sin(t * 3) * 3 + pulse(t, PR_LANDS, 3.5) * 14;
    camShake(camera, base, t, STRIKES.reduce((sum, at, i) => sum + pulse(t, at, at + .14) * (i === 2 ? .05 : .015), 0));
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// Plan reveal: a hologram of the plan scans in over his keyboard as
// scrambled glyphs and decrypts while he types, locks in on LANDS, he throws
// both fists up, then palms it at the viewer on RELEASE so it ends centred in
// view, where the send-offs plugin pushes in on it.
const PLAN_LANDS = 2.55;
const RELEASE = 3.22;
const FLIGHT = [RELEASE, 3.9];
const SHEET = .77;
// Centred on the camera's line of sight at z = 6, about half the view tall.
const FRONT = new Vector3(.125, 2.375, 6);
const FRONT_WIDTH = 2.75;
const HELD = new Vector3(1.45, 3.25, .55);
const DECRYPT = [1.15, PLAN_LANDS];
const L = {
  spawn: pose({ ...TYPE, nod: .5, lean: .14, drop: -.06 }),
  type: pose({ ...TYPE, rt: 1, lt: 1, turn: .3, nod: .05 }),
  stare: pose({ ...TYPE, rt: 1, lt: 1, turn: .42, nod: -.12, lean: .12, brow: .3 }),
  fists: pose({ lean: -.16, nod: -.25, turn: .15, rhx: -.62, rhy: 3.55, rhz: .3, rc: 1, rw: .2, lhx: .62, lhy: 3.55, lhz: .3, lc: 1, lw: .2, grin: 1, brow: 1, drop: .06 }),
  reach: pose({ lean: .06, nod: -.12, turn: .45, twist: .2, rhx: -.45, rhy: 2.3, rhz: .45, rc: .7, lhx: 1.05, lhy: 3.05, lhz: .72, lc: 0, lw: -1.2, brow: .4, grin: .3 }),
  push: pose({ lean: .2, nod: -.05, turn: .2, twist: .32, rhx: -.45, rhy: 2.3, rhz: .45, rc: .7, lhx: .75, lhy: 2.95, lhz: 1.35, lc: 0, lw: -1.4, drop: -.12, lfz: .2, grin: .6 }),
  cross: pose({ lean: -.12, tilt: .1, turn: .04, nod: .05, rhx: .28, rhy: 2.4, rhz: .46, rc: .85, rw: 1.3, lhx: -.26, lhy: 2.47, lhz: .5, lc: .85, lw: 1.3, grin: 1, brow: .5 }),
};
const PLAN_KEYS = [
  [.1, L.spawn], [.86, L.spawn], [1.02, L.type, 'o'], [1.6, L.type], [2, L.stare], [2.42, L.stare],
  [2.66, L.fists, 'b'], [2.86, L.fists], [3.1, L.reach], [RELEASE, L.push, 'i'], [3.4, L.push], [3.8, L.cross, 'b'],
];

function createPlan(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const textures = [];
  const hacker = createHacker(textures);
  const keyboard = createKeyboard(textures);
  keyboard.group.position.copy(DESK);
  keyboard.group.rotation.x = .4;
  hacker.root.add(keyboard.group);
  scene.add(hacker.root);
  const blob = shadowBlob(scene);
  const scan = materialiser(stage, textures, [hacker.root]);
  const monitors = sideMonitors(scene, textures, [[-2.45, 3.1, -1.5, .5, 23], [3.1, 4.5, -2.6, -.4, 29]]);

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font(30);
  const rows = [
    { text: 'THE PLAN', size: 46, y: 70 },
    ...wrap(measure, title.trim(), 440, 2).map((text, i) => ({ text, size: 30, y: 124 + i * 36 })),
    ...Array.from({ length: 5 }, (_, i) => ({ text: '[x] ' + '='.repeat(10 + Math.floor(hash(i, 12) * 12)), size: 26, y: 210 + i * 38, item: true })),
  ];
  // Each row's glyphs settle left to right, a little after the row above.
  const drawSheet = (ctx, w, h, progress, step, done) => {
    ctx.fillStyle = SCREEN;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    rows.forEach((row, r) => {
      ctx.font = font(row.size, r ? 'bold' : '800');
      const settled = done ? row.text.length : Math.floor(clamp(progress * 1.5 - r * .08) * row.text.length);
      let shownText = '';
      for (let i = 0; i < row.text.length; i++) {
        const c = row.text[i];
        shownText += i < settled || c === ' ' ? c : GLYPHS[Math.floor(hash(step + i, r) * GLYPHS.length)];
      }
      ctx.fillStyle = row.item && settled === row.text.length ? GREEN : r === 0 || settled === row.text.length ? WASH : 'rgba(57,255,106,.75)';
      ctx.fillText(shownText, 34, row.y);
    });
    if (done) {
      ctx.fillStyle = GREEN;
      ctx.fillRect(w - 186, 34, 156, 40);
      ctx.fillStyle = SCREEN;
      ctx.font = font(22, '800');
      ctx.fillText('DECRYPTED', w - 178, 62);
    }
    scanlines(ctx, w, h);
  };
  const sheetTexture = paint(textures, 512, Math.round(512 * SHEET), (ctx, w, h) => drawSheet(ctx, w, h, 0, 0, false));
  const sheet = new Mesh(new PlaneGeometry(1, SHEET), lit(0xffffff, 1, sheetTexture, false));
  const halo = new Mesh(new PlaneGeometry(2, 2 * SHEET), lit(INK, .4, glowTexture(textures)));
  scene.add(halo, sheet);
  const pixels = createPixels(scene, 44);
  let shown = '';

  const p = pose({});
  const v = new Vector3(), held = new Vector3();
  const base = camera.position.clone();

  function act(t) {
    sample(PLAN_KEYS, t, p);
    const bob = Math.abs(Math.sin(t * Math.PI * 4)) * pulse(t, 1.05, 2.45);
    p.nod += bob * .08;
    p.drop -= bob * .03;
    const pump = Math.sin(t * 16) * pulse(t, 2.62, 2.95) * .1;
    p.rhy += pump;
    p.lhy -= pump;
    hacker.apply(p, t);
  }

  function render(t) {
    act(t);
    scan(t, .1, .86, hacker.root.position);
    keyboard.update(t, Math.max(p.rt, p.lt));
    monitors.forEach(monitor => monitor.update(t, 1 + pulse(t, 1.1, 2.5)));
    hacker.lenses(t, range(t, 3.85, 4.2));
    hacker.gauntlet(t, pulse(t, PLAN_LANDS, PLAN_LANDS + .3));

    const appear = range(t, .95, 1.2);
    const progress = range(t, DECRYPT[0], DECRYPT[1]);
    const done = t >= PLAN_LANDS;
    const step = Math.floor(t * 20);
    const key = done ? 'done' : `${step}`;
    if (key !== shown) {
      shown = key;
      sheetTexture.redraw((ctx, w, h) => drawSheet(ctx, w, h, done ? 1 : progress, step, done));
    }
    const lift = 1 - (1 - range(t, FLIGHT[0], FLIGHT[1])) ** 3;
    held.copy(HELD);
    held.y += Math.sin(t * 2.2) * .05 + Math.abs(wobble(t, PLAN_LANDS, 16, 7)) * .1;
    sheet.position.lerpVectors(held, FRONT, lift);
    sheet.position.y += Math.sin(lift * Math.PI) * .3;
    sheet.quaternion.copy(camera.quaternion);
    sheet.rotateY(-.35 * (1 - lift));
    sheet.rotateZ(Math.sin(lift * Math.PI) * .12);
    const width = mix(1.35, FRONT_WIDTH, lift) * (1 + pulse(t, PLAN_LANDS, PLAN_LANDS + .25) * .08);
    sheet.scale.set(width, width * smooth(appear), 1);
    sheet.visible = appear > 0;
    sheet.material.opacity = .85 + .15 * lift - (1 - lift) * .1 * hash(step, 5) * (done ? 0 : 1);
    halo.visible = sheet.visible;
    halo.position.copy(sheet.position);
    halo.position.z -= .05;
    halo.quaternion.copy(sheet.quaternion);
    halo.scale.copy(sheet.scale);
    halo.material.opacity = (.3 + pulse(t, PLAN_LANDS, PLAN_LANDS + .5) * .6) * (1 - lift * .8);

    if (t > RELEASE) pixels.burst(t, RELEASE, held, .6, .6);
    else if (t > PLAN_LANDS - .02) pixels.burst(t, PLAN_LANDS - .02, held, .9, .9);
    else pixels.hide();

    hacker.root.getWorldPosition(v);
    blob.position.set(v.x, .012, v.z + .1);
    blob.material.opacity = .35 * range(t, .3, .9);
    glow.intensity = 10 + Math.sin(t * 3) * 3 + pulse(t, PLAN_LANDS, 2.9) * 12;
    camShake(camera, base, t, pulse(t, PLAN_LANDS - .05, PLAN_LANDS + .2) * .03 + pulse(t, RELEASE, RELEASE + .2) * .02);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

// All settled. Beats: scan in at the keyboard (0.1-0.98), snap awake and
// hammer the keys (1.08-1.3), raise one hand high and slam Enter as the
// screens clear and the pixel shells burst (1.45), throw both fists up and
// pump them (1.9-4.0), then cross his arms.
const C = {
  spawn: pose({ ...TYPE, nod: .5, lean: .14, drop: -.06 }),
  type: pose({ ...TYPE, rt: 1, lt: 1, turn: .2 }),
  windup: pose({ ...TYPE, lean: -.12, nod: -.2, turn: .15, side: .06, rhx: -.55, rhy: 3.55, rhz: .4, rc: 1, rw: -.2, lt: .5, drop: .04, brow: .6 }),
  slam: pose({ ...TYPE, lean: .26, nod: .35, turn: .2, side: -.04, rhx: ENTER.x, rhy: ENTER.y, rhz: ENTER.z, rc: 1, rw: .9, drop: -.2, brow: -.4 }),
  cheer: pose({ lean: -.16, nod: -.25, drop: -.02, rhx: -.75, rhy: 3.5, rhz: .5, rc: 1, rw: -.3, lhx: .75, lhy: 3.5, lhz: .5, lc: 1, lw: -.3, grin: 1, brow: .8 }),
  cross: pose({ lean: -.12, tilt: .1, turn: .06, nod: .06, rhx: .28, rhy: 2.4, rhz: .46, rc: .85, rw: 1.3, lhx: -.26, lhy: 2.47, lhz: .5, lc: .85, lw: 1.3, rfx: -.06, lfx: .06, grin: 1, brow: .7 }),
};
const CLEAR_KEYS = [
  [.1, C.spawn], [.98, C.spawn], [1.08, C.type, 'o'], [1.26, C.type], [1.38, C.windup, 'o'], [CLEAR_LANDS, C.slam, 'i'],
  [1.7, C.slam], [1.95, C.cheer, 'b'], [4, C.cheer], [4.32, C.cross, 'b'],
];

function createClear(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const textures = [];
  const hacker = createHacker(textures);
  const keyboard = createKeyboard(textures);
  keyboard.group.position.copy(DESK);
  keyboard.group.rotation.x = .4;
  hacker.root.add(keyboard.group);
  scene.add(hacker.root);
  const monitors = sideMonitors(scene, textures, [[-2.45, 3.05, -1.4, .5, 3], [2.5, 3.3, -1.8, -.45, 11]]);
  const blob = shadowBlob(scene);
  const scan = materialiser(stage, textures, [hacker.root]);
  const pixels = createPixels(scene);
  const fireworks = createFireworks(scene, camera, { colors: [INK, 0x12b34a, PALE, 0x0c7a33], geometry: new BoxGeometry(1, 1, 1), size: .16, sparks: 32 });
  // The shells are lit pixels, so the skin leaves their colours alone.
  fireworks.mesh.material.userData.lit = true;

  const p = pose({});
  const v = new Vector3();
  const base = camera.position.clone();
  function render(t) {
    sample(CLEAR_KEYS, t, p);
    const pump = range(t, 1.95, 2.1) * (1 - range(t, 3.95, 4.05));
    const beat = Math.sin((t - 1.95) * Math.PI * 4);
    p.rhy -= Math.max(0, beat) * .55 * pump;
    p.lhy -= Math.max(0, -beat) * .55 * pump;
    p.nod += Math.abs(beat) * .1 * pump + wobble(t, 1.08, 14, 6) * .1;
    p.drop -= Math.abs(beat) * .05 * pump;
    p.side += beat * .06 * pump;
    hacker.apply(p, t);
    scan(t, .1, .98, hacker.root.position);
    keyboard.update(t, Math.max(p.rt, p.lt), pulse(t, CLEAR_LANDS - .02, CLEAR_LANDS + .3));
    monitors.forEach(monitor => monitor.update(t, 1 + pulse(t, 1.08, 1.45) * 3));
    hacker.lenses(t, range(t, 4.3, 4.65));
    hacker.gauntlet(t, pulse(t, CLEAR_LANDS, CLEAR_LANDS + .3));
    fireworks.update(t);
    if (t > CLEAR_LANDS - .03) pixels.burst(t, CLEAR_LANDS - .03, v.copy(ENTER).add(hacker.root.position), 1.1, .9);
    else pixels.burst(t, 1.02, v.set(0, 3.3, .3), .8, .9);
    hacker.root.getWorldPosition(v);
    blob.position.set(v.x, .012, v.z + .1);
    blob.material.opacity = .35 * range(t, .3, 1);
    const flash = fireworks.flash(t);
    glow.intensity = 10 + Math.sin(t * 3) * 3 + flash * 10;
    camShake(camera, base, t, pulse(t, 1.04, 1.2) * .03 + pulse(t, CLEAR_LANDS, CLEAR_LANDS + .22) * .04);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose(textures) };
}

const skinned = create => (container, title) => wearSkin(phosphorSkin, () => create(container, title));

export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  yeet: skinned(createYeet), pr: skinned(createPr), plan: skinned(createPlan), clear: skinned(createClear),
  look: {
    words: { yeet: 'SUDO YEET', pr: 'PR OPENED_', plan: 'PLAN DECRYPTED', clear: 'EXIT CODE 0_' },
    background: 'repeating-linear-gradient(0deg,light-dark(#0c21140a,#00000052) 0 1px,transparent 1px 3px),radial-gradient(ellipse at 50% 58%,light-dark(#fbfaf0,#0b2412) 0%,light-dark(#f2f0de,#050a06) 55%,light-dark(#dcebd5,#010302) 100%)',
    ink: 'light-dark(#0c2114,#9dffb2)',
    glow: '0 0 2px light-dark(#13693a,#39ff6a),0 3px 0 light-dark(#9fd3a8,#0e2a15),0 0 40px light-dark(#13693a50,#39ff6aa0)',
    flash: 'light-dark(#13693a,#d2ffdc)',
    flashGlow: 'light-dark(#39ff6a90,#39ff6ab0)',
  },
};
