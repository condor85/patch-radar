// Test dell'elenco giochi in js/core.js (validazione dei numeri app Steam). Si lancia dalla radice: node tests/core.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = {
  location: {protocol: "file:"}, sessionStorage: {getItem() { return null; }, setItem() {}}, localStorage: {getItem() { return null; }, setItem() {}, removeItem() {}},
  document: {getElementById() { return null; }}, console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8") + "\n;this.api = {setGames, validAppId, get GAMES() { return GAMES; }, get ORDER() { return ORDER; }};", ctx, {filename: "core.js"});
const api = ctx.api;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  -", name); };

t("numeri app validi: interi positivi, anche come testo di sole cifre", () => {
  for (const v of [1, 892970, "892970", 999999999]) assert.equal(api.validAppId(v), true, String(v));
});

t("numeri app non validi: zero, negativi, decimali, testo con altro, troppo lunghi, oggetti", () => {
  for (const v of [0, -5, 1.5, "12a", "1e5", " 7", "../x", "1/../../x", "", null, undefined, NaN, Infinity, 1e10, "1234567890", {}, [1], true]) assert.equal(api.validAppId(v), false, String(v));
});

t("setGames scarta le voci non valide e normalizza l'appid in numero", () => {
  api.setGames([{appid: "10", name: "Dieci"}, {appid: "x/../y", name: "Cattivo"}, null, "boh", {appid: 20}, {name: "Senza numero"}]);
  assert.deepEqual([...api.ORDER], ["10", "20"]);
  assert.equal(api.GAMES["10"].appid, 10);
  assert.equal(api.GAMES["10"].store, "https://store.steampowered.com/app/10/");
  assert.equal(api.GAMES["20"].name, "Gioco 20");
});

t("se tutte le voci sono rovinate si tiene l'elenco attuale", () => {
  api.setGames([{appid: 7, name: "Sette"}]);
  api.setGames([{appid: "../../x"}, {appid: null}]);
  assert.deepEqual([...api.ORDER], ["7"]);
});

t("un valore che non è un elenco viene ignorato; un elenco vuoto svuota come prima", () => {
  api.setGames([{appid: 7, name: "Sette"}]);
  api.setGames(undefined); api.setGames(null); api.setGames({appid: 3});
  assert.deepEqual([...api.ORDER], ["7"]);
  api.setGames([]);
  assert.deepEqual([...api.ORDER], []);
});

console.log(`core.test.js: ${n} test passati`);
