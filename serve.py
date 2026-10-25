#!/usr/bin/env python3
"""Static server for Solar with no-cache headers, so edits show up on reload."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8965
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
