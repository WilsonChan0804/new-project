#!/usr/bin/env python3
"""行程 App 伺服器：提供 App 檔案，同埋將行程同相片存喺 VM（所有裝置共用）。

只用 Python 標準庫；如果裝咗 pykakasi，就會幫新日語句子自動加平假名同羅馬拼音。

環境變數：
  TRIP_KEY       修改密碼（必須）。App 第一次要輸入一次。
  TRIP_VIEW_KEY  （可選）睇資料都要密碼；唔設定就任何人有網址都睇到。
  TRIP_DATA      資料夾，預設 ~/trip-data
  TRIP_PORT      預設 8090；TRIP_HOST 預設 127.0.0.1（由 Caddy 轉發 https）
"""
import hmac
import json
import os
import re
import shutil
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote

APP_DIR = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get('TRIP_DATA', Path.home() / 'trip-data'))
KEY = os.environ.get('TRIP_KEY', '')
VIEW_KEY = os.environ.get('TRIP_VIEW_KEY', '')
PHOTOS = DATA / 'photos'
HISTORY = DATA / 'history'
TRIP_FILE = DATA / 'trip.json'
PHOTO_ID = re.compile(r'^p_[A-Za-z0-9]{4,40}$')
MAX_PHOTO = 15 * 1024 * 1024
MAX_TRIP = 8 * 1024 * 1024
KEEP_HISTORY = 300
lock = threading.Lock()

TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
         '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'}

try:
    import pykakasi
    KKS = pykakasi.kakasi()
except Exception:  # 冇裝都照用，只係唔會自動加讀音
    KKS = None


def read_trip():
    if not TRIP_FILE.exists():
        return None
    return json.loads(TRIP_FILE.read_text('utf-8'))


def write_json(path, obj):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False), 'utf-8')
    os.replace(tmp, path)


def seed():
    """第一次啟動：用 repo 入面嘅 data/trip.json（之前喺 App 改過嘅內容）"""
    for d in (DATA, PHOTOS, HISTORY):
        d.mkdir(parents=True, exist_ok=True)
    src = APP_DIR / 'data' / 'trip.json'
    if not TRIP_FILE.exists() and src.exists():
        d = json.loads(src.read_text('utf-8'))
        write_json(TRIP_FILE, {'rev': 1, 'savedAt': d.get('savedAt'), 'trip': d.get('trip') or d})
        print('已由 data/trip.json 匯入行程')
    src_photos = APP_DIR / 'data' / 'photos'
    if src_photos.is_dir():
        for f in src_photos.glob('p_*.jpg'):
            if not (PHOTOS / f.name).exists():
                shutil.copy(f, PHOTOS / f.name)


KANJI = re.compile(r'[\u3400-\u9fff々〆ヶ]')
PARTICLE = {'は': 'wa', 'へ': 'e', 'を': 'o'}
SUFFIX = {'店': ('てん', 'ten'), '街': ('がい', 'gai')}


def kata2hira(s):
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in s)


def split_ruby(orig, hira):
    """「話せ」+「はなせ」→ [['話','はな'], ['せ']]：送假名唔使標讀音"""
    if not KANJI.search(orig) or hira == orig:
        return [[orig]]
    o, h = orig, hira
    head = tail = ''
    while o and h and not KANJI.match(o[-1]) and kata2hira(o[-1]) == h[-1]:
        tail = o[-1] + tail
        o, h = o[:-1], h[:-1]
    while o and h and not KANJI.match(o[0]) and kata2hira(o[0]) == h[0]:
        head += o[0]
        o, h = o[1:], h[1:]
    out = [[head]] if head else []
    out.append([o, h] if h else [o])
    if tail:
        out.append([tail])
    return out


ROMA = dict(zip(
    'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゃゅょゎゔー',
    'a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa o n ga gi gu ge go za ji zu ze zo da ji zu de do ba bi bu be bo pa pi pu pe po a i u e o ya yu yo wa vu -'.split()))
YOON = {'ゃ': 'a', 'ゅ': 'u', 'ょ': 'o'}
SMALLV = {'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o'}


def kana_romaji(h):
    """平假名 → 羅馬拼音（Hepburn）：處理拗音（きゃ）、促音（っ）、長音"""
    out, i = '', 0
    while i < len(h):
        c, n = h[i], h[i + 1] if i + 1 < len(h) else ''
        if c == 'っ':
            nxt = kana_romaji(h[i + 1:i + 3])
            out += ('t' if nxt.startswith('ch') else nxt[:1]) if nxt[:1].isalpha() and nxt[:1] not in 'aiueon' else ''
            i += 1
            continue
        r = ROMA.get(c)
        if r is None:
            out += c
        elif n in YOON and r.endswith('i') and len(r) > 1:
            base = r[:-1]
            out += (base if base in ('sh', 'ch', 'j') else base + 'y') + YOON[n]
            i += 1
        elif n in SMALLV and len(r) > 1:  # チェ、ファ、ティ
            base = {'fu': 'f', 'tsu': 'ts', 'te': 't', 'de': 'd', 'vu': 'v'}.get(r, r[:-1])
            out += base + SMALLV[n]
            i += 1
        elif r == '-':
            out += out[-1:] if out[-1:] in 'aiueo' else ''
        else:
            if r == 'n' and n and ROMA.get(n, 'x')[0] in 'aiueoy':
                r = "n'"
            out += r
        i += 1
    return out


def reading(text):
    """返回 {ruby: [[字, 讀音], [假名]...], kana, romaji}"""
    if not KKS:
        return None
    toks = []
    for t in KKS.convert(text):
        orig, hira = t['orig'], t['hira']
        if toks and orig in SUFFIX:  # 「築地店」嘅店讀「てん」
            hira = SUFFIX[orig][0]
        if toks and toks[-1][1].endswith('っ'):  # 「撮っ」+「て」→ 一個字
            toks[-1] = (toks[-1][0] + orig, toks[-1][1] + hira)
        else:
            toks.append((orig, hira))
    ruby, roma = [], []
    for orig, hira in toks:
        ruby.extend(split_ruby(orig, hira))
        if not orig.strip():
            continue
        if not re.search(r'[\u3040-\u30ff\u3400-\u9fff]', orig):
            roma.append(orig)  # 英文、數字照寫
        else:
            roma.append(PARTICLE.get(orig, kana_romaji(kata2hira(hira))))
    merged = []
    for seg in ruby:  # 合併相鄰冇讀音嘅段落
        if len(seg) == 1 and merged and len(merged[-1]) == 1:
            merged[-1][0] += seg[0]
        else:
            merged.append(list(seg))
    romaji = re.sub(r'\s+([.,!?、。！？・])', r'\1', ' '.join(roma))
    return {'ruby': merged, 'kana': ''.join(h for _, h in toks), 'romaji': romaji.strip()}


class H(BaseHTTPRequestHandler):
    server_version = 'TripServer/1'

    def log_message(self, fmt, *args):
        if not self.path.startswith('/api/ping'):
            super().log_message(fmt, *args)

    # ---------- helpers ----------
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Trip-Key')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Max-Age', '86400')

    def send(self, code, body=b'', ctype='application/json', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def key_ok(self, need):
        if not need:
            return True
        got = self.headers.get('X-Trip-Key', '')
        return bool(got) and hmac.compare_digest(got.encode(), need.encode())

    def can_edit(self):
        return bool(KEY) and self.key_ok(KEY)

    def can_view(self):
        return not VIEW_KEY or self.key_ok(VIEW_KEY) or self.can_edit()

    def deny(self):
        time.sleep(0.8)  # 減慢估密碼
        self.send(401, {'error': '密碼唔啱'})

    def body(self, limit):
        n = int(self.headers.get('Content-Length') or 0)
        if n > limit:
            raise ValueError('檔案太大')
        return self.rfile.read(n)

    # ---------- routes ----------
    def do_OPTIONS(self):
        self.send(204)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == '/api/ping':
            return self.send(200, {'ok': True, 'edit': self.can_edit(), 'view': self.can_view(), 'reading': bool(KKS)})
        if path == '/api/trip':
            if not self.can_view():
                return self.deny()
            with lock:
                d = read_trip()
            return self.send(200, d) if d else self.send(404, {'error': '未有資料'})
        m = re.match(r'^/api/photos/([^/]+)$', path)
        if m:
            if not self.can_view():
                return self.deny()
            pid = m.group(1).removesuffix('.jpg')
            f = PHOTOS / f'{pid}.jpg'
            if not PHOTO_ID.match(pid) or not f.exists():
                return self.send(404, {'error': '冇呢張相'})
            return self.send(200, f.read_bytes(), 'image/jpeg', {'Cache-Control': 'private, max-age=31536000, immutable'})
        if path.startswith('/api/'):
            return self.send(404, {'error': 'not found'})
        return self.static(path)

    def do_PUT(self):
        path = unquote(urlparse(self.path).path)
        if not self.can_edit():
            return self.deny()
        try:
            if path == '/api/trip':
                d = json.loads(self.body(MAX_TRIP))
                if not isinstance(d.get('trip', {}).get('days'), list):
                    return self.send(400, {'error': '格式唔啱'})
                with lock:
                    cur = read_trip()
                    rev = cur['rev'] if cur else 0
                    if cur and d.get('baseRev') != rev and not d.get('force'):
                        return self.send(409, cur)
                    new = {'rev': rev + 1, 'savedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'trip': d['trip']}
                    write_json(TRIP_FILE, new)
                    write_json(HISTORY / f'trip-{new["rev"]:06d}.json', new)
                    old = sorted(HISTORY.glob('trip-*.json'))[:-KEEP_HISTORY]
                    for f in old:
                        f.unlink()
                return self.send(200, {'rev': new['rev'], 'savedAt': new['savedAt']})
            m = re.match(r'^/api/photos/([^/]+)$', path)
            if m and PHOTO_ID.match(m.group(1)):
                data = self.body(MAX_PHOTO)
                if not data:
                    return self.send(400, {'error': '空檔案'})
                tmp = PHOTOS / f'{m.group(1)}.tmp'
                tmp.write_bytes(data)
                os.replace(tmp, PHOTOS / f'{m.group(1)}.jpg')
                return self.send(200, {'ok': True})
        except ValueError as e:
            return self.send(413, {'error': str(e)})
        return self.send(404, {'error': 'not found'})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/reading':
            if not self.can_view():
                return self.deny()
            try:
                text = json.loads(self.body(20000)).get('text', '')
            except Exception:
                return self.send(400, {'error': '格式唔啱'})
            r = reading(text)
            return self.send(200, r) if r else self.send(501, {'error': '伺服器未裝 pykakasi'})
        return self.send(404, {'error': 'not found'})

    def static(self, path):
        rel = path.lstrip('/') or 'index.html'
        parts = Path(rel).parts
        if any(p.startswith('.') for p in parts) or parts[0] in ('server', 'deploy', 'data'):
            return self.send(404, 'not found', 'text/plain')
        f = (APP_DIR / rel).resolve()
        if APP_DIR not in f.parents or not f.is_file():
            return self.send(404, 'not found', 'text/plain')
        ctype = TYPES.get(f.suffix.lower(), 'application/octet-stream')
        # App 檔案每次都問伺服器有冇新版（service worker 離線時用 cache）
        cache = 'public, max-age=86400' if '/vendor/' in path or f.suffix == '.png' else 'no-cache'
        return self.send(200, f.read_bytes(), ctype, {'Cache-Control': cache})


def main():
    if not KEY:
        raise SystemExit('請設定 TRIP_KEY（修改密碼）')
    seed()
    host = os.environ.get('TRIP_HOST', '127.0.0.1')
    port = int(os.environ.get('TRIP_PORT', '8090'))
    print(f'行程伺服器：http://{host}:{port}  資料：{DATA}  自動讀音：{"有" if KKS else "冇（pip install pykakasi）"}')
    ThreadingHTTPServer((host, port), H).serve_forever()


if __name__ == '__main__':
    main()
