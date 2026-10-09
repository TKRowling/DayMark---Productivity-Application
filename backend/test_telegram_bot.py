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
from models import TelegramAccount  # noqa: E402
from telegram_bot import _parse_quick_activity  # noqa: E402


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
        sample_account = TelegramAccount(
            chat_id=999,
            telegram_user_id=999,
            workspace_id="sample-workspace",
            timezone="Asia/Bangkok",
        )
        sample_now = datetime(2026, 10, 9, 10, 0, tzinfo=ZoneInfo("Asia/Bangkok"))
        with patch("telegram_bot._now_for", return_value=sample_now):
            parsed_sample, sample_error = _parse_quick_activity(
                "8:00 - 12:00: WORK",
                sample_account,
            )
        self.assertEqual(sample_error, "")
        self.assertEqual(parsed_sample["time"], "08:00")
        self.assertEqual(parsed_sample["end_time"], "12:00")
        self.assertEqual(parsed_sample["title"], "WORK")
        self.assertEqual(parsed_sample["date"], sample_now.date())
        self.assertNotIn("category", parsed_sample)

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
        self.assertIn("weight", command_names)
        self.assertIn("addweight", command_names)

        unauthorized = self.client.post(
            "/api/telegram/webhook",
            headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
            json={"update_id": 1},
        )
        self.assertEqual(unauthorized.status_code, 403)

        steps = [
            self.telegram_update(1, "/start owner-link-code"),
            self.telegram_update(2, "/addtask"),
            self.telegram_update(
                3,
                "20:00 - 21:00: Evening training | today | Warm up, Main workout, Stretch",
            ),
            self.telegram_update(4, "/addmission"),
            self.telegram_update(5, "Drink enough water"),
            self.telegram_update(6, callback="category:mission:Wellness"),
            self.telegram_update(7, callback="mission_xp:3"),
        ]
        self.assertTrue(all(response.status_code == 200 for response in steps))

        weight_steps = [
            self.telegram_update(40, "/addweight"),
            self.telegram_update(41, "84.4"),
            self.telegram_update(42, "/addweight"),
            self.telegram_update(43, "83.9 | today"),
            self.telegram_update(44, "/weight"),
        ]
        self.assertTrue(all(response.status_code == 200 for response in weight_steps))
        weight_message = self.outbound[-1][1]
        self.assertIn("WEIGHT TRACKING", weight_message["text"])
        self.assertIn("Current: <b>83.9 kg</b>", weight_message["text"])
        self.assertIn("Total change: <b>0.0 kg</b>", weight_message["text"])
        weight_delete_callback = next(
            button["callback_data"]
            for row in weight_message["reply_markup"]["inline_keyboard"]
            for button in row
            if button["callback_data"].startswith("weight:delete:")
        )
        activity_saved_message = next(
            payload["text"]
            for method, payload in self.outbound
            if method == "sendMessage" and "Activity saved to Daymark" in payload.get("text", "")
        )
        self.assertIn("Warm up", activity_saved_message)
        self.assertIn("Main workout", activity_saved_message)
        self.assertNotIn("Personal", activity_saved_message)

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
        self.assertEqual(len(payload["weights"]), 1)
        self.assertEqual(payload["weights"][0]["value"], 83.9)

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
        self.assertIn("Warm up", today_message["text"])
        self.assertNotIn("Personal", today_message["text"])
        self.assertNotIn("Drink enough water", today_message["text"])
        today_buttons = [
            button
            for row in today_message["reply_markup"]["inline_keyboard"]
            for button in row
        ]
        edit_callback = next(
            button["callback_data"]
            for button in today_buttons
            if button["callback_data"].startswith("task:edit:")
        )
        delete_callback = next(
            button["callback_data"]
            for button in today_buttons
            if button["callback_data"].startswith("task:delete:")
        )

        begin_edit = self.telegram_update(19, callback=edit_callback)
        self.assertEqual(begin_edit.status_code, 200)
        self.assertIn("Edit activity", self.outbound[-1][1]["text"])
        save_edit = self.telegram_update(
            20,
            "20:00-21:00 Evening training | Warm up, Main workout, Stretch, Cool down",
        )
        self.assertEqual(save_edit.status_code, 200)
        self.assertIn("Activity updated in Daymark", self.outbound[-1][1]["text"])
        self.assertIn("Cool down", self.outbound[-1][1]["text"])

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
        self.assertIn("Warm up", reminder_message)
        self.assertNotIn("Category:", reminder_message)
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

        begin_delete = self.telegram_update(21, callback=delete_callback)
        self.assertEqual(begin_delete.status_code, 200)
        self.assertIn("Delete this activity?", self.outbound[-1][1]["text"])
        confirm_delete_callback = next(
            button["callback_data"]
            for row in self.outbound[-1][1]["reply_markup"]["inline_keyboard"]
            for button in row
            if button["callback_data"].startswith("task:delete_confirm:")
        )
        confirm_delete = self.telegram_update(22, callback=confirm_delete_callback)
        self.assertEqual(confirm_delete.status_code, 200)
        self.assertNotIn("Evening training", self.outbound[-1][1]["text"])
        dashboard_after_delete = self.client.get(
            "/api/dashboard",
            headers={"X-Workspace-ID": "tkrowling-dashboard"},
        )
        self.assertEqual(dashboard_after_delete.json()["tasks"], [])

        begin_weight_delete = self.telegram_update(45, callback=weight_delete_callback)
        self.assertEqual(begin_weight_delete.status_code, 200)
        self.assertIn("Delete this weight check-in?", self.outbound[-1][1]["text"])
        confirm_weight_delete_callback = next(
            button["callback_data"]
            for row in self.outbound[-1][1]["reply_markup"]["inline_keyboard"]
            for button in row
            if button["callback_data"].startswith("weight:delete_confirm:")
        )
        confirm_weight_delete = self.telegram_update(46, callback=confirm_weight_delete_callback)
        self.assertEqual(confirm_weight_delete.status_code, 200)
        dashboard_after_weight_delete = self.client.get(
            "/api/dashboard",
            headers={"X-Workspace-ID": "tkrowling-dashboard"},
        )
        self.assertEqual(dashboard_after_weight_delete.json()["weights"], [])


if __name__ == "__main__":
    unittest.main()
