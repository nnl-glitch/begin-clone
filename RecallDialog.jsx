import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { useStudio } from "../lib/studio";
import { Brain, Edit3 } from "lucide-react";
import { toast } from "sonner";

export function RecallDialog({ project, onClose }) {
  const { setShowSidebar } = useStudio();
  const preamble = (project?.preamble || "").trim();
  const synopsis = (project?.synopsis || "").trim();
  const goEdit = () => {
    setShowSidebar(true);
    toast("Edit memory in Projects → Jupiter's memory");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-xl"
        style={{
          background: "var(--sc-bg-sheet)",
          borderColor: "var(--sc-border)",
          color: "var(--sc-text-primary)",
        }}
        data-testid="recall-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-serif-reader text-2xl flex items-center gap-2">
            <Brain className="w-5 h-5" style={{ color: "var(--sc-accent-primary)" }} />
            What Jupiter remembers
          </DialogTitle>
          <DialogDescription style={{ color: "var(--sc-text-secondary)" }}>
            This is exactly what is silently sent along with every run for <em>{project?.title || "this project"}</em>.
          </DialogDescription>
        </DialogHeader>

        <section className="mt-2">
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--sc-text-secondary)" }}>
            Project memory (preamble)
          </p>
          <div
            className="text-sm p-3 rounded-md border font-serif-reader whitespace-pre-wrap leading-relaxed"
            style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-app)", color: preamble ? "var(--sc-text-primary)" : "var(--sc-text-secondary)" }}
            data-testid="recall-preamble"
          >
            {preamble || <em>No preamble pinned yet. Add one in the Projects tab and Jupiter will hold it in every run.</em>}
          </div>
        </section>

        {synopsis && (
          <section className="mt-3">
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--sc-text-secondary)" }}>
              Synopsis (for context)
            </p>
            <div
              className="text-sm p-3 rounded-md border font-serif-reader"
              style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-app)", color: "var(--sc-text-primary)" }}
              data-testid="recall-synopsis"
            >
              {synopsis}
            </div>
          </section>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={goEdit}
            className="px-4 py-2 rounded-full text-sm flex items-center gap-1.5"
            style={{ background: "var(--sc-accent-primary)", color: "var(--sc-bg-sheet)" }}
            data-testid="recall-edit-btn"
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit memory
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
