import { Clock, CreditCard, Loader2, RefreshCw, TimerOff } from "lucide-react";
import { BTN, cx } from "./ui";
import { formatINR, humanize, plural } from "../lib/format";
import { nightsLabel } from "../lib/dates";
import { fmtCountdown, useCountdown } from "../lib/payment";

// Shared pieces for checkout, confirmation, my stays and booking detail.

export const STATUS_META = {
  awaiting_payment: { label: "Payment pending", cls: "bg-amber-100 text-amber-800" },
  confirmed: { label: "Confirmed", cls: "bg-green-100 text-[#0F7A36]" },
  checked_in: { label: "Checked in", cls: "bg-blue-100 text-[#0B2A6F]" },
  checked_out: { label: "Completed", cls: "bg-slate-100 text-slate-700" },
  cancelled: { label: "Cancelled", cls: "bg-rose-100 text-rose-700" },
  no_show: { label: "No-show", cls: "bg-rose-100 text-rose-700" },
  expired: { label: "Expired", cls: "bg-slate-100 text-slate-500" },
};

export const statusLabel = (status) => STATUS_META[status]?.label || humanize(status);

export function StatusChip({ status, className = "" }) {
  const meta = STATUS_META[status] || { label: humanize(status), cls: "bg-slate-100 text-slate-600" };
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide", meta.cls, className)}>{meta.label}</span>;
}

export const PAYMENT_MODE_LABELS = {
  pay_at_hotel: "Pay at hotel",
  online: "Paid online",
  partial_prepaid: "Advance online, rest at hotel",
};

export const fmtDateTime = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
};

const n = (v) => Number(v) || 0;

function Row({ label, sub, value, tone }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="text-slate-600">
        {label}
        {sub && <span className="block text-xs text-slate-400">{sub}</span>}
      </span>
      <span className={cx("shrink-0 tabular-nums", tone === "green" ? "font-semibold text-[#16A34A]" : "text-slate-800")}>{value}</span>
    </li>
  );
}

/** Line items of a Quote.pricing / Booking.pricing, ending with the total. */
export function PriceBreakdown({ pricing, nights, rooms, roomTypeName, totalLabel = "Total" }) {
  if (!pricing) return null;
  const fee = n(pricing.platformFee) + n(pricing.platformFeeGst);
  return (
    <>
      <ul className="space-y-2 text-sm">
        <Row
          label="Room charges"
          sub={[roomTypeName && rooms ? `${rooms} × ${roomTypeName}` : roomTypeName, nights ? nightsLabel(nights) : null].filter(Boolean).join(" · ")}
          value={formatINR(n(pricing.roomCharges))}
        />
        {n(pricing.extraGuestCharges) > 0 && <Row label="Extra guests" value={formatINR(pricing.extraGuestCharges)} />}
        {n(pricing.couponDiscount) > 0 && (
          <Row label={`Coupon${pricing.couponCode ? ` (${pricing.couponCode})` : ""}`} value={`− ${formatINR(pricing.couponDiscount)}`} tone="green" />
        )}
        {n(pricing.prepaidDiscount) > 0 && <Row label="Prepaid discount" value={`− ${formatINR(pricing.prepaidDiscount)}`} tone="green" />}
        <Row label={`GST (${n(pricing.gstRate)}%)`} sub={n(pricing.gstRate) === 0 ? "No GST on this tariff" : undefined} value={formatINR(n(pricing.gstAmount))} />
        {fee > 0 && (
          <Row
            label="Platform fee"
            sub={n(pricing.platformFeeGst) > 0 ? `${formatINR(pricing.platformFee)} + ${formatINR(pricing.platformFeeGst)} GST` : undefined}
            value={formatINR(fee)}
          />
        )}
      </ul>
      <div className="mt-4 flex items-baseline justify-between border-t border-slate-200 pt-4">
        <span className="font-semibold text-slate-800">{totalLabel}</span>
        <span className="text-2xl font-extrabold text-slate-900 tabular-nums">{formatINR(n(pricing.total))}</span>
      </div>
    </>
  );
}

/** "Payment pending — pay within N min" with a Pay / Retry button. */
export function PaymentPendingCard({ booking, onPay, paying, step, error, verifyFailed, compact = false }) {
  const left = useCountdown(booking?.payment?.expiresAt);
  const expired = left === 0;
  const due = n(booking?.payment?.amountDue) || n(booking?.pricing?.total);

  if (expired) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm" role="status">
        <p className="flex items-center gap-2 font-bold text-slate-800">
          <TimerOff className="h-4 w-4 text-slate-500" aria-hidden="true" /> The room hold has ended
        </p>
        <p className="mt-1 text-slate-600">This booking was not paid in time, so the rooms were released. You can book again if they're still free.</p>
      </div>
    );
  }

  return (
    <div className={cx("rounded-2xl border border-amber-200 bg-amber-50 text-sm", compact ? "p-3" : "p-4")} role="status" aria-live="polite">
      <p className="flex items-center gap-2 font-bold text-amber-900">
        <Clock className="h-4 w-4" aria-hidden="true" /> Payment pending
      </p>
      <p className="mt-1 text-amber-900/80">
        {left !== null ? (
          <>
            Your rooms are held for <b className="tabular-nums">{fmtCountdown(left)}</b> min. Pay {formatINR(due)} to confirm.
          </>
        ) : (
          <>Pay {formatINR(due)} to confirm your booking before the hold ends.</>
        )}
      </p>
      {error && (
        <p className="mt-2 rounded-lg bg-white/70 p-2 text-xs font-medium text-rose-700" role="alert">
          {verifyFailed ? `${error} If money was debited, your booking will update shortly — refresh to check.` : error}
        </p>
      )}
      <button type="button" onClick={onPay} disabled={paying} className={cx(BTN.primary, "mt-3 w-full")}>
        {paying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : error ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <CreditCard className="h-4 w-4" aria-hidden="true" />}
        {paying ? (step === "verifying" ? "Confirming payment…" : "Opening payment…") : error ? "Retry payment" : `Pay ${formatINR(due)} now`}
      </button>
    </div>
  );
}

export const guestLine = (guests = {}, rooms) =>
  [rooms ? plural(Number(rooms), "room") : null, plural(n(guests.adults), "adult"), n(guests.children) ? plural(n(guests.children), "child", "children") : null]
    .filter(Boolean)
    .join(" · ");
