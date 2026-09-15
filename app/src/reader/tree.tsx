import { useEffect, useState } from "react";
import { type DirEntry, type DirListing, readerListDir } from "../api.ts";

// The folder tree (reader R35): one folder at a time from Rust, children loaded when a folder is expanded. It starts at
// the folder that was opened and cannot go above it.

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

type Listing = "loading" | { error: true } | DirListing;

export function FileTree({ root, selected, onOpen }: { root: string; selected: string | null; onOpen: (path: string) => void }) {
  return (
    <ul className="tree">
      <Folder path={root} selected={selected} onOpen={onOpen} top />
    </ul>
  );
}

function Folder({ path, selected, onOpen, top = false }: { path: string; selected: string | null; onOpen: (path: string) => void; top?: boolean }) {
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
  if (top && listing.entries.length === 0) return <li className="tree-note">No markdown files in {baseName(path)}</li>;
  return (
    <>
      {listing.entries.map((entry) =>
        entry.kind === "dir" ? (
          <FolderNode key={entry.path} entry={entry} selected={selected} onOpen={onOpen} />
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

function FolderNode({ entry, selected, onOpen }: { entry: DirEntry; selected: string | null; onOpen: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      <button type="button" className="tree-item tree-dir" aria-expanded={expanded} title={entry.path} onClick={() => setExpanded((e) => !e)}>
        <span className="tree-caret" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        {entry.name}
      </button>
      {expanded && (
        <ul className="tree">
          <Folder path={entry.path} selected={selected} onOpen={onOpen} />
        </ul>
      )}
    </li>
  );
}
