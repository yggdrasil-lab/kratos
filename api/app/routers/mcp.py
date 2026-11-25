"""MCP endpoint for the Kratos API.

A single streamable-HTTP MCP server mounted at exactly ``/mcp`` on the same
FastAPI app as the REST API, delegating directly to TrainingCore via
``app.state.container``.
"""

from __future__ import annotations

import contextlib
import json
import uuid
from collections.abc import Callable, Iterator
from typing import Any

from fastapi import FastAPI, HTTPException
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy.orm import Session
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.container import KratosContainer
from app.ports.eir import EirPort
from app.routers.biometrics import (
    get_fasting_recommendation as _get_fasting_recommendation,
    get_workout_recommendation as _get_workout_recommendation,
    trigger_fasting_synthesis as _trigger_fasting_synthesis,
    trigger_workout_synthesis as _trigger_workout_synthesis,
)
from app.schemas import (
    ExerciseCreate,
    ExerciseRead,
    ExerciseUpdate,
    FastingSynthesizeRequest,
    RoutineCreate,
    RoutineItemCreate,
    RoutineItemRead,
    RoutineRead,
    RoutineUpdate,
    WeeklyPlanRead,
    WeeklyPlanUpdate,
    WorkoutSynthesizeRequest,
)
from app.training import TrainingCore, TrainingError

SOURCE = "agent"

SessionOpener = Callable[[], contextlib.AbstractContextManager[Session]]
TrainingGetter = Callable[[], TrainingCore]
EirGetter = Callable[[], EirPort]


class McpAuthMiddleware(BaseHTTPMiddleware):
    """Guard ``/mcp`` with a bearer token from ``app.state.container``; fail closed."""

    async def dispatch(self, request, call_next):
        if request.url.path.rstrip("/") == "/mcp":
            container = getattr(request.app.state, "container", None)
            token = container.settings.mcp_token if container is not None else None
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


@contextlib.contextmanager
def _tool_errors() -> Iterator[None]:
    """Surface domain or HTTP exceptions as clean MCP tool errors."""
    try:
        yield
    except TrainingError as exc:
        raise ToolError(str(exc)) from exc
    except HTTPException as exc:
        raise ToolError(str(exc.detail)) from exc


def _dump_exercise(exercise: Any) -> dict[str, Any]:
    return ExerciseRead.model_validate(exercise).model_dump(mode="json")


def _dump_routine(routine: Any, *, include_items: bool = False) -> dict[str, Any]:
    exclude = None if include_items else {"items"}
    return RoutineRead.model_validate(routine).model_dump(mode="json", exclude=exclude)


def _dump_routine_item(item: Any) -> dict[str, Any]:
    return RoutineItemRead.model_validate(item).model_dump(mode="json")


def _non_null_fields(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


def _register_exercise_read_tools(
    server: MCPServer, open_session: SessionOpener, get_training: TrainingGetter
) -> None:
    @server.tool(
        name="exercise_search",
        description="Find exercises by muscle and/or tracking type.",
    )
    def exercise_search(muscle: str | None = None, tracking: str | None = None) -> str:
        with open_session() as db, _tool_errors():
            found = [
                _dump_exercise(ex)
                for ex in get_training().search_exercises(
                    db, muscle=muscle, tracking=tracking
                )
            ]
        return json.dumps(found)

    @server.tool(
        name="exercise_get",
        description="Get one exercise by ID, with its muscles, notes and metadata.",
    )
    def exercise_get(exercise_id: str) -> dict:
        with open_session() as db, _tool_errors():
            return _dump_exercise(
                get_training().get_exercise(db, uuid.UUID(exercise_id))
            )


def _register_exercise_create_tool(
    server: MCPServer, open_session: SessionOpener, get_training: TrainingGetter
) -> None:
    @server.tool(name="exercise_create", description="Create a new catalogue exercise.")
    def exercise_create(
        name: str,
        tracking: str | None = None,
        equipment: str | None = None,
        mechanics: str | None = None,
        weight_basis: str | None = None,
        primary_muscles: list[str] | None = None,
        secondary_muscles: list[str] | None = None,
        notes: str | None = None,
    ) -> dict:
        fields = _non_null_fields(
            {
                "tracking": tracking,
                "equipment": equipment,
                "mechanics": mechanics,
                "weight_basis": weight_basis,
                "primary_muscles": primary_muscles,
                "secondary_muscles": secondary_muscles,
                "notes": notes,
            }
        )
        fields["name"] = name
        with open_session() as db, _tool_errors():
            return _dump_exercise(
                get_training().create_exercise(
                    db, ExerciseCreate(**fields), source=SOURCE
                )
            )


def _register_exercise_update_tools(
    server: MCPServer, open_session: SessionOpener, get_training: TrainingGetter
) -> None:
    @server.tool(name="exercise_update", description="Update an existing exercise.")
    def exercise_update(
        exercise_id: str,
        name: str | None = None,
        tracking: str | None = None,
        equipment: str | None = None,
        mechanics: str | None = None,
        weight_basis: str | None = None,
        primary_muscles: list[str] | None = None,
        secondary_muscles: list[str] | None = None,
        notes: str | None = None,
    ) -> dict:
        fields = _non_null_fields(
            {
                "name": name,
                "tracking": tracking,
                "equipment": equipment,
                "mechanics": mechanics,
                "weight_basis": weight_basis,
                "primary_muscles": primary_muscles,
                "secondary_muscles": secondary_muscles,
                "notes": notes,
            }
        )
        with open_session() as db, _tool_errors():
            return _dump_exercise(
                get_training().update_exercise(
                    db, uuid.UUID(exercise_id), ExerciseUpdate(**fields), source=SOURCE
                )
            )

    @server.tool(name="exercise_note_add", description="Append a note to an exercise.")
    def exercise_note_add(exercise_id: str, note: str) -> dict:
        with open_session() as db, _tool_errors():
            return _dump_exercise(
                get_training().add_exercise_note(
                    db, uuid.UUID(exercise_id), note, source=SOURCE
                )
            )


def _register_routine_crud_tools(
    server: MCPServer, open_session: SessionOpener, get_training: TrainingGetter
) -> None:
    @server.tool(name="routine_list", description="List all routine plans.")
    def routine_list() -> str:
        with open_session() as db, _tool_errors():
            routines = [_dump_routine(r) for r in get_training().list_routines(db)]
        return json.dumps(routines)

    @server.tool(
        name="routine_get",
        description="Get one routine plan by ID, including its ordered items.",
    )
    def routine_get(routine_id: str) -> dict:
        with open_session() as db, _tool_errors():
            return _dump_routine(
                get_training().get_routine(db, uuid.UUID(routine_id)),
                include_items=True,
            )

    @server.tool(name="routine_create", description="Create a routine plan, optionally with items.")
    def routine_create(
        name: str,
        notes: str | None = None,
        items: list[dict] | None = None,
    ) -> dict:
        entry: dict[str, Any] = {"name": name}
        if notes is not None:
            entry["notes"] = notes
        if items:
            entry["items"] = [RoutineItemCreate(**item) for item in items]
        with open_session() as db, _tool_errors():
            return _dump_routine(
                get_training().create_routine(db, RoutineCreate(**entry), source=SOURCE)
            )


def _register_routine_mutation_tools(
    server: MCPServer, open_session: SessionOpener, get_training: TrainingGetter
) -> None:
    @server.tool(name="routine_update", description="Update a routine plan's name or notes.")
    def routine_update(
        routine_id: str,
        name: str | None = None,
        notes: str | None = None,
    ) -> dict:
        fields = _non_null_fields({"name": name, "notes": notes})
        with open_session() as db, _tool_errors():
            return _dump_routine(
                get_training().update_routine(
                    db, uuid.UUID(routine_id), RoutineUpdate(**fields), source=SOURCE
                )
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
        payload = _non_null_fields(
            {
                "target_sets": target_sets,
                "target_reps": target_reps,
                "target_weight_kg": target_weight_kg,
                "target_duration_s": target_duration_s,
                "notes": notes,
            }
        )
        payload["exercise_id"] = uuid.UUID(exercise_id)
        payload["position"] = position
        with open_session() as db, _tool_errors():
            return _dump_routine_item(
                get_training().add_routine_item(
                    db, uuid.UUID(routine_id), RoutineItemCreate(**payload), source=SOURCE
                )
            )


def _register_weekly_plan_tools(
    server: MCPServer, open_session: SessionOpener, get_training: TrainingGetter
) -> None:
    @server.tool(
        name="weekly_plan_get",
        description="Get the scheduled weekly workout plan for an ISO week (e.g. '2026-W43').",
    )
    def weekly_plan_get(iso_week: str) -> dict:
        with open_session() as db, _tool_errors():
            plan = get_training().get_weekly_plan(db, iso_week)
            if plan is None:
                return {"iso_week": iso_week, "days": [], "notes": None, "exists": False}
            data = WeeklyPlanRead.model_validate(plan).model_dump(mode="json")
            data["exists"] = True
            return data

    @server.tool(
        name="weekly_plan_set",
        description="Set or replace the scheduled weekly workout plan for an ISO week. days is a list of day configs (dayIndex, sessionName, type, emphasis, notes, extraActivities).",
    )
    def weekly_plan_set(
        iso_week: str,
        days: list[dict],
        notes: str | None = None,
    ) -> dict:
        fields: dict[str, Any] = {"days": days}
        if notes is not None:
            fields["notes"] = notes
        with open_session() as db, _tool_errors():
            plan = get_training().upsert_weekly_plan(
                db, iso_week, WeeklyPlanUpdate(**fields), source=SOURCE
            )
            data = WeeklyPlanRead.model_validate(plan).model_dump(mode="json")
            data["status"] = "saved"
            return data


def _register_fasting_tools(
    server: MCPServer, open_session: SessionOpener, get_eir: EirGetter
) -> None:
    @server.tool(
        name="fasting_recommendation_get",
        description="Get today's (or target date's) AI-synthesized circadian fasting recommendation, including target window, rationale, fueling anchors, and Discord thread ID.",
    )
    def fasting_recommendation_get(target_date: str | None = None) -> dict:
        with open_session() as db, _tool_errors():
            rec = _get_fasting_recommendation(
                target_date=target_date, db=db, eir=get_eir()
            )
            return rec.model_dump()

    @server.tool(
        name="fasting_recommendation_adjust",
        description="Adjust and re-synthesize a fasting recommendation for today (or target date) using user instructions from Discord or chat (e.g. 'shorten fast to 14h', 'shift feeding window earlier for lunch meeting').",
    )
    def fasting_recommendation_adjust(
        user_adjustment: str,
        target_date: str | None = None,
    ) -> dict:
        with open_session() as db, _tool_errors():
            payload = FastingSynthesizeRequest(
                target_date=target_date, custom_context=user_adjustment
            )
            rec = _trigger_fasting_synthesis(
                payload=payload, db=db, eir=get_eir(), source=SOURCE
            )
            return rec.model_dump()


def _register_workout_tools(
    server: MCPServer, open_session: SessionOpener, get_eir: EirGetter
) -> None:
    @server.tool(
        name="workout_recommendation_get",
        description="Get today's (or target date's) AI-synthesized workout recommendation, including routine name, readiness adaptation, target RIR, volume landmark, exercises, and Discord thread ID.",
    )
    def workout_recommendation_get(target_date: str | None = None) -> dict:
        with open_session() as db, _tool_errors():
            rec = _get_workout_recommendation(
                target_date=target_date, db=db, eir=get_eir()
            )
            return rec.model_dump()

    @server.tool(
        name="workout_recommendation_adjust",
        description="Adjust and re-synthesize an autoregulated workout recommendation for today (or target date) based on user instructions from Discord or chat (e.g. 'swap Bulgarian Split Squats for Leg Press due to knee tweak', 'reduce volume by 1 set across all exercises').",
    )
    def workout_recommendation_adjust(
        user_adjustment: str,
        target_date: str | None = None,
    ) -> dict:
        with open_session() as db, _tool_errors():
            payload = WorkoutSynthesizeRequest(
                target_date=target_date, custom_context=user_adjustment
            )
            rec = _trigger_workout_synthesis(
                payload=payload, db=db, eir=get_eir(), source=SOURCE
            )
            return rec.model_dump()


def build_mcp_server(container: KratosContainer | None = None) -> MCPServer:
    """Construct the MCP server and register all training and recommendation tools."""
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

    def _require_container() -> KratosContainer:
        if container is None:
            raise RuntimeError("KratosContainer is not initialized for MCP execution")
        return container

    @contextlib.contextmanager
    def _open_session() -> Iterator[Session]:
        db = _require_container().session_factory()
        try:
            yield db
        finally:
            db.close()

    get_training = lambda: _require_container().training
    get_eir = lambda: _require_container().eir
    _register_exercise_read_tools(server, _open_session, get_training)
    _register_exercise_create_tool(server, _open_session, get_training)
    _register_exercise_update_tools(server, _open_session, get_training)
    _register_routine_crud_tools(server, _open_session, get_training)
    _register_routine_mutation_tools(server, _open_session, get_training)
    _register_weekly_plan_tools(server, _open_session, get_training)
    _register_fasting_tools(server, _open_session, get_eir)
    _register_workout_tools(server, _open_session, get_eir)
    return server


class _RebuildableApp:
    """ASGI shim that (re)creates the SDK sub-app for each lifespan startup."""

    def __init__(self, server: MCPServer) -> None:
        self._server = server
        self.app: Starlette | None = None

    def _build(self) -> Starlette:
        return self._server.streamable_http_app(
            streamable_http_path="/mcp",
            stateless_http=True,
            json_response=True,
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
    container = getattr(app.state, "container", None)
    if not isinstance(container, KratosContainer):
        raise RuntimeError("KratosContainer must be initialized before install_mcp(app)")
    server = build_mcp_server(container)
    holder = _RebuildableApp(server)

    app.router.routes.append(Route("/mcp", endpoint=holder))

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
