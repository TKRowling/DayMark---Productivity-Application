import os
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from database import Base, engine, get_db
from models import Meal, Mission, Requirement, Scholarship, Task, WeightEntry, Workout
from schemas import DashboardResponse, DashboardSchema


WORKSPACE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if engine is not None:
        Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Daymark API",
    description="Persistence API for missions, tasks, scholarships, weight tracking, workouts, and meals.",
    version="1.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "PUT", "OPTIONS"],
    allow_headers=["Content-Type", "X-Workspace-ID"],
)


def workspace_id(x_workspace_id: str = Header(..., alias="X-Workspace-ID")) -> str:
    if not WORKSPACE_PATTERN.fullmatch(x_workspace_id):
        raise HTTPException(status_code=400, detail="Invalid workspace identifier")
    return x_workspace_id


def new_id() -> str:
    return str(uuid4())


def seed_dashboard() -> DashboardSchema:
    today = date.today()
    return DashboardSchema.model_validate(
        {
            "tasks": [
                {"id": new_id(), "title": "30-minute morning walk", "time": "7:30 AM", "category": "Wellness", "date": today, "completed": True},
                {"id": new_id(), "title": "Review scholarship essay", "time": "10:00 AM", "category": "Scholarship", "date": today, "completed": False},
                {"id": new_id(), "title": "Complete reading assignment", "time": "2:00 PM", "category": "Study", "date": today, "completed": False},
                {"id": new_id(), "title": "Upper body workout", "time": "6:30 PM", "category": "Fitness", "date": today, "completed": False},
                {"id": new_id(), "title": "Plan tomorrow’s priorities", "time": "9:00 PM", "category": "Personal", "date": today, "completed": False},
            ],
            "missions": [],
            "scholarship": {
                "name": "Global Future Leaders Scholarship",
                "provider": "Bright Horizons Foundation",
                "amount": "$10,000",
                "deadline": today + timedelta(days=19),
                "notes": "For students demonstrating academic excellence, leadership, and a commitment to community impact.",
                "requirements": [
                    {"id": new_id(), "title": "Personal statement", "done": True},
                    {"id": new_id(), "title": "Academic transcript", "done": True},
                    {"id": new_id(), "title": "Two recommendation letters", "done": False},
                    {"id": new_id(), "title": "Financial information form", "done": False},
                    {"id": new_id(), "title": "Final application review", "done": False},
                ],
            },
            "weights": [
                {"id": new_id(), "date": today - timedelta(days=35), "value": 82.4},
                {"id": new_id(), "date": today - timedelta(days=28), "value": 81.8},
                {"id": new_id(), "date": today - timedelta(days=21), "value": 81.2},
                {"id": new_id(), "date": today - timedelta(days=14), "value": 80.8},
                {"id": new_id(), "date": today - timedelta(days=7), "value": 80.1},
                {"id": new_id(), "date": today, "value": 79.6},
            ],
            "workouts": [
                {"id": new_id(), "day": "MON", "title": "Upper body", "detail": "Chest, shoulders & triceps", "time": "6:30 PM", "done": True},
                {"id": new_id(), "day": "WED", "title": "Lower body", "detail": "Glutes, quads & hamstrings", "time": "6:30 PM", "done": False},
                {"id": new_id(), "day": "FRI", "title": "Full body", "detail": "Compound movements", "time": "5:30 PM", "done": False},
                {"id": new_id(), "day": "SUN", "title": "Active recovery", "detail": "Yoga & light stretching", "time": "9:00 AM", "done": False},
            ],
            "meals": [
                {"id": new_id(), "type": "Breakfast", "title": "Greek yogurt bowl", "detail": "Berries, oats & honey", "calories": 410},
                {"id": new_id(), "type": "Lunch", "title": "Chicken grain bowl", "detail": "Brown rice, greens & avocado", "calories": 620},
                {"id": new_id(), "type": "Dinner", "title": "Salmon & vegetables", "detail": "Roasted potatoes & broccoli", "calories": 680},
                {"id": new_id(), "type": "Snack", "title": "Apple & almond butter", "detail": "Simple afternoon fuel", "calories": 210},
            ],
        }
    )


def replace_dashboard(db: Session, workspace: str, payload: DashboardSchema) -> None:
    db.execute(delete(Requirement).where(Requirement.workspace_id == workspace))
    db.execute(delete(Scholarship).where(Scholarship.workspace_id == workspace))
    db.execute(delete(Task).where(Task.workspace_id == workspace))
    db.execute(delete(Mission).where(Mission.workspace_id == workspace))
    db.execute(delete(WeightEntry).where(WeightEntry.workspace_id == workspace))
    db.execute(delete(Workout).where(Workout.workspace_id == workspace))
    db.execute(delete(Meal).where(Meal.workspace_id == workspace))

    scholarship = Scholarship(
        workspace_id=workspace,
        name=payload.scholarship.name,
        provider=payload.scholarship.provider,
        amount=payload.scholarship.amount,
        deadline=payload.scholarship.deadline,
        notes=payload.scholarship.notes,
    )
    scholarship.requirements = [
        Requirement(
            id=item.id,
            workspace_id=workspace,
            title=item.title,
            done=item.done,
            position=index,
        )
        for index, item in enumerate(payload.scholarship.requirements)
    ]
    db.add(scholarship)
    db.add_all([Task(workspace_id=workspace, **item.model_dump()) for item in payload.tasks])
    db.add_all([Mission(workspace_id=workspace, **item.model_dump()) for item in payload.missions])
    db.add_all([WeightEntry(workspace_id=workspace, **item.model_dump()) for item in payload.weights])
    db.add_all([Workout(workspace_id=workspace, **item.model_dump()) for item in payload.workouts])
    db.add_all([Meal(workspace_id=workspace, **item.model_dump()) for item in payload.meals])
    db.commit()


def read_dashboard(db: Session, workspace: str) -> DashboardSchema | None:
    scholarship = db.scalar(
        select(Scholarship)
        .options(selectinload(Scholarship.requirements))
        .where(Scholarship.workspace_id == workspace)
    )
    if scholarship is None:
        return None

    tasks = db.scalars(select(Task).where(Task.workspace_id == workspace).order_by(Task.date, Task.time)).all()
    missions = db.scalars(select(Mission).where(Mission.workspace_id == workspace).order_by(Mission.date, Mission.time)).all()
    weights = db.scalars(select(WeightEntry).where(WeightEntry.workspace_id == workspace).order_by(WeightEntry.date)).all()
    workouts = db.scalars(select(Workout).where(Workout.workspace_id == workspace).order_by(Workout.day, Workout.time)).all()
    meals = db.scalars(select(Meal).where(Meal.workspace_id == workspace).order_by(Meal.type, Meal.title)).all()

    return DashboardSchema.model_validate(
        {
            "tasks": [{"id": item.id, "title": item.title, "time": item.time, "category": item.category, "date": item.date, "completed": item.completed} for item in tasks],
            "missions": [{"id": item.id, "title": item.title, "date": item.date, "time": item.time, "category": item.category, "xp": item.xp, "completed": item.completed} for item in missions],
            "scholarship": {
                "name": scholarship.name,
                "provider": scholarship.provider,
                "amount": scholarship.amount,
                "deadline": scholarship.deadline,
                "notes": scholarship.notes,
                "requirements": [{"id": item.id, "title": item.title, "done": item.done} for item in scholarship.requirements],
            },
            "weights": [{"id": item.id, "date": item.date, "value": item.value} for item in weights],
            "workouts": [{"id": item.id, "day": item.day, "title": item.title, "detail": item.detail, "time": item.time, "done": item.done} for item in workouts],
            "meals": [{"id": item.id, "type": item.type, "title": item.title, "detail": item.detail, "calories": item.calories} for item in meals],
        }
    )


def response_for(payload: DashboardSchema) -> DashboardResponse:
    return DashboardResponse(
        **payload.model_dump(),
        synced_at=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    if engine is None:
        return {"status": "degraded", "database": "not configured"}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database connection failed")


@app.get("/api/dashboard", response_model=DashboardResponse)
def get_dashboard(
    workspace: str = Depends(workspace_id),
    db: Session = Depends(get_db),
) -> DashboardResponse:
    dashboard = read_dashboard(db, workspace)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return response_for(dashboard)


@app.put("/api/dashboard", response_model=DashboardResponse)
def put_dashboard(
    payload: DashboardSchema,
    workspace: str = Depends(workspace_id),
    db: Session = Depends(get_db),
) -> DashboardResponse:
    replace_dashboard(db, workspace, payload)
    return response_for(payload)
