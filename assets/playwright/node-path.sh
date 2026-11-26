# assets/playwright/node-path.sh — sourced by bin/orc-shot, bin/orc-webkit,
# bin/orc-demo and bin/test so every Node entry point finds the checkout and
# @playwright/test the same way.
#
# orc_current_checkout <file> <own root>
#   Prints the checkout to run <file> from. A command on PATH links to the main
#   checkout, whose code is not what an agent in a worktree is looking at, so
#   the current checkout wins when it has the file. Returns 1 when neither does.
#
# orc_playwright_node_path <checkout> <fallback-preflight>
#   When @playwright/test does not resolve from <checkout> (a worktree has no
#   node_modules, and the main checkout's can hold links into a removed
#   worktree), readies the shared capture harness and puts its node_modules
#   first on NODE_PATH. Returns 1 with the reason in ORC_PLAYWRIGHT_ERROR when
#   the harness cannot be readied.

orc_current_checkout() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$root" && -f "$root/$1" ]] || root="$2"
  [[ -f "$root/$1" ]] || return 1
  printf '%s\n' "$root"
}

orc_playwright_node_path() {
  ORC_PLAYWRIGHT_ERROR=""
  if (cd "$1" && node -e "require.resolve('@playwright/test')") 2>/dev/null; then
    return 0
  fi
  local harness="${ORC_HOME:-$HOME/.orc}/playwright"
  local preflight="$harness/preflight.sh"
  local result
  [ -x "$preflight" ] || preflight="$2"
  if ! result="$("$preflight" 2>&1)"; then
    ORC_PLAYWRIGHT_ERROR="${result##*$'\n'}"
    return 1
  fi
  export NODE_PATH="$harness/node_modules${NODE_PATH:+:$NODE_PATH}"
}
