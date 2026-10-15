import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui";

/**
 * ConfirmDialog's shell with free-form content. `onSubmit()` may return a promise; the
 * dialog stays open and busy until it settles and closes only on success, so a failed
 * call (whose error the caller toasts) can be retried. Buttons lock while busy.
 */
export default function FormDialog({ open, title, message, children, submitLabel = "Save", tone = "primary", canSubmit = true, onSubmit, onClose }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = async (e) => {
    e?.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    try {
      await onSubmit();
      onClose();
    } catch {
      /* the caller already showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#0B1B3F]/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={() => !busy && onClose()} />
      <form onSubmit={submit} className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="ha-tricolour h-1" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-bold text-[var(--ha-ink)]">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg p-1 text-[var(--ha-ink-faint)] hover:bg-[var(--ha-hover)]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {message && <p className="mt-2 text-sm text-[var(--ha-ink-soft)]">{message}</p>}
          <div className="mt-4 space-y-4">{children}</div>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" tone={tone} busy={busy} disabled={!canSubmit}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

const fieldCls =
  "mt-1.5 w-full rounded-lg border px-3 py-2 text-sm text-[var(--ha-ink)] focus:outline-none focus:ring-2 border-[var(--ha-border)] focus:border-[var(--ha-navy)] focus:ring-[var(--ha-navy)]/20";

/** Labelled input / textarea in the admin style; `error` shows under it. */
export function DialogField({ label, required, hint, error, textarea, ...props }) {
  const Tag = textarea ? "textarea" : "input";
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[var(--ha-ink)]">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <Tag {...props} className={`${fieldCls} ${error ? "!border-red-400 focus:!ring-red-200" : ""}`} />
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-[var(--ha-ink-faint)]">{hint}</span>
      ) : null}
    </label>
  );
}
