/* ---------- Schede ---------- */
function mkBtn(label, fn, cls) {
 const b = document.createElement("button"); b.type = "button"; b.className = "abtn" + (cls ? " " + cls : ""); b.textContent = label;
 b.addEventListener("click", () => fn(b)); return b;
}
const LABEL_TXT = {new: "Nuovi contenuti", balance: "Bilanciamento", perf: "Prestazioni", bug: "Correzioni"};
function labelsEl(item) {
 const wrap = h("div", {class: "lbls"});
 if (item.patch === false) wrap.append(h("span", {class: "lbl"}, "Annuncio"));
 for (const l of item.labels || []) if (LABEL_TXT[l]) wrap.append(h("span", {class: "lbl " + l}, LABEL_TXT[l]));
 return wrap.childNodes.length ? wrap : null;
}

/* Ricerca: senza maiuscole e senza accenti, tutte le parole devono comparire (titolo, testo, riassunto, traduzione). */
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const hayCache = new WeakMap();
function haystack(item) {
 let v = hayCache.get(item);
 if (v === undefined) {
  v = norm([item.title, fullText(item), item.summary, item.it && item.it.title, item.it && item.it.text].filter(Boolean).join("\n"));
  hayCache.set(item, v);
 }
 return v;
}
function tokens() { return norm(query).trim().split(/\s+/).filter(Boolean); }
function crossGame() { return savedView || !!query.trim(); }
function snippetOf(item, toks) {
 if (!toks.length) return null;
 for (const text of [fullText(item), item.summary || "", (item.it && item.it.text) || ""]) {
  const n = norm(text), i = n.indexOf(toks[0]);
  if (i < 0 || n.length !== text.length) continue;
  const a = Math.max(0, i - 90), b = Math.min(text.length, i + toks[0].length + 150);
  const piece = text.slice(a, b).replace(/\s+/g, " ");
  return {piece, lead: a > 0, tail: b < text.length};
 }
 return null;
}
function snippetEl(item, toks) {
 const sn = snippetOf(item, toks); if (!sn) return null;
 const el = h("p", {class: "snip"}); if (sn.lead) el.append("… ");
 const n = norm(sn.piece);
 if (n.length !== sn.piece.length) el.append(sn.piece);
 else {
  const spans = [];
  for (const t of toks) for (let i = n.indexOf(t); i >= 0; i = n.indexOf(t, i + t.length)) spans.push([i, i + t.length]);
  spans.sort((x, y) => x[0] - y[0]);
  let pos = 0;
  for (const [a, b] of spans) { if (a < pos) continue; el.append(sn.piece.slice(pos, a), h("mark", {}, sn.piece.slice(a, b))); pos = b; }
  el.append(sn.piece.slice(pos));
 }
 if (sn.tail) el.append(" …");
 return el;
}

function baseEntries() {
 if (savedView) {
  return saved.filter(s => GAMES[s.appid]).map(s => {
   const found = (cache[s.appid] || []).find(i => String(i.gid) === s.gid);
   return {key: s.appid, item: found || {gid: s.gid, title: s.title, date: s.date, url: s.url, contents: "", summary: s.summary, labels: []}};
  });
 }
 if (query.trim()) return visibleKeys().flatMap(k => (cache[k] || []).map(item => ({key: k, item})));
 return (cache[selected] || []).map(item => ({key: selected, item}));
}
function visibleEntries() {
 const toks = tokens();
 const list = baseEntries().filter(({item}) =>
  (!onlyPatch || isPatchItem(item)) &&
  (!labelFilter.size || (item.labels || []).some(l => labelFilter.has(l))) &&
  toks.every(t => haystack(item).includes(t)));
 if (crossGame()) list.sort((a, b) => (b.item.date || 0) - (a.item.date || 0));
 return list;
}

function iconBtn(label, title, fn, on) {
 const b = mkBtn(label, fn, "sq" + (on ? " on" : "")); b.setAttribute("aria-label", title); b.title = title; return b;
}

/* ---------- Schermata principale: l'ultima patch di ogni gioco ---------- */
function latestOf(key) {
 let patch = null, any = null;
 for (const it of cache[key] || []) {
  if (!any || (it.date || 0) > (any.date || 0)) any = it;
  if (isPatchItem(it) && (!patch || (it.date || 0) > (patch.date || 0))) patch = it;
 }
 return patch || any;   // se un gioco non ha patch vere si mostra l'annuncio più recente
}
function homeEntries() {
 const out = [];
 for (const k of visibleKeys()) { const item = latestOf(k); if (item) out.push({key: k, item}); }
 return out.sort((a, b) => (b.item.date || 0) - (a.item.date || 0));
}
function agoLabel(unix) {
 if (!unix) return "";
 const day = t => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
 const d = Math.round((day(Date.now()) - day(unix * 1000)) / 86400000);
 if (d === 0) return "oggi";
 if (d === 1) return "ieri";
 if (d > 1 && d < 14) return d + " giorni fa";
 try { return new Intl.DateTimeFormat("it-IT", {day: "numeric", month: "short", year: "numeric"}).format(new Date(unix * 1000)); } catch { return ""; }
}
function openFromHome(list, idx) {
 openViewer(list, idx);
 render();
}
function buildHomeCard(entry, list, idx) {
 const {key, item} = entry, game = GAMES[key];
 const n = newItems(key).length, fresh = isNew(key, item);
 const article = h("article", {class: "card hcard" + (fresh ? " is-new" : "")});
 const ver = versionOf(item.title);
 const ft = fullText(item);
 const text = item.summary || (ft.replace(/\s+/g, " ").slice(0, 240) + (ft.length > 240 ? "…" : ""));
 const body = h("div", {class: "hbody"},
  h("div", {class: "htop"}, h("span", {}, h("span", {class: "gname"}, game.name + (game.watch ? " 👁" : "")), fresh ? " " : "", fresh ? h("span", {class: "tag new"}, n > 1 ? n + " NUOVE" : "NUOVA") : ""),
   h("span", {class: "date", title: dateLabel(item.date)}, agoLabel(item.date) + (ver ? " · v" + ver : ""))),
  h("h3", {}, (item.it && item.it.title) || item.title || "Aggiornamento"));
 const lb = labelsEl(item); if (lb) body.append(lb);
 if (text) body.append(h("p", {class: "hsum"}, text));
 body.append(h("div", {class: "actions"}, mkBtn("Leggi", () => openFromHome(list, idx), "pri"), mkBtn("Tutte le patch ›", () => selectGame(key))));
 article.append(coverImg(game.appid, "hcover", game.image, game.name), body);
 article.addEventListener("click", e => { if (!e.target.closest("button, a")) openFromHome(list, idx); });
 return article;
}
function renderHome(box) {
 const sb = teamSalesBox(); if (sb) box.append(sb);
 const list = homeEntries();
 $("count").textContent = list.length ? "La patch più recente di ogni gioco · tocca per leggerla" : "In attesa dei dati";
 list.forEach((e, i) => box.append(buildHomeCard(e, list, i)));
 const shown = new Set(list.map(e => e.key));
 for (const k of visibleKeys()) {
  if (shown.has(k)) continue;
  box.append(h("article", {class: "card hcard pend"}, h("h3", {}, GAMES[k].name),
   h("div", {class: "date"}, cache[k] ? "Nessun annuncio recente." : "Dati non ancora disponibili: arrivano al prossimo controllo.")));
 }
}

function buildCard(entry, list, idx) {
 const {key, item} = entry, game = GAMES[key];
 const ik = itemKey(item), tr = showIt[ik] && trCache[ik];
 const fresh = isNew(key, item), cross = crossGame();
 const article = h("article", {class: "card" + (fresh ? " is-new" : "")});
 const meta = h("span", {class: "date"}, dateLabel(item.date) + (versionOf(item.title) ? " · v" + versionOf(item.title) : ""));
 const top = h("div", {class: "card-top"}, cross ? h("span", {}, h("span", {class: "gname"}, game.name), " · ", meta) : meta,
  fresh ? h("span", {class: "tag new"}, "NUOVO") : h("span", {class: "tag"}, "STEAM"));
 const title = h("h3", {}, (tr ? tr.title : item.title) || "Aggiornamento");
 const full = (tr ? tr.text : fullText(item)) || "Apri la pubblicazione per leggere tutti i dettagli.";
 const body = h("div", {class: "summary"});
 renderRich(body, previewOf(full));
 article.append(top, title);
 const lb = labelsEl(item); if (lb) article.append(lb);
 if (item.summary) article.append(summaryBox(item));
 const sn = snippetEl(item, tokens()); if (sn) article.append(sn);
 if (!sn && !item.summary) article.append(body);   // con il riassunto basta quello: il testo completo si legge con «Leggi»
 const actions = h("div", {class: "actions"});
 const sv = isSaved(key, item);
 actions.append(mkBtn("Leggi", () => openViewer(list, idx), "pri"));
 if (fresh) actions.append(mkBtn("✓ Letta", () => { if (markItemRead(key, item)) { render(); updateTitle(); } }));
 actions.append(mkBtn(tr ? "↩ Originale" : "🌐 Traduci", b => toggleTranslate(item, b)));
 actions.append(iconBtn(sv ? "★" : "☆", sv ? "Togli dai salvati" : "Salva", () => toggleSaved(key, item), sv));
 actions.append(iconBtn("↗", "Condividi", () => shareItem(item, game.name)));
 article.append(actions);
 return article;
}

function emptyMessage(total) {
 if (savedView && !saved.length) return "Nessuna patch salvata: tocca «☆ Salva» su una scheda per ritrovarla qui.";
 if (query.trim()) return "Nessun risultato per «" + query.trim() + "». Cerco nei titoli, nei testi e nei riassunti dei giochi visibili.";
 if (total && (onlyPatch || labelFilter.size)) return "Nessuna pubblicazione corrisponde ai filtri attivi: toglili per vederle tutte.";
 return "Non risultano annunci recenti per questo gioco.";
}

function renderFilters() {
 const box = $("filters"), sl = box.scrollLeft; box.innerHTML = "";
 const chip = (label, on, fn) => { const b = h("button", {type: "button", class: "fchip" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false"}, label); b.addEventListener("click", fn); box.append(b); };
 chip("🔍 Cerca", searchOpen || !!query, toggleSearch);
 chip("★ Salvati" + (saved.length ? " · " + saved.length : ""), savedView, () => { savedView = !savedView; showLimit = PAGE; render(); });
 if (!isHome()) {   // nella schermata principale servono solo ricerca e salvati
  chip("Solo patch", onlyPatch, () => setOnlyPatch(!onlyPatch));
  for (const l of Object.keys(LABEL_TXT)) chip(LABEL_TXT[l], labelFilter.has(l), () => { labelFilter.has(l) ? labelFilter.delete(l) : labelFilter.add(l); showLimit = PAGE; render(); });
 }
 box.scrollLeft = sl;
 $("searchbar").hidden = !(searchOpen || query);
}
function toggleSearch() {
 if (searchOpen || query) { searchOpen = false; query = ""; $("q").value = ""; }
 else { searchOpen = true; }
 showLimit = PAGE; render();
 if (searchOpen) $("q").focus();
}

/* Giocatori online: li legge il server (GitHub Action) e li pubblica in data/players.json; l'app non interroga più Steam attraverso proxy di terzi */
