"""Private Telegram workflows for Daymark activities, missions, and weight tracking."""

from __future__ import annotations

import html
import hmac
import json
import os
import re
from datetime import date, datetime, time as clock_time, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from models import (
    Mission,
    MissionCompletion,
    Task,
    TaskSubtask,
    TelegramAccount,
    TelegramNotification,
    WeightEntry,
)
from schemas import MISSION_XP_VALUES


DEFAULT_WORKSPACE_ID = "tkrowling-dashboard"
DEFAULT_TIMEZONE = "Asia/Bangkok"
CATEGORIES = ("Personal", "Study", "Scholarship", "Fitness", "Wellness")
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
QUICK_ACTIVITY_PATTERN = re.compile(
    r"^\s*(\d{1,2}):(\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}):(\d{2})\s*:?\s*(.+?)\s*$",
    re.IGNORECASE,
)
TASK_REMINDER_LOOKBACK_MINUTES = 10
WEIGHT_GOAL_KG = 75.0

BOT_COMMANDS = [
    {"command": "today", "description": "Show today's activities"},
    {"command": "missions", "description": "Show fixed daily missions"},
    {"command": "addtask", "description": "Add an activity"},
    {"command": "addmission", "description": "Add a repeating daily mission"},
    {"command": "done", "description": "Complete today's activity"},
    {"command": "missiondone", "description": "Complete today's mission"},
    {"command": "weight", "description": "Show weight progress"},
    {"command": "addweight", "description": "Log or update a weight check-in"},
    {"command": "settings", "description": "Manage Telegram reminders"},
    {"command": "cancel", "description": "Cancel the current form"},
    {"command": "help", "description": "Show available commands"},
]


class TelegramError(RuntimeError):
    pass


def _workspace_id() -> str:
    return os.getenv("DAYMARK_WORKSPACE_ID", DEFAULT_WORKSPACE_ID)


def _escape(value: object) -> str:
    return html.escape(str(value), quote=False)


def _telegram_api(method: str, payload: dict | None = None) -> object:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise TelegramError("TELEGRAM_BOT_TOKEN is not configured")

    request = Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload or {}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise TelegramError(f"Telegram {method} failed with HTTP {error.code}: {detail[:300]}") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise TelegramError(f"Telegram {method} request failed") from error

    if not result.get("ok"):
        raise TelegramError(f"Telegram {method} rejected the request: {result.get('description', 'unknown error')}")
    return result.get("result")


def send_message(chat_id: int, text: str, reply_markup: dict | None = None) -> object:
    payload: dict[str, object] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return _telegram_api("sendMessage", payload)


def _answer_callback(callback_id: str, text: str = "") -> None:
    payload: dict[str, object] = {"callback_query_id": callback_id}
    if text:
        payload["text"] = text
    _telegram_api("answerCallbackQuery", payload)


def configure_webhook(webhook_url: str) -> dict[str, object]:
    if not webhook_url.startswith("https://"):
        raise TelegramError("The Telegram webhook URL must use HTTPS")
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise TelegramError("TELEGRAM_WEBHOOK_SECRET is not configured")

    webhook = _telegram_api(
        "setWebhook",
        {
            "url": webhook_url,
            "secret_token": secret,
            "allowed_updates": ["message", "callback_query"],
            "drop_pending_updates": False,
        },
    )
    commands = _telegram_api("setMyCommands", {"commands": BOT_COMMANDS})
    menu = _telegram_api("setChatMenuButton", {"menu_button": {"type": "commands"}})
    return {"webhook": bool(webhook), "commands": bool(commands), "menu": bool(menu)}


def bot_identity() -> dict[str, object]:
    result = _telegram_api("getMe")
    if not isinstance(result, dict):
        raise TelegramError("Telegram returned an invalid bot identity")
    return result


def _inline_keyboard(rows: list[list[tuple[str, str]]]) -> dict:
    return {
        "inline_keyboard": [
            [{"text": label, "callback_data": callback_data} for label, callback_data in row]
            for row in rows
        ]
    }


def _home_keyboard() -> dict:
    return _inline_keyboard(
        [
            [("📅 Today's activities", "menu:today"), ("⚔️ Daily missions", "menu:missions")],
            [("➕ Add activity", "menu:addtask"), ("➕ Add mission", "menu:addmission")],
            [("✅ Complete activity", "menu:done"), ("✅ Complete mission", "menu:missiondone")],
            [("⚖️ Weight tracking", "menu:weight")],
            [("⚙️ Reminder settings", "menu:settings")],
        ]
    )


def _category_keyboard(flow: str) -> dict:
    return _inline_keyboard(
        [[(category, f"category:{flow}:{category}")] for category in CATEGORIES]
    )


def _state_data(account: TelegramAccount) -> dict:
    try:
        value = json.loads(account.state_data or "{}")
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _set_state(account: TelegramAccount, state: str, data: dict | None = None) -> None:
    account.state = state
    account.state_data = json.dumps(data or {}, separators=(",", ":"))


def _clear_state(account: TelegramAccount) -> None:
    _set_state(account, "", {})


def _zone(timezone_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TIMEZONE)


def _now_for(account: TelegramAccount) -> datetime:
    return datetime.now(timezone.utc).astimezone(_zone(account.timezone))


def _today_for(account: TelegramAccount) -> date:
    return _now_for(account).date()


def _friendly_date(value: date) -> str:
    return value.strftime("%a, %d %b %Y")


def _account_for_chat(db: Session, chat_id: int) -> TelegramAccount | None:
    return db.get(TelegramAccount, chat_id)


def _link_matches(chat_id: int, supplied_code: str) -> bool:
    allowed_chat = os.getenv("TELEGRAM_ALLOWED_CHAT_ID", "").strip()
    if allowed_chat and hmac.compare_digest(allowed_chat, str(chat_id)):
        return True
    link_code = os.getenv("TELEGRAM_LINK_CODE", "").strip()
    return bool(link_code and supplied_code and hmac.compare_digest(link_code, supplied_code))


def _link_account(db: Session, message: dict, supplied_code: str) -> TelegramAccount | None:
    chat = message.get("chat") or {}
    user = message.get("from") or {}
    chat_id = int(chat.get("id", 0))
    user_id = int(user.get("id", 0))
    if not chat_id or not user_id or chat.get("type") != "private":
        return None
    if not _link_matches(chat_id, supplied_code):
        return None

    workspace = _workspace_id()
    existing_owner = db.scalar(
        select(TelegramAccount).where(TelegramAccount.workspace_id == workspace).limit(1)
    )
    if existing_owner and existing_owner.chat_id != chat_id:
        return None

    account = TelegramAccount(
        chat_id=chat_id,
        telegram_user_id=user_id,
        workspace_id=workspace,
        username=user.get("username", "") or "",
        display_name=" ".join(
            part for part in (user.get("first_name", ""), user.get("last_name", "")) if part
        ),
        timezone=os.getenv("DAYMARK_TIMEZONE", DEFAULT_TIMEZONE),
        notifications_enabled=True,
    )
    db.add(account)
    return account


def _welcome(account: TelegramAccount) -> None:
    name = _escape(account.display_name or account.username or "Hunter")
    send_message(
        account.chat_id,
        (
            f"<b>DAYMARK SYSTEM ONLINE</b>\n\nWelcome, <b>{name}</b>. "
            "This private bot is linked to your Daymark workspace. Add activities, manage daily missions, "
            "track your weight, complete objectives, and receive reminders from here."
        ),
        _home_keyboard(),
    )


def _help(account: TelegramAccount) -> None:
    send_message(
        account.chat_id,
        (
            "<b>Daymark commands</b>\n\n"
            "/today — show only today's dated activities\n"
            "/missions — show fixed missions that repeat every day\n"
            "/addtask — add an activity in one message\n"
            "/addmission — add a repeating daily mission\n"
            "/done — complete one of today's activities\n"
            "/missiondone — complete a fixed mission for today\n"
            "/weight — show your weight progress and recent check-ins\n"
            "/addweight — log or update one weight check-in\n"
            "/settings — manage reminders\n"
            "/cancel — cancel the current form"
        ),
        _home_keyboard(),
    )


def _today_tasks(db: Session, account: TelegramAccount) -> tuple[date, list[Task]]:
    today = _today_for(account)
    tasks = list(
        db.scalars(
            select(Task)
            .options(selectinload(Task.subtasks))
            .where(Task.workspace_id == account.workspace_id, Task.date == today)
            .order_by(Task.time, Task.title)
        ).all()
    )
    return today, tasks


def _daily_missions(db: Session, account: TelegramAccount) -> tuple[date, list[Mission]]:
    today = _today_for(account)
    missions = list(
        db.scalars(
            select(Mission)
            .options(selectinload(Mission.completions))
            .where(Mission.workspace_id == account.workspace_id, Mission.date <= today)
            .order_by(Mission.title)
        ).all()
    )
    return today, missions


def _activities_text(db: Session, account: TelegramAccount) -> str:
    today, tasks = _today_tasks(db, account)
    lines = [f"<b>TODAY'S ACTIVITIES — {_escape(_friendly_date(today))}</b>", ""]
    if tasks:
        for task in tasks[:12]:
            marker = "✅" if task.completed else "▫️"
            timing = f"{task.time}–{task.end_time}" if task.end_time else task.time
            lines.append(f"{marker} <code>{_escape(timing)}</code> {_escape(task.title[:80])}")
            for subtask in task.subtasks[:5]:
                subtask_marker = "✅" if subtask.done else "↳"
                lines.append(f"   {subtask_marker} {_escape(subtask.title[:100])}")
        if len(tasks) > 12:
            lines.append(f"…and {len(tasks) - 12} more activities on the website.")
    else:
        lines.append("No activities scheduled for today.")
    return "\n".join(lines)


def _missions_text(db: Session, account: TelegramAccount) -> str:
    today, missions = _daily_missions(db, account)
    lines = [f"<b>FIXED DAILY MISSIONS — {_escape(_friendly_date(today))}</b>", ""]
    if missions:
        for mission in missions[:12]:
            completed = any(item.completed_on == today for item in mission.completions)
            marker = "✅" if completed else "▫️"
            lines.append(f"{marker} {_escape(mission.title[:80])} · +{mission.xp} XP")
        if len(missions) > 12:
            lines.append(f"…and {len(missions) - 12} more missions on the website.")
    else:
        lines.append("No fixed daily missions yet.")
    return "\n".join(lines)


def _show_today(db: Session, account: TelegramAccount) -> None:
    _, tasks = _today_tasks(db, account)
    rows = [
        [
            (f"✏️ {task.title[:28]}", f"task:edit:{task.id}"),
            ("🗑️ Delete", f"task:delete:{task.id}"),
        ]
        for task in tasks[:20]
    ]
    rows.extend(
        [[("✅ Complete activity", "menu:done")], [("➕ Add activity", "menu:addtask")]]
    )
    send_message(
        account.chat_id,
        _activities_text(db, account),
        _inline_keyboard(rows),
    )


def _show_missions(db: Session, account: TelegramAccount) -> None:
    send_message(
        account.chat_id,
        _missions_text(db, account),
        _inline_keyboard(
            [[("✅ Complete mission", "menu:missiondone")], [("➕ Add mission", "menu:addmission")]]
        ),
    )


def _weight_entries(db: Session, account: TelegramAccount) -> list[WeightEntry]:
    return list(
        db.scalars(
            select(WeightEntry)
            .where(WeightEntry.workspace_id == account.workspace_id)
            .order_by(WeightEntry.date)
        ).all()
    )


def _weight_text(db: Session, account: TelegramAccount) -> str:
    entries = _weight_entries(db, account)
    if not entries:
        return (
            "<b>WEIGHT TRACKING</b>\n\n"
            "No check-ins yet. Log your first weight to begin tracking your trend."
        )

    first = entries[0]
    current = entries[-1]
    change = current.value - first.value
    change_text = f"{change:+.1f} kg" if change else "0.0 kg"
    remaining = max(0.0, current.value - WEIGHT_GOAL_KG)
    lines = [
        "<b>WEIGHT TRACKING</b>",
        "",
        f"Current: <b>{current.value:.1f} kg</b>",
        f"Started: {first.value:.1f} kg · {_escape(_friendly_date(first.date))}",
        f"Total change: <b>{change_text}</b>",
        f"To {WEIGHT_GOAL_KG:.0f} kg goal: <b>{remaining:.1f} kg</b>",
        "",
        "<b>Recent check-ins</b>",
    ]
    for entry in reversed(entries[-10:]):
        lines.append(f"• {_escape(_friendly_date(entry.date))} · <b>{entry.value:.1f} kg</b>")
    return "\n".join(lines)


def _show_weight(db: Session, account: TelegramAccount) -> None:
    entries = _weight_entries(db, account)
    rows = [
        [(f"🗑️ {entry.date.strftime('%d %b')} · {entry.value:.1f} kg", f"weight:delete:{entry.id}")]
        for entry in reversed(entries[-5:])
    ]
    rows.append([("➕ Log / update weight", "menu:addweight")])
    send_message(account.chat_id, _weight_text(db, account), _inline_keyboard(rows))


def _show_completable(db: Session, account: TelegramAccount, kind: str) -> None:
    rows: list[list[tuple[str, str]]] = []
    if kind == "task":
        _, tasks = _today_tasks(db, account)
        for task in tasks:
            if not task.completed:
                rows.append([(task.title[:45], f"done:t:{task.id}")])
        empty_message = "<b>Today's activities are clear.</b> Every scheduled activity is complete. 🎉"
        prompt = "<b>Which activity did you complete?</b>"
    else:
        today, missions = _daily_missions(db, account)
        for mission in missions:
            if not any(item.completed_on == today for item in mission.completions):
                rows.append([(mission.title[:45], f"done:m:{mission.id}")])
        empty_message = "<b>Today's missions are clear.</b> Every fixed mission is complete. 🎉"
        prompt = "<b>Which daily mission did you complete?</b>"

    if not rows:
        send_message(account.chat_id, empty_message, _home_keyboard())
        return
    send_message(account.chat_id, prompt, _inline_keyboard(rows[:40]))


def _show_settings(account: TelegramAccount) -> None:
    notification_label = "Disable notifications" if account.notifications_enabled else "Enable notifications"
    send_message(
        account.chat_id,
        (
            "<b>REMINDER SETTINGS</b>\n\n"
            f"Notifications: <b>{'On' if account.notifications_enabled else 'Off'}</b>\n"
            "Daily briefing: <b>around 07:00</b>\n"
            f"Timezone: <b>{_escape(account.timezone)}</b>"
        ),
        _inline_keyboard(
            [
                [(notification_label, "settings:toggle")],
            ]
        ),
    )


def _begin_task(account: TelegramAccount) -> None:
    _set_state(account, "task_quick")
    send_message(
        account.chat_id,
        (
            "<b>Add activity — one step</b>\n\n"
            "Send the time and title in one message:\n"
            "<code>8:00 - 12:00: WORK</code>\n\n"
            "Optional format:\n"
            "<code>20:30-22:30 AI Agent | Data Quality Agent &amp; Fix the Auto Tuning</code>\n\n"
            "Use commas for more subtasks. Add <code>| tomorrow</code> or "
            "<code>| YYYY-MM-DD</code> when needed. The default date is today.\n\n"
            "Send /cancel to stop."
        ),
    )


def _begin_mission(account: TelegramAccount) -> None:
    _set_state(account, "mission_title")
    send_message(account.chat_id, "<b>Add daily mission — 1/3</b>\nWhat is the repeating mission?\n\nSend the title, or /cancel.")


def _begin_weight(account: TelegramAccount) -> None:
    _set_state(account, "weight_quick")
    send_message(
        account.chat_id,
        (
            "<b>Log weight — one step</b>\n\n"
            "Send your weight in kilograms:\n"
            "<code>84.2</code>\n\n"
            "For another date:\n"
            "<code>84.2 | yesterday</code> or <code>84.2 | 2026-10-08</code>\n\n"
            "Logging the same date again updates that check-in. Send /cancel to stop."
        ),
    )


def _run_action(db: Session, account: TelegramAccount, action: str) -> None:
    if action == "today":
        _clear_state(account)
        _show_today(db, account)
    elif action == "missions":
        _clear_state(account)
        _show_missions(db, account)
    elif action == "done":
        _clear_state(account)
        _show_completable(db, account, "task")
    elif action == "missiondone":
        _clear_state(account)
        _show_completable(db, account, "mission")
    elif action == "weight":
        _clear_state(account)
        _show_weight(db, account)
    elif action == "addweight":
        _begin_weight(account)
    elif action == "addtask":
        _begin_task(account)
    elif action == "addmission":
        _begin_mission(account)
    elif action == "settings":
        _clear_state(account)
        _show_settings(account)
    elif action == "help":
        _clear_state(account)
        _help(account)
    else:
        _help(account)


def _valid_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def _parse_quick_activity(value: str, account: TelegramAccount) -> tuple[dict[str, object] | None, str]:
    parts = [part.strip() for part in value.split("|")]
    match = QUICK_ACTIVITY_PATTERN.fullmatch(parts[0]) if parts else None
    if match is None:
        return None, "Use this format: <code>8:00 - 12:00: WORK</code>"

    start_hour, start_minute, end_hour, end_minute = (int(item) for item in match.groups()[:4])
    if start_hour > 23 or end_hour > 23 or start_minute > 59 or end_minute > 59:
        return None, "Use valid 24-hour times, for example <code>08:00-12:00</code>."
    start_time = f"{start_hour:02d}:{start_minute:02d}"
    end_time = f"{end_hour:02d}:{end_minute:02d}"
    if end_time <= start_time:
        return None, "The ending time must be later than the start time on the same day."

    title = match.group(5).strip()
    if not title or len(title) > 240:
        return None, "The activity title must be between 1 and 240 characters."

    task_date = _today_for(account)
    subtasks: list[str] = []
    for optional_value in parts[1:]:
        if not optional_value:
            continue
        lowered = optional_value.lower()
        if lowered == "today":
            task_date = _today_for(account)
        elif lowered == "tomorrow":
            task_date = _today_for(account) + timedelta(days=1)
        elif parsed_date := _valid_date(optional_value):
            task_date = parsed_date
        else:
            subtasks.extend(item.strip() for item in optional_value.split(",") if item.strip())

    if len(subtasks) > 20 or any(len(item) > 240 for item in subtasks):
        return None, "Use at most 20 comma-separated subtasks, each under 240 characters."
    return {
        "title": title,
        "date": task_date,
        "time": start_time,
        "end_time": end_time,
        "subtasks": subtasks,
    }, ""


def _save_quick_activity(
    db: Session,
    account: TelegramAccount,
    value: str,
    task: Task | None = None,
) -> None:
    parsed, error = _parse_quick_activity(value, account)
    if parsed is None:
        send_message(account.chat_id, f"{error}\n\nTry again, or send /cancel.")
        return

    subtasks = parsed["subtasks"]
    is_edit = task is not None
    if task is None:
        task = Task(
            id=str(uuid4()),
            workspace_id=account.workspace_id,
            title=str(parsed["title"]),
            date=parsed["date"],
            time=str(parsed["time"]),
            end_time=str(parsed["end_time"]),
            # The website schema still requires a value; Telegram no longer exposes activity categories.
            category="Personal",
            completed=False,
        )
        db.add(task)
    else:
        task.title = str(parsed["title"])
        task.date = parsed["date"]
        task.time = str(parsed["time"])
        task.end_time = str(parsed["end_time"])
    task.subtasks = [
        TaskSubtask(
            id=str(uuid4()),
            workspace_id=account.workspace_id,
            title=title,
            done=False,
            position=index,
        )
        for index, title in enumerate(subtasks)
    ]
    _clear_state(account)
    send_message(
        account.chat_id,
        (
            f"✅ <b>Activity {'updated in' if is_edit else 'saved to'} Daymark</b>\n"
            f"{_escape(task.title)}\n"
            f"{_escape(_friendly_date(task.date))} · {task.time}–{task.end_time}\n"
            + (
                "\n<b>Subtasks</b>\n" + "\n".join(f"↳ {_escape(title)}" for title in subtasks)
                if subtasks
                else "\nNo subtasks"
            )
        ),
        _home_keyboard(),
    )


def _parse_weight_check_in(value: str, account: TelegramAccount) -> tuple[float | None, date | None, str]:
    parts = [part.strip() for part in value.split("|")]
    if not parts or len(parts) > 2:
        return None, None, "Use <code>84.2</code> or <code>84.2 | YYYY-MM-DD</code>."

    number_text = parts[0].lower().removesuffix("kg").strip().replace(",", ".")
    try:
        weight = round(float(number_text), 1)
    except ValueError:
        return None, None, "Send a numeric weight, for example <code>84.2</code>."
    if not 20 <= weight <= 400:
        return None, None, "Weight must be between 20 and 400 kg."

    check_in_date = _today_for(account)
    if len(parts) == 2 and parts[1]:
        date_text = parts[1].lower()
        if date_text == "today":
            check_in_date = _today_for(account)
        elif date_text == "yesterday":
            check_in_date = _today_for(account) - timedelta(days=1)
        elif parsed_date := _valid_date(parts[1]):
            check_in_date = parsed_date
        else:
            return None, None, "Use <code>today</code>, <code>yesterday</code>, or <code>YYYY-MM-DD</code>."
    return weight, check_in_date, ""


def _save_weight_check_in(db: Session, account: TelegramAccount, value: str) -> None:
    weight, check_in_date, error = _parse_weight_check_in(value, account)
    if weight is None or check_in_date is None:
        send_message(account.chat_id, f"{error}\n\nTry again, or send /cancel.")
        return

    entry = db.scalar(
        select(WeightEntry).where(
            WeightEntry.workspace_id == account.workspace_id,
            WeightEntry.date == check_in_date,
        )
    )
    is_update = entry is not None
    if entry is None:
        entry = WeightEntry(
            id=str(uuid4()),
            workspace_id=account.workspace_id,
            date=check_in_date,
            value=weight,
        )
        db.add(entry)
    else:
        entry.value = weight

    _clear_state(account)
    send_message(
        account.chat_id,
        (
            f"✅ <b>Weight {'updated' if is_update else 'saved'}</b>\n"
            f"{weight:.1f} kg · {_escape(_friendly_date(check_in_date))}"
        ),
        _inline_keyboard(
            [[("⚖️ View weight progress", "menu:weight"), ("➕ Another check-in", "menu:addweight")]]
        ),
    )


def _handle_state_text(db: Session, account: TelegramAccount, text_value: str) -> None:
    value = text_value.strip()
    data = _state_data(account)

    if account.state == "task_quick":
        _save_quick_activity(db, account, value)
        return

    if account.state == "task_edit":
        task_id = str(data.get("task_id", ""))
        task = db.scalar(
            select(Task)
            .options(selectinload(Task.subtasks))
            .where(Task.id == task_id, Task.workspace_id == account.workspace_id)
        )
        if task is None:
            _clear_state(account)
            send_message(account.chat_id, "That activity no longer exists.", _home_keyboard())
            return
        _save_quick_activity(db, account, value, task)
        return

    if account.state == "weight_quick":
        _save_weight_check_in(db, account, value)
        return

    if account.state == "task_title":
        if not value or len(value) > 240:
            send_message(account.chat_id, "Please send a title between 1 and 240 characters.")
            return
        data["title"] = value
        _set_state(account, "task_date", data)
        send_message(
            account.chat_id,
            "<b>Add activity — 2/6</b>\nChoose a date or send it as <code>YYYY-MM-DD</code>.",
            _inline_keyboard([[("Today", "task_date:today"), ("Tomorrow", "task_date:tomorrow")]]),
        )
        return

    if account.state == "task_date":
        task_date = _valid_date(value)
        if task_date is None:
            send_message(account.chat_id, "Use <code>YYYY-MM-DD</code>, for example <code>2026-10-10</code>.")
            return
        data["date"] = task_date.isoformat()
        _set_state(account, "task_start", data)
        send_message(account.chat_id, "<b>Add activity — 3/6</b>\nSend the start time in 24-hour format, for example <code>20:00</code>.")
        return

    if account.state == "task_start":
        if not TIME_PATTERN.fullmatch(value):
            send_message(account.chat_id, "Use a valid 24-hour time such as <code>08:30</code> or <code>20:00</code>.")
            return
        data["time"] = value
        _set_state(account, "task_end", data)
        send_message(account.chat_id, "<b>Add activity — 4/6</b>\nSend the ending time in 24-hour format, for example <code>21:00</code>.")
        return

    if account.state == "task_end":
        if not TIME_PATTERN.fullmatch(value):
            send_message(account.chat_id, "Use a valid 24-hour time such as <code>09:30</code> or <code>21:00</code>.")
            return
        if value <= data.get("time", ""):
            send_message(account.chat_id, "The ending time must be later than the start time on the same day.")
            return
        data["end_time"] = value
        _set_state(account, "task_category", data)
        send_message(account.chat_id, "<b>Add activity — 5/6</b>\nChoose a category.", _category_keyboard("task"))
        return

    if account.state == "task_subtasks":
        subtasks = [] if value.lower() in {"skip", "none", "no"} else [item.strip() for item in value.split(",") if item.strip()]
        if len(subtasks) > 20 or any(len(item) > 240 for item in subtasks):
            send_message(account.chat_id, "Use at most 20 comma-separated subtasks, each under 240 characters.")
            return
        task = Task(
            id=str(uuid4()),
            workspace_id=account.workspace_id,
            title=data["title"],
            date=date.fromisoformat(data["date"]),
            time=data["time"],
            end_time=data["end_time"],
            category=data["category"],
            completed=False,
        )
        task.subtasks = [
            TaskSubtask(
                id=str(uuid4()),
                workspace_id=account.workspace_id,
                title=title,
                done=False,
                position=index,
            )
            for index, title in enumerate(subtasks)
        ]
        db.add(task)
        _clear_state(account)
        send_message(
            account.chat_id,
            (
                "✅ <b>Activity saved to Daymark</b>\n"
                f"{_escape(task.title)}\n"
                f"{_escape(_friendly_date(task.date))} · {task.time}–{task.end_time} · {_escape(task.category)}\n"
                f"Subtasks: {len(subtasks)}"
            ),
            _home_keyboard(),
        )
        return

    if account.state == "mission_title":
        if not value or len(value) > 240:
            send_message(account.chat_id, "Please send a title between 1 and 240 characters.")
            return
        data["title"] = value
        _set_state(account, "mission_category", data)
        send_message(account.chat_id, "<b>Add daily mission — 2/3</b>\nChoose a category.", _category_keyboard("mission"))
        return

    send_message(account.chat_id, "I did not understand that input. Use /help to see the available actions.", _home_keyboard())


def _handle_callback(db: Session, callback: dict) -> None:
    callback_id = str(callback.get("id", ""))
    message = callback.get("message") or {}
    chat_id = int((message.get("chat") or {}).get("id", 0))
    data_value = str(callback.get("data", ""))
    account = _account_for_chat(db, chat_id)
    if account is None:
        _answer_callback(callback_id, "Link the private bot first")
        if chat_id:
            send_message(chat_id, "This Daymark bot is private. Open the secure owner link to connect it.")
        return

    if data_value.startswith("menu:"):
        _answer_callback(callback_id)
        _run_action(db, account, data_value.split(":", 1)[1])
        return

    if data_value.startswith("task:"):
        parts = data_value.split(":", 2)
        if len(parts) != 3:
            _answer_callback(callback_id, "Invalid activity action")
            return
        action, task_id = parts[1], parts[2]
        task = db.scalar(
            select(Task)
            .options(selectinload(Task.subtasks))
            .where(Task.id == task_id, Task.workspace_id == account.workspace_id)
        )
        if task is None:
            _answer_callback(callback_id, "Activity not found")
            return

        if action == "edit":
            _set_state(account, "task_edit", {"task_id": task.id})
            current_value = f"{task.time}-{task.end_time} {task.title}"
            if task.subtasks:
                current_value += " | " + ", ".join(item.title for item in task.subtasks)
            _answer_callback(callback_id, "Edit activity")
            send_message(
                account.chat_id,
                (
                    "✏️ <b>Edit activity — one step</b>\n\n"
                    "Send the complete replacement in the same format:\n"
                    f"<code>{_escape(current_value)}</code>\n\n"
                    "Changing the time also updates its future reminder. Send /cancel to keep it unchanged."
                ),
            )
            return

        if action == "delete":
            _answer_callback(callback_id)
            send_message(
                account.chat_id,
                (
                    "🗑️ <b>Delete this activity?</b>\n\n"
                    f"<b>{_escape(task.title)}</b>\n"
                    f"<code>{task.time}–{task.end_time}</code>\n\n"
                    "This also removes its subtasks."
                ),
                _inline_keyboard(
                    [[
                        ("Delete permanently", f"task:delete_confirm:{task.id}"),
                        ("Keep activity", f"task:delete_cancel:{task.id}"),
                    ]]
                ),
            )
            return

        if action == "delete_confirm":
            db.delete(task)
            db.flush()
            _clear_state(account)
            _answer_callback(callback_id, "Activity deleted")
            _show_today(db, account)
            return

        if action == "delete_cancel":
            _answer_callback(callback_id, "Activity kept")
            return

        _answer_callback(callback_id, "Unknown activity action")
        return

    if data_value.startswith("weight:"):
        parts = data_value.split(":", 2)
        if len(parts) != 3:
            _answer_callback(callback_id, "Invalid weight action")
            return
        action, entry_id = parts[1], parts[2]
        entry = db.scalar(
            select(WeightEntry).where(
                WeightEntry.id == entry_id,
                WeightEntry.workspace_id == account.workspace_id,
            )
        )
        if entry is None:
            _answer_callback(callback_id, "Check-in not found")
            return

        if action == "delete":
            _answer_callback(callback_id)
            send_message(
                account.chat_id,
                (
                    "🗑️ <b>Delete this weight check-in?</b>\n\n"
                    f"{entry.value:.1f} kg · {_escape(_friendly_date(entry.date))}"
                ),
                _inline_keyboard(
                    [[
                        ("Delete permanently", f"weight:delete_confirm:{entry.id}"),
                        ("Keep check-in", f"weight:delete_cancel:{entry.id}"),
                    ]]
                ),
            )
            return

        if action == "delete_confirm":
            db.delete(entry)
            db.flush()
            _answer_callback(callback_id, "Weight check-in deleted")
            _show_weight(db, account)
            return

        if action == "delete_cancel":
            _answer_callback(callback_id, "Check-in kept")
            return

        _answer_callback(callback_id, "Unknown weight action")
        return

    if data_value.startswith("task_date:"):
        if account.state != "task_date":
            _answer_callback(callback_id, "This form has expired")
            return
        choice = data_value.split(":", 1)[1]
        chosen = _today_for(account) + (timedelta(days=1) if choice == "tomorrow" else timedelta())
        state = _state_data(account)
        state["date"] = chosen.isoformat()
        _set_state(account, "task_start", state)
        _answer_callback(callback_id, _friendly_date(chosen))
        send_message(account.chat_id, "<b>Add activity — 3/6</b>\nSend the start time in 24-hour format, for example <code>20:00</code>.")
        return

    if data_value.startswith("category:"):
        parts = data_value.split(":", 2)
        if len(parts) != 3 or parts[2] not in CATEGORIES:
            _answer_callback(callback_id, "Invalid category")
            return
        flow, category = parts[1], parts[2]
        state = _state_data(account)
        state["category"] = category
        if flow == "task" and account.state == "task_category":
            _set_state(account, "task_subtasks", state)
            _answer_callback(callback_id, category)
            send_message(
                account.chat_id,
                "<b>Add activity — 6/6</b>\nSend comma-separated subtasks, or send <code>skip</code>.\n\nExample: <code>Read chapter 1, Write notes, Review exercises</code>",
            )
        elif flow == "mission" and account.state == "mission_category":
            _set_state(account, "mission_xp", state)
            _answer_callback(callback_id, category)
            xp_buttons = [(f"+{xp} XP", f"mission_xp:{xp}") for xp in MISSION_XP_VALUES]
            send_message(account.chat_id, "<b>Add daily mission — 3/3</b>\nChoose the XP reward.", _inline_keyboard([xp_buttons]))
        else:
            _answer_callback(callback_id, "This form has expired")
        return

    if data_value.startswith("mission_xp:"):
        if account.state != "mission_xp":
            _answer_callback(callback_id, "This form has expired")
            return
        try:
            xp = int(data_value.split(":", 1)[1])
        except ValueError:
            xp = 0
        if xp not in MISSION_XP_VALUES:
            _answer_callback(callback_id, "Invalid XP reward")
            return
        state = _state_data(account)
        mission = Mission(
            id=str(uuid4()),
            workspace_id=account.workspace_id,
            title=state["title"],
            date=_today_for(account),
            time="",
            category=state["category"],
            xp=xp,
            completed=False,
        )
        db.add(mission)
        _clear_state(account)
        _answer_callback(callback_id, "Mission saved")
        send_message(
            account.chat_id,
            f"⚔️ <b>Daily mission saved</b>\n{_escape(mission.title)} · {_escape(mission.category)} · +{xp} XP\n\nIt will repeat every day.",
            _home_keyboard(),
        )
        return

    if data_value.startswith("done:"):
        parts = data_value.split(":", 2)
        if len(parts) != 3:
            _answer_callback(callback_id, "Invalid item")
            return
        kind, item_id = parts[1], parts[2]
        if kind == "t":
            task = db.scalar(select(Task).where(Task.id == item_id, Task.workspace_id == account.workspace_id))
            if task is None:
                _answer_callback(callback_id, "Activity not found")
                return
            task.completed = True
            label = task.title
            reward = "Activity completed"
        elif kind == "m":
            mission = db.scalar(select(Mission).where(Mission.id == item_id, Mission.workspace_id == account.workspace_id))
            if mission is None:
                _answer_callback(callback_id, "Mission not found")
                return
            today = _today_for(account)
            completion = db.scalar(
                select(MissionCompletion).where(
                    MissionCompletion.mission_id == mission.id,
                    MissionCompletion.completed_on == today,
                )
            )
            if completion is None:
                db.add(
                    MissionCompletion(
                        id=str(uuid4()),
                        mission_id=mission.id,
                        workspace_id=account.workspace_id,
                        completed_on=today,
                    )
                )
            mission.completed = True
            label = mission.title
            reward = f"+{mission.xp} XP earned"
        else:
            _answer_callback(callback_id, "Invalid item")
            return
        _answer_callback(callback_id, reward)
        send_message(account.chat_id, f"✅ <b>{_escape(label)}</b>\n{reward}.", _home_keyboard())
        return

    if data_value == "settings:toggle":
        account.notifications_enabled = not account.notifications_enabled
        _answer_callback(callback_id, "Notifications updated")
        _show_settings(account)
        return

    _answer_callback(callback_id, "Unknown action")


def handle_update(db: Session, update: dict) -> None:
    callback = update.get("callback_query")
    if isinstance(callback, dict):
        _handle_callback(db, callback)
        return

    message = update.get("message")
    if not isinstance(message, dict):
        return
    chat = message.get("chat") or {}
    chat_id = int(chat.get("id", 0))
    if not chat_id or chat.get("type") != "private":
        return
    text_value = message.get("text")
    if not isinstance(text_value, str):
        send_message(chat_id, "Daymark currently accepts text and button input. Use /help to continue.")
        return

    command = ""
    argument = ""
    if text_value.startswith("/"):
        first, _, rest = text_value.partition(" ")
        command = first.split("@", 1)[0].lower()
        argument = rest.strip()

    account = _account_for_chat(db, chat_id)
    if account is None:
        supplied_code = argument if command in {"/start", "/link"} else ""
        account = _link_account(db, message, supplied_code)
        if account is None:
            send_message(chat_id, "<b>This is a private Daymark bot.</b>\nUse the secure owner link generated during setup to connect your account.")
            return
        _welcome(account)
        return

    if command:
        if command == "/start":
            _clear_state(account)
            _welcome(account)
        elif command == "/cancel":
            _clear_state(account)
            send_message(account.chat_id, "Current form cancelled.", _home_keyboard())
        else:
            _run_action(db, account, command.removeprefix("/"))
        return


    if account.state:
        _handle_state_text(db, account, text_value)
    else:
        send_message(account.chat_id, "Choose an action below, or send /help.", _home_keyboard())


def _notification_exists(db: Session, dedupe_key: str) -> bool:
    return db.get(TelegramNotification, dedupe_key) is not None


def _record_notification(db: Session, account: TelegramAccount, dedupe_key: str) -> None:
    db.add(
        TelegramNotification(
            dedupe_key=dedupe_key,
            chat_id=account.chat_id,
            workspace_id=account.workspace_id,
        )
    )


def _send_daily_summary(db: Session, account: TelegramAccount) -> bool:
    now = _now_for(account)
    if now.hour != 7:
        return False
    today = now.date()
    dedupe_key = f"daily:{account.chat_id}:{today.isoformat()}"
    if _notification_exists(db, dedupe_key):
        return False
    send_message(
        account.chat_id,
        f"☀️ <b>ACTIVITY BRIEFING</b>\n\n{_activities_text(db, account)}",
        _inline_keyboard([[("✅ Complete activity", "menu:done"), ("➕ Add activity", "menu:addtask")]]),
    )
    send_message(
        account.chat_id,
        f"⚔️ <b>DAILY MISSIONS</b>\n\n{_missions_text(db, account)}",
        _inline_keyboard([[("✅ Complete mission", "menu:missiondone"), ("➕ Add mission", "menu:addmission")]]),
    )
    _record_notification(db, account, dedupe_key)
    return True


def _task_start(task: Task, account: TelegramAccount) -> datetime | None:
    if not TIME_PATTERN.fullmatch(task.time):
        return None
    hour, minute = (int(part) for part in task.time.split(":", 1))
    return datetime.combine(task.date, clock_time(hour=hour, minute=minute), _zone(account.timezone))


def _send_task_reminders(db: Session, account: TelegramAccount) -> int:
    now = _now_for(account).replace(second=0, microsecond=0)
    window_start = now - timedelta(minutes=TASK_REMINDER_LOOKBACK_MINUTES)
    tasks = list(
        db.scalars(
            select(Task)
            .options(selectinload(Task.subtasks))
            .where(
                Task.workspace_id == account.workspace_id,
                Task.date == now.date(),
                Task.completed.is_(False),
            )
            .order_by(Task.time, Task.title)
        ).all()
    )

    sent = 0
    for task in tasks:
        starts_at = _task_start(task, account)
        if starts_at is None or not window_start <= starts_at <= now:
            continue
        dedupe_key = (
            f"task-start:{account.chat_id}:{task.id}:{task.date.isoformat()}:{task.time}"
        )
        if _notification_exists(db, dedupe_key):
            continue

        timing = f"{task.time}–{task.end_time}" if task.end_time else task.time
        lines = [
            "⏰ <b>ACTIVITY STARTING NOW</b>",
            "",
            f"<code>{_escape(timing)}</code>  <b>{_escape(task.title)}</b>",
        ]
        if task.subtasks:
            lines.extend(["", "<b>What to do</b>"])
            lines.extend(
                f"{'✅' if subtask.done else '▫️'} {_escape(subtask.title)}"
                for subtask in task.subtasks[:10]
            )
        send_message(
            account.chat_id,
            "\n".join(lines),
            _inline_keyboard([[('✅ Complete activity', f"done:t:{task.id}")]]),
        )
        _record_notification(db, account, dedupe_key)
        sent += 1
    return sent


def _end_of_day_target(now: datetime) -> date | None:
    if now.hour == 23 and now.minute >= 58:
        return now.date()
    if now.hour == 0 and now.minute <= 10:
        return now.date() - timedelta(days=1)
    return None


def _send_end_of_day_report(db: Session, account: TelegramAccount) -> bool:
    report_date = _end_of_day_target(_now_for(account))
    if report_date is None:
        return False

    dedupe_key = f"end-of-day:{account.chat_id}:{report_date.isoformat()}"
    if _notification_exists(db, dedupe_key):
        return False

    tasks = list(
        db.scalars(
            select(Task)
            .where(Task.workspace_id == account.workspace_id, Task.date == report_date)
            .order_by(Task.time, Task.title)
        ).all()
    )
    missions = list(
        db.scalars(
            select(Mission)
            .options(selectinload(Mission.completions))
            .where(Mission.workspace_id == account.workspace_id, Mission.date <= report_date)
            .order_by(Mission.title)
        ).all()
    )
    completed_tasks = [task for task in tasks if task.completed]
    completed_missions = [
        mission
        for mission in missions
        if any(item.completed_on == report_date for item in mission.completions)
    ]
    completed_count = len(completed_tasks) + len(completed_missions)
    total_count = len(tasks) + len(missions)
    score = round((completed_count / total_count) * 100) if total_count else 0

    lines = [
        f"🌙 <b>END-OF-DAY REPORT — {_escape(_friendly_date(report_date))}</b>",
        "",
        f"<b>TOTAL POINTS: {score} / 100</b>",
        f"Completed {completed_count} of {total_count} objectives",
        "",
        f"<b>Activities completed ({len(completed_tasks)}/{len(tasks)})</b>",
    ]
    if completed_tasks:
        lines.extend(f"✅ {_escape(task.title)}" for task in completed_tasks)
    else:
        lines.append("No activities completed today.")

    lines.extend(["", f"<b>Missions completed ({len(completed_missions)}/{len(missions)})</b>"])
    if completed_missions:
        lines.extend(
            f"✅ {_escape(mission.title)} · +{mission.xp} XP"
            for mission in completed_missions
        )
    else:
        lines.append("No missions completed today.")

    send_message(account.chat_id, "\n".join(lines), _home_keyboard())
    _record_notification(db, account, dedupe_key)
    return True


def run_notifications(db: Session) -> dict[str, int]:
    accounts = list(
        db.scalars(
            select(TelegramAccount).where(TelegramAccount.notifications_enabled.is_(True))
        ).all()
    )
    summaries = 0
    task_reminders = 0
    end_of_day_reports = 0
    for account in accounts:
        summaries += int(_send_daily_summary(db, account))
        task_reminders += _send_task_reminders(db, account)
        end_of_day_reports += int(_send_end_of_day_report(db, account))
    return {
        "accounts": len(accounts),
        "daily_summaries": summaries,
        "task_reminders": task_reminders,
        "end_of_day_reports": end_of_day_reports,
    }
