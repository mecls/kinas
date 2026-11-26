#!/usr/bin/env bash
# The fake Firstmate's inbox, for Kinas's VPS specs (build spec §12 slice 6.3; ADRs 0022, 0025). It logs its argv as one
# line to state/calls.log — never the words, which come on stdin only — and keeps each note's words in
# state/inbox/<request id>, as the real inbox keeps a note.
#
# `note --request-id <id> --json -` saves the words once and prints `{"outcome":"saved"}`; the same id again prints
# `replay` and saves nothing, as Firstmate's idempotent note does. `receipts` prints fm-inbox-receipts.v1 with every note
# pending — or handled once a spec leaves fixtures/inbox-handled, with the reply in fixtures/inbox-reply when there is
# one — and, as the real one does, each note's words in `body`, which Kinas must never carry off the machine.
set -u
printf 'fm-inbox.sh %s\n' "$*" >> "$FM_HOME/state/calls.log"
inbox="$FM_HOME/state/inbox"
mkdir -p "$inbox"

# One JSON string: backslashes and quotes escaped, lines joined with \n.
json() {
  sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' "$1" | awk 'BEGIN { ORS = "" } { if (NR > 1) printf "\\n"; print } END { }'
}

case "${1:-}" in
  note)
    if [ "${2:-}" != "--request-id" ] || [ -z "${3:-}" ] || [ "${4:-}" != "--json" ] || [ "${5:-}" != "-" ]; then
      echo "fm-inbox.sh: usage: note --request-id <id> --json -" >&2
      exit 2
    fi
    id=$3
    case "$id" in .* | *[!A-Za-z0-9._:-]*)
      echo "fm-inbox.sh: not a request id" >&2
      exit 2
      ;;
    esac
    if [ -f "$inbox/$id" ]; then
      cat > /dev/null
      printf '{"outcome":"replay","request_id":"%s"}\n' "$id"
      exit 0
    fi
    cat > "$inbox/$id.tmp" && mv "$inbox/$id.tmp" "$inbox/$id"
    printf '{"outcome":"saved","request_id":"%s"}\n' "$id"
    exit 0
    ;;
  receipts)
    handled=false
    [ -f "$FM_HOME/fixtures/inbox-handled" ] && handled=true
    reply=null
    if $handled && [ -f "$FM_HOME/fixtures/inbox-reply" ]; then
      reply="{\"body\":\"$(json "$FM_HOME/fixtures/inbox-reply")\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
    fi
    notes=""
    for f in "$inbox"/*; do
      [ -f "$f" ] || continue
      case "$f" in *.tmp) continue ;; esac
      id=${f##*/}
      [ -n "$notes" ] && notes="$notes,"
      notes="$notes{\"request_id\":\"$id\",\"acknowledged\":$handled,\"body\":\"$(json "$f")\",\"reply\":$reply}"
    done
    if $handled; then
      printf '{"schema":"fm-inbox-receipts.v1","pending":[],"handled":[%s]}\n' "$notes"
    else
      printf '{"schema":"fm-inbox-receipts.v1","pending":[%s],"handled":[]}\n' "$notes"
    fi
    exit 0
    ;;
  *)
    echo "fm-inbox.sh: the fake answers note and receipts only" >&2
    exit 2
    ;;
esac
