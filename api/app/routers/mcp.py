"""MCP endpoint.

Implements the Model Context Protocol over a stateless HTTP transport.
Every message is a POST. Allows an agent session to update the catalogue and plans.
"""

from typing import Any
import uuid

from fastapi import APIRouter, Depends, Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.db import get_db
from app.config import settings
from app.routers.catalogue import (
    list_exercises, get_exercise, create_exercise, update_exercise
)
from app.routers.plan import (
    list_routines, get_routine, create_routine, update_routine
)
from app.schemas import ExerciseCreate, ExerciseUpdate, RoutineCreate, RoutineUpdate

router = APIRouter(prefix="/mcp", tags=["mcp"])

def _format_error(msg_id: int | str, code: int, message: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {"code": code, "message": message}
    }

def _format_success(msg_id: int | str, result: Any) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "result": result
    }

def _list_tools() -> dict:
    return {
        "tools": [
            {
                "name": "exercise_search",
                "description": "Find exercises by name, muscle, or equipment.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "muscle": {"type": "string"},
                        "tracking": {"type": "string"}
                    }
                }
            },
            {
                "name": "exercise_get",
                "description": "Get one exercise by ID with its muscles, notes and metadata",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "exercise_id": {"type": "string", "description": "UUID of the exercise"}
                    },
                    "required": ["exercise_id"]
                }
            },
            {
                "name": "exercise_create",
                "description": "Create a new exercise",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "primary_muscles": {"type": "array", "items": {"type": "string"}},
                        "notes": {"type": "string"}
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "exercise_update",
                "description": "Update an existing exercise",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "exercise_id": {"type": "string"},
                        "name": {"type": "string"},
                        "primary_muscles": {"type": "array", "items": {"type": "string"}},
                        "notes": {"type": "string"}
                    },
                    "required": ["exercise_id"]
                }
            },
            {
                "name": "routine_list",
                "description": "List all routine plans",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]
    }

async def _call_tool(name: str, arguments: dict, db: Session) -> dict:
    try:
        if name == "exercise_search":
            results = list_exercises(
                muscle=arguments.get("muscle"),
                tracking=arguments.get("tracking"),
                db=db
            )
            return {"content": [{"type": "text", "text": str([r.model_dump() for r in results])}]}
        
        elif name == "exercise_get":
            ex = get_exercise(uuid.UUID(arguments["exercise_id"]), db)
            return {"content": [{"type": "text", "text": str(ex.model_dump())}]}
        
        elif name == "exercise_create":
            payload = ExerciseCreate(**arguments)
            ex = create_exercise(payload, db)
            return {"content": [{"type": "text", "text": f"Created exercise: {ex.id} - {ex.name}"}]}
            
        elif name == "exercise_update":
            ex_id = uuid.UUID(arguments["exercise_id"])
            payload = ExerciseUpdate(**arguments)
            ex = update_exercise(ex_id, payload, db)
            return {"content": [{"type": "text", "text": f"Updated exercise: {ex.id}"}]}

        elif name == "routine_list":
            routines = list_routines(db=db)
            return {"content": [{"type": "text", "text": str([r.model_dump() for r in routines])}]}
            
        else:
            return {"isError": True, "content": [{"type": "text", "text": f"Unknown tool: {name}"}]}
            
    except Exception as e:
        return {"isError": True, "content": [{"type": "text", "text": str(e)}]}

security = HTTPBearer(auto_error=False)

def _verify_token(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> None:
    if settings.mcp_token:
        if not credentials or credentials.credentials != settings.mcp_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing token",
                headers={"WWW-Authenticate": "Bearer"},
            )

@router.post("", dependencies=[Depends(_verify_token)])
async def handle_mcp(request: Request, db: Session = Depends(get_db)):
    try:
        body = await request.json()
    except Exception:
        return _format_error(None, -32700, "Parse error")
        
    msg_id = body.get("id")
    method = body.get("method")
    
    if not method:
        return _format_error(msg_id, -32600, "Invalid Request")
        
    if method == "tools/list":
        return _format_success(msg_id, _list_tools())
        
    elif method == "tools/call":
        params = body.get("params", {})
        name = params.get("name")
        arguments = params.get("arguments", {})
        
        if not name:
            return _format_error(msg_id, -32602, "Invalid params: missing tool name")
            
        result = await _call_tool(name, arguments, db)
        return _format_success(msg_id, result)
        
    else:
        return _format_error(msg_id, -32601, f"Method not found: {method}")
