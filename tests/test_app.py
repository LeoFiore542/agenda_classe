import tempfile
import unittest
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from app import build_username_from_full_name, create_app, format_long_date, init_db


class AppTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.app = create_app({
            "TESTING": True,
            "DATABASE": str(database_path),
        })
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def login(self, full_name: str = "Abruzzese Elisa", password: Optional[str] = None):
        username = build_username_from_full_name(full_name)
        return self.client.post(
            "/login",
            data={
                "username": username,
                "password": password or username,
            },
            follow_redirects=False,
        )

    def login_and_change_password(self, full_name: str = "Abruzzese Elisa", new_password: str = "nuova-password-4g"):
        username = build_username_from_full_name(full_name)
        self.login(full_name=full_name)
        return self.client.post(
            "/account/password",
            data={
                "current_password": username,
                "new_password": new_password,
                "confirm_password": new_password,
            },
            follow_redirects=False,
        )

    def test_login_required_for_index_and_api(self):
        index_response = self.client.get("/")
        api_response = self.client.get("/api/events?month=2026-04")

        self.assertEqual(index_response.status_code, 302)
        self.assertIn("/login", index_response.headers["Location"])
        self.assertEqual(api_response.status_code, 401)

    def test_login_with_seeded_account(self):
        response = self.login()

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/account")

    def test_first_login_forces_personal_area_and_blocks_api(self):
        self.login()

        index_response = self.client.get("/", follow_redirects=False)
        account_response = self.client.get("/account", follow_redirects=False)
        api_response = self.client.get("/api/events?month=2026-04")

        self.assertEqual(index_response.status_code, 302)
        self.assertEqual(index_response.headers["Location"], "/account")
        self.assertEqual(account_response.status_code, 200)
        self.assertEqual(api_response.status_code, 403)

    def test_change_personal_password_after_first_login(self):
        username = build_username_from_full_name("Abruzzese Elisa")
        self.login()

        change_response = self.login_and_change_password(new_password="nuova-password-4g")

        self.assertEqual(change_response.status_code, 302)
        self.assertEqual(change_response.headers["Location"], "/")

        self.client.post("/logout", follow_redirects=False)

        old_login_response = self.login(password=username)
        new_login_response = self.login(password="nuova-password-4g")

        self.assertEqual(old_login_response.status_code, 200)
        self.assertEqual(new_login_response.status_code, 302)
        self.assertEqual(new_login_response.headers["Location"], "/")

    def test_account_shows_only_personal_interrogation_days(self):
        self.login_and_change_password()

        self.client.post(
            "/api/events",
            json={
                "subject": "Matematica",
                "scheduled_for": "2026-04-20",
                "notes": "Equazioni",
            },
        )
        self.client.post(
            "/api/events",
            json={
                "subject": "Assemblea",
                "scheduled_for": "2026-04-22",
                "event_type": "evento",
            },
        )
        self.client.post(
            "/api/events",
            json={
                "subject": "Storia",
                "event_type": "interrogazione",
                "interrogation_mode": "specific_days",
                "interrogation_dates": "2026-04-28\n2026-04-29",
                "interrogation_schedule": json.dumps(
                    {
                        "2026-04-28": ["Giulia Bianchi"],
                        "2026-04-29": ["Abruzzese Elisa"],
                    }
                ),
                "notes": "Capitolo 7",
            },
        )

        account_response = self.client.get("/account")
        page = account_response.get_data(as_text=True)

        self.assertEqual(account_response.status_code, 200)
        self.assertIn("Matematica", page)
        self.assertIn("Assemblea", page)
        self.assertIn("Storia", page)
        self.assertIn(format_long_date("2026-04-29"), page)
        self.assertNotIn(format_long_date("2026-04-28"), page)

    def test_account_does_not_show_past_personal_events(self):
        self.login_and_change_password()

        yesterday = date.today() - timedelta(days=1)
        tomorrow = date.today() + timedelta(days=1)

        self.client.post(
            "/api/events",
            json={
                "subject": "Matematica",
                "scheduled_for": yesterday.isoformat(),
                "notes": "Passata",
            },
        )
        self.client.post(
            "/api/events",
            json={
                "subject": "Fisica",
                "scheduled_for": tomorrow.isoformat(),
                "notes": "Futura",
            },
        )

        account_response = self.client.get("/account")
        page = account_response.get_data(as_text=True)

        self.assertEqual(account_response.status_code, 200)
        self.assertNotIn("Matematica", page)
        self.assertIn("Fisica", page)

    def test_create_and_list_event(self):
        self.login_and_change_password()
        response = self.client.post(
            "/api/events",
            json={
                "subject": "Matematica",
                "scheduled_for": "2026-04-20",
                "notes": "Equazioni di primo grado",
            },
        )
        self.assertEqual(response.status_code, 201)

        created = response.get_json()
        self.assertEqual(created["class_group"], "4G")
        self.assertEqual(created["event_type"], "verifica")
        self.assertEqual(created["notes"], "Equazioni di primo grado")

        list_response = self.client.get("/api/events?month=2026-04")
        data = list_response.get_json()

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["subject"], "Matematica")
        self.assertEqual(data[0]["status"], "programmata")
        self.assertEqual(data[0]["class_group"], "4G")

    def test_force_class_group_to_4g(self):
        self.login_and_change_password()
        response = self.client.post(
            "/api/events",
            json={
                "subject": "Storia",
                "scheduled_for": "2026-04-22",
                "class_group": "3B",
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["class_group"], "4G")

    def test_create_generic_event(self):
        self.login_and_change_password()
        response = self.client.post(
            "/api/events",
            json={
                "subject": "Assemblea",
                "scheduled_for": "2026-04-24",
                "event_type": "evento",
            },
        )

        self.assertEqual(response.status_code, 201)
        created = response.get_json()
        self.assertEqual(created["event_type"], "evento")
        self.assertEqual(created["subject"], "Assemblea")
        self.assertEqual(created["title"], "Evento: Assemblea")

    def test_reject_invalid_generic_event_subject(self):
        self.login_and_change_password()
        response = self.client.post(
            "/api/events",
            json={
                "subject": "Concerto",
                "scheduled_for": "2026-04-24",
                "event_type": "evento",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("subject", response.get_json()["errors"])

    def test_create_interrogation_with_period(self):
        self.login_and_change_password()
        response = self.client.post(
            "/api/events",
            json={
                "subject": "Storia",
                "event_type": "interrogazione",
                "scheduled_for": "2026-04-14",
                "interrogation_mode": "period",
                "interrogation_end": "2026-04-16",
                "notes": "Capitolo 5, pagine 120-134",
                "interrogation_schedule": json.dumps(
                    {
                        "2026-04-14": ["Mario Rossi"],
                        "2026-04-15": ["Giulia Bianchi"],
                        "2026-04-16": ["Luca Verdi"],
                    }
                ),
            },
        )

        self.assertEqual(response.status_code, 201)
        created = response.get_json()
        self.assertEqual(created["event_type"], "interrogazione")
        self.assertEqual(created["interrogation_mode"], "period")
        self.assertEqual(created["interrogation_end"], "2026-04-16")
        self.assertEqual(created["notes"], "Capitolo 5, pagine 120-134")
        self.assertEqual(
            json.loads(created["interrogation_schedule"]),
            {
                "2026-04-14": ["Mario Rossi"],
                "2026-04-15": ["Giulia Bianchi"],
                "2026-04-16": ["Luca Verdi"],
            },
        )

    def test_create_interrogation_with_specific_days(self):
        self.login_and_change_password()
        response = self.client.post(
            "/api/events",
            json={
                "subject": "Italiano",
                "event_type": "interrogazione",
                "interrogation_mode": "specific_days",
                "interrogation_dates": "2026-04-11\n2026-04-18\n2026-04-25",
                "interrogation_schedule": json.dumps(
                    {
                        "2026-04-11": ["Anna Neri"],
                        "2026-04-18": ["Paolo Blu"],
                        "2026-04-25": ["Sara Gialli"],
                    }
                ),
            },
        )

        self.assertEqual(response.status_code, 201)
        created = response.get_json()
        self.assertEqual(created["scheduled_for"], "2026-04-11")
        self.assertEqual(created["interrogation_end"], "2026-04-25")
        self.assertEqual(created["interrogation_dates"], "2026-04-11\n2026-04-18\n2026-04-25")

    def test_reject_invalid_date(self):
        self.login_and_change_password()
        response = self.client.post(
            "/api/events",
            json={
                "subject": "Storia",
                "scheduled_for": "non-valida",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_owner_account_reset_and_legacy_owner_removed(self):
        with self.app.app_context():
            init_db()
            database = self.app.view_functions["login"].__globals__["get_db"]()
            legacy_owner = database.execute(
                "SELECT id FROM users WHERE username = ?",
                ("leonardo.fiorini",),
            ).fetchone()
            owner = database.execute(
                "SELECT id, username, must_change_password FROM users WHERE username = ?",
                ("fiorini.leonardo",),
            ).fetchone()

        self.assertIsNone(legacy_owner)
        self.assertIsNotNone(owner)
        self.assertEqual(owner["username"], "fiorini.leonardo")
        self.assertEqual(owner["must_change_password"], 1)

        owner_login = self.client.post(
            "/login",
            data={
                "username": "fiorini.leonardo",
                "password": "fiorini.leonardo",
            },
            follow_redirects=False,
        )

        self.assertEqual(owner_login.status_code, 302)
        self.assertEqual(owner_login.headers["Location"], "/account")


if __name__ == "__main__":
    unittest.main()