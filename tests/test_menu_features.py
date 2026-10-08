"""New menu API boundaries; provider responses are simulated, not live RLS."""

import copy
import unittest
import uuid
import test_accounts as base


class MenuTests(unittest.TestCase):
    call = base.AccountTests.call
    tearDown = base.AccountTests.tearDown

    def setUp(self):
        self.flight_rows = {}
        self.profile_rows = {}
        base.AccountTests.setUp(self)

    def remote(
        self, path, method="GET", data=None, token=None, binary=False, mime=None
    ):
        if path.startswith("/rest/v1/profiles"):
            if method == "POST":
                self.assertEqual(data["user_id"], token)
                self.profile_rows[token] = dict(data)
                return [dict(data)]
            self.assertIn("user_id=eq." + token, path)
            return (
                [dict(self.profile_rows[token])] if token in self.profile_rows else []
            )
        if path.startswith("/rest/v1/flights"):
            if method == "POST":
                self.assertEqual(data["user_id"], token)
                row = dict(data, id=str(uuid.uuid4()))
                self.flight_rows[row["id"]] = row
                return [dict(row)]
            self.assertIn("user_id=eq." + token, path)
            rows = [r for r in self.flight_rows.values() if r["user_id"] == token]
            if "?id=eq." in path:
                fid = path.split("?id=eq.")[1].split("&")[0]
                rows = [r for r in rows if r["id"] == fid]
            if method == "PATCH":
                for row in rows:
                    row.update(data)
            if method == "DELETE":
                for row in rows:
                    del self.flight_rows[row["id"]]
            return copy.deepcopy(rows)
        return base.AccountTests.remote(self, path, method, data, token, binary, mime)

    def flight(self):
        return dict(
            flight_number="JL1",
            airline="Example Air",
            date="2026-10-07",
            seat="12A",
            origin="San Francisco",
            destination="Tokyo",
            origin_lat=37.6,
            origin_lng=-122.4,
            destination_lat=35.5,
            destination_lng=139.7,
        )

    def test_flight_crud_is_owner_scoped(self):
        a, b = base.A, base.B
        data = dict(self.flight(), user_id=b)
        result = self.call("/api/flights", "POST", data, a)
        self.assertEqual(result["status"], 200)
        fid = result["json"]["flight"]["id"]
        self.assertEqual(result["json"]["flight"]["user_id"], a)
        self.assertEqual(self.call("/api/flights", user=b)["json"]["flights"], [])
        self.assertEqual(len(self.call("/api/flights", user=a)["json"]["flights"]), 1)
        for method in ("PUT", "DELETE"):
            self.assertEqual(
                self.call("/api/flights/" + fid, method, data, b)["status"], 404
            )
        data["seat"] = "14B"
        result = self.call("/api/flights/" + fid, "PUT", data, a)
        self.assertEqual(result["json"]["flight"]["seat"], "14B")
        self.assertEqual(result["json"]["flight"]["user_id"], a)
        self.assertEqual(
            self.call("/api/flights/" + fid, "DELETE", {}, a)["status"], 200
        )
        self.assertEqual(self.call("/api/flights", user=a)["json"]["flights"], [])

    def test_profiles_persist_only_for_the_owner(self):
        a, b = base.A, base.B
        self.assertIsNone(self.call("/api/profile", user=a)["json"]["profile"])
        data = dict(
            name="Traveler",
            birthday="2000-02-29",
            hometown="Paris",
            home_country="France",
            bio="Travel notes",
            user_id=b,
        )
        result = self.call("/api/profile", "PUT", data, a)
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["json"]["profile"]["user_id"], a)
        self.assertIsNone(self.call("/api/profile", user=b)["json"]["profile"])
        self.assertEqual(
            self.call("/api/profile", user=a)["json"]["profile"]["name"], "Traveler"
        )
        data["name"] = "Updated"
        data["birthday"] = ""
        self.call("/api/profile", "PUT", data, a)
        profile = self.call("/api/profile", user=a)["json"]["profile"]
        self.assertEqual(profile["name"], "Updated")
        self.assertIsNone(profile["birthday"])

    def test_animal_avatar_is_validated_and_owner_scoped(self):
        for animal in ("mouse", "cow", "tiger", "bunny", "dragon", "snake", "horse", "sheep", "monkey", "chicken", "dog", "pig"):
            result = self.call("/api/profile", "PUT", {"avatar": animal}, base.A)
            self.assertEqual(result["status"], 200)
            self.assertEqual(self.call("/api/profile", user=base.A)["json"]["profile"]["avatar"], animal)
            self.assertIsNone(self.call("/api/profile", user=base.B)["json"]["profile"])
        self.assertEqual(self.call("/api/profile", "PUT", {"avatar": "unicorn"}, base.A)["status"], 400)

    def test_validation_and_anonymous_access(self):
        for path in ("/api/flights", "/api/profile"):
            self.assertEqual(self.call(path)["status"], 401)
        for changes in (
            {"origin_lat": 91},
            {"destination_lng": float("nan")},
            {"flight_number": ""},
            {"date": "wrong"},
            {"destination_lat": 37.6, "destination_lng": -122.4},
        ):
            self.assertEqual(
                self.call(
                    "/api/flights", "POST", dict(self.flight(), **changes), base.A
                )["status"],
                400,
            )
        for changes in (
            {"birthday": "2999-01-01"},
            {"birthday": "2025-02-29"},
            {"bio": "x" * 1001},
        ):
            self.assertEqual(
                self.call("/api/profile", "PUT", changes, base.A)["status"], 400
            )
