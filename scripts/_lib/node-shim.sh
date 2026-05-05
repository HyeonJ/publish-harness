#!/usr/bin/env bash
# Provide a `node` command in Windows bash environments where only node.exe is
# visible on PATH. Keep this shell-only so existing Node scripts stay unchanged.

if ! command -v node >/dev/null 2>&1 && [ -x "${HOME}/.local/bin/node" ]; then
  node() {
    "${HOME}/.local/bin/node" "$@"
  }
  export -f node
elif ! command -v node >/dev/null 2>&1 && command -v node.exe >/dev/null 2>&1; then
  node() {
    node.exe "$@"
  }
  export -f node
fi
