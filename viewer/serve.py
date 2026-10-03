#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Serve the viewer against an export folder.

    python serve.py "C:\\dev\\lwk-viewer\\exports\\test01"

The viewer files are served from this directory at /, and the export
folder is mounted at /data/, so the app fetches /data/manifest.json,
/data/sheets/A005.pdf and so on.

A server is needed rather than opening index.html directly because
browsers block fetch() from file:// URLs.
"""

import http.server
import os
import socketserver
import sys
import webbrowser

PORT = 8712
VIEWER = os.path.dirname(os.path.abspath(__file__))
EXPORT = None


class Handler(http.server.SimpleHTTPRequestHandler):

    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".wasm": "application/wasm",
        ".ifc": "application/octet-stream",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".pdf": "application/pdf",
    })

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        clean = clean.lstrip("/")

        if clean.startswith("data/"):
            root, rel = EXPORT, clean[5:]
        else:
            root, rel = VIEWER, clean or "index.html"

        # Refuse anything that climbs out of its root.
        target = os.path.normpath(os.path.join(root, *rel.split("/")))
        if not target.startswith(os.path.normpath(root)):
            return os.path.join(root, "index.html")
        return target

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            sys.stderr.write("  missing: %s\n" % (fmt % args))


def main():
    global EXPORT
    if len(sys.argv) < 2:
        sys.exit("usage: python serve.py <export folder>")

    EXPORT = os.path.abspath(sys.argv[1])
    if not os.path.exists(os.path.join(EXPORT, "manifest.json")):
        sys.exit("No manifest.json in %s" % EXPORT)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = "http://127.0.0.1:%d/" % PORT
        print("viewer  : %s" % VIEWER)
        print("export  : %s" % EXPORT)
        print("serving : %s   (Ctrl+C to stop)" % url)
        try:
            webbrowser.open(url)
        except Exception:
            pass
        httpd.serve_forever()


if __name__ == "__main__":
    main()
