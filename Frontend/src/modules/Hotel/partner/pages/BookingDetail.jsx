import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  Ban,
  CalendarDays,
  CheckCircle2,
  Clock3,
  IndianRupee,
  LogIn,
  LogOut,
  Mail,
  MessageSquareText,
  Phone,
  UserX,
  Users,
} from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { BASE_PATH } from "../lib/constants";
import { formatDate, money, num } from "../lib/utils";
import { BOOKING_STATUS_META, PAYMENT_MODE_LABELS, guestsLabel, num0, partnerActions, paymentState } from "../lib/bookings";
import { ActionDialog, BookingStatusChip, PaymentBadge } from "../components/bookings";
import { Button, Card, InlineError, PageHeader, SectionTitle, Skeleton, TextAreaField, TextField, cx } from "../components/ui";

const when = (v) =>
  v
    ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

const ROLE_LABEL = { user: "Guest", USER: "Guest", partner: "You", HOTEL_PARTNER: "You", admin: "KSG", ADMIN: "KSG", system: "System" };

function Row({ label, value, strong, tone, hint }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className={cx("text-slate-600", strong && "font-semibold text-slate-900")}>
        {label}
        {hint && <span className="block text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      <span className={cx("tabular-nums", strong ? "font-bold text-[#071A47]" : "text-slate-800", tone)}>{value}</span>
    </div>
  );
}

function PriceBreakdown({ booking }) {
  const p = booking.pricing || {};
  const has = (v) => num0(v) !== 0;
  return (
    <Card className="p-5">
      <SectionTitle title="Price breakdown" />
      <Row label={`Room charges (${booking.rooms || 1} × ${booking.nights || 1} night${booking.nights === 1 ? "" : "s"})`} value={money(p.roomCharges)} />
      {has(p.extraGuestCharges) && <Row label="Extra guests" value={money(p.extraGuestCharges)} />}
      {has(p.couponDiscount) && <Row label={`Coupon${p.couponCode ? ` (${p.couponCode})` : ""}`} value={`− ${money(p.couponDiscount)}`} tone="text-green-700" />}
      {has(p.prepaidDiscount) && <Row label="Prepaid discount" value={`− ${money(p.prepaidDiscount)}`} tone="text-green-700" />}
      <Row label="Taxable amount" value={money(p.taxableAmount ?? p.subtotal)} />
      <Row label={`GST${p.gstRate != null ? ` (${p.gstRate}%)` : ""}`} value={money(p.gstAmount)} />
      {(has(p.platformFee) || has(p.platformFeeGst)) && (
        <Row label="KSG platform fee (incl. GST)" hint="Charged to the guest, kept by KSG" value={money(num0(p.platformFee) + num0(p.platformFeeGst))} />
      )}
      <div className="my-2 border-t border-dashed border-slate-200" />
      <Row label="Guest pays" value={money(p.total)} strong />
      {(p.commissionAmount != null || p.partnerPayout != null) && (
        <>
          <div className="my-2 border-t border-dashed border-slate-200" />
          <Row
            label={`KSG commission${p.commissionRate != null ? ` (${p.commissionRate}%)` : ""}`}
            value={`− ${money(p.commissionAmount)}`}
            tone="text-rose-600"
          />
          {has(p.commissionGst) && <Row label="GST on commission" value={`− ${money(p.commissionGst)}`} tone="text-rose-600" />}
          <div className="mt-2 rounded-xl bg-green-50 px-3 py-2">
            <Row label="Your payout" value={money(p.partnerPayout)} strong tone="text-green-700" />
          </div>
        </>
      )}
    </Card>
  );
}

function PaymentCard({ booking }) {
  const pay = booking.payment || {};
  const s = paymentState(booking);
  return (
    <Card className="p-5">
      <SectionTitle title="Payment" action={<PaymentBadge booking={booking} />} />
      <Row label="Mode" value={PAYMENT_MODE_LABELS[pay.mode] || pay.mode || "—"} />
      <Row label="Paid" value={money(pay.amountPaid)} />
      {num0(pay.walletAmount) > 0 && <Row label="of which KSG wallet" value={money(pay.walletAmount)} />}
      <Row label="To collect at the hotel" value={money(s.due)} strong={s.due > 0} tone={s.due > 0 ? "text-amber-700" : undefined} />
      {booking.cancellation && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <p className="font-semibold">
            Cancelled by {ROLE_LABEL[booking.cancellation.by] || booking.cancellation.by || "—"} on {when(booking.cancellation.at)}
          </p>
          {booking.cancellation.reason && <p className="mt-0.5">Reason: {booking.cancellation.reason}</p>}
          {booking.cancellation.refundAmount != null && <p className="mt-0.5">Refund to guest: {money(booking.cancellation.refundAmount)}</p>}
        </div>
      )}
    </Card>
  );
}

function Timeline({ history }) {
  const items = [...(history || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
  return (
    <Card className="p-5">
      <SectionTitle title="Status timeline" />
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No history yet.</p>
      ) : (
        <ol className="relative ml-2 border-l border-slate-200">
          {items.map((h, i) => (
            <li key={`${h.status}-${h.at}-${i}`} className="mb-4 ml-5 last:mb-0">
              <span
                className={cx(
                  "absolute -left-[7px] mt-1 h-3.5 w-3.5 rounded-full border-2 border-white",
                  i === items.length - 1 ? "bg-[#FF7A00]" : "bg-slate-300",
                )}
              />
              <p className="text-sm font-semibold text-slate-900">{BOOKING_STATUS_META[h.status]?.label || h.status}</p>
              <p className="text-xs text-slate-500">
                {when(h.at)}
                {h.by?.role ? ` · ${ROLE_LABEL[h.by.role] || h.by.role}` : ""}
              </p>
              {h.note && <p className="mt-0.5 text-xs text-slate-600">{h.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** A button that stays visible when not allowed, with the reason underneath. */
function ActionButton({ rule, icon, variant, children, onClick }) {
  if (!rule) return null;
  return (
    <div className="flex flex-col">
      <Button variant={variant} icon={icon} disabled={!rule.allowed} onClick={onClick} title={rule.reason || undefined} className="w-full">
        {children}
      </Button>
      {!rule.allowed && rule.reason && <span className="mt-1 text-[11px] text-slate-500">{rule.reason}</span>}
    </div>
  );
}

export default function BookingDetail() {
  const { id } = useParams();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // 'checkIn' | 'checkOut' | 'markPaid' | 'noShow' | 'cancel'
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await partnerApi.get(`/partner/bookings/${id}`);
      setBooking(data?.booking || data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Link to={`${BASE_PATH}/bookings`} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#0B2A6F]">
      <ArrowLeft className="h-4 w-4" /> Bookings
    </Link>
  );

  if (loading && !booking) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  if (!booking) {
    return (
      <div>
        <PageHeader title="Booking" back={back} />
        <InlineError message={error || "Booking not found."} onRetry={load} />
      </div>
    );
  }

  const b = booking;
  const due = num0(b.payment?.amountDue);
  const paid = num0(b.payment?.amountPaid);
  const rules = partnerActions(b);
  const guest = b.guestDetails || {};

  /** Run a call; toast the server's message on failure and rethrow to keep the dialog open. */
  const act = async (call, success) => {
    try {
      const data = await call();
      toast.success(success);
      if (data?.booking) setBooking(data.booking);
      await load();
    } catch (e) {
      toast.error(e.message);
      load(); // a two-step action may have half-succeeded; show the server's state
      throw e;
    }
  };

  const open = (name) => {
    setAmount(due > 0 ? String(due) : "");
    setReason("");
    setDialog(name);
  };

  const amountNum = num(amount, 0);
  const amountError = amount === "" ? "" : amountNum <= 0 ? "Enter an amount above zero." : amountNum > due ? `At most ${money(due)} is due.` : "";

  const anyAction = Object.values(rules).some(Boolean);

  return (
    <div>
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {guest.name || "Guest"}
            <BookingStatusChip status={b.status} />
          </span>
        }
        subtitle={
          <>
            <span className="font-mono">{b.bookingRef}</span> · booked {when(b.createdAt)}
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <InlineError message={error} onRetry={load} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <SectionTitle title="Stay" subtitle={b.snapshot?.propertyName} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <LogIn className="h-3.5 w-3.5" /> Check-in
                </p>
                <p className="mt-1 font-semibold text-slate-900">{formatDate(b.checkIn, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
                {b.snapshot?.checkInTime && <p className="text-xs text-slate-500">from {b.snapshot.checkInTime}</p>}
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <LogOut className="h-3.5 w-3.5" /> Check-out
                </p>
                <p className="mt-1 font-semibold text-slate-900">{formatDate(b.checkOut, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
                {b.snapshot?.checkOutTime && <p className="text-xs text-slate-500">by {b.snapshot.checkOutTime}</p>}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-slate-400" /> {b.nights} night{b.nights === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BedDouble className="h-4 w-4 text-slate-400" /> {b.rooms || 1} × {b.snapshot?.roomTypeName || "Room"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-slate-400" /> {guestsLabel(b.guests)}
              </span>
            </div>
            {b.specialRequests && (
              <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="font-semibold">Special request: </span>
                  {b.specialRequests}
                </span>
              </div>
            )}
          </Card>

          <PriceBreakdown booking={b} />
          <Timeline history={b.statusHistory} />
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <SectionTitle title="Guest" />
            <p className="font-semibold text-slate-900">{guest.name || "—"}</p>
            <div className="mt-3 flex flex-col gap-2">
              {guest.phone && (
                <a
                  href={`tel:${guest.phone}`}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#16A34A] px-4 text-sm font-semibold text-white shadow-sm hover:bg-green-700"
                >
                  <Phone className="h-4 w-4" /> Call {guest.phone}
                </a>
              )}
              {guest.email && (
                <a href={`mailto:${guest.email}`} className="inline-flex items-center gap-2 truncate text-sm text-[#0B2A6F] hover:underline">
                  <Mail className="h-4 w-4 shrink-0" /> {guest.email}
                </a>
              )}
            </div>
          </Card>

          {anyAction && (
            <Card className="p-5">
              <SectionTitle title="Actions" />
              <div className="grid gap-3">
                <ActionButton rule={rules.checkIn} icon={LogIn} variant="success" onClick={() => open("checkIn")}>
                  Check in
                </ActionButton>
                <ActionButton rule={rules.checkOut} icon={LogOut} variant="navy" onClick={() => open("checkOut")}>
                  Check out
                </ActionButton>
                <ActionButton rule={rules.markPaid} icon={IndianRupee} variant="secondary" onClick={() => open("markPaid")}>
                  Mark payment collected
                </ActionButton>
                <ActionButton rule={rules.noShow} icon={UserX} variant="secondary" onClick={() => open("noShow")}>
                  Mark no-show
                </ActionButton>
                <ActionButton rule={rules.cancel} icon={Ban} variant="dangerGhost" onClick={() => open("cancel")}>
                  Cancel booking
                </ActionButton>
              </div>
            </Card>
          )}

          <PaymentCard booking={b} />
        </div>
      </div>

      {/* ── dialogs ── */}
      <ActionDialog
        open={dialog === "checkIn"}
        onClose={() => setDialog(null)}
        title="Check in guest?"
        submitLabel="Check in"
        variant="success"
        onSubmit={() => act(() => partnerApi.put(`/partner/bookings/${id}/check-in`), "Guest checked in")}
      >
        <p className="text-sm leading-6 text-slate-600">
          Confirm that <span className="font-semibold text-slate-900">{guest.name || "the guest"}</span> has arrived for{" "}
          {b.rooms || 1} × {b.snapshot?.roomTypeName || "room"}.
          {due > 0 && ` ${money(due)} is still to be collected at the hotel.`}
        </p>
      </ActionDialog>

      <ActionDialog
        open={dialog === "checkOut"}
        onClose={() => setDialog(null)}
        title="Check out guest?"
        submitLabel={due > 0 ? `Mark ${money(due)} collected & check out` : "Check out"}
        variant="navy"
        onSubmit={() =>
          act(async () => {
            if (due > 0) await partnerApi.put(`/partner/bookings/${id}/mark-paid`, { amount: due });
            return partnerApi.put(`/partner/bookings/${id}/check-out`, {});
          }, "Guest checked out")
        }
        extraActions={
          due > 0
            ? [
                {
                  label: "Check out without payment",
                  variant: "dangerGhost",
                  onClick: () =>
                    act(() => partnerApi.put(`/partner/bookings/${id}/check-out`, { force: true }), "Guest checked out with balance unpaid"),
                },
              ]
            : undefined
        }
      >
        {due > 0 ? (
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <p className="text-sm leading-6 text-slate-600">
              <span className="font-semibold text-slate-900">{money(due)}</span> is still unpaid. Collect it before the guest leaves and
              record it, or check out anyway if you will settle it another way.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-6 text-slate-600">The booking will be closed and its payout scheduled.</p>
        )}
      </ActionDialog>

      <ActionDialog
        open={dialog === "markPaid"}
        onClose={() => setDialog(null)}
        title="Record payment collected"
        submitLabel="Record payment"
        canSubmit={amount !== "" && !amountError}
        onSubmit={() => act(() => partnerApi.put(`/partner/bookings/${id}/mark-paid`, { amount: amountNum }), `${money(amountNum)} recorded`)}
      >
        <p className="mb-3 text-sm text-slate-600">
          Paid so far {money(paid)} · due {money(due)}. Enter the cash or card amount you collected at the hotel.
        </p>
        <TextField
          label="Amount collected"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          prefix="₹"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amountError}
          required
        />
      </ActionDialog>

      <ActionDialog
        open={dialog === "noShow"}
        onClose={() => setDialog(null)}
        title="Mark as no-show?"
        submitLabel="Mark no-show"
        variant="danger"
        onSubmit={() => act(() => partnerApi.put(`/partner/bookings/${id}/no-show`), "Marked as no-show")}
      >
        <p className="text-sm leading-6 text-slate-600">
          Use this only if {guest.name || "the guest"} did not arrive. The rooms are released and the booking closes. This cannot be undone.
        </p>
      </ActionDialog>

      <ActionDialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        title="Cancel this booking?"
        submitLabel="Cancel booking"
        variant="danger"
        canSubmit={reason.trim().length >= 3}
        onSubmit={() => act(() => partnerApi.put(`/partner/bookings/${id}/cancel`, { reason: reason.trim() }), "Booking cancelled")}
      >
        <div className="mb-4 flex gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The guest gets a <span className="font-semibold">full refund</span>
            {paid > 0 ? ` of ${money(paid)}` : ""} and is told you cancelled. Frequent cancellations affect your listing.
          </span>
        </div>
        <TextAreaField
          label="Reason"
          required
          rows={3}
          maxLength={500}
          placeholder="e.g. Room under maintenance"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Shared with the guest and KSG."
        />
      </ActionDialog>

      {b.status === "checked_out" && (
        <p className="mt-6 flex items-center gap-1.5 text-sm text-slate-500">
          <CheckCircle2 className="h-4 w-4 text-green-600" /> Stay complete. The payout moves to your earnings once settled.
        </p>
      )}
      {b.status === "awaiting_payment" && (
        <p className="mt-6 flex items-center gap-1.5 text-sm text-slate-500">
          <Clock3 className="h-4 w-4 text-amber-600" /> The guest has not finished paying. Rooms are held until {when(b.payment?.expiresAt) || "the hold ends"}.
        </p>
      )}
    </div>
  );
}
