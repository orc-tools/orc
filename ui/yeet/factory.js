// The Factory tab's scene: a run's main agent as the hall at the back and each
// subagent and Orchestrate worker as a station on the floor. What moves
// between them is what the run handed over: a train of blips leaves the hall
// for each set of instructions, a carrier brings each result home once the
// main agent has it, and a station whose agent has closed is decommissioned:
// it powers down and stands dark behind a cordon, weathering as it waits,
// until a newer station needs its slot.
// Each run's floor is a town on one map: `travel` carries the view from one
// run's town to the next.
// Theme packages bundle this with a skin (app-plugins/<id>/factory.js);
// app-plugins/README.md documents the skin. The host (ui/js/factory.js) feeds
// it snapshots and drives frames.
import {
  AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry,
  Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Euler, ExtrudeGeometry, Fog, Group,
  HemisphereLight, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter, PMREMGenerator,
  PerspectiveCamera, PlaneGeometry, PointLight, Quaternion, Raycaster, RepeatWrapping, RingGeometry,
  SRGBColorSpace, Scene, Shape, SphereGeometry, TextureLoader, TorusGeometry, Vector2, Vector3,
} from 'three';
import { back, clamp, createRenderer, mix, range, smooth, wobble } from './stage.js';
import {
  CLOSED, DOOR, FINISHED, HALL, HOVER, createLayout, fitWindow, holdWindow, openingFloor, packetBlips, paintedCamera,
  planFloor, reopened, towardIntake, tripLeft, tripMood, tripShift, tripWindow, weathering, widestWindow,
} from './factory-layout.js';

// Theme tokens every palette falls back to (ui/index.html, app-plugins/*/theme.css).
const TOKENS = ['bg', 'panel', 'border', 'text', 'heading', 'muted', 'accent', 'chip', 'green', 'yellow', 'red', 'purple', 'cyan', 'orange'];

const probe = { context: null };
function cssToColor(css, fallback = '#808080') {
  probe.context ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const context = probe.context;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = fallback;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
}

function readTokens(container) {
  const element = document.createElement('span');
  element.hidden = true;
  container.append(element);
  const tokens = {};
  for (const name of TOKENS) {
    element.style.color = `var(--${name})`;
    tokens[name] = cssToColor(getComputedStyle(element).color);
  }
  element.remove();
  return tokens;
}

const blend = (a, b, t) => a.clone().lerp(b, t);
const hexCss = color => `#${color.getHexString()}`;
// `value` held between `low` and `high` (stage.js's `clamp` holds 0 to 1).
const between = (value, low, high) => Math.min(high, Math.max(low, value));

function tokenPalette(t, mode) {
  const dark = mode === 'dark';
  const ground = blend(t.panel, t.border, dark ? 0.28 : 0.2);
  const sky = blend(t.bg, new Color(0xffffff), dark ? 0.28 : 0.72);
  const cloud = blend(t.cyan, new Color(0x38bdf8), 0.48);
  return {
    ground,
    horizon: blend(ground, t.bg, dark ? 0.62 : 0.52),
    zenith: blend(t.bg, t.panel, dark ? 0.45 : 0.2),
    line: blend(t.border, t.text, dark ? 0.16 : 0.08),
    aisle: blend(t.chip, t.accent, 0.24),
    body: blend(t.chip, t.muted, dark ? 0.48 : 0.22),
    trim: blend(t.muted, t.heading, 0.25),
    roof: t.accent.clone(),
    accent: t.accent.clone(),
    worker: t.purple.clone(),
    busy: t.yellow.clone(),
    ok: t.green.clone(),
    fail: t.red.clone(),
    idle: blend(t.muted, t.bg, 0.25),
    crate: blend(t.orange, t.yellow, 0.45),
    tape: blend(t.heading, t.orange, 0.25),
    smoke: blend(t.muted, t.text, 0.38),
    // What a decommissioned station fades towards, and what grows round it.
    dust: blend(blend(t.muted, ground, 0.5), t.orange, 0.08),
    moss: blend(t.green, ground, dark ? 0.5 : 0.35),
    glow: t.cyan.clone(),
    cloud,
    cloudPuff: blend(new Color(dark ? 0xe0f2fe : 0xf8fafc), cloud, dark ? 0.2 : 0.12),
    cloudRim: blend(new Color(dark ? 0xbae6fd : 0xe0f2fe), cloud, dark ? 0.42 : 0.28),
    window: blend(t.yellow, t.orange, 0.22),
    door: blend(t.bg, t.heading, dark ? 0.08 : 0.68),
    sun: new Color(dark ? 0xd9e4ff : 0xfff4e2),
    sky,
    sunIntensity: dark ? 2.35 : 2.5,
    skyIntensity: dark ? 1.35 : 1.3,
    envIntensity: dark ? 0.65 : 0.5,
    exposure: dark ? 1.12 : 1.02,
    fogNear: 7,
    fogSpan: 24,
  };
}

// Three's Color() treats numbers as 24-bit RGB hex, so scalar lighting and fog keys stay numbers.
function resolvePalette(skin, mode, tokens) {
  const palette = tokenPalette(tokens, mode);
  const overrides = typeof skin.palette === 'function' ? skin.palette(mode, tokens) : skin.palette?.[mode];
  let customHorizon = false;
  let customZenith = false;
  for (const [key, value] of Object.entries(overrides || {})) {
    if (key === 'horizon') customHorizon = true;
    if (key === 'zenith') customZenith = true;
    if (/Intensity$|^exposure$|^fogNear$|^fogSpan$/.test(key)) palette[key] = value;
    else if (value?.isColor) palette[key] = value.clone();
    else if (typeof value === 'number') palette[key] = new Color(value);
    else if (typeof value === 'string') palette[key] = cssToColor(value);
  }
  if (!customHorizon) palette.horizon = blend(palette.ground, palette.sky, mode === 'dark' ? 0.34 : 0.44);
  if (!customZenith) palette.zenith = blend(palette.sky, tokens.bg, mode === 'dark' ? 0.58 : 0.35);
  return palette;
}

function defaultBackdrop(palette, mode) {
  const dark = mode === 'dark';
  const top = hexCss(palette.zenith);
  const mid = hexCss(blend(palette.zenith, palette.horizon, 0.62));
  const horizon = hexCss(palette.horizon);
  const glow = hexCss(blend(palette.horizon, palette.glow, dark ? 0.24 : 0.14));
  const base = hexCss(palette.ground);
  return `radial-gradient(ellipse 72% 38% at 50% 28%, ${glow} 0%, transparent 72%), `
    + `linear-gradient(180deg, ${top} 0%, ${mid} 24%, ${horizon} 46%, ${base} 100%)`;
}

// PBR metals and clearcoat materials render dark without an environment map; tint one from the active palette.
function buildEnvironment(renderer, palette, mode) {
  const pmrem = new PMREMGenerator(renderer);
  const studio = new Scene();
  studio.background = blend(palette.horizon, palette.zenith, 0.5);
  const addCard = (w, h, color, intensity, pos, look = [0, 0, 0]) => {
    const mat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), side: DoubleSide });
    const mesh = new Mesh(new PlaneGeometry(w, h), mat);
    mesh.position.set(...pos);
    mesh.lookAt(...look);
    studio.add(mesh);
  };
  const boost = mode === 'dark' ? 1.55 : 1.35;
  addCard(18, 10, palette.sky, 1.3 * boost, [0, 9, 0]);
  addCard(12, 8, palette.sun, 1.9 * boost, [-8, 6, 7]);
  addCard(12, 8, palette.glow, 1.45 * boost, [8, 4, -7]);
  addCard(10, 6, palette.accent, 1.15 * boost, [0, 3, 9]);
  addCard(22, 22, palette.ground, 0.65, [0, -6, 0]);
  const target = pmrem.fromScene(studio, 0.045);
  studio.traverse(node => {
    node.geometry?.dispose();
    node.material?.dispose();
  });
  return { pmrem, target };
}

function createKit(palette, { mode, software, reducedMotion }) {
  const materials = new Map();
  const textures = new Set();
  const color = value => (typeof value === 'string' && palette[value]?.isColor ? palette[value]
    : value?.isColor ? value : typeof value === 'number' ? new Color(value) : cssToColor(value));

  let shadowTex = null;
  let haloTex = null;

  const kit = {
    palette, mode, software, reducedMotion, materials, textures,
    color, blend,
    // One shared material per look, so stations with the same parts batch.
    mat(value, { rough = 0.68, metal = 0.1, emissive = null, glow = 0, opacity = 1, flat = false, doubleSide = false } = {}) {
      const key = [color(value).getHexString(), rough, metal, emissive ? color(emissive).getHexString() : '', glow, opacity, flat, doubleSide].join(':');
      if (!materials.has(key)) {
        materials.set(key, new MeshStandardMaterial({
          color: color(value), roughness: rough, metalness: metal, flatShading: flat,
          emissive: emissive ? color(emissive) : new Color(0x000000), emissiveIntensity: glow,
          transparent: opacity < 1, opacity, side: doubleSide ? DoubleSide : undefined,
        }));
      }
      return materials.get(key);
    },
    basic(value, { opacity = 1, additive = false, doubleSide = false, depthWrite } = {}) {
      const key = ['basic', color(value).getHexString(), opacity, additive, doubleSide, depthWrite ?? ''].join(':');
      if (!materials.has(key)) {
        materials.set(key, new MeshBasicMaterial({
          color: color(value), transparent: opacity < 1 || additive, opacity,
          depthWrite: depthWrite ?? (!additive && opacity >= 1),
          blending: additive ? AdditiveBlending : undefined,
          side: doubleSide ? DoubleSide : undefined,
        }));
      }
      return materials.get(key);
    },
    canvas(width, height, draw, { repeat = null, nearest = false } = {}) {
      const el = document.createElement('canvas');
      el.width = width;
      el.height = height;
      const ctx = el.getContext('2d');
      draw(ctx, width, height);
      const texture = new CanvasTexture(el);
      texture.colorSpace = SRGBColorSpace;
      if (nearest) {
        texture.magFilter = NearestFilter;
        texture.minFilter = NearestFilter;
        texture.generateMipmaps = false;
      }
      if (repeat) {
        texture.wrapS = RepeatWrapping;
        texture.wrapT = RepeatWrapping;
        texture.repeat.set(repeat[0], repeat[1]);
      }
      textures.add(texture);
      return texture;
    },
    // A texture of the picture at `url` (a file beside the skin, as
    // `new URL(file, import.meta.url).href`), freed with the scene. `loaded`
    // gets it once its image is in.
    picture(url, loaded) {
      const texture = new TextureLoader().load(url, loaded);
      texture.colorSpace = SRGBColorSpace;
      textures.add(texture);
      return texture;
    },
    painted(draw, {
      width = 256, height = 256, repeat = null, nearest = false,
      rough = 0.62, metal = 0.08, emissive = false, glow = 0.85,
      basic = false, transparent = false, opacity = 1, additive = false, doubleSide = false,
    } = {}) {
      const map = kit.canvas(width, height, draw, { repeat, nearest });
      if (basic) {
        return new MeshBasicMaterial({
          map, transparent: transparent || opacity < 1 || additive, opacity,
          depthWrite: !additive && !transparent && opacity >= 1,
          blending: additive ? AdditiveBlending : undefined,
          side: doubleSide ? DoubleSide : undefined,
        });
      }
      return new MeshStandardMaterial({
        map, roughness: rough, metalness: metal,
        emissive: emissive ? new Color(0xffffff) : new Color(0x000000),
        emissiveMap: emissive ? map : null,
        emissiveIntensity: emissive ? glow : 0,
        transparent: transparent || opacity < 1, opacity,
        side: doubleSide ? DoubleSide : undefined,
      });
    },
    shadow(width, depth = width, opacity = 0.28, at = [0, 0.004, 0]) {
      shadowTex ||= kit.canvas(128, 128, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.06, w / 2, h / 2, w * 0.5);
        g.addColorStop(0, 'rgba(0,0,0,0.85)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.38)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
      const mat = new MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false });
      const mesh = new Mesh(new PlaneGeometry(width, depth), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(...at);
      mesh.renderOrder = -1;
      return mesh;
    },
    halo(value, width, depth = width, { opacity = 0.42, at = [0, 0.014, 0], flat = true, additive = mode === 'dark' } = {}) {
      haloTex ||= kit.canvas(128, 128, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.38, 'rgba(255,255,255,0.52)');
        g.addColorStop(0.72, 'rgba(255,255,255,0.14)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
      const mat = new MeshBasicMaterial({
        map: haloTex, color: color(value), transparent: true, opacity,
        depthWrite: false, blending: additive ? AdditiveBlending : undefined, side: DoubleSide,
      });
      mat.userData.factoryHalo = true;
      const mesh = new Mesh(new PlaneGeometry(width, depth), mat);
      if (flat) mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(...at);
      return mesh;
    },
    ground({ radius = 68, color: fill = 'ground', rough = 0.92, metal = 0.04, draw = null, repeat = null, y = 0, z = -5 } = {}) {
      const mat = draw
        ? kit.painted(draw, { width: 512, height: 512, repeat, rough, metal })
        : kit.mat(fill, { rough, metal });
      const disc = new Mesh(new CircleGeometry(radius, 72), mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(0, y, z);
      disc.receiveShadow = !software;
      return disc;
    },
    gable(width, depth, rise, roofMat, { bodyMat = null, trimMat = null, overhang = 0.2, thickness = 0.09 } = {}) {
      const group = new Group();
      if (bodyMat) {
        const tympanum = new Shape();
        tympanum.moveTo(-width / 2, 0);
        tympanum.lineTo(width / 2, 0);
        tympanum.lineTo(0, rise);
        tympanum.closePath();
        const wall = new ExtrudeGeometry(tympanum, { depth, bevelEnabled: false });
        wall.translate(0, 0, -depth / 2);
        group.add(new Mesh(wall, bodyMat));
      }
      const span = Math.hypot(width / 2 + overhang, rise + overhang * (rise / (width / 2)));
      const pitch = Math.atan2(rise, width / 2);
      const eaveDepth = depth + overhang * 2;
      for (const side of [-1, 1]) {
        const slope = kit.box(span, thickness, eaveDepth, roofMat);
        slope.rotation.z = -side * pitch;
        slope.position.set(
          side * (span / 2) * Math.cos(pitch),
          rise - (span / 2) * Math.sin(pitch) + thickness * 0.45,
          0,
        );
        group.add(slope);
      }
      const ridge = kit.box(thickness * 1.6, thickness * 1.4, eaveDepth + 0.06, trimMat || roofMat, [0, rise + thickness * 0.55, 0]);
      group.add(ridge);
      return group;
    },
    // Each station's lamp gets its own material: the engine recolours it with
    // the agent's state.
    lamp() {
      return new MeshStandardMaterial({ color: palette.idle.clone(), emissive: palette.idle.clone(), emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.15 });
    },
    // Lit windows share one material, which brightens while the main agent works.
    windows: new MeshStandardMaterial({ color: blend(palette.window, palette.door, 0.5), emissive: palette.window.clone(), emissiveIntensity: 0.35, roughness: 0.24, metalness: 0.1 }),
    beacon: new MeshStandardMaterial({ color: palette.busy.clone(), emissive: palette.busy.clone(), emissiveIntensity: 0, roughness: 0.28 }),
    box(w, h, d, material, at = [0, 0, 0]) {
      const mesh = new Mesh(new BoxGeometry(w, h, d), material);
      mesh.position.set(...at);
      return mesh;
    },
    cylinder(top, bottom, height, material, at = [0, 0, 0], segments = 16) {
      const mesh = new Mesh(new CylinderGeometry(top, bottom, height, segments), material);
      mesh.position.set(...at);
      return mesh;
    },
    sphere(radius, material, at = [0, 0, 0], detail = 14) {
      const mesh = new Mesh(new SphereGeometry(radius, detail, Math.max(8, detail >> 1)), material);
      mesh.position.set(...at);
      return mesh;
    },
    // A row of sawtooth roof teeth along z, their glazed faces towards +z,
    // `width` wide and spanning `depth`.
    sawtooth(width, depth, teeth, height, roof, glass) {
      const group = new Group();
      const step = depth / teeth;
      const shape = new Shape();
      shape.moveTo(0, 0);
      shape.lineTo(step, 0);
      shape.lineTo(step, height);
      shape.closePath();
      const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
      geometry.rotateY(-Math.PI / 2);
      geometry.translate(width / 2, 0, 0);
      for (let index = 0; index < teeth; index += 1) {
        const tooth = new Mesh(geometry, roof);
        tooth.position.z = -depth / 2 + index * step;
        group.add(tooth);
        const pane = new Mesh(new PlaneGeometry(width * 0.86, height * 0.5), glass);
        pane.position.set(0, height * 0.42, -depth / 2 + (index + 1) * step + 0.005);
        group.add(pane);
      }
      return group;
    },
    shadows(object) {
      if (software) return object;
      object.traverse(child => {
        if (child.isMesh && !child.material?.transparent) child.castShadow = child.receiveShadow = true;
      });
      return object;
    },
  };
  return kit;
}

// Keep the artwork on unpowered signs and windows, but remove the light they
// cast. Swapping materials leaves other meshes and the skin's originals intact.
function switchOffLights(roots) {
  const swaps = new Map();
  const dark = new Map();
  const lights = [];
  function unlit(material) {
    if (!material) return material;
    const halo = material.userData.factoryHalo || material.blending === AdditiveBlending;
    if (!halo && !material.emissive?.getHex()) return material;
    if (!dark.has(material)) {
      const copy = material.clone();
      if (halo) copy.visible = false;
      else {
        copy.emissiveIntensity = 0;
        copy.color.multiplyScalar(0.09);
      }
      dark.set(material, copy);
    }
    return dark.get(material);
  }
  for (const root of roots) root?.traverse(node => {
    if (node.isLight && node.visible) {
      lights.push(node);
      node.visible = false;
    }
    const live = node.material;
    if (!live) return;
    const off = Array.isArray(live) ? live.map(unlit) : unlit(live);
    if (off === live) return;
    swaps.set(node, live);
    node.material = off;
  });
  return () => {
    for (const [node, live] of swaps) node.material = live;
    for (const light of lights) light.visible = true;
    for (const material of dark.values()) material.dispose();
  };
}

// ---------- stock models: any skin part left out uses these ----------

function stockFloor(kit) {
  const { palette } = kit;
  const group = new Group();
  group.add(kit.ground({
    draw(ctx, w, h) {
      ctx.fillStyle = hexCss(palette.ground);
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = hexCss(blend(palette.ground, palette.line, 0.35));
      ctx.lineWidth = 2;
      const step = w / 8;
      for (let i = 0; i <= 8; i += 1) {
        const p = i * step;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
      }
    },
    repeat: [26, 26],
  }));
  const curb = kit.mat('trim', { rough: 0.7, metal: 0.2 });
  for (const side of [-1, 1]) {
    const rail = kit.box(0.12, 0.04, 13.8, curb, [side * 0.98, 0.02, 3.3]);
    rail.receiveShadow = !kit.software;
    group.add(rail);
  }
  const aisle = kit.box(1.84, 0.022, 13.8, kit.mat('aisle', { rough: 0.84 }), [0, 0.011, 3.3]);
  aisle.receiveShadow = !kit.software;
  group.add(aisle);
  const dash = new PlaneGeometry(0.11, 0.62);
  for (let z = -2.5; z < 9.9; z += 1.15) {
    const mark = new Mesh(dash, kit.basic(palette.line, { opacity: 0.75 }));
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.026, z);
    group.add(mark);
  }
  return group;
}

function stockHall(kit) {
  const group = new Group();
  const body = kit.mat('body', { rough: 0.72 });
  const trim = kit.mat('trim', { rough: 0.52, metal: 0.28 });
  const roof = kit.mat('roof', { rough: 0.48, metal: 0.2 });
  group.add(kit.shadow(6.2, 4.4, 0.34));
  group.add(kit.box(5.0, 0.22, 3.2, trim, [0, 0.11, 0]));
  group.add(kit.box(4.65, 1.95, 2.85, body, [0, 1.18, 0]));
  const teeth = kit.sawtooth(4.65, 2.85, 3, 0.78, roof, kit.windows);
  teeth.position.y = 2.15;
  group.add(teeth);
  const opening = kit.box(1.7, 1.45, 0.08, kit.mat('door', { rough: 1 }), [0, 0.92, 1.43]);
  group.add(opening);
  const frame = kit.mat('accent', { rough: 0.38, metal: 0.35, emissive: 'accent', glow: 0.18 });
  group.add(kit.box(0.14, 1.62, 0.18, frame, [-0.92, 0.95, 1.44]));
  group.add(kit.box(0.14, 1.62, 0.18, frame, [0.92, 0.95, 1.44]));
  group.add(kit.box(2.02, 0.18, 0.2, frame, [0, 1.76, 1.44]));
  // Hinged at its top edge, so scaling y rolls it up while a crate goes in.
  const door = kit.box(1.62, 1.38, 0.06, kit.mat('trim', { rough: 0.46, metal: 0.4 }), [0, 0, 0]);
  door.geometry.translate(0, -0.69, 0);
  door.position.set(0, 1.62, 1.48);
  group.add(door);
  for (const x of [-1.76, -1.28, 1.28, 1.76]) group.add(kit.box(0.36, 0.46, 0.05, kit.windows, [x, 1.26, 1.43]));
  group.add(kit.cylinder(0.2, 0.27, 1.55, trim, [-1.52, 2.8, -0.75]));
  group.add(kit.cylinder(0.28, 0.28, 0.16, kit.mat('accent', { rough: 0.45 }), [-1.52, 3.56, -0.75]));
  for (const x of [-0.72, 0.72]) group.add(kit.cylinder(0.04, 0.04, 0.5, trim, [x, 2.88, 0.35], 8));
  group.add(kit.box(1.95, 0.52, 0.09, kit.mat('accent', { rough: 0.4, emissive: 'accent', glow: 0.28 }), [0, 3.34, 0.35]));
  group.add(kit.cylinder(0.04, 0.04, 0.4, trim, [1.6, 2.98, -0.6], 8));
  const beacon = kit.sphere(0.16, kit.beacon, [1.6, 3.28, -0.6]);
  group.add(beacon);
  group.userData = { door, beacon, chimney: new Vector3(-1.52, 3.74, -0.75), labelY: 3.95 };
  return kit.shadows(group);
}

function stockStation(kit, kind) {
  const group = new Group();
  const body = kit.mat('body', { rough: 0.72 });
  const trim = kit.mat('trim', { rough: 0.5, metal: 0.3 });
  const lamp = new Mesh(new SphereGeometry(0.14, 14, 10), kit.lamp());
  const spin = [];
  const swing = [];
  if (kind === 'worker') {
    const accent = kit.mat('worker', { rough: 0.55, metal: 0.15 });
    group.add(kit.box(1.68, 0.14, 1.48, trim, [0, 0.07, 0]));
    group.add(kit.box(1.5, 1.06, 1.3, body, [0, 0.66, 0]));
    group.add(kit.box(1.54, 0.16, 1.34, accent, [0, 0.92, 0]));
    const teeth = kit.sawtooth(1.5, 1.3, 2, 0.44, accent, kit.mat('window', { emissive: 'window', glow: 0.4 }));
    teeth.position.y = 1.19;
    group.add(teeth);
    group.add(kit.box(0.62, 0.7, 0.05, kit.mat('door', { rough: 1 }), [0, 0.5, 0.66]));
    group.add(kit.cylinder(0.11, 0.14, 0.75, trim, [-0.5, 1.76, -0.35]));
    const fan = new Group();
    fan.position.set(0.42, 0.62, 0.67);
    for (let blade = 0; blade < 3; blade += 1) {
      const vane = kit.box(0.05, 0.26, 0.02, trim, [0, 0.13, 0]);
      const arm = new Group();
      arm.rotation.z = (blade / 3) * Math.PI * 2;
      arm.add(vane);
      fan.add(arm);
    }
    group.add(fan);
    spin.push([fan, 'z', 7]);
    lamp.position.set(0.5, 1.88, 0.3);
    group.add(kit.cylinder(0.03, 0.03, 0.3, trim, [0.5, 1.7, 0.3], 8));
    group.userData = { puff: new Vector3(-0.5, 2.2, -0.35), labelY: 2.35 };
  } else {
    group.add(kit.box(1.36, 0.5, 1.06, body, [0, 0.25, 0]));
    group.add(kit.box(1.18, 0.12, 0.88, trim, [0, 0.56, 0]));
    const hopper = new Mesh(new ConeGeometry(0.34, 0.5, 4, 1, true), kit.mat('accent', { rough: 0.55, metal: 0.18 }));
    hopper.rotation.set(Math.PI, Math.PI / 4, 0);
    hopper.position.set(-0.3, 0.92, -0.18);
    group.add(hopper);
    const steel = kit.mat('accent', { rough: 0.4, metal: 0.45 });
    const gear = new Mesh(new TorusGeometry(0.19, 0.045, 6, 12), steel);
    for (let tooth = 0; tooth < 8; tooth += 1) {
      const cog = kit.box(0.07, 0.09, 0.07, steel);
      const angle = (tooth / 8) * Math.PI * 2;
      cog.position.set(Math.cos(angle) * 0.25, Math.sin(angle) * 0.25, 0);
      cog.rotation.z = angle;
      gear.add(cog);
    }
    gear.position.set(0.69, 0.32, 0.12);
    gear.rotation.y = Math.PI / 2;
    group.add(gear);
    spin.push([gear, 'z', 5]);
    const shoulder = new Group();
    shoulder.position.set(0.3, 0.64, 0.05);
    shoulder.add(kit.cylinder(0.08, 0.1, 0.16, trim, [0, 0.06, 0], 10));
    const arm = kit.box(0.09, 0.62, 0.09, trim, [0, 0.36, 0]);
    shoulder.add(arm);
    const head = kit.box(0.2, 0.08, 0.16, kit.mat('accent', { rough: 0.45 }), [0, 0.68, 0.06]);
    shoulder.add(head);
    group.add(shoulder);
    swing.push([shoulder, 'x', 0.55, 3.2]);
    lamp.position.set(-0.48, 1.06, 0.36);
    group.add(kit.cylinder(0.025, 0.025, 0.42, trim, [-0.48, 0.82, 0.36], 8));
    group.add(kit.box(0.4, 0.06, 0.32, trim, [0, 0.35, 0.58]));
    group.userData = { puff: new Vector3(-0.3, 1.2, -0.18), labelY: 1.75 };
  }
  group.add(lamp);
  Object.assign(group.userData, { lamp, spin, swing });
  return kit.shadows(group);
}

function stockCrate(kit) {
  const group = new Group();
  group.add(kit.box(0.46, 0.4, 0.46, kit.mat('crate', { rough: 0.78 })));
  const tape = kit.mat('tape', { rough: 0.5, metal: 0.2 });
  group.add(kit.box(0.48, 0.42, 0.09, tape));
  group.add(kit.box(0.09, 0.42, 0.48, tape));
  return kit.shadows(group);
}

function stockCarrier(kit) {
  const object = new Group();
  const shell = kit.mat('accent', { rough: 0.35, metal: 0.4 });
  const dark = kit.mat('trim', { rough: 0.45, metal: 0.35 });
  object.add(kit.box(0.56, 0.16, 0.56, shell));
  object.add(kit.box(0.3, 0.12, 0.3, dark, [0, 0.13, 0]));
  object.add(kit.sphere(0.07, kit.mat('glow', { emissive: 'glow', glow: 1.4 }), [0, 0.02, 0.29], 10));
  const rotors = [];
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
    const arm = kit.box(0.42, 0.05, 0.06, dark, [x / 2, 0, z / 2]);
    arm.rotation.y = Math.atan2(-z, x);
    object.add(arm);
    object.add(kit.cylinder(0.05, 0.05, 0.1, dark, [x, 0.07, z], 10));
    const rotor = new Group();
    rotor.position.set(x, 0.13, z);
    rotor.add(kit.box(0.46, 0.015, 0.06, kit.mat('line', { rough: 0.35 })));
    object.add(rotor);
    rotors.push(rotor);
  }
  const hold = new Group();
  hold.position.y = -0.36;
  object.add(hold);
  kit.shadows(object);
  return {
    object, hold, route: 'air', cruise: 3,
    pose(target, { time, speed }) {
      rotors.forEach((rotor, index) => { rotor.rotation.y = time * 38 + index; });
      target.rotation.x = 0.28 * speed;
      target.position.y += Math.sin(time * 5) * 0.04;
    },
  };
}

function stockDecor(kit) {
  const group = new Group();
  const post = kit.mat('trim', { rough: 0.55, metal: 0.35 });
  for (const [x, z] of [[-10, -6.6], [10, -6.6], [-10, 9.6], [10, 9.6]]) {
    group.add(kit.cylinder(0.08, 0.1, 2.5, post, [x, 1.25, z], 10));
    group.add(kit.sphere(0.2, kit.mat('window', { emissive: 'window', glow: 0.9 }), [x, 2.58, z], 12));
  }
  for (const [x, z, turn] of [[-3.6, -5.6, 0.2], [-4.2, -5, -0.3], [3.9, -5.5, 0.1]]) {
    const barrel = kit.cylinder(0.32, 0.32, 0.8, kit.mat('worker', { rough: 0.58 }), [x, 0.4, z]);
    barrel.rotation.y = turn;
    group.add(barrel);
  }
  return kit.shadows(group);
}

function defaultPad(kit, kind, lampMaterial) {
  const group = new Group();
  const wide = kind === 'worker' ? 1.98 : 1.78;
  const deep = kind === 'worker' ? 1.78 : 1.58;
  group.add(kit.shadow(wide + 0.55, deep + 0.55, 0.32, [0, 0.004, 0]));
  const curb = kit.box(wide, 0.044, deep, kit.mat('trim', { rough: 0.64, metal: 0.22 }), [0, 0.012, 0]);
  curb.receiveShadow = !kit.software;
  group.add(curb);
  const deck = kit.box(
    wide - 0.14, 0.024, deep - 0.14,
    kit.mat(kind === 'worker' ? 'aisle' : 'ground', { rough: 0.84, metal: 0.06 }),
    [0, 0.022, 0],
  );
  deck.receiveShadow = !kit.software;
  group.add(deck);
  const apron = kit.box(0.64, 0.026, 0.36, kit.mat('aisle', { rough: 0.78 }), [0, 0.013, deep / 2 + 0.15]);
  apron.receiveShadow = !kit.software;
  group.add(apron);
  if (lampMaterial) {
    for (const side of [-1, 1]) {
      group.add(kit.box(0.34, 0.028, 0.06, lampMaterial, [side * (wide * 0.28), 0.034, deep / 2 - 0.04]));
    }
  }
  return group;
}

function defaultGhost(kit) {
  const group = new Group();
  const beam = kit.basic('accent', { opacity: 0.55 });
  const volume = kit.basic('glow', { opacity: 0.14, additive: kit.mode === 'dark' });
  group.add(kit.box(1.24, 0.96, 1.04, volume, [0, 0.52, 0]));
  for (const x of [-0.62, 0.62]) {
    for (const z of [-0.52, 0.52]) group.add(kit.box(0.05, 1.04, 0.05, beam, [x, 0.54, z]));
  }
  for (const y of [0.06, 1.04]) {
    group.add(kit.box(1.28, 0.04, 0.04, beam, [0, y, -0.52]));
    group.add(kit.box(1.28, 0.04, 0.04, beam, [0, y, 0.52]));
    group.add(kit.box(0.04, 0.04, 1.08, beam, [-0.62, y, 0]));
    group.add(kit.box(0.04, 0.04, 1.08, beam, [0.62, y, 0]));
  }
  return group;
}

function defaultDock(kit) {
  const group = new Group();
  group.position.set(HALL.x + 3.5, 0, HALL.z + 1.42);
  group.add(kit.shadow(2.35, 1.75, 0.3, [0, 0.004, 0]));
  const frame = kit.mat('trim', { rough: 0.65, metal: 0.22 });
  const slat = kit.mat('crate', { rough: 0.82 });
  const glow = kit.mat('accent', { rough: 0.4, metal: 0.3, emissive: 'accent', glow: 0.25 });
  const base = kit.box(1.94, 0.06, 1.34, frame, [0, 0.03, 0]);
  base.receiveShadow = !kit.software;
  group.add(base);
  for (let i = -2; i <= 2; i += 1) {
    const plank = kit.box(1.82, 0.025, 0.19, slat, [0, 0.068, i * 0.24]);
    plank.receiveShadow = !kit.software;
    group.add(plank);
  }
  for (const [x, z] of [[-0.92, -0.62], [0.92, -0.62], [-0.92, 0.62], [0.92, 0.62]]) {
    group.add(kit.cylinder(0.045, 0.055, 0.22, glow, [x, 0.14, z], 8));
  }
  return group;
}

// One blip of a hand-off: instructions on their way `down` to a station, or a
// result's bytes following its carrier `up` to the hall.
function defaultPacket(kit, direction) {
  const tone = direction === 'down' ? 'accent' : 'crate';
  return kit.box(0.12, 0.08, 0.2, kit.mat(tone, { rough: 0.4, metal: 0.2, emissive: tone, glow: kit.mode === 'dark' ? 1 : 0.5 }));
}

// ---------- a decommissioned station's dressing ----------

const laid = (x, y, z, { rx = 0, ry = 0, rz = 0 } = {}) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1));

// Parts drawn as one mesh: each [geometry, matrix] is laid where its matrix
// puts it, and the geometries given are used up.
function mergeParts(parts) {
  const pieces = parts.map(([geometry, matrix]) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    return flat.applyMatrix4(matrix);
  });
  const merged = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    if (!pieces.every(piece => piece.attributes[name])) continue;
    const array = new Float32Array(pieces.reduce((sum, piece) => sum + piece.attributes[name].array.length, 0));
    let at = 0;
    for (const piece of pieces) {
      array.set(piece.attributes[name].array, at);
      at += piece.attributes[name].array.length;
    }
    merged.setAttribute(name, new BufferAttribute(array, pieces[0].attributes[name].itemSize));
  }
  pieces.forEach(piece => piece.dispose());
  return merged;
}

// A length of tape whose stripes keep one pitch however long it runs.
function tapeStrip(length, height = 0.075) {
  const geometry = new BoxGeometry(length, height, 0.012);
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) uv.setX(index, uv.getX(index) * length / 0.22);
  return geometry;
}

// Tufts of blades rooted at y 0, so scaling the mesh in y grows them all.
// `spots` are [x, z, size]; `seed` varies the blades from one station to the next.
function tuftGeometry(spots, seed) {
  let step = seed * 7.13 + 1;
  const rand = () => {
    step += 1;
    const value = Math.sin(step * 127.1) * 43758.5453;
    return value - Math.floor(value);
  };
  const positions = [];
  for (const [x, z, size] of spots) {
    const blades = 4 + Math.floor(rand() * 3);
    for (let blade = 0; blade < blades; blade += 1) {
      const angle = rand() * Math.PI * 2;
      const height = size * (0.55 + rand() * 0.6);
      const half = size * 0.1;
      const lean = 0.25 + rand() * 0.4;
      const baseX = x + Math.cos(angle) * size * 0.14;
      const baseZ = z + Math.sin(angle) * size * 0.14;
      const acrossX = -Math.sin(angle) * half;
      const acrossZ = Math.cos(angle) * half;
      positions.push(
        baseX - acrossX, 0, baseZ - acrossZ,
        baseX + acrossX, 0, baseZ + acrossZ,
        baseX + Math.cos(angle) * height * lean, height, baseZ + Math.sin(angle) * height * lean,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

// The tape and the plaque are painted once per floor and shared by every ruin;
// kept with the kit's materials, they are freed with the scene.
function ruinLooks(kit) {
  let tape = kit.materials.get('ruin:tape');
  if (!tape) {
    const bright = `#${kit.color('busy').getHexString()}`;
    const dark = `#${kit.blend(kit.color('door'), kit.color('trim'), 0.3).getHexString()}`;
    tape = kit.painted((ctx, w, h) => {
      ctx.fillStyle = bright;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = dark;
      for (let x = -h; x < w; x += h) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + h / 2, h);
        ctx.lineTo(x + h, 0);
        ctx.lineTo(x + h / 2, 0);
        ctx.fill();
      }
    }, { width: 64, height: 32, repeat: [1, 1], rough: 0.55, metal: 0.05, doubleSide: true });
    kit.materials.set('ruin:tape', tape);
  }
  let sign = kit.materials.get('ruin:sign');
  if (!sign) {
    const board = kit.blend(kit.color('crate'), new Color(0xf6f1e4), 0.7);
    sign = kit.painted((ctx, w, h) => {
      ctx.fillStyle = `#${board.getHexString()}`;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `#${kit.color('fail').getHexString()}`;
      ctx.lineWidth = 10;
      ctx.strokeRect(9, 9, w - 18, h - 18);
      ctx.fillStyle = `#${kit.color('fail').getHexString()}`;
      ctx.font = '800 66px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CLOSED', w / 2, h / 2 + 3);
    }, { width: 288, height: 128, rough: 0.8, metal: 0, doubleSide: true });
    kit.materials.set('ruin:sign', sign);
  }
  return {
    tape, sign,
    post: kit.mat('trim', { rough: 0.6, metal: 0.3 }),
    moss: kit.mat('moss', { rough: 0.92, doubleSide: true }),
    rubble: kit.mat('dust', { rough: 0.95, flat: true }),
  };
}

// A decommissioned station's cordon: four posts with tape round them, one end
// snapped and stirring in the wind, a CLOSED plaque, rubble at its foot and
// weeds that grow in the longer it stands (`station.weathered`, 0 to 1).
function stockRuin(kit, kind, spot = { slot: 0 }) {
  const group = new Group();
  const looks = ruinLooks(kit);
  const wide = kind === 'worker' ? 1.01 : 0.92;
  const deep = kind === 'worker' ? 0.9 : 0.82;
  const height = 0.47;
  const seed = (spot.slot || 0) + 1;
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  // Only the posts cast shadows: a shadow pass for the thin tape and blades
  // too would double what the ruins cost on a floor full of them.
  group.add(kit.shadows(new Mesh(mergeParts([
    ...corners.map(([x, z]) => [new BoxGeometry(0.07, 0.6, 0.07), laid(x * wide, 0.3, z * deep)]),
    ...corners.map(([x, z]) => [new BoxGeometry(0.1, 0.05, 0.1), laid(x * wide, 0.62, z * deep)]),
  ]), looks.post)));
  const stub = wide * 0.62;
  group.add(new Mesh(mergeParts([
    [tapeStrip(wide * 2), laid(0, height, -deep)],
    [tapeStrip(deep * 2), laid(-wide, height, 0, { ry: Math.PI / 2 })],
    [tapeStrip(deep * 2), laid(wide, height - 0.02, 0, { ry: Math.PI / 2, rz: 0.02 })],
    [tapeStrip(stub), laid(wide - stub / 2, height, deep, { rz: 0.03 })],
  ]), looks.tape));
  const flap = new Group();
  flap.position.set(-wide, height, deep);
  const loose = new Mesh(tapeStrip(0.5), looks.tape);
  loose.position.x = 0.25;
  flap.add(loose);
  flap.rotation.z = -1.08;
  group.add(flap);
  const plaque = new Mesh(new PlaneGeometry(0.36, 0.16), looks.sign);
  plaque.position.set(wide - stub * 0.5, height - 0.12, deep + 0.02);
  plaque.rotation.z = (seed % 2 ? 1 : -1) * 0.09;
  group.add(plaque);
  const rand = salt => {
    const value = Math.sin(seed * 91.7 + salt * 37.3) * 43758.5453;
    return value - Math.floor(value);
  };
  group.add(new Mesh(mergeParts([0, 1, 2].map(index => {
    const size = 0.07 + rand(index) * 0.06;
    const side = rand(index + 5) > 0.5 ? 1 : -1;
    return [new BoxGeometry(size, size * 0.7, size * 1.2), laid(side * (wide - 0.12 - rand(index + 9) * 0.3), size * 0.3,
      (rand(index + 3) - 0.5) * deep * 1.6, { rx: rand(index + 1), ry: rand(index + 2) * 3, rz: rand(index + 4) * 0.6 })];
  })), looks.rubble));
  const weeds = new Mesh(tuftGeometry([
    ...corners.map(([x, z], index) => [x * (wide + 0.02), z * (deep + 0.02), 0.5 + rand(index + 11) * 0.2]),
    [0, -deep - 0.04, 0.46], [-wide * 0.5, -deep - 0.02, 0.36], [wide * 0.45, -deep - 0.02, 0.4],
    [-wide - 0.04, 0.12, 0.44], [-wide - 0.02, -deep * 0.5, 0.34], [wide + 0.04, -0.2, 0.46], [wide + 0.02, deep * 0.45, 0.36],
    [wide * 0.55, -deep * 0.45, 0.34], [-wide * 0.42, deep * 0.55, 0.3], [-wide * 0.6, -deep * 0.55, 0.38], [wide * 0.2, deep * 0.62, 0.28],
  ], seed), looks.moss);
  weeds.scale.set(0.5, 0.001, 0.5);
  group.add(weeds);
  group.userData.frame = (time, dt, station) => {
    const grown = clamp(station.weathered ?? 0);
    const spread = 0.5 + grown * 0.5;
    weeds.scale.set(spread, Math.max(0.001, 0.12 + grown * 0.88), spread);
    if (kit.reducedMotion) return;
    flap.rotation.z = -1.08 + Math.sin(time * 2.2 + seed) * 0.07;
    flap.rotation.y = Math.sin(time * 1.4 + seed * 2) * 0.22;
  };
  return group;
}

// The advisor the main agent asks: a robed reader at a lectern in the
// theme's colours, for a skin without one of its own. It faces +z with the
// lectern before it; `page` is where the hall's pages land, `labelY` where
// its label hangs, and `frame` turns its head and its book's pages while
// `advisor.activity` (0 to 1) says it is reading.
function stockAdvisor(kit) {
  const group = new Group();
  const robe = kit.mat('worker', { rough: 0.78 });
  const trim = kit.mat('trim', { rough: 0.5, metal: 0.3 });
  const wood = kit.mat('body', { rough: 0.85 });
  const paper = kit.mat('#f3eee0', { rough: 0.9 });
  group.add(kit.shadow(1.3, 1.1, 0.24));
  const body = new Mesh(new ConeGeometry(0.42, 1.25, 8), robe);
  body.position.set(0, 0.63, -0.18);
  group.add(body);
  const head = new Group();
  head.position.set(0, 1.42, -0.16);
  head.add(kit.sphere(0.24, kit.mat('trim', { rough: 0.6 }), [0, 0, 0], 12));
  const hood = new Mesh(new ConeGeometry(0.3, 0.42, 8, 1, true), robe);
  hood.position.y = 0.1;
  head.add(hood);
  const glass = kit.mat('glow', { emissive: 'glow', glow: 0.6, rough: 0.2 });
  head.add(kit.box(0.09, 0.07, 0.03, glass, [-0.08, 0.0, 0.22]), kit.box(0.09, 0.07, 0.03, glass, [0.08, 0.0, 0.22]));
  group.add(head);
  // The lectern, and the book open on it.
  group.add(kit.cylinder(0.07, 0.1, 0.9, wood, [0, 0.45, 0.38], 8));
  group.add(kit.box(0.42, 0.06, 0.3, trim, [0, 0.03, 0.38]));
  const desk = kit.box(0.62, 0.05, 0.42, wood, [0, 0.94, 0.42]);
  desk.rotation.x = 0.42;
  group.add(desk);
  const leaf = new Group();
  leaf.position.set(0, 0.99, 0.42);
  leaf.rotation.x = 0.42;
  leaf.add(kit.box(0.26, 0.012, 0.32, paper, [-0.14, 0, 0]), kit.box(0.26, 0.012, 0.32, paper, [0.14, 0, 0]));
  const turning = new Group();
  turning.add(kit.box(0.25, 0.01, 0.31, paper, [0.13, 0.008, 0]));
  leaf.add(turning);
  group.add(leaf);
  const candle = kit.sphere(0.06, kit.basic('window', { additive: true }), [0.36, 1.12, 0.48], 8);
  group.add(kit.cylinder(0.03, 0.03, 0.16, paper, [0.36, 1.02, 0.48], 6), candle);
  group.userData = {
    labelY: 2.15,
    page: new Vector3(0, 1.08, 0.42),
    frame(time, dt, advisor) {
      const reading = advisor.activity;
      head.rotation.x = 0.28 * reading;
      head.rotation.y = Math.sin(time * 0.9) * 0.18 * reading;
      turning.rotation.z = -Math.PI * smooth((time * 0.45) % 1) * reading;
      candle.scale.setScalar(0.85 + Math.sin(time * 9) * 0.12);
    },
  };
  return kit.shadows(group);
}

export const stock = {
  floor: stockFloor, hall: stockHall, station: stockStation, crate: stockCrate, carrier: stockCarrier, decor: stockDecor,
  ruin: stockRuin, advisor: stockAdvisor,
};

// ---------- the engine ----------

const RISE = 0.75;
const SINK = 0.6;
const POP = 0.45;
const SUMMON = 0.4;
const LIFT = 0.4;
const DROP = 0.55;
const LEAVE = 0.45;
// A closed station stands lit this long, then is decommissioned: whoever
// worked it leaves over `VACATE`, its lamp
// goes out over `POWER_DOWN` while its lights flicker off over `FLICKER`, it
// slumps over `FOLD` (a cloud station's cloud sinking with it), its cordon
// rises over `CORDON` and its weeds catch up with its age over `GROW`.
const DWELL = 6;
const POWER_DOWN = 0.35;
const VACATE = 0.5;
const FLICKER = 0.7;
const FOLD = 0.7;
const CORDON = 0.55;
const GROW = 1.6;
// How far a derelict sags and, at most, leans.
const SLUMP = 0.07;
const LEAN = 0.06;
// The weathering a derelict gets when nothing says how long ago it closed.
const UNKNOWN_WEATHER = 0.5;
// How a derelict's materials age: just powered down, then dusty, then
// bleached, from a weathering of 0, 0.4 and 0.75.
const WEATHER_STAGES = [
  { from: 0, saturation: 0.5, light: 0.78, dust: 0.28 },
  { from: 0.4, saturation: 0.3, light: 0.7, dust: 0.45 },
  { from: 0.75, saturation: 0.14, light: 0.64, dust: 0.6 },
];
const weatherStage = age => WEATHER_STAGES.findLastIndex(stage => age >= stage.from);
// Blips of one hand-off follow each other this far apart, a snapshot that
// brings several messages at once sends this many trains, and a blip lobbed
// over the floor is in the air this long.
const BLIP_GAP = 0.13;
const BURST = 3;
const LOB = 1.1;
const PILE_MAX = 12;
const ELEVATION = 0.55;
const AZIMUTH = 0.075;
// How much further back the camera pulls midway through a trip between towns.
const TRIP_LIFT = 0.3;
// How far zooming scales the framing's distance: in to 0.4 of it, out to 1.5.
const ZOOM_NEAR = 0.4;
const ZOOM_FAR = 1.5;
const CLOUD_LIFT = 0.88;
const CLOUD_HALL_LIFT = 1.05;
// Where the advisor stands, beside the hall on its left and turned towards
// it; a skin moves it with `layout.advisor`. It rises in over ADVISOR_ARRIVE
// seconds, a page leaves the hall every PAGE_EVERY or so while it reads and
// flies for PAGE_FLIGHT, its answer's light takes ADVISOR_LIGHT to reach the
// hall, and it is gone ADVISOR_LEAVE after that.
const ADVISOR_SPOT = { x: -4.4, z: -5.6, yaw: 0.6 };
const ADVISOR_ARRIVE = 0.9;
const ADVISOR_LIGHT = 1.2;
const ADVISOR_LEAVE = 0.8;
const PAGE_EVERY = 0.85;
const PAGE_FLIGHT = 1.9;
const PAGES_MAX = 10;
// Pile spots beside the hall door: three across, two deep, then stacked.
const pileSpot = index => {
  const layer = Math.floor(index / 6);
  const spot = index % 6;
  return new Vector3(HALL.x + 2.95 + (spot % 3) * 0.55, 0.27 + layer * 0.42, HALL.z + 1.15 + Math.floor(spot / 3) * 0.55);
};
const STATE_COLOR = { queued: 'idle', running: 'busy', done: 'ok', failed: 'fail', stopped: 'idle', unknown: 'idle' };
// A station looks done as soon as its job is: `ready` only says the crate is
// still outside, waiting for the main agent.
const shown = state => (state === 'ready' ? 'done' : state);

// Translucent rings and uplink beam skip raycasting so clicks through the beam
// still reach stations behind it, while solid cloud puffs pick this agent.
const skipRaycast = () => {};

function makeCloudRig(kit, { rx = 1.15, rz = 1.05, lift = CLOUD_LIFT, seed = 0, scale = 1 } = {}) {
  const dark = kit.mode === 'dark';
  const puffMat = kit.mat('cloudPuff', { rough: 0.78, metal: 0.02, emissive: 'cloud', glow: dark ? 0.26 : 0.1 });
  const rimMat = kit.mat('cloudRim', { rough: 0.72, metal: 0.04, emissive: 'cloud', glow: dark ? 0.36 : 0.14 });
  const cradleMat = kit.mat('cloud', { rough: 0.34, metal: 0.2, emissive: 'cloud', glow: dark ? 0.62 : 0.26 });
  const beadMat = kit.mat('cloud', { rough: 0.2, metal: 0.15, emissive: 'cloud', glow: dark ? 1.6 : 0.85 });

  const bank = new Group();
  const cradle = new Mesh(new CylinderGeometry(0.92, 0.82, 0.065 * scale, 28), cradleMat);
  cradle.scale.set(rx, 1, rz);
  cradle.position.y = -0.03 * scale;
  bank.add(cradle);

  const belly = kit.sphere(1, puffMat, [0, -0.13 * scale, 0], 18);
  belly.scale.set(rx * 1.04, 0.25 * scale, rz * 1.04);
  bank.add(belly);

  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + seed * 0.37;
    const wave = 0.88 + 0.16 * Math.sin(i * 2.1 + seed);
    const pr = 0.43 * wave * scale;
    const puff = kit.sphere(1, i % 2 === 0 ? puffMat : rimMat, [
      Math.cos(a) * rx * 0.82,
      (-0.06 + (i % 3) * 0.032) * scale,
      Math.sin(a) * rz * 0.82,
    ], 14);
    puff.scale.set(pr * 1.28, pr * 0.7, pr * 1.22);
    bank.add(puff);
  }
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.35 + seed * 0.2;
    const lower = kit.sphere(1, rimMat, [Math.cos(a) * rx * 0.52, -0.25 * scale, Math.sin(a) * rz * 0.52], 12);
    lower.scale.set(0.42 * scale, 0.2 * scale, 0.42 * scale);
    bank.add(lower);
  }
  kit.shadows(bank);

  const orbitHolder = new Group();
  orbitHolder.position.y = 0.12 * scale;
  orbitHolder.rotation.set(0.11, 0, -0.08);
  const ringGeo = new TorusGeometry(1, 0.024 * scale / Math.max(rx, rz), 8, 48);
  ringGeo.rotateX(Math.PI / 2);
  const orbitRing = new Mesh(ringGeo, kit.basic('cloud', { opacity: dark ? 0.78 : 0.66 }));
  orbitRing.scale.set(rx * 1.26, 1, rz * 1.26);
  orbitRing.raycast = skipRaycast;
  orbitHolder.add(orbitRing);

  const beads = Array.from({ length: 3 }, () => {
    const bead = kit.sphere(0.072 * scale, beadMat, [0, 0, 0], 10);
    bead.raycast = skipRaycast;
    orbitHolder.add(bead);
    return bead;
  });
  bank.add(orbitHolder);

  const ground = new Group();
  const shadeGeo = new CircleGeometry(1, 32);
  shadeGeo.rotateX(-Math.PI / 2);
  const shadeDisc = new Mesh(shadeGeo, kit.basic(0x000000, { opacity: dark ? 0.34 : 0.18, depthWrite: false }));
  shadeDisc.position.y = 0.006;
  shadeDisc.scale.set(rx * 1.04, 1, rz * 1.04);
  shadeDisc.renderOrder = -1;
  shadeDisc.raycast = skipRaycast;
  ground.add(shadeDisc);

  const outerGeo = new RingGeometry(0.88, 0.98, 44);
  outerGeo.rotateX(-Math.PI / 2);
  const outerTarget = new Mesh(outerGeo, kit.basic('cloud', { opacity: dark ? 0.76 : 0.62, additive: dark, depthWrite: false }));
  outerTarget.position.y = 0.02;
  outerTarget.scale.set(rx * 0.98, 1, rz * 0.98);
  outerTarget.raycast = skipRaycast;
  ground.add(outerTarget);

  const innerGeo = new RingGeometry(0.48, 0.57, 36);
  innerGeo.rotateX(-Math.PI / 2);
  const innerTarget = new Mesh(innerGeo, kit.basic('cloud', { opacity: dark ? 0.54 : 0.44, additive: dark, depthWrite: false }));
  innerTarget.position.y = 0.021;
  innerTarget.scale.set(rx * 0.98, 1, rz * 0.98);
  innerTarget.raycast = skipRaycast;
  ground.add(innerTarget);

  const beam = new Mesh(
    new CylinderGeometry(0.46, 0.76, 1, 24, 1, true),
    kit.basic('cloud', { opacity: dark ? 0.22 : 0.17, additive: dark, doubleSide: true, depthWrite: false }),
  );
  beam.raycast = skipRaycast;
  ground.add(beam);

  const pulseMat = kit.basic('cloud', { opacity: dark ? 0.78 : 0.62, additive: dark, depthWrite: false });
  const pulses = [0, 1].map(() => {
    const pulseGeo = new TorusGeometry(1, 0.036 / Math.max(rx, rz), 6, 36);
    pulseGeo.rotateX(Math.PI / 2);
    const pulse = new Mesh(pulseGeo, pulseMat);
    pulse.raycast = skipRaycast;
    ground.add(pulse);
    return pulse;
  });

  let phase = seed * 1.13;
  return {
    bank,
    ground,
    frame(now, dt, active, reducedMotion, { emerge = 1, fold = 0 } = {}) {
      const bob = reducedMotion ? 0 : Math.sin(now * 1.9 + seed * 1.7) * 0.055;
      const deckY = (lift + bob) * (1 - fold * 0.85);
      phase += reducedMotion ? 0 : dt * (0.72 + active * 1.65);
      beads.forEach((bead, i) => {
        const a = phase + (i / beads.length) * Math.PI * 2;
        bead.position.set(Math.cos(a) * rx * 1.26, 0, Math.sin(a) * rz * 1.26);
      });
      const beamSpan = Math.max(0.08, deckY - 0.18 * scale);
      const uplinkScale = Math.max(0.001, emerge * (1 - fold));
      ground.visible = uplinkScale > 0.02;
      ground.scale.set(uplinkScale, 1, uplinkScale);
      beam.position.y = 0.02 + beamSpan / 2;
      beam.scale.set(rx * 0.9, beamSpan, rz * 0.9);
      pulses.forEach((pulse, i) => {
        const u = reducedMotion ? 0.3 + i * 0.38 : (now * (0.46 + active * 0.44) + i * 0.5 + seed * 0.17) % 1;
        const taper = mix(0.76, 0.46, u);
        const envelope = Math.sin(u * Math.PI);
        pulse.visible = envelope > 0.04;
        pulse.position.y = 0.03 + u * beamSpan;
        const s = taper * (0.86 + 0.14 * envelope);
        pulse.scale.set(rx * 0.9 * s, 1, rz * 0.9 * s);
      });
      return deckY;
    },
  };
}

// Frees what an object built for itself. Materials stay: the kit shares them.
function release(object) {
  object.traverse(child => child.geometry?.dispose());
}

// How far the texture of the floor's widest sheet runs before it repeats, in
// world units along x and z. Null when no sheet in it is tiled.
function groundTile(floor) {
  let widest = 0;
  let tile = null;
  floor.traverse(child => {
    const map = child.material?.map;
    if (!child.isMesh || map?.wrapS !== RepeatWrapping) return;
    child.geometry.computeBoundingBox();
    const { min, max } = child.geometry.boundingBox;
    if (max.x - min.x <= widest) return;
    widest = max.x - min.x;
    tile = { x: widest / map.repeat.x, z: (max.y - min.y) / map.repeat.y };
  });
  return tile;
}

// `options.mode` is 'light' or 'dark' (the system's when absent) and
// `options.reducedMotion` keeps everything still: stations appear in place and
// a finished job's crate lands on the pile without a trip.
export function createFactory(container, skin = {}, options = {}) {
  const mode = options.mode === 'light' || options.mode === 'dark' ? options.mode
    : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const reducedMotion = !!options.reducedMotion;
  const { renderer, canvas, software } = createRenderer(container);
  if (software && skin.view?.softwarePixelRatio) renderer.setPixelRatio(between(skin.view.softwarePixelRatio, 0.5, 1));
  const palette = resolvePalette(skin, mode, readTokens(container));
  const kit = createKit(palette, { mode, software, reducedMotion });
  kit.stock = stock;
  // What is really on its way, for a skin's own motion: how many hand-offs
  // are heading `down` to stations and `up` to the hall, `flow` easing to 1
  // while any are, `clock` that only runs while they do, and `progress`, the
  // share of the crew that has closed.
  kit.traffic = { down: 0, up: 0, flow: 0, clock: 0, progress: 0 };
  renderer.toneMappingExposure = palette.exposure;

  const customBackdrop = typeof skin.backdrop === 'function' ? skin.backdrop(mode, palette) : skin.backdrop?.[mode];
  const stageBackdrop = customBackdrop ?? defaultBackdrop(palette, mode);
  const appliedBackdrop = stageBackdrop !== null;
  if (appliedBackdrop) container.style.setProperty('--factory-stage-bg', stageBackdrop);

  const build = part => (skin[part] || stock[part]);
  const { slotPosition, slotOrder, outlet: outletOf, framing, routeLength, routePoint } = createLayout(skin.layout);
  const elevation = between(skin.view?.elevation ?? ELEVATION, 0.4, 0.8);
  const azimuth = between(skin.view?.azimuth ?? AZIMUTH, -0.3, 0.3);
  // A painted floor is seen from where its painter stood: the camera never
  // moves, and panning, zooming and trips move a window on the painting
  // instead (`placePainting`). Nothing on it bends, since a painting would.
  const painting = skin.view?.painting || null;
  const painter = painting ? paintedCamera(painting) : null;

  const scene = new Scene();
  scene.fog = painter ? null : new Fog(palette.horizon, 24, 48);

  let env = null;
  if (!software) {
    env = buildEnvironment(renderer, palette, mode);
    scene.environment = env.target.texture;
    scene.environmentIntensity = palette.envIntensity;
  }

  scene.add(new HemisphereLight(palette.sky, palette.ground, palette.skyIntensity));
  scene.add(new AmbientLight(palette.sky, 0.22));
  const sun = new DirectionalLight(palette.sun, palette.sunIntensity);
  sun.position.set(-7.5, 14.5, 9.5);
  // A painting has its shadows painted in.
  sun.castShadow = !software && !painter;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 42 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new DirectionalLight(palette.glow, 0.42);
  fill.position.set(8, 5.5, 6);
  scene.add(fill);
  const rim = new DirectionalLight(blend(palette.glow, palette.accent, 0.45), mode === 'dark' ? 0.68 : 0.36);
  rim.position.set(3.5, 6.5, -12);
  scene.add(rim);
  const hearth = new PointLight(palette.window, mode === 'dark' ? 3.2 : 1.6, 8.5, 1.6);
  hearth.position.set(HALL.x, 1.75, HALL.z + 2.05);
  scene.add(hearth);

  const ground = build('floor')(kit);
  scene.add(ground);
  const tile = groundTile(ground);
  const hallBase = build('hall')(kit);
  const hallGroundDecals = hallBase.children.filter(child =>
    child.isMesh && child.position.y < 0.03 && child.geometry?.type === 'PlaneGeometry');
  const hall = new Group();
  hall.position.set(HALL.x, 0, HALL.z);
  hall.userData = hallBase.userData;
  hall.userData.agentId = 'main';
  const hallDeck = new Group();
  hallDeck.add(hallBase);
  const hallCloud = makeCloudRig(kit, { rx: 2.9, rz: 2.0, lift: CLOUD_HALL_LIFT, seed: 0, scale: 1.45 });
  hallCloud.bank.visible = false;
  hallCloud.ground.visible = false;
  hallDeck.add(hallCloud.bank);
  hall.add(hallCloud.ground, hallDeck);
  scene.add(hall);
  const dock = skin.dock === false ? null : (skin.dock ? skin.dock(kit) : defaultDock(kit));
  if (dock) scene.add(dock);
  const decor = build('decor')(kit);
  if (decor) scene.add(decor);
  const weather = skin.weather ? skin.weather(kit) : null;
  if (weather?.object) scene.add(weather.object);

  const camera = new PerspectiveCamera(painter?.fov ?? 29, painter ? painter.width / painter.height : 1, 0.1, 160);
  if (painter) {
    camera.position.set(painter.eye.x, painter.eye.y, painter.eye.z);
    camera.rotation.set(-painter.elevation, 0, 0);
  }
  const view = { distance: null, target: new Vector3(), goalTarget: new Vector3() };
  // A painted floor's windows on its painting (factory-layout.js): `base`
  // eases to where the framing puts it and `shown` is the one on screen, in a
  // pane `width` by `height` CSS pixels.
  const win = { base: null, shown: null, width: 1, height: 1 };
  // A drag slides the view over the ground: `offset` is added to wherever the
  // framing looks, `grab` is the point held under the pointer.
  const pan = { offset: new Vector3(), velocity: new Vector3(), grab: null, pointer: new Vector2(), homing: false };
  const panStep = new Vector3();
  const panHit = new Vector3();
  // Everything that belongs to the run on the floor: its stations, what moves
  // between them and the hall, and the pile. The scenery around it is the
  // same in every town.
  let crew = new Group();
  scene.add(crew);
  // A trip to another run's town: `left` is the town being left, standing
  // `shift` away from this one, and `from` is where the view was looking,
  // measured from where the framing looks now.
  let trip = null;
  // `scale` multiplies the framing's distance (a painted floor's window
  // width), so below 1 is closer in. It eases to `goal`, between `near` and
  // `far`, about `anchor`, the point to hold still on screen.
  const zoom = { scale: 1, goal: 1, anchor: null, near: ZOOM_NEAR, far: ZOOM_FAR };
  const ring = new Group();
  ring.position.y = 0.03;
  ring.visible = false;
  const innerRing = new Mesh(new RingGeometry(1.04, 1.2, 48), kit.basic('accent', { opacity: 0.9 }));
  innerRing.rotation.x = -Math.PI / 2;
  const outerRing = new Mesh(new RingGeometry(1.27, 1.33, 48), kit.basic('glow', { opacity: 0.55 }));
  outerRing.rotation.x = -Math.PI / 2;
  ring.add(innerRing, outerRing, kit.halo('accent', 2.9, 2.9, { opacity: 0.24, at: [0, -0.012, 0] }));
  scene.add(ring);

  const stations = new Map();
  const leaving = new Set();
  // `retired` holds the agents whose stations have been decommissioned, and
  // `gone` those whose stations then made way for newer ones.
  const retired = new Set();
  const gone = new Set();
  const packets = [];
  const deliveries = [];
  const pile = [];
  const puffs = [];
  const bits = [];
  let floor = new Map();
  let waiting = 0;
  let main = { state: 'idle' };
  let restoreLights = null;
  let now = 0;
  let last = null;
  let primed = false;
  let pileCount = 0;
  let hallPulse = -10;
  let doorOpenUntil = -10;
  let nextChimney = 0;
  let highlighted = null;
  let focused = null;
  let disposed = false;
  let carrierWay = null;
  let built = { worker: 0, subagent: 0 };
  // The advisor while it stands on the floor, and the pages on their way to it.
  const advisorSpot = { ...ADVISOR_SPOT, ...(skin.layout?.advisor || {}) };
  let advisor = null;
  const pages = [];
  const raycaster = new Raycaster();
  const pointerPoint = new Vector2();

  function puff(at, { color = 'smoke', size = 0.22, life = 1.4, rise = 1.1, spread = 0.25, opacity = 0.5 } = {}) {
    if (reducedMotion) return;
    let entry = puffs.find(item => !item.mesh.visible);
    if (!entry) {
      if (puffs.length >= 90) return;
      entry = { mesh: new Mesh(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ transparent: true, depthWrite: false })) };
      crew.add(entry.mesh);
      puffs.push(entry);
    }
    entry.mesh.material.color.copy(kit.color(color));
    Object.assign(entry, {
      start: now, life, size, opacity, from: at.clone(),
      drift: new Vector3((Math.random() - 0.5) * spread, rise, (Math.random() - 0.5) * spread),
    });
    entry.mesh.visible = true;
  }

  function confetti(at) {
    if (reducedMotion) return;
    const colors = ['ok', 'busy', 'accent', 'glow', 'fail'];
    for (let index = 0; index < 18; index += 1) {
      let entry = bits.find(item => !item.mesh.visible);
      if (!entry) {
        if (bits.length >= 72) return;
        entry = { mesh: new Mesh(new BoxGeometry(0.1, 0.02, 0.14), new MeshBasicMaterial({ transparent: true })) };
        crew.add(entry.mesh);
        bits.push(entry);
      }
      entry.mesh.material.color.copy(kit.color(colors[index % colors.length]));
      const angle = (index / 18) * Math.PI * 2;
      Object.assign(entry, {
        start: now, life: 1.3, from: at.clone(),
        velocity: new Vector3(Math.cos(angle) * (1 + Math.random()), 3.2 + Math.random() * 1.6, Math.sin(angle) * 0.6 + 1.2),
        turn: new Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
      });
      entry.mesh.visible = true;
    }
  }

  function syncStationCloud(record, isCloud) {
    record.cloud = !!isCloud;
    if (record.cloud && !record.cloudRig) {
      const worker = record.kind === 'worker';
      record.cloudRig = makeCloudRig(kit, {
        rx: worker ? 1.16 : 1.04,
        rz: worker ? 1.06 : 0.94,
        lift: CLOUD_LIFT,
        seed: record.slot + 1,
      });
      record.deck.add(record.cloudRig.bank);
      record.root.add(record.cloudRig.ground);
    }
    if (record.cloudRig) {
      record.cloudRig.bank.visible = record.cloud;
      record.cloudRig.ground.visible = record.cloud;
    }
    if (record.pad) record.pad.visible = !record.cloud;
    if (!record.cloud) record.deck.position.y = 0;
  }

  function makeStation(id, agent, slot, initial) {
    const { x, z, side, row, column, yaw } = slotPosition(slot);
    const kind = agent.kind === 'worker' ? 'worker' : 'subagent';
    const root = new Group();
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    root.userData.agentId = id;
    const deck = new Group();
    const spot = { slot, side, row, column, index: built[kind]++ };
    const model = build('station')(kit, kind, spot);
    deck.add(model);
    const lamp = model.userData.lamp;
    const pad = skin.pad === false ? null : (skin.pad ? skin.pad(kit, kind, lamp?.material) : defaultPad(kit, kind, lamp?.material));
    if (pad) deck.add(pad);
    const ghost = skin.ghost ? skin.ghost(kit, kind, spot) : defaultGhost(kit);
    deck.add(ghost);
    root.add(deck);
    crew.add(root);
    const animate = !initial && !reducedMotion;
    const sparkColor = agent.cloud ? 'cloud' : 'glow';
    const record = {
      id, slot, root, deck, pad, model, ghost, cloud: false, cloudRig: null,
      kind: agent.kind, state: shown(agent.state),
      lamp, spin: model.userData.spin || [], swing: model.userData.swing || [],
      born: animate ? now + 0.55 : -Infinity, sinkAt: null, failedAt: null, doneAt: null,
      // `closedAt` starts the wait before the station is decommissioned,
      // `offAt` its power-down (-Infinity when it was so before the floor
      // opened), and `derelict` what decommissioning changed; `parcel` is a
      // result its parent has not taken yet.
      spot, closedAt: null, offAt: null, derelict: null, weathered: 0, parcel: null, heardAt: -10,
      sent: agent.sent?.packets || 0, sentBytes: agent.sent?.bytes || 0,
      activity: agent.state === 'running' ? 1 : 0, nextPuff: now + Math.random(),
      // A spark leaves the hall for the new station's slot before it rises.
      spark: animate ? { start: now, mesh: kit.sphere(0.14, kit.basic(sparkColor, { additive: true }), [HALL.x, 3.2, HALL.z + 1], 10) } : null,
    };
    syncStationCloud(record, agent.cloud);
    if (record.spark) crew.add(record.spark.mesh);
    stations.set(id, record);
    return record;
  }

  // Whether this skin's carrier flies or keeps to the ground, which the
  // blips follow too. A skin's carrier says so only once built.
  function way() {
    if (!carrierWay) {
      const made = build('carrier')(kit);
      carrierWay = { route: made.route === 'ground' ? 'ground' : 'air', cruise: made.cruise ?? 3 };
      release(made.isObject3D ? made : made.object);
    }
    return carrierWay;
  }

  function makeBlips(direction, count) {
    return Array.from({ length: count }, () => {
      const blip = skin.packet ? skin.packet(kit, direction) : defaultPacket(kit, direction);
      blip.visible = false;
      crew.add(blip);
      return blip;
    });
  }

  function dropBlips(blips) {
    for (const blip of blips) {
      crew.remove(blip);
      release(blip);
    }
  }

  const tripTime = (slot, route) => clamp((routeLength(slot, route) - 3) / 12) * 1.3 + 1.5;

  // The main agent hands `record`'s agent instructions: its brief when it is
  // started, then each message sent after. One train of blips per hand-off,
  // as long as the hand-off is big.
  function sendInstructions(record, count, bytes, at) {
    if (reducedMotion || count <= 0) return;
    const { route } = way();
    const air = route !== 'ground' || !!main.cloud || record.cloud;
    const trains = Math.min(count, BURST);
    for (let index = 0; index < trains; index += 1) {
      packets.push({
        record, slot: record.slot, start: at + index * 0.5, landed: false, left: false,
        air, travel: air ? LOB : tripTime(record.slot, route),
        blips: makeBlips('down', packetBlips(bytes / count)),
      });
    }
  }

  // From the hall's door to the station: along the carrier's ground route
  // backwards, or lobbed over the floor where the carrier flies or either end
  // sits on a cloud deck.
  function animatePacket(packet) {
    const { record, slot, start, travel, blips, air } = packet;
    const to = record.root.position;
    if (!packet.left && now >= start) {
      packet.left = true;
      doorOpenUntil = Math.max(doorOpenUntil, now + 0.5);
      hall.userData.react?.('send', record);
    }
    const fromY = 1.1 + (main.cloud ? CLOUD_HALL_LIFT : 0);
    const toY = 0.9 + (record.cloud ? CLOUD_LIFT : 0);
    blips.forEach((blip, index) => {
      const t = now - start - index * BLIP_GAP;
      const u = smooth(range(t, 0, travel));
      blip.visible = t >= 0 && u < 1;
      if (!blip.visible) return;
      if (!air) {
        const point = routePoint(slot, 1 - u, 'ground');
        blip.position.set(point.x, 0.1, point.z);
        blip.rotation.y = point.heading + Math.PI;
      } else {
        blip.position.set(mix(DOOR.x, to.x, u), mix(fromY, toY, u) + Math.sin(u * Math.PI) * 2.2, mix(DOOR.z, to.z, u));
        blip.rotation.y = Math.atan2(to.x - DOOR.x, to.z - DOOR.z);
      }
    });
    if (!packet.landed && now >= start + travel) {
      packet.landed = true;
      if (stations.get(record.id) === record) {
        record.heardAt = now;
        record.model.userData.react?.('instructions', record);
        const from = outletOf(slot);
        const puffY = record.cloud ? 0.2 + CLOUD_LIFT : 0.2;
        puff(new Vector3(record.cloud ? to.x : from.x, puffY, record.cloud ? to.z : from.z), {
          color: record.cloud ? 'cloud' : 'accent', size: 0.16, life: 0.5, rise: 0.3, spread: 0.3, opacity: 0.6,
        });
      }
    }
    return now >= start + travel + (blips.length - 1) * BLIP_GAP;
  }

  // A finished job whose parent has not taken the result yet: its crate
  // comes out and waits at the station's outlet.
  function holdParcel(record, at) {
    if (record.parcel) return;
    const crate = build('crate')(kit);
    crate.scale.setScalar(0.001);
    crew.add(crate);
    record.parcel = { crate, at: reducedMotion ? -Infinity : at };
  }

  function dropParcel(record) {
    if (!record.parcel) return;
    crew.remove(record.parcel.crate);
    release(record.parcel.crate);
    record.parcel = null;
  }

  function startDelivery(record, at, bytes) {
    const parcel = record.parcel;
    if (reducedMotion) {
      dropParcel(record);
      pileCount += 1;
      record.closedAt = -Infinity;
      return;
    }
    record.parcel = null;
    const made = build('carrier')(kit);
    const carrier = made.isObject3D ? { object: made } : { ...made };
    carrier.route = carrier.route === 'ground' ? 'ground' : 'air';
    carrier.cruise ??= 3;
    carrier.hold ||= carrier.object;
    const crate = parcel?.crate || build('crate')(kit);
    if (!parcel) {
      crate.scale.setScalar(0.001);
      crew.add(crate);
    }
    carrier.object.scale.setScalar(0.001);
    crew.add(carrier.object);
    deliveries.push({
      // A crate that was already waiting outside skips the pop.
      record, slot: record.slot, start: parcel ? at - POP * 0.6 : at, waited: !!parcel,
      travel: tripTime(record.slot, carrier.route), carrier, crate, landed: false,
      blips: makeBlips('up', bytes > 0 ? packetBlips(bytes) : 0),
    });
  }

  // A station leaves the floor: it sinks out of sight. One that made way for
  // a newer station is `gone`, so the floor plan does not stand it up again.
  function retire(record, immediately, madeWay = false) {
    record.sinkAt = immediately || reducedMotion ? -Infinity : now;
    if (madeWay) gone.add(record.id);
    dropParcel(record);
    stations.delete(record.id);
    leaving.add(record);
  }

  // A weathered copy of one of a station's materials: greyed towards the
  // palette's `dust`, its glow out and its haze thinned, the more so for an
  // older `stage` (0 to 2). One copy per material and stage, shared by every
  // derelict and freed with the kit's materials.
  function weathered(material, stage) {
    if (Array.isArray(material)) return material.map(each => weathered(each, stage));
    const key = `weathered:${stage}:${material.uuid}`;
    let made = kit.materials.get(key);
    if (made) return made;
    made = material.clone();
    if (made.color) {
      const { saturation, light, dust } = WEATHER_STAGES[stage];
      const hsl = made.color.getHSL({});
      made.color.setHSL(hsl.h, hsl.s * saturation, hsl.l * (made.map ? (1 + light) / 2 : light)).lerp(palette.dust, made.map ? dust * 0.7 : dust);
    }
    if (made.emissive) made.emissiveIntensity *= 0.06;
    if (made.blending === AdditiveBlending || (made.transparent && made.opacity < 0.8)) made.opacity *= 0.3;
    kit.materials.set(key, made);
    return made;
  }

  // A closed station is decommissioned where it stands: its skin stops
  // moving it, its occupants leave in a puff of dust, its lights flicker out
  // to weathered copies, it slumps and its
  // cordon goes up (all at once when `settled`, as on a floor that opens on
  // it). Its agent stays in the feed and its slot stays taken until a newer
  // station needs it.
  function decommission(record, settled = false) {
    retired.add(record.id);
    record.closedAt = null;
    record.offAt = settled || reducedMotion ? -Infinity : now;
    record.height = record.model.scale.y;
    const ruin = skin.ruin === false ? null : build('ruin')(kit, record.kind === 'worker' ? 'worker' : 'subagent', record.spot);
    if (ruin) {
      ruin.scale.y = record.offAt === -Infinity ? 1 : 0.001;
      record.root.add(ruin);
    }
    const turn = Math.sin(record.slot * 12.9898 + 4.1) * 43758.5453;
    const lean = (turn - Math.floor(turn)) * Math.PI * 2;
    record.derelict = {
      swaps: null, look: -1, ruin, rotation: record.model.rotation.clone(),
      lean: { x: Math.cos(lean) * LEAN, z: Math.sin(lean) * LEAN },
      occupants: (record.model.userData.occupants || []).map(part => ({ part, scale: part.scale.clone(), visible: part.visible })),
    };
    if (record.offAt === -Infinity) return;
    for (const { part, visible } of record.derelict.occupants) {
      if (visible) puff(part.getWorldPosition(new Vector3()).setY(0.3), { color: 'dust', size: 0.2, life: 0.8, rise: 0.6, spread: 0.6, opacity: 0.45 });
    }
    record.model.userData.react?.('decommission', record);
  }

  // An agent working again gets its station back as it was.
  function recommission(record) {
    const { derelict } = record;
    if (!derelict) return;
    for (const [mesh, live] of derelict.swaps || []) mesh.material = live;
    for (const { part, scale, visible } of derelict.occupants) {
      part.scale.copy(scale);
      part.visible = visible;
    }
    if (derelict.ruin) {
      record.root.remove(derelict.ruin);
      release(derelict.ruin);
    }
    record.model.rotation.copy(derelict.rotation);
    record.model.scale.y = record.height;
    record.derelict = null;
    record.offAt = null;
    record.weathered = 0;
  }

  // What an agent's state means for a station that has just been stood up or
  // has just changed. `at` is when it shows on the frame clock, -Infinity for
  // a state the floor opened on.
  function settle(record, agent, from, at) {
    const settled = at === -Infinity;
    record.closedAt = null;
    if (agent.state !== 'ready' && agent.state !== 'done') dropParcel(record);
    if (agent.state === 'ready') {
      record.doneAt = at;
      holdParcel(record, at);
    } else if (agent.state === 'done') {
      if (from !== 'ready') record.doneAt = at;
      if (settled) {
        pileCount += 1;
        record.closedAt = -Infinity;
      } else if (!FINISHED.has(from)) startDelivery(record, at, agent.returned?.bytes);
      else record.closedAt = at;
    } else if (agent.state === 'failed') record.failedAt = at;
    else if (agent.state === 'stopped') record.closedAt = at;
  }

  // The advisor rises in beside the hall when the main agent asks it.
  function summonAdvisor(initial) {
    if (advisor) {
      // Asked again before it had gone: it stays and reads on, and the
      // answer's light still on its way goes out.
      advisor.leaveAt = null;
      advisor.left = false;
      advisor.reading = true;
      dropLight();
      return;
    }
    const model = build('advisor')(kit);
    const root = new Group();
    root.position.set(advisorSpot.x, 0, advisorSpot.z);
    root.rotation.y = advisorSpot.yaw ?? 0;
    root.userData.agentId = 'advisor';
    root.add(model);
    crew.add(root);
    const still = initial || reducedMotion;
    advisor = {
      root, model, reading: true, activity: still ? 1 : 0, arrivedAt: still ? -Infinity : now,
      leaveAt: null, light: null, nextPage: now + 0.35,
    };
    if (still) return;
    model.userData.react?.('arrive', advisor);
    for (let index = 0; index < 5; index += 1) {
      puff(root.position.clone().setY(0.3), { color: 'glow', size: 0.26, life: 1.1, rise: 0.6, spread: 0.9, opacity: 0.45 });
    }
  }

  // Its answer goes back to the hall as a light, and then it leaves. An ask
  // that came to nothing just ends.
  function dismissAdvisor(initial, answered) {
    if (!advisor || !advisor.reading) return;
    advisor.reading = false;
    if (initial || reducedMotion) {
      removeAdvisor();
      return;
    }
    advisor.model.userData.react?.(answered ? 'answer' : 'leave', advisor);
    if (answered) {
      const mesh = kit.sphere(0.17, kit.basic('glow', { additive: true }), [0, -10, 0], 12);
      crew.add(mesh);
      advisor.light = { start: now, mesh };
    }
    advisor.leaveAt = now + (answered ? ADVISOR_LIGHT : 0) + 0.25;
  }

  function dropLight() {
    if (!advisor?.light) return;
    crew.remove(advisor.light.mesh);
    release(advisor.light.mesh);
    advisor.light = null;
  }

  function removeAdvisor() {
    if (!advisor) return;
    dropLight();
    crew.remove(advisor.root);
    release(advisor.root);
    advisor = null;
  }

  // Where the hall's pages leave from and the advisor's light comes home to.
  const hallSide = () => new Vector3(HALL.x + advisorSpot.x * 0.34, 2.3 + (main.cloud ? CLOUD_HALL_LIFT : 0), HALL.z + 0.9);
  const advisorDesk = () => advisor.root.localToWorld((advisor.model.userData.page || new Vector3(0, 1.1, 0.4)).clone());

  function sendPage() {
    let page = pages.find(entry => !entry.mesh.visible);
    if (!page) {
      if (pages.length >= PAGES_MAX) return;
      const material = new MeshBasicMaterial({ color: kit.color(skin.pageColor || '#f6f1e4'), transparent: true, side: DoubleSide, depthWrite: false });
      page = { mesh: new Mesh(new PlaneGeometry(0.2, 0.26), material) };
      crew.add(page.mesh);
      pages.push(page);
    }
    Object.assign(page, {
      start: now, from: hallSide().add(new Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.3, 0)),
      lift: 0.7 + Math.random() * 0.6, spin: new Vector3(4 + Math.random() * 4, 2 + Math.random() * 3, 3 + Math.random() * 4),
    });
    page.mesh.visible = true;
  }

  function animateAdvisor(dt) {
    for (const page of pages) {
      if (!page.mesh.visible) continue;
      const t = (now - page.start) / PAGE_FLIGHT;
      if (t >= 1 || t < 0 || !advisor) {
        page.mesh.visible = false;
        continue;
      }
      const u = smooth(t);
      const to = advisorDesk();
      page.mesh.position.lerpVectors(page.from, to, u);
      page.mesh.position.y += Math.sin(u * Math.PI) * page.lift + Math.sin(now * 5 + page.spin.x) * 0.05 * (1 - u);
      page.mesh.rotation.set(page.spin.x * t + 1.2, page.spin.y * t, Math.sin(now * page.spin.z) * 0.7);
      page.mesh.scale.setScalar(1 - range(t, 0.82, 1) * 0.7);
      page.mesh.material.opacity = Math.min(1, t * 8) * (1 - range(t, 0.86, 1));
    }
    if (!advisor) return;
    const { root, model } = advisor;
    advisor.activity += ((advisor.reading ? 1 : 0) - advisor.activity) * (1 - Math.exp(-dt * 3));
    const arrive = advisor.arrivedAt === -Infinity ? 1 : range(now - advisor.arrivedAt, 0, ADVISOR_ARRIVE);
    const leave = advisor.leaveAt === null ? 0 : range(now - advisor.leaveAt, 0, ADVISOR_LEAVE);
    if (leave >= 1) {
      removeAdvisor();
      return;
    }
    root.scale.setScalar(Math.max(0.001, back(arrive, 1.2) * (1 - smooth(leave))));
    if (!painter) root.position.y = (smooth(leave) - (1 - smooth(arrive))) * 0.5;
    if (leave > 0 && !advisor.left) {
      advisor.left = true;
      for (let index = 0; index < 4; index += 1) {
        puff(root.position.clone().setY(0.6), { size: 0.24, life: 1, rise: 0.8, spread: 0.7, opacity: 0.4 });
      }
    }
    // With reduced motion it is posed once and then stands still.
    if (!reducedMotion || !advisor.posed) model.userData.frame?.(now, dt, advisor);
    advisor.posed = true;
    if (advisor.reading && !reducedMotion && arrive >= 1 && now >= advisor.nextPage) {
      sendPage();
      advisor.nextPage = now + PAGE_EVERY * (0.7 + Math.random() * 0.6);
    }
    const light = advisor.light;
    if (light) {
      const t = range(now - light.start, 0, ADVISOR_LIGHT);
      const from = advisorDesk();
      const to = hallSide();
      light.mesh.position.lerpVectors(from, to, smooth(t));
      light.mesh.position.y += Math.sin(t * Math.PI) * 1.4;
      light.mesh.scale.setScalar(1 + Math.sin(now * 14) * 0.12);
      if (t >= 1) {
        dropLight();
        hallPulse = now;
        hall.userData.react?.('advice', advisor);
        puff(to, { color: 'glow', size: 0.2, life: 0.7, rise: 0.4, spread: 0.4, opacity: 0.6 });
      }
    }
  }

  function setMain(agent) {
    main = agent || { state: 'idle' };
    if (!trip && main.state !== 'done' && restoreLights) {
      restoreLights();
      restoreLights = null;
    }
  }

  function dim() {
    const target = main.state === 'done' ? 1 : 0;
    return trip ? mix(trip.leftDim, target, tripMood(trip.remaining)) : target;
  }

  function apply(snapshot, initial) {
    setMain(snapshot.main);
    if (snapshot.advisor?.state === 'reading') summonAdvisor(initial);
    else dismissAdvisor(initial, snapshot.advisor?.asks?.at(-1)?.status === 'answered');
    const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
    const byId = new Map(agents.map(agent => [agent.id, agent]));
    // An agent that is working again gets its station back.
    for (const id of reopened(retired, gone, agents)) {
      const record = stations.get(id);
      if (record) recommission(record);
    }
    // The floor opens with the stations that closed a while ago already
    // decommissioned, and those first to make way for newcomers. Those
    // there is no room for are delivered and decommissioned without one.
    let stale = new Set();
    if (initial) {
      const opening = openingFloor(agents, Date.now() - DWELL * 1000);
      stale = opening.stale;
      for (const id of opening.gone) {
        gone.add(id);
        retired.add(id);
        if (byId.get(id).state === 'done') pileCount += 1;
      }
    }
    kit.traffic.progress = agents.length ? agents.filter(agent => CLOSED.has(agent.state)).length / agents.length : 0;
    const plan = planFloor(floor, agents, gone, stale.size ? new Set([...retired, ...stale]) : retired, slotOrder);
    floor = plan.floor;
    waiting = plan.waiting;
    const still = initial || reducedMotion;
    for (const event of plan.events) {
      const record = stations.get(event.id);
      const agent = byId.get(event.id);
      if (event.type === 'spawn') {
        const made = makeStation(event.id, agent, event.slot, initial);
        settle(made, agent, null, still ? -Infinity : made.born + RISE);
        if (stale.has(event.id)) decommission(made, true);
        if (still) continue;
        hall.userData.react?.('spawn', made);
        sendInstructions(made, 1, agent.sent?.bytes / (agent.sent?.packets || 1), now + 0.2);
      } else if (event.type === 'state' && record) {
        record.state = shown(event.to);
        if (initial) {
          if (record.state === 'done') record.doneAt = -Infinity;
          continue;
        }
        settle(record, agent, event.from, now);
        if (!reducedMotion && record.state !== shown(event.from)) record.model.userData.react?.(record.state, record);
        if (event.to === 'failed' && record.model.userData.puff !== false) {
          const top = record.root.position.clone().setY(1.2 + (record.cloud ? CLOUD_LIFT : 0));
          for (let index = 0; index < 6; index += 1) puff(top, { size: 0.3, life: 2, opacity: 0.65, spread: 0.6 });
        }
        if (event.to === 'running' && event.from === 'queued' && !reducedMotion) record.born = now;
      } else if ((event.type === 'retire' || event.type === 'remove') && record) {
        retire(record, initial, event.type === 'retire');
      }
    }
    for (const [id, record] of stations) {
      const agent = byId.get(id);
      if (!agent) continue;
      record.state = shown(agent.state);
      record.kind = agent.kind;
      record.endedAt = Number.isFinite(agent.endedAt) ? agent.endedAt : null;
      syncStationCloud(record, agent.cloud);
      const sent = agent.sent?.packets || 0;
      if (sent > record.sent) sendInstructions(record, sent - record.sent, (agent.sent.bytes || 0) - record.sentBytes, now);
      record.sent = sent;
      record.sentBytes = agent.sent?.bytes || 0;
    }
  }

  const rootOf = id => {
    const root = id === 'main' ? hall : id === 'advisor' ? advisor?.root : stations.get(id)?.root;
    return root?.visible ? root : null;
  };

  // Aims the raycaster through a pointer. The camera's matrices are the last
  // frame's, which is the frame `pan.offset` was last applied to.
  function aim(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    raycaster.setFromCamera(pointerPoint.set((clientX - box.left) / box.width * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1), camera);
    return true;
  }

  const pickTargets = () => [hall, ...(advisor ? [advisor.root] : []), ...[...stations.values()].map(record => record.root)];

  // Where the ray under a pointer crosses the level `height` above the ground.
  function levelAt(clientX, clientY, height, out) {
    if (!aim(clientX, clientY)) return false;
    const { origin, direction } = raycaster.ray;
    if (direction.y > -0.01) return false;
    out.copy(origin).addScaledVector(direction, (height - origin.y) / direction.y);
    return true;
  }

  // Held, the grabbed ground stays under the pointer. Let go, the view glides
  // on and slows; a new focus brings it home. The looked-at point stays within
  // the used floor (`limitX` either side, `minZ` to `maxZ`).
  function movePan(dt, limitX, minZ, maxZ) {
    if (pan.grab) {
      if (levelAt(pan.pointer.x, pan.pointer.y, pan.grab.y, panHit)) {
        panStep.subVectors(pan.grab, panHit).setY(0);
        pan.offset.add(panStep);
        if (dt > 0) pan.velocity.lerp(panStep.divideScalar(dt), 0.4);
      }
    } else if (pan.homing) {
      pan.offset.multiplyScalar(reducedMotion ? 0 : Math.exp(-dt * 4.5));
      if (pan.offset.lengthSq() < 1e-4) {
        pan.offset.set(0, 0, 0);
        pan.homing = false;
      }
      return;
    } else if (pan.velocity.lengthSq() > 1e-4) {
      pan.offset.addScaledVector(pan.velocity, dt);
      pan.velocity.multiplyScalar(Math.exp(-dt * 5.5));
    }
    const x = Math.min(Math.max(view.target.x + pan.offset.x, -limitX), limitX) - view.target.x;
    const z = Math.min(Math.max(view.target.z + pan.offset.z, minZ), maxZ) - view.target.z;
    if (x !== pan.offset.x) pan.velocity.x = 0;
    if (z !== pan.offset.z) pan.velocity.z = 0;
    pan.offset.set(x, 0, z);
  }

  // Scaling the camera's whole rig about the anchor keeps the anchor where it
  // is on screen, so the looked-at point moves toward or away from it. On a
  // painted floor the window is scaled about it instead, round `base`.
  function moveZoom(dt, base = null) {
    const gap = zoom.goal - zoom.scale;
    if (!gap) return;
    const next = reducedMotion || Math.abs(gap) < 1e-3 ? zoom.goal : zoom.scale + gap * (1 - Math.exp(-dt * 14));
    if (zoom.anchor) {
      const shift = next / zoom.scale - 1;
      if (base) {
        pan.offset.x += (base.x + pan.offset.x - zoom.anchor.x) * shift;
        pan.offset.y += (base.y + pan.offset.y - zoom.anchor.y) * shift;
      } else {
        pan.offset.x += (view.target.x + pan.offset.x - zoom.anchor.x) * shift;
        pan.offset.z += (view.target.z + pan.offset.z - zoom.anchor.z) * shift;
      }
    }
    zoom.scale = next;
  }

  // Sends the view back to where the framing puts it.
  function home() {
    pan.grab = null;
    pan.velocity.set(0, 0, 0);
    pan.homing = true;
    zoom.goal = 1;
    zoom.anchor = null;
  }

  // Where a client point falls on a painted floor's painting, through the
  // window last shown; null without a point.
  function paintingPoint(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    const shown = win.shown;
    if (clientX === undefined || !shown || !box.width || !box.height) return null;
    return {
      x: shown.x + ((clientX - box.left) / box.width - 0.5) * shown.w,
      y: shown.y + ((clientY - box.top) / box.height - 0.5) * shown.w * box.height / box.width,
    };
  }

  // The painting round what is drawn of `object`, in frame pixels: a point's
  // worth when nothing of it is.
  const corner = new Vector3();
  function paintedBox(object) {
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    object.updateWorldMatrix(true, true);
    object.traverseVisible(node => {
      if (!node.isMesh || !node.geometry) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const { min, max } = node.geometry.boundingBox;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        const at = corner.set(x, y, z).applyMatrix4(node.matrixWorld);
        const { x: px, y: py } = painter.frame(at.x, at.y, at.z);
        box.left = Math.min(box.left, px);
        box.top = Math.min(box.top, py);
        box.right = Math.max(box.right, px);
        box.bottom = Math.max(box.bottom, py);
      }
    });
    if (box.left === Infinity) {
      const at = object.getWorldPosition(corner);
      const { x, y } = painter.frame(at.x, at.y, at.z);
      return { left: x, top: y, right: x, bottom: y };
    }
    return box;
  }

  // The painting round the hall and every station on the floor, with room
  // above them for their labels: a painted floor's framing when its skin
  // gives none.
  function floorBox() {
    const boxes = [hall, ...[...stations.values()].map(record => record.root)].filter(root => root.visible).map(paintedBox);
    const box = boxes.reduce((all, one) => ({
      left: Math.min(all.left, one.left), top: Math.min(all.top, one.top),
      right: Math.max(all.right, one.right), bottom: Math.max(all.bottom, one.bottom),
    }));
    const pad = (box.bottom - box.top) * 0.06;
    return { left: box.left - pad, top: box.top - pad * 2.5, right: box.right + pad, bottom: box.bottom + pad };
  }

  // A painted floor's drag: the painting under the pointer stays under it,
  // `perPixel` painting pixels to a CSS pixel. Let go, the window glides on
  // and slows; a new focus brings it home.
  function movePaintedPan(dt, perPixel) {
    if (pan.grab) {
      panStep.set((pan.grab.x - pan.pointer.x) * perPixel, (pan.grab.y - pan.pointer.y) * perPixel, 0);
      pan.grab.set(pan.pointer.x, pan.pointer.y, 0);
      pan.offset.add(panStep);
      if (dt > 0) pan.velocity.lerp(panStep.divideScalar(dt), 0.4);
    } else if (pan.homing) {
      pan.offset.multiplyScalar(reducedMotion ? 0 : Math.exp(-dt * 4.5));
      if (pan.offset.lengthSq() < 0.25) {
        pan.offset.set(0, 0, 0);
        pan.homing = false;
      }
    } else if (pan.velocity.lengthSq() > 1) {
      pan.offset.addScaledVector(pan.velocity, dt);
      pan.velocity.multiplyScalar(Math.exp(-dt * 5.5));
    }
  }

  function showWindow(shown) {
    const height = shown.w * win.height / win.width;
    camera.setViewOffset(painter.width, painter.height, shown.x - shown.w / 2, shown.y - height / 2, shown.w, height);
  }

  // The view of a painted floor. The framing fits a window on the painting
  // round the used floor (the skin's `overview` box for it, or the hall and
  // every station), or brings it in on the focused one, framed a little above
  // the middle, clear of the ticket over the foot of the floor. A pan and a
  // zoom move away from that window, and a trip slides it in from where the
  // town left was framed. Every window stays on the art and no narrower than
  // `painting.sharp` painting pixels to a CSS pixel, so the painting is never
  // blown up past that.
  function placePainting(dt) {
    const aspect = win.width / win.height;
    const { art } = painting;
    const least = win.width * (painting.sharp ?? 0.5);
    let goal = fitWindow(painting.overview?.(framing(floor)) || floorBox(), aspect, art, least);
    const close = rootOf(focused);
    if (close) {
      const around = paintedBox(close);
      const w = Math.max(goal.w * (close === hall ? 0.82 : 0.5), (around.right - around.left) * 2.4, least);
      goal = holdWindow({ x: (around.left + around.right) / 2, y: (around.top + around.bottom) / 2 + w / aspect * 0.14, w }, aspect, art, least);
    }
    if (!win.base || reducedMotion) win.base = { ...goal };
    else {
      const ease = 1 - Math.exp(-dt * 2.2);
      win.base = { x: mix(win.base.x, goal.x, ease), y: mix(win.base.y, goal.y, ease), w: mix(win.base.w, goal.w, ease) };
    }
    const { base } = win;
    zoom.near = Math.min(1, least / base.w);
    zoom.far = Math.max(1, Math.min(ZOOM_FAR, widestWindow(aspect, art) / base.w));
    zoom.goal = between(zoom.goal, zoom.near, zoom.far);
    moveZoom(dt, base);
    const wanted = { x: base.x + pan.offset.x, y: base.y + pan.offset.y, w: base.w * zoom.scale };
    if (trip) {
      const left = tripLeft(now - trip.start);
      trip.remaining = left;
      win.shown = tripWindow(trip.from, wanted, left, aspect, art, TRIP_LIFT, trip.shiftPx);
      if (!left) endTrip();
    } else {
      movePaintedPan(dt, wanted.w / win.width);
      wanted.x = base.x + pan.offset.x;
      wanted.y = base.y + pan.offset.y;
      win.shown = holdWindow(wanted, aspect, art, least);
      // What the art holds back of a drag or a glide is dropped, so the view
      // never winds up past its edge.
      if (win.shown.x !== wanted.x) pan.velocity.x = 0;
      if (win.shown.y !== wanted.y) pan.velocity.y = 0;
      pan.offset.set(win.shown.x - base.x, win.shown.y - base.y, 0);
    }
    showWindow(win.shown);
  }

  // Fits the hall and every used row: wide enough for the outer stations and
  // their labels, tall enough for the hall's roofline down to the front row.
  function placeCamera(dt) {
    if (painter) {
      placePainting(dt);
      return;
    }
    const floorBounds = framing(floor);
    const { front } = floorBounds;
    // The advisor beside the hall stays in frame on a small floor.
    const reach = Math.max(floorBounds.reach, advisor ? Math.abs(advisorSpot.x) - 1.2 : 0);
    const aspect = camera.aspect || 1.5;
    const slope = Math.tan((camera.fov * Math.PI) / 360);
    const backZ = HALL.z - 1.9;
    const sidePad = aspect < 1 ? 1.55 : 2.35;
    const hallLift = main.cloud ? CLOUD_HALL_LIFT : 0;
    const depth = (front + 1.25 - backZ) * Math.sin(elevation) + (4.3 + hallLift) * Math.cos(elevation);
    let goal = Math.max((reach + sidePad) / (slope * aspect * Math.cos(azimuth)), (depth / 2 + 0.85) / slope, 11.2);
    view.goalTarget.set(0, 1.0 + hallLift * 0.35, (front + 1.15 + backZ) / 2 + 0.35);
    const overview = skin.view?.overview?.(aspect, floorBounds);
    if (overview) {
      goal = overview.distance;
      view.goalTarget.copy(overview.target);
    }
    // A focused station is framed above the centre, clear of the ticket the
    // tab lays over the foot of the floor.
    const close = rootOf(focused);
    if (close) {
      const isHall = close === hall;
      const isCloud = isHall ? !!main.cloud : !!stations.get(focused)?.cloud;
      goal = Math.max(goal * (isHall ? 0.82 : 0.5), isHall ? (isCloud ? 11.3 : 10.5) : (isCloud ? 7.8 : 7.2));
      const focusY = (isHall ? 1.7 : 0.7) + (isCloud ? (isHall ? CLOUD_HALL_LIFT * 0.72 : CLOUD_LIFT * 0.72) : 0);
      view.goalTarget.set(close.position.x, focusY, close.position.z + (isHall ? 1.6 : aspect < 1 ? 1.9 : 0.75));
    }
    if (view.distance === null || reducedMotion) {
      view.distance = goal;
      view.target.copy(view.goalTarget);
    } else {
      const ease = 1 - Math.exp(-dt * 2.2);
      view.distance += (goal - view.distance) * ease;
      view.target.lerp(view.goalTarget, ease);
    }
    moveZoom(dt);
    // A trip carries the view over the ground between two towns and pulls
    // back on the way. The bounds that hold a drag do not hold it.
    let lift = 1;
    if (trip) {
      const left = tripLeft(now - trip.start);
      trip.remaining = left;
      pan.offset.copy(trip.from).multiplyScalar(left);
      lift += Math.sin(left * Math.PI) * TRIP_LIFT;
      if (!left) endTrip();
    } else movePan(dt, reach + 3, backZ - 1, front + 2);
    const lookX = view.target.x + pan.offset.x;
    const lookZ = view.target.z + pan.offset.z;
    const distance = view.distance * zoom.scale * lift;
    const swing = azimuth + (reducedMotion ? 0 : Math.sin(now * 0.22) * (skin.view?.sway ?? 0.042) * (1 - dim()));
    camera.position.set(
      lookX + Math.sin(swing) * Math.cos(elevation) * distance,
      view.target.y + Math.sin(elevation) * distance,
      lookZ + Math.cos(swing) * Math.cos(elevation) * distance,
    );
    camera.lookAt(lookX, view.target.y, lookZ);
    // Offset fog from live camera distance so zooming out on dense floors never fogs active stations.
    scene.fog.near = distance + palette.fogNear;
    scene.fog.far = distance + palette.fogNear + palette.fogSpan;
  }

  function endTrip() {
    if (!trip) return;
    scene.remove(trip.left);
    release(trip.left);
    trip.own.forEach(material => material.dispose());
    trip = null;
  }

  function animateStation(record, dt) {
    const { root, deck, model, ghost } = record;
    const queued = record.state === 'queued';
    // Decommissioned, a station's scaffold flickers over it as its lights go
    // out, and it slumps. `since` is how long ago that began, Infinity for one
    // the floor opened on.
    const off = record.offAt !== null;
    const since = off ? now - record.offAt : 0;
    const fold = off ? smooth(range(since, POWER_DOWN, POWER_DOWN + FOLD)) : 0;
    ghost.visible = off ? !reducedMotion && since < FLICKER && Math.sin(now * 34) > 0.2 : queued && record.sinkAt === null;
    if (ghost.visible && !reducedMotion && !off && !painter) ghost.scale.y = 0.94 + Math.sin(now * 3.4 + record.slot) * 0.06;
    model.visible = !queued;
    let y = 0;
    if (record.born > now) y = -2.2;
    else if (record.born > -Infinity) y = mix(-2.2, 0, back(range(now, record.born, record.born + RISE)));
    if (record.sinkAt !== null) y = record.sinkAt === -Infinity ? -3 : mix(y, -2.4, smooth(range(now, record.sinkAt, record.sinkAt + SINK)));
    root.rotation.z = record.failedAt > -Infinity && !reducedMotion && !painter ? wobble(now, record.failedAt, 22, 3) * 0.12 : 0;
    root.position.y = y;
    root.visible = y > -2.3;
    const finished = main.state === 'done';
    const running = record.state === 'running' && !reducedMotion && !off && !finished;
    record.activity += ((running ? 1 : 0) - record.activity) * (1 - Math.exp(-dt * 3));
    if (record.cloud && record.cloudRig) {
      const emerge = clamp(1 + y / 2.2);
      deck.position.y = record.cloudRig.frame(now, dt, record.activity, reducedMotion || finished, { emerge, fold });
      record.cloudRig.ground.position.y = -y;
    } else {
      deck.position.y = 0;
    }
    const lift = record.cloud ? CLOUD_LIFT : 0;
    if (record.spark) {
      const { start, mesh } = record.spark;
      const t = range(now, start, start + 0.55);
      const to = root.position;
      const startY = 3.2 + (main.cloud ? CLOUD_HALL_LIFT : 0);
      mesh.position.set(mix(HALL.x, to.x, t), mix(startY, 0.6 + lift, t) + Math.sin(t * Math.PI) * 2.4, mix(HALL.z + 1, to.z, t));
      if (t >= 1) {
        crew.remove(mesh);
        release(mesh);
        record.spark = null;
        puff(new Vector3(to.x, 0.15 + lift, to.z), {
          color: record.cloud ? 'cloud' : 'line', size: 0.3, life: 0.8, rise: 0.4, spread: 1.6, opacity: 0.45,
        });
      }
    }
    if (record.parcel) {
      const { crate, at } = record.parcel;
      const out = outletOf(record.slot);
      const pop = at === -Infinity ? 1 : range(now, at, at + POP);
      const hop = pop >= 1 && !reducedMotion ? Math.abs(Math.sin(now * 2.4 + record.slot)) * 0.07 : 0;
      crate.visible = root.visible && pop > 0;
      crate.scale.setScalar(Math.max(0.001, back(pop, 2.2)));
      crate.position.set(
        mix(root.position.x, out.x, smooth(pop)),
        mix(0.24 + lift, 0.24, smooth(pop)) + Math.sin(pop * Math.PI) * 0.6 + hop,
        mix(root.position.z, out.z, smooth(pop)),
      );
    }
    // Its machinery winds down as its activity ebbs. The skin's own frame
    // stops where it was: skins set their parts' materials as they go, which
    // would undo the weathering.
    if (!finished) {
      for (const [part, axis, speed] of record.spin) part.rotation[axis] += speed * dt * record.activity;
      for (const [part, axis, amount, speed] of record.swing) part.rotation[axis] = Math.sin(now * speed) * amount * record.activity;
      if (!off) model.userData.frame?.(now, dt, record);
    }
    if (off) animateDerelict(record, since, fold, dt);
    if (record.lamp) {
      const material = record.lamp.material;
      const tone = kit.color(off && since >= POWER_DOWN ? 'idle' : STATE_COLOR[record.state] || 'idle');
      material.color.copy(tone);
      material.emissive.copy(tone);
      const blink = record.state === 'running' && !reducedMotion ? 0.55 + 0.45 * Math.sin(now * 6) : 1;
      // It flares as instructions arrive and goes dark as the station is decommissioned.
      const heard = reducedMotion ? 0 : 1 - range(now, record.heardAt, record.heardAt + 0.6);
      const power = finished || record.offAt === -Infinity ? 0 : off ? 1 - range(now, record.offAt, record.offAt + POWER_DOWN) : 1;
      material.emissiveIntensity = ((record.state === 'stopped' || record.state === 'unknown' || queued ? 0.18 : 1.15) * blink + heard * 2.4) * power;
    }
    if (!finished && !off && !reducedMotion && y > -0.1 && now >= record.nextPuff) {
      const local = model.userData.puff;
      if (record.state === 'running' && local) {
        puff(model.localToWorld(local.clone()), { size: 0.12, life: 1.2, rise: 0.8, opacity: 0.34 });
        record.nextPuff = now + 0.9 + Math.random() * 0.6;
      } else if (record.state === 'failed' && local !== false) {
        puff(root.position.clone().setY(1.1 + lift), { size: 0.22, life: 2.2, rise: 1, opacity: 0.48 });
        record.nextPuff = now + 2.4 + Math.random();
      } else record.nextPuff = now + 1;
    }
  }

  // A decommissioned station from `since` seconds after its power-down began.
  function animateDerelict(record, since, fold, dt) {
    const { model, derelict } = record;
    // The materials it wears now are the ones it is weathered from. A floor
    // that opens on it first shows it as its skin draws it finished. A
    // painting keeps its own colours: its skin paints it closed instead.
    if (!derelict.swaps) {
      if (since === Infinity) model.userData.frame?.(now, 0, record);
      derelict.swaps = [];
      const lamp = record.lamp?.material;
      // Its occupants leave as they were, unweathered.
      const away = new Set();
      for (const { part } of derelict.occupants) part.traverse(mesh => away.add(mesh));
      for (const part of painter ? [] : [model, record.pad, record.cloudRig?.bank]) {
        part?.traverse(mesh => {
          if (!mesh.isMesh || !mesh.material || mesh === record.lamp || mesh.material === lamp || away.has(mesh)) return;
          derelict.swaps.push([mesh, mesh.material]);
        });
      }
    }
    // Its occupants shrink away as its lights go, and it stands empty.
    const vacated = reducedMotion ? 1 : smooth(range(since, 0, VACATE));
    for (const { part, scale, visible } of derelict.occupants) {
      part.visible = visible && vacated < 1;
      part.scale.copy(scale).multiplyScalar(Math.max(0.001, 1 - vacated));
    }
    const minutes = record.endedAt !== null && record.endedAt !== undefined ? (Date.now() - record.endedAt) / 60000 : null;
    const age = minutes === null ? UNKNOWN_WEATHER : weathering(minutes);
    // Its lights stutter, dark more of the time as the flicker runs on, and
    // it wears the weathering of its age.
    const flicker = range(since, 0, FLICKER);
    const dark = flicker >= 1 || reducedMotion || Math.sin(now * 53) * 0.5 + 0.5 < flicker;
    const look = dark ? weatherStage(age) : -1;
    if (look !== derelict.look) {
      for (const [mesh, live] of derelict.swaps) mesh.material = look < 0 ? live : weathered(live, look);
      derelict.look = look;
    }
    // It leans further the longer it stands, unless it is a painting.
    if (!painter) {
      const lean = fold * (0.5 + age * 0.7);
      model.scale.y = record.height * (1 - SLUMP * fold);
      model.rotation.x = derelict.rotation.x + derelict.lean.x * lean;
      model.rotation.z = derelict.rotation.z + derelict.lean.z * lean;
    }
    const cordon = POWER_DOWN + FOLD;
    record.weathered = age * smooth(range(since, cordon + CORDON * 0.5, cordon + CORDON * 0.5 + GROW));
    if (derelict.ruin) {
      derelict.ruin.scale.y = Math.max(0.001, since === Infinity ? 1 : back(range(since, cordon, cordon + CORDON)));
      derelict.ruin.userData.frame?.(now, dt, record);
    }
    if (!reducedMotion && now >= record.nextPuff && fold > 0 && fold < 1) {
      const lift = record.cloud ? CLOUD_LIFT : 0;
      puff(record.root.position.clone().setY(0.2 + lift * (1 - fold)), { color: 'dust', size: 0.24, life: 0.9, rise: 0.5, spread: 1.5, opacity: 0.4 });
      record.nextPuff = now + 0.16;
    }
  }

  // A finished job's trip, in the phases timed above: the crate pops out, the
  // skin's carrier appears and takes it home, and the crate joins the pile as
  // it lands.
  function animateDelivery(delivery) {
    const { record, carrier, crate, start, travel, slot, blips } = delivery;
    const { object, hold, route, cruise } = carrier;
    const t = now - start;
    const { side } = slotPosition(slot);
    const from = outletOf(slot);
    const outlet = new Vector3(from.x, 0.24, from.z);
    const summonEnd = POP + SUMMON;
    const liftEnd = summonEnd + LIFT;
    const travelEnd = liftEnd + travel;
    const dropEnd = travelEnd + DROP;
    const leaveEnd = dropEnd + LEAVE;
    const air = route === 'air';
    const first = routePoint(slot, 0, route, cruise);
    // Where the hall takes this crate when that is not its door.
    const intake = hall.userData.intake ? hallBase.localToWorld(hall.userData.intake.clone()) : null;
    const flown = air ? intake : null;
    let phase = 'summon';
    let speed = 0;
    if (t >= POP * 0.6) object.scale.setScalar(Math.max(0.001, back(range(t, POP * 0.6, summonEnd))));
    if (t < liftEnd) {
      const lift = smooth(range(t, summonEnd, liftEnd));
      const appear = new Vector3(outlet.x - (air ? 0 : side * 0.45), air ? HOVER + 0.3 : 0, outlet.z);
      object.position.set(mix(appear.x, first.x, lift), mix(appear.y, first.y, lift), mix(appear.z, first.z, lift));
      object.rotation.y = first.heading;
      phase = t < summonEnd ? 'summon' : 'lift';
    } else if (t < travelEnd) {
      const travelled = smooth(range(t, liftEnd, travelEnd));
      const point = towardIntake(routePoint(slot, travelled, route, cruise), flown, travelled);
      object.position.set(point.x, point.y, point.z);
      object.rotation.y = point.heading;
      speed = Math.sin(range(t, liftEnd, travelEnd) * Math.PI);
      phase = 'travel';
    } else {
      const end = towardIntake(routePoint(slot, 1, route, cruise), flown, 1);
      const leave = smooth(range(t, dropEnd, leaveEnd));
      object.position.set(end.x, end.y + (air ? leave * 1.6 : 0), end.z - (air ? 0 : leave * 1.2));
      object.rotation.y = end.heading;
      if (t >= dropEnd) object.scale.setScalar(Math.max(0.001, 1 - leave));
      phase = t < dropEnd ? 'drop' : 'leave';
    }
    object.rotation.x = 0;
    carrier.pose?.(object, { time: now, travel: range(t, liftEnd, travelEnd), phase, speed });
    // The result's bytes follow the carrier in, one blip after another.
    blips.forEach((blip, index) => {
      const lag = (index + 1) * BLIP_GAP * 1.6;
      const u = smooth(range(t, liftEnd + lag, travelEnd + lag));
      blip.visible = u > 0 && u < 1;
      if (!blip.visible) return;
      const point = routePoint(slot, u, route, cruise);
      blip.position.set(point.x, air ? point.y - 0.3 : 0.1, point.z);
      blip.rotation.y = point.heading;
    });
    const held = hold.getWorldPosition(new Vector3());
    if (t < POP && delivery.waited) {
      crate.scale.setScalar(1);
      crate.position.copy(outlet);
    } else if (t < POP) {
      const pop = range(t, 0, POP);
      crate.scale.setScalar(Math.max(0.001, back(pop, 2.2)));
      const fromY = outlet.y + (record.cloud ? CLOUD_LIFT : 0);
      crate.position.set(
        mix(record.root.position.x, outlet.x, smooth(pop)),
        mix(fromY, outlet.y, smooth(pop)) + Math.sin(pop * Math.PI) * 0.6,
        mix(record.root.position.z, outlet.z, smooth(pop)),
      );
    } else if (t < summonEnd) {
      crate.scale.setScalar(1);
      crate.position.lerpVectors(outlet, held, smooth(range(t, POP, summonEnd)));
    } else if (t < travelEnd) {
      crate.position.copy(held);
    } else {
      const drop = smooth(range(t, travelEnd, dropEnd));
      const hallLift = main.cloud ? CLOUD_HALL_LIFT : 0;
      const landing = intake || new Vector3(HALL.x, 0.45 + hallLift, HALL.z + 1.3);
      crate.position.lerpVectors(held, landing, drop);
      // A ground carrier stops at the door, so it lobs the crate up to an intake.
      if (intake && !air) crate.position.y += Math.sin(drop * Math.PI) * 1.2;
      crate.scale.setScalar(Math.max(0.001, 1 - drop * 0.75));
      if (!intake) doorOpenUntil = Math.max(doorOpenUntil, now + 0.6);
      if (!delivery.landed && t >= dropEnd) {
        delivery.landed = true;
        crate.visible = false;
        if (CLOSED.has(record.state)) record.closedAt = now;
        pileCount += 1;
        hallPulse = now;
        hall.userData.react?.('delivery', record);
        confetti(intake ? intake.setY(intake.y + 0.5) : new Vector3(HALL.x, 2.2 + hallLift, HALL.z + 1.6));
      }
    }
    return t >= leaveEnd;
  }

  function syncPile() {
    const shown = Math.min(pileCount, PILE_MAX);
    while (pile.length < shown) {
      const crate = build('crate')(kit);
      crate.position.copy((skin.pileSpot || pileSpot)(pile.length));
      crate.rotation.y = (pile.length * 0.7) % 0.5 - 0.25;
      crate.userData.bornAt = primed && last !== null ? now : -Infinity;
      crew.add(crate);
      pile.push(crate);
    }
    for (const crate of pile) {
      const born = crate.userData.bornAt;
      crate.scale.setScalar(born === -Infinity || reducedMotion ? 1 : Math.max(0.001, back(range(now, born, born + 0.45))));
    }
  }

  function animateHall(dt, activeMain = main, woke = false) {
    const working = activeMain.state === 'working';
    const finished = activeMain.state === 'done';
    const isCloud = !!activeMain.cloud;
    hallCloud.bank.visible = isCloud;
    hallCloud.ground.visible = isCloud;
    for (const decal of hallGroundDecals) decal.visible = !isCloud;
    hallDeck.position.y = isCloud ? hallCloud.frame(now, dt, working ? 1 : 0.2, reducedMotion || finished) : 0;
    hearth.position.y = 1.75 + hallDeck.position.y;
    const door = hall.userData.door;
    if (finished) {
      kit.windows.emissiveIntensity = kit.beacon.emissiveIntensity = hearth.intensity = 0;
      hallBase.scale.setScalar(1);
      if (door) door.scale.y = 1;
      return;
    }
    const glow = working ? 0.92 : 0.2;
    kit.windows.emissiveIntensity = woke ? glow : kit.windows.emissiveIntensity + (glow - kit.windows.emissiveIntensity) * (1 - Math.exp(-dt * 3));
    const waitingOnYou = activeMain.state === 'waiting';
    kit.beacon.emissiveIntensity = waitingOnYou ? (reducedMotion ? 1.2 : 0.4 + 1.2 * (0.5 + 0.5 * Math.sin(now * 5))) : 0;
    kit.beacon.color.copy(waitingOnYou ? palette.busy : palette.idle);
    const pulse = reducedMotion ? 0 : Math.sin(range(now, hallPulse, hallPulse + 0.45) * Math.PI) * 0.035;
    if (!painter) hallBase.scale.set(1 + pulse, 1 - pulse * 0.6, 1 + pulse);
    const baseHearth = mode === 'dark' ? (working ? 3.8 : 2.1) : (working ? 2.1 : 1.1);
    hearth.intensity = baseHearth + pulse * 26;
    if (door) door.scale.y = mix(door.scale.y, now < doorOpenUntil ? 0.08 : 1, 1 - Math.exp(-dt * 8));
    if (!reducedMotion) {
      const hallActive = working ? 1 : 0.25;
      for (const [part, axis, speed] of hall.userData.spin || []) part.rotation[axis] += speed * dt * hallActive;
      for (const [part, axis, amount, speed] of hall.userData.swing || []) part.rotation[axis] = Math.sin(now * speed) * amount * hallActive;
    }
    hall.userData.frame?.(now, dt, activeMain, reducedMotion);
    const chimney = hall.userData.chimney;
    if (working && activeMain === main && chimney && now >= nextChimney) {
      puff(hallBase.localToWorld(chimney.clone()), { size: 0.3, life: 2.4, rise: 1.6, opacity: 0.42 });
      nextChimney = now + 0.65 + Math.random() * 0.3;
    }
  }

  function animateEffects() {
    for (const entry of puffs) {
      if (!entry.mesh.visible) continue;
      const t = (now - entry.start) / entry.life;
      if (t >= 1 || t < 0) {
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.position.copy(entry.from).addScaledVector(entry.drift, t);
      entry.mesh.scale.setScalar(entry.size * (0.6 + t * 1.4));
      entry.mesh.material.opacity = entry.opacity * (1 - t) * Math.min(1, t * 6);
    }
    for (const entry of bits) {
      if (!entry.mesh.visible) continue;
      const age = now - entry.start;
      if (age >= entry.life || age < 0) {
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.position.set(entry.from.x + entry.velocity.x * age, entry.from.y + entry.velocity.y * age - 4.9 * age * age, entry.from.z + entry.velocity.z * age);
      entry.mesh.rotation.set(entry.turn.x * age, entry.turn.y * age, entry.turn.z * age);
      entry.mesh.material.opacity = 1 - range(age, entry.life * 0.6, entry.life);
    }
  }

  // `time` is in seconds on any steadily increasing clock.
  function render(time) {
    if (disposed) return;
    const dt = last === null ? 0 : Math.min(0.1, Math.max(0, time - last));
    last = time;
    now = time;
    placeCamera(dt);
    for (const record of stations.values()) {
      // A station that was closed when the floor opened waits from its first frame.
      if (record.closedAt === -Infinity) record.closedAt = now;
      if (record.closedAt !== null && !record.derelict && now >= record.closedAt + DWELL) decommission(record);
      animateStation(record, dt);
    }
    for (const record of leaving) {
      animateStation(record, dt);
      if (record.sinkAt === -Infinity || now > record.sinkAt + SINK) {
        crew.remove(record.root);
        if (record.spark) crew.remove(record.spark.mesh);
        release(record.root);
        record.lamp?.material.dispose();
        leaving.delete(record);
      }
    }
    for (let index = deliveries.length - 1; index >= 0; index -= 1) {
      if (animateDelivery(deliveries[index])) {
        const { carrier, crate, blips } = deliveries[index];
        crew.remove(carrier.object);
        crew.remove(crate);
        release(carrier.object);
        release(crate);
        dropBlips(blips);
        deliveries.splice(index, 1);
      }
    }
    for (let index = packets.length - 1; index >= 0; index -= 1) {
      if (animatePacket(packets[index])) {
        dropBlips(packets[index].blips);
        packets.splice(index, 1);
      }
    }
    const traffic = kit.traffic;
    traffic.down = packets.filter(packet => packet.left).length;
    traffic.up = deliveries.filter(delivery => !delivery.landed).length;
    traffic.flow += ((traffic.down + traffic.up ? 1 : 0) - traffic.flow) * (1 - Math.exp(-dt * 4));
    traffic.clock += dt * traffic.flow;
    syncPile();
    const activeMain = trip && trip.remaining > 0.5 ? trip.leftMain : main;
    const shownFinished = activeMain.state === 'done';
    let woke = false;
    if (!shownFinished && restoreLights) {
      restoreLights();
      restoreLights = null;
      woke = true;
    }
    animateHall(dt, activeMain, woke);
    if (!restoreLights) {
      const sceneryDt = shownFinished ? 0 : dt;
      if (shownFinished) hall.userData.frame?.(now, 0, activeMain, true);
      weather?.frame?.(now, sceneryDt);
      skin.frame?.(now, sceneryDt, kit);
      if (shownFinished) restoreLights = switchOffLights([hall, ground, decor, dock, weather?.object]);
    }
    animateEffects();
    animateAdvisor(dt);
    const lit = rootOf(highlighted) || rootOf(focused);
    ring.visible = !!lit;
    if (lit) {
      ring.position.x = lit.position.x;
      ring.position.z = lit.position.z;
      ring.rotation.y = reducedMotion ? 0 : now * 0.6;
      ring.scale.setScalar((lit === hall ? 2.85 : lit === advisor?.root ? 0.82 : 1.02) * (1 + (reducedMotion ? 0 : Math.sin(now * 4) * 0.035)));
    }
    if (!trip) {
      renderer.render(scene, camera);
      return;
    }
    // The town being left shares this one's scenery, so it is the scene drawn
    // once more from where the camera stands over it, with its own crew. The
    // second pass keeps the first's depth, which lays each town's ground and
    // buildings over the other's correctly. A painted town is one painting
    // a period along the strip, drawn through the window slid back over it;
    // the town ahead is then laid over it whole, its painting first.
    const { left, shift } = trip;
    const ringShown = ring.visible;
    crew.visible = ring.visible = false;
    left.visible = true;
    if (painter) showWindow({ ...win.shown, x: win.shown.x - trip.shiftPx });
    else camera.position.sub(shift);
    renderer.render(scene, camera);
    if (painter) showWindow(win.shown);
    else camera.position.add(shift);
    left.visible = false;
    crew.visible = true;
    ring.visible = ringShown;
    renderer.autoClear = false;
    if (painter) renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = true;
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    // A painting keeps its painter's frame; the pane's shape is the window's.
    if (painter) {
      win.width = width;
      win.height = height;
      return;
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const projected = new Vector3();
  // Where each label belongs on screen, in CSS pixels from the container's
  // top left: the hall's as `main`, then every station's by agent id.
  function anchors() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const place = (id, object, y, z = 0, x = 0) => {
      projected.set(object.position.x + x, object.position.y + y, object.position.z + z).project(camera);
      return {
        id,
        x: (projected.x + 1) / 2 * width,
        y: (1 - projected.y) / 2 * height,
        hidden: projected.z > 1 || !object.visible || object.position.y < -0.6,
      };
    };
    // Steady lift rather than deck.position.y keeps HTML floor pills from
    // shimmering with the cloud's per-frame hover bob.
    const result = [place('main', hall, (hall.userData.labelY ?? 3.9) + (main.cloud ? CLOUD_HALL_LIFT : 0),
      hall.userData.labelZ ?? 0.35, hall.userData.labelX ?? 0)];
    if (advisor) {
      const anchor = place('advisor', advisor.root, (advisor.model.userData.labelY ?? 2.2) * advisor.root.scale.y);
      // Its label goes as it leaves.
      anchor.hidden ||= !advisor.reading;
      result.push(anchor);
    }
    for (const [id, record] of stations) {
      const baseY = record.state === 'queued' ? record.model.userData.queuedLabelY ?? 1.45 : record.model.userData.labelY ?? 2;
      result.push(place(id, record.root, baseY + (record.cloud ? CLOUD_LIFT : 0)));
    }
    return result;
  }

  function pick(clientX, clientY) {
    if (!aim(clientX, clientY)) return null;
    for (const hit of raycaster.intersectObjects(pickTargets(), true)) {
      for (let node = hit.object; node?.visible; node = node.parent) {
        if (node.userData?.agentId) return node.userData.agentId;
      }
    }
    return null;
  }

  return {
    canvas,
    // Run status can arrive before the first crew snapshot.
    setMain,
    // The first snapshot sets the floor as it already is; later ones animate
    // what changed. { main: { state, cloud }, agents: [{ id, kind, state, cloud,
    // endedAt, sent: { packets, bytes }, returned: { bytes } }] }, where kind is
    // 'subagent' or 'worker' and state is one of queued, running, ready (done,
    // with a result its parent has not taken), done, failed, stopped or
    // unknown. `sent` counts the instructions handed to the agent so far,
    // `returned` sizes its result, and `endedAt` is when it closed, in
    // milliseconds since the epoch. `advisor` ({ state: 'reading' or 'idle',
    // asks: [{ status }] }) brings the advisor in while it reads; when it
    // stops, an `answered` last ask sends its light back to the hall.
    update(snapshot) {
      apply(snapshot || {}, !primed);
      primed = true;
    },
    render,
    resize,
    anchors,
    pick,
    highlight(id) { highlighted = id || null; },
    // Brings the camera in on one station or the hall (`main`); null pulls it
    // back to the whole floor, as does the station leaving. Either undoes a
    // pan and a zoom.
    focus(id) {
      if ((id || null) !== focused) home();
      focused = id || null;
    },
    // Panning, in client coordinates: `grab` takes hold of the building or
    // ground under the pointer (false when there is none there), `drag`
    // carries it along, and `release` lets go, leaving the view to glide to rest.
    grab(clientX, clientY) {
      if (trip) return false;
      if (painter) {
        // A painting is held where the pointer took it.
        pan.grab = new Vector3(clientX, clientY, 0);
      } else {
        if (!aim(clientX, clientY)) return false;
        // A roof is nearer than the ground behind it, which would slide faster
        // than the pointer.
        const hit = raycaster.intersectObjects(pickTargets(), true).find(entry => entry.object.visible)?.point.clone() || new Vector3();
        if (!hit.y && !levelAt(clientX, clientY, 0, hit)) return false;
        pan.grab = hit;
      }
      pan.pointer.set(clientX, clientY);
      pan.velocity.set(0, 0, 0);
      pan.homing = false;
      return true;
    },
    drag(clientX, clientY) { if (pan.grab) pan.pointer.set(clientX, clientY); },
    release() {
      pan.grab = null;
      if (reducedMotion) pan.velocity.set(0, 0, 0);
    },
    // Zooming: above 1 `factor` moves in, below 1 out, as far as the limits.
    // Given a pointer in client coordinates, what is under it stays under it;
    // without one the middle of the view does.
    zoom(factor, clientX, clientY) {
      if (trip || !(factor > 0)) return;
      const goal = Math.min(Math.max(zoom.goal / factor, zoom.near), zoom.far);
      if (goal === zoom.goal) return;
      zoom.goal = goal;
      // The looked-at point's own level, where scaling about the anchor
      // leaves the camera's height over it in step with the distance; on a
      // painting, the painted point under the pointer.
      if (painter) zoom.anchor = paintingPoint(clientX, clientY);
      else zoom.anchor = clientX !== undefined && levelAt(clientX, clientY, view.target.y, panHit) ? panHit.clone() : null;
      pan.velocity.set(0, 0, 0);
      pan.homing = false;
    },
    recenter: home,
    // `moved` while the view is panned or zoomed away from where the framing
    // would put it, `recentering` while it is on its way back.
    get moved() { return pan.offset.lengthSq() > (painter ? 1 : 0.01) || Math.abs(zoom.goal - 1) > 0.01; },
    get recentering() { return pan.homing; },
    // Which way the zoom has run out: 'in', 'out' or null.
    get zoomLimit() { return zoom.goal <= zoom.near + 1e-3 ? 'in' : zoom.goal >= zoom.far - 1e-3 ? 'out' : null; },
    // Moves to another run's town, which lies towards `direction` ({ x, z })
    // on the map. The floor is cleared, so the next `update` sets the new
    // town as it already is, and the view crosses the ground between the two,
    // out past the bounds that hold a drag, and arrives at the framing's own
    // zoom. With reduced motion it is there at once.
    travel(direction) {
      const leftDim = dim();
      endTrip();
      const left = crew;
      const leftMain = main;
      const own = [...stations.values(), ...leaving].map(record => record.lamp?.material)
        .concat([...puffs, ...bits, ...pages].map(entry => entry.mesh.material)).filter(Boolean);
      crew = new Group();
      scene.add(crew);
      stations.clear();
      leaving.clear();
      retired.clear();
      gone.clear();
      packets.length = deliveries.length = pile.length = puffs.length = bits.length = pages.length = 0;
      advisor = null;
      floor = new Map();
      built = { worker: 0, subagent: 0 };
      waiting = pileCount = 0;
      primed = false;
      highlighted = focused = pan.grab = null;
      hallPulse = doorOpenUntil = -10;
      pan.velocity.set(0, 0, 0);
      pan.homing = false;
      zoom.goal = 1;
      zoom.anchor = null;
      trip = { left, own, start: now, remaining: 1, leftMain, leftDim };
      if (reducedMotion || last === null) {
        pan.offset.set(0, 0, 0);
        endTrip();
        setMain({ state: 'idle' });
        return;
      }
      main = { state: 'idle' };
      left.visible = false;
      if (painter) {
        // Painted towns stand a period of the painting apart along one strip,
        // east or west of each other, and the window slides between them.
        const east = (direction?.x || (direction?.z < 0 ? -1 : 1)) > 0;
        trip.shiftPx = (east ? -1 : 1) * painting.period;
        trip.from = { ...win.shown, x: win.shown.x + trip.shiftPx };
        pan.offset.set(0, 0, 0);
        return;
      }
      const { x, z } = tripShift(direction, tile);
      trip.shift = new Vector3(x, 0, z);
      trip.from = pan.offset.clone().add(trip.shift);
    },
    get travelling() { return !!trip; },
    get dim() { return dim(); },
    // Agents with no station yet, because every station is still working.
    get waiting() { return waiting; },
    // The agents whose stations have been decommissioned, by id. The set is
    // the engine's own: read it, and compare its size to see it change.
    get retired() { return retired; },
    get delivered() { return pileCount; },
    dispose() {
      disposed = true;
      restoreLights?.();
      if (appliedBackdrop) container.style.removeProperty('--factory-stage-bg');
      const geometries = new Set();
      const materials = new Set([kit.windows, kit.beacon, ...kit.materials.values()]);
      const maps = new Set(kit.textures);
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        [object.material].flat().filter(Boolean).forEach(material => {
          materials.add(material);
          Object.values(material).forEach(value => value?.isTexture && maps.add(value));
        });
      });
      weather?.dispose?.();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      maps.forEach(texture => texture.dispose());
      env?.target.dispose();
      env?.pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
