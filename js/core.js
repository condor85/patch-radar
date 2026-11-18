/* Se online c'è una versione più recente dell'app, la ricarica da sola (una volta sola per versione). */
(async () => {
 if (location.protocol === "file:") return;
 try {
  const t = await (await fetch("index.html", {cache: "no-store"})).text();
  const m = /const APP_VERSION = "([^"]+)"/.exec(t);
  if (m && m[1] !== APP_VERSION && sessionStorage.getItem("gpr_reload") !== m[1]) { sessionStorage.setItem("gpr_reload", m[1]); location.reload(); }
 } catch {}
})();
const DEFAULT_GAMES = [
 {appid: 892970, name: "Valheim"}, {appid: 1374490, name: "RuneScape: Dragonwilds"},
 {appid: 1203620, name: "Enshrouded"}, {appid: 3321460, name: "Crimson Desert"}
];
const PATCH_KEY = "game_patch_radar_onlypatch_v1";
let onlyPatch = false;
function loadPatchPref() { try { onlyPatch = localStorage.getItem(PATCH_KEY) === "1"; } catch {} }
function setOnlyPatch(v) { onlyPatch = v; try { localStorage.setItem(PATCH_KEY, v ? "1" : "0"); } catch {} showLimit = PAGE; render(); }
/* Il server (GitHub Action) classifica già ogni annuncio; il calcolo qui sotto serve solo per i dati scaricati direttamente da Steam. */
function isPatchItem(it) {
 if (typeof it.patch === "boolean") return it.patch;
 if ((it.tags || []).includes("patchnotes")) return true;
 const t = (it.title || "").toLowerCase();
 if (/patch|hotfix|hot fix|update|changelog|release notes|\bfix(es)?\b|\bv?\d+\.\d+|\bbuild \d+|aggiornamento/.test(t)) return true;
 if (/\bsale\b|saldi|giveaway|livestream|\bstream\b|festival|discount|soundtrack|merch|wallpaper|contest|competition|spotlight|\bevent\b|meetup/.test(t)) return false;
 return /patch notes|changelog|bug ?fix/.test((it.contents || "").toLowerCase().slice(0, 3000));
}
const HIDDEN_KEY = "game_patch_radar_hidden_v1";
let GAMES = {};          // appid (stringa) -> {name, appid, store}
let ORDER = [];           // ordine dei giochi (le chiavi numeriche di un oggetto verrebbero riordinate)
let hidden = [];         // giochi nascosti su questo dispositivo
/* Un elenco di giochi può arrivare dal sito, dal browser (dati salvati, possono essere vecchi o rovinati) o dal ponte: si tengono solo le voci con un numero app Steam valido,
   perché l'appid entra negli indirizzi (pagina del negozio, argomenti delle notifiche). */
const validAppId = v => (typeof v === "number" || (typeof v === "string" && /^\d{1,9}$/.test(v))) && Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) <= 999999999;
function setGames(list) {
 if (!Array.isArray(list)) return;
 const input = list;
 list = input.filter(x => x && typeof x === "object" && validAppId(x.appid)).map(x => ({...x, appid: Number(x.appid)}));
 if (input.length && !list.length) return;   // tutte le voci rovinate: meglio tenere l'elenco che c'è che restare senza giochi
 const g = {};
 for (const x of list) {
  const k = String(x.appid);
  g[k] = {name: x.name || ("Gioco " + k), appid: x.appid, image: x.image || "", price: x.price || null, players: x.players || null, pmin: x.pmin || null, watch: x.watch === true, target: typeof x.target === "number" ? x.target : null, store: "https://store.steampowered.com/app/" + x.appid + "/"};
 }
 GAMES = g; ORDER = list.map(x => String(x.appid)).filter((k, i, a) => a.indexOf(k) === i);
}
function visibleKeys() { const v = ORDER.filter(k => !hidden.includes(k)); return v.length ? v : ORDER; }
function ensureSelected() { const v = visibleKeys(); if (!v.includes(selected)) selected = v[0]; }
/* Quello che sta in localStorage non è mai da dare per buono: un valore leggibile ma di forma sbagliata (un oggetto al posto di un elenco)
   farebbe fallire .includes() all'avvio e l'app resterebbe bianca. Qui si tiene solo ciò che ha la forma giusta. */
function loadHidden() { try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"); hidden = Array.isArray(v) ? v.map(String).filter(k => /^\d{1,9}$/.test(k)) : []; } catch { hidden = []; } }
function saveHidden() { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)); } catch {} }
setGames(DEFAULT_GAMES);
const PENDING_KEY = "game_patch_radar_pending_v1";
let pending = {add: [], remove: [], watch: []};
function loadPending() {
 try {
  const v = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
  if (v && typeof v === "object" && !Array.isArray(v)) { const list = a => Array.isArray(a) ? a.filter(x => x && typeof x === "object") : []; pending = {add: list(v.add), remove: list(v.remove), watch: list(v.watch)}; }
 } catch {}
}
function savePending() { try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch {} }
function applyPending(list) {
 const now = Date.now(), has = new Set(list.map(g => String(g.appid)));
 pending.add = (pending.add || []).filter(g => now - g.ts < 20 * 60000 && !has.has(String(g.appid)));
 pending.remove = (pending.remove || []).filter(g => now - g.ts < 20 * 60000 && has.has(String(g.id)));
 // cambi di «da osservare» fatti da qui: restano validi finché il sito non li ha ripubblicati
 const sameWatch = (g, w) => (g.watch === true) === w.watch && (w.watch ? (g.target ?? null) === (w.target ?? null) : true);
 pending.watch = (pending.watch || []).filter(w => now - w.ts < 20 * 60000 && list.some(g => String(g.appid) === String(w.id) && !sameWatch(g, w)));
 savePending();
 const gone = new Set(pending.remove.map(g => String(g.id)));
 const ww = new Map(pending.watch.map(w => [String(w.id), w]));
 return list.filter(g => !gone.has(String(g.appid))).map(g => { const w = ww.get(String(g.appid)); return w ? {...g, watch: w.watch, target: w.watch ? w.target : null} : g; })
  .concat(pending.add.map(g => ({appid: g.appid, name: g.name, image: "", watch: g.watch === true, target: g.target ?? null})));
}
function currentList() { return ORDER.map(k => ({appid: GAMES[k].appid, name: GAMES[k].name, image: GAMES[k].image, price: GAMES[k].price, players: GAMES[k].players, pmin: GAMES[k].pmin, watch: GAMES[k].watch, target: GAMES[k].target})); }
const STORE_KEY = "game_patch_radar_v3";
const REFRESH_MS = 30 * 60 * 1000;
const PREVIEW_CHARS = 450;
const ELLIPSIS = /(\.\.\.|…)\s*$/;

let selected = "892970";
let home = true;            // schermata principale (ultima patch di ogni gioco): è quella che si apre all'avvio
const isHome = () => home && !crossGame();
let lastRefresh = 0;
const PAGE = 20;
let showLimit = PAGE;       // quante schede mostrare
let query = "";             // testo cercato (cerca in tutti i giochi)
let searchOpen = false;
let savedView = false;      // mostra solo le patch salvate
const labelFilter = new Set();
const cache = {};      // gioco -> [annunci]
const trCache = {};    // chiave annuncio -> {title, text}
const showIt = {};     // chiave -> mostra italiano
const $ = id => document.getElementById(id);

