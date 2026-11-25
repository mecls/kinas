#!/bin/sh
# kinas-context — a Claude Code SessionStart hook, the same on the Mac and on the Linux machine (PRD rule 9). For a
# session started inside the Kinas projects root it prints `kinas context --agent`, and Claude Code adds that to the
# session's context, so the session starts knowing which projects exist, what the crew is doing, what is blocked, and
# which conventions apply. Outside the root it prints nothing. It never fails the session: a missing or broken kinas
# prints nothing.
#
# Hooks run outside the sandbox, so (the captain's rule, 2026-11-25):
# - in a worker (FM_TASK_ID set) it exits at once, before it reads anything;
# - its input is data only. The hook's JSON is read and dropped. The project folder reaches kinas as one argument,
#   and must be an absolute path. Nothing is ever run through the shell: no eval, no command built from the input.
#
# Install (see integrations/README.md): in ~/.claude/settings.json, under "hooks":
#
#   "SessionStart": [{ "matcher": "startup|resume|clear|compact",
#                      "hooks": [{ "type": "command", "command": "sh /path/to/kinas-context.sh", "timeout": 30 }] }]

[ -n "${FM_TASK_ID-}" ] && exit 0

cat >/dev/null 2>&1   # the hook's JSON input is not needed: Claude Code sets CLAUDE_PROJECT_DIR

dir=${CLAUDE_PROJECT_DIR:-$PWD}
case $dir in
  /*) ;;
  *) exit 0 ;;
esac

kinas_bin=${KINAS_BIN:-$(command -v kinas 2>/dev/null || printf '%s' "$HOME/.local/bin/kinas")}

[ -x "$kinas_bin" ] || exit 0

"$kinas_bin" context --agent --cwd "$dir" 2>/dev/null
exit 0
