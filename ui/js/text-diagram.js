// orc-ui: a ```diagram block, the box-drawing text art agents write, drawn as
// SVG on its own character grid. As text, any glyph the code font lacks falls
// back to a face of another width and drags the rest of its line out of
// column, and box-drawing characters show as dashes that never quite join.

import { esc } from './core.js';

// One cell of a chat code block: JetBrains Mono advances 0.6em at 12.5px,
// and a line is 1.6 times the font size.
const CELL = 7.5;
const ROW = 20;
const ARROW = CELL;

// The edges each character of U+2500–U+257F reaches, one hex digit per code
// point: up 1, right 2, down 4, left 8. Heavy, double, dashed and rounded
// forms draw as the plain line; the diagonals at 0x71–0x73 are DIAGONALS.
const LINKS = 'aa55aa55aa55' + '6666cccc33339999' + '77777777dddddddd' + 'eeeeeeeebbbbbbbb'
  + 'ffffffffffffffff' + 'aa55a5' + '666ccc333999777dddeeebbbfff' + '6c93' + '000'
  + '81248124' + 'a5a5';
// Corner to corner, as fractions of the cell.
const DIAGONALS = { '╱': [[0, 1, 1, 0]], '╲': [[0, 0, 1, 1]], '╳': [[0, 1, 1, 0], [0, 0, 1, 1]] };
const ARROWS = { '▶': 'r', '►': 'r', '▸': 'r', '◀': 'l', '◄': 'l', '◂': 'l', '▲': 'u', '▴': 'u', '▼': 'd', '▾': 'd' };

function links(char) {
  const point = char.codePointAt(0) - 0x2500;
  return point >= 0 && point < LINKS.length ? parseInt(LINKS[point], 16) : 0;
}

const n = value => +value.toFixed(2);

// A line from the cell centre to each edge it reaches, so neighbouring cells
// meet edge to edge in one unbroken line.
function strokes(x, y, bits) {
  const cx = n(x + CELL / 2), cy = n(y + ROW / 2);
  return [[1, cx, y], [2, x + CELL, cy], [4, cx, y + ROW], [8, x, cy]]
    .filter(([bit]) => bits & bit)
    .map(([, ex, ey]) => `M${cx} ${cy}L${n(ex)} ${n(ey)}`).join('');
}

// A filled triangle whose tip sits on the edge it points at. A vertical one
// is shorter than its cell, so a stem carries the line from the cell behind.
function arrow(x, y, way, stemmed) {
  const cx = x + CELL / 2, cy = y + ROW / 2, half = ARROW / 2;
  if (way === 'r') return { head: [[x, cy - half], [x + CELL, cy], [x, cy + half]] };
  if (way === 'l') return { head: [[x + CELL, cy - half], [x, cy], [x + CELL, cy + half]] };
  const down = way === 'd';
  const tip = stemmed ? (down ? y + ROW : y) : cy + (down ? half : -half);
  const base = down ? tip - ARROW : tip + ARROW;
  return {
    head: [[cx - half, base], [cx, tip], [cx + half, base]],
    stem: stemmed ? `M${n(cx)} ${n(down ? y : y + ROW)}L${n(cx)} ${n(base)}` : '',
  };
}

export function textDiagramSvg(source) {
  const grid = String(source).replace(/\r\n?/g, '\n').split('\n').map(line => Array.from(line));
  const at = (row, col) => grid[row]?.[col] || ' ';
  const width = Math.max(1, ...grid.map(line => line.length)) * CELL;
  const height = grid.length * ROW;
  let lines = '';
  let heads = '';
  const texts = [];
  grid.forEach((line, row) => {
    const y = row * ROW;
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const xs = run.map(([col]) => n(col * CELL + CELL / 2)).join(' ');
      texts.push(`<text x="${xs}" y="${n(y + ROW / 2)}">${esc(run.map(([, char]) => char).join(''))}</text>`);
      run = [];
    };
    line.forEach((char, col) => {
      const x = col * CELL;
      const bits = links(char);
      const way = ARROWS[char];
      if (bits || DIAGONALS[char] || way || /\s/.test(char)) flush();
      if (bits) lines += strokes(x, y, bits);
      else if (DIAGONALS[char]) {
        lines += DIAGONALS[char].map(([x0, y0, x1, y1]) =>
          `M${n(x + x0 * CELL)} ${n(y + y0 * ROW)}L${n(x + x1 * CELL)} ${n(y + y1 * ROW)}`).join('');
      } else if (way) {
        const behind = { r: [row, col - 1, 2], l: [row, col + 1, 8], u: [row + 1, col, 1], d: [row - 1, col, 4] }[way];
        const { head, stem } = arrow(x, y, way, (links(at(behind[0], behind[1])) & behind[2]) !== 0);
        lines += stem || '';
        heads += `M${head.map(([px, py]) => `${n(px)} ${n(py)}`).join('L')}Z`;
      } else if (!/\s/.test(char)) {
        run.push([col, char]);
        // Engines differ on whether an astral character takes one position
        // or two; at the end of its run either count leaves the rest in place.
        if (char.length > 1) flush();
      }
    });
    flush();
  });
  return `<svg class="chat-diagram-svg" xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${height}" viewBox="0 0 ${n(width)} ${height}">`
    + (lines ? `<path class="chat-diagram-lines" d="${lines}"/>` : '')
    + (heads ? `<path class="chat-diagram-arrows" d="${heads}"/>` : '')
    + texts.join('') + '</svg>';
}
