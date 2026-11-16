// Esporta/importa i tuoi dati (js/backup.js): pulizia del file, unione con i dati del dispositivo, flusso di importazione.
// Si lancia dalla radice: node tests/backup.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

/* Un'app in miniatura: lo stato globale che backup.js legge e scrive, con le parti esterne finte. */
function makeApp({confirmAnswer = true} = {}) {
  const log = {toasts: [], confirms: [], calls: []};
  const ls = new Map();
  const ctx = {
    console, Date, JSON, Object, Array, Set, Number, String, Math, Error,
    localStorage: {getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k)},
    confirm: msg => { log.confirms.push(msg); return confirmAnswer; },
    toast: m => log.toasts.push(m),
    log,
  };
  vm.createContext(ctx);
  vm.runInContext(`
    let seen = {}, saved = [], savedRemoved = {}, hidden = [], onlyPatch = false, savedView = false, fontIdx = 1, theme = "auto";
    const FONTS = [0.9, 1, 1.15, 1.3], THEME_KEY = "tema", APP_VERSION_SHOWN = "1.2.0";
    const $ = () => null, h = () => ({}), mkBtn = () => ({});
    const currentTheme = () => theme, applyTheme = t => { theme = t; log.calls.push("applyTheme"); };
    const setFont = i => { fontIdx = i; log.calls.push("setFont"); }, setOnlyPatch = v => { onlyPatch = v; log.calls.push("setOnlyPatch"); };
    const saveHidden = () => log.calls.push("saveHidden"), saveSeen = () => log.calls.push("saveSeen"), persistSaved = () => log.calls.push("persistSaved");
    const ensureSelected = () => {}, refreshViews = () => log.calls.push("refreshViews"), updateTitle = () => {}, renderTheme = () => {};
    // identico a js/sync.js: è il formato che il file deve riusare
    function syncPayload() {
      const now = Date.now(), s = {};
      for (const [k, list] of Object.entries(seen)) if (/^\\d{1,9}$/.test(k) && Array.isArray(list)) s[k] = list.map(String);
      return {seen: s, removed: savedRemoved, saved: saved.map(x => ({id: x.id, appid: x.appid, gid: x.gid, title: x.title, date: x.date, url: x.url, summary: String(x.summary || "").slice(0, 300), ts: x.ts || (x.ts = now)}))};
    }
  `, ctx);
  vm.runInContext(read("js/backup.js"), ctx, {filename: "backup.js"});
  vm.runInContext("this.raw = {backupClean, backupMerge, backupBuild, backupFileName, backupImport, state: () => ({seen, saved, savedRemoved, hidden, onlyPatch, theme, fontIdx}), set: (k, v) => { eval(k + ' = v'); }};", ctx);
  // gli oggetti nati nel contesto isolato hanno prototipi diversi: li si riporta a dati semplici prima dei confronti
  const plain = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
  const api = Object.fromEntries(Object.entries(ctx.raw).map(([k, f]) => [k, (...a) => { const r = f(...a); return r && typeof r.then === "function" ? r.then(plain) : plain(r); }]));
  return {api, ctx, log, ls};
}

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("ok  -", name); };
const NOW = 1_800_000_000_000;
const saved1 = (id, ts, extra = {}) => { const [appid, gid] = id.split(":"); return {id, appid, gid, title: "T" + gid, date: 5, url: "https://store.steampowered.com/app/" + appid, summary: "s", ts, ...extra}; };
const file = obj => ({size: JSON.stringify(obj).length, text: async () => typeof obj === "string" ? obj : JSON.stringify(obj)});
const valid = extra => ({app: "game-patch-radar", format: 1, seen: {}, saved: [], removed: {}, ...extra});

(async () => {
  const {api} = makeApp();

  await t("pulizia: un file di un'altra app, senza formato o di una versione futura viene rifiutato con un messaggio chiaro", () => {
    for (const bad of [null, [], "x", {}, {app: "altra"}, {app: "game-patch-radar"}, {app: "game-patch-radar", format: 0}, {app: "game-patch-radar", format: "1"}])
      assert.throws(() => api.backupClean(bad, NOW), /non è una copia|formato riconoscibile/);
    assert.throws(() => api.backupClean({app: "game-patch-radar", format: 99}, NOW), /versione più recente/);
  });

  await t("pulizia: tiene solo dati validi (gid, appid, url, tempi) e ignora il resto", () => {
    const c = api.backupClean(valid({
      seen: {"892970": ["a1", "a1", "b_2", "../x", 5, "x".repeat(41)], "abc": ["z"], "12345678901": ["z"], "7": "no"},
      saved: [saved1("1:a", NOW - 5), saved1("2:b", NOW, {url: "javascript:alert(1)", title: "<b>x</b>\n\u0007y", date: -4}), saved1("3:c", NOW + 9e9),
        {id: "9:z", appid: "8", gid: "z"}, {id: "1:a", appid: "1", gid: "a<"}, null, "boh", saved1("4:d", NOW, {summary: "y".repeat(500)})],
      removed: {"5:e": NOW - 1, "bad": NOW, "6:f": -1, "7:g": "x", "8:h": NOW + 9e9},
      hidden: ["1", "2", 3, "x", "../1", "1"],
      prefs: {theme: "dark", font: 1.15, onlyPatch: true, altro: "x"},
    }), NOW);
    assert.deepEqual(c.seen, {"892970": ["a1", "b_2"]});
    assert.deepEqual(c.saved.map(x => x.id), ["1:a", "2:b", "3:c", "4:d"]);
    assert.equal(c.saved[1].url, ""); assert.equal(c.saved[1].date, 0);
    assert.doesNotMatch(c.saved[1].title, /[\u0000-\u001f]/);
    assert.equal(c.saved[2].ts, NOW, "un tempo nel futuro lontano diventa «adesso»");
    assert.equal(c.saved[3].summary.length, 300);
    assert.deepEqual(c.removed, {"5:e": NOW - 1});
    assert.deepEqual(c.hidden, ["1", "2", "3"]);
    assert.deepEqual(c.prefs, {theme: "dark", font: 1.15, onlyPatch: true});
  });

  await t("pulizia: preferenze fuori elenco scartate; senza «hidden» resta null (non si toccano i nascosti)", () => {
    const c = api.backupClean(valid({prefs: {theme: "rosso", font: 2, onlyPatch: "si"}}), NOW);
    assert.deepEqual(c.prefs, {}); assert.equal(c.hidden, null);
  });

  await t("pulizia: limiti sul numero di giochi, patch lette e salvati", () => {
    const seen = {}; for (let i = 1; i <= 300; i++) seen[String(i)] = Array.from({length: 150}, (_, j) => "g" + j);
    const saved = Array.from({length: 400}, (_, i) => saved1((i + 1) + ":g", NOW));
    const removed = Object.fromEntries(Array.from({length: 500}, (_, i) => [(i + 1) + ":g", NOW]));
    const c = api.backupClean(valid({seen, saved, removed}), NOW);
    assert.equal(Object.keys(c.seen).length, 200); assert.equal(c.seen["1"].length, 80);
    assert.equal(c.saved.length, 200); assert.equal(Object.keys(c.removed).length, 300);
  });

  await t("unione: il «letto» si somma, per i salvati vince l'azione più recente", () => {
    const local = {seen: {"1": ["a", "b"]}, saved: [saved1("1:a", 100), saved1("1:b", 300)], removed: {"1:c": 200}};
    const inc = {seen: {"1": ["b", "c"], "2": ["z"]}, saved: [saved1("1:a", 150, {title: "nuovo"}), saved1("1:b", 100), saved1("1:c", 250), saved1("1:d", 50)], removed: {"1:b": 200, "1:d": 60}};
    const m = api.backupMerge(local, inc);
    assert.deepEqual(m.seen, {"1": ["a", "b", "c"], "2": ["z"]});
    assert.deepEqual(m.saved.map(x => x.id), ["1:b", "1:c", "1:a"]);   // 1:b salvata dopo averla tolta (300 > 200), 1:c salvata dopo (250 > 200), 1:a più recente dal file, 1:d tolta dopo (60 ≥ 50)
    assert.equal(m.saved.find(x => x.id === "1:a").title, "nuovo");
    assert.deepEqual(m.removed, {"1:d": 60});
  });

  await t("unione: i dati del dispositivo non si perdono se il file è vuoto", () => {
    const local = {seen: {"1": ["a"]}, saved: [saved1("1:a", 1)], removed: {"2:b": 5}};
    assert.deepEqual(api.backupMerge(local, {seen: {}, saved: [], removed: {}}), local);
  });

  await t("esportazione: stesso formato della sincronizzazione, più nascosti e preferenze; niente codice né notifiche", () => {
    const {api, ctx} = makeApp();
    api.set("seen", {"892970": ["a1", "a2"]}); api.set("saved", [saved1("892970:a1", NOW)]); api.set("hidden", ["1203620"]); api.set("onlyPatch", true);
    const b = api.backupBuild();
    assert.deepEqual(Object.keys(b).sort(), ["app", "appVersion", "exported", "format", "hidden", "prefs", "removed", "saved", "seen"]);
    assert.equal(b.app, "game-patch-radar"); assert.equal(b.format, 1); assert.equal(b.appVersion, "1.2.0");
    assert.deepEqual(b.prefs, {theme: "auto", font: 1, onlyPatch: true});
    assert.deepEqual(b.hidden, ["1203620"]);
    assert(!isNaN(Date.parse(b.exported)));
    assert.doesNotMatch(JSON.stringify(b), /sync|code|codice|notif|ntfy|token|password/i);
    // ciò che si esporta si reimporta identico
    const c = api.backupClean(JSON.parse(JSON.stringify(b)));
    assert.deepEqual(c.seen, b.seen); assert.deepEqual(c.saved.map(x => x.id), ["892970:a1"]); assert.deepEqual(c.hidden, ["1203620"]); assert.deepEqual(c.prefs, b.prefs);
  });

  await t("il nome del file contiene la data", () => {
    assert.equal(api.backupFileName(new Date(2026, 10, 5)), "patch-radar-2026-11-05.json");
  });

  await t("importazione: chiede conferma con i numeri, poi unisce e applica preferenze e nascosti", async () => {
    const {api, log} = makeApp();
    api.set("seen", {"1": ["a"]}); api.set("saved", [saved1("1:a", 10)]);
    await api.backupImport(file(valid({seen: {"1": ["b"], "2": ["c", "d"]}, saved: [saved1("2:c", 20)], hidden: ["9"], prefs: {theme: "light", font: 1.3, onlyPatch: true}})));
    assert.match(log.confirms[0], /1 salvati e 3 patch lette.*UNISCONO.*giochi nascosti/);
    const s = api.state();
    assert.deepEqual(s.seen, {"1": ["a", "b"], "2": ["c", "d"]});
    assert.deepEqual(s.saved.map(x => x.id), ["2:c", "1:a"]);
    assert.deepEqual(s.hidden, ["9"]); assert.equal(s.theme, "light"); assert.equal(s.fontIdx, 3); assert.equal(s.onlyPatch, true);
    for (const c of ["saveSeen", "persistSaved", "saveHidden", "refreshViews"]) assert(log.calls.includes(c), c + " non chiamata");
    assert.match(log.toasts.at(-1), /importati/);
  });

  await t("importazione: se rifiuti la conferma non cambia nulla", async () => {
    const {api, log} = makeApp({confirmAnswer: false});
    api.set("seen", {"1": ["a"]});
    await api.backupImport(file(valid({seen: {"2": ["c"]}, hidden: ["5"], prefs: {theme: "dark"}})));
    assert.deepEqual(api.state().seen, {"1": ["a"]}); assert.deepEqual(api.state().hidden, []); assert.equal(api.state().theme, "auto");
    assert.deepEqual(log.calls, []);
  });

  await t("importazione: file non valido, troppo grande o di un'altra app → errore leggibile e nessuna modifica", async () => {
    const {api, log} = makeApp();
    api.set("seen", {"1": ["a"]});
    await assert.rejects(() => api.backupImport(file("{non json")), /non è leggibile/);
    await assert.rejects(() => api.backupImport(file({app: "altra", format: 1})), /non è una copia/);
    await assert.rejects(() => api.backupImport({size: 5 * 1024 * 1024, text: async () => "{}"}), /troppo grande/);
    await assert.doesNotReject(() => api.backupImport(null));
    assert.deepEqual(api.state().seen, {"1": ["a"]}); assert.deepEqual(log.confirms, []);
  });

  await t("importazione senza «hidden» né preferenze lascia nascosti e aspetto come sono", async () => {
    const {api} = makeApp();
    api.set("hidden", ["4"]); api.set("theme", "dark");
    await api.backupImport(file(valid({seen: {"2": ["c"]}})));
    assert.deepEqual(api.state().hidden, ["4"]); assert.equal(api.state().theme, "dark");
  });

  console.log(`backup.test.js: ${n} test passati`);
})().catch(e => { console.error("FAIL", e); process.exit(1); });
