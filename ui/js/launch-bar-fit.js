// Keeps the new-run composer's start bar on one line on a desktop. Each
// launch toggle that is on keeps its name while the row fits; when it does
// not, names give way one at a time from the right (Evals, then Auto merge,
// permissions and Fast) and a toggle without its name keeps its round icon
// (launch-icon-toggle.js). If the row still wraps with every name gone, it
// turns `data-tight`: the effort track narrows, then the model's name
// (project-home.css). The fit is measured from what the row holds, so a
// longer model name or a new package toggle cannot bring the wrap back.
// On a phone the toggles share the model's row as round icons, so every one
// is compact there, before a press, and none grows when pressed.

const PHONE = '(max-width: 700px)';

const showsName = toggle => [...toggle.shadowRoot.querySelectorAll('[part~="name"]')]
  .some(name => name.getClientRects().length);

// The row wraps when a shown field starts below the first one's bottom edge.
const wraps = row => {
  const boxes = [...row.children].map(field => field.getBoundingClientRect()).filter(box => box.height);
  return boxes.some(box => box.top >= boxes[0].bottom - 1);
};

function fit(row) {
  const toggles = [...row.querySelectorAll(':scope > .newconv-field > *')].filter(el => el.shadowRoot);
  const phone = matchMedia(PHONE).matches;
  row.removeAttribute('data-tight');
  for (const toggle of toggles) toggle.toggleAttribute('compact', phone);
  if (!row.isConnected || phone) return;
  const named = toggles.filter(showsName).reverse();
  while (named.length && wraps(row)) named.shift().setAttribute('compact', '');
  if (!wraps(row)) return;
  row.setAttribute('data-tight', '');
  // Past the narrowest the fields go, a second line beats overlapping the send button.
  if (row.scrollWidth > row.clientWidth + 1) row.removeAttribute('data-tight');
}

export function fitLaunchBar(row) {
  if (!row) return;
  // Waiting a frame lets the row settle after a change and keeps the
  // observer from resizing what it is still reporting.
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit(row); });
  };
  const observer = new ResizeObserver(schedule);
  // A pill or a field's contents resize its field. The footer and the
  // actions beside the row (the send button's label) change the room it has.
  const observe = () => {
    for (const box of [row.parentElement, ...row.parentElement.children, ...row.children]) observer.observe(box);
  };
  observe();
  new MutationObserver(() => { observe(); schedule(); }).observe(row, { childList: true, subtree: true });
  fit(row);
}
