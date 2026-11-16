"""Test di scripts/alert_failures.py (avviso dopo due fallimenti di fila). Si lanciano dalla radice:  python3 -m unittest discover -s tests -v"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import alert_failures as af  # noqa: E402


class FakeGitHub:
    """Finto GitHub: risponde alle chiamate dello script e le registra."""

    def __init__(self, runs=(), issues=()):
        self.runs, self.issues, self.calls = list(runs), list(issues), []

    def __call__(self, path, method="GET", body=None):
        self.calls.append((method, path, body))
        if "/actions/workflows/" in path:
            return {"workflow_runs": self.runs}
        if path.startswith("/repos/o/r/issues?"):
            return self.issues
        return {}

    def writes(self):
        return [c for c in self.calls if c[0] != "GET"]


def run(id_, conclusion):
    return {"id": id_, "conclusion": conclusion}


class Alert(unittest.TestCase):
    def test_first_failure_does_not_alert(self):
        gh = FakeGitHub(runs=[run(9, "success")])
        self.assertIn("primo fallimento", af.handle("failure", "o/r", 10, "u", gh))
        self.assertEqual(gh.writes(), [])

    def test_two_failures_in_a_row_open_one_issue(self):
        gh = FakeGitHub(runs=[run(9, "failure")])
        af.handle("failure", "o/r", 10, "https://run", gh)
        (method, path, body), = gh.writes()
        self.assertEqual((method, path), ("POST", "/repos/o/r/issues"))
        self.assertIn("https://run", body["body"])
        self.assertEqual(body["labels"], [af.LABEL])

    def test_no_second_issue_while_one_is_open(self):
        gh = FakeGitHub(runs=[run(9, "failure")], issues=[{"number": 5}])
        self.assertEqual(af.handle("failure", "o/r", 10, "u", gh), "segnalazione già aperta")
        self.assertEqual(gh.writes(), [])

    def test_cancelled_and_current_runs_are_skipped_when_looking_back(self):
        gh = FakeGitHub(runs=[run(10, "failure"), run(9, "cancelled"), run(8, "failure")])
        af.handle("failure", "o/r", 10, "u", gh)
        self.assertEqual(len(gh.writes()), 1)   # il 9 annullato non conta, l'8 fallito sì
        self.assertEqual(af.previous_conclusion("o/r", 10, gh), "failure")

    def test_timeout_counts_as_failure(self):
        gh = FakeGitHub(runs=[run(9, "timed_out")])
        af.handle("failure", "o/r", 10, "u", gh)
        self.assertEqual(len(gh.writes()), 1)

    def test_unknown_history_does_not_alert(self):
        gh = FakeGitHub(runs=[])
        af.handle("failure", "o/r", 10, "u", gh)
        self.assertEqual(gh.writes(), [])

    def test_success_closes_open_issue(self):
        gh = FakeGitHub(issues=[{"number": 5}, {"number": 6, "pull_request": {}}])
        af.handle("success", "o/r", 11, "u", gh)
        self.assertEqual([(m, p) for m, p, _ in gh.writes()], [("POST", "/repos/o/r/issues/5/comments"), ("PATCH", "/repos/o/r/issues/5")])
        self.assertEqual(gh.writes()[1][2]["state"], "closed")

    def test_success_without_issue_does_nothing(self):
        gh = FakeGitHub()
        self.assertEqual(af.handle("success", "o/r", 11, "u", gh), "nulla da fare")
        self.assertEqual(gh.writes(), [])

    def test_other_results_are_ignored(self):
        gh = FakeGitHub()
        af.handle("cancelled", "o/r", 11, "u", gh)
        self.assertEqual(gh.calls, [])

    def test_missing_environment_is_an_error_not_a_crash(self):
        old = {k: os.environ.pop(k, None) for k in ("REPO", "RUN_ID")}
        try:
            self.assertEqual(af.main(), 1)
        finally:
            for k, v in old.items():
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
