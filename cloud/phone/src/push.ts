// Allowing notifications from the phone (build spec §11.3 F, slice 9.2): register the worker, ask once on a tap, subscribe
// with the deployment's public VAPID key, and hand the subscription to the store. The conversions are pure.

/** A base64url string as the bytes `pushManager.subscribe` wants for its application server key. */
export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Bytes as base64url, no padding: how the store keeps a subscription's two keys. */
export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array | null): string {
  if (bytes === null) return "";
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...u)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export interface StoredSubscription { endpoint: string; p256dh: string; auth: string }

/** What the store keeps of a `PushSubscription`: its address and its two keys. */
export function subscriptionOf(sub: { endpoint: string; getKey: (name: "p256dh" | "auth") => ArrayBuffer | null }): StoredSubscription {
  return { endpoint: sub.endpoint, p256dh: bytesToBase64Url(sub.getKey("p256dh")), auth: bytesToBase64Url(sub.getKey("auth")) };
}

export type PushState = "unsupported" | "needs-home-screen" | "blocked" | "off" | "on";

/** Where this browser stands: iOS only pushes from a page added to the home screen. */
export function pushState(env: { hasPush: boolean; standalone: boolean; ios: boolean; permission: NotificationPermission | "none"; subscribed: boolean }): PushState {
  if (!env.hasPush) return env.ios && !env.standalone ? "needs-home-screen" : "unsupported";
  if (env.permission === "denied") return "blocked";
  return env.permission === "granted" && env.subscribed ? "on" : "off";
}

export const PUSH_WORDS: Record<PushState, string> = {
  unsupported: "This browser can't show notifications.",
  "needs-home-screen": "Add this page to the home screen, then open it from there to allow notifications.",
  blocked: "Notifications are blocked for this page. Allow them in Settings → Notifications.",
  off: "Notifications are off.",
  on: "Notifications are on.",
};

/** Register the worker and subscribe; throws if the person says no or the browser can't. Called from a tap, once. */
export async function allowNotifications(publicKey: string): Promise<StoredSubscription> {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== "granted") throw new Error("denied");
  const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
  return subscriptionOf(sub);
}

/** Whether this browser has a subscription now, without asking for anything. */
export async function currentState(): Promise<PushState> {
  const hasPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = (navigator as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  let subscribed = false;
  if (hasPush) {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      subscribed = (await reg?.pushManager.getSubscription()) != null;
    } catch {
      subscribed = false;
    }
  }
  return pushState({ hasPush, standalone, ios, permission: hasPush ? Notification.permission : "none", subscribed });
}
