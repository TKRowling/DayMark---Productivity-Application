from datetime import date

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(240))
    time: Mapped[str] = mapped_column(String(20))
    end_time: Mapped[str] = mapped_column(String(20), default="", server_default="")
    category: Mapped[str] = mapped_column(String(50))
    date: Mapped[date] = mapped_column(Date)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)


class Mission(Base):
    __tablename__ = "missions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(240))
    date: Mapped[date] = mapped_column(Date)
    # Kept internally for compatibility with the first missions table version.
    # The mission API no longer exposes or requires a time.
    time: Mapped[str] = mapped_column(String(20), default="")
    category: Mapped[str] = mapped_column(String(50))
    xp: Mapped[int] = mapped_column(Integer, default=3)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    completions: Mapped[list["MissionCompletion"]] = relationship(
        back_populates="mission",
        cascade="all, delete-orphan",
        order_by="MissionCompletion.completed_on",
    )


class MissionCompletion(Base):
    __tablename__ = "mission_completions"
    __table_args__ = (UniqueConstraint("mission_id", "completed_on", name="uq_mission_completion_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    mission_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("missions.id", ondelete="CASCADE"),
        index=True,
    )
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    completed_on: Mapped[date] = mapped_column(Date)
    mission: Mapped[Mission] = relationship(back_populates="completions")


class Scholarship(Base):
    __tablename__ = "scholarships"

    workspace_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(240))
    provider: Mapped[str] = mapped_column(String(240), default="")
    amount: Mapped[str] = mapped_column(String(80), default="")
    deadline: Mapped[date] = mapped_column(Date)
    notes: Mapped[str] = mapped_column(Text, default="")
    requirements: Mapped[list["Requirement"]] = relationship(
        back_populates="scholarship",
        cascade="all, delete-orphan",
        order_by="Requirement.position",
    )


class Requirement(Base):
    __tablename__ = "requirements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("scholarships.workspace_id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(240))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    scholarship: Mapped[Scholarship] = relationship(back_populates="requirements")


class ScholarshipEntry(Base):
    __tablename__ = "scholarship_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(240))
    provider: Mapped[str] = mapped_column(String(240), default="")
    amount: Mapped[str] = mapped_column(String(80), default="")
    deadline: Mapped[date] = mapped_column(Date)
    notes: Mapped[str] = mapped_column(Text, default="")
    requirements: Mapped[list["ScholarshipRequirement"]] = relationship(
        back_populates="scholarship",
        cascade="all, delete-orphan",
        order_by="ScholarshipRequirement.position",
    )


class ScholarshipRequirement(Base):
    __tablename__ = "scholarship_requirements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scholarship_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("scholarship_entries.id", ondelete="CASCADE"),
        index=True,
    )
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(240))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    scholarship: Mapped[ScholarshipEntry] = relationship(back_populates="requirements")


class WeightEntry(Base):
    __tablename__ = "weight_entries"
    __table_args__ = (UniqueConstraint("workspace_id", "date", name="uq_weight_workspace_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    date: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(Float)


class Workout(Base):
    __tablename__ = "workouts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    day: Mapped[str] = mapped_column(String(3))
    title: Mapped[str] = mapped_column(String(240))
    detail: Mapped[str] = mapped_column(String(500), default="")
    time: Mapped[str] = mapped_column(String(20))
    done: Mapped[bool] = mapped_column(Boolean, default=False)


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(String(64), index=True)
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(240))
    detail: Mapped[str] = mapped_column(String(500), default="")
    calories: Mapped[int] = mapped_column(Integer, default=0)
