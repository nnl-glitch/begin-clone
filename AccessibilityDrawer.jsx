import React from "react";
import { useSettings } from "../lib/settings";
import { useStudio } from "../lib/studio";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";

const THEMES = [
  { id: "warm_sepia", label: "Warm Sepia", swatch: ["#FDFBF7", "#8C3A2B"] },
  { id: "calm_sand", label: "Calm Sand", swatch: ["#F7F6F3", "#3B5249"] },
  { id: "midnight_slate", label: "Midnight Slate", swatch: ["#121417", "#D99362"] },
  { id: "high_contrast", label: "High Contrast", swatch: ["#FFFFFF", "#000000"] },
];

const FONTS = [
  { id: "lora", label: "Lora (serif)" },
  { id: "cormorant", label: "Cormorant Garamond" },
  { id: "dyslexic", label: "Dyslexia-friendly" },
  { id: "sans", label: "Plus Jakarta Sans" },
];

const FOCUS_MODES = [
  { id: "off", label: "Off" },
  { id: "paragraph", label: "Paragraph" },
  { id: "line", label: "Line" },
];

export function AccessibilityDrawer() {
  const { showA11y, setShowA11y } = useStudio();
  const { settings, update } = useSettings();

  return (
    <Sheet open={showA11y} onOpenChange={setShowA11y}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[440px] calm-scroll overflow-y-auto"
        style={{ background: "var(--sc-bg-sheet)", borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
        data-testid="accessibility-drawer"
      >
        <SheetHeader>
          <SheetTitle className="font-serif-reader text-2xl" style={{ color: "var(--sc-text-primary)" }}>
            Reading & Accessibility
          </SheetTitle>
          <SheetDescription style={{ color: "var(--sc-text-secondary)" }}>
            Everything you change is saved automatically. Designed for sensory comfort.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-6">
          <section>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--sc-text-secondary)" }}>Sensory theme</p>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => update({ theme: t.id })}
                  data-testid={`theme-${t.id}`}
                  className="p-3 rounded-md border flex items-center gap-2 text-sm text-left"
                  style={{
                    borderColor: settings.theme === t.id ? "var(--sc-accent-primary)" : "var(--sc-border)",
                    background: settings.theme === t.id ? "var(--sc-bg-app)" : "transparent",
                    color: "var(--sc-text-primary)",
                  }}
                >
                  <span className="flex">
                    <span className="w-4 h-6 rounded-l" style={{ background: t.swatch[0], border: "1px solid var(--sc-border)" }} />
                    <span className="w-4 h-6 rounded-r" style={{ background: t.swatch[1] }} />
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--sc-text-secondary)" }}>Font family</p>
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => update({ font_family: f.id })}
                  data-testid={`font-${f.id}`}
                  className="p-2 rounded-md border text-sm"
                  style={{
                    borderColor: settings.font_family === f.id ? "var(--sc-accent-primary)" : "var(--sc-border)",
                    background: settings.font_family === f.id ? "var(--sc-bg-app)" : "transparent",
                    color: "var(--sc-text-primary)",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          <SliderSection label={`Font size — ${settings.font_size}px`} min={14} max={28} step={1} value={settings.font_size} onChange={(v) => update({ font_size: v })} testid="font-size-slider" />
          <SliderSection label={`Line height — ${settings.line_height.toFixed(2)}`} min={1.2} max={2.4} step={0.05} value={settings.line_height} onChange={(v) => update({ line_height: parseFloat(v.toFixed(2)) })} testid="line-height-slider" />
          <SliderSection label={`Letter spacing — ${settings.letter_spacing.toFixed(1)}px`} min={0} max={2} step={0.1} value={settings.letter_spacing} onChange={(v) => update({ letter_spacing: parseFloat(v.toFixed(1)) })} testid="letter-spacing-slider" />

          <section>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--sc-text-secondary)" }}>Focus mode overlay</p>
            <div className="grid grid-cols-3 gap-2">
              {FOCUS_MODES.map((f) => (
                <button
                  key={f.id}
                  onClick={() => update({ focus_mode: f.id })}
                  data-testid={`focus-${f.id}`}
                  className="p-2 rounded-md border text-sm"
                  style={{
                    borderColor: settings.focus_mode === f.id ? "var(--sc-accent-primary)" : "var(--sc-border)",
                    background: settings.focus_mode === f.id ? "var(--sc-bg-app)" : "transparent",
                    color: "var(--sc-text-primary)",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          <section className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--sc-text-primary)" }}>Reduced motion</p>
              <p className="text-xs" style={{ color: "var(--sc-text-secondary)" }}>Removes transitions and animations.</p>
            </div>
            <Switch
              checked={settings.reduced_motion}
              onCheckedChange={(v) => update({ reduced_motion: !!v })}
              data-testid="reduced-motion-switch"
            />
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--sc-text-secondary)" }}>Read-aloud voice</p>
            <VoicePicker />
          </section>

          <section>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--sc-text-secondary)" }}>Session timer</p>
            <div className="grid grid-cols-2 gap-3">
              <NumericInput label="Focus (min)" value={settings.timer_focus_min} onChange={(v) => update({ timer_focus_min: v })} testid="timer-focus-input" />
              <NumericInput label="Break (min)" value={settings.timer_break_min} onChange={(v) => update({ timer_break_min: v })} testid="timer-break-input" />
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SliderSection({ label, min, max, step, value, onChange, testid }) {
  return (
    <section>
      <p className="text-xs mb-2" style={{ color: "var(--sc-text-secondary)" }}>{label}</p>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={(v) => onChange(v[0])} data-testid={testid} />
    </section>
  );
}

function NumericInput({ label, value, onChange, testid }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--sc-text-secondary)" }}>{label}</span>
      <input
        type="number"
        min={1}
        max={120}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 1)}
        className="w-full mt-1 px-2 py-1.5 rounded border bg-transparent text-sm"
        style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
        data-testid={testid}
      />
    </label>
  );
}

function VoicePicker() {
  const [voices, setVoices] = React.useState([]);
  const [selected, setSelected] = React.useState(() => {
    try { return localStorage.getItem("scribecraft_voice") || ""; } catch (_) { return ""; }
  });
  React.useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
  }, []);
  const sample = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("This is how Jupiter will sound.");
    const v = voices.find((x) => x.name === selected);
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  };
  return (
    <div className="flex gap-2">
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          try { localStorage.setItem("scribecraft_voice", e.target.value); } catch (_) {}
        }}
        className="flex-1 text-sm px-2 py-2 rounded border bg-transparent"
        style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
        data-testid="voice-picker"
      >
        <option value="">System default</option>
        {voices.map((v) => (
          <option key={v.name} value={v.name}>{v.name} — {v.lang}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={sample}
        className="text-sm px-3 rounded border"
        style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
        data-testid="voice-sample-btn"
      >
        Sample
      </button>
    </div>
  );
}
