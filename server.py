"""Feilou: same-origin static files and an explicitly submitted, keyless search.
Run: python3 server.py. See SETUP.md for account configuration.
Deploy: gunicorn --workers 1 --threads 4 server:app (one instance only).
"""

import json
import math
import mimetypes
import os
from pathlib import Path
import sqlite3
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
from socketserver import ThreadingMixIn
from wsgiref.simple_server import make_server, WSGIServer
import accounts

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "dist"
CACHE = Path(os.environ.get("SEARCH_CACHE_PATH", str(ROOT / ".cache/search.sqlite3")))
SEARCH_URL = os.environ.get("SEARCH_URL", "https://nominatim.openstreetmap.org/search")
USER_AGENT = os.environ.get(
    "SEARCH_USER_AGENT",
    "FeilouTravelJournal/1.0 (student travel journal; user-submitted searches)",
)
TILE_URL = os.environ.get("TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
TILE_ATTRIBUTION = os.environ.get("TILE_ATTRIBUTION", "© OpenStreetMap contributors")
_lock = threading.Lock()
_next_request = 0.0


class SearchError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def search_places(query):
    """One shared upstream gate, durable cache, and no retries/autocomplete."""
    global _next_request
    query = " ".join(query.split())
    if not 2 <= len(query) <= 160:
        raise SearchError("Enter a place name between 2 and 160 characters.", 400)
    cache_key = SEARCH_URL + "\n" + query.casefold()
    with _lock:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(CACHE) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS searches (query TEXT PRIMARY KEY, data TEXT, created REAL)"
            )
            cached = connection.execute(
                "SELECT data FROM searches WHERE query=? AND created>?",
                (cache_key, time.time() - 30 * 86400),
            ).fetchone()
            if cached:
                return {"results": json.loads(cached[0]), "cached": True}
            if time.monotonic() < _next_request:
                raise SearchError(
                    "Search is busy. Wait a moment, then press Find again.", 429
                )
            # All users share this gate. Never deploy multiple workers or replicas.
            _next_request = time.monotonic() + 1.1
            request = Request(
                SEARCH_URL
                + "?"
                + urlencode(
                    {
                        "q": query,
                        "format": "jsonv2",
                        "limit": 6,
                        "accept-language": "en",
                    }
                ),
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            try:
                with urlopen(request, timeout=10) as response:
                    raw = response.read(1_000_001)
                if len(raw) > 1_000_000:
                    raise ValueError("Oversized response")
                data = json.loads(raw)
                if not isinstance(data, list):
                    raise ValueError("Unexpected response")
                results = []
                for item in data[:6]:
                    lat, lng = float(item["lat"]), float(item["lon"])
                    if (
                        not math.isfinite(lat)
                        or not math.isfinite(lng)
                        or not (-90 <= lat <= 90 and -180 <= lng <= 180)
                    ):
                        continue
                    result = {
                        "name": str(item["display_name"])[:500],
                        "lat": lat,
                        "lng": lng,
                    }
                    bounds = item.get("boundingbox")
                    if isinstance(bounds, list) and len(bounds) == 4:
                        bounds = [float(v) for v in bounds]
                        if (
                            all(math.isfinite(v) for v in bounds)
                            and -90 <= bounds[0] <= bounds[1] <= 90
                            and -180 <= bounds[2] <= bounds[3] <= 180
                        ):
                            result["bounds"] = [
                                [bounds[0], bounds[2]],
                                [bounds[1], bounds[3]],
                            ]
                    results.append(result)
            except HTTPError as error:
                _next_request = time.monotonic() + 60
                raise SearchError(
                    "The place service is unavailable. Try again in a minute, or choose a point on the map.",
                    503,
                ) from error
            except (URLError, TimeoutError, ValueError, KeyError, TypeError) as error:
                raise SearchError(
                    "Could not reach place search. Try again later or choose a point on the map."
                ) from error
            connection.execute(
                "INSERT OR REPLACE INTO searches VALUES (?,?,?)",
                (cache_key, json.dumps(results), time.time()),
            )
            connection.execute(
                "DELETE FROM searches WHERE query NOT IN (SELECT query FROM searches ORDER BY created DESC LIMIT 1000)"
            )
            return {"results": results, "cached": False}


def app(environ, start_response):
    def send(status, body, content_type="application/json; charset=utf-8", extra=()):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        start_response(
            status,
            [
                ("Content-Type", content_type),
                ("Content-Length", str(len(body))),
                ("X-Content-Type-Options", "nosniff"),
                ("Referrer-Policy", "strict-origin-when-cross-origin"),
                *extra,
            ],
        )
        return [b"" if environ.get("REQUEST_METHOD") == "HEAD" else body]

    path = environ.get("PATH_INFO", "/")
    if path.startswith(
        ("/api/auth/", "/api/entries", "/api/photos/", "/api/flights", "/api/profile")
    ):
        return accounts.handle(environ, send)
    if environ.get("REQUEST_METHOD") not in ("GET", "HEAD"):
        return send("405 Method Not Allowed", {"error": "Use GET."})
    if path.startswith("/api/"):
        if environ.get("HTTP_SEC_FETCH_SITE") == "cross-site":
            return send("403 Forbidden", {"error": "Open search from the journal."})
        if path == "/api/map-config":
            return send(
                "200 OK", {"tileUrl": TILE_URL, "attribution": TILE_ATTRIBUTION}
            )
        if path != "/api/search":
            return send("404 Not Found", {"error": "Not found."})
        query = parse_qs(environ.get("QUERY_STRING", "")).get("q", [""])[0]
        try:
            return send(
                "200 OK", search_places(query), extra=[("Cache-Control", "no-store")]
            )
        except SearchError as error:
            status = {
                400: "400 Bad Request",
                429: "429 Too Many Requests",
                503: "503 Service Unavailable",
            }[error.status]
            return send(
                status,
                {"error": str(error)},
                extra=[
                    ("Cache-Control", "no-store"),
                    ("Retry-After", "60" if error.status == 503 else "2"),
                ],
            )
        except (OSError, sqlite3.Error):
            return send(
                "503 Service Unavailable",
                {"error": "Search storage unavailable. Choose a point on the map."},
            )
    # Only serve approved public assets; never expose config.js, .env, source, or cache.
    relative = path.lstrip("/") or "index.html"
    file = (PUBLIC / relative).resolve()
    allowed = file.suffix.lower() in {
        ".html",
        ".css",
        ".js",
        ".json",
        ".png",
        ".svg",
        ".jpg",
        ".webp",
    }
    if (
        PUBLIC.resolve() not in file.parents
        or not allowed
        or file.name in {"config.js", "config.example.js"}
        or any(part.startswith(".") for part in Path(relative).parts)
        or not file.is_file()
    ):
        return send("404 Not Found", {"error": "Not found."})
    return send(
        "200 OK",
        file.read_bytes(),
        mimetypes.guess_type(str(file))[0] or "application/octet-stream",
        extra=[("Cache-Control", "no-store")],
    )


class LocalServer(ThreadingMixIn, WSGIServer):
    """Browser preconnect sockets must not block other tabs or static assets."""

    daemon_threads = True

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(60)
        return connection, address


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "4173"))
    with make_server(host, port, app, server_class=LocalServer) as server:
        print(f"Feilou ready at http://{host}:{port}", flush=True)
        server.serve_forever()
