#!/usr/bin/env python3
"""Imposta la versione dell'app nel sito che sta per essere pubblicato, calcolandola dal contenuto dei file.

Uso: python3 scripts/stamp_version.py _site

Prima la versione stava in 4 punti da aggiornare a mano (APP_VERSION, i ?v= degli script, il nome della cache del service worker):
dimenticarne uno faceva mescolare pagina nuova e script vecchi nella cache del browser. Qui l'impronta (SHA-256) dei file dell'app
si aggiunge alla versione scritta nei sorgenti, in tutti i punti insieme: cambia solo quando cambia un file, quindi i controlli
orari che non modificano il codice non invalidano la cache. Il repository resta com'è: si modifica solo la copia in _site/."""
import hashlib
import os
import re
import sys

APP_FILES = ["index.html", "sw.js", "shared.js", "qr.js", "manifest.webmanifest"]
VERSION_RE = re.compile(r'const APP_VERSION = "([^"]+)"')
CACHE_RE = re.compile(r'const CACHE = "(patch-radar-[A-Za-z0-9._-]+)"')
STAMPED_RE = re.compile(r"-[0-9a-f]{8}$")


def app_files(site):
    js = sorted(os.path.join("js", f) for f in os.listdir(os.path.join(site, "js")) if f.endswith(".js"))
    return APP_FILES + js


def digest(site):
    h = hashlib.sha256()
    for name in app_files(site):
        with open(os.path.join(site, name), "rb") as f:
            data = f.read()
        h.update(name.encode() + b"\0" + str(len(data)).encode() + b"\0" + data)
    return h.hexdigest()[:8]


def stamp(site):
    """Ritorna la nuova versione. Prepara tutto in memoria e scrive solo alla fine: un errore non lascia file a metà."""
    index_path, sw_path = os.path.join(site, "index.html"), os.path.join(site, "sw.js")
    with open(index_path, encoding="utf-8") as f:
        index = f.read()
    with open(sw_path, encoding="utf-8") as f:
        sw = f.read()
    m = VERSION_RE.search(index)
    c = CACHE_RE.search(sw)
    if not m or not c:
        raise SystemExit("Non trovo APP_VERSION in index.html o il nome della cache in sw.js")
    if len(VERSION_RE.findall(index)) != 1 or len(CACHE_RE.findall(sw)) != 1:
        raise SystemExit("APP_VERSION o il nome della cache compaiono più di una volta")
    old = STAMPED_RE.sub("", m.group(1))          # rieseguirlo sullo stesso sito non allunga la versione
    h = digest(site)
    new = f"{old}-{h}"
    tags = re.findall(r'<script src="[^"]+\?v=([^"]+)"></script>', index)
    if not tags or any(STAMPED_RE.sub("", t) != old for t in tags):
        raise SystemExit("I ?v= degli script non corrispondono ad APP_VERSION")
    index = re.sub(r'(<script src="[^"]+\?v=)[^"]+("></script>)', lambda x: x.group(1) + new + x.group(2), index)
    index = VERSION_RE.sub(f'const APP_VERSION = "{new}"', index)
    cache_base = STAMPED_RE.sub("", c.group(1))
    sw = CACHE_RE.sub(f'const CACHE = "{cache_base}-{h}"', sw)
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(index)
    with open(sw_path, "w", encoding="utf-8") as f:
        f.write(sw)
    return new


def main(argv):
    if len(argv) != 2:
        raise SystemExit(__doc__)
    print("Versione dell'app:", stamp(argv[1]))


if __name__ == "__main__":
    main(sys.argv)
