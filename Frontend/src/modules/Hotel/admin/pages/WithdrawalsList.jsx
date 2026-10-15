import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Banknote, CheckCircle2, Landmark, XCircle } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { useListParams } from "../useListParams";
import { formatDate, masked, money, pageOf } from "../format";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  StatusBadge,
  StatusTabs,
  TableSkeleton,
} from "../components/ui";
import { useHotelAccess } from "../hotelAccess";

const TABS = ["pending", "approved", "paid", "rejected", "all"];
const LIMIT = 20;

/** Per target status: what the dialog asks for and what it sends. */
const ACTIONS = {
  approved: {
    label: "Approve",
    tone: "success",
    icon: CheckCircle2,
    title: "Approve this withdrawal?",
    message: "Approve, then transfer the money and mark it paid with the bank reference.",
    done: "Withdrawal approved",
  },
  paid: {
    label: "Mark paid",
    tone: "primary",
    icon: Banknote,
    title: "Mark as paid?",
    message: "Enter the UTR / bank reference of the transfer. The partner sees it.",
    field: "utr",
    reasonLabel: "UTR / reference",
    placeholder: "e.g. HDFCN52025101512345678",
    done: "Marked as paid",
  },
  rejected: {
    label: "Reject",
    tone: "danger",
    icon: XCircle,
    title: "Reject this withdrawal?",
    message: "The amount returns to the partner's withdrawable balance.",
    field: "note",
    reasonLabel: "Note",
    placeholder: "Shown to the partner",
    done: "Withdrawal rejected",
  },
};

const NEXT = { pending: ["approved", "paid", "rejected"], approved: ["paid", "rejected"] };

export default function WithdrawalsList() {
  const { canWrite } = useHotelAccess();
  const canPay = canWrite("hotel_withdrawals");
  const [params, update] = useListParams({ status: "pending", page: 1 });
  const [pending, setPending] = useState(null); // { item, status }

  const { data, loading, error, reload } = useLoad(
    () => hotelAdmin.withdrawals({ status: params.status, page: params.page, limit: LIMIT }),
    [params.status, params.page],
  );
  const list = pageOf(data);
  const action = pending ? ACTIONS[pending.status] : null;

  const confirm = async (text) => {
    const { item, status } = pending;
    try {
      await hotelAdmin.setWithdrawalStatus(item._id, status, action.field ? { [action.field]: text } : {});
      toast.success(action.done);
      reload();
    } catch (err) {
      toast.error(err?.message || "Could not update the withdrawal");
      throw err;
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Withdrawals" subtitle="Partner payout requests. Approve, transfer, then mark paid with the UTR." />

      <Card bodyClassName="p-0">
        <div className="border-b border-[var(--ha-border)] p-3">
          <StatusTabs tabs={TABS} value={params.status} onChange={(status) => update({ status })} />
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <TableSkeleton cols={6} />
        ) : list.items.length === 0 ? (
          <EmptyState icon={Landmark} title={params.status === "pending" ? "No withdrawals waiting" : "No withdrawals here"} />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-[var(--ha-surface)] text-[11px] font-bold uppercase tracking-wide text-[var(--ha-ink-faint)]">
                  <tr>
                    <th className="px-4 py-3">Partner</th>
                    <th className="px-4 py-3">Bank</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Requested</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ha-border)]">
                  {list.items.map((w) => {
                    const partner = w.partner || (typeof w.partnerId === "object" ? w.partnerId : null) || {};
                    const partnerId = partner._id || (typeof w.partnerId === "string" ? w.partnerId : null);
                    const bank = w.bank || partner.bank;
                    return (
                      <tr key={w._id} className="align-top">
                        <td className="px-4 py-3">
                          {partnerId ? (
                            <Link to={`/admin/hotel/partners/${partnerId}`} className="font-semibold text-[var(--ha-navy)] hover:underline">
                              {partner.name || "Partner"}
                            </Link>
                          ) : (
                            <p className="font-semibold text-[var(--ha-ink)]">{partner.name || "—"}</p>
                          )}
                          {partner.phone && <p className="text-xs tabular-nums text-[var(--ha-ink-faint)]">{partner.phone}</p>}
                        </td>
                        <td className="px-4 py-3 text-[var(--ha-ink-soft)]">
                          {bank ? (
                            <>
                              <p>{bank.accountHolder || "—"}</p>
                              <p className="text-xs">
                                {masked(bank.accountNumberMasked)} · {bank.ifsc || "—"}
                                {bank.bankName ? ` · ${bank.bankName}` : ""}
                              </p>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-[var(--ha-ink)]">{money(w.amount)}</td>
                        <td className="px-4 py-3 text-[var(--ha-ink-soft)]">{formatDate(w.createdAt, true)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={w.status} />
                          {w.utr && <p className="mt-1 font-mono text-xs text-[var(--ha-ink-soft)]">UTR {w.utr}</p>}
                          {w.note && <p className="mt-1 max-w-[220px] text-xs text-[var(--ha-ink-soft)]">{w.note}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            {(canPay ? NEXT[w.status] || [] : []).map((s) => {
                              const a = ACTIONS[s];
                              return (
                                <Button key={s} tone={a.tone} icon={a.icon} onClick={() => setPending({ item: w, status: s })}>
                                  {a.label}
                                </Button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={list.page} limit={list.limit} total={list.total} onPage={(page) => update({ page })} />
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(pending)}
        title={action?.title}
        message={pending ? `${action.message} Amount: ${money(pending.item.amount)}.` : ""}
        confirmLabel={action?.label}
        tone={action?.tone}
        reason={Boolean(action?.field)}
        reasonRequired={Boolean(action?.field)}
        reasonLabel={action?.reasonLabel}
        reasonPlaceholder={action?.placeholder}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
