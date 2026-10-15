import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pause, Pencil, Play, Plus, TicketPercent, Trash2 } from "lucide-react";
import { hotelAdmin } from "../api";
import { useLoad } from "../useLoad";
import { useListParams } from "../useListParams";
import { formatDate, label, money, pageOf } from "../format";
import FormDialog, { DialogField } from "../components/FormDialog";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  StatusTabs,
  TableSkeleton,
  cx,
} from "../components/ui";

/*
 * Hotel coupons (docs/hotel-api-contract.md, "Phase 9: coupons"). Master > Coupons
 * lists these too and can pause them; creating and editing happen here.
 *
 * Funding: platform-funded coupons are paid back to the hotel at settlement, so the
 * hotel earns as if the guest paid full price; partner-funded coupons come out of the
 * hotel's revenue and must be limited to specific properties.
 */

const TABS = ["live", "scheduled", "paused", "used_up", "expired", "all"];
const LIMIT = 20;
const PROPERTY_TYPES = ["hotel", "resort", "villa", "homestay", "hostel", "pg"];
const IST_MS = 5.5 * 3600 * 1000;

const STATE_TONE = {
  live: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  scheduled: "bg-sky-50 text-sky-800 ring-sky-200",
  paused: "bg-amber-50 text-amber-800 ring-amber-200",
  used_up: "bg-slate-100 text-slate-700 ring-slate-200",
  expired: "bg-slate-100 text-slate-500 ring-slate-200",
};

function StatePill({ state }) {
  return (
    <span className={cx("inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", STATE_TONE[state])}>
      {label(state)}
    </span>
  );
}

/** ISO instant -> YYYY-MM-DD in IST, for a date input. */
const toISTDate = (iso) => (iso ? new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10) : "");
/** Date input -> start / end of that day in IST. */
const fromISTDate = (day, end = false) => (day ? `${day}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30` : null);

const blank = {
  code: "",
  title: "",
  description: "",
  discountType: "percentage",
  discountValue: "",
  maxDiscount: "",
  minBookingAmount: "",
  validFrom: "",
  validTo: "",
  usageLimit: "",
  perUserLimit: "",
  firstBookingOnly: false,
  funding: "platform",
  propertyIds: [],
  propertyTypes: [],
  isActive: true,
};

const formOf = (o) =>
  o
    ? {
        code: o.code,
        title: o.title || "",
        description: o.description || "",
        discountType: o.discountType,
        discountValue: String(o.discountValue ?? ""),
        maxDiscount: o.maxDiscount != null ? String(o.maxDiscount) : "",
        minBookingAmount: o.minBookingAmount ? String(o.minBookingAmount) : "",
        validFrom: toISTDate(o.validFrom),
        validTo: toISTDate(o.validTo),
        usageLimit: o.usageLimit ? String(o.usageLimit) : "",
        perUserLimit: o.perUserLimit ? String(o.perUserLimit) : "",
        firstBookingOnly: Boolean(o.firstBookingOnly),
        funding: o.funding || "platform",
        propertyIds: o.propertyIds || [],
        propertyTypes: o.propertyTypes || [],
        isActive: Boolean(o.isActive),
      }
    : { ...blank };

const numOrNull = (v) => (String(v).trim() === "" ? null : Number(v));

const validate = (f) => {
  const e = {};
  if (!/^[A-Z0-9_-]{3,30}$/.test(f.code.trim().toUpperCase())) e.code = "3–30 letters, digits, - or _.";
  const v = Number(f.discountValue);
  if (!(v > 0)) e.discountValue = "Enter a discount above 0.";
  else if (f.discountType === "percentage" && v > 100) e.discountValue = "A percentage cannot be more than 100.";
  for (const k of ["maxDiscount", "minBookingAmount", "usageLimit", "perUserLimit"]) {
    if (String(f[k]).trim() !== "" && !(Number(f[k]) >= 0)) e[k] = "Enter 0 or more.";
  }
  if (f.validFrom && f.validTo && f.validTo < f.validFrom) e.validTo = "Must be on or after the start date.";
  if (f.funding === "partner" && !f.propertyIds.length) e.propertyIds = "A hotel-funded coupon must be limited to specific properties.";
  return e;
};

const payloadOf = (f) => ({
  code: f.code.trim().toUpperCase(),
  title: f.title.trim(),
  description: f.description.trim(),
  discountType: f.discountType,
  discountValue: Number(f.discountValue),
  maxDiscount: f.discountType === "percentage" ? numOrNull(f.maxDiscount) : null,
  minBookingAmount: Number(f.minBookingAmount) || 0,
  validFrom: fromISTDate(f.validFrom),
  validTo: fromISTDate(f.validTo, true),
  usageLimit: numOrNull(f.usageLimit),
  perUserLimit: numOrNull(f.perUserLimit),
  firstBookingOnly: f.firstBookingOnly,
  funding: f.funding,
  propertyIds: f.propertyIds,
  propertyTypes: f.propertyTypes,
  isActive: f.isActive,
});

function Check({ checked, onChange, children }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--ha-ink)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--ha-navy)]" />
      <span>{children}</span>
    </label>
  );
}

const selectCls =
  "mt-1.5 w-full rounded-lg border border-[var(--ha-border)] bg-white px-3 py-2 text-sm text-[var(--ha-ink)] focus:border-[var(--ha-navy)] focus:outline-none focus:ring-2 focus:ring-[var(--ha-navy)]/20";

function OfferDialog({ open, offer, properties, onSave, onClose }) {
  const [form, setForm] = useState(() => formOf(offer));
  const [touched, setTouched] = useState(false);
  const [propQuery, setPropQuery] = useState("");
  const [lastKey, setLastKey] = useState(null);
  const key = open ? offer?._id || "new" : null;
  if (key !== lastKey) {
    // Reset the form whenever the dialog opens for a different coupon.
    setLastKey(key);
    setForm(formOf(offer));
    setTouched(false);
    setPropQuery("");
  }

  const errors = validate(form);
  const err = (k) => (touched ? errors[k] : undefined);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const toggleIn = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const shownProps = properties.filter((p) => !propQuery || String(p.name || "").toLowerCase().includes(propQuery.toLowerCase()));

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length) throw new Error("invalid");
    await onSave(payloadOf(form));
  };

  return (
    <FormDialog
      open={open}
      title={offer ? `Edit ${offer.code}` : "New hotel coupon"}
      submitLabel={offer ? "Save changes" : "Create coupon"}
      onSubmit={submit}
      onClose={onClose}
    >
      <DialogField label="Code" required value={form.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} error={err("code")} maxLength={30} placeholder="STAY20" hint="Customers type this at checkout." />
      <DialogField label="Title" value={form.title} onChange={set("title")} maxLength={80} placeholder="20% off your stay" />
      <DialogField label="Description" textarea rows={2} value={form.description} onChange={set("description")} maxLength={500} />

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-semibold text-[var(--ha-ink)]">Discount type</span>
          <select value={form.discountType} onChange={set("discountType")} className={selectCls}>
            <option value="percentage">Percentage</option>
            <option value="flat">Flat amount</option>
          </select>
        </label>
        <DialogField
          label={form.discountType === "percentage" ? "Percent off" : "Amount off (₹)"}
          required
          type="number"
          min="0"
          step="any"
          value={form.discountValue}
          onChange={set("discountValue")}
          error={err("discountValue")}
        />
        {form.discountType === "percentage" && (
          <DialogField label="Max discount (₹)" type="number" min="0" value={form.maxDiscount} onChange={set("maxDiscount")} error={err("maxDiscount")} hint="Empty = no cap" />
        )}
        <DialogField label="Min booking (₹)" type="number" min="0" value={form.minBookingAmount} onChange={set("minBookingAmount")} error={err("minBookingAmount")} hint="Before taxes" />
        <DialogField label="Valid from" type="date" value={form.validFrom} onChange={set("validFrom")} hint="Empty = now" />
        <DialogField label="Valid until" type="date" value={form.validTo} onChange={set("validTo")} error={err("validTo")} hint="Inclusive; empty = no end" />
        <DialogField label="Total uses" type="number" min="0" value={form.usageLimit} onChange={set("usageLimit")} error={err("usageLimit")} hint="Empty = unlimited" />
        <DialogField label="Uses per customer" type="number" min="0" value={form.perUserLimit} onChange={set("perUserLimit")} error={err("perUserLimit")} hint="Empty = unlimited" />
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-[var(--ha-ink)]">Who pays for the discount</span>
        <select value={form.funding} onChange={set("funding")} className={selectCls}>
          <option value="platform">KSG (hotel is paid the full price)</option>
          <option value="partner">The hotel (comes off its earnings)</option>
        </select>
      </label>

      <div>
        <p className="text-sm font-semibold text-[var(--ha-ink)]">Property types</p>
        <p className="text-xs text-[var(--ha-ink-faint)]">None ticked = every type.</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {PROPERTY_TYPES.map((t) => (
            <Check key={t} checked={form.propertyTypes.includes(t)} onChange={() => toggleIn("propertyTypes", t)}>
              {label(t)}
            </Check>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-[var(--ha-ink)]">
          Properties {form.propertyIds.length > 0 && <span className="font-normal text-[var(--ha-ink-faint)]">({form.propertyIds.length} selected)</span>}
        </p>
        <p className="text-xs text-[var(--ha-ink-faint)]">None ticked = every property.</p>
        {properties.length > 8 && (
          <input
            type="search"
            value={propQuery}
            onChange={(e) => setPropQuery(e.target.value)}
            placeholder="Find a property"
            className="mt-2 w-full rounded-lg border border-[var(--ha-border)] px-3 py-1.5 text-sm"
          />
        )}
        <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-[var(--ha-border)] p-2">
          {shownProps.length === 0 ? (
            <p className="text-xs text-[var(--ha-ink-faint)]">No approved properties.</p>
          ) : (
            shownProps.map((p) => (
              <Check key={p._id} checked={form.propertyIds.includes(p._id)} onChange={() => toggleIn("propertyIds", p._id)}>
                {p.name || "Untitled"} <span className="text-xs text-[var(--ha-ink-faint)]">· {p.address?.city || label(p.propertyType)}</span>
              </Check>
            ))
          )}
        </div>
        {err("propertyIds") && <p className="mt-1 text-xs text-red-600">{err("propertyIds")}</p>}
      </div>

      <div className="space-y-2">
        <Check checked={form.firstBookingOnly} onChange={(v) => setForm((f) => ({ ...f, firstBookingOnly: v }))}>
          Only for a customer's first hotel booking
        </Check>
        <Check checked={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}>
          Active
        </Check>
      </div>
    </FormDialog>
  );
}

function validity(o) {
  if (o.validFrom && o.validTo) return `${formatDate(o.validFrom)} – ${formatDate(o.validTo)}`;
  if (o.validTo) return `Until ${formatDate(o.validTo)}`;
  if (o.validFrom) return `From ${formatDate(o.validFrom)}`;
  return "No end date";
}

export default function OffersList() {
  const [params, update] = useListParams({ state: "live", q: "", page: 1 });
  const [editing, setEditing] = useState(null); // { offer|null }
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState("");

  const { data: propData } = useLoad(() => hotelAdmin.properties({ status: "approved", limit: 100 }).catch(() => null), []);
  const properties = pageOf(propData).items;
  const names = useMemo(() => Object.fromEntries(properties.map((p) => [p._id, p.name])), [properties]);

  const { data, loading, error, reload } = useLoad(
    () => hotelAdmin.offers({ state: params.state, q: params.q, page: params.page, limit: LIMIT }),
    [params.state, params.q, params.page],
  );
  const list = pageOf(data);
  const counts = data?.counts ? { ...data.counts, all: Object.values(data.counts).reduce((a, b) => a + b, 0) } : undefined;

  const save = async (payload) => {
    try {
      if (editing?.offer) {
        await hotelAdmin.updateOffer(editing.offer._id, payload);
        toast.success(`${payload.code} saved`);
      } else {
        await hotelAdmin.createOffer(payload);
        toast.success(`${payload.code} created`);
      }
      reload();
    } catch (err) {
      toast.error(err?.message || "Could not save the coupon");
      throw err;
    }
  };

  const setActive = async (o, isActive) => {
    setBusy(o._id);
    try {
      await hotelAdmin.updateOffer(o._id, { isActive });
      toast.success(isActive ? `${o.code} is active` : `${o.code} paused`);
      reload();
    } catch (err) {
      toast.error(err?.message || "Could not change the coupon");
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    try {
      await hotelAdmin.deleteOffer(deleting._id);
      toast.success(`${deleting.code} deleted`);
      reload();
    } catch (err) {
      toast.error(err?.message || "Could not delete the coupon");
      throw err;
    }
  };

  const where = (o) => {
    if (o.propertyIds?.length) {
      const shown = o.propertyIds.map((id) => names[id]).filter(Boolean);
      return shown.length === 1 ? shown[0] : `${o.propertyIds.length} properties`;
    }
    if (o.propertyTypes?.length) return o.propertyTypes.map(label).join(", ");
    return "All properties";
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Offers"
        subtitle="Coupon codes guests can apply at checkout. They also appear in Master › Coupons."
        actions={
          <Button tone="primary" icon={Plus} onClick={() => setEditing({ offer: null })}>
            New coupon
          </Button>
        }
      />

      <Card bodyClassName="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ha-border)] p-3">
          <StatusTabs tabs={TABS} value={params.state} onChange={(state) => update({ state })} counts={counts} />
          <SearchInput value={params.q} onChange={(q) => update({ q })} placeholder="Search code or title" className="w-full sm:w-64" />
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <TableSkeleton cols={5} />
        ) : list.items.length === 0 ? (
          <EmptyState icon={TicketPercent} title={params.q ? "No coupon matches" : "No coupons here"} message={params.state === "live" ? "Create one with New coupon." : undefined} />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <ul className="divide-y divide-[var(--ha-border)]">
              {list.items.map((o) => (
                <li key={o._id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-dashed border-[var(--ha-saffron)] bg-[var(--ha-hover)] px-2 py-0.5 font-mono text-sm font-bold text-[var(--ha-ink)]">
                        {o.code}
                      </span>
                      <StatePill state={o.state} />
                      <span className="text-sm font-semibold text-[var(--ha-ink)]">{o.summary}</span>
                    </div>
                    {o.title && <p className="mt-1 text-sm text-[var(--ha-ink-soft)]">{o.title}</p>}
                    <p className="mt-1 text-xs text-[var(--ha-ink-faint)]">
                      {where(o)}
                      {o.minBookingAmount > 0 && <> · min {money(o.minBookingAmount)}</>}
                      {o.firstBookingOnly && <> · first booking only</>}
                      {" · "}
                      {o.funding === "partner" ? "hotel-funded" : "KSG-funded"}
                      {" · "}
                      {validity(o)}
                    </p>
                  </div>
                  <div className="shrink-0 text-sm text-[var(--ha-ink-soft)] md:w-36 md:text-right">
                    <span className="font-bold tabular-nums text-[var(--ha-ink)]">{o.usedCount}</span>
                    {" / "}
                    {o.effectiveUsageLimit ?? "∞"} used
                    {o.effectivePerUserLimit ? <span className="block text-xs text-[var(--ha-ink-faint)]">{o.effectivePerUserLimit} per customer</span> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button icon={Pencil} onClick={() => setEditing({ offer: o })}>
                      Edit
                    </Button>
                    {o.state !== "expired" &&
                      (o.isActive ? (
                        <Button icon={Pause} busy={busy === o._id} onClick={() => setActive(o, false)}>
                          Pause
                        </Button>
                      ) : (
                        <Button tone="success" icon={Play} busy={busy === o._id} onClick={() => setActive(o, true)}>
                          Activate
                        </Button>
                      ))}
                    <Button tone="ghost" icon={Trash2} aria-label={`Delete ${o.code}`} onClick={() => setDeleting(o)} className="text-red-600" />
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={list.page} limit={list.limit} total={list.total} onPage={(page) => update({ page })} />
          </div>
        )}
      </Card>

      <OfferDialog open={Boolean(editing)} offer={editing?.offer || null} properties={properties} onSave={save} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={deleting ? `Delete ${deleting.code}?` : ""}
        message="Only a coupon that has never been used can be deleted. A used one can be paused instead."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
