/* ---------- Salvataggio locale (opzionale, mai bloccante) ---------- */
function persistable() {
 const c = {}; for (const [k, v] of Object.entries(cache)) c[k] = v.slice(0, 20).map(({it, ...r}) => r);
 const tc = {}; for (const [k, v] of Object.entries(trCache)) if (v.src !== "gemini") tc[k] = v;
 return {cache: c, trCache: tc, games: Object.values(GAMES).map(g => ({appid: g.appid, name: g.name, image: g.image, price: g.price, pmin: g.pmin, watch: g.watch, target: g.target}))};
}
function save() {
 const d = persistable();
 try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); }
 catch { try { delete d.trCache; localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch {} }
}
function load() {
 try {
  const d = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  if (d && typeof d === "object") {
   // come per le altre letture: solo la forma giusta (save() fa slice() sugli elenchi e legge .src dalle traduzioni)
   if (d.cache && typeof d.cache === "object") for (const [k, v] of Object.entries(d.cache)) if (Array.isArray(v)) cache[k] = v.filter(x => x && typeof x === "object");
   if (d.trCache && typeof d.trCache === "object") for (const [k, v] of Object.entries(d.trCache)) if (v && typeof v === "object") trCache[k] = v;
   if (Array.isArray(d.games) && d.games.length) setGames(d.games);
  }
 } catch {}
}

/* ---------- Utilità ---------- */
function setStatus(message, type="") {
 $("status").className = "status " + type;
 $("status").textContent = message;
}
function dateLabel(unix) {
 try { return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(unix*1000)); }
 catch { return ""; }
}
function itemKey(item) { return String(item.gid || item.url || item.title) + ":" + (item.contents || "").length; }

/* Converte il BBCode/HTML di Steam in testo semplice, senza perdere contenuto. */
function plainText(input) {
 if (!input) return "";
 let s = String(input).replace(/\r/g, "");
 // Steam scrive le parentesi quadre vere con la barra («\[ESC]», «\[AMD] Fixed…»): sono testo dell'autore, non tag. Le metto da parte
 // (\u0001 = «[», \u0002 = «]») così nessuna regola le tocca, e le rimetto alla fine senza barra.
 s = s.replace(/\\\[/g, "\u0001").replace(/\\\]/g, "\u0002");
 s = s.replace(/\{STEAM_CLAN_(?:LOC_)?IMAGE\}\S*/g, "");
 s = s.replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, "");
 s = s.replace(/\[(?:previewyoutube|video|youtube)[^\]]*\][\s\S]*?\[\/(?:previewyoutube|video|youtube)\]/gi, "");
 s = s.replace(/\[url=([^\]]*)\]([\s\S]*?)\[\/url\]/gi, (m, u, t) => t.trim() || u);
 s = s.replace(/\[\/(?:h[1-6]|p)\]/gi, "\n\n");
 s = s.replace(/\[h[1-6](?:[= ][^\]]*)?\]/gi, "\n# ");
 s = s.replace(/\[p(?:[= ][^\]]*)?\]/gi, "\n");
 s = s.replace(/\[\*\]/g, "\n• ");
 s = s.replace(/\[\/?(?:list|olist|quote|code|table|tr|hr)(?:[= ][^\]]*)?\]/gi, "\n");
 s = s.replace(/\[\/?(?:b|i|u|strike|spoiler|noparse|url|td|th|expand|center|left|right|sub|sup|dynamiclink|carousel)(?:[= ][^\]]*)?\]/gi, "");
 // Tag che non conosciamo: le chiusure non sono mai testo e le aperture con attributi nemmeno ([dynamiclink href=…]).
 // Le parole tra parentesi quadre senza attributi ([AMD], [Fixed]) sono testo dell'autore e restano.
 s = s.replace(/\[\/[a-z0-9*]+\]/gi, "");
 s = s.replace(/\[[a-z][a-z0-9]*(?: [a-z-]+=[^\]]*|=[^\]]*)\]/gi, "");
 s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<\/?[a-z][^>]*>/gi, "");
 s = s.replace(/\u0001/g, "[").replace(/\u0002/g, "]");
 const ta = document.createElement("textarea"); ta.innerHTML = s; s = ta.value;
 return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function fullText(item) { return plainText(item.contents || ""); }
function renderRich(el, text) {
 el.innerHTML = ""; el.classList.add("rich");
 let ul = null;
 for (const raw of String(text).split("\n")) {
  const line = raw.trim();
  if (!line) { ul = null; continue; }
  const li = /^[•·]\s*(.*)$/.exec(line);
  if (li) {
   if (!ul) { ul = document.createElement("ul"); el.append(ul); }
   const e = document.createElement("li"); e.textContent = li[1]; ul.append(e); continue;
  }
  ul = null;
  const hd = /^#+\s*(.*)$/.exec(line);
  const e = document.createElement(hd ? "h4" : "p"); e.textContent = hd ? hd[1] : line; el.append(e);
 }
}
function versionOf(title) { const m = /\bv?(\d+(?:\.\d+){1,3}[a-z]?)\b/i.exec(title || ""); return m ? m[1] : ""; }
function coverImg(appid, cls, image, name) {
 const urls = (image ? [image] : []).concat(["https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/" + appid + "/header.jpg",
  "https://cdn.cloudflare.steamstatic.com/steam/apps/" + appid + "/header.jpg", "https://cdn.akamai.steamstatic.com/steam/apps/" + appid + "/header.jpg"]);
 const img = document.createElement("img"); img.className = cls; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
 let i = 0; img.src = urls[0];
 img.onerror = () => { i++; if (i < urls.length) img.src = urls[i]; else img.replaceWith(coverPlaceholder(appid, cls, name)); };
 return img;
}
function coverPlaceholder(appid, cls, name) {
 const words = String(name || "").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
 const ini = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
 const ph = document.createElement("div"); ph.className = cls + " ph"; ph.textContent = ini; ph.setAttribute("aria-hidden", "true");
 ph.style.background = "hsl(" + ((Number(appid) || 0) * 47 % 360) + " 38% 36%)";
 return ph;
}
async function shareItem(item, gameName) {
 const url = item.url || ""; const title = gameName + ": " + (item.title || "Aggiornamento");
 try {
  if (navigator.share) { await navigator.share({title, text: item.summary ? title + "\n" + item.summary : title, url}); return; }
  await navigator.clipboard.writeText(title + "\n" + url); toast("🔗 Link copiato");
 } catch (e) { if (e && e.name !== "AbortError") toast("Condivisione non riuscita"); }
}
function previewOf(text) {
 if (text.length <= PREVIEW_CHARS) return text;
 let cut = text.slice(0, PREVIEW_CHARS);
 const i = cut.lastIndexOf("\n");
 if (i > PREVIEW_CHARS * 0.5) cut = cut.slice(0, i);
 return cut.trimEnd() + "…";
}

