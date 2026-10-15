import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, RefreshCw, Search, X } from "lucide-react";
import { isPdf, label } from "../format";

export const cx = (...parts) => parts.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ status */

const STATUS_TONE = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  verified: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  confirmed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  checked_in: "bg-sky-50 text-sky-800 ring-sky-200",
  checked_out: "bg-slate-100 text-slate-700 ring-slate-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  blocked: "bg-red-50 text-red-700 ring-red-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
  suspended: "bg-orange-50 text-orange-800 ring-orange-200",
  no_show: "bg-orange-50 text-orange-800 ring-orange-200",
  expired: "bg-slate-100 text-slate-600 ring-slate-200",
  awaiting_payment: "bg-amber-50 text-amber-800 ring-amber-200",
  paid: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  captured: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  processed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ status, className }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap",
        STATUS_TONE[status] || "bg-slate-100 text-slate-700 ring-slate-200",
        className,
      )}
    >
      {label(status)}
    </span>
  );
}

export function LiveBadge({ isLive }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
        isLive ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200",
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", isLive ? "bg-emerald-500" : "bg-slate-400")} />
      {isLive ? "Live" : "Not live"}
    </span>
  );
}

/* ------------------------------------------------------------------ layout */

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-xl font-extrabold tracking-tight text-[var(--ha-ink)] sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--ha-ink-soft)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClassName }) {
  return (
    <section className={cx("rounded-2xl border border-[var(--ha-border)] bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--ha-border)] px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ha-ink)]">{title}</h2>
          {actions}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Label/value grid for detail pages. */
export function Fields({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows
        .filter(Boolean)
        .map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ha-ink-faint)]">{k}</dt>
            <dd className="mt-0.5 break-words text-sm text-[var(--ha-ink)]">{v === undefined || v === null || v === "" ? "—" : v}</dd>
          </div>
        ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ buttons */

const BUTTON_TONE = {
  primary: "bg-[var(--ha-navy)] text-white hover:bg-[#0a2460] focus-visible:ring-[var(--ha-navy)]",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
  warning: "bg-[var(--ha-saffron)] text-white hover:bg-[#e66e00] focus-visible:ring-[var(--ha-saffron)]",
  ghost:
    "border border-[var(--ha-border)] bg-white text-[var(--ha-ink)] hover:bg-[var(--ha-hover)] focus-visible:ring-[var(--ha-navy)]",
};

export function Button({ tone = "ghost", busy, disabled, className, children, icon: Icon, ...rest }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
        BUTTON_TONE[tone],
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ filters */

export function StatusTabs({ tabs, value, onChange, counts }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
      {tabs.map((t) => {
        const active = value === t;
        const n = counts?.[t];
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t)}
            className={cx(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "bg-[var(--ha-navy)] text-white shadow-sm"
                : "text-[var(--ha-ink-soft)] hover:bg-[var(--ha-hover)] hover:text-[var(--ha-ink)]",
            )}
          >
            {t === "all" ? "All" : label(t)}
            {n != null && (
              <span
                className={cx(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-[var(--ha-surface)] text-[var(--ha-ink-faint)]",
                )}
              >
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Search box that reports its value after the user pauses typing. */
export function SearchInput({ value, onChange, placeholder = "Search", className }) {
  const [text, setText] = useState(value || "");
  const first = useRef(true);
  useEffect(() => setText(value || ""), [value]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const t = setTimeout(() => {
      if (text.trim() !== (value || "")) onChange(text.trim());
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ha-ink-faint)]" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--ha-border)] bg-white py-2 pl-9 pr-3 text-sm text-[var(--ha-ink)] placeholder:text-[var(--ha-ink-faint)] focus:border-[var(--ha-navy)] focus:outline-none focus:ring-2 focus:ring-[var(--ha-navy)]/20"
      />
    </div>
  );
}

export function Select({ value, onChange, options, className, ariaLabel }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        "rounded-lg border border-[var(--ha-border)] bg-white px-3 py-2 text-sm text-[var(--ha-ink)] focus:border-[var(--ha-navy)] focus:outline-none focus:ring-2 focus:ring-[var(--ha-navy)]/20",
        className,
      )}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function DateInput({ value, onChange, ariaLabel, min, max, className }) {
  return (
    <input
      type="date"
      aria-label={ariaLabel}
      value={value || ""}
      min={min || undefined}
      max={max || undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        "rounded-lg border border-[var(--ha-border)] bg-white px-3 py-2 text-sm text-[var(--ha-ink)] focus:border-[var(--ha-navy)] focus:outline-none focus:ring-2 focus:ring-[var(--ha-navy)]/20",
        className,
      )}
    />
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= 0) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ha-border)] px-4 py-3 text-sm text-[var(--ha-ink-soft)]">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <span className="hidden sm:inline">Prev</span>
        </Button>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <Button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function Skeleton({ className }) {
  return <div className={cx("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className="divide-y divide-[var(--ha-border)]">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cx("h-4", c === 0 ? "w-1/4" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

export function EmptyState({ title = "Nothing here yet", message, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ha-hover)]">
        <Icon className="h-6 w-6 text-[var(--ha-saffron)]" />
      </div>
      <p className="font-semibold text-[var(--ha-ink)]">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-[var(--ha-ink-soft)]">{message}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
        <AlertTriangle className="h-6 w-6 text-red-600" />
      </div>
      <p className="font-semibold text-[var(--ha-ink)]">Couldn't load this</p>
      <p className="mt-1 max-w-md text-sm text-[var(--ha-ink-soft)]">{message || "Something went wrong."}</p>
      {onRetry && (
        <Button className="mt-4" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ dialog */

/**
 * Confirm an action, optionally asking for a reason. `onConfirm(reason)` may return a
 * promise; the dialog stays open (busy) until it settles and closes only on success.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "primary",
  reason = false,
  reasonRequired = false,
  reasonLabel = "Reason",
  reasonPlaceholder = "Shown to the partner",
  onConfirm,
  onClose,
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setText("");
      setTouched(false);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  const missing = reasonRequired && !text.trim();

  const submit = async () => {
    setTouched(true);
    if (missing) return;
    setBusy(true);
    try {
      await onConfirm(text.trim());
      onClose();
    } catch {
      /* the caller already showed the error; keep the dialog open to retry */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#0B1B3F]/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
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
          {reason && (
            <label className="mt-4 block">
              <span className="text-sm font-semibold text-[var(--ha-ink)]">
                {reasonLabel}
                {reasonRequired ? <span className="text-red-600"> *</span> : <span className="font-normal text-[var(--ha-ink-faint)]"> (optional)</span>}
              </span>
              <textarea
                autoFocus
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder={reasonPlaceholder}
                maxLength={500}
                className={cx(
                  "mt-1.5 w-full rounded-lg border px-3 py-2 text-sm text-[var(--ha-ink)] focus:outline-none focus:ring-2",
                  touched && missing
                    ? "border-red-400 focus:ring-red-200"
                    : "border-[var(--ha-border)] focus:border-[var(--ha-navy)] focus:ring-[var(--ha-navy)]/20",
                )}
              />
              {touched && missing && <span className="mt-1 block text-xs text-red-600">{reasonLabel} is required.</span>}
            </label>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button tone={tone} busy={busy} onClick={submit}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Image or PDF link that opens in a new tab. */
export function FileTile({ url, title }) {
  if (!url) {
    return (
      <div className="flex h-28 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--ha-border)] bg-[var(--ha-surface)] text-xs text-[var(--ha-ink-faint)]">
        <span className="font-semibold">{title}</span>
        <span>Not uploaded</span>
      </div>
    );
  }
  const pdf = isPdf(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-xl border border-[var(--ha-border)] bg-white transition-shadow hover:shadow-md"
      title={`Open ${title} in a new tab`}
    >
      {pdf ? (
        <div className="flex h-24 items-center justify-center bg-red-50 text-sm font-bold text-red-700">PDF</div>
      ) : (
        <img src={url} alt={title} loading="lazy" className="h-24 w-full object-cover" />
      )}
      <div className="truncate px-2 py-1.5 text-xs font-semibold text-[var(--ha-ink)] group-hover:text-[var(--ha-navy)]">{title}</div>
    </a>
  );
}
