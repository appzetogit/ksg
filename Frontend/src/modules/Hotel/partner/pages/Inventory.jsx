import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  Ban,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  IndianRupee,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import { usePartner } from "../lib/PartnerContext";
import { BASE_PATH, BLOCK_SOURCE_LABELS, labelOf } from "../lib/constants";
import {
  addDays,
  asList,
  formatDate,
  fromYmd,
  money,
  nightsBetween,
  num,
  onlyDigits,
  serverYmd,
  toYmd,
  todayYmd,
} from "../lib/utils";
import {
  Button,
  Card,
  EmptyState,
  InlineError,
  LinkButton,
  Modal,
  PageHeader,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
  cx,
  useConfirm,
} from "../components/ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BLOCK_SOURCES = ["walk_in", "external", "manual_block"];

const monthStart = (ym) => `${ym}-01`;
const monthEnd = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return toYmd(new Date(y, m, 0));
};
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const shortMoney = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  if (v >= 100000) return `₹${(v / 100000).toFixed(1).replace(/\.0$/, "")}L`;
  if (v >= 10000) return `₹${Math.round(v / 1000)}k`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `₹${Math.round(v)}`;
};

// ── Block form ─────────────────────────────────────────────────────────────

function BlockModal({ open, onClose, roomTypes, defaults, onSaved }) {
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm({
      roomTypeId: defaults.roomTypeId || roomTypes[0]?._id || "",
      source: "walk_in",
      startDate: defaults.startDate || todayYmd(),
      endDate: defaults.endDate || addDays(defaults.startDate || todayYmd(), 1),
      units: "1",
      externalPlatform: "",
      externalReference: "",
      notes: "",
    });
    setErrors({});
    setServerError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((x) => ({ ...x, [key]: undefined }));
  };

  const save = async () => {
    const e = {};
    if (!form.roomTypeId) e.roomTypeId = "Choose a room type";
    if (!form.startDate) e.startDate = "Choose a date";
    if (!form.endDate || form.endDate <= form.startDate) e.endDate = "Must be after check-in";
    if (num(form.units, 0) < 1) e.units = "At least 1";
    if (form.source === "external" && !form.externalPlatform.trim()) e.externalPlatform = "Which site? e.g. Booking.com";
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    setSaving(true);
    setServerError("");
    try {
      const body = {
        roomTypeId: form.roomTypeId,
        source: form.source,
        startDate: form.startDate,
        endDate: form.endDate,
        units: num(form.units, 1),
        ...(form.source === "external"
          ? { externalPlatform: form.externalPlatform.trim(), externalReference: form.externalReference.trim() || undefined }
          : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      };
      await partnerApi.post("/partner/inventory/blocks", body);
      toast.success("Rooms blocked");
      onSaved();
      onClose();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const nights = form.startDate && form.endDate > form.startDate ? nightsBetween(form.startDate, form.endDate) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Block rooms"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Block {nights ? `${nights} night${nights > 1 ? "s" : ""}` : "rooms"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Record a walk-in guest, a booking from another site, or rooms you want to keep off sale. Blocked rooms are taken
          out of what guests can book on KSG.
        </p>
        <SelectField
          label="Room type"
          required
          options={roomTypes.map((r) => [r._id, r.name])}
          value={form.roomTypeId || ""}
          onChange={set("roomTypeId")}
          error={errors.roomTypeId}
        />
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Reason">
          {BLOCK_SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={form.source === s}
              onClick={() => set("source")(s)}
              className={cx(
                "rounded-xl border-2 px-2 py-2.5 text-xs font-semibold transition",
                form.source === s ? "border-[#FF7A00] bg-orange-50 text-[#E85D04]" : "border-slate-200 text-slate-600 hover:border-slate-300",
              )}
            >
              {labelOf(BLOCK_SOURCE_LABELS, s)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Check-in"
            type="date"
            required
            min={todayYmd()}
            value={form.startDate || ""}
            onChange={set("startDate")}
            error={errors.startDate}
          />
          <TextField
            label="Check-out"
            type="date"
            required
            min={form.startDate ? addDays(form.startDate, 1) : todayYmd()}
            value={form.endDate || ""}
            onChange={set("endDate")}
            error={errors.endDate}
          />
        </div>
        <TextField
          label="Units"
          required
          inputMode="numeric"
          value={form.units || ""}
          onChange={(e) => set("units")(onlyDigits(e.target.value, 3))}
          error={errors.units}
          hint="Rooms or beds to block each night"
        />
        {form.source === "external" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Booked on"
              required
              placeholder="Booking.com, MakeMyTrip…"
              value={form.externalPlatform}
              onChange={set("externalPlatform")}
              error={errors.externalPlatform}
            />
            <TextField label="Booking reference" optional value={form.externalReference} onChange={set("externalReference")} />
          </div>
        )}
        <TextAreaField label="Notes" optional rows={2} maxLength={500} value={form.notes || ""} onChange={set("notes")} />
        <InlineError message={serverError} />
      </div>
    </Modal>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Inventory() {
  const { isApproved } = usePartner();
  const [search, setSearch] = useSearchParams();
  const [properties, setProperties] = useState(null);
  const [propertyId, setPropertyId] = useState(search.get("propertyId") || "");
  const [roomTypes, setRoomTypes] = useState([]);
  const [roomTypeId, setRoomTypeId] = useState("");
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [month, setMonth] = useState(() => todayYmd().slice(0, 7));
  const [days, setDays] = useState(null);
  const [daysError, setDaysError] = useState(null);
  const [blocks, setBlocks] = useState(null);
  const [range, setRange] = useState({ from: "", to: "" });
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState("");
  const [blockOpen, setBlockOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  // properties
  useEffect(() => {
    partnerApi
      .get("/partner/properties")
      .then((d) => {
        const list = asList(d, "properties");
        setProperties(list);
        setPropertyId((cur) => {
          if (cur && list.some((p) => p._id === cur)) return cur;
          return (list.find((p) => p.status === "approved") || list[0])?._id || "";
        });
      })
      .catch((e) => {
        toast.error(e.message);
        setProperties([]);
      });
  }, []);

  // room types of the chosen property
  useEffect(() => {
    if (!propertyId) return;
    setRoomTypes([]);
    setRoomTypeId("");
    setDays(null);
    setRoomsLoading(true);
    partnerApi
      .get(`/partner/properties/${propertyId}`)
      .then((d) => {
        const active = (d?.roomTypes || []).filter((r) => r.isActive !== false);
        setRoomTypes(active);
        setRoomTypeId(active[0]?._id || "");
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setRoomsLoading(false));
    setSearch({ propertyId }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const from = monthStart(month);
  const to = monthEnd(month);

  const loadDays = useCallback(async () => {
    if (!propertyId || !roomTypeId) return;
    setDaysError(null);
    try {
      const d = await partnerApi.get("/partner/inventory", { propertyId, roomTypeId, from, to });
      setDays(asList(d, "days"));
    } catch (e) {
      setDaysError(e);
      setDays([]);
    }
  }, [propertyId, roomTypeId, from, to]);

  const loadBlocks = useCallback(async () => {
    if (!propertyId) return;
    try {
      const d = await partnerApi.get("/partner/inventory/blocks", { propertyId, from, to: addDays(to, 1) });
      setBlocks(asList(d, "blocks"));
    } catch {
      setBlocks([]);
    }
  }, [propertyId, from, to]);

  useEffect(() => {
    setDays(null);
    loadDays();
  }, [loadDays]);

  useEffect(() => {
    setBlocks(null);
    loadBlocks();
  }, [loadBlocks]);

  const byDate = useMemo(() => {
    const map = {};
    (days || []).forEach((d) => {
      map[serverYmd(d.date)] = d;
    });
    return map;
  }, [days]);

  // the month grid, Monday first
  const cells = useMemo(() => {
    const first = fromYmd(from);
    const lead = (first.getDay() + 6) % 7;
    const count = Number(to.slice(8, 10));
    const out = Array.from({ length: lead }, () => null);
    for (let i = 0; i < count; i += 1) out.push(addDays(from, i));
    while (out.length % 7) out.push(null);
    return out;
  }, [from, to]);

  const today = todayYmd();
  const selecting = range.from && !range.to;
  const inRange = (ymd) => range.from && ymd >= range.from && ymd <= (range.to || range.from);

  const pick = (ymd) => {
    if (ymd < today) return;
    if (!range.from || range.to) setRange({ from: ymd, to: "" });
    else if (ymd < range.from) setRange({ from: ymd, to: range.from });
    else setRange({ from: range.from, to: ymd });
  };

  const sel = range.from ? { from: range.from, to: range.to || range.from } : null;
  const selNights = sel ? nightsBetween(sel.from, sel.to) + 1 : 0;

  const apply = async (kind) => {
    if (!sel) return;
    const body = { roomTypeId, from: sel.from, to: sel.to };
    if (kind === "price") {
      const v = num(price);
      if (!v || v <= 0) {
        toast.error("Enter a price per night.");
        return;
      }
      body.priceOverride = v;
    }
    if (kind === "clear") body.priceOverride = null;
    if (kind === "close") {
      const ok = await confirm({
        title: "Stop selling these nights?",
        message: `Guests will not be able to book this room type for ${selNights} night${selNights > 1 ? "s" : ""} (${formatDate(sel.from)} – ${formatDate(sel.to)}). Existing bookings stay.`,
        confirmLabel: "Stop sell",
        danger: true,
      });
      if (!ok) return;
      body.closed = true;
    }
    if (kind === "open") body.closed = false;
    setBusy(kind);
    try {
      await partnerApi.put("/partner/inventory", body);
      toast.success(
        kind === "price" ? "Price updated" : kind === "clear" ? "Back to the standard price" : kind === "close" ? "Stopped selling" : "Open for sale",
      );
      setPrice("");
      setRange({ from: "", to: "" });
      loadDays();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  };

  const deleteBlock = async (b) => {
    const ok = await confirm({
      title: "Release this block?",
      message: `${b.units} unit${b.units > 1 ? "s" : ""} from ${formatDate(b.startDate)} to ${formatDate(b.endDate)} will be available to book again.`,
      confirmLabel: "Release",
      danger: true,
    });
    if (!ok) return;
    try {
      await partnerApi.del(`/partner/inventory/blocks/${b._id}`);
      toast.success("Block released");
      loadBlocks();
      loadDays();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const roomName = (rid) => roomTypes.find((r) => r._id === rid)?.name || "Room type";
  const property = (properties || []).find((p) => p._id === propertyId);
  const notApproved = daysError?.status === 403;

  // ── empty states ──
  if (properties && properties.length === 0) {
    return (
      <div>
        <PageHeader title="Inventory" subtitle="Prices and availability, night by night." />
        <EmptyState
          icon={CalendarRange}
          title="No properties yet"
          text="Add a property and get it approved to manage its calendar here."
          action={<LinkButton to={`${BASE_PATH}/properties/new`} icon={Plus}>Add property</LinkButton>}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Prices and availability, night by night." />

      {!isApproved && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          The calendar is available once your partner account is verified.
        </div>
      )}

      {/* pickers */}
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2">
        {!properties ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : (
          <>
            <SelectField
              label="Property"
              options={properties.map((p) => [p._id, `${p.name || "Untitled"}${p.status !== "approved" ? ` (${p.status})` : ""}`])}
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setRange({ from: "", to: "" });
              }}
            />
            <SelectField
              label="Room type"
              options={roomTypes.map((r) => [r._id, r.name])}
              placeholder={roomTypes.length ? undefined : "No room types"}
              value={roomTypeId}
              onChange={(e) => {
                setRoomTypeId(e.target.value);
                setRange({ from: "", to: "" });
              }}
              disabled={!roomTypes.length}
            />
          </>
        )}
      </Card>

      {property && property.status !== "approved" && (
        <p className="mb-4 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
          This property is not approved yet, so guests cannot book it. You can still plan its calendar if the server allows.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* calendar */}
        <Card className="p-3 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              disabled={month <= today.slice(0, 7)}
              aria-label="Previous month"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="text-base font-semibold text-slate-900">
              {fromYmd(from).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </h2>
            <button
              type="button"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              aria-label="Next month"
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {notApproved ? (
            <EmptyState icon={Lock} title="Calendar locked" text={daysError.message} />
          ) : daysError ? (
            <InlineError message={daysError.message} onRetry={loadDays} />
          ) : roomsLoading || !properties ? (
            <Skeleton className="h-72" />
          ) : !roomTypeId ? (
            <EmptyState
              icon={CalendarRange}
              title="No room types"
              text="Add a room type to this property to manage its calendar."
              action={
                propertyId && (
                  <LinkButton to={`${BASE_PATH}/properties/${propertyId}/edit?step=rooms`} variant="secondary">
                    Add room type
                  </LinkButton>
                )
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1">
                    {w}
                  </div>
                ))}
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${month}-${roomTypeId}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="grid grid-cols-7 gap-1"
                  role="grid"
                  aria-label="Inventory calendar"
                >
                  {cells.map((ymd, i) => {
                    if (!ymd) return <div key={`e-${i}`} />;
                    if (!days) return <Skeleton key={ymd} className="aspect-square sm:aspect-[4/3.6]" />;
                    const d = byDate[ymd];
                    const past = ymd < today;
                    const closed = d?.closed;
                    const soldOut = d && !closed && Number(d.available) <= 0;
                    const selected = inRange(ymd);
                    return (
                      <button
                        key={ymd}
                        type="button"
                        role="gridcell"
                        aria-selected={Boolean(selected)}
                        aria-label={`${formatDate(ymd)}: ${
                          d ? (closed ? "closed" : `${d.available} of ${d.capacity} available, ${money(d.price)}`) : "no data"
                        }`}
                        disabled={past}
                        onClick={() => pick(ymd)}
                        className={cx(
                          "relative flex aspect-square flex-col items-start rounded-lg border p-1 text-left transition sm:aspect-[4/3.6] sm:p-1.5",
                          past && "cursor-not-allowed opacity-40",
                          selected
                            ? "border-[#0B2A6F] bg-[#0B2A6F] text-white"
                            : closed
                              ? "border-slate-200 bg-[repeating-linear-gradient(135deg,#f1f5f9_0_6px,#e2e8f0_6px_8px)] text-slate-500"
                              : soldOut
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-slate-200 bg-white text-slate-800 hover:border-[#FF7A00]",
                          ymd === today && !selected && "ring-2 ring-[#FF7A00]/60",
                        )}
                      >
                        <span className="text-[11px] font-semibold sm:text-xs">{Number(ymd.slice(8))}</span>
                        {d && (
                          <>
                            <span
                              className={cx(
                                "mt-auto text-[10px] font-semibold leading-tight sm:text-xs",
                                !selected && d.priceOverride != null && "text-[#E85D04]",
                              )}
                            >
                              {closed ? (
                                <span className="inline-flex items-center gap-0.5">
                                  <Ban className="h-3 w-3" />
                                  <span className="hidden sm:inline">Closed</span>
                                </span>
                              ) : (
                                shortMoney(d.price)
                              )}
                            </span>
                            {!closed && (
                              <span className={cx("text-[9px] leading-tight sm:text-[11px]", selected ? "text-blue-100" : "text-slate-500")}>
                                {d.available}/{d.capacity}
                                <span className="hidden sm:inline"> left</span>
                              </span>
                            )}
                            {Number(d.booked) > 0 && (
                              <span
                                className={cx(
                                  "absolute right-1 top-1 rounded px-1 text-[9px] font-bold",
                                  selected ? "bg-white/20 text-white" : "bg-blue-50 text-[#0B2A6F]",
                                )}
                                title={`${d.booked} booked`}
                              >
                                {d.booked}
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#E85D04]" /> Price changed
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-rose-200" /> Sold out
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" /> Closed (stop-sell)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="rounded bg-blue-50 px-1 text-[9px] font-bold text-[#0B2A6F]">2</span> Booked
                </span>
                <span>left = available / total</span>
              </div>
            </>
          )}
        </Card>

        {/* actions */}
        <div className="space-y-4">
          <Card className="p-4 lg:sticky lg:top-6">
            <h3 className="text-sm font-semibold text-slate-900">Update nights</h3>
            {!sel ? (
              <p className="mt-2 text-sm text-slate-500">
                Tap a start date, then an end date, to select nights.
              </p>
            ) : (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2 text-sm text-[#0B2A6F]">
                  <span>
                    {formatDate(sel.from, { day: "numeric", month: "short" })}
                    {sel.to !== sel.from && ` – ${formatDate(sel.to, { day: "numeric", month: "short" })}`} · {selNights} night
                    {selNights > 1 ? "s" : ""}
                    {selecting && <span className="block text-xs opacity-70">Tap another date to extend</span>}
                  </span>
                  <button
                    type="button"
                    aria-label="Clear selection"
                    onClick={() => setRange({ from: "", to: "" })}
                    className="rounded-md p-1 hover:bg-blue-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <TextField
                    label="Price per night"
                    className="flex-1"
                    prefix="₹"
                    inputMode="decimal"
                    placeholder="e.g. 2499"
                    value={price}
                    onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                  <div className="flex items-end">
                    <Button variant="navy" onClick={() => apply("price")} loading={busy === "price"} disabled={Boolean(busy)} icon={IndianRupee}>
                      Set
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <Button variant="secondary" onClick={() => apply("clear")} loading={busy === "clear"} disabled={Boolean(busy)} icon={RotateCcw}>
                    Use standard price
                  </Button>
                  <Button variant="secondary" onClick={() => apply("open")} loading={busy === "open"} disabled={Boolean(busy)} icon={CalendarRange}>
                    Open for sale
                  </Button>
                  <Button variant="danger" onClick={() => apply("close")} loading={busy === "close"} disabled={Boolean(busy)} icon={CircleSlash}>
                    Stop sell
                  </Button>
                </div>
              </motion.div>
            )}
          </Card>
        </div>
      </div>

      {/* blocks */}
      <Card className="mt-4 p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Blocks this month</h2>
            <p className="text-xs text-slate-500">Walk-ins, bookings from other sites, and rooms you held back.</p>
          </div>
          <Button
            size="sm"
            icon={Plus}
            onClick={() => setBlockOpen(true)}
            disabled={!roomTypes.length || notApproved}
          >
            Block rooms
          </Button>
        </div>
        {!blocks ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : blocks.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">No blocks in this month.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {blocks.map((b) => (
              <li key={b._id} className="flex items-start gap-3 py-3">
                <span
                  className={cx(
                    "mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    b.source === "walk_in"
                      ? "bg-green-50 text-green-700"
                      : b.source === "external"
                        ? "bg-violet-50 text-violet-700"
                        : b.source === "platform"
                          ? "bg-blue-50 text-[#0B2A6F]"
                          : "bg-slate-100 text-slate-700",
                  )}
                >
                  {labelOf(BLOCK_SOURCE_LABELS, b.source)}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-slate-800">
                    {roomName(b.roomTypeId?._id || b.roomTypeId)} · {b.units} unit{b.units > 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(b.startDate, { day: "numeric", month: "short" })} → {formatDate(b.endDate, { day: "numeric", month: "short" })}
                    {b.externalPlatform && ` · ${b.externalPlatform}`}
                    {b.externalReference && ` #${b.externalReference}`}
                  </p>
                  {b.notes && <p className="mt-0.5 text-xs text-slate-500">{b.notes}</p>}
                </div>
                {BLOCK_SOURCES.includes(b.source) && (
                  <button
                    type="button"
                    aria-label="Release block"
                    onClick={() => deleteBlock(b)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <BlockModal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        roomTypes={roomTypes}
        defaults={{
          roomTypeId,
          startDate: sel?.from,
          endDate: sel ? addDays(sel.to, 1) : undefined,
        }}
        onSaved={() => {
          loadBlocks();
          loadDays();
        }}
      />
      {confirmDialog}
    </div>
  );
}
