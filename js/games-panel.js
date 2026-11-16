/* ---------- Elenco dei giochi: barra compatta e pannello «Giochi» ---------- */
/* Con pochi giochi la barra in alto li mostra tutti. Oltre BAR_ALL_MAX non si scorre più di lato: nella barra restano Home, il pulsante «Giochi»,
   il gioco aperto e il gioco con più novità (BAR_NEWS_MAX); il pulsante apre l'elenco completo, con ricerca e ordinamento. */
const BAR_ALL_MAX = 5, BAR_NEWS_MAX = 1;
const GSORT_KEY = "game_patch_radar_gamesort_v1";
const GSORTS = [["new", "Novità"], ["recent", "Ultima patch"], ["name", "A–Z"]];
let gameSort = "new";
let gameFilter = "";
function loadGameSort() { try { const v = localStorage.getItem(GSORT_KEY); if (GSORTS.some(s => s[0] === v)) gameSort = v; } catch {} }
loadGameSort();

/* Righe {key, name, news, last}: news = novità non lette, last = data (secondi) dell'ultima patch. */
function gameRows() {
 return visibleKeys().map(k => { const it = latestOf(k); return {key: k, name: GAMES[k].name, news: newItems(k).length, last: it ? it.date || 0 : 0}; });
}
/* «new»: prima chi ha novità (più novità prima); «recent»: ultima patch più recente prima; «name»: A–Z. A parità resta l'ordine dell'elenco. */
function sortGameRows(rows, mode) {
 const by = {
  new: (a, b) => b.news - a.news,
  recent: (a, b) => b.last - a.last,
  name: (a, b) => a.name.localeCompare(b.name, "it", {sensitivity: "base"})
 }[mode] || (() => 0);
 return rows.map((r, i) => [r, i]).sort((a, b) => by(a[0], b[0]) || a[1] - b[1]).map(x => x[0]);
}
/* Quali giochi stanno nella barra (righe già ordinate con «new»). */
function barGameKeys(rows, selectedKey, onHome) {
 if (rows.length <= BAR_ALL_MAX) return rows.map(r => r.key);
 const cur = onHome ? null : rows.find(r => r.key === selectedKey);
 const out = cur ? [cur.key] : [];
 for (const r of rows) {
  if (out.length >= BAR_NEWS_MAX + (cur ? 1 : 0)) break;
  if (r.news && !out.includes(r.key)) out.push(r.key);
 }
 return out;
}
function filterGameRows(rows, text) {
 const q = norm(text).trim();
 return q ? rows.filter(r => norm(r.name).includes(q)) : rows;
}

function openGamesPanel() {
 gameFilter = "";
 const body = $("gpBody"); body.innerHTML = "";
 const n = visibleKeys().length;
 const seg = h("div", {class: "seg", role: "group", "aria-label": "Ordina i giochi"});
 const input = h("input", {type: "search", id: "gpQ", placeholder: "Cerca un gioco…", autocomplete: "off", enterkeyhint: "search", "aria-label": "Cerca un gioco",
  oninput: () => { gameFilter = input.value; fillGamesGrid(); }});
 for (const [mode, label] of GSORTS) {
  const b = h("button", {type: "button", class: "abtn" + (mode === gameSort ? " on" : ""), "aria-pressed": mode === gameSort ? "true" : "false",
   onclick: () => {
    gameSort = mode; try { localStorage.setItem(GSORT_KEY, mode); } catch {}
    for (const x of seg.children) { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on ? "true" : "false"); }
    fillGamesGrid(); renderNav();
   }}, label);
  seg.append(b);
 }
 body.append(h("h2", {}, "Giochi"), h("p", {class: "v-note", style: "margin-top:0"}, n + (n === 1 ? " gioco seguito" : " giochi seguiti") + ". Tocca un gioco per aprirlo."),
  h("div", {class: "gp-tools"}, input), h("div", {class: "gp-sort"}, h("span", {class: "v-note", style: "margin:0"}, "Ordina per"), seg), h("div", {class: "gp-grid", id: "gpGrid"}));
 fillGamesGrid();
 openOv("gamesPanel");
 $("gpBody").parentNode.scrollTop = 0;
}
function fillGamesGrid() {
 const grid = $("gpGrid"); if (!grid) return;
 grid.innerHTML = "";
 const rows = filterGameRows(sortGameRows(gameRows(), gameSort), gameFilter);
 if (!rows.length) { grid.append(h("div", {class: "empty", style: "grid-column:1/-1"}, "Nessun gioco con «" + gameFilter.trim() + "».")); return; }
 for (const r of rows) {
  const g = GAMES[r.key], current = r.key === selected && !home;
  const sub = r.news ? h("span", {class: "newtxt"}, r.news + (r.news === 1 ? " nuovo" : " nuovi")) : h("span", {class: "gp-sub"}, r.last ? "Patch " + agoLabel(r.last) : "Nessun dato");
  const b = h("button", {type: "button", class: "gp-item" + (r.news ? " has-new" : "") + (current ? " active" : ""), ...(current ? {"aria-current": "true"} : {}),
   onclick: () => { closeOv("gamesPanel"); selectGame(r.key); }},
   coverImg(g.appid, "gp-cover", g.image, g.name), h("span", {class: "gp-name"}, g.name + (g.watch ? " 👁" : "")), sub);
  grid.append(b);
 }
}
$("gpClose").addEventListener("click", () => closeOv("gamesPanel"));
