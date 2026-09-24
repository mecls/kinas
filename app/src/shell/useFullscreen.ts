import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

// Whether the window is in full screen, for the title bar (DESIGN.md §4 Title bar): there the traffic lights are gone,
// and so is the room the bar keeps for them. macOS resizes the window on the way in and on the way out, so each resize
// is when to ask.

export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let live = true;
    const read = () =>
      void win.isFullscreen().then(
        (now) => live && setFullscreen(now),
        () => {},
      );
    read();
    const unlisten = win.onResized(read);
    return () => {
      live = false;
      void unlisten.then((stop) => stop());
    };
  }, []);
  return fullscreen;
}
