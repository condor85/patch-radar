#!/usr/bin/env python3
"""Crea la coppia di chiavi con cui l'Action firma le notifiche e l'app verifica che siano autentiche.

Si lancia UNA volta, sul proprio computer:   python3 scripts/gen_signing_key.py
Poi (vedi README, «Notifiche firmate»):
  1. la CHIAVE PRIVATA va nel secret NTFY_SIGN_KEY del repository (Settings > Secrets and variables > Actions);
  2. la CHIAVE PUBBLICA va in config.json come "ntfySignKey" (quella è pubblica, può stare nel repository).
La chiave privata non va scritta in nessun file del repository né condivisa."""
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ed25519  # noqa: E402


def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


if __name__ == "__main__":
    seed = os.urandom(32)
    print("CHIAVE PRIVATA (secret NTFY_SIGN_KEY, da non condividere):")
    print(" ", b64u(seed))
    print("CHIAVE PUBBLICA (config.json, campo ntfySignKey):")
    print(" ", b64u(ed25519.public_key(seed)))
