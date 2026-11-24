// Shared by the Factory tab (factory.js) and the landing page's floor (site/).
// Where each floor label sits, in CSS pixels: on its anchor when that is clear,
// else lifted or dropped a whole pill height at a time to the nearest slot that
// covers nothing placed before it. Items come in priority order and are laid
// down in it, so which pill yields never flips while the camera drifts; a pill
// keeps a slot it already holds while that stays clear, so two labels at the
// same height do not trade places every frame. Each item is { x, y, w, h, slot }
// with (x, y) the bottom centre; returns the chosen slot and y for each.
export function factoryLabelSlots(items, height) {
  const gap = 3;
  const placed = [];
  const covered = (x, y, w, h) => placed.reduce((sum, other) => {
    const across = (w + other.w) / 2 + gap - Math.abs(x - other.x);
    const down = Math.min(y, other.y) - Math.max(y - h, other.y - other.h) + gap;
    return across > 0 && down > 0 ? sum + across * down : sum;
  }, 0);
  return items.map(item => {
    const step = item.h + gap;
    const top = item.h + 4;
    const bottom = Math.max(top, height - 6);
    const order = [0, item.slot || 0, -1, 1, -2, 2, -3, 3, -4, 4];
    let best = null;
    for (const slot of order) {
      const y = item.y + slot * step;
      if (y < top || y > bottom) continue;
      const overlap = covered(item.x, y, item.w, item.h);
      if (!best || overlap < best.overlap) best = { slot, y, overlap };
      if (!overlap) break;
    }
    best ??= { slot: 0, y: Math.min(Math.max(item.y, top), bottom) };
    placed.push({ x: item.x, y: best.y, w: item.w, h: item.h });
    return { slot: best.slot, y: best.y };
  });
}

// The size of a set of instructions or a result, as a job ticket writes it.
export function factoryBytesText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${bytes} B`;
  const [value, unit] = bytes < 1e6 ? [bytes / 1e3, 'kB'] : [bytes / 1e6, 'MB'];
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}
