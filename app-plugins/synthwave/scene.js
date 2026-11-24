// The synthwave cast for Yeet, PR opened and Plan reveal: a chrome robot with
// a neon visor on a scrolling grid under a striped sun.
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, CylinderGeometry, DoubleSide,
  EquirectangularReflectionMapping, Float32BufferAttribute, Group, LinearFilter, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, OctahedronGeometry, Plane, PlaneGeometry, PMREMGenerator, Points, PointsMaterial, Quaternion,
  RepeatWrapping, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector3,
} from 'three';
import { back, clamp, createStage, mix, pulse, range, smooth, wobble } from '../../ui/yeet/stage.js';
import { CLEAR_LANDS, createFireworks } from '../../ui/yeet/party.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

const PINK = 0xff3fa4;
const CYAN = 0x2de2e6;
const YELLOW = 0xffe66d;

const UPPER = .55;
const FORE = .55;
const THIGH = .56;
const SHIN = .5;
const ANKLE = .14;
const HIP = 1.2;
const VISOR_ROWS = 6;
const ROW = { marquee: 0, happy: 1, wow: 2, fierce: 3, blink: 4, loading: 5 };

const out = u => 1 - (1 - u) * (1 - u);
const EASE = { s: smooth, i: u => u * u * u, o: out, b: u => back(u, 1.6), l: u => u };

// [[time, pose, ease?], ...]: each segment eases into its end pose, and the
// first and last poses hold outside the track.
function sample(keys, t, target) {
  let i = 1;
  while (i < keys.length - 1 && t > keys[i][0]) i++;
  const [t0, a] = keys[i - 1], [t1, b, ease = 's'] = keys[i];
  const u = EASE[ease](range(t, t0, t1));
  for (const key in a) target[key] = mix(a[key], b[key], u);
  return target;
}

function row(t, schedule) {
  let value = schedule[0][1];
  for (const [at, next] of schedule) if (t >= at) value = next;
  return value;
}

const REST = {
  x: 0, z: 0, ry: 0, lift: 0, px: 0, pz: 0, drop: -.04, lean: 0, twist: 0, side: 0, squash: 0,
  nod: 0, turn: 0, tilt: 0,
  ra: 0, ro: .16, rt: 0, re: .3, rw: 0, rg: 0,
  la: 0, lo: .16, lt: 0, le: .3, lw: 0, lg: 0,
  rfx: 0, rfy: 0, rfz: 0, lfx: 0, lfy: 0, lfz: 0, shades: 0,
  rhx: -.95, rhy: 1.35, rhz: .2, lhx: .95, lhy: 1.35, lhz: .2,
};
const pose = values => ({ ...REST, ...values });

function paint(textures, width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  textures.push(texture);
  return texture;
}

function wrap(ctx, text, width, lines) {
  const words = text.split(/\s+/).filter(Boolean);
  const result = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      result.push(line);
      line = word;
    } else line = next;
  }
  if (line) result.push(line);
  if (result.length > lines) result.splice(lines - 1, result.length, `${result[lines - 1]}…`);
  return result;
}

const additive = (color, opacity = 1, map = null) => new MeshBasicMaterial({
  color, map, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
});

// The grid, sun, palms and stars every scene stands in, and the canvases the
// cast shares. The page shows through everywhere the set leaves empty.
function createSet(stage, sunX) {
  const { scene, renderer, key, glow } = stage;
  const textures = [];
  scene.traverse(light => {
    if (light.isHemisphereLight) {
      light.color.set(0xffd9f2);
      light.groundColor.set(0x3a1060);
    } else if (light.isAmbientLight) light.color.set(0xe2d4ff);
    else if (light === key) light.color.set(0xffd4ec);
    else if (light.isDirectionalLight) light.color.set(light.position.z < 0 ? CYAN : 0xc08bff);
  });
  glow.color.set(PINK);
  // The robot rises out of the grid, so nothing of it draws below the floor.
  renderer.localClippingEnabled = true;
  const floorClip = new Plane(new Vector3(0, 1, 0), 0);

  const env = paint(textures, 256, 128, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#12052e');
    sky.addColorStop(.3, '#4a1580');
    sky.addColorStop(.46, '#ff3fa4');
    sky.addColorStop(.5, '#ffe66d');
    sky.addColorStop(.5, '#1a0838');
    sky.addColorStop(1, '#05010f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2de2e6';
    ctx.lineWidth = 2;
    for (let y = 70; y < h; y += 9 + (y - 64) * .35) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0; x < w; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });
  env.mapping = EquirectangularReflectionMapping;
  // Prefiltered here rather than on the first frame, which would stall it.
  const pmrem = new PMREMGenerator(renderer);
  const envTarget = pmrem.fromEquirectangular(env);
  pmrem.dispose();

  const glowTexture = paint(textures, 128, 128, (ctx, w) => {
    const shine = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    shine.addColorStop(0, 'rgba(255,255,255,1)');
    shine.addColorStop(.25, 'rgba(255,255,255,.55)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, w, w);
  });

  const reelTexture = paint(textures, 128, 128, ctx => {
    ctx.fillStyle = '#f4ecff';
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0838';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.beginPath();
      ctx.arc(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36, 13, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff3fa4';
    ctx.beginPath();
    ctx.arc(64, 64, 12, 0, Math.PI * 2);
    ctx.fill();
  });

  const gridTexture = paint(textures, 128, 128, ctx => {
    ctx.shadowColor = '#ff3fa4';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ff5cb8';
    ctx.fillRect(60, 0, 8, 128);
    ctx.fillRect(0, 60, 128, 8);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd6f0';
    ctx.fillRect(62, 0, 4, 128);
    ctx.fillRect(0, 62, 128, 4);
  });
  gridTexture.wrapS = gridTexture.wrapT = RepeatWrapping;
  gridTexture.repeat.set(40, 20);
  gridTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const gridFade = paint(textures, 4, 256, (ctx, w, h) => {
    const fade = ctx.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, '#202020');
    fade.addColorStop(.45, '#ffffff');
    fade.addColorStop(1, '#ffffff');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
  });
  const grid = new Mesh(new PlaneGeometry(80, 40), new MeshBasicMaterial({
    map: gridTexture, alphaMap: gridFade, transparent: true, depthWrite: false, toneMapped: false,
  }));
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = .004;
  grid.renderOrder = -2;
  scene.add(grid);

  const haze = new Mesh(new PlaneGeometry(90, 7), additive(0xffffff, .55, paint(textures, 4, 128, (ctx, w, h) => {
    const band = ctx.createLinearGradient(0, 0, 0, h);
    band.addColorStop(0, 'rgba(180,45,255,0)');
    band.addColorStop(.75, 'rgba(255,63,164,.55)');
    band.addColorStop(1, 'rgba(255,120,190,.9)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, h);
  })));
  haze.position.set(0, 3.5, -20.4);
  haze.renderOrder = -3;
  const horizon = new Mesh(new PlaneGeometry(90, .1), additive(0xff8fd0, .9));
  horizon.position.set(0, .05, -19.9);
  scene.add(haze, horizon);

  // Stripes widen toward the horizon; the bottom is cut flat where it sets.
  const SUN = 4.2;
  const sunTexture = paint(textures, 512, 512, ctx => {
    const fill = ctx.createLinearGradient(0, 6, 0, 506);
    fill.addColorStop(0, '#ffe66d');
    fill.addColorStop(.42, '#ff8a5c');
    fill.addColorStop(.7, '#ff3fa4');
    fill.addColorStop(1, '#b42dff');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(256, 256, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) ctx.fillRect(0, 282 + i * 30 + i * i * .8, 512, 4 + i * 2.6);
    ctx.fillRect(0, 480, 512, 32);
  });
  // A phone in portrait sees a narrow slice of sky. Keep the sun's centre, where
  // the yeet orb lands, in the middle 60% of the frame so the throw and its
  // impact stay on screen.
  const { camera } = stage;
  const sunZ = -20;
  const reach = Math.tan(camera.fov * Math.PI / 360) * camera.aspect * (camera.position.z - sunZ) * .6;
  sunX = Math.min(Math.max(sunX, camera.position.x - reach), camera.position.x + reach);
  const sunCentre = new Vector3(sunX, SUN * (224 / 256), sunZ);
  const sun = new Mesh(new PlaneGeometry(SUN * 2, SUN * 2), new MeshBasicMaterial({
    map: sunTexture, transparent: true, depthWrite: false, toneMapped: false,
  }));
  sun.position.copy(sunCentre);
  sun.renderOrder = -2;
  const sunGlow = new Mesh(new PlaneGeometry(1, 1), additive(PINK, .5, glowTexture));
  sunGlow.position.set(sunX, sunCentre.y, -20.2);
  sunGlow.scale.setScalar(SUN * 3.4);
  scene.add(sun, sunGlow);

  const palmTexture = paint(textures, 256, 512, ctx => {
    ctx.shadowColor = '#ff3fa4';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#1b0836';
    ctx.strokeStyle = '#1b0836';
    ctx.lineCap = 'round';
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(150, 512);
    ctx.quadraticCurveTo(170, 300, 112, 128);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI * .95 + i * Math.PI * .27 + Math.sin(i * 1.7) * .12;
      const length = 92 + (i % 3) * 18;
      const tipX = 112 + Math.cos(a) * length, tipY = 128 + Math.sin(a) * length * .55 + 44;
      ctx.beginPath();
      ctx.moveTo(112, 124);
      ctx.quadraticCurveTo(112 + Math.cos(a) * length * .55, 118 + Math.sin(a) * length * .5 - 26, tipX, tipY);
      ctx.quadraticCurveTo(112 + Math.cos(a) * length * .5, 134 + Math.sin(a) * length * .4 - 4, 112, 132);
      ctx.fill();
    }
  });
  [[-9.2, -11, 1], [9.6, -12.5, -.85]].forEach(([x, z, flip]) => {
    const palm = new Mesh(new PlaneGeometry(4.6, 9.2), new MeshBasicMaterial({
      map: palmTexture, transparent: true, depthWrite: false, alphaTest: .02,
    }));
    palm.position.set(x, 4.6, z);
    palm.scale.x = flip;
    palm.renderOrder = -1;
    scene.add(palm);
  });

  const starPositions = [];
  for (let i = 0; i < 46; i++) {
    starPositions.push(Math.sin(i * 12.9898) * 16, 5.4 + Math.abs(Math.sin(i * 78.233)) * 7, -19.5);
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  const stars = new Points(starGeometry, new PointsMaterial({
    color: 0xffe0f6, size: .24, map: glowTexture, transparent: true, depthWrite: false, blending: AdditiveBlending,
  }));
  scene.add(stars);

  return {
    textures, env: envTarget.texture, glowTexture, reelTexture, floorClip, sun, sunGlow, sunCentre,
    dispose() { envTarget.dispose(); },
    // energy brightens the grid and sun glow on a beat.
    update(t, energy = 0) {
      gridTexture.offset.y = (t * .9) % 1;
      grid.material.color.setScalar(.72 + .5 * energy);
      sunGlow.material.opacity = .45 + .35 * energy;
      stars.material.opacity = .55 + .25 * Math.sin(t * 7);
    },
  };
}

// Sparks share one pool per scene; `burst` throws them from a point.
function createSparks(scene, count = 36) {
  const shape = new OctahedronGeometry(.065, 0);
  const materials = [PINK, CYAN, YELLOW].map(color => additive(color));
  const flecks = [];
  for (let i = 0; i < count; i++) {
    const mesh = new Mesh(shape, materials[i % 3]);
    const a = i * 2.39996, b = Math.acos(1 - 2 * ((i + .5) / count));
    flecks.push({ mesh, x: Math.sin(b) * Math.cos(a), y: Math.cos(b) * .8 + .45, z: Math.sin(b) * Math.sin(a), speed: .7 + (i % 7) * .22 });
    scene.add(mesh);
  }
  return {
    burst(t, at, from, power = 1, life = .9) {
      const age = t - at;
      flecks.forEach(({ mesh, x, y, z, speed }, i) => {
        mesh.visible = age > 0 && age < life;
        if (!mesh.visible) return;
        const reach = speed * power;
        mesh.position.set(from.x + x * age * reach * 3.4, from.y + y * age * reach * 3 - age * age * 3, from.z + z * age * reach * 2.4);
        mesh.rotation.set(age * 9, i, age * 6);
        mesh.scale.setScalar((1 - clamp(age / life)) * (1 + (i % 3) * .5) * power ** .5);
      });
    },
  };
}

// An original tin-toy robot: drum head with a wraparound visor, a cassette
// deck in its chest and moon boots. Arms and legs hang along -y.
function createBot(set) {
  const { textures, env, reelTexture, floorClip } = set;
  const clipped = material => { material.clippingPlanes = [floorClip]; return material; };
  const chrome = clipped(new MeshStandardMaterial({ color: 0xf6f0ff, metalness: 1, roughness: .2, envMap: env }));
  const dark = clipped(new MeshStandardMaterial({ color: 0x26104d, metalness: .5, roughness: .32, envMap: env, envMapIntensity: .6 }));
  const glass = clipped(new MeshStandardMaterial({ color: 0x07020f, metalness: .9, roughness: .08, envMap: env }));
  const pink = clipped(new MeshBasicMaterial({ color: PINK, toneMapped: false }));
  const cyan = clipped(new MeshBasicMaterial({ color: CYAN, toneMapped: false }));
  const add = (parent, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const ring = (radius, tube) => new TorusGeometry(radius, tube, 6, 40).rotateX(Math.PI / 2);

  const root = new Group();
  root.scale.setScalar(1.12);
  const pelvis = new Group();
  root.add(pelvis);
  add(pelvis, new CylinderGeometry(.36, .3, .26, 20), dark);
  const spine = new Group();
  spine.position.y = .1;
  pelvis.add(spine);
  add(spine, new CylinderGeometry(.62, .44, .98, 28), chrome, 0, .55);
  add(spine, ring(.62, .028), pink, 0, 1.03);
  add(spine, ring(.45, .026), cyan, 0, .07);

  const deckTexture = paint(textures, 256, 150, (ctx, w, h) => {
    ctx.fillStyle = '#120626';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff3fa4';
    ctx.fillRect(0, 0, w, 14);
    ctx.fillStyle = '#2de2e6';
    ctx.fillRect(0, 18, w, 6);
    ctx.fillStyle = '#2a1256';
    ctx.fillRect(30, 44, 196, 74);
    ctx.strokeStyle = '#2de2e6';
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 44, 196, 74);
    ctx.fillStyle = '#ffe66d';
    ctx.font = 'bold 18px system-ui';
    ctx.fillText('SIDE A', 12, 142);
    ctx.fillStyle = '#ff3fa4';
    ctx.beginPath();
    ctx.arc(226, 134, 9, 0, Math.PI * 2);
    ctx.fill();
  });
  const deck = add(spine, new PlaneGeometry(.62, .36), clipped(new MeshBasicMaterial({ map: deckTexture, toneMapped: false })), 0, .62, .565);
  deck.rotation.x = .165;
  const reelMaterial = clipped(new MeshBasicMaterial({ map: reelTexture, toneMapped: false, transparent: true }));
  const chestReels = [-1, 1].map(side => {
    const reel = add(spine, new PlaneGeometry(.15, .15), reelMaterial, side * .14, .63, .58);
    reel.rotation.x = .165;
    return reel;
  });
  const deckPoint = new Object3D();
  deckPoint.position.set(0, .62, .62);
  spine.add(deckPoint);
  add(spine, new CylinderGeometry(.13, .16, .2, 14), dark, 0, 1.12);

  const head = new Group();
  head.position.y = 1.18;
  spine.add(head);
  add(head, new CylinderGeometry(.5, .5, .6, 32), chrome, 0, .34);
  add(head, new SphereGeometry(.5, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), chrome, 0, .64).scale.y = .55;
  add(head, ring(.5, .03), pink, 0, .64);
  add(head, ring(.5, .03), cyan, 0, .04);
  add(head, new CylinderGeometry(.503, .503, .4, 32, 1, true, -1.25, 2.5), dark, 0, .36);
  const visorTexture = paint(textures, 512, 128 * VISOR_ROWS, drawVisor);
  visorTexture.wrapS = RepeatWrapping;
  visorTexture.minFilter = LinearFilter;
  visorTexture.generateMipmaps = false;
  visorTexture.repeat.y = 1 / VISOR_ROWS;
  add(head, new CylinderGeometry(.51, .51, .3, 32, 1, true, -1.15, 2.3), clipped(new MeshBasicMaterial({ map: visorTexture, toneMapped: false })), 0, .36);
  [-1, 1].forEach(side => {
    add(head, new CylinderGeometry(.12, .12, .14, 16).rotateZ(Math.PI / 2), chrome, side * .53, .36);
    add(head, new CylinderGeometry(.07, .07, .16, 12).rotateZ(Math.PI / 2), pink, side * .55, .36);
  });
  const antenna = new Group();
  antenna.position.y = .9;
  head.add(antenna);
  add(antenna, new CylinderGeometry(.022, .022, .42, 8), chrome, 0, .21);
  const bulb = add(antenna, new SphereGeometry(.08, 14, 10), pink, 0, .45);

  const shades = new Group();
  head.add(shades);
  [-1, 1].forEach(side => {
    add(shades, new BoxGeometry(.4, .22, .03), pink, side * .2, 0, -.015);
    add(shades, new BoxGeometry(.36, .18, .05), glass, side * .2, 0, .01);
  });
  add(shades, new BoxGeometry(.12, .04, .04), glass);

  const arms = [-1, 1].map(side => {
    const arm = new Group();
    arm.position.set(side * .74, .95, 0);
    spine.add(arm);
    add(arm, new SphereGeometry(.21, 18, 12), chrome);
    add(arm, new CylinderGeometry(.085, .075, UPPER, 12), chrome, 0, -UPPER / 2);
    const elbow = new Group();
    elbow.position.y = -UPPER;
    arm.add(elbow);
    add(elbow, new SphereGeometry(.1, 12, 8), dark);
    add(elbow, ring(.1, .028), cyan);
    add(elbow, new CylinderGeometry(.075, .105, FORE, 12), chrome, 0, -FORE / 2);
    add(elbow, ring(.11, .025), pink, 0, -FORE + .06);
    const hand = new Group();
    hand.position.y = -FORE;
    elbow.add(hand);
    add(hand, new SphereGeometry(.14, 14, 10), chrome, 0, -.1).scale.set(.95, 1.05, .8);
    const finger = new Group();
    finger.position.set(0, -.19, .05);
    hand.add(finger);
    add(finger, new CylinderGeometry(.04, .035, .26, 8), chrome, 0, -.13);
    const tip = new Object3D();
    tip.position.y = -.27;
    finger.add(tip);
    const knuckle = new Object3D();
    finger.add(knuckle);
    const thumb = new Group();
    thumb.position.set(0, -.1, .09);
    hand.add(thumb);
    add(thumb, new CylinderGeometry(.036, .036, .16, 8).rotateX(Math.PI / 2), chrome, 0, 0, .07);
    const grip = new Object3D();
    grip.position.set(0, -.16, .1);
    hand.add(grip);
    return { side, arm, elbow, hand, finger, tip, knuckle, thumb, grip };
  });

  const legs = [-1, 1].map(side => {
    const hip = new Group();
    hip.position.set(side * .27, -.06, 0);
    pelvis.add(hip);
    add(hip, new SphereGeometry(.13, 12, 8), dark);
    add(hip, new CylinderGeometry(.12, .1, THIGH, 12), chrome, 0, -THIGH / 2);
    const knee = new Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    add(knee, new SphereGeometry(.11, 12, 8), dark);
    add(knee, new CylinderGeometry(.1, .14, SHIN, 12), chrome, 0, -SHIN / 2);
    const ankle = new Group();
    ankle.position.y = -SHIN;
    knee.add(ankle);
    add(ankle, new CylinderGeometry(.17, .21, .16, 20), chrome, 0, -.06, .05).scale.z = 1.35;
    add(ankle, new CylinderGeometry(.215, .215, .035, 20), pink, 0, -.125, .05).scale.z = 1.35;
    return { side, hip, knee, ankle };
  });

  const world = new Vector3();
  const ik = {
    local: new Vector3(), reach: new Vector3(), r: new Vector3(), n: new Vector3(), x: new Vector3(),
    lx: new Vector3(1, 0, 0), lr: new Vector3(), ln: new Vector3(), a: new Matrix4(), b: new Matrix4(), fk: new Quaternion(), solved: new Quaternion(),
  };

  function plantLeg({ hip, knee, ankle }, fx, fy, fz) {
    const hx = pelvis.position.x + hip.position.x, hy = pelvis.position.y + hip.position.y, hz = pelvis.position.z;
    const dy = hy - (fy + ANKLE), dz = fz - hz, dx = fx - hx;
    const d = Math.min(Math.max(Math.hypot(dy, dz), .3), THIGH + SHIN - .001);
    const bend = Math.PI - Math.acos((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN));
    const lift = Math.acos(Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)));
    hip.rotation.set(-(Math.atan2(dz, dy) + lift), 0, Math.atan2(dx, d));
    knee.rotation.x = bend;
    ankle.rotation.set(-(hip.rotation.x + bend), 0, -hip.rotation.z);
  }

  return {
    root, spine, head, arms, deckPoint, chestReels, bulb,
    apply(p, t, sway = 0) {
      root.position.set(p.x, p.lift, p.z);
      root.rotation.set(0, p.ry, 0);
      pelvis.position.set(p.px, HIP + p.drop, p.pz);
      spine.rotation.set(p.lean, p.twist, p.side);
      spine.scale.set(1 + p.squash * .5, 1 - p.squash, 1 + p.squash * .5);
      head.rotation.set(p.nod, p.turn, p.tilt);
      antenna.rotation.set(sway * .6, 0, sway + Math.sin(t * 5) * .05);
      for (const { side, arm, elbow, hand, finger, thumb } of arms) {
        const r = side < 0;
        arm.rotation.set(r ? p.ra : p.la, side * (r ? p.rt : p.lt), side * (r ? p.ro : p.lo));
        elbow.rotation.set(-(r ? p.re : p.le), 0, 0);
        hand.rotation.set(r ? p.rw : p.lw, 0, 0);
        const gun = r ? p.rg : p.lg;
        finger.rotation.x = -1.9 * (1 - gun);
        thumb.rotation.x = 1.1 * (1 - gun);
      }
      plantLeg(legs[0], -.3 + p.rfx, p.rfy, p.rfz);
      plantLeg(legs[1], .3 + p.lfx, p.lfy, p.lfz);
      const s = p.shades;
      shades.position.set(0, mix(.84, .38, s), mix(.22, .56, s));
      shades.rotation.x = mix(-1.15, 0, s);
      root.updateMatrixWorld(true);
    },
    // Two-bone IK in spine space: lands the wrist on a world `target` with
    // the elbow bowed toward `pole`, blended over the FK pose by `weight`.
    reach(index, target, pole, weight = 1) {
      if (weight <= 0) return;
      const { arm, elbow } = arms[index];
      const { local, reach, r, n, x, lx, lr, ln, a, b, fk, solved } = ik;
      spine.updateWorldMatrix(true, false);
      spine.worldToLocal(local.copy(target));
      reach.copy(local).sub(arm.position);
      const d = Math.min(Math.max(reach.length(), .3), UPPER + FORE - .001);
      const bend = Math.PI - Math.acos((UPPER * UPPER + FORE * FORE - d * d) / (2 * UPPER * FORE));
      lr.set(0, -(UPPER + FORE * Math.cos(bend)), FORE * Math.sin(bend)).normalize();
      ln.crossVectors(lx, lr);
      r.copy(reach).normalize();
      n.copy(pole).addScaledVector(r, -pole.dot(r)).normalize();
      x.crossVectors(r, n);
      fk.copy(arm.quaternion);
      solved.setFromRotationMatrix(a.makeBasis(x, r, n).multiply(b.makeBasis(lx, lr, ln).transpose()));
      arm.quaternion.slerpQuaternions(fk, solved, weight);
      elbow.rotation.x = mix(elbow.rotation.x, -bend, weight);
      root.updateMatrixWorld(true);
    },
    visor(rowIndex, t) {
      const marquee = rowIndex === ROW.marquee;
      visorTexture.repeat.x = marquee ? .5 : 1;
      visorTexture.offset.set(marquee ? (t * .45) % 1 : 0, 1 - (rowIndex + 1) / VISOR_ROWS);
    },
    reels(angle) { chestReels.forEach((reel, i) => { reel.rotation.z = -angle - i; }); },
    grip(index, target) { return arms[index].grip.getWorldPosition(target); },
    tip(index, target) { return arms[index].tip.getWorldPosition(target); },
    // Unit vector the index finger points along, for balancing things on it.
    pointing(index, target) {
      arms[index].knuckle.getWorldPosition(world);
      return arms[index].tip.getWorldPosition(target).sub(world).normalize();
    },
    deck(target) { return deckPoint.getWorldPosition(target); },
  };
}

// One 512x128 row per expression; the visor shows a row at a time.
function drawVisor(ctx, w) {
  const glowText = (color, blur = 16) => { ctx.fillStyle = color; ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = blur; };
  for (let r = 0; r < VISOR_ROWS; r++) {
    const y = r * 128;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0420';
    ctx.fillRect(0, y, w, 128);
    ctx.fillStyle = 'rgba(180,45,255,.18)';
    for (let line = 4; line < 128; line += 6) ctx.fillRect(0, y + line, w, 2);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.font = '900 64px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  [0, 256].forEach(x => {
    glowText('#ff3fa4');
    ctx.fillText('RAD', x + 16, 66);
    glowText('#2de2e6');
    ctx.fillText('▶▶', x + 164, 66);
  });
  const eyes = (r, draw) => [176, 336].forEach((x, i) => { ctx.beginPath(); draw(x, r * 128 + 64, i ? 1 : -1); ctx.stroke(); });
  ctx.lineWidth = 14;
  glowText('#ff3fa4');
  eyes(ROW.happy, (x, y) => { ctx.moveTo(x - 34, y + 14); ctx.lineTo(x, y - 18); ctx.lineTo(x + 34, y + 14); });
  glowText('#2de2e6');
  eyes(ROW.wow, (x, y) => { ctx.arc(x, y, 30, 0, Math.PI * 2); });
  glowText('#ff3fa4');
  eyes(ROW.fierce, (x, y, side) => { ctx.moveTo(x - 36, y - 16 * side); ctx.lineTo(x + 36, y + 16 * side); });
  glowText('#2de2e6');
  eyes(ROW.blink, (x, y) => { ctx.moveTo(x - 34, y); ctx.lineTo(x + 34, y); });
  glowText('#2de2e6', 10);
  for (let i = 0; i < 9; i++) {
    ctx.globalAlpha = i < 6 ? 1 : .3;
    ctx.fillRect(110 + i * 32, ROW.loading * 128 + 46, 22, 36);
  }
  ctx.globalAlpha = 1;
}

function shadowBlob(scene) {
  const blob = new Mesh(new CircleGeometry(.5, 32), new MeshBasicMaterial({ color: 0x14062e, transparent: true, opacity: .4, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.scale.set(2, 1.3, 1);
  scene.add(blob);
  return blob;
}

const camShake = (camera, base, t, amount) => {
  camera.position.x = base.x + Math.sin(t * 90) * amount;
  camera.position.y = base.y + Math.sin(t * 77) * amount * .7;
};

// Yeet: rise through the grid (0.15-1.05), groove, catch the page ball and
// turn it into a neon orb (2.3-2.62), spin it on one finger, wind up
// (2.95-3.17), whip it into the sun at LANDS, watch it hit (3.95), drop the
// shades and fire finger guns.
const YEET_LANDS = 3.32;
const HIT_SUN = 3.95;
const Y = {
  burst: pose({ lift: -4.4, squash: -.12, nod: -.25, ra: -.2, ro: 2.5, re: .4, la: -.2, lo: 2.5, le: .4, rfy: .2, lfy: .3, rg: 1, lg: 1 }),
  apex: pose({ lift: .38, squash: -.16, nod: -.3, ra: -.3, ro: 2.7, re: .2, la: -.3, lo: 2.7, le: .2, rfy: .18, lfy: .28, rg: 1, lg: 1 }),
  touch: pose({ lift: 0, drop: -.1, squash: 0, ra: -.2, ro: 1.6, re: .5, la: -.2, lo: 1.6, le: .5 }),
  land: pose({ drop: -.42, squash: .2, lean: .18, nod: .18, ra: -.4, ro: 1.05, re: .8, la: -.4, lo: 1.05, le: .8, rfx: -.08, lfx: .08 }),
  cool: pose({ drop: -.06, lean: -.06, tilt: .1, ra: -1.35, ro: .3, re: .25, rg: 1, la: -.3, lo: .75, le: 1.6, lw: .4, rfx: -.12, lfx: .1 }),
  look: pose({ drop: -.08, turn: .45, nod: -.35, ra: -.2, ro: .3, re: .5, la: -2.3, lo: .55, le: .35, lg: .7 }),
  beckon: pose({ drop: -.06, turn: .4, nod: -.4, ra: -.2, ro: .3, re: .5, la: -2.6, lo: .45, le: .45, lg: .7, lfx: .06 }),
  catch: pose({ drop: -.2, squash: .08, turn: .3, nod: -.15, ra: -.25, ro: .4, re: .6, la: -1.7, lo: .45, le: 1.15, lg: 0 }),
  inspect: pose({ drop: -.1, turn: .12, nod: .05, ra: -.3, ro: .45, re: .9, la: -1.25, lo: .25, le: 1.85, lw: .3 }),
  toss: pose({ drop: -.18, squash: .06, turn: .1, nod: -.15, ra: -.3, ro: .5, re: .9, la: -1.05, lo: .3, le: 1.5 }),
  spin: pose({ drop: -.04, tilt: -.12, nod: -.1, side: -.05, ra: -.2, ro: .7, re: 1.6, rw: .4, la: -3.0, lo: .22, le: .1, lg: 1, rfx: -.1, lfx: .12 }),
  wind: pose({ drop: -.28, squash: -.05, lean: -.2, twist: .35, turn: -.4, nod: .05, ra: -1.5, ro: .55, re: .2, rg: 1, la: -3.3, lo: 1.0, le: .95, lg: 1, rfy: .45, rfz: .18, rfx: -.05, lfz: -.05 }),
  release: pose({ drop: -.32, squash: .08, lean: .32, twist: -.45, turn: -.3, nod: .1, ra: .55, ro: .45, re: .3, la: -2.25, lo: .2, le: .1, lg: 1, rfx: -.38, rfz: .28, lfz: -.15 }),
  follow: pose({ drop: -.3, lean: .5, twist: -.6, turn: -.45, nod: -.3, side: .06, ra: .8, ro: .95, re: .3, la: -.5, lo: -.15, le: .45, lfy: .45, lfz: -.5, rfx: -.38, rfz: .28 }),
  watch: pose({ drop: -.12, lean: .1, twist: -.2, turn: -.7, nod: -.3, ra: .2, ro: .5, re: .4, la: -.3, lo: .4, le: .5, rfx: -.2, rfz: .1 }),
  shades: pose({ drop: -.24, squash: .1, turn: .05, nod: .12, ra: -.6, ro: .4, re: 1.0, la: -.6, lo: .4, le: 1.0, shades: 1, rfx: -.15, lfx: .15 }),
  guns: pose({ drop: -.06, lean: -.12, tilt: .14, turn: .1, nod: .04, ra: -1.3, ro: .45, re: .12, rg: 1, la: -1.3, lo: .45, le: .12, lg: 1, shades: 1, rfx: -.18, lfx: .16 }),
};
const YEET_KEYS = [
  [.15, Y.burst], [.78, Y.apex, 'o'], [.95, Y.touch, 'i'], [1.06, Y.land, 'o'], [1.32, Y.cool, 'b'], [1.7, Y.cool],
  [1.92, Y.look], [2.2, Y.beckon], [2.36, Y.catch, 'o'], [2.52, Y.inspect], [2.64, Y.toss, 'o'], [2.78, Y.spin, 'b'],
  [2.94, Y.spin], [3.17, Y.wind], [YEET_LANDS, Y.release, 'i'], [3.56, Y.follow, 'o'], [3.92, Y.watch],
  [4.08, Y.shades, 'b'], [4.3, Y.guns, 'b'],
];
const YEET_FACE = [[0, ROW.wow], [1.04, ROW.blink], [1.14, ROW.marquee], [1.78, ROW.wow], [2.64, ROW.happy], [2.96, ROW.fierce], [3.36, ROW.wow], [HIT_SUN, ROW.happy]];

function createYeet(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const set = createSet(stage, -6.8);
  const { textures, glowTexture } = set;
  const bot = createBot(set);
  scene.add(bot.root);
  const blob = shadowBlob(scene);
  const pad = new Mesh(new PlaneGeometry(1, 1), additive(PINK, 1, glowTexture));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = .02;
  const scan = new Mesh(new PlaneGeometry(3, .05), additive(CYAN));
  const scanGlow = new Mesh(new PlaneGeometry(3, .5), additive(CYAN, .3, glowTexture));
  scene.add(pad, scan, scanGlow);

  const paperTexture = paint(textures, 512, 512, (ctx, w) => {
    ctx.fillStyle = '#1a0b3d';
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = '#ff3fa4';
    ctx.font = 'bold 44px system-ui';
    ctx.fillText('SHIP', 38, 70);
    ctx.fillStyle = '#2de2e6';
    ctx.font = 'bold 26px system-ui';
    wrap(ctx, title.trim(), 430, 2).forEach((line, i) => ctx.fillText(line, 38, 124 + i * 32));
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#8a46d8' : '#e8dcff';
      ctx.fillRect(39, 200 + i * 44, 280 + Math.sin(i * 3) * 70, 10);
    }
  });
  const paper = new Mesh(new OctahedronGeometry(.42, 1), new MeshStandardMaterial({ map: paperTexture, roughness: .8, flatShading: true }));
  scene.add(paper);

  const orbTexture = paint(textures, 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1a0838';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2de2e6';
    ctx.lineWidth = 4;
    for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 16; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.fillStyle = '#ff3fa4';
    ctx.fillRect(0, 100, w, 56);
    ctx.fillStyle = '#fff4fb';
    ctx.font = 'bold 34px system-ui';
    ctx.textBaseline = 'middle';
    ctx.fillText(`★ ${title.trim().slice(0, 20).toUpperCase()} ★`, 12, 129);
  });
  const orb = new Group();
  const ball = new Mesh(new SphereGeometry(.3, 24, 16), new MeshBasicMaterial({ map: orbTexture, toneMapped: false }));
  const band = new Mesh(new TorusGeometry(.46, .028, 6, 48), additive(CYAN));
  const halo = new Mesh(new PlaneGeometry(1, 1), additive(PINK, .9, glowTexture));
  orb.add(ball, band);
  scene.add(orb, halo);
  const ghosts = Array.from({ length: 5 }, (_, i) => new Mesh(ball.geometry, additive(i % 2 ? CYAN : PINK, .5)));
  scene.add(...ghosts);
  const beam = new Mesh(new CylinderGeometry(1, 1, 1, 8, 1, true), additive(PINK, .75));
  const core = new Mesh(beam.geometry, additive(0xfff0fa, .95));
  scene.add(beam, core);
  const beams = [beam, core];
  const change = new Mesh(new TorusGeometry(1, .04, 6, 40), additive(CYAN));
  scene.add(change);

  const starTexture = paint(textures, 128, 128, ctx => {
    ctx.fillStyle = '#fff6fd';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
      ctx.quadraticCurveTo(64, 64, 64 + Math.cos(a + Math.PI / 2) * 62, 64 + Math.sin(a + Math.PI / 2) * 62);
    }
    ctx.fill();
  });
  const twinkle = new Mesh(new PlaneGeometry(1, 1), additive(0xffffff, 1, starTexture));
  const flash = new Mesh(new PlaneGeometry(1, 1), additive(YELLOW, 1, glowTexture));
  const shock = new Mesh(new TorusGeometry(1, .05, 6, 56), additive(PINK));
  scene.add(twinkle, flash, shock);
  const impact = [twinkle, flash, shock];
  const sparks = createSparks(scene);

  const p = { ...REST };
  const v = new Vector3(), w = new Vector3(), dir = new Vector3(), up = new Vector3(0, 1, 0);
  const tail = new Vector3();
  const base = camera.position.clone();
  const hits = [.95, 2.36, YEET_LANDS, 4.08];

  function pose(t) {
    sample(YEET_KEYS, t, p);
    const groove = pulse(t, 1.25, 1.85) + pulse(t, 2.72, 3.0) + range(t, 4.25, 4.4);
    p.drop -= Math.abs(Math.sin(t * Math.PI * 4)) * .07 * groove;
    p.nod += Math.sin(t * Math.PI * 4) * .07 * groove;
    p.le += Math.sin(t * 26) * .35 * pulse(t, 1.95, 2.3);
    const recoil = pulse(t, 4.42, 4.56) + pulse(t, 4.66, 4.8);
    p.ra -= recoil * .4;
    p.la -= recoil * .4;
    p.lean -= recoil * .05;
    const sway = hits.reduce((sum, at) => sum + wobble(t, at, 13, 4) * .35, 0);
    bot.apply(p, t, sway);
  }

  // Where the orb sits: in the palm, then balanced on the fingertip.
  function held(t, target) {
    if (t < 2.64) return bot.grip(1, target);
    bot.tip(1, target).addScaledVector(bot.pointing(1, w), .32);
    if (t < 2.8) {
      const u = range(t, 2.64, 2.8);
      bot.grip(1, v);
      target.lerpVectors(v, target, smooth(u)).y += Math.sin(u * Math.PI) * .7;
    }
    return target;
  }

  pose(YEET_LANDS);
  const origin = held(YEET_LANDS, new Vector3());
  pose(2.52);
  const morphAt = bot.grip(1, new Vector3());
  const target = set.sunCentre.clone();
  target.y += .6;
  function flight(t, out) {
    const u = range(t, YEET_LANDS, HIT_SUN);
    const s = 1 - (1 - u) * (1 - u);
    out.lerpVectors(origin, target, s);
    out.y += Math.sin(s * Math.PI) * 2.2;
    return out;
  }

  function render(t) {
    pose(t);
    set.update(t, pulse(t, HIT_SUN, 4.4) + pulse(t, .9, 1.2) * .6);
    bot.visor(row(t, YEET_FACE), t);
    bot.reels(t * 3);

    const thrown = t >= YEET_LANDS;
    paper.visible = t > 2.26 && t < 2.6;
    if (paper.visible) {
      bot.grip(1, paper.position);
      paper.scale.setScalar(back(range(t, 2.26, 2.4)) * (1 - range(t, 2.48, 2.6)));
      paper.rotation.set(t * 2, t * 1.4 + range(t, 2.48, 2.6) * 8, t);
    }
    orb.visible = t > 2.5 && t < HIT_SUN + .02;
    if (thrown) flight(t, orb.position);
    else held(t, orb.position);
    orb.scale.setScalar(back(range(t, 2.5, 2.66), 2.2) * (thrown ? 1 - .55 * range(t, YEET_LANDS, HIT_SUN) : 1));
    ball.rotation.set(0, t * (t > 2.78 ? 22 : 4), 0);
    band.rotation.set(1.25 + Math.sin(t * 5) * .15, 0, t * 4);
    halo.visible = orb.visible;
    halo.position.copy(orb.position);
    halo.quaternion.copy(camera.quaternion);
    halo.scale.setScalar(orb.scale.x * (1.8 + .3 * Math.sin(t * 17)) + pulse(t, 2.5, 2.75) * 2.5);

    change.visible = t > 2.5 && t < 2.85;
    change.position.copy(morphAt);
    change.quaternion.copy(camera.quaternion);
    change.scale.setScalar(.2 + out(range(t, 2.5, 2.85)) * 1.6);
    change.material.opacity = 1 - range(t, 2.5, 2.85);

    const trail = t > YEET_LANDS && t < HIT_SUN + .16;
    beam.visible = core.visible = trail;
    if (trail) {
      flight(Math.min(t, HIT_SUN), v);
      flight(Math.max(YEET_LANDS, t - .16), tail);
      dir.copy(v).sub(tail);
      const length = Math.max(dir.length(), .001);
      dir.normalize();
      for (let i = 0; i < 2; i++) {
        const mesh = beams[i];
        mesh.position.lerpVectors(tail, v, .5);
        mesh.quaternion.setFromUnitVectors(up, dir);
        mesh.scale.set(i ? .028 : .085, length, i ? .028 : .085);
      }
    }
    ghosts.forEach((ghost, i) => {
      const at = t - (i + 1) * .035;
      ghost.visible = thrown && at > YEET_LANDS && t < HIT_SUN;
      flight(at, ghost.position);
      ghost.scale.setScalar(orb.scale.x * (1 - i * .15));
    });

    const boom = range(t, HIT_SUN, HIT_SUN + .14), fade = 1 - range(t, HIT_SUN + .14, 4.5);
    twinkle.visible = flash.visible = shock.visible = t > HIT_SUN && fade > 0;
    for (const mesh of impact) {
      mesh.position.copy(target);
      mesh.position.z += .3;
      mesh.quaternion.copy(camera.quaternion);
    }
    twinkle.rotateZ(t * 3);
    twinkle.scale.setScalar(7 * back(boom, 2.4) * fade);
    flash.scale.setScalar(16 * out(boom) * fade);
    flash.material.opacity = fade;
    shock.scale.setScalar(1 + out(range(t, HIT_SUN, 4.5)) * 9);
    shock.material.opacity = 1 - range(t, HIT_SUN, 4.5);
    set.sun.scale.setScalar(1 + wobble(t, HIT_SUN, 18, 5) * .08);

    if (t > YEET_LANDS - .03) sparks.burst(t, YEET_LANDS - .03, origin, 1.1, .85);
    else if (t > 2.5) sparks.burst(t, 2.5, morphAt, .6, .7);
    else sparks.burst(t, .62, pad.position, .9, 1);

    const rise = bot.root.position.y;
    pad.scale.setScalar(2.6 + pulse(t, .15, 1.2) * 1.6);
    pad.material.opacity = .35 + pulse(t, .1, 1.15) * .65;
    const sweep = range(t, 1.02, 1.5);
    scan.visible = scanGlow.visible = sweep > 0 && sweep < 1;
    scan.position.set(0, .1 + sweep * 4.1, .9);
    scanGlow.position.copy(scan.position);
    bot.spine.getWorldPosition(v);
    blob.position.set(v.x, .012, v.z + .1);
    blob.material.opacity = .4 * range(rise, -.6, 0) * (1 - clamp(rise) * .5);
    glow.intensity = 10 + Math.sin(t * 3) * 3 + pulse(t, YEET_LANDS, 3.7) * 10;
    camShake(camera, base, t, pulse(t, .95, 1.15) * .05 + pulse(t, YEET_LANDS, 3.6) * .04 + pulse(t, HIT_SUN, 4.2) * .025);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => { set.dispose(); dispose(textures); } };
}

// PR opened: the robot pokes a giant boombox's play button on the first two
// hits (1.5, 1.95), cranks the volume knob, and on LANDS the speakers blast
// shockwave rings, the deck door pops and the cassette flies out while the
// robot moonwalks away, twirls and catches it.
const STRIKES = [1.5, 1.95, 3.05];
const TAPS = STRIKES.slice(0, 2);
const PR_LANDS = STRIKES[2];
const CATCH = 3.92;
const R = {
  idle: pose({ x: 1.5, z: .3, ry: -.55, nod: .05, la: -.2, lo: .7, le: 1.5, lw: .4 }),
  poke: pose({ x: 1.5, z: .3, ry: -.55, drop: -.12, lean: .12, nod: .15, la: -.2, lo: .7, le: 1.5, lw: .4 }),
  pump: pose({ x: 1.5, z: .3, ry: -.55, drop: -.2, squash: .06, lean: .15, nod: .3, la: -2.6, lo: .35, le: 1.0, lfx: .05 }),
  crank: pose({ x: 1.5, z: .3, ry: -.6, drop: -.16, lean: .2, twist: -.15, nod: .1, turn: -.15, la: -.4, lo: .9, le: .9, lg: 1, rfx: -.1, lfx: .12 }),
  brace: pose({ x: 1.5, z: .3, ry: -.6, drop: -.3, squash: .1, lean: .25, twist: -.2, nod: .2, la: -.6, lo: 1.1, le: .7, rfx: -.12, lfx: .14 }),
  blown: pose({ x: 2.9, z: .3, ry: -1.3, drop: -.1, squash: -.08, lean: -.25, nod: -.25, ra: .5, ro: 1.3, re: .3, la: .4, lo: 1.4, le: .3 }),
  glide: pose({ x: 3.4, z: .45, ry: -1.42, drop: -.12, lean: .12, nod: .1, ra: -.5, ro: .25, re: 1.2, la: .45, lo: .25, le: .8 }),
  twirl: pose({ x: 3.45, z: .45, ry: Math.PI * 2 - .15, drop: -.06, squash: -.06, ra: -.3, ro: 1.2, re: .3, la: -2.9, lo: .35, le: .2, lfy: .3, lfx: .1 }),
  ta: pose({ x: 3.45, z: .45, ry: Math.PI * 2 - .2, lift: .08, drop: -.02, tilt: .16, nod: -.05, turn: -.1, ra: -1.45, ro: .3, re: .12, rg: 1, la: -2.95, lo: .3, le: .25, shades: 1, rfx: -.08, lfx: .02, lfz: .1 }),
};
const PR_KEYS = [
  [.9, R.idle], [1.28, R.poke], [STRIKES[0], R.pump, 'i'], [1.72, R.poke], [STRIKES[1], R.pump, 'i'], [2.2, R.crank, 'o'],
  [2.85, R.crank], [2.98, R.brace], [3.2, R.blown, 'o'], [3.62, R.glide, 'o'], [3.84, R.twirl], [4.02, R.ta, 'b'],
];
const PR_FACE = [[0, ROW.marquee], [1.25, ROW.fierce], [1.6, ROW.happy], [2.25, ROW.fierce], [PR_LANDS, ROW.wow], [3.5, ROW.happy]];

function createPr(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const set = createSet(stage, -.9);
  const { textures, glowTexture, reelTexture, env } = set;
  const bot = createBot(set);
  scene.add(bot.root);
  const blob = shadowBlob(scene);

  const shell = new MeshStandardMaterial({ color: 0x2a1060, metalness: .5, roughness: .32, envMap: env, envMapIntensity: .7 });
  const chrome = new MeshStandardMaterial({ color: 0xf6f0ff, metalness: 1, roughness: .2, envMap: env });
  const black = new MeshStandardMaterial({ color: 0x0d0420, metalness: .2, roughness: .6 });
  const neonPink = new MeshBasicMaterial({ color: PINK, toneMapped: false });
  const neonCyan = new MeshBasicMaterial({ color: CYAN, toneMapped: false });
  const box = new Group();
  box.position.set(-1.7, 0, -.8);
  box.rotation.y = .12;
  scene.add(box);
  const body = new Group();
  box.add(body);
  const put = (geometry, material, x, y, z, parent = body) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  put(new BoxGeometry(4.4, 2.3, 1.1), shell, 0, 1.3, 0);
  [[0, 2.45, 4.46, .07], [0, .15, 4.46, .07]].forEach(([x, y, width, height]) => put(new BoxGeometry(width, height, .08), neonPink, x, y, .56));
  [-2.23, 2.23].forEach(x => put(new BoxGeometry(.07, 2.3, .08), neonCyan, x, 1.3, .56));
  [-1.7, 1.7].forEach(x => put(new BoxGeometry(.5, .14, .7), black, x, .07, 0));
  const handle = put(new TorusGeometry(1.5, .08, 8, 32, Math.PI), chrome, 0, 2.45, 0);
  handle.scale.y = .42;
  const speakers = [-1.42, 1.42].map(x => {
    const speaker = new Group();
    speaker.position.set(x, 1.12, .56);
    body.add(speaker);
    put(new TorusGeometry(.78, .07, 8, 40), chrome, 0, 0, 0, speaker);
    const neon = put(new TorusGeometry(.86, .025, 6, 48), neonPink, 0, 0, .02, speaker);
    const cone = new Group();
    speaker.add(cone);
    put(new CylinderGeometry(.74, .2, .3, 28, 1, true).rotateX(Math.PI / 2), black, 0, 0, -.12, cone);
    put(new SphereGeometry(.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), chrome, 0, 0, -.02, cone);
    return { speaker, cone, neon };
  });

  const labelTexture = paint(textures, 512, 160, (ctx, w, h) => {
    const stripes = ctx.createLinearGradient(0, 0, 0, h);
    stripes.addColorStop(0, '#ff3fa4');
    stripes.addColorStop(.5, '#b42dff');
    stripes.addColorStop(1, '#2de2e6');
    ctx.fillStyle = stripes;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff4fb';
    ctx.fillRect(0, 34, w, 92);
    ctx.fillStyle = '#3a1260';
    ctx.font = 'bold 30px system-ui';
    ctx.fillText('PULL REQUEST · SIDE A', 22, 68);
    ctx.font = 'bold 26px system-ui';
    ctx.fillText(title.trim().slice(0, 30), 22, 108);
  });
  const reelMaterial = new MeshBasicMaterial({ map: reelTexture, transparent: true, toneMapped: false });
  const cassette = new Group();
  const tapeBody = put(new BoxGeometry(1.15, .72, .12), black, 0, 0, 0, cassette);
  tapeBody.material = new MeshStandardMaterial({ color: 0x1a0838, metalness: .3, roughness: .4 });
  put(new PlaneGeometry(1.02, .32), new MeshBasicMaterial({ map: labelTexture, toneMapped: false }), 0, .14, .065, cassette);
  const tapeReels = [-.27, .27].map(x => put(new PlaneGeometry(.2, .2), reelMaterial, x, -.15, .066, cassette));
  put(new BoxGeometry(1.17, .74, .1), neonCyan, 0, 0, -.02, cassette);
  const deckSpot = new Vector3(0, 1.55, .5);
  cassette.position.copy(deckSpot);
  body.add(cassette);
  const door = new Group();
  door.position.set(0, 1.12, .6);
  body.add(door);
  put(new PlaneGeometry(1.1, .9), new MeshBasicMaterial({ color: 0xb42dff, transparent: true, opacity: .28, depthWrite: false }), 0, .45, 0, door);
  [[0, .9, 1.14, .05], [0, 0, 1.14, .05]].forEach(([x, y, width, height]) => put(new BoxGeometry(width, height, .04), neonCyan, x, y, 0, door));
  [-.55, .55].forEach(x => put(new BoxGeometry(.05, .9, .04), neonCyan, x, .45, 0, door));
  const buttons = [.95, 1.3, 1.65].map((x, i) => put(new BoxGeometry(.26, .14, .3), i < 2 ? chrome : neonPink, x, 2.52, .15));
  const knob = put(new CylinderGeometry(.17, .17, .12, 20).rotateX(Math.PI / 2), chrome, 1.82, 2.15, .6);
  put(new BoxGeometry(.04, .14, .03), neonPink, 0, .08, .07, knob);
  const bars = Array.from({ length: 9 }, (_, i) => {
    const bar = put(new BoxGeometry(.09, 1, .04), i % 2 ? neonCyan : neonPink, -.48 + i * .12, .32, .57);
    bar.geometry.translate(0, .5, 0);
    return bar;
  });
  const rings = Array.from({ length: 4 }, (_, i) => {
    const mesh = new Mesh(new TorusGeometry(.86, .05, 6, 56), additive(i % 2 ? CYAN : PINK));
    scene.add(mesh);
    return mesh;
  });
  const deckGlow = new Mesh(new PlaneGeometry(1, 1), additive(PINK, 1, glowTexture));
  scene.add(deckGlow);
  const sparks = createSparks(scene);

  const p = { ...REST };
  const v = new Vector3(), aim = new Vector3(), pole = new Vector3(-.8, -1, -.3);
  const button = new Vector3(), knobAt = new Vector3(), from = new Vector3();
  const base = camera.position.clone();
  box.updateMatrixWorld(true);
  buttons[2].getWorldPosition(button);
  knob.getWorldPosition(knobAt);
  const launch = body.localToWorld(deckSpot.clone());
  const speakerAt = speakers.map(({ speaker }) => speaker.getWorldPosition(new Vector3()));

  function pose(t) {
    sample(PR_KEYS, t, p);
    const step = t * Math.PI * 7;
    p.rfz += Math.sin(step) * .3 * pulse(t, 3.15, 3.75);
    p.lfz -= Math.sin(step) * .3 * pulse(t, 3.15, 3.75);
    p.rfy += Math.max(0, Math.cos(step)) * .14 * pulse(t, 3.15, 3.75);
    p.lfy += Math.max(0, -Math.cos(step)) * .14 * pulse(t, 3.15, 3.75);
    const groove = range(t, 1.5, 1.6) * (1 - range(t, 2.2, 2.3)) + range(t, 4.05, 4.2);
    p.nod += Math.sin(t * Math.PI * 4) * .08 * groove;
    p.drop -= Math.abs(Math.sin(t * Math.PI * 4)) * .05 * groove;
    const sway = STRIKES.reduce((sum, at) => sum + wobble(t, at, 13, 4) * .3, 0) + wobble(t, 3.84, 12, 4) * .4;
    bot.apply(p, t, sway);
    // The poking hand hovers over the play button, jabs it on each hit, then
    // grabs the volume knob and cranks it until the drop throws it off.
    const down = TAPS.reduce((sum, at) => sum + range(t, at - .14, at) * (1 - range(t, at + .02, at + .2)), 0);
    aim.copy(button).y += .1 + .45 * (1 - clamp(down));
    const toKnob = smooth(range(t, 2.05, 2.3));
    v.copy(knobAt);
    v.z += .2;
    v.x += Math.cos(t * 18) * .06 * range(t, 2.3, 2.45);
    v.y += Math.sin(t * 18) * .06 * range(t, 2.3, 2.45);
    aim.lerp(v, toKnob);
    bot.reach(0, aim, pole, smooth(range(t, 1.0, 1.28)) * (1 - smooth(range(t, 2.95, 3.1))));
  }

  pose(CATCH);
  const catchAt = bot.grip(1, new Vector3());
  catchAt.y += .32;

  function render(t) {
    pose(t);
    const energy = STRIKES.reduce((sum, at, i) => sum + Math.exp(-Math.max(0, t - at) * 7) * (t >= at ? (i === 2 ? 1.4 : .9) : 0), 0)
      + Math.max(0, Math.sin(t * Math.PI * 4)) ** 6 * .45 * range(t, 3.2, 3.4);
    set.update(t, Math.min(1.2, energy));
    bot.visor(row(t, PR_FACE), t);
    const playing = range(t, 1.5, 1.55);
    bot.reels(t * 3 + playing * (t - 1.5) * 9);

    const shake = range(t, 2.35, 3.0) ** 2;
    const anticipate = pulse(t, 2.8, 3.06) * (t < PR_LANDS ? 1 : 0);
    box.position.x = -1.7 + Math.sin(t * 71) * .04 * shake;
    box.position.y = STRIKES.reduce((sum, at, i) => sum + pulse(t, at, at + (i === 2 ? .4 : .24)) * (i === 2 ? .55 : .2), 0);
    body.scale.set(1 + anticipate * .06 + wobble(t, PR_LANDS, 16, 6) * -.08, 1 - anticipate * .1 + wobble(t, PR_LANDS, 16, 6) * .12, 1);
    box.rotation.z = Math.sin(t * 53) * .02 * shake + wobble(t, STRIKES[1], 12, 6) * .05;
    speakers.forEach(({ cone, neon }) => {
      cone.position.z = Math.min(.3, energy * .22);
      cone.scale.setScalar(1 + energy * .08);
      neon.material.color.setScalar(.6 + energy * .5);
    });
    bars.forEach((bar, i) => { bar.scale.y = .06 + (.12 + .34 * Math.abs(Math.sin(t * (7 + i * 1.7) + i))) * Math.min(1, playing * .4 + energy); });
    knob.rotation.z = -range(t, 2.3, 2.95) * 4.2;
    buttons[2].position.y = 2.52 - .08 * TAPS.reduce((sum, at) => sum + pulse(t, at - .03, at + .14), 0);
    door.rotation.x = Math.min(1.6, back(range(t, PR_LANDS, PR_LANDS + .2), 2.5) * 1.35) - wobble(t, PR_LANDS + .2, 18, 7) * .2;

    const flying = t >= PR_LANDS;
    if (!flying) {
      if (cassette.parent !== body) body.add(cassette);
      cassette.position.copy(deckSpot);
      cassette.rotation.set(0, 0, 0);
      cassette.scale.setScalar(.85);
    } else {
      if (cassette.parent !== scene) scene.add(cassette);
      if (t < CATCH) {
        const u = range(t, PR_LANDS, CATCH);
        cassette.position.lerpVectors(launch, catchAt, u);
        cassette.position.y += Math.sin(u * Math.PI) * 2.4;
        cassette.rotation.set(u * Math.PI * 4, u * Math.PI * 2, Math.sin(u * 9) * .3);
      } else {
        bot.grip(1, cassette.position);
        cassette.position.y += .32;
        cassette.rotation.set(0, wobble(t, CATCH, 14, 5) * .6, wobble(t, CATCH, 10, 4) * .25);
      }
      cassette.scale.setScalar(.75);
    }
    tapeReels.forEach(reel => { reel.rotation.z = -t * 3 - playing * (t - 1.5) * 11; });

    let latest = -1;
    STRIKES.forEach((at, i) => { if (t >= at) latest = i; });
    rings.forEach((ring, i) => {
      const at = STRIKES[latest] ?? 0, big = latest === 2;
      const age = t - at - (i >> 1) * .1;
      const life = big ? .7 : .4;
      ring.visible = latest >= 0 && age > 0 && age < life;
      if (!ring.visible) return;
      ring.position.copy(speakerAt[i % 2]);
      ring.position.z += age * (big ? 4 : 1.2);
      ring.scale.setScalar(1 + out(age / life) * (big ? 4.5 : 1.1));
      ring.material.opacity = 1 - age / life;
    });
    deckGlow.position.copy(launch);
    deckGlow.position.z += .3;
    deckGlow.scale.setScalar(.5 + pulse(t, PR_LANDS - .05, 3.4) * 5);
    deckGlow.material.opacity = pulse(t, PR_LANDS - .05, 3.4);
    if (t >= PR_LANDS - .03) sparks.burst(t, PR_LANDS - .03, launch, 1.2, .9);
    else if (t >= STRIKES[1] - .02) sparks.burst(t, STRIKES[1] - .02, from.copy(button).setY(2.7), .45, .45);
    else sparks.burst(t, STRIKES[0] - .02, from.copy(button).setY(2.7), .45, .45);

    bot.spine.getWorldPosition(v);
    blob.position.set(v.x, .012, v.z + .1);
    glow.intensity = 10 + energy * 12;
    camShake(camera, base, t, Math.min(.06, energy * .02) + pulse(t, PR_LANDS, 3.4) * .05);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => { set.dispose(); dispose(textures); } };
}

// Plan reveal: the robot starts the tape in its chest (1.2), whirs, spits a
// ribbon that ripples up and flattens into a sheet in its hands, lights it on
// LANDS, then thrusts it front and centre for the overlay to push in on.
const PLAN_LANDS = 2.55;
const RELEASE = 3.22;
const FLIGHT = [RELEASE, 3.85];
const ASPECT = .775;
// On the camera's line of sight, where the send-offs plugin pushes in, and the
// sheet's width there (46% of the view).
const FRONT = new Vector3(.125, 2.375, 6);
const FRONT_WIDTH = 2.8;
const RIBBON = 40;
const PL = {
  idle: pose({ nod: .04, tilt: .06 }),
  press: pose({ drop: -.08, nod: .3, lean: .08, rhx: -.12, rhy: 2.12, rhz: .78 }),
  whir: pose({ drop: -.1, nod: -.05, lhx: 1.35, lhy: 1.9, lhz: .35, rhx: -1.35, rhy: 1.9, rhz: .35, rfx: -.1, lfx: .1 }),
  crouch: pose({ drop: -.3, squash: .1, lean: .1, nod: .1, lhx: 1.3, lhy: 1.55, lhz: .4, rhx: -1.3, rhy: 1.55, rhz: .4, rfx: -.12, lfx: .12 }),
  spit: pose({ drop: -.06, squash: -.08, lean: -.22, nod: -.35, lhx: 1.35, lhy: 2.75, lhz: .1, rhx: -1.35, rhy: 2.75, rhz: .1, rfx: -.12, lfx: .12 }),
  hold: pose({ drop: -.1, lean: .04, nod: .12, rfx: -.12, lfx: .12 }),
  proud: pose({ drop: -.04, lean: -.06, nod: .06, tilt: -.08, rfx: -.12, lfx: .12 }),
  wind: pose({ drop: -.2, squash: .06, lean: -.12, nod: .05, rfx: -.12, lfx: .12, rfz: -.1 }),
  thrust: pose({ drop: -.22, lean: .28, nod: .1, lhx: .55, lhy: 2.5, lhz: 1.25, rhx: -.55, rhy: 2.5, rhz: 1.25, rfz: .25, rfx: -.12, lfx: .12 }),
  ta: pose({ drop: -.06, lean: -.08, tilt: .12, shades: 1, lhx: 1.5, lhy: 3.0, lhz: .55, rhx: -1.5, rhy: 3.0, rhz: .55, rg: 1, lg: 1, rfx: -.12, lfx: .12 }),
};
const PLAN_KEYS = [
  [.8, PL.idle], [1.12, PL.press], [1.24, PL.press], [1.45, PL.whir, 'o'], [1.62, PL.whir], [1.8, PL.crouch],
  [1.98, PL.spit, 'o'], [2.3, PL.hold], [PLAN_LANDS, PL.proud, 'b'], [3.02, PL.proud], [3.16, PL.wind],
  [3.3, PL.thrust, 'o'], [3.62, PL.ta, 'b'],
];
const PLAN_FACE = [[0, ROW.marquee], [1.2, ROW.loading], [1.84, ROW.wow], [2.34, ROW.blink], [2.42, ROW.wow], [PLAN_LANDS, ROW.happy], [3.12, ROW.fierce], [3.32, ROW.happy]];

function createPlan(container, title) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const set = createSet(stage, 3.4);
  const { textures, glowTexture } = set;
  const bot = createBot(set);
  scene.add(bot.root);
  const blob = shadowBlob(scene);
  blob.position.set(0, .012, .1);

  const sheetTexture = paint(textures, 512, 396, (ctx, w, h) => {
    ctx.fillStyle = '#fdf0ff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ff3fa4';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#e0218a';
    ctx.font = '900 48px system-ui';
    ctx.fillText('PLAN.EXE', 36, 76);
    ctx.fillStyle = '#3a1260';
    ctx.font = 'bold 25px system-ui';
    wrap(ctx, title.trim(), 440, 2).forEach((line, i) => ctx.fillText(line, 36, 122 + i * 30));
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = '#00a3b0';
      ctx.lineWidth = 5;
      ctx.strokeRect(38, 196 + i * 38, 20, 20);
      ctx.beginPath();
      ctx.moveTo(42, 206 + i * 38);
      ctx.lineTo(48, 212 + i * 38);
      ctx.lineTo(62, 192 + i * 38);
      ctx.stroke();
      ctx.fillStyle = i % 2 ? '#b98fd6' : '#8a3ffc';
      ctx.fillRect(76, 200 + i * 38, 250 + Math.sin(i * 3) * 80, 11);
    }
  });
  const sheet = new Mesh(new PlaneGeometry(1, 1).translate(0, -.5, 0), new MeshBasicMaterial({ map: sheetTexture, side: DoubleSide, toneMapped: false }));
  const aura = new Mesh(new PlaneGeometry(1, 1), additive(PINK, 1, glowTexture));
  scene.add(aura, sheet);

  const ribbonGeometry = new PlaneGeometry(1, 1, 1, RIBBON);
  const ribbon = new Mesh(ribbonGeometry, new MeshStandardMaterial({ color: 0x9a4ac0, metalness: .7, roughness: .25, envMap: set.env, side: DoubleSide }));
  ribbon.frustumCulled = false;
  scene.add(ribbon);
  const positions = ribbonGeometry.attributes.position;
  const sparks = createSparks(scene, 40);

  const p = { ...REST };
  const top = new Vector3(), deck = new Vector3(), high = new Vector3(), tip = new Vector3(), along = new Vector3();
  const hand = new Vector3(), corner = new Vector3(), held = new Vector3(), lit = new Vector3();
  const poles = [new Vector3(-.8, -1, -.3), new Vector3(.8, -1, -.3)];
  const base = camera.position.clone();

  // Top-centre, width and tilt of the sheet at t: taut in the hands, then
  // flown to FRONT.
  let width = 1.85, tilt = 0;
  function sheetAt(t, target) {
    const snap = back(range(t, 2.3, PLAN_LANDS), 2.2);
    width = mix(1.45, 1.85, snap);
    held.set(0, 2.62 + Math.sin(t * 8) * .03 * range(t, 2.6, 2.8) - .08 * pulse(t, 3.02, 3.3), .95 - .15 * pulse(t, 3.02, 3.3));
    tilt = -.18;
    const lift = 1 - (1 - range(t, FLIGHT[0], FLIGHT[1])) ** 3;
    if (lift > 0) {
      lit.copy(FRONT);
      lit.y += FRONT_WIDTH * ASPECT / 2;
      target.lerpVectors(held, lit, lift);
      target.y += Math.sin(lift * Math.PI) * .3;
      width = mix(width, FRONT_WIDTH, lift);
      tilt = mix(tilt, 0, lift);
    } else target.copy(held);
    return target;
  }

  function pose(t) {
    sample(PLAN_KEYS, t, p);
    const whir = pulse(t, 1.25, 1.85);
    p.px += Math.sin(t * 61) * .025 * whir;
    p.side += Math.sin(t * 47) * .03 * whir;
    p.nod += Math.sin(t * Math.PI * 4) * .05 * (1 - range(t, .9, 1.1) + range(t, 2.65, 2.75) * (1 - range(t, 3.0, 3.1)));
    const sway = wobble(t, 1.2, 14, 5) * .2 + wobble(t, 1.98, 12, 4) * .5 + wobble(t, PLAN_LANDS, 13, 4) * .35 + Math.sin(t * 40) * .08 * whir;
    bot.apply(p, t, sway);
    sheetAt(t, top);
    const grab = smooth(range(t, 2.2, 2.4)) * (1 - smooth(range(t, RELEASE, RELEASE + .1)));
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      hand.set(i ? p.lhx : p.rhx, i ? p.lhy : p.rhy, i ? p.lhz : p.rhz);
      hand.x += side * Math.sin(t * 30 + i) * .08 * whir;
      corner.copy(top);
      corner.x += side * (width / 2 + .02);
      corner.z -= .08;
      hand.lerp(corner, grab);
      bot.reach(i, hand, poles[i]);
    }
  }

  function render(t) {
    pose(t);
    set.update(t, pulse(t, PLAN_LANDS - .05, 3.0));
    bot.visor(row(t, PLAN_FACE), t);
    bot.reels(t * 2 + 26 * range(t, 1.2, 2.3) ** 2);
    sheetAt(t, top);

    const flat = smooth(range(t, 2.2, 2.46));
    const extend = out(range(t, 1.9, 2.3));
    ribbon.visible = t > 1.9 && flat < 1;
    if (ribbon.visible) {
      bot.deck(deck);
      high.set(Math.sin(t * 5) * .3, 4.5, .9);
      tip.lerpVectors(deck, high, extend);
      const height = width * ASPECT;
      const ripple = (1 - flat) * extend;
      for (let j = 0; j <= RIBBON; j++) {
        const s = j / RIBBON;
        along.lerpVectors(tip, deck, s);
        const wave = Math.sin((1 - s) * 10 - t * 16) * Math.sin(s * Math.PI);
        along.x += wave * .35 * ripple;
        along.z += Math.cos((1 - s) * 8 - t * 13) * .2 * ripple * Math.sin(s * Math.PI);
        for (let c = 0; c < 2; c++) {
          const side = c ? .5 : -.5;
          const i = j * 2 + c;
          const twist = Math.sin(s * 6 - t * 10) * ripple;
          positions.setXYZ(i,
            mix(along.x + side * .3 * Math.cos(twist), top.x + side * width, flat),
            mix(along.y, top.y - s * height * Math.cos(tilt), flat),
            mix(along.z + side * .3 * Math.sin(twist), top.z + s * height * Math.sin(-tilt), flat));
        }
      }
      positions.needsUpdate = true;
      ribbonGeometry.computeVertexNormals();
    }

    sheet.visible = flat >= 1;
    sheet.position.copy(top);
    sheet.rotation.set(tilt, 0, wobble(t, PLAN_LANDS, 11, 4) * .05 + Math.sin(t * 13) * .03 * pulse(t, RELEASE, FLIGHT[1]));
    sheet.scale.set(width, width * ASPECT, 1);
    const on = range(t, PLAN_LANDS - .04, PLAN_LANDS);
    sheet.material.color.setScalar(mix(.42, 1, on) + pulse(t, PLAN_LANDS, 2.75) * .25);
    aura.visible = sheet.visible;
    aura.position.copy(top);
    aura.position.y -= width * ASPECT / 2;
    aura.position.z -= .05;
    aura.rotation.x = tilt;
    aura.scale.set(width * (1.5 + pulse(t, PLAN_LANDS, 2.9) * .8), width * ASPECT * (1.6 + pulse(t, PLAN_LANDS, 2.9) * .8), 1);
    aura.material.opacity = on * (.45 + pulse(t, PLAN_LANDS, 2.9) * .55) * (1 - range(t, 3.6, 3.9));

    lit.copy(top);
    lit.y -= .2;
    sparks.burst(t, PLAN_LANDS - .02, lit, 1, 1);
    glow.intensity = 10 + pulse(t, PLAN_LANDS - .05, 3.1) * 16 + pulse(t, 1.3, 1.9) * 6;
    camShake(camera, base, t, pulse(t, PLAN_LANDS, 2.8) * .03 + pulse(t, 1.95, 2.15) * .03);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => { set.dispose(); dispose(textures); } };
}

// All settled: an arcade stage clear. Beats: rise through the grid and land
// (0.15-1.06), coil (1.2-1.4), star-jump as the neon shells burst (1.45),
// land (1.95), point up and across the floor on every beat (2.1-3.9), then
// drop the shades and fire finger guns.
const DISCO = 2.1;
const C = {
  coil: pose({ drop: -.44, squash: .2, lean: .2, nod: .2, ra: -.3, ro: .5, re: 1.3, la: -.3, lo: .5, le: 1.3, rfx: -.1, lfx: .1 }),
  star: pose({ lift: .95, squash: -.16, nod: -.3, ra: -.3, ro: 2.5, re: .1, rg: 1, la: -.3, lo: 2.5, le: .1, lg: 1, rfx: -.3, lfx: .3, rfy: .15, lfy: .15 }),
  up: pose({ drop: -.12, side: .1, twist: .25, turn: -.35, nod: -.15, ra: -2.8, ro: .45, re: .1, rg: 1, la: -.3, lo: .75, le: 1.6, lw: .4, rfx: -.14, lfx: .12 }),
  down: pose({ drop: -.24, squash: .06, side: -.1, twist: -.35, turn: .35, nod: .18, ra: -.95, ro: -.6, re: .2, rg: 1, la: -.3, lo: .75, le: 1.6, lw: .4, rfx: -.1, lfx: .16 }),
};
const CLEAR_KEYS = [
  [.15, Y.burst], [.78, Y.apex, 'o'], [.95, Y.touch, 'i'], [1.06, Y.land, 'o'], [1.2, Y.cool, 'b'], [1.4, C.coil],
  [1.62, C.star, 'o'], [1.95, Y.land, 'i'], [DISCO + .08, C.up, 'b'], [2.4, C.up], [2.5, C.down, 'b'], [2.7, C.down],
  [2.8, C.up, 'b'], [3, C.up], [3.1, C.down, 'b'], [3.3, C.down], [3.4, C.up, 'b'], [3.6, C.up], [3.7, C.down, 'b'],
  [3.9, C.down], [4.08, Y.shades, 'b'], [4.3, Y.guns, 'b'],
];
const CLEAR_FACE = [[0, ROW.wow], [1.04, ROW.blink], [1.14, ROW.fierce], [CLEAR_LANDS, ROW.wow], [1.95, ROW.happy], [4.08, ROW.marquee]];

function createClear(container) {
  const stage = createStage(container);
  const { canvas, scene, camera, glow, renderer, dispose, warm } = stage;
  const set = createSet(stage, -6.8);
  const { textures, glowTexture } = set;
  const bot = createBot(set);
  scene.add(bot.root);
  const blob = shadowBlob(scene);
  const pad = new Mesh(new PlaneGeometry(1, 1), additive(PINK, 1, glowTexture));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = .02;
  scene.add(pad);
  const sparks = createSparks(scene);
  const fireworks = createFireworks(scene, camera, { colors: [PINK, CYAN, YELLOW, 0xb26bff], sparks: 32 });

  const p = pose({}), v = new Vector3(), chest = new Vector3();
  const base = camera.position.clone();
  function render(t) {
    sample(CLEAR_KEYS, t, p);
    // The hips keep the beat between the points.
    const groove = range(t, DISCO, DISCO + .2) * (1 - range(t, 3.95, 4.1));
    p.drop -= Math.abs(Math.sin((t - DISCO) * Math.PI / .3)) * .07 * groove;
    bot.apply(p, t, wobble(t, 1.06, 14, 4) + wobble(t, 1.95, 14, 4));
    const flash = fireworks.flash(t);
    set.update(t, flash * .8 + pulse(t, .9, 1.2) * .6);
    bot.visor(row(t, CLEAR_FACE), t);
    bot.reels(t * 6);
    fireworks.update(t);
    if (t > CLEAR_LANDS) sparks.burst(t, CLEAR_LANDS, bot.deck(chest), 1.2, 1);
    else sparks.burst(t, .62, pad.position, .9, 1);
    const rise = bot.root.position.y;
    bot.root.getWorldPosition(v);
    blob.position.set(v.x, .012, v.z + .1);
    blob.material.opacity = .4 * range(rise, -.6, 0) * (1 - clamp(rise) * .5);
    pad.scale.setScalar(3 * pulse(t, .1, 1.1) + 2.4 * pulse(t, CLEAR_LANDS, 2.1));
    pad.material.opacity = .8;
    glow.intensity = 9 + Math.sin(t * 3) * 3 + flash * 10;
    camShake(camera, base, t, pulse(t, 1.02, 1.2) * .03 + pulse(t, 1.95, 2.12) * .04);
    renderer.render(scene, camera);
  }
  return { ready: warm(), canvas, render, dispose: () => { set.dispose(); dispose(textures); } };
}

export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  look: {
    words: { yeet: 'TOTALLY RAD', pr: 'PR ONLINE', plan: 'PLAN.EXE', clear: 'STAGE CLEAR' },
    background: 'radial-gradient(ellipse at 50% 62%,light-dark(#ffe3f3,#3a0f5c) 0%,light-dark(#f4dcf6,#1a0b3d) 48%,light-dark(#dccbf7,#0b0420) 100%)',
    ink: 'light-dark(#4a0e78,#fdf4ff)',
    glow: '0 4px 0 light-dark(#ff9fd3,#ff3fa4),0 0 24px light-dark(#ff3fa470,#ff3fa4),0 0 70px light-dark(#2de2e650,#2de2e6a0)',
    flash: 'light-dark(#c0129a,#ffd6f4)',
    flashGlow: 'light-dark(#ff3fa490,#ff3fa4b0)',
  },
  clear: createClear,
  yeet: createYeet,
  pr: createPr,
  plan: createPlan,
};
