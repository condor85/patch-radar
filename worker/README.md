# Ponte di amministrazione (Cloudflare Worker)

Serve a **aggiungere o togliere giochi dall'app senza toccare GitHub**: sul telefono inserisci una password, il token GitHub
resta sul ponte e non esce mai da lì. Il ponte controlla su Steam che il gioco esista e ne legge il nome da solo.

Costo: zero (piano gratuito di Cloudflare). Tempo: circa 10 minuti, una volta sola.

## 1. Token GitHub (solo per il ponte)
1. Apri <https://github.com/settings/personal-access-tokens/new>.
2. Nome «patch-radar-ponte», scadenza di 1 anno.
3. *Repository access* → *Only select repositories* → `patch-radar`.
4. *Permissions* → *Repository permissions* → **Contents: Read and write** (nient'altro).
5. Genera il token e **tienilo da parte** (lo incollerai al punto 3).

## 2. Crea il ponte su Cloudflare
1. Crea un account gratuito su <https://dash.cloudflare.com>.
2. *Workers & Pages* → *Create* → *Create Worker*, nome `patch-radar-admin` → *Deploy*.
3. *Edit code*: cancella tutto, incolla il contenuto di `worker/worker.js` e premi *Deploy*.

## 3. Impostazioni del ponte (Settings → Variables and Secrets)
| Nome | Tipo | Valore |
|---|---|---|
| `GITHUB_TOKEN` | Secret | il token del punto 1 |
| `ADMIN_PASSWORD` | Secret | una password **lunga** (almeno 12 caratteri, meglio una frase) |
| `REPO` | Testo | `condor85/patch-radar` |
| `ALLOWED_ORIGIN` | Testo | `https://condor85.github.io` (solo l'indirizzo, senza `/patch-radar`) |

**Consigliato:** crea un archivio KV (*Storage & Databases → KV*) chiamato `RL` e collegalo al ponte con il nome `RL`
(*Settings → Bindings*). Serve a bloccare per 15 minuti chi sbaglia la password 5 volte.

## 4. Collega l'app al ponte
Copia l'indirizzo del ponte (tipo `https://patch-radar-admin.TUONOME.workers.dev`) e scrivilo in `config.json`:

```json
"adminApi": "https://patch-radar-admin.TUONOME.workers.dev"
```

Al successivo aggiornamento il sito lo aggiunge da solo alle regole di sicurezza (Content-Security-Policy).
Poi sul telefono: ⚙ → Amministratore → inserisci la password. Da quel momento «Aggiungi un gioco» scrive tutto da solo.

## Sicurezza
- Il telefono non ha mai il token GitHub: perso il telefono, basta cambiare `ADMIN_PASSWORD` sul ponte.
- Il ponte accetta solo richieste dall'origine del sito (`ALLOWED_ORIGIN`) e risponde solo con la password giusta (confronto a tempo costante).
- Può cambiare **solo** `games.json` (aggiungi/togli) e l'argomento notifiche in `config.json`. Il nome del gioco lo legge da Steam, non dal telefono; tetto di 40 giochi; almeno uno deve restare.
- Gli errori verso l'app sono generici: token e dettagli interni non vengono mai mostrati.
- Se non vuoi usare il ponte, lascia `adminApi` vuoto: l'app torna al vecchio metodo con il token personale.

## Test
`node tests/worker.test.mjs`
