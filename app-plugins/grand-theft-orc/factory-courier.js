// What moves on the motor court: a coral coupe from the painting brings each
// collected envelope to the motel's door, and blips run between the door and
// the lots for every hand-off.
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import { coupePanel } from './factory-waterfront.js';

const CORAL = 0xeb635c;
const PAPER = 0xffe1ad;
const TEAL = 0x6af4e1;
const TAIL = 0xff4a60;

function facets(vertices, material) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return new Mesh(geometry, material);
}

// The painted coupe shows its side while it crosses the court and its tail
// as it drives up the road, turned to face its way.
export function carrier(kit) {
  const object = new Group();
  const body = new Group();
  const side = coupePanel(kit, false);
  const rear = coupePanel(kit, true);
  body.add(side, rear);
  const hold = new Group();
  hold.position.set(0, 0.43, -0.12);
  object.add(kit.shadow(1.22, 1.70, kit.mode === 'dark' ? 0.46 : 0.34), body, hold);
  return {
    object, hold, route: 'ground',
    pose(target) {
      const heading = target.rotation.y;
      const lateral = Math.sin(heading);
      body.rotation.y = -heading;
      side.visible = Math.abs(lateral) > 0.65;
      rear.visible = !side.visible;
      side.scale.x = lateral < 0 ? -1 : 1;
      rear.scale.x = lateral > 0.08 ? -1 : 1;
    },
  };
}

// A cream envelope with a coral seal.
export function crate(kit) {
  const envelope = new Group();
  const stock = kit.mat(PAPER, { rough: 0.91, metal: 0 });
  const seam = kit.mat(0xb88064, { rough: 0.82, metal: 0 });
  const flap = kit.mat(0xffedc9, { rough: 0.84, metal: 0 });
  envelope.add(
    kit.box(0.44, 0.050, 0.32, seam),
    kit.box(0.434, 0.014, 0.314, stock, [0, 0.021, 0]),
    facets([-0.215, 0.030, -0.155, 0, 0.037, 0.069, 0.215, 0.030, -0.155], seam),
    facets([-0.202, 0.033, -0.153, 0, 0.040, 0.050, 0.202, 0.033, -0.153], flap),
    kit.cylinder(0.042, 0.048, 0.014, kit.mat(CORAL, { rough: 0.56 }), [0, 0.046, 0.034], 12),
  );
  envelope.scale.setScalar(0.66);
  return new Group().add(kit.shadows(envelope));
}

// Teal for instructions on their way out, coral for a result's bytes coming
// home.
export function packet(kit, direction) {
  const blip = new Group();
  const dark = kit.mode === 'dark';
  const tint = direction === 'down' ? (dark ? TEAL : 0x087878) : (dark ? TAIL : 0xa54550);
  const signal = kit.sphere(0.11, kit.basic(tint), [0, 0.01, 0], 8);
  signal.scale.set(0.28, 0.10, 0.89);
  blip.add(kit.halo(tint, 0.18, 0.36, { opacity: dark ? 0.38 : 0.16 }), signal);
  return blip;
}
