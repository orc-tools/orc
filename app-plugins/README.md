# Orc application plugins

These are executable, trusted application packages managed by `orc-app-plugin`,
which owns their installation, enablement, and command/skill links.
There is no marketplace or sandbox: plugin code has your permissions.

## Install and manage

From an installed Orc, or using `bin/orc-app-plugin` in this checkout:

```sh
orc-app-plugin list
orc-app-plugin add ocean
orc-app-plugin disable ocean
orc-app-plugin enable ocean
orc-app-plugin remove ocean
orc-app-plugin install /absolute/path/to/package
orc-app-plugin install --git "$GIT_SOURCE" --ref "$COMMIT" --subdir path/to/package
orc-app-plugin new /absolute/path/to/new-theme
orc-app-plugin check /absolute/path/to/package
orc-app-plugin link /absolute/path/to/theme
```

`new` scaffolds a self-contained no-code theme (`orc-plugin.json`, `theme.css` with
day/night/auto palettes and component shape tokens, and `favicon.svg`) ready to
check, link, or screenshot with `orc-shot agent --theme /absolute/path/to/new-theme`.
`check` holds a package to what Orc promises themes ([THEMING.md](THEMING.md)):
missing palette tokens, the contrast floors, and any token, hook or page module
Orc does not promise. It exits 1 while something is wrong. `link` is for working
on a theme: Orc reads the folder in place instead of pinning a copy, and open
windows pick up a saved edit within a few seconds. Only themes, with an optional
`frontend` or `components`, can be linked; `remove` unlinks one and leaves the folder alone.

Settings → Visuals shows every theme as a small model of Orc's window painted with
the theme's own `theme.css`, and picking one uses it. A theme has no on/off switch
there: picking one that is not installed, or that `disable` turned off, installs it
first. Orc's own themes are painted before they are installed, so their styles and
pictures are served then; a theme from outside Orc shows once it is installed, and
only those have Remove.

Installs say whether a package runs code. A theme of CSS, pictures and declarative
manifest fields (`favicon`, `announce`, `backdrop`, `radio`) is
**no code**; anything with a `scene`, `components`, `frontend` or other
contribution **runs code** with your permissions, and installing one from outside
Orc prints a warning. Settings → Plugins labels packages from outside Orc the same way.

`GIT_SOURCE` must be an explicit HTTPS/SSH URL or absolute local Git repository.
Use existing Git authentication, never a URL containing credentials. Git installs
resolve a commit and copy only its package subdirectory. They run no repository
hooks, submodules, install scripts or builds. Explicit local/external installs are
pinned copies; reinstall explicitly to update. Build generated assets before installing.
Bundled packages instead use the selected immutable Orc release: upgrading Orc
updates their code, and rolling Orc back restores it. Installed/disabled/available
choices and the selected theme survive both operations. External packages
do not follow Orc upgrades. There is no separate bundled-plugin update action.
Disable external packages with frontend/backend entrypoints before replacing their code;
an attempted live replacement fails without changing the working revision.
Wait for pending cleanup in Settings before enabling the replacement.

`--home /absolute/disposable/home` goes **before** the action and isolates state.
`--expected-revision N` rejects a stale mutation; `list` returns the revision.
Removal keeps user data and pinned revisions, and never stops an independently
started service or deletes a worktree. Foreign command/skill files are refused.

First launch offers the bundled catalog; Settings manages both that catalog and
explicitly installed external packages. Swamp is required so there is always a
real fallback, and Skills is required because it is part of Orc. A required
package is switched on at startup even where an older Orc had it off. A fresh unattended installation can select optional packages with
`./install.sh --plugins=ocean` (empty `--plugins=` selects only the fallback).
Without that flag, first launch shows the picker. Existing registry choices survive
reruns. Upgrades from before this registry retain the previously available bundled
themes, including browser-local preferences.

After setup, newly added bundled plugins install and enable automatically when
Orc starts or installs. The registry remembers catalog IDs in `catalogSeen`, so
disabling or removing a plugin sticks, even if it disappears from a release and
returns later. Explicit setup choices, including `--plugins`, take precedence.
On the first upgrade from a registry without catalog history, Orc records the
current catalog without installing previously omitted optional plugins. Later
catalog additions install by default, along with their missing dependencies. A
disabled dependency stays disabled and blocks adoption until enabled. Custom
packages outside the bundled
catalog still use the explicit install command above.

A bundled package that takes over behaviour core used to have sets
`"adoptOnUpgrade": true`. A registry that finished setup before the package
existed installs and enables it once, the next time Orc starts or installs, so
the behaviour keeps working without a manual step. The registry records each
adopted id in `upgradeAdopted`, so a later disable or removal sticks. A fresh
setup, the first-launch picker and an explicit `--plugins` choice record every
such package without enabling the ones the person left out.
`orc-app-plugin adopt` runs the same step by hand.

An optional package that sets `"onByDefault": true` starts ticked in Orc's
first-launch picker, so a setup there has it on unless the person unticks it.
The installer's Plugins step does not offer it, and `./install.sh
--plugins=…` installs only the packages it names. Auto merge sets it together
with `adoptOnUpgrade`, so an install that never had it gets it once and
turning it off afterwards sticks. A required package is always on and takes no
`onByDefault`.

A package that only some machines were using sets `"adoptOnUpgradeIf"` to a
home-relative file under `.orc/` instead. It is off for a new install and is
not installed just for being new to the catalog; a machine where that file
exists (and is not empty) gets it installed and enabled once, recorded in
`upgradeAdopted` like the rest. Tailscale uses `.orc/tailscale.json`, where
core kept its saved routes.

Subscription usage was a bundled plugin and is now part of Orc: the sidebar
allowance rows and the Usage card that opens Settings → Account, whose Show in
sidebar switch hides the rows. The first start of a release without the
package drops its old registry record, as it does for the retired MSN theme.

Installer output is concise; it prints the full log's location, and
`--verbose` streams details. No redirected input waits for a terminal prompt.

## Package contract, API 2

Each directory has `orc-plugin.json`. A minimal theme is:

```json
{
  "apiVersion": 2,
  "id": "paper",
  "name": "Paper",
  "version": "1.0.0",
  "description": "A quiet paper palette",
  "contributes": {
    "theme": {"id": "paper", "label": "Paper", "css": "theme.css"}
  }
}
```

Its `theme.css` sets the palette by day, and by night twice: once for Dark, once
for Auto at night.

```css
:root[data-paper] {
  --bg: #faf8ef; --panel: #fffdf5; --border: #b9b29c; --text: #30362c; --heading: #1d211a;
  --muted: #6f6a5a; --accent: #2f5d8a; --accent-soft: #e8e2cc; --chip: #ece6d2; --code: #f1ecdc;
  --green: #3f6b2e; --yellow: #7a5a12; --red: #a8323f; --purple: #6a4a8a; --cyan: #1f6466; --orange: #8f4f1c;
}
:root[data-paper][data-theme="dark"] {
  --bg: #1c1b17; --panel: #22211c; --border: #4a463b; --text: #d8d3c4; --heading: #f1ecdc;
  --muted: #8a8472; --accent: #8fb6dc; --accent-soft: #2e2c24; --chip: #2e2c24; --code: #26241e;
  --green: #9cc77f; --yellow: #d9b866; --red: #ec8a8a; --purple: #bfa3dc; --cyan: #82c4c0; --orange: #e8a06a;
}
@media (prefers-color-scheme: dark) {
  :root[data-paper]:not([data-theme="light"]) { /* the same night tokens */ }
}
```

A token left out comes from Swamp. [THEMING.md](THEMING.md) lists every token and
hook Orc promises, with Swamp's values; anything of your own starts with the theme
id (`--paper-ink`, `.paper-cloud`). The host loads enabled styles before paint and
synchronizes the selected theme with artifact frames. Preview does not save;
Escape reverts; selecting commits.

`apiVersion` is the version of that promise. A release that removes or renames a
token, hook or kit export raises it and lists each change under **Theme changes**
in its notes. Orc loads packages made for older versions and refuses packages
made for newer versions. Run `orc-app-plugin check <folder>` for compatibility
guidance.

Opening or leaving a separate screen (Settings, Activity, Calendar, Servers and so on)
plays a View Transition: the screen being left shrinks back into a blur and fades
over the next one, as the open run does when you settle it. The docked sidebar is
on both screens, so it stays still while the rest of the page blurs. Moves between
runs, project home and the Assistant stay instant. While it runs, `<html>` carries
`data-view-transition` naming the destination (`settings`, `activity`, `run`, …)
and `--orc-view-x`, `--orc-view-y` (where it started, such as the clicked control)
and `--orc-view-r` (the distance from there to the farthest corner). Every theme
shares the blur, so leave `::view-transition` and its layers alone. Reduced motion
skips it entirely.

A package may set a top-level `icon` (a PNG in the package) for its plugin hub row; a theme's own `icon` serves when it has none.

Optional theme fields: `description`, `icon` (PNG), `gary` and `sheila` (the
assistant's face in this theme: 512 px PNG cutouts of the character alone on a
see-through background; without them the assistant keeps Orc's own pair),
`favicon` (relative SVG/PNG/ICO or
`data:image/...`), `announce` (string or `{on, off}`), `backdrop` (`{svg}` or
`{gradient, opacity, blendMode}`), `radio` (`{style, leads, scenes, textures}` — adds
a station to an external audio plugin without changing its code), `components`
(ES module default-exporting optional `{runRow, statusLamp, tabBar, sidebarHead, emptyState}`
built with `el()` from `/js/theme-components.js`), `scene` (ES module), `tokens`
(generator input). A `terminal` entry is still
accepted and no longer loaded: the maximised terminal opens with the screen change
every theme shares. So is a `sound` entry: switching themes plays nothing.
Animated `frontend.js` modules can build on `defineFunMode(spec)` from
`/js/fun-modes.js` instead of re-implementing storage, favicon restore and
press/trail loops. Give it `homeLayerId` and `buildHomeLayer` to keep a layer
of the theme's own on the new-run screen, under the composer and the notes:
Orc lays it again each time that screen is rebuilt.
Scene modules import three.js and Orc's scene engines from the scene kit at
`/theme-kit/1/` (`three.js`, `stage.js`, `party.js`, `factory.js`,
`factory-layout.js` and Swamp's `swamp.js`), so an outside scene is a plain ES module
with no build step; THEMING.md lists what each promises. Frontend
modules may import the page modules THEMING.md lists, and only those exports.
Scene modules default-export an object with `look` and constructors (`yeet`, `pr`, `plan`
and, optionally, `clear`); constructors return `{canvas, render(time), dispose()}`, with
`masksPage: true` from one that hides itself behind the page (see `createPageMask` below), so the
host does not also cut its usual window in the canvas as the page opens. See the
existing packages for the choreography arguments. `clear` is the All settled scene, which
plays when settling a run leaves none listed: a theme without one gets Swamp's, and
`look.words.clear` names its word, which lands at `CLEAR_LANDS`, and `createFireworks`
from `ui/yeet/party.js` draws the shells every bundled theme sets off then. A cast posed from keyframes that throws sprites
about (Uwu's kitty) takes `keyframes`, `sample`, `particles` and `spray` from
`ui/yeet/cast.js`. One that moves its hands along point tracks and bursts into solid
flecks (Christmas's snowman, Spooky's ghost) takes `keysV`, `createFlecks`, `fling` and
`contactShadow` from the same module, and one with jointed limbs (the snowman's arms,
Spooky's skeletons, Upside Down's kid) bends each with `bendLimb`. One that comes through the
page itself (Upside Down's monster) takes `createPageMask` and `screenPoint` from `ui/yeet/tear.js`:
the mask is the host's two papers as a sheet that draws nothing, so the scene shows only where
they have parted, and its `edge` says where a torn edge is on screen for a hand to hold.
`node app-plugins/build.mjs` builds the kit into `ui/vendor/theme-kit/` and each
bundled scene from `build.scene` into the manifest's `contributes.theme.scene`,
with its imports of three, `ui/yeet` and Swamp's scene pointed at the kit, so a
bundle carries only the theme's own code.

A scene module may also export `factory(container, options)`, the floor of a
run's Factory tab; a theme without one gets Swamp's. The bundled themes build it
with `createFactory(container, skin, options)` from `ui/yeet/factory.js` and keep
the skin in `factory.js` beside the scene. The engine owns the data, layout and
choreography: the run's own agent is the hall at the back, and each subagent and
Orchestrate worker gets a station either side of the aisle that leads to the
hall's door. Only what the run really handed over moves between them. A train of
blips leaves the hall for a station each time its agent is given instructions,
longer for a bigger hand-off. A finished job's crate pops out of its station and
rides the skin's carrier back into the hall, followed by blips for the size of
the result; an Orchestrate worker's crate waits outside its station until the
main agent has taken the result. A station whose agent has finished or been
stopped stands lit a few seconds more, then is decommissioned: its lights
flicker out to weathered copies of its materials, it slumps and leans, and a
cordon goes up round it. It stays in its slot, greyer and more overgrown the
longer ago its agent closed (a day brings the most), until the floor is full
and a newcomer needs the slot; the oldest decommissioned station makes way
first. A floor that opens on a run already shows its closed agents' stations
decommissioned. A failed station stays lit. A skin is an object of optional parts. Each builder receives a kit: the resolved `palette`, `mode`, `software` and
`reducedMotion`; colour helpers `color` and `blend`; material helpers
`mat(color, {rough, metal, emissive, glow, opacity, flat, doubleSide})`,
`basic(color, {opacity, additive, doubleSide})`, `canvas(w, h, draw, {repeat,
nearest})`, `picture(url, loaded)` (a texture of an image beside the skin,
`new URL(file, import.meta.url).href`, freed with the scene, with `loaded`
called once it is in), `painted(draw, {width, height, repeat, nearest, rough, metal,
emissive, glow, basic, transparent, opacity, additive, doubleSide})` and
`lamp()`, the shared `windows` and `beacon` materials; shape and ground helpers
`ground({radius, color, rough, metal, draw, repeat, y, z})`, `gable(width,
depth, rise, roofMat, {bodyMat, trimMat, overhang, thickness})`, `shadow`,
`halo`, `box`, `cylinder`, `sphere`, `sawtooth` and `shadows`; and `stock`, the
default parts, to build on. A colour is a palette key, a CSS colour or a number.

- `palette: {light, dark}` sets CSS colours for `ground`, `horizon`, `zenith`,
  `line`, `aisle`, `body`, `trim`, `roof`, `accent`, `worker`, `busy`, `ok`,
  `fail`, `idle`, `crate`, `tape`, `smoke`, `glow`, `window`, `door`, `sun`,
  `sky`, `dust` (what a decommissioned station's materials fade towards) and
  `moss` (the stock ruin's weeds: green by default, set it to frost, snow or
  dust where weeds would not grow), and the numbers `sunIntensity`,
  `skyIntensity`, `envIntensity`, `exposure`, `fogNear` and `fogSpan`. Keys
  left out come from the theme's tokens; other keys are the skin's own.
  Optional `backdrop`, `pad`, `dock`, `ghost` and `ruin` override the stage CSS
  backdrop, station plinths, receiving pallet, queued scaffold and
  decommissioned dressing (`false` omits `pad`, `dock` or `ruin`).
- `layout: {bend, stagger, jitter, turn}` reshapes the floor, each within its
  limit. `bend` (±0.8) slants every row into a chevron by that much per column:
  negative sweeps the outer stations back beside the hall, positive brings them
  forward. `stagger` (0 to 0.5) slides the right-hand rows forward by that share
  of a row, `jitter` (0 to 0.25) nudges each station off the grid, and `turn`
  (0 to 0.6 radians) angles station fronts from the aisle towards the camera.
  `view: {elevation, azimuth}` sets the camera's height (0.4 to 0.8 radians,
  0.55 by default) and its side (±0.3, 0.075 by default).
  An illustrated floor can supply `layout.position(spot)` to set world
  `{x, z, yaw}` and `layout.driveway(spot)` to return ground waypoints
  `[[x, z], …]` from the parcel pickup to the hall door.
  `layout.preferredColumns` lists column indices by agent kind. Both sides
  of each row fill before the next row, and existing stations keep their lots.
  `view.overview(aspect, {rows, columns, reach, front})` can return a Vector3
  `target` and a `distance` for the opening view. `view.sway` controls
  the idle orbit amplitude and `view.softwarePixelRatio` the render scale
  (0.5–1) on a software GPU.
- `view.painting` makes the floor a painting, seen only from where it was
  painted: `{size: [width, height], fov, elevation, eyeHeight, anchor: {at:
  [px, py], on: {x, z}}}` places the painter (a frame `size` pixels, `fov`
  degrees up its height, `elevation` radians below the horizon, `eyeHeight`
  above the ground, with frame pixel `at` on the ground point `on`), and
  `paintedCamera` from `factory-layout.js` gives the skin the same mapping
  (`ground`, `wall`, `sheet` and back to `frame`) to lay its plates and
  cut-outs on their painted pixels. The camera never moves: panning, zooming,
  focusing a station and trips slide and scale a window on the painting
  instead, within `art` (`{left, top, right, bottom}`, the painted extent in
  frame pixels, which no view shows past) and no closer than `sharp` painting
  pixels to a CSS pixel. `overview({rows, columns, reach, front})` returns the
  frame box `{left, top, right, bottom}` to fit for the used floor (the hall
  and every station without it), and towns stand `period` pixels apart along
  one strip, east or west of each other, so a plate `period` wide that tiles
  joins one town's painting to the next. Nothing on a painted floor bends: the
  engine neither slumps, leans, wobbles nor weathers a station, nor pulses the
  hall, so a skin shows those moments in its own pictures through `frame` and
  `react`.
- `floor(kit)`, `hall(kit)`, `station(kit, kind, spot)`, `crate(kit)` and
  `decor(kit)` each return an Object3D. `kind` is `subagent` or `worker`, and
  `spot` is `{slot, side, row, column, index}`: where the station stands and how
  many of its kind came before it, so a skin can build each one differently. A hall stands at its
  origin facing +z, about 4.9 by 3.1, with its door at z 1.4; its `userData`
  names the rolling `door`, the `beacon` that blinks while the run waits on you,
  a `chimney` Vector3 for smoke, an optional `intake` Vector3 where crates go in
  when that is not the door (an air carrier flies on to hover over it, and a
  ground one lobs the crate up to it from the door), optional `spin`, `swing` and `frame`, a
  `labelY`, and an optional `react(event, station)` called with `delivery` as a
  crate lands and `spawn` as a station is sent out. A station also faces +z (the engine turns it to the aisle) within
  about 1.9 by 1.7; its `userData` names its state `lamp` (a mesh using
  `kit.lamp()`), `spin` (`[part, axis, speed]`), `swing` (`[part, axis, amount,
  speed]`) and optional `frame(time, dt, station)` for the parts that move while
  it works, optional `occupants` (the Object3Ds of whoever works there: its
  creatures, crew or performers, which leave in a puff of dust as the station
  is decommissioned, so a decommissioned station stands empty, and come back
  if its agent works again), a `puff` Vector3, a `labelY`, and an optional `react(state,
  station)` called as its agent changes state, with `instructions` as a train
  from the hall arrives and with `decommission` as the station starts to power
  down. The hall's `react` also gets `send` as a train leaves it. `station`
  carries `state` (`queued`, `running`, `done`, `failed`, `stopped` or
  `unknown`), `activity` (0 to 1, easing in while it runs), and `doneAt` and
  `failedAt` on the frame clock (`-Infinity` when it was already so on the first
  snapshot). Decor stays outside x ±9.6, z -7 to 10.
- The hall can also set `labelX` and `labelZ` to hang its label over the
  facade. `ghost(kit, kind, spot)` can draw the queued station in its lot,
  with `queuedLabelY` on the station model giving its label height.
  Set `puff` to `false` when the station shows failures through its own artwork.
  `pileSpot(index)` returns a world-space Vector3 for each delivered parcel.
- `ruin(kit, kind, spot)` returns an Object3D laid round a decommissioned
  station on the ground, within about 2.1 by 1.9 (just outside the station's
  own 1.9 by 1.7), called as `station` is. It rises in once the station has
  slumped. Its `userData` may name
  `frame(time, dt, station)`, where `station.weathered` (0 to 1) says how long
  ago the agent closed: it eases up from 0 as the ruin goes up, and reaches 1 a
  day on. The stock ruin is a taped cordon with one end snapped and stirring,
  a CLOSED plaque, rubble and `moss` weeds that grow with `weathered`. While a
  station stands decommissioned the engine stops calling its `frame` and keeps
  its parts where they were, wearing weathered copies of their materials (the
  lamp goes dark instead) with its `occupants` gone, and its `react` hears
  `decommission` as that starts.
- `carrier(kit)` returns `{object, hold, route, cruise, pose}`. The crate rides
  at `hold`; `route` is `air` (an arc at `cruise` height) or `ground` (between
  the rows and up the aisle); `pose(object, {time, travel, phase, speed})` adds
  the carrier's own motion each frame after the engine has placed it. A
  finished carrier's geometry is freed but not its materials, so build it from
  the kit's.
- `packet(kit, direction)` returns the Object3D for one blip of a hand-off:
  `down` for instructions leaving the hall, `up` for a result's bytes behind
  its carrier. The engine moves it along the carrier's route at 0.1 above the
  floor (or lobs it over the floor where the carrier flies), turned to face its
  way, and frees its geometry on arrival, so build it from the kit's materials.
- `advisor(kit)` returns an Object3D for the advisor the main agent asks: a
  character drawn for the theme's world, facing +z within about 2.1 by 2.1.
  It stands beside the hall only while it reads (the stock one is a robed
  reader at a lectern in the theme's colours). The engine raises it in, sends
  pages from the hall to it every second or so, and when it answers sends a
  light back to the hall before it leaves. Its `userData` may name `labelY`,
  `page` (a Vector3 where pages land, such as the book it reads), and
  `frame(time, dt, advisor)` and `react(event, advisor)`, where
  `advisor.activity` eases from 0 to 1 while it reads and `event` is
  `arrive`, `answer` (before the light leaves) or `leave` (an ask that came to
  nothing). The hall's `react` hears `advice` as the light lands. It stands at
  world `{x: -4.4, z: -5.6, yaw: 0.6}`; `layout.advisor` moves it, which a
  painted floor or a wide hall needs. `pageColor` sets the pages' colour.
- `weather(kit)` returns `{object, frame(time, dt), dispose()}` for ambient
  motion, and `frame(time, dt, kit)` runs every frame. `kit.traffic` says what
  is really on its way: `down` and `up` count the hand-offs in flight, `flow`
  eases to 1 while there are any, `clock` only runs while they do, and
  `progress` is the share of the crew that has closed. Motion along the aisle
  that reads as something travelling should run on these, not on `time`, so the
  floor is still when nothing is being handed over.

Every run's floor is a town on one map, and all towns share the skin's
scenery. When the Factory moves to another run, the engine draws the scene
twice for the length of the trip, once for the town being left with its crew
and once for the town ahead, about 108 units apart. The trip is a whole number
of repeats of the floor's widest tiled texture, so the two grounds meet without
a seam: tile the ground (`kit.ground` with `repeat`), and fade the rim of any
other wide sheet rather than ending it on a hard edge. A painted floor's towns
stand its `period` apart instead, each drawn through the window slid over it,
the town ahead laid whole over the one left.

The sidebar's Settled shelf, closed as a tab at the foot of the run list and
open as a drawer over it, takes its shape from tokens a theme may set:
`--settled-shelf-radius`, `--settled-shelf-border-width`,
`--settled-shelf-border-color`, `--settled-shelf-bg` and
`--settled-shelf-shadow`, with `--settled-head-justify` placing the label
(`flex-start` by default). Orbit makes the shelf a planet's horizon with them.
The closed shelf spans the sidebar from edge to edge, clear of the list's
scrollbar, and the list ends where it begins however tall a theme makes it.

Theme CSS may set `--factory-stage-bg` for the backdrop behind the canvas. Keep
geometry low-poly: up to 24 stations draw every frame. `orc-shot factory --theme
<id> --gif` captures a delivery in progress (in this checkout). Swamp's palette generator remains
`bin/orc-theme --write`.

Other supported contributions:

- `frontend`: ES module exporting `activate({signal, base, commands, status, accounts, settings, view})`.
  Return a disposal function. Own and remove all DOM, timers, audio, observers,
  channels and listeners. Abortable work uses `signal`. `commands(read)` supplies
  palette entries; `status(value)` supplies a sidebar status.
  `view({hash, subroutes, show, hide})` registers a top-level screen with the existing
  router and View Transitions; pass `subroutes: true` when `#<hash>/…` paths belong
  to the same screen, and `show(hash)` receives the routed hash (see Pull requests).
  The package owns its navigation, DOM and styles;
  its disposal must hide the screen and navigate away if it is open (see Calendar).
  A package reads the run list as `runs` from `/js/core.js` and redraws on the
  `orc:runs` event, which `document` receives after every change to that list
  (see Calendar's meeting flashcards).
  `extendChatComposer(render)` from `/js/chat.js` adds buttons to a run's Chat
  composer, left of the microphone. `render({runId, mode, meta, slot,
  setStatus, setPlanStart, showAutoMerge})` runs when Chat mounts and whenever
  the run's mode, phase or status changes; the package owns its elements in
  `slot`, gives a toggle the pressed look with the `is-active` class, and
  `setStatus(text, tone)` keeps a line under the prompt until it passes `''`. A
  package that starts the build once a plan is ready passes
  `setPlanStart(true)`, so Chat's Planning bar says so instead of asking for
  Start work, and `false` when it no longer will. `showAutoMerge(enabled)` is
  Auto merge's own: it draws that flip's badge at once and returns
  `{id, takeBack}`. The returned function unregisters (see Auto merge).
  `extendChatBanners(render)` from `/js/chat.js` adds cards above a run's Chat
  composer. `render({runId, agent, meta, data, slot, onSettled})` runs when
  Chat draws; the package owns its elements in `slot` and may return
  `{waitingOnYou: true}` while a card waits on the user. The returned function
  unregisters (see Secrets).
  `/js/quiet.js` is when Orc keeps quiet. The package that knows when you
  are busy gives its whole list of times with
  `setQuietTimes([{ start, end, reason }])`, in epoch milliseconds, and an
  empty list on disposal (see Calendar's `meeting-quiet.js`); a second such
  package would replace the first's list. Sound effects stop while a time is
  on. A package that makes sound of its own or speaks up asks `quietNow()`,
  which answers `{ reason, until }` or null, at the moment it would do so,
  since a hidden page's timers run late. It redraws on the `orc:quiet` event,
  which `document` receives when the times change and as each starts and ends.
  `extendPlanTools(id, render)` from `/js/plan-page.js` adds controls to a
  plan page. `render({runId, meta, layout, own, actions, tools, work})` runs
  after every paint of a plan, with its `.plan-actions` row at the top right
  beside the plan's title, its `.plan-tools` row of links at the foot of the
  steps (`null` when it has none) and its `.plan-work` card; the package
  marks what it adds with `data-plan-extension="<id>"`, which a repaint
  drops. The returned function unregisters and removes that package's nodes
  (see Tailscale's Share).
  `"pairedSwitch": false` in a manifest keeps a paired browser from turning
  the package on or off (Tailscale's switch opens this Mac to the network).
  `accounts(mount)` adds a card to Settings → Accounts, after GitHub: core
  calls `mount(card)` with an empty `.settings-card` element each time it draws
  that tab, and `mount` fills it and may return a cleanup function. Core runs
  the cleanup and removes the card when Settings redraws or the package is
  disabled. Actions that change the host, such as signing a CLI in, belong in
  the package's `backend` and should refuse anything but Orc on the host
  (`handler._secret_entry_local()`).
  A link to `#settings/<tab>/<key>` opens that tab scrolled to and focused on
  the element carrying `data-settings-anchor="<key>"`, which may be drawn after
  the tab. Core's own account rows use `<provider>:<folder>`, such as
  `claude:.claude-two` (see the gear in Subscription usage's tooltip). `window`
  receives `orc:account-sign-in` when a sign-in or reconnect there finishes.
  `settings(mount)` registers a dedicated settings screen at `#settings/plugin/<id>`,
  opened by the cog on an enabled plugin's hub row and by `Open <Name> settings`
  in the command palette. Only this Mac can open it, unless
  `settings(mount, {paired: true})` also opens it to a signed-in paired
  browser, whose saves the backend then accepts by checking
  `handler._signed_in_device()`. It
  receives an empty element and may return cleanup,
  which runs on navigation, redraw or disable. The hub never mounts the form.
  The screen heads the card with the package's icon, name and description, so
  the card needs no title of its own. `settings(mount, {wide: true})` gives a
  screen that is an editor, not a form, the page's full width.
  The card sits inside Settings' own form,
  and HTML drops a `<form>` nested in another: save from a button's click and
  the field's Enter key instead (see Calendar). Native inputs inside
  `.settings-field` get the Settings field style.
  Unchanged plugin refreshes preserve the mounted input. Dispose secret inputs
  on cleanup; never serialize them through host config or browser storage (see Calendar).
  Use `/api/config` with `baseMtime`
  for conflict-aware configuration saves; preserve fields the package does not own.
- `backend`: Python module exporting `activate(context)` returning a service
  with `handle(handler, method, path)` and `deactivate()`. Return true from
  `handle` only after answering. Deactivation returns true when work is drained;
  false reports Stopping and blocks new requests until Apply completes. Context
  includes `home`, `root`, `is_enabled`, `allow_network`, `read_secret`,
  `themes`, which returns the enabled theme ids each time it is called, and
  `owns_native_app`, true only on the instance behind Orc.app. `read_config()`
  returns `(config, broken)`; treat the config as read-only. `update_config(transform)`
  rewrites config.json as `transform(copy)` under the Settings write lock and
  raises `OSError` when it cannot. A backend starts on its first request, and at
  server start on the instance that owns Orc.app (Stay awake holds the Mac from
  then). Check `is_enabled()` before scheduling work; previews must respect
  `allow_network`. Existing origin/LAN gates still apply. Response handlers may
  run concurrently; the host retains a service until its admitted handlers finish.
  An optional `resume()` may return true to safely resume that same instance and
  revision after disablement. Without it, work must drain before reactivation;
  it is never used to replace one revision with another.
  A backend may also define `watch_tick()`, which the server's watch loop
  calls every tick (not on previews) while the package is enabled; an error is
  printed and never stops the loop or another package.
  A backend may define `usage(refresh)` to add rows to Subscription usage. It
  returns a list of `{provider, label, status, windows, checkedAt}` rows, where
  `provider` is a lowercase id other than `claude`, `codex` or `agy`, `windows`
  holds `{label, remainingPercent, resetsAt}` with the first one shown in the
  sidebar, and optional `credits` (`{remaining, limit}` as whole numbers),
  `plan`, `message` and `stale` fill in the card and tooltip. A row has no
  renewal day. Return `[]` when there is nothing to show and check
  `allow_network` first. The usage card asks every minute and waits for every
  plugin's answer, so cache what a slow service reports. A row with a malformed
  window is left out.
- `externalService`: passive cleanup evidence, not a launch or uninstall hook.
  `files` lists home-relative presence markers; `pidFiles` lists home-relative
  JSON files containing a positive integer `pid`; `stopCommand` is an argument
  array beginning with a package-relative executable; optional `startCommand`
  has the same shape. The host probes presence/liveness and displays the stop
  command. It runs the two commands only when an Orc upgrade replaces a pinned
  package with the copy its release ships: stop, wait for the markers to clear,
  install, then start the new copy if it had been running. Retained
  records keep recovery instructions after removal/restart without importing
  disabled code. Missing markers or an exited PID clear the pending display;
  malformed/unreadable evidence remains pending. A new revision is refused while
  the previous external service remains; the same revision may be re-enabled.
- `harness`: an agent core launches beside Claude and Codex, as
  `{"id", "label", "module"}`. See Harness packages below.
- `commands`: mapping of executable command names to package-relative files.
- `railsHelpers`: package-relative JSON provider configuration for repository
  identities, a command, browser script and run MCP identity. Core contains no
  company behavior.
- `pullRequestReviewer`: a bot that reviews pull requests in a GitHub Actions
  workflow, as `{"repository": "<owner>/<repo>", "workflow", "login"}`. A run
  of `workflow` in `repository` titled `Review <owner>/<repo>#<n>` reviews that
  PR and posts its verdict as a review by an account whose login starts with
  `login`. The Pull request panel shows that review's state; the first enabled
  package's reviewer wins, and with none the panel shows no reviewer row.
- `qaBrowser`: buttons and a page script for the QA window's browser, as
  `{"hosts": [...], "script": "<file>.js", "buttons": [{"id", "label"}]}`.
  `hosts` are host names where `*` stands for part of one label
  (`*.example.test`, `example-*.localhost`). On a page whose host matches, the
  toolbar shows each button. In Orc.app the script runs on every such page, at
  document end, in a content world of its own that the page's scripts cannot
  reach; it gets `orcQa.button(id, handler)`, and a press calls `handler({
  center })` (the button's middle in px from the page's left edge), which
  returns whether its panel is now open. A plain browser tab shows the app in
  an iframe Orc cannot script, so it shows no buttons.
- `qaSetupFixes`: known reasons a run's app setup stops, as a list of
  `{"id", "match", "reason", "explain", "command"}`. When an orc-devd process
  stops on an error, Orc reads the end of its log and the first fix whose
  `match` (a Python regular expression) is found there names the failure in
  the QA window: `reason` as the heading, `explain` below it, and `command`
  with **Run it**. The command is one line, runs in the person's login shell
  outside the QA sandbox, and only when they press Run it; Orc runs the
  command the plugin named, never text the page sends. When it exits with 0,
  Orc starts the app again. A failure no fix matches still shows its log lines.
- `sendOffs`: retired; send-offs are built into Orc (`ui/js/send-offs.js`) and
  toggled in Settings → Appearance under Reduce animations, playing silent
  scenes for merges and PRs only. While Reduce animations or the system's
  reduced motion is on, the switch is greyed out and no scene plays. Existing
  manifests declaring `sendOffs` still validate without being loaded.
- `worktreeServers`: retired; automatic dev servers are built into Orc
  (`ui/worktree_servers.py`) and set per project under Settings → the project →
  Runs & workspace → Live dev server. Existing manifests declaring
  `worktreeServers` still validate without being loaded.
- `skills`: package-relative directories containing `SKILL.md`. Enabled packages
  get owned links in `~/.agents/skills`, `~/.claude/skills`, configured
  `CLAUDE_CONFIG_DIR/skills`, and `.claude-*` accounts containing `.claude.json`.
  Recorded ownership lets disable/remove clean those links even after the
  environment changes; foreign files and links are never replaced.

Paths must stay inside the package. Symlinks, special files, local `.git`, `.env`,
`node_modules` and bytecode caches are refused. IDs are lowercase kebab-case.
External packages cannot shadow bundled IDs, core commands or another theme.
Theme IDs cannot use host attributes: `theme`, `fun-mode`, `orc-embedded`,
`orc-questions-only`, `orc-actions-loading`, or `pwa-offline`.
Required-package policy is reserved for the bundled catalog. Disabled code is
not imported or served. Desired enablement, runtime draining, selected theme and
audio playback are separate states; read Settings' error/details before retrying.

Inside this checkout, `bin/orc-theme-surface` holds Orc to the promise: it fails
when a promised token, hook or export disappears, when a bundled theme reaches past
the surface, when THEMING.md is stale (`--write` rewrites it), or when a promise
dropped since the last public release has no "Theme changes" entry in
`distribution/CHANGELOG.md`. `bin/orc-pack` refuses a public export in that last
case; after a release goes out, `--mark-published` records its surface.

### Harness packages

A `harness` contribution adds an agent beside Claude and Codex. Core imports
its Python `module` only while the package is enabled, as a package rooted at
the package directory, and asks it about its agent: launch argv and prompts
(`turn_argv`, `launch_prompt`, `turn_prompt`, `check_launch`), its permission,
effort and fast tables (`PERMISSION_MODES`, `EFFORT_LEVELS`, `FAST_ARGS`), its
session and transcript (`session_id`, `before_turn`, `sync_transcript`),
`thread_link`, `set_archived`, `follow_up`, orchestration
(`orchestration_provider`, `orchestration_args`), bot modes and an `ASSISTANT`
turn runner. Each is optional; core skips what a harness lacks. External
harnesses use the same contract.

The manifest entry carries what the browser needs without importing Python:
`label`, an SVG `mark`, `modes` (`{id, agent, model, label}`, each a core
model the harness runs), `effortModes` (the modes that take an effort, with
optional `effortLevels` on the harness or mode narrowing the slider stops and `effortNotice` for the rest), `cloud` (`{label, hint, githubOwnersConfig?,
projectsConfig?}` for a harness that runs core's models in its own cloud,
behind the composer's execution toggle; `projectsConfig` names the config key
holding where it runs — `"all"`, a project path list, `{"orgs": [...]}`, or
omitted for none — configured on the plugin's settings page, and the composer leaves the harness out of every other project), `reviews: false` when local review cannot run on it,
`assistant` (`{note}`) when it can run the assistant, and `projectSettings`
(`{hint, fields}`) for a card of project toggles. With the package disabled
none of these render, core refuses the agent with "<Label> needs the <Name>
plugin. Enable it in Settings → Plugins.", and its existing runs stay readable
as history.

## Prompts for agents

> Create a theme package in app-plugins using API 1 and the Paper example. Keep
> its palette, assets and scene code in the package, and use only what THEMING.md
> promises. Do not add a core theme-name table. Run orc-app-plugin check, then prove
> install/disable/fallback using a disposable home and orc-shot.

> Add a trusted application plugin with frontend activation and disposal. Read
> app-plugins/calendar for lifecycle examples. Exercise enable, disable and re-enable,
> asserting that owned listeners, polling and audio stop. Do not access accounts.

> Extend an external package through the same manifest and registry as bundled
> packages. Test a local Git/subdirectory install and unknown-link refusal with
> disposable fixtures. Never opt in from source presence or legacy environment.

### Auto merge

The bundled **Auto merge** package (`auto-merge`) is on by default
(`onByDefault` and `adoptOnUpgrade`). It adds a ship button leftmost in each
run's Chat composer, off for every run until someone presses it. A run with it
on takes its project's Ship action (merge and push, merge or open the PR) once
it reaches Ship, through core's `ship_at_landing_stop`. Turning Auto merge on in
a planning run's Chat also starts the build automatically as soon as the plan
finishes (through core's `start_plan_at_plan_stop`, carrying Auto merge onto
the launched build run(s)) so it builds and ships without waiting for Start
work. Each run's choice
lives in its `auto-merge-choice.json`, and the last attempt in
`auto-merge-attempt.json`. Each time the choice changes, `set_enabled` or the
toggle's POST also adds `{id, at, enabled}` to `auto-merge-changes.json` (the
latest 200), which Chat's payload carries as `autoMergeChanges` and Chat shows
as a green **Auto merge on** or red **Auto merge off** badge where it happened.
The POST may send the `changeId` its page already drew the badge with, and
answers with the `change` it recorded, null when nothing changed. Only the
user sees the badges: the agent gets no message. It also puts a ship button in the new-run
composer's slot (`.nc-startbar-auto-merge`). Each browser remembers that
button's choice, off until first pressed, and while it is on the composer
skips the plan, launches a change run (`mode: "orc"`) with `autoMerge: true`,
and updates the tray hint to `Enter to start`, so core's `_reserve_launch`
calls the package's `set_enabled` for the new run before its agent starts.
Only Orc's own composer may send it: an MCP or orchestrator launch, an Evals
or meeting-prep launch, or a launch while the package is off is refused.

### Vaults

The bundled **Vaults** package keeps small pages you build by describing
them, one purpose each, such as your goals, a wins board or a prep card for
your next meeting. A model writes a vault's page when you ask and when one of
its automations runs, and each vault keeps notes and a `SOUL.md` behind its
page. Agents read those and propose additions that wait for your approval. See
[its README](vaults/README.md).

Its backend starts a build as a headless Claude turn through core's
`headless_session`, and runs automations from a thread that ticks only where
the context's `run_schedules()` says this server runs schedules. Core hands
it the day's meetings as `calendar_meetings()`, which asks the Calendar
package and returns None while that is off. Outside the server's plugin
runtime, core reads the package's `vault_store.py` through
`app_plugins.enabled_module`, which returns None while the package is off, so
a disabled Vaults package adds nothing to any turn.

### Tailscale

The bundled **Tailscale** package holds everything Orc does with Tailscale:
phone access with phone pairing, the private address linked laptops trade
for the sidebar badge, vault phone addresses, optional plugin bot-access
routes, and shared plans. It is off for new installs
and adopts once where `~/.orc/tailscale.json` exists (`adoptOnUpgradeIf`).
`tailscale_access.py` owns the Serve and Funnel routes (phone on 8443, bot on
443, shared plans on public Funnel 10000) and the five setup checks;
`share_server.py` copies a plan into `~/.orc/shares/<token>/` and serves only
those copies, with a strict CSP, on `127.0.0.1:4190`. `backend.py` answers
`/api/tailscale/*` to Orc on this Mac alone (`handler._host_owner()`) and
gives core `phone_url`, `private_phone_url` and `close` through
`APP_PLUGIN_RUNTIME.invoke`. Its settings page is the setup checklist and
the **Use it for** switches; **Share** joins the plan page's top right through
`extendPlanTools`. See [Use Orc on your phone](../docs/tailscale.md).

### Skills

The bundled **Skills** package (`skills-manager`) is part of Orc: it is
`required`, so it is always on and has no row under Settings → Plugins (a
required package that is not a theme is not listed there). It manages user and
project agent skills from the Skills tab of Settings (`#settings/skills`; old
`#skills` links land there), keeping one canonical copy in
`~/.orc/skills-manager/store` and atomic symlinks across Carbon
(`~/.gemini/config/skills`), Codex (`~/.codex/skills`), Shared
(`~/.agents/skills`), every active Claude Code login (`~/.claude/skills` and
`~/.claude-*/skills`), and attached Orc projects. Paste a GitHub, `skills.sh`,
`npx skills add`, raw `SKILL.md` or local path anywhere on that tab to add a
skill, remove one with its row's bin (Undo is in the toast), repair drift or diverged edits across logins, and check or pull upstream
updates on a daily schedule. It contributes the `orc-skills` CLI and the
`skills-manager` skill; see [its README](skills-manager/README.md).
