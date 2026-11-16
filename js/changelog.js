/* ---------- Novità dell'app (registro delle modifiche) ---------- */
/* Ad ogni modifica visibile agli utenti: aggiungi IN CIMA una voce a CHANGELOG e porta APP_VERSION (index.html, più tutti i ?v=)
   alla stessa versione. Numerazione: 1.<novità>.<correzioni> — nuova funzione: sale il secondo numero; solo correzioni: il terzo.
   tests/changelog.test.js controlla che la prima voce e APP_VERSION coincidano e che il formato sia corretto.
   Tipi ammessi: nuovo, migliorato, sicurezza, corretto. */
const CHANGELOG = [
 {version: "1.2.0", date: "2026-11-16", changes: [
  {type: "nuovo", text: "Esporta e importa i tuoi dati: in Impostazioni puoi salvare in un file i giochi nascosti, le patch lette, i salvati e le preferenze, e ritrovarli su un altro telefono o dopo una reinstallazione. L'importazione si unisce ai dati che hai già e chiede conferma."},
  {type: "nuovo", text: "Se i dati non si aggiornano da molte ore (Steam o il servizio dei riassunti hanno un problema), in alto compare un avviso che lo dice."},
  {type: "migliorato", text: "Accessibilità: ogni interruttore e ogni pulsante ha un nome leggibile dagli screen reader, i messaggi di stato vengono annunciati e il numero di versione si può attivare a voce."},
 ]},
 {version: "1.1.0", date: "2026-11-15", changes: [
  {type: "nuovo", text: "Il numero di versione è visibile in alto, accanto al nome. Toccalo per leggere le novità, come in questa pagina."},
  {type: "sicurezza", text: "Le notifiche restano verificate anche quando la rete non risponde: una notifica falsa non può più passare in quel momento."},
  {type: "sicurezza", text: "I numeri dei giochi vengono controllati prima di essere usati negli indirizzi e negli argomenti delle notifiche."},
  {type: "sicurezza", text: "Il ponte di amministrazione rifiuta subito le richieste troppo grandi e le sue risposte non possono essere trattate come pagine web."},
  {type: "migliorato", text: "Riassunti e traduzioni arrivano da Gemini in un formato strutturato: niente più frasi di servizio dell'IA nel testo, e parole normali delle patch non vengono scartate per errore."},
  {type: "migliorato", text: "Se i dati salvati risultano illeggibili, l'aggiornamento si ferma invece di cancellare lo storico e le notifiche. Anche la scrittura dei file è più sicura."},
  {type: "migliorato", text: "La versione dei file dell'app si calcola da sola a ogni pubblicazione: non si rischia più di vedere pagine nuove con file vecchi."},
 ]},
];

const CHANGE_TYPES = {nuovo: "Nuovo", migliorato: "Migliorato", sicurezza: "Sicurezza", corretto: "Corretto"};
const APP_VERSION_SHOWN = String(typeof APP_VERSION === "string" ? APP_VERSION : "").replace(/-[0-9a-f]{8}$/, "");   // senza il suffisso di controllo aggiunto alla pubblicazione

function changelogDate(iso) {
 const d = new Date(iso + "T12:00:00");
 return isNaN(d) ? iso : new Intl.DateTimeFormat("it-IT", {day: "numeric", month: "long", year: "numeric"}).format(d);
}

function openChangelog() {
 const body = $("changelogBody"); body.innerHTML = "";
 body.append(h("h2", {}, "Novità dell'app"), h("p", {class: "v-note", style: "margin-top:0"}, "Stai usando la versione " + APP_VERSION_SHOWN + "."));
 for (const rel of CHANGELOG) {
  const card = h("div", {class: "rcard"}, h("h3", {}, "Versione " + rel.version), h("span", {class: "date"}, changelogDate(rel.date)));
  for (const c of rel.changes) {
   card.append(h("div", {class: "rs", style: "margin-top:8px"}, h("span", {class: "tag" + (c.type === "nuovo" ? " new" : "")}, CHANGE_TYPES[c.type] || "Altro"), " " + c.text));
  }
  body.append(card);
 }
 openOv("changelog");
}

$("verBtn").textContent = "v" + APP_VERSION_SHOWN;
$("verBtn").setAttribute("aria-label", "v" + APP_VERSION_SHOWN + ": novità dell'app");   // il nome contiene il testo che si vede (così «dì: v1.1.0» funziona con i comandi vocali)
$("verBtn").addEventListener("click", openChangelog);
$("clClose").addEventListener("click", () => closeOv("changelog"));
