/* Costanti condivise: UNICA fonte per l'app (index.html), il service worker (sw.js) e l'Action (scripts/fetch_news.py).
   - l'app la carica con <script src="shared.js">, il service worker con importScripts("shared.js");
   - Python legge l'oggetto SHARED qui sotto come JSON: tienilo JSON valido (virgolette doppie, niente commenti dentro, niente virgole finali).
   Se cambi signVersion, le notifiche firmate con la versione vecchia non risultano più valide: aggiorna app e Action insieme. */
const SHARED = {
  "signVersion": "patch-radar-v1",
  "keywordGroups": [
    ["coop", "Co-op e multiplayer"],
    ["crash", "Crash e blocchi"],
    ["controller", "Controller e Steam Deck"],
    ["mod", "Mod e Workshop"],
    ["perf", "Prestazioni"],
    ["lang", "Lingua italiana"],
    ["save", "Salvataggi, wipe e incompatibilità"]
  ]
};
const SIGN_VERSION = SHARED.signVersion;
const KW_GROUPS = SHARED.keywordGroups;
