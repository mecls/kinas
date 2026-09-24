#!/usr/bin/env bash
# The fake Firstmate's fleet snapshot, for Kinas's crew specs (build spec §9, §13). It logs its own argv as one line
# to state/calls.log — every stub here does, so a spec can prove which scripts ran and that no other did — then prints
# the snapshot the spec left in fixtures/snapshot.json and exits with fixtures/snapshot-exit (0 when absent).
set -u
printf 'fm-fleet-snapshot.sh %s\n' "$*" >> "$FM_HOME/state/calls.log"
cat "$FM_HOME/fixtures/snapshot.json"
code=0
if [ -f "$FM_HOME/fixtures/snapshot-exit" ]; then
  code=$(cat "$FM_HOME/fixtures/snapshot-exit")
fi
exit "$code"
