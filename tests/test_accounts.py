"""Offline boundary tests with a simulated Supabase service; not a live RLS test."""

import base64
import hashlib
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import server

A = str(uuid.uuid4())
B = str(uuid.uuid4())


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [
            patch.object(
                accounts, "SESSIONS", Path(self.temp.name) / "sessions.sqlite3"
            ),
            patch.object(accounts, "SUPABASE_URL", "https://example.supabase.co"),
            patch.object(accounts, "SUPABASE_KEY", "test-placeholder"),
            patch.object(accounts, "ORIGIN", "http://127.0.0.1:4173"),
            patch.object(accounts, "remote", side_effect=self.remote),
        ]
        for item in self.patches:
            item.start()
        accounts._attempts.clear()
        self.rows = {}
        self.photos = {}
        self.cookies = {}
        for uid in (A, B):
            self.cookies[uid] = self.call(
                "/api/auth/login",
                "POST",
                {"email": uid + "@example.test", "password": "test-password"},
            )["headers"]["Set-Cookie"].split(";")[0]

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def remote(
        self, path, method="GET", data=None, token=None, binary=False, mime=None
    ):
        if path == "/auth/v1/token?grant_type=password":
            uid = data["email"].split("@")[0]
            return {
                "access_token": uid,
                "expires_in": 3600,
                "user": {"id": uid, "email": data["email"]},
            }
        if path == "/auth/v1/user":
            return {"id": token, "email": token + "@example.test"}
        if path.startswith("/storage/v1/object/authenticated/"):
            return self.photos[path.split("/journal-photos/")[1]]
        if path.startswith("/storage/v1/object/"):
            if method == "DELETE":
                for name in data["prefixes"]:
                    self.photos.pop(name, None)
                return {}
            self.photos[path.split("/journal-photos/")[1]] = data
            return {}
        if path.startswith("/rest/v1/entries"):
            # Simulate ownership, and additionally assert that Python scopes every read/write.
            if method != "POST":
                assert "user_id=eq." + token in path
            rows = [r for r in self.rows.values() if r["user_id"] == token]
            if "id=eq." in path.split("?")[-1].split("&")[0] and "?id=" in path:
                entry_id = path.split("?id=eq.")[1].split("&")[0]
                rows = [r for r in rows if r["id"] == entry_id]
            if method == "POST":
                assert data["user_id"] == token
                row = dict(data, id=str(uuid.uuid4()))
                self.rows[row["id"]] = row
                return [row]
            if method == "PATCH":
                for row in rows:
                    row.update(data)
            if method == "DELETE":
                for row in rows:
                    self.rows.pop(row["id"])
            return json.loads(json.dumps(rows))
        raise AssertionError(path)

    def call(
        self,
        path,
        method="GET",
        data=None,
        user=None,
        origin="http://127.0.0.1:4173",
        csrf="1",
        cookie=None,
    ):
        raw = json.dumps(data or {}).encode()
        result = {}
        env = {
            "PATH_INFO": path,
            "REQUEST_METHOD": method,
            "HTTP_ORIGIN": origin,
            "HTTP_X_FEILOU_REQUEST": csrf,
            "HTTP_COOKIE": cookie or self.cookies.get(user, ""),
            "CONTENT_TYPE": "application/json",
            "CONTENT_LENGTH": str(len(raw)),
            "wsgi.input": io.BytesIO(raw),
        }

        def start(status, headers):
            result.update(status=int(status.split()[0]), headers=dict(headers))

        result["body"] = b"".join(server.app(env, start))
        if "application/json" in result["headers"]["Content-Type"]:
            result["json"] = json.loads(result["body"])
        return result

    def entry(self, photos=None):
        return {
            "title": "A memory",
            "name": "Paris",
            "date": "2026-10-07",
            "note": "Good coffee",
            "lat": 48.8,
            "lng": 2.3,
            "photos": photos or [],
        }

    def test_username_signup_and_login_use_same_identity(self):
        email = "u-traveler_7@users.feilou.invalid"
        reply = {
            "access_token": A,
            "expires_in": 3600,
            "user": {"id": A, "email": email},
        }
        with patch.object(
            accounts, "remote", side_effect=[{"mailer_autoconfirm": True}, reply]
        ) as remote:
            result = self.call(
                "/api/auth/signup",
                "POST",
                {"username": " Traveler_7 ", "password": "test-password"},
            )
            self.assertEqual(result["status"], 200)
            self.assertEqual(result["json"]["user"]["username"], "traveler_7")
            self.assertEqual(remote.call_args.args[2]["email"], email)
        with patch.object(accounts, "remote", return_value=reply) as remote:
            result = self.call(
                "/api/auth/login",
                "POST",
                {"username": "TRAVELER_7", "password": "test-password"},
            )
            self.assertEqual(result["status"], 200)
            self.assertEqual(remote.call_args.args[2]["email"], email)

    def test_signup_stops_before_email_when_confirmation_enabled(self):
        with patch.object(
            accounts, "remote", return_value={"mailer_autoconfirm": False}
        ) as remote:
            result = self.call(
                "/api/auth/signup",
                "POST",
                {"username": "traveler", "password": "test-password"},
            )
            self.assertEqual(result["status"], 503)
            remote.assert_called_once_with("/auth/v1/settings")

    def test_invalid_usernames_do_not_reach_provider(self):
        with patch.object(accounts, "remote") as remote:
            for username in ["ab", "a b c", "new@email.test", "x" * 33, None]:
                self.assertEqual(
                    self.call(
                        "/api/auth/signup",
                        "POST",
                        {"username": username, "password": "test-password"},
                    )["status"],
                    400,
                )
            remote.assert_not_called()

    def test_wrong_password_is_rejected_without_session(self):
        with patch.object(
            accounts, "remote", side_effect=accounts.AccountError("Provider error", 401)
        ):
            result = self.call(
                "/api/auth/login",
                "POST",
                {"username": "traveler", "password": "wrong-password"},
            )
            self.assertEqual(result["status"], 400)
            self.assertNotIn("Set-Cookie", result["headers"])

    def test_login_cookie_and_tokens_not_returned(self):
        result = self.call(
            "/api/auth/login",
            "POST",
            {"email": A + "@example.test", "password": "test-password"},
        )
        self.assertIn("HttpOnly", result["headers"]["Set-Cookie"])
        self.assertIn("SameSite=Lax", result["headers"]["Set-Cookie"])
        self.assertNotIn("access_token", result["json"])
        self.assertNotIn("token", result["json"])
        with patch.object(accounts, "ORIGIN", "https://feilou.example"):
            self.assertIn("Secure", accounts.cookie("opaque", 60)[1])

    def test_two_users_cannot_read_edit_or_delete_others_entries(self):
        data = self.entry()
        data["user_id"] = B  # Spoofed owner is ignored.
        created = self.call("/api/entries", "POST", data, A)
        self.assertEqual(created["status"], 200)
        entry = created["json"]["entry"]
        self.assertEqual(entry["user_id"], A)
        self.assertEqual(len(self.call("/api/entries", user=A)["json"]["entries"]), 1)
        self.assertEqual(self.call("/api/entries", user=B)["json"]["entries"], [])
        for method in ("PUT", "DELETE"):
            self.assertEqual(
                self.call("/api/entries/" + entry["id"], method, self.entry(), B)[
                    "status"
                ],
                404,
            )
        updated = self.entry()
        updated["note"] = "Edited note"
        self.assertEqual(
            self.call("/api/entries/" + entry["id"], "PUT", updated, A)["json"][
                "entry"
            ]["note"],
            "Edited note",
        )
        self.assertEqual(
            self.call("/api/entries/" + entry["id"], "DELETE", {}, A)["status"], 200
        )
        self.assertEqual(self.call("/api/entries", user=A)["json"]["entries"], [])

    def test_session_persists_and_logout_invalidates_cookie(self):
        self.assertEqual(
            self.call("/api/auth/session", user=A)["json"]["user"]["id"], A
        )
        self.assertEqual(self.call("/api/auth/logout", "POST", {}, A)["status"], 200)
        self.assertEqual(self.call("/api/entries", user=A)["status"], 401)

    def test_expired_session_and_anonymous_requests(self):
        with accounts.session_db() as connection:
            connection.execute("UPDATE sessions SET expires=?", (time.time() - 5,))
        self.assertEqual(self.call("/api/entries", user=A)["status"], 401)
        self.assertEqual(self.call("/api/entries")["status"], 401)

    def test_csrf_and_invalid_data(self):
        self.assertEqual(
            self.call(
                "/api/entries", "POST", self.entry(), A, origin="https://evil.example"
            )["status"],
            403,
        )
        self.assertEqual(
            self.call("/api/entries", "POST", self.entry(), A, csrf="")["status"], 403
        )
        for changes in (
            {"lat": float("nan")},
            {"date": "wrong"},
            {"note": ""},
            {"photos": ["bad"]},
            {"photos": [{}] * 5},
        ):
            data = dict(self.entry(), **changes)
            self.assertIn(
                self.call("/api/entries", "POST", data, A)["status"], (400, 403)
            )

    def test_photo_upload_read_and_isolation(self):
        from PIL import Image

        stream = io.BytesIO()
        Image.new("RGB", (2, 2), "green").save(stream, format="PNG")
        photo = {"data": base64.b64encode(stream.getvalue()).decode()}
        result = self.call("/api/entries", "POST", self.entry([photo]), A)
        self.assertEqual(result["status"], 200)
        entry = result["json"]["entry"]
        path = entry["photos"][0]
        response = self.call("/api/photos/" + path, user=A)
        self.assertEqual(response["body"], stream.getvalue())
        self.assertEqual(response["headers"]["Cache-Control"], "private, no-store")
        self.assertEqual(self.call("/api/photos/" + path, user=B)["status"], 404)
        self.assertEqual(self.call("/api/photos/" + path)["status"], 401)
        self.assertEqual(
            self.call("/api/entries", "POST", self.entry([path]), B)["status"], 403
        )
        self.call("/api/entries/" + entry["id"], "PUT", self.entry(), A)
        self.assertEqual(self.photos, {})

    def test_fake_image_rejected_before_upload(self):
        fake = {"data": base64.b64encode(b"<script>bad</script>").decode()}
        self.assertEqual(
            self.call("/api/entries", "POST", self.entry([fake]), A)["status"], 400
        )
        self.assertEqual(self.photos, {})

    def test_unconfigured_mode(self):
        with patch.object(accounts, "SUPABASE_KEY", ""):
            self.assertEqual(
                self.call("/api/auth/session")["json"],
                {"configured": False, "user": None},
            )
            self.assertEqual(self.call("/api/entries")["status"], 503)


if __name__ == "__main__":
    unittest.main()
