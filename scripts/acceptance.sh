#!/bin/bash
# Build spec §13 checks that need the real, installed app: AC-5, AC-6, AC-9, AC-10, AC-11, AC-12.
# Run after `bun run build` and copying Kinas.app to /Applications. Prints PASS/FAIL per check and the output
# that proves it; exits 1 if any check failed. Don't run e2e specs at the same time: test builds log to the
# same folder and share the app name.
#
#   scripts/acceptance.sh            everything
#   scripts/acceptance.sh ac10 ac9   only some

set -u
cd "$(dirname "$0")/.."
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

# The installed app's log lines since its latest start. e2e debug builds write to the same file, with a store
# under a temp folder, so every "store open at" line switches between "ours" and "theirs".
app_log() { awk -v m="store open at $DB" '/store open at /{ on = index($0, m) > 0; if (on) buf = "" } on { buf = buf $0 "\n" } END { printf "%s", buf }' "$LOGS/kinas.log"; }

# One field of `kinas status --json`, printed plain (console.log would colour numbers).
json_field() { bun -e "const j = JSON.parse(await Bun.stdin.text()); process.stdout.write(String($1 ?? ''))"; }

# Lisbon dates of the three days before today (today keeps changing while Claude Code runs).
past_dates() { for d in 1 2 3; do TZ=Europe/Lisbon date -v-${d}d +%Y-%m-%d; done | sort | paste -sd, -; }

WAS_RUNNING=0; app_running && WAS_RUNNING=1

if want ac10; then
  section "AC-10 — nothing leaks, nothing ships that shouldn't"
  # The names that must never be committed are private too, so they are not written here: an extended regex in
  # KINAS_PRIVATE_NAMES, or in scripts/private-names (git-ignored, like tasks/).
  names=${KINAS_PRIVATE_NAMES:-$(cat scripts/private-names 2>/dev/null || true)}
  if [ -z "$names" ]; then
    fail "no private names to look for: set KINAS_PRIVATE_NAMES or write scripts/private-names"
  else
    hits=$(git grep -i -n -E "$names" || true)
    [ -z "$hits" ] && pass "no private names in the repository (private planning documents in tasks/ are git-ignored; the tracked templates, status files, PRDs and mockups are searched like any other file)" || fail "private names found: $hits"
  fi
  # The agent-facing documents — AGENTS.md, DESIGN.md, docs/ (ADRs, docs/external/), the templates and every
  # feature's tracked status file and PRD — carry names and scopes, never a value. A bare prefix would match the
  # prose that explains the rule (docs/smoke-test.md names the very grep a person runs), so every pattern wants a
  # token character after it; the store and log checks below look for the bare prefix, since no prose lives there.
  hits=$(git grep -n -E 'sk-ant-[A-Za-z0-9]|Bearer [A-Za-z0-9]|ghp_[A-Za-z0-9]|github_pat_[A-Za-z0-9]' -- docs AGENTS.md DESIGN.md tasks/_templates 'tasks/*/status.md' 'tasks/*/prd.md' || true)
  [ -z "$hits" ] && pass "no secret pattern in the agent-facing documents (docs/, AGENTS.md, DESIGN.md, tasks/ templates, status files and PRDs)" || fail "a secret pattern is in a document: $hits"
  hits=$(git grep -n -E 'Claude Code-credentials|api\.anthropic\.com' -- ':!tasks' ':!scripts/acceptance.sh' || true)
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

  # No credential header ever reaches the store or the logs, whichever provider it belongs to. `Convex ` keeps
  # its trailing space on purpose: without it this matches the word in every log line that names the reader.
  leaks=0
  for f in "$DB"* "$LOGS"/*; do
    [ -f "$f" ] || continue
    c=$(grep -a -c -E 'Bearer |Convex [A-Za-z0-9_|-]{8}' "$f" || true)
    [ "$c" = "0" ] || { echo "      $f: $c"; leaks=1; }
  done
  [ $leaks -eq 0 ] && pass "no Bearer or Convex credential header in the store or the logs" || fail "a credential header was found (above)"

  # The Convex deploy key itself (prd-convex-usage.md §5). Its first 12 characters cannot be written here — a
  # real key prefix in a committed script would be the very leak this is looking for — so they are read from the
  # Keychain, or supplied as KINAS_CONVEX_KEY_PREFIX.
  prefix=${KINAS_CONVEX_KEY_PREFIX:-$(security find-generic-password -s ai.sintralabs.kinas -a convex-deploy-key -w 2>/dev/null | cut -c1-12)}
  if [ -z "$prefix" ]; then
    # Deliberately not a PASS: an empty store proves nothing, and a green tick here would be a lie of omission.
    echo "SKIP  no Convex deploy key saved yet, so there is nothing to look for (save one in Settings first)"
  else
    leaks=0
    for f in "$DB"* "$LOGS"/*; do [ -f "$f" ] || continue; c=$(grep -a -c -F "$prefix" "$f" || true); [ "$c" = "0" ] || { echo "      $f: $c"; leaks=1; }; done
    if [ -x "$KINAS" ]; then
      c=$("$KINAS" status --json 2>/dev/null | grep -c -F "$prefix" || true)
      [ "$c" = "0" ] || { echo "      kinas status --json: $c"; leaks=1; }
    fi
    [ $leaks -eq 0 ] && pass "the Convex deploy key is not in the store, the logs or kinas status --json" || fail "the Convex deploy key leaked (above)"
  fi

  # The Hostinger API token (prd-hostinger-usage.md §5). Read from the Keychain for the same reason as Convex's:
  # a real prefix committed here would be the leak this looks for. This one matters more than most — Hostinger
  # has no read-only scope, so a leaked token can restart or recreate the machine, not merely read its metrics.
  prefix=${KINAS_HOSTINGER_TOKEN_PREFIX:-$(security find-generic-password -s ai.sintralabs.kinas -a hostinger-api-token -w 2>/dev/null | cut -c1-12)}
  if [ -z "$prefix" ]; then
    # Deliberately not a PASS, for the same reason: an empty store proves nothing.
    echo "SKIP  no Hostinger API token saved yet, so there is nothing to look for (save one in Settings first)"
  else
    leaks=0
    for f in "$DB"* "$LOGS"/*; do [ -f "$f" ] || continue; c=$(grep -a -c -F "$prefix" "$f" || true); [ "$c" = "0" ] || { echo "      $f: $c"; leaks=1; }; done
    if [ -x "$KINAS" ]; then
      c=$("$KINAS" status --json 2>/dev/null | grep -c -F "$prefix" || true)
      [ "$c" = "0" ] || { echo "      kinas status --json: $c"; leaks=1; }
    fi
    [ $leaks -eq 0 ] && pass "the Hostinger API token is not in the store, the logs or kinas status --json" || fail "the Hostinger API token leaked (above)"
  fi

  # Watch-only is a property of the code here, not of the token, so it is checked like any other invariant:
  # no verb but GET, and no destructive path, anywhere in the reader. The same two tests run under `cargo test`;
  # this repeats them against the shipped tree so a release cannot quietly disagree with the test suite.
  # `[[:space:]]`, not `\s`: BSD grep does not support the escape, and a filter that silently matches nothing
  # would turn this check into one that cannot fail.
  hits=$(grep -n -E '\.(post|put|patch|delete|head)\(' app/src-tauri/src/readers/hostinger/mod.rs | grep -v '^[0-9]*:[[:space:]]*//' || true)
  [ -z "$hits" ] && pass "the Hostinger reader sends no verb but GET" || fail "a non-GET verb is in the Hostinger reader: $hits"
fi

if want ac9; then
  section "AC-9 — the CLI, including failure exits"
  start_app || fail "app did not start"
  target=$(readlink "$KINAS" 2>/dev/null || true)
  case "$target" in "$APP/Contents/MacOS/"*) pass "$KINAS → $target" ;; *) fail "$KINAS → '${target}'" ;; esac
  "$KINAS" status >/tmp/kinas-ac9.txt 2>&1; code=$?
  [ $code -eq 0 ] && pass "kinas status exits 0" || fail "kinas status exited $code"
  sed 's/^/      /' /tmp/kinas-ac9.txt
  empty=$(mktemp -d); KINAS_DATA_DIR="$empty" "$KINAS" status >/tmp/kinas-ac9.txt 2>&1; code=$?
  [ $code -eq 2 ] && pass "missing store exits 2: $(head -1 /tmp/kinas-ac9.txt)" || fail "missing store exited $code"
  newer=$(mktemp -d); sqlite3 "$DB" ".backup '$newer/kinas.sqlite'" && sqlite3 "$newer/kinas.sqlite" "INSERT INTO schema_migrations VALUES (99, 0)"
  KINAS_DATA_DIR="$newer" "$KINAS" status >/tmp/kinas-ac9.txt 2>&1; code=$?
  [ $code -eq 3 ] && pass "newer schema exits 3: $(head -1 /tmp/kinas-ac9.txt)" || fail "newer schema exited $code"
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
  log=$(app_log)
  plist="$HOME/Library/LaunchAgents/Kinas.plist"
  program=$(plutil -extract ProgramArguments.0 raw "$plist" 2>/dev/null || true)
  [ "$program" = "$BIN" ] && pass "launch at login: $plist → $program" || fail "launch at login: '$program'"
  echo "$log" | grep -q 'launch at login unavailable' && fail "$(echo "$log" | grep 'launch at login unavailable' | tail -1)"
  if echo "$log" | grep -q 'hotkey unavailable'; then
    echo "      $(echo "$log" | grep 'hotkey unavailable' | tail -1)"
    pass "⌘⇧Space not registered, and Settings says so (no other chord registered)"
  else
    pass "⌘⇧Space registered (no 'hotkey unavailable' since the installed app started)"
  fi
  [ -L "$KINAS" ] && pass "~/.local/bin/kinas is a symlink" || fail "~/.local/bin/kinas is not a symlink"
  herdr session list 2>/dev/null | grep -q '^default *running' && pass "Herdr default session running" || fail "Herdr default session not running"
  started=$(echo "$log" | grep 'terminal: starting' | tail -1)
  # Since the launch screen (2026-09-15) a bundled app runs `KINAS_ENTER=herdr COLORFGBG='…' '<cli>'; [ $? -eq 10 ] || herdr; exec …`;
  # only a build with no CLI beside it starts on `"herdr; exec`. Either way Herdr follows.
  echo "$started" | grep -q -E '("|\|\| )herdr; exec' && pass "the pane attached Herdr's default session: ${started##*INFO] }" || fail "the pane did not start herdr: '$started'"
fi

if want ac11; then
  section "AC-11 — host numbers"
  start_app || fail "app did not start"
  sleep 12
  json=$("$KINAS" status --json)
  mem=$(echo "$json" | json_field 'j.host.mem_total_gb')
  real=$(echo "$(sysctl -n hw.memsize) / 1073741824" | bc -l)
  awk -v a="$mem" -v b="$real" 'BEGIN{d=a-b; if (d<0) d=-d; exit !(a != "" && d<=0.1)}' && pass "memory total $mem GiB vs hw.memsize $real" || fail "memory total '$mem' vs $real"
  free=$(echo "$json" | json_field 'j.host.disk_free_gb')
  avail=$(df -k /System/Volumes/Data | awk 'NR==2{print $4/1048576}')
  awk -v a="$free" -v b="$avail" 'BEGIN{d=(a-b)/b; if (d<0) d=-d; exit !(a != "" && d<=0.01)}' && pass "disk free $free GiB vs df $avail GiB" || fail "disk free '$free' vs df $avail"
  # What the Disk tile leads with: Finder's "available" (free space plus purgeable), read independently through NSURL.
  shown=$(echo "$json" | json_field 'j.host.disk_available_gb')
  finder=$(osascript -l JavaScript -e 'ObjC.import("Foundation"); const k = "NSURLVolumeAvailableCapacityForImportantUsageKey"; const r = $.NSURL.fileURLWithPath("/System/Volumes/Data").resourceValuesForKeysError($([k]), null); String(r.objectForKey(k).js / 1073741824)')
  awk -v a="$shown" -v b="$finder" 'BEGIN{d=(a-b)/b; if (d<0) d=-d; exit !(a != "" && d<=0.01)}' && pass "disk available $shown GiB vs Finder's $finder GiB" || fail "disk available '$shown' vs Finder's $finder"
  # With the window in the background the host reader samples every 60 s (R27), so allow 90 s of load.
  pids=(); for _ in $(seq "$(sysctl -n hw.ncpu)"); do yes >/dev/null & pids+=($!); done
  ok=0; waited=0; cpu=""
  for _ in $(seq 30); do sleep 3; waited=$((waited + 3)); cpu=$("$KINAS" status --json | json_field 'j.host.cpu_pct'); awk -v c="$cpu" 'BEGIN{exit !(c != "" && c + 0 >= 90)}' && { ok=1; break; }; done
  { kill "${pids[@]}"; wait "${pids[@]}"; } 2>/dev/null
  [ $ok -eq 1 ] && pass "CPU reads $cpu% under load after ${waited} s" || fail "CPU only reached '${cpu}'% after ${waited} s under load"
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
  echo "      $(echo "$before" | wc -l | tr -d ' ') date·harness·model rows before today"
  quit_app; start_app; sleep 30
  [ "$(sums)" = "$before" ] && pass "relaunch leaves past totals unchanged" || fail "relaunch changed past totals"
  quit_app
  sqlite3 "$DB" "DELETE FROM log_cursors"
  start_app; sleep 60
  [ "$(sums)" = "$before" ] && pass "re-reading every transcript from zero leaves past totals unchanged" || fail "re-read changed past totals"
fi

# Leave the app as it was found.
[ $WAS_RUNNING -eq 1 ] && ! app_running && start_app >/dev/null

echo
[ $FAILED -eq 0 ] && echo "ALL REQUESTED CHECKS PASS" || echo "SOME CHECKS FAILED"
exit $FAILED
