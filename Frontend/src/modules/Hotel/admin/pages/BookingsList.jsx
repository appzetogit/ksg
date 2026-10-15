import { useNavigate } from "react-router-dom";
import { CalendarCheck, ChevronRight, X } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { useListParams } from "../useListParams";
import { formatDate, label, money, pageOf } from "../format";
import {
  Card,
  DateInput,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  StatusTabs,
  TableSkeleton,
} from "../components/ui";

const TABS = ["all", "awaiting_payment", "confirmed", "checked_in", "checked_out", "cancelled", "no_show", "expired"];
const LIMIT = 20;

/** "Paid", "₹X due" or "Pay at hotel" for a booking's payment block. */
export function paymentSummary(payment = {}) {
  const due = Number(payment.amountDue) || 0;
  const paid = Number(payment.amountPaid) || 0;
  if (due <= 0) return { text: "Paid", tone: "text-emerald-700" };
  if (paid <= 0) return { text: `Pay at hotel · ${money(due)}`, tone: "text-[var(--ha-navy)]" };
  return { text: `Part paid · ${money(due)} due`, tone: "text-amber-700" };
}

export default function BookingsList() {
  const navigate = useNavigate();
  const [params, update] = useListParams({ status: "all", q: "", propertyId: "", partnerId: "", from: "", to: "", page: 1 });

  // Options for the property / partner filters (approved ones; a linked id outside them still filters).
  const { data: propData } = useLoad(() => hotelAdmin.properties({ status: "approved", limit: 100 }).catch(() => null), []);
  const { data: partnerData } = useLoad(() => hotelAdmin.partners({ status: "approved", limit: 100 }).catch(() => null), []);
  const propertyOptions = pageOf(propData).items;
  const partnerOptions = pageOf(partnerData).items;

  const { data, loading, error, reload } = useLoad(
    () =>
      hotelAdmin.bookings({
        status: params.status,
        q: params.q,
        propertyId: params.propertyId,
        partnerId: params.partnerId,
        from: params.from,
        to: params.to,
        page: params.page,
        limit: LIMIT,
      }),
    [params.status, params.q, params.propertyId, params.partnerId, params.from, params.to, params.page],
  );
  const list = pageOf(data);
  const filtered = params.q || params.propertyId || params.partnerId || params.from || params.to;

  const withOption = (options, id, fallback) =>
    id && !options.some((o) => o._id === id) ? [...options, { _id: id, name: fallback }] : options;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Bookings" subtitle="Every hotel booking on the platform. Open one to change its status or refund." />

      <Card bodyClassName="p-0">
        <div className="space-y-3 border-b border-[var(--ha-border)] p-3">
          <StatusTabs tabs={TABS} value={params.status} onChange={(status) => update({ status })} />
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
            <SearchInput value={params.q} onChange={(q) => update({ q })} placeholder="Booking ref, guest name or phone" />
            <Select
              ariaLabel="Property"
              value={params.propertyId}
              onChange={(propertyId) => update({ propertyId })}
              options={[["", "All properties"], ...withOption(propertyOptions, params.propertyId, "Selected property").map((p) => [p._id, p.name || "Untitled"])]}
            />
            <Select
              ariaLabel="Partner"
              value={params.partnerId}
              onChange={(partnerId) => update({ partnerId })}
              options={[
                ["", "All partners"],
                ...withOption(partnerOptions, params.partnerId, "Selected partner").map((p) => [p._id, p.name || p.phone || "Unnamed"]),
              ]}
            />
            <DateInput ariaLabel="Check-in from" value={params.from} max={params.to} onChange={(from) => update({ from })} />
            <DateInput ariaLabel="Check-in to" value={params.to} min={params.from} onChange={(to) => update({ to })} />
          </div>
          {filtered && (
            <button
              type="button"
              onClick={() => update({ q: "", propertyId: "", partnerId: "", from: "", to: "" })}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ha-navy)] underline"
            >
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <TableSkeleton cols={7} />
        ) : list.items.length === 0 ? (
          <EmptyState icon={CalendarCheck} title={filtered ? "No bookings match these filters" : "No bookings here"} />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-[var(--ha-surface)] text-[11px] font-bold uppercase tracking-wide text-[var(--ha-ink-faint)]">
                  <tr>
                    <th className="px-4 py-3">Booking</th>
                    <th className="px-4 py-3">Guest</th>
                    <th className="px-4 py-3">Property / partner</th>
                    <th className="px-4 py-3">Stay</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ha-border)]">
                  {list.items.map((b) => {
                    const pay = paymentSummary(b.payment);
                    const open = () => navigate(`/admin/hotel/bookings/${b._id}`);
                    return (
                      <tr
                        key={b._id}
                        tabIndex={0}
                        onClick={open}
                        onKeyDown={(e) => e.key === "Enter" && open()}
                        className="cursor-pointer hover:bg-[var(--ha-hover)] focus:bg-[var(--ha-hover)] focus:outline-none"
                      >
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-semibold text-[var(--ha-ink)]">{b.bookingRef}</p>
                          <p className="text-xs text-[var(--ha-ink-faint)]">{formatDate(b.createdAt)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[var(--ha-ink)]">{b.guestDetails?.name || b.user?.name || "—"}</p>
                          <p className="text-xs tabular-nums text-[var(--ha-ink-faint)]">{b.guestDetails?.phone || b.user?.phone}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="max-w-[220px] truncate text-[var(--ha-ink)]">{b.snapshot?.propertyName || "—"}</p>
                          <p className="max-w-[220px] truncate text-xs text-[var(--ha-ink-faint)]">{b.partner?.name || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-[var(--ha-ink-soft)]">
                          <p className="whitespace-nowrap">
                            {formatDate(b.checkIn)} → {formatDate(b.checkOut)}
                          </p>
                          <p className="text-xs text-[var(--ha-ink-faint)]">
                            {b.nights}N · {b.rooms || 1} room{b.rooms > 1 ? "s" : ""} · {label(b.payment?.mode)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--ha-ink)]">{money(b.pricing?.total)}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-xs font-semibold ${pay.tone}`}>{pay.text}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={b.status} />
                        </td>
                        <td className="px-4 py-3">
                          <ChevronRight className="h-4 w-4 text-[var(--ha-ink-faint)]" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={list.page} limit={list.limit} total={list.total} onPage={(page) => update({ page })} />
          </div>
        )}
      </Card>
    </div>
  );
}
