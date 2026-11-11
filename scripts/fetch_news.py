#!/usr/bin/env python3
"""Scarica gli annunci Steam dei giochi, li salva in data/news.json e (opzionale) invia notifiche ntfy."""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

API = os.environ.get("STEAM_API_BASE", "https://api.steampowered.com")
STORE = os.environ.get("STEAM_STORE_BASE", "https://store.steampowered.com")
def _topic():
    t = os.environ.get("NTFY_TOPIC", "").strip()
    if t:
        return t
    try:
        return json.load(open("config.json", encoding="utf-8")).get("ntfyTopic", "").strip()
    except Exception:
        return ""


NTFY_TOPIC = _topic()
NTFY_URL = os.environ.get("NTFY_URL", "https://ntfy.sh")
SITE_URL = os.environ.get("SITE_URL", "")
OUT = "data/news.json"
KEEP = ("gid", "title", "url", "contents", "date", "feedlabel", "feedname", "author", "tags")
MODELS_TOKEN = os.environ.get("MODELS_TOKEN", "").strip()
MODELS_URL = os.environ.get("MODELS_URL", "https://models.github.ai/inference/chat/completions")
MODEL = os.environ.get("MODEL", "openai/gpt-4.1-mini")
MAX_SUMMARIES = int(os.environ.get("MAX_SUMMARIES", "8"))
ELLIPSIS = re.compile(r"(\.\.\.|…)\s*$")


def http(url, data=None, headers=None, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "patch-radar/1.0", **(headers or {})})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # noqa
            last = e
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
    data = json.load(open("games.json", encoding="utf-8"))
    out, seen = [], set()
    for g in data.get("games", []):
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


def resolve_name(appid):
    try:
        d = get_json(f"{STORE}/api/appdetails?appids={appid}&filters=basic&l=english")
        return d[str(appid)]["data"]["name"]
    except Exception:  # noqa
        return ""


def clean(text):
    t = re.sub(r"\[img[^\]]*\][\s\S]*?\[/img\]", "", text or "")
    t = re.sub(r"\{STEAM_CLAN_(?:LOC_)?IMAGE\}\S*", "", t)
    t = re.sub(r"\[/?[a-zA-Z*][^\]]*\]", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def summarize(name, item):
    """Riassunto in italiano con GitHub Models (gratuito con il token dell'Action). Ritorna "" se non disponibile."""
    body = clean(item.get("contents"))[:12000]
    if not MODELS_TOKEN or len(body) < 300:
        return ""
    payload = {"model": MODEL, "temperature": 0.2, "max_tokens": 400, "messages": [
        {"role": "system", "content": "Sei un assistente che riassume in italiano le note di aggiornamento dei videogiochi. Rispondi SOLO con 3-5 punti elenco brevi (ognuno su una riga che inizia con «• »), con le novità o correzioni più importanti. Niente introduzioni né conclusioni. Se non sono note di aggiornamento ma un annuncio, riassumi l'annuncio in 2-3 punti."},
        {"role": "user", "content": f"Gioco: {name}\nTitolo: {item.get('title')}\n\n{body}"}]}
    errors = []
    text = ""
    for url, model in ((MODELS_URL, MODEL), ("https://models.inference.ai.azure.com/chat/completions", "gpt-4o-mini")):
        req = urllib.request.Request(url, data=json.dumps({**payload, "model": model}).encode("utf-8"), headers={
            "Content-Type": "application/json", "Accept": "application/json",
            "Authorization": f"Bearer {MODELS_TOKEN}", "User-Agent": "patch-radar/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
            text = json.loads(raw)["choices"][0]["message"]["content"].strip()
            break
        except urllib.error.HTTPError as e:
            errors.append(f"{url.split('/')[2]} HTTP {e.code}: {e.read()[:200].decode('utf-8', 'replace')}")
        except Exception as e:  # noqa
            errors.append(f"{url.split('/')[2]}: {e} {raw[:80] if 'raw' in dir() else ''}")
    if not text:
        raise RuntimeError(" || ".join(errors))
    return text[:900]


def structured_lines(text):
    t = re.sub(r"\[img[^\]]*\][\s\S]*?\[/img\]", "", text or "")
    t = re.sub(r"\{STEAM_CLAN_(?:LOC_)?IMAGE\}\S*", "", t)
    t = re.sub(r"\[\*\]", "\n• ", t)
    t = re.sub(r"\[/?(?:h[1-6]|p|list|olist|quote|hr)[^\]]*\]", "\n", t)
    t = re.sub(r"<br\s*/?>|</(?:p|div|li|h[1-6])>", "\n", t)
    t = re.sub(r"\[/?[a-zA-Z][^\]]*\]|<[^>]+>", "", t)
    return [re.sub(r"\s+", " ", l).strip() for l in t.split("\n") if l.strip()]


def extractive_summary(item):
    """Riassunto senza IA: introduzione + prime voci dell'elenco, poi tradotto in italiano."""
    lines = structured_lines(item.get("contents"))
    intro = next((l for l in lines if len(l) > 50 and not l.startswith("•")), "")
    bullets = [l for l in lines if l.startswith("•") and len(l) > 18][:5]
    parts = ([intro[:220]] if intro else []) + [b[:140] for b in bullets]
    if not parts or sum(len(x) for x in parts) < 60:
        return ""
    body = urllib.parse.urlencode({"client": "gtx", "sl": "auto", "tl": "it", "dt": "t", "q": "\n".join(parts)}).encode()
    raw = http("https://translate.googleapis.com/translate_a/single", data=body, retries=2)
    out = "".join(x[0] or "" for x in json.loads(raw)[0]).strip()
    out = "\n".join(("• " + l.lstrip("• ").strip()) for l in out.split("\n") if l.strip())
    return out[:900]


def add_summaries(games, old):
    """Riporta i riassunti già fatti e ne crea di nuovi per gli annunci più recenti."""
    budget = MAX_SUMMARIES
    use_ai = None
    for g in games:
        prev = {str(i["gid"]): i for i in old.get(str(g["appid"]), {}).get("items", [])}
        for it in g["items"]:
            p = prev.get(str(it["gid"]))
            if p and p.get("summary"):
                it["summary"] = p["summary"]
    for g in games:
        for it in g["items"][:6]:
            if budget <= 0 or it.get("summary"):
                continue
            try:
                text = "" if use_ai is False else summarize(g["name"], it)
            except Exception as e:  # noqa
                print(f"  riassunto IA non disponibile, passo al metodo semplice ({str(e)[:150]})", file=sys.stderr)
                use_ai = False
                text = ""
            if not text:
                try:
                    text = extractive_summary(it)
                except Exception as e:  # noqa
                    print(f"  riassunto semplice non disponibile ({e})", file=sys.stderr)
                    return
            budget -= 1
            if text:
                it["summary"] = text
            time.sleep(4 if use_ai is None else 1)


def notify(name, item):
    if not NTFY_TOPIC:
        return
    payload = {"topic": NTFY_TOPIC, "title": f"{name}: nuovo aggiornamento",
               "message": (item.get("title") or "Nuova pubblicazione su Steam") + ("\n" + item["summary"][:300] if item.get("summary") else ""), "tags": ["video_game"]}
    if SITE_URL:
        payload["click"] = SITE_URL
    try:
        http(NTFY_URL, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, retries=2)
    except Exception as e:  # noqa
        print(f"  notifica non inviata: {e}", file=sys.stderr)


def main():
    try:
        prev = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        prev = {}
    pg = prev.get("games")
    old = {str(g["appid"]): g for g in pg if isinstance(g, dict)} if isinstance(pg, list) else {}
    games, ok = [], 0
    for g in load_games():
        key = str(g["appid"])
        name = g["name"] or old.get(key, {}).get("name") or resolve_name(g["appid"]) or f"Gioco {g['appid']}"
        try:
            items = fetch_game(g["appid"])
            ok += 1
            print(f"{name}: {len(items)} annunci")
        except Exception as e:  # noqa
            print(f"{name}: ERRORE {e} (tengo i dati precedenti)", file=sys.stderr)
            items = old.get(key, {}).get("items", [])
        games.append({"appid": g["appid"], "name": name, "items": items})
    add_summaries(games, old)
    changed = games != (pg if isinstance(pg, list) else None)
    if ok == 0:
        print("Nessun gioco aggiornato.", file=sys.stderr)
        changed = False
    if changed:
        for g in games:
            o = old.get(str(g["appid"]))
            if not o or not o.get("items"):
                continue  # gioco nuovo o prima raccolta: nessuna notifica
            known = {str(i["gid"]) for i in o["items"]}
            fresh = [i for i in g["items"] if str(i["gid"]) not in known]
            for it in fresh[:5]:
                print(f"NUOVO {g['name']}: {it.get('title')}")
                notify(g["name"], it)
        os.makedirs("data", exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump({"updated": int(time.time()), "games": games}, f, ensure_ascii=False, separators=(",", ":"))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    main()
