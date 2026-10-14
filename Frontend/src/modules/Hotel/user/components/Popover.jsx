import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cx, useScrollLock } from "./ui";

const ALIGN = { left: "sm:left-0", right: "sm:right-0", center: "sm:left-1/2 sm:-translate-x-1/2" };

const useIsDesktop = () => typeof window !== "undefined" && window.matchMedia?.("(min-width: 640px)").matches;

/**
 * Anchored dropdown on >= sm screens, bottom sheet on phones. Render it inside a
 * `relative` wrapper; the wrapper should close it on outside clicks (useOutsideClose).
 */
export default function Popover({ open, onClose, label, children, footer, align = "left", className = "" }) {
  const isDesktop = useIsDesktop();
  useScrollLock(open && !isDesktop);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const content = (
    <AnimatePresence>
      {open && (
        <div data-hotel-popover="" className="contents ksg-hotel">
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[70] bg-slate-900/45 sm:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="panel"
            role="dialog"
            aria-label={label}
            initial={isDesktop ? { opacity: 0, y: -6 } : { y: "100%" }}
            animate={isDesktop ? { opacity: 1, y: 0 } : { y: 0 }}
            exit={isDesktop ? { opacity: 0, y: -6 } : { y: "100%" }}
            transition={isDesktop ? { duration: 0.16 } : { type: "spring", damping: 30, stiffness: 320 }}
            className={cx(
              "fixed inset-x-0 bottom-0 z-[71] flex max-h-[88vh] flex-col rounded-t-3xl bg-white text-slate-800 shadow-2xl",
              "sm:absolute sm:bottom-auto sm:top-[calc(100%+10px)] sm:max-h-none sm:rounded-2xl sm:border sm:border-slate-200",
              ALIGN[align],
              className
            )}
          >
            <div className="flex items-center justify-between px-5 pb-1 pt-4 sm:hidden">
              <span className="text-base font-bold">{label}</span>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain p-5 pt-3 sm:pt-5">{children}</div>
            {footer && (
              <div className="border-t border-slate-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
  // Phones: a fixed bottom sheet, portalled so no transformed or clipped ancestor can trap it.
  return isDesktop ? content : createPortal(content, document.body);
}

/** Close when a pointer goes down outside `ref`. */
export function useOutsideClose(ref, active, onClose) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      if (e.target?.closest?.("[data-hotel-popover]")) return;
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [ref, active, onClose]);
}
