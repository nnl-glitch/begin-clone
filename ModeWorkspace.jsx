import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../lib/studio";
import { streamAI, api } from "../lib/api";
import { toast } from "sonner";
import {
  ScrollText, MessagesSquare, Wand2, Sparkles, TrendingUp,
  Play, RotateCcw, Copy, Check, Volume2, VolumeX, Send, Camera, Brain, Sparkle, Eraser, Plus, BookmarkPlus,
} from "lucide-react";
import { RecallDialog } from "./RecallDialog";
import { UserBubble, JupiterBubble } from "./ChatBubble";

/**
 * Parse the mode's raw output string into a chat transcript. New sessions use
 * control-character sentinels (`\u0001BEGIN_U\u0001`, `\u0001BEGIN_A\u0001`)
 * that no LLM will emit — earlier iterations used visible em-dash markers
 * (`──── you ────` / `──── jupiter ────`), which Jupiter would occasionally
 * echo back in stylistic section headers and shred the transcript.
 *
 * Format (new): `<initial jupiter reply>\u0001BEGIN_U\u0001<q>\u0001BEGIN_A\u0001<r>…`
 * Format (legacy, still supported for older history): visible em-dash markers.
 */
const U_SENTINEL = "\u0001BEGIN_U\u0001";
const A_SENTINEL = "\u0001BEGIN_A\u0001";

// Legacy visible markers use a mix of `─` (U+2500), `—` (em dash), or plain
// dashes depending on when the session was saved. Match any 2+ horizontal-ish
// characters around the role label so old threads still split into bubbles.
const LEGACY_USER_RE = /[─—–\-]{2,}\s*you\s*[─—–\-]{2,}/gi;
const LEGACY_ASST_RE = /[─—–\-]{2,}\s*(?:companion|jupiter)\s*[─—–\-]{2,}/gi;

// Paranoid stripper: catches sentinels even when the surrounding `\u0001`
// control characters were mangled by an intermediate serializer, and legacy
// em-dash markers embedded in a rendered bubble. Also strips role labels
// (`**You**` / `**Jupiter**`) and `---` separators that leak in when a
// saved-conversation scene is reopened as a passage. This is applied to every
// piece of user/assistant text before we hand it to the bubble.
const RESIDUAL_SENTINEL_RE = /[\u0001\ufffd]?BEGIN_[UA][\u0001\ufffd]?/g;
const ROLE_LABEL_LEAD_RE = /^\s*\*\*(?:You|Jupiter)\*\*\s*(?:\n+|$)/i;
const ROLE_LABEL_SEP_RE = /\n{1,3}-{3,}\n{1,3}\*\*(?:You|Jupiter)\*\*\s*\n+/gi;
function stripResiduals(s) {
  if (!s) return "";
  return s
    .split(U_SENTINEL).join("")
    .split(A_SENTINEL).join("")
    .replace(RESIDUAL_SENTINEL_RE, "")
    .replace(LEGACY_USER_RE, "")
    .replace(LEGACY_ASST_RE, "")
    .replace(ROLE_LABEL_SEP_RE, "\n\n")
    .replace(ROLE_LABEL_LEAD_RE, "")
    .trim();
}

function parseTranscript(passage, output) {
  const clean = (output || "").trim();
  const turns = [];
  const cleanedPassage = stripResiduals(passage || "");
  if (cleanedPassage) {
    turns.push({ role: "user", content: cleanedPassage });
  }
  if (!clean) return turns;

  // Prefer the new control-character sentinel; fall back to legacy visible
  // markers (across every horizontal-line variant) for previously-saved
  // sessions.
  const usesNew = clean.includes(U_SENTINEL) || clean.includes(A_SENTINEL);
  const userSplit = usesNew ? U_SENTINEL : LEGACY_USER_RE;
  const asstSplit = usesNew ? A_SENTINEL : LEGACY_ASST_RE;

  const pieces = clean.split(userSplit);
  const first = pieces.shift() || "";
  const firstReply = stripResiduals(first);
  if (firstReply) turns.push({ role: "assistant", content: firstReply });

  for (const piece of pieces) {
    const [q, ...rest] = piece.split(asstSplit);
    turns.push({ role: "user", content: stripResiduals(q || "") });
    const r = stripResiduals(rest.join(""));
    if (r) turns.push({ role: "assistant", content: r });
    else turns.push({ role: "assistant", content: "" }); // streaming placeholder
  }
  return turns;
}

export const MODES = [
  { id: "collaborate", label: "Collaborate", icon: MessagesSquare, hint: "Brainstorm, don't judge",
    title: "Write with Jupiter",
    desc: "A blank page and a willing partner. Brainstorm, draft, follow an idea wherever it wants to go.",
    passageLabel: "What's on your mind?",
    passagePlaceholder: "Type an opening line, a question, a fragment — anything to begin from…",
    runLabel: "Start a conversation" },
  { id: "analyze", label: "Analyze", icon: ScrollText, hint: "Tone, pacing, subtext",
    title: "Craft analysis",
    desc: "Paste a passage and Jupiter will read it like an editor — rhythm, pacing, point of view, word choice, structure, and the subtext beneath the surface.",
    passageLabel: "Passage",
    passagePlaceholder: "Paste the passage you want examined…",
    runLabel: "Run analysis" },
  { id: "interpret", label: "Interpret", icon: Sparkles, hint: "Themes & symbolism",
    title: "An emotional reading",
    desc: "Paste a passage and Jupiter will respond as a human reader — the feeling first, then the associations it calls up, then the meaning that emerges.",
    passageLabel: "Passage",
    passagePlaceholder: "Paste the passage you want read…",
    runLabel: "Read it back" },
  { id: "revise", label: "Revise", icon: Wand2, hint: "Polish prose (keeps voice)",
    title: "Revise",
    desc: "Paste prose and set how far Jupiter should go — from a quiet fix of errors to a full rewrite. Copy the result when it lands.",
    passageLabel: "Prose to revise",
    passagePlaceholder: "Paste the prose you want revised…",
    runLabel: "Revise" },
  { id: "evolution", label: "Evolution", icon: TrendingUp, hint: "Character arc shifts",
    title: "Character evolution",
    desc: "Paste a story, chapter, or scene and Jupiter will trace how a character moves and changes across it, beat by beat.",
    passageLabel: "Document",
    passagePlaceholder: "Paste the document you want traced…",
    runLabel: "Trace evolution" },
];

const STYLES = [
  { id: "", label: "Writer's own voice" },
  { id: "gothic", label: "Gothic" },
  { id: "noir", label: "Noir" },
  { id: "cozy", label: "Cozy" },
  { id: "erotic", label: "Erotic" },
  { id: "literary", label: "Literary" },
  { id: "punchy", label: "Punchy" },
];

const REVISION_LEVELS = ["1 — Whisper", "2 — Light", "3 — Moderate", "4 — Bold", "5 — Rewrite"];

// Warm greeting Jupiter offers when the transcript is empty — softens the
// "cold start" of a blank workspace with a mode-tuned invitation.
const OPENERS = {
  collaborate: "Hi. Wherever you are with this — half-thought, dead-end, a line you can't shake — bring it over. We'll poke at it together.",
  analyze: "Paste the passage when you're ready. I'll read it slowly, twice, and tell you what I actually hear.",
  interpret: "Drop the passage in. I'll read it the way a person reads — feeling first, then meaning.",
  revise: "Paste the prose and tell me how far you want me to push it. I'll keep your voice; I'll just tighten what's blurry.",
  evolution: "Give me the scene or chapter and I'll trace the character across it — where they start, what turns, what they can't yet see.",
};

export function ModeWorkspace() {
  const {
    activeMode, setActiveMode,
    activeProject, activePage, setActivePageId, quickPad, updateQuickPad, selectedText,
    refreshHistory, threadToLoad, setThreadToLoad,
    savePassageToScene, snapshotSceneAndNote, updateProject, characters,
    createKeeper, loadCurrentThread,
  } = useStudio();

  // Persist last-session state to localStorage so offline / cold reload keeps
  // the writer where they were — outputs, passages, contexts per mode.
  const [outputs, setOutputs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("scribecraft_mode_outputs") || "{}"); }
    catch { return {}; }
  });
  // Passage is SHARED across all five modes now — writers can paste once in
  // Analyze and hop to Interpret / Revise without re-pasting. Legacy per-mode
  // passage state is migrated from localStorage on mount for continuity.
  const [passage, setPassageRaw] = useState(() => {
    try {
      const shared = localStorage.getItem("scribecraft_passage_shared");
      if (shared !== null) return shared;
      const legacy = JSON.parse(localStorage.getItem("scribecraft_mode_passages") || "{}");
      const first = Object.values(legacy).find((v) => (v || "").trim());
      return first || "";
    } catch { return ""; }
  });
  useEffect(() => {
    try { localStorage.setItem("scribecraft_passage_shared", passage || ""); } catch (_) {}
  }, [passage]);
  const [contexts, setContexts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("scribecraft_mode_contexts") || "{}"); }
    catch { return {}; }
  });
  const [parentIds, setParentIds] = useState({});
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState("");
  // Reference depth: per-mode dial (Analyze / Interpret / Collaborate).
  // Persisted so writers don't have to reselect every session.
  const [refDepthByMode, setRefDepthByMode] = useState(() => {
    try {
      const stored = localStorage.getItem("scribecraft_ref_depth_by_mode");
      if (stored) return JSON.parse(stored);
      // Migrate the older single-value keys — apply to all three modes.
      const legacy =
        localStorage.getItem("scribecraft_ref_depth") ||
        localStorage.getItem("scribecraft_interpret_ref_depth") ||
        "moderate";
      return { analyze: legacy, interpret: legacy, collaborate: legacy };
    } catch {
      return { analyze: "moderate", interpret: "moderate", collaborate: "moderate" };
    }
  });
  useEffect(() => {
    try { localStorage.setItem("scribecraft_ref_depth_by_mode", JSON.stringify(refDepthByMode)); }
    catch (_) {}
  }, [refDepthByMode]);
  const refDepth = refDepthByMode[activeMode] || "moderate";
  const setRefDepth = (v) => setRefDepthByMode((prev) => ({ ...prev, [activeMode]: v }));

  // Named depth presets — writers can bottle a favourite trio (e.g. "Deep
  // Reader": analyze deep + interpret moderate + collaborate none) and swap
  // between them in one tap.
  const [depthPresets, setDepthPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("scribecraft_depth_presets") || "[]");
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("scribecraft_depth_presets", JSON.stringify(depthPresets)); }
    catch (_) {}
  }, [depthPresets]);
  const applyDepthPreset = (presetId) => {
    const p = depthPresets.find((x) => x.id === presetId);
    if (!p) return;
    setRefDepthByMode({
      analyze: p.depths.analyze || "moderate",
      interpret: p.depths.interpret || "moderate",
      collaborate: p.depths.collaborate || "moderate",
    });
    toast(`Applied preset: ${p.name}`);
  };
  const saveDepthPreset = () => {
    const suggested = `Preset ${depthPresets.length + 1}`;
    const name = window.prompt(
      `Name this preset (Analyze: ${refDepthByMode.analyze}, Interpret: ${refDepthByMode.interpret}, Collaborate: ${refDepthByMode.collaborate}):`,
      suggested,
    );
    if (name === null) return;
    const trimmed = (name || suggested).trim() || suggested;
    const id = `preset-${Date.now()}`;
    setDepthPresets((prev) => [
      ...prev,
      { id, name: trimmed, depths: { ...refDepthByMode } },
    ]);
    toast(`Saved preset: ${trimmed}`);
  };
  const deleteDepthPreset = (presetId) => {
    const p = depthPresets.find((x) => x.id === presetId);
    if (!p) return;
    if (!window.confirm(`Delete preset "${p.name}"?`)) return;
    setDepthPresets((prev) => prev.filter((x) => x.id !== presetId));
  };
  const [revisionLevel, setRevisionLevel] = useState(3);
  const [character, setCharacter] = useState("");
  const [speakAsId, setSpeakAsId] = useState(() => {
    try { return localStorage.getItem("scribecraft_speak_as_id") || ""; }
    catch { return ""; }
  });
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [followup, setFollowup] = useState("");
  const [showRecall, setShowRecall] = useState(false);
  const [memoryUsed, setMemoryUsed] = useState({});   // per-mode: was project memory injected in the last run?
  const outputRef = useRef(null);
  const speechRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("scribecraft_mode_outputs", JSON.stringify(outputs)); } catch (_) {}
  }, [outputs]);
  useEffect(() => {
    try { localStorage.setItem("scribecraft_mode_contexts", JSON.stringify(contexts)); } catch (_) {}
  }, [contexts]);
  useEffect(() => {
    try { localStorage.setItem("scribecraft_speak_as_id", speakAsId || ""); } catch (_) {}
  }, [speakAsId]);

  // Scene sync: whenever the writer opens a scene from the sidebar, prefill
  // the SHARED passage so every mode sees it. The passage stays in place if
  // they navigate to a different mode.
  const lastLoadedPageId = useRef(null);
  useEffect(() => {
    if (!activeMode) return;
    if (!activePage || activePage.kind !== "scene") return;
    if (activePage.id === lastLoadedPageId.current) return;
    lastLoadedPageId.current = activePage.id;
    setPassageRaw(activePage.content || "");
  }, [activePage, activeMode]);

  const meta = MODES.find((m) => m.id === activeMode);
  const output = (activeMode && outputs[activeMode]) || "";
  const setOutputForMode = (u) => setOutputs((p) => ({ ...p, [activeMode]: typeof u === "function" ? u(p[activeMode] || "") : u }));

  const context = (activeMode && contexts[activeMode] !== undefined)
    ? contexts[activeMode]
    : (activeProject?.preamble || "");

  const setPassageForMode = (v) => {
    setPassageRaw(v);
    if (!activePage && !selectedText) updateQuickPad(v);
  };
  const setContextForMode = (v) => setContexts((p) => ({ ...p, [activeMode]: v }));

  useEffect(() => {
    if (!threadToLoad) return;
    setActiveMode(threadToLoad.mode);
    setOutputs((prev) => ({ ...prev, [threadToLoad.mode]: threadToLoad.transcript || "" }));
    setParentIds((prev) => ({ ...prev, [threadToLoad.mode]: threadToLoad.parentId || null }));
    if (threadToLoad.passage !== undefined) setPassageRaw(threadToLoad.passage);
    setThreadToLoad(null);
    setTimeout(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, 60);
  }, [threadToLoad, setActiveMode, setThreadToLoad]);

  useEffect(() => { stopSpeak(); /* eslint-disable-next-line */ }, [activeMode]);

  // Flatter model: when both a project and a mode are active, auto-load the
  // persistent thread for that (project, mode) pair. If none exists on the
  // server, local state is left untouched so the writer can start fresh.
  const lastLoadedPairRef = useRef(null);
  useEffect(() => {
    if (!activeProject?.id || !activeMode) return;
    const pair = `${activeProject.id}::${activeMode}`;
    if (lastLoadedPairRef.current === pair) return;
    lastLoadedPairRef.current = pair;
    loadCurrentThread(activeProject.id, activeMode).catch(() => {});
  }, [activeProject?.id, activeMode, loadCurrentThread]);

  const stopSpeak = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false); speechRef.current = null;
  };
  const speak = (text) => {
    if (!text || !("speechSynthesis" in window)) return;
    stopSpeak();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    try {
      const v = localStorage.getItem("scribecraft_voice");
      if (v) { const found = window.speechSynthesis.getVoices().find((x) => x.name === v); if (found) u.voice = found; }
    } catch (_) {}
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    speechRef.current = u;
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  const buildContext = () => {
    const bits = [activeProject?.synopsis || "", context || ""].filter(Boolean);
    if (activeMode === "revise") bits.push(`Revision level: ${revisionLevel}/5 (${REVISION_LEVELS[revisionLevel - 1]}).`);
    if (activeMode === "evolution" && character) bits.push(`Focus character: ${character}.`);
    return bits.join("\n\n");
  };

  const run = async () => {
    if (!passage.trim()) { toast.error("Add a passage first"); return; }
    setBusy(true);
    setOutputForMode("");
    setParentIds((p) => ({ ...p, [activeMode]: null }));
    // Autosave: pull the workspace context into the project's Companion memory so
    // the writer never has to retype the world setup on the next run.
    const ctxTrimmed = (context || "").trim();
    if (activeProject && ctxTrimmed && ctxTrimmed !== (activeProject.preamble || "").trim()) {
      updateProject(activeProject.id, { preamble: ctxTrimmed }).catch(() => {});
    }
    await streamAI({
      mode: activeMode, text: passage, context: buildContext(),
      style: style || null,
      project_id: activeProject?.id, page_id: activePage?.id, parent_id: null,
      speak_as_character_id: speakAsId || null,
      reference_depth: ["interpret", "analyze", "collaborate"].includes(activeMode) ? refDepth : null,
      onDelta: (d) => setOutputForMode((o) => o + d),
      onDone: (payload) => {
        setBusy(false);
        if (payload?.history_id) {
          setParentIds((p) => ({ ...p, [activeMode]: payload.history_id }));
          // Ask Jupiter for a short title for this fresh session (fire-and-forget).
          api.post(`/ai/history/${payload.history_id}/auto-title`)
            .then(() => refreshHistory && refreshHistory())
            .catch(() => {});
        }
        setMemoryUsed((p) => ({ ...p, [activeMode]: !!payload?.memory_used }));
        refreshHistory && refreshHistory();
      },
      onError: (e) => { toast.error(e.message || "Request failed"); setBusy(false); },
    });
  };

  const sendFollowup = async () => {
    const q = followup.trim(); if (!q) return;
    setFollowup(""); setBusy(true);
    setOutputForMode((prev) => (prev ? `${prev}${U_SENTINEL}${q}${A_SENTINEL}` : `${U_SENTINEL}${q}${A_SENTINEL}`));
    await streamAI({
      mode: activeMode, text: q,
      context: `Ongoing conversation. Prior passage:\n${passage}\n\nPrior reply:\n${output}\n\n${buildContext()}`,
      style: style || null,
      project_id: activeProject?.id, page_id: activePage?.id, parent_id: parentIds[activeMode] || null,
      speak_as_character_id: speakAsId || null,
      reference_depth: ["interpret", "analyze", "collaborate"].includes(activeMode) ? refDepth : null,
      onDelta: (d) => setOutputForMode((o) => o + d),
      onDone: (payload) => {
        setBusy(false);
        setMemoryUsed((p) => ({ ...p, [activeMode]: !!payload?.memory_used }));
        refreshHistory && refreshHistory();
      },
      onError: (e) => { toast.error(e.message || "Request failed"); setBusy(false); },
    });
  };

  const clearMode = () => { setOutputForMode(""); setParentIds((p) => ({ ...p, [activeMode]: null })); toast("Cleared — history still keeps it"); };
  const copyOutput = async () => { try { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch (_) {} };

  // Rebuild the passage + output pair from a mutated turns array (used by
  // per-bubble delete). The first user bubble in the transcript reflects the
  // passage; everything after is serialized back into the mode's `output`
  // using the new control-character sentinels. If a lone assistant turn ever
  // ends up mid-transcript (edge case: user deleted a middle user bubble), we
  // insert an empty U_SENTINEL first so the parser still splits cleanly and
  // never bleeds a raw sentinel into the reader's bubble.
  const serializeTurns = (turns) => {
    if (turns.length === 0) return "";
    let s = "";
    let i = 0;
    if (turns[0].role === "assistant") { s = turns[0].content; i = 1; }
    while (i < turns.length) {
      const cur = turns[i];
      if (cur.role === "user") {
        s += `${U_SENTINEL}${cur.content}${A_SENTINEL}`;
        i++;
        if (i < turns.length && turns[i].role === "assistant") { s += turns[i].content; i++; }
      } else {
        // Orphan assistant: front it with an empty user context so it still
        // parses as its own bubble. Never emit a bare A_SENTINEL.
        s += `${U_SENTINEL}${A_SENTINEL}${cur.content}`;
        i++;
      }
    }
    return s;
  };

  const deleteTurnAt = (turnIndex) => {
    const turns = parseTranscript(passage, output);
    if (turnIndex < 0 || turnIndex >= turns.length) return;
    if (!window.confirm("Remove this turn?")) return;
    // If the writer is deleting the very first user bubble (which mirrors the
    // active passage), just clear the passage — do not touch the transcript.
    const hasPassageBubble = (passage || "").trim() && turns[0]?.role === "user";
    if (hasPassageBubble && turnIndex === 0) {
      setPassageForMode("");
      toast("Passage cleared");
      return;
    }
    const outputTurns = hasPassageBubble ? turns.slice(1) : turns;
    const outputIndex = hasPassageBubble ? turnIndex - 1 : turnIndex;
    const next = outputTurns.filter((_, i) => i !== outputIndex);
    setOutputForMode(serializeTurns(next));
    toast("Turn deleted");
  };

  // Edit any bubble in place. First-user-bubble edits update the shared
  // passage; everything else is written back into the mode's output string.
  const editTurnAt = (turnIndex, newContent) => {
    const turns = parseTranscript(passage, output);
    if (turnIndex < 0 || turnIndex >= turns.length) return;
    const hasPassageBubble = (passage || "").trim() && turns[0]?.role === "user";
    if (hasPassageBubble && turnIndex === 0) {
      setPassageForMode(newContent);
      toast("Passage updated");
      return;
    }
    const outputTurns = hasPassageBubble ? turns.slice(1) : turns;
    const outputIndex = hasPassageBubble ? turnIndex - 1 : turnIndex;
    const next = outputTurns.map((t, i) => (i === outputIndex ? { ...t, content: newContent } : t));
    setOutputForMode(serializeTurns(next));
    toast("Saved");
  };

  // Save any bubble content as a fresh scene under the active project. Prompts
  // for a title so the writer keeps their sidebar tidy.
  const saveTurnAsScene = async (content) => {
    const trimmed = (content || "").trim();
    if (!trimmed) { toast.error("Nothing to save"); return; }
    const suggested = trimmed.split(/\s+/).slice(0, 6).join(" ").replace(/[.,;:!?"']$/, "") || "Saved scene";
    const title = window.prompt("Name this scene:", suggested);
    if (title === null) return; // cancelled
    await savePassageToScene(trimmed, title || suggested);
  };

  // One-tap repair: re-parse the current output through the sentinel-stripping
  // pipeline and re-serialize with clean sentinels. Purges any legacy markers
  // (visible em-dashes, stray `BEGIN_A` fragments, mangled control chars) that
  // got baked into an old thread's bubbles.
  const cleanSession = () => {
    const turns = parseTranscript(passage, output);
    if (turns.length === 0) { toast("Nothing to clean"); return; }
    const hasPassageBubble = (passage || "").trim() && turns[0]?.role === "user";
    const outputTurns = hasPassageBubble ? turns.slice(1) : turns;
    if (outputTurns.length === 0 && !passage) { toast("Nothing to clean"); return; }
    setOutputForMode(serializeTurns(outputTurns));
    toast("Session cleaned");
  };

  // Save the ENTIRE mode conversation (passage + every user follow-up + every
  // Jupiter reply) as one long scene. Each turn is prefixed with a bold role
  // label so the transcript still reads clearly in the scene editor.
  const saveThreadAsScene = async () => {    const turns = parseTranscript(passage, output);
    if (turns.length === 0) { toast.error("Nothing to save yet"); return; }
    const body = turns
      .map((t) => (t.role === "user" ? `**You**\n\n${t.content}` : `**Jupiter**\n\n${t.content}`))
      .join("\n\n---\n\n");
    const modeLabel = activeMode ? activeMode[0].toUpperCase() + activeMode.slice(1) : "Conversation";
    const rawFirst = (passage || "").split("\n")[0].trim();
    // Trim at the last whitespace before 40 chars so titles don't end mid-word.
    let firstLine = rawFirst.slice(0, 40);
    if (rawFirst.length > 40) {
      const cut = firstLine.lastIndexOf(" ");
      if (cut > 15) firstLine = firstLine.slice(0, cut);
      firstLine = firstLine.replace(/[.,;:!?"']+$/, "") + "…";
    }
    const suggested = `${modeLabel}${firstLine ? ` — ${firstLine}` : ""}`;
    const title = window.prompt("Name this scene (the whole conversation will be saved):", suggested);
    if (title === null) return;
    await savePassageToScene(body, title || suggested);
  };

  // Regenerate from any turn. For a user turn: drop everything after it and
  // re-run with that prompt. For a Jupiter turn: drop it (and anything after)
  // and re-run from the preceding user prompt.
  const regenerateFromTurn = async (turnIndex) => {
    const turns = parseTranscript(passage, output);
    if (turnIndex < 0 || turnIndex >= turns.length) return;
    const hasPassageBubble = (passage || "").trim() && turns[0]?.role === "user";
    // Find the user prompt to replay.
    let promptIndex = turnIndex;
    if (turns[turnIndex].role === "assistant") {
      promptIndex = turnIndex - 1;
      while (promptIndex >= 0 && turns[promptIndex].role !== "user") promptIndex--;
    }
    if (promptIndex < 0) { toast.error("No prompt to replay"); return; }

    // Passage-bubble replay = the fresh `run()` flow.
    if (hasPassageBubble && promptIndex === 0) {
      setOutputForMode("");
      await run();
      return;
    }

    // Follow-up replay: keep everything up to and including this user turn,
    // drop the rest, then stream a new reply.
    const outputTurns = hasPassageBubble ? turns.slice(1) : turns;
    const outputPromptIdx = hasPassageBubble ? promptIndex - 1 : promptIndex;
    const kept = outputTurns.slice(0, outputPromptIdx + 1);
    const q = outputTurns[outputPromptIdx].content;
    // Rebuild output with the retained turns plus an empty assistant slot.
    const priorSerialized = serializeTurns([...kept, { role: "assistant", content: "" }]);
    setOutputForMode(priorSerialized);
    setBusy(true);
    await streamAI({
      mode: activeMode, text: q,
      context: `Ongoing conversation. Prior passage:\n${passage}\n\n${buildContext()}`,
      style: style || null,
      project_id: activeProject?.id, page_id: activePage?.id, parent_id: parentIds[activeMode] || null,
      speak_as_character_id: speakAsId || null,
      reference_depth: ["interpret", "analyze", "collaborate"].includes(activeMode) ? refDepth : null,
      onDelta: (d) => setOutputForMode((o) => o + d),
      onDone: (payload) => {
        setBusy(false);
        setMemoryUsed((p) => ({ ...p, [activeMode]: !!payload?.memory_used }));
        refreshHistory && refreshHistory();
      },
      onError: (e) => { toast.error(e.message || "Request failed"); setBusy(false); },
    });
  };

  if (!activeMode) return null;

  const inputStyle = {
    borderColor: "var(--sc-border)",
    background: "transparent",
    color: "var(--sc-text-primary)",
  };

  const newSession = () => {
    stopSpeak();
    setPassageRaw("");
    setOutputs((p) => ({ ...p, [activeMode]: "" }));
    setContexts((p) => ({ ...p, [activeMode]: "" }));
    setParentIds((p) => ({ ...p, [activeMode]: null }));
    setMemoryUsed((p) => ({ ...p, [activeMode]: false }));
    setActivePageId(null);
    lastLoadedPageId.current = null;
    setFollowup("");
    toast("New session");
  };

  return (
    <div className="flex-1 w-full flex flex-col min-h-0 overflow-hidden" data-testid="mode-workspace">
      {/* Per-feature header row: context on the left, eraser + new-session on the right */}
      <div
        className="shrink-0 border-b px-4 sm:px-10 py-2.5 flex items-center gap-3"
        style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-app)" }}
        data-testid="mode-header"
      >
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
            {(activePage?.kind === "scene" && activePage?.title) ? activePage.title : (meta?.label || activeMode)}
          </p>
          <p
            className="font-serif-reader text-sm sm:text-base truncate"
            style={{ color: "var(--sc-text-primary)" }}
            data-testid="mode-header-subtitle"
          >
            {activePage?.kind === "scene" && activePage?.title
              ? `${activePage.title} — ${(passage || activePage.content || "").split("\n")[0].slice(0, 80) || "empty"}${(passage || activePage.content || "").length > 80 ? "…" : ""}`
              : (passage || output ? ((passage || output).split("\n")[0].slice(0, 80) + ((passage || output).length > 80 ? "…" : "")) : meta?.title)
            }
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={saveThreadAsScene}
            className="w-9 h-9 rounded-full flex items-center justify-center transition hover:opacity-80"
            style={{ border: "1px solid var(--sc-border)", color: "var(--sc-text-primary)" }}
            aria-label="Save whole conversation as scene"
            title="Save the entire conversation as one scene"
            data-testid="mode-header-save-thread-btn"
          >
            <BookmarkPlus className="w-4 h-4" />
          </button>
          <button
            onClick={cleanSession}
            className="w-9 h-9 rounded-full flex items-center justify-center transition hover:opacity-80"
            style={{ border: "1px solid var(--sc-border)", color: "var(--sc-text-primary)" }}
            aria-label="Clean this session"
            title="Re-serialize the transcript to strip any residual markers"
            data-testid="mode-header-clean-btn"
          >
            <Wand2 className="w-4 h-4" />
          </button>
          <button
            onClick={clearMode}
            className="w-9 h-9 rounded-full flex items-center justify-center transition hover:opacity-80"
            style={{ border: "1px solid var(--sc-border)", color: "var(--sc-text-primary)" }}
            aria-label="Clear conversation"
            title="Clear this conversation (keeps the passage)"
            data-testid="mode-header-clear-btn"
          >
            <Eraser className="w-4 h-4" />
          </button>
          <button
            onClick={newSession}
            className="w-9 h-9 rounded-full flex items-center justify-center transition hover:opacity-90"
            style={{ background: "#EFE7D6", color: "#1A1918" }}
            aria-label="New session"
            title="New session (clears passage + reply)"
            data-testid="mode-header-new-btn"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto calm-scroll" ref={outputRef}>
        <div className="max-w-2xl mx-auto px-4 sm:px-10 py-6 sm:py-10">
          <h1 className="font-serif-reader text-3xl sm:text-5xl leading-[1.15] sm:leading-[1.1]" style={{ color: "var(--sc-text-primary)" }} data-testid="mode-title">
            {meta?.title}
          </h1>
          <p className="mt-3 sm:mt-4 text-sm sm:text-base leading-relaxed" style={{ color: "var(--sc-text-secondary)" }}>
            {meta?.desc}
          </p>

          {!output && !busy && OPENERS[activeMode] && (
            <div className="mt-6 sm:mt-8" data-testid="mode-opener">
              <JupiterBubble testId={`mode-opener-bubble-${activeMode}`}>
                {OPENERS[activeMode]}
              </JupiterBubble>
            </div>
          )}

          {activeMode === "evolution" && (
            <div className="mt-8">
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "var(--sc-text-secondary)" }}>Character</p>
              <select value={character} onChange={(e) => setCharacter(e.target.value)} className="w-full text-base p-3 rounded-md border" style={inputStyle} data-testid="evolution-character-select">
                <option value="">Auto-detect (protagonist)</option>
              </select>
            </div>
          )}

          <div className="mt-6 sm:mt-8">
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "var(--sc-text-secondary)" }}>{meta?.passageLabel}</p>
            <textarea
              value={passage}
              onChange={(e) => setPassageForMode(e.target.value)}
              placeholder={meta?.passagePlaceholder}
              className="prose-editor w-full rounded-md border p-3 sm:p-4 min-h-[140px] sm:min-h-[220px]"
              style={inputStyle}
              data-testid="mode-passage-view"
            />
          </div>

          {(() => {
            const pinned = (characters || []).filter(
              (c) => c.pinned && (c.voice_preamble || "").trim()
            );
            if (pinned.length === 0) return null;
            return (
              <div className="mt-5" data-testid="speak-as-chips">
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--sc-text-secondary)" }}>
                  Speak as
                </p>
                <div className="flex flex-wrap gap-2">
                  {pinned.map((c) => {
                    const active = speakAsId === c.id;
                    const initials = (c.name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSpeakAsId(active ? "" : c.id)}
                        className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full text-sm border transition hover:-translate-y-0.5"
                        style={{
                          borderColor: active ? "transparent" : "var(--sc-border)",
                          background: active ? "#EFE7D6" : "transparent",
                          color: active ? "#1A1918" : "var(--sc-text-primary)",
                          fontFamily: "var(--font-serif-reader, serif)",
                        }}
                        data-testid={`speak-as-chip-${c.id}`}
                        aria-pressed={active}
                        title={active ? `Jupiter is speaking as ${c.name} — tap to release` : `One-tap speak as ${c.name}`}
                      >
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
                          style={{
                            background: active ? "#1A1918" : "color-mix(in oklab, var(--sc-accent-primary) 25%, transparent)",
                            color: active ? "#EFE7D6" : "var(--sc-text-primary)",
                          }}
                          aria-hidden
                        >
                          {initials || "•"}
                        </span>
                        {c.name || "Unnamed"}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {(activeMode === "interpret" || activeMode === "analyze" || activeMode === "collaborate") && (
            <div className="mt-6" data-testid="ref-depth-control">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
                  Reference depth
                </p>
                <div className="flex items-center gap-1.5">
                  {depthPresets.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) applyDepthPreset(e.target.value); }}
                      className="text-[11px] px-2 py-1 rounded-full border bg-transparent"
                      style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-secondary)", fontFamily: "var(--font-serif-reader, serif)" }}
                      aria-label="Load preset"
                      data-testid="ref-depth-preset-select"
                    >
                      <option value="">Load preset…</option>
                      {depthPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (A:{p.depths.analyze[0].toUpperCase()} · I:{p.depths.interpret[0].toUpperCase()} · C:{p.depths.collaborate[0].toUpperCase()})
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={saveDepthPreset}
                    className="text-[11px] px-2 py-1 rounded-full border hover:opacity-80"
                    style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-secondary)", fontFamily: "var(--font-serif-reader, serif)" }}
                    title="Save current per-mode depths as a named preset"
                    data-testid="ref-depth-preset-save"
                  >
                    Save preset
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "none", label: "None", hint: "Stay inside the passage" },
                  { id: "light", label: "Light", hint: "1–2 glancing references" },
                  { id: "moderate", label: "Moderate", hint: "2–4 concrete references" },
                  { id: "deep", label: "Deep", hint: "4–7, wide-ranging" },
                ].map((opt) => {
                  const active = refDepth === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRefDepth(opt.id)}
                      className="px-3 py-1 rounded-full text-sm border transition hover:-translate-y-0.5"
                      style={{
                        borderColor: active ? "transparent" : "var(--sc-border)",
                        background: active ? "#EFE7D6" : "transparent",
                        color: active ? "#1A1918" : "var(--sc-text-primary)",
                        fontFamily: "var(--font-serif-reader, serif)",
                      }}
                      title={opt.hint}
                      aria-pressed={active}
                      data-testid={`ref-depth-${opt.id}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] italic" style={{ color: "var(--sc-text-secondary)" }}>
                {activeMode === "interpret" && "How many literary, film, music, and myth references Jupiter weaves into a reading."}
                {activeMode === "analyze" && "How many craft comparisons Jupiter draws from other writers when editing."}
                {activeMode === "collaborate" && "Stylistic touchstones that shape Jupiter's composed prose (never named inside the fiction)."}
              </p>
              {depthPresets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" data-testid="ref-depth-preset-chips">
                  {depthPresets.map((p) => (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border"
                      style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-secondary)" }}
                    >
                      {p.name}
                      <button
                        type="button"
                        onClick={() => deleteDepthPreset(p.id)}
                        className="opacity-60 hover:opacity-100"
                        aria-label={`Delete preset ${p.name}`}
                        data-testid={`ref-depth-preset-delete-${p.id}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {(activeMode === "analyze" || activeMode === "interpret" || activeMode === "collaborate") && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
                  Context <span className="normal-case tracking-normal">(optional)</span>
                </p>
                {activeProject && (
                  <span className="text-[10px] italic" style={{ color: "var(--sc-text-secondary)" }} data-testid="context-memory-hint">
                    saved to {activeProject.title}'s memory
                  </span>
                )}
              </div>
              <textarea
                value={context}
                onChange={(e) => setContextForMode(e.target.value)}
                placeholder="Anything Jupiter should know — intent, audience, what came before…"
                className="prose-editor w-full rounded-md border p-4 min-h-[100px]"
                style={inputStyle}
                data-testid="mode-context-input"
              />
            </div>
          )}

          {activeMode === "revise" && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>Revision level</p>
                <p className="text-sm" style={{ color: "var(--sc-text-primary)" }}>{REVISION_LEVELS[revisionLevel - 1]}</p>
              </div>
              <input type="range" min={1} max={5} step={1} value={revisionLevel} onChange={(e) => setRevisionLevel(parseInt(e.target.value))}
                className="w-full accent-current" style={{ accentColor: "var(--sc-accent-primary)" }} data-testid="revision-level-slider" />
              <div className="flex justify-between mt-1 text-xs" style={{ color: "var(--sc-text-secondary)" }}>
                {[1, 2, 3, 4, 5].map((n) => <span key={n}>{n}</span>)}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center gap-4 text-xs flex-wrap" style={{ color: "var(--sc-text-secondary)" }}>
            <div className="flex items-center gap-2">
              <span>Style</span>
              <select value={style} onChange={(e) => setStyle(e.target.value)} className="text-sm px-2 py-1.5 rounded border" style={inputStyle} data-testid="mode-style-select">
                {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            {activeProject && characters && characters.filter((c) => (c.voice_preamble || "").trim()).length > 0 && (
              <div className="flex items-center gap-2">
                <span>Speak as</span>
                <select value={speakAsId} onChange={(e) => setSpeakAsId(e.target.value)} className="text-sm px-2 py-1.5 rounded border" style={inputStyle} data-testid="speak-as-select">
                  <option value="">— Jupiter's own voice —</option>
                  {characters.filter((c) => (c.voice_preamble || "").trim()).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={run}
              disabled={busy || !passage.trim()}
              className="px-8 py-3 rounded-full font-serif-reader text-base transition disabled:opacity-50"
              style={{ background: "#EFE7D6", color: "#1A1918", fontWeight: 500 }}
              data-testid="mode-run-btn"
            >
              <span className="inline-flex items-center gap-2"><Sparkle className="w-4 h-4" />{busy ? "Working…" : meta?.runLabel}</span>
            </button>
            <button onClick={() => savePassageToScene(passage)} disabled={!passage.trim()}
              className="px-5 py-3 rounded-full text-sm border disabled:opacity-40"
              style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
              data-testid="save-as-scene-btn">Save as scene</button>
            <button onClick={() => snapshotSceneAndNote(passage, output, meta?.label)} disabled={!passage.trim() && !output.trim()}
              className="px-5 py-3 rounded-full text-sm border flex items-center gap-1.5 disabled:opacity-40"
              style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
              data-testid="snapshot-btn"><Camera className="w-3.5 h-3.5" /> Snapshot</button>
            <button onClick={() => setShowRecall(true)} disabled={!activeProject}
              className="px-5 py-3 rounded-full text-sm border flex items-center gap-1.5 disabled:opacity-40"
              style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
              data-testid="recall-btn"><Brain className="w-3.5 h-3.5" /> Recall</button>
          </div>

          {(output || busy) && (
            <div className="mt-10">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>Conversation</p>
                  {memoryUsed[activeMode] && (
                    <span
                      className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1"
                      style={{
                        background: "color-mix(in oklab, var(--sc-accent-primary) 20%, transparent)",
                        color: "var(--sc-text-secondary)",
                        border: "1px solid var(--sc-border)",
                      }}
                      data-testid="memory-used-chip"
                      title="Jupiter used the pinned project memory for this run"
                    >
                      <Brain className="w-3 h-3" /> memory used
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {output && (
                    <>
                      <button onClick={() => (speaking ? stopSpeak() : speak(output))}
                        className="text-xs flex items-center gap-1 px-2 py-1 rounded border"
                        style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
                        data-testid="mode-read-output-btn">
                        {speaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={clearMode} className="text-xs flex items-center gap-1 px-2 py-1 rounded border"
                        style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }} data-testid="mode-clear-btn">
                        <RotateCcw className="w-3.5 h-3.5" /> Start fresh
                      </button>
                      <button onClick={copyOutput} className="text-xs flex items-center gap-1 px-2 py-1 rounded border"
                        style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }} data-testid="mode-copy-btn">
                        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-5" data-testid="mode-output">
                {(() => {
                  const turns = parseTranscript(passage, output);
                  return turns.map((turn, i) => {
                    // Skip action affordances on the empty streaming placeholder.
                    const isStreamingPlaceholder = busy && i === turns.length - 1 && turn.role === "assistant" && !turn.content;
                    const keepFromBubble = async (t) => {
                      const body = (t || "").trim();
                      if (!body) { toast.error("Nothing to keep"); return; }
                      if (!activeProject) { toast.error("Open a project first"); return; }
                      const suggested = body.split(/\s+/).slice(0, 8).join(" ").replace(/[.,;:!?]$/, "");
                      const title = window.prompt("Title for this keeper:", suggested) ?? suggested;
                      if (title === null) return;
                      await createKeeper({
                        title: (title || "").trim() || suggested,
                        body,
                        source_mode: activeMode,
                        source_bubble_role: turn.role,
                      });
                    };
                    const actions = isStreamingPlaceholder ? {} : {
                      onDelete: () => deleteTurnAt(i),
                      onEdit: (t) => editTurnAt(i, t),
                      onSave: (t) => saveTurnAsScene(t),
                      onKeep: activeProject ? keepFromBubble : undefined,
                      onRegenerate: () => regenerateFromTurn(i),
                    };
                    return turn.role === "user"
                      ? <UserBubble key={i} testId={`mode-turn-user-${i}`} {...actions}>{turn.content}</UserBubble>
                      : <JupiterBubble key={i} testId={`mode-turn-assistant-${i}`} {...actions}>{turn.content}</JupiterBubble>;
                  });
                })()}
                {busy && !output && (
                  <p className="italic pl-1" style={{ color: "var(--sc-text-secondary)" }}>Jupiter is thinking…</p>
                )}
              </div>
              {output && (
                <div className="mt-5 flex items-center gap-2">
                  <input value={followup} onChange={(e) => setFollowup(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendFollowup())}
                    placeholder="Follow up — push back, ask, refine…"
                    disabled={busy}
                    className="flex-1 text-sm px-4 py-2.5 rounded-full border bg-transparent"
                    style={inputStyle} data-testid="mode-followup-input" />
                  <button onClick={sendFollowup} disabled={busy || !followup.trim()}
                    className="px-4 py-2.5 rounded-full text-sm flex items-center gap-1 disabled:opacity-40"
                    style={{ background: "#EFE7D6", color: "#1A1918" }} data-testid="mode-followup-btn">
                    <Send className="w-3.5 h-3.5" /> Send
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="h-16" />
        </div>
      </div>

      {showRecall && (<RecallDialog project={activeProject} onClose={() => setShowRecall(false)} />)}
    </div>
  );
}
