import { captionFor, useTreeChanges } from "./changes.ts";

// What sits under a file tree's head (tree changes rule 11): one line saying how many changes since when, only while
// there are some — or that the root is not followed at all.

export function ChangesCaption({ root, name }: { root: string; name: string }) {
  const summary = useTreeChanges(root);
  const caption = summary && captionFor(summary, name);
  return caption ? <p className="tree-since">{caption}</p> : null;
}
