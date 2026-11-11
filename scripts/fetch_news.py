#!/usr/bin/env python3
"""Scarica gli annunci Steam dei giochi, li salva in data/news.json e (opzionale) invia notifiche ntfy."""
import json, os, re, sys, time, urllib.request

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
KEEP = ("gid", "title", "url", "contents", "date", "feedlabel", "feedname", "author")
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


def notify(name, item):
    if not NTFY_TOPIC:
        return
    payload = {"topic": NTFY_TOPIC, "title": f"{name}: nuovo aggiornamento",
               "message": item.get("title") or "Nuova pubblicazione su Steam", "tags": ["video_game"]}
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
