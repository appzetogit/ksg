import { AnimatePresence, motion } from "framer-motion";
import { Heart } from "lucide-react";
import { cx } from "./ui";
import { useSavedProperty } from "../lib/saved";

/**
 * Save / unsave a property. `variant="overlay"` sits on a photo (white disc);
 * `variant="ghost"` sits in a toolbar with a text label on larger screens.
 */
export default function HeartButton({ propertyId, name = "this stay", variant = "overlay", className = "" }) {
  const { saved, busy, error, toggle } = useSavedProperty(propertyId);
  const label = saved ? `Remove ${name} from saved` : `Save ${name}`;

  const onClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  };

  return (
    <span className={cx("relative inline-flex", className)}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={saved}
        aria-label={label}
        title={label}
        disabled={busy}
        className={cx(
          "inline-flex items-center justify-center gap-2 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-200 disabled:cursor-wait",
          variant === "overlay"
            ? "h-9 w-9 rounded-full bg-white/95 shadow-md hover:scale-105"
            : "rounded-lg px-3 py-2 text-sm font-semibold text-[#0B2A6F] hover:bg-blue-50"
        )}
      >
        <motion.span key={saved ? "on" : "off"} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 15 }} className="inline-flex">
          <Heart className={cx("h-4.5 w-4.5", saved ? "fill-[#FF7A00] text-[#FF7A00]" : variant === "overlay" ? "text-slate-600" : "")} aria-hidden="true" />
        </motion.span>
        {variant !== "overlay" && <span className="hidden sm:inline">{saved ? "Saved" : "Save"}</span>}
      </button>
      <AnimatePresence>
        {error && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg"
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
