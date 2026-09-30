from datetime import date

from pydantic import BaseModel, Field, field_validator


class TaskSchema(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=240)
    time: str = Field(max_length=20)
    category: str = Field(min_length=1, max_length=50)
    date: date
    completed: bool = False


class RequirementSchema(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=240)
    done: bool = False


class ScholarshipSchema(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    provider: str = Field(default="", max_length=240)
    amount: str = Field(default="", max_length=80)
    deadline: date
    notes: str = Field(default="", max_length=5000)
    requirements: list[RequirementSchema] = Field(default_factory=list, max_length=100)


class WeightSchema(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    date: date
    value: float = Field(ge=20, le=400)


class WorkoutSchema(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    day: str
    title: str = Field(min_length=1, max_length=240)
    detail: str = Field(default="", max_length=500)
    time: str = Field(max_length=20)
    done: bool = False

    @field_validator("day")
    @classmethod
    def validate_day(cls, value: str) -> str:
        value = value.upper()
        if value not in {"MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"}:
            raise ValueError("day must be a three-letter weekday")
        return value


class MealSchema(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    type: str = Field(min_length=1, max_length=30)
    title: str = Field(min_length=1, max_length=240)
    detail: str = Field(default="", max_length=500)
    calories: int = Field(default=0, ge=0, le=10000)


class DashboardSchema(BaseModel):
    tasks: list[TaskSchema] = Field(default_factory=list, max_length=500)
    scholarship: ScholarshipSchema
    weights: list[WeightSchema] = Field(default_factory=list, max_length=1000)
    workouts: list[WorkoutSchema] = Field(default_factory=list, max_length=200)
    meals: list[MealSchema] = Field(default_factory=list, max_length=200)


class DashboardResponse(DashboardSchema):
    synced_at: str
