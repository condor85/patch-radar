let pendingShare = null;
function shareFromQuery() {
 const g = sharedGame(location.search);
 if (!g) return;
 try { history.replaceState(null, "", location.pathname + location.hash); } catch {}
 pendingShare = g;
}
async function shareAddPending() {
 const g = pendingShare; pendingShare = null;
 if (!g) return;
 if (!g.appid) { toast("Dal link condiviso non riconosco nessun gioco Steam."); return; }
 if (!bridgePw || !bridgeUrl()) { toast("Per aggiungere giochi serve la modalità amministratore (⚙ → Gestisci)."); return; }
 if (!confirm("Aggiungere «" + (g.name || "App Steam n. " + g.appid) + "» all'app per tutti?")) return;
 try { await bridgeAdd({appid: g.appid}); } catch (e) { toast(e.message); }
}
let searchConsent = false;   // consenso a usare servizi esterni per la ricerca per nome (vale finché la pagina resta aperta)
async function searchGames(term) {
 const d = await fetchJSON("https://store.steampowered.com/api/storesearch/?term=" + encodeURIComponent(term) + "&l=italian&cc=IT", x => Array.isArray(x && x.items));
 return d.items.slice(0, 8).map(i => ({appid: i.id, name: i.name}));
}
function msgEl(box, text, ok) { let m = box.querySelector(".msg"); if (!m) { m = h("p", {class: "msg"}); box.prepend(m); } m.className = "msg " + (ok ? "okmsg" : "errmsg"); m.textContent = text; }
function afterGamesChange() { ensureSelected(); render(); renderAdmin(); refreshAll(); }

async function adminAdd(g, undoable = true) {
 // I risultati di ricerca passano da proxy di terzi: appid e nome si controllano prima di scriverli nel repository
 const appid = Number(g.appid);
 if (!Number.isInteger(appid) || appid <= 0) throw new Error("Numero app Steam non valido.");
 const name = String(g.name || "").replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
 await editFile("games.json", o => { o.games = o.games || []; if (!o.games.some(x => Number(x.appid) === appid)) o.games.push(name ? {appid, name} : {appid}); return o; }, "Aggiungi " + (name || appid));
 pending.remove = (pending.remove || []).filter(x => String(x.id) !== String(appid));
 pending.add.push({appid, name, ts: Date.now()}); savePending();
 setGames(applyPending(currentList()));
 toast("✓ Gioco aggiunto. Per tutti gli altri compare in circa un minuto.", undoable ? {label: "Annulla", run: () => adminRemove({appid, name: name || String(appid)}, false).catch(e => toast(e.message))} : null);
 afterGamesChange();
}
async function adminRemove(g, undoable = true) {
 await editFile("games.json", o => { o.games = (o.games || []).filter(x => Number(x.appid) !== Number(g.appid)); return o; }, "Rimuovi " + g.name);
 pending.add = (pending.add || []).filter(x => String(x.appid) !== String(g.appid));
 pending.remove.push({id: Number(g.appid), ts: Date.now()}); savePending();
 setGames(applyPending(currentList()));
 toast("✓ Gioco eliminato dall'app.", undoable ? {label: "Annulla", run: () => adminAdd({appid: g.appid, name: g.name}, false).catch(e => toast(e.message))} : null);
 afterGamesChange();
}
async function adminTopic() {
 const arr = new Uint8Array(6); crypto.getRandomValues(arr);
 const topic = "patch-radar-" + [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
 await editFile("config.json", o => { o.ntfyTopic = topic; return o; }, "Nuovo argomento notifiche");
 CFG.ntfyTopic = topic; setTopicLink();
 return topic;
}
/* ---------- Amministratore tramite ponte (consigliato): sul telefono resta solo una password, il token GitHub sta sul ponte ---------- */
const BRIDGE_KEY = "game_patch_radar_bridge_v1";
let bridgePw = "";
function bridgeUrl() { return typeof CFG.adminApi === "string" && /^https:\/\/[a-z0-9.-]+$/.test(CFG.adminApi) ? CFG.adminApi : ""; }
function loadBridge() { try { bridgePw = localStorage.getItem(BRIDGE_KEY) || ""; } catch {} }
function bridgeLogout() { bridgePw = ""; try { localStorage.removeItem(BRIDGE_KEY); } catch {} }
async function bridge(path, body) {
 let r;
 try { r = await fetch(bridgeUrl() + path, {method: "POST", headers: {"Content-Type": "application/json", Authorization: "Bearer " + bridgePw}, body: JSON.stringify(body || {}), cache: "no-store", signal: AbortSignal.timeout(20000)}); }
 catch { throw new Error("Il ponte non risponde. Controlla la connessione e riprova."); }
 let d = {}; try { d = await r.json(); } catch {}
 if (r.status === 401) bridgeLogout();
 if (!r.ok) throw new Error(d.error || "Errore " + r.status);
 return d;
}
/* Operazioni di amministrazione tramite ponte, usate anche dall'«Annulla» */
function localAdd(game) {
 pending.remove = (pending.remove || []).filter(x => String(x.id) !== String(game.appid));
 pending.add.push({appid: game.appid, name: game.name, watch: game.watch === true, target: game.target ?? null, ts: Date.now()}); savePending();
 setGames(applyPending(currentList()));
}
function localRemove(appid) {
 pending.add = (pending.add || []).filter(x => String(x.appid) !== String(appid));
 pending.remove.push({id: Number(appid), ts: Date.now()}); savePending();
 setGames(applyPending(currentList()));
}
async function bridgeAdd(game, opts = {}) {
 const body = {appid: game.appid};
 if (game.watch) { body.watch = true; if (game.target != null) body.target = game.target; }
 const d = await bridge("/add", body);
 if (d.added) localAdd({...d.game, watch: game.watch === true, target: game.watch ? (game.target ?? null) : null});
 const undo = d.added && opts.undoable !== false ? {label: "Annulla", run: () => bridgeRemove(d.game, {undoable: false}).catch(e => toast(e.message))} : null;
 toast(d.added ? "✓ " + d.game.name + " aggiunto. Per tutti compare in circa un minuto." : "Il gioco c'era già.", undo);
 afterGamesChange();
 return d;
}
async function bridgeRemove(game, opts = {}) {
 const keep = {appid: game.appid, name: game.name, watch: game.watch === true, target: game.target ?? null};
 await bridge("/remove", {appid: game.appid});
 localRemove(game.appid);
 const undo = opts.undoable !== false ? {label: "Annulla", run: () => bridgeAdd(keep, {undoable: false}).catch(e => toast(e.message))} : null;
 toast("✓ Gioco eliminato dall'app.", undo);
 afterGamesChange();
}
async function bridgeWatch(game, watch, target) {
 await bridge("/watch", {appid: game.appid, watch, target});
 pending.watch = (pending.watch || []).filter(w => String(w.id) !== String(game.appid));
 pending.watch.push({id: Number(game.appid), watch, target: watch ? target : null, ts: Date.now()}); savePending();
 setGames(applyPending(currentList()));
 toast(watch ? "👁 " + game.name + ": solo patch importanti" + (target ? " e avviso sotto " + euro(target) : "") : "✓ " + game.name + ": di nuovo tutte le patch");
 afterGamesChange();
 if (notifPref.on) syncNotif().catch(() => {});
}
function euro(n) { return Number(n).toLocaleString("it-IT", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " €"; }
function parseEuro(text) {
 const t = String(text == null ? "" : text).trim().replace(",", ".");
 if (!t) return null;
 const n = Number(t);
 return Number.isFinite(n) && n > 0 && n <= 10000 ? Math.round(n * 100) / 100 : NaN;
}
/* Stato del ponte: raggiungibile, token GitHub valido, giorni alla scadenza */
function describeBridge(d) {
 if (!d.ok) return ["err", "🔴 " + (d.error || "Il ponte non funziona.")];
 if (typeof d.daysLeft === "number" && d.daysLeft < 0) return ["err", "🔴 Il token GitHub del ponte è scaduto: creane uno nuovo e aggiornalo su Cloudflare."];
 if (typeof d.daysLeft === "number" && d.daysLeft <= 14) return ["warn", "🟡 Ponte attivo, ma il token GitHub scade tra " + (d.daysLeft === 0 ? "meno di un giorno" : d.daysLeft + (d.daysLeft === 1 ? " giorno" : " giorni")) + ": creane uno nuovo e aggiornalo su Cloudflare."];
 return ["ok", "🟢 Ponte attivo" + (typeof d.daysLeft === "number" ? " · il token GitHub scade tra " + d.daysLeft + " giorni" : " · il token GitHub funziona") + "."];
}
const BRIDGE_CHECK_KEY = "game_patch_radar_bridgecheck_v1";
/* Una volta al giorno, se hai già fatto l'accesso, controlla in silenzio il ponte e avvisa solo se serve */
async function checkBridgeQuiet() {
 if (!bridgePw || !bridgeUrl()) return;
 try {
  const last = Number(localStorage.getItem(BRIDGE_CHECK_KEY)) || 0;
  if (Date.now() - last < 86400000) return;
  localStorage.setItem(BRIDGE_CHECK_KEY, String(Date.now()));
 } catch {}
 try {
  const d = await bridge("/status");
  const [lvl, text] = describeBridge(d);
  if (lvl !== "ok") toast(text.replace(/^\S+\s/, "⚠ Ponte: "));
 } catch {}
}
async function renderBridgeAdmin() {
 const box = $("adminBox"); box.innerHTML = "";
 if (!bridgePw) {
  const inp = h("input", {type: "password", placeholder: "Password amministratore", autocomplete: "current-password"});
  const go = h("button", {class: "abtn pri", type: "button", onclick: async () => {
   const v = inp.value; if (!v) return;
   bridgePw = v; go.disabled = true;
   try { await bridge("/login"); try { localStorage.setItem(BRIDGE_KEY, v); } catch {} renderAdmin(); }
   catch (e) { bridgePw = ""; go.disabled = false; msgEl(box, e.message, false); }
  }}, "Accedi");
  inp.addEventListener("keydown", e => { if (e.key === "Enter") go.click(); });
  box.append(h("p", {}, "Inserisci la password dell'amministratore per aggiungere o togliere giochi. Resta salvata solo su questo dispositivo."), inp, h("div", {class: "row"}, go));
  return;
 }
 const stat = h("p", {class: "bstat"}, "Controllo il ponte…");
 box.append(stat);
 bridge("/status").then(d => { const [lvl, text] = describeBridge(d); stat.className = "bstat " + (lvl === "ok" ? "okmsg" : lvl === "warn" ? "" : "errmsg"); if (lvl === "warn") stat.style.color = "var(--warn)"; stat.textContent = text; })
  .catch(e => { stat.className = "bstat errmsg"; stat.textContent = "🔴 " + e.message; });
 box.append(h("h4", {}, "Aggiungi un gioco"));
 const q = h("input", {type: "search", placeholder: "Nome del gioco o link Steam", autocomplete: "off", enterkeyhint: "search"});
 const res = h("div", {});
 const watchChk = h("input", {type: "checkbox"});
 const targetInp = h("input", {type: "text", inputmode: "decimal", placeholder: "Avvisami sotto (€), facoltativo", autocomplete: "off", disabled: "disabled"});
 watchChk.addEventListener("change", () => { targetInp.disabled = !watchChk.checked; });
 const watchRow = h("label", {class: "tgl", style: "margin:8px 0;display:flex"}, watchChk, "👁 Solo da tenere d'occhio: avvisi solo per patch importanti e prezzo");
 const add = async (g, btn) => {
  const target = watchChk.checked ? parseEuro(targetInp.value) : null;
  if (Number.isNaN(target)) { msgEl(box, "Prezzo non valido: scrivi un importo in euro, per esempio 19,99.", false); return; }
  btn.disabled = true;
  try { await bridgeAdd({appid: g.appid, watch: watchChk.checked, target}); }
  catch (e) { btn.disabled = false; msgEl(box, e.message, false); }
 };
 const row = (g, has) => h("div", {class: "row"}, h("span", {class: "nm"}, g.name), has ? h("span", {}, "già presente") : h("button", {class: "abtn", type: "button", onclick: e => add(g, e.target)}, "+ Aggiungi"));
 const doSearch = async () => {
  const term = q.value.trim(); if (!term) return;
  const id = parseAppId(term);
  res.innerHTML = "";
  if (id) { res.append(row({appid: id, name: "App Steam n. " + id}, currentList().some(x => Number(x.appid) === id))); return; }
  res.append(h("p", {}, "Cerco…"));
  try {
   const d = await bridge("/search", {q: term}); res.innerHTML = "";
   if (!d.results.length) res.append(h("p", {}, "Nessun risultato. Prova un altro nome o incolla il link della pagina Steam."));
   for (const g of d.results) res.append(row(g, currentList().some(x => Number(x.appid) === Number(g.appid))));
  } catch (e) { res.innerHTML = ""; msgEl(box, e.message, false); }
 };
 q.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
 box.append(q, h("div", {class: "row"}, h("button", {class: "abtn pri", type: "button", onclick: doSearch}, "🔍 Cerca")), watchRow, targetInp, res);
 box.append(h("h4", {}, "Giochi dell'app (per tutti)"));
 for (const g of currentList()) {
  const eye = h("button", {class: "abtn", type: "button", title: g.watch ? "Torna a seguire tutte le patch" : "Tieni d'occhio: solo patch importanti e avviso di prezzo", onclick: async e => {
   let target = null;
   if (!g.watch || e.shiftKey) {
    const ans = prompt("Avvisami quando il prezzo di «" + g.name + "» scende sotto (in euro). Lascia vuoto per non avere avvisi di prezzo.", g.target ? String(g.target).replace(".", ",") : "");
    if (ans === null) return;
    target = parseEuro(ans);
    if (Number.isNaN(target)) { msgEl(box, "Prezzo non valido: scrivi un importo in euro, per esempio 19,99.", false); return; }
   }
   e.target.disabled = true;
   try { await bridgeWatch(g, g.watch ? false : true, target); } catch (err) { e.target.disabled = false; msgEl(box, err.message, false); }
  }}, g.watch ? "👁 Smetti" : "👁 Osserva");
  box.append(h("div", {class: "row"}, h("span", {class: "nm"}, g.name + (g.watch ? " 👁" + (g.target ? " (sotto " + euro(g.target) + ")" : "") : "")), eye, h("button", {class: "abtn danger", type: "button", onclick: async e => {
   if (!confirm("Eliminare «" + g.name + "» dall'app per tutti?")) return;
   e.target.disabled = true;
   try { await bridgeRemove(g); } catch (err) { e.target.disabled = false; msgEl(box, err.message, false); }
  }}, "🗑 Elimina")));
 }
 box.append(h("h4", {}, "Squadra"));
 box.append(h("p", {}, "Crea il codice da dare agli amici: con quello entrano nella squadra (giochi a cui giocano o che li interessano). Se ne crei uno nuovo, il vecchio smette di funzionare e gli amici devono rientrare con il nuovo; i voti restano."));
 const codeOut = h("div", {});
 box.append(h("div", {class: "row"}, h("button", {class: "abtn", type: "button", onclick: async e => {
  if (!confirm("Creare un nuovo codice della squadra? Quello vecchio smette di funzionare.")) return;
  e.target.disabled = true;
  try {
   const d = await bridge("/team/setup");
   codeOut.innerHTML = "";
   codeOut.append(h("div", {class: "tm-code"}, d.code), h("p", {}, "Mandalo agli amici: si entra da «👥 Squadra» in fondo alla pagina."),
    h("div", {class: "row-btns"}, mkBtn("📋 Copia codice", async () => { try { await navigator.clipboard.writeText(d.code); toast("📋 Codice copiato"); } catch { toast("Copia non riuscita"); } })));
  } catch (err) { msgEl(box, err.message, false); }
  e.target.disabled = false;
 }}, "👥 Crea o cambia il codice")), codeOut);
 box.append(h("h4", {}, "Notifiche"));
 box.append(h("p", {}, "Se qualcuno manda messaggi falsi sull'argomento delle notifiche, creane uno nuovo: gli altri passano al nuovo da soli."));
 box.append(h("div", {class: "row"}, h("button", {class: "abtn", type: "button", onclick: async e => {
  if (!confirm("Creare un nuovo argomento? Gli altri passano al nuovo da soli alla prossima apertura dell'app.")) return;
  e.target.disabled = true;
  try { const d = await bridge("/topic"); CFG.ntfyTopic = d.topic; setTopicLink(); msgEl(box, "Nuovo argomento creato. Le notifiche si aggiornano da sole.", true); } catch (err) { msgEl(box, err.message, false); }
  e.target.disabled = false;
 }}, "🔄 Cambia argomento")));
 box.append(h("div", {class: "row"}, h("button", {class: "abtn", type: "button", onclick: () => { bridgeLogout(); renderAdmin(); }}, "Esci dalla modalità amministratore")));
}
async function renderAdmin() {
 if (bridgeUrl()) return renderBridgeAdmin();
 const box = $("adminBox"); box.innerHTML = "";
 if (!adminToken) {
  const inp = h("input", {type: "password", placeholder: "Incolla qui il token GitHub", autocomplete: "off"});
  const go = h("button", {class: "abtn", type: "button", onclick: async () => {
   adminToken = inp.value.trim(); if (!adminToken) return;
   go.disabled = true;
   try {
    const r = await gh("/repos/" + repoName());
    if (!r.permissions || !r.permissions.push) throw new Error("Questo token non può modificare il repository.");
    try { localStorage.setItem(ADMIN_KEY, adminToken); } catch {}
    renderAdmin();
   } catch (e) { adminToken = ""; go.disabled = false; msgEl(box, e.message, false); }
  }}, "Accedi");
  box.append(
   h("p", {}, "Per aggiungere o togliere giochi serve un token personale GitHub. Solo chi lo ha può modificare l'elenco. Lo crei una volta sola:"),
   h("ol", {}, h("li", {}, "Apri ", h("a", {href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener noreferrer", style: "color:var(--accent)"}, "github.com/settings/personal-access-tokens/new")),
    h("li", {}, "Nome a piacere, scadenza di 90 giorni (il token resta salvato nel browser: meglio che non duri per sempre; alla scadenza ne crei uno nuovo)."),
    h("li", {}, "Repository access → Only select repositories → scegli «" + (repoName().split("/")[1] || "patch-radar") + "»."),
    h("li", {}, "Permissions → Repository permissions → Contents: «Read and write»."),
    h("li", {}, "Generate token, copialo e incollalo qui sotto.")),
   inp, h("div", {class: "row"}, go),
   h("p", {}, "Il token resta salvato solo su questo dispositivo."));
  return;
 }
 box.append(h("p", {}, "Connesso al repository " + repoName() + "."));
 box.append(h("h4", {}, "Giochi dell'app (per tutti)"));
 for (const g of currentList()) {
  box.append(h("div", {class: "row"}, h("span", {class: "nm"}, g.name),
   h("button", {class: "abtn danger", type: "button", onclick: async e => {
    if (!confirm("Eliminare «" + g.name + "» dall'app per tutti?")) return;
    e.target.disabled = true;
    try { await adminRemove(g); } catch (err) { e.target.disabled = false; msgEl(box, err.message, false); }
   }}, "🗑 Elimina")));
 }
 box.append(h("h4", {}, "Aggiungi un gioco"));
 const q = h("input", {type: "search", placeholder: "Link Steam del gioco, o il suo nome", autocomplete: "off"});
 const res = h("div", {});
 const addBtn = async g => {
  try { await adminAdd(g); } catch (err) { msgEl(box, err.message, false); }   // senza nome lo ricava il controllo automatico dalla pagina Steam
 };
 const doSearch = async () => {
  const term = q.value.trim(); if (!term) return;
  res.innerHTML = ""; res.append(h("p", {}, "Cerco…"));
  const id = parseAppId(term);
  if (id) { res.innerHTML = ""; res.append(h("div", {class: "row"}, h("span", {class: "nm"}, "App Steam n. " + id), h("button", {class: "abtn", type: "button", onclick: () => addBtn({appid: id, name: ""})}, "+ Aggiungi"))); return; }
  if (!searchConsent) {
   if (!confirm("La ricerca per nome passa da servizi gratuiti di terzi (allorigins, corsproxy…), che vedranno il testo che cerchi e potrebbero alterare i risultati.\n\nPer evitarlo incolla il link Steam del gioco (o il suo numero): è sicuro e non usa nessun servizio esterno.\n\nContinuare con la ricerca per nome?")) { res.innerHTML = ""; return; }
   searchConsent = true;
  }
  try {
   const list = await searchGames(term); res.innerHTML = "";
   if (!list.length) res.append(h("p", {}, "Nessun risultato. Prova con un altro nome o incolla il link della pagina Steam del gioco."));
   for (const g of list) {
    const has = currentList().some(x => Number(x.appid) === Number(g.appid));
    res.append(h("div", {class: "row"}, h("span", {class: "nm"}, g.name), has ? h("span", {}, "già presente") : h("button", {class: "abtn", type: "button", onclick: () => addBtn(g)}, "+ Aggiungi")));
   }
  } catch (err) { res.innerHTML = ""; res.append(h("p", {class: "errmsg"}, "Ricerca non disponibile ora. Incolla il link della pagina Steam del gioco (o il suo numero) e premi Cerca.")); }
 };
 q.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
 box.append(q, h("div", {class: "row"}, h("button", {class: "abtn", type: "button", onclick: doSearch}, "🔍 Cerca")), res);
 box.append(h("h4", {}, "Notifiche"));
 box.append(h("p", {}, "Se qualcuno manda messaggi falsi sull'argomento delle notifiche, creane uno nuovo: gli altri passano al nuovo argomento da soli alla prossima apertura dell'app."));
 box.append(h("div", {class: "row"}, h("button", {class: "abtn", type: "button", onclick: async e => {
  if (!confirm("Creare un nuovo argomento? Gli altri passano al nuovo da soli alla prossima apertura dell'app.")) return;
  e.target.disabled = true;
  try { const t = await adminTopic(); msgEl(box, "Nuovo argomento creato. Le notifiche si aggiornano da sole.", true); } catch (err) { msgEl(box, err.message, false); }
  e.target.disabled = false;
 }}, "🔄 Cambia argomento")));
 box.append(h("div", {class: "row"}, h("button", {class: "abtn", type: "button", onclick: () => { adminToken = ""; try { localStorage.removeItem(ADMIN_KEY); } catch {} renderAdmin(); }}, "Esci dalla modalità amministratore")));
}

function openManager() {
 const box = $("mList"); box.innerHTML = "";
 for (const k of ORDER) {
  const l = document.createElement("label"); l.className = "opt";
  const c = document.createElement("input"); c.type = "checkbox"; c.checked = !hidden.includes(k);
  c.addEventListener("change", () => {
   hidden = c.checked ? hidden.filter(x => x !== k) : [...hidden, k];
   if (ORDER.every(x => hidden.includes(x))) { hidden = hidden.filter(x => x !== k); c.checked = true; }
   saveHidden(); ensureSelected(); render(); updateTitle();
   if (c.checked && !cache[k]) refreshAll();
  });
  l.append(c, document.createTextNode(GAMES[k].name)); box.append(l);
 }
 openOv("manager");
 renderNotif(); renderTheme(); renderFont(); renderSync(); renderAdmin();
}
function closeManager() { closeOv("manager"); }
$("manageBtn").addEventListener("click", openManager);
$("mClose").addEventListener("click", closeManager);

