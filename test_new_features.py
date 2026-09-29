"""Backend tests for iteration 4 features:
1) Password reset (forgot-password + reset-password)
2) Character voice presets (voice_preamble + character-voice-coach)
3) Speak-as injection into /api/ai/stream
4) Session export ZIP bundle
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


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin_project(admin_session):
    r = admin_session.post(f"{BASE_URL}/api/projects",
                           json={"title": "TEST_BundleProj", "synopsis": "syn",
                                 "preamble": "Setting: rain-soaked docks"}, timeout=15)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # Add a scene, note, character
    scene = admin_session.post(f"{BASE_URL}/api/pages",
                               json={"project_id": pid, "kind": "scene",
                                     "title": "Opening Scene",
                                     "content": "The lighthouse blinked twice."}, timeout=15).json()
    admin_session.post(f"{BASE_URL}/api/pages",
                       json={"project_id": pid, "kind": "note",
                             "title": "Lore", "content": "mermaids exist"}, timeout=15)
    char = admin_session.post(f"{BASE_URL}/api/characters",
                              json={"project_id": pid, "name": "Isolde",
                                    "role": "protagonist",
                                    "traits": "wry, guarded",
                                    "motivations": "find her sister"}, timeout=15).json()
    yield {"pid": pid, "scene_id": scene["id"], "char_id": char["id"]}
    admin_session.delete(f"{BASE_URL}/api/projects/{pid}", timeout=15)


# ==================== 1) Password Reset ====================
class TestPasswordReset:
    def test_forgot_existing_email_returns_link(self, admin_session):
        # Register a fresh user
        email = _fresh_email("reset")
        pw_old = "oldpass123"
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": pw_old}, timeout=15)
        assert r.status_code == 200

        # forgot-password
        r2 = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                           json={"email": email},
                           headers={"Origin": BASE_URL}, timeout=15)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data.get("ok") is True
        assert data.get("reset_link"), "reset_link should be non-null for existing email"
        assert "token=" in data["reset_link"]

        # Extract token
        token = data["reset_link"].split("token=")[1]

        # reset-password with short pw -> 422
        r_short = requests.post(f"{BASE_URL}/api/auth/reset-password",
                                json={"token": token, "new_password": "abc"}, timeout=15)
        assert r_short.status_code == 422, r_short.text

        # reset-password success
        pw_new = "newpass456"
        s2 = requests.Session()
        r3 = s2.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"token": token, "new_password": pw_new}, timeout=15)
        assert r3.status_code == 200, r3.text
        d = r3.json()
        assert "user" in d and "access_token" in d
        assert "access_token" in s2.cookies

        # /auth/me works with the returned cookie
        r_me = s2.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r_me.status_code == 200
        assert r_me.json()["email"] == email.lower()

        # Reusing the same token -> 400
        r_reuse = requests.post(f"{BASE_URL}/api/auth/reset-password",
                                json={"token": token, "new_password": "yetanotherpw"}, timeout=15)
        assert r_reuse.status_code == 400

        # Old password no longer works
        r_old = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": email, "password": pw_old}, timeout=15)
        assert r_old.status_code == 401

        # New password works
        r_new = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": email, "password": pw_new}, timeout=15)
        assert r_new.status_code == 200

    def test_forgot_reset_link_uses_public_app_url_not_untrusted_origin(self):
        # Register a fresh user
        email = _fresh_email("reset_origin")
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": "oldpass123"}, timeout=15)
        assert r.status_code == 200
        # Send an untrusted Origin — server must ignore it and use PUBLIC_APP_URL
        r2 = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                           json={"email": email},
                           headers={"Origin": "https://evil.example.com"}, timeout=15)
        assert r2.status_code == 200
        link = r2.json().get("reset_link") or ""
        assert link.startswith(f"{BASE_URL}/reset-password?token="), \
            f"reset_link should be built from PUBLIC_APP_URL, got: {link}"

    def test_forgot_nonexistent_email_no_enumeration(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={"email": f"TEST_nobody_{uuid.uuid4().hex}@example.com"},
                          timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert data.get("reset_link") is None


# ==================== 2) Character voice presets ====================
class TestCharacterVoice:
    def test_character_has_voice_preamble_default_empty(self, admin_session, admin_project):
        # New char from fixture should have voice_preamble=''
        r = admin_session.get(f"{BASE_URL}/api/characters",
                              params={"project_id": admin_project["pid"]}, timeout=15)
        assert r.status_code == 200
        chars = r.json()
        target = next((c for c in chars if c["id"] == admin_project["char_id"]), None)
        assert target is not None
        assert target.get("voice_preamble", None) == ""

    def test_patch_and_get_voice_preamble(self, admin_session, admin_project):
        vp = "speak in bruised half-sentences"
        r = admin_session.patch(f"{BASE_URL}/api/characters/{admin_project['char_id']}",
                                json={"voice_preamble": vp}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["voice_preamble"] == vp

        r2 = admin_session.get(f"{BASE_URL}/api/characters",
                               params={"project_id": admin_project["pid"]}, timeout=15)
        target = next(c for c in r2.json() if c["id"] == admin_project["char_id"])
        assert target["voice_preamble"] == vp

    def test_character_voice_coach_returns_nonempty(self, admin_session, admin_project):
        r = admin_session.post(f"{BASE_URL}/api/ai/character-voice-coach",
                               json={"character_id": admin_project["char_id"]},
                               timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "voice_preamble" in d
        assert isinstance(d["voice_preamble"], str)
        assert len(d["voice_preamble"]) > 20

    def test_character_voice_isolation_between_users(self, admin_project):
        # Register a different user and try to fetch/coach the admin's character
        email = _fresh_email("iso")
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "abcdef123"}, timeout=15).raise_for_status()
        r = s.post(f"{BASE_URL}/api/ai/character-voice-coach",
                   json={"character_id": admin_project["char_id"]}, timeout=30)
        assert r.status_code == 404


# ==================== 3) Speak-as injection ====================
class TestSpeakAsStream:
    def _drain_stream(self, resp):
        done = None
        for line in resp.iter_lines(decode_unicode=True):
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
        return done

    def test_stream_with_speak_as(self, admin_session, admin_project):
        # Ensure character has a voice_preamble
        admin_session.patch(f"{BASE_URL}/api/characters/{admin_project['char_id']}",
                            json={"voice_preamble": "Speak in wry, clipped fragments."},
                            timeout=15)
        payload = {
            "mode": "collaborate",
            "text": "Tell me about the storm outside.",
            "project_id": admin_project["pid"],
            "page_id": admin_project["scene_id"],
            "speak_as_character_id": admin_project["char_id"],
        }
        with admin_session.post(f"{BASE_URL}/api/ai/stream", json=payload,
                                stream=True, timeout=120) as r:
            assert r.status_code == 200
            done = self._drain_stream(r)
            assert done is not None
            assert len(done.get("output", "")) > 20

    def test_stream_with_bad_speak_as_still_works(self, admin_session, admin_project):
        payload = {
            "mode": "collaborate",
            "text": "Short reply please.",
            "project_id": admin_project["pid"],
            "page_id": admin_project["scene_id"],
            "speak_as_character_id": "does-not-exist-" + uuid.uuid4().hex,
        }
        with admin_session.post(f"{BASE_URL}/api/ai/stream", json=payload,
                                stream=True, timeout=120) as r:
            assert r.status_code == 200
            done = self._drain_stream(r)
            assert done is not None


# ==================== 4) Bundle export .zip ====================
class TestBundleExport:
    def test_bundle_unauth_401(self, admin_project):
        r = requests.get(f"{BASE_URL}/api/projects/{admin_project['pid']}/bundle", timeout=15)
        assert r.status_code == 401

    def test_bundle_missing_project_404(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/projects/does-not-exist/bundle", timeout=15)
        assert r.status_code == 404

    def test_bundle_other_user_404(self, admin_project):
        email = _fresh_email("bundleother")
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "abcdef123"}, timeout=15).raise_for_status()
        r = s.get(f"{BASE_URL}/api/projects/{admin_project['pid']}/bundle", timeout=15)
        assert r.status_code == 404

    def test_bundle_contents(self, admin_session, admin_project):
        # ensure voice_preamble is set for cast.md check
        admin_session.patch(f"{BASE_URL}/api/characters/{admin_project['char_id']}",
                            json={"voice_preamble": "Speak in wry, clipped fragments."},
                            timeout=15)
        # ensure history exists
        with admin_session.post(f"{BASE_URL}/api/ai/stream",
                                json={"mode": "collaborate",
                                      "text": "Just a tiny nudge please.",
                                      "project_id": admin_project["pid"],
                                      "page_id": admin_project["scene_id"]},
                                stream=True, timeout=120) as r:
            for line in r.iter_lines(decode_unicode=True):
                if line and line.startswith("data:"):
                    try:
                        obj = json.loads(line[5:].strip())
                    except Exception:
                        continue
                    if obj.get("done"):
                        break

        r = admin_session.get(f"{BASE_URL}/api/projects/{admin_project['pid']}/bundle",
                              timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/zip")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd and ".zip" in cd

        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = set(z.namelist())
        for expected in ["README.md", "manuscript.md", "manuscript.txt",
                         "notes.md", "cast.md", "companion-history.md",
                         "project.json"]:
            assert expected in names, f"missing {expected}"
            assert len(z.read(expected)) > 0, f"{expected} is empty"

        manuscript = z.read("manuscript.md").decode()
        assert "Opening Scene" in manuscript
        assert "lighthouse blinked twice" in manuscript

        cast = z.read("cast.md").decode()
        assert "Isolde" in cast
        assert "wry, clipped fragments" in cast

        hist = z.read("companion-history.md").decode()
        assert "Companion history" in hist
        # There was at least one run
        assert "Collaborate" in hist or "no Companion runs yet" not in hist

        # project.json parses
        pj = json.loads(z.read("project.json").decode())
        assert pj["project"]["id"] == admin_project["pid"]
