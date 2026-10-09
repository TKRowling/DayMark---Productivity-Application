"""Authentication for Vercel Cron and the GitHub Actions notification scheduler."""

from __future__ import annotations

import hmac
import os

import jwt
from jwt import PyJWKClient


GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com"
GITHUB_OIDC_JWKS_URL = f"{GITHUB_OIDC_ISSUER}/.well-known/jwks"
GITHUB_OIDC_AUDIENCE = "daymark-telegram-scheduler"
DEFAULT_GITHUB_REPOSITORY = "TKRowling/DayMark---Productivity-Application"
SCHEDULER_WORKFLOW = ".github/workflows/telegram-notifications.yml"

_github_keys = PyJWKClient(GITHUB_OIDC_JWKS_URL, cache_keys=True)


class SchedulerAuthorizationError(RuntimeError):
    pass


def _verify_github_actions_token(token: str) -> None:
    try:
        signing_key = _github_keys.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=GITHUB_OIDC_AUDIENCE,
            issuer=GITHUB_OIDC_ISSUER,
            options={"require": ["exp", "iat", "nbf", "repository", "workflow_ref", "event_name"]},
        )
    except jwt.PyJWTError as error:
        raise SchedulerAuthorizationError("Invalid GitHub Actions identity token") from error

    repository = os.getenv("GITHUB_SCHEDULER_REPOSITORY", DEFAULT_GITHUB_REPOSITORY).strip()
    expected_workflow = f"{repository}/{SCHEDULER_WORKFLOW}@refs/heads/main"
    if (
        claims.get("repository") != repository
        or claims.get("ref") != "refs/heads/main"
        or claims.get("workflow_ref") != expected_workflow
        or claims.get("event_name") not in {"schedule", "workflow_dispatch"}
    ):
        raise SchedulerAuthorizationError("GitHub Actions identity is not authorized")


def authorize_notification_scheduler(authorization: str | None) -> None:
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not supplied:
        raise SchedulerAuthorizationError("Missing scheduler authorization")

    cron_secret = os.getenv("CRON_SECRET", "").strip()
    if cron_secret and hmac.compare_digest(supplied, cron_secret):
        return

    # GitHub OIDC tokens are JWTs. Reject ordinary invalid values without a JWKS request.
    if supplied.count(".") != 2:
        raise SchedulerAuthorizationError("Invalid scheduler authorization")
    _verify_github_actions_token(supplied)
