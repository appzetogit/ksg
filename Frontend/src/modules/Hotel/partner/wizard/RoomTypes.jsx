import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { BedDouble, Check, ImageOff, PencilLine, Plus, Trash2, Users } from "lucide-react";
import { partnerApi } from "../../shared/hotelApi";
import {
  INVENTORY_TYPE_LABELS,
  INVENTORY_UNIT,
  MEAL_PLAN_LABELS,
  ROOM_CATEGORY_FOR,
  labelOf,
} from "../lib/constants";
import { compact, money, num, onlyDigits } from "../lib/utils";
import { Button, Chip, EmptyState, Field, InlineError, Modal, SelectField, TextAreaField, TextField, cx, useConfirm } from "../components/ui";
import { PhotoGrid } from "../components/uploads";

const MIN_ROOM_PHOTOS = 3;

const blank = (inventoryType) => ({
  name: "",
  description: "",
  inventoryType,
  baseAdults: "2",
  baseChildren: "0",
  maxAdults: "2",
  maxChildren: "1",
  bedsPerRoom: "1",
  totalInventory: inventoryType === "entire" ? "1" : "",
  pricePerNight: "",
  originalPrice: "",
  weekendPrice: "",
  extraAdultPrice: "0",
  extraChildPrice: "0",
  mealPlan: "room_only",
  images: [],
  amenities: [],
});

const toForm = (r) => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  return {
    name: r.name || "",
    description: r.description || "",
    inventoryType: r.inventoryType,
    baseAdults: s(r.baseAdults),
    baseChildren: s(r.baseChildren),
    maxAdults: s(r.maxAdults),
    maxChildren: s(r.maxChildren),
    bedsPerRoom: s(r.bedsPerRoom || 1),
    totalInventory: s(r.totalInventory),
    pricePerNight: s(r.pricePerNight),
    originalPrice: s(r.originalPrice),
    weekendPrice: s(r.weekendPrice),
    extraAdultPrice: s(r.extraAdultPrice),
    extraChildPrice: s(r.extraChildPrice),
    mealPlan: r.mealPlan || "room_only",
    images: [...(r.images || [])],
    amenities: [...(r.amenities || [])],
  };
};

const validate = (f) => {
  const e = {};
  if (!f.name.trim()) e.name = "Name this room type, e.g. Deluxe Double";
  if (!f.inventoryType) e.inventoryType = "Choose what you rent out";
  const maxA = num(f.maxAdults, 0);
  if (maxA < 1) e.maxAdults = "At least 1";
  if (num(f.baseAdults, 0) > maxA) e.baseAdults = "Cannot be more than max adults";
  if (num(f.baseChildren, 0) > num(f.maxChildren, 0)) e.baseChildren = "Cannot be more than max children";
  if (num(f.totalInventory, 0) < 1) e.totalInventory = "At least 1";
  const price = num(f.pricePerNight, 0);
  if (price <= 0) e.pricePerNight = "Enter the nightly price";
  if (f.originalPrice && num(f.originalPrice, 0) < price) e.originalPrice = "Should be at least the selling price";
  if (f.images.length < MIN_ROOM_PHOTOS) e.images = `Add at least ${MIN_ROOM_PHOTOS} photos of this room`;
  return e;
};

const toPayload = (f) =>
  compact({
    name: f.name,
    description: f.description,
    inventoryType: f.inventoryType,
    roomCategory: ROOM_CATEGORY_FOR[f.inventoryType],
    baseAdults: num(f.baseAdults, 1),
    baseChildren: num(f.baseChildren, 0),
    maxAdults: num(f.maxAdults, 1),
    maxChildren: num(f.maxChildren, 0),
    bedsPerRoom: f.inventoryType === "bed" ? num(f.bedsPerRoom, 1) : 1,
    totalInventory: f.inventoryType === "entire" ? 1 : num(f.totalInventory, 1),
    pricePerNight: num(f.pricePerNight, 0),
    originalPrice: num(f.originalPrice),
    weekendPrice: num(f.weekendPrice),
    extraAdultPrice: num(f.extraAdultPrice, 0),
    extraChildPrice: num(f.extraChildPrice, 0),
    mealPlan: f.mealPlan,
    images: f.images,
    amenities: f.amenities,
  });

const money2 = (v) => v.replace(/[^\d.]/g, "").replace(/(\.\d{0,2}).*$/, "$1");

function RoomTypeModal({ open, onClose, propertyId, allowed, editing, catalogue, onSaved }) {
  const [form, setForm] = useState(() => blank(allowed[0]));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(editing ? toForm(editing) : blank(allowed[0]));
    setErrors({});
    setServerError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };
  const numInput = (key, { max = 3, decimal = false } = {}) => ({
    value: form[key],
    inputMode: decimal ? "decimal" : "numeric",
    onChange: (e) => set(key)(decimal ? money2(e.target.value) : onlyDigits(e.target.value, max)),
    error: errors[key],
  });

  const save = async () => {
    const found = validate(form);
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setServerError("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    setServerError("");
    try {
      const body = toPayload(form);
      const data = editing
        ? await partnerApi.put(`/partner/properties/${propertyId}/room-types/${editing._id}`, body)
        : await partnerApi.post(`/partner/properties/${propertyId}/room-types`, body);
      const saved = data?.roomType || data || {};
      onSaved({ ...(editing || {}), ...body, ...saved, isActive: saved.isActive ?? true });
      toast.success(editing ? "Room type updated" : "Room type added");
      onClose();
    } catch (e) {
      setServerError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const unit = INVENTORY_UNIT[form.inventoryType] || "rooms";
  const amenities = catalogue.amenities || [];

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={editing ? `Edit ${editing.name}` : "Add a room type"}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {editing ? "Save changes" : "Add room type"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Room type name"
            required
            placeholder={form.inventoryType === "bed" ? "e.g. 6-bed mixed dorm" : "e.g. Deluxe Double Room"}
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
            error={errors.name}
            maxLength={80}
          />
          {allowed.length > 1 ? (
            <SelectField
              label="What do you rent out?"
              required
              options={allowed.map((t) => [t, labelOf(INVENTORY_TYPE_LABELS, t)])}
              value={form.inventoryType}
              onChange={(e) => {
                const t = e.target.value;
                setForm((f) => ({ ...f, inventoryType: t, totalInventory: t === "entire" ? "1" : f.totalInventory }));
              }}
              error={errors.inventoryType}
            />
          ) : (
            <Field label="What you rent out">
              <p className="flex h-11 items-center rounded-xl bg-slate-50 px-3 text-sm text-slate-700">
                {labelOf(INVENTORY_TYPE_LABELS, form.inventoryType)}
              </p>
            </Field>
          )}
          <TextAreaField
            label="Description"
            optional
            className="md:col-span-2"
            rows={3}
            maxLength={1000}
            placeholder="Bed size, view, bathroom, size in sq ft…"
            value={form.description}
            onChange={(e) => set("description")(e.target.value)}
          />
        </div>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Capacity &amp; inventory</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <TextField label="Adults included" {...numInput("baseAdults", { max: 2 })} hint="In the base price" />
            <TextField label="Max adults" required {...numInput("maxAdults", { max: 2 })} />
            <TextField label="Children included" {...numInput("baseChildren", { max: 2 })} />
            <TextField label="Max children" {...numInput("maxChildren", { max: 2 })} />
            {form.inventoryType === "bed" && <TextField label="Beds per room" {...numInput("bedsPerRoom", { max: 2 })} />}
            {form.inventoryType === "entire" ? (
              <Field label="Units" hint="An entire property is rented as one unit.">
                <p className="flex h-11 items-center rounded-xl bg-slate-50 px-3 text-sm text-slate-700">1</p>
              </Field>
            ) : (
              <TextField
                label={`Number of ${unit}`}
                required
                {...numInput("totalInventory", { max: 4 })}
                hint={`How many ${unit} of this type you sell`}
              />
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Prices per night</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <TextField label="Selling price" required prefix="₹" {...numInput("pricePerNight", { decimal: true })} />
            <TextField label="Original (strike-through)" optional prefix="₹" {...numInput("originalPrice", { decimal: true })} />
            <TextField label="Weekend price" optional prefix="₹" hint="Fri & Sat nights" {...numInput("weekendPrice", { decimal: true })} />
            <TextField label="Extra adult" prefix="₹" {...numInput("extraAdultPrice", { decimal: true })} />
            <TextField label="Extra child" prefix="₹" {...numInput("extraChildPrice", { decimal: true })} />
            <SelectField
              label="Meal plan"
              options={(catalogue.mealPlans || []).map((m) => [m, labelOf(MEAL_PLAN_LABELS, m)])}
              value={form.mealPlan}
              onChange={(e) => set("mealPlan")(e.target.value)}
            />
          </div>
        </section>

        <section>
          <PhotoGrid
            label="Room photos"
            images={form.images}
            onChange={set("images")}
            folder="hotel/properties"
            min={MIN_ROOM_PHOTOS}
          />
          {errors.images && <p className="mt-2 text-xs text-rose-600">{errors.images}</p>}
        </section>

        {amenities.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">In-room amenities</h3>
            <div className="flex flex-wrap gap-2">
              {amenities.map((a) => {
                const on = form.amenities.includes(a.key);
                return (
                  <Chip
                    key={a.key}
                    selected={on}
                    onClick={() => set("amenities")(on ? form.amenities.filter((k) => k !== a.key) : [...form.amenities, a.key])}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                    {a.label}
                  </Chip>
                );
              })}
            </div>
          </section>
        )}

        <InlineError message={serverError} />
      </div>
    </Modal>
  );
}

export function RoomTypeCard({ room, onEdit, onDelete }) {
  const unit = INVENTORY_UNIT[room.inventoryType] || "rooms";
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:h-24 sm:w-32">
        {room.images?.[0] ? (
          <img src={room.images[0]} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-slate-300">
            <ImageOff className="h-6 w-6" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="truncate font-semibold text-slate-900">{room.name}</h4>
          {(onEdit || onDelete) && (
            <div className="flex shrink-0 gap-1">
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={`Edit ${room.name}`}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  <PencilLine className="h-4 w-4" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label={`Remove ${room.name}`}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <BedDouble className="h-3.5 w-3.5" /> {room.inventoryType === "entire" ? "Entire property" : `${room.totalInventory} ${unit}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> Up to {room.maxAdults} adults
            {room.maxChildren ? ` + ${room.maxChildren} children` : ""}
          </span>
          <span>{labelOf(MEAL_PLAN_LABELS, room.mealPlan)}</span>
        </p>
        <p className="mt-1.5 text-sm">
          <span className="font-semibold text-slate-900">{money(room.pricePerNight)}</span>
          {room.originalPrice > room.pricePerNight && (
            <span className="ml-1.5 text-xs text-slate-400 line-through">{money(room.originalPrice)}</span>
          )}
          <span className="text-xs text-slate-500"> / night</span>
          {room.weekendPrice > 0 && <span className="ml-2 text-xs text-slate-500">· Weekend {money(room.weekendPrice)}</span>}
        </p>
      </div>
    </div>
  );
}

/** Room types for a property: list + add/edit modal + delete. */
export function RoomsStep({ propertyId, propertyType, roomTypes, setRoomTypes, catalogue, errors }) {
  const allowed = catalogue.inventoryTypesByProperty?.[propertyType] || ["room"];
  const [modal, setModal] = useState({ open: false, editing: null });
  const [confirm, confirmDialog] = useConfirm();
  const active = roomTypes.filter((r) => r.isActive !== false);

  const onSaved = (room) =>
    setRoomTypes((list) => {
      const exists = list.some((r) => r._id === room._id);
      return exists ? list.map((r) => (r._id === room._id ? room : r)) : [...list, room];
    });

  const remove = async (room) => {
    const ok = await confirm({
      title: `Remove ${room.name}?`,
      message: "Guests will no longer be able to book this room type. Existing bookings are not affected.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await partnerApi.del(`/partner/properties/${propertyId}/room-types/${room._id}`);
      setRoomTypes((list) => list.map((r) => (r._id === room._id ? { ...r, isActive: false } : r)));
      toast.success("Room type removed");
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div>
      <p className="mb-4 text-sm text-slate-600">
        Add each kind of {allowed.includes("bed") ? "bed or dorm" : allowed.includes("entire") && allowed.length === 1 ? "unit" : "room"} you
        sell, with its price and how many you have.
      </p>
      {active.length === 0 ? (
        <EmptyState
          icon={BedDouble}
          title="No room types yet"
          text="A property needs at least one room type with photos and a price before it can be submitted."
          action={
            <Button icon={Plus} onClick={() => setModal({ open: true, editing: null })}>
              Add room type
            </Button>
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {active.map((room) => (
                <motion.li key={room._id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <RoomTypeCard
                    room={room}
                    onEdit={() => setModal({ open: true, editing: room })}
                    onDelete={() => remove(room)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <button
            type="button"
            onClick={() => setModal({ open: true, editing: null })}
            className={cx(
              "mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-600 transition hover:border-[#FF7A00] hover:text-[#E85D04]",
            )}
          >
            <Plus className="h-4 w-4" /> Add another room type
          </button>
        </>
      )}
      {errors?.rooms && (
        <div className="mt-4">
          <InlineError message={errors.rooms} />
        </div>
      )}
      <RoomTypeModal
        open={modal.open}
        editing={modal.editing}
        onClose={() => setModal({ open: false, editing: null })}
        propertyId={propertyId}
        allowed={allowed}
        catalogue={catalogue}
        onSaved={onSaved}
      />
      {confirmDialog}
    </div>
  );
}

export { RoomTypeModal };
