import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import csp_admin  # noqa: E402

HTML = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; connect-src 'self' https://ntfy.sh; img-src 'self'\">"


class CspAdminTest(unittest.TestCase):
    def test_senza_adminapi_la_pagina_non_cambia(self):
        self.assertEqual(csp_admin.inject(json.dumps({"ntfyTopic": "x"}), HTML), HTML)

    def test_aggiunge_solo_l_origine_valida(self):
        out = csp_admin.inject(json.dumps({"adminApi": "https://ponte.utente.workers.dev"}), HTML)
        self.assertIn("connect-src 'self' https://ponte.utente.workers.dev https://ntfy.sh;", out)
        self.assertEqual(out.count("ponte.utente.workers.dev"), 1)

    def test_rifiuta_valori_che_allargherebbero_la_policy(self):
        for bad in ["*", "https://*.workers.dev", "http://ponte.example.com", "https://a.example.com/percorso",
                    "https://a.example.com:8443", "https://a.example.com; script-src *", "https://a.example.com ",
                    "https://localhost", "javascript:alert(1)", "https://a b.example.com", "https://a.example.com\n", 5, ["https://a.example.com"]]:
            with self.subTest(bad=bad):
                with self.assertRaises(SystemExit):
                    csp_admin.inject(json.dumps({"adminApi": bad}), HTML)

    def test_se_manca_la_riga_connect_src_si_ferma(self):
        with self.assertRaises(SystemExit):
            csp_admin.inject(json.dumps({"adminApi": "https://ponte.example.com"}), "<html></html>")

    def test_config_non_valido(self):
        with self.assertRaises(SystemExit):
            csp_admin.inject("{non json", HTML)


if __name__ == "__main__":
    unittest.main()
