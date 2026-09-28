import { type ReactNode, useEffect, useState } from "react";
import { type DirEntry, type DirListing, readerListDir } from "../api.ts";
import { ChangeMark } from "../ui/index.ts";
import { type CrewRow, crewWordsFor, type FolderMarks, type Gone, mergeCrewRows, mergeDeleted, rowWords, useFolderMarks, watchRoot, wordsFor } from "./changes.ts";

// The folder tree (reader R35): one folder at a time from Rust, children loaded when a folder is expanded. It starts at
// the folder that was opened and cannot go above it.
//
// Every mount follows its root's changes (tree changes rule 12): a changed row carries a Change mark beside its button,
// and the mark's words become the button's accessible name; a deleted entry stays where it was, struck through, until
// a refresh or a reload; an expanded folder re-lists when a burst changes something in it. The button's text and title
// never change — specs find rows by them.

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

type Listing = "loading" | { error: true } | DirListing;
type Row = DirEntry | Gone | CrewRow;

/** What to draw beside a folder's row — the sidebar's pin and terminal buttons. The tree itself knows nothing of them. */
export type FolderActions = (path: string, name: string) => ReactNode;

interface TreeProps {
  selected: string | null;
  /** `view`: a marked file's row opens it on its Changes view (tree changes rule 24); an unmarked one opens as always. */
  onOpen: (path: string, view?: "changes" | "crew") => void;
  folderActions?: FolderActions;
  marks: FolderMarks;
}

export function FileTree({ root, ...rest }: Omit<TreeProps, "marks"> & { root: string }) {
  // Once per root per page load; nothing unwatches on unmount — a root stays followed until a reload (rule 2).
  useEffect(() => watchRoot(root), [root]);
  const marks = useFolderMarks(root);
  return (
    <ul className="tree">
      {/* Keyed by the root, so another folder starts from "Loading…" rather than showing the last one's rows. */}
      <Folder key={root} path={root} {...rest} marks={marks} top />
    </ul>
  );
}

function Folder({ path, top = false, ...rest }: TreeProps & { path: string; top?: boolean }) {
  const { marks } = rest;
  const [listing, setListing] = useState<Listing>("loading");
  const seq = marks.touchedSeq(path);

  // A re-list keeps the rows on screen until the new listing is in: a burst must not blink the tree.
  useEffect(() => {
    let live = true;
    readerListDir(path).then(
      (l) => live && setListing(l),
      () => live && setListing({ error: true }),
    );
    return () => {
      live = false;
    };
  }, [path, seq]);

  if (listing === "loading") return <li className="tree-note">Loading…</li>;
  if ("error" in listing) return <li className="tree-note">Could not read this folder</li>;
  const rows: Row[] = mergeCrewRows(mergeDeleted(listing.entries, marks.deletedIn(path)), marks.crewRowsIn(path));
  if (top && rows.length === 0) return <li className="tree-note">Nothing to open in {baseName(path)}</li>;
  return (
    <>
      {rows.map((row) => (row.kind === "dir" ? <FolderNode key={row.path} entry={row} {...rest} /> : <FileRow key={row.path} entry={row} {...rest} />))}
      {listing.more > 0 && <li className="tree-note">{listing.more} more not shown</li>}
    </>
  );
}

const isGone = (row: Row): row is Gone => "gone" in row;
const isCrewRow = (row: Row): row is CrewRow => "crewRow" in row;

function FileRow({ entry, selected, onOpen, marks }: TreeProps & { entry: Row }) {
  const mark = marks.markOf(entry.path);
  const words = wordsFor(entry.name, mark, null, marks.sinceOf(entry.path), marks.waitsOf(entry.path));
  // Crew marks: the crew's hollow mark comes first, the captain's own at the row's end.
  const crew = marks.crewOf(entry.path);
  const crewWords = crewWordsFor(entry.name, crew, null);
  const label = rowWords(entry.name, words, crew, null);
  return (
    <li>
      <div className="tree-row" data-mark={mark ?? undefined} data-crew={crew?.mark} data-crew-row={isCrewRow(entry) ? "" : undefined} data-gone={isGone(entry) ? "" : undefined}>
        <button
          type="button"
          className="tree-item tree-file"
          aria-current={entry.path === selected ? "true" : undefined}
          aria-label={label ?? undefined}
          title={entry.path}
          // The captain's own Changes first when both; a row with only a crew mark, or a crew row, opens the crew's copy.
          onClick={() => onOpen(entry.path, mark ? "changes" : crew || isCrewRow(entry) ? "crew" : undefined)}
        >
          {entry.name}
        </button>
        {crew && crewWords && <ChangeMark mark={crew.mark} words={crewWords} hollow />}
        {mark && words && <ChangeMark mark={mark} words={words} />}
      </div>
    </li>
  );
}

function FolderNode({ entry, ...rest }: TreeProps & { entry: Row }) {
  const [expanded, setExpanded] = useState(false);
  const { marks } = rest;
  const mark = marks.markOf(entry.path);
  // A folder that existed at both moments carries a roll-up instead of a letter (rule 10).
  const rollup = mark ? null : marks.rollupOf(entry.path);
  const words = wordsFor(entry.name, mark, rollup, marks.sinceOf(entry.path), marks.waitsOf(entry.path));
  // Crew marks: the crew's own mark, or its roll-up, drawn hollow before the captain's.
  const crew = marks.crewOf(entry.path);
  const crewRollup = crew ? null : marks.crewRollupOf(entry.path);
  const crewWords = crewWordsFor(entry.name, crew, crewRollup);
  const label = rowWords(entry.name, words, crew, crewRollup);
  // A deleted folder is one struck-through row: Kinas does not know all it held, so it does not open (rule 9). A
  // folder of the crew's the captain lacks is one dimmed row that does not open either (crew marks, rule 11).
  const gone = isGone(entry) || isCrewRow(entry);
  const open = expanded && !gone;
  return (
    <li>
      {/* The row is always there, actions or not, so the tree has one shape wherever it is mounted. The nested list
          stays the row's sibling: `.tree .tree` indents it, and a list inside the row would sit beside the name. */}
      <div
        className="tree-row"
        data-mark={mark ?? undefined}
        data-rollup={rollup?.count}
        data-crew={crew?.mark}
        data-crew-rollup={crewRollup?.count}
        data-crew-row={isCrewRow(entry) ? "" : undefined}
        data-gone={isGone(entry) ? "" : undefined}
      >
        <button
          type="button"
          className="tree-item tree-dir"
          aria-expanded={gone ? undefined : open}
          aria-label={label ?? undefined}
          title={entry.path}
          onClick={() => !gone && setExpanded((e) => !e)}
        >
          <span className="tree-caret" aria-hidden="true">
            {gone ? "" : open ? "▾" : "▸"}
          </span>
          {entry.name}
        </button>
        {crew && crewWords && <ChangeMark mark={crew.mark} words={crewWords} hollow />}
        {crewRollup && crewWords && <ChangeMark mark={crewRollup.strongest} count={crewRollup.count} words={crewWords} hollow />}
        {mark && words && <ChangeMark mark={mark} words={words} />}
        {rollup && words && <ChangeMark mark={rollup.strongest} count={rollup.count} words={words} />}
        {!gone && rest.folderActions?.(entry.path, entry.name)}
      </div>
      {open && (
        <ul className="tree">
          <Folder path={entry.path} {...rest} />
        </ul>
      )}
    </li>
  );
}
