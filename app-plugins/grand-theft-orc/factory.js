// Grand Theft Orc's Factory skin: Astra's painted motor court. The main agent
// works the motel's reception, workers take service garages and subagents
// roadside booths, and a coral coupe drives each collected envelope to the
// front desk. The floor is her painting, seen from where she painted it
// (factory-waterfront.js), by dusk in dark mode and on a clear morning in light.
import { Group } from 'three';
import { HALL } from '../../ui/yeet/factory-layout.js';
import { carrier, crate, packet } from './factory-courier.js';
import { floor, hall, layout, pileSpot, station, view } from './factory-waterfront.js';

// The painting carries the floor's own colours; these tint what the engine
// draws over it (the selection ring, dust and labels' lamps).
const palette = {
  light: {
    body: '#ffe1bf', trim: '#f6ccb1', roof: '#ee777b', accent: '#219d9c', glow: '#59c8bc',
    ground: '#988880', horizon: '#94d9d8', zenith: '#77c9e1', aisle: '#aa9990', line: '#fff2c5',
    door: '#315354', window: '#ffda98', chrome: '#c0c6b9', idle: '#646e6a', dust: '#5c6362',
    busy: '#e9ac53', ok: '#6caa65', fail: '#d9495a', crate: '#ffdfa5', tape: '#c76e51',
    sky: '#fff0d1', sun: '#fff3db', sunIntensity: 2.15, skyIntensity: 1.55, envIntensity: 0.45, exposure: 1.03,
    fogNear: 13, fogSpan: 45,
  },
  dark: {
    body: '#a47983', trim: '#80687b', roof: '#f56079', accent: '#20dbdf', glow: '#52dedc',
    ground: '#292838', horizon: '#4a4b77', zenith: '#181e44', aisle: '#434054', line: '#b0a1ad',
    door: '#302d43', window: '#ffb54e', chrome: '#9597ab', idle: '#586077', dust: '#292935',
    busy: '#ffca6b', ok: '#94c780', fail: '#ff697c', crate: '#ffd58b', tape: '#ff8075',
    sky: '#e1d6fa', sun: '#ffcfaa', sunIntensity: 1.85, skyIntensity: 1.3, envIntensity: 0.6, exposure: 1.03,
    fogNear: 13, fogSpan: 45,
  },
};

export default {
  palette, layout, view, floor, carrier, crate, packet, pileSpot, station,
  hall: kit => hall(kit, HALL),
  ghost: (kit, kind, spot) => station(kit, kind, spot, true),
  decor: () => new Group(),
  pad: false, dock: false, ruin: false,
};
