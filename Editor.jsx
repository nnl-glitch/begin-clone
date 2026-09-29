import React, { useMemo, useRef, useState } from "react";
import { useStudio } from "../lib/studio";
import { Focus, Eye, EyeOff, Copy, StickyNote, Feather, Volume2, VolumeX, Plus, X, ListChecks, Wand2, Bold, Italic, ShieldAlert, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { FeatureChat } from "./FeatureChat";

function wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function Editor() {
  const {
    activePage, activeProject, scheduleSavePage, duplicatePage, setSelectedText,
    quickPad, updateQuickPad, quickPadTitle, updateQuickPadTitle,
    saveQuickPadToScene,
  } = useStudio();
  const [focusOverlay, setFocusOverlay] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showBeats, setShowBeats] = useState(false);
  const [newBeat, setNewBeat] = useState("");
  const taRef = useRef(null);

  // Continuity Sentinel — one-tap contradiction scan across every scene in the
  // active project. Result is a small drawer of flags with quoted evidence.
  const [continuityFlags, setContinuityFlags] = useState(null); // null | { flags, scanned }
  const [continuityLoading, setContinuityLoading] = useState(false);
  const runContinuity = async () => {
    if (!activeProject?.id) { toast.error("Open a project first"); return; }
    setContinuityLoading(true);
    setContinuityFlags(null);
    try {
      const r = await api.post("/ai/continuity", {
        project_id: activeProject.id,
        page_id: activePage?.id || null,
      });
      setContinuityFlags(r.data || { flags: [] });
    } catch (err) {
      toast.error("Continuity check failed");
      console.error(err);
    } finally {
      setContinuityLoading(false);
    }
  };

  // Wrap the current selection with markdown markers (** for bold, * for italic).
  // If nothing is selected, insert an empty pair so the caret sits between them.
  const wrapSelection = (marker) => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    const before = value.slice(0, start);
    const middle = value.slice(start, end);
    const after = value.slice(end);
    const next = `${before}${marker}${middle}${marker}${after}`;
    if (usingQuickPad) {
      updateQuickPad(next);
    } else if (activePage) {
      scheduleSavePage(activePage.id, { content: next });
    }
    // Restore focus + place caret after inserted text.
    requestAnimationFrame(() => {
      el.focus();
      const caret = middle ? end + marker.length * 2 : start + marker.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const usingQuickPad = !activePage;

  const stopSpeak = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  };
  const speakPage = () => {
    const text = usingQuickPad ? quickPad : (activePage?.content || "");
    if (!text || !("speechSynthesis" in window)) { toast.error("Nothing to read"); return; }
    stopSpeak();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  const beats = activePage?.beats || [];
  const addBeat = () => {
    if (!newBeat.trim() || usingQuickPad) return;
    scheduleSavePage(activePage.id, { beats: [...beats, newBeat.trim()] });
    setNewBeat("");
  };
  const removeBeat = (i) => {
    if (usingQuickPad) return;
    const next = beats.slice();
    next.splice(i, 1);
    scheduleSavePage(activePage.id, { beats: next });
  };

  const [coaching, setCoaching] = useState(false);
  const suggestBeats = async () => {
    if (usingQuickPad) return;
    setCoaching(true);
    try {
      const r = await api.post("/ai/beats", {
        scene_content: activePage?.content || "",
        existing_beats: beats,
        project_id: activeProject?.id,
        page_id: activePage?.id,
      });
      const merged = [...beats, ...(r.data.beats || [])];
      scheduleSavePage(activePage.id, { beats: merged });
      toast.success("Beat Coach added suggestions");
    } catch (_) {
      toast.error("Beat Coach couldn't finish");
    } finally {
      setCoaching(false);
    }
  };  const handleContentChange = (e) => {
    if (usingQuickPad) return updateQuickPad(e.target.value);
    scheduleSavePage(activePage.id, { content: e.target.value });
  };

  const handleTitleChange = (e) => {
    if (usingQuickPad) return updateQuickPadTitle(e.target.value);
    scheduleSavePage(activePage.id, { title: e.target.value });
  };

  const handleSelect = () => {
    const ta = taRef.current;
    if (!ta) return;
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    setSelectedText(sel);
  };

  const currentContent = usingQuickPad ? quickPad : (activePage?.content || "");
  const currentTitle = usingQuickPad ? quickPadTitle : (activePage?.title || "");

  const copyAll = async () => {
    if (!currentContent) return;
    try {
      await navigator.clipboard.writeText(currentContent);
      toast.success("Copied to clipboard");
    } catch (_) {
      toast.error("Copy failed");
    }
  };

  const promoteQuickPadToScene = async () => {
    try {
      await saveQuickPadToScene();
    } catch (_) {
      toast.error("Save failed");
    }
  };

  const wc = useMemo(() => wordCount(currentContent), [currentContent]);
  const readTime = Math.max(1, Math.round(wc / 220));

  const isNote = !usingQuickPad && activePage?.kind === "note";
  const kindLabel = usingQuickPad ? "Quick Pad" : (isNote ? "Note" : "Scene");
  const kindIcon = usingQuickPad
    ? <Focus className="w-3 h-3" />
    : (isNote ? <StickyNote className="w-3 h-3" /> : <Feather className="w-3 h-3" />);

  return (
    <div className="w-full max-w-[860px] px-6 sm:px-10 py-8 flex flex-col calm-scroll overflow-y-auto" style={{ maxHeight: "calc(100vh - 64px)" }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-[10px] uppercase tracking-widest font-semibold flex items-center gap-1.5" style={{ color: "var(--sc-text-secondary)" }}>
          {kindIcon}
          {kindLabel}
          {usingQuickPad && (
            <span
              className="ml-2 px-1.5 py-0.5 rounded text-[9px]"
              style={{ background: "var(--sc-accent-secondary)", color: "var(--sc-bg-sheet)" }}
            >
              Saved on this device
            </span>
          )}
        </p>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--sc-text-secondary)" }}>
          <span data-testid="word-count">{wc.toLocaleString()} words</span>
          <span>·</span>
          <span data-testid="read-time">{readTime} min read</span>
          <button
            onClick={copyAll}
            className="ml-2 flex items-center gap-1 px-2 py-1 rounded border"
            style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
            data-testid="copy-page-btn"
            aria-label="Copy entire page"
          >
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
          <button
            onClick={() => (speaking ? stopSpeak() : speakPage())}
            className="flex items-center gap-1 px-2 py-1 rounded border"
            style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
            data-testid="read-aloud-btn"
            aria-label={speaking ? "Stop reading" : "Read page aloud"}
          >
            {speaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {speaking ? "Stop" : "Read"}
          </button>
          {!usingQuickPad && activePage?.kind === "scene" && (
            <button
              onClick={() => setShowBeats((s) => !s)}
              className="flex items-center gap-1 px-2 py-1 rounded border"
              style={{
                borderColor: "var(--sc-border)",
                color: showBeats ? "var(--sc-bg-sheet)" : "var(--sc-text-primary)",
                background: showBeats ? "var(--sc-accent-secondary)" : "transparent",
              }}
              data-testid="toggle-beats-btn"
              aria-label="Toggle beat sheet"
            >
              <ListChecks className="w-3.5 h-3.5" /> Beats
            </button>
          )}
          {!usingQuickPad && !isNote && activeProject && (
            <button
              onClick={runContinuity}
              disabled={continuityLoading}
              className="flex items-center gap-1 px-2 py-1 rounded border"
              style={{
                borderColor: "var(--sc-border)",
                color: "var(--sc-text-primary)",
                background: "transparent",
                opacity: continuityLoading ? 0.5 : 1,
              }}
              data-testid="continuity-scan-btn"
              aria-label="Check continuity"
              title="Scan every scene in this project for contradictions"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {continuityLoading ? "Scanning…" : "Continuity"}
            </button>
          )}
          {usingQuickPad ? (
            <button
              onClick={promoteQuickPadToScene}
              className="flex items-center gap-1 px-2 py-1 rounded"
              style={{ background: "var(--sc-accent-primary)", color: "var(--sc-bg-sheet)" }}
              data-testid="save-quickpad-to-project-btn"
              disabled={!quickPad.trim()}
            >
              Save to project
            </button>
          ) : (
            <button
              onClick={() => duplicatePage(activePage.id)}
              className="flex items-center gap-1 px-2 py-1 rounded border"
              style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
              data-testid="duplicate-current-btn"
              aria-label="Duplicate as new page"
            >
              Duplicate
            </button>
          )}
          <button
            onClick={() => setFocusOverlay((s) => !s)}
            className="flex items-center gap-1 px-2 py-1 rounded border"
            style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
            aria-label="Toggle focus overlay"
            data-testid="focus-mode-toggle"
          >
            {focusOverlay ? <EyeOff className="w-3.5 h-3.5" /> : <Focus className="w-3.5 h-3.5" />}
            {focusOverlay ? "Exit focus" : "Focus"}
          </button>
        </div>
      </div>

      <input
        value={currentTitle}
        onChange={handleTitleChange}
        placeholder={usingQuickPad ? "Untitled quick pad" : (isNote ? "Note title" : "Scene title")}
        className="font-serif-reader text-xl sm:text-3xl bg-transparent outline-none mb-6 border-b pb-2"
        style={{ color: "var(--sc-text-primary)", borderColor: "var(--sc-border)", caretColor: "var(--sc-accent-primary)" }}
        data-testid="page-title-input"
      />

      {continuityFlags && (
        <div
          className="mb-4 p-4 rounded-md border"
          style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-sheet)" }}
          data-testid="continuity-drawer"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest font-semibold flex items-center gap-1.5" style={{ color: "var(--sc-text-secondary)" }}>
              <ShieldAlert className="w-3 h-3" />
              Continuity Sentinel
              {typeof continuityFlags.scanned === "number" && (
                <span className="normal-case tracking-normal italic opacity-70">
                  · scanned {continuityFlags.scanned} scene{continuityFlags.scanned === 1 ? "" : "s"}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setContinuityFlags(null)}
              className="p-1 rounded hover:bg-black/5"
              aria-label="Dismiss continuity results"
              data-testid="continuity-dismiss-btn"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {(!continuityFlags.flags || continuityFlags.flags.length === 0) ? (
            <p className="text-sm italic" style={{ color: "var(--sc-text-secondary)" }} data-testid="continuity-empty">
              {continuityFlags.note || "No contradictions found. Your world holds together."}
            </p>
          ) : (
            <ul className="space-y-3">
              {continuityFlags.flags.map((f, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 p-2 rounded border"
                  style={{
                    borderColor: f.severity === "high" ? "#a04a3a" : "var(--sc-border)",
                    background: "transparent",
                  }}
                  data-testid={`continuity-flag-${i}`}
                >
                  <AlertTriangle
                    className="w-4 h-4 mt-0.5 shrink-0"
                    style={{ color: f.severity === "high" ? "#c66a58" : f.severity === "medium" ? "#c9a24b" : "var(--sc-text-secondary)" }}
                  />
                  <div className="flex-1 text-sm">
                    <p style={{ color: "var(--sc-text-primary)" }}>{f.note}</p>
                    {f.scene_title && f.quote && (
                      <p className="mt-1 italic" style={{ color: "var(--sc-text-secondary)" }}>
                        In <b>{f.scene_title}</b>: “{f.quote}”
                      </p>
                    )}
                    {f.conflicts_with && f.prior_quote && (
                      <p className="italic" style={{ color: "var(--sc-text-secondary)" }}>
                        Earlier in <b>{f.conflicts_with}</b>: “{f.prior_quote}”
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showBeats && !usingQuickPad && activePage?.kind === "scene" && (
        <div
          className="mb-4 p-4 rounded-md border"
          style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-sheet)" }}
          data-testid="beat-sheet"
        >
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--sc-text-secondary)" }}>
            Beat sheet
          </p>
          <ul className="space-y-1 mb-2">
            {beats.map((b, i) => (
              <li key={`${i}-${b}`} className="group flex items-start gap-2 text-sm" data-testid={`beat-row-${i}`}>
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--sc-accent-primary)" }} />
                <span className="flex-1" style={{ color: "var(--sc-text-primary)" }}>{b}</span>
                <button
                  onClick={() => removeBeat(i)}
                  className="opacity-40 group-hover:opacity-100 p-0.5 rounded hover:bg-black/5"
                  aria-label="Remove beat"
                  data-testid={`remove-beat-${i}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
            {beats.length === 0 && (
              <li className="text-xs italic" style={{ color: "var(--sc-text-secondary)" }}>
                No beats yet — sketch the shape of this scene in bullets.
              </li>
            )}
          </ul>
          <div className="flex gap-2">
            <input
              value={newBeat}
              onChange={(e) => setNewBeat(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addBeat())}
              placeholder="Add a beat and press Enter"
              className="flex-1 text-sm px-2 py-1.5 rounded border bg-transparent"
              style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
              data-testid="new-beat-input"
            />
            <button
              onClick={addBeat}
              className="text-sm px-3 rounded"
              style={{ background: "var(--sc-accent-primary)", color: "var(--sc-bg-sheet)" }}
              data-testid="add-beat-btn"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={suggestBeats}
              disabled={coaching}
              className="text-sm px-3 rounded flex items-center gap-1"
              style={{ background: "var(--sc-accent-secondary)", color: "var(--sc-bg-sheet)", opacity: coaching ? 0.6 : 1 }}
              data-testid="beat-coach-btn"
              title="Ask Jupiter for more beats"
            >
              <Wand2 className="w-4 h-4" />
              {coaching ? "Coaching…" : "Coach"}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 mb-2" data-testid="editor-format-toolbar">
        <button
          type="button"
          onClick={() => wrapSelection("**")}
          className="px-2 py-1 rounded text-sm border hover:bg-black/5"
          style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
          title="Bold (wraps selection with **)"
          data-testid="editor-bold-btn"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("*")}
          className="px-2 py-1 rounded text-sm border hover:bg-black/5"
          style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
          title="Italic (wraps selection with *)"
          data-testid="editor-italic-btn"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] italic ml-2" style={{ color: "var(--sc-text-secondary)" }}>
          markdown — **bold** and *italic* render in Jupiter's replies
        </span>
      </div>

      <textarea
        ref={taRef}
        value={currentContent}
        onChange={handleContentChange}
        onSelect={handleSelect}
        placeholder={usingQuickPad
          ? "Start writing without a project — this scratch pad is saved on your device. Use any mode on it. When you're ready, hit \u201cSave to project\u201d."
          : (isNote
            ? "Jot anything: worldbuilding, research, ideas that don't fit elsewhere."
            : "The scene begins here. Write freely — nothing is off-limits.")}
        className="prose-editor min-h-[60vh] calm-scroll"
        data-testid="prose-editor"
      />

      {focusOverlay && (
        <>
          <div
            className="pointer-events-none fixed left-0 right-0 top-0 z-10"
            style={{ height: "35vh", background: "linear-gradient(to bottom, var(--sc-bg-app), transparent)" }}
          />
          <div
            className="pointer-events-none fixed left-0 right-0 bottom-0 z-10"
            style={{ height: "35vh", background: "linear-gradient(to top, var(--sc-bg-app), transparent)" }}
          />
        </>
      )}

      {!focusOverlay && (activePage || usingQuickPad) && (
        <div className="mt-6">
          <FeatureChat
            title={`Talk about ${activePage ? (activePage.title || "this page") : "this pad"}`}
            context={`You are helping the writer with the passage below. Stay in the story's register, be direct and useful, no meta. Reply in plain prose (bold with **, italics with *).\n\nPASSAGE (${activePage?.kind || "quickpad"}):\n${(activePage ? activePage.content : quickPad) || "(empty page)"}`}
            storageKey={`begin_scene_chat_${activePage?.id || "quickpad"}`}
            placeholder="Ask about this passage — pacing, voice, what's missing…"
            projectId={activeProject?.id || null}
            pageId={activePage?.id || null}
            testIdPrefix="scene-chat"
          />
        </div>
      )}
    </div>
  );
}
