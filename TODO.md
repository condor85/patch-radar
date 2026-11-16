# Da fare

Idee per Game Patch Radar, in ordine di priorità.

- [x] Aggiungere giochi dal telefono senza toccare GitHub (ponte Cloudflare, `worker/`)
- [x] Schermata principale con l'ultima patch di ogni gioco
- [x] Grafica più semplice: azioni ridotte sulle schede, tasto «Leggi» in evidenza
- [x] Installare il ponte: creare i 4 secret e lanciare «Installa ponte Cloudflare» (vedi `worker/README.md`)
- [x] Silenziare le notifiche di un singolo gioco dalla sua pagina (campanella 🔔/🔕)
- [x] Segnare come letta una singola patch (oggi si segnano tutte le patch di un gioco aprendolo)
- [x] Riassunti: in alcuni appaiono frasi di servizio dell'IA («Check word count…», es. Enshrouded) → filtrarle in `scripts/fetch_news.py`
- [x] Copertine: quando Steam non risponde mostrare un riquadro con le iniziali invece del vuoto
- [x] Notifiche per gioco «solo patch grosse»
- [x] Confronto con la patch precedente nel visualizzatore
- [x] Giochi da tenere d'occhio con soglia di prezzo
- [x] «Annulla» dopo aggiunta/rimozione di un gioco
- [x] Stato del ponte Cloudflare (token in scadenza)
- [x] Salvataggio/sincronizzazione di «letto» e «salvati» tra dispositivi, con codice personale (⚙ → Sincronizza tra dispositivi)
- [x] Squadra: «Ci gioco» / «Mi interessa», codice del gruppo, schermata Squadra
- [x] Squadra: messaggio pronto per WhatsApp, saldi di gruppo (in app), sessioni di gioco con .ics, note sulle patch
- [x] Minimo registrato del prezzo e stima del ritmo delle patch
- [x] Avvisi per argomento (co-op, crash, controller, mod, prestazioni, lingua italiana) anche per le patch piccole
- [x] Test automatici prima della pubblicazione (`.github/workflows/tests.yml`)
- [x] Diario del gioco: avviso per lingua italiana, uscita dall'accesso anticipato, nuovi DLC
- [x] Notifica «patch stabile» dopo 48 ore senza hotfix
- [x] Condividi da Steam verso l'app (share_target)
- [x] Gruppo di parole «Salvataggi, wipe e incompatibilità»
- [x] Numero di versione in alto accanto al nome e finestra «Novità dell'app» con il registro delle modifiche (`js/changelog.js`; dal 15 nov 2026 ogni modifica visibile aggiunge una voce e alza la versione)
- [x] Rafforzamento di sicurezza e robustezza (15 nov 2026): dati illeggibili che non vengono più azzerati, scritture atomiche, verifica delle firme anche offline, azioni GitHub fissate a un commit, Gemini con risposte strutturate, versione dell'app generata a ogni pubblicazione (`SECURITY.md`)
- [x] `index.html` spezzato in file `js/*.js` (caricati in ordine da `index.html`; il test `tests/structure.test.js` ne controlla l'elenco) e costanti comuni in `shared.js` (`KW_GROUPS`, `SIGN_VERSION`, lette anche da Python e dal service worker)
- [x] Elenco giochi senza scorrimento laterale (16 nov 2026): con più di 5 giochi la barra mostra Home, «Giochi», il gioco aperto e quello con più novità; il pulsante apre una griglia con ricerca e ordinamento (`js/games-panel.js`)

## Idee da fare (proposte il 15 nov 2026)
- [ ] Rientro in gioco: per ogni gioco imposti «non gioco da…» e vedi un solo riassunto di cosa è cambiato (finestre di 30 e 90 giorni), generato da Gemini nell'Action
- [ ] Chiedi alle patch: domanda in italiano e risposta basata sullo storico, con link alle patch citate (endpoint sul ponte che chiama Gemini, limitato per codice personale)
- [ ] Prossimamente: sezione con uscite e date annunciate (`release_date` dei titoli non ancora usciti e frasi tipo «arriva il 5 dicembre»), con conto alla rovescia e file .ics
- [ ] Importa dalla libreria Steam: incolli il profilo pubblico e l'app propone i giochi giocati di recente (serve una chiave Web API Steam gratuita sul ponte)
- [ ] (da valutare) Parole chiave personalizzate per gioco: richiede di salvare le parole sul ponte, perché i nomi degli argomenti ntfy non le possono contenere
- [ ] (da valutare) «Patch stabile»: aggiungere il confronto delle recensioni recenti Steam prima e dopo la patch; diario del gioco: stato Steam Deck
- [ ] Verificare su un telefono Android la condivisione da Steam (potrebbe servire reinstallare l'app) e al primo controllo che i dati della scheda Steam (lingue, generi, DLC) vengano letti davvero

## Consigli tecnici (15 nov 2026)
Per rendere il progetto più solido e più facile da far crescere. In ordine di valore; sono tutte cose che si possono provare da sole, senza toccare il formato dei dati né le chiavi di «letto» e «salvati».
- [x] **Prova automatica nel browser (Playwright, in CI):** apre l'app con dati finti e controlla che non ci siano errori in console, che si apra un gioco, il lettore, le impostazioni e la finestra delle novità. È la rete di sicurezza che oggi manca sul frontend: con quella, ogni modifica all'interfaccia si verifica prima della pubblicazione.
- [x] **Riepilogo di ogni aggiornamento orario** (`$GITHUB_STEP_SUMMARY`): giochi controllati, annunci nuovi, riassunti e traduzioni riusciti/falliti, modello Gemini usato, quota esaurita sì/no, durata. Oggi per capire perché un riassunto manca bisogna leggere i log.
- [x] **Avviso di dati vecchi:** se `updated` in `news.json` è più vecchio di qualche ora (Action ferma, Steam o Gemini in errore), l'app lo dice in modo visibile; in più una notifica all'amministratore quando l'Action fallisce due volte di fila.
- [x] **Esporta/importa i tuoi dati** (giochi, letto, salvati, preferenze) in un file, per chi non usa il codice di sincronizzazione o cambia telefono: stesso formato già usato da `sync.js`.
- [x] **Controlli di accessibilità** (contrasto, tasti raggiungibili da tastiera, `aria-live` sui messaggi di stato) con Lighthouse o axe nella prova del browser.
- [x] **Registro delle modifiche del ponte:** ogni modifica ai giochi fatta dal telefono lascia una riga leggibile (chi, cosa, quando) nel messaggio del commit, per capire a posteriori cosa è cambiato.
- [ ] (da valutare) Ponte Cloudflare: usare il limitatore di richieste nativo di Cloudflare al posto del contatore nel Durable Object, e togliere `'unsafe-inline'` dagli script nella CSP (serve spostare gli script in linea di `index.html` in file o usare un hash).
- [ ] (da valutare) Rimuovere il vecchio accesso con token GitHub nel browser (oggi non usato quando il ponte è configurato).

### Come rilasciare una modifica
1. Aggiungi in cima a `CHANGELOG` in `js/changelog.js` una voce con la nuova versione, la data e le modifiche scritte per chi usa l'app.
2. Porta `APP_VERSION` in `index.html` e tutti i `?v=` degli script alla stessa versione (numerazione `1.<novità>.<correzioni>`). `tests/changelog.test.js` e `tests/structure.test.js` falliscono se qualcosa non coincide.
3. Alla pubblicazione la versione viene completata da sola con un'impronta dei file (`scripts/stamp_version.py`).
