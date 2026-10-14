import { useState } from "react";
import { motion } from "framer-motion";
import { BedDouble, Check, Images, Minus, Plus, Users, UtensilsCrossed } from "lucide-react";
import { Lightbox } from "./Gallery";
import { Skeleton, SmartImage, cx, fadeUp } from "./ui";
import { MEAL_PLAN_LABELS, amenityIcon, amenityLabel, unitLabel } from "../lib/catalogue";
import { unitStayPrice } from "../lib/bookingApi";
import { formatINR, plural } from "../lib/format";
import { nightsLabel } from "../lib/dates";

const occupancy = (rt) => {
  const adults = Math.max(Number(rt.maxAdults) || 0, Number(rt.baseAdults) || 0);
  const kids = Math.max(Number(rt.maxChildren) || 0, Number(rt.baseChildren) || 0);
  if (!adults && !kids) return "";
  return `Up to ${plural(adults, "adult")}${kids ? ` + ${plural(kids, "child", "children")}` : ""}`;
};

/**
 * One room type with its live price for the chosen stay and a quantity picker.
 * `row` is this room type's entry in the availability response (undefined = not
 * offered for these dates).
 */
export default function RoomCard({ rt, row, loading, error, qty, onQty, stay, nights, catalogue }) {
  const [photos, setPhotos] = useState(null);
  const images = (rt.images || []).filter(Boolean);
  const available = Math.max(0, Number(row?.available) || 0);
  const maxQty = Math.min(available, 10);
  const price = row ? unitStayPrice(row, stay.rooms) : 0;
  const perNight = nights ? price / nights : 0;
  const original = Number(rt.originalPrice) > 0 && Number(rt.originalPrice) * nights > price ? Number(rt.originalPrice) * nights : 0;
  const unit = (n) => unitLabel(rt.inventoryType, n);
  const meal = MEAL_PLAN_LABELS[rt.mealPlan];
  const selected = qty > 0;

  let status = null;
  if (!loading && !error) {
    if (!row || available === 0) status = { tone: "sold", text: "Sold out for these dates" };
    else if (available <= 3) status = { tone: "low", text: `Only ${available} ${unit(available)} left` };
  }

  return (
    <motion.article
      variants={fadeUp}
      className={cx(
        "overflow-hidden rounded-2xl border bg-white shadow-sm transition",
        selected ? "border-[#FF7A00] ring-2 ring-[#FF7A00]/20" : "border-slate-200/80"
      )}
    >
      <div className="grid sm:grid-cols-[220px_1fr]">
        <button
          type="button"
          onClick={() => images.length && setPhotos(0)}
          className="group relative block text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300"
          aria-label={`View ${rt.name} photos`}
        >
          <SmartImage src={images[0]} alt="" className="aspect-[16/10] h-full w-full sm:aspect-auto sm:min-h-[190px]" imgClassName="transition-transform duration-700 group-hover:scale-105" />
          {images.length > 1 && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
              <Images className="h-3 w-3" aria-hidden="true" /> {images.length}
            </span>
          )}
        </button>

        <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
          <div>
            <h3 className="text-base font-bold text-slate-900">{rt.name}</h3>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {occupancy(rt) && (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {occupancy(rt)}
                </span>
              )}
              {Number(rt.bedsPerRoom) > 0 && rt.inventoryType !== "bed" && (
                <span className="inline-flex items-center gap-1">
                  <BedDouble className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> {plural(Number(rt.bedsPerRoom), "bed")}
                </span>
              )}
              {meal && (
                <span className={cx("inline-flex items-center gap-1", rt.mealPlan !== "room_only" && "font-semibold text-[#16A34A]")}>
                  <UtensilsCrossed className="h-3.5 w-3.5" aria-hidden="true" /> {meal}
                </span>
              )}
            </div>
            {rt.description && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{rt.description}</p>}
          </div>

          {rt.amenities?.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={`${rt.name} amenities`}>
              {rt.amenities.slice(0, 6).map((key) => {
                const Icon = amenityIcon(key);
                return (
                  <li key={key} className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                    <Icon className="h-3 w-3 text-slate-400" aria-hidden="true" /> {amenityLabel(key, catalogue)}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-dashed border-slate-200 pt-3">
            <div className="min-h-[52px]">
              {loading ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ) : error ? (
                <p className="text-xs text-rose-600">Price unavailable right now</p>
              ) : row && available > 0 ? (
                <>
                  {original > 0 && <div className="text-xs text-slate-400 line-through">{formatINR(original)}</div>}
                  <div className="text-xl font-bold text-slate-900">{formatINR(price)}</div>
                  <div className="text-[11px] text-slate-500">
                    per {unit(1)} · {nightsLabel(nights)}
                    {nights > 1 && ` · ~${formatINR(Math.round(perNight))}/night`}
                  </div>
                </>
              ) : null}
              {status && (
                <p className={cx("mt-1 text-xs font-semibold", status.tone === "sold" ? "text-rose-600" : "text-[#E85D04]")} role="status">
                  {status.text}
                </p>
              )}
            </div>

            {!loading && !error && row && available > 0 && (
              <div className="min-w-[132px]">
                {selected ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-[#FF7A00] bg-orange-50 p-1" role="group" aria-label={`${rt.name} quantity`}>
                    <button type="button" onClick={() => onQty(qty - 1)} aria-label={`Remove one ${unit(1)}`} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#E85D04] shadow-sm">
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="text-sm font-bold text-[#E85D04] tabular-nums" aria-live="polite">
                      {qty} {unit(qty)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onQty(qty + 1)}
                      disabled={qty >= maxQty}
                      aria-label={`Add one ${unit(1)}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#E85D04] shadow-sm disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onQty(Math.max(1, Math.min(stay.rooms, maxQty)))}
                    className="w-full rounded-xl border-2 border-[#FF7A00] px-4 py-2 text-sm font-bold text-[#E85D04] transition hover:bg-[#FF7A00] hover:text-white"
                  >
                    Select
                  </button>
                )}
                {selected && (
                  <p className="mt-1 flex items-center justify-end gap-1 text-[11px] font-semibold text-[#16A34A]">
                    <Check className="h-3 w-3" aria-hidden="true" /> Added
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <Lightbox images={images} index={photos} onIndex={setPhotos} onClose={() => setPhotos(null)} title={rt.name} />
    </motion.article>
  );
}
