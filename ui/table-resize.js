// Markdown tables in chat and in rendered documents get a resize handle on
// each header cell's right edge (the th::after strip in md-callouts.css).
// Dragging it sets that column's width and leaves the others alone, so the
// table grows or shrinks inside its scroll container. Double-clicking it fits
// the column to its widest cell, capped so a paragraph column cannot run off.
// The listeners sit on the document because chat rows and markdown panels
// are re-rendered all the time; a width lasts as long as its table node.

var ORC_COL_MIN = 48;
var ORC_COL_CAP = 0.6;
var ORC_COL_CAP_FLOOR = 240;
var orcColDrag = null;
var orcColHot = null;

// The header cell whose handle is under the pointer. The strip reaches 4px
// past the border into the next cell, and stays inside the last one so it
// cannot make the scroll container scroll.
function orcColHandle(event) {
  var th = event.target.closest ? event.target.closest('th') : null;
  if (!th) return null;
  var table = th.closest('table');
  if (!table || !table.matches('.md table, .chat-md table') || table.matches('.image-comparison > table')) return null;
  if (th.parentElement !== table.rows[0]) return null;
  var reach = th.nextElementSibling ? 4 : 8;
  return event.clientX >= th.getBoundingClientRect().right - reach ? th : null;
}

function orcColSetHot(th) {
  if (orcColHot === th) return;
  if (orcColHot) orcColHot.removeAttribute('data-col-resize-active');
  orcColHot = th;
  if (th) th.setAttribute('data-col-resize-active', '');
}

// Min and max width pin the column: without them auto layout would still
// stretch or squeeze it to share space with its neighbours.
function orcColSet(th, width) {
  th.style.width = th.style.minWidth = th.style.maxWidth = Math.max(ORC_COL_MIN, width) + 'px';
}

// The first resize pins every column at the width it renders at, so only the
// column being resized moves.
function orcColFreeze(table) {
  if (table.hasAttribute('data-col-resized')) return;
  var cells = Array.prototype.slice.call(table.rows[0].cells);
  var widths = cells.map(function (cell) { return cell.getBoundingClientRect().width; });
  table.setAttribute('data-col-resized', '');
  table.style.width = 'max-content';
  cells.forEach(function (cell, index) { orcColSet(cell, widths[index]); });
}

// The widest cell laid out on one line, plus the cell's padding and borders.
function orcColFit(th) {
  var table = th.closest('table');
  var cells = Array.prototype.map.call(table.rows, function (row) { return row.cells[th.cellIndex]; }).filter(Boolean);
  var range = document.createRange();
  var widest = 0;
  cells.forEach(function (cell) { cell.style.whiteSpace = 'nowrap'; });
  cells.forEach(function (cell) {
    range.selectNodeContents(cell);
    var style = getComputedStyle(cell);
    var frame = cell.getBoundingClientRect().width - cell.clientWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    widest = Math.max(widest, range.getBoundingClientRect().width + frame);
  });
  cells.forEach(function (cell) { cell.style.whiteSpace = ''; });
  var space = (table.closest('.chat-table') || table.parentElement).clientWidth;
  orcColSet(th, Math.min(Math.ceil(widest) + 1, Math.max(ORC_COL_CAP_FLOOR, space * ORC_COL_CAP)));
}

function orcColEnd(event) {
  if (!orcColDrag || event.pointerId !== orcColDrag.pointer) return;
  if (orcColDrag.type !== 'mouse') orcColSetHot(null);
  orcColDrag = null;
  document.documentElement.classList.remove('orc-col-resizing');
}

document.addEventListener('pointerdown', function (event) {
  if (event.button !== 0) return;
  var th = orcColHandle(event);
  if (!th) return;
  // Cancelling the press keeps it from selecting text, or a word on double-click.
  event.preventDefault();
  orcColFreeze(th.closest('table'));
  orcColDrag = { th: th, pointer: event.pointerId, type: event.pointerType, x: event.clientX, width: th.getBoundingClientRect().width };
  orcColSetHot(th);
  document.documentElement.classList.add('orc-col-resizing');
  // Capture keeps the moves, and the release, coming when the pointer leaves the window.
  th.setPointerCapture(event.pointerId);
});

document.addEventListener('pointermove', function (event) {
  if (orcColDrag) {
    if (event.pointerId === orcColDrag.pointer) orcColSet(orcColDrag.th, orcColDrag.width + event.clientX - orcColDrag.x);
    return;
  }
  if (event.pointerType === 'mouse') orcColSetHot(orcColHandle(event));
});

document.addEventListener('pointerup', orcColEnd, true);
document.addEventListener('pointercancel', orcColEnd, true);
document.addEventListener('lostpointercapture', orcColEnd, true);
document.documentElement.addEventListener('pointerleave', function () { if (!orcColDrag) orcColSetHot(null); });

document.addEventListener('dblclick', function (event) {
  var th = orcColHandle(event);
  if (!th) return;
  event.preventDefault();
  orcColFreeze(th.closest('table'));
  orcColFit(th);
});
