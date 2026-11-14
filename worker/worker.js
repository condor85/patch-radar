/* Ponte di amministrazione di Game Patch Radar (Cloudflare Worker).

   Permette di aggiungere o togliere giochi dall'app senza token GitHub sul telefono: il telefono conosce solo una
   password, il token GitHub resta qui, nei "Secrets" di Cloudflare.

   Variabili da configurare (vedi worker/README.md):
     ADMIN_PASSWORD  (secret)  password dell'amministratore, almeno 12 caratteri
     GITHUB_TOKEN    (secret)  token fine-grained con «Contents: Read and write» solo su questo repository
     REPO            (var)     es. condor85/patch-radar
     ALLOWED_ORIGIN  (var)     es. https://condor85.github.io   (solo origine, senza percorso)
     RL              (KV, facoltativo) tiene il conto dei tentativi di accesso sbagliati
     TEAM            (Durable Object, dichiarato in wrangler.toml) archivio privato della squadra: «Ci gioco» / «Mi interessa» */

const MAX_GAMES = 40;           // tetto ai giochi: protegge la durata del controllo orario
const MAX_BODY = 2048;          // byte accettati in una richiesta
const FAIL_LIMIT = 5;           // tentativi sbagliati prima del blocco temporaneo
const FAIL_WINDOW = 900;        // secondi di blocco (richiede il KV «RL»)
const MIN_PASSWORD = 12;
const BRANCH = "main";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* Confronto a tempo costante: si confrontano gli hash, che hanno sempre la stessa lunghezza. */
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(String(a))), crypto.subtle.digest("SHA-256", enc.encode(String(b)))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

function cleanName(s) {
  return String(s == null ? "" : s).replace(/[<>\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function parseAppId(v) {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : v;
  return Number.isInteger(n) && n > 0 && n <= 999999999 ? n : null;
}

/* Soglia di prezzo in euro: numero tra 0,01 e 10000 (anche scritto come testo con la virgola), 2 decimali. null se non valida. */
function parseTarget(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v.trim().replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 10000 ? Math.round(n * 100) / 100 : undefined;
}

function corsHeaders(env, origin) {
  const h = {"Vary": "Origin", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};
  if (origin && origin === env.ALLOWED_ORIGIN) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(env, origin, status, body) {
  return new Response(JSON.stringify(body), {status, headers: {...corsHeaders(env, origin), "Content-Type": "application/json; charset=utf-8"}});
}

/* ---------- Accesso ---------- */
async function failCount(env, ip) {
  if (!env.RL) return 0;
  try { return Number(await env.RL.get("f:" + ip)) || 0; } catch { return 0; }
}
async function addFail(env, ip) {
  if (!env.RL) return;
  try { await env.RL.put("f:" + ip, String((await failCount(env, ip)) + 1), {expirationTtl: FAIL_WINDOW}); } catch {}
}
async function clearFails(env, ip) {
  if (!env.RL) return;
  try { await env.RL.delete("f:" + ip); } catch {}
}

async function authenticate(request, env) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < MIN_PASSWORD || !env.GITHUB_TOKEN || !env.REPO || !env.ALLOWED_ORIGIN) {
    throw new HttpError(503, "Il ponte non è configurato correttamente.");
  }
  const ip = request.headers.get("CF-Connecting-IP") || "?";
  if ((await failCount(env, ip)) >= FAIL_LIMIT) throw new HttpError(429, "Troppi tentativi sbagliati. Riprova tra qualche minuto.");
  const m = /^Bearer (.{1,200})$/.exec(request.headers.get("Authorization") || "");
  if (!m || !(await sameSecret(m[1], env.ADMIN_PASSWORD))) {
    await addFail(env, ip);
    throw new HttpError(401, "Password errata.");
  }
  await clearFails(env, ip);
}

/* ---------- GitHub ---------- */
const bytesToB64 = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const b64ToBytes = t => Uint8Array.from(atob(t.replace(/\n/g, "")), c => c.charCodeAt(0));

async function gh(env, path, init = {}) {
  const r = await fetch("https://api.github.com/repos/" + env.REPO + path, {
    ...init,
    headers: {Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "patch-radar-bridge", Authorization: "Bearer " + env.GITHUB_TOKEN, "Content-Type": "application/json"},
    signal: AbortSignal.timeout(10000)
  });
  return r;
}

/* Legge un file JSON del repository, lo modifica con `mutate` e lo riscrive. Se nel frattempo il file è cambiato riprova. */
async function editJson(env, path, mutate, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await gh(env, "/contents/" + path + "?ref=" + BRANCH);
    if (!r.ok) throw new HttpError(502, "Il ponte non riesce a leggere il repository: controlla il token GitHub.");
    const f = await r.json();
    let current;
    try { current = JSON.parse(dec.decode(b64ToBytes(f.content))); } catch { throw new HttpError(502, "Il file " + path + " non è leggibile."); }
    const next = mutate(current);
    if (next === null) return {changed: false, data: current};
    const w = await gh(env, "/contents/" + path, {method: "PUT", body: JSON.stringify({message: "[app] " + message, branch: BRANCH, sha: f.sha, content: bytesToB64(enc.encode(JSON.stringify(next, null, 2) + "\n"))})});
    if (w.ok) return {changed: true, data: next};
    if (w.status !== 409 && w.status !== 422) throw new HttpError(502, "Il ponte non riesce a scrivere sul repository: controlla il token GitHub.");
  }
  throw new HttpError(409, "Il repository è stato modificato nel frattempo. Riprova.");
}

/* ---------- Steam ---------- */
async function steamJson(url) {
  let r;
  try { r = await fetch(url, {signal: AbortSignal.timeout(8000), headers: {"User-Agent": "patch-radar-bridge"}}); }
  catch { throw new HttpError(502, "Steam non risponde ora. Riprova tra poco."); }
  if (!r.ok) throw new HttpError(502, "Steam non risponde ora. Riprova tra poco.");
  try { return await r.json(); } catch { throw new HttpError(502, "Risposta di Steam non valida."); }
}

async function searchSteam(term) {
  const d = await steamJson("https://store.steampowered.com/api/storesearch/?term=" + encodeURIComponent(term) + "&l=italian&cc=IT");
  if (!d || !Array.isArray(d.items)) throw new HttpError(502, "Risposta di Steam non valida.");
  const out = [];
  for (const i of d.items) {
    const appid = parseAppId(i && i.id), name = cleanName(i && i.name);
    if (appid && name) out.push({appid, name});
    if (out.length >= 8) break;
  }
  return out;
}

/* Il nome non si fida mai del telefono: si legge da Steam, che conferma anche che l'appid esiste ed è un gioco. */
async function steamGame(appid) {
  const d = await steamJson("https://store.steampowered.com/api/appdetails?appids=" + appid + "&filters=basic&l=italian");
  const e = d && d[String(appid)];
  if (!e || !e.success || !e.data) throw new HttpError(422, "Su Steam non trovo un gioco con questo numero.");
  if (e.data.type !== "game") throw new HttpError(422, "Questo numero non è un gioco (è un contenuto aggiuntivo, un video o un programma).");
  const name = cleanName(e.data.name);
  if (!name) throw new HttpError(422, "Steam non indica il nome del gioco.");
  return {appid, name};
}

/* ---------- Azioni ---------- */
async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Richiesta troppo grande.");
  if (!text) return {};
  try { const o = JSON.parse(text); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; }
  catch { throw new HttpError(400, "Richiesta non valida."); }
}

const ACTIONS = {
  async "/login"() { return {ok: true}; },

  async "/search"(env, body) {
    const q = cleanName(body.q);
    if (q.length < 2 || q.length > 60) throw new HttpError(400, "Scrivi almeno due lettere del nome.");
    return {results: await searchSteam(q)};
  },

  async "/add"(env, body) {
    const appid = parseAppId(body.appid);
    if (!appid) throw new HttpError(400, "Numero app Steam non valido.");
    const game = await steamGame(appid);
    if (body.watch === true) {   // gioco «da tenere d'occhio»: solo patch importanti e avviso di prezzo
      const target = parseTarget(body.target);
      if (target === undefined) throw new HttpError(400, "Prezzo non valido: scrivi un importo in euro, per esempio 19,99.");
      game.watch = true;
      game.target = target;
    }
    let duplicate = false;
    const r = await editJson(env, "games.json", o => {
      const list = Array.isArray(o.games) ? o.games : [];
      if (list.some(x => Number(x.appid) === appid)) { duplicate = true; return null; }
      if (list.length >= MAX_GAMES) throw new HttpError(409, "Raggiunto il massimo di " + MAX_GAMES + " giochi: toglierne uno prima di aggiungerne altri.");
      return {...o, games: [...list, game]};
    }, "Aggiungi " + game.name);
    return {ok: true, added: !duplicate, game, count: (r.data.games || []).length};
  },

  /* Cambia lo stato «da tenere d'occhio» e la soglia di prezzo di un gioco già presente. */
  async "/watch"(env, body) {
    const appid = parseAppId(body.appid);
    if (!appid) throw new HttpError(400, "Numero app Steam non valido.");
    if (typeof body.watch !== "boolean") throw new HttpError(400, "Richiesta non valida.");
    const target = body.watch ? parseTarget(body.target) : null;
    if (target === undefined) throw new HttpError(400, "Prezzo non valido: scrivi un importo in euro, per esempio 19,99.");
    let found = false;
    await editJson(env, "games.json", o => {
      const list = Array.isArray(o.games) ? o.games : [];
      if (!list.some(x => Number(x.appid) === appid)) return null;
      found = true;
      return {...o, games: list.map(x => {
        if (Number(x.appid) !== appid) return x;
        const {watch, target: _t, ...rest} = x;
        return body.watch ? {...rest, watch: true, target} : rest;
      })};
    }, (body.watch ? "Osserva " : "Smetti di osservare ") + appid);
    if (!found) throw new HttpError(404, "Gioco non presente nell'app.");
    return {ok: true};
  },

  /* Stato del ponte: raggiungibile, token GitHub valido e quando scade (l'intestazione c'è solo per i token fine-grained). */
  async "/status"(env) {
    const r = await gh(env, "");
    const out = {ok: true, github: r.ok, repo: env.REPO, daysLeft: null, expires: null};
    if (!r.ok) { out.ok = false; out.error = r.status === 401 ? "Il token GitHub non è più valido." : "Il token GitHub non può leggere il repository."; return out; }
    const exp = r.headers.get("github-authentication-token-expiration");
    const t = exp ? Date.parse(exp.replace(" UTC", "Z").replace(" ", "T")) : NaN;
    if (Number.isFinite(t)) { out.expires = new Date(t).toISOString(); out.daysLeft = Math.floor((t - Date.now()) / 86400000); }
    try { out.canPush = !!(await r.json()).permissions?.push; } catch { out.canPush = null; }
    if (out.canPush === false) { out.ok = false; out.error = "Il token GitHub non può scrivere sul repository."; }
    return out;
  },

  async "/remove"(env, body) {
    const appid = parseAppId(body.appid);
    if (!appid) throw new HttpError(400, "Numero app Steam non valido.");
    await editJson(env, "games.json", o => {
      const list = Array.isArray(o.games) ? o.games : [];
      const hit = list.find(x => Number(x.appid) === appid);
      if (!hit) return null;
      if (list.length <= 1) throw new HttpError(409, "Deve restare almeno un gioco.");
      return {...o, games: list.filter(x => Number(x.appid) !== appid)};
    }, "Rimuovi " + appid);
    return {ok: true};
  },

  /* Nuovo argomento per le notifiche (se qualcuno scrive messaggi falsi sul vecchio). */
  async "/topic"(env) {
    const arr = new Uint8Array(6); crypto.getRandomValues(arr);
    const topic = "patch-radar-" + [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
    await editJson(env, "config.json", o => ({...o, ntfyTopic: topic}), "Nuovo argomento notifiche");
    return {ok: true, topic};
  }
};


/* ---------- Squadra: giochi che gli amici seguono o vorrebbero provare ----------
   I dati stanno in un Durable Object privato (non nel repository pubblico). Si entra con il «codice della squadra», che crea
   l'amministratore; ognuno sceglie un nome. Il codice non è una password forte: va bene per un gruppo di amici fidati. */
const TEAM_MAX_MEMBERS = 30;
const TEAM_MAX_GAMES = 200;
const TEAM_FAIL_LIMIT = 8;
const TEAM_FAIL_WINDOW = 900000;   // millisecondi
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const normCode = c => String(c == null ? "" : c).toLowerCase().replace(/[^a-z0-9]/g, "");
const KINDS = new Set(["play", "interest"]);

function newCode() {
  const a = new Uint8Array(12); crypto.getRandomValues(a);
  return [...a].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
const showCode = c => c.match(/.{1,4}/g).join("-");
async function sha(text) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function cleanMember(s) {
  const n = String(s == null ? "" : s).replace(/[<>\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
  if (n.length < 2) throw new HttpError(400, "Scrivi un nome di almeno due lettere.");
  return n;
}
const memberKey = n => n.toLocaleLowerCase("it-IT");

export class Team {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const reply = (status, body) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
    try { return reply(200, await this.run(await request.json())); }
    catch (e) {
      if (e instanceof HttpError) return reply(e.status, {error: e.message});
      return reply(500, {error: "Errore del servizio. Riprova."});
    }
  }

  async snapshot() {
    const members = (await this.state.storage.get("members")) || {};
    const votes = (await this.state.storage.get("votes")) || {};
    const out = {};
    for (const [appid, byKey] of Object.entries(votes)) {
      const row = {};
      for (const [k, kind] of Object.entries(byKey)) if (members[k]) row[members[k].name] = kind;
      if (Object.keys(row).length) out[appid] = row;
    }
    return {members: Object.values(members).map(m => m.name).sort((a, b) => a.localeCompare(b, "it")), votes: out};
  }

  async run(m) {
    const st = this.state.storage;
    if (m.op === "setup") {   // chiamata solo dal ponte, dopo la verifica della password dell'amministratore
      const code = newCode();
      await st.put("meta", {codeHash: await sha(code), created: Date.now()});
      await st.delete("fails");
      return {ok: true, code: showCode(code)};
    }
    const meta = await st.get("meta");
    if (!meta) throw new HttpError(404, "La squadra non è ancora stata creata: chiedi all'amministratore di creare il codice.");
    const now = Date.now(), fails = (await st.get("fails")) || {}, rec = fails[m.ip];
    const recent = rec && now - rec.t < TEAM_FAIL_WINDOW;
    if (recent && rec.n >= TEAM_FAIL_LIMIT) throw new HttpError(429, "Troppi tentativi sbagliati. Riprova tra qualche minuto.");
    if (!(await sameSecret(await sha(normCode(m.code)), meta.codeHash))) {
      for (const [ip, r] of Object.entries(fails)) if (now - r.t >= TEAM_FAIL_WINDOW) delete fails[ip];
      fails[m.ip] = {n: (recent ? rec.n : 0) + 1, t: now};
      await st.put("fails", fails);
      throw new HttpError(401, "Codice della squadra errato.");
    }
    if (rec) { delete fails[m.ip]; await st.put("fails", fails); }

    if (m.op === "state") return {ok: true, ...(await this.snapshot())};

    const members = (await st.get("members")) || {};
    if (m.op === "join") {
      const name = cleanMember(m.name), key = memberKey(name);
      if (!members[key] && Object.keys(members).length >= TEAM_MAX_MEMBERS) throw new HttpError(409, "La squadra è al completo.");
      members[key] = {name: members[key] ? members[key].name : name, ts: now};
      await st.put("members", members);
      return {ok: true, name: members[key].name, ...(await this.snapshot())};
    }
    if (m.op === "vote") {
      const key = memberKey(cleanMember(m.name));
      if (!members[key]) throw new HttpError(403, "Prima entra nella squadra con il tuo nome.");
      const appid = parseAppId(m.appid);
      if (!appid) throw new HttpError(400, "Numero app Steam non valido.");
      if (m.kind !== null && !KINDS.has(m.kind)) throw new HttpError(400, "Richiesta non valida.");
      const votes = (await st.get("votes")) || {};
      const row = votes[appid] || {};
      if (m.kind === null) delete row[key]; else row[key] = m.kind;
      if (Object.keys(row).length) {
        if (!votes[appid] && Object.keys(votes).length >= TEAM_MAX_GAMES) throw new HttpError(409, "Troppi giochi in squadra.");
        votes[appid] = row;
      } else delete votes[appid];
      await st.put("votes", votes);
      return {ok: true, ...(await this.snapshot())};
    }
    throw new HttpError(404, "Non trovato.");
  }
}

async function teamCall(env, op, request, body) {
  if (!env.TEAM) throw new HttpError(503, "La squadra non è attiva sul ponte: serve ripubblicare il ponte.");
  const m = /^Bearer (.{1,200})$/.exec(request.headers.get("Authorization") || "");
  const stub = env.TEAM.get(env.TEAM.idFromName("squadra"));
  const r = await stub.fetch("https://squadra.internal/" + op, {method: "POST", body: JSON.stringify({
    op, ip: request.headers.get("CF-Connecting-IP") || "?", code: m ? m[1] : "",
    name: body.name, appid: body.appid, kind: body.kind === undefined ? undefined : body.kind})});
  let d = {}; try { d = await r.json(); } catch {}
  return {status: r.status, body: d};
}
const TEAM_OPS = {"/team/state": "state", "/team/join": "join", "/team/vote": "vote"};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    try {
      if (origin && origin !== env.ALLOWED_ORIGIN) throw new HttpError(403, "Origine non consentita.");
      if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: corsHeaders(env, origin)});
      const path = new URL(request.url).pathname;
      if (Object.prototype.hasOwnProperty.call(TEAM_OPS, path) || path === "/team/setup") {
        if (request.method !== "POST") throw new HttpError(405, "Metodo non consentito.");
        const body = await readBody(request);
        if (path === "/team/setup") {   // crea (o cambia) il codice: solo l'amministratore
          await authenticate(request, env);
          if (!env.TEAM) throw new HttpError(503, "La squadra non è attiva sul ponte: serve ripubblicare il ponte.");
          const r = await env.TEAM.get(env.TEAM.idFromName("squadra")).fetch("https://squadra.internal/setup", {method: "POST", body: JSON.stringify({op: "setup"})});
          return json(env, origin, r.status, await r.json());
        }
        const r = await teamCall(env, TEAM_OPS[path], request, body);
        return json(env, origin, r.status, r.body);
      }
      const action = Object.prototype.hasOwnProperty.call(ACTIONS, path) ? ACTIONS[path] : null;
      if (!action) throw new HttpError(404, "Non trovato.");
      if (request.method !== "POST") throw new HttpError(405, "Metodo non consentito.");
      await authenticate(request, env);
      return json(env, origin, 200, await action(env, await readBody(request)));
    } catch (e) {
      if (e instanceof HttpError) return json(env, origin, e.status, {error: e.message});
      return json(env, origin, 500, {error: "Errore del servizio. Riprova."});   // nessun dettaglio interno verso l'esterno
    }
  }
};
