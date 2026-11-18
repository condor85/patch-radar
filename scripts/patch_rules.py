"""Regole sulle note di aggiornamento: cos'è una patch, etichette, patch «grossa», parole chiave.

Sono funzioni pure (nessuna rete, nessun file tranne shared.js, nessuno stato globale che cambia): si provano da sole e
fetch_news.py le importa. Le costanti condivise con l'app e il service worker arrivano da shared.js, la fonte unica."""
import json
import os
import re


def _load_shared():
    """Costanti condivise con l'app e il service worker: la fonte unica è shared.js (l'oggetto SHARED è JSON valido)."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shared.js")
    with open(path, encoding="utf-8") as f:
        m = re.search(r"const SHARED = (\{.*?\n\});", f.read(), re.S)
    if not m:
        raise SystemExit("shared.js: non trovo l'oggetto SHARED")
    return json.loads(m.group(1))


SHARED = _load_shared()


_KNOWN_TAGS = r"(?:b|i|u|strike|spoiler|noparse|url|td|th|tr|table|code|expand|center|left|right|sub|sup|carousel|video|previewyoutube|youtube|dynamiclink|img|h[1-6]|p|list|olist|quote|hr|\*)"


def strip_markup(t, sep=""):
    """Toglie il BBCode e l'HTML di Steam senza perdere testo vero. Steam scrive le parentesi quadre letterali con la barra
    rovesciata («\\[AMD] Fixed…», «\\[ESC]», «\\[RMB]+\\[SPACE]»): quelle sono parole dell'autore (piattaforma, personaggio, tasto)
    e restano, senza barra. Si tolgono solo i tag veri: le chiusure («[/x]»), i tag noti e quelli con attributi («[x href=…]»)."""
    t = re.sub(r"(?<!\\)\[/[a-zA-Z0-9*]+\]", sep, t)
    t = re.sub(r"(?<!\\)\[" + _KNOWN_TAGS + r"(?:[= ][^\]]*)?\]", sep, t, flags=re.I)
    t = re.sub(r"(?<!\\)\[[a-zA-Z][a-zA-Z0-9]*(?: [a-zA-Z-]+=[^\]]*|=[^\]]*)\]", sep, t)
    t = re.sub(r"</?[a-zA-Z][^<>]*>", sep, t)   # solo HTML vero: «se vita < 5 e danno > 3» resta com'è
    return re.sub(r"\\([\[\]])", r"\1", t)


def structured_lines(text):
    t = re.sub(r"\[img[^\]]*\][\s\S]*?\[/img\]", "", text or "")
    t = re.sub(r"\{STEAM_CLAN_(?:LOC_)?IMAGE\}\S*", "", t)
    t = re.sub(r"(?<!\\)\[\*\]", "\n• ", t)
    t = re.sub(r"(?<!\\)\[h[1-6](?:[= ][^\]]*)?\]", "\n# ", t)
    t = re.sub(r"(?<!\\)\[/?(?:h[1-6]|p|list|olist|quote|hr)(?:[= ][^\]]*)?\]", "\n", t)
    t = re.sub(r"<br\s*/?>|</(?:p|div|li|h[1-6])>", "\n", t)
    t = strip_markup(t)
    return [re.sub(r"\s+", " ", l).strip() for l in t.split("\n") if l.strip()]


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


MAJOR_TITLE_RE = re.compile(r"\bmajor update\b|\bseason \d|\bexpansion\b|(?<![\d.])v?\d+\.0(?:\.0)?(?![\d.])", re.I)


def is_major(item):
    """Patch «grossa»: porta contenuti nuovi o cambi di bilanciamento (etichette), oppure ha nel titolo una versione x.0,
    una stagione o un'espansione. Hotfix e sole correzioni non lo sono."""
    if not item.get("patch"):
        return False
    labels = item.get("labels") or []
    if "new" in labels or "balance" in labels:
        return True
    title = item.get("title") or ""
    return bool(MAJOR_TITLE_RE.search(title)) and not re.search(r"hotfix|hot fix", title, re.I)


# Avvisi per parola chiave: gruppi fissi (l'app si iscrive a un argomento per gioco e per gruppo, quindi l'elenco deve essere
# lo stesso lato app). Id, nome mostrato e ordine arrivano da shared.js (KW_GROUPS nell'app); qui restano solo le espressioni
# cercate nel titolo e nel testo, che servono soltanto all'Action.
_KEYWORD_PATTERNS = {
    "coop": re.compile(r"\bco-?op\b|\bmulti-?player\b|\bdedicated servers?\b|\bsplit-?screen\b|\bcross-?play\b|\bcross-?platform\b", re.I),
    "crash": re.compile(r"\bcrash(?:es|ed|ing)?\b|\bfreez(?:e|es|ing)\b|\bsoft-?lock\w*|\bcorrupt\w*|\bstuck\b", re.I),
    "controller": re.compile(r"\bcontrollers?\b|\bgamepads?\b|\bsteam deck\b|\bdualsense\b|\bdualshock\b|\brebind\w*", re.I),
    "mod": re.compile(r"\bmods?\b|\bmodding\b|\bworkshop\b", re.I),
    "perf": re.compile(r"\bperformance\b|\boptimi[sz]\w*|\bfps\b|\bframe ?rate\b|\bstutter\w*|\bmemory leak", re.I),
    "lang": re.compile(r"\bitalian\b|\bitaliano\b|\blocali[sz]ation\b|\btranslations?\b", re.I),
    "save": re.compile(r"\bsave ?(?:games?|files?|data)\b|\bsaves\b|\b(?:character |progress |server )?wipes?\b|\bincompatib\w*|\bbackwards? compat\w*|\bno longer compatible\b|\bbreaking changes?\b", re.I),
}
if [gid for gid, _ in SHARED["keywordGroups"]] != list(_KEYWORD_PATTERNS):
    raise SystemExit("I gruppi di parole chiave di shared.js e le espressioni di fetch_news.py non coincidono (stessi id, stesso ordine)")
KEYWORD_GROUPS = {gid: (name, _KEYWORD_PATTERNS[gid]) for gid, name in SHARED["keywordGroups"]}   # id -> (nome mostrato, espressione)


def keywords_of(item):
    """Gruppi di parole chiave presenti nel titolo o nel testo di una patch (nell'ordine di KEYWORD_GROUPS)."""
    text = (item.get("title") or "") + "\n" + " ".join(structured_lines(item.get("contents")))
    return [gid for gid, (_, rx) in KEYWORD_GROUPS.items() if rx.search(text)]
