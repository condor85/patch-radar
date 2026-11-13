#!/usr/bin/env python3
"""Aggiunge alla Content-Security-Policy del sito pubblicato l'indirizzo del ponte di amministrazione.

Uso: python3 scripts/csp_admin.py config.json _site/index.html

L'indirizzo sta in config.json ("adminApi"). Se manca, la pagina resta com'è. Se c'è, deve essere solo un'origine
https (niente percorso, porta, parametri o caratteri strani): così il file di configurazione non può allargare la
policy oltre un singolo dominio.
"""
import json
import re
import sys

ORIGIN_RE = re.compile(r"^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")
MARKER = "connect-src 'self' "


def inject(config_text, html):
    try:
        origin = (json.loads(config_text) or {}).get("adminApi")
    except ValueError:
        raise SystemExit("config.json non è un JSON valido")
    if not origin:
        return html
    if not isinstance(origin, str) or not ORIGIN_RE.fullmatch(origin):
        raise SystemExit("adminApi non valido: serve solo l'indirizzo https del ponte, ad esempio https://nome.utente.workers.dev")
    if html.count(MARKER) != 1:
        raise SystemExit("Non trovo la riga connect-src nella Content-Security-Policy di index.html")
    return html.replace(MARKER, MARKER + origin + " ", 1)


def main(argv):
    if len(argv) != 3:
        raise SystemExit(__doc__)
    config_path, html_path = argv[1], argv[2]
    with open(config_path, encoding="utf-8") as f:
        config_text = f.read()
    with open(html_path, encoding="utf-8") as f:
        html = f.read()
    out = inject(config_text, html)
    if out != html:
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(out)


if __name__ == "__main__":
    main(sys.argv)
