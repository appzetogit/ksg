import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, MessageSquareText, Phone, RefreshCw, RotateCcw, Shuffle } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { formatDate, fullAddress, label, money } from "../format";
import { BackLink } from "./PartnerDetail";
import { paymentSummary } from "./BookingsList";
import FormDialog, { DialogField } from "../components/FormDialog";
import { Button, Card, DetailSkeleton, ErrorState, Fields, PageHeader, StatusBadge, cx } from "../components/ui";
import { useHotelAccess } from "../hotelAccess";

/** Status changes an admin may make from each status (the server re-checks). */
const NEXT = {
  awaiting_payment: ["cancelled"],
  confirmed: ["checked_in", "no_show", "cancelled"],
  checked_in: ["checked_out", "cancelled"],
};

const STATUS_HELP = {
  checked_in: "Guest has arrived. Normally allowed from the check-in date.",
  checked_out: "Closes the stay and schedules the partner payout. Needs the balance paid unless forced.",
  no_show: "Guest never arrived. Normally allowed only after the check-in day.",
  cancelled: "Cancels and refunds the guest as per the server's rules for an admin cancel.",
};

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function Line({ k, v, strong, tone }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <span className={cx("text-[var(--ha-ink-soft)]", strong && "font-semibold text-[var(--ha-ink)]")}>{k}</span>
      <span className={cx("tabular-nums", strong ? "font-bold text-[var(--ha-ink)]" : "text-[var(--ha-ink)]", tone)}>{v}</span>
    </div>
  );
}

function PersonCard({ title, person, fallback, to }) {
  return (
    <Card title={title}>
      {person || fallback?.name ? (
        <>
          <p className="font-semibold text-[var(--ha-ink)]">{person?.name || fallback?.name || "Unnamed"}</p>
          {(person?.phone || fallback?.phone) && (
            <a href={`tel:${person?.phone || fallback?.phone}`} className="mt-0.5 inline-flex items-center gap-1 text-sm tabular-nums text-[var(--ha-navy)] hover:underline">
              <Phone className="h-3.5 w-3.5" /> {person?.phone || fallback?.phone}
            </a>
          )}
          {person?.email && <p className="truncate text-sm text-[var(--ha-ink-soft)]">{person.email}</p>}
          {person?.status && (
            <div className="mt-2">
              <StatusBadge status={person.status} />
            </div>
          )}
          {to && (
            <Link to={to} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--ha-navy)] hover:underline">
              View <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--ha-ink-faint)]">Not available.</p>
      )}
    </Card>
  );
}

function MoneyTable({ rows, columns, empty }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-[var(--ha-ink-faint)]">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-[var(--ha-surface)] text-[11px] font-bold uppercase tracking-wide text-[var(--ha-ink-faint)]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cx("px-4 py-3", c.right && "text-right")}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ha-border)]">
          {rows.map((r, i) => (
            <tr key={r._id || i}>
              {columns.map((c) => (
                <td key={c.key} className={cx("px-4 py-3 text-[var(--ha-ink-soft)]", c.right && "text-right tabular-nums")}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BookingDetail() {
  const { canWrite } = useHotelAccess();
  const canManage = canWrite("hotel_bookings");
  const { id } = useParams();
  const { data, loading, error, reload } = useLoad(() => hotelAdmin.booking(id), [id]);
  const [dialog, setDialog] = useState(null); // 'status' | 'refund'
  const [form, setForm] = useState({ status: "", reason: "", force: false, amount: "" });
  const back = <BackLink to="/admin/hotel/bookings">Bookings</BackLink>;

  if (error && !data) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Booking" back={back} />
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      </div>
    );
  }
  if (!data?.booking) {
    return (
      <div className="mx-auto max-w-6xl">
        <DetailSkeleton />
      </div>
    );
  }

  const b = data.booking;
  const partner = data.partner || b.partner;
  const user = data.user || b.user;
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const refunds = Array.isArray(data.refunds) ? data.refunds : [];
  const p = b.pricing || {};
  const pay = b.payment || {};
  const refunded = refunds.filter((r) => r.status !== "failed").reduce((a, r) => a + n(r.amount), 0);
  const refundable = Math.max(0, Math.round((n(pay.amountPaid) - refunded) * 100) / 100);
  const options = NEXT[b.status] || [];
  const history = [...(b.statusHistory || [])].sort((x, y) => new Date(x.at) - new Date(y.at));
  const paySum = paymentSummary(pay);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const openStatus = () => {
    setForm({ status: options[0] || "", reason: "", force: false, amount: "" });
    setDialog("status");
  };
  const openRefund = () => {
    setForm({ status: "", reason: "", force: false, amount: String(refundable) });
    setDialog("refund");
  };

  const amountNum = Number(form.amount);
  const amountError =
    form.amount === ""
      ? ""
      : !Number.isFinite(amountNum) || amountNum <= 0
        ? "Enter an amount above zero."
        : amountNum > refundable
          ? `At most ${money(refundable)} can be refunded.`
          : "";
  const reasonNeeded = dialog === "refund" || form.status === "cancelled";

  const submitStatus = async () => {
    try {
      await hotelAdmin.setBookingStatus(id, { status: form.status, reason: form.reason.trim(), force: form.force });
      toast.success(`Booking ${label(form.status).toLowerCase()}`);
      await reload();
    } catch (err) {
      toast.error(err?.message || "Could not change the status");
      throw err;
    }
  };

  const submitRefund = async () => {
    try {
      await hotelAdmin.refundBooking(id, amountNum, form.reason.trim());
      toast.success(`Refund of ${money(amountNum)} started`);
      await reload();
    } catch (err) {
      toast.error(err?.message || "Could not refund");
      throw err;
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{b.bookingRef}</span>
            <StatusBadge status={b.status} />
          </span>
        }
        subtitle={`${b.snapshot?.propertyName || "Property"} · booked ${formatDate(b.createdAt, true)}`}
        actions={
          <>
            <Button icon={RefreshCw} onClick={reload} disabled={loading}>
              Refresh
            </Button>
            {canManage && options.length > 0 && (
              <Button tone="primary" icon={Shuffle} onClick={openStatus} disabled={loading}>
                Change status
              </Button>
            )}
            {canManage && (
              <Button
                tone="warning"
                icon={RotateCcw}
                onClick={openRefund}
                disabled={loading || refundable <= 0}
                title={refundable <= 0 ? "Nothing left to refund" : undefined}
              >
                Refund
              </Button>
            )}
          </>
        }
      />

      {b.cancellation && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">Cancelled by {label(b.cancellation.by)}</span> on {formatDate(b.cancellation.at, true)}
          {b.cancellation.reason ? ` — ${b.cancellation.reason}` : ""}
          {b.cancellation.refundAmount != null ? ` · refund ${money(b.cancellation.refundAmount)}` : ""}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Stay">
            <Fields
              rows={[
                ["Property", b.snapshot?.propertyName],
                ["Room type", b.snapshot?.roomTypeName],
                ["Check-in", `${formatDate(b.checkIn)}${b.snapshot?.checkInTime ? ` · from ${b.snapshot.checkInTime}` : ""}`],
                ["Check-out", `${formatDate(b.checkOut)}${b.snapshot?.checkOutTime ? ` · by ${b.snapshot.checkOutTime}` : ""}`],
                ["Nights × rooms", `${b.nights} × ${b.rooms || 1}`],
                ["Guests", `${n(b.guests?.adults)} adults, ${n(b.guests?.children)} children`],
                ["Guest name", b.guestDetails?.name],
                ["Guest phone", b.guestDetails?.phone],
                ["Guest email", b.guestDetails?.email],
                ["Cancellation policy", label(b.snapshot?.cancellationPolicy?.type)],
                ["Address", typeof b.snapshot?.address === "string" ? b.snapshot.address : fullAddress(b.snapshot?.address)],
              ]}
            />
            {b.specialRequests && (
              <p className="mt-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" /> {b.specialRequests}
              </p>
            )}
          </Card>

          <Card title="Price, commission & payout">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Line k="Room charges" v={money(p.roomCharges)} />
                {n(p.extraGuestCharges) > 0 && <Line k="Extra guests" v={money(p.extraGuestCharges)} />}
                {n(p.couponDiscount) > 0 && <Line k={`Coupon ${p.couponCode || ""}`} v={`− ${money(p.couponDiscount)}`} tone="text-emerald-700" />}
                {n(p.prepaidDiscount) > 0 && <Line k="Prepaid discount" v={`− ${money(p.prepaidDiscount)}`} tone="text-emerald-700" />}
                <Line k="Taxable" v={money(p.taxableAmount ?? p.subtotal)} />
                <Line k={`GST (${p.gstRate ?? "—"}%)`} v={money(p.gstAmount)} />
                <Line k="Platform fee" v={money(p.platformFee)} />
                <Line k="GST on platform fee" v={money(p.platformFeeGst)} />
                <div className="my-1 border-t border-dashed border-[var(--ha-border)]" />
                <Line k="Guest total" v={money(p.total)} strong />
              </div>
              <div>
                <Line k={`Commission (${p.commissionRate ?? "—"}%)`} v={money(p.commissionAmount)} />
                <Line k="GST on commission" v={money(p.commissionGst)} />
                <div className="my-1 border-t border-dashed border-[var(--ha-border)]" />
                <Line k="Partner payout" v={money(p.partnerPayout)} strong tone="text-emerald-700" />
                <div className="mt-4 rounded-lg bg-[var(--ha-surface)] p-3">
                  <Line k="Payment mode" v={label(pay.mode)} />
                  <Line k="Paid" v={money(pay.amountPaid)} />
                  {n(pay.walletAmount) > 0 && <Line k="of which wallet" v={money(pay.walletAmount)} />}
                  <Line k="Due at hotel" v={money(pay.amountDue)} />
                  <Line k="Refunded" v={money(refunded)} />
                  <Line k="Refundable" v={money(refundable)} strong />
                  <p className={cx("mt-1 text-xs font-semibold", paySum.tone)}>{paySum.text}</p>
                </div>
              </div>
            </div>
          </Card>

          <Card title={`Payments (${payments.length})`} bodyClassName="p-0">
            <MoneyTable
              rows={payments}
              empty="No payments recorded."
              columns={[
                { key: "at", title: "When", render: (r) => formatDate(r.createdAt || r.at, true) },
                { key: "kind", title: "Kind", render: (r) => label(r.kind || r.method || r.type) },
                { key: "ref", title: "Reference", render: (r) => <span className="font-mono text-xs">{r.razorpayPaymentId || r.paymentId || r.razorpayOrderId || "—"}</span> },
                { key: "status", title: "Status", render: (r) => (r.status ? <StatusBadge status={r.status} /> : "—") },
                { key: "amount", title: "Amount", right: true, render: (r) => money(r.amount) },
              ]}
            />
          </Card>

          <Card title={`Refunds (${refunds.length})`} bodyClassName="p-0">
            <MoneyTable
              rows={refunds}
              empty="No refunds."
              columns={[
                { key: "at", title: "When", render: (r) => formatDate(r.createdAt || r.at, true) },
                { key: "reason", title: "Reason", render: (r) => r.reason || "—" },
                {
                  key: "split",
                  title: "Wallet / gateway",
                  render: (r) => (r.walletAmount != null || r.gatewayAmount != null ? `${money(r.walletAmount || 0)} / ${money(r.gatewayAmount || 0)}` : "—"),
                },
                { key: "status", title: "Status", render: (r) => (r.status ? <StatusBadge status={r.status} /> : "—") },
                { key: "amount", title: "Amount", right: true, render: (r) => money(r.amount) },
              ]}
            />
          </Card>
        </div>

        <div className="space-y-5">
          <PersonCard title="Customer" person={user} fallback={b.guestDetails} />
          <PersonCard title="Partner" person={partner} to={b.partnerId ? `/admin/hotel/partners/${b.partnerId?._id || b.partnerId}` : null} />
          {b.propertyId && (
            <Link
              to={`/admin/hotel/properties/${b.propertyId?._id || b.propertyId}`}
              className="flex items-center justify-between rounded-2xl border border-[var(--ha-border)] bg-white px-4 py-3 text-sm font-semibold text-[var(--ha-navy)] shadow-sm hover:bg-[var(--ha-hover)]"
            >
              View property <ChevronRight className="h-4 w-4" />
            </Link>
          )}

          <Card title="Status timeline">
            {history.length === 0 ? (
              <p className="text-sm text-[var(--ha-ink-faint)]">No history.</p>
            ) : (
              <ol className="relative ml-1.5 border-l border-[var(--ha-border)]">
                {history.map((h, i) => (
                  <li key={`${h.status}-${h.at}-${i}`} className="mb-4 ml-4 last:mb-0">
                    <span
                      className={cx(
                        "absolute -left-[6px] mt-1 h-3 w-3 rounded-full border-2 border-white",
                        i === history.length - 1 ? "bg-[var(--ha-saffron)]" : "bg-slate-300",
                      )}
                    />
                    <p className="text-sm font-semibold text-[var(--ha-ink)]">{label(h.status)}</p>
                    <p className="text-xs text-[var(--ha-ink-faint)]">
                      {formatDate(h.at, true)}
                      {h.by?.role ? ` · ${label(h.by.role)}` : ""}
                    </p>
                    {h.note && <p className="mt-0.5 text-xs text-[var(--ha-ink-soft)]">{h.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <FormDialog
        open={dialog === "status"}
        title="Change booking status"
        submitLabel={form.status ? `Mark ${label(form.status).toLowerCase()}` : "Change"}
        tone={form.status === "cancelled" || form.status === "no_show" ? "danger" : "primary"}
        canSubmit={Boolean(form.status) && (!reasonNeeded || form.reason.trim().length > 0)}
        onSubmit={submitStatus}
        onClose={() => setDialog(null)}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-[var(--ha-ink)]">New status</legend>
          {options.map((s) => (
            <label
              key={s}
              className={cx(
                "flex cursor-pointer gap-3 rounded-lg border p-3",
                form.status === s ? "border-[var(--ha-navy)] bg-[var(--ha-surface)]" : "border-[var(--ha-border)]",
              )}
            >
              <input type="radio" name="status" value={s} checked={form.status === s} onChange={() => set({ status: s })} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-[var(--ha-ink)]">{label(s)}</span>
                <span className="block text-xs text-[var(--ha-ink-soft)]">{STATUS_HELP[s]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <DialogField
          textarea
          rows={3}
          maxLength={500}
          label="Reason"
          required={reasonNeeded}
          hint={reasonNeeded ? "Shown to the guest and partner." : "Optional, kept in the timeline."}
          value={form.reason}
          onChange={(e) => set({ reason: e.target.value })}
        />
        <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <input type="checkbox" checked={form.force} onChange={(e) => set({ force: e.target.checked })} className="mt-0.5" />
          <span>
            <span className="font-semibold">Force</span> — override date rules and an unpaid balance. Use only when you have confirmed it with the
            partner or guest.
          </span>
        </label>
      </FormDialog>

      <FormDialog
        open={dialog === "refund"}
        title="Manual refund"
        message={`Paid ${money(pay.amountPaid)}, already refunded ${money(refunded)}. Up to ${money(refundable)} can be refunded.`}
        submitLabel="Refund"
        tone="warning"
        canSubmit={form.amount !== "" && !amountError && form.reason.trim().length > 0}
        onSubmit={submitRefund}
        onClose={() => setDialog(null)}
      >
        <DialogField
          label="Amount (₹)"
          required
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          max={refundable}
          value={form.amount}
          onChange={(e) => set({ amount: e.target.value })}
          error={amountError}
        />
        <DialogField
          textarea
          rows={3}
          maxLength={500}
          label="Reason"
          required
          value={form.reason}
          onChange={(e) => set({ reason: e.target.value })}
          hint="Recorded with the refund."
        />
      </FormDialog>
    </div>
  );
}
