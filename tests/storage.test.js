// Letture da localStorage (core.js, seen.js, viewer.js, utils.js): un valore leggibile ma di forma sbagliata non deve rompere l'avvio.
// Si lancia dalla radice: node tests/storage.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fake = new Proxy(function () {}, {get: (t, p) => (p === Symbol.toPrimitive ? () => "" : fake), apply: () => fake, construct: () => fake});   // ogni proprietà e chiamata restituisce se stesso

function boot(stored) {
  const noop = () => {};
  const ctx = {
    location: {protocol: "file:"}, sessionStorage: {getItem() { return null; }, setItem: noop}, console, document: fake, $: () => fake, h: () => fake, toast: noop, syncSoon: noop,
    localStorage: {getItem: k => (Object.hasOwn(stored, k) ? stored[k] : null), setItem: noop, removeItem: noop},
  };
  vm.createContext(ctx);
  for (const f of ["core.js", "seen.js", "viewer.js", "utils.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, {filename: f});
  return code => vm.runInContext(code, ctx);   // le variabili «let» dell'app si leggono solo da dentro il contesto
}

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  -", name); };
const HIDDEN = "game_patch_radar_hidden_v1", SAVED = "game_patch_radar_saved_v1", SEEN = "game_patch_radar_seen_v1", PENDING = "game_patch_radar_pending_v1";

t("giochi nascosti: un valore che non è un elenco non rompe l'avvio", () => {
  for (const bad of ['{"a":1}', "5", '"abc"', "true", "null"]) {
    const run = boot({[HIDDEN]: bad});
    run("loadHidden(); ensureSelected()");
    assert.equal(run("JSON.stringify(hidden)"), "[]", bad);
  }
});
t("giochi nascosti: restano solo i numeri app, come testo", () => {
  const run = boot({[HIDDEN]: '[10, "20", null, "x/../y", {"a":1}, "30"]'});
  run("loadHidden()");
  assert.equal(run("JSON.stringify(hidden)"), '["10","20","30"]');
});

t("salvati: un valore che non è un elenco, o voci rovinate, non fanno fallire isSaved()", () => {
  for (const bad of ['{"a":1}', "7", '"x"']) {
    const run = boot({[SAVED]: bad});
    run("loadSaved()");
    assert.equal(run("saved.length"), 0, bad);
    assert.equal(run("isSaved('1', {gid: '2'})"), false);
  }
  const run = boot({[SAVED]: '[null, 5, "x", {"title":"senza id"}, {"id":7}, {"id":"1:2","appid":1,"gid":2,"title":null,"date":"boh","ts":"9"}]'});
  run("loadSaved()");
  assert.equal(run("saved.length"), 1);
  assert.equal(run("isSaved('1', {gid: '2'})"), true);
  assert.deepEqual(JSON.parse(run("JSON.stringify(saved[0])")), {id: "1:2", appid: "1", gid: "2", title: "", url: "", summary: "", date: 0, ts: 9});
});
t("salvati: una voce valida resta identica", () => {
  const item = {id: "892970:123", appid: "892970", gid: "123", title: "Patch 1.0", date: 1700000000, url: "https://store.steampowered.com/news/app/892970/view/123", summary: "• Uno", ts: 1700000500000};
  const run = boot({[SAVED]: JSON.stringify([item])});
  run("loadSaved()");
  assert.equal(run("JSON.stringify(saved)"), JSON.stringify([item]));
});

t("lette: un numero o un testo al posto dell'elenco di un gioco non fa fallire newItems()", () => {
  const run = boot({[SEEN]: '{"seen":{"10":5,"11":"abc","12":["a",2],"__proto__":["x"],"zz":["q"]},"lastVisit":"7"}'});
  run("loadSeen(); cache['10'] = [{gid: 'x', date: 1}]; cache['12'] = [{gid: 'a', date: 1}, {gid: 'b', date: 2}]");
  assert.equal(run("JSON.stringify(seen)"), '{"12":["a","2"]}');
  assert.equal(run("lastVisit"), 7);
  assert.equal(run("newItems('10').length"), 0);
  assert.equal(run("newItems('12').length"), 1);
});
t("lette: un valore che non è un oggetto si ignora", () => {
  for (const bad of ['{"seen":[1,2]}', "[1]", "5", '"x"']) {
    const run = boot({[SEEN]: bad});
    run("loadSeen()");
    assert.equal(run("JSON.stringify(seen)"), "{}", bad);
  }
});
t("lette: i dati validi restano identici", () => {
  const run = boot({[SEEN]: '{"seen":{"10":["a","b"],"20":[]},"lastVisit":1700000000}'});
  run("loadSeen()");
  assert.equal(run("JSON.stringify(seen)"), '{"10":["a","b"],"20":[]}');
  assert.equal(run("prevVisit"), 1700000000);
});

t("modifiche in attesa: forma sbagliata ignorata, voci non oggetto scartate", () => {
  for (const bad of ["5", "[1]", '"x"']) {
    const run = boot({[PENDING]: bad});
    run("loadPending()");
    assert.equal(run("JSON.stringify(pending)"), '{"add":[],"remove":[],"watch":[]}', bad);
  }
  const run = boot({[PENDING]: '{"add":[null,{"appid":5,"ts":9}],"remove":"x","watch":[1,{"id":3}]}'});
  run("loadPending(); applyPending([])");
  assert.equal(run("JSON.stringify(pending.remove)"), "[]");
});

t("copia locale dei dati: elenchi e traduzioni di forma sbagliata si scartano, save() non fallisce", () => {
  const run = boot({game_patch_radar_v1: "x"});
  assert.equal(typeof run("STORE_KEY"), "string");
  const key = run("STORE_KEY");
  const bad = boot({[key]: '{"cache":{"10":[{"gid":"1"},null,5],"11":5,"12":"x"},"trCache":{"a":null,"b":{"src":"gemini"},"c":7}}'});
  bad("load()");
  assert.equal(bad("JSON.stringify(cache)"), '{"10":[{"gid":"1"}]}');
  assert.equal(bad("JSON.stringify(trCache)"), '{"b":{"src":"gemini"}}');
  bad("save()");   // persistable() fa slice() e legge .src: non deve lanciare
});
t("copia locale dei dati: un valore che non è un oggetto si ignora", () => {
  const key = boot({})("STORE_KEY");
  for (const bad of ["5", '"x"', "[1]", "null"]) {
    const run = boot({[key]: bad});
    run("load()");
    assert.equal(run("JSON.stringify(cache)"), "{}", bad);
  }
});

console.log(`\n${n} test ok`);
