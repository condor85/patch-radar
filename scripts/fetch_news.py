#!/usr/bin/env python3
"""Scarica gli annunci Steam dei giochi e li salva in data/news.json.

Le notifiche ntfy NON partono durante il controllo: vengono accodate in outbox.json e inviate dal passo successivo
(`python3 scripts/fetch_news.py --send`) solo dopo che i dati sono stati salvati nel repository. Così, se il salvataggio
fallisce, la volta dopo gli stessi annunci risultano ancora nuovi e nessuna notifica viene mandata due volte."""
import base64, datetime, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ed25519  # noqa: E402

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
PLAYERS_MAX_AGE = 6 * 3600               # il numero si aggiorna se cambia di almeno il 10% o dopo questo tempo
SIGN_VERSION = "patch-radar-v1"          # deve coincidere con sw.js
KEEP = ("gid", "title", "url", "contents", "date", "feedlabel", "feedname", "author", "tags")
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


def http(url, data=None, headers=None, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "patch-radar/1.0", **(headers or {})})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # noqa
            last = e
            if i < retries - 1:  # dopo l'ultimo tentativo è inutile aspettare
                time.sleep(2 * (i + 1))
    raise last


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
        out.append({"appid": appid, "name": (g.get("name") or "").strip()})
    return out


def store_details(appid):
    """Nome, copertina ufficiale e prezzo dal negozio Steam (prezzi in euro). Alza un'eccezione se non disponibile."""
    d = get_json(f"{STORE}/api/appdetails?appids={appid}&filters=basic,price_overview&cc=it&l=english")[str(appid)]
    if not d.get("success"):
        raise RuntimeError("scheda non disponibile")
    data = d["data"]
    po = data.get("price_overview")
    price = None
    if po:
        price = {"final": po.get("final_formatted") or "", "initial": po.get("initial_formatted") or "", "discount": int(po.get("discount_percent") or 0)}
    return {"name": data.get("name", ""), "image": data.get("header_image", ""), "price": price}


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
    os.makedirs("data", exist_ok=True)
    with open(PLAYERS_OUT, "w", encoding="utf-8") as f:
        json.dump({"games": out}, f, separators=(",", ":"))
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
    t = re.sub(r"\[/?[a-zA-Z*][^\]]*\]", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip()


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


def gemini_call(system, user, max_tokens=2000, timeout=120):
    """Una richiesta a Gemini (piano gratuito). Prova i modelli in ordine; alza RateLimited se la quota è finita."""
    payload = {"systemInstruction": {"parts": [{"text": system}]},
               "contents": [{"role": "user", "parts": [{"text": user}]}],
               "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens}}
    errors = []
    for model in gemini_models():
        req = urllib.request.Request(f"{GEMINI_BASE}/{model}:generateContent", data=json.dumps(payload).encode("utf-8"), headers={
            "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY, "User-Agent": "patch-radar/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
            text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"]).strip()
            if text:
                return text
            errors.append(f"{model}: risposta vuota")
        except urllib.error.HTTPError as e:
            msg = e.read()[:400].decode("utf-8", "replace")
            if e.code == 429:
                raise RateLimited(msg)
            errors.append(f"{model} HTTP {e.code}: {msg[:150]}")
        except Exception as e:  # noqa
            errors.append(f"{model}: {e}")
    raise RuntimeError(" || ".join(errors))


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


def summarize(name, item):
    """Riassunto in italiano con Gemini. Ritorna "" se non disponibile."""
    body = clean(item.get("contents"))[:30000]
    if not GEMINI_KEY or len(body) < 300:
        return ""
    text = gemini_call(SYSTEM_PROMPT, f"Gioco: {name}\nTitolo: {item.get('title')}\n\n{body}")
    return clean_ai_summary(text)


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
    out = gemini_call(TRANSLATE_PROMPT, f"Gioco: {name}\nTITOLO: {item.get('title')}\n\n{text}", max_tokens=16000, timeout=240)
    title, _, body = out.partition("\n")
    if not title.upper().startswith("TITOLO:") or len(body.strip()) < len(text) * 0.3:
        raise RuntimeError("traduzione incompleta")
    return {"title": title.split(":", 1)[1].strip(), "text": body.strip(), "src": "gemini"}


def structured_lines(text):
    t = re.sub(r"\[img[^\]]*\][\s\S]*?\[/img\]", "", text or "")
    t = re.sub(r"\{STEAM_CLAN_(?:LOC_)?IMAGE\}\S*", "", t)
    t = re.sub(r"\[\*\]", "\n• ", t)
    t = re.sub(r"\[h[1-6][^\]]*\]", "\n# ", t)
    t = re.sub(r"\[/?(?:h[1-6]|p|list|olist|quote|hr)[^\]]*\]", "\n", t)
    t = re.sub(r"<br\s*/?>|</(?:p|div|li|h[1-6])>", "\n", t)
    t = re.sub(r"\[/?[a-zA-Z][^\]]*\]|<[^>]+>", "", t)
    return [re.sub(r"\s+", " ", l).strip() for l in t.split("\n") if l.strip()]


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


STRONG_TITLE = re.compile(r"patch|hotfix|hot fix|changelog|change log|release notes|\bfix(es)?\b|\bbuild \d+|aggiornamento", re.I)
NEWS_TITLE = re.compile(r"\bsale\b|saldi|giveaway|livestream|\bstream\b|festival|discount|soundtrack|merch|wallpaper|contest|competition|spotlight|\bevent\b|meetup|trailer|roadmap|interview", re.I)
VERSION_TITLE = re.compile(r"\bv?\d+\.\d+")


def is_patch(item):
    """True se la pubblicazione contiene note di aggiornamento vere (non eventi, saldi, annunci)."""
    if "patchnotes" in (item.get("tags") or []):
        return True
    title = item.get("title") or ""
    if STRONG_TITLE.search(title):
        return True
    if NEWS_TITLE.search(title):
        return False
    if VERSION_TITLE.search(title):
        return True
    body = " ".join(structured_lines(item.get("contents")))[:3000].lower()
    if re.search(r"\bupdate\b", title, re.I):
        return bool(re.search(r"patch notes|changelog|bug ?fix|\bfixed\b", body))
    return bool(re.search(r"patch notes|changelog|bug ?fix", body))


LABEL_RULES = [  # (sigla, espressione, occorrenze minime)
    ("new", re.compile(r"\bnew (?:\w+ ){0,2}(?:weapons?|items?|armou?rs?|biomes?|bosse?s?|enem(?:y|ies)|creatures?|recipes?|quests?|areas?|maps?|modes?|features?|content|regions?|skills?|spells?|class(?:es)?|buildings?|pets?|mounts?|dungeons?|npcs?|locations?|abilit(?:y|ies)|cosmetics?|outfits?|decorations?|furniture)\b|\bnow (?:available|live|playable)\b|\bintroduc\w+|\bseason \d|\bexpansion\b|\bdlc\b", re.I), 2),
    ("balance", re.compile(r"\bbalanc\w+|\bnerf(?:ed)?\b|\bbuff(?:ed)?\b|\b(?:damage|health|cooldown|drop rate|spawn rate|cost|speed|range|duration)\b[^.\n]{0,40}\b(?:increased|reduced|decreased|lowered|raised|adjusted|changed)\b|\b(?:increased|reduced|decreased|lowered|raised|adjusted)\b[^.\n]{0,40}\b(?:damage|health|cooldown|drop rate|spawn rate|cost|speed|range|duration)\b", re.I), 2),
    ("perf", re.compile(r"\bperformance\b|\boptimi[sz]\w*|\bfps\b|\bframe ?rate\b|\bstutter\w*|\bmemory (?:usage|leak)|\bloading times?\b|\blag\b", re.I), 2),
    ("bug", re.compile(r"\bfix(?:ed|es)?\b|\bbug\b|\bresolved\b|\bcrash(?:es|ed)?\b", re.I), 3),
]


def labels_of(item):
    """Etichette automatiche di una patch: new, balance, perf, bug (in questo ordine)."""
    text = " ".join(structured_lines(item.get("contents")))
    out = [name for name, rx, need in LABEL_RULES if len(rx.findall(text)) >= need]
    if re.search(r"hotfix|hot fix", item.get("title") or "", re.I) and "bug" not in out:
        out.append("bug")
    return out


def classify(items):
    for it in items:
        it["patch"] = is_patch(it)
        it["labels"] = labels_of(it) if it["patch"] else []


def merge_history(items, old_items):
    """Aggiunge agli annunci appena scaricati quelli vecchi che Steam non restituisce più."""
    have = {str(i.get("gid")) for i in items}
    kept = [i for i in old_items if str(i.get("gid")) not in have]
    return sorted(items + kept, key=lambda x: x.get("date") or 0, reverse=True)[:HISTORY_MAX]


def add_summaries(games, old):
    """Riporta i riassunti già fatti e ne crea di nuovi (Gemini se c'è la chiave, altrimenti metodo semplice)."""
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
            if it.get("summary") and (it.get("summary_src") == "ai" or not use_ai):
                continue
            text, src = "", "simple"
            if use_ai:
                try:
                    text = summarize(g["name"], it)
                    if text:  # summarize() torna "" senza chiamare Gemini se il testo è troppo corto: niente pausa inutile
                        src = "ai"
                        time.sleep(7)  # il piano gratuito consente circa 10 richieste al minuto
                except RateLimited as e:
                    print(f"  limite di richieste Gemini raggiunto, riprovo alla prossima esecuzione ({str(e)[:300]})", file=sys.stderr)
                    use_ai = False
                except Exception as e:  # noqa
                    print(f"  riassunto Gemini non disponibile ({str(e)[:700]})", file=sys.stderr)
                    use_ai = False
            if not text and not it.get("summary"):
                try:
                    text, src = extractive_summary(it), "simple"
                except Exception as e:  # noqa
                    print(f"  riassunto semplice non disponibile ({e})", file=sys.stderr)
                    return
            if text:
                budget -= 1
                it["summary"], it["summary_src"] = text, src


PATCH_RE = re.compile(r"patch|hotfix|hot fix|update|changelog|release notes|\bfix(es)?\b|\bv?\d+\.\d+|\bbuild \d+", re.I)


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
            if it.get("it") or translation_gave_up(it) or not (PATCH_RE.search(it.get("title") or "") or "patchnotes" in (it.get("tags") or [])):
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
                f = it.get("it_fail") or {}
                it["it_fail"] = {"n": f.get("n", 0) + 1, "ts": int(time.time())}
                budget -= 1
                time.sleep(7)  # la richiesta c'è stata comunque: si rispetta il limite al minuto
                continue
            budget -= 1
            it["it"] = tr
            it.pop("it_fail", None)


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
        with open(OUTBOX, "w", encoding="utf-8") as f:
            json.dump(OUTBOX_ITEMS, f, ensure_ascii=False)
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


def notify(name, item, appid):
    """Nuova pubblicazione. Le patch vere vanno al canale del gioco; eventi e annunci a un canale a parte."""
    body = (item.get("title") or "Nuova pubblicazione su Steam") + ("\n" + item["summary"][:300] if item.get("summary") else "")
    if item.get("patch"):
        # un canale per tutti i giochi (compatibilità) e uno per ogni gioco
        enqueue([NTFY_TOPIC, f"{NTFY_TOPIC}-{appid}"], f"{name}: nuovo aggiornamento", body, ["video_game"])
    else:
        enqueue([f"{NTFY_TOPIC}-{appid}-news"], f"{name}: novità", body, ["loudspeaker"])


def notify_sale(name, appid, price):
    line = f"-{price['discount']}%: {price['final']}" + (f" (invece di {price['initial']})" if price.get("initial") else "")
    enqueue([f"{NTFY_TOPIC}-{appid}-sale"], f"{name} è in sconto", line, ["moneybag"], f"https://store.steampowered.com/app/{appid}/")


def send_digest(games, since):
    """Riepilogo serale: una notifica per gioco con le patch uscite dall'ultimo riepilogo."""
    for g in games:
        fresh = [i for i in g["items"] if i.get("patch") and (i.get("date") or 0) > since]
        if not fresh:
            continue
        n = len(fresh)
        title = f"{g['name']}: {n} aggiornament{'o' if n == 1 else 'i'} oggi"
        enqueue([f"{NTFY_TOPIC}-{g['appid']}-digest"], title, "\n".join("• " + (i.get("title") or "Aggiornamento") for i in fresh[:6]), ["newspaper"])
        print(f"RIEPILOGO {g['name']}: {n}")


def main():
    try:
        with open(OUT, encoding="utf-8") as f:
            prev = json.load(f)
    except Exception:
        prev = {}
    now = int(time.time())
    pg = prev.get("games")
    old = {str(g["appid"]): g for g in pg if isinstance(g, dict)} if isinstance(pg, list) else {}
    games, ok = [], 0
    try:
        wanted = load_games()
    except Exception as e:  # noqa
        # comando di GitHub Actions: l'errore compare ben visibile nell'esecuzione (utile se games.json si modifica da telefono)
        print(f"::error file=games.json::games.json non valido: {e}")
        sys.exit(1)
    for g in wanted:
        key = str(g["appid"])
        o = old.get(key, {})
        name = g["name"] or o.get("name") or ""
        image, price = o.get("image") or "", o.get("price")
        try:  # prezzo (può cambiare con i saldi) e, se mancano, nome e copertina
            det = store_details(g["appid"])
            name, image, price = name or det["name"] or f"Gioco {g['appid']}", image or det["image"], det["price"]
        except Exception as e:  # noqa
            print(f"  scheda negozio non letta per {g['appid']}: {str(e)[:120]}", file=sys.stderr)
            name = name or f"Gioco {g['appid']}"
        try:
            items = merge_history(fetch_game(g["appid"]), o.get("items", []))
            ok += 1
            print(f"{name}: {len(items)} annunci")
        except Exception as e:  # noqa
            print(f"{name}: ERRORE {e} (tengo i dati precedenti)", file=sys.stderr)
            items = o.get("items", [])
        classify(items)
        games.append({"appid": g["appid"], "name": name, "image": image, "price": price, "items": items})
    add_summaries(games, old)
    for g in games:
        o = old.get(str(g["appid"]))
        if not o or not o.get("items"):
            continue  # gioco nuovo o prima raccolta: nessuna notifica
        known = {str(i["gid"]) for i in o["items"]}
        fresh = [i for i in g["items"] if str(i["gid"]) not in known]
        for it in fresh[:5]:
            print(f"NUOVO {g['name']}: {it.get('title')} ({'patch' if it.get('patch') else 'annuncio'})")
            notify(g["name"], it, g["appid"])
        pr, po = g.get("price"), o.get("price") if "price" in o else False
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
    if news_changed:
        os.makedirs("data", exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump({"updated": now, "ntfy_key": ntfy_key, "digest_ts": digest_ts, "games": games}, f, ensure_ascii=False, separators=(",", ":"))
    changed = news_changed or players_changed
    write_outbox()
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    if "--send" in sys.argv[1:]:
        send_outbox()
    else:
        main()
