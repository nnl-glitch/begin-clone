import React, { useState } from "react";
import { Volume2, VolumeX, X, Pencil, Check, Save, RefreshCw, Star } from "lucide-react";
import { Markdown } from "./Markdown";

/**
 * Shared bubble styling for every chat surface (FeatureChat + ModeWorkspace).
 * - User bubble: warm brown/tan, right-aligned, cream serif text.
 * - Jupiter bubble: dark slate, left-aligned, with a "Jupiter" name label above
 *   and a small "Listen" toggle so writers can hear the reply while pacing.
 *
 * All action props are optional — the affordance only renders when supplied.
 * onDelete       -> "×" removes this turn
 * onEdit(text)   -> pencil turns bubble into inline textarea; blur/Enter saves
 * onSave         -> save this bubble's content as a scene (legacy)
 * onKeep         -> save this bubble as a Keeper (flat model)
 * onRegenerate   -> refresh icon re-runs Jupiter from this turn
 */

const USER_BG = "#8F6A3F";          // warm tan/bronze
const ASSISTANT_BG = "#161C29";      // deep slate, sits on the navy page
const CREAM = "#EFE7D6";
const CREAM_SOFT = "#E9DFC9";

function IconBtn({ onClick, label, testid, tint = CREAM_SOFT, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="opacity-40 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition p-0.5 rounded-full hover:bg-black/20"
      aria-label={label}
      title={label}
      data-testid={testid}
    >
      {React.cloneElement(children, { className: "w-3.5 h-3.5", style: { color: tint } })}
    </button>
  );
}

export function UserBubble({ children, testId, onDelete, onEdit, onSave, onKeep, onRegenerate }) {
  const initialText = typeof children === "string" ? children : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialText);

  const commit = () => {
    const t = (draft || "").trim();
    setEditing(false);
    if (t && t !== initialText.trim() && onEdit) onEdit(t);
  };
  const cancel = () => { setEditing(false); setDraft(initialText); };

  return (
    <div className="group flex justify-end items-start gap-1.5" data-testid={testId}>
      <div className="mt-1 flex items-center gap-0.5">
        {onEdit && !editing && (
          <IconBtn onClick={() => { setDraft(initialText); setEditing(true); }} label="Edit this turn" testid={`${testId}-edit`}>
            <Pencil />
          </IconBtn>
        )}
        {onKeep && !editing && (
          <IconBtn onClick={() => onKeep(initialText)} label="Keep this turn" testid={`${testId}-keep`}>
            <Star />
          </IconBtn>
        )}
        {onSave && !editing && (
          <IconBtn onClick={() => onSave(initialText)} label="Save this turn as a scene" testid={`${testId}-save`}>
            <Save />
          </IconBtn>
        )}
        {onRegenerate && !editing && (
          <IconBtn onClick={() => onRegenerate(initialText)} label="Ask Jupiter again from this turn" testid={`${testId}-regen`}>
            <RefreshCw />
          </IconBtn>
        )}
        {onDelete && !editing && (
          <IconBtn onClick={onDelete} label="Delete this turn" testid={`${testId}-delete`}>
            <X />
          </IconBtn>
        )}
      </div>
      {editing ? (
        <div className="max-w-[86%] w-full flex flex-col gap-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
            className="rounded-2xl px-5 py-4 font-serif-reader whitespace-pre-wrap outline-none"
            style={{
              background: USER_BG,
              color: CREAM,
              fontSize: "var(--reader-font-size, 1rem)",
              lineHeight: "var(--reader-line-height, 1.7)",
              minHeight: "6rem",
              width: "100%",
              border: `1px solid ${CREAM_SOFT}`,
            }}
            data-testid={`${testId}-edit-input`}
          />
          <div className="flex items-center gap-2 justify-end text-[11px] uppercase tracking-widest" style={{ color: CREAM_SOFT }}>
            <button type="button" onClick={cancel} className="px-2 py-1 rounded-full hover:opacity-80" data-testid={`${testId}-edit-cancel`}>
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              className="flex items-center gap-1 px-3 py-1 rounded-full"
              style={{ background: CREAM, color: "#1A1918" }}
              data-testid={`${testId}-edit-save`}
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </div>
      ) : (
        <div
          className="max-w-[86%] rounded-2xl px-5 py-4 font-serif-reader whitespace-pre-wrap"
          style={{
            background: USER_BG,
            color: CREAM,
            fontSize: "var(--reader-font-size, 1rem)",
            lineHeight: "var(--reader-line-height, 1.7)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// Module-level ref so only ONE bubble reads aloud at a time — starting a
// new one cancels the previous.
let __activeUtterance = null;
let __activeSetter = null;

export function JupiterBubble({ children, testId, readable = true, onDelete, onEdit, onSave, onKeep, onRegenerate }) {
  const [speaking, setSpeaking] = useState(false);
  const text = typeof children === "string" ? children : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  const commit = () => {
    const t = draft;
    setEditing(false);
    if (t !== text && onEdit) onEdit(t);
  };
  const cancel = () => { setEditing(false); setDraft(text); };

  const toggle = () => {
    if (!("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      __activeUtterance = null; __activeSetter = null;
      return;
    }
    // Cancel any other bubble currently reading.
    window.speechSynthesis.cancel();
    if (__activeSetter) __activeSetter(false);

    const u = new SpeechSynthesisUtterance(text || "");
    u.rate = 0.95;
    try {
      const v = localStorage.getItem("scribecraft_voice");
      if (v) {
        const found = window.speechSynthesis.getVoices().find((x) => x.name === v);
        if (found) u.voice = found;
      }
    } catch (_) {}
    u.onend = () => { setSpeaking(false); __activeUtterance = null; __activeSetter = null; };
    u.onerror = () => { setSpeaking(false); __activeUtterance = null; __activeSetter = null; };
    __activeUtterance = u; __activeSetter = setSpeaking;
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };

  return (
    <div className="group flex flex-col items-start gap-1.5" data-testid={testId}>
      <div className="flex items-center gap-2 pl-1">
        <span
          className="font-serif-reader font-bold text-sm tracking-wide"
          style={{ color: CREAM }}
        >
          Jupiter
        </span>
        {readable && text && !editing && ("speechSynthesis" in (typeof window !== "undefined" ? window : {})) && (
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full transition hover:opacity-80"
            style={{
              color: speaking ? "#1A1918" : CREAM_SOFT,
              background: speaking ? CREAM : "transparent",
              border: `1px solid ${speaking ? CREAM : "rgba(233,223,201,0.25)"}`,
            }}
            aria-label={speaking ? "Stop reading" : "Listen"}
            data-testid="jupiter-bubble-listen"
          >
            {speaking ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
            {speaking ? "Stop" : "Listen"}
          </button>
        )}
        {onEdit && !editing && (
          <IconBtn onClick={() => { setDraft(text); setEditing(true); }} label="Edit this reply" testid={`${testId}-edit`}>
            <Pencil />
          </IconBtn>
        )}
        {onKeep && !editing && (
          <IconBtn onClick={() => onKeep(text)} label="Keep this reply" testid={`${testId}-keep`}>
            <Star />
          </IconBtn>
        )}
        {onSave && !editing && (
          <IconBtn onClick={() => onSave(text)} label="Save this reply as a scene" testid={`${testId}-save`}>
            <Save />
          </IconBtn>
        )}
        {onRegenerate && !editing && (
          <IconBtn onClick={() => onRegenerate(text)} label="Regenerate this reply" testid={`${testId}-regen`}>
            <RefreshCw />
          </IconBtn>
        )}
        {onDelete && !editing && (
          <IconBtn onClick={onDelete} label="Delete this turn" testid={`${testId}-delete`}>
            <X />
          </IconBtn>
        )}
      </div>
      {editing ? (
        <div className="max-w-[86%] w-full flex flex-col gap-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
            className="rounded-2xl px-5 py-4 font-serif-reader whitespace-pre-wrap outline-none"
            style={{
              background: ASSISTANT_BG,
              color: CREAM_SOFT,
              fontSize: "var(--reader-font-size, 1rem)",
              lineHeight: "var(--reader-line-height, 1.7)",
              minHeight: "8rem",
              width: "100%",
              border: `1px solid ${CREAM_SOFT}`,
            }}
            data-testid={`${testId}-edit-input`}
          />
          <div className="flex items-center gap-2 justify-start text-[11px] uppercase tracking-widest" style={{ color: CREAM_SOFT }}>
            <button type="button" onClick={cancel} className="px-2 py-1 rounded-full hover:opacity-80" data-testid={`${testId}-edit-cancel`}>
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              className="flex items-center gap-1 px-3 py-1 rounded-full"
              style={{ background: CREAM, color: "#1A1918" }}
              data-testid={`${testId}-edit-save`}
            >
              <Check className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </div>
      ) : (
        <div
          className="max-w-[86%] rounded-2xl px-5 py-4 font-serif-reader"
          style={{
            background: ASSISTANT_BG,
            color: CREAM_SOFT,
            fontSize: "var(--reader-font-size, 1rem)",
            lineHeight: "var(--reader-line-height, 1.7)",
          }}
        >
          <Markdown>{children || "…"}</Markdown>
        </div>
      )}
    </div>
  );
}
