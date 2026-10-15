import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Circle,
  IndianRupee,
  LogIn,
  LogOut,
  Percent,
  Plus,
  Radio,
} from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { usePartner } from "../lib/PartnerContext";
import { BASE_PATH } from "../lib/constants";
import { asList, money, todayYmd } from "../lib/utils";
import { ymdOf } from "../lib/bookings";
import { Card, LinkButton, PageHeader, SectionTitle, Skeleton, cx } from "../components/ui";
import { BookingCard, PaymentBadge } from "../components/bookings";
import StatusBanner from "../components/StatusBanner";

const ZERO = {
  properties: { total: 0, live: 0, pending: 0 },
  todayArrivals: 0,
  todayDepartures: 0,
  upcomingBookings: 0,
  revenueThisMonth: 0,
  occupancyThisMonth: 0,
  recentBookings: [],
};

function Stat({ icon: Icon, label, value, tint, note, delay = 0, to }) {
  const card = (
    <Card className={cx("h-full p-4 md:p-5", to && "transition group-hover:border-slate-300 group-hover:shadow-md")}>
      <span className={cx("flex h-10 w-10 items-center justify-center rounded-xl", tint)}>
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 text-2xl font-bold tracking-tight text-[#071A47] md:text-3xl">{value}</p>
      <p className="mt-0.5 text-sm text-slate-500">{label}</p>
      {note && <p className="mt-1 text-[11px] font-medium text-slate-400">{note}</p>}
    </Card>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      {to ? (
        <Link to={to} className="group block h-full focus:outline-none">
          {card}
        </Link>
      ) : (
        card
      )}
    </motion.div>
  );
}

const pct = (v) => `${Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 100)}%`;

function QuickList({ title, icon: Icon, items, empty, to }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Icon className="h-4 w-4 text-[#FF7A00]" /> {title}
          {items && <span className="text-sm font-normal text-slate-400">({items.length})</span>}
        </h2>
        <Link to={to} className="text-sm font-medium text-[#0B2A6F] hover:underline">
          View all
        </Link>
      </div>
      {!items ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 5).map((b) => (
            <li key={b._id}>
              <Link to={`${BASE_PATH}/bookings/${b._id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{b.guestDetails?.name || "Guest"}</p>
                  <p className="truncate text-xs text-slate-500">
                    {b.rooms || 1} × {b.snapshot?.roomTypeName || "Room"}
                    {b.snapshot?.propertyName ? ` · ${b.snapshot.propertyName}` : ""}
                  </p>
                </div>
                <PaymentBadge booking={b} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { partner, profileComplete, isApproved } = usePartner();
  const [stats, setStats] = useState(null);
  const [properties, setProperties] = useState(null);
  const [today, setToday] = useState({ arrivals: null, departures: null });

  useEffect(() => {
    let alive = true;
    partnerApi
      .get("/partner/dashboard")
      .then((d) => alive && setStats({ ...ZERO, ...(d || {}), properties: { ...ZERO.properties, ...(d?.properties || {}) } }))
      .catch(() => alive && setStats(null));
    partnerApi
      .get("/partner/properties")
      .then((d) => alive && setProperties(asList(d, "properties")))
      .catch(() => alive && setProperties([]));
    return () => {
      alive = false;
    };
  }, []);

  // Today's arrivals and departures, for approved partners (bookings need approval).
  useEffect(() => {
    if (!isApproved) return undefined;
    let alive = true;
    const day = todayYmd();
    Promise.all([
      partnerApi.get("/partner/bookings", { status: "confirmed", from: day, to: day, limit: 50 }),
      partnerApi.get("/partner/bookings", { status: "checked_in", limit: 100 }),
    ])
      .then(([arr, dep]) => {
        if (!alive) return;
        setToday({
          arrivals: asList(arr).filter((b) => ymdOf(b.checkIn) === day),
          departures: asList(dep).filter((b) => ymdOf(b.checkOut) <= day),
        });
      })
      .catch(() => alive && setToday({ arrivals: [], departures: [] }));
    return () => {
      alive = false;
    };
  }, [isApproved]);

  // Before the dashboard endpoint answers (or for a partner not yet approved) the
  // property counts come from the list, booking numbers stay at zero.
  const list = properties || [];
  const data =
    stats ||
    (properties
      ? {
          ...ZERO,
          properties: {
            total: list.length,
            live: list.filter((p) => p.isLive).length,
            pending: list.filter((p) => p.status === "pending").length,
          },
        }
      : null);

  const steps = [
    { done: profileComplete, label: "Complete your profile & KYC", to: `${BASE_PATH}/profile` },
    { done: list.length > 0, label: "Add your first property", to: `${BASE_PATH}/properties/new` },
    {
      done: list.some((p) => ["pending", "approved"].includes(p.status)),
      label: "Submit a property for review",
      to: `${BASE_PATH}/properties`,
    },
    { done: partner?.status === "approved", label: "Get verified by KSG" },
    { done: list.some((p) => p.isLive), label: "Go live and take bookings", to: `${BASE_PATH}/properties` },
  ];
  const allDone = steps.every((s) => s.done);
  const firstName = (partner?.name || "").split(" ")[0];
  const recent = asList(data?.recentBookings);
  const bookingsTo = (tab) => `${BASE_PATH}/bookings${tab ? `?tab=${tab}` : ""}`;

  return (
    <div>
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : "Welcome to KSG Stays"}
        subtitle="Here is how your properties are doing today."
        action={
          <LinkButton to={`${BASE_PATH}/properties/new`} icon={Plus}>
            Add property
          </LinkButton>
        }
      />

      <div className="mb-6">
        <StatusBanner partner={partner} incomplete={!profileComplete} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {!data ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36" />)
        ) : (
          <>
            <Stat icon={LogIn} label="Arrivals today" value={data.todayArrivals} tint="bg-sky-50 text-sky-600" to={bookingsTo("today")} />
            <Stat
              icon={LogOut}
              label="Departures today"
              value={data.todayDepartures}
              tint="bg-violet-50 text-violet-600"
              delay={0.03}
              to={bookingsTo("today")}
            />
            <Stat
              icon={CalendarCheck2}
              label="Upcoming bookings"
              value={data.upcomingBookings}
              tint="bg-teal-50 text-teal-600"
              delay={0.06}
              to={bookingsTo("upcoming")}
            />
            <Stat
              icon={IndianRupee}
              label="Revenue this month"
              value={money(data.revenueThisMonth)}
              tint="bg-orange-50 text-[#E85D04]"
              delay={0.09}
              to={`${BASE_PATH}/earnings`}
            />
            <Stat
              icon={Percent}
              label="Occupancy this month"
              value={pct(data.occupancyThisMonth)}
              tint="bg-green-50 text-[#16A34A]"
              delay={0.12}
              note="Room-nights sold of available"
            />
            <Stat
              icon={Building2}
              label="Properties"
              value={data.properties.total}
              tint="bg-blue-50 text-[#0B2A6F]"
              delay={0.15}
              note={data.properties.pending ? `${data.properties.pending} under review` : undefined}
              to={`${BASE_PATH}/properties`}
            />
            <Stat icon={Radio} label="Live now" value={data.properties.live} tint="bg-green-50 text-[#16A34A]" delay={0.18} />
            <Link to={`${BASE_PATH}/inventory`} className="group">
              <Card className="flex h-full flex-col justify-between bg-gradient-to-br from-[#0B2A6F] to-[#071A47] p-4 text-white md:p-5">
                <CalendarRange className="h-6 w-6 text-[#FF9A3D]" />
                <div>
                  <p className="mt-4 font-semibold">Inventory calendar</p>
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-blue-100/80">
                    Prices &amp; availability <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </p>
                </div>
              </Card>
            </Link>
          </>
        )}
      </div>

      {isApproved && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <QuickList
            title="Arriving today"
            icon={LogIn}
            items={today.arrivals}
            empty="No arrivals today."
            to={bookingsTo("today")}
          />
          <QuickList
            title="Leaving today"
            icon={LogOut}
            items={today.departures}
            empty="No departures today."
            to={bookingsTo("today")}
          />
        </div>
      )}

      {recent.length > 0 && (
        <section className="mt-6">
          <SectionTitle
            title="Recent bookings"
            action={
              <Link to={bookingsTo("upcoming")} className="inline-flex items-center gap-1 text-sm font-medium text-[#0B2A6F] hover:underline">
                <CalendarDays className="h-4 w-4" /> All bookings
              </Link>
            }
          />
          <div className="grid gap-3 md:grid-cols-2">
            {recent.slice(0, 6).map((b) => (
              <BookingCard key={b._id} booking={b} />
            ))}
          </div>
        </section>
      )}

      {!allDone && properties && (
        <Card className="mt-6 p-5 md:p-6">
          <h2 className="text-base font-semibold text-slate-900">Getting started</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {steps.filter((s) => s.done).length} of {steps.length} done
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#FF7A00] to-[#16A34A]"
              initial={{ width: 0 }}
              animate={{ width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
          <ul className="mt-4 divide-y divide-slate-100">
            {steps.map((s) => {
              const content = (
                <>
                  {s.done ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-[#16A34A]" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-slate-300" />
                  )}
                  <span className={cx("flex-1 text-sm", s.done ? "text-slate-400 line-through" : "text-slate-800")}>
                    {s.label}
                  </span>
                  {!s.done && s.to && <ArrowRight className="h-4 w-4 text-slate-400" />}
                </>
              );
              return (
                <li key={s.label}>
                  {!s.done && s.to ? (
                    <Link to={s.to} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-slate-50">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-3">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
