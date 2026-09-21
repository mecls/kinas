import { type ReactNode, useEffect, useState } from "react";
import { type DirEntry, type DirListing, readerListDir } from "../api.ts";

// The folder tree (reader R35): one folder at a time from Rust, children loaded when a folder is expanded. It starts at
// the folder that was opened and cannot go above it.

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

type Listing = "loading" | { error: true } | DirListing;

/** What to draw beside a folder's row — the sidebar's pin and terminal buttons. The tree itself knows nothing of them. */
export type FolderActions = (path: string, name: string) => ReactNode;

interface TreeProps {
  selected: string | null;
  onOpen: (path: string) => void;
  folderActions?: FolderActions;
}

export function FileTree({ root, ...rest }: TreeProps & { root: string }) {
  return (
    <ul className="tree">
      <Folder path={root} {...rest} top />
    </ul>
  );
}

function Folder({ path, top = false, ...rest }: TreeProps & { path: string; top?: boolean }) {
  const { selected, onOpen } = rest;
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
          <li key={entry.path}>
            <button type="button" className="tree-item tree-file" aria-current={entry.path === selected ? "true" : undefined} title={entry.path} onClick={() => onOpen(entry.path)}>
              {entry.name}
            </button>
          </li>
        ),
      )}
      {listing.more > 0 && <li className="tree-note">{listing.more} more not shown</li>}
    </>
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
