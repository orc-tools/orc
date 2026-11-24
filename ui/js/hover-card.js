// orc-ui: the one floating card that describes whatever the pointer or the
// keyboard focus rests on in a chat: a skill name, a run id.

let hoverCardElement = null;
function hoverCard() {
  if (hoverCardElement?.isConnected) return hoverCardElement;
  hoverCardElement = document.createElement('div');
  hoverCardElement.id = 'chat-hover-card';
  hoverCardElement.className = 'chat-hover-card';
  hoverCardElement.setAttribute('role', 'tooltip');
  hoverCardElement.hidden = true;
  document.body.append(hoverCardElement);
  return hoverCardElement;
}

export function showHoverCard(rect, html) {
  const element = hoverCard();
  element.innerHTML = html;
  element.hidden = false;
  const box = element.getBoundingClientRect();
  const below = rect.bottom + 6;
  const top = below + box.height > innerHeight - 8 && rect.top - box.height - 6 >= 8 ? rect.top - box.height - 6 : below;
  element.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`;
  element.style.top = `${top}px`;
}

export function hideHoverCard() {
  if (hoverCardElement) hoverCardElement.hidden = true;
  document.querySelectorAll('[aria-describedby="chat-hover-card"]').forEach(ref => ref.removeAttribute('aria-describedby'));
}

// `cardHtml(ref)` returns '' for a ref with nothing to say, which shows no card.
export function bindHoverCard(root, selector, cardHtml) {
  const refFrom = target => {
    const ref = target?.closest?.(selector);
    return ref && root.contains(ref) ? ref : null;
  };
  const showRef = ref => {
    hideHoverCard();
    const html = cardHtml(ref);
    if (!html) return;
    showHoverCard(ref.getBoundingClientRect(), html);
    ref.setAttribute('aria-describedby', 'chat-hover-card');
  };
  root.addEventListener('pointerover', event => {
    const ref = refFrom(event.target);
    if (ref && !ref.contains(event.relatedTarget)) showRef(ref);
  });
  root.addEventListener('pointerout', event => {
    const ref = refFrom(event.target);
    if (ref && !ref.contains(event.relatedTarget) && ref !== document.activeElement) hideHoverCard();
  });
  root.addEventListener('focusin', event => {
    const ref = refFrom(event.target);
    if (ref) showRef(ref);
  });
  root.addEventListener('focusout', event => { if (refFrom(event.target)) hideHoverCard(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && hoverCardElement && !hoverCardElement.hidden) hideHoverCard(); });
  root.addEventListener('scroll', hideHoverCard, true);
}
