/* ---------- Avvio (dopo che tutto è definito) ----------
   Gli script si caricano uno dopo l'altro, e tra uno e l'altro il browser può già gestire risposte di rete ed eventi.
   Per questo qui, e solo qui, parte ogni operazione asincrona che usa funzioni di altri file (vedi tests/structure.test.js). */
const returning = (() => { try { return !!(localStorage.getItem(SEEN_KEY) || localStorage.getItem(STORE_KEY)); } catch { return true; } })();
load();
loadSeen();
loadSaved();
loadFont();
loadHidden();
loadPending();
loadPatchPref();
loadAdmin();
loadBridge();
loadTeam();
loadSync();
loadNotif();
ensureSelected();
if (cache[selected]) setStatus("Dati salvati · aggiornamento in corso…");
render();
refreshAll();
teamRefresh();
teamFromHash();
syncFromHash();
shareFromQuery();
maybeWelcome(returning);
fetch("config.json", {cache: "no-store"}).then(r => r.ok ? r.json() : null).then(c => {
 if (c) { CFG = c; setTopicLink(); renderAdmin(); teamRefresh(); renderSync(); if (pendingSync) syncJoinPending(); else syncNow(); shareAddPending(); }   // solo ora si conosce l'indirizzo del ponte: da qui si può caricare la squadra
}).catch(() => {});
