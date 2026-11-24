import * as THREE from 'three';

const HIP_HEIGHT = 1.26;
const THIGH = .56;
const SHIN = .5;
const ANKLE = .14;
const SIDES = [-1, 1];

let surfaces;

// A seeded generator keeps every orc's skin identical, so a scene's frames
// stay a pure function of time.
function random(seed) {
  return () => {
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function fractal(size, seed, octaves) {
  const next = random(seed);
  const out = new Float32Array(size * size);
  let amplitude = 1, total = 0;
  for (const cells of octaves) {
    const grid = Array.from({ length: cells * cells }, next);
    for (let y = 0; y < size; y += 1) {
      const gy = y / size * cells, iy = Math.floor(gy), fy = gy - iy, sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x += 1) {
        const gx = x / size * cells, ix = Math.floor(gx), fx = gx - ix, sx = fx * fx * (3 - 2 * fx);
        const at = (i, j) => grid[(j % cells) * cells + (i % cells)];
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
        const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
        out[y * size + x] += (top + (bottom - top) * sy) * amplitude;
      }
    }
    total += amplitude;
    amplitude *= .5;
  }
  return out.map(value => value / total);
}

function paint(size, pixel) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const [r, g, b] = pixel(i);
    image.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function speckle(canvas, seed, count, color, radius) {
  const ctx = canvas.getContext('2d');
  const next = random(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    ctx.beginPath();
    ctx.arc(next() * canvas.width, next() * canvas.height, radius * (.4 + next()), 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function scratches(canvas, seed, count, color) {
  const ctx = canvas.getContext('2d');
  const next = random(seed);
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i += 1) {
    const x = next() * canvas.width, y = next() * canvas.height, angle = next() * Math.PI, length = 6 + next() * 26;
    ctx.lineWidth = .6 + next() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(angle) * length * .5 + next() * 4, y + Math.sin(angle) * length * .5, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }
  return canvas;
}

// Canvases are built once per page and shared; each orc wraps them in its own
// textures because the stage disposes textures with its scene.
function surfaceCanvases() {
  if (surfaces) return surfaces;
  const size = 256;
  const blotch = fractal(size, 11, [4, 8, 16]);
  const pore = fractal(size, 23, [32, 64]);
  const grain = fractal(size, 41, [8, 32, 64]);
  const wear = fractal(size, 57, [4, 16]);
  surfaces = {
    skin: speckle(paint(size, i => {
      const tone = 214 + blotch[i] * 52 - pore[i] * 22;
      return [tone + (blotch[i] - .5) * 30, tone + 8, tone - 14 - (blotch[i] - .5) * 18];
    }), 7, 180, 'rgba(70,82,48,.28)', 2.2),
    skinBump: speckle(paint(size, i => {
      const v = 150 + pore[i] * 80 + blotch[i] * 30;
      return [v, v, v];
    }), 9, 600, 'rgba(40,40,40,.6)', 1),
    leather: scratches(paint(size, i => {
      const v = 180 + grain[i] * 70 - wear[i] * 34;
      return [v + 8, v, v - 10];
    }), 13, 70, 'rgba(255,235,210,.22)'),
    leatherBump: scratches(paint(size, i => {
      const v = 120 + grain[i] * 110;
      return [v, v, v];
    }), 13, 70, 'rgba(30,30,30,.7)'),
    eye: paintEye(512, false),
    eyeGlow: paintEye(256, true),
  };
  return surfaces;
}

// A SphereGeometry faces +z at u = .25, v = .5, and on a 2:1 canvas a circle
// drawn there stays round on the ball. The glow copy is black except the iris,
// so only the iris lights up as an emissive map.
function paintEye(width, glow) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = width / 2;
  const ctx = canvas.getContext('2d');
  const s = width / 512, x = 128 * s, y = 128 * s;
  const ring = (radius, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, radius * s, 0, Math.PI * 2);
    ctx.fill();
  };
  if (glow) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const sclera = ctx.createRadialGradient(x, y, 30 * s, x, y, 190 * s);
    sclera.addColorStop(0, '#f1e6c6');
    sclera.addColorStop(.5, '#ddc9a0');
    sclera.addColorStop(1, '#8e6f5c');
    ctx.fillStyle = sclera;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const next = random(77);
    ctx.strokeStyle = 'rgba(168,58,44,.38)';
    for (let i = 0; i < 16; i += 1) {
      const angle = next() * Math.PI * 2, from = 120 + next() * 60, to = 58 + next() * 22;
      ctx.lineWidth = (.6 + next()) * s;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * from * s, y + Math.sin(angle) * from * s);
      ctx.quadraticCurveTo(
        x + Math.cos(angle + (next() - .5) * .5) * (from + to) / 2 * s, y + Math.sin(angle + (next() - .5) * .5) * (from + to) / 2 * s,
        x + Math.cos(angle + (next() - .5) * .3) * to * s, y + Math.sin(angle + (next() - .5) * .3) * to * s);
      ctx.stroke();
    }
  }
  const iris = ctx.createRadialGradient(x, y, 15 * s, x, y, 50 * s);
  for (const [at, color] of glow
    ? [[0, '#ffb43c'], [.7, '#c96a10'], [1, '#2a1000']]
    : [[0, '#f2c65a'], [.45, '#d89428'], [.8, '#94520f'], [1, '#2e1505']]) iris.addColorStop(at, color);
  ring(50, iris);
  if (!glow) {
    const fibre = random(91);
    for (let i = 0; i < 90; i += 1) {
      const angle = fibre() * Math.PI * 2, from = 18 + fibre() * 8, to = 32 + fibre() * 15;
      ctx.lineWidth = (.6 + fibre()) * s;
      ctx.strokeStyle = fibre() < .5 ? 'rgba(255,226,150,.22)' : 'rgba(80,34,4,.25)';
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * from * s, y + Math.sin(angle) * from * s);
      ctx.lineTo(x + Math.cos(angle + (fibre() - .5) * .12) * to * s, y + Math.sin(angle + (fibre() - .5) * .12) * to * s);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(24,10,2,.85)';
    ctx.lineWidth = 4.5 * s;
    ctx.beginPath();
    ctx.arc(x, y, 49 * s, 0, Math.PI * 2);
    ctx.stroke();
  }
  ring(17, glow ? '#000' : '#0b0907');
  return canvas;
}

function texture(canvas, repeat, color = false) {
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function lumpy(seed, amount) {
  const shape = new THREE.SphereGeometry(1, 22, 16);
  const position = shape.attributes.position;
  const next = random(seed);
  const phase = Array.from({ length: 6 }, () => next() * Math.PI * 2);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const swell = 1 + amount * (
      Math.sin(x * 2.6 + phase[0]) * Math.sin(y * 2.2 + phase[1]) * Math.sin(z * 2.9 + phase[2])
      + .45 * Math.sin(x * 5.1 + phase[3]) * Math.sin(y * 4.7 + phase[4]) * Math.sin(z * 5.3 + phase[5]));
    position.setXYZ(i, x * swell, y * swell, z * swell);
  }
  shape.computeVertexNormals();
  // Seam and pole vertices are duplicated, so average their normals or the
  // seam shows as a crease.
  const normal = shape.attributes.normal;
  const shared = new Map();
  for (let i = 0; i < position.count; i += 1) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v * 1e4)).join();
    if (!shared.has(key)) shared.set(key, []);
    shared.get(key).push(i);
  }
  const sum = new THREE.Vector3();
  for (const indices of shared.values()) {
    if (indices.length < 2) continue;
    sum.set(0, 0, 0);
    indices.forEach(i => sum.add(new THREE.Vector3().fromBufferAttribute(normal, i)));
    sum.normalize();
    indices.forEach(i => normal.setXYZ(i, sum.x, sum.y, sum.z));
  }
  return shape;
}

export function createOrc() {
  const root = new THREE.Group();
  root.name = 'orc';
  const canvases = surfaceCanvases();
  const maps = {
    skin: texture(canvases.skin, 2, true),
    skinBump: texture(canvases.skinBump, 2),
    leather: texture(canvases.leather, 2, true),
    leatherBump: texture(canvases.leatherBump, 2),
    eye: texture(canvases.eye, 1, true),
    eyeGlow: texture(canvases.eyeGlow, 1, true),
  };

  const skinLike = color => new THREE.MeshStandardMaterial({
    color, map: maps.skin, bumpMap: maps.skinBump, bumpScale: .55, roughness: .62,
  });
  const leatherLike = color => new THREE.MeshStandardMaterial({
    color, map: maps.leather, bumpMap: maps.leatherBump, bumpScale: .5, roughness: .82,
  });
  const metal = (color, roughness, metalness = .85) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const materials = {
    skin: skinLike(0x5c7a3c),
    skinLight: skinLike(0x6e8a48),
    skinDark: skinLike(0x405a2c),
    ear: skinLike(0x546a34),
    lip: skinLike(0x3f4f2a),
    crease: new THREE.MeshStandardMaterial({ color: 0x24301d, roughness: .9 }),
    leather: leatherLike(0x3b2a22),
    leatherEdge: leatherLike(0x6a4a35),
    cloth: new THREE.MeshStandardMaterial({ color: 0x584631, map: maps.leather, roughness: .95 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x1f1a17, roughness: .9 }),
    steel: metal(0x6c7c84, .38),
    steelDark: metal(0x37474f, .5, .75),
    steelLight: metal(0xb3c0c3, .3),
    gold: metal(0xe0aa45, .32, .9),
    ivory: new THREE.MeshStandardMaterial({ color: 0xeedfb5, roughness: .36 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe5d8b8, roughness: .7 }),
    claw: new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: .45 }),
    eye: new THREE.MeshStandardMaterial({
      map: maps.eye, emissiveMap: maps.eyeGlow, emissive: 0xffffff, emissiveIntensity: .3, roughness: .08,
    }),
    lash: new THREE.MeshStandardMaterial({ color: 0x1b2214, roughness: .8 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xfff6dc }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x3b1514, roughness: .75 }),
    tongue: new THREE.MeshStandardMaterial({ color: 0xa04a4a, roughness: .35 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x1d2425, roughness: .88 }),
  };
  const geometry = {
    lumps: [lumpy(3, .045), lumpy(5, .06), lumpy(8, .035), lumpy(13, .07), lumpy(21, .05)],
    sphere: new THREE.SphereGeometry(1, 18, 12),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 20),
    box: new THREE.BoxGeometry(1, 1, 1),
    spike: new THREE.ConeGeometry(1, 1, 9),
    hair: new THREE.ConeGeometry(1, 1, 6),
    eyeball: new THREE.SphereGeometry(1, 28, 18),
    lidTop: new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    lidBottom: new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    // The front half of a lid's edge, where the lashes sit.
    lidEdge: new THREE.TorusGeometry(1, .07, 6, 24, Math.PI).rotateX(Math.PI / 2),
    hoop: new THREE.TorusGeometry(.145, .035, 8, 24),
    cord: new THREE.TorusGeometry(1, .018, 6, 40, Math.PI * 1.15),
    lip: new THREE.TorusGeometry(1, .14, 10, 28, 2).rotateZ(Math.PI / 2 - 1).rotateX(Math.PI / 2),
  };

  function group(parent, name, x = 0, y = 0, z = 0) {
    const object = new THREE.Group();
    object.name = name;
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }

  function mesh(parent, name, shape, surface, position, scale, rotation) {
    const object = new THREE.Mesh(shape, surface);
    object.name = name;
    object.position.set(...position);
    if (scale) object.scale.set(...scale);
    if (rotation) object.rotation.set(...rotation);
    // Small parts add a shadow-pass draw call each and no visible shadow.
    object.castShadow = !scale || Math.max(...scale) > .14;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }

  let lump = 0;
  function round(parent, name, surface, position, scale, rotation) {
    lump += 1;
    return mesh(parent, name, geometry.lumps[lump % geometry.lumps.length], surface, position, scale, rotation);
  }

  function joint(parent, name, surface, position, scale, rotation) {
    return mesh(parent, name, geometry.sphere, surface, position, scale, rotation);
  }

  function bar(parent, name, surface, start, end, radius) {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    const object = mesh(
      parent, name, geometry.cylinder, surface,
      from.add(to).multiplyScalar(.5).toArray(),
      [radius, direction.length(), radius],
    );
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return object;
  }

  function spike(parent, name, position, direction, length, radius, surface) {
    const axis = new THREE.Vector3(...direction).normalize();
    const center = new THREE.Vector3(...position).addScaledVector(axis, length / 2);
    const object = mesh(parent, name, geometry.spike, surface, center.toArray(), [radius, length, radius]);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    return object;
  }

  function horn(parent, name, points, radius, surface) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
    const lengthSegments = 12;
    const ringSegments = 10;
    const frames = curve.computeFrenetFrames(lengthSegments, false);
    const positions = [];
    const indices = [];
    for (let ring = 0; ring <= lengthSegments; ring += 1) {
      const t = ring / lengthSegments;
      const center = curve.getPointAt(t);
      const size = radius * Math.pow(1 - t, .78) + .002;
      for (let point = 0; point < ringSegments; point += 1) {
        const angle = point / ringSegments * Math.PI * 2;
        const vertex = center.clone()
          .addScaledVector(frames.normals[ring], Math.cos(angle) * size)
          .addScaledVector(frames.binormals[ring], Math.sin(angle) * size);
        positions.push(vertex.x, vertex.y, vertex.z);
        if (ring < lengthSegments) {
          const current = ring * ringSegments + point;
          const next = ring * ringSegments + (point + 1) % ringSegments;
          indices.push(current, next, next + ringSegments, current, next + ringSegments, current + ringSegments);
        }
      }
    }
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    shape.setIndex(indices);
    shape.computeVertexNormals();
    return mesh(parent, name, shape, surface, [0, 0, 0]);
  }

  const hips = group(root, 'hips', 0, HIP_HEIGHT, 0);
  const spine = group(hips, 'spine', 0, .14, 0);
  const chest = group(spine, 'chest', 0, .56, -.02);
  const neck = group(chest, 'neck', 0, .62, .1);
  const head = group(neck, 'head', 0, .18, .16);
  const skull = group(head, 'skull', 0, .22, .02);
  skull.scale.setScalar(.8);
  const jaw = group(skull, 'jaw', 0, .05, .05);

  const breathers = [];

  round(hips, 'breeches', materials.leather, [0, -.05, 0], [.74, .42, .5]);
  mesh(hips, 'belt', geometry.cylinder, materials.leatherEdge, [0, .12, .01], [.8, .22, .58]);
  for (const side of SIDES) {
    joint(hips, `belt-rivet-${side}`, materials.gold, [side * .5, .13, .45], [.045, .045, .025]);
  }
  const buckle = group(hips, 'skull-buckle', 0, .12, .6);
  joint(buckle, 'buckle-skull', materials.bone, [0, .02, 0], [.15, .13, .08]);
  joint(buckle, 'buckle-jaw', materials.bone, [0, -.08, -.005], [.09, .06, .06]);
  for (const side of SIDES) joint(buckle, `buckle-eye-${side}`, materials.crease, [side * .055, .03, .065], [.035, .035, .02]);
  const pouch = group(hips, 'belt-pouch', .6, .02, .2);
  pouch.rotation.y = .5;
  round(pouch, 'pouch-bag', materials.leatherEdge, [0, -.1, 0], [.15, .17, .1]);
  round(pouch, 'pouch-flap', materials.leather, [0, -.01, .02], [.16, .07, .11]);
  const flaps = [1, -1].map(z => {
    const flap = group(hips, z > 0 ? 'front-loincloth' : 'back-loincloth', 0, .03, z * .52);
    mesh(flap, `${flap.name}-cloth`, geometry.box, materials.cloth, [0, -.3, z * .02], [.44, .58, .025], [z * .08, 0, 0]);
    mesh(flap, `${flap.name}-hem`, geometry.box, materials.leatherEdge, [0, -.58, z * .045], [.46, .05, .035], [z * .08, 0, 0]);
    return flap;
  });

  const legs = [], knees = [], feet = [], restAnkles = [];
  for (const side of SIDES) {
    const label = side < 0 ? 'left' : 'right';
    const leg = group(hips, `${label}-leg`, side * .4, -.1, 0);
    round(leg, `${label}-thigh`, materials.leather, [0, -.26, .02], [.33, .38, .35]);
    round(leg, `${label}-inner-thigh`, materials.leather, [-side * .05, -.1, 0], [.3, .28, .33]);
    const knee = group(leg, `${label}-knee`, 0, -THIGH, 0);
    joint(knee, `${label}-kneecap`, materials.skinLight, [0, .01, .12], [.17, .16, .13]);
    round(knee, `${label}-shin`, materials.skin, [0, -.1, .03], [.22, .22, .21]);
    round(knee, `${label}-calf`, materials.skin, [0, -.1, -.08], [.23, .25, .22]);
    round(knee, `${label}-boot-shaft`, materials.leather, [0, -.36, 0], [.26, .2, .26]);
    mesh(knee, `${label}-boot-cuff`, geometry.cylinder, materials.leatherEdge, [0, -.22, 0], [.28, .08, .28]);
    const foot = group(knee, `${label}-foot`, 0, -SHIN, 0);
    round(foot, `${label}-boot-heel`, materials.leather, [0, -.02, -.02], [.25, .16, .27]);
    round(foot, `${label}-boot-toe`, materials.leather, [0, -.06, .2], [.29, .12, .34]);
    joint(foot, `${label}-toe-cap`, materials.steel, [0, -.055, .4], [.23, .1, .16]);
    joint(foot, `${label}-sole`, materials.sole, [0, -.115, .12], [.31, .035, .44]);
    mesh(foot, `${label}-boot-strap`, geometry.box, materials.leatherEdge, [0, .02, .15], [.4, .07, .06]);
    mesh(foot, `${label}-boot-buckle`, geometry.box, materials.gold, [side * .14, .02, .19], [.08, .09, .025]);
    legs.push(leg);
    knees.push(knee);
    feet.push(foot);
    restAnkles.push(new THREE.Vector3(side * .42, ANKLE, 0));
  }

  breathers.push(round(spine, 'belly', materials.skin, [0, .22, .1], [.74, .5, .52]));
  round(spine, 'lower-back', materials.skin, [0, .3, -.12], [.7, .5, .45]);
  for (const side of SIDES) {
    round(spine, `${side < 0 ? 'left' : 'right'}-oblique`, materials.skin, [side * .5, .2, .02], [.27, .32, .35]);
    for (let row = 0; row < 3; row += 1) {
      round(spine, `ab-${side}-${row}`, materials.skinLight, [side * .14, .1 + row * .15, .55], [.13, .075, .06]);
    }
  }
  breathers.push(round(chest, 'ribcage', materials.skin, [0, .28, -.04], [.95, .66, .6]));
  for (const side of SIDES) {
    const label = side < 0 ? 'left' : 'right';
    breathers.push(round(chest, `${label}-pectoral`, materials.skinLight, [side * .36, .36, .32], [.44, .3, .26]));
    round(chest, `${label}-lat`, materials.skin, [side * .62, .16, -.1], [.36, .46, .4]);
  }
  round(chest, 'trapezius', materials.skin, [0, .62, -.16], [.86, .32, .4]);
  round(chest, 'neck-base', materials.skinDark, [0, .66, .02], [.42, .3, .38]);
  mesh(chest, 'diagonal-harness', geometry.box, materials.leather, [.12, .32, .58], [.18, 1.28, .08], [-.12, 0, -.6]);
  mesh(chest, 'harness-edge', geometry.box, materials.leatherEdge, [.2, .28, .625], [.025, 1.26, .02], [-.12, 0, -.6]);
  joint(chest, 'harness-top-rivet', materials.gold, [.42, .64, .58], [.05, .05, .025]);
  joint(chest, 'harness-bottom-rivet', materials.gold, [-.2, -.02, .62], [.05, .05, .025]);
  const necklace = group(chest, 'tooth-necklace', 0, .62, .1);
  necklace.rotation.x = 1.25;
  mesh(necklace, 'necklace-cord', geometry.cord, materials.leatherEdge, [0, 0, 0], [.46, .46, .46], [0, 0, -Math.PI * .07]);
  for (let i = 0; i < 5; i += 1) {
    const angle = Math.PI * (.3 + i * .1);
    spike(necklace, `necklace-fang-${i}`, [Math.cos(angle) * .46, Math.sin(angle) * .46, 0], [0, 0, 1], .13, .03, materials.bone);
  }
  mesh(neck, 'neck', geometry.lumps[2], materials.skin, [0, .08, .02], [.38, .3, .36]);

  // Head, built in the head's own units and scaled down as one piece.
  round(skull, 'cranium', materials.skin, [0, .32, -.06], [.74, .66, .6]);
  round(skull, 'forehead', materials.skin, [0, .5, .28], [.58, .22, .3]);
  round(skull, 'muzzle', materials.skin, [0, .08, .36], [.6, .26, .45]);
  joint(skull, 'mouth-roof', materials.mouth, [0, -.1, .42], [.4, .14, .28]);
  const upperLip = mesh(skull, 'upper-lip', geometry.lip, materials.lip, [0, -.09, .4], [.38, .5, .38]);
  for (let i = 0; i < 6; i += 1) {
    joint(skull, `upper-tooth-${i}`, materials.ivory, [(i - 2.5) * .075, -.16, .75 - Math.abs(i - 2.5) * .025], [.034, .052, .03]);
  }
  round(skull, 'nose-bridge', materials.skinLight, [0, .275, .6], [.16, .25, .16]);
  round(skull, 'broad-nose', materials.skin, [0, .12, .72], [.26, .165, .16]);
  const nostrils = SIDES.map(side => joint(skull, `nostril-${side}`, materials.crease, [side * .114, .06, .85], [.06, .04, .018]));
  bar(skull, 'cheek-scar', materials.skinDark, [.565, .19, .648], [.44, -.01, .698], .018);
  bar(skull, 'cheek-scar-stitch', materials.skinLight, [.48, .072, .703], [.551, .108, .68], .013);

  round(jaw, 'jaw', materials.skin, [0, -.3, .2], [.64, .22, .5]);
  round(jaw, 'jaw-hinge', materials.skin, [0, -.12, .05], [.62, .22, .36]);
  round(jaw, 'chin', materials.skinLight, [0, -.4, .42], [.46, .17, .3]);
  joint(jaw, 'mouth-floor', materials.mouth, [0, -.2, .42], [.36, .1, .3]);
  joint(jaw, 'tongue', materials.tongue, [0, -.17, .5], [.24, .06, .2]);
  const lowerLip = mesh(jaw, 'lower-lip', geometry.lip, materials.lip, [0, -.25, .38], [.36, .5, .37]);
  for (let i = 0; i < 4; i += 1) {
    joint(jaw, `lower-tooth-${i}`, materials.ivory, [(i - 1.5) * .075, -.2, .72 - Math.abs(i - 1.5) * .02], [.03, .045, .028]);
  }
  for (const side of SIDES) {
    horn(jaw, side < 0 ? 'left-tusk' : 'right-tusk', [
      [side * .43, -.295, .68], [side * .49, -.14, .84], [side * .49, .07, .89], [side * .43, .265, .85],
    ], .12, materials.ivory);
  }

  const earShape = new THREE.Shape();
  earShape.moveTo(0, -.16);
  earShape.lineTo(.38, -.08);
  earShape.quadraticCurveTo(.6, .1, .74, .46);
  earShape.quadraticCurveTo(.45, .3, .29, .23);
  earShape.lineTo(0, .12);
  earShape.closePath();
  const earGeometry = new THREE.ExtrudeGeometry(earShape, {
    depth: .09, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .055, bevelThickness: .055, curveSegments: 6,
  });

  const ears = [], eyes = [], brows = [], corners = [], cheeks = [];
  for (const side of SIDES) {
    const label = side < 0 ? 'left' : 'right';
    const ear = group(skull, `${label}-ear`, side * .6, .28, -.12);
    ear.scale.x = side;
    mesh(ear, `${label}-ear-shell`, earGeometry, materials.skin, [0, 0, 0]);
    mesh(ear, `${label}-ear-fold`, earGeometry, materials.ear, [.065, .015, .13], [.67, .61, .12]);
    ears.push(ear);

    cheeks.push(round(skull, `${label}-cheekbone`, materials.skinLight, [side * .5, .08, .46], [.26, .22, .22]));
    corners.push(joint(skull, `${label}-mouth-corner`, materials.lip, [side * .34, -.13, .62], [.06, .055, .055]));
    round(skull, `${label}-eye-socket`, materials.skinDark, [side * .29, .35, .5], [.25, .17, .13]);
    // A round eyeball set back under the brow; gaze turns the ball, and the
    // lids give the opening its shape.
    const eye = group(skull, `${label}-eye`, side * .28, .335, .55);
    eye.scale.setScalar(.155);
    const ball = mesh(eye, `${label}-eyeball`, geometry.eyeball, materials.eye, [0, 0, 0]);
    mesh(eye, `${label}-catchlight`, geometry.sphere, materials.glint, [-.3, .34, .93], [.09, .09, .04]);
    const slant = group(eye, `${label}-lid-slant`);
    const lid = group(slant, `${label}-upper-lid`);
    mesh(lid, `${label}-upper-lid-skin`, geometry.lidTop, materials.skin, [0, 0, 0], [1.1, 1.1, 1.1]);
    mesh(lid, `${label}-upper-lash-line`, geometry.lidEdge, materials.lash, [0, 0, 0], [1.1, 1.1, 1.1]);
    const lower = group(slant, `${label}-lower-lid`);
    mesh(lower, `${label}-lower-lid-skin`, geometry.lidBottom, materials.skin, [0, 0, 0], [1.07, 1.07, 1.07]);
    mesh(lower, `${label}-lower-lid-edge`, geometry.lidEdge, materials.skinDark, [0, 0, 0], [1.07, .7, 1.07]);
    eyes.push({ side, ball, slant, lid, lower });
    const brow = group(skull, `${label}-brow`, side * .29, .47, .6);
    round(brow, `${label}-brow-ridge`, materials.skin, [0, .025, -.05], [.3, .12, .14]);
    round(brow, `${label}-brow`, materials.skinDark, [0, 0, 0], [.29, .1, .14]);
    brows.push({ side, brow });
  }
  mesh(skull, 'ear-stud', geometry.sphere, materials.gold, [-.97, .32, .085], [.054, .054, .04]);
  const hoop = group(skull, 'ear-hoop', -.98, .3, .08);
  mesh(hoop, 'gold-ear-hoop', geometry.hoop, materials.gold, [0, -.13, 0], null, [0, -.2, 0]);

  const strands = [];
  for (let index = 0; index < 8; index += 1) {
    const z = -.46 + index * .135;
    const y = .86 + Math.sin(index / 7 * Math.PI) * .14;
    const strand = group(skull, `mohawk-${index}`, 0, y, z);
    strand.rotation.x = -.35 + index * .07;
    const height = .26 + Math.sin(index / 7 * Math.PI) * .2;
    mesh(strand, `mohawk-${index}-spike`, geometry.hair, materials.hair, [0, height / 2, 0], [.12, height, .15]);
    strands.push(strand);
  }

  // Arms: shoulder (rotation.z raises sideways, rotation.x swings forward),
  // elbow (negative rotation.x flexes), wrist. A hanging hand's palm faces
  // the body, so fingers curl about z and a held rod runs along z.
  const arms = [], elbows = [], hands = [], grips = [], fingers = [[], []];
  for (const side of SIDES) {
    const label = side < 0 ? 'left' : 'right';
    const arm = group(chest, `${label}-arm`, side * .98, .45, -.06);
    round(arm, `${label}-deltoid`, materials.skin, [side * .04, -.06, 0], [.4, .4, .4]);
    round(arm, `${label}-bicep`, materials.skin, [0, -.34, .06], [.3, .38, .3]);
    round(arm, `${label}-tricep`, materials.skin, [0, -.32, -.08], [.28, .36, .28]);
    round(arm, `${label}-bicep-highlight`, materials.skinLight, [side * .02, -.3, .2], [.18, .24, .12]);
    const elbow = group(arm, `${label}-elbow`, 0, -.64, 0);
    joint(elbow, `${label}-elbow-point`, materials.skinDark, [0, 0, -.06], [.22, .21, .22]);
    round(elbow, `${label}-forearm-upper`, materials.skin, [0, -.17, .03], [.3, .3, .29]);
    round(elbow, `${label}-forearm-lower`, materials.skin, [0, -.42, .02], [.22, .25, .21]);
    mesh(elbow, `${label}-leather-bracer`, geometry.cylinder, materials.leather, [0, -.42, .02], [.245, .3, .245]);
    mesh(elbow, `${label}-bracer-top-band`, geometry.cylinder, materials.leatherEdge, [0, -.28, .02], [.26, .05, .26]);
    mesh(elbow, `${label}-bracer-bottom-band`, geometry.cylinder, materials.leatherEdge, [0, -.56, .02], [.26, .05, .26]);
    for (const z of [-.1, 0, .1]) {
      joint(elbow, `${label}-bracer-rivet-${z}`, materials.steelLight, [side * .24, -.42, .02 + z], [.022, .03, .03]);
    }
    const hand = group(elbow, `${label}-hand`, 0, -.62, .02);
    round(hand, `${label}-palm`, materials.skin, [0, -.12, 0], [.12, .17, .2]);
    joint(hand, `${label}-knuckles`, materials.skinLight, [side * .01, -.25, 0], [.1, .06, .19]);
    for (let finger = 0; finger < 4; finger += 1) {
      const z = (finger - 1.5) * .09;
      const base = group(hand, `${label}-finger-${finger}`, 0, -.26, z);
      round(base, `${label}-finger-${finger}-proximal`, materials.skin, [0, -.07, 0], [.06, .09, .055]);
      const tip = group(base, `${label}-finger-${finger}-tip`, 0, -.15, 0);
      round(tip, `${label}-finger-${finger}-distal`, materials.skin, [0, -.06, 0], [.052, .075, .05]);
      spike(tip, `${label}-claw-${finger}`, [-side * .02, -.1, 0], [-side * .5, -1, 0], .07, .025, materials.claw);
      fingers[side < 0 ? 0 : 1].push({ base, tip });
    }
    const thumb = group(hand, `${label}-thumb`, -side * .05, -.08, .15);
    round(thumb, `${label}-thumb-base`, materials.skin, [0, -.08, .02], [.07, .11, .07]);
    spike(thumb, `${label}-thumb-claw`, [0, -.17, .04], [0, -1, .3], .06, .025, materials.claw);
    fingers[side < 0 ? 0 : 1].push({ base: thumb, thumb: true });
    grips.push(group(hand, `${label}-grip`, -side * .03, -.27, 0));
    arms.push(arm);
    elbows.push(elbow);
    hands.push(hand);
  }

  const pauldron = group(arms[1], 'spiked-pauldron', .06, .04, 0);
  round(pauldron, 'pauldron-rim', materials.steelDark, [0, -.06, 0], [.52, .2, .47]);
  round(pauldron, 'pauldron-dome', materials.steel, [0, .03, 0], [.5, .27, .44]);
  for (const [index, x, y, z, dx, dz, length] of [
    [0, 0, .26, 0, .1, 0, .4],
    [1, .28, .2, .07, .63, .1, .32],
    [2, -.25, .2, .05, -.48, .08, .29],
    [3, .03, .18, .29, .08, .64, .3],
    [4, .02, .19, -.27, .03, -.58, .29],
  ]) {
    spike(pauldron, `pauldron-spike-${index}`, [x, y, z], [dx, 1, dz], length, .085, materials.steelLight);
  }
  for (const x of [-.32, 0, .32]) {
    joint(pauldron, `pauldron-rivet-${x}`, materials.gold, [x, -.015, .37], [.044, .044, .025]);
  }
  const strap = group(arms[0], 'shoulder-strap', -.04, -.1, 0);
  mesh(strap, 'shoulder-strap-band', geometry.cylinder, materials.leatherEdge, [0, 0, 0], [.42, .08, .42], [0, 0, .25]);

  arms[0].rotation.z = -.2;
  arms[1].rotation.z = .2;
  elbows.forEach(elbow => { elbow.rotation.x = -.25; });

  const rest = [];
  root.traverse(object => {
    if (object.isGroup) rest.push([object, object.position.clone(), object.quaternion.clone(), object.scale.clone()]);
  });
  const breathRest = breathers.map(part => part.scale.clone());
  const cornerRest = corners.map(part => part.position.clone());
  const cheekRest = cheeks.map(part => part.position.clone());
  const footOffsets = [new THREE.Vector3(), new THREE.Vector3()];
  let autoBlink = 0;

  const scratch = {
    target: new THREE.Vector3(), hip: new THREE.Vector3(), forward: new THREE.Vector3(),
    axis: new THREE.Vector3(), thigh: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(),
    z: new THREE.Vector3(), basis: new THREE.Matrix4(), quaternion: new THREE.Quaternion(), rootQuaternion: new THREE.Quaternion(),
  };

  function grip(which, amount) {
    const indices = which === 'left' ? [0] : which === 'right' ? [1] : [0, 1];
    for (const index of indices) {
      const side = index === 0 ? -1 : 1;
      for (const finger of fingers[index]) {
        if (finger.thumb) {
          finger.base.rotation.set(-.2 - amount * .9, 0, side * amount * .5);
        } else {
          finger.base.rotation.z = -side * amount * 1.45;
          finger.tip.rotation.z = -side * amount * 1.6;
        }
      }
    }
  }

  const orc = {
    root,
    hips,
    spine,
    chest,
    torso: chest,
    neck,
    head,
    jaw,
    leftArm: arms[0],
    rightArm: arms[1],
    leftElbow: elbows[0],
    rightElbow: elbows[1],
    leftHand: hands[0],
    rightHand: hands[1],
    leftGrip: grips[0],
    rightGrip: grips[1],
    leftLeg: legs[0],
    rightLeg: legs[1],
    leftKnee: knees[0],
    rightKnee: knees[1],
    leftFoot: feet[0],
    rightFoot: feet[1],
    // Root-space ankle offsets from the resting stance; plantFeet steps to them.
    feet: { left: footOffsets[0], right: footOffsets[1] },

    reset() {
      for (const [object, position, quaternion, scale] of rest) {
        object.position.copy(position);
        object.quaternion.copy(quaternion);
        object.scale.copy(scale);
      }
      breathers.forEach((part, i) => part.scale.copy(breathRest[i]));
      footOffsets.forEach(offset => offset.set(0, 0, 0));
      grip('both', .35);
      autoBlink = 0;
      orc.face();
      return orc;
    },

    // Additive, so call it after posing the body.
    idle(t, amount = 1) {
      const breath = Math.sin(t * 2.3);
      breathers.forEach((part, i) => {
        part.scale.copy(breathRest[i]).multiply(scratch.x.set(1 + .012 * breath * amount, 1 + .01 * breath * amount, 1 + .025 * breath * amount));
      });
      chest.position.y += .012 * breath * amount;
      head.rotation.x += Math.sin(t * 1.1) * .02 * amount;
      head.rotation.z += Math.sin(t * .7 + 1) * .015 * amount;
      ears.forEach((ear, i) => {
        const flick = Math.max(0, Math.sin((t + i * 1.3) * 2.1)) ** 24;
        ear.rotation.z += (Math.sin(t * 3.1 + i) * .04 + flick * .35) * (i ? 1 : -1) * amount;
      });
      strands.forEach((strand, i) => { strand.rotation.x += Math.sin(t * 2.4 - i * .55) * .07 * amount; });
      hoop.rotation.z += Math.sin(t * 3.3) * .25 * amount;
      hoop.rotation.x += Math.sin(t * 2.1) * .15 * amount;
      flaps.forEach((flap, i) => { flap.rotation.x += Math.sin(t * 2.7 + i * 2) * .06 * amount * (i ? -1 : 1); });
      const phase = (t + .4) % 3.4;
      autoBlink = (phase < .18 ? Math.sin(phase / .18 * Math.PI) : 0) * amount;
      return orc;
    },

    // Expression, absolute each call. jaw 0..1 opens the mouth; blink and
    // squint 0..1; brow raises (-1..1); frown > 0 angles the brows into a
    // scowl, < 0 into worry; smile -1..1; look is [x, y] gaze in -1..1;
    // flare widens the nostrils.
    face({ jaw: open = 0, blink = 0, squint = 0, brow = 0, frown = .45, smile = 0, look = [0, 0], flare = 0 } = {}) {
      jaw.rotation.x = open * .7 + Math.max(0, smile) * .08;
      const closed = Math.max(blink, autoBlink);
      eyes.forEach(({ side, ball, slant, lid, lower }) => {
        ball.rotation.set(-look[1] * .35, look[0] * .45, 0);
        slant.rotation.z = side * (.06 + frown * .12);
        // The upper lid rides up with the gaze and the brow, as real lids do.
        lid.rotation.x = Math.min(1.45, -.46 + squint * .5 + Math.max(0, smile) * .06 + closed * 2 - brow * .15 - look[1] * .15);
        lower.rotation.x = Math.max(.12, .62 - squint * .32 - Math.max(0, smile) * .16 - closed * .4);
      });
      brows.forEach(({ side, brow: group }) => {
        group.position.y = .47 + brow * .075 - squint * .02;
        group.rotation.z = side * (.08 + frown * .32);
      });
      corners.forEach((corner, i) => {
        corner.position.copy(cornerRest[i]);
        corner.position.y += smile * .11 - open * .06;
        corner.position.x *= 1 + Math.max(0, smile) * .18;
        corner.position.z += Math.max(0, smile) * .02;
      });
      cheeks.forEach((cheek, i) => {
        cheek.position.copy(cheekRest[i]);
        cheek.position.y += Math.max(0, smile) * .05 + squint * .02;
      });
      upperLip.position.y = -.09 + Math.max(0, smile) * .035 + open * .03 + flare * .015;
      lowerLip.position.y = -.25 - Math.max(0, smile) * .02;
      nostrils.forEach(nostril => nostril.scale.set(.06 * (1 + flare * .6), .04 * (1 + flare * .8), .018));
      return orc;
    },

    // 0 is an open hand, 1 a tight fist; which is 'left', 'right' or 'both'.
    grip(which, amount) {
      grip(which, amount);
      return orc;
    },

    // Two-bone IK for both legs: keeps each sole flat on its root-space spot
    // (the resting stance plus orc.feet offsets) wherever the hips went.
    plantFeet() {
      root.updateMatrixWorld(true);
      root.getWorldQuaternion(scratch.rootQuaternion);
      legs.forEach((leg, i) => {
        const target = hips.worldToLocal(root.localToWorld(scratch.target.copy(restAnkles[i]).add(footOffsets[i])));
        const reach = target.sub(leg.position);
        const distance = Math.min(Math.max(reach.length(), Math.abs(THIGH - SHIN) + .01), THIGH + SHIN - .0001);
        const hipAngle = Math.acos((THIGH * THIGH + distance * distance - SHIN * SHIN) / (2 * THIGH * distance));
        const bend = Math.PI - Math.acos((THIGH * THIGH + SHIN * SHIN - distance * distance) / (2 * THIGH * SHIN));
        // Knees point the way the body faces.
        const forward = hips.worldToLocal(root.localToWorld(scratch.forward.set(0, 0, 1))).sub(hips.worldToLocal(root.localToWorld(scratch.hip.set(0, 0, 0))));
        const direction = reach.normalize();
        scratch.axis.crossVectors(direction, forward);
        // A foot straight ahead of the hip leaves no bend plane; bend about the hips' own x.
        if (scratch.axis.lengthSq() < 1e-10) scratch.axis.set(-1, 0, 0);
        scratch.axis.normalize();
        scratch.thigh.copy(direction).applyAxisAngle(scratch.axis, hipAngle);
        scratch.y.copy(scratch.thigh).negate();
        // The bend axis stays perpendicular to the thigh, so it cannot flip
        // when the thigh swings past horizontal.
        scratch.x.copy(scratch.axis).negate();
        scratch.z.crossVectors(scratch.x, scratch.y);
        scratch.basis.makeBasis(scratch.x, scratch.y, scratch.z);
        leg.quaternion.setFromRotationMatrix(scratch.basis);
        knees[i].rotation.set(bend, 0, 0);
        leg.updateMatrixWorld(true);
        knees[i].getWorldQuaternion(scratch.quaternion).invert();
        feet[i].quaternion.copy(scratch.quaternion.multiply(scratch.rootQuaternion));
      });
      root.updateMatrixWorld(true);
      return orc;
    },
  };

  orc.reset().plantFeet();
  return orc;
}
