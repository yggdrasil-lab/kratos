"""Tests for the MCP endpoint at /mcp.

These speak the real streamable-HTTP protocol (JSON-RPC over POST) rather than
calling the tool functions directly, so they cover the parts that only break on
the wire: the mount path, the bearer-token guard, the session manager lifespan,
container settings wiring, and the tool schemas the server advertises.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.models import Exercise, WeeklyPlan

MCP_URL = "/mcp"
PROTOCOL_VERSION = "2025-06-18"


def _rpc(
    client: TestClient,
    method: str,
    params: dict | None = None,
    *,
    token: str | None = "test-token",
    request_id: int = 1,
    notification: bool = False,
) -> Any:
    """POST one JSON-RPC message to /mcp and return the decoded reply."""
    body: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        body["params"] = params
    if not notification:
        body["id"] = request_id

    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"

    response = client.post(MCP_URL, json=body, headers=headers)
    assert response.status_code == 200, response.text

    content_type = response.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        for line in response.text.splitlines():
            if line.startswith("data:"):
                return json.loads(line[len("data:") :].strip())
        raise AssertionError(f"no data frame in event stream: {response.text!r}")
    return response.json()


def _initialize(client: TestClient) -> Any:
    return _rpc(
        client,
        "initialize",
        {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "kratos-tests", "version": "0.0.0"},
        },
    )


def _call_tool(client: TestClient, name: str, arguments: dict) -> Any:
    return _rpc(client, "tools/call", {"name": name, "arguments": arguments})


@pytest.fixture()
def authorized_client(app_factory) -> Iterator[TestClient]:
    """A TestClient whose container Settings carry an MCP bearer token."""
    with TestClient(app_factory(settings=Settings(mcp_token="test-token"))) as test_client:
        yield test_client


def test_mcp_rejects_missing_and_wrong_tokens(authorized_client: TestClient) -> None:
    missing = authorized_client.post(MCP_URL, json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert missing.status_code == 401
    assert missing.headers.get("WWW-Authenticate") == "Bearer"

    wrong = authorized_client.post(
        MCP_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"Authorization": "Bearer nope"},
    )
    assert wrong.status_code == 401


def test_mcp_fails_closed_when_token_is_unconfigured(app_factory) -> None:
    """An unconfigured deployment must never serve tool calls."""
    with TestClient(app_factory(settings=Settings(mcp_token=None))) as unconfigured_client:
        response = unconfigured_client.post(
            MCP_URL,
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
            headers={"Authorization": "Bearer anything"},
        )
        assert response.status_code == 503


def test_mcp_guards_only_its_own_path(authorized_client: TestClient) -> None:
    """The REST API must not become bearer-gated by the MCP middleware."""
    assert authorized_client.get("/health").status_code == 200
    assert authorized_client.get("/exercises").status_code == 200


def test_mcp_initialize_and_lists_expected_tools(authorized_client: TestClient) -> None:
    init = _initialize(authorized_client)
    assert init["result"]["serverInfo"]["name"] == "kratos"

    listed = _rpc(authorized_client, "tools/list")
    names = {tool["name"] for tool in listed["result"]["tools"]}
    assert names == {
        "exercise_search",
        "exercise_get",
        "exercise_create",
        "exercise_update",
        "exercise_note_add",
        "routine_list",
        "routine_get",
        "routine_create",
        "routine_update",
        "routine_item",
        "weekly_plan_get",
        "weekly_plan_set",
        "fasting_recommendation_get",
        "fasting_recommendation_adjust",
        "workout_recommendation_get",
        "workout_recommendation_adjust",
    }


def test_mcp_exercise_round_trip_tags_source(authorized_client: TestClient, db) -> None:
    _initialize(authorized_client)

    created = _call_tool(
        authorized_client,
        "exercise_create",
        {"name": "Back Squat", "tracking": "reps_weight", "primary_muscles": ["quads"]},
    )
    payload = json.loads(created["result"]["content"][0]["text"])
    assert payload["name"] == "Back Squat"
    assert payload["primary_muscles"] == ["quads"]

    row = db.execute(select(Exercise).where(Exercise.id == payload["id"])).scalar_one()
    assert row.extra["source"] == "agent"

    found = _call_tool(authorized_client, "exercise_search", {"muscle": "quads"})
    results = json.loads(found["result"]["content"][0]["text"])
    assert [item["id"] for item in results] == [payload["id"]]

    noted = _call_tool(
        authorized_client,
        "exercise_note_add",
        {"exercise_id": payload["id"], "note": "Keep brace tight"},
    )
    noted_payload = json.loads(noted["result"]["content"][0]["text"])
    assert noted_payload["notes"] == "Keep brace tight"
    assert noted_payload["extra"]["source"] == "agent"


def test_mcp_routine_with_items(authorized_client: TestClient) -> None:
    _initialize(authorized_client)

    exercise = json.loads(
        _call_tool(authorized_client, "exercise_create", {"name": "Deadlift"})["result"][
            "content"
        ][0]["text"]
    )

    routine = json.loads(
        _call_tool(
            authorized_client,
            "routine_create",
            {
                "name": "Pull Day",
                "items": [
                    {
                        "exercise_id": exercise["id"],
                        "position": 1,
                        "target_sets": 5,
                        "target_reps": 5,
                    }
                ],
            },
        )["result"]["content"][0]["text"]
    )
    assert routine["extra"]["source"] == "agent"

    fetched = json.loads(
        _call_tool(authorized_client, "routine_get", {"routine_id": routine["id"]})[
            "result"
        ]["content"][0]["text"]
    )
    assert [item["position"] for item in fetched["items"]] == [1]
    assert fetched["items"][0]["exercise_id"] == exercise["id"]


def test_mcp_weekly_plan_round_trip_and_source_provenance(
    authorized_client: TestClient, db
) -> None:
    _initialize(authorized_client)

    missing = json.loads(
        _call_tool(authorized_client, "weekly_plan_get", {"iso_week": "2026-W48"})[
            "result"
        ]["content"][0]["text"]
    )
    assert missing == {"iso_week": "2026-W48", "days": [], "notes": None, "exists": False}

    days = [
        {"dayIndex": 0, "sessionName": "Upper Body A", "type": "lift"},
        {"dayIndex": 2, "sessionName": "Badminton", "type": "cardio"},
    ]
    saved = json.loads(
        _call_tool(
            authorized_client,
            "weekly_plan_set",
            {"iso_week": "2026-W48", "days": days, "notes": "Deload week"},
        )["result"]["content"][0]["text"]
    )
    assert saved["status"] == "saved"
    assert saved["extra"]["source"] == "agent"
    assert saved["notes"] == "Deload week"

    fetched = json.loads(
        _call_tool(authorized_client, "weekly_plan_get", {"iso_week": "2026-W48"})[
            "result"
        ]["content"][0]["text"]
    )
    assert fetched["exists"] is True
    assert fetched["days"] == days
    assert fetched["extra"]["source"] == "agent"

    row = db.execute(select(WeeklyPlan).where(WeeklyPlan.iso_week == "2026-W48")).scalar_one()
    assert row.extra["source"] == "agent"


def test_mcp_duplicate_exercise_name_is_a_tool_error(authorized_client: TestClient) -> None:
    """A duplicate create over MCP fails loudly, as a tool error."""
    _initialize(authorized_client)

    first = _call_tool(authorized_client, "exercise_create", {"name": "Front Squat"})
    assert "result" in first and first["result"].get("isError") is not True

    duplicate = _call_tool(authorized_client, "exercise_create", {"name": "Front Squat"})
    assert duplicate["result"]["isError"] is True
    assert "already exists" in duplicate["result"]["content"][0]["text"]
