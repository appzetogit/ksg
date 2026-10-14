import axios from "axios";

/**
 * HTTP clients for the hotel API (/api/v1/hotel). Contract: docs/hotel-api-contract.md.
 *
 * One client per audience, each sending its own token:
 *   publicApi   no token
 *   partnerApi  hotel partner  (localStorage hotel_partner_accessToken / _refreshToken)
 *   userApi     customer       (user_accessToken, set by the existing customer login)
 *   adminApi    platform admin (admin_accessToken, set by /admin/login)
 *
 * Every helper resolves to the response's `data` field and rejects with an Error whose
 * message is the server's `message`, so screens can show it directly.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Same rules as services/api/axios.js: VITE_API_BASE_URL, ignored when a localhost URL
// was baked into a build that is not running on localhost.
const resolveApiBase = () => {
  const raw = String(import.meta.env?.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!raw) return "/api/v1";
  try {
    const parsed = new URL(raw, window.location.origin);
    if (LOCAL_HOSTS.has(parsed.hostname) && !LOCAL_HOSTS.has(window.location.hostname)) return "/api/v1";
  } catch {
    /* relative value, keep it */
  }
  return raw;
};

export const API_BASE = resolveApiBase();
export const HOTEL_BASE = `${API_BASE}/hotel`;

export const PARTNER_TOKEN_KEY = "hotel_partner_accessToken";
export const PARTNER_REFRESH_KEY = "hotel_partner_refreshToken";
export const PARTNER_PROFILE_KEY = "hotel_partner_profile";
export const USER_TOKEN_KEY = "user_accessToken";
export const ADMIN_TOKEN_KEY = "admin_accessToken";

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const toError = (error) => {
  const message =
    error?.response?.data?.message || error?.message || "Something went wrong. Please try again.";
  const err = new Error(message);
  err.status = error?.response?.status;
  err.data = error?.response?.data;
  return err;
};

const makeClient = (tokenKey) => {
  const client = axios.create({ baseURL: HOTEL_BASE, timeout: 20000 });
  if (tokenKey) {
    client.interceptors.request.use((config) => {
      const token = read(tokenKey);
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }
  return client;
};

const unwrap = (client) => ({
  get: (url, params) => client.get(url, { params }).then((r) => r.data?.data).catch((e) => Promise.reject(toError(e))),
  post: (url, body) => client.post(url, body).then((r) => r.data?.data).catch((e) => Promise.reject(toError(e))),
  put: (url, body) => client.put(url, body).then((r) => r.data?.data).catch((e) => Promise.reject(toError(e))),
  del: (url) => client.delete(url).then((r) => r.data?.data).catch((e) => Promise.reject(toError(e))),
  raw: client,
});

// ── Partner session ─────────────────────────────────────────────────────────

export const savePartnerSession = ({ accessToken, refreshToken, partner }) => {
  try {
    if (accessToken) localStorage.setItem(PARTNER_TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(PARTNER_REFRESH_KEY, refreshToken);
    if (partner) localStorage.setItem(PARTNER_PROFILE_KEY, JSON.stringify(partner));
  } catch {
    /* storage unavailable: session lasts for this page only */
  }
};

export const clearPartnerSession = () => {
  try {
    [PARTNER_TOKEN_KEY, PARTNER_REFRESH_KEY, PARTNER_PROFILE_KEY].forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
};

export const getStoredPartner = () => {
  try {
    return JSON.parse(localStorage.getItem(PARTNER_PROFILE_KEY) || "null");
  } catch {
    return null;
  }
};

export const hasPartnerSession = () => Boolean(read(PARTNER_TOKEN_KEY));

const partnerClient = makeClient(PARTNER_TOKEN_KEY);
let refreshing = null;

// On a 401, refresh the partner token once and retry; if that fails, end the session.
partnerClient.interceptors.response.use(undefined, async (error) => {
  const original = error.config;
  const refreshToken = read(PARTNER_REFRESH_KEY);
  if (error?.response?.status !== 401 || original?._retried || !refreshToken) {
    if (error?.response?.status === 401) clearPartnerSession();
    return Promise.reject(error);
  }
  original._retried = true;
  try {
    refreshing ||= axios
      .post(`${API_BASE}/auth/refresh-token`, { refreshToken })
      .then((r) => r.data?.data)
      .finally(() => {
        refreshing = null;
      });
    const data = await refreshing;
    savePartnerSession({ accessToken: data?.accessToken, refreshToken: data?.refreshToken });
    original.headers.Authorization = `Bearer ${data?.accessToken}`;
    return partnerClient(original);
  } catch (refreshError) {
    clearPartnerSession();
    return Promise.reject(refreshError);
  }
});

export const publicApi = unwrap(makeClient(null));
export const partnerApi = unwrap(partnerClient);
export const userApi = unwrap(makeClient(USER_TOKEN_KEY));
export const adminApi = unwrap(makeClient(ADMIN_TOKEN_KEY));

/** Upload a file through the existing uploads module; resolves to its URL. */
export const uploadFile = async (file, { kind = "image", folder, tokenKey = PARTNER_TOKEN_KEY } = {}) => {
  const form = new FormData();
  form.append("file", file);
  if (folder) form.append("folder", folder);
  try {
    const res = await axios.post(`${API_BASE}/uploads/${kind === "document" ? "document" : "image"}`, form, {
      headers: { Authorization: `Bearer ${read(tokenKey) || ""}` },
      timeout: 60000,
    });
    return res.data?.data?.url;
  } catch (e) {
    throw toError(e);
  }
};

/** Static catalogue (property types, amenities, ...); cached for the page's life. */
let cataloguePromise = null;
export const getCatalogue = () => {
  cataloguePromise ||= publicApi.get("/public/catalogue").catch((e) => {
    cataloguePromise = null;
    throw e;
  });
  return cataloguePromise;
};
