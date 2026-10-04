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
from migrations import run_schema_migrations
from models import Meal, Mission, MissionCompletion, ScholarshipEntry, ScholarshipRequirement, Task, TaskSubtask, WeightEntry, Workout
from schemas import DashboardResponse, DashboardSchema


WORKSPACE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if engine is not None:
        Base.metadata.create_all(bind=engine)
        run_schema_migrations(engine)
    yield


app = FastAPI(
    title="Daymark API",
    description="Persistence API for missions, tasks, scholarships, weight tracking, workouts, and meals.",
    version="1.5.0",
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
    default_scholarship = {
        "id": new_id(),
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
    }
    return DashboardSchema.model_validate(
        {
            "tasks": [
                {"id": new_id(), "title": "30-minute morning walk", "time": "7:30 AM", "end_time": "8:00 AM", "category": "Wellness", "date": today, "completed": True},
                {"id": new_id(), "title": "Review scholarship essay", "time": "10:00 AM", "end_time": "11:00 AM", "category": "Scholarship", "date": today, "completed": False},
                {"id": new_id(), "title": "Complete reading assignment", "time": "2:00 PM", "end_time": "3:00 PM", "category": "Study", "date": today, "completed": False},
                {"id": new_id(), "title": "Upper body workout", "time": "6:30 PM", "end_time": "7:30 PM", "category": "Fitness", "date": today, "completed": False},
                {"id": new_id(), "title": "Plan tomorrow’s priorities", "time": "9:00 PM", "end_time": "9:30 PM", "category": "Personal", "date": today, "completed": False},
            ],
            "missions": [],
            "scholarships": [default_scholarship],
            "scholarship": default_scholarship,
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
    db.execute(delete(ScholarshipRequirement).where(ScholarshipRequirement.workspace_id == workspace))
    db.execute(delete(ScholarshipEntry).where(ScholarshipEntry.workspace_id == workspace))
    db.execute(delete(TaskSubtask).where(TaskSubtask.workspace_id == workspace))
    db.execute(delete(Task).where(Task.workspace_id == workspace))
    db.execute(delete(MissionCompletion).where(MissionCompletion.workspace_id == workspace))
    db.execute(delete(Mission).where(Mission.workspace_id == workspace))
    db.execute(delete(WeightEntry).where(WeightEntry.workspace_id == workspace))
    db.execute(delete(Workout).where(Workout.workspace_id == workspace))
    db.execute(delete(Meal).where(Meal.workspace_id == workspace))

    scholarships = list(payload.scholarships)
    if payload.scholarship is not None:
        if not scholarships:
            scholarships = [payload.scholarship]
        elif payload.scholarship.model_dump() != scholarships[0].model_dump():
            # An older cached frontend updates the legacy singular field.
            scholarships[0] = payload.scholarship

    for item in scholarships:
        scholarship = ScholarshipEntry(
            id=item.id,
            workspace_id=workspace,
            name=item.name,
            provider=item.provider,
            amount=item.amount,
            deadline=item.deadline,
            notes=item.notes,
        )
        scholarship.requirements = [
            ScholarshipRequirement(
                id=requirement.id,
                scholarship_id=item.id,
                workspace_id=workspace,
                title=requirement.title,
                done=requirement.done,
                position=index,
            )
            for index, requirement in enumerate(item.requirements)
        ]
        db.add(scholarship)
    for item in payload.tasks:
        task = Task(
            id=item.id,
            workspace_id=workspace,
            title=item.title,
            time=item.time,
            end_time=item.end_time,
            category=item.category,
            date=item.date,
            completed=item.completed,
        )
        task.subtasks = [
            TaskSubtask(
                id=subtask.id,
                task_id=item.id,
                workspace_id=workspace,
                title=subtask.title,
                done=subtask.done,
                position=index,
            )
            for index, subtask in enumerate(item.subtasks)
        ]
        db.add(task)
    for item in payload.missions:
        completion_dates = list(dict.fromkeys(item.completion_dates))
        if "completion_dates" not in item.model_fields_set and item.completed:
            completion_dates = [item.date]
        mission = Mission(
            id=item.id,
            workspace_id=workspace,
            title=item.title,
            date=item.date,
            category=item.category,
            xp=item.xp,
            completed=item.completed,
        )
        mission.completions = [
            MissionCompletion(
                id=new_id(),
                mission_id=item.id,
                workspace_id=workspace,
                completed_on=completed_on,
            )
            for completed_on in completion_dates
        ]
        db.add(mission)
    db.add_all([WeightEntry(workspace_id=workspace, **item.model_dump()) for item in payload.weights])
    db.add_all([Workout(workspace_id=workspace, **item.model_dump()) for item in payload.workouts])
    db.add_all([Meal(workspace_id=workspace, **item.model_dump()) for item in payload.meals])
    db.commit()


def read_dashboard(db: Session, workspace: str) -> DashboardSchema | None:
    scholarships = db.scalars(
        select(ScholarshipEntry)
        .options(selectinload(ScholarshipEntry.requirements))
        .where(ScholarshipEntry.workspace_id == workspace)
        .order_by(ScholarshipEntry.deadline, ScholarshipEntry.name)
    ).all()
    tasks = db.scalars(
        select(Task)
        .options(selectinload(Task.subtasks))
        .where(Task.workspace_id == workspace)
        .order_by(Task.date, Task.time)
    ).all()
    missions = db.scalars(
        select(Mission)
        .options(selectinload(Mission.completions))
        .where(Mission.workspace_id == workspace)
        .order_by(Mission.date, Mission.id)
    ).all()
    weights = db.scalars(select(WeightEntry).where(WeightEntry.workspace_id == workspace).order_by(WeightEntry.date)).all()
    workouts = db.scalars(select(Workout).where(Workout.workspace_id == workspace).order_by(Workout.day, Workout.time)).all()
    meals = db.scalars(select(Meal).where(Meal.workspace_id == workspace).order_by(Meal.type, Meal.title)).all()

    if not any((scholarships, tasks, missions, weights, workouts, meals)):
        return None

    scholarship_data = [
        {
            "id": item.id,
            "name": item.name,
            "provider": item.provider,
            "amount": item.amount,
            "deadline": item.deadline,
            "notes": item.notes,
            "requirements": [{"id": requirement.id, "title": requirement.title, "done": requirement.done} for requirement in item.requirements],
        }
        for item in scholarships
    ]

    return DashboardSchema.model_validate(
        {
            "tasks": [
                {
                    "id": item.id,
                    "title": item.title,
                    "time": item.time,
                    "end_time": item.end_time,
                    "category": item.category,
                    "date": item.date,
                    "completed": item.completed,
                    "subtasks": [
                        {"id": subtask.id, "title": subtask.title, "done": subtask.done}
                        for subtask in item.subtasks
                    ],
                }
                for item in tasks
            ],
            "missions": [
                {
                    "id": item.id,
                    "title": item.title,
                    "date": item.date,
                    "category": item.category,
                    "xp": item.xp,
                    "completed": date.today() in {completion.completed_on for completion in item.completions},
                    "completion_dates": [completion.completed_on for completion in item.completions],
                }
                for item in missions
            ],
            "scholarships": scholarship_data,
            "scholarship": scholarship_data[0] if scholarship_data else None,
            "weights": [{"id": item.id, "date": item.date, "value": item.value} for item in weights],
            "workouts": [{"id": item.id, "day": item.day, "title": item.title, "detail": item.detail, "time": item.time, "done": item.done} for item in workouts],
            "meals": [{"id": item.id, "type": item.type, "title": item.title, "detail": item.detail, "calories": item.calories} for item in meals],
        }
    )


def response_for(payload: DashboardSchema) -> DashboardResponse:
    response_data = payload.model_dump()
    if response_data["scholarship"] is None and response_data["scholarships"]:
        response_data["scholarship"] = response_data["scholarships"][0]
    return DashboardResponse(
        **response_data,
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
