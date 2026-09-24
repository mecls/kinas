#!/usr/bin/env bash
# The fake Firstmate's project mode (build spec §9): logs its call, then prints fixtures/mode-<name>, or the registry's
# own fallback, "no-mistakes off".
set -u
printf 'fm-project-mode.sh %s\n' "$*" >> "$FM_HOME/state/calls.log"
cat "$FM_HOME/fixtures/mode-$1" 2>/dev/null || echo "no-mistakes off"
