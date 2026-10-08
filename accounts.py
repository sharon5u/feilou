"""Managed Supabase auth with server-only tokens and owner-scoped journal access.

The browser receives an opaque HttpOnly cookie, never a Supabase credential.
All database/storage calls use the user's JWT, so Supabase RLS still applies.
"""

import base64
import hashlib
import io
import json
import math
import os
import re
from pathlib import Path
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import date
from contextlib import contextmanager
from http import HTTPStatus
from http.cookies import SimpleCookie
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
# dotenv is optional until accounts are configured; map-only mode still works.
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
ORIGIN = os.environ.get("APP_ORIGIN", "http://127.0.0.1:4173").rstrip("/")
SESSIONS = ROOT / ".private/sessions.sqlite3"
BUCKET = "journal-photos"
MAX_BODY = 29 * 1024 * 1024
_rate_lock = threading.Lock()
_attempts = {}


class AccountError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def configured():
    return bool(SUPABASE_URL.startswith("https://") and SUPABASE_KEY)


def remote(path, method="GET", data=None, token=None, binary=False, mime=None):
    """Never expose upstream diagnostics (which can contain sensitive details)."""
    headers = {"apikey": SUPABASE_KEY}
    if token:
        headers["Authorization"] = "Bearer " + token
    if data is not None:
        headers["Content-Type"] = mime or "application/json"
        if not isinstance(data, bytes):
            data = json.dumps(data).encode()
    if path.startswith("/rest/"):
        headers["Prefer"] = "return=representation"
        if path.startswith("/rest/v1/profiles") and method == "POST":
            headers["Prefer"] += ",resolution=merge-duplicates"
    request = Request(SUPABASE_URL + path, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read(6 * 1024 * 1024 + 1)
        if len(body) > 6 * 1024 * 1024:
            raise AccountError("The response is too large. Try again later.", 502)
        return body if binary else (json.loads(body) if body else None)
    except HTTPError as error:
        if error.code == 404 and path.startswith(
            ("/rest/v1/flights", "/rest/v1/profiles")
        ):
            raise AccountError(
                "Flight tracker and profiles need the menu-features.sql database setup. Ask the project owner to run it.",
                503,
            ) from None
        if error.code == 429:
            raise AccountError(
                "Too many attempts. Please try again later.", 429
            ) from None
        if error.code in (401, 403):
            raise AccountError(
                "Please sign in again, or check your account permissions.", 401
            ) from None
        raise AccountError(
            "The account service could not complete this request. Check your setup or try again.",
            502,
        ) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise AccountError(
            "The account service is unavailable. Please try again.", 503
        ) from None


@contextmanager
def session_db():
    SESSIONS.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = sqlite3.connect(SESSIONS)
    os.chmod(SESSIONS, 0o600)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token TEXT, expires REAL)"
    )
    connection.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
    connection.commit()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def session_id(env):
    cookie = SimpleCookie()
    try:
        cookie.load(env.get("HTTP_COOKIE", ""))
        value = cookie.get("feilou_session")
        return hashlib.sha256(value.value.encode()).hexdigest() if value else ""
    except Exception:
        return ""


def cookie(value, seconds):
    secure = "; Secure" if ORIGIN.startswith("https://") else ""
    return (
        "Set-Cookie",
        f"feilou_session={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={seconds}{secure}",
    )


# Supabase's password provider uses email identifiers. This reserved, non-deliverable
# alias maps each case-insensitive username to one unique Auth identity.
USERNAME_DOMAIN = "users.feilou.invalid"


def login_identifier(value, signup=False):
    if not isinstance(value, str):
        raise AccountError("Enter a username.")
    value = value.strip().lower()
    # Preserve access to accounts created with real email in the earlier version.
    if not signup and "@" in value and len(value) <= 254:
        return value
    if not re.fullmatch(r"[a-z0-9_\-]{3,32}", value):
        raise AccountError(
            "Use 3–32 letters, numbers, underscores or hyphens for your username."
        )
    return f"u-{value}@{USERNAME_DOMAIN}"


def public_user(user):
    email = user.get("email", "")
    username = (
        email[2:].split("@")[0]
        if email.startswith("u-") and email.endswith("@" + USERNAME_DOMAIN)
        else email
    )
    return {"id": str(uuid.UUID(user["id"])), "username": username}


def identity(env):
    with session_db() as connection:
        row = connection.execute(
            "SELECT token FROM sessions WHERE id=?", (session_id(env),)
        ).fetchone()
    if not row:
        raise AccountError("Sign in to save and see your memories.", 401)
    user = remote("/auth/v1/user", token=row[0])
    return public_user(user), row[0]


def read_json(env):
    if env.get("CONTENT_TYPE", "").split(";")[0] != "application/json":
        raise AccountError("Send JSON.", 415)
    try:
        length = int(env.get("CONTENT_LENGTH", "0"))
        if not 0 < length <= MAX_BODY:
            raise AccountError("Request too large or empty.", 413)
        data = json.loads(env["wsgi.input"].read(length))
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, KeyError):
        raise AccountError("Invalid request.") from None


def validate_entry(data):
    result = {}
    for field, maximum in (("title", 100), ("name", 160), ("note", 10000)):
        value = data.get(field)
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
            raise AccountError(f"Please check the {field} field.")
        result[field] = value.strip()
    try:
        result["date"] = date.fromisoformat(data["date"]).isoformat()
        for field, limit in (("lat", 90), ("lng", 180)):
            value = data[field]
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or abs(value) > limit
            ):
                raise ValueError()
            result[field] = value
    except (KeyError, TypeError, ValueError):
        raise AccountError("Please check the travel date and location.") from None
    if not isinstance(data.get("photos"), list) or len(data["photos"]) > 4:
        raise AccountError("Choose up to four photos.")
    return result


def short_text(data, field, maximum, required=False):
    value = data.get(field, "")
    if (
        not isinstance(value, str)
        or len(value.strip()) > maximum
        or (required and not value.strip())
    ):
        raise AccountError(f"Please check the {field.replace('_', ' ')} field.")
    return value.strip()


def validate_profile(data):
    result = {
        field: short_text(data, field, limit)
        for field, limit in (
            ("name", 100),
            ("hometown", 120),
            ("home_country", 80),
            ("bio", 1000),
        )
    }
    if "avatar" in data:
        avatar = data["avatar"]
        if avatar not in ("mouse", "cow", "tiger", "bunny", "dragon", "snake", "horse", "sheep", "monkey", "chicken", "dog", "pig"):
            raise AccountError("Choose one of the available animal characters.")
        result["avatar"] = avatar
    birthday = data.get("birthday")
    try:
        birthday = date.fromisoformat(birthday) if birthday else None
        if birthday and birthday > date.today():
            raise ValueError()
    except (TypeError, ValueError):
        raise AccountError(
            "Enter a valid birthday that is not in the future."
        ) from None
    result["birthday"] = birthday.isoformat() if birthday else None
    return result


def validate_flight(data):
    result = {
        field: short_text(data, field, limit, required)
        for field, limit, required in (
            ("flight_number", 20, True),
            ("airline", 80, False),
            ("seat", 10, False),
            ("origin", 160, True),
            ("destination", 160, True),
        )
    }
    try:
        result["date"] = date.fromisoformat(data["date"]).isoformat()
        for side in ("origin", "destination"):
            for axis, limit in (("lat", 90), ("lng", 180)):
                field = side + "_" + axis
                value = data[field]
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or abs(value) > limit
                ):
                    raise ValueError()
                result[field] = value
        if (result["origin_lat"], result["origin_lng"]) == (
            result["destination_lat"],
            result["destination_lng"],
        ):
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise AccountError(
            "Choose two different places and a valid flight date."
        ) from None
    return result


def image_bytes(photo):
    """Decode and inspect real image content on the server, not just its extension."""
    try:
        from PIL import Image
    except ImportError:
        raise AccountError(
            "Photo uploads need the server dependencies installed.", 503
        ) from None
    try:
        if (
            not isinstance(photo, dict)
            or not isinstance(photo.get("data"), str)
            or len(photo["data"]) > 7_000_000
        ):
            raise ValueError()
        raw = base64.b64decode(photo["data"], validate=True)
        if not 0 < len(raw) <= 5 * 1024 * 1024:
            raise ValueError()
        with Image.open(io.BytesIO(raw)) as image:
            kind = image.format
            if (
                kind not in ("JPEG", "PNG", "WEBP")
                or image.width * image.height > 40_000_000
            ):
                raise ValueError()
            image.verify()
        return (
            raw,
            {
                "JPEG": ("jpg", "image/jpeg"),
                "PNG": ("png", "image/png"),
                "WEBP": ("webp", "image/webp"),
            }[kind],
        )
    except Exception:
        raise AccountError(
            "Use valid JPG, PNG or WebP photos under 5 MB and 40 megapixels."
        ) from None


def cleanup(paths, token):
    if paths:
        try:
            remote(f"/storage/v1/object/{BUCKET}", "DELETE", {"prefixes": paths}, token)
        except AccountError:
            # A private orphan is preferable to losing a committed journal entry.
            return False
    return True


def handle(env, send):
    path, method = env.get("PATH_INFO", ""), env.get("REQUEST_METHOD", "GET")
    headers = [("Cache-Control", "private, no-store")]

    def reply(data, status=200):
        return send(f"{status} {HTTPStatus(status).phrase}", data, extra=headers)

    try:
        if env.get("HTTP_SEC_FETCH_SITE") == "cross-site":
            raise AccountError("Open this request from your journal.", 403)
        if method not in ("GET", "HEAD"):
            if (
                env.get("HTTP_X_FEILOU_REQUEST") != "1"
                or env.get("HTTP_ORIGIN") != ORIGIN
            ):
                raise AccountError("Refresh your journal and try again.", 403)
        if path == "/api/auth/session" and method == "GET":
            if not configured():
                return reply({"configured": False, "user": None})
            try:
                user, _ = identity(env)
            except AccountError as error:
                if error.status != 401:
                    raise
                user = None
            return reply({"configured": True, "user": user})
        if not configured():
            raise AccountError(
                "Accounts are not connected yet. Please finish the server setup.", 503
            )
        if path in ("/api/auth/login", "/api/auth/signup") and method == "POST":
            with _rate_lock:
                now = time.time()
                for ip in list(_attempts):
                    if now - _attempts[ip][0] > 600:
                        del _attempts[ip]
                ip = env.get("REMOTE_ADDR", "local")
                started, count = _attempts.get(ip, (now, 0))
                if count >= 15 or len(_attempts) > 10000:
                    raise AccountError(
                        "Too many attempts. Try again in ten minutes.", 429
                    )
                _attempts[ip] = (started, count + 1)
            data = read_json(env)
            signup = path.endswith("signup")
            email = login_identifier(
                data.get("username", data.get("email", "")), signup
            )
            password = data.get("password", "")
            if not isinstance(password, str) or not 8 <= len(password) <= 128:
                raise AccountError("Use a password of 8–128 characters.")
            if signup:
                settings = remote("/auth/v1/settings")
                if settings.get("mailer_autoconfirm") is not True:
                    raise AccountError(
                        "Username signup needs email confirmation turned off in Supabase. Ask the project owner to finish this setting.",
                        503,
                    )
            try:
                endpoint = (
                    "/auth/v1/signup"
                    if signup
                    else "/auth/v1/token?grant_type=password"
                )
                result = remote(
                    endpoint, "POST", {"email": email, "password": password}
                )
            except AccountError as error:
                if error.status in (401, 502):
                    message = (
                        "Could not create this account. Try another username and a stronger password."
                        if signup
                        else "Username or password is incorrect."
                    )
                    raise AccountError(message, 400) from None
                raise
            if not result.get("access_token"):
                raise AccountError(
                    "Account setup did not complete. Check the Supabase confirmation setting.",
                    503,
                )
            value = secrets.token_urlsafe(32)
            seconds = min(int(result.get("expires_in", 3600)), 3600)
            with session_db() as connection:
                connection.execute(
                    "DELETE FROM sessions WHERE id=?", (session_id(env),)
                )
                connection.execute(
                    "INSERT INTO sessions VALUES (?,?,?)",
                    (
                        hashlib.sha256(value.encode()).hexdigest(),
                        result["access_token"],
                        time.time() + seconds,
                    ),
                )
            headers.append(cookie(value, seconds))
            return reply({"user": public_user(result["user"])})
        if path == "/api/auth/logout" and method == "POST":
            with session_db() as connection:
                connection.execute(
                    "DELETE FROM sessions WHERE id=?", (session_id(env),)
                )
            headers.append(cookie("", 0))
            return reply({"ok": True})
        user, token = identity(env)
        uid = user["id"]
        if path == "/api/profile":
            if method == "GET":
                rows = remote(f"/rest/v1/profiles?user_id=eq.{uid}", token=token)
                return reply({"profile": rows[0] if rows else None})
            if method == "PUT":
                record = validate_profile(read_json(env))
                record["user_id"] = uid
                rows = remote(
                    "/rest/v1/profiles?on_conflict=user_id", "POST", record, token
                )
                return reply({"profile": rows[0]})
        if path == "/api/flights":
            if method == "GET":
                rows = remote(
                    f"/rest/v1/flights?user_id=eq.{uid}&order=date.desc&limit=1000",
                    token=token,
                )
                return reply({"flights": rows})
            if method == "POST":
                record = validate_flight(read_json(env))
                record["user_id"] = uid
                rows = remote("/rest/v1/flights", "POST", record, token)
                return reply({"flight": rows[0]})
        if path.startswith("/api/flights/") and method in ("PUT", "DELETE"):
            try:
                flight_id = str(uuid.UUID(path.split("/")[-1]))
            except ValueError:
                raise AccountError("Flight not found.", 404) from None
            endpoint = f"/rest/v1/flights?id=eq.{flight_id}&user_id=eq.{uid}"
            if method == "DELETE":
                rows = remote(endpoint, "DELETE", token=token)
                if not rows:
                    raise AccountError("Flight not found.", 404)
                return reply({"ok": True})
            record = validate_flight(read_json(env))
            rows = remote(endpoint, "PATCH", record, token)
            if not rows:
                raise AccountError("Flight not found.", 404)
            return reply({"flight": rows[0]})
        if path.startswith("/api/photos/") and method in ("GET", "HEAD"):
            photo = path.removeprefix("/api/photos/")
            pieces = photo.split("/")
            if len(pieces) != 2 or pieces[0] != uid:
                raise AccountError("Photo not found.", 404)
            filename = pieces[1].split(".")
            if len(filename) != 2 or filename[1] not in ("jpg", "png", "webp"):
                raise AccountError("Photo not found.", 404)
            try:
                uuid.UUID(filename[0].split("_", 1)[-1])
                if "_" in filename[0] and not re.fullmatch(
                    r"[0-9]{13}_[0-9a-f-]{36}", filename[0]
                ):
                    raise ValueError("Invalid timestamped photo path")
            except ValueError:
                raise AccountError("Photo not found.", 404) from None
            body = remote(
                f"/storage/v1/object/authenticated/{BUCKET}/{photo}",
                token=token,
                binary=True,
            )
            return send(
                "200 OK",
                body,
                "image/" + ("jpeg" if filename[1] == "jpg" else filename[1]),
                extra=headers,
            )
        if path == "/api/entries" and method == "GET":
            rows = remote(
                f"/rest/v1/entries?user_id=eq.{uid}&order=date.desc&limit=1000",
                token=token,
            )
            return reply({"entries": rows})
        entry_id = None
        old = None
        if path.startswith("/api/entries/"):
            try:
                entry_id = str(uuid.UUID(path.split("/")[-1]))
            except ValueError:
                raise AccountError("Memory not found.", 404) from None
            rows = remote(
                f"/rest/v1/entries?id=eq.{entry_id}&user_id=eq.{uid}", token=token
            )
            if not rows:
                raise AccountError("Memory not found.", 404)
            old = rows[0]
        if old and method == "DELETE":
            remote(
                f"/rest/v1/entries?id=eq.{entry_id}&user_id=eq.{uid}",
                "DELETE",
                token=token,
            )
            cleaned = cleanup(old["photos"], token)
            return reply({"ok": True, "cleanupPending": not cleaned})
        if (path == "/api/entries" and method == "POST") or (old and method == "PUT"):
            data = read_json(env)
            record = validate_entry(data)
            # Validate every photo before performing writes.
            prepared = []
            for photo in data["photos"]:
                if isinstance(photo, str):
                    if (
                        not old
                        or photo not in old["photos"]
                        or not photo.startswith(uid + "/")
                    ):
                        raise AccountError("Invalid photo reference.", 403)
                    prepared.append(photo)
                else:
                    prepared.append(image_bytes(photo))
            uploaded, paths = [], []
            try:
                for photo in prepared:
                    if isinstance(photo, str):
                        paths.append(photo)
                    else:
                        raw, (ext, mime) = photo
                        name = f"{uid}/{int(time.time() * 1000)}_{uuid.uuid4()}.{ext}"
                        # Record before upload so a timed-out successful upload is also cleaned up.
                        uploaded.append(name)
                        remote(
                            f"/storage/v1/object/{BUCKET}/{name}",
                            "POST",
                            raw,
                            token,
                            mime=mime,
                        )
                        paths.append(name)
            except AccountError:
                cleanup(uploaded, token)
                raise
            try:
                record.update(user_id=uid, photos=paths)
                if old:
                    result = remote(
                        f"/rest/v1/entries?id=eq.{entry_id}&user_id=eq.{uid}",
                        "PATCH",
                        record,
                        token,
                    )
                else:
                    result = remote("/rest/v1/entries", "POST", record, token)
                if not result:
                    raise AccountError("Memory changed. Refresh and try again.", 409)
            except AccountError:
                # A database timeout has an ambiguous outcome; keep uploaded files
                # in that case rather than break a potentially committed entry.
                # Private orphan cleanup is documented in SETUP.md.
                raise
            cleaned = cleanup(
                [p for p in (old or {}).get("photos", []) if p not in paths], token
            )
            return reply({"entry": result[0], "cleanupPending": not cleaned})
        raise AccountError("Endpoint or method not found.", 404)
    except AccountError as error:
        return reply({"error": str(error)}, error.status)
    except (OSError, sqlite3.Error, KeyError, TypeError, ValueError):
        return reply(
            {"error": "Account storage is unavailable. Please try again."}, 503
        )
