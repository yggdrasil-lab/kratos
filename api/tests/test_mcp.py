"""Tests for the MCP endpoint at /mcp.

These speak the real streamable-HTTP protocol (JSON-RPC over POST) rather than
calling the tool functions directly, so they cover the parts that only break on
the wire: the mount path, the bearer-token guard, the session manager lifespan
and the tool schemas the server advertises.
"""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import config
from app.models import Exercise

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
    """POST one JSON-RPC message to /mcp and return the decoded reply.

    ``json_response=True`` on the server means the body comes back as
    application/json; the fallback handles an event-stream body in case the SDK
    negotiates SSE for a particular call.
    """
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
def authorized_client(client: TestClient, monkeypatch) -> TestClient:
    """A client whose MCP token is configured, so auth succeeds."""
    monkeypatch.setattr(config.settings, "mcp_token", "test-token")
    return client


def test_mcp_rejects_missing_and_wrong_tokens(client: TestClient, monkeypatch):
    monkeypatch.setattr(config.settings, "mcp_token", "test-token")

    missing = client.post(MCP_URL, json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert missing.status_code == 401
    assert missing.headers.get("WWW-Authenticate") == "Bearer"

    wrong = client.post(
        MCP_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"Authorization": "Bearer nope"},
    )
    assert wrong.status_code == 401


def test_mcp_fails_closed_when_token_is_unconfigured(client: TestClient, monkeypatch):
    """An unconfigured deployment must never serve tool calls."""
    monkeypatch.setattr(config.settings, "mcp_token", None)

    response = client.post(
        MCP_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"Authorization": "Bearer anything"},
    )
    assert response.status_code == 503


def test_mcp_guards_only_its_own_path(authorized_client: TestClient):
    """The REST API must not become bearer-gated by the MCP middleware."""
    assert authorized_client.get("/health").status_code == 200
    assert authorized_client.get("/exercises").status_code == 200


def test_mcp_initialize_and_lists_expected_tools(authorized_client: TestClient):
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
    }


def test_mcp_exercise_round_trip_tags_source(authorized_client: TestClient, db):
    _initialize(authorized_client)

    created = _call_tool(
        authorized_client,
        "exercise_create",
        {"name": "Back Squat", "tracking": "reps_weight", "primary_muscles": ["quads"]},
    )
    payload = json.loads(created["result"]["content"][0]["text"])
    assert payload["name"] == "Back Squat"
    assert payload["primary_muscles"] == ["quads"]

    # The write is visible to the REST layer and carries its provenance.
    row = db.execute(select(Exercise).where(Exercise.id == payload["id"])).scalar_one()
    assert row.extra["source"] == "agent"

    found = _call_tool(authorized_client, "exercise_search", {"muscle": "quads"})
    results = json.loads(found["result"]["content"][0]["text"])
    assert [item["id"] for item in results] == [payload["id"]]


def test_mcp_routine_with_items(authorized_client: TestClient):
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

    fetched = json.loads(
        _call_tool(authorized_client, "routine_get", {"routine_id": routine["id"]})[
            "result"
        ]["content"][0]["text"]
    )
    assert [item["position"] for item in fetched["items"]] == [1]
    assert fetched["items"][0]["exercise_id"] == exercise["id"]
