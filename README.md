# Daymark Productivity Dashboard

A full-stack productivity dashboard built with React/Vite and FastAPI. Tasks, scholarship applications, weight progress, gym sessions, and meals are stored in PostgreSQL. The browser also keeps a local copy so the interface remains usable if the API is temporarily unavailable.

## Project structure

```text
├── src/                  React frontend
├── backend/              FastAPI + SQLAlchemy backend
├── vite.config.js        Frontend development proxy
└── vercel.json           Vercel multi-service routing
```

The API exposes:

- `GET /api/health`
- `GET /api/dashboard`
- `PUT /api/dashboard`
- `PUT /api/weights`
- `DELETE /api/weights/{entry_id}`
- `GET /api/telegram/status`
- `POST /api/telegram/setup`
- `GET /api/docs` for interactive OpenAPI documentation

Dashboard requests include a locally generated `X-Workspace-ID` header. This separates anonymous workspaces, but it is not a substitute for authentication if the app will hold sensitive or multi-user data.

## Run locally

Create and activate a Python virtual environment, then install both sets of dependencies:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
npm install
```

Start FastAPI and Vite together:

```bash
npm run dev
```

The command starts the frontend and backend together. The frontend runs at `http://localhost:5173` and proxies `/api` requests to FastAPI at `http://localhost:8000`. Local development uses `backend/daymark.db`, which is ignored by Git.

To run the services separately, use `npm run dev:web` and `npm run dev:api` in different terminals.

## Deploy to Vercel

1. Create a managed PostgreSQL database with Neon, Supabase, or another provider.
2. Add its pooled connection string as `DATABASE_URL` in the Vercel project settings.
3. Push this repository to GitHub, GitLab, or Bitbucket and import it into Vercel.
4. In **Build and Deployment**, select the **Services** framework preset.
5. Deploy. Vercel uses `vercel.json` to serve Vite at `/` and FastAPI at `/api`.

The production backend intentionally returns a configuration error when `DATABASE_URL` is missing instead of storing data on Vercel's temporary filesystem.

## Telegram bot

The FastAPI service includes a private Telegram integration for activities and daily missions. Today's activities are date-specific and shown on their own screen, while fixed missions repeat every day on a separate mission screen. An activity is created in one message such as `8:00 - 12:00: WORK`; category, date, and comma-separated subtasks can be appended with `|` separators. The bot also supports repeating mission creation with 1/3/5/10 XP, separate completion buttons, start-time activity reminders, separate morning briefing messages, and a 23:59 completion report scored out of 100. Conversation and notification state is stored in PostgreSQL so serverless restarts do not interrupt forms or resend the same alert.

Create these Vercel environment variables before activating the bot:

- `TELEGRAM_BOT_TOKEN`: token issued by `@BotFather`; store this as a secret.
- `TELEGRAM_WEBHOOK_SECRET`: random letters, numbers, `_`, or `-`; store this as a secret.
- `TELEGRAM_LINK_CODE`: a random owner-only code used once to link the private bot; store this as a secret.
- `CRON_SECRET`: random secret used by Vercel Cron and the setup endpoint.
- `TELEGRAM_BOT_USERNAME`: `tkr_daymark_bot`.
- `TELEGRAM_WEBHOOK_URL`: `https://daymark-productivity-mu.vercel.app/api/telegram/webhook`.
- `DAYMARK_WORKSPACE_ID`: `tkrowling-dashboard`.
- `DAYMARK_TIMEZONE`: `Asia/Bangkok`.

After redeploying, call `POST /api/telegram/setup` with `Authorization: Bearer <CRON_SECRET>`. This registers the webhook and the bot command menu without exposing the bot token. The owner then opens:

```text
https://t.me/tkr_daymark_bot?start=<TELEGRAM_LINK_CODE>
```

The first successfully linked private chat becomes the owner of the configured Daymark workspace. Later attempts to link another Telegram account are rejected. Telegram must be able to reach the webhook without an interactive Vercel login; keep the website protected only if the webhook is hosted on a separate public backend.

The Vercel Cron schedule remains as a daily morning fallback. Because Vercel Hobby only supports daily cron jobs, `.github/workflows/telegram-notifications.yml` securely invokes the same idempotent endpoint every five minutes using a short-lived GitHub OIDC identity token. It also requests a dedicated run at `16:59 UTC` (`23:59 Asia/Bangkok`) for the end-of-day report. GitHub may queue scheduled workflows, so an activity reminder can occasionally arrive a few minutes after its configured start time.
