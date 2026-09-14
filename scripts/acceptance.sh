#!/bin/bash
# Build spec §13 checks that need the real, installed app: AC-5, AC-6, AC-9, AC-10, AC-11, AC-12.
# Run after `bun run build` and copying Kinas.app to /Applications. Prints PASS/FAIL per check and the output
# that proves it; exits 1 if any check failed.
#
#   scripts/acceptance.sh            everything
#   scripts/acceptance.sh ac10 ac9   only some

set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"
APP=/Applications/Kinas.app
BIN="$APP/Contents/MacOS/Kinas"
DATA="$HOME/Library/Application Support/ai.sintralabs.kinas"
DB="$DATA/kinas.sqlite"
LOGS="$HOME/Library/Logs/ai.sintralabs.kinas"
KINAS="$HOME/.local/bin/kinas"
FAILED=0
ONLY=("$@")

want() { [ ${#ONLY[@]} -eq 0 ] && return 0; for o in "${ONLY[@]}"; do [ "$o" = "$1" ] && return 0; done; return 1; }
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILED=1; }
section() { echo; echo "== $*"; }

app_running() { pgrep -f "$BIN" >/dev/null; }
quit_app() { osascript -e 'tell application "Kinas" to quit' >/dev/null 2>&1; for _ in $(seq 20); do app_running || return 0; sleep 0.5; done; pkill -f "$BIN"; sleep 1; }
start_app() { app_running || open "$APP"; for _ in $(seq 60); do [ -f "$DB" ] && app_running && return 0; sleep 1; done; return 1; }

# Lisbon dates of the three days before today (today keeps changing while Claude Code runs).
past_dates() { for d in 1 2 3; do TZ=Europe/Lisbon date -v-${d}d +%Y-%m-%d; done | sort | paste -sd, -; }

if want ac10; then
  section "AC-10 — nothing leaks, nothing ships that shouldn't"
  hits=$(git grep -i -n -E "${KINAS_PRIVATE_NAMES:?set KINAS_PRIVATE_NAMES to the names that must never be committed}" -- ':!tasks' || true)
  [ -z "$hits" ] && pass "no private names in the repository (planning documents are kept outside git)" || fail "private names found:$hits"
  hits=$(git grep -n -E 'Claude Code-credentials|api\.anthropic\.com' -- ':!tasks' || true)
  [ -z "$hits" ] && pass "no Claude credential or Anthropic API references" || fail "found: $hits"
  if [ -x "$BIN" ]; then
    n=$(strings "$BIN" | grep -c -E 'wdio|__kinasTest' || true)
    [ "$n" = "0" ] && pass "release binary has no wdio or __kinasTest strings" || fail "release binary contains $n test-hook strings"
  else
    fail "$BIN not installed"
  fi
  leaks=0
  for f in "$DB"* "$LOGS"/*; do [ -f "$f" ] || continue; c=$(grep -a -c 'sk-ant-' "$f" || true); [ "$c" = "0" ] || { echo "      $f: $c"; leaks=1; }; done
  [ $leaks -eq 0 ] && pass "no sk-ant- in the store or the logs" || fail "sk-ant- found (above)"
fi

if want ac9; then
  section "AC-9 — the CLI, including failure exits"
  start_app || fail "app did not start"
  target=$(readlink "$KINAS" 2>/dev/null || true)
  case "$target" in "$APP/Contents/MacOS/"*) pass "$KINAS → $target" ;; *) fail "$KINAS → '${target}'" ;; esac
  "$KINAS" status >/tmp/kinas-ac9.txt 2>&1; code=$?
  [ $code -eq 0 ] && pass "kinas status exits 0" || fail "kinas status exited $code"
  sed 's/^/      /' /tmp/kinas-ac9.txt
  empty=$(mktemp -d); KINAS_DATA_DIR="$empty" "$KINAS" status >/dev/null 2>&1; code=$?
  [ $code -eq 2 ] && pass "missing store exits 2" || fail "missing store exited $code"
  newer=$(mktemp -d); sqlite3 "$DB" ".backup '$newer/kinas.sqlite'" && sqlite3 "$newer/kinas.sqlite" "INSERT INTO schema_migrations VALUES (99, 0)"
  KINAS_DATA_DIR="$newer" "$KINAS" status >/dev/null 2>&1; code=$?
  [ $code -eq 3 ] && pass "newer schema exits 3" || fail "newer schema exited $code"
  n=$("$KINAS" status --json | grep -c -E 'sk-ant-|Bearer' || true)
  [ "$n" = "0" ] && pass "--json carries no secrets" || fail "--json matched $n secret-shaped strings"
  quit_app
  "$KINAS" status >/dev/null 2>&1; code=$?
  [ $code -eq 0 ] && pass "kinas status exits 0 with the app quit" || fail "with the app quit it exited $code"
fi

if want ac12; then
  section "AC-12 — real side effects on this Mac"
  start_app || fail "app did not start"
  sleep 5
  ls "$HOME/Library/LaunchAgents" 2>/dev/null | grep -i kinas >/dev/null && pass "launch at login: $(ls "$HOME/Library/LaunchAgents" | grep -i kinas)" || fail "no Kinas LaunchAgent"
  if grep -a -q 'hotkey unavailable' "$LOGS/kinas.log" 2>/dev/null && [ "$(grep -a 'hotkey unavailable' "$LOGS/kinas.log" | tail -1 | cut -c2-11)" = "$(date -u +%Y-%m-%d)" ]; then
    echo "      $(grep -a 'hotkey unavailable' "$LOGS/kinas.log" | tail -1)"
    pass "⌘⇧Space not registered, and Settings says so (no other chord registered)"
  else
    pass "⌘⇧Space registered (no 'hotkey unavailable' today)"
  fi
  [ -L "$KINAS" ] && pass "~/.local/bin/kinas is a symlink" || fail "~/.local/bin/kinas is not a symlink"
  herdr session list 2>/dev/null | grep -q '^default *running' && pass "Herdr default session running" || fail "Herdr default session not running"
  grep -a 'terminal: starting' "$LOGS/kinas.log" | tail -1 | grep -q '"herdr; exec' && pass "the pane attached Herdr's default session" || fail "the pane did not start herdr"
fi

if want ac11; then
  section "AC-11 — host numbers"
  start_app || fail "app did not start"
  sleep 12
  json=$("$KINAS" status --json)
  mem=$(echo "$json" | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(j.host.mem_total_gb)')
  real=$(echo "$(sysctl -n hw.memsize) / 1073741824" | bc -l)
  awk -v a="$mem" -v b="$real" 'BEGIN{d=a-b; if (d<0) d=-d; exit !(d<=0.1)}' && pass "memory total $mem GiB vs hw.memsize $real" || fail "memory total $mem vs $real"
  free=$(echo "$json" | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(j.host.disk_free_gb)')
  avail=$(df -k /System/Volumes/Data | awk 'NR==2{print $4/1048576}')
  awk -v a="$free" -v b="$avail" 'BEGIN{d=(a-b)/b; if (d<0) d=-d; exit !(d<=0.01)}' && pass "disk free $free GiB vs df $avail GiB" || fail "disk free $free vs df $avail"
  pids=(); for _ in $(seq "$(sysctl -n hw.ncpu)"); do yes >/dev/null & pids+=($!); done
  ok=0; for _ in $(seq 10); do sleep 3; cpu=$("$KINAS" status --json | bun -e 'const j=JSON.parse(await Bun.stdin.text()); console.log(j.host.cpu_pct ?? 0)'); awk -v c="$cpu" 'BEGIN{exit !(c>=90)}' && { ok=1; break; }; done
  kill "${pids[@]}" 2>/dev/null
  [ $ok -eq 1 ] && pass "CPU reads $cpu% under load" || fail "CPU only reached ${cpu:-?}% under load"
fi

if want ac5; then
  section "AC-5 — token counts match an independent recount (real transcripts, past days)"
  start_app || fail "app did not start"
  for _ in $(seq 120); do "$KINAS" status --json >/dev/null 2>&1 && sqlite3 "$DB" "SELECT count(*) FROM log_cursors" | grep -qv '^0$' && break; sleep 2; done
  sleep 20
  bun scripts/check-usage.ts --store "$DB" --dates "$(past_dates)" && pass "recount matches the store for $(past_dates)" || fail "recount differs"
fi

if want ac6; then
  section "AC-6 — ingestion is idempotent"
  sums() { sqlite3 "$DB" "SELECT date, harness, model, sum(tokens_in), sum(tokens_cache_read), sum(tokens_out), sum(messages) FROM usage_daily WHERE date < '$(TZ=Europe/Lisbon date +%Y-%m-%d)' GROUP BY 1,2,3 ORDER BY 1,2,3"; }
  start_app || fail "app did not start"; sleep 20
  before=$(sums)
  quit_app; start_app; sleep 30
  [ "$(sums)" = "$before" ] && pass "relaunch leaves past totals unchanged" || fail "relaunch changed past totals"
  quit_app
  sqlite3 "$DB" "DELETE FROM log_cursors"
  start_app; sleep 60
  [ "$(sums)" = "$before" ] && pass "re-reading every transcript from zero leaves past totals unchanged" || fail "re-read changed past totals"
fi

echo
[ $FAILED -eq 0 ] && echo "ALL REQUESTED CHECKS PASS" || echo "SOME CHECKS FAILED"
exit $FAILED
