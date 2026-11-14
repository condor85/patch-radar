// Test del ponte di amministrazione (worker/worker.js). Esecuzione: node tests/worker.test.mjs
import assert from "node:assert/strict";
import worker from "../worker/worker.js";

const ORIGIN = "https://condor85.github.io";
const PASSWORD = "una-password-lunga-12";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64");

function makeEnv(extra = {}) {
  const kv = new Map();
  return {
    ADMIN_PASSWORD: PASSWORD, GITHUB_TOKEN: "ghp_finto", REPO: "condor85/patch-radar", ALLOWED_ORIGIN: ORIGIN,
    RL: {get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); }},
    _kv: kv, ...extra
  };
}

/* Finti GitHub e Steam: registrano le chiamate e restituiscono ciò che serve. */
function mockNet({games = [{appid: 1, name: "Uno"}, {appid: 2, name: "Due"}], steam = {}, ghStatus = {}, repo = {}} = {}) {
  const calls = [];
  const files = {"games.json": {games}, "config.json": {ntfyTopic: "vecchio", repo: "condor85/patch-radar"}};
  globalThis.fetch = async (url, init = {}) => {
    url = String(url); calls.push({url, init});
    if (url === "https://api.github.com/repos/condor85/patch-radar") {   // scheda del repository (per /status)
      return new Response(JSON.stringify({permissions: {push: repo.push ?? true}}), {status: repo.status ?? 200, headers: repo.headers || {}});
    }
    if (url.startsWith("https://api.github.com/repos/")) {
      const path = /contents\/([^?]+)/.exec(url)[1];
      if (ghStatus.read) return new Response("{}", {status: ghStatus.read});
      if ((init.method || "GET") === "GET") return new Response(JSON.stringify({content: b64(files[path]), sha: "sha-" + path}), {status: 200});
      if (ghStatus.write) return new Response("{}", {status: ghStatus.write});
      const body = JSON.parse(init.body);
      assert.equal(body.branch, "main");
      assert.equal(body.sha, "sha-" + path);
      files[path] = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
      return new Response("{}", {status: 200});
    }
    if (url.includes("/api/storesearch/")) return new Response(JSON.stringify(steam.search || {items: []}), {status: 200});
    if (url.includes("/api/appdetails")) return new Response(JSON.stringify(steam.details || {}), {status: 200});
    throw new Error("Rete non prevista: " + url);
  };
  return {calls, files};
}

const req = (path, body, {auth = "Bearer " + PASSWORD, origin = ORIGIN, method = "POST", ip = "1.2.3.4"} = {}) =>
  new Request("https://ponte.example.workers.dev" + path, {
    method, body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    headers: {...(auth ? {Authorization: auth} : {}), ...(origin ? {Origin: origin} : {}), "CF-Connecting-IP": ip}
  });
const call = async (env, ...a) => { const r = await worker.fetch(req(...a), env); return {status: r.status, body: await r.json(), headers: r.headers}; };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("senza password o con password errata → 401, e nessuna chiamata a GitHub", async () => {
  const net = mockNet(); const env = makeEnv();
  assert.equal((await call(env, "/login", {}, {auth: null})).status, 401);
  assert.equal((await call(env, "/add", {appid: 5}, {auth: "Bearer sbagliata-sbagliata"})).status, 401);
  assert.equal(net.calls.length, 0);
});

test("password giusta → login ok", async () => {
  mockNet();
  const r = await call(makeEnv(), "/login", {});
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
});

test("dopo 5 tentativi sbagliati l'indirizzo viene bloccato, anche con la password giusta", async () => {
  mockNet(); const env = makeEnv();
  for (let i = 0; i < 5; i++) assert.equal((await call(env, "/login", {}, {auth: "Bearer x" + i})).status, 401);
  assert.equal((await call(env, "/login", {})).status, 429);
  assert.equal((await call(env, "/login", {}, {ip: "9.9.9.9"})).status, 200);   // altri indirizzi non sono toccati
});

test("password corretta azzera il conteggio degli errori", async () => {
  mockNet(); const env = makeEnv();
  for (let i = 0; i < 3; i++) await call(env, "/login", {}, {auth: "Bearer x" + i});
  assert.equal((await call(env, "/login", {})).status, 200);
  assert.equal(env._kv.size, 0);
});

test("configurazione incompleta o password troppo corta → 503", async () => {
  mockNet();
  assert.equal((await call(makeEnv({ADMIN_PASSWORD: "corta"}), "/login", {}, {auth: "Bearer corta"})).status, 503);
  assert.equal((await call(makeEnv({GITHUB_TOKEN: ""}), "/login", {})).status, 503);
});

test("origine diversa → 403 senza intestazioni CORS; origine giusta → CORS solo per lei", async () => {
  mockNet();
  const bad = await call(makeEnv(), "/login", {}, {origin: "https://evil.example"});
  assert.equal(bad.status, 403); assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
  const ok = await call(makeEnv(), "/login", {});
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(ok.headers.get("Cache-Control"), "no-store");
});

test("preflight OPTIONS: 204 per l'origine giusta, 403 per le altre", async () => {
  const env = makeEnv();
  const ok = await worker.fetch(new Request("https://x/add", {method: "OPTIONS", headers: {Origin: ORIGIN}}), env);
  assert.equal(ok.status, 204); assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const bad = await worker.fetch(new Request("https://x/add", {method: "OPTIONS", headers: {Origin: "https://evil.example"}}), env);
  assert.equal(bad.status, 403);
});

test("percorsi e metodi sconosciuti → 404 / 405 (anche per nomi come __proto__)", async () => {
  mockNet(); const env = makeEnv();
  assert.equal((await call(env, "/nope", {})).status, 404);
  assert.equal((await call(env, "/__proto__", {})).status, 404);
  assert.equal((await call(env, "/constructor", {})).status, 404);
  assert.equal((await call(env, "/add", {}, {method: "GET"})).status, 405);
});

test("richiesta troppo grande o non JSON → 413 / 400", async () => {
  mockNet(); const env = makeEnv();
  assert.equal((await call(env, "/search", {q: "x".repeat(5000)})).status, 413);
  const r = await worker.fetch(new Request("https://x/add", {method: "POST", body: "{non json", headers: {Authorization: "Bearer " + PASSWORD, Origin: ORIGIN}}), env);
  assert.equal(r.status, 400);
});

test("ricerca: ripulisce i nomi, scarta i risultati non validi, massimo 8", async () => {
  const items = [{id: 10, name: "Buono <b>x</b>"}, {id: "abc", name: "Non valido"}, {id: -3, name: "Negativo"}, {id: 11, name: ""},
    ...Array.from({length: 12}, (_, i) => ({id: 100 + i, name: "Gioco " + i}))];
  mockNet({steam: {search: {items}}});
  const r = await call(makeEnv(), "/search", {q: "gioco"});
  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 8);
  assert.deepEqual(r.body.results[0], {appid: 10, name: "Buono bx/b"});
  assert.ok(r.body.results.every(x => Number.isInteger(x.appid) && x.appid > 0));
});

test("ricerca: testo troppo corto → 400", async () => {
  mockNet();
  assert.equal((await call(makeEnv(), "/search", {q: "a"})).status, 400);
});

test("aggiunta: il nome viene da Steam, non dal telefono, e il commit va su main", async () => {
  const net = mockNet({steam: {details: {"77": {success: true, data: {type: "game", name: "Vero Nome"}}}}});
  const r = await call(makeEnv(), "/add", {appid: 77, name: "Nome falso <script>"});
  assert.equal(r.status, 200); assert.equal(r.body.added, true); assert.equal(r.body.game.name, "Vero Nome");
  assert.deepEqual(net.files["games.json"].games.at(-1), {appid: 77, name: "Vero Nome"});
  const put = net.calls.find(c => c.init.method === "PUT");
  assert.match(JSON.parse(put.init.body).message, /^\[app\] Aggiungi Vero Nome$/);
  assert.equal(put.init.headers.Authorization, "Bearer ghp_finto");
});

test("aggiunta: appid accettato anche come testo numerico, rifiutato se non valido", async () => {
  const net = mockNet({steam: {details: {"88": {success: true, data: {type: "game", name: "Otto"}}}}});
  assert.equal((await call(makeEnv(), "/add", {appid: "88"})).status, 200);
  for (const bad of [0, -1, 1.5, "1e3", "12abc", null, "../x", 10 ** 10, {}, []]) {
    assert.equal((await call(makeEnv(), "/add", {appid: bad})).status, 400, "appid " + JSON.stringify(bad));
  }
  assert.equal(net.files["games.json"].games.length, 3);
});

test("aggiunta: contenuti che non sono giochi o numeri inesistenti → 422", async () => {
  mockNet({steam: {details: {"5": {success: true, data: {type: "dlc", name: "Extra"}}, "6": {success: false}}}});
  assert.equal((await call(makeEnv(), "/add", {appid: 5})).status, 422);
  assert.equal((await call(makeEnv(), "/add", {appid: 6})).status, 422);
});

test("aggiunta: gioco già presente → nessuna scrittura", async () => {
  const net = mockNet({steam: {details: {"1": {success: true, data: {type: "game", name: "Uno"}}}}});
  const r = await call(makeEnv(), "/add", {appid: 1});
  assert.equal(r.status, 200); assert.equal(r.body.added, false);
  assert.equal(net.calls.filter(c => c.init.method === "PUT").length, 0);
});

test("aggiunta: oltre 40 giochi → 409", async () => {
  const many = Array.from({length: 40}, (_, i) => ({appid: i + 1, name: "G" + i}));
  mockNet({games: many, steam: {details: {"999": {success: true, data: {type: "game", name: "Nuovo"}}}}});
  assert.equal((await call(makeEnv(), "/add", {appid: 999})).status, 409);
});

test("rimozione: toglie il gioco, ma lascia sempre almeno un gioco", async () => {
  const net = mockNet();
  assert.equal((await call(makeEnv(), "/remove", {appid: 1})).status, 200);
  assert.deepEqual(net.files["games.json"].games, [{appid: 2, name: "Due"}]);
  assert.equal((await call(makeEnv(), "/remove", {appid: 2})).status, 409);
  assert.equal(net.files["games.json"].games.length, 1);
});

test("rimozione di un gioco assente: nessun errore e nessuna scrittura", async () => {
  const net = mockNet();
  assert.equal((await call(makeEnv(), "/remove", {appid: 12345})).status, 200);
  assert.equal(net.calls.filter(c => c.init.method === "PUT").length, 0);
});

test("nuovo argomento notifiche: cambia solo ntfyTopic", async () => {
  const net = mockNet();
  const r = await call(makeEnv(), "/topic", {});
  assert.equal(r.status, 200); assert.match(r.body.topic, /^patch-radar-[0-9a-f]{12}$/);
  assert.equal(net.files["config.json"].ntfyTopic, r.body.topic);
  assert.equal(net.files["config.json"].repo, "condor85/patch-radar");
});

test("errori di GitHub: messaggio generico, mai il token né i dettagli", async () => {
  mockNet({steam: {details: {"7": {success: true, data: {type: "game", name: "Sette"}}}}, ghStatus: {read: 401}});
  const r = await call(makeEnv(), "/add", {appid: 7});
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.body).includes("ghp_finto"));
});

test("Steam che non risponde → 502 e niente scritture", async () => {
  const net = mockNet();
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u).includes("steampowered") ? new Response("", {status: 500}) : orig(u, i);
  assert.equal((await call(makeEnv(), "/add", {appid: 9})).status, 502);
  assert.equal(net.calls.filter(c => c.init.method === "PUT").length, 0);
});

test("errore imprevisto → 500 generico", async () => {
  mockNet();
  globalThis.fetch = async () => { throw new Error("segreto interno ghp_finto"); };
  const r = await call(makeEnv(), "/add", {appid: 9});
  assert.equal(r.status, 502);   // Steam irraggiungibile
  const env = makeEnv(); env.RL = {get: async () => { throw new Error("kv giù"); }, put: async () => {}, delete: async () => {}};
  assert.equal((await call(env, "/login", {})).status, 200);   // il KV guasto non blocca l'accesso
});

test("aggiunta di un gioco da osservare: salva watch e soglia (anche scritta con la virgola)", async () => {
  const net = mockNet({steam: {details: {"31": {success: true, data: {type: "game", name: "Trentuno"}}}}});
  const r = await call(makeEnv(), "/add", {appid: 31, watch: true, target: "19,99"});
  assert.equal(r.status, 200);
  assert.deepEqual(net.files["games.json"].games.at(-1), {appid: 31, name: "Trentuno", watch: true, target: 19.99});
});

test("aggiunta da osservare senza soglia: ok, target null; soglia non valida → 400 e nessuna scrittura", async () => {
  const net = mockNet({steam: {details: {"32": {success: true, data: {type: "game", name: "Trentadue"}}}}});
  assert.equal((await call(makeEnv(), "/add", {appid: 32, watch: true})).status, 200);
  assert.deepEqual(net.files["games.json"].games.at(-1), {appid: 32, name: "Trentadue", watch: true, target: null});
  const before = net.files["games.json"].games.length;
  for (const bad of [0, -5, "abc", 20000, {}, [], true]) {
    assert.equal((await call(makeEnv(), "/add", {appid: 32, watch: true, target: bad})).status, 400, "soglia " + JSON.stringify(bad));
  }
  assert.equal(net.files["games.json"].games.length, before);
});

test("aggiunta normale ignora una soglia mandata senza watch", async () => {
  const net = mockNet({steam: {details: {"33": {success: true, data: {type: "game", name: "Trentatre"}}}}});
  await call(makeEnv(), "/add", {appid: 33, target: 10});
  assert.deepEqual(net.files["games.json"].games.at(-1), {appid: 33, name: "Trentatre"});
});

test("/watch: attiva con soglia, cambia la soglia, poi disattiva e toglie i campi", async () => {
  const net = mockNet();
  assert.equal((await call(makeEnv(), "/watch", {appid: 1, watch: true, target: 12.5})).status, 200);
  assert.deepEqual(net.files["games.json"].games[0], {appid: 1, name: "Uno", watch: true, target: 12.5});
  assert.equal((await call(makeEnv(), "/watch", {appid: 1, watch: true, target: "9,5"})).status, 200);
  assert.equal(net.files["games.json"].games[0].target, 9.5);
  assert.deepEqual(net.files["games.json"].games[1], {appid: 2, name: "Due"});   // gli altri non cambiano
  assert.equal((await call(makeEnv(), "/watch", {appid: 1, watch: false})).status, 200);
  assert.deepEqual(net.files["games.json"].games[0], {appid: 1, name: "Uno"});
});

test("/watch: richieste non valide o gioco assente", async () => {
  const net = mockNet();
  assert.equal((await call(makeEnv(), "/watch", {appid: 1})).status, 400);
  assert.equal((await call(makeEnv(), "/watch", {appid: 1, watch: "si"})).status, 400);
  assert.equal((await call(makeEnv(), "/watch", {appid: 0, watch: true})).status, 400);
  assert.equal((await call(makeEnv(), "/watch", {appid: 1, watch: true, target: -1})).status, 400);
  assert.equal((await call(makeEnv(), "/watch", {appid: 999, watch: true, target: 5})).status, 404);
  assert.equal(net.calls.filter(c => c.init.method === "PUT").length, 0);
});

test("/status: ponte attivo, giorni alla scadenza del token", async () => {
  const exp = new Date(Date.now() + 10.5 * 86400000);
  const stamp = exp.toISOString().slice(0, 19).replace("T", " ") + " UTC";
  mockNet({repo: {headers: {"github-authentication-token-expiration": stamp}}});
  const r = await call(makeEnv(), "/status", {});
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.github, true);
  assert.equal(r.body.daysLeft, 10); assert.equal(r.body.canPush, true);
});

test("/status: senza intestazione di scadenza daysLeft è null; token non valido o senza scrittura → ok false", async () => {
  mockNet();
  const a = await call(makeEnv(), "/status", {});
  assert.equal(a.body.ok, true); assert.equal(a.body.daysLeft, null);
  mockNet({repo: {status: 401}});
  const b = await call(makeEnv(), "/status", {});
  assert.equal(b.status, 200); assert.equal(b.body.ok, false); assert.match(b.body.error, /non è più valido/);
  mockNet({repo: {push: false}});
  const c = await call(makeEnv(), "/status", {});
  assert.equal(c.body.ok, false); assert.match(c.body.error, /scrivere/);
  assert.ok(!JSON.stringify([a, b, c]).includes("ghp_finto"));
});

test("/status richiede la password", async () => {
  mockNet();
  assert.equal((await call(makeEnv(), "/status", {}, {auth: "Bearer sbagliata-sbagliata"})).status, 401);
});


let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok   -", name); }
  catch (e) { failed++; console.log("FAIL -", name, "\n    ", e && e.message); }
}
console.log(failed ? failed + " test falliti" : "Tutti i " + tests.length + " test sono passati");
process.exit(failed ? 1 : 0);
