import { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";

// Hotel vertical shell, mounted at /hotel/* in app/routes.jsx when HOTEL_ENABLED.
//   /hotel/partner/*  hotel partner portal  (partner/PartnerApp.jsx)
//   /hotel/*          customer screens      (user/UserApp.jsx)
// The hotel admin panel lives under /admin/hotel/* (admin/HotelAdminApp.jsx), wired in
// the master AdminRouter.
const PartnerApp = lazy(() => import("./partner/PartnerApp"));
const UserApp = lazy(() => import("./user/UserApp"));

const Fallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-white">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#FF7A00] border-t-transparent" />
  </div>
);

export default function HotelApp() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="partner/*" element={<PartnerApp />} />
        <Route path="*" element={<UserApp />} />
      </Routes>
    </Suspense>
  );
}
