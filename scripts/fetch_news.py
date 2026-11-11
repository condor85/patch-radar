#!/usr/bin/env python3
"""Scarica gli annunci Steam dei giochi, li salva in data/news.json e (opzionale) invia notifiche ntfy."""
import json, os, re, sys, time, urllib.request

GAMES = {"valheim": 892970, "dragonwilds": 1374490, "enshrouded": 1203620, "crimson": 3321460}
NAMES = {"valheim": "Valheim", "dragonwilds": "RuneScape: Dragonwilds", "enshrouded": "Enshrouded", "crimson": "Crimson Desert"}
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


def notify(game_key, item):
    if not NTFY_TOPIC:
        return
    payload = {"topic": NTFY_TOPIC, "title": f"{NAMES[game_key]}: nuovo aggiornamento",
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
        prev = {"games": {}}
    old = prev.get("games", {})
    games, ok = {}, 0
    for key, appid in GAMES.items():
        try:
            games[key] = fetch_game(appid)
            ok += 1
            print(f"{key}: {len(games[key])} annunci")
        except Exception as e:  # noqa
            print(f"{key}: ERRORE {e} (tengo i dati precedenti)", file=sys.stderr)
            games[key] = old.get(key, [])
    changed = games != old
    if ok == 0:
        print("Nessun gioco aggiornato.", file=sys.stderr)
        changed = False
    if changed:
        for key, items in games.items():
            if key not in old or not old[key]:
                continue  # prima raccolta: nessuna notifica
            known = {str(i["gid"]) for i in old[key]}
            fresh = [i for i in items if str(i["gid"]) not in known]
            for it in fresh[:5]:
                print(f"NUOVO {key}: {it.get('title')}")
                notify(key, it)
        os.makedirs("data", exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump({"updated": int(time.time()), "games": games}, f, ensure_ascii=False, separators=(",", ":"))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    main()
