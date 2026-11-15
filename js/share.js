/* PATCH-SHARE:start */
/* Condividi da Steam: la pagina del gioco si condivide verso «Patch Radar» (share_target in manifest.webmanifest) e arriva come ?title=&text=&url=.
   Dal testo condiviso si prende solo il numero dell'app (mai il resto): è l'unico dato che finisce nel ponte. */
function sharedGame(search) {
 let p; try { p = new URLSearchParams(search); } catch { return null; }
 const parts = ["url", "text", "title"].map(k => String(p.get(k) || "").slice(0, 600));
 let appid = null;
 for (const t of parts) { const m = t.match(/store\.steampowered\.com\/app\/(\d{1,9})/i); if (m) { appid = Number(m[1]); break; } }
 if (!appid) return p.has("url") || p.has("text") || p.has("title") ? {appid: null, name: ""} : null;
 const name = (p.get("title") || parts[1].replace(/https?:\/\/\S+/g, "")).replace(/\s+(on|su) Steam\s*$/i, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
 return {appid, name};
}
/* PATCH-SHARE:end */
