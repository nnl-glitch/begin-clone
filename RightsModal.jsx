import React from "react";
import { X } from "lucide-react";

/**
 * Terms & Rights modal — a plain-language summary of who owns what in Begin.
 * Opened from the sidebar footer; not legal advice, just a friendly primer
 * every writer can read in under a minute.
 */
export function RightsModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "rgba(6, 10, 20, 0.72)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      data-testid="rights-modal-overlay"
    >
      <div
        className="max-w-2xl w-full max-h-[90vh] overflow-y-auto rounded-2xl p-8 shadow-2xl font-serif-reader"
        style={{
          background: "var(--sc-bg-sheet)",
          color: "var(--sc-text-primary)",
          border: "1px solid var(--sc-border)",
          fontFamily: "var(--font-serif-reader, serif)",
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="rights-modal"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl mb-1" style={{ fontFamily: "var(--font-serif-reader, serif)" }}>
              Terms &amp; Rights
            </h2>
            <p className="text-xs italic" style={{ color: "var(--sc-text-secondary)" }}>
              A short primer — not legal advice.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-black/10"
            aria-label="Close"
            data-testid="rights-modal-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5 text-[15px] leading-relaxed">
          <section>
            <h3 className="text-sm uppercase tracking-widest mb-2" style={{ color: "var(--sc-text-secondary)" }}>
              What you own
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>All scenes, notes, characters, and Jupiter replies your account has generated.</li>
              <li>The name <b>Begin</b>, the <b>Jupiter</b> companion persona, and all copy you write here.</li>
              <li>The source code of this application, if you self-host it.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-sm uppercase tracking-widest mb-2" style={{ color: "var(--sc-text-secondary)" }}>
              What Begin uses under the hood
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><b>Claude Sonnet 5</b> (Anthropic) generates Jupiter's replies. Outputs Claude produces for you are yours to use commercially per Anthropic's terms.</li>
              <li><b>Cormorant Garamond &amp; Lora</b> — Google Fonts, free for commercial and personal use.</li>
              <li><b>React, FastAPI, MongoDB, Tailwind, lucide-react, shadcn/ui</b> — all open-source, free to use.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-sm uppercase tracking-widest mb-2" style={{ color: "var(--sc-text-secondary)" }}>
              About your writing
            </h3>
            <p>
              You may keep, publish, or sell any writing you produce with Begin. Because you're
              the one shaping the drafts, deleting, editing, and re-serving them, your writing
              qualifies as human-authored work in most jurisdictions.
            </p>
          </section>

          <section>
            <h3 className="text-sm uppercase tracking-widest mb-2" style={{ color: "var(--sc-text-secondary)" }}>
              About your data
            </h3>
            <p>
              Every scene, character, and session is stored under your account. You can bulk-export
              to Markdown or ZIP any time from the sidebar footer. Deleting your account removes
              your writing from active use; ask support for full erasure.
            </p>
          </section>

          <section>
            <h3 className="text-sm uppercase tracking-widest mb-2" style={{ color: "var(--sc-text-secondary)" }}>
              What we don't do
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>We don't sell your writing.</li>
              <li>We don't train models on your writing.</li>
              <li>We don't moralize about content — Jupiter is explicit-friendly by design.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-sm uppercase tracking-widest mb-2" style={{ color: "var(--sc-text-secondary)" }}>
              Protecting the name
            </h3>
            <p>
              "Begin" alone is a common word and hard to trademark. If you want to protect the
              brand, register a distinctive wordmark or logo pair ("Begin: A Writing Companion")
              via a trademark attorney in your country.
            </p>
          </section>
        </div>

        <div className="mt-6 pt-4 border-t text-xs italic" style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-secondary)" }}>
          This summary is provided for clarity, not as a substitute for legal counsel. For anything
          binding — copyright disputes, trademark filings, publishing contracts — please consult a
          lawyer in your jurisdiction.
        </div>
      </div>
    </div>
  );
}
