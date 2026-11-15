/* ---------- Squadra: chi gioca a cosa e cosa interessa agli amici (dati nell'archivio privato del ponte) ---------- */
const TEAM_KEY = "game_patch_radar_team_v1";
let team = {code: "", name: ""};        // codice della squadra e il tuo nome, salvati solo su questo dispositivo
let teamState = null;                    // {members: [nomi], votes: {appid: {nome: "play"|"interest"}}}
let teamErr = "";
function loadTeam() { try { const d = JSON.parse(localStorage.getItem(TEAM_KEY) || "null"); if (d && typeof d.code === "string" && typeof d.name === "string") team = {code: d.code, name: d.name}; } catch {} }
function saveTeam() { try { team.code ? localStorage.setItem(TEAM_KEY, JSON.stringify(team)) : localStorage.removeItem(TEAM_KEY); } catch {} }
function inTeam() { return !!(team.code && team.name && bridgeUrl()); }
function teamLeave() { team = {code: "", name: ""}; teamState = null; teamErr = ""; saveTeam(); }
async function teamApi(path, body, code = team.code) {
 let r;
 try { r = await fetch(bridgeUrl() + path, {method: "POST", headers: {"Content-Type": "application/json", Authorization: "Bearer " + code}, body: JSON.stringify(body || {}), cache: "no-store", signal: AbortSignal.timeout(15000)}); }
 catch { throw new Error("Il ponte non risponde. Controlla la connessione e riprova."); }
 let d = {}; try { d = await r.json(); } catch {}
 if (r.status === 401 && team.code && code === team.code && team.name) teamLeave();   // il codice è stato cambiato: bisogna rientrare
 if (!r.ok) { const e = new Error(d.error || "Errore " + r.status); e.status = r.status; throw e; }
 return d;
}
function setTeamState(d) { teamState = {members: d.members || [], votes: d.votes || {}, sessions: d.sessions || [], notes: d.notes || {}}; }
async function teamAct(path, body) {   // sessioni e note: ritorna true se è andata a buon fine
 try { setTeamState(await teamApi(path, {name: team.name, ...body})); teamErr = ""; return true; }
 catch (e) { toast(e.message); return false; }
}
function teamRedraw() { if (isHome()) render(); else renderMeta(); if ($("team").classList.contains("open")) renderTeam(); if ($("viewer").classList.contains("open") && viewerItem) renderViewer(); }
/* Saldi che interessano alla squadra: giochi in sconto (almeno 10%) scelti da due o più amici */
function teamSales() {
 if (!inTeam() || !teamState) return [];
 const out = [];
 for (const k of ORDER) {
  const g = GAMES[k], p = g.price, w = teamWho(g.appid), n = new Set([...w.play, ...w.interest]);
  if (p && p.discount >= 10 && n.size >= 2) out.push({g, p, names: [...n]});
 }
 return out;
}
function teamSalesBox() {
 const l = teamSales(); if (!l.length) return null;
 const box = h("div", {class: "banner", style: "display:block"}, h("div", {class: "b-text"}, "💰 Saldi che interessano alla squadra"));
 for (const {g, p, names} of l) box.append(h("div", {class: "tm-who", style: "color:var(--green-text)"}, g.name + ": −" + p.discount + "% · " + p.final + (p.initial ? " (era " + p.initial + ")" : "") + " · " + names.join(", ")));
 return box;
}
function teamLastPatchLine(appid) {
 const it = latestOf(String(appid)); if (!it) return "";
 const v = versionOf(it.title);
 return "Ultima patch: " + ((it.it && it.it.title) || it.title || "Aggiornamento") + (v && !/\bv?\d/.test(it.title || "") ? " · v" + v : "") + " · " + agoLabel(it.date);
}
function whenLabel(ts) {
 try { return new Intl.DateTimeFormat("it-IT", {weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}).format(new Date(ts)); } catch { return new Date(ts).toLocaleString(); }
}
function icsText(se, gameName) {
 const f = t => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
 const esc = t => String(t).replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
 return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Game Patch Radar//IT", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", "UID:" + se.id + "@patch-radar", "DTSTAMP:" + f(Date.now()),
  "DTSTART:" + f(se.ts), "DTEND:" + f(se.ts + 2 * 3600000), "SUMMARY:" + esc("🎮 " + gameName + " con la squadra"),
  "DESCRIPTION:" + esc((se.note ? se.note + "\n" : "") + "Proposta da " + se.by + (se.going.length ? ". Ci sono: " + se.going.join(", ") : "")), "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";
}
function downloadIcs(se, gameName) {
 try {
  const url = URL.createObjectURL(new Blob([icsText(se, gameName)], {type: "text/calendar;charset=utf-8"}));
  const a = h("a", {href: url, download: "sessione-" + se.id + ".ics"}); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
 } catch { toast("Non riesco a creare il file del calendario"); }
}
function teamSessionsEl() {
 const wrap = h("div", {});
 wrap.append(h("h3", {class: "sec"}, "📅 Prossime sessioni"));
 const list = (teamState.sessions || []).filter(x => GAMES[String(x.appid)]);
 if (!list.length) wrap.append(h("p", {class: "v-note"}, "Nessuna sessione in programma."));
 for (const se of list) {
  const g = GAMES[String(se.appid)], going = se.going.includes(team.name);
  const row = h("div", {class: "tm-row"}, h("div", {class: "tm-top"}, h("b", {}, g.name + " · " + whenLabel(se.ts))));
  if (se.note) row.append(h("div", {class: "tm-who"}, se.note));
  row.append(h("div", {class: "tm-who"}, "Proposta da " + se.by + " · ci sono: " + (se.going.length ? se.going.join(", ") : "nessuno")));
  const lp = teamLastPatchLine(se.appid); if (lp) row.append(h("div", {class: "tm-who"}, "🆕 " + lp));
  const btns = h("div", {class: "tm-btns"},
   h("button", {type: "button", class: "abtn" + (going ? " on" : ""), onclick: async e => { e.target.disabled = true; await teamAct("/team/session", {action: "go", id: se.id}); teamRedraw(); }}, going ? "✅ Ci sono" : "Ci sono"),
   h("button", {type: "button", class: "abtn", onclick: () => downloadIcs(se, g.name)}, "📅 Calendario"));
  if (se.by === team.name) btns.append(h("button", {type: "button", class: "abtn danger", onclick: async e => { if (!confirm("Eliminare questa sessione?")) return; e.target.disabled = true; await teamAct("/team/session", {action: "del", id: se.id}); teamRedraw(); }}, "🗑"));
  row.append(btns); wrap.append(row);
 }
 const sel = h("select", {class: "tin", "aria-label": "Gioco"}); for (const k of ORDER) sel.append(h("option", {value: GAMES[k].appid}, GAMES[k].name));
 const when = h("input", {type: "datetime-local", class: "tin", "aria-label": "Data e ora"});
 const note = h("input", {type: "text", placeholder: "Nota (facoltativa, es. «server di Anna»)", maxlength: "80", autocomplete: "off"});
 const add = h("button", {type: "button", class: "abtn pri", onclick: async () => {
  const ts = new Date(when.value).getTime();
  if (!when.value || !Number.isFinite(ts)) { toast("Scegli giorno e ora"); return; }
  add.disabled = true;
  if (await teamAct("/team/session", {action: "add", appid: Number(sel.value), ts, note: note.value})) { toast("📅 Sessione aggiunta"); }
  add.disabled = false; teamRedraw();
 }}, "＋ Proponi una sessione");
 wrap.append(h("div", {class: "tm-row"}, h("div", {class: "tm-who", style: "margin:0 0 6px"}, "Nuova sessione"), sel, when, note, h("div", {class: "tm-btns"}, add)));
 return wrap;
}
/* Note della squadra sotto una patch (nel visualizzatore) */
function teamNotesEl(item) {
 const gid = String(item.gid || "");
 if (!inTeam() || !teamState || !/^[A-Za-z0-9_-]{1,40}$/.test(gid)) return null;
 const box = h("div", {class: "sum diff"}, h("b", {}, "💬 Note della squadra"));
 for (const n of (teamState.notes[gid] || [])) {
  const row = h("div", {class: "tm-who", style: "color:var(--text)"}, h("strong", {}, n.name + ": "), n.text);
  if (n.name === team.name) row.append(" ", h("button", {type: "button", class: "abtn mini", title: "Elimina la tua nota", onclick: async () => { if (await teamAct("/team/note", {action: "del", gid, id: n.id})) teamRedraw(); }}, "🗑"));
  box.append(row);
 }
 const inp = h("input", {type: "text", placeholder: "Scrivi una nota per gli amici…", maxlength: "280", autocomplete: "off", "aria-label": "Nota"});
 const go = h("button", {type: "button", class: "abtn", onclick: async () => {
  if (inp.value.trim().length < 2) return;
  go.disabled = true;
  const ok = await teamAct("/team/note", {action: "add", gid, text: inp.value});
  go.disabled = false; if (ok) teamRedraw();
 }}, "Aggiungi");
 inp.addEventListener("keydown", e => { if (e.key === "Enter") go.click(); });
 box.append(h("div", {class: "row", style: "display:flex;gap:6px;margin-top:8px"}, inp, go));
 return box;
}
/* Messaggio pronto per il gruppo WhatsApp: gioco, versione, riassunto in italiano e link alla nota completa */
function groupMessage(item, gameName) {
 const v = versionOf(item.title), title = (item.it && item.it.title) || item.title || "Aggiornamento";
 const sum = (item.summary || "").split("\n").filter(Boolean).slice(0, 5).join("\n");
 return "🎮 " + gameName + ": nuova patch" + (v ? " v" + v : "") + "\n" + title + (sum ? "\n" + sum : "") + "\n" + (item.url ? "Nota completa: " + item.url + "\n" : "") + "Tutte le patch: " + inviteUrl();
}
async function teamRefresh() {
 if (!inTeam()) return;
 try { setTeamState(await teamApi("/team/state")); teamErr = ""; } catch (e) { teamErr = e.message; }
 teamRedraw();
}
async function teamJoin(code, name) {
 const d = await teamApi("/team/join", {name}, code);
 team = {code, name: d.name}; saveTeam(); setTeamState(d); teamErr = "";
}
async function teamVote(appid, kind) {
 const cur = (teamState && teamState.votes[String(appid)] || {})[team.name];
 try { setTeamState(await teamApi("/team/vote", {name: team.name, appid, kind: cur === kind ? null : kind})); teamErr = ""; }
 catch (e) { toast(e.message); }
 teamRedraw();
}
const TEAM_KINDS = [["play", "🎮 Ci gioco"], ["interest", "⭐ Mi interessa"]];
function teamWho(appid) {
 const row = (teamState && teamState.votes[String(appid)]) || {}, by = k => Object.keys(row).filter(n => row[n] === k);
 return {play: by("play"), interest: by("interest"), mine: row[team.name] || null};
}
function teamSummary(w) {
 const parts = [];
 if (w.play.length) parts.push("🎮 " + w.play.join(", "));
 if (w.interest.length) parts.push("⭐ " + w.interest.join(", "));
 return parts.join(" · ");
}
function teamButtons(appid, cls) {
 const w = teamWho(appid);
 return TEAM_KINDS.map(([k, label]) => h("button", {type: "button", class: cls + (w.mine === k ? " on" : ""), "aria-pressed": w.mine === k ? "true" : "false", onclick: () => teamVote(appid, k)}, label));
}
/* Nella pagina di un gioco: i tuoi pulsanti e chi, tra gli amici, ci gioca o lo vorrebbe provare */
function teamChips(el, g) {
 if (!inTeam() || !teamState) return;
 el.append(...teamButtons(g.appid, "mchip tmb"));
 const txt = teamSummary(teamWho(g.appid));
 if (txt) el.append(h("span", {class: "mchip", title: "Dalla squadra"}, txt));
}
function renderTeam() {
 const box = $("teamBody"); box.innerHTML = "";
 box.append(h("h2", {}, "👥 Squadra"));
 if (!bridgeUrl()) { box.append(h("p", {class: "v-note"}, "La squadra funziona con il ponte Cloudflare, che qui non è ancora collegato.")); return; }
 if (!inTeam()) {
  box.append(h("p", {class: "v-note"}, "Entra con il codice che ti ha dato chi gestisce l'app e scegli il nome con cui gli amici ti vedono. Il codice e il nome restano salvati solo su questo dispositivo."));
  const code = h("input", {type: "text", placeholder: "Codice della squadra (es. abcd-efgh-jkmn)", autocomplete: "off", autocapitalize: "none", spellcheck: "false", value: team.code || ""});
  const name = h("input", {type: "text", placeholder: "Il tuo nome", autocomplete: "nickname", maxlength: "24", value: team.name || ""});
  const go = h("button", {type: "button", class: "abtn pri", onclick: async () => {
   const c = code.value.trim(), n = name.value.trim();
   if (!c || n.length < 2) { msgEl(box, "Scrivi il codice e un nome di almeno due lettere.", false); return; }
   go.disabled = true;
   try { await teamJoin(c, n); toast("👥 Sei nella squadra, " + team.name); renderMeta(); renderTeam(); }
   catch (e) { go.disabled = false; msgEl(box, e.message, false); }
  }}, "Entra");
  name.addEventListener("keydown", e => { if (e.key === "Enter") go.click(); });
  box.append(code, name, h("div", {class: "row-btns"}, go));
  return;
 }
 if (teamErr) box.append(h("p", {class: "nstat errmsg"}, teamErr));
 const members = teamState ? teamState.members : [];
 box.append(h("p", {class: "v-note"}, "Sei " + team.name + (members.length ? " · nella squadra: " + members.join(", ") : "") + ". Tocca i pulsanti per dire a quali giochi giochi o che ti interessano."));
 if (!teamState) { box.append(h("p", {class: "v-note"}, "Carico la squadra…")); return; }
 const sales = teamSalesBox(); if (sales) box.append(sales);
 box.append(teamSessionsEl());
 box.append(h("h3", {class: "sec"}, "🎮 Giochi della squadra"));
 const rows = ORDER.map(k => ({g: GAMES[k], w: teamWho(GAMES[k].appid)}))
  .sort((a, b) => (b.w.play.length * 2 + b.w.interest.length) - (a.w.play.length * 2 + a.w.interest.length));
 for (const {g, w} of rows) {
  const top = h("div", {class: "tm-top"}, h("b", {}, g.name + (g.watch ? " 👁" : "")));
  const p = g.price;
  if (p && p.final) top.append(h("span", {class: "mchip" + (p.discount > 0 ? " sale" : "")}, p.discount > 0 ? "🏷 −" + p.discount + "% · " + p.final : "💶 " + p.final));
  if (g.watch && g.target) top.append(h("span", {class: "mchip"}, "🎯 " + euro(g.target)));
  const row = h("div", {class: "tm-row"}, top);
  const txt = teamSummary(w);
  row.append(h("div", {class: "tm-who"}, txt || "Nessuno l'ha ancora scelto."), h("div", {class: "tm-btns"}, ...teamButtons(g.appid, "abtn")));
  box.append(row);
 }
 const link = inviteUrl() + "#squadra=" + encodeURIComponent(team.code);
 box.append(h("h3", {class: "sec"}, "Invita un amico nella squadra"));
 box.append(h("p", {class: "v-note"}, "Il link contiene il codice: mandalo solo a chi vuoi in squadra."));
 box.append(h("div", {class: "row-btns"},
  mkBtn("🔗 Copia link di invito", async () => { try { await navigator.clipboard.writeText(link); toast("🔗 Link copiato"); } catch { toast("Copia non riuscita"); } }),
  h("a", {class: "abtn", style: "text-decoration:none", href: "https://wa.me/?text=" + encodeURIComponent("Entra nella nostra squadra su Game Patch Radar: " + link), target: "_blank", rel: "noopener noreferrer"}, "💬 WhatsApp")));
 box.append(h("div", {class: "row-btns", style: "margin-top:18px"}, mkBtn("↻ Aggiorna", teamRefresh), mkBtn("Esci dalla squadra", () => { if (confirm("Uscire dalla squadra su questo dispositivo? I tuoi voti restano agli amici.")) { teamLeave(); renderMeta(); renderTeam(); } })));
}
function openTeam() {
 renderTeam(); openOv("team");
 if (inTeam()) teamRefresh();
}
$("tClose").addEventListener("click", () => closeOv("team"));
$("teamLink").addEventListener("click", e => { e.preventDefault(); openTeam(); });
/* Link di invito (…#squadra=codice): apre la schermata con il codice già scritto, poi toglie il codice dall'indirizzo */
function teamFromHash() {
 const m = /^#squadra=([^&]{4,80})$/.exec(location.hash || "");
 if (!m) return;
 try { history.replaceState(null, "", location.pathname + location.search); } catch {}
 let c = ""; try { c = decodeURIComponent(m[1]); } catch { return; }
 if (team.code && team.name) return;   // già in squadra (non inTeam(): a quest'ora il ponte non è ancora noto). Un codice sbagliato nel link non deve cancellare l'iscrizione salvata
 team = {code: c, name: team.name || ""};   // solo precompilato: si salva quando entri davvero
 setTimeout(openTeam, 600);
}

