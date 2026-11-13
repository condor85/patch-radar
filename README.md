# Game Patch Radar

Web app (PWA) con le note di aggiornamento Steam dei giochi elencati in `games.json`.

- Una GitHub Action controlla Steam ogni ora, salva `data/news.json` e ripubblica il sito su GitHub Pages.
- Notifica sul telefono con [ntfy](https://ntfy.sh) quando esce una nuova patch (argomento in `config.json`).

## Aggiungere o togliere un gioco
Modifica `games.json` (anche da telefono, con l'editor web di GitHub): basta l'`appid` Steam, il nome lo trova da solo.
L'appid è il numero nell'indirizzo del negozio: `store.steampowered.com/app/`**`892970`**`/Valheim/`.
Dopo il salvataggio il sito si aggiorna da solo in circa un minuto.

## Funzioni

- **Benvenuto** alla prima apertura (installa, notifiche, giochi) e **Invita un amico** con link, QR e WhatsApp (⚙ → Condividi l'app).
- **Riepilogo** delle novità dall'ultima visita, con scorrimento tra le patch a schermo intero (swipe o frecce).
- **Etichette automatiche** (Nuovi contenuti, Bilanciamento, Prestazioni, Correzioni) e filtri; **ricerca** nei testi di tutto lo storico (fino a 60 pubblicazioni per gioco); **Salvati** per rileggere dopo.
- **Prezzo e saldi** (aggiornati dall'Action) e **giocatori online** (letti dal browser).
- **Avviso** se il controllo automatico non parte da più di 4 ore.
- **Notifiche**: solo patch vere per impostazione predefinita; opzioni per annunci/eventi, saldi, riepilogo serale (18:00) e ore silenziose (senza suono né vibrazione).
- Testo regolabile (A−/A+).

Gli argomenti ntfy sono `<argomento>-<appid>` (patch), `-news`, `-sale`, `-digest`.
