import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck, ChevronLeft, ChevronRight, Clock, Luggage, Search, ServerCrash } from "lucide-react";
import { BTN, Skeleton, SmartImage, StateMessage, cx, fadeUp, stagger } from "../components/ui";
import { StatusChip, guestLine } from "../components/booking";
import { BOOKING_TABS, listBookings } from "../lib/bookingApi";
import { fmtDay, nightsLabel } from "../lib/dates";
import { formatINR } from "../lib/format";
import { getUserToken, loginRedirect } from "../lib/session";
import useAsync from "../lib/useAsync";
import useTitle from "../lib/useTitle";

const LIMIT = 10;

const EMPTY = {
  upcoming: { title: "No upcoming trips", message: "Find a place you'll love and it will show up here with your voucher and check-in details." },
  ongoing: { title: "You're not checked in anywhere", message: "Stays you're currently on will appear here." },
  past: { title: "No past stays yet", message: "Completed stays appear here, so you can rebook or leave a review." },
  cancelled: { title: "No cancelled bookings", message: "Bookings you or the property cancel will be listed here with refund details." },
};

function StayCard({ booking: b }) {
  const snap = b.snapshot || {};
  const pending = b.status === "awaiting_payment";
  return (
    <motion.li variants={fadeUp}>
      <Link
        to={`/hotel/stays/${b._id}`}
        className="group flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 sm:p-4"
      >
        <SmartImage src={snap.coverImage} alt="" className="h-24 w-24 shrink-0 rounded-xl sm:h-28 sm:w-36" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            <h2 className="line-clamp-1 text-sm font-bold text-slate-900 group-hover:text-[#0B2A6F] sm:text-base">{snap.propertyName || "Stay"}</h2>
            <StatusChip status={b.status} className="shrink-0" />
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {b.rooms} × {snap.roomTypeName || "Room"} · {guestLine(b.guests)}
          </p>
          <p className="mt-1.5 text-sm font-semibold text-slate-700">
            {fmtDay(b.checkIn)} → {fmtDay(b.checkOut)} <span className="font-normal text-slate-400">· {nightsLabel(Number(b.nights) || 0)}</span>
          </p>
          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            <span className="text-[11px] text-slate-400">{b.bookingRef ? `Ref ${b.bookingRef}` : ""}</span>
            <span className="text-right">
              <span className="block text-sm font-bold text-slate-900">{formatINR(Number(b.pricing?.total) || 0)}</span>
              {pending && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                  <Clock className="h-3 w-3" aria-hidden="true" /> Pay to confirm
                </span>
              )}
            </span>
          </div>
        </div>
        <ChevronRight className="hidden h-5 w-5 shrink-0 self-center text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#0B2A6F] sm:block" aria-hidden="true" />
      </Link>
    </motion.li>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-3" aria-busy="true" aria-label="Loading stays">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-4">
          <Skeleton className="h-24 w-24 rounded-xl sm:w-36" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function StaysPage() {
  useTitle("My stays");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const token = getUserToken();
  const tab = BOOKING_TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "upcoming";
  const page = Math.max(1, parseInt(params.get("page"), 10) || 1);
  const res = useAsync(() => listBookings({ tab, page, limit: LIMIT }), `${tab}:${page}`, { enabled: Boolean(token) });
  const data = res.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / (data.limit || LIMIT))) : 1;

  const go = (next) => {
    const qs = new URLSearchParams();
    if (next.tab !== "upcoming") qs.set("tab", next.tab);
    if (next.page > 1) qs.set("page", String(next.page));
    setParams(qs, { replace: next.tab === tab });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!token) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-extrabold text-slate-900">My stays</h1>
        <div className="mt-6 rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <StateMessage icon={CalendarCheck} title="Log in to see your stays" message="Your bookings are linked to your KSG account.">
            <button type="button" onClick={() => loginRedirect(navigate, "/hotel/stays")} className={BTN.navy}>
              Log in
            </button>
            <Link to="/hotel" className={BTN.outline}>
              Explore stays
            </Link>
          </StateMessage>
        </div>
      </div>
    );
  }

  const empty = EMPTY[tab];
  const showingStale = res.loading && data;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold text-slate-900">My stays</h1>
      <p className="mt-1 text-sm text-slate-500">Your hotel bookings, vouchers and cancellations in one place.</p>

      <div className="mt-6 flex gap-1 overflow-x-auto rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200/70" role="tablist" aria-label="Booking status">
        {BOOKING_TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => !active && go({ tab: t.key, page: 1 })}
              className={cx(
                "relative flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition",
                active ? "text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              )}
            >
              {active && <motion.span layoutId="stays-tab" className="absolute inset-0 rounded-xl bg-[#0B2A6F]" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
              <span className="relative">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4" role="tabpanel" aria-busy={res.loading}>
        {res.loading && !data ? (
          <ListSkeleton />
        ) : res.error ? (
          <div className="rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/70">
            <StateMessage icon={ServerCrash} tone="red" title="We couldn't load your stays" message={res.error.message}>
              {res.error.status === 401 ? (
                <button type="button" onClick={() => loginRedirect(navigate, `/hotel/stays${window.location.search}`)} className={BTN.navy}>
                  Log in again
                </button>
              ) : (
                <button type="button" onClick={res.reload} className={BTN.primary}>
                  Try again
                </button>
              )}
            </StateMessage>
          </div>
        ) : data && data.items.length === 0 ? (
          <div className="rounded-3xl bg-white shadow-sm ring-1 ring-slate-200/70">
            <StateMessage icon={Luggage} tone="saffron" title={empty.title} message={empty.message}>
              <Link to="/hotel" className={BTN.primary}>
                <Search className="h-4 w-4" aria-hidden="true" /> Explore stays
              </Link>
            </StateMessage>
          </div>
        ) : data ? (
          <AnimatePresence mode="wait">
            <motion.ul
              key={`${tab}:${page}`}
              initial="hidden"
              animate="show"
              variants={stagger(0.05)}
              className={cx("space-y-3 transition-opacity", showingStale && "opacity-60")}
            >
              {data.items.map((b) => (
                <StayCard key={b._id} booking={b} />
              ))}
            </motion.ul>
          </AnimatePresence>
        ) : null}

        {data && pages > 1 && !res.error && (
          <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pages">
            <button type="button" onClick={() => go({ tab, page: page - 1 })} disabled={page <= 1 || res.loading} className={BTN.outline}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
            </button>
            <span className="text-sm text-slate-500">
              Page {page} of {pages}
            </span>
            <button type="button" onClick={() => go({ tab, page: page + 1 })} disabled={page >= pages || res.loading} className={BTN.outline}>
              Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
