// The phosphor cast: a lanky hacker in a hoodie and black shades, a mullet,
// and a chunky keypad gauntlet on his right hand, at a floating keyboard
// between two CRTs. Everything is built in plain colours; the stage skin
// retones it onto the tube's green. Anything marked `lit` glows as drawn.
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, CircleGeometry, CylinderGeometry, Group, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, SphereGeometry,
  SRGBColorSpace, TorusGeometry, Vector3,
} from 'three';
import { clamp, mix, range, smooth, back } from '../../ui/yeet/stage.js';

export const INK = 0x39ff6a;
export const PALE = 0xd2ffdc;
export const GLYPHS = '0123456789ABCDEF#$%&*+<>/=';

const UPPER = .6;
const FORE = .56;
const THIGH = .78;
const SHIN = .74;
const ANKLE = .14;
const HIP = 1.66;
// Root-space centre of the keyboard's key face, where the typing hands rest.
export const DESK = new Vector3(0, 2.02, .82);

const out = u => 1 - (1 - u) * (1 - u);
const EASE = { s: smooth, i: u => u * u * u, o: out, b: u => back(u, 1.6), l: u => u };

// [[time, pose, ease?], ...]: each segment eases into its end pose, and the
// first and last poses hold outside the track.
export function sample(keys, t, target) {
  let i = 1;
  while (i < keys.length - 1 && t > keys[i][0]) i++;
  const [t0, a] = keys[i - 1], [t1, b, ease = 's'] = keys[i];
  const u = EASE[ease](range(t, t0, t1));
  for (const key in a) target[key] = mix(a[key], b[key], u);
  return target;
}

// A stable 0-1 value for (a, b), so scrambled glyphs and flickers replay the
// same for the same time.
export const hash = (a, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function paint(textures, width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  textures.push(texture);
  return Object.assign(texture, {
    ctx,
    redraw(fn) { fn(ctx, width, height); texture.needsUpdate = true; },
  });
}

// Glows as drawn: the skin leaves it out of the retone.
export function lit(color, opacity = 1, map = null, additive = true) {
  const material = new MeshBasicMaterial({
    color, map, transparent: true, opacity, depthWrite: !additive, toneMapped: false,
    blending: additive ? AdditiveBlending : undefined,
  });
  material.userData.lit = true;
  return material;
}

export function wrap(ctx, text, width, lines) {
  const words = text.split(/\s+/).filter(Boolean);
  const rows = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      rows.push(line);
      line = word;
    } else line = next;
  }
  if (line) rows.push(line);
  if (rows.length > lines) rows.splice(lines - 1, rows.length, `${rows[lines - 1]}…`);
  return rows;
}

// A soft round glow, for halos behind lit things.
export function glowTexture(textures) {
  return paint(textures, 128, 128, ctx => {
    const shine = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    shine.addColorStop(0, 'rgba(255,255,255,1)');
    shine.addColorStop(.35, 'rgba(255,255,255,.35)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, 128, 128);
  });
}

const MONO = '"JetBrains Mono", ui-monospace, monospace';
export const font = (size, weight = 'bold') => `${weight} ${size}px ${MONO}`;

const add = (parent, geometry, material, x = 0, y = 0, z = 0) => {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
};

const REST = {
  x: 0, z: 0, ry: 0, lift: 0, drop: -.03, lean: 0, twist: 0, side: 0,
  nod: 0, turn: 0, tilt: 0, brow: 0, grin: 0, shades: 0,
  // Each hand: its target in root space, wrist pitch, curl (0 flat, 1 fist),
  // index finger out (1 points) and how hard it hammers the keys.
  rhx: -.3, rhy: 2.12, rhz: .74, rw: .5, rc: .45, ri: 0, rt: 0,
  lhx: .3, lhy: 2.12, lhz: .74, lw: .5, lc: .45, li: 0, lt: 0,
  rfx: 0, rfy: 0, rfz: 0, lfx: 0, lfy: 0, lfz: 0,
};
export const pose = values => ({ ...REST, ...values });

export function createHacker(textures) {
  const standard = (color, roughness = .8, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness });
  const hoodie = standard(0x1b1e20, .9);
  const hoodieDark = standard(0x0e1011, .95);
  const string = standard(0xc8ccc8, .7);
  const skin = standard(0xe2b898, .6);
  const hair = standard(0x140d08, .85);
  const denim = standard(0x26324a, .9);
  const sneaker = standard(0xe9e9e4, .6);
  const sole = standard(0x3a3a3a, .9);
  const frame = standard(0x0b0b0b, .25, .4);
  const glove = standard(0x2a2a2c, .45, .3);
  const gloveTrim = standard(0x8d9094, .4, .6);
  const mouthDark = standard(0x2a0f0f, .9);
  const teeth = standard(0xf2f0e8, .5);

  const root = new Group();
  const pelvis = new Group();
  root.add(pelvis);
  add(pelvis, new CylinderGeometry(.3, .28, .3, 20), denim).scale.z = .8;
  add(pelvis, new CylinderGeometry(.305, .305, .06, 20), sole, 0, .14).scale.z = .8;

  const spine = new Group();
  spine.position.y = .08;
  pelvis.add(spine);
  const torso = add(spine, new CylinderGeometry(.4, .33, 1, 22), hoodie, 0, .5);
  torso.scale.z = .74;
  add(spine, new SphereGeometry(.4, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), hoodie, 0, 1).scale.set(1, .42, .74);
  add(spine, new CylinderGeometry(.345, .33, .12, 22), hoodieDark, 0, .02).scale.z = .76;
  add(spine, new BoxGeometry(.42, .2, .04), hoodieDark, 0, .3, .27).rotation.x = -.08;
  [-1, 1].forEach(side => {
    const cord = add(spine, new CylinderGeometry(.012, .012, .28, 6), string, side * .07, .82, .3);
    cord.rotation.x = -.12;
    add(spine, new SphereGeometry(.022, 8, 6), string, side * .07, .68, .315);
  });
  const hood = add(spine, new TorusGeometry(.2, .085, 10, 24), hoodieDark, 0, 1.03, -.16);
  hood.rotation.x = 1.25;
  hood.scale.set(1.15, 1, .8);
  add(spine, new CylinderGeometry(.1, .11, .22, 14), skin, 0, 1.12);

  const head = new Group();
  head.position.y = 1.2;
  spine.add(head);
  add(head, new SphereGeometry(.29, 28, 20), skin, 0, .32).scale.set(.92, 1.12, 1);
  add(head, new SphereGeometry(.17, 20, 14), skin, 0, .13, .1).scale.set(1, .8, 1);
  [-1, 1].forEach(side => {
    add(head, new SphereGeometry(.07, 12, 10), skin, side * .265, .31).scale.set(.5, 1, .8);
    add(head, new BoxGeometry(.03, .14, .07), hair, side * .262, .3, .07);
  });
  add(head, new BoxGeometry(.06, .09, .06), skin, 0, .27, .29).rotation.x = -.25;
  // The mullet: a cap, a swept front and the long back.
  add(head, new SphereGeometry(.31, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, .38, -.01).scale.set(1, .9, 1.06);
  add(head, new SphereGeometry(.18, 18, 12), hair, .02, .6, .15).scale.set(1.55, .62, 1);
  add(head, new SphereGeometry(.25, 18, 14), hair, 0, .12, -.17).scale.set(1.3, 1.45, .66);
  [-1, 1].forEach(side => add(head, new SphereGeometry(.12, 14, 10), hair, side * .2, -.02, -.22).scale.set(.8, 1.4, .9));

  const brows = [-1, 1].map(side => add(head, new BoxGeometry(.13, .03, .03), hair, side * .13, .49, .265));

  const shades = new Group();
  shades.position.set(0, .37, .275);
  head.add(shades);
  add(shades, new BoxGeometry(.58, .035, .05), frame, 0, .045);
  add(shades, new BoxGeometry(.06, .025, .04), frame, 0, .01);
  [-1, 1].forEach(side => {
    const temple = add(shades, new BoxGeometry(.022, .03, .3), frame, side * .285, .04, -.15);
    temple.rotation.y = side * -.06;
  });
  // The lenses mirror his screens: dim scrolling code, and a glint that
  // sweeps across when he is pleased with himself.
  const reflection = paint(textures, 128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#020a04';
    ctx.fillRect(0, 0, w, h);
    ctx.font = font(18);
    for (let row = 0; row < 14; row++) {
      ctx.fillStyle = `rgba(57,255,106,${(.18 + hash(row, 3) * .35).toFixed(2)})`;
      let line = '';
      for (let i = 0; i < 9; i++) line += GLYPHS[Math.floor(hash(row, i) * GLYPHS.length)];
      ctx.fillText(line, 4, 16 + row * 18);
    }
  });
  reflection.wrapT = RepeatWrapping;
  reflection.repeat.set(1, .5);
  const lensMaterial = lit(0xffffff, 1, reflection, false);
  const glint = paint(textures, 128, 64, (ctx, w, h) => {
    const sweep = ctx.createLinearGradient(0, 0, w, 0);
    sweep.addColorStop(0, 'rgba(255,255,255,0)');
    sweep.addColorStop(.42, 'rgba(255,255,255,0)');
    sweep.addColorStop(.5, 'rgba(255,255,255,1)');
    sweep.addColorStop(.58, 'rgba(255,255,255,0)');
    sweep.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, w, h);
  });
  glint.repeat.set(.34, 1);
  const glintMaterial = lit(PALE, 1, glint);
  const lenses = [-1, 1].map(side => {
    const lens = new Group();
    lens.position.set(side * .14, -.01, .01);
    lens.rotation.y = side * .16;
    shades.add(lens);
    add(lens, new BoxGeometry(.25, .13, .025), frame).position.z = -.01;
    add(lens, new PlaneGeometry(.235, .115), lensMaterial, 0, 0, .004);
    add(lens, new PlaneGeometry(.235, .115), glintMaterial, 0, 0, .006);
    return lens;
  });

  const mouth = new Group();
  mouth.position.set(0, .16, .27);
  head.add(mouth);
  const smirk = add(mouth, new BoxGeometry(.13, .022, .02), mouthDark, .015);
  const open = new Group();
  mouth.add(open);
  add(open, new SphereGeometry(.075, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mouthDark).scale.set(1.45, 1, .35);
  add(open, new BoxGeometry(.17, .03, .02), teeth, 0, -.012, .012);

  const arms = [-1, 1].map(side => {
    const right = side < 0;
    const sleeve = hoodie;
    const palm = right ? glove : skin;
    const arm = new Group();
    arm.position.set(side * .43, .98, 0);
    spine.add(arm);
    add(arm, new SphereGeometry(.14, 16, 12), sleeve);
    add(arm, new CylinderGeometry(.12, .1, UPPER, 14), sleeve, 0, -UPPER / 2);
    const elbow = new Group();
    elbow.position.y = -UPPER;
    arm.add(elbow);
    add(elbow, new SphereGeometry(.1, 12, 10), sleeve);
    add(elbow, new CylinderGeometry(.1, .085, FORE, 14), sleeve, 0, -FORE / 2);
    add(elbow, new CylinderGeometry(.09, .09, .08, 14), hoodieDark, 0, -FORE + .05);
    let pad = null;
    if (right) {
      // The gauntlet: a chunky cuff with a keypad and a light bar.
      add(elbow, new BoxGeometry(.24, .26, .22), glove, 0, -FORE + .1);
      add(elbow, new BoxGeometry(.25, .04, .23), gloveTrim, 0, -FORE + .24);
      const keys = paint(textures, 64, 64, (ctx, w) => {
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, w, w);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#9a9a9a' : '#d8d8d8';
          ctx.fillRect(6 + c * 19, 6 + r * 19, 14, 14);
        }
      });
      const keypad = add(elbow, new PlaneGeometry(.17, .17), new MeshBasicMaterial({ map: keys }), 0, -FORE + .1, .111);
      keypad.castShadow = false;
      pad = add(elbow, new BoxGeometry(.2, .03, .02), lit(INK, 1, null, false), 0, -FORE + .195, .112);
    }
    const hand = new Group();
    hand.position.y = -FORE;
    elbow.add(hand);
    add(hand, new BoxGeometry(.15, .15, .075), palm, 0, -.075);
    const fingers = new Group();
    fingers.position.set(side * -.012, -.15, 0);
    hand.add(fingers);
    add(fingers, new BoxGeometry(.11, .13, .06), palm, side * -.012, -.065);
    const index = new Group();
    index.position.set(side * .052, -.15, 0);
    hand.add(index);
    add(index, new BoxGeometry(.035, .15, .04), palm, 0, -.075);
    const tip = new Object3D();
    tip.position.y = -.16;
    index.add(tip);
    const thumb = new Group();
    thumb.position.set(side * .065, -.04, .035);
    hand.add(thumb);
    add(thumb, new BoxGeometry(.04, .1, .045), palm, 0, -.045).rotation.z = side * -.3;
    const grip = new Object3D();
    grip.position.set(0, -.13, .09);
    hand.add(grip);
    return { side, arm, elbow, hand, fingers, index, thumb, tip, grip, pad };
  });

  const legs = [-1, 1].map(side => {
    const hip = new Group();
    hip.position.set(side * .16, -.08, 0);
    pelvis.add(hip);
    add(hip, new SphereGeometry(.14, 12, 10), denim);
    add(hip, new CylinderGeometry(.13, .11, THIGH, 14), denim, 0, -THIGH / 2);
    const knee = new Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    add(knee, new SphereGeometry(.11, 12, 10), denim);
    add(knee, new CylinderGeometry(.11, .1, SHIN, 14), denim, 0, -SHIN / 2);
    const ankle = new Group();
    ankle.position.y = -SHIN;
    knee.add(ankle);
    add(ankle, new BoxGeometry(.2, .13, .4), sneaker, 0, -.065, .08);
    add(ankle, new BoxGeometry(.22, .035, .43), sole, 0, -.125, .08);
    add(ankle, new BoxGeometry(.205, .03, .12), sole, 0, -.02, .2);
    return { hip, knee, ankle };
  });

  const ik = {
    local: new Vector3(), reach: new Vector3(), r: new Vector3(), n: new Vector3(), x: new Vector3(), pole: new Vector3(),
    lx: new Vector3(1, 0, 0), lr: new Vector3(), ln: new Vector3(), a: new Matrix4(), b: new Matrix4(),
  };
  const target = new Vector3();

  // Two-bone IK in spine space: lands the wrist on a root-space `goal` with
  // the elbow bowed toward `pole`.
  function reach({ arm, elbow }, goal, pole) {
    const { local, reach: span, r, n, x, lx, lr, ln, a, b } = ik;
    root.localToWorld(local.copy(goal));
    spine.worldToLocal(local);
    span.copy(local).sub(arm.position);
    const d = Math.min(Math.max(span.length(), .3), UPPER + FORE - .001);
    const bend = Math.PI - Math.acos((UPPER * UPPER + FORE * FORE - d * d) / (2 * UPPER * FORE));
    lr.set(0, -(UPPER + FORE * Math.cos(bend)), FORE * Math.sin(bend)).normalize();
    ln.crossVectors(lx, lr);
    r.copy(span).normalize();
    n.copy(pole).addScaledVector(r, -pole.dot(r)).normalize();
    x.crossVectors(r, n);
    arm.quaternion.setFromRotationMatrix(a.makeBasis(x, r, n).multiply(b.makeBasis(lx, lr, ln).transpose()));
    elbow.rotation.set(-bend, 0, 0);
  }

  function plantLeg({ hip, knee, ankle }, fx, fy, fz) {
    const hx = hip.position.x, hy = pelvis.position.y + hip.position.y, hz = pelvis.position.z;
    const dy = hy - (fy + ANKLE), dz = fz - hz, dx = fx - hx;
    const d = Math.min(Math.max(Math.hypot(dy, dz), .3), THIGH + SHIN - .001);
    const bend = Math.PI - Math.acos((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN));
    const lift = Math.acos(Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)));
    hip.rotation.set(-(Math.atan2(dz, dy) + lift), 0, Math.atan2(dx, d));
    knee.rotation.x = bend;
    ankle.rotation.set(-(hip.rotation.x + bend), 0, -hip.rotation.z);
  }

  return {
    root, spine, head, arms, shades,
    apply(p, t) {
      root.position.set(p.x, p.lift, p.z);
      root.rotation.set(0, p.ry, 0);
      pelvis.position.set(0, HIP + p.drop, 0);
      pelvis.rotation.y = p.twist * .4;
      spine.rotation.set(p.lean, p.twist * .6, p.side);
      head.rotation.set(p.nod, p.turn, p.tilt);
      brows.forEach((brow, i) => {
        brow.position.y = .49 + p.brow * .04;
        brow.rotation.z = (i ? -1 : 1) * p.brow * -.18;
      });
      shades.position.y = .37 + p.shades * .05;
      smirk.visible = p.grin < .35;
      open.visible = !smirk.visible;
      open.scale.set(1, .5 + p.grin * .7, 1);
      root.updateMatrixWorld(true);
      for (const limb of arms) {
        const r = limb.side < 0;
        // Typing hands hammer the keys out of step with each other.
        const beat = Math.max(0, Math.sin(t * 38 + (r ? 0 : Math.PI) + Math.sin(t * 7) * 1.4));
        const typing = r ? p.rt : p.lt;
        const hop = beat * .07 * typing;
        const shuffle = Math.sin(t * 11 + (r ? 0 : 2)) * .08 * typing;
        target.set((r ? p.rhx : p.lhx) + shuffle, (r ? p.rhy : p.lhy) + hop, r ? p.rhz : p.lhz);
        ik.pole.set(limb.side * .7, -1, -.45);
        reach(limb, target, ik.pole);
        limb.hand.rotation.set(r ? p.rw : p.lw, 0, 0);
        const curl = r ? p.rc : p.lc, point = r ? p.ri : p.li;
        limb.fingers.rotation.x = curl * 1.7 + beat * .3 * typing;
        limb.index.rotation.x = mix(curl * 1.6, 0, point);
        limb.thumb.rotation.x = curl * .9;
      }
      plantLeg(legs[0], -.2 + p.rfx, p.rfy, p.rfz);
      plantLeg(legs[1], .2 + p.lfx, p.lfy, p.lfz);
      root.updateMatrixWorld(true);
    },
    // The reflection scrolls with his screens; the glint sweeps at `glinting`
    // 0 -> 1, from off one side to off the other.
    lenses(t, glinting) {
      reflection.offset.y = -t * .35;
      glint.offset.x = mix(-.6, 1.3, glinting);
    },
    gauntlet(t, flash = 0) {
      const pad = arms[0].pad;
      pad.material.opacity = .55 + .45 * Math.max(flash, (Math.sin(t * 9) + 1) / 2 * .5);
    },
    grip(index, out) { return arms[index].grip.getWorldPosition(out); },
    tip(index, out) { return arms[index].tip.getWorldPosition(out); },
  };
}

// A chunky floating keyboard: dark slab, glowing keycaps, a big Enter key on
// the right that the PR scene slams.
export function createKeyboard(textures) {
  const group = new Group();
  const deck = new Group();
  group.add(deck);
  add(deck, new BoxGeometry(1.5, .09, .5), new MeshStandardMaterial({ color: 0x232527, roughness: .6, metalness: .2 }));
  const caps = paint(textures, 512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#050805';
    ctx.fillRect(0, 0, w, h);
    const rows = [14, 13, 12, 10];
    rows.forEach((count, r) => {
      const width = (w - 120) / 14;
      for (let c = 0; c < count; c++) {
        ctx.fillStyle = `rgba(57,255,106,${(.35 + hash(r, c) * .3).toFixed(2)})`;
        ctx.fillRect(10 + r * 8 + c * width, 10 + r * 36, width - 6, 28);
      }
    });
    ctx.fillStyle = 'rgba(57,255,106,.4)';
    ctx.fillRect(110, 10 + 4 * 36 - 4, 200, 10);
  });
  const face = add(deck, new PlaneGeometry(1.38, .43), lit(0xffffff, .95, caps, false), .05, .047);
  face.rotation.x = -Math.PI / 2;
  face.castShadow = false;
  // Enter sits under the typist's right hand, which is root -x.
  const enter = new Group();
  enter.position.set(-.66, .05, .02);
  deck.add(enter);
  const enterCap = add(enter, new BoxGeometry(.14, .06, .3), lit(PALE, 1, null, false), 0, .03);
  enterCap.castShadow = false;
  // Keys that light as they are struck.
  const sparks = Array.from({ length: 8 }, (_, i) => {
    const key = add(deck, new BoxGeometry(.075, .02, .075), lit(PALE, 0), -.6 + hash(i, 1) * 1.15, .065, -.17 + hash(i, 2) * .34);
    key.castShadow = false;
    return key;
  });
  const under = add(group, new PlaneGeometry(1.9, .8), lit(INK, .35, glowTexture(textures)), 0, -.07);
  under.rotation.x = -Math.PI / 2;
  under.castShadow = false;
  return {
    group, enter,
    update(t, typing, slam = 0) {
      sparks.forEach((key, i) => {
        key.material.opacity = typing * (hash(Math.floor(t * 22), i) > .62 ? 1 : 0);
      });
      enter.position.y = .05 - slam * .04;
      enterCap.material.opacity = .7 + slam * .3;
      under.material.opacity = .3 + typing * .15 + slam * .5;
    },
  };
}

// A floating CRT: a deep casing with a glowing screen the scene draws on.
export function createMonitor(textures, width = 1.5, height = 1.1, draw) {
  const group = new Group();
  const casing = new MeshStandardMaterial({ color: 0x2b2d2c, roughness: .55, metalness: .15 });
  add(group, new BoxGeometry(width + .22, height + .22, .3), casing, 0, 0, .08);
  add(group, new BoxGeometry(width * .8, height * .78, .55), casing, 0, 0, -.3);
  const screen = paint(textures, 512, Math.round(512 * height / width), draw);
  const glass = add(group, new PlaneGeometry(width, height), lit(0xffffff, 1, screen, false), 0, 0, .235);
  glass.castShadow = false;
  const halo = add(group, new PlaneGeometry(width * 2.2, height * 2.4), lit(INK, .18, glowTexture(textures)), 0, 0, -.62);
  halo.castShadow = false;
  return { group, screen, glass, halo };
}

// A burst of lit pixels thrown out from a point.
export function createPixels(scene, count = 40) {
  const shape = new BoxGeometry(.07, .07, .07);
  const materials = [INK, PALE, INK].map(color => lit(color));
  const flecks = Array.from({ length: count }, (_, i) => {
    const mesh = new Mesh(shape, materials[i % 3]);
    scene.add(mesh);
    const a = i * 2.39996, b = Math.acos(1 - 2 * ((i + .5) / count));
    return { mesh, x: Math.sin(b) * Math.cos(a), y: Math.cos(b) * .8 + .4, z: Math.sin(b) * Math.sin(a), speed: .7 + (i % 7) * .22 };
  });
  return {
    burst(t, at, from, power = 1, life = .9) {
      const age = t - at;
      flecks.forEach(({ mesh, x, y, z, speed }, i) => {
        mesh.visible = age > 0 && age < life;
        if (!mesh.visible) return;
        const reach = speed * power;
        mesh.position.set(from.x + x * age * reach * 3.2, from.y + y * age * reach * 2.8 - age * age * 2.6, from.z + z * age * reach * 2.2);
        mesh.scale.setScalar((1 - clamp(age / life)) * (1 + (i % 3) * .5) * power ** .5);
      });
    },
    hide() { flecks.forEach(({ mesh }) => { mesh.visible = false; }); },
  };
}

export function shadowBlob(scene) {
  const blob = new Mesh(new CircleGeometry(.5, 32), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .4, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.scale.set(2, 1.2, 1);
  blob.position.y = .012;
  scene.add(blob);
  return blob;
}
