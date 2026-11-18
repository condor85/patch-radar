#!/usr/bin/env python3
"""Scarica gli annunci Steam dei giochi e li salva in data/news.json.

Le notifiche ntfy NON partono durante il controllo: vengono accodate in outbox.json e inviate dal passo successivo
(`python3 scripts/fetch_news.py --send`) solo dopo che i dati sono stati salvati nel repository. Così, se il salvataggio
fallisce, la volta dopo gli stessi annunci risultano ancora nuovi e nessuna notifica viene mandata due volte."""
import base64, contextlib, datetime, json, os, re, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ed25519  # noqa: E402
from patch_rules import (KEYWORD_GROUPS, LABEL_RULES, MAJOR_TITLE_RE, NEWS_TITLE, SHARED, STRONG_TITLE, VERSION_TITLE,  # noqa: E402, F401
                         classify, is_major, is_patch, keywords_of, labels_of, strip_markup, structured_lines)

API = os.environ.get("STEAM_API_BASE", "https://api.steampowered.com")
STORE = os.environ.get("STEAM_STORE_BASE", "https://store.steampowered.com")
def _topic():
    """Argomento ntfy. La fonte di verità è config.json: è quello che legge l'app e che «Cambia argomento» aggiorna.
    Il secret NTFY_TOPIC vale solo come ripiego; se avesse la precedenza, dopo il cambio le notifiche partirebbero
    su un argomento a cui nessuno è più iscritto."""
    try:
        with open("config.json", encoding="utf-8") as f:
            t = str(json.load(f).get("ntfyTopic", "")).strip()
        if t:
            return t
    except Exception:  # noqa
        pass
    return os.environ.get("NTFY_TOPIC", "").strip()


NTFY_TOPIC = _topic()
NTFY_URL = os.environ.get("NTFY_URL", "https://ntfy.sh")
SITE_URL = os.environ.get("SITE_URL", "")
OUT = "data/news.json"
PLAYERS_OUT = "data/players.json"        # giocatori online: file a parte, così news.json cambia solo quando ci sono novità vere
OUTBOX = os.environ.get("OUTBOX_FILE", "outbox.json")
PRICES_OUT = "data/prices.json"          # storico prezzi: file a parte, cambia solo quando un prezzo varia
PRICE_HISTORY_MAX = 60                   # variazioni di prezzo conservate per gioco
PLAYERS_MAX_AGE = 6 * 3600              # il numero si aggiorna se cambia di almeno il 10% o dopo questo tempo


SIGN_VERSION = SHARED["signVersion"]
KEEP =("gid", "title", "url", "contents", "date", "feedlabel", "feedname", "author", "tags")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_BASE = os.environ.get("GEMINI_BASE", "https://generativelanguage.googleapis.com/v1beta/models")
GEMINI_FALLBACK = ["gemini-flash-latest", "gemini-2.5-flash"]
_models_cache = []


def gemini_models():
    """Modelli da provare: quello scelto a mano, poi i «flash» più recenti che Google elenca per questa chiave."""
    if _models_cache:
        return _models_cache
    found = []
    try:
        d = json.loads(http(f"{GEMINI_BASE}?pageSize=200", headers={"x-goog-api-key": GEMINI_KEY}, retries=2))
        for m in d.get("models", []):
            name = m.get("name", "").split("/")[-1]
            if "generateContent" not in m.get("supportedGenerationMethods", []) or "flash" not in name:
                continue
            if any(x in name for x in ("lite", "image", "tts", "live", "audio", "embedding", "thinking", "exp", "vision", "robotics", "computer", "native")):
                continue
            ver = tuple(int(x) for x in re.findall(r"\d+", name)) or (0,)
            found.append((ver, "preview" not in name, name))
        found.sort(reverse=True)
        print("modelli Gemini trovati: " + ", ".join(n for _, _, n in found[:5]), file=sys.stderr)
    except Exception as e:  # noqa
        print(f"  elenco modelli Gemini non disponibile ({str(e)[:150]})", file=sys.stderr)
    chosen = [os.environ.get("GEMINI_MODEL", "").strip()] + [n for _, _, n in found[:3]] + GEMINI_FALLBACK
    _models_cache.extend(m for i, m in enumerate(chosen) if m and m not in chosen[:i])
    return _models_cache
MAX_SUMMARIES = int(os.environ.get("MAX_SUMMARIES", "8"))
TRANSLATE_BUDGET = int(os.environ.get("TRANSLATE_BUDGET", "3"))
ELLIPSIS = re.compile(r"(\.\.\.|…)\s*$")
HISTORY_MAX = int(os.environ.get("HISTORY_MAX", "60"))   # annunci conservati per gioco (Steam ne restituisce solo 20)
DIGEST_HOUR = int(os.environ.get("DIGEST_HOUR", "18"))   # ora italiana del riepilogo serale
TZ = ZoneInfo("Europe/Rome")


MAX_RESPONSE = 16 * 1024 * 1024   # byte: una risposta più grande non è una pagina di note, e non deve riempire la memoria dell'Action


def read_limited(resp, limit=MAX_RESPONSE):
    """Legge una risposta HTTP rifiutando quelle oltre `limit` byte."""
    body = resp.read(limit + 1)
    if len(body) > limit:
        raise ValueError(f"risposta troppo grande (oltre {limit // (1024 * 1024)} MB)")
    return body


def http(url, data=None, headers=None, retries=3):
    # urllib aprirebbe anche file:// e ftp://: gli indirizzi qui arrivano da costanti o variabili d'ambiente, ma si ammettono solo http(s)
    if not str(url).lower().startswith(("https://", "http://")):
        raise ValueError("indirizzo non consentito: serve http o https")
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "patch-radar/1.0", **(headers or {})})
            with urllib.request.urlopen(req, timeout=30) as r:
                return read_limited(r)
        except Exception as e:  # noqa
            last = e
            if i < retries - 1:  # dopo l'ultimo tentativo è inutile aspettare
                time.sleep(2 * (i + 1))
    raise last


def write_json_atomic(path, obj, **kwargs):
    """Scrive un file JSON in modo atomico: prima su un file temporaneo accanto, poi lo rinomina. Se il processo viene
    interrotto a metà, il file vero resta quello di prima invece di restare a metà (e di essere poi committato così)."""
    folder = os.path.dirname(path) or "."
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, **kwargs)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.remove(tmp)
        raise


def read_json_strict(path, default):
    """Legge un file JSON che contiene dati non rigenerabili (storico degli annunci, prezzo minimo).
    Se manca, è la prima esecuzione e si parte da `default`. Se esiste ma non si legge, si ferma con un errore chiaro:
    ripartire da zero cancellerebbe in silenzio lo storico e salterebbe tutte le notifiche (sembrerebbe una «prima raccolta»)."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as e:
        print(f"::error file={path}::{path} esiste ma non è leggibile ({e}). Non lo sovrascrivo: ripristina l'ultima versione buona dalla cronologia di Git.")
        sys.exit(1)


def get_json(url):
    return json.loads(http(url))


def truncated(item):
    return bool(ELLIPSIS.search((item.get("contents") or "").strip()))


def fetch_game(appid):
    base = f"{API}/ISteamNews/GetNewsForApp/v2/?appid={appid}&count=20&maxlength=0"
    items = get_json(base + "&feeds=steam_community_announcements")["appnews"]["newsitems"]
    if not items:
        items = get_json(base)["appnews"]["newsitems"]
    items.sort(key=lambda x: x.get("date", 0), reverse=True)
    if any(truncated(i) for i in items):
        try:
            ev = get_json(f"{STORE}/events/ajaxgetadjacentpartnerevents/?appid={appid}&count_before=0&count_after=40&l=english")["events"]
            for it in items:
                if not truncated(it):
                    continue
                for e in ev:
                    ab = e.get("announcement_body") or {}
                    if str(e.get("gid")) == str(it["gid"]) or str(ab.get("gid")) == str(it["gid"]) or (ab.get("headline") or e.get("event_name")) == it.get("title"):
                        body = ab.get("body") or ""
                        if len(body) > len(it.get("contents") or ""):
                            it["contents"] = body
                        break
        except Exception as e:  # noqa
            print(f"  (testo completo non recuperato: {e})", file=sys.stderr)
    return [{k: it.get(k) for k in KEEP} for it in items]


def load_games():
    """Legge games.json: [{"appid": 123, "name": "Facoltativo"}, ...]"""
    with open("games.json", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("games", []), list):
        raise ValueError('il file deve essere del tipo {"games": [{"appid": 123}, ...]}')
    out, seen = [], set()
    for g in data.get("games", []):
        if not isinstance(g, dict):
            print(f"voce ignorata in games.json: {g}", file=sys.stderr)
            continue
        try:
            appid = int(g["appid"])
        except Exception:  # noqa
            print(f"voce ignorata in games.json: {g}", file=sys.stderr)
            continue
        if appid in seen:
            continue
        seen.add(appid)
        entry = {"appid": appid, "name": (g.get("name") or "").strip()}
        if g.get("watch") is True:  # gioco «da tenere d'occhio»: solo patch importanti e avviso di prezzo
            entry["watch"] = True
            entry["target"] = clean_target(g.get("target"))
        out.append(entry)
    return out


def clean_target(v):
    """Soglia di prezzo in euro (numero positivo, 2 decimali) oppure None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not (0 < v <= 10000):
        return None
    return round(float(v), 2)


def _language_names(html):
    """Nomi delle lingue da `supported_languages` (HTML: «English<strong>*</strong>, Italian, …»), in minuscolo."""
    text = re.sub(r"<[^>]*>", "", re.sub(r"<br\s*/?>", ",", html or "", flags=re.I))   # il <br> separa l'ultima lingua dalla nota sull'audio
    return {p.strip(" *\t\r\n").lower() for p in re.split(r"[,\n]", text)} - {""}


def store_facts(data):
    """Dati della scheda Steam che il «diario del gioco» confronta nel tempo: `it` (c'è l'italiano), `ea` (accesso anticipato),
    `dlc` (quanti DLC). Un dato che Steam non fornisce non compare: così «sconosciuto» non si scambia per «è cambiato»."""
    f = {}
    if isinstance(data.get("supported_languages"), str):
        f["it"] = "italian" in _language_names(data["supported_languages"])
    if isinstance(data.get("genres"), list):
        f["ea"] = any(isinstance(x, dict) and str(x.get("id")) == "70" for x in data["genres"])   # 70 = «Accesso anticipato»
    if data.get("type"):
        dlc = data.get("dlc")
        f["dlc"] = len(dlc) if isinstance(dlc, list) else 0
    return f


def facts_changes(old, new):
    """Novità della scheda rispetto alla volta prima, come lista di (titolo, messaggio). Solo cambi certi:
    se un dato manca da una delle due parti non si segnala nulla."""
    out = []
    if old.get("it") is False and new.get("it") is True:
        out.append(("ora in italiano", "Su Steam il gioco risulta ora disponibile in italiano."))
    if old.get("ea") is True and new.get("ea") is False:
        out.append(("esce dall'accesso anticipato", "Il gioco non è più in accesso anticipato su Steam."))
    o, n = old.get("dlc"), new.get("dlc")
    if isinstance(o, int) and isinstance(n, int) and n > o:
        out.append(("nuovo DLC" if n - o == 1 else f"{n - o} nuovi DLC", "È comparso un nuovo contenuto aggiuntivo nella pagina Steam del gioco." if n - o == 1 else "Sono comparsi nuovi contenuti aggiuntivi nella pagina Steam del gioco."))
    return out


def store_details(appid):
    """Nome, copertina ufficiale, prezzo e dati della scheda dal negozio Steam (prezzi in euro). Alza un'eccezione se non disponibile."""
    d = get_json(f"{STORE}/api/appdetails?appids={appid}&filters=basic,price_overview,genres&cc=it&l=english")[str(appid)]
    if not d.get("success"):
        raise RuntimeError("scheda non disponibile")
    data = d["data"]
    po = data.get("price_overview")
    price = None
    if po:
        price = {"final": po.get("final_formatted") or "", "initial": po.get("initial_formatted") or "", "discount": int(po.get("discount_percent") or 0)}
        if isinstance(po.get("final"), int) and not isinstance(po.get("final"), bool):
            price["cents"] = po["final"]
    return {"name": data.get("name", ""), "image": data.get("header_image", ""), "price": price, "facts": store_facts(data)}


def current_players(appid):
    d = get_json(f"{API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid={appid}")
    n = d["response"]["player_count"]
    if isinstance(n, bool) or not isinstance(n, int) or n < 0:
        raise ValueError("numero di giocatori non valido")
    return n


def update_players(games, now):
    """Giocatori online per gioco, in data/players.json. Il valore cambia solo se è variato di almeno il 10% (o dopo qualche ora),
    così il repository non riceve un commit a ogni controllo per un numero che oscilla di continuo.
    Così l'app non deve più interrogare Steam attraverso servizi di terzi. Ritorna True se il file è cambiato."""
    try:
        with open(PLAYERS_OUT, encoding="utf-8") as f:
            prev = json.load(f).get("games", {})
        if not isinstance(prev, dict):
            prev = {}
    except Exception:  # noqa
        prev = {}
    out = {}
    for g in games:
        k = str(g["appid"])
        old = prev.get(k) if isinstance(prev.get(k), dict) and isinstance(prev[k].get("n"), int) else None
        try:
            n = current_players(g["appid"])
        except Exception as e:  # noqa
            print(f"  giocatori non letti per {g['appid']}: {str(e)[:100]}", file=sys.stderr)
            if old:
                out[k] = old
            continue
        stable = old and abs(n - old["n"]) < max(10, 0.1 * old["n"]) and now - (old.get("ts") or 0) < PLAYERS_MAX_AGE
        out[k] = old if stable else {"n": n, "ts": now}
    if out == prev:
        return False
    write_json_atomic(PLAYERS_OUT, {"games": out}, separators=(",", ":"))
    return True


def update_price_history(games, now):
    """Storico prezzi in data/prices.json: per gioco il minimo visto finora (`min`: cents, testo, data) e le ultime variazioni
    (`h`: coppie [data, centesimi]). Si scrive solo quando il prezzo cambia, quindi il repository non riceve commit inutili.
    Il minimo parte da quando l'app ha iniziato a seguire il prezzo, non è il minimo assoluto di Steam. Ritorna True se il file è cambiato."""
    data = read_json_strict(PRICES_OUT, {})   # il minimo storico non si rigenera: un file rotto non va azzerato in silenzio
    prev = data.get("games", {}) if isinstance(data, dict) else {}
    if not isinstance(prev, dict):
        prev = {}
    out = {k: dict(v) for k, v in prev.items() if isinstance(v, dict)}
    for g in games:
        p = g.get("price")
        if not p or isinstance(p.get("cents"), bool) or not isinstance(p.get("cents"), int):
            continue
        k, cents = str(g["appid"]), p["cents"]
        e = out.get(k) or {}
        h = [x for x in (e.get("h") or []) if isinstance(x, list) and len(x) == 2]
        if h and h[-1][1] == cents:
            continue  # prezzo invariato
        h.append([now, cents])
        e["h"] = h[-PRICE_HISTORY_MAX:]
        m = e.get("min")
        if not isinstance(m, dict) or not isinstance(m.get("c"), int) or cents < m["c"]:
            e["min"] = {"c": cents, "f": p.get("final") or "", "ts": now}
        out[k] = e
    if out == prev:
        return False
    write_json_atomic(PRICES_OUT, {"games": out}, separators=(",", ":"))
    return True


def fetch_ntfy_key():
    """Chiave pubblica con cui ntfy.sh invia le notifiche push al browser."""
    try:
        raw = http(f"{NTFY_URL}/config.js", retries=2).decode("utf-8", "replace")
        m = re.search(r'web_push_public_key"?\s*:\s*"([^"]+)"', raw)
        return m.group(1) if m else ""
    except Exception as e:  # noqa
        print(f"  chiave ntfy non recuperata: {e}", file=sys.stderr)
        return ""


def clean(text):
    t = re.sub(r"\[img[^\]]*\][\s\S]*?\[/img\]", "", text or "")
    t = re.sub(r"\{STEAM_CLAN_(?:LOC_)?IMAGE\}\S*", "", t)
    return re.sub(r"\s+", " ", strip_markup(t, " ")).strip()   # tag veri via, parole tra parentesi quadre ([AMD], [ESC]) restano


SYSTEM_PROMPT = """Sei un redattore italiano di notizie sui videogiochi. Ricevi le note di aggiornamento (patch notes) o un annuncio di un gioco e scrivi un riassunto per un giocatore che ha poco tempo.

Regole:
- Scrivi SOLO in italiano, in modo chiaro e naturale.
- Da 3 a 5 punti, ognuno su una riga che inizia con "• ", massimo 20 parole ciascuno.
- Ordine di importanza: nuovi contenuti e funzioni, poi bilanciamento e cambiamenti al gameplay, poi prestazioni, infine correzioni di bug (raggruppa i bug fix in un solo punto, indicando di che tipo sono).
- Mantieni in originale i nomi propri del gioco (oggetti, luoghi, personaggi, modalità).
- Non inventare nulla che non sia nel testo. Non aggiungere introduzioni, conclusioni, titoli o emoji.
- Se il testo non è una patch ma un annuncio (evento, saldi, stream, anteprima), riassumilo in 1-2 punti e comincia il primo con «Annuncio: »."""


class RateLimited(Exception):
    pass


# Contatori dell'esecuzione in corso: finiscono nel riepilogo di GitHub Actions (vedi write_summary), così per capire
# perché un riassunto manca non serve leggere i log.
STATS = {}


def reset_stats():
    STATS.clear()
    STATS.update({"started": time.monotonic(), "games": 0, "games_ok": 0, "games_failed": [], "new_items": 0,
                  "summaries_ai": 0, "summaries_simple": 0, "summaries_failed": 0,
                  "translations_ok": 0, "translations_failed": 0, "models": [], "quota": False, "changed": False})


def stat_add(key, n=1):
    STATS[key] = STATS.get(key, 0) + n


def stat_model(model):
    if model not in STATS.setdefault("models", []):
        STATS["models"].append(model)


def write_summary(path=None):
    """Scrive il riepilogo dell'esecuzione in $GITHUB_STEP_SUMMARY (Markdown). Non deve mai far fallire l'aggiornamento."""
    path = path or os.environ.get("GITHUB_STEP_SUMMARY")
    if not path or not STATS:
        return
    secs = max(0, round(time.monotonic() - STATS.get("started", time.monotonic())))
    failed = STATS.get("games_failed") or []
    yes = lambda b: "sì" if b else "no"  # noqa: E731
    rows = [
        ("Giochi controllati", f"{STATS.get('games_ok', 0)} su {STATS.get('games', 0)}" + (f" (non letti: {', '.join(failed)})" if failed else "")),
        ("Annunci nuovi", STATS.get("new_items", 0)),
        ("Riassunti", f"{STATS.get('summaries_ai', 0)} con Gemini, {STATS.get('summaries_simple', 0)} semplici, {STATS.get('summaries_failed', 0)} falliti"),
        ("Traduzioni", f"{STATS.get('translations_ok', 0)} riuscite, {STATS.get('translations_failed', 0)} fallite"),
        ("Modello Gemini", ", ".join(STATS.get("models") or []) or ("non usato" if GEMINI_KEY else "chiave non impostata")),
        ("Quota Gemini esaurita", yes(STATS.get("quota"))),
        ("Dati cambiati", yes(STATS.get("changed"))),
        ("Durata", f"{secs} s"),
    ]
    text = "## Aggiornamento patch\n\n| Voce | Valore |\n| --- | --- |\n" + "".join(f"| {k} | {v} |\n" for k, v in rows)
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text)
    except OSError as e:
        print(f"  riepilogo non scritto: {e}", file=sys.stderr)


def gemini_call(system, user, max_tokens=2000, timeout=120, schema=None, schema_note=""):
    """Una richiesta a Gemini (piano gratuito). Prova i modelli in ordine; alza RateLimited se la quota è finita.

    Con `schema` (formato JSON di Gemini) la risposta è vincolata a quella forma: il testo di servizio del modello («Check word count»,
    «Point 1:»…) non può più finire nel risultato, perché non c'è un posto dove metterlo. `schema_note` si aggiunge alle istruzioni solo
    in quel caso. Se un modello rifiuta la modalità JSON (HTTP 400) si ripete la richiesta senza schema e il chiamante ripiega sul testo libero."""
    def post(model, with_schema):
        config = {"temperature": 0.2, "maxOutputTokens": max_tokens}
        if with_schema:
            config.update({"responseMimeType": "application/json", "responseSchema": schema})
        instructions = system + ("\n\n" + schema_note if with_schema and schema_note else "")
        payload = {"systemInstruction": {"parts": [{"text": instructions}]},
                   "contents": [{"role": "user", "parts": [{"text": user}]}],
                   "generationConfig": config}
        req = urllib.request.Request(f"{GEMINI_BASE}/{model}:generateContent", data=json.dumps(payload).encode("utf-8"), headers={
            "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY, "User-Agent": "patch-radar/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(read_limited(r))
        return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"]).strip()

    errors = []
    for model in gemini_models():
        for with_schema in ([True, False] if schema else [False]):
            try:
                text = post(model, with_schema)
                if text:
                    stat_model(model)
                    return text
                errors.append(f"{model}: risposta vuota")
            except urllib.error.HTTPError as e:
                msg = e.read()[:400].decode("utf-8", "replace")
                if e.code == 429:
                    STATS["quota"] = True
                    raise RateLimited(msg)
                if e.code == 400 and with_schema:
                    errors.append(f"{model}: modalità JSON non accettata, riprovo senza")
                    continue
                errors.append(f"{model} HTTP {e.code}: {msg[:150]}")
            except Exception as e:  # noqa
                errors.append(f"{model}: {e}")
            break   # errore diverso dal rifiuto dello schema: passa al modello successivo
    raise RuntimeError(" || ".join(errors))


SUMMARY_SCHEMA = {"type": "OBJECT", "properties": {"points": {"type": "ARRAY", "minItems": 1, "maxItems": 5, "items": {"type": "STRING"}}}, "required": ["points"]}
SUMMARY_NOTE = "Rispondi in JSON: ogni punto è un elemento dell'array «points», senza il simbolo «•» davanti."
TRANSLATION_SCHEMA = {"type": "OBJECT", "properties": {"title": {"type": "STRING"}, "text": {"type": "STRING"}}, "required": ["title", "text"]}
TRANSLATION_NOTE = ("Rispondi in JSON: «title» è il titolo tradotto (senza «TITOLO:»), «text» è la traduzione completa, "
                    "con le righe «# » e «• » come nell'originale, una per riga.")


LEAK_RE = re.compile(
    r"\*\*|\bword count\b|\bconstraints?\b|\bpoint \d+\b|\bmax(?:imum)? \d+\b|\bdraft(?:ing)?\b|\blet me\b|\blet's\b"
    r"|\bcheck(?:ing)?\b.*:|\bwait\b|\bself-?correction\b|\bthe user\b|\bsystem prompt\b|\byes\s*\(|\bno\s*\(\d+",
    re.I)
WORDS_TAIL_RE = re.compile(r"\s*\(\d+\s*(?:words?|parole)\)\s*\.?\s*$", re.I)


def clean_ai_summary(text):
    """Toglie dal testo dell'IA le righe di servizio (ragionamento, conteggio parole, «Point 1:»…).
    Ritorna "" se non resta almeno un punto elenco sensato, così il riassunto viene rifatto o sostituito."""
    out = []
    for raw in (text or "").split("\n"):
        l = WORDS_TAIL_RE.sub("", raw.strip())
        l = l.lstrip("-*• ").strip()
        if len(l) < 12 or l.endswith(":") or LEAK_RE.search(l):
            continue
        out.append("• " + l)
    return "\n".join(out)[:900]


def parse_points(text):
    """Punti elenco dalla risposta JSON {"points": [...]}. Se non è JSON valido (modello senza modalità JSON) si ripiega
    sulla pulizia del testo libero. Ritorna "" se non resta nessun punto sensato."""
    try:
        points = json.loads(text)["points"]
        if not isinstance(points, list):
            raise TypeError("points non è un elenco")
    except (ValueError, KeyError, TypeError):
        return clean_ai_summary(text)
    out = []
    for raw in points[:20]:   # il tetto di 5 vale per i punti buoni: si scartano prima quelli vuoti o di servizio
        if not isinstance(raw, str):
            continue
        line = WORDS_TAIL_RE.sub("", raw.strip()).lstrip("-*• ").strip()
        if len(line) < 12 or line.endswith(":"):
            continue
        out.append("• " + " ".join(line.split()))
        if len(out) == 5:
            break
    return "\n".join(out)[:900]


def summarize(name, item):
    """Riassunto in italiano con Gemini. Ritorna "" se non disponibile."""
    body = clean(item.get("contents"))[:30000]
    if not GEMINI_KEY or len(body) < 300:
        return ""
    text = gemini_call(SYSTEM_PROMPT, f"Gioco: {name}\nTitolo: {item.get('title')}\n\n{body}", schema=SUMMARY_SCHEMA, schema_note=SUMMARY_NOTE)
    return parse_points(text)


TRANSLATE_PROMPT = """Sei un traduttore professionista di videogiochi. Traduci in italiano le note di aggiornamento che ricevi.

Regole:
- Prima riga della risposta: «TITOLO: » seguito dal titolo tradotto. Poi il testo tradotto.
- Mantieni ESATTAMENTE la struttura: ogni riga che inizia con «# » (titolo di sezione) e ogni riga che inizia con «• » (elenco) deve restare tale, una per riga, nello stesso ordine.
- Usa la terminologia italiana dei giocatori. Lascia in originale i nomi propri del gioco (oggetti, luoghi, personaggi, abilità, modalità) e i numeri di versione.
- Non riassumere, non omettere nulla, non aggiungere commenti."""


def translate_item(name, item):
    """Traduzione completa in italiano con Gemini. Ritorna None se non disponibile."""
    text = "\n".join(structured_lines(item.get("contents")))
    if not GEMINI_KEY or len(text) < 80 or len(text) > 30000:
        return None
    out = gemini_call(TRANSLATE_PROMPT, f"Gioco: {name}\nTITOLO: {item.get('title')}\n\n{text}", max_tokens=16000, timeout=240,
                      schema=TRANSLATION_SCHEMA, schema_note=TRANSLATION_NOTE)
    title, body = parse_translation(out)
    if len(body) < len(text) * 0.3:
        raise RuntimeError("traduzione incompleta")
    return {"title": title, "text": body, "src": "gemini"}


def parse_translation(out):
    """(titolo, testo) dalla risposta JSON {"title", "text"}; se non è JSON valido, dal formato libero «TITOLO: …» + testo."""
    try:
        data = json.loads(out)
        title, body = data["title"], data["text"]
        if not isinstance(title, str) or not isinstance(body, str):
            raise TypeError("title e text devono essere testo")
    except (ValueError, KeyError, TypeError):
        first, _, body = out.partition("\n")
        if not first.upper().startswith("TITOLO:"):
            raise RuntimeError("traduzione incompleta")
        title = first.split(":", 1)[1]
    return title.strip(), body.strip()


def extractive_summary(item):
    """Riassunto senza IA: introduzione + prime voci dell'elenco, poi tradotto in italiano."""
    lines = structured_lines(item.get("contents"))
    intro = next((l for l in lines if len(l) > 50 and not l.startswith(("•", "#"))), "")
    bullets = [l for l in lines if l.startswith("•") and len(l) > 18][:5]
    parts = ([intro[:220]] if intro else []) + [b[:140] for b in bullets]
    if not parts or sum(len(x) for x in parts) < 60:
        return ""
    body = urllib.parse.urlencode({"client": "gtx", "sl": "auto", "tl": "it", "dt": "t", "q": "\n".join(parts)}).encode()
    raw = http("https://translate.googleapis.com/translate_a/single", data=body, retries=2)
    out = "".join(x[0] or "" for x in json.loads(raw)[0]).strip()
    out = "\n".join(("• " + l.lstrip("• ").strip()) for l in out.split("\n") if l.strip())
    return out[:900]


def merge_history(items, old_items):
    """Aggiunge agli annunci appena scaricati quelli vecchi che Steam non restituisce più."""
    have = {str(i.get("gid")) for i in items}
    kept = [i for i in old_items if str(i.get("gid")) not in have]
    return sorted(items + kept, key=lambda x: x.get("date") or 0, reverse=True)[:HISTORY_MAX]


def wants_gemini(it):
    """True solo per i rilasci veri (note di aggiornamento): saldi, eventi e annunci non consumano richieste a Gemini.
    Usa il giudizio già dato da classify() se c'è, altrimenti lo calcola."""
    patch = it.get("patch")
    return bool(is_patch(it) if patch is None else patch)


def add_summaries(games, old):
    """Riporta i riassunti già fatti e ne crea di nuovi: Gemini solo per i rilasci, metodo semplice (gratuito) per il resto."""
    budget, use_ai = MAX_SUMMARIES, bool(GEMINI_KEY)
    for g in games:
        prev = {str(i["gid"]): i for i in old.get(str(g["appid"]), {}).get("items", [])}
        for it in g["items"]:
            p = prev.get(str(it["gid"]))
            if p and p.get("summary"):
                src = p.get("summary_src", "simple")
                text = clean_ai_summary(p["summary"]) if src == "ai" else p["summary"]
                if text:  # se l'IA aveva lasciato solo righe di servizio, il riassunto viene rifatto
                    it["summary"], it["summary_src"] = text, src
            if p and p.get("it"):
                it["it"] = p["it"]
            if p and p.get("it_fail"):
                it["it_fail"] = p["it_fail"]
    for g in games:
        for it in g["items"][:6]:
            if budget <= 0:
                return
            ai_ok = use_ai and wants_gemini(it)
            if it.get("summary") and (it.get("summary_src") == "ai" or not ai_ok):
                continue
            text, src = "", "simple"
            if ai_ok:
                try:
                    text = summarize(g["name"], it)
                    if text:  # summarize() torna "" senza chiamare Gemini se il testo è troppo corto: niente pausa inutile
                        src = "ai"
                        time.sleep(7)  # il piano gratuito consente circa 10 richieste al minuto
                except RateLimited as e:
                    print(f"  limite di richieste Gemini raggiunto, riprovo alla prossima esecuzione ({str(e)[:300]})", file=sys.stderr)
                    use_ai = False
                    stat_add("summaries_failed")
                except Exception as e:  # noqa
                    print(f"  riassunto Gemini non disponibile ({str(e)[:700]})", file=sys.stderr)
                    use_ai = False
                    stat_add("summaries_failed")
            if not text and not it.get("summary"):
                try:
                    text, src = extractive_summary(it), "simple"
                except Exception as e:  # noqa
                    print(f"  riassunto semplice non disponibile ({e})", file=sys.stderr)
                    return
            if text:
                budget -= 1
                it["summary"], it["summary_src"] = text, src
                stat_add("summaries_ai" if src == "ai" else "summaries_simple")


TRANSLATE_RETRIES = 3        # tentativi falliti prima di fermarsi...
TRANSLATE_RETRY_AFTER = 86400  # ...e di riprovare dopo un giorno


def translation_gave_up(it, now=None):
    f = it.get("it_fail") or {}
    return f.get("n", 0) >= TRANSLATE_RETRIES and (now or time.time()) - f.get("ts", 0) < TRANSLATE_RETRY_AFTER


def add_translations(games):
    """Traduce per intero in italiano (Gemini) le patch più recenti, poche per volta."""
    if not GEMINI_KEY:
        return
    budget = TRANSLATE_BUDGET
    for g in games:
        for it in g["items"][:3]:
            if budget <= 0:
                return
            if it.get("it") or translation_gave_up(it) or not wants_gemini(it):
                continue
            try:
                tr = translate_item(g["name"], it)
                if tr is None:
                    # testo troppo corto o troppo lungo: non c'è nulla da chiedere a Gemini. Non deve consumare il budget,
                    # altrimenti a ogni esecuzione blocca le traduzioni degli altri giochi.
                    continue
                time.sleep(7)
            except RateLimited as e:
                print(f"  limite Gemini raggiunto: le traduzioni continuano alla prossima esecuzione ({str(e)[:300]})", file=sys.stderr)
                return
            except Exception as e:  # noqa
                print(f"  traduzione Gemini non riuscita ({str(e)[:200]})", file=sys.stderr)
                stat_add("translations_failed")
                f = it.get("it_fail") or {}
                it["it_fail"] = {"n": f.get("n", 0) + 1, "ts": int(time.time())}
                budget -= 1
                time.sleep(7)  # la richiesta c'è stata comunque: si rispetta il limite al minuto
                continue
            budget -= 1
            it["it"] = tr
            it.pop("it_fail", None)
            stat_add("translations_ok")


OUTBOX_ITEMS = []   # notifiche del controllo in corso, scritte in outbox.json a dati salvati


def enqueue(topics, title, message, tags, click=""):
    """Mette in coda una notifica: verrà inviata da `--send` dopo il salvataggio dei dati."""
    if not NTFY_TOPIC:
        return
    OUTBOX_ITEMS.append({"topics": list(topics), "title": title, "message": message, "tags": list(tags), "click": click})


def _b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _trim(s):
    """Stessa normalizzazione del service worker (spazi e a capo ai bordi): un server può ripulirli senza invalidare la firma."""
    return str(s).strip(" \t\r\n")


def signing_payload(topic, title, message, click, ts):
    return "\n".join([SIGN_VERSION, _trim(topic), _trim(title), _trim(message), _trim(click), str(int(ts))]).encode("utf-8")


def signed_tags(topic, title, message, click, tags, ts=None):
    """Se è impostato il secret NTFY_SIGN_KEY, aggiunge ai tag data e firma Ed25519 della notifica.
    L'argomento ntfy è pubblico (sta in config.json): la firma permette all'app di scartare i messaggi non nostri."""
    raw = os.environ.get("NTFY_SIGN_KEY", "").strip()
    if not raw:
        return list(tags)
    try:
        seed = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        ts = int(ts or time.time())
        sig = ed25519.sign(seed, signing_payload(topic, title, message, click, ts))
        return list(tags) + [f"ts:{ts}", "sig:" + _b64u(sig)]
    except Exception as e:  # noqa
        print(f"  firma non riuscita ({e}): notifica inviata senza firma", file=sys.stderr)
        return list(tags)


def ntfy_send(topics, title, message, tags, click=""):
    if not NTFY_TOPIC:
        return
    click = click or SITE_URL
    for topic in topics:
        payload = {"topic": topic, "title": title, "message": message, "tags": signed_tags(topic, title, message, click, tags)}
        if click:
            payload["click"] = click
        try:
            http(NTFY_URL, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, retries=2)
        except Exception as e:  # noqa
            print(f"  notifica non inviata ({topic}): {e}", file=sys.stderr)


def write_outbox():
    """Scrive la coda su disco (o elimina quella vecchia). outbox.json non va nel repository: serve solo al passo `--send`."""
    if OUTBOX_ITEMS:
        write_json_atomic(OUTBOX, OUTBOX_ITEMS, ensure_ascii=False)
    elif os.path.exists(OUTBOX):
        os.remove(OUTBOX)


def send_outbox():
    """Invia le notifiche accodate (passo del workflow successivo al salvataggio)."""
    try:
        with open(OUTBOX, encoding="utf-8") as f:
            items = json.load(f)
    except FileNotFoundError:
        print("Nessuna notifica da inviare.")
        return 0
    os.remove(OUTBOX)  # prima di inviare: un'esecuzione ripetuta non deve rimandare le stesse notifiche
    for m in items:
        ntfy_send(m["topics"], m["title"], m["message"], m.get("tags", []), m.get("click", ""))
    print(f"Notifiche inviate: {len(items)}")
    return len(items)


def notify(name, item, appid, watch=False):
    """Nuova pubblicazione. Le patch vere vanno al canale del gioco; eventi e annunci a un canale a parte.
    Le patch grosse vanno anche al canale «-major» (per chi vuole solo quelle). Un gioco osservato (watch) manda
    solo le patch grosse."""
    body = (item.get("title") or "Nuova pubblicazione su Steam") + ("\n" + item["summary"][:300] if item.get("summary") else "")
    if item.get("patch"):
        # un canale per tutti i giochi (compatibilità) e uno per ogni gioco
        topics = [] if watch else [NTFY_TOPIC, f"{NTFY_TOPIC}-{appid}"]
        if is_major(item):
            topics.append(f"{NTFY_TOPIC}-{appid}-major")
        if topics:
            enqueue(topics, f"{name}: nuovo aggiornamento", body, ["video_game"])
        # Avvisi per parola chiave: solo per le patch NON grosse (quelle grosse arrivano già a chi segue «solo grosse», che è
        # l'unico che si iscrive a questi argomenti: così non c'è mai una notifica doppia). I giochi osservati restano solo-grosse.
        if not watch and not is_major(item):
            for gid in keywords_of(item):
                enqueue([f"{NTFY_TOPIC}-{appid}-kw-{gid}"], f"{name}: patch con «{KEYWORD_GROUPS[gid][0]}»", body, ["mag"])
    elif not watch:
        enqueue([f"{NTFY_TOPIC}-{appid}-news"], f"{name}: novità", body, ["loudspeaker"])


def notify_sale(name, appid, price):
    line = f"-{price['discount']}%: {price['final']}" + (f" (invece di {price['initial']})" if price.get("initial") else "")
    enqueue([f"{NTFY_TOPIC}-{appid}-sale"], f"{name} è in sconto", line, ["moneybag"], f"https://store.steampowered.com/app/{appid}/")


def notify_facts(name, appid, title, message):
    """Novità della scheda Steam (lingua italiana, fine dell'accesso anticipato, DLC): vanno al canale «novità» del gioco."""
    enqueue([f"{NTFY_TOPIC}-{appid}-news"], f"{name}: {title}", message, ["tada"], f"https://store.steampowered.com/app/{appid}/")


STABLE_HOURS = int(os.environ.get("STABLE_HOURS", "48"))   # ore senza nuove patch dopo una patch grossa
STABLE_MAX_AGE = 7 * 86400                                  # oltre questa età una patch grossa non si segnala più


def stable_candidate(items, now):
    """Ultima patch grossa che ora si può dire «stabile»: nessuna patch successiva (hotfix) da STABLE_HOURS ore.
    Ritorna (patch grossa, numero di hotfix arrivati dopo) oppure None."""
    patches = [i for i in items if i.get("patch") and isinstance(i.get("date"), int)]
    majors = [i for i in patches if is_major(i)]
    if not majors:
        return None
    m = max(majors, key=lambda i: i["date"])
    after = [i for i in patches if i["date"] > m["date"]]
    last = max([m] + after, key=lambda i: i["date"])
    if now - last["date"] < STABLE_HOURS * 3600 or now - m["date"] > STABLE_MAX_AGE:
        return None
    return m, len(after)


def notify_stable(name, appid, major, hotfixes):
    quiet = f"Nessun altro aggiornamento da {STABLE_HOURS} ore"
    line = (f"{quiet}, dopo {hotfixes} hotfix." if hotfixes > 1 else f"{quiet}, dopo 1 hotfix." if hotfixes else f"Nessun hotfix nelle {STABLE_HOURS} ore dopo la patch.")
    enqueue([f"{NTFY_TOPIC}-{appid}-stable"], f"{name}: la patch sembra stabile", f"{major.get('title') or 'Ultima patch'}\n{line}", ["white_check_mark"], major.get("url") or "")


def price_reached(price, target):
    """True se il prezzo attuale è uguale o inferiore alla soglia (in euro)."""
    return bool(price and target and isinstance(price.get("cents"), int) and price["cents"] <= round(target * 100))


def notify_target(name, appid, price, target):
    soglia = f"{target:.2f}".replace(".", ",")
    line = f"{price['final']} (la tua soglia: {soglia} €)"
    enqueue([f"{NTFY_TOPIC}-{appid}-target"], f"{name} ha raggiunto il prezzo che cercavi", line, ["moneybag"], f"https://store.steampowered.com/app/{appid}/")


def send_digest(games, since):
    """Riepilogo serale: una notifica per gioco con le patch uscite dall'ultimo riepilogo."""
    for g in games:
        fresh = [i for i in g["items"] if i.get("patch") and (i.get("date") or 0) > since]
        if not fresh:
            continue
        for suffix, items in (("digest", [] if g.get("watch") else fresh), ("digest-major", [i for i in fresh if is_major(i)])):
            if not items:
                continue
            n = len(items)
            title = f"{g['name']}: {n} aggiornament{'o' if n == 1 else 'i'} oggi"
            enqueue([f"{NTFY_TOPIC}-{g['appid']}-{suffix}"], title, "\n".join("• " + (i.get("title") or "Aggiornamento") for i in items[:6]), ["newspaper"])
            print(f"RIEPILOGO {g['name']} ({suffix}): {n}")


def main():
    prev = read_json_strict(OUT, {})   # se news.json esiste ma è rotto ci si ferma: ripartire da {} cancellerebbe lo storico e le notifiche
    if not isinstance(prev, dict):
        print(f"::error file={OUT}::{OUT} non ha il formato atteso (serve un oggetto JSON). Non lo sovrascrivo.")
        sys.exit(1)
    now = int(time.time())
    reset_stats()
    pg = prev.get("games")
    old = {str(g["appid"]): g for g in pg if isinstance(g, dict)} if isinstance(pg, list) else {}
    games, ok = [], 0
    try:
        wanted = load_games()
    except Exception as e:  # noqa
        # comando di GitHub Actions: l'errore compare ben visibile nell'esecuzione (utile se games.json si modifica da telefono)
        print(f"::error file=games.json::games.json non valido: {e}")
        sys.exit(1)
    STATS["games"] = len(wanted)
    for g in wanted:
        key = str(g["appid"])
        o = old.get(key, {})
        name = g["name"] or o.get("name") or ""
        image, price = o.get("image") or "", o.get("price")
        facts = dict(o.get("facts") or {})
        try:  # prezzo (può cambiare con i saldi), dati della scheda e, se mancano, nome e copertina
            det = store_details(g["appid"])
            name, image, price = name or det["name"] or f"Gioco {g['appid']}", image or det["image"], det["price"]
            facts.update(det.get("facts") or {})   # un dato non fornito da Steam non cancella quello già noto
        except Exception as e:  # noqa
            print(f"  scheda negozio non letta per {g['appid']}: {str(e)[:120]}", file=sys.stderr)
            name = name or f"Gioco {g['appid']}"
        try:
            items = merge_history(fetch_game(g["appid"]), o.get("items", []))
            ok += 1
            STATS["games_ok"] = ok
            print(f"{name}: {len(items)} annunci")
        except Exception as e:  # noqa
            print(f"{name}: ERRORE {e} (tengo i dati precedenti)", file=sys.stderr)
            STATS["games_failed"].append(name)
            items = o.get("items", [])
        classify(items)
        entry = {"appid": g["appid"], "name": name, "image": image, "price": price, "items": items}
        if facts:
            entry["facts"] = facts
        if g.get("watch"):
            entry["watch"], entry["target"] = True, g.get("target")
        games.append(entry)
    add_summaries(games, old)
    for g in games:
        o = old.get(str(g["appid"]))
        # «patch stabile»: una sola volta per ogni patch grossa (si ricorda quale in `stable`); alla prima raccolta si segna senza avvisare
        st = stable_candidate(g["items"], now)
        if st and str(st[0].get("gid")) != (o or {}).get("stable"):
            g["stable"] = str(st[0].get("gid"))
            if o and o.get("items"):
                print(f"STABILE {g['name']}: {st[0].get('title')} ({st[1]} hotfix)")
                notify_stable(g["name"], g["appid"], st[0], st[1])
        elif (o or {}).get("stable"):
            g["stable"] = o["stable"]
        if not o or not o.get("items"):
            continue  # gioco nuovo o prima raccolta: nessuna notifica
        if isinstance(o.get("facts"), dict) and isinstance(g.get("facts"), dict):   # diario del gioco: cambi sulla scheda Steam
            for title, msg in facts_changes(o["facts"], g["facts"]):
                print(f"SCHEDA {g['name']}: {title}")
                notify_facts(g["name"], g["appid"], title, msg)
        known = {str(i["gid"]) for i in o["items"]}
        fresh = [i for i in g["items"] if str(i["gid"]) not in known]
        stat_add("new_items", len(fresh))
        for it in fresh[:5]:
            print(f"NUOVO {g['name']}: {it.get('title')} ({'patch' if it.get('patch') else 'annuncio'})")
            notify(g["name"], it, g["appid"], bool(g.get("watch")))
        pr, po = g.get("price"), o.get("price") if "price" in o else False
        if g.get("watch") and g.get("target") and po is not False and price_reached(pr, g["target"]) and not price_reached(po, g["target"]):
            print(f"SOGLIA {g['name']}: {pr['final']} (soglia {g['target']})")
            notify_target(g["name"], g["appid"], pr, g["target"])
        if po is not False and pr and pr["discount"] >= 10 and pr["discount"] > ((po or {}).get("discount") or 0):
            print(f"SALDO {g['name']}: -{pr['discount']}%")
            notify_sale(g["name"], g["appid"], pr)
    # riepilogo serale (una volta al giorno, dopo l'ora stabilita)
    digest_ts = prev.get("digest_ts") or now
    local = datetime.datetime.fromtimestamp(now, TZ)
    # Con ok == 0 (Steam irraggiungibile) i dati non vengono salvati: senza questo controllo digest_ts non si
    # aggiornerebbe e il riepilogo verrebbe rimandato a ogni esecuzione.
    if ok > 0 and local.hour >= DIGEST_HOUR and datetime.datetime.fromtimestamp(digest_ts, TZ).date() < local.date():
        send_digest(games, digest_ts)
        digest_ts = now
    add_translations(games)
    ntfy_key = fetch_ntfy_key() or prev.get("ntfy_key", "")
    news_changed = (games != (pg if isinstance(pg, list) else None) or ntfy_key != prev.get("ntfy_key", "")
                    or digest_ts != prev.get("digest_ts"))
    players_changed = False
    if ok == 0:
        print("Nessun gioco aggiornato.", file=sys.stderr)
        news_changed = False
        OUTBOX_ITEMS.clear()  # dati non salvati: niente notifiche
    else:
        players_changed = update_players(games, now)
        players_changed = update_price_history(games, now) or players_changed
    if news_changed:
        write_json_atomic(OUT, {"updated": now, "ntfy_key": ntfy_key, "digest_ts": digest_ts, "games": games}, ensure_ascii=False, separators=(",", ":"))
    changed = news_changed or players_changed
    STATS["changed"] = changed
    write_outbox()
    write_summary()
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    if "--send" in sys.argv[1:]:
        send_outbox()
    else:
        main()
