// Test di sharedGame() in js/share.js e della voce share_target del manifest (si lancia dalla radice: node tests/share.test.js)
const fs = require("fs"), assert = require("assert"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "share.js"), "utf8");
const sharedGame = new Function(src + "; return sharedGame;")();

// link della pagina Steam nel campo url (condivisione dal browser)
assert.deepStrictEqual(sharedGame("?title=Enshrouded%20on%20Steam&url=https%3A%2F%2Fstore.steampowered.com%2Fapp%2F1203620%2FEnshrouded%2F"), {appid: 1203620, name: "Enshrouded"});
// l'app Steam mette il link nel testo
assert.deepStrictEqual(sharedGame("?text=" + encodeURIComponent("Hades su Steam https://store.steampowered.com/app/1145360/Hades/")), {appid: 1145360, name: "Hades"});
// senza titolo il nome si ricava dal testo, ripulito
assert.strictEqual(sharedGame("?text=" + encodeURIComponent("Guarda <b>questo</b>\n\ngioco https://store.steampowered.com/app/10/")).name, "Guarda b questo /b gioco");
// niente gioco Steam: si capisce che è stata una condivisione, ma senza numero
assert.deepStrictEqual(sharedGame("?url=https%3A%2F%2Fexample.com%2Fapp%2F123"), {appid: null, name: ""});
assert.deepStrictEqual(sharedGame("?text=ciao"), {appid: null, name: ""});
// apertura normale dell'app: nessuna condivisione
assert.strictEqual(sharedGame(""), null);
assert.strictEqual(sharedGame("?x=1"), null);
// il numero ha al massimo 9 cifre e il nome è limitato
assert.strictEqual(sharedGame("?url=https%3A%2F%2Fstore.steampowered.com%2Fapp%2F1234567890%2F").appid, 123456789);
assert(sharedGame("?title=" + "a".repeat(500) + "&url=https%3A%2F%2Fstore.steampowered.com%2Fapp%2F5%2F").name.length <= 80);
// senza un numero dopo /app/ non c'è nessun gioco (come parseAppId, conta solo il numero: è l'unico dato inviato al ponte)
assert.strictEqual(sharedGame("?url=" + encodeURIComponent("https://evil.example/?u=store.steampowered.com/app/")).appid, null);

// manifest: la condivisione è abilitata e punta all'app
const man = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.webmanifest"), "utf8"));
assert.deepStrictEqual(man.share_target, {action: "./", method: "GET", params: {title: "title", text: "text", url: "url"}});
console.log("share.test.js: ok");
