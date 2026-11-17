# Writes icon-180.png and icon-512.png: the name with fading copies above and below it,
# like the header (Keli, 17 Nov, after a "FOCUS" shot he sent). The drawing lives in
# tools/icon.html because it needs the Outfit font, which any browser has and Python here doesn't.
#
#   python3 -I tools/make_icon.py      then open the link it prints in a browser.
#
# The page draws both sizes and sends them back here; this stops once both are saved.
# Standard library only, listens on 127.0.0.1 only.
import http.server
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "tools" / "icon.html"
NAMES = {"icon-180.png", "icon-512.png"}
PORT = 8923
saved = set()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/", "/index.html"):
            self.send_error(404)
            return
        body = PAGE.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        name = self.path.removeprefix("/save/")
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if name not in NAMES or not data.startswith(b"\x89PNG"):
            self.send_error(400)
            return
        (ROOT / name).write_bytes(data)
        saved.add(name)
        print(f"wrote {name} ({len(data)} bytes)")
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
print(f"open http://127.0.0.1:{PORT}/")
while saved != NAMES:
    server.handle_request()
