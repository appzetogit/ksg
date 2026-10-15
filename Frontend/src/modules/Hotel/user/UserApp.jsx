import { Suspense, lazy, useEffect } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Compass } from "lucide-react";
import { HotelFooter, HotelHeader } from "./components/HotelChrome";
import "./hotel.css";
import { BTN, StateMessage } from "./components/ui";

// Customer hotel screens, served at /hotel/* (see ../HotelApp.jsx).
//   /hotel                  home + search
//   /hotel/search?...       listing (all search state in the query string)
//   /hotel/p/:slugOrId      property detail, rooms and live availability
//   /hotel/checkout?...     reserve: server quote, coupon, wallet, payment mode, Razorpay
//   /hotel/booking/:id/confirmed  success screen after booking / payment
//   /hotel/stays            my stays (tabs: upcoming / ongoing / past / cancelled)
//   /hotel/stays/:id        booking detail: voucher, pay, cancel, review
//   /hotel/saved            saved properties
const HomePage = lazy(() => import("./pages/HomePage"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const PropertyPage = lazy(() => import("./pages/PropertyPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const ConfirmationPage = lazy(() => import("./pages/ConfirmationPage"));
const StaysPage = lazy(() => import("./pages/StaysPage"));
const BookingDetailPage = lazy(() => import("./pages/BookingDetailPage"));
const SavedPage = lazy(() => import("./pages/SavedPage"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

const PageFallback = () => (
  <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#FF7A00] border-t-transparent" />
  </div>
);

function NotFound() {
  return (
    <StateMessage icon={Compass} title="This page took a detour" message="The page you are looking for does not exist or has moved.">
      <Link to="/hotel" className={BTN.primary}>
        Find a stay
      </Link>
    </StateMessage>
  );
}

export default function UserApp() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-slate-50 ksg-hotel text-slate-800 antialiased">
        <ScrollToTop />
        <HotelHeader />
        <main className="flex-1">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route index element={<HomePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="p/:slugOrId" element={<PropertyPage />} />
              <Route path="checkout" element={<CheckoutPage />} />
              <Route path="booking/:id/confirmed" element={<ConfirmationPage />} />
              <Route path="stays" element={<StaysPage />} />
              <Route path="stays/:id" element={<BookingDetailPage />} />
              <Route path="saved" element={<SavedPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
        <HotelFooter />
      </div>
    </MotionConfig>
  );
}
