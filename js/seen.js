/* ---------- Nuovi aggiornamenti: cosa hai già visto ---------- */
const SEEN_KEY = "game_patch_radar_seen_v1";
let seen = {};          // gioco -> gid già visti
let prevVisit = 0;      // ultima visita precedente (per il messaggio)
let lastVisit = 0;
let seenSnap = "";      // «letto» com'era all'ultimo salvataggio: serve a capire se è cambiato qualcosa da sincronizzare
let firstRun = false;
let lastTotal = null;
let autoPicked = false;
let shownAt = Date.now();
function loadSeen() {
 try { const d = JSON.parse(localStorage.getItem(SEEN_KEY) || "null"); if (d) { seen = d.seen || {}; lastVisit = prevVisit = d.lastVisit || 0; } } catch {}
 seenSnap = JSON.stringify(seen);
}
function saveSeen() {
 try { localStorage.setItem(SEEN_KEY, JSON.stringify({seen, lastVisit})); } catch {}
 const snap = JSON.stringify(seen);
 if (snap !== seenSnap) { seenSnap = snap; syncSoon(); }   // la sola data dell'ultima visita non va sincronizzata
}
/* Una pubblicazione è nuova se non l'hai ancora vista ed è più recente dell'ultima che hai visto:
   così lo storico più vecchio, scaricato dopo, non viene scambiato per novità. */
function maxSeenDate(key) {
 let m = 0; const s = seen[key] || [];
 for (const it of cache[key] || []) if (s.includes(String(it.gid)) && it.date > m) m = it.date;
 return m;
}
function newItems(key) {
 if (!seen[key]) return [];
 const m = maxSeenDate(key);
 return (cache[key] || []).filter(it => !seen[key].includes(String(it.gid)) && it.date > m);
}
function isNew(key, item) { return newItems(key).includes(item); }
function totalNew() { return visibleKeys().reduce((n, k) => n + newItems(k).length, 0); }
function baselineSeen() {
 const fresh = Object.keys(seen).length === 0;
 let changed = false;
 for (const k of ORDER) {
  if (!seen[k] && cache[k]) { seen[k] = cache[k].map(i => String(i.gid)); changed = true; }
 }
 if (changed && fresh) firstRun = true;
 if (changed) saveSeen();
}
function markRead(key) {
 if (!cache[key] || !seen[key]) return;
 seen[key] = [...new Set([...cache[key].map(i => String(i.gid)), ...seen[key]])].slice(0, 80);
 saveSeen();
}
function markItemRead(key, item) {
 if (!item || !seen[key]) return false;
 const gid = String(item.gid);
 if (seen[key].includes(gid)) return false;
 seen[key] = [gid, ...seen[key]].slice(0, 80);
 saveSeen();
 return true;
}
function markAllRead() { visibleKeys().forEach(markRead); render(); updateTitle(); }
function flush() {
 lastVisit = Date.now(); saveSeen();
}
function updateTitle() {
 const n = totalNew(); document.title = (n ? "(" + n + ") " : "") + "Game Patch Radar";
 try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch {}
}
let toastTimer;
function toast(msg, action) {
 const t = $("toast"); t.textContent = msg;
 if (action) {
  const b = document.createElement("button"); b.type = "button"; b.className = "toast-act"; b.textContent = action.label;
  b.addEventListener("click", () => { t.classList.remove("show"); clearTimeout(toastTimer); action.run(); });
  t.append(b);
 }
 t.classList.add("show");
 clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), action ? 10000 : 7000);
}
function plural(n) { return n + (n === 1 ? " nuovo aggiornamento" : " nuovi aggiornamenti"); }
function renderNav() {
 const list = $("gameList"); list.innerHTML = "";
 const hb = document.createElement("button"); hb.type = "button";
 const tn = totalNew();
 hb.className = "game home" + (home ? " active" : "") + (tn ? " has-new" : "");
 hb.append(document.createTextNode("🏠 Home"));
 if (tn) { const t = document.createElement("span"); t.className = "newtxt"; t.textContent = String(tn); hb.append(t); }
 hb.addEventListener("click", goHome);
 list.append(hb);
 // con molti giochi la barra mostra solo Home, «Giochi», il gioco aperto e quello con più novità; gli altri stanno nel pannello (js/games-panel.js)
 const rows = sortGameRows(gameRows(), "new"), keys = barGameKeys(rows, selected, home);
 if (rows.length > BAR_ALL_MAX) {
  const gb = document.createElement("button"); gb.type = "button"; gb.className = "game gamesbtn";
  gb.append(document.createTextNode("☰ Giochi"));
  const c = document.createElement("span"); c.className = "gcount"; c.textContent = String(rows.length); gb.append(c);
  const hiddenNew = rows.filter(r => !keys.includes(r.key)).reduce((s, r) => s + r.news, 0);
  if (hiddenNew) { const t = document.createElement("span"); t.className = "newtxt"; t.textContent = "+" + hiddenNew; t.title = plural(hiddenNew) + " negli altri giochi"; gb.append(t); }
  gb.addEventListener("click", openGamesPanel);
  list.append(gb);
 }
 for (const k of keys) {
  const n = newItems(k).length;
  const b = document.createElement("button"); b.type = "button";
  b.className = "game" + (k === selected && !home ? " active" : "") + (n ? " has-new" : "");
  b.append(coverImg(GAMES[k].appid, "cover", GAMES[k].image, GAMES[k].name), document.createTextNode(GAMES[k].name + (GAMES[k].watch ? " 👁" : "")));
  if (n) { const t = document.createElement("span"); t.className = "newtxt"; t.textContent = n + (n === 1 ? " nuovo" : " nuovi"); b.append(t); }
  b.addEventListener("click", () => selectGame(k));
  list.append(b);
 }
 const act = list.querySelector(".active");
 if (act) list.scrollLeft = act.offsetLeft - (list.clientWidth - act.offsetWidth) / 2;
}
function renderBanner() {
 const el = $("banner");
 const parts = visibleKeys().map(k => [k, newItems(k).length]).filter(x => x[1]);
 if (!parts.length) { el.hidden = true; return; }
 const total = parts.reduce((n, x) => n + x[1], 0);
 el.hidden = false; el.innerHTML = "";
 const t = document.createElement("div"); t.className = "b-text";
 t.textContent = "🔔 " + plural(total) + (prevVisit ? " dall'ultima visita" : "");
 if (prevVisit) {
  const sm = document.createElement("small");
  sm.textContent = "Ultima visita: " + new Intl.DateTimeFormat("it-IT", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}).format(new Date(prevVisit));
  t.append(sm);
 }
 const all = document.createElement("button"); all.type = "button"; all.className = "abtn"; all.textContent = "✓ Segna tutto come letto";
 all.addEventListener("click", markAllRead);
 const recap = mkBtn("📋 Riepilogo", openRecap);
 const chips = document.createElement("div"); chips.className = "chips";
 for (const [k, n] of parts) {
  const c = document.createElement("button"); c.type = "button"; c.className = "chip"; c.textContent = GAMES[k].name + " · " + n;
  c.addEventListener("click", () => selectGame(k)); chips.append(c);
 }
 el.append(t, recap, all, chips);
}
function goHome() {
 home = true; query = ""; savedView = false; searchOpen = false; $("q").value = ""; showLimit = PAGE;
 render(); window.scrollTo(0, 0);
}
function selectGame(k) {
 home = false;
 query = ""; savedView = false; searchOpen = false; $("q").value = ""; showLimit = PAGE;
 selected = k; render(); window.scrollTo(0, 0);
 if (cache[selected]) setStatus("Dati caricati · premi Aggiorna per verificare eventuali novità", "ok");
 else refreshAll();
}

