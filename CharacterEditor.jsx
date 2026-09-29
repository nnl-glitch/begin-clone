import React, { useState } from "react";
import { useStudio } from "../lib/studio";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { Trash2, Plus, X, Wand2, Mic, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { FeatureChat } from "./FeatureChat";

export function CharacterEditor({ character, onClose }) {
  const { updateCharacter, deleteCharacter, pages, characters, projects, setCharacters, activeProjectId } = useStudio();
  // Attach a client-only stable _key to each relationship / evolution stage so
  // React can track them across reorders/deletes. Stripped before saving.
  const withKeys = (arr) => (arr || []).map((x) => (x._key ? x : { ...x, _key: crypto.randomUUID?.() || Math.random().toString(36).slice(2) }));
  const [c, setC] = useState(() => ({
    ...character,
    relationships: withKeys(character.relationships),
    evolution: withKeys(character.evolution),
  }));
  const [draftingVoice, setDraftingVoice] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const stripKeys = (arr) => (arr || []).map(({ _key, ...rest }) => rest); // eslint-disable-line no-unused-vars

  const patch = (k, v) => setC((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    await updateCharacter(c.id, {
      name: c.name, role: c.role, traits: c.traits, motivations: c.motivations,
      secrets: c.secrets, backstory: c.backstory, avatar_url: c.avatar_url,
      voice_preamble: c.voice_preamble || "",
      evolution: stripKeys(c.evolution),
      relationships: stripKeys(c.relationships),
    });
    onClose();
  };

  const draftVoiceFromSheet = async () => {
    // Persist any unsaved sheet edits first so the backend reads the freshest state.
    setDraftingVoice(true);
    try {
      await updateCharacter(c.id, {
        role: c.role, traits: c.traits, motivations: c.motivations,
        secrets: c.secrets, backstory: c.backstory,
      });
      const r = await api.post("/ai/character-voice-coach", { character_id: c.id });
      const draft = (r.data.voice_preamble || "").trim();
      if (!draft) {
        toast.error("Jupiter returned an empty voice — try filling more of the sheet");
        return;
      }
      patch("voice_preamble", draft);
      // Immediately persist the drafted voice so it survives an accidental close.
      try { await updateCharacter(c.id, { voice_preamble: draft }); } catch (err) { console.error("voice autosave failed:", err); }
      toast.success("Voice drafted and saved");
    } catch (err) {
      console.error("voice draft failed:", err);
      toast.error("Couldn't draft the voice this time");
    } finally {
      setDraftingVoice(false);
    }
  };

  const addRelationship = () => {
    const others = characters.filter((x) => x.id !== c.id);
    setC((prev) => ({
      ...prev,
      relationships: [
        ...(prev.relationships || []),
        { target_id: others[0]?.id || "", kind: "connected", note: "", _key: crypto.randomUUID?.() || Math.random().toString(36).slice(2) },
      ],
    }));
  };

  const updateRelationship = (i, key, val) => {
    setC((prev) => {
      const rs = [...(prev.relationships || [])];
      rs[i] = { ...rs[i], [key]: val };
      return { ...prev, relationships: rs };
    });
  };

  const removeRelationship = (i) => {
    setC((prev) => {
      const rs = [...(prev.relationships || [])];
      rs.splice(i, 1);
      return { ...prev, relationships: rs };
    });
  };

  const addStage = () => {
    setC((prev) => ({
      ...prev,
      evolution: [
        ...(prev.evolution || []),
        {
          page_id: pages[0]?.id || null,
          page_title: pages[0]?.title || "",
          stage_label: "New stage",
          notes: "",
          inner_state: 50,
          outer_action: 50,
          created_at: new Date().toISOString(),
          _key: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
        },
      ],
    }));
  };

  const updateStage = (i, key, val) => {
    setC((prev) => {
      const ev = [...(prev.evolution || [])];
      ev[i] = { ...ev[i], [key]: val };
      return { ...prev, evolution: ev };
    });
  };

  const removeStage = (i) => {
    setC((prev) => {
      const ev = [...(prev.evolution || [])];
      ev.splice(i, 1);
      return { ...prev, evolution: ev };
    });
  };

  return (
    <Sheet open onOpenChange={(o) => !o && save()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[520px] calm-scroll overflow-y-auto"
        style={{ background: "var(--sc-bg-sheet)", borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
        data-testid="character-editor"
      >
        <SheetHeader>
          <SheetTitle className="font-serif-reader text-2xl" style={{ color: "var(--sc-text-primary)" }}>
            Character
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <Field label="Project">
            <div className="flex items-center gap-2">
              <select
                className="input-style flex-1"
                value={c.project_id || ""}
                disabled={assigning}
                onChange={async (e) => {
                  const next = e.target.value || null;
                  const prev = c.project_id || null;
                  if (next === prev) return;
                  patch("project_id", next);
                  setAssigning(true);
                  try {
                    // Call the API directly (bypass updateCharacter) so we can
                    // show a contextual "moved to X" toast instead of the
                    // generic "Character saved".
                    await api.patch(`/characters/${c.id}`, { project_id: next });
                    // Sync the sidebar list: if the new project isn't the
                    // currently-viewed one (and a project IS active), drop the
                    // character from the visible list so it doesn't look
                    // wrongly filed. When viewing "all" (activeProjectId null)
                    // we keep it so writers can still see & re-edit.
                    setCharacters((cs) => {
                      if (!activeProjectId) return cs.map((x) => (x.id === c.id ? { ...x, project_id: next } : x));
                      if (next === activeProjectId) return cs.map((x) => (x.id === c.id ? { ...x, project_id: next } : x));
                      return cs.filter((x) => x.id !== c.id);
                    });
                    toast.success(next
                      ? `Moved to ${(projects.find((p) => p.id === next) || {}).title || "project"}`
                      : "Unassigned");
                  } catch (err) {
                    patch("project_id", prev); // roll back
                    toast.error("Couldn't reassign — try again");
                  } finally {
                    setAssigning(false);
                  }
                }}
                data-testid="char-project-select"
              >
                <option value="">— Unassigned —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
              {assigning && (
                <span className="text-xs italic" style={{ color: "var(--sc-text-secondary)" }}>
                  saving…
                </span>
              )}
            </div>
          </Field>
          <Field label="Name">
            <input className="input-style" value={c.name || ""} onChange={(e) => patch("name", e.target.value)} data-testid="char-name" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <input className="input-style" value={c.role || ""} onChange={(e) => patch("role", e.target.value)} placeholder="Protagonist, Antagonist, Foil…" data-testid="char-role" />
            </Field>
            <Field label="Avatar URL">
              <input className="input-style" value={c.avatar_url || ""} onChange={(e) => patch("avatar_url", e.target.value)} data-testid="char-avatar" />
            </Field>
          </div>
          <Field label="Traits">
            <textarea className="input-style min-h-[60px]" value={c.traits || ""} onChange={(e) => patch("traits", e.target.value)} data-testid="char-traits" />
          </Field>
          <Field label="Motivations">
            <textarea className="input-style min-h-[60px]" value={c.motivations || ""} onChange={(e) => patch("motivations", e.target.value)} data-testid="char-motivations" />
          </Field>
          <Field label="Secrets">
            <textarea className="input-style min-h-[60px]" value={c.secrets || ""} onChange={(e) => patch("secrets", e.target.value)} data-testid="char-secrets" />
          </Field>
          <Field label="Backstory">
            <textarea className="input-style min-h-[100px] font-serif-reader" value={c.backstory || ""} onChange={(e) => patch("backstory", e.target.value)} data-testid="char-backstory" />
          </Field>

          <div className="pt-4 border-t" style={{ borderColor: "var(--sc-border)" }}>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <p className="text-xs uppercase tracking-wider font-semibold flex items-center gap-1.5" style={{ color: "var(--sc-text-secondary)" }}>
                <Mic className="w-3.5 h-3.5" /> Jupiter's voice
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    const next = !c.pinned;
                    patch("pinned", next);
                    try { await updateCharacter(c.id, { pinned: next }); }
                    catch (err) { patch("pinned", !next); toast.error("Couldn't pin — try again"); }
                  }}
                  disabled={!(c.voice_preamble || "").trim()}
                  className="text-[11px] flex items-center gap-1 px-2 py-1 rounded border hover:opacity-80 disabled:opacity-40"
                  style={{
                    borderColor: "var(--sc-border)",
                    color: c.pinned ? "#1A1918" : "var(--sc-text-primary)",
                    background: c.pinned ? "#EFE7D6" : "transparent",
                  }}
                  data-testid="char-pin-btn"
                  title={
                    !(c.voice_preamble || "").trim()
                      ? "Give this character a voice before pinning for quick-pick"
                      : c.pinned ? "Unpin from quick-pick" : "Pin for one-tap speak-as across every mode"
                  }
                >
                  {c.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                  {c.pinned ? "Pinned" : "Pin"}
                </button>
                <button
                  type="button"
                  onClick={draftVoiceFromSheet}
                  disabled={draftingVoice}
                  className="text-[11px] flex items-center gap-1 px-2 py-1 rounded border hover:opacity-80 disabled:opacity-40"
                  style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
                  data-testid="char-voice-coach-btn"
                >
                  <Wand2 className="w-3 h-3" />
                  {draftingVoice ? "Drafting…" : "Draft from sheet"}
                </button>
              </div>
            </div>
            <textarea
              className="input-style min-h-[110px] font-serif-reader"
              value={c.voice_preamble || ""}
              onChange={(e) => patch("voice_preamble", e.target.value)}
              placeholder="How Jupiter should speak when you tell it to speak AS this character — register, tempo, verbal tics, what they never say."
              data-testid="char-voice-preamble"
            />
            <p className="text-[11px] italic mt-1.5" style={{ color: "var(--sc-text-secondary)" }}>
              {c.pinned
                ? "Pinned — this character will show as a one-tap chip in every mode's workspace."
                : "Pick this character in the workspace's \"Speak as\" dropdown and Jupiter will use this voice."}
            </p>
          </div>

          <div className="pt-4 border-t" style={{ borderColor: "var(--sc-border)" }}>
            <FeatureChat
              title={`Talk about ${c.name || "this character"}`}
              context={`You are helping the writer understand a character in their story. Stay concise, curious, and specific — never generic. Reply in plain prose (bold with **, italics with *). Draw on the sheet below.\n\nCHARACTER SHEET\nName: ${c.name || "—"}\nRole: ${c.role || "—"}\nTraits: ${c.traits || "—"}\nMotivations: ${c.motivations || "—"}\nSecrets: ${c.secrets || "—"}\nBackstory: ${c.backstory || "—"}\nJupiter's voice for this character: ${c.voice_preamble || "—"}`}
              storageKey={`begin_char_chat_${c.id}`}
              placeholder={`Ask about ${c.name || "them"} — motives, contradictions, a scene idea…`}
              projectId={c.project_id}
              testIdPrefix="char-chat"
            />
          </div>

          <div className="pt-4 border-t" style={{ borderColor: "var(--sc-border)" }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
                Relationships
              </p>
              <Button
                size="sm"
                onClick={addRelationship}
                data-testid="add-relationship-btn"
                disabled={characters.filter((x) => x.id !== c.id).length === 0}
                style={{ background: "var(--sc-accent-secondary)", color: "var(--sc-bg-sheet)" }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Bond
              </Button>
            </div>
            <div className="space-y-2">
              {(c.relationships || []).map((r, i) => (
                <div
                  key={r._key || i}
                  className="p-2 rounded-md border relative grid grid-cols-[1fr_120px_auto] gap-2 items-center"
                  style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-app)" }}
                  data-testid={`relationship-row-${i}`}
                >
                  <select
                    className="input-style text-sm"
                    value={r.target_id || ""}
                    onChange={(e) => updateRelationship(i, "target_id", e.target.value)}
                    data-testid={`relationship-target-${i}`}
                  >
                    <option value="">— Character —</option>
                    {characters.filter((x) => x.id !== c.id).map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                  <input
                    className="input-style text-sm"
                    value={r.kind || ""}
                    onChange={(e) => updateRelationship(i, "kind", e.target.value)}
                    placeholder="loves, hates, sibling…"
                    data-testid={`relationship-kind-${i}`}
                  />
                  <button
                    onClick={() => removeRelationship(i)}
                    className="p-1.5 rounded hover:bg-black/5"
                    aria-label="Remove"
                    data-testid={`remove-relationship-${i}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <input
                    className="input-style text-sm col-span-3"
                    value={r.note || ""}
                    onChange={(e) => updateRelationship(i, "note", e.target.value)}
                    placeholder="Optional note about this bond"
                    data-testid={`relationship-note-${i}`}
                  />
                </div>
              ))}
              {(c.relationships || []).length === 0 && (
                <p className="text-xs italic" style={{ color: "var(--sc-text-secondary)" }}>
                  No bonds yet. Add another character to start weaving connections.
                </p>
              )}
            </div>
          </div>

          <div className="pt-4 border-t" style={{ borderColor: "var(--sc-border)" }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
                Evolution Timeline
              </p>
              <Button
                size="sm"
                onClick={addStage}
                data-testid="add-evolution-stage-btn"
                style={{ background: "var(--sc-accent-secondary)", color: "var(--sc-bg-sheet)" }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Stage
              </Button>
            </div>
            <div className="space-y-3">
              {(c.evolution || []).map((s, i) => (
                <div
                  key={s._key || i}
                  className="p-3 rounded-md border relative"
                  style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-app)" }}
                  data-testid={`evolution-stage-${i}`}
                >
                  <button
                    className="absolute top-2 right-2 p-1 rounded hover:bg-black/5"
                    onClick={() => removeStage(i)}
                    aria-label="Remove stage"
                    data-testid={`remove-stage-${i}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <select
                      className="input-style text-sm"
                      value={s.page_id || ""}
                      onChange={(e) => {
                        const p = pages.find((x) => x.id === e.target.value);
                        updateStage(i, "page_id", e.target.value);
                        updateStage(i, "page_title", p?.title || "");
                      }}
                      data-testid={`stage-page-${i}`}
                    >
                      <option value="">— Page —</option>
                      {pages.map((p) => (
                        <option key={p.id} value={p.id}>{p.kind === "note" ? "Note: " : "Scene: "}{p.title}</option>
                      ))}
                    </select>
                    <input
                      className="input-style text-sm"
                      value={s.stage_label || ""}
                      onChange={(e) => updateStage(i, "stage_label", e.target.value)}
                      placeholder="Stage label (e.g. Disillusioned)"
                      data-testid={`stage-label-${i}`}
                    />
                  </div>
                  <textarea
                    className="input-style text-sm min-h-[50px]"
                    value={s.notes || ""}
                    onChange={(e) => updateStage(i, "notes", e.target.value)}
                    placeholder="What shifts internally here?"
                    data-testid={`stage-notes-${i}`}
                  />
                  <div className="mt-2 space-y-2">
                    <SliderRow label={`Inner state: ${s.inner_state}`} value={s.inner_state} onChange={(v) => updateStage(i, "inner_state", v)} testid={`stage-inner-${i}`} />
                    <SliderRow label={`Outer action: ${s.outer_action}`} value={s.outer_action} onChange={(v) => updateStage(i, "outer_action", v)} testid={`stage-outer-${i}`} />
                  </div>
                </div>
              ))}
              {(c.evolution || []).length === 0 && (
                <p className="text-xs italic" style={{ color: "var(--sc-text-secondary)" }}>
                  No evolution stages yet. Track how this character shifts across chapters.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 mt-6 pt-4 flex gap-2 border-t" style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-sheet)" }}>
          <Button
            variant="outline"
            onClick={() => { if (window.confirm(`Delete ${c.name}?`)) { deleteCharacter(c.id); onClose(); toast.success("Character removed"); } }}
            data-testid="delete-character-btn"
          >
            <Trash2 className="w-4 h-4 mr-1" /> Delete
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={onClose} data-testid="cancel-character-btn">Cancel</Button>
          <Button onClick={save} data-testid="save-character-btn" style={{ background: "var(--sc-accent-primary)", color: "var(--sc-bg-sheet)" }}>
            Save
          </Button>
        </div>

        <style>{`
          .input-style {
            width: 100%;
            padding: 0.5rem 0.65rem;
            border-radius: 0.4rem;
            border: 1px solid var(--sc-border);
            background: var(--sc-bg-app);
            color: var(--sc-text-primary);
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-size: 0.875rem;
            outline: none;
          }
          .input-style:focus { border-color: var(--sc-accent-primary); }
        `}</style>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--sc-text-secondary)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function SliderRow({ label, value, onChange, testid }) {
  return (
    <div>
      <div className="text-[11px] mb-1" style={{ color: "var(--sc-text-secondary)" }}>{label}</div>
      <Slider
        min={0} max={100} step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        data-testid={testid}
      />
    </div>
  );
}
