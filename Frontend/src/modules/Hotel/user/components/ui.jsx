import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Hotel, Minus, Plus, Star, X } from "lucide-react";
import { discountPercent, formatINR } from "../lib/format";

export const cx = (...parts) => parts.filter(Boolean).join(" ");

export const BTN = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FF7A00] to-[#E85D04] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:brightness-105 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none",
  navy:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B2A6F] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#071A47] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:bg-slate-300",
  outline:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0B2A6F] hover:text-[#0B2A6F] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[#0B2A6F] transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200",
};

export const CARD = "rounded-2xl border border-slate-200/80 bg-white shadow-sm";

/** Image with a fade-in on load and a branded placeholder when missing or broken. */
export function SmartImage({ src, alt = "", className = "", imgClassName = "", eager = false }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(!src);
  useEffect(() => {
    setLoaded(false);
    setFailed(!src);
  }, [src]);
  return (
    <div className={cx("relative overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200", className)}>
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#0B2A6F] to-[#071A47]">
          <Hotel className="h-10 w-10 text-white/30" aria-hidden="true" />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cx(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName
          )}
        />
      )}
    </div>
  );
}

export function RatingBadge({ rating, reviews, size = "sm" }) {
  const n = Number(rating) || 0;
  if (!n || !reviews) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-[#0B2A6F]">
        New
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Rated ${n.toFixed(1)} out of 5 from ${reviews} reviews`}>
      <span
        className={cx(
          "inline-flex items-center gap-1 rounded-md bg-[#16A34A] font-semibold text-white",
          size === "lg" ? "px-2.5 py-1 text-sm" : "px-1.5 py-0.5 text-xs"
        )}
      >
        {n.toFixed(1)} <Star className="h-3 w-3 fill-current" aria-hidden="true" />
      </span>
      <span className="text-xs text-slate-500">({reviews.toLocaleString("en-IN")})</span>
    </span>
  );
}

export function PriceTag({ price, original, suffix = "per night", align = "right", size = "md" }) {
  const off = discountPercent(price, original);
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      {off > 0 && (
        <div className="flex items-center gap-1.5 text-xs" style={{ justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
          <span className="text-slate-400 line-through">{formatINR(original)}</span>
          <span className="font-semibold text-[#16A34A]">{off}% off</span>
        </div>
      )}
      <div className={cx("font-bold text-slate-900", size === "lg" ? "text-2xl" : "text-xl")}>{formatINR(price)}</div>
      {suffix && <div className="text-[11px] text-slate-500">{suffix}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={cx("animate-pulse rounded-lg bg-slate-200/80", className)} aria-hidden="true" />;
}

/** Empty / error / info block. */
export function StateMessage({ icon: Icon, tone = "navy", title, message, children }) {
  const tones = {
    navy: "from-[#0B2A6F] to-[#1E3A8A]",
    saffron: "from-[#FF7A00] to-[#E85D04]",
    red: "from-rose-500 to-rose-600",
    green: "from-[#16A34A] to-[#0F7A36]",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex max-w-md flex-col items-center px-4 py-12 text-center"
      role={tone === "red" ? "alert" : undefined}
    >
      {Icon && (
        <div className={cx("mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br shadow-xl", tones[tone])}>
          <Icon className="h-9 w-9 text-white" aria-hidden="true" />
        </div>
      )}
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {message && <p className="mt-2 text-sm leading-relaxed text-slate-500">{message}</p>}
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </motion.div>
  );
}

export function Stepper({ label, hint, value, min, max, onChange }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div id={id} className="text-sm font-semibold text-slate-800">
          {label}
        </div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="flex items-center gap-3" role="group" aria-labelledby={id}>
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Fewer ${label.toLowerCase()}`}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition hover:border-[#0B2A6F] hover:text-[#0B2A6F] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-base font-semibold tabular-nums" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`More ${label.toLowerCase()}`}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition hover:border-[#0B2A6F] hover:text-[#0B2A6F] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Lock page scroll while an overlay is open. */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, title, children, footer, wide = false }) {
  const panelRef = useRef(null);
  useScrollLock(open);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => panelRef.current?.focus(), 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex ksg-hotel items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            className={cx(
              "relative flex max-h-[88vh] w-full flex-col rounded-t-3xl bg-white shadow-2xl outline-none sm:rounded-3xl",
              wide ? "sm:max-w-3xl" : "sm:max-w-lg"
            )}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-bold text-slate-900">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
            {footer && <div className="border-t border-slate-100 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export const stagger = (step = 0.06) => ({
  hidden: {},
  show: { transition: { staggerChildren: step } },
});
