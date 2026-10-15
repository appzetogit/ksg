import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { BedDouble, CalendarDays, Check, FileText, Luggage, LogIn, MapPin, ServerCrash, Users } from "lucide-react";
import { BTN, CARD, Skeleton, SmartImage, StateMessage, cx } from "../components/ui";
import { PAYMENT_MODE_LABELS, PaymentPendingCard, StatusChip, fmtDateTime, guestLine } from "../components/booking";
import { getBooking, openVoucher } from "../lib/bookingApi";
import { fmtLong, fmtTime, nightsLabel } from "../lib/dates";
import { addressLine, formatINR } from "../lib/format";
import { usePayBooking } from "../lib/payment";
import { getUserToken, loginRedirect } from "../lib/session";
import useAsync from "../lib/useAsync";
import useTitle from "../lib/useTitle";

function SuccessBadge() {
  return (
    <div className="relative mx-auto h-24 w-24">
      <motion.span
        className="absolute inset-0 rounded-full bg-[#16A34A]/20"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: [0.6, 1.5], opacity: [0.6, 0] }}
        transition={{ duration: 1.4, repeat: 2, ease: "easeOut" }}
        aria-hidden="true"
      />
      <motion.span
        className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-[#16A34A] to-[#0F7A36] shadow-xl shadow-green-600/30"
        initial={{ scale: 0, rotate: -45 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
      >
        <motion.svg viewBox="0 0 24 24" className="h-12 w-12 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.35, duration: 0.5 }} />
        </motion.svg>
      </motion.span>
      {[...Array(8)].map((_, i) => (
        <motion.span
          key={i}
          className={cx("absolute left-1/2 top-1/2 h-2 w-2 rounded-full", i % 2 ? "bg-[#FF7A00]" : "bg-[#0B2A6F]")}
          initial={{ x: 0, y: 0, opacity: 0 }}
          animate={{ x: Math.cos((i / 8) * Math.PI * 2) * 70, y: Math.sin((i / 8) * Math.PI * 2) * 70, opacity: [0, 1, 0] }}
          transition={{ delay: 0.4, duration: 0.9, ease: "easeOut" }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export default function ConfirmationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = getUserToken();
  const res = useAsync(() => getBooking(id), id, { enabled: Boolean(token) });
  const payment = usePayBooking();
  useTitle("Booking confirmed", { noindex: true });

  if (!token) {
    return (
      <StateMessage icon={LogIn} title="Log in to see this booking" message="Your bookings are linked to your KSG account.">
        <button type="button" onClick={() => loginRedirect(navigate, `/hotel/booking/${id}/confirmed`)} className={BTN.navy}>
          Log in
        </button>
      </StateMessage>
    );
  }

  if (res.loading && !res.data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10" aria-busy="true" aria-label="Loading booking">
        <Skeleton className="mx-auto h-24 w-24 rounded-full" />
        <Skeleton className="mx-auto h-6 w-2/3" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (res.error || !res.data) {
    return (
      <StateMessage icon={ServerCrash} tone="red" title="We couldn't load your booking" message={res.error?.message || "Booking not found."}>
        <button type="button" onClick={res.reload} className={BTN.primary}>
          Try again
        </button>
        <Link to="/hotel/stays" className={BTN.outline}>
          My stays
        </Link>
      </StateMessage>
    );
  }

  const b = res.data;
  const snap = b.snapshot || {};
  const pay = b.payment || {};
  const confirmed = ["confirmed", "checked_in", "checked_out"].includes(b.status);
  const pending = b.status === "awaiting_payment";

  const payNow = async () => {
    const updated = await payment.pay(b._id);
    if (updated) res.reload();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="text-center">
        {confirmed ? (
          <SuccessBadge />
        ) : (
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-[#FF7A00] to-[#E85D04] shadow-xl">
            <Luggage className="h-9 w-9 text-white" aria-hidden="true" />
          </div>
        )}
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-6 text-2xl font-extrabold text-slate-900 sm:text-3xl">
          {confirmed ? "Your stay is booked!" : pending ? "Almost there" : "Booking update"}
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }} className="mt-2 text-sm text-slate-500">
          {confirmed
            ? `We've sent the details to ${b.guestDetails?.phone ? `+91 ${b.guestDetails.phone}` : "your phone"}${b.guestDetails?.email ? ` and ${b.guestDetails.email}` : ""}.`
            : pending
              ? "Complete the payment to confirm your rooms."
              : "This booking is not active."}
        </motion.p>
        {b.bookingRef && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.75 }} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#0B2A6F]/5 px-4 py-2">
            <span className="text-xs font-semibold uppercase text-slate-500">Booking ref</span>
            <span className="font-mono text-base font-bold tracking-wider text-[#0B2A6F]">{b.bookingRef}</span>
          </motion.div>
        )}
      </div>

      <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85 }} className={cx(CARD, "mt-8 overflow-hidden")}>
        <div className="flex gap-4 p-4 sm:p-5">
          <SmartImage src={snap.coverImage} alt="" className="h-20 w-24 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900">{snap.propertyName || "Your stay"}</h2>
              <StatusChip status={b.status} />
            </div>
            {snap.address && (
              <p className="mt-1 flex items-start gap-1 text-xs text-slate-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {typeof snap.address === "string" ? snap.address : addressLine(snap.address)}
              </p>
            )}
          </div>
        </div>
        <dl className="grid gap-px border-t border-slate-100 bg-slate-100 text-sm sm:grid-cols-2">
          <div className="bg-white p-4">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Check-in
            </dt>
            <dd className="mt-1 font-semibold text-slate-800">{fmtLong(b.checkIn)}</dd>
            {snap.checkInTime && <dd className="text-xs text-slate-500">from {fmtTime(snap.checkInTime)}</dd>}
          </div>
          <div className="bg-white p-4">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Check-out
            </dt>
            <dd className="mt-1 font-semibold text-slate-800">{fmtLong(b.checkOut)}</dd>
            {snap.checkOutTime && <dd className="text-xs text-slate-500">by {fmtTime(snap.checkOutTime)}</dd>}
          </div>
          <div className="bg-white p-4">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
              <BedDouble className="h-3.5 w-3.5" aria-hidden="true" /> Room
            </dt>
            <dd className="mt-1 font-semibold text-slate-800">
              {b.rooms} × {snap.roomTypeName || "Room"}
            </dd>
            <dd className="text-xs text-slate-500">{nightsLabel(Number(b.nights) || 0)}</dd>
          </div>
          <div className="bg-white p-4">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Guests
            </dt>
            <dd className="mt-1 font-semibold text-slate-800">{guestLine(b.guests)}</dd>
            <dd className="text-xs text-slate-500">{b.guestDetails?.name}</dd>
          </div>
        </dl>
        <div className="border-t border-slate-100 p-4 sm:p-5">
          <h3 className="text-sm font-bold text-slate-900">Payment</h3>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Total</dt>
              <dd className="font-bold tabular-nums text-slate-900">{formatINR(Number(b.pricing?.total) || 0)}</dd>
            </div>
            {Number(pay.amountPaid) > 0 && (
              <div className="flex justify-between">
                <dt className="flex items-center gap-1 text-slate-600">
                  <Check className="h-3.5 w-3.5 text-[#16A34A]" aria-hidden="true" /> Paid
                  {Number(pay.walletAmount) > 0 && <span className="text-xs text-slate-400">(incl. {formatINR(pay.walletAmount)} wallet)</span>}
                </dt>
                <dd className="font-semibold tabular-nums text-[#16A34A]">{formatINR(pay.amountPaid)}</dd>
              </div>
            )}
            {Number(pay.amountDue) > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-600">{pending ? "Due now" : "Pay at hotel"}</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{formatINR(pay.amountDue)}</dd>
              </div>
            )}
            {pay.mode && <p className="pt-1 text-xs text-slate-400">{PAYMENT_MODE_LABELS[pay.mode] || pay.mode}</p>}
          </dl>
        </div>
        {confirmed && b.canCancel && (
          <p className="border-t border-slate-100 bg-green-50 px-5 py-3 text-xs font-medium text-[#0F7A36]">You can cancel this booking from My stays.</p>
        )}
      </motion.section>

      {pending && (
        <div className="mt-6">
          <PaymentPendingCard booking={b} onPay={payNow} paying={payment.busy} step={payment.step} error={payment.error} verifyFailed={payment.verifyFailed} />
        </div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-6 flex flex-col gap-3 sm:flex-row">
        {confirmed && (
          <button type="button" onClick={() => openVoucher(b._id)} className={cx(BTN.primary, "flex-1")}>
            <FileText className="h-4 w-4" aria-hidden="true" /> View voucher
          </button>
        )}
        <Link to={`/hotel/stays/${b._id}`} className={cx(BTN.outline, "flex-1 py-3")}>
          Booking details
        </Link>
        <Link to="/hotel/stays" className={cx(BTN.navy, "flex-1")}>
          <Luggage className="h-4 w-4" aria-hidden="true" /> My stays
        </Link>
      </motion.div>
      {b.createdAt && <p className="mt-6 text-center text-[11px] text-slate-400">Booked on {fmtDateTime(b.createdAt)}</p>}
    </div>
  );
}
