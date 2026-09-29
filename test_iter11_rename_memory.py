"""Iter 11 tests:
- Regression: /api/auth/guest, /register, /login, /forgot-password (used to 500 in prod)
- New: PATCH /api/ai/history/{id} title rename (owner ok, wrong-user 404, missing 404, empty clears)
- New: POST /api/ai/stream persists memory_used flag & emits it in done SSE payload
"""
import os
import re
import json
import uuid
import requests
import pytest

def _load_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass
    return ""

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env()).rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
API = f"{BASE_URL}/api"


def _mk_user():
    """Register a fresh email/password user and return (session, user, token)."""
    s = requests.Session()
    email = f"TEST_{uuid.uuid4().hex[:8]}@example.com"
    pw = "testpass123"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "TestUser"})
    assert r.status_code == 200, r.text
    data = r.json()
    return s, data["user"], data["access_token"]


# ---------- Regression: auth endpoints don't 500 ----------
class TestAuthRegression:
    def test_guest_login_200(self):
        r = requests.post(f"{API}/auth/guest")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        assert data["user"]["provider"] == "guest"

    def test_register_and_login_200(self):
        s = requests.Session()
        email = f"TEST_{uuid.uuid4().hex[:8]}@example.com"
        pw = "testpass123"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "Test"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["email"] == email.lower()
        # login again
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
        assert r2.status_code == 200, r2.text
        assert r2.json()["user"]["email"] == email.lower()

    def test_admin_login_200(self):
        r = requests.post(
            f"{API}/auth/login",
            json={"email": "admin@scribecraft.app", "password": "scribecraft-admin-2026"},
        )
        assert r.status_code == 200, r.text

    def test_forgot_password_200(self):
        r = requests.post(f"{API}/auth/forgot-password", json={"email": "nobody@example.com"})
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True


# ---------- Rename endpoint ----------
class TestHistoryRename:
    def _seed_history(self, s, uid, project_id=None):
        """Directly insert AI history record via stream endpoint is too slow; use a shortcut:
        create a project, then call the stream endpoint with a very short prompt to persist a record."""
        # We'll instead use the DB by calling the stream with a small prompt.
        # But that requires LLM. Alternative: use export path — not helpful.
        # Simplest reliable path: call stream and consume.
        return None

    def test_patch_rename_full_flow(self):
        s, user, token = _mk_user()
        # Create project (no preamble)
        p = s.post(f"{API}/projects", json={"title": "TEST_rename_proj"}).json()
        pid = p["id"]
        # Trigger a stream so a history row exists
        with s.post(
            f"{API}/ai/stream",
            json={"mode": "collaborate", "text": "Say 'ok' briefly.", "project_id": pid},
            stream=True,
            timeout=60,
        ) as resp:
            assert resp.status_code == 200
            history_id = None
            memory_used_flag = None
            for line in resp.iter_lines():
                if not line:
                    continue
                if line.startswith(b"data: "):
                    payload = json.loads(line[6:].decode())
                    if payload.get("done"):
                        history_id = payload.get("history_id")
                        memory_used_flag = payload.get("memory_used")
                        break
        assert history_id, "history_id missing in done payload"
        # memory_used should be False (no preamble)
        assert memory_used_flag is False, f"expected False, got {memory_used_flag}"

        # Rename → 200 with title
        r = s.patch(f"{API}/ai/history/{history_id}", json={"title": "Dawn scene"})
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "Dawn scene"

        # Verify persistence via GET history list
        lst = s.get(f"{API}/ai/history", params={"project_id": pid}).json()
        got = next((h for h in lst if h["id"] == history_id), None)
        assert got and got["title"] == "Dawn scene"
        assert got.get("memory_used") is False

        # Empty title clears to null
        r2 = s.patch(f"{API}/ai/history/{history_id}", json={"title": "   "})
        assert r2.status_code == 200
        assert r2.json()["title"] is None

        # Non-existent id → 404
        r3 = s.patch(f"{API}/ai/history/does-not-exist", json={"title": "x"})
        assert r3.status_code == 404

        # Wrong-user → 404
        s2, _, _ = _mk_user()
        r4 = s2.patch(f"{API}/ai/history/{history_id}", json={"title": "hack"})
        assert r4.status_code == 404

    def test_stream_memory_used_true_when_preamble(self):
        s, user, token = _mk_user()
        p = s.post(
            f"{API}/projects",
            json={"title": "TEST_memory_proj", "preamble": "This is a noir story set in 1920s Chicago."},
        ).json()
        pid = p["id"]
        with s.post(
            f"{API}/ai/stream",
            json={"mode": "analyze", "text": "The rain hit the window.", "project_id": pid},
            stream=True,
            timeout=60,
        ) as resp:
            assert resp.status_code == 200
            memory_used_flag = None
            history_id = None
            for line in resp.iter_lines():
                if not line:
                    continue
                if line.startswith(b"data: "):
                    payload = json.loads(line[6:].decode())
                    if payload.get("done"):
                        memory_used_flag = payload.get("memory_used")
                        history_id = payload.get("history_id")
                        break
        assert memory_used_flag is True, f"expected True, got {memory_used_flag}"
        # Verify persisted
        lst = s.get(f"{API}/ai/history", params={"project_id": pid}).json()
        got = next((h for h in lst if h["id"] == history_id), None)
        assert got and got["memory_used"] is True

    def test_stream_memory_used_false_no_project(self):
        s, _, _ = _mk_user()
        with s.post(
            f"{API}/ai/stream",
            json={"mode": "analyze", "text": "A short line."},
            stream=True,
            timeout=60,
        ) as resp:
            assert resp.status_code == 200
            memory_used_flag = None
            for line in resp.iter_lines():
                if not line:
                    continue
                if line.startswith(b"data: "):
                    payload = json.loads(line[6:].decode())
                    if payload.get("done"):
                        memory_used_flag = payload.get("memory_used")
                        break
        assert memory_used_flag is False
