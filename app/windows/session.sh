#!/usr/bin/env bash
set -e
export PATH="$HOME/.local/bin:$HOME/.volta/bin:$HOME/.local/share/pnpm:$HOME/.local/share/mise/shims:$PATH"
# WSL launches a GUI command without the interactive shell that selects Node.
if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi
exec "$@"
