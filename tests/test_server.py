"""No external requests: exercise cache, throttling, validation and secret isolation."""

import io
import json
from pathlib import Path
import sys
import tempfile
import socket
import threading
from urllib.request import urlopen
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_cache = server.CACHE
        server.CACHE = Path(self.temp.name) / "cache.sqlite3"
        server._next_request = 0

    def tearDown(self):
        server.CACHE = self.old_cache
        self.temp.cleanup()

    def call(self, path, query="", method="GET"):
        result = {}

        def start(status, headers):
            result.update(status=status, headers=dict(headers))

        result["body"] = b"".join(
            server.app(
                {"PATH_INFO": path, "QUERY_STRING": query, "REQUEST_METHOD": method},
                start,
            )
        )
        return result

    def test_idle_connection_does_not_block_page(self):
        http = server.make_server(
            "127.0.0.1", 0, server.app, server_class=server.LocalServer
        )
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        idle = socket.create_connection(http.server_address, timeout=2)
        try:
            with urlopen(
                f"http://127.0.0.1:{http.server_port}/", timeout=2
            ) as response:
                self.assertEqual(response.status, 200)
        finally:
            idle.close()
            http.shutdown()
            http.server_close()
            thread.join(timeout=2)

    def test_private_files_not_served(self):
        for path in [
            "/config.js",
            "/config.example.js",
            "/.env",
            "/../server.py",
            "/.git/config",
            "/server.py",
            "/assets/../../server.py",
        ]:
            self.assertTrue(self.call(path)["status"].startswith("404"), path)
        self.assertTrue(self.call("/app.js")["status"].startswith("200"))

    def test_input_and_method_validation(self):
        self.assertTrue(self.call("/api/search", "q=x")["status"].startswith("400"))
        self.assertTrue(
            self.call("/api/search", "q=Paris", method="POST")["status"].startswith(
                "405"
            )
        )

    def test_cached_results_and_shared_rate_limit(self):
        upstream = [
            {
                "display_name": "Test town",
                "lat": "48.8",
                "lon": "2.3",
                "boundingbox": ["48", "49", "2", "3"],
            }
        ]
        with patch.object(
            server, "urlopen", return_value=io.BytesIO(json.dumps(upstream).encode())
        ) as request:
            first = server.search_places("Test town")
            second = server.search_places("  test town ")
            self.assertFalse(first["cached"])
            self.assertTrue(second["cached"])
            self.assertEqual(request.call_count, 1)
            with self.assertRaises(server.SearchError) as caught:
                server.search_places("Different place")
            self.assertEqual(caught.exception.status, 429)
            self.assertEqual(first["results"][0]["bounds"], [[48.0, 2.0], [49.0, 3.0]])

    def test_upstream_failure_is_safe(self):
        with patch.object(
            server, "urlopen", side_effect=server.URLError("private diagnostic")
        ):
            result = self.call("/api/search", "q=Unknown")
            self.assertTrue(result["status"].startswith("503"))
            self.assertNotIn(b"private diagnostic", result["body"])

    def test_invalid_coordinates_are_excluded(self):
        with patch.object(
            server,
            "urlopen",
            return_value=io.BytesIO(b'[{"display_name":"bad","lat":"nan","lon":"2"}]'),
        ):
            self.assertEqual(server.search_places("Invalid place")["results"], [])


if __name__ == "__main__":
    unittest.main()
