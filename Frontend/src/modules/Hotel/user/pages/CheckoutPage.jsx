import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  CircleCheck,
  CircleX,
  Loader2,
  Lock,
  LogIn,
  ServerCrash,
  ShieldCheck,
  Tag,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { guestsSummary } from "../components/StayFields";
import { BTN, CARD, Skeleton, SmartImage, StateMessage, cx, fadeUp, stagger } from "../components/ui";
import { PaymentPendingCard, PriceBreakdown, fmtDateTime } from "../components/booking";
import { getProperty } from "../lib/api";
import { PAYMENT_MODES, createBooking, getBooking, getQuote, parseSelection, serialiseSelection } from "../lib/bookingApi";
import { describeCancellation, unitLabel } from "../lib/catalogue";
import { diffDays, fmtLong, fmtTime, nightsLabel } from "../lib/dates";
import { addressLine, formatINR } from "../lib/format";
import { usePayBooking } from "../lib/payment";
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

// A booking created from this exact checkout URL, so a refresh resumes it instead of
// creating a second one.
const resumeKey = (search) => `ksg_hotel_checkout:${search}`;
const readResume = (search) => {
  try {
    return sessionStorage.getItem(resumeKey(search)) || "";
  } catch {
    return "";
  }
};
const writeResume = (search, id) => {
  try {
    if (id) sessionStorage.setItem(resumeKey(search), id);
    else sessionStorage.removeItem(resumeKey(search));
  } catch {
    /* storage unavailable */
  }
};

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
    "w-full rounded-xl border bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 disabled:bg-slate-50 disabled:text-slate-500",
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
  useTitle("Review your booking", { noindex: true });
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const token = getUserToken();
  const stay = useMemo(() => readStay(params), [params]);
  const selection = useMemo(() => parseSelection(params.get("sel")), [params]);
  const propertyId = params.get("property") || "";
  const nights = diffDays(stay.checkIn, stay.checkOut);
  const ids = useId();
  const here = `${location.pathname}${location.search}`;

  const picks = Object.entries(selection);
  const [roomTypeId, rooms] = picks[0] || [];
  const multiple = picks.length > 1;

  // Not logged in: the shared customer login sends the visitor straight back here.
  useEffect(() => {
    if (!token) loginRedirect(navigate, here, { replace: true });
  }, [token, navigate, here]);

  const valid = Boolean(token && propertyId && roomTypeId && !multiple);
  const data = useAsync(() => getProperty(propertyId), propertyId, { enabled: valid });
  const property = data.data?.property;
  const roomType = data.data?.roomTypes?.find((rt) => String(rt._id) === String(roomTypeId));
  const backToProperty = `/hotel/p/${encodeURIComponent(property?.slug || propertyId)}?${stayQuery(stay)}&sel=${serialiseSelection(selection)}`;

  // ── Booking already created from this page (refresh / payment pending) ──
  const [created, setCreated] = useState(null); // Booking awaiting payment
  const [resuming, setResuming] = useState(() => Boolean(readResume(location.search)));
  useEffect(() => {
    const id = readResume(location.search);
    if (!id || !token) {
      setResuming(false);
      return undefined;
    }
    let alive = true;
    getBooking(id)
      .then((booking) => {
        if (!alive) return;
        if (booking?.status === "awaiting_payment") setCreated(booking);
        else if (booking && ["confirmed", "checked_in", "checked_out"].includes(booking.status)) {
          writeResume(location.search, "");
          navigate(`/hotel/booking/${booking._id}/confirmed`, { replace: true });
        } else writeResume(location.search, "");
      })
      .catch(() => writeResume(location.search, ""))
      .finally(() => alive && setResuming(false));
    return () => {
      alive = false;
    };
  }, [location.search, token, navigate]);

  // ── Form state ──
  const [guest, setGuest] = useState(() => {
    const user = getUserProfile();
    return { name: user?.name && user.name !== "null" ? String(user.name) : "", phone: cleanPhone(user?.phone), email: user?.email || "", requests: "" };
  });
  const [touched, setTouched] = useState({});
  const [mode, setMode] = useState(PAYMENT_MODES[0].key);
  const [payAtHotelOff, setPayAtHotelOff] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponError, setCouponError] = useState("");
  const [useWallet, setUseWallet] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const payment = usePayBooking();
  const errors = validate(guest);

  // ── Server quote: on load and whenever mode / coupon / wallet changes ──
  const quoteInput = useMemo(
    () =>
      valid
        ? { propertyId, roomTypeId, checkIn: stay.checkIn, checkOut: stay.checkOut, rooms, adults: stay.adults, children: stay.children }
        : null,
    [valid, propertyId, roomTypeId, rooms, stay.checkIn, stay.checkOut, stay.adults, stay.children]
  );
  const [quote, setQuote] = useState({ data: null, loading: true, error: null });
  const [quoteNonce, setQuoteNonce] = useState(0);
  const couponAttempt = useRef(false);

  useEffect(() => {
    if (!quoteInput || created) return undefined;
    let alive = true;
    setQuote((s) => ({ ...s, loading: true, error: null }));
    getQuote({ ...quoteInput, paymentMode: mode, couponCode: coupon }).then(
      (q) => {
        if (!alive) return;
        if (couponAttempt.current) setCouponError("");
        couponAttempt.current = false;
        setQuote({ data: q, loading: false, error: null });
      },
      (err) => {
        if (!alive) return;
        const wasCoupon = couponAttempt.current;
        couponAttempt.current = false;
        if (wasCoupon && coupon && err.status === 400) {
          // Bad coupon: show the server's reason and re-quote without it.
          setCouponError(err.message);
          setCoupon("");
          return;
        }
        if (mode === "pay_at_hotel" && err.status === 400) {
          // This stay can't be paid at the hotel: hide the option and quote online.
          setPayAtHotelOff(err.message || "Pay at hotel isn't available for this stay.");
          setMode("online");
          return;
        }
        setQuote((s) => ({ data: s.data, loading: false, error: err }));
      }
    );
    return () => {
      alive = false;
    };
  }, [quoteInput, mode, coupon, useWallet, quoteNonce, created]);

  const q = quote.data;
  const payNow = Number(q?.payNow) || 0;
  const walletAvailable = Math.min(Number(q?.walletApplicable) || 0, payNow);
  const walletUse = useWallet && walletAvailable > 0 ? walletAvailable : 0;
  const payOnline = Math.max(0, Math.round((payNow - walletUse) * 100) / 100);
  const soldOut = q && q.available === false;
  const policySource = q?.cancellationPolicy || property?.cancellationPolicy;
  const policy = describeCancellation(policySource);
  const modes = PAYMENT_MODES.filter((m) => !(payAtHotelOff && m.key === "pay_at_hotel"));

  const goSoldOut = useCallback(
    (message) =>
      navigate(backToProperty, {
        replace: true,
        state: { notice: message || "Sorry, those rooms just sold out for your dates. Please pick another room or change dates." },
      }),
    [navigate, backToProperty]
  );

  useEffect(() => {
    if (quote.error?.status === 409) goSoldOut(quote.error.message);
  }, [quote.error, goSoldOut]);

  const finish = (booking) => {
    writeResume(location.search, "");
    navigate(`/hotel/booking/${booking._id}/confirmed`, { replace: true });
  };

  const payPending = async (booking, order = null) => {
    const updated = await payment.pay(booking._id, order);
    if (!updated) return;
    if (updated.status === "awaiting_payment") setCreated(updated);
    else if (["confirmed", "checked_in", "checked_out"].includes(updated.status)) finish(updated);
    else {
      setCreated(updated);
    }
  };

  if (!token) {
    return (
      <StateMessage icon={LogIn} title="Log in to reserve" message="Taking you to login. You'll come right back to this booking.">
        <button type="button" onClick={() => loginRedirect(navigate, here)} className={BTN.primary}>
          Continue to login
        </button>
      </StateMessage>
    );
  }

  if (!propertyId || !roomTypeId) {
    return (
      <StateMessage icon={BedDouble} tone="saffron" title="Pick a room first" message="Choose a stay and a room, then tap Reserve.">
        <Link to="/hotel" className={BTN.primary}>
          Find a stay
        </Link>
      </StateMessage>
    );
  }

  if (multiple) {
    return (
      <StateMessage icon={BedDouble} tone="saffron" title="One room type per booking" message="Pick rooms of a single type for this booking. You can book another room type separately.">
        <Link to={`/hotel/p/${encodeURIComponent(propertyId)}?${stayQuery(stay)}`} className={BTN.primary}>
          Choose again
        </Link>
      </StateMessage>
    );
  }

  if ((data.loading && !data.data) || resuming) return <CheckoutSkeleton />;
  if (data.error) {
    return (
      <StateMessage icon={ServerCrash} tone="red" title="We couldn't prepare your booking" message={data.error.message}>
        <button type="button" onClick={data.reload} className={BTN.primary}>
          Try again
        </button>
      </StateMessage>
    );
  }

  const set = (field) => (e) => setGuest((g) => ({ ...g, [field]: field === "phone" ? cleanPhone(e.target.value) : e.target.value }));
  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }));
  const show = (field) => touched[field] && errors[field];
  const locked = Boolean(created) || submitting || payment.busy;

  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      setCouponError("Enter a coupon code.");
      return;
    }
    setCouponError("");
    couponAttempt.current = true;
    if (code === coupon) setQuoteNonce((x) => x + 1);
    else setCoupon(code);
  };
  const removeCoupon = () => {
    setCoupon("");
    setCouponInput("");
    setCouponError("");
  };

  const confirm = async (e) => {
    e.preventDefault();
    if (created) return;
    setTouched({ name: true, phone: true, email: true });
    if (Object.keys(errors).length || !q || soldOut || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError("");
    setSubmitting(true);
    try {
      const { booking, payment: order } = await createBooking(
        { ...quoteInput, paymentMode: mode, couponCode: coupon },
        {
          guestDetails: { name: guest.name.trim(), phone: guest.phone, ...(guest.email.trim() ? { email: guest.email.trim() } : {}) },
          specialRequests: guest.requests.trim() || undefined,
          useWallet: walletUse > 0,
        }
      );
      if (!booking?._id) throw new Error("We couldn't confirm the booking. Please check My stays before trying again.");
      if (!order || booking.status !== "awaiting_payment") {
        finish(booking);
        return;
      }
      writeResume(location.search, booking._id);
      setCreated(booking);
      setSubmitting(false);
      await payPending(booking, order);
    } catch (err) {
      if (err.status === 409) goSoldOut(err.message);
      else if (err.status === 401) loginRedirect(navigate, here);
      else setSubmitError(err.message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const confirmLabel = !q
    ? "Confirm booking"
    : payNow <= 0
      ? "Confirm booking"
      : payOnline <= 0
        ? `Pay ${formatINR(walletUse)} from wallet & book`
        : `Pay ${formatINR(payOnline)} & book`;
  const blocked = submitting || payment.busy || !q || quote.loading || Boolean(quote.error) || soldOut;

  const pendingBlock = created && (
    <div className="space-y-3">
      <PaymentPendingCard
        booking={created}
        onPay={() => payPending(created)}
        paying={payment.busy}
        step={payment.step}
        error={payment.error}
        verifyFailed={payment.verifyFailed}
      />
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        <Link to={`/hotel/stays/${created._id}`} className="font-semibold text-[#0B2A6F] hover:underline">
          View booking {created.bookingRef ? `#${created.bookingRef}` : ""}
        </Link>
        <Link to={backToProperty} onClick={() => writeResume(location.search, "")} className="font-semibold text-slate-500 hover:underline">
          Start over
        </Link>
      </div>
    </div>
  );

  return (
    <form onSubmit={confirm} noValidate className="pb-36 lg:pb-12">
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
        <Link to={backToProperty} className={cx(BTN.ghost, "-ml-3")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to rooms
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900">Review & reserve</h1>
        <ol className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-400" aria-label="Booking steps">
          <li className="text-[#16A34A]">1. Choose room</li>
          <li aria-hidden="true">›</li>
          <li className={created ? "text-[#16A34A]" : "text-[#0B2A6F]"} aria-current={created ? undefined : "step"}>
            2. Guest details
          </li>
          <li aria-hidden="true">›</li>
          <li className={created ? "text-[#0B2A6F]" : ""} aria-current={created ? "step" : undefined}>
            3. Pay & confirm
          </li>
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
                <dd className="mt-1 font-semibold text-slate-800">{guestsSummary({ ...stay, rooms })}</dd>
                <dd className="text-xs text-slate-500">{nightsLabel(nights)}</dd>
              </div>
            </dl>
            <p className="flex items-center gap-2 border-t border-slate-100 p-4 text-sm text-slate-700">
              <BedDouble className="h-4 w-4 text-[#FF7A00]" aria-hidden="true" />
              {rooms} × {roomType?.name || "Selected room"}{" "}
              {roomType && <span className="text-slate-400">({unitLabel(roomType.inventoryType, rooms)})</span>}
            </p>
          </motion.section>

          <fieldset disabled={locked} className="m-0 min-w-0 space-y-6 border-0 p-0">
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
                {modes.map((m) => {
                  const active = mode === m.key;
                  const showAmounts = active && q && !quote.loading && m.key !== "pay_at_hotel";
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
                          {showAmounts && <span className="text-sm font-semibold text-slate-700">{formatINR(payNow)} now</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {showAmounts && m.key === "partial_prepaid" && Number(q.payAtHotel) > 0
                            ? `${formatINR(payNow)} online now, ${formatINR(q.payAtHotel)} at the hotel.`
                            : m.hint}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {payAtHotelOff && (
                <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600" role="status">
                  Pay at hotel isn't available for this stay. {payAtHotelOff !== "Pay at hotel isn't available for this stay." && <span className="text-slate-400">({payAtHotelOff})</span>}
                </p>
              )}

              {q && walletAvailable > 0 && (
                <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-blue-50/70 p-4">
                  <span className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0B2A6F] text-white">
                      <Wallet className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-slate-900">Use KSG wallet</span>
                      <span className="block text-xs text-slate-500">Up to {formatINR(walletAvailable)} of the amount due now</span>
                    </span>
                  </span>
                  <input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} className="peer sr-only" />
                  <span
                    aria-hidden="true"
                    className={cx(
                      "relative h-6 w-11 shrink-0 rounded-full transition peer-focus-visible:ring-4 peer-focus-visible:ring-blue-200",
                      useWallet ? "bg-[#16A34A]" : "bg-slate-300"
                    )}
                  >
                    <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", useWallet ? "left-[22px]" : "left-0.5")} />
                  </span>
                </label>
              )}
            </motion.section>

            {/* Coupon */}
            <motion.section variants={fadeUp} className={cx(CARD, "p-4 sm:p-6")} aria-labelledby={`${ids}-coupon`}>
              <h2 id={`${ids}-coupon`} className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
                <Tag className="h-4 w-4 text-[#FF7A00]" aria-hidden="true" /> Coupon
              </h2>
              {coupon && q && !quote.loading ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[#16A34A] bg-green-50 p-3">
                  <span className="text-sm">
                    <b className="text-[#0F7A36]">{coupon}</b> applied
                    {Number(q.pricing?.couponDiscount) > 0 && <> — you save {formatINR(q.pricing.couponDiscount)}</>}
                  </span>
                  <button type="button" onClick={removeCoupon} className="rounded-full p-1.5 text-slate-500 hover:bg-white" aria-label="Remove coupon">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <label htmlFor={`${ids}-code`} className="sr-only">
                    Coupon code
                  </label>
                  <input
                    id={`${ids}-code`}
                    value={couponInput}
                    onChange={(e) => {
                      setCouponInput(e.target.value.toUpperCase());
                      if (couponError) setCouponError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyCoupon();
                      }
                    }}
                    maxLength={30}
                    autoCapitalize="characters"
                    aria-invalid={Boolean(couponError)}
                    aria-describedby={`${ids}-code-msg`}
                    className={cx(input(couponError), "uppercase")}
                    placeholder="Enter code"
                  />
                  <button type="button" onClick={applyCoupon} disabled={quote.loading && Boolean(coupon)} className={cx(BTN.navy, "shrink-0 px-5")}>
                    {quote.loading && coupon ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Apply"}
                  </button>
                </div>
              )}
              <p id={`${ids}-code-msg`} className={cx("mt-1.5 min-h-[16px] text-xs", couponError ? "text-rose-600" : "text-slate-400")} role={couponError ? "alert" : undefined}>
                {couponError}
              </p>
            </motion.section>
          </fieldset>

          {/* Policy */}
          <motion.section variants={fadeUp} className={cx("rounded-2xl p-4 sm:p-5", policy.free ? "bg-green-50" : "bg-rose-50")}>
            <h2 className={cx("flex items-center gap-2 text-sm font-bold", policy.free ? "text-[#0F7A36]" : "text-rose-700")}>
              {policy.free ? <CircleCheck className="h-4 w-4" aria-hidden="true" /> : <CircleX className="h-4 w-4" aria-hidden="true" />}
              {policy.title}
            </h2>
            {q?.freeCancellationUntil && (
              <p className="mt-2 text-sm font-semibold text-[#0F7A36]">Free cancellation until {fmtDateTime(q.freeCancellationUntil)}</p>
            )}
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
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Price details</h2>
              {quote.loading && q && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Updating price" />}
            </div>
            {created ? (
              <div className="mt-4">
                <PriceBreakdown pricing={created.pricing} nights={created.nights} rooms={created.rooms} roomTypeName={created.snapshot?.roomTypeName || roomType?.name} />
              </div>
            ) : quote.loading && !q ? (
              <div className="mt-4 space-y-2" aria-busy="true">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-8 w-1/2" />
              </div>
            ) : quote.error && !q ? (
              <div className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                {quote.error.message}
                <button
                  type="button"
                  onClick={() => (quote.error.status === 401 ? loginRedirect(navigate, here) : setQuoteNonce((x) => x + 1))}
                  className="mt-2 block font-semibold underline"
                >
                  {quote.error.status === 401 ? "Log in again" : "Try again"}
                </button>
              </div>
            ) : q ? (
              <div className={cx("mt-4 transition-opacity", quote.loading && "opacity-60")}>
                <PriceBreakdown pricing={q.pricing} nights={q.nights || nights} rooms={q.rooms || rooms} roomTypeName={roomType?.name} />
                <dl className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
                  {payNow > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Pay now</dt>
                      <dd className="font-semibold tabular-nums">{formatINR(payNow)}</dd>
                    </div>
                  )}
                  {walletUse > 0 && (
                    <div className="flex justify-between text-[#16A34A]">
                      <dt>· from KSG wallet</dt>
                      <dd className="font-semibold tabular-nums">− {formatINR(walletUse)}</dd>
                    </div>
                  )}
                  {walletUse > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-600">· online</dt>
                      <dd className="font-semibold tabular-nums">{formatINR(payOnline)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Pay at hotel</dt>
                    <dd className="font-semibold tabular-nums">{formatINR(Number(q.payAtHotel) || 0)}</dd>
                  </div>
                </dl>
                {quote.error && (
                  <p className="mt-3 text-xs font-medium text-rose-600" role="alert">
                    {quote.error.message}{" "}
                    <button type="button" onClick={() => setQuoteNonce((x) => x + 1)} className="font-semibold underline">
                      Retry
                    </button>
                  </p>
                )}
              </div>
            ) : null}

            {soldOut && !created && (
              <p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-700" role="alert">
                These rooms are no longer available for your dates or can't fit your party.{" "}
                <Link to={backToProperty} className="font-semibold underline">
                  Choose again
                </Link>
              </p>
            )}

            <div className="mt-5 hidden lg:block">
              {created ? (
                pendingBlock
              ) : (
                <>
                  <ConfirmButton blocked={blocked} busy={submitting || payment.busy} label={confirmLabel} online={payOnline > 0} />
                  <ConfirmNote error={submitError || payment.error} />
                </>
              )}
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Secure payments by Razorpay
            </p>
          </div>
          {created && <div className="mt-4 lg:hidden">{pendingBlock}</div>}
        </motion.aside>
      </motion.div>

      {/* Mobile confirm bar */}
      {!created && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-bold text-slate-900">{q ? formatINR(q.pricing?.total) : "—"}</div>
              <div className="truncate text-[11px] text-slate-500">
                {q ? (payNow > 0 ? `${formatINR(payNow)} now · incl. taxes` : "Pay at hotel · incl. taxes") : nightsLabel(nights)}
              </div>
            </div>
            <div className="w-[55%]">
              <ConfirmButton blocked={blocked} busy={submitting || payment.busy} label={payNow > 0 ? "Pay & book" : "Confirm"} online={payOnline > 0} compact />
            </div>
          </div>
          <ConfirmNote error={submitError || payment.error} />
        </div>
      )}
    </form>
  );
}

function ConfirmButton({ blocked, busy, label, online, compact = false }) {
  return (
    <button type="submit" disabled={Boolean(blocked)} className={cx(BTN.primary, "w-full", compact ? "py-3" : "py-3.5 text-base")}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : online ? <Lock className="h-4 w-4" aria-hidden="true" /> : <CircleCheck className="h-4 w-4" aria-hidden="true" />}
      {busy ? "Booking…" : label}
    </button>
  );
}

function ConfirmNote({ error }) {
  if (!error) return null;
  return (
    <p className="mt-2 text-center text-xs font-medium text-rose-600" role="alert">
      {error}
    </p>
  );
}
