/* ---------- Amministratore: modifica l'elenco giochi dall'app (serve un token GitHub) ---------- */
const ADMIN_KEY = "game_patch_radar_admin_v1";
let CFG = {};
let adminToken = "";
function loadAdmin() { try { adminToken = localStorage.getItem(ADMIN_KEY) || ""; } catch {} }
function repoName() {
 if (CFG.repo) return CFG.repo;
 const o = location.hostname.split(".")[0], r = location.pathname.split("/")[1];
 return o && r ? o + "/" + r : "";
}
async function gh(path, opt = {}) {
 const r = await fetch("https://api.github.com" + path, {...opt, headers: {Accept: "application/vnd.github+json", Authorization: "Bearer " + adminToken, "X-GitHub-Api-Version": "2022-11-28", ...(opt.headers || {})}});
 if (!r.ok) {
  let m = ""; try { m = (await r.json()).message; } catch {}
  if (r.status === 401) { adminToken = ""; try { localStorage.removeItem(ADMIN_KEY); } catch {} }  // token scaduto o revocato: non tenerlo
  const e = new Error(r.status === 401 ? "Token non valido o scaduto." : (r.status === 403 || r.status === 404) ? "Il token non ha accesso a questo repository (serve il permesso «Contents: Read and write»)." : (m || "Errore GitHub " + r.status));
  e.status = r.status; throw e;
 }
 return r.json();
}
const b64d = t => decodeURIComponent(escape(atob(t.replace(/\n/g, ""))));
const b64e = t => btoa(unescape(encodeURIComponent(t)));
async function editFile(path, mutate, msg) {
 for (let i = 0; i < 2; i++) {
  const f = await gh("/repos/" + repoName() + "/contents/" + path);
  const out = mutate(JSON.parse(b64d(f.content)));
  try {
   await gh("/repos/" + repoName() + "/contents/" + path, {method: "PUT", body: JSON.stringify({message: msg, content: b64e(JSON.stringify(out, null, 2) + "\n"), sha: f.sha})});
   return out;
  } catch (e) { if ((e.status !== 409 && e.status !== 422) || i) throw e; }
 }
}
function h(tag, props, ...kids) {
 const el = document.createElement(tag);
 for (const [k, v] of Object.entries(props || {})) { if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v); }
 for (const kid of kids) el.append(kid && kid.nodeType ? kid : document.createTextNode(kid == null ? "" : kid));
 return el;
}
function parseAppId(text) {
 const m = String(text).match(/store\.steampowered\.com\/app\/(\d+)/i) || String(text).trim().match(/^(\d{2,9})$/);
 return m ? Number(m[1]) : null;
}
