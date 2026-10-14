import { useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Clock,
  Crosshair,
  Heart,
  Loader2,
  Plus,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import MapPinPicker from "@/modules/partner/components/MapPinPicker";
import {
  CANCELLATION_DEFAULTS,
  CANCELLATION_HINTS,
  CANCELLATION_LABELS,
  NEARBY_TYPES,
  SUITABILITY_LABELS,
  TYPE_DETAIL_FIELDS,
  labelOf,
  typeMeta,
} from "../lib/constants";
import { onlyDigits } from "../lib/utils";
import { Chip, Field, InlineError, SelectField, TextAreaField, TextField, Toggle, cx } from "../components/ui";
import { PhotoGrid } from "../components/uploads";
import { MIN_PHOTOS } from "./model";

// ── 1. Type ────────────────────────────────────────────────────────────────

export function TypeStep({ form, patch, errors, catalogue, locked }) {
  const types = catalogue.propertyTypes || [];
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {types.map((type, i) => {
          const meta = typeMeta(type);
          const Icon = meta.icon;
          const selected = form.propertyType === type;
          return (
            <motion.button
              key={type}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.98 }}
              aria-pressed={selected}
              disabled={locked && !selected}
              onClick={() => patch({ propertyType: type, typeDetails: selected ? form.typeDetails : {} })}
              className={cx(
                "relative flex flex-col items-start rounded-2xl border-2 p-4 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-40 md:p-5",
                selected ? "border-[#FF7A00] bg-orange-50/60 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300",
              )}
            >
              {selected && (
                <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[#FF7A00] text-white">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
              )}
              <span
                className={cx(
                  "flex h-12 w-12 items-center justify-center rounded-xl",
                  selected ? "bg-[#FF7A00] text-white" : "bg-blue-50 text-[#0B2A6F]",
                )}
              >
                <Icon className="h-6 w-6" />
              </span>
              <span className="mt-3 font-semibold text-slate-900">{meta.label}</span>
              <span className="mt-1 text-xs leading-5 text-slate-500">{meta.blurb}</span>
            </motion.button>
          );
        })}
      </div>
      {errors.propertyType && <p className="mt-3 text-sm text-rose-600">{errors.propertyType}</p>}
      {locked && (
        <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          The type cannot be changed once room types are added. Remove the room types first, or create a new property.
        </p>
      )}
    </div>
  );
}

// ── 2. Basics ──────────────────────────────────────────────────────────────

function StarPicker({ value, onChange, label }) {
  return (
    <Field label={label} optional>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={Number(value) === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => onChange(Number(value) === n ? "" : n)}
            className="rounded-lg p-1 focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-100"
          >
            <Star className={cx("h-7 w-7", n <= Number(value || 0) ? "fill-[#FF7A00] text-[#FF7A00]" : "text-slate-300")} />
          </button>
        ))}
      </div>
    </Field>
  );
}

export function BasicsStep({ form, patch, errors, catalogue }) {
  const fields = TYPE_DETAIL_FIELDS[form.propertyType] || [];
  const setDetail = (key, value) => patch({ typeDetails: { ...form.typeDetails, [key]: value } });
  return (
    <div className="space-y-5">
      <TextField
        label="Property name"
        required
        placeholder="e.g. Hotel Sunrise Residency"
        value={form.name}
        onChange={(e) => patch({ name: e.target.value })}
        error={errors.name}
        maxLength={100}
      />

      {fields.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map((f) =>
            f.kind === "select" ? (
              <SelectField
                key={f.key}
                label={f.label}
                required
                placeholder="Select"
                options={f.options}
                value={form.typeDetails?.[f.key] || ""}
                onChange={(e) => setDetail(f.key, e.target.value)}
                error={errors[`typeDetails.${f.key}`]}
              />
            ) : f.kind === "stars" ? (
              <StarPicker key={f.key} label={f.label} value={form.typeDetails?.[f.key]} onChange={(v) => setDetail(f.key, v)} />
            ) : (
              <div key={f.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 md:col-span-2">
                <span className="text-sm font-medium text-slate-800">{f.label}</span>
                <Toggle checked={Boolean(form.typeDetails?.[f.key])} onChange={(v) => setDetail(f.key, v)} label={f.label} />
              </div>
            ),
          )}
        </div>
      )}

      <Field label="Who is it best for?">
        <div className="flex flex-wrap gap-2">
          {(catalogue.suitability || []).map((s) => (
            <Chip
              key={s}
              selected={form.suitability === s}
              onClick={() => patch({ suitability: s })}
              icon={s === "couple_friendly" ? Heart : s === "family_friendly" ? Users : undefined}
            >
              {labelOf(SUITABILITY_LABELS, s)}
            </Chip>
          ))}
        </div>
      </Field>

      <TextAreaField
        label="Short summary"
        required
        rows={2}
        maxLength={200}
        placeholder="One line guests see in search results"
        value={form.shortDescription}
        onChange={(e) => patch({ shortDescription: e.target.value })}
        error={errors.shortDescription}
      />
      <TextAreaField
        label="Full description"
        required
        rows={6}
        maxLength={3000}
        placeholder="Rooms, views, what is nearby, what makes your stay special…"
        value={form.description}
        onChange={(e) => patch({ description: e.target.value })}
        error={errors.description}
      />
      <TextField
        label="Contact number for guests"
        optional
        type="tel"
        inputMode="numeric"
        prefix="+91"
        maxLength={10}
        value={onlyDigits(form.contactNumber, 10)}
        onChange={(e) => patch({ contactNumber: onlyDigits(e.target.value, 10) })}
        error={errors.contactNumber}
        hint="Shared with guests after they book."
      />
    </div>
  );
}

// ── 3. Location ────────────────────────────────────────────────────────────

export function LocationStep({ form, patch, errors }) {
  const a = form.address || {};
  const setAddr = (key, value) => patch({ address: { ...form.address, [key]: value } });
  const [manual, setManual] = useState(false);
  const [locating, setLocating] = useState(false);
  const [coords, setCoords] = useState(() => ({
    lat: form.location?.lat != null ? String(form.location.lat) : "",
    lng: form.location?.lng != null ? String(form.location.lng) : "",
  }));
  const setCoord = (key, raw) => {
    const value = raw.replace(/[^\d.-]/g, "");
    const next = { ...coords, [key]: value };
    setCoords(next);
    const lat = Number(next.lat);
    const lng = Number(next.lng);
    if (next.lat && next.lng && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && Number.isFinite(lat) && Number.isFinite(lng)) {
      patch({ location: { lat, lng } });
    }
  };

  const fill = (found) => {
    const next = { ...form.address };
    if (found.addressLine1 && !next.line1) next.line1 = found.addressLine1;
    ["area", "city", "state", "pincode"].forEach((k) => {
      if (found[k]) next[k] = String(found[k]);
    });
    patch({ address: next });
  };

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) };
        patch({ location: point });
        setCoords({ lat: String(point.lat), lng: String(point.lng) });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const nearby = form.nearbyPlaces || [];
  const setNearby = (i, key, value) =>
    patch({ nearbyPlaces: nearby.map((n, j) => (j === i ? { ...n, [key]: value } : n)) });

  return (
    <div className="space-y-6">
      <div>
        <Field label="Pin the entrance on the map" required error={errors.location}>
          <MapPinPicker value={form.location || undefined} onChange={(point) => patch({ location: point })} onAddress={fill} />
        </Field>
        <button
          type="button"
          onClick={() => setManual((v) => !v)}
          className="mt-2 text-xs font-medium text-[#0B2A6F] underline underline-offset-2"
        >
          {manual ? "Hide coordinates" : "Map not working? Enter coordinates"}
        </button>
        {manual && (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_auto]">
            <TextField
              label="Latitude"
              inputMode="decimal"
              placeholder="12.971599"
              value={coords.lat}
              onChange={(e) => setCoord("lat", e.target.value)}
            />
            <TextField
              label="Longitude"
              inputMode="decimal"
              placeholder="77.594566"
              value={coords.lng}
              onChange={(e) => setCoord("lng", e.target.value)}
            />
            <div className="col-span-2 flex items-end md:col-span-1">
              <button
                type="button"
                onClick={locate}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
              >
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />} Use my location
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Street address"
          required
          className="md:col-span-2"
          placeholder="Building, street"
          value={a.line1 || ""}
          onChange={(e) => setAddr("line1", e.target.value)}
          error={errors.line1}
        />
        <TextField label="Area / locality" optional value={a.area || ""} onChange={(e) => setAddr("area", e.target.value)} />
        <TextField label="City" required value={a.city || ""} onChange={(e) => setAddr("city", e.target.value)} error={errors.city} />
        <TextField label="State" optional value={a.state || ""} onChange={(e) => setAddr("state", e.target.value)} />
        <TextField
          label="Pincode"
          optional
          inputMode="numeric"
          maxLength={6}
          value={a.pincode || ""}
          onChange={(e) => setAddr("pincode", onlyDigits(e.target.value, 6))}
          error={errors.pincode}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-800">
            Nearby places <span className="font-normal text-slate-400">(optional)</span>
          </span>
          <button
            type="button"
            onClick={() => patch({ nearbyPlaces: [...nearby, { name: "", type: "attraction", distanceKm: "" }] })}
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#E85D04] hover:underline"
          >
            <Plus className="h-4 w-4" /> Add place
          </button>
        </div>
        {nearby.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
            Railway station, airport, temple, beach… helps guests decide.
          </p>
        ) : (
          <ul className="space-y-2">
            {nearby.map((n, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-slate-200 bg-white p-2 md:grid-cols-[2fr_1.4fr_110px_auto]">
                <input
                  aria-label="Place name"
                  placeholder="Place name"
                  value={n.name}
                  onChange={(e) => setNearby(i, "name", e.target.value)}
                  className="col-span-1 h-10 rounded-lg border border-slate-200 px-3 text-sm focus:border-[#0B2A6F] focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Remove place"
                  onClick={() => patch({ nearbyPlaces: nearby.filter((_, j) => j !== i) })}
                  className="row-span-1 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 md:order-last"
                >
                  <X className="h-4 w-4" />
                </button>
                <select
                  aria-label="Place type"
                  value={n.type}
                  onChange={(e) => setNearby(i, "type", e.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  {NEARBY_TYPES.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
                <div className="relative">
                  <input
                    aria-label="Distance in kilometres"
                    inputMode="decimal"
                    placeholder="0.5"
                    value={n.distanceKm}
                    onChange={(e) => setNearby(i, "distanceKm", e.target.value.replace(/[^\d.]/g, ""))}
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 pr-9 text-sm focus:border-[#0B2A6F] focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">km</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── 4. Photos ──────────────────────────────────────────────────────────────

export function PhotosStep({ form, patch, errors }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Add at least {MIN_PHOTOS} bright, real photos: the outside, the reception or common area, and the rooms. Tap the
        star on a photo to make it the cover guests see first.
      </p>
      <PhotoGrid
        label="Property photos"
        images={form.photos}
        onChange={(photos) => patch({ photos, coverImage: photos.includes(form.coverImage) ? form.coverImage : photos[0] || "" })}
        cover={form.coverImage || form.photos[0]}
        onCoverChange={(coverImage) => patch({ coverImage })}
        min={MIN_PHOTOS}
      />
      <InlineError message={errors.photos} />
    </div>
  );
}

// ── 5. Amenities, rules, policies ──────────────────────────────────────────

const RULE_SUGGESTIONS = [
  "Valid photo ID required at check-in",
  "No smoking inside rooms",
  "No loud music after 10 PM",
  "Pets not allowed",
  "Outside visitors not allowed in rooms",
  "Alcohol not allowed",
];

export function PoliciesStep({ form, patch, errors, catalogue }) {
  const [rule, setRule] = useState("");
  const amenities = catalogue.amenities || [];
  const toggleAmenity = (key) =>
    patch({
      amenities: form.amenities.includes(key) ? form.amenities.filter((k) => k !== key) : [...form.amenities, key],
    });
  const addRule = (text) => {
    const t = text.trim();
    if (!t || form.houseRules.includes(t)) return;
    patch({ houseRules: [...form.houseRules, t] });
  };
  const policy = form.cancellationPolicy;
  const setPolicy = (next) => patch({ cancellationPolicy: { ...policy, ...next } });

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-900">Amenities</h3>
        <p className="mb-3 text-xs text-slate-500">{form.amenities.length} selected. Guests can filter by these.</p>
        {amenities.length === 0 ? (
          <p className="text-sm text-slate-500">The amenity list could not load. Reload the page to try again.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {amenities.map((a) => (
              <Chip key={a.key} selected={form.amenities.includes(a.key)} onClick={() => toggleAmenity(a.key)}>
                {form.amenities.includes(a.key) && <Check className="h-3.5 w-3.5" />}
                {a.label}
              </Chip>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Check-in from"
          type="time"
          required
          prefix={<Clock className="h-4 w-4" />}
          value={form.checkInTime}
          onChange={(e) => patch({ checkInTime: e.target.value })}
          error={errors.checkInTime}
        />
        <TextField
          label="Check-out by"
          type="time"
          required
          prefix={<Clock className="h-4 w-4" />}
          value={form.checkOutTime}
          onChange={(e) => patch({ checkOutTime: e.target.value })}
          error={errors.checkOutTime}
        />
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">House rules</h3>
        {form.houseRules.length > 0 && (
          <ul className="mb-3 space-y-2">
            {form.houseRules.map((r) => (
              <li key={r} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" />
                <span className="flex-1">{r}</span>
                <button
                  type="button"
                  aria-label={`Remove rule: ${r}`}
                  onClick={() => patch({ houseRules: form.houseRules.filter((x) => x !== r) })}
                  className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <label htmlFor="house-rule" className="sr-only">
            New house rule
          </label>
          <input
            id="house-rule"
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRule(rule);
                setRule("");
              }
            }}
            placeholder="Write a rule"
            maxLength={150}
            className="h-11 flex-1 rounded-xl border border-slate-300 px-3 text-sm focus:border-[#0B2A6F] focus:outline-none focus:ring-4 focus:ring-blue-100"
          />
          <button
            type="button"
            onClick={() => {
              addRule(rule);
              setRule("");
            }}
            className="inline-flex h-11 items-center gap-1 rounded-xl bg-[#0B2A6F] px-4 text-sm font-semibold text-white hover:bg-[#071A47]"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {RULE_SUGGESTIONS.filter((s) => !form.houseRules.includes(s)).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addRule(s)}
              className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-[#FF7A00] hover:text-[#E85D04]"
            >
              + {s}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Cancellation policy</h3>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Cancellation policy">
          {(catalogue.cancellationPolicies || []).map((t) => {
            const selected = policy.type === t;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPolicy({ type: t, ...(CANCELLATION_DEFAULTS[t] || {}) })}
                className={cx(
                  "rounded-xl border-2 p-3 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-100",
                  selected ? "border-[#FF7A00] bg-orange-50/60" : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <span className="flex items-center justify-between text-sm font-semibold text-slate-900">
                  {labelOf(CANCELLATION_LABELS, t)}
                  {selected && <CheckCircle2 className="h-4 w-4 text-[#FF7A00]" />}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{CANCELLATION_HINTS[t]}</span>
              </button>
            );
          })}
        </div>
        {policy.type !== "non_refundable" && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextField
              label="Free cancellation until"
              inputMode="numeric"
              suffix="hours before"
              value={policy.freeCancelHours}
              onChange={(e) => setPolicy({ freeCancelHours: onlyDigits(e.target.value, 4) })}
              hint="Full refund if cancelled before this."
            />
            <TextField
              label="Refund after that"
              inputMode="numeric"
              suffix="%"
              value={policy.refundPercentAfter}
              onChange={(e) => setPolicy({ refundPercentAfter: onlyDigits(e.target.value, 3) })}
              error={errors.refundPercentAfter}
            />
          </div>
        )}
      </section>
    </div>
  );
}
