/* ---------- Notifiche push (ntfy, web app) ---------- */
function setTopicLink() { renderNotif(); if (notifPref.on) syncNotif().catch(() => {}); }
/* Notifiche push: l'app si iscrive da sola al servizio gratuito ntfy.sh (Web Push), senza installare altre app. */
const NOTIF_KEY = "game_patch_radar_notif_v1";
const NTFY = "https://ntfy.sh";
/* major = giochi di cui si vogliono solo le patch grosse; off = giochi senza avvisi; mode = «now» (subito) o «digest» (riepilogo serale); news = anche annunci, eventi e novità della scheda Steam; sale = saldi; stable = avviso «patch stabile»; quiet = ore senza suono */
let notifPref = {on: false, off: [], major: [], kw: [], mode: "now", news: false, sale: false, stable: false, quiet: {on: false, from: "23:00", to: "08:00"}};
/* Parole chiave: id, nomi e ordine dei gruppi stanno in shared.js (KW_GROUPS), gli stessi che usa l'Action. kw = gruppi scelti: avviso anche per le patch piccole che li contengono,
   ma solo sui giochi con «Solo grosse» (sugli altri arrivano già tutte le patch) e in modalità «Subito». */
let notifMsg = null;
function loadNotif() {
 try {
  const d = JSON.parse(localStorage.getItem(NOTIF_KEY) || "null"), q = (d && d.quiet) || {};
  if (d) notifPref = {on: !!d.on, off: d.off || [], major: Array.isArray(d.major) ? d.major : [], kw: Array.isArray(d.kw) ? d.kw.filter(x => KW_GROUPS.some(g => g[0] === x)) : [], mode: d.mode === "digest" ? "digest" : "now", news: !!d.news, sale: !!d.sale, stable: !!d.stable,
   quiet: {on: !!q.on, from: q.from || "23:00", to: q.to || "08:00"}};
 } catch {}
}
function saveNotif() { try { localStorage.setItem(NOTIF_KEY, JSON.stringify(notifPref)); } catch {} }
function notifSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && location.protocol !== "file:"; }
function b64u(t) { const pad = "=".repeat((4 - t.length % 4) % 4); return Uint8Array.from(atob((t + pad).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)); }
async function pushSub(create) {
 const reg = await navigator.serviceWorker.ready;
 let sub = await reg.pushManager.getSubscription();
 if (!sub && create) {
  const r = await fetch(NTFY + "/v1/config"); const cfg = await r.json();
  if (!cfg.web_push_public_key) throw new Error("Il servizio notifiche non è disponibile ora");
  sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64u(cfg.web_push_public_key)});
 }
 return sub;
}
/* Gli argomenti a cui iscriversi: uno per gioco (patch, oppure riepilogo serale), più annunci e saldi se richiesti. */
function topicList() {
 const out = [];
 for (const k of ORDER) {
  if (notifPref.off.includes(k)) continue;
  const g = GAMES[k], id = CFG.ntfyTopic + "-" + g.appid;
  const major = g.watch || notifPref.major.includes(k);   // giochi osservati: sempre e solo patch grosse
  out.push((notifPref.mode === "digest" ? id + "-digest" : id) + (major ? "-major" : ""));
  if (notifPref.mode === "now" && !g.watch && notifPref.major.includes(k)) for (const w of notifPref.kw) out.push(id + "-kw-" + w);   // parole chiave nelle patch piccole
  if (notifPref.news) out.push(id + "-news");   // per i giochi osservati il server manda qui solo le novità della scheda (italiano, DLC), non gli annunci
  if (notifPref.sale) out.push(id + "-sale");
  if (notifPref.stable) out.push(id + "-stable");   // patch grossa senza hotfix da 48 ore
  if (g.watch && g.target) out.push(id + "-target");   // avviso quando il prezzo scende sotto la soglia
 }
 return out;
}
/* Le ore silenziose le applica il service worker, che le riceve da qui. */
async function postPrefs() {
 try { const reg = await navigator.serviceWorker.ready; if (reg.active) reg.active.postMessage({type: "prefs", quiet: notifPref.quiet}); } catch {}
}
/* Allinea il servizio con le scelte fatte (si richiama a ogni apertura per tenere valida l'iscrizione). */
let syncedTopics = "";
async function syncNotifIfChanged() {   // dopo un aggiornamento dei giochi: se gli argomenti da seguire sono cambiati, riallinea
 if (!notifSupported() || !notifPref.on || !CFG.ntfyTopic || Notification.permission !== "granted") return;
 const now = topicList().join("|");
 if (now !== syncedTopics) await syncNotif();
}
async function syncNotif() {
 if (!notifSupported()) return;
 if (notifPref.on && !CFG.ntfyTopic) throw new Error("Notifiche non ancora configurate");
 const topics = notifPref.on ? topicList() : [];
 const sub = await pushSub(topics.length > 0);
 if (!topics.length) {
  if (sub) {
   try { await fetch(NTFY + "/v1/webpush", {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({endpoint: sub.endpoint})}); } catch {}
   try { await sub.unsubscribe(); } catch {}
  }
  return;
 }
 const j = sub.toJSON();
 const r = await fetch(NTFY + "/v1/webpush", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({endpoint: j.endpoint, auth: j.keys.auth, p256dh: j.keys.p256dh, topics})});
 if (!r.ok) throw new Error("Il servizio notifiche ha risposto " + r.status);
 syncedTopics = topics.join("|");
 await postPrefs();
}
async function setMaster(on) {
 notifMsg = null;
 if (on) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { notifMsg = ["err", "Le notifiche sono bloccate: consentile dalle impostazioni del sito (icona del lucchetto nella barra) e riprova."]; renderNotif(); return; }
  notifPref.on = true;
 } else notifPref.on = false;
 saveNotif();
 try { await syncNotif(); toast(on ? "🔔 Notifiche attivate" : "🔕 Notifiche disattivate"); }
 catch (e) { notifPref.on = !on; saveNotif(); notifMsg = ["err", "Non sono riuscito a " + (on ? "attivarle" : "disattivarle") + ": " + e.message]; }
 renderNotif(); renderBell();
}
async function setPref(patch, resync = true) {
 Object.assign(notifPref, patch); saveNotif(); notifMsg = null;
 if (resync) { try { await syncNotif(); } catch (e) { notifMsg = ["err", "Salvataggio non riuscito: " + e.message]; } }
 else await postPrefs();
 renderNotif(); renderBell();
}
/* Campanella nella pagina di un gioco: segue o silenzia solo le notifiche di quel gioco (visibile se le notifiche sono attive). */
function renderBell() {
 const b = $("bellBtn");
 const show = !isHome() && !crossGame() && !!GAMES[selected] && notifSupported() && notifPref.on && Notification.permission === "granted";
 b.hidden = !show;
 if (!show) return;
 const on = !notifPref.off.includes(selected);
 b.textContent = on ? "🔔" : "🔕";
 b.classList.toggle("on", on);
 const label = on ? "Notifiche attive per questo gioco: tocca per silenziarle" : "Notifiche silenziate per questo gioco: tocca per riattivarle";
 b.title = label; b.setAttribute("aria-label", label); b.setAttribute("aria-pressed", on ? "true" : "false");
}
$("bellBtn").addEventListener("click", async () => {
 const k = selected, on = notifPref.off.includes(k);   // se era silenziato, lo riattiva
 await setGameNotif(k, on);
 toast(on ? "🔔 Notifiche attivate per " + GAMES[k].name : "🔕 Notifiche silenziate per " + GAMES[k].name);
 renderBell();
});
function setGameMajor(k, on) { return setPref({major: on ? [...new Set([...notifPref.major, k])] : notifPref.major.filter(x => x !== k)}); }
function setGameNotif(k, on) { return setPref({off: on ? notifPref.off.filter(x => x !== k) : [...new Set([...notifPref.off, k])]}); }
function switchEl(checked, onchange, disabled, name) {
 // il testo accanto all'interruttore sta fuori dall'etichetta: senza un nome un lettore di schermo direbbe solo «casella di controllo»
 const i = h("input", {type: "checkbox", role: "switch", "aria-label": name || ""}); i.checked = checked; i.disabled = !!disabled; i.addEventListener("change", () => onchange(i.checked));
 return h("label", {class: "sw"}, i, h("i", {}));
}
function renderNotif() {
 const box = $("nList"); box.innerHTML = "";
 if (!notifSupported()) {
  box.append(h("p", {class: "v-note"}, location.protocol === "file:" ? "Le notifiche funzionano solo dal sito dell'app, non da un file." : "Questo browser non supporta le notifiche. Su iPhone installa prima l'app dalla schermata Home."));
  return;
 }
 const denied = Notification.permission === "denied";
 box.append(h("div", {class: "nrow big"}, h("span", {}, "Ricevi le notifiche sui nuovi aggiornamenti"), switchEl(notifPref.on && !denied, setMaster, false, "Ricevi le notifiche sui nuovi aggiornamenti")));
 if (denied) box.append(h("p", {class: "nstat errmsg"}, "Le notifiche sono bloccate per questo sito: consentile dalle impostazioni del browser."));
 else if (!notifPref.on) box.append(h("p", {class: "v-note"}, "Attiva l'interruttore per essere avvisato anche quando l'app è chiusa."));
 else {
  box.append(h("p", {class: "nstat okmsg"}, "✓ Attive su questo dispositivo."));
  const seg = h("div", {class: "seg"});
  for (const [m, label] of [["now", "Subito"], ["digest", "Riepilogo serale"]]) seg.append(h("button", {type: "button", class: "abtn" + (notifPref.mode === m ? " on" : ""), onclick: () => notifPref.mode !== m && setPref({mode: m})}, label));
  box.append(seg, h("p", {class: "v-note"}, notifPref.mode === "digest" ? "Una sola notifica per gioco, verso le 18:00, con le patch uscite nella giornata." : "Una notifica appena esce una nuova patch."));
  box.append(h("div", {class: "nrow"}, h("span", {}, "Includi anche annunci, eventi e novità del gioco (italiano, DLC…)"), switchEl(notifPref.news, on => setPref({news: on}), false, "Includi anche annunci, eventi e novità del gioco")));
  box.append(h("div", {class: "nrow"}, h("span", {}, "Avvisami quando un gioco va in saldo"), switchEl(notifPref.sale, on => setPref({sale: on}), false, "Avvisami quando un gioco va in saldo")));
  box.append(h("div", {class: "nrow"}, h("span", {}, "Avvisami quando una patch grossa è stabile (48 ore senza hotfix)"), switchEl(notifPref.stable, on => setPref({stable: on}), false, "Avvisami quando una patch grossa è stabile")));
  const q = notifPref.quiet;
  box.append(h("div", {class: "nrow"}, h("span", {}, "Ore silenziose (senza suono né vibrazione)"), switchEl(q.on, on => setPref({quiet: {...q, on}}, false), false, "Ore silenziose")));
  if (q.on) {
   const time = (val, key) => { const i = h("input", {type: "time", class: "tin", value: val, "aria-label": key === "from" ? "Ore silenziose: dalle" : "Ore silenziose: alle"}); i.addEventListener("change", () => i.value && setPref({quiet: {...notifPref.quiet, [key]: i.value}}, false)); return i; };
   box.append(h("div", {class: "nrow", style: "gap:8px"}, h("span", {style: "flex:0 0 auto"}, "Dalle"), time(q.from, "from"), h("span", {style: "flex:0 0 auto"}, "alle"), time(q.to, "to")));
  }
  box.append(h("p", {class: "v-note", style: "margin-top:12px"}, "Giochi da seguire:"));
  for (const k of ORDER) {
   const g = GAMES[k], following = !notifPref.off.includes(k), onlyMajor = notifPref.major.includes(k);
   const kind = !following ? null : g.watch ? h("span", {class: "tagw"}, "👁 solo grosse")
    : h("button", {type: "button", class: "abtn mini" + (onlyMajor ? " on" : ""), title: "Solo patch con contenuti nuovi o bilanciamento: niente hotfix e correzioni minori", onclick: () => setGameMajor(k, !onlyMajor)}, onlyMajor ? "Solo grosse" : "Tutte");
   box.append(h("div", {class: "nrow"}, h("span", {}, g.name), kind, switchEl(following, on => setGameNotif(k, on), false, "Notifiche di " + g.name)));
  }
  box.append(h("p", {class: "v-note"}, "«Solo grosse»: patch con contenuti nuovi o cambi di bilanciamento, senza hotfix né correzioni minori. I giochi con 👁 mandano sempre solo quelle."));
  box.append(h("p", {class: "v-note", style: "margin-top:12px"}, "Avvisi per argomento:"));
  const kwBox = h("div", {class: "seg", style: "flex-wrap:wrap;gap:6px"});
  for (const [w, label] of KW_GROUPS) {
   const on = notifPref.kw.includes(w);
   kwBox.append(h("button", {type: "button", class: "abtn mini" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onclick: () => setPref({kw: on ? notifPref.kw.filter(x => x !== w) : [...notifPref.kw, w]})}, label));
  }
  box.append(kwBox);
  box.append(h("p", {class: "v-note"}, notifPref.mode === "digest" ? "Gli avvisi per argomento funzionano solo con le notifiche «Subito»."
   : notifPref.major.some(k => !notifPref.off.includes(k) && GAMES[k] && !GAMES[k].watch) ? "Anche se una patch è piccola, ti avviso se parla di uno di questi argomenti. Vale per i giochi impostati su «Solo grosse»."
   : "Per usarli imposta almeno un gioco su «Solo grosse»: sugli altri ricevi già tutte le patch."));
  box.append(h("div", {class: "row-btns"}, h("button", {type: "button", class: "abtn", onclick: async () => {
   try { const reg = await navigator.serviceWorker.ready; await reg.showNotification("Game Patch Radar", {body: "Le notifiche funzionano ✓", icon: "icons/icon-192.png", badge: "icons/icon-192.png"}); } catch (e) { toast("Prova non riuscita"); }
  }}, "Invia una notifica di prova")));
 }
 if (notifMsg) box.append(h("p", {class: "nstat " + (notifMsg[0] === "err" ? "errmsg" : "okmsg")}, notifMsg[1]));
}
$("ntfyLink").addEventListener("click", e => { e.preventDefault(); openManager(); $("nSection").scrollIntoView({block: "start"}); });

