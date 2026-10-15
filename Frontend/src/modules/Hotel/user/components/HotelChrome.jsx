import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Heart, Home, LogIn, Luggage, ArrowLeft, LayoutGrid, Utensils, Car, Sparkles } from "lucide-react";
import ksgLogo from "@/modules/LandingPage/assets/ksg-logo.jpg";
import { cx } from "./ui";
import Popover, { useOutsideClose } from "./Popover";
import { LOGIN_PATH, PROFILE_PATH, getUserProfile, getUserToken } from "../lib/session";

const LINKS = [
  { to: "/hotel", label: "Home", icon: Home, end: true },
  { to: "/hotel/stays", label: "My stays", icon: Luggage },
  { to: "/hotel/saved", label: "Saved", icon: Heart },
];

// The rest of KSG, one tap away from the hotel header.
const KSG_SERVICES = [
  { to: "/", label: "KSG home", sub: "All services", icon: Sparkles },
  { to: "/food/user", label: "Food", sub: "Order from restaurants", icon: Utensils },
  { to: "/taxi/user", label: "Rides", sub: "Bike, auto & cab", icon: Car },
];

function KsgServicesMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutsideClose(ref, open, close);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="KSG services"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 sm:px-3"
      >
        <LayoutGrid className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" />
        <span className="hidden md:inline">Services</span>
      </button>
      <Popover open={open} onClose={close} label="KSG services" align="right" className="sm:w-72">
        <ul className="space-y-1">
          {KSG_SERVICES.map(({ to, label, sub, icon: Icon }) => (
            <li key={to}>
              <Link to={to} onClick={close} className="flex items-center gap-3 rounded-xl p-2.5 transition hover:bg-slate-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0B2A6F]/5 text-[#0B2A6F]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">{label}</span>
                  <span className="block text-xs text-slate-500">{sub}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

export function HotelHeader() {
  const location = useLocation();
  const [session, setSession] = useState(() => ({ token: getUserToken(), user: getUserProfile() }));
  useEffect(() => {
    const sync = () => setSession({ token: getUserToken(), user: getUserProfile() });
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const name = String(session.user?.name || "").trim();
  const initial = (name[0] || "U").toUpperCase();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/90 backdrop-blur-md supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/hotel" className="flex shrink-0 items-center gap-2.5" aria-label="KSG Stays home">
          <img src={ksgLogo} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow-md" width="40" height="40" />
          <span className="leading-tight">
            <span className="block text-base font-extrabold tracking-tight text-[#0B2A6F]">
              KSG <span className="text-[#FF7A00]">Stays</span>
            </span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 sm:block">Hotels & homestays</span>
          </span>
        </Link>

        <nav aria-label="Hotel" className="flex items-center gap-0.5 sm:gap-1">
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                cx(
                  "relative flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-semibold transition sm:px-3",
                  isActive ? "text-[#0B2A6F]" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" />
                  <span className="hidden md:inline">{label}</span>
                  {isActive && <span className="absolute inset-x-3 -bottom-[13px] h-[3px] rounded-full bg-[#FF7A00]" aria-hidden="true" />}
                </>
              )}
            </NavLink>
          ))}
          <KsgServicesMenu />
          {session.token ? (
            <Link
              to={PROFILE_PATH}
              className="ml-1 flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-1 transition hover:border-[#0B2A6F] md:pr-3"
              aria-label={`Profile${name ? `: ${name}` : ""}`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#0B2A6F] to-[#1E3A8A] text-sm font-bold text-white">
                {initial}
              </span>
              <span className="hidden max-w-[120px] truncate text-sm font-semibold text-slate-700 md:inline">{name || "Profile"}</span>
            </Link>
          ) : (
            <Link
              to={LOGIN_PATH}
              state={{ from: { pathname: `${location.pathname}${location.search}` } }}
              className="ml-1 inline-flex items-center gap-1.5 rounded-xl bg-[#0B2A6F] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#071A47]"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span>Login</span>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function HotelFooter() {
  return (
    <footer className="border-t border-slate-200 bg-[#071A47] text-white/80">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm sm:flex-row sm:px-6">
        <div className="flex items-center gap-3">
          <img src={ksgLogo} alt="" className="h-9 w-9 rounded-full object-cover" width="36" height="36" />
          <div>
            <div className="font-semibold text-white">KSG Stays</div>
            <div className="text-xs text-white/60">Verified hotels, resorts & homestays</div>
          </div>
        </div>
        <Link to="/" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2 font-semibold text-white transition hover:bg-white/10">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All KSG services
        </Link>
        <div className="text-xs text-white/50">© {new Date().getFullYear()} KSG Sons and Services Pvt Ltd</div>
      </div>
    </footer>
  );
}
