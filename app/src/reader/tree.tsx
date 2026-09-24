import { type ReactNode, useEffect, useState } from "react";
import { type DirEntry, type DirListing, readerListDir } from "../api.ts";
import { ChangeMark } from "../ui/index.ts";
import { type FolderMarks, useFolderMarks, watchRoot, wordsFor } from "./changes.ts";

// The folder tree (reader R35): one folder at a time from Rust, children loaded when a folder is expanded. It starts at
// the folder that was opened and cannot go above it.
//
// Every mount follows its root's changes (tree changes rule 12): a changed row carries a Change mark beside its button,
// and the mark's words become the button's accessible name. The button's text and title never change — specs find
// rows by them.

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

type Listing = "loading" | { error: true } | DirListing;

/** What to draw beside a folder's row — the sidebar's pin and terminal buttons. The tree itself knows nothing of them. */
export type FolderActions = (path: string, name: string) => ReactNode;

interface TreeProps {
  selected: string | null;
  onOpen: (path: string) => void;
  folderActions?: FolderActions;
  marks: FolderMarks;
}

export function FileTree({ root, ...rest }: Omit<TreeProps, "marks"> & { root: string }) {
  // Once per root per page load; nothing unwatches on unmount — a root stays followed until a reload (rule 2).
  useEffect(() => watchRoot(root), [root]);
  const marks = useFolderMarks(root);
  return (
    <ul className="tree">
      <Folder path={root} {...rest} marks={marks} top />
    </ul>
  );
}

function Folder({ path, top = false, ...rest }: TreeProps & { path: string; top?: boolean }) {
  const { selected, onOpen, marks } = rest;
  const [listing, setListing] = useState<Listing>("loading");

  useEffect(() => {
    let live = true;
    setListing("loading");
    readerListDir(path).then(
      (l) => live && setListing(l),
      () => live && setListing({ error: true }),
    );
    return () => {
      live = false;
    };
  }, [path]);

  if (listing === "loading") return <li className="tree-note">Loading…</li>;
  if ("error" in listing) return <li className="tree-note">Could not read this folder</li>;
  if (top && listing.entries.length === 0) return <li className="tree-note">Nothing to open in {baseName(path)}</li>;
  return (
    <>
      {listing.entries.map((entry) =>
        entry.kind === "dir" ? (
          <FolderNode key={entry.path} entry={entry} {...rest} />
        ) : (
          <FileRow key={entry.path} entry={entry} selected={selected} onOpen={onOpen} marks={marks} />
        ),
      )}
      {listing.more > 0 && <li className="tree-note">{listing.more} more not shown</li>}
    </>
  );
}

function FileRow({ entry, selected, onOpen, marks }: Pick<TreeProps, "selected" | "onOpen" | "marks"> & { entry: DirEntry }) {
  const change = marks.entryOf(entry.path);
  const words = wordsFor(entry.name, change, marks.since);
  return (
    <li>
      <div className="tree-row" data-mark={change?.mark}>
        <button
          type="button"
          className="tree-item tree-file"
          aria-current={entry.path === selected ? "true" : undefined}
          aria-label={words ?? undefined}
          title={entry.path}
          onClick={() => onOpen(entry.path)}
        >
          {entry.name}
        </button>
        {change && words && <ChangeMark mark={change.mark} words={words} />}
      </div>
    </li>
  );
}

function FolderNode({ entry, ...rest }: TreeProps & { entry: DirEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      {/* The row is always there, actions or not, so the tree has one shape wherever it is mounted. The nested list
          stays the row's sibling: `.tree .tree` indents it, and a list inside the row would sit beside the name. */}
      <div className="tree-row">
        <button type="button" className="tree-item tree-dir" aria-expanded={expanded} title={entry.path} onClick={() => setExpanded((e) => !e)}>
          <span className="tree-caret" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          {entry.name}
        </button>
        {rest.folderActions?.(entry.path, entry.name)}
      </div>
      {expanded && (
        <ul className="tree">
          <Folder path={entry.path} {...rest} />
        </ul>
      )}
    </li>
  );
}
