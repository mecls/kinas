// keymap.md, Crew page and Inbox page: on a focused inbox item, A approves, R opens the box to answer, D opens it to
// deny — never with a modifier (⌘ chords are the app's), never while the item's text box is open (the letters are the
// answer's there), never on an answered item (1.14: its actions are gone until Firstmate closes it), never while the
// terminal has focus (the item is not focused then).

export type InboxAction = "approve" | "answer" | "deny";

export function inboxKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }, item: { boxOpen: boolean; answered?: boolean }): InboxAction | null {
  if (item.boxOpen || item.answered || e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case "a":
    case "A":
      return "approve";
    case "r":
    case "R":
      return "answer";
    case "d":
    case "D":
      return "deny";
    default:
      return null;
  }
}
