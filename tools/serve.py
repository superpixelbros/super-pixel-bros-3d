# Zero-dependency dev server: same as `python3 -m http.server` but sends
# `Cache-Control: no-store`, so edited JS/HTML/CSS always shows up on a
# plain reload (python's default heuristic caching serves stale modules).
# Usage: python3 tools/serve.py [port]   (default 8000)
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoStoreHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoStoreHandler, directory=".")
    print(f"Serving . on http://localhost:{port} (no-store)")
    ThreadingHTTPServer(("", port), handler).serve_forever()

if __name__ == "__main__":
    main()
