import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  Home,
  Package,
  ShoppingCart,
  CreditCard,
  Users,
  DollarSign,
  TrendingUp,
  Settings,
  Menu,
  X,
  LogOut,
  Bell,
  Search,
  DollarSign as PriceTag,
  Shield,
  BarChart3,
  Truck,
  FileText,
  BookOpen,
  Receipt,
  User,
  ChevronDown,
  Lock,
  Building2,
  LayoutDashboard,
  MapPin,
  Printer,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Archive,
  History,
  ClipboardList
} from 'lucide-react'
import BottomNav from './BottomNav'
import Logo from './Logo'
import AlertNotifications from './AlertNotifications'
import { SubscriptionGraceBanner } from './SubscriptionGraceBanner'
import { connectionManager } from '../services/connectionManager'
import { isAdminOrOwner, isOwner, isStaff } from '../utils/roles'  // CRITICAL: Multi-tenant role checking
import { isSystemAdmin } from '../utils/superAdmin'  // Super Admin checking
import { useBranding } from '../contexts/TenantBrandingContext'

const Layout = () => {
  const { user, logout, impersonatedTenantId, stopImpersonation } = useAuth()
  const { companyName } = useBranding()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true'
  })
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)
  const [backendUnavailable, setBackendUnavailable] = useState(() => !connectionManager.isConnected)

  useEffect(() => {
    const unsub = connectionManager.onStatusChange((connected) => setBackendUnavailable(!connected))
    setBackendUnavailable(!connectionManager.isConnected)
    return () => { if (unsub) unsub() }
  }, [])

  // Phase 6: Ping to update LastActiveAt for staff online indicator (when app is in foreground)
  useEffect(() => {
    if (!user?.id) return
    const ping = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        import('../services').then(({ usersAPI }) => usersAPI.pingMe().catch(() => {}))
      }
    }
    ping()
    const interval = setInterval(ping, 180000) // Increased from 90s to 180s (3 minutes) to reduce API requests
    return () => clearInterval(interval)
  }, [user?.id])

  const toggleSidebar = () => {
    const newState = !isSidebarCollapsed
    setIsSidebarCollapsed(newState)
    localStorage.setItem('sidebar_collapsed', String(newState))
  }
  const profileDropdownRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target)) {
        setShowProfileDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Global keyboard shortcuts (work on any tenant page; skip when typing in inputs)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target?.tagName?.toUpperCase()
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!e.target?.isContentEditable
      if (inInput) return

      const ctrlOrMeta = e.ctrlKey || e.metaKey
      if (ctrlOrMeta) {
        const key = (e.key || '').toLowerCase()
        if (key === 's') {
          e.preventDefault()
          if (isAdminOrOwner(user)) navigate('/settings')
          return
        }
        if (key === 'b') {
          e.preventDefault()
          if (isAdminOrOwner(user)) navigate('/backup')
          return
        }
        if (key === 'u') {
          e.preventDefault()
          if (isAdminOrOwner(user)) navigate('/users')
          return
        }
        return
      }

      switch (e.key) {
        case 'F1':
          e.preventDefault()
          navigate('/products')
          break
        case 'F3':
          e.preventDefault()
          navigate('/pos')
          break
        case 'F4':
          e.preventDefault()
          if (isAdminOrOwner(user)) navigate('/purchases')
          break
        case 'F5':
          e.preventDefault()
          navigate('/expenses')
          break
        case 'F7':
          e.preventDefault()
          if (isAdminOrOwner(user)) navigate('/reports?tab=sales')
          break
        case 'F8':
          e.preventDefault()
          if (isAdminOrOwner(user)) navigate('/reports?tab=profit-loss')
          break
        case 'F9':
          e.preventDefault()
          if (isAdminOrOwner(user)) navigate('/reports?tab=outstanding')
          break
        case 'F10':
          e.preventDefault()
          navigate('/ledger')
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [user, navigate])

  // CRITICAL: SystemAdmin should ONLY see tenant navigation if they are impersonating
  const userIsSystemAdmin = isSystemAdmin(user)
  const selectedTenantId = impersonatedTenantId
  const selectedTenantName = localStorage.getItem('selected_tenant_name')

  // If SystemAdmin but NOT impersonating, redirect to SuperAdmin dashboard
  if (userIsSystemAdmin && !selectedTenantId) {
    return null // SystemAdmin should use SuperAdminLayout, not this Layout
  }

  const handleExitImpersonation = async () => {
    const tenantId = selectedTenantId
    const tenantName = selectedTenantName
    try {
      const { superAdminAPI } = await import('../services')
      await superAdminAPI.impersonateExit(tenantId || undefined, tenantName || undefined)
    } catch (_) { /* Audit logging failure should not block */ }
    stopImpersonation()
    localStorage.removeItem('selected_tenant_name')
    navigate('/superadmin/dashboard')
  }

  // Tenant navigation - Order follows owner workflow: Dashboard → Branches & Routes → Users → Products → … (see OWNER_WORKFLOW.md)
  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    ...(isAdminOrOwner(user) ? [{ name: 'Branches & Routes', href: '/branches', icon: LayoutGrid }] : []),
    ...(isAdminOrOwner(user) ? [{ name: 'Users', href: '/users', icon: Shield }] : []),
    { name: 'Products', href: '/products', icon: Package },
    ...(isAdminOrOwner(user) ? [{ name: 'Purchases', href: '/purchases', icon: Truck }] : []),
    ...(isAdminOrOwner(user) ? [{ name: 'Suppliers', href: '/suppliers', icon: Building2 }] : []),
    { name: 'POS', href: '/pos', icon: ShoppingCart },
    { name: 'Customer Ledger', href: '/ledger', icon: BookOpen },
    { name: 'Sales Ledger', href: '/sales-ledger', icon: FileText },
    ...(isAdminOrOwner(user) ? [
        { name: 'Billing History', href: '/billing-history', icon: History }
      ] : []),
    { name: 'Expenses', href: '/expenses', icon: Receipt },
    ...(isAdminOrOwner(user) ? [{ name: 'Reports', href: '/reports', icon: BarChart3 }] : []),
    ...(isOwner(user) ? [{ name: 'Worksheet', href: '/worksheet', icon: FileText }] : []),
    ...(isAdminOrOwner(user) ? [{ name: 'Settings', href: '/settings', icon: Settings }] : []),
    ...(isAdminOrOwner(user) ? [{ name: 'Activity log', href: '/audit', icon: ClipboardList }] : []),
    ...(isAdminOrOwner(user) ? [{ name: 'Backup & Restore', href: '/backup', icon: Archive }] : []),
    { name: 'Help & Support', href: '/help', icon: HelpCircle },
  ]

  const isActive = (href) => {
    if (location.pathname === href) return true
    // Keep Branches/ Routes nav active when on detail pages
    if (href === '/branches' && (location.pathname.startsWith('/branches/') || location.pathname.startsWith('/routes/'))) return true
    // Keep Suppliers nav active when on supplier detail
    if (href === '/suppliers' && location.pathname.startsWith('/suppliers/')) return true
    return false
  }

  return (
    <div className="min-h-screen bg-neutral-50 overflow-x-hidden">
      {/* Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:text-primary-600"
      >
        Skip to main content
      </a>
      {/* Impersonation Banner */}
      {userIsSystemAdmin && selectedTenantId && (
        <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between sticky top-0 z-[100] shadow-md border-b border-amber-600">
          <div className="flex items-center space-x-2">
            <Shield className="h-4 w-4" />
            <span className="text-sm font-bold">Platform Admin Mode:</span>
            <span className="text-sm">Viewing data for <strong>{selectedTenantName || 'selected company'}</strong></span>
          </div>
          <button
            onClick={handleExitImpersonation}
            className="bg-white text-amber-600 px-3 py-1 rounded-md text-xs font-bold hover:bg-amber-50 transition-colors flex items-center space-x-1"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Exit & Return to Admin</span>
          </button>
        </div>
      )}

      {/* Mobile Header with Hamburger Menu */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-primary-900 text-white border-b border-primary-800 z-50">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setSidebarOpen(true)
            }}
            className="p-2 rounded-lg hover:bg-primary-800 active:bg-primary-700 transition-colors touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1 flex justify-center min-w-0">
            <span className="text-sm font-semibold truncate">{companyName}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              navigate('/profile')
            }}
            className="p-2 rounded-lg hover:bg-primary-800 active:bg-primary-700 transition-colors touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Profile"
          >
            <User className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[60] lg:hidden"
          aria-modal="true"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={() => setSidebarOpen(false)}
            onTouchEnd={() => setSidebarOpen(false)}
          />
          {/* Sidebar panel */}
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col bg-primary-900 text-white border-r border-primary-800 transform transition-transform duration-300 ease-in-out">
            <div className="flex h-14 items-center justify-between px-4 border-b border-primary-800">
              <span className="text-lg font-semibold text-white">Menu</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-2 rounded-lg hover:bg-primary-800 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-hide">
              {navigation.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center px-4 py-3 text-base font-medium rounded-lg touch-manipulation min-h-[44px] ${active
                      ? 'bg-primary-600 text-white'
                      : 'text-primary-200 hover:bg-primary-800 hover:text-white'
                      }`}
                  >
                    <Icon className="mr-4 h-5 w-5 flex-shrink-0" />
                    {item.name}
                  </Link>
                )
              })}
            </nav>
            <div className="border-t border-primary-800 p-4 space-y-2">
              <Link
                to="/profile"
                onClick={() => setSidebarOpen(false)}
                className="flex items-center px-4 py-3 text-base font-medium rounded-lg text-primary-200 hover:bg-primary-800 hover:text-white touch-manipulation min-h-[44px]"
              >
                <User className="mr-4 h-5 w-5 flex-shrink-0" />
                My Profile
              </Link>
              <button
                type="button"
                onClick={() => {
                  setSidebarOpen(false)
                  logout()
                }}
                className="flex items-center w-full px-4 py-3 text-base text-error/90 hover:text-white hover:bg-error rounded-lg touch-manipulation min-h-[44px]"
              >
                <LogOut className="mr-4 h-5 w-5 flex-shrink-0" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar - 240px per design system (Task 11) */}
      <div className={`hidden lg:fixed lg:inset-y-0 lg:flex lg:flex-col lg:min-h-0 transition-all duration-300 ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-60'}`}>
        <div className="flex flex-col flex-grow bg-primary-900 text-white border-r border-primary-800 min-h-screen overflow-hidden w-full">
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto min-h-0 scrollbar-hide">
            {navigation.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex items-center ${isSidebarCollapsed ? 'justify-center px-2' : 'px-4'} py-3 text-sm font-medium rounded-lg transition-colors min-h-[44px] ${isActive(item.href)
                    ? 'bg-primary-600 text-white'
                    : 'text-primary-200 hover:bg-primary-800 hover:text-white'
                    }`}
                  title={item.name}
                >
                  <Icon className={`h-5 w-5 flex-shrink-0 ${isSidebarCollapsed ? '' : 'mr-3'}`} />
                  {!isSidebarCollapsed && <span className="truncate">{item.name}</span>}
                </Link>
              )
            })}
          </nav>
          <div className="border-t border-primary-800 p-3">
            <button
              onClick={logout}
              className={`flex items-center w-full ${isSidebarCollapsed ? 'justify-center px-2' : 'px-4'} py-3 text-sm text-primary-200 hover:text-white hover:bg-primary-800 rounded-lg transition-colors min-h-[44px]`}
              title="Logout"
            >
              <LogOut className={`h-5 w-5 flex-shrink-0 ${isSidebarCollapsed ? '' : 'mr-3'}`} />
              {!isSidebarCollapsed && <span>Logout</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Main content - Full viewport after sidebar (Task 11: 240px sidebar) */}
      <div className={`flex flex-col min-h-screen w-full transition-all duration-300 ${isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-60'}`}>
        {backendUnavailable && (
          <div className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-100 border-b border-amber-200 text-amber-900 text-sm text-left">
            <span className="font-medium">Service temporarily unavailable.</span>
            <span>Service is temporarily unavailable. Please try again in a moment or contact your administrator.</span>
          </div>
        )}
        <SubscriptionGraceBanner />
        {/* Top Header Bar for Other Pages - Similar to Dashboard */}
        <div className={`hidden lg:block fixed top-0 right-0 h-16 bg-primary-900 text-white border-b border-primary-800 z-30 transition-all duration-300 ${isSidebarCollapsed ? 'left-20' : 'left-60'}`}>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center space-x-3 flex-1 min-w-0">
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded-lg hover:bg-primary-800 text-primary-200 hover:text-white transition-colors"
                title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              >
                <Menu className="h-5 w-5" />
              </button>
              <Logo size="default" showText={false} className="flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <h1 className="text-base xl:text-lg font-semibold text-white truncate">{companyName}</h1>
              </div>
            </div>
            <div className="flex items-center space-x-1.5 flex-shrink-0">
              {isAdminOrOwner(user) && <AlertNotifications />}
              {isAdminOrOwner(user) && (
                <>
                  <button
                    onClick={() => navigate('/backup')}
                    className="p-2 hover:bg-primary-800 rounded-lg transition flex items-center justify-center min-h-[44px] min-w-[44px]"
                    title="Backup & Restore — Download or restore your data"
                    aria-label="Backup and restore data"
                  >
                    <Archive className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => navigate('/settings')}
                    className="p-2 hover:bg-primary-800 rounded-lg transition flex items-center justify-center min-h-[44px] min-w-[44px]"
                    title="Company settings — Manage preferences, logo, currency"
                    aria-label="Company settings"
                  >
                    <Settings className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => navigate('/reports?tab=profit-loss')}
                    className="p-2 hover:bg-primary-800 rounded-lg transition flex items-center justify-center min-h-[44px] min-w-[44px]"
                    title="Profit & Loss report — View revenue, expenses, profit"
                    aria-label="Profit and loss report"
                  >
                    <TrendingUp className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => navigate('/users')}
                    className="p-2 hover:bg-primary-800 rounded-lg transition flex items-center justify-center min-h-[44px] min-w-[44px]"
                    title="Users — Manage staff and permissions"
                    aria-label="Manage users"
                  >
                    <Users className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="p-2 hover:bg-primary-800 rounded-lg transition flex items-center justify-center min-h-[44px] min-w-[44px]"
                    title="Print this page"
                    aria-label="Print current page"
                  >
                    <Printer className="h-5 w-5" />
                  </button>
                </>
              )}
              {!isAdminOrOwner(user) && (
                <button
                  onClick={() => window.print()}
                  className="p-2 hover:bg-primary-800 rounded-lg transition flex items-center justify-center min-h-[44px] min-w-[44px]"
                  title="Print this page"
                  aria-label="Print"
                >
                  <Printer className="h-5 w-5" />
                </button>
              )}
              <div className="relative ml-2" ref={profileDropdownRef}>
                <button
                  onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                  className="flex items-center space-x-2 px-3 py-1.5 hover:bg-primary-800 rounded-lg transition min-h-[44px]"
                  aria-label="User profile menu"
                  aria-expanded={showProfileDropdown}
                >
                  <div className="hidden md:block text-right">
                    <p className="text-xs font-medium text-white">{user?.name || 'User'}</p>
                    <p className="text-xs text-primary-200">{user?.role || 'Staff'}</p>
                  </div>
                  <div className="h-8 w-8 rounded-full bg-neutral-700 flex items-center justify-center">
                    <User className="h-4 w-4" />
                  </div>
                  <ChevronDown className="h-4 w-4" />
                </button>
                {showProfileDropdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-md border border-primary-200 py-1 z-50">
                    <div className="px-4 py-3 border-b border-primary-200">
                      <p className="text-sm font-medium text-primary-800">{user?.name}</p>
                      <p className="text-xs text-primary-600">{user?.role}</p>
                    </div>
                    <button
                      onClick={() => {
                        navigate('/profile')
                        setShowProfileDropdown(false)
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-primary-700 hover:bg-primary-50 flex items-center"
                    >
                      <User className="h-4 w-4 mr-2" />
                      My Profile
                    </button>
                    {isAdminOrOwner(user) && (
                      <button
                        onClick={() => {
                          navigate('/settings')
                          setShowProfileDropdown(false)
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-primary-700 hover:bg-primary-50 flex items-center"
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Settings
                      </button>
                    )}
                    <div className="border-t border-primary-200 my-1" />
                    <button
                      onClick={() => {
                        logout()
                        setShowProfileDropdown(false)
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-error hover:bg-error/10 flex items-center"
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Page content — full width max 1400px; Reports use full width (production plan Phase 2) */}
        <main id="main-content" className="flex-1 w-full min-w-0 flex flex-col overflow-hidden pb-20 lg:pb-6 pt-14 lg:pt-20 bg-[#F8FAFC]">
          <div className="flex-1 overflow-auto">
            <div className={`w-full min-h-full mx-auto px-4 sm:px-6 lg:px-6 py-4 lg:py-6 ${location.pathname === '/reports' || location.pathname === '/suppliers' || location.pathname.startsWith('/suppliers/') ? 'max-w-full' : 'max-w-[1280px]'}`}>
              <Outlet />
            </div>
          </div>
        </main>
        {/* Mobile Bottom Navigation */}
        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>
    </div>
  )
}

export default Layout
