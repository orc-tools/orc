import {
  ACESFilmicToneMapping, AmbientLight, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, PointLight, Scene, ShadowMaterial, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const clamp = t => Math.max(0, Math.min(1, t));
export const range = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = t => t * t * (3 - 2 * t);
export const mix = (a, b, t) => a + (b - a) * t;
// 0 -> 1 -> 0 over [a, b].
export const pulse = (t, a, b) => Math.sin(range(t, a, b) * Math.PI);
// Overshoots past 1 before settling, for snappy arrivals.
export const back = (t, overshoot = 1.7) => {
  const u = clamp(t) - 1;
  return 1 + u * u * ((overshoot + 1) * u + overshoot);
};
// Eases for a track's segments: `out` slows into its key, `fall` speeds up as
// under gravity, and `whip` holds back, then snaps.
export const out = t => 1 - (1 - t) * (1 - t);
export const fall = t => t * t;
export const whip = t => t * t * t;
// A value at `t` on a track of [[time, value, ease?], ...]: each segment eases
// (smooth by default) into its end key, and the first and last values hold
// outside the track.
export function keys(t, track) {
  let i = 1;
  while (i < track.length - 1 && t > track[i][0]) i += 1;
  const [a, from] = track[i - 1], [b, to, curve = smooth] = track[i];
  return mix(from, to, curve(range(t, a, b)));
}
// Damped oscillation that starts at `at`: 0 before it, rings, then dies out.
// Use it for follow-through on anything that should keep moving after a hit.
export const wobble = (t, at, frequency = 9, decay = 5) => {
  const age = t - at;
  return age <= 0 ? 0 : Math.sin(age * frequency) * Math.exp(-age * decay);
};

let software;

// A software rasterizer (SwiftShader, llvmpipe) needs over 100 ms for a shadowed,
// antialiased, image-lit frame and competes with the page for CPU, so it gets
// plain lights at reduced resolution. Antialiasing is fixed when a context is
// created, hence the throwaway probe.
function rendersInSoftware() {
  if (software !== undefined) return software;
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  software = /swiftshader|llvmpipe|softpipe|software/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return software;
}

// A skin re-dresses a scene someone else built. createStage hands it the new
// stage while a skin is being worn, and it returns frame(t), which runs before
// each of the scene's frames.
let fitting = null;

export function wearSkin(skin, build) {
  const worn = { skin, frame: null };
  fitting = worn;
  let built;
  try {
    built = build();
  } finally {
    fitting = null;
  }
  return { ...built, render: t => { worn.frame(t); built.render(t); } };
}

// A transparent renderer sized to `container` and appended to it, so the page
// behind the canvas is the scene's backdrop.
export function createRenderer(container) {
  const software = rendersInSoftware();
  const renderer = new WebGLRenderer({ alpha: true, antialias: !software, powerPreference: 'low-power' });
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  renderer.setPixelRatio(software ? .75 : Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !software;
  container.append(canvas);
  return { renderer, canvas, software };
}

export function createStage(container) {
  const { renderer, canvas, software } = createRenderer(container);
  const scene = new Scene();
  let pmrem, environment;
  if (!software) {
    pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environment = pmrem.fromScene(room, .04);
    room.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = .35;
  }
  const aspect = container.clientWidth / container.clientHeight;
  const camera = new PerspectiveCamera(36, aspect, .1, 70);
  const distance = Math.max(12, 9.2 / aspect);
  camera.position.set(.25, 2.7, distance);
  camera.lookAt(0, 2.05, 0);
  scene.add(new HemisphereLight(0xd8ecd0, 0x2a2118, software ? 1 : .55));
  scene.add(new AmbientLight(0xc9ded2, .25));
  const key = new DirectionalLight(0xffe2b0, 3.4);
  key.position.set(-4, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 7, bottom: -2, near: 1, far: 24 });
  key.shadow.bias = -.0004;
  key.shadow.normalBias = .03;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new DirectionalLight(0xb4ee97, 3.2);
  rim.position.set(4, 4, -4);
  scene.add(rim);
  const fill = new DirectionalLight(0x8baec6, .8);
  fill.position.set(3, 1, 5);
  scene.add(fill);
  const glow = new PointLight(0xc4ff7c, 18, 12);
  glow.position.set(0, 1.8, -2);
  scene.add(glow);
  // Only the shadow is drawn, so the page behind the canvas reads as the floor.
  const floor = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ opacity: .32 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  let disposed = false;
  function resources(textures = []) {
    const geometries = new Set(), materials = new Set(), maps = new Set(textures);
    scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      [object.material].flat().filter(Boolean).forEach(material => {
        materials.add(material);
        Object.values(material).forEach(value => value?.isTexture && maps.add(value));
      });
    });
    return { geometries, materials, maps };
  }
  const stage = {
    renderer, canvas, scene, camera, glow, key, floor,
    // Hidden effects need their textures uploaded too; compiling alone leaves
    // that work on the frame where they first appear.
    warm(prerender) {
      return renderer.compileAsync(scene, camera).then(() => {
        if (disposed) return;
        resources().maps.forEach(texture => renderer.initTexture(texture));
        prerender?.();
      });
    },
    dispose(textures = []) {
      if (disposed) return;
      disposed = true;
      const { geometries, materials, maps } = resources(textures);
      geometries.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      maps.forEach(item => item.dispose());
      environment?.dispose();
      pmrem?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  if (fitting) fitting.frame = fitting.skin(stage);
  return stage;
}
