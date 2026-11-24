import { Color, DoubleSide, InstancedMesh, MeshBasicMaterial, Object3D, OctahedronGeometry, PlaneGeometry } from 'three';
import { range, smooth } from './stage.js';

// The all-settled scenes' beat, which ui/js/scene-poses.js names `lands` for its
// `clear` scene: the word pops and the first shells burst.
export const CLEAR_LANDS = 1.45;

// [burst time, x, y, z] for a show that opens on `lands` with a pair either
// side of the cast, then answers itself across the sky until the scene fades.
export function finale(lands = CLEAR_LANDS) {
  return [
    [0, -3.4, 4.9, -3], [0, 3.5, 5.2, -3.4], [.42, 0, 6.3, -5], [.86, -5, 3.8, -2.4], [1.12, 4.9, 4.1, -2.6],
    [1.5, -2.1, 6, -4.4], [1.86, 2.4, 5.7, -4], [2.3, -4.2, 5.1, -3.2], [2.52, 4.3, 5.4, -3.6], [2.9, 0, 5.2, -3],
  ].map(([after, ...at]) => [lands + after, ...at]);
}

// Fireworks drawn in one call: each shell climbs from the floor, bursts into
// `sparks` and falls away, every spark trailing two fainter copies of itself.
// A spark sits on a fixed stride of its index, so a frame is a pure function
// of time. `map` draws each spark as a white shape tinted with its colour and
// turned to the camera; without one they are tumbling chips of `geometry`.
const TRAIL = [[0, 1], [.05, .7], [.1, .45]];

export function createFireworks(scene, camera, { shells = finale(), colors, sparks = 30, size = .2, reach = 2.8, life = 1.4, map = null, geometry = null }) {
  const perShell = 1 + sparks * TRAIL.length;
  const material = new MeshBasicMaterial(map
    ? { map, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide }
    : { toneMapped: false, side: DoubleSide });
  const mesh = new InstancedMesh(map ? new PlaneGeometry(1, 1) : geometry || new OctahedronGeometry(1, 0), material, shells.length * perShell);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  const colour = new Color();
  shells.forEach((_, shell) => {
    for (let i = 0; i < perShell; i++) {
      // A shell is one colour with every fourth spark the next, as real stars are packed.
      const spark = Math.floor((i - 1) / TRAIL.length);
      mesh.setColorAt(shell * perShell + i, colour.set(colors[(shell + (i && spark % 4 === 3 ? 1 : 0)) % colors.length]));
    }
  });
  scene.add(mesh);
  const at = new Object3D();
  const place = (index, x, y, z, width, height, spin) => {
    at.position.set(x, y, z);
    if (map) {
      at.quaternion.copy(camera.quaternion);
      at.rotateZ(spin);
    } else at.rotation.set(spin * 1.3, spin, spin * .7);
    at.scale.set(width, height, width);
    at.updateMatrix();
    mesh.setMatrixAt(index, at.matrix);
  };
  return {
    mesh,
    // How bright the sky is at `t`: 1 as a shell bursts, fading with it.
    flash(t) {
      let most = 0;
      for (const [burst] of shells) if (t >= burst) most = Math.max(most, Math.exp(-(t - burst) * 5));
      return most;
    },
    update(t) {
      shells.forEach(([burst, x, y, z], shell) => {
        const first = shell * perShell;
        const climb = range(t, burst - .5, burst);
        const rising = climb > 0 && climb < 1 ? size : 0;
        place(first, x + Math.sin(climb * 9 + shell) * .08, y * (1 - (1 - climb) ** 2), z, rising * (map ? .9 : .4), rising * (map ? .9 : 1.8), map ? 0 : shell);
        for (let i = 0; i < sparks; i++) {
          const lasts = life * (.7 + ((i * 7) % 10) / 10 * .45);
          const up = 1 - 2 * (i + .5) / sparks, round = Math.sqrt(1 - up * up), turn = i * 2.39996 + shell;
          const speed = .65 + ((i * 13 + shell * 5) % 10) / 10 * .5;
          TRAIL.forEach(([behind, share], copy) => {
            const age = t - burst - behind;
            const live = age > 0 && age < lasts;
            const travel = live ? (1 - Math.exp(-age * 3.2)) * reach * speed : 0;
            const scale = live ? size * share * (.7 + (i % 5) * .15) * (1 - smooth(age / lasts)) * (.8 + .2 * Math.sin(age * 31 + i * 2.1)) : 0;
            place(first + 1 + i * TRAIL.length + copy, x + Math.cos(turn) * round * travel, y + up * travel - age * age * 1.5,
              z + Math.sin(turn) * round * travel * .5, scale, scale, age * (3 + i % 4) * (i % 2 ? 1 : -1) + i);
          });
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
