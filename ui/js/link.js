// orc-ui: linked laptops (/api/link). The header switch moves this window
// between the laptops' Orcs, the code dialog shows a pairing code another
// laptop asked for, and the banner holds what waits for a sleeping laptop.
// The Settings card pairs and unlinks. /api/link always answers from this
// laptop's side, so the same calls work from any window.

import { $, announce, esc, labelMenuTrigger, showToast } from './core.js';
import { pluginStatuses } from './app-plugins.js';
import { cliCompatStatuses, paintCliCompatChecked } from './cli-compat.js';
import { desktopUpdateStatuses } from './desktop-update.js';
import { leaveForLaptop, resetLaptopSwitch } from './laptop-switch.js';

const LINK_POLL_MS = 10000;
const LINK_PAIRING_POLL_MS = 3000;
// The server keeps tunnels dialled ahead for about 15s after each warm.
const LINK_WARM_MS = 10000;
const link = { status: null, checked: false, timer: 0, found: [], pairing: null, editing: null, warmedAt: 0, warmed: {}, syncErrors: {}, unlinking: null };

// TESTABLE: link view model
// A switched window can load this script from a newer Orc than the laptop
// answering /api/link, whose status then has one `peer` and no `peers`.
function linkPeers(status) {
  return status?.peers || (status?.peer ? [status.peer] : []);
}

function linkSamePeer(a, b) {
  return !!a && !!b && (a === b || a.id === b.id);
}

function linkShownPeer(status) {
  if (status?.viewing !== 'peer') return null;
  const peers = linkPeers(status);
  return peers.find(peer => linkSamePeer(peer, status.peer)) || peers[0] || null;
}

function linkNames(names) {
  return names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function linkPeerHref(status, peer) {
  if (status.remote) return (peer.switchUrl === undefined ? status.switchUrl : peer.switchUrl) || '';
  const port = peer.viewPort === undefined ? status.viewPort : peer.viewPort;
  return port ? `http://127.0.0.1:${port}/` : '';
}

const LINK_PHONE_ACCESS = name => `Turn on Phone access in the Tailscale plugin on ${name}, then let the laptops reconnect`;

// With one linked laptop the badge flips between the two. With more it opens
// `menu`, one row per laptop.
export function linkSwitchModel(status) {
  const peers = linkPeers(status);
  if (!peers.length) return null;
  const shownPeer = linkShownPeer(status);
  const shown = shownPeer ? shownPeer.name : status.selfName;
  const asleep = !!shownPeer && !shownPeer.online;
  const selfHref = status.remote ? '' : `http://127.0.0.1:${status.localPort}/`;
  if (peers.length === 1) {
    const peer = peers[0];
    const other = shownPeer ? status.selfName : peer.name;
    const otherAsleep = !shownPeer && !peer.online;
    const href = shownPeer ? selfHref : linkPeerHref(status, peer);
    return {
      text: asleep ? `${shown} · asleep` : shown,
      label: status.remote
        ? `Showing ${shown}. ${href ? `Switch to ${other} over Tailscale` : LINK_PHONE_ACCESS(other)}`
        : `Showing ${shown}${asleep ? ', asleep' : ''}. Switch to ${other}${otherAsleep ? ', asleep, to see what it last sent' : ''}`,
      href,
      asleep,
      onPeer: !!shownPeer,
      busy: { text: `${other}…`, label: `Opening ${other}` },
      to: { name: other, asleep: otherAsleep },
      warm: !status.remote && !shownPeer && !!peer.online,
    };
  }
  const row = (id, name, current, sleeping, href) => ({
    id, name, current, asleep: sleeping, href,
    note: id === 'self' ? 'this laptop' : sleeping ? 'asleep' : '',
    hint: status.remote && !href && !current ? LINK_PHONE_ACCESS(name) : '',
    busy: { text: `${name}…`, label: `Opening ${name}` },
    warm: !status.remote && id !== 'self' && !current && !sleeping,
  });
  return {
    text: asleep ? `${shown} · asleep` : shown,
    label: `Showing ${shown}${asleep ? ', asleep' : ''}. Switch to another laptop`,
    href: '',
    asleep,
    onPeer: !!shownPeer,
    busy: null,
    warm: false,
    menu: [row('self', status.selfName, !shownPeer, false, selfHref),
      ...peers.map(peer => row(peer.id, peer.name, linkSamePeer(peer, shownPeer), !peer.online, linkPeerHref(status, peer)))],
  };
}

// The banner shows on a switched window while its laptop sleeps, and on any
// window while anything waits to send.
export function linkBannerModel(status) {
  const peers = linkPeers(status);
  if (!peers.length) return null;
  const queue = status.queue || [];
  const shown = linkShownPeer(status);
  const asleep = !!shown && !shown.online;
  if (!asleep && !queue.length) return null;
  const waiting = [...new Set(queue.map(item => item.peerName).filter(Boolean))];
  const names = waiting.length ? waiting : [(shown || peers[0]).name];
  const only = names.length === 1 ? peers.find(peer => peer.name === names[0]) || shown || peers[0] : null;
  return {
    asleep,
    title: asleep ? `${shown.name} is asleep` : `Waiting to send to ${linkNames(names)}`,
    note: asleep
      ? `You're seeing what ${shown.name} last sent, read-only. Messages, question answers and new runs wait here and send when it wakes.`
      : only ? `${only.name} is ${only.online ? 'back. These send in a moment' : 'asleep. These send when it wakes'}.`
        : 'Each one sends when its laptop is awake.',
    items: queue.map(item => ({ ...item, failed: item.state === 'failed', to: names.length > 1 ? item.peerName : '' })),
  };
}

export function linkStatusText(status) {
  if (!status) return 'Couldn’t read the linked laptops.';
  if (!status.eligible) return 'Only the Orc that runs Orc.app can link laptops.';
  if (status.error) return status.error;
  const peers = linkPeers(status);
  if (peers.length) {
    const machines = linkMachinesModel(status);
    return `Linked with ${linkNames(peers.map(peer => peer.name))}.${machines?.needsAction ? ` ${machines.summary}` : ''}`;
  }
  if (!status.enabled) return 'Off. Turn this on here and on your other laptops, then link from any of them.';
  return 'On. Your other laptops can find this Orc. To pair from here, find it below.';
}

export function linkAccountText(status) {
  const account = status?.account;
  if (!account || !status.eligible || !status.enabled) return '';
  if (!account.signedIn) return 'To link laptops without a code, sign each one in with GitHub under Accounts.';
  if (account.state === 'unsupported') return account.error;
  if (account.state === 'error') return `Couldn’t check which laptops ${account.login} is signed in on: ${account.error}`;
  return `Laptops signed in to GitHub as ${account.login} link on their own when they are on this Wi-Fi.`;
}


export function linkFoundAction(orc) {
  if (orc.linked) return { note: 'Already linked', label: '', action: '' };
  if (orc.account) return { note: 'On your GitHub account', label: `Link ${orc.name}`, action: 'account' };
  return { note: orc.host, label: `Pair with ${orc.name}`, action: 'code' };
}

const linkPlural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// One laptop's badge: where its Orc stands and the one thing that fixes it.
// `older` says the linked comparison found this laptop behind the other one.
// `otherCheckout` is the other laptop's checkout, whose unpushed commits no
// sync here can fetch.
function linkMachineState(checkout, name, other, older, different, otherCheckout) {
  if (!checkout) {
    return { tone: 'warn', badge: older ? `Older than ${other}` : 'Unknown',
      todo: `${name} runs an Orc too old to report its checkout. It updates itself once GitHub has the newer Orc; if it doesn't, run /push-and-pull in its Orc project.`,
      action: null };
  }
  const sync = checkout.sync;
  if (sync?.state === 'running') return { tone: 'busy', badge: 'Syncing…', todo: 'Merging with GitHub, pushing, then installing.', action: null };
  if (checkout.merging) return { tone: 'bad', badge: 'Merge in progress', todo: 'Finish or abort the merge in its Orc checkout, then sync.', action: null };
  if (!checkout.onBranch) return { tone: 'bad', badge: `Not on ${checkout.branch || 'main'}`, todo: `Switch its Orc checkout back to ${checkout.branch || 'main'}, then sync.`, action: null };
  if (checkout.dirty) return { tone: 'bad', badge: 'Uncommitted changes', todo: 'Commit or stash the changes in its Orc checkout, then sync.', action: null };
  const ahead = checkout.ahead || 0;
  const behind = checkout.behind || 0;
  if (ahead && behind) {
    return { tone: 'warn', badge: 'Out of step with GitHub',
      todo: `${linkPlural(ahead, 'commit')} here aren't on GitHub, and GitHub has ${linkPlural(behind, 'commit')} this checkout doesn't. Sync merges both, pushes, and installs.`,
      action: 'Sync with GitHub' };
  }
  if (behind) return { tone: 'warn', badge: `${behind} behind GitHub`, todo: 'Pull the newer Orc from GitHub and install it.', action: 'Pull and install' };
  if (ahead) return { tone: 'warn', badge: `${ahead} not on GitHub`, todo: `Push ${linkPlural(ahead, 'commit')} to GitHub so ${other} can pull them.`, action: 'Push to GitHub' };
  if (checkout.installed && checkout.head && checkout.installed !== checkout.head
      && ['pending', 'failed', 'blocked'].includes(checkout.update)) {
    return { tone: 'warn', badge: 'Not installed',
      todo: checkout.update === 'failed' ? `The last install failed: ${checkout.updateReason}` : 'Its checkout has a newer Orc than the one running. Install it.',
      action: 'Install' };
  }
  const unshared = otherCheckout?.ahead || 0;
  if ((older || different) && unshared) {
    return { tone: 'ok', badge: 'Matches GitHub',
      todo: `${other} has ${linkPlural(unshared, 'commit')} GitHub doesn't. Sync ${other} to share them.`, action: null };
  }
  if (older) return { tone: 'warn', badge: `Older than ${other}`, todo: `GitHub may have ${other}'s Orc by now. Sync to pull it.`, action: 'Sync with GitHub' };
  if (different) return { tone: 'warn', badge: 'Different version', todo: 'Matches its last look at GitHub. Sync to check again.', action: 'Sync with GitHub' };
  return { tone: 'ok', badge: 'Up to date', todo: '', action: null };
}

export function linkMachinesModel(status, shownOnly = false) {
  const sync = status?.versionSync;
  if (!sync) return null;
  const rows = sync.peers || (status.peer?.online
    ? [{ id: status.peer.id, name: status.peer.name, commit: sync.peerCommit, relation: sync.relation, checkout: sync.peer }]
    : []);
  if (!rows.length) return null;
  const newer = rows.find(row => row.relation === 'behind');
  const compared = newer || rows.find(row => row.relation === 'different') || rows[0];
  const self = {
    key: 'self', target: 'self', name: status.selfName, other: compared.name,
    commit: sync.selfCommit, checkout: sync.self, otherCheckout: compared.checkout,
    older: !!newer, different: rows.some(row => row.relation === 'different'),
  };
  const peers = rows.map(row => ({
    key: row.id === undefined ? 'peer' : `peer:${row.id}`, target: 'peer', peer: row.id, name: row.name,
    other: status.selfName, commit: row.commit, checkout: row.checkout, otherCheckout: sync.self,
    older: row.relation === 'ahead', different: row.relation === 'different',
  }));
  const shownPeer = linkShownPeer(status);
  const first = shownPeer ? peers.find(machine => machine.peer === shownPeer.id) : self;
  if (!first && shownOnly) return null;
  const ordered = first ? [first, ...[self, ...peers].filter(machine => machine !== first)] : [self, ...peers];
  const machines = (shownOnly ? ordered.slice(0, 1) : ordered).map(machine => {
    const state = linkMachineState(machine.checkout, machine.name, machine.other, machine.older, machine.different, machine.otherCheckout);
    const last = machine.checkout?.sync;
    const note = last && ['skipped', 'failed'].includes(last.state) && state.tone !== 'busy'
      ? `Last sync didn't finish: ${last.reason}` : '';
    return {
      key: machine.key, target: machine.target, peer: machine.peer, name: machine.name, shown: machine === first,
      commit: (machine.commit || '').slice(0, 7), ...state, note,
    };
  });
  const open = machines.filter(machine => machine.tone !== 'ok');
  const all = machines.length === 2 ? 'Both' : 'All';
  return {
    machines,
    needsAction: open.length > 0,
    busy: machines.some(machine => machine.tone === 'busy'),
    summary: shownOnly && machines[0].tone === 'busy' ? `${machines[0].name} is syncing with GitHub.`
      : !open.length ? (shownOnly ? `${machines[0].name} matches GitHub.` : `${all} laptops run the same Orc as GitHub.`)
      : open.length === 1 ? `${open[0].name} needs ${open[0].action ? 'a sync' : 'attention'}.`
        : open.length === machines.length ? `${all} laptops need a sync.` : `${open.length} laptops need a sync.`,
  };
}

// Settings shows one card per laptop, this one first: whether it is awake and
// how it was linked, its Orc version and the one thing that fixes it, and any
// note about its last sync or update. Asleep laptops report no version.
export function linkLaptopCards(status) {
  const peers = linkPeers(status);
  if (!peers.length) return [];
  const machines = linkMachinesModel(status)?.machines || [];
  const version = machine => ({
    machine: machine?.target || '', key: machine?.key || '', tone: machine?.tone || 'off', badge: machine?.badge || '',
    commit: machine?.commit || '', todo: machine?.todo || '', action: machine?.action || null,
    notes: machine?.note ? [{ text: machine.note, error: true }] : [],
  });
  const self = version(machines.find(machine => machine.target === 'self'));
  const update = status.update;
  if (update?.state === 'updated') self.notes.push({ text: `Updated to match ${status.peer?.name || 'the other laptop'}.`, error: false });
  if (update?.state === 'skipped') self.notes.push({ text: `Didn't update: ${update.reason}`, error: false });
  const peerMachine = peer => machines.find(machine => machine.target === 'peer'
    && (machine.peer === peer.id || (machine.peer === undefined && peers.length === 1)));
  return [
    { ...self, name: status.selfName, tag: 'this laptop', detail: '', unlink: null },
    ...peers.map(peer => ({
      ...version(peerMachine(peer)), name: peer.name, tag: '', unlink: peer.id ?? '',
      detail: `${peer.online ? 'Awake' : 'Asleep'} · ${peer.via === 'github' ? 'Linked through your GitHub account' : 'Linked with a pairing code'}`,
      unlinkWarning: `This deletes everything copied from ${peer.name} and drops anything still waiting to send to it. Each laptop keeps what lives on it.${peer.via === 'github' ? ` ${peer.name} stays unlinked until you link it again from Find Orcs on this Wi-Fi.` : ''}`,
    })),
  ];
}

export function linkWarningModel(status, contributions = []) {
  const machines = linkMachinesModel(status, true);
  const versions = !!machines && (machines.needsAction || machines.busy);
  const notInstalled = machines?.machines[0]?.badge === 'Not installed';
  contributions = contributions.filter(row => !(notInstalled && row.sameAsNotInstalled));
  const open = contributions.filter(row => row.needsAction || row.busy);
  if (!versions && !open.length) return null;
  const parts = [];
  if (versions) parts.push(machines.summary);
  parts.push(...open.map(row => row.summary));
  const pluginsOnly = !open.some(row => row.sameAsNotInstalled || row.attention);
  return {
    machines: versions ? machines : null,
    contributions,
    title: versions ? 'Sync status for this window' : pluginsOnly ? 'Plugin sync' : 'Needs attention',
    label: `${parts.join(' ')} ${versions ? 'Show the sync status for this window.' : pluginsOnly ? 'Show plugin sync details.' : 'Show what needs attention.'}`,
  };
}
// END TESTABLE: link view model

async function linkCall(path, body) {
  const response = await fetch(`/api/link${path}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Orc could not do that (status ${response.status}).`);
  return data;
}

async function linkRefresh() {
  clearTimeout(link.timer);
  link.status = await linkCall('').catch(() => null);
  link.checked = true;
  linkRender();
  const pairing = link.status?.enabled && !linkPeers(link.status).length;
  const syncing = linkMachinesModel(link.status)?.busy;
  link.timer = setTimeout(linkRefresh, pairing || syncing ? LINK_PAIRING_POLL_MS : LINK_POLL_MS);
}

function linkRender() {
  linkRenderSwitch();
  linkRenderVersionWarning();
  linkRenderIncoming();
  linkRenderBanner();
  linkRenderSettings();
}

const LAPTOP_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>';

function linkMachineHeadHtml(name, tag, badge, commit) {
  return `<div class="orc-machine-head">
        <span class="orc-machine-name">${LAPTOP_ICON}<span translate="no">${esc(name)}</span>${tag ? ` <small>${esc(tag)}</small>` : ''}</span>
        ${badge ? `<span class="orc-machine-badge">${esc(badge)}</span>` : ''}
        ${commit ? `<code class="orc-machine-commit" translate="no" title="Installed Orc">${esc(commit)}</code>` : ''}
      </div>`;
}

function linkSyncErrorHtml(key, action) {
  return action && link.syncErrors[key] ? `<p class="orc-machine-note" role="alert">${esc(link.syncErrors[key])}</p>` : '';
}

function linkSyncButtonHtml(key, action) {
  return action ? `<button type="button" class="settings-btn-inline" data-link-sync="${esc(key)}">${esc(action)}</button>` : '';
}

function linkMachinesHtml(model, contributions = []) {
  const extra = contributions.map(row => row.html).join('');
  if (!model) {
    return `<ul class="orc-machines">${extra}</ul>`;
  }
  return `<p class="orc-versions-summary">${esc(model.summary)}</p>
    <ul class="orc-machines">${model.machines.map(machine => `<li class="orc-machine is-${machine.tone}" data-link-machine="${machine.target}"${machine.peer ? ` data-link-peer="${esc(machine.peer)}"` : ''}>
      ${linkMachineHeadHtml(machine.name, machine.shown ? 'this window' : '', machine.badge, machine.commit)}
      ${machine.todo ? `<p class="orc-machine-todo">${esc(machine.todo)}</p>` : ''}
      ${machine.note ? `<p class="orc-machine-note">${esc(machine.note)}</p>` : ''}
      ${linkSyncErrorHtml(machine.key, machine.action)}
      ${linkSyncButtonHtml(machine.key, machine.action)}
    </li>`).join('')}${extra}</ul>`;
}

function linkLaptopsHtml(cards) {
  return cards.map(card => {
    const confirming = card.unlink !== null && link.unlinking === card.unlink;
    const unlink = card.unlink === null ? ''
      : `<button type="button" class="settings-btn-inline danger link-laptop-unlink" data-link-unlink="${esc(card.unlink)}">${confirming ? `Yes, unlink ${esc(card.name)}` : `Unlink ${esc(card.name)}…`}</button>${confirming ? '<button type="button" class="settings-btn-inline" data-link-unlink-cancel>Keep linked</button>' : ''}`;
    const actions = linkSyncButtonHtml(card.key, card.action) + unlink;
    return `<li class="orc-machine link-laptop is-${card.tone}"${card.machine ? ` data-link-machine="${card.machine}"` : ''}>
      ${linkMachineHeadHtml(card.name, card.tag, card.badge, card.commit)}
      ${card.detail ? `<p class="link-laptop-detail">${esc(card.detail)}</p>` : ''}
      ${card.todo ? `<p class="orc-machine-todo">${esc(card.todo)}</p>` : ''}
      ${card.notes.map(note => `<p class="${note.error ? 'orc-machine-note' : 'link-laptop-note'}">${esc(note.text)}</p>`).join('')}
      ${confirming ? `<p class="link-laptop-warning">${esc(card.unlinkWarning)}</p>` : ''}
      ${linkSyncErrorHtml(card.key, card.action)}
      ${actions ? `<div class="lan-actions">${actions}</div>` : ''}
    </li>`;
  }).join('');
}

// Re-rendering on every poll would drop focus from a button mid-click, and a
// repaint puts it back on the same control.
function linkPaint(element, html) {
  if (!element || element.dataset.html === html) return;
  const focused = element.contains(document.activeElement) ? document.activeElement : null;
  const key = focused && [...focused.attributes].find(attribute => attribute.name.startsWith('data-'));
  element.innerHTML = html;
  element.dataset.html = html;
  if (key) element.querySelector(`[${key.name}="${CSS.escape(key.value)}"]`)?.focus();
}

function linkRenderVersionWarning() {
  const warning = $('orc-version-warning');
  const model = linkMachinesModel(link.status);
  link.syncErrors = Object.fromEntries(Object.entries(link.syncErrors)
    .filter(([key]) => model?.machines.some(machine => machine.key === key && machine.action)));
  if (!warning) return;
  const shown = linkWarningModel(link.status, [...desktopUpdateStatuses(), ...cliCompatStatuses(), ...pluginStatuses()]);
  warning.hidden = !shown;
  if (!shown) {
    linkVersionsOpen(false);
    return;
  }
  warning.setAttribute('aria-label', shown.label);
  $('orc-versions-title').textContent = shown.title;
  linkPaint($('orc-versions-body'), linkMachinesHtml(shown.machines, shown.contributions));
  paintCliCompatChecked();
}

function linkVersionsOpen(open) {
  const panel = $('orc-versions');
  const warning = $('orc-version-warning');
  if (!panel || !warning) return;
  panel.hidden = !open;
  warning.setAttribute('aria-expanded', String(open));
}

async function linkSyncClick(event) {
  const button = event.target.closest('[data-link-sync]');
  if (!button) return;
  const key = button.dataset.linkSync;
  const [target, peer] = key.split(':');
  const name = target === 'peer'
    ? (linkPeers(link.status).find(laptop => laptop.id === peer) || link.status?.peer)?.name
    : link.status?.selfName;
  const list = button.closest('[data-html]');
  delete link.syncErrors[key];
  button.disabled = true;
  try {
    link.status = await linkCall('/sync-orc', peer ? { target, peer } : { target });
    announce(`Syncing ${name} with GitHub.`);
  } catch (error) {
    link.syncErrors[key] = error.message;
    button.disabled = false;
    linkRender();
    list?.querySelector(`[data-link-sync="${CSS.escape(key)}"]`)?.focus();
    return;
  }
  linkRefresh();
}


function linkRenderSwitch() {
  const button = $('link-switch');
  if (!button) return;
  const model = linkSwitchModel(link.status);
  const menu = $('link-menu');
  button.hidden = !model || !!model.menu;
  if (menu) menu.hidden = !model?.menu;
  if (!model) return;
  if (model.menu) return linkRenderMenu(menu, model);
  button.textContent = model.text;
  button.setAttribute('aria-label', model.label);
  button.title = model.label;
  button.classList.toggle('is-asleep', model.asleep);
  button.classList.toggle('is-peer', model.onPeer);
  button.classList.remove('is-switching');
  button.removeAttribute('aria-busy');
  button.dataset.href = model.href;
}

function linkRenderMenu(menu, model) {
  if (!menu) return;
  labelMenuTrigger(menu, model.label);
  menu.classList.toggle('is-asleep', model.asleep);
  menu.classList.toggle('is-peer', model.onPeer);
  menu.classList.remove('is-switching');
  menu.removeAttribute('aria-busy');
  $('link-menu-shown').textContent = model.text;
  linkPaint($('link-menu-items'), model.menu.map(laptop => `<button type="button" role="menuitemradio" aria-checked="${laptop.current}" data-link-laptop="${esc(laptop.id)}">
      <span class="link-menu-name" translate="no">${esc(laptop.name)}</span>${laptop.note ? `<span class="link-menu-note">${esc(laptop.note)}</span>` : ''}
    </button>`).join(''));
  // <orc-menu> counts its items on slotchange, and filling this slotted div
  // fires none, so its "No actions available" note would stay up under them.
  menu.syncItems?.();
}

function linkMenuLaptop(event) {
  const item = event.target.closest?.('[data-link-laptop]');
  return item ? linkSwitchModel(link.status)?.menu?.find(laptop => laptop.id === item.dataset.linkLaptop) : null;
}

function linkMenuWarm(event) {
  const laptop = linkMenuLaptop(event);
  if (!laptop?.warm || Date.now() - (link.warmed[laptop.id] || 0) < LINK_WARM_MS) return;
  link.warmed[laptop.id] = Date.now();
  linkCall('/warm', { peer: laptop.id }).catch(() => {});
}

function linkMenuPick(event) {
  const laptop = linkMenuLaptop(event);
  if (!laptop || laptop.current) return;
  if (!laptop.href) {
    if (laptop.hint) showToast(laptop.hint);
    return;
  }
  const menu = $('link-menu');
  $('link-menu-shown').textContent = laptop.busy.text;
  menu.setAttribute('trigger-label', laptop.busy.label);
  menu.classList.add('is-switching');
  menu.setAttribute('aria-busy', 'true');
  leaveForLaptop({ name: laptop.name, asleep: laptop.asleep, href: laptop.href, putBadgeBack: linkRenderSwitch });
}

function linkWarm() {
  if (!linkSwitchModel(link.status)?.warm || Date.now() - link.warmedAt < LINK_WARM_MS) return;
  link.warmedAt = Date.now();
  linkCall('/warm', {}).catch(() => {});
}

function linkRenderIncoming() {
  const dialog = $('link-code-dialog');
  if (!dialog) return;
  const incoming = link.status?.viewing === 'self' ? link.status?.incoming : null;
  if (!incoming) {
    if (dialog.open) dialog.close();
    return;
  }
  dialog.setAttribute('heading', `${incoming.from} wants to link`);
  $('link-code-from').textContent = `Type this code on ${incoming.from} to link it with this Orc.`;
  $('link-code-value').textContent = incoming.code;
  if (!dialog.open) dialog.show();
}

function linkRenderBanner() {
  let banner = $('link-banner');
  const model = linkBannerModel(link.status);
  if (!model) {
    if (banner) banner.hidden = true;
    return;
  }
  if (!banner) {
    banner = document.createElement('section');
    banner.id = 'link-banner';
    banner.setAttribute('aria-labelledby', 'link-banner-title');
    document.querySelector('main')?.prepend(banner);
    banner.addEventListener('click', linkBannerClick);
  }
  if (banner.contains(document.activeElement) && link.editing) return;
  banner.hidden = false;
  banner.classList.toggle('is-asleep', model.asleep);
  banner.innerHTML = `<h2 id="link-banner-title">${esc(model.title)}</h2>
    <p>${esc(model.note)}</p>
    ${model.items.length ? `<ul class="link-queue" aria-label="Waiting to send">${model.items.map(item => `<li data-link-item="${esc(item.id)}">
      <span class="link-queue-label">${esc(item.label)}${item.to ? ` on <span translate="no">${esc(item.to)}</span>` : ''}${item.failed ? ' <strong>· not sent</strong>' : ' · waiting to send'}</span>
      ${item.text != null ? (link.editing === item.id
        ? `<textarea class="link-queue-edit" aria-label="Edit ${esc(item.label)}">${esc(item.text)}</textarea>`
        : `<span class="link-queue-text">${esc(item.text)}</span>`) : ''}
      ${item.failed && item.error ? `<span class="link-queue-error">${esc(item.error)}</span>` : ''}
      <span class="link-queue-actions">
        ${item.text != null ? `<button type="button" class="settings-btn-inline" data-link-action="${link.editing === item.id ? 'save' : 'edit'}">${link.editing === item.id ? 'Save' : 'Edit'}</button>` : ''}
        <button type="button" class="settings-btn-inline" data-link-action="delete">Delete</button>
      </span></li>`).join('')}</ul>` : ''}`;
}

async function linkBannerClick(event) {
  const button = event.target.closest('[data-link-action]');
  if (!button) return;
  const row = button.closest('[data-link-item]');
  const id = row.dataset.linkItem;
  const action = button.dataset.linkAction;
  if (action === 'edit') {
    link.editing = id;
    linkRenderBanner();
    $('link-banner').querySelector(`[data-link-item="${CSS.escape(id)}"] textarea`)?.focus();
    return;
  }
  try {
    if (action === 'save') {
      link.status = await linkCall(`/queue/${id}/edit`, { text: row.querySelector('textarea').value });
      link.editing = null;
      announce('Saved. It still waits to send.');
    } else {
      link.status = await linkCall(`/queue/${id}/delete`, {});
      if (link.editing === id) link.editing = null;
      announce('Deleted. It won’t be sent.');
    }
  } catch (error) {
    announce(error.message);
  }
  linkRender();
}

// ---------- Settings card ----------

export function linkSettingsHtml() {
  return `<div class="settings-card" id="link-card" data-settings-anchor="linked-laptops">
    <fieldset class="settings-fieldset lan-settings" aria-describedby="link-status">
      <legend class="settings-label">Linked laptops</legend>
      <p class="settings-hint">Link this Orc with the Orcs on your other laptops over the same Wi-Fi. The badge at the top then switches this window between them.</p>
      <orc-switch class="settings-check cp-power" id="set-link" label="Let my other laptops find this Orc"></orc-switch>
      <p class="settings-note" id="link-status" role="status" aria-live="polite">Checking the linked laptops…</p>
      <ul id="link-laptops" class="orc-machines link-laptops" aria-label="Linked laptops"></ul>
      <section id="link-pair" class="link-pair" aria-labelledby="link-pair-title" hidden>
        <h3 id="link-pair-title" class="link-pair-title">Link a laptop</h3>
        <p class="settings-note" id="link-account" hidden></p>
        <button type="button" id="link-find" class="settings-btn-inline">Find Orcs on this Wi-Fi</button>
        <ul id="link-found" class="link-found" aria-label="Orcs on this Wi-Fi"></ul>
        <div id="link-confirm" class="link-confirm" hidden>
          <p class="settings-hint" id="link-confirm-hint"></p>
          <label class="settings-field"><span>Code shown on the other laptop</span>
            <orc-input type="text" id="link-code" autocomplete="off" aria-label="Code shown on the other laptop"></orc-input>
          </label>
          <label class="settings-field"><span>Name this laptop</span>
            <orc-input type="text" id="link-self-name" aria-label="Name this laptop" placeholder="Personal"></orc-input>
          </label>
          <label class="settings-field"><span>Name the other laptop</span>
            <orc-input type="text" id="link-peer-name" aria-label="Name the other laptop" placeholder="Work"></orc-input>
          </label>
          <div class="lan-actions">
            <button type="button" id="link-confirm-go" class="settings-btn-inline">Link laptops</button>
            <button type="button" id="link-confirm-cancel" class="settings-btn-inline">Cancel</button>
          </div>
        </div>
      </section>
      <p class="settings-note" id="link-action-status" role="status"></p>
    </fieldset>
  </div>`;
}

function linkRenderSettings() {
  const note = $('link-status');
  if (!note) return;
  const status = link.status;
  const peers = linkPeers(status);
  note.textContent = linkStatusText(status);
  note.className = `settings-note${status?.error ? ' error' : peers.some(peer => peer.online) ? ' ok' : ''}`;
  const account = linkAccountText(status);
  $('link-account').hidden = !account;
  $('link-account').textContent = account;
  $('link-account').className = `settings-note${['unsupported', 'error'].includes(status?.account?.state) ? ' error' : ''}`;
  const toggle = $('set-link');
  if (toggle && document.activeElement !== toggle) toggle.checked = !!status?.enabled;
  // The switch has no disabled property of its own, only the attribute.
  if (toggle) toggle.toggleAttribute('disabled', !status?.eligible || peers.length > 0);
  $('link-pair').hidden = !(status?.enabled && status.viewing === 'self');
  $('link-pair-title').textContent = peers.length ? 'Link another laptop' : 'Link a laptop';
  if (!peers.some(peer => (peer.id ?? '') === link.unlinking)) link.unlinking = null;
  linkPaint($('link-laptops'), linkLaptopsHtml(linkLaptopCards(status)));
}

function linkRenderFound() {
  const list = $('link-found');
  if (!list) return;
  list.innerHTML = link.found.length
    ? link.found.map((orc, index) => {
      const offer = linkFoundAction(orc);
      return `<li><span class="link-found-name"><span translate="no">${esc(orc.name)}</span> <span class="settings-note">${esc(offer.note)}</span></span>
        ${offer.action ? `<button type="button" class="settings-btn-inline" data-link-pick="${index}">${esc(offer.label)}</button>` : ''}</li>`;
    }).join('')
    : '<li class="settings-note">No other Orc found. Turn on “Let my other laptops find this Orc” on it, then look again.</li>';
}

async function linkFind(status) {
  status.textContent = 'Looking for Orcs on this Wi-Fi…';
  try {
    link.found = (await linkCall('/discover')).found || [];
    status.textContent = '';
  } catch (error) {
    link.found = [];
    status.textContent = error.message;
  }
  linkRenderFound();
}

async function linkSettingsClick(event) {
  const status = $('link-action-status');
  if (event.target.closest('#link-find')) return linkFind(status);
  const pick = event.target.closest('[data-link-pick]');
  if (pick) {
    const orc = link.found[Number(pick.dataset.linkPick)];
    if (linkFoundAction(orc).action === 'account') {
      status.textContent = `Linking with ${orc.name}…`;
      try {
        link.status = await linkCall('/link-account', { host: orc.host, port: orc.port, fp: orc.fp });
      } catch (error) {
        status.textContent = error.message;
        return;
      }
      status.textContent = `Linked with ${orc.name}. Use the badge at the top to switch.`;
      link.found = link.found.map(found => (found === orc ? { ...found, linked: true } : found));
      linkRenderFound();
      linkRender();
      return;
    }
    status.textContent = `Asking ${orc.name} for a code…`;
    try {
      await linkCall('/request-code', { host: orc.host, port: orc.port, name: link.status?.selfName || '' });
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    link.pairing = orc;
    status.textContent = '';
    $('link-confirm').hidden = false;
    $('link-confirm-hint').textContent = `${orc.name} now shows a code. Type it here and name both laptops.`;
    $('link-self-name').value = link.status?.selfName || '';
    $('link-peer-name').value = orc.name;
    $('link-code').focus();
    return;
  }
  if (event.target.closest('#link-confirm-cancel')) {
    link.pairing = null;
    $('link-confirm').hidden = true;
    return;
  }
  if (event.target.closest('#link-confirm-go') && link.pairing) {
    status.textContent = 'Linking…';
    const name = $('link-peer-name').value;
    try {
      link.status = await linkCall('/confirm', {
        host: link.pairing.host, port: link.pairing.port, code: $('link-code').value,
        name: $('link-self-name').value, peerName: name,
      });
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    const paired = link.pairing;
    link.pairing = null;
    link.found = link.found.map(found => (found === paired ? { ...found, linked: true } : found));
    $('link-confirm').hidden = true;
    status.textContent = `Linked with ${name.trim()}. Use the badge at the top to switch.`;
    linkRenderFound();
    linkRender();
    return;
  }
  if (event.target.closest('[data-link-unlink-cancel]')) {
    const key = link.unlinking;
    link.unlinking = null;
    linkRenderSettings();
    $('link-laptops').querySelector(`[data-link-unlink="${CSS.escape(key ?? '')}"]`)?.focus();
    return;
  }
  const unlink = event.target.closest('[data-link-unlink]');
  if (unlink) {
    const key = unlink.dataset.linkUnlink;
    const id = key || undefined;
    const peer = linkPeers(link.status).find(laptop => (laptop.id ?? '') === key);
    const name = peer?.name || 'the other laptop';
    if (link.unlinking !== key || !peer) {
      link.unlinking = key;
      status.textContent = '';
      linkRenderSettings();
      $('link-laptops').querySelector(`[data-link-unlink="${CSS.escape(key)}"]`)?.focus();
      return;
    }
    try {
      const result = await linkCall('/unlink', id === undefined ? {} : { peer: id });
      link.status = result;
      status.textContent = `Unlinked ${name}. ${result.dropped ? `Dropped ${result.dropped} unsent item${result.dropped === 1 ? '' : 's'}.` : 'Nothing was waiting to send.'}`;
    } catch (error) {
      status.textContent = error.message;
    }
    link.unlinking = null;
    link.found = [];
    linkRenderFound();
    linkRender();
  }
}

export function wireLinkSettings() {
  const card = $('link-card');
  if (!card) return;
  card.addEventListener('click', linkSettingsClick);
  card.addEventListener('click', linkSyncClick);
  $('set-link').addEventListener('change', async event => {
    try {
      link.status = await linkCall('/enable', { enabled: event.target.checked });
    } catch (error) {
      $('link-action-status').textContent = error.message;
    }
    linkRefresh();
  });
  linkRenderSettings();
  linkRefresh();
}

// Whether the first look at the links has come back, so the badge is final.
export const linkChecked = () => link.checked;

// ---------- boot ----------

const versionWarning = $('orc-version-warning');
const versionPanel = $('orc-versions');
versionWarning?.addEventListener('click', () => linkVersionsOpen(versionPanel.hidden));
versionPanel?.addEventListener('click', linkSyncClick);
window.addEventListener('orc-plugin-status', linkRenderVersionWarning);
window.addEventListener('orc-desktop-update', linkRenderVersionWarning);
window.addEventListener('orc-cli-compat', linkRenderVersionWarning);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !versionPanel || versionPanel.hidden) return;
  event.stopPropagation();
  linkVersionsOpen(false);
  versionWarning.focus();
}, true);
document.addEventListener('pointerdown', event => {
  if (versionPanel && !versionPanel.hidden && !versionPanel.contains(event.target) && !versionWarning.contains(event.target)) {
    linkVersionsOpen(false);
  }
});

const linkMenu = $('link-menu');
linkMenu?.addEventListener('click', linkMenuPick);
for (const type of ['pointerover', 'focusin']) linkMenu?.addEventListener(type, linkMenuWarm);

if ($('link-switch')) {
  const button = $('link-switch');
  for (const type of ['pointerenter', 'focus', 'pointerdown']) button.addEventListener(type, linkWarm);
  button.addEventListener('click', () => {
    const href = button.dataset.href;
    if (!href) {
      if (link.status?.remote) showToast(linkSwitchModel(link.status)?.label);
      return;
    }
    // The page shrinking into the cover still shows the badge, so it says
    // the click landed.
    const model = linkSwitchModel(link.status);
    if (!model) return;
    button.textContent = model.busy.text;
    button.setAttribute('aria-label', model.busy.label);
    button.title = model.busy.label;
    button.classList.add('is-switching');
    button.setAttribute('aria-busy', 'true');
    leaveForLaptop({ ...model.to, href, putBadgeBack: linkRenderSwitch });
  });
  // Back from the other laptop restores this page as it was left, mid-switch.
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    resetLaptopSwitch();
    linkRenderSwitch();
  });
  $('link-code-cancel')?.addEventListener('click', async () => {
    $('link-code-dialog').close();
    try { await linkCall('/cancel-incoming', {}); } catch {}
  });
  linkRefresh();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) linkRefresh(); });
}
