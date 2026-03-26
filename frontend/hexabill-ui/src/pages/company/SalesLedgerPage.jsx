import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import {
  Download,
  Filter,
  FileText,
  MessageCircle,
  Pencil,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { formatCurrency, formatBalance } from '../../utils/currency'
import toast from 'react-hot-toast'
import { LoadingCard } from '../../components/Loading'
import { Input, Select } from '../../components/Form'
import { reportsAPI, adminAPI, salesAPI, customersAPI } from '../../services'
import { getWhatsAppShareUrl } from '../../utils/whatsapp'
import { getApiBaseUrl } from '../../services/apiConfig'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'

const SHOW_FILTERS_KEY = 'hexabill_sales_ledger_show_filters'
const SHOW_KPI_KEY = 'hexabill_sales_ledger_show_kpi'
const SORT_ORDER_KEY = 'hexabill_sales_ledger_sort_order'

/** Canonical row type for filter/sort (API may send Type/type or different casing). */
function normalizeLedgerRowType(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'sale') return 'Sale'
  if (s === 'payment') return 'Payment'
  if (s === 'return') return 'Return'
  return ''
}

/** Payment rows share saleId with the invoice; keys must be unique per row (React reconciliation). */
function ledgerRowKey(entry, idx) {
  const t = normalizeLedgerRowType(entry.type)
  if (t === 'Payment' && entry.paymentId) return `pay-${entry.paymentId}`
  if (t === 'Sale' && entry.saleId) return `sale-${entry.saleId}`
  if (t === 'Return' && entry.returnId != null) return `ret-${entry.returnId}`
  if (entry.paymentId) return `pay-${entry.paymentId}`
  if (entry.saleId) return `sale-${entry.saleId}`
  if (entry.returnId != null) return `ret-${entry.returnId}`
  return `row-${idx}`
}

function timeMs(d) {
  const n = new Date(d).getTime()
  return Number.isFinite(n) ? n : 0
}

/** Prefer the id that matches row type so Payment rows sort by payment id, not related sale id. */
function primarySortId(e) {
  const t = normalizeLedgerRowType(e.type)
  if (t === 'Sale') return Number(e.saleId) || 0
  if (t === 'Payment') return Number(e.paymentId) || 0
  if (t === 'Return') return Number(e.returnId) || 0
  return Math.max(
    Number(e.saleId) || 0,
    Number(e.paymentId) || 0,
    Number(e.returnId) || 0
  )
}

/** Max sale/payment/return id on a row (one type is usually set per row). */
function rowActivityId(e) {
  return Math.max(
    Number(e.saleId) || 0,
    Number(e.paymentId) || 0,
    Number(e.returnId) || 0
  )
}

function maxActivityIdInGroup(rows) {
  return rows.reduce((m, e) => Math.max(m, primarySortId(e)), 0)
}

function minActivityIdInGroup(rows) {
  const ids = rows.map(primarySortId).filter((id) => id > 0)
  return ids.length ? Math.min(...ids) : 0
}

/** Group by customer; order blocks by latest/earliest activity; sort lines within block. Keeps subtotal rows valid. */
function sortLedgerForDisplay(entries, order) {
  if (!entries || entries.length === 0) return []
  const byCustomer = new Map()
  for (const e of entries) {
    const name = e.customerName || 'Cash Customer'
    if (!byCustomer.has(name)) byCustomer.set(name, [])
    byCustomer.get(name).push(e)
  }

  const typeRank = (t) => {
    const n = normalizeLedgerRowType(t)
    if (n === 'Sale') return 0
    if (n === 'Return') return 1
    return 2
  }

  const compareLines = (a, b, mult) => {
    const da = timeMs(a.date)
    const db = timeMs(b.date)
    if (da !== db) return mult * (da - db)
    const ta = typeRank(a.type)
    const tb = typeRank(b.type)
    if (ta !== tb) return mult * (ta - tb)
    const c = String(a.invoiceNo || '').localeCompare(String(b.invoiceNo || ''), undefined, { numeric: true })
    if (c !== 0) return mult * c
    const ida = primarySortId(a)
    const idb = primarySortId(b)
    return mult * (ida - idb)
  }

  const mult = order === 'newest' ? -1 : 1
  for (const arr of byCustomer.values()) {
    arr.sort((a, b) => compareLines(a, b, mult))
  }

  const customerNames = [...byCustomer.keys()]
  customerNames.sort((a, b) => {
    const rowsA = byCustomer.get(a)
    const rowsB = byCustomer.get(b)
    const datesA = rowsA.map(e => timeMs(e.date)).filter((t) => t > 0)
    const datesB = rowsB.map(e => timeMs(e.date)).filter((t) => t > 0)
    const maxA = datesA.length ? Math.max(...datesA) : 0
    const maxB = datesB.length ? Math.max(...datesB) : 0
    const minA = datesA.length ? Math.min(...datesA) : 0
    const minB = datesB.length ? Math.min(...datesB) : 0
    if (order === 'newest') {
      if (maxB !== maxA) return maxB - maxA
      const idA = maxActivityIdInGroup(rowsA)
      const idB = maxActivityIdInGroup(rowsB)
      if (idB !== idA) return idB - idA
      return a.localeCompare(b)
    }
    if (minA !== minB) return minA - minB
    const minIdA = minActivityIdInGroup(rowsA)
    const minIdB = minActivityIdInGroup(rowsB)
    if (minIdA !== minIdB) return minIdA - minIdB
    return a.localeCompare(b)
  })

  const flat = []
  for (const name of customerNames) {
    flat.push(...byCustomer.get(name))
  }
  return flat
}

/** Global invoice order when Type = Sale only: one timeline for all customers (newest at top). */
function sortFlatSalesLedger(entries, order) {
  if (!entries || entries.length === 0) return []
  const copy = [...entries]
  const mult = order === 'newest' ? -1 : 1
  copy.sort((a, b) => {
    const da = timeMs(a.date)
    const db = timeMs(b.date)
    if (da !== db) return mult * (da - db)
    const ida = Number(a.saleId) || 0
    const idb = Number(b.saleId) || 0
    if (ida !== idb) return mult * (ida - idb)
    const inv = String(a.invoiceNo || '').localeCompare(String(b.invoiceNo || ''), undefined, { numeric: true })
    if (inv !== 0) return mult * inv
    return mult * String(a.customerName || '').localeCompare(String(b.customerName || ''))
  })
  return copy
}

const SalesLedgerPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { branches, routes } = useBranchesRoutes()
  const [loading, setLoading] = useState(true)
  const getDefaultDateRange = () => {
    const today = new Date()
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    return {
      from: firstDayOfMonth.toISOString().split('T')[0],
      to: today.toISOString().split('T')[0]
    }
  }
  const [dateRange, setDateRange] = useState(() => {
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')
    if (fromParam && toParam) return { from: fromParam, to: toParam }
    return getDefaultDateRange()
  })
  const [filters, setFilters] = useState({
    date: '',
    name: '',
    type: '',
    status: '',
    invoiceNo: '',
    branchId: '',
    routeId: '',
    staffId: '',
    realPendingMin: '',
    realPendingMax: '',
    realGotPaymentMin: '',
    realGotPaymentMax: ''
  })
  const [reportData, setReportData] = useState({
    salesLedger: [],
    salesLedgerSummary: null
  })
  const [routesForBranch, setRoutesForBranch] = useState([]) // Routes for selected branch (filtered from context)
  const [staffUsers, setStaffUsers] = useState([])
  const [showFilters, setShowFilters] = useState(() => {
    try {
      const v = localStorage.getItem(SHOW_FILTERS_KEY)
      return v === null ? false : v === 'true'
    } catch { return false }
  })
  const [showKpiStrip, setShowKpiStrip] = useState(() => {
    try {
      const v = localStorage.getItem(SHOW_KPI_KEY)
      return v === null ? true : v === 'true'
    } catch { return true }
  })
  const [sortOrder, setSortOrder] = useState(() => {
    try {
      const v = localStorage.getItem(SORT_ORDER_KEY)
      if (v === 'oldest' || v === 'newest') return v
      return 'newest'
    } catch { return 'newest' }
  })
  const [sharingSaleId, setSharingSaleId] = useState(null)
  const fetchSalesLedgerRef = useRef(null)

  // Sync dateRange to URL so filters survive navigation and browser back
  useEffect(() => {
    const params = new URLSearchParams()
    if (dateRange.from) params.set('from', dateRange.from)
    if (dateRange.to) params.set('to', dateRange.to)
    setSearchParams(params, { replace: true })
  }, [dateRange.from, dateRange.to])

  // Load staff users only (branches/routes from shared context)
  useEffect(() => {
    const load = async () => {
      try {
        if (isAdminOrOwner(user)) {
          const uRes = await adminAPI.getUsers().catch(() => ({ success: false }))
          if (uRes?.success && uRes?.data) {
            const items = Array.isArray(uRes.data) ? uRes.data : (uRes.data?.items || [])
            setStaffUsers(items.filter(u => (u.role || '').toLowerCase() === 'staff'))
          }
        } else if (user) {
          setStaffUsers([user])
        }
        // Auto-select first branch for staff when branches load (ensures data fetches, fixes "not updating" for staff)
        if (user && !isAdminOrOwner(user) && branches?.length > 0 && !filters.branchId) {
          const firstBranch = branches[0]
          const branchRoutes = (routes || []).filter(r => r.branchId === firstBranch.id)
          setFilters(prev => ({
            ...prev,
            branchId: String(firstBranch.id),
            routeId: branchRoutes.length > 0 ? String(branchRoutes[0].id) : prev.routeId,
            staffId: String(user.id)
          }))
        }
      } catch (_) { /* ignore */ }
    }
    load()
  }, [user, branches, routes, filters.branchId])

  // Filter routes by selected branch (branches/routes from context)
  useEffect(() => {
    if (!filters.branchId) {
      setRoutesForBranch(routes || [])
      return
    }
    const branchId = parseInt(filters.branchId, 10)
    setRoutesForBranch((routes || []).filter(r => r.branchId === branchId))
  }, [filters.branchId, routes])

  const fetchSalesLedger = async () => {
    setLoading(true)
    try {
      const params = {
        fromDate: dateRange.from,
        toDate: dateRange.to
      }
      if (filters.branchId) params.branchId = parseInt(filters.branchId, 10)
      if (filters.routeId) params.routeId = parseInt(filters.routeId, 10)
      if (filters.staffId) params.staffId = parseInt(filters.staffId, 10)
      if (filters.type) params.entryType = filters.type
      const ledgerResponse = await reportsAPI.getComprehensiveSalesLedger(params)

      if (ledgerResponse?.success && ledgerResponse?.data) {
        const entries = ledgerResponse.data.entries || []
        const summary = ledgerResponse.data.summary || {}

        const ledgerWithBalance = entries.map(entry => ({
          date: new Date(entry.date),
          type: normalizeLedgerRowType(entry.type ?? entry.Type),
          invoiceNo: entry.invoiceNo || '-',
          customerId: entry.customerId,
          customerName: entry.customerName || 'Cash Customer',
          paymentMode: entry.paymentMode || '-',
          // CRITICAL: Handle both camelCase and PascalCase from backend
          grandTotal: Number(entry.grandTotal || entry.GrandTotal || 0), // Full invoice amount
          paidAmount: Number(entry.paidAmount || entry.PaidAmount || 0), // Amount paid for invoice
          realPending: Number(entry.realPending || entry.RealPending || 0),
          realGotPayment: Number(entry.realGotPayment || entry.RealGotPayment || 0), // For sales: shows paidAmount, for payments: shows payment amount
          status: entry.status || 'Unpaid',
          customerBalance: Number(entry.customerBalance || entry.CustomerBalance || 0),
          planDate: entry.planDate ? new Date(entry.planDate) : null,
          saleId: entry.saleId || entry.SaleId,
          paymentId: entry.paymentId || entry.PaymentId,
          returnId: entry.returnId ?? entry.ReturnId,
          vatTotal: Number(entry.vatTotal ?? entry.VatTotal ?? 0),
          subtotal: Number(entry.subtotal ?? entry.Subtotal ?? 0)
        }))

        setReportData({
          salesLedger: ledgerWithBalance,
          salesLedgerSummary: summary
        })
      } else {
        setReportData({ salesLedger: [], salesLedgerSummary: null })
      }
    } catch (error) {
      console.error('Error loading sales ledger:', error)
      const msg = error?.response?.data?.message || error?.message || 'Failed to load sales ledger'
      if (!error?._handledByInterceptor) toast.error(msg)
      setReportData({ salesLedger: [], salesLedgerSummary: null })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSalesLedgerRef.current = fetchSalesLedger
  })

  // Refresh data when date range or server-side filters change (entryType = Type filter)
  useEffect(() => {
    fetchSalesLedger()
  }, [dateRange, filters.branchId, filters.routeId, filters.staffId, filters.type])
  
  // Client-side filters (date, name, type, status, invoiceNo) are applied in getFilteredLedger()
  // These don't require API refresh, but we should ensure filteredLedger updates when filters change

  useEffect(() => {
    const handleDataUpdate = () => fetchSalesLedgerRef.current?.()
    window.addEventListener('dataUpdated', handleDataUpdate)
    return () => window.removeEventListener('dataUpdated', handleDataUpdate)
  }, [])

  // Apply filters to sales ledger data
  const getFilteredLedger = () => {
    let filteredLedger = [...reportData.salesLedger]

    if (filters.date) {
      const filterDate = new Date(filters.date)
      filterDate.setHours(0, 0, 0, 0)
      const filterDateEnd = new Date(filterDate)
      filterDateEnd.setHours(23, 59, 59, 999)

      filteredLedger = filteredLedger.filter(entry => {
        const entryDate = new Date(entry.date)
        return entryDate >= filterDate && entryDate <= filterDateEnd
      })
    }

    if (filters.name) {
      const nameFilter = filters.name.toLowerCase()
      filteredLedger = filteredLedger.filter(entry =>
        (entry.customerName || '').toLowerCase().includes(nameFilter)
      )
    }

    if (filters.type) {
      const want = normalizeLedgerRowType(filters.type)
      if (want) {
        filteredLedger = filteredLedger.filter(
          (entry) => normalizeLedgerRowType(entry.type) === want
        )
      }
    }

    if (filters.status) {
      filteredLedger = filteredLedger.filter(entry => {
        const normalizeStatus = (status) => {
          if (!status || status === '-') return 'Unpaid'
          const statusUpper = status.toUpperCase()
          if (statusUpper === 'PAID' || statusUpper === 'CLEARED') return 'Paid'
          if (statusUpper === 'PARTIAL') return 'Partial'
          if (entry.type === 'Payment' && statusUpper === 'PENDING') return 'Pending'
          if (statusUpper === 'UNPAID' || statusUpper === 'PENDING' || statusUpper === 'DUE') return 'Unpaid'
          return status
        }

        const normalizedEntryStatus = normalizeStatus(entry.status)
        const normalizedFilterStatus = normalizeStatus(filters.status)

        return normalizedEntryStatus === normalizedFilterStatus
      })
    }

    if (filters.invoiceNo) {
      const invoiceFilter = filters.invoiceNo.toLowerCase()
      filteredLedger = filteredLedger.filter(entry =>
        (entry.invoiceNo || '').toLowerCase().includes(invoiceFilter)
      )
    }

    if (filters.branchId) {
      const bid = parseInt(filters.branchId, 10)
      if (!isNaN(bid)) {
        filteredLedger = filteredLedger.filter(entry => {
          const entryBranchId = entry.branchId || entry.branchID
          return entryBranchId !== null && entryBranchId !== undefined && parseInt(entryBranchId, 10) === bid
        })
      }
    }
    if (filters.routeId) {
      const rid = parseInt(filters.routeId, 10)
      if (!isNaN(rid)) {
        filteredLedger = filteredLedger.filter(entry => {
          const entryRouteId = entry.routeId || entry.routeID
          return entryRouteId !== null && entryRouteId !== undefined && parseInt(entryRouteId, 10) === rid
        })
      }
    }
    if (filters.staffId) {
      const sid = parseInt(filters.staffId, 10)
      if (!isNaN(sid)) {
        filteredLedger = filteredLedger.filter(entry => {
          const entryStaffId = entry.createdById || entry.createdBy || entry.staffId || entry.userId
          return entryStaffId !== null && entryStaffId !== undefined && parseInt(entryStaffId, 10) === sid
        })
      }
    }

    if (filters.realPendingMin) {
      const realPendingMin = parseFloat(filters.realPendingMin)
      filteredLedger = filteredLedger.filter(entry =>
        (entry.realPending || 0) >= realPendingMin
      )
    }
    if (filters.realPendingMax) {
      const realPendingMax = parseFloat(filters.realPendingMax)
      filteredLedger = filteredLedger.filter(entry =>
        (entry.realPending || 0) <= realPendingMax
      )
    }

    if (filters.realGotPaymentMin) {
      const realGotPaymentMin = parseFloat(filters.realGotPaymentMin)
      filteredLedger = filteredLedger.filter(entry =>
        (entry.realGotPayment || 0) >= realGotPaymentMin
      )
    }
    if (filters.realGotPaymentMax) {
      const realGotPaymentMax = parseFloat(filters.realGotPaymentMax)
      filteredLedger = filteredLedger.filter(entry =>
        (entry.realGotPayment || 0) <= realGotPaymentMax
      )
    }

    return filteredLedger.map(entry => ({
      ...entry,
      balance: entry.customerBalance || 0
    }))
  }

  // Memoize filtered ledger to ensure it updates when filters or data change
  const filteredLedger = React.useMemo(() => {
    return getFilteredLedger()
  }, [reportData.salesLedger, filters.date, filters.name, filters.type, filters.status, filters.invoiceNo, filters.branchId, filters.routeId, filters.staffId, filters.realPendingMin, filters.realPendingMax, filters.realGotPaymentMin, filters.realGotPaymentMax])
  
  const hasActiveFilters = Object.values(filters).some(v => v !== '')

  // Sale-only: flat global timeline (newest invoices at top of whole list). Otherwise: grouped by customer + subtotals.
  const displayLedgerSorted = React.useMemo(() => {
    if (filters.type === 'Sale' && filteredLedger.length > 0) {
      return sortFlatSalesLedger(filteredLedger, sortOrder)
    }
    return sortLedgerForDisplay(filteredLedger, sortOrder)
  }, [filteredLedger, sortOrder, filters.type])

  const showGroupedSubtotals = filters.type !== 'Sale'

  const setSortOrderPersist = (next) => {
    setSortOrder(next)
    try { localStorage.setItem(SORT_ORDER_KEY, next) } catch (_) { }
  }

  // Pagination state
  const [displayLimit, setDisplayLimit] = useState(150) // Show first N entries by default
  const INITIAL_DISPLAY_LIMIT = 150
  const LOAD_MORE_INCREMENT = 100

  // Group entries by customer for subtotals
  const customerGroups = React.useMemo(() => {
    const groups = new Map()
    filteredLedger.forEach(entry => {
      const customerName = entry.customerName || 'Cash Customer'
      if (!groups.has(customerName)) {
        groups.set(customerName, [])
      }
      groups.get(customerName).push(entry)
    })
    return Array.from(groups.entries()).map(([customerName, entries]) => {
      // Sort entries by date to get the last balance
      const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date))
      const lastEntry = sortedEntries[sortedEntries.length - 1]
      
      // Calculate totals correctly
      const salesEntries = entries.filter(e => e.type === 'Sale')
      const paymentEntries = entries.filter(e => e.type === 'Payment')
      
      // Total sales = sum of all invoice amounts
      const totalSales = salesEntries.reduce((sum, e) => sum + (e.grandTotal || 0), 0)
      
      // Total payments = sum of payment entries only
      // Note: sales.paidAmount already includes payments, but payment entries are separate transactions
      // For accuracy, use payment entries' realGotPayment (actual payment amounts)
      const totalPayments = paymentEntries.reduce((sum, e) => sum + (e.realGotPayment || 0), 0)
      
      // Total pending = sum of unpaid amounts from sales (realPending field)
      const totalPending = salesEntries.reduce((sum, e) => sum + (e.realPending || 0), 0)
      
      // VAT: output VAT from sales minus returns for this customer
      const returnEntriesForCustomer = entries.filter(e => e.type === 'Return')
      const totalSalesVat = salesEntries.reduce((sum, e) => sum + (e.vatTotal || 0), 0)
      const totalReturnsVat = returnEntriesForCustomer.reduce((sum, e) => sum + (e.vatTotal || 0), 0)
      const totalVat = totalSalesVat - totalReturnsVat
      
      // Balance = use the last entry's customerBalance from backend (most accurate, already calculated correctly)
      // This ensures consistency with backend balance calculation
      const balance = lastEntry?.customerBalance ?? (totalSales - totalPayments)
      
      return {
        customerName,
        entries,
        subtotal: {
          totalSales,
          totalPayments,
          totalPending,
          totalInvoices: salesEntries.length,
          balance, // Use backend-calculated balance
          totalVat
        }
      }
    })
  }, [filteredLedger])

  // Check if customer filter is active (showing single customer)
  const isCustomerFiltered = filters.name && customerGroups.length === 1

  // Paginated entries with customer grouping (uses display sort order)
  const displayedLedger = React.useMemo(() => {
    return displayLedgerSorted.slice(0, displayLimit)
  }, [displayLedgerSorted, displayLimit])

  const hasMore = displayLedgerSorted.length > displayLimit
  const handleLoadMore = () => {
    setDisplayLimit(prev => prev + LOAD_MORE_INCREMENT)
  }

  // Reset pagination when filters or sort change
  React.useEffect(() => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT)
  }, [dateRange.from, dateRange.to, filters.branchId, filters.routeId, filters.staffId, filters.type, filters.status, filters.name, filters.invoiceNo, sortOrder])

  // Summary from filtered data only (PRODUCTION_MASTER_TODO #8): totals must match the displayed list.
  // Do not use reportData.salesLedgerSummary for UI totals — it is server summary for initial query only.
  const salesEntries = filteredLedger.filter((e) => normalizeLedgerRowType(e.type) === 'Sale')
  const returnEntries = filteredLedger.filter((e) => normalizeLedgerRowType(e.type) === 'Return')
  const paymentEntries = filteredLedger.filter((e) => normalizeLedgerRowType(e.type) === 'Payment')

  // CRITICAL CORRECTIONS - REAL DATA CALCULATIONS (from filteredLedger):
  // 1. Total Sales = Sum of GrandTotal from all sales (invoice amounts) - REAL BILL AMOUNTS
  const totalSales = salesEntries.reduce((sum, e) => sum + (e.grandTotal || 0), 0)

  // 1b. Total Returns (ERP)
  const totalReturns = returnEntries.reduce((sum, e) => sum + (e.grandTotal || 0), 0)
  const netSales = totalSales - totalReturns

  // 2. Total Paid Amount = ONLY from sales entries (paidAmount field)
  // CRITICAL: paidAmount on sales already includes all payments received for that invoice
  // We should NOT add payment entries separately to avoid double-counting
  // When type="Sale" is selected, payment entries should not be in the list anyway
  let totalPayments = salesEntries.reduce((sum, e) => sum + (e.paidAmount || 0), 0)

  // Only add payment entries if type filter is "Payment" only (not "Sale")
  // This ensures: Total Payments <= Total Sales (logically correct)
  if (filters.type === 'Payment' && paymentEntries.length > 0) {
    // When showing only payments, use payment amounts
    totalPayments = paymentEntries.reduce((sum, e) => sum + (e.realGotPayment || 0), 0)
  } else if (filters.type === '' && paymentEntries.length > 0) {
    // When showing both, use sales paidAmount (more accurate, already includes payments)
    // Don't double-count by adding payment entries
    totalPayments = salesEntries.reduce((sum, e) => sum + (e.paidAmount || 0), 0)
  }

  // 3. Real Pending = Sum of unpaid amounts (GrandTotal - PaidAmount) from sales only
  // This is the amount still owed on invoices
  const totalRealPending = salesEntries.reduce((sum, e) => sum + (e.realPending || 0), 0)

  // 4. Pending Balance = Total Sales - Total Returns - Total Payments (net outstanding)
  const pendingBalance = Math.max(0, totalSales - totalReturns - totalPayments)

  // Total Invoices = Count of sales entries (not transactions)
  const totalInvoices = salesEntries.length

  // 5. VAT (Gulf VAT reporting): output VAT from sales minus returns
  const totalSalesVat = salesEntries.reduce((sum, e) => sum + (e.vatTotal || 0), 0)
  const totalReturnsVat = returnEntries.reduce((sum, e) => sum + (e.vatTotal || 0), 0)
  const totalVat = totalSalesVat - totalReturnsVat

  const filteredSummary = {
    totalSales,
    totalReturns,
    netSales,
    totalPayments,
    totalRealPending,
    totalRealGotPayment: totalPayments,
    pendingBalance,
    totalInvoices,
    totalSalesVat,
    totalReturnsVat,
    totalVat
  }

  const handleShareInvoiceWhatsApp = async (entry) => {
    if (entry.type !== 'Sale' || !entry.saleId) return
    setSharingSaleId(entry.saleId)
    try {
      let phone = null
      if (entry.customerId) {
        try {
          const custRes = await customersAPI.getCustomer(entry.customerId)
          const cust = custRes?.data ?? custRes
          phone = cust?.phone ?? null
        } catch (_) { /* ignore */ }
      }
      const blob = await salesAPI.getInvoicePdf(entry.saleId)
      if (blob) {
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `Invoice_${entry.invoiceNo || entry.saleId}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.URL.revokeObjectURL(url)
      }
      const dateStr = new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const message = `Invoice ${entry.invoiceNo || entry.saleId}\nCustomer: ${entry.customerName || 'N/A'}\nDate: ${dateStr}\nTotal: ${formatCurrency(entry.grandTotal || 0)}\n\nPlease find the invoice attached.`
      const whatsappUrl = getWhatsAppShareUrl(message, phone)
      window.open(whatsappUrl, '_blank')
    } catch (err) {
      console.error('Share invoice WhatsApp:', err)
      if (!err?._handledByInterceptor) toast.error('Failed to prepare invoice for WhatsApp')
    } finally {
      setSharingSaleId(null)
    }
  }

  const handleExport = async () => {
    try {
      toast.loading('Generating PDF...')
      const API_BASE_URL = getApiBaseUrl()

      // Build query params with filters
      const params = new URLSearchParams({
        fromDate: dateRange.from,
        toDate: dateRange.to
      })

      // Add type filter if selected
      if (filters.type) {
        params.append('type', filters.type)
      }

      const response = await fetch(
        `${API_BASE_URL}/reports/sales-ledger/export/pdf?${params.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      )

      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const fileName = filters.type
          ? `sales_ledger_${filters.type.toLowerCase()}_${dateRange.from}_${dateRange.to}.pdf`
          : `sales_ledger_${dateRange.from}_${dateRange.to}.pdf`
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.URL.revokeObjectURL(url)
        toast.dismiss()
        toast.success('PDF exported successfully!')
      } else {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to export PDF')
      }
    } catch (error) {
      console.error('Failed to export PDF:', error)
      toast.dismiss()
      if (!error?._handledByInterceptor) toast.error(error.message || 'Failed to export PDF')
    }
  }

  const toggleKpiStrip = () => {
    const next = !showKpiStrip
    setShowKpiStrip(next)
    try { localStorage.setItem(SHOW_KPI_KEY, String(next)) } catch (_) { }
  }

  const stickyActionTh = 'sticky right-0 z-30 bg-gray-100 shadow-[-8px_0_12px_-4px_rgba(0,0,0,0.12)] border-l border-gray-300'
  const stickyActionCell = (bgClass) =>
    `sticky right-0 z-20 border-l border-gray-200 shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.1)] px-1 lg:px-2 py-1.5 lg:py-2 whitespace-nowrap text-center ${bgClass}`

  const handleExportExcel = () => {
    if (filteredLedger.length === 0) {
      toast.error('No data to export')
      return
    }
    try {
      const headers = ['Date', 'Type', 'Invoice No', 'Customer', 'Payment Mode', 'Bill Amount', 'VAT', 'Paid Amount', 'Pending', 'Status', 'Balance']
      const rows = displayLedgerSorted.map(entry => {
        const dateStr = new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
        const billAmt = entry.type === 'Sale' ? (entry.grandTotal || 0) : entry.type === 'Payment' ? (entry.realGotPayment || 0) : 0
        const vatAmt = entry.type === 'Payment' ? 0 : (entry.vatTotal || 0)
        const paidAmt = entry.type === 'Sale' ? (entry.paidAmount || 0) : entry.type === 'Payment' ? (entry.realGotPayment || 0) : 0
        const pending = entry.type === 'Sale' ? (entry.realPending || 0) : 0
        return [
          dateStr,
          entry.type || '',
          entry.invoiceNo || '-',
          entry.customerName || 'Cash Customer',
          entry.paymentMode || '-',
          billAmt.toFixed(2),
          vatAmt.toFixed(2),
          paidAmt.toFixed(2),
          pending.toFixed(2),
          entry.status || 'Unpaid',
          (entry.type === 'Sale' ? (entry.realPending ?? 0) : (entry.customerBalance ?? 0)).toFixed(2)
        ]
      })
      const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `sales_ledger_${dateRange.from}_${dateRange.to}.csv`
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.success('Excel exported successfully!')
    } catch (error) {
      console.error('Export error:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to export Excel')
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-neutral-50">
      {/* Header — full width, filters horizontal, export right */}
      <div className="flex-shrink-0 bg-white border-b border-neutral-200 px-2 sm:px-4 lg:px-6 py-2 md:py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 md:gap-3 w-full">
          <div>
            <h1 className="text-lg md:text-xl lg:text-2xl font-bold text-neutral-900">Sales Ledger</h1>
            <p className="text-xs text-neutral-600 hidden md:block">Comprehensive sales and payment tracking</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap justify-end">
            <div className="flex gap-1.5 sm:gap-2">
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                className="flex-1 md:flex-initial px-2 py-1.5 border border-gray-300 rounded text-xs"
              />
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                className="flex-1 md:flex-initial px-2 py-1.5 border border-gray-300 rounded text-xs"
              />
            </div>
            <button
              type="button"
              onClick={toggleKpiStrip}
              className="px-2 md:px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 flex items-center gap-1"
              title={showKpiStrip ? 'Hide summary cards' : 'Show summary cards'}
            >
              {showKpiStrip ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Summary</span>
            </button>
            <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs font-medium" role="group" aria-label="Sort order">
              <button
                type="button"
                onClick={() => setSortOrderPersist('newest')}
                className={`px-2 md:px-2.5 py-1.5 ${sortOrder === 'newest' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                Newest
              </button>
              <button
                type="button"
                onClick={() => setSortOrderPersist('oldest')}
                className={`px-2 md:px-2.5 py-1.5 border-l border-gray-300 ${sortOrder === 'oldest' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              >
                Oldest
              </button>
            </div>
            <button
              onClick={() => {
                const next = !showFilters
                setShowFilters(next)
                try { localStorage.setItem(SHOW_FILTERS_KEY, String(next)) } catch (_) { }
              }}
              className="px-2 md:px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 flex items-center gap-1"
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showFilters ? 'Hide' : 'Show'}</span>
            </button>
            <button
              onClick={handleExportExcel}
              className="px-3 py-2 border border-green-600 text-green-700 rounded-lg text-sm font-medium hover:bg-green-50 flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Export Excel</span>
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export PDF</span>
            </button>
          </div>
        </div>
      </div>

      {filters.type === 'Sale' && (
        <div className="flex-shrink-0 px-2 md:px-4 py-1.5 text-xs text-gray-600 bg-emerald-50/90 border-b border-emerald-100">
          <span className="font-medium text-emerald-900">Sales only:</span> one invoice list for all customers, sorted by date and id ({sortOrder === 'newest' ? 'newest at top' : 'oldest at top'}). Per-customer subtotals are hidden; use footer totals or set Type to All for grouped subtotals.
        </div>
      )}
      {sortOrder === 'newest' && filters.type !== 'Sale' && (
        <div className="flex-shrink-0 px-2 md:px-4 py-1.5 text-xs text-gray-600 bg-amber-50/90 border-b border-amber-100">
          Newest-first within each customer (latest activity at top). Customer blocks are ordered by latest date, then by highest transaction id when dates tie. Balance column is per transaction, not a running total down the list.
        </div>
      )}

      {/* Filters - Collapsible */}
      {showFilters && (
        <div className="flex-shrink-0 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-200 px-3 py-2 overflow-y-auto max-h-52 md:max-h-56">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <Filter className="h-4 w-4 text-blue-600 mr-2" />
              <h3 className="text-sm lg:text-base font-semibold text-gray-900">Filters</h3>
            </div>
            {hasActiveFilters && (
              <span className="px-2 py-1 bg-blue-600 text-white text-xs font-medium rounded-full">
                {Object.values(filters).filter(v => v !== '').length} active
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3">
            <Input
              label="Date"
              type="date"
              value={filters.date}
              onChange={(e) => setFilters(prev => ({ ...prev, date: e.target.value }))}
            />
            <Input
              label="Customer Name"
              type="text"
              placeholder="Search..."
              value={filters.name}
              onChange={(e) => setFilters(prev => ({ ...prev, name: e.target.value }))}
            />
            <Select
              label="Type"
              options={[
                { value: '', label: 'All Types' },
                { value: 'Sale', label: 'Sale' },
                { value: 'Return', label: 'Return' },
                { value: 'Payment', label: 'Payment' }
              ]}
              value={filters.type}
              onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}
            />
            <Select
              label="Status"
              options={[
                { value: '', label: 'All Status' },
                { value: 'Paid', label: 'Paid' },
                { value: 'Partial', label: 'Partial' },
                { value: 'Unpaid', label: 'Unpaid' }
              ]}
              value={filters.status}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            />
            <Input
              label="Invoice No"
              type="text"
              placeholder="Search..."
              value={filters.invoiceNo}
              onChange={(e) => setFilters(prev => ({ ...prev, invoiceNo: e.target.value }))}
            />
            {branches.length > 0 && (
              <Select
                label="Branch"
                options={[
                  ...(isAdminOrOwner(user) ? [{ value: '', label: 'All branches' }] : []),
                  ...branches.map(b => ({ value: String(b.id), label: b.name }))
                ]}
                value={filters.branchId}
                onChange={(e) => setFilters(prev => ({ ...prev, branchId: e.target.value, routeId: '' }))}
                disabled={!isAdminOrOwner(user) && branches.length === 1}
                className={(!isAdminOrOwner(user) && branches.length === 1) ? 'bg-neutral-100 text-neutral-500 cursor-not-allowed' : ''}
              />
            )}
            {(branches.length > 0 || filters.branchId) && (
              <Select
                label="Route"
                options={[
                  ...(isAdminOrOwner(user) ? [{ value: '', label: filters.branchId ? 'All routes' : 'Select branch first' }] : []),
                  ...(filters.branchId ? routesForBranch : []).map(r => ({ value: String(r.id), label: r.name }))
                ]}
                value={filters.routeId}
                onChange={(e) => setFilters(prev => ({ ...prev, routeId: e.target.value }))}
                disabled={!filters.branchId || (!isAdminOrOwner(user) && routesForBranch.length <= 1)}
                className={(!filters.branchId || (!isAdminOrOwner(user) && routesForBranch.length <= 1)) ? 'bg-neutral-100 text-neutral-500 cursor-not-allowed' : ''}
              />
            )}
            {staffUsers.length > 0 && (
              <Select
                label="Staff"
                options={[
                  ...(isAdminOrOwner(user) ? [{ value: '', label: 'All staff' }] : []),
                  ...staffUsers.map(u => ({ value: String(u.id), label: u.name || u.email || 'Staff' }))
                ]}
                value={filters.staffId}
                onChange={(e) => setFilters(prev => ({ ...prev, staffId: e.target.value }))}
                disabled={!isAdminOrOwner(user)}
                className={!isAdminOrOwner(user) ? 'bg-neutral-100 text-neutral-500 cursor-not-allowed' : ''}
              />
            )}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-700 mb-1" title="Filter by unpaid invoice amount">Outstanding Balance (Min–Max)</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.realPendingMin}
                  onChange={(e) => setFilters(prev => ({ ...prev, realPendingMin: e.target.value }))}
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.realPendingMax}
                  onChange={(e) => setFilters(prev => ({ ...prev, realPendingMax: e.target.value }))}
                />
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-700 mb-1" title="Filter by payment/received amount">Amount Received (Min–Max)</label>
              <div className="flex gap-1">
                <Input
                  type="number"
                  placeholder="Min"
                  value={filters.realGotPaymentMin}
                  onChange={(e) => setFilters(prev => ({ ...prev, realGotPaymentMin: e.target.value }))}
                />
                <Input
                  type="number"
                  placeholder="Max"
                  value={filters.realGotPaymentMax}
                  onChange={(e) => setFilters(prev => ({ ...prev, realGotPaymentMax: e.target.value }))}
                />
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 flex items-end">
              <button
                onClick={() => setFilters({
                  date: '',
                  name: '',
                  type: '',
                  status: '',
                  invoiceNo: '',
                  branchId: '',
                  routeId: '',
                  staffId: '',
                  realPendingMin: '',
                  realPendingMax: '',
                  realGotPaymentMin: '',
                  realGotPaymentMax: ''
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards - collapsible for more table space */}
      {!showKpiStrip && (
        <div className="flex-shrink-0 px-2 md:px-4 py-1.5 bg-white border-b border-gray-200 text-xs text-gray-700">
          <span className="font-medium text-gray-500 mr-2">Totals:</span>
          Sales {formatCurrency(filteredSummary.totalSales)}
          <span className="mx-1.5 text-gray-300">|</span>
          Net {formatCurrency(filteredSummary.netSales ?? filteredSummary.totalSales)}
          <span className="mx-1.5 text-gray-300">|</span>
          Recv. {formatCurrency(filteredSummary.totalPayments)}
          <span className="mx-1.5 text-gray-300">|</span>
          Unpaid {formatCurrency(filteredSummary.totalRealPending)}
          <span className="mx-1.5 text-gray-300">|</span>
          VAT {formatCurrency(filteredSummary.totalVat ?? 0)}
          <span className="mx-1.5 text-gray-300">|</span>
          {filteredLedger.length} rows
        </div>
      )}
      {showKpiStrip && (
      <div className="flex-shrink-0 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-9 gap-1.5 md:gap-2 lg:gap-3 px-2 md:px-4 py-2 md:py-3 bg-white border-b border-gray-200">
        <div className="bg-blue-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-blue-500">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Sales</div>
          <div className="text-sm md:text-base lg:text-lg font-bold text-gray-900 truncate">
            {formatCurrency(filteredSummary.totalSales)}
          </div>
        </div>
        <div className="bg-amber-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-amber-500">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Returns</div>
          <div className="text-sm md:text-base lg:text-lg font-bold text-amber-700 truncate">
            {formatCurrency(filteredSummary.totalReturns ?? 0)}
          </div>
        </div>
        <div className="bg-indigo-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-indigo-500">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Net Sales</div>
          <div className="text-sm md:text-base lg:text-lg font-bold text-indigo-700 truncate">
            {formatCurrency(filteredSummary.netSales ?? filteredSummary.totalSales)}
          </div>
        </div>
        <div className="bg-green-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-green-500">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Received</div>
          <div className="text-sm md:text-base lg:text-lg font-bold text-green-600 truncate">
            {formatCurrency(filteredSummary.totalPayments)}
          </div>
        </div>
        <div className="bg-yellow-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-yellow-500">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Unpaid</div>
          <div className="text-sm md:text-base lg:text-lg font-bold text-yellow-600 truncate">
            {formatCurrency(filteredSummary.totalRealPending)}
          </div>
        </div>
        <div className="bg-orange-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-orange-500">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Balance</div>
          <div className={`text-sm md:text-base lg:text-lg font-bold truncate ${filteredSummary.pendingBalance > 0 ? 'text-red-600' :
            filteredSummary.pendingBalance < 0 ? 'text-green-600' :
              'text-gray-600'
            }`}>
            {formatBalance(filteredSummary.pendingBalance)}
          </div>
        </div>
        <div className="bg-purple-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-purple-500">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Invoices</div>
          <div className="text-sm md:text-base lg:text-lg font-bold text-purple-600">
            {filteredSummary.totalInvoices || 0}
          </div>
        </div>
        <div className="bg-teal-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-teal-500" title="Output VAT (Sales minus Returns)">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Net VAT</div>
          <div className="text-sm md:text-base lg:text-lg font-bold text-teal-700 truncate">
            {formatCurrency(filteredSummary.totalVat ?? 0)}
          </div>
        </div>
        <div className="bg-indigo-50 rounded p-1.5 md:p-2 lg:p-3 border-l-2 md:border-l-4 border-indigo-500">
          <div className="text-xs md:text-xs lg:text-xs text-gray-600 uppercase mb-0.5">Total</div>
          <div className="text-sm md:text-base lg:text-lg font-bold text-indigo-600">
            {filteredLedger.length}
          </div>
        </div>
      </div>
      )}

      {/* Table - Scrollable (fills remaining viewport height) */}
      {loading ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <LoadingCard message="Loading sales ledger..." />
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-white w-full rounded-lg border border-gray-200">
          {/* Desktop Table — sticky header; Actions column sticky right */}
          <div className="hidden md:flex md:flex-col md:flex-1 md:min-h-0 w-full">
            <div className="flex-1 min-h-0 overflow-auto w-full">
            <table className="w-full min-w-[1100px] divide-y divide-gray-200 text-xs lg:text-sm">
              <thead className="bg-gray-100 sticky top-0 z-20 border-b-2 border-gray-300">
                <tr>
                  <th className="px-2 lg:px-3 py-2 text-left text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Date
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-left text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Type
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-left text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Invoice No
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-left text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Customer
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-left text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Payment Mode
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-right text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Bill Amount
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-right text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    VAT
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-right text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Paid Amount
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-right text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Pending
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-center text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Status
                  </th>
                  <th className="px-2 lg:px-3 py-2 text-right text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap border-r border-gray-300">
                    Balance
                  </th>
                  <th className={`px-2 lg:px-3 py-2 text-center text-xs lg:text-xs font-bold text-gray-700 uppercase whitespace-nowrap min-w-[5.5rem] ${stickyActionTh}`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredLedger.length === 0 ? (
                  <tr>
                    <td colSpan="12" className="px-4 py-8 text-center text-gray-500">
                      <FileText className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                      <p>No transactions found matching the filters</p>
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const rows = []
                    let prevCustomer = null
                    let currentCustomerEntries = []

                    displayedLedger.forEach((entry, idx) => {
                      const customerName = entry.customerName || 'Cash Customer'
                      const isNewCustomer = prevCustomer !== null && prevCustomer !== customerName
                      
                      // If we're starting a new customer, add subtotal for previous customer
                      if (isNewCustomer && currentCustomerEntries.length > 0 && showGroupedSubtotals && (customerGroups.length > 1 || isCustomerFiltered)) {
                        const prevCustomerGroup = customerGroups.find(g => g.customerName === prevCustomer)
                        if (prevCustomerGroup) {
                          // Use full customer totals from customerGroups, not just displayed entries
                          rows.push(
                            <tr key={`subtotal-${prevCustomer}-${idx}`} className="bg-indigo-50 border-t-2 border-indigo-300">
                              <td colSpan="5" className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-indigo-900 border-r border-gray-300">
                                Subtotal for {prevCustomer}:
                              </td>
                              <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-blue-700 border-r border-gray-300">
                                {formatCurrency(prevCustomerGroup.subtotal.totalSales)}
                              </td>
                              <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-teal-700 border-r border-gray-300">
                                {formatCurrency(prevCustomerGroup.subtotal.totalVat ?? 0)}
                              </td>
                              <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-green-700 border-r border-gray-300">
                                {formatCurrency(prevCustomerGroup.subtotal.totalPayments)}
                              </td>
                              <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-red-700 border-r border-gray-300">
                                {formatCurrency(prevCustomerGroup.subtotal.totalPending)}
                              </td>
                              <td className="px-2 lg:px-3 py-2 text-center text-xs lg:text-sm font-bold text-gray-700 border-r border-gray-300">
                                {prevCustomerGroup.subtotal.totalInvoices} invoices
                              </td>
                              <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-indigo-700 border-r border-gray-300">
                                {formatBalance(prevCustomerGroup.subtotal.totalSales - prevCustomerGroup.subtotal.totalPayments)}
                              </td>
                              <td className={stickyActionCell('bg-indigo-50')} />
                            </tr>
                          )
                        }
                        currentCustomerEntries = []
                      }
                      
                      prevCustomer = customerName
                      currentCustomerEntries.push(entry)

                      // Single date column - show date only (no time, no plan date)
                      const dateStr = new Date(entry.date).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                      })

                      const rowBgColor = entry.type === 'Payment'
                        ? 'bg-green-50 hover:bg-green-100'
                        : entry.type === 'Return'
                          ? 'bg-amber-50 hover:bg-amber-100'
                          : 'hover:bg-gray-50'

                      const normalizeStatusForDisplay = (status) => {
                        if (entry.type === 'Return') return 'Returned'
                        if (!status || status === '-') return 'Unpaid'
                        const statusUpper = (status || '').toUpperCase()
                        if (entry.type === 'Payment' && statusUpper === 'PENDING') return 'Pending'
                        if (statusUpper === 'PAID' || statusUpper === 'CLEARED') return 'Paid'
                        if (statusUpper === 'PARTIAL') return 'Partial'
                        if (statusUpper === 'UNPAID' || statusUpper === 'PENDING' || statusUpper === 'DUE') return 'Unpaid'
                        return status
                      }

                      const displayStatus = normalizeStatusForDisplay(entry.status)

                      const statusColor =
                        displayStatus === 'Returned'
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : displayStatus === 'Paid'
                            ? 'bg-green-100 text-green-800 border-green-300'
                            : displayStatus === 'Pending'
                              ? 'bg-orange-100 text-orange-800 border-orange-300'
                            : displayStatus === 'Partial'
                              ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                              : displayStatus === 'Unpaid'
                                ? 'bg-red-100 text-red-800 border-red-300'
                                : 'bg-gray-100 text-gray-800 border-gray-300'

                      // For Sale rows show remaining balance for this invoice (0 when Paid); for Payment/Return show running balance
                      const customerBalance = entry.type === 'Sale' ? (entry.realPending ?? 0) : (entry.customerBalance ?? 0)

                      rows.push(
                        <tr key={ledgerRowKey(entry, idx)} className={rowBgColor}>
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm text-gray-900 border-r border-gray-200">
                          {dateStr}
                        </td>
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm font-medium text-gray-900 border-r border-gray-200">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${entry.type === 'Payment'
                            ? 'bg-green-100 text-green-800'
                            : entry.type === 'Return'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                            }`}>
                            {entry.type}
                          </span>
                        </td>
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm font-semibold text-gray-900 border-r border-gray-200">
                          {entry.invoiceNo}
                        </td>
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm text-gray-900 border-r border-gray-200">
                          {entry.customerName}
                        </td>
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm text-gray-600 border-r border-gray-200">
                          {entry.paymentMode || '-'}
                        </td>
                        {/* Bill Amount - Sales: GrandTotal; Return: -; Payment: credit amount */}
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm text-right font-bold text-blue-600 border-r border-gray-200">
                          {entry.type === 'Sale'
                            ? formatCurrency(entry.grandTotal || 0)
                            : entry.type === 'Return'
                              ? '-'
                              : entry.type === 'Payment'
                                ? formatCurrency(entry.realGotPayment || 0)
                                : '-'}
                        </td>
                        {/* VAT - Sale/Return: vatTotal; Payment: - */}
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm text-right font-medium text-teal-700 border-r border-gray-200">
                          {entry.type === 'Payment' ? '-' : (entry.vatTotal > 0 ? formatCurrency(entry.vatTotal) : '-')}
                        </td>
                        {/* Paid Amount - Sales: paid; Return: return amount (credit); Payment: amount */}
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm text-right font-semibold text-green-600 border-r border-gray-200">
                          {entry.type === 'Sale'
                            ? (entry.paidAmount > 0 ? formatCurrency(entry.paidAmount) : '-')
                            : entry.type === 'Return'
                              ? formatCurrency(entry.grandTotal || 0)
                              : entry.type === 'Payment'
                                ? formatCurrency(entry.realGotPayment || 0)
                                : '-'}
                        </td>
                        {/* Pending - Show only for Sales (unpaid amount) */}
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm text-right font-semibold text-red-600 border-r border-gray-200">
                          {entry.type === 'Sale' && entry.realPending > 0
                            ? formatCurrency(entry.realPending)
                            : '-'}
                        </td>
                        <td className="px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-center border-r border-gray-200">
                          {displayStatus && displayStatus !== '-' ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${statusColor}`}>
                              {displayStatus}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td
                          className={`px-2 lg:px-3 py-1.5 lg:py-2 whitespace-nowrap text-xs lg:text-sm text-right font-bold ${customerBalance < 0
                            ? 'text-green-600'
                            : customerBalance > 0
                              ? 'text-red-600'
                              : 'text-gray-900'
                            }`}
                        >
                          {formatBalance(customerBalance)}
                        </td>
                        <td className={
                          stickyActionCell(
                            entry.type === 'Payment'
                              ? 'bg-green-50 hover:bg-green-100'
                              : entry.type === 'Return'
                                ? 'bg-amber-50 hover:bg-amber-100'
                                : 'bg-white hover:bg-gray-50'
                          )
                        }>
                          {entry.type === 'Sale' && entry.saleId ? (
                            <div className="inline-flex items-center justify-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => navigate(`/pos?editId=${entry.saleId}`, { state: { returnTo: location.pathname + location.search } })}
                                className="inline-flex items-center justify-center p-1.5 rounded-md text-primary-600 hover:bg-primary-50 hover:text-primary-800"
                                title="Edit invoice in POS"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleShareInvoiceWhatsApp(entry)}
                                disabled={sharingSaleId === entry.saleId}
                                className="inline-flex items-center justify-center p-1.5 rounded-md text-green-600 hover:bg-green-50 hover:text-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Share via WhatsApp"
                              >
                                <MessageCircle className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      </tr>
                      )
                    })

                    // Add subtotal for last customer if multiple customers or customer filtered
                    if (currentCustomerEntries.length > 0 && showGroupedSubtotals && (customerGroups.length > 1 || isCustomerFiltered)) {
                      const lastCustomerGroup = customerGroups.find(g => g.customerName === prevCustomer)
                      if (lastCustomerGroup) {
                        // Use full customer totals from customerGroups, not just displayed entries
                        rows.push(
                          <tr key={`subtotal-${prevCustomer}-final`} className="bg-indigo-50 border-t-2 border-indigo-300">
                            <td colSpan="5" className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-indigo-900 border-r border-gray-300">
                              Subtotal for {prevCustomer}:
                            </td>
                            <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-blue-700 border-r border-gray-300">
                              {formatCurrency(lastCustomerGroup.subtotal.totalSales)}
                            </td>
                            <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-teal-700 border-r border-gray-300">
                              {formatCurrency(lastCustomerGroup.subtotal.totalVat ?? 0)}
                            </td>
                            <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-green-700 border-r border-gray-300">
                              {formatCurrency(lastCustomerGroup.subtotal.totalPayments)}
                            </td>
                            <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-red-700 border-r border-gray-300">
                              {formatCurrency(lastCustomerGroup.subtotal.totalPending)}
                            </td>
                            <td className="px-2 lg:px-3 py-2 text-center text-xs lg:text-sm font-bold text-gray-700 border-r border-gray-300">
                              {lastCustomerGroup.subtotal.totalInvoices} invoices
                            </td>
                            <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-indigo-700 border-r border-gray-300">
                              {formatBalance(lastCustomerGroup.subtotal.balance)}
                            </td>
                            <td className={stickyActionCell('bg-indigo-50')} />
                          </tr>
                        )
                      }
                    }

                    return rows
                  })()
                )}
                {hasMore && (
                  <tr>
                    <td colSpan="12" className="px-4 py-3 text-center bg-gray-50">
                      <button
                        onClick={handleLoadMore}
                        className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 transition-colors"
                      >
                        Load More ({displayLedgerSorted.length - displayLimit} remaining)
                      </button>
                      <p className="text-xs text-gray-500 mt-2">
                        Showing {displayLimit} of {displayLedgerSorted.length} entries
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-gray-200 sticky bottom-0 border-t-2 border-gray-400">
                <tr className="bg-blue-50">
                  <td
                    colSpan="5"
                    className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-gray-900 border-r border-gray-300"
                  >
                    TOTALS (filtered)
                  </td>
                  <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-blue-700 border-r border-gray-300">
                    {formatCurrency(filteredSummary.totalSales)}
                  </td>
                  <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-teal-700 border-r border-gray-300">
                    {formatCurrency(filteredSummary.totalVat ?? 0)}
                  </td>
                  <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-green-700 border-r border-gray-300">
                    {formatCurrency(filteredSummary.totalPayments)}
                  </td>
                  <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold text-red-700 border-r border-gray-300">
                    {formatCurrency(filteredSummary.totalRealPending)}
                  </td>
                  <td className="px-2 lg:px-3 py-2 text-center text-xs lg:text-sm font-bold text-gray-900 border-r border-gray-300">
                    -
                  </td>
                  <td className="px-2 lg:px-3 py-2 text-right text-xs lg:text-sm font-bold border-r border-gray-300">
                    <span className={filteredSummary.pendingBalance > 0 ? 'text-red-700' : filteredSummary.pendingBalance < 0 ? 'text-green-700' : 'text-gray-900'}>
                      {formatBalance(filteredSummary.pendingBalance)}
                    </span>
                  </td>
                  <td className={stickyActionCell('bg-blue-50')} />
                </tr>
              </tfoot>
            </table>
            </div>
          </div>

          {/* Mobile Card View - Shown only on mobile */}
          <div className="md:hidden flex-1 min-h-0 overflow-auto px-2 py-2 space-y-2">
            {displayedLedger.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <FileText className="w-12 h-12 mb-2 text-gray-300" />
                <p className="text-sm">No transactions found</p>
              </div>
            ) : (
              <>
                {displayedLedger.map((entry, idx) => {
                  const customerName = entry.customerName || 'Cash Customer'
                  const isNewCustomer = idx === 0 || displayedLedger[idx - 1].customerName !== customerName
                  const isLastEntry = idx === displayedLedger.length - 1
                  const isLastOfCustomer = isLastEntry || displayedLedger[idx + 1].customerName !== customerName
                  const customerGroup = customerGroups.find(g => g.customerName === customerName)
                const dateStr = new Date(entry.date).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric'
                })
                const normalizeStatusForDisplay = (status) => {
                  if (entry.type === 'Return') return 'Returned'
                  if (!status || status === '-') return 'Unpaid'
                  const statusUpper = (status || '').toUpperCase()
                  if (entry.type === 'Payment' && statusUpper === 'PENDING') return 'Pending'
                  if (statusUpper === 'PAID' || statusUpper === 'CLEARED') return 'Paid'
                  if (statusUpper === 'PARTIAL') return 'Partial'
                  if (statusUpper === 'UNPAID' || statusUpper === 'PENDING' || statusUpper === 'DUE') return 'Unpaid'
                  return status
                }
                const displayStatus = normalizeStatusForDisplay(entry.status)
                const statusColor =
                  displayStatus === 'Returned'
                    ? 'bg-amber-100 text-amber-800'
                    : displayStatus === 'Paid'
                      ? 'bg-green-100 text-green-800'
                      : displayStatus === 'Pending'
                        ? 'bg-orange-100 text-orange-800'
                      : displayStatus === 'Partial'
                        ? 'bg-yellow-100 text-yellow-800'
                        : displayStatus === 'Unpaid'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'

                return (
                  <React.Fragment key={ledgerRowKey(entry, idx)}>
                    {isNewCustomer && idx > 0 && showGroupedSubtotals && (customerGroups.length > 1 || isCustomerFiltered) && (() => {
                      const prevCustomerName = displayedLedger[idx - 1].customerName || 'Cash Customer'
                      const prevCustomerGroup = customerGroups.find(g => g.customerName === prevCustomerName)
                      return prevCustomerGroup ? (
                        <div className="bg-indigo-50 border-2 border-indigo-300 rounded-lg p-3 mb-2">
                          <div className="text-xs font-bold text-indigo-900 mb-1">
                            Subtotal for {prevCustomerName}:
                          </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <div className="text-gray-600">Sales:</div>
                                <div className="font-bold text-blue-700">{formatCurrency(prevCustomerGroup.subtotal.totalSales)}</div>
                              </div>
                              <div>
                                <div className="text-gray-600">VAT:</div>
                                <div className="font-bold text-teal-700">{formatCurrency(prevCustomerGroup.subtotal.totalVat ?? 0)}</div>
                              </div>
                              <div>
                                <div className="text-gray-600">Paid:</div>
                                <div className="font-bold text-green-700">{formatCurrency(prevCustomerGroup.subtotal.totalPayments)}</div>
                              </div>
                              <div>
                                <div className="text-gray-600">Pending:</div>
                                <div className="font-bold text-red-700">{formatCurrency(prevCustomerGroup.subtotal.totalPending)}</div>
                              </div>
                              <div>
                                <div className="text-gray-600">Balance:</div>
                                <div className={`font-bold ${prevCustomerGroup.subtotal.balance < 0 ? 'text-green-600' : prevCustomerGroup.subtotal.balance > 0 ? 'text-red-600' : 'text-gray-700'}`}>
                                  {formatBalance(prevCustomerGroup.subtotal.balance)}
                                </div>
                              </div>
                            </div>
                        </div>
                      ) : null
                    })()}
                    <div
                      className={`rounded-lg border p-2.5 ${entry.type === 'Payment'
                        ? 'bg-green-50 border-green-200'
                        : entry.type === 'Return'
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-white border-gray-200'
                        }`}
                    >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${entry.type === 'Payment'
                            ? 'bg-green-600 text-white'
                            : entry.type === 'Return'
                              ? 'bg-amber-600 text-white'
                              : 'bg-blue-600 text-white'
                            }`}>
                            {entry.type}
                          </span>
                          <span className="text-xs font-bold text-gray-900">{entry.invoiceNo}</span>
                          {displayStatus && displayStatus !== '-' && (
                            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${statusColor}`}>
                              {displayStatus}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600">{entry.customerName}</div>
                        <div className="text-xs text-gray-500">{dateStr}</div>
                      </div>
                      {entry.type === 'Sale' && entry.saleId ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/pos?editId=${entry.saleId}`, { state: { returnTo: location.pathname + location.search } })}
                            className="p-2 rounded-md text-primary-600 hover:bg-primary-50"
                            title="Edit invoice"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleShareInvoiceWhatsApp(entry)}
                            disabled={sharingSaleId === entry.saleId}
                            className="p-2 rounded-md text-green-600 hover:bg-green-50 disabled:opacity-50"
                            title="WhatsApp"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      <div>
                        <div className="text-xs text-gray-500 uppercase">Bill</div>
                        <div className="font-bold text-blue-600">
                          {entry.type === 'Sale'
                            ? formatCurrency(entry.grandTotal || 0)
                            : entry.type === 'Return'
                              ? formatCurrency(entry.grandTotal || 0)
                              : formatCurrency(entry.realGotPayment || 0)}
                        </div>
                      </div>
                      {(entry.vatTotal > 0 && entry.type !== 'Payment') && (
                        <div>
                          <div className="text-xs text-gray-500 uppercase">VAT</div>
                          <div className="font-bold text-teal-700">{formatCurrency(entry.vatTotal)}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs text-gray-500 uppercase">Paid</div>
                        <div className="font-bold text-green-600">
                          {entry.type === 'Sale'
                            ? (entry.paidAmount > 0 ? formatCurrency(entry.paidAmount) : '-')
                            : formatCurrency(entry.realGotPayment || 0)}
                        </div>
                      </div>
                      {entry.type === 'Sale' && entry.realPending > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 uppercase">Pending</div>
                          <div className="font-bold text-red-600">
                            {formatCurrency(entry.realPending)}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs text-gray-500 uppercase">Balance</div>
                        <div className={`font-bold ${(entry.type === 'Sale' ? (entry.realPending ?? 0) : (entry.customerBalance ?? 0)) < 0 ? 'text-green-600' :
                          (entry.type === 'Sale' ? (entry.realPending ?? 0) : (entry.customerBalance ?? 0)) > 0 ? 'text-red-600' :
                            'text-gray-900'
                          }`}>
                          {formatBalance(entry.type === 'Sale' ? (entry.realPending ?? 0) : (entry.customerBalance ?? 0))}
                        </div>
                      </div>
                    </div>

                    {entry.paymentMode && entry.paymentMode !== '-' && (
                      <div className="mt-1.5 pt-1.5 border-t border-gray-200">
                        <span className="text-xs text-gray-500">Mode: </span>
                        <span className="text-xs font-medium text-gray-700">{entry.paymentMode}</span>
                      </div>
                    )}
                    </div>
                    {isLastOfCustomer && showGroupedSubtotals && (customerGroups.length > 1 || isCustomerFiltered) && (() => {
                      const customerGroup = customerGroups.find(g => g.customerName === customerName)
                      return customerGroup ? (
                        <div className="bg-indigo-50 border-2 border-indigo-300 rounded-lg p-3 mt-2">
                          <div className="text-xs font-bold text-indigo-900 mb-1">
                            Subtotal for {customerName}:
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <div className="text-gray-600">Sales:</div>
                              <div className="font-bold text-blue-700">{formatCurrency(customerGroup.subtotal.totalSales)}</div>
                            </div>
                            <div>
                              <div className="text-gray-600">Paid:</div>
                              <div className="font-bold text-green-700">{formatCurrency(customerGroup.subtotal.totalPayments)}</div>
                            </div>
                            <div>
                              <div className="text-gray-600">Pending:</div>
                              <div className="font-bold text-red-700">{formatCurrency(customerGroup.subtotal.totalPending)}</div>
                            </div>
                            <div>
                              <div className="text-gray-600">Balance:</div>
                              <div className={`font-bold ${customerGroup.subtotal.balance < 0 ? 'text-green-600' : customerGroup.subtotal.balance > 0 ? 'text-red-600' : 'text-gray-700'}`}>
                                {formatBalance(customerGroup.subtotal.balance)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null
                    })()}
                  </React.Fragment>
                )
              })}
              {hasMore && (
                <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                  <button
                    onClick={handleLoadMore}
                    className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 transition-colors"
                  >
                    Load More ({displayLedgerSorted.length - displayLimit} remaining)
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    Showing {displayLimit} of {displayLedgerSorted.length} entries
                  </p>
                </div>
              )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SalesLedgerPage

