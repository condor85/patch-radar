function renderMeta() {
 const el = $("meta"); el.innerHTML = "";
 if (home || crossGame() || !GAMES[selected]) return;
 const g = GAMES[selected], p = g.price;
 if (g.watch) {
  const hit = g.target && p && typeof p.cents === "number" && p.cents <= Math.round(g.target * 100);
  el.append(h("span", {class: "mchip", title: "Da tenere d'occhio: avvisi solo per le patch importanti" + (g.target ? " e quando il prezzo scende sotto " + euro(g.target) : "")},
   "👁 Osservato" + (g.target ? " · 🎯 " + euro(g.target) + (hit ? " ✓ raggiunto" : "") : "")));
 }
 if (p && p.final) {
  const sale = p.discount > 0;
  el.append(h("a", {class: "mchip" + (sale ? " sale" : ""), href: g.store, target: "_blank", rel: "noopener noreferrer", title: "Apri la pagina Steam"},
   sale ? "🏷 −" + p.discount + "% · " + p.final + (p.initial ? " (era " + p.initial + ")" : "") : "💶 " + p.final));
 }
 if (g.pmin && p && typeof p.cents === "number" && g.pmin.cents > 0) {
  const atMin = p.cents <= g.pmin.cents;
  el.append(h("span", {class: "mchip" + (atMin ? " sale" : ""), title: "Prezzo più basso visto dall'app da quando segue questo gioco (non è il minimo assoluto di Steam)"},
   atMin ? "📉 Al minimo registrato" : "📉 Minimo registrato " + g.pmin.final));
 }
 const cad = patchCadence(cache[selected], Date.now() / 1000);
 if (cad) {
  const every = cad.everyDays >= 14 ? "~" + Math.round(cad.everyDays / 7) + " settimane" : "~" + cad.everyDays + (cad.everyDays === 1 ? " giorno" : " giorni");
  const txt = cad.overdueDays > 0 ? "attesa da " + (cad.overdueDays === 1 ? "1 giorno" : cad.overdueDays + " giorni") : "prossima verso il " + new Date(cad.next * 1000).toLocaleDateString("it-IT", {day: "numeric", month: "short"});
  el.append(h("span", {class: "mchip", title: "Stima dal ritmo delle ultime patch: è solo indicativa"}, "🔮 Patch ogni " + every + " · " + txt));
 }
 teamChips(el, g);
 const pl = g.players;
 if (pl && Number.isFinite(pl.n)) {
  const when = pl.ts ? new Date(pl.ts * 1000).toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit"}) : "";
  el.append(h("span", {class: "mchip", title: "Giocatori connessi su Steam" + (when ? " alle " + when : "")}, "👥 " + pl.n.toLocaleString("it-IT") + " online"));
 }
}

/* Avviso se il controllo automatico su GitHub non parte da troppo tempo */
let lastCheck = 0;
const STALE_MS = 4 * 3600 * 1000;
async function loadCheck() {
 const repo = repoName(); if (!repo || location.protocol === "file:") return;
 const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 6000);
 try {
  const r = await fetch("https://api.github.com/repos/" + repo + "/actions/workflows/update.yml/runs?status=success&per_page=1", {signal: ctrl.signal, headers: {Accept: "application/vnd.github+json"}});
  if (!r.ok) return;
  const run = ((await r.json()).workflow_runs || [])[0];
  if (run) lastCheck = Date.parse(run.updated_at) || 0;
 } catch {} finally { clearTimeout(timer); }
}
function renderStale() {
 const el = $("stale"), late = lastCheck && Date.now() - lastCheck > STALE_MS, old = staleHours(dataFresh);
 el.hidden = !late && !old;
 if (late) el.textContent = "⏱ Il controllo automatico delle novità non parte da " + Math.floor((Date.now() - lastCheck) / 3600000) + " ore: potresti non vedere gli ultimi aggiornamenti. È un ritardo di GitHub e di solito si risolve da solo.";
 else if (old) el.textContent = "⚠️ I dati non si aggiornano da circa " + old + " ore: Steam o il servizio che prepara i riassunti potrebbero avere un problema, quindi le ultime patch potrebbero mancare. Di solito si risolve da solo.";
}

function render() {
 const cross = crossGame(), onHome = isHome(), game = GAMES[selected];
 const all = onHome ? [] : baseEntries();
 renderNav(); renderBanner(); renderStale(); renderMeta(); renderFilters(); renderBell(); updateTitle();
 $("gameTitle").textContent = savedView ? "★ Salvati" : query.trim() ? "Ricerca" : onHome ? "Ultime patch" : game.name;
 const box = $("cards"); box.innerHTML = ""; box.classList.toggle("home", onHome);
 if (onHome) { renderHome(box); return; }
 if (!cross && !cache[selected]) { $("count").textContent = "In attesa dei dati"; return; }
 const list = visibleEntries(), n = list.length;
 $("count").textContent = (n !== all.length && !query.trim() ? n + " di " + all.length : n) + (n === 1 ? " pubblicazione" : " pubblicazioni") + (query.trim() ? " con «" + query.trim() + "»" : "");
 if (!n) { box.append(h("div", {class: "empty"}, emptyMessage(all.length))); return; }
 list.slice(0, showLimit).forEach((entry, i) => box.append(buildCard(entry, list, i)));
 if (n > showLimit) box.append(mkBtn("Mostra altre " + Math.min(PAGE, n - showLimit) + " (" + (n - showLimit) + " restanti)", () => { showLimit += PAGE; render(); }, "moreBtn"));
}
(() => {
 let timer;
 $("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { query = $("q").value; showLimit = PAGE; render(); }, 180); });
 $("qClear").addEventListener("click", () => { query = ""; searchOpen = false; $("q").value = ""; showLimit = PAGE; render(); });
})();

/* ---------- Aggiornamento ---------- */
async function loadGame(key) {
 try {
  const g = snapshot && snapshot.games.find(x => String(x.appid) === key);
  if (!g || !g.items || !g.items.length) throw new Error(snapshot ? "il controllo automatico non ha ancora letto questo gioco: basta attendere il prossimo aggiornamento" : "i dati non sono raggiungibili");
  cache[key] = prepare(g.items);
  return null;
 }
 catch (e) { return e; }
}
async function refreshAll(manual = false) {
 const btn = $("refreshBtn");
 if (btn.disabled) return;
 btn.disabled = true; btn.textContent = "…";
 // try/finally: se qualcosa va storto il pulsante non deve restare bloccato (bloccherebbe anche l'aggiornamento automatico)
 try { await doRefresh(manual); }
 catch (e) { setStatus("Aggiornamento non riuscito: " + ((e && e.message) || e) + ". Premi «Aggiorna» per riprovare.", "error"); }
 finally { btn.disabled = false; btn.textContent = "↻"; }
}
async function doRefresh(manual) {
 if (manual || !cache[selected]) setStatus("Recupero le ultime pubblicazioni…");
 snapshot = await loadSnapshot();
 if (snapshot && snapshot.games.length) { setGames(applyPending(snapshot.games)); save(); }
 ensureSelected();
 syncNotifIfChanged().catch(() => {});
 checkBridgeQuiet();
 teamRefresh();   // tiene aggiornati saldi di gruppo, voti e sessioni (non fa nulla se non sei in squadra)
 const [errors] = await Promise.all([Promise.all(visibleKeys().map(loadGame)), loadCheck()]);
 baselineSeen();
 const onHome = isHome();   // nella schermata principale conta solo se nessun gioco si è caricato
 const failedSelected = onHome ? (errors.length && errors.every(Boolean) ? errors[0] : null) : errors[visibleKeys().indexOf(selected)];
 const haveData = onHome ? visibleKeys().some(k => cache[k]) : !!cache[selected];
 if (!failedSelected) {
  lastRefresh = Date.now(); save();
  setStatus("Ultimo controllo: " + new Date().toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit"}) + " · fonte: Steam via GitHub" + (lastCheck ? " · controllo automatico alle " + new Date(lastCheck).toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit"}) : ""), "ok");
 } else if (haveData) {
  setStatus("Aggiornamento non riuscito: mostro gli ultimi dati salvati. Premi «Aggiorna» per riprovare. (" + failedSelected.message + ")", "error");
 } else if (onHome) {
  setStatus("Dati non disponibili. Premi «Aggiorna» per riprovare. (" + failedSelected.message + ")", "error");
 } else {
  const g = GAMES[selected];
  setStatus("Dati non disponibili. Premi «Aggiorna» per riprovare. (" + failedSelected.message + ")", "error");
  // Il nome del gioco arriva da dati esterni (Steam, games.json): mai dentro una stringa HTML
  $("cards").replaceChildren(h("div", {class: "empty"}, "Connessione non riuscita.", h("br"), h("br"),
   h("a", {style: "color:var(--accent)", href: g.store, target: "_blank", rel: "noopener noreferrer"}, "Apri la pagina Steam di " + g.name + " ↗")));
 }
 if (!autoPicked) {
  autoPicked = true;
  if (home && !newItems(selected).length) { const k = visibleKeys().find(x => newItems(x).length); if (k) selected = k; }
 }
 const tot = totalNew();
 if (lastTotal !== null && tot > lastTotal) toast("🔔 " + plural(tot - lastTotal) + "!");
 lastTotal = tot;
 if (firstRun && !failedSelected) { setStatus("Prima apertura: da ora ti segnalo i nuovi aggiornamenti dei tuoi giochi.", "ok"); firstRun = false; }
 if (cache[selected] || isHome()) refreshViews();
}

$("refreshBtn").addEventListener("click", () => refreshAll(true));
document.addEventListener("visibilitychange", () => {
 if (document.hidden) flush();
 else { shownAt = Date.now(); if (Date.now() - lastRefresh > REFRESH_MS) refreshAll(); if (sync.code && Date.now() - sync.last > 60000) syncNow(); }
});
window.addEventListener("pagehide", flush);
setInterval(() => { if (!document.hidden) refreshAll(); }, REFRESH_MS);


