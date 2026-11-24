#!/bin/sh
# assets/playwright/preflight.sh — sole authority on shared Playwright
# capture-harness readiness (see skills/_shared/screenshot.md).
#
# Usage:
#   preflight.sh              check/repair the shared harness only
#   preflight.sh <shots-dir>  also wire <shots-dir> for a Playwright spec run
#
# Output contract: exactly one line, nothing else on success.
#   PREFLIGHT_OK <version>     (exit 0)
#   PREFLIGHT_FAIL <reason>    (exit 1)

set -eu

ORC_HOME="${ORC_HOME:-$HOME/.orc}"
HARNESS="$ORC_HOME/playwright"

fail() {
  printf 'PREFLIGHT_FAIL %s\n' "$1"
  exit 1
}

# Resolve this script's real location so a repaired harness always links back
# to this repo checkout's capture.mjs, even when invoked through the
# installed ~/.orc/playwright/preflight.sh symlink.
self="$0"
case "$self" in
  /*) : ;;
  *) self="$PWD/$self" ;;
esac
# Bounded so a hand-made symlink cycle fails the contract instead of hanging.
hops=0
while [ -L "$self" ]; do
  hops=$((hops + 1))
  [ "$hops" -le 40 ] || fail "symlink loop resolving $0"
  link="$(readlink "$self")" || fail "cannot read symlink $self"
  case "$link" in
    /*) self="$link" ;;
    *) self="$(dirname "$self")/$link" ;;
  esac
done
script_dir="$(cd "$(dirname "$self")" && pwd -P)" || fail "cannot resolve script directory for $self"
repo_capture="$script_dir/capture.mjs"

[ -f "$repo_capture" ] || fail "repo capture.mjs not found next to preflight.sh ($repo_capture)"

mkdir -p "$HARNESS" 2>/dev/null || fail "cannot create $HARNESS"

# Keep the harness's capture.mjs symlink pointed at this repo checkout.
if [ ! -L "$HARNESS/capture.mjs" ] || [ "$(readlink "$HARNESS/capture.mjs")" != "$repo_capture" ]; then
  ln -sfn "$repo_capture" "$HARNESS/capture.mjs" 2>/dev/null || fail "cannot link $HARNESS/capture.mjs"
fi

playwright_bin="$HARNESS/node_modules/.bin/playwright"
log="$(mktemp 2>/dev/null || echo "/tmp/orc-preflight.$$")"
trap 'rm -f "$log"' EXIT

version=""
if [ -x "$playwright_bin" ]; then
  version="$("$playwright_bin" --version 2>"$log" | sed -n 's/^Version //p')"
fi

if [ -z "$version" ]; then
  # Missing or broken — repair without touching anything that already works.
  command -v npm >/dev/null 2>&1 || fail "npm not found; cannot install the harness"
  if [ ! -f "$HARNESS/package.json" ]; then
    (cd "$HARNESS" && npm init -y) >"$log" 2>&1 || fail "npm init failed: $(tail -n 1 "$log")"
  fi
  (cd "$HARNESS" && npm install --no-fund --no-audit -D @playwright/test) >"$log" 2>&1 \
    || fail "npm install @playwright/test failed: $(tail -n 1 "$log")"
  (cd "$HARNESS" && npx --yes playwright install chromium) >"$log" 2>&1 \
    || fail "playwright install chromium failed: $(tail -n 1 "$log")"
  [ -x "$playwright_bin" ] || fail "playwright binary still missing after install"
  version="$("$playwright_bin" --version 2>"$log" | sed -n 's/^Version //p')"
  [ -n "$version" ] || fail "playwright --version produced no output after install"
fi

if [ "$#" -ge 1 ]; then
  shots_dir="$1"
  mkdir -p "$shots_dir" 2>/dev/null || fail "cannot create $shots_dir"
  ln -sfn "$HARNESS/node_modules" "$shots_dir/node_modules" 2>/dev/null \
    || fail "cannot link node_modules into $shots_dir"
  ln -sfn "$HARNESS/capture.mjs" "$shots_dir/capture.mjs" 2>/dev/null \
    || fail "cannot link capture.mjs into $shots_dir"
  printf '{"type":"module"}\n' > "$shots_dir/package.json" 2>/dev/null \
    || fail "cannot write $shots_dir/package.json"
fi

printf 'PREFLIGHT_OK %s\n' "$version"
