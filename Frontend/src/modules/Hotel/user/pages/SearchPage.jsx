import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, ChevronLeft, ChevronRight, Pencil, SearchX, ServerCrash, SlidersHorizontal, X } from "lucide-react";
import SearchBox from "../components/SearchBox";
import Filters from "../components/Filters";
import { ResultCard, ResultCardSkeleton } from "../components/PropertyCard";
import { guestsSummary } from "../components/StayFields";
import { BTN, Sheet, StateMessage, cx, stagger } from "../components/ui";
import { getCatalogue, searchProperties } from "../lib/api";
import { amenityLabel, typeLabel, SUITABILITY_LABELS } from "../lib/catalogue";
import { diffDays, fmtDate, nightsLabel } from "../lib/dates";
import { formatINR } from "../lib/format";
import {
  PAGE_SIZE,
  SORTS,
  clearFilters,
  countFilters,
  destinationLabel,
  readSearch,
  stayQuery,
  toApiParams,
  toQuery,
} from "../lib/searchState";
import useAsync from "../lib/useAsync";
import useTitle from "../lib/useTitle";

function SortSelect({ value, hasGeo, onChange, className = "" }) {
  return (
    <label className={cx("relative inline-flex items-center", className)}>
      <span className="sr-only">Sort results</span>
      <ArrowUpDown className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-8 text-sm font-semibold text-slate-700 focus:border-[#0B2A6F] focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        {SORTS.filter((s) => !s.needsGeo || hasGeo).map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <ChevronRight className="pointer-events-none absolute right-2.5 h-4 w-4 rotate-90 text-slate-400" aria-hidden="true" />
    </label>
  );
}

/** Removable pills for the active filters. */
function ActiveFilters({ state, catalogue, onChange, onClear }) {
  const pills = [];
  if (state.minPrice !== undefined || state.maxPrice !== undefined) {
    const label =
      state.minPrice !== undefined && state.maxPrice !== undefined
        ? `${formatINR(state.minPrice)} – ${formatINR(state.maxPrice)}`
        : state.minPrice !== undefined
          ? `${formatINR(state.minPrice)}+`
          : `Under ${formatINR(state.maxPrice)}`;
    pills.push({ key: "price", label, remove: { minPrice: undefined, maxPrice: undefined } });
  }
  state.types.forEach((t) => pills.push({ key: `t-${t}`, label: typeLabel(t), remove: { types: state.types.filter((x) => x !== t) } }));
  if (state.minRating !== undefined) pills.push({ key: "rating", label: `${state.minRating}+ rating`, remove: { minRating: undefined } });
  if (state.suitability) pills.push({ key: "suit", label: SUITABILITY_LABELS[state.suitability] || state.suitability, remove: { suitability: "" } });
  state.amenities.forEach((a) =>
    pills.push({ key: `a-${a}`, label: amenityLabel(a, catalogue), remove: { amenities: state.amenities.filter((x) => x !== a) } })
  );
  if (!pills.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.remove)}
          className="inline-flex items-center gap-1 rounded-full bg-[#0B2A6F]/5 px-3 py-1.5 text-xs font-semibold text-[#0B2A6F] transition hover:bg-[#0B2A6F]/10"
          aria-label={`Remove filter ${p.label}`}
        >
          {p.label} <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ))}
      <button type="button" onClick={onClear} className="text-xs font-semibold text-[#E85D04] hover:underline">
        Clear all
      </button>
    </div>
  );
}

function Pagination({ page, pages, onPage }) {
  if (pages <= 1) return null;
  const nums = [];
  const from = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = from; i <= Math.min(pages, from + 4); i += 1) nums.push(i);
  const btn = "flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition";
  return (
    <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="Pages">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className={cx(btn, "border border-slate-200 bg-white disabled:opacity-40")} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" />
      </button>
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPage(n)}
          aria-current={n === page ? "page" : undefined}
          className={cx(btn, n === page ? "bg-[#0B2A6F] text-white" : "border border-slate-200 bg-white text-slate-700 hover:border-[#0B2A6F]")}
        >
          {n}
        </button>
      ))}
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} className={cx(btn, "border border-slate-200 bg-white disabled:opacity-40")} aria-label="Next page">
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const state = useMemo(() => readSearch(params), [params]);
  const hasGeo = state.lat !== undefined;
  const where = destinationLabel(state);
  useTitle(`Stays in ${where}`);

  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(null); // 'filters' | 'sort' | null
  const [draft, setDraft] = useState(state);

  const apiKey = JSON.stringify(toApiParams(state));
  const results = useAsync(() => searchProperties(state), apiKey);
  const catalogue = useAsync(getCatalogue, "catalogue");

  const update = (patch, { resetPage = true } = {}) => {
    const next = { ...state, ...patch, ...(resetPage ? { page: 1 } : {}) };
    navigate(`/hotel/search?${toQuery(next)}`);
  };
  const onPage = (page) => {
    update({ page }, { resetPage: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const items = results.data?.items || [];
  const total = results.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / (results.data?.limit || PAGE_SIZE)));
  const filterCount = countFilters(state);
  const stayQs = stayQuery(state);
  const nights = diffDays(state.checkIn, state.checkOut);
  const firstLoad = results.loading && !results.data;

  const openFilters = () => {
    setDraft(state);
    setSheet("filters");
  };

  return (
    <div>
      {/* Search summary / modify */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <AnimatePresence initial={false} mode="wait">
            {editing ? (
              <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-1">
                <SearchBox
                  variant="compact"
                  initial={state}
                  onSearch={(patch) => {
                    setEditing(false);
                    update({ ...patch, sort: patch.sort || (state.sort === "distance" ? "relevance" : state.sort) });
                  }}
                />
                <button type="button" onClick={() => setEditing(false)} className={cx(BTN.ghost, "mt-2")}>
                  Cancel
                </button>
              </motion.div>
            ) : (
              <motion.button
                key="summary"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditing(true)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left transition hover:border-[#0B2A6F] sm:max-w-2xl"
                aria-label="Modify search"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-900">{where}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {fmtDate(state.checkIn)} – {fmtDate(state.checkOut)} · {nightsLabel(nights)} · {guestsSummary(state)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B2A6F] shadow-sm">
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Modify
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Mobile filter/sort bar */}
      <div className="sticky top-16 z-30 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-slate-200">
          <button type="button" onClick={openFilters} className="flex items-center justify-center gap-2 py-3 text-sm font-semibold text-slate-700">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
            {filterCount > 0 && <span className="rounded-full bg-[#FF7A00] px-1.5 text-[11px] font-bold text-white">{filterCount}</span>}
          </button>
          <button type="button" onClick={() => setSheet("sort")} className="flex items-center justify-center gap-2 py-3 text-sm font-semibold text-slate-700">
            <ArrowUpDown className="h-4 w-4" aria-hidden="true" /> {SORTS.find((s) => s.key === state.sort)?.label || "Sort"}
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[280px_1fr]">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block" aria-label="Filters">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm [scrollbar-width:thin]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
              </h2>
              {filterCount > 0 && (
                <button type="button" onClick={() => update(clearFilters(state))} className="text-xs font-semibold text-[#E85D04] hover:underline">
                  Clear all
                </button>
              )}
            </div>
            <Filters value={state} onChange={(patch) => update(patch)} catalogue={catalogue.data} />
          </div>
        </aside>

        <section aria-label="Results" aria-busy={results.loading}>
          <div className="mb-4 flex min-h-[44px] flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl" aria-live="polite">
              {firstLoad ? (
                <span className="text-slate-400">Finding stays…</span>
              ) : results.error && !results.data ? (
                "Search"
              ) : (
                <>
                  {total.toLocaleString("en-IN")} {total === 1 ? "stay" : "stays"}
                  <span className="font-medium text-slate-500"> {hasGeo ? "near you" : `in ${where}`}</span>
                </>
              )}
            </h1>
            <SortSelect value={state.sort} hasGeo={hasGeo} onChange={(sort) => update({ sort })} className="hidden lg:inline-flex" />
          </div>

          <ActiveFilters state={state} catalogue={catalogue.data} onChange={(patch) => update(patch)} onClear={() => update(clearFilters(state))} />

          {results.error ? (
            <StateMessage icon={ServerCrash} tone="red" title="We couldn't load stays" message={results.error.message}>
              <button type="button" onClick={results.reload} className={BTN.primary}>
                Try again
              </button>
            </StateMessage>
          ) : firstLoad ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }, (_, i) => (
                <ResultCardSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <StateMessage
              icon={SearchX}
              tone="saffron"
              title="No stays match your search"
              message={
                filterCount
                  ? "Try removing a few filters or changing your dates."
                  : "Try different dates, fewer guests or a nearby city."
              }
            >
              {filterCount > 0 && (
                <button type="button" onClick={() => update(clearFilters(state))} className={BTN.primary}>
                  Clear filters
                </button>
              )}
              <button type="button" onClick={() => setEditing(true)} className={BTN.outline}>
                Change search
              </button>
            </StateMessage>
          ) : (
            <>
              <motion.div
                key={apiKey}
                initial="hidden"
                animate="show"
                variants={stagger(0.06)}
                className={cx("space-y-4 transition-opacity", results.loading && "pointer-events-none opacity-50")}
              >
                {items.map((p, i) => (
                  <ResultCard key={p._id} property={p} stayQs={stayQs} catalogue={catalogue.data} priority={i < 2} />
                ))}
              </motion.div>
              <Pagination page={state.page} pages={pages} onPage={onPage} />
            </>
          )}
        </section>
      </div>

      {/* Mobile sheets */}
      <Sheet
        open={sheet === "filters"}
        onClose={() => setSheet(null)}
        title="Filters"
        footer={
          <div className="flex gap-3">
            <button type="button" onClick={() => setDraft(clearFilters(draft))} className={cx(BTN.outline, "flex-1")}>
              Clear all
            </button>
            <button
              type="button"
              onClick={() => {
                setSheet(null);
                update(draft);
              }}
              className={cx(BTN.primary, "flex-[2]")}
            >
              Show results
            </button>
          </div>
        }
      >
        <Filters value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} catalogue={catalogue.data} />
      </Sheet>

      <Sheet open={sheet === "sort"} onClose={() => setSheet(null)} title="Sort by">
        <ul className="space-y-1 pb-2" role="radiogroup" aria-label="Sort by">
          {SORTS.filter((s) => !s.needsGeo || hasGeo).map((s) => (
            <li key={s.key}>
              <button
                type="button"
                role="radio"
                aria-checked={state.sort === s.key}
                onClick={() => {
                  setSheet(null);
                  update({ sort: s.key });
                }}
                className={cx(
                  "flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold",
                  state.sort === s.key ? "bg-orange-50 text-[#E85D04]" : "text-slate-700 hover:bg-slate-50"
                )}
              >
                {s.label}
                <span className={cx("h-4 w-4 rounded-full border-2", state.sort === s.key ? "border-[#FF7A00] bg-[#FF7A00] ring-2 ring-inset ring-white" : "border-slate-300")} />
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
