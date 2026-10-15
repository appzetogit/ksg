import { serverYmd, todayYmd } from "./utils";

/**
 * Booking helpers for the partner portal (docs/hotel-api-contract.md, "Phase 4–5").
 * The server is the real gate for every action; the rules here only decide which
 * buttons to enable and what to explain next to a disabled one.
 */

export const BOOKING_STATUS_META = {
  awaiting_payment: { label: "Awaiting payment", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  confirmed: { label: "Confirmed", chip: "bg-green-50 text-green-700 ring-green-200" },
  checked_in: { label: "In-house", chip: "bg-sky-50 text-sky-700 ring-sky-200" },
  checked_out: { label: "Checked out", chip: "bg-slate-100 text-slate-700 ring-slate-200" },
  cancelled: { label: "Cancelled", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  no_show: { label: "No-show", chip: "bg-orange-50 text-orange-700 ring-orange-200" },
  expired: { label: "Expired", chip: "bg-slate-100 text-slate-500 ring-slate-200" },
};

export const PAYMENT_MODE_LABELS = {
  pay_at_hotel: "Pay at hotel",
  online: "Paid online",
  partial_prepaid: "Part prepaid",
};

/** Tabs of the bookings list and the query each one sends. */
export const BOOKING_TABS = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "in_house", label: "In-house" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
];

export const num0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const ymdOf = (v) => serverYmd(v);

/**
 * How the guest pays, as shown on cards: `paid`, `partly` (some paid, some due),
 * `at_hotel` (nothing paid yet, all due at the property).
 */
export function paymentState(booking) {
  const p = booking?.payment || {};
  const due = num0(p.amountDue);
  const paid = num0(p.amountPaid);
  if (due <= 0) return { key: "paid", label: "Paid", due: 0, paid };
  if (paid <= 0) return { key: "at_hotel", label: "Pay at hotel", due, paid };
  return { key: "partly", label: "Partly paid", due, paid };
}

export const guestCount = (g = {}) => num0(g.adults) + num0(g.children);

export const guestsLabel = (g = {}) => {
  const a = num0(g.adults);
  const c = num0(g.children);
  return `${a} adult${a === 1 ? "" : "s"}${c ? `, ${c} child${c === 1 ? "" : "ren"}` : ""}`;
};

/**
 * Which partner actions are possible for this booking today. Each entry is
 * `{ allowed, reason }`; `reason` explains a disabled button.
 */
export function partnerActions(booking, today = todayYmd()) {
  const status = booking?.status;
  const checkIn = ymdOf(booking?.checkIn);
  const checkOut = ymdOf(booking?.checkOut);
  const due = num0(booking?.payment?.amountDue);
  const no = (reason) => ({ allowed: false, reason });
  const yes = { allowed: true, reason: "" };

  const checkInAction =
    status !== "confirmed"
      ? null
      : checkIn && today < checkIn
        ? no("Check-in opens on the arrival date.")
        : checkOut && today >= checkOut
          ? no("The stay dates have passed. Mark it a no-show instead.")
          : yes;

  const noShow =
    status !== "confirmed" ? null : checkIn && today <= checkIn ? no("Available after the check-in day ends.") : yes;

  const checkOutAction = status === "checked_in" ? yes : null;

  const markPaid = ["confirmed", "checked_in", "checked_out"].includes(status) && due > 0 ? yes : null;

  const cancel = status === "confirmed" ? yes : null;

  return { checkIn: checkInAction, checkOut: checkOutAction, noShow, markPaid, cancel };
}
