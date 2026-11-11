# Game Patch Radar

Web app (PWA) con le note di aggiornamento Steam dei giochi elencati in `games.json`.

- Una GitHub Action controlla Steam ogni ora, salva `data/news.json` e ripubblica il sito su GitHub Pages.
- Notifica sul telefono con [ntfy](https://ntfy.sh) quando esce una nuova patch (argomento in `config.json`).

## Aggiungere o togliere un gioco
Modifica `games.json` (anche da telefono, con l'editor web di GitHub): basta l'`appid` Steam, il nome lo trova da solo.
L'appid è il numero nell'indirizzo del negozio: `store.steampowered.com/app/`**`892970`**`/Valheim/`.
Dopo il salvataggio il sito si aggiorna da solo in circa un minuto.
