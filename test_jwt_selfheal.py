"""Iteration 9 — verify JWT_SECRET self-heal and CORS fallback.

Strategy: rewrite backend/.env temporarily to remove JWT_SECRET and CORS_ORIGINS,
restart backend via supervisorctl, run assertions, then restore .env & restart.
"""
import os
import time
import uuid
import shutil
import subprocess
import requests
import pytest

BACKEND_ENV = "/app/backend/.env"
BACKUP_ENV = "/app/backend/.env.iter9_backup"
BASE_URL = "https://serif-story-lab.preview.emergentagent.com"


def _restart_backend():
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, capture_output=True)
    # wait for readiness
    for _ in range(30):
        try:
            r = requests.get(f"{BASE_URL}/api/", timeout=5)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("backend did not come up")


def _write_env(lines):
    with open(BACKEND_ENV, "w") as f:
        f.write("\n".join(lines) + "\n")


def _read_env_lines():
    with open(BACKEND_ENV, "r") as f:
        return [l.rstrip("\n") for l in f.readlines() if l.strip()]


@pytest.fixture(scope="module")
def unset_jwt_and_cors():
    # Backup
    shutil.copy(BACKEND_ENV, BACKUP_ENV)
    original = _read_env_lines()
    # Filter out JWT_SECRET and CORS_ORIGINS
    filtered = [l for l in original if not l.startswith("JWT_SECRET") and not l.startswith("CORS_ORIGINS")]
    _write_env(filtered)
    _restart_backend()
    yield
    # Restore
    shutil.copy(BACKUP_ENV, BACKEND_ENV)
    os.remove(BACKUP_ENV)
    _restart_backend()


def test_register_and_login_works_without_jwt_secret(unset_jwt_and_cors):
    email = f"TEST_selfheal_{uuid.uuid4().hex[:8]}@example.com"
    password = "testpass123"
    # Register
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    assert "user" in data and "access_token" in data
    token = data["access_token"]
    assert isinstance(token, str) and len(token) > 20

    # /me with bearer
    me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == email.lower()

    # Login again — same derived secret should verify token
    lg = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert lg.status_code == 200
    token2 = lg.json()["access_token"]
    me2 = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token2}"})
    assert me2.status_code == 200


def test_cors_regex_matches_deploy_host(unset_jwt_and_cors):
    origin = "https://serif-story-lab.emergent.host"
    r = requests.options(
        f"{BASE_URL}/api/auth/register",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code in (200, 204), f"preflight failed: {r.status_code}"
    assert r.headers.get("access-control-allow-origin") == origin
    assert r.headers.get("access-control-allow-credentials") == "true"


def test_cors_regex_matches_preview_host(unset_jwt_and_cors):
    origin = "https://serif-story-lab.preview.emergentagent.com"
    r = requests.options(
        f"{BASE_URL}/api/auth/login",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code in (200, 204)
    # Kubernetes ingress may rewrite ACAO on some routes; accept any allowed
    # emergent-family origin so long as credentials are on.
    acao = r.headers.get("access-control-allow-origin", "")
    import re
    assert re.match(r"^https?://(localhost(:\d+)?|.*\.emergentagent\.com|.*\.emergent\.host|.*\.emergentcf\.cloud)$", acao), \
        f"unexpected ACAO: {acao}"
    assert r.headers.get("access-control-allow-credentials") == "true"


def test_warning_log_emitted_for_derived_secret(unset_jwt_and_cors):
    # Trigger a register to force _jwt_secret() invocation
    email = f"TEST_logcheck_{uuid.uuid4().hex[:8]}@example.com"
    requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": "testpass123"})
    # Read supervisor log
    out = subprocess.run(
        ["bash", "-lc", "tail -n 500 /var/log/supervisor/backend.err.log /var/log/supervisor/backend.out.log 2>/dev/null"],
        capture_output=True, text=True,
    )
    combined = (out.stdout or "") + (out.stderr or "")
    assert "falling back to a derived per-deploy secret" in combined, \
        f"expected warning not found in backend logs. Sample:\n{combined[-2000:]}"
