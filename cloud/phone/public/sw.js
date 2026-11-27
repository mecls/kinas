// The phone page's service worker (build spec §11, slice 9.2): it shows a push and opens the page from a tap, and does
// nothing else — no cache, no fetch handler, no background sync. A push carries a title, a body and an address on the
// page; anything else in it is ignored, and an address off the page becomes Home.

const ADDRESS = /^\/(#item=[A-Za-z0-9%._-]{1,400})?$/;

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  // A body of `null`, a number or a list is JSON too: it has no fields, so it is an empty push.
  if (data === null || typeof data !== "object") data = {};
  const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "");
  const title = text(data.title, 200) || "Kinas";
  const body = text(data.body, 120);
  const url = typeof data.url === "string" && ADDRESS.test(data.url) ? data.url : "/";
  event.waitUntil(self.registration.showNotification(title, { body, data: { url }, tag: url, icon: "/icon-256.png" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const url = typeof raw === "string" && ADDRESS.test(raw) ? raw : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) {
          if ("navigate" in w) w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
