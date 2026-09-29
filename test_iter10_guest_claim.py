"""Iter10: Guest login + Claim account flow tests."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')


def _fresh_email(prefix="claim"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@example.com"


@pytest.fixture
def guest_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/guest", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["provider"] == "guest"
    assert data["user"]["user_id"].startswith("guest_")
    assert "access_token" in data
    assert "access_token" in s.cookies
    return s, data["user"]


# ---- Guest login ----
def test_guest_login_returns_guest_user_and_cookie():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/guest", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["provider"] == "guest"
    assert j["user"]["user_id"].startswith("guest_")
    assert "access_token" in s.cookies


def test_guest_me_returns_same_user(guest_session):
    s, user = guest_session
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 200
    me = r.json()
    assert me["user_id"] == user["user_id"]
    assert me["provider"] == "guest"


def test_guest_can_create_project(guest_session):
    s, user = guest_session
    r = s.post(f"{BASE_URL}/api/projects",
               json={"title": "Guest Book", "kind": "book"}, timeout=15)
    assert r.status_code in (200, 201), r.text
    pid = r.json().get("id") or r.json().get("project_id")
    assert pid
    # Fetch back
    r2 = s.get(f"{BASE_URL}/api/projects", timeout=15)
    assert r2.status_code == 200
    projects = r2.json()
    assert any((p.get("id") or p.get("project_id")) == pid for p in projects)


# ---- Claim flow ----
def test_claim_upgrades_guest_in_place_preserves_user_id_and_data(guest_session):
    s, user = guest_session
    # Create a project as guest
    rp = s.post(f"{BASE_URL}/api/projects",
                json={"title": "Pre-claim Book", "kind": "book"}, timeout=15)
    assert rp.status_code in (200, 201)
    pid = rp.json().get("id") or rp.json().get("project_id")

    # Claim
    email = _fresh_email("claim1")
    password = "claimpass123"
    r = s.post(f"{BASE_URL}/api/auth/claim",
               json={"email": email, "password": password, "name": "Claimed Writer"},
               timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["user_id"] == user["user_id"]  # same id
    assert data["user"]["provider"] == "email"
    assert data["user"]["email"] == email.lower()
    assert "access_token" in data

    # /me confirms
    r2 = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r2.status_code == 200
    assert r2.json()["provider"] == "email"
    assert r2.json()["email"] == email.lower()

    # Data preserved - project still there
    rp2 = s.get(f"{BASE_URL}/api/projects", timeout=15)
    assert rp2.status_code == 200
    projects = rp2.json()
    assert any((p.get("id") or p.get("project_id")) == pid for p in projects)

    # Can log in with new credentials
    s2 = requests.Session()
    rl = s2.post(f"{BASE_URL}/api/auth/login",
                 json={"email": email, "password": password}, timeout=15)
    assert rl.status_code == 200
    assert rl.json()["user"]["user_id"] == user["user_id"]


def test_claim_on_non_guest_returns_400():
    # First claim a guest to become email
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/guest", timeout=15)
    assert r.status_code == 200
    email = _fresh_email("claim2")
    r = s.post(f"{BASE_URL}/api/auth/claim",
               json={"email": email, "password": "abc123456", "name": "X"}, timeout=15)
    assert r.status_code == 200
    # Second claim on same (now email) user should 400
    email2 = _fresh_email("claim2b")
    r = s.post(f"{BASE_URL}/api/auth/claim",
               json={"email": email2, "password": "abc123456", "name": "Y"}, timeout=15)
    assert r.status_code == 400
    assert "already registered" in r.json().get("detail", "").lower()


def test_claim_to_existing_email_returns_400():
    # Register an email user
    s0 = requests.Session()
    existing_email = _fresh_email("existing")
    r = s0.post(f"{BASE_URL}/api/auth/register",
                json={"email": existing_email, "password": "abc123456", "name": "E"}, timeout=15)
    assert r.status_code == 200
    # Guest tries to claim that email
    sg = requests.Session()
    r = sg.post(f"{BASE_URL}/api/auth/guest", timeout=15)
    assert r.status_code == 200
    r = sg.post(f"{BASE_URL}/api/auth/claim",
                json={"email": existing_email, "password": "abc123456", "name": "G"}, timeout=15)
    assert r.status_code == 400
    assert "already registered" in r.json().get("detail", "").lower()
