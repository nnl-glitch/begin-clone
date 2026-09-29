import React from "react";
import { useStudio } from "../lib/studio";
import { useSettings } from "../lib/settings";
import { Menu, Save, CloudOff, AArrowDown, AArrowUp } from "lucide-react";
import { MODES } from "./ModeWorkspace";

const FONT_MIN = 13;
const FONT_MAX = 26;
const FONT_STEP = 1;

export function TopBar() {
  const { showSidebar, setShowSidebar, setActiveMode, activeMode, saveState } = useStudio();
  const { settings, update } = useSettings();

  const bumpFont = (delta) => {
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, (settings.font_size || 16) + delta));
    if (next !== settings.font_size) update({ font_size: next });
  };

  const badge = saveState === "saving"
    ? { label: "Syncing", icon: <Save className="w-3 h-3" /> }
    : saveState === "offline"
      ? { label: "Local only", icon: <CloudOff className="w-3 h-3" /> }
      : { label: "Saved", icon: <Save className="w-3 h-3" /> };

  return (
    <header
      className="w-full flex items-center gap-2 pl-3 pr-4 sm:pl-4 sm:pr-6 py-3 border-b sticky top-0 z-20 backdrop-blur"
      style={{
        background: "color-mix(in oklab, var(--sc-bg-app) 88%, transparent)",
        borderColor: "var(--sc-border)",
      }}
      data-testid="topbar"
    >
      <button
        aria-label="Toggle sidebar"
        onClick={() => setShowSidebar((s) => !s)}
        className="p-2 rounded-md hover:opacity-80 shrink-0"
        style={{ color: "var(--sc-text-primary)" }}
        data-testid="toggle-sidebar-btn"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mode tabs (horizontally scrollable) */}
      <nav
        className="flex-1 min-w-0 flex items-center justify-start sm:justify-start gap-1 sm:gap-2 overflow-x-auto sm:overflow-visible calm-scroll"
        style={{ scrollbarWidth: "none" }}
        data-testid="mode-toolbar"
      >
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = activeMode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setActiveMode(m.id)}
              data-testid={`toolbar-mode-${m.id}`}
              className="shrink-0 flex items-center gap-2 px-2 sm:px-4 py-2 rounded-full transition"
              style={{
                background: active
                  ? "color-mix(in oklab, var(--sc-accent-primary) 22%, transparent)"
                  : "transparent",
                color: "var(--sc-text-primary)",
                fontWeight: active ? 600 : 400,
              }}
              aria-label={`Open ${m.label}`}
              title={`${m.label} — ${m.hint}`}
            >
              <Icon
                className="w-4 h-4"
                style={{ color: active ? "var(--sc-accent-primary)" : "var(--sc-text-secondary)" }}
              />
              {/* Show label only on desktop OR on mobile when the tab is active.
                  This lets all 5 mode tabs fit on a phone without a scrollbar. */}
              <span
                className={`font-serif-reader text-base sm:text-lg leading-none ${active ? "inline" : "hidden sm:inline"}`}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Reader font-size nudge — A− / A+ writes directly to settings so every
          scene, mode reply and history bubble follows in real time. */}
      <div
        className="shrink-0 flex items-center gap-0.5 rounded-full border px-1 py-0.5"
        style={{ borderColor: "var(--sc-border)" }}
        data-testid="font-size-control"
        aria-label="Reader font size"
      >
        <button
          type="button"
          onClick={() => bumpFont(-FONT_STEP)}
          disabled={(settings.font_size || 16) <= FONT_MIN}
          className="p-1 rounded-full hover:opacity-80 disabled:opacity-30"
          style={{ color: "var(--sc-text-secondary)" }}
          aria-label="Decrease reader font size"
          title="Smaller reader font"
          data-testid="font-size-decrease-btn"
        >
          <AArrowDown className="w-4 h-4" />
        </button>
        <span
          className="text-[10px] tabular-nums px-1 select-none hidden sm:inline"
          style={{ color: "var(--sc-text-secondary)" }}
          data-testid="font-size-value"
        >
          {settings.font_size || 16}
        </span>
        <button
          type="button"
          onClick={() => bumpFont(+FONT_STEP)}
          disabled={(settings.font_size || 16) >= FONT_MAX}
          className="p-1 rounded-full hover:opacity-80 disabled:opacity-30"
          style={{ color: "var(--sc-text-secondary)" }}
          aria-label="Increase reader font size"
          title="Larger reader font"
          data-testid="font-size-increase-btn"
        >
          <AArrowUp className="w-4 h-4" />
        </button>
      </div>

      <div
        className="hidden sm:flex shrink-0 items-center gap-1.5 text-[11px] px-2 py-1 rounded-full"
        style={{ color: "var(--sc-text-secondary)" }}
        data-testid="autosave-status"
        aria-live="polite"
      >
        {badge.icon}
        <span>{badge.label}</span>
      </div>
    </header>
  );
}
