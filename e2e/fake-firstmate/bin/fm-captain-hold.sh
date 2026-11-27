#!/usr/bin/env bash
# The fake Firstmate's captain hold, for Kinas's VPS specs (build spec §12 slice 6.3; ADR 0033). It logs its argv as one
# line to state/calls.log and answers `open <task> --distinguish-absent` only, with the exit a spec leaves in
# fixtures/hold-open-exit: 0 (open) unless it says 1 (not open), 2 (can't tell) or 3 (no such task).
set -u
printf 'fm-captain-hold.sh %s\n' "$*" >> "$FM_HOME/state/calls.log"
if [ "${1:-}" != "open" ] || [ -z "${2:-}" ] || [ "${3:-}" != "--distinguish-absent" ]; then
  echo "fm-captain-hold.sh: the fake answers open <task> --distinguish-absent only" >&2
  exit 2
fi
code=0
[ -f "$FM_HOME/fixtures/hold-open-exit" ] && code=$(tr -dc '0-9' < "$FM_HOME/fixtures/hold-open-exit")
exit "${code:-0}"
