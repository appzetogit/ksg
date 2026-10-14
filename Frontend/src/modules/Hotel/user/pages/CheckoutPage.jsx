import { useEffect, useId, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  CircleCheck,
  CircleX,
  Hotel,
  Info,
  Lock,
  LogIn,
  ServerCrash,
  ShieldCheck,
  Users,
} from "lucide-react";
import { guestsSummary } from "../components/StayFields";
import { BTN, CARD, Skeleton, SmartImage, StateMessage, cx, fadeUp, stagger } from "../components/ui";
import { getAvailability, getProperty } from "../lib/api";
import {
  BOOKING_ENABLED,
  PAYMENT_MODES,
  advanceSplit,
  createBooking,
  getQuote,
  parseSelection,
  serialiseSelection,
} from "../lib/bookingApi";
import { describeCancellation, unitLabel } from "../lib/catalogue";
import { diffDays, fmtLong, fmtTime, nightsLabel } from "../lib/dates";
import { addressLine, formatINR, plural } from "../lib/format";
import { readStay, stayQuery } from "../lib/searchState";
import { getUserProfile, getUserToken, loginRedirect } from "../lib/session";
import useAsync from "../lib/useAsync";
import useTitle from "../lib/useTitle";

const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const validate = (g) => {
  const errors = {};
  if (!g.name.trim() || g.name.trim().length < 2) errors.name = "Enter the guest's full name.";
  if (!PHONE_RE.test(g.phone)) errors.phone = "Enter a valid 10-digit mobile number.";
  if (g.email && !EMAIL_RE.test(g.email.trim())) errors.email = "Enter a valid email address, or leave it empty.";
  return errors;
};

const cleanPhone = (raw) => String(raw || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "").slice(0, 10);

function Field({ label, error, hint, children, id }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      {children}
      <p id={`${id}-msg`} className={cx("mt-1 min-h-[16px] text-xs", error ? "text-rose-600" : "text-slate-400")} role={error ? "alert" : undefined}>
        {error || hint || ""}
      </p>
    </div>
  );
}

const input = (bad) =>
  cx(
    "w-full rounded-xl border bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4",
    bad ? "border-rose-400 focus:ring-rose-100" : "border-slate-300 focus:border-[#0B2A6F] focus:ring-blue-100"
  );

function CheckoutSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_380px]" aria-busy="true" aria-label="Loading checkout">
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}

export default function CheckoutPage() {
  useTitle("Review your booking");
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const token = getUserToken();
  const stay = useMemo(() => readStay(params), [params]);
  const selection = useMemo(() => parseSelection(params.get("sel")), [params]);
  const propertyId = params.get("property") || "";
  const nights = diffDays(stay.checkIn, stay.checkOut);
  const ids = useId();

  // Not logged in: the shared customer login sends the visitor straight back here.
  useEffect(() => {
    if (!token) loginRedirect(navigate, `${location.pathname}${location.search}`, { replace: true });
  }, [token, navigate, location.pathname, location.search]);

  const valid = Boolean(token && propertyId && Object.keys(selection).length);
  const key = `${propertyId}?${stayQuery(stay)}`;
  const data = useAsync(
    async () => {
      const [detail, availability] = await Promise.all([getProperty(propertyId), getAvailability(propertyId, stay)]);
      return { ...detail, availability };
    },
    key,
    { enabled: valid }
  );

  const quote = useAsync(
    () =>
      getQuote({
        availability: data.data.availability,
        roomTypes: data.data.roomTypes,
        selection,
        adults: stay.adults,
        children: stay.children,
        roomsRequested: stay.rooms,
      }),
    `${key}|${serialiseSelection(selection)}|${data.data ? "ready" : "wait"}`,
    { enabled: Boolean(data.data) }
  );

  const [guest, setGuest] = useState(() => {
    const user = getUserProfile();
    return { name: user?.name && user.name !== "null" ? String(user.name) : "", phone: cleanPhone(user?.phone), email: user?.email || "", requests: "" };
  });
  const [touched, setTouched] = useState({});
  const [mode, setMode] = useState(PAYMENT_MODES[0].key);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const errors = validate(guest);

  if (!token) {
    return (
      <StateMessage icon={LogIn} title="Log in to reserve" message="Taking you to login. You'll come right back to this booking.">
        <button type="button" onClick={() => loginRedirect(navigate, `${location.pathname}${location.search}`)} className={BTN.primary}>
          Continue to login
        </button>
      </StateMessage>
    );
  }

  if (!valid) {
    return (
      <StateMessage icon={BedDouble} tone="saffron" title="Pick a room first" message="Choose a stay and at least one room, then tap Reserve.">
        <Link to="/hotel" className={BTN.primary}>
          Find a stay
        </Link>
      </StateMessage>
    );
  }

  if (data.loading && !data.data) return <CheckoutSkeleton />;
  if (data.error) {
    return (
      <StateMessage icon={ServerCrash} tone="red" title="We couldn't prepare your booking" message={data.error.message}>
        <button type="button" onClick={data.reload} className={BTN.primary}>
          Try again
        </button>
      </StateMessage>
    );
  }

  const { property } = data.data;
  const q = quote.data;
  const backToProperty = `/hotel/p/${encodeURIComponent(property?.slug || propertyId)}?${stayQuery(stay)}&sel=${serialiseSelection(selection)}`;
  const policy = describeCancellation(property?.cancellationPolicy);
  const split = q ? advanceSplit(q.total, mode) : null;
  const shortfall = q && (q.shortfall.adults > 0 || q.shortfall.children > 0);
  const soldOut = q && q.units === 0;

  const set = (field) => (e) => setGuest((g) => ({ ...g, [field]: field === "phone" ? cleanPhone(e.target.value) : e.target.value }));
  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }));
  const show = (field) => touched[field] && errors[field];

  const confirm = async (e) => {
    e.preventDefault();
    setTouched({ name: true, phone: true, email: true });
    if (Object.keys(errors).length) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      // TODO(booking phase): see bookingApi.createBooking.
      await createBooking({
        propertyId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        adults: stay.adults,
        children: stay.children,
        rooms: Object.entries(selection).map(([roomTypeId, quantity]) => ({ roomTypeId, quantity })),
        guest: { name: guest.name.trim(), phone: guest.phone, email: guest.email.trim() || undefined },
        specialRequests: guest.requests.trim() || undefined,
        paymentMode: mode,
      });
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={confirm} noValidate className="pb-32 lg:pb-12">
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
        <Link to={backToProperty} className={cx(BTN.ghost, "-ml-3")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to rooms
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">Review & reserve</h1>
        <ol className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-400" aria-label="Booking steps">
          <li className="text-[#16A34A]">1. Choose room</li>
          <li aria-hidden="true">›</li>
          <li className="text-[#0B2A6F]" aria-current="step">
            2. Guest details
          </li>
          <li aria-hidden="true">›</li>
          <li>3. Confirm</li>
        </ol>
      </div>

      <motion.div initial="hidden" animate="show" variants={stagger(0.08)} className="mx-auto mt-5 grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          {/* Stay summary */}
          <motion.section variants={fadeUp} className={cx(CARD, "overflow-hidden")} aria-label="Your stay">
            <div className="flex gap-4 p-4 sm:p-5">
              <SmartImage src={property?.coverImage} alt="" className="h-20 w-24 shrink-0 rounded-xl sm:h-24 sm:w-32" />
              <div className="min-w-0">
                <h2 className="line-clamp-2 text-base font-bold text-slate-900">{property?.name}</h2>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{addressLine(property?.address || {})}</p>
              </div>
            </div>
            <dl className="grid gap-px border-t border-slate-100 bg-slate-100 text-sm sm:grid-cols-3">
              <div className="bg-white p-4">
                <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Check-in
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">{fmtLong(stay.checkIn)}</dd>
                {property?.checkInTime && <dd className="text-xs text-slate-500">from {fmtTime(property.checkInTime)}</dd>}
              </div>
              <div className="bg-white p-4">
                <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Check-out
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">{fmtLong(stay.checkOut)}</dd>
                {property?.checkOutTime && <dd className="text-xs text-slate-500">by {fmtTime(property.checkOutTime)}</dd>}
              </div>
              <div className="bg-white p-4">
                <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" /> Guests
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">{guestsSummary({ ...stay, rooms: q?.units || stay.rooms })}</dd>
                <dd className="text-xs text-slate-500">{nightsLabel(nights)}</dd>
              </div>
            </dl>
            {q?.lines?.length > 0 && (
              <ul className="space-y-1 border-t border-slate-100 p-4 text-sm text-slate-700">
                {q.lines.map((l) => (
                  <li key={l.roomTypeId} className="flex items-center gap-2">
                    <BedDouble className="h-4 w-4 text-[#FF7A00]" aria-hidden="true" />
                    {l.qty} × {l.name} <span className="text-slate-400">({unitLabel(l.inventoryType, l.qty)})</span>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>

          {/* Guest details */}
          <motion.section variants={fadeUp} className={cx(CARD, "p-4 sm:p-6")} aria-labelledby={`${ids}-guest`}>
            <h2 id={`${ids}-guest`} className="text-base font-bold text-slate-900">
              Guest details
            </h2>
            <p className="mb-4 text-xs text-slate-500">The booking will be in this name. Carry a matching photo ID.</p>
            <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field id={`${ids}-name`} label="Full name" error={show("name")}>
                  <input
                    id={`${ids}-name`}
                    type="text"
                    autoComplete="name"
                    value={guest.name}
                    onChange={set("name")}
                    onBlur={blur("name")}
                    aria-invalid={Boolean(show("name"))}
                    aria-describedby={`${ids}-name-msg`}
                    className={input(show("name"))}
                    placeholder="As on your ID"
                  />
                </Field>
              </div>
              <Field id={`${ids}-phone`} label="Mobile number" error={show("phone")} hint="Booking updates are sent here">
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">+91</span>
                  <input
                    id={`${ids}-phone`}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    value={guest.phone}
                    onChange={set("phone")}
                    onBlur={blur("phone")}
                    aria-invalid={Boolean(show("phone"))}
                    aria-describedby={`${ids}-phone-msg`}
                    className={cx(input(show("phone")), "pl-12")}
                    placeholder="98765 43210"
                  />
                </div>
              </Field>
              <Field id={`${ids}-email`} label="Email (optional)" error={show("email")} hint="For your booking voucher">
                <input
                  id={`${ids}-email`}
                  type="email"
                  autoComplete="email"
                  value={guest.email}
                  onChange={set("email")}
                  onBlur={blur("email")}
                  aria-invalid={Boolean(show("email"))}
                  aria-describedby={`${ids}-email-msg`}
                  className={input(show("email"))}
                  placeholder="you@example.com"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field id={`${ids}-req`} label="Special requests (optional)" hint="Subject to availability at the property">
                  <textarea
                    id={`${ids}-req`}
                    rows={3}
                    maxLength={500}
                    value={guest.requests}
                    onChange={set("requests")}
                    aria-describedby={`${ids}-req-msg`}
                    className={cx(input(false), "resize-none")}
                    placeholder="Early check-in, ground-floor room, extra pillows…"
                  />
                </Field>
              </div>
            </div>
          </motion.section>

          {/* Payment mode */}
          <motion.section variants={fadeUp} className={cx(CARD, "p-4 sm:p-6")} aria-labelledby={`${ids}-pay`}>
            <h2 id={`${ids}-pay`} className="mb-4 text-base font-bold text-slate-900">
              How would you like to pay?
            </h2>
            <div className="grid gap-3" role="radiogroup" aria-labelledby={`${ids}-pay`}>
              {PAYMENT_MODES.map((m) => {
                const active = mode === m.key;
                const amount = q ? advanceSplit(q.total, m.key) : null;
                return (
                  <label
                    key={m.key}
                    className={cx(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 transition",
                      active ? "border-[#FF7A00] bg-orange-50/60" : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <input type="radio" name="paymentMode" value={m.key} checked={active} onChange={() => setMode(m.key)} className="peer sr-only" />
                    <span
                      className={cx(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 peer-focus-visible:ring-4 peer-focus-visible:ring-orange-200",
                        active ? "border-[#FF7A00]" : "border-slate-300"
                      )}
                      aria-hidden="true"
                    >
                      {active && <span className="h-2.5 w-2.5 rounded-full bg-[#FF7A00]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900">{m.label}</span>
                        {amount && m.advancePercent > 0 && <span className="text-sm font-semibold text-slate-700">{formatINR(amount.payNow)} now</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">{m.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </motion.section>

          {/* Policy */}
          <motion.section variants={fadeUp} className={cx("rounded-2xl p-4 sm:p-5", policy.free ? "bg-green-50" : "bg-rose-50")}>
            <h2 className={cx("flex items-center gap-2 text-sm font-bold", policy.free ? "text-[#0F7A36]" : "text-rose-700")}>
              {policy.free ? <CircleCheck className="h-4 w-4" aria-hidden="true" /> : <CircleX className="h-4 w-4" aria-hidden="true" />}
              {policy.title}
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {policy.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </motion.section>
        </div>

        {/* Price breakdown */}
        <motion.aside variants={fadeUp} aria-label="Price details" className="lg:sticky lg:top-24 lg:self-start">
          <div className={cx(CARD, "p-5")}>
            <h2 className="text-base font-bold text-slate-900">Price details</h2>
            {quote.loading && !q ? (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-8 w-1/2" />
              </div>
            ) : quote.error ? (
              <p className="mt-3 text-sm text-rose-600" role="alert">
                {quote.error.message}
              </p>
            ) : q ? (
              <>
                <ul className="mt-4 space-y-2 text-sm">
                  {q.lines.map((l) => (
                    <li key={l.roomTypeId} className="flex justify-between gap-3 text-slate-600">
                      <span>
                        {l.name}
                        <span className="block text-xs text-slate-400">
                          {formatINR(l.unitPrice)} × {plural(l.qty, unitLabel(l.inventoryType, 1), unitLabel(l.inventoryType, 2))} · {nightsLabel(q.nights)}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-800">{formatINR(l.amount)}</span>
                    </li>
                  ))}
                  {q.extraAdultCharges > 0 && (
                    <li className="flex justify-between text-slate-600">
                      <span>Extra adults ({q.extraAdults})</span>
                      <span className="tabular-nums text-slate-800">{formatINR(q.extraAdultCharges)}</span>
                    </li>
                  )}
                  {q.extraChildCharges > 0 && (
                    <li className="flex justify-between text-slate-600">
                      <span>Extra children ({q.extraChildren})</span>
                      <span className="tabular-nums text-slate-800">{formatINR(q.extraChildCharges)}</span>
                    </li>
                  )}
                </ul>
                <div className="mt-4 flex items-baseline justify-between border-t border-slate-200 pt-4">
                  <span className="font-semibold text-slate-800">Total</span>
                  <span className="text-2xl font-extrabold text-slate-900">{formatINR(q.total)}</span>
                </div>
                <p className="mt-2 flex gap-1.5 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Taxes and fees are calculated at payment.
                </p>
                {split && split.payNow > 0 && split.payAtHotel > 0 && (
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Pay now (30%)</dt>
                      <dd className="font-semibold tabular-nums">{formatINR(split.payNow)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Pay at hotel</dt>
                      <dd className="font-semibold tabular-nums">{formatINR(split.payAtHotel)}</dd>
                    </div>
                  </dl>
                )}
              </>
            ) : null}

            {soldOut && (
              <p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-700" role="alert">
                The rooms you picked are no longer available for these dates.{" "}
                <Link to={backToProperty} className="font-semibold underline">
                  Choose again
                </Link>
              </p>
            )}
            {shortfall && !soldOut && (
              <p className="mt-4 rounded-xl bg-orange-50 p-3 text-xs font-medium text-[#C2410C]" role="alert">
                These rooms can't fit all your guests.{" "}
                <Link to={backToProperty} className="font-semibold underline">
                  Add a room
                </Link>
              </p>
            )}

            <div className="mt-5 hidden lg:block">
              <ConfirmButton blocked={submitting || !q || soldOut || shortfall} noteId={`${ids}-note-d`} />
              <ConfirmNote error={submitError} id={`${ids}-note-d`} />
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Secure booking with KSG
            </p>
          </div>
        </motion.aside>
      </motion.div>

      {/* Mobile confirm bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-slate-900">{q ? formatINR(q.total) : "—"}</div>
            <div className="text-[11px] text-slate-500">+ taxes · {nightsLabel(nights)}</div>
          </div>
          <div className="w-1/2">
            <ConfirmButton blocked={submitting || !q || soldOut || shortfall} noteId={`${ids}-note-m`} compact />
          </div>
        </div>
        <ConfirmNote error={submitError} id={`${ids}-note-m`} />
      </div>
    </form>
  );
}

function ConfirmButton({ blocked, noteId, compact = false }) {
  return (
    <button
      type="submit"
      disabled={!BOOKING_ENABLED || Boolean(blocked)}
      aria-describedby={noteId}
      className={cx(BTN.primary, "w-full", compact ? "py-3" : "py-3.5 text-base")}
    >
      {BOOKING_ENABLED ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Hotel className="h-4 w-4" aria-hidden="true" />}
      Confirm booking
    </button>
  );
}

function ConfirmNote({ error, id }) {
  if (error) {
    return (
      <p id={id} className="mt-2 text-center text-xs font-medium text-rose-600" role="alert">
        {error}
      </p>
    );
  }
  if (BOOKING_ENABLED) return null;
  return (
    <p id={id} className="mt-2 text-center text-xs font-semibold text-[#E85D04]">
      Booking opens soon. We're putting the finishing touches on payments.
    </p>
  );
}
