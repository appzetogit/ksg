import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearPartnerSession,
  getStoredPartner,
  hasPartnerSession,
  partnerApi,
  savePartnerSession,
} from "../../shared/hotelApi";
import { BASE_PATH } from "./constants";

const PartnerContext = createContext(null);

/**
 * The signed-in partner. Starts from the cached profile so screens render at once,
 * then refreshes from GET /partner/me.
 */
export function PartnerProvider({ children }) {
  const navigate = useNavigate();
  const [partner, setPartnerState] = useState(() => getStoredPartner());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const setPartner = useCallback((next) => {
    setPartnerState(next);
    if (next) savePartnerSession({ partner: next });
  }, []);

  const logout = useCallback(() => {
    clearPartnerSession();
    setPartnerState(null);
    navigate(`${BASE_PATH}/login`, { replace: true });
  }, [navigate]);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const data = await partnerApi.get("/partner/me");
      const fresh = data?.partner || data;
      if (fresh) setPartner(fresh);
      return fresh;
    } catch (e) {
      if (e.status === 401 || !hasPartnerSession()) logout();
      else setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [logout, setPartner]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      partner,
      setPartner,
      refresh,
      logout,
      loading,
      error,
      isApproved: partner?.status === "approved",
      profileComplete: Boolean(partner?.name && partner?.kyc?.ownerName && partner?.kyc?.panNumber && partner?.termsAcceptedAt),
    }),
    [partner, setPartner, refresh, logout, loading, error],
  );

  return <PartnerContext.Provider value={value}>{children}</PartnerContext.Provider>;
}

export const usePartner = () => useContext(PartnerContext);
