"""Avviso all'amministratore quando l'aggiornamento orario fallisce due volte di fila.

Lo lancia il workflow «Aggiorna patch» (job `stato`) a fine esecuzione:
  RESULT=failure  → se anche l'esecuzione precedente (non annullata) era fallita, apre UNA segnalazione sul repository
                    (GitHub manda un'email al proprietario); se ce n'è già una aperta non ne apre altre.
  RESULT=success  → chiude la segnalazione aperta, scrivendo che è tutto tornato a posto.
Nessun segreto: usa solo il token del workflow (permessi `issues: write` e `actions: read`, solo in quel job).
Un errore qui non deve mai far fallire il workflow (il job è `continue-on-error`)."""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
LABEL = "aggiornamento-fermo"
BAD = ("failure", "timed_out")      # esecuzioni da considerare fallite
IGNORED = ("cancelled", "skipped")  # non dicono nulla sullo stato di salute: si saltano


def api(path, method="GET", body=None, token=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "patch-radar-alert",
        "Authorization": "Bearer " + (token or os.environ.get("GH_TOKEN", "")), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read(2_000_000)
    return json.loads(raw) if raw else {}


def previous_conclusion(repo, run_id, call=api):
    """Esito dell'ultima esecuzione conclusa prima di questa (saltando quelle annullate), o None se non si sa."""
    d = call(f"/repos/{repo}/actions/workflows/update.yml/runs?status=completed&per_page=10")
    for run in d.get("workflow_runs") or []:
        if str(run.get("id")) == str(run_id) or run.get("conclusion") in IGNORED:
            continue
        return run.get("conclusion")
    return None


def open_issues(repo, call=api):
    d = call(f"/repos/{repo}/issues?state=open&labels={LABEL}&per_page=5")
    return [i for i in d if isinstance(i, dict) and "pull_request" not in i] if isinstance(d, list) else []


def handle(result, repo, run_id, run_url, call=api):
    """Ritorna una descrizione di cosa ha fatto (per il log)."""
    if result in BAD:
        if previous_conclusion(repo, run_id, call) not in BAD:
            return "primo fallimento: aspetto la prossima esecuzione prima di avvisare"
        if open_issues(repo, call):
            return "segnalazione già aperta"
        call(f"/repos/{repo}/issues", "POST", {"title": "L'aggiornamento orario è fermo", "labels": [LABEL], "body": (
            "L'aggiornamento dei dati è fallito **due volte di fila**: l'app mostra dati che potrebbero essere vecchi.\n\n"
            f"Ultima esecuzione fallita: {run_url}\n\n"
            "Cause frequenti: Steam o Gemini che non rispondono, `games.json` non valido, un token scaduto. "
            "Il dettaglio è nel log dell'esecuzione e nel riepilogo in cima alla pagina.\n\n"
            "Questa segnalazione si chiude da sola alla prossima esecuzione riuscita.")})
        return "segnalazione aperta"
    if result == "success":
        found = open_issues(repo, call)
        for i in found:
            call(f"/repos/{repo}/issues/{i['number']}/comments", "POST", {"body": f"Tutto a posto: l'esecuzione {run_url} è riuscita."})
            call(f"/repos/{repo}/issues/{i['number']}", "PATCH", {"state": "closed", "state_reason": "completed"})
        return f"{len(found)} segnalazioni chiuse" if found else "nulla da fare"
    return "esito non rilevante"


def main():
    repo, run_id = os.environ.get("REPO", ""), os.environ.get("RUN_ID", "")
    if not repo or not run_id:
        print("REPO e RUN_ID mancanti", file=sys.stderr)
        return 1
    run_url = os.environ.get("RUN_URL") or f"https://github.com/{repo}/actions/runs/{run_id}"
    try:
        print(handle(os.environ.get("RESULT", ""), repo, run_id, run_url))
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"avviso non inviato: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
