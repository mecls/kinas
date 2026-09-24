import { BackIcon, ForwardIcon, SidebarIcon } from "./icons.tsx";
import "./TitleBar.css";

// DESIGN.md §4 Title bar (1.5, the reader's layout): the window's own title bar, drawn over macOS's hidden one, which
// keeps its traffic lights (tauri.conf.json: titleBarStyle Overlay). Presentation only — App owns the sidebar and the
// places ← and → walk. Click-only (keymap.md): a press on the bar is kept from moving focus, so the terminal keeps the
// keys.
//
// Every pixel but a button drags the window and zooms it on a double-click: Tauri's drag script (tauri 2.11.5,
// window/scripts/drag.js) reads `data-tauri-drag-region="deep"` on the header as "the whole subtree", and stops at any
// button that carries no attribute of its own. So no button here may ever carry one (TitleBar.test.ts).

/** One of the three buttons: what it is called, what its tooltip says, and whether it can act. */
function BarButton({ label, title, enabled, onClick, children }: { label: string; title: string; enabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="ui-titlebar-button"
      aria-label={label}
      // aria-disabled rather than disabled, as the reader's Copy and the Menu do, so the tooltip still says why.
      aria-disabled={enabled ? undefined : "true"}
      title={title}
      onClick={() => enabled && onClick()}
    >
      {children}
    </button>
  );
}

export function TitleBar({
  sidebarShown,
  sidebarChord,
  onSidebar,
  canBack,
  canForward,
  onBack,
  onForward,
  fullscreen,
}: {
  sidebarShown: boolean;
  /** The chord Settings has bound to Hide or show the sidebar, for the tooltip ("⌘S"). */
  sidebarChord: string;
  onSidebar: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** In full screen the traffic lights are gone, and so is the room kept for them. */
  fullscreen: boolean;
}) {
  const sidebarAction = sidebarShown ? "Hide the sidebar" : "Show the sidebar";
  return (
    <header className="ui-titlebar" data-tauri-drag-region="deep" data-fullscreen={fullscreen ? "" : undefined} onMouseDown={(e) => e.preventDefault()}>
      {/* The traffic lights are the system's, drawn over this room; it drags like the rest of the bar. */}
      <div className="ui-titlebar-lights" />
      <BarButton label={sidebarAction} title={`${sidebarAction} (${sidebarChord})`} enabled onClick={onSidebar}>
        <SidebarIcon />
      </BarButton>
      <BarButton label="Back" title={canBack ? "Back" : "Nothing to go back to"} enabled={canBack} onClick={onBack}>
        <BackIcon />
      </BarButton>
      <BarButton label="Forward" title={canForward ? "Forward" : "Nothing to go forward to"} enabled={canForward} onClick={onForward}>
        <ForwardIcon />
      </BarButton>
    </header>
  );
}
