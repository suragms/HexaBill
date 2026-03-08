import React, { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { isSystemAdmin } from './utils/superAdmin'
import { canAccessPage, isOwner } from './utils/roles'
import { getApiBaseUrlNoSuffix } from './services/apiConfig'
import Login from './pages/Login'
import Dashboard from './pages/company/DashboardTally'
import ProductsPage from './pages/company/ProductsPage'
import PriceList from './pages/company/PriceList'
import PurchasesPage from './pages/company/PurchasesPage'
import SuppliersPage from './pages/company/SuppliersPage'
import SupplierDetailPage from './pages/company/SupplierDetailPage'
import PosPage from './pages/company/PosPage'
import CustomerLedgerPage from './pages/company/CustomerLedgerPage'
import ExpensesPage from './pages/company/ExpensesPage'
import ReportsPage from './pages/company/ReportsPage'
import WorksheetPage from './pages/company/WorksheetPage'
import SalesLedgerPage from './pages/company/SalesLedgerPage'
import BillingHistoryPage from './pages/company/BillingHistoryPage'
import SettingsPage from './pages/company/SettingsPage'
import AuditLogPage from './pages/company/AuditLogPage'
import UsersPage from './pages/company/UsersPage'
import BackupPage from './pages/company/BackupPage'
import ProfilePage from './pages/company/ProfilePage'
import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard'
import SuperAdminTenantsPage from './pages/superadmin/SuperAdminTenantsPage'
import SuperAdminTenantDetailPage from './pages/superadmin/SuperAdminTenantDetailPage'
import SuperAdminDemoRequestsPage from './pages/superadmin/SuperAdminDemoRequestsPage'
import SuperAdminHealthPage from './pages/superadmin/SuperAdminHealthPage'
import SuperAdminErrorLogsPage from './pages/superadmin/SuperAdminErrorLogsPage'
import SuperAdminAuditLogsPage from './pages/superadmin/SuperAdminAuditLogsPage'
import SuperAdminSettingsPage from './pages/superadmin/SuperAdminSettingsPage'
import SuperAdminGlobalSearchPage from './pages/superadmin/SuperAdminGlobalSearchPage'
import SuperAdminSqlConsolePage from './pages/superadmin/SuperAdminSqlConsolePage'
import BranchesPage from './pages/company/BranchesPage'
import BranchDetailPage from './pages/company/BranchDetailPage'
import RoutesPage from './pages/company/RoutesPage'
import RouteDetailPage from './pages/company/RouteDetailPage'
import ReturnCreatePage from './pages/company/ReturnCreatePage'
import CustomersPage from './pages/company/CustomersPage'
import CustomerDetailPage from './pages/company/CustomerDetailPage'
import SignupPage from './pages/SignupPage'
import OnboardingWizard from './pages/OnboardingWizard'
import ErrorPage from './pages/ErrorPage'
import HelpPage from './pages/HelpPage'
import FeedbackPage from './pages/FeedbackPage'
import Layout from './components/Layout'
import { BranchesRoutesProvider } from './contexts/BranchesRoutesContext'
import SuperAdminLayout from './components/SuperAdminLayout'
import ConnectionStatus from './components/ConnectionStatus'
import ErrorBoundary from './components/ErrorBoundary'
import { MaintenanceOverlay } from './components/MaintenanceOverlay'

function App() {
  const { user, loading, impersonatedTenantId } = useAuth()
  const location = useLocation()

  // BUG #3 FIX: Keep-alive ping every 9 minutes to prevent Render cold starts
  // Render Starter plan sleeps after 15 minutes, so ping at 9 minutes keeps it awake
  useEffect(() => {
    if (!user) return // Only ping when user is logged in

    const pingHealth = async () => {
      try {
        const apiBase = getApiBaseUrlNoSuffix()
        await fetch(`${apiBase}/health`, {
          method: 'GET',
          cache: 'no-cache',
          signal: AbortSignal.timeout(5000) // 5 second timeout
        }).catch(() => {
          // Silently fail - don't show errors for keep-alive pings
        })
      } catch {
        // Silently fail - keep-alive is best-effort
      }
    }

    // Ping immediately, then every 9 minutes (540000ms)
    pingHealth()
    const interval = setInterval(pingHealth, 540000)

    return () => clearInterval(interval)
  }, [user])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  // Public routes (no auth required) - Marketing pages moved to separate site
  const publicRoutes = ['/signup', '/login', '/Admin26']
  const isPublicRoute = publicRoutes.includes(location.pathname)

  // Show signup/login pages for public routes
  if (isPublicRoute) {
    return (
      <ErrorBoundary>
        <MaintenanceOverlay />
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/Admin26" element={<Login isSuperAdminLogin={true} />} />
        </Routes>
      </ErrorBoundary>
    )
  }

  // Redirect to login if not authenticated
  if (!user) {
    if (location.pathname.startsWith('/superadmin') || location.pathname === '/Admin26') {
      return <Navigate to="/Admin26" replace />
    }
    return <Navigate to="/login" replace />
  }

  // CRITICAL: Check if user is SuperAdmin
  const userIsSystemAdmin = isSystemAdmin(user)

  // CRITICAL: Redirect root based on role
  const getRootPath = () => {
    if (userIsSystemAdmin) return '/superadmin/dashboard'
    return '/dashboard'
  }

  // Staff cannot access Branches or Routes (list or detail) — redirect to dashboard; no deep-link bypass
  const path = (location.pathname || '').replace(/\/+$/, '') || '/'
  const isStaffOnly = user?.role?.toLowerCase() === 'staff' && !userIsSystemAdmin && !impersonatedTenantId
  const isBranchesOrRoutes =
    path === '/branches' || path.startsWith('/branches/') ||
    path === '/routes' || path.startsWith('/routes/')
  if (isStaffOnly && isBranchesOrRoutes) {
    return <Navigate to="/dashboard" replace />
  }

  // Owner-only: Worksheet page — only Owner and SystemAdmin can access
  if (path === '/worksheet' && !isOwner(user)) {
    return <Navigate to="/dashboard" replace />
  }

  // Staff page-level access: redirect if they don't have permission for this page
  const getPageIdForPath = (p) => {
    if (p === '/pos') return 'pos'
    if (p === '/ledger') return 'invoices'
    if (p === '/sales-ledger' || p.startsWith('/reports')) return 'reports'
    if (p === '/products' || p === '/pricelist') return 'products'
    if (p === '/customers' || p.startsWith('/customers/')) return 'customers'
    if (p === '/expenses') return 'expenses'
    if (p === '/users') return 'users'
    if (p === '/settings') return 'settings'
    if (p === '/backup') return 'backup'
    if (p === '/purchases') return 'purchases'
    if (p === '/suppliers' || p.startsWith('/suppliers/')) return 'purchases'
    return null
  }
  const resolvedPageId = getPageIdForPath(path)
  const staffPageDenied = isStaffOnly && resolvedPageId && !canAccessPage(user, resolvedPageId)
  if (staffPageDenied) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <ErrorBoundary>
      <MaintenanceOverlay />
      <ConnectionStatus />
      <Routes>
        <Route path="/" element={<Navigate to={getRootPath()} replace />} />
        {/* Onboarding wizard */}
        <Route path="/onboarding" element={<OnboardingWizard />} />

        {/* Super Admin routes - Only accessible to SystemAdmin with SuperAdminLayout */}
        {userIsSystemAdmin && (
          <Route element={<SuperAdminLayout />}>
            <Route path="/superadmin/dashboard" element={<SuperAdminDashboard />} />
            <Route path="/superadmin/tenants" element={<SuperAdminTenantsPage />} />
            <Route path="/superadmin/tenants/:id" element={<SuperAdminTenantDetailPage />} />
            <Route path="/superadmin/demo-requests" element={<SuperAdminDemoRequestsPage />} />
            <Route path="/superadmin/health" element={<SuperAdminHealthPage />} />
            <Route path="/superadmin/error-logs" element={<SuperAdminErrorLogsPage />} />
            <Route path="/superadmin/audit-logs" element={<SuperAdminAuditLogsPage />} />
            <Route path="/superadmin/settings" element={<SuperAdminSettingsPage />} />
            <Route path="/superadmin/search" element={<SuperAdminGlobalSearchPage />} />
            <Route path="/superadmin/sql-console" element={<SuperAdminSqlConsolePage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
          </Route>
        )}

        {/* Tenant routes - Accessible to standard users OR impersonating SystemAdmin */}
        {(!userIsSystemAdmin || !!impersonatedTenantId) && (
          <>
            {/* All pages including Dashboard use Layout with sidebar - BranchesRoutesProvider caches branches/routes to prevent 429 */}
            <Route element={<BranchesRoutesProvider><Layout /></BranchesRoutesProvider>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/pricelist" element={<PriceList />} />
              <Route path="/purchases" element={<PurchasesPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/suppliers/:name" element={<SupplierDetailPage />} />
              <Route path="/pos" element={<PosPage />} />
              <Route path="/ledger" element={<CustomerLedgerPage />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/sales-ledger" element={<SalesLedgerPage />} />
              <Route path="/billing-history" element={<BillingHistoryPage />} />
              <Route path="/recurring-invoices" element={<Navigate to="/dashboard" replace />} />
              <Route path="/returns/create" element={<ReturnCreatePage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/reports/outstanding" element={<ReportsPage />} />
              <Route path="/worksheet" element={<WorksheetPage />} />
              {/* Staff cannot access branches/routes — redirect (defense in depth with early return above) */}
              <Route path="/branches" element={isStaffOnly ? <Navigate to="/dashboard" replace /> : <BranchesPage />} />
              <Route path="/branches/:id" element={isStaffOnly ? <Navigate to="/dashboard" replace /> : <BranchDetailPage />} />
              <Route path="/routes" element={isStaffOnly ? <Navigate to="/dashboard" replace /> : <RoutesPage />} />
              <Route path="/routes/:id" element={isStaffOnly ? <Navigate to="/dashboard" replace /> : <RouteDetailPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/customers/:id" element={<CustomerDetailPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/audit" element={<AuditLogPage />} />
              <Route path="/backup" element={<BackupPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/feedback" element={<FeedbackPage />} />
            </Route>
          </>
        )}

        {/* Redirect SystemAdmin trying to access tenant routes WITHOUT impersonation */}
        {userIsSystemAdmin && !impersonatedTenantId && (
          <>
            <Route path="/dashboard" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/products" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/pos" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/ledger" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/expenses" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/purchases" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/suppliers" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/suppliers/:name" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/reports" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/billing-history" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/recurring-invoices" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/audit" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/worksheet" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/branches" element={<Navigate to="/superadmin/dashboard" replace />} />
            <Route path="/routes" element={<Navigate to="/superadmin/dashboard" replace />} />
          </>
        )}

        <Route path="*" element={<ErrorPage />} />
      </Routes>
    </ErrorBoundary>
  )
}

export default App
