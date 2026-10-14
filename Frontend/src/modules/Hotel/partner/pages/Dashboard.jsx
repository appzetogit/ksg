import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  CalendarCheck2,
  CalendarRange,
  CheckCircle2,
  Circle,
  Clock3,
  IndianRupee,
  LogIn,
  LogOut,
  Plus,
  Radio,
} from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { usePartner } from "../lib/PartnerContext";
import { BASE_PATH } from "../lib/constants";
import { asList, money } from "../lib/utils";
import { Card, LinkButton, PageHeader, Skeleton, cx } from "../components/ui";
import StatusBanner from "../components/StatusBanner";

const ZERO = {
  properties: { total: 0, live: 0, pending: 0 },
  todayArrivals: 0,
  todayDepartures: 0,
  upcomingBookings: 0,
  revenueThisMonth: 0,
};

function Stat({ icon: Icon, label, value, tint, note, delay = 0 }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card className="h-full p-4 md:p-5">
        <span className={cx("flex h-10 w-10 items-center justify-center rounded-xl", tint)}>
          <Icon className="h-5 w-5" />
        </span>
        <p className="mt-4 text-2xl font-bold tracking-tight text-[#071A47] md:text-3xl">{value}</p>
        <p className="mt-0.5 text-sm text-slate-500">{label}</p>
        {note && <p className="mt-1 text-[11px] font-medium text-slate-400">{note}</p>}
      </Card>
    </motion.div>
  );
}

export default function Dashboard() {
  const { partner, profileComplete } = usePartner();
  const [stats, setStats] = useState(null);
  const [properties, setProperties] = useState(null);

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

  // Before the dashboard endpoint is ready (or for a partner not yet approved) the
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
            <Stat icon={Building2} label="Properties" value={data.properties.total} tint="bg-blue-50 text-[#0B2A6F]" />
            <Stat icon={Radio} label="Live now" value={data.properties.live} tint="bg-green-50 text-[#16A34A]" delay={0.03} />
            <Stat icon={Clock3} label="Under review" value={data.properties.pending} tint="bg-amber-50 text-amber-600" delay={0.06} />
            <Stat
              icon={IndianRupee}
              label="Revenue this month"
              value={money(data.revenueThisMonth)}
              tint="bg-orange-50 text-[#E85D04]"
              delay={0.09}
            />
            <Stat icon={LogIn} label="Arrivals today" value={data.todayArrivals} tint="bg-sky-50 text-sky-600" delay={0.12} note="Bookings coming soon" />
            <Stat icon={LogOut} label="Departures today" value={data.todayDepartures} tint="bg-violet-50 text-violet-600" delay={0.15} note="Bookings coming soon" />
            <Stat
              icon={CalendarCheck2}
              label="Upcoming bookings"
              value={data.upcomingBookings}
              tint="bg-teal-50 text-teal-600"
              delay={0.18}
              note="Bookings coming soon"
            />
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
