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
- [x] `index.html` spezzato in file `js/*.js` (caricati in ordine da `index.html`; il test `tests/structure.test.js` ne controlla l'elenco) e costanti comuni in `shared.js` (`KW_GROUPS`, `SIGN_VERSION`, lette anche da Python e dal service worker)

## Idee da fare (proposte il 15 nov 2026)
- [ ] Rientro in gioco: per ogni gioco imposti «non gioco da…» e vedi un solo riassunto di cosa è cambiato (finestre di 30 e 90 giorni), generato da Gemini nell'Action
- [ ] Chiedi alle patch: domanda in italiano e risposta basata sullo storico, con link alle patch citate (endpoint sul ponte che chiama Gemini, limitato per codice personale)
- [ ] Prossimamente: sezione con uscite e date annunciate (`release_date` dei titoli non ancora usciti e frasi tipo «arriva il 5 dicembre»), con conto alla rovescia e file .ics
- [ ] Importa dalla libreria Steam: incolli il profilo pubblico e l'app propone i giochi giocati di recente (serve una chiave Web API Steam gratuita sul ponte)
- [ ] (da valutare) Parole chiave personalizzate per gioco: richiede di salvare le parole sul ponte, perché i nomi degli argomenti ntfy non le possono contenere
- [ ] (da valutare) «Patch stabile»: aggiungere il confronto delle recensioni recenti Steam prima e dopo la patch; diario del gioco: stato Steam Deck
- [ ] Verificare su un telefono Android la condivisione da Steam (potrebbe servire reinstallare l'app) e al primo controllo che i dati della scheda Steam (lingue, generi, DLC) vengano letti davvero
