// Struttura dell'app: index.html carica i file di js/ nell'ordine giusto e tutto ciò che serve arriva online e offline.
// Si lancia dalla radice: node tests/structure.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const html = read("index.html");

// script esterni dell'app, nell'ordine in cui la pagina li carica
const tags = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
assert(tags.length > 0, "index.html non carica nessuno script");
const files = tags.map(t => t.split("?")[0]);
for (const f of files) assert(fs.existsSync(path.join(root, f)), `${f}: file mancante`);

// APP_VERSION resta in index.html: l'app la cerca lì per sapere se online c'è una versione più recente
const ver = /const APP_VERSION = "([^"]+)"/.exec(html);
assert(ver, "APP_VERSION non trovata in index.html");
// ...e ogni script ha ?v=<versione>: senza, dopo un aggiornamento il browser potrebbe mescolare pagina nuova e script vecchi in cache
for (const t of tags) assert.equal(new URLSearchParams(t.split("?")[1] || "").get("v"), ver[1], `${t}: manca ?v=${ver[1]} (cambiando l'app aggiorna APP_VERSION e tutti i ?v=)`);

// ogni file dell'app è nell'elenco precaricato dal service worker (senza, offline mancherebbe un pezzo e addAll() fallirebbe)
const shell = JSON.parse(/const SHELL = (\[[\s\S]*?\]);/.exec(read("sw.js"))[1]);
for (const f of files) assert(shell.includes(f), `${f}: manca in SHELL di sw.js`);

// ...e viene copiato nel sito pubblicato
const cp = /cp -r ([^\n]+) _site\//.exec(read(".github/workflows/update.yml"));
assert(cp, "comando di copia non trovato in update.yml");
const copied = cp[1].split(/\s+/);
for (const f of files) assert(copied.includes(f) || copied.includes(f.split("/")[0]), `${f}: update.yml non lo copia nel sito`);

// l'insieme compila come un solo script: errori di sintassi o dichiarazioni doppie tra file si vedono qui
const all = files.map(f => read(f)).join("\n");
new vm.Script(all, {filename: "app.js"});

// gli script si caricano uno dopo l'altro e, tra uno e l'altro, il browser può già gestire risposte di rete: una richiesta lanciata
// in un file e conclusa con funzioni di un file successivo fallirebbe in silenzio. Le operazioni di rete immediate stanno solo in boot.js.
for (const f of files) if (f !== "js/boot.js") assert(!/^fetch\(/m.test(read(f)), `${f}: fetch() subito a livello principale: spostala in js/boot.js`);

// i file di js/ non devono restare fuori da index.html
for (const f of fs.readdirSync(path.join(root, "js"))) assert(files.includes("js/" + f), `js/${f} non è caricato da index.html`);
console.log("structure.test.js: ok");
