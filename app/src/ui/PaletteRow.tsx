import { useEffect, useRef, type ReactNode } from "react";
import { Kbd } from "./Button.tsx";
import { Chip, Dot, type Category, type DotKind } from "./Dot.tsx";
import { ChevronRightIcon, CrewIcon, FileIcon, FolderIcon, GearIcon, InboxIcon, TerminalIcon } from "./icons.tsx";
import "./PaletteRow.css";

// DESIGN.md §4 Palette row (1.11, the interface polish): one result — the kind's icon in --ink-2, the name (--ink, 500,
// the matched letters 600), one line of detail in --ink-2 (a path in mono --text-xs), and at the right the client
// folder's Chip and name, an age in mono, or a command's chord as a Kbd. --row-h tall; the selected row on
// --accent-soft. A group is its label, its rows and "N more". Presentation only: the palette owns the keys
// (build-spec invariant 8), and `highlight` (palette/match.ts) cuts the name into runs before it reaches here.

export type PaletteRowKind = "command" | "open" | "file" | "folder" | "task" | "inbox" | "workspace" | "setting";

export interface PaletteRowItem {
  kind: PaletteRowKind;
  /** Unique across the palette: the kind, a colon, then the thing's own id (a command's id, a file's real path). */
  key: string;
  title: string;
  detail?: string;
  mono?: boolean;
  /** A status word's dot, before the detail: a task's word (DESIGN.md §4 Palette row). */
  dot?: { color: string; kind: DotKind };
  dir?: boolean;
  folder?: { name: string; cat: Category };
  chord?: string;
  age?: string;
}

export interface PaletteRowGroup<T extends PaletteRowItem = PaletteRowItem> {
  id: string;
  label: string;
  items: readonly T[];
  more: number;
  state: "ready" | "loading" | "failed";
  note?: string;
}

export type Runs = readonly { text: string; hit: boolean }[];

function KindIcon({ kind, dir }: { kind: PaletteRowKind; dir?: boolean }) {
  if (kind === "command") return <ChevronRightIcon />;
  if (kind === "folder" || dir) return <FolderIcon />;
  if (kind === "task") return <CrewIcon />;
  if (kind === "inbox") return <InboxIcon />;
  if (kind === "workspace") return <TerminalIcon />;
  if (kind === "setting") return <GearIcon />;
  return <FileIcon />;
}

/** The thing's own id, after the key's kind: what `data-command` and `data-file` carry for the tests. */
const ownId = (key: string) => key.slice(key.indexOf(":") + 1);

export function PaletteRow({ item, name, selected, onHover, onPick }: { item: PaletteRowItem; name: Runs; selected: boolean; onHover: () => void; onPick: () => void }) {
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) row.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const end: ReactNode = item.folder ? (
    <span className="ui-palette-folder">
      <Chip cat={item.folder.cat} />
      {item.folder.name}
    </span>
  ) : item.chord ? (
    <Kbd>{item.chord}</Kbd>
  ) : null;
  return (
    <li
      ref={row}
      role="option"
      aria-selected={selected}
      className="ui-palette-row"
      data-kind={item.kind}
      data-key={item.key}
      data-command={item.kind === "command" ? ownId(item.key) : undefined}
      data-file={item.kind === "file" ? ownId(item.key) : undefined}
      onMouseMove={onHover}
      onClick={onPick}
    >
      <KindIcon kind={item.kind} dir={item.dir} />
      <span className="ui-palette-name">{name.map((r, i) => (r.hit ? <b key={i}>{r.text}</b> : r.text))}</span>
      {item.detail && (
        <span className="ui-palette-detail" data-mono={item.mono || undefined}>
          {item.dot && <Dot color={item.dot.color} kind={item.dot.kind} />}
          {item.detail}
        </span>
      )}
      {(end || item.age) && (
        <span className="ui-palette-end">
          {end}
          {item.age && <span className="ui-palette-age">{item.age}</span>}
        </span>
      )}
    </li>
  );
}

/** "N more", a row of its own so ↑ ↓ reach it and Enter opens the group in place (rule 15). */
export const moreKey = (groupId: string) => `more:${groupId}`;

export function PaletteGroupView<T extends PaletteRowItem>({
  group,
  selectedKey,
  runs,
  onMore,
  onHover,
  onPick,
}: {
  group: PaletteRowGroup<T>;
  selectedKey: string | null;
  /** The name cut at the matched letters. */
  runs: (item: T) => Runs;
  onMore: () => void;
  onHover: (key: string) => void;
  onPick: (item: T) => void;
}) {
  const labelId = `palette-group-${group.id}`;
  const more = moreKey(group.id);
  return (
    <li role="presentation" className="ui-palette-group" data-group={group.id} data-state={group.state}>
      <div className="ui-palette-label" id={labelId}>
        {group.label}
      </div>
      <ul role="group" aria-labelledby={labelId}>
        {group.items.map((item) => (
          <PaletteRow key={item.key} item={item} name={runs(item)} selected={item.key === selectedKey} onHover={() => onHover(item.key)} onPick={() => onPick(item)} />
        ))}
        {group.more > 0 && (
          <li role="option" aria-selected={selectedKey === more} className="ui-palette-more" data-more={group.id} onMouseMove={() => onHover(more)} onClick={onMore}>
            {group.more} more
          </li>
        )}
      </ul>
      {group.note && <p className="ui-palette-note">{group.note}</p>}
    </li>
  );
}

/** The palette's keys, as Kbds (rule 17): ↵ Open · Esc Close · ↑↓ Move. */
export function PaletteFoot() {
  return (
    <div className="ui-palette-foot">
      <span>
        <Kbd>↵</Kbd> Open
      </span>
      <span>
        <Kbd>Esc</Kbd> Close
      </span>
      <span>
        <Kbd>↑↓</Kbd> Move
      </span>
    </div>
  );
}
