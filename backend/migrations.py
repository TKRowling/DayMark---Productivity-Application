import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine


def _normalize_postgres_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def run_schema_migrations(runtime_engine: Engine) -> None:
    """Apply small, additive schema migrations required by deployed models."""
    direct_url = os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("POSTGRES_URL_NON_POOLING")
    migration_engine = create_engine(
        _normalize_postgres_url(direct_url),
        pool_pre_ping=True,
    ) if direct_url else runtime_engine

    try:
        with migration_engine.begin() as connection:
            if connection.dialect.name == "postgresql":
                connection.execute(
                    text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_time VARCHAR(20) NOT NULL DEFAULT ''")
                )
                return

            columns = {column["name"] for column in inspect(connection).get_columns("tasks")}
            if "end_time" not in columns:
                connection.execute(
                    text("ALTER TABLE tasks ADD COLUMN end_time VARCHAR(20) NOT NULL DEFAULT ''")
                )
    finally:
        if migration_engine is not runtime_engine:
            migration_engine.dispose()
