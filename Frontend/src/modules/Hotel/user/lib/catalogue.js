import {
  Accessibility,
  AirVent,
  ArrowUpDown,
  BatteryCharging,
  BedDouble,
  BedSingle,
  Building2,
  Cctv,
  CircleCheck,
  Clock,
  ConciergeBell,
  Coffee,
  CookingPot,
  Dumbbell,
  Flower2,
  House,
  HousePlus,
  PawPrint,
  ShowerHead,
  SprayCan,
  SquareParking,
  TreePalm,
  Tv,
  UtensilsCrossed,
  WashingMachine,
  Waves,
  Wifi,
} from "lucide-react";
import { humanize } from "./format";

// Display metadata for catalogue keys (GET /public/catalogue). The catalogue decides
// WHICH keys exist; this file only gives them labels and icons.

export const AMENITY_ICONS = {
  wifi: Wifi,
  ac: AirVent,
  parking: SquareParking,
  restaurant: UtensilsCrossed,
  room_service: ConciergeBell,
  pool: Waves,
  gym: Dumbbell,
  spa: Flower2,
  power_backup: BatteryCharging,
  lift: ArrowUpDown,
  cctv: Cctv,
  housekeeping: SprayCan,
  tv: Tv,
  geyser: ShowerHead,
  kitchen: CookingPot,
  laundry: WashingMachine,
  breakfast: Coffee,
  pet_friendly: PawPrint,
  wheelchair: Accessibility,
  front_desk_24x7: Clock,
};

export const amenityIcon = (key) => AMENITY_ICONS[key] || CircleCheck;

export const PROPERTY_TYPE_META = {
  hotel: { label: "Hotel", plural: "Hotels", icon: Building2 },
  resort: { label: "Resort", plural: "Resorts", icon: TreePalm },
  villa: { label: "Villa", plural: "Villas", icon: House },
  homestay: { label: "Homestay", plural: "Homestays", icon: HousePlus },
  hostel: { label: "Hostel", plural: "Hostels", icon: BedSingle },
  pg: { label: "PG", plural: "PGs", icon: BedDouble },
};

export const typeLabel = (key) => PROPERTY_TYPE_META[key]?.label || humanize(key);
export const typeIcon = (key) => PROPERTY_TYPE_META[key]?.icon || Building2;

export const SUITABILITY_LABELS = {
  couple_friendly: "Couple friendly",
  family_friendly: "Family friendly",
  both: "Couple & family friendly",
  none: "",
};

export const MEAL_PLAN_LABELS = {
  room_only: "Room only",
  breakfast: "Breakfast included",
  half_board: "Breakfast + dinner",
  full_board: "All meals included",
};

export const UNIT_LABELS = {
  room: ["room", "rooms"],
  bed: ["bed", "beds"],
  entire: ["unit", "units"],
};

export const unitLabel = (inventoryType, n) => {
  const [one, many] = UNIT_LABELS[inventoryType] || UNIT_LABELS.room;
  return n === 1 ? one : many;
};

/** Normalise a catalogue list (strings, `{key,label}` objects or a key->label map). */
export const toOptions = (raw, labelFor = humanize) => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return { key: item, label: labelFor(item) };
        const key = item?.key ?? item?.value ?? item?.id;
        return key ? { key: String(key), label: item.label || item.name || labelFor(key) } : null;
      })
      .filter(Boolean);
  }
  if (typeof raw === "object") {
    return Object.entries(raw).map(([key, value]) => ({
      key,
      label: typeof value === "string" ? value : value?.label || labelFor(key),
    }));
  }
  return [];
};

export const catalogueTypes = (catalogue) => toOptions(catalogue?.propertyTypes, typeLabel);
export const catalogueAmenities = (catalogue) => toOptions(catalogue?.amenities);
export const catalogueSuitability = (catalogue) =>
  toOptions(catalogue?.suitability, (k) => SUITABILITY_LABELS[k] || humanize(k)).filter((o) => o.key !== "none");

export const amenityLabel = (key, catalogue) =>
  catalogueAmenities(catalogue).find((a) => a.key === key)?.label || humanize(key);

const POLICY_NAMES = {
  flexible: "Flexible",
  moderate: "Moderate",
  strict: "Strict",
  non_refundable: "Non-refundable",
};

/** Cancellation policy in plain words: `{ title, summary, points[] }`. */
export const describeCancellation = (policy) => {
  const type = policy?.type || "flexible";
  const title = `${POLICY_NAMES[type] || humanize(type)} cancellation`;
  if (type === "non_refundable") {
    return {
      title,
      free: false,
      summary: "This booking is non-refundable.",
      points: ["If you cancel, change dates or do not show up, the amount you paid is not refunded."],
    };
  }
  const hours = Number(policy?.freeCancelHours) || 0;
  const pct = Math.min(100, Math.max(0, Number(policy?.refundPercentAfter) || 0));
  const window = hours >= 48 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`;
  const points = [];
  if (hours > 0) points.push(`Cancel up to ${window} before check-in for a full refund.`);
  else points.push("Cancel any time before check-in for a full refund.");
  if (hours > 0) {
    points.push(
      pct > 0
        ? `Cancel later than that and you get ${pct}% of the amount back.`
        : "Cancel later than that and the amount is not refunded."
    );
  }
  points.push("No-shows are not refunded.");
  return {
    title,
    free: true,
    summary: hours > 0 ? `Free cancellation until ${window} before check-in` : "Free cancellation before check-in",
    points,
  };
};
