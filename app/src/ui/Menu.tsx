import { type CSSProperties, useEffect, useRef } from "react";
import { firstEnabled, itemsOf, menuKey } from "./menuKeys.ts";
import "./Menu.css";

export interface MenuItem {
  id: string;
  label: string;
  /** Why this cannot be used right now. Shown as the tooltip; the item stays in place, skipped by the arrows. */
  disabledReason?: string | null;
  onSelect: () => void;
}

/** A hairline between groups of items. Not an item: the arrows never land on it. */
export interface MenuDivider {
  id: string;
  divider: true;
}

export type MenuEntry = MenuItem | MenuDivider;

const isItem = (entry: MenuEntry): entry is MenuItem => !("divider" in entry);

/**
 * DESIGN.md §4 Menu (1.3): the reader's ▾ menu (three-column shell §9), moved into the library when the client folders'
 * right-click needed one too. No library: a dozen lines of focus handling and the pure key table in menuKeys.ts. Its
 * place is the caller's (`className`, `style`) — under the ▾ for the reader, at the pointer for the sidebar.
 *
 * It takes focus when it opens and gives it back when it closes. Both halves matter. WebKit does not focus a button
 * when it is clicked, so with the terminal focused the keys would otherwise keep going to the PTY — Esc and the
 * arrows included — while a menu sat open on screen. And the terminal must get its keys back afterwards, or a menu
 * opened by accident would silently swallow what Miguel types next.
 */
export function Menu({ items, onClose, label, className, style }: { items: MenuEntry[]; onClose: () => void; label: string; className?: string; style?: CSSProperties }) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const actions: MenuItem[] = itemsOf(items);

  useEffect(() => {
    const el = root.current;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const buttons = () => [...(el?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const first = firstEnabled(buttons().map((b) => b.getAttribute("aria-disabled") !== "true"));
    // Even a menu with nothing usable takes the keys, so Esc reaches it and not the PTY.
    (first >= 0 ? buttons()[first] : el)?.focus({ preventScroll: true });

    const onPointerDown = (e: PointerEvent) => {
      // The ▾ button toggles the menu itself; treating its press as "outside" would close and at once reopen it.
      if (e.target instanceof Element && (el?.contains(e.target) || e.target.closest("[aria-haspopup='menu']"))) return;
      close.current();
    };
    // A click inside the HTML preview's sandboxed frame never reaches this document, but it does blur the window.
    const onBlur = () => close.current();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      // Give the keys back, unless something else has deliberately taken them since (Open in editor focuses the
      // terminal): only when focus is still inside the menu, or was dropped to the body as the menu left the page.
      const active = document.activeElement;
      if (returnTo?.isConnected && (active === null || active === document.body || el?.contains(active))) returnTo.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // ⌘ chords stay the app's (⌘K, ⌘1…); everything else is the menu's.
    if (e.metaKey) return;
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const enabled = buttons.map((b) => b.getAttribute("aria-disabled") !== "true");
    const current = buttons.findIndex((b) => b === document.activeElement);
    const result = menuKey(e.key, current, enabled);
    e.stopPropagation();
    if (result.kind !== "none" || e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
    // The buttons are the items in order, dividers left out, so an index into one is an index into the other.
    if (result.kind === "focus") buttons[result.index]?.focus({ preventScroll: true });
    else if (result.kind === "activate") select(actions[result.index]);
    else if (result.kind === "close") onClose();
  };

  const select = (item: MenuItem | undefined) => {
    if (!item || item.disabledReason) return;
    onClose();
    item.onSelect();
  };

  return (
    <div className={className ? `ui-menu ${className}` : "ui-menu"} role="menu" aria-label={label} tabIndex={-1} ref={root} style={style} onKeyDown={onKeyDown}>
      {items.map((entry) =>
        isItem(entry) ? (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className="ui-menu-item"
            data-item={entry.id}
            aria-disabled={entry.disabledReason ? "true" : undefined}
            title={entry.disabledReason ?? undefined}
            tabIndex={-1}
            onClick={() => select(entry)}
          >
            {entry.label}
          </button>
        ) : (
          <div key={entry.id} className="ui-menu-divider" role="separator" />
        ),
      )}
    </div>
  );
}
