// The host's page as a cast sees it from the stage: where a point of the
// screen is in the scene, and the two papers of a send-off as a sheet the
// scene shows through only where they have parted. Upside Down's monster stands
// behind that sheet and reaches through the tear to haul it open.
import { DoubleSide, Group, Mesh, MeshBasicMaterial, Shape, ShapeGeometry } from 'three';
import { seamOutline } from '../js/scene-poses.js';
import { clamp, mix } from './stage.js';

// A point of the screen, `x` percent across and `y` percent down the scene as
// the host lays out its papers, `depth` in front of `camera`.
export function screenPoint(camera, x, y, depth, target) {
  const half = Math.tan(camera.fov * Math.PI / 360) * depth;
  return camera.localToWorld(target.set((x / 50 - 1) * half * camera.aspect, (1 - y / 50) * half, -depth));
}

// The host's two papers for the scene `spec` (one of SCENES in
// ui/js/scene-poses.js) as a sheet that draws nothing and hides whatever is
// behind it. It rides on `camera`, which must be in the scene.
export function createPageMask(camera, spec) {
  const sheet = new Group();
  const unseen = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
  const papers = [-1, 1].map(side => {
    const outline = new Shape();
    seamOutline(spec.seam, side).forEach(([x, y], i) => outline[i ? 'lineTo' : 'moveTo'](x - 50, 50 - y));
    const paper = new Mesh(new ShapeGeometry(outline), unseen);
    paper.renderOrder = -1;
    sheet.add(paper);
    return paper;
  });
  camera.add(sheet);
  const steps = spec.seam.length - 1;
  return {
    sheet,
    // The papers as the host has them at `t`, `depth` in front of the camera.
    update(t, depth) {
      const half = Math.tan(camera.fov * Math.PI / 360) * depth, wide = half * camera.aspect;
      spec.pose(t).papers.forEach(({ x, y, rotate, scale }, i) => {
        papers[i].position.set(x / 50 * wide, -y / 50 * half, -depth);
        papers[i].rotation.z = -rotate * Math.PI / 180;
        papers[i].scale.set(wide / 50 * scale, half / 50 * scale, 1);
      });
    },
    // Where the torn edge of the `side` paper (-1 left, 1 right) is at `t`,
    // `along` percent down it and `inset` percent into the paper: percent
    // across and down the screen, written into `target`'s x and y.
    edge(t, side, along, inset, target) {
      const { x, y, rotate, scale } = spec.pose(t).papers[side < 0 ? 0 : 1];
      const at = clamp(along / 100) * steps, i = Math.min(steps - 1, Math.floor(at));
      const turn = rotate * Math.PI / 180, aspect = camera.aspect;
      // The paper turns in pixels, so the sums are in percents of the height.
      const dx = (mix(spec.seam[i], spec.seam[i + 1], at - i) + side * inset) * aspect * scale, dy = (along - 50) * scale;
      target.x = 50 + x + (dx * Math.cos(turn) - dy * Math.sin(turn)) / aspect;
      target.y = 50 + y + dx * Math.sin(turn) + dy * Math.cos(turn);
      return target;
    },
  };
}
