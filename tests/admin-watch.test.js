// Gestione giochi (js/admin-games.js): cosa fa il clic su «Osserva» / «Smetti». Si lancia dalla radice: node tests/admin-watch.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fake = new Proxy(function () {}, {get: (t, p) => (p === Symbol.toPrimitive ? () => "" : fake), apply: () => fake, construct: () => fake});
const ctx = {document: fake, $: () => fake, h: () => fake, console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "admin-games.js"), "utf8"), ctx, {filename: "admin-games.js"});
const watchAfterClick = (g, shift) => vm.runInContext("watchAfterClick", ctx)(g, shift);

// gioco non osservato: «Osserva» lo mette in osservazione, con o senza Maiusc
assert.equal(watchAfterClick({appid: 1}, false), true);
assert.equal(watchAfterClick({appid: 1, watch: false}, true), true);
// gioco osservato: «Smetti» toglie l'osservazione
assert.equal(watchAfterClick({appid: 1, watch: true}, false), false);
assert.equal(watchAfterClick({appid: 1, watch: true}, undefined), false);
// gioco osservato con Maiusc: si cambia il prezzo e si continua a osservare (prima smetteva di osservarlo e cancellava il prezzo)
assert.equal(watchAfterClick({appid: 1, watch: true, target: 19.99}, true), true);

console.log("clic su Osserva/Smetti: ok");
