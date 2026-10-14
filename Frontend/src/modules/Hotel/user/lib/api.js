import { publicApi, getCatalogue } from "../../shared/hotelApi";
import { toApiParams } from "./searchState";

// Customer read calls (docs/hotel-api-contract.md, "Public"). Booking calls live in
// bookingApi.js.

export { getCatalogue };

let citiesPromise = null;
/** Cities with live properties, `[{ city, count }]`; cached for the page's life. */
export const getCities = () => {
  citiesPromise ||= publicApi
    .get("/public/cities")
    .then((rows) => (Array.isArray(rows) ? rows.filter((r) => r?.city) : []))
    .catch((e) => {
      citiesPromise = null;
      throw e;
    });
  return citiesPromise;
};

const emptyPage = { items: [], page: 1, limit: 0, total: 0 };

/** Search; resolves to `{ items: PropertyCard[], page, limit, total }`. */
export const searchProperties = (state, overrides = {}) =>
  publicApi
    .get("/public/properties", { ...toApiParams(state), ...overrides })
    .then((data) => ({ ...emptyPage, ...(data || {}), items: Array.isArray(data?.items) ? data.items : [] }));

/** `{ property, roomTypes }` for an id or slug. */
export const getProperty = (idOrSlug) =>
  publicApi.get(`/public/properties/${encodeURIComponent(idOrSlug)}`).then((data) => ({
    property: data?.property || null,
    roomTypes: Array.isArray(data?.roomTypes) ? data.roomTypes.filter((r) => r?.isActive !== false) : [],
  }));

/** Live availability and price per room type for a stay. */
export const getAvailability = (propertyId, { checkIn, checkOut, adults, children, rooms }) =>
  publicApi
    .get(`/public/properties/${encodeURIComponent(propertyId)}/availability`, {
      checkIn,
      checkOut,
      adults,
      children,
      rooms,
    })
    .then((data) => ({ ...(data || {}), roomTypes: Array.isArray(data?.roomTypes) ? data.roomTypes : [] }));
