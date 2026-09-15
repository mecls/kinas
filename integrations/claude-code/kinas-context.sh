#!/bin/sh
# kinas-context — a Claude Code SessionStart hook. For a session started inside the Kinas projects root it prints
# `kinas context --agent`, and Claude Code adds that to the session's context, so the session starts knowing which
# projects exist, what the crew is doing, what is blocked, and which conventions apply. Outside the root it prints
# nothing. It never fails the session: a missing or broken kinas prints nothing.
#
# Install (see integrations/README.md): in ~/.claude/settings.json, under "hooks":
#
#   "SessionStart": [{ "matcher": "startup|resume|clear|compact",
#                      "hooks": [{ "type": "command", "command": "sh /path/to/kinas-context.sh", "timeout": 30 }] }]

cat >/dev/null 2>&1   # the hook's JSON input is not needed: Claude Code sets CLAUDE_PROJECT_DIR

kinas_bin=${KINAS_BIN:-$(command -v kinas 2>/dev/null || printf '%s' "$HOME/.local/bin/kinas")}
[ -x "$kinas_bin" ] || exit 0

"$kinas_bin" context --agent --cwd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null
exit 0
