import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Info, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { Button, Card, DetailSkeleton, ErrorState, PageHeader, cx } from "../components/ui";

/** Defaults from the contract, used for any field the server leaves out. */
const DEFAULTS = {
  commissionPercent: 10,
  minCommission: 50,
  commissionGstPercent: 18,
  paymentHoldMinutes: 30,
  prepaidDiscountPercent: 5,
  prepaidAdvancePercent: 30,
  allowPayAtHotel: true,
  reviewAutoApprove: true,
  minWithdrawal: 500,
  settleOn: "checked_out",
  gstSlabs: [
    { upTo: 1000, rate: 0 },
    { upTo: 7500, rate: 5 },
    { upTo: null, rate: 18 },
  ],
};

/** Numeric fields: [key, label, hint, suffix, min, max, integer]. */
const NUMBERS = [
  ["commissionPercent", "Commission", "Share of the room tariff KSG keeps.", "%", 0, 100],
  ["minCommission", "Minimum commission", "Per booking, in rupees.", "₹", 0, 100000],
  ["commissionGstPercent", "GST on commission", "Charged to the partner on the commission.", "%", 0, 100],
  ["paymentHoldMinutes", "Payment hold", "How long an unpaid online booking holds the rooms.", "min", 5, 1440, true],
  ["prepaidDiscountPercent", "Prepaid discount", "Discount for paying online now.", "%", 0, 100],
  ["prepaidAdvancePercent", "Advance for part-prepaid", "Share paid online when the guest picks part payment.", "%", 1, 100],
  ["minWithdrawal", "Minimum withdrawal", "Smallest payout a partner can request.", "₹", 0, 1000000],
];

const toForm = (s = {}) => {
  const merged = { ...DEFAULTS, ...s };
  const out = { ...merged };
  NUMBERS.forEach(([k]) => {
    out[k] = merged[k] == null ? "" : String(merged[k]);
  });
  const slabs = Array.isArray(merged.gstSlabs) && merged.gstSlabs.length ? merged.gstSlabs : DEFAULTS.gstSlabs;
  out.gstSlabs = slabs.map((r) => ({ upTo: r.upTo == null ? "" : String(r.upTo), rate: r.rate == null ? "" : String(r.rate) }));
  return out;
};

const toPayload = (f) => {
  const out = {
    allowPayAtHotel: Boolean(f.allowPayAtHotel),
    reviewAutoApprove: Boolean(f.reviewAutoApprove),
    settleOn: f.settleOn,
  };
  NUMBERS.forEach(([k]) => {
    out[k] = Number(f[k]);
  });
  out.gstSlabs = f.gstSlabs.map((r, i) => ({
    upTo: i === f.gstSlabs.length - 1 ? null : Number(r.upTo),
    rate: Number(r.rate),
  }));
  return out;
};

function validate(f) {
  const errors = {};
  NUMBERS.forEach(([k, , , , min, max, integer]) => {
    const raw = f[k];
    const v = Number(raw);
    if (raw === "" || !Number.isFinite(v)) errors[k] = "Required";
    else if (v < min || v > max) errors[k] = `Between ${min} and ${max}`;
    else if (integer && !Number.isInteger(v)) errors[k] = "Whole minutes";
  });
  const slabErrors = f.gstSlabs.map((r, i) => {
    const e = {};
    const last = i === f.gstSlabs.length - 1;
    const rate = Number(r.rate);
    if (r.rate === "" || !Number.isFinite(rate) || rate < 0 || rate > 100) e.rate = "0–100";
    if (!last) {
      const upTo = Number(r.upTo);
      const prev = i > 0 ? Number(f.gstSlabs[i - 1].upTo) : 0;
      if (r.upTo === "" || !Number.isFinite(upTo) || upTo <= 0) e.upTo = "Required";
      else if (i > 0 && Number.isFinite(prev) && upTo <= prev) e.upTo = `Above ₹${prev}`;
    }
    return e;
  });
  if (slabErrors.some((e) => Object.keys(e).length)) errors.gstSlabs = slabErrors;
  return errors;
}

const inputCls = (bad) =>
  cx(
    "w-full rounded-lg border bg-white px-3 py-2 text-sm text-[var(--ha-ink)] tabular-nums focus:outline-none focus:ring-2",
    bad ? "border-red-400 focus:ring-red-200" : "border-[var(--ha-border)] focus:border-[var(--ha-navy)] focus:ring-[var(--ha-navy)]/20",
  );

function Switch({ checked, onChange, label, hint }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-[var(--ha-ink)]">{label}</p>
        <p className="text-xs text-[var(--ha-ink-faint)]">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors", checked ? "bg-emerald-600" : "bg-slate-300")}
      >
        <span className={cx("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </button>
    </div>
  );
}

export default function Settings() {
  const { data, loading, error, reload, setData } = useLoad(() => hotelAdmin.settings().then((d) => d?.settings || d), []);
  const [form, setForm] = useState(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  const errors = useMemo(() => (form ? validate(form) : {}), [form]);
  const dirty = useMemo(() => form && data && JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(toForm(data))), [form, data]);

  if (error && !data) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Hotel settings" />
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      </div>
    );
  }
  if ((loading && !data) || !form) {
    return (
      <div className="mx-auto max-w-4xl">
        <DetailSkeleton />
      </div>
    );
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setSlab = (i, patch) => setForm((f) => ({ ...f, gstSlabs: f.gstSlabs.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addSlab = () =>
    setForm((f) => {
      const rows = [...f.gstSlabs];
      const lastFinite = rows.length > 1 ? Number(rows[rows.length - 2].upTo) || 0 : 0;
      rows.splice(rows.length - 1, 0, { upTo: String(lastFinite + 1000), rate: rows[rows.length - 1]?.rate ?? "" });
      return { ...f, gstSlabs: rows };
    });
  const removeSlab = (i) => setForm((f) => ({ ...f, gstSlabs: f.gstSlabs.filter((_, j) => j !== i) }));

  const save = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (saving) return;
    if (Object.keys(errors).length) {
      toast.error("Fix the highlighted fields");
      return;
    }
    setSaving(true);
    try {
      const res = await hotelAdmin.saveSettings(toPayload(form));
      const saved = res?.settings || res;
      toast.success("Settings saved");
      if (saved && typeof saved === "object") setData(saved);
      else await reload();
      setTouched(false);
    } catch (err) {
      toast.error(err?.message || "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const show = (k) => touched || form[k] !== toForm(data)[k];

  return (
    <form onSubmit={save} noValidate className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Hotel settings"
        subtitle="Commission, payments, payouts and tax rules for the hotel module."
        actions={
          <>
            <Button icon={RotateCcw} disabled={!dirty || saving} onClick={() => setForm(toForm(data))}>
              Reset
            </Button>
            <Button type="submit" tone="primary" icon={Save} busy={saving} disabled={!dirty}>
              Save changes
            </Button>
          </>
        }
      />

      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">Changes apply to new bookings only.</span> Existing bookings keep the prices, tax and commission
          they were made with.
        </span>
      </div>

      <Card title="Commission, payments & payouts">
        <div className="grid gap-4 sm:grid-cols-2">
          {NUMBERS.map(([k, lbl, hint, suffix, min, max, integer]) => {
            const bad = show(k) && errors[k];
            return (
              <label key={k} className="block">
                <span className="text-sm font-semibold text-[var(--ha-ink)]">{lbl}</span>
                <div className="relative mt-1.5">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={min}
                    max={max}
                    step={integer ? 1 : "any"}
                    value={form[k]}
                    onChange={(e) => set({ [k]: e.target.value })}
                    className={cx(inputCls(bad), "pr-12")}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--ha-ink-faint)]">
                    {suffix}
                  </span>
                </div>
                <span className={cx("mt-1 block text-xs", bad ? "text-red-600" : "text-[var(--ha-ink-faint)]")}>{bad || hint}</span>
              </label>
            );
          })}
          <label className="block">
            <span className="text-sm font-semibold text-[var(--ha-ink)]">Settle partner payout on</span>
            <select value={form.settleOn} onChange={(e) => set({ settleOn: e.target.value })} className={cx(inputCls(false), "mt-1.5")}>
              <option value="checked_out">Check-out (safer)</option>
              <option value="confirmed">Confirmation (faster)</option>
            </select>
            <span className="mt-1 block text-xs text-[var(--ha-ink-faint)]">When a booking's payout moves to the partner's balance.</span>
          </label>
        </div>
        <div className="mt-5 space-y-4 border-t border-[var(--ha-border)] pt-4">
          <Switch
            checked={form.allowPayAtHotel}
            onChange={(v) => set({ allowPayAtHotel: v })}
            label="Allow pay at hotel"
            hint="Guests may book without paying online."
          />
          <Switch
            checked={form.reviewAutoApprove}
            onChange={(v) => set({ reviewAutoApprove: v })}
            label="Auto-approve reviews"
            hint="Publish reviews immediately; turn off to moderate each one."
          />
        </div>
      </Card>

      <Card
        title="GST slabs"
        actions={
          <Button icon={Plus} onClick={addSlab}>
            Add slab
          </Button>
        }
      >
        <p className="mb-3 text-xs text-[var(--ha-ink-faint)]">By room tariff per room per night. Slabs must go up; the last one covers everything above.</p>
        <div className="space-y-2">
          {form.gstSlabs.map((r, i) => {
            const last = i === form.gstSlabs.length - 1;
            const e = (touched || dirty) && errors.gstSlabs?.[i] ? errors.gstSlabs[i] : {};
            const prev = i > 0 ? form.gstSlabs[i - 1].upTo : null;
            return (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
                <div>
                  {last ? (
                    <div className="rounded-lg border border-dashed border-[var(--ha-border)] bg-[var(--ha-surface)] px-3 py-2 text-sm text-[var(--ha-ink-soft)]">
                      {prev ? `Above ₹${prev}` : "Any tariff"} <span className="text-[var(--ha-ink-faint)]">(and above)</span>
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--ha-ink-faint)]">Up to ₹</span>
                      <input
                        type="number"
                        min="0"
                        aria-label={`Slab ${i + 1} up to`}
                        value={r.upTo}
                        onChange={(ev) => setSlab(i, { upTo: ev.target.value })}
                        className={cx(inputCls(e.upTo), "pl-16")}
                      />
                    </div>
                  )}
                  {e.upTo && <span className="mt-0.5 block text-xs text-red-600">{e.upTo}</span>}
                </div>
                <div>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      aria-label={`Slab ${i + 1} GST rate`}
                      value={r.rate}
                      onChange={(ev) => setSlab(i, { rate: ev.target.value })}
                      className={cx(inputCls(e.rate), "pr-9")}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--ha-ink-faint)]">%</span>
                  </div>
                  {e.rate && <span className="mt-0.5 block text-xs text-red-600">{e.rate}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => removeSlab(i)}
                  disabled={last || form.gstSlabs.length <= 1}
                  className="rounded-lg p-2 text-[var(--ha-ink-faint)] hover:bg-red-50 hover:text-red-600 disabled:invisible"
                  aria-label={`Remove slab ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex justify-end gap-2 pb-6">
        <Button icon={RotateCcw} disabled={!dirty || saving} onClick={() => setForm(toForm(data))}>
          Reset
        </Button>
        <Button type="submit" tone="primary" icon={Save} busy={saving} disabled={!dirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
