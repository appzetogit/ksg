import { useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BedDouble,
  Building2,
  CalendarCheck,
  Landmark,
  Lock,
  LayoutDashboard,
  LogOut,
  Menu,
  Pill,
  Settings,
  ShoppingBasket,
  SlidersHorizontal,
  Star,
  TicketPercent,
  Truck,
  Users,
  UtensilsCrossed,
  Wrench,
  X,
} from "lucide-react";
import quickSpicyLogo from "@food/assets/ksg-logo.png";
import { adminAPI } from "@food/api";
import { clearModuleAuth } from "@food/utils/auth";
import { useAdminAccess, hasPanel, canOpenPath } from "@food/utils/adminAccess";
import { SERVICE_PROVIDER_ENABLED } from "@/config/features";
import { hotelResourceForPath, readAdminProfile, useHotelAccess } from "../hotelAccess";
import { cx } from "./ui";

/*
 * Hotel admin chrome: own sidebar + header, mounted outside master's AdminLayout
 * (Pattern A, same as the Services admin). Colours are the master sidebar's tokens
 * (navy active, saffron hover, ink text) so it reads as the same product.
 */
const THEME = `
  .hotel-admin {
    --ha-navy: #0B2A6F;
    --ha-ink: #0B1B3F;
    --ha-ink-soft: #33415C;
    --ha-ink-faint: #5A6680;
    --ha-hover: #FFF1E3;
    --ha-saffron: #FF7A00;
    --ha-green: #138808;
    --ha-surface: #F7F9FD;
    --ha-border: #E2E8F3;
  }
  .hotel-admin .ha-tricolour {
    background: linear-gradient(90deg, #FF9933 0 33.33%, #FFFFFF 33.33% 66.66%, #138808 66.66% 100%);
  }
  .hotel-admin :focus-visible { outline-color: var(--ha-navy); }
`;

// `resource`: the permission a sub-admin needs to see the entry (hotelAccess.js).
const NAV = [
  { to: "/admin/hotel/dashboard", label: "Dashboard", icon: LayoutDashboard, resource: "dashboard" },
  { to: "/admin/hotel/partners", label: "Partners", icon: Users, resource: "hotel_partners" },
  { to: "/admin/hotel/properties", label: "Properties", icon: Building2, resource: "hotel_properties" },
  { to: "/admin/hotel/bookings", label: "Bookings", icon: CalendarCheck, resource: "hotel_bookings" },
  { to: "/admin/hotel/reviews", label: "Reviews", icon: Star, resource: "hotel_reviews" },
  { to: "/admin/hotel/offers", label: "Offers", icon: TicketPercent, resource: "promotions" },
  { to: "/admin/hotel/withdrawals", label: "Withdrawals", icon: Landmark, resource: "hotel_withdrawals" },
  { to: "/admin/hotel/settings", label: "Settings", icon: Settings, resource: "hotel_settings" },
];

const TITLES = [
  ["/admin/hotel/bookings", "Bookings"],
  ["/admin/hotel/reviews", "Reviews"],
  ["/admin/hotel/offers", "Offers"],
  ["/admin/hotel/withdrawals", "Withdrawals"],
  ["/admin/hotel/settings", "Settings"],
  ["/admin/hotel/partners", "Partners"],
  ["/admin/hotel/properties", "Properties"],
  ["/admin/hotel/dashboard", "Dashboard"],
];

function PanelSwitcher() {
  const navigate = useNavigate();
  const access = useAdminAccess();
  const show = (service) => hasPanel(access, service);
  const masterEntry = ["/admin/master/settings", "/admin/master/admins"].find((p) => canOpenPath(access, p)) || null;

  const tabs = [
    masterEntry && { key: "master", label: "Master", icon: SlidersHorizontal, to: masterEntry },
    show("food") && { key: "food", label: "Food", icon: UtensilsCrossed, to: "/admin/food" },
    show("taxi") && { key: "taxi", label: "Taxi", icon: Truck, to: "/taxi/admin/dashboard" },
    SERVICE_PROVIDER_ENABLED && show("serviceProvider") && { key: "sp", label: "Services", icon: Wrench, to: "/admin/sp/dashboard" },
    show("quickCommerce") && { key: "qc", label: "Quick", icon: ShoppingBasket, to: "/admin/quick-commerce" },
    show("medical") && { key: "medical", label: "Medical", icon: Pill, to: "/admin/medical" },
    { key: "hotel", label: "Hotel", icon: BedDouble, to: "/admin/hotel/dashboard", active: true },
  ].filter(Boolean);

  return (
    <div className="grid grid-cols-4 gap-1 rounded-xl border border-[var(--ha-border)] bg-white p-1.5 shadow-inner">
      {tabs.map(({ key, label, icon: Icon, to, active }) => (
        <button
          key={key}
          type="button"
          onClick={() => navigate(to)}
          className={cx(
            "flex w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg px-1 py-2.5 text-[11px] font-bold leading-none transition-all duration-300",
            active
              ? "bg-[var(--ha-navy)] text-white shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
              : "text-[var(--ha-ink-faint)] hover:bg-[var(--ha-hover)] hover:text-[var(--ha-ink-soft)]",
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="max-w-full truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

function Sidebar({ open, onClose }) {
  const { canRead } = useHotelAccess();
  const nav = NAV.filter((n) => canRead(n.resource));
  return (
    <>
      <div
        className={cx("fixed inset-0 z-40 bg-[#0B1B3F]/40 transition-opacity lg:hidden", open ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={onClose}
      />
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[var(--ha-border)] bg-[var(--ha-surface)] transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="ha-tricolour h-1 shrink-0" />
        <div className="shrink-0 border-b border-[var(--ha-border)] bg-white px-3 py-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ha-border)] bg-[var(--ha-hover)] p-1">
                <img src={quickSpicyLogo} alt="" className="h-9 w-9 object-contain" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-[15px] font-extrabold leading-tight tracking-tight text-[var(--ha-ink)]">KSG Hotels</h3>
                <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ha-ink-faint)]">Admin</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--ha-ink-soft)] hover:bg-[var(--ha-hover)] lg:hidden"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--ha-ink-soft)]">Admin Panel</h2>
          <PanelSwitcher />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-widest text-[var(--ha-ink-faint)]">Hotel</p>
          {nav.map(({ to, label, icon: Icon, soon }) =>
            soon ? (
              <div
                key={label}
                aria-disabled="true"
                title="Arrives with the booking phase"
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[var(--ha-ink-faint)] opacity-70"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                <span className="rounded-full bg-[var(--ha-hover)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ha-saffron)]">
                  Soon
                </span>
              </div>
            ) : (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={({ isActive }) =>
                  cx(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    isActive
                      ? "bg-[var(--ha-navy)] font-semibold text-white shadow-sm"
                      : "text-[var(--ha-ink-soft)] hover:bg-[var(--ha-hover)] hover:text-[var(--ha-ink)]",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="shrink-0 border-t border-[var(--ha-border)] px-4 py-3 text-[11px] text-[var(--ha-ink-faint)]">
          Users are managed in Master; Master › Coupons lists every service's coupons.
        </div>
      </aside>
    </>
  );
}

function Header({ onMenu }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const admin = useMemo(() => readAdminProfile() || {}, []);
  const name = admin.name || admin.fullName || admin.email || "Admin";
  const initials = String(name)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  const title = (TITLES.find(([p]) => pathname.startsWith(p)) || [null, "Hotel admin"])[1];

  const logout = async () => {
    try {
      await adminAPI.logout();
    } catch {
      /* clear locally regardless */
    }
    clearModuleAuth("admin");
    ["admin_accessToken", "admin_authenticated", "admin_user", "admin_access", "admin_sidebar_state", "admin_recent_searches"].forEach(
      (k) => localStorage.removeItem(k),
    );
    sessionStorage.removeItem("adminAuthData");
    window.dispatchEvent(new Event("adminAuthChanged"));
    navigate("/admin/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--ha-border)] bg-white/95 backdrop-blur">
      <div className="ha-tricolour h-[3px] lg:hidden" />
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={onMenu}
          className="rounded-lg p-2 text-[var(--ha-ink-soft)] hover:bg-[var(--ha-hover)] lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ha-saffron)]">Hotel</p>
          <h1 className="truncate text-base font-bold text-[var(--ha-ink)]">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="max-w-[180px] truncate text-sm font-semibold text-[var(--ha-ink)]">{name}</p>
            <p className="text-[11px] text-[var(--ha-ink-faint)]">
              {admin.adminLevel === "platform_superadmin" ? "Super admin" : "Admin"}
            </p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ha-navy)] text-sm font-bold text-white">
            {initials || "A"}
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg p-2 text-[var(--ha-ink-soft)] hover:bg-[var(--ha-hover)] hover:text-red-600"
            title="Log out"
            aria-label="Log out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}

function NoAccess() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-[var(--ha-border)] bg-white p-8 text-center">
      <Lock className="mx-auto h-8 w-8 text-[var(--ha-ink-faint)]" />
      <h2 className="mt-3 text-base font-bold text-[var(--ha-ink)]">No access to this section</h2>
      <p className="mt-1 text-sm text-[var(--ha-ink-soft)]">Ask a superadmin to give your account this hotel section.</p>
    </div>
  );
}

/**
 * A sub-admin opening a hotel screen they were not given goes to the first one
 * they were; with none at all they see a notice. (The server refuses the data
 * either way; this saves them a page of errors.)
 */
function GatedOutlet() {
  const { pathname } = useLocation();
  const { canRead, loading } = useHotelAccess();
  if (loading) return null;
  const resource = hotelResourceForPath(pathname);
  if (!resource || canRead(resource)) return <Outlet />;
  const first = NAV.find((n) => canRead(n.resource));
  return first ? <Navigate to={first.to} replace /> : <NoAccess />;
}

export default function HotelAdminLayout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="hotel-admin min-h-screen bg-[var(--ha-surface)] text-[var(--ha-ink)]">
      <style>{THEME}</style>
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-col lg:pl-72">
        <Header onMenu={() => setOpen(true)} />
        <main className="w-full min-w-0 flex-1 p-4 sm:p-6">
          <GatedOutlet />
        </main>
      </div>
    </div>
  );
}
