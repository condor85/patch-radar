// Test di plainText() in js/utils.js: il testo delle patch di Steam si legge senza tag grezzi e senza perdere parole (si lancia dalla radice: node tests/plaintext.test.js)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "utils.js"), "utf8");
const m = /function plainText\(input\) \{[\s\S]*?\n\}\n/.exec(src);
assert(m, "plainText non trovata in js/utils.js");
// il browser decodifica le entità HTML con un <textarea>: qui basta un finto elemento che restituisce il testo com'è
const document = {createElement: () => ({set innerHTML(v) { this._v = v; }, get value() { return this._v; }})};
const plainText = new Function("document", m[0] + "; return plainText;")(document);

// formattazione normale: titoli, elenchi, grassetto, link
assert.strictEqual(plainText("[h2]Novità[/h2][list][*]Uno[*][b]Due[/b][/list]"), "# Novità\n\n• Uno\n• Due");
assert.strictEqual(plainText("[url=https://example.com/x]la pagina[/url]"), "la pagina");

// tag sconosciuti con attributi, come quelli reali dei post di RuneScape: Dragonwilds ed Enshrouded
assert.strictEqual(plainText('Guarda [dynamiclink href="https://www.twitch.tv/x"][/dynamiclink] dal vivo'), "Guarda  dal vivo");
assert.strictEqual(plainText('A [carousel autoplay="1"]B[/carousel] C'), "A B C");
assert.strictEqual(plainText("a [mistero=1]b[/mistero] c"), "a b c");

// le parentesi quadre vere: Steam le scrive con la barra, qui si leggono senza e non si perde la parola
assert.strictEqual(plainText("\\[AMD] Fixed an issue where crashes occurred"), "[AMD] Fixed an issue where crashes occurred");
assert.strictEqual(plainText("binding evade to \\[RMB]+\\[SPACE] would jump"), "binding evade to [RMB]+[SPACE] would jump");
assert.strictEqual(plainText("[url=https://x.test]\\[Known Issues][/url]"), "[Known Issues]");
// senza barra, una parola tra parentesi senza attributi resta testo
assert.strictEqual(plainText("[Fixed] a crash"), "[Fixed] a crash");
// la barra davanti a un tag finto non lo fa sparire: «\[/b]» non è una chiusura
assert.strictEqual(plainText("a \\[/b] c"), "a [/b] c");
// nomi di tasti che sembrano tag («\[I]» inventario, «\[P]» pausa, «\[B]»): restano parole, non diventano grassetto o a capo
assert.strictEqual(plainText("Premi \\[I] per l'inventario e \\[P] per la pausa, \\[B] indietro"), "Premi [I] per l'inventario e [P] per la pausa, [B] indietro");

// un confronto con «<» e «>» non viene scambiato per HTML
assert.strictEqual(plainText("se vita < 5 e danno > 3"), "se vita < 5 e danno > 3");

console.log("plainText: ok");
