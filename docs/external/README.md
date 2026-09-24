# docs/external · the world outside the repository

One file per thing outside this repository that an agent needs to know exists: where it lives, who reads it, what it can do, and what must never happen to it. Names, paths, scopes and env var **names** only — never a value, never a token, never a key. `README.md` keeps the user-facing setup; this folder is the agent-facing map, and `scripts/acceptance.sh` (AC-10) greps it for secret patterns.

| Entry | What |
|---|---|
| `firstmate-home.md` | Firstmate's home, `FM_HOME` and `FM_ROOT`, the pin, and the rule that Kinas writes nothing under it |
| `keychain.md` | The macOS Keychain service and accounts Kinas stores, and how they are written |
| `ollama-cloud-key.md` | The Ollama Cloud API key |
| `convex-deploy-key.md` | The Convex deploy key, scoped to usage only |
| `hostinger-token.md` | The Hostinger API token, which can do everything, and the code-enforced GET-only rule |
| `claude-statusline-hook.md` | The three lines in Claude Code's status-line script that hand Kinas its plan limits |
| `kinas-cli-link.md` | `~/.local/bin/kinas` and the never-clobber rule |
| `herdr-default-session.md` | Herdr's `default` session, which tests never touch, and the throwaway sessions they use instead |
| `crew-tools.md` | The crew's tools at their pinned versions, where `kinas crew setup` puts them, and the `setup hooks` it never runs |
| `github-cli.md` | `gh`, signed in as the captain: what Kinas asks it, and that Kinas stores no token |

When a feature adds something outside the repository — a token, a hook, a path, a dashboard — it adds a file here in the same shape: What it is · Where · Who reads it · What it can do · Never.
