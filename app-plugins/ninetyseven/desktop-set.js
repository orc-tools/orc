// The Orcsoft 97 set the three send-offs share: the screen saver's windows
// flying out of the distance, Clippy's sheet of yellow notepaper, his speech
// balloon and the chips he throws up.
import {
  CanvasTexture, CircleGeometry, IcosahedronGeometry, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { back, range } from '../../ui/yeet/stage.js';

export const NAVY = '#000080';
export const BLUE = '#1070c0';
export const CHROME = '#c0c0c0';
export const FONT = 'Tahoma, "MS Sans Serif", Geneva, sans-serif';
const WINDOWS = 18;
// The windows fly from FAR to NEAR and stay behind Clippy, who stands at 0.
const FAR = -30;
const NEAR = -5;
const NOTEPAPER = '#fff9a6';
const TOOLTIP = '#ffffe1';
const BALLOON_PIXELS = 640;
const LINE = 58;
const TAIL = 56;
const BALLOON_WIDTH = 3;

export { fall, keys, out, whip } from '../../ui/yeet/stage.js';

export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function wrap(ctx, text, width, lines) {
  const fitted = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      fitted.push(line);
      line = word;
    } else line = next;
  }
  if (line) fitted.push(line);
  if (fitted.length > lines) fitted.splice(lines - 1, fitted.length, `${fitted[lines - 1]}…`);
  return fitted;
}

// One small window: a grey frame with a raised edge, a title bar and a white
// page. Nearest-neighbour sampling keeps its pixels square as it grows.
function windowTexture(title) {
  const texture = canvasTexture(32, 24, ctx => {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, 32, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 31, 23);
    ctx.fillStyle = CHROME;
    ctx.fillRect(1, 1, 30, 22);
    ctx.fillStyle = title;
    ctx.fillRect(2, 2, 28, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3, 9, 26, 12);
  });
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  return texture;
}

function flyingWindows(scene) {
  const textures = [NAVY, BLUE].map(windowTexture);
  // Placed by stride so every replay flies the same windows.
  const panes = Array.from({ length: WINDOWS }, (_, i) => {
    const pane = new Mesh(new PlaneGeometry(1.6, 1.2), new MeshBasicMaterial({
      map: textures[i % textures.length], transparent: true, depthWrite: false, toneMapped: false,
    }));
    const angle = i * 2.39996;
    const reach = 3.5 + (i * 5) % 7;
    pane.position.set(Math.cos(angle) * reach, 4.5 + Math.sin(angle) * reach * .55, FAR);
    pane.userData.offset = (i * 7) % WINDOWS / WINDOWS;
    pane.userData.speed = .1 + (i % 4) * .025;
    return pane;
  });
  scene.add(...panes);
  return t => {
    for (const pane of panes) {
      const along = (t * pane.userData.speed + pane.userData.offset) % 1;
      pane.position.z = FAR + along * (NEAR - FAR);
      // Each window fades in from the distance and out before it would pop.
      pane.material.opacity = Math.min(1, along * 6, (1 - along) * 6);
    }
  };
}

// The stage is lit for the orc's swamp. Steel wants cool white light, or its
// rim and glow come out green.
function relight({ scene, key, glow }) {
  scene.traverse(light => {
    if (!light.isLight || light === key || light === glow) return;
    if (light.isHemisphereLight) {
      light.color.set(0xe8f0fa);
      light.groundColor.set(0x24383c);
    } else if (light.isDirectionalLight && light.position.z < 0) {
      light.color.set(0xcfe0ff);
    }
  });
  key.color.set(0xfff4e0);
  glow.color.set(0xdfe9ff);
}

// Returns frame(t), to run before each of the scene's frames.
export function dressStage(stage) {
  relight(stage);
  return flyingWindows(stage.scene);
}

// Stands on its bottom edge, so it can lean back behind him.
export function notepad() {
  const texture = canvasTexture(256, 320, (ctx, width, height) => {
    ctx.fillStyle = NOTEPAPER;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#9db8e6';
    for (let y = 46; y < height - 8; y += 22) ctx.fillRect(0, y, width, 2);
    ctx.fillStyle = '#e58a8a';
    ctx.fillRect(38, 0, 2, height);
    ctx.strokeStyle = '#b3a43c';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, width - 4, height - 4);
  });
  const pad = new Mesh(new PlaneGeometry(2.8, 3.5).translate(0, 1.75, 0), new MeshBasicMaterial({ map: texture, toneMapped: false }));
  pad.rotation.set(-.1, 0, .05);
  return pad;
}

export function blobShadow() {
  const shadow = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  return shadow;
}

// A tooltip-yellow speech balloon whose tail leaves the bottom edge `tail` of
// the way along and leans toward Clippy. The mesh's origin is the tail's tip,
// so it grows out of his head. A line starting "(o) " or "( ) " is a radio
// button, picked or not.
export function balloon(lines, tail) {
  const width = BALLOON_PIXELS;
  const height = 54 + lines.length * LINE;
  const base = tail * width;
  const tip = base + Math.sign(tail - .5) * 34;
  const texture = canvasTexture(width, height + TAIL, ctx => {
    ctx.fillStyle = TOOLTIP;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.roundRect(4, 4, width - 8, height - 8, 22);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(base - 26, height - 7);
    ctx.lineTo(tip, height + TAIL - 4);
    ctx.lineTo(base + 26, height - 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#000000';
    lines.forEach((line, i) => {
      const y = 82 + i * LINE;
      const radio = /^\((o| )\) /.exec(line);
      ctx.font = `${radio ? '' : 'bold '}40px ${FONT}`;
      if (!radio) return ctx.fillText(line, 40, y);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(58, y - 13, 14, 0, Math.PI * 2);
      ctx.stroke();
      if (radio[1] === 'o') {
        ctx.beginPath();
        ctx.arc(58, y - 13, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillText(line.slice(4), 88, y);
    });
  });
  const tall = BALLOON_WIDTH * (height + TAIL) / width;
  const mesh = new Mesh(
    new PlaneGeometry(BALLOON_WIDTH, tall).translate((.5 - tip / width) * BALLOON_WIDTH, tall / 2, 0),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.renderOrder = 2;
  return {
    mesh,
    show(t, from, until) {
      const size = back(range(t, from, from + .2)) * (1 - range(t, until, until + .12));
      mesh.visible = size > .01;
      mesh.scale.setScalar(size);
    },
  };
}

// Chips thrown out from a point, placed by stride so every replay throws the
// same. Returns burst(age, from, life), where age is seconds since the throw.
export function chips(scene, count) {
  const shape = new IcosahedronGeometry(.045, 0);
  const materials = [0xffffff, 0xffe45c, 0x7fd4ff].map(color => new MeshBasicMaterial({ color, toneMapped: false }));
  const flecks = Array.from({ length: count }, (_, i) => {
    const mesh = new Mesh(shape, materials[i % materials.length]);
    mesh.visible = false;
    const angle = i * 2.39996;
    return { mesh, x: Math.cos(angle), y: Math.sin(angle), speed: .7 + (i % 7) * .24 };
  });
  scene.add(...flecks.map(({ mesh }) => mesh));
  return (age, from, life = 1) => {
    flecks.forEach(({ mesh, x, y, speed }, i) => {
      mesh.visible = age > 0 && age < life;
      if (!mesh.visible) return;
      mesh.position.set(from.x + x * age * speed * 3.4, from.y + y * age * speed * 2.8 + age * 1.2 - age * age * 3, from.z + age * (i % 4) * .4);
      mesh.rotation.set(age * 7, i, age * 4);
      mesh.scale.setScalar((1 - age / life) * (i % 3 + 1));
    });
  };
}
