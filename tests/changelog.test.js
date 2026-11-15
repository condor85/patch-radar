// Registro delle novità (js/changelog.js): formato, ordine e coerenza con APP_VERSION. Si lancia dalla radice: node tests/changelog.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appVersion = /const APP_VERSION = "([^"]+)"/.exec(html)[1];

// il file si carica con un DOM finto minimo: serve solo per leggere i dati e provare le funzioni pure
const els = {};
const fakeEl = id => els[id] || (els[id] = {id, textContent: "", innerHTML: "", listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, append() {}});
const ctx = {APP_VERSION: appVersion, $: fakeEl, h: () => ({append() {}}), openOv() {}, closeOv() {}, Intl, Date, String, isNaN};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js", "changelog.js"), "utf8") + "\n;this.api = {CHANGELOG, CHANGE_TYPES, APP_VERSION_SHOWN, changelogDate};", ctx, {filename: "changelog.js"});
const {CHANGELOG, CHANGE_TYPES, APP_VERSION_SHOWN, changelogDate} = ctx.api;

const semver = v => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); assert(m, `versione non valida: ${v} (serve 1.2.3)`); return m.slice(1).map(Number); };
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  -", name); };

t("la versione nell'app è nel formato 1.2.3 e la prima voce del registro coincide (alza entrambe insieme)", () => {
  assert.deepEqual(semver(appVersion.replace(/-[0-9a-f]{8}$/, "")), semver(CHANGELOG[0].version));
  assert.equal(appVersion, CHANGELOG[0].version, "APP_VERSION in index.html e la prima voce di CHANGELOG devono avere la stessa versione");
});

t("le voci sono in ordine dalla più recente, senza versioni ripetute", () => {
  for (let i = 1; i < CHANGELOG.length; i++) assert(cmp(semver(CHANGELOG[i - 1].version), semver(CHANGELOG[i].version)) > 0, `${CHANGELOG[i - 1].version} deve venire dopo ${CHANGELOG[i].version}`);
});

t("le date sono valide e non decrescono andando verso il passato", () => {
  for (const r of CHANGELOG) assert(/^\d{4}-\d{2}-\d{2}$/.test(r.date) && !isNaN(new Date(r.date)), `data non valida: ${r.date}`);
  for (let i = 1; i < CHANGELOG.length; i++) assert(CHANGELOG[i - 1].date >= CHANGELOG[i].date, "le date devono essere in ordine dalla più recente");
});

t("ogni voce ha almeno una modifica, con tipo ammesso e testo sensato", () => {
  for (const r of CHANGELOG) {
    assert(Array.isArray(r.changes) && r.changes.length > 0, `${r.version}: nessuna modifica`);
    for (const c of r.changes) {
      assert(Object.hasOwn(CHANGE_TYPES, c.type), `${r.version}: tipo non ammesso (${c.type})`);
      assert(typeof c.text === "string" && c.text.length >= 15 && c.text.length <= 300, `${r.version}: testo troppo corto o lungo: ${c.text}`);
      assert(!/[<>]/.test(c.text), `${r.version}: niente HTML nei testi`);
    }
  }
});

t("il numero mostrato in alto non include il suffisso di controllo aggiunto alla pubblicazione", () => {
  const c2 = {...ctx, APP_VERSION: "1.1.0-3fa9c1d2"};
  vm.createContext(c2);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "changelog.js"), "utf8") + "\n;this.shown = APP_VERSION_SHOWN;", c2);
  assert.equal(c2.shown, "1.1.0");
  assert.equal(els.verBtn.textContent, "v1.1.0");
});

t("la pagina ha il pulsante della versione e la finestra delle novità", () => {
  assert(/id="verBtn"/.test(html) && /id="changelog"/.test(html) && /id="changelogBody"/.test(html) && /id="clClose"/.test(html));
  assert(html.indexOf('id="verBtn"') < html.indexOf('class="by"'), "la versione deve venire prima di «By Pugno» nell'intestazione, così non viene tagliata sugli schermi stretti");
});

t("Esc chiude la finestra delle novità (è nell'elenco di closeTopOverlay)", () => {
  assert(/for \(const id of \[[^\]]*"changelog"/.test(fs.readFileSync(path.join(root, "js", "viewer.js"), "utf8")), "aggiungi \"changelog\" all'elenco di closeTopOverlay in js/viewer.js");
});

t("date in italiano", () => { assert.match(changelogDate("2026-11-15"), /15 novembre 2026/); assert.equal(changelogDate("boh"), "boh"); });

console.log(`changelog.test.js: ${n} test passati`);
