import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  TrendingDown,
  Package,
  DollarSign,
  AlertTriangle,
  Plus,
  Download,
  RefreshCw,
  Eye,
  FileText,
  UserPlus,
  Receipt,
  Database,
  CheckCircle,
  XCircle,
  ShoppingCart,
  CreditCard,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Activity,
  BookOpen,
  Wallet,
  User,
  Menu,
  Shield
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useBranding } from '../../contexts/TenantBrandingContext'
import { formatCurrency } from '../../utils/currency'
import { showToast } from '../../utils/toast'
import { isAdminOrOwner, isOwner } from '../../utils/roles'  // CRITICAL: Multi-tenant role checking
import { LoadingCard } from '../../components/Loading'
import { StatCard, KpiSkeleton, EmptyState } from '../../components/ui'
import { branchesAPI, routesAPI, adminAPI, reportsAPI, productsAPI } from '../../services'

// ... imports remain the same

const Dashboard = () => {
  const { user, logout } = useAuth()
  const { companyName } = useBranding()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState({
    salesToday: 0,
    purchasesToday: 0,
    expensesToday: 0,
    profitToday: 0,
    pendingBillsCount: 0,
    pendingBillsAmount: 0,
    paidBillsCount: 0,
    paidBillsAmount: 0,
    salesChange: 0,
    purchasesChange: 0,
    expensesChange: 0,
    profitChange: 0
  })
  const [salesData, setSalesData] = useState([])
  const [lowStockProducts, setLowStockProducts] = useState([])
  const [pendingBills, setPendingBills] = useState([])
  const [aiSuggestions, setAiSuggestions] = useState(null)
  const [pendingFilter, setPendingFilter] = useState('all')
  const [pendingSearch, setPendingSearch] = useState('')
  const [dbStatus, setDbStatus] = useState(true)
  const [lastBackup, setLastBackup] = useState(null)
  const [backupLoading, setBackupLoading] = useState(false)
  // Period for KPI cards: 'today' | 'week' | 'month'
  const [summaryPeriod, setSummaryPeriod] = useState('today')

  // Allocations Data for Admin
  const [allocations, setAllocations] = useState({ branches: [], routes: [], users: [] })

  // Dashboard Item Permissions Logic
  const staffPermissionList = useMemo(() => {
    const raw = user?.dashboardPermissions
    if (raw === null || raw === undefined || String(raw).trim() === '') return []
    return String(raw).split(',').map(s => s.trim()).filter(Boolean)
  }, [user?.dashboardPermissions])

  const staffHasNoPermissions = user?.role === 'Staff' && staffPermissionList.length === 0

  // Default items when Staff has no permissions (avoid blank dashboard); include expenses so staff can add expense
  const DEFAULT_STAFF_VIEW_ITEMS = ['quickActions', 'salesLedger', 'salesToday', 'expenses']

  const canShow = (itemId) => {
    // Only Owners and SystemAdmins bypass all permission checks
    if (isOwner(user)) return true

    // If permissions array doesn't exist (legacy), show everything
    if (user?.dashboardPermissions === null || user?.dashboardPermissions === undefined) return true

    // Staff with no permissions: show default basic view so dashboard isn't blank
    if (staffHasNoPermissions) return DEFAULT_STAFF_VIEW_ITEMS.includes(itemId)

    // Otherwise, check if the specific item ID is in the allowed list
    return staffPermissionList.includes(itemId)
  }

  const fetchDashboardData = async () => {
    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return
    }
    
    try {
      isFetchingRef.current = true
      setLoading(true)
      lastFetchTimeRef.current = Date.now()

      console.log('Fetching dashboard data...')

      // Get date range - use last 30 days to ensure we get data
      const today = new Date()
      const thirtyDaysAgo = new Date(today)
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // Summary date range from period selector
      let summaryFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      let summaryTo = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      if (summaryPeriod === 'week') {
        summaryFrom.setDate(summaryFrom.getDate() - 6)
      } else if (summaryPeriod === 'month') {
        summaryFrom.setDate(1)
      }
      const summaryFromStr = summaryFrom.toISOString().split('T')[0]
      const summaryToStr = summaryTo.toISOString().split('T')[0]

      // For sales chart, use last 7 days
      const salesFrom = new Date(today)
      salesFrom.setDate(salesFrom.getDate() - 7)
      const salesFromDate = salesFrom.toISOString().split('T')[0]
      const salesToDate = today.toISOString().split('T')[0]

      console.log('Date ranges:', {
        summaryFrom: summaryFromStr,
        summaryTo: summaryToStr,
        salesFrom: salesFromDate,
        salesTo: salesToDate
      })

      const summaryResponse = await reportsAPI.getSummaryReport({
        fromDate: summaryFromStr,
        toDate: summaryToStr
      })

      console.log('Summary response:', summaryResponse)

      if (summaryResponse?.success) {
        const data = summaryResponse.data || {}
        console.log('Summary data received:', {
          salesToday: data.salesToday,
          purchasesToday: data.purchasesToday,
          expensesToday: data.expensesToday,
          profitToday: data.profitToday,
          pendingBills: data.pendingBills,
          lowStockCount: data.lowStockProducts?.length
        })

        setSummary({
          salesToday: data.salesToday || 0,
          purchasesToday: data.purchasesToday || 0,
          expensesToday: data.expensesToday || 0,
          profitToday: data.profitToday ?? 0,
          pendingBillsCount: data.pendingBills ?? data.PendingBills ?? 0,
          pendingBillsAmount: data.pendingBillsAmount ?? data.PendingBillsAmount ?? 0,
          paidBillsCount: data.paidBills ?? data.PaidBills ?? 0,
          paidBillsAmount: data.paidBillsAmount ?? data.PaidBillsAmount ?? 0,
          salesChange: 12,
          purchasesChange: 8,
          expensesChange: -5,
          profitChange: 15
        })
        setLowStockProducts(data.lowStockProducts || [])
        
        // Use dailySalesTrend from summary report instead of separate API call
        if (data.dailySalesTrend && Array.isArray(data.dailySalesTrend)) {
          const trendData = data.dailySalesTrend.map(item => ({
            date: item.date || item.Date,
            sales: item.sales || item.Sales || 0
          }))
          console.log('Using dailySalesTrend from summary:', trendData)
          setSalesData(trendData)
        }
      } else {
        console.error('Summary response not successful:', summaryResponse)
        toast.error(summaryResponse?.message || 'Failed to load summary data')
      }

      // CRITICAL: Get ALL pending bills (no date filtering)
      // This ensures backdated invoices show as overdue
      const pendingResponse = await reportsAPI.getPendingBills({
        status: pendingFilter === 'all' ? null : pendingFilter,
        search: pendingSearch || null
      })
      console.log('Pending bills response:', pendingResponse)
      if (pendingResponse?.success) {
        const pendingData = pendingResponse.data || []
        console.log(`Loaded ${pendingData.length} pending bills`)
        setPendingBills(pendingData)
      } else {
        console.error('Pending bills response not successful:', pendingResponse)
      }

      try {
        const aiResponse = await reportsAPI.getAISuggestions({ periodDays: 30 })
        if (aiResponse.success) {
          setAiSuggestions(aiResponse.data)
        }
      } catch (error) {
        console.warn('AI suggestions failed:', error)
        setAiSuggestions(null)
      }

      // REMOVED: Separate sales report call - now using dailySalesTrend from summary report
      // This eliminates duplicate API call and ensures chart respects date filters

      if (isAdminOrOwner(user)) {
        try {
          const backupsResponse = await adminAPI.getBackups()
          if (backupsResponse.success && backupsResponse.data?.length > 0) {
            setLastBackup(backupsResponse.data[0])
          }

          // OPTIMIZATION: Use batch endpoint to fetch branches, routes, and users in one call
          // This reduces 3 API calls to 1, reducing server load and improving performance
          try {
            const batchResponse = await reportsAPI.getDashboardBatch({
              fromDate: todayFrom,
              toDate: todayTo
            })
            
            if (batchResponse?.success && batchResponse.data) {
              const batchData = batchResponse.data
              // Batch endpoint returns summary, branches, routes, and users
              // Update summary if not already set (batch includes it)
              if (batchData.summary && !summaryResponse?.success) {
                const data = batchData.summary
                setSummary({
                  salesToday: data.salesToday || 0,
                  purchasesToday: data.purchasesToday || 0,
                  expensesToday: data.expensesToday || 0,
                  profitToday: data.profitToday || 0,
                  salesChange: 12,
                  purchasesChange: 8,
                  expensesChange: -5,
                  profitChange: 15
                })
                // Use dailySalesTrend from batch if available
                if (data.dailySalesTrend && Array.isArray(data.dailySalesTrend)) {
                  const trendData = data.dailySalesTrend.map(item => ({
                    date: item.date || item.Date,
                    sales: item.sales || item.Sales || 0
                  }))
                  setSalesData(trendData)
                }
              }
              
              // Set allocations from batch data
              const allUsers = Array.isArray(batchData.users) ? batchData.users : []
              setAllocations({
                branches: batchData.branches || [],
                routes: batchData.routes || [],
                users: allUsers
              })
              console.log('✅ Dashboard batch data loaded successfully')
            } else {
              // Fallback to individual calls if batch fails
              console.warn('Batch endpoint failed, falling back to individual calls')
              const [branchesRes, routesRes, usersRes] = await Promise.all([
                branchesAPI.getBranches(),
                routesAPI.getRoutes(),
                adminAPI.getUsers()
              ])

              if (branchesRes.success && routesRes.success && usersRes.success) {
                const allUsers = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data.items || [])
                setAllocations({
                  branches: branchesRes.data || [],
                  routes: routesRes.data || [],
                  users: allUsers
                })
              }
            }
          } catch (batchError) {
            console.warn('Batch endpoint error, using individual calls:', batchError)
            // Fallback to individual calls
            const [branchesRes, routesRes, usersRes] = await Promise.all([
              branchesAPI.getBranches(),
              routesAPI.getRoutes(),
              adminAPI.getUsers()
            ])

            if (branchesRes.success && routesRes.success && usersRes.success) {
              const allUsers = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data.items || [])
              setAllocations({
                branches: branchesRes.data || [],
                routes: routesRes.data || [],
                users: allUsers
              })
            }
          }

        } catch (error) {
          console.error('Failed to fetch admin dashboard info:', error)
        }
      }

      setDbStatus(true)
    } catch (error) {
      console.error('Dashboard data fetch error:', error)
      toast.error('Failed to load dashboard data')
      setDbStatus(false)
    } finally {
      setLoading(false)
      isFetchingRef.current = false
    }
  }

  // Throttle dashboard refreshes to prevent too many requests
  const lastFetchTimeRef = useRef(0)
  const isFetchingRef = useRef(false)
  const DASHBOARD_THROTTLE_MS = 60000
  const fetchDashboardDataRef = useRef(fetchDashboardData)
  fetchDashboardDataRef.current = fetchDashboardData

  useEffect(() => {
    fetchDashboardData()
  }, [pendingFilter, pendingSearch, summaryPeriod])

  // Auto-refresh dashboard every 120 seconds (uses ref to avoid stale closure)
  useEffect(() => {
    const autoRefreshInterval = setInterval(() => {
      const now = Date.now()
      const timeSinceLastFetch = now - lastFetchTimeRef.current
      if (timeSinceLastFetch >= DASHBOARD_THROTTLE_MS && !isFetchingRef.current) {
        lastFetchTimeRef.current = now
        fetchDashboardDataRef.current()
      }
    }, 120000)

    return () => clearInterval(autoRefreshInterval)
  }, [])

  // Listen for data update events (uses ref to always call latest fetchDashboardData)
  useEffect(() => {
    const handleDataUpdate = () => {
      const now = Date.now()
      const timeSinceLastFetch = now - lastFetchTimeRef.current
      if (timeSinceLastFetch >= 10000 && !isFetchingRef.current) {
        lastFetchTimeRef.current = now
        fetchDashboardDataRef.current()
      }
    }

    window.addEventListener('dataUpdated', handleDataUpdate)
    window.addEventListener('paymentCreated', handleDataUpdate)
    window.addEventListener('customerCreated', handleDataUpdate)

    return () => {
      window.removeEventListener('dataUpdated', handleDataUpdate)
      window.removeEventListener('paymentCreated', handleDataUpdate)
      window.removeEventListener('customerCreated', handleDataUpdate)
    }
  }, [])

  // Listen for connection restored to auto-refresh data
  useEffect(() => {
    const handleConnectionRestored = () => {
      toast.success('Connection restored. Refreshing data...')
      fetchDashboardDataRef.current()
    }
    window.addEventListener('connectionRestored', handleConnectionRestored)
    return () => window.removeEventListener('connectionRestored', handleConnectionRestored)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'b') {
          e.preventDefault()
          navigate('/pos')
        } else if (e.key === 'u') {
          e.preventDefault()
          navigate('/purchases')
        } else if (e.key === 'c') {
          e.preventDefault()
          navigate('/ledger')
        } else if (e.key === 'l') {
          e.preventDefault()
          navigate('/reports')
        } else if (e.key === 'k' && isAdminOrOwner(user)) {
          e.preventDefault()
          handleBackup()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [user, navigate])

  const handleBackup = async () => {
    if (!isAdminOrOwner(user)) return

    setBackupLoading(true)
    try {
      const response = await adminAPI.createBackup()
      if (response.success) {
        toast.success('Backup created successfully!')
        fetchDashboardData()
      } else {
        toast.error(response.message || 'Failed to create backup')
      }
    } catch (error) {
      toast.error('Failed to create backup')
    } finally {
      setBackupLoading(false)
    }
  }

  const filteredPendingBills = useMemo(() => {
    if (!pendingSearch) return pendingBills
    return pendingBills.filter(bill =>
      bill.invoiceNo?.toLowerCase().includes(pendingSearch.toLowerCase()) ||
      bill.customerName?.toLowerCase().includes(pendingSearch.toLowerCase())
    )
  }, [pendingBills, pendingSearch])

  const handleBillClick = (bill) => {
    navigate(`/sales/${bill.id}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-primary-50 overflow-x-hidden">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <div className="h-10 w-48 animate-pulse bg-neutral-200 rounded" />
          <KpiSkeleton />
          <div className="animate-pulse bg-neutral-200 h-[280px] rounded-xl" />
        </div>
      </div>
    )
  }

  if (!summary) {
    return <LoadingCard message="Loading dashboard data..." />
  }

  const isNewUser = !salesData?.length && (summary?.salesToday ?? 0) === 0 && (summary?.pendingBillsCount ?? 0) === 0

  return (
    <div className="min-h-screen bg-primary-50 overflow-x-hidden">
      {/* Header - design lock: border only, no shadow */}
      <div className="bg-white border-b border-primary-200">
        <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10">
          <div className="flex items-center justify-between py-3 sm:h-16">
            <div className="flex items-center min-w-0">
              <BarChart3 className="h-6 w-6 sm:h-8 sm:w-8 text-primary-600 mr-2 sm:mr-3 flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold text-primary-800 truncate">{companyName ? `${companyName} – Dashboard` : 'Dashboard'}</h1>
                <p className="text-xs sm:text-sm text-primary-600 hidden sm:block truncate">Welcome back, {user?.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={fetchDashboardData}
                className="inline-flex items-center justify-center p-2 sm:px-4 sm:py-2 border border-primary-300 rounded-lg text-xs sm:text-sm font-medium text-primary-700 bg-white hover:bg-primary-50 transition-colors min-h-[44px]"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline ml-2">Refresh</span>
              </button>
              {isAdminOrOwner(user) && (
                <button
                  onClick={handleBackup}
                  disabled={backupLoading}
                  className="inline-flex items-center justify-center p-2 sm:px-4 sm:py-2 border border-transparent rounded-lg text-xs sm:text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 transition-colors min-h-[44px]"
                  title="Backup"
                >
                  <Database className="h-4 w-4" />
                  <span className="hidden sm:inline ml-2">{backupLoading ? 'Backing up...' : 'Backup'}</span>
                </button>
              )}
              <button
                onClick={() => navigate('/profile')}
                className="inline-flex items-center justify-center p-2 bg-primary-50 hover:bg-primary-100 text-primary-600 rounded-lg transition-colors min-h-[44px] min-w-[44px]"
                title="My Profile"
              >
                <User className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content — full-width grid: 12 cols desktop, fluid */}
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 space-y-6 lg:space-y-8 overflow-x-hidden">
        {/* Staff with no dashboard permissions: show guidance */}
        {staffHasNoPermissions && (
          <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-5 flex items-start gap-4 shadow-sm">
            <div className="p-2 bg-blue-100 rounded-lg flex-shrink-0">
              <Shield className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-base font-semibold text-blue-900">Staff Access — Limited Dashboard</p>
              <p className="text-sm text-blue-700 mt-1">Your administrator has not yet assigned specific dashboard permissions. You can still use Quick Actions below. Ask your admin to update your permissions in User Management.</p>
            </div>
          </div>
        )}
        {/* Period selector for KPI cards (real data, date-based) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-primary-700">Period:</span>
          {['today', 'week', 'month'].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSummaryPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                summaryPeriod === p
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-primary-200 text-primary-700 hover:bg-primary-50'
              }`}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This week' : 'This month'}
            </button>
          ))}
        </div>
        {/* Row 1: KPI Cards — col-span-3 each on desktop (4 cards) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 lg:gap-6">
          {canShow('salesToday') && (
            <div className="lg:col-span-3">
              <StatCard
                title={summaryPeriod === 'today' ? 'Sales Today' : summaryPeriod === 'week' ? 'Sales (This week)' : 'Sales (This month)'}
                value={summary.salesToday}
                change={summary.salesChange}
                changeType="positive"
                icon={DollarSign}
                iconColor="primary"
              />
            </div>
          )}
          {canShow('expensesToday') && (
            <div className="lg:col-span-3">
              <StatCard
                title={summaryPeriod === 'today' ? 'Expenses Today' : summaryPeriod === 'week' ? 'Expenses (This week)' : 'Expenses (This month)'}
                value={summary.expensesToday}
                change={summary.expensesChange}
                changeType="negative"
                icon={TrendingDown}
                iconColor="primary"
              />
            </div>
          )}
          {canShow('purchasesToday') && (
            <div className="lg:col-span-3">
              <StatCard
                title={summaryPeriod === 'today' ? 'Purchases Today' : summaryPeriod === 'week' ? 'Purchases (This week)' : 'Purchases (This month)'}
                value={summary.purchasesToday}
                change={summary.purchasesChange}
                changeType="positive"
                icon={ShoppingCart}
                iconColor="primary"
              />
            </div>
          )}
          {/* Pending Total Amount - dynamic from summary API (all unpaid) */}
          {canShow('pendingAmount') !== false && (
            <div className="lg:col-span-3">
              <StatCard
                title="Pending Total Amount"
                value={summary.pendingBillsAmount ?? 0}
                changeType="negative"
                icon={CreditCard}
                iconColor="primary"
              />
            </div>
          )}
          {/* Profit Card: STRICTLY Admin/Owner Only. No permissions bypass. */}
          {isAdminOrOwner(user) && canShow('profitToday') && (
            <div className="lg:col-span-3">
              <StatCard
                title={summaryPeriod === 'today' ? 'Profit Today' : summaryPeriod === 'week' ? 'Profit (This week)' : 'Profit (This month)'}
                value={summary.profitToday}
                change={summary.profitChange}
                changeType={summary.profitToday >= 0 ? "positive" : "negative"}
                icon={TrendingUp}
                iconColor="primary"
              />
            </div>
          )}
          {canShow('products') !== false && (
            <div className="lg:col-span-3 bg-white rounded-xl border border-primary-200 p-4 hover:border-primary-300 transition-colors duration-150 flex flex-col gap-3">
              <div className="flex items-center justify-between mb-0">
                <div className="p-2 bg-primary-50 rounded-lg">
                  <Package className="h-5 w-5 text-primary-600" />
                </div>
              </div>
              <h3 className="text-sm font-medium text-primary-600 mb-0">Products</h3>
              <p className="text-sm text-primary-700">Manage products & stock</p>
              <div className="flex flex-col sm:flex-row gap-2 mt-auto">
                <button
                  onClick={() => navigate('/pos')}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors min-h-[44px] text-sm"
                >
                  <Receipt className="h-4 w-4" />
                  Save & Generate Invoice
                </button>
                <button
                  onClick={() => navigate('/products')}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg font-medium text-primary-700 bg-primary-50 border border-primary-200 hover:bg-primary-100 transition-colors min-h-[44px] text-sm"
                >
                  Manage Products
                </button>
              </div>
            </div>
          )}
          {canShow('salesLedger') && (
            <div
              onClick={() => navigate('/sales-ledger')}
              className="lg:col-span-3 cursor-pointer bg-white rounded-xl border border-primary-200 p-4 hover:border-primary-300 hover:bg-primary-50/50 transition-colors duration-150 min-h-[44px]"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 bg-primary-50 rounded-lg">
                  <BookOpen className="h-5 w-5 text-primary-600" />
                </div>
              </div>
              <h3 className="text-sm font-medium text-primary-600 mb-1">Sales Ledger</h3>
              <p className="text-lg font-bold text-primary-800">View</p>
              <p className="text-xs text-primary-600 mt-1 font-medium">Click to open →</p>
            </div>
          )}
          {canShow('expenses') && (
            <div
              onClick={() => navigate('/expenses')}
              className="lg:col-span-3 cursor-pointer bg-white rounded-xl border border-primary-200 p-4 hover:border-primary-300 hover:bg-primary-50/50 transition-colors duration-150 min-h-[44px]"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 bg-primary-50 rounded-lg">
                  <Wallet className="h-5 w-5 text-primary-600" />
                </div>
              </div>
              <h3 className="text-sm font-medium text-primary-600 mb-1">{isAdminOrOwner(user) ? 'Expenses' : 'Add expense'}</h3>
              <p className="text-lg font-bold text-primary-800">{isAdminOrOwner(user) ? 'Manage' : 'Log expense'}</p>
              <p className="text-xs text-primary-600 mt-1 font-medium">Click to open →</p>
            </div>
          )}
        </div>

        {/* Row 2: Sales Chart col-span-8, Alerts/Quick Stats col-span-4 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          {canShow('salesTrend') && (
            <div className={`bg-white rounded-xl border border-primary-200 p-4 md:p-6 min-w-0 ${!canShow('quickStats') ? 'lg:col-span-12' : 'lg:col-span-8'}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-primary-800">Sales Trend</h2>
                <button className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                  View Report
                </button>
              </div>
              <ResponsiveContainer width="100%" height={280} className="min-h-[280px] lg:min-h-[400px]">
                <AreaChart data={salesData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#737373', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis tick={{ fill: '#737373', fontSize: 11 }} tickLine={false} axisLine={false} width={45} tickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`)} />
                  <Tooltip
                    formatter={(value) => formatCurrency(value)}
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #E5E5E5',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      padding: '8px 12px',
                    }}
                    labelStyle={{ fontWeight: 600, color: '#1e40af' }}
                  />
                  <Area
                    type="linear"
                    dataKey="sales"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    fill="url(#colorSales)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {canShow('quickStats') && (
            <div className={`bg-white rounded-xl border border-primary-200 p-4 md:p-6 min-w-0 ${!canShow('salesTrend') ? 'lg:col-span-12' : 'lg:col-span-4'}`}>
              <h2 className="text-lg font-semibold text-primary-800 mb-4">Quick Stats</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg border border-primary-200">
                  <div className="flex items-center min-w-0">
                    <AlertTriangle className="h-5 w-5 text-primary-600 mr-3 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary-800">Unpaid Bills</p>
                      <p className="text-xs text-primary-600 truncate">
                        {summary?.pendingBillsCount || pendingBills.length} customers owe you money
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <span className="text-xl font-bold text-primary-600">{summary?.pendingBillsCount || pendingBills.length}</span>
                    <p className="text-xs text-primary-600">{formatCurrency(summary?.pendingBillsAmount || 0)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg border border-primary-200">
                  <div className="flex items-center min-w-0">
                    <CheckCircle className="h-5 w-5 text-primary-600 mr-3 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary-800">Paid Bills</p>
                      <p className="text-xs text-primary-600">{summary?.paidBillsCount || 0} payments received</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <span className="text-xl font-bold text-primary-600">{summary?.paidBillsCount || 0}</span>
                    <p className="text-xs text-primary-600">{formatCurrency(summary?.paidBillsAmount || 0)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg border border-primary-200">
                  <div className="flex items-center min-w-0">
                    <Package className="h-5 w-5 text-primary-600 mr-3 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary-800">Low Stock Items</p>
                      <p className="text-xs text-primary-600">{lowStockProducts.length} products need restocking</p>
                    </div>
                  </div>
                  <span className="text-xl font-bold text-primary-600 flex-shrink-0">{lowStockProducts.length}</span>
                </div>

                <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg border border-primary-200">
                  <div className="flex items-center min-w-0">
                    <Activity className="h-5 w-5 text-primary-600 mr-3 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary-800">System Status</p>
                      <p className="text-xs text-primary-600">All systems operational</p>
                    </div>
                  </div>
                  <CheckCircle className="h-6 w-6 text-primary-600 flex-shrink-0" />
                </div>

                {lastBackup && (
                  <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg border border-primary-200">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary-800">Last Backup</p>
                      <p className="text-xs text-primary-600">{new Date(lastBackup.createdAt).toLocaleDateString()}</p>
                    </div>
                    <Database className="h-5 w-5 text-primary-500 flex-shrink-0" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Branch & Staff Allocations (Admin Only) */}
        {isAdminOrOwner(user) && allocations.branches.length > 0 && (
          <div className="bg-white rounded-xl border border-primary-200 p-4 md:p-6 min-w-0 w-full mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-primary-800 flex items-center gap-2">
                <Users className="h-5 w-5 text-primary-600" />
                Branch & Staff Allocations
              </h2>
              <button
                onClick={() => navigate('/branches')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Manage
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-primary-600 mb-3 border-b border-primary-100 pb-2">Branch Staff</h3>
                <div className="space-y-3">
                  {allocations.branches.map(branch => {
                    const staffNames = (branch.assignedStaffIds || [])
                      .map(id => allocations.users.find(u => u.id === id)?.name)
                      .filter(Boolean)
                      .join(', ');

                    return (
                      <div key={branch.id} className="flex justify-between items-start text-sm">
                        <span className="font-medium text-primary-800">{branch.name}</span>
                        <span className="text-primary-600 text-right max-w-[60%] truncate">
                          {staffNames || <span className="text-neutral-400 italic">No staff assigned</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-primary-600 mb-3 border-b border-primary-100 pb-2">Route Staff</h3>
                <div className="space-y-3">
                  {allocations.routes.slice(0, 8).map(route => {
                    const staffNames = (route.assignedStaffIds || [])
                      .map(id => allocations.users.find(u => u.id === id)?.name)
                      .filter(Boolean)
                      .join(', ');

                    return (
                      <div key={route.id} className="flex justify-between items-start text-sm">
                        <span className="font-medium text-primary-800">{route.name} <span className="text-xs text-neutral-400">({route.branchName})</span></span>
                        <span className="text-primary-600 text-right max-w-[60%] truncate">
                          {staffNames || <span className="text-neutral-400 italic">No staff assigned</span>}
                        </span>
                      </div>
                    )
                  })}
                  {allocations.routes.length > 8 && (
                    <div className="text-center pt-2">
                      <span className="text-xs text-primary-500 italic">...and {allocations.routes.length - 8} more routes</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Row 3: Low Stock + Quick Actions — full width row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          {canShow('lowStockAlert') && (
            <div className={`bg-white rounded-xl border border-primary-200 p-4 md:p-6 min-w-0 ${!canShow('quickActions') ? 'lg:col-span-12' : 'lg:col-span-6'}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-primary-800">Stock Running Low</h2>
                <button
                  onClick={() => navigate('/products')}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  Add Stock
                </button>
              </div>
              <div className="space-y-4">
                {lowStockProducts.slice(0, 5).map((product) => (
                  <div key={product.id} className="flex items-center justify-between p-3 bg-primary-50 rounded-lg border border-primary-200 hover:bg-primary-100 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary-800 truncate">{product.nameEn}</p>
                      <p className="text-xs text-primary-600 font-medium">Only {product.stockQty} {product.unitType} left – Order more soon!</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-sm font-bold text-primary-600">{product.stockQty} {product.unitType}</p>
                      <p className="text-xs text-primary-500">Min: {product.reorderLevel}</p>
                    </div>
                  </div>
                ))}
                {lowStockProducts.length === 0 && (
                  <div className="text-center py-6">
                    <CheckCircle className="h-12 w-12 text-primary-600 mx-auto mb-2" />
                    <p className="text-primary-600 font-medium">All products have enough stock</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {canShow('quickActions') && (
            <div className={`bg-white rounded-xl border border-primary-200 p-4 md:p-6 min-w-0 ${!canShow('lowStockAlert') ? 'lg:col-span-12' : 'lg:col-span-6'}`}>
              <h2 className="text-lg font-semibold text-primary-800 mb-4">Quick Actions</h2>
              <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => navigate('/pos')}
                  className="flex items-center justify-center p-4 bg-white border border-primary-200 hover:border-primary-300 hover:bg-primary-50 rounded-lg transition-colors duration-150 min-h-[44px]"
                >
                  <ShoppingCart className="h-5 w-5 text-primary-600 mr-2 flex-shrink-0" />
                  <span className="text-sm font-medium text-primary-800">New Invoice</span>
                </button>

                <button
                  onClick={() => navigate('/products')}
                  className="flex items-center justify-center p-4 bg-white border border-primary-200 hover:border-primary-300 hover:bg-primary-50 rounded-lg transition-colors duration-150 min-h-[44px]"
                >
                  <Plus className="h-5 w-5 text-primary-600 mr-2 flex-shrink-0" />
                  <span className="text-sm font-medium text-primary-800">Add Product</span>
                </button>

                <button
                  onClick={() => navigate('/customers')}
                  className="flex items-center justify-center p-4 bg-white border border-primary-200 hover:border-primary-300 hover:bg-primary-50 rounded-lg transition-colors duration-150 min-h-[44px]"
                >
                  <UserPlus className="h-5 w-5 text-primary-600 mr-2 flex-shrink-0" />
                  <span className="text-sm font-medium text-primary-800">Add Customer</span>
                </button>

                <button
                  onClick={() => navigate('/reports')}
                  className="flex items-center justify-center p-4 bg-white border border-primary-200 hover:border-primary-300 hover:bg-primary-50 rounded-lg transition-colors duration-150 min-h-[44px]"
                >
                  <FileText className="h-5 w-5 text-primary-600 mr-2 flex-shrink-0" />
                  <span className="text-sm font-medium text-primary-800">View Reports</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {pendingBills.length > 0 && canShow('pendingBills') && (
          <div className="bg-white rounded-xl border border-primary-200 p-4 md:p-6 min-w-0 w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-primary-800">Customers Who Owe You Money</h2>
              <button
                onClick={() => navigate('/payments')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Collect Payments
              </button>
            </div>
            <div className="overflow-x-auto hidden md:block">
              <table className="min-w-full divide-y divide-primary-200">
                <thead className="bg-primary-50">
                  <tr>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-primary-600 uppercase tracking-wider">Invoice #</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-primary-600 uppercase tracking-wider">Customer</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-primary-600 uppercase tracking-wider">Bill Date</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-primary-600 uppercase tracking-wider">Amount Due</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-primary-600 uppercase tracking-wider">Days Pending</th>
                    <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-primary-600 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-primary-200">
                  {pendingBills.slice(0, 5).map((bill) => (
                    <tr key={bill.id} className="hover:bg-primary-50">
                      <td className="px-4 md:px-6 py-4 whitespace-nowrap text-sm font-medium text-primary-800">{bill.invoiceNo}</td>
                      <td className="px-4 md:px-6 py-4 whitespace-nowrap text-sm text-primary-800">{bill.customerName}</td>
                      <td className="px-4 md:px-6 py-4 whitespace-nowrap text-sm text-primary-500">{new Date(bill.invoiceDate).toLocaleDateString()}</td>
                      <td className="px-4 md:px-6 py-4 whitespace-nowrap text-sm font-semibold text-primary-600">{formatCurrency(bill.balance)}</td>
                      <td className="px-4 md:px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${(bill.daysOverdue || 0) > 30
                          ? 'bg-error/10 text-primary-600'
                          : (bill.daysOverdue || 0) > 15
                            ? 'bg-primary-100 text-primary-600'
                            : 'bg-primary-100 text-primary-600'
                          }`}>
                          {bill.daysOverdue || 0} days old
                        </span>
                      </td>
                      <td className="px-4 md:px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => navigate(`/payments`)}
                          className="text-primary-600 hover:text-primary-700 font-medium"
                        >
                          Get Payment
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-4">
              {pendingBills.slice(0, 5).map((bill) => (
                <div
                  key={bill.id}
                  onClick={() => navigate(`/payments`)}
                  className="bg-white rounded-xl p-4 border border-primary-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-base font-semibold text-primary-800 truncate">{bill.customerName}</h3>
                    <span className="text-lg font-bold text-primary-600 flex-shrink-0 ml-2">{formatCurrency(bill.balance)}</span>
                  </div>
                  <div className="space-y-1 text-sm text-primary-600">
                    <div className="flex items-center justify-between">
                      <span className="text-primary-500">Invoice #:</span>
                      <span className="font-medium text-primary-800">{bill.invoiceNo}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-primary-500">Bill Date:</span>
                      <span className="text-primary-800">{new Date(bill.invoiceDate).toLocaleDateString()}</span>
                    </div>
                    {bill.dueDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-primary-500">Due Date:</span>
                        <span className="text-primary-800">{new Date(bill.dueDate).toLocaleDateString()}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-primary-500">Status:</span>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${(bill.daysOverdue || 0) > 30
                        ? 'bg-error/10 text-primary-600'
                        : 'bg-primary-100 text-primary-600'
                        }`}>
                        {bill.daysOverdue || 0} days old
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div >
  )
}

export default Dashboard

