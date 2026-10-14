import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { hasPartnerSession } from "../shared/hotelApi";
import { PartnerProvider } from "./lib/PartnerContext";
import { BASE_PATH } from "./lib/constants";
import PortalLayout from "./components/PortalLayout";
import { FullPageSpinner } from "./components/ui";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const Properties = lazy(() => import("./pages/Properties"));
const PropertyDetail = lazy(() => import("./pages/PropertyDetail"));
const PropertyWizard = lazy(() => import("./wizard/PropertyWizard"));
const Inventory = lazy(() => import("./pages/Inventory"));

const FONT_HREF = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap";

/** Everything except /login needs a partner session. */
function RequireSession({ children }) {
  const location = useLocation();
  if (!hasPartnerSession()) {
    return <Navigate to={`${BASE_PATH}/login`} replace state={{ from: location.pathname + location.search }} />;
  }
  return <PartnerProvider>{children}</PartnerProvider>;
}

/**
 * Hotel partner portal, mounted at /hotel/partner/*.
 *
 *   login                      phone + OTP
 *   (index)                    dashboard
 *   profile                    onboarding: KYC, bank, address, terms
 *   properties                 list
 *   properties/new             wizard (new draft)
 *   properties/:id             detail
 *   properties/:id/edit?step=  wizard (existing property)
 *   inventory                  calendar + blocks
 */
export default function PartnerApp() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);

  return (
    <div className="min-h-screen text-slate-900" style={{ fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }}>
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route
            element={
              <RequireSession>
                <PortalLayout />
              </RequireSession>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="profile" element={<Profile />} />
            <Route path="properties" element={<Properties />} />
            <Route path="properties/new" element={<PropertyWizard />} />
            <Route path="properties/:id" element={<PropertyDetail />} />
            <Route path="properties/:id/edit" element={<PropertyWizard />} />
            <Route path="inventory" element={<Inventory />} />
          </Route>
          <Route path="*" element={<Navigate to={BASE_PATH} replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
