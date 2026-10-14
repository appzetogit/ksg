import { useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileText, ImagePlus, Loader2, Star, Trash2, Upload } from "lucide-react";
import { uploadFile } from "../../shared/hotelApi";
import { isPdf } from "../lib/utils";
import { cx } from "./ui";

const MAX_BYTES = 10 * 1024 * 1024;

/** Image preview that falls back to a document icon (private files may not render). */
function Thumb({ url, className }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken || isPdf(url)) {
    return (
      <span className={cx("flex items-center justify-center bg-slate-100", className)}>
        {url ? <FileText className="h-5 w-5 text-[#0B2A6F]" /> : <Upload className="h-5 w-5 text-slate-400" />}
      </span>
    );
  }
  return <img src={url} alt="" onError={() => setBroken(true)} className={cx("object-cover", className)} />;
}

/**
 * One file (KYC image, certificate, property document). Uploads as soon as it is
 * picked so the form only ever carries URLs.
 */
export function FileUpload({
  label,
  hint,
  required,
  optional,
  value,
  onChange,
  kind = "document",
  folder,
  accept = "image/*,application/pdf",
  error: externalError,
}) {
  const id = useId();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("That file is over 10 MB. Choose a smaller photo or PDF.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const url = await uploadFile(file, { kind, folder });
      if (!url) throw new Error("Upload failed. Try again.");
      onChange(url);
    } catch (e) {
      setError(e.message || "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const shownError = error || externalError;

  return (
    <div>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">
          {label}
          {required && <span className="text-rose-600"> *</span>}
          {optional && <span className="font-normal text-slate-400"> (optional)</span>}
        </label>
      )}
      <button
        id={id}
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className={cx(
          "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100",
          value ? "border-green-300 bg-green-50/60" : "border-dashed border-slate-300 bg-white hover:bg-slate-50",
          shownError && !value && "border-rose-300",
        )}
      >
        <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg">
          {busy ? (
            <span className="flex h-full w-full items-center justify-center bg-slate-100">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
            </span>
          ) : (
            <Thumb url={value} className="h-full w-full" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-700">
            {busy ? "Uploading…" : value ? "Uploaded. Tap to replace" : "Tap to upload a photo or PDF"}
          </span>
          {hint && <span className="block text-xs text-slate-500">{hint}</span>}
        </span>
        {value && !busy && <CheckCircle2 className="h-5 w-5 shrink-0 text-[#16A34A]" />}
      </button>
      {shownError && (
        <p className="mt-1 text-xs text-rose-600" role="alert">
          {shownError}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * A photo grid: several images uploaded at once, removable, one optionally marked
 * as the cover. `images` is the full list; `cover` (if used) is one of them.
 */
export function PhotoGrid({ images = [], onChange, cover, onCoverChange, folder = "hotel/properties", min = 3, label }) {
  const input = useRef(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");

  const add = async (files) => {
    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const tooBig = list.find((f) => f.size > MAX_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is over 10 MB.`);
      return;
    }
    setError("");
    setUploading(list.length);
    const urls = [];
    for (const file of list) {
      try {
        const url = await uploadFile(file, { kind: "image", folder });
        if (url) urls.push(url);
      } catch (e) {
        setError(e.message || "Some photos could not be uploaded.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (urls.length) {
      const next = [...images, ...urls];
      onChange(next);
      if (onCoverChange && !cover) onCoverChange(next[0]);
    }
  };

  const remove = (url) => {
    const next = images.filter((u) => u !== url);
    onChange(next);
    if (onCoverChange && cover === url) onCoverChange(next[0] || "");
  };

  const count = images.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{label || "Photos"}</span>
        <span className={cx("text-xs font-medium", count >= min ? "text-[#16A34A]" : "text-slate-500")}>
          {count} added{min ? ` · at least ${min}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        <AnimatePresence initial={false}>
          {images.map((url) => {
            const isCover = onCoverChange && cover === url;
            return (
              <motion.div
                key={url}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={cx(
                  "group relative aspect-square overflow-hidden rounded-xl bg-slate-100 ring-2",
                  isCover ? "ring-[#FF7A00]" : "ring-transparent",
                )}
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
                {isCover && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-[#FF7A00] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    Cover
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                  {onCoverChange && !isCover && (
                    <button
                      type="button"
                      onClick={() => onCoverChange(url)}
                      className="rounded-md bg-white/90 p-1 text-slate-800 hover:bg-white"
                      aria-label="Use as cover photo"
                      title="Use as cover"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(url)}
                    className="rounded-md bg-white/90 p-1 text-rose-600 hover:bg-white"
                    aria-label="Remove photo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`up-${i}`} className="flex aspect-square items-center justify-center rounded-xl bg-slate-100">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-[#FF7A00] hover:bg-orange-50/50 hover:text-[#E85D04] focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-100"
        >
          <ImagePlus className="h-6 w-6" />
          <span className="text-xs font-medium">Add photos</span>
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
