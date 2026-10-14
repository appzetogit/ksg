import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BadgeCheck, MapPin, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import SearchBox from "../components/SearchBox";
import { MiniCard, MiniCardSkeleton } from "../components/PropertyCard";
import { Skeleton, cx, fadeUp, stagger } from "../components/ui";
import { getCatalogue, getCities, searchProperties } from "../lib/api";
import { catalogueTypes, typeIcon } from "../lib/catalogue";
import { readSearch, stayQuery, toQuery } from "../lib/searchState";
import { plural } from "../lib/format";
import useAsync from "../lib/useAsync";
import useTitle from "../lib/useTitle";

const CITY_GRADIENTS = [
  "from-[#0B2A6F] to-[#1E3A8A]",
  "from-[#FF7A00] to-[#E85D04]",
  "from-[#16A34A] to-[#0F7A36]",
  "from-[#7C3AED] to-[#4338CA]",
  "from-[#0EA5E9] to-[#0369A1]",
  "from-[#DB2777] to-[#9D174D]",
];

const TRUST = [
  { icon: BadgeCheck, title: "Verified stays", text: "Every property is checked by our team before it goes live." },
  { icon: Wallet, title: "Pay your way", text: "Pay at the hotel, pay now, or reserve with a 30% advance." },
  { icon: ShieldCheck, title: "Clear policies", text: "Cancellation rules in plain words, before you book." },
];

/** Whether location access was already granted, so we never prompt on page load. */
const geoGranted = async () => {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    return status?.state === "granted";
  } catch {
    return false;
  }
};

const currentPosition = () =>
  new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(5)), lng: Number(p.coords.longitude.toFixed(5)) }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 600000 }
    );
  });

function Section({ title, subtitle, action, children }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function HomePage() {
  useTitle("Book hotels, resorts & homestays");
  const navigate = useNavigate();
  const defaults = useMemo(() => readSearch(new URLSearchParams()), []);
  const stayQs = stayQuery(defaults);
  const go = (patch) => navigate(`/hotel/search?${toQuery({ ...defaults, ...patch })}`);

  const catalogue = useAsync(getCatalogue, "catalogue");
  const cities = useAsync(getCities, "cities");
  const [near, setNear] = useState(null); // { lat, lng } once known

  useEffect(() => {
    let alive = true;
    geoGranted().then(async (ok) => {
      if (!ok || !navigator.geolocation) return;
      const pos = await currentPosition();
      if (alive && pos) setNear(pos);
    });
    return () => {
      alive = false;
    };
  }, []);

  const featured = useAsync(
    () =>
      near
        ? searchProperties({ ...defaults, ...near, sort: "distance" }, { limit: 10, radiusKm: 30 })
        : searchProperties({ ...defaults, sort: "rating" }, { limit: 10 }),
    near ? `near:${near.lat},${near.lng}` : "featured"
  );

  const types = catalogueTypes(catalogue.data);
  const cityList = (cities.data || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 8);
  const featuredItems = featured.data?.items || [];

  return (
    <div>
      {/* Hero */}
      <section className="relative z-10 bg-[#071A47] text-white">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0B2A6F] via-[#071A47] to-[#071A47]" />
          <div className="ksg-hotel-blob absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[#FF7A00]/25 blur-3xl" />
          <div className="ksg-hotel-blob absolute -right-20 top-10 h-96 w-96 rounded-full bg-[#16A34A]/20 blur-3xl [animation-delay:-6s]" />
          <svg className="absolute inset-0 h-full w-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="ksg-dots" width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.4" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#ksg-dots)" />
          </svg>
        </div>

        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-16">
          <motion.div initial="hidden" animate="show" variants={stagger(0.08)} className="max-w-2xl">
            <motion.span
              variants={fadeUp}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-orange-200"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Verified stays across India
            </motion.span>
            <motion.h1 variants={fadeUp} className="mt-4 text-3xl font-extrabold leading-tight sm:text-5xl">
              Find your perfect <span className="bg-gradient-to-r from-[#FF7A00] to-[#FBBF24] bg-clip-text text-transparent">stay</span>
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-3 text-sm text-white/70 sm:text-base">
              Hotels, resorts, villas, homestays and hostels at honest prices. Pay at the hotel or online.
            </motion.p>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }} className="mt-8">
            <SearchBox initial={defaults} onSearch={go} />
          </motion.div>

          {/* Property-type chips */}
          <div className="mt-6 min-h-[40px]">
            {types.length > 0 && (
              <motion.ul
                initial="hidden"
                animate="show"
                variants={stagger(0.04)}
                className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
                aria-label="Browse by property type"
              >
                {types.map((t) => {
                  const Icon = typeIcon(t.key);
                  return (
                    <motion.li key={t.key} variants={fadeUp}>
                      <button
                        type="button"
                        onClick={() => go({ types: [t.key] })}
                        className="flex items-center gap-2 whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:border-[#FF7A00] hover:bg-[#FF7A00]"
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {t.label}
                      </button>
                    </motion.li>
                  );
                })}
              </motion.ul>
            )}
          </div>
        </div>
      </section>

      {/* Stays near you / featured */}
      <Section
        title={near ? "Stays near you" : "Top-rated stays"}
        subtitle={near ? "Closest verified stays for tonight" : "Loved by guests, ready for tonight"}
        action={
          <button
            type="button"
            onClick={() => go(near ? { ...near, place: "Near me", sort: "distance" } : { sort: "rating" })}
            className="hidden items-center gap-1 text-sm font-semibold text-[#0B2A6F] hover:text-[#FF7A00] sm:inline-flex"
          >
            View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      >
        {featured.error && !featuredItems.length ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow-sm" role="alert">
            {featured.error.message}{" "}
            <button type="button" onClick={featured.reload} className="font-semibold text-[#0B2A6F] underline">
              Try again
            </button>
          </p>
        ) : featured.loading && !featuredItems.length ? (
          <div className="-mx-4 flex gap-4 overflow-hidden px-4 sm:mx-0 sm:px-0">
            {Array.from({ length: 4 }, (_, i) => (
              <MiniCardSkeleton key={i} />
            ))}
          </div>
        ) : featuredItems.length ? (
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            variants={stagger(0.07)}
            className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-3 [scrollbar-width:thin] sm:mx-0 sm:px-0"
          >
            {featuredItems.map((p) => (
              <MiniCard key={p._id} property={p} stayQs={stayQs} />
            ))}
          </motion.div>
        ) : (
          <p className="rounded-xl bg-white p-5 text-sm text-slate-500 shadow-sm">
            New stays are being added every week. Search a city above to see what's available.
          </p>
        )}
      </Section>

      {/* Popular cities */}
      <Section title="Popular cities" subtitle="Where guests are heading">
        {cities.loading && !cities.data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : cities.error ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow-sm" role="alert">
            {cities.error.message}{" "}
            <button type="button" onClick={cities.reload} className="font-semibold text-[#0B2A6F] underline">
              Try again
            </button>
          </p>
        ) : cityList.length ? (
          <motion.ul
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-40px" }}
            variants={stagger(0.05)}
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {cityList.map((c, i) => (
              <motion.li key={c.city} variants={fadeUp}>
                <button
                  type="button"
                  onClick={() => go({ city: c.city })}
                  className={cx(
                    "group relative flex h-28 w-full flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-left text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-xl sm:h-32",
                    CITY_GRADIENTS[i % CITY_GRADIENTS.length]
                  )}
                >
                  <span className="absolute -right-3 -top-6 text-[88px] font-black leading-none text-white/10 transition group-hover:scale-110" aria-hidden="true">
                    {c.city[0]}
                  </span>
                  <MapPin className="mb-auto h-5 w-5 text-white/80" aria-hidden="true" />
                  <span className="text-base font-bold">{c.city}</span>
                  <span className="text-xs text-white/75">{plural(c.count || 0, "stay")}</span>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        ) : (
          <p className="rounded-xl bg-white p-5 text-sm text-slate-500 shadow-sm">Cities will appear here as properties go live.</p>
        )}
      </Section>

      {/* Trust strip */}
      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6">
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={stagger(0.08)}
          className="grid gap-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70 sm:grid-cols-3 sm:p-8"
        >
          {TRUST.map(({ icon: Icon, title, text }) => (
            <motion.li key={title} variants={fadeUp} className="flex gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF7A00]">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-bold text-slate-900">{title}</span>
                <span className="mt-0.5 block text-sm text-slate-500">{text}</span>
              </span>
            </motion.li>
          ))}
        </motion.ul>
      </section>
    </div>
  );
}
