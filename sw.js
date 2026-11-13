const CACHE = "patch-radar-v7";
const PREFS = "gpr-prefs";   // preferenze inviate dalla pagina (ore silenziose)
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "qr.js"];
// Siti esterni a cui una notifica può rimandare (oltre all'app stessa). Il payload arriva da un argomento ntfy pubblico:
// chiunque ne conosca il nome può scriverci, quindi non ci si fida mai di un link arbitrario.
const TRUSTED_ORIGINS = new Set(["https://store.steampowered.com", "https://steamcommunity.com"]);

// Chiave di cache senza query string: la pagina chiede «data/news.json?t=<ora>» e, con l'URL completo,
// ogni aggiornamento aggiungerebbe una copia da centinaia di KB che non verrebbe mai eliminata.
const keyOf = url => { const u = new URL(url); u.search = ""; u.hash = ""; return u.href; };

function safeTarget(raw) {
  try {
    const u = new URL(String(raw || ""), self.registration.scope);
    if (u.origin === location.origin || (u.protocol === "https:" && TRUSTED_ORIGINS.has(u.origin))) return u.href;
  } catch (err) {}
  return self.registration.scope;
}

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("patch-radar-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return; // Steam, proxy e traduzione: sempre dalla rete
  const key = keyOf(req.url);
  // Rete prima (così gli aggiornamenti dell'app arrivano subito), cache se offline
  e.respondWith(fetch(req, {cache: "no-cache"}).then(res => {
    if (res.status === 200 && res.type === "basic") {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {}));
    }
    return res;
  }).catch(async () => {
    const hit = await caches.match(key);
    if (hit) return hit;
    // Solo per le pagine si ripiega su index.html: a una richiesta di dati (JSON, script…) darebbe una risposta sbagliata
    return req.mode === "navigate" ? ((await caches.match("index.html")) || Response.error()) : Response.error();
  }));
});

// La pagina ci invia le ore silenziose: le conserviamo per quando arriva una notifica ad app chiusa
self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.type === "prefs") e.waitUntil(caches.open(PREFS).then(c => c.put("prefs", new Response(JSON.stringify(d.quiet || {})))));
});
async function isQuiet() {
  try {
    const r = await (await caches.open(PREFS)).match("prefs");
    const q = r ? await r.json() : null;
    if (!q || !q.on) return false;
    const mins = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
    const a = mins(q.from), b = mins(q.to), n = new Date(), t = n.getHours() * 60 + n.getMinutes();
    if (a === b) return false;
    return a < b ? (t >= a && t < b) : (t >= a || t < b);
  } catch (err) { return false; }
}

/* ---- Notifiche firmate ----
   L'argomento ntfy è pubblico (sta in config.json): chiunque potrebbe scrivervi. Per questo l'Action firma ogni notifica con
   una chiave Ed25519 privata (secret NTFY_SIGN_KEY) e qui si verifica la firma con la chiave pubblica di config.json
   (campo ntfySignKey). Senza quel campo la verifica è spenta; con il campo, le notifiche non firmate vengono scartate. */
const SIGN_VERSION = "patch-radar-v1";   // deve coincidere con scripts/fetch_news.py
const SIGN_MAX_AGE = 7 * 86400;          // una notifica firmata vecchia di oltre una settimana non è più valida (riproposta)
const b64u = s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const trimNl = s => String(s == null ? "" : s).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
const tagValue = (m, prefix) => ((Array.isArray(m.tags) ? m.tags : []).find(t => typeof t === "string" && t.startsWith(prefix)) || "").slice(prefix.length);

async function signKey() {
  const url = new URL("config.json", self.registration.scope).href;
  for (const get of [() => fetch(url, {cache: "no-cache"}), () => caches.match(url)]) {
    try { const r = await get(); if (r && r.ok !== false) return String((await r.json()).ntfySignKey || "").trim(); } catch (err) {}
  }
  return "";
}
// true: firma valida · false: assente, scaduta o non valida · null: questo browser non sa verificare Ed25519 (si accetta, restano i controlli sui link)
async function verifyMessage(m, pub) {
  const sig = tagValue(m, "sig:"), ts = Number(tagValue(m, "ts:"));
  if (!sig || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGN_MAX_AGE) return false;
  let raw;
  try { raw = b64u(pub); } catch (err) { return false; }
  if (raw.length !== 32) return false;     // chiave in config.json scritta male: meglio scartare che non controllare
  let key;
  try { key = await crypto.subtle.importKey("raw", raw, {name: "Ed25519"}, false, ["verify"]); }
  catch (err) { return err && err.name === "NotSupportedError" ? null : false; }   // solo «algoritmo non supportato» spegne il controllo
  try {
    const data = new TextEncoder().encode([SIGN_VERSION, trimNl(m.topic), trimNl(m.title), trimNl(m.message), trimNl(m.click), String(ts)].join("\n"));
    return await crypto.subtle.verify({name: "Ed25519"}, key, b64u(sig), data);
  } catch (err) { return false; }
}

// Notifiche push (inviate da ntfy.sh): mostra il messaggio ricevuto
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let d = {};
    try { d = e.data.json(); } catch (err) {}
    const m = d.message || {};
    const icon = new URL("icons/icon-192.png", self.registration.scope).href;
    const silent = await isQuiet();
    if (d.event === "message" && m) {
      const pub = await signKey();
      if (pub && (await verifyMessage(m, pub)) === false) {
        // Il browser vuole comunque una notifica per ogni push: se ne mostra una sola, muta e sempre la stessa (stesso tag)
        await self.registration.showNotification("Game Patch Radar", {body: "Ignorata una notifica non autentica.", icon, badge: icon, tag: "rejected", silent: true, data: {url: self.registration.scope}});
        return;
      }
      const sig = tagValue(m, "sig:");
      await self.registration.showNotification(String(m.title || "Game Patch Radar").slice(0, 120), {
        body: String(m.message || "Nuova pubblicazione").slice(0, 500), icon, badge: icon, tag: sig ? "sig-" + sig.slice(0, 24) : (m.id || undefined), silent,
        data: {url: safeTarget(m.click)}
      });
    } else {
      await self.registration.showNotification("Game Patch Radar", {body: "Apri l'app per tenere attive le notifiche.", icon, badge: icon, tag: "keepalive", data: {url: self.registration.scope}});
    }
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = safeTarget(e.notification.data && e.notification.data.url);
  e.waitUntil((async () => {
    // Se il link porta all'app si riporta in primo piano la finestra già aperta; verso Steam si apre sempre il link
    if (url.startsWith(self.registration.scope)) {
      const list = await clients.matchAll({type: "window", includeUncontrolled: true});
      for (const c of list) { if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus(); }
    }
    return clients.openWindow(url);
  })());
});
