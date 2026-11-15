"""patch_rules.py deve funzionare da solo: nessuna rete, nessun file oltre a shared.js.  python3 -m unittest discover -s tests -v"""
import os
import subprocess
import sys
import unittest

SCRIPTS = os.path.join(os.path.dirname(__file__), "..", "scripts")
sys.path.insert(0, SCRIPTS)
import patch_rules as pr  # noqa: E402


class PatchRulesStandalone(unittest.TestCase):
    def test_imports_without_fetch_news(self):
        code = "import sys; import patch_rules; assert 'fetch_news' not in sys.modules; print('ok')"
        out = subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {SCRIPTS!r}); {code}"], capture_output=True, text=True, cwd="/")
        self.assertEqual(out.stdout.strip(), "ok", out.stderr)

    def test_classification_basics(self):
        patch = {"title": "Patch 1.2 notes", "contents": "New weapons added. New items added. New bosses added. New recipes added. Fixed crash. Fixed bug. Fixed another bug.", "tags": []}
        sale = {"title": "Summer sale", "contents": "Discount", "tags": []}
        items = [patch, sale]
        pr.classify(items)
        self.assertTrue(patch["patch"])
        self.assertFalse(sale["patch"])
        self.assertIn("new", patch["labels"])
        self.assertIn("bug", patch["labels"])
        self.assertEqual(sale["labels"], [])
        self.assertTrue(pr.is_major(patch))
        self.assertIn("crash", pr.keywords_of(patch))

    def test_structured_lines_keeps_headings_and_bullets(self):
        self.assertEqual(pr.structured_lines("[h2]Novità[/h2][list][*]Uno[*]Due[/list]"), ["# Novità", "• Uno", "• Due"])

    def test_keyword_groups_match_shared(self):
        self.assertEqual([g for g, _ in pr.SHARED["keywordGroups"]], list(pr.KEYWORD_GROUPS))


if __name__ == "__main__":
    unittest.main()
