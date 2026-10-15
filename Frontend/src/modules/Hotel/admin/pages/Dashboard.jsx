import { Link } from "react-router-dom";
import { ArrowRight, Building2, CalendarCheck, Clock, RefreshCw, Users } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { label } from "../format";
import { Button, Card, ErrorState, PageHeader, Skeleton, cx } from "../components/ui";

const PARTNER_ORDER = ["pending", "approved", "rejected", "blocked"];
const PROPERTY_ORDER = ["pending", "approved", "draft", "rejected", "suspended"];
const BOOKING_ORDER = ["awaiting_payment", "confirmed", "checked_in", "checked_out", "cancelled", "no_show", "expired"];

const DOT = {
  pending: "bg-amber-500",
  awaiting_payment: "bg-amber-500",
  approved: "bg-emerald-500",
  confirmed: "bg-emerald-500",
  checked_in: "bg-sky-500",
  draft: "bg-slate-400",
  checked_out: "bg-slate-400",
  expired: "bg-slate-300",
  rejected: "bg-red-500",
  blocked: "bg-red-500",
  cancelled: "bg-red-500",
  suspended: "bg-orange-500",
  no_show: "bg-orange-500",
};

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);

/** Known statuses first, in order, then anything the server added later. */
const ordered = (counts, order) => {
  const keys = [...order, ...Object.keys(counts || {}).filter((k) => !order.includes(k))];
  return keys.map((k) => [k, Number(counts?.[k]) || 0]);
};

function StatCard({ title, icon: Icon, counts, order, linkFor }) {
  const total = sum(counts);
  return (
    <Card className="overflow-hidden" bodyClassName="p-0">
      <div className="flex items-center justify-between border-b border-[var(--ha-border)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--ha-hover)]">
            <Icon className="h-5 w-5 text-[var(--ha-saffron)]" />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ha-ink)]">{title}</h2>
        </div>
        <span className="text-2xl font-extrabold tabular-nums text-[var(--ha-navy)]">{total}</span>
      </div>
      <ul className="divide-y divide-[var(--ha-border)]">
        {ordered(counts, order).map(([status, n]) => {
          const to = linkFor?.(status);
          const row = (
            <>
              <span className="flex items-center gap-2 text-sm text-[var(--ha-ink-soft)]">
                <span className={cx("h-2 w-2 rounded-full", DOT[status] || "bg-slate-400")} />
                {label(status)}
              </span>
              <span className="font-semibold tabular-nums text-[var(--ha-ink)]">{n}</span>
            </>
          );
          return (
            <li key={status}>
              {to ? (
                <Link to={to} className="flex items-center justify-between px-4 py-2.5 hover:bg-[var(--ha-hover)]">
                  {row}
                </Link>
              ) : (
                <div className="flex items-center justify-between px-4 py-2.5">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function QueueLink({ to, count, title, hint }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-2xl border border-[var(--ha-border)] bg-white p-4 shadow-sm transition-all hover:border-[var(--ha-saffron)] hover:shadow-md"
    >
      <div
        className={cx(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold tabular-nums",
          count > 0 ? "bg-[var(--ha-saffron)] text-white" : "bg-[var(--ha-surface)] text-[var(--ha-ink-faint)]",
        )}
      >
        {count}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-[var(--ha-ink)]">{title}</p>
        <p className="text-sm text-[var(--ha-ink-soft)]">{count > 0 ? hint : "Queue is clear"}</p>
      </div>
      <ArrowRight className="h-5 w-5 text-[var(--ha-ink-faint)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--ha-navy)]" />
    </Link>
  );
}

export default function Dashboard() {
  const { data, loading, error, reload } = useLoad(() => hotelAdmin.overview(), []);
  const partners = data?.partners || {};
  const properties = data?.properties || {};
  const bookings = data?.bookings || {};

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Hotel overview"
        subtitle="Partners, properties and bookings across the platform."
        actions={
          <Button icon={RefreshCw} onClick={reload} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : loading && !data ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[var(--ha-ink-soft)]">
              <Clock className="h-4 w-4" /> Waiting for review
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <QueueLink
                to="/admin/hotel/partners?status=pending"
                count={Number(partners.pending) || 0}
                title="Partner approvals"
                hint="KYC and bank details to check"
              />
              <QueueLink
                to="/admin/hotel/properties?status=pending"
                count={Number(properties.pending) || 0}
                title="Property approvals"
                hint="Listings and documents to verify"
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <StatCard
              title="Partners"
              icon={Users}
              counts={partners}
              order={PARTNER_ORDER}
              linkFor={(s) => `/admin/hotel/partners?status=${s}`}
            />
            <StatCard
              title="Properties"
              icon={Building2}
              counts={properties}
              order={PROPERTY_ORDER}
              linkFor={(s) => `/admin/hotel/properties?status=${s}`}
            />
            <StatCard
              title="Bookings"
              icon={CalendarCheck}
              counts={bookings}
              order={BOOKING_ORDER}
              linkFor={(s) => `/admin/hotel/bookings?status=${s}`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
