/* ---------- Rete: prova diretto e più proxy CORS, ricordando quello che funziona ---------- */
const ROUTES = [
 u => u,
 u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
 u => "https://proxy.cors.dev/" + u,
 u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
 u => "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u)
];
let routePref = 0;
async function fetchJSON(target, valid, timeout = 10000, maxTries = ROUTES.length) {
 let lastErr;
 const order = ROUTES.map((_, i) => i).sort((a, b) => a === routePref ? -1 : b === routePref ? 1 : a - b).slice(0, maxTries);
 for (const i of order) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
   const r = await fetch(ROUTES[i](target), {signal: ctrl.signal, cache: "no-store"});
   if (!r.ok) throw new Error("HTTP " + r.status);
   const d = await r.json();
   if (valid && !valid(d)) throw new Error("Risposta non valida");
   routePref = i; return d;
  } catch (e) { lastErr = e; }
  finally { clearTimeout(timer); }
 }
 throw lastErr || new Error("Connessione non riuscita");
}

/* ---------- Dati dal server (GitHub Actions) ---------- */
let snapshot = null;
async function loadSnapshot() {
 if (location.protocol === "file:") return null;
 try {
  const [r, pr, pp] = await Promise.all([fetch("data/news.json?t=" + Date.now(), {cache: "no-store"}), fetch("data/players.json?t=" + Date.now(), {cache: "no-store"}).catch(() => null), fetch("data/prices.json?t=" + Date.now(), {cache: "no-store"}).catch(() => null)]);
  if (!r.ok) return null;
  const d = await r.json();
  if (!d || !Array.isArray(d.games)) return null;
  try {   // giocatori online (file a parte): se manca o è rotto, semplicemente non si mostrano
   const pl = pr && pr.ok ? (await pr.json()).games || {} : {};
   for (const g of d.games) g.players = pl[String(g.appid)] || null;
  } catch {}
  try {   // storico prezzi (file a parte): il minimo registrato; se manca o è rotto, non si mostra
   const pm = pp && pp.ok ? (await pp.json()).games || {} : {};
   for (const g of d.games) { const m = (pm[String(g.appid)] || {}).min; g.pmin = m && Number.isFinite(m.c) ? {cents: m.c, final: String(m.f || ""), ts: m.ts || 0} : null; }
  } catch {}
  return d;
 } catch { return null; }
}
function prepare(items) {
 const list = items.map(it => ({...it}));
 for (const it of list) it.truncated = ELLIPSIS.test((it.contents || "").trim());
 return list;
}

/* ---------- Recupero annunci ---------- */
/* ---------- Traduzione (Google Translate gratuito, fallback MyMemory) ---------- */
function splitChunks(text, max) {
 const out = []; let cur = "";
 const push = s => { if (s) out.push(s); };
 for (const para of text.split("\n")) {
  if (para.length > max) {
   push(cur); cur = "";
   let buf = "";
   for (let s of para.split(/(?<=[.!?])\s+/)) {
    while (s.length > max) { push(buf); buf = ""; push(s.slice(0, max)); s = s.slice(max); }
    if ((buf ? buf.length + 1 : 0) + s.length > max) { push(buf); buf = s; }
    else buf = buf ? buf + " " + s : s;
   }
   push(buf);
   continue;
  }
  if (cur && (cur.length + 1 + para.length) > max) { push(cur); cur = para; }
  else cur = cur ? cur + "\n" + para : para;
 }
 push(cur);
 return out;
}
async function googleTranslate(text) {
 const body = new URLSearchParams({client: "gtx", sl: "auto", tl: "it", dt: "t", q: text});
 const r = await fetch("https://translate.googleapis.com/translate_a/single", {method: "POST", body});
 if (!r.ok) throw new Error("Google HTTP " + r.status);
 const data = await r.json();
 if (!Array.isArray(data?.[0])) throw new Error("Risposta Google non valida");
 return data[0].map(x => x[0] || "").join("");
}
async function myMemoryTranslate(text) {
 const parts = splitChunks(text, 450), out = [];
 for (const p of parts) {
  const r = await fetch("https://api.mymemory.translated.net/get?langpair=" + encodeURIComponent("en|it") + "&q=" + encodeURIComponent(p));
  if (!r.ok) throw new Error("MyMemory HTTP " + r.status);
  const d = await r.json();
  if (d.responseStatus && Number(d.responseStatus) !== 200) throw new Error(d.responseDetails || "MyMemory errore");
  out.push(d.responseData.translatedText);
 }
 return out.join("\n");
}
async function translateChunk(text) {
 if (!text.trim()) return text;
 try { return await googleTranslate(text); }
 catch { return await myMemoryTranslate(text); }
}
async function translateItem(item, onProgress) {
 const key = itemKey(item);
 if (item.it && item.it.text) return (trCache[key] = {title: item.it.title || item.title, text: item.it.text, src: "gemini"});
 if (trCache[key]) return trCache[key];
 const chunks = splitChunks(fullText(item), 1800);
 const out = new Array(chunks.length);
 const total = chunks.length + 1; let next = 0, done = 0;
 const tick = () => { done++; if (onProgress) onProgress(done / total); };
 const titleP = translateChunk(item.title || "").then(t => { tick(); return t; });
 const worker = async () => { while (next < chunks.length) { const i = next++; out[i] = await translateChunk(chunks[i]); tick(); } };
 const [title] = await Promise.all([titleP, worker(), worker(), worker()]);
 trCache[key] = {title, text: out.join("\n")};
 save();
 return trCache[key];
}
async function toggleTranslate(item, btn) {
 const key = itemKey(item);
 if (showIt[key]) { showIt[key] = false; refreshViews(); return; }
 if (btn) { btn.disabled = true; btn.textContent = "⏳ Traduzione…"; }
 try {
  await translateItem(item, p => { if (btn) btn.textContent = "⏳ " + Math.round(p * 100) + "%"; });
  showIt[key] = true;
 } catch (e) {
  setStatus("Traduzione non riuscita: " + e.message + ". Riprova tra poco.", "error");
 }
 refreshViews();
}
function refreshViews() { render(); if (viewerItem) renderViewer(); }

