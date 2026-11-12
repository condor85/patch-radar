const CACHE = "patch-radar-v3";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return; // Steam, proxy e traduzione: sempre dalla rete
  // Rete prima (così gli aggiornamenti dell'app arrivano subito), cache se offline
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
});

// Notifiche push (inviate da ntfy.sh): mostra il messaggio ricevuto
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let d = {};
    try { d = e.data.json(); } catch (err) {}
    const m = d.message || {};
    const icon = new URL("icons/icon-192.png", self.registration.scope).href;
    if (d.event === "message" && m) {
      await self.registration.showNotification(m.title || "Game Patch Radar", {
        body: m.message || "Nuova pubblicazione", icon, badge: icon, tag: m.id || undefined,
        data: {url: m.click || self.registration.scope}
      });
    } else {
      await self.registration.showNotification("Game Patch Radar", {body: "Apri l'app per tenere attive le notifiche.", icon, badge: icon, tag: "keepalive", data: {url: self.registration.scope}});
    }
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const list = await clients.matchAll({type: "window", includeUncontrolled: true});
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus(); }
    return clients.openWindow(url);
  })());
});
