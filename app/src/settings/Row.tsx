import { createContext, useContext, type ReactNode } from "react";
import { SettingsRow } from "../ui/SettingsRow.tsx";
import { SETTINGS, SECTIONS } from "./index.ts";

// A Settings row by its id (tasks/interface-polish, rules 33–34): its label and description come from the registry the
// palette searches (settings/index.ts), so the page and the palette never word a setting two ways; the search's
// matches, given through `SettingsMatch`, hide the rest.

/** The ids Settings' search keeps, or null when nothing is typed. */
export const SettingsMatch = createContext<ReadonlySet<string> | null>(null);

export function Row({ id, wide, children }: { id: string; wide?: boolean; children?: ReactNode }) {
  const match = useContext(SettingsMatch);
  const entry = SETTINGS.find((s) => s.id === id);
  if (!entry) throw new Error(`no setting ${id} in settings/index.ts`);
  return (
    <SettingsRow id={id} label={entry.label} description={entry.description} wide={wide} hidden={match !== null && !match.has(id)}>
      {children}
    </SettingsRow>
  );
}

/**
 * One section of the page (rule 32): its title above its card. Hidden while the search keeps none of its rows, so a
 * section shows only with something to show.
 */
export function Block({ id, children }: { id: string; children: ReactNode }) {
  const match = useContext(SettingsMatch);
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`no section ${id} in settings/index.ts`);
  const shown = match === null || SETTINGS.some((s) => s.section === id && match.has(s.id));
  return (
    <section className="settings-block" data-block={id} aria-labelledby={`settings-block-${id}`} hidden={!shown}>
      <h2 className="settings-block-title" id={`settings-block-${id}`}>
        {section.title}
      </h2>
      {children}
    </section>
  );
}
