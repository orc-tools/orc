// A skill's crest, as SVG text: its sigil inside a ring cut into one arc per
// harness, in the harnesses' own order starting at twelve o'clock.
import { esc } from '/js/core.js';
import { sigilStrokes, skillTone, skillsHue } from './model.js';

const round = value => Math.round(value * 100) / 100;

const CREST = 48;
const CREST_RADIUS = 20;
const CREST_STEP = 6.5;

function crestPoint(radius, degrees) {
  const radians = degrees * Math.PI / 180;
  return [round(CREST / 2 + radius * Math.cos(radians)), round(CREST / 2 + radius * Math.sin(radians))];
}

export function crestSvg(skill, { large = false } = {}) {
  const tone = skillTone(skill);
  const instances = skill?.instances || [];
  const step = instances.length ? 360 / instances.length : 360;
  const gap = instances.length > 1 ? Math.min(10, step * 0.2) : 0;
  const arcs = instances.map((inst, index) => {
    const a0 = -90 + index * step + gap / 2;
    const a1 = -90 + (index + 1) * step - gap / 2;
    const [x0, y0] = crestPoint(CREST_RADIUS, a0);
    const [x1, y1] = crestPoint(CREST_RADIUS, a1 - (instances.length === 1 ? 0.01 : 0));
    return `<path class="skills-crest-arc is-${esc(inst.state)}" data-target="${esc(inst.targetId)}" d="M${x0} ${y0}A${CREST_RADIUS} ${CREST_RADIUS} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}"/>`;
  });
  const at = lattice => [
    round(CREST / 2 + ((lattice % 3) - 1) * CREST_STEP),
    round(CREST / 2 + (Math.floor(lattice / 3) - 1) * CREST_STEP),
  ];
  const strokes = sigilStrokes(skill?.slug).map(([from, to]) => `M${at(from).join(' ')}L${at(to).join(' ')}`).join('');
  const hue = tone === 'plugin' ? '' : ` style="--skills-hue:${skillsHue(skill?.slug)}"`;
  return `<span class="skills-crest is-${tone}${large ? ' is-large' : ''}"${hue} aria-hidden="true"><svg viewBox="0 0 ${CREST} ${CREST}" focusable="false">
    ${arcs.length ? arcs.join('') : `<circle class="skills-crest-arc is-excluded" cx="${CREST / 2}" cy="${CREST / 2}" r="${CREST_RADIUS}"/>`}
    <path class="skills-crest-sigil" d="${strokes}"/>
  </svg></span>`;
}
