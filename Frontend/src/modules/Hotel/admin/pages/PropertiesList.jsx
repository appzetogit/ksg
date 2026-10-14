import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight } from "lucide-react";
import { getCatalogue } from "../../shared/hotelApi";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { useListParams } from "../useListParams";
import { formatDate, label, money, pageOf } from "../format";
import {
  Card,
  EmptyState,
  ErrorState,
  LiveBadge,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  StatusTabs,
  TableSkeleton,
} from "../components/ui";

const TABS = ["pending", "approved", "rejected", "suspended", "draft", "all"];
const FALLBACK_TYPES = ["hotel", "resort", "villa", "homestay", "hostel", "pg"];
const LIMIT = 20;

export default function PropertiesList() {
  const navigate = useNavigate();
  const [params, update] = useListParams({ status: "pending", type: "", city: "", q: "", partnerId: "", page: 1 });
  const [types, setTypes] = useState(FALLBACK_TYPES);

  useEffect(() => {
    getCatalogue()
      .then((c) => Array.isArray(c?.propertyTypes) && c.propertyTypes.length && setTypes(c.propertyTypes))
      .catch(() => {});
  }, []);

  const { data, loading, error, reload } = useLoad(
    () =>
      hotelAdmin.properties({
        status: params.status,
        type: params.type,
        city: params.city,
        q: params.q,
        partnerId: params.partnerId,
        page: params.page,
        limit: LIMIT,
      }),
    [params.status, params.type, params.city, params.q, params.partnerId, params.page],
  );
  const list = pageOf(data);
  const filtered = params.q || params.city || params.type;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Properties" subtitle="Listings submitted by partners. Verify documents, then approve to let them go live." />

      <Card bodyClassName="p-0">
        <div className="space-y-3 border-b border-[var(--ha-border)] p-3">
          <StatusTabs tabs={TABS} value={params.status} onChange={(status) => update({ status })} />
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <SearchInput value={params.q} onChange={(q) => update({ q })} placeholder="Property name" />
            <SearchInput value={params.city} onChange={(city) => update({ city })} placeholder="City" />
            <Select
              ariaLabel="Property type"
              value={params.type}
              onChange={(type) => update({ type })}
              options={[["", "All types"], ...types.map((t) => [t, label(t)])]}
            />
          </div>
          {params.partnerId && (
            <button
              type="button"
              onClick={() => update({ partnerId: "" })}
              className="text-xs font-semibold text-[var(--ha-navy)] underline"
            >
              Showing one partner's properties — clear
            </button>
          )}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <TableSkeleton cols={6} />
        ) : list.items.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={filtered ? "No properties match these filters" : "No properties here"}
            message={params.status === "pending" && !filtered ? "No property is waiting for approval." : undefined}
          />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-[var(--ha-surface)] text-[11px] font-bold uppercase tracking-wide text-[var(--ha-ink-faint)]">
                  <tr>
                    <th className="px-4 py-3">Property</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Partner</th>
                    <th className="px-4 py-3">From</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ha-border)]">
                  {list.items.map((p) => (
                    <tr
                      key={p._id}
                      tabIndex={0}
                      onClick={() => navigate(`/admin/hotel/properties/${p._id}`)}
                      onKeyDown={(e) => e.key === "Enter" && navigate(`/admin/hotel/properties/${p._id}`)}
                      className="cursor-pointer hover:bg-[var(--ha-hover)] focus:bg-[var(--ha-hover)] focus:outline-none"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.coverImage ? (
                            <img src={p.coverImage} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded-md object-cover" />
                          ) : (
                            <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-[var(--ha-surface)]">
                              <Building2 className="h-4 w-4 text-[var(--ha-ink-faint)]" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[var(--ha-ink)]">{p.name}</p>
                            <p className="truncate text-xs text-[var(--ha-ink-faint)]">
                              {[p.address?.area, p.address?.city].filter(Boolean).join(", ") || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--ha-ink-soft)]">{label(p.propertyType)}</td>
                      <td className="px-4 py-3">
                        <p className="text-[var(--ha-ink)]">{p.partner?.name || "—"}</p>
                        {p.partner?.phone && <p className="text-xs tabular-nums text-[var(--ha-ink-faint)]">{p.partner.phone}</p>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[var(--ha-ink-soft)]">{money(p.startingPrice)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge status={p.status} />
                          {p.status === "approved" && <LiveBadge isLive={p.isLive} />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--ha-ink-soft)]">{formatDate(p.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <ChevronRight className="h-4 w-4 text-[var(--ha-ink-faint)]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.page} limit={list.limit} total={list.total} onPage={(page) => update({ page })} />
          </div>
        )}
      </Card>
    </div>
  );
}
