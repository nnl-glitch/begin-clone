import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { Copy, Check } from "lucide-react";

const MODE_LABELS = {
  analyze: "Analyze",
  collaborate: "Collaborate",
  revise: "Revise",
  interpret: "Interpret",
  evolution: "Evolution",
};

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

export function HistoryViewer({ entry, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!entry) return null;

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl calm-scroll overflow-y-auto"
        style={{
          background: "var(--sc-bg-sheet)",
          borderColor: "var(--sc-border)",
          color: "var(--sc-text-primary)",
          maxHeight: "85vh",
        }}
        data-testid="history-viewer"
      >
        <DialogHeader>
          <DialogTitle className="font-serif-reader text-2xl" style={{ color: "var(--sc-text-primary)" }}>
            {MODE_LABELS[entry.mode] || entry.mode}
          </DialogTitle>
          <DialogDescription style={{ color: "var(--sc-text-secondary)" }}>
            {formatDate(entry.created_at)}
          </DialogDescription>
        </DialogHeader>

        <section className="mt-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--sc-text-secondary)" }}>
            Passage
          </p>
          <div
            className="text-sm p-3 rounded border font-serif-reader max-h-40 overflow-y-auto calm-scroll whitespace-pre-wrap"
            style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-app)", color: "var(--sc-text-secondary)" }}
          >
            {entry.input_text}
          </div>
        </section>

        <section className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
              Jupiter's reply
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(entry.output_text)}
              data-testid="history-copy-btn"
            >
              {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div
            className="text-sm p-3 rounded border font-serif-reader whitespace-pre-wrap leading-relaxed"
            style={{ borderColor: "var(--sc-border)", background: "var(--sc-bg-app)", color: "var(--sc-text-primary)" }}
            data-testid="history-output"
          >
            {entry.output_text}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export { MODE_LABELS, formatDate };
