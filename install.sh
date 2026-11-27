#!/usr/bin/env bash
# ./install.sh --uninstall reverses everything except personal data (~/.orc).
# ./install.sh --skip-health-checks skips integration probes and setup guidance.
set -euo pipefail

ORC_DISTRIBUTION_SOURCE=https://github.com/orc-tools/orc.git
ORC_DISTRIBUTION_SIGNERS='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINlJtGDuE8eSHjekDXLojffkaBXjUncrP4HCTiCDK/3P'

# A test fixture's Git hook once installed the fixture over the user's own
# copy. bin/test exports ORC_TEST_REAL_HOME, so a test installs into its own HOME.
if [ -n "${ORC_TEST_REAL_HOME:-}" ] && [ "$(cd "$HOME" && pwd -P)" = "$(cd "$ORC_TEST_REAL_HOME" && pwd -P)" ]; then
  echo "install.sh: refusing to run under the test suite with the real HOME ($HOME); give the test its own HOME" >&2
  exit 64
fi

# `curl … | bash` runs this from stdin, and a downloaded install.sh runs from a
# file, both with no checkout around them. Clone (or fast-forward) Orc into
# ORC_SRC and run that copy's installer instead. One compound command, so a
# truncated download never runs half of it. A public export clones its own
# source on the stable channel, the same checkout Orc Installer leaves;
# ORC_CHANNEL=main follows every release instead.
if [ ! -f "${BASH_SOURCE[0]:-}" ] || [ ! -f "$(dirname "${BASH_SOURCE[0]}")/bin/orc-ui" ]; then
  command -v git >/dev/null 2>&1 || {
    echo "ERROR: installing Orc needs git; install it (xcode-select --install) and rerun" >&2
    exit 1
  }
  ORC_SRC="${ORC_SRC:-$HOME/.orc/src}"
  ORC_REPO_URL="${ORC_REPO_URL:-$ORC_DISTRIBUTION_SOURCE}"
  : "${ORC_REPO_URL:?Set ORC_REPO_URL to the intended distribution source}"
  if [ -n "$ORC_DISTRIBUTION_SOURCE" ]; then
    ORC_CHANNEL="${ORC_CHANNEL:-stable}"
    [ "$ORC_REPO_URL" = "$ORC_DISTRIBUTION_SOURCE" ] \
      && [ "$(git ls-remote --get-url "$ORC_REPO_URL")" = "$ORC_DISTRIBUTION_SOURCE" ] || {
      echo "ERROR: bootstrap source differs from the approved public source" >&2; exit 1;
    }
    [ -n "$ORC_DISTRIBUTION_SIGNERS" ] || {
      echo "ERROR: bootstrap installer has no pinned release signing keys" >&2; exit 1;
    }
    command -v ssh-keygen >/dev/null 2>&1 || {
      echo "ERROR: verifying Orc releases needs ssh-keygen; install OpenSSH and rerun" >&2; exit 1;
    }
  fi
  verify_bootstrap_commit() {
    local repo="$1" commit signers_file rc=1 key_line
    commit="$(git --no-replace-objects -C "$repo" rev-parse --verify "$2^{commit}" 2>/dev/null)" || return 1
    if ! git --no-replace-objects -C "$repo" cat-file commit "$commit" 2>/dev/null | LC_ALL=C awk '
      in_body { next }
      /^$/ { in_body = 1; next }
      /^gpgsig(-sha256)?( |$)/ { count++; signature = $0; in_signature = 1; next }
      /^ / { if (in_signature) signature = signature "\n" $0; next }
      { in_signature = 0 }
      END {
        if (!in_body || count != 1 || signature !~ /^gpgsig(-sha256)? -----BEGIN SSH SIGNATURE-----\n( [A-Za-z0-9+\/=]+\n)+ -----END SSH SIGNATURE-----$/) exit 1
      }
    '; then
      return 1
    fi
    signers_file="$(mktemp "${TMPDIR:-/tmp}/orc-signers-XXXXXXXX")"
    chmod 600 "$signers_file"
    while IFS= read -r key_line; do
      [ -z "$key_line" ] || printf 'noreply@orc.invalid namespaces="git" %s\n' "$key_line" >> "$signers_file"
    done <<EOF
$ORC_DISTRIBUTION_SIGNERS
EOF
    if GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1 \
      git --no-replace-objects -C "$repo" \
        -c gpg.format=ssh \
        -c "gpg.ssh.allowedSignersFile=$signers_file" \
        -c "gpg.ssh.program=$(command -v ssh-keygen)" \
        -c gpg.ssh.revocationFile= \
        verify-commit "$commit" >/dev/null 2>&1; then
      rc=0
    fi
    rm -f "$signers_file"
    return "$rc"
  }
  if [ -d "$ORC_SRC/.git" ]; then
    [ "$(git -C "$ORC_SRC" remote get-url --all origin)" = "$ORC_REPO_URL" ] || {
      echo "ERROR: existing checkout has a different source" >&2; exit 1;
    }
    if [ -n "$ORC_DISTRIBUTION_SOURCE" ]; then
      git -C "$ORC_SRC" -c core.hooksPath=/dev/null fetch --quiet origin
      verify_bootstrap_commit "$ORC_SRC" FETCH_HEAD || {
        echo "ERROR: refused unsigned or untrusted Orc release" >&2; exit 1;
      }
      git -C "$ORC_SRC" -c core.hooksPath=/dev/null merge --ff-only --quiet FETCH_HEAD
    else
      git -C "$ORC_SRC" pull --ff-only --quiet origin
    fi
  else
    mkdir -p "$(dirname "$ORC_SRC")"
    git -c core.hooksPath=/dev/null clone --quiet ${ORC_CHANNEL:+--branch "$ORC_CHANNEL"} "$ORC_REPO_URL" "$ORC_SRC"
    if [ -n "$ORC_DISTRIBUTION_SOURCE" ]; then
      verify_bootstrap_commit "$ORC_SRC" HEAD || {
        rm -rf "$ORC_SRC"
        echo "ERROR: refused unsigned or untrusted Orc release" >&2; exit 1;
      }
    fi
    if [ -n "${ORC_CHANNEL:-}" ]; then git -C "$ORC_SRC" config orc.runtimeRef "refs/heads/$ORC_CHANNEL"; fi
  fi
  # Drain the rest of a piped script so curl finishes cleanly instead of
  # failing to write once the real installer has taken over.
  [ -f "${BASH_SOURCE[0]:-}" ] || [ -t 0 ] || cat >/dev/null
  exec bash "$ORC_SRC/install.sh" "$@"
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SKILLS_SRC="$REPO_DIR/skills"
ORC_HOME="$HOME/.orc"
RUNTIME_HOME="$ORC_HOME/runtime"
RELEASES_DIR="$RUNTIME_HOME/releases"
CURRENT_LINK="$RUNTIME_HOME/current"
LAUNCHER_PATH="$HOME/.local/bin/orc-ui"
DEFAULT_APP_LINK="$HOME/Applications/Orc.app"
APP_LINK="$DEFAULT_APP_LINK"
APP_LOCATION="$RUNTIME_HOME/app-location"
APP_DIR=""
STABLE_LAUNCHER_MARKER="# Orc stable runtime launcher"
# Every Claude Code login gets the same plugin, hooks and allowlist:
# ~/.claude, plus each ~/.claude-* that CLAUDE_CONFIG_DIR points at, told apart
# from a backup folder by its own .claude.json (as ui/claude_accounts.py does).
CLAUDE_HOMES=("$HOME/.claude")
for claude_home in "$HOME"/.claude-*; do
  [ -f "$claude_home/.claude.json" ] && CLAUDE_HOMES+=("$claude_home")
done
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
  configured_claude_home="$CLAUDE_CONFIG_DIR"
  case "$configured_claude_home" in
    '~/'*) configured_claude_home="$HOME/${configured_claude_home#\~/}" ;;
    /*) ;;
    *) configured_claude_home="$PWD/$configured_claude_home" ;;
  esac
  found_claude_home=false
  for claude_home in "${CLAUDE_HOMES[@]}"; do
    [ "$claude_home" = "$configured_claude_home" ] && found_claude_home=true
  done
  [ "$found_claude_home" = true ] || CLAUDE_HOMES+=("$configured_claude_home")
fi
SKILLS_DSTS=()
for claude_home in "${CLAUDE_HOMES[@]}"; do
  SKILLS_DSTS+=("$claude_home/skills")
done
SKILLS_DSTS+=("$HOME/.agents/skills")
# Where older installs put the OpenCode adapter, so
# remove_managed_opencode_files can find what to retire.
OPENCODE_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
OPENCODE_COMMANDS_DST="$OPENCODE_HOME/commands"
OPENCODE_PLUGIN_DST="$OPENCODE_HOME/plugins/orc.ts"
OPENCODE_MANAGED="$ORC_HOME/managed/opencode"
CODEX_AGENTS_DST="$HOME/.codex/agents"
CODEX_AGENTS_MANAGED="$ORC_HOME/managed/codex/agents"
RETIRED_CODEX_AGENT_FILES=(orc-cheap.toml orc-code.toml orc-fast.toml orc-phase.toml)
CLAUDE_AGENTS_SRC="$REPO_DIR/agents"
MODE=install
RUN_HEALTH_CHECKS=true
VERBOSE=false
PLUGIN_CHOICES=''
PLUGIN_CHOICES_SET=false
INSTALL_ARGS=("$@")
# ui/runtime_updates.py marks hook and in-app installs. Unset it so the daemon
# this install restarts, and every Orc terminal it opens, never inherit it.
AUTOMATIC_INSTALL="${ORC_INSTALL_AUTOMATIC:-}"
unset ORC_INSTALL_AUTOMATIC
while [ "$#" -gt 0 ]; do
  case "$1" in
    --uninstall) MODE=uninstall ;;
    --skip-health-checks) RUN_HEALTH_CHECKS=false ;;
    --verbose) VERBOSE=true ;;
    --plugins=*) PLUGIN_CHOICES="${1#--plugins=}"; PLUGIN_CHOICES_SET=true ;;
    --app-dir=*) APP_DIR="${1#--app-dir=}" ;;
    *) echo "usage: ./install.sh [--uninstall] [--skip-health-checks] [--verbose] [--plugins=id,id] [--app-dir=directory]" >&2; exit 1 ;;
  esac
  shift
done

if [ "$VERBOSE" = false ]; then
  # Public preflight must see the untouched home, including on a failed install.
  INSTALL_LOG="$(mktemp "${TMPDIR:-/tmp}/orc-install-XXXXXXXX")"
  printf 'Orc: %s in progress. Details: %s\n' "$MODE" "$INSTALL_LOG"
  if ORC_INSTALL_AUTOMATIC="$AUTOMATIC_INSTALL" bash "$REPO_DIR/install.sh" --verbose ${INSTALL_ARGS[@]+"${INSTALL_ARGS[@]}"} >"$INSTALL_LOG" 2>&1; then
    printf 'Orc: %s complete. Plugin choices are available on first launch and in Settings.\n' "$MODE"
  else
    status=$?
    printf 'Orc: %s failed (exit %s). Read %s or rerun with --verbose.\n' "$MODE" "$status" "$INSTALL_LOG" >&2
    tail -n 8 "$INSTALL_LOG" >&2
    exit "$status"
  fi
  exit 0
fi

# ------------------------------------------------------------------- output
# Structure comes from the stepper glyphs; ANSI is decoration on top and is
# dropped entirely when stdout is not a terminal (the git reinstall hook, pipes,
# CI). Errors keep going to stderr as plain text — tests match on those strings.
WIDTH=62
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  BOLD=""; DIM=""; OFF=""
fi

# Large /orc wordmark, and nothing under it: the sections that follow already
# say which path is running, so a subtitle only adds a line to read. It is
# deliberately fixed ASCII: output stays readable in logs and no
# locale-sensitive display width calculations are needed.
banner() {
  printf '\n%s%s' "$BOLD" '   /  ____  __________'
  printf '\n%s' '  /  / __ \/ ___/ ____/'
  printf '\n%s' ' /  / / / / /  / /'
  printf '\n%s' '/  / /_/ / /  / /___'
  printf '\n%s%s%s' '/  \____/_/   \____/' "$OFF" $'\n'
}

# One quiet gutter connects every step. `section` puts a diamond directly on
# that rail; `rail_close` corners it off so no run ends mid-stepper.
# RAIL is the prefix for the detail lines between markers. The glyphs are
# structure, not decoration, so they remain in non-TTY output. They never enter
# width math or substring slicing, which keeps the layout locale-independent.
RAIL="│"

section() {
  printf '%s%s%s\n' "$DIM" "$RAIL" "$OFF"
  printf '%s◇%s  %s%s%s\n' "$DIM" "$OFF" "$BOLD" "$1" "$OFF"
}

# Ends the gutter under the last line a path prints. The corner belongs at the
# bottom of the final section's body, not beside its heading — closing at the
# heading would strand every item after it off the rail.
rail_close() {
  printf '%s└%s\n' "$DIM" "$OFF"
  RAIL=" "
}

item()    { printf '%s%s%s  %s\n' "$DIM" "$RAIL" "$OFF" "$*"; }
warn()    { printf '  WARNING: %s\n' "$*" >&2; }

# Notes are the longest lines the installer prints, so they wrap under their
# label like any other value — a terminal-width wrap leaves its continuation
# off the gutter.
note()    { item_wrap "NOTE: " "$*"; }

# Subprocess output that belongs to the stepper. A `sed` prefix would emit a
# bare rail glyph, which renders heavier than every dim `item()` rail beside it;
# routing each line through item() keeps one gutter weight.
rail_pipe() {
  local line
  while IFS= read -r line; do item "$line"; done
}

# rail_pipe for a block that prints one status line: $1 is a padded label column
# (e.g. "claude:   "), so the line aligns with the section's other labelled items
# instead of running as bare prose off the column. Piped, not captured, so it
# keeps the same $()-free heredoc form (and pipefail behaviour) as every other block.
labeled() {
  local label="$1" line
  while IFS= read -r line; do item "$label$line"; done
}

# A labelled item whose value is too long for one line: $1 is the label column,
# printed once, and the remaining words wrap under it at the rail width instead
# of past it (a wrapped line breaks the gutter). The hanging indent is ASCII
# padding, so no box-drawing glyph is ever measured under the caller's locale.
item_wrap() {
  local label="$1"; shift
  local body_width=$((WIDTH - 3 - ${#label})) indent line='' word
  local -a words
  printf -v indent '%*s' "${#label}" ''
  # Split on whitespace without pathname expansion — same read as mcp_row, so a
  # value containing a glob character can reach the rail intact.
  read -r -a words <<< "$*"
  # An empty value is the label alone; "${words[@]}" on an empty array is an
  # unbound-variable error under `set -u` on the bash macOS still ships.
  if [ "${#words[@]}" -eq 0 ]; then item "$label"; return; fi
  for word in "${words[@]}"; do
    # A token wider than the column has no boundary to wrap on (a release sha,
    # a long path), so it is split mid-token rather than left to overflow the
    # rail. Only ASCII tokens ever get this wide, which keeps the slice safe.
    while [ "${#word}" -gt "$body_width" ]; do
      if [ -n "$line" ]; then
        item "$label$line"
        label="$indent"
        line=''
      fi
      item "$label${word:0:body_width}"
      label="$indent"
      word="${word:body_width}"
    done
    if [ -z "$line" ]; then
      line="$word"
    elif [ "$((${#line} + 1 + ${#word}))" -le "$body_width" ]; then
      line="$line $word"
    else
      item "$label$line"
      label="$indent"
      line="$word"
    fi
  done
  item "$label$line"
}

# Building Orc.app is five slow steps whose raw `==>` log floats off the rail
# and tells a reader nothing they act on. It collapses to one live bar on the
# rail; the build's own output is kept and only surfaced when it fails.
BAR_WIDTH=18
APP_BUILD_STEPS=5

# The bar is drawn glyph by glyph rather than sliced out of a padded string, so
# the multi-byte block never depends on the caller's locale. Redraw is in-place,
# which only means anything on a terminal — piped output gets one line at the
# end instead.
build_bar() {
  local label="$1" filled=$((BAR_WIDTH * $2 / APP_BUILD_STEPS))
  local on='' off='' i
  [ -t 1 ] || return 0
  for ((i = 0; i < BAR_WIDTH; i++)); do
    # Braced: bash 3.2 folds the following multi-byte glyph into an unbraced
    # name and reports it unbound under `set -u`.
    if [ "$i" -lt "$filled" ]; then on="${on}━"; else off="${off}━"; fi
  done
  printf '\r%s%s%s  %s%s%s%s%s%s  %-22s' \
    "$DIM" "$RAIL" "$OFF" "$BOLD" "$on" "$OFF" "$DIM" "$off" "$OFF" "$label"
}

build_app() {
  local dest="$1" script="$2" log rc line label step=0
  log="$(mktemp)"
  build_bar "building app" 0
  # pipefail off so the reader loop's success does not mask the build's status;
  # PIPESTATUS carries it out.
  set +o pipefail
  ORC_APP_DEST="$dest" bash "$script" 2>&1 | tee "$log" | while IFS= read -r line; do
    case "$line" in
      '==> Scaffolding'*)      step=1; label="staging bundle" ;;
      '==> Generating icon'*)  step=2; label="rendering icon" ;;
      '==> Compiling'*)        step=3; label="compiling Swift" ;;
      '==> Code signing'*)     step=4; label="signing bundle" ;;
      '==> Installing'*)       step=5; label="installing app" ;;
      *) continue ;;
    esac
    build_bar "$label" "$step"
  done
  rc=${PIPESTATUS[0]}
  set -o pipefail
  if [ "$rc" -ne 0 ]; then
    if [ -t 1 ]; then printf '\n'; fi
    cat "$log" >&2
    rm -f "$log"
    return "$rc"
  fi
  build_bar "app built" "$APP_BUILD_STEPS"
  if [ -t 1 ]; then printf '\n'; else item "app built"; fi
  rm -f "$log"
}

MCP_SERVICE_WIDTH=9
MCP_ACCESS_WIDTH=24
MCP_PURPOSE_WIDTH=16

# MCP table occupies the 59 columns left after item()'s three-column rail.
# Rule segments start as ASCII padding and are replaced whole, so no box-drawing
# glyph is ever measured or sliced under a caller's locale.
mcp_rule() {
  local left="$1" middle="$2" right="$3"
  local service_rule access_rule purpose_rule
  printf -v service_rule '%*s' "$((MCP_SERVICE_WIDTH + 2))" ''
  printf -v access_rule '%*s' "$((MCP_ACCESS_WIDTH + 2))" ''
  printf -v purpose_rule '%*s' "$((MCP_PURPOSE_WIDTH + 2))" ''
  item "${DIM}${left}${service_rule// /─}${middle}${access_rule// /─}${middle}${purpose_rule// /─}${right}${OFF}"
}

mcp_print_row() {
  local row
  printf -v row '%s│%s %-*s %s│%s %-*s %s│%s %-*s %s│%s' \
    "$DIM" "$OFF" "$MCP_SERVICE_WIDTH" "$1" \
    "$DIM" "$OFF" "$MCP_ACCESS_WIDTH" "$2" \
    "$DIM" "$OFF" "$MCP_PURPOSE_WIDTH" "$3" "$DIM" "$OFF"
  item "$row"
}

mcp_row() {
  local service="$1" access="$2" purpose="$3"
  local line='' candidate word
  local -a words
  read -r -a words <<< "$purpose"
  for word in "${words[@]}"; do
    if [ -z "$line" ]; then
      candidate="$word"
    else
      candidate="$line $word"
    fi
    if [ "${#candidate}" -le "$MCP_PURPOSE_WIDTH" ]; then
      line="$candidate"
    else
      mcp_print_row "$service" "$access" "$line"
      service=''
      access=''
      line="$word"
    fi
  done
  mcp_print_row "$service" "$access" "$line"
}

mcp_table() {
  local service index=0 total
  if [ "$#" -eq 0 ]; then
    set -- linear sentry notion github
  fi
  total="$#"
  mcp_rule "┌" "┬" "┐"
  mcp_row "SERVICE" "ACCESS" "PURPOSE"
  mcp_rule "├" "┼" "┤"
  for service in "$@"; do
    case "$service" in
      linear)    mcp_row "Linear" "OAuth" "ticket context" ;;
      sentry)    mcp_row "Sentry" "OAuth; Seer opt-in" "issues + stack traces; autofix" ;;
      notion)    mcp_row "Notion" "OAuth" "docs" ;;
      github)    mcp_row "GitHub" "gh CLI login" "repos + PRs" ;;
      github-missing) mcp_row "GitHub" "gh CLI missing" "repos + PRs" ;;
    esac
    index=$((index + 1))
    if [ "$index" -lt "$total" ]; then
      mcp_rule "├" "┼" "┤"
    else
      mcp_rule "└" "┴" "┘"
    fi
  done
}

# Enabled plugins declaring a postInstall command run their setup step here.
setup_plugins() {
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local -a cmd=()
    eval "cmd=($line)"
    if ! "${cmd[@]}" </dev/null | rail_pipe; then
      warn "Plugin setup failed; retry: ${cmd[*]}"
    fi
  done < <(python3 -B - "$CURRENT_LINK" <<'PY'
import shlex, sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / 'ui'))
from app_plugins import Registry
for argv in Registry().post_install_commands():
    print(shlex.join(argv))
PY
  )
}

claude_mcp_healthy() {
  local details
  details="$(claude mcp get "$1" 2>/dev/null)" || return 1
  case "$details" in
    *'Status: '*'✓ Connected'*) return 0 ;;
    *) return 1 ;;
  esac
}

github_cli_health() {
  if ! command -v gh >/dev/null 2>&1; then
    echo missing
  elif gh auth status --active --hostname github.com >/dev/null 2>&1; then
    echo healthy
  else
    echo unauthenticated
  fi
}

print_integration_setup() {
  local claude_available=false server gh_health unhealthy
  local -a missing_mcp=() setup_rows=()


  if command -v claude >/dev/null 2>&1; then
    claude_available=true
    # Three independent ~1s network round trips. Run them at once and collect
    # the names over one pipe — each child writes a single short line, so the
    # writes cannot interleave — then read them back in the table's fixed order.
    # No temp file: this block also runs with only a stub bin dir on PATH
    # (tests/test_installer_output_contract.py), where mktemp does not exist.
    unhealthy="$( { for server in linear sentry notion; do
        { claude_mcp_healthy "$server" || printf '%s\n' "$server"; } &
      done
      wait; } )"
    for server in linear sentry notion; do
      case "$unhealthy" in
        *"$server"*) missing_mcp+=("$server") ;;
      esac
    done
  else
    note "claude CLI not found — install Claude Code, then re-run ./install.sh for the MCP setup steps"
  fi

  gh_health="$(github_cli_health)"
  if [ "${#missing_mcp[@]}" -gt 0 ]; then
    setup_rows=("${missing_mcp[@]}")
  fi
  case "$gh_health" in
    missing) setup_rows+=(github-missing) ;;
    unauthenticated) setup_rows+=(github) ;;
  esac

  if [ "${#setup_rows[@]}" -eq 0 ]; then
    return
  fi

  item ""
  item "One-time MCP setup:"
  item ""
  mcp_table "${setup_rows[@]}"
  item ""
  item "Setup commands:"

  if [ "$claude_available" = true ] && [ "${#missing_mcp[@]}" -gt 0 ]; then
    for server in "${missing_mcp[@]}"; do
      case "$server" in
        linear)    item "claude mcp add --transport http linear    https://mcp.linear.app/mcp" ;;
        sentry)    item "claude mcp add --transport http sentry    https://mcp.sentry.dev/mcp" ;;
        notion)    item "claude mcp add --transport http notion    https://mcp.notion.com/mcp" ;;
      esac
    done
    item ""
    item "Then run /mcp in Claude Code to complete OAuth."
  fi

  if [ "$gh_health" != healthy ]; then
    item ""
    item "GitHub has no MCP server — Orc shells out to the gh CLI:"
    item ""
    if [ "$gh_health" = missing ]; then
      item_wrap "" "GitHub CLI not found — install it from https://cli.github.com/"
      item "Then authenticate:"
    fi
    item "gh auth login"
  fi
}

PROMOTION_ACTIVE=false
PROMOTION_TXN=""
OLD_CURRENT_TARGET=""
LAUNCHER_BACKED_UP=false
APP_BACKED_UP=false
LAUNCHER_CREATED=false
APP_CREATED=false
APP_LOCATION_CREATED=false
PROMOTED_UI_RECONCILED=false
INSTALL_LOCK="$ORC_HOME/install.lock"
INSTALL_LOCK_OWNED=false

classify_launcher() {
  target="$1"
  if [ -f "$target" ] && grep -qFx "$STABLE_LAUNCHER_MARKER" "$target" 2>/dev/null; then
    echo stable
  elif [ -L "$target" ]; then
    case "$(readlink "$target")" in
      "$REPO_DIR/bin/orc-ui"|"$ORC_HOME/dist/bin/orc-ui"|*-worktrees/*/bin/orc-ui)
        echo legacy ;;
      *) echo unrecognized ;;
    esac
  elif [ -e "$target" ]; then
    echo unrecognized
  else
    echo absent
  fi
}

classify_app() {
  target="$1"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$CURRENT_LINK/Orc.app" ]; then
    echo current
  elif [ -L "$target" ]; then
    case "$(readlink "$target")" in
      "$REPO_DIR/app/build/Orc.app"|"$ORC_HOME/dist/app/build/Orc.app"|*-worktrees/*/app/build/Orc.app)
        echo legacy ;;
      *) echo unrecognized ;;
    esac
  elif [ -e "$target" ]; then
    if grep -q '<string>com\.orc\.app</string>' "$target/Contents/Info.plist" 2>/dev/null; then
      echo legacy
    else
      echo unrecognized
    fi
  else
    echo absent
  fi
}

# Automatic web-only promotions leave Orc.app running. After a committed
# promotion, native_app_update.py replaces it when its executable bytes changed,
# or always when the install was run by hand.

atomic_replace() {
  python3 - "$1" "$2" <<'PY'
import os, sys
os.replace(sys.argv[1], sys.argv[2])
PY
}

create_symlink() {
  python3 - "$1" "$2" <<'PY'
import os, sys
os.symlink(sys.argv[1], sys.argv[2])
PY
}

release_install_lock() {
  [ "$INSTALL_LOCK_OWNED" = true ] || return 0
  [ "$(cat "$INSTALL_LOCK/pid" 2>/dev/null || true)" = "$$" ] || return 0
  command rm -f "$INSTALL_LOCK/pid"
  rmdir "$INSTALL_LOCK" 2>/dev/null || true
  INSTALL_LOCK_OWNED=false
}

acquire_install_lock() {
  mkdir -p "$ORC_HOME"
  # Artifact installs relocate and exec this script while holding the lock.
  # exec preserves both PID and this token, so the relocated copy adopts the
  # same lock instead of deadlocking against itself.
  if [ "${ORC_INSTALL_LOCK_PID:-}" = "$$" ] \
     && [ "$(cat "$INSTALL_LOCK/pid" 2>/dev/null || true)" = "$$" ]; then
    INSTALL_LOCK_OWNED=true
    trap release_install_lock EXIT
    return 0
  fi

  attempt=0
  while ! mkdir "$INSTALL_LOCK" 2>/dev/null; do
    owner="$(cat "$INSTALL_LOCK/pid" 2>/dev/null || true)"
    case "$owner" in
      *[!0-9]*|'')
        # Give the winner time to write its PID before treating an empty lock
        # as abandoned.
        if [ "$attempt" -ge 20 ]; then rmdir "$INSTALL_LOCK" 2>/dev/null || true; fi
        ;;
      *)
        if ! kill -0 "$owner" 2>/dev/null; then
          command rm -f "$INSTALL_LOCK/pid"
          rmdir "$INSTALL_LOCK" 2>/dev/null || true
        fi
        ;;
    esac
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 6000 ]; then
      echo "ERROR: timed out waiting for another Orc installer" >&2
      return 1
    fi
    sleep 0.05
  done
  printf '%s\n' "$$" >"$INSTALL_LOCK/pid"
  export ORC_INSTALL_LOCK_PID="$$"
  INSTALL_LOCK_OWNED=true
  trap release_install_lock EXIT
}

rollback_promotion() {
  [ "$PROMOTION_ACTIVE" = true ] || return 0
  set +e
  echo "orc: promotion failed — restoring previous desktop runtime" >&2
  # Reconciliation may already have started the promoted daemon. Stop it while
  # current still resolves to that exact release; otherwise the restored
  # launcher cannot prove ownership of the process occupying port 4173.
  if [ "$PROMOTED_UI_RECONCILED" = true ] && [ -x "$RUNTIME_RELEASE/bin/orc-ui" ]; then
    "$RUNTIME_RELEASE/bin/orc-ui" stop >/dev/null 2>&1 || true
  fi
  if [ -n "$OLD_CURRENT_TARGET" ]; then
    ln -s "$OLD_CURRENT_TARGET" "$CURRENT_LINK.rollback.$$"
    atomic_replace "$CURRENT_LINK.rollback.$$" "$CURRENT_LINK"
  else
    rm -f "$CURRENT_LINK"
  fi
  for state in version.json update.json; do
    if [ -f "$PROMOTION_TXN/$state" ]; then
      cp "$PROMOTION_TXN/$state" "$RUNTIME_HOME/$state"
    else
      rm -f "$RUNTIME_HOME/$state"
    fi
  done
  if [ "$LAUNCHER_BACKED_UP" = true ]; then
    rm -f "$LAUNCHER_PATH"
    mv "$PROMOTION_TXN/orc-ui" "$LAUNCHER_PATH"
  elif [ "$LAUNCHER_CREATED" = true ] && [ "$(classify_launcher "$LAUNCHER_PATH")" = stable ]; then
    rm -f "$LAUNCHER_PATH"
  fi
  if [ "$APP_BACKED_UP" = true ]; then
    rm -rf "$APP_LINK"
    mv "$PROMOTION_TXN/Orc.app" "$APP_LINK"
  elif [ "$APP_CREATED" = true ] && [ "$(classify_app "$APP_LINK")" = current ]; then
    rm -f "$APP_LINK"
  fi
  if [ "$APP_LOCATION_CREATED" = true ]; then
    rm -f "$APP_LOCATION"
  fi
  if [ "${UI_WAS_RUNNING:-false}" = true ] && [ -x "$LAUNCHER_PATH" ]; then
    "$LAUNCHER_PATH" start >/dev/null 2>&1 || true
  fi
  rm -rf "$PROMOTION_TXN"
}

on_error() {
  status=$?
  line="$1"
  rollback_promotion
  echo "ERROR: $MODE failed at line $line — fix the cause and re-run (the script is idempotent)" >&2
  exit "$status"
}
trap 'on_error $LINENO' ERR

# Skills invoke these helpers through PATH; missing links encourage agents to
# invent replacements. tests/test_installer_bins.py binds this list to skills/.
BINS=(orc-app-plugin orc-browser-failures orc-bug-replay orc-ui orc-init orc-snapshot orc-record-model orc-phase-handoff orc-run-project orc-publish-question orc-publish-diagram orc-qa-steps orc-secret orc-push-setup orc-manual-step orc-check orc-verification-guides orc-cloud orc-settings-backup orc-setting orc-merge-main orc-merge-watch orc-sync-main orc-worktree orc-validate-shots orc-mockup-scaffold orc-design-check orc-plan-lint orc-plan-ready orc-plan-start orc-sibling orc-note orc-pr orc-pr-body-lint orc-pr-replies orc-pr-review orc-test-select orc-ticket-evidence orc-local-review orc-bring-to-main orc-hook-policy orc-delivery-authority orc-split-children orc-decision orc-record-delivery orc-ship-hold orc-escalate orc-clarification-done orc-complete-parent orc-evals-report orc-theme orc-agent-browser orc-task orc-orchestrator orc-routes)
available_bins=()
for b in "${BINS[@]}"; do
  [ ! -f "$REPO_DIR/bin/$b" ] || available_bins+=("$b")
done
BINS=("${available_bins[@]}")
# Prune old command links on install and uninstall to avoid dangling entries in ~/.local/bin.
REMOVED_BINS=(orc-retro orc-feedback orc-migrate-v3 orc-migrate-relationships orc-usage-import orc-merge-parent orc-stats orc-sync-runs orc-sync-r2 orc-config-sync orc-project-context orc-runlog-bridge orc-discord orc-code-graph orc-task-models orc-browser orc-plugin-install orc-project-setup orc-review-evidence orc-memory-sync)

# Keep the installer's version claim bounded to the immutable release it is
# promoting: its VERSION file, or for older commits the strict release tag
# grammar and version-aware ordering bin/orc-version-json falls back to.
release_version_for_ref() {
  local repo="$1" ref="$2" tag version
  version="$(git -C "$repo" show "$ref:VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'v%s\n' "$version"
    return 0
  fi
  while IFS= read -r tag; do
    if [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      printf '%s\n' "$tag"
      return 0
    fi
  done < <(git -C "$repo" tag --list 'v*.*.*' --merged "$ref" --sort=-v:refname 2>/dev/null || true)
  printf 'unavailable (no semantic version tag reaches release %.12s)\n' "$ref"
}

source_kind=artifact
release_id=""
release_version="unavailable (artifact bundle has no Git metadata)"
if [ "$MODE" = install ] && git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  source_kind=git
  common_dir="$(git -C "$REPO_DIR" rev-parse --path-format=absolute --git-common-dir)"
  primary_repo="$(cd "$(dirname "$common_dir")" && pwd -P)"
  if [ "$REPO_DIR" != "$primary_repo" ]; then
    echo "ERROR: desktop runtime promotion is owned by the primary checkout: $primary_repo" >&2
    echo "Use an isolated preview for this worktree: orc-ui preview \"$REPO_DIR\"" >&2
    exit 1
  fi
  canonical_ref="${ORC_RUNTIME_REF:-$(git -C "$REPO_DIR" config --get orc.runtimeRef || true)}"
  # `git clone --branch stable` has no main. Follow the branch it has, and
  # remember it, so the copy keeps updating from there.
  if [ -z "$canonical_ref" ] && [ -n "$ORC_DISTRIBUTION_SOURCE" ] \
    && ! git -C "$REPO_DIR" rev-parse --quiet --verify refs/heads/main >/dev/null; then
    canonical_ref="$(git -C "$REPO_DIR" symbolic-ref --quiet HEAD || true)"
    [ -z "$canonical_ref" ] || git -C "$REPO_DIR" config orc.runtimeRef "$canonical_ref"
  fi
  canonical_ref="${canonical_ref:-refs/heads/main}"
  if ! canonical_commit="$(git -C "$REPO_DIR" rev-parse --verify "${canonical_ref}^{commit}" 2>/dev/null)"; then
    echo "ERROR: configured Orc runtime ref does not exist: $canonical_ref" >&2
    exit 1
  fi
  head_commit="$(git -C "$REPO_DIR" rev-parse HEAD)"
  if [ "$head_commit" != "$canonical_commit" ]; then
    echo "ERROR: refusing desktop promotion: HEAD is not $canonical_ref ($canonical_commit)" >&2
    exit 1
  fi
  # Python's __pycache__ and Finder's .DS_Store are not edits. A public clone
  # has no .gitignore, so without this they block every update.
  python3 -B "$REPO_DIR/ui/local_clutter.py" "$REPO_DIR"
  if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=normal)" ]; then
    echo "ERROR: refusing desktop promotion from a dirty primary checkout" >&2
    exit 1
  fi
  release_id="$head_commit"
  release_version="$(release_version_for_ref "$REPO_DIR" "$release_id")"
fi

# Matched loosely (any */bin/<name>, not just $REPO_DIR's): the link was often
# made by a different checkout than the one running now — installing from a
# worktree is normal — and that copy is on its way out either way.
prune_removed_bins() {
  for b in "${REMOVED_BINS[@]}"; do
    link="$HOME/.local/bin/$b"
    [ -L "$link" ] || continue
    case "$(readlink "$link")" in
      */bin/"$b") rm "$link"; item "removed stale ~/.local/bin/$b" ;;
    esac
  done
  for link in "$HOME/.local/bin"/orc-*; do
    [ -L "$link" ] && [ ! -e "$link" ] || continue
    b="${link##*/}"
    if [ "$MODE" = install ] && [ "$b" = orc-mcp ]; then continue; fi
    if [ "$(readlink "$link")" = "$REPO_DIR/bin/$b" ]; then
      rm "$link"
      item "removed stale ~/.local/bin/$b"
    fi
  done
}

# The Discord bridge is gone; its settings, state and private venv would
# otherwise sit in ~/.orc forever with nothing left to read them.
remove_discord_bridge() {
  local path
  for path in "$ORC_HOME/discord.json" "$ORC_HOME/discord-state.json" \
      "$ORC_HOME/discord-state.json.lock" "$ORC_HOME/discord-venv"; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    rm -rf "$path"; item "removed $path"
  done
}

# An install computes about forty of these, all on small files, so what is
# measured here is interpreter startup, not hashing: 0.29s through openssl,
# 0.56s through shasum, 1.20s through python3. openssl prints
# "SHA256(path)= <hex>", so the digest is the last field. Every branch emits the
# same lowercase hex, so digests recorded by an earlier install stay valid.
file_sha256() {
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$1" <<'PY'
import hashlib, sys
digest = hashlib.sha256()
with open(sys.argv[1], "rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        digest.update(chunk)
print(digest.hexdigest())
PY
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    # Unknown can never match a recorded SHA-256, so uninstall preserves the
    # file when no hashing tool is available.
    echo unavailable
  fi
}

uninstall_opencode_file() {
  local target="$1"
  local state="$2"
  local recorded_digest
  [ -f "$state" ] || return 0
  recorded_digest="$(cat "$state")"
  if [ -f "$target" ] && [ "$(file_sha256 "$target")" = "$recorded_digest" ]; then
    rm "$target"
    item "removed $target"
  elif [ -e "$target" ] || [ -L "$target" ]; then
    note "kept modified/unrecognized $target"
  fi
  rm -f "$state"
}

# Remove every file the retired OpenCode adapter installed, but only while its
# bytes still match the digest Orc recorded. Modified files remain user-owned.
remove_managed_opencode_files() {
  local state name
  for state in "$OPENCODE_MANAGED/commands"/*.sha256; do
    [ -f "$state" ] || continue
    name="$(basename "$state" .sha256)"
    uninstall_opencode_file "$OPENCODE_COMMANDS_DST/$name" "$state"
  done
  uninstall_opencode_file "$OPENCODE_PLUGIN_DST" "$OPENCODE_MANAGED/plugins/orc.ts.sha256"
  rmdir "$OPENCODE_MANAGED/commands" "$OPENCODE_MANAGED/plugins" "$OPENCODE_MANAGED" 2>/dev/null || true
}

uninstall_codex_agent() {
  local target="$1"
  local state="$2"
  local recorded_digest
  [ -f "$state" ] || return 0
  recorded_digest="$(cat "$state")"
  if [ ! -L "$target" ] && [ -f "$target" ] \
      && [ "$(file_sha256 "$target")" = "$recorded_digest" ]; then
    rm "$target"
    item "removed $target"
  elif [ -e "$target" ] || [ -L "$target" ]; then
    warn "kept modified/unowned Codex agent $target"
  fi
  rm -f "$state"
}

remove_managed_codex_agents() {
  local name
  for name in "${RETIRED_CODEX_AGENT_FILES[@]}"; do
    uninstall_codex_agent "$CODEX_AGENTS_DST/$name" "$CODEX_AGENTS_MANAGED/$name.sha256"
  done
  rmdir "$CODEX_AGENTS_MANAGED" "$ORC_HOME/managed/codex" 2>/dev/null || true
}

remove_managed_claude_agents() {
  local claude_home target account backup
  for claude_home in "${CLAUDE_HOMES[@]}"; do
    target="$claude_home/agents/comment-sicko.md"
    [ -L "$target" ] || continue
    case "$(readlink "$target")" in
      "$CLAUDE_AGENTS_SRC/comment-sicko.md"|"$ORC_HOME/dist/agents/comment-sicko.md")
        rm "$target"
        item "removed $target"
        account="$(basename "$claude_home")"
        backup="$ORC_HOME/backups/${account#.}-agents/comment-sicko.md"
        if [ -e "$backup" ] || [ -L "$backup" ]; then
          mv "$backup" "$target"
          item "restored $target from backup"
        fi
        ;;
    esac
  done
}

retire_legacy_skill_plugins() {
  local skills_dst link link_target resolved_target removed_here removed_total=0
  if command -v python3 >/dev/null 2>&1; then
    python3 - "${CODEX_HOME:-$HOME/.codex}" "${CLAUDE_HOMES[@]}" <<'PY' | rail_pipe
import json, os, shutil, subprocess, sys
from pathlib import Path

PLUGIN_ID = "orc@orc-local"
codex_home = Path(sys.argv[1])
claude_homes = [Path(arg) for arg in sys.argv[2:]]


def contains_plugin(value):
    if isinstance(value, dict):
        if any(value.get(key) == PLUGIN_ID for key in ("pluginId", "id", "name")):
            return True
        return any(contains_plugin(child) for child in value.values())
    if isinstance(value, list):
        return any(contains_plugin(child) for child in value)
    return False


def plugin_installed(cli, env=None):
    try:
        result = subprocess.run([cli, "plugin", "list", "--json"], env=env, stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return False
    if result.returncode:
        return False
    try:
        catalog = json.loads(result.stdout)
    except ValueError:
        return False
    return contains_plugin(catalog.get("installed", []) if cli == "codex" and isinstance(catalog, dict) else catalog)


removed = []
if codex_home.is_dir() and shutil.which("codex") and plugin_installed("codex"):
    try:
        res = subprocess.run(["codex", "plugin", "remove", PLUGIN_ID, "--json"],
                             stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15)
        if res.returncode == 0:
            removed.append("Codex")
    except (OSError, subprocess.SubprocessError):
        pass

if shutil.which("claude"):
    for account in claude_homes:
        if not account.is_dir():
            continue
        env = dict(os.environ, CLAUDE_CONFIG_DIR=str(account))
        if plugin_installed("claude", env):
            try:
                res = subprocess.run(
                    ["claude", "plugin", "uninstall", PLUGIN_ID, "--scope", "user", "--keep-data", "--json"],
                    env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
                )
                if res.returncode == 0:
                    removed.append(account.name)
            except (OSError, subprocess.SubprocessError):
                pass

if removed:
    print("retired legacy Orc plugin from " + ", ".join(removed))
PY
  fi
  for skills_dst in "${SKILLS_DSTS[@]}"; do
    removed_here=0
    for link in "$skills_dst"/*; do
      [ -L "$link" ] || continue
      link_target="$(readlink "$link")"
      resolved_target=""
      if [ -d "$(dirname "$link_target")" ]; then
        resolved_target="$(cd "$(dirname "$link_target")" 2>/dev/null && pwd -P)/$(basename "$link_target")"
      fi
      case "$link_target" in
        "$SKILLS_SRC"/*|"$ORC_HOME/dist/skills"/*|"$(dirname "$REPO_DIR")/$(basename "$REPO_DIR")-worktrees"/*/skills/*|"$ORC_HOME/src-worktrees"/*/skills/*)
          rm "$link"
          removed_here=$((removed_here + 1))
          removed_total=$((removed_total + 1))
          ;;
        *)
          case "$resolved_target" in
            "$SKILLS_SRC"/*|"$ORC_HOME/dist/skills"/*|"$(dirname "$REPO_DIR")/$(basename "$REPO_DIR")-worktrees"/*/skills/*|"$ORC_HOME/src-worktrees"/*/skills/*)
              rm "$link"
              removed_here=$((removed_here + 1))
              removed_total=$((removed_total + 1))
              ;;
          esac
          ;;
      esac
    done
    if [ "$MODE" = uninstall ]; then
      item "$removed_here unlinked <- $skills_dst"
    fi
  done
  if [ "$MODE" = install ] && [ "$removed_total" -gt 0 ]; then
    item "removed $removed_total legacy skill link(s)"
  fi
}

retire_claude_user_hooks() {
  local claude_home
  for claude_home in "${CLAUDE_HOMES[@]}"; do
    python3 - "$claude_home/settings.json" "$MODE" <<'PY' | labeled "claude:   "
import json, re, sys
path, mode = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        cfg = json.load(f)
except FileNotFoundError:
    if mode == "install":
        print("per-turn via Orc (user settings untouched)")
    else:
        print(f"removed 0 orc hook(s) from {path}")
    sys.exit(0)
except (OSError, ValueError):
    if mode == "install":
        print("per-turn via Orc (user settings untouched)")
    sys.exit(0)

removed = 0
changed = False


def orc_owned(command):
    return (command.endswith(("orc-gate-link.sh", "orc-run-init.sh",
                              "orc-worktree-guard.sh", "orc-gate-notify.sh",
                              "aws-allowlist.py"))
            or re.search(r"/bin/orc-hook-policy(\s|$)", command) is not None)


for event in ("PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"):
    entries = cfg.get("hooks", {}).get(event, [])
    kept = []
    for entry in entries:
        kept_hooks = [h for h in entry.get("hooks", []) if not orc_owned(h.get("command", ""))]
        dropped = len(entry.get("hooks", [])) - len(kept_hooks)
        if dropped:
            removed += dropped
            changed = True
        if kept_hooks:
            entry["hooks"] = kept_hooks
            kept.append(entry)
    if kept:
        cfg["hooks"][event] = kept
    elif event in cfg.get("hooks", {}):
        cfg["hooks"].pop(event, None)
        changed = True
if "hooks" in cfg and not cfg.get("hooks"):
    cfg.pop("hooks", None)
    changed = True

permissions = cfg.get("permissions")
if isinstance(permissions, dict) and isinstance(permissions.get("allow"), list):
    kept_allow = [rule for rule in permissions["allow"]
                  if not (isinstance(rule, str) and "/plugins/orc/**" in rule)]
    if len(kept_allow) != len(permissions["allow"]):
        permissions["allow"] = kept_allow
        changed = True

if changed:
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
if mode == "install":
    if removed:
        print(f"per-turn via Orc (retired {removed} user hook(s))")
    else:
        print("per-turn via Orc (user settings untouched)")
else:
    print(f"removed {removed} orc hook(s) from {path}")
PY
  done
}

retire_codex_user_hooks() {
  python3 - "${CODEX_HOME:-$HOME/.codex}/hooks.json" "$MODE" "$CURRENT_LINK" "$REPO_DIR" <<'PY' | labeled "codex:    "
import json, sys
path, mode, current_link, repo_dir = sys.argv[1:5]
try:
    with open(path) as f:
        cfg = json.load(f)
except FileNotFoundError:
    if mode == "install":
        print("user hooks untouched")
    sys.exit(0)
except (OSError, ValueError) as exc:
    print(f"WARNING: could not update {path}: {exc}", file=sys.stderr)
    sys.exit(0)

owned_commands = {
    f"{current_link}/bin/orc-hook-policy run-init --harness codex",
    f"{current_link}/hooks/orc-run-init.sh",
    f"{current_link}/hooks/orc-session-idle.sh",
    f"{repo_dir}/bin/orc-hook-policy run-init --harness codex",
    f"{repo_dir}/hooks/orc-run-init.sh",
    f"{repo_dir}/hooks/orc-session-idle.sh",
}


def orc_owned(command):
    return isinstance(command, str) and (
        command in owned_commands
        or ("/.orc/runtime/" in command and command.endswith((
            "/hooks/orc-run-init.sh",
            "/hooks/orc-session-idle.sh",
            "/bin/orc-hook-policy run-init --harness codex",
        )))
    )


removed = 0
hooks = cfg.get("hooks", {})
for event in ("UserPromptSubmit", "Stop"):
    kept_entries = []
    for entry in hooks.get(event, []):
        kept_hooks = []
        for hook in entry.get("hooks", []):
            if orc_owned(hook.get("command")):
                removed += 1
            else:
                kept_hooks.append(hook)
        if kept_hooks:
            entry["hooks"] = kept_hooks
            kept_entries.append(entry)
    if kept_entries:
        hooks[event] = kept_entries
    else:
        hooks.pop(event, None)
if not hooks:
    cfg.pop("hooks", None)
if removed:
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
if mode == "install":
    if removed:
        print(f"retired {removed} legacy user hook(s)")
    else:
        print("user hooks untouched")
else:
    print(f"removed {removed} orc hook(s) from ~/.codex/hooks.json")
PY
}

check_public_install() {
  [ "$MODE" = install ] || return 0
  python3 -B - "$REPO_DIR" "$ORC_DISTRIBUTION_SOURCE" "$source_kind" <<'PY'
import json, os, pathlib, sys
repo = pathlib.Path(sys.argv[1])
home = pathlib.Path.home()
orc = home / '.orc'
current = orc / 'runtime/current'
manifest = repo / 'distribution.json'
if not os.path.lexists(manifest) and not sys.argv[2]:
    sys.exit(0)

def public_source(path):
    data = json.loads(path.read_text())
    source = data['source']
    if data['audience'] != 'public' or not isinstance(source, str) or not source.startswith('https://'):
        raise ValueError('invalid public distribution identity')
    return source

try:
    source = public_source(manifest)
    if sys.argv[2] and source != sys.argv[2]:
        raise ValueError('bundle source differs from its distribution identity')
    managed_home = None
    if orc.is_symlink():
        sys.path.insert(0, str(repo / 'ui'))
        from install_home import OWNER_FILE, configured_target
        managed_home = configured_target(home)
    for key, default in [('CODEX_HOME', '.codex'), ('CLAUDE_CONFIG_DIR', '.claude')]:
        configured = pathlib.Path(os.environ.get(key, str(home / default))).expanduser().resolve()
        if not configured.is_relative_to(home.resolve()):
            raise ValueError('agent configuration must belong to the isolated user environment')
    if os.path.lexists(current):
        if (not current.is_symlink() or not current.is_dir()
                or current.resolve().parent != (orc / 'runtime/releases').resolve()
                or public_source(current / 'distribution.json') != source):
            raise ValueError('existing runtime is not a compatible public distribution')
        for name in ('version.json', 'update.json'):
            state = orc / 'runtime' / name
            if os.path.lexists(state):
                prior = json.loads(state.read_text())['repo']
                if not isinstance(prior, str) or (name == 'version.json' and not prior):
                    raise ValueError('ambiguous update provenance')
                if prior and public_source(pathlib.Path(prior).expanduser() / 'distribution.json') != source:
                    raise ValueError('incompatible update provenance')
    else:
        # Relocation re-execs under this install's existing lock. It is not
        # evidence of an older installation, unlike any other retained state.
        owned = (os.environ.get('ORC_INSTALL_LOCK_PID') == str(os.getppid())
                 and (orc / 'install.lock/pid').read_text().strip() == str(os.getppid()))
        allowed = {'install.lock'}
        if managed_home:
            allowed.add(OWNER_FILE)
        if owned and repo.resolve() == (orc / 'dist').resolve():
            allowed.add('dist')
        if sys.argv[3] == 'git' and repo.resolve() == (orc / 'src').resolve():
            allowed.add('src')
        if orc.exists() and any(path.name not in allowed for path in orc.iterdir()):
            raise ValueError('existing Orc state has no public runtime identity')
        legacy = [home / 'Applications/Orc.app', *home.glob('.local/bin/orc-*'),
                  *home.glob('.claude*/skills/orc*'), *home.glob('.agents/skills/orc*')]
        if any(os.path.lexists(path) for path in legacy):
            raise ValueError('legacy Orc installation detected')
    if sys.argv[3] == 'git':
        os.environ['ORC_HOME'] = str(orc)
        trusted_ui = (current / 'ui') if (current / 'ui/release_signing.py').is_file() else (repo / 'ui')
        sys.path.insert(0, str(trusted_ui))
        import runtime_updates
        error = runtime_updates.distribution_source_error(repo)
        if error:
            raise ValueError(error)
        sig_error = runtime_updates.release_signature_error(repo, 'HEAD')
        if sig_error:
            raise ValueError(sig_error)
    else:
        sys.path.insert(0, str(repo / 'ui'))
        import release_signing
        release_signing.manifest_signing_keys(json.loads(manifest.read_text()), required=True)
except (OSError, ValueError, KeyError, TypeError) as error:
    sys.exit('ERROR: public installation requires a fresh isolated user environment '
             'or the same public distribution; existing state was not adopted. ' + str(error))
PY
}

# preflight — python3 runs release staging and legacy hook cleanup; fail before any mutation.
# Failures exit here, before anything is touched; the passing notes are held in
# PREFLIGHT_NOTES so they print under the Preflight section, below the wordmark.
PREFLIGHT_NOTES=()
if [ "$MODE" = "install" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 is required — install it and re-run" >&2
    exit 1
  fi
  check_public_install
fi

# Every install/uninstall mutates the same user-level adapters and immutable
# runtime selector. Serialize before the first mutation so concurrent git hooks
# cannot cross promotion/rollback ownership state.
acquire_install_lock
# Another installer may have changed the selected distribution while we waited.
check_public_install

if [ -L "$APP_LOCATION" ]; then
  saved_app="$(readlink "$APP_LOCATION")"
  case "$saved_app" in
    /Orc.app|/*/Orc.app) APP_LINK="$saved_app" ;;
    *) echo "ERROR: invalid Orc.app location in $APP_LOCATION" >&2; exit 1 ;;
  esac
elif [ -e "$APP_LOCATION" ]; then
  echo "ERROR: $APP_LOCATION is not an Orc-owned symlink" >&2
  exit 1
fi
if [ -n "$APP_DIR" ]; then
  if [ "$MODE" != install ] || [ "$(uname)" != Darwin ]; then
    echo "ERROR: --app-dir is for macOS installs" >&2
    exit 1
  fi
  case "$APP_DIR" in
    *$'\n'*|*$'\r'*) echo "ERROR: Orc.app folder paths cannot contain line breaks" >&2; exit 1 ;;
    /*) ;;
    *) echo "ERROR: choose an absolute path for the Orc.app folder" >&2; exit 1 ;;
  esac
  if ! app_dir="$(cd "$APP_DIR" 2>/dev/null && pwd -P)" || [ ! -w "$app_dir" ]; then
    echo "ERROR: choose an existing folder where you can install Orc.app" >&2
    exit 1
  fi
  case "$app_dir/" in
    "$(cd "$ORC_HOME" && pwd -P)/"*)
      echo "ERROR: choose a folder for Orc.app outside ~/.orc" >&2; exit 1 ;;
  esac
  requested_app="${app_dir%/}/Orc.app"
  if [ "$requested_app" != "$APP_LINK" ]; then
    if [ -L "$CURRENT_LINK" ] || [ -L "$APP_LOCATION" ]; then
      echo "ERROR: Orc.app is already installed at $APP_LINK" >&2
      exit 1
    fi
    case "$(classify_app "$requested_app")" in
      absent|current) APP_LINK="$requested_app" ;;
      *) echo "ERROR: $requested_app already exists. Choose another folder." >&2; exit 1 ;;
    esac
  fi
fi

if [ "$MODE" = install ] && [ "$APP_LINK" != "$DEFAULT_APP_LINK" ]; then
  app_dir="$(dirname "$APP_LINK")"
  if [ ! -d "$app_dir" ] || [ ! -w "$app_dir" ]; then
    echo "ERROR: the Orc.app folder is unavailable or unwritable: $app_dir" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------- uninstall
if [ "$MODE" = "uninstall" ]; then
  banner
  section "Harness adapters"
  remove_managed_codex_agents
  remove_managed_opencode_files
  section "Skills"
  retire_legacy_skill_plugins

  section "Agents"
  remove_managed_claude_agents

  section "CLI"
  for b in "${BINS[@]}"; do
    link="$HOME/.local/bin/$b"
    if [ "$b" = orc-ui ]; then
      case "$(classify_launcher "$link")" in
        stable|legacy) rm "$link"; item "removed ~/.local/bin/$b" ;;
      esac
    elif [ -L "$link" ]; then
      case "$(readlink "$link")" in
        "$REPO_DIR/bin/$b"|"$ORC_HOME/dist/bin/$b"|*-worktrees/*/bin/"$b")
          rm "$link"; item "removed ~/.local/bin/$b" ;;
      esac
    fi
  done
  capture_helper="$ORC_HOME/playwright/capture.mjs"
  if [ -L "$capture_helper" ]; then
    case "$(readlink "$capture_helper")" in
      "$REPO_DIR/assets/playwright/capture.mjs"|"$ORC_HOME/dist/assets/playwright/capture.mjs")
        rm "$capture_helper"; item "removed $capture_helper" ;;
    esac
  fi
  preflight_helper="$ORC_HOME/playwright/preflight.sh"
  if [ -L "$preflight_helper" ]; then
    case "$(readlink "$preflight_helper")" in
      "$REPO_DIR/assets/playwright/preflight.sh"|"$ORC_HOME/dist/assets/playwright/preflight.sh")
        rm "$preflight_helper"; item "removed $preflight_helper" ;;
    esac
  fi
  prune_removed_bins
  remove_discord_bridge

  section "Desktop runtime"
  if [ "$(classify_app "$APP_LINK")" = current ]; then
    rm "$APP_LINK"
    item "removed $APP_LINK"
  fi
  if [ -d "$RUNTIME_HOME" ]; then
    chmod -R u+w "$RUNTIME_HOME" 2>/dev/null || true
    rm -rf "$RUNTIME_HOME"
    item "removed $RUNTIME_HOME"
  fi

  section "Hooks"
  if ! command -v python3 >/dev/null 2>&1; then
    note "python3 not found — remove any legacy Orc hook entries from Claude settings.json and ~/.codex/hooks.json by hand"
  else
    retire_claude_user_hooks
    retire_codex_user_hooks
  fi
  if [ "$(git -C "$REPO_DIR" config core.hooksPath 2>/dev/null)" = "hooks/git" ]; then
    previous_hooks="$(git -C "$REPO_DIR" config orc.previousHooksPath 2>/dev/null || true)"
    if [ -n "$previous_hooks" ] && [ "$previous_hooks" != "__unset__" ]; then
      git -C "$REPO_DIR" config core.hooksPath "$previous_hooks"
      item "restored core.hooksPath -> $previous_hooks"
    else
      git -C "$REPO_DIR" config --unset core.hooksPath
      item "unset core.hooksPath (git hooks back to .git/hooks)"
    fi
  fi
  git -C "$REPO_DIR" config --unset orc.previousHooksPath 2>/dev/null || true
  git -C "$REPO_DIR" config --remove-section merge.orc-version 2>/dev/null || true
  git -C "$REPO_DIR" config --remove-section merge.orc-changelog 2>/dev/null || true
  # never delete the dir this script is running from (zip installs run from dist)
  if [ "$REPO_DIR" = "$(cd "$ORC_HOME/dist" 2>/dev/null && pwd || true)" ]; then
    DIST_NOTE="running from $ORC_HOME/dist — finish with: rm -rf $ORC_HOME/dist"
  else
    rm -rf "$ORC_HOME/dist"
    DIST_NOTE=""
  fi

  section "Kept"
  item "yours:  $ORC_HOME/config.json + $ORC_HOME/backups + $ORC_HOME/runs"
  item "kept:   unrecognized bundles at $APP_LINK"
  item "kept:   the PATH line in your shell rc, if the installer added one"
  if [ -n "$DIST_NOTE" ]; then note "$DIST_NOTE"; fi
  rail_close
  echo
  exit 0
fi

# Running from an unzipped artifact (no git checkout)? Relocate to a permanent
# home first — symlinks into ~/Downloads die when the download is deleted.
DIST="$ORC_HOME/dist"
DIST_REAL="$(cd "$DIST" 2>/dev/null && pwd -P || echo "$DIST")"
if [ ! -e "$REPO_DIR/.git" ] && [ "$REPO_DIR" != "$DIST_REAL" ]; then
  # the relocated copy prints the banner — this is the only line before the exec
  note "artifact bundle detected — relocating to $DIST"
  rm -rf "$DIST"
  mkdir -p "$DIST"
  cp -R "$REPO_DIR"/. "$DIST/"
  exec "$DIST/install.sh" "${INSTALL_ARGS[@]}"
fi

if [ "$MODE" = install ] && [ "$source_kind" = artifact ]; then
  release_id="$(python3 - "$REPO_DIR" <<'PY'
import hashlib, os, sys
root = os.path.realpath(sys.argv[1])
digest = hashlib.sha256()
for base, dirs, files in os.walk(root):
    dirs[:] = sorted(d for d in dirs if d not in {".git", "build", "__pycache__"})
    for name in sorted(files):
        if name == ".DS_Store":
            continue
        path = os.path.join(base, name)
        rel = os.path.relpath(path, root)
        digest.update(rel.encode() + b"\0")
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
print(digest.hexdigest())
PY
)"
fi

banner

section "Preflight"
item "repo:     $REPO_DIR"
item "home:     $ORC_HOME"
if [ "${#PREFLIGHT_NOTES[@]}" -gt 0 ]; then
  for preflight_note in "${PREFLIGHT_NOTES[@]}"; do note "$preflight_note"; done
fi

mkdir -p "$ORC_HOME/runs" "$ORC_HOME/playwright"
ln -sfn "$REPO_DIR/assets/playwright/capture.mjs" "$ORC_HOME/playwright/capture.mjs"
ln -sfn "$REPO_DIR/assets/playwright/preflight.sh" "$ORC_HOME/playwright/preflight.sh"

# default config (only written if missing)
if [ ! -f "$ORC_HOME/config.json" ]; then
  cp "$REPO_DIR/config.template.json" "$ORC_HOME/config.json"
  item "wrote $ORC_HOME/config.json (from config.template.json)"
fi

# A release is keyed on the commit, but the app bundle inside it depends on far
# fewer bytes than a commit touches — so an ordinary commit used to spend 3.4s
# in `swiftc -O` rebuilding a byte-identical app. Key the bundle on its own
# sources instead. The cache lives in the mutable $RUNTIME_HOME, never inside a
# release, which is sealed read-only.
APP_CACHE_DIR="$RUNTIME_HOME/appcache"
APP_SOURCE_FILES=(app/main.swift app/Info.plist app/build.sh assets/orc-desktop-icon-1024.png)

app_cache_key() {
  local root="$1" rel manifest key
  manifest="$(mktemp)"
  for rel in "${APP_SOURCE_FILES[@]}"; do
    if [ -f "$root/$rel" ]; then
      printf '%s %s\n' "$rel" "$(file_sha256 "$root/$rel")" >>"$manifest"
    else
      printf '%s absent\n' "$rel" >>"$manifest"
    fi
  done
  key="$(file_sha256 "$manifest")"
  rm -f "$manifest"
  printf '%s\n' "$key"
}

# `cp -Rc` clones on APFS, which makes copying a bundle nearly free; -c does not
# exist elsewhere, so fall back to a plain recursive copy from a clean slate.
copy_tree() {
  cp -Rc "$1" "$2" 2>/dev/null && return 0
  rm -rf "$2"
  cp -R "$1" "$2"
}

prepare_runtime_release() {
  release="$RELEASES_DIR/$release_id"
  if [ -d "$release" ]; then
    [ -x "$release/bin/orc-ui" ] && [ -f "$release/ui/serve.py" ] || {
      echo "ERROR: existing runtime release is incomplete: $release" >&2
      return 1
    }
    RUNTIME_RELEASE="$release"
    return 0
  fi

  mkdir -p "$RELEASES_DIR"
  stage="$RELEASES_DIR/.staging-$release_id-$$"
  rm -rf "$stage"
  mkdir -p "$stage"
  if [ "$source_kind" = git ]; then
    git -C "$REPO_DIR" archive "$release_id" | LC_ALL=C tar -x -C "$stage"
  else
    cp -R "$REPO_DIR"/. "$stage/"
    rm -rf "$stage/app/build"
  fi
  [ -x "$stage/bin/orc-ui" ] || { echo "ERROR: staged runtime has no executable bin/orc-ui" >&2; return 1; }
  [ -f "$stage/ui/serve.py" ] || { echo "ERROR: staged runtime has no ui/serve.py" >&2; return 1; }
  bash -n "$stage/bin/orc-ui"
  python3 -m py_compile "$stage/ui/serve.py"
  rm -rf "$stage/ui/__pycache__"

  if [ "$(uname)" = Darwin ]; then
    app_key="$(app_cache_key "$stage")"
    cached_app="$APP_CACHE_DIR/$app_key/Orc.app"
    if [ -x "$cached_app/Contents/MacOS/Orc" ]; then
      copy_tree "$cached_app" "$stage/Orc.app"
      item "reused cached Orc.app build"
    else
      command -v swiftc >/dev/null 2>&1 || {
        echo "ERROR: Xcode Command Line Tools are required to promote Orc.app" >&2
        return 1
      }
      build_app "$stage/Orc.app" "$stage/app/build.sh"
    fi
    # Runs on both paths, so a corrupt cache entry fails the install rather than
    # promoting a broken bundle.
    [ -x "$stage/Orc.app/Contents/MacOS/Orc" ] || {
      echo "ERROR: staged Orc.app failed preflight" >&2
      return 1
    }
    if [ ! -x "$cached_app/Contents/MacOS/Orc" ]; then
      mkdir -p "$APP_CACHE_DIR/$app_key"
      copy_tree "$stage/Orc.app" "$APP_CACHE_DIR/$app_key/.new.$$"
      mv "$APP_CACHE_DIR/$app_key/.new.$$" "$cached_app" 2>/dev/null \
        || rm -rf "$APP_CACHE_DIR/$app_key/.new.$$"
    fi
    rm -rf "$stage/app/build"
  fi

  if ! mv "$stage" "$release" 2>/dev/null; then
    rm -rf "$stage"
    [ -d "$release" ] || return 1
  fi
  chmod -R a-w "$release"
  RUNTIME_RELEASE="$release"
}

prepare_runtime_release

section "Skills"
item_wrap "library:  " "$CURRENT_LINK/skills"

section "Agents"
remove_managed_claude_agents

section "Harness adapters"
remove_managed_codex_agents
remove_managed_opencode_files
item "retired legacy user-scope agent adapters"

# Remember viewer state before switching current. Installation must not start
# a viewer the user deliberately stopped.
UI_WAS_RUNNING=false
if [ -x "$LAUNCHER_PATH" ] \
   && "$LAUNCHER_PATH" status >/dev/null 2>&1; then
  UI_WAS_RUNNING=true
fi

section "CLI"
mkdir -p "$HOME/.local/bin"
# Non-desktop commands remain live development links. orc-ui is different: a
# stable launcher always resolves the atomically selected immutable runtime.
cli_linked=0
for b in "${BINS[@]}"; do
  if [ "$b" = orc-ui ]; then continue; fi
  ln -sfn "$REPO_DIR/bin/$b" "$HOME/.local/bin/$b"
  cli_linked=$((cli_linked + 1))
done
item "linked:   $cli_linked + orc-ui stable launcher -> ~/.local/bin"
item_wrap "commands: " "${BINS[*]}"
prune_removed_bins
remove_discord_bridge

# A release that cannot serve is refused before anything switches to it, so
# the viewer keeps running the current release. Releases older than the
# check have no release_health.py and skip it.
RELEASE_HEALTH="$RUNTIME_RELEASE/ui/release_health.py"
[ -f "$RELEASE_HEALTH" ] || RELEASE_HEALTH=""
if [ -n "$RELEASE_HEALTH" ]; then
  section "Health"
  python3 "$RELEASE_HEALTH" --release "$RUNTIME_RELEASE" | rail_pipe
fi

PROMOTION_TXN="$RUNTIME_HOME/.transaction-$$"
mkdir -p "$PROMOTION_TXN"
if [ -L "$CURRENT_LINK" ]; then
  OLD_CURRENT_TARGET="$(readlink "$CURRENT_LINK")"
elif [ -e "$CURRENT_LINK" ]; then
  echo "ERROR: $CURRENT_LINK exists but is not an Orc-owned symlink" >&2
  exit 1
fi

launcher="$LAUNCHER_PATH"
launcher_is_stable=false
launcher_needs_backup=false
case "$(classify_launcher "$launcher")" in
  stable) launcher_is_stable=true ;;
  legacy) launcher_needs_backup=true ;;
  unrecognized) echo "ERROR: refusing to replace unrecognized $launcher" >&2; exit 1 ;;
esac

install_app=false
app_needs_backup=false
if [ -d "$RUNTIME_RELEASE/Orc.app" ]; then
  install_app=true
  case "$(classify_app "$APP_LINK")" in
    current|absent) ;;
    legacy)
      if [ "$APP_LINK" != "$DEFAULT_APP_LINK" ]; then
        echo "ERROR: refusing to replace $APP_LINK" >&2; exit 1
      fi
      app_needs_backup=true ;;
    unrecognized) echo "ERROR: refusing to replace unrecognized $APP_LINK" >&2; exit 1 ;;
  esac
fi

for state in version.json update.json; do
  if [ -f "$RUNTIME_HOME/$state" ]; then
    cp "$RUNTIME_HOME/$state" "$PROMOTION_TXN/$state"
  fi
done
PROMOTION_ACTIVE=true
if [ "$install_app" = true ] && [ "$APP_LINK" = "$DEFAULT_APP_LINK" ]; then
  mkdir -p "$(dirname "$APP_LINK")"
fi
# Legacy launchers cannot prove ownership using the new owner file. Stop the
# already-recognized legacy process while its original launcher still exists;
# rollback restarts it if any later mutation fails.
if [ "$launcher_needs_backup" = true ] && [ "$UI_WAS_RUNNING" = true ]; then
  "$launcher" stop
fi
if [ "$launcher_needs_backup" = true ]; then
  mv "$launcher" "$PROMOTION_TXN/orc-ui"
  LAUNCHER_BACKED_UP=true
fi
if [ "$app_needs_backup" = true ]; then
  mv "$APP_LINK" "$PROMOTION_TXN/Orc.app"
  APP_BACKED_UP=true
fi

if [ "$launcher_is_stable" = false ]; then
  launcher_tmp="$launcher.new.$$"
  cat >"$launcher_tmp" <<'SH'
#!/bin/sh
# Orc stable runtime launcher
exec "$HOME/.orc/runtime/current/bin/orc-ui" "$@"
SH
  chmod +x "$launcher_tmp"
  mv -f "$launcher_tmp" "$launcher"
  [ "$LAUNCHER_BACKED_UP" = true ] || LAUNCHER_CREATED=true
fi
if [ "$install_app" = true ] && [ "$(classify_app "$APP_LINK")" != current ]; then
  create_symlink "$CURRENT_LINK/Orc.app" "$APP_LINK"
  [ "$APP_BACKED_UP" = true ] || APP_CREATED=true
fi
if [ "$install_app" = true ] && [ "$APP_LINK" != "$DEFAULT_APP_LINK" ] && [ ! -L "$APP_LOCATION" ]; then
  create_symlink "$APP_LINK" "$APP_LOCATION"
  APP_LOCATION_CREATED=true
fi

ln -s "$RUNTIME_RELEASE" "$CURRENT_LINK.new.$$"
atomic_replace "$CURRENT_LINK.new.$$" "$CURRENT_LINK"

# A restarted viewer can retry immediately. Retire the previous source before
# reconciliation, while both metadata files are still rollback-protected.
installed_args=()
if [ "$source_kind" = git ]; then
  python3 "$RUNTIME_RELEASE/bin/orc-version-json" "$REPO_DIR" "$release_id" "$RUNTIME_HOME/version.json" || true
else
  rm -f "$RUNTIME_HOME/version.json"
  installed_args=(--artifact)
fi
if [ -f "$RUNTIME_RELEASE/ui/runtime_updates.py" ]; then
  python3 "$RUNTIME_RELEASE/ui/runtime_updates.py" installed --repo "$REPO_DIR" --commit "$release_id" ${installed_args[@]+"${installed_args[@]}"}
fi

if [ "${ORC_TEST_FAIL_PROMOTION_AFTER_SWITCH:-false}" = true ]; then
  false
fi
# The launcher's own stop/start lines are user-facing, so they sit against the
# rail like every other railed subprocess. pipefail keeps the launcher's failure
# as the pipeline's status.
if ! "$launcher" _reconcile-installed "$UI_WAS_RUNNING" | rail_pipe; then
  echo "ERROR: promoted runtime could not reconcile the default viewer" >&2
  false
fi
PROMOTED_UI_RECONCILED=true
if [ "${ORC_TEST_FAIL_PROMOTION_AFTER_RECONCILE:-false}" = true ]; then
  false
fi
# The restarted viewer runs on the user's own runs, which the empty-home boot
# above never saw. If it stops answering, the ERR trap restores the previous
# release and restarts the viewer on it.
if [ -n "$RELEASE_HEALTH" ] && [ "$UI_WAS_RUNNING" = true ]; then
  python3 "$RELEASE_HEALTH" --viewer "http://127.0.0.1:${ORC_UI_PORT:-${ORC_UI_DEFAULT_PORT:-4173}}/" | rail_pipe
fi
section "Desktop runtime"
item "promoted release $release_id"

PATH_NOTE=""
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *)
    PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
    case "$(basename "${SHELL:-}")" in
      zsh)  RC="$HOME/.zshrc" ;;
      bash) RC="$HOME/.bashrc" ;;
      *)    RC="" ;;
    esac
    if [ -n "$RC" ]; then
      if ! grep -qsF "$PATH_LINE" "$RC"; then
        printf '\n%s\n' "$PATH_LINE" >>"$RC"
        item "added ~/.local/bin to PATH in $RC"
      fi
      PATH_NOTE="restart your shell (or: source $RC) to pick up the PATH change"
    else
      warn "unrecognized shell — add ~/.local/bin to PATH yourself, e.g.:  $PATH_LINE"
      PATH_NOTE="add ~/.local/bin to your PATH (see WARNING above)"
    fi
    ;;
esac

APP_STATUS="n/a (not macOS)"
if [ -n "${WSL_DISTRO_NAME:-}" ]; then APP_STATUS="Windows desktop with WSL runtime $release_id"; fi
if [ "$(uname)" = "Darwin" ]; then
  rm -rf "$ORC_HOME/orc.app" "$ORC_HOME/notify.txt"   # retire the old applet
  APP_STATUS="ok — Orc.app -> immutable runtime $release_id"
fi

# Git lifecycle hooks: post-commit/pull/checkout/rebase rerun this installer
# when its owned files or skill folders change; pre-push guards VERSION on main.
section "Hooks"
if [ -e "$REPO_DIR/.git" ]; then
  chmod +x "$REPO_DIR/hooks/git/"*
  current_hooks="$(git -C "$REPO_DIR" config core.hooksPath 2>/dev/null || true)"
  if [ "$current_hooks" != "hooks/git" ] \
      && ! git -C "$REPO_DIR" config --get orc.previousHooksPath >/dev/null 2>&1; then
    git -C "$REPO_DIR" config orc.previousHooksPath "${current_hooks:-__unset__}"
    if [ -n "$current_hooks" ]; then
      note "replacing core.hooksPath=$current_hooks while Orc is installed (restored on uninstall)"
    fi
  fi
  git -C "$REPO_DIR" config core.hooksPath hooks/git
  # .gitattributes routes VERSION and CHANGELOG.md here, so a pull that meets
  # another machine's release merges without hand resolution. Git runs merge
  # drivers from the top of the work tree.
  git -C "$REPO_DIR" config merge.orc-version.name "Orc VERSION: newer of both sides, plus one patch"
  git -C "$REPO_DIR" config merge.orc-version.driver "python3 ui/release_version.py merge-version %O %A %B"
  git -C "$REPO_DIR" config merge.orc-changelog.name "Orc CHANGELOG.md: keep both sides' releases"
  git -C "$REPO_DIR" config merge.orc-changelog.driver "python3 ui/release_version.py merge-changelog %O %A %B"
  item_wrap "git:      " "hooks/git · reruns install.sh on commit/pull/checkout/rebase; main pushes must raise VERSION"
fi

# Per-turn Claude guards (bin/orc-hook-policy worktree + hooks/aws-allowlist.py)
# are passed by Orc via --settings; legacy user-scope hooks and skill plugins
# retire after promotion commits so a rolled-back upgrade preserves the
# previous release's registrations.
if [ -f "$REPO_DIR/hooks/aws-allowlist.py" ]; then
  chmod +x "$REPO_DIR/hooks/aws-allowlist.py"
fi
item "guards:   Claude PreToolUse passed per turn by Orc"

section "Summary"
item_wrap "version:  " "$release_version"
item_wrap "skills:   " "$CURRENT_LINK/skills (served by Orc)"
item "agents:   retired Orc-managed native definitions"
item "cli:      ${#BINS[@]} commands -> ~/.local/bin"
item "config:   $ORC_HOME/config.json"
item_wrap "app:      " "$APP_STATUS"
if [ -n "$PATH_NOTE" ]; then note "$PATH_NOTE"; fi

section "Next steps"
if [ -n "${WSL_DISTRO_NAME:-}" ]; then
  item 'start:    open Orc from Windows Start (or: orc-ui open)'
else
  item 'start:    open Orc.app (or: orc-ui open)'
fi
if [ "$RUN_HEALTH_CHECKS" = true ]; then
  print_integration_setup
fi

if [ "$PLUGIN_CHOICES_SET" = true ]; then
  "$CURRENT_LINK/bin/orc-app-plugin" setup --plugins "$PLUGIN_CHOICES" | rail_pipe
elif [ -n "${OLD_CURRENT_TARGET:-}" ] && [ ! -f "$ORC_HOME/app-plugins.json" ]; then
  python3 - "$CURRENT_LINK" <<'PY' | rail_pipe
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / 'ui'))
from app_plugins import Registry
registry = Registry()
policy = getattr(registry, '_policy', None)
excluded = policy.exclude_unseen(registry) if policy and hasattr(policy, 'exclude_unseen') else set()
registry.setup([item for item, (_, data) in registry.catalog().items()
                if item not in excluded
                or data.get('adoptOnUpgrade')
                or 'theme' in data.get('contributes', {})])
print('Preserved previously available application plugins; manage them in Settings.')
PY
fi
if [ -f "$ORC_HOME/app-plugins.json" ]; then
  python3 - "$CURRENT_LINK" <<'PY' | rail_pipe
import sys
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1]) / 'ui'))
from app_plugins import Registry
registry = Registry()
registry.adopt_upgrades()
for line in registry.refresh_from_release():
    print(line)
registry.reconcile_links()
PY
  # -B: bytecode in the sealed release would make the registry refuse the radio
  # package. A failed download never fails the install; the radio retries it.
  python3 -B - "$CURRENT_LINK" "$HOME" <<'PY' | rail_pipe || true
import sys
from pathlib import Path
release = Path(sys.argv[1])
sys.path[:0] = [str(release / 'ui'), str(release)]
try:
    from app_plugins import Registry, load_package_module
    registry = Registry()
    row = next((row for row in registry.list()['plugins']
                if row['id'] == 'radio' and row['enabled'] and not row['error']), None)
    line = None
    if row:
        module = load_package_module('orc_radio_install', Path(row['root']), 'radio_mirror.py')
        line = module.install_step(registry, sys.argv[2])
except Exception as error:
    line = 'Radio music did not download: %s' % error
if line:
    print(line)
PY
  setup_plugins
fi
if [ "$LAUNCHER_BACKED_UP" = true ] || [ "$APP_BACKED_UP" = true ]; then
  migration_backup="$ORC_HOME/backups/runtime-migration-$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$(dirname "$migration_backup")"
  mv "$PROMOTION_TXN" "$migration_backup"
  note "backed up legacy desktop entries -> $migration_backup"
else
  rm -rf "$PROMOTION_TXN"
fi
PROMOTION_ACTIVE=false
MCP_RETIREMENT="$RUNTIME_RELEASE/ui/retire_mcp.py"
if [ -f "$MCP_RETIREMENT" ]; then
  python3 -I -B "$MCP_RETIREMENT" --source "$REPO_DIR" | rail_pipe \
    || warn "could not clean up all old Orc MCP registrations; rerun install.sh to retry"
fi
if [ -f "$ORC_HOME/tailscale.json" ] && [ -f "$RUNTIME_RELEASE/app-plugins/tailscale/tailscale_access.py" ]; then
  python3 -I -B "$RUNTIME_RELEASE/app-plugins/tailscale/tailscale_access.py" "$ORC_HOME" | rail_pipe \
    || warn "could not retire the old Orc MCP route; reconnect Tailscale and rerun install.sh to retry"
fi
retire_legacy_skill_plugins || warn "could not clean up all legacy skill plugins"
retire_claude_user_hooks || warn "could not clean up all legacy Claude hooks"
retire_codex_user_hooks || warn "could not clean up all legacy Codex hooks"
# Every install seals a new release and nothing else removes one. Pruning runs
# only once the promotion has committed, still under the install lock, and
# never fails the install. macOS only: ~/.Trash is the Bin there.
if [ "$(uname)" = Darwin ] && [ -x "$REPO_DIR/bin/orc-prune-releases" ]; then
  python3 "$REPO_DIR/bin/orc-prune-releases" --orc-home "$ORC_HOME" 2>&1 | rail_pipe || true
fi
if [ "$install_app" = true ] && [ "$(uname)" = Darwin ]; then
  # Automatic installs replace Orc.app only when its binary changed. A hand-run
  # install always quits it and opens the release it just promoted.
  app_update_args=(--restart)
  if [ -n "$AUTOMATIC_INSTALL" ]; then app_update_args=(); fi
  if ! python3 "$REPO_DIR/ui/native_app_update.py" "$RUNTIME_HOME" ${app_update_args[@]+"${app_update_args[@]}"} | rail_pipe; then
    warn "Desktop update needs a restart: quit Orc.app and reopen $APP_LINK"
  fi
fi
rail_close
echo
