"""Kratos API entrypoint.

Serves the three domain groups — catalogue, plan, log — plus the derived reads.
The OpenAPI schema at /openapi.json is the contract the TypeScript client is
generated from, so response models are declared on every route.
"""

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.config import settings
from app.db import get_db
from app.routers import catalogue, log, plan, stats
from app.schemas import HealthRead

app = FastAPI(
    title="Kratos API",
    version=__version__,
    summary="Workout catalogue, plans, and logged sessions on Postgres.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalogue.router)
app.include_router(plan.router)
app.include_router(log.router)
app.include_router(stats.router)


@app.get("/health", response_model=HealthRead, tags=["meta"])
def health(db: Session = Depends(get_db)) -> HealthRead:
    """Liveness plus a database probe — a 200 with `unreachable` means the API is
    up but the schema or the connection is not, which is the failure worth seeing."""
    try:
        db.execute(text("select 1"))
        return HealthRead(status="ok", database="ok")
    except Exception:
        return HealthRead(status="ok", database="unreachable")
