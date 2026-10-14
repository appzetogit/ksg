import { Navigate, Route, Routes } from "react-router-dom";
import HotelAdminLayout from "./components/HotelAdminLayout";
import Dashboard from "./pages/Dashboard";
import PartnersList from "./pages/PartnersList";
import PartnerDetail from "./pages/PartnerDetail";
import PropertiesList from "./pages/PropertiesList";
import PropertyDetail from "./pages/PropertyDetail";

/**
 * Hotel admin panel, mounted at /admin/hotel/* by Food's AdminRouter (Pattern A:
 * own layout, outside master's AdminLayout, behind the shared ProtectedRoute and
 * the HOTEL_ENABLED flag). API contract: docs/hotel-api-contract.md, "Admin".
 */
export default function HotelAdminApp() {
  return (
    <Routes>
      <Route element={<HotelAdminLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="partners" element={<PartnersList />} />
        <Route path="partners/:id" element={<PartnerDetail />} />
        <Route path="properties" element={<PropertiesList />} />
        <Route path="properties/:id" element={<PropertyDetail />} />
        <Route path="*" element={<Navigate to="/admin/hotel/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
