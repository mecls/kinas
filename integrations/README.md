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

Amended 2026-11-25 (the factory in the cloud, slice 5.3; the captain's rule). Hooks run outside Claude Code's sandbox,
so the script:
- exits at once in a Firstmate worker (`FM_TASK_ID` set), before it reads anything. A worker's usage comes from the
  transcript recount, and its brief carries what it needs.
- treats its input as data only. The hook's JSON is read and dropped. The project folder reaches `kinas` as one
  argument and must be an absolute path. Nothing is run through the shell: no `eval`, no command built from input.

`kinas-context.test.ts` proves both, and that a missing or failing `kinas` never fails a session.

**On the Linux machine** the same script runs, installed by the captain by hand, as the status line is. Kinas never
writes under `~/.claude`. There `kinas context --agent` keeps no store and uses the companion's folders:
- the projects folders are the `roots` setting in `~/.config/kinas/config.json`, for example
  `{"roots": ["~/miraside", "~/personal"]}`, else `~/projects`. A session in any of them gets the packet;
- the crew is Firstmate's home under `~/.local/share/kinas/firstmate`;
- the context cache is in `~/.local/state/kinas`.

The plan rows say they are read by the app on the Mac.

## The brief convention

A brief Kinas composes for the crew begins with the packet's `## Conventions` and `## Projects` sections
(`briefPreamble` in `packages/context/src/brief.ts`), so a crewmate starts on the rails. Amended 2026-09-25 (the first
mate, ADR 0016): Kinas writes nothing into Firstmate's home, its intake included; a brief reaches Firstmate only through
the first mate's chat, pasted by the captain (ADR 0017). No command composes one yet.
