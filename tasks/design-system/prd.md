# The design system — rebuild the Kinas UI to the design preview — Implementation Spec

*Written 2026-09-22 from the captain's brief ("Prompt: rebuild the Kinas UI to the design preview"), the design law `DESIGN.md` v1.1 and the preview `design/preview.html`. Gate 1 is satisfied by the preview; this document is the product statement and the acceptance list. The build spec (`build-spec.md`, private) wins where the two differ and its §17 says why.*

## 1. Objective

Kinas looks like Build 1 left it: all-caps letter-spaced mono labels, one tile per metric with a status dot in its corner, a sidebar of Usage · Work · Recent · Settings, and some 350 raw pixel values across five stylesheets with no spacing, radius or size scale. `DESIGN.md` v1.1 and `design/preview.html` now say what Kinas should look like — warm neutrals with one accent, four colour roles never mixed, type carrying the hierarchy, a Home page that answers "what happened while I was away, and what needs me" — and every later build (the crew's board and inbox, the run feed, the deployer, the phone) will add its screens on that system. This work restyles what exists onto the system and, more importantly, leaves the system behind as a durable artifact: the law (`DESIGN.md`), the values (`app/src/styles/tokens.css`), the library (`app/src/ui/` with a story per state), the reference rendering (`design/preview.html`) and the tests that stop the look drifting. It replaces the Build 1 look; it changes no reader, terminal, store or provider behaviour.

## Announcement

Kinas has a new face. Open it and you land on Home: the night's progress per client folder, what is waiting on you, the three usage numbers that decide your day, and anything past its threshold — one page, one glance. The sidebar now names every part of the app — Home, Work, Crew, Inbox, Usage, Reader, Settings — with your client folders beneath it, each with its own colour, and the VPS at the foot. Pick light or dark, pick your accent, and the whole app follows, terminal included. Nothing you relied on moved: ⌘2 is still Work, ⌘S still hides the sidebar, your pins and recent files are where they were. Under the surface every colour, size and space now comes from one token file that the tests guard, so the crew's pages will arrive looking like they were always there.

## 2. Business rules (invariants — never violate)

1. **The terminal is never remounted.** Nothing above `<Terminal>` in `app/src/App.tsx` becomes conditional, wrapped or re-keyed; new pages are added as more always-mounted `section.page` siblings; theme and accent changes touch CSS variables only. Every existing `ptyPid` assertion stays green after every slice, because a remount restarts the PTY and drops Herdr's client (ADR 0002).
2. **Every colour, font size, line height, spacing and radius in `app/src` is a token.** Components use tokens only; pages compose components and add layout with the layout tokens. A guard test fails on any raw value outside `tokens.css` (and the paper palette in `print.css`), with one exemption that may only shrink: the reader's body stylesheet, at its count on the day the guard lands.
3. **Four colour roles, never mixed** (DESIGN.md §1): neutrals measure (a fine bar fills with `--meter`, never the accent); the accent marks the interactive and the selected; status colours mean state (as dots, bars and segments, never as text except `--danger` on an error line); category colours mean identity (a client folder, a provider) and sit beside the name they stand for.
4. **The theme is the window's.** Settings → Appearance writes the `appearance` setting; Rust sets the window theme; `prefers-color-scheme` flips; `tokens.css` swaps values. No attribute on the root carries the choice (`appearance.e2e.ts` asserts it). The terminal follows the theme (decided 2026-09-22; DESIGN.md §2.3 amended).
5. **The accent is a setting, validated in Rust, applied as one custom property.** `#rrggbb` lower-case or nothing; anything else is refused, not coerced. A shade whose `--accent-ink` contrast falls under 4.5:1 in either theme is not saved; the field offers the nearest passing shade. The value lives in `settings["accent"]` and in `--brand-accent` on the root's inline style, nowhere else.
6. **Every key binding changes in `keymap.md` before the code.** ⌘1 goes to Home, ⌘4 to Usage, ⌘3 stays reserved for the crew; ⌘K, ⌘S, ⌘, and the pane's ownership of every non-⌘ key are untouched. Crew, Inbox and Reader in the sidebar are click-only; the palette gains one command, `go.home`.
7. **Contrast is measured, not felt.** Every text pair in DESIGN.md §2.4 reaches its floor in both themes at the default accent and at an extreme test accent; the ANSI colours reach 4.5:1 on the terminal's ground in both themes; a bun test computes it from `tokens.css`.
8. **No new dependency for styling and no network at runtime for the UI.** Plain CSS, custom properties, `color-mix`; the icons are inline SVG in `app/src/ui/icons.tsx`; the fonts are bundled files under an OFL license (Inter, JetBrains Mono, Bricolage Grotesque) — Clash Display is not bundled because its license forbids sharing the files.
9. **The four artifacts agree.** `DESIGN.md` §2's values equal `tokens.css` (a test); every component in `DESIGN.md` §4 exists once in `app/src/ui/` with a story per state; `design/preview.html` carries the same tokens and components. A new page built from those four alone, by an agent with no other context, matches the preview.
10. **The repository is public.** Nothing from `scripts/private-names` in any added line, commit message, fixture, screenshot or font file name; `design/preview.html`'s demo data uses synthetic names.
11. **Client folders are what the context packet already calls projects**: the git repositories under the projects root, up to three levels down, with the packet's skip list; a folder's category colour is assigned once by a stable hash of its name and stored, and only the captain changes it (Settings); "internal" is a per-folder flag, none by default.
12. **Honest empty states.** A section whose data does not exist yet (the crew's Overnight events, the inbox) shows one sentence in `--ink-2` and, if anything, one action that does something; never a fake card, never a disabled button, never a count of zero.

## 3. Flows

- **Theme**: Settings → Appearance `<select>` → `set_appearance` (stored first, then applied to the window) → `prefers-color-scheme` → `tokens.css` → `onThemeChange` re-themes xterm and Mermaid. A failed `set_theme` is logged and the setting stays; the page reads the window's real scheme.
- **Accent**: Settings → Accent field → the contrast check in the webview (refuse / offer) → `set_accent` (validated again in Rust, stored) → `get_settings` → `--brand-accent` set on the root; at boot the same from the first `get_settings`. An invalid stored value (impossible through the UI) falls back to the brand default.
- **Client folders**: the sidebar asks `list_projects` on mount, on window focus and every 60 s; unassigned folders get a colour from the hash and it is stored; the captain changes a colour or flags a folder internal in Settings → `set_folder_category` / `set_folder_internal`. A missing or unreadable projects root lists nothing and says nothing (the reader's own message covers it).
- **Home**: `get_usage_snapshot` (the readers) → the three gauges, the Needs attention rows (anything past 80 %, stale, dead or in error), the "as of" caption; `list_projects` → one Overnight row per folder, "No work overnight in this folder." until the crew exists; a folder row opens the reader panel on that folder.
- **Connection row**: `readers[hostinger]` + the stored VM label → "connected" (fresh), "stale", "error"; hidden when no VM is configured.
- **Stories** (debug builds only): `#stories` in the hash mounts the stories page instead of the app; the e2e flips the theme through `set_appearance`, asserts the style contract and saves screenshots.

## 4. Surfaces

Every surface below uses DESIGN.md §4's components and nothing else: Button, Kbd, Gauge, Bar, SegBar, MetricRow, SectionHeader, StatusBadge, Dot, Chip, Tag, Table, Card, Lane, ProgressRow, InboxItem, Timeline, Toast, EmptyState, TerminalChrome, QuestionCard, ChecksList, TitleRow, Nav/NavItem, ConnectionRow, Settings field, Accent field, Switch.

- **The sidebar** — wordmark; Home · Work · Crew · Inbox (count when > 0) · Usage · Reader · Settings; Pinned, Files and Recent as today; Client folders with chips and the internal tag; the VPS connection row at the foot. ⌘S hides it.
- **Home** (⌘1, the landing page) — title row with "N waiting on you" (hidden at 0) and Launch task (goes to Work); Overnight; Waiting on you; Usage (three gauges) with Needs attention.
- **Usage** (⌘4) — hero row of three gauges; one section per provider with a single freshness caption; Convex as nine metric rows; Hostinger as a card and rows; This Mac as rows; the chart by provider; Today and Month to date as tables.
- **Crew** and **Inbox** — a title row and an empty state until Build 3.
- **Settings** (⌘,) — groups as cards: Providers, Crew (later), Client folders, Shortcuts, Appearance (theme, accent), Advanced.
- **Work** (⌘2) — the terminal under its chrome (session name, state badge, Copy).
- **The reader** — header on the tokens; the body's type on the type scale; the panel's chrome as the preview's.
- **Palette, toasts, notices** — `--shadow-float`, the toast placement.

**Screens** — the approved mockup is `design/preview.html` (the Mac window: Home, the sidebar, the right panel; the component catalogue for every state); no separate mockup files.

## 5. Validation

- `bun run check` green at every slice; the full e2e alone at the three ship points.
- `app/src/styles/guard.test.ts`: 0 raw values outside `tokens.css` except the reader-body ratchet; `tokens.test.ts`: every §2.4 pair ≥ its floor, both themes, two accents; `design.test.ts`: DESIGN.md §2 == `tokens.css`.
- `appearance.e2e.ts`: theme and accent set, stored, applied; `ptyPid` equal before and after each switch; no `theme` attribute on the root.
- `stories.e2e.ts`: every story present; the computed style of one element per component equals its token; screenshots saved.
- `screens.e2e.ts`: Home, Usage, Settings in both themes at 1280 × 820 saved under `docs/design/screens/`; the agent reads them; the smoke test names them for the captain's eyes.
- Every existing e2e assertion holds as written, except those each slice names in its PR.
- The reader's warm-open median stays under 200 ms on the release build (the smoke test's method).

## 6. Out of scope

The phone (the tokens and components must not preclude it); the Crew and Inbox contents, the Overnight caption and progress bars, the waiting count (Build 3); ⌘N and a launch form; the terminal chrome's Detach and the Work page's lane strip; retiring the reader body's raw values below the ratchet (DESIGN.md §10.6); `design/tokens.json` generation (with the phone's `KinasTokens.swift`); Convex in the menu bar; a Codex gauge. Each would grow the build sideways past the system it exists to leave behind.

## 7. Open questions

None open. Asked and answered 2026-09-22 (the build spec's §17 carries them): PR #22 ships first; the terminal follows the theme; client folders are the packet's repositories; the preview stays at `design/preview.html`.
