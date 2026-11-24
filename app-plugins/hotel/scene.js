// The hotel cast for Yeet, PR opened, Plan reveal and All settled: the default
// orc and his props in the lobby. He stands on a square of checked floor laid
// corner-on, the hotel rises behind him with its windows lit and its sign on
// the roof with two guests hopping at its door, a luggage trolley waits on
// his other side beside a palm, and coins turn as they rise off the tiles.
import {
  BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter,
  PlaneGeometry, SRGBColorSpace,
} from 'three';
import { wearSkin } from '../../ui/yeet/stage.js';
import swamp from '../swamp/scene.js';
import { createFactory } from '../../ui/yeet/factory.js';
import factorySkin from './factory.js';

const BLUE = 0x1f78ad;
const DEEP = 0x17628f;
const BRASS = 0xffcc33;
const RED = 0xc8283c;
const CREAM = 0xf4ead0;
const INK = 0x10202b;
const TILES = ['#eedfb8', '#e4d2a3'];

const box = (w, h, d, material, x, y, z) => {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
};

// A canvas drawn once and shown without smoothing, so its pixels stay square.
function pixels(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

// The floor under the cast: eight tiles by eight, turned so a corner points
// at the viewer, as a room's floor does in the hotel.
function tiles() {
  const map = pixels(8, 8, ctx => {
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        ctx.fillStyle = TILES[(row + column) % 2];
        ctx.fillRect(column, row, 1, 1);
      }
    }
  });
  const floor = new Mesh(new PlaneGeometry(11, 11), new MeshStandardMaterial({ map, roughness: 0.85 }));
  floor.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  floor.position.set(0, 0.02, -3.4);
  floor.receiveShadow = true;
  return floor;
}

// The hotel: two storeys of cream wall with blue bands, a row of windows on
// each, the door under a red awning and the sign on the roof. Each window has
// its own material so the guests can turn their lights on and off.
function hotel() {
  const building = new Group();
  const wall = new MeshStandardMaterial({ color: CREAM, roughness: 0.85 });
  const band = new MeshStandardMaterial({ color: DEEP, roughness: 0.6 });
  const brass = new MeshStandardMaterial({ color: BRASS, roughness: 0.35, metalness: 0.7 });
  building.add(box(4.4, 0.2, 2.0, band, 0, 0.1, 0), box(4.1, 2.3, 1.7, wall, 0, 1.35, 0), box(4.3, 0.18, 1.9, band, 0, 2.59, 0));
  building.add(box(3.7, 2.2, 1.5, wall, 0, 3.78, 0), box(3.9, 0.18, 1.7, band, 0, 4.97, 0));
  const windows = [];
  const pane = (x, y, z, turn) => {
    const material = new MeshBasicMaterial({ color: BRASS, toneMapped: false });
    building.add(box(0.46, 0.6, 0.06, material, x, y, z));
    windows.push({ material, phase: turn * 1.37 });
  };
  for (let column = 0; column < 5; column++) pane(-1.4 + column * 0.7, 3.9, 0.76, column);
  for (const [x, turn] of [[-1.5, 5], [1.5, 6]]) pane(x, 1.5, 0.86, turn);
  building.add(box(1.3, 1.5, 0.06, new MeshStandardMaterial({ color: INK, roughness: 1 }), 0, 0.95, 0.86));
  for (const x of [-0.72, 0.72]) building.add(box(0.12, 1.6, 0.14, brass, x, 1.0, 0.9));
  const awning = box(1.9, 0.1, 0.7, new MeshStandardMaterial({ color: RED, roughness: 0.8 }), 0, 1.92, 1.16);
  awning.rotation.x = 0.22;
  building.add(awning, box(1.9, 0.14, 0.05, brass, 0, 1.82, 1.5));
  const sign = pixels(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#1f78ad';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#ffcc33';
    ctx.font = '700 32px Verdana, Geneva, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ORC HOTEL', w / 2, h / 2 + 2);
  });
  const guests = [guest(0x3b2416, 0xf0c8a0, 0xe0489e, 0x2b4a7a, -1.5, 1.6), guest(0xf2c94c, 0xf6d7b8, 0x28b4e0, 0x3a3a48, 1.6, 1.5)];
  building.add(...guests);
  building.add(box(2.9, 0.78, 0.12, band, 0, 5.56, 0.4));
  const face = new Mesh(new PlaneGeometry(2.8, 0.7), new MeshBasicMaterial({ map: sign, toneMapped: false }));
  face.position.set(0, 5.56, 0.47);
  building.add(face);
  building.traverse(part => { if (part.isMesh) part.castShadow = true; });
  building.position.set(-5.1, 0, -5.6);
  building.rotation.y = 0.42;
  return { building, windows, guests };
}

// A guest in four blocks, the head the biggest, as the Factory floor's are.
function guest(hair, skin, shirt, legs, x, z) {
  const person = new Group();
  const part = (w, h, d, colour, y) => person.add(box(w, h, d, new MeshStandardMaterial({ color: colour, roughness: 0.85 }), 0, y, 0));
  part(0.2, 0.2, 0.12, legs, 0.1);
  part(0.28, 0.24, 0.16, shirt, 0.32);
  part(0.3, 0.26, 0.26, skin, 0.57);
  part(0.32, 0.1, 0.28, hair, 0.72);
  person.scale.setScalar(1.9);
  person.position.set(x, 0.2, z);
  return person;
}

// The luggage trolley: a brass bed on four wheels under two hoops, with three
// suitcases stacked on it.
function trolley() {
  const cart = new Group();
  const brass = new MeshStandardMaterial({ color: BRASS, roughness: 0.3, metalness: 0.8 });
  cart.add(box(2.0, 0.1, 1.2, brass, 0, 0.42, 0), box(1.9, 0.08, 1.1, new MeshStandardMaterial({ color: RED, roughness: 0.9 }), 0, 0.5, 0));
  for (const [x, z] of [[-0.8, -0.5], [0.8, -0.5], [-0.8, 0.5], [0.8, 0.5]]) {
    const wheel = new Mesh(new CylinderGeometry(0.2, 0.2, 0.1, 14), new MeshStandardMaterial({ color: INK, roughness: 0.7 }));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.2, z);
    cart.add(wheel);
  }
  for (const z of [-0.5, 0.5]) {
    for (const x of [-0.9, 0.9]) {
      const post = new Mesh(new CylinderGeometry(0.045, 0.045, 2.4, 8), brass);
      post.position.set(x, 1.66, z);
      cart.add(post);
    }
    cart.add(box(1.9, 0.09, 0.09, brass, 0, 2.86, z));
  }
  cart.add(box(0.09, 0.09, 1.0, brass, 0, 2.86, 0));
  const cases = [[1.4, 0.5, 0.9, 0x8a4b2a, 0.79, 0], [1.1, 0.42, 0.8, BLUE, 1.25, 0.12], [0.8, 0.36, 0.6, 0x2a7a14, 1.64, -0.1]];
  for (const [w, h, d, colour, y, turn] of cases) {
    const suitcase = new Group();
    suitcase.add(box(w, h, d, new MeshStandardMaterial({ color: colour, roughness: 0.7 }), 0, 0, 0));
    for (const side of [-1, 1]) suitcase.add(box(0.08, h + 0.02, d + 0.02, brass, side * w * 0.28, 0, 0));
    suitcase.position.y = y;
    suitcase.rotation.y = turn;
    cart.add(suitcase);
  }
  cart.traverse(part => { if (part.isMesh) part.castShadow = true; });
  cart.position.set(5.0, 0, -5.4);
  cart.rotation.y = -0.5;
  return cart;
}

// A palm in a pot: six fronds drooping from the top of its trunk.
function palm() {
  const tree = new Group();
  const leaf = new MeshStandardMaterial({ color: 0x3c8c2a, roughness: 0.8 });
  const pot = new Mesh(new CylinderGeometry(0.6, 0.45, 0.8, 12), new MeshStandardMaterial({ color: 0xb3542e, roughness: 0.8 }));
  pot.position.y = 0.4;
  const trunk = new Mesh(new CylinderGeometry(0.1, 0.16, 2.6, 8), new MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 }));
  trunk.position.y = 2.1;
  tree.add(pot, trunk);
  for (let frond = 0; frond < 6; frond++) {
    const hub = new Group();
    hub.position.y = 3.4;
    hub.rotation.y = frond * Math.PI / 3;
    const droop = new Group();
    droop.rotation.z = -0.5;
    droop.add(box(1.6, 0.06, 0.44, leaf, 0.76, 0, 0));
    hub.add(droop);
    tree.add(hub);
  }
  tree.traverse(part => { if (part.isMesh) part.castShadow = true; });
  tree.position.set(7.6, 0, -8.2);
  return tree;
}

// Coins rising off the floor, placed by stride so every replay runs the same.
function coins() {
  const purse = new Group();
  const geometry = new CylinderGeometry(0.17, 0.17, 0.05, 12);
  geometry.rotateX(Math.PI / 2);
  const material = new MeshStandardMaterial({ color: BRASS, roughness: 0.3, metalness: 0.7, emissive: BRASS, emissiveIntensity: 0.35 });
  const loose = Array.from({ length: 26 }, (_, i) => {
    const mesh = new Mesh(geometry, material);
    purse.add(mesh);
    return {
      mesh,
      x: ((i * 7.31) % 17) - 8.5,
      z: -3 - ((i * 3.7) % 9),
      phase: (i * 0.618034) % 1,
      speed: 0.06 + ((i * 13) % 5) * 0.012,
    };
  });
  return { purse, loose };
}

function hotelSkin({ scene, glow }) {
  const { building, windows, guests } = hotel();
  const { purse, loose } = coins();
  scene.add(tiles(), building, trolley(), palm(), purse);
  glow.color.set(BRASS);
  return t => {
    // Mostly lit: a window goes dark only while its two slow waves both dip.
    for (const pane of windows) {
      const dim = Math.sin(t * 0.9 + pane.phase) * Math.sin(t * 0.37 + pane.phase * 2.3) > 0.55;
      pane.material.color.setHex(dim ? DEEP : BRASS);
    }
    guests.forEach((person, n) => { person.position.y = 0.2 + Math.abs(Math.sin(t * 3.2 + n * 1.3)) * 0.22; });
    for (const coin of loose) {
      const rise = (coin.phase + t * coin.speed) % 1;
      coin.mesh.position.set(coin.x, 0.3 + rise * 8, coin.z);
      coin.mesh.rotation.y = t * 3 + coin.phase * 6;
      coin.mesh.scale.setScalar(Math.sin(rise * Math.PI));
    }
  };
}

// Swamp's scenes, built inside the skin so they play in the lobby.
const skinned = name => (container, title) => wearSkin(hotelSkin, () => swamp[name](container, title));

export default {
  factory: (container, options) => createFactory(container, factorySkin, options),
  yeet: skinned('yeet'), pr: skinned('pr'), plan: skinned('plan'), clear: skinned('clear'),
  look: {
    words: { yeet: 'CHECKED OUT.', pr: 'PR CHECKED IN.', plan: 'ROOM BOOKED.', clear: 'DO NOT DISTURB.' },
    background: 'radial-gradient(ellipse at 50% 60%,light-dark(#ffffff,#1d5f86) 0%,light-dark(#d3e6f1,#12344d) 50%,light-dark(#aed2e6,#0c1a26) 100%)',
    ink: 'light-dark(#0d1a22,#ffffff)',
    glow: '4px 4px 0 light-dark(#f5b800,#0e6088)',
    flash: 'light-dark(#0e6088,#ffcc33)',
    flashGlow: 'light-dark(#0e608890,#ffcc3390)',
  },
};
