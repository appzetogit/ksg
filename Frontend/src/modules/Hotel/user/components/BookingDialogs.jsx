import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ImagePlus, Loader2, Star, X } from "lucide-react";
import { BTN, Sheet, Skeleton, cx } from "./ui";
import { fmtDateTime } from "./booking";
import { SUB_RATINGS, cancelBooking, getCancelPreview, submitReview } from "../lib/bookingApi";
import { formatINR } from "../lib/format";
import { USER_TOKEN_KEY, uploadFile } from "../../shared/hotelApi";

/** A stable close handler that is ignored while a request is in flight. */
function useGuardedClose(busy, onClose) {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  return useCallback(() => {
    if (!busyRef.current) onClose();
  }, [onClose]);
}

const REASONS = ["Change of plans", "Found a better price", "Booked by mistake", "Property asked me to cancel", "Other"];

/** Cancel with the server's refund preview first. */
export function CancelSheet({ open, booking, onClose, onCancelled }) {
  const ids = useId();
  const [preview, setPreview] = useState({ data: null, loading: false, error: null });
  const [nonce, setNonce] = useState(0);
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const close = useGuardedClose(busy, onClose);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setError("");
    setPreview({ data: null, loading: true, error: null });
    getCancelPreview(booking._id).then(
      (data) => alive && setPreview({ data, loading: false, error: null }),
      (err) => alive && setPreview({ data: null, loading: false, error: err })
    );
    return () => {
      alive = false;
    };
  }, [open, booking._id, nonce]);

  const finalReason = reason === "Other" ? other.trim() : reason;
  const p = preview.data;

  const submit = async () => {
    if (busy) return;
    if (!finalReason) {
      setError("Tell us why you're cancelling.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await cancelBooking(booking._id, finalReason);
      onCancelled(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Cancel booking"
      footer={
        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={busy} className={cx(BTN.outline, "flex-1 py-3")}>
            Keep booking
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !p}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-200 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? "Cancelling…" : "Cancel booking"}
          </button>
        </div>
      }
    >
      {preview.loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : preview.error ? (
        <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700" role="alert">
          {preview.error.message}
          <button type="button" onClick={() => setNonce((x) => x + 1)} className="mt-2 block font-semibold underline">
            Try again
          </button>
        </div>
      ) : p ? (
        <div className="space-y-5">
          <div className={cx("rounded-2xl p-4", Number(p.refundAmount) > 0 ? "bg-green-50" : "bg-amber-50")}>
            <p className="text-xs font-semibold uppercase text-slate-500">You'll get back</p>
            <p className={cx("mt-1 text-3xl font-extrabold", Number(p.refundAmount) > 0 ? "text-[#0F7A36]" : "text-amber-800")}>
              {formatINR(Number(p.refundAmount) || 0)}
              {Number.isFinite(Number(p.refundPercent)) && <span className="ml-2 text-sm font-semibold">({Number(p.refundPercent)}%)</span>}
            </p>
            {(Number(p.walletRefund) > 0 || Number(p.gatewayRefund) > 0) && (
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {Number(p.gatewayRefund) > 0 && <li>{formatINR(p.gatewayRefund)} to your original payment method (5–7 working days)</li>}
                {Number(p.walletRefund) > 0 && <li>{formatINR(p.walletRefund)} to your KSG wallet (instant)</li>}
              </ul>
            )}
            {Number(booking.payment?.amountPaid) <= 0 && <p className="mt-2 text-sm text-slate-600">Nothing was paid online, so there's nothing to refund.</p>}
          </div>
          {p.policyText && <p className="text-sm leading-relaxed text-slate-600">{p.policyText}</p>}
          {p.freeCancellationUntil && <p className="text-xs text-slate-500">Free cancellation until {fmtDateTime(p.freeCancellationUntil)}</p>}

          <fieldset disabled={busy}>
            <legend className="mb-2 text-sm font-bold text-slate-900">Why are you cancelling?</legend>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <label key={r} className={cx("cursor-pointer rounded-full border px-3 py-1.5 text-sm transition", reason === r ? "border-[#0B2A6F] bg-[#0B2A6F] text-white" : "border-slate-300 text-slate-700 hover:border-slate-400")}>
                  <input type="radio" name={`${ids}-reason`} value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
                  {r}
                </label>
              ))}
            </div>
            {reason === "Other" && (
              <textarea
                aria-label="Reason"
                rows={3}
                maxLength={300}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                className="mt-3 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B2A6F] focus:outline-none focus:ring-4 focus:ring-blue-100"
                placeholder="Tell us a little more"
              />
            )}
          </fieldset>
          {error && (
            <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

function StarInput({ value, onChange, label, size = "lg" }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const cls = size === "lg" ? "h-9 w-9" : "h-6 w-6";
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onChange(value === n && size !== "lg" ? 0 : n)}
          onMouseEnter={() => setHover(n)}
          className="rounded-md p-0.5 transition hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-200"
        >
          <Star className={cx(cls, n <= shown ? "fill-[#FF7A00] text-[#FF7A00]" : "text-slate-300")} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

const RATING_WORDS = ["", "Terrible", "Poor", "Okay", "Good", "Excellent"];
const MAX_PHOTOS = 5;

/** Overall + sub-ratings, comment and optional photos → POST /user/reviews. */
export function ReviewSheet({ open, booking, onClose, onReviewed }) {
  const ids = useId();
  const fileRef = useRef(null);
  const [rating, setRating] = useState(0);
  const [subs, setSubs] = useState({});
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const close = useGuardedClose(busy, onClose);
  const [error, setError] = useState("");

  const addPhotos = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, MAX_PHOTOS - photos.length);
    e.target.value = "";
    if (!files.length) return;
    setError("");
    setUploading((n) => n + files.length);
    await Promise.all(
      files.map(async (file) => {
        try {
          if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
          if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB.`);
          const url = await uploadFile(file, { kind: "image", folder: "hotel/reviews", tokenKey: USER_TOKEN_KEY });
          if (url) setPhotos((list) => (list.length < MAX_PHOTOS ? [...list, url] : list));
        } catch (err) {
          setError(err.message);
        } finally {
          setUploading((n) => n - 1);
        }
      })
    );
  };

  const submit = async () => {
    if (busy || uploading) return;
    if (!rating) {
      setError("Tap a star to rate your stay.");
      return;
    }
    setBusy(true);
    setError("");
    const subRatings = Object.fromEntries(Object.entries(subs).filter(([, v]) => v > 0));
    try {
      const review = await submitReview({
        bookingId: booking._id,
        rating,
        ...(Object.keys(subRatings).length ? { subRatings } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(photos.length ? { photos } : {}),
      });
      onReviewed(review);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Review your stay"
      footer={
        <button type="button" onClick={submit} disabled={busy || uploading > 0} className={cx(BTN.primary, "w-full py-3.5")}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {busy ? "Posting…" : uploading ? "Uploading photos…" : "Post review"}
        </button>
      }
    >
      <fieldset disabled={busy} className="space-y-6">
        <div className="text-center">
          <p className="text-sm text-slate-500">How was your stay at</p>
          <p className="font-bold text-slate-900">{booking.snapshot?.propertyName}</p>
          <div className="mt-3 flex justify-center">
            <StarInput value={rating} onChange={setRating} label="Overall rating" />
          </div>
          <motion.p key={rating} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-1 h-5 text-sm font-semibold text-[#FF7A00]">
            {RATING_WORDS[rating]}
          </motion.p>
        </div>

        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
          {SUB_RATINGS.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-sm text-slate-700">{s.label}</span>
              <StarInput value={subs[s.key] || 0} onChange={(v) => setSubs((x) => ({ ...x, [s.key]: v }))} label={s.label} size="sm" />
            </div>
          ))}
        </div>

        <div>
          <label htmlFor={`${ids}-c`} className="mb-1.5 block text-sm font-bold text-slate-900">
            Tell other travellers (optional)
          </label>
          <textarea
            id={`${ids}-c`}
            rows={4}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-[#0B2A6F] focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="What did you like? What could be better?"
          />
          <p className="text-right text-[11px] text-slate-400">{comment.length}/1000</p>
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-slate-900">Photos (optional)</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((url) => (
              <div key={url} className="relative h-20 w-20 overflow-hidden rounded-xl bg-slate-100">
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos((list) => list.filter((u) => u !== url))}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <div key={`u${i}`} className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Uploading" />
              </div>
            ))}
            {photos.length + uploading < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-[#FF7A00] hover:text-[#FF7A00]"
              >
                <ImagePlus className="h-5 w-5" aria-hidden="true" />
                <span className="text-[10px] font-semibold">Add</span>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700" role="alert">
            {error}
          </p>
        )}
      </fieldset>
    </Sheet>
  );
}
