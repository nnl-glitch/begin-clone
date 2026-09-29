"""Authentication for ScribeCraft.

Supports two flows that coexist:
  1. Emergent-managed Google OAuth — session_token stored in Mongo `user_sessions`
     and set as an httpOnly cookie `session_token`.
  2. Custom Email/Password — bcrypt hashed passwords, JWT access token stored
     as httpOnly cookie `access_token` (fallback: Authorization: Bearer <jwt>).

Both flows populate a MongoDB `users` collection where the canonical id is the
string `user_id` (never MongoDB's _id).
"""
from __future__ import annotations

import os
import uuid
import secrets
import hashlib
import logging
import bcrypt
import jwt
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

logger = logging.getLogger("scribecraft.auth")

from emailer import send_email, render_reset_email, is_email_enabled

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 24 * 7  # 7 days — writing app, comfortable session
SESSION_TOKEN_DAYS = 7
EMERGENT_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

# Cached JWT secret. Prefer explicit env; otherwise derive a stable per-deploy
# value from other env pieces so the app never 500s on missing config. We warn
# loudly so operators know to set a proper JWT_SECRET.
_JWT_SECRET_CACHE: Optional[str] = None

# ---------- Models ----------

class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=200)
    name: Optional[str] = None


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class GoogleSessionBody(BaseModel):
    session_id: str


class ClaimAccountBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=200)
    name: Optional[str] = None


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str = Field(min_length=6, max_length=200)


class PublicUser(BaseModel):
    user_id: str
    email: str
    name: str = ""
    picture: str = ""
    provider: str = "email"


# ---------- Helpers ----------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _jwt_secret() -> str:
    global _JWT_SECRET_CACHE
    if _JWT_SECRET_CACHE:
        return _JWT_SECRET_CACHE
    explicit = (os.environ.get("JWT_SECRET") or "").strip()
    if explicit:
        _JWT_SECRET_CACHE = explicit
        return _JWT_SECRET_CACHE
    # Derive a stable per-deploy secret from MONGO_URL so cookies survive
    # restarts without needing manual config. This is a self-heal fallback,
    # not a substitute for a real JWT_SECRET env var — log a big warning.
    mongo = os.environ.get("MONGO_URL", "")
    db = os.environ.get("DB_NAME", "")
    if not mongo:
        # Absolute last resort: ephemeral in-memory secret. Tokens die on restart.
        _JWT_SECRET_CACHE = secrets.token_hex(32)
        logger.warning(
            "[jwt] Neither JWT_SECRET nor MONGO_URL is set — using an EPHEMERAL "
            "in-memory secret. Sessions will invalidate on every restart. "
            "Set JWT_SECRET in the environment to fix."
        )
        return _JWT_SECRET_CACHE
    _JWT_SECRET_CACHE = hashlib.sha256(f"begin:{mongo}:{db}".encode("utf-8")).hexdigest()
    logger.warning(
        "[jwt] JWT_SECRET env var not set — falling back to a derived per-deploy "
        "secret. Please set JWT_SECRET in the deployment environment for a real "
        "cryptographic key."
    )
    return _JWT_SECRET_CACHE


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": _now() + timedelta(minutes=ACCESS_TOKEN_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def _set_cookie(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        key=name,
        value=value,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=max_age,
        path="/",
    )


def _clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(key=name, path="/", samesite="none", secure=True)


def _sanitize_user(doc: dict) -> dict:
    return {
        "user_id": doc["user_id"],
        "email": doc.get("email", ""),
        "name": doc.get("name", ""),
        "picture": doc.get("picture", ""),
        "provider": doc.get("provider", "email"),
    }


# ---------- Current-user dependency factory ----------

def make_auth_deps(db):
    """Return (get_current_user, get_current_user_id) closures bound to `db`."""

    async def _user_from_session_cookie(token: str) -> Optional[dict]:
        sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if not sess:
            return None
        expires_at = sess.get("expires_at")
        if isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at)
            except Exception:
                return None
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at < _now():
            return None
        user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
        return user

    async def _user_from_jwt(token: str) -> Optional[dict]:
        try:
            payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Session expired")
        except jwt.InvalidTokenError:
            return None
        if payload.get("type") != "access":
            return None
        user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
        return user

    async def get_current_user(request: Request) -> dict:
        # 1. Emergent session cookie (Google flow)
        session_cookie = request.cookies.get("session_token")
        if session_cookie:
            u = await _user_from_session_cookie(session_cookie)
            if u:
                return u
        # 2. Custom JWT access-token cookie
        access_cookie = request.cookies.get("access_token")
        if access_cookie:
            u = await _user_from_jwt(access_cookie)
            if u:
                return u
        # 3. Authorization: Bearer <token>  — bearer can be either kind
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            u = await _user_from_jwt(token)
            if u:
                return u
            u = await _user_from_session_cookie(token)
            if u:
                return u
        raise HTTPException(status_code=401, detail="Not authenticated")

    async def get_current_user_id(user: dict = Depends(get_current_user)) -> str:
        return user["user_id"]

    return get_current_user, get_current_user_id


# ---------- Router factory ----------

def build_auth_router(db) -> APIRouter:
    router = APIRouter(prefix="/auth", tags=["auth"])
    get_current_user, _ = make_auth_deps(db)

    async def _ensure_indexes():
        """Best-effort index creation. Some deployed Mongo instances refuse
        createIndex (permissions, existing index with different options, etc.)
        which would 500 every auth request if raised. We tolerate those and
        keep the app working — reads/writes still function without the
        indexes, they just aren't uniqueness-enforced at the DB layer."""
        _index_specs = [
            (db.users, "email", {"unique": True}),
            (db.users, "user_id", {"unique": True}),
            (db.user_sessions, "session_token", {"unique": True}),
            (db.user_sessions, "user_id", {}),
            (db.password_reset_tokens, "expires_at", {"expireAfterSeconds": 0}),
            (db.password_reset_tokens, "token", {"unique": True}),
        ]
        for coll, key, opts in _index_specs:
            try:
                await coll.create_index(key, **opts)
            except Exception as e:
                logger.warning(
                    "[auth] Skipping index %s on %s: %s",
                    key, coll.name, e,
                )

    async def _upsert_google_user(payload: dict) -> dict:
        email = (payload.get("email") or "").lower().strip()
        if not email:
            raise HTTPException(400, "Google session missing email")
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            # keep name/picture fresh
            updates = {
                "name": payload.get("name") or existing.get("name", ""),
                "picture": payload.get("picture") or existing.get("picture", ""),
                "updated_at": _now().isoformat(),
            }
            await db.users.update_one({"user_id": existing["user_id"]}, {"$set": updates})
            return {**existing, **updates}
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        doc = {
            "user_id": user_id,
            "email": email,
            "name": payload.get("name") or "",
            "picture": payload.get("picture") or "",
            "provider": "google",
            "created_at": _now().isoformat(),
            "updated_at": _now().isoformat(),
        }
        await db.users.insert_one(doc)
        return doc

    @router.post("/register")
    async def register(body: RegisterBody, response: Response):
        await _ensure_indexes()
        email = body.email.lower().strip()
        if await db.users.find_one({"email": email}):
            raise HTTPException(400, "That email is already registered")
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        doc = {
            "user_id": user_id,
            "email": email,
            "name": (body.name or email.split("@")[0]).strip(),
            "picture": "",
            "password_hash": hash_password(body.password),
            "provider": "email",
            "created_at": _now().isoformat(),
            "updated_at": _now().isoformat(),
        }
        await db.users.insert_one(doc)
        token = create_access_token(user_id, email)
        _set_cookie(response, "access_token", token, ACCESS_TOKEN_MINUTES * 60)
        return {"user": _sanitize_user(doc), "access_token": token}

    @router.post("/login")
    async def login(body: LoginBody, response: Response):
        email = body.email.lower().strip()
        user = await db.users.find_one({"email": email})
        if not user or not user.get("password_hash"):
            raise HTTPException(401, "Incorrect email or password")
        if not verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "Incorrect email or password")
        token = create_access_token(user["user_id"], email)
        _set_cookie(response, "access_token", token, ACCESS_TOKEN_MINUTES * 60)
        return {"user": _sanitize_user(user), "access_token": token}

    @router.post("/logout")
    async def logout(request: Request, response: Response):
        # Best-effort: clear any session token from Mongo, and drop cookies.
        sess_token = request.cookies.get("session_token")
        if sess_token:
            await db.user_sessions.delete_one({"session_token": sess_token})
        _clear_cookie(response, "access_token")
        _clear_cookie(response, "session_token")
        return {"ok": True}

    @router.get("/me")
    async def me(user: dict = Depends(get_current_user)):
        return _sanitize_user(user)

    @router.post("/google/session")
    async def google_session(body: GoogleSessionBody, response: Response):
        await _ensure_indexes()
        # Exchange session_id for user data via Emergent auth backend.
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(
                    EMERGENT_SESSION_DATA_URL,
                    headers={"X-Session-ID": body.session_id},
                )
                r.raise_for_status()
                payload = r.json()
        except httpx.HTTPError as e:
            raise HTTPException(401, f"Google session invalid: {e}")

        user = await _upsert_google_user(payload)
        session_token = payload.get("session_token")
        if not session_token:
            raise HTTPException(401, "Google session missing token")

        expires_at = _now() + timedelta(days=SESSION_TOKEN_DAYS)
        await db.user_sessions.update_one(
            {"session_token": session_token},
            {"$set": {
                "user_id": user["user_id"],
                "session_token": session_token,
                "expires_at": expires_at.isoformat(),
                "created_at": _now().isoformat(),
            }},
            upsert=True,
        )
        _set_cookie(response, "session_token", session_token, SESSION_TOKEN_DAYS * 24 * 60 * 60)
        return {"user": _sanitize_user(user)}

    # ------------------------------------------------------------------
    # Direct Google OAuth (post-migration)
    # ------------------------------------------------------------------
    # Activates when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set as env
    # vars. Leaves the Emergent-managed /google/session flow untouched, so the
    # current preview keeps working; the new host just sets the env vars.
    #
    # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS,
    # THIS BREAKS THE AUTH. The redirect_uri is derived at runtime from the
    # frontend origin so it matches whatever URI the writer added to the
    # Google Cloud Console.
    from fastapi.responses import RedirectResponse
    from urllib.parse import urlencode

    def _google_oauth_enabled() -> bool:
        return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))

    def _google_state(origin: str) -> str:
        # Short-lived signed state: JWT with the origin so the callback can
        # bounce back to the same frontend. Prevents CSRF (state can't be
        # forged) and pins the redirect target.
        payload = {"origin": origin, "exp": _now() + timedelta(minutes=10), "type": "google_state"}
        return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)

    def _verify_google_state(token: str) -> Optional[str]:
        try:
            payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
            if payload.get("type") != "google_state": return None
            return payload.get("origin")
        except jwt.PyJWTError:
            return None

    @router.get("/google/init")
    async def google_init(request: Request):
        """Kicks off the standard Google OAuth code flow.

        Returns { authorize_url } — frontend should redirect the browser there.
        Google will bounce back to /api/auth/google/callback with ?code=…&state=….
        """
        if not _google_oauth_enabled():
            raise HTTPException(503, "Direct Google OAuth is not configured on this deployment")
        origin = request.headers.get("Origin") or (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
        if not origin:
            raise HTTPException(400, "Missing Origin header")
        # The redirect_uri Google calls back to. Must be added verbatim in the
        # Google Cloud Console → Authorized redirect URIs list.
        redirect_uri = f"{origin.rstrip('/')}/auth/google"
        params = {
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "online",
            "prompt": "select_account",
            "state": _google_state(origin.rstrip("/")),
        }
        return {"authorize_url": f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"}

    @router.post("/google/callback")
    async def google_callback(body: dict, response: Response):
        """Exchanges the Google auth code for an id_token, upserts the user,
        and issues our own JWT access-token cookie (same shape as email login).
        Body: { code: str, state: str, redirect_uri: str }
        """
        if not _google_oauth_enabled():
            raise HTTPException(503, "Direct Google OAuth is not configured on this deployment")
        await _ensure_indexes()
        code = (body or {}).get("code")
        state = (body or {}).get("state")
        redirect_uri = (body or {}).get("redirect_uri")
        if not code or not state or not redirect_uri:
            raise HTTPException(400, "Missing code/state/redirect_uri")
        origin_from_state = _verify_google_state(state)
        if not origin_from_state or not redirect_uri.startswith(origin_from_state):
            raise HTTPException(400, "Invalid OAuth state")

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                token_res = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": os.environ["GOOGLE_CLIENT_ID"],
                        "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                        "code": code,
                        "grant_type": "authorization_code",
                        "redirect_uri": redirect_uri,
                    },
                )
                token_res.raise_for_status()
                tok = token_res.json()
                id_token = tok.get("id_token")
                access_token = tok.get("access_token")
                if not id_token or not access_token:
                    raise HTTPException(401, "Google did not return an id_token")

                # Fetch the userinfo — cleaner than parsing the JWT ourselves.
                user_res = await client.get(
                    "https://openidconnect.googleapis.com/v1/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                user_res.raise_for_status()
                info = user_res.json()
        except httpx.HTTPError as e:
            raise HTTPException(401, f"Google OAuth failed: {e}")

        payload = {
            "email": info.get("email", ""),
            "name": info.get("name", ""),
            "picture": info.get("picture", ""),
        }
        user = await _upsert_google_user(payload)
        # Issue OUR jwt access token (same as email login), not Google's.
        access = create_access_token(user["user_id"], user["email"])
        _set_cookie(response, "access_token", access, ACCESS_TOKEN_MINUTES * 60)
        return {"user": _sanitize_user(user)}

    @router.post("/forgot-password")
    async def forgot_password(body: ForgotPasswordBody, request: Request):
        """Generate a single-use reset token. Always returns success so the
        endpoint cannot be used to enumerate registered emails."""
        await _ensure_indexes()
        email = body.email.lower().strip()
        user = await db.users.find_one({"email": email}, {"_id": 0})
        # For dev/testing convenience we ALWAYS return the reset link when the
        # email exists — a real email integration would send it instead.
        reset_link = None
        if user and user.get("provider", "email") == "email":
            token = secrets.token_urlsafe(32)
            expires_at = _now() + timedelta(hours=1)
            await db.password_reset_tokens.insert_one({
                "token": token,
                "user_id": user["user_id"],
                "email": email,
                "expires_at": expires_at,
                "created_at": _now(),
                "used": False,
            })
            # Build a reset link using the trusted public app URL. We only fall
            # back to Origin if PUBLIC_APP_URL isn't set (dev/local).
            public_url = (os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
            if not public_url:
                origin = request.headers.get("Origin") or ""
                # Only trust the Origin if it's in our CORS whitelist.
                allowed = {o.strip().rstrip("/") for o in (os.environ.get("CORS_ORIGINS") or "").split(",") if o.strip()}
                if origin.rstrip("/") in allowed:
                    public_url = origin.rstrip("/")
            reset_link = f"{public_url}/reset-password?token={token}" if public_url else f"/reset-password?token={token}"
            logger.info(f"[password-reset] {email} -> {reset_link}")

            # If Resend is configured, send the real email and hide the dev preview link.
            if is_email_enabled():
                html, text = render_reset_email(reset_link, email)
                sent = await send_email(
                    to=email,
                    subject="Reset your Begin password",
                    html=html,
                    text=text,
                )
                if sent:
                    reset_link = None  # Hide from API response — writer will use the emailed link.

        # Uniform response — regardless of whether the email exists or was sent.
        return {
            "ok": True,
            "message": (
                "If that email is registered, a reset link is on its way."
                if is_email_enabled()
                else "If that email is registered, a reset link is on its way."
            ),
            # dev-only: link surfaces only when email delivery is disabled.
            "reset_link": reset_link,
        }

    @router.post("/reset-password")
    async def reset_password(body: ResetPasswordBody, response: Response):
        rec = await db.password_reset_tokens.find_one({"token": body.token}, {"_id": 0})
        if not rec or rec.get("used"):
            raise HTTPException(400, "This reset link is no longer valid")
        expires_at = rec.get("expires_at")
        if isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at)
            except Exception:
                raise HTTPException(400, "This reset link is no longer valid")
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at < _now():
            raise HTTPException(400, "This reset link has expired — request a new one")
        user = await db.users.find_one({"user_id": rec["user_id"]})
        if not user:
            raise HTTPException(400, "Account not found")
        await db.users.update_one(
            {"user_id": rec["user_id"]},
            {"$set": {
                "password_hash": hash_password(body.new_password),
                "updated_at": _now().isoformat(),
            }},
        )
        await db.password_reset_tokens.update_one(
            {"token": body.token},
            {"$set": {"used": True, "used_at": _now()}},
        )
        # Sign them in immediately so the flow ends on /write.
        token = create_access_token(user["user_id"], user["email"])
        _set_cookie(response, "access_token", token, ACCESS_TOKEN_MINUTES * 60)
        return {"user": _sanitize_user(user), "access_token": token}

    @router.post("/guest")
    async def guest_login(response: Response):
        """Create a throwaway 'guest' user and sign them in. The guest can later
        claim the account via /auth/claim to keep everything.
        """
        await _ensure_indexes()
        user_id = f"guest_{uuid.uuid4().hex[:12]}"
        # Placeholder email keeps the unique index happy without prompting.
        placeholder_email = f"{user_id}@guest.local"
        doc = {
            "user_id": user_id,
            "email": placeholder_email,
            "name": "Guest",
            "picture": "",
            "provider": "guest",
            "created_at": _now().isoformat(),
            "updated_at": _now().isoformat(),
        }
        await db.users.insert_one(doc)
        token = create_access_token(user_id, placeholder_email)
        _set_cookie(response, "access_token", token, ACCESS_TOKEN_MINUTES * 60)
        return {"user": _sanitize_user(doc), "access_token": token}

    @router.post("/claim")
    async def claim_account(body: ClaimAccountBody, user: dict = Depends(get_current_user), response: Response = None):
        """Upgrade a guest account to a full email/password account, keeping
        every project, page, character, and Companion run intact.
        """
        if user.get("provider") != "guest":
            raise HTTPException(400, "This account is already registered")
        email = body.email.lower().strip()
        clash = await db.users.find_one({"email": email, "user_id": {"$ne": user["user_id"]}})
        if clash:
            raise HTTPException(400, "That email is already registered")
        updates = {
            "email": email,
            "name": (body.name or user.get("name") or email.split("@")[0]).strip() or "Writer",
            "password_hash": hash_password(body.password),
            "provider": "email",
            "updated_at": _now().isoformat(),
        }
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
        merged = {**user, **updates}
        # Re-issue token bound to the new email.
        token = create_access_token(user["user_id"], email)
        if response is not None:
            _set_cookie(response, "access_token", token, ACCESS_TOKEN_MINUTES * 60)
        return {"user": _sanitize_user(merged), "access_token": token}

    return router


# ---------- Admin seeding ----------

async def seed_admin(db):
    admin_email = os.environ.get("ADMIN_EMAIL", "").lower().strip()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_email or not admin_password:
        return
    existing = await db.users.find_one({"email": admin_email})
    hashed = hash_password(admin_password)
    if existing is None:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": admin_email,
            "name": "Admin",
            "picture": "",
            "password_hash": hashed,
            "provider": "email",
            "role": "admin",
            "created_at": _now().isoformat(),
            "updated_at": _now().isoformat(),
        })
    elif not verify_password(admin_password, existing.get("password_hash", "")):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hashed, "updated_at": _now().isoformat()}},
        )
