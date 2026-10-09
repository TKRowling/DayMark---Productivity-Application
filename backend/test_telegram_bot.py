import os
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo

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
        command_payload = next(payload for method, payload in self.outbound if method == "setMyCommands")
        command_names = {item["command"] for item in command_payload["commands"]}
        self.assertIn("missions", command_names)
        self.assertIn("missiondone", command_names)

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
        activity_date = date.fromisoformat(payload["tasks"][0]["date"])
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
        today_message = self.outbound[-1][1]
        self.assertIn("TODAY'S ACTIVITIES", today_message["text"])
        self.assertIn("Evening training", today_message["text"])
        self.assertNotIn("Drink enough water", today_message["text"])

        missions = self.telegram_update(14, "/missions")
        missions_message = self.outbound[-1][1]
        self.assertEqual(missions.status_code, 200)
        self.assertIn("FIXED DAILY MISSIONS", missions_message["text"])
        self.assertIn("Drink enough water", missions_message["text"])
        self.assertNotIn("Evening training", missions_message["text"])

        activities_to_complete = self.telegram_update(15, "/done")
        activity_callbacks = [
            button["callback_data"]
            for row in self.outbound[-1][1]["reply_markup"]["inline_keyboard"]
            for button in row
        ]
        self.assertEqual(activities_to_complete.status_code, 200)
        self.assertTrue(activity_callbacks)
        self.assertTrue(all(value.startswith("done:t:") for value in activity_callbacks))

        missions_to_complete = self.telegram_update(16, "/missiondone")
        mission_callbacks = [
            button["callback_data"]
            for row in self.outbound[-1][1]["reply_markup"]["inline_keyboard"]
            for button in row
        ]
        self.assertEqual(missions_to_complete.status_code, 200)
        self.assertTrue(mission_callbacks)
        self.assertTrue(all(value.startswith("done:m:") for value in mission_callbacks))

        duplicate_today = self.telegram_update(13, "/today")
        self.assertEqual(first_today.json()["status"], "processed")
        self.assertEqual(duplicate_today.json()["status"], "duplicate")

        unauthorized_cron = self.client.get(
            "/api/telegram/cron",
            headers={"Authorization": "Bearer wrong"},
        )
        self.assertEqual(unauthorized_cron.status_code, 401)

        reminder_time = datetime(
            activity_date.year,
            activity_date.month,
            activity_date.day,
            20,
            2,
            tzinfo=ZoneInfo("Asia/Bangkok"),
        )
        with patch("telegram_bot._now_for", return_value=reminder_time):
            first_reminder = self.client.get(
                "/api/telegram/cron",
                headers={"Authorization": "Bearer test-cron-secret"},
            )
            reminder_message = self.outbound[-1][1]["text"]
            duplicate_reminder = self.client.get(
                "/api/telegram/cron",
                headers={"Authorization": "Bearer test-cron-secret"},
            )
        self.assertEqual(first_reminder.status_code, 200)
        self.assertEqual(first_reminder.json()["task_reminders"], 1)
        self.assertIn("ACTIVITY STARTING NOW", reminder_message)
        self.assertIn("20:00–21:00", reminder_message)
        self.assertEqual(duplicate_reminder.json()["task_reminders"], 0)

        completed_activity = self.telegram_update(17, callback=activity_callbacks[0])
        completed_mission = self.telegram_update(18, callback=mission_callbacks[0])
        self.assertEqual(completed_activity.status_code, 200)
        self.assertEqual(completed_mission.status_code, 200)

        morning_time = reminder_time.replace(hour=7, minute=2)
        with patch("telegram_bot._now_for", return_value=morning_time):
            first_morning = self.client.get(
                "/api/telegram/cron",
                headers={"Authorization": "Bearer test-cron-secret"},
            )
            duplicate_morning = self.client.get(
                "/api/telegram/cron",
                headers={"Authorization": "Bearer test-cron-secret"},
            )
        self.assertEqual(first_morning.json()["daily_summaries"], 1)
        self.assertEqual(duplicate_morning.json()["daily_summaries"], 0)

        report_time = reminder_time.replace(hour=23, minute=59)
        with patch("telegram_bot._now_for", return_value=report_time):
            first_report = self.client.get(
                "/api/telegram/cron",
                headers={"Authorization": "Bearer test-cron-secret"},
            )
            report_message = self.outbound[-1][1]["text"]
            duplicate_report = self.client.get(
                "/api/telegram/cron",
                headers={"Authorization": "Bearer test-cron-secret"},
            )
        self.assertEqual(first_report.json()["end_of_day_reports"], 1)
        self.assertIn("END-OF-DAY REPORT", report_message)
        self.assertIn("TOTAL POINTS: 100 / 100", report_message)
        self.assertIn("Evening training", report_message)
        self.assertIn("Drink enough water", report_message)
        self.assertEqual(duplicate_report.json()["end_of_day_reports"], 0)


if __name__ == "__main__":
    unittest.main()
