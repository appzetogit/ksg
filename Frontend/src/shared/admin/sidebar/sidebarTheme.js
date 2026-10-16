/**
 * One look for every admin panel's sidebar (Master/Food/Quick/Medical, Taxi,
 * Services, Hotel). Each panel came from a different codebase and drew its own rail;
 * they now all read these tokens and class helpers, so a change here retunes them all.
 *
 * Tokens are CSS custom properties on `.admin-sidebar-root`; class helpers return
 * Tailwind strings that only reference those tokens.
 */

export const SIDEBAR_ROOT_CLASS = "admin-sidebar-root"

export const SIDEBAR_CSS = `
  .admin-sidebar-root {
    --sb-surface: #F7F9FD;
    --sb-surface-raised: #FFFFFF;
    --sb-border: #E2E8F3;
    --sb-hover: #FFF1E3;
    --sb-ink: #0B1B3F;
    --sb-ink-soft: #33415C;
    --sb-ink-faint: #5A6680;
    --sb-active-bg: #0B2A6F;
    --sb-active-ink: #FFFFFF;
  }
  @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes expandDown {
    from { opacity: 0; max-height: 0; transform: translateY(-10px); }
    to { opacity: 1; max-height: 500px; transform: translateY(0); }
  }
  .menu-item-animate { animation: slideIn 0.3s ease-out forwards; }
  .submenu-animate { animation: expandDown 0.3s ease-out forwards; }
  .admin-sidebar-scroll {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
    scrollbar-width: thin;
    scrollbar-color: rgba(92, 82, 71, 0.3) transparent;
  }
  .admin-sidebar-scroll::-webkit-scrollbar { width: 2px; }
  .admin-sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
  .admin-sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(92, 82, 71, 0.25); border-radius: 10px; transition: background 0.2s ease; }
  .admin-sidebar-scroll::-webkit-scrollbar-thumb:hover { background: rgba(92, 82, 71, 0.45); }
  .admin-sidebar-scroll:hover::-webkit-scrollbar { width: 6px; }
  .admin-sidebar-root a:focus-visible,
  .admin-sidebar-root button:focus-visible { outline: 2px solid var(--sb-ink); outline-offset: 2px; border-radius: 0.5rem; }
  @media (prefers-reduced-motion: reduce) {
    .admin-sidebar-root *, .admin-sidebar-root *::before, .admin-sidebar-root *::after {
      animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important; scroll-behavior: auto !important;
    }
    .admin-sidebar-root .menu-item-animate, .admin-sidebar-root .submenu-animate {
      animation: none !important; opacity: 1 !important; max-height: none !important; transform: none !important;
    }
  }
`

/** Outer rail: fixed, full height, 320px (80px collapsed). */
export const sbRoot = (collapsed = false) =>
  [
    SIDEBAR_ROOT_CLASS,
    "bg-[var(--sb-surface)] border-r border-[var(--sb-border)] h-screen flex flex-col overflow-hidden",
    "transition-[width] duration-300 ease-in-out",
    collapsed ? "w-20" : "w-80",
  ].join(" ")

/** Section heading inside the menu (HOME, FOOD MANAGEMENT, ...). */
export const sbSectionLabel =
  "px-3 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-[var(--sb-ink-faint)]"

/** A top-level menu row. */
export const sbItem = (active) =>
  [
    "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
    active
      ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] font-semibold shadow-sm"
      : "font-medium text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-ink)]",
  ].join(" ")

/** Icon inside a top-level row. */
export const sbItemIcon = (active) =>
  ["h-4 w-4 shrink-0", active ? "text-[var(--sb-active-ink)]" : "text-[var(--sb-ink-faint)] group-hover:text-[var(--sb-ink)]"].join(" ")

/** A nested (sub-menu) row. */
export const sbSubItem = (active) =>
  [
    "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-all duration-200",
    active
      ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] font-semibold"
      : "text-[var(--sb-ink-soft)] hover:bg-[var(--sb-hover)] hover:text-[var(--sb-ink)]",
  ].join(" ")

/** The vertical guide line a sub-menu hangs from. */
export const sbSubList = "ml-5 mt-1 space-y-0.5 border-l border-[var(--sb-border)] pl-3"
