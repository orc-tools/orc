// The motor court's painting and where everything stands in it. Astra
// painted the court from one spot, so the floor is seen from there
// (`view.painting`, app-plugins/README.md) and every garage, booth, coupe and
// parcel is placed by the painted pixel it stands on, in the 1334 by 1179
// frame of her mockup. The plates (motor-court-night.webp and
// motor-court-day.webp, painted by docs/grand-theft-orc-art/factory.mjs)
// carry the waterfront, the motel and the empty lots; the cut-out sheets
// (motor-court-*-lots.webp) carry the buildings and coupes laid over them.
import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3,
} from 'three';
import { DOOR, paintedCamera } from '../../ui/yeet/factory-layout.js';

// Where Astra stood: 26 units back from the court and 0.7 radians above it,
// with a 29° lens, and with the motel's front step on the hall's door.
const ELEVATION = 0.7;
const FRAME = [1334, 1179];
const camera = {
  size: FRAME, fov: 29, elevation: ELEVATION, eyeHeight: 0.85 + Math.sin(ELEVATION) * 26,
  anchor: { at: [745, 422], on: DOOR },
};
const painter = paintedCamera(camera);

// What the plates cover, in frame pixels: the mockup's frame with the
// waterfront carried on beside it, the sky above and more lots in front. A
// plate tiles along the waterfront, so the next run's motel stands a period
// along (docs/grand-theft-orc-art/factory.mjs keeps both in step).
export const ART = { left: -413, top: -320, right: 1747, bottom: 1780 };
export const PERIOD = ART.right - ART.left;

// The lots, row by row from the motel: the frame row their buildings stand
// on, the centres of the inner (booth), outer (garage) and outermost lots
// left and right of the road, and how wide a garage and a booth stand there.
// Astra painted the first three rows of inner and outer lots. The plates
// carry her outer lots 251 pixels further left and 242 further right, and her
// last row 320 pixels nearer, for a crew that outgrows them.
export const ROWS = [
  { y: 548, lots: [[430, 901], [194, 1121], [-57, 1363]], garage: 216, booth: 107 },
  { y: 779, lots: [[432, 903], [183, 1144], [-68, 1386]], garage: 234, booth: 120 },
  { y: 1054, lots: [[449, 906], [188, 1168], [-63, 1410]], garage: 255, booth: 133 },
  { y: 1374, lots: [[449, 906], [188, 1168], [-63, 1410]], garage: 255, booth: 133 },
];

function lot({ row, column, side }) {
  const { y, lots } = ROWS[row];
  return { x: lots[column][side > 0 ? 1 : 0], y };
}

// Astra's frame for the crew she painted, deepened to the front row and
// widened to the outermost lots once they are taken.
function overview({ rows, columns }) {
  const box = { left: 0, top: 0, right: FRAME[0], bottom: FRAME[1] };
  if (rows > 3) box.bottom = ROWS[3].y + 120;
  if (columns > 2) {
    const used = ROWS.slice(0, rows);
    box.left = Math.min(...used.map(({ lots, garage }) => lots[2][0] - garage / 2)) - 20;
    box.right = Math.max(...used.map(({ lots, garage }) => lots[2][1] + garage / 2)) + 20;
  }
  return box;
}

export const view = {
  painting: { ...camera, art: ART, period: PERIOD, sharp: 0.5, overview },
};

export function pileSpot(index) {
  const point = painter.ground(835 + index % 3 * 18, 419 + Math.floor(index % 6 / 3) * 9);
  return new Vector3(point.x, 0.045 + Math.floor(index / 6) * 0.06, point.z);
}

export const layout = {
  preferredColumns: { worker: [1, 0, 2], subagent: [0, 1, 2] },
  position(spot) {
    const { x, y } = lot(spot);
    const point = painter.ground(x, y);
    return { x: point.x, z: point.z, yaw: 0 };
  },
  // Out of the lot, along the row to the lane on its side of the road, and
  // up the lane to the motel's door.
  driveway(spot) {
    const { x, y } = lot(spot);
    const lane = FRAME[0] / 2 + spot.side * 34;
    const crossing = y + 56 + spot.row * 8;
    return [[x, y + 20], [x, crossing], [lane + spot.side * 48, crossing],
      [lane, crossing - 19], [lane, 463], [745, 422]].map(([px, py]) => {
      const point = painter.ground(px, py);
      return [point.x, point.z];
    });
  },
};

// The cut-out sheet (docs/grand-theft-orc-art/factory.mjs): each look's
// pixels on it. A garage is open and lit while its worker works, shut once
// the job is home, shuttered with its neon on when it failed (as Astra
// painted it), and dark, its neon out, once its agent has closed.
const SHEET = [1024, 1024];
const LOOKS = {
  hotel: [0, 0, 840, 425],
  garageLeft: [0, 438, 234, 185], garageRight: [243, 438, 237, 185], garageCrew: [490, 438, 255, 210],
  garageShut: [753, 438, 215, 169], garageCold: [0, 656, 205, 158], garageDark: [0, 840, 205, 158],
  booth: [215, 656, 109, 130], boothCrew: [335, 656, 140, 145], boothCold: [486, 656, 119, 126],
  coupeSide: [615, 656, 162, 77], coupeRear: [789, 656, 171, 102],
};
// How opaque each pixel of a sheet is, once it has loaded, for picking.
const opacity = new Map();

function paint(kit, sheet) {
  const lots = sheet === 'lots';
  const time = kit.mode === 'light' ? 'day' : 'night';
  const variant = lots ? `${time}-lots` : time;
  const file = new URL(`./motor-court-${variant}.webp`, import.meta.url).href;
  if (kit.materials.has(file)) return kit.materials.get(file);
  const material = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false, fog: false, alphaTest: lots ? 0.38 : 0 });
  material.map = kit.picture(file, texture => {
    if (!lots) return;
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = SHEET;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(texture.image, 0, 0);
    opacity.set(file, context.getImageData(0, 0, ...SHEET).data);
  });
  material.map.anisotropy = 4;
  material.userData.sheet = file;
  kit.materials.set(file, material);
  return material;
}

// A mesh carrying the sheet pixels `source` [x, y, w, h] over the frame
// pixels `bounds` [left, top, width, height], each placed by `point`. It is
// cut finely so it stays true to the frame wherever it is laid.
function strip(material, bounds, source, sheet, point, bands = 1) {
  const [left, top, width, height] = bounds;
  const [sx, sy, sw, sh] = source;
  const positions = [];
  const uvs = [];
  const indices = [];
  const columns = Math.max(1, Math.ceil(Math.abs(width) / 48));
  for (let row = 0; row <= bands; row++) {
    const t = row / bands;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const at = point(left + u * width, top + t * height);
      positions.push(at.x, at.y, at.z);
      uvs.push((sx + u * sw) / sheet[0], 1 - (sy + t * sh) / sheet[1]);
      if (row < bands && column < columns) {
        const i = row * (columns + 1) + column;
        const next = i + columns + 1;
        indices.push(i, next, i + 1, i + 1, next, next + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return new Mesh(geometry, material);
}

// The floor is the plate, a sheet far along the view that lays it over its
// own frame pixels, and the ground it shows as depth alone, which hides a
// station still rising out of its lot.
export function floor(kit) {
  const group = new Group();
  const plate = strip(paint(kit, 'plate'), [ART.left - 1, ART.top, ART.right - ART.left + 2, ART.bottom - ART.top],
    [0, 0, 1, 1], [1, 1], (px, py) => painter.sheet(px, py, 140));
  plate.material.depthWrite = false;
  plate.renderOrder = -2;
  const ground = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial({ colorWrite: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -1;
  group.add(plate, ground);
  return group;
}

// A building's silhouette is all that picks it: the clear pixels round it on
// the sheet let the pointer through to whatever is behind.
function pickSilhouette(mesh, file) {
  mesh.raycast = function(raycaster, hits) {
    const candidates = [];
    Mesh.prototype.raycast.call(mesh, raycaster, candidates);
    const alpha = opacity.get(file);
    for (const hit of candidates) {
      const x = Math.min(SHEET[0] - 1, Math.max(0, Math.floor(hit.uv.x * SHEET[0])));
      const y = Math.min(SHEET[1] - 1, Math.max(0, Math.floor((1 - hit.uv.y) * SHEET[1])));
      if (!alpha || alpha[(y * SHEET[0] + x) * 4 + 3] >= 97) hits.push(hit);
    }
  };
}

// A look from the sheet standing upright at depth `z`, true to the frame
// pixels `bounds`, relative to `base` (where its group stands).
function facade(kit, look, bounds, base, z) {
  const material = paint(kit, 'lots');
  const mesh = strip(material, bounds, LOOKS[look], SHEET, (px, py) => new Vector3().copy(painter.wall(px, py, z)).sub(base), 8);
  pickSilhouette(mesh, material.userData.sheet);
  return mesh;
}

// The motel is in the plate. The hall is its silhouette, drawn by nothing,
// for the pointer to find, with the label over its sign and parcels going in
// at its door.
export function hall(kit, at) {
  const base = new Vector3(at.x, 0, at.z);
  const wall = painter.ground(745, 436).z;
  const silhouette = facade(kit, 'hotel', [316, 12, 840, 425], base, wall);
  if (!kit.materials.has('motor-court-silhouette')) {
    kit.materials.set('motor-court-silhouette', new MeshBasicMaterial({ visible: false }));
  }
  silhouette.material = kit.materials.get('motor-court-silhouette');
  const sign = new Vector3().copy(painter.wall(663, 133, wall)).sub(base);
  const group = new Group();
  group.add(silhouette);
  Object.assign(group.userData, {
    labelX: sign.x, labelY: sign.y, labelZ: sign.z,
    intake: new Vector3().copy(painter.wall(746, 385, wall + 0.02)).sub(base),
  });
  return group;
}

// A garage for a worker and a roadside booth for a subagent: lit while it
// works, shut once its job is home, shuttered when it failed, and dark while
// it waits to open or once it has closed.
export function station(kit, kind, spot, queued = false) {
  const { x, y } = lot(spot);
  const ground = painter.ground(x, y);
  const base = new Vector3(ground.x, 0, ground.z);
  const garage = kind === 'worker';
  const width = garage ? ROWS[spot.row].garage : ROWS[spot.row].booth;
  const live = garage ? (spot.row >= 2 ? 'garageCrew' : spot.side < 0 ? 'garageLeft' : 'garageRight')
    : spot.row === 1 && spot.side < 0 ? 'boothCrew' : 'booth';
  const closed = garage ? 'garageDark' : 'boothCold';
  const failed = garage ? 'garageCold' : 'boothCold';
  const returned = garage ? 'garageShut' : live;
  const group = new Group();
  group.add(kit.shadow(garage ? 2.55 : 1.30, 0.85, 0.40, [0, 0.015, 0.10]));
  const spill = kit.mode === 'dark' && !queued
    ? kit.halo('#f29a4c', garage ? 1.6 : 0.85, 0.9, { opacity: 0.26, at: [0, 0.024, 0.28] }) : null;
  if (spill) group.add(spill);
  const looks = {};
  // Lots in a row stand at one depth, and an outer garage's eaves can reach
  // its neighbour's, so each column stands a hair nearer than the one inside
  // it: still true to its pixels, and in front where they meet.
  const z = base.z + 0.01 + spot.column * 0.004;
  for (const key of new Set(queued ? [closed] : [live, returned, failed, closed])) {
    const [,, sw, sh] = LOOKS[key];
    // The attendant beside the booth stands past its footprint.
    const wide = key === 'boothCrew' ? width * 1.22 : width;
    const height = wide * sh / sw;
    const mesh = facade(kit, key, [x - width / 2, y - height, wide, height], base, z);
    mesh.userData.look = key;
    looks[key] = mesh;
    group.add(mesh);
    mesh.visible = queued || key === live;
    if (key === live || queued) group.userData.labelY = painter.wall(x, y - height - 5, base.z).y;
  }
  group.userData.queuedLabelY = group.userData.labelY;
  group.userData.puff = false;
  const show = look => {
    for (const [key, mesh] of Object.entries(looks)) mesh.visible = key === look;
    if (spill) spill.visible = look !== closed && look !== failed;
  };
  group.userData.frame = (_now, _dt, record) => {
    if (record.offAt !== null) show(closed);
    else if (record.state === 'failed') show(failed);
    else if (record.state === 'stopped' || (record.state === 'done' && !record.parcel)) show(returned);
    else show(live);
  };
  group.userData.react = event => { if (event === 'decommission') show(closed); };
  return group;
}

// A coupe seen from the side or from behind, square to the painter.
export function coupePanel(kit, rear) {
  const look = LOOKS[rear ? 'coupeRear' : 'coupeSide'];
  const width = rear ? 1.68 : 1.80;
  const height = width * look[3] / look[2];
  const panel = strip(paint(kit, 'lots'), [-width / 2, -height, width, height], look, SHEET, (x, y) => new Vector3(x, -y, 0));
  panel.rotation.x = -ELEVATION;
  return panel;
}
