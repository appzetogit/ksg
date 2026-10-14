import { normaliseStay } from "./dates";

// All search state lives in the URL query so results are shareable and survive the
// back button. These helpers convert between URLSearchParams and a plain object.

export const SORTS = [
  { key: "relevance", label: "Relevance" },
  { key: "price_low", label: "Price: low to high" },
  { key: "price_high", label: "Price: high to low" },
  { key: "rating", label: "Top rated" },
  { key: "distance", label: "Distance", needsGeo: true },
];

export const PAGE_SIZE = 12;
export const LIMITS = { adults: [1, 30], children: [0, 10], rooms: [1, 10] };

const clampInt = (value, [min, max], fallback) => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const num = (value) => {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const list = (value) =>
  String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Guests and dates: the part of the state every hotel screen shares. */
export const readStay = (sp) => {
  const { checkIn, checkOut } = normaliseStay(sp.get("checkIn"), sp.get("checkOut"));
  const adults = clampInt(sp.get("adults"), LIMITS.adults, 2);
  const children = clampInt(sp.get("children"), LIMITS.children, 0);
  const rooms = Math.min(clampInt(sp.get("rooms"), LIMITS.rooms, 1), adults);
  return { checkIn, checkOut, adults, children, rooms };
};

export const readSearch = (sp) => {
  const lat = num(sp.get("lat"));
  const lng = num(sp.get("lng"));
  const hasGeo = lat !== undefined && lng !== undefined;
  const sort = sp.get("sort") || "relevance";
  return {
    ...readStay(sp),
    q: sp.get("q") || "",
    city: sp.get("city") || "",
    lat: hasGeo ? lat : undefined,
    lng: hasGeo ? lng : undefined,
    place: sp.get("place") || "",
    types: list(sp.get("types")),
    amenities: list(sp.get("amenities")),
    suitability: sp.get("suitability") || "",
    minPrice: num(sp.get("minPrice")),
    maxPrice: num(sp.get("maxPrice")),
    minRating: num(sp.get("minRating")),
    sort: SORTS.some((s) => s.key === sort && (!s.needsGeo || hasGeo)) ? sort : "relevance",
    page: clampInt(sp.get("page"), [1, 500], 1),
  };
};

/** Serialise a (partial) search state; empty values and defaults are left out. */
export const toQuery = (state) => {
  const sp = new URLSearchParams();
  const put = (key, value) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      if (value.length) sp.set(key, value.join(","));
      return;
    }
    sp.set(key, String(value));
  };
  put("q", state.q);
  put("city", state.city);
  put("lat", state.lat);
  put("lng", state.lng);
  put("place", state.place);
  put("checkIn", state.checkIn);
  put("checkOut", state.checkOut);
  put("adults", state.adults);
  if (state.children) put("children", state.children);
  put("rooms", state.rooms);
  put("types", state.types);
  put("amenities", state.amenities);
  put("suitability", state.suitability);
  put("minPrice", state.minPrice);
  put("maxPrice", state.maxPrice);
  put("minRating", state.minRating);
  if (state.sort && state.sort !== "relevance") put("sort", state.sort);
  if (state.page && state.page > 1) put("page", state.page);
  return sp.toString();
};

export const stayQuery = ({ checkIn, checkOut, adults, children, rooms }) =>
  toQuery({ checkIn, checkOut, adults, children, rooms });

/** Query for GET /public/properties. */
export const toApiParams = (s) => {
  const params = {
    checkIn: s.checkIn,
    checkOut: s.checkOut,
    adults: s.adults,
    children: s.children || undefined,
    rooms: s.rooms,
    sort: s.sort,
    page: s.page,
    limit: PAGE_SIZE,
  };
  if (s.city) params.city = s.city;
  if (s.q) params.q = s.q;
  if (s.lat !== undefined && s.lng !== undefined) {
    params.lat = s.lat;
    params.lng = s.lng;
  }
  if (s.types?.length) params.types = s.types.join(",");
  if (s.amenities?.length) params.amenities = s.amenities.join(",");
  if (s.suitability) params.suitability = s.suitability;
  if (s.minPrice !== undefined) params.minPrice = s.minPrice;
  if (s.maxPrice !== undefined) params.maxPrice = s.maxPrice;
  if (s.minRating !== undefined) params.minRating = s.minRating;
  return params;
};

export const FILTER_KEYS = ["types", "amenities", "suitability", "minPrice", "maxPrice", "minRating"];

export const countFilters = (s) =>
  (s.types?.length || 0) +
  (s.amenities?.length || 0) +
  (s.suitability ? 1 : 0) +
  (s.minPrice !== undefined || s.maxPrice !== undefined ? 1 : 0) +
  (s.minRating !== undefined ? 1 : 0);

export const clearFilters = (s) => ({
  ...s,
  types: [],
  amenities: [],
  suitability: "",
  minPrice: undefined,
  maxPrice: undefined,
  minRating: undefined,
  page: 1,
});

export const destinationLabel = (s) => {
  if (s.lat !== undefined && s.lng !== undefined) return s.place || "Near me";
  return s.city || s.q || "All destinations";
};
