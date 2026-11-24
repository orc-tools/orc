// The dino cast for Yeet, PR opened, Plan reveal and All settled: a chubby
// T-rex whose arms cannot reach anything. It is locked out of a park kiosk
// whose keyboard it cannot reach and headbutts the terminal away, hatches out
// of an egg, pecks the plan into a stone tablet with a chisel in its teeth,
// and stomps under lava fireworks before a nap.
import {
  BoxGeometry, CapsuleGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, SphereGeometry, Sprite, SpriteMaterial,
  TorusGeometry, Vector3,
} from 'three';
import { back, clamp, createStage, mix, pulse, range, smooth, wobble } from '../../ui/yeet/stage.js';
import { arc, drawParticles, keyframes, paint, particles, sample, spray, wrap } from '../../ui/yeet/cast.js';
import { CLEAR_LANDS, createFireworks } from '../../ui/yeet/party.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

const HIDE = 0x6cbf43;
const STRIPE = 0x3d8f38;
const BELLY = 0xf6e9b8;
const PLATE = 0xf0803c;
const INK = 0x23160f;
const FONT = 'Rockwell,"Rockwell Nova","Roboto Slab","Arial Black",ui-rounded,system-ui,sans-serif';
const ROCKS = [0xcfc4ae, 0x9c917e, 0xe6dcc8, 0x7d7364];
const LAVA = [0xff7a2e, 0xffb347, 0xffe08a, 0xff4d2e];
const LEAVES = [0x6cbf43, 0x9bd65a, 0x3d8f38];
const SHELL = [0xfff6dc, 0xf1e3bd, 0xffffff];
const TAU = Math.PI * 2;

const BASE = {
  x: 0, y: 0, z: 0, ry: 0, rx: 0, rz: 0, s: 0, w: 0,
  nod: 0, turn: 0, tilt: 0, jaw: 0,
  arm: .15, flail: 0, ll: 0, rl: 0, stomp: 0,
  tail: .4, swish: .3,
  open: 1, happy: 0, pupil: 0, lx: 0, ly: 0, brow: 0, blush: .3,
};

// A three-toed track: a heel pad and three clawed toes fanned ahead of it.
function printPath(ctx, x, y, size) {
  const s = size / 100;
  ctx.beginPath();
  ctx.ellipse(x, y + 26 * s, 15 * s, 17 * s, 0, 0, TAU);
  ctx.fill();
  [[-.62, 30], [0, 42], [.62, 30]].forEach(([angle, length]) => {
    ctx.save();
    ctx.translate(x, y + 18 * s);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-8.5 * s, 0);
    ctx.quadraticCurveTo(-10 * s, -length * s * .75, 0, -(length + 16) * s);
    ctx.quadraticCurveTo(10 * s, -length * s * .75, 8.5 * s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

// White shapes, tinted per sprite, so one texture serves every colour.
function dinoTextures() {
  const print = paint(128, 128, ctx => {
    ctx.fillStyle = '#fff';
    printPath(ctx, 64, 62, 104);
  });
  const chip = paint(64, 64, ctx => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    [[8, 30], [26, 6], [54, 14], [58, 40], [34, 58], [14, 50]].forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath();
    [[26, 6], [54, 14], [34, 30]].forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.fill();
  });
  const ember = paint(128, 128, ctx => {
    const shine = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    shine.addColorStop(0, 'rgba(255,255,255,1)');
    shine.addColorStop(.25, 'rgba(255,255,255,.75)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, 128, 128);
  });
  const leaf = paint(128, 128, ctx => {
    ctx.fillStyle = '#fff';
    ctx.translate(64, 64);
    ctx.rotate(-.6);
    for (let i = -4; i <= 4; i++) {
      ctx.save();
      ctx.translate(i * 11, 0);
      ctx.rotate(i * .08);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 26 - Math.abs(i) * 4, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillRect(-52, -2, 104, 4);
  });
  const dust = paint(128, 128, ctx => {
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    [[50, 70, 30], [80, 62, 26], [66, 46, 24]].forEach(([x, y, r]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    });
  });
  return { print, chip, ember, leaf, dust, list: [print, chip, ember, leaf, dust] };
}

// The stage is lit for a green orc under a swamp sky; the rex gets warm
// sunlight from the front and the volcano's glow behind it.
function volcanoStage(stage) {
  stage.scene.traverse(light => {
    if (light.isHemisphereLight) {
      light.color.set(0xfff2d0);
      light.groundColor.set(0x4a2a14);
    } else if (light.isAmbientLight) light.color.set(0xffe9c4);
    else if (light.isDirectionalLight && light !== stage.key) light.color.set(light.position.z < 0 ? 0xff8a3c : 0xb8e68a);
  });
  stage.key.color.set(0xfff0d2);
  stage.glow.color.set(0xff7a2e);
}

function blobShadow(scene, opacity = .3) {
  const shadow = new Mesh(new CircleGeometry(1, 40), new MeshBasicMaterial({ color: 0x2a1a0c, transparent: true, opacity, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  return shadow;
}

const FOOT_X = .66;

// Faces +z. Its arms are far too short to reach past its own snout, which
// every scene below leans on.
function createRex(size = 1) {
  const round = new SphereGeometry(1, 30, 22);
  const bead = new SphereGeometry(1, 12, 9);
  const cone = new ConeGeometry(1, 1, 10);
  const hide = new MeshStandardMaterial({ color: HIDE, roughness: .78 });
  const stripe = new MeshStandardMaterial({ color: STRIPE, roughness: .8 });
  const belly = new MeshStandardMaterial({ color: BELLY, roughness: .85 });
  const plate = new MeshStandardMaterial({ color: PLATE, roughness: .6 });
  const ink = new MeshStandardMaterial({ color: INK, roughness: .25 });
  const white = new MeshStandardMaterial({ color: 0xfffbea, roughness: .35 });
  const gum = new MeshStandardMaterial({ color: 0x8f1f2e, roughness: .6 });
  const tongueMaterial = new MeshStandardMaterial({ color: 0xff7d8f, roughness: .5 });
  const shine = new MeshBasicMaterial({ color: 0xffffff });
  const blush = new MeshBasicMaterial({ color: 0xff7a4a, transparent: true, opacity: .4, depthWrite: false });

  function add(parent, geometry, material, [x, y, z], [sx, sy, sz] = [1, 1, 1], cast = true) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = cast;
    parent.add(mesh);
    return mesh;
  }
  function group(parent, x = 0, y = 0, z = 0) {
    const node = new Group();
    node.position.set(x, y, z);
    parent.add(node);
    return node;
  }

  const root = new Group();
  root.scale.setScalar(size);
  const lift = group(root);
  const hips = group(lift, 0, 1, 0);
  add(hips, round, hide, [0, .5, 0], [1.02, 1.12, .98]);
  add(hips, round, belly, [0, .4, .42], [.78, .9, .62]);
  [[-.34, 1.08, -.6], [.38, .72, -.8], [-.24, .3, -.88], [.3, 1.3, -.42]].forEach(at => add(hips, bead, stripe, at, [.24, .2, .12], false));
  // Plates down the spine, each standing off the back along its normal.
  [.35, .8, 1.25, 1.7].forEach((a, i) => {
    const spike = add(hips, cone, plate, [0, .5 + Math.cos(a) * 1.24, -Math.sin(a) * 1.1], [.14, .36 - i * .03, .09]);
    spike.rotation.x = -a;
  });
  [-1, 1].forEach(side => add(hips, round, hide, [side * .74, -.1, .08], [.42, .58, .54]));

  const feet = [-1, 1].map(side => {
    const foot = group(lift, side * FOOT_X, 0, .28);
    add(foot, round, hide, [0, .2, .12], [.36, .2, .56]);
    [-.2, 0, .2].forEach(dx => {
      const claw = add(foot, cone, white, [dx, .12, .7], [.07, .18, .07]);
      claw.rotation.x = Math.PI / 2;
    });
    return foot;
  });

  const arms = [-1, 1].map(side => {
    const shoulder = group(hips, side * .52, .84, .88);
    add(shoulder, new CapsuleGeometry(.095, .26, 4, 10), hide, [0, -.18, 0]);
    [-.055, .055].forEach(dx => {
      const claw = add(shoulder, cone, white, [dx, -.44, .02], [.035, .12, .035], false);
      claw.rotation.x = Math.PI;
    });
    return shoulder;
  });

  const tailBase = group(hips, 0, .12, -.8);
  const tail = [];
  let joint = tailBase;
  for (let i = 0; i < 6; i++) {
    joint = group(joint, 0, i ? .34 : 0, 0);
    const girth = .44 - i * .065;
    add(joint, round, hide, [0, .16, 0], [girth, .3, girth]);
    if (i && i < 5) {
      const spike = add(joint, cone, plate, [0, .16, -girth * .9], [.08, .22 - i * .03, .06]);
      spike.rotation.x = -Math.PI / 2;
    }
    tail.push(joint);
  }

  const neck = group(hips, 0, 1.25, .2);
  const head = group(neck);
  add(head, round, hide, [0, .62, .12], [.95, .82, .92]);
  add(head, round, hide, [0, .47, .98], [.57, .4, .78]);
  [-1, 1].forEach(side => {
    add(head, bead, hide, [side * .2, .74, 1.5], [.11, .09, .12], false);
    add(head, bead, ink, [side * .22, .76, 1.6], [.04, .035, .03], false);
    add(head, round, hide, [side * .5, 1.2, .46], [.3, .2, .3]);
  });
  add(head, round, gum, [0, .3, .8], [.44, .16, .56], false);
  [.2, .75].forEach((a, i) => {
    const spike = add(head, cone, plate, [0, .62 + Math.cos(a) * .92, .12 - Math.sin(a) * 1.02], [.12, .3 - i * .04, .08]);
    spike.rotation.x = -a;
  });
  // Teeth ring the front of each jaw: the upper row hangs, the lower stands.
  const fangs = (parent, y, reach, depth, flip) => {
    for (let k = -3; k <= 3; k++) {
      const a = k * .36;
      const fang = add(parent, cone, white, [Math.sin(a) * reach, y, depth + Math.cos(a) * reach * 1.05], [.05, .15, .05], false);
      if (flip) fang.rotation.x = Math.PI;
    }
  };
  fangs(head, .2, .49, 1.0, true);
  const jaw = group(head, 0, .3, .3);
  add(jaw, round, hide, [0, -.1, .62], [.5, .2, .72]);
  add(jaw, round, belly, [0, -.2, .58], [.4, .12, .6], false);
  add(jaw, round, tongueMaterial, [0, .04, .57], [.32, .07, .52], false);
  fangs(jaw, .1, .41, .66, false);

  const eyes = [-1, 1].map(side => {
    const socket = group(head, side * .52, .96, .56);
    socket.rotation.y = side * .5;
    const ball = group(socket);
    add(ball, round, white, [0, 0, 0], [.24, .26, .2], false);
    const iris = group(ball, 0, 0, .15);
    add(iris, round, ink, [0, 0, 0], [.14, .17, .07], false);
    add(iris, bead, shine, [.05, .07, .06], [.05, .05, .03], false);
    const closed = add(socket, new TorusGeometry(.16, .035, 8, 20, Math.PI), ink, [0, -.05, .2], [1, 1, 1], false);
    const lid = add(socket, new BoxGeometry(.36, .07, .12), stripe, [0, .27, .17], [1, 1, 1], false);
    return { ball, iris, closed, lid, side };
  });
  const cheek = new SphereGeometry(1, 14, 10);
  const blushes = [-1, 1].map(side => add(head, cheek, blush, [side * .72, .52, .78], [.16, .1, .06], false));

  const point = (x, y, z) => {
    const node = new Object3D();
    node.position.set(x, y, z);
    head.add(node);
    return node;
  };
  const crown = point(0, 1.42, .1);
  const forehead = point(0, 1.02, 1.12);
  const mouth = point(0, .26, 1.66);

  const rex = {
    size, root, lift, hips, head, jaw, crown, forehead, mouth, tailBase,
    // An egg only has room for the top half.
    hatchling() {
      tailBase.visible = false;
      feet.forEach(foot => { foot.visible = false; });
    },
    pose(p, t) {
      root.position.set(p.x, p.y, p.z);
      root.rotation.set(0, p.ry, 0);
      const xz = (1 - p.s * .5) * (1 + p.w);
      lift.scale.set(xz, 1 + p.s + Math.sin(t * 2.6) * .012, xz);
      // `stomp` treads the feet in turn and rocks the hips over each one.
      const step = Math.sin(t * 15);
      const lifts = [p.ll + Math.max(0, step) * p.stomp, p.rl + Math.max(0, -step) * p.stomp];
      hips.position.y = 1 + (lifts[0] + lifts[1]) * .05;
      hips.rotation.set(p.rx, 0, p.rz + step * p.stomp * .1);
      feet.forEach((foot, i) => {
        foot.position.y = lifts[i] * .55;
        foot.rotation.x = -lifts[i] * .5;
      });
      neck.rotation.set(0, p.turn * .35, -p.rz * .5);
      head.rotation.set(p.nod, p.turn * .65, p.tilt);
      arms.forEach((shoulder, i) => {
        const side = i ? 1 : -1;
        const paddle = Math.sin(t * 38 + i * Math.PI) * p.flail;
        shoulder.rotation.set(-(.45 + p.arm * 1.55) + paddle * .5, 0, side * (.18 + Math.abs(paddle) * .3));
      });
      tailBase.rotation.set(-Math.PI / 2 + .2 + p.tail * .5, 0, Math.sin(t * 4.2) * p.swish * .4 + step * p.stomp * .22);
      tail.forEach((node, i) => {
        if (i) node.rotation.set(.13 + p.tail * .07, 0, Math.sin(t * 4.2 - i * .7) * p.swish * .22);
      });
      const happy = p.happy > .5;
      const open = Math.max(.08, clamp(p.open));
      eyes.forEach(({ ball, iris, closed, lid, side }) => {
        ball.visible = !happy;
        closed.visible = happy;
        ball.scale.set(1, open, 1);
        iris.position.set(p.lx * .08, p.ly * .07, .15);
        iris.scale.setScalar(1 + p.pupil * .3);
        lid.rotation.z = side * p.brow * .5;
        lid.position.y = .27 - Math.abs(p.brow) * .06;
      });
      jaw.rotation.x = clamp(p.jaw) * .72;
      blush.opacity = .15 + clamp(p.blush) * .5;
      blushes.forEach(spot => spot.scale.set(.16 * (1 + p.blush * .25), .1, .06));
    },
  };
  return rex;
}

function setShadow(shadow, rex, ground = 0, strength = .3) {
  const height = Math.max(0, rex.root.position.y - ground);
  shadow.position.set(rex.root.position.x, ground + .01, rex.root.position.z + .1);
  shadow.scale.set(1.5, 1.1, 1).multiplyScalar(rex.size * (1 - clamp(height / 2) * .45));
  shadow.material.opacity = strength * range(rex.root.position.y, ground - 1, ground) * (1 - clamp(height / 2) * .6);
}

// A roar you can see: rings leave the mouth one after another and widen
// towards the viewer as they fade.
function roarRings(scene, camera, count = 3) {
  const rings = Array.from({ length: count }, () => {
    const ring = new Mesh(new TorusGeometry(1, .05, 5, 40), new MeshBasicMaterial({ color: 0xffb347, transparent: true, depthWrite: false, toneMapped: false }));
    ring.visible = false;
    scene.add(ring);
    return ring;
  });
  const from = new Vector3();
  return (t, at, rex) => {
    rex.mouth.getWorldPosition(from);
    rings.forEach((ring, i) => {
      const age = t - at - i * .11;
      ring.visible = age > 0 && age < .55;
      if (!ring.visible) return;
      const u = age / .55;
      ring.position.copy(from);
      ring.position.z += .2 + u * 1.6;
      ring.quaternion.copy(camera.quaternion);
      ring.scale.setScalar(.25 + u * 1.7);
      ring.material.opacity = (1 - u) * .75;
    });
  };
}


const LANDS = 3.32;
const ROAR = 3.86;
const LOCKOUT = 1.9;
// One wag of the finger, and one AH.
const WAG = .17;
// Where the overlay's torn page balls up, in halves of the view from its
// centre: scene-poses.js moves it 17% across and 5% up.
const GATHER = [.34, .1];
// Where the terminal's flight ends: a point of the view, as GATHER is, and
// its depth. A fixed point in the scene would leave a phone's screen.
const FAR = [.5, .42, -30];
const KIOSK = { turn: -.5, size: 1.15, x: [1.3, 2.4], y: [2.45, 2.8] };
const PHOSPHOR = '#7dff9a';
const SKIN = '#f2c29b';
const SHIRT = '#2f9fc4';
const KEYCAPS = [0xe8dfc8, 0xbfb59b, 0x5b564a, 0xffe08a];

// The lockout screen, after the one in the film: a cartoon in glasses and a
// loud shirt wags a finger beside rows of the same line. `wag` is -1 or 1.
function drawLockout(ctx, wag) {
  ctx.fillStyle = '#e9eef2';
  ctx.fillRect(0, 0, 256, 384);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(12, 384);
  ctx.quadraticCurveTo(16, 262, 112, 250);
  ctx.quadraticCurveTo(208, 262, 212, 384);
  ctx.closePath();
  ctx.fillStyle = SHIRT;
  ctx.fill();
  ctx.clip();
  ['#ffd23f', '#57b55a', '#ff7d8f'].forEach((tint, k) => {
    ctx.fillStyle = tint;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse((i * 67 + k * 41 + 20) % 224, 268 + (i * 43 + k * 29) % 110, 15, 8, i + k, 0, TAU);
      ctx.fill();
    }
  });
  ctx.restore();

  ctx.save();
  ctx.translate(112, 252);
  ctx.rotate(wag * .09);
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(0, -84, 68, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#3b2a1e';
  ctx.beginPath();
  ctx.arc(0, -84, 70, Math.PI * 1.1, Math.PI * 1.9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = 6;
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  [-1, 1].forEach(side => {
    ctx.beginPath();
    ctx.arc(side * 28, -88, 20, 0, TAU);
    ctx.fill();
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(-8, -88);
  ctx.lineTo(8, -88);
  ctx.stroke();
  ctx.lineWidth = 5;
  [-1, 1].forEach(side => {
    ctx.beginPath();
    ctx.arc(side * 28, -82, 9, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(0, -64, 30, Math.PI * .16, Math.PI * .84);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(204, 336);
  ctx.rotate(wag * .2);
  ctx.fillStyle = SHIRT;
  ctx.fillRect(-20, -46, 40, 60);
  ctx.fillStyle = SKIN;
  ctx.fillRect(-14, -124, 28, 80);
  ctx.beginPath();
  ctx.arc(0, -134, 23, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-9, -208, 18, 70, 9);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#10161c';
  ctx.fillRect(256, 0, 256, 384);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe08a';
  ctx.font = `bold 66px ${FONT}`;
  ctx.fillText('AH AH', 384, 84);
  ctx.fillText('AH!', 384, 154);
  ctx.textAlign = 'left';
  ctx.fillStyle = PHOSPHOR;
  ctx.font = 'bold 13px ui-monospace,Menlo,monospace';
  for (let i = 0; i < 10; i++) ctx.fillText("YOU DIDN'T SAY THE MAGIC WORD!", 264, 196 + i * 20 + wag * 5);
}

function kioskTextures(title) {
  const idle = paint(512, 384, (ctx, w, h) => {
    ctx.fillStyle = '#0c1a10';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PHOSPHOR;
    ctx.font = 'bold 30px ui-monospace,Menlo,monospace';
    ['RAWR-OS 65.0', '', '> ship', `  ${title.trim().slice(0, 22)}`, '> _'].forEach((line, i) => ctx.fillText(line, 30, 66 + i * 54));
  });
  const denied = [-1, 1].map(wag => paint(512, 384, ctx => drawLockout(ctx, wag)));
  const keys = paint(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#8f8670';
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = (i * 5 + row * 3) % 11 ? '#e8dfc8' : '#bfb59b';
        ctx.fillRect(10 + i * 20, 8 + row * 21, 16, 17);
      }
    }
  });
  const bubble = paint(512, 288, ctx => {
    ctx.fillStyle = '#fffdf2';
    ctx.strokeStyle = '#23160f';
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.roundRect(10, 10, 492, 200, 44);
    ctx.fill();
    ctx.stroke();
    // The tail covers the stretch of outline it grows out of.
    ctx.beginPath();
    ctx.moveTo(300, 204);
    ctx.lineTo(372, 278);
    ctx.lineTo(372, 204);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(300, 210);
    ctx.lineTo(372, 278);
    ctx.lineTo(372, 210);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c8371f';
    ctx.font = `bold 84px ${FONT}`;
    ctx.fillText('AH AH AH!', 256, 114, 440);
    ctx.fillStyle = '#23160f';
    ctx.font = `bold 23px ${FONT}`;
    ctx.fillText("YOU DIDN'T SAY THE MAGIC WORD!", 256, 170, 440);
  });
  return { idle, denied, keys, bubble, list: [idle, ...denied, keys, bubble] };
}

// The point at depth `z` that shows at (x, y) of the view.
function seenAt(camera, x, y, z) {
  const ray = new Vector3(x, y, .5).unproject(camera).sub(camera.position);
  return camera.position.clone().addScaledVector(ray, (z - camera.position.z) / ray.z);
}

// A park kiosk: a beige terminal on a rock column, its screen centred on
// `home`. The terminal is `set`, which the headbutt knocks off the column.
function createKiosk(scene, home, maps) {
  const stone = new MeshStandardMaterial({ color: 0x9a8f78, roughness: .95, flatShading: true });
  const casing = new MeshStandardMaterial({ color: 0xd8ccae, roughness: .6 });
  const trim = new MeshStandardMaterial({ color: 0x8f8670, roughness: .7 });
  const dark = new MeshStandardMaterial({ color: 0x2b2a24, roughness: .5 });
  const height = home.y - .74 * KIOSK.size;
  const column = new Mesh(new CylinderGeometry(.42, .64, height, 7), stone);
  column.position.set(home.x, height / 2, home.z - .08);
  column.castShadow = true;

  const set = new Group();
  const part = (geometry, material, x, y, z) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    set.add(mesh);
    return mesh;
  };
  part(new BoxGeometry(1.5, 1.2, .9), casing, 0, 0, 0);
  part(new BoxGeometry(1.1, .9, .5), casing, 0, 0, -.6);
  part(new BoxGeometry(1.3, 1, .06), dark, 0, 0, .44);
  part(new BoxGeometry(1.4, .14, 1.3), trim, 0, -.67, .2);
  const board = part(new BoxGeometry(1.2, .08, .4), [trim, trim, new MeshStandardMaterial({ map: maps.keys, roughness: .7 }), trim, trim, trim], 0, -.56, .68);
  board.rotation.x = .22;
  const glass = part(new PlaneGeometry(1.2, .9), new MeshBasicMaterial({ map: maps.idle, toneMapped: false }), 0, 0, .475);
  glass.castShadow = false;
  const lamp = part(new SphereGeometry(.035, 8, 6), new MeshBasicMaterial({ color: 0x6cff8a, toneMapped: false }), .7, -.54, .46);
  lamp.castShadow = false;
  set.position.copy(home);
  set.rotation.y = KIOSK.turn;
  scene.add(column, set);
  return { column, set, glass, lamp };
}

// Beats: stomp up through the tear and land with a thud (0.15-1.3), spot the
// kiosk and tread round to it (1.42-1.74), paddle the tiny arms at a keyboard
// they cannot reach (1.8) and jump as the screen locks: AH AH AH (1.9). The
// kiosk swallows the page as it balls up (2.3-2.6), which is one insult too
// many: a stamping, steaming tantrum (2.6-3.05), then rear back (3.17) and
// headbutt the terminal off its column (3.32), watch it go, roar after it
// (3.86) and settle, pleased.
const YEET = keyframes(BASE, [
  [0, { y: -3.7, z: -1.4, ry: .3, s: .3, rx: -.25, nod: -.3, jaw: .7, arm: 1, flail: 1, pupil: .4, tail: .9, swish: .6 }],
  [.15, {}],
  [.6, { y: 1, z: 0, s: .18, rx: -.1 }, 'o'],
  [.9, { y: 0, s: .1, rx: .05, jaw: .3, nod: .05, arm: .5 }, 'i'],
  [.98, { s: -.28, w: .1, rx: .2, jaw: .6, happy: 1, nod: .2, flail: .4, blush: .8 }, 'o'],
  [1.18, { s: .06, w: 0, rx: -.04, jaw: .2, nod: -.05, arm: .15, flail: 0 }],
  [1.3, { s: 0, rx: 0, happy: 0, jaw: 0, blush: .3 }],
  [1.42, { turn: .5, lx: .7, ly: .1, nod: -.1, tilt: .12, pupil: .7 }],
  [1.5, {}],
  [1.74, { ry: .8, turn: .05, tilt: 0, stomp: .5, swish: .8, tail: .7, lx: .2, ly: -.3 }],
  [1.8, { stomp: 0, nod: .22, rx: .2, arm: 1, flail: 1, ly: -.8, pupil: .5 }],
  [LOCKOUT, {}],
  [LOCKOUT + .1, { x: -.25, y: .22, s: .12, rx: -.16, nod: -.2, arm: .6, flail: 0, jaw: .5, pupil: .1, lx: .3, ly: .3 }, 'o'],
  [LOCKOUT + .24, { y: 0, s: -.08 }, 'i'],
  [2.26, { s: 0, rx: 0, nod: -.05, jaw: .3, tilt: -.16, pupil: .5 }],
  [2.46, { tilt: 0, jaw: .7, nod: -.12, pupil: .9, ly: .2 }],
  [2.6, { rx: .22, nod: .1, jaw: 1, brow: 1, arm: 1, flail: 1, stomp: .9, blush: 1, pupil: .2, tail: 1, swish: 1, s: .06 }],
  [3.05, {}],
  [3.17, { x: -.15, ry: .95, rx: -.42, nod: -.3, s: .08, arm: .3, flail: 0, stomp: 0, jaw: .2, pupil: 1 }],
  [LANDS, { x: .5, ry: .8, rx: .42, nod: .15, s: -.06, tail: .2, pupil: .3, jaw: 0 }, 'c'],
  [3.5, { x: .3, rx: .15, s: .05 }, 'o'],
  [3.66, { rx: 0, nod: -.3, turn: .15, lx: .5, ly: .8, brow: .2, pupil: .8, arm: .2, blush: .4 }],
  [ROAR, { rx: -.2, nod: -.5, jaw: 1, s: .14, arm: 1, flail: 1, brow: .7, lx: .3, ly: .4, pupil: .2, tail: 1.1, swish: .9 }, 'o'],
  [4.22, { jaw: .9 }],
  [4.42, { x: .1, ry: .25, jaw: .15, nod: -.05, rx: 0, s: 0, turn: -.1, happy: 1, flail: .4, brow: 0, blush: .9, tilt: .16 }],
  [4.95, { tilt: .2 }],
]);

function createDinoYeet(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  volcanoStage(stage);
  const rex = createRex(1.12);
  scene.add(rex.root);
  const shadow = blobShadow(scene);
  const halo = new Mesh(new TorusGeometry(2.3, .024, 5, 64), new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: .3 }));
  scene.add(halo);

  const p = { ...BASE };
  // The track is written with the rex at the centre; `shift` moves the whole
  // act sideways.
  let shift = 0;
  function pose(t) {
    sample(YEET, t, p);
    p.x += shift;
    p.open *= 1 - pulse(t, 1.34, 1.44) - pulse(t, 2.3, 2.38) * .8;
    // The tantrum and the roar each shake the whole animal.
    p.rz += Math.sin(t * 46) * (.045 * pulse(t, 2.56, 3.08) + .03 * pulse(t, ROAR, 4.3));
    p.tilt += Math.sin((t - 4.4) * 5) * .08 * range(t, 4.42, 4.7);
    rex.pose(p, t);
  }

  // The kiosk stands where the headbutt lands, and the whole act slides
  // across so its screen covers the spot where the page balls up: the
  // overlay's papers lie under the canvas, so the page goes into the screen.
  pose(LANDS);
  rex.root.updateMatrixWorld();
  const home = rex.forehead.getWorldPosition(new Vector3()).add(new Vector3(.4, 0, .34));
  camera.updateMatrixWorld();
  const gather = seenAt(camera, GATHER[0], GATHER[1], home.z);
  const far = seenAt(camera, ...FAR);
  shift = Math.min(KIOSK.x[1], Math.max(KIOSK.x[0], gather.x)) - home.x;
  home.x += shift;
  home.y = Math.min(KIOSK.y[1], Math.max(KIOSK.y[0], gather.y));
  halo.position.set(shift, 2.2, -1.8);

  const maps = kioskTextures(title);
  const { column, set, glass, lamp } = createKiosk(scene, home, maps);
  maps.denied.forEach(map => renderer.initTexture(map));
  const ghostMaterial = new MeshBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: .3, depthWrite: false });
  const ghosts = Array.from({ length: 5 }, () => new Mesh(new BoxGeometry(1.5, 1.2, .9), ghostMaterial));
  scene.add(...ghosts);
  const bubble = new Sprite(new SpriteMaterial({ map: maps.bubble, transparent: true, depthWrite: false, toneMapped: false }));
  bubble.position.set(Math.min(home.x + .05, seenAt(camera, 1, 0, home.z + .5).x - 1.45), home.y + 1.5, home.z + .5);
  scene.add(bubble);

  const textures = dinoTextures();
  const twinkle = new Sprite(new SpriteMaterial({ map: textures.ember, color: 0xff7a2e, transparent: true, depthWrite: false, toneMapped: false }));
  const ripple = new Mesh(new TorusGeometry(1, .04, 4, 40), new MeshBasicMaterial({ color: 0xffb347, transparent: true, depthWrite: false, toneMapped: false }));
  const gulp = new Sprite(new SpriteMaterial({ map: textures.ember, color: 0xfff6dc, transparent: true, depthWrite: false, toneMapped: false }));
  gulp.position.set(home.x - .25, home.y, home.z + .6);
  scene.add(twinkle, ripple, gulp);
  const roar = roarRings(scene, camera);

  pose(2.8);
  rex.root.updateMatrixWorld();
  const crown = rex.crown.getWorldPosition(new Vector3());
  const bonk = spray(home.clone().add(new Vector3(-.2, 0, .5)), LANDS - .03, 26, { speed: 3.8, up: .5, depth: 1.4, life: 1.05, size: .34, side: 1, color: KEYCAPS });
  const sparks = spray(new Vector3(home.x, home.y - .6, home.z), LANDS, 12, { speed: 2.2, up: 1.6, depth: .6, life: .7, size: .3, phase: .3, map: textures.ember, color: LAVA });
  const steam = [2.62, 2.78, 2.94].flatMap((at, i) => spray(crown, at, 4, { speed: 1.1, up: 1.9, depth: .3, life: .6, size: .62, gravity: .2, phase: i * .6, map: textures.dust, color: 0xfff6dc }));
  const thud = spray(new Vector3(shift, .2, .9), .93, 14, { speed: 2.6, up: 1.3, depth: .8, life: .85, size: .34, phase: .5 });
  const treads = [1.56, 1.68, 2.66, 2.8, 2.94].flatMap((at, i) => spray(new Vector3(shift + (i % 2 ? 1 : -1) * FOOT_X * 1.12, .1, .9), at, 4, { speed: 1.2, up: .8, depth: .4, life: .5, size: .22, phase: i }));
  const prints = [0, 1, 2, 3].map(i => ({
    at: 4.4 + i * .1, o: new Vector3(shift - .7 + i * .45, 3.9, .8), v: new Vector3((i - 1.5) * .25, .8 + (i % 2) * .3, .2),
    gravity: 0, life: .6, size: .3 + (i % 2) * .08, spin: (i % 2 ? .5 : -.5), map: textures.print, color: LAVA[i % 3],
  }));
  const bits = particles(scene, [...bonk, ...sparks, ...steam, ...thud, ...treads, ...prints], [textures.chip, textures.ember, textures.chip, textures.leaf], [...ROCKS, ...LAVA]);

  function flight(t, target) {
    const s = 1 - Math.exp(-Math.max(0, t - LANDS) * 4.6);
    target.lerpVectors(home, far, s);
    target.y += Math.sin(s * Math.PI) * 1.2;
    return target;
  }

  const camY = camera.position.y;
  function render(t) {
    pose(t);
    const locked = t >= LOCKOUT;
    const thrown = t >= LANDS;
    const wags = (t - LOCKOUT) / WAG;
    glass.material.map = locked ? maps.denied[Math.floor(wags) % 2] : maps.idle;
    lamp.material.color.set(locked ? 0xff4d2e : 0x6cff8a);
    set.visible = t < 4.02;
    if (!thrown) {
      // It bulges on the page it swallows, and rocks with the finger.
      const swallow = pulse(t, 2.28, 2.6) * .1 + wobble(t, 2.6, 22, 7) * .07;
      set.position.copy(home);
      set.rotation.set(0, KIOSK.turn, locked ? Math.sin(wags * Math.PI) * .035 : 0);
      set.scale.set(1 + swallow, 1 - swallow * .8, 1 + swallow).multiplyScalar(KIOSK.size);
    } else {
      const spin = t - LANDS;
      flight(t, set.position);
      set.rotation.set(spin * 8, KIOSK.turn + spin * 11, spin * 6);
      set.scale.setScalar(KIOSK.size * (1 - range(t, 3.82, 4.02)));
    }
    column.rotation.z = wobble(t, LANDS, 18, 5) * .09;
    ghosts.forEach((ghost, i) => {
      const at = t - (i + 1) * .028;
      ghost.visible = thrown && at > LANDS && t < 3.9;
      flight(at, ghost.position);
      ghost.rotation.copy(set.rotation);
      ghost.scale.setScalar(.8 * (1 - i * .17) * (1 - range(t, 3.6, 3.9)));
    });
    bubble.visible = locked && t < LANDS + .08;
    const said = back(range(t, LOCKOUT, LOCKOUT + .16), 2.2) * (1 - range(t, LANDS - .02, LANDS + .08));
    const beat = 1 + Math.abs(Math.sin(wags * Math.PI)) * .05;
    bubble.scale.set(2.5 * said * beat, 1.4 * said * beat, 1);
    bubble.material.rotation = Math.sin(wags * Math.PI) * .04;
    const flashed = pulse(t, 2.36, 2.62);
    gulp.visible = flashed > 0;
    gulp.scale.setScalar(.4 + flashed * 1.6);
    gulp.material.opacity = flashed * .8;

    const pop = range(t, 3.98, 4.12);
    const fade = 1 - range(t, 4.12, 4.45);
    twinkle.visible = ripple.visible = pop > 0 && fade > 0;
    flight(4, twinkle.position);
    twinkle.scale.setScalar(3.4 * back(pop, 2.4) * fade * (1 + Math.sin(t * 30) * .05));
    twinkle.material.opacity = fade;
    ripple.position.copy(twinkle.position);
    ripple.quaternion.copy(camera.quaternion);
    ripple.scale.setScalar(.2 + (1 - (1 - range(t, 3.98, 4.35)) ** 2) * 2.6);
    ripple.material.opacity = (1 - range(t, 4, 4.35)) * .8;
    roar(t, ROAR, rex);
    drawParticles(bits, t);

    setShadow(shadow, rex);
    const emerge = range(t, .12, 1.55);
    halo.material.opacity = .2 * Math.sin(emerge * Math.PI) + .06;
    halo.scale.setScalar(1 + range(t, .2, 1.5) * .4);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + pulse(t, 3.3, 3.7) * 9 + pulse(t, ROAR, 4.3) * 6;
    const impact = pulse(t, LANDS, 3.6) * .04 + pulse(t, ROAR, 4.3) * .02;
    const quake = pulse(t, .9, 1.2) * .07 + pulse(t, 2.6, 3.05) * .025;
    camera.position.x = .25 + Math.sin(t * 90) * impact;
    camera.position.y = camY + Math.sin(t * 75) * quake;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose([...maps.list, ...textures.list]) };
}


const HITS = [1.5, 1.95];
const BURST = 3.05;
const HAT = 3.8;
// The shell splits `split` of the way down from its tip.
const EGG = { rx: 1.16, ry: 1.42, y: 1.44, split: .44 * Math.PI };
const RIM = { y: EGG.y + EGG.ry * Math.cos(EGG.split), r: EGG.rx * Math.sin(EGG.split) };
const SET = 1.25;

// Beats, all inside the egg until the burst: it drops into the nest and thuds
// (0.25-0.9), jolts and cracks on each hit (1.5, 1.95), the cap lifts on two
// eyes that look about (1.95-2.4), the egg rumbles and strains (2.45-3.0),
// then the cap flies off and the rex springs out roaring, arms up (3.05). It
// settles in the shell and the cap comes down on its head as a hat (3.8).
const PR = keyframes(BASE, [
  [0, { y: -.8, s: -.5, w: -.2, arm: .2, tail: 0 }],
  [BURST - .04, {}],
  [3.22, { y: .8, s: .2, w: 0, arm: 1, flail: 1, jaw: 1, nod: -.4, brow: .5, pupil: .2, blush: .8 }, 'o'],
  [3.4, { y: .92, s: .1 }, 'o'],
  [3.68, { y: .32, s: -.12, w: .05, jaw: .7, nod: -.15 }, 'i'],
  [3.8, { y: .36, s: 0, w: 0, jaw: .3, nod: .12, flail: .3, brow: 0, ly: .8, pupil: .8 }, 'o'],
  [3.95, { nod: .2, s: -.06, open: .2 }],
  [4.1, { nod: 0, s: 0, open: 1, jaw: 0, ly: 0, tilt: .14, happy: 1, arm: .7, flail: .5 }],
  [4.6, { tilt: -.12 }],
  [5.1, { tilt: .1 }],
]);

function createDinoPr(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  volcanoStage(stage);
  const textures = dinoTextures();

  const speckled = paint(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fbf1d6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(108,191,67,.5)' : 'rgba(217,98,43,.45)';
      ctx.beginPath();
      ctx.ellipse((i * 97 + 31) % w, (i * 53 + 17) % h, 9 + (i * 7) % 14, 7 + (i * 5) % 9, i, 0, TAU);
      ctx.fill();
    }
  });
  const shellMaterial = new MeshStandardMaterial({ map: speckled, roughness: .5, side: DoubleSide });
  const half = (from, length) => {
    const mesh = new Mesh(new SphereGeometry(1, 30, 16, 0, TAU, from, length), shellMaterial);
    mesh.scale.set(EGG.rx, EGG.ry, EGG.rx);
    mesh.castShadow = true;
    return mesh;
  };
  // Broken edges: a ring of flat shards around each rim, out of step so the
  // two halves mesh while the egg is whole.
  const jagged = (parent, y, flip) => {
    const tooth = new ConeGeometry(.17, .3, 3);
    for (let i = 0; i < 14; i++) {
      const a = (i + (flip ? .5 : 0)) / 14 * TAU;
      const shard = new Mesh(tooth, shellMaterial);
      shard.position.set(Math.sin(a) * RIM.r, y + (flip ? -.13 : .13), Math.cos(a) * RIM.r);
      shard.rotation.set(flip ? Math.PI : 0, a, 0);
      shard.scale.z = .2;
      parent.add(shard);
    }
  };

  // The nest and all in it, sized to fill the frame.
  const set = new Group();
  set.scale.setScalar(SET);
  scene.add(set);
  const egg = new Group();
  set.add(egg);
  const shell = new Group();
  egg.add(shell);
  const lower = half(EGG.split, Math.PI - EGG.split);
  lower.position.y = EGG.y;
  shell.add(lower);
  jagged(shell, RIM.y, false);
  // The cap turns about the middle of its rim, so it lifts like a lid.
  const cap = new Group();
  cap.position.y = RIM.y;
  const dome = half(0, EGG.split);
  dome.position.y = EGG.y - RIM.y;
  cap.add(dome);
  jagged(cap, 0, true);
  shell.add(cap);

  // A crack zigzags across the front under the rim, one stretch per hit.
  const crackMaterial = new MeshBasicMaterial({ color: 0x4a3a22 });
  const onShell = (phi, theta) => new Vector3(
    EGG.rx * 1.006 * Math.sin(theta) * Math.sin(phi), EGG.y + EGG.ry * Math.cos(theta), EGG.rx * 1.006 * Math.sin(theta) * Math.cos(phi),
  );
  const course = [[-.7, .5], [-.5, .56], [-.3, .49], [-.12, .57], [.06, .5], [.24, .58], [.42, .51], [.6, .57], [.78, .5]]
    .map(([phi, theta]) => onShell(phi, theta * Math.PI));
  const basis = new Matrix4();
  const cracks = course.slice(1).map((to, i) => {
    const from = course[i];
    const along = to.clone().sub(from);
    const piece = new Mesh(new BoxGeometry(along.length() + .03, .035, .02), crackMaterial);
    piece.position.copy(from).add(to).multiplyScalar(.5);
    const outward = piece.position.clone().setY(0).normalize();
    along.normalize();
    piece.quaternion.setFromRotationMatrix(basis.makeBasis(along, outward.clone().cross(along), outward));
    piece.visible = false;
    shell.add(piece);
    return piece;
  });

  // All that shows before the hatch: two eyes in the dark under the lifted cap.
  const peekers = [-1, 1].map(side => {
    const eye = new Group();
    eye.position.set(side * .3, RIM.y + .03, RIM.r - .32);
    const white = new Mesh(new SphereGeometry(.2, 16, 12), new MeshBasicMaterial({ color: 0xfffbea }));
    const pupil = new Mesh(new SphereGeometry(.1, 12, 10), new MeshBasicMaterial({ color: INK }));
    pupil.position.z = .14;
    eye.add(white, pupil);
    egg.add(eye);
    return { eye, pupil };
  });

  const twig = new MeshStandardMaterial({ color: 0x7a5230, roughness: .95 });
  const nest = new Mesh(new TorusGeometry(1.42, .24, 7, 20), twig);
  nest.rotation.x = Math.PI / 2;
  nest.scale.z = .8;
  nest.position.y = .2;
  nest.castShadow = true;
  set.add(nest);
  const frond = new MeshStandardMaterial({ color: 0x4f9a3a, roughness: .8, side: DoubleSide });
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU + .3;
    const blade = new Mesh(new ConeGeometry(.2, 1.1, 4), frond);
    blade.position.set(Math.sin(a) * 1.75, .34, Math.cos(a) * 1.5);
    blade.rotation.set(Math.cos(a) * 1.1, 0, -Math.sin(a) * 1.1);
    blade.scale.z = .25;
    set.add(blade);
  }

  const label = paint(512, 200, (ctx, w, h) => {
    ctx.fillStyle = '#b5a98f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.14)' : 'rgba(60,45,25,.12)';
      ctx.fillRect((i * 89) % w, (i * 37) % h, 14 + (i * 7) % 20, 3);
    }
    ctx.textAlign = 'center';
    const carve = (text, y) => {
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.fillText(text, w / 2 + 2, y + 2);
      ctx.fillStyle = '#3d3222';
      ctx.fillText(text, w / 2, y);
    };
    ctx.font = `bold 50px ${FONT}`;
    carve('PULL REQUEST', 70);
    ctx.font = `bold 26px ${FONT}`;
    wrap(title.trim(), 440, 2, ctx.font).forEach((line, i) => carve(line, 118 + i * 34));
    ctx.fillStyle = '#d9622b';
    printPath(ctx, 34, 150, 44);
    printPath(ctx, 478, 150, 44);
  });
  const stone = new MeshStandardMaterial({ color: 0x9a8f78, roughness: .95 });
  const plaque = new Mesh(new BoxGeometry(2.7, 1.05, .16), [stone, stone, stone, stone, new MeshStandardMaterial({ map: label, roughness: .9 }), stone]);
  plaque.position.set(0, .56, 1.72);
  plaque.rotation.x = -.3;
  plaque.castShadow = true;
  set.add(plaque);

  const rex = createRex(.88);
  rex.hatchling();
  egg.add(rex.root);
  const shadow = blobShadow(scene, .32);
  shadow.scale.set(2.3 * SET, 1.7 * SET, 1);

  const top = new Vector3(0, RIM.y + .3, .3).multiplyScalar(SET);
  const seam = new Vector3(0, RIM.y, RIM.r).multiplyScalar(SET);
  const bits = particles(scene, [
    ...spray(seam, HITS[0], 5, { speed: 1.6, up: 1.6, depth: .6, life: .7, size: .26 }),
    ...spray(seam, HITS[1], 7, { speed: 1.9, up: 1.8, depth: .7, life: .75, size: .3, phase: .4 }),
    ...spray(top, BURST - .02, 36, { speed: 4.2, up: 2.6, depth: 1.6, life: 1.2, size: .46, gravity: 2.8 }),
    ...[0, 1, 2, 3, 4, 5].map(i => ({
      at: 4.05 + i * .15, o: new Vector3((i % 3 - 1) * 1.4, 4.6, .5), v: new Vector3(Math.sin(i * 2.1) * .3, .85, .15),
      gravity: 0, life: .8, size: .28 + (i % 3) * .07, spin: i % 2 ? .5 : -.5, map: textures.print, color: LAVA[i % 3],
    })),
  ], [textures.chip, textures.chip, textures.ember], SHELL);
  const ring = new Mesh(new TorusGeometry(1, .06, 6, 48), new MeshBasicMaterial({ color: 0xffb347, transparent: true, depthWrite: false, toneMapped: false }));
  ring.position.set(0, (RIM.y + 1.2) * SET, -.4);
  const flash = new Sprite(new SpriteMaterial({ map: textures.ember, color: 0xffe2b8, transparent: true, depthWrite: false, toneMapped: false }));
  flash.position.set(0, (RIM.y + .9) * SET, -.9);
  scene.add(ring, flash);
  const roar = roarRings(scene, camera);

  const p = { ...BASE };
  const camY = camera.position.y;
  const onHead = new Vector3();
  const headTurn = new Quaternion(), eggTurn = new Quaternion();
  const LID = new Vector3(1, 0, 0), TUMBLE = new Vector3(1, 0, .3).normalize();
  function render(t) {
    const fallIn = range(t, .25, .68);
    const hop = .3 * arc(t, HITS[0], .24) + .45 * arc(t, HITS[1], .3) + .22 * arc(t, BURST, .2);
    const rumble = range(t, 2.45, 3.02) * (t < BURST ? 1 : 0);
    egg.position.set(Math.sin(t * 63) * .04 * rumble, mix(8, 0, fallIn * fallIn) + hop, 0);
    egg.rotation.set(0, 0, wobble(t, .68, 9, 3) * .12 + wobble(t, HITS[0], 14, 5) * .14 - wobble(t, HITS[1], 13, 5) * .17
      + Math.sin(t * 51) * .04 * rumble + wobble(t, BURST, 16, 6) * .05);
    const thud = wobble(t, .68, 16, 6) * .2;
    const strain = smooth(rumble) * .1;
    const pop = wobble(t, BURST, 14, 5) * .16;
    shell.scale.set(1 + thud * .6 + strain * .5 - pop * .4, 1 - thud - strain + pop, 1 + thud * .6 + strain * .5);
    cracks.forEach((piece, i) => { piece.visible = t >= HITS[i < 3 ? 0 : 1] && t < BURST + .5; });

    const peek = smooth(range(t, 1.98, 2.1)) * (1 - smooth(range(t, 2.36, 2.44)));
    const look = Math.sin(range(t, 2.08, 2.36) * TAU);
    peekers.forEach(({ eye, pupil }) => {
      eye.visible = peek > .05 && t < BURST;
      eye.scale.set(1, peek * (1 - pulse(t, 2.2, 2.27) * .9), 1);
      pupil.position.x = look * .07;
    });

    sample(PR, t, p);
    p.open *= 1 - pulse(t, 4.3, 4.4);
    p.rz += Math.sin(t * 46) * .03 * pulse(t, BURST, 3.5);
    rex.root.visible = t > BURST - .04;
    rex.pose(p, t);

    // The cap rattles on each hit, lifts on the peeking eyes, then flies off
    // with the burst and comes down on the head, where it stays.
    const opened = t >= BURST;
    if (!opened) {
      const rattle = pulse(t, HITS[0], HITS[0] + .2) * .08 + pulse(t, HITS[1], HITS[1] + .12) * .1 + Math.abs(Math.sin(t * 40)) * .05 * rumble;
      cap.position.set(0, RIM.y + rattle + peek * .34, -peek * .1);
      cap.quaternion.setFromAxisAngle(LID, -peek * .3 - rattle * .6);
      cap.scale.setScalar(1);
    } else {
      egg.updateMatrixWorld();
      egg.worldToLocal(rex.crown.getWorldPosition(onHead));
      onHead.y -= .08;
      rex.head.getWorldQuaternion(headTurn).premultiply(egg.getWorldQuaternion(eggTurn).invert());
      const u = range(t, BURST, HAT);
      const settle = smooth(range(t, HAT - .25, HAT));
      cap.position.set(mix(Math.sin(u * 2.4) * .9, onHead.x, settle), mix(RIM.y + 4 * u * (1 - u) * 2.4 + u * 1.6, onHead.y, settle), mix(-u * .5, onHead.z, settle));
      cap.quaternion.setFromAxisAngle(TUMBLE, (1 - settle) * u * 9).slerp(headTurn, settle);
      cap.rotateX(-.42 * settle + wobble(t, HAT, 14, 6) * .2);
      cap.scale.setScalar(mix(1, .7, smooth(range(t, BURST + .1, HAT))));
    }

    const blast = range(t, BURST - .02, BURST + .6);
    ring.visible = blast > 0 && blast < 1;
    ring.quaternion.copy(camera.quaternion);
    ring.scale.setScalar(.3 + (1 - (1 - blast) ** 2) * 3.6);
    ring.material.opacity = (1 - blast) * .9;
    const shine = clamp(Math.exp(-(t - BURST) * 6) * 1.6) * (t > BURST - .02 ? 1 : 0);
    flash.visible = shine > .02;
    flash.scale.setScalar(2 + shine * 4);
    flash.material.opacity = clamp(shine) * .7;
    roar(t, BURST + .08, rex);
    drawParticles(bits, t);

    shadow.position.set(egg.position.x * SET, .01, .2);
    shadow.material.opacity = .32 * fallIn * (1 - clamp(egg.position.y / 2) * .6);
    const shake = Math.exp(-Math.max(0, t - BURST) * 9) * (t > BURST ? 1 : 0) + Math.exp(-Math.max(0, t - .68) * 12) * (t > .68 ? .5 : 0);
    glow.intensity = 9 + Math.sin(t * 3) * 2 + shine * 7;
    glow.position.set(0, (RIM.y + 2.2) * SET, -.6);
    camera.position.x = .25 + Math.sin(t * 97) * shake * .08;
    camera.position.y = camY + Math.cos(t * 83) * shake * .06;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose([speckled, label, ...textures.list]) };
}


const PECKS = [.34, .6, .86, 1.12, 1.38, 1.64];
const PLAN_LANDS = 2.55;
const RELEASE = 3.22;
const FLIGHT = [RELEASE, 4.1];
// Matches the default orc's scroll at the end of its flight: its face is
// FRONT_WIDTH by FRONT_HEIGHT with its top edge at FRONT.
const FRONT = new Vector3(.25, 3.455, 6);
const FRONT_HEIGHT = 2.19;
const FRONT_WIDTH = 2.3;
const SLAB = { h: 1.2, w: 1.2 * FRONT_WIDTH / FRONT_HEIGHT, d: .17, stands: 1.55, turn: .62, plinth: .5 };
// In profile, facing the tablet on its left.
const SIDE_ON = -1.22;

// Beats: with a chisel in its teeth it pecks the plan into the tablet, a line
// a peck (0.34-1.64), spits the chisel and blows the dust off (1.85-2.2),
// cheers on the word (2.55), then spins and swats the tablet at the viewer
// with its tail (3.22) and stomps about, arms up.
const PLAN = keyframes(BASE, [
  [0, { x: 1.3, z: .2, ry: SIDE_ON, rx: .26, nod: .1, arm: .6, flail: .3, brow: .4, lx: -.3, ly: -.3, tail: .7, swish: .5 }],
  [1.72, {}],
  [1.86, { rx: .05, nod: -.25, jaw: .5, brow: 0, flail: 0 }, 'o'],
  [2.02, { rx: .2, nod: .15, jaw: .25, s: .06, pupil: .4 }],
  [2.2, { rx: .14, jaw: .1, s: 0 }],
  [2.4, { x: 1.45, ry: -.4, rx: 0, nod: 0, jaw: 0, lx: 0, ly: 0, tilt: .14, arm: .3 }],
  [PLAN_LANDS, { y: .32, s: .12, nod: -.15, tilt: 0, happy: 1, jaw: .8, blush: 1, arm: 1, flail: 1 }, 'o'],
  [2.72, { y: 0, s: -.1, jaw: .4 }, 'i'],
  [2.92, { s: 0, happy: 0, jaw: 0, flail: .2, arm: .4, brow: .8, turn: -.3, lx: -.6, pupil: .8 }],
  [3.08, { ry: -.9, s: -.12, rx: .1, tail: .9 }],
  [RELEASE, { ry: 1.45, x: 1.2, s: .05, rx: -.05, turn: 0, lx: 0 }, 'i'],
  [3.62, { ry: TAU - .3, x: 1.5, brow: 0, s: 0, rx: 0 }, 'o'],
  [3.8, { happy: 1, jaw: .7, arm: 1, flail: 1, stomp: .45, swish: .9, blush: 1, nod: -.1 }],
  [5, {}],
]);

function createDinoPlan(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  volcanoStage(stage);
  const rex = createRex(1.1);
  scene.add(rex.root);
  const shadow = blobShadow(scene, .25);
  const halo = new Mesh(new TorusGeometry(2.3, .024, 5, 64), new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: .3 }));
  halo.position.set(0, 2.2, -1.8);
  scene.add(halo);

  const grain = (ctx, w, h) => {
    ctx.fillStyle = '#b9ad94';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.13)' : 'rgba(60,45,25,.1)';
      ctx.fillRect((i * 89) % w, (i * 61) % h, 10 + (i * 7) % 22, 3);
    }
    ctx.strokeStyle = 'rgba(60,45,25,.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, w - 24, h - 24);
  };
  const carved = paint(512, 488, (ctx, w, h) => {
    grain(ctx, w, h);
    const carve = draw => {
      ctx.save();
      ctx.translate(2, 2);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      draw();
      ctx.restore();
      ctx.fillStyle = '#3d3222';
      draw();
    };
    ctx.font = `bold 52px ${FONT}`;
    carve(() => ctx.fillText('THE PLAN', 40, 86));
    ctx.font = `bold 26px ${FONT}`;
    wrap(title.trim(), 432, 2, ctx.font).forEach((line, i) => carve(() => ctx.fillText(line, 40, 132 + i * 32)));
    for (let i = 0; i < 5; i++) {
      carve(() => printPath(ctx, 58, 232 + i * 46, 30));
      carve(() => ctx.fillRect(88, 232 + i * 46, 250 + Math.sin(i * 3) * 80, 11));
    }
  });
  // The same stone, uncut: it covers whatever the chisel has not reached.
  const blank = paint(512, 488, grain);

  const stone = new MeshStandardMaterial({ color: 0x9a8f78, roughness: .95, flatShading: true });
  const slab = new Group();
  const block = new Mesh(new BoxGeometry(SLAB.w + .1, SLAB.h + .1, SLAB.d), stone);
  block.castShadow = true;
  const arch = new Mesh(new CylinderGeometry((SLAB.w + .1) / 2, (SLAB.w + .1) / 2, SLAB.d, 18, 1, false, -Math.PI / 2, Math.PI), stone);
  arch.rotation.x = -Math.PI / 2;
  arch.scale.z = .34;
  arch.position.y = SLAB.h / 2 + .05;
  const face = new Mesh(new PlaneGeometry(SLAB.w, SLAB.h), new MeshStandardMaterial({ map: carved, roughness: .9 }));
  face.position.z = SLAB.d / 2 + .004;
  const cover = new Mesh(new PlaneGeometry(SLAB.w, SLAB.h), new MeshStandardMaterial({ map: blank, roughness: .9 }));
  cover.position.z = SLAB.d / 2 + .008;
  slab.add(block, arch, face, cover);
  scene.add(slab);
  const plinth = new Mesh(new IcosahedronGeometry(.62, 1), stone);
  plinth.castShadow = true;
  scene.add(plinth);

  // The chisel rides in the mouth, its edge leading.
  const chisel = new Group();
  const handle = new Mesh(new CylinderGeometry(.055, .055, .5, 8), new MeshStandardMaterial({ color: 0x7a5230, roughness: .9 }));
  handle.rotation.x = Math.PI / 2;
  const edge = new Mesh(new ConeGeometry(.09, .3, 4), new MeshStandardMaterial({ color: 0x5d564a, roughness: .5, flatShading: true }));
  edge.rotation.x = Math.PI / 2;
  edge.position.z = .38;
  chisel.add(handle, edge);
  chisel.position.set(0, -.14, .02);
  rex.mouth.add(chisel);

  const textures = dinoTextures();
  const p = { ...BASE };
  const strike = t => PECKS.reduce((sum, at) => sum + pulse(t, at - .1, at + .08), 0);

  function pose(t) {
    sample(PLAN, t, p);
    const peck = strike(t) * (1 - range(t, 1.7, 1.75));
    p.nod += peck * .42;
    p.rx += peck * .1;
    p.open *= 1 - pulse(t, 2.24, 2.34);
    p.y += .05 * wobble(t, PLAN_LANDS + .17, 12, 6);
    rex.pose(p, t);
  }

  // The tablet stands where the chisel's edge meets it at the bottom of a peck.
  pose(PECKS[0]);
  rex.root.updateMatrixWorld();
  const tip = edge.getWorldPosition(new Vector3());
  const toward = new Vector3(Math.sin(SLAB.turn), 0, Math.cos(SLAB.turn));
  const stood = new Vector3(tip.x, SLAB.plinth + SLAB.h * SLAB.stands / 2, tip.z)
    .addScaledVector(toward, -SLAB.d * SLAB.stands / 2 - .1)
    .addScaledVector(new Vector3(toward.z, 0, -toward.x), -SLAB.w * SLAB.stands * .22);
  const stoodTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), SLAB.turn);
  const square = new Quaternion();
  const flown = new Vector3(FRONT.x, FRONT.y - FRONT_HEIGHT / 2, FRONT.z);
  plinth.position.set(stood.x, .12, stood.z);
  plinth.scale.set(1.5, .7, .8);

  const bits = particles(scene, [
    ...PECKS.flatMap((at, i) => spray(tip, at, 5, { speed: 1.9, up: 1.1, depth: .7, life: .6, size: .2, phase: i * .7, side: 1 })),
    ...spray(stood.clone().add(new Vector3(.2, .2, .5)), 2.02, 10, { speed: 1.4, up: .5, depth: .6, life: .9, size: .5, gravity: .3, side: -1 })
      .map(puff => ({ ...puff, map: textures.dust, color: 0xe6dcc8 })),
    ...spray(stood.clone().add(new Vector3(0, .9, .4)), PLAN_LANDS, 22, { speed: 2.8, up: 2, depth: 1.2, life: 1.1, size: .34 })
      .map((spark, i) => ({ ...spark, map: i % 2 ? textures.ember : textures.print, color: LAVA[i % LAVA.length] })),
    ...spray(stood, RELEASE, 14, { speed: 3, up: 1.4, depth: 1, life: .8, size: .3, phase: .3 }),
  ], [textures.chip, textures.chip, textures.dust], ROCKS);

  function render(t) {
    pose(t);
    const uncut = 1 - PECKS.filter(at => t >= at).length / PECKS.length;
    cover.visible = uncut > 0;
    cover.scale.y = Math.max(.001, uncut);
    cover.position.y = -SLAB.h / 2 + SLAB.h * uncut / 2;
    blank.repeat.y = Math.max(.001, uncut);
    chisel.scale.setScalar(1 - range(t, 1.84, 1.94));
    chisel.visible = t < 1.94;

    const lift = 1 - (1 - range(t, FLIGHT[0], FLIGHT[1])) ** 3;
    slab.position.lerpVectors(stood, flown, lift);
    slab.position.y += Math.sin(lift * Math.PI) * .5 + .04 * wobble(t, PLAN_LANDS, 14, 6) * (1 - lift);
    slab.position.x += PECKS.reduce((sum, at) => sum + wobble(t, at, 40, 14), 0) * .02;
    slab.quaternion.slerpQuaternions(stoodTurn, square, lift);
    slab.rotateZ(Math.sin(lift * Math.PI) * -.5 + wobble(t, PLAN_LANDS, 12, 5) * .05 * (1 - lift));
    slab.scale.setScalar(mix(SLAB.stands, FRONT_HEIGHT / SLAB.h, lift));
    block.castShadow = arch.castShadow = t <= RELEASE;
    drawParticles(bits, t);

    setShadow(shadow, rex, 0, .25);
    const bounce = pulse(t, PLAN_LANDS - .1, PLAN_LANDS + .3);
    halo.material.opacity = .2 * Math.sin(smooth(range(t, .2, 1)) * Math.PI) + .06 + bounce * .3;
    halo.scale.setScalar(1 + range(t, .2, 1.5) * .4 + bounce * .15);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + bounce * 18;
    camera.position.x = .25 + Math.sin(t * 90) * (bounce * .03 + pulse(t, RELEASE, RELEASE + .25) * .04);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose([carved, blank, ...textures.list]) };
}


const HOPS = 2;
const NAP = 4;

// All settled. Beats: stomp up through the page and land with a thud
// (0.15-0.9), crouch (1.06-1.4), leap and roar as the lava fireworks burst
// (1.45), land (1.9), stomp from side to side under them (2.0-3.9), then flop
// onto its belly and doze.
const CLEAR = keyframes(BASE, [
  [0, { y: -3.7, z: -1.4, s: .3, rx: -.25, nod: -.3, jaw: .7, arm: 1, flail: 1, pupil: .4, tail: .9, swish: .6 }],
  [.15, {}],
  [.55, { y: 1, z: 0, s: .18, rx: -.1 }, 'o'],
  [.82, { y: 0, s: .1, rx: .05, jaw: .3, nod: .05, arm: .5 }, 'i'],
  [.9, { s: -.28, w: .1, rx: .2, jaw: .6, happy: 1, nod: .2, flail: .4, blush: .8 }, 'o'],
  [1.06, { s: 0, w: 0, rx: 0, jaw: 0, happy: 0, nod: 0, arm: .15, flail: 0 }],
  [1.22, { s: -.2, rx: .22, pupil: 1, tail: .2, swish: .7, nod: -.3, ly: .7, brow: .6 }],
  [1.4, { s: -.28 }],
  [1.64, { y: .75, s: .2, rx: -.16, jaw: 1, nod: -.5, arm: 1, flail: 1, blush: 1, pupil: .2, ly: 0, tail: 1.1 }, 'o'],
  [1.9, { y: 0, s: -.26, rx: .1, jaw: .6, nod: -.1 }, 'i'],
  [HOPS + .08, { s: 0, rx: 0, jaw: .5, nod: -.05, happy: 1, brow: 0, swish: .9 }, 'o'],
  [NAP - .1, {}],
  [NAP + .25, { s: -.4, w: .16, rx: .2, jaw: 0, nod: .3, tilt: .14, arm: .1, flail: 0, tail: -.2, swish: .12, blush: .6 }, 'i'],
  [NAP + .45, { s: -.34, w: .12 }, 'o'],
  [5.4, { tilt: .1 }],
]);

function createDinoClear(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  volcanoStage(stage);
  const rex = createRex(1.12);
  scene.add(rex.root);
  const shadow = blobShadow(scene);
  const halo = new Mesh(new TorusGeometry(2.3, .024, 5, 64), new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: .3 }));
  halo.position.set(0, 2.2, -1.8);
  scene.add(halo);

  const textures = dinoTextures();
  const snore = paint(96, 96, ctx => {
    ctx.fillStyle = '#fff';
    ctx.font = `bold 84px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Z', 48, 78);
  });
  const eruption = createFireworks(scene, camera, { colors: LAVA, map: textures.ember, size: .5, sparks: 22 });
  const thud = spray(new Vector3(0, .2, .9), .85, 14, { speed: 2.6, up: 1.3, depth: .8, life: .85, size: .34, phase: .5 });
  const leap = spray(new Vector3(0, .4, .8), CLEAR_LANDS, 18, { speed: 3.2, up: 2, depth: 1, life: 1, size: .38 });
  const zeds = [0, 1, 2, 3].map(i => ({
    at: NAP + .45 + i * .26, o: new Vector3(.9 + i * .1, 1.9, 1.2), v: new Vector3(.4, .9, .1),
    gravity: 0, life: 1, size: .5 + i * .12, spin: .2, map: snore, color: 0xffd9a8,
  }));
  const bits = particles(scene, [...thud, ...leap, ...zeds], [textures.chip, textures.leaf, textures.chip, textures.ember], [...ROCKS, ...LEAVES]);
  const roar = roarRings(scene, camera);

  const p = { ...BASE };
  const camY = camera.position.y;
  function render(t) {
    sample(CLEAR, t, p);
    const hop = smooth(range(t, HOPS, HOPS + .2)) * (1 - smooth(range(t, NAP - .25, NAP - .05)));
    const beat = (t - HOPS) * Math.PI * 2.4;
    const air = Math.abs(Math.sin(beat));
    p.x += Math.sin(beat / 2) * .95 * hop;
    p.y += air * .4 * hop;
    p.s += (air - .5) * .16 * hop;
    p.ry += Math.cos(beat / 2) * .4 * hop;
    p.rz -= Math.sin(beat / 2) * .12 * hop;
    p.ll += Math.max(0, Math.sin(beat / 2)) * air * .7 * hop;
    p.rl += Math.max(0, -Math.sin(beat / 2)) * air * .7 * hop;
    p.arm += (1 - p.arm) * hop;
    p.flail += hop;
    p.tilt += Math.sin(beat / 2) * .2 * hop;
    p.rz += Math.sin(t * 46) * .03 * pulse(t, CLEAR_LANDS, 1.9);
    // Each snore swells the whole animal.
    p.s += Math.sin((t - NAP) * 4) * .03 * range(t, NAP + .4, NAP + .6);
    rex.pose(p, t);
    eruption.update(t);
    roar(t, CLEAR_LANDS + .05, rex);
    drawParticles(bits, t);
    setShadow(shadow, rex);
    const flash = eruption.flash(t);
    halo.material.opacity = .1 + flash * .3;
    halo.scale.setScalar(1.3 + flash * .12);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + flash * 10;
    camera.position.y = camY + Math.sin(t * 75) * (pulse(t, .85, 1.1) * .07 + pulse(t, 1.9, 2.1) * .05 + air * hop * .008);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose([snore, ...textures.list]) };
}

export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  look: {
    words: { yeet: 'BONK! RAWR~', pr: 'PR HATCHED!', plan: 'SET IN STONE', clear: 'ALL STOMPED~' },
    background: 'radial-gradient(ellipse at 50% 60%,light-dark(#fdf8e0,#6a2e14) 0%,light-dark(#d9ecb4,#2c1610) 46%,light-dark(#a6cf7a,#130b08) 100%)',
    ink: 'light-dark(#24400f,#ffe2c2)',
    glow: '0 5px 0 light-dark(#bfe08c,#7a2e12),0 0 70px light-dark(#6cbf4360,#ff7a2e70)',
    flash: 'light-dark(#2c6a1e,#ffd9b0)',
    flashGlow: 'light-dark(#6cbf4390,#ff7a2e90)',
  },
  clear: createDinoClear,
  yeet: createDinoYeet,
  pr: createDinoPr,
  plan: createDinoPlan,
};
