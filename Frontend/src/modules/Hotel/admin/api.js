import { adminApi } from "../shared/hotelApi";
import { refreshAdminAccess } from "@food/utils/adminAccess";

/**
 * Admin calls for the hotel panel (docs/hotel-api-contract.md, "Admin").
 *
 * adminApi sends admin_accessToken but does not refresh it. The access token lasts
 * minutes, so on a 401 we ask the shared admin client to refresh (refreshAdminAccess
 * goes through services/api/axios.js, whose interceptor renews admin_accessToken),
 * then retry once. A second 401 means the session is really over.
 */
const withRefresh = async (call) => {
  try {
    return await call();
  } catch (err) {
    if (err?.status !== 401) throw err;
    await refreshAdminAccess().catch(() => null);
    return call();
  }
};

const get = (url, params) => withRefresh(() => adminApi.get(url, params));
const put = (url, body) => withRefresh(() => adminApi.put(url, body));

/** Drop empty filters so the server never sees `status=` or `q=`. */
const clean = (params = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "all"));

export const hotelAdmin = {
  overview: () => get("/admin/overview"),

  partners: (params) => get("/admin/partners", clean(params)),
  partner: (id) => get(`/admin/partners/${id}`),
  setPartnerStatus: (id, status, reason) => put(`/admin/partners/${id}/status`, { status, ...(reason ? { reason } : {}) }),

  properties: (params) => get("/admin/properties", clean(params)),
  property: (id) => get(`/admin/properties/${id}`),
  setPropertyStatus: (id, status, reason) =>
    put(`/admin/properties/${id}/status`, { status, ...(reason ? { reason } : {}) }),
  verifyDocuments: (id, verificationStatus, adminRemark) =>
    put(`/admin/properties/${id}/documents/verify`, { verificationStatus, ...(adminRemark ? { adminRemark } : {}) }),
  setLive: (id, isLive) => put(`/admin/properties/${id}/live`, { isLive }),
};
