import { useEffect, useState } from "react";
import { getCatalogue } from "../../shared/hotelApi";
import { FALLBACK_CATALOGUE } from "./constants";

// ── Dates (YYYY-MM-DD, IST calendar) ──────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

/** A local Date as YYYY-MM-DD. */
export const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Parse YYYY-MM-DD to a local Date at midnight. */
export const fromYmd = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export const addDays = (ymd, n) => {
  const d = fromYmd(ymd);
  d.setDate(d.getDate() + n);
  return toYmd(d);
};

export const todayYmd = () => toYmd(new Date());

const IST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A server date (YYYY-MM-DD or an ISO timestamp at 00:00 IST) as YYYY-MM-DD. */
export const serverYmd = (value) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : IST_DATE.format(d);
};

export const formatDate = (value, opts = { day: "numeric", month: "short", year: "numeric" }) => {
  const ymd = serverYmd(value);
  if (!ymd) return "";
  return fromYmd(ymd).toLocaleDateString("en-IN", opts);
};

export const nightsBetween = (from, to) => Math.round((fromYmd(to) - fromYmd(from)) / 86400000);

// ── Money ──────────────────────────────────────────────────────────────────

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const money = (n) => (Number.isFinite(Number(n)) ? INR.format(Number(n)) : "—");

// ── Payload helpers ────────────────────────────────────────────────────────

/**
 * Drop empty strings, nulls and undefined (deeply) so optional fields the server
 * validates by pattern (PAN, GSTIN, email...) are omitted rather than sent blank.
 */
export const compact = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      const c = compact(v);
      if (c === undefined || c === null || c === "") return;
      if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) return;
      out[k] = c;
    });
    return out;
  }
  return typeof value === "string" ? value.trim() : value;
};

export const num = (v, fallback = undefined) => {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const onlyDigits = (v, max) => String(v || "").replace(/\D/g, "").slice(0, max);

/** "XXXXXXXX1234" from whatever the user typed (keeps the last 4 digits only). */
export const maskLast4 = (digits, length = 12) => {
  const last4 = onlyDigits(digits).slice(-4);
  if (!last4) return "";
  return "X".repeat(Math.max(length - 4, 4)) + last4;
};

export const last4Of = (masked) => onlyDigits(masked).slice(-4);

// ── Local storage (best effort) ────────────────────────────────────────────

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// ── Catalogue hook ─────────────────────────────────────────────────────────

/** The hotel catalogue, falling back to the built-in copy if it cannot load. */
export function useCatalogue() {
  const [catalogue, setCatalogue] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    getCatalogue()
      .then((data) => alive && setCatalogue({ ...FALLBACK_CATALOGUE, ...(data || {}) }))
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setCatalogue(FALLBACK_CATALOGUE);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { catalogue, error, loading: !catalogue };
}

/** Lists from the API may arrive as an array or a paginated `{ items }`. */
export const asList = (data, key) => {
  if (Array.isArray(data)) return data;
  if (key && Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.items)) return data.items;
  return [];
};

export const isPdf = (url) => /\.pdf(\?|$)/i.test(String(url || ""));
