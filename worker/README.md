# Ponte di amministrazione (Cloudflare Worker)

## Metodo rapido (consigliato): installazione automatica
Serve solo creare 4 secret in GitHub (Settings → Secrets and variables → Actions); poi Actions → «Installa ponte Cloudflare» → Run workflow.
Il workflow pubblica il ponte, imposta le variabili e scrive `adminApi` in `config.json` da solo.

| Secret | Valore |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → modello «Edit Cloudflare Workers» |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages (colonna destra) → Account ID |
| `BRIDGE_GITHUB_TOKEN` | token GitHub fine-grained, solo `patch-radar`, Contents: Read and write |
| `ADMIN_PASSWORD` | una frase lunga (almeno 12 caratteri) |

Prima volta: apri una volta *Workers & Pages* su Cloudflare e, se te lo chiede, scegli il nome del tuo sottodominio `workers.dev`.

## Metodo manuale
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

Il blocco di 15 minuti dopo 5 password sbagliate usa l'archivio `TEAM` (Durable Object), presente con l'installazione automatica.
Solo per un ponte creato a mano **senza** `TEAM`: crea un archivio KV chiamato `RL` e collegalo al ponte con lo stesso nome (*Settings → Bindings*).

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
- Può cambiare **solo** `games.json` (aggiungi/togli, stato «da tenere d'occhio» e soglia di prezzo) e l'argomento notifiche in `config.json`. Con `/status` dice se il token GitHub funziona e tra quanti giorni scade. Il nome del gioco lo legge da Steam, non dal telefono; tetto di 40 giochi; almeno uno deve restare.
- Gli errori verso l'app sono generici: token e dettagli interni non vengono mai mostrati.
- Se non vuoi usare il ponte, lascia `adminApi` vuoto: l'app torna al vecchio metodo con il token personale.

## Squadra
Il ponte tiene anche l'archivio privato della squadra (un Durable Object chiamato `TEAM`, dichiarato in `wrangler.toml`, nessun costo sul piano gratuito).
L'amministratore crea il codice con `/team/setup`; gli amici entrano con `/team/join` e votano con `/team/vote` (il codice sta nell'intestazione `Authorization`). Con `/team/session` e `/team/note` gestisce anche le sessioni di gioco (massimo 40) e le note sulle patch (massimo 20 per patch, 200 in tutto, 280 caratteri). Dopo 8 codici sbagliati l'indirizzo viene bloccato per 15 minuti.
Se il ponte è stato creato a mano dal pannello Cloudflare, per questa funzione va ripubblicato con il metodo automatico (o `npx wrangler deploy`).

## Test
`node tests/worker.test.mjs`
