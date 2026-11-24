// The ocean cast for Yeet, PR opened and Plan reveal: a purple-teal octopus
// under the sea. Every scene keeps the overlay beats in ui/js/scene-poses.js.
import {
  AdditiveBlending, BoxGeometry, CanvasTexture, CapsuleGeometry, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DoubleSide, Euler, Group, IcosahedronGeometry, InstancedMesh, LatheGeometry, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight, Quaternion, SphereGeometry,
  SRGBColorSpace, TorusGeometry, Vector2, Vector3,
} from 'three';
import { back, clamp, createStage, fall, keys, mix, out, pulse, range, smooth, whip, wobble } from '../../ui/yeet/stage.js';
import { CLEAR_LANDS, createFireworks, finale } from '../../ui/yeet/party.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

const unit = x => Math.max(-1, Math.min(1, x));


// keys() for points: [[time, x, y, z, ease?], ...], written into `target`.
function keys3(t, track, target) {
  let i = 1;
  while (i < track.length - 1 && t > track[i][0]) i += 1;
  const a = track[i - 1], b = track[i];
  const k = (b[4] || smooth)(range(t, a[0], b[0]));
  return target.set(mix(a[1], b[1], k), mix(a[2], b[2], k), mix(a[3], b[3], k));
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function wrap(text, width, lines, font) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure.measureText(next).width > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  if (out.length > lines) out.splice(lines - 1, out.length, `${out[lines - 1]}…`);
  return out;
}

const UP = new Vector3(0, 1, 0);
const NO_TURN = new Quaternion();
const scratch = { m: new Matrix4(), p: new Vector3(), s: new Vector3() };

// One draw call for many small things; `count` hides whatever this frame
// did not place, so a frame never inherits the last one's particles.
function createSwarm(scene, geometry, material, capacity) {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  let used = 0;
  return {
    mesh,
    begin() { used = 0; },
    add(x, y, z, sx, sy = sx, sz = sx, turn = NO_TURN) {
      if (used >= capacity || sx <= .002) return;
      scratch.m.compose(scratch.p.set(x, y, z), turn, scratch.s.set(sx, sy, sz));
      mesh.setMatrixAt(used++, scratch.m);
    },
    end() {
      mesh.count = used;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// A link of a tapered chain: a hemisphere of the top radius at the joint,
// a hemisphere of the bottom radius at the next one, so neighbours meet in
// identical spheres and the chain bends without seams.
function linkShape(top, bottom, length) {
  const points = [];
  for (let k = 0; k <= 4; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 8;
    points.push(new Vector2(Math.max(1e-3, bottom * Math.cos(a)), -length + bottom * Math.sin(a)));
  }
  for (let k = 0; k <= 4; k++) {
    const a = k * Math.PI / 8;
    points.push(new Vector2(Math.max(1e-3, top * Math.cos(a)), top * Math.sin(a)));
  }
  return new LatheGeometry(points, 14);
}

const ARMS = 8;
const LINKS = 9;
const LINK = .27;
const RADII = Array.from({ length: LINKS + 1 }, (_, j) => .045 + .17 * (1 - j / LINKS) ** 1.2);
const BODY_Y = 2.35;
const SIZE = 1.15;
const DOWN = new Vector3(0, -1, 0);
const SKIRT_Y = 1.38;
// Arms by where they leave the skirt: 1 reaches to the viewer's right, 6 to
// the left, 0 and 7 hang in front.
const RIGHT = 1;
const LEFT = 6;

// Bend that makes a chain of equal links span `distance` as a circular arc.
function bendFor(distance) {
  if (distance >= LINKS * LINK * .999) return 0;
  let lo = 0, hi = Math.PI * 1.9;
  for (let k = 0; k < 16; k++) {
    const mid = (lo + hi) / 2;
    if (LINK * Math.sin(mid / 2) / Math.sin(mid / (2 * LINKS)) > distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function createOctopus() {
  const root = new Group();
  const torso = new Group();
  const body = new Group();
  const skirt = new Group();
  root.scale.setScalar(SIZE);
  root.add(torso);
  torso.add(body, skirt);
  body.position.y = BODY_Y;
  skirt.position.y = SKIRT_Y;

  const skin = canvasTexture(256, 128, g => {
    const fade = g.createLinearGradient(0, 0, 0, 128);
    fade.addColorStop(0, '#6a3fd6');
    fade.addColorStop(.42, '#9a6df2');
    fade.addColorStop(.78, '#6a9ce8');
    fade.addColorStop(1, '#3fd0c6');
    g.fillStyle = fade;
    g.fillRect(0, 0, 256, 128);
    for (let k = 0; k < 20; k++) {
      g.fillStyle = k % 3 ? 'rgba(200,172,255,.7)' : 'rgba(110,232,220,.6)';
      g.beginPath();
      g.ellipse((k * 71) % 256, 8 + (k * 23) % 44, 4 + (k * 5) % 7, 3 + (k * 3) % 5, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  const mantle = new Mesh(new SphereGeometry(1, 40, 28), new MeshStandardMaterial({ map: skin, roughness: .42 }));
  mantle.scale.set(1, 1.1, .94);
  mantle.castShadow = true;
  body.add(mantle);

  const purple = new Color(0x8a5ce8);
  const teal = new Color(0x3fd4c6);
  const skins = Array.from({ length: LINKS }, (_, j) => new MeshStandardMaterial({ color: purple.clone().lerp(teal, j / (LINKS - 1)), roughness: .45 }));
  const web = new Mesh(new SphereGeometry(.74, 28, 16), skins[1]);
  web.scale.set(1, .5, 1);
  web.castShadow = true;
  skirt.add(web);

  const ink = new MeshStandardMaterial({ color: 0x1d0f3d, roughness: .3 });
  const white = new MeshStandardMaterial({ color: 0xfbfdff, roughness: .22 });
  const shine = new MeshBasicMaterial({ color: 0xffffff });
  const plum = new MeshStandardMaterial({ color: 0x45114c, roughness: .6, side: DoubleSide });
  const tongue = new MeshStandardMaterial({ color: 0xff7aa6, roughness: .6, side: DoubleSide });
  const blush = new MeshBasicMaterial({ color: 0xff8fc8, transparent: true, opacity: .55, depthWrite: false });
  const ballShape = new SphereGeometry(.31, 24, 16);
  const irisShape = new SphereGeometry(.19, 20, 14);
  const glintShape = new SphereGeometry(.055, 10, 8);
  const sparkShape = new SphereGeometry(.026, 8, 6);
  const happyShape = new TorusGeometry(.19, .045, 8, 20, Math.PI);
  const browShape = new CapsuleGeometry(.036, .2, 4, 8);
  const eyes = [-1, 1].map(side => {
    const eye = new Group();
    eye.position.set(side * .4, -.1, .76);
    eye.rotation.y = side * .32;
    body.add(eye);
    const lid = new Group();
    eye.add(lid);
    const ball = new Mesh(ballShape, white);
    ball.scale.set(1, 1.12, .6);
    const pupil = new Group();
    const iris = new Mesh(irisShape, ink);
    iris.scale.set(1, 1.1, .45);
    const glint = new Mesh(glintShape, shine);
    glint.position.set(.06, .08, .09);
    const spark = new Mesh(sparkShape, shine);
    spark.position.set(-.06, -.07, .09);
    pupil.add(iris, glint, spark);
    lid.add(ball, pupil);
    const happy = new Mesh(happyShape, ink);
    happy.position.z = .14;
    eye.add(happy);
    const brow = new Mesh(browShape, ink);
    brow.position.z = .12;
    eye.add(brow);
    return { side, lid, pupil, happy, brow };
  });
  const mouth = new Group();
  mouth.position.set(0, -.56, .84);
  mouth.rotation.x = .5;
  body.add(mouth);
  const smile = new Mesh(new TorusGeometry(.14, .032, 8, 20, Math.PI), ink);
  smile.rotation.z = Math.PI;
  const grin = new Mesh(new CircleGeometry(.19, 24, Math.PI, Math.PI), plum);
  const lick = new Mesh(new CircleGeometry(.1, 16, Math.PI, Math.PI), tongue);
  lick.position.set(0, -.08, .004);
  grin.add(lick);
  const shout = new Mesh(new CircleGeometry(.16, 24), plum);
  shout.position.y = -.08;
  mouth.add(smile, grin, shout);
  const cheekShape = new SphereGeometry(.13, 16, 10);
  const cheeks = [-1, 1].map(side => {
    const cheek = new Mesh(cheekShape, blush);
    cheek.position.set(side * .6, -.38, .7);
    cheek.rotation.y = side * .6;
    body.add(cheek);
    return cheek;
  });

  const linkShapes = Array.from({ length: LINKS }, (_, j) => linkShape(RADII[j], RADII[j + 1], LINK));
  const suckerShape = new SphereGeometry(1, 10, 6);
  const sucker = new MeshStandardMaterial({ color: 0xffcfe8, roughness: .5 });
  const tentacles = [];
  for (let i = 0; i < ARMS; i++) {
    const theta = (i + .5) * Math.PI / 4;
    const outward = new Vector3(Math.sin(theta), 0, Math.cos(theta));
    const anchor = new Group();
    anchor.position.set(outward.x * .5, -.05, outward.z * .5);
    skirt.add(anchor);
    const joints = [];
    let parent = anchor;
    for (let j = 0; j < LINKS; j++) {
      const joint = new Group();
      if (j) joint.position.y = -LINK;
      parent.add(joint);
      const link = new Mesh(linkShapes[j], skins[j]);
      link.castShadow = true;
      joint.add(link);
      if (j) {
        const r = (RADII[j] + RADII[j + 1]) / 2;
        const cup = new Mesh(suckerShape, sucker);
        cup.position.set(0, -LINK / 2, r * .9);
        cup.scale.set(r * .55, r * .55, r * .3);
        joint.add(cup);
      }
      joints.push(joint);
      parent = joint;
    }
    const tip = new Object3D();
    tip.position.y = -LINK;
    parent.add(tip);
    tentacles.push({ outward, anchor, joints, tip });
  }

  const v = new Vector3(), u = new Vector3(), n = new Vector3(), w = new Vector3(), y = new Vector3(), z = new Vector3();
  const basis = new Matrix4();

  // Lays arm `i` along a circular arc from its anchor to `target` (world),
  // bulging toward `pole` (skirt space), then curls the tip and adds a
  // travelling ripple. The curl and ripple pull the tip off the target, so
  // anything held reads the tip back rather than trusting the target.
  function reach(i, target, pole, curl, wave, t) {
    const arm = tentacles[i];
    skirt.worldToLocal(v.copy(target)).sub(arm.anchor.position);
    const d = Math.max(v.length(), 1e-4);
    u.copy(v).divideScalar(d);
    n.crossVectors(u, pole);
    if (n.lengthSq() < 1e-5) n.crossVectors(u, arm.outward);
    if (n.lengthSq() < 1e-5) n.set(1, 0, 0);
    n.normalize();
    w.crossVectors(n, u);
    const bend = bendFor(d);
    y.copy(u).multiplyScalar(-Math.cos(bend / 2)).addScaledVector(w, -Math.sin(bend / 2));
    z.crossVectors(n, y);
    arm.anchor.quaternion.setFromRotationMatrix(basis.makeBasis(n, y, z));
    const step = bend / LINKS;
    for (let j = 0; j < LINKS; j++) {
      const f = j / (LINKS - 1);
      const ripple = Math.sin(t * 5.2 - j * .85 + i * 1.7) * wave;
      arm.joints[j].rotation.set(-(j ? step : step / 2) - curl * f * f * .9 + ripple * .35, 0, Math.cos(t * 4.1 - j * .7 + i * 2.3) * wave * .25);
    }
  }

  const expr = { blink: 0, lookX: 0, lookY: 0, happy: 0, wide: 0, brow: 0, angry: 0, smile: .7, grin: 0, shout: 0, cheek: .6 };
  function face() {
    const e = expr;
    for (let k = 0; k < 2; k++) {
      const eye = eyes[k];
      const open = (1 - clamp(e.blink)) * (1 - clamp(e.happy));
      eye.lid.visible = open > .04;
      eye.lid.scale.set(1 + e.wide * .12, Math.max(.04, open) * (1 + e.wide * .16), 1);
      eye.pupil.position.set(unit(e.lookX) * .1, unit(e.lookY) * .11, .15);
      eye.pupil.scale.setScalar(1 - clamp(e.wide) * .3);
      eye.happy.visible = e.happy > .05;
      eye.happy.scale.set(1, Math.max(.05, clamp(e.happy)), 1);
      eye.brow.position.y = .43 + e.brow * .1 + e.wide * .07;
      eye.brow.rotation.z = Math.PI / 2 + eye.side * e.angry * .5;
    }
    smile.visible = e.smile > .03;
    smile.scale.set(.7 + e.smile * .5, Math.max(.05, e.smile), 1);
    grin.visible = e.grin > .03;
    grin.scale.set(.75 + e.grin * .35, e.grin, 1);
    shout.visible = e.shout > .03;
    shout.scale.set(.65 + e.shout * .35, e.shout * 1.25, 1);
    for (let k = 0; k < 2; k++) cheeks[k].scale.set(e.cheek, e.cheek * .7, e.cheek * .35);
  }

  return {
    root, torso, body, mantle, tentacles, expr, face, reach, textures: [skin],
    // Stretch along y keeping the mantle's base put, so a squash sinks and a
    // stretch rises; the arms hang off the unscaled skirt.
    squash(s, t) {
      const breath = Math.sin(t * 2.6) * .018;
      body.scale.set(1 - s * .5 - breath, 1 + s + breath, 1 - s * .5 - breath);
      body.position.y = BODY_Y + s * 1.1;
    },
    update() { root.updateMatrixWorld(true); },
    toWorld(target) { return root.localToWorld(target); },
    tip(i, target) { return tentacles[i].tip.getWorldPosition(target); },
  };
}

// The stage lights a green swamp; the sea wants cyan and violet.
function seaLights(scene, key, glow) {
  scene.traverse(light => {
    if (light.isHemisphereLight) {
      light.color.set(0xd2f3ff);
      light.groundColor.set(0x1c2550);
    } else if (light.isAmbientLight) light.color.set(0xc4e4f0);
    else if (light.isDirectionalLight && light !== key) light.color.set(light.position.z < 0 ? 0x86e6ff : 0xa892f2);
  });
  key.color.set(0xfff1dc);
  glow.color.set(0x7fd8ff);
}

function bubbleTexture() {
  return canvasTexture(128, 128, g => {
    const fill = g.createRadialGradient(54, 50, 6, 64, 64, 58);
    fill.addColorStop(0, 'rgba(255,255,255,.4)');
    fill.addColorStop(.7, 'rgba(160,235,250,.14)');
    fill.addColorStop(1, 'rgba(90,205,235,.4)');
    g.fillStyle = fill;
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(40,168,205,.95)';
    g.beginPath();
    g.arc(64, 64, 57, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.beginPath();
    g.arc(64, 64, 40, Math.PI * 1.08, Math.PI * 1.42);
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(86, 40, 6, 0, Math.PI * 2);
    g.fill();
  });
}

function starTexture(color) {
  return canvasTexture(128, 128, g => {
    const shineFill = g.createRadialGradient(64, 64, 0, 64, 64, 40);
    shineFill.addColorStop(0, color.glow);
    shineFill.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = shineFill;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = color.core;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
      g.quadraticCurveTo(64, 64, 64 + Math.cos(a + Math.PI / 2) * 62, 64 + Math.sin(a + Math.PI / 2) * 62);
    }
    g.fill();
  });
}

// Set dressing shared by all three scenes: light shafts, swaying kelp, a few
// fish crossing far behind, and bubbles rising through all of it.
function createSea(scene, camera) {
  const textures = [];
  const shaft = canvasTexture(64, 256, g => {
    const down = g.createLinearGradient(0, 0, 0, 256);
    down.addColorStop(0, 'rgba(255,255,255,.9)');
    down.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = down;
    g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = 'destination-in';
    const across = g.createLinearGradient(0, 0, 64, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(.5, 'rgba(0,0,0,1)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, 64, 256);
  });
  textures.push(shaft);
  const shafts = [-3.4, .4, 3.6].map((x, k) => {
    const ray = new Mesh(new PlaneGeometry(1.7, 11), new MeshBasicMaterial({ map: shaft, color: 0xd8fbff, transparent: true, opacity: .1, depthWrite: false, toneMapped: false }));
    ray.position.set(x, 5.2, -6);
    ray.rotation.z = .28 - k * .1;
    scene.add(ray);
    return ray;
  });

  const kelp = [];
  const kelpShapes = Array.from({ length: 7 }, (_, j) => linkShape(.12 - j * .012, .12 - (j + 1) * .012, .44));
  const kelpSkins = [0x2c9f7c, 0x48c08a].map(color => new MeshStandardMaterial({ color, roughness: .6 }));
  [[-4.5, -2.4, 0], [-3.8, -3.5, 1], [4.4, -2.6, 1], [3.7, -3.7, 0]].forEach(([x, z, shade], k) => {
    const stem = new Group();
    stem.position.set(x, 0, z);
    scene.add(stem);
    const joints = [];
    let parent = stem;
    for (let j = 0; j < 7; j++) {
      const joint = new Group();
      if (j) joint.position.y = .44;
      parent.add(joint);
      const link = new Mesh(kelpShapes[j], kelpSkins[shade]);
      link.rotation.x = Math.PI;
      joint.add(link);
      joints.push(joint);
      parent = joint;
    }
    kelp.push({ joints, phase: k * 1.3, lean: x < 0 ? .1 : -.1 });
  });

  const fishBody = new SphereGeometry(.2, 16, 10);
  const fishTail = new ConeGeometry(.15, .26, 4);
  const fishEye = new SphereGeometry(.035, 8, 6);
  const eyeInk = new MeshBasicMaterial({ color: 0x0b2033 });
  const fish = [[0xff8a5c, 4.4, -5.5, 1, 1.5, 0], [0xffd24a, 3.7, -4.8, -1, 1.2, 5], [0x5ab4ff, 5.1, -6.5, 1, 1.05, 9]].map(([color, height, z, dir, speed, offset]) => {
    const skin = new MeshStandardMaterial({ color, roughness: .5 });
    const swimmer = new Group();
    const torsoMesh = new Mesh(fishBody, skin);
    torsoMesh.scale.set(1.5, 1, .55);
    const tail = new Mesh(fishTail, skin);
    tail.rotation.z = -Math.PI / 2;
    tail.position.x = -.36;
    tail.scale.z = .35;
    const eye = new Mesh(fishEye, eyeInk);
    eye.position.set(.19, .05, .09);
    swimmer.add(torsoMesh, tail, eye);
    swimmer.rotation.y = dir > 0 ? 0 : Math.PI;
    scene.add(swimmer);
    return { swimmer, tail, height, z, dir, speed, offset };
  });

  const bubbleMap = bubbleTexture();
  textures.push(bubbleMap);
  const bubbles = createSwarm(scene, new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: bubbleMap, transparent: true, depthWrite: false, toneMapped: false }), 90);
  bubbles.mesh.renderOrder = 2;
  const facing = camera.quaternion.clone();
  const drops = createSwarm(scene, new SphereGeometry(1, 10, 8), new MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x1a7f96, emissiveIntensity: .5, roughness: .05, transparent: true, opacity: .85 }), 70);

  return {
    textures,
    bubble(x, y, z, size) { bubbles.add(x, y, z, size, size, size, facing); },
    drop(x, y, z, size, stretch = 1) { drops.add(x, y, z, size, size * stretch, size); },
    // Opens a frame: ambient bubbles and the scenery move, and scenes then add
    // their own bubbles and drops before `close`.
    open(t) {
      bubbles.begin();
      drops.begin();
      shafts.forEach((ray, k) => { ray.material.opacity = .07 + .05 * Math.sin(t * 1.3 + k * 2.1); });
      kelp.forEach(({ joints, phase, lean }) => {
        joints.forEach((joint, j) => {
          joint.rotation.z = (j ? 0 : lean) + Math.sin(t * 1.5 + j * .45 + phase) * .12;
          joint.rotation.x = Math.cos(t * 1.1 + j * .4 + phase) * .06;
        });
      });
      fish.forEach(({ swimmer, tail, height, z, dir, speed, offset }) => {
        swimmer.position.set(dir * (-8 + ((t * speed + offset) % 16)), height + Math.sin(t * 2 + offset) * .15, z);
        tail.rotation.y = Math.sin(t * 14 + offset) * .45;
      });
      for (let k = 0; k < 18; k++) {
        const speed = .55 + (k % 5) * .14;
        const rise = (t * speed + k * .83) % 7.5;
        this.bubble(-5.2 + ((k * 4.37) % 10.4) + Math.sin(t * 2 + k) * .12, rise - .8, -3.2 + (k % 6) * .9, (.07 + (k % 4) * .035) * Math.min(1, rise * 2));
      }
    },
    close() {
      bubbles.end();
      drops.end();
    },
  };
}

function shadowBlob(scene) {
  const blob = new Mesh(new CircleGeometry(1, 40), new MeshBasicMaterial({ color: 0x06213a, transparent: true, opacity: .3, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);
  return blob;
}

const LOOK_AT = new Vector3();
// Points both pupils at a world point, as seen from the middle of the face.
function lookToward(octo, point) {
  octo.body.getWorldPosition(LOOK_AT);
  octo.expr.lookX = unit((point.x - LOOK_AT.x) / 2.2);
  octo.expr.lookY = unit((point.y - LOOK_AT.y + .2) / 1.8);
}

// Yeet: the run lands at 3.32, when the send-offs plugin plays the voice.
const YEET_LANDS = 3.32;
const YEET = {
  rootY: [[.12, -3.9], [.6, 1.05, out], [.84, 0, fall], [4.12, 0], [4.27, .55, out], [4.42, 0, fall], [4.55, .28, out], [4.68, 0, fall]],
  squash: [[.3, .22], [.78, .08], [.86, -.28, out], [1, .12], [1.14, -.05], [1.3, 0], [2.4, 0], [2.46, -.06], [2.56, .03], [2.7, 0], [2.88, 0], [3.2, -.18], [3.28, -.24], [3.37, .24, whip], [3.6, .05], [3.85, 0], [4.12, -.14], [4.22, .16], [4.42, -.14], [4.5, .1], [4.66, -.08], [4.8, 0]],
  lean: [[.12, -.4], [.55, .12], [.9, 0], [2.9, 0], [3.24, -.3], [3.37, .32, whip], [3.7, .16], [4.05, 0]],
  turn: [[2.88, 0], [3.24, -.4], [3.37, .3, whip], [3.8, .22], [4.1, 0]],
  right: [[1.8, 1.9, 1.2, 1], [2.08, 2.1, 3.3, .5], [2.3, 2.1, 3.05, .5], [2.42, 2.05, 3, .5], [2.48, 2, 2.7, .55], [2.53, 1.8, 3.5, .55, whip], [2.64, 1.9, 2.85, .6], [2.88, 1.95, 3, .6], [2.94, 1.95, 2.9, .6], [3, 1.9, 2.65, .6], [3.26, 3.1, 3.1, .3], [3.32, .6, 4.6, .3, whip], [3.5, -1, 3.7, 1.6], [3.85, -.5, 3, 1.4], [4.1, 1.6, 3.8, .4]],
  rightCurl: [[2.3, .2], [2.42, .6], [2.52, .1], [2.6, .4], [2.94, .6], [3, .7], [3.26, 2.5], [3.31, 0, whip], [3.8, .2]],
  left: [[2.3, -1.6, 1.3, 1], [2.55, -2.05, 3.15, .6], [2.7, -2, 3, .6], [2.75, -1.95, 2.75, .6], [2.8, -1.8, 3.5, .6, whip], [2.92, -1.9, 3.1, .6], [3.12, -2.3, 4.2, .5], [3.3, -2.4, 4.4, .4], [3.6, -2.1, 3.6, .8], [4.1, -1.6, 3.8, .4]],
  leftCurl: [[2.3, .2], [2.7, .6], [2.78, .1], [2.9, .3], [3.12, 0], [3.6, .3]],
  blink: [[.8, 0], [.86, 1], [1, 0], [1.38, 0], [1.43, 1], [1.5, 0], [3.02, 0], [3.12, .45], [3.3, .45], [3.34, 0]],
  wide: [[.15, .6], [.84, .6], [1, 0], [1.8, 0], [2.1, .5], [2.4, .2], [3.3, 0], [3.36, 1], [3.7, .6], [4.05, .3], [4.15, 0]],
  smile: [[0, .4], [1.1, .8], [2.45, .6], [2.5, .2], [3, .2], [3.05, .5], [3.3, .4], [3.34, 0], [3.9, 0], [4.05, .6]],
  grin: [[2.42, 0], [2.5, .55], [2.9, .5], [3, 0], [4.1, 0], [4.2, 1]],
  shout: [[.3, .5], [.8, .4], [.9, 0], [3.3, 0], [3.36, 1], [3.75, .9], [3.9, 0]],
  angry: [[2.95, 0], [3.1, .9], [3.3, .9], [3.36, 0]],
  happy: [[4.1, 0], [4.2, 1]],
};

function createYeet(container, title) {
  const { canvas, scene, camera, glow, key, renderer, dispose, warm } = createStage(container);
  seaLights(scene, key, glow);
  const sea = createSea(scene, camera);
  const octo = createOctopus();
  scene.add(octo.root);
  const blob = shadowBlob(scene);

  const rings = [0, 1].map(() => {
    const ring = new Mesh(new TorusGeometry(1, .05, 6, 48), new MeshBasicMaterial({ color: 0xc8f8ff, transparent: true, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .05;
    scene.add(ring);
    return ring;
  });

  const label = String(title ?? '').trim();
  const paperTexture = canvasTexture(512, 512, g => {
    g.fillStyle = '#f1ecd4';
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#0b3a4f';
    g.font = 'bold 35px system-ui';
    g.fillText('SHIP', 38, 65);
    g.font = 'bold 22px system-ui';
    g.fillText(label.slice(0, 28), 38, 118);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? '#8fb3b8' : '#5f8f99';
      g.fillRect(39, 165 + i * 45, 280 + Math.sin(i * 3) * 65, 10);
    }
    g.strokeStyle = '#2fa9bf';
    g.lineWidth = 9;
    g.beginPath();
    for (let x = 38; x <= 300; x += 4) g.lineTo(x, 455 + Math.sin(x / 16) * 9);
    g.stroke();
  });
  const paper = new Group();
  const crumpled = new Mesh(new IcosahedronGeometry(.58, 1), new MeshStandardMaterial({ map: paperTexture, roughness: .6, flatShading: true, side: DoubleSide }));
  crumpled.castShadow = true;
  paper.add(crumpled);
  for (let i = 0; i < 5; i++) {
    const fold = new Mesh(new PlaneGeometry(.42, .58), crumpled.material);
    fold.position.set(Math.sin(i * 2) * .45, Math.cos(i * 2) * .35, .2);
    fold.rotation.set(i * .6, i * 1.2, i * .9);
    paper.add(fold);
  }
  scene.add(paper);

  const twinkleMap = starTexture({ glow: 'rgba(200,250,255,.9)', core: '#f2feff' });
  const star = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: twinkleMap, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  const halo = new Mesh(new TorusGeometry(1, .035, 4, 40), new MeshBasicMaterial({ color: 0xbff8ff, transparent: true, depthWrite: false }));
  scene.add(star, halo);

  const target = new Vector3(), aim = new Vector3(), pole = new Vector3(), mark = new Vector3();
  const camY = camera.position.y;

  function pose(t) {
    const rootY = keys(t, YEET.rootY);
    octo.root.position.set(0, rootY, 0);
    octo.root.rotation.y = keys(t, YEET.turn);
    const shake = pulse(t, 1.05, 1.7);
    octo.torso.rotation.set(keys(t, YEET.lean), 0, Math.sin(t * 26) * shake * .12 + wobble(t, YEET_LANDS + .05, 9, 3.5) * .1);
    octo.squash(keys(t, YEET.squash), t);
    octo.update();

    const splay = smooth(range(t, .4, .7)) * (1 - smooth(range(t, .76, .9)));
    const trail = 1 - smooth(range(t, .35, .6));
    const wR = smooth(range(t, 1.78, 2)) * (1 - smooth(range(t, 4.05, 4.3)));
    const wL = smooth(range(t, 2.3, 2.5)) * (1 - smooth(range(t, 3.95, 4.25)));
    const cheer = smooth(range(t, 4.05, 4.3));
    for (let i = 0; i < ARMS; i++) {
      const o = octo.tentacles[i].outward;
      target.set(o.x * 2.05, (.02 - rootY) / SIZE, o.z * 1.6 + .15);
      pole.copy(DOWN);
      let curl = .9, wave = .08;
      if (trail > 0) {
        aim.set(o.x * .4, -1.1, o.z * .4);
        target.lerp(aim, trail);
        pole.lerp(o, trail);
        wave = mix(wave, .4, trail);
      }
      if (splay > 0) {
        target.lerp(aim.set(o.x * 2.5, 1.6, o.z * 2), splay);
        pole.lerp(UP, splay);
        wave = mix(wave, .3, splay);
        curl = mix(curl, .2, splay);
      }
      if (cheer > 0 && i !== 0 && i !== 7) {
        target.lerp(aim.set(o.x * 3.1, 3.7 + (i % 2) * .5, o.z * .5 + .3), cheer);
        pole.lerp(o, cheer);
        wave = mix(wave, .5, cheer);
        curl = mix(curl, .3, cheer);
      }
      octo.toWorld(target);
      if (i === RIGHT && wR > 0) {
        keys3(t, YEET.right, aim);
        aim.y += Math.sin(t * 22) * .08 * pulse(t, 1.95, 2.3);
        target.lerp(aim, wR);
        pole.lerp(o, wR);
        curl = mix(curl, keys(t, YEET.rightCurl), wR);
        wave = mix(wave, .05, wR);
      }
      if (i === LEFT && wL > 0) {
        target.lerp(keys3(t, YEET.left, aim), wL);
        pole.lerp(o, wL);
        curl = mix(curl, keys(t, YEET.leftCurl), wL);
        wave = mix(wave, .05, wL);
      }
      octo.reach(i, target, pole, curl, wave, t);
    }

    const e = octo.expr;
    e.blink = keys(t, YEET.blink);
    e.wide = keys(t, YEET.wide);
    e.smile = keys(t, YEET.smile);
    e.grin = keys(t, YEET.grin);
    e.shout = keys(t, YEET.shout);
    e.angry = keys(t, YEET.angry);
    e.happy = keys(t, YEET.happy);
    e.brow = e.wide * .6 + pulse(t, 1.9, 2.3) * .6 + Math.sin(t * 20) * pulse(t, 4.3, 4.8) * .5;
    e.cheek = .6 + e.happy * .35 + e.grin * .2;
    e.lookX = Math.sin(t * 7) * shake * .9;
    e.lookY = 0;
  }

  // Where the ball is handed between arms; read from the pose at that beat.
  const handoff = [2.42, 2.53, 2.7, 2.8, 2.94, YEET_LANDS].map(at => {
    pose(at);
    return octo.tip(at < 2.6 || at > 2.9 ? RIGHT : LEFT, new Vector3());
  });
  const origin = handoff[5];
  const dropFrom = new Vector3(2.15, 3.2, .2);
  const far = new Vector3(-6, 9.5, -30);

  function flight(t, into) {
    const s = 1 - Math.exp(-Math.max(0, t - YEET_LANDS) * 4.4);
    into.lerpVectors(origin, far, s);
    into.y += Math.sin(s * Math.PI) * 1.2;
    return into;
  }

  function ballAt(t, into) {
    if (t < 2.42) {
      const k = range(t, 2.28, 2.42);
      into.lerpVectors(dropFrom, handoff[0], fall(k));
      return into;
    }
    if (t < 2.53) return octo.tip(RIGHT, into).add(mark.set(0, .14, 0));
    if (t < 2.7) return arc(t, 2.53, 2.7, handoff[1], handoff[2], 1.3, into);
    if (t < 2.8) return octo.tip(LEFT, into).add(mark.set(0, .14, 0));
    if (t < 2.94) return arc(t, 2.8, 2.94, handoff[3], handoff[4], 1.1, into);
    if (t < YEET_LANDS) return octo.tip(RIGHT, into).add(mark.set(0, .14, 0));
    return flight(t, into);
  }

  function arc(t, a, b, from, to, height, into) {
    const k = range(t, a, b);
    into.lerpVectors(from, to, k);
    into.y += 4 * k * (1 - k) * height + (k < .5 ? .14 * k * 2 : .14 * (2 - k * 2));
    return into;
  }

  const ball = new Vector3();
  const head = new Vector3();
  function render(t) {
    pose(t);
    sea.open(t);
    const thrown = t >= YEET_LANDS;
    paper.visible = t > 2.28 && t < 4.02;
    if (paper.visible) {
      ballAt(t, ball);
      paper.position.copy(ball);
      const catchSquash = wobble(t, 2.42, 30, 12) + wobble(t, 2.7, 30, 12) + wobble(t, 2.94, 30, 12);
      const size = thrown ? .68 * (1 - range(t, 3.82, 4.02)) : .68 * back(range(t, 2.28, 2.45));
      paper.scale.set(size * (1 + catchSquash * .2), size * (1 - catchSquash * .25), size);
      paper.rotation.set(t * (thrown ? 9 : 1.3), t * (thrown ? 12 : .7), t * (thrown ? 7 : .3));
      if (t > 2.3 && t < 3.6) lookToward(octo, ball);
      for (let k = 0; k < 14 && thrown; k++) {
        const born = YEET_LANDS + .02 + k * .04;
        const age = t - born;
        if (age < 0 || age > .75) continue;
        flight(born, mark);
        sea.bubble(mark.x + Math.sin(k * 2.1) * .15, mark.y + age * .8, mark.z, (.1 + (k % 3) * .06) * clamp(age * 12) * (1 - range(age, .5, .75)));
      }
    } else if (t > 3.6 && t < 4.15) lookToward(octo, flight(4, ball));
    octo.face();

    for (let r = 0; r < 2; r++) {
      const at = .15 + r * .22;
      const k = range(t, at, at + .9);
      rings[r].visible = k > 0 && k < 1;
      rings[r].scale.setScalar(.5 + out(k) * (3 - r * .6));
      rings[r].material.opacity = .85 * (1 - k);
    }
    for (let k = 0; k < 26; k++) {
      const age = t - (.2 + (k % 4) * .03);
      if (age < 0 || age > 1.4) continue;
      const a = k * 2.39996;
      const spread = .7 + (1.6 + (k % 5) * .35) * age;
      const height = (4.2 + (k % 7) * .45) * age - 4.9 * age * age;
      if (height > 0) sea.drop(Math.cos(a) * spread, height, Math.sin(a) * spread * .7 + .2, .06 + (k % 3) * .025, 1.4);
    }
    for (let k = 0; k < 16; k++) {
      const age = t - (.2 + k * .04);
      if (age < 0 || age > 2) continue;
      sea.bubble(Math.sin(k * 2.4) * 1.2 + Math.sin(age * 6 + k) * .15, .3 + (2.2 + (k % 4) * .4) * age, Math.cos(k * 2.4) * .8 + .4, (.12 + (k % 3) * .07) * (1 - range(age, 1.5, 2)));
    }
    for (let k = 0; k < 10; k++) {
      const age = t - (1.08 + k * .05);
      if (age < 0 || age > 1) continue;
      const side = k % 2 ? 1 : -1;
      const height = 3.2 + (2.4 + (k % 4) * .4) * age - 4.9 * age * age;
      if (height > 0) sea.drop(side * (.8 + (2 + (k % 3) * .6) * age), height, .4, .055 + (k % 2) * .02, 1.3);
    }
    octo.body.getWorldPosition(head);
    for (let k = 0; k < 8; k++) {
      const age = t - (k < 4 ? 1.55 + k * .12 : 4.3 + (k - 4) * .1);
      if (age < 0 || age > 1.2) continue;
      sea.bubble(head.x + Math.sin(age * 7 + k) * .1, head.y - .5 + age * 1.6, head.z + 1.05, (.07 + (k % 2) * .04) * clamp(age * 8));
    }
    if (thrown) {
      const age = t - YEET_LANDS;
      for (let k = 0; k < 14; k++) {
        if (age > 1.2) break;
        const a = k * 2.39996;
        const reach = (1 - Math.exp(-age * 5)) * (1 + (k % 3) * .4);
        sea.bubble(origin.x + Math.cos(a) * reach, origin.y + Math.sin(a) * reach * .8 + age * .9, origin.z + .3, (.1 + (k % 3) * .06) * (1 - range(age, .8, 1.2)));
      }
      for (let k = 0; k < 18; k++) {
        if (age > .9) break;
        const a = k * 2.39996;
        const speed = 2 + (k % 4) * .5;
        sea.drop(origin.x + Math.cos(a) * speed * age, origin.y + (Math.sin(a) * speed + 1.2) * age - 4.9 * age * age, origin.z + (k % 3) * age, (.05 + (k % 3) * .02) * (1 - range(age, .6, .9)));
      }
    }
    sea.close();

    const pop = range(t, 3.98, 4.12);
    const fade = 1 - range(t, 4.12, 4.45);
    star.visible = halo.visible = pop > 0 && fade > 0;
    flight(4, star.position);
    star.quaternion.copy(camera.quaternion);
    star.rotateZ(t * 3);
    star.scale.setScalar(2.8 * back(pop, 2.4) * fade);
    star.material.opacity = fade;
    halo.position.copy(star.position);
    halo.quaternion.copy(camera.quaternion);
    halo.scale.setScalar(.2 + out(range(t, 3.98, 4.35)) * 2.6);
    halo.material.opacity = (1 - range(t, 4, 4.35)) * .8;

    const height = octo.root.position.y;
    blob.position.set(0, .01, .15);
    blob.scale.set(2.3, 1.5, 1).multiplyScalar(1 - clamp(height / 1.5) * .4);
    blob.material.opacity = .3 * range(height, -1, 0) * (1 - clamp(height) * .5);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + pulse(t, 3.3, 3.7) * 8;
    const impact = pulse(t, YEET_LANDS, 3.6) * .035;
    const thud = pulse(t, .84, 1.05) * .04;
    camera.position.x = .25 + Math.sin(t * 90) * impact;
    camera.position.y = camY + Math.sin(t * 75) * thud;
    renderer.render(scene, camera);
  }
  const textures = [...octo.textures, ...sea.textures, paperTexture, twinkleMap];
  return { ready: warm(() => render(YEET_LANDS)), canvas, render, dispose: () => dispose(textures) };
}

// PR opened: two knocks on the chest at 1.5 and 1.95, and the lid flies open
// at 3.05 as the overlay's word pops.
const PR_LANDS = 3.05;
const PR = {
  root: [[.1, -3.4, 3.7, -1.3], [.95, -1.6, 0, -.3, out]],
  hop: [[3.05, 0], [3.32, .75, out], [3.58, 0, fall], [3.76, .35, out], [3.93, 0, fall], [4.06, .18, out], [4.2, 0, fall]],
  squash: [[.1, .14], [.85, .1], [.97, -.26, out], [1.1, .1], [1.25, 0], [1.42, .06], [1.5, -.12, whip], [1.62, 0], [1.87, .06], [1.95, -.14, whip], [2.1, 0], [2.4, .05], [2.75, -.04], [2.98, -.2], [3.07, .24, whip], [3.3, .12], [3.58, -.16], [3.7, .1], [3.93, -.09], [4.06, .06], [4.25, 0]],
  turn: [[0, .55], [1, .38], [2.9, .38], [3.1, .05]],
  lean: [[.1, .2], [1, 0], [1.4, -.08], [1.5, .15, whip], [1.7, 0], [1.87, -.08], [1.95, .18, whip], [2.15, 0], [2.3, .12], [2.75, .15], [2.98, -.2], [3.1, .05], [3.4, 0]],
  right: [[1, -.3, 1.4, .9], [1.18, .1, 2.9, .7], [1.42, .35, 3.35, .6], [1.5, .8, 2, .6, whip], [1.62, .55, 2.6, .6], [1.85, .4, 3.35, .6], [1.95, .85, 2, .6, whip], [2.08, .55, 2.5, .7], [2.3, -.9, 1.9, 1.25], [2.92, -.95, 1.85, 1.25]],
  rightCurl: [[1, .4], [1.15, 1], [1.95, 1], [2.1, .5], [2.3, 1.4]],
  blink: [[.9, 0], [.95, 1], [1.05, 0], [1.46, 0], [1.5, .8], [1.6, 0], [1.91, 0], [1.95, .8], [2.05, 0]],
  wide: [[0, .5], [.9, .4], [1.05, 0], [2.05, 0], [2.2, .9], [2.95, .9], [3.05, 0]],
  smile: [[0, .7], [1.2, .5], [1.4, .2], [2.1, .3], [2.2, 0], [3.05, 0]],
  grin: [[1.2, 0], [1.4, .5], [2.05, .5], [2.2, 0], [3.05, 0], [3.12, 1]],
  shout: [[2.15, 0], [2.3, .45], [2.95, .4], [3.05, 0]],
  angry: [[1.2, 0], [1.4, .6], [2, .6], [2.15, 0]],
  happy: [[3.05, 0], [3.12, 1]],
};

function createPr(container, title) {
  const { canvas, scene, camera, glow, key, renderer, dispose, warm } = createStage(container);
  seaLights(scene, key, glow);
  const sea = createSea(scene, camera);
  const octo = createOctopus();
  scene.add(octo.root);
  const blob = shadowBlob(scene);

  const label = String(title ?? '').trim();
  const plaqueTexture = canvasTexture(512, 256, g => {
    g.fillStyle = '#c99a3a';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#f6ecc9';
    g.fillRect(16, 16, 480, 224);
    g.fillStyle = '#4a3215';
    g.font = 'bold 84px system-ui';
    g.fillText('PR', 40, 104);
    g.font = 'bold 42px system-ui';
    wrap(label, 432, 2, 'bold 42px system-ui').forEach((line, i) => g.fillText(line, 40, 160 + i * 48));
  });
  const glowTexture = canvasTexture(128, 128, g => {
    const shine = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    shine.addColorStop(0, 'rgba(255,232,150,1)');
    shine.addColorStop(.35, 'rgba(255,200,90,.55)');
    shine.addColorStop(1, 'rgba(255,190,80,0)');
    g.fillStyle = shine;
    g.fillRect(0, 0, 128, 128);
  });
  const glintTexture = starTexture({ glow: 'rgba(255,236,170,.9)', core: '#fff7da' });

  const chest = new Group();
  chest.position.set(1.4, 0, .5);
  chest.rotation.y = -.38;
  chest.scale.setScalar(1.25);
  scene.add(chest);
  const sand = new Mesh(new SphereGeometry(1, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: 0xe6cf98, roughness: 1 }));
  sand.scale.set(1.8, .2, 1.25);
  sand.receiveShadow = true;
  chest.add(sand);
  const box = new Group();
  chest.add(box);
  const wood = new MeshStandardMaterial({ color: 0x8a5a2b, roughness: .75 });
  const gold = new MeshStandardMaterial({ color: 0xf2c14e, roughness: .3, metalness: .85, emissive: 0x3a2400, emissiveIntensity: .5 });
  const ink = new MeshStandardMaterial({ color: 0x2a1708, roughness: .8 });
  const trunk = new Mesh(new BoxGeometry(1.9, .95, 1.2), wood);
  trunk.position.y = .475;
  trunk.castShadow = true;
  box.add(trunk);
  const strap = new BoxGeometry(.11, .97, 1.23);
  [-.62, .62].forEach(x => {
    const band = new Mesh(strap, gold);
    band.position.set(x, .475, 0);
    box.add(band);
  });
  const rim = new Mesh(new BoxGeometry(1.95, .08, 1.25), gold);
  rim.position.y = .92;
  box.add(rim);
  const plaque = new Mesh(new PlaneGeometry(1.1, .55), new MeshStandardMaterial({ map: plaqueTexture, roughness: .5 }));
  plaque.position.set(0, .42, .605);
  box.add(plaque);
  const hoard = new Mesh(new SphereGeometry(.55, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: 0xffc94a, roughness: .25, metalness: .9, emissive: 0x9a6400, emissiveIntensity: .6 }));
  hoard.scale.set(1.5, .5, .9);
  hoard.position.y = .9;
  box.add(hoard);
  const hinge = new Group();
  hinge.position.set(0, .95, -.6);
  box.add(hinge);
  const lid = new Mesh(new CylinderGeometry(.6, .6, 1.9, 24, 1, false, 0, Math.PI), new MeshStandardMaterial({ color: 0x96632f, roughness: .75, side: DoubleSide }));
  lid.rotation.z = Math.PI / 2;
  lid.position.z = .6;
  lid.castShadow = true;
  hinge.add(lid);
  const hoop = new TorusGeometry(.61, .045, 6, 20, Math.PI);
  [-.62, .62].forEach(x => {
    const band = new Mesh(hoop, gold);
    band.rotation.y = Math.PI / 2;
    band.position.set(x, 0, .6);
    hinge.add(band);
  });
  const lock = new Mesh(new BoxGeometry(.26, .32, .07), gold);
  lock.position.set(0, -.02, 1.2);
  hinge.add(lock);
  const keyhole = new Mesh(new BoxGeometry(.05, .12, .02), ink);
  keyhole.position.set(0, -.06, 1.24);
  hinge.add(keyhole);
  const lamp = new PointLight(0xffc860, 0, 7, 1.6);
  lamp.position.set(0, 1.2, .2);
  box.add(lamp);
  const shineMaterial = new MeshBasicMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
  const shine = new Mesh(new PlaneGeometry(1, 1), shineMaterial);
  scene.add(shine);

  const coins = createSwarm(scene, new CylinderGeometry(.13, .13, .035, 18), gold, 26);
  const pearls = createSwarm(scene, new SphereGeometry(.085, 14, 10), new MeshStandardMaterial({ color: 0xfff4ee, roughness: .18, metalness: .1, emissive: 0x6a5a66, emissiveIntensity: .25 }), 12);
  const glintMaterial = new MeshBasicMaterial({ map: glintTexture, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
  const glints = Array.from({ length: 7 }, () => {
    const glint = new Mesh(new PlaneGeometry(1, 1), glintMaterial);
    scene.add(glint);
    return glint;
  });
  const bonks = [1.5, 1.95].map(() => {
    const ring = new Mesh(new TorusGeometry(1, .04, 4, 32), new MeshBasicMaterial({ color: 0xe8fdff, transparent: true, depthWrite: false, toneMapped: false }));
    scene.add(ring);
    return ring;
  });

  const target = new Vector3(), aim = new Vector3(), pole = new Vector3(), mark = new Vector3();
  const knock = new Vector3();
  const spout = new Vector3();
  const spin = new Euler(), turn = new Quaternion();
  const camY = camera.position.y;

  function pose(t) {
    keys3(t, PR.root, mark);
    const paddle = 1 - smooth(range(t, .78, .98));
    mark.y += keys(t, PR.hop) + Math.sin(t * 9) * .1 * paddle;
    octo.root.position.copy(mark);
    octo.root.rotation.y = keys(t, PR.turn);
    const fidget = range(t, 2.2, 2.4) * (1 - range(t, 2.95, 3.05));
    octo.torso.rotation.set(keys(t, PR.lean), 0, Math.sin(t * 13) * .05 * fidget);
    octo.squash(keys(t, PR.squash), t);
    octo.update();

    const stroke = .5 + .5 * Math.sin(t * 9);
    const wR = smooth(range(t, 1, 1.15)) * (1 - smooth(range(t, 2.98, 3.1)));
    const cheer = smooth(range(t, 3.05, 3.2));
    for (let i = 0; i < ARMS; i++) {
      const o = octo.tentacles[i].outward;
      target.set(o.x * 2.05, (.02 - mark.y) / SIZE, o.z * 1.6 + .15);
      pole.copy(DOWN);
      let curl = .9, wave = .08;
      if (paddle > 0) {
        aim.set(o.x * mix(.9, 2.3, stroke), mix(-.7, 1.9, stroke), o.z * mix(.9, 2, stroke));
        target.lerp(aim, paddle);
        pole.lerp(o, paddle);
        wave = mix(wave, .25, paddle);
        curl = mix(curl, .3, paddle);
      }
      if (fidget > 0 && (i === 0 || i === 7)) {
        target.lerp(aim.set(o.x * .9, 1.9 + Math.sin(t * 17 + i) * .1, 1.1), fidget);
        curl = mix(curl, 1.4, fidget);
        wave = mix(wave, .3, fidget);
      }
      if (cheer > 0 && (i === 1 || i === 2 || i === 5 || i === 6)) {
        target.lerp(aim.set(o.x * 3.1, 3.6 + (i % 2) * .5, o.z * .5 + .3), cheer);
        pole.lerp(o, cheer);
        wave = mix(wave, .5, cheer);
        curl = mix(curl, .3, cheer);
      }
      octo.toWorld(target);
      if (i === RIGHT && wR > 0) {
        target.lerp(keys3(t, PR.right, aim), wR);
        pole.lerp(o, wR);
        curl = mix(curl, keys(t, PR.rightCurl), wR);
        wave = mix(wave, .04, wR);
      }
      octo.reach(i, target, pole, curl, wave, t);
    }

    const e = octo.expr;
    e.blink = keys(t, PR.blink);
    e.wide = keys(t, PR.wide);
    e.smile = keys(t, PR.smile);
    e.grin = keys(t, PR.grin);
    e.shout = keys(t, PR.shout);
    e.angry = keys(t, PR.angry);
    e.happy = keys(t, PR.happy);
    e.brow = e.wide * .5 + Math.sin(t * 20) * pulse(t, 3.4, 4.2) * .5;
    e.cheek = .6 + e.happy * .4;
  }

  function render(t) {
    pose(t);
    sea.open(t);
    lookToward(octo, chest.position);
    if (t < .9) octo.expr.lookY = -.6;
    if (t > 3.05) {
      octo.expr.lookX = 0;
      octo.expr.lookY = .2;
    }
    octo.face();

    const before = t < PR_LANDS ? 1 : 0;
    const rattle = range(t, 2.2, 3) * before;
    box.rotation.z = wobble(t, 1.5, 30, 8) * .05 + wobble(t, 1.95, 30, 7) * .07 + Math.sin(t * 47) * .04 * rattle;
    box.position.y = Math.abs(Math.sin(t * 23)) * .06 * rattle;
    box.scale.y = 1 - .07 * pulse(t, 1.5, 1.6) - .09 * pulse(t, 1.95, 2.07) + wobble(t, PR_LANDS, 20, 7) * .1;
    const open = range(t, PR_LANDS, 3.22);
    hinge.rotation.x = -.15 * pulse(t, 1.5, 1.68) - .34 * pulse(t, 1.95, 2.3)
      - (.06 + .1 * Math.abs(Math.sin(t * 31))) * rattle
      - (t >= PR_LANDS ? 2.05 * back(open, 2.2) + wobble(t, 3.22, 10, 5) * .15 : 0);
    const leak = .5 * pulse(t, 1.95, 2.3) + rattle * (.45 + .3 * Math.sin(t * 31));
    const burst = pulse(t, PR_LANDS, 3.75);
    const steady = range(t, PR_LANDS, 3.2);
    lamp.intensity = leak * 7 + burst * 34 + steady * 9;
    chest.localToWorld(spout.set(0, 1.05, 0));
    shine.position.copy(spout);
    shine.position.z += .3;
    shine.quaternion.copy(camera.quaternion);
    shine.scale.setScalar(.6 + leak * 1.2 + burst * 4.2 + steady * 1.4);
    shineMaterial.opacity = clamp(leak * .8 + burst + steady * .55);
    shine.visible = shineMaterial.opacity > .01;

    for (let k = 0; k < 2; k++) {
      const at = k ? 1.95 : 1.5;
      const age = range(t, at, at + .35);
      bonks[k].visible = age > 0 && age < 1;
      knock.set(k ? .85 : .8, 2.02, .6);
      bonks[k].position.copy(knock);
      bonks[k].quaternion.copy(camera.quaternion);
      bonks[k].scale.setScalar(.15 + out(age) * (.8 + k * .3));
      bonks[k].material.opacity = (1 - age) * .9;
      for (let j = 0; j < 5; j++) {
        const life = t - at;
        if (life > 0 && life < .9) sea.bubble(knock.x + Math.sin(j * 2.4) * .3 * life * 3, knock.y + life * 1.4 + j * .05, knock.z + .3, (.06 + (j % 2) * .04) * (1 - range(life, .6, .9)));
      }
    }

    coins.begin();
    pearls.begin();
    const age0 = t - PR_LANDS;
    for (let k = 0; k < 34 && age0 > 0; k++) {
      const pearl = k >= 24;
      const age = age0 - (k % 6) * .018;
      if (age <= 0) continue;
      const a = k * 2.39996;
      const vx = Math.cos(a) * (.7 + (k % 3) * .55) - .2;
      const vz = .5 + Math.abs(Math.sin(a)) * 1.3;
      const vy = (pearl ? 4.2 : 5) + (k % 5) * .6;
      const y0 = 1.05;
      const landing = (vy + Math.sqrt(vy * vy + 19.6 * (y0 - .04))) / 9.8;
      const flying = Math.min(age, landing);
      const x = spout.x + Math.sin(a) * .35 + vx * flying;
      const z = spout.z + vz * flying;
      const y = Math.max(.04, y0 + vy * flying - 4.9 * flying * flying);
      if (pearl) pearls.add(x, y + .05, z, 1);
      else {
        spin.set(age < landing ? age * 11 + k : 0, age < landing ? age * 7 : k, 0);
        turn.setFromEuler(spin);
        coins.add(x, y, z, 1, 1, 1, turn);
      }
      if (k < glints.length) {
        const glint = glints[k];
        const twinkle = Math.max(0, Math.sin(t * 13 + k * 1.7));
        glint.visible = twinkle > .05;
        glint.position.set(x, y + .1, z + .15);
        glint.quaternion.copy(camera.quaternion);
        glint.rotateZ(t * 4 + k);
        glint.scale.setScalar(.65 * twinkle);
      }
    }
    for (let k = 0; k < glints.length && age0 <= 0; k++) glints[k].visible = false;
    coins.end();
    pearls.end();

    for (let k = 0; k < 22 && age0 > 0; k++) {
      const age = age0 - (k % 5) * .03;
      if (age < 0 || age > 1.6) continue;
      const a = k * 2.39996;
      const spread = (1 - Math.exp(-age * 4)) * (.6 + (k % 4) * .3);
      sea.bubble(spout.x + Math.cos(a) * spread, spout.y + .2 + age * (1.8 + (k % 3) * .5), spout.z + Math.sin(a) * spread * .6 + .3, (.09 + (k % 3) * .06) * (1 - range(age, 1.2, 1.6)));
    }
    sea.close();

    blob.position.set(octo.root.position.x, .01, octo.root.position.z + .15);
    blob.scale.set(2.2, 1.4, 1).multiplyScalar(1 - clamp(octo.root.position.y / 1.5) * .45);
    blob.material.opacity = .3 * (1 - clamp(octo.root.position.y / 3));
    glow.intensity = 9 + Math.sin(t * 3) * 3 + burst * 10;
    const impact = pulse(t, PR_LANDS, 3.35) * .05 + pulse(t, 1.5, 1.6) * .015 + pulse(t, 1.95, 2.05) * .02;
    camera.position.x = .25 + Math.sin(t * 90) * impact;
    camera.position.y = camY + Math.sin(t * 75) * pulse(t, .95, 1.1) * .03;
    renderer.render(scene, camera);
  }
  const textures = [...octo.textures, ...sea.textures, plaqueTexture, glowTexture, glintTexture];
  return { ready: warm(() => render(PR_LANDS)), canvas, render, dispose: () => dispose(textures) };
}

// Plan reveal: a message in a bottle bobs up, the cork pops at 2.55 as the
// overlay's word lands, and the unrolled scroll is pushed out to `PLAN_FRONT`,
// where the send-offs plugin pushes in on it.
const PLAN_LANDS = 2.55;
const SHEET_HEIGHT = 1.75;
// Sheet width, and the scroll's scale, at the front; plan-scene.js uses the
// same pair.
const SHEET_WIDTH = 1.843;
const FRONT_SCALE = 1.25;
const PLAN_FRONT = new Vector3(.25, 3.45, 6);
const HELD = new Vector3(.15, 4.05, 1.7);
const UNROLL = [3.05, 3.26];
const BOTTLE = 1.45;
const PUSH = [3.36, 3.95];
const TOSS = 2.95;
const PLAN = {
  bottle: [[.2, 1.95, -1.6, 1.2], [1.15, 1.8, 2.05, 1.35, out], [1.42, 1.7, 2, 1.35], [1.95, .45, 1.85, 1.7], [2.5, .4, 1.85, 1.7], [2.55, .7, 1.8, 1.7, whip], [2.7, .65, 1.82, 1.7], [TOSS, .7, 1.85, 1.7]],
  bottleTurn: [[.2, .3], [1.42, .2], [1.95, Math.PI / 2]],
  squash: [[0, 0], [1.38, .04], [1.44, -.1, whip], [1.6, .04], [1.75, 0], [2.1, -.05], [2.5, .08], [2.55, -.2, whip], [2.65, .2], [2.8, 0], [3.3, .06], [3.4, -.12], [3.5, .12, whip], [3.7, 0]],
  lean: [[0, 0], [1.2, .12], [1.42, -.05], [1.95, .05], [2.5, -.18], [2.55, .1, whip], [2.75, -.15], [3, 0], [3.3, -.15], [3.45, .25, whip], [3.8, 0]],
  tilt: [[0, 0], [.9, -.1], [1.3, 0], [1.6, .14], [1.9, -.06], [2.1, 0], [2.5, -.08], [2.58, .22, whip], [2.85, 0]],
  rootY: [[3.45, 0], [3.65, .5, out], [3.85, 0, fall], [3.98, .25, out], [4.1, 0, fall]],
  blink: [[.6, 0], [.65, 1], [.72, 0], [2.08, 0], [2.18, .75], [2.52, .75], [2.55, 0]],
  wide: [[.8, 0], [.95, .7], [1.4, .4], [1.6, 0], [2.52, 0], [2.56, 1], [2.85, .4], [3, 0]],
  smile: [[0, .7], [2.08, .6], [2.15, 0], [2.85, 0], [3, .3]],
  grin: [[1.42, 0], [1.5, .6], [1.8, .4], [2.08, 0], [2.8, 0], [2.95, .8]],
  shout: [[2.53, 0], [2.57, 1], [2.85, .8], [2.95, 0]],
  angry: [[2.05, 0], [2.15, .9], [2.52, .9], [2.56, 0]],
  cheek: [[0, .6], [2.08, .6], [2.18, 1.4], [2.52, 1.4], [2.56, .5], [3.4, .7]],
  happy: [[3.38, 0], [3.48, 1]],
};

function createPlan(container, title) {
  const { canvas, scene, camera, glow, key, renderer, dispose, warm } = createStage(container);
  seaLights(scene, key, glow);
  const sea = createSea(scene, camera);
  const octo = createOctopus();
  octo.root.position.set(-.1, 0, -.5);
  scene.add(octo.root);
  const blob = shadowBlob(scene);
  blob.position.set(-.1, .01, -.35);
  blob.scale.set(2.2, 1.4, 1);

  const label = String(title ?? '').trim();
  const sheetTexture = canvasTexture(512, 384, g => {
    g.fillStyle = '#e8e3c9';
    g.fillRect(0, 0, 512, 384);
    g.fillStyle = '#345144';
    g.font = 'bold 40px system-ui';
    g.fillText('THE PLAN', 40, 70);
    g.font = 'bold 24px system-ui';
    wrap(label, 432, 2, 'bold 24px system-ui').forEach((line, i) => g.fillText(line, 40, 116 + i * 30));
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = '#2a8fae';
      g.lineWidth = 4;
      g.strokeRect(42, 190 + i * 36, 18, 18);
      g.beginPath();
      g.moveTo(45, 199 + i * 36);
      g.lineTo(51, 205 + i * 36);
      g.lineTo(64, 186 + i * 36);
      g.stroke();
      g.fillStyle = i % 2 ? '#a1a695' : '#818f7d';
      g.fillRect(78, 194 + i * 36, 250 + Math.sin(i * 3) * 80, 10);
    }
    g.strokeStyle = '#2fa9bf';
    g.lineWidth = 5;
    g.beginPath();
    for (let x = 40; x <= 300; x += 4) g.lineTo(x, 350 + Math.sin(x / 14) * 7);
    g.stroke();
    g.fillStyle = '#2a8fae';
    g.font = 'bold 26px system-ui';
    g.fillText('blub~', 380, 358);
  });

  // The top rod is what the arms hold; the sheet and bottom rod hang from it.
  const scroll = new Group();
  const sheet = new Mesh(new PlaneGeometry(SHEET_WIDTH, SHEET_HEIGHT), new MeshStandardMaterial({ map: sheetTexture, roughness: .92, side: DoubleSide }));
  sheet.castShadow = true;
  scroll.add(sheet);
  const woodMaterial = new MeshStandardMaterial({ color: 0x6a4630, roughness: .7 });
  const pearlMaterial = new MeshStandardMaterial({ color: 0xfff2f6, roughness: .16, metalness: .1, emissive: 0x6a5a66, emissiveIntensity: .25 });
  const rodShape = new CylinderGeometry(.075, .075, SHEET_WIDTH + .1, 14);
  const knobShape = new SphereGeometry(.12, 14, 10);
  const rods = [0, 1].map(() => {
    const rod = new Group();
    const shaft = new Mesh(rodShape, woodMaterial);
    shaft.rotation.z = Math.PI / 2;
    shaft.castShadow = true;
    rod.add(shaft);
    [-1, 1].forEach(side => {
      const knob = new Mesh(knobShape, pearlMaterial);
      knob.position.x = side * (SHEET_WIDTH / 2 + .1);
      rod.add(knob);
    });
    rod.position.z = .04;
    scroll.add(rod);
    return rod;
  });
  const roll = new Mesh(new CylinderGeometry(1, 1, SHEET_WIDTH, 18), new MeshStandardMaterial({ color: 0xd9d2b0, roughness: .9 }));
  roll.rotation.z = Math.PI / 2;
  rods[1].add(roll);
  const ribbon = new Mesh(new TorusGeometry(1, .16, 6, 18), new MeshStandardMaterial({ color: 0xe0457b, roughness: .5 }));
  ribbon.rotation.y = Math.PI / 2;
  rods[1].add(ribbon);
  scene.add(scroll);

  const glass = new MeshStandardMaterial({ color: 0x8fe8d0, transparent: true, opacity: .4, roughness: .06, metalness: .1, depthWrite: false, side: DoubleSide });
  const profile = [[.001, -.5], [.25, -.5], [.27, -.46], [.27, .25], [.22, .4], [.12, .5], [.1, .58], [.1, .76], [.125, .79], [.11, .82]].map(([x, y]) => new Vector2(x, y));
  const bottle = new Group();
  const vessel = new Mesh(new LatheGeometry(profile, 22), glass);
  vessel.renderOrder = 1;
  bottle.add(vessel);
  bottle.scale.setScalar(BOTTLE);
  scene.add(bottle);
  const cork = new Mesh(new CylinderGeometry(.115, .09, .2, 14), new MeshStandardMaterial({ color: 0xb07a45, roughness: .9 }));
  cork.scale.setScalar(BOTTLE);
  scene.add(cork);

  const target = new Vector3(), aim = new Vector3(), pole = new Vector3(), mark = new Vector3();
  const axis = new Vector3(), center = new Vector3(), left = new Vector3(), right = new Vector3(), neck = new Vector3();
  const popAt = new Vector3(), tossAt = new Vector3(), corkSpin = new Euler(), corkTurn = new Quaternion();

  function bottleAt(t, into) {
    keys3(t, PLAN.bottle, into);
    const hold = smooth(range(t, 1.3, 1.45));
    into.y += Math.sin(t * 3.2) * .12 * (1 - hold);
    into.x += Math.sin(t * 40) * .03 * pulse(t, 2.1, 2.52);
    return into;
  }
  function bottleTurn(t) {
    return keys(t, PLAN.bottleTurn) + Math.sin(t * 2.4) * .25 * (1 - smooth(range(t, 1.3, 1.45))) + wobble(t, PLAN_LANDS, 16, 5) * .2;
  }
  function tug(t) {
    return range(t, 2.12, 2.5) * .1 + Math.abs(Math.sin(t * 28)) * .025 * pulse(t, 2.12, 2.52);
  }

  const scrollState = { scale: .42, unroll: 0, lift: 0 };
  function placeScroll(t) {
    const angle = bottleTurn(Math.min(t, TOSS));
    bottleAt(Math.min(t, TOSS), center);
    axis.set(-Math.sin(angle), Math.cos(angle), 0);
    const slide = smooth(range(t, 2.7, TOSS)) * 1.7;
    scroll.position.copy(center).addScaledVector(axis, .05 + slide);
    scroll.rotation.set(0, 0, angle - Math.PI / 2);
    let scale = .42;
    const raise = smooth(range(t, TOSS, 3.12));
    if (raise > 0) {
      scroll.position.lerp(HELD, raise);
      scroll.rotation.z *= 1 - raise;
      scale = mix(.42, .75, raise);
    }
    scroll.position.y += .05 * wobble(t, UNROLL[1], 14, 6);
    const lift = 1 - (1 - range(t, PUSH[0], PUSH[1])) ** 3;
    if (lift > 0) {
      scroll.position.lerp(PLAN_FRONT, lift);
      scroll.position.y += Math.sin(lift * Math.PI) * .3;
      scale = mix(.75, FRONT_SCALE, lift);
    }
    scroll.scale.setScalar(scale);
    scroll.updateMatrixWorld(true);
    scrollState.scale = scale;
    scrollState.lift = lift;
    scrollState.unroll = range(t, UNROLL[0], UNROLL[1]) ** 2;
    scroll.localToWorld(left.set(-SHEET_WIDTH / 2 - .1, 0, 0));
    scroll.localToWorld(right.set(SHEET_WIDTH / 2 + .1, 0, 0));
  }

  function pose(t) {
    octo.root.position.y = keys(t, PLAN.rootY);
    octo.torso.rotation.set(keys(t, PLAN.lean), Math.sin(t * 1.4) * .05, keys(t, PLAN.tilt) + Math.sin(t * 30) * .03 * pulse(t, 2.12, 2.52));
    octo.squash(keys(t, PLAN.squash) + Math.sin(t * 34) * .03 * pulse(t, 2.12, 2.52), t);
    octo.update();
    placeScroll(t);
    const angle = bottleTurn(Math.min(t, TOSS));
    bottleAt(Math.min(t, TOSS), center);
    axis.set(-Math.sin(angle), Math.cos(angle), 0);
    neck.copy(center).addScaledVector(axis, (.72 + (t < PLAN_LANDS ? tug(t) : 0)) * BOTTLE);

    const wR = smooth(range(t, 1.12, 1.42));
    const wL = smooth(range(t, 1.72, 1.95));
    const recoil = pulse(t, PLAN_LANDS, 2.8);
    const onRod = smooth(range(t, TOSS + .02, 3.12));
    const letGo = smooth(range(t, 3.45, 3.62));
    const cheer = smooth(range(t, 3.48, 3.7));
    for (let i = 0; i < ARMS; i++) {
      const o = octo.tentacles[i].outward;
      target.set(o.x * 2.05, (.02 - octo.root.position.y) / SIZE, o.z * 1.6 + .15);
      pole.copy(DOWN);
      let curl = .9, wave = .1;
      if (cheer > 0 && i !== 0 && i !== 7 && i !== RIGHT && i !== LEFT) {
        target.lerp(aim.set(o.x * 3.1, 3.6 + (i % 2) * .5, o.z * .5 + .3), cheer);
        pole.lerp(o, cheer);
        wave = mix(wave, .5, cheer);
        curl = mix(curl, .3, cheer);
      }
      octo.toWorld(target);
      if (i === RIGHT && wR > 0) {
        aim.copy(center).addScaledVector(axis, -.3 * BOTTLE);
        if (t > TOSS) aim.copy(tossAt).add(mark.set(.6, .5, 0)).lerp(right, onRod);
        target.lerp(aim, wR * (1 - letGo));
        pole.lerp(o, wR);
        curl = mix(curl, 1.1, wR * (1 - letGo));
        wave = mix(wave, .03, wR * (1 - letGo));
      }
      if (i === LEFT && wL > 0) {
        aim.copy(t < PLAN_LANDS ? neck : left);
        if (t >= PLAN_LANDS && t < 2.75) aim.lerp(mark.set(-2.3, 3.3, .6), recoil * 1.3 > 1 ? 1 : recoil * 1.3);
        target.lerp(aim, wL * (1 - letGo));
        pole.lerp(o, wL);
        curl = mix(curl, 1.1, wL * (1 - letGo));
        wave = mix(wave, .03, wL * (1 - letGo));
      }
      if (letGo > 0 && (i === RIGHT || i === LEFT)) {
        aim.set(o.x * 3.1, 3.9, .6);
        octo.toWorld(aim);
        target.lerp(aim, cheer);
        wave = mix(wave, .5, cheer);
      }
      octo.reach(i, target, pole, curl, wave, t);
    }

    const e = octo.expr;
    e.blink = keys(t, PLAN.blink);
    e.wide = keys(t, PLAN.wide);
    e.smile = keys(t, PLAN.smile);
    e.grin = keys(t, PLAN.grin);
    e.shout = keys(t, PLAN.shout);
    e.angry = keys(t, PLAN.angry);
    e.happy = keys(t, PLAN.happy);
    e.cheek = keys(t, PLAN.cheek);
    e.brow = e.wide * .5 + Math.sin(t * 20) * pulse(t, 3.5, 4.3) * .5;
  }

  pose(TOSS);
  tossAt.copy(center);
  pose(PLAN_LANDS - .001);
  popAt.copy(neck);

  function render(t) {
    pose(t);
    sea.open(t);
    if (t < .8) {
      octo.expr.lookX = Math.sin(t * 4) * .7;
      octo.expr.lookY = .1;
    } else if (t < 2.9) lookToward(octo, t < PLAN_LANDS ? center : left);
    else lookToward(octo, scroll.position);
    if (t > 3.45) {
      octo.expr.lookX = 0;
      octo.expr.lookY = .3;
    }
    octo.face();

    const angle = bottleTurn(Math.min(t, TOSS));
    if (t <= TOSS) {
      bottle.position.copy(center);
      bottle.rotation.set(0, 0, angle);
    } else {
      const age = t - TOSS;
      bottle.position.set(tossAt.x + 3 * age, tossAt.y + 3.4 * age - 4.9 * age * age, tossAt.z - 1.5 * age);
      bottle.rotation.set(age * 3, 0, angle - age * 9);
    }
    bottle.visible = t < 4;
    cork.visible = t < 3.8;
    if (t < PLAN_LANDS) {
      cork.position.copy(neck);
      cork.rotation.set(0, 0, angle);
    } else {
      const age = t - PLAN_LANDS;
      cork.position.set(popAt.x - 1.6 * age, popAt.y + 5.2 * age - 3.6 * age * age, popAt.z + 1 * age);
      corkSpin.set(age * 9, 0, angle + age * 14);
      corkTurn.setFromEuler(corkSpin);
      cork.quaternion.copy(corkTurn);
    }

    const { unroll, lift } = scrollState;
    const stretch = 1 + .05 * wobble(t, UNROLL[1], 18, 7) * (1 - lift);
    const height = SHEET_HEIGHT * Math.max(.001, unroll) * stretch;
    sheet.visible = unroll > .01;
    sheet.scale.y = height / SHEET_HEIGHT;
    sheet.position.y = -height / 2;
    sheet.rotation.x = (.18 * wobble(t, UNROLL[1], 9, 4) + .16 * Math.sin(t * 13) * pulse(t, PUSH[0], PUSH[1])) * (1 - lift * .8);
    sheetTexture.repeat.y = Math.min(1, sheet.scale.y);
    sheetTexture.offset.y = 1 - sheetTexture.repeat.y;
    rods[0].position.y = .02;
    rods[1].position.y = -height - .02;
    const wound = Math.sqrt(.075 ** 2 + .06 * (1 - unroll));
    roll.visible = unroll < 1;
    roll.scale.set(wound, 1, wound);
    ribbon.visible = unroll < .02;
    ribbon.scale.setScalar(wound * 1.04);
    // Flying toward the camera, its shadow would sweep the floor as a slab.
    sheet.castShadow = t <= PUSH[0];

    for (let k = 0; k < 10; k++) {
      const age = (t * .9 + k * .21) % 1.6;
      if (t > 1.5 || t < .2) break;
      bottleAt(Math.max(.2, t - age * .4), mark);
      sea.bubble(mark.x + Math.sin(k * 2.3 + age * 5) * .25, mark.y - .6 - age * .2 + age * 1.2, mark.z + .2, (.06 + (k % 3) * .04) * (1 - range(age, 1.1, 1.6)));
    }
    const pop = t - PLAN_LANDS;
    for (let k = 0; k < 24 && pop > 0 && pop < 1.6; k++) {
      const age = pop - (k % 4) * .03;
      if (age < 0) continue;
      const a = k * 2.39996;
      const reach = (1 - Math.exp(-age * 5)) * (.5 + (k % 4) * .28);
      sea.bubble(popAt.x - reach * .9 + Math.cos(a) * reach * .5, popAt.y + Math.sin(a) * reach * .6 + age * 1.3, popAt.z + .25, (.08 + (k % 3) * .06) * (1 - range(age, 1.1, 1.6)));
    }
    for (let k = 0; k < 14 && pop > 0 && pop < .9; k++) {
      const a = k * 2.39996;
      sea.drop(popAt.x + (Math.cos(a) * 1.2 - 1.2) * pop, popAt.y + (Math.sin(a) * 1.4 + 2) * pop - 4.9 * pop * pop, popAt.z + .3, (.05 + (k % 3) * .02) * (1 - range(pop, .6, .9)));
    }
    sea.close();

    const bounce = pulse(t, PLAN_LANDS - .05, PLAN_LANDS + .3);
    glow.intensity = 9 + Math.sin(t * 3) * 3 + bounce * 14;
    camera.position.x = .25 + Math.sin(t * 90) * bounce * .03;
    renderer.render(scene, camera);
  }
  const textures = [...octo.textures, ...sea.textures, sheetTexture];
  return { ready: warm(() => render(PLAN_LANDS)), canvas, render, dispose: () => dispose(textures) };
}

// All settled: the run of bubbles bursts at CLEAR_LANDS, when the send-offs
// plugin pops the word. Beats: jet up through the page and settle (0.12-1.0), tuck
// every arm in (1.15-1.4), spring up with six arms thrown high (1.45), land
// (1.95), send a wave round the raised arms while bobbing (2.05-4.1), then
// hold them up, beaming.
const CLEAR = {
  rootY: [[.12, -3.9], [.6, 1.05, out], [.84, 0, fall], [1.42, 0], [1.7, 1.5, out], [1.98, 0, fall]],
  squash: [[.3, .22], [.78, .08], [.86, -.28, out], [1, .12], [1.14, 0], [1.4, -.26], [1.5, .26, whip], [1.9, .1], [2, -.26, out], [2.16, .1], [2.3, 0]],
  blink: [[.8, 0], [.86, 1], [1, 0], [1.26, 0], [1.34, .6], [1.44, .6], [1.5, 0]],
  wide: [[.15, .6], [.84, .6], [1, 0], [1.44, 0], [1.5, 1], [1.9, .6], [2.1, 0]],
  shout: [[.3, .5], [.8, .4], [.9, 0], [1.44, 0], [1.5, 1], [1.9, .8], [2.1, 0]],
  // Part-way, the eyes are crescents rather than the full grin's ovals.
  happy: [[2, 0], [2.12, .4]],
};

function createClear(container) {
  const { canvas, scene, camera, glow, key, renderer, dispose, warm } = createStage(container);
  seaLights(scene, key, glow);
  const sea = createSea(scene, camera);
  const octo = createOctopus();
  scene.add(octo.root);
  const blob = shadowBlob(scene);
  // Shells of bubbles take turns with shells of starlight.
  const shells = finale();
  const bubbleMap = bubbleTexture();
  const bubbles = createFireworks(scene, camera, { shells: shells.filter((_, i) => i % 2 === 0), colors: [0xffffff, 0xbdf4ff], map: bubbleMap, size: .62, sparks: 22 });
  const starMap = starTexture({ glow: 'rgba(255,255,255,.9)', core: '#ffffff' });
  const stars = createFireworks(scene, camera, { shells: shells.filter((_, i) => i % 2), colors: [0xffc23d, 0xff7fb0, 0x62e0d2], map: starMap, size: .5, sparks: 22 });

  const target = new Vector3(), aim = new Vector3(), pole = new Vector3();
  const camY = camera.position.y;

  function pose(t) {
    const rootY = keys(t, CLEAR.rootY);
    const party = smooth(range(t, 2.05, 2.3));
    const beat = (t - 2.05) * Math.PI * 2.2;
    const bob = Math.abs(Math.sin(beat)) * party * (1 - range(t, 4.1, 4.4));
    octo.root.position.set(0, rootY + bob * .3, 0);
    octo.root.rotation.y = Math.sin(beat / 2) * .3 * party * (1 - range(t, 4.1, 4.4));
    octo.torso.rotation.set(-.3 * pulse(t, 1.45, 1.95), 0, Math.sin(beat / 2) * .12 * party);
    octo.squash(keys(t, CLEAR.squash) + (bob - .5) * .12 * party, t);
    octo.update();

    const trail = 1 - smooth(range(t, .35, .6));
    const splay = smooth(range(t, .4, .7)) * (1 - smooth(range(t, .76, .9)));
    const tuck = pulse(t, 1.1, 1.5);
    const cheer = smooth(range(t, 1.44, 1.6));
    for (let i = 0; i < ARMS; i++) {
      const o = octo.tentacles[i].outward;
      target.set(o.x * 2.05, (.02 - octo.root.position.y) / SIZE, o.z * 1.6 + .15);
      pole.copy(DOWN);
      let curl = .9, wave = .08;
      if (trail > 0) {
        target.lerp(aim.set(o.x * .4, -1.1, o.z * .4), trail);
        pole.lerp(o, trail);
        wave = mix(wave, .4, trail);
      }
      if (splay > 0) {
        target.lerp(aim.set(o.x * 2.5, 1.6, o.z * 2), splay);
        pole.lerp(UP, splay);
        wave = mix(wave, .3, splay);
        curl = mix(curl, .2, splay);
      }
      if (tuck > 0) {
        target.lerp(aim.set(o.x * 1.1, (.02 - octo.root.position.y) / SIZE, o.z * 1.1), tuck);
        curl = mix(curl, 1.6, tuck);
      }
      // The two front arms stay down, clear of the face.
      if (cheer > 0 && i !== 0 && i !== 7) {
        const lift = Math.sin(beat - i * .9) * party;
        target.lerp(aim.set(o.x * (3 + lift * .3), 3.5 + (i % 2) * .5 + lift * .7, o.z * .5 + .3), cheer);
        pole.lerp(o, cheer);
        wave = mix(wave, .5, cheer);
        curl = mix(curl, .3 + .5 * Math.max(0, lift), cheer);
      }
      octo.toWorld(target);
      octo.reach(i, target, pole, curl, wave, t);
    }

    const e = octo.expr;
    e.blink = keys(t, CLEAR.blink);
    e.wide = keys(t, CLEAR.wide);
    e.shout = keys(t, CLEAR.shout);
    e.happy = keys(t, CLEAR.happy);
    e.smile = e.happy ? 0 : .7;
    e.grin = range(t, 2, 2.12);
    e.angry = pulse(t, 1.15, 1.45) * .6;
    e.brow = e.wide * .6 + Math.sin(t * 20) * range(t, 4.3, 4.5) * .4;
    e.cheek = .6 + e.grin * .35;
    e.lookX = 0;
    e.lookY = pulse(t, 1.5, 2) * .6;
  }

  function render(t) {
    pose(t);
    sea.open(t);
    // A column of bubbles jets up with the leap.
    for (let k = 0; k < 16; k++) {
      const age = t - CLEAR_LANDS - k * .02;
      if (age <= 0 || age > 1.6) continue;
      sea.bubble(Math.sin(k * 2.4) * 1.3 + Math.sin(age * 6 + k) * .15, .3 + (2.4 + (k % 4) * .4) * age, Math.cos(k * 2.4) * .8 + .4, (.12 + (k % 3) * .07) * (1 - range(age, 1.1, 1.6)));
    }
    sea.close();
    bubbles.update(t);
    stars.update(t);
    const height = octo.root.position.y;
    blob.position.set(0, .01, .15);
    blob.scale.set(2.3, 1.5, 1).multiplyScalar(1 - clamp(height / 1.5) * .4);
    blob.material.opacity = .3 * range(height, -1, 0) * (1 - clamp(height) * .5);
    const flash = Math.max(bubbles.flash(t), stars.flash(t));
    glow.intensity = 9 + Math.sin(t * 3) * 3 + flash * 9;
    camera.position.y = camY + Math.sin(t * 75) * (pulse(t, .84, 1.05) + pulse(t, 1.98, 2.18)) * .04;
    renderer.render(scene, camera);
  }
  const textures = [...octo.textures, ...sea.textures, bubbleMap, starMap];
  return { ready: warm(() => render(CLEAR_LANDS)), canvas, render, dispose: () => dispose(textures) };
}

export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  look: {
    words: { yeet: 'SPLOOSH!', pr: 'PR AHOY!', plan: 'PLAN, BLUB~', clear: 'CLEAR WATERS!' },
    background: 'radial-gradient(ellipse at 50% 57%,light-dark(#e8fbfb,#0b3a55) 0%,light-dark(#bfeef0,#06243b) 45%,light-dark(#8fd6e0,#020d18) 100%)',
    ink: 'light-dark(#05263a,#e4fbff)',
    glow: '0 5px 0 light-dark(#7fd3e0,#0c4a6b),0 0 70px light-dark(#2fa9bf50,#3ee0e860)',
    flash: 'light-dark(#00539c,#bff8ff)',
    flashGlow: 'light-dark(#2fa9bf90,#3ee0e890)',
  },
  clear: createClear,
  yeet: createYeet,
  pr: createPr,
  plan: createPlan,
};
