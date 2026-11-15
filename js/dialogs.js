/* ---------- Dimensione del testo ---------- */
const FONT_KEY = "game_patch_radar_font_v1", FONTS = [0.9, 1, 1.15, 1.3];
let fontIdx = 1;
function applyFont() { document.documentElement.style.setProperty("--tz", FONTS[fontIdx]); }
function loadFont() { try { const i = FONTS.indexOf(Number(localStorage.getItem(FONT_KEY))); if (i >= 0) fontIdx = i; } catch {} applyFont(); }
function setFont(i) {
 fontIdx = Math.max(0, Math.min(FONTS.length - 1, i));
 try { localStorage.setItem(FONT_KEY, String(FONTS[fontIdx])); } catch {}
 applyFont(); renderFont();
}
function renderFont() {
 const row = $("fontRow"); row.innerHTML = "";
 row.append(h("button", {type: "button", class: "abtn", "aria-label": "Testo più piccolo", ...(fontIdx === 0 ? {disabled: ""} : {}), onclick: () => setFont(fontIdx - 1)}, "A−"),
  h("button", {type: "button", class: "abtn", "aria-label": "Testo più grande", ...(fontIdx === FONTS.length - 1 ? {disabled: ""} : {}), onclick: () => setFont(fontIdx + 1)}, "A+"),
  h("span", {class: "v-note", style: "align-self:center;margin:0"}, "Testo: " + Math.round(FONTS[fontIdx] * 100) + "%"));
}

/* ---------- Riepilogo dall'ultima visita ---------- */
function openRecap() {
 const body = $("recapBody"); body.innerHTML = "";
 const entries = [];
 for (const k of visibleKeys()) for (const it of newItems(k)) entries.push({key: k, item: it});
 if (!entries.length) return;
 const when = prevVisit ? new Intl.DateTimeFormat("it-IT", {day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"}).format(new Date(prevVisit)) : "";
 body.append(h("h2", {}, "Novità" + (when ? " dal " + when : "")), h("p", {class: "v-note"}, plural(entries.length) + ". Tocca «Leggi» per aprire la nota completa; da lì puoi scorrere le altre."));
 let last = null;
 entries.forEach((entry, i) => {
  const {key, item} = entry;
  if (key !== last) { last = key; body.append(h("div", {class: "rgame"}, coverImg(GAMES[key].appid, "cover", GAMES[key].image, GAMES[key].name), h("b", {}, GAMES[key].name))); }
  const text = item.summary || (fullText(item).replace(/\s+/g, " ").slice(0, 220) + (fullText(item).length > 220 ? "…" : ""));
  const card = h("div", {class: "rcard"}, h("span", {class: "date"}, dateLabel(item.date)), h("h3", {}, (item.it && item.it.title) || item.title || "Aggiornamento"));
  const lb = labelsEl(item); if (lb) card.append(lb);
  if (text) card.append(h("div", {class: "rs"}, text));
  card.append(h("div", {class: "actions"}, mkBtn("⛶ Leggi", () => openViewer(entries, i))));
  body.append(card);
 });
 body.append(h("div", {class: "actions", style: "margin-top:16px"}, mkBtn("✓ Segna tutto come letto", () => { markAllRead(); closeOv("recap"); })));
 openOv("recap");
}
$("rClose").addEventListener("click", () => closeOv("recap"));

/* ---------- Benvenuto (prima apertura) ---------- */
const WELCOME_KEY = "game_patch_radar_welcome_v1";
const isStandalone = () => { try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; } };
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function renderWelcome() {
 const box = $("welcomeBody"); box.innerHTML = "";
 const installed = isStandalone();
 const notifOn = notifSupported() && notifPref.on && Notification.permission === "granted";
 const step = (n, done, title, ...kids) => h("div", {class: "step" + (done ? " done" : "")}, h("div", {class: "n"}, done ? "✓" : String(n)), h("div", {}, h("h4", {}, title), ...kids));
 box.append(h("h2", {}, "Benvenuto in Game Patch Radar"), h("p", {class: "v-note"}, "Le patch dei tuoi giochi Steam, riassunte e tradotte in italiano. Tre passi e sei pronto."));
 const s1 = [];
 if (installed) s1.push(h("p", {}, "L'app è già installata."));
 else if (installEvt) s1.push(h("p", {}, "Così la trovi nel Launcher come una vera app."), mkBtn("📲 Installa", installApp));
 else if (isIOS()) s1.push(h("p", {}, "Tocca Condividi nel browser (il quadrato con la freccia) e scegli «Aggiungi alla schermata Home»."));
 else s1.push(h("p", {}, "Dal menu del browser (⋮) scegli «Installa app» oppure «Aggiungi a schermata Home»."));
 box.append(step(1, installed, "Aggiungi l'app alla schermata Home", ...s1));
 const s2 = [];
 if (!notifSupported()) s2.push(h("p", {}, isIOS() && !installed ? "Su iPhone le notifiche funzionano dopo aver aggiunto l'app alla schermata Home: fallo, poi riaprila da lì." : "Questo browser non supporta le notifiche."));
 else if (notifOn) s2.push(h("p", {}, "Attive: ti avviso quando esce una patch. I dettagli sono nelle impostazioni."));
 else s2.push(h("p", {}, "Ti avviso quando esce una nuova patch, anche ad app chiusa."), mkBtn("🔔 Attiva le notifiche", async () => { await setMaster(true); renderWelcome(); }));
 box.append(step(2, notifOn, "Attiva le notifiche", ...s2));
 box.append(step(3, false, "Scegli i tuoi giochi", h("p", {}, "Nascondi quelli che non ti interessano e regola notifiche, tema e dimensione del testo."), mkBtn("⚙ Apri le impostazioni", () => { finishWelcome(); openManager(); })));
 box.append(h("div", {class: "actions", style: "margin-top:18px"}, mkBtn("Inizia ▸", finishWelcome)));
}
function showWelcome() { renderWelcome(); openOv("welcome"); }
function finishWelcome() { try { localStorage.setItem(WELCOME_KEY, "1"); } catch {} closeOv("welcome"); }
function maybeWelcome(returning) {
 try {
  if (localStorage.getItem(WELCOME_KEY)) return;
  if (returning) { localStorage.setItem(WELCOME_KEY, "1"); return; }
 } catch { return; }
 showWelcome();
}

/* ---------- Invita un amico ---------- */
function inviteUrl() { return location.origin + location.pathname.replace(/[^/]*$/, ""); }
let qrPromise = null;
function loadQr() {
 if (!qrPromise) qrPromise = new Promise((res, rej) => {
  if (window.qrcode) return res();
  const s = document.createElement("script"); s.src = "qr.js"; s.onload = res; s.onerror = () => { qrPromise = null; rej(new Error("qr")); };
  document.head.append(s);
 });
 return qrPromise;
}
function qrSvg(text) {
 const q = qrcode(0, "M"); q.addData(text); q.make();
 const n = q.getModuleCount(), m = 2, sz = n + 2 * m; let d = "";
 for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + (c + m) + " " + (r + m) + "h1v1h-1z";
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + sz + " " + sz + '" role="img" aria-label="Codice QR con il link all\'app" shape-rendering="crispEdges"><rect width="' + sz + '" height="' + sz + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
}
function openInvite() {
 const box = $("inviteBody"); box.innerHTML = "";
 box.append(h("h2", {}, "Invita un amico"));
 if (location.protocol === "file:") { box.append(h("p", {class: "v-note"}, "Per invitare gli amici apri l'app dal suo indirizzo web, non da un file.")); openOv("invite"); return; }
 const url = inviteUrl();
 const holder = h("div", {class: "qr"});
 box.append(h("p", {class: "v-note"}, "Fai inquadrare il codice o manda il link. Aprendolo dal telefono, il browser propone di installare l'app."), h("div", {style: "margin:14px 0"}, holder), h("p", {style: "overflow-wrap:anywhere;font-size:13px"}, url));
 loadQr().then(() => { holder.innerHTML = qrSvg(url); }).catch(() => holder.replaceWith(h("p", {class: "v-note"}, "Codice QR non disponibile ora: usa il link.")));
 const btns = h("div", {class: "row-btns", style: "justify-content:center"});
 if (navigator.share) btns.append(mkBtn("↗ Condividi", async () => { try { await navigator.share({title: "Game Patch Radar", text: "Le patch dei tuoi giochi Steam, in italiano:", url}); } catch {} }));
 btns.append(mkBtn("🔗 Copia link", async () => { try { await navigator.clipboard.writeText(url); toast("🔗 Link copiato"); } catch { toast("Copia non riuscita"); } }),
  h("a", {class: "abtn", style: "text-decoration:none", href: "https://wa.me/?text=" + encodeURIComponent("Guarda Game Patch Radar, le patch dei giochi Steam in italiano: " + url), target: "_blank", rel: "noopener noreferrer"}, "💬 WhatsApp"));
 box.append(btns);
 openOv("invite");
}
$("inviteBtn").addEventListener("click", openInvite);
$("guideBtn").addEventListener("click", showWelcome);
$("iClose").addEventListener("click", () => closeOv("invite"));


