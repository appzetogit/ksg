import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  CalendarDays,
  CalendarRange,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  UserRound,
  Wallet,
} from "lucide-react";
import { usePartner } from "../lib/PartnerContext";
import { BASE_PATH } from "../lib/constants";
import { hasPartnerSession } from "../../shared/hotelApi";
import { FullPageSpinner, SoonTag, StatusChip, cx, useConfirm } from "./ui";

const NAV = [
  { to: BASE_PATH, end: true, label: "Dashboard", icon: LayoutDashboard },
  { to: `${BASE_PATH}/properties`, label: "Properties", icon: Building2 },
  { to: `${BASE_PATH}/inventory`, label: "Inventory", icon: CalendarRange },
  { to: `${BASE_PATH}/profile`, label: "Profile", icon: UserRound },
];

const LATER = [
  { label: "Bookings", icon: CalendarDays },
  { label: "Reviews", icon: MessageSquareText },
  { label: "Earnings", icon: Wallet },
];

function Brand({ light }) {
  return (
    <Link to={BASE_PATH} className="flex items-center gap-2.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF7A00] to-[#E85D04] text-white shadow-md shadow-orange-900/20">
        <Building2 className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <span className={cx("block text-base font-bold tracking-tight", light ? "text-white" : "text-[#071A47]")}>
          KSG Stays
        </span>
        <span className={cx("block text-[11px] font-medium", light ? "text-blue-200" : "text-slate-500")}>
          Partner portal
        </span>
      </span>
    </Link>
  );
}

export default function PortalLayout() {
  const { partner, logout } = usePartner();
  const { pathname } = useLocation();
  const [confirm, confirmDialog] = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);

  // A request that ended the session (refresh failed) sends the partner back to login.
  useEffect(() => {
    if (!hasPartnerSession()) logout();
    setMenuOpen(false);
  }, [pathname, logout]);

  const askLogout = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: "Log out?",
      message: "You will need an OTP on your phone to sign in again.",
      confirmLabel: "Log out",
    });
    if (ok) logout();
  };

  const initials = (partner?.name || partner?.phone || "P")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // The wizard has its own full-width chrome on phones.
  const inWizard = /\/properties\/(new|[^/]+\/edit)/.test(pathname);

  return (
    <div className="min-h-screen bg-[#F5F7FB]">
      {/* ── desktop sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-gradient-to-b from-[#0B2A6F] to-[#071A47] px-4 py-6 text-white lg:flex">
        <div className="px-2">
          <Brand light />
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Partner portal">
          {NAV.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive ? "bg-white/10 text-white" : "text-blue-100/80 hover:bg-white/5 hover:text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[#FF7A00]"
                    />
                  )}
                  <Icon className="h-5 w-5" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
          <p className="mt-6 px-3 text-[11px] font-semibold uppercase tracking-wider text-blue-200/60">Coming soon</p>
          {LATER.map(({ label, icon: Icon }) => (
            <span
              key={label}
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-blue-100/40"
            >
              <Icon className="h-5 w-5" />
              <span className="flex-1">{label}</span>
              <SoonTag />
            </span>
          ))}
        </nav>
        <div className="mt-4 rounded-2xl bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm font-bold">{initials}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{partner?.name || "New partner"}</p>
              <p className="truncate text-xs text-blue-200/80">{partner?.phone}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={askLogout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-2 text-sm font-medium text-blue-50 hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>

      {/* ── mobile top bar ── */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur lg:hidden">
        <Brand />
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0B2A6F] text-sm font-bold text-white"
          >
            {initials}
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="absolute right-0 top-12 w-60 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl"
              >
                <p className="truncate text-sm font-semibold text-slate-900">{partner?.name || "New partner"}</p>
                <p className="text-xs text-slate-500">{partner?.phone}</p>
                <div className="mt-2">
                  <StatusChip status={partner?.status} kind="partner" />
                </div>
                <div className="mt-3 border-t border-slate-100 pt-2">
                  <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Coming soon</p>
                  {LATER.map(({ label, icon: Icon }) => (
                    <span key={label} className="flex items-center gap-2 px-1 py-1.5 text-sm text-slate-400">
                      <Icon className="h-4 w-4" /> <span className="flex-1">{label}</span> <SoonTag />
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={askLogout}
                  className="mt-2 flex w-full items-center gap-2 rounded-lg px-1 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  <LogOut className="h-4 w-4" /> Log out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <main className={cx("lg:pl-64", inWizard ? "pb-6" : "pb-24 lg:pb-10")}>
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Suspense fallback={<FullPageSpinner />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* ── mobile bottom nav ── */}
      {!inWizard && (
        <nav
          aria-label="Partner portal"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          {NAV.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  "relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
                  isActive ? "text-[#E85D04]" : "text-slate-500",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="bottom-active" className="absolute top-0 h-0.5 w-10 rounded-full bg-[#FF7A00]" />
                  )}
                  <Icon className="h-5 w-5" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
      {confirmDialog}
    </div>
  );
}
