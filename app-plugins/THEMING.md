# Theme reference

<!-- Written by bin/orc-theme-surface --write from app-plugins/theme-surface.json. Edit that file, not this one. -->

Everything Orc promises a theme, for plugin API 2. A theme that uses only what
this page lists keeps working across releases. When a release removes or renames
something here, its notes say so under **Theme changes**, with the old name, the new
name and what to edit, and the plugin API version goes up. A theme made for an older
version still loads. Run `orc-app-plugin check <folder>` for compatibility guidance.

Your own names start with your theme's id: `--paper-ink`, `.paper-cloud`,
`#paper-sky`. Orc never uses those.

## Make a theme

1. Run `orc-app-plugin new <folder> --id <id> --name "<Label>"` to scaffold a
   `check`-clean `orc-plugin.json`, `theme.css` and `favicon.svg` (or write them by hand;
   see the Paper example in [README.md](README.md#package-contract-api-2)).
2. Set the palette under `:root[data-<id>]`. Give night twice: as
   `:root[data-<id>][data-theme="dark"]`, and as `:root[data-<id>]:not([data-theme="light"])`
   inside `@media (prefers-color-scheme: dark)` for people who leave the mode on Auto.
3. Run `orc-app-plugin check <folder>`. It names missing tokens, colours that miss
   the contrast floors below, and anything you use that Orc does not promise.
4. Run `orc-app-plugin link <folder>` and pick the theme in Settings → Visuals, or
   photograph it directly against the showcase world with `orc-shot agent --theme <folder>`.
   Orc reads linked folders directly, so a saved edit shows in open windows within a few
   seconds. `orc-app-plugin remove <id>` unlinks it.
5. Share it as a folder or a Git subdirectory; others run `orc-app-plugin install`.

## Code or no code

A theme that is only `theme.css`, pictures and declarative manifest fields (`favicon`,
`announce`, `backdrop`, `radio`) is **no code**: installing it cannot run anything.
A theme with a `scene`, `terminal`, `components` or `frontend` module **runs code**
with the person's permissions (use `defineFunMode` from `/js/fun-modes.js` to wire an
animated `frontend.js` without controller boilerplate), as does any package with other
contributions. `orc-app-plugin install` and Settings → Plugins say which a package is.

## Palette

Every theme should set these, by day and by night. Any you leave out come from
Swamp, which can clash with yours. `check` holds them to these floors on both `--bg`
and `--panel`: 4.5:1 for `--text`, `--heading`, `--accent` and `--cyan`; 3:1 for
`--border` mixed 65% with `--heading`; 4.5:1 for `--muted` mixed 45% with `--heading`;
and 4.5:1 for each status colour, mixed with `--heading` by day.

| Token | What it colours | Swamp day | Swamp night |
|---|---|---|---|
| `--bg` | Page background | `#e3e5e4` | `#1a1c20` |
| `--panel` | Cards, sidebars and the composer | `#eceeec` | `#16181b` |
| `--border` | Hairlines and dividers | `#a8b0aa` | `#3b4540` |
| `--text` | Body text; at least 4.5:1 on --bg and --panel | `#38423c` | `#c7cfca` |
| `--heading` | Headings and the strongest text; at least 4.5:1 | `#202722` | `#e0e5e2` |
| `--muted` | Quiet text and fills; Orc prints small text as the --muted-strong mix | `#6e7971` | `#707a73` |
| `--accent` | Links, primary buttons and selection; at least 4.5:1 | `#2d6983` | `#78a9c2` |
| `--accent-soft` | Soft accent fills behind selected rows | `#cbd1cc` | `#29312c` |
| `--chip` | Chip and pill backgrounds | `#cbd1cc` | `#29312c` |
| `--code` | Code block background | `#d4d8d5` | `#1f2422` |
| `--green` | Success and running | `#53743a` | `#9dc76b` |
| `--yellow` | Waiting and warnings | `#8a6a2f` | `#d5b05c` |
| `--red` | Errors and danger; keep it apart from --accent | `#b83f50` | `#e87878` |
| `--purple` | Planning and review | `#76518f` | `#b497d6` |
| `--cyan` | Secondary links and info; at least 4.5:1 | `#256f72` | `#77b8b1` |
| `--orange` | Gates that wait on you | `#9a5a25` | `#e69257` |

### Derived tokens

Swamp works these out from the palette. Set them when your palette needs a different mix.

| Token | What it does |
|---|---|
| `--gate` | The colour of a gate waiting on you; Swamp mixes --orange with --heading by day |
| `--muted-strong` | Small secondary text and placeholders; --muted mixed 45% with --heading |
| `--accent-text` | Accent-coloured small text |
| `--accent-strong` | The accent on filled controls |
| `--red-text` | Error text |
| `--yellow-text` | Warning text |
| `--green-text` | Success text |
| `--orange-text` | Gate text |
| `--purple-text` | Planning text |
| `--ready-text` | The Ready label on a finished run |
| `--blue-text` | Informational links in notices |
| `--state-working` | The Working dot on a run; --accent when unset |
| `--focus` | Keyboard focus ring; at least 3:1 on --bg and --panel |
| `--control-border` | Borders of inputs and buttons; --border mixed 65% with --heading |

### Shape and type

Fonts, corners and the few effects Orc leaves to the theme.

| Token | What it does |
|---|---|
| `--orc-font-sans` | The interface typeface |
| `--orc-font-sans-nudge` | How far a control's label drops so that typeface's capitals sit on its middle (a length, set beside --orc-font-sans) |
| `--orc-radius-sm` | Small corner radius (inputs, chips) |
| `--orc-radius-md` | Medium corner radius (cards, menus) |
| `--orc-radius-1` | Design-system radius step 1 |
| `--orc-radius-2` | Design-system radius step 2 |
| `--orc-radius-chip` | Chip radius |
| `--orc-radius-callout` | Callout and toast radius |
| `--orc-button-radius` | Button radius |
| `--orc-button-text` | Label colour on filled buttons |
| `--orc-cursor-pointer` | Cursor over clickable controls; a url() cursor works |
| `--orc-green` | Design-system green (button hover borders, toggles) |
| `--orc-green-text` | Design-system green text |
| `--orc-heading` | Design-system heading colour |
| `--orc-text` | Design-system body colour |
| `--orc-muted-strong` | Design-system small secondary text |
| `--stage-radius` | Corner radius of the run terminal stage |
| `--head-glow` | A background-image behind the sidebar head (none by default) |
| `--typing-glow` | A box-shadow on the composer while you type (none by default) |
| `--float-shadow` | The one shadow under every floating layer: menus, popovers, tooltips, toasts, drawers and anything being dragged. One layer with no spread, as it is also used inside drop-shadow() |
| `--nc-beam-underlay` | The colour of the composer's rim under its beam; the shell sets it on .newconv-prompt:has(textarea:focus), so set it there too |
| `--factory-stage-bg` | The backdrop behind the Factory tab's canvas |
| `--settled-shelf-bg` | Background of the Settled shelf at the foot of the run list |
| `--settled-shelf-border-color` | Border colour of the Settled shelf |
| `--settled-shelf-border-width` | Border widths of the Settled shelf (1px 1px 0 by default) |
| `--settled-shelf-radius` | Corner radius of the Settled shelf |
| `--settled-shelf-shadow` | Shadow above the Settled shelf (--float-shadow by default) |
| `--settled-head-justify` | Where the Settled heading sits in its row (flex-start by default) |

### Component chrome

Shape, borders, backgrounds and shadows for individual parts of the shell. Any you leave unset fall back to Orc's stock geometry.

| Token | What it does |
|---|---|
| `--sidebar-border-width` | Border width on the right edge of the runs sidebar |
| `--sidebar-border-color` | Border colour on the right edge of the runs sidebar |
| `--sidebar-bg` | Background of the runs sidebar. On a phone Orc uses the sidebar's ::before and ::after for a solid --bg floor, so a see-through background shows that colour, not the page |
| `--sidebar-shadow` | Shadow cast by the runs sidebar |
| `--run-row-padding` | Padding inside a row in the run list |
| `--run-row-inset` | Gap between a row and each side of the run list (8px by default); the list's scrollbar sits inside the right one |
| `--run-row-gap` | Gap below a row in the run list (1px by default) |
| `--run-row-border-width` | Border width of a row in the run list |
| `--run-row-border-color` | Border colour of a row in the run list |
| `--run-row-radius` | Corner radius of a row in the run list |
| `--run-row-bg` | Resting background of a row in the run list |
| `--run-row-shadow` | Shadow on a row in the run list |
| `--run-row-hover-bg` | Hover background of a row in the run list |
| `--run-row-active-bg` | Background of the selected row in the run list |
| `--run-row-active-border-color` | Border colour of the selected row in the run list |
| `--tab-bar-bg` | Background of the run tab bar |
| `--tab-bar-border-color` | Bottom border colour of the run tab bar |
| `--tab-border-width` | Border width of a run tab button |
| `--tab-radius` | Corner radius of run tabs and the active tab indicator |
| `--tab-bg` | Resting background of a run tab button |
| `--tab-active-bg` | Background of the selected run tab button |
| `--tab-font` | Font shorthand for run tab labels |
| `--tab-indicator-height` | Height of the sliding active tab indicator |
| `--tab-indicator-color` | Fill of the sliding active tab indicator |
| `--composer-border-width` | Border width of the prompt composer |
| `--composer-border-color` | Border colour of the prompt composer |
| `--composer-radius` | Corner radius of the prompt composer |
| `--composer-bg` | Background of the prompt composer |
| `--composer-shadow` | Resting shadow on the prompt composer |
| `--chat-bubble-padding` | Padding inside a chat bubble |
| `--chat-bubble-border-width` | Border width of a chat bubble |
| `--chat-bubble-border-color` | Border colour of a chat bubble |
| `--chat-bubble-radius` | Corner radius of a chat bubble |
| `--chat-bubble-bg` | Background of a chat bubble |
| `--chat-bubble-shadow` | Shadow on a chat bubble |
| `--chat-bubble-user-bg` | Background of a chat bubble you sent |
| `--chat-pane` | Width of the chat sheet that holds the transcript and its composer, set on .chat (default 100cqw, the full pane) |
| `--card-border-width` | Border width of settings and invitation cards |
| `--card-border-color` | Border colour of settings and invitation cards |
| `--card-radius` | Corner radius of settings and invitation cards |
| `--card-bg` | Background of settings and invitation cards |
| `--card-shadow` | Shadow on settings and invitation cards |
| `--dialog-border-width` | Border width of <orc-dialog> modals and command palette |
| `--dialog-border-color` | Border colour of <orc-dialog> modals and command palette |
| `--dialog-radius` | Corner radius of <orc-dialog> modals and command palette |
| `--dialog-bg` | Background of <orc-dialog> modals and command palette |
| `--dialog-shadow` | Shadow on <orc-dialog> modals and command palette |

### Answer mode

The full-screen question card.

| Token | What it does |
|---|---|
| `--answer-mode-done` | Marker for an answered question (a string, such as an emoji) |
| `--answer-mode-now` | Marker for the question you are on |
| `--answer-mode-next` | Marker for a question still to come |
| `--answer-mode-glow` | Glow colour behind the question card |
| `--answer-mode-on-accent` | Text on the accent in answer mode |
| `--answer-mode-trim` | A background-image trim along the top of the card |
| `--answer-mode-trim-height` | Height of that trim |
| `--answer-mode-radius` | Corner radius of the question card |
| `--answer-mode-heading-font` | Typeface of the question heading |

### New-run screen

Swamp's fireflies and mist on the new-run screen.

| Token | What it does |
|---|---|
| `--nc-firefly-gold` | Gold firefly colour on the new-run screen |
| `--nc-firefly-lime` | Lime firefly colour |
| `--nc-firefly-size` | Firefly size multiplier |
| `--nc-firefly-alpha` | Firefly opacity |
| `--nc-firefly-halo-gold` | filter() glow for gold fireflies |
| `--nc-firefly-halo-lime` | filter() glow for lime fireflies |
| `--nc-mist-moss` | Low mist colour |
| `--nc-mist-haze` | High mist colour |
| `--nc-mist-alpha-low` | Low mist opacity |
| `--nc-mist-alpha-high` | High mist opacity |

### Sticky notes

What a sticky note on project home is made of. Set these in a rule on `.nc-note`, where `--note-tint` holds the colour the note was handed. Any you leave unset give Orc's stock paper.

| Token | What it does |
|---|---|
| `--note-paper` | The note's face, as a background; the stock paper is --note-tint mixed into --note-surface |
| `--note-surface` | What the stock paper mixes the project colour into (--panel by default) |
| `--note-tint-share` | How much of the project colour the stock paper takes, as a percentage |
| `--note-ink` | The note's writing (--heading by default); keep it 4.5:1 on --note-paper |
| `--note-edge` | Colour of the note's outline |
| `--note-edge-width` | Width of the note's outline (1px by default) |
| `--note-trim` | Extra box-shadows on the note's face, such as a bevel or an inner glow |
| `--note-radius` | The note's corner radius |
| `--note-shadow` | A filter on the note at rest: its drop shadow or glow (none by default) |
| `--note-shadow-raised` | That filter while the note is hovered, edited or dragged (--float-shadow by default) |
| `--note-font` | The note's typeface |
| `--note-rule` | Colour of the ruled lines under the writing; transparent removes them |
| `--note-lean` | How far a note leans, from 0 (square on the board) to 1 (the stock tilt) |
| `--note-fold` | Size of the folded corner that resizes the note (22px by default); 0px flattens it to a grip |
| `--note-tape` | Background of the tape that holds the note up; none removes it. Restyle .nc-note-tape for a pin |

### Set by Orc

Orc sets these; read them, do not set them.

| Token | What it does |
|---|---|
| `--orc-view-x` | Set by Orc during a screen change: where it started, horizontally |
| `--orc-view-y` | Set by Orc during a screen change: where it started, vertically |
| `--orc-view-r` | Set by Orc during a screen change: distance to the farthest corner |
| `--note-tint` | Set by Orc on each .nc-note: the colour of its project, one of --yellow, --green, --cyan, --orange and --purple |

## Hooks

Parts of the page a theme may style beyond tokens. Scope every rule under
`:root[data-<id>]`, so it applies only while your theme is on.

### Named parts

Stable `data-part` hooks on the main regions of the shell. Prefer these over ids and classes when styling layout chrome.

| Selector | What it is |
|---|---|
| `[data-part="sidebar"]` | The runs sidebar (<aside#run-sidebar>) |
| `[data-part="sidebar-head"]` | The top of the sidebar around the wordmark and controls |
| `[data-part="sidebar-search"]` | The search, filter, and new-conversation bar in the sidebar |
| `[data-part="run-list"]` | The scrollable run list container |
| `[data-part="run-group"]` | A grouped section of runs in the sidebar |
| `[data-part="run-row"]` | A row in the run list; carries [data-state] |
| `[data-part="run-actions"]` | The hover action cluster on a run row |
| `[data-part="run-project"]` | The project line above a run's title |
| `[data-part="run-title"]` | A run's title inside its row |
| `[data-part="run-meta"]` | The state, badge, age, and agent line under a run's title |
| `[data-part="status-lamp"]` | A live status dot or working lamp; carries [data-state] |
| `[data-part="state-tag"]` | A run's state pill; carries [data-state] |
| `[data-part="settled-shelf"]` | The Settled heading at the foot of the run list |
| `[data-part="settled-drawer"]` | The open Settled drawer over the run list |
| `[data-part="sidebar-footer"]` | The navigation bar at the foot of the sidebar |
| `[data-part="empty-state"]` | The empty state when no run or artifact is open |
| `[data-part="run-head"]` | The open run's header above the tab bar |
| `[data-part="tab-bar"]` | The bar holding run tabs and timestamps |
| `[data-part="tab-list"]` | The strip of tab buttons inside the tab bar |
| `[data-part="tab"]` | An individual tab button inside [data-part="tab-list"] |
| `[data-part="tab-indicator"]` | The sliding active indicator behind the selected tab |
| `[data-part="answer-card"]` | The inline invitation card when questions are waiting |
| `[data-part="terminal-stage"]` | The run terminal stage |
| `[data-part="new-run"]` | The new-conversation screen |
| `[data-part="composer"]` | The prompt composer box on new-run and chat screens |
| `[data-part="chat"]` | The chat column for a run |
| `[data-part="transcript-message"]` | A user or assistant message row in the chat transcript |
| `[data-part="chat-bubble"]` | A message bubble inside a user transcript row |
| `[data-part="factory-stage"]` | The 3D stage area inside the Factory tab |
| `[data-part="factory-roster"]` | The agent roster beside the Factory stage |
| `[data-part="side-panel"]` | The side panel beside a run (diff, files, browser) |
| `[data-part="command-palette"]` | The ⌘K command palette dialog |

### Shadow parts

Shadow-DOM `part` names exposed on `<orc-*>` design-system and composer controls, styled with `::part(...)`.

| Part | What it is |
|---|---|
| `::part(body)` | Main content region inside <orc-dialog> |
| `::part(box)` | Checkbox square inside <orc-checkbox> |
| `::part(button)` | Interactive button inside <orc-button>, <orc-icon-button>, and composer toggles |
| `::part(callout)` | Surface box inside <orc-callout> |
| `::part(chevron)` | Disclosure arrow inside <orc-select> and <orc-accordion> |
| `::part(chip)` | Pill surface inside <orc-chip> |
| `::part(close)` | Close button inside <orc-dialog> and <orc-model-picker> |
| `::part(control)` | Outer control wrapper in <orc-checkbox>, <orc-combobox>, <orc-select>, <orc-switch>, <orc-effort-slider>, and <orc-model-picker> |
| `::part(dialog)` | Modal <dialog> surface inside <orc-dialog> |
| `::part(dot)` | Status dot inside <orc-chip> and <orc-select> |
| `::part(face)` | Interactive face inside <orc-effort-slider> |
| `::part(field)` | Field frame inside <orc-input>, <orc-textarea>, and <orc-select> |
| `::part(fill)` | Active range fill inside <orc-effort-slider> |
| `::part(footer)` | Footer bar inside <orc-dialog> |
| `::part(group)` | Radio group container inside <orc-segmented> |
| `::part(header)` | Header bar inside <orc-dialog> and <orc-model-picker> |
| `::part(heading)` | Heading inside <orc-callout>, <orc-dialog>, and <orc-effort-slider> |
| `::part(icon)` | SVG icon inside <orc-theme-toggle> and composer toggles |
| `::part(input)` | Native input or textarea inside form controls and toggles |
| `::part(label)` | Text label inside buttons, chips, fields, switches, and toggles |
| `::part(list)` | Option list inside <orc-select> and <orc-model-picker> |
| `::part(listbox)` | Popup listbox inside <orc-combobox> and <orc-select> |
| `::part(menu)` | Popup menu container inside <orc-select> |
| `::part(option)` | Selectable option inside <orc-combobox>, <orc-segmented>, <orc-select>, and <orc-model-picker> |
| `::part(output)` | Current value readout inside <orc-effort-slider> |
| `::part(panel)` | Popup or tab panel inside <orc-combobox>, <orc-select>, <orc-tabs>, and <orc-model-picker>; the folded content inside <orc-accordion> |
| `::part(panels)` | Tab panels wrapper inside <orc-tabs> |
| `::part(rail)` | Track or provider rail inside <orc-effort-slider> and <orc-model-picker> |
| `::part(search)` | Filter search box inside <orc-select> and <orc-model-picker> |
| `::part(step)` | Step item inside <orc-stepper> |
| `::part(summary)` | Button that opens and closes <orc-accordion> |
| `::part(tab)` | Tab button inside <orc-tabs> |
| `::part(tablist)` | Tab list strip inside <orc-tabs> |
| `::part(thumb)` | Sliding thumb inside <orc-switch> |
| `::part(track)` | Switch or slider track inside <orc-switch> and <orc-effort-slider> |
| `::part(trigger)` | Popup trigger button inside <orc-select> and <orc-model-picker> |
| `::part(value)` | Selected value text inside <orc-select> and <orc-model-picker> |

### Ids

| Selector | What it is |
|---|---|
| `#tabbar` | The bar of run tabs across the top |
| `#logo` | The Orc wordmark in the sidebar head |
| `#logo-icon` | The persona picture inside #logo |
| `#run-sidebar` | The runs sidebar |
| `#sidebar-head` | The top of the sidebar, around #logo |
| `#sidebar-close` | The button that closes the sidebar on narrow windows |
| `#sidebar-collapse` | The button that hides and shows the sidebar on wide windows |
| `#sidebar-status` | The status line under the run list |
| `#sidebar-usage` | Subscription usage rows in the sidebar |
| `#sidebar-footer` | The links at the foot of the sidebar |
| `#settled-shelf` | The Settled heading over finished runs |
| `#focus-indicator` | The Queue mode badge in the sidebar head |
| `#radio-now` | Radio's now-playing strip |
| `#merge-selection-bar` | The bar shown while runs are selected for merging |
| `#content` | The run page's main column |
| `#empty` | The empty state when no run is open |
| `#new-view` | The new-run screen |
| `#run-terminal` | The run terminal stage |
| `#run-terminal-bar` | The bar above the run terminal |
| `#run-terminal-title` | The run terminal's title |
| `#run-diff` | The side panel beside a run (diff, files, browser) |
| `#cmdk-layout` | The command palette body. Its `::before` is your banner across the top: Orc sets its height and centres its content so the palette is one size in every theme, so leave `display` and the height alone. With no banner, the theme picker shows your theme's name there |
| `#cmdk-footer` | The command palette footer |
| `#orc-copy` | Copy button on gate and answer pages |
| `#copy-answers` | Copy answers button on question pages |
| `#gary` | The assistant's corner button |
| `#head` | The run page's head: title, links and state note |
| `#links` | The links row in the run head |
| `#list` | The run list in the sidebar |
| `#tabs` | The run tabs inside #tabbar |
| `#run-times` | The run's start and activity times inside #tabbar |
| `#run-panel-tabs` | The tabs of the side panel beside a run |
| `#settled-head` | The button heading the Settled shelf |
| `#search-wrap` | The search row under the sidebar head: the search field, the filter menu and New |
| `#chat-send` | The chat composer's Send button |
| `#nc-send` | The new-run screen's Start button, inside its composer; it carries [disabled] until there is something to send and [hidden] when Copy prompt takes its place |
| `#chat-stop` | The chat composer's Stop button |

### Classes

| Selector | What it is |
|---|---|
| `.newconv-prompt` | The composer box (new run and chat); carries [data-typing-hot] while you type |
| `.newconv` | The new-run screen's column: the start bar and the cards under it |
| `.nc-startbar` | The new-run screen's start bar: .nc-title, the composer and .nc-tray |
| `.nc-scroll` | The new-run screen's scrolling column inside #new-view: .newconv, the row holding .nc-handout, then .nc-notes |
| `.nc-title` | The new-run screen's heading |
| `.nc-tray` | The new-run screen's option tray |
| `.nc-beam` | The beam of light that runs round a composer's rim, drawn from --green and --yellow |
| `.nc-notes` | The sticky notes board on project home, between the start bar and the foot of the screen |
| `.nc-note` | A sticky note on project home; set the --note-… tokens on it |
| `.nc-note-paper` | A note's face, inside .nc-note |
| `.nc-note-tape` | What holds a note up: tape by default, a pin or a clip if you redraw it |
| `.nc-note-curl` | A note's bottom right corner, which resizes it; keep it reachable |
| `.nc-note-head` | The row along a note's top: its key and state |
| `.nc-note-key` | A note's ticket key |
| `.nc-note-state` | The In progress mark on a note |
| `.nc-note-title` | A note's first line |
| `.nc-note-text` | The rest of a note's writing |
| `.nc-handout` | The New sticky note button that hands notes out |
| `.nc-project-switch` | The project switch on the new-run screen |
| `.run` | A row in the run list |
| `.active` | The open row in the run list, with .run |
| `.is-busy` | A control while its action is in flight |
| `.done` | A copy button after it copied |
| `.primary` | The primary button in a group, with .am-btn |
| `.terminal-staged` | #run-terminal while it is maximised onto its stage |
| `.chat` | The chat column |
| `.chat-row-user` | A message row you sent |
| `.chat-bubble` | A chat message bubble |
| `.is-queued` | A sent message still waiting for the agent |
| `.is-shell` | A shell command bubble |
| `.link-switch` | The link toggle in the sidebar head |
| `.logo-slash` | The slash inside #logo |
| `.gary` | The assistant's corner button (also #gary) |
| `.am-card` | Answer mode's question card |
| `.am-q` | A question's text in answer mode |
| `.am-btn` | An answer-mode button |
| `.am-glyph` | The step marker beside a question |
| `.am-trail` | The row of question markers |
| `.factory-main` | The Factory tab's stage |
| `.factory-summary` | The Factory tab's summary line |
| `.factory-agent` | An agent row beside the Factory floor |
| `.factory-label` | A station's floating label |
| `.factory-label-name` | The name in a station label |
| `.factory-label-meta` | The detail line in a station label |
| `.factory-label-effort` | The effort level beside the name in a station label |
| `.is-hot` | A station label for the agent working right now |
| `.name` | A run's title in the run list, with .run |
| `.run-project` | A run's project line in the run list |
| `.run-age` | How long ago a run in the list last moved |
| `.session-status` | A run's session lamp in the list; .running while its agent works |
| `.running` | A session status while its agent works |
| `.fork-child` | A run listed under the run it forked from |
| `.fork-last` | The last fork under its parent |
| `.state-tag` | A run's state label in the list |
| `.state-want` | The action or detail following a run's state label |
| `.unread-tag` | The label on a run that stopped and has not been opened since |
| `.stale-tag` | The label on a run gone quiet |
| `.focus-tag` | The label on the active run in Queue mode |
| `.pushed-tag` | The label on a run whose branch is pushed |
| `.live-tag` | The label on a run with a live preview |
| `.evals-candidate-tag` | An evals candidate's model, which titles its row under the parent |
| `.state-started` | State class: started |
| `.state-waiting` | State class: waiting on another run |
| `.state-working` | State class: working |
| `.state-reviewing` | State class: reviewing |
| `.state-blocked` | State class: blocked, waiting on you |
| `.state-ready` | State class: ready to ship |
| `.state-done` | State class: done |
| `.state-cancelled` | State class: cancelled |
| `.settled-heading` | The Settled heading in the run list |
| `.settled-drawer` | The Settled shelf when it opens as a drawer |
| `.logo-word` | The word inside #logo |
| `.tab-indicator` | The sliding marker under the selected run tab |
| `.dot` | The live status dot |
| `.chat-body` | The chat's message column |
| `.chat-reviews` | Review cards under the chat |
| `.chat-composer` | The chat's composer area |
| `.chat-composer-info` | The line under the chat composer |
| `.chat-md` | Rendered Markdown in a chat message |
| `.chat-time` | A message's time |
| `.chat-fold` | A folded group of agent steps |
| `.chat-working` | The working line while the agent runs |
| `.chat-steps-toggle` | The button that shows or hides agent steps |
| `.chat-files-title` | The changed-files card title |
| `.am-invite` | The invitation to answer questions in answer mode |
| `.factory-roster` | The agent list beside the Factory floor |
| `.factory-recenter` | The Reset view button in the Factory floor corner |
| `.factory-zoom` | The zoom button group in the Factory floor corner |
| `.factory-roster-toggle` | The Show/Hide agents button in the Factory floor corner |
| `.factory-ticket` | The picked agent's job ticket laid over the Factory floor |
| `.factory-ticket-name` | The heading inside the Factory job ticket |
| `.factory-ticket-facts` | The row of facts inside the Factory job ticket |
| `.is-main` | The main agent's floating label on the Factory floor |
| `.is-selected` | A selected station label or roster row in the Factory tab |

### Attributes

| Attribute | What it means |
|---|---|
| `[data-theme]` | On <html>: "dark" or "light" when the person picks one, absent on Auto. Give night in both :root[data-<id>][data-theme="dark"] and :root[data-<id>]:not([data-theme="light"]) inside @media (prefers-color-scheme: dark) |
| `[data-view-transition]` | On <html> while a screen change plays: the destination (settings, activity, run, terminal and so on) |
| `[data-typing-hot]` | On .newconv-prompt while you type quickly |
| `[data-suppress-focus-ring]` | On .newconv-prompt when its focus ring is hidden for a pointer click |
| `[data-part]` | Names a promised part of the shell; see Named parts below |
| `[data-state]` | On run rows, status lamps, state tags, factory stage, and answer-mode markers |
| `[data-unread]` | On a run row that stopped and has not been opened since |
| `[data-sidebar-collapsed]` | On <html> while the sidebar is collapsed to its 44px strip on a wide window |
| `[data-orc-shot]` | On <html> while Orc's own screenshots are taken; hold animations still |
| `[data-tint]` | On a project-home sticky note: its paper tint (yellow, green, cyan, orange or purple) |
| `[data-evals]` | On #new-view while the composer builds an eval: the Evals candidates take the board's place |
| `[data-retired]` | On a decommissioned station's floating label in the Factory tab |

### Shared names

| Prefix | What it is for |
|---|---|

## Replaceable components

A theme may set `"components": "components.js"` under `contributes.theme` in `orc-plugin.json`
to replace the presentation of up to five shell slots while Orc keeps ownership of state, focus,
selection, keyboard navigation and accessibility. Only the currently painted theme's renderers
run, previewing another theme swaps and reverts mounted slots live, and any slot that returns
`null` or throws falls back to Orc's stock markup.

| Slot | Input data | Responsibility |
|---|---|---|
| `runRow(data)` | `{ id, title, state, stateLabel, active, settled, project, questions, attention, unread, stale, agent, href }` | Custom inner content for a sidebar run row while Orc keeps `.run-actions` and `.run-link` navigation |
| `statusLamp(data)` | `{ state, running, pulse, color, label }` | Custom SVG or DOM indicator for live run dots and working lamps |
| `tabBar(data)` | `{ tabs: [{ key, label, active }], activeKey }` | Custom tab strip; must include one `<button data-key="...">` per tab or Orc falls back to stock tabs |
| `sidebarHead(data)` | `{ themeId, runCount, lowPower }` | Optional telemetry or banner strip inside `#sidebar-head` |
| `emptyState(data)` | `{ themeId, kind, message, hasDiff, runId }` | Custom empty-state presentation when no run or artifact is open |

## Scene kit

ES modules served at /theme-kit/2/. A scene or factory module imports them by URL and needs no build step. For example:

```js
import { Mesh, MeshStandardMaterial, SphereGeometry } from '/theme-kit/2/three.js';
import { createStage, smooth } from '/theme-kit/2/stage.js';
```

README.md describes what a scene module exports and what a Factory skin receives.

| Module | What it is | Promised exports |
|---|---|---|
| `/theme-kit/2/three.js` | three.js r186, every export | all of three.js |
| `/theme-kit/2/stage.js` | The scene stage and easing helpers every scene uses | `back`, `clamp`, `createStage`, `fall`, `keys`, `mix`, `out`, `pulse`, `range`, `smooth`, `wearSkin`, `whip`, `wobble` |
| `/theme-kit/2/party.js` | The All settled fireworks | `CLEAR_LANDS`, `createFireworks`, `finale` |
| `/theme-kit/2/factory.js` | The Factory engine; a skin is the second argument | `createFactory`, `stock` |
| `/theme-kit/2/factory-layout.js` | Where Factory stations stand, and the camera a painted floor is seen through | `CAPACITY`, `DOOR`, `HALL`, `createLayout`, `paintedCamera` |
| `/theme-kit/2/swamp.js` | Swamp's scene module, to build on | `default` |

## Page modules

Orc's own page modules a theme's frontend or terminal module may import by URL. Only these exports are promised.

| Module | What it is | Promised exports |
|---|---|---|
| `/js/fun-modes.js` | Theme painting and pointer effects | `defineFunMode`, `funModeSaved`, `leaveOtherFunModes`, `paintedFunMode`, `registerFunMode`, `whileFunPress` |
| `/js/motion.js` | Motion preferences | `animationsOff`, `reducedMotion` |
| `/js/core.js` | Announcements and artifact frames | `announce`, `syncOpenArtifactThemes` |
| `/js/theme-components.js` | Safe DOM builder and replaceable component registry | `el`, `registerThemeComponents`, `themeComponent`, `unregisterThemeComponents` |
| `/js/activity.js` | Sound preference and quiet hours | `soundsAreEnabled` |
| `/js/sound.js` | Shared audio context and playback volume | `soundContext`, `soundVolume` |
