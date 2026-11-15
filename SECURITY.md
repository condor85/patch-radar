# Sicurezza

## Come è protetta l'app

- **Nessun segreto nel repository.** Token GitHub, password dell'amministratore, chiave Gemini e chiave di firma delle notifiche stanno solo nei *Secrets* di GitHub e di Cloudflare.
- **Il telefono non ha mai il token GitHub.** Per modificare l'elenco giochi conosce solo una password; il token resta sul ponte Cloudflare (`worker/`). Le password sbagliate vengono contate per indirizzo e dopo pochi tentativi l'accesso si blocca per qualche minuto.
- **Notifiche firmate.** L'argomento ntfy è pubblico, quindi l'Action firma ogni notifica (Ed25519) e il service worker scarta quelle senza firma valida o troppo vecchie. I link nelle notifiche sono ammessi solo verso l'app e Steam.
- **Contenuti esterni mai trattati come HTML.** Testi, titoli e nomi che arrivano da Steam si inseriscono con `textContent`; la Content-Security-Policy limita script, immagini e connessioni ai domini necessari.
- **Workflow ridotti al minimo.** Le azioni GitHub sono fissate a un commit preciso (Dependabot le aggiorna), il workflow di test è in sola lettura e nessun valore esterno viene inserito dentro gli script di shell. `tests/test_workflows.py` controlla queste regole.
- **Dati non rigenerabili al sicuro.** Se `data/news.json` o `data/prices.json` esistono ma sono rovinati, l'Action si ferma con un errore invece di ripartire da zero; le scritture sono atomiche.

## Segnalare un problema

Apri una *Security advisory* privata dalla scheda **Security** del repository (oppure una issue, senza dettagli sensibili). Se pensi che un token o la password siano trapelati: revocali subito da GitHub/Cloudflare, poi cambia i secret e lancia di nuovo «Installa ponte Cloudflare».
