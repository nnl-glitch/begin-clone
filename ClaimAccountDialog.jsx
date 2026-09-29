import React, { useState } from "react";
import { X, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth, readableAuthError } from "../lib/auth";

/**
 * Modal shown to guests so they can convert their throwaway account into a
 * permanent email/password one, keeping every project + Companion history.
 */
export function ClaimAccountDialog({ onClose }) {
  const { claimAccount } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("Password must be at least 6 characters");
    setBusy(true);
    try {
      await claimAccount(email.trim().toLowerCase(), password, name.trim() || null);
      toast.success("Account saved — everything you've written is yours now");
      onClose();
    } catch (err) {
      setError(readableAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-modal="true"
      data-testid="claim-account-modal"
    >
      <div
        className="w-full max-w-md rounded-lg border p-6"
        style={{ background: "var(--sc-bg-sheet)", borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4" />
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--sc-text-secondary)" }}>
              Keep this work forever
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="opacity-70 hover:opacity-100"
            data-testid="claim-close-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <h3 className="font-serif-reader text-2xl leading-tight mb-3">Claim your account</h3>
        <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--sc-text-secondary)" }}>
          Add an email and password. Every project, scene, character, and Jupiter run you've made stays exactly where it is — you'll just be able to open it from any device from now on.
        </p>

        <form onSubmit={submit} className="space-y-3" data-testid="claim-form">
          <div>
            <label className="text-[10px] uppercase tracking-widest font-semibold block mb-1.5" style={{ color: "var(--sc-text-secondary)" }}>
              Pen name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-md border bg-transparent"
              style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
              data-testid="claim-name-input"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest font-semibold block mb-1.5" style={{ color: "var(--sc-text-secondary)" }}>
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-md border bg-transparent"
              style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
              data-testid="claim-email-input"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest font-semibold block mb-1.5" style={{ color: "var(--sc-text-secondary)" }}>
              Password (6+ characters)
            </label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-md border bg-transparent"
              style={{ borderColor: "var(--sc-border)", color: "var(--sc-text-primary)" }}
              data-testid="claim-password-input"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: "#E85D75" }} data-testid="claim-error">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full py-3 rounded-full font-serif-reader text-base disabled:opacity-50"
            style={{ background: "#EFE7D6", color: "#1A1918" }}
            data-testid="claim-submit-btn"
          >
            {busy ? "Saving…" : "Save this account"}
          </button>
        </form>
      </div>
    </div>
  );
}
