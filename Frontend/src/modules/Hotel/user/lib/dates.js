// Calendar-date helpers. Stay dates are `YYYY-MM-DD` strings in IST (see the API
// contract); arithmetic is done in UTC on those strings so the local timezone of the
// device never shifts a day.

const IST = "Asia/Kolkata";
const DAY_MS = 86400000;

const istFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const todayIST = () => istFormatter.format(new Date());

export const toUTC = (iso) => new Date(`${iso}T00:00:00Z`);

export const isISODate = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toUTC(value).getTime());

export const addDays = (iso, n) => {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const diffDays = (from, to) => Math.round((toUTC(to) - toUTC(from)) / DAY_MS);

export const fmtDate = (iso, options = { day: "numeric", month: "short" }) =>
  isISODate(iso) ? toUTC(iso).toLocaleDateString("en-IN", { ...options, timeZone: "UTC" }) : "";

export const fmtDay = (iso) => fmtDate(iso, { weekday: "short", day: "numeric", month: "short" });

export const fmtLong = (iso) => fmtDate(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** "14:00" -> "2:00 PM" */
export const fmtTime = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return "";
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`;
};

export const MAX_NIGHTS = 30;
export const MAX_ADVANCE_DAYS = 365;

/** Fix up a requested stay: no past dates, check-out after check-in, bounded length. */
export const normaliseStay = (checkIn, checkOut) => {
  const today = todayIST();
  const lastDay = addDays(today, MAX_ADVANCE_DAYS);
  let ci = isISODate(checkIn) && checkIn >= today && checkIn <= lastDay ? checkIn : today;
  let co = isISODate(checkOut) ? checkOut : addDays(ci, 1);
  if (co <= ci || diffDays(ci, co) > MAX_NIGHTS) co = addDays(ci, 1);
  return { checkIn: ci, checkOut: co };
};

export const nightsLabel = (n) => `${n} night${n === 1 ? "" : "s"}`;
