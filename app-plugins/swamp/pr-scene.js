import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, Group,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry,
  SRGBColorSpace, TorusGeometry, Vector3,
} from 'three';
import { createOrc } from './orc-model.js';
import { back, clamp, createStage, mix, pulse, range, smooth, wobble } from '../../ui/yeet/stage.js';

// The last strike is the overlay's `lands` beat in ui/js/scene-poses.js.
const STRIKES = [1.5, 1.95, 3.05];
const LANDS = STRIKES[2];
const MAIN = 0x9fd46b;
const FEATURE = 0xe8a948;

const EASE = {
  s: smooth,
  // Gravity: the hammer falls faster and faster until the anvil stops it.
  i: u => u * u * u,
  o: u => 1 - (1 - u) * (1 - u),
  b: u => back(u, 1.6),
};

const BODY = {
  ry: .32, rx: 0, drop: 0, hx: 0, sx: 0, sy: 0, cx: 0, nod: 0, turn: 0, tilt: 0, tuck: 0,
  ax: 0, az: .2, ay: 0, ex: -.25, wx: 0, wz: 0,
  lx: 0, lz: -.2, ly: 0, lex: -.25, lwx: 0, lfist: .35,
};
const pose = values => ({ ...BODY, ...values });
const HIT = pose({ drop: -.26, hx: .08, sx: .3, sy: .12, cx: .14, ax: -.95, az: .08, ex: -.55, wx: .95, lx: .15, lz: -.35, lex: -.6, lfist: .7, nod: .06 });
const COCK = pose({ drop: -.06, sx: -.04, sy: -.08, ax: -2.15, az: .4, ex: -1.0, wx: .6, lx: -.1, lz: -.3, lex: -.6, lfist: .7, nod: .1 });
const P = {
  burst: pose({ ry: .15, rx: -.25, sx: -.18, cx: -.1, nod: -.25, tuck: 1, ax: -2.85, az: .5, ex: -.1, wx: 1.0, lx: -.5, lz: -1.2, lex: -.9, lfist: 1 }),
  reach: pose({ ry: .3, sx: -.05, ax: -2.4, az: .45, ex: -.8, wx: .9, lz: -.9, lex: -.5, lfist: .8 }),
  land: pose({ drop: -.42, hx: .1, sx: .3, cx: .1, nod: .2, ax: -1.4, az: .35, ex: -1.25, wx: .3, lx: -.3, lz: -.75, lex: -.7, lfist: .8 }),
  ready: pose({ drop: -.1, sx: .1, ax: -.55, az: .15, ex: -1.05, wx: .7, lz: -.28, lex: -.45, nod: .15 }),
  cock: COCK,
  hit: HIT,
  heave: pose({ drop: -.36, sx: -.1, sy: -.15, cx: -.12, nod: -.3, ax: -2.6, az: .45, ex: -.4, wx: .5, lx: -.3, lz: -.95, lex: -.8, lfist: 1 }),
  top: pose({ drop: -.08, sx: -.2, sy: -.25, cx: -.14, turn: -.62, tilt: .14, ax: -2.7, az: .5, ex: -.3, wx: .84, lx: -.15, lz: -1.0, lex: -1.1, lfist: 1 }),
  wind: pose({ drop: -.02, sx: -.3, sy: -.3, cx: -.2, nod: -.1, ax: -3.1, az: .45, ex: -.5, wx: 1.2, lx: -.6, lz: -1.15, lex: -.8, lfist: 1 }),
  slam: { ...HIT, lx: .7, lz: -.9, lex: -.4, lfist: 1, nod: .08, turn: -.3, tilt: -.1 },
  blow: pose({ ry: .35, drop: -.04, sx: -.04, ax: -.6, az: -.12, ex: -1.75, wx: .65, turn: .4, nod: .12, tilt: -.12, lx: .1, lz: -.3, lex: -.5, lfist: .5 }),
  proud: pose({ ry: .22, drop: -.04, sx: -.1, cx: -.12, turn: -.32, tilt: .1, nod: -.06, ax: -.4, az: .55, ex: -2.25, wx: .37, lx: -1.5, lz: -1.4, lex: -2.0, lfist: 1 }),
};
const BODY_KEYS = [
  [0, P.burst], [.5, P.burst], [.8, P.reach, 'o'], [.98, P.land, 'o'], [1.2, P.ready], [1.36, P.cock, 'o'],
  [STRIKES[0], P.hit, 'i'], [1.8, P.cock], [STRIKES[1], P.hit, 'i'], [2.12, P.ready, 'o'], [2.5, P.heave],
  [2.62, P.top, 'o'], [2.8, P.top], [2.9, P.wind], [LANDS, P.slam, 'i'], [3.22, P.slam], [3.5, P.blow],
  [3.66, P.blow], [3.92, P.proud, 'b'],
];

const FACE = { jaw: 0, blink: 0, squint: 0, brow: 0, frown: .45, smile: 0, lx: 0, ly: 0, flare: 0 };
const mood = values => ({ ...FACE, ...values });
const AIM = mood({ squint: .35, frown: .75, lx: .45, ly: -.65, jaw: .05 });
const WINCE = mood({ squint: .8, frown: .9, flare: .6, jaw: .15, lx: .45, ly: -.6 });
const F = {
  burst: mood({ jaw: .7, smile: .6, brow: .7, frown: -.2, flare: .5 }),
  grin: mood({ jaw: .2, smile: .9, brow: .4, frown: -.1, lx: .4, ly: -.3 }),
  aim: AIM,
  wince: WINCE,
  strain: mood({ squint: 1, flare: 1, frown: 1, jaw: .22, smile: -.5, ly: .7 }),
  smug: mood({ jaw: .22, smile: 1, brow: .9, frown: -.35, lx: 0, ly: 0 }),
  focus: mood({ squint: .7, frown: 1, flare: .7, lx: .35, ly: -.7 }),
  roar: mood({ jaw: 1, squint: .75, flare: 1, frown: 1, ly: -.3 }),
  blow: mood({ jaw: .1, smile: -.7, squint: .25, brow: .35, frown: .1, lx: .55, ly: .35, flare: .3 }),
  proud: mood({ jaw: .26, smile: 1, brow: .55, frown: -.3 }),
};
const FACE_KEYS = [
  [0, F.burst], [.9, F.burst], [1.12, F.grin], [1.3, F.aim], [STRIKES[0], F.wince, 'i'], [1.62, F.aim],
  [STRIKES[1], F.wince, 'i'], [2.12, F.aim], [2.48, F.strain], [2.6, F.smug, 'o'], [2.8, F.smug],
  [2.92, F.focus], [LANDS, F.roar, 'i'], [3.25, F.roar], [3.4, F.blow], [3.66, F.blow], [3.86, F.proud],
];

function sample(keys, t, out) {
  let i = 1;
  while (i < keys.length - 1 && t > keys[i][0]) i++;
  const [t0, a] = keys[i - 1], [t1, b, ease = 's'] = keys[i];
  const u = EASE[ease](range(t, t0, t1));
  for (const key in a) out[key] = mix(a[key], b[key], u);
  return out;
}

// Seen at render time from t - at: sparks are thrown a hair before contact
// so the impact still at LANDS already shows a burst.
const age = (t, at) => t - at + .03;

export function createPrScene(container, title) {
  const { canvas, scene, camera, glow, renderer, dispose, warm } = createStage(container);
  glow.color.set(0xffa44a);
  const orc = createOrc();
  scene.add(orc.root);

  const steel = new MeshStandardMaterial({ color: 0x3d4b52, roughness: .42, metalness: .8 });
  const steelLight = new MeshStandardMaterial({ color: 0xa9b6b9, roughness: .25, metalness: .9, emissive: 0xff7a1a, emissiveIntensity: 0 });
  const leather = new MeshStandardMaterial({ color: 0x4a3326, roughness: .85 });
  const wood = new MeshStandardMaterial({ color: 0x6b4a2e, roughness: .9 });
  const shadowy = item => { item.castShadow = true; item.receiveShadow = true; return item; };

  // The handle runs along the grip's z; the striking face is on the head's
  // -y side, which is where the swing carries it.
  const hammer = new Group();
  const handle = shadowy(new Mesh(new CylinderGeometry(.06, .07, 1.3, 10).rotateX(Math.PI / 2), wood));
  handle.position.z = .45;
  const head = shadowy(new Mesh(new BoxGeometry(.4, .64, .44), steel));
  head.position.z = 1.04;
  const strikeFace = shadowy(new Mesh(new BoxGeometry(.46, .07, .5), steelLight));
  strikeFace.position.set(0, -.34, 1.04);
  const peen = shadowy(new Mesh(new CylinderGeometry(.09, .19, .22, 4), steel));
  peen.position.set(0, .41, 1.04);
  peen.rotation.y = Math.PI / 4;
  const wrap = new Mesh(new CylinderGeometry(.085, .085, .34, 10).rotateX(Math.PI / 2), leather);
  wrap.position.z = .02;
  hammer.add(handle, head, strikeFace, peen, wrap);
  orc.rightGrip.add(hammer);

  const body = { ...BODY }, look = [0, 0], expression = { ...FACE };
  const v = new Vector3(), contact = new Vector3(), sweatFrom = new Vector3();

  function posture(t) {
    orc.reset();
    sample(BODY_KEYS, t, body);
    const emerge = range(t, .1, .82);
    orc.root.position.set(-.55, mix(-2.4, 0, back(emerge, 2.2)), mix(-1.8, 0, smooth(emerge)));
    orc.root.rotation.set(body.rx, body.ry, 0);
    // Rebounds off the anvil, and a heavy head makes the lifted arm shake.
    const bounce = STRIKES.reduce((sum, at, i) => sum + Math.abs(wobble(t, at, 20, i === 2 ? 7 : 11)) * (i === 2 ? .5 : .35), 0);
    const tremble = Math.sin(t * 53) * .03 * pulse(t, 2.25, 2.9);
    const nod = STRIKES.reduce((sum, at) => sum + pulse(t, at, at + .14) * .1, 0);
    orc.hips.position.y += body.drop;
    orc.hips.rotation.x = body.hx;
    orc.spine.rotation.set(body.sx, body.sy, 0);
    orc.chest.rotation.x = body.cx;
    orc.neck.rotation.y = body.turn * .4;
    orc.head.rotation.set(body.nod + nod, body.turn * .6, body.tilt);
    orc.rightArm.rotation.set(body.ax + tremble, body.ay, body.az);
    orc.rightElbow.rotation.x = body.ex + bounce * .4;
    orc.rightHand.rotation.set(body.wx - bounce, 0, body.wz);
    orc.leftArm.rotation.set(body.lx - tremble, body.ly, body.lz);
    orc.leftElbow.rotation.x = body.lex;
    orc.leftHand.rotation.x = body.lwx;
    const settle = range(t, .98, 1.3);
    orc.feet.left.set(mix(-.05, -.08, settle), .45 * body.tuck, mix(.15, .24, settle));
    orc.feet.right.set(mix(.05, .1, settle), .3 * body.tuck, mix(-.2, -.14, settle));
    orc.idle(t, 1 - .6 * pulse(t, 2.9, 3.2));
    sample(FACE_KEYS, t, expression);
    expression.brow += Math.sin((t - 2.62) * 34) * .5 * pulse(t, 2.62, 2.84);
    look[0] = expression.lx;
    look[1] = expression.ly;
    orc.face({ ...expression, look });
    orc.grip('right', 1).grip('left', body.lfist);
    orc.plantFeet();
  }

  posture(LANDS);
  strikeFace.getWorldPosition(contact);
  const top = contact.y - .035;
  posture(2.58);
  orc.head.getWorldPosition(sweatFrom);

  const anvil = new Group();
  anvil.position.set(contact.x, 0, contact.z);
  const stumpHeight = top - .58;
  const stump = shadowy(new Mesh(new CylinderGeometry(.6, .7, stumpHeight, 18), wood));
  stump.position.y = stumpHeight / 2;
  [
    [new BoxGeometry(1.1, .14, .64), stumpHeight + .07],
    [new BoxGeometry(.56, .24, .42), stumpHeight + .26],
    [new BoxGeometry(1.7, .22, .62), top - .11],
  ].forEach(([shape, y]) => {
    const block = shadowy(new Mesh(shape, steel));
    block.position.y = y;
    anvil.add(block);
  });
  const horn = shadowy(new Mesh(new ConeGeometry(.24, .78, 14), steel));
  horn.rotation.z = -Math.PI / 2;
  horn.position.set(1.23, top - .1, 0);
  anvil.add(stump, horn);

  const plateCanvas = document.createElement('canvas');
  plateCanvas.width = 512;
  plateCanvas.height = 160;
  const ctx = plateCanvas.getContext('2d');
  ctx.fillStyle = '#e8e3c9';
  ctx.fillRect(0, 0, 512, 160);
  ctx.fillStyle = '#345144';
  ctx.font = 'bold 44px system-ui';
  ctx.fillText('PULL REQUEST', 30, 64);
  ctx.font = 'bold 30px system-ui';
  ctx.fillText(title.trim().slice(0, 26), 30, 122);
  const texture = new CanvasTexture(plateCanvas);
  texture.colorSpace = SRGBColorSpace;
  const plate = new Mesh(new PlaneGeometry(1.06, .33), new MeshStandardMaterial({ map: texture, roughness: .9 }));
  plate.position.set(0, stumpHeight * .55, .705);
  plate.rotation.x = -.07;
  anvil.add(plate);
  scene.add(anvil);

  // Hot metal where the two branch ends meet; it cools once fused.
  const hot = new Color(0xff7a1a), cooled = new Color(0x5b4a3e);
  const billetMaterial = new MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff6a10, emissiveIntensity: 1.4, roughness: .5 });
  const billet = shadowy(new Mesh(new BoxGeometry(.9, .1, .26), billetMaterial));
  billet.position.y = top + .05;
  anvil.add(billet);

  const nodeShape = new SphereGeometry(.15, 16, 12);
  const branches = [MAIN, FEATURE].map((color, index) => {
    const side = index === 0 ? -1 : 1;
    const material = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .35, roughness: .4 });
    const branch = new Group();
    const line = new Mesh(new CylinderGeometry(.06, .06, 9, 10), material);
    line.rotation.z = Math.PI / 2;
    line.position.x = side * 4.95;
    branch.add(line);
    for (let i = 0; i < 4; i++) {
      const node = new Mesh(nodeShape, material);
      node.position.x = side * (1.25 + i * 1.6);
      branch.add(node);
    }
    branch.position.set(0, top + .07, .05);
    anvil.add(branch);
    return { branch, material, side };
  });
  const mergeNode = new Mesh(new SphereGeometry(.26, 24, 16), new MeshStandardMaterial({ color: 0xf4d27a, emissive: 0xe4ad46, emissiveIntensity: .9, roughness: .25, metalness: .3 }));
  mergeNode.position.set(0, top + .2, .05);
  anvil.add(mergeNode);
  const ring = new MeshBasicMaterial({ color: 0xffe9a8, transparent: true, depthWrite: false, toneMapped: false });
  const wave = new Mesh(new TorusGeometry(.5, .045, 6, 48), ring);
  wave.position.copy(mergeNode.position);
  anvil.add(wave);
  const dust = new Mesh(new TorusGeometry(1, .06, 6, 48), new MeshBasicMaterial({ color: 0xe9dcc0, transparent: true, depthWrite: false }));
  dust.rotation.x = -Math.PI / 2;
  dust.position.set(contact.x, .04, contact.z);
  scene.add(dust);

  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = flashCanvas.height = 128;
  const flashCtx = flashCanvas.getContext('2d');
  const gradient = flashCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,240,1)');
  gradient.addColorStop(.25, 'rgba(255,214,120,.8)');
  gradient.addColorStop(1, 'rgba(255,140,40,0)');
  flashCtx.fillStyle = gradient;
  flashCtx.fillRect(0, 0, 128, 128);
  const flashTexture = new CanvasTexture(flashCanvas);
  const flash = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: flashTexture, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
  flash.position.set(contact.x, top + .06, contact.z + .6);
  scene.add(flash);

  const sparks = new Group();
  const flecks = [];
  const streak = new BoxGeometry(.035, .035, .2);
  const sparkMaterials = [0xfff1ce, 0xffb24a, 0xffd36e].map(color => new MeshBasicMaterial({ color, toneMapped: false }));
  STRIKES.forEach((at, strike) => {
    const count = strike === 2 ? 30 : 10;
    for (let i = 0; i < count; i++) {
      const mesh = new Mesh(streak, sparkMaterials[i % 3]);
      const angle = (i + strike * .37) * 2.39996;
      const speed = (strike === 2 ? 3.4 : 2.2) * (.6 + (i * .618 % 1) * .7);
      flecks.push({ mesh, at, x: Math.cos(angle) * speed, z: Math.sin(angle) * speed * .6 + .8, lift: 2.6 + (i % 5) * .8 + strike * .5, life: .5 + (i % 4) * .08 });
      sparks.add(mesh);
    }
  });
  scene.add(sparks);

  const sweat = new Mesh(new SphereGeometry(.07, 12, 10), new MeshStandardMaterial({ color: 0xcdeeff, emissive: 0x5aa6d6, emissiveIntensity: .4, roughness: .05, metalness: .1 }));
  scene.add(sweat);

  const puffShape = new SphereGeometry(.13, 12, 10);
  const puffs = Array.from({ length: 7 }, (_, i) => {
    const mesh = new Mesh(puffShape, new MeshStandardMaterial({ color: 0xc9c2b6, roughness: 1, transparent: true, depthWrite: false }));
    scene.add(mesh);
    return { mesh, born: 3.1 + i * .11, sway: i * 1.7 };
  });

  const feature = new Color(FEATURE);
  const main = new Color(MAIN);

  function render(t) {
    posture(t);
    const strikeAge = STRIKES.map(at => age(t, at));
    const heat = strikeAge.reduce((sum, a, i) => sum + (a > 0 ? Math.exp(-a * 7) * (i === 2 ? 2 : 1) : 0), 0);
    const shake = strikeAge.reduce((sum, a, i) => sum + (a > 0 ? Math.exp(-a * 12) * (i === 2 ? 1 : .25) : 0), 0);

    const hop = pulse(t, LANDS, LANDS + .16);
    anvil.position.y = hop * .1;
    anvil.rotation.z = wobble(t, LANDS, 30, 9) * .035;

    const arrive = smooth(range(t, .55, 1.4));
    const fuse = smooth(range(t, LANDS - .03, LANDS + .3));
    branches.forEach(({ branch, material, side }) => {
      branch.position.x = side * (1 - arrive) * 9;
      material.emissiveIntensity = .35 + heat * .7 + fuse * .35;
      if (side > 0) {
        material.color.copy(feature).lerp(main, fuse);
        material.emissive.copy(material.color);
      }
    });
    const cool = range(t, LANDS + .1, 4.4);
    billetMaterial.emissive.copy(hot).lerp(cooled, cool);
    billetMaterial.emissiveIntensity = .9 + heat * 1.6 + Math.sin(t * 7) * .15;
    billet.scale.set(1 + fuse * .12, 1 - fuse * .35, 1 + fuse * .1);
    steelLight.emissiveIntensity = heat * .9 + (1 - cool) * fuse * .5;

    const pop = range(t, LANDS - .03, LANDS + .3);
    mergeNode.visible = pop > 0;
    mergeNode.scale.setScalar(back(pop, 3) * (1 + wobble(t, LANDS + .3, 18, 6) * .12));
    const ripple = range(t, LANDS - .03, LANDS + .65);
    wave.visible = ripple > 0 && ripple < 1;
    wave.scale.setScalar(1 + smooth(ripple) * 3.2);
    ring.opacity = 1 - ripple;
    const ground = range(t, LANDS, LANDS + .55);
    dust.visible = ground > 0 && ground < 1;
    dust.scale.setScalar(.5 + smooth(ground) * 1.7);
    dust.material.opacity = .45 * (1 - ground);

    const burst = strikeAge.reduce((most, a, i) => Math.max(most, a > 0 ? Math.exp(-a * 9) * (i === 2 ? 3 : 1.2) : 0), 0);
    flash.visible = burst > .02;
    flash.scale.setScalar(burst * .6);
    flash.material.opacity = clamp(burst);

    flecks.forEach(({ mesh, at, x, z, lift, life }) => {
      const a = age(t, at);
      mesh.visible = a > 0 && a < life;
      if (!mesh.visible) return;
      mesh.position.set(contact.x + x * a, top + .08 + lift * a - 7 * a * a, contact.z + z * a);
      v.set(mesh.position.x + x, mesh.position.y + lift - 14 * a, mesh.position.z + z);
      mesh.lookAt(v);
      mesh.scale.set(1, 1, 1.6 * (1 - a / life) + .3);
    });

    const fly = t - 2.58;
    sweat.visible = fly > 0 && fly < .35;
    sweat.position.set(sweatFrom.x - .55 - fly * 1.6, sweatFrom.y + .45 + fly * 2 - 6 * fly * fly, sweatFrom.z + .3 + fly * .4);
    sweat.scale.set(1, 1.5 - fly, 1);

    strikeFace.getWorldPosition(v);
    const blow = smooth(range(t, 3.4, 3.62));
    puffs.forEach(({ mesh, born, sway }) => {
      const a = t - born;
      mesh.visible = a > 0 && a < .8 && t < 4.4;
      if (!mesh.visible) return;
      mesh.position.set(v.x + Math.sin(a * 5 + sway) * .08 + blow * a * 2.4, v.y + .25 + a * .9, v.z + blow * a * .6);
      mesh.scale.setScalar(.6 + a * 1.6);
      mesh.material.opacity = .55 * (1 - a / .8);
    });

    glow.intensity = 8 + Math.sin(t * 9) * 1.2 + Math.sin(t * 23) * .8 + heat * 10 + fuse * 4;
    glow.position.set(contact.x, top + .9, contact.z + 1.1);
    camera.position.x = .25 + Math.sin(t * 97) * shake * .09;
    camera.position.y = 2.7 + Math.cos(t * 83) * shake * .07;
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => dispose([texture, flashTexture]) };
}
