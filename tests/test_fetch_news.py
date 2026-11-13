"""Test di scripts/fetch_news.py. Si lanciano dalla radice del repository:  python3 -m unittest discover -s tests -v"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import fetch_news as fn  # noqa: E402


@contextlib.contextmanager
def workdir(files=None, env=None):
    """Cartella temporanea come directory corrente (lo script legge config.json, games.json e data/ in relativo)."""
    old = os.getcwd()
    with tempfile.TemporaryDirectory() as d:
        for name, content in (files or {}).items():
            path = os.path.join(d, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content if isinstance(content, str) else json.dumps(content))
        os.chdir(d)
        try:
            with mock.patch.dict(os.environ, env or {}, clear=False):
                yield d
        finally:
            os.chdir(old)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def game(appid, titles):
    return {"appid": appid, "name": f"G{appid}", "items": [{"gid": f"{appid}{i}", "title": t, "contents": "x" * 500, "tags": []} for i, t in enumerate(titles)]}


class Topic(unittest.TestCase):
    def test_config_wins_over_secret(self):
        with workdir({"config.json": {"ntfyTopic": "da-config"}}, {"NTFY_TOPIC": "dal-secret"}):
            self.assertEqual(fn._topic(), "da-config")

    def test_secret_is_fallback(self):
        with workdir({"config.json": {}}, {"NTFY_TOPIC": "dal-secret"}):
            self.assertEqual(fn._topic(), "dal-secret")

    def test_missing_config(self):
        with workdir({}, {"NTFY_TOPIC": ""}):
            self.assertEqual(fn._topic(), "")


class LoadGames(unittest.TestCase):
    def test_ok_dedup_and_bad_entries(self):
        data = {"games": [{"appid": 1, "name": " A "}, {"appid": "1"}, {"appid": "x"}, "boh", {"appid": 2}]}
        with workdir({"games.json": data}), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(fn.load_games(), [{"appid": 1, "name": "A"}, {"appid": 2, "name": ""}])

    def test_wrong_shape(self):
        for bad in ([], {"games": "no"}):
            with workdir({"games.json": bad}):
                with self.assertRaises(ValueError):
                    fn.load_games()


class Translations(unittest.TestCase):
    def setUp(self):
        p = [mock.patch.object(fn, "GEMINI_KEY", "k"), mock.patch.object(fn, "TRANSLATE_BUDGET", 3), mock.patch.object(fn.time, "sleep")]
        self.sleep = p[2].start()
        p[0].start(); p[1].start()
        self.addCleanup(mock.patch.stopall)

    def test_untranslatable_items_do_not_eat_the_budget(self):
        # prima il gioco con testi non traducibili (translate_item -> None), poi uno traducibile: deve essere tradotto
        games = [game(1, ["Patch 1.0", "Patch 1.1", "Patch 1.2"]), game(2, ["Patch 2.0", "Patch 2.1", "Patch 2.2"])]
        calls = []

        def fake(name, item):
            calls.append(item["gid"])
            return None if name == "G1" else {"title": "t", "text": "x" * 100, "src": "gemini"}

        with mock.patch.object(fn, "translate_item", fake):
            fn.add_translations(games)
        self.assertEqual([i for i in games[1]["items"] if i.get("it")].__len__(), 3)
        self.assertTrue(all("it" not in i for i in games[0]["items"]))
        self.assertEqual(self.sleep.call_count, 3)  # pausa solo dopo richieste vere

    def test_failures_are_counted_then_skipped_then_retried_after_a_day(self):
        games = [game(1, ["Patch 1.0"])]
        item = games[0]["items"][0]
        with mock.patch.object(fn, "translate_item", side_effect=RuntimeError("boom")), contextlib.redirect_stderr(io.StringIO()):
            for _ in range(5):
                fn.add_translations(games)
        self.assertEqual(item["it_fail"]["n"], fn.TRANSLATE_RETRIES)  # dopo 3 tentativi si ferma
        self.assertTrue(fn.translation_gave_up(item))
        self.assertFalse(fn.translation_gave_up(item, now=item["it_fail"]["ts"] + fn.TRANSLATE_RETRY_AFTER + 1))

    def test_success_clears_failure_marker(self):
        games = [game(1, ["Patch 1.0"])]
        games[0]["items"][0]["it_fail"] = {"n": 2, "ts": 1}
        with mock.patch.object(fn, "translate_item", return_value={"title": "t", "text": "x" * 100, "src": "gemini"}):
            fn.add_translations(games)
        self.assertIn("it", games[0]["items"][0])
        self.assertNotIn("it_fail", games[0]["items"][0])

    def test_rate_limit_stops_without_marking_failure(self):
        games = [game(1, ["Patch 1.0"])]
        with mock.patch.object(fn, "translate_item", side_effect=fn.RateLimited("429")), contextlib.redirect_stderr(io.StringIO()):
            fn.add_translations(games)
        self.assertNotIn("it_fail", games[0]["items"][0])

    def test_failure_marker_survives_between_runs(self):
        old = {"1": {"items": [{"gid": "10", "it_fail": {"n": 2, "ts": 5}}]}}
        games = [{"appid": 1, "name": "G1", "items": [{"gid": "10", "title": "Patch 1.0", "contents": ""}]}]
        with mock.patch.object(fn, "GEMINI_KEY", ""):
            fn.add_summaries(games, old)
        self.assertEqual(games[0]["items"][0]["it_fail"], {"n": 2, "ts": 5})


class Summaries(unittest.TestCase):
    def test_short_text_does_not_sleep(self):
        games = [{"appid": 1, "name": "G1", "items": [{"gid": "1", "title": "Patch", "contents": "breve", "summary": "• gia fatto", "summary_src": "simple"}]}]
        with mock.patch.object(fn, "GEMINI_KEY", "k"), mock.patch.object(fn.time, "sleep") as sleep, \
                mock.patch.object(fn, "gemini_call", side_effect=AssertionError("non va chiamato")):
            fn.add_summaries(games, {})
        sleep.assert_not_called()


class Http(unittest.TestCase):
    def test_no_sleep_after_last_attempt(self):
        with mock.patch.object(fn.urllib.request, "urlopen", side_effect=OSError("down")), mock.patch.object(fn.time, "sleep") as sleep:
            with self.assertRaises(OSError):
                fn.http("https://example.invalid", retries=3)
        self.assertEqual(sleep.call_count, 2)  # tra un tentativo e l'altro, non dopo l'ultimo


class DigestWhenSteamIsDown(unittest.TestCase):
    def test_no_digest_and_no_write_when_every_game_fails(self):
        prev = {"updated": 1, "digest_ts": 1, "games": [game(1, ["Patch 1.0"])]}
        prev["games"][0]["items"][0].update({"date": 2, "patch": True})
        files = {"games.json": {"games": [{"appid": 1, "name": "G1"}]}, "config.json": {"ntfyTopic": "t"}, "data/news.json": prev}
        with workdir(files):
            before = read("data/news.json")
            with mock.patch.object(fn, "fetch_game", side_effect=OSError("down")), mock.patch.object(fn, "store_details", side_effect=OSError("down")), \
                    mock.patch.object(fn, "fetch_ntfy_key", return_value=""), mock.patch.object(fn, "send_digest") as digest, \
                    mock.patch.object(fn, "DIGEST_HOUR", 0), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                fn.main()
            digest.assert_not_called()
            self.assertEqual(read("data/news.json"), before)

    def test_digest_is_sent_when_steam_works(self):
        prev = {"updated": 1, "digest_ts": 1, "games": [game(1, ["Patch 1.0"])]}
        files = {"games.json": {"games": [{"appid": 1, "name": "G1"}]}, "config.json": {"ntfyTopic": "t"}, "data/news.json": prev}
        fresh = [{"gid": "10", "title": "Patch 1.0", "contents": "x", "date": 2, "tags": ["patchnotes"]}]
        with workdir(files):
            with mock.patch.object(fn, "fetch_game", return_value=fresh), mock.patch.object(fn, "store_details", return_value={"name": "G1", "image": "", "price": None}), \
                    mock.patch.object(fn, "fetch_ntfy_key", return_value=""), mock.patch.object(fn, "send_digest") as digest, mock.patch.object(fn, "ntfy_send"), \
                    mock.patch.object(fn, "GEMINI_KEY", ""), mock.patch.object(fn, "extractive_summary", return_value=""), \
                    mock.patch.object(fn, "DIGEST_HOUR", 0), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                fn.main()
            digest.assert_called_once()


class Main(unittest.TestCase):
    def test_invalid_games_json_fails_with_github_annotation(self):
        with workdir({"games.json": "{non json", "config.json": {}}):
            out = io.StringIO()
            with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as cm:
                fn.main()
            self.assertEqual(cm.exception.code, 1)
            self.assertIn("::error file=games.json::", out.getvalue())


if __name__ == "__main__":
    unittest.main()
