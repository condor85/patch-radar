/* ---------- Copia dei tuoi dati: esporta in un file e importa ----------
   Per chi non usa il codice di sincronizzazione o cambia telefono. Il file ha lo stesso formato che l'app manda al ponte per la
   sincronizzazione (letto, salvati, salvati tolti) più i giochi nascosti e le preferenze di aspetto. Non contiene il codice di
   sincronizzazione né le impostazioni delle notifiche (legate al dispositivo). Importare UNISCE: non cancella nulla di quello che c'è già. */
const BACKUP_APP = "game-patch-radar", BACKUP_FORMAT = 1;
const BACKUP_MAX_BYTES = 2 * 1024 * 1024, BACKUP_MAX_GAMES = 200, BACKUP_MAX_SEEN = 80, BACKUP_MAX_SAVED = 200, BACKUP_MAX_REMOVED = 300;
const BK_GID = /^[A-Za-z0-9_-]{1,40}$/;
const bkText = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
const bkPlain = v => !!v && typeof v === "object" && !Array.isArray(v);

/* Controlla e pulisce il contenuto di un file (arriva dall'esterno: mai fidarsi). Ritorna i dati sicuri o alza un errore leggibile. */
function backupClean(raw, now = Date.now(), fonts = [0.9, 1, 1.15, 1.3]) {
 if (!bkPlain(raw) || raw.app !== BACKUP_APP) throw new Error("Questo file non è una copia dei dati di Game Patch Radar.");
 if (!Number.isInteger(raw.format) || raw.format < 1) throw new Error("Il file non ha un formato riconoscibile.");
 if (raw.format > BACKUP_FORMAT) throw new Error("Il file è stato creato da una versione più recente dell'app: aggiorna l'app e riprova.");
 const seen = {};
 if (bkPlain(raw.seen)) for (const [k, list] of Object.entries(raw.seen)) {
  if (!/^\d{1,9}$/.test(k) || !Array.isArray(list) || Object.keys(seen).length >= BACKUP_MAX_GAMES) continue;
  seen[k] = [...new Set(list.filter(g => typeof g === "string" && BK_GID.test(g)))].slice(0, BACKUP_MAX_SEEN);
 }
 const saved = [];
 if (Array.isArray(raw.saved)) for (const x of raw.saved) {
  if (!bkPlain(x) || saved.length >= BACKUP_MAX_SAVED) continue;
  const appid = String(x.appid == null ? "" : x.appid), gid = String(x.gid == null ? "" : x.gid);
  if (!/^\d{1,9}$/.test(appid) || !BK_GID.test(gid) || x.id !== appid + ":" + gid) continue;
  const ts = Number(x.ts), date = Number(x.date);
  saved.push({id: x.id, appid, gid, title: bkText(x.title, 200), date: Number.isFinite(date) && date >= 0 ? Math.round(date) : 0,
   url: typeof x.url === "string" && /^https?:\/\/[^\s<>"]{1,480}$/.test(x.url) ? x.url : "", summary: bkText(x.summary, 300),
   ts: Number.isFinite(ts) && ts > 0 && ts <= now + 86400000 ? Math.round(ts) : now});
 }
 const removed = {};
 if (bkPlain(raw.removed)) for (const [id, t] of Object.entries(raw.removed)) {
  const ts = Number(t);
  if (/^\d{1,9}:[A-Za-z0-9_-]{1,40}$/.test(id) && Number.isFinite(ts) && ts > 0 && ts <= now + 86400000 && Object.keys(removed).length < BACKUP_MAX_REMOVED) removed[id] = Math.round(ts);
 }
 const out = {seen, saved, removed, hidden: null, prefs: {}};
 if (Array.isArray(raw.hidden)) out.hidden = [...new Set(raw.hidden.map(String).filter(k => /^\d{1,9}$/.test(k)))].slice(0, BACKUP_MAX_GAMES);
 const p = bkPlain(raw.prefs) ? raw.prefs : {};
 if (["auto", "light", "dark"].includes(p.theme)) out.prefs.theme = p.theme;
 if (fonts.includes(p.font)) out.prefs.font = p.font;
 if (typeof p.onlyPatch === "boolean") out.prefs.onlyPatch = p.onlyPatch;
 return out;
}

/* Unisce i dati del file con quelli del dispositivo, con le stesse regole della sincronizzazione: «letto» si unisce soltanto;
   per i salvati vince l'azione più recente (salvare dopo aver tolto la rimette, togliere dopo aver salvato la toglie). */
function backupMerge(local, inc) {
 const seen = {};
 for (const k of new Set([...Object.keys(local.seen), ...Object.keys(inc.seen)])) seen[k] = [...new Set([...(local.seen[k] || []), ...(inc.seen[k] || [])])].slice(0, BACKUP_MAX_SEEN);
 const map = new Map(local.saved.map(x => [x.id, x]));
 const removed = {...local.removed};
 for (const [id, t] of Object.entries(inc.removed)) if (t > (removed[id] || 0)) removed[id] = t;
 for (const x of inc.saved) { const cur = map.get(x.id); if (!cur || x.ts > cur.ts) map.set(x.id, x); }
 for (const id of Object.keys(removed)) {
  const cur = map.get(id);
  if (cur) { if (removed[id] >= cur.ts) map.delete(id); else delete removed[id]; }
 }
 const keep = Object.entries(removed).sort((a, b) => b[1] - a[1]).slice(0, BACKUP_MAX_REMOVED);
 return {seen, saved: [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, BACKUP_MAX_SAVED), removed: Object.fromEntries(keep)};
}

function backupBuild() {
 const p = syncPayload();   // stesso formato della sincronizzazione
 return {app: BACKUP_APP, format: BACKUP_FORMAT, exported: new Date().toISOString(), appVersion: APP_VERSION_SHOWN,
  seen: p.seen, saved: p.saved, removed: p.removed, hidden: [...hidden],
  prefs: {theme: currentTheme(), font: FONTS[fontIdx], onlyPatch}};
}
function backupFileName(d = new Date()) {
 const two = n => String(n).padStart(2, "0");
 return "patch-radar-" + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + ".json";
}
function backupExport() {
 const data = backupBuild();
 const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], {type: "application/json"}));
 const a = h("a", {href: url, download: backupFileName(), hidden: ""});
 document.body.append(a); a.click(); a.remove();
 setTimeout(() => URL.revokeObjectURL(url), 10000);
 const n = Object.values(data.seen).reduce((t, l) => t + l.length, 0);
 toast("💾 Copia salvata: " + data.saved.length + " salvati, " + n + " patch lette");
}

/* Legge il file scelto, mostra cosa contiene e, se confermi, lo unisce ai dati di questo dispositivo */
async function backupImport(file) {
 if (!file) return;
 if (file.size > BACKUP_MAX_BYTES) throw new Error("Il file è troppo grande per essere una copia di Game Patch Radar.");
 let raw;
 try { raw = JSON.parse(await file.text()); } catch { throw new Error("Il file non è leggibile: non è una copia di Game Patch Radar."); }
 const inc = backupClean(raw);
 const nSeen = Object.values(inc.seen).reduce((t, l) => t + l.length, 0);
 if (!confirm("Importare la copia? Contiene " + inc.saved.length + " salvati e " + nSeen + " patch lette. I dati si UNISCONO a quelli di questo dispositivo: non viene cancellato nulla."
  + (inc.hidden ? " I giochi nascosti diventano quelli del file." : ""))) return;
 const m = backupMerge({seen, saved, removed: savedRemoved}, inc);
 seen = m.seen; saved = m.saved; savedRemoved = m.removed;
 if (inc.hidden) { hidden = inc.hidden; saveHidden(); }
 saveSeen(); persistSaved();
 const p = inc.prefs;
 if (p.theme) { try { localStorage.setItem(THEME_KEY, p.theme); } catch {} applyTheme(p.theme); }
 if (p.font) setFont(FONTS.indexOf(p.font));
 if (typeof p.onlyPatch === "boolean") setOnlyPatch(p.onlyPatch);
 if (savedView && !saved.length) savedView = false;
 ensureSelected(); refreshViews(); updateTitle(); renderBackup(); renderTheme();
 toast("✓ Dati importati: " + saved.length + " salvati");
}

function renderBackup() {
 const box = $("backupBox"); if (!box) return; box.innerHTML = "";
 const msg = h("p", {class: "nstat", role: "status", "aria-live": "polite"});
 const input = h("input", {type: "file", accept: "application/json,.json", hidden: "", id: "backupFile", "aria-label": "Scegli il file da importare"});
 input.addEventListener("change", async () => {
  msg.className = "nstat";
  try { await backupImport(input.files && input.files[0]); msg.textContent = ""; }
  catch (e) { msg.className = "nstat errmsg"; msg.textContent = e.message; }
  input.value = "";
 });
 box.append(h("p", {class: "v-note", style: "margin-top:0"}, "Salva in un file le patch lette, i salvati, i giochi nascosti e le scelte di aspetto, per tenerli al sicuro o portarli su un altro telefono. Il file non contiene il codice di sincronizzazione né le impostazioni delle notifiche. Importando, i dati si uniscono a quelli già presenti."),
  h("div", {class: "row-btns"}, mkBtn("⬇ Esporta i miei dati", () => { try { backupExport(); } catch { msg.className = "nstat errmsg"; msg.textContent = "Esportazione non riuscita."; } }), mkBtn("⬆ Importa da file", () => input.click())), input, msg);
}
