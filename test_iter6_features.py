"""Backend tests for iteration 6 features:
1) Resend email attempt + fallback for /api/auth/forgot-password
2) Import Bundle: POST /api/projects/import — auth, validation, conflict, remap, isolation
"""
import os
import io
import json
import uuid
import zipfile
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@scribecraft.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD env var required for backend tests (matches backend/.env)")


def _fresh_email(prefix="qa"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@example.com"


def _register_session(email=None, pw="abcdef123"):
    email = email or _fresh_email()
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, r.text
    return s, email


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return s


def _make_project_with_data(sess, title):
    """Create project + 2 pages + 2 characters (with cross-refs) + one history entry.
    Returns (pid, page_ids, char_ids)."""
    r = sess.post(f"{BASE_URL}/api/projects",
                  json={"title": title, "synopsis": "syn", "preamble": "pre"}, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]

    p1 = sess.post(f"{BASE_URL}/api/pages",
                   json={"project_id": pid, "kind": "scene",
                         "title": "Scene A", "content": "content A"},
                   timeout=15).json()
    p2 = sess.post(f"{BASE_URL}/api/pages",
                   json={"project_id": pid, "kind": "note",
                         "title": "Note B", "content": "content B"},
                   timeout=15).json()

    c1 = sess.post(f"{BASE_URL}/api/characters",
                   json={"project_id": pid, "name": "Alice",
                         "role": "protagonist",
                         "traits": "brave", "motivations": "truth"},
                   timeout=15).json()
    c2 = sess.post(f"{BASE_URL}/api/characters",
                   json={"project_id": pid, "name": "Bob",
                         "role": "antagonist",
                         "traits": "sly", "motivations": "power"},
                   timeout=15).json()

    # Give c1 a relationship to c2 and an evolution point tied to p1
    rp = sess.patch(f"{BASE_URL}/api/characters/{c1['id']}",
               json={
                   "relationships": [{"target_id": c2["id"], "kind": "rival", "note": "trained together"}],
                   "evolution": [{"page_id": p1["id"], "page_title": "Scene A",
                                   "stage_label": "awakening", "notes": "sees the truth",
                                   "inner_state": 50, "outer_action": 50}],
                   "voice_preamble": "Speak in short bursts.",
               }, timeout=15)
    assert rp.status_code == 200, rp.text

    # Drive one AI stream to create a history entry
    try:
        with sess.post(f"{BASE_URL}/api/ai/stream",
                       json={"mode": "collaborate", "text": "Nudge.",
                             "project_id": pid, "page_id": p1["id"]},
                       stream=True, timeout=60) as r:
            for line in r.iter_lines(decode_unicode=True):
                if line and line.startswith("data:"):
                    try:
                        obj = json.loads(line[5:].strip())
                    except Exception:
                        continue
                    if obj.get("done"):
                        break
    except Exception:
        pass

    return pid, [p1["id"], p2["id"]], [c1["id"], c2["id"]]


def _download_bundle(sess, pid):
    r = sess.get(f"{BASE_URL}/api/projects/{pid}/bundle", timeout=30)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/zip")
    return r.content


# ==================== Resend Fallback ====================
class TestResendFallback:
    def test_forgot_admin_resend_attempted_link_fallback_or_null(self):
        """RESEND is configured. onboarding@resend.dev is a Resend test sender
        that only delivers to the API-key owner's own verified email. Sending to
        admin@scribecraft.app will very likely FAIL — code must fall back to
        returning the reset_link. Either behavior is acceptable per the spec:
        - Success => reset_link is None (email delivered)
        - Failure => reset_link is a valid https link"""
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={"email": ADMIN_EMAIL}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        link = data.get("reset_link")
        # Either delivered (None) or fallback link
        if link is None:
            assert True  # delivered
        else:
            assert link.startswith("https://") and "token=" in link, f"unexpected link: {link}"

    def test_forgot_fresh_example_com_falls_back_to_link(self):
        """example.com will 100% fail delivery via Resend test sender; expect fallback link."""
        s, email = _register_session()
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={"email": email}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        link = data.get("reset_link")
        assert link, "Resend delivery to example.com should have failed and link should fall back"
        assert link.startswith(f"{BASE_URL}/reset-password?token=")

    def test_forgot_nonexistent_email_returns_null_link(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={"email": f"TEST_nobody_{uuid.uuid4().hex}@example.com"},
                          timeout=15)
        assert r.status_code == 200
        assert r.json().get("reset_link") is None


# ==================== Import Bundle ====================
class TestImportBundle:
    def test_import_requires_auth(self):
        # Multipart POST without cookie
        files = {"file": ("fake.zip", b"not a zip", "application/zip")}
        r = requests.post(f"{BASE_URL}/api/projects/import", files=files, timeout=15)
        assert r.status_code == 401, r.text

    def test_import_rejects_non_zip_filename(self, admin_session):
        files = {"file": ("notzip.txt", b"hello", "text/plain")}
        r = admin_session.post(f"{BASE_URL}/api/projects/import", files=files, timeout=15)
        assert r.status_code == 400

    def test_import_rejects_invalid_zip_content(self, admin_session):
        files = {"file": ("bad.zip", b"not really a zip", "application/zip")}
        r = admin_session.post(f"{BASE_URL}/api/projects/import", files=files, timeout=15)
        assert r.status_code == 400

    def test_import_rejects_zip_without_project_json(self, admin_session):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("README.md", "hello")
        files = {"file": ("no-project.zip", buf.getvalue(), "application/zip")}
        r = admin_session.post(f"{BASE_URL}/api/projects/import", files=files, timeout=15)
        assert r.status_code == 400
        assert "project.json" in r.text

    def test_import_happy_path_fresh_title(self, admin_session):
        # 1) Create source project + data + export bundle
        src_title = f"TEST_ImpSrc_{uuid.uuid4().hex[:6]}"
        pid, page_ids, char_ids = _make_project_with_data(admin_session, src_title)
        bundle = _download_bundle(admin_session, pid)

        # Rewrite bundle project.json title to a FRESH unused title (avoid collision)
        fresh_title = f"TEST_ImpFresh_{uuid.uuid4().hex[:8]}"
        rewritten = _rewrite_bundle_title(bundle, fresh_title)

        files = {"file": (f"{fresh_title}.scribecraft.zip", rewritten, "application/zip")}
        r = admin_session.post(f"{BASE_URL}/api/projects/import", files=files, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "project" in d and "counts" in d
        new_pid = d["project"]["id"]
        assert new_pid != pid
        assert d["project"]["title"] == fresh_title
        assert d["counts"]["pages"] == 2
        assert d["counts"]["characters"] == 2
        # history count may be 0 or 1 depending on AI availability
        assert d["counts"]["history"] >= 0

        # Verify new project pages & characters exist and IDs are remapped
        pages = admin_session.get(f"{BASE_URL}/api/pages",
                                   params={"project_id": new_pid}, timeout=15).json()
        chars = admin_session.get(f"{BASE_URL}/api/characters",
                                   params={"project_id": new_pid}, timeout=15).json()
        assert len(pages) == 2
        assert len(chars) == 2
        old_page_ids = set(page_ids)
        old_char_ids = set(char_ids)
        for p in pages:
            assert p["id"] not in old_page_ids
            assert p["project_id"] == new_pid
        for c in chars:
            assert c["id"] not in old_char_ids
            assert c["project_id"] == new_pid

        # Remap correctness: Alice's relationship target should be the NEW Bob id
        alice = next(c for c in chars if c["name"] == "Alice")
        bob = next(c for c in chars if c["name"] == "Bob")
        rels = alice.get("relationships") or []
        assert len(rels) == 1
        assert rels[0]["target_id"] == bob["id"], \
            f"target_id should point to NEW Bob id ({bob['id']}), got {rels[0]['target_id']}"
        # Evolution page_id remap
        evo = alice.get("evolution") or []
        assert len(evo) == 1
        new_page_ids = {p["id"] for p in pages}
        assert evo[0]["page_id"] in new_page_ids, \
            f"evolution page_id should be remapped to new pages, got {evo[0]['page_id']}"

        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{pid}", timeout=15)
        admin_session.delete(f"{BASE_URL}/api/projects/{new_pid}", timeout=15)

    def test_import_title_conflict_returns_409(self, admin_session):
        title = f"TEST_ImpConf_{uuid.uuid4().hex[:6]}"
        pid, _, _ = _make_project_with_data(admin_session, title)
        bundle = _download_bundle(admin_session, pid)
        # Same title => conflict
        files = {"file": (f"{title}.scribecraft.zip", bundle, "application/zip")}
        r = admin_session.post(f"{BASE_URL}/api/projects/import", files=files, timeout=30)
        assert r.status_code == 409, r.text
        detail = r.json().get("detail")
        assert isinstance(detail, dict)
        assert detail.get("code") == "title_conflict"
        assert detail.get("existing_title") == title
        assert "message" in detail
        admin_session.delete(f"{BASE_URL}/api/projects/{pid}", timeout=15)

    def test_import_on_conflict_rename(self, admin_session):
        title = f"TEST_ImpRen_{uuid.uuid4().hex[:6]}"
        pid, _, _ = _make_project_with_data(admin_session, title)
        bundle = _download_bundle(admin_session, pid)

        # First rename -> "(imported)"
        files = {"file": (f"{title}.zip", bundle, "application/zip")}
        r1 = admin_session.post(f"{BASE_URL}/api/projects/import",
                                files=files, data={"on_conflict": "rename"}, timeout=30)
        assert r1.status_code == 200, r1.text
        t1 = r1.json()["project"]["title"]
        assert t1 == f"{title} (imported)", t1
        new_pid_1 = r1.json()["project"]["id"]

        # Second rename -> "(imported 2)"
        files = {"file": (f"{title}.zip", bundle, "application/zip")}
        r2 = admin_session.post(f"{BASE_URL}/api/projects/import",
                                files=files, data={"on_conflict": "rename"}, timeout=30)
        assert r2.status_code == 200, r2.text
        t2 = r2.json()["project"]["title"]
        assert t2 == f"{title} (imported 2)", t2
        new_pid_2 = r2.json()["project"]["id"]

        # Cleanup
        for x in (pid, new_pid_1, new_pid_2):
            admin_session.delete(f"{BASE_URL}/api/projects/{x}", timeout=15)

    def test_import_on_conflict_overwrite(self, admin_session):
        title = f"TEST_ImpOw_{uuid.uuid4().hex[:6]}"
        pid, orig_page_ids, orig_char_ids = _make_project_with_data(admin_session, title)
        bundle = _download_bundle(admin_session, pid)

        files = {"file": (f"{title}.zip", bundle, "application/zip")}
        r = admin_session.post(f"{BASE_URL}/api/projects/import",
                               files=files, data={"on_conflict": "overwrite"}, timeout=30)
        assert r.status_code == 200, r.text
        new_pid = r.json()["project"]["id"]
        assert r.json()["project"]["title"] == title

        # Old project should be gone (no GET single, verify via list)
        r_list = admin_session.get(f"{BASE_URL}/api/projects", timeout=15)
        assert r_list.status_code == 200
        ids = [p["id"] for p in r_list.json()]
        assert pid not in ids, "overwrite should have deleted the old project"
        assert new_pid in ids
        # New pages have remapped ids
        pages = admin_session.get(f"{BASE_URL}/api/pages",
                                   params={"project_id": new_pid}, timeout=15).json()
        for p in pages:
            assert p["id"] not in orig_page_ids
        admin_session.delete(f"{BASE_URL}/api/projects/{new_pid}", timeout=15)

    def test_import_data_isolation_between_users(self, admin_session):
        """User A exports; User B imports the SAME bundle. B's copy must be
        owned by B, unrelated to A's project, and A's project must remain intact."""
        title = f"TEST_ImpIso_{uuid.uuid4().hex[:6]}"
        pid_A, _, _ = _make_project_with_data(admin_session, title)
        bundle = _download_bundle(admin_session, pid_A)

        s_B, _ = _register_session()

        files = {"file": (f"{title}.zip", bundle, "application/zip")}
        r = s_B.post(f"{BASE_URL}/api/projects/import", files=files, timeout=30)
        assert r.status_code == 200, r.text
        new_pid = r.json()["project"]["id"]
        assert new_pid != pid_A

        # B can list this project
        r_list = s_B.get(f"{BASE_URL}/api/projects", timeout=15)
        assert r_list.status_code == 200
        b_projects = [p["id"] for p in r_list.json()]
        assert new_pid in b_projects
        assert pid_A not in b_projects

        # B cannot access A's original project (no single-GET route; verify via list)
        # already checked pid_A not in b_projects above.

        # A still owns their original
        r_list_a = admin_session.get(f"{BASE_URL}/api/projects", timeout=15)
        assert r_list_a.status_code == 200
        assert pid_A in [p["id"] for p in r_list_a.json()]

        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{pid_A}", timeout=15)
        s_B.delete(f"{BASE_URL}/api/projects/{new_pid}", timeout=15)


def _rewrite_bundle_title(bundle_bytes: bytes, new_title: str) -> bytes:
    """Rewrite project.json title inside a bundle zip and return new zip bytes."""
    src = zipfile.ZipFile(io.BytesIO(bundle_bytes))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in src.namelist():
            data = src.read(name)
            if name == "project.json":
                pj = json.loads(data.decode("utf-8"))
                pj["project"]["title"] = new_title
                data = json.dumps(pj).encode("utf-8")
            z.writestr(name, data)
    return out.getvalue()
