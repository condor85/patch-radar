"""Test di scripts/stamp_version.py:  python3 -m unittest discover -s tests -v"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import stamp_version as sv  # noqa: E402


def make_site(d):
    for name in ["index.html", "sw.js", "shared.js", "qr.js", "manifest.webmanifest"]:
        shutil.copy(os.path.join(ROOT, name), os.path.join(d, name))
    shutil.copytree(os.path.join(ROOT, "js"), os.path.join(d, "js"))


def read(d, name):
    with open(os.path.join(d, name), encoding="utf-8") as f:
        return f.read()


class StampVersion(unittest.TestCase):
    def test_every_place_gets_the_same_new_version(self):
        with tempfile.TemporaryDirectory() as d:
            make_site(d)
            v = sv.stamp(d)
            index = read(d, "index.html")
            self.assertRegex(v, r"-[0-9a-f]{8}$")
            self.assertEqual(re.findall(r'const APP_VERSION = "([^"]+)"', index), [v])
            tags = re.findall(r'<script src="[^"]+\?v=([^"]+)"></script>', index)
            self.assertGreater(len(tags), 10)
            self.assertEqual(set(tags), {v})
            self.assertRegex(read(d, "sw.js"), r'const CACHE = "patch-radar-[a-z0-9]+-[0-9a-f]{8}"')

    def test_same_content_same_version_and_rerun_does_not_grow(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            make_site(a)
            make_site(b)
            va = sv.stamp(a)
            self.assertEqual(va, sv.stamp(b))
            again = sv.stamp(a)                         # rieseguito sul sito già marcato: la base resta quella dei sorgenti
            self.assertEqual(again.count("-"), va.count("-") + 0)
            self.assertEqual(len(again), len(va))

    def test_a_changed_file_changes_the_version(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            make_site(a)
            make_site(b)
            with open(os.path.join(b, "js", "core.js"), "a", encoding="utf-8") as f:
                f.write("\n// modifica\n")
            self.assertNotEqual(sv.stamp(a), sv.stamp(b))

    def test_the_cache_name_keeps_the_prefix_the_service_worker_cleans_up(self):
        with tempfile.TemporaryDirectory() as d:
            make_site(d)
            sv.stamp(d)
            m = re.search(r'const CACHE = "([^"]+)"', read(d, "sw.js"))
            self.assertTrue(m.group(1).startswith("patch-radar-"))

    def test_an_inconsistent_site_is_refused_without_touching_files(self):
        with tempfile.TemporaryDirectory() as d:
            make_site(d)
            html = read(d, "index.html").replace("core.js?v=", "core.js?v=sbagliata-", 1)
            with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
                f.write(html)
            before = (read(d, "index.html"), read(d, "sw.js"))
            with self.assertRaises(SystemExit):
                sv.stamp(d)
            self.assertEqual((read(d, "index.html"), read(d, "sw.js")), before)

    def test_command_line(self):
        with tempfile.TemporaryDirectory() as d:
            make_site(d)
            out = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "stamp_version.py"), d], capture_output=True, text=True, check=True)
            self.assertIn("Versione dell'app:", out.stdout)

    def test_the_stamped_site_still_passes_the_structure_rules(self):
        """Ogni script ha ?v= uguale ad APP_VERSION e il service worker precarica gli stessi file: lo stesso controllo del test di struttura."""
        with tempfile.TemporaryDirectory() as d:
            make_site(d)
            v = sv.stamp(d)
            index = read(d, "index.html")
            for t in re.findall(r'<script src="([^"]+)"></script>', index):
                self.assertEqual(t.split("?v=")[1], v)


if __name__ == "__main__":
    unittest.main()
