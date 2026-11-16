// Avviso di dati vecchi (js/network.js: dataFreshAt, staleHours). Si lancia dalla radice: node tests/stale.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = {location: {protocol: "file:"}, console, Date, Number, Math, Array, Promise};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "network.js"), "utf8") + "\n;this.api = {dataFreshAt, staleHours, DATA_STALE_MS};", ctx, {filename: "network.js"});
const {dataFreshAt, staleHours, DATA_STALE_MS} = ctx.api;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  -", name); };
const NOW = 1_800_000_000_000, H = 3600 * 1000, sec = ms => Math.floor(ms / 1000);

t("il dato più fresco è il più recente tra «updated» e l'ora dei giocatori online", () => {
  const d = {updated: sec(NOW - 30 * H), games: [{players: {n: 5, ts: sec(NOW - 2 * H)}}, {players: {n: 9, ts: sec(NOW - 9 * H)}}, {players: null}, null]};
  assert.equal(dataFreshAt(d, NOW), sec(NOW - 2 * H) * 1000);
  assert.equal(dataFreshAt({updated: sec(NOW - H), games: []}, NOW), sec(NOW - H) * 1000);
});

t("dati mancanti o rovinati: non si sa (0), mai un errore", () => {
  for (const d of [null, undefined, {}, {updated: "boh", games: "x"}, {updated: NaN}, {games: [{players: {ts: "x"}}]}]) assert.equal(dataFreshAt(d, NOW), 0);
});

t("un'ora nel futuro lontano (orologio sbagliato) non fa sembrare i dati freschi per sempre", () => {
  assert.equal(dataFreshAt({updated: sec(NOW + 48 * H)}, NOW), 0);
  assert.equal(dataFreshAt({updated: sec(NOW - 20 * H), games: [{players: {ts: sec(NOW + 48 * H)}}]}, NOW), sec(NOW - 20 * H) * 1000);
});

t("avviso solo oltre 12 ore; sotto soglia o senza dati non si dice nulla", () => {
  assert.equal(DATA_STALE_MS, 12 * H);
  assert.equal(staleHours(NOW - 11 * H, NOW), 0);
  assert.equal(staleHours(NOW - 12 * H, NOW), 0);       // esattamente alla soglia: non ancora
  assert.equal(staleHours(NOW - 12 * H - 1, NOW), 12);
  assert.equal(staleHours(NOW - 30.5 * H, NOW), 30);
  assert.equal(staleHours(0, NOW), 0);                  // non si sa: niente allarme
});

t("con l'Action sana i giocatori si rinnovano ogni ≤ 6 ore: non scatta mai l'avviso", () => {
  for (const ageH of [0, 1, 5, 6, 7]) assert.equal(staleHours(dataFreshAt({updated: sec(NOW - 100 * H), games: [{players: {ts: sec(NOW - ageH * H)}}]}, NOW), NOW), 0);
});

console.log(`stale.test.js: ${n} test passati`);
