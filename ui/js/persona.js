// The assistant is Gary or Sheila, drawn as the active theme's cutout of
// that character, gary.png or sheila.png. Its icon.png keeps the app-icon
// tile for the Dock and is never the face. A theme that ships no cutouts
// falls back to Orc's own pair, served from /assets/persona/.

import { availableThemes, paintedFunMode } from './fun-modes.js';

// TESTABLE: persona faces
export const PERSONAS = [
  { id: 'gary', name: 'Gary', blurb: 'Gruff, dry and always on your side' },
  { id: 'sheila', name: 'Sheila', blurb: 'Warm, sharp and keeps the camp running' },
];

export const personaId = value => (PERSONAS.some(persona => persona.id === value) ? value : 'gary');

export function personaFace(persona, theme, themes) {
  const id = personaId(persona);
  const found = (themes || []).find(item => item.id === theme);
  const file = found?.[id];
  return found?.base && file ? found.base + file : `/assets/persona/${id}.png`;
}
// END TESTABLE: persona faces

const face = persona => personaFace(persona, paintedFunMode(), availableThemes());

// Not core.js's esc: floating Gary draws while core.js is still loading, as
// it imports the modules that import this one.
const attribute = value => String(value).replace(/[&"<>]/g, char => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char]);

// Every face carries its persona, so a theme switch repaints them all in
// place rather than waiting for each view to render again.
export function personaImgHtml(persona, size) {
  const id = personaId(persona);
  return `<img class="persona-face" data-persona="${id}" src="${attribute(face(id))}" alt="" width="${size}" height="${size}" draggable="false">`;
}

export function paintFaces() {
  for (const image of document.querySelectorAll('img[data-persona]')) {
    const src = face(image.dataset.persona);
    if (image.getAttribute('src') !== src) image.setAttribute('src', src);
  }
}

window.addEventListener('orc-theme-painted', paintFaces);
window.addEventListener('orc-plugins-changed', paintFaces);
paintFaces();
