"""Kratos API entrypoint.

Serves the three domain groups — catalogue, plan, log — plus the derived reads.
The OpenAPI schema at /openapi.json is the contract the TypeScript client is
generated from, so response models are declared on every route.
"""

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import __version__
from app.config import settings
from app.db import get_db
from app.routers import biometrics, catalogue, client_errors, log, plan, stats
from app.routers.mcp import install_mcp
from app.schemas import HealthRead

app = FastAPI(
    title="Kratos API",
    version=__version__,
    summary="Workout catalogue, plans, and logged sessions on Postgres.",
)


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


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(NoCacheMiddleware)

app.include_router(catalogue.router)
app.include_router(plan.router)
app.include_router(plan.weekly_plan_router)
app.include_router(log.router)
app.include_router(stats.router)
app.include_router(biometrics.router)
app.include_router(client_errors.router)
app.include_router(client_errors.router, prefix="/api")

# The MCP endpoint at /mcp is not an APIRouter: it registers the SDK's own
# streamable-HTTP routes on this app and adds its bearer-token guard.
install_mcp(app)


@app.get("/health", response_model=HealthRead, tags=["meta"])
def health(db: Session = Depends(get_db)) -> HealthRead:
    """Liveness plus a database probe — a 200 with `unreachable` means the API is
    up but the schema or the connection is not, which is the failure worth seeing."""
    try:
        db.execute(text("select 1"))
        return HealthRead(status="ok", database="ok")
    except Exception:
        return HealthRead(status="ok", database="unreachable")
