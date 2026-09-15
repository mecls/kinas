// The CLI ships inside the app, so its version is the app's.
import tauri from "../../../app/src-tauri/tauri.conf.json" with { type: "json" };

export const KINAS_VERSION: string = tauri.version;
