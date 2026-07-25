#!/usr/bin/env python3
"""Local dev server that mirrors the production Cloudflare routing.

`python -m http.server` only serves files literally, so /about would 404 and
/about.html would NOT redirect - the opposite of how analyser.valjdakosta.com behaves
(default html_handling = "auto-trailing-slash"). This tiny server replicates it:

  /about.html  -> 308 redirect to /about        (and /index.html -> /)
  /about       -> serves about.html (200)
  /            -> serves index.html (200)
  /assets/...  -> served literally (real files with an extension)
  /anything-else (no matching file) -> 404.html (404), the custom error page
     (wrangler.jsonc not_found_handling = "404-page")

Run: python serve.py [port]   (defaults to 3000, binds 0.0.0.0 for phone access)
"""
import datetime
import json
import os
import socket
import sys
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


def _mock_daily(days=45):
    """Deterministic per-day visitor/file series for the /stats trend graph.

    Anchored to today (UTC) so the x-axis reads sensibly, seeded so it looks the
    same on every reload, and gently ramped up so the line trends like real
    growth. Production fills this from the D1 `daily` table (worker/index.js)."""
    today = datetime.datetime.now(datetime.timezone.utc).date()
    out = []
    seed = 1337
    for i in range(days - 1, -1, -1):
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        r1 = seed / 0x7fffffff
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        r2 = seed / 0x7fffffff
        ramp = 0.5 + (days - i) / days
        visitors = max(1, round((6 + r1 * 16) * ramp))
        files = max(visitors, round((120 + r2 * 260) * ramp))
        day = today - datetime.timedelta(days=i)
        out.append({'day': day.isoformat(), 'files': files, 'visitors': visitors})
    return out

# Canned response for the stats Worker (worker/index.js), which only exists on
# the Cloudflare deploy. server.bat has no Worker/D1, so without this /api/* would
# fall through to the SPA handler and hand back index.html - breaking the visitor
# badge and the /stats page locally. Numbers here are fake, just enough to render.
MOCK_STATS = {
    'files': 12345,
    'visitors': 678,
    'extensions': [
        {'ext': 'jpg', 'supported': True, 'count': 4210},
        {'ext': 'png', 'supported': True, 'count': 3180},
        {'ext': 'mp3', 'supported': True, 'count': 1990},
        {'ext': 'pdf', 'supported': True, 'count': 1450},
        {'ext': 'mp4', 'supported': True, 'count': 1220},
        {'ext': 'wav', 'supported': True, 'count': 870},
        {'ext': 'heic', 'supported': True, 'count': 540},
        {'ext': 'zip', 'supported': True, 'count': 410},
        {'ext': 'sldprt', 'supported': True, 'count': 300},
        {'ext': 'dwg', 'supported': True, 'count': 240},
        {'ext': 'xyz', 'supported': False, 'count': 130},
        {'ext': 'qwerty', 'supported': False, 'count': 70},
    ],
    # ts = unix seconds; wave + cause ('.ext' asteroid, or 'nuke') drive the new
    # meta line on /stats. Last two rows are deliberately legacy (no wave/cause/ts)
    # to keep exercising the graceful no-meta fallback.
    'scores': [
        {'name': 'ACEXX', 'score': 13370, 'wave': 18, 'cause': '.pdf', 'ts': 1781308800},
        {'name': 'NOVA9', 'score': 9800, 'wave': 14, 'cause': 'nuke', 'ts': 1781222400},
        {'name': 'ZAPPY', 'score': 7220, 'wave': 11, 'cause': '.heic', 'ts': 1781136000},
        {'name': 'KOSTA', 'score': 5040, 'wave': 9, 'cause': '.zip', 'ts': 1780963200},
        {'name': 'PILOT', 'score': 3110, 'wave': 7, 'cause': '.mp4', 'ts': 1780704000},
        {'name': 'COMET', 'score': 2890, 'wave': 6, 'cause': 'nuke', 'ts': 1780531200},
        {'name': 'ORBIT', 'score': 2450, 'wave': 5, 'cause': '.dwg', 'ts': 1780358400},
        {'name': 'LASER', 'score': 1980, 'wave': 4, 'cause': '.jpg', 'ts': 1780099200},
        {'name': 'DRIFT', 'score': 1540, 'wave': 4, 'cause': '.png', 'ts': 1779840000},
        {'name': 'ROCKS', 'score': 1200, 'wave': 3, 'cause': '.mp3', 'ts': 1779580800},
        {'name': 'BLAST', 'score': 940},
        {'name': 'WARP7', 'score': 610},
    ],
    # Per-day buckets for the trend graph under the live-usage card.
    'daily': _mock_daily(),
}

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
# The website now lives under web/ (serve.py stays in the repo root but its
# document root is web/, so clean-URL routing mirrors the Cloudflare deploy,
# which serves the contents of web/ at "/").
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')


class CleanURLHandler(SimpleHTTPRequestHandler):
    def _route(self):
        """Map the request path to a file to serve, or return None to redirect.

        Sets self._not_found when the path matches no asset and no clean-URL page,
        in which case the returned target is the 404 page and the caller serves it
        with a 404 status (mirrors Cloudflare not_found_handling = "404-page")."""
        self._not_found = False
        raw = self.path.split('?', 1)[0].split('#', 1)[0]
        # Decode percent-escapes before any filesystem check: a request for
        # "/samples/analyser%20plaque.obj" must match the on-disk file with a
        # literal space, not a file named "...%20...". Without this, any asset
        # whose name contains a space (or other escaped char) fails os.path.isfile
        # and wrongly falls through to the SPA fallback (index.html) - which is how
        # clicked /samples files came back as HTML. Cloudflare decodes for us in
        # production, so this only bites the dev server.
        path = urllib.parse.unquote(raw)

        # /x.html -> redirect to the clean /x  (and /index.html -> /)
        if path.endswith('.html'):
            clean = path[:-5]
            if clean.endswith('/index'):
                clean = clean[:-5]  # ".../index" -> ".../"
            if clean == '':
                clean = '/'
            self.send_response(308)
            self.send_header('Location', urllib.parse.quote(clean))
            self.end_headers()
            return None

        if path == '/':
            return '/index.html'

        rel = path.lstrip('/')
        full = os.path.join(ROOT, rel)
        if os.path.isfile(full):
            return raw                        # real asset (css/js/img/txt/...): hand
                                              # back the still-encoded path so the base
                                              # handler unquotes it once, as normal
        if os.path.isfile(full + '.html'):
            return '/' + rel + '.html'        # clean page route: /about -> about.html
        self._not_found = True                # no match: serve the custom 404 page
        return '/404.html'

    def _serve_api(self, path):
        """Mock /api/* locally; return True if handled."""
        if not path.startswith('/api/'):
            return False
        if path == '/api/stats':
            payload = MOCK_STATS
        elif path == '/api/visit':
            payload = {'files': MOCK_STATS['files'], 'visitors': MOCK_STATS['visitors'], 'counted': False}
        elif path == '/api/leaderboard':
            payload = {'top': MOCK_STATS['scores'][:5]}
        elif path == '/api/score':
            payload = {'ok': True, 'top': MOCK_STATS['scores'][:5]}
        else:
            payload = {'ok': True}
        body = json.dumps(payload).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self._cc_set = True   # end_headers must not add a second Cache-Control
        self.end_headers()
        self.wfile.write(body)
        return True

    def _serve_notfound(self):
        """Serve web/404.html with a 404 status (body skipped for HEAD)."""
        try:
            with open(os.path.join(ROOT, '404.html'), 'rb') as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def end_headers(self):
        # Local dev only: forbid heuristic caching of every static asset so edits
        # always show on a single refresh - including JS chunks pulled by import()
        # on a later user action (e.g. dropping a file), which a hard-reload's
        # cache-bypass does NOT cover. 'no-cache' still lets the browser store and
        # revalidate (If-Modified-Since -> 304), so it stays fast. The /api/* mocks
        # set their own no-store and the flag below stops us doubling the header.
        if not getattr(self, '_cc_set', False):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
            self._cc_set = True
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if self._serve_api(path):
            return
        target = self._route()
        if target is None:
            return  # already sent the redirect
        if self._not_found:
            return self._serve_notfound()
        self.path = target
        return super().do_GET()

    def do_POST(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        # Drain any request body so keep-alive connections stay clean.
        length = int(self.headers.get('Content-Length') or 0)
        if length:
            try:
                self.rfile.read(length)
            except Exception:
                pass
        if self._serve_api(path):
            return
        self.send_error(404)

    def do_HEAD(self):
        target = self._route()
        if target is None:
            return
        if self._not_found:
            return self._serve_notfound()
        self.path = target
        return super().do_HEAD()

    # A hard reload (or SPA navigation) aborts the in-flight requests the browser
    # no longer needs. On Windows that surfaces as ConnectionAbortedError /
    # ConnectionResetError / BrokenPipeError while we're still writing the
    # response - which otherwise prints an alarming traceback and, with the
    # service worker firing concurrent revalidation fetches, was taking the dev
    # server down. Swallow exactly those: the client is gone, so there is nothing
    # to send and nothing to report. Any other error still propagates normally.
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def log_error(self, *args):
        # Aborted-connection noise only reaches here as a "code 400, message Bad
        # request version" style line; keep the dev console readable.
        pass


# ---------------------------------------------------------------------------
# Terminal QR code for the LAN URL
#
# So a phone on the same Wi-Fi can join by pointing its camera at the console
# instead of typing the Network URL. A tiny pure-Python QR generator (byte mode,
# error-correction level M, versions 1-10) - no third-party deps, matching the
# rest of this repo. Port of the well-trodden nayuki reference algorithm, trimmed
# to what a short "http://ip:port" URL needs; validated end-to-end against an
# OpenCV decoder across versions 2-10.
# ---------------------------------------------------------------------------

# GF(256) log/antilog tables (primitive polynomial 0x11D).
_QR_EXP = [0] * 256
_QR_LOG = [0] * 256


def _qr_init_gf():
    x = 1
    for i in range(255):
        _QR_EXP[i] = x
        _QR_LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    _QR_EXP[255] = _QR_EXP[0]


_qr_init_gf()


def _qr_gmul(a, b):
    if a == 0 or b == 0:
        return 0
    return _QR_EXP[(_QR_LOG[a] + _QR_LOG[b]) % 255]


def _qr_rs_generator(degree):
    g = [1]
    for i in range(degree):
        ng = [0] * (len(g) + 1)
        for j in range(len(g)):
            ng[j] ^= g[j]                             # x * g  (keeps it monic)
            ng[j + 1] ^= _qr_gmul(g[j], _QR_EXP[i])   # alpha^i * g
        g = ng
    return g


def _qr_rs_ecc(data, degree):
    gen = _qr_rs_generator(degree)
    res = list(data) + [0] * degree
    for i in range(len(data)):
        coef = res[i]
        if coef:
            for j in range(len(gen)):
                res[i + j] ^= _qr_gmul(gen[j], coef)
    return res[len(data):]


# version -> (ecc codewords per block, [(block count, data codewords per block)])
_QR_VER = {
    1: (10, [(1, 16)]), 2: (16, [(1, 28)]), 3: (26, [(1, 44)]),
    4: (18, [(2, 32)]), 5: (24, [(2, 43)]), 6: (16, [(4, 27)]),
    7: (18, [(4, 31)]), 8: (22, [(2, 38), (2, 39)]),
    9: (22, [(3, 36), (2, 37)]), 10: (26, [(4, 43), (1, 44)]),
}
_QR_ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}


def _qr_bit(x, i):
    return (x >> i) & 1


def _qr_pick_version(nbytes):
    for v in range(1, 11):
        total_cw = sum(c * d for c, d in _QR_VER[v][1])
        count_bits = 16 if v >= 10 else 8
        if 4 + count_bits + 8 * nbytes <= total_cw * 8:
            return v
    raise ValueError("URL too long for a version-10 QR (%d bytes)" % nbytes)


def _qr_data_codewords(data, version):
    total_bits = sum(c * d for c, d in _QR_VER[version][1]) * 8
    bits = []

    def put(val, n):
        for i in range(n - 1, -1, -1):
            bits.append((val >> i) & 1)

    put(0b0100, 4)                                  # byte mode
    put(len(data), 16 if version >= 10 else 8)      # character count
    for b in data:
        put(b, 8)
    put(0, min(4, total_bits - len(bits)))          # terminator
    while len(bits) % 8:                             # pad to a byte boundary
        bits.append(0)
    pad, i = (0xEC, 0x11), 0
    while len(bits) < total_bits:                    # pad codewords
        put(pad[i % 2], 8)
        i += 1
    return [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, total_bits, 8)]


def _qr_interleave(data_cw, version):
    ecc_len, groups = _QR_VER[version]
    blocks, idx = [], 0
    for count, dcw in groups:
        for _ in range(count):
            blocks.append(data_cw[idx:idx + dcw])
            idx += dcw
    ecc_blocks = [_qr_rs_ecc(b, ecc_len) for b in blocks]
    out = []
    for i in range(max(len(b) for b in blocks)):
        for b in blocks:
            if i < len(b):
                out.append(b[i])
    for i in range(ecc_len):
        for eb in ecc_blocks:
            out.append(eb[i])
    return out


def _qr_build(codewords, version):
    size = 17 + 4 * version
    mods = [[0] * size for _ in range(size)]
    fn = [[False] * size for _ in range(size)]

    def setf(col, row, val):
        mods[row][col] = 1 if val else 0
        fn[row][col] = True

    for i in range(size):                            # timing patterns
        setf(6, i, i % 2 == 0)
        setf(i, 6, i % 2 == 0)

    def finder(cx, cy):                              # finder + separator ring
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                x, y = cx + dx, cy + dy
                if 0 <= x < size and 0 <= y < size:
                    setf(x, y, max(abs(dx), abs(dy)) not in (2, 4))

    finder(3, 3)
    finder(size - 4, 3)
    finder(3, size - 4)

    pos = _QR_ALIGN[version]                          # alignment patterns
    last = len(pos) - 1
    skip = {(0, 0), (0, last), (last, 0)}
    for i, ax in enumerate(pos):
        for j, ay in enumerate(pos):
            if (i, j) not in skip:
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        setf(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)

    setf(8, size - 8, 1)                             # always-dark module

    for i in range(9):                               # reserve format-info cross
        if i != 6:
            setf(i, 8, 0)
            setf(8, i, 0)
    for i in range(8):
        setf(size - 1 - i, 8, 0)
        setf(8, size - 1 - i, 0)

    if version >= 7:                                 # version-info blocks
        rem = version
        for _ in range(12):
            rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
        vbits = (version << 12) | rem
        for i in range(18):
            bit = _qr_bit(vbits, i)
            a, b = size - 11 + i % 3, i // 3
            setf(b, a, bit)
            setf(a, b, bit)

    bit = 0                                          # data/ecc up-down zigzag
    for right in range(size - 1, 0, -2):
        if right <= 6:
            right -= 1                               # step past timing column
        upward = ((right + 1) & 2) == 0
        for i in range(size):
            row = (size - 1 - i) if upward else i
            for c in (right, right - 1):
                if not fn[row][c]:
                    val = 0
                    if bit < len(codewords) * 8:
                        val = _qr_bit(codewords[bit >> 3], 7 - (bit & 7))
                    mods[row][c] = val
                    bit += 1
    return mods, fn, size


def _qr_mask(m, col, row):
    if m == 0:
        return (row + col) % 2 == 0
    if m == 1:
        return row % 2 == 0
    if m == 2:
        return col % 3 == 0
    if m == 3:
        return (row + col) % 3 == 0
    if m == 4:
        return (row // 2 + col // 3) % 2 == 0
    if m == 5:
        return (row * col) % 2 + (row * col) % 3 == 0
    if m == 6:
        return ((row * col) % 2 + (row * col) % 3) % 2 == 0
    return ((row + col) % 2 + (row * col) % 3) % 2 == 0


def _qr_place_format(mods, size, mask):
    data = mask                                      # EC level M -> 0b00
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    bits = ((data << 10) | rem) ^ 0x5412
    for i in range(6):                               # copy 1
        mods[i][8] = _qr_bit(bits, i)
    mods[7][8] = _qr_bit(bits, 6)
    mods[8][8] = _qr_bit(bits, 7)
    mods[8][7] = _qr_bit(bits, 8)
    for i in range(9, 15):
        mods[8][14 - i] = _qr_bit(bits, i)
    for i in range(8):                               # copy 2
        mods[8][size - 1 - i] = _qr_bit(bits, i)
    for i in range(8, 15):
        mods[size - 15 + i][8] = _qr_bit(bits, i)
    mods[size - 8][8] = 1


def _qr_penalty(mods, size):
    score = 0
    p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
    p2 = list(reversed(p1))
    lines = [row[:] for row in mods] + \
            [[mods[r][c] for r in range(size)] for c in range(size)]
    for line in lines:
        run = 1
        for i in range(1, size):
            if line[i] == line[i - 1]:
                run += 1
                if run == 5:
                    score += 3
                elif run > 5:
                    score += 1
            else:
                run = 1
        for i in range(size - 11):
            seg = line[i:i + 11]
            if seg == p1 or seg == p2:
                score += 40
    for r in range(size - 1):
        for c in range(size - 1):
            v = mods[r][c]
            if v == mods[r][c + 1] == mods[r + 1][c] == mods[r + 1][c + 1]:
                score += 3
    ratio = sum(sum(row) for row in mods) * 100 // (size * size)
    score += (abs(ratio - 50) // 5) * 10
    return score


def qr_matrix(text):
    """QR module grid for text (list of rows of bool, True = dark)."""
    version = _qr_pick_version(len(text.encode("utf-8")))
    codewords = _qr_interleave(_qr_data_codewords(text.encode("utf-8"), version), version)
    base, fn, size = _qr_build(codewords, version)
    best, best_score = None, None
    for m in range(8):
        mods = [row[:] for row in base]
        for r in range(size):
            for c in range(size):
                if not fn[r][c] and _qr_mask(m, c, r):
                    mods[r][c] ^= 1
        _qr_place_format(mods, size, m)
        s = _qr_penalty(mods, size)
        if best_score is None or s < best_score:
            best, best_score = mods, s
    return [[bool(v) for v in row] for row in best]


def qr_terminal(text, quiet=3):
    """Black-on-white block art with a quiet zone, for any ANSI terminal."""
    grid = qr_matrix(text)
    size = len(grid)
    black = "\x1b[40m  \x1b[0m"
    white = "\x1b[107m  \x1b[0m"
    out = [white * (size + 2 * quiet)] * quiet
    for row in grid:
        out.append(white * quiet + "".join(black if v else white for v in row) + white * quiet)
    out += [white * (size + 2 * quiet)] * quiet
    return "\n".join(out)


def _lan_ip():
    """Best-guess LAN IPv4 (the address a phone on the same Wi-Fi would use)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))   # no packets sent; just picks the route's src IP
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def _print_startup_qr(port):
    # argv[2] lets server.bat pass the IP it already found; otherwise detect it.
    ip = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else _lan_ip()
    url = 'http://%s:%d' % (ip, port)
    if os.name == 'nt':
        # Enable ANSI colours in the classic console (Windows Terminal already has
        # them); without this the escape codes would print as raw text.
        try:
            import ctypes
            k = ctypes.windll.kernel32
            k.SetConsoleMode(k.GetStdHandle(-11), 7)
        except Exception:
            pass
    try:
        print(qr_terminal(url))
    except Exception:
        pass  # never let the QR stop the server from starting
    print('  Scan the QR (same Wi-Fi) or open  %s\n' % url)


def _die_on_console_close():
    """Exit immediately when the console window is closed/logged off/shut down.

    Without this, closing the "analyser server" window (the X button, not
    Ctrl+C) doesn't reliably kill a ThreadingHTTPServer in time - it can be
    left holding PORT, so the *next* server.bat launch fails to bind. That's
    also why server.bat pre-kills whatever's still on the port; this makes
    that workaround unnecessary in the common case by shutting down the
    instant Windows signals the close."""
    if os.name != 'nt':
        return
    import ctypes

    CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT = 2, 5, 6

    @ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_uint)
    def _handler(event):
        if event in (CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT):
            os._exit(0)
        return 0

    ctypes.windll.kernel32.SetConsoleCtrlHandler(_handler, True)
    _die_on_console_close._handler = _handler  # keep the ctypes callback alive


if __name__ == '__main__':
    _die_on_console_close()
    _print_startup_qr(PORT)
    os.chdir(ROOT)
    # ThreadingHTTPServer (not HTTPServer): the service worker fires background
    # revalidation fetches (stale-while-revalidate) concurrently with the page's
    # own requests. A single-threaded server serialises those and can deadlock -
    # the SW's navigation fetch never resolves, so the page "loads" forever with
    # nothing in the console. One thread per request avoids it.
    httpd = ThreadingHTTPServer(('0.0.0.0', PORT), CleanURLHandler)
    print('Serving %s on http://0.0.0.0:%d  (clean URLs, mirrors Cloudflare)' % (ROOT, PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
