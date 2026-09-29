import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStudio } from "../lib/studio";
import { useSettings } from "../lib/settings";
import { useAuth } from "../lib/auth";
import { ImportBundleButton } from "./ImportBundleButton";
import { ClaimAccountDialog } from "./ClaimAccountDialog";
import {
  X, Plus, Users, FolderClosed, MessageSquare,
  Feather, StickyNote, Copy, Trash2, Network, GripVertical, Search,
  VolumeX, Volume2, Sun, Moon, Accessibility, User, FileText, Braces, File, Archive, Cloud, KeyRound, Timer, Wand2, Package, BookOpen, UserCheck, Pencil, Check as CheckIcon, Star, Scale,
} from "lucide-react";
import { Button } from "./ui/button";
import { CharacterEditor } from "./CharacterEditor";
import { HistoryViewer, MODE_LABELS, formatDate } from "./HistoryViewer";
import { RelationshipGraph } from "./RelationshipGraph";
import { RightsModal } from "./RightsModal";
import { toast } from "sonner";
import { api } from "../lib/api";

const THEME_CYCLE = ["midnight_slate", "warm_cream", "warm_sepia", "calm_sand", "high_contrast"];

export function Sidebar() {
  const {
    scenes, notes, activePageId, setActivePageId,
    createPage, duplicatePage, deletePage, reorderPages, movePageToProject, scheduleSavePage,
    chapters, createChapter, updateChapter, deleteChapter, moveSceneToChapter, reorderChapters,
    keepers, updateKeeper, deleteKeeper,
    characters, createCharacter,
    projects, activeProject, activeProjectId, setActiveProjectId, createProject, updateProject, exportProject,
    history, setShowSidebar, setActiveMode, setShowTimer, setShowA11y, loadThread, renameHistoryEntry, pinHistoryEntry,
    deleteHistoryEntry, deleteProject,
  } = useStudio();
  const { settings, update } = useSettings();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState("sessions");
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [viewingHistory, setViewingHistory] = useState(null);

  // Below md the sidebar is a fixed overlay, so a selection loads behind it and
  // looks like nothing happened. Close it when the user picks something.
  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768) setShowSidebar(false);
  };
  const [showGraph, setShowGraph] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const [showRights, setShowRights] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  const cycleTheme = () => {
    const i = THEME_CYCLE.indexOf(settings.theme);
    const next = THEME_CYCLE[(i + 1) % THEME_CYCLE.length];
    update({ theme: next });
    const nicer = {
      midnight_slate: "Midnight",
      warm_cream: "Warm cream",
      warm_sepia: "Warm sepia",
      calm_sand: "Calm sand",
      high_contrast: "High contrast",
    };
    toast(`Theme: ${nicer[next] || next}`);
  };

  const doExport = (fmt) => {
    if (!activeProject) { toast.error("Open a project first"); return; }
    if (fmt === "pdf") {
      window.print();
      return;
    }
    if (fmt === "zip") {
      // Server returns a binary zip. Use fetch with credentials to preserve auth cookie.
      (async () => {
        try {
          const url = `${api.defaults.baseURL}/projects/${activeProject.id}/bundle`;
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const cd = res.headers.get("Content-Disposition") || "";
          const m = cd.match(/filename="?([^";]+)"?/);
          const filename = (m && m[1]) || `${activeProject.title || "project"}.begin.zip`;
          const dlUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = dlUrl; a.download = filename;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(dlUrl);
          toast.success("Bundle downloaded");
        } catch (_) {
          toast.error("Bundle export failed");
        }
      })();
      return;
    }
    if (fmt === "json") {
      const payload = {
        project: activeProject,
        pages: [...scenes, ...notes],
        characters,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${activeProject.title}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success("Exported JSON");
      return;
    }
    exportProject(activeProject.id, fmt);
  };

  const filteredHistory = (history || []).filter((h) => {
    if (!historyQuery.trim()) return true;
    const q = historyQuery.toLowerCase();
    return (h.output_text || "").toLowerCase().includes(q)
      || (h.input_text || "").toLowerCase().includes(q)
      || (h.mode || "").toLowerCase().includes(q);
  });

  // Thread follow-ups (parent_id) under their parent runs
  const historyById = React.useMemo(() => {
    const m = new Map();
    filteredHistory.forEach((h) => m.set(h.id, h));
    return m;
  }, [filteredHistory]);
  const threaded = React.useMemo(() => {
    const roots = [];
    const childrenByParent = new Map();
    filteredHistory.forEach((h) => {
      // A history entry counts as a follow-up only if its parent is present in the filtered set.
      if (h.parent_id && historyById.has(h.parent_id)) {
        const arr = childrenByParent.get(h.parent_id) || [];
        arr.push(h);
        childrenByParent.set(h.parent_id, arr);
      } else {
        roots.push(h);
      }
    });
    // sort children oldest→newest so the thread reads in order
    childrenByParent.forEach((arr) => arr.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")));
    // Pinned roots float to the top, otherwise preserve existing (newest-first) order.
    roots.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return roots.map((r) => ({ ...r, children: childrenByParent.get(r.id) || [] }));
  }, [filteredHistory, historyById]);
  const [expandedThreads, setExpandedThreads] = useState({});

  return (
    <aside
      className="flex flex-col w-[300px] shrink-0 border-r overflow-hidden fixed md:static top-0 md:top-auto bottom-0 left-0 z-30 md:z-0 shadow-xl md:shadow-none"
      style={{ background: "var(--sc-bg-sidebar)", borderColor: "var(--sc-border)", height: "100dvh", maxHeight: "100dvh" }}
      data-testid="sidebar"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-start justify-between">
        <div>
          <h1 className="font-serif-reader text-4xl leading-none" style={{ color: "var(--sc-text-primary)" }}>
            Begin
          </h1>
          <p className="text-[11px] mt-2" style={{ color: "var(--sc-text-secondary)" }}>
            a writing companion
          </p>
        </div>
        <button
          onClick={() => setShowSidebar(false)}
          className="p-1.5 rounded-md hover:bg-black/5"
          aria-label="Close sidebar"
          data-testid="close-sidebar-btn"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="px-4 flex items-center gap-1.5 mb-4">
        <TabPill active={tab === "sessions"} onClick={() => setTab("sessions")} testid="tab-sessions" icon={<MessageSquare className="w-3.5 h-3.5" />}>Sessions</TabPill>
        <TabPill active={tab === "characters"} onClick={() => setTab("characters")} testid="tab-characters" icon={<Users className="w-3.5 h-3.5" />}>Characters</TabPill>
        <TabPill active={tab === "projects"} onClick={() => setTab("projects")} testid="tab-projects" icon={<FolderClosed className="w-3.5 h-3.5" />}>Projects</TabPill>
      </div>

      {/* Tab bodies */}
      <div className="px-4 flex-1 min-h-0 overflow-y-auto calm-scroll pb-2">
        {tab === "sessions" && (
          <>
            <button
              onClick={() => { setActivePageId(null); setActiveMode("collaborate"); closeOnMobile(); }}
              className="w-full mb-3 flex items-center justify-center gap-2 py-3 rounded-full font-serif-reader text-[15px] transition hover:opacity-90"
              style={{ background: "#EFE7D6", color: "#1A1918" }}
              data-testid="new-session-btn"
            >
              <Plus className="w-4 h-4" /> New session
            </button>
            <div
              className="relative mb-2 rounded-md border flex items-center"
              style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-sheet)" }}
            >
              <Search className="w-3.5 h-3.5 ml-2" style={{ color: "var(--sc-text-secondary)" }} />
              <input
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Search sessions…"
                className="flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
                style={{ color: "var(--sc-text-primary)" }}
                data-testid="history-search-input"
              />
            </div>
            <ul className="space-y-1.5">
              {threaded.map((h) => {
                const hasChildren = (h.children || []).length > 0;
                const expanded = expandedThreads[h.id];
                const isRenaming = renamingId === h.id;
                const displayTitle = (h.title && h.title.trim())
                  || (h.output_text || h.input_text || "").split("\n")[0].slice(0, 32)
                  || "Untitled";
                const commitRename = async () => {
                  const t = (renameDraft || "").trim();
                  try { await renameHistoryEntry(h.id, t); } catch (err) { toast.error("Couldn't rename"); }
                  setRenamingId(null);
                  setRenameDraft("");
                };
                return (
                  <li key={h.id}>
                    <div className="flex items-center gap-1 group">
                      {isRenaming ? (
                        <div className="flex-1 flex items-center gap-1 px-2 py-1">
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded"
                            style={{ background: "color-mix(in oklab, var(--sc-accent-primary) 25%, transparent)", color: "var(--sc-text-primary)" }}
                          >
                            {MODE_LABELS[h.mode] || h.mode}
                          </span>
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              if (e.key === "Escape") { setRenamingId(null); setRenameDraft(""); }
                            }}
                            onBlur={commitRename}
                            className="flex-1 bg-transparent border-b text-base font-serif-reader outline-none px-1"
                            style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
                            placeholder="Name this session…"
                            data-testid={`history-rename-input-${h.id}`}
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={commitRename}
                            className="p-1 rounded hover:bg-black/5"
                            style={{ color: "var(--sc-text-secondary)" }}
                            aria-label="Save session name"
                            data-testid={`history-rename-save-${h.id}`}
                          >
                            <CheckIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => { loadThread(h, history); closeOnMobile(); }}
                            onDoubleClick={() => { setRenamingId(h.id); setRenameDraft(h.title || ""); }}
                            title="Click to open · double-click to rename"
                            className="flex-1 text-left px-2 py-2 rounded-md flex items-center gap-3 transition hover:opacity-90"
                            style={{ color: "var(--sc-text-primary)" }}
                            data-testid={`history-item-${h.id}`}
                          >
                            <span
                              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded"
                              style={{ background: "color-mix(in oklab, var(--sc-accent-primary) 25%, transparent)", color: "var(--sc-text-primary)" }}
                            >
                              {MODE_LABELS[h.mode] || h.mode}
                            </span>
                            <span className="font-serif-reader text-[14px] truncate flex-1" style={{ color: "var(--sc-text-primary)" }}>
                              {displayTitle}
                            </span>
                          </button>
                          <button
                            onClick={async () => {
                              try { await pinHistoryEntry(h.id, !h.pinned); }
                              catch { toast.error("Couldn't pin"); }
                            }}
                            className={`px-1.5 py-1 rounded text-[11px] transition ${h.pinned ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"} hover:bg-black/5`}
                            style={{ color: h.pinned ? "var(--sc-accent-primary)" : "var(--sc-text-secondary)" }}
                            aria-label={h.pinned ? "Unpin session" : "Pin session"}
                            title={h.pinned ? "Unpin session" : "Pin session to top"}
                            data-testid={`history-pin-btn-${h.id}`}
                          >
                            <Star className="w-3.5 h-3.5" fill={h.pinned ? "currentColor" : "none"} />
                          </button>
                          <button
                            onClick={() => { setRenamingId(h.id); setRenameDraft(h.title || ""); }}
                            className="px-1.5 py-1 rounded text-[11px] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 hover:bg-black/5"
                            style={{ color: "var(--sc-text-secondary)" }}
                            aria-label="Rename session"
                            data-testid={`history-rename-btn-${h.id}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={async () => {
                              const extra = hasChildren ? ` and its ${h.children.length} follow-up(s)` : "";
                              if (!window.confirm(`Delete "${displayTitle}"${extra}? This cannot be undone.`)) return;
                              try { await deleteHistoryEntry(h.id); toast.success("Session deleted"); }
                              catch { toast.error("Couldn't delete session"); }
                            }}
                            className="px-1.5 py-1 rounded text-[11px] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 hover:bg-black/5"
                            style={{ color: "var(--sc-text-secondary)" }}
                            aria-label="Delete session"
                            data-testid={`history-delete-btn-${h.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      {hasChildren && !isRenaming && (
                        <button
                          onClick={() => setExpandedThreads((s) => ({ ...s, [h.id]: !s[h.id] }))}
                          className="px-2 py-1 rounded text-[11px] hover:bg-black/5"
                          data-testid={`thread-toggle-${h.id}`}
                          aria-label={expanded ? "Collapse thread" : "Expand thread"}
                        >
                          {expanded ? "▾" : `▸ ${h.children.length}`}
                        </button>
                      )}
                    </div>
                    {hasChildren && expanded && (
                      <ul className="mt-1 ml-6 space-y-1 border-l pl-2" style={{ borderColor: "var(--sc-border)" }}>
                        {h.children.map((child) => (
                          <li key={child.id}>
                            <button
                              onClick={() => setViewingHistory(child)}
                              className="w-full text-left px-2 py-1.5 rounded text-xs hover:opacity-90"
                              style={{ color: "var(--sc-text-secondary)" }}
                              data-testid={`history-item-${child.id}`}
                            >
                              <span className="font-serif-reader text-sm" style={{ color: "var(--sc-text-primary)" }}>
                                {(child.input_text || "").slice(0, 40) || "follow-up"}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
              {threaded.length === 0 && (
                <li className="text-xs italic text-center py-6" style={{ color: "var(--sc-text-secondary)" }}>
                  {historyQuery ? "No matches." : "No sessions yet. Start writing then run any mode."}
                </li>
              )}
            </ul>
          </>
        )}

        {tab === "characters" && (
          <>
            <NewCharacterCTA
              onCreate={async (name) => {
                const c = await createCharacter({ name });
                setEditingCharacter(c);
              }}
            />
            {characters.length >= 2 && (
              <button
                onClick={() => setShowGraph(true)}
                className="w-full mb-3 flex items-center justify-center gap-1.5 text-xs py-2 rounded-md"
                style={{ color: "var(--sc-text-secondary)" }}
                data-testid="open-relationship-graph-btn"
              >
                <Network className="w-3.5 h-3.5" /> Relationship web
              </button>
            )}
            <ul className="space-y-1">
              {characters.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setEditingCharacter(c)}
                    className="w-full text-left px-2 py-3 rounded-md transition hover:opacity-80"
                    style={{ color: "var(--sc-text-primary)" }}
                    data-testid={`character-item-${c.id}`}
                  >
                    <div className="font-serif-reader text-[17px] leading-tight">{c.name}</div>
                    {c.role && (
                      <div className="text-[12px] mt-0.5" style={{ color: "var(--sc-text-secondary)" }}>
                        {c.role}
                      </div>
                    )}
                  </button>
                </li>
              ))}
              {characters.length === 0 && (
                <li className="text-xs italic text-center py-4" style={{ color: "var(--sc-text-secondary)" }}>
                  No characters yet.
                </li>
              )}
            </ul>
          </>
        )}

        {tab === "projects" && (
          <ProjectsPanel
            projects={projects}
            activeProject={activeProject}
            activeProjectId={activeProjectId}
            setActiveProjectId={setActiveProjectId}
            createProject={createProject}
            updateProject={updateProject}
            newProject={newProject}
            setNewProject={setNewProject}
            scenes={scenes}
            notes={notes}
            createPage={createPage}
            duplicatePage={duplicatePage}
            deletePage={deletePage}
            reorderPages={reorderPages}
            movePageToProject={movePageToProject}
            scheduleSavePage={scheduleSavePage}
            chapters={chapters}
            createChapter={createChapter}
            updateChapter={updateChapter}
            deleteChapter={deleteChapter}
            moveSceneToChapter={moveSceneToChapter}
            reorderChapters={reorderChapters}
            keepers={keepers}
            updateKeeper={updateKeeper}
            deleteKeeper={deleteKeeper}
            activePageId={activePageId}
            setActivePageId={setActivePageId}
            closeOnMobile={closeOnMobile}
            deleteProject={deleteProject}
          />
        )}
      </div>

      {/* Bottom quick-actions row (icon-only utility bar) */}
      <div
        className="mt-2 px-6 py-3 border-t flex items-center justify-between shrink-0"
        style={{ borderColor: "var(--sc-border)" }}
      >
        <IconAction
          onClick={() => update({ reduced_motion: !settings.reduced_motion })}
          active={settings.reduced_motion}
          label="Reduced motion"
          testid="quick-reduced-motion"
        >
          <VolumeX className="w-[18px] h-[18px]" style={{ display: settings.reduced_motion ? "none" : "inline" }} />
          <Volume2 className="w-[18px] h-[18px]" style={{ display: settings.reduced_motion ? "inline" : "none" }} />
        </IconAction>
        <IconAction onClick={cycleTheme} label="Theme" testid="quick-theme">
          {settings.theme === "midnight_slate" ? <Moon className="w-[18px] h-[18px]" /> : <Sun className="w-[18px] h-[18px]" />}
        </IconAction>
        <IconAction onClick={() => setShowTimer((s) => !s)} label="Focus timer" testid="quick-timer-trigger">
          <Timer className="w-[18px] h-[18px]" />
        </IconAction>
        <IconAction
          onClick={() => setShowA11y(true)}
          label="Accessibility"
          testid="quick-a11y-trigger"
        >
          <Accessibility className="w-[18px] h-[18px]" />
        </IconAction>
        <IconAction
          onClick={async () => {
            if (!user) return;
            const confirmed = window.confirm(`Sign out of Begin (${user.email})?`);
            if (!confirmed) return;
            await logout();
            navigate("/login", { replace: true });
          }}
          label={user ? `Sign out ${user.email}` : "Sign out"}
          testid="quick-profile"
        >
          <User className="w-[18px] h-[18px]" />
        </IconAction>
      </div>

      {/* Export block */}
      <div className="px-6 pt-3 pb-3 shrink-0">
        <div className="grid grid-cols-3 gap-2">
          <ExportBtn label="Text" icon={<FileText className="w-4 h-4" />} onClick={() => doExport("txt")} testid="export-txt" />
          <ExportBtn label="JSON" icon={<Braces className="w-4 h-4" />} onClick={() => doExport("json")} testid="export-json" />
          <ExportBtn label="PDF" icon={<File className="w-4 h-4" />} onClick={() => doExport("pdf")} testid="export-pdf" />
        </div>
        <button
          onClick={() => doExport("md")}
          className="w-full mt-3 py-2 flex items-center justify-center gap-2 text-[13px]"
          style={{ color: "var(--sc-text-secondary)" }}
          data-testid="export-md"
        >
          <Archive className="w-4 h-4" /> Bulk export (.md)
        </button>
        <button
          onClick={() => doExport("zip")}
          className="w-full mt-1 py-2 flex items-center justify-center gap-2 text-[13px]"
          style={{ color: "var(--sc-text-secondary)" }}
          data-testid="export-bundle-zip"
        >
          <Package className="w-4 h-4" /> Book bundle (.zip)
        </button>
        <ImportBundleButton />
      </div>

      {/* Footer links */}
      <div className="px-6 pb-5 pt-2 border-t space-y-1 shrink-0" style={{ borderColor: "var(--sc-border)" }}>
        <button
          onClick={() => toast("Cloud sync is on the roadmap")}
          className="w-full flex items-center gap-2 text-[13px] py-2"
          style={{ color: "var(--sc-text-secondary)" }}
          data-testid="cloud-drive-btn"
        >
          <Cloud className="w-4 h-4" /> Connect Google Drive
        </button>
        <button
          onClick={() => toast("Uses your workspace key — no personal key needed")}
          className="w-full flex items-center gap-2 text-[13px] py-2 border-t"
          style={{ color: "var(--sc-text-secondary)", borderColor: "var(--sc-border)" }}
          data-testid="api-key-btn"
        >
          <KeyRound className="w-4 h-4" /> Add API key
        </button>
        <button
          onClick={() => navigate("/about")}
          className="w-full flex items-center gap-2 text-[13px] py-2 border-t"
          style={{ color: "var(--sc-text-secondary)", borderColor: "var(--sc-border)" }}
          data-testid="about-link-btn"
        >
          <BookOpen className="w-4 h-4" /> About Begin
        </button>
        <button
          onClick={() => setShowRights(true)}
          className="w-full flex items-center gap-2 text-[13px] py-2 border-t"
          style={{ color: "var(--sc-text-secondary)", borderColor: "var(--sc-border)" }}
          data-testid="rights-link-btn"
        >
          <Scale className="w-4 h-4" /> Terms &amp; Rights
        </button>
        {user && user.provider === "guest" && (
          <button
            onClick={() => setShowClaim(true)}
            className="w-full mt-2 flex items-center gap-2 text-[13px] py-2 px-3 rounded-md border"
            style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
            data-testid="claim-account-btn"
          >
            <UserCheck className="w-4 h-4" /> Claim this account
          </button>
        )}
      </div>

      {showClaim && <ClaimAccountDialog onClose={() => setShowClaim(false)} />}
      <RightsModal open={showRights} onClose={() => setShowRights(false)} />

      {editingCharacter && (
        <CharacterEditor character={editingCharacter} onClose={() => setEditingCharacter(null)} />
      )}
      {viewingHistory && (
        <HistoryViewer entry={viewingHistory} onClose={() => setViewingHistory(null)} />
      )}
      {showGraph && (
        <RelationshipGraph
          characters={characters}
          onClose={() => setShowGraph(false)}
          onEdit={(c) => { setShowGraph(false); setEditingCharacter(c); }}
        />
      )}
    </aside>
  );
}

function TabPill({ active, onClick, children, icon, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-full text-[13px] transition"
      style={{
        background: active ? "#0F1420" : "transparent",
        color: active ? "#F5EEDD" : "var(--sc-text-primary)",
        border: active ? "1px solid transparent" : "1px solid var(--sc-border)",
        fontWeight: active ? 600 : 500,
        fontFamily: "var(--font-serif-reader, serif)",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Click-to-reveal cream CTA pill. Default state shows "+ New <thing>";
 * clicking swaps it for an inline input that submits on Enter and
 * collapses back on blur/Escape. Matches the reference sidebar's
 * prominent "New character / New session / New project" button.
 */
function CTAButton({ label, placeholder, onCreate, testid, testidInput }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = async () => {
    const t = (value || "").trim();
    if (!t) { setEditing(false); return; }
    try { await onCreate(t); } catch (err) { /* upstream shows toast */ }
    setValue(""); setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="w-full mb-3 flex items-center gap-2 pl-4 pr-2 rounded-full"
        style={{ background: "#EFE7D6" }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setValue(""); setEditing(false); }
          }}
          onBlur={commit}
          placeholder={placeholder}
          className="flex-1 py-3 bg-transparent outline-none font-serif-reader text-[15px]"
          style={{ color: "#1A1918" }}
          data-testid={testidInput}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className="p-2 rounded-full hover:bg-black/5"
          aria-label={label}
        >
          <Plus className="w-4 h-4" style={{ color: "#1A1918" }} />
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full mb-3 flex items-center justify-center gap-2 py-3 rounded-full font-serif-reader text-[15px] transition hover:opacity-90"
      style={{ background: "#EFE7D6", color: "#1A1918" }}
      data-testid={testid}
    >
      <Plus className="w-4 h-4" /> {label}
    </button>
  );
}

function NewCharacterCTA({ onCreate }) {
  return <CTAButton label="New character" placeholder="Character name…" onCreate={onCreate} testid="add-character-btn" testidInput="new-character-name" />;
}

function NewProjectCTA({ onCreate }) {
  return <CTAButton label="New project" placeholder="Project title…" onCreate={onCreate} testid="new-project-btn" testidInput="new-project-input" />;
}

function IconAction({ onClick, children, label, testid, active }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testid}
      className="p-2 rounded-md hover:opacity-70"
      style={{ color: active ? "var(--sc-accent-primary)" : "var(--sc-text-primary)" }}
    >
      {children}
    </button>
  );
}

function A11yTrigger() {
  const { setShowA11y } = useStudio();
  return null;
}

function ExportBtn({ label, icon, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 py-3 rounded-md hover:opacity-70"
      style={{ color: "var(--sc-text-secondary)" }}
      data-testid={testid}
    >
      {icon}
      <span className="text-[12px]">{label}</span>
    </button>
  );
}

function PreambleCoachBtn({ activePageContent, onDrafted }) {
  const [busy, setBusy] = useState(false);
  const draft = async () => {
    if (!activePageContent?.trim()) {
      toast.error("Write a scene first so Jupiter has something to read");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/ai/preamble-coach", {
        scene_content: activePageContent,
        existing_beats: [],
      });
      const text = (r.data.preamble || "").trim();
      if (text) onDrafted(text);
      else toast.error("Nothing came back — try again with more content");
    } catch (_) {
      toast.error("Preamble Coach failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={draft}
      disabled={busy}
      className="text-[10px] flex items-center gap-1 px-2 py-1 rounded border hover:opacity-80 disabled:opacity-40"
      style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
      data-testid="preamble-coach-btn"
    >
      <Wand2 className="w-3 h-3" />
      {busy ? "Drafting…" : "Draft from scene"}
    </button>
  );
}

function ProjectsPanel({
  projects, activeProject, activeProjectId, setActiveProjectId, createProject, updateProject,
  newProject, setNewProject,
  scenes, notes, createPage, duplicatePage, deletePage, reorderPages, movePageToProject, scheduleSavePage,
  chapters, createChapter, updateChapter, deleteChapter, moveSceneToChapter, reorderChapters,
  keepers = [], updateKeeper, deleteKeeper,
  activePageId, setActivePageId, closeOnMobile, deleteProject,
}) {
  const dragId = React.useRef(null);
  const [dragOverProjectId, setDragOverProjectId] = useState(null);
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [projectDraft, setProjectDraft] = useState("");
  const [expanded, setExpanded] = useState({ scenes: true, notes: false });
  const [showArchive, setShowArchive] = useState(false);
  const [renamingKeeperId, setRenamingKeeperId] = useState(null);
  const [keeperDraft, setKeeperDraft] = useState("");
  const [preamble, setPreamble] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const preambleTimer = React.useRef();

  React.useEffect(() => {
    setPreamble(activeProject?.preamble || "");
    setSynopsis(activeProject?.synopsis || "");
  }, [activeProject?.id, activeProject?.preamble, activeProject?.synopsis]);

  const scheduleSaveMemory = (nextPreamble, nextSynopsis) => {
    clearTimeout(preambleTimer.current);
    preambleTimer.current = setTimeout(() => {
      if (!activeProjectId || !updateProject) return;
      updateProject(activeProjectId, { preamble: nextPreamble, synopsis: nextSynopsis }).catch(() => {});
    }, 600);
  };

  const onDragStart = (id) => (e) => { dragId.current = id; e.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const onDrop = (kind, list, targetId) => (e) => {
    e.preventDefault();
    const src = dragId.current; dragId.current = null;
    if (!src || src === targetId) return;
    const ids = list.map((p) => p.id);
    const from = ids.indexOf(src);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorderPages(kind, ids);
  };

  return (
    <>
      <NewProjectCTA
        onCreate={async (title) => { await createProject(title); }}
      />
      <ul className="space-y-1 mb-3">
        {projects.map((p) => {
          const isOverTarget = dragOverProjectId === p.id;
          return (
            <li key={p.id} className="flex items-center gap-1 group">
              {renamingProjectId === p.id ? (
                <input
                  autoFocus
                  value={projectDraft}
                  onChange={(e) => setProjectDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") { setRenamingProjectId(null); setProjectDraft(""); }
                  }}
                  onBlur={async () => {
                    const t = (projectDraft || "").trim();
                    if (t && t !== p.title) {
                      try { await updateProject(p.id, { title: t }); }
                      catch { toast.error("Couldn't rename project"); }
                    }
                    setRenamingProjectId(null);
                    setProjectDraft("");
                  }}
                  className="flex-1 min-w-0 bg-transparent border-b font-serif-reader text-sm outline-none px-2 py-2"
                  style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
                  placeholder="Name this project…"
                  data-testid={`project-rename-input-${p.id}`}
                />
              ) : (
              <>
              <button
                onClick={() => { setActiveProjectId(p.id); closeOnMobile(); }}
                onDragOver={(e) => {
                  // Only accept a page being dragged from another project.
                  if (!dragId.current) return;
                  if (p.id === activeProjectId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverProjectId !== p.id) setDragOverProjectId(p.id);
                }}
                onDragLeave={() => setDragOverProjectId(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const src = dragId.current;
                  setDragOverProjectId(null);
                  dragId.current = null;
                  if (!src || p.id === activeProjectId) return;
                  movePageToProject(src, p.id);
                }}
                className="flex-1 min-w-0 text-left px-2 py-2 rounded-md text-sm transition"
                style={{
                  background: activeProjectId === p.id
                    ? "color-mix(in oklab, var(--sc-accent-primary) 22%, transparent)"
                    : (isOverTarget ? "color-mix(in oklab, var(--sc-accent-primary) 12%, transparent)" : "transparent"),
                  color: "var(--sc-text-primary)",
                  outline: isOverTarget ? "1px dashed var(--sc-accent-primary)" : "none",
                  outlineOffset: isOverTarget ? "2px" : "0",
                }}
                data-testid={`project-item-${p.id}`}
              >
                <span className="font-serif-reader">{p.title}</span>
                {isOverTarget && (
                  <span className="ml-2 text-[10px] italic" style={{ color: "var(--sc-text-secondary)" }}>
                    · drop to move
                  </span>
                )}
              </button>
              <button
                onClick={() => { setRenamingProjectId(p.id); setProjectDraft(p.title || ""); }}
                className="px-1.5 py-1 rounded opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 hover:bg-black/5"
                style={{ color: "var(--sc-text-secondary)" }}
                aria-label="Rename project"
                data-testid={`project-rename-btn-${p.id}`}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={async () => {
                  if (!window.confirm(`Delete "${p.title}"? Every scene, note and character in this project is deleted with it. This cannot be undone.`)) return;
                  try { await deleteProject(p.id); }
                  catch { toast.error("Couldn't delete project"); }
                }}
                className="px-1.5 py-1 rounded opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 hover:bg-black/5"
                style={{ color: "var(--sc-text-secondary)" }}
                aria-label="Delete project"
                data-testid={`project-delete-btn-${p.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
              </>
              )}
            </li>
          );
        })}
      </ul>

      {activeProjectId && (
        <div className="border-t pt-3 mb-3" style={{ borderColor: "var(--sc-border)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
              Jupiter's memory
            </p>
            <PreambleCoachBtn
              activePageContent={scenes[0]?.content || notes[0]?.content || ""}
              onDrafted={(draft) => {
                setPreamble(draft);
                scheduleSaveMemory(draft, synopsis);
              }}
            />
          </div>
          <textarea
            value={preamble}
            onChange={(e) => { setPreamble(e.target.value); scheduleSaveMemory(e.target.value, synopsis); }}
            placeholder="World, tone, POV, stakes, names to remember. Sent to Jupiter on every run."
            className="w-full text-sm px-2 py-2 rounded border bg-transparent min-h-[80px] font-serif-reader"
            style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
            data-testid="project-preamble-input"
          />
          <p className="text-[10px] uppercase tracking-widest font-semibold mt-3 mb-1.5" style={{ color: "var(--sc-text-secondary)" }}>
            Synopsis
          </p>
          <textarea
            value={synopsis}
            onChange={(e) => { setSynopsis(e.target.value); scheduleSaveMemory(preamble, e.target.value); }}
            placeholder="A one-line pitch of the story."
            className="w-full text-sm px-2 py-2 rounded border bg-transparent min-h-[50px]"
            style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
            data-testid="project-synopsis-input"
          />
        </div>
      )}

      {activeProjectId && (
        <div className="border-t pt-3" style={{ borderColor: "var(--sc-border)" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest font-semibold flex items-center gap-1.5" style={{ color: "var(--sc-text-secondary)" }}>
              <Star className="w-3 h-3" /> Keepers
            </p>
            <span className="text-[10px]" style={{ color: "var(--sc-text-secondary)" }}>{keepers.length}</span>
          </div>
          {keepers.length === 0 ? (
            <p className="text-[11px] italic mb-3" style={{ color: "var(--sc-text-secondary)" }}>
              Tap the ★ on any bubble to keep it here.
            </p>
          ) : (
            <ul className="space-y-1 mb-3" data-testid="keepers-list">
              {keepers.map((k) => {
                const isRenaming = renamingKeeperId === k.id;
                const commit = async () => {
                  const t = (keeperDraft || "").trim();
                  try { await updateKeeper(k.id, { title: t }); } catch { toast.error("Couldn't rename"); }
                  setRenamingKeeperId(null); setKeeperDraft("");
                };
                return (
                  <li key={k.id} className="group flex items-start gap-1 px-2 py-1.5 rounded-md hover:bg-black/5"
                      data-testid={`keeper-row-${k.id}`}>
                    <div className="flex-1 min-w-0">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={keeperDraft}
                          onChange={(e) => setKeeperDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit();
                            if (e.key === "Escape") { setRenamingKeeperId(null); setKeeperDraft(""); }
                          }}
                          onBlur={commit}
                          className="w-full bg-transparent border-b text-sm font-serif-reader outline-none"
                          style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
                          data-testid={`keeper-rename-input-${k.id}`}
                        />
                      ) : (
                        <button
                          type="button"
                          onDoubleClick={() => { setRenamingKeeperId(k.id); setKeeperDraft(k.title || ""); }}
                          className="w-full text-left"
                          title="Double-click to rename"
                          data-testid={`keeper-title-${k.id}`}
                        >
                          <p className="text-sm font-serif-reader truncate" style={{ color: "var(--sc-text-primary)" }}>
                            {k.title || (k.body || "").split("\n")[0].slice(0, 40) || "Untitled"}
                          </p>
                          <p className="text-[11px] truncate" style={{ color: "var(--sc-text-secondary)" }}>
                            {(k.body || "").slice(0, 80)}
                          </p>
                        </button>
                      )}
                    </div>
                    {!isRenaming && (
                      <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition">
                        <button
                          type="button"
                          onClick={() => { setRenamingKeeperId(k.id); setKeeperDraft(k.title || ""); }}
                          aria-label="Rename keeper"
                          className="p-1 rounded hover:bg-black/10"
                          data-testid={`keeper-rename-${k.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("Delete this keeper?")) deleteKeeper(k.id).catch(() => toast.error("Delete failed"));
                          }}
                          aria-label="Delete keeper"
                          className="p-1 rounded hover:bg-black/10"
                          data-testid={`keeper-delete-${k.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setShowArchive((s) => !s)}
            className="text-[11px] italic underline underline-offset-2 hover:opacity-80 mb-2"
            style={{ color: "var(--sc-text-secondary)" }}
            data-testid="archive-toggle-btn"
          >
            {showArchive ? "Hide archive" : "View archive"}
          </button>

          {showArchive && (
            <div data-testid="archive-panel">
              <p className="text-[10px] italic mb-2" style={{ color: "var(--sc-text-secondary)" }}>
                Legacy scenes, notes, and chapters. Preserved but no longer part of the flow.
              </p>
              <PageGroup
                kind="scene"
                label="Scenes"
                icon={<Feather className="w-3.5 h-3.5" />}
                list={scenes}
                open={expanded.scenes}
                toggle={() => setExpanded((e) => ({ ...e, scenes: !e.scenes }))}
                closeOnMobile={closeOnMobile}
                activePageId={activePageId}
                setActivePageId={setActivePageId}
                createPage={createPage}
                duplicatePage={duplicatePage}
                deletePage={deletePage}
                renamePage={(id, title) => scheduleSavePage(id, { title })}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                chapters={chapters}
                createChapter={createChapter}
                updateChapter={updateChapter}
                deleteChapter={deleteChapter}
                moveSceneToChapter={moveSceneToChapter}
                reorderChapters={reorderChapters}
              />
              <PageGroup
                kind="note"
                label="Notes"
                icon={<StickyNote className="w-3.5 h-3.5" />}
                list={notes}
                open={expanded.notes}
                toggle={() => setExpanded((e) => ({ ...e, notes: !e.notes }))}
                closeOnMobile={closeOnMobile}
                activePageId={activePageId}
                setActivePageId={setActivePageId}
                createPage={createPage}
                duplicatePage={duplicatePage}
                deletePage={deletePage}
                renamePage={(id, title) => scheduleSavePage(id, { title })}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function PageGroup({ kind, label, icon, list, open, toggle, activePageId, setActivePageId, createPage, duplicatePage, deletePage, renamePage, onDragStart, onDragOver, onDrop, closeOnMobile, chapters, createChapter, updateChapter, deleteChapter, moveSceneToChapter, reorderChapters }) {
  const [renamingId, setRenamingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [renamingChapterId, setRenamingChapterId] = useState(null);
  const [chapterDraft, setChapterDraft] = useState("");
  const [collapsedChapters, setCollapsedChapters] = useState({});
  const [chapterDragId, setChapterDragId] = useState(null);
  const [chapterDragOverId, setChapterDragOverId] = useState(null);
  const toggleChapter = (id) => setCollapsedChapters((prev) => ({ ...prev, [id || "_unfiled"]: !prev[id || "_unfiled"] }));

  const onChapterDragStart = (chapterId) => (e) => {
    setChapterDragId(chapterId);
    // Tag the payload so we know this drag is for chapter reordering (scene drags
    // set the same dataTransfer text — we differentiate by a prefix).
    try { e.dataTransfer.setData("text/plain", `chapter:${chapterId}`); } catch (_) {}
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  };
  const onChapterDragOver = (chapterId) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (chapterDragId && chapterDragId !== chapterId) setChapterDragOverId(chapterId);
  };
  const onChapterDrop = (targetChapterId) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = chapterDragId;
    setChapterDragId(null);
    setChapterDragOverId(null);
    if (!draggedId || draggedId === targetChapterId || !reorderChapters || !chapters) return;
    const currentIds = chapters.map((c) => c.id);
    const from = currentIds.indexOf(draggedId);
    const to = currentIds.indexOf(targetChapterId);
    if (from < 0 || to < 0) return;
    const next = [...currentIds];
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    reorderChapters(next);
  };

  const isSceneGroup = kind === "scene" && Array.isArray(chapters);
  const hasChapters = isSceneGroup && chapters.length > 0;

  // Build [bucket, pages[]] pairs — chapters in order, then Unfiled at the end.
  const buckets = hasChapters
    ? [
        ...chapters.map((ch) => ({ chapter: ch, pages: list.filter((p) => p.chapter_id === ch.id) })),
        { chapter: null, pages: list.filter((p) => !p.chapter_id) },
      ]
    : [{ chapter: null, pages: list }];

  const renderRow = (c) => (
    <li
      key={c.id}
      className="group flex items-center gap-1 rounded-md"
      draggable
      onDragStart={onDragStart(c.id)}
      onDragOver={onDragOver}
      onDrop={onDrop(kind, list, c.id)}
      data-testid={`page-row-${c.id}`}
    >
      <span
        className="p-1 cursor-grab active:cursor-grabbing opacity-30 group-hover:opacity-100 transition"
        data-testid={`drag-handle-${c.id}`}
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </span>
      {renamingId === c.id ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") { setRenamingId(null); setDraft(""); }
          }}
          onBlur={() => {
            const t = (draft || "").trim();
            if (t && t !== c.title) {
              try { renamePage && renamePage(c.id, t); }
              catch { toast.error(`Couldn't rename ${kind}`); }
            }
            setRenamingId(null); setDraft("");
          }}
          className="flex-1 min-w-0 bg-transparent border-b text-sm outline-none px-2 py-1.5"
          style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)", fontFamily: "var(--font-serif-reader, serif)" }}
          placeholder={`Name this ${kind}…`}
          data-testid={`page-rename-input-${c.id}`}
        />
      ) : (
        <button
          onClick={() => { setActivePageId(c.id); closeOnMobile(); }}
          onDoubleClick={() => { setRenamingId(c.id); setDraft(c.title || ""); }}
          className="flex-1 text-left text-sm px-2 py-1.5 rounded-md truncate"
          style={{
            background: activePageId === c.id ? "color-mix(in oklab, var(--sc-accent-primary) 22%, transparent)" : "transparent",
            color: "var(--sc-text-primary)",
          }}
          title="Click to open · double-click to rename"
          data-testid={`page-item-${c.id}`}
        >
          {c.title || "Untitled"}
        </button>
      )}
      <div className="flex items-center opacity-60 hover:opacity-100 transition">
        {isSceneGroup && chapters.length > 0 && renamingId !== c.id && (
          <select
            value={c.chapter_id || ""}
            onChange={(e) => {
              const v = e.target.value || null;
              try { moveSceneToChapter && moveSceneToChapter(c.id, v); }
              catch { toast.error("Couldn't move scene"); }
            }}
            className="text-[10px] px-1 py-1 rounded bg-transparent border-0 hover:bg-black/5 outline-none max-w-[6rem] truncate"
            style={{ color: "var(--sc-text-secondary)" }}
            title="Move to chapter"
            data-testid={`scene-chapter-select-${c.id}`}
            aria-label="Chapter"
          >
            <option value="">— Unfiled —</option>
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>{ch.title}</option>
            ))}
          </select>
        )}
        {renamingId !== c.id && (
          <button
            onClick={() => { setRenamingId(c.id); setDraft(c.title || ""); }}
            className="p-1.5 rounded hover:bg-black/5"
            aria-label={`Rename ${kind}`}
            data-testid={`rename-page-${c.id}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => duplicatePage(c.id)}
          className="p-1.5 rounded hover:bg-black/5"
          aria-label="Duplicate"
          data-testid={`duplicate-page-${c.id}`}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => window.confirm(`Delete "${c.title}"?`) && deletePage(c.id)}
          className="p-1.5 rounded hover:bg-black/5"
          aria-label="Delete"
          data-testid={`delete-page-${c.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );

  return (
    <div className="mb-2">
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
        className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider py-1 cursor-pointer select-none"
        style={{ color: "var(--sc-text-secondary)" }}
        data-testid={`group-${kind}s`}
      >
        <span className="flex items-center gap-1.5">{icon} {label}</span>
        <span className="flex items-center gap-2">
          <span>{list.length}</span>
          {isSceneGroup && createChapter && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const name = window.prompt("Name this chapter:", `Chapter ${chapters.length + 1}`);
                if (name === null) return;
                createChapter((name || "").trim() || `Chapter ${chapters.length + 1}`);
              }}
              className="p-0.5 rounded hover:bg-black/5"
              aria-label="Add chapter"
              title="New chapter"
              data-testid="add-chapter-btn"
            >
              <BookOpen className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); createPage(kind); }}
            className="p-0.5 rounded hover:bg-black/5"
            aria-label={`Add ${kind}`}
            data-testid={kind === "scene" ? "add-scene-btn" : "add-note-btn"}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
      {open && (
        <ul className="mt-1 space-y-1">
          {buckets.map((b, bi) => {
            const isUnfiled = !b.chapter;
            const chapId = b.chapter?.id || "_unfiled";
            const collapsed = !!collapsedChapters[chapId];
            // Skip empty Unfiled bucket entirely if we have chapters and everything is filed
            if (hasChapters && isUnfiled && b.pages.length === 0) return null;
            return (
              <React.Fragment key={chapId}>
                {hasChapters && (
                  <li
                    className="mt-2 flex items-center gap-1 group/ch rounded-md"
                    draggable={!isUnfiled}
                    onDragStart={!isUnfiled ? onChapterDragStart(b.chapter.id) : undefined}
                    onDragOver={onChapterDragOver(b.chapter?.id || null)}
                    onDrop={onChapterDrop(b.chapter?.id || null)}
                    style={{
                      background: chapterDragOverId === (b.chapter?.id || null) && chapterDragId
                        ? "color-mix(in oklab, var(--sc-accent-primary) 12%, transparent)"
                        : "transparent",
                      opacity: chapterDragId === b.chapter?.id ? 0.5 : 1,
                    }}
                    data-testid={`chapter-row-${chapId}`}
                  >
                    {!isUnfiled && (
                      <span
                        className="p-0.5 cursor-grab active:cursor-grabbing opacity-30 group-hover/ch:opacity-100 transition shrink-0"
                        aria-label="Drag to reorder chapter"
                        data-testid={`chapter-drag-handle-${b.chapter.id}`}
                      >
                        <GripVertical className="w-3 h-3" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleChapter(b.chapter?.id)}
                      className="p-0.5 rounded hover:bg-black/5 shrink-0"
                      aria-label={collapsed ? "Expand" : "Collapse"}
                      data-testid={`chapter-toggle-${chapId}`}
                    >
                      <span className="text-[10px]">{collapsed ? "▸" : "▾"}</span>
                    </button>
                    {isUnfiled ? (
                      <span className="flex-1 text-[10px] uppercase tracking-widest italic" style={{ color: "var(--sc-text-secondary)" }}>
                        Unfiled · {b.pages.length}
                      </span>
                    ) : renamingChapterId === b.chapter.id ? (
                      <input
                        autoFocus
                        value={chapterDraft}
                        onChange={(e) => setChapterDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") { setRenamingChapterId(null); setChapterDraft(""); }
                        }}
                        onBlur={() => {
                          const t = (chapterDraft || "").trim();
                          if (t && t !== b.chapter.title) {
                            try { updateChapter(b.chapter.id, { title: t }); }
                            catch { toast.error("Couldn't rename chapter"); }
                          }
                          setRenamingChapterId(null); setChapterDraft("");
                        }}
                        className="flex-1 min-w-0 bg-transparent border-b text-[11px] outline-none px-1 py-0.5"
                        style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)", fontFamily: "var(--font-serif-reader, serif)" }}
                        data-testid={`chapter-rename-input-${b.chapter.id}`}
                      />
                    ) : (
                      <button
                        type="button"
                        onDoubleClick={() => { setRenamingChapterId(b.chapter.id); setChapterDraft(b.chapter.title || ""); }}
                        className="flex-1 text-left text-[11px] font-semibold uppercase tracking-widest px-1 py-0.5 truncate"
                        style={{ color: "var(--sc-text-primary)", fontFamily: "var(--font-serif-reader, serif)" }}
                        title="Double-click to rename"
                        data-testid={`chapter-title-${b.chapter.id}`}
                      >
                        {b.chapter.title} <span className="opacity-40 font-normal">· {b.pages.length}</span>
                      </button>
                    )}
                    {!isUnfiled && (
                      <div className="opacity-0 group-hover/ch:opacity-100 transition flex items-center">
                        <button
                          type="button"
                          onClick={() => { setRenamingChapterId(b.chapter.id); setChapterDraft(b.chapter.title || ""); }}
                          className="p-1 rounded hover:bg-black/5"
                          aria-label="Rename chapter"
                          data-testid={`rename-chapter-${b.chapter.id}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { if (window.confirm(`Delete chapter "${b.chapter.title}"? Scenes stay in the project.`)) deleteChapter(b.chapter.id); }}
                          className="p-1 rounded hover:bg-black/5"
                          aria-label="Delete chapter"
                          data-testid={`delete-chapter-${b.chapter.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </li>
                )}
                {!collapsed && b.pages.map(renderRow)}
                {!collapsed && hasChapters && !isUnfiled && b.pages.length === 0 && (
                  <li className="text-[11px] italic pl-6 py-0.5" style={{ color: "var(--sc-text-secondary)" }}>
                    Drop scenes here from the chapter menu →
                  </li>
                )}
              </React.Fragment>
            );
          })}
          {list.length === 0 && !hasChapters && (
            <li className="text-xs italic pl-2 py-1" style={{ color: "var(--sc-text-secondary)" }}>
              Empty — click + to add.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
