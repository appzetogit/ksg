import { BedDouble, Building2, Castle, Home, Hotel, Palmtree, TreePine } from "lucide-react";

/**
 * Labels and per-type configuration for the hotel partner portal. The lists of
 * allowed values come from GET /public/catalogue; this file only adds how to show them.
 */

export const BRAND = {
  navy: "#0B2A6F",
  navyDeep: "#071A47",
  saffron: "#FF7A00",
  saffronDeep: "#E85D04",
  green: "#16A34A",
};

export const BASE_PATH = "/hotel/partner";

const titleCase = (v) =>
  String(v || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const labelOf = (map, key) => map[key] || titleCase(key);

// ── Property types ─────────────────────────────────────────────────────────

export const PROPERTY_TYPE_META = {
  hotel: { label: "Hotel", icon: Hotel, blurb: "Rooms with a front desk and daily service." },
  resort: { label: "Resort", icon: Palmtree, blurb: "Leisure stays with grounds and activities." },
  villa: { label: "Villa", icon: Castle, blurb: "A private home rented out as a whole." },
  homestay: { label: "Homestay", icon: Home, blurb: "Stay with or near a local host family." },
  hostel: { label: "Hostel", icon: BedDouble, blurb: "Beds in shared dorms for travellers." },
  pg: { label: "PG", icon: Building2, blurb: "Paying-guest beds for longer stays." },
};

export const typeMeta = (type) =>
  PROPERTY_TYPE_META[type] || { label: titleCase(type), icon: TreePine, blurb: "" };

/**
 * Type-specific fields stored under `typeDetails`. Each entry renders one input in
 * the wizard's basics step.
 */
export const TYPE_DETAIL_FIELDS = {
  hotel: [
    {
      key: "hotelCategory",
      label: "Hotel category",
      kind: "select",
      options: [
        ["budget", "Budget"],
        ["premium", "Premium"],
        ["luxury", "Luxury"],
      ],
    },
    { key: "starRating", label: "Star rating", kind: "stars" },
  ],
  resort: [
    {
      key: "resortType",
      label: "Resort setting",
      kind: "select",
      options: [
        ["beach", "Beach"],
        ["hill", "Hill"],
        ["jungle", "Jungle"],
        ["desert", "Desert"],
      ],
    },
    { key: "starRating", label: "Star rating", kind: "stars" },
  ],
  villa: [],
  homestay: [{ key: "hostLivesOnProperty", label: "The host lives on the property", kind: "toggle" }],
  hostel: [
    {
      key: "hostelType",
      label: "Hostel for",
      kind: "select",
      options: [
        ["boys", "Boys"],
        ["girls", "Girls"],
        ["mixed", "Mixed"],
      ],
    },
  ],
  pg: [
    {
      key: "pgType",
      label: "PG for",
      kind: "select",
      options: [
        ["boys", "Boys"],
        ["girls", "Girls"],
        ["unisex", "Unisex"],
      ],
    },
  ],
};

// ── Enumerations ───────────────────────────────────────────────────────────

export const SUITABILITY_LABELS = {
  couple_friendly: "Couple friendly",
  family_friendly: "Family friendly",
  both: "Couples & families",
  none: "Not specified",
};

export const CANCELLATION_LABELS = {
  flexible: "Flexible",
  moderate: "Moderate",
  strict: "Strict",
  non_refundable: "Non-refundable",
};

export const CANCELLATION_HINTS = {
  flexible: "Full refund until shortly before check-in.",
  moderate: "Full refund until the free-cancellation window closes.",
  strict: "Partial refund only, well before check-in.",
  non_refundable: "No refund after booking. Usually priced lower.",
};

export const CANCELLATION_DEFAULTS = {
  flexible: { freeCancelHours: 24, refundPercentAfter: 50 },
  moderate: { freeCancelHours: 48, refundPercentAfter: 0 },
  strict: { freeCancelHours: 168, refundPercentAfter: 0 },
  non_refundable: { freeCancelHours: 0, refundPercentAfter: 0 },
};

export const MEAL_PLAN_LABELS = {
  room_only: "Room only",
  breakfast: "Breakfast included",
  half_board: "Half board (breakfast + 1 meal)",
  full_board: "Full board (all meals)",
};

export const INVENTORY_TYPE_LABELS = {
  room: "Private rooms",
  bed: "Beds in shared rooms",
  entire: "Entire property",
};

export const INVENTORY_UNIT = { room: "rooms", bed: "beds", entire: "unit" };

export const ROOM_CATEGORY_FOR = { room: "private", bed: "shared", entire: "entire" };

export const DOCUMENT_LABELS = {
  trade_license: "Trade licence",
  rent_agreement: "Rent / lease agreement",
  electricity_bill: "Electricity bill",
  gst_certificate: "GST certificate",
  fire_noc: "Fire NOC",
  other: "Other document",
};

export const DOCUMENT_HINTS = {
  trade_license: "Issued by the municipal body for this address.",
  rent_agreement: "If you rent the building. Owners can upload the sale deed.",
  electricity_bill: "A recent bill for this address (last 3 months).",
  gst_certificate: "Required when you are GST registered.",
  fire_noc: "Fire safety certificate, if you have one.",
  other: "Anything else that helps verification.",
};

export const OPTIONAL_DOCUMENTS = ["gst_certificate", "fire_noc", "other"];

export const BLOCK_SOURCE_LABELS = {
  walk_in: "Walk-in guest",
  external: "Booked on another site",
  manual_block: "Blocked by me",
  platform: "KSG booking",
};

export const NEARBY_TYPES = [
  ["transport", "Railway / bus / airport"],
  ["attraction", "Attraction"],
  ["hospital", "Hospital"],
  ["market", "Market / mall"],
  ["other", "Other"],
];

// ── Statuses ───────────────────────────────────────────────────────────────

export const PROPERTY_STATUS_META = {
  draft: { label: "Draft", chip: "bg-slate-100 text-slate-700 ring-slate-200" },
  pending: { label: "Under review", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  approved: { label: "Approved", chip: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "Rejected", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  suspended: { label: "Suspended", chip: "bg-zinc-800 text-white ring-zinc-700" },
};

export const PARTNER_STATUS_META = {
  pending: { label: "Under review", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  approved: { label: "Approved", chip: "bg-green-50 text-green-700 ring-green-200" },
  rejected: { label: "Rejected", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  blocked: { label: "Blocked", chip: "bg-zinc-800 text-white ring-zinc-700" },
};

// Fallback when the catalogue cannot load, matching Backend/src/modules/hotel/constants.js.
export const FALLBACK_CATALOGUE = {
  propertyTypes: ["hotel", "resort", "villa", "homestay", "hostel", "pg"],
  inventoryTypesByProperty: {
    hotel: ["room"],
    resort: ["room"],
    villa: ["entire"],
    homestay: ["room", "entire"],
    hostel: ["bed"],
    pg: ["bed"],
  },
  requiredDocuments: {
    hotel: ["trade_license"],
    resort: ["trade_license"],
    villa: ["trade_license"],
    homestay: ["electricity_bill"],
    hostel: ["trade_license", "rent_agreement"],
    pg: ["trade_license", "rent_agreement"],
  },
  amenities: [],
  cancellationPolicies: ["flexible", "moderate", "strict", "non_refundable"],
  mealPlans: ["room_only", "breakfast", "half_board", "full_board"],
  suitability: ["couple_friendly", "family_friendly", "both", "none"],
};
