// The device's token, in the home-screen app's own storage (build spec §10): never in an address after pairing. Storage can
// be missing or throw (a private window, cleared site data), so every touch is guarded and the page works without it.

const KEY = "kinas.token";

export function readToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string): boolean {
  try {
    localStorage.setItem(KEY, token);
    return true;
  } catch {
    return false;
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
