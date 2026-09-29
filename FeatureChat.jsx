import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles } from "lucide-react";
import { streamAI } from "../lib/api";
import { UserBubble, JupiterBubble } from "./ChatBubble";

/**
 * A compact chat panel that runs Companion turns scoped to a specific feature
 * (a character, a scene, a project). Messages persist in localStorage keyed
 * by storageKey so writers can pick up where they left off.
 *
 * Props:
 *   title         — heading shown at the top of the panel
 *   context       — system-message extra text (character sheet, scene, project memory…)
 *   storageKey    — unique per-entity string; scopes localStorage
 *   placeholder   — input placeholder
 *   projectId     — passes through so backend can inject project preamble
 *   pageId        — optional
 *   testIdPrefix  — for data-testid uniqueness across mounted instances
 */
export function FeatureChat({ title, context, storageKey, placeholder = "Ask Jupiter…", projectId = null, pageId = null, testIdPrefix = "feature-chat" }) {
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch (_) { return []; }
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40))); } catch (_) {}
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, storageKey]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    const nextMessages = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(nextMessages);

    // Build a running transcript so the Companion has memory across turns.
    const transcript = nextMessages
      .slice(0, -1)
      .map((m) => (m.role === "user" ? `Writer: ${m.content}` : `Jupiter: ${m.content}`))
      .join("\n\n");
    const fullContext = `${context || ""}\n\nConversation so far (respond as Jupiter, continuing naturally):\n${transcript}`.trim();

    await streamAI({
      mode: "collaborate",
      text,
      context: fullContext,
      project_id: projectId,
      page_id: pageId,
      onDelta: (d) => {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: (last.content || "") + d };
          return copy;
        });
      },
      onDone: () => setBusy(false),
      onError: (err) => {
        console.error("feature-chat failed:", err);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: "_couldn't reach Jupiter — try again in a moment._" };
          return copy;
        });
        setBusy(false);
      },
    });
  };

  const clear = () => {
    setMessages([]);
    try { localStorage.removeItem(storageKey); } catch (_) {}
  };

  return (
    <div
      className="rounded-lg border overflow-hidden flex flex-col"
      style={{ borderColor: "var(--sc-border)", background: "color-mix(in oklab, var(--sc-bg-sheet) 60%, transparent)" }}
      data-testid={`${testIdPrefix}-panel`}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--sc-border)" }}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--sc-accent-primary)" }} />
          <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
            {title}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-[10px] uppercase tracking-widest hover:opacity-100 opacity-60"
            style={{ color: "var(--sc-text-secondary)" }}
            data-testid={`${testIdPrefix}-clear-btn`}
          >
            clear
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 max-h-[360px] overflow-y-auto calm-scroll px-4 py-5 space-y-5"
        style={{ color: "var(--sc-text-primary)" }}
        data-testid={`${testIdPrefix}-messages`}
      >
        {messages.length === 0 && (
          <p className="italic text-xs" style={{ color: "var(--sc-text-secondary)" }}>
            {placeholder}
          </p>
        )}
        {messages.map((m, i) => (
          m.role === "user"
            ? <UserBubble key={i} testId={`${testIdPrefix}-msg-user-${i}`}>{m.content}</UserBubble>
            : <JupiterBubble key={i} testId={`${testIdPrefix}-msg-assistant-${i}`}>{m.content}</JupiterBubble>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex items-center gap-2 p-2.5 border-t"
        style={{ borderColor: "var(--sc-border)" }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          className="flex-1 px-3 py-2 rounded-full border bg-transparent text-sm"
          style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
          data-testid={`${testIdPrefix}-input`}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="px-3 py-2 rounded-full flex items-center gap-1 text-sm disabled:opacity-40"
          style={{ background: "#EFE7D6", color: "#1A1918" }}
          data-testid={`${testIdPrefix}-send-btn`}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
