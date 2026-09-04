// Pump Trader service worker.
// Caches the shell so the app boots offline, and supports the
// "background push" notifications fired by /api/push endpoints.
const SHELL_CACHE = "pump-trader-shell-v1";
const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  // Network-first for HTML so users always get the latest deployment.
  if (event.request.mode === "navigate" || event.request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(event.request).then((c) => c || caches.match("/"))),
    );
    return;
  }
  // Cache-first for static assets.
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy)).catch(() => undefined);
            return res;
          })
          .catch(() => cached),
    ),
  );
});

// Notification click: focus or open the relevant page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = typeof data.url === "string" ? data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.postMessage({ type: "pump-trader:focus", url: target });
          return w.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});

// Notification action buttons (e.g. "Stop bot" / "View position").
self.addEventListener("notificationclose", (event) => {
  const data = event.notification.data || {};
  if (data.dismissEndpoint) {
    // Best-effort: notify the app that the user dismissed the action.
    fetch(data.dismissEndpoint, { method: "POST" }).catch(() => undefined);
  }
});

self.addEventListener("message", (event) => {
  // Allow the page to trigger a test notification.
  if (event.data && event.data.type === "show-test-notification") {
    self.registration.showNotification("Pump Trader", {
      body: "Notifications are enabled.",
      icon: "/icons/icon-192.svg",
      badge: "/icons/favicon.svg",
    });
  }
});
