import { HOTEL_BASE, publicApi, userApi } from "../../shared/hotelApi";

/**
 * Booking calls for the customer app (docs/hotel-api-contract.md, "Phase 4–5").
 *
 * The property page still prices a selection client-side (`estimateQuote`: room charges
 * + extra guests, before taxes) so its Reserve bar updates instantly; the checkout
 * screen always shows the server quote (`getQuote`), which is the price that is booked.
 * One booking = one room type (`roomTypeId` + a `rooms` count).
 */

export const BOOKING_ENABLED = true;

export const PAYMENT_MODES = [
  {
    key: "pay_at_hotel",
    label: "Pay at hotel",
    hint: "Reserve now, pay the full amount at the property.",
  },
  {
    key: "online",
    label: "Pay now",
    hint: "Pay the full amount online with UPI, card or net banking.",
  },
  {
    key: "partial_prepaid",
    label: "Pay an advance",
    hint: "Pay part online now (with a prepaid discount), the rest at the hotel.",
  },
];

// ── Room selection ↔ URL (`sel=roomTypeId:qty`) ───────────────────────────────

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

// ── Client-side estimate (property page only) ─────────────────────────────────

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

// ── Server calls ──────────────────────────────────────────────────────────────

const toPage = (data) => ({
  items: Array.isArray(data?.items) ? data.items : [],
  page: Number(data?.page) || 1,
  limit: Number(data?.limit) || 0,
  total: Number(data?.total) || 0,
});

const enc = encodeURIComponent;

/** Body shared by the quote and create calls. */
export const bookingBody = ({ propertyId, roomTypeId, checkIn, checkOut, rooms, adults, children, paymentMode, couponCode }) => {
  const body = {
    propertyId,
    roomTypeId,
    checkIn,
    checkOut,
    rooms: Number(rooms) || 1,
    adults: Number(adults) || 1,
    children: Number(children) || 0,
    paymentMode,
  };
  const code = String(couponCode || "").trim();
  if (code) body.couponCode = code;
  return body;
};

/** Server price for a stay (no hold) → Quote. */
export const getQuote = (input) => userApi.post("/user/bookings/quote", bookingBody(input));

/**
 * Create the booking → `{ booking, payment }`. `payment` is null when nothing is payable
 * online (pay at hotel, or the wallet covers it); otherwise a Razorpay order to open.
 * Rejects with status 409 when the rooms sold out in the meantime.
 */
export const createBooking = (input, { guestDetails, specialRequests, useWallet }) => {
  if (!BOOKING_ENABLED) return Promise.reject(new Error("Booking opens soon. You can't confirm a stay just yet."));
  const body = { ...bookingBody(input), guestDetails, useWallet: Boolean(useWallet) };
  if (specialRequests) body.specialRequests = specialRequests;
  return userApi.post("/user/bookings", body).then((data) => ({ booking: data?.booking || null, payment: data?.payment || null }));
};

/** Razorpay success response → the updated booking (idempotent on the server). */
export const verifyPayment = (bookingId, { razorpay_order_id, razorpay_payment_id, razorpay_signature }) =>
  userApi
    .post(`/user/bookings/${enc(bookingId)}/verify-payment`, {
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    })
    .then((data) => data?.booking || null);

/** A fresh payment object for a still-held `awaiting_payment` booking. */
export const retryPayment = (bookingId) => userApi.post(`/user/bookings/${enc(bookingId)}/retry-payment`);

export const BOOKING_TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "ongoing", label: "Ongoing" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
];

export const listBookings = ({ tab = "upcoming", page = 1, limit = 10 } = {}) =>
  userApi.get("/user/bookings", { tab, page, limit }).then(toPage);

export const getBooking = (bookingId) => userApi.get(`/user/bookings/${enc(bookingId)}`).then((data) => data?.booking || null);

/** `{ refundAmount, refundPercent, walletRefund, gatewayRefund, policyText, freeCancellationUntil? }` */
export const getCancelPreview = (bookingId) => userApi.get(`/user/bookings/${enc(bookingId)}/cancel-preview`);

export const cancelBooking = (bookingId, reason) =>
  userApi.post(`/user/bookings/${enc(bookingId)}/cancel`, { reason }).then((data) => data?.booking || null);

/**
 * Printable voucher in a plain new tab. A tab cannot send the Authorization header, so
 * the server issues a short-lived link token for this one booking (`vt`); the session
 * token itself never goes into a URL (browser history, proxies, logs).
 */
export const voucherUrl = (bookingId, linkToken) =>
  `${HOTEL_BASE}/user/bookings/${enc(bookingId)}/voucher?vt=${enc(linkToken)}`;

export const openVoucher = async (bookingId) => {
  // Open the tab inside the click (popup blockers), then point it at the link.
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const data = await userApi.post(`/user/bookings/${enc(bookingId)}/voucher-link`, {});
    const url = voucherUrl(bookingId, data?.token || "");
    if (tab) tab.location.replace(url);
    else window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    if (tab) tab.close();
    window.alert(err?.message || "Could not open the voucher. Please try again.");
  }
};

export const SUB_RATINGS = [
  { key: "cleanliness", label: "Cleanliness" },
  { key: "service", label: "Staff & service" },
  { key: "location", label: "Location" },
  { key: "value", label: "Value for money" },
];

export const submitReview = (payload) => userApi.post("/user/reviews", payload).then((data) => data?.review || null);

/** Approved reviews, one page, plus the rating summary. */
export const getPropertyReviews = (propertyId, { page = 1, limit = 5 } = {}) =>
  publicApi.get(`/public/properties/${enc(propertyId)}/reviews`, { page, limit }).then((data) => ({
    ...toPage(data),
    summary: data?.summary || null,
  }));

export const listSaved = () =>
  userApi.get("/user/saved").then((data) => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []));

export const setSaved = (propertyId, saved) =>
  (saved ? userApi.post(`/user/saved/${enc(propertyId)}`) : userApi.del(`/user/saved/${enc(propertyId)}`)).then((data) =>
    typeof data?.saved === "boolean" ? data.saved : saved
  );
