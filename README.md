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
