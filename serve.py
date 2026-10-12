"""Serve the dashboard locally (127.0.0.1 only).

Port comes from the PORT environment variable (default 8080), so it can run
alongside other local servers.  Usage:  python serve.py
"""
import functools
import http.server
import os

PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard")

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"Serving {ROOT} at http://127.0.0.1:{PORT}")
    httpd.serve_forever()
