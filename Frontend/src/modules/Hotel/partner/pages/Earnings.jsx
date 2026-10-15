import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Banknote, Clock3, IndianRupee, Landmark, ReceiptText, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { usePartner } from "../lib/PartnerContext";
import { BASE_PATH } from "../lib/constants";
import { asList, formatDate, money, num } from "../lib/utils";
import { ActionDialog, Pager } from "../components/bookings";
import { Button, Card, EmptyState, InlineError, PageHeader, SectionTitle, Skeleton, TextField, cx } from "../components/ui";

const LIMIT = 20;

const WITHDRAWAL_META = {
  pending: { label: "Requested", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  approved: { label: "Approved", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
  paid: { label: "Paid", chip: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "Rejected", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
};

const titleCase = (v) =>
  String(v || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

const when = (v) =>
  v ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** A paginated endpoint with its own page state. */
function usePaged(url) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await partnerApi.get(url, { page, limit: LIMIT });
      if (id === seq.current) setState({ loading: false, error: "", data });
    } catch (e) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [url, page]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, items: asList(state.data), page, setPage, reload: load };
}

function Stat({ icon: Icon, label, value, tint, note, delay = 0, highlight }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card className={cx("h-full p-4 md:p-5", highlight && "border-green-200 bg-gradient-to-br from-white to-green-50")}>
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

export default function Earnings() {
  const { partner } = usePartner();
  const [summary, setSummary] = useState({ loading: true, error: "", data: null });
  const ledger = usePaged("/partner/ledger");
  const withdrawals = usePaged("/partner/withdrawals");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const loadSummary = useCallback(async () => {
    setSummary((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await partnerApi.get("/partner/earnings");
      setSummary({ loading: false, error: "", data });
    } catch (e) {
      setSummary((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const s = summary.data || {};
  const withdrawable = Number(s.withdrawable) || 0;
  const minWithdrawal = Number(s.minWithdrawal) || 0;
  const hasBank = Boolean(partner?.bank?.ifsc && (partner?.bank?.accountNumberMasked || partner?.bank?.accountHolder));
  const hasPending = withdrawals.items.some((w) => w.status === "pending");
  const canWithdraw = hasBank && withdrawable > 0 && withdrawable >= minWithdrawal;

  const amountNum = num(amount, 0);
  const amountError =
    amount === ""
      ? ""
      : amountNum <= 0
        ? "Enter an amount above zero."
        : amountNum < minWithdrawal
          ? `The minimum withdrawal is ${money(minWithdrawal)}.`
          : amountNum > withdrawable
            ? `You can withdraw up to ${money(withdrawable)}.`
            : "";

  const refreshAll = () => {
    loadSummary();
    ledger.reload();
    withdrawals.reload();
  };

  const withdraw = async () => {
    try {
      await partnerApi.post("/partner/withdrawals", { amount: amountNum });
      toast.success(`Withdrawal of ${money(amountNum)} requested`);
      refreshAll();
    } catch (e) {
      toast.error(e.message);
      throw e;
    }
  };

  return (
    <div>
      <PageHeader
        title="Earnings"
        subtitle="Your payouts from completed stays, and withdrawals to your bank."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" icon={RefreshCw} onClick={refreshAll} disabled={summary.loading}>
              Refresh
            </Button>
            <Button
              icon={Banknote}
              disabled={!summary.data || !canWithdraw}
              title={!hasBank ? "Add your bank details first" : withdrawable < minWithdrawal ? `Minimum ${money(minWithdrawal)}` : undefined}
              onClick={() => {
                setAmount(String(withdrawable));
                setOpen(true);
              }}
            >
              Withdraw
            </Button>
          </div>
        }
      />

      {!hasBank && partner && (
        <Card className="mb-5 flex flex-wrap items-center gap-3 border-orange-200 bg-orange-50 p-4">
          <Landmark className="h-5 w-5 shrink-0 text-[#E85D04]" />
          <p className="flex-1 text-sm text-orange-900">
            <span className="font-semibold">Add your bank account to withdraw.</span> Payouts go to the account in your profile.
          </p>
          <Link
            to={`${BASE_PATH}/profile#sec-bank`}
            className="inline-flex h-9 items-center rounded-lg bg-[#FF7A00] px-3 text-sm font-semibold text-white hover:bg-[#E85D04]"
          >
            Add bank details
          </Link>
        </Card>
      )}

      {summary.error && (
        <div className="mb-4">
          <InlineError message={summary.error} onRetry={loadSummary} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {!summary.data && summary.loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36" />)
        ) : (
          <>
            <Stat
              icon={Wallet}
              label="Withdrawable now"
              value={money(withdrawable)}
              tint="bg-green-50 text-[#16A34A]"
              note={minWithdrawal ? `Minimum withdrawal ${money(minWithdrawal)}` : undefined}
              highlight
            />
            <Stat icon={IndianRupee} label="Balance" value={money(s.balance)} tint="bg-blue-50 text-[#0B2A6F]" delay={0.03} note="Includes pending withdrawals" />
            <Stat
              icon={Clock3}
              label="Pending settlement"
              value={money(s.pendingSettlement)}
              tint="bg-amber-50 text-amber-600"
              delay={0.06}
              note="Stays not yet settled"
            />
            <Stat
              icon={TrendingUp}
              label="This month"
              value={money(s.thisMonth)}
              tint="bg-orange-50 text-[#E85D04]"
              delay={0.09}
              note={`Total earned ${money(s.totalEarned)}`}
            />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionTitle title="Ledger" subtitle="Every credit and debit on your account." />
          <Card className="overflow-hidden">
            {ledger.error ? (
              <div className="p-4">
                <InlineError message={ledger.error} onRetry={ledger.reload} />
              </div>
            ) : ledger.loading && !ledger.data ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : ledger.items.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={ReceiptText} title="No entries yet" text="Payouts appear here when stays are settled." />
              </div>
            ) : (
              <div className={cx("overflow-x-auto", ledger.loading && "opacity-60")}>
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Details</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.items.map((e) => {
                      const amt = Number(e.amount) || 0;
                      return (
                        <tr key={e._id}>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(e.createdAt)}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-800">{e.description || titleCase(e.type)}</p>
                            <p className="text-xs text-slate-400">
                              {titleCase(e.type)}
                              {e.bookingRef && (
                                <>
                                  {" · "}
                                  <span className="font-mono">{e.bookingRef}</span>
                                </>
                              )}
                            </p>
                          </td>
                          <td className={cx("whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums", amt < 0 ? "text-rose-600" : "text-green-700")}>
                            {amt < 0 ? "− " : "+ "}
                            {money(Math.abs(amt))}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                            {e.balanceAfter != null ? money(e.balanceAfter) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Pager
            page={Number(ledger.data?.page) || ledger.page}
            limit={Number(ledger.data?.limit) || LIMIT}
            total={Number(ledger.data?.total) || 0}
            busy={ledger.loading}
            onPage={ledger.setPage}
          />
        </section>

        <section className="lg:col-span-2">
          <SectionTitle title="Withdrawals" subtitle="Usually paid to your bank within 2–3 working days." />
          {withdrawals.error ? (
            <InlineError message={withdrawals.error} onRetry={withdrawals.reload} />
          ) : withdrawals.loading && !withdrawals.data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : withdrawals.items.length === 0 ? (
            <EmptyState icon={Banknote} title="No withdrawals yet" text="Request one when your withdrawable balance reaches the minimum." />
          ) : (
            <div className={cx("space-y-2", withdrawals.loading && "opacity-60")}>
              {withdrawals.items.map((w) => {
                const meta = WITHDRAWAL_META[w.status] || { label: titleCase(w.status), chip: "bg-slate-100 text-slate-600 ring-slate-200" };
                return (
                  <Card key={w._id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-bold tabular-nums text-[#071A47]">{money(w.amount)}</p>
                        <p className="text-xs text-slate-500">{when(w.createdAt)}</p>
                      </div>
                      <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", meta.chip)}>
                        {meta.label}
                      </span>
                    </div>
                    {w.utr && (
                      <p className="mt-2 text-xs text-slate-600">
                        UTR <span className="font-mono">{w.utr}</span>
                      </p>
                    )}
                    {w.note && <p className="mt-1 text-xs text-slate-600">{w.note}</p>}
                  </Card>
                );
              })}
            </div>
          )}
          <Pager
            page={Number(withdrawals.data?.page) || withdrawals.page}
            limit={Number(withdrawals.data?.limit) || LIMIT}
            total={Number(withdrawals.data?.total) || 0}
            busy={withdrawals.loading}
            onPage={withdrawals.setPage}
          />
        </section>
      </div>

      <ActionDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Withdraw to bank"
        submitLabel="Request withdrawal"
        canSubmit={amount !== "" && !amountError}
        onSubmit={withdraw}
      >
        <p className="mb-3 text-sm text-slate-600">
          Available {money(withdrawable)}
          {minWithdrawal ? ` · minimum ${money(minWithdrawal)}` : ""}.
          {partner?.bank?.accountNumberMasked && (
            <>
              {" "}
              Paid to {partner.bank.bankName || "your account"} <span className="font-mono">{partner.bank.accountNumberMasked}</span>.
            </>
          )}
        </p>
        {hasPending && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">You already have a withdrawal waiting for approval.</p>
        )}
        <TextField
          label="Amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          prefix="₹"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amountError}
          required
        />
      </ActionDialog>
    </div>
  );
}
