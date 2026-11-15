/* ---------- Sincronizzazione personale: «letto» e «salvati» su più dispositivi ----------
   Ognuno ha un proprio codice (creato qui, senza password né account). I dati stanno in un archivio privato sul ponte,
   uno per codice. Il «letto» si unisce soltanto; per i salvati vince l'azione più recente (salvare/togliere). */
/* SYNC-CLIENT:start */
const SYNC_KEY = "game_patch_radar_sync_v1";
let sync = {code: "", last: 0};       // codice personale e ultima sincronizzazione riuscita: solo su questo dispositivo
let syncBusy = false, syncAgain = false, syncTimer = 0, syncErr = "", syncShow = false, pendingSync = "";
function loadSync() {
 try { const d = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); if (d && typeof d.code === "string" && /^[a-z0-9-]{12,20}$/i.test(d.code)) sync = {code: d.code, last: Number(d.last) || 0}; } catch {}
 try { const r = JSON.parse(localStorage.getItem(REMOVED_KEY) || "null"); if (r && typeof r === "object" && !Array.isArray(r)) savedRemoved = r; } catch {}
}
function saveSyncPref() { try { sync.code ? localStorage.setItem(SYNC_KEY, JSON.stringify(sync)) : localStorage.removeItem(SYNC_KEY); } catch {} }
function syncUnlink(msg) { sync = {code: "", last: 0}; syncShow = false; saveSyncPref(); syncErr = msg || ""; }
async function syncApi(path, body, code = sync.code) {
 let r;
 try { r = await fetch(bridgeUrl() + path, {method: "POST", headers: {"Content-Type": "application/json", ...(code ? {Authorization: "Bearer " + code} : {})}, body: JSON.stringify(body || {}), cache: "no-store", signal: AbortSignal.timeout(20000)}); }
 catch { throw new Error("Il ponte non risponde. Controlla la connessione e riprova."); }
 let d = {}; try { d = await r.json(); } catch {}
 if (!r.ok) { const e = new Error(d.error || "Errore " + r.status); e.status = r.status; throw e; }
 return d;
}
function syncSoon() {
 if (!sync.code || !bridgeUrl()) return;
 clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 4000);   // più modifiche ravvicinate partono in un solo invio
}
function syncPayload() {
 const now = Date.now(), s = {};
 for (const [k, list] of Object.entries(seen)) if (/^\d{1,9}$/.test(k) && Array.isArray(list)) s[k] = list.map(String);
 return {seen: s, removed: savedRemoved, saved: saved.map(x => ({id: x.id, appid: x.appid, gid: x.gid, title: x.title, date: x.date, url: x.url, summary: String(x.summary || "").slice(0, 300), ts: x.ts || (x.ts = now)}))};
}
/* Applica la risposta del ponte: «letto» si aggiunge, i salvati diventano quelli del ponte (tenendo il testo completo che c'è già qui) */
function applySync(d) {
 for (const [k, list] of Object.entries(d.seen || {})) {
  if (!Array.isArray(list)) continue;
  const cur = seen[k] || [], merged = [...new Set([...cur, ...list.map(String)])].slice(0, 80);
  if (!seen[k] || merged.length !== cur.length) seen[k] = merged;
 }
 seenSnap = JSON.stringify(seen);   // quanto arriva dal ponte non va rimandato indietro
 saveSeen();
 const local = new Map(saved.map(x => [x.id, x]));
 saved = (Array.isArray(d.saved) ? d.saved : []).slice(0, 200).map(x => { const l = local.get(x.id); return l ? {...l, ts: x.ts} : {id: x.id, appid: x.appid, gid: x.gid, title: x.title, date: x.date, url: x.url, summary: x.summary, ts: x.ts}; });
 savedRemoved = d.removed && typeof d.removed === "object" ? d.removed : {};
 if (savedView && !saved.length) savedView = false;
 persistSaved(true);
}
async function syncNow() {
 if (!sync.code || !bridgeUrl()) return false;
 if (syncBusy) { syncAgain = true; return false; }
 syncBusy = true; clearTimeout(syncTimer);
 let ok = false;
 try {
  const d = await syncApi("/sync/sync", syncPayload());
  applySync(d);
  sync.last = Number(d.time) || Date.now(); saveSyncPref(); syncErr = ""; ok = true;
  refreshViews(); updateTitle();
 } catch (e) {
  if (e.status === 404 || e.status === 401) syncUnlink("Il codice di sincronizzazione non è più valido: i dati su questo dispositivo restano, ma non si sincronizzano più.");
  else syncErr = e.message;
 } finally {
  syncBusy = false;
  if (syncAgain) { syncAgain = false; syncSoon(); }
  renderSync();
 }
 return ok;
}
async function syncCreate() {
 const d = await syncApi("/sync/new", {}, "");
 sync = {code: d.code, last: 0}; saveSyncPref(); syncErr = ""; syncShow = true;
 return syncNow();
}
async function syncJoin(code) {
 sync = {code: String(code).trim(), last: 0}; saveSyncPref(); syncErr = "";
 const ok = await syncNow();
 if (!ok && sync.code && !syncErr) syncErr = "Non riesco a collegarmi ora.";
 return ok;
}
/* Link per l'altro dispositivo (…#sincro=codice): chiede conferma, poi toglie il codice dall'indirizzo */
function syncFromHash() {
 const m = /^#sincro=([^&]{4,80})$/.exec(location.hash || "");
 if (!m) return;
 try { history.replaceState(null, "", location.pathname + location.search); } catch {}
 try { pendingSync = decodeURIComponent(m[1]); } catch { pendingSync = ""; }
}
async function syncJoinPending() {
 const code = pendingSync; pendingSync = "";
 if (!code || sync.code || !bridgeUrl()) { syncNow(); return; }
 if (!confirm("Collegare questo dispositivo alla sincronizzazione di «letto» e «salvati»? I dati di questo dispositivo si uniranno a quelli già sincronizzati.")) return;
 await syncJoin(code); openManager();
}
function syncLastLabel() {
 if (!sync.last) return "Non ancora sincronizzato.";
 try { return "Ultima sincronizzazione: " + new Intl.DateTimeFormat("it-IT", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}).format(new Date(sync.last)) + "."; } catch { return "Sincronizzato."; }
}
function renderSync() {
 const box = $("syncBox"); if (!box) return; box.innerHTML = "";
 if (!bridgeUrl()) { box.append(h("p", {class: "v-note", style: "margin-top:0"}, "La sincronizzazione funziona con il ponte Cloudflare, che qui non è ancora collegato.")); return; }
 const busy = btn => { btn.disabled = true; };
 if (syncErr) box.append(h("p", {class: "nstat errmsg"}, syncErr));
 if (!sync.code) {
  box.append(h("p", {class: "v-note", style: "margin-top:0"}, "Ritrovi le patch lette e i salvati su un altro telefono o computer, e non li perdi se cambi dispositivo. Crei un tuo codice personale e lo scrivi sugli altri dispositivi: non serve nessun account. Chi non lo usa continua come prima, con i dati solo su questo dispositivo."));
  box.append(h("div", {class: "row-btns"}, mkBtn("➕ Crea il mio codice", async b => { busy(b); try { await syncCreate(); } catch (e) { syncErr = e.message; } renderSync(); }, "pri")));
  const input = h("input", {type: "text", placeholder: "Ho già un codice (es. abcd-efgh-jkmn)", autocomplete: "off", autocapitalize: "none", spellcheck: "false"});
  const go = mkBtn("Collega", async b => {
   if (input.value.trim().length < 6) { syncErr = "Scrivi il codice che hai creato sull'altro dispositivo."; renderSync(); return; }
   busy(b); await syncJoin(input.value); renderSync();
  });
  input.addEventListener("keydown", e => { if (e.key === "Enter") go.click(); });
  box.append(h("div", {class: "row"}, input, go));
  return;
 }
 box.append(h("p", {class: "nstat okmsg"}, "✓ Sincronizzazione attiva. " + syncLastLabel()));
 const code = sync.code.length === 12 ? sync.code.match(/.{4}/g).join("-") : sync.code;
 box.append(h("div", {class: "row"}, h("span", {class: "nm"}, "Il tuo codice: " + (syncShow ? code : "••••-••••-••••")), mkBtn(syncShow ? "Nascondi" : "Mostra", () => { syncShow = !syncShow; renderSync(); })));
 box.append(h("p", {class: "v-note", style: "margin-top:0"}, "Chi conosce il codice può leggere e modificare i tuoi salvati: non darlo a nessuno. Per un altro tuo dispositivo scrivilo lì (Impostazioni → Sincronizza) o copia il link e aprilo da quel dispositivo."));
 box.append(h("div", {class: "row-btns"},
  mkBtn("↻ Sincronizza ora", async b => { busy(b); const ok = await syncNow(); if (ok) toast("✓ Sincronizzato"); }),
  mkBtn("📋 Copia il codice", async () => { try { await navigator.clipboard.writeText(code); toast("📋 Codice copiato"); } catch { toast("Copia non riuscita"); } }),
  mkBtn("🔗 Copia il link", async () => { try { await navigator.clipboard.writeText(inviteUrl() + "#sincro=" + encodeURIComponent(sync.code)); toast("🔗 Link copiato: contiene il codice"); } catch { toast("Copia non riuscita"); } })));
 box.append(h("div", {class: "row-btns"},
  mkBtn("Scollega questo dispositivo", () => { if (confirm("Scollegare questo dispositivo? I dati qui restano, ma non si sincronizzano più. Gli altri dispositivi e il ponte non cambiano.")) { syncUnlink(); renderSync(); } }),
  mkBtn("🗑 Elimina i dati dal ponte", async b => {
   if (!confirm("Eliminare dal ponte i dati sincronizzati? Il codice smetterà di funzionare su tutti i dispositivi; i dati già presenti su ciascun dispositivo restano.")) return;
   busy(b);
   try { await syncApi("/sync/forget", {}); syncUnlink(); toast("🗑 Dati eliminati dal ponte"); } catch (e) { syncErr = e.message; }
   renderSync();
  })));
}
/* SYNC-CLIENT:end */
