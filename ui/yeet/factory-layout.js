// Where the Factory floor puts each agent, and what changed between two
// snapshots of a run's crew. Nothing here touches three.js or the DOM, so node
// tests it directly (tests/test-factory-layout.js).

// Stations stand in rows either side of the aisle that runs up to the main
// hall's door, the row nearest the hall first. World units; y is up and the
// camera looks from +z.
export const COLUMNS = [-2.7, 2.7, -5.4, 5.4, -8.1, 8.1];
export const ROWS = 4;
export const ROW_GAP = 2.9;
const FIRST_ROW = -0.6;
export const CAPACITY = COLUMNS.length * ROWS;
export const HALL = { x: 0, z: -5 };
// A carrier drops its crate here, on the hall's threshold.
export const DOOR = { x: 0, z: -3.2 };
// How far in front of its centre a station's crate comes out, towards the aisle.
export const OUTLET = 1.05;
// The height an air carrier hovers at to pick up and drop off its crate.
export const HOVER = 1.9;
// How far above a hall's intake an air carrier hovers to drop its crate in.
export const INTAKE_CLEARANCE = 1.5;

// A hall may take deliveries somewhere other than its door, such as a crater
// or a chimney: its `intake`, in world units. An air carrier flies its usual
// route for the first half of the trip (`travel` runs 0 to 1), then bends up
// to hover over the intake. Without an intake the route point is unchanged.
export function towardIntake(point, intake, travel) {
  if (!intake) return point;
  const u = Math.max(0, Math.min(1, (travel - 0.5) / 0.5));
  const over = u * u * (3 - 2 * u);
  const blend = (from, to) => from + (to - from) * over;
  return { ...point, x: blend(point.x, intake.x), y: blend(point.y, intake.y + INTAKE_CLEARANCE), z: blend(point.z, intake.z) };
}

export const LIVE = new Set(['queued', 'running']);
export const FINISHED = new Set(['done', 'failed', 'stopped']);
// Closed for good with nothing left to collect: these stations are
// decommissioned and stand dark on the floor. A failed one stays lit to be
// seen, and a `ready` one still holds the result its parent has not taken.
export const CLOSED = new Set(['done', 'stopped']);

// How weathered a station decommissioned `minutes` ago looks, from 0 as it
// closes to 1 a day on: quick at first, then slower.
export function weathering(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(1, Math.log1p(minutes / 2) / Math.log1p(720));
}

// A trip to another run's town covers about `TRIP_LENGTH` of open ground,
// further than any town's ground sheet reaches, in `TRIP_TIME` seconds.
export const TRIP_LENGTH = 108;
export const TRIP_TIME = 1.6;

// Where the town being left stands, measured from the one ahead, which lies
// towards `direction` ({ x, z }, of any length; east when it has none). `tile`
// is how far the ground's texture runs before it repeats ({ x, z }): the trip
// is a whole number of tiles each way, so one town's ground meets the other's
// without a seam.
export function tripShift(direction, tile = null) {
  const length = Math.hypot(Number(direction?.x) || 0, Number(direction?.z) || 0);
  const unit = length ? { x: direction.x / length, z: direction.z / length } : { x: 1, z: 0 };
  const along = (share, size) => (size > 0 && size < TRIP_LENGTH / 4
    ? Math.round(share * TRIP_LENGTH / size) * size : share * TRIP_LENGTH);
  return { x: 0 - along(unit.x, tile?.x), z: 0 - along(unit.z, tile?.z) };
}

// The share of a trip still ahead `elapsed` seconds in: 1 on leaving, 0 on
// arrival, and slow at both ends.
export function tripLeft(elapsed) {
  const t = Math.max(0, Math.min(1, elapsed / TRIP_TIME));
  return 1 - t * t * (3 - 2 * t);
}

// How far a trip has crossed from the departing town's mood to the arriving
// town's: stays 0 while the departing town is still in view, eases across the
// empty ground between them, and reaches 1 before the arriving town comes in.
export function tripMood(left) {
  const t = Math.max(0, Math.min(1, (0.7 - left) / 0.4));
  return t * t * (3 - 2 * t);
}

// A painted floor (app-plugins/README.md, `view.painting`) is seen from where
// its painter stood: `eyeHeight` above the ground, facing -z and `elevation`
// radians below the horizon, with a field of view of `fov` degrees up the
// height of a frame `size` [width, height] pixels. The painter stands where
// the frame pixel `anchor.at` [x, y] falls on the ground point `anchor.on`
// { x, z }. This maps frame pixels to the ground, an upright wall or a depth
// along the view, and world points back to the frame.
export function paintedCamera({ size: [width, height], fov, elevation, eyeHeight, anchor = null }) {
  const sin = Math.sin(elevation);
  const cos = Math.cos(elevation);
  const slope = Math.tan(fov * Math.PI / 360);
  const eye = { x: 0, y: eyeHeight, z: 0 };
  // The ray through frame pixel (px, py), one unit along the view.
  const ray = (px, py) => {
    const up = (height - 2 * py) / height * slope;
    return { x: (2 * px - width) / height * slope, y: up * cos - sin, z: -up * sin - cos };
  };
  const along = (direction, t) => ({ x: eye.x + direction.x * t, y: eye.y + direction.y * t, z: eye.z + direction.z * t });
  const ground = (px, py) => {
    const direction = ray(px, py);
    return along(direction, -eye.y / direction.y);
  };
  if (anchor) {
    const at = ground(anchor.at[0], anchor.at[1]);
    eye.x = anchor.on.x - at.x;
    eye.z = anchor.on.z - at.z;
  }
  return {
    eye: { ...eye }, width, height, fov, elevation,
    // Where frame pixel (px, py) falls on the ground, y 0.
    ground,
    // Where it falls on the upright wall z = `z`.
    wall(px, py, z) {
      const direction = ray(px, py);
      return along(direction, (z - eye.z) / direction.z);
    },
    // The point `depth` along the view behind it: a sheet laid at one depth
    // fills the frame as the flat painting does.
    sheet(px, py, depth) {
      return along(ray(px, py), depth);
    },
    // Where the world point (x, y, z) shows in the frame, in pixels.
    frame(x, y, z) {
      const dy = y - eye.y;
      const dz = z - eye.z;
      const depth = -sin * dy - cos * dz;
      return {
        x: ((x - eye.x) / depth / slope * height + width) / 2,
        y: (height - (cos * dy - sin * dz) / depth / slope * height) / 2,
      };
    },
  };
}

// The view of a painted floor is a window on its painting rather than a
// camera that moves: the window's centre `x`, `y` and width `w`, in frame
// pixels, with the pane's `aspect` (width over height) setting its height.
// `art` is the painted extent { left, top, right, bottom }, and no window
// shows past it.
const within = (value, low, high) => (low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high));

// The widest window of `aspect` that the art fills.
export function widestWindow(aspect, art) {
  return Math.min(art.right - art.left, (art.bottom - art.top) * aspect);
}

// `view` kept on the art: at least `least` wide where the art allows it, no
// wider than the art, and slid back over it.
export function holdWindow(view, aspect, art, least = 0) {
  const most = widestWindow(aspect, art);
  const w = Math.min(Math.max(view.w, Math.min(least, most)), most);
  const h = w / aspect;
  return {
    x: within(view.x, art.left + w / 2, art.right - w / 2),
    y: within(view.y, art.top + h / 2, art.bottom - h / 2),
    w,
  };
}

// The smallest window of `aspect` that shows all of `box` { left, top, right,
// bottom }, kept on the art. A box taller than any window the art allows (a
// very wide pane) keeps its top in view, where the hall stands at the back of
// the floor.
export function fitWindow(box, aspect, art, least = 0) {
  const w = Math.max(box.right - box.left, (box.bottom - box.top) * aspect, least);
  const view = holdWindow({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2, w }, aspect, art, least);
  const h = view.w / aspect;
  return h >= box.bottom - box.top ? view : holdWindow({ ...view, y: box.top + h / 2 }, aspect, art, least);
}

// `view` rescaled to width `w` about `anchor` ({ x, y }: a painting point that
// stays where it is on screen, the centre without one), kept on the art.
export function zoomWindow(view, w, anchor, aspect, art, least = 0) {
  const at = anchor || view;
  const scale = w / view.w;
  return holdWindow({ x: at.x + (view.x - at.x) * scale, y: at.y + (view.y - at.y) * scale, w }, aspect, art, least);
}

// A trip's window with `left` (1 on leaving, 0 on arrival) of it still ahead:
// it slides from `from`, over the town left (whose painting stands `shift`
// pixels along from this one's), to `to`, and widens by up to `lift` midway,
// no further than the art's height and the two paintings' width allow. It
// stays over the two towns' paintings.
export function tripWindow(from, to, left, aspect, art, lift = 0, shift = 0) {
  const w = to.w + (from.w - to.w) * left;
  const tallest = (art.bottom - art.top) * aspect;
  const span = art.right - art.left + Math.abs(shift);
  const wide = Math.max(w, Math.min(w * (1 + Math.sin(left * Math.PI) * lift), tallest, span));
  const h = wide / aspect;
  return {
    x: within(to.x + (from.x - to.x) * left, art.left + Math.min(0, shift) + wide / 2, art.right + Math.max(0, shift) - wide / 2),
    y: within(to.y + (from.y - to.y) * left, art.top + h / 2, art.bottom - h / 2),
    w: wide,
  };
}

// How many blips stand for a hand-off of `bytes`: one for a line or two, six
// for anything past a few kilobytes. A hand-off of unknown size is one blip.
export function packetBlips(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 1;
  return Math.max(1, Math.min(6, Math.ceil(Math.log2(bytes / 128 + 1))));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function bezier(a, b, c, t) {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
}

function polyline(points, progress) {
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let left = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (left <= length || index === lengths.length - 1) {
      const t = length ? Math.min(1, left / length) : 1;
      const [ax, az] = points[index];
      const [bx, bz] = points[index + 1];
      return { x: lerp(ax, bx, t), z: lerp(az, bz, t), heading: Math.atan2(bx - ax, bz - az) };
    }
    left -= length;
  }
  const [x, z] = points[points.length - 1];
  return { x, z, heading: Math.PI };
}

// A skin may reshape the floor (app-plugins/README.md): `bend` slants each row
// into a chevron by that much per column (negative sweeps the outer stations
// back beside the hall, positive brings them forward), `stagger` slides the right-hand rows forward by that share of a
// row, `jitter` nudges every station off the grid, and `turn` angles their
// fronts from the aisle towards the camera.
const LIMITS = { bend: [-0.8, 0.8], stagger: [0, 0.5], jitter: [0, 0.25], turn: [0, 0.6] };
const INNER = Math.abs(COLUMNS[0]);

const noise = (slot, salt) => {
  const value = Math.sin(slot * 127.1 + salt * 311.7) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

export function createLayout(spec = {}) {
  const shape = {};
  for (const [key, [low, high]] of Object.entries(LIMITS)) {
    shape[key] = Math.max(low, Math.min(high, Number(spec?.[key]) || 0));
  }
  // A row's z at `reach` from the aisle, before any jitter.
  const rowZ = (side, reach, row) => {
    const column = Math.max(0, reach / INNER - 1);
    return FIRST_ROW + row * ROW_GAP + shape.bend * column + (side > 0 ? shape.stagger * ROW_GAP : 0);
  };
  const gapZ = (side, reach, row) => rowZ(side, reach, row) - ROW_GAP / 2;
  // Slots fill outwards from the hall door, favouring depth over width so a
  // small crew stays compact whatever the pane's shape. The order is the
  // grid's, so a station keeps its slot number under every shape.
  const slots = COLUMNS.flatMap(x => Array.from({ length: ROWS }, (_, row) => ({ x, row, z: FIRST_ROW + row * ROW_GAP })))
    .sort((a, b) => Math.hypot(a.x * 1.25, a.z - DOOR.z) - Math.hypot(b.x * 1.25, b.z - DOOR.z) || a.x - b.x)
    .map(({ x, row }, slot) => {
      const side = Math.sign(x);
      const reach = Math.abs(x);
      const yaw = (side > 0 ? -1 : 1) * (Math.PI / 2 - shape.turn) + noise(slot, 3) * shape.jitter * 0.6;
      return {
        x: x + noise(slot, 1) * shape.jitter,
        z: rowZ(side, reach, row) + noise(slot, 2) * shape.jitter,
        row, side, column: Math.round(reach / INNER) - 1, reach, yaw,
      };
    });

  for (const spot of slots) Object.assign(spot, spec?.position?.(spot));
  const driveways = spec?.driveway && slots.map(spot => spec.driveway(spot));
  const slotOrder = Object.fromEntries(Object.entries(spec?.preferredColumns || {}).map(([kind, columns]) => {
    const rank = column => columns.includes(column) ? columns.indexOf(column) : columns.length;
    return [kind, slots.map((_, index) => index).sort((a, b) =>
      rank(slots[a].column) - rank(slots[b].column) || slots[a].row - slots[b].row || slots[a].side - slots[b].side)];
  }));

  const slotPosition = slot => {
    const { x, z, row, side, column, yaw } = slots[slot];
    return { x, z, row, side, column, yaw };
  };

  // Where a station's crate comes out: in front of it, towards the aisle.
  const outlet = slot => {
    if (driveways) {
      const [x, z] = driveways[slot][0];
      return { x, z };
    }
    const { x, z, yaw } = slots[slot];
    return { x: x + Math.sin(yaw) * OUTLET, z: z + Math.cos(yaw) * OUTLET };
  };

  // How far the used floor reaches: sideways from the aisle and forwards from
  // the hall, and in how many rows and columns of lots either side, for
  // framing the camera. An empty floor still frames the first row.
  function framing(floor) {
    let rows = 1;
    let columns = 1;
    let reach = COLUMNS[1];
    let front = slots[0].z;
    for (const { slot } of floor.values()) {
      const spot = slots[slot];
      rows = Math.max(rows, spot.row + 1);
      columns = Math.max(columns, spot.column + 1);
      reach = Math.max(reach, Math.abs(spot.x));
      front = Math.max(front, spot.z);
    }
    return { rows, columns, reach, front };
  }

  // A ground carrier drives out of the station's outlet into the gap on the
  // hall side of its row, along that gap to the aisle, then up the aisle to the
  // door, so it never drives through another station.
  function groundLegs(slot) {
    if (driveways) return driveways[slot];
    const { side, row, reach } = slots[slot];
    const start = outlet(slot);
    const from = Math.abs(start.x);
    const inner = COLUMNS.map(Math.abs).filter((x, index, all) => all.indexOf(x) === index && x < from && x < reach)
      .sort((a, b) => b - a).map(x => [side * x, gapZ(side, x, row)]);
    return [[start.x, start.z], [start.x, gapZ(side, from, row)], ...inner, [0, gapZ(side, 0, row)], [DOOR.x, DOOR.z]];
  }

  // Length of the trip from a slot to the door, which sets its duration.
  function routeLength(slot, route = 'air') {
    const start = outlet(slot);
    if (route === 'air') return Math.hypot(start.x - DOOR.x, start.z - DOOR.z);
    const points = groundLegs(slot);
    return points.slice(1).reduce((sum, point, index) =>
      sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0);
  }

  // Where a carrier is `progress` (0 to 1) of the way from the station in
  // `slot` to the hall door, and the yaw that faces it along its way. An air
  // carrier arcs over the stations at `cruise` height; a ground one stays on the
  // floor.
  function routePoint(slot, progress, route = 'air', cruise = 3) {
    const t = Math.max(0, Math.min(1, progress));
    if (route !== 'air') return { ...polyline(groundLegs(slot), t), y: 0 };
    const from = outlet(slot);
    const start = [from.x, from.z];
    const end = [DOOR.x, DOOR.z];
    const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const height = cruise + Math.hypot(end[0] - start[0], end[1] - start[1]) * 0.08;
    const at = u => ({
      x: bezier(start[0], middle[0], end[0], u),
      y: bezier(HOVER, height, HOVER, u),
      z: bezier(start[1], middle[1], end[1], u),
    });
    const here = at(t);
    const ahead = at(Math.min(1, t + 0.02));
    const behind = at(Math.max(0, t - 0.02));
    return { ...here, heading: Math.atan2(ahead.x - behind.x, ahead.z - behind.z) };
  }

  return { shape, slotPosition, slotOrder, outlet, framing, routeLength, routePoint };
}

// A floor opening on `agents` (oldest first) shows the ones that closed
// before `recent` (milliseconds since the epoch) already decommissioned. It
// stands as many as there is room for beside everyone else, the newest: they
// are `stale`. The older ones are `gone` from the start rather than built and
// cleared away again.
export function openingFloor(agents, recent) {
  const closed = agents.filter(agent => CLOSED.has(agent.state) && !(agent.endedAt > recent));
  const room = Math.max(0, CAPACITY - (agents.length - closed.length));
  const cut = Math.max(0, closed.length - room);
  return {
    stale: new Set(closed.slice(cut).map(agent => agent.id)),
    gone: new Set(closed.slice(0, cut).map(agent => agent.id)),
  };
}

// Takes out of `retired` and `gone` the agents a new snapshot no longer holds
// there, and returns the ids of those working again, whose stations come back.
// An agent that made way stays gone while it is finished, failed included,
// or two finished agents would take each other's slot on every snapshot.
export function reopened(retired, gone, agents) {
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const working = [];
  for (const id of retired) {
    const agent = byId.get(id);
    if (agent && CLOSED.has(agent.state)) continue;
    retired.delete(id);
    if (agent) working.push(id);
  }
  for (const id of gone) {
    if (!FINISHED.has(byId.get(id)?.state)) gone.delete(id);
  }
  return working;
}

const naturalOrder = Array.from({ length: CAPACITY }, (_, slot) => slot);

// `previous` maps agent id to { slot, state, order } from the last plan; it is
// empty for the first snapshot. `agents` is the new snapshot, oldest first.
// A station keeps its slot for as long as its agent is listed, decommissioned
// or not. When the floor is full the oldest decommissioned station (one in
// `retired`) makes way, or failing that the oldest finished one; when every
// station is still working the newcomer waits for a later snapshot. An agent
// in `gone` already made way and gets no station back. Events say what moved.
export function planFloor(previous, agents, gone = new Set(), retired = new Set(), slotOrder = {}) {
  const floor = new Map();
  const events = [];
  const listed = new Set(agents.map(agent => agent.id));
  let order = 0;
  for (const [id, spot] of previous) {
    order = Math.max(order, spot.order + 1);
    if (listed.has(id)) floor.set(id, { ...spot });
    else events.push({ type: 'remove', id, slot: spot.slot });
  }
  const taken = new Set([...floor.values()].map(spot => spot.slot));
  let waiting = 0;
  for (const agent of agents) {
    const spot = floor.get(agent.id);
    if (spot) {
      if (spot.state !== agent.state) {
        events.push({ type: 'state', id: agent.id, slot: spot.slot, from: spot.state, to: agent.state });
        spot.state = agent.state;
      }
      continue;
    }
    if (gone.has(agent.id)) continue;
    const candidates = slotOrder[agent.kind === 'worker' ? 'worker' : 'subagent'] || naturalOrder;
    let slot = candidates.find(candidate => !taken.has(candidate)) ?? -1;
    if (slot === -1) {
      const kept = id => (retired.has(id) ? 0 : 1);
      const oldest = [...floor].filter(([, other]) => FINISHED.has(other.state))
        .sort((a, b) => kept(a[0]) - kept(b[0]) || a[1].order - b[1].order)[0];
      if (oldest) {
        floor.delete(oldest[0]);
        events.push({ type: 'retire', id: oldest[0], slot: oldest[1].slot });
        slot = oldest[1].slot;
      }
    }
    if (slot === -1) {
      waiting += 1;
      continue;
    }
    taken.add(slot);
    floor.set(agent.id, { slot, state: agent.state, order: order++ });
    events.push({ type: 'spawn', id: agent.id, slot, state: agent.state });
  }
  return { floor, events, waiting };
}

// The plain grid, which a skin without a `layout` gets.
export const { slotPosition, outlet, framing, routeLength, routePoint } = createLayout();
