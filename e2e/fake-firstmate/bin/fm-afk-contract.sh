#!/usr/bin/env bash
# The fake Firstmate's away record (build spec §9): logs its call; `field <name>` prints fixtures/afk-<name>.
set -u
printf 'fm-afk-contract.sh %s\n' "$*" >> "$FM_HOME/state/calls.log"
[ "${1:-}" = field ] || exit 2
cat "$FM_HOME/fixtures/afk-$2" 2>/dev/null || exit 1
