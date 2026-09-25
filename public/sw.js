// MulmoGlass service worker. It only makes the app installable as a PWA:
// every request goes to the network unchanged. (presentHtml pages can't be
// served from here: Chrome doesn't route a sandboxed iframe's navigation
// through a service worker, so src/host/htmlFrames.ts delivers them.)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", () => {});
