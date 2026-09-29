"""Iteration 16: Chapters CRUD + Continuity Sentinel backend tests."""
import os
import time
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    # Fallback for backend-only pytest runs — pull from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip().rstrip("/")
                break

EMAIL = "testwriter@example.com"
PASSWORD = "testpass123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def project(client):
    r = client.post(f"{BASE}/api/projects", json={"title": "TEST_iter16_project"}, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield pid
    # Cleanup
    try:
        client.delete(f"{BASE}/api/projects/{pid}", timeout=10)
    except Exception:
        pass


class TestChaptersCRUD:
    def test_list_empty(self, client, project):
        r = client.get(f"{BASE}/api/chapters", params={"project_id": project}, timeout=10)
        assert r.status_code == 200
        assert r.json() == []

    def test_create_chapter(self, client, project):
        r = client.post(f"{BASE}/api/chapters", json={"project_id": project, "title": "TEST_Chapter 1"}, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["title"] == "TEST_Chapter 1"
        assert data["project_id"] == project
        assert "id" in data
        assert data["order_index"] == 0
        pytest.chapter_id = data["id"]

        # Verify via list
        r2 = client.get(f"{BASE}/api/chapters", params={"project_id": project}, timeout=10)
        assert any(c["id"] == data["id"] for c in r2.json())

    def test_rename_chapter(self, client, project):
        cid = pytest.chapter_id
        r = client.patch(f"{BASE}/api/chapters/{cid}", json={"title": "TEST_Renamed"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["title"] == "TEST_Renamed"

        # verify persistence
        r2 = client.get(f"{BASE}/api/chapters", params={"project_id": project}, timeout=10)
        matched = [c for c in r2.json() if c["id"] == cid]
        assert matched and matched[0]["title"] == "TEST_Renamed"

    def test_move_scene_into_chapter(self, client, project):
        # Create a scene
        r = client.post(f"{BASE}/api/pages", json={
            "project_id": project, "kind": "scene", "title": "TEST_Scene A",
            "content": "Her eyes were pale green as the moss."
        }, timeout=10)
        assert r.status_code == 200
        page = r.json()
        pid = page["id"]
        pytest.page_a = pid
        assert page.get("chapter_id") in (None, "")

        # Move into chapter
        cid = pytest.chapter_id
        r2 = client.patch(f"{BASE}/api/pages/{pid}", json={"chapter_id": cid}, timeout=10)
        assert r2.status_code == 200
        assert r2.json().get("chapter_id") == cid

        # Verify via list (no single-page GET endpoint)
        r3 = client.get(f"{BASE}/api/pages", params={"project_id": project}, timeout=10)
        assert r3.status_code == 200
        matched = [p for p in r3.json() if p["id"] == pid]
        assert matched and matched[0].get("chapter_id") == cid

    def test_delete_chapter_unfiles_scenes(self, client, project):
        cid = pytest.chapter_id
        r = client.delete(f"{BASE}/api/chapters/{cid}", timeout=10)
        assert r.status_code == 200

        # Scene should still exist but chapter_id is None
        r2 = client.get(f"{BASE}/api/pages", params={"project_id": project}, timeout=10)
        assert r2.status_code == 200
        matched = [p for p in r2.json() if p["id"] == pytest.page_a]
        assert matched and matched[0].get("chapter_id") in (None, "")

        # Chapter is gone from list
        r3 = client.get(f"{BASE}/api/chapters", params={"project_id": project}, timeout=10)
        assert all(c["id"] != cid for c in r3.json())


class TestContinuitySentinel:
    def test_need_two_scenes(self, client, project):
        # Only 1 scene at this point (TEST_Scene A). Should return note.
        r = client.post(f"{BASE}/api/ai/continuity", json={"project_id": project}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["flags"] == []
        assert "two scenes" in (data.get("note") or "").lower()

    def test_scan_with_contradiction(self, client, project):
        # Add a contradicting scene
        r = client.post(f"{BASE}/api/pages", json={
            "project_id": project, "kind": "scene", "title": "TEST_Scene B",
            "content": "She squeezed her bright blue eyes shut against the storm."
        }, timeout=10)
        assert r.status_code == 200

        r2 = client.post(f"{BASE}/api/ai/continuity", json={"project_id": project}, timeout=60)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert "flags" in data
        assert data.get("scanned", 0) >= 2
        # Soft assert — Claude may or may not flag. Log what came back.
        print(f"Continuity flags returned: {data['flags']}")

    def test_bad_project(self, client):
        r = client.post(f"{BASE}/api/ai/continuity", json={"project_id": "nonexistent-id"}, timeout=15)
        assert r.status_code == 404
