import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useDebounce } from '../../hooks/useDebounce'
import {
  Download,
  Filter,
  Calendar,
  TrendingUp,
  TrendingDown,
  BarChart3,
  PieChart,
  FileText,
  Eye,
  RefreshCw,
  DollarSign,
  ShieldCheck,
  Building2,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Users,
  MapPin,
  Phone,
  RotateCcw,
  ArrowLeft,
  AlertTriangle,
  Truck
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'
import { formatCurrency, formatBalance } from '../../utils/currency'
import toast from 'react-hot-toast'
import { showToast } from '../../utils/toast'
import { LoadingCard } from '../../components/Loading'
import { Input, Select } from '../../components/Form'
import { reportsAPI, productsAPI, customersAPI, profitAPI, paymentsAPI, adminAPI, returnsAPI } from '../../services'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'

const REPORTS_DATE_RANGE_KEY = 'hexabill_reports_date_range'

function getDefaultDateRange() {
  // Use 2 years to capture full history (e.g. migrated 2025 data) - prevents "No data found"
  return {
    from: new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  }
}

function isValidDateString(str) {
  if (typeof str !== 'string' || str.length !== 10) return false
  const d = new Date(str)
  return !isNaN(d.getTime()) && d.toISOString().split('T')[0] === str
}

function loadDateRangeFromStorage() {
  try {
    const raw = localStorage.getItem(REPORTS_DATE_RANGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.from === 'string' && typeof parsed.to === 'string') {
      if (isValidDateString(parsed.from) && isValidDateString(parsed.to)) return parsed
    }
  } catch (_) { /* ignore */ }
  return null
}

const ReportsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { branches, routes } = useBranchesRoutes()
  const [loading, setLoading] = useState(true)
  const initialTab = searchParams.get('tab') || 'summary'
  const [activeTab, setActiveTab] = useState(initialTab)
  // Shared date range across all report tabs; persisted so last range is restored (PRODUCTION_MASTER_TODO #40)
  const [dateRange, setDateRange] = useState(() => loadDateRangeFromStorage() || getDefaultDateRange())
  // FIX: Add "as of date" for aging report (defaults to today, can be set to past date)
  const [agingAsOfDate, setAgingAsOfDate] = useState(new Date().toISOString().split('T')[0])
  // FIX: Add days overdue filter for Outstanding Bills
  const [outstandingDaysFilter, setOutstandingDaysFilter] = useState('') // '', '30', '60', '90'
  const [filters, setFilters] = useState({
    branch: '',
    route: '',
    product: '',
    customer: '',
    category: '',
    status: '', // Pending, Paid, Partial for sales report
    search: '', // BUG #2.5 FIX: Add search filter for invoice number, customer name
    damageCategory: '', // For Returns report
    staffId: '' // For Returns report (CreatedBy)
  })
  const [appliedFilters, setAppliedFilters] = useState({
    branch: '',
    route: '',
    product: '',
    customer: '',
    category: '',
    status: '',
    search: '',
    damageCategory: '',
    staffId: ''
  })
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  
  // BUG #2.5 FIX: Debounce text filter inputs (400ms delay) to prevent instant API calls
  const debouncedSearch = useDebounce(filters.search, 400)

  const [reportData, setReportData] = useState({
    summary: null,
    sales: [],
    salesList: [], // Detailed sales list for table display
    products: [],
    customers: [],
    expenses: [],
    branchComparison: [],
    agingReport: null,
    apAgingReport: null,
    profitLoss: null,
    outstandingBills: [],
    collectionsList: [], // Customers with balance > 0 and phone for collection calls (#53)
    chequeReport: [], // FIX: Add cheque report data
    staffReport: [],
    aiSuggestions: null,
    returnsReport: { items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 0 },
    damageCategories: [],
    damageReport: [],
    creditNotesReport: [],
    netSalesReport: null // { totalSales, totalReturns, netSales } from summary
  })
  const [returnsFeatureFlags, setReturnsFeatureFlags] = useState({ returnsEnabled: true, returnsRequireApproval: false })
  const [loadingSales, setLoadingSales] = useState(false)
  const [expandedBranchId, setExpandedBranchId] = useState(null) // Branch Report: which branch row is expanded for route sub-rows
  const [productsList, setProductsList] = useState([])
  const [customersList, setCustomersList] = useState([])
  const branchesList = branches || []
  // When "All Branches" is selected, show all routes so user can filter by route without picking a branch
  const routesList = filters.branch
    ? (routes || []).filter(r => r.branchId === parseInt(filters.branch, 10))
    : (routes || [])

  // Persist shared date range so last used range is restored on next visit (#40)
  useEffect(() => {
    try {
      localStorage.setItem(REPORTS_DATE_RANGE_KEY, JSON.stringify(dateRange))
    } catch (_) { /* ignore */ }
  }, [dateRange])

  // BUG 10: Date range change — clear cache and trigger fresh fetch
  useEffect(() => {
    tabDataCacheRef.current = {}
    if (fetchReportDataRef.current) fetchReportDataRef.current(true)
  }, [dateRange.from, dateRange.to])

  // Request throttling and cancellation - AGGRESSIVE THROTTLING
  const fetchAbortControllerRef = useRef(null)
  const lastFetchTimeRef = useRef(0)
  const isFetchingRef = useRef(false)
  const FETCH_THROTTLE_MS = 2000 // Minimum 2 seconds between requests (reasonable throttling)
  const fetchTimeoutRef = useRef(null)
  const isTabChangingRef = useRef(false)
  const pendingTabChangeRef = useRef(null)
  const fetchReportDataRef = useRef(null) // Ref to store the latest fetchReportData
  const requestQueueRef = useRef([]) // Queue for pending requests
  const lastRequestParamsRef = useRef(null) // Track last request params to prevent duplicates
  const hasInitialLoadRef = useRef(false) // Track if initial load has happened
  const initialLoadTimeoutRef = useRef(null) // Timeout for initial load
  const tabDataCacheRef = useRef({}) // Lazy load: cache loaded tab data keyed by tab+params to avoid refetch on tab switch
  const reportsTabsRef = useRef(null) // Tab nav scroll container for left/right buttons

  const { user } = useAuth()

  const tabs = [
    { id: 'summary', name: 'Summary', shortLabel: 'Summary', icon: BarChart3 },
    { id: 'sales', name: 'Sales Report', shortLabel: 'Sales', icon: TrendingUp },
    { id: 'products', name: 'Product Analysis', shortLabel: 'Product', icon: PieChart },
    { id: 'customers', name: 'Customer Report', shortLabel: 'Customers', icon: FileText },
    { id: 'expenses', name: 'Expenses', shortLabel: 'Expenses', icon: TrendingDown },
    { id: 'branch', name: 'Branch Report', shortLabel: 'Branch', icon: Building2 },
    { id: 'route', name: 'Route Report', shortLabel: 'Route', icon: MapPin },
    { id: 'aging', name: 'Customer Aging', shortLabel: 'Aging', icon: Clock },
    { id: 'ap-aging', name: 'AP Aging', shortLabel: 'AP Aging', icon: Truck, adminOnly: true },
    { id: 'profit-loss', name: 'Profit & Loss', shortLabel: 'P&L', icon: TrendingUp, adminOnly: true },
    { id: 'branch-profit', name: 'Branch Profit', shortLabel: 'Branch P&L', icon: Building2, adminOnly: true },
    { id: 'outstanding', name: 'Outstanding Bills', shortLabel: 'Outstanding', icon: DollarSign },
    { id: 'returns', name: 'Sales Returns', shortLabel: 'Returns', icon: RotateCcw },
    { id: 'damage', name: 'Damage Report', shortLabel: 'Damage', icon: AlertTriangle },
    { id: 'credit-notes', name: 'Credit Note Report', shortLabel: 'Credit Notes', icon: FileText },
    { id: 'net-sales', name: 'Net Sales Report', shortLabel: 'Net Sales', icon: TrendingUp },
    { id: 'collections', name: 'Collections (with phone)', shortLabel: 'Collections', icon: Phone },
    { id: 'cheque', name: 'Cheque Report', shortLabel: 'Cheque', icon: ShieldCheck, adminOnly: true },
    { id: 'staff', name: 'Staff Performance', shortLabel: 'Staff', icon: Users, adminOnly: true },
    { id: 'ai', name: 'AI Insights', shortLabel: 'AI', icon: Eye, adminOnly: true }
  ].filter(tab => !tab.adminOnly || isAdminOrOwner(user))

  // Update URL when tab changes (with debouncing to prevent request flood)
  const handleTabChange = (tabId) => {
    // Prevent rapid tab switching
    if (isTabChangingRef.current) {
      pendingTabChangeRef.current = tabId
      return
    }

    if (activeTab === tabId) {
      return // Already on this tab, no need to change
    }

    isTabChangingRef.current = true

    // Cancel any pending requests and timeouts
    if (fetchAbortControllerRef.current) {
      fetchAbortControllerRef.current.abort()
      fetchAbortControllerRef.current = null
    }
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
      fetchTimeoutRef.current = null
    }

    // Reset fetching flag to allow new requests after tab change
    isFetchingRef.current = false

    setActiveTab(tabId)
    setSearchParams({ tab: tabId })

    // Always fetch data when switching tabs to ensure fresh data is shown
    // Use a short delay to prevent rapid switching issues
    setTimeout(() => {
      isTabChangingRef.current = false

      // Fetch data for new tab
      if (fetchReportDataRef.current && !isFetchingRef.current) {
        fetchReportDataRef.current(true)
      }
    }, 300) // Short delay to ensure tab change is complete

    // Handle pending tab change if any
    if (pendingTabChangeRef.current) {
      const nextTab = pendingTabChangeRef.current
      pendingTabChangeRef.current = null
      setTimeout(() => handleTabChange(nextTab), 500) // Process after current change completes
    }
  }

  // Define fetchReportData FIRST before any useEffect that uses it
  const fetchReportData = useCallback(async (force = false) => {
    // AGGRESSIVE: Prevent ALL requests if one is in flight (unless forced)
    if (!force && isFetchingRef.current) {
      console.log('Request already in progress, skipping...')
      return
    }

    // Prevent fetching during tab changes
    if (isTabChangingRef.current && !force) {
      console.log('Tab change in progress, skipping fetch...')
      return
    }

    // Create request signature to prevent duplicates (use appliedFilters, not draft filters)
    const requestSignature = JSON.stringify({
      dateRange,
      activeTab,
      filters: appliedFilters
    })

    // LAZY LOAD: Skip fetch if we already have this tab's data cached (same params)
    const tabCacheKey = `${activeTab}_${requestSignature}`
    if (!force && tabDataCacheRef.current[tabCacheKey]) {
      isFetchingRef.current = false
      return
    }

    // AGGRESSIVE: Prevent duplicate requests (same params)
    if (!force && lastRequestParamsRef.current === requestSignature) {
      console.log('Duplicate request prevented (same params)')
      return
    }

    // Throttle requests to prevent 429 errors
    const now = Date.now()
    const timeSinceLastFetch = now - lastFetchTimeRef.current

    if (!force && timeSinceLastFetch < FETCH_THROTTLE_MS) {
      console.log(`Throttling request (${timeSinceLastFetch}ms < ${FETCH_THROTTLE_MS}ms)`)
      // Clear existing timeout
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
      // Schedule request after throttle period
      fetchTimeoutRef.current = setTimeout(() => {
        if (fetchReportDataRef.current && !isFetchingRef.current) {
          fetchReportDataRef.current(true)
        }
      }, FETCH_THROTTLE_MS - timeSinceLastFetch)
      return
    }

    // Cancel previous request if still pending
    if (fetchAbortControllerRef.current) {
      fetchAbortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    fetchAbortControllerRef.current = new AbortController()
    const signal = fetchAbortControllerRef.current.signal

    // Mark as fetching and store request signature
    isFetchingRef.current = true
    lastFetchTimeRef.current = now
    lastRequestParamsRef.current = requestSignature

    try {
      setLoading(true)

      // P3: For Returns/Damage tabs, ensure "to" includes today so recent returns are visible
      const todayStr = new Date().toISOString().split('T')[0]
      let effectiveDateRange = dateRange
      if ((activeTab === 'returns' || activeTab === 'damage') && dateRange.to < todayStr) {
        setDateRange(prev => ({ ...prev, to: todayStr }))
        effectiveDateRange = { ...dateRange, to: todayStr }
      }

      // Fetch summary report (with abort signal support if API supports it)
      const summaryParams = {
        fromDate: dateRange.from,
        toDate: dateRange.to,
        branchId: appliedFilters.branch ? parseInt(appliedFilters.branch, 10) : undefined,
        routeId: appliedFilters.route ? parseInt(appliedFilters.route, 10) : undefined
      }

      // Note: Most API calls don't support AbortSignal directly, but we track cancellation
      const summaryResponse = await reportsAPI.getSummaryReport(summaryParams)

      // Check if request was cancelled
      if (fetchAbortControllerRef.current?.signal?.aborted) {
        return
      }
      if (summaryResponse?.success && summaryResponse?.data) {
        const summary = summaryResponse.data
        // Handle both camelCase and PascalCase property names
        const salesToday = summary.salesToday || summary.SalesToday || 0
        const purchasesToday = summary.purchasesToday || summary.PurchasesToday || 0
        const expensesToday = summary.expensesToday || summary.ExpensesToday || 0
        // FIX: Use profit from summary (which uses ProfitService calculation) instead of manual calculation
        // The backend GetSummaryReportAsync already calculates profit correctly using COGS
        const profitToday = summary.profitToday || summary.ProfitToday || 0

        setReportData(prev => ({
          ...prev,
          summary: {
            totalSales: salesToday,
            totalPurchases: purchasesToday,
            totalExpenses: expensesToday,
            netProfit: profitToday, // FIX: Use backend-calculated profit (matches P&L tab logic)
            salesGrowth: 0, // Calculate from previous period if needed
            profitMargin: (profitToday && salesToday && salesToday > 0)
              ? (profitToday / salesToday) * 100
              : 0
          }
        }))
      }

      // Fetch data based on active tab
      if (activeTab === 'sales') {
        setLoadingSales(true)
        try {
          const salesResponse = await reportsAPI.getSalesReport({
            fromDate: dateRange.from,
            toDate: dateRange.to,
            customerId: appliedFilters.customer ? parseInt(appliedFilters.customer) : undefined,
            status: appliedFilters.status || undefined,
            branchId: appliedFilters.branch ? parseInt(appliedFilters.branch, 10) : undefined,
            routeId: appliedFilters.route ? parseInt(appliedFilters.route, 10) : undefined,
            search: appliedFilters.search || undefined, // BUG #2.5 FIX: Add search parameter
            page: 1,
            pageSize: 100
          })
          if (salesResponse?.success && salesResponse?.data) {
            let salesData = salesResponse.data.items || []

            // Calculate balance and status for each sale
            salesData = salesData.map(sale => {
              const paidAmount = sale.paidAmount || 0
              const grandTotal = sale.grandTotal || 0
              const balance = grandTotal - paidAmount

              // Determine status based on balance
              let status = 'Pending'
              if (balance <= 0.01) {
                status = 'Paid'
              } else if (paidAmount > 0) {
                status = 'Partial'
              }

              // Calculate due date (30 days from invoice date)
              const dueDate = new Date(sale.invoiceDate)
              dueDate.setDate(dueDate.getDate() + 30)
              const today = new Date()
              const isOverdue = balance > 0.01 && dueDate < today

              return {
                ...sale,
                balance,
                status,
                isOverdue,
                dueDate
              }
            })

            // CRITICAL: Group by date for chart - track ALL customers' sales
            // Also track pending vs paid for accurate reporting
            const salesByDate = salesData.reduce((acc, sale) => {
              const date = new Date(sale.invoiceDate).toISOString().split('T')[0]
              if (!acc[date]) {
                acc[date] = { date, amount: 0, count: 0, pending: 0, paid: 0 }
              }
              acc[date].amount += sale.grandTotal || 0
              acc[date].count += 1

              // Track pending vs paid amounts
              if (sale.balance > 0.01) {
                acc[date].pending += sale.balance
              } else {
                acc[date].paid += sale.grandTotal || 0
              }

              return acc
            }, {})

            setReportData(prev => ({
              ...prev,
              sales: Object.values(salesByDate).sort((a, b) =>
                new Date(a.date) - new Date(b.date)
              ),
              salesList: salesData // Store detailed sales list for table display
            }))
          }
        } finally {
          setLoadingSales(false)
        }
      } else if (activeTab === 'products') {
        try {
          setLoading(true)
          console.log('Loading Product Analysis report:', { from: dateRange.from, to: dateRange.to })

          const productsResponse = await reportsAPI.getProductSalesReport({
            fromDate: dateRange.from,
            toDate: dateRange.to,
            productId: appliedFilters.product ? parseInt(appliedFilters.product) : undefined,
            category: appliedFilters.category || undefined,
            top: 20
          })

          console.log('Product Analysis response:', productsResponse)

          if (productsResponse?.success && productsResponse?.data) {
            const rawData = Array.isArray(productsResponse.data) ? productsResponse.data : []
            const products = rawData.map(p => ({
              name: p.productName || p.ProductName || p.sku || p.Sku || 'Unknown Product',
              sales: parseFloat(p.totalAmount || p.TotalAmount || 0),
              margin: parseFloat(p.profitMargin || p.ProfitMargin || 0),
              qty: parseFloat(p.totalQty || p.TotalQty || 0),
              sku: p.sku || p.Sku || 'N/A'
            }))
            setReportData(prev => ({ ...prev, products }))
          } else {
            setReportData(prev => ({ ...prev, products: [] }))
          }
        } catch (error) {
          console.error('Error loading product sales:', error)
          const msg = error?.response?.data?.message || error?.message || 'Failed to load product sales report'
          if (!error?._handledByInterceptor) toast.error(msg)
          setReportData(prev => ({ ...prev, products: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'customers') {
        try {
          setLoading(true)
          console.log('Loading Customer Report (Outstanding Customers)')

          const customersResponse = await reportsAPI.getOutstandingCustomers({ days: 30 })

          console.log('Customer Report response:', customersResponse)

          if (customersResponse?.success && customersResponse?.data) {
            // PagedResponse: data has { items, totalCount, page } - use items array
            const items = customersResponse.data?.items ?? customersResponse.data
            const customers = (Array.isArray(items) ? items : []).map(c => ({
              id: c.id || c.Id || 0,
              name: c.name || c.Name || 'Unknown Customer',
              phone: c.phone || c.Phone || '',
              total: parseFloat(c.balance || c.Balance || 0),
              creditLimit: parseFloat(c.creditLimit || c.CreditLimit || 0),
              invoices: c.invoiceCount || c.InvoiceCount || 0,
              lastOrder: c.lastOrderDate || c.LastOrderDate || ''
            }))

            // CRITICAL: Filter out customers with zero or negative balance
            const customersWithBalance = customers.filter(c => c.total > 0.01)

            console.log('Customer Report data loaded:', {
              totalCustomers: customers.length,
              customersWithBalance: customersWithBalance.length,
              totalOutstanding: customersWithBalance.reduce((sum, c) => sum + c.total, 0)
            })

            setReportData(prev => ({ ...prev, customers: customersWithBalance }))
          } else {
            console.error('Customer Report response not successful:', customersResponse)
            toast.error(customersResponse?.message || 'Failed to load customer data')
            setReportData(prev => ({ ...prev, customers: [] }))
          }
        } catch (error) {
          console.error('Error loading customers:', error)
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load customer report')
          setReportData(prev => ({ ...prev, customers: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'expenses') {
        try {
          setLoading(true)
          console.log('Loading Expenses report:', { from: dateRange.from, to: dateRange.to })

          const expensesResponse = await reportsAPI.getExpensesByCategory({
            fromDate: dateRange.from,
            toDate: dateRange.to,
            branchId: appliedFilters.branch ? parseInt(appliedFilters.branch, 10) : undefined
          })

          console.log('Expenses response:', expensesResponse)

          if (expensesResponse?.success && expensesResponse?.data) {
            const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316', '#84CC16']
            const expenses = (expensesResponse.data || []).map((e, index) => ({
              categoryId: e.categoryId ?? e.CategoryId ?? e.id ?? index,
              categoryName: e.categoryName ?? e.CategoryName ?? e.name ?? e.Name ?? 'Uncategorized',
              totalAmount: Number(e.totalAmount ?? e.TotalAmount ?? e.amount ?? e.Amount ?? 0),
              expenseCount: Number(e.expenseCount ?? e.ExpenseCount ?? e.count ?? e.Count ?? 0),
              categoryColor: e.categoryColor ?? e.CategoryColor ?? e.color ?? e.Color ?? COLORS[index % COLORS.length]
            })).filter(e => e.totalAmount > 0)

            console.log('Expenses data loaded:', {
              categoryCount: expenses.length,
              totalExpenses: expenses.reduce((sum, e) => sum + e.totalAmount, 0)
            })

            setReportData(prev => ({ ...prev, expenses }))
          } else {
            console.error('Expenses response not successful:', expensesResponse)
            toast.error(expensesResponse?.message || 'Failed to load expense data')
            setReportData(prev => ({ ...prev, expenses: [] }))
          }
        } catch (error) {
          console.error('Error loading expenses:', error)
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load expense report')
          setReportData(prev => ({ ...prev, expenses: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'branch' || activeTab === 'route') {
        try {
          setLoading(true)
          const branchParams = {
            fromDate: dateRange.from,
            toDate: dateRange.to
          }
          if (appliedFilters.branch) branchParams.branchId = parseInt(appliedFilters.branch, 10)
          const branchRes = await reportsAPI.getBranchComparison(branchParams)
          if (branchRes?.success && branchRes?.data) {
            const branchData = Array.isArray(branchRes.data)
              ? branchRes.data
              : (branchRes.data?.branches || branchRes.data?.items || [])
            setReportData(prev => ({ ...prev, branchComparison: branchData }))
          } else {
            setReportData(prev => ({ ...prev, branchComparison: [] }))
          }
        } catch (err) {
          const msg = err?.response?.status === 404
            ? 'This report is currently unavailable. Please try again later or contact support.'
            : (err?.response?.data?.message || 'Failed to load branch report')
          if (!err?._handledByInterceptor) toast.error(msg)
          setReportData(prev => ({ ...prev, branchComparison: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'aging') {
        try {
          setLoading(true)
          // FIX: Use agingAsOfDate instead of dateRange.to for historical aging analysis
          const agingRes = await reportsAPI.getAgingReport({
            asOfDate: agingAsOfDate || new Date().toISOString().split('T')[0]
          })
          if (agingRes?.success && agingRes?.data) {
            setReportData(prev => ({ ...prev, agingReport: agingRes.data }))
          } else {
            setReportData(prev => ({ ...prev, agingReport: null }))
          }
        } catch (err) {
          if (!err?._handledByInterceptor) toast.error(err?.response?.data?.message || 'Failed to load aging report')
          setReportData(prev => ({ ...prev, agingReport: null }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'ap-aging') {
        try {
          setLoading(true)
          const apRes = await reportsAPI.getApAgingReport({
            asOfDate: agingAsOfDate || new Date().toISOString().split('T')[0]
          })
          if (apRes?.success && apRes?.data) {
            setReportData(prev => ({ ...prev, apAgingReport: apRes.data }))
          } else {
            setReportData(prev => ({ ...prev, apAgingReport: null }))
          }
        } catch (err) {
          if (!err?._handledByInterceptor) toast.error(err?.response?.data?.message || 'Failed to load AP aging report')
          setReportData(prev => ({ ...prev, apAgingReport: null }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'cheque') {
        // FIX: Add Cheque Report tab data loading
        try {
          setLoading(true)
          const chequeRes = await reportsAPI.getChequeReport({
            fromDate: dateRange.from,
            toDate: dateRange.to
          })
          if (chequeRes?.success && chequeRes?.data) {
            setReportData(prev => ({ ...prev, chequeReport: chequeRes.data || [] }))
          } else {
            setReportData(prev => ({ ...prev, chequeReport: [] }))
          }
        } catch (err) {
          if (!err?._handledByInterceptor) toast.error(err?.response?.data?.message || 'Failed to load cheque report')
          setReportData(prev => ({ ...prev, chequeReport: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'profit-loss') {
        try {
          setLoading(true)
          console.log('Loading Profit & Loss report:', { from: dateRange.from, to: dateRange.to })

          const profitResponse = await profitAPI.getProfitReport(dateRange.from, dateRange.to)

          console.log('Profit & Loss response:', profitResponse)

          if (profitResponse?.success && profitResponse?.data) {
            const profitData = profitResponse.data

            // CRITICAL: Format daily profit data for chart (convert date strings to Date objects)
            const formattedDailyProfit = (profitData.dailyProfit || []).map(day => ({
              date: day.date ? new Date(day.date).toISOString().split('T')[0] : day.date,
              sales: parseFloat(day.sales || 0),
              expenses: parseFloat(day.expenses || 0),
              profit: parseFloat(day.profit || 0)
            }))

            console.log('Profit & Loss data loaded:', {
              totalSales: profitData.totalSales,
              grossProfit: profitData.grossProfit,
              netProfit: profitData.netProfit,
              dailyProfitCount: formattedDailyProfit.length
            })

            setReportData(prev => ({
              ...prev,
              profitLoss: {
                totalSales: parseFloat(profitData.totalSales || 0),
                totalSalesWithVat: parseFloat(profitData.totalSalesWithVat || 0),
                totalPurchases: parseFloat(profitData.totalPurchases || 0),
                costOfGoodsSold: parseFloat(profitData.costOfGoodsSold || 0),
                totalExpenses: parseFloat(profitData.totalExpenses || 0),
                grossProfit: parseFloat(profitData.grossProfit || 0),
                grossProfitMargin: parseFloat(profitData.grossProfitMargin || 0),
                netProfit: parseFloat(profitData.netProfit || 0),
                netProfitMargin: parseFloat(profitData.netProfitMargin || 0),
                dailyProfit: formattedDailyProfit
              }
            }))
          } else {
            console.error('Profit & Loss response not successful:', profitResponse)
            toast.error(profitResponse?.message || 'Failed to load profit & loss data')
            setReportData(prev => ({ ...prev, profitLoss: null }))
          }
        } catch (error) {
          console.error('Error loading profit & loss:', error)
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load profit & loss report')
          setReportData(prev => ({ ...prev, profitLoss: null }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'branch-profit') {
        try {
          setLoading(true)
          const res = await profitAPI.getBranchProfit(dateRange.from, dateRange.to)
          const raw = res?.data ?? res ?? []
          const branchData = Array.isArray(raw)
            ? raw
            : (raw?.branches || raw?.items || raw?.data || [])
          setReportData(prev => ({ ...prev, branchProfit: branchData }))
        } catch (err) {
          if (!err?._handledByInterceptor) toast.error('Failed to load branch profit. Please try again.')
          setReportData(prev => ({ ...prev, branchProfit: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'outstanding') {
        try {
          setLoading(true)
          // CRITICAL: Get ALL pending bills with NO date filter so real outstanding total shows (e.g. 10,864.41 AED)
          // Backend returns all pending/partial invoices when from/to omitted
          const pendingBillsResponse = await reportsAPI.getPendingBills({
            status: 'all'
          })
          console.log('Outstanding bills response:', pendingBillsResponse)
          // API returns { success, data: { items: [...], totalCount, page, pageSize, totalPages } }
          const rawData = pendingBillsResponse?.data
          const bills = Array.isArray(rawData)
            ? rawData
            : (rawData?.items ?? [])
          setReportData(prev => ({
            ...prev,
            outstandingBills: bills || []
          }))
        } catch (error) {
          console.error('Error loading outstanding bills:', error)
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load outstanding bills')
          setReportData(prev => ({
            ...prev,
            outstandingBills: []
          }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'collections') {
        try {
          setLoading(true)
          const res = await reportsAPI.getOutstandingCustomers({ days: 365 })
          const list = (res?.success && res?.data) ? res.data : (Array.isArray(res?.data) ? res.data : [])
          setReportData(prev => ({ ...prev, collectionsList: list }))
        } catch (error) {
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load collections list')
          setReportData(prev => ({ ...prev, collectionsList: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'staff') {
        try {
          setLoading(true)
          // FIX: Pass route filter if applied
          const staffRes = await reportsAPI.getStaffPerformance({
            fromDate: dateRange.from,
            toDate: dateRange.to,
            routeId: appliedFilters.route ? parseInt(appliedFilters.route, 10) : undefined
          })
          if (staffRes?.success && staffRes?.data) {
            setReportData(prev => ({ ...prev, staffReport: staffRes.data || [] }))
          } else {
            setReportData(prev => ({ ...prev, staffReport: [] }))
          }
        } catch (error) {
          console.error('Error loading staff performance:', error)
          const msg = error?.response?.status === 404
            ? 'This report is currently unavailable. Please try again later or contact support.'
            : (error?.response?.data?.message || 'Failed to load staff performance')
          if (!error?._handledByInterceptor) toast.error(msg)
          setReportData(prev => ({ ...prev, staffReport: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'returns') {
        try {
          setLoading(true)
          const saleIdFromUrl = searchParams.get('saleId')
          const saleId = saleIdFromUrl ? parseInt(saleIdFromUrl, 10) : undefined
          const [returnsRes, categoriesRes, flagsRes] = await Promise.all([
            returnsAPI.getSaleReturnsPaged({
              fromDate: effectiveDateRange.from,
              toDate: effectiveDateRange.to,
              saleId: Number.isFinite(saleId) ? saleId : undefined,
              branchId: appliedFilters.branch ? parseInt(appliedFilters.branch, 10) : undefined,
              routeId: appliedFilters.route ? parseInt(appliedFilters.route, 10) : undefined,
              damageCategoryId: appliedFilters.damageCategory ? parseInt(appliedFilters.damageCategory, 10) : undefined,
              staffId: appliedFilters.staffId ? parseInt(appliedFilters.staffId, 10) : undefined,
              page: 1,
              pageSize: 50
            }),
            returnsAPI.getDamageCategories().catch(() => ({ success: true, data: [] })),
            returnsAPI.getFeatureFlags().catch(() => ({ success: true, data: {} }))
          ])
          const retData = returnsRes?.success && returnsRes?.data ? returnsRes.data : { items: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 0 }
          const cats = (categoriesRes?.success && categoriesRes?.data) ? categoriesRes.data : []
          setReportData(prev => ({
            ...prev,
            returnsReport: {
              items: retData.items || retData.Items || [],
              totalCount: retData.totalCount ?? retData.TotalCount ?? 0,
              page: retData.page ?? 1,
              pageSize: retData.pageSize ?? retData.PageSize ?? 50,
              totalPages: retData.totalPages ?? retData.TotalPages ?? 0
            },
            damageCategories: Array.isArray(cats) ? cats : []
          }))
          if (flagsRes?.success && flagsRes?.data) {
            const d = flagsRes.data
            setReturnsFeatureFlags({
              returnsEnabled: d.returnsEnabled !== false,
              returnsRequireApproval: !!d.returnsRequireApproval
            })
          }
        } catch (error) {
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load returns report')
          setReportData(prev => ({
            ...prev,
            returnsReport: { items: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 0 },
            damageCategories: []
          }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'damage') {
        try {
          setLoading(true)
          const res = await returnsAPI.getDamageReport({
            fromDate: effectiveDateRange.from,
            toDate: effectiveDateRange.to,
            branchId: appliedFilters.branch ? parseInt(appliedFilters.branch, 10) : undefined,
            routeId: appliedFilters.route ? parseInt(appliedFilters.route, 10) : undefined
          })
          const list = (res?.success && res?.data) ? res.data : []
          setReportData(prev => ({ ...prev, damageReport: Array.isArray(list) ? list : [] }))
        } catch (error) {
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load damage report')
          setReportData(prev => ({ ...prev, damageReport: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'credit-notes') {
        try {
          setLoading(true)
          const res = await returnsAPI.getCreditNotes({
            fromDate: dateRange.from,
            toDate: dateRange.to,
            customerId: appliedFilters.customer ? parseInt(appliedFilters.customer, 10) : undefined
          })
          const list = (res?.success && res?.data) ? res.data : []
          setReportData(prev => ({ ...prev, creditNotesReport: Array.isArray(list) ? list : [] }))
        } catch (error) {
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load credit notes')
          setReportData(prev => ({ ...prev, creditNotesReport: [] }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'net-sales') {
        try {
          setLoading(true)
          const res = await reportsAPI.getSummaryReport({
            fromDate: dateRange.from,
            toDate: dateRange.to,
            branchId: appliedFilters.branch ? parseInt(appliedFilters.branch, 10) : undefined,
            routeId: appliedFilters.route ? parseInt(appliedFilters.route, 10) : undefined
          })
          const d = (res?.success && res?.data) ? res.data : null
          const totalSales = d ? (parseFloat(d.totalSales ?? d.TotalSales ?? d.salesToday ?? d.SalesToday) || 0) : 0
          const totalReturns = d ? (parseFloat(d.totalReturns ?? d.TotalReturns ?? d.returnsToday ?? d.ReturnsToday) || 0) : 0
          const refundsPaid = d ? (parseFloat(d.refundsPaid ?? d.RefundsPaid ?? 0) || 0) : 0
          setReportData(prev => ({
            ...prev,
            netSalesReport: d ? { totalSales, totalReturns, netSales: totalSales - totalReturns, refundsPaid } : null
          }))
        } catch (error) {
          if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load net sales report')
          setReportData(prev => ({ ...prev, netSalesReport: null }))
        } finally {
          setLoading(false)
        }
      } else if (activeTab === 'ai') {
        try {
          const aiResponse = await reportsAPI.getAISuggestions({ periodDays: 30 })
          if (aiResponse?.success && aiResponse?.data) {
            const suggestions = []
            const aiData = aiResponse.data

            // Generate suggestions from AI data
            if (aiData.restockCandidates && aiData.restockCandidates.length > 0) {
              aiData.restockCandidates.slice(0, 3).forEach(product => {
                suggestions.push({
                  type: 'restock',
                  title: 'Low Stock Alert',
                  description: `${product.nameEn || product.sku} running low (${product.stockQty} units left)`,
                  action: 'Create Purchase Order',
                  priority: 'high'
                })
              })
            }

            if (aiData.promotionCandidates && aiData.promotionCandidates.length > 0) {
              aiData.promotionCandidates.slice(0, 2).forEach(product => {
                const margin = product.sellPrice && product.costPrice
                  ? ((product.sellPrice - product.costPrice) / product.sellPrice * 100).toFixed(1)
                  : '0'
                suggestions.push({
                  type: 'promotion',
                  title: 'Promotion Opportunity',
                  description: `${product.nameEn || product.sku} has high margin (${margin}%)`,
                  action: 'Create Promotion',
                  priority: 'medium'
                })
              })
            }

            if (aiData.pendingCustomers && aiData.pendingCustomers.length > 0) {
              aiData.pendingCustomers.slice(0, 2).forEach(customer => {
                suggestions.push({
                  type: 'customer',
                  title: 'Outstanding Payment',
                  description: `${customer.name} has outstanding balance of ${formatCurrency(customer.balance)}`,
                  action: 'Send Reminder',
                  priority: 'medium'
                })
              })
            }

            setReportData(prev => ({ ...prev, aiSuggestions: suggestions }))
          }
        } catch (error) {
          console.error('Error loading AI suggestions:', error)
        }
      }
      // Lazy load: mark this tab as loaded so we skip refetch when switching back
      tabDataCacheRef.current[tabCacheKey] = true
    } catch (error) {
      // Check if request was aborted (cancelled)
      const currentSignal = fetchAbortControllerRef.current?.signal
      if (error.name === 'AbortError' || (currentSignal && currentSignal.aborted)) {
        console.log('Request cancelled')
        return
      }

      // Don't show error for 429 (rate limit) - already handled by interceptor
      if (error?.response?.status === 429) {
        console.log('Rate limit exceeded, request throttled')
        // Reset fetching flag after delay
        setTimeout(() => {
          isFetchingRef.current = false
        }, 5000) // Wait 5 seconds before allowing next request
        return
      }

      // Skip logging when backend is down (connection blocked) to avoid console flood
      if (!error?.isConnectionBlocked && !error._logged) {
        console.error('Error loading report data:', error)
        error._logged = true
      }

      // Error toast is already handled by API interceptor with throttling
      // Don't show duplicate error messages
    } finally {
      setLoading(false)
      isFetchingRef.current = false
    }
  }, [dateRange, activeTab, appliedFilters, dateRange?.from, dateRange?.to])

  // Store latest fetchReportData in ref to avoid dependency issues
  useEffect(() => {
    fetchReportDataRef.current = fetchReportData
  }, [fetchReportData])

  // Sync activeTab with URL (on mount and when searchParams change, e.g. /reports?tab=outstanding)
  useEffect(() => {
    const tabFromUrl = searchParams.get('tab')
    const pathName = window.location.pathname

    if (pathName.includes('/outstanding')) {
      setActiveTab('outstanding')
      if (tabFromUrl !== 'outstanding') setSearchParams({ tab: 'outstanding' })
    } else if (tabFromUrl && tabs.find(t => t.id === tabFromUrl)) {
      setActiveTab(tabFromUrl)
    }
  }, [searchParams])

  // Listen for global data update events for instant refresh (with debouncing)
  useEffect(() => {
    let debounceTimer = null

    const handleDataUpdate = () => {
      // Skip if tab is changing or already fetching
      if (isTabChangingRef.current || isFetchingRef.current) {
        return
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(() => {
        if (!isFetchingRef.current && !isTabChangingRef.current && fetchReportDataRef.current) {
          fetchReportDataRef.current(true)
        }
      }, 2000)
    }

    window.addEventListener('dataUpdated', handleDataUpdate)
    window.addEventListener('paymentCreated', handleDataUpdate)
    window.addEventListener('customerCreated', handleDataUpdate)

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      window.removeEventListener('dataUpdated', handleDataUpdate)
      window.removeEventListener('paymentCreated', handleDataUpdate)
      window.removeEventListener('customerCreated', handleDataUpdate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only set up listeners once, use ref for fetchReportData

  // Load products, customers for filters (branches/routes from shared context)
  useEffect(() => {
    const loadFilterData = async () => {
      try {
        const [productsRes, customersRes] = await Promise.all([
          productsAPI.getProducts({ page: 1, pageSize: 100 }),
          customersAPI.getCustomers({ page: 1, pageSize: 100 })
        ])
        if (productsRes?.success && productsRes?.data) {
          setProductsList(productsRes.data.items || [])
        }
        if (customersRes?.success && customersRes?.data) {
          setCustomersList(customersRes.data.items || [])
        }
      } catch (error) {
        console.error('Error loading filter data:', error)
      }
    }
    loadFilterData()
  }, [])

  const handleApplyFilters = () => {
    setAppliedFilters({ ...filters })
    tabDataCacheRef.current = {} // Clear cache to force refresh
    // Trigger immediate refresh by calling fetchReportData if available
    if (fetchReportDataRef.current && !isFetchingRef.current) {
      fetchReportDataRef.current(false) // false = not initial load
    }
  }

  // routesList derived from context (filtered by filters.branch) - no fetch

  // Initial load ONLY ONCE on mount (separate from dependency-based refreshes)
  useEffect(() => {
    // Only do initial load once
    if (hasInitialLoadRef.current) {
      return
    }

    // Wait 1 second before initial load to prevent mount-time flooding
    initialLoadTimeoutRef.current = setTimeout(() => {
      if (!hasInitialLoadRef.current && fetchReportDataRef.current && !isFetchingRef.current) {
        hasInitialLoadRef.current = true
        fetchReportDataRef.current(true)
      }
    }, 1000) // 1 second delay before initial load (reasonable)

    return () => {
      if (initialLoadTimeoutRef.current) {
        clearTimeout(initialLoadTimeoutRef.current)
        initialLoadTimeoutRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // BUG #2.5 FIX: Apply debounced search filter when it changes
  useEffect(() => {
    if (debouncedSearch !== appliedFilters.search) {
      setAppliedFilters(prev => ({ ...prev, search: debouncedSearch }))
      tabDataCacheRef.current = {} // Clear cache when search changes
    }
  }, [debouncedSearch, appliedFilters.search])

  // Handle dependency-based refreshes (dateRange, activeTab, filters change)
  useEffect(() => {
    // Skip if initial load hasn't happened yet
    if (!hasInitialLoadRef.current) {
      return
    }

    // Skip if already fetching or tab changing
    if (isFetchingRef.current || isTabChangingRef.current) {
      return
    }

    // Cleanup any pending timeouts
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current)
      fetchTimeoutRef.current = null
    }

    // Debounce requests to prevent too many API calls, but not too aggressively
    fetchTimeoutRef.current = setTimeout(() => {
      // Double-check conditions before fetching
      if (
        !isFetchingRef.current &&
        !isTabChangingRef.current &&
        fetchReportDataRef.current &&
        hasInitialLoadRef.current
      ) {
        fetchReportDataRef.current(true)
      }
    }, 1000) // 1 second debounce (reduced from 10 seconds for better UX)

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
        fetchTimeoutRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, activeTab, appliedFilters]) // Only refresh when these change

  // Auto-refresh interval (separate useEffect) - DISABLED to prevent 429 errors
  useEffect(() => {
    // DISABLED: Auto-refresh causes too many requests
    // Users can manually refresh if needed
    return () => { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps - never runs

  const handleExport = async (format) => {
    try {
      toast.loading(`Exporting ${format.toUpperCase()} report...`)
      const blob = await reportsAPI.exportReportPdf({ fromDate: dateRange.from, toDate: dateRange.to, format })

      // Create download link
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `report_${dateRange.from}_${dateRange.to}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)

      toast.dismiss()
      toast.success(`${format.toUpperCase()} report exported successfully!`)
    } catch (error) {
      console.error('Failed to export report:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to export report')
    }
  }

  const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6']

  // Per-tab loading: show layout always; skeleton only in tab content area (Phase 2)
  const TabContentSkeleton = () => (
    <div className="animate-pulse space-y-4 rounded-lg border border-[#E5E7EB] bg-white p-6">
      <div className="h-6 bg-[#E5E7EB] rounded w-1/3" />
      <div className="h-4 bg-[#E5E7EB] rounded w-full" />
      <div className="h-4 bg-[#E5E7EB] rounded w-5/6" />
      <div className="h-32 bg-[#E5E7EB] rounded w-full" />
      <div className="h-4 bg-[#E5E7EB] rounded w-2/3" />
    </div>
  )

  return (
    <div className="w-full max-w-full space-y-6">
      {/* Header — full width */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center justify-center p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-[#0F172A]">Reports & Analytics</h1>
            <p className="text-xs sm:text-sm text-[#475569]">Comprehensive business insights and analytics</p>
          </div>
        </div>
        <div className="mt-2 sm:mt-0 flex flex-wrap gap-2 sm:space-x-3">
          <button
            onClick={() => fetchReportData()}
            className="inline-flex items-center justify-center px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm font-medium text-[#0F172A] bg-white hover:bg-[#F8FAFC] transition-colors duration-150"
          >
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="inline-flex items-center justify-center px-3 py-2 border border-transparent rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors duration-150"
          >
            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
            <span className="hidden sm:inline">Export PDF</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>
      </div>

      {/* Filters — collapsible; collapsed shows date row only to save space */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4 lg:p-6 w-full">
        <button
          type="button"
          onClick={() => setFiltersExpanded(prev => !prev)}
          className="flex items-center mb-2 w-full text-left"
          aria-expanded={filtersExpanded}
        >
          <Filter className="h-5 w-5 text-primary-600 mr-2 flex-shrink-0" />
          <h3 className="text-base lg:text-lg font-semibold text-neutral-900">Filters</h3>
          {filtersExpanded ? <ChevronUp className="h-5 w-5 ml-2 text-neutral-500" /> : <ChevronDown className="h-5 w-5 ml-2 text-neutral-500" />}
        </button>
        <p className="text-sm text-neutral-600 mb-3">Date range applies to all tabs below.</p>
        <div className="mb-3 sm:mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => {
              const today = new Date().toISOString().split('T')[0]
              setDateRange({ from: today, to: today })
            }}
            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            Today
          </button>
          <button
            onClick={() => {
              const yesterday = new Date()
              yesterday.setDate(yesterday.getDate() - 1)
              const yesterdayStr = yesterday.toISOString().split('T')[0]
              setDateRange({ from: yesterdayStr, to: yesterdayStr })
            }}
            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            Yesterday
          </button>
          <button
            onClick={() => {
              const to = new Date().toISOString().split('T')[0]
              const from = new Date()
              from.setDate(from.getDate() - 7)
              setDateRange({ from: from.toISOString().split('T')[0], to })
            }}
            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            Last 7 Days
          </button>
          <button
            onClick={() => {
              const to = new Date()
              const from = new Date(to)
              from.setDate(from.getDate() - from.getDay()) // Start of week (Sunday)
              setDateRange({ from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] })
            }}
            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            This Week
          </button>
          <button
            onClick={() => {
              const to = new Date().toISOString().split('T')[0]
              const from = new Date()
              from.setDate(1) // First day of month
              setDateRange({ from: from.toISOString().split('T')[0], to })
            }}
            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            This Month
          </button>
          <button
            onClick={() => {
              const to = new Date().toISOString().split('T')[0]
              const from = new Date()
              from.setFullYear(from.getFullYear(), 0, 1) // First day of year
              setDateRange({ from: from.toISOString().split('T')[0], to })
            }}
            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            This Year
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
          <Input
            label="From Date"
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
          />
          <Input
            label="To Date"
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
          />
          {!filtersExpanded ? (
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setFiltersExpanded(true)}
                className="px-3 py-2 text-sm border border-neutral-300 rounded-lg hover:bg-neutral-50 text-neutral-700 flex items-center gap-1"
              >
                <ChevronDown className="h-4 w-4" />
                Branch, Route, Product, Customer
              </button>
            </div>
          ) : (
            <>
          <Select
            label="Branch"
            options={[
              { value: '', label: 'All Branches' },
              ...branchesList.map(b => ({ value: String(b.id), label: b.name || 'Branch' }))
            ]}
            value={filters.branch}
            onChange={(e) => setFilters(prev => ({ ...prev, branch: e.target.value, route: '' }))}
          />
          <Select
            label="Route"
            options={[
              { value: '', label: 'All Routes' },
              ...routesList.map(r => ({ value: String(r.id), label: r.name || 'Route' }))
            ]}
            value={filters.route}
            onChange={(e) => setFilters(prev => ({ ...prev, route: e.target.value }))}
          />
          <Select
            label="Product"
            options={[
              { value: '', label: 'All Products' },
              ...productsList.map(p => ({ value: p.id?.toString(), label: p.nameEn || p.sku || 'Unknown' }))
            ]}
            value={filters.product}
            onChange={(e) => setFilters(prev => ({ ...prev, product: e.target.value }))}
          />
          <Select
            label="Customer"
            options={[
              { value: '', label: 'All Customers' },
              ...customersList.map(c => ({ value: c.id?.toString(), label: c.name || 'Unknown' }))
            ]}
            value={filters.customer}
            onChange={(e) => setFilters(prev => ({ ...prev, customer: e.target.value }))}
          />
          {/* Status filter for Sales Report */}
          {activeTab === 'sales' && (
            <Select
              label="Status"
              options={[
                { value: '', label: 'All Status' },
                { value: 'Paid', label: 'Paid' },
                { value: 'Pending', label: 'Pending' },
                { value: 'Partial', label: 'Partial' }
              ]}
              value={filters.status}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            />
          )}
          {/* Returns report filters */}
          {activeTab === 'returns' && (
            <>
              <Select
                label="Damage Category"
                options={[
                  { value: '', label: 'All Categories' },
                  ...(reportData.damageCategories || []).map(dc => ({ value: String(dc.id), label: dc.name || 'Unknown' }))
                ]}
                value={filters.damageCategory}
                onChange={(e) => setFilters(prev => ({ ...prev, damageCategory: e.target.value }))}
              />
              <Input
                label="Staff User ID"
                type="number"
                min="1"
                placeholder="Optional"
                value={filters.staffId}
                onChange={(e) => setFilters(prev => ({ ...prev, staffId: e.target.value }))}
              />
            </>
          )}
          <div className="flex items-end">
            <button
              onClick={handleApplyFilters}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Apply Filters
            </button>
          </div>
          </>
          )}
        </div>
      </div>

      {/* Tabs — full width, scrollable with visible affordance (scrollbar + arrows) */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] w-full">
        <div className="px-2 sm:px-4 py-2 w-full flex items-center gap-1">
          <button
            type="button"
            onClick={() => reportsTabsRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
            className="flex-shrink-0 p-1.5 rounded-md text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#334155] transition-colors"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <nav
            ref={reportsTabsRef}
            className="flex gap-2 overflow-x-auto pb-1 -mx-1 w-full min-w-0"
            role="tablist"
            aria-label="Report sections; scroll horizontally for more tabs"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              const label = tab.shortLabel || tab.name
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 py-2 px-3 sm:px-4 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-all duration-150 ${active
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-[#475569] bg-[#F8FAFC] border border-[#E5E7EB] hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700'
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span>{label}</span>
                </button>
              )
            })}
          </nav>
          <button
            type="button"
            onClick={() => reportsTabsRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
            className="flex-shrink-0 p-1.5 rounded-md text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#334155] transition-colors"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <TabContentSkeleton />
          ) : (
          <>
          {/* Summary Tab */}
          {activeTab === 'summary' && reportData.summary && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                <div className="bg-green-50 rounded-lg p-3 sm:p-4 lg:p-6">
                  <div className="flex items-center">
                    <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-green-600 flex-shrink-0" />
                    <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-green-600">Total Sales</p>
                      <p className="text-base sm:text-xl lg:text-2xl font-bold text-green-900 truncate">
                        {formatCurrency(reportData.summary.totalSales || 0)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 rounded-lg p-3 sm:p-4 lg:p-6">
                  <div className="flex items-center">
                    <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-blue-600 flex-shrink-0" />
                    <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-blue-600">Total Purchases</p>
                      <p className="text-base sm:text-xl lg:text-2xl font-bold text-blue-900 truncate">
                        {formatCurrency(reportData.summary.totalPurchases || 0)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-red-50 rounded-lg p-3 sm:p-4 lg:p-6">
                  <div className="flex items-center">
                    <TrendingDown className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-red-600 flex-shrink-0" />
                    <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-red-600">Total Expenses</p>
                      <p className="text-base sm:text-xl lg:text-2xl font-bold text-red-900 truncate">
                        {formatCurrency(reportData.summary.totalExpenses || 0)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-purple-50 rounded-lg p-3 sm:p-4 lg:p-6">
                  <div className="flex items-center">
                    <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-purple-600 flex-shrink-0" />
                    <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-purple-600">Net Profit</p>
                      <p className="text-base sm:text-xl lg:text-2xl font-bold text-purple-900 truncate">
                        {formatCurrency(reportData.summary.netProfit || 0)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales Trend</h3>
                  {reportData.sales.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={reportData.sales}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} />
                        <YAxis axisLine={false} tickLine={false} />
                        <Tooltip formatter={(value) => formatCurrency(value)} />
                        <Line type="linear" dataKey="amount" stroke="#10B981" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-gray-500">
                      No sales data available for the selected period
                    </div>
                  )}
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Expense Breakdown</h3>
                  {reportData.summary.totalExpenses > 0 ? (
                    <div className="flex items-center justify-center h-64 text-gray-500">
                      Expense breakdown chart coming soon
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-gray-500">
                      No expense data available
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sales Tab */}
          {activeTab === 'sales' && (
            <div className="space-y-6">
              {loadingSales ? (
                <LoadingCard message="Loading sales data..." />
              ) : (
                <>
                  <div className="bg-white border border-gray-200 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales Performance</h3>
                    {reportData.sales.length > 0 ? (
                      <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={reportData.sales}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                          <XAxis dataKey="date" axisLine={false} tickLine={false} />
                          <YAxis axisLine={false} tickLine={false} />
                          <Tooltip formatter={(value) => formatCurrency(value)} />
                          <Bar dataKey="amount" fill="#10B981" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-64 text-gray-500">
                        No sales data available for the selected period
                      </div>
                    )}
                  </div>

                  {/* Sales Table with Status Colors */}
                  {reportData.salesList && reportData.salesList.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-900">Sales Details</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice No</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paid</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {reportData.salesList.map((sale, idx) => {
                              // Color coding: Paid = green, Pending = orange, Overdue = red
                              const statusColor = sale.status === 'Paid'
                                ? 'bg-green-100 text-green-800'
                                : sale.isOverdue
                                  ? 'bg-red-100 text-red-800'
                                  : sale.status === 'Partial'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-orange-100 text-orange-800'

                              return (
                                <tr key={idx} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {sale.invoiceNo}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(sale.invoiceDate).toLocaleDateString()}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                    {sale.customerName || 'Cash Customer'}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                                    {formatCurrency(sale.grandTotal || 0)}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-600">
                                    {formatCurrency(sale.paidAmount || 0)}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium">
                                    <span className={sale.balance > 0.01 ? 'text-red-600' : 'text-green-600'}>
                                      {formatCurrency(sale.balance || 0)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-center">
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColor}`}>
                                      {sale.status}
                                      {sale.isOverdue && ' (Overdue)'}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Products Tab */}
          {activeTab === 'products' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Products by Sales</h3>
                  {reportData.products && reportData.products.length > 0 ? (
                    <div className="space-y-4">
                      {reportData.products.map((product, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                          <div className="flex items-center flex-1">
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                              <span className="text-blue-600 font-semibold">#{index + 1}</span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{product.name}</p>
                              {product.qty > 0 && (
                                <p className="text-sm text-gray-600">
                                  Quantity Sold: {product.qty.toLocaleString()}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-gray-900">{formatCurrency(product.sales)}</p>
                            <p className="text-sm text-gray-600">Total Sales</p>
                          </div>
                        </div>
                      ))}
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-gray-900">Total Sales</p>
                          <p className="font-bold text-lg text-green-600">
                            {formatCurrency(
                              reportData.products.reduce((sum, p) => sum + (p.sales || 0), 0)
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                      <PieChart className="h-12 w-12 mb-2 text-gray-400" />
                      <p>No product sales data available</p>
                      <p className="text-sm mt-1">Try selecting a different date range</p>
                    </div>
                  )}
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Product Sales Distribution</h3>
                  {reportData.products && reportData.products.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <BarChart data={reportData.products.slice(0, 10)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                        <XAxis
                          dataKey="name"
                          angle={-45}
                          textAnchor="end"
                          height={100}
                          interval={0}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis axisLine={false} tickLine={false} />
                        <Tooltip formatter={(value) => formatCurrency(value)} />
                        <Bar dataKey="sales" fill="#3B82F6" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-gray-500">
                      No product sales data available for chart
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Customers Tab */}
          {activeTab === 'customers' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Outstanding Customers Report</h3>
                {reportData.customers && reportData.customers.length > 0 ? (
                  <div className="space-y-4">
                    {reportData.customers.map((customer, index) => (
                      <div key={customer.id || index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{customer.name}</p>
                          {customer.phone && (
                            <p className="text-sm text-gray-600">
                              Phone: {customer.phone}
                            </p>
                          )}
                          {customer.creditLimit > 0 && (
                            <p className="text-sm text-gray-500">
                              Credit Limit: {formatCurrency(customer.creditLimit)}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold text-lg ${customer.total > (customer.creditLimit * 0.8)
                            ? 'text-red-600'
                            : customer.total > (customer.creditLimit * 0.5)
                              ? 'text-yellow-600'
                              : 'text-gray-900'
                            }`}>
                            {formatCurrency(customer.total)}
                          </p>
                          <p className="text-sm text-gray-600">Outstanding Balance</p>
                          {customer.creditLimit > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                              {((customer.total / customer.creditLimit) * 100).toFixed(1)}% of limit
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-gray-900">Total Outstanding</p>
                        <p className="font-bold text-lg text-red-600">
                          {formatCurrency(
                            reportData.customers.reduce((sum, c) => sum + (c.total || 0), 0)
                          )}
                        </p>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {reportData.customers.length} {reportData.customers.length === 1 ? 'customer' : 'customers'} with outstanding balance
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                    <FileText className="h-12 w-12 mb-2 text-gray-400" />
                    <p>No outstanding customers found</p>
                    <p className="text-sm mt-1">All customers have zero balance</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Expenses Tab */}
          {activeTab === 'expenses' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Expense Breakdown by Category</h3>
                  {reportData.expenses && reportData.expenses.length > 0 ? (
                    <div className="space-y-4">
                      {reportData.expenses.map((expense, index) => (
                        <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-center">
                            <div
                              className="w-4 h-4 rounded-full mr-3"
                              style={{ backgroundColor: expense.categoryColor }}
                            />
                            <div>
                              <p className="font-medium text-gray-900">{expense.categoryName}</p>
                              <p className="text-sm text-gray-600">
                                {expense.expenseCount} {expense.expenseCount === 1 ? 'expense' : 'expenses'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-gray-900">{formatCurrency(expense.totalAmount)}</p>
                            <p className="text-sm text-gray-600">
                              {reportData.summary && reportData.summary.totalExpenses > 0
                                ? ((expense.totalAmount / reportData.summary.totalExpenses) * 100).toFixed(1)
                                : 0}%
                            </p>
                          </div>
                        </div>
                      ))}
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-gray-900">Total Expenses</p>
                          <p className="font-bold text-lg text-gray-900">
                            {formatCurrency(
                              reportData.expenses.reduce((sum, e) => sum + (e.totalAmount || 0), 0)
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                      <p>No data found for {dateRange.from} to {dateRange.to}</p>
                      <p className="text-sm mt-1">Try expanding the date range or check that expenses exist in this period.</p>
                      <button onClick={() => fetchReportData(true)} className="mt-3 px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700">
                        Retry
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Expense Distribution</h3>
                  {reportData.expenses && reportData.expenses.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                      <RechartsPieChart>
                        <Pie
                          data={reportData.expenses.map(e => ({
                            name: e.categoryName,
                            value: e.totalAmount
                          }))}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={(props) => {
                            const sliceName = String(props?.name ?? '')
                            const frac = typeof props?.percent === 'number' ? props.percent : Number(props?.percent) || 0
                            return `${sliceName}: ${(frac * 100).toFixed(0)}%`
                          }}
                          outerRadius={120}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {reportData.expenses.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.categoryColor || COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatCurrency(value)} />
                        <Legend />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                      <p>No data found for {dateRange.from} to {dateRange.to}</p>
                      <p className="text-sm mt-1">Try expanding the date range or check that expenses exist in this period.</p>
                      <button onClick={() => fetchReportData(true)} className="mt-3 px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700">
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {reportData.summary && reportData.summary.totalExpenses > 0 && (
                <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-red-600">Total Expenses for Selected Period</p>
                      <p className="text-3xl font-bold text-red-900 mt-2">
                        {formatCurrency(reportData.summary.totalExpenses || 0)}
                      </p>
                    </div>
                    <TrendingDown className="h-12 w-12 text-red-600" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Branch Report Tab */}
          {activeTab === 'branch' && (
            <div className="space-y-6">
              {/* FIX: Add export button for Branch Report */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between">
                <p className="text-sm text-gray-600">Branch comparison with profitability metrics</p>
                <button
                  onClick={async () => {
                    try {
                      toast.loading('Exporting branch report...')
                      // TODO: Add export endpoint for branch report
                      toast.dismiss()
                      showToast.info('Branch report export coming soon')
                    } catch (error) {
                      console.error('Failed to export:', error)
                      toast.dismiss()
                      if (!error?._handledByInterceptor) toast.error('Failed to export branch report')
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
                  disabled={!reportData.branchComparison || reportData.branchComparison.length === 0}
                >
                  <Download className="h-4 w-4" />
                  <span>Export Excel</span>
                </button>
              </div>
              {reportData.branchComparison?.length > 0 ? (
                <>
                  {reportData.branchComparison[0] && (() => {
                    const topBranch = reportData.branchComparison[0]
                    // FIX: Use profitability (margin %) instead of just sales volume for "Top Performer"
                    const branchesWithMargin = reportData.branchComparison.map(b => ({
                      ...b,
                      marginPercent: b.totalSales > 0 ? ((b.profit || 0) / b.totalSales * 100) : 0
                    }))
                    const topByMargin = branchesWithMargin.reduce((top, b) => 
                      b.marginPercent > top.marginPercent ? b : top, branchesWithMargin[0]
                    )
                    const isTopByMargin = topBranch.branchId === topByMargin.branchId
                    return (
                      <div className={`rounded-xl p-6 border-2 ${isTopByMargin ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200' : 'bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200'}`}>
                        <p className="text-sm font-medium text-amber-700">🏆 Top Branch {isTopByMargin ? '(by Profitability)' : '(by Sales Volume)'}</p>
                        <p className="text-xl font-bold text-amber-900 mt-1">{topBranch.branchName}</p>
                        <p className="text-2xl font-bold text-amber-800 mt-2">{formatCurrency(topBranch.totalSales || 0)}</p>
                        {topBranch.totalSales > 0 && (
                          <p className="text-sm text-gray-600 mt-1">
                            Profit Margin: <span className={`font-semibold ${
                              ((topBranch.profit || 0) / topBranch.totalSales * 100) >= 20 ? 'text-green-600' :
                              ((topBranch.profit || 0) / topBranch.totalSales * 100) >= 10 ? 'text-yellow-600' :
                              'text-red-600'
                            }`}>
                              {((topBranch.profit || 0) / topBranch.totalSales * 100).toFixed(1)}%
                            </span>
                          </p>
                        )}
                        {topBranch.growthPercent != null && (
                          <span className={`inline-flex items-center mt-2 text-sm font-medium ${(topBranch.growthPercent || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {(topBranch.growthPercent || 0) >= 0 ? '↑' : '↓'} {Math.abs(topBranch.growthPercent || 0).toFixed(1)}% vs previous period
                          </span>
                        )}
                      </div>
                    )
                  })()}
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-8" />
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">COGS</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Expenses</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Profit</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin %</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Growth</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {reportData.branchComparison.map((row, idx) => {
                            const routes = row.routes || []
                            const hasRoutes = routes.length > 0
                            const isExpanded = expandedBranchId === row.branchId
                            return (
                              <React.Fragment key={row.branchId}>
                                <tr className="hover:bg-blue-50">
                                  <td className="px-2 py-3">
                                    {hasRoutes ? (
                                      <button type="button" onClick={() => setExpandedBranchId(isExpanded ? null : row.branchId)} className="p-0.5 cursor-pointer">
                                        {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
                                      </button>
                                    ) : <span className="w-4 inline-block" />}
                                  </td>
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">#{idx + 1}</td>
                                  <td
                                    className="px-4 py-3 text-sm font-medium text-blue-600 cursor-pointer hover:underline"
                                    onClick={() => navigate(`/branches/${row.branchId}?from=${dateRange.from}&to=${dateRange.to}`)}
                                  >
                                    {row.branchName}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right text-gray-900">{formatCurrency(row.totalSales || 0)}</td>
                                  <td className="px-4 py-3 text-sm text-right text-amber-700">{formatCurrency(row.costOfGoodsSold || 0)}</td>
                                  <td className="px-4 py-3 text-sm text-right text-red-600">{formatCurrency(row.totalExpenses || 0)}</td>
                                  <td className={`px-4 py-3 text-sm text-right font-medium ${(row.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {formatCurrency(row.profit || 0)}
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm">
                                    {/* FIX: Add profitability/margin metric instead of just sales volume */}
                                    {row.totalSales > 0 ? (
                                      <span className={`font-medium ${
                                        ((row.profit || 0) / row.totalSales * 100) >= 20 ? 'text-green-600' :
                                        ((row.profit || 0) / row.totalSales * 100) >= 10 ? 'text-yellow-600' :
                                        'text-red-600'
                                      }`}>
                                        {((row.profit || 0) / row.totalSales * 100).toFixed(1)}%
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    {row.growthPercent != null ? (
                                      <span className={row.growthPercent >= 0 ? 'text-green-600' : 'text-red-600'}>
                                        {row.growthPercent >= 0 ? '↑' : '↓'} {Math.abs(row.growthPercent).toFixed(1)}%
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                  </td>
                                </tr>
                                {isExpanded && hasRoutes && routes.map((rt) => (
                                  <tr
                                    key={rt.routeId}
                                    onClick={() => navigate(`/routes/${rt.routeId}?from=${dateRange.from}&to=${dateRange.to}`)}
                                    className="bg-gray-50 hover:bg-blue-50/50 cursor-pointer"
                                  >
                                    <td className="px-2 py-2" />
                                    <td className="px-4 py-2 text-sm text-gray-500" />
                                    <td className="px-4 py-2 text-sm text-gray-700 pl-8">↳ {rt.routeName || rt.name}</td>
                                    <td className="px-4 py-2 text-sm text-right text-gray-700">{formatCurrency(rt.totalSales || 0)}</td>
                                    <td className="px-4 py-2 text-sm text-right text-amber-700">{formatCurrency(rt.costOfGoodsSold || 0)}</td>
                                    <td className="px-4 py-2 text-sm text-right text-red-600">{formatCurrency(rt.totalExpenses || 0)}</td>
                                    <td className={`px-4 py-2 text-sm text-right font-medium ${(rt.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {formatCurrency(rt.profit || 0)}
                                    </td>
                                    <td className="px-4 py-2" />
                                  </tr>
                                ))}
                              </React.Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Branch Comparison Chart</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={reportData.branchComparison.map(b => ({ name: b.branchName, sales: Number(b.totalSales || 0), expenses: Number(b.totalExpenses || 0), profit: Number(b.profit || 0) }))} margin={{ top: 20, right: 30, left: 20, bottom: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                        <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v) => formatCurrency(v)} />
                        <Legend />
                        <Bar dataKey="sales" name="Sales" fill="#3B82F6" />
                        <Bar dataKey="expenses" name="Expenses" fill="#EF4444" />
                        <Bar dataKey="profit" name="Profit" fill="#10B981" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
                  {loading ? 'Loading branch report...' : (
                      <>
                        <p>No data found for {dateRange.from} to {dateRange.to}</p>
                        <p className="text-sm mt-1">Try expanding the date range or check that transactions exist in this period.</p>
                        <button onClick={() => fetchReportData(true)} className="mt-3 px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700">
                          Retry
                        </button>
                      </>
                    )}
                </div>
              )}
            </div>
          )}

          {/* Route Report Tab — flat list of all routes with Sales, COGS, Expenses, Profit */}
          {activeTab === 'route' && (
            <div className="space-y-6">
              {(() => {
                const routeRows = (reportData.branchComparison || []).flatMap(b =>
                  (b.routes || [])
                    .filter(r => r.routeId || r.id)
                    .map(r => ({
                      ...r,
                      branchName: b.branchName,
                      branchId: b.branchId,
                      routeName: r.routeName || r.name || `Route ${r.routeId ?? r.id}`
                    }))
                )
                return routeRows.length > 0 ? (
                  <>
                    <p className="text-sm text-gray-500">All routes across branches. COGS uses product cost from purchases.</p>
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Route</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">COGS</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Expenses</th>
                              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Profit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {routeRows.map((rt) => (
                              <tr
                                key={`${rt.branchId}-${rt.routeId}`}
                                onClick={() => navigate(`/routes/${rt.routeId}?from=${dateRange.from}&to=${dateRange.to}`)}
                                className="hover:bg-blue-50 cursor-pointer"
                              >
                                <td className="px-4 py-3 text-sm text-gray-700">{rt.branchName}</td>
                                <td className="px-4 py-3 text-sm font-medium text-blue-600">{rt.routeName || rt.name}</td>
                                <td className="px-4 py-3 text-sm text-right text-gray-900">{formatCurrency(rt.totalSales || 0)}</td>
                                <td className="px-4 py-3 text-sm text-right text-amber-700">{formatCurrency(rt.costOfGoodsSold ?? 0)}</td>
                                <td className="px-4 py-3 text-sm text-right text-red-600">{formatCurrency(rt.totalExpenses || 0)}</td>
                                <td className={`px-4 py-3 text-sm text-right font-medium ${(rt.profit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {formatCurrency(rt.profit ?? 0)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
                    {loading ? 'Loading route report...' : (
                      <>
                        <p>No data found for {dateRange.from} to {dateRange.to}</p>
                        <p className="text-sm mt-1">Try expanding the date range or check that transactions exist in this period.</p>
                        <button onClick={() => fetchReportData(true)} className="mt-3 px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700">
                          Retry
                        </button>
                      </>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Customer Aging Tab */}
          {activeTab === 'aging' && (
            <div className="space-y-6">
              {/* FIX: Add "as of date" selector for historical aging analysis */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-4 flex-wrap justify-between">
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="text-sm font-medium text-gray-700">As of Date:</label>
                    <Input
                      type="date"
                      value={agingAsOfDate}
                      onChange={(e) => {
                        setAgingAsOfDate(e.target.value)
                        tabDataCacheRef.current = {} // Clear cache to force reload
                      }}
                      className="max-w-xs"
                    />
                    <button
                      onClick={() => {
                        const today = new Date().toISOString().split('T')[0]
                        setAgingAsOfDate(today)
                        tabDataCacheRef.current = {}
                      }}
                      className="px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                    >
                      Reset to Today
                    </button>
                    <button
                      onClick={() => fetchReportData(true)}
                      className="px-3 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 flex items-center gap-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Refresh
                    </button>
                  </div>
                  {/* FIX: Add export button for Customer Aging */}
                  <button
                    onClick={async () => {
                      try {
                        toast.loading('Exporting aging report...')
                        // TODO: Add export endpoint for aging report
                        toast.dismiss()
                        showToast.info('Aging report export coming soon')
                      } catch (error) {
                        console.error('Failed to export:', error)
                        toast.dismiss()
                        if (!error?._handledByInterceptor) toast.error('Failed to export aging report')
                      }
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
                    disabled={!reportData.agingReport || !reportData.agingReport.invoices || reportData.agingReport.invoices.length === 0}
                  >
                    <Download className="h-4 w-4" />
                    <span>Export Excel</span>
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Set a past date to see historical aging (e.g., "What was our aging on Dec 31?")
                </p>
              </div>
              {reportData.agingReport ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                      <p className="text-xs font-medium text-green-700">0-30 Days</p>
                      <p className="text-lg font-bold text-green-900">{formatCurrency(reportData.agingReport.bucket0_30?.total || 0)}</p>
                      <p className="text-xs text-green-600">{reportData.agingReport.bucket0_30?.count || 0} invoices</p>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                      <p className="text-xs font-medium text-yellow-700">31-60 Days</p>
                      <p className="text-lg font-bold text-yellow-900">{formatCurrency(reportData.agingReport.bucket31_60?.total || 0)}</p>
                      <p className="text-xs text-yellow-600">{reportData.agingReport.bucket31_60?.count || 0} invoices</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                      <p className="text-xs font-medium text-orange-700">61-90 Days</p>
                      <p className="text-lg font-bold text-orange-900">{formatCurrency(reportData.agingReport.bucket61_90?.total || 0)}</p>
                      <p className="text-xs text-orange-600">{reportData.agingReport.bucket61_90?.count || 0} invoices</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                      <p className="text-xs font-medium text-red-700">90+ Days</p>
                      <p className="text-lg font-bold text-red-900">{formatCurrency(reportData.agingReport.bucket90Plus?.total || 0)}</p>
                      <p className="text-xs text-red-600">{reportData.agingReport.bucket90Plus?.count || 0} invoices</p>
                    </div>
                    <div className="bg-neutral-100 rounded-lg p-4 border border-neutral-200">
                      <p className="text-xs font-medium text-neutral-600">Total Outstanding</p>
                      <p className="text-lg font-bold text-neutral-900">{formatCurrency(reportData.agingReport.totalOutstanding || 0)}</p>
                    </div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <h3 className="px-4 py-3 bg-gray-50 font-medium">Invoice Details</h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Days Overdue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {(reportData.agingReport.invoices || []).map((inv) => (
                            <tr key={inv.id}>
                              <td className="px-4 py-2 text-sm font-medium">{inv.invoiceNo || inv.invoice_no}</td>
                              <td className="px-4 py-2 text-sm">{inv.customerName || inv.customer_name || '—'}</td>
                              <td className="px-4 py-2 text-sm">{inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : '—'}</td>
                              <td className="px-4 py-2 text-sm text-right font-medium">{formatCurrency(inv.balanceAmount ?? inv.balance_amount ?? 0)}</td>
                              <td className={`px-4 py-2 text-sm text-right ${(inv.daysOverdue ?? inv.days_overdue ?? 0) > 90 ? 'text-red-600 font-medium' : ''}`}>
                                {inv.daysOverdue ?? inv.days_overdue ?? 0}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(!reportData.agingReport.invoices || reportData.agingReport.invoices.length === 0) && (
                      <p className="px-4 py-8 text-center text-gray-500">No outstanding invoices</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
                  {loading ? 'Loading aging report...' : 'No aging data available.'}
                </div>
              )}
            </div>
          )}

          {/* AP Aging Tab */}
          {activeTab === 'ap-aging' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-4 flex-wrap justify-between">
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="text-sm font-medium text-gray-700">As of Date:</label>
                    <Input
                      type="date"
                      value={agingAsOfDate}
                      onChange={(e) => {
                        setAgingAsOfDate(e.target.value)
                        tabDataCacheRef.current = {}
                      }}
                      className="max-w-xs"
                    />
                    <button
                      onClick={() => {
                        setAgingAsOfDate(new Date().toISOString().split('T')[0])
                        tabDataCacheRef.current = {}
                      }}
                      className="px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                    >
                      Reset to Today
                    </button>
                    <button
                      onClick={() => fetchReportData(true)}
                      className="px-3 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 flex items-center gap-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Refresh
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  What we owe to suppliers by age (based on last purchase date).
                </p>
              </div>
              {reportData.apAgingReport ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                      <p className="text-xs font-medium text-green-700">0-30 Days</p>
                      <p className="text-lg font-bold text-green-900">{formatCurrency(reportData.apAgingReport.bucket0_30?.total || 0)}</p>
                      <p className="text-xs text-green-600">{reportData.apAgingReport.bucket0_30?.count || 0} suppliers</p>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                      <p className="text-xs font-medium text-yellow-700">31-60 Days</p>
                      <p className="text-lg font-bold text-yellow-900">{formatCurrency(reportData.apAgingReport.bucket31_60?.total || 0)}</p>
                      <p className="text-xs text-yellow-600">{reportData.apAgingReport.bucket31_60?.count || 0} suppliers</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                      <p className="text-xs font-medium text-orange-700">61-90 Days</p>
                      <p className="text-lg font-bold text-orange-900">{formatCurrency(reportData.apAgingReport.bucket61_90?.total || 0)}</p>
                      <p className="text-xs text-orange-600">{reportData.apAgingReport.bucket61_90?.count || 0} suppliers</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                      <p className="text-xs font-medium text-red-700">90+ Days</p>
                      <p className="text-lg font-bold text-red-900">{formatCurrency(reportData.apAgingReport.bucket90Plus?.total || 0)}</p>
                      <p className="text-xs text-red-600">{reportData.apAgingReport.bucket90Plus?.count || 0} suppliers</p>
                    </div>
                    <div className="bg-neutral-100 rounded-lg p-4 border border-neutral-200">
                      <p className="text-xs font-medium text-neutral-600">Total Outstanding</p>
                      <p className="text-lg font-bold text-neutral-900">{formatCurrency(reportData.apAgingReport.totalOutstanding || 0)}</p>
                    </div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <h3 className="px-4 py-3 bg-gray-50 font-medium">Supplier Details</h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Days</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Bucket</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {(reportData.apAgingReport.items || []).map((item, idx) => (
                            <tr key={item.supplierName + idx}>
                              <td className="px-4 py-2 text-sm font-medium">{item.supplierName}</td>
                              <td className="px-4 py-2 text-sm text-right font-medium">{formatCurrency(item.balance || 0)}</td>
                              <td className={`px-4 py-2 text-sm text-right ${(item.daysOverdue ?? 0) > 90 ? 'text-red-600 font-medium' : ''}`}>{item.daysOverdue ?? 0}</td>
                              <td className="px-4 py-2 text-sm">{item.agingBucket || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(!reportData.apAgingReport.items || reportData.apAgingReport.items.length === 0) && (
                      <p className="px-4 py-8 text-center text-gray-500">No payables outstanding</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
                  {loading ? 'Loading AP aging report...' : 'No AP aging data available.'}
                </div>
              )}
            </div>
          )}

          {/* Profit & Loss Tab */}
          {activeTab === 'profit-loss' && (
            <div className="space-y-6">
              {reportData.profitLoss ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <h3 className="text-lg font-semibold text-gray-900">Profit & Loss</h3>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          toast.loading('Generating P&L PDF...')
                          const blob = await profitAPI.exportProfitLossPdf(dateRange.from, dateRange.to)
                          const url = window.URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `profit_loss_${dateRange.from}_${dateRange.to}.pdf`
                          document.body.appendChild(a)
                          a.click()
                          a.remove()
                          window.URL.revokeObjectURL(url)
                          toast.dismiss()
                          toast.success('P&L PDF downloaded successfully!')
                        } catch (error) {
                          console.error('Failed to export P&L PDF:', error)
                          toast.dismiss()
                          if (!error?._handledByInterceptor) toast.error(error?.message || 'Failed to export P&L PDF')
                        }
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      <span>Export PDF</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-green-50 rounded-lg p-6 border border-green-200">
                      <p className="text-sm font-medium text-green-600">Total Sales</p>
                      <p className="text-2xl font-bold text-green-900 mt-2">
                        {formatCurrency(reportData.profitLoss.totalSales || 0)}
                      </p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                      <p className="text-sm font-medium text-blue-600">Total Purchases</p>
                      <p className="text-2xl font-bold text-blue-900 mt-2">
                        {formatCurrency(reportData.profitLoss.totalPurchases || 0)}
                      </p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-6 border border-purple-200">
                      <p className="text-sm font-medium text-purple-600">Gross Profit</p>
                      <p className="text-2xl font-bold text-purple-900 mt-2">
                        {formatCurrency(reportData.profitLoss.grossProfit || 0)}
                      </p>
                      <p className="text-xs text-purple-600 mt-1">
                        Margin: {reportData.profitLoss.grossProfitMargin?.toFixed(1) || (reportData.profitLoss.totalSales > 0
                          ? ((reportData.profitLoss.grossProfit / reportData.profitLoss.totalSales) * 100).toFixed(1)
                          : '0.0')}%
                      </p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-6 border border-red-200">
                      <p className="text-sm font-medium text-red-600">Total Expenses</p>
                      <p className="text-2xl font-bold text-red-900 mt-2">
                        {formatCurrency(reportData.profitLoss.totalExpenses || 0)}
                      </p>
                    </div>
                  </div>

                  <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg p-6 border-2 border-green-300">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Net Profit / Loss</p>
                        <p className={`text-4xl font-bold mt-2 ${(reportData.profitLoss.netProfit || 0) >= 0 ? 'text-green-700' : 'text-red-700'
                          }`}>
                          {formatCurrency(reportData.profitLoss.netProfit || 0)}
                        </p>
                        <p className="text-sm text-gray-600 mt-2">
                          Net Profit Margin: {reportData.profitLoss.netProfitMargin?.toFixed(2) || (reportData.profitLoss.totalSales > 0
                            ? ((reportData.profitLoss.netProfit / reportData.profitLoss.totalSales) * 100).toFixed(2)
                            : '0.00')}%
                        </p>
                      </div>
                      {(reportData.profitLoss.netProfit || 0) >= 0
                        ? <TrendingUp className="h-16 w-16 text-green-600" />
                        : <TrendingDown className="h-16 w-16 text-red-600" />}
                    </div>
                  </div>

                  {reportData.profitLoss.dailyProfit && reportData.profitLoss.dailyProfit.length > 0 ? (
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Profit Trend</h3>
                      <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={reportData.profitLoss.dailyProfit}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(value) => {
                              try {
                                return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                              } catch {
                                return value
                              }
                            }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis axisLine={false} tickLine={false} />
                          <Tooltip
                            formatter={(value) => formatCurrency(value)}
                            labelFormatter={(value) => {
                              try {
                                return new Date(value).toLocaleDateString()
                              } catch {
                                return value
                              }
                            }}
                          />
                          <Legend />
                          <Line type="linear" dataKey="profit" stroke="#10B981" strokeWidth={2} name="Profit" />
                          <Line type="linear" dataKey="sales" stroke="#3B82F6" strokeWidth={2} name="Sales" />
                          <Line type="linear" dataKey="expenses" stroke="#EF4444" strokeWidth={2} name="Expenses" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Daily Profit Trend</h3>
                      <div className="flex items-center justify-center h-64 text-gray-500">
                        <p>No daily profit data available for the selected period</p>
                      </div>
                    </div>
                  )}

                  <div className="bg-white border border-gray-200 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Profit & Loss Summary</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-gray-700">Total Sales Revenue</span>
                        <span className="font-semibold text-gray-900">{formatCurrency(reportData.profitLoss.totalSales || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-gray-700">Less: Cost of Goods Sold (COGS)</span>
                        <span className="font-semibold text-red-600">-{formatCurrency(reportData.profitLoss.costOfGoodsSold || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b-2 border-gray-300">
                        <span className="font-semibold text-gray-900">Gross Profit</span>
                        <span className="font-bold text-green-600">{formatCurrency(reportData.profitLoss.grossProfit || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-gray-700">Less: Operating Expenses</span>
                        <span className="font-semibold text-red-600">-{formatCurrency(reportData.profitLoss.totalExpenses || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center py-3 border-t-2 border-gray-400 bg-gray-50 rounded px-3">
                        <span className="font-bold text-lg text-gray-900">Net Profit / Loss</span>
                        <span className={`font-bold text-2xl ${(reportData.profitLoss.netProfit || 0) >= 0 ? 'text-green-700' : 'text-red-700'
                          }`}>
                          {formatCurrency(reportData.profitLoss.netProfit || 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                  <TrendingUp className="h-12 w-12 mb-2 text-gray-400" />
                  <p>No profit & loss data available</p>
                  <p className="text-sm mt-1">Try selecting a different date range</p>
                </div>
              )}
            </div>
          )}

          {/* Branch Profit Tab (#57) */}
          {activeTab === 'branch-profit' && (
            <div className="space-y-6">
              <p className="text-sm text-gray-600">Profit by branch for the selected date range. Net = Sales − COGS − Expenses.</p>
              {reportData.branchProfit && reportData.branchProfit.length > 0 ? (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px] divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Branch</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Invoices</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Sales</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">COGS</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Gross Profit</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Expenses</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Net Profit</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Net Margin %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {reportData.branchProfit.map((row) => (
                          <tr key={row.branchId} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">{row.branchName}</td>
                            <td className="px-4 py-3 text-right text-gray-600">{row.invoiceCount ?? 0}</td>
                            <td className="px-4 py-3 text-right font-medium text-green-700">{formatCurrency(row.sales ?? 0)}</td>
                            <td className="px-4 py-3 text-right text-red-600">{formatCurrency(row.costOfGoodsSold ?? 0)}</td>
                            <td className="px-4 py-3 text-right font-medium text-blue-700">{formatCurrency(row.grossProfit ?? 0)}</td>
                            <td className="px-4 py-3 text-right text-red-600">{formatCurrency(row.expenses ?? 0)}</td>
                            <td className={`px-4 py-3 text-right font-bold ${(row.netProfit ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {formatCurrency(row.netProfit ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-600">
                              {(row.netProfitMarginPercent ?? 0).toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500 bg-white border border-gray-200 rounded-lg">
                  <Building2 className="h-12 w-12 mb-2 text-gray-400" />
                  <p>{loading ? 'Loading branch profit...' : (
                      <>
                        No data found for {dateRange.from} to {dateRange.to}
                        <br />
                        <span className="text-sm">Try expanding the date range or ensure branches have sales/expenses.</span>
                      </>
                    )}</p>
                    {!loading && (
                      <button onClick={() => fetchReportData(true)} className="mt-3 px-4 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700">
                        Retry
                      </button>
                    )}
                </div>
              )}
            </div>
          )}

          {/* Outstanding Bills Tab */}
          {activeTab === 'outstanding' && (
            <div className="space-y-6">
              {/* FIX: Add days overdue filter */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="text-sm font-medium text-gray-700">Filter by Days Overdue:</label>
                  <Select
                    options={[
                      { value: '', label: 'All Outstanding Bills' },
                      { value: '30', label: '30+ Days Overdue' },
                      { value: '60', label: '60+ Days Overdue' },
                      { value: '90', label: '90+ Days Overdue' }
                    ]}
                    value={outstandingDaysFilter}
                    onChange={(e) => {
                      setOutstandingDaysFilter(e.target.value)
                      tabDataCacheRef.current = {} // Clear cache to force reload
                    }}
                    className="max-w-xs"
                  />
                  <button
                    onClick={() => fetchReportData(true)}
                    className="px-3 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Apply Filter
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Filter bills by days overdue to prioritize collection calls
                </p>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gradient-to-r from-red-50 to-orange-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Pending Bills & Outstanding Invoices</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {outstandingDaysFilter
                        ? `Invoices with ${outstandingDaysFilter}+ days overdue`
                        : 'Invoices with unpaid or partially paid balances'}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        toast.loading('Generating PDF...')
                        const blob = await reportsAPI.exportPendingBillsPdf({
                          fromDate: dateRange.from,
                          toDate: dateRange.to
                        })

                        const url = window.URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `pending_bills_${dateRange.from}_${dateRange.to}.pdf`
                        document.body.appendChild(a)
                        a.click()
                        a.remove()
                        window.URL.revokeObjectURL(url)
                        toast.dismiss()
                        toast.success('PDF downloaded successfully!')
                      } catch (error) {
                        console.error('Failed to export PDF:', error)
                        toast.dismiss()
                        if (!error?._handledByInterceptor) toast.error(error.message || 'Failed to export PDF')
                      }
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 transition-colors"
                    disabled={!reportData.outstandingBills || reportData.outstandingBills.length === 0}
                  >
                    <Download className="h-4 w-4" />
                    <span>Export PDF</span>
                  </button>
                </div>

                {reportData.outstandingBills && reportData.outstandingBills.length > 0 ? (
                  // CRITICAL FIX: Ensure table doesn't overflow on mobile/tablet - add horizontal scroll wrapper
                  <div className="overflow-x-auto w-full">
                    <table className="min-w-[1000px] w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Invoice No</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Customer</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Date</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Total</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Paid</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Balance</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Status</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Days Overdue</th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {reportData.outstandingBills.map((bill) => (
                          <tr key={bill.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {bill.invoiceNo}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {bill.customerName || 'Cash Customer'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {new Date(bill.invoiceDate).toLocaleDateString('en-GB')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                              {formatCurrency(bill.grandTotal)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600">
                              {formatCurrency(bill.paidAmount)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-red-600">
                              {formatCurrency(bill.balanceAmount)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bill.paymentStatus === 'Paid' ? 'bg-green-100 text-green-800' :
                                bill.paymentStatus === 'Partial' ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-red-100 text-red-800'
                                }`}>
                                {bill.paymentStatus}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {(() => {
                                const dueDate = bill.dueDate ? new Date(bill.dueDate) : (bill.planDate ? new Date(bill.planDate) : null)
                                const daysOverdue = bill.daysOverdue ?? (dueDate
                                  ? Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86400000))
                                  : 0)
                                return daysOverdue > 0 ? (
                                  <span className={`font-medium ${daysOverdue > 90 ? 'text-red-600' :
                                    daysOverdue > 60 ? 'text-orange-600' :
                                      'text-yellow-600'
                                    }`}>
                                    {daysOverdue} days
                                  </span>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )
                              })()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                              <button
                                onClick={() => {
                                  if (bill.customerId) {
                                    navigate(`/ledger?customerId=${bill.customerId}`)
                                  } else {
                                    toast.error('Customer ID not available for this bill')
                                  }
                                }}
                                className="text-blue-600 hover:text-blue-800 font-medium hover:underline transition"
                                title={bill.customerName || 'View customer ledger'}
                              >
                                {bill.customerName ? bill.customerName : 'View Ledger'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td colSpan="4" className="px-6 py-4 text-right text-sm font-semibold text-gray-900">
                            Total Outstanding:
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-semibold text-green-600">
                            {formatCurrency(reportData.outstandingBills.reduce((sum, b) => sum + b.paidAmount, 0))}
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-bold text-red-600">
                            {formatCurrency(reportData.outstandingBills.reduce((sum, b) => sum + b.balanceAmount, 0))}
                          </td>
                          <td colSpan="3"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <DollarSign className="h-12 w-12 mb-2 text-gray-400" />
                    <p>No outstanding bills found</p>
                    <p className="text-sm mt-1">All invoices are fully paid</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sales Returns Tab */}
          {activeTab === 'returns' && (
            <div className="space-y-6">
              {!returnsFeatureFlags.returnsEnabled ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800">
                  <p className="font-medium">Sales returns are disabled</p>
                  <p className="text-sm mt-1">Contact your administrator to enable returns.</p>
                </div>
              ) : (
                <>
              <p className="text-sm text-gray-600">Sales returns for the selected date range. Use filters to narrow by branch, route, damage category, or staff.</p>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Sales Returns</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Total: {reportData.returnsReport?.totalCount ?? 0} return(s) · Total value: {formatCurrency((reportData.returnsReport?.items || []).reduce((s, r) => s + (parseFloat(r.grandTotal) || 0), 0))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const items = reportData.returnsReport?.items || []
                        if (items.length === 0) {
                          toast.error('No data to export')
                          return
                        }
                        const headers = ['Date', 'Return No', 'Invoice No', 'Customer', 'Product', 'Qty Returned', 'Reason/Damage', 'Amount', 'Staff', 'Branch', 'Route']
                        const rows = items.flatMap(ret => {
                          const lines = ret.items || ret.Items || []
                          if (lines.length === 0) {
                            return [[
                              ret.returnDate ? new Date(ret.returnDate).toLocaleDateString() : '—',
                              ret.returnNo ?? '—',
                              ret.saleInvoiceNo ?? '—',
                              (ret.customerName ?? '').replace(/"/g, '""'),
                              '—', '—', '—',
                              String(Number(ret.grandTotal ?? 0).toFixed(2)),
                              (ret.createdByName ?? '').replace(/"/g, '""'),
                              (ret.branchName ?? '').replace(/"/g, '""'),
                              (ret.routeName ?? '').replace(/"/g, '""')
                            ]]
                          }
                          return lines.map(line => [
                            ret.returnDate ? new Date(ret.returnDate).toLocaleDateString() : '—',
                            ret.returnNo ?? '—',
                            ret.saleInvoiceNo ?? '—',
                            (ret.customerName ?? '').replace(/"/g, '""'),
                            ((line.productName ?? line.ProductName) ?? '').replace(/"/g, '""'),
                            String(Number(line.qtyReturned ?? line.QtyReturned ?? 0)),
                            ((line.damageCategoryName ?? line.DamageCategoryName ?? line.reason ?? line.Reason) ?? '').replace(/"/g, '""'),
                            String(Number(line.amount ?? line.Amount ?? 0).toFixed(2)),
                            (ret.createdByName ?? '').replace(/"/g, '""'),
                            (ret.branchName ?? '').replace(/"/g, '""'),
                            (ret.routeName ?? '').replace(/"/g, '""')
                          ])
                        })
                        const csv = [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\r\n')
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `returns_report_${dateRange.from}_to_${dateRange.to}.csv`
                        a.click()
                        URL.revokeObjectURL(url)
                        toast.success('Returns report exported to CSV')
                      }}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2 text-sm"
                      disabled={!reportData.returnsReport?.items?.length}
                    >
                      <Download className="h-4 w-4" />
                      Export Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2 text-sm"
                    >
                      <FileText className="h-4 w-4" />
                      Print
                    </button>
                  </div>
                </div>
                {loading ? (
                  <LoadingCard />
                ) : reportData.returnsReport?.items?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Invoice No</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Customer</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Product</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Qty Returned</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Reason / Damage</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Amount</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Staff</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Branch</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Route</th>
                          {returnsFeatureFlags.returnsRequireApproval && isAdminOrOwner(user) && (
                            <th className="px-4 py-3 text-left font-semibold text-gray-700">Actions</th>
                          )}
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">PDF</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {reportData.returnsReport.items.flatMap((ret) => {
                          const items = ret.items || ret.Items || []
                          const status = (ret.status || ret.Status || '').toLowerCase()
                          const isPending = status === 'pending'
                          const showActions = returnsFeatureFlags.returnsRequireApproval && isAdminOrOwner(user) && isPending
                          const actionCell = showActions ? (
                            <td className="px-4 py-3" rowSpan={items.length || 1}>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await returnsAPI.approveSaleReturn(ret.id)
                                      toast.success('Return approved')
                                      fetchReportData(true)
                                    } catch (e) {
                                      toast.error(e?.response?.data?.message || 'Failed to approve')
                                    }
                                  }}
                                  className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await returnsAPI.rejectSaleReturn(ret.id)
                                      toast.success('Return rejected')
                                      fetchReportData(true)
                                    } catch (e) {
                                      toast.error(e?.response?.data?.message || 'Failed to reject')
                                    }
                                  }}
                                  className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                >
                                  Reject
                                </button>
                              </div>
                            </td>
                          ) : returnsFeatureFlags.returnsRequireApproval && isAdminOrOwner(user) ? <td className="px-4 py-3" rowSpan={items.length || 1}>—</td> : null
                          const pdfCell = (
                            <td className="px-4 py-3" rowSpan={items.length || 1}>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const blob = await returnsAPI.getReturnBillPdf(ret.id)
                                    const url = window.URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = url
                                    a.download = `Return_${ret.returnNo || ret.id}_${new Date().toISOString().split('T')[0]}.pdf`
                                    document.body.appendChild(a)
                                    a.click()
                                    window.URL.revokeObjectURL(url)
                                    document.body.removeChild(a)
                                    toast.success('Return bill PDF downloaded')
                                  } catch (e) {
                                    if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to generate PDF')
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                title="Download return bill PDF"
                              >
                                <FileText className="h-3 w-3" />
                                PDF
                              </button>
                            </td>
                          )
                          if (items.length === 0) {
                            return [(
                              <tr key={ret.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 whitespace-nowrap text-gray-600">{ret.returnDate ? new Date(ret.returnDate).toLocaleDateString() : '—'}</td>
                                <td className="px-4 py-3 whitespace-nowrap font-medium">{ret.saleInvoiceNo ?? '—'}</td>
                                <td className="px-4 py-3 whitespace-nowrap">{ret.customerName ?? '—'}</td>
                                <td className="px-4 py-3">—</td>
                                <td className="px-4 py-3 text-right">—</td>
                                <td className="px-4 py-3">—</td>
                                <td className="px-4 py-3 text-right font-medium">{formatCurrency(ret.grandTotal ?? 0)}</td>
                                <td className="px-4 py-3">{ret.createdByName ?? '—'}</td>
                                <td className="px-4 py-3">{ret.branchName ?? '—'}</td>
                                <td className="px-4 py-3">{ret.routeName ?? '—'}</td>
                                {actionCell}
                                {pdfCell}
                              </tr>
                            )]
                          }
                          return items.map((line, idx) => (
                            <tr key={`${ret.id}-${line.id || idx}`} className="hover:bg-gray-50">
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{ret.returnDate ? new Date(ret.returnDate).toLocaleDateString() : '—'}</td>
                              <td className="px-4 py-3 whitespace-nowrap font-medium">{ret.saleInvoiceNo ?? '—'}</td>
                              <td className="px-4 py-3 whitespace-nowrap">{ret.customerName ?? '—'}</td>
                              <td className="px-4 py-3">{line.productName ?? line.ProductName ?? '—'}</td>
                              <td className="px-4 py-3 text-right">{Number(line.qtyReturned ?? line.QtyReturned ?? 0)}</td>
                              <td className="px-4 py-3">{line.damageCategoryName ?? line.DamageCategoryName ?? line.reason ?? line.Reason ?? '—'}</td>
                              <td className="px-4 py-3 text-right font-medium">{formatCurrency(line.amount ?? line.Amount ?? 0)}</td>
                              <td className="px-4 py-3">{ret.createdByName ?? '—'}</td>
                              <td className="px-4 py-3">{ret.branchName ?? '—'}</td>
                              <td className="px-4 py-3">{ret.routeName ?? '—'}</td>
                              {idx === 0 ? actionCell : null}
                              {idx === 0 ? pdfCell : null}
                            </tr>
                          ))
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <RotateCcw className="h-12 w-12 mb-2 text-gray-400" />
                    <p>{loading ? 'Loading returns...' : 'No returns in this period. Adjust the date range or filters.'}</p>
                  </div>
                )}
              </div>
                </>
              )}
            </div>
          )}

          {/* Damage Report – return lines where condition = damaged or write-off */}
          {activeTab === 'damage' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Damage Report</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Return lines with condition Damaged or Write-off. Product, qty, amount, branch, route.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const list = reportData.damageReport || []
                        if (list.length === 0) {
                          toast.error('No data to export')
                          return
                        }
                        const headers = ['Return No', 'Date', 'Invoice No', 'Customer', 'Product', 'Qty', 'Condition', 'Amount', 'Branch', 'Route']
                        const rows = list.map(r => [
                          (r.returnNo ?? '').replace(/"/g, '""'),
                          r.returnDate ? new Date(r.returnDate).toLocaleDateString() : '—',
                          (r.invoiceNo ?? '—').replace(/"/g, '""'),
                          (r.customerName ?? '').replace(/"/g, '""'),
                          (r.productName ?? '').replace(/"/g, '""'),
                          String(Number(r.qty ?? 0)),
                          (r.condition ?? '').replace(/"/g, '""'),
                          String(Number(r.lineTotal ?? 0).toFixed(2)),
                          (r.branchName ?? '').replace(/"/g, '""'),
                          (r.routeName ?? '').replace(/"/g, '""')
                        ])
                        const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\r\n')
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `damage_report_${dateRange.from}_to_${dateRange.to}.csv`
                        a.click()
                        URL.revokeObjectURL(url)
                        toast.success('Damage report exported to CSV')
                      }}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-2"
                      disabled={!reportData.damageReport?.length}
                    >
                      <Download className="h-4 w-4" />
                      Export CSV
                    </button>
                    <button type="button" onClick={() => window.print()} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Print
                    </button>
                  </div>
                </div>
                {loading ? (
                  <LoadingCard />
                ) : (reportData.damageReport?.length ?? 0) > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Return No</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Invoice No</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Customer</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Product</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Qty</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Condition</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Amount</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Branch</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Route</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {(reportData.damageReport || []).map((r, idx) => (
                          <tr key={`${r.returnId}-${idx}`} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap font-medium">{r.returnNo ?? '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.returnDate ? new Date(r.returnDate).toLocaleDateString() : '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap">{r.invoiceNo ?? '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap">{r.customerName ?? '—'}</td>
                            <td className="px-4 py-3">{r.productName ?? '—'}</td>
                            <td className="px-4 py-3 text-right">{Number(r.qty ?? 0)}</td>
                            <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${(r.condition || '').toLowerCase() === 'writeoff' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{r.condition ?? '—'}</span></td>
                            <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.lineTotal ?? 0)}</td>
                            <td className="px-4 py-3">{r.branchName ?? '—'}</td>
                            <td className="px-4 py-3">{r.routeName ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <AlertTriangle className="h-12 w-12 mb-2 text-gray-400" />
                    <p>{loading ? 'Loading...' : 'No damage or write-off return lines in this period.'}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Credit Note Report */}
          {activeTab === 'credit-notes' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-50 to-blue-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Credit Note Report</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Credit notes linked to returns (cash/paid invoice flow). Status: unused / used / cancelled.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const list = reportData.creditNotesReport || []
                        if (list.length === 0) {
                          toast.error('No data to export')
                          return
                        }
                        const headers = ['Date', 'Customer', 'Linked Return No', 'Amount', 'Currency', 'Status', 'Created By']
                        const rows = list.map(c => [
                          c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—',
                          (c.customerName ?? '').replace(/"/g, '""'),
                          (c.linkedReturnNo ?? '').replace(/"/g, '""'),
                          String(Number(c.amount ?? 0).toFixed(2)),
                          (c.currency ?? 'AED').replace(/"/g, '""'),
                          (c.status ?? '').replace(/"/g, '""'),
                          (c.createdByName ?? '').replace(/"/g, '""')
                        ])
                        const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\r\n')
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `credit_notes_${dateRange.from}_to_${dateRange.to}.csv`
                        a.click()
                        URL.revokeObjectURL(url)
                        toast.success('Credit notes exported to CSV')
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2"
                      disabled={!reportData.creditNotesReport?.length}
                    >
                      <Download className="h-4 w-4" />
                      Export CSV
                    </button>
                    <button type="button" onClick={() => window.print()} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Print
                    </button>
                  </div>
                </div>
                {loading ? (
                  <LoadingCard />
                ) : (reportData.creditNotesReport?.length ?? 0) > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Customer</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Linked Return No</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700">Amount</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Currency</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Created By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {(reportData.creditNotesReport || []).map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap text-gray-600">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap font-medium">{c.customerName ?? '—'}</td>
                            <td className="px-4 py-3 whitespace-nowrap">{c.linkedReturnNo ?? '—'}</td>
                            <td className="px-4 py-3 text-right font-medium">{formatCurrency(c.amount ?? 0)}</td>
                            <td className="px-4 py-3">{c.currency ?? 'AED'}</td>
                            <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${(c.status || '').toLowerCase() === 'used' ? 'bg-green-100 text-green-800' : (c.status || '').toLowerCase() === 'cancelled' ? 'bg-gray-100 text-gray-800' : 'bg-indigo-100 text-indigo-800'}`}>{c.status ?? 'unused'}</span></td>
                            <td className="px-4 py-3">{c.createdByName ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <FileText className="h-12 w-12 mb-2 text-gray-400" />
                    <p>{loading ? 'Loading...' : 'No credit notes in this period.'}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Net Sales Report – Total Sales − Returns by period */}
          {activeTab === 'net-sales' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Net Sales & Refunds Report</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Net Sales = Total Sales − Returns. Refunds Paid shows cash refunded to customers for the selected period and filters.
                  </p>
                </div>
                {loading ? (
                  <LoadingCard />
                ) : reportData.netSalesReport ? (
                  <div className="p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                        <p className="text-sm font-medium text-green-700">Total Sales</p>
                        <p className="text-2xl font-bold text-green-900 mt-1">{formatCurrency(reportData.netSalesReport.totalSales ?? 0)}</p>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
                        <p className="text-sm font-medium text-amber-700">Total Returns</p>
                        <p className="text-2xl font-bold text-amber-900 mt-1">{formatCurrency(reportData.netSalesReport.totalReturns ?? 0)}</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                        <p className="text-sm font-medium text-blue-700">Net Sales</p>
                        <p className="text-2xl font-bold text-blue-900 mt-1">{formatCurrency(reportData.netSalesReport.netSales ?? 0)}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-4 border border-red-100">
                        <p className="text-sm font-medium text-red-700">Refunds Paid</p>
                        <p className="text-2xl font-bold text-red-900 mt-1">{formatCurrency(reportData.netSalesReport.refundsPaid ?? 0)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <TrendingUp className="h-12 w-12 mb-2 text-gray-400" />
                    <p>{loading ? 'Loading...' : 'No data for the selected period.'}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Collections list (customers with balance > 0 and phone) – #53 */}
          {activeTab === 'collections' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Outstanding Collections</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Customers with balance &gt; 0 — use for collection calls. Export or print to take on the go.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const list = reportData.collectionsList || []
                        if (list.length === 0) {
                          toast.error('No data to export')
                          return
                        }
                        const headers = ['Name', 'Phone', 'Balance', 'Address']
                        const rows = list.map(c => [
                          (c.name || '').replace(/"/g, '""'),
                          (c.phone || '').replace(/"/g, '""'),
                          String(Number(c.pendingBalance ?? c.balance ?? 0).toFixed(2)),
                          (c.address || '').replace(/"/g, '""')
                        ])
                        const csv = [headers.join(','), ...rows.map(r => r.map(cell => `"${cell}"`).join(','))].join('\r\n')
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `collections_${new Date().toISOString().slice(0, 10)}.csv`
                        a.click()
                        URL.revokeObjectURL(url)
                        toast.success('CSV downloaded')
                      }}
                      className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-2"
                      disabled={!reportData.collectionsList?.length}
                    >
                      <Download className="h-4 w-4" />
                      Export CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
                    >
                      <FileText className="h-4 w-4" />
                      Print
                    </button>
                  </div>
                </div>
                {loading ? (
                  <LoadingCard />
                ) : reportData.collectionsList && reportData.collectionsList.length > 0 ? (
                  <div className="overflow-x-auto" id="collections-print">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Customer</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Phone</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Balance</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase hidden sm:table-cell">Address</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {reportData.collectionsList.map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{c.name || '—'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-gray-700">{c.phone || '—'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-right font-semibold text-red-700">
                              {formatCurrency(c.pendingBalance ?? c.balance ?? 0)}
                            </td>
                            <td className="px-6 py-4 text-gray-600 hidden sm:table-cell max-w-xs truncate">{c.address || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50">
                        <tr>
                          <td className="px-6 py-4 font-semibold text-gray-900">Total</td>
                          <td></td>
                          <td className="px-6 py-4 text-right font-bold text-red-700">
                            {formatCurrency((reportData.collectionsList || []).reduce((s, c) => s + (Number(c.pendingBalance ?? c.balance) || 0), 0))}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <Phone className="h-12 w-12 mb-2 text-gray-400" />
                    <p>No customers with outstanding balance</p>
                    <p className="text-sm mt-1">All customer balances are settled</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Staff Performance Tab */}
          {/* Cheque Report Tab */}
          {activeTab === 'cheque' && (
            <div className="space-y-6">
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Cheque Report</h3>
                    <p className="text-sm text-gray-600 mt-1">All cheque payments and their status</p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        toast.loading('Exporting cheque report...')
                        // TODO: Add export endpoint for cheque report
                        toast.dismiss()
                        showToast.info('Cheque report export coming soon')
                      } catch (error) {
                        console.error('Failed to export:', error)
                        toast.dismiss()
                        if (!error?._handledByInterceptor) toast.error('Failed to export cheque report')
                      }
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 transition-colors"
                    disabled={!reportData.chequeReport || reportData.chequeReport.length === 0}
                  >
                    <Download className="h-4 w-4" />
                    <span>Export Excel</span>
                  </button>
                </div>
                {reportData.chequeReport && reportData.chequeReport.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Cheque No</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Customer</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Invoice</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Amount</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Cheque Date</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {reportData.chequeReport.map((cheque) => (
                          <tr key={cheque.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {cheque.chequeNumber || cheque.referenceNumber || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {cheque.customerName || 'Cash Customer'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {cheque.invoiceNo || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                              {formatCurrency(cheque.amount || 0)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {cheque.chequeDate ? new Date(cheque.chequeDate).toLocaleDateString('en-GB') : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                cheque.status === 'CLEARED' ? 'bg-green-100 text-green-800' :
                                cheque.status === 'BOUNCED' ? 'bg-red-100 text-red-800' :
                                'bg-yellow-100 text-yellow-800'
                              }`}>
                                {cheque.status || 'PENDING'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {cheque.status === 'PENDING' && isAdminOrOwner(user) && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={async () => {
                                      try {
                                        const response = await paymentsAPI.updatePaymentStatus(cheque.id, 'CLEARED')
                                        if (response?.success) {
                                          toast.success('Cheque marked as cleared')
                                          fetchReportData(true)
                                        } else {
                                          toast.error(response?.message || 'Failed to update cheque status')
                                        }
                                      } catch (error) {
                                        console.error('Failed to clear cheque:', error)
                                        toast.error(error?.response?.data?.message || 'Failed to clear cheque')
                                      }
                                    }}
                                    className="text-green-600 hover:text-green-800 font-medium"
                                  >
                                    Clear
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const response = await paymentsAPI.updatePaymentStatus(cheque.id, 'BOUNCED')
                                        if (response?.success) {
                                          toast.success('Cheque marked as bounced')
                                          fetchReportData(true)
                                        } else {
                                          toast.error(response?.message || 'Failed to update cheque status')
                                        }
                                      } catch (error) {
                                        console.error('Failed to bounce cheque:', error)
                                        toast.error(error?.response?.data?.message || 'Failed to bounce cheque')
                                      }
                                    }}
                                    className="text-red-600 hover:text-red-800 font-medium"
                                  >
                                    Bounce
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                    <ShieldCheck className="h-12 w-12 mb-2 text-gray-400" />
                    <p>No cheque payments found</p>
                    <p className="text-sm mt-1">No cheques recorded for the selected period</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'staff' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900">Staff Performance Report</h3>
              <p className="text-sm text-gray-600">
                Per-staff sales and collection metrics (Owner view). Uses the shared date range above; filter by route to see performance for a single route.
              </p>
              {reportData.staffReport && reportData.staffReport.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Staff Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Assigned Routes</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Invoices</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Total Billed</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Collected</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Collection Rate</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Avg Days to Pay</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {reportData.staffReport.map((staff, idx) => (
                        <tr key={staff.userId} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {staff.userName}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={staff.assignedRoutes}>
                            {staff.assignedRoutes}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                            {staff.invoicesCreated}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                            {formatCurrency(staff.totalBilled)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-green-600">
                            {formatCurrency(staff.cashCollected)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                            <span className={staff.collectionRatePercent >= 80 ? 'text-green-600 font-medium' : staff.collectionRatePercent >= 50 ? 'text-yellow-600' : 'text-red-600'}>
                              {staff.collectionRatePercent}%
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">
                            {staff.avgDaysToPay > 0 ? `${staff.avgDaysToPay} days` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reportData.staffReport.length > 0 && (
                    <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
                      <span>Best Collector: {reportData.staffReport.reduce((best, s) =>
                        (s.totalBilled > 0 && (s.collectionRatePercent > (best?.collectionRatePercent ?? -1))) ? s : best
                      , reportData.staffReport[0] || null)?.userName ?? '-'}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                  <Users className="h-12 w-12 mb-2 text-gray-400" />
                  <p>No staff performance data for this period</p>
                  <p className="text-sm mt-1">Add Staff users and assign them to routes to see metrics</p>
                </div>
              )}
            </div>
          )}

          {/* AI Insights Tab */}
          {activeTab === 'ai' && (
            <div className="space-y-6">
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6">
                <div className="flex items-center mb-4">
                  <Eye className="h-6 w-6 text-blue-600 mr-2" />
                  <h3 className="text-lg font-semibold text-gray-900">AI Business Insights</h3>
                </div>
                <p className="text-gray-600 mb-6">
                  AI-powered recommendations to optimize your business performance
                </p>

                {reportData.aiSuggestions && reportData.aiSuggestions.length > 0 ? (
                  <div className="space-y-4">
                    {reportData.aiSuggestions.map((suggestion, index) => (
                      <div key={index} className={`p-4 rounded-lg border-l-4 ${suggestion.priority === 'high' ? 'bg-red-50 border-red-400' :
                        suggestion.priority === 'medium' ? 'bg-yellow-50 border-yellow-400' :
                          'bg-green-50 border-green-400'
                        }`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900">{suggestion.title}</h4>
                            <p className="text-sm text-gray-600 mt-1">{suggestion.description}</p>
                          </div>
                          <button className="ml-4 px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700">
                            {suggestion.action}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-12 text-gray-500">
                    No AI suggestions available at this time
                  </div>
                )}
              </div>
            </div>
          )}

          </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ReportsPage
