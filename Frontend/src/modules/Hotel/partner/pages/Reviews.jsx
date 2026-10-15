import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageSquareText, RefreshCw, Reply, Star } from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { asList, formatDate } from "../lib/utils";
import { Pager } from "../components/bookings";
import { Button, Card, Chip, EmptyState, InlineError, PageHeader, Skeleton, TextAreaField, cx } from "../components/ui";

const LIMIT = 20;

const REVIEW_STATUS = {
  pending: { label: "Awaiting approval", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  approved: { label: "Published", chip: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "Hidden by KSG", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
};

function Stars({ value, size = "h-4 w-4" }) {
  const v = Math.round(Number(value) || 0);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${Number(value) || 0} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cx(size, i <= v ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200")} />
      ))}
    </span>
  );
}

const propertyIdOf = (r) => (typeof r.propertyId === "object" ? r.propertyId?._id : r.propertyId);

function ReviewItem({ review, propertyName, onReplied }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const status = REVIEW_STATUS[review.status];

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const data = await partnerApi.post(`/partner/reviews/${review._id}/reply`, { text: body });
      toast.success("Reply posted");
      onReplied(data?.review || { ...review, reply: { text: body, at: new Date().toISOString() } });
      setOpen(false);
      setText("");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Stars value={review.rating} />
            <span className="text-sm font-semibold text-slate-900">{Number(review.rating || 0).toFixed(1)}</span>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-800">{review.user?.name || "Guest"}</p>
          <p className="text-xs text-slate-500">
            {formatDate(review.createdAt)}
            {propertyName ? ` · ${propertyName}` : ""}
          </p>
        </div>
        {status && (
          <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", status.chip)}>
            {status.label}
          </span>
        )}
      </div>

      {review.subRatings && Object.keys(review.subRatings).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(review.subRatings).map(([k, v]) => (
            <span key={k} className="rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
              {k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())} · <span className="font-semibold">{v}</span>
            </span>
          ))}
        </div>
      )}

      {review.comment ? (
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{review.comment}</p>
      ) : (
        <p className="mt-3 text-sm italic text-slate-400">No written comment.</p>
      )}

      {review.photos?.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {review.photos.map((src) => (
            <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <img src={src} alt="" loading="lazy" className="h-16 w-20 rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}

      {review.reply?.text ? (
        <div className="mt-4 rounded-xl border-l-4 border-[#FF7A00] bg-orange-50/60 px-3 py-2">
          <p className="text-xs font-semibold text-[#E85D04]">Your reply · {formatDate(review.reply.at)}</p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{review.reply.text}</p>
        </div>
      ) : open ? (
        <div className="mt-4">
          <TextAreaField
            label="Your reply"
            rows={3}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Thank the guest and respond to their feedback. Replies are public."
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" loading={busy} disabled={!text.trim()} onClick={submit}>
              Post reply
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" icon={Reply} className="mt-4" onClick={() => setOpen(true)}>
          Reply
        </Button>
      )}
    </Card>
  );
}

export default function Reviews() {
  const [properties, setProperties] = useState(null);
  const [propertyId, setPropertyId] = useState("");
  const [show, setShow] = useState("all"); // all | unreplied | low
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const seq = useRef(0);

  useEffect(() => {
    partnerApi
      .get("/partner/properties")
      .then((d) => setProperties(asList(d, "properties")))
      .catch(() => setProperties([]));
  }, []);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await partnerApi.get("/partner/reviews", { propertyId: propertyId || undefined, page, limit: LIMIT });
      if (id === seq.current) setState({ loading: false, error: "", data });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [propertyId, page]);

  useEffect(() => {
    load();
  }, [load]);

  const items = asList(state.data);
  const names = useMemo(() => Object.fromEntries((properties || []).map((p) => [p._id, p.name])), [properties]);
  const visible = items.filter((r) => (show === "unreplied" ? !r.reply?.text : show === "low" ? Number(r.rating) <= 3 : true));
  const rated = (properties || []).filter((p) => (!propertyId || p._id === propertyId) && p.status !== "draft");

  const replaceReview = (next) =>
    setState((s) => ({
      ...s,
      data: Array.isArray(s.data)
        ? s.data.map((r) => (r._id === next._id ? { ...r, ...next } : r))
        : { ...s.data, items: asList(s.data).map((r) => (r._id === next._id ? { ...r, ...next } : r)) },
    }));

  return (
    <div>
      <PageHeader
        title="Reviews"
        subtitle="What guests say about their stay. A thoughtful reply helps future guests decide."
        action={
          <Button variant="secondary" icon={RefreshCw} onClick={load} disabled={state.loading}>
            Refresh
          </Button>
        }
      />

      {/* rating summary per property */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!properties
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          : rated.map((p) => (
              <Card key={p._id} className="flex items-center gap-4 p-4">
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-amber-50">
                  <span className="text-lg font-bold leading-none text-[#071A47]">{p.totalReviews ? Number(p.avgRating || 0).toFixed(1) : "—"}</span>
                  <Star className="mt-1 h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{p.name || "Untitled property"}</p>
                  <p className="text-xs text-slate-500">
                    {p.totalReviews ? `${p.totalReviews} review${p.totalReviews === 1 ? "" : "s"}` : "No reviews yet"}
                  </p>
                  {p.totalReviews > 0 && <Stars value={p.avgRating} size="h-3.5 w-3.5" />}
                </div>
              </Card>
            ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          aria-label="Property"
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm focus:border-[#0B2A6F] focus:outline-none focus:ring-4 focus:ring-blue-100"
        >
          <option value="">All properties</option>
          {(properties || []).map((p) => (
            <option key={p._id} value={p._id}>
              {p.name || "Untitled property"}
            </option>
          ))}
        </select>
        <Chip selected={show === "all"} onClick={() => setShow("all")}>
          All
        </Chip>
        <Chip selected={show === "unreplied"} onClick={() => setShow("unreplied")}>
          Needs reply
        </Chip>
        <Chip selected={show === "low"} onClick={() => setShow("low")}>
          3★ and below
        </Chip>
      </div>

      {state.error && (
        <div className="mb-4">
          <InlineError message={state.error} onRetry={load} />
        </div>
      )}

      {state.loading && !state.data ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        state.data && (
          <EmptyState
            icon={MessageSquareText}
            title={items.length ? "Nothing matches this filter" : "No reviews yet"}
            text={items.length ? "Try another filter." : "Guests can review a stay after they check out."}
          />
        )
      ) : (
        <div className={cx("space-y-3", state.loading && "opacity-60")}>
          {visible.map((r) => (
            <ReviewItem key={r._id} review={r} propertyName={names[propertyIdOf(r)] || r.property?.name} onReplied={replaceReview} />
          ))}
        </div>
      )}
      {show !== "all" && items.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">Filter applies to the reviews on this page.</p>
      )}
      <Pager
        page={Number(state.data?.page) || page}
        limit={Number(state.data?.limit) || LIMIT}
        total={Number(state.data?.total) || 0}
        busy={state.loading}
        onPage={setPage}
      />
    </div>
  );
}
