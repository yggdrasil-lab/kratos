"""Client error telemetry router for Kratos frontend."""

import logging

from fastapi import APIRouter, status

from app.schemas import ClientErrorCreate, ClientErrorResponse

logger = logging.getLogger("kratos.client_errors")

router = APIRouter(prefix="/client-errors", tags=["client-errors"])


@router.post("", response_model=ClientErrorResponse, status_code=status.HTTP_200_OK)
def log_client_error(payload: ClientErrorCreate) -> ClientErrorResponse:
    """Capture frontend errors and unhandled rejections in structured logs."""
    logger.error(
        "Client frontend error: %s [type=%s, source=%s, line=%s, col=%s, url=%s] Stack: %s User-Agent: %s Extra: %s",
        payload.message,
        payload.error_type or "unknown",
        payload.source or "unknown",
        payload.lineno,
        payload.colno,
        payload.url or "unknown",
        payload.stack or "none",
        payload.user_agent or "unknown",
        payload.extra,
        extra={"client_error": payload.model_dump()},
    )
    return ClientErrorResponse(status="ok")
