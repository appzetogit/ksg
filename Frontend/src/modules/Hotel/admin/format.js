/** Display helpers for the hotel admin panel. */

export const humanize = (value) =>
  String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());

const LABELS = {
  pg: "PG",
  trade_license: "Trade licence",
  fire_noc: "Fire NOC",
  gst_certificate: "GST certificate",
  non_refundable: "Non-refundable",
  checked_in: "Checked in",
  checked_out: "Checked out",
  no_show: "No-show",
  awaiting_payment: "Awaiting payment",
};

export const label = (value) => (value == null || value === "" ? "—" : LABELS[value] || humanize(value));

export const formatDate = (value, withTime = false) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
};

export const money = (value) =>
  value == null || value === "" || Number.isNaN(Number(value))
    ? "—"
    : `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Ensure an account / Aadhaar number is never shown in full, even if one slips through unmasked. */
export const masked = (value) => {
  if (!value) return "—";
  const s = String(value);
  if (/[x*•]/i.test(s)) return s;
  return s.length > 4 ? `${"•".repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}` : s;
};

export const isPdf = (url) => /\.pdf$/i.test(String(url || "").split(/[?#]/)[0]);

export const fullAddress = (a) => {
  if (!a) return "—";
  if (a.fullAddress) return a.fullAddress;
  const parts = [a.line1 || a.line, a.area, a.city, a.state, a.pincode, a.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
};

/** Pagination envelope from the contract: { items, page, limit, total }. */
export const pageOf = (data) => ({
  items: Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [],
  page: Number(data?.page) || 1,
  limit: Number(data?.limit) || 20,
  total: Number(data?.total) || 0,
});
