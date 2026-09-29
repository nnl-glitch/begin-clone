import React, { useRef, useState } from "react";
import { UploadCloud, X, Package } from "lucide-react";
import { toast } from "sonner";
import { useStudio } from "../lib/studio";

/**
 * Import Bundle flow:
 * 1. Click the button -> hidden <input type="file"> picker.
 * 2. Upload -> if 201, done. If 409 title_conflict, show inline modal
 *    asking Rename / Overwrite / Cancel, then retry with on_conflict.
 */
export function ImportBundleButton() {
  const { importProjectBundle } = useStudio();
  const fileRef = useRef(null);
  const pendingFile = useRef(null);
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);

  const openPicker = () => fileRef.current?.click();

  const doUpload = async (file, onConflict = null) => {
    setBusy(true);
    try {
      const r = await importProjectBundle(file, onConflict);
      setConflict(null);
      pendingFile.current = null;
      const counts = r?.counts || {};
      toast.success(
        `Imported "${r.project.title}" · ${counts.pages || 0} pages · ${counts.characters || 0} characters`
      );
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (err.response?.status === 409 && detail && detail.code === "title_conflict") {
        // Save file and open the conflict modal.
        pendingFile.current = file;
        setConflict({
          existing_title: detail.existing_title,
          message: detail.message,
        });
      } else if (typeof detail === "string") {
        toast.error(detail);
      } else if (Array.isArray(detail)) {
        toast.error(detail.map((d) => d.msg || "").join(" ").slice(0, 160) || "Import failed");
      } else {
        toast.error("Import failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Please pick a .begin.zip (or .scribecraft.zip) file");
      return;
    }
    doUpload(file, null);
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        onChange={onFileChange}
        className="hidden"
        data-testid="import-bundle-input"
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={busy}
        className="w-full mt-1 py-2 flex items-center justify-center gap-2 text-[13px] disabled:opacity-60"
        style={{ color: "var(--sc-text-secondary)" }}
        data-testid="import-bundle-btn"
      >
        <UploadCloud className="w-4 h-4" /> {busy ? "Importing…" : "Restore"}
      </button>

      {conflict && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          role="dialog"
          aria-modal="true"
          data-testid="import-conflict-modal"
        >
          <div
            className="w-full max-w-md rounded-lg border p-6"
            style={{ background: "var(--sc-bg-sheet)", borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4" />
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
                  Same title exists
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => { setConflict(null); pendingFile.current = null; }}
                className="opacity-70 hover:opacity-100"
                data-testid="import-conflict-close-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <h3 className="font-serif-reader text-2xl leading-tight mb-3">
              A project called "{conflict.existing_title}" already exists
            </h3>
            <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--sc-text-secondary)" }}>
              Would you like to bring this bundle in as a separate copy, or replace what's already there?
              <span className="block mt-2 italic">Overwrite is permanent — the existing project, scenes, notes, cast, and Jupiter's history will be deleted.</span>
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => doUpload(pendingFile.current, "rename")}
                className="w-full py-3 rounded-full font-serif-reader text-base disabled:opacity-60"
                style={{ background: "#EFE7D6", color: "#1A1918" }}
                data-testid="import-conflict-rename-btn"
              >
                Import as a separate copy
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Really overwrite "${conflict.existing_title}"? This can't be undone.`)) return;
                  doUpload(pendingFile.current, "overwrite");
                }}
                className="w-full py-3 rounded-full font-serif-reader text-base border disabled:opacity-60"
                style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
                data-testid="import-conflict-overwrite-btn"
              >
                Overwrite existing
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setConflict(null); pendingFile.current = null; }}
                className="w-full py-2 text-xs uppercase tracking-widest"
                style={{ color: "var(--sc-text-secondary)" }}
                data-testid="import-conflict-cancel-btn"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
