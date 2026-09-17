// The highest migration version this build knows. The CLI refuses a store newer than this (R10),
// because the CLI and the app ship in one bundle: a newer store means a stale ~/.local/bin link.
export const SCHEMA_VERSION = 3;
