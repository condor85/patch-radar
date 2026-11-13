// Test del service worker, senza dipendenze:  node tests/sw.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const SCOPE = "https://utente.github.io/patch-radar/";
const ORIGIN = "https://utente.github.io";

function makeWorker() {
  const handlers = {}, stores = new Map(), shown = [], opened = [], focused = [];
  let windows = [];
  const keyOf = k => (typeof k === "string" ? k : k.url);
  const cacheApi = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return { put: async (k, r) => { m.set(keyOf(k), r); }, match: async k => m.get(keyOf(k)), addAll: async () => {} };
    },
    async match(k) { for (const m of stores.values()) if (m.has(keyOf(k))) return m.get(keyOf(k)); return undefined; },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
  };
  const self = {
    registration: { scope: SCOPE, showNotification: async (title, opt) => { shown.push({ title, ...opt }); } },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async u => { opened.push(u); } },
  };
  const ctx = { self, caches: cacheApi, location: { origin: ORIGIN }, clients: self.clients, URL, Response, Request, console, Date, crypto: globalThis.crypto, atob, TextEncoder };
  ctx.fetchImpl = async () => { throw new TypeError("offline"); };
  ctx.fetch = (...a) => ctx.fetchImpl(...a);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"), ctx);
  const waits = [];
  const fire = (type, ev) => { ev.waitUntil = p => waits.push(p); handlers[type](ev); return Promise.all(waits.splice(0)); };
  return { ctx, stores, shown, opened, focused, fire, handlers, setWindows: w => { windows = w; } };
}

const basic = (body, status = 200) => { const r = new Response(body, { status }); Object.defineProperty(r, "type", { value: "basic" }); return r; };
const request = (url, mode = "cors") => ({ url, method: "GET", mode });
async function doFetch(w, url, mode) {
  let out; const ev = { request: request(url, mode), respondWith: p => { out = p; } };
  w.handlers.fetch(ev); ev.waitUntil = ev.waitUntil || (() => {});
  return out;
}

(async () => {
  let n = 0; const t = async (name, fn) => { await fn(); n++; console.log("ok  -", name); };

  await t("la cache non cresce con le query string (data/news.json?t=...)", async () => {
    const w = makeWorker();
    w.ctx.fetchImpl = async () => basic("{}");
    for (const q of [1, 2, 3, 4, 5]) {
      let out; const waits = [];
      w.handlers.fetch({ request: request(`${SCOPE}data/news.json?t=${q}`), respondWith: p => { out = p; }, waitUntil: p => waits.push(p) });
      await out; await Promise.all(waits);
    }
    const app = w.stores.get("patch-radar-v7");
    assert.deepEqual([...app.keys()], [`${SCOPE}data/news.json`]);
  });

  await t("offline: i dati si servono dalla copia salvata, anche con un ?t= diverso", async () => {
    const w = makeWorker();
    w.ctx.fetchImpl = async () => basic('{"games":[1]}');
    let out; const waits = [];
    w.handlers.fetch({ request: request(`${SCOPE}data/news.json?t=1`), respondWith: p => { out = p; }, waitUntil: p => waits.push(p) });
    await out; await Promise.all(waits);
    w.ctx.fetchImpl = async () => { throw new TypeError("offline"); };
    const res = await doFetch(w, `${SCOPE}data/news.json?t=999`);
    assert.equal(await res.text(), '{"games":[1]}');
  });

  await t("offline: una richiesta di dati non in cache fallisce, non riceve index.html", async () => {
    const w = makeWorker();
    const res = await doFetch(w, `${SCOPE}data/news.json?t=1`);
    assert.equal(res.type, "error");
  });

  await t("offline: una pagina non in cache ripiega su index.html", async () => {
    const w = makeWorker();
    const c = await w.ctx.caches.open("patch-radar-v7"); await c.put("index.html", basic("<html>shell</html>"));
    const res = await doFetch(w, `${SCOPE}`, "navigate");
    assert.equal(await res.text(), "<html>shell</html>");
  });

  await t("non salva le risposte di errore", async () => {
    const w = makeWorker();
    w.ctx.fetchImpl = async () => basic("no", 404);
    let out; const waits = [];
    w.handlers.fetch({ request: request(`${SCOPE}x.json`), respondWith: p => { out = p; }, waitUntil: p => waits.push(p) });
    await out; await Promise.all(waits);
    assert.equal(w.stores.get("patch-radar-v7"), undefined);
  });

  await t("le richieste verso altri siti non passano dal service worker", async () => {
    const w = makeWorker(); let called = false;
    w.handlers.fetch({ request: request("https://api.steampowered.com/x"), respondWith: () => { called = true; } });
    assert.equal(called, false);
  });

  const push = (w, click) => w.fire("push", { data: { json: () => ({ event: "message", message: { id: "m1", title: "Valheim: nuovo aggiornamento", message: "Patch", click } }) } });

  await t("notifica con link di phishing: il link viene scartato", async () => {
    for (const bad of ["https://evil.example/login", "http://store.steampowered.com/app/1/", "javascript:alert(1)", "https://store.steampowered.com.evil.example/", "//evil.example/x"]) {
      const w = makeWorker(); await push(w, bad);
      assert.equal(w.shown[0].data.url, SCOPE, bad);
    }
  });

  await t("notifica con link legittimi: sito dell'app e negozio Steam restano", async () => {
    for (const ok of [SCOPE, "https://store.steampowered.com/app/892970/"]) {
      const w = makeWorker(); await push(w, ok);
      assert.equal(w.shown[0].data.url, ok);
    }
    const w = makeWorker(); await push(w, undefined);
    assert.equal(w.shown[0].data.url, SCOPE);
  });

  await t("titolo e testo troppo lunghi vengono troncati", async () => {
    const w = makeWorker();
    await w.fire("push", { data: { json: () => ({ event: "message", message: { id: "m", title: "T".repeat(1000), message: "B".repeat(5000) } }) } });
    assert.equal(w.shown[0].title.length, 120); assert.equal(w.shown[0].body.length, 500);
  });

  await t("click: anche dati manomessi non aprono siti non fidati", async () => {
    const w = makeWorker(); let closed = false;
    await w.fire("notificationclick", { notification: { close: () => { closed = true; }, data: { url: "https://evil.example/" } } });
    assert.equal(closed, true); assert.deepEqual(w.opened, [SCOPE]);
  });

  await t("click verso Steam apre il negozio anche con l'app già aperta", async () => {
    const w = makeWorker(); w.setWindows([{ url: SCOPE, focus: () => w.focused.push(1) }]);
    await w.fire("notificationclick", { notification: { close() {}, data: { url: "https://store.steampowered.com/app/1/" } } });
    assert.deepEqual(w.opened, ["https://store.steampowered.com/app/1/"]); assert.equal(w.focused.length, 0);
  });

  await t("click verso l'app riporta in primo piano la finestra aperta", async () => {
    const w = makeWorker(); w.setWindows([{ url: SCOPE, focus: () => w.focused.push(1) }]);
    await w.fire("notificationclick", { notification: { close() {}, data: { url: SCOPE } } });
    assert.equal(w.focused.length, 1); assert.equal(w.opened.length, 0);
  });

  await t("attivazione: elimina le vecchie cache (anche quella gonfiata della v6)", async () => {
    const w = makeWorker();
    await w.ctx.caches.open("patch-radar-v6"); await w.ctx.caches.open("patch-radar-v7"); await w.ctx.caches.open("gpr-prefs");
    await w.fire("activate", {});
    assert.deepEqual([...w.stores.keys()].sort(), ["gpr-prefs", "patch-radar-v7"]);
  });


  // ---- Notifiche firmate: le firme le produce il vero codice Python del server (scripts/fetch_news.py) ----
  const ROOT = path.join(__dirname, "..");
  const SEED = Buffer.alloc(32, 7).toString("base64url");
  const py = `
import sys, json, os
sys.path.insert(0, "scripts")
import fetch_news as fn, ed25519
os.environ["NTFY_SIGN_KEY"] = ${JSON.stringify(SEED)}
spec = json.loads(sys.argv[1])
print(json.dumps({"pub": fn._b64u(ed25519.public_key(bytes([7]) * 32)), "tags": fn.signed_tags(spec["topic"], spec["title"], spec["message"], spec["click"], ["video_game"], spec.get("ts"))}))`;
  const signed = spec => JSON.parse(execFileSync("python3", ["-c", py, JSON.stringify(spec)], { cwd: ROOT }).toString());
  const BASE = { topic: "patch-radar-abc-892970", title: "Valheim: nuovo aggiornamento", message: "Patch 0.221\n• Correzioni", click: SCOPE };
  const msgOf = (spec, over = {}) => ({ id: "x1", event: "message", topic: spec.topic, title: spec.title, message: spec.message, click: spec.click, tags: signed(spec).tags, ...over });
  const pushMsg = (w, m) => w.fire("push", { data: { json: () => ({ event: "message", message: m }) } });
  const withKey = async (pub, w = makeWorker()) => { w.ctx.fetchImpl = async () => basic(JSON.stringify(pub === undefined ? {} : { ntfyTopic: "t", ntfySignKey: pub })); return w; };

  await t("firma: la notifica firmata dall'Action (Python) viene accettata da WebCrypto", async () => {
    const { pub } = signed({ ...BASE, ts: Math.floor(Date.now() / 1000) });
    const w = await withKey(pub);
    await pushMsg(w, msgOf({ ...BASE, ts: Math.floor(Date.now() / 1000) }));
    assert.equal(w.shown.length, 1); assert.equal(w.shown[0].title, BASE.title); assert.notEqual(w.shown[0].tag, "rejected");
  });

  await t("firma: spazi e a capo ai bordi aggiunti o tolti dal server non la invalidano", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000) };
    const { pub } = signed(spec); const w = await withKey(pub);
    await pushMsg(w, msgOf(spec, { message: "  " + spec.message + "\n\n" }));
    assert.notEqual(w.shown[0].tag, "rejected");
  });

  await t("firma: con la chiave configurata, una notifica NON firmata viene scartata", async () => {
    const { pub } = signed({ ...BASE }); const w = await withKey(pub);
    await pushMsg(w, { id: "x", event: "message", topic: BASE.topic, title: "Valheim: nuovo aggiornamento", message: "Scarica subito", click: "https://evil.example/", tags: ["video_game"] });
    assert.equal(w.shown.length, 1); assert.equal(w.shown[0].tag, "rejected"); assert.equal(w.shown[0].silent, true);
    assert.equal(w.shown[0].title, "Game Patch Radar");
  });

  await t("firma: qualunque campo alterato (titolo, testo, link, argomento) invalida la notifica", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000) };
    const { pub } = signed(spec);
    for (const over of [{ title: "Altro" }, { message: "Altro" }, { click: "https://evil.example/" }, { topic: "altro-argomento" }]) {
      const w = await withKey(pub); await pushMsg(w, msgOf(spec, over));
      assert.equal(w.shown[0].tag, "rejected", JSON.stringify(over));
    }
  });

  await t("firma: una notifica firmata ma troppo vecchia (riproposta) viene scartata", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000) - 8 * 86400 };
    const { pub } = signed(spec); const w = await withKey(pub);
    await pushMsg(w, msgOf(spec));
    assert.equal(w.shown[0].tag, "rejected");
  });

  await t("firma: firmata con un'altra chiave = scartata", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000) };
    const other = Buffer.alloc(32, 9).toString("base64url");     // chiave pubblica non corrispondente (valore qualunque di 32 byte)
    const w = await withKey(other); await pushMsg(w, msgOf(spec));
    assert.equal(w.shown[0].tag, "rejected");
  });

  await t("firma: chiave scritta male in config.json = si scarta (non si disattiva il controllo in silenzio)", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000) };
    const w = await withKey("chiave-sbagliata"); await pushMsg(w, msgOf(spec));
    assert.equal(w.shown[0].tag, "rejected");
  });

  await t("firma: senza chiave in config.json la verifica è spenta (fase di avvio)", async () => {
    const w = await withKey(undefined);
    await pushMsg(w, { id: "x", event: "message", topic: "t", title: "Non firmata", message: "ok", tags: [] });
    assert.equal(w.shown[0].title, "Non firmata");
  });

  await t("firma: browser senza Ed25519 -> si accetta, restano i controlli sui link", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000), click: "https://evil.example/" };
    const { pub } = signed(spec); const w = await withKey(pub);
    w.ctx.crypto = { subtle: { importKey: async () => { throw Object.assign(new Error("Unrecognized name"), { name: "NotSupportedError" }); } } };
    await pushMsg(w, msgOf(spec));
    assert.equal(w.shown[0].title, BASE.title); assert.equal(w.shown[0].data.url, SCOPE);   // il link non fidato viene comunque scartato
  });

  await t("firma: errore di importazione diverso da «non supportato» = si scarta", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000) };
    const { pub } = signed(spec); const w = await withKey(pub);
    w.ctx.crypto = { subtle: { importKey: async () => { throw Object.assign(new Error("dati non validi"), { name: "DataError" }); } } };
    await pushMsg(w, msgOf(spec));
    assert.equal(w.shown[0].tag, "rejected");
  });

  await t("firma: offline si usa la copia di config.json salvata (la verifica non si spegne)", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000) };
    const { pub } = signed(spec); const w = makeWorker();
    const c = await w.ctx.caches.open("patch-radar-v7");
    await c.put(`${SCOPE}config.json`, basic(JSON.stringify({ ntfySignKey: pub })));
    await pushMsg(w, { id: "x", event: "message", topic: "t", title: "Falsa", message: "x", tags: [] });
    assert.equal(w.shown[0].tag, "rejected");
  });

  await t("firma: la stessa notifica riproposta si sostituisce invece di duplicarsi (stesso tag)", async () => {
    const spec = { ...BASE, ts: Math.floor(Date.now() / 1000) };
    const { pub } = signed(spec); const w = await withKey(pub);
    const m = msgOf(spec); await pushMsg(w, m); await pushMsg(w, { ...m, id: "altro-id" });
    assert.equal(w.shown[0].tag, w.shown[1].tag);
  });

  console.log(`\n${n} test passati`);
})().catch(e => { console.error(e); process.exit(1); });
