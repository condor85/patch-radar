/* ---------- Pannelli a tutto schermo ---------- */
function openOv(id) { $(id).classList.add("open"); document.body.style.overflow = "hidden"; }
function closeOv(id) { $(id).classList.remove("open"); if (!document.querySelector(".viewer.open")) document.body.style.overflow = ""; }
function anyOverlay() { return !!document.querySelector(".viewer.open"); }
const safeUrl = (u, fallback) => /^https?:\/\//i.test(u || "") ? u : fallback;

/* ---------- Salvate per dopo ---------- */
const SAVED_KEY = "game_patch_radar_saved_v1";
const REMOVED_KEY = "game_patch_radar_savedremoved_v1";
let saved = [];   // {id, appid, gid, title, date, url, summary, ts}  (ts = quando l'hai salvata)
let savedRemoved = {};   // id -> quando l'hai tolta dai salvati: serve a toglierla anche sugli altri dispositivi
function loadSaved() { try { saved = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]") || []; } catch { saved = []; } }
function persistSaved(quiet) {
 try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); localStorage.setItem(REMOVED_KEY, JSON.stringify(savedRemoved)); } catch {}
 if (!quiet) syncSoon();
}
const savedId = (key, item) => key + ":" + item.gid;
function isSaved(key, item) { const id = savedId(key, item); return saved.some(x => x.id === id); }
function toggleSaved(key, item) {
 const id = savedId(key, item), i = saved.findIndex(x => x.id === id), now = Date.now();
 if (i >= 0) {
  saved.splice(i, 1);
  savedRemoved[id] = now;
  const keep = Object.entries(savedRemoved).sort((a, b) => b[1] - a[1]).slice(0, 300);   // le cancellazioni più vecchie non servono più
  savedRemoved = Object.fromEntries(keep);
 } else {
  saved.unshift({id, appid: key, gid: String(item.gid), title: item.title || "", date: item.date || 0, url: item.url || "", summary: item.summary || "", ts: now});
  delete savedRemoved[id];
 }
 saved = saved.slice(0, 200);
 persistSaved();
 toast(i >= 0 ? "Rimossa dai salvati" : "★ Salvata: la ritrovi nel filtro «Salvati»");
 if (savedView && !saved.length) savedView = false;
 refreshViews();
}

/* ---------- Schermo intero, con scorrimento tra le pubblicazioni ---------- */
let viewerList = [], viewerIdx = -1, viewerItem = null;
function markViewerRead() {
 const e = viewerList[viewerIdx];
 if (e && markItemRead(e.key, e.item)) viewerMarked = true;
}
let viewerMarked = false;
function openViewer(list, i) {
 viewerList = list; viewerIdx = i; markViewerRead(); renderViewer();
 openOv("viewer"); $("vBody").scrollTop = 0; $("vClose").focus();
}
function closeViewer() {
 viewerItem = null; viewerList = []; viewerIdx = -1; closeOv("viewer");
 if (viewerMarked) { viewerMarked = false; render(); }   // le schede aperte perdono l'etichetta «NUOVO»
}
function viewerGo(d) {
 const j = viewerIdx + d;
 if (j < 0 || j >= viewerList.length) return;
 viewerIdx = j; markViewerRead(); renderViewer(); $("vBody").scrollTop = 0;
}
function warnEl() {
 const w = document.createElement("div"); w.className = "warn";
 w.textContent = "⚠ Il testo ricevuto da Steam potrebbe essere incompleto: apri la pubblicazione su Steam per leggerla tutta.";
 return w;
}
/* Confronto con la patch precedente: le voci del testo che nella patch prima non c'erano */
const normLine = l => l.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function patchLines(it) { return fullText(it).split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => l.replace(/^[•·\s]+/, "")).filter(l => l.length >= 12); }
function previousPatch(key, item) {
 let best = null;
 for (const it of cache[key] || []) if (it !== item && isPatchItem(it) && (it.date || 0) < (item.date || 0) && (!best || it.date > best.date)) best = it;
 return best;
}
function changesSince(key, item) {
 if (!isPatchItem(item)) return null;
 const prev = previousPatch(key, item);
 if (!prev || (item.date || 0) - (prev.date || 0) > 21 * 86400) return null;
 const before = new Set(patchLines(prev).map(normLine)), cur = patchLines(item);
 if (cur.length < 3 || !cur.some(l => before.has(normLine(l)))) return null;   // niente voci in comune: non c'è nulla da confrontare
 return {prev, fresh: cur.filter(l => !before.has(normLine(l))), total: cur.length};
}
function changesBox(key, item) {
 const c = changesSince(key, item); if (!c) return null;
 const v = versionOf(c.prev.title), label = v ? "v" + v : dateLabel(c.prev.date);
 const box = h("div", {class: "sum diff"}, h("b", {}, "🆕 Novità rispetto a " + label));
 if (!c.fresh.length) { box.append(h("p", {class: "more-n"}, "Nessuna voce nuova: il contenuto è già nella patch precedente.")); return box; }
 const ul = h("ul", {});
 for (const l of c.fresh.slice(0, 8)) ul.append(h("li", {}, l.length > 220 ? l.slice(0, 217) + "…" : l));
 box.append(ul);
 if (c.fresh.length > 8) box.append(h("p", {class: "more-n"}, "e altre " + (c.fresh.length - 8) + " voci nel testo completo"));
 box.append(h("p", {class: "more-n"}, c.total - c.fresh.length + " voci su " + c.total + " erano già nella patch precedente."));
 return box;
}
function summaryBox(item) {
 const sm = h("div", {class: "sum"}, h("b", {}, "📝 In breve"), item.summary);
 return sm;
}
function renderViewer() {
 const entry = viewerList[viewerIdx]; if (!entry) return;
 const {key, item} = entry, game = GAMES[key] || GAMES[selected];
 viewerItem = item;
 const ik = itemKey(item), tr = showIt[ik] && trCache[ik];
 const inner = $("vInner"); inner.innerHTML = "";
 const pos = viewerList.length > 1 ? " · " + (viewerIdx + 1) + " di " + viewerList.length : "";
 const t = h("div", {class: "v-text"});
 renderRich(t, (tr ? tr.text : fullText(item)) || "Apri la pubblicazione per leggere tutti i dettagli.");
 inner.append(h("span", {class: "date"}, dateLabel(item.date) + " · " + game.name + pos), h("h2", {}, (tr ? tr.title : item.title) || "Aggiornamento"));
 const lb = labelsEl(item); if (lb) inner.append(lb);
 if (item.summary) inner.append(summaryBox(item));
 const diff = changesBox(key, item); if (diff) inner.append(diff);
 const notes = teamNotesEl(item); if (notes) inner.append(notes);
 inner.append(t);
 if (item.truncated) inner.append(warnEl());
 if (tr) inner.append(h("div", {class: "v-note"}, "Traduzione automatica (" + (tr.src === "gemini" ? "Gemini" : "Google Translate") + ") — può contenere imprecisioni."));
 inner.append(h("div", {class: "actions"},
  mkBtn(isSaved(key, item) ? "★ Salvata" : "☆ Salva", () => toggleSaved(key, item)),
  mkBtn("↗ Condividi", () => shareItem(item, game.name)),
  h("a", {class: "abtn", style: "text-decoration:none", href: "https://wa.me/?text=" + encodeURIComponent(groupMessage(item, game.name)), target: "_blank", rel: "noopener noreferrer", title: "Messaggio pronto per il gruppo"}, "💬 Al gruppo"),
  h("a", {class: "more", href: safeUrl(item.url, game.store), target: "_blank", rel: "noopener noreferrer"}, "Apri su Steam ↗")));
 $("vTr").disabled = false;
 $("vTr").textContent = tr ? "↩ Originale" : "🌐 Italiano";
 $("vPrev").disabled = viewerIdx <= 0; $("vNext").disabled = viewerIdx >= viewerList.length - 1;
}
$("vClose").addEventListener("click", closeViewer);
$("vTr").addEventListener("click", () => toggleTranslate(viewerItem, $("vTr")));
$("vPrev").addEventListener("click", () => viewerGo(-1));
$("vNext").addEventListener("click", () => viewerGo(1));
$("vSmaller").addEventListener("click", () => setFont(fontIdx - 1));
$("vBigger").addEventListener("click", () => setFont(fontIdx + 1));
(() => {  // scorri a sinistra/destra per passare da una pubblicazione all'altra
 const b = $("vBody"); let x0 = null, y0 = 0;
 b.addEventListener("touchstart", e => { if (e.touches.length !== 1) { x0 = null; return; } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, {passive: true});
 b.addEventListener("touchend", e => {
  if (x0 === null) return;
  const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) viewerGo(dx < 0 ? 1 : -1);
 });
})();
function closeTopOverlay() {
 for (const id of ["changelog", "viewer", "invite", "welcome", "recap", "team", "manager", "gamesPanel"]) {
  if (!$(id).classList.contains("open")) continue;
  if (id === "viewer") closeViewer(); else if (id === "welcome") finishWelcome(); else closeOv(id);
  return;
 }
}
document.addEventListener("keydown", e => {
 if (e.key === "Escape") { closeTopOverlay(); return; }
 if ($("viewer").classList.contains("open") && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
  if (e.key === "ArrowRight") viewerGo(1); else if (e.key === "ArrowLeft") viewerGo(-1);
 }
});
