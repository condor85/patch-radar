// Test della sincronizzazione lato app (blocco SYNC-CLIENT di index.html) contro il ponte vero (worker/worker.js).
// Due «dispositivi» finti, ognuno con il suo localStorage e il suo stato. Esecuzione: node tests/sync-client.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import worker, {Team} from "../worker/worker.js";

const src = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const m = src.match(/\/\* SYNC-CLIENT:start \*\/([\s\S]*?)\/\* SYNC-CLIENT:end \*\//);
assert(m, "blocco SYNC-CLIENT non trovato in index.html");

const ORIGIN = "https://condor85.github.io", BRIDGE = "https://ponte.example.workers.dev";
class MockStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined; }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async delete(k) { this.m.delete(k); }
  async setAlarm() {}
}
const teams = new Map();
const env = {
  ADMIN_PASSWORD: "una-password-lunga-12", GITHUB_TOKEN: "x", REPO: "condor85/patch-radar", ALLOWED_ORIGIN: ORIGIN,
  TEAM: {idFromName: n => n, get: n => ({fetch: (url, init) => { if (!teams.has(n)) teams.set(n, new Team({storage: new MockStorage()})); return teams.get(n).fetch(new Request(url, init)); }})}
};

/* Un dispositivo: lo stato dell'app (letto, salvati…) più il blocco di sincronizzazione, con le parti esterne finte. */
let nextIp = 10;
function device({online = true} = {}) {
  const ls = new Map(), ip = "7.7.7." + nextIp++;   // ogni dispositivo ha il suo indirizzo (il ponte limita i codici creati per indirizzo)
  const log = {toasts: [], redraws: 0, calls: 0};
  const factory = new Function("localStorage", "fetch", "log", "confirmFn", `
    let seen = {}, saved = [], savedRemoved = {}, savedView = false, seenSnap = "", CFG = {adminApi: "${BRIDGE}"};
    const REMOVED_KEY = "game_patch_radar_savedremoved_v1";
    const bridgeUrl = () => CFG.adminApi;
    const $ = () => null, h = () => ({}), mkBtn = () => ({}), toast = t => log.toasts.push(t);
    const refreshViews = () => log.redraws++, updateTitle = () => {}, inviteUrl = () => "https://x/", openManager = () => {};
    const confirm = confirmFn, location = {hash: "", pathname: "/", search: ""}, history = {replaceState() {}};
    function persistSaved(quiet) { localStorage.setItem("s", JSON.stringify(saved)); localStorage.setItem(REMOVED_KEY, JSON.stringify(savedRemoved)); if (!quiet) syncSoon(); }
    function saveSeen() { const snap = JSON.stringify(seen); if (snap !== seenSnap) { seenSnap = snap; syncSoon(); } }
    ${m[1]}
    return {
      syncNow, syncCreate, syncJoin, syncUnlink, applySync, syncPayload, loadSync,
      get sync() { return sync; }, get err() { return syncErr; },
      get seen() { return seen; }, set seen(v) { seen = v; }, get saved() { return saved; }, set saved(v) { saved = v; },
      get removed() { return savedRemoved; }, set removed(v) { savedRemoved = v; },
      markRead(k, gid) { seen[k] = [gid, ...(seen[k] || [])]; saveSeen(); },
      unsave(id) { saved = saved.filter(x => x.id !== id); savedRemoved[id] = Date.now(); persistSaved(); },
      save(id, extra = {}) { const [appid, gid] = id.split(":"); delete savedRemoved[id]; saved.unshift({id, appid, gid, title: "T " + gid, date: 1, url: "https://store.steampowered.com/x", summary: "testo completo ".repeat(50), ts: Date.now(), ...extra}); persistSaved(); }
    };
  `);
  const fakeFetch = async (url, init) => {
    if (!online) throw new TypeError("offline");
    log.calls++;
    return worker.fetch(new Request(url, {...init, headers: {...init.headers, Origin: ORIGIN, "CF-Connecting-IP": ip}}), env);
  };
  const api = factory({getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k)}, fakeFetch, log, () => true);
  return Object.assign(api, {ls, log});
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const ids = d => d.saved.map(x => x.id);
const wait = ms => new Promise(r => setTimeout(r, ms));

test("crea il codice, poi un secondo dispositivo si collega e riceve letto e salvati", async () => {
  const a = device(), b = device();
  a.markRead("5", "g1"); a.markRead("5", "g2"); a.save("5:g1");
  assert.equal(await a.syncCreate(), true);
  assert.match(a.sync.code, /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/); assert.ok(a.sync.last > 0);
  assert.equal(await b.syncJoin(a.sync.code), true);
  assert.deepEqual(b.seen["5"].sort(), ["g1", "g2"]); assert.deepEqual(ids(b), ["5:g1"]);
  assert.equal(JSON.parse(b.ls.get("game_patch_radar_sync_v1")).code, a.sync.code);   // il codice resta salvato sul dispositivo
});

test("modifiche su entrambi i dispositivi si uniscono; togliere un salvato vale anche sull'altro", async () => {
  const a = device(), b = device();
  a.save("5:g1"); await a.syncCreate(); await b.syncJoin(a.sync.code);
  b.markRead("7", "z"); b.save("7:z");
  a.unsave("5:g1"); a.markRead("5", "g9");
  await b.syncNow(); await a.syncNow(); await b.syncNow();
  assert.deepEqual(ids(a), ["7:z"]); assert.deepEqual(ids(b), ["7:z"]);
  assert.deepEqual(a.seen["7"], ["z"]); assert.deepEqual(b.seen["5"], ["g9"]);
});

test("la patch già collegata mantiene il riassunto completo locale (il ponte ne tiene solo 300 caratteri)", async () => {
  const a = device(), b = device();
  a.save("5:g1"); await a.syncCreate(); await b.syncJoin(a.sync.code);
  assert.ok(b.saved[0].summary.length <= 300 && b.saved[0].summary.length > 250);
  await a.syncNow();
  assert.ok(a.saved[0].summary.length > 300);
});

test("dati vecchi senza data di salvataggio (prima della sincronizzazione) ricevono una data e non si perdono", async () => {
  const a = device();
  a.saved = [{id: "5:old", appid: "5", gid: "old", title: "Vecchia", date: 1, url: "", summary: ""}];
  await a.syncCreate();
  assert.deepEqual(ids(a), ["5:old"]); assert.ok(a.saved[0].ts > 0);
});

test("applicare quanto arriva dal ponte non genera un nuovo invio", async () => {
  const a = device(); await a.syncCreate();
  const b = device(); a.markRead("5", "g1"); await a.syncNow();
  await b.syncJoin(a.sync.code);
  await wait(4300);   // l'invio ritardato parte dopo 4 secondi: se ce ne fosse uno superfluo, qui lo si vedrebbe
  assert.deepEqual(b.seen["5"], ["g1"]); assert.equal(b.sync.code, a.sync.code); assert.equal(b.log.calls, 1);
});

test("senza rete: il codice e i dati restano, compare un messaggio", async () => {
  const a = device({online: false}); a.save("5:g1");
  const ok = await a.syncJoin("abcd-efgh-jkmn");
  assert.equal(ok, false); assert.equal(a.sync.code, "abcd-efgh-jkmn"); assert.match(a.err, /ponte non risponde/); assert.deepEqual(ids(a), ["5:g1"]);
});

test("codice inesistente: il dispositivo si scollega con un messaggio, i dati restano", async () => {
  const a = device(); a.save("5:g1");
  assert.equal(await a.syncJoin("abcd-efgh-jkmn"), false);
  assert.equal(a.sync.code, ""); assert.match(a.err, /non è più valido|non trovato/i); assert.deepEqual(ids(a), ["5:g1"]);
  assert.equal(a.ls.get("game_patch_radar_sync_v1"), undefined);
});

test("se i dati vengono eliminati dal ponte, l'altro dispositivo si scollega da solo", async () => {
  const a = device(), b = device(); await a.syncCreate(); await b.syncJoin(a.sync.code);
  await a.syncNow();
  const r = await worker.fetch(new Request(BRIDGE + "/sync/forget", {method: "POST", body: "{}", headers: {Authorization: "Bearer " + a.sync.code, Origin: ORIGIN, "CF-Connecting-IP": "2.2.2.2"}}), env);
  assert.equal(r.status, 200);
  assert.equal(await b.syncNow(), false); assert.equal(b.sync.code, "");
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok   -", name); }
  catch (e) { failed++; console.log("FAIL -", name, "\n    ", e && e.stack || e); }
}
console.log(failed ? failed + " test falliti" : "Tutti i " + tests.length + " test sono passati");
process.exit(failed ? 1 : 0);
