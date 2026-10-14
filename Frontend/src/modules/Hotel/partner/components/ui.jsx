import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, AlertTriangle, Loader2, X } from "lucide-react";
import { PARTNER_STATUS_META, PROPERTY_STATUS_META } from "../lib/constants";

/* Small, shared building blocks for the partner portal. */

const cx = (...c) => c.filter(Boolean).join(" ");
export { cx };

// ── Buttons ────────────────────────────────────────────────────────────────

const VARIANTS = {
  primary:
    "bg-[#FF7A00] text-white shadow-sm shadow-orange-500/20 hover:bg-[#E85D04] focus-visible:ring-orange-200 disabled:bg-orange-300",
  navy: "bg-[#0B2A6F] text-white shadow-sm hover:bg-[#071A47] focus-visible:ring-blue-200 disabled:bg-slate-400",
  secondary:
    "border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:ring-slate-200 disabled:text-slate-400",
  ghost: "text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-200 disabled:text-slate-400",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-700 focus-visible:ring-rose-200 disabled:bg-rose-300",
  dangerGhost: "text-rose-600 hover:bg-rose-50 focus-visible:ring-rose-200",
  success: "bg-[#16A34A] text-white shadow-sm hover:bg-green-700 focus-visible:ring-green-200 disabled:bg-green-300",
};

const SIZES = {
  sm: "h-9 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-11 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon: Icon,
  children,
  className,
  disabled,
  type = "button",
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-semibold transition focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

/** A router link styled as a button. */
export function LinkButton({ to, variant = "primary", size = "md", icon: Icon, children, className, ...props }) {
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-semibold transition focus:outline-none focus-visible:ring-4",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </Link>
  );
}

// ── Form fields ────────────────────────────────────────────────────────────

const inputBase =
  "w-full rounded-xl border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-4 disabled:bg-slate-50 disabled:text-slate-500";
const inputTone = (error) =>
  error
    ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
    : "border-slate-300 focus:border-[#0B2A6F] focus:ring-blue-100";

export function Field({ label, hint, error, required, htmlFor, children, className, optional }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-800">
          {label}
          {required && <span className="text-rose-600"> *</span>}
          {optional && <span className="font-normal text-slate-400"> (optional)</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-rose-600" role="alert">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField({ label, hint, error, required, optional, className, inputClassName, prefix, suffix, ...props }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} optional={optional} htmlFor={id} className={className}>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">{prefix}</span>
        )}
        <input
          id={id}
          aria-invalid={Boolean(error) || undefined}
          className={cx(inputBase, inputTone(error), "h-11", prefix && "pl-9", suffix && "pr-14", inputClassName)}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{suffix}</span>
        )}
      </div>
    </Field>
  );
}

export function TextAreaField({ label, hint, error, required, optional, className, rows = 4, maxLength, value, ...props }) {
  const id = useId();
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      optional={optional}
      htmlFor={id}
      className={className}
    >
      <textarea
        id={id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        aria-invalid={Boolean(error) || undefined}
        className={cx(inputBase, inputTone(error), "py-2.5")}
        {...props}
      />
      {maxLength && (
        <p className="mt-0.5 text-right text-[11px] text-slate-400">
          {String(value || "").length}/{maxLength}
        </p>
      )}
    </Field>
  );
}

export function SelectField({ label, hint, error, required, optional, className, options, placeholder, ...props }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} required={required} optional={optional} htmlFor={id} className={className}>
      <select id={id} className={cx(inputBase, inputTone(error), "h-11 pr-8")} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({ checked, onChange, label, disabled, busy, size = "md" }) {
  const dims = size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const knob = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const shift = size === "sm" ? "translate-x-4" : "translate-x-5";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex shrink-0 items-center rounded-full p-0.5 transition focus:outline-none focus-visible:ring-4 focus-visible:ring-green-200 disabled:cursor-not-allowed disabled:opacity-50",
        dims,
        checked ? "bg-[#16A34A]" : "bg-slate-300",
      )}
    >
      <span
        className={cx(
          "flex items-center justify-center rounded-full bg-white shadow transition-transform",
          knob,
          checked ? shift : "translate-x-0",
        )}
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
      </span>
    </button>
  );
}

export function Chip({ selected, onClick, children, icon: Icon }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100",
        selected
          ? "border-[#0B2A6F] bg-[#0B2A6F] text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

// ── Surfaces ───────────────────────────────────────────────────────────────

export function Card({ children, className, ...props }) {
  return (
    <div className={cx("rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)} {...props}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action, back }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-bold tracking-tight text-[#071A47] md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cx("animate-pulse rounded-xl bg-slate-200/70", className)} aria-hidden />;
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {Icon && (
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-[#FF7A00]">
          <Icon className="h-7 w-7" />
        </span>
      )}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function InlineError({ message, onRetry }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function StatusChip({ status, kind = "property" }) {
  const meta = (kind === "partner" ? PARTNER_STATUS_META : PROPERTY_STATUS_META)[status] || {
    label: status || "Unknown",
    chip: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", meta.chip)}>
      {meta.label}
    </span>
  );
}

export function SoonTag() {
  return (
    <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#E85D04]">
      Soon
    </span>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-[#FF7A00]" aria-label="Loading" />
    </div>
  );
}

// ── Modal & confirm ────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, footer, size = "md" }) {
  const panel = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && closeRef.current?.();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => panel.current?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const width = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-3xl" }[size];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-[#071A47]/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className={cx(
              "relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-2xl focus:outline-none sm:rounded-3xl",
              width,
            )}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * `const [confirm, confirmDialog] = useConfirm()`; render `confirmDialog` and
 * `await confirm({ title, message, confirmLabel, danger })` resolves true/false.
 */
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setState({ ...opts, resolve });
      }),
    [],
  );
  const close = (result) => {
    state?.resolve(result);
    setState(null);
  };
  const dialog = (
    <Modal
      open={Boolean(state)}
      onClose={() => close(false)}
      title={state?.title || "Are you sure?"}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={state?.danger ? "danger" : "primary"} onClick={() => close(true)}>
            {state?.confirmLabel || "Confirm"}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        {state?.danger && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
        )}
        <p className="text-sm leading-6 text-slate-600">{state?.message}</p>
      </div>
    </Modal>
  );
  return [confirm, dialog];
}

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22, ease: "easeOut" },
};
