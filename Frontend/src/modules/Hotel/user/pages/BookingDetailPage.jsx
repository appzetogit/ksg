import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  CircleCheck,
  CircleX,
  FileText,
  LogIn,
  MapPin,
  MessageSquareText,
  Phone,
  ServerCrash,
  Star,
  Users,
  XCircle,
} from "lucide-react";
import { BTN, CARD, Skeleton, SmartImage, StateMessage, cx, fadeUp, stagger } from "../components/ui";
import { PAYMENT_MODE_LABELS, PaymentPendingCard, PriceBreakdown, StatusChip, fmtDateTime, guestLine, statusLabel } from "../components/booking";
import { CancelSheet, ReviewSheet } from "../components/BookingDialogs";
import { getBooking, openVoucher } from "../lib/bookingApi";
import { describeCancellation } from "../lib/catalogue";
import { fmtLong, fmtTime, nightsLabel } from "../lib/dates";
import { addressLine, formatINR, humanize } from "../lib/format";
import { usePayBooking } from "../lib/payment";
import { getUserToken, loginRedirect } from "../lib/session";
import useAsync from "../lib/useAsync";
import useTitle from "../lib/useTitle";

const ROLE_LABELS = { USER: "You", user: "You", HOTEL_PARTNER: "Property", partner: "Property", ADMIN: "KSG support", admin: "KSG support", system: "KSG" };

function Box({ title, icon: Icon, children, className = "" }) {
  return (
    <motion.section variants={fadeUp} className={cx(CARD, "p-4 sm:p-5", className)}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
        {Icon && <Icon className="h-4 w-4 text-[#FF7A00]" aria-hidden="true" />}
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

function Timeline({ history }) {
  if (!history?.length) return <p className="text-sm text-slate-500">No updates yet.</p>;
  return (
    <ol className="relative ml-2 border-l-2 border-slate-200">
      {history.map((h, i) => {
        const last = i === history.length - 1;
        const bad = ["cancelled", "no_show", "expired"].includes(h.status);
        return (
          <li key={`${h.status}-${h.at}-${i}`} className="relative pb-5 pl-5 last:pb-0">
            <span
              className={cx(
                "absolute -left-[9px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white",
                bad ? "bg-rose-500" : last ? "bg-[#16A34A]" : "bg-[#0B2A6F]"
              )}
              aria-hidden="true"
            />
            <p className={cx("text-sm font-semibold", last ? "text-slate-900" : "text-slate-700")}>{statusLabel(h.status)}</p>
            <p className="text-xs text-slate-500">
              {fmtDateTime(h.at)}
              {h.by?.role && ` · ${ROLE_LABELS[h.by.role] || humanize(h.by.role)}`}
            </p>
            {h.note && <p className="mt-0.5 text-xs text-slate-500">{h.note}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export default function BookingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const token = getUserToken();
  const res = useAsync(() => getBooking(id), id, { enabled: Boolean(token) });
  const payment = usePayBooking();
  const [override, setOverride] = useState(null);
  const [dialog, setDialog] = useState("");
  const [flash, setFlash] = useState("");
  // Stable so the dialog doesn't re-run its focus effect on every parent render.
  const closeDialog = useCallback(() => setDialog(""), []);
  useTitle(res.data?.bookingRef ? `Booking ${res.data.bookingRef}` : "Booking", { noindex: true });

  if (!token) {
    return (
      <StateMessage icon={LogIn} title="Log in to see this booking" message="Your bookings are linked to your KSG account.">
        <button type="button" onClick={() => loginRedirect(navigate, `/hotel/stays/${id}`)} className={BTN.navy}>
          Log in
        </button>
      </StateMessage>
    );
  }

  if (res.loading && !res.data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6" aria-busy="true" aria-label="Loading booking">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (res.error || !res.data) {
    const notFound = res.error?.status === 404 || !res.error;
    return (
      <StateMessage
        icon={ServerCrash}
        tone={notFound ? "navy" : "red"}
        title={notFound ? "Booking not found" : "We couldn't load this booking"}
        message={res.error?.message || "It may belong to another account."}
      >
        {res.error?.status === 401 ? (
          <button type="button" onClick={() => loginRedirect(navigate, `/hotel/stays/${id}`)} className={BTN.navy}>
            Log in again
          </button>
        ) : (
          !notFound && (
            <button type="button" onClick={res.reload} className={BTN.primary}>
              Try again
            </button>
          )
        )}
        <Link to="/hotel/stays" className={BTN.outline}>
          My stays
        </Link>
      </StateMessage>
    );
  }

  // Apply an action's response until the re-fetch lands; fresh server data then wins.
  const b = override && override.base === res.data ? { ...res.data, ...override.patch } : res.data;
  const snap = b.snapshot || {};
  const pay = b.payment || {};
  const pending = b.status === "awaiting_payment";
  const active = ["confirmed", "checked_in", "checked_out"].includes(b.status);
  const policy = describeCancellation(snap.cancellationPolicy);
  const address = typeof snap.address === "string" ? snap.address : addressLine(snap.address || {});

  const refresh = (updated, message) => {
    if (updated) setOverride({ base: res.data, patch: updated });
    setFlash(message || "");
    res.reload();
  };

  const payNow = async () => {
    const updated = await payment.pay(b._id);
    if (updated) refresh(updated, updated.status === "confirmed" ? "Payment received — your booking is confirmed." : "");
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link to="/hotel/stays" className={cx(BTN.ghost, "-ml-3")}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My stays
      </Link>

      {flash && (
        <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-center gap-2 rounded-xl bg-green-50 p-3 text-sm font-semibold text-[#0F7A36]" role="status">
          <CircleCheck className="h-4 w-4" aria-hidden="true" /> {flash}
        </motion.p>
      )}

      <motion.div initial="hidden" animate="show" variants={stagger(0.06)} className="mt-3 space-y-4">
        {/* Header */}
        <motion.section variants={fadeUp} className={cx(CARD, "overflow-hidden")}>
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
            <SmartImage src={snap.coverImage} alt="" className="aspect-[16/9] w-full shrink-0 rounded-xl sm:aspect-auto sm:h-28 sm:w-40" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={b.status} />
                {b.bookingRef && <span className="font-mono text-xs font-semibold text-slate-500">Ref {b.bookingRef}</span>}
              </div>
              <h1 className="mt-2 text-xl font-extrabold text-slate-900">{snap.propertyName || "Your stay"}</h1>
              {address && (
                <p className="mt-1 flex items-start gap-1 text-sm text-slate-500">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {address}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {active && (
                  <button type="button" onClick={() => openVoucher(b._id)} className={BTN.navy}>
                    <FileText className="h-4 w-4" aria-hidden="true" /> View voucher
                  </button>
                )}
                {b.canReview && !b.reviewId && (
                  <button type="button" onClick={() => setDialog("review")} className={BTN.primary}>
                    <Star className="h-4 w-4" aria-hidden="true" /> Write a review
                  </button>
                )}
                {b.canCancel && (
                  <button type="button" onClick={() => setDialog("cancel")} className={cx(BTN.outline, "hover:border-rose-400 hover:text-rose-600")}>
                    <XCircle className="h-4 w-4" aria-hidden="true" /> Cancel booking
                  </button>
                )}
              </div>
              {b.reviewId && (
                <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-[#16A34A]">
                  <MessageSquareText className="h-4 w-4" aria-hidden="true" /> Thanks for reviewing this stay
                </p>
              )}
            </div>
          </div>
        </motion.section>

        {pending && (
          <motion.div variants={fadeUp}>
            <PaymentPendingCard booking={b} onPay={payNow} paying={payment.busy} step={payment.step} error={payment.error} verifyFailed={payment.verifyFailed} />
          </motion.div>
        )}

        {b.cancellation && (
          <motion.section variants={fadeUp} className="rounded-2xl bg-rose-50 p-4 text-sm sm:p-5">
            <h2 className="flex items-center gap-2 font-bold text-rose-700">
              <CircleX className="h-4 w-4" aria-hidden="true" /> Cancelled {b.cancellation.at ? `on ${fmtDateTime(b.cancellation.at)}` : ""}
            </h2>
            <p className="mt-1 text-slate-700">
              {b.cancellation.by ? `By ${ROLE_LABELS[b.cancellation.by] || humanize(b.cancellation.by)}. ` : ""}
              {b.cancellation.reason}
            </p>
            <p className="mt-1 font-semibold text-slate-800">
              Refund: {formatINR(Number(b.cancellation.refundAmount) || 0)}
            </p>
          </motion.section>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-4">
            <Box title="Stay details" icon={CalendarDays}>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-[11px] font-semibold uppercase text-slate-400">Check-in</dt>
                  <dd className="font-semibold text-slate-800">{fmtLong(b.checkIn)}</dd>
                  {snap.checkInTime && <dd className="text-xs text-slate-500">from {fmtTime(snap.checkInTime)}</dd>}
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-[11px] font-semibold uppercase text-slate-400">Check-out</dt>
                  <dd className="font-semibold text-slate-800">{fmtLong(b.checkOut)}</dd>
                  {snap.checkOutTime && <dd className="text-xs text-slate-500">by {fmtTime(snap.checkOutTime)}</dd>}
                </div>
                <div className="flex items-start gap-2 p-1">
                  <BedDouble className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <div>
                    <dt className="sr-only">Room</dt>
                    <dd className="font-semibold text-slate-800">
                      {b.rooms} × {snap.roomTypeName || "Room"}
                    </dd>
                    <dd className="text-xs text-slate-500">{nightsLabel(Number(b.nights) || 0)}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-1">
                  <Users className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <div>
                    <dt className="sr-only">Guests</dt>
                    <dd className="font-semibold text-slate-800">{guestLine(b.guests)}</dd>
                  </div>
                </div>
              </dl>
              <div className="mt-4 border-t border-slate-100 pt-4 text-sm">
                <p className="text-[11px] font-semibold uppercase text-slate-400">Primary guest</p>
                <p className="font-semibold text-slate-800">{b.guestDetails?.name}</p>
                <p className="flex items-center gap-1 text-slate-500">
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" /> +91 {b.guestDetails?.phone}
                  {b.guestDetails?.email && <span> · {b.guestDetails.email}</span>}
                </p>
                {b.specialRequests && (
                  <p className="mt-2 rounded-xl bg-slate-50 p-3 text-slate-600">
                    <b className="text-slate-700">Requests:</b> {b.specialRequests}
                  </p>
                )}
              </div>
            </Box>

            <Box title="Cancellation policy" icon={policy.free ? CircleCheck : CircleX}>
              <p className={cx("text-sm font-semibold", policy.free ? "text-[#0F7A36]" : "text-rose-700")}>{policy.title}</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {policy.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Box>

            <Box title="Booking timeline">
              <Timeline history={b.statusHistory} />
            </Box>
          </div>

          <div className="space-y-4">
            <Box title="Payment" className="lg:sticky lg:top-24">
              <PriceBreakdown pricing={b.pricing} nights={b.nights} rooms={b.rooms} roomTypeName={snap.roomTypeName} />
              <dl className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Mode</dt>
                  <dd className="font-semibold text-slate-800">{PAYMENT_MODE_LABELS[pay.mode] || humanize(pay.mode)}</dd>
                </div>
                {pay.status && (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Status</dt>
                    <dd className="font-semibold text-slate-800">{humanize(pay.status)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-600">Paid</dt>
                  <dd className="font-semibold tabular-nums text-[#16A34A]">{formatINR(Number(pay.amountPaid) || 0)}</dd>
                </div>
                {Number(pay.walletAmount) > 0 && (
                  <div className="flex justify-between text-xs">
                    <dt className="text-slate-500">· from KSG wallet</dt>
                    <dd className="tabular-nums text-slate-600">{formatINR(pay.walletAmount)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-600">{pending ? "Due now" : "Due at hotel"}</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{formatINR(Number(pay.amountDue) || 0)}</dd>
                </div>
              </dl>
            </Box>
          </div>
        </div>
      </motion.div>

      <CancelSheet
        open={dialog === "cancel"}
        booking={b}
        onClose={closeDialog}
        onCancelled={(updated) => {
          setDialog("");
          refresh(updated, "Your booking has been cancelled. Any refund is on its way.");
        }}
      />
      <ReviewSheet
        open={dialog === "review"}
        booking={b}
        onClose={closeDialog}
        onReviewed={(review) => {
          setDialog("");
          refresh({ _id: b._id, canReview: false, reviewId: review?._id || "submitted" }, "Thanks! Your review has been posted.");
        }}
      />
    </div>
  );
}
