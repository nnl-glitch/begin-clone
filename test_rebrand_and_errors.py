"""Tests for the 'Begin' rebrand + auth error strings.

Covers:
- GET /api/ returns service='Begin'
- Register duplicate returns detail 'That email is already registered'
- Login wrong password returns detail 'Incorrect email or password'
- Bundle export filename ends '.begin.zip' and README says 'Begin bundle'
- Bundle import accepts both .begin.zip and .scribecraft.zip
- Bundle import 400 error message mentions '.begin.zip'
"""
import io
import os
import uuid
import zipfile
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@scribecraft.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD env var required")


def _fresh_email(prefix="rb"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@example.com"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return s


# ---------- Rebrand ----------
def test_health_service_is_begin():
    r = requests.get(f"{BASE_URL}/api/", timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j.get("ok") is True
    assert j.get("service") == "Begin", f"expected service='Begin', got {j}"


# ---------- Register duplicate error detail ----------
def test_register_duplicate_error_message():
    email = _fresh_email("dup")
    pw = "hunter2xyz"
    r1 = requests.post(f"{BASE_URL}/api/auth/register",
                       json={"email": email, "password": pw}, timeout=15)
    assert r1.status_code == 200, r1.text
    r2 = requests.post(f"{BASE_URL}/api/auth/register",
                       json={"email": email, "password": pw}, timeout=15)
    assert r2.status_code == 400, r2.text
    detail = r2.json().get("detail")
    assert detail == "That email is already registered", f"detail was: {detail!r}"


# ---------- Login wrong pw detail ----------
def test_login_wrong_password_detail_string():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": "definitely-wrong"},
                      timeout=15)
    assert r.status_code == 401
    detail = r.json().get("detail")
    assert detail == "Incorrect email or password", f"detail was: {detail!r}"


# ---------- Bundle export filename + README ----------
def _make_min_project(sess, title):
    r = sess.post(f"{BASE_URL}/api/projects",
                  json={"title": title, "synopsis": "s", "preamble": "p"}, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    sess.post(f"{BASE_URL}/api/pages",
              json={"project_id": pid, "kind": "scene", "title": "S", "content": "hi"},
              timeout=15).raise_for_status()
    return pid


def test_bundle_filename_and_readme(admin_session):
    title = f"TEST_Rebrand_{uuid.uuid4().hex[:6]}"
    pid = _make_min_project(admin_session, title)
    try:
        r = admin_session.get(f"{BASE_URL}/api/projects/{pid}/bundle", timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/zip")
        cd = r.headers.get("content-disposition", "")
        assert ".begin.zip" in cd, f"content-disposition should include .begin.zip, got: {cd}"
        assert ".scribecraft.zip" not in cd

        z = zipfile.ZipFile(io.BytesIO(r.content))
        readme = z.read("README.md").decode()
        assert "Begin bundle" in readme, readme[:200]
        assert "ScribeCraft" not in readme
    finally:
        admin_session.delete(f"{BASE_URL}/api/projects/{pid}", timeout=15)


# ---------- Bundle import both filename shapes ----------
def test_import_accepts_begin_zip_and_legacy(admin_session):
    title = f"TEST_ImpDual_{uuid.uuid4().hex[:6]}"
    pid = _make_min_project(admin_session, title)
    r = admin_session.get(f"{BASE_URL}/api/projects/{pid}/bundle", timeout=30)
    bundle = r.content

    # Rewrite title so we don't conflict on re-import
    def _rewrite(bytes_, new_title):
        import json as _json
        src = zipfile.ZipFile(io.BytesIO(bytes_))
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for name in src.namelist():
                data = src.read(name)
                if name == "project.json":
                    pj = _json.loads(data.decode())
                    pj["project"]["title"] = new_title
                    data = _json.dumps(pj).encode()
                z.writestr(name, data)
        return out.getvalue()

    # (a) .begin.zip
    new_title_1 = f"{title}_begin_{uuid.uuid4().hex[:4]}"
    b1 = _rewrite(bundle, new_title_1)
    files = {"file": (f"{new_title_1}.begin.zip", b1, "application/zip")}
    r1 = admin_session.post(f"{BASE_URL}/api/projects/import", files=files, timeout=30)
    assert r1.status_code == 200, r1.text
    new_pid_1 = r1.json()["project"]["id"]

    # (b) legacy .scribecraft.zip
    new_title_2 = f"{title}_legacy_{uuid.uuid4().hex[:4]}"
    b2 = _rewrite(bundle, new_title_2)
    files = {"file": (f"{new_title_2}.scribecraft.zip", b2, "application/zip")}
    r2 = admin_session.post(f"{BASE_URL}/api/projects/import", files=files, timeout=30)
    assert r2.status_code == 200, r2.text
    new_pid_2 = r2.json()["project"]["id"]

    # Cleanup
    for x in (pid, new_pid_1, new_pid_2):
        admin_session.delete(f"{BASE_URL}/api/projects/{x}", timeout=15)


def test_import_non_zip_error_mentions_begin(admin_session):
    files = {"file": ("notzip.txt", b"hello", "text/plain")}
    r = admin_session.post(f"{BASE_URL}/api/projects/import", files=files, timeout=15)
    assert r.status_code == 400
    detail = r.json().get("detail", "")
    assert ".begin.zip" in detail, f"error should mention .begin.zip, got: {detail!r}"


# ---------- Reset email subject (static grep) ----------
def test_reset_email_subject_says_begin():
    with open("/app/backend/auth.py", "r") as f:
        src = f.read()
    assert "Reset your Begin password" in src
