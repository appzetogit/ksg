export const formatINR = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: Number.isInteger(n) ? 0 : 2, minimumFractionDigits: 0 })}`;
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const humanize = (key) =>
  String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());

export const discountPercent = (price, original) => {
  const p = Number(price);
  const o = Number(original);
  if (!(p > 0) || !(o > p)) return 0;
  return Math.round(((o - p) / o) * 100);
};

export const ratingLabel = (r) => {
  const n = Number(r);
  if (n >= 4.5) return "Excellent";
  if (n >= 4) return "Very good";
  if (n >= 3.5) return "Good";
  if (n >= 3) return "Pleasant";
  return "Rated";
};

export const formatDistance = (km) => {
  const n = Number(km);
  if (!Number.isFinite(n)) return "";
  return n < 1 ? `${Math.round(n * 1000)} m away` : `${n.toFixed(n < 10 ? 1 : 0)} km away`;
};

/** Cover first, then the gallery, without duplicates or blanks. */
export const propertyImages = (property) => {
  const list = [property?.coverImage, ...(property?.images || [])].filter(Boolean);
  return [...new Set(list)];
};

export const addressLine = (address = {}) =>
  address.fullAddress ||
  [address.line1, address.area, address.city, address.state, address.pincode].filter(Boolean).join(", ");

export const shortAddress = (address = {}) => [address.area, address.city].filter(Boolean).join(", ");
