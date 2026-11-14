"""Test di scripts/fetch_news.py. Si lanciano dalla radice del repository:  python3 -m unittest discover -s tests -v"""
import base64
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
                    mock.patch.object(fn, "fetch_ntfy_key", return_value=""), mock.patch.object(fn, "send_digest") as digest, mock.patch.object(fn, "update_players", return_value=False), \
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


RFC8032_SEED = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")


class Ed25519(unittest.TestCase):
    def test_rfc8032_vector(self):
        from ed25519 import public_key, sign
        self.assertEqual(public_key(RFC8032_SEED).hex(), "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        self.assertEqual(sign(RFC8032_SEED, b"").hex(), "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")

    def test_matches_reference_implementation_if_available(self):
        try:
            from cryptography.hazmat.primitives import serialization
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        except ImportError:
            self.skipTest("cryptography non installata")
        from ed25519 import public_key, sign
        for i in range(20):
            seed, msg = os.urandom(32), os.urandom(i * 11)
            k = Ed25519PrivateKey.from_private_bytes(seed)
            self.assertEqual(public_key(seed), k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
            self.assertEqual(sign(seed, msg), k.sign(msg))

    def test_bad_seed_length(self):
        from ed25519 import sign
        with self.assertRaises(ValueError):
            sign(b"corta", b"x")


class Signing(unittest.TestCase):
    KEY = base64.urlsafe_b64encode(RFC8032_SEED).decode().rstrip("=")

    def test_no_key_leaves_tags_untouched(self):
        with mock.patch.dict(os.environ, {"NTFY_SIGN_KEY": ""}):
            self.assertEqual(fn.signed_tags("t", "T", "M", "", ["video_game"]), ["video_game"])

    def test_signature_is_verifiable_and_bound_to_every_field(self):
        from ed25519 import public_key
        try:
            from cryptography.exceptions import InvalidSignature
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        except ImportError:
            self.skipTest("cryptography non installata")
        with mock.patch.dict(os.environ, {"NTFY_SIGN_KEY": self.KEY}):
            tags = fn.signed_tags("topic-1", "Titolo", "Testo", "https://x/", ["video_game"], ts=1700000000)
        self.assertEqual(tags[0], "video_game")
        self.assertEqual(tags[1], "ts:1700000000")
        sig = base64.urlsafe_b64decode(tags[2][4:] + "==")
        pub = Ed25519PublicKey.from_public_bytes(public_key(RFC8032_SEED))
        pub.verify(sig, fn.signing_payload("topic-1", "Titolo", "Testo", "https://x/", 1700000000))
        for altered in [("topic-2", "Titolo", "Testo", "https://x/", 1700000000), ("topic-1", "Altro", "Testo", "https://x/", 1700000000),
                        ("topic-1", "Titolo", "Altro", "https://x/", 1700000000), ("topic-1", "Titolo", "Testo", "https://evil/", 1700000000),
                        ("topic-1", "Titolo", "Testo", "https://x/", 1700000001)]:
            with self.assertRaises(InvalidSignature):
                pub.verify(sig, fn.signing_payload(*altered))

    def test_edge_whitespace_is_not_part_of_the_signature(self):
        self.assertEqual(fn.signing_payload("t", " T\n", "\nM  ", "", 5), fn.signing_payload("t", "T", "M", "", 5))

    def test_invalid_key_sends_unsigned_with_a_warning(self):
        with mock.patch.dict(os.environ, {"NTFY_SIGN_KEY": "non-e-una-chiave!"}), contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(fn.signed_tags("t", "T", "M", "", ["x"]), ["x"])
        self.assertIn("firma non riuscita", err.getvalue())

    def test_ntfy_send_signs_each_topic_separately(self):
        sent = []
        with mock.patch.dict(os.environ, {"NTFY_SIGN_KEY": self.KEY}), mock.patch.object(fn, "NTFY_TOPIC", "t"), mock.patch.object(fn, "SITE_URL", "https://sito/"), \
                mock.patch.object(fn, "http", side_effect=lambda url, data=None, **kw: sent.append(json.loads(data))):
            fn.ntfy_send(["a", "b"], "Titolo", "Testo", ["video_game"])
        self.assertEqual([m["topic"] for m in sent], ["a", "b"])
        self.assertEqual(sent[0]["click"], "https://sito/")
        self.assertNotEqual(sent[0]["tags"][-1], sent[1]["tags"][-1])   # l'argomento fa parte della firma


class Outbox(unittest.TestCase):
    def setUp(self):
        fn.OUTBOX_ITEMS.clear()
        self.addCleanup(fn.OUTBOX_ITEMS.clear)

    def test_notify_only_queues(self):
        with mock.patch.object(fn, "NTFY_TOPIC", "t"), mock.patch.object(fn, "http", side_effect=AssertionError("rete")):
            fn.notify("Valheim", {"title": "Patch 1", "patch": True, "summary": "x"}, 892970)
            fn.notify("Valheim", {"title": "Evento"}, 892970)
            fn.notify_sale("Valheim", 892970, {"discount": 20, "final": "8 €", "initial": "10 €"})
        self.assertEqual([m["topics"] for m in fn.OUTBOX_ITEMS], [["t", "t-892970"], ["t-892970-news"], ["t-892970-sale"]])

    def test_no_topic_no_queue(self):
        with mock.patch.object(fn, "NTFY_TOPIC", ""):
            fn.notify("G", {"title": "x", "patch": True}, 1)
        self.assertEqual(fn.OUTBOX_ITEMS, [])

    def test_send_outbox_sends_then_deletes_file(self):
        with workdir():
            with open("outbox.json", "w", encoding="utf-8") as f:
                json.dump([{"topics": ["a"], "title": "T", "message": "M", "tags": ["x"], "click": ""}], f)
            with mock.patch.object(fn, "ntfy_send") as send, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(fn.send_outbox(), 1)
            send.assert_called_once_with(["a"], "T", "M", ["x"], "")
            self.assertFalse(os.path.exists("outbox.json"))

    def test_send_outbox_without_file_is_fine(self):
        with workdir(), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(fn.send_outbox(), 0)

    def test_send_outbox_deletes_file_before_sending(self):
        """Se l'invio si interrompe a metà, una nuova esecuzione non deve rimandare le stesse notifiche."""
        with workdir():
            with open("outbox.json", "w", encoding="utf-8") as f:
                json.dump([{"topics": ["a"], "title": "T", "message": "M", "tags": [], "click": ""}], f)
            seen = []
            with mock.patch.object(fn, "ntfy_send", side_effect=lambda *a: seen.append(os.path.exists("outbox.json"))), contextlib.redirect_stdout(io.StringIO()):
                fn.send_outbox()
            self.assertEqual(seen, [False])

    def _run_main(self, fetched, prev_items, notify_topic="t"):
        prev = {"updated": 1, "digest_ts": 4102444800, "games": [{"appid": 1, "name": "G1", "items": prev_items}]}
        files = {"games.json": {"games": [{"appid": 1, "name": "G1"}]}, "config.json": {"ntfyTopic": notify_topic}, "data/news.json": prev}
        return files, fetched

    def test_main_never_touches_the_network_for_notifications_and_writes_the_outbox(self):
        old = [{"gid": "1", "title": "Vecchio", "contents": "x", "date": 1, "tags": []}]
        new = [{"gid": "2", "title": "Patch 2.0", "contents": "x" * 50, "date": 5, "tags": ["patchnotes"]}] + old
        files, fetched = self._run_main(new, old)
        with workdir(files):
            with mock.patch.object(fn, "fetch_game", return_value=new), mock.patch.object(fn, "store_details", return_value={"name": "G1", "image": "", "price": None}), \
                    mock.patch.object(fn, "fetch_ntfy_key", return_value=""), mock.patch.object(fn, "update_players", return_value=False), mock.patch.object(fn, "GEMINI_KEY", ""), \
                    mock.patch.object(fn, "extractive_summary", return_value=""), mock.patch.object(fn, "NTFY_TOPIC", "t"), \
                    mock.patch.object(fn, "http", side_effect=AssertionError("durante il controllo non si invia nulla")), \
                    contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                fn.main()
            with open("outbox.json", encoding="utf-8") as f:
                queued = json.load(f)
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0]["topics"], ["t", "t-1", "t-1-major"])   # «Patch 2.0» è una patch grossa
        self.assertIn("Patch 2.0", queued[0]["message"])

    def test_main_removes_a_stale_outbox_when_nothing_is_new(self):
        old = [{"gid": "1", "title": "Vecchio", "contents": "x", "date": 1, "tags": []}]
        files, _ = self._run_main(old, old)
        files["outbox.json"] = json.dumps([{"topics": ["a"], "title": "vecchia", "message": "", "tags": [], "click": ""}])
        with workdir(files):
            with mock.patch.object(fn, "fetch_game", return_value=old), mock.patch.object(fn, "store_details", return_value={"name": "G1", "image": "", "price": None}), \
                    mock.patch.object(fn, "fetch_ntfy_key", return_value=""), mock.patch.object(fn, "update_players", return_value=False), mock.patch.object(fn, "GEMINI_KEY", ""), \
                    mock.patch.object(fn, "extractive_summary", return_value=""), contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                fn.main()
            self.assertFalse(os.path.exists("outbox.json"))


class Players(unittest.TestCase):
    NOW = 1_700_000_000

    def run_update(self, prev, counts):
        files = {"data/players.json": {"games": prev}} if prev is not None else {}
        with workdir(files):
            with mock.patch.object(fn, "current_players", side_effect=lambda a: counts[a] if not isinstance(counts[a], Exception) else (_ for _ in ()).throw(counts[a])), \
                    contextlib.redirect_stderr(io.StringIO()):
                changed = fn.update_players([{"appid": a} for a in counts], self.NOW)
            with open("data/players.json", encoding="utf-8") as f:
                return changed, json.load(f)["games"]

    def test_first_run_writes_everything(self):
        changed, out = self.run_update(None, {1: 500, 2: 40})
        self.assertTrue(changed)
        self.assertEqual(out, {"1": {"n": 500, "ts": self.NOW}, "2": {"n": 40, "ts": self.NOW}})

    def test_small_variation_keeps_the_old_value_so_no_commit(self):
        changed, out = self.run_update({"1": {"n": 1000, "ts": self.NOW - 3600}}, {1: 1040})
        self.assertFalse(changed)
        self.assertEqual(out["1"], {"n": 1000, "ts": self.NOW - 3600})

    def test_big_variation_updates(self):
        changed, out = self.run_update({"1": {"n": 1000, "ts": self.NOW - 3600}}, {1: 1300})
        self.assertTrue(changed)
        self.assertEqual(out["1"], {"n": 1300, "ts": self.NOW})

    def test_old_value_is_refreshed_after_a_few_hours(self):
        changed, out = self.run_update({"1": {"n": 1000, "ts": self.NOW - fn.PLAYERS_MAX_AGE - 1}}, {1: 1001})
        self.assertTrue(changed)
        self.assertEqual(out["1"]["ts"], self.NOW)

    def test_tiny_games_do_not_flap(self):
        changed, _ = self.run_update({"1": {"n": 12, "ts": self.NOW - 60}}, {1: 15})
        self.assertFalse(changed)

    def test_a_failed_read_keeps_the_previous_value(self):
        changed, out = self.run_update({"1": {"n": 700, "ts": 5}}, {1: OSError("down")})
        self.assertFalse(changed)
        self.assertEqual(out["1"], {"n": 700, "ts": 5})

    def test_garbage_from_steam_is_rejected(self):
        for bad in (None, -3, "12", True):
            with mock.patch.object(fn, "get_json", return_value={"response": {"player_count": bad}}):
                with self.assertRaises((ValueError, TypeError)):
                    fn.current_players(1)


class PriceHistory(unittest.TestCase):
    def run_once(self, files, price, now):
        with workdir(files):
            changed = fn.update_price_history([{"appid": 1, "price": price}], now)
            with open("data/prices.json", encoding="utf-8") as f:
                return changed, json.load(f)["games"]["1"]

    def test_first_price_sets_minimum(self):
        changed, e = self.run_once({}, {"final": "20,00€", "cents": 2000}, 100)
        self.assertTrue(changed)
        self.assertEqual(e["min"], {"c": 2000, "f": "20,00€", "ts": 100})
        self.assertEqual(e["h"], [[100, 2000]])

    def test_lower_price_updates_minimum_and_higher_does_not(self):
        base = {"data/prices.json": {"games": {"1": {"min": {"c": 1500, "f": "15,00€", "ts": 50}, "h": [[50, 1500]]}}}}
        _, e = self.run_once(base, {"final": "10,00€", "cents": 1000}, 200)
        self.assertEqual(e["min"]["c"], 1000)
        _, e = self.run_once(base, {"final": "30,00€", "cents": 3000}, 200)
        self.assertEqual(e["min"]["c"], 1500)
        self.assertEqual(e["h"][-1], [200, 3000])

    def test_unchanged_price_writes_nothing(self):
        base = {"data/prices.json": {"games": {"1": {"min": {"c": 1500, "f": "x", "ts": 50}, "h": [[50, 1500]]}}}}
        changed, _ = self.run_once(base, {"final": "15,00€", "cents": 1500}, 300)
        self.assertFalse(changed)

    def test_missing_price_is_ignored_and_history_is_capped(self):
        with workdir():
            self.assertFalse(fn.update_price_history([{"appid": 1, "price": None}, {"appid": 2, "price": {"final": "x"}}], 1))
            self.assertFalse(os.path.exists("data/prices.json"))
        h = [[i, 1000 + i] for i in range(fn.PRICE_HISTORY_MAX)]
        _, e = self.run_once({"data/prices.json": {"games": {"1": {"min": {"c": 1000, "f": "x", "ts": 0}, "h": h}}}}, {"final": "y", "cents": 5000}, 999)
        self.assertEqual(len(e["h"]), fn.PRICE_HISTORY_MAX)
        self.assertEqual(e["h"][-1], [999, 5000])


class CleanAiSummaryTests(unittest.TestCase):
    def test_drops_reasoning_lines_and_word_counts(self):
        raw = ("• Check word count and constraints:**\n• Point 1:\n"
               "• Le ricette fissate ora rimangono correttamente bloccate nell'interfaccia. (9 words)\n"
               "• Max 20 words? Yes (9 <= 20).\n• Point 2:\n"
               "• Risolti diversi crash del gioco legati al salvataggio.")
        self.assertEqual(fn.clean_ai_summary(raw),
                         "• Le ricette fissate ora rimangono correttamente bloccate nell'interfaccia.\n"
                         "• Risolti diversi crash del gioco legati al salvataggio.")

    def test_only_service_lines_gives_empty(self):
        self.assertEqual(fn.clean_ai_summary("• Check word count and constraints:**\n• Point 1:"), "")

    def test_normal_summary_is_kept_and_bulleted(self):
        raw = "- Aggiunta la nuova modalità cooperativa fino a quattro giocatori.\n* Bilanciate le armi a lungo raggio."
        self.assertEqual(fn.clean_ai_summary(raw),
                         "• Aggiunta la nuova modalità cooperativa fino a quattro giocatori.\n• Bilanciate le armi a lungo raggio.")

    def test_old_polluted_ai_summary_is_redone(self):
        old = {"1": {"items": [{"gid": "10", "summary": "• Check word count and constraints:**\n• Point 1:", "summary_src": "ai"}]}}
        games = [game(1, ["Patch"])]
        games[0]["items"][0]["gid"] = "10"
        with mock.patch.object(fn, "GEMINI_KEY", ""), mock.patch.object(fn, "extractive_summary", return_value="• ok semplice"):
            fn.add_summaries(games, old)
        self.assertEqual(games[0]["items"][0]["summary"], "• ok semplice")


class MajorAndWatchTests(unittest.TestCase):
    def setUp(self):
        fn.OUTBOX_ITEMS.clear()
        self.addCleanup(fn.OUTBOX_ITEMS.clear)

    def test_is_major(self):
        self.assertTrue(fn.is_major({"patch": True, "title": "Update", "labels": ["new"]}))
        self.assertTrue(fn.is_major({"patch": True, "title": "Update", "labels": ["bug", "balance"]}))
        self.assertTrue(fn.is_major({"patch": True, "title": "Patch 1.0 released", "labels": []}))
        self.assertTrue(fn.is_major({"patch": True, "title": "Season 3 is here", "labels": []}))
        self.assertFalse(fn.is_major({"patch": True, "title": "Hotfix 1.0.1", "labels": ["bug"]}))
        self.assertFalse(fn.is_major({"patch": True, "title": "Valheim 0.219.0 patch", "labels": ["bug"]}))
        self.assertFalse(fn.is_major({"patch": False, "title": "Season 3 stream", "labels": ["new"]}))

    def test_major_patch_also_goes_to_major_topic(self):
        with mock.patch.object(fn, "NTFY_TOPIC", "t"):
            fn.notify("G", {"title": "Update", "patch": True, "labels": ["new"]}, 7)
            fn.notify("G", {"title": "Hotfix", "patch": True, "labels": ["bug"]}, 7)
        self.assertEqual([m["topics"] for m in fn.OUTBOX_ITEMS], [["t", "t-7", "t-7-major"], ["t", "t-7"]])

    def test_watched_game_only_sends_major_and_no_announcements(self):
        with mock.patch.object(fn, "NTFY_TOPIC", "t"):
            fn.notify("G", {"title": "Update", "patch": True, "labels": ["new"]}, 7, True)
            fn.notify("G", {"title": "Hotfix", "patch": True, "labels": ["bug"]}, 7, True)
            fn.notify("G", {"title": "Evento"}, 7, True)
        self.assertEqual([m["topics"] for m in fn.OUTBOX_ITEMS], [["t-7-major"]])

    def test_digest_has_a_major_only_variant(self):
        games = [{"appid": 7, "name": "G", "items": [
            {"patch": True, "date": 10, "title": "Hotfix", "labels": ["bug"]},
            {"patch": True, "date": 11, "title": "Big", "labels": ["new"]}]}]
        with mock.patch.object(fn, "NTFY_TOPIC", "t"), contextlib.redirect_stdout(io.StringIO()):
            fn.send_digest(games, 5)
        self.assertEqual([m["topics"] for m in fn.OUTBOX_ITEMS], [["t-7-digest"], ["t-7-digest-major"]])
        self.assertIn("2 aggiornamenti", fn.OUTBOX_ITEMS[0]["title"])
        self.assertIn("1 aggiornamento", fn.OUTBOX_ITEMS[1]["title"])

    def test_price_target(self):
        self.assertTrue(fn.price_reached({"cents": 1999}, 20))
        self.assertTrue(fn.price_reached({"cents": 2000}, 20))
        self.assertFalse(fn.price_reached({"cents": 2001}, 20))
        self.assertFalse(fn.price_reached({"final": "20 €"}, 20))
        self.assertFalse(fn.price_reached(None, 20))
        self.assertFalse(fn.price_reached({"cents": 100}, None))

    def test_notify_target_message(self):
        with mock.patch.object(fn, "NTFY_TOPIC", "t"):
            fn.notify_target("G", 7, {"final": "17,99€", "cents": 1799}, 20)
        m = fn.OUTBOX_ITEMS[0]
        self.assertEqual(m["topics"], ["t-7-target"])
        self.assertIn("17,99€", m["message"])
        self.assertIn("20,00 €", m["message"])

    def test_clean_target_and_load_games(self):
        self.assertEqual(fn.clean_target(19.999), 20.0)
        for bad in (None, 0, -3, "5", True, 99999):
            self.assertIsNone(fn.clean_target(bad))
        files = {"games.json": {"games": [{"appid": 1, "name": "A"}, {"appid": 2, "name": "B", "watch": True, "target": 15},
                                          {"appid": 3, "watch": True}, {"appid": 4, "watch": "yes", "target": 5}]}}
        with workdir(files):
            out = fn.load_games()
        self.assertEqual(out, [{"appid": 1, "name": "A"}, {"appid": 2, "name": "B", "watch": True, "target": 15.0},
                               {"appid": 3, "name": "", "watch": True, "target": None}, {"appid": 4, "name": ""}])

    def test_main_alerts_when_a_watched_game_crosses_the_target(self):
        old_items = [{"gid": "1", "title": "Vecchio", "contents": "x", "date": 1, "tags": []}]
        prev = {"updated": 1, "digest_ts": 4102444800, "games": [{"appid": 1, "name": "G1", "items": old_items, "price": {"final": "25,00€", "initial": "25,00€", "discount": 0, "cents": 2500}}]}
        files = {"games.json": {"games": [{"appid": 1, "name": "G1", "watch": True, "target": 20}]}, "config.json": {"ntfyTopic": "t"}, "data/news.json": prev}
        cheap = {"name": "G1", "image": "", "price": {"final": "18,00€", "initial": "25,00€", "discount": 28, "cents": 1800}}
        with workdir(files):
            with mock.patch.object(fn, "fetch_game", return_value=old_items), mock.patch.object(fn, "store_details", return_value=cheap), \
                    mock.patch.object(fn, "fetch_ntfy_key", return_value=""), mock.patch.object(fn, "update_players", return_value=False), mock.patch.object(fn, "GEMINI_KEY", ""), \
                    mock.patch.object(fn, "extractive_summary", return_value=""), mock.patch.object(fn, "NTFY_TOPIC", "t"), \
                    contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
                fn.main()
            with open("outbox.json", encoding="utf-8") as f:
                queued = json.load(f)
            with open("data/news.json", encoding="utf-8") as f:
                saved = json.load(f)
        self.assertEqual([m["topics"] for m in queued], [["t-1-target"], ["t-1-sale"]])
        self.assertTrue(saved["games"][0]["watch"])
        self.assertEqual(saved["games"][0]["target"], 20.0)


if __name__ == "__main__":
    unittest.main()
