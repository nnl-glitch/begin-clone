# Begin — Migration off Emergent

This is the exact checklist to move Begin off the Emergent platform to your own
hosts. Nothing here breaks the current preview — every code change is
dual-mode: it uses direct integrations if you set the new env vars, else it
falls back to Emergent.

---

## What the refactor already did

### 1. LLM adapter — `backend/llm_client.py`
- Ships alongside the old `emergentintegrations` import.
- Selection is env-based:
  - `ANTHROPIC_API_KEY` set → talks directly to Anthropic using the official
    async SDK.
  - Otherwise → falls back to `EMERGENT_LLM_KEY` + `emergentintegrations`
    (current preview behavior).
- `server.py` imports `LlmChat`, `UserMessage`, `TextDelta`, `StreamDone`
  from `llm_client` — nothing else in the codebase changes.

### 2. Standard Google OAuth — new endpoints in `backend/auth.py`
- `GET  /api/auth/google/init`   — returns `{ authorize_url }` for the frontend
  to redirect the browser to Google.
- `POST /api/auth/google/callback` — exchanges the auth code, verifies, upserts
  the user (`provider="google"`), and issues our own JWT `access_token` cookie
  (same one email login uses).
- These endpoints are gated on `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env
  vars — if unset, the routes return **503** and the existing Emergent
  `/api/auth/google/session` flow continues to run untouched.

### 3. Requirements
- `anthropic==1.9.0` added to `backend/requirements.txt` (installed via
  `pip install` + `pip freeze`).

---

## Your migration steps

### 0. Prep — sign up (in this order)
- [ ] **MongoDB Atlas** — free M0 cluster
- [ ] **Anthropic Console** → create an API key (`sk-ant-…`)
- [ ] **Google Cloud Console** → create OAuth 2.0 client credentials
- [ ] **Vercel** (frontend host) + **Railway** or **Render** (backend host)

### 1. Google Cloud OAuth setup
Add every URL you'll ever serve Begin from to the OAuth client:

**Authorized JavaScript Origins:**
- `https://<begin>.vercel.app`
- `https://beginwriter.ink` (when ready)

**Authorized Redirect URIs:**
- `https://<begin>.vercel.app/auth/google`
- `https://beginwriter.ink/auth/google` (when ready)

The frontend redirect path is `/auth/google` — this must match exactly.

### 2. Export from Emergent
- [ ] **Save to GitHub** from the Emergent workspace (top-right button)
- [ ] Dump the Mongo DB via `mongoview.emergent.host` → Dump DB
- [ ] Copy every custom secret from Republish → Secrets tab

### 3. Restore to MongoDB Atlas
```bash
mongorestore --uri="mongodb+srv://<user>:<pw>@<cluster>/begin" --archive=begin.gz --gzip
```

### 4. Deploy backend (Railway example)
1. Import the GitHub repo → point to `backend/`
2. Add env vars (from your Secrets export plus the new ones):
```
MONGO_URL=mongodb+srv://<...>/begin
DB_NAME=begin
JWT_SECRET=<paste from Emergent>
CORS_ORIGINS=https://<begin>.vercel.app,https://beginwriter.ink
PUBLIC_APP_URL=https://<begin>.vercel.app
ANTHROPIC_API_KEY=sk-ant-<from-anthropic>
GOOGLE_CLIENT_ID=<from-google-console>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<from-google-console>
RESEND_API_KEY=<if you use it>
EMAIL_FROM=<if you use it>
```
3. Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
4. Note the assigned `.up.railway.app` URL — you'll paste it into Vercel.

### 5. Deploy frontend (Vercel example)
1. Import the same GitHub repo → point to `frontend/`
2. Build command: `yarn build`; output: `build`
3. Add env vars:
```
REACT_APP_BACKEND_URL=https://<begin-api>.up.railway.app
REACT_APP_GOOGLE_CLIENT_ID=<your Google OAuth client id>
```
4. The frontend Google login button (see Frontend TODOs below) will call
   `/api/auth/google/init`, get the authorize URL, redirect to Google, then
   Google bounces back to `/auth/google?code=…&state=…` where your frontend
   POSTs those fields to `/api/auth/google/callback`.

### 6. Smoke-test end-to-end on the Vercel domain
- [ ] Register a new email/password account
- [ ] Sign in with Google
- [ ] Create a scene, send a Jupiter prompt, verify streaming works
- [ ] Save-to-scene, chapters, continuity scan
- [ ] Test on your phone

### 7. Point beginwriter.ink at the new hosts
- [ ] Vercel → Domains → add `beginwriter.ink` (Vercel gives you two DNS records)
- [ ] Cloudflare (or your registrar) → set those records
- [ ] Optional: add `api.beginwriter.ink` alias on Railway for the backend

### 8. Only now — cancel Emergent
- Profile → Manage plan → Cancel subscription
- Stopping the deployment stops the 50-credit/month charge; you can still
  access logs and data through the billing period.

---

## Frontend TODOs (small, do in a branch)

The frontend still calls the Emergent-managed Google flow. Once you're on the
new host, swap the login button to hit the new endpoints. A single component
change in `frontend/src/pages/Login.jsx`:

```jsx
async function loginWithGoogle() {
  const r = await api.get("/auth/google/init"); // your new backend
  window.location.href = r.data.authorize_url;
}
```

Then add a handler for `/auth/google` in your React Router that reads the
`?code=…&state=…` query and POSTs them to `/api/auth/google/callback`. The
existing Login page pattern for Emergent auth is the template — just point at
the new endpoint.

---

## Files touched by this refactor
- `backend/llm_client.py` — new LLM adapter.
- `backend/server.py` — `LlmChat` import switched to the adapter.
- `backend/auth.py` — new `/google/init` + `/google/callback` endpoints (gated).
- `backend/requirements.txt` — added `anthropic`.

Nothing else needs to change to migrate. The moment you set the two new env
vars on your new host, Begin runs entirely on your own infrastructure.
