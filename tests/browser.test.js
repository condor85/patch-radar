// Prova dell'app in un vero browser (Chromium via Playwright), con dati finti e senza rete esterna.
// Controlla: nessun errore in console, apertura di un gioco, del lettore, delle impostazioni e delle novità, esporta/importa,
// avviso di dati vecchi, uso da tastiera, messaggi di stato per gli screen reader e accessibilità (axe: contrasto, nomi, ruoli).
// Si lancia dalla radice, dopo `npm ci`:  node tests/browser.test.js        (in CI: .github/workflows/tests.yml)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {chromium} = require("playwright");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const APP_VERSION = /const APP_VERSION = "([^"]+)"/.exec(read("index.html"))[1];
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const H = 3600, DAY = 86400;

/* ---------- Dati finti: tre giochi, patch e annunci, con date relative a «adesso» ---------- */
function fixture(now, {ageHours = 1} = {}) {
  const item = (gid, title, ageDays, extra = {}) => ({
    gid: String(gid), title, url: "https://store.steampowered.com/news/app/1/view/" + gid, date: now - ageDays * DAY, feedlabel: "Community Announcements",
    feedname: "steam_community_announcements", author: "Dev", tags: ["patchnotes"], patch: true, labels: ["bug"],
    contents: "[h2]Correzioni[/h2][list][*]Corretto un arresto anomalo durante il salvataggio della partita.[*]Risolto un problema con i comandi del controller.[*]Migliorate le prestazioni nelle grandi basi.[/list]"
      + "[h2]Bilanciamento[/h2][list][*]Ridotto il danno delle frecce di fuoco del dieci per cento.[*]Aumentata la resistenza delle pareti di legno.[/list]", ...extra});
  const game = (appid, name, base, major) => ({
    appid, name, image: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/" + appid + "/header.jpg",
    price: {final: "19,99€", initial: "24,99€", discount: 20, cents: 1999},
    items: [
      item(base + 1, "Patch " + major + ".2.0", 1, {summary: "• Correzioni ai salvataggi e ai comandi.\n• Bilanciamento delle frecce.", summary_src: "ai",
        it: {title: "Patch " + major + ".2.0 (italiano)", text: "# Correzioni\n• Corretto un arresto anomalo durante il salvataggio.\n• Risolto un problema con i comandi.", src: "gemini"}}),
      item(base + 2, "Hotfix " + major + ".1.1", 4, {labels: ["perf"]}),
      item(base + 3, "Patch " + major + ".1.0", 9),
      item(base + 4, "Festa d'autunno: eventi e sconti", 12, {patch: false, tags: [], labels: [], contents: "Vieni a festeggiare con noi questo weekend con eventi speciali e sconti su tutto il catalogo."}),
    ]});
  const games = [game(892970, "Valheim", 100, 1), game(1203620, "Enshrouded", 200, 2), game(3321460, "Crimson Desert", 300, 3)];
  const old = now - ageHours * H;
  return {
    news: {updated: old, digest_ts: old, games},
    players: {games: Object.fromEntries(games.map(g => [String(g.appid), {n: 1000 + g.appid % 97, ts: old}]))},
    prices: {games: Object.fromEntries(games.map(g => [String(g.appid), {h: [[old, 1999]], min: {c: 1999, f: "19,99€", ts: old}}]))},
    config: {ntfyTopic: "patch-radar-prova", repo: "utente/patch-radar"},
  };
}

/* ---------- Server locale: i file veri dell'app + i dati finti ---------- */
const TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png"};
const PUBLIC = /^\/(?:index\.html|shared\.js|qr\.js|sw\.js|manifest\.webmanifest|js\/[\w-]+\.js|icons\/[\w.-]+)?$/;
function startServer(state) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (code, body, type) => { res.writeHead(code, {"Content-Type": type || "text/plain", "Cache-Control": "no-store"}); res.end(body); };
    const data = {"/data/news.json": "news", "/data/players.json": "players", "/data/prices.json": "prices", "/config.json": "config"}[url.pathname];
    if (data) return send(200, JSON.stringify(state.fixture[data]), "application/json");
    if (!PUBLIC.test(url.pathname)) return send(404, "non trovato");
    const file = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
    if (!fs.existsSync(file)) return send(404, "non trovato");
    send(200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/* Un «utente»: contesto del browser nuovo (memoria locale vuota), rete esterna finta e registro di tutto ciò che va storto */
async function newUser(browser, base, {welcome = false, colorScheme = "dark", storage = {}, notifications = false} = {}) {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, locale: "it-IT", timezoneId: "Europe/Rome", colorScheme, serviceWorkers: "block", acceptDownloads: true, reducedMotion: "reduce"});
  // Chromium senza interfaccia parte con le notifiche «negate» (e grantPermissions non le cambia): l'app mostrerebbe solo il messaggio di blocco,
  // senza gli interruttori. Qui si finge il permesso concesso; non si invia nessuna notifica vera.
  if (notifications) await context.addInitScript(() => { try { Object.defineProperty(Notification, "permission", {get: () => "granted"}); } catch {} });
  const log = {errors: [], failed: [], external: [], notFound: []};
  await context.addInitScript(([skipWelcome, extra]) => {
    try { if (skipWelcome) localStorage.setItem("game_patch_radar_welcome_v1", "1"); for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v); } catch {}
  }, [!welcome, storage]);
  await context.route("**/*", route => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    if (u.hostname === "api.github.com") return route.fulfill({status: 200, contentType: "application/json", headers: {"access-control-allow-origin": "*"}, body: JSON.stringify({workflow_runs: [{updated_at: new Date().toISOString()}]})});
    if (u.hostname.endsWith(".steamstatic.com")) return route.fulfill({status: 200, contentType: "image/png", body: PNG});
    log.external.push(u.href);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("console", m => { if (m.type() === "error") log.errors.push(m.text()); });
  page.on("pageerror", e => log.errors.push("pageerror: " + e.message));
  page.on("requestfailed", r => log.failed.push(r.url()));
  page.on("response", r => { if (r.status() >= 400 && r.url().startsWith(base)) log.notFound.push(r.status() + " " + r.url()); });
  return {context, page, log};
}
async function openApp(browser, base, opts) {
  const user = await newUser(browser, base, opts);
  try {
    await user.page.goto(base + "/");
    await user.page.waitForSelector(".hcard .abtn.pri", {timeout: 15000});   // le schede della schermata principale sono pronte
    await user.page.waitForFunction(() => /^(Ultimo controllo|Prima apertura)/.test(document.getElementById("status").textContent), null, {timeout: 15000});
  } catch (e) {   // se l'app non parte, il messaggio dice cosa si vedeva (stato, errori) invece di un semplice «timeout»
    const status = await user.page.locator("#status").textContent().catch(() => "?");
    throw new Error("l'app non è partita: stato «" + status + "», errori " + JSON.stringify(user.log.errors) + ", file non trovati " + JSON.stringify(user.log.notFound) + " (" + e.message.split("\n")[0] + ")");
  }
  return user;
}
const noProblems = log => { assert.deepEqual(log.errors, [], "errori in console"); assert.deepEqual(log.external, [], "richieste a siti non previsti"); assert.deepEqual(log.notFound, [], "file non trovati"); assert.deepEqual(log.failed, [], "richieste fallite"); };

/* Accessibilità con axe-core (regole WCAG 2.0/2.1 A e AA). Falliscono le violazioni gravi e critiche, contrasto compreso. */
async function axeViolations(page) {
  await page.evaluate(axeSource);   // eseguito dal browser stesso: non passa dalla Content-Security-Policy della pagina
  const res = await page.evaluate(() => axe.run(document, {runOnly: {type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]}, resultTypes: ["violations"]}));
  return res.violations.filter(v => v.impact === "serious" || v.impact === "critical")
    .map(v => v.id + " (" + v.impact + "): " + v.nodes.slice(0, 4).map(n => n.target.join(" ") + " → " + (n.any[0] || n.all[0] || n.none[0] || {}).message).join(" | "));
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const visible = (page, sel) => page.locator(sel).isVisible();
const NOW = Math.floor(Date.now() / 1000);

/* ---------- Le prove ---------- */
test("si apre senza errori: schermata principale, versione e dati", async ({browser, base}) => {
  const {context, page, log} = await openApp(browser, base);
  assert.equal(await page.locator(".hcard:not(.pend)").count(), 3);
  assert.equal(await page.locator("#verBtn").textContent(), "v" + APP_VERSION);
  assert.equal(await page.title().then(t => t.replace(/^\(\d+\) /, "")), "Game Patch Radar");
  assert.match(await page.locator("#status").textContent(), /^Prima apertura: da ora ti segnalo i nuovi aggiornamenti/);   // memoria vuota = primo avvio
  await page.locator("#refreshBtn").click();
  await page.waitForFunction(() => /^Ultimo controllo: \d\d:\d\d/.test(document.getElementById("status").textContent));
  assert.equal(await visible(page, "#stale"), false, "con dati freschi l'avviso non si vede");
  assert.deepEqual(await page.locator("#gameList .game").allTextContents().then(a => a.map(t => t.replace(/\s+/g, " ").trim().replace(/ \d+ nuov[io]$/, ""))), ["🏠 Home", "Valheim", "Enshrouded", "Crimson Desert"]);
  noProblems(log); await context.close();
});

test("si apre un gioco: titolo, schede, filtri e ricerca", async ({browser, base}) => {
  const {context, page, log} = await openApp(browser, base);
  await page.locator("#gameList .game", {hasText: "Enshrouded"}).click();
  await page.waitForFunction(() => document.getElementById("gameTitle").textContent === "Enshrouded");
  assert.equal(await page.locator("#cards .card").count(), 4);
  assert.match(await page.locator("#count").textContent(), /^4 pubblicazioni$/);
  await page.locator("#filters .fchip", {hasText: "Solo patch"}).click();
  assert.equal(await page.locator("#cards .card").count(), 3);
  await page.locator("#filters .fchip", {hasText: "Cerca"}).click();
  await page.fill("#q", "festa");
  await page.waitForFunction(() => document.querySelectorAll("#cards .card").length <= 1);
  await page.locator("#qClear").click();
  await page.locator("#gameList .game.home").click();
  await page.waitForFunction(() => document.getElementById("gameTitle").textContent === "Ultime patch");
  noProblems(log); await context.close();
});

test("il lettore: si apre, scorre tra le patch, traduce, si chiude con ✕ e con Esc", async ({browser, base}) => {
  const {context, page, log} = await openApp(browser, base);
  await page.locator(".hcard .abtn.pri").first().click();
  await page.waitForSelector("#viewer.open");
  const first = await page.locator("#vInner h2").textContent();
  assert(first.length > 3);
  assert.equal(await page.locator("#vPrev").isDisabled(), true);
  await page.locator("#vNext").click();
  assert.notEqual(await page.locator("#vInner h2").textContent(), first, "‹ › cambiano pubblicazione");
  await page.locator("#vPrev").click();
  await page.locator("#vTr").click();   // la traduzione in italiano arriva già dai dati (Gemini): nessuna rete
  await page.waitForFunction(() => /Originale/.test(document.getElementById("vTr").textContent));
  assert.match(await page.locator("#vInner .v-note").textContent(), /Traduzione automatica \(Gemini\)/);
  await page.locator("#vClose").click();
  assert.equal(await visible(page, "#viewer"), false);
  await page.locator(".hcard .abtn.pri").first().click();
  await page.waitForSelector("#viewer.open");
  await page.keyboard.press("Escape");
  assert.equal(await visible(page, "#viewer"), false);
  noProblems(log); await context.close();
});

test("le impostazioni: nascondere un gioco, cambiare tema, sezioni presenti, Esc chiude", async ({browser, base}) => {
  const {context, page, log} = await openApp(browser, base);
  await page.locator("#manageBtn").click();
  await page.waitForSelector("#manager.open");
  assert.equal(await page.locator("#mList label.opt").count(), 3);
  for (const t of ["Notifiche", "Aspetto", "Sincronizza tra dispositivi", "Esporta e importa i tuoi dati", "Condividi l'app", "Amministratore"]) assert(await page.locator("#manager").textContent().then(x => x.includes(t)), t);
  await page.locator("#mList label.opt", {hasText: "Crimson Desert"}).locator("input").uncheck();
  assert.equal(await page.locator("#gameList .game:not(.home)").count(), 2);
  await page.locator("#themeRow .abtn", {hasText: "Chiaro"}).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.keyboard.press("Escape");
  assert.equal(await visible(page, "#manager"), false);
  assert.equal(await page.locator(".hcard:not(.pend)").count(), 2);
  noProblems(log); await context.close();
});

test("la finestra «Novità dell'app»: si apre dal numero di versione e si chiude", async ({browser, base}) => {
  const {context, page, log} = await openApp(browser, base);
  await page.locator("#verBtn").click();
  await page.waitForSelector("#changelog.open");
  assert.match(await page.locator("#changelogBody").textContent(), new RegExp("Versione " + APP_VERSION.replace(/\./g, "\\.")));
  await page.locator("#clClose").click();
  assert.equal(await visible(page, "#changelog"), false);
  noProblems(log); await context.close();
});

test("prima apertura: compare il benvenuto e «Inizia» lo chiude", async ({browser, base}) => {
  const {context, page, log} = await newUser(browser, base, {welcome: true}).then(async u => { await u.page.goto(base + "/"); return u; });
  await page.waitForSelector("#welcome.open");
  assert.match(await page.locator("#welcomeBody").textContent(), /Benvenuto in Game Patch Radar/);
  await page.locator("#welcomeBody .abtn", {hasText: "Inizia"}).click();
  assert.equal(await visible(page, "#welcome"), false);
  noProblems(log); await context.close();
});

test("esporta e importa: il file esce, e su un altro dispositivo si reimporta (unendo)", async ({browser, base}) => {
  const a = await openApp(browser, base);
  await a.page.locator("#gameList .game", {hasText: "Valheim"}).click();
  await a.page.waitForFunction(() => document.getElementById("gameTitle").textContent === "Valheim");
  await a.page.locator("#cards .card").first().getByRole("button", {name: "Salva"}).click();
  await a.page.locator("#manageBtn").click();
  const [download] = await Promise.all([a.page.waitForEvent("download"), a.page.getByRole("button", {name: /Esporta i miei dati/}).click()]);
  assert.match(download.suggestedFilename(), /^patch-radar-\d{4}-\d\d-\d\d\.json$/);
  const file = path.join(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "gpr-")), download.suggestedFilename());
  await download.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(exported.app, "game-patch-radar"); assert.equal(exported.format, 1); assert.equal(exported.saved.length, 1);
  assert.equal(exported.saved[0].appid, "892970"); assert(Object.keys(exported.seen).length >= 1);
  assert.doesNotMatch(JSON.stringify(exported), /ntfy|password|token|codice/i);
  noProblems(a.log); await a.context.close();

  const b = await openApp(browser, base);   // «altro telefono»: nessun dato
  await b.page.locator("#manageBtn").click();
  b.page.once("dialog", d => { assert.match(d.message(), /1 salvati .* UNISCONO/); d.accept(); });
  await b.page.setInputFiles("#backupFile", file);
  await b.page.waitForFunction(() => /Dati importati: 1 salvati/.test(document.getElementById("toast").textContent));
  assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem("game_patch_radar_saved_v1")).length), 1);
  await b.page.keyboard.press("Escape");
  assert.match(await b.page.locator("#filters .fchip", {hasText: "Salvati"}).textContent(), /Salvati · 1/);

  // un file sbagliato non cambia nulla e dice perché
  const bad = path.join(path.dirname(file), "sbagliato.json"); fs.writeFileSync(bad, JSON.stringify({app: "altra-app", format: 1}));
  await b.page.locator("#manageBtn").click();
  await b.page.setInputFiles("#backupFile", bad);
  await b.page.waitForFunction(() => /non è una copia/.test(document.getElementById("backupBox").textContent));
  assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem("game_patch_radar_saved_v1")).length), 1);
  noProblems(b.log); await b.context.close();
});

test("dati vecchi: dopo 12 ore l'app avvisa, prima no", async ({browser, base, state}) => {
  state.fixture = fixture(NOW, {ageHours: 30});
  const old = await openApp(browser, base);
  await old.page.waitForFunction(() => !document.getElementById("stale").hidden);
  assert.match(await old.page.locator("#stale").textContent(), /I dati non si aggiornano da circa 30 ore/);
  noProblems(old.log); await old.context.close();
  state.fixture = fixture(NOW, {ageHours: 11});
  const fresh = await openApp(browser, base);
  assert.equal(await visible(fresh.page, "#stale"), false);
  await fresh.context.close();
  state.fixture = fixture(NOW);
});

test("da tastiera: si raggiungono intestazione, giochi, schede e impostazioni, e ogni comando ha un nome", async ({browser, base}) => {
  const {context, page, log} = await openApp(browser, base);
  const stops = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => { const e = document.activeElement; return {id: e.id, tag: e.tagName, name: (e.getAttribute("aria-label") || e.textContent || e.title || "").trim(), cls: e.className}; }));
  }
  const ids = stops.map(s => s.id);
  for (const id of ["verBtn", "refreshBtn", "manageBtn"]) assert(ids.includes(id), id + " non raggiungibile con Tab");
  assert(stops.some(s => /\bgame\b/.test(s.cls) && /Valheim/.test(s.name)), "i giochi non sono raggiungibili con Tab");
  assert(stops.some(s => s.tag === "BUTTON" && s.name === "Leggi"), "«Leggi» non è raggiungibile con Tab");
  assert(stops.every(s => s.name.length > 0 || s.tag === "BODY"), "un comando raggiunto con Tab non ha nome: " + JSON.stringify(stops.find(s => !s.name && s.tag !== "BODY")));
  // Invio apre il lettore, Esc lo chiude
  await page.locator(".hcard .abtn.pri").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#viewer.open");
  assert.equal(await page.evaluate(() => document.activeElement.id), "vClose", "aprendo il lettore il focus passa al pulsante di chiusura");
  await page.keyboard.press("Escape");
  assert.equal(await visible(page, "#viewer"), false);
  noProblems(log); await context.close();
});

test("messaggi di stato annunciati dagli screen reader (aria-live) e finestre con ruolo di dialogo", async ({browser, base}) => {
  const {context, page, log} = await openApp(browser, base);
  for (const id of ["status", "stale", "toast"]) assert.equal(await page.locator("#" + id).getAttribute("aria-live"), "polite", "#" + id + " senza aria-live");
  for (const id of ["manager", "recap", "changelog", "welcome", "team", "invite", "viewer"]) {
    assert.equal(await page.locator("#" + id).getAttribute("role"), "dialog", "#" + id); assert.equal(await page.locator("#" + id).getAttribute("aria-modal"), "true", "#" + id);
    assert((await page.locator("#" + id).getAttribute("aria-label")).length > 2, "#" + id + " senza nome");
  }
  await page.locator("#gameList .game", {hasText: "Valheim"}).click();
  await page.locator("#cards .card").first().getByRole("button", {name: "Salva"}).click();
  await page.waitForFunction(() => document.getElementById("toast").classList.contains("show") && /★ Salvata/.test(document.getElementById("toast").textContent));
  noProblems(log); await context.close();
});

for (const scheme of ["dark", "light"]) {
  test("accessibilità (axe, tema " + scheme + "): schermata principale, gioco, lettore, impostazioni, novità, benvenuto", async ({browser, base}) => {
    const {context, page, log} = await newUser(browser, base, {welcome: true, colorScheme: scheme, storage: {game_patch_radar_theme_v1: scheme}});
    await page.goto(base + "/");
    await page.waitForSelector(".hcard .abtn.pri");
    const found = [];
    const check = async label => { for (const v of await axeViolations(page)) found.push(label + ": " + v); };
    await page.waitForSelector("#welcome.open");
    await check("benvenuto");
    await page.locator("#welcomeBody .abtn", {hasText: "Inizia"}).click();
    await page.waitForFunction(() => /^(Ultimo controllo|Prima apertura)/.test(document.getElementById("status").textContent));
    await check("home");
    await page.locator("#gameList .game", {hasText: "Valheim"}).click();
    await page.waitForFunction(() => document.getElementById("gameTitle").textContent === "Valheim");
    await check("gioco");
    await page.locator("#cards .card .abtn.pri").first().click();
    await page.waitForSelector("#viewer.open");
    await check("lettore");
    await page.locator("#vClose").click();
    await page.locator("#manageBtn").click();
    await page.waitForSelector("#manager.open");
    await check("impostazioni");
    await page.keyboard.press("Escape");
    await page.locator("#verBtn").click();
    await page.waitForSelector("#changelog.open");
    await check("novità");
    assert.deepEqual(found, [], "problemi di accessibilità:\n  " + found.join("\n  "));
    noProblems(log); await context.close();
  });
}

test("accessibilità (axe): impostazioni con le notifiche attive (interruttori, orari, giochi)", async ({browser, base}) => {
  const notif = JSON.stringify({on: true, off: ["3321460"], major: ["892970"], kw: ["crash"], mode: "now", news: true, sale: true, stable: true, quiet: {on: true, from: "23:00", to: "08:00"}});
  const {context, page, log} = await openApp(browser, base, {notifications: true, storage: {game_patch_radar_notif_v1: notif}});
  await page.locator("#manageBtn").click();
  await page.waitForSelector("#manager.open");
  assert(await page.locator("#nList .sw input").count() >= 7, "interruttori delle notifiche non mostrati");
  for (const el of await page.locator("#nList .sw input").all()) assert.equal(await el.getAttribute("role"), "switch");
  assert((await page.locator("#nList .sw input").evaluateAll(a => a.map(i => i.getAttribute("aria-label")))).every(n => n && n.length > 3), "un interruttore senza nome");
  const found = await axeViolations(page);
  assert.deepEqual(found, [], "problemi di accessibilità:\n  " + found.join("\n  "));
  assert.deepEqual(log.errors.filter(e => !/ERR_FAILED|blocked/i.test(e)), []);
  await context.close();
});

/* ---------- Esecuzione ---------- */
(async () => {
  const state = {fixture: fixture(NOW)};
  const server = await startServer(state);
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  let failed = 0;
  const only = process.argv[2];
  try {
    for (const [name, fn] of tests) {
      if (only && !name.includes(only)) continue;
      try { await fn({browser, base, state}); console.log("ok  -", name); }
      catch (e) { failed++; console.log("FAIL -", name, "\n    ", String(e && e.message || e).split("\n").join("\n     ")); }
    }
  } finally { await browser.close(); server.close(); }
  if (failed) { console.log(`browser.test.js: ${failed} test falliti`); process.exit(1); }
  console.log(`browser.test.js: tutti i ${tests.length} test passati`);
})().catch(e => { console.error(e); process.exit(1); });
