"""Orchestrate's rules: which agent and model does each job when a run
delegates, and how hard it may think.

One ~/.orc/config.json key holds them. It stays on this computer: Settings
sync leaves it out, so each computer keeps its own routes and presets.

  "orchestrate": {"routes": {"<job>": {"provider": "<agent>", "model": "<id>",
                                         "effort": ["<lowest>", "<highest>"],
                                         "fast": true}}}

A user who keeps more than one set of routes saves them as named presets, and
each launch picks one. The first preset is the one a launch gets when it
names none:

  "orchestrate": {"presets": {"<id>": {"name": "<name>", "order": 0, "routes": {...},
                                       "icon": {"agent": "<agent>"} | {"image": "<data URL>"}}}}

They are keyed by id, with their place in `order`. Everywhere else a preset is
`{"id", "name", "routes", "icon"?}` in a list. A single preset that was never
named stays in the `routes` shape above. Orc saved presets under `profiles`
before they were renamed; that key is still read when `presets` is absent.
`icon` is optional: an agent's logo, or a small PNG, JPEG or WebP image.

`lead` is the run's own agent, which plans and integrates. The other jobs are
the task roles a coordinator delegates. A job with no route stays the
coordinator's call. `provider` is an agent core launches (`claude`, `codex`)
or a harness package's id, and `model` is that agent's own id for it. `fast` is
saved only when on: true requests Fast and "ultrafast" requests Ultrafast
for Codex Sol 6.2. The computer must offer the speed control. A preset's
lead route is the model a launch on that preset runs on: picking a preset with
at least one routed task role in the model picker turns Orchestrate on with it,
picking a preset with only a lead launches on that lead without Orchestrate, and
picking any other model launches without Orchestrate. Routes saved before that
may still carry an `override` flag, which is dropped on read.

stdlib-only: core imports this file from the server and from orc-routes.
"""
import re

CONFIG_KEY = "orchestrate"
LEAD = "lead"
TASK_ROLES = ("implementation", "research", "review", "design", "test", "general")
JOBS = (LEAD, *TASK_ROLES)
EFFORTS = ("low", "medium", "high", "xhigh", "max", "ultra")
PROVIDER = re.compile(r"[a-z][a-z0-9-]{0,31}")
MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,127}")
PRESET_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
DEFAULT_PRESET = {"id": "default", "name": "Default"}
MAX_PRESETS = 9
MAX_NAME = 40
# The key presets were saved under before they were renamed.
OLD_PRESETS_KEY = "profiles"
# An uploaded icon: a raster data URL of at most MAX_ICON characters. No SVG,
# which can carry script.
ICON_IMAGE = re.compile(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}")
MAX_ICON = 64 * 1024


def valid_fast(provider, model, fast):
    return isinstance(fast, bool) or (fast == "ultrafast" and provider == "codex" and model == "gpt-6.2-sol")


def route(value):
    """A usable route from value, else None. `effort` is optional: one level,
    or a pair that comes back lowest first. An effort that is not a known
    level is dropped and the route kept. Speed is kept when enabled and
    valid."""
    if not isinstance(value, dict):
        return None
    provider, model = value.get("provider"), value.get("model")
    if not isinstance(provider, str) or not PROVIDER.fullmatch(provider):
        return None
    if not isinstance(model, str) or not MODEL.fullmatch(model):
        return None
    found = {"provider": provider, "model": model}
    effort = value.get("effort")
    if isinstance(effort, str):
        effort = [effort, effort]
    if isinstance(effort, (list, tuple)) and len(effort) == 2 and all(
            isinstance(level, str) and level in EFFORTS for level in effort):
        found["effort"] = sorted(effort, key=EFFORTS.index)
    fast = value.get("fast", False)
    if fast and valid_fast(provider, model, fast):
        found["fast"] = fast
    return found


def _routes(value):
    value = value if isinstance(value, dict) else {}
    return {job: route(value[job]) for job in JOBS if route(value.get(job))}


def icon(value):
    """A usable preset icon from value, else None: {"agent": <provider>} or
    {"image": <PNG, JPEG or WebP data URL of at most MAX_ICON characters>}."""
    if not isinstance(value, dict) or len(value) != 1:
        return None
    agent, image = value.get("agent"), value.get("image")
    if isinstance(agent, str) and PROVIDER.fullmatch(agent):
        return {"agent": agent}
    if isinstance(image, str) and len(image) <= MAX_ICON and ICON_IMAGE.fullmatch(image):
        return {"image": image}
    return None


def preset(value):
    """A usable preset from value, else None: an id, a name of up to
    MAX_NAME characters, the usable part of its routes, and its icon when
    usable. An unusable icon is dropped and the preset kept."""
    if not isinstance(value, dict):
        return None
    found, name = value.get("id"), value.get("name")
    if not isinstance(found, str) or not PRESET_ID.fullmatch(found):
        return None
    name = " ".join(name.split())[:MAX_NAME].strip() if isinstance(name, str) else ""
    if not name:
        return None
    entry = {"id": found, "name": name, "routes": _routes(value.get("routes"))}
    mark = icon(value.get("icon"))
    if mark:
        entry["icon"] = mark
    return entry


def _presets(value):
    """The usable presets in a rules value, in order, each id once: saved
    by id, or already a list. A value in the older `routes` shape is the one
    default preset."""
    listed = None
    if isinstance(value, dict):
        listed = value.get("presets")
        if listed is None:
            listed = value.get(OLD_PRESETS_KEY)
    if isinstance(listed, dict):
        keyed = [(item.get("order"), key, item) for key, item in listed.items() if isinstance(item, dict)]
        keyed.sort(key=lambda entry: (not isinstance(entry[0], int), entry[0] if isinstance(entry[0], int) else 0, entry[1]))
        listed = [{**item, "id": key} for _, key, item in keyed]
    found = []
    for entry in listed if isinstance(listed, list) else []:
        entry = preset(entry)
        if entry and all(entry["id"] != other["id"] for other in found) and len(found) < MAX_PRESETS:
            found.append(entry)
    if found:
        return found
    return [{**DEFAULT_PRESET, "routes": _routes(value.get("routes") if isinstance(value, dict) else None)}]


def clean(value):
    """The valid part of a saved rules value: its presets, and under `routes`
    the first preset's routes, which a launch that names no preset gets.
    Anything else is dropped."""
    presets = _presets(value)
    return {"routes": presets[0]["routes"], "presets": presets}


def select(rules, preset_id=None):
    """The rules one run works under: the routes of the preset it launched
    with, or of the first preset when that one is gone or was never named."""
    presets = rules.get("presets") or _presets(rules)
    found = next((entry for entry in presets if entry["id"] == preset_id), presets[0])
    return {"routes": found["routes"], "preset": {"id": found["id"], "name": found["name"]}}


def find(rules, wanted):
    """The preset wanted names: by id, by its 1-based place, or by its name
    whatever the case. None when nothing matches."""
    presets = rules["presets"]
    wanted = str(wanted).strip()
    for entry in presets:
        if entry["id"] == wanted:
            return entry
    if wanted.isdigit() and 0 < int(wanted) <= len(presets):
        return presets[int(wanted) - 1]
    return next((entry for entry in presets if entry["name"].lower() == wanted.lower()), None)


def read(config):
    """The saved rules in config, or no routes when none are saved."""
    config = config if isinstance(config, dict) else {}
    return clean(config.get(CONFIG_KEY))


def with_presets(config, presets):
    """config with the rules key holding exactly the usable presets, under
    `presets`. One preset still called the default, with no icon, keeps the
    older `routes` shape."""
    found = _presets({"presets": presets})
    only = found[0]
    if len(found) == 1 and only == {**DEFAULT_PRESET, "routes": only["routes"]}:
        return {**config, CONFIG_KEY: {"routes": only["routes"]}}
    return {**config, CONFIG_KEY: {"presets": {
        entry["id"]: {"name": entry["name"], "order": order, "routes": entry["routes"],
                      **({"icon": entry["icon"]} if "icon" in entry else {})}
        for order, entry in enumerate(found)}}}


def with_routes(config, routes, preset_id=None):
    """config with one preset's routes replaced by the usable part of routes:
    the preset with preset_id, else the first. The other presets are kept."""
    presets = read(config)["presets"]
    target = select({"presets": presets}, preset_id)["preset"]["id"]
    return with_presets(config, [{**entry, "routes": routes} if entry["id"] == target else entry
                                 for entry in presets])


def with_route(config, job, value, preset_id=None):
    """config with job's route set to value, or removed when value is None, in
    the preset with preset_id, else the first."""
    if job not in JOBS:
        raise ValueError("job must be one of " + ", ".join(JOBS))
    routes = dict(select(read(config), preset_id)["routes"])
    if value is None:
        routes.pop(job, None)
    else:
        found = route(value)
        if found is None:
            raise ValueError("a route needs a provider such as claude and one of its model ids")
        if "effort" in value and "effort" not in found:
            raise ValueError("effort must be one of " + ", ".join(EFFORTS))
        if "fast" in value and not valid_fast(found["provider"], found["model"], value["fast"]):
            raise ValueError("fast must be true or false, or ultrafast for Codex Sol 6.2")
        routes[job] = found
    return with_routes(config, routes, preset_id)


def effort_words(found):
    """A route's effort range in words, or '' when it has none."""
    effort = found.get("effort")
    if not effort:
        return ""
    return effort[0] if effort[0] == effort[1] else "%s to %s" % tuple(effort)


def lines(rules):
    """One line per routed job, the lead first: `test: claude-haiku-5-5 on
    claude, effort low`, with a speed tier when configured."""
    out = []
    for job in JOBS:
        found = rules["routes"].get(job)
        if found:
            words = effort_words(found)
            speed = {True: ", fast mode", "ultrafast": ", ultrafast mode"}.get(found.get("fast"), "")
            out.append("%s: %s on %s%s%s" % (job, found["model"], found["provider"],
                                           ", effort " + words if words else "", speed))
    return out


def has_task_routes(rules):
    """Whether rules routes at least one delegated task role beyond lead."""
    routes = (rules or {}).get("routes") or {}
    return any(role in routes for role in TASK_ROLES)


def policy(rules):
    """What a coordinator is told about who does its delegated work, or None
    when no task role is routed and core's own wording stands."""
    routed = [line for line in lines(rules) if not line.startswith(LEAD + ":")]
    if not routed:
        return None
    unrouted = [role for role in TASK_ROLES if role not in rules["routes"]]
    text = ("Start with one or two tasks. Keep implementation inline unless the plan has separate "
            "pieces with no shared files. For a trivial single operation, do it directly. "
            "The chosen parent agent, model and account remain the coordinator. "
            "The user's Orchestrate rules route these roles: " + "; ".join(routed) + ". "
            "A task with one of those roles runs on its route's agent and model whatever target "
            "you pass, at an effort held inside the route's range and at the speed the "
            "route specifies, so pass only options.effort for it. A route on another agent draws on that agent's usage limit, not yours. "
            "The role you give a task therefore decides which model does it, so choose the role "
            "that names the task's work. ")
    if unrouted:
        text += ("The other roles (" + ", ".join(unrouted) + ") run on the coordinator's own agent "
                 "and account and share its usage limit: choose their model from "
                 "orchestrator_capabilities, a cheaper one at low effort for mechanical work; "
                 "another provider is refused for them. ")
    return text + ("orchestrator_capabilities lists the routes as they stand, and names any that "
                   "cannot run on this computer.")
