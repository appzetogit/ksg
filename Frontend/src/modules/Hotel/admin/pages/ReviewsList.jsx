import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Star, XCircle } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { useListParams } from "../useListParams";
import { formatDate, pageOf } from "../format";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  StatusTabs,
  TableSkeleton,
  cx,
} from "../components/ui";

const TABS = ["pending", "approved", "rejected", "all"];
const LIMIT = 20;

const ACTIONS = {
  approved: {
    title: "Approve this review?",
    message: "It becomes public on the property page and counts towards its rating.",
    label: "Approve",
    tone: "success",
    done: "Review approved",
  },
  rejected: {
    title: "Reject this review?",
    message: "It is hidden from guests and removed from the property's rating.",
    label: "Reject",
    tone: "danger",
    done: "Review rejected",
  },
};

function Stars({ value }) {
  const v = Math.round(Number(value) || 0);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cx("h-3.5 w-3.5", i <= v ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200")} />
      ))}
    </span>
  );
}

const idOf = (v) => (v && typeof v === "object" ? v._id : v);

export default function ReviewsList() {
  const [params, update] = useListParams({ status: "pending", propertyId: "", page: 1 });
  const [pending, setPending] = useState(null); // { review, status }

  const { data: propData } = useLoad(() => hotelAdmin.properties({ status: "approved", limit: 100 }).catch(() => null), []);
  const properties = pageOf(propData).items;
  const names = Object.fromEntries(properties.map((p) => [p._id, p.name]));

  const { data, loading, error, reload, setData } = useLoad(
    () => hotelAdmin.reviews({ status: params.status, propertyId: params.propertyId, page: params.page, limit: LIMIT }),
    [params.status, params.propertyId, params.page],
  );
  const list = pageOf(data);

  const confirm = async () => {
    const { review, status } = pending;
    try {
      await hotelAdmin.setReviewStatus(review._id, status);
      toast.success(ACTIONS[status].done);
      // Drop it from a filtered tab at once, then refresh counts.
      if (params.status !== "all" && params.status !== status && data) {
        setData({ ...data, items: list.items.filter((r) => r._id !== review._id), total: Math.max(0, list.total - 1) });
      }
      reload();
    } catch (err) {
      toast.error(err?.message || "Could not update the review");
      throw err;
    }
  };

  const propertyOptions =
    params.propertyId && !names[params.propertyId] ? [...properties, { _id: params.propertyId, name: "Selected property" }] : properties;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Reviews" subtitle="Guest reviews waiting for moderation, and everything already published or hidden." />

      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ha-border)] p-3">
          <StatusTabs tabs={TABS} value={params.status} onChange={(status) => update({ status })} />
          <Select
            ariaLabel="Property"
            value={params.propertyId}
            onChange={(propertyId) => update({ propertyId })}
            options={[["", "All properties"], ...propertyOptions.map((p) => [p._id, p.name || "Untitled"])]}
          />
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <TableSkeleton cols={4} />
        ) : list.items.length === 0 ? (
          <EmptyState icon={Star} title={params.status === "pending" ? "No reviews waiting" : "No reviews here"} />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <ul className="divide-y divide-[var(--ha-border)]">
              {list.items.map((r) => {
                const pid = idOf(r.propertyId);
                const propertyName = r.property?.name || (typeof r.propertyId === "object" ? r.propertyId?.name : null) || names[pid];
                return (
                  <li key={r._id} className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Stars value={r.rating} />
                        <span className="text-sm font-bold text-[var(--ha-ink)]">{Number(r.rating || 0).toFixed(1)}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-1 text-sm text-[var(--ha-ink-soft)]">
                        <span className="font-semibold text-[var(--ha-ink)]">{r.user?.name || "Guest"}</span> · {formatDate(r.createdAt)}
                        {pid && (
                          <>
                            {" · "}
                            <Link to={`/admin/hotel/properties/${pid}`} className="font-semibold text-[var(--ha-navy)] hover:underline">
                              {propertyName || "Property"}
                            </Link>
                          </>
                        )}
                      </p>
                      {r.comment ? (
                        <p className="mt-2 whitespace-pre-line text-sm text-[var(--ha-ink)]">{r.comment}</p>
                      ) : (
                        <p className="mt-2 text-sm italic text-[var(--ha-ink-faint)]">No comment</p>
                      )}
                      {r.photos?.length > 0 && (
                        <div className="mt-2 flex gap-2 overflow-x-auto">
                          {r.photos.map((src) => (
                            <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="shrink-0">
                              <img src={src} alt="" loading="lazy" className="h-14 w-20 rounded-md object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                      {r.reply?.text && (
                        <p className="mt-2 border-l-2 border-[var(--ha-saffron)] pl-3 text-sm text-[var(--ha-ink-soft)]">
                          <span className="font-semibold">Partner reply:</span> {r.reply.text}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {r.status !== "approved" && (
                        <Button tone="success" icon={CheckCircle2} onClick={() => setPending({ review: r, status: "approved" })}>
                          Approve
                        </Button>
                      )}
                      {r.status !== "rejected" && (
                        <Button tone="danger" icon={XCircle} onClick={() => setPending({ review: r, status: "rejected" })}>
                          Reject
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination page={list.page} limit={list.limit} total={list.total} onPage={(page) => update({ page })} />
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending ? ACTIONS[pending.status].title : ""}
        message={pending ? ACTIONS[pending.status].message : ""}
        confirmLabel={pending ? ACTIONS[pending.status].label : "Confirm"}
        tone={pending ? ACTIONS[pending.status].tone : "primary"}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
