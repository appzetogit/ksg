import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, LogIn, LogOut, RefreshCw, Search, X } from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { asList, todayYmd } from "../lib/utils";
import { BOOKING_TABS, ymdOf } from "../lib/bookings";
import { BookingCard, BookingCardSkeletons, Pager } from "../components/bookings";
import { Button, Chip, EmptyState, InlineError, PageHeader, SectionTitle, cx } from "../components/ui";

const LIMIT = 20;
const DEFAULTS = { tab: "today", propertyId: "", from: "", to: "", q: "", sub: "cancelled", page: "1" };

const pageOf = (data) => ({
  items: asList(data),
  page: Number(data?.page) || 1,
  limit: Number(data?.limit) || LIMIT,
  total: Number(data?.total) || asList(data).length,
});

/** Filters live in the URL so the list survives a trip to a booking and back. */
function useFilters() {
  const [search, setSearch] = useSearchParams();
  const filters = useMemo(() => {
    const out = { ...DEFAULTS };
    Object.keys(DEFAULTS).forEach((k) => {
      const v = search.get(k);
      if (v !== null) out[k] = v;
    });
    return out;
  }, [search]);
  const update = useCallback(
    (patch) => {
      const next = { ...filters, ...patch };
      if (!("page" in patch)) next.page = "1";
      const qs = new URLSearchParams();
      Object.entries(next).forEach(([k, v]) => {
        if (v !== "" && v != null && String(v) !== DEFAULTS[k]) qs.set(k, String(v));
      });
      setSearch(qs, { replace: true });
    },
    [filters, setSearch],
  );
  return [filters, update];
}

const inputCls =
  "h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0B2A6F] focus:outline-none focus:ring-4 focus:ring-blue-100";

export default function Bookings() {
  const [f, update] = useFilters();
  const [properties, setProperties] = useState([]);
  const [state, setState] = useState({ loading: true, error: "", list: null, arrivals: null, departures: null });
  const [text, setText] = useState(f.q);
  const seq = useRef(0);
  const today = todayYmd();

  useEffect(() => {
    partnerApi
      .get("/partner/properties")
      .then((d) => setProperties(asList(d, "properties")))
      .catch(() => setProperties([]));
  }, []);

  // Debounced search box → URL.
  useEffect(() => setText(f.q), [f.q]);
  useEffect(() => {
    if (text.trim() === f.q) return undefined;
    const t = setTimeout(() => update({ q: text.trim() }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    const base = { propertyId: f.propertyId || undefined, q: f.q || undefined };
    try {
      if (f.tab === "today") {
        const [arr, dep] = await Promise.all([
          partnerApi.get("/partner/bookings", { ...base, status: "confirmed", from: today, to: today, limit: 100 }),
          partnerApi.get("/partner/bookings", { ...base, status: "checked_in", limit: 100 }),
        ]);
        if (id !== seq.current) return;
        setState({
          loading: false,
          error: "",
          list: null,
          arrivals: asList(arr).filter((b) => ymdOf(b.checkIn) === today),
          departures: asList(dep).filter((b) => ymdOf(b.checkOut) <= today),
        });
        return;
      }
      const status = { upcoming: "confirmed", in_house: "checked_in", past: "checked_out", cancelled: f.sub }[f.tab] || "confirmed";
      const from = f.from || (f.tab === "upcoming" ? today : undefined);
      const data = await partnerApi.get("/partner/bookings", {
        ...base,
        status,
        from,
        to: f.to || undefined,
        page: Number(f.page) || 1,
        limit: LIMIT,
      });
      if (id !== seq.current) return;
      setState({ loading: false, error: "", list: pageOf(data), arrivals: null, departures: null });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [f.tab, f.propertyId, f.q, f.from, f.to, f.page, f.sub, today]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = Boolean(f.q || f.propertyId || f.from || f.to);
  const showDates = f.tab !== "today";
  const firstLoad = state.loading && !state.list && !state.arrivals;

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle="Arrivals, guests in-house and every reservation at your properties."
        action={
          <Button variant="secondary" icon={RefreshCw} onClick={load} disabled={state.loading}>
            Refresh
          </Button>
        }
      />

      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist">
        {BOOKING_TABS.map((t) => (
          <Chip key={t.key} selected={f.tab === t.key} onClick={() => update({ tab: t.key })}>
            {t.label}
          </Chip>
        ))}
      </div>

      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Booking ref, guest name or phone"
            aria-label="Search bookings"
            className={cx(inputCls, "w-full pl-9")}
          />
        </div>
        <select
          aria-label="Property"
          value={f.propertyId}
          onChange={(e) => update({ propertyId: e.target.value })}
          className={cx(inputCls, "w-full")}
        >
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name || "Untitled property"}
            </option>
          ))}
        </select>
        {showDates && (
          <>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              From
              <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => update({ from: e.target.value })} className={inputCls} />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              To
              <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => update({ to: e.target.value })} className={inputCls} />
            </label>
          </>
        )}
      </div>

      {f.tab === "cancelled" && (
        <div className="mb-4 flex gap-2">
          <Chip selected={f.sub === "cancelled"} onClick={() => update({ sub: "cancelled" })}>
            Cancelled
          </Chip>
          <Chip selected={f.sub === "no_show"} onClick={() => update({ sub: "no_show" })}>
            No-show
          </Chip>
        </div>
      )}

      {filtered && (
        <button
          type="button"
          onClick={() => update({ q: "", propertyId: "", from: "", to: "" })}
          className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-[#0B2A6F] hover:underline"
        >
          <X className="h-4 w-4" /> Clear filters
        </button>
      )}

      {state.error && (
        <div className="mb-4">
          <InlineError message={state.error} onRetry={load} />
        </div>
      )}

      {firstLoad ? (
        <div className="grid gap-3 md:grid-cols-2">
          <BookingCardSkeletons />
        </div>
      ) : f.tab === "today" ? (
        state.arrivals && (
          <div className={cx("grid gap-6 lg:grid-cols-2", state.loading && "opacity-60")}>
            <section>
              <SectionTitle title={`Arrivals today (${state.arrivals.length})`} subtitle="Confirmed guests checking in today." />
              {state.arrivals.length === 0 ? (
                <EmptyState icon={LogIn} title="No arrivals today" text={filtered ? "Nothing matches these filters." : undefined} />
              ) : (
                <div className="space-y-3">
                  {state.arrivals.map((b) => (
                    <BookingCard key={b._id} booking={b} />
                  ))}
                </div>
              )}
            </section>
            <section>
              <SectionTitle title={`Departures today (${state.departures.length})`} subtitle="In-house guests due to check out." />
              {state.departures.length === 0 ? (
                <EmptyState icon={LogOut} title="No departures today" text={filtered ? "Nothing matches these filters." : undefined} />
              ) : (
                <div className="space-y-3">
                  {state.departures.map((b) => (
                    <BookingCard key={b._id} booking={b} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )
      ) : state.list && state.list.items.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={filtered ? "No bookings match these filters" : "No bookings here yet"}
          text={
            filtered
              ? "Try another property, date range or search."
              : "Bookings appear here as soon as guests reserve one of your live properties."
          }
        />
      ) : (
        state.list && (
          <div className={state.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="grid gap-3 md:grid-cols-2">
              {state.list.items.map((b) => (
                <BookingCard key={b._id} booking={b} />
              ))}
            </div>
            <Pager
              page={state.list.page}
              limit={state.list.limit}
              total={state.list.total}
              busy={state.loading}
              onPage={(page) => update({ page: String(page) })}
            />
          </div>
        )
      )}
    </div>
  );
}
