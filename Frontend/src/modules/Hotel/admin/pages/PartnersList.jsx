import { useNavigate } from "react-router-dom";
import { ChevronRight, Users } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { useListParams } from "../useListParams";
import { formatDate, pageOf } from "../format";
import { Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, StatusBadge, StatusTabs, TableSkeleton } from "../components/ui";

const TABS = ["pending", "approved", "rejected", "blocked", "all"];
const LIMIT = 20;

export default function PartnersList() {
  const navigate = useNavigate();
  const [params, update] = useListParams({ status: "pending", q: "", page: 1 });
  const { data, loading, error, reload } = useLoad(
    () => hotelAdmin.partners({ status: params.status, q: params.q, page: params.page, limit: LIMIT }),
    [params.status, params.q, params.page],
  );
  const list = pageOf(data);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Partners" subtitle="Hotel owners and operators. Approve them after checking KYC and bank details." />

      <Card bodyClassName="p-0">
        <div className="flex flex-col gap-3 border-b border-[var(--ha-border)] p-3 md:flex-row md:items-center md:justify-between">
          <StatusTabs tabs={TABS} value={params.status} onChange={(status) => update({ status })} />
          <SearchInput
            className="md:w-72"
            value={params.q}
            onChange={(q) => update({ q })}
            placeholder="Name, phone or email"
          />
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <TableSkeleton cols={5} />
        ) : list.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={params.q ? "No partners match your search" : "No partners here"}
            message={params.status === "pending" && !params.q ? "No partner is waiting for approval." : undefined}
          />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-[var(--ha-surface)] text-[11px] font-bold uppercase tracking-wide text-[var(--ha-ink-faint)]">
                  <tr>
                    <th className="px-4 py-3">Partner</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">City</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Joined</th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ha-border)]">
                  {list.items.map((p) => (
                    <tr
                      key={p._id}
                      tabIndex={0}
                      onClick={() => navigate(`/admin/hotel/partners/${p._id}`)}
                      onKeyDown={(e) => e.key === "Enter" && navigate(`/admin/hotel/partners/${p._id}`)}
                      className="cursor-pointer hover:bg-[var(--ha-hover)] focus:bg-[var(--ha-hover)] focus:outline-none"
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[var(--ha-ink)]">{p.name || "Unnamed"}</p>
                        {p.email && <p className="text-xs text-[var(--ha-ink-faint)]">{p.email}</p>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[var(--ha-ink-soft)]">{p.phone || "—"}</td>
                      <td className="px-4 py-3 text-[var(--ha-ink-soft)]">{p.address?.city || "—"}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-[var(--ha-ink-soft)]">{formatDate(p.createdAt)}</td>
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
