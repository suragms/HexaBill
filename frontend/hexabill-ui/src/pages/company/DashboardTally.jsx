import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Package, ShoppingCart, Users, Truck, FileText,
    Settings, Database, BarChart3, DollarSign, TrendingUp,
    AlertTriangle, ChevronRight, BookOpen, Wallet,
    Building2, MapPin, RefreshCw, RotateCcw, CheckCircle, X
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import { reportsAPI, alertsAPI } from '../../services'
import { isAdminOrOwner, isOwner } from '../../utils/roles'
import { useBranding } from '../../contexts/TenantBrandingContext'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'

// Helper components defined first so they are never used before initialization (avoids TDZ after minification)
const StatCard = ({ title, value, icon: Icon, color, loading, adminOnly }) => {
    const iconBgClasses = {
        green: 'bg-green-500/10 text-green-600',
        red: 'bg-red-500/10 text-red-600',
        blue: 'bg-blue-500/10 text-blue-600'
    }
    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow duration-200">
            <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-neutral-600 mb-0.5 truncate">{title}</p>
                    {loading ? (
                        <p className="text-sm sm:text-base lg:text-lg font-bold text-neutral-900">...</p>
                    ) : (
                        <p className="text-sm sm:text-base lg:text-lg font-bold text-neutral-900 truncate">{formatCurrency(value)}</p>
                    )}
                </div>
                <div className={`p-2 rounded-lg flex-shrink-0 ${iconBgClasses[color] || iconBgClasses.blue}`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
        </div>
    )
}

const QuickActionButton = ({ icon: Icon, label, onClick, color, shortcut }) => {
    const colorClasses = {
        blue: 'bg-blue-100 hover:bg-blue-200 text-blue-900',
        green: 'bg-green-100 hover:bg-green-200 text-green-900',
        purple: 'bg-purple-100 hover:bg-purple-200 text-purple-900',
        orange: 'bg-orange-100 hover:bg-orange-200 text-orange-900'
    }
    return (
        <button
            onClick={onClick}
            className={`${colorClasses[color]} rounded-lg shadow-md border-2 p-4 sm:p-5 lg:p-6 flex flex-col items-center justify-center space-y-3 hover:shadow-lg transition-all group cursor-pointer min-h-[120px]`}
        >
            <div className={`p-2 sm:p-3 bg-white rounded-lg ${colorClasses[color]} shadow-sm`}>
                <Icon className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8" />
            </div>
            <span className="text-sm sm:text-base font-bold text-center">{label}</span>
            <span className="text-xs opacity-70 group-hover:opacity-100 hidden sm:inline">{shortcut}</span>
        </button>
    )
}

const AlertCard = ({ title, count, icon: Icon, color, onClick }) => {
    const colorClasses = {
        yellow: 'bg-yellow-50 border-yellow-300 text-yellow-900',
        red: 'bg-red-50 border-red-300 text-red-900'
    }
    return (
        <button
            onClick={onClick}
            className={`${colorClasses[color]} rounded-lg shadow-md border-2 p-4 sm:p-5 lg:p-6 w-full text-left hover:shadow-lg transition-all group cursor-pointer`}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 sm:space-x-4 min-w-0 flex-1">
                    <div className={`p-2 sm:p-3 bg-white rounded-lg ${colorClasses[color]} shadow-sm flex-shrink-0`}>
                        <Icon className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm sm:text-base font-bold truncate">{title}</p>
                        <p className="text-2xl sm:text-3xl lg:text-4xl font-bold mt-2">{count}</p>
                    </div>
                </div>
                <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
        </button>
    )
}

const GatewayGroup = ({ group, user, navigate }) => {
    const [expanded, setExpanded] = useState(true)
    const isAdmin = user?.role?.toLowerCase() === 'admin'
    const isOwnerUser = user?.role?.toLowerCase() === 'owner' || user?.role?.toLowerCase() === 'systemadmin'
    const canShowItem = (itemId) => {
        if (isOwnerUser) return true
        // Guard: no permissions string OR empty string → show everything (legacy/default)
        if (!user?.dashboardPermissions || user.dashboardPermissions.trim() === '') return true
        return user.dashboardPermissions.split(',').map(p => p.trim()).includes(itemId)
    }
    const visibleItems = group.items.filter(item => {
        if (item.adminOnly && !isAdmin && !isOwnerUser) return false
        if (item.id && !canShowItem(item.id)) return false
        return true
    })
    return (
        <div className="border-2 border-blue-200 rounded-lg shadow-md overflow-hidden">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full bg-blue-50 hover:bg-blue-100 px-2 sm:px-3 py-1.5 sm:py-2 flex items-center justify-between transition-colors cursor-pointer"
            >
                <h3 className="text-xs sm:text-sm font-bold text-blue-900">{group.title}</h3>
                <ChevronRight className={`h-3 w-3 sm:h-4 sm:w-4 text-blue-700 transform transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
            {expanded && (
                <div className="bg-white divide-y divide-blue-100">
                    {visibleItems.map((item, idx) => {
                        const Icon = item.icon
                        return (
                            <button
                                key={idx}
                                onClick={() => navigate(item.path)}
                                className={`w-full px-2 sm:px-3 py-1.5 sm:py-2 flex items-center justify-between hover:bg-blue-50 transition-colors group cursor-pointer ${item.primary ? 'bg-emerald-50 hover:bg-emerald-100' : ''
                                    }`}
                            >
                                <div className="flex items-center space-x-1.5 sm:space-x-2 min-w-0 flex-1">
                                    <div className={`p-1 sm:p-1.5 rounded-lg flex-shrink-0 ${item.primary ? 'bg-emerald-200' : 'bg-blue-100'
                                        } group-hover:shadow-md transition-shadow`}>
                                        <Icon className="h-3 w-3 sm:h-4 sm:w-4" />
                                    </div>
                                    <div className="text-left min-w-0 flex-1">
                                        <p className="text-xs sm:text-xs font-medium text-gray-900 truncate">{item.label}</p>
                                        <p className="text-xs text-gray-500 hidden sm:block">{item.shortcut}</p>
                                    </div>
                                </div>
                                <ChevronRight className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

const GET_STARTED_DISMISSED_KEY = 'hexabill_get_started_dismissed'

const DashboardTally = () => {
    const { user, logout } = useAuth()
    const { companyName } = useBranding()
    const { branches } = useBranchesRoutes()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [dateRange, setDateRange] = useState('today') // 'today' | 'week' | 'month' | 'custom'
    const [customFromDate, setCustomFromDate] = useState('')
    const [customToDate, setCustomToDate] = useState('')
    const [selectedBranchId, setSelectedBranchId] = useState(null) // For Staff branch filtering
    const availableBranches = branches || []
    const [setupStatus, setSetupStatus] = useState(null)
    const [getStartedDismissed, setGetStartedDismissed] = useState(() => typeof localStorage !== 'undefined' && localStorage.getItem(GET_STARTED_DISMISSED_KEY) === 'true')
    const [stats, setStats] = useState({
        salesToday: 0,
        returnsToday: 0,
        netSalesToday: 0,
        damageLossToday: 0,
        returnsCountToday: 0,
        expensesToday: 0,
        profitToday: 0,
        pendingBills: 0,
        pendingBillsAmount: 0,
        purchasesToday: 0,
        lowStockCount: 0,
        invoicesToday: 0,
        invoicesWeekly: 0,
        invoicesMonthly: 0
    })
    const [branchBreakdown, setBranchBreakdown] = useState([])
    const [dailySalesTrend, setDailySalesTrend] = useState([])
    const [topCustomers, setTopCustomers] = useState([])
    const [topProducts, setTopProducts] = useState([])


    // Request throttling for dashboard
    const lastFetchTimeRef = useRef(0)
    const isFetchingRef = useRef(false)
    const fetchTimeoutRef = useRef(null)
    const DASHBOARD_THROTTLE_MS = 60000 // 60 seconds minimum between dashboard requests (increased from 10s to reduce API requests)

    // Dashboard Item Permissions Logic
    const canShow = (itemId) => {
        // Only Owners and SystemAdmins bypass all permission checks
        if (isOwner(user)) return true

        // Guard: no permissions string OR empty string → show everything (legacy/default)
        if (!user?.dashboardPermissions || user.dashboardPermissions.trim() === '') return true
        return user.dashboardPermissions.split(',').map(p => p.trim()).includes(itemId)
    }

    // Calculate date range based on selected period (must be before fetchStats)
    const getDateRange = () => {
        const today = new Date()
        const todayStr = today.toISOString().split('T')[0]
        switch (dateRange) {
            case 'today': return { from: todayStr, to: todayStr }
            case 'week': {
                const weekStart = new Date(today)
                weekStart.setDate(today.getDate() - today.getDay())
                return { from: weekStart.toISOString().split('T')[0], to: todayStr }
            }
            case 'month': {
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
                return { from: monthStart.toISOString().split('T')[0], to: todayStr }
            }
            case 'custom': {
                if (customFromDate && customToDate) return { from: customFromDate, to: customToDate }
                // Default to last 7 days when Custom selected but dates not yet picked
                const weekAgo = new Date(today)
                weekAgo.setDate(today.getDate() - 6)
                return { from: weekAgo.toISOString().split('T')[0], to: todayStr }
            }
            default: return { from: todayStr, to: todayStr }
        }
    }

    const fetchStats = async (skipCache = false) => {
        try {
            setLoading(true)
            const { from, to } = getDateRange()

            // Pass branchId if Staff user has selected a branch; refresh=true bypasses server cache
            const params = {
                fromDate: from,
                toDate: to
            }
            if (selectedBranchId && !isAdminOrOwner(user)) {
                params.branchId = selectedBranchId
            }
            if (skipCache) params.refresh = true

            const response = await reportsAPI.getSummaryReport(params)

            if (response?.success && response?.data) {
                const data = response.data
                setStats({
                    salesToday: parseFloat(data.salesToday || data.SalesToday) || 0,
                    returnsToday: parseFloat(data.returnsToday ?? data.ReturnsToday) || 0,
                    netSalesToday: parseFloat(data.netSalesToday ?? data.NetSalesToday) ?? (parseFloat(data.salesToday || data.SalesToday) || 0) - (parseFloat(data.returnsToday ?? data.ReturnsToday) || 0),
                    damageLossToday: parseFloat(data.damageLossToday ?? data.DamageLossToday) || 0,
                    returnsCountToday: parseInt(data.returnsCountToday ?? data.ReturnsCountToday) || 0,
                    expensesToday: parseFloat(data.expensesToday || data.ExpensesToday) || 0,
                    profitToday: parseFloat(data.profitToday || data.ProfitToday) || 0,
                    pendingBills: parseInt(data.pendingBills || data.PendingBills) || 0,
                    pendingBillsAmount: parseFloat(data.pendingBillsAmount ?? data.PendingBillsAmount) || 0,
                    purchasesToday: parseFloat(data.purchasesToday || data.PurchasesToday) || 0,
                    lowStockCount: Array.isArray(data.lowStockProducts || data.LowStockProducts) ? (data.lowStockProducts || data.LowStockProducts || []).length : 0,
                    invoicesToday: parseInt(data.invoicesToday || data.InvoicesToday) || 0,
                    invoicesWeekly: parseInt(data.invoicesWeekly || data.InvoicesWeekly) || 0,
                    invoicesMonthly: parseInt(data.invoicesMonthly || data.InvoicesMonthly) || 0
                })
                
                // Set branch breakdown
                if (data.branchBreakdown && Array.isArray(data.branchBreakdown)) {
                    setBranchBreakdown(data.branchBreakdown)
                } else {
                    setBranchBreakdown([])
                }

                if (isAdminOrOwner(user)) {
                    reportsAPI.getSetupStatus().then((res) => {
                        if (res?.success && res?.data) setSetupStatus(res.data)
                    }).catch(() => {})
                }
                
                // Set daily sales trend
                if (data.dailySalesTrend && Array.isArray(data.dailySalesTrend)) {
                    setDailySalesTrend(data.dailySalesTrend)
                } else {
                    setDailySalesTrend([])
                }
                
                // Set top customers
                if (data.topCustomersToday && Array.isArray(data.topCustomersToday)) {
                    setTopCustomers(data.topCustomersToday)
                } else {
                    setTopCustomers([])
                }
                
                // Set top products
                if (data.topProductsToday && Array.isArray(data.topProductsToday)) {
                    setTopProducts(data.topProductsToday)
                } else {
                    setTopProducts([])
                }
            } else {
                console.error('Dashboard API response invalid:', response)
                toast.error('Failed to load dashboard data: Invalid response')
            }
        } catch (error) {
            console.error('Failed to fetch dashboard stats:', error)
            toast.error(`Failed to load dashboard data: ${error.message || 'Unknown error'}`)
        } finally {
            setLoading(false)
        }
    }

    const handleRefresh = async () => {
        if (isFetchingRef.current) return
        lastFetchTimeRef.current = 0 // Bypass throttle so explicit Refresh always fetches fresh data
        isFetchingRef.current = true
        try {
            await fetchStats(true) // true = skip server cache so Refresh shows live data
        } finally {
            isFetchingRef.current = false
        }
    }

    useEffect(() => {
        const fetchStatsThrottled = async () => {
            const now = Date.now()
            const timeSinceLastFetch = now - lastFetchTimeRef.current
            if (isFetchingRef.current) return
            if (timeSinceLastFetch < DASHBOARD_THROTTLE_MS) {
                if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
                fetchTimeoutRef.current = setTimeout(fetchStatsThrottled, DASHBOARD_THROTTLE_MS - timeSinceLastFetch)
                return
            }
            isFetchingRef.current = true
            lastFetchTimeRef.current = now
            try {
                await fetchStats()
            } finally {
                isFetchingRef.current = false
            }
        }
        fetchStatsThrottled()
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible' && !isFetchingRef.current) fetchStatsThrottled()
        }, 120000) // 2 minutes
        let debounceTimer = null
        const handleDataUpdate = () => {
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(() => {
                if (!isFetchingRef.current) fetchStatsThrottled()
            }, 5000)
        }
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && !isFetchingRef.current) fetchStatsThrottled()
        }
        window.addEventListener('dataUpdated', handleDataUpdate)
        window.addEventListener('paymentCreated', handleDataUpdate)
        window.addEventListener('customerCreated', handleDataUpdate)
        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            clearInterval(interval)
            if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current)
            if (debounceTimer) clearTimeout(debounceTimer)
            window.removeEventListener('dataUpdated', handleDataUpdate)
            window.removeEventListener('paymentCreated', handleDataUpdate)
            window.removeEventListener('customerCreated', handleDataUpdate)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [user, dateRange, customFromDate, customToDate, selectedBranchId])

    useEffect(() => {
        if (!user || isAdminOrOwner(user)) return
        if (availableBranches.length === 1) {
            setSelectedBranchId(availableBranches[0].id)
        } else if (availableBranches.length > 1 && !selectedBranchId) {
            setSelectedBranchId(availableBranches[0].id)
        }
    }, [user, availableBranches])

    useEffect(() => {
        if (!user || !isAdminOrOwner(user)) return
        reportsAPI.getSetupStatus()
            .then((res) => {
                if (res?.success && res?.data) setSetupStatus(res.data)
            })
            .catch(() => {})
    }, [user])

    const setupComplete = setupStatus && setupStatus.hasBranch && setupStatus.hasRoute && setupStatus.hasStaff &&
        setupStatus.productCount > 0 && setupStatus.customerCount > 0 && setupStatus.hasInvoice
    const showGetStarted = isAdminOrOwner(user) && setupStatus && !getStartedDismissed && !setupComplete

    const handleDismissGetStarted = () => {
        setGetStartedDismissed(true)
        try { localStorage.setItem(GET_STARTED_DISMISSED_KEY, 'true') } catch (_) {}
    }

    const gatewayMenu = [
        {
            title: 'MASTERS',
            items: [
                ...(isAdminOrOwner(user) ? [
                    { icon: Building2, label: 'Branches', path: '/branches', shortcut: '', adminOnly: true },
                    { icon: MapPin, label: 'Routes', path: '/routes', shortcut: '', adminOnly: true }
                ] : []),
                { icon: Package, label: 'Products', path: '/products', shortcut: 'F1' }
            ]
        },
        {
            title: 'TRANSACTIONS',
            items: [
                { id: 'pos', icon: ShoppingCart, label: 'POS Billing', path: '/pos', shortcut: 'F3', primary: true },
                ...(isAdminOrOwner(user)
                    ? [
                        { id: 'purchases', icon: Truck, label: 'Purchases', path: '/purchases', shortcut: 'F4' },
                        { id: 'expenses', icon: Wallet, label: 'Expenses', path: '/expenses', shortcut: 'F5' }
                    ]
                    : [{ id: 'expenses', icon: Wallet, label: 'Add expense', path: '/expenses', shortcut: 'F5' }]),
                { id: 'customerLedger', icon: FileText, label: 'Customer Ledger', path: '/ledger', shortcut: 'F10' },
                { id: 'salesLedger', icon: BookOpen, label: 'Sales Ledger', path: '/sales-ledger', shortcut: 'F10' }
            ]
        },
        {
            title: 'REPORTS',
            items: [
                ...(isAdminOrOwner(user) ? [
                    { id: 'salesTrend', icon: BarChart3, label: 'Sales Report', path: '/reports?tab=sales', shortcut: 'F7' },
                    { id: 'profitToday', icon: TrendingUp, label: 'Profit & Loss', path: '/reports?tab=profit-loss', shortcut: 'F8' },
                    { id: 'pendingBills', icon: DollarSign, label: 'Outstanding Bills', path: '/reports?tab=outstanding', shortcut: 'F9' },
                    { id: 'staffPerformance', icon: Users, label: 'Staff Performance', path: '/reports?tab=staff', shortcut: '', adminOnly: true },
                    { id: 'routesSummary', icon: MapPin, label: 'Routes summary & ledger', path: '/routes', shortcut: '', adminOnly: true }
                ] : [])
            ]
        },
        {
            title: 'UTILITIES',
            items: [
                { icon: Settings, label: 'Settings', path: '/settings', shortcut: 'Ctrl+S', adminOnly: true },
                { icon: Database, label: 'Backup & Restore', path: '/backup', shortcut: 'Ctrl+B', adminOnly: true },
                { icon: Users, label: 'Users', path: '/users', shortcut: 'Ctrl+U', adminOnly: true }
            ]
        }
    ]

    return (
        <div className="h-full">
            <div className="flex flex-col lg:flex-row h-full gap-4">
                {/* Central Content */}
                <div className="flex-1 space-y-4">
                    {/* Get started checklist (Owner/Admin, incomplete setup, not dismissed) */}
                    {showGetStarted && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 relative">
                            <button
                                type="button"
                                onClick={handleDismissGetStarted}
                                className="absolute top-2 right-2 p-1 rounded hover:bg-blue-100 text-neutral-500 hover:text-neutral-700"
                                aria-label="Dismiss"
                            >
                                <X className="h-5 w-5" />
                            </button>
                            <h3 className="text-sm font-bold text-blue-900 mb-2 pr-8">Get started</h3>
                            <p className="text-xs text-blue-800 mb-3">Complete these steps to get the most out of HexaBill (see <a href="/help" className="underline" onClick={(e) => { e.preventDefault(); navigate('/help') }}>Help</a> for the full workflow).</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                <button type="button" onClick={() => navigate('/branches')} className="flex items-center gap-1.5 text-blue-800 hover:underline">
                                    {setupStatus.hasBranch ? <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-blue-400 flex-shrink-0" />}
                                    Add branch
                                </button>
                                <button type="button" onClick={() => navigate('/routes')} className="flex items-center gap-1.5 text-blue-800 hover:underline">
                                    {setupStatus.hasRoute ? <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-blue-400 flex-shrink-0" />}
                                    Add route
                                </button>
                                <button type="button" onClick={() => navigate('/users')} className="flex items-center gap-1.5 text-blue-800 hover:underline">
                                    {setupStatus.hasStaff ? <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-blue-400 flex-shrink-0" />}
                                    Add staff
                                </button>
                                <button type="button" onClick={() => navigate('/products')} className="flex items-center gap-1.5 text-blue-800 hover:underline">
                                    {setupStatus.productCount > 0 ? <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-blue-400 flex-shrink-0" />}
                                    Add products
                                </button>
                                <button type="button" onClick={() => navigate('/purchases')} className="flex items-center gap-1.5 text-blue-800 hover:underline">
                                    {setupStatus.hasPurchase ? <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-blue-400 flex-shrink-0" />}
                                    Add purchase
                                </button>
                                <button type="button" onClick={() => navigate('/customers')} className="flex items-center gap-1.5 text-blue-800 hover:underline">
                                    {setupStatus.customerCount > 0 ? <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-blue-400 flex-shrink-0" />}
                                    Add customers
                                </button>
                                <button type="button" onClick={() => navigate('/pos')} className="flex items-center gap-1.5 text-blue-800 hover:underline">
                                    {setupStatus.hasInvoice ? <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-blue-400 flex-shrink-0" />}
                                    Create first invoice
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Date Range Selector */}
                    <div className="bg-white rounded-lg border border-neutral-200 p-4">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm font-medium text-neutral-700">Period:</span>
                            <button
                                type="button"
                                onClick={handleRefresh}
                                disabled={loading}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-neutral-300 rounded-md hover:bg-neutral-50 disabled:opacity-60"
                                title="Refresh dashboard data"
                            >
                                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                <span>Refresh</span>
                            </button>
                            <button
                                onClick={() => setDateRange('today')}
                                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                                    dateRange === 'today'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                                }`}
                            >
                                Today
                            </button>
                            <button
                                onClick={() => setDateRange('week')}
                                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                                    dateRange === 'week'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                                }`}
                            >
                                This Week
                            </button>
                            <button
                                onClick={() => setDateRange('month')}
                                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                                    dateRange === 'month'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                                }`}
                            >
                                This Month
                            </button>
                            <button
                                onClick={() => {
                                    if (dateRange !== 'custom') {
                                        const today = new Date()
                                        const weekAgo = new Date(today)
                                        weekAgo.setDate(today.getDate() - 6)
                                        setCustomFromDate(weekAgo.toISOString().split('T')[0])
                                        setCustomToDate(today.toISOString().split('T')[0])
                                    }
                                    setDateRange('custom')
                                }}
                                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                                    dateRange === 'custom'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                                }`}
                            >
                                Custom
                            </button>
                            {dateRange === 'custom' && (
                                <>
                                    <input
                                        type="date"
                                        value={customFromDate}
                                        onChange={(e) => setCustomFromDate(e.target.value)}
                                        className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="From"
                                    />
                                    <span className="text-neutral-500">to</span>
                                    <input
                                        type="date"
                                        value={customToDate}
                                        onChange={(e) => setCustomToDate(e.target.value)}
                                        className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="To"
                                    />
                                </>
                            )}
                            {/* Branch Selector for Staff with multiple branches */}
                            {!isAdminOrOwner(user) && availableBranches.length > 1 && (
                                <>
                                    <span className="text-sm font-medium text-neutral-700 ml-2">Branch:</span>
                                    <select
                                        value={selectedBranchId || ''}
                                        onChange={(e) => setSelectedBranchId(e.target.value ? parseInt(e.target.value) : null)}
                                        className="px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">All Branches</option>
                                        {availableBranches.map(branch => (
                                            <option key={branch.id} value={branch.id}>
                                                {branch.name}
                                            </option>
                                        ))}
                                    </select>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {canShow('salesToday') && (
                            <StatCard
                                title={dateRange === 'today' ? 'Sales (Gross) Today' : dateRange === 'week' ? 'Sales (Gross) This Week' : dateRange === 'month' ? 'Sales (Gross) This Month' : 'Sales (Gross)'}
                                value={stats.salesToday}
                                icon={DollarSign}
                                color="green"
                                loading={loading}
                            />
                        )}
                        {canShow('returnsToday') && (
                            <StatCard
                                title={dateRange === 'today' ? 'Return Value Today' : dateRange === 'week' ? 'Return Value This Week' : dateRange === 'month' ? 'Return Value This Month' : 'Return Value'}
                                value={stats.returnsToday}
                                icon={RotateCcw}
                                color="red"
                                loading={loading}
                            />
                        )}
                        {canShow('netSalesToday') && (
                            <StatCard
                                title={dateRange === 'today' ? 'Net Sales Today' : dateRange === 'week' ? 'Net Sales This Week' : dateRange === 'month' ? 'Net Sales This Month' : 'Net Sales'}
                                value={stats.netSalesToday}
                                icon={DollarSign}
                                color="blue"
                                loading={loading}
                            />
                        )}
                        {canShow('damageLossToday') !== false && (
                            <StatCard
                                title={dateRange === 'today' ? 'Total Damage Loss Today' : dateRange === 'week' ? 'Total Damage Loss This Week' : dateRange === 'month' ? 'Total Damage Loss This Month' : 'Total Damage Loss'}
                                value={stats.damageLossToday}
                                icon={AlertTriangle}
                                color="red"
                                loading={loading}
                            />
                        )}
                        {(isAdminOrOwner(user) || (!isAdminOrOwner(user) && selectedBranchId)) && canShow('expensesToday') && (
                            <StatCard
                                title={
                                    dateRange === 'today' ? 'Expenses Today' : 
                                    dateRange === 'week' ? 'Expenses This Week' : 
                                    dateRange === 'month' ? 'Expenses This Month' : 'Expenses'
                                }
                                value={stats.expensesToday}
                                icon={TrendingUp}
                                color="red"
                                loading={loading}
                            />
                        )}
                        {canShow('purchasesToday') !== false && (
                            <StatCard
                                title={
                                    dateRange === 'today' ? 'Purchases Today' :
                                    dateRange === 'week' ? 'Purchases This Week' :
                                    dateRange === 'month' ? 'Purchases This Month' : 'Purchases'
                                }
                                value={stats.purchasesToday}
                                icon={Truck}
                                color="green"
                                loading={loading}
                            />
                        )}
                        {canShow('pendingAmount') !== false && (
                            <StatCard
                                title="Pending Total Amount"
                                value={stats.pendingBillsAmount}
                                icon={Wallet}
                                color="red"
                                loading={loading}
                            />
                        )}
                        {isAdminOrOwner(user) && canShow('profitToday') && (
                            <StatCard
                                title={dateRange === 'today' ? 'Profit Today' : dateRange === 'week' ? 'Profit This Week' : dateRange === 'month' ? 'Profit This Month' : 'Profit'}
                                value={stats.profitToday}
                                icon={TrendingUp}
                                color="blue"
                                loading={loading}
                                adminOnly
                            />
                        )}
                    </div>

                    {/* Branch Breakdown Card */}
                    {isAdminOrOwner(user) && branchBreakdown.length > 0 && (
                        <div className="bg-white rounded-lg border border-neutral-200 p-4">
                            <h3 className="text-sm font-medium text-neutral-700 mb-3">
                                Branch Breakdown {dateRange === 'today' ? '(Today)' : dateRange === 'week' ? '(This Week)' : dateRange === 'month' ? '(This Month)' : ''}
                            </h3>
                            <div className="space-y-2">
                                {branchBreakdown.map(branch => (
                                    <div
                                        key={branch.branchId}
                                        className="p-3 hover:bg-neutral-50 rounded-md cursor-pointer border border-neutral-100 mb-2"
                                        onClick={() => navigate(`/branches/${branch.branchId}`)}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="font-semibold text-neutral-900 truncate">{branch.branchName}</span>
                                                <span className="text-xs text-neutral-400 whitespace-nowrap flex-shrink-0">({branch.invoiceCount} invoices)</span>
                                            </div>
                                            <span className={`text-sm font-bold flex-shrink-0 ml-2 ${branch.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatCurrency(branch.profit)}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                            <div>
                                                <span className="text-neutral-500 block">Sales</span>
                                                <span className="font-medium text-neutral-800">{formatCurrency(branch.sales)}</span>
                                            </div>
                                            <div>
                                                <span className="text-neutral-500 block">Paid</span>
                                                <span className="font-medium text-green-600">{formatCurrency(branch.paidAmount ?? 0)}</span>
                                            </div>
                                            <div>
                                                <span className="text-neutral-500 block">Unpaid</span>
                                                <span className="font-medium text-amber-600">{formatCurrency(branch.unpaidAmount ?? 0)}</span>
                                            </div>
                                            <div>
                                                <span className="text-neutral-500 block">Expenses (this branch)</span>
                                                <span className="font-medium text-red-600">{formatCurrency(branch.expenses)}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-2 text-xs text-neutral-500">Branch expenses only. Total expenses at the top include company-level (unassigned) expenses.</p>
                        </div>
                    )}

                    {/* Sales Trend Chart - title reflects selected period */}
                    {dailySalesTrend.length > 0 && (
                        <div className="bg-white rounded-lg border border-neutral-200 p-4">
                            <h3 className="text-sm font-medium text-neutral-700 mb-3">
                                Sales Trend {dateRange === 'today' ? '(Today)' : dateRange === 'week' ? '(This Week)' : dateRange === 'month' ? '(This Month)' : dateRange === 'custom' && customFromDate && customToDate ? `(${customFromDate} to ${customToDate})` : `(${dailySalesTrend.length} days)`}
                            </h3>
                            <ResponsiveContainer width="100%" height={150}>
                                <BarChart data={dailySalesTrend}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                    <XAxis 
                                        dataKey="date" 
                                        tickFormatter={(d) => {
                                            const date = new Date(d)
                                            return date.toLocaleDateString('en', { weekday: 'short', day: 'numeric' })
                                        }}
                                        stroke="#6b7280"
                                        fontSize={12}
                                    />
                                    <YAxis 
                                        tickFormatter={(v) => {
                                            if (v >= 1000) return `${(v/1000).toFixed(1)}k`
                                            return v.toString()
                                        }}
                                        stroke="#6b7280"
                                        fontSize={12}
                                    />
                                    <Tooltip 
                                        formatter={(value) => formatCurrency(value)}
                                        labelFormatter={(label) => {
                                            const date = new Date(label)
                                            return date.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })
                                        }}
                                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px' }}
                                    />
                                    <Bar dataKey="sales" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* Top Customers and Products */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Top Customers */}
                        {topCustomers.length > 0 && (
                            <div className="bg-white rounded-lg border border-neutral-200 p-4">
                                <h3 className="text-sm font-medium text-neutral-700 mb-3">
                                    Top Customers {dateRange === 'today' ? 'Today' : dateRange === 'week' ? 'This Week' : dateRange === 'month' ? 'This Month' : ''}
                                </h3>
                                <div className="space-y-2">
                                    {topCustomers.map((customer, idx) => (
                                        <div 
                                            key={customer.customerId} 
                                            className="flex items-center justify-between text-sm p-2 hover:bg-neutral-50 rounded-md cursor-pointer"
                                            onClick={() => navigate(`/ledger?customerId=${customer.customerId}`)}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-neutral-400 font-medium">#{idx + 1}</span>
                                                <span className="font-medium text-neutral-900">{customer.customerName}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-neutral-600">{formatCurrency(customer.totalSales)}</span>
                                                <span className="text-neutral-500 text-xs">({customer.invoiceCount} invoices)</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Top Products */}
                        {topProducts.length > 0 && (
                            <div className="bg-white rounded-lg border border-neutral-200 p-4">
                                <h3 className="text-sm font-medium text-neutral-700 mb-3">
                                    Top Products {dateRange === 'today' ? 'Today' : dateRange === 'week' ? 'This Week' : dateRange === 'month' ? 'This Month' : ''}
                                </h3>
                                <div className="space-y-2">
                                    {topProducts.map((product, idx) => (
                                        <div 
                                            key={product.productId} 
                                            className="flex items-center justify-between text-sm p-2 hover:bg-neutral-50 rounded-md cursor-pointer"
                                            onClick={() => navigate(`/products?productId=${product.productId}`)}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-neutral-400 font-medium">#{idx + 1}</span>
                                                <span className="font-medium text-neutral-900">{product.productName}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-neutral-600">{formatCurrency(product.totalSales)}</span>
                                                <span className="text-neutral-500 text-xs">({product.totalQty} {product.unitType})</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Quick Actions Bar */}
                    {canShow('quickActions') && (
                        <div className="bg-white rounded-lg shadow-md p-4 lg:p-6">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                <QuickActionButton
                                    icon={ShoppingCart}
                                    label="New Invoice"
                                    onClick={() => navigate('/pos')}
                                    color="blue"
                                    shortcut="F3"
                                />
                                {isAdminOrOwner(user) && (
                                    <QuickActionButton
                                        icon={Truck}
                                        label="New Purchase"
                                        onClick={() => navigate('/purchases?action=create')}
                                        color="green"
                                        shortcut="F4"
                                    />
                                )}
                                <QuickActionButton
                                    icon={FileText}
                                    label="Customer Ledger"
                                    onClick={() => navigate('/ledger')}
                                    color="purple"
                                    shortcut="F6"
                                />
                                {isAdminOrOwner(user) && (
                                    <QuickActionButton
                                        icon={Database}
                                        label="Backup Now"
                                        onClick={() => navigate('/backup')}
                                        color="orange"
                                        shortcut="Ctrl+B"
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Invoice Counts & Alerts */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {canShow('salesLedger') && (
                            <div
                                onClick={() => navigate('/sales-ledger')}
                                className="cursor-pointer bg-indigo-50 rounded-lg shadow-md border-2 border-indigo-300 p-4 lg:p-6 text-center hover:shadow-lg hover:border-indigo-400 transition-all"
                            >
                                <BookOpen className="h-8 w-8 mx-auto mb-2 text-indigo-600" />
                                <p className="text-sm font-semibold text-gray-700 mb-1">Sales Ledger</p>
                                <p className="text-xl font-bold text-indigo-700">View</p>
                                <p className="text-xs text-indigo-600 mt-1">Click to open →</p>
                            </div>
                        )}
                        {(canShow('expenses') || !isAdminOrOwner(user)) && (
                            <div
                                onClick={() => navigate('/expenses')}
                                className="cursor-pointer bg-purple-50 rounded-lg shadow-md border-2 border-purple-300 p-4 lg:p-6 text-center hover:shadow-lg hover:border-purple-400 transition-all"
                            >
                                <Wallet className="h-8 w-8 mx-auto mb-2 text-purple-600" />
                                <p className="text-sm font-semibold text-gray-700 mb-1">{isAdminOrOwner(user) ? 'Expenses' : 'Add expense'}</p>
                                <p className="text-xl font-bold text-purple-700">{isAdminOrOwner(user) ? 'Manage' : 'Log expense'}</p>
                                <p className="text-xs text-purple-600 mt-1">Click to open →</p>
                            </div>
                        )}
                        {isAdminOrOwner(user) && canShow('pendingBills') && (
                            <AlertCard
                                title="Unpaid Bills"
                                count={stats.pendingBills}
                                icon={AlertTriangle}
                                color="yellow"
                                onClick={() => navigate('/reports?tab=outstanding')}
                            />
                        )}
                        {canShow('lowStockAlert') && (
                            <AlertCard
                                title="Low Stock"
                                count={stats.lowStockCount}
                                icon={Package}
                                color="red"
                                onClick={() => navigate('/products?filter=lowstock')}
                            />
                        )}
                    </div>
                </div>

                {/* Right: Gateway Column */}
                <div className="hidden lg:block lg:w-72 bg-white shadow-lg border-l border-blue-200 rounded-lg overflow-hidden h-fit sticky top-4">
                    <div className="p-4">
                        <div className="bg-neutral-900 text-white rounded-lg p-3 mb-4 shadow-lg">
                            <h2 className="text-base font-bold text-center">{companyName} Dashboard</h2>
                            <p className="text-xs text-center text-blue-200 mt-0.5">Billing software for business</p>
                        </div>

                        <div className="space-y-3">
                            {gatewayMenu.map((group, idx) => (
                                <GatewayGroup key={idx} group={group} user={user} navigate={navigate} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default DashboardTally


