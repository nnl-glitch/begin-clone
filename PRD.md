# Begin — Accessible Literary Writing Studio

## Original problem statement
> "I want a writing app that is friendly with explicit content, has functions to collaborate, analyze, revise, interpret and track a character's evolution. I want it to be accessible for people with autism and ADHD. I want the app to use serif font and have the ability to save from every function, synced so nothing needs to be repeated."

## Architecture
- **Backend**: FastAPI + MongoDB (Motor). All routes prefixed `/api`. No auth — device-local `X-User-Id` header from localStorage. Claude Sonnet 5 via `emergentintegrations` LlmChat (streaming SSE).
- **Frontend**: React 19 + React Router. Global providers: `SettingsProvider` (theme, font, a11y) and `StudioProvider` (projects, pages, characters, history, quick pad).
- **Fonts**: Lora / Cormorant Garamond loaded via Google Fonts.
- **Storage collections**: `projects`, `pages` (kind = scene|note), `characters` (with embedded evolution), `settings`, `ai_history`.

## Core requirements (static)
1. Explicit-friendly, uncensored literary AI (renamed "The Muse" — no AI mentions in UX)
2. 5 distinct modes: Analyze · Collaborate · Revise · Interpret · Evolution
3. Character evolution tracker with per-page stages + sliders
4. Autism/ADHD accessibility: sensory themes, dyslexia font, adjustable size/spacing, focus overlay, reduced motion, Pomodoro
5. Serif everywhere; autosave from every surface; sync across sessions
6. No limits on how many projects/scenes/notes/characters/history entries

## User personas
- Neurodivergent adult fiction writers (romance, dark fantasy, erotica, horror)
- Writers who bounce between scratch-thoughts and long-form drafts
- Solo writers needing a calm, non-judgmental collaborator

## What's been implemented (as of Feb, 2026)
- **Feb 2026 (later XIV) — Flatter model (Keepers + persistent thread per project×mode) + fixes**
  - **Style select back**: removed the `activeProject &&` gate around the Style dropdown in `ModeWorkspace.jsx` so Style / Speak-as row renders regardless of project.
  - **Backend Keeper model + CRUD** (`server.py`): new collection `keepers` (`{id, user_id, project_id, title, body, source_mode, source_history_id, source_bubble_role, order_index, archived, created_at, updated_at}`). Endpoints: `GET /api/keepers?project_id=X[&include_archived=true]`, `POST /api/keepers`, `PATCH /api/keepers/{id}`, `DELETE /api/keepers/{id}`, `POST /api/keepers/reorder`. Archive is a soft flag; list defaults to non-archived. Verified via curl (create → patch title → patch archived → list filter → include_archived → delete).
  - **Backend persistent thread endpoint**: `GET /api/threads/current?project_id=X&mode=Y` returns the most-recent root `AIHistory` for that (project, mode) pair + all children (follow-ups). Empty result is `{root: null, children: []}`. Verified via curl.
  - **Frontend studio.jsx**: new state `keepers` + methods `refreshKeepers`, `createKeeper({title, body, source_mode, source_history_id, source_bubble_role})`, `updateKeeper`, `deleteKeeper`. Keepers refresh on project change, on focus, and drop on `deleteProject`. New `loadCurrentThread(projectId, mode)` helper that fetches the persistent thread, stitches root+children with the existing `\u0001BEGIN_U\u0001` / `\u0001BEGIN_A\u0001` sentinels, and stages it via `setThreadToLoad`.
  - **ModeWorkspace auto-load**: new effect keyed by `(activeProject.id, activeMode)` — when both are set (and the pair hasn't just been loaded), fires `loadCurrentThread` so switching modes on an active project auto-loads that thread. A `useRef` guards against re-fires.
  - **Per-bubble Keep**: added `onKeep` prop to `UserBubble` + `JupiterBubble` in `ChatBubble.jsx` (Star icon). In `ModeWorkspace`, every non-streaming bubble gets a `keepFromBubble(t)` that prompts for a title (defaults to first 8 words) then calls `createKeeper` with `source_mode: activeMode` + `source_bubble_role`. Gated on `activeProject` so unassigned drafts don't fail.
  - **Sidebar / ProjectsPanel**: new Keepers section under the memory/synopsis block (visible when a project is active). Empty state reads "Tap the ★ on any bubble to keep it here." Each row supports inline rename (double-click or pencil) and delete with confirm. New `showArchive` toggle collapses the legacy Scenes/Notes/Chapters block behind a small `"View archive" / "Hide archive"` link (`data-testid=archive-toggle-btn`); archive panel keeps all prior functionality intact.
  - **LLM shim fix**: `backend/llm_client.py` `UserMessage` dataclass now includes `file_contents: Optional[list] = None` (no longer frozen). The updated `emergentintegrations` library reads that attribute on every send; without it the fallback path threw `'UserMessage' object has no attribute 'file_contents'` on every AI run. Direct-Anthropic path unaffected.
- **Feb 2026 (later XIII) — Migration prep (dual-mode LLM + Google OAuth, Terms modal, MIGRATION.md)**
  - `backend/llm_client.py` — new adapter that routes to direct **Anthropic** async SDK when `ANTHROPIC_API_KEY` is set, else falls back to `emergentintegrations`. `server.py` imports `LlmChat` / `UserMessage` / `TextDelta` / `StreamDone` from the adapter — no other call site changed.
  - `backend/auth.py` — two new dual-mode endpoints: `GET /api/auth/google/init` (returns Google's authorize URL) and `POST /api/auth/google/callback` (exchanges code, upserts user, issues our own JWT). Both return **503** unless `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` are set — so the current preview keeps using Emergent's `/google/session` flow untouched.
  - `backend/requirements.txt` — `anthropic==1.9.0` added.
  - Frontend `RightsModal.jsx` — new cream-serif "Terms & Rights" modal opened from a sidebar footer link (`rights-link-btn`, Scale icon). Covers ownership, third-party licenses, data handling.
  - `MIGRATION.md` at repo root — full step-by-step migration checklist from Emergent to Vercel + Railway + Atlas + Anthropic + Google OAuth.
- **Feb 2026 (later XII) — Strip leaked role labels ("**You**" / "**Jupiter**") from bubbles**
  - When a writer saves a whole conversation via `saveThreadAsScene` and later reopens that scene as a passage, the raw markdown labels leaked into the passage bubble.
  - Extended `stripResiduals` with two regexes: `ROLE_LABEL_LEAD_RE` (strip leading `**You**` / `**Jupiter**` label at bubble start) and `ROLE_LABEL_SEP_RE` (collapse `---` separator + label pair back to a paragraph break). Only strips when the label pattern is EXACT (start-of-string or on its own line) so legitimate mid-sentence mentions like "She said, **You** are late" are preserved.
  - Also apply `stripResiduals` to `passage` before pushing the initial user bubble, so a scene reopened as passage never shows a raw label.
- **Feb 2026 (later XI) — One-Tap Repair (Clean this session)**
  - New Wand2 button `mode-header-clean-btn` in the mode header (sits between save-thread and eraser). Runs the current output through `parseTranscript` (which strips residual markers via `stripResiduals`) then re-serializes with clean sentinels via `serializeTurns`. Empties nothing — just purges baked-in `BEGIN_A` / `──── companion ────` / mangled control-char fragments from old threads.
  - Guard: shows "Nothing to clean" toast if the transcript is empty.
- **Feb 2026 (later X) — Bulletproof sentinel stripping ("BEGIN_A" bleed fix)**
  - The raw `\u0001BEGIN_A\u0001` sentinel was leaking into rendered bubbles when a serializer somewhere in the round-trip mangled the surrounding control chars, or when an edit produced an orphan assistant turn mid-transcript.
  - `parseTranscript` now calls a `stripResiduals` helper on every piece: split+join for exact sentinels, plus a regex fallback that matches `BEGIN_U` / `BEGIN_A` even when the flanking `\u0001` was replaced by `\ufffd` or lost entirely.
  - `serializeTurns` never emits a lone A_SENTINEL anymore — orphan assistant turns are prefixed with `U_SENTINEL + A_SENTINEL` so the parser always sees a proper user/assistant pair.
  - Verified against three failure modes in Node: intact control chars, control chars stripped, control chars replaced with `\ufffd`. All strip cleanly.
- **Feb 2026 (later IX) — Legacy session bubble fix ("companion" markers)**
  - `loadThread` in `studio.jsx` now stitches follow-ups with the new control-character sentinels (`\u0001BEGIN_U\u0001` / `\u0001BEGIN_A\u0001`) instead of raw em-dash text. Every legacy session opened from the sidebar now renders as proper user/Jupiter bubbles, never as one giant blob of text.
  - `parseTranscript` legacy-fallback regex now tolerates any horizontal-line variant (`─`, `—`, `–`, `-`) around the role label, so however old sessions were stored, the split still fires.
  - Consequence: the raw "──── you ────" / "──── companion ────" labels vanish from the rendered chat, and "companion" is never shown to the reader — the bubble label always comes from `JupiterBubble`.
- **Feb 2026 (later VIII) — Chapter drag-reorder**
  - New endpoint `POST /api/chapters/reorder` (accepts `{items:[{id, order_index}]}`), verified via curl.
  - Frontend `reorderChapters(orderedIds)` in studio; optimistic local reorder + rollback on failure.
  - Sidebar chapter rows are `draggable` with a GripVertical drag handle; drop target highlights via `color-mix` background. Scene drags and chapter drags don't collide (chapter payload prefixed with `chapter:`).
- **Feb 2026 (later VII) — Chapters + Continuity Sentinel**
  - **Chapters**: new `Chapter` model + CRUD (`/api/chapters`). Page model gains `chapter_id`. Sidebar scenes group renders per-chapter buckets when chapters exist, with inline rename, delete, collapse/expand, and a per-scene chapter dropdown for moving. New chapter button (BookOpen icon) in the scenes header. Deleting a chapter unfiles its scenes rather than destroying them.
  - **Server-side chapter validation**: PATCH `/api/pages` now rejects a `chapter_id` that doesn't belong to the writer's active project (returns 400). Cross-project scene moves auto-clear the old `chapter_id`.
  - **Continuity Sentinel**: new POST `/api/ai/continuity` uses Claude Sonnet 5 to scan every scene in a project for genuine contradictions (eye color, timeline, POV drift, room layout, objects) and returns a JSON list of flags with quoted evidence from both scenes. Editor gets a "Continuity" button (ShieldAlert icon, visible on scene pages inside an active project) → drawer with severity-colored flags, dismissable, empty-state note.
  - 20/20 test scenarios PASS in `/app/test_reports/iteration_16.json` (8 backend pytest + 12 frontend flows). Backend pytest lives at `/app/backend/tests/test_iter16_chapters_continuity.py`.
- **Feb 2026 (later VI) — Depth presets (per-mode + named)**
  - Reference depth is now **per-mode** (persisted at `scribecraft_ref_depth_by_mode`) — Analyze/Interpret/Collaborate each remember their own dial, migrated from the old single-value key.
  - **Named presets**: "Save preset" button prompts for a name and snapshots the current per-mode trio. A "Load preset…" dropdown and dismissable chips appear once at least one preset exists (labels like "Deep Reader (A:D · I:M · C:N)"). Delete via × on each chip. All persisted to `scribecraft_depth_presets`.
  - Loading a preset applies all three modes at once with a toast.
- **Feb 2026 (later V) — Reference depth dial applies globally (Analyze / Interpret / Collaborate)**
  - Same segmented pill (None / Light / Moderate / Deep) now appears in Analyze and Collaborate workspaces too, alongside a mode-specific hint line explaining what "references" means in that mode.
  - Backend directive is now tailored per mode: **Analyze** treats references as craft comparisons ("the way Munro handles X"), **Interpret** as illumination, **Collaborate** as stylistic touchstones (shape voice in the opener, never name-drop inside the fiction itself).
  - Migrated the old `scribecraft_interpret_ref_depth` localStorage key to the new global `scribecraft_ref_depth`.
  - Live-verified: Analyze/deep opened with a numbered craft breakdown of the semicolon's structural echo; Collaborate/light skipped references and delivered A/B/C prose alternatives; Collaborate/none stayed pure prose with no touchstones.
- **Feb 2026 (later IV) — Reference depth dial for Interpret mode**
  - New segmented pill in the Interpret workspace: **None / Light / Moderate / Deep** (default Moderate). Persisted to localStorage; passed as `reference_depth` on every Interpret `streamAI` call.
  - Backend `AIRequest` gains `reference_depth: Optional[str]`; when mode is `interpret`, appends a REFERENCE OVERRIDE directive that instructs Jupiter to inject 0, 1-2, 3-4, or 5-7 concrete references across literature/film/music/myth/painting/theory.
  - Live-tested: `none` produced pure close reading of the semicolon and "hummed" verb, `deep` opened with sensory embodiment and set up for wide-ranging comparisons — neither shed its literary voice.
- **Feb 2026 (later III) — Save whole conversation as one scene**
  - Mode header now has a **BookmarkPlus** button (`mode-header-save-thread-btn`) before Clear/New. One tap serializes passage + every user follow-up + every Jupiter reply into a single markdown scene body with bold role labels and `---` separators.
  - Suggested title uses the capitalized mode name (Analyze / Collaborate / Interpret / Revise / Evolution) followed by the first sentence of the passage, truncated at a word boundary so titles never end mid-word.
  - Empty-thread edge case: no dialog, just a "Nothing to save yet" toast.
  - Verified end-to-end in `/app/test_reports/iteration_15.json` (100% pass).
- **Feb 2026 (later II) — Font 16 default, no accidental mode switch, universal passage, edit/save/regenerate any bubble**
  - Default reader font size lowered from 18 → **16** (both frontend `DEFAULTS` and backend `Settings`); mobile scene title shrunk `text-2xl` → `text-xl`.
  - Removed the swipe-to-switch-mode gesture on `ModeWorkspace` root. Scrolling content, dragging text, or moving side-to-side no longer flips Analyze ↔ Interpret ↔ etc. Only tapping a mode tab changes modes.
  - **Universal passage**: passage is now a single shared string across all five modes (persisted at localStorage `scribecraft_passage_shared`). Paste in Analyze, hop to Interpret / Revise / Collaborate / Evolution — same text is already there.
  - **Save-as-scene on every bubble**: every user AND Jupiter bubble gets a Save icon that prompts for a title and creates a new scene under the active project with that bubble's content.
  - **Edit any bubble in place**: pencil icon turns any bubble into an inline textarea (Cmd/Ctrl-Enter or Save button commits, Esc cancels). First-user-bubble edits update the shared passage; all others rewrite via `serializeTurns`.
  - **Regenerate from any turn**: refresh icon on a user bubble re-runs Jupiter with that prompt (drops downstream turns). On a Jupiter bubble it replays the preceding user prompt. Passage-bubble regen goes through the fresh `run()` path.
- **Feb 2026 (later) — Header font-size control, session rename by double-click, Settings 422 fix, robust bubble delete**
  - Top bar now has a compact **A− / A+ reader font-size control** (`data-testid=font-size-control`) with min 13 / max 26. Writes directly to `settings.font_size` and re-renders every bubble + `.prose-editor` live.
  - Fixed **Settings PUT 422** — `Settings.user_id` is now `Optional[str] = None` on the request model; the PUT endpoint still stamps the uid from the auth cookie before writing. Font-size (and every other setting) now persists across reloads.
  - Bubble delete transcript is now robust against LLM-emitted em-dashes: switched to **control-character sentinels** (`\u0001BEGIN_U\u0001` / `\u0001BEGIN_A\u0001`) in `parseTranscript` / `serializeTurns` / `sendFollowup`, with legacy em-dash fallback for older history rows. Verified with a reply containing 5+ em-dashes.
  - **Session rename** — double-click any `history-item-<id>` opens the same inline rename input the pencil icon already exposed (Enter saves, Esc cancels).
  - Bubble delete × button now shows at `opacity-40` on mobile (always tappable) and hover-reveals on desktop.
- **Feb 2026 — Cormorant Garamond default, smaller scene title, scene rename, per-bubble delete, lint blocker fixed**
  - Fixed P0 build blocker: `setActivePageId` now destructured from `useStudio()` in `ModeWorkspace.jsx`.
  - Reader font family default switched to **Cormorant Garamond** (Lora kept as `[data-font='lora']` option); loads from existing Google Fonts link.
  - Scene/Note title in `Editor.jsx` reduced from `text-3xl sm:text-4xl` → `text-2xl sm:text-3xl` for a calmer mobile read.
  - Scenes and Notes in the sidebar are now **renameable** — double-click the row OR press the new pencil icon → inline input, Enter to save, Esc to cancel; autosaves via `scheduleSavePage`.
  - **Per-bubble delete** in `ModeWorkspace`: hover any user/Jupiter bubble to reveal a small × button. Confirms with "Remove this turn?" before mutating. Deleting the first bubble (which mirrors the passage) simply clears the passage; deleting any other turn rebuilds the marker-string transcript so Recall and follow-ups stay consistent.
- **Per-mode header, mobile tabs, bubble parity, Collaborate prose, scene sync (Feb 2026)** —
  - **Per-feature header**: sticky row under the top nav on every mode with mode label uppercase + a truncated one-line preview of the current passage / scene, plus an **eraser** icon (clears the current conversation, keeps the passage) and a cream **plus** icon (fully new session — clears passage + output + active scene). Matches the writer's reference screenshot.
  - **Mobile mode tabs**: TopBar now shows all 5 tabs on mobile — icon-only when inactive, icon + label when active. No more horizontal-scroll fatigue.
  - **Bubble font parity**: `Markdown.jsx` `<p>` and `<li>` now use `fontSize: inherit; line-height: inherit;` so the navy Jupiter bubble matches the brown user bubble exactly (they both read from the parent bubble's `--reader-font-size`).
  - **Collaborate prompt**: rewritten to explicitly COMPOSE fresh prose (never analyze, never rewrite the writer's passage). Offers labeled A/B/C alternatives when giving multiple continuations.
  - **Scene sync across modes**: opening a scene from the sidebar now prefills the current mode's passage textarea. Ref-guarded so it only reloads when the active page's id actually changes.
- **Save-on-close + cross-device sync on focus (Feb 2026)** —
  - **Bug**: dismissing the `CharacterEditor` sheet via Escape or backdrop tap silently discarded edits — only the explicit Save button persisted. Fix: `onOpenChange={(o) => !o && save()}` so every dismiss flushes the edits through `updateCharacter` first. "Character saved" toast confirms.
  - **Cross-device sync**: added a `visibilitychange` + `focus` listener in `studio.jsx` that refetches projects, characters, pages, and history whenever the tab/PWA is brought back to the foreground. Edits made on device A now appear on device B the moment the writer returns to the app. New public helpers: `refreshCharacters`, `refreshPages`.
  - Verified end-to-end: created a character, PATCHed role/traits/motivations, listed again — all three persisted.
- **Assign character to project (Feb 2026)** — `CharacterEditor` now has a **PROJECT** dropdown at the top with "— Unassigned —" plus every project. Changing it optimistically PATCHes `project_id` on the backend, rolls back on failure, and shows a contextual toast (`Moved to <project title>` or `Unassigned`). Local sidebar list is kept in sync: keeps the character visible when viewing "all", drops it from the list when viewing a different project, keeps it when viewing the target project.
- **Unassigned characters + Quick Pad removed (Feb 2026)** —
  - **Character.project_id** now `Optional[str]` on backend model + `CharacterCreate`. `list_characters` accepts no `project_id` (returns ALL) or `project_id=unassigned` (returns only project-less). `CharacterUpdate.project_id` added so writers can later assign an unassigned character to a project.
  - **studio.jsx** now fetches ALL characters when no active project so the sidebar isn't empty. `createCharacter` sends `project_id: activeProjectId || null` — verified via curl: creating with no project_id stores `project_id: None`.
  - **Sidebar CTA** no longer blocks with "Open a project first" — characters can be added at any time.
  - **Quick Pad row removed** from the Projects tab. Kept the internal `quickPad` state in studio.jsx as a graceful fallback for the Editor when no page is active (nothing user-visible references "Quick Pad" from the sidebar now).
- **Sign-In Bridge / Welcome-first flow (Feb 2026)** — new `EntryGate` component at `/` in `App.js`: on first visit it plays the "Welcome to Begin." animation, then routes writers to `/login` (if unauthenticated) or `/write` (if signed in). Uses `localStorage.scribecraft_welcome_seen` so return visits skip the intro and land on their destination instantly. Removed the duplicate `WelcomeIntro` from `Home.jsx` so authenticated writers no longer see the welcome twice. Verified end-to-end: first visit → intro → /login → second visit → straight to /login (no intro).
- **Simplified Welcome intro (Feb 2026)** — `WelcomeIntro.jsx` rewritten to a single animated line **"Welcome to Begin."** with staggered word reveal (opacity + y + blur), blinking accent caret, and "a writing companion" tagline. Auto-dismisses after 2.6s; tap anywhere or Skip to leave early. Respects `prefers-reduced-motion`. Same data-testids preserved.
- **Mobile density pass (Feb 2026)** — ModeWorkspace title `text-4xl→text-3xl` on mobile, description `text-base→text-sm`, container padding `px-6 py-10 → px-4 py-6`, passage textarea min-h `220px→140px`, Home hero `text-5xl→text-4xl`, TopBar mode labels `text-lg→text-base`. New CSS: reader-font-size `15px→14px`, tightened bubble padding and full-width on <768px. Effect: the "Write with Jupiter" hero + description + Jupiter opener + passage input + context input + run button all fit in a single mobile fold (390×844) instead of requiring scroll.
- **PWA + offline last session + placeholder icon (Feb 2026)** —
  - `public/manifest.webmanifest` with `display: standalone`, `start_url: /write`, navy theme + cream, three icon sizes (192/512 + maskable 512).
  - `public/sw.js` — service worker with cache-first app shell (index.html, JS/CSS, icons, fonts) and network-only for `/api/*` so live data never staleness-locks. Registered on window load in `index.html`.
  - iOS meta tags in `index.html`: `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-mobile-web-app-title: Begin`. `theme-color` set to deep navy `#0F1420`.
  - Placeholder icons generated with PIL (cream Liberation Serif "B" on deep navy, rounded 22% corners) at 180/192/512 + maskable variant. Writers can drop in a real icon later by replacing the PNGs.
  - `ModeWorkspace` outputs / passages / contexts / speakAsId now persisted to `localStorage` so a hard reload (or offline open) keeps the writer where they were.
- **Mobile fixes + Cross-project drag + Scene delete visibility (Feb 2026)** —
  - **Mobile sidebar font & layout**: on <768px viewports, the sidebar switches to natural-flow scrolling (no more `flex-1` clipping that hid characters beyond the second one). Header shrinks 4xl→2xl, list rows 14→13px, tab pills 13→12px, and `--reader-font-size` drops to 15px so workspace bubbles stay proportionate. Media queries in `index.css`.
  - **Cross-project drag**: `PageUpdate.project_id` field on backend `PATCH /api/pages/{id}` moves a scene/note to another project (verifies target ownership, re-anchors `order_index` at the end of the target list). Frontend `movePageToProject` in `studio.jsx` + drop-target handlers on project rows in `ProjectsPanel` with a dashed outline + "drop to move" hint. Intra-project reorder still works via the existing `reorderPages` flow.
  - **Scene delete/duplicate buttons**: no longer hidden behind `opacity-0 group-hover:opacity-100` (which failed on touch and looked broken to some desktop users). Now `opacity-60 hover:opacity-100` — always visible, gently emphasised on hover.
- **Pin Sessions (Feb 2026)** — `AIHistory.pinned: bool` field + PATCH `/api/ai/history/{id}` now accepts `{pinned}` alongside `{title}` (both optional, either or both). Frontend: star toggle on each session row (visible when pinned, appears on hover otherwise), pinned rows float to the top of the sidebar list. New `pinHistoryEntry(id, pinned)` in `studio.jsx`. Verified round-trip via curl + browser.
- **Auto session titles + Voice reading + Warm-cream theme + Role placeholder (Feb 2026)** —
  - **Auto title**: `POST /api/ai/history/{id}/auto-title` asks Jupiter for a 3-6 word title from the first exchange. Called fire-and-forget after the first successful stream in `ModeWorkspace.onDone`. Idempotent — a writer-set title is never overwritten. Backend uses same Claude Sonnet 5 + Emergent LLM key.
  - **Voice reading**: `JupiterBubble` now shows a small pill "LISTEN" toggle next to the "Jupiter" label. Tapping speaks the reply via `SpeechSynthesisUtterance` at 0.95 rate, respects the writer's `scribecraft_voice` localStorage voice choice from AccessibilityDrawer. Module-level guard ensures only one bubble speaks at a time. `ModeWorkspace`'s single top-of-transcript read button is retained as a fallback.
  - **Warm cream theme**: new `[data-theme='warm_cream']` block in `index.css` — cream page (#F3EBD6), deep navy ink (#1A1F2C), warm-tan accent (#8F6A3F), all shadcn tokens mapped. Added to Sidebar's `THEME_CYCLE` between `midnight_slate` and `warm_sepia`, with a toast on switch showing the theme name.
  - **Character role placeholder**: "Protagonist, Antagonist, Foil…" placeholder added to the existing role input in `CharacterEditor.jsx`. The role already flows into the sidebar row's muted subtitle line.
- **Sidebar visual redesign (Feb 2026)** — Reworked to match a cleaner, more breathable reference: 3-column pill tab row (`Sessions / Characters / Projects`) with dark-filled active state + bordered inactive; a big cream "+ New character / + New session / + New project" click-to-reveal CTA pill per tab (new `CTAButton` component); simplified list rows (bigger serif name + muted role subtitle, no inline action clutter — actions moved into the character editor sheet); icon-only utility footer (5 icons: mute, theme, timer, a11y, sign-out) — text labels removed; 3-column Text/JSON/PDF export tiles (borderless, muted); Bulk export / Book bundle / Restore as subtle centered links; two full-width footer links (Google Drive + Add API key + About Begin) separated by hairline dividers. Font hierarchy tightened globally.
- **Character Pinning + Speak-as chip strip (Feb 2026)** — `Character.pinned: bool` field added; `CharacterUpdate` accepts it; `CharacterEditor` gains a Pin/Unpin toggle (disabled until the character has a voice preamble, since pinning without a voice would be a no-op). `ModeWorkspace` renders a horizontal chip strip beneath the passage input on **every** mode when ≥1 character is pinned — each chip shows initials avatar + name, tap to activate (fills cream), tap again to release. Auto-syncs with the existing "Speak as" dropdown so both stay consistent.
- **Jupiter rebrand + chat bubble redesign (Feb 2026)** — Renamed user-facing "Companion" → **"Jupiter"** across UI (Home hero, RecallDialog, CharacterEditor, Sidebar, Editor, HistoryViewer, Register, Welcome, ImportBundle, ClaimAccount, AccessibilityDrawer TTS sample). Backend `HUMAN_VOICE` system prompt now includes `IDENTITY: Your name is Jupiter.` so replies self-identify naturally. New shared `<UserBubble/>` and `<JupiterBubble/>` components (`/app/frontend/src/components/ChatBubble.jsx`) — warm-tan (#8F6A3F) user bubble right-aligned + dark-slate (#161C29) Jupiter bubble left-aligned with bold serif "Jupiter" label. Applied everywhere: `ModeWorkspace` (parses the `──── you ────`/`──── jupiter ────` transcript into bubbles) and `FeatureChat` (character + scene sidepanels).
- **Session rename in sidebar (Feb 2026)** — `AIHistory.title: Optional[str]` field + new `PATCH /api/ai/history/{id}` endpoint (max 120 chars, empty string clears back to null). Sidebar shows a pencil on hover of each session row → inline edit input → Enter/blur saves via `renameHistoryEntry` in `studio.jsx`. Falls back to input/output snippet when no custom title.
- **Memory-used chip + warm Jupiter opener (Feb 2026)** — `AIHistory.memory_used: bool` set to True when a project preamble was injected into the run; done SSE payload includes `memory_used`; `ModeWorkspace` displays a subtle "memory used" chip beside the Conversation header when true. Also adds a Jupiter opener bubble (`OPENERS` per-mode) that greets writers on an empty workspace, replacing the cold "just a title" feel.
- **Production 500 fix — best-effort auth indexes (Feb 2026)** — `_ensure_indexes()` in `auth.py` now wraps each `create_index` in its own try/except. Root cause of live 500s: deployed Mongo rejected one of the unique-index creations (permissions / conflicting spec), which then bubbled out of every request that ran `_ensure_indexes()` (register, guest, forgot-password). Reads (`login`, `me`) always worked. Verified in preview and live: all three endpoints return 200 again on beginwriter.ink.
- **Optional account / Guest mode (Feb 2026)** — `POST /api/auth/guest` creates a `provider='guest'` user with the same JWT cookie flow; guests use the whole app identically. "Continue without an account" links on Login, Register, About pages. Sidebar "Claim this account" button visible only for guests; `POST /api/auth/claim` upgrades in-place preserving all data.
- **Contextual FeatureChat (Feb 2026)** — Reusable `<FeatureChat>` panel (`/api/ai/stream mode='collaborate'`, transcript in context, messages persisted in localStorage). Mounted inside Character editor + beneath Scene editor. Hidden during Focus mode.
- **Bold + Italic (Feb 2026)** — Companion replies render markdown via `react-markdown` (`<Markdown>` wrapper). Scene editor gets Bold/Italic toolbar buttons wrapping the selection with `**`/`*`.
- **Deploy self-heal (Feb 2026)** — `_jwt_secret()` derives from `MONGO_URL` if `JWT_SECRET` unset; CORS uses regex whitelist covering `*.emergentagent.com`, `*.emergent.host`, `*.emergentcf.cloud`, localhost when `CORS_ORIGINS` is empty.
- **Rebrand ScribeCraft → Begin (Feb 2026)** — all user-visible strings updated; internal keys unchanged.
- **Import Bundle Back** — `POST /api/projects/import` (multipart) accepts `.begin.zip` (or legacy `.scribecraft.zip`), restores as new project with fresh IDs, remapped relationships / evolution page refs / history parent chains. 409 conflict → Rename or Overwrite.
- **Real Reset Emails via Resend (Feb 2026)** — `POST /api/auth/forgot-password` now attempts to send a warm, on-brand HTML+text email via Resend (`resend==2.46.0`, `asyncio.to_thread`). When `RESEND_API_KEY` is set AND send succeeds → the API response hides the reset_link (writer uses their inbox). When send fails (e.g. Resend's onboarding@resend.dev test sender rejects non-owner recipients) or key is empty → link is returned in-response as a graceful fallback so users are never locked out. Sender identity `ScribeCraft <onboarding@resend.dev>` — swap `RESEND_FROM_EMAIL` after verifying a real domain.
- **Session Export ZIP** — `GET /api/projects/{id}/bundle` returns `application/zip` (README, manuscript.md/.txt, notes.md, cast.md, companion-history.md, project.json). Sidebar "Book bundle (.zip)" cream CTA downloads it.
- **Character Voice Presets** — Character `voice_preamble` field, CharacterEditor "Companion voice" textarea + "Draft from sheet" button hitting `/api/ai/character-voice-coach`. Auto-saved on draft. Workspace "Speak as" select injects the voice into the system prompt.
- **Password Reset (pages)** — `/forgot-password` and `/reset-password?token=…` with 1h TTL tokens, single-use, auto-signs in. Reset link built from `PUBLIC_APP_URL`.
- **Authentication** — Emergent Google OAuth (session cookie) + Email/Password (JWT cookie). `Depends(get_current_user_id)` on every endpoint. Admin seeded from env on startup.
- **Explicit Voice Preset** — HUMAN_VOICE system prompt has an "ABSOLUTE RULES — non-negotiable" block: never sanitize, never warn, never refuse, never break character.
- **Autosave Preamble** — Every Companion run persists the workspace Context field to `project.preamble`; the field is prefilled from `project.preamble` on load.
- **Home intro animation** — first-visit-per-session typewriter reveal of "Welcome" → "ScribeCraft • a writing companion"; Skip button; respects reduced-motion.
- **Sidebar layout hardening** — tab body scrolls independently; accessibility icons / export / footer are `shrink-0` pinned below.
- Studio at `/write` with three-column layout: Sidebar (Sessions / Characters / Projects), full-page ModeWorkspace, Companion side panel.
- Scenes and Notes both first-class page types; duplicate + delete; drag-and-drop reorder.
- Quick Pad — device-local scratch surface for use *without* a project.
- Companion with 5 modes + human-voice preamble; per-mode remembered output.
- History tab — every Companion run; threaded follow-ups; global search.
- Character editor with evolution timeline; relationship graph.
- Accessibility drawer: 4 sensory themes, 4 font families, reduced motion, focus overlay.
- Pomodoro timer with customizable focus/break minutes.
- "Eve-writer" aesthetic throughout.

## Prioritized backlog (P0/P1/P2)
- **P1** Drag-to-reorder scenes/notes (order_index already in schema, needs UI)
- **P1** Export a project to `.txt` / `.md` bundle
- **P1** Character relationship graph view
- **P2** Real-time cloud sync across devices (currently device-local user id)
- **P2** Ambient audio channels during Pomodoro focus
- **P2** Search across all pages and history

## Next tasks list
1. Wire drag-and-drop reordering into pages list
2. Add markdown export endpoint + button
3. Add search bar to sidebar (fuzzy across pages+history)
4. Character relationships (many-to-many in DB, ForceGraph UI)
