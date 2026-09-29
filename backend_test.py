"""Backend tests for ScribeCraft with cookie-based JWT auth.

Covers: auth (register/login/me/logout/google), guarded endpoints
(projects, pages, characters, settings, rituals, beats, ai stream/history,
preamble coach, project export), and user data isolation.
"""
import os
import uuid
import json
import time
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@scribecraft.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD env var required for backend tests (matches backend/.env)")


def _fresh_email(prefix="qa"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@example.com"


@pytest.fixture(scope="module")
def admin_session():
    """Session logged in as admin (cookies attached)."""
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    assert "access_token" in s.cookies, f"cookie not set. cookies={dict(s.cookies)}"
    return s


@pytest.fixture(scope="module")
def state():
    return {}


# -------- Health / basic guards --------
def test_health():
    r = requests.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_projects_unauth_401():
    r = requests.get(f"{BASE_URL}/api/projects", timeout=15)
    assert r.status_code == 401


def test_me_unauth_401():
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401


# -------- Auth: register --------
def test_register_success_and_duplicate():
    email = _fresh_email("reg")
    pw = "hunter2xyz"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": pw, "name": "Reg User"},
               timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "user" in data and "access_token" in data
    assert data["user"]["email"] == email.lower()
    assert "access_token" in s.cookies

    # Duplicate
    r2 = requests.post(f"{BASE_URL}/api/auth/register",
                       json={"email": email, "password": pw, "name": "Dup"},
                       timeout=15)
    assert r2.status_code == 400


def test_register_short_password_422():
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": _fresh_email("shortpw"), "password": "abc"},
                      timeout=15)
    assert r.status_code == 422


# -------- Auth: login --------
def test_login_admin_success(admin_session):
    # admin_session already logged in
    r = admin_session.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN_EMAIL


def test_login_wrong_password_401():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": "wrong-pass"},
                      timeout=15)
    assert r.status_code == 401


def test_login_invalid_email_format_422():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "notanemail", "password": "whatever"},
                      timeout=15)
    assert r.status_code == 422


# -------- Auth: google session (fake id -> 401 gracefully) --------
def test_google_session_invalid_401():
    r = requests.post(f"{BASE_URL}/api/auth/google/session",
                      json={"session_id": "definitely-not-real-" + uuid.uuid4().hex},
                      timeout=20)
    assert r.status_code == 401


# -------- Auth: logout clears cookie --------
def test_logout_clears_cookie():
    email = _fresh_email("logout")
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "abcdef123"}, timeout=15)
    assert r.status_code == 200
    r2 = s.get(f"{BASE_URL}/api/projects", timeout=15)
    assert r2.status_code == 200

    r3 = s.post(f"{BASE_URL}/api/auth/logout", timeout=15)
    assert r3.status_code == 200

    # Fresh jar (simulate cookie cleared client-side)
    s2 = requests.Session()
    r4 = s2.get(f"{BASE_URL}/api/projects", timeout=15)
    assert r4.status_code == 401


# -------- Data isolation --------
def test_data_isolation_between_users():
    a = requests.Session()
    b = requests.Session()
    ea, eb = _fresh_email("isoA"), _fresh_email("isoB")
    a.post(f"{BASE_URL}/api/auth/register",
           json={"email": ea, "password": "abcdef123"}, timeout=15).raise_for_status()
    b.post(f"{BASE_URL}/api/auth/register",
           json={"email": eb, "password": "abcdef123"}, timeout=15).raise_for_status()

    r = a.post(f"{BASE_URL}/api/projects",
               json={"title": "TEST_A_only", "synopsis": "s"}, timeout=15)
    assert r.status_code == 200
    a_pid = r.json()["id"]

    # B should not see A's project
    rb = b.get(f"{BASE_URL}/api/projects", timeout=15)
    assert rb.status_code == 200
    assert a_pid not in [p["id"] for p in rb.json()]

    # A can see it
    ra = a.get(f"{BASE_URL}/api/projects", timeout=15)
    assert a_pid in [p["id"] for p in ra.json()]


# -------- Guarded endpoints happy path (with admin cookie) --------
def test_create_project(admin_session, state):
    r = admin_session.post(f"{BASE_URL}/api/projects",
                           json={"title": "TEST_Novel", "synopsis": "s",
                                 "preamble": "Setting: neon-lit rooftops"},
                           timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["title"] == "TEST_Novel"
    assert d["preamble"] == "Setting: neon-lit rooftops"
    state["project_id"] = d["id"]


def test_patch_project_preamble(admin_session, state):
    r = admin_session.patch(f"{BASE_URL}/api/projects/{state['project_id']}",
                            json={"preamble": "Updated memory"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["preamble"] == "Updated memory"


def test_create_scene_and_note(admin_session, state):
    r = admin_session.post(f"{BASE_URL}/api/pages",
                           json={"project_id": state["project_id"], "kind": "scene",
                                 "title": "Scene 1", "content": "hello"}, timeout=15)
    assert r.status_code == 200
    state["scene1"] = r.json()["id"]
    r2 = admin_session.post(f"{BASE_URL}/api/pages",
                            json={"project_id": state["project_id"], "kind": "scene",
                                  "title": "Scene 2", "content": "world"}, timeout=15)
    assert r2.status_code == 200
    state["scene2"] = r2.json()["id"]
    r3 = admin_session.post(f"{BASE_URL}/api/pages",
                            json={"project_id": state["project_id"], "kind": "note",
                                  "title": "Note", "content": "n"}, timeout=15)
    assert r3.status_code == 200


def test_reorder_pages(admin_session, state):
    body = {"items": [
        {"id": state["scene1"], "order_index": 1},
        {"id": state["scene2"], "order_index": 0},
    ]}
    r = admin_session.post(f"{BASE_URL}/api/pages/reorder", json=body, timeout=15)
    assert r.status_code == 200
    r2 = admin_session.get(f"{BASE_URL}/api/pages",
                           params={"project_id": state["project_id"], "kind": "scene"},
                           timeout=15)
    scenes = r2.json()
    assert scenes[0]["id"] == state["scene2"]


def test_create_character(admin_session, state):
    r = admin_session.post(f"{BASE_URL}/api/characters",
                           json={"project_id": state["project_id"], "name": "Eve",
                                 "traits": "brave"}, timeout=15)
    assert r.status_code == 200
    state["char"] = r.json()["id"]


def test_settings(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/settings", timeout=15)
    assert r.status_code == 200
    payload = {
        "theme": "warm_sepia", "font_family": "cormorant",
        "font_size": 20, "line_height": 1.8, "letter_spacing": 0.05,
        "reduced_motion": True, "focus_mode": "paragraph",
        "timer_focus_min": 30, "timer_break_min": 6,
    }
    # user_id may be optional now with auth; include if server needs it
    current = r.json()
    payload["user_id"] = current.get("user_id", "")
    r2 = admin_session.put(f"{BASE_URL}/api/settings", json=payload, timeout=15)
    assert r2.status_code == 200, r2.text


def test_rituals_random():
    r = requests.get(f"{BASE_URL}/api/rituals/random", timeout=15)
    assert r.status_code == 200
    assert len(r.json().get("text", "")) > 5


def test_ai_beats(admin_session, state):
    body = {
        "scene_content": "Maya arrives at the abandoned cabin at dusk.",
        "existing_beats": [],
        "project_id": state["project_id"],
        "page_id": state["scene1"],
    }
    r = admin_session.post(f"{BASE_URL}/api/ai/beats", json=body, timeout=90)
    assert r.status_code == 200, r.text
    assert len(r.json().get("beats", [])) >= 3


def test_ai_stream_requires_auth():
    r = requests.post(f"{BASE_URL}/api/ai/stream",
                      json={"mode": "collaborate", "text": "hi",
                            "project_id": "x"}, timeout=15)
    assert r.status_code == 401


def test_ai_stream_with_cookie(admin_session, state):
    payload = {
        "mode": "collaborate",
        "text": "She kissed him hard and didn't look back.",
        "project_id": state["project_id"],
        "page_id": state["scene1"],
    }
    with admin_session.post(f"{BASE_URL}/api/ai/stream", json=payload,
                            stream=True, timeout=120) as r:
        assert r.status_code == 200
        assert "text/event-stream" in r.headers.get("content-type", "")
        done = None
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            try:
                obj = json.loads(line[5:].strip())
            except Exception:
                continue
            if "error" in obj:
                pytest.fail(f"stream error: {obj['error']}")
            if obj.get("done"):
                done = obj
                break
        assert done is not None
        assert len(done.get("output", "")) > 20


def test_ai_history_scoped(admin_session, state):
    r = admin_session.get(f"{BASE_URL}/api/ai/history",
                          params={"project_id": state["project_id"]}, timeout=15)
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_export_md_and_txt(admin_session, state):
    r = admin_session.get(f"{BASE_URL}/api/projects/{state['project_id']}/export",
                          params={"fmt": "md"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["filename"].endswith(".md")

    r2 = admin_session.get(f"{BASE_URL}/api/projects/{state['project_id']}/export",
                           params={"fmt": "txt"}, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["filename"].endswith(".txt")


def test_zz_delete_project(admin_session, state):
    r = admin_session.delete(f"{BASE_URL}/api/projects/{state['project_id']}",
                             timeout=15)
    assert r.status_code == 200
    r2 = admin_session.get(f"{BASE_URL}/api/pages",
                           params={"project_id": state["project_id"]}, timeout=15)
    assert r2.json() == []
