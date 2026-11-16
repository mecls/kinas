#!/usr/bin/env bash
# The fake Firstmate's lane capacity, for Kinas's crew specs (Firstmate, current; build spec §11.4). It logs its own argv
# as one line to state/calls.log, so a spec can prove whether Kinas ran it, then prints the document the spec left in
# fixtures/capacity.json — none until a spec puts one there — and exits 0.
set -u
printf 'fm-capacity.sh %s\n' "$*" >> "$FM_HOME/state/calls.log"
if [ -f "$FM_HOME/fixtures/capacity.json" ]; then
  cat "$FM_HOME/fixtures/capacity.json"
fi
exit 0
