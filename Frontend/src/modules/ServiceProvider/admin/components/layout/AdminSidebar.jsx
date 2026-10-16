import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiHome,
  FiUsers,
  FiBriefcase,
  FiUser,
  FiShoppingBag,
  FiGrid,
  FiDollarSign,
  FiFileText,
  FiBell,
  FiSettings,
  FiChevronDown,
  FiX,
  FiPackage,
  FiTrash2,
  FiStar,
  FiShield,
} from "react-icons/fi";
import { UtensilsCrossed, Truck, Wrench, ShoppingBasket, Pill, ChevronDown, BedDouble } from "lucide-react";
import { canOpenHotelPanel } from "@/modules/Hotel/admin/hotelAccess";
import adminMenu from "../../config/adminMenu.json";
import dashboardService from "../../services/dashboardService";
import { getSettings } from "../../services/settingsService";
import { getCachedSettings, loadBusinessSettings, normalizeCompanyName } from "@food/utils/businessSettings";
import { useSettings } from "../../../../Taxi/shared/context/SettingsContext";
import quickSpicyLogo from "@food/assets/ksg-logo.png";
import { SidebarStyles, SidebarHeader, PanelSwitcher, SidebarSearch, matchesQuery } from "@/shared/admin/sidebar/SidebarParts";
import { SIDEBAR_ROOT_CLASS } from "@/shared/admin/sidebar/sidebarTheme";

// Icon mapping for menu items
const iconMap = {
  Dashboard: FiHome,
  Users: FiUsers,
  Vendors: FiBriefcase,
  Workers: FiUser,
  Bookings: FiShoppingBag,
  "User Catalog": FiGrid,
  "Vendor Services": FiGrid,
  "Vendor Parts": FiPackage,
  Payments: FiDollarSign,
  Reports: FiFileText,
  Notifications: FiBell,
  "Scrap Items": FiTrash2,
  Reviews: FiStar,
  Settlements: FiDollarSign,
  Settings: FiSettings,
  Plans: FiPackage,
  "Worker Plans": FiBriefcase,
  Legal: FiShield,
};

// Helper function to convert child name to route path
const getChildRoute = (parentRoute, childName) => {
  const routeMap = {
    "/admin/sp/users": {
      "All Users": "/admin/sp/users/all",
      "User Bookings": "/admin/sp/users/bookings",
      "Transactions": "/admin/sp/users/transactions",
      "User Analytics": "/admin/sp/users/analytics",
    },
    "/admin/sp/vendors": {
      "All Vendors": "/admin/sp/vendors/all",
      "Vendor Bookings": "/admin/sp/vendors/bookings",
      "Vendor Analytics": "/admin/sp/vendors/analytics",
      "Vendor Payments": "/admin/sp/vendors/payments",
    },
    "/admin/sp/workers": {
      "All Workers": "/admin/sp/workers/all",
      "Worker Jobs": "/admin/sp/workers/jobs",
      "Worker Analytics": "/admin/sp/workers/analytics",
      "Worker Payments": "/admin/sp/workers/payments",
    },
    "/admin/sp/bookings": {
      "All Bookings": "/admin/sp/bookings",
      "Booking Tracking": "/admin/sp/bookings/tracking",
      "Booking Notifications": "/admin/sp/bookings/notifications",
    },
    "/admin/sp/user-categories": {
      "Home": "/admin/sp/user-categories/home",
      "Manage Categories": "/admin/sp/user-categories/categories",
      "Manage Brands": "/admin/sp/user-categories/brands",
      "Manage Services": "/admin/sp/user-categories/sections",
    },
    "/admin/sp/payments": {
      "Payment Overview": "/admin/sp/payments/overview",
      "User Payments": "/admin/sp/payments/users",
      "Worker Payments": "/admin/sp/payments/workers",
      "Vendor Payments": "/admin/sp/payments/vendors",
      "Admin Revenue": "/admin/sp/payments/revenue",
      "Payment Reports": "/admin/sp/payments/reports",
    },
    "/admin/sp/reports": {
      "Revenue Report": "/admin/sp/reports/revenue",
      "Booking Report": "/admin/sp/reports/bookings",
      "Payment Report": "/admin/sp/payments/reports",
    },
    "/admin/sp/notifications": {
      "Push Notifications": "/admin/sp/notifications/push",
      "Custom Messages": "/admin/sp/notifications/messages",
      "Notification Settings": "/admin/sp/notifications/settings",
    },
    "/admin/sp/settings": {
      "General Settings": "/admin/sp/settings/general",
      "Worker Assignment": "/admin/sp/settings/worker-assignment",
      "Service Configuration": "/admin/sp/settings/service-config",
      "System Settings": "/admin/sp/settings/system",
    },
    "/admin/sp/settlements": {
      "Pending": "/admin/sp/settlements/pending",
      "Withdrawals": "/admin/sp/settlements/withdrawals",
      "Vendors with Due": "/admin/sp/settlements/vendors",
      "History": "/admin/sp/settlements/history",
    },
    "/admin/sp/legal": {
      "Terms & Conditions": "/admin/sp/legal/terms",
      "Privacy Policy": "/admin/sp/legal/privacy",
      "Support": "/admin/sp/legal/support",
    },
  };

  return routeMap[parentRoute]?.[childName] || parentRoute;
};

const AdminSidebar = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedItems, setExpandedItems] = useState({});
  const [isMobile, setIsMobile] = useState(false);
  const [adminUser, setAdminUser] = useState({ name: 'Admin', email: '', role: 'admin' });
  const [counts, setCounts] = useState({
    bookings: 0,
    vendors: 0,
    withdrawals: 0,
    pendingSettlements: 0,
    scraps: 0
  });
  const [isWorkerMode, setIsWorkerMode] = useState(false);
  const [businessCompanyName, setBusinessCompanyName] = useState(() => {
    const cached = getCachedSettings();
    return normalizeCompanyName(cached?.companyName) || 'KSG';
  });
  const [logoUrl, setLogoUrl] = useState(() => getCachedSettings()?.logo?.url || null);

  useEffect(() => {
    const syncName = () => {
      const cached = getCachedSettings();
      if (cached?.companyName) {
        setBusinessCompanyName(normalizeCompanyName(cached.companyName));
      }
      if (cached?.logo?.url) {
        setLogoUrl(cached.logo.url);
      }
    };
    syncName();
    loadBusinessSettings().then((s) => {
      if (s?.companyName) {
        setBusinessCompanyName(normalizeCompanyName(s.companyName));
      }
      if (s?.logo?.url) {
        setLogoUrl(s.logo.url);
      }
    }).catch(() => {});
    window.addEventListener('businessSettingsUpdated', syncName);
    return () => window.removeEventListener('businessSettingsUpdated', syncName);
  }, []);

  const servicesTitle = businessCompanyName.toLowerCase().endsWith('services')
    ? businessCompanyName
    : `${businessCompanyName} Services`;

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await getSettings();
        if (res.success && res.settings) {
          setIsWorkerMode(res.settings.bookingModel === 'worker');
        }
      } catch (error) {
        console.error("Error fetching settings for sidebar:", error);
      }
    };
    fetchSettings();
  }, []);

  // Load admin user from storage
  useEffect(() => {
    try {
      const storedData = sessionStorage.getItem('adminData') || localStorage.getItem('adminData');
      const stored = JSON.parse(storedData || '{}');
      if (stored.name || stored.email) {
        setAdminUser({
          name: stored.name || 'Admin',
          email: stored.email || '',
          role: stored.role || 'admin'
        });
      }
    } catch (e) {
      console.error('Failed to parse admin data:', e);
    }
  }, []);

  // Filter menu items by role and settings
  const filteredMenu = useMemo(() => {
    return adminMenu.filter(item => {
      if (item.isHidden) return false;
      if (item.title === 'Scrap Items' || item.title === 'Plans') return false; // Hiding Scrap Items and Plans
      if (isWorkerMode && (item.title === 'Vendors' || item.title === 'Vendor Services' || item.title === 'Vendor Parts')) {
        return false;
      }
      if (!item.allowedRoles) return true;
      return item.allowedRoles.includes(adminUser.role);
    }).map(item => {
      if (isWorkerMode && item.children) {
        return {
          ...item,
          children: item.children.filter(child =>
            !child.includes('Vendor') &&
            child !== 'Vendors with Due'
          )
        };
      }
      return item;
    });
  }, [adminUser.role, isWorkerMode]);

  // Fetch pending counts for badges
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const response = await dashboardService.getStats();
        if (response.success && response.data?.stats) {
          const stats = response.data.stats;
          setCounts({
            bookings: stats.pendingBookings || 0,
            vendors: stats.pendingVendors || 0,
            withdrawals: stats.pendingWithdrawals || 0,
            pendingSettlements: stats.pendingSettlements || 0,
            scraps: stats.pendingScraps || 0
          });
        }
      } catch (error) {
        console.error("Error fetching sidebar counts:", error);
      }
    };

    fetchCounts();
    // Refresh every 30 seconds
    const interval = setInterval(fetchCounts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Auto-close sidebar on mobile when route changes
  // Auto-close sidebar on mobile when route changes
  useEffect(() => {
    // Only close if screen is small (mobile)
    if (window.innerWidth < 1024) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]); // Remove onClose to prevent re-triggering when parent re-renders

  // Auto-expand menu items when their route is active
  useEffect(() => {
    const activeItem = filteredMenu.find((item) => {
      if (item.route === "/admin/sp/dashboard") {
        return location.pathname === "/admin/sp/dashboard";
      }
      const isChildRoute =
        location.pathname.startsWith(item.route) &&
        location.pathname !== item.route;
      return isChildRoute;
    });
    if (activeItem && activeItem.children && activeItem.children.length > 0) {
      setExpandedItems((prev) => {
        if (prev[activeItem.title]) {
          return prev;
        }
        return {
          [activeItem.title]: true,
        };
      });
    }
  }, [location.pathname, filteredMenu]);

  // Check if a menu item is active
  const isActive = (route) => {
    if (route === "/admin/sp/dashboard") {
      return location.pathname === "/admin/sp/dashboard";
    }

    // Special case for User Catalog to avoid overlap with Vendor Services/Parts
    if (route === "/admin/sp/user-categories") {
      if (location.pathname.startsWith("/admin/sp/user-categories/vendor-")) {
        return false;
      }
    }

    // Strict prefix check: either exact match OR followed by a slash
    return location.pathname === route || location.pathname.startsWith(route + '/');
  };

  // Toggle expanded state for menu items with children
  const toggleExpand = (title, closeOthers = true) => {
    setExpandedItems((prev) => {
      if (closeOthers) {
        return {
          [title]: !prev[title],
        };
      } else {
        return {
          ...prev,
          [title]: !prev[title],
        };
      }
    });
  };

  // Handle menu item click
  const handleMenuItemClick = (route, parentTitle = null) => {
    if (parentTitle) {
      setExpandedItems((prev) => {
        return {
          [parentTitle]: true,
        };
      });
    }
    navigate(route);
    if (window.innerWidth < 1024) {
      onClose();
    }
  };

  // Render menu item
  const renderMenuItem = (item) => {
    const Icon = iconMap[item.title] || FiHome;
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems[item.title];
    const active = isActive(item.route);

    return (
      <div key={item.route} className="mb-1">
        {/* Main Menu Item */}
        <div
          className={`
            flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer text-sm
            ${active
              ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] font-semibold shadow-sm"
              : "text-[var(--sb-ink-soft)] hover:text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
            }
          `}
          onClick={() => {
            if (hasChildren) {
              toggleExpand(item.title, true);
            } else {
              handleMenuItemClick(item.route);
            }
          }}>
          <Icon
            className={`w-4 h-4 flex-shrink-0 ${active ? "text-[var(--sb-active-ink)]" : "text-[var(--sb-ink-soft)]"
              }`}
          />
          <span className="font-semibold flex-1 text-sm">{item.title}</span>

          {/* Badge Display */}
          {item.title === "Bookings" && counts.bookings > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse mr-2">
              {counts.bookings > 99 ? '99+' : counts.bookings}
            </span>
          )}
          {item.title === "Vendors" && counts.vendors > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse mr-2">
              {counts.vendors > 99 ? '99+' : counts.vendors}
            </span>
          )}
          {item.title === "Settlements" && (counts.withdrawals + counts.pendingSettlements) > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse mr-2">
              {(counts.withdrawals + counts.pendingSettlements) > 99 ? '99+' : (counts.withdrawals + counts.pendingSettlements)}
            </span>
          )}
          {item.title === "Scrap Items" && counts.scraps > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse mr-2">
              {counts.scraps > 99 ? '99+' : counts.scraps}
            </span>
          )}

          {hasChildren && (
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}>
              <ChevronDown className="text-[var(--sb-ink-faint)] w-4 h-4" />
            </motion.div>
          )}
        </div>

        {/* Children Items */}
        <AnimatePresence>
          {hasChildren && isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden">
              <div className="ml-5 mt-1 pl-3 border-l border-[var(--sb-border)] space-y-0.5">
                {item.children.map((child, index) => {
                  const childRoute = getChildRoute(item.route, child);
                  const isChildActive =
                    location.pathname === childRoute ||
                    (childRoute !== item.route &&
                      location.pathname.startsWith(childRoute));

                  return (
                    <div
                      key={index}
                      onClick={() =>
                        handleMenuItemClick(childRoute, item.title)
                      }
                      className={`
                        px-3 py-1.5 text-[13px] rounded-lg transition-colors cursor-pointer flex justify-between items-center
                        ${isChildActive
                          ? "bg-[var(--sb-active-bg)] text-[var(--sb-active-ink)] font-semibold"
                          : "text-[var(--sb-ink-soft)] hover:text-[var(--sb-ink)] hover:bg-[var(--sb-hover)]"
                        }
                      `}>
                      <span>{child}</span>
                      {item.title === "Settlements" && child === "Pending" && counts.pendingSettlements > 0 && (
                        <span className="bg-red-500 text-white text-[10px] h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full">
                          {counts.pendingSettlements}
                        </span>
                      )}
                      {item.title === "Settlements" && child === "Withdrawals" && counts.withdrawals > 0 && (
                        <span className="bg-orange-500 text-white text-[10px] h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full">
                          {counts.withdrawals}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const { activeLogo, settings: appSettings } = useSettings() || {};
  const effectiveLogo = activeLogo || appSettings?.customization?.logos?.admin || appSettings?.logos?.admin || appSettings?.customization?.logos?.landing || logoUrl || quickSpicyLogo;

  // Menu search (the same box every panel has).
  const [menuQuery, setMenuQuery] = useState('');
  const searchedMenu = menuQuery.trim()
    ? filteredMenu.filter((item) => matchesQuery(menuQuery, item.title, ...(item.children || [])))
    : filteredMenu;

  // Sidebar content
  const sidebarContent = (
    <div className={`${SIDEBAR_ROOT_CLASS} h-full w-full flex flex-col bg-[var(--sb-surface)] border-r border-[var(--sb-border)] overflow-hidden`}>
      <SidebarStyles />
      {/* Header, panel switcher and search: shared by every admin panel. */}
      <SidebarHeader
        title={servicesTitle}
        logoSrc={effectiveLogo}
        roleLabel={adminUser.role === 'super_admin' ? 'Super Admin' : 'System Admin'}
        onClose={onClose}
      >
        <PanelSwitcher active="sp" />
        <SidebarSearch value={menuQuery} onChange={setMenuQuery} />
      </SidebarHeader>

      {/* Navigation Menu */}
      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-3 admin-sidebar-scroll space-y-0.5">
        {searchedMenu.length === 0 && menuQuery.trim() && (
          <p className="px-3 py-10 text-sm font-medium text-[var(--sb-ink-soft)]">No menu items found</p>
        )}
        {searchedMenu.map((item) => renderMenuItem(item))}
      </nav>
    </div>
  );

  return (
    <>
      {/* Mobile: Overlay Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-[99998] lg:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {/* Sidebar - Mobile Drawer */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed left-0 top-0 bottom-0 w-80 z-[99999] lg:hidden shadow-2xl"
          >
            {sidebarContent}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar - Desktop Fixed */}
      <div
        className="hidden lg:flex fixed left-0 top-0 bottom-0 z-30 w-80"
      >
        {sidebarContent}
      </div>
    </>
  );
};

export default AdminSidebar;


