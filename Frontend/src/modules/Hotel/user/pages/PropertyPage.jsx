import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CircleCheck,
  CircleX,
  Clock,
  ExternalLink,
  Hotel,
  MapPin,
  MessageSquareText,
  Navigation,
  ScrollText,
  ServerCrash,
  Share2,
  Star,
} from "lucide-react";
import Gallery from "../components/Gallery";
import HeartButton from "../components/HeartButton";
import PropertyReviews from "../components/PropertyReviews";
import RoomCard from "../components/RoomCard";
import { DatesField, GuestsField, guestsSummary } from "../components/StayFields";
import { BTN, CARD, RatingBadge, Skeleton, StateMessage, cx, stagger } from "../components/ui";
import { getAvailability, getCatalogue, getProperty } from "../lib/api";
import {
  SUITABILITY_LABELS,
  amenityIcon,
  amenityLabel,
  describeCancellation,
  typeLabel,
} from "../lib/catalogue";
import { estimateQuote, parseSelection, serialiseSelection } from "../lib/bookingApi";
import { diffDays, fmtDay, fmtTime, nightsLabel } from "../lib/dates";
import { addressLine, formatINR, plural, propertyImages, ratingLabel } from "../lib/format";
import { readStay, stayQuery } from "../lib/searchState";
import useAsync from "../lib/useAsync";
import useTitle from "../lib/useTitle";

function Section({ id, title, icon: Icon, children }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-slate-200/80 py-8 last:border-0">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-xl">
        {Icon && <Icon className="h-5 w-5 text-[#FF7A00]" aria-hidden="true" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6" aria-busy="true" aria-label="Loading property">
      <Skeleton className="mb-4 h-4 w-40" />
      <Skeleton className="-mx-4 aspect-[4/3] rounded-none sm:mx-0 sm:aspect-auto sm:h-[420px] sm:rounded-3xl" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-6 h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <Skeleton className="hidden h-72 lg:block" />
      </div>
    </div>
  );
}

function ReadMore({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 320;
  return (
    <div>
      <p className={cx("whitespace-pre-line text-sm leading-relaxed text-slate-600", !open && long && "line-clamp-4")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-sm font-semibold text-[#0B2A6F] hover:underline" aria-expanded={open}>
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

/** Price summary + Reserve; a card on desktop, a sticky bar on phones. */
function BookingSummary({ quote, stay, nights, availLoading, availError, onReserve, onChooseRooms, warning, variant }) {
  const units = quote?.units || 0;
  const ready = units > 0 && !warning && !availLoading && !availError;
  const label = units ? "Reserve" : "Select rooms";

  if (variant === "bar") {
    return (
      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 260, delay: 0.3 }}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {units && !availLoading ? (
              <>
                <div className="text-lg font-bold text-slate-900">{formatINR(quote.total)}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {plural(units, "room")} · {nightsLabel(nights)} · + taxes
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-slate-900">
                  {fmtDay(stay.checkIn)} – {fmtDay(stay.checkOut)}
                </div>
                <div className="truncate text-[11px] text-slate-500">{guestsSummary(stay)}</div>
              </>
            )}
          </div>
          <button type="button" onClick={units ? onReserve : onChooseRooms} disabled={units > 0 && !ready} className={cx(BTN.primary, "shrink-0 px-7")}>
            {label}
          </button>
        </div>
        {warning && (
          <p className="mt-2 text-xs font-medium text-[#E85D04]" role="alert">
            {warning}
          </p>
        )}
      </motion.div>
    );
  }

  return (
    <div className={cx(CARD, "p-5")}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-bold text-slate-900">Your stay</h2>
        <span className="text-xs text-slate-500">{nightsLabel(nights)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Check-in</dt>
          <dd className="font-semibold text-slate-800">{fmtDay(stay.checkIn)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Check-out</dt>
          <dd className="font-semibold text-slate-800">{fmtDay(stay.checkOut)}</dd>
        </div>
        <div className="col-span-2 rounded-xl bg-slate-50 p-3">
          <dt className="text-[11px] font-semibold uppercase text-slate-400">Guests</dt>
          <dd className="font-semibold text-slate-800">{guestsSummary(stay)}</dd>
        </div>
      </dl>

      <div className="mt-4 min-h-[96px] border-t border-dashed border-slate-200 pt-4">
        {availLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        ) : units ? (
          <>
            <ul className="space-y-1.5 text-sm">
              {quote.lines.map((l) => (
                <li key={l.roomTypeId} className="flex justify-between gap-3 text-slate-600">
                  <span className="truncate">
                    {l.name} × {l.qty}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatINR(l.amount)}</span>
                </li>
              ))}
              {quote.extraAdultCharges > 0 && (
                <li className="flex justify-between text-slate-600">
                  <span>Extra adults × {quote.extraAdults}</span>
                  <span className="tabular-nums">{formatINR(quote.extraAdultCharges)}</span>
                </li>
              )}
              {quote.extraChildCharges > 0 && (
                <li className="flex justify-between text-slate-600">
                  <span>Extra children × {quote.extraChildren}</span>
                  <span className="tabular-nums">{formatINR(quote.extraChildCharges)}</span>
                </li>
              )}
            </ul>
            <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-semibold text-slate-700">Total</span>
              <span className="text-2xl font-bold text-slate-900">{formatINR(quote.total)}</span>
            </div>
            <p className="mt-0.5 text-right text-[11px] text-slate-500">+ taxes and fees, calculated at payment</p>
          </>
        ) : (
          <p className="text-sm text-slate-500">{availError ? "Live prices are unavailable right now." : "Pick a room to see your total."}</p>
        )}
      </div>

      {warning && (
        <p className="mt-3 flex gap-2 rounded-xl bg-orange-50 p-3 text-xs font-medium text-[#C2410C]" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {warning}
        </p>
      )}

      <button type="button" onClick={units ? onReserve : onChooseRooms} disabled={units > 0 && !ready} className={cx(BTN.primary, "mt-4 w-full py-3.5 text-base")}>
        {label}
      </button>
      <p className="mt-2 text-center text-[11px] text-slate-400">You won't be charged yet</p>
    </div>
  );
}

export default function PropertyPage() {
  const { slugOrId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const stay = useMemo(() => readStay(params), [params]);
  const selection = useMemo(() => parseSelection(params.get("sel")), [params]);
  const nights = diffDays(stay.checkIn, stay.checkOut);
  const roomsRef = useRef(null);
  const [shared, setShared] = useState(false);
  const location = useLocation();
  // Message handed over by checkout (e.g. the rooms sold out while booking).
  const [notice, setNotice] = useState(() => location.state?.notice || "");
  useEffect(() => {
    if (location.state?.notice) {
      setNotice(location.state.notice);
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  const detail = useAsync(() => getProperty(slugOrId), slugOrId);
  const catalogue = useAsync(getCatalogue, "catalogue");
  const property = detail.data?.property;
  const roomTypes = useMemo(() => detail.data?.roomTypes || [], [detail.data]);
  const stayKey = stayQuery(stay);
  const avail = useAsync(() => getAvailability(property._id, stay), property ? `${property._id}?${stayKey}` : "none", {
    enabled: Boolean(property?._id),
  });
  useTitle(property?.name || "Stay");

  // Keep stay + selection in the URL (replace: no history spam, back button still leaves the page).
  const writeParams = useCallback(
    (nextStay, nextSel) => {
      const qs = new URLSearchParams(stayQuery(nextStay));
      const sel = serialiseSelection(nextSel);
      if (sel) qs.set("sel", sel);
      setParams(qs, { replace: true });
    },
    [setParams]
  );

  const availRows = useMemo(() => {
    const map = {};
    (avail.data?.roomTypes || []).forEach((r) => {
      map[String(r.roomTypeId)] = r;
    });
    return map;
  }, [avail.data]);

  const quote = useMemo(
    () =>
      avail.data
        ? estimateQuote({ availability: avail.data, roomTypes, selection, adults: stay.adults, children: stay.children, roomsRequested: stay.rooms })
        : null,
    [avail.data, roomTypes, selection, stay]
  );

  let warning = "";
  if (quote?.units) {
    if (quote.shortfall.adults > 0 || quote.shortfall.children > 0) {
      const party = [plural(stay.adults, "adult"), stay.children ? plural(stay.children, "child", "children") : null].filter(Boolean).join(" and ");
      warning = `These rooms can't fit ${party}. Add another room or pick a bigger one.`;
    }
  }

  if (detail.loading && !property) return <PageSkeleton />;
  if (detail.error || !property) {
    const notFound = detail.error?.status === 404 || (!detail.error && !property);
    return (
      <StateMessage
        icon={notFound ? Hotel : ServerCrash}
        tone={notFound ? "navy" : "red"}
        title={notFound ? "This stay isn't available" : "We couldn't load this stay"}
        message={notFound ? "It may have been removed or is not taking bookings right now." : detail.error?.message}
      >
        {!notFound && (
          <button type="button" onClick={detail.reload} className={BTN.primary}>
            Try again
          </button>
        )}
        <Link to={`/hotel/search?${stayKey}`} className={BTN.outline}>
          Browse other stays
        </Link>
      </StateMessage>
    );
  }

  const images = propertyImages(property);
  const [lng, lat] = property.location?.coordinates || [];
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  const policy = describeCancellation(property.cancellationPolicy);
  const suitability = SUITABILITY_LABELS[property.suitability];
  const star = Number(property.typeDetails?.starRating) || 0;
  const amenities = property.amenities || [];

  // One room type per booking: picking another type replaces the current pick.
  const setQty = (roomTypeId, qty) => writeParams(stay, qty > 0 ? { [roomTypeId]: qty } : {});
  const setStay = (patch) => writeParams({ ...stay, ...patch }, selection);
  const chooseRooms = () => roomsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const reserve = () => {
    const qs = new URLSearchParams(stayQuery(stay));
    qs.set("property", property._id);
    qs.set("sel", serialiseSelection(selection));
    navigate(`/hotel/checkout?${qs.toString()}`);
  };
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: property.name, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      /* user cancelled */
    }
  };

  const summaryProps = {
    quote,
    stay,
    nights,
    availLoading: avail.loading,
    availError: avail.error,
    onReserve: reserve,
    onChooseRooms: chooseRooms,
    warning,
  };

  return (
    <div className="pb-28 lg:pb-0">
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(`/hotel/search?${stayKey}`))} className={cx(BTN.ghost, "-ml-3")}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
          </button>
          <div className="flex items-center gap-1">
            <HeartButton propertyId={property._id} name={property.name} variant="ghost" />
            <button type="button" onClick={share} className={BTN.ghost} aria-label="Share this stay">
              <Share2 className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">{shared ? "Link copied" : "Share"}</span>
            </button>
          </div>
        </div>

        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex items-start justify-between gap-3 rounded-2xl bg-orange-50 p-4 text-sm font-medium text-[#C2410C] ring-1 ring-orange-200"
            role="alert"
          >
            <span className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {notice}
            </span>
            <button type="button" onClick={() => setNotice("")} className="shrink-0 font-semibold underline">
              Dismiss
            </button>
          </motion.div>
        )}

        <Gallery images={images} title={property.name} />

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            {/* Title block */}
            <motion.header initial="hidden" animate="show" variants={stagger(0.06)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#0B2A6F]/5 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#0B2A6F]">
                  {typeLabel(property.propertyType)}
                </span>
                {star > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[#FBBF24]" aria-label={`${star} star property`}>
                    {Array.from({ length: Math.min(5, star) }, (_, i) => (
                      <Star key={i} className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    ))}
                  </span>
                )}
                {suitability && <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-[#16A34A]">{suitability}</span>}
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#1E3A8A]">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> KSG verified
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">{property.name}</h1>
              <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-500">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {addressLine(property.address)}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <RatingBadge rating={property.avgRating} reviews={property.totalReviews} size="lg" />
                {Number(property.totalReviews) > 0 && <span className="text-sm font-semibold text-slate-700">{ratingLabel(property.avgRating)}</span>}
              </div>
            </motion.header>

            {/* Quick facts */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
                <Clock className="h-5 w-5 text-[#FF7A00]" aria-hidden="true" />
                <div className="mt-2 text-[11px] font-semibold uppercase text-slate-400">Check-in</div>
                <div className="text-sm font-bold text-slate-800">{fmtTime(property.checkInTime) || "—"}</div>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
                <CalendarClock className="h-5 w-5 text-[#FF7A00]" aria-hidden="true" />
                <div className="mt-2 text-[11px] font-semibold uppercase text-slate-400">Check-out</div>
                <div className="text-sm font-bold text-slate-800">{fmtTime(property.checkOutTime) || "—"}</div>
              </div>
              <div className="col-span-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 sm:col-span-1">
                {policy.free ? <CircleCheck className="h-5 w-5 text-[#16A34A]" aria-hidden="true" /> : <CircleX className="h-5 w-5 text-rose-500" aria-hidden="true" />}
                <div className="mt-2 text-[11px] font-semibold uppercase text-slate-400">Cancellation</div>
                <div className={cx("text-sm font-bold", policy.free ? "text-[#16A34A]" : "text-rose-600")}>{policy.summary}</div>
              </div>
            </div>

            {(property.description || property.shortDescription) && (
              <Section id="about" title="About this stay">
                <ReadMore text={property.description || property.shortDescription} />
              </Section>
            )}

            {amenities.length > 0 && (
              <Section id="amenities" title="Amenities">
                <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  {amenities.map((key) => {
                    const Icon = amenityIcon(key);
                    return (
                      <li key={key} className="flex items-center gap-3 text-sm text-slate-700">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#FF7A00]">
                          <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                        </span>
                        {amenityLabel(key, catalogue.data)}
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            {/* Rooms */}
            <section id="rooms" ref={roomsRef} className="scroll-mt-20 border-b border-slate-200/80 py-8">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Choose your room</h2>
                {avail.data && !avail.loading && (
                  <span className="text-xs text-slate-500">
                    Prices for {nightsLabel(nights)}, before taxes · one room type per booking
                  </span>
                )}
              </div>
              <div className="mb-5 grid gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm sm:grid-cols-2">
                <DatesField checkIn={stay.checkIn} checkOut={stay.checkOut} onChange={setStay} />
                <GuestsField adults={stay.adults} children={stay.children} rooms={stay.rooms} onChange={setStay} align="right" className="sm:border-l sm:border-slate-100" />
              </div>

              {avail.error && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700" role="alert">
                  <span>{avail.error.message}</span>
                  <button type="button" onClick={avail.reload} className="font-semibold underline">
                    Try again
                  </button>
                </div>
              )}

              {roomTypes.length === 0 ? (
                <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">This property hasn't listed rooms yet.</p>
              ) : (
                <motion.div initial="hidden" animate="show" variants={stagger(0.08)} className="space-y-4">
                  {roomTypes.map((rt) => (
                    <RoomCard
                      key={rt._id}
                      rt={rt}
                      row={availRows[String(rt._id)]}
                      loading={avail.loading}
                      error={Boolean(avail.error)}
                      qty={selection[String(rt._id)] || 0}
                      onQty={(q) => setQty(String(rt._id), q)}
                      stay={stay}
                      nights={nights}
                      catalogue={catalogue.data}
                    />
                  ))}
                </motion.div>
              )}
            </section>

            <Section id="policies" title="Policies" icon={ScrollText}>
              <div className="space-y-5">
                <div className={cx("rounded-2xl p-4", policy.free ? "bg-green-50" : "bg-rose-50")}>
                  <h3 className={cx("text-sm font-bold", policy.free ? "text-[#0F7A36]" : "text-rose-700")}>{policy.title}</h3>
                  <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                    {policy.points.map((pt) => (
                      <li key={pt} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <p className="text-slate-600">
                    <b className="text-slate-800">Check-in from</b> {fmtTime(property.checkInTime) || "as per property"}
                  </p>
                  <p className="text-slate-600">
                    <b className="text-slate-800">Check-out by</b> {fmtTime(property.checkOutTime) || "as per property"}
                  </p>
                </div>
                {property.houseRules?.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-bold text-slate-800">House rules</h3>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {property.houseRules.map((rule) => (
                        <li key={rule} className="flex gap-2 text-sm text-slate-600">
                          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" aria-hidden="true" />
                          {rule}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-slate-400">A valid government photo ID is required for every adult at check-in.</p>
              </div>
            </Section>

            <Section id="location" title="Location" icon={MapPin}>
              <p className="mb-4 text-sm text-slate-600">{addressLine(property.address)}</p>
              {hasCoords && (
                <>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                    <iframe
                      title={`Map showing ${property.name}`}
                      src={`https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`}
                      className="block aspect-[16/9] w-full"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noopener noreferrer" className={BTN.outline}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Google Maps
                    </a>
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`} target="_blank" rel="noopener noreferrer" className={BTN.outline}>
                      <Navigation className="h-4 w-4" aria-hidden="true" /> Directions
                    </a>
                  </div>
                </>
              )}
              {property.nearbyPlaces?.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-bold text-slate-800">What's nearby</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {property.nearbyPlaces.map((pl) => (
                      <li key={`${pl.name}-${pl.type}`} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200/70">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-700">{pl.name}</span>
                          {pl.type && <span className="block text-[11px] capitalize text-slate-400">{String(pl.type).replace(/_/g, " ")}</span>}
                        </span>
                        {Number.isFinite(Number(pl.distanceKm)) && <span className="shrink-0 text-xs font-semibold text-slate-500">{Number(pl.distanceKm)} km</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            <Section id="reviews" title="Guest reviews" icon={MessageSquareText}>
              <PropertyReviews propertyId={property._id} />
            </Section>
          </div>

          {/* Desktop summary */}
          <aside className="hidden lg:block" aria-label="Booking summary">
            <div className="sticky top-24">
              <BookingSummary {...summaryProps} />
            </div>
          </aside>
        </div>
      </div>

      <BookingSummary {...summaryProps} variant="bar" />
    </div>
  );
}
