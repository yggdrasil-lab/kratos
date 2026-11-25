"""Kratos API entrypoint.

Serves the three domain groups (catalogue, plan, log) plus the derived reads.
The OpenAPI schema at /openapi.json is the contract the TypeScript client is
generated from, so response models are declared on every route.
"""

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import __version__
from app.container import KratosContainer, build_container
from app.db import get_db
from app.ports.eir import EirUpstreamError
from app.routers import biometrics, catalogue, client_errors, log, plan, stats
from app.routers.mcp import install_mcp
from app.schemas import HealthRead


class NoCacheMiddleware:
    """Stamp every HTTP response with no-store headers.

    Without an explicit Cache-Control, mobile WebKit in a standalone home-screen
    PWA heuristically caches GETs (e.g. /biometrics/today) across sessions and
    serves stale data. Pure ASGI (not BaseHTTPMiddleware) so streaming responses
    such as the MCP endpoint are not buffered.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_no_cache(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
                headers["Pragma"] = "no-cache"
                headers["Expires"] = "0"
            await send(message)

        await self.app(scope, receive, send_with_no_cache)


def _handle_eir_upstream_error(_request: Request, exc: Exception) -> JSONResponse:
    """Fail loudly with HTTP 502 when a required Eir upstream call fails."""
    return JSONResponse(status_code=502, content={"detail": str(exc)})


def _register_routes(fastapi_app: FastAPI) -> None:
    fastapi_app.include_router(catalogue.router)
    fastapi_app.include_router(plan.router)
    fastapi_app.include_router(plan.weekly_plan_router)
    fastapi_app.include_router(log.router)
    fastapi_app.include_router(stats.router)
    fastapi_app.include_router(biometrics.router)
    fastapi_app.include_router(client_errors.router)
    fastapi_app.include_router(client_errors.router, prefix="/api")
    install_mcp(fastapi_app)

    @fastapi_app.get("/health", response_model=HealthRead, tags=["meta"])
    def health(db: Session = Depends(get_db)) -> HealthRead:
        """Liveness plus a database probe: 200 with `unreachable` signals a DB outage."""
        try:
            db.execute(text("select 1"))
            return HealthRead(status="ok", database="ok")
        except Exception:
            return HealthRead(status="ok", database="unreachable")


def create_app(container: KratosContainer | None = None) -> FastAPI:
    """Create and configure the Kratos FastAPI application from a container."""
    resolved_container = container if container is not None else build_container()
    fastapi_app = FastAPI(
        title="Kratos API",
        version=__version__,
        summary="Workout catalogue, plans, and logged sessions on Postgres.",
    )
    fastapi_app.state.container = resolved_container
    fastapi_app.add_middleware(NoCacheMiddleware)
    fastapi_app.add_exception_handler(EirUpstreamError, _handle_eir_upstream_error)
    _register_routes(fastapi_app)
    return fastapi_app


app = create_app()
