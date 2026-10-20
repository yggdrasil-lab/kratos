"""MCP endpoint for the Kratos API.

A single streamable-HTTP MCP server mounted at exactly ``/mcp`` on the same
FastAPI app as the REST API, so the two share one process, one database
session factory and one deployment. It is built on the official MCP Python
SDK (``mcp.server.mcpserver.MCPServer``) rather than hand-rolled JSON-RPC:
the SDK owns protocol negotiation, session handling and the tool schemas.

Design notes
------------
* The SDK's streamable-HTTP routes are registered *directly* on the parent
  FastAPI app rather than mounted as a sub-application. A Starlette ``Mount``
  at ``/mcp`` produces a ``307`` redirect to ``/mcp/`` under the raw protocol,
  and the spec requires the endpoint at exactly ``/mcp``.
* The SDK sub-app's lifespan is folded into the parent app explicitly, because
  routes copied out of it do not carry its lifespan with them and the session
  manager would never start.
* Auth is a bearer token checked by a Starlette middleware that guards only
  ``/mcp``: SDK-native ``token_verifier`` needs OAuth ``AuthSettings`` (issuer
  URL plus discovery metadata) which this deployment does not have, and raw
  Starlette routes do not run FastAPI dependencies. The middleware fails
  closed — a missing configured token is a 503, a wrong one is a 401 — so an
  unauthenticated deployment can never serve tool calls.

Every tool maps onto the same service functions the REST routers use, so the
read and write paths cannot drift apart. Writes record their provenance under
``extra["source"]``, which the database schema already exposes on every table.
"""

from __future__ import annotations

import contextlib
import json
import uuid
from typing import Any, Iterator

from fastapi import FastAPI, HTTPException
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.config import settings
from app.models import Exercise, Routine, RoutineItem, WeeklyPlan
from app.routers.catalogue import (
    create_exercise as _create_exercise,
)
from app.routers.catalogue import (
    get_exercise as _get_exercise,
)
from app.routers.catalogue import (
    list_exercises as _list_exercises,
)
from app.routers.catalogue import (
    update_exercise as _update_exercise,
)
from app.routers.plan import (
    add_item as _add_item,
)
from app.routers.plan import (
    create_routine as _create_routine,
)
from app.routers.plan import (
    get_routine as _get_routine,
)
from app.routers.plan import (
    list_routines as _list_routines,
)
from app.routers.plan import (
    update_routine as _update_routine,
)
from app.schemas import (
    ExerciseCreate,
    ExerciseUpdate,
    RoutineCreate,
    RoutineItemCreate,
    RoutineUpdate,
)

# Spec ("Specs - MCP endpoint.md", §4): every write records a `source` value of
# `app` or `agent`, plus a timestamp. Anything arriving through MCP is an agent
# write; the row's created_at/updated_at supply the timestamp.
SOURCE = "agent"


class McpAuthMiddleware(BaseHTTPMiddleware):
    """Guard ``/mcp`` with a bearer token; fail closed when unconfigured."""

    async def dispatch(self, request, call_next):
        if request.url.path.rstrip("/") == "/mcp":
            token = settings.mcp_token
            if not token:
                return JSONResponse(
                    {"error": "mcp token not configured"}, status_code=503
                )
            scheme, _, presented = request.headers.get("authorization", "").partition(" ")
            if scheme.lower() != "bearer" or presented != token:
                return JSONResponse(
                    {"error": "unauthorized"},
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
        return await call_next(request)


def mcp_session() -> Session:
    """Open a short-lived session for a tool call.

    Tool calls arrive outside the request lifecycle, so they cannot use the
    ``get_db`` dependency. Going through ``SessionLocal`` keeps them on the same
    session factory (and the same test override) as the REST routers.
    """
    from app.db import SessionLocal

    return SessionLocal()


@contextlib.contextmanager
def _tool_errors() -> Iterator[None]:
    """Surface a router ``HTTPException`` as a clean MCP tool error.

    The MCP tools call the same functions the REST routes use. When one raises
    (a duplicate name is a 409, not a 500), the SDK would otherwise stringify
    the exception as ``"409: An exercise named ..."``. Re-raising the detail
    alone keeps the message a sentence an agent can act on. Anything that is
    not an ``HTTPException`` keeps propagating untouched.
    """
    try:
        yield
    except HTTPException as exc:
        raise ToolError(str(exc.detail)) from exc


def _with_source(extra: dict | None) -> dict:
    """Stamp the write's provenance into the ``extra`` JSONB column."""
    merged = dict(extra or {})
    merged["source"] = SOURCE
    return merged


def _serialise_exercise(exercise: Exercise) -> dict[str, Any]:
    return {
        "id": str(exercise.id),
        "name": exercise.name,
        "tracking": exercise.tracking,
        "equipment": exercise.equipment,
        "mechanics": exercise.mechanics,
        "weight_basis": exercise.weight_basis,
        "primary_muscles": list(exercise.primary_muscles or []),
        "secondary_muscles": list(exercise.secondary_muscles or []),
        "progression_scheme": exercise.progression_scheme,
        "video_url": exercise.video_url,
        "notes": exercise.notes,
        "extra": exercise.extra or {},
    }


def _serialise_item(item: RoutineItem) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "routine_id": str(item.routine_id),
        "exercise_id": str(item.exercise_id),
        "position": item.position,
        "target_sets": item.target_sets,
        "target_reps": item.target_reps,
        "target_weight_kg": (
            str(item.target_weight_kg) if item.target_weight_kg is not None else None
        ),
        "target_duration_s": item.target_duration_s,
        "notes": item.notes,
    }


def _serialise_routine(routine: Routine, include_items: bool = False) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": str(routine.id),
        "name": routine.name,
        "notes": routine.notes,
        "extra": routine.extra or {},
    }
    if include_items:
        payload["items"] = [_serialise_item(i) for i in routine.items]
    return payload


def build_mcp_server() -> MCPServer:
    """Construct the MCP server and register every tool.

    The spec's ``goal_get``/``goal_set``/``muscle_stats`` are deliberately NOT
    registered: there is no backing schema (migration 0001 has no goal/muscle
    tables; the gamification layer is proposed in "Specs - Gamification.md", not
    built). Registering names that return nothing would be worse than omitting
    them, so they land when the tables exist.
    """
    server = MCPServer(
        name="kratos",
        version="0.1.0",
        instructions=(
            "Workout catalogue, routine plans and logged sessions stored in the "
            "Kratos Postgres database. Tools mirror the REST API: search and read "
            "the exercise catalogue, read routine plans, then create or update "
            "exercises and routines. Every write is tagged with its source."
        ),
    )

    @server.tool(
        name="exercise_search",
        description="Find exercises by muscle and/or tracking type.",
    )
    def exercise_search(muscle: str | None = None, tracking: str | None = None) -> str:
        with mcp_session() as db:
            found = [
                _serialise_exercise(e)
                for e in _list_exercises(muscle=muscle, tracking=tracking, db=db)
            ]
        # Return one JSON text block, not a list. The SDK unrolls a list return
        # into one content block per item, so a client that reads content[0]
        # (most of them) would silently see only the first result.
        return json.dumps(found)

    @server.tool(
        name="exercise_get",
        description="Get one exercise by ID, with its muscles, notes and metadata.",
    )
    def exercise_get(exercise_id: str) -> dict:
        with mcp_session() as db:
            return _serialise_exercise(_get_exercise(uuid.UUID(exercise_id), db=db))

    @server.tool(name="exercise_create", description="Create a new catalogue exercise.")
    def exercise_create(
        name: str,
        tracking: str | None = None,
        equipment: str | None = None,
        mechanics: str | None = None,
        primary_muscles: list[str] | None = None,
        secondary_muscles: list[str] | None = None,
        notes: str | None = None,
    ) -> dict:
        fields: dict[str, Any] = {"name": name, "extra": _with_source(None)}
        if tracking is not None:
            fields["tracking"] = tracking
        if equipment is not None:
            fields["equipment"] = equipment
        if mechanics is not None:
            fields["mechanics"] = mechanics
        if primary_muscles is not None:
            fields["primary_muscles"] = primary_muscles
        if secondary_muscles is not None:
            fields["secondary_muscles"] = secondary_muscles
        if notes is not None:
            fields["notes"] = notes
        with mcp_session() as db, _tool_errors():
            return _serialise_exercise(_create_exercise(ExerciseCreate(**fields), db=db))

    @server.tool(name="exercise_update", description="Update an existing exercise.")
    def exercise_update(
        exercise_id: str,
        name: str | None = None,
        tracking: str | None = None,
        equipment: str | None = None,
        mechanics: str | None = None,
        primary_muscles: list[str] | None = None,
        secondary_muscles: list[str] | None = None,
        notes: str | None = None,
    ) -> dict:
        fields: dict[str, Any] = {}
        for key, value in {
            "name": name,
            "tracking": tracking,
            "equipment": equipment,
            "mechanics": mechanics,
            "primary_muscles": primary_muscles,
            "secondary_muscles": secondary_muscles,
            "notes": notes,
        }.items():
            if value is not None:
                fields[key] = value
        with mcp_session() as db, _tool_errors():
            exercise = _get_exercise(uuid.UUID(exercise_id), db=db)
            # Merge, so an update records provenance without dropping keys a
            # previous writer left in `extra`.
            fields["extra"] = _with_source(exercise.extra)
            return _serialise_exercise(
                _update_exercise(uuid.UUID(exercise_id), ExerciseUpdate(**fields), db=db)
            )

    @server.tool(name="exercise_note_add", description="Append a note to an exercise.")
    def exercise_note_add(exercise_id: str, note: str) -> dict:
        with mcp_session() as db:
            exercise = _get_exercise(uuid.UUID(exercise_id), db=db)
            combined = (
                f"{exercise.notes}\n{note}" if exercise.notes else note
            )
            return _serialise_exercise(
                _update_exercise(
                    uuid.UUID(exercise_id),
                    ExerciseUpdate(notes=combined, extra=_with_source(exercise.extra)),
                    db=db,
                )
            )

    @server.tool(name="routine_list", description="List all routine plans.")
    def routine_list() -> str:
        with mcp_session() as db:
            routines = [_serialise_routine(r) for r in _list_routines(db=db)]
        # Single JSON block; see exercise_search for why a list return is wrong.
        return json.dumps(routines)

    @server.tool(
        name="routine_get",
        description="Get one routine plan by ID, including its ordered items.",
    )
    def routine_get(routine_id: str) -> dict:
        with mcp_session() as db:
            return _serialise_routine(_get_routine(uuid.UUID(routine_id), db=db), include_items=True)

    @server.tool(name="routine_create", description="Create a routine plan, optionally with items.")
    def routine_create(
        name: str,
        notes: str | None = None,
        items: list[dict] | None = None,
    ) -> dict:
        entry: dict[str, Any] = {"name": name, "extra": _with_source(None)}
        if notes is not None:
            entry["notes"] = notes
        if items:
            entry["items"] = [RoutineItemCreate(**item) for item in items]
        with mcp_session() as db:
            return _serialise_routine(_create_routine(RoutineCreate(**entry), db=db))

    @server.tool(name="routine_update", description="Update a routine plan's name or notes.")
    def routine_update(
        routine_id: str,
        name: str | None = None,
        notes: str | None = None,
    ) -> dict:
        fields: dict[str, Any] = {}
        if name is not None:
            fields["name"] = name
        if notes is not None:
            fields["notes"] = notes
        with mcp_session() as db:
            routine = _get_routine(uuid.UUID(routine_id), db=db)
            fields["extra"] = _with_source(routine.extra)
            return _serialise_routine(
                _update_routine(uuid.UUID(routine_id), RoutineUpdate(**fields), db=db)
            )

    @server.tool(name="routine_item", description="Add an exercise to a routine plan.")
    def routine_item(
        routine_id: str,
        exercise_id: str,
        position: int,
        target_sets: int | None = None,
        target_reps: int | None = None,
        target_weight_kg: float | None = None,
        target_duration_s: int | None = None,
        notes: str | None = None,
    ) -> dict:
        payload: dict[str, Any] = {
            "exercise_id": uuid.UUID(exercise_id),
            "position": position,
            # RoutineItem has no `source` field; provenance goes in `extra`.
            "extra": _with_source(None),
        }
        for key, value in {
            "target_sets": target_sets,
            "target_reps": target_reps,
            "target_weight_kg": target_weight_kg,
            "target_duration_s": target_duration_s,
            "notes": notes,
        }.items():
            if value is not None:
                payload[key] = value
        with mcp_session() as db:
            return _serialise_item(_add_item(uuid.UUID(routine_id), payload, db=db))

    @server.tool(
        name="weekly_plan_get",
        description="Get the scheduled weekly workout plan for an ISO week (e.g. '2026-W43').",
    )
    def weekly_plan_get(iso_week: str) -> dict:
        with mcp_session() as db:
            plan = db.scalar(
                select(WeeklyPlan).where(
                    WeeklyPlan.iso_week == iso_week, WeeklyPlan.deleted_at.is_(None)
                )
            )
            if plan is None:
                return {"iso_week": iso_week, "days": [], "notes": None, "exists": False}
            return {
                "id": str(plan.id),
                "iso_week": plan.iso_week,
                "days": plan.days,
                "notes": plan.notes,
                "extra": plan.extra,
                "exists": True,
            }

    @server.tool(
        name="weekly_plan_set",
        description="Set or replace the scheduled weekly workout plan for an ISO week. days is a list of day configs (dayIndex, sessionName, type, emphasis, notes, extraActivities).",
    )
    def weekly_plan_set(
        iso_week: str,
        days: list[dict],
        notes: str | None = None,
    ) -> dict:
        with mcp_session() as db:
            plan = db.scalar(
                select(WeeklyPlan).where(
                    WeeklyPlan.iso_week == iso_week, WeeklyPlan.deleted_at.is_(None)
                )
            )
            if plan is None:
                plan = WeeklyPlan(
                    iso_week=iso_week,
                    days=days,
                    notes=notes,
                    extra=_with_source(None),
                )
                db.add(plan)
            else:
                plan.days = days
                if notes is not None:
                    plan.notes = notes
                plan.extra = _with_source(plan.extra)
            db.commit()
            db.refresh(plan)
            return {
                "id": str(plan.id),
                "iso_week": plan.iso_week,
                "days": plan.days,
                "notes": plan.notes,
                "extra": plan.extra,
                "status": "saved",
            }

    return server


class _RebuildableApp:
    """ASGI shim that (re)creates the SDK sub-app for each lifespan startup.

    ``StreamableHTTPSessionManager.run()`` may only be called once per instance,
    and the SDK's ``streamable_http_app`` builds a fresh manager every call. A
    single app-level sub-app would therefore work for the first startup and then
    raise ``RuntimeError`` on any later one — which is exactly what a test suite
    (a new ``TestClient`` per test) and a restarted worker both do. Rebuilding on
    startup keeps ``/mcp`` alive across both.
    """

    def __init__(self, server: MCPServer) -> None:
        self._server = server
        self.app: Starlette | None = None

    def _build(self) -> Starlette:
        return self._server.streamable_http_app(
            streamable_http_path="/mcp",
            stateless_http=True,
            json_response=True,
            # Runs behind Traefik: the public Host header is not the container's,
            # so the SDK's DNS-rebinding host check would answer HTTP 421.
            transport_security=TransportSecuritySettings(
                enable_dns_rebinding_protection=False
            ),
        )

    async def __call__(self, scope, receive, send):
        if self.app is None:
            raise RuntimeError("MCP sub-app is not running; lifespan did not start")
        await self.app(scope, receive, send)


def install_mcp(app: FastAPI) -> None:
    """Attach the MCP server's route and auth middleware to ``app``."""
    server = build_mcp_server()
    holder = _RebuildableApp(server)

    # One route at exactly /mcp. Registering the SDK sub-app's route directly on
    # the parent app (rather than Mount-ing the sub-app) avoids the 307 redirect
    # to /mcp/ that a Starlette Mount produces, which the spec forbids.
    app.router.routes.append(Route("/mcp", endpoint=holder))

    # Fold the SDK session manager's lifespan in. The sub-app is rebuilt and its
    # session manager started on every startup, then torn down on shutdown.
    original_lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(app_):
        sub_app = holder._build()
        holder.app = sub_app
        async with contextlib.AsyncExitStack() as stack:
            if original_lifespan is not None:
                await stack.enter_async_context(original_lifespan(app_))
            await stack.enter_async_context(sub_app.router.lifespan_context(app_))
            yield
        holder.app = None

    app.router.lifespan_context = lifespan

    app.add_middleware(McpAuthMiddleware)
