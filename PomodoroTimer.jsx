import React, { useEffect, useRef, useState } from "react";
import { useStudio } from "../lib/studio";
import { useSettings } from "../lib/settings";
import { Play, Pause, RotateCcw, Coffee, Focus, X, CloudRain, Flame } from "lucide-react";
import { toast } from "sonner";
import { playChannel, stopChannel } from "../lib/focusSounds";
import { api } from "../lib/api";

const CHANNELS = [
  { id: "off", label: "Silent", icon: null },
  { id: "rain", label: "Rain", icon: CloudRain },
  { id: "fireside", label: "Fireside", icon: Flame },
  { id: "cafe", label: "Café", icon: Coffee },
];

export function PomodoroTimer() {
  const { showTimer, setShowTimer } = useStudio();
  const { settings } = useSettings();
  const [mode, setMode] = useState("focus"); // focus | break
  const [remaining, setRemaining] = useState(settings.timer_focus_min * 60);
  const [running, setRunning] = useState(false);
  const [channel, setChannel] = useState("off");
  const tick = useRef();

  useEffect(() => () => stopChannel(), []);
  useEffect(() => {
    if (running && channel !== "off") playChannel(channel);
    else stopChannel();
  }, [running, channel]);

  // Show a gentle "opening ritual" toast when a focus sprint begins.
  useEffect(() => {
    if (running && mode === "focus") {
      api.get("/rituals/random").then((r) => {
        if (r?.data?.text) toast(r.data.text, { icon: "\uD83D\uDD4A" });
      }).catch(() => {});
    }
  }, [running, mode]);

  // Reset remaining when durations change (and not running)
  useEffect(() => {
    if (!running) {
      setRemaining((mode === "focus" ? settings.timer_focus_min : settings.timer_break_min) * 60);
    }
  }, [settings.timer_focus_min, settings.timer_break_min, mode, running]);

  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(tick.current);
          setRunning(false);
          const next = mode === "focus" ? "break" : "focus";
          const nextMins = next === "focus" ? settings.timer_focus_min : settings.timer_break_min;
          setMode(next);
          setRemaining(nextMins * 60);
          toast(next === "break" ? "Time for a break — stretch, sip water." : "Break's over. Gently ease back in.", {
            icon: next === "break" ? "☕" : "🕊",
          });
          return nextMins * 60;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(tick.current);
  }, [running, mode, settings.timer_focus_min, settings.timer_break_min]);

  if (!showTimer) return null;

  const mins = Math.floor(remaining / 60).toString().padStart(2, "0");
  const secs = (remaining % 60).toString().padStart(2, "0");
  const totalSecs = (mode === "focus" ? settings.timer_focus_min : settings.timer_break_min) * 60;
  const pct = 1 - remaining / totalSecs;

  return (
    <div
      className="fixed bottom-6 right-6 z-30 rounded-xl border shadow-lg p-4 w-[260px] calm-fade-in"
      style={{ background: "var(--sc-bg-sheet)", borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
      data-testid="pomodoro-timer"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--sc-text-secondary)" }}>
          {mode === "focus" ? "Focus sprint" : "Rest"}
        </span>
        <button
          onClick={() => setShowTimer(false)}
          className="p-1 rounded hover:bg-black/5"
          aria-label="Close timer"
          data-testid="close-timer-btn"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="relative flex items-center justify-center my-3">
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="62" fill="none" stroke="var(--sc-border)" strokeWidth="6" />
          <circle
            cx="70" cy="70" r="62" fill="none"
            stroke="var(--sc-accent-primary)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 62}`}
            strokeDashoffset={`${2 * Math.PI * 62 * (1 - pct)}`}
            transform="rotate(-90 70 70)"
            style={{ transition: "stroke-dashoffset 0.7s linear" }}
          />
        </svg>
        <div className="absolute font-serif-reader text-3xl" data-testid="timer-display">
          {mins}:{secs}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setRunning((r) => !r)}
          className="px-3 py-1.5 rounded-md flex items-center gap-1.5 text-sm"
          style={{ background: "var(--sc-accent-primary)", color: "var(--sc-bg-sheet)" }}
          data-testid="timer-play-pause-btn"
        >
          {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={() => { setRunning(false); setRemaining((mode === "focus" ? settings.timer_focus_min : settings.timer_break_min) * 60); }}
          className="px-3 py-1.5 rounded-md text-sm border"
          style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
          data-testid="timer-reset-btn"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex justify-center gap-1 text-[11px]">
        <button
          onClick={() => { setMode("focus"); setRunning(false); setRemaining(settings.timer_focus_min * 60); }}
          className="px-2 py-1 rounded"
          style={{
            background: mode === "focus" ? "var(--sc-bg-app)" : "transparent",
            color: "var(--sc-text-primary)",
            border: "1px solid var(--sc-border)",
          }}
          data-testid="timer-mode-focus"
        >
          <Focus className="w-3 h-3 inline mr-1" /> Focus
        </button>
        <button
          onClick={() => { setMode("break"); setRunning(false); setRemaining(settings.timer_break_min * 60); }}
          className="px-2 py-1 rounded"
          style={{
            background: mode === "break" ? "var(--sc-bg-app)" : "transparent",
            color: "var(--sc-text-primary)",
            border: "1px solid var(--sc-border)",
          }}
          data-testid="timer-mode-break"
        >
          <Coffee className="w-3 h-3 inline mr-1" /> Break
        </button>
      </div>

      <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--sc-border)" }}>
        <p className="text-[9px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "var(--sc-text-secondary)" }}>
          Focus sound
        </p>
        <div className="grid grid-cols-4 gap-1">
          {CHANNELS.map((ch) => {
            const Icon = ch.icon;
            const active = channel === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => setChannel(ch.id)}
                data-testid={`sound-${ch.id}`}
                className="p-1.5 rounded flex flex-col items-center gap-0.5 text-[10px] transition"
                style={{
                  background: active ? "var(--sc-accent-primary)" : "transparent",
                  color: active ? "var(--sc-bg-sheet)" : "var(--sc-text-primary)",
                  border: `1px solid ${active ? "var(--sc-accent-primary)" : "var(--sc-border)"}`,
                }}
              >
                {Icon ? <Icon className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                {ch.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
