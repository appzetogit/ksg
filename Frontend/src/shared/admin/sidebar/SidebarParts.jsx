import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import {
  BedDouble,
  ChevronLeft,
  ChevronRight,
  Pill,
  Search,
  ShoppingBasket,
  SlidersHorizontal,
  Truck,
  UtensilsCrossed,
  Wrench,
  X,
} from "lucide-react"
import ksgLogo from "@food/assets/ksg-logo.png"
import { masterSidebarMenu } from "@food/utils/masterSidebarMenu"
import { filterMenuForAccess, hasPanel, isRestricted, useAdminAccess } from "@food/utils/adminAccess"
import { HOTEL_ENABLED, SERVICE_PROVIDER_ENABLED } from "@/config/features"
import { SIDEBAR_CSS } from "./sidebarTheme"

/* Shared pieces of every admin panel's sidebar. See sidebarTheme.js. */

/** Injects the shared sidebar stylesheet. Render once inside each sidebar. */
export function SidebarStyles() {
  return <style>{SIDEBAR_CSS}</style>
}

/** Logo, panel title, role line, collapse and (mobile) close buttons. */
export function SidebarHeader({ title, logoSrc, roleLabel, collapsed = false, onToggleCollapse, onClose, children }) {
  const src = logoSrc || ksgLogo
  const onError = (e) => {
    if (!e.target.src.endsWith(ksgLogo)) e.target.src = ksgLogo
  }
  return (
    <div className="shrink-0 border-b border-[var(--sb-border)] bg-[var(--sb-surface-raised)] px-3 py-3">
      <div className={collapsed ? "flex flex-col items-center gap-2" : "mb-3 flex items-center justify-between"}>
        <div className="flex min-w-0 items-center gap-3.5">
          <div
            className={
              collapsed
                ? "flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--sb-hover)] ring-1 ring-[var(--sb-border)]"
                : "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--sb-border)] bg-[var(--sb-hover)] p-1"
            }
          >
            <img src={src} alt={title} onError={onError} className={collapsed ? "h-9 w-9 object-contain" : "h-9 w-9 object-contain"} />
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col">
              <h3 className="truncate text-[15px] font-extrabold leading-tight tracking-tight text-[var(--sb-ink)]">{title}</h3>
              {roleLabel && (
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--sb-ink-faint)]">{roleLabel}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden rounded-lg p-1.5 text-[var(--sb-ink-soft)] transition-all duration-200 hover:bg-[var(--sb-hover)] hover:text-[var(--sb-ink)] lg:block"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="rounded-lg p-1.5 text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-ink)] lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      {!collapsed && children}
    </div>
  )
}

/**
 * Which panels this admin may open. Same rules the Food sidebar always used:
 * a restricted (sub-)admin gets exactly the panels in their access record; anyone
 * else gets what the stored session lists (or everything for platform superadmins
 * and legacy sessions), narrowed by which modules this site has switched on.
 */
function useStoredServices() {
  return useMemo(() => {
    const all = { food: true, taxi: true, serviceProvider: true, quickCommerce: true, hotel: true }
    try {
      const raw = localStorage.getItem("admin_user") || sessionStorage.getItem("admin_user")
      if (!raw) return all
      const admin = JSON.parse(raw)
      const list = admin?.servicesAccess
      if (!Array.isArray(list) || list.length === 0 || admin?.adminLevel === "platform_superadmin") return all
      return {
        food: list.includes("food"),
        taxi: list.includes("taxi"),
        serviceProvider: list.includes("serviceProvider"),
        quickCommerce: list.includes("quickCommerce"),
        hotel: list.includes("hotel"),
      }
    } catch {
      return all
    }
  }, [])
}

export function usePanelAccess() {
  const access = useAdminAccess()
  const stored = useStoredServices()
  const masterEntry = useMemo(() => {
    const items = (filterMenuForAccess(masterSidebarMenu, access) || [])
      .flatMap((section) => section.items || [])
      .flatMap((item) => (item.path ? [item] : item.subItems || []))
    return items[0]?.path || null
  }, [access])
  const services = isRestricted(access)
    ? {
        food: hasPanel(access, "food"),
        taxi: hasPanel(access, "taxi"),
        serviceProvider: SERVICE_PROVIDER_ENABLED && hasPanel(access, "serviceProvider"),
        quickCommerce: hasPanel(access, "quickCommerce"),
        medical: hasPanel(access, "medical"),
        hotel: HOTEL_ENABLED && hasPanel(access, "hotel"),
      }
    : {
        ...stored,
        medical: stored.quickCommerce,
        serviceProvider: SERVICE_PROVIDER_ENABLED && stored.serviceProvider !== false,
        hotel: HOTEL_ENABLED && stored.hotel !== false,
      }
  return { access, masterEntry, services, restricted: isRestricted(access) }
}

const PANELS = [
  { key: "master", label: "Master", icon: SlidersHorizontal },
  { key: "food", label: "Food", icon: UtensilsCrossed, to: "/admin/food", service: "food" },
  { key: "taxi", label: "Taxi", icon: Truck, to: "/taxi/admin/dashboard", service: "taxi" },
  { key: "sp", label: "Services", icon: Wrench, to: "/admin/sp/dashboard", service: "serviceProvider" },
  { key: "quick", label: "Quick", icon: ShoppingBasket, to: "/admin/quick-commerce", service: "quickCommerce" },
  { key: "medical", label: "Medical", icon: Pill, to: "/admin/medical", service: "medical" },
  { key: "hotel", label: "Hotel", icon: BedDouble, to: "/admin/hotel/dashboard", service: "hotel" },
]

/** Which panel a path belongs to (for highlighting the current tab). */
export const panelForPath = (pathname = "") => {
  if (pathname.startsWith("/admin/master")) return "master"
  if (pathname.startsWith("/taxi")) return "taxi"
  if (pathname.startsWith("/admin/sp")) return "sp"
  if (pathname.startsWith("/admin/quick-commerce")) return "quick"
  if (pathname.startsWith("/admin/medical")) return "medical"
  if (pathname.startsWith("/admin/hotel")) return "hotel"
  return "food"
}

/** "Admin panel" label plus the tab grid for switching between panels. */
export function PanelSwitcher({ active }) {
  const navigate = useNavigate()
  const { masterEntry, services } = usePanelAccess()
  const tabs = PANELS.filter((p) => (p.key === "master" ? Boolean(masterEntry) : services[p.service])).map((p) =>
    p.key === "master" ? { ...p, to: masterEntry } : p,
  )
  if (tabs.length <= 1) return null
  const cols = tabs.length <= 3 ? "grid-cols-3" : tabs.length <= 4 ? "grid-cols-4" : tabs.length <= 6 ? "grid-cols-3" : "grid-cols-4"
  return (
    <>
      <h2 className="mb-2 text-left text-xs font-bold uppercase tracking-widest text-[var(--sb-ink-faint)]">Admin panel</h2>
      <div className={`mb-3 grid ${cols} gap-1 rounded-xl border border-[var(--sb-border)] bg-[var(--sb-surface-raised)] p-1.5 shadow-inner`}>
        {tabs.map(({ key, label, icon: Icon, to }) => {
          const on = key === active
          return (
            <button
              key={key}
              type="button"
              onClick={() => to && navigate(to)}
              aria-current={on ? "page" : undefined}
              className={[
                "flex w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg px-1 py-2.5 text-[11px] font-bold leading-none transition-all duration-300",
                on
                  ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] shadow-[0_2px_8px_rgba(26,26,26,0.18)]"
                  : "text-[var(--sb-ink-faint)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-ink-soft)]",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-full truncate">{label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/** The menu search box. */
export function SidebarSearch({ value, onChange, placeholder = "Search menu..." }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sb-ink-faint)]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search menu"
        className={[
          "w-full rounded-lg border border-[var(--sb-border)] bg-[var(--sb-surface-raised)] py-2 pl-9 text-left text-sm text-[var(--sb-ink)] placeholder:text-[var(--sb-ink-faint)] transition-all duration-200 focus:border-[var(--sb-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--sb-ink)]",
          value ? "pr-9" : "pr-3",
        ].join(" ")}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--sb-ink-faint)] hover:text-[var(--sb-ink)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/** Case-insensitive match helper for menu search. */
export const matchesQuery = (query, ...texts) => {
  const q = String(query || "").trim().toLowerCase()
  if (!q) return true
  return texts.some((t) => String(t || "").toLowerCase().includes(q))
}
