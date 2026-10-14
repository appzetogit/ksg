import { userApi } from "../../shared/hotelApi";

/**
 * Booking calls for the customer app.
 *
 * The quote/booking endpoints arrive with the booking phase (HOTEL_INTEGRATION_PLAN.md
 * §8 phase 4) and are not in docs/hotel-api-contract.md yet. Until then:
 *   - getQuote() returns a client-side ESTIMATE built from the public availability
 *     response (room charges + extra guests, before taxes);
 *   - createBooking() is disabled (BOOKING_ENABLED = false).
 * Wiring the real flow = implement the two TODOs below and flip BOOKING_ENABLED; the
 * checkout screen already renders whatever `getQuote` resolves to and calls
 * `createBooking` on confirm.
 */

export const BOOKING_ENABLED = false;

export const PAYMENT_MODES = [
  {
    key: "pay_at_hotel",
    label: "Pay at hotel",
    hint: "Reserve now, pay the full amount at check-in.",
    advancePercent: 0,
  },
  {
    key: "online",
    label: "Pay now",
    hint: "Pay the full amount online with UPI, card or net banking.",
    advancePercent: 100,
  },
  {
    key: "partial_prepaid",
    label: "Pay 30% now",
    hint: "Pay a 30% advance online, the rest at the hotel.",
    advancePercent: 30,
  },
];

// ── Room selection ↔ URL (`sel=roomTypeId:qty,roomTypeId:qty`) ────────────────

export const parseSelection = (raw) => {
  const out = {};
  String(raw || "")
    .split(",")
    .forEach((part) => {
      const [id, qty] = part.split(":");
      const n = parseInt(qty, 10);
      if (id && n > 0) out[id] = Math.min(n, 20);
    });
  return out;
};

export const serialiseSelection = (selection) =>
  Object.entries(selection)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => `${id}:${qty}`)
    .join(",");

export const selectedUnits = (selection) => Object.values(selection).reduce((a, b) => a + (b > 0 ? b : 0), 0);

// ── Client-side estimate ──────────────────────────────────────────────────────

const round2 = (n) => Math.round(n * 100) / 100;

/** Price of ONE unit for the whole stay, from the availability row. */
export const unitStayPrice = (row, roomsRequested = 1) => {
  if (Array.isArray(row?.nightlyPrices) && row.nightlyPrices.length) {
    return round2(row.nightlyPrices.reduce((sum, n) => sum + (Number(n?.price) || 0), 0));
  }
  return round2((Number(row?.total) || 0) / Math.max(1, roomsRequested));
};

/**
 * Spread `guests` over the selected units: each unit includes `base` guests for free
 * and takes up to `max - base` extra guests at `price` per night. Cheapest extras first.
 */
const allocateExtras = (units, guests, baseKey, maxKey, priceKey) => {
  const included = units.reduce((s, u) => s + (Number(u.rt[baseKey]) || 0), 0);
  const capacity = units.reduce((s, u) => s + Math.max(Number(u.rt[maxKey]) || 0, Number(u.rt[baseKey]) || 0), 0);
  let extra = Math.max(0, Math.min(guests, capacity) - included);
  const extraCount = extra;
  let perNight = 0;
  [...units]
    .sort((a, b) => (Number(a.rt[priceKey]) || 0) - (Number(b.rt[priceKey]) || 0))
    .forEach((u) => {
      if (!extra) return;
      const room = Math.max(0, (Number(u.rt[maxKey]) || 0) - (Number(u.rt[baseKey]) || 0));
      const take = Math.min(room, extra);
      perNight += take * (Number(u.rt[priceKey]) || 0);
      extra -= take;
    });
  return { extraCount, perNight, shortfall: Math.max(0, guests - capacity) };
};

/**
 * Estimate for a selection. `availability` is the GET .../availability response,
 * `roomTypes` the property's RoomType list (for occupancy and extra-guest prices).
 */
export const estimateQuote = ({ availability, roomTypes, selection, adults, children, roomsRequested }) => {
  const nights = Number(availability?.nights) || 0;
  const byId = Object.fromEntries((roomTypes || []).map((rt) => [String(rt._id), rt]));
  const lines = [];
  const units = [];
  (availability?.roomTypes || []).forEach((row) => {
    const id = String(row.roomTypeId);
    const qty = Math.min(selection[id] || 0, Math.max(0, Number(row.available) || 0));
    if (!qty) return;
    const rt = byId[id] || {};
    const unitPrice = unitStayPrice(row, roomsRequested);
    lines.push({
      roomTypeId: id,
      name: row.name || rt.name,
      inventoryType: rt.inventoryType,
      qty,
      unitPrice,
      amount: round2(unitPrice * qty),
    });
    for (let i = 0; i < qty; i += 1) units.push({ rt });
  });

  const adultsX = allocateExtras(units, adults, "baseAdults", "maxAdults", "extraAdultPrice");
  const childrenX = allocateExtras(units, children, "baseChildren", "maxChildren", "extraChildPrice");
  const roomCharges = round2(lines.reduce((s, l) => s + l.amount, 0));
  const extraAdultCharges = round2(adultsX.perNight * nights);
  const extraChildCharges = round2(childrenX.perNight * nights);
  const total = round2(roomCharges + extraAdultCharges + extraChildCharges);

  return {
    estimate: true,
    nights,
    units: units.length,
    lines,
    roomCharges,
    extraAdults: adultsX.extraCount,
    extraChildren: childrenX.extraCount,
    extraAdultCharges,
    extraChildCharges,
    total,
    shortfall: { adults: adultsX.shortfall, children: childrenX.shortfall },
  };
};

export const advanceSplit = (total, modeKey) => {
  const mode = PAYMENT_MODES.find((m) => m.key === modeKey) || PAYMENT_MODES[0];
  const payNow = round2((total * mode.advancePercent) / 100);
  return { payNow, payAtHotel: round2(total - payNow) };
};

// ── Server calls (booking phase) ──────────────────────────────────────────────

/**
 * Price a selection. TODO(booking phase): replace the estimate with the server quote,
 * e.g. `return userApi.post("/user/bookings/quote", { propertyId, checkIn, checkOut,
 * adults, children, rooms: [{ roomTypeId, quantity }], paymentMode, couponCode })`,
 * and render its taxes/fees/discount lines on the checkout screen.
 */
export const getQuote = async (input) => estimateQuote(input);

/**
 * Create the booking. TODO(booking phase): `return userApi.post("/user/bookings", payload)`
 * then, for online / partial_prepaid, open Razorpay with the returned order and call
 * the verify endpoint; finally navigate to /hotel/stays/:bookingId.
 */
export const createBooking = async (payload) => {
  if (!BOOKING_ENABLED) throw new Error("Booking opens soon. You can't confirm a stay just yet.");
  return userApi.post("/user/bookings", payload);
};
