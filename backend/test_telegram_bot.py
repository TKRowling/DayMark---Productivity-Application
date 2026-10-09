import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient


TEST_DATABASE = Path(tempfile.gettempdir()) / f"daymark-telegram-{uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE.as_posix()}"
os.environ["TELEGRAM_BOT_TOKEN"] = "test-token"
os.environ["TELEGRAM_WEBHOOK_SECRET"] = "test-webhook-secret"
os.environ["TELEGRAM_LINK_CODE"] = "owner-link-code"
os.environ["CRON_SECRET"] = "test-cron-secret"
os.environ["DAYMARK_WORKSPACE_ID"] = "tkrowling-dashboard"
os.environ["DAYMARK_TIMEZONE"] = "Asia/Bangkok"

import database  # noqa: E402
import main  # noqa: E402


class TelegramBotIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.outbound = []

        def fake_telegram_api(method, payload=None):
            cls.outbound.append((method, payload or {}))
            if method == "getMe":
                return {"id": 99, "username": "tkr_daymark_bot"}
            return True

        cls.patcher = patch("telegram_bot._telegram_api", side_effect=fake_telegram_api)
        cls.patcher.start()
        cls.client = TestClient(main.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.patcher.stop()
        if database.engine is not None:
            database.engine.dispose()
        TEST_DATABASE.unlink(missing_ok=True)

    def telegram_update(self, update_id, text=None, callback=None):
        if callback is not None:
            payload = {
                "update_id": update_id,
                "callback_query": {
                    "id": f"callback-{update_id}",
                    "from": {"id": 101, "first_name": "TK"},
                    "message": {"chat": {"id": 101, "type": "private"}},
                    "data": callback,
                },
            }
        else:
            payload = {
                "update_id": update_id,
                "message": {
                    "message_id": update_id,
                    "from": {"id": 101, "first_name": "TK", "username": "tkrowling"},
                    "chat": {"id": 101, "type": "private"},
                    "text": text,
                },
            }
        return self.client.post(
            "/api/telegram/webhook",
            headers={"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"},
            json=payload,
        )

    def test_private_activity_mission_and_notifications_flow(self):
        setup = self.client.post(
            "/api/telegram/setup",
            headers={"Authorization": "Bearer test-cron-secret"},
        )
        self.assertEqual(setup.status_code, 200)
        self.assertEqual(setup.json()["bot_username"], "tkr_daymark_bot")

        unauthorized = self.client.post(
            "/api/telegram/webhook",
            headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
            json={"update_id": 1},
        )
        self.assertEqual(unauthorized.status_code, 403)

        steps = [
            self.telegram_update(1, "/start owner-link-code"),
            self.telegram_update(2, "/addtask"),
            self.telegram_update(3, "Evening training"),
            self.telegram_update(4, callback="task_date:today"),
            self.telegram_update(5, "20:00"),
            self.telegram_update(6, "21:00"),
            self.telegram_update(7, callback="category:task:Fitness"),
            self.telegram_update(8, "Warm up, Main workout, Stretch"),
            self.telegram_update(9, "/addmission"),
            self.telegram_update(10, "Drink enough water"),
            self.telegram_update(11, callback="category:mission:Wellness"),
            self.telegram_update(12, callback="mission_xp:3"),
        ]
        self.assertTrue(all(response.status_code == 200 for response in steps))

        dashboard = self.client.get(
            "/api/dashboard",
            headers={"X-Workspace-ID": "tkrowling-dashboard"},
        )
        self.assertEqual(dashboard.status_code, 200)
        payload = dashboard.json()
        self.assertEqual(len(payload["tasks"]), 1)
        self.assertEqual(payload["tasks"][0]["time"], "20:00")
        self.assertEqual(payload["tasks"][0]["end_time"], "21:00")
        self.assertEqual(len(payload["tasks"][0]["subtasks"]), 3)
        self.assertEqual(len(payload["missions"]), 1)
        self.assertEqual(payload["missions"][0]["xp"], 3)

        status = self.client.get(
            "/api/telegram/status",
            headers={"X-Workspace-ID": "tkrowling-dashboard"},
        )
        self.assertEqual(status.status_code, 200)
        self.assertTrue(status.json()["configured"])
        self.assertTrue(status.json()["linked"])

        first_today = self.telegram_update(13, "/today")
        duplicate_today = self.telegram_update(13, "/today")
        self.assertEqual(first_today.json()["status"], "processed")
        self.assertEqual(duplicate_today.json()["status"], "duplicate")

        first_cron = self.client.get(
            "/api/telegram/cron",
            headers={"Authorization": "Bearer test-cron-secret"},
        )
        second_cron = self.client.get(
            "/api/telegram/cron",
            headers={"Authorization": "Bearer test-cron-secret"},
        )
        self.assertEqual(first_cron.status_code, 200)
        self.assertEqual(first_cron.json()["daily_summaries"], 1)
        self.assertEqual(second_cron.json()["daily_summaries"], 0)


if __name__ == "__main__":
    unittest.main()
