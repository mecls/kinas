import { RefreshIcon } from "../ui/index.ts";
import { captionFor, refreshRoot, useTreeChanges } from "./changes.ts";

// What sits on and under a file tree's head (tree changes rules 11 and 15): the ↻ that starts its count again, and one
// line saying how many changes since when — only while there are some — or that the root is not followed at all.
// The sidebar's Files head, an expanded pinned folder's row and the reader's own Files label each carry both.

/**
 * `--hit` square, like the terminal and pin buttons beside it: quiet until its head is pointed at, and always there
 * while the tree has marks (`data-marked`), so the way to clear them is in sight whenever there is something to clear.
 */
export function RefreshButton({ root, name }: { root: string; name: string }) {
  const summary = useTreeChanges(root);
  return (
    <button
      type="button"
      className="sidebar-row-action tree-refresh"
      data-marked={summary && summary.total > 0 ? "" : undefined}
      aria-label={`Refresh ${name}`}
      title={`Refresh ${name}: clear its changes and start counting again`}
      onClick={() => void refreshRoot(root)}
    >
      <RefreshIcon size="sm" />
    </button>
  );
}

export function ChangesCaption({ root, name }: { root: string; name: string }) {
  const summary = useTreeChanges(root);
  const caption = summary && captionFor(summary, name);
  return caption ? <p className="tree-since">{caption}</p> : null;
}
