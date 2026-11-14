// Test di patchCadence() in index.html (si lancia dalla radice: node tests/cadence.test.js)
const fs = require("fs"), assert = require("assert");
const src = fs.readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
const m = src.match(/\/\* PATCH-CADENCE:start \*\/([\s\S]*?)\/\* PATCH-CADENCE:end \*\//);
assert(m, "blocco PATCH-CADENCE non trovato in index.html");
const isPatchItem = it => it.patch === true;
const patchCadence = new Function("isPatchItem", m[1] + "; return patchCadence;")(isPatchItem);
const DAY = 86400, mk = days => days.map(d => ({patch: true, date: 1000000 + d * DAY}));

// ogni 7 giorni, ultima al giorno 21 → prossima al giorno 28
let c = patchCadence(mk([0, 7, 14, 21]), 1000000 + 22 * DAY);
assert.strictEqual(c.everyDays, 7); assert.strictEqual(c.next, 1000000 + 28 * DAY); assert.strictEqual(c.overdueDays, 0);
// in ritardo di 3 giorni
c = patchCadence(mk([0, 7, 14, 21]), 1000000 + 31 * DAY);
assert.strictEqual(c.overdueDays, 3);
// in ritardo di oltre il doppio dell'intervallo: nessuna stima
assert.strictEqual(patchCadence(mk([0, 7, 14, 21]), 1000000 + 60 * DAY), null);
// troppo poche patch
assert.strictEqual(patchCadence(mk([0, 7, 14]), 0), null);
// gli annunci non patch non contano
assert.strictEqual(patchCadence([...mk([0, 7, 14]), {patch: false, date: 1000000 + 21 * DAY}], 0), null);
// intervalli troppo irregolari
assert.strictEqual(patchCadence(mk([0, 1, 2, 400]), 0), null);
// più patch nello stesso giorno (mediana < 1 giorno)
assert.strictEqual(patchCadence(mk([0, 0, 0, 0]), 0), null);
console.log("cadence.test.js: ok");
