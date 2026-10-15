import { useMemo } from "react";
import { HOTEL_ENABLED } from "@/config/features";
import { can, hasAdminSession, useAdminAccess } from "@food/utils/adminAccess";

/** The signed-in admin's stored profile (set by /admin/login), or null. */
export function readAdminProfile() {
  try {
    const raw = localStorage.getItem("admin_user") || sessionStorage.getItem("admin_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * May this admin see the Hotel tab? Same rule as the Food sidebar's useServiceAccess:
 * platform superadmins see everything, a session without servicesAccess fails open
 * (the server is the real gate and answers 403), otherwise it must list 'hotel'.
 * Always false on a site that has not switched the module on (config/features.js).
 */
export function canOpenHotelPanel(admin = readAdminProfile()) {
  if (!HOTEL_ENABLED) return false;
  if (!admin) return true;
  if (admin.adminLevel === "platform_superadmin") return true;
  const access = admin.servicesAccess;
  if (!Array.isArray(access) || access.length === 0) return true;
  return access.includes("hotel");
}

// Screen -> permission table lives with the other panels' (Food utils/adminAccess.js).
export { hotelResourceForPath } from "@food/utils/adminAccess";

/**
 * What the signed-in admin may do in the hotel panel. Superadmins can do
 * everything; a sub-admin gets the hotel_* sections they were given (read or
 * write). `loading` is true while a signed-in admin's access is still unknown.
 */
export function useHotelAccess() {
  const access = useAdminAccess();
  return useMemo(
    () => ({
      access,
      loading: !access && hasAdminSession(),
      canRead: (resource) => can(access, resource, "read"),
      canWrite: (resource) => can(access, resource, "write"),
    }),
    [access],
  );
}
