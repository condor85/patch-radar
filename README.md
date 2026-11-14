# Game Patch Radar

Web app (PWA) con le note di aggiornamento Steam dei giochi elencati in `games.json`.

- Una GitHub Action controlla Steam ogni ora, salva `data/news.json` e ripubblica il sito su GitHub Pages.
- Notifica sul telefono con [ntfy](https://ntfy.sh) quando esce una nuova patch (argomento in `config.json`).

## Aggiungere o togliere un gioco
**Dal telefono, senza GitHub:** ⚙ → Amministratore → password → cerca il gioco per nome (o incolla il link Steam) → «+ Aggiungi».
Serve il ponte gratuito descritto in [`worker/README.md`](worker/README.md), da installare una sola volta.

**A mano:** modifica `games.json` con l'editor web di GitHub: basta l'`appid` Steam, il nome lo trova da solo.
L'appid è il numero nell'indirizzo del negozio: `store.steampowered.com/app/`**`892970`**`/Valheim/`.
In entrambi i casi il sito si aggiorna da solo in circa un minuto.

## Funzioni

- **Home** all'apertura: l'ultima patch di ogni gioco, con titolo, etichette e riassunto; da lì si legge la nota o si passa a tutte le patch del gioco.
- **Benvenuto** alla prima apertura (installa, notifiche, giochi) e **Invita un amico** con link, QR e WhatsApp (⚙ → Condividi l'app).
- **Riepilogo** delle novità dall'ultima visita, con scorrimento tra le patch a schermo intero (swipe o frecce).
- **Etichette automatiche** (Nuovi contenuti, Bilanciamento, Prestazioni, Correzioni) e filtri; **ricerca** nei testi di tutto lo storico (fino a 60 pubblicazioni per gioco); **Salvati** per rileggere dopo.
- **Prezzo e saldi** (aggiornati dall'Action) e **giocatori online** (letti dal browser).
- **Avviso** se il controllo automatico non parte da più di 4 ore.
- **Notifiche**: solo patch vere per impostazione predefinita; opzioni per annunci/eventi, saldi, riepilogo serale (18:00) e ore silenziose (senza suono né vibrazione).
- Testo regolabile (A−/A+).
- **Solo patch grosse** (⚙ → Notifiche → per ogni gioco «Tutte» / «Solo grosse»): niente hotfix né correzioni minori. È «grossa» una patch con contenuti nuovi o cambi di bilanciamento (etichette automatiche), oppure con una versione x.0, una stagione o un'espansione nel titolo.
- **Novità rispetto alla patch precedente**: aprendo una patch uscita entro 3 settimane dalla precedente, un riquadro mostra le voci che prima non c'erano.
- **Giochi da tenere d'occhio** (👁): per un gioco che non giochi ancora, arrivano solo le patch grosse e un avviso quando il prezzo scende sotto la soglia scelta. Si imposta da ⚙ → Amministratore (casella «Solo da tenere d'occhio» in aggiunta, oppure «👁 Osserva» su un gioco già presente) o a mano in `games.json`: `{"appid": 123, "watch": true, "target": 19.99}`.
- **Squadra** (👥 in fondo alla pagina): tu e i tuoi amici entrate con un codice e un nome; su ogni gioco si tocca «🎮 Ci gioco» o «⭐ Mi interessa» e tutti vedono chi gioca a cosa, con prezzo e soglia. Il codice lo crea l'amministratore (⚙ → Amministratore → Squadra); dalla schermata Squadra si copia un link di invito. I dati stanno in un archivio privato sul ponte (non nel repository), servono il ponte Cloudflare e il suo ripubblicamento. Il codice protegge da estranei ma non è una password forte: va bene per amici fidati, e se finisce a qualcun altro basta crearne uno nuovo (i voti restano).
- **Sessioni di gioco** (nella schermata Squadra): proponi giorno e ora per un gioco, gli amici toccano «Ci sono»; ogni sessione mostra l'ultima patch del gioco (per ricordarsi di aggiornare) e ha il tasto «📅 Calendario» (file .ics). Restano visibili fino a 6 ore dopo l'inizio; nessun promemoria automatico: è il calendario del telefono a ricordarlo.
- **Note della squadra**: sotto una patch, nel visualizzatore, ognuno può lasciare una nota breve visibile agli amici (puoi eliminare solo le tue).
- **Saldi di gruppo**: un riquadro in home e nella schermata Squadra segnala i giochi in sconto (almeno −10%) scelti da due o più amici. Compare quando apri l'app; non invia notifiche.
- **💬 Al gruppo**: nel visualizzatore di una patch, un messaggio pronto per WhatsApp con gioco, versione, riassunto in italiano e link (non contiene il codice della squadra).
- **Annulla**: dopo aver aggiunto o eliminato un gioco dal telefono compare per 10 secondi il pulsante «Annulla».
- **Minimo registrato del prezzo**: l'Action salva in `data/prices.json` le variazioni di prezzo di ogni gioco; nella scheda compare il prezzo più basso visto finora («📉 Al minimo registrato» quando ci sei). Parte da quando l'app ha iniziato a seguire il gioco: non è il minimo assoluto di Steam.
- **Ritmo delle patch**: dalle ultime patch vere l'app stima ogni quanto escono e quando è attesa la prossima («🔮 Patch ogni ~3 settimane · prossima verso il 2 dic»). Serve almeno 4 patch con ritmo abbastanza regolare, altrimenti non compare. È solo indicativa.
- **Stato del ponte**: in ⚙ → Amministratore una riga dice se il ponte funziona e tra quanti giorni scade il token GitHub; se mancano 14 giorni o meno (o è scaduto) l'app lo segnala anche una volta al giorno all'apertura.

Gli argomenti ntfy sono `<argomento>-<appid>` (patch), `-major` (solo patch grosse), `-news`, `-sale`, `-target` (prezzo sotto soglia), `-digest` e `-digest-major`.

## Sicurezza

- **L'argomento ntfy non è un segreto**: sta in `config.json`, che in un repository pubblico lo rende leggibile a tutti, e chiunque lo conosca può scriverci. Due difese: le **notifiche firmate** (qui sotto) e il service worker, che dalle notifiche apre solo link dell'app e di `store.steampowered.com` / `steamcommunity.com`.
- **Ponte di amministrazione**: il token GitHub sta solo sul ponte (Cloudflare); il telefono conosce una password. Vedi `worker/README.md`.
- **Token di amministrazione** (metodo alternativo, senza ponte): è salvato nel browser. Usa un token *fine-grained* limitato a questo repository (Contents: lettura e scrittura) con scadenza (90 giorni); alla scadenza l'app lo scarta e ne chiede uno nuovo.
- **Content-Security-Policy**: `index.html` limita i domini con cui la pagina può comunicare. Se aggiungi un servizio esterno al codice, aggiungilo anche a `connect-src` (o `img-src`).
- **Servizi di terzi**: l'app legge solo dati del proprio sito (`data/news.json`, `data/players.json`, `data/prices.json`) e, per lo stato dell'Action, `api.github.com`. Anche i giocatori online li legge l'Action. L'unico uso di servizi esterni (proxy CORS) è la **ricerca per nome** nell'amministrazione, e parte solo dopo conferma; incollando il link Steam del gioco (o il numero) non si usa nulla di esterno e il nome lo ricava l'Action.
- Il nome dell'argomento è letto da `config.json`; il secret `NTFY_TOPIC` vale solo come ripiego.

### Notifiche firmate (consigliato)

L'Action firma ogni notifica con una chiave privata Ed25519 e l'app scarta quelle che non risultano firmate da lei, anche se qualcuno conosce l'argomento. Va attivata in due tempi, così non si rischia di restare senza notifiche:

1. **Crea le chiavi** sul tuo computer: `python3 scripts/gen_signing_key.py`.
2. **Fase 1 – inizia a firmare.** Salva la *chiave privata* nel secret `NTFY_SIGN_KEY` (Settings → Secrets and variables → Actions). Da ora le notifiche partono firmate, ma l'app le accetta ancora tutte. Aspetta una notifica vera (o lancia l'Action a mano dopo un nuovo annuncio) e controlla che arrivi.
3. **Fase 2 – inizia a controllare.** Scrivi la *chiave pubblica* in `config.json`: `"ntfySignKey": "…"`. Da ora l'app mostra solo le notifiche con firma valida e scarta le altre (al loro posto compare una sola notifica muta «Ignorata una notifica non autentica»).

Se dopo la fase 2 non arriva più nulla, togli `ntfySignKey` da `config.json`: la verifica si spegne. I browser senza supporto a Ed25519 (molto vecchi) accettano le notifiche, ma i link restano filtrati.

## Notifiche e salvataggio dei dati

Il controllo accoda le notifiche in `outbox.json` (non finisce nel repository); le invia un passo del workflow successivo, **solo dopo** aver salvato i dati con `git push`. Se il salvataggio fallisce la notifica non parte, e la volta dopo l'annuncio risulta ancora nuovo: niente notifiche doppie.

## Test

```
python3 -m unittest discover -s tests -v   # script di aggiornamento (fetch_news.py, firma, coda notifiche)
node tests/sw.test.js                      # service worker (cache, notifiche, firme verificate con WebCrypto)
node tests/worker.test.mjs                 # ponte di amministrazione
node tests/cadence.test.js                 # stima del ritmo delle patch
```
