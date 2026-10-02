import os
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine


def _normalize_postgres_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def _migrate_legacy_scholarships(connection) -> None:
    """Copy each workspace's original single scholarship into the portfolio tables."""
    tables = set(inspect(connection).get_table_names())
    required_tables = {"scholarships", "requirements", "scholarship_entries", "scholarship_requirements"}
    if not required_tables.issubset(tables):
        return

    legacy_rows = connection.execute(
        text("SELECT workspace_id, name, provider, amount, deadline, notes FROM scholarships")
    ).mappings().all()

    for legacy in legacy_rows:
        workspace = legacy["workspace_id"]
        already_migrated = connection.execute(
            text("SELECT 1 FROM scholarship_entries WHERE workspace_id = :workspace LIMIT 1"),
            {"workspace": workspace},
        ).first()
        if already_migrated:
            continue

        scholarship_id = str(uuid5(NAMESPACE_URL, f"daymark-scholarship:{workspace}"))
        connection.execute(
            text(
                """
                INSERT INTO scholarship_entries
                    (id, workspace_id, name, provider, amount, deadline, notes)
                VALUES
                    (:id, :workspace_id, :name, :provider, :amount, :deadline, :notes)
                """
            ),
            {
                "id": scholarship_id,
                "workspace_id": workspace,
                "name": legacy["name"],
                "provider": legacy["provider"],
                "amount": legacy["amount"],
                "deadline": legacy["deadline"],
                "notes": legacy["notes"],
            },
        )

        requirements = connection.execute(
            text(
                """
                SELECT id, title, done, position
                FROM requirements
                WHERE workspace_id = :workspace
                ORDER BY position
                """
            ),
            {"workspace": workspace},
        ).mappings().all()
        for requirement in requirements:
            connection.execute(
                text(
                    """
                    INSERT INTO scholarship_requirements
                        (id, scholarship_id, workspace_id, title, done, position)
                    VALUES
                        (:id, :scholarship_id, :workspace_id, :title, :done, :position)
                    """
                ),
                {
                    "id": requirement["id"],
                    "scholarship_id": scholarship_id,
                    "workspace_id": workspace,
                    "title": requirement["title"],
                    "done": requirement["done"],
                    "position": requirement["position"],
                },
            )


def _migrate_mission_completions(connection) -> None:
    """Preserve XP from missions completed before daily history was introduced."""
    tables = set(inspect(connection).get_table_names())
    if not {"missions", "mission_completions"}.issubset(tables):
        return

    completed_missions = connection.execute(
        text("SELECT id, workspace_id, date FROM missions WHERE completed = :completed"),
        {"completed": True},
    ).mappings().all()
    for mission in completed_missions:
        exists = connection.execute(
            text(
                """
                SELECT 1 FROM mission_completions
                WHERE mission_id = :mission_id AND completed_on = :completed_on
                LIMIT 1
                """
            ),
            {"mission_id": mission["id"], "completed_on": mission["date"]},
        ).first()
        if exists:
            continue
        completion_id = str(uuid5(NAMESPACE_URL, f"daymark-mission:{mission['id']}:{mission['date']}"))
        connection.execute(
            text(
                """
                INSERT INTO mission_completions
                    (id, mission_id, workspace_id, completed_on)
                VALUES
                    (:id, :mission_id, :workspace_id, :completed_on)
                """
            ),
            {
                "id": completion_id,
                "mission_id": mission["id"],
                "workspace_id": mission["workspace_id"],
                "completed_on": mission["date"],
            },
        )


def _migrate_mission_xp_rewards(connection) -> None:
    """Map legacy mission rewards onto the smaller 1, 3, 5, 10 XP scale."""
    if "missions" not in set(inspect(connection).get_table_names()):
        return

    connection.execute(
        text(
            """
            UPDATE missions
            SET xp = CASE
                WHEN xp IN (1, 3, 5, 10) THEN xp
                WHEN xp = 15 THEN 1
                WHEN xp = 25 THEN 3
                WHEN xp = 50 THEN 5
                WHEN xp = 100 THEN 10
                WHEN xp IS NULL THEN 3
                WHEN xp < 2 THEN 1
                WHEN xp < 4 THEN 3
                WHEN xp < 8 THEN 5
                ELSE 10
            END
            WHERE xp IS NULL OR xp NOT IN (1, 3, 5, 10)
            """
        )
    )


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
            else:
                columns = {column["name"] for column in inspect(connection).get_columns("tasks")}
                if "end_time" not in columns:
                    connection.execute(
                        text("ALTER TABLE tasks ADD COLUMN end_time VARCHAR(20) NOT NULL DEFAULT ''")
                    )

            _migrate_legacy_scholarships(connection)
            _migrate_mission_completions(connection)
            _migrate_mission_xp_rewards(connection)
    finally:
        if migration_engine is not runtime_engine:
            migration_engine.dispose()
