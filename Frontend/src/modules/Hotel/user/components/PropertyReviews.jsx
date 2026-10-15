import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MessageSquareText, Star, Store } from "lucide-react";
import { Skeleton, cx } from "./ui";
import { SUB_RATINGS, getPropertyReviews } from "../lib/bookingApi";
import { plural, ratingLabel } from "../lib/format";

const LIMIT = 5;

const fmtMonth = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "";
};

function Stars({ value }) {
  const n = Math.round(Number(value) || 0);
  return (
    <span className="inline-flex" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cx("h-3.5 w-3.5", i <= n ? "fill-[#FF7A00] text-[#FF7A00]" : "text-slate-200")} aria-hidden="true" />
      ))}
    </span>
  );
}

function Summary({ summary }) {
  const total = Number(summary?.totalReviews) || 0;
  const avg = Number(summary?.avgRating) || 0;
  const breakdown = summary?.breakdown || {};
  return (
    <div className="grid gap-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 sm:grid-cols-[auto_1fr] sm:items-center">
      <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-2 sm:pr-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#16A34A] text-2xl font-extrabold text-white">{avg.toFixed(1)}</span>
        <span>
          <span className="block font-bold text-slate-900">{ratingLabel(avg)}</span>
          <span className="block text-sm text-slate-500">{plural(total, "review")}</span>
        </span>
      </div>
      <ul className="space-y-1.5" aria-label="Rating breakdown">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = Number(breakdown[star] ?? breakdown[String(star)]) || 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          return (
            <li key={star} className="flex items-center gap-2 text-xs">
              <span className="flex w-7 items-center gap-0.5 font-semibold text-slate-600">
                {star} <Star className="h-3 w-3 fill-current text-slate-400" aria-hidden="true" />
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <motion.span
                  className={cx("block h-full rounded-full", star >= 4 ? "bg-[#16A34A]" : star === 3 ? "bg-[#FF7A00]" : "bg-rose-500")}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${pct}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                />
              </span>
              <span className="w-8 text-right tabular-nums text-slate-500">{count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewItem({ review: r }) {
  const name = String(r.user?.name || "Guest").trim() || "Guest";
  const subs = SUB_RATINGS.filter((s) => Number(r.subRatings?.[s.key]) > 0);
  return (
    <motion.li initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#0B2A6F] to-[#1E3A8A] text-sm font-bold text-white">
            {name[0].toUpperCase()}
          </span>
          <span>
            <span className="block text-sm font-bold text-slate-900">{name}</span>
            <span className="block text-xs text-slate-400">{fmtMonth(r.createdAt)}</span>
          </span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md bg-[#16A34A] px-2 py-0.5 text-xs font-bold text-white">
          {Number(r.rating).toFixed(1)} <Star className="h-3 w-3 fill-current" aria-hidden="true" />
        </span>
      </div>
      {subs.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {subs.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-slate-500">
              {s.label} <Stars value={r.subRatings[s.key]} />
            </li>
          ))}
        </ul>
      )}
      {r.comment && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">{r.comment}</p>}
      {r.photos?.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {r.photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">
              <img src={url} alt={`Photo from ${name}`} loading="lazy" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}
      {r.reply?.text && (
        <div className="mt-3 rounded-xl border-l-4 border-[#0B2A6F] bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-[#0B2A6F]">
            <Store className="h-3.5 w-3.5" aria-hidden="true" /> Response from the property
            {r.reply.at && <span className="font-normal text-slate-400">· {fmtMonth(r.reply.at)}</span>}
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{r.reply.text}</p>
        </div>
      )}
    </motion.li>
  );
}

/** Rating summary and paginated approved reviews for a property. */
export default function PropertyReviews({ propertyId }) {
  const [state, setState] = useState({ items: [], page: 0, total: 0, summary: null, loading: true, error: null });

  const load = (page) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return getPropertyReviews(propertyId, { page, limit: LIMIT }).then(
      (res) =>
        setState((s) => ({
          items: page === 1 ? res.items : [...s.items, ...res.items.filter((r) => !s.items.some((x) => x._id === r._id))],
          page: res.page || page,
          total: res.total,
          summary: res.summary || s.summary,
          loading: false,
          error: null,
        })),
      (error) => setState((s) => ({ ...s, loading: false, error }))
    );
  };

  useEffect(() => {
    if (!propertyId) return;
    setState({ items: [], page: 0, total: 0, summary: null, loading: true, error: null });
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const { items, page, total, summary, loading, error } = state;
  const totalReviews = Number(summary?.totalReviews) || total;

  if (loading && page === 0) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading reviews">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (error && page === 0) {
    return (
      <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700" role="alert">
        {error.message}{" "}
        <button type="button" onClick={() => load(1)} className="font-semibold underline">
          Try again
        </button>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <MessageSquareText className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
        <p className="mt-2 font-semibold text-slate-700">No reviews yet</p>
        <p className="text-sm text-slate-500">Be one of the first guests to stay and share your experience.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {totalReviews > 0 && <Summary summary={{ avgRating: summary?.avgRating, totalReviews, breakdown: summary?.breakdown }} />}
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {items.map((r) => (
            <ReviewItem key={r._id} review={r} />
          ))}
        </AnimatePresence>
      </ul>
      {error && (
        <p className="text-sm text-rose-600" role="alert">
          {error.message}
        </p>
      )}
      {items.length < total && (
        <button
          type="button"
          onClick={() => load(page + 1)}
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-[#0B2A6F] transition hover:border-[#0B2A6F] disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? "Loading…" : `Show more reviews (${total - items.length} more)`}
        </button>
      )}
    </div>
  );
}
