"""Firma Ed25519 (RFC 8032) in puro Python, senza dipendenze: serve solo a firmare le notifiche nell'Action.
Verificata nei test contro `cryptography` e contro WebCrypto di Node (la stessa che usa il service worker).
La firma di pochi messaggi al giorno non ha bisogno di velocità né di tempo costante: la chiave resta nel runner di GitHub."""
import hashlib

_p = 2 ** 255 - 19
_q = 2 ** 252 + 27742317777372353535851937790883648493


def _inv(x):
    return pow(x, _p - 2, _p)


_d = -121665 * _inv(121666) % _p
_sqrt_m1 = pow(2, (_p - 1) // 4, _p)


def _add(P, Q):
    A, B = (P[1] - P[0]) * (Q[1] - Q[0]) % _p, (P[1] + P[0]) * (Q[1] + Q[0]) % _p
    C, D = 2 * P[3] * Q[3] * _d % _p, 2 * P[2] * Q[2] % _p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F % _p, G * H % _p, F * G % _p, E * H % _p)


def _mul(s, P):
    Q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            Q = _add(Q, P)
        P = _add(P, P)
        s >>= 1
    return Q


def _compress(P):
    zinv = _inv(P[2])
    x, y = P[0] * zinv % _p, P[1] * zinv % _p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _recover_x(y, sign):
    x2 = (y * y - 1) * _inv(_d * y * y + 1)
    x = pow(x2, (_p + 3) // 8, _p)
    if (x * x - x2) % _p != 0:
        x = x * _sqrt_m1 % _p
    if (x & 1) != sign:
        x = _p - x
    return x


_gy = 4 * _inv(5) % _p
_gx = _recover_x(_gy, 0)
_G = (_gx, _gy, 1, _gx * _gy % _p)


def _h(s):
    return hashlib.sha512(s).digest()


def _expand(seed):
    if len(seed) != 32:
        raise ValueError("la chiave privata deve essere di 32 byte")
    h = _h(seed)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, h[32:]


def public_key(seed):
    return _compress(_mul(_expand(seed)[0], _G))


def sign(seed, msg):
    a, prefix = _expand(seed)
    A = _compress(_mul(a, _G))
    r = int.from_bytes(_h(prefix + msg), "little") % _q
    R = _compress(_mul(r, _G))
    k = int.from_bytes(_h(R + A + msg), "little") % _q
    return R + int.to_bytes((r + k * a) % _q, 32, "little")
