# Game Patch Radar

Web app (PWA) con le note di aggiornamento Steam di Valheim, RuneScape: Dragonwilds, Enshrouded e Crimson Desert.

- Una GitHub Action controlla Steam ogni ora, salva `data/news.json` e ripubblica il sito su GitHub Pages.
- Opzionale: notifica sul telefono con [ntfy](https://ntfy.sh) quando esce una nuova patch (argomento in `config.json`).

## Attivazione
1. Settings → Pages → Source: **GitHub Actions**.
2. Actions → "Aggiorna patch" → **Run workflow**.
3. (Opzionale) Installa l'app ntfy, iscriviti a un nome casuale (es. `patch-radar-x7k2q9`) e aggiungi lo stesso nome in Settings → Secrets and variables → Actions → `NTFY_TOPIC`.
