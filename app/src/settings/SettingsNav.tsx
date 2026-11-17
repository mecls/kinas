import { SearchIcon } from "../ui/icons.tsx";
import { SECTIONS, type SettingsGroup } from "./index.ts";

// Settings' left column (tasks/interface-polish, rules 32 and 34; DESIGN.md §5 Settings, 1.13): a search field, then
// the groups under their group labels, each with its sections. A click scrolls the page to the section; the section
// in view is marked. While something is typed, a section with no matching row is dimmed.

const GROUPS: readonly SettingsGroup[] = ["Providers", "Crew", "Workspace", "Interface", "System"];

export function SettingsNav({
  query,
  onQuery,
  current,
  matching,
  onSection,
}: {
  query: string;
  onQuery: (q: string) => void;
  /** The section in view. */
  current: string;
  /** The sections with a matching row while something is typed; null otherwise. */
  matching: ReadonlySet<string> | null;
  onSection: (id: string) => void;
}) {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <label className="settings-search">
        <SearchIcon size="sm" />
        <input className="settings-search-input" type="search" value={query} placeholder="Search settings" aria-label="Search settings" spellCheck={false} onChange={(e) => onQuery(e.currentTarget.value)} />
      </label>
      {GROUPS.map((group) => (
        <div key={group} className="settings-nav-group" data-group={group.toLowerCase()}>
          <h3 className="settings-nav-label ui-group-label">{group}</h3>
          {SECTIONS.filter((s) => s.group === group).map((s) => (
            <button
              key={s.id}
              type="button"
              className="settings-nav-item"
              data-nav={s.id}
              aria-current={s.id === current ? "true" : undefined}
              data-dim={matching !== null && !matching.has(s.id) ? "" : undefined}
              onClick={() => onSection(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
