"""Web Push: a chat message reaches a computer, tablet or phone even when no
viewer page is open (the installed app or the browser shows it).

Browsers only allow this on https (or http://localhost), so it works once
the server is reached through https - the Cloudflare tunnel (tunnel.bat), or
a certificate on the server. On plain http the pages still show
notifications while one of them is open (notify.js); this adds the rest.

No push service account is needed: each browser gives us its own push
address (Google's for Chrome / Edge on Android and Windows, Mozilla's,
Apple's) and we send to it, signed with this server's own key (VAPID, made
on first start and kept in <data>/vapid.json) and encrypted for that
browser alone (RFC 8291, aes128gcm). Only the `cryptography` package is
used - pip install cryptography.

  GET    /api/push/key        this server's public key (for subscribe)
  POST   /api/push/subscribe  {subscription} - this browser, for me
  DELETE /api/push/subscribe  {endpoint}
  POST   /api/push/test       a test notification to my devices

chat.py calls PUSH_HOOK(message id) for every new message; the sending is
done on a thread of its own a moment later (after the message is saved).
"""

import base64
import json
import os
import sqlite3
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from fastapi import Header, HTTPException, Request

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    HAVE_CRYPTO = True
except Exception:          # pragma: no cover - reported by /api/push/key
    HAVE_CRYPTO = False

CORE = None
_LOCK = threading.Lock()
_KEYS = {}
SCHEMA = """
CREATE TABLE IF NOT EXISTS subs (
    endpoint   TEXT PRIMARY KEY,
    uid        INTEGER NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    agent      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    fails      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_subs_uid ON subs(uid);
"""


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def unb64u(s):
    s = str(s)
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _db():
    c = sqlite3.connect(os.path.join(CORE.CFG["data"], "push.db"), timeout=10)
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA)
    return c


def keys():
    """This server's VAPID key pair, made once."""
    if _KEYS:
        return _KEYS
    path = os.path.join(CORE.CFG["data"], "vapid.json")
    with _LOCK:
        if _KEYS:
            return _KEYS
        priv = None
        if os.path.isfile(path):
            try:
                with open(path) as f:
                    pem = json.load(f)["private_pem"].encode()
                priv = serialization.load_pem_private_key(pem, password=None)
            except Exception:
                priv = None
        if priv is None:
            priv = ec.generate_private_key(ec.SECP256R1())
            pem = priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption()).decode()
            tmp = path + ".tmp"
            with open(tmp, "w") as f:
                json.dump({"private_pem": pem}, f)
            os.replace(tmp, path)
        pub = priv.public_key().public_bytes(serialization.Encoding.X962,
                                             serialization.PublicFormat.UncompressedPoint)
        _KEYS.update({"priv": priv, "pub": b64u(pub)})
    return _KEYS


def vapid_auth(endpoint, subject):
    """The Authorization header for one push service (RFC 8292)."""
    k = keys()
    u = urllib.parse.urlsplit(endpoint)
    head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64u(json.dumps({"aud": "%s://%s" % (u.scheme, u.netloc), "exp": int(time.time()) + 12 * 3600,
                              "sub": subject}, separators=(",", ":")).encode())
    signing = (head + "." + claims).encode()
    r, s = decode_dss_signature(k["priv"].sign(signing, ec.ECDSA(hashes.SHA256())))
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return "vapid t=%s.%s.%s, k=%s" % (head, claims, b64u(sig), k["pub"])


def encrypt(payload, p256dh, auth):
    """The message body, encrypted for one browser (RFC 8291, aes128gcm)."""
    ua_pub = unb64u(p256dh)
    secret = unb64u(auth)
    mine = ec.generate_private_key(ec.SECP256R1())
    as_pub = mine.public_key().public_bytes(serialization.Encoding.X962,
                                            serialization.PublicFormat.UncompressedPoint)
    shared = mine.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub))
    ikm = HKDF(hashes.SHA256(), 32, salt=secret, info=b"WebPush: info\x00" + ua_pub + as_pub).derive(shared)
    salt = os.urandom(16)
    cek = HKDF(hashes.SHA256(), 16, salt=salt, info=b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt=salt, info=b"Content-Encoding: nonce\x00").derive(ikm)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + struct.pack("!I", 4096) + bytes([len(as_pub)]) + as_pub + body


def send_one(sub, data, subject):
    """Send to one browser. Returns the push service's HTTP status."""
    body = encrypt(json.dumps(data).encode("utf-8"), sub["p256dh"], sub["auth"])
    req = urllib.request.Request(sub["endpoint"], data=body, method="POST", headers={
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        "TTL": "86400", "Urgency": "high", "Topic": str(data.get("tag", ""))[:32].replace("-", "") or "lwk",
        "Authorization": vapid_auth(sub["endpoint"], subject)})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def subject():
    s = (CORE.CFG.get("push_contact") or "").strip() if hasattr(CORE, "CFG") else ""
    return s if s.startswith(("mailto:", "https:")) else "mailto:admin@lwk-viewer.local"


def send_to(uid, data):
    """To every device this person has turned push on for. Gone devices
    (404 / 410) are forgotten."""
    c = _db()
    try:
        subs = c.execute("SELECT * FROM subs WHERE uid = ?", (uid,)).fetchall()
        sent = 0
        for s in subs:
            try:
                code = send_one(s, data, subject())
            except Exception as e:
                print("push: %s" % e)
                code = 0
            if code in (404, 410):
                c.execute("DELETE FROM subs WHERE endpoint = ?", (s["endpoint"],))
            elif 200 <= code < 300:
                sent += 1
                c.execute("UPDATE subs SET fails = 0 WHERE endpoint = ?", (s["endpoint"],))
            else:
                c.execute("UPDATE subs SET fails = fails + 1 WHERE endpoint = ?", (s["endpoint"],))
                c.execute("DELETE FROM subs WHERE endpoint = ? AND fails > 20", (s["endpoint"],))
        c.commit()
        return sent
    finally:
        c.close()


def _deliver(mid):
    try:
        import chat
        targets = chat.notify_targets(mid)
    except Exception as e:
        print("push: %s" % e)
        return
    for uid, n in targets:
        try:
            send_to(uid, {"title": n["title"], "body": n["body"], "url": n["url"], "tag": n["id"],
                          "room": n["room"], "mention": n["mention"]})
        except Exception as e:
            print("push: %s" % e)


QUEUE = []                  # message ids sent by the tests (no network there)


def hook(mid):
    """chat.py: a new message. Only when someone has push turned on."""
    try:
        c = _db()
        n = c.execute("SELECT COUNT(*) FROM subs").fetchone()[0]
        c.close()
    except Exception:
        n = 0
    if not n:
        return
    QUEUE.append(mid)
    del QUEUE[:-50]
    t = threading.Timer(0.6, _deliver, args=(mid,))
    t.daemon = True
    t.start()


def register(app, core):
    global CORE
    CORE = core
    if not HAVE_CRYPTO:
        print("push: off - pip install cryptography to send notifications to phones")
    try:
        import chat
        if HAVE_CRYPTO:
            chat.PUSH_HOOK = hook
    except Exception:
        pass

    def me(request, token):
        w = core.who(request, token)
        if w.uid is None:
            raise HTTPException(status_code=400, detail="Notifications need accounts switched on (Admin page)")
        return w

    async def body_of(request):
        try:
            b = json.loads((await request.body()).decode("utf-8") or "{}")
        except Exception:
            raise HTTPException(status_code=400, detail="Not JSON")
        if not isinstance(b, dict):
            raise HTTPException(status_code=400, detail="Expected a JSON object")
        return b

    @app.get("/api/push/key")
    async def push_key(request: Request):
        if not HAVE_CRYPTO:
            return {"key": "", "why": "The server needs the cryptography package (pip install cryptography)"}
        return {"key": keys()["pub"]}

    @app.post("/api/push/subscribe")
    async def push_subscribe(request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        b = await body_of(request)
        s = b.get("subscription") or {}
        ep = str(s.get("endpoint") or "")
        k = s.get("keys") or {}
        if not ep.startswith("https://") or len(ep) > 1000 or not k.get("p256dh") or not k.get("auth"):
            raise HTTPException(status_code=400, detail="Not a push subscription")
        try:
            if len(unb64u(k["p256dh"])) != 65 or len(unb64u(k["auth"])) < 8:
                raise ValueError()
        except Exception:
            raise HTTPException(status_code=400, detail="Not a push subscription")
        c = _db()
        try:
            c.execute("INSERT OR REPLACE INTO subs (endpoint, uid, p256dh, auth, agent, created_at) VALUES (?,?,?,?,?,?)",
                      (ep, w.uid, k["p256dh"], k["auth"], (request.headers.get("user-agent") or "")[:200],
                       time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())))
            c.commit()
            n = c.execute("SELECT COUNT(*) FROM subs WHERE uid = ?", (w.uid,)).fetchone()[0]
        finally:
            c.close()
        return {"ok": True, "devices": n}

    @app.delete("/api/push/subscribe")
    async def push_unsubscribe(request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        b = await body_of(request)
        c = _db()
        try:
            c.execute("DELETE FROM subs WHERE endpoint = ? AND uid = ?", (str(b.get("endpoint") or ""), w.uid))
            c.commit()
        finally:
            c.close()
        return {"ok": True}

    @app.post("/api/push/test")
    async def push_test(request: Request, x_viewer_token: str = Header(default="")):
        w = me(request, x_viewer_token)
        import asyncio
        n = await asyncio.get_event_loop().run_in_executor(None, send_to, w.uid, {
            "title": "LWK Viewer", "body": "Notifications are on for this device.", "url": "messenger.html",
            "tag": "test"})
        return {"sent": n}
