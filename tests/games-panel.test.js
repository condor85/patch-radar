// Ordinamento, ricerca e scelta dei giochi nella barra (js/games-panel.js). Si lancia dalla radice: node tests/games-panel.test.js
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "games-panel.js"), "utf8");
const stub = {addEventListener() {}};
const api = new Function("$", "norm", "localStorage", "visibleKeys", "latestOf", "GAMES", "newItems", "h", "openOv", "closeOv", "agoLabel", "coverImg", "selectGame", "renderNav",
 src + "; return {sortGameRows, barGameKeys, filterGameRows, BAR_ALL_MAX, BAR_NEWS_MAX};")(
 () => stub, s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""), {getItem: () => null, setItem() {}}, () => [], () => null, {}, () => [], () => null, () => {}, () => {}, () => "", () => null, () => {}, () => {});
const {sortGameRows, barGameKeys, filterGameRows, BAR_ALL_MAX, BAR_NEWS_MAX} = api;
const row = (key, name, news, last) => ({key, name, news, last});
const rows = [row("1", "Valheim", 0, 300), row("2", "Enshrouded", 2, 100), row("3", "Ark", 0, 500), row("4", "Ürük", 5, 200)];
const keys = a => a.map(r => r.key).join(",");

// novità prima (più novità prima); a parità resta l'ordine dell'elenco
assert.strictEqual(keys(sortGameRows(rows, "new")), "4,2,1,3");
// senza novità l'ordine non cambia
assert.strictEqual(keys(sortGameRows(rows.map(r => ({...r, news: 0})), "new")), "1,2,3,4");
// ultima patch più recente prima
assert.strictEqual(keys(sortGameRows(rows, "recent")), "3,1,4,2");
// A–Z senza badare ad accenti e maiuscole
assert.strictEqual(keys(sortGameRows(rows, "name")), "3,2,4,1");
// modo sconosciuto: nessun riordino; l'elenco originale non viene modificato
assert.strictEqual(keys(sortGameRows(rows, "boh")), "1,2,3,4");
assert.strictEqual(keys(rows), "1,2,3,4");

// ricerca per nome: senza accenti e maiuscole, testo vuoto = tutti
assert.strictEqual(keys(filterGameRows(rows, "  ARK ")), "3");
assert.strictEqual(keys(filterGameRows(rows, "uruk")), "4");
assert.strictEqual(keys(filterGameRows(rows, "")), "1,2,3,4");
assert.strictEqual(keys(filterGameRows(rows, "zzz")), "");

// con pochi giochi la barra li mostra tutti
assert(BAR_ALL_MAX >= 4);
assert.strictEqual(barGameKeys(sortGameRows(rows, "new"), "1", false).join(), "4,2,1,3");

// con molti giochi: gioco aperto + al massimo BAR_NEWS_MAX con novità
const many = Array.from({length: 12}, (_, i) => row(String(i + 1), "G" + (i + 1), i % 2 ? i : 0, i));   // novità sui dispari: 1,3,5,7,9,11
const sorted = sortGameRows(many, "new");
const bar = barGameKeys(sorted, "1", false);
assert.strictEqual(bar[0], "1", "il gioco aperto è il primo");
assert.strictEqual(bar.length, 1 + BAR_NEWS_MAX);
assert(bar.slice(1).every(k => many.find(r => r.key === k).news > 0), "gli altri hanno tutti novità");
assert.strictEqual(new Set(bar).size, bar.length, "nessun gioco ripetuto");
// gioco aperto che ha già novità: non compare due volte
const bar2 = barGameKeys(sorted, "12", false);   // «12» ha novità (i=11)
assert.strictEqual(bar2.filter(k => k === "12").length, 1);
assert.strictEqual(bar2.length, 1 + BAR_NEWS_MAX);
// in Home nessun gioco è «aperto»: solo quelli con novità
assert.strictEqual(barGameKeys(sorted, "1", true).length, BAR_NEWS_MAX);
// nessuna novità: solo il gioco aperto (o niente, in Home)
const quiet = many.map(r => ({...r, news: 0}));
assert.deepStrictEqual(barGameKeys(quiet, "5", false), ["5"]);
assert.deepStrictEqual(barGameKeys(quiet, "5", true), []);
console.log("games-panel.test.js: ok");
