# assets/playwright/node-path.sh — sourced by bin/orc-shot, bin/orc-demo and
# bin/test so every Node entry point finds @playwright/test the same way.
#
# orc_playwright_node_path <checkout> <fallback-preflight>
#   When @playwright/test does not resolve from <checkout> (a worktree has no
#   node_modules, and the main checkout's can hold links into a removed
#   worktree), readies the shared capture harness and puts its node_modules
#   first on NODE_PATH. Returns 1 with the reason in ORC_PLAYWRIGHT_ERROR when
#   the harness cannot be readied.

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
