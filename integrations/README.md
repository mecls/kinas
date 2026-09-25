# Session-start integrations

Both run `kinas context --agent` when a session starts and put the context packet in front of the agent, so the
session knows which projects exist, what the crew is doing, what is blocked and which conventions apply before
it reads a single file. Neither can break a session: when `kinas` is missing or fails, the session starts
without the packet.

## Pi — `pi/kinas-context.ts`

Interactive (TUI) sessions only; print, JSON and RPC runs are left alone. The packet is read once at session
start and prepended to the system prompt on every turn, so the prompt prefix stays the same for providers that
cache it.

```sh
ln -s "$PWD/integrations/pi/kinas-context.ts" ~/.pi/agent/extensions/kinas-context.ts
```

Then `/reload` in a running Pi session, or start a new one. `KINAS_BIN` overrides which `kinas` it runs.

## Claude Code — `claude-code/kinas-context.sh`

A `SessionStart` hook. It prints the packet only for sessions whose project folder is inside the Kinas projects
root (`kinas context --agent --cwd "$CLAUDE_PROJECT_DIR"`); anywhere else it prints nothing. Add it next to any
hooks already in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "sh /path/to/kinas/integrations/claude-code/kinas-context.sh", "timeout": 30 }]
      }
    ]
  }
}
```

It finds `kinas` on `PATH`, then at `~/.local/bin/kinas` (where the app links it); `KINAS_BIN` overrides both.

## The brief convention

A brief Kinas composes for the crew begins with the packet's `## Conventions` and `## Projects` sections
(`briefPreamble` in `packages/context/src/brief.ts`), so a crewmate starts on the rails. Amended 2026-09-25 (the first
mate, ADR 0016): Kinas writes nothing into Firstmate's home, its intake included; a brief reaches Firstmate only through
the first mate's chat, pasted by the captain (ADR 0017). No command composes one yet.
