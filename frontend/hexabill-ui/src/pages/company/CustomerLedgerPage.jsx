import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Search,
  Download,
  Printer,
  RefreshCw,
  Settings,
  Plus,
  FileText,
  Eye,
  DollarSign,
  TrendingUp,
  Users,
  CreditCard,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  Filter,
  X,
  Edit,
  Trash2,
  Wallet,
  AlertTriangle,
  ArrowLeft,
  RotateCcw
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useBranding } from '../../contexts/TenantBrandingContext'
import { formatCurrency, formatBalance } from '../../utils/currency'
import { LoadingCard, LoadingButton } from '../../components/Loading'
import { Input, Select } from '../../components/Form'
import Modal from '../../components/Modal'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import { customersAPI, paymentsAPI, salesAPI, reportsAPI, adminAPI, returnsAPI } from '../../services'
import { Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import PaymentModal from '../../components/PaymentModal'
import InvoicePreviewModal from '../../components/InvoicePreviewModal'
import ReceiptPreviewModal from '../../components/ReceiptPreviewModal'
import { isAdminOrOwner } from '../../utils/roles'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'

// CRITICAL: Define status property name constants at top level to prevent minifier from creating 'st' variable
// These must be defined before any component code to avoid TDZ errors
const STATUS_PROP = 'status'
const TYPE_PROP = 'type'

const CustomerLedgerPage = () => {
  const { user } = useAuth()
  const { companyName } = useBranding()
  const { branches, routes, staffHasNoAssignments, loading: branchesRoutesLoading } = useBranchesRoutes()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [paymentLoading, setPaymentLoading] = useState(false) // Separate loading state for payment submission
  const [customerLoading, setCustomerLoading] = useState(false) // Separate loading state for customer creation
  const [pdfLoading, setPdfLoading] = useState(false)

  // Use refs to track loading state synchronously (prevents race conditions)
  const paymentLoadingRef = useRef(false)
  const customerLoadingRef = useRef(false)
  const recalculateInProgress = useRef(new Set()) // Track recalculate calls to prevent flooding
  const ledgerLoadInProgressRef = useRef(null) // RISK-2: Only one ledger load at a time per customer (prevents race)
  const [balanceRefreshSkeleton, setBalanceRefreshSkeleton] = useState(false) // "Refreshing balance…" after payment
  const [customers, setCustomers] = useState([])
  const [filteredCustomers, setFilteredCustomers] = useState([]) // Kept for backwards compat; search uses searchDropdownResults
  const [searchDropdownResults, setSearchDropdownResults] = useState([])
  const [searchDropdownLoading, setSearchDropdownLoading] = useState(false)
  const [searchDropdownPage, setSearchDropdownPage] = useState(1)
  const [searchDropdownTotal, setSearchDropdownTotal] = useState(0)
  const searchDebounceRef = useRef(null)
  const CUSTOMER_SEARCH_PAGE_SIZE = 20
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Customer data
  const [customerLedger, setCustomerLedger] = useState([])
  const [customerInvoices, setCustomerInvoices] = useState([])
  const [customerPayments, setCustomerPayments] = useState([])
  const [outstandingInvoices, setOutstandingInvoices] = useState([])
  const [customerSummary, setCustomerSummary] = useState(null)

  // UI State
  const [activeTab, setActiveTab] = useState('ledger') // ledger, invoices, payments, reports
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showSettleCreditModal, setShowSettleCreditModal] = useState(false)
  const [settleCreditEntry, setSettleCreditEntry] = useState(null)
  const [dangerModal, setDangerModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    requireTypedText: null, // null or string like 'DELETE'
    showInput: false,
    inputPlaceholder: '',
    defaultValue: '',
    inputType: 'text',
    onConfirm: () => { }
  })
  const [paymentModalInvoiceId, setPaymentModalInvoiceId] = useState(null)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [selectedInvoiceForView, setSelectedInvoiceForView] = useState(null)
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false)
  const [showEditCustomerModal, setShowEditCustomerModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [showSendStatementModal, setShowSendStatementModal] = useState(false)
  const [showReceiptPreviewModal, setShowReceiptPreviewModal] = useState(false)
  const [receiptPreviewPaymentIds, setReceiptPreviewPaymentIds] = useState([])
  const [payAllOutstandingMode, setPayAllOutstandingMode] = useState(false)
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date()
    const yearsAgo = new Date(now)
    yearsAgo.setFullYear(now.getFullYear() - 5) // 5 years back so migrated ZAYOGA and legacy data visible
    return {
      from: yearsAgo.toISOString().split('T')[0],
      to: now.toISOString().split('T')[0]
    }
  })
  const [ledgerFilters, setLedgerFilters] = useState({
    status: 'all',
    type: 'all'
  })
  const [ledgerBranchId, setLedgerBranchId] = useState('')
  const [ledgerRouteId, setLedgerRouteId] = useState('')
  const [ledgerStaffId, setLedgerStaffId] = useState('')
  // Staged filter values (used by Apply button); applied values above drive API calls
  const [filterDraft, setFilterDraft] = useState(() => {
    const now = new Date()
    const yearsAgo = new Date(now)
    yearsAgo.setFullYear(now.getFullYear() - 5)
    return {
      from: yearsAgo.toISOString().split('T')[0],
      to: now.toISOString().split('T')[0],
    branchId: '',
    routeId: '',
    staffId: ''
  }});
  const [staffUsers, setStaffUsers] = useState([])
  const [staffAssignmentsLoaded, setStaffAssignmentsLoaded] = useState(false)
  const [duplicateCheckModal, setDuplicateCheckModal] = useState({ isOpen: false, message: '', customerData: null })
  const [duplicatePaymentModal, setDuplicatePaymentModal] = useState({ isOpen: false, amount: 0 })
  const pendingPaymentRef = useRef(null) // Store pending payment for duplicate confirm

  // Keyboard shortcuts refs
  const searchInputRef = useRef(null)

  // Separate form instances for customer and payment forms
  const customerForm = useForm()
  const paymentForm = useForm()

  const {
    register: customerRegister,
    handleSubmit: handleCustomerSubmit,
    reset: resetCustomerForm,
    setValue: setCustomerValue,
    watch: watchCustomer,
    formState: { errors: customerErrors }
  } = customerForm
  const addModalBranchId = watchCustomer('branchId')

  const {
    register: paymentRegister,
    handleSubmit: handlePaymentFormSubmit,
    reset: resetPaymentForm,
    setValue: setPaymentValue,
    watch: watchPayment,
    formState: { errors: paymentErrors }
  } = paymentForm

  const selectedSaleId = watchPayment('saleId')
  const selectedCustomerId = watchPayment('customerId')
  const [searchParams, setSearchParams] = useSearchParams()

  // ========== ALL HANDLER FUNCTIONS - DEFINED FIRST ==========
  // Excel Export Handler
  const handleExportExcel = () => {
    if (!selectedCustomer || customerLedger.length === 0) {
      toast.error('No data to export')
      return
    }

    try {
      // Filter by date range
      const filteredEntries = customerLedger.filter(entry => {
        const entryDate = new Date(entry.date)
        const fromDate = new Date(dateRange.from)
        const toDate = new Date(dateRange.to)
        toDate.setHours(23, 59, 59, 999)
        return entryDate >= fromDate && entryDate <= toDate
      })

      // Create CSV content
      const headers = ['Date', 'Type', 'Invoice No', 'Payment Mode', 'Debit (AED)', 'Credit (AED)', 'Status', 'Balance']
      const rows = filteredEntries.map(entry => {
        const dateStr = entry.type === 'Payment'
          ? new Date(entry.date).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })

        const debit = Number(entry.debit) || 0
        const credit = Number(entry.credit) || 0
        const balance = Number(entry.balance) || 0
        return [
          dateStr,
          entry.type || '',
          entry.reference || '-',
          entry.paymentMode || entry.PaymentMode || '-',
          debit > 0 ? debit.toFixed(2) : '',
          credit > 0 ? credit.toFixed(2) : '',
          (entry[STATUS_PROP] || '-'),
          balance.toFixed(2)
        ]
      })

      // Add closing balance row
      const lastBalance = filteredEntries.length > 0 ? filteredEntries[filteredEntries.length - 1].balance : 0
      const closingBalance = Number(lastBalance) || 0
      rows.push(['', '', '', '', '', '', 'Closing Balance', closingBalance.toFixed(2)])

      // Convert to CSV
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n')

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', `Ledger_${selectedCustomer.name}_${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      toast.success('Ledger exported to Excel successfully', { id: 'ledger-export', duration: 4000 })
    } catch (error) {
      console.error('Export error:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to export ledger')
    }
  }

  // Auto-apply filters with debounce (reduces API calls while user is selecting)
  const filterApplyTimeoutRef = useRef(null)
  const applyLedgerFilters = (immediate = false) => {
    if (filterApplyTimeoutRef.current) {
      clearTimeout(filterApplyTimeoutRef.current)
      filterApplyTimeoutRef.current = null
    }
    
    const applyFilters = () => {
      setDateRange({ from: filterDraft.from, to: filterDraft.to })
      setLedgerBranchId(filterDraft.branchId)
      setLedgerRouteId(filterDraft.routeId)
      setLedgerStaffId(filterDraft.staffId)
      const branchId = filterDraft.branchId || undefined
      const routeId = filterDraft.routeId || undefined
      if (branchId) {
        fetchCustomers({ branchId, routeId })
      } else if (isAdminOrOwner(user)) {
        fetchCustomers()
      }
      fetchCustomerSearch(searchTerm || '', 1, false)
    }
    
    if (immediate) {
      applyFilters()
    } else {
      // Debounce: auto-apply after 800ms of no changes
      filterApplyTimeoutRef.current = setTimeout(applyFilters, 800)
    }
  }

  // Auto-apply filters when filterDraft changes (debounced)
  useEffect(() => {
    if (selectedCustomer) {
      applyLedgerFilters(false)
    }
    return () => {
      if (filterApplyTimeoutRef.current) {
        clearTimeout(filterApplyTimeoutRef.current)
      }
    }
  }, [filterDraft.from, filterDraft.to, filterDraft.branchId, filterDraft.routeId, filterDraft.staffId])

  // Initial customer load: Owner/Admin get all; Staff get scoped list after default filter is set
  useEffect(() => {
    if (!user) return
    if (isAdminOrOwner(user)) {
      fetchCustomers()
    }
  }, [user])

  // CRITICAL: Branches/routes from context MUST be declared BEFORE useEffect hooks that use them
  // Move these declarations BEFORE any useEffect that references them to prevent TDZ errors
  const availableBranches = useMemo(() => branches || [], [branches])
  const availableRoutes = useMemo(() => routes || [], [routes])

  // Staff: load customers scoped to default (or current) branch/route once filter is set; if no assignments, show message
  useEffect(() => {
    if (!user || isAdminOrOwner(user)) return
    if (branchesRoutesLoading) return // Wait for branches/routes context to load before deciding
    if (availableBranches.length === 0 && availableRoutes.length === 0) {
      // Staff with no assignments - show helpful message
      setLoading(false)
      setCustomers([])
      if (staffHasNoAssignments) {
        toast.error('You have not been assigned to any branches or routes. Please contact your administrator.', { duration: 5000 })
      }
      return
    }
    let branchId = filterDraft.branchId || ledgerBranchId
    let routeId = filterDraft.routeId || ledgerRouteId
    // Staff with branches but no branch selected: auto-select first branch/route to break loading deadlock
    if (!branchId && (availableBranches.length > 0 || availableRoutes.length > 0)) {
      if (availableBranches.length > 0) {
        const firstBranch = availableBranches[0]
        const branchRoutes = availableRoutes.filter(r => r.branchId === firstBranch.id)
        branchId = String(firstBranch.id)
        routeId = routeId || (branchRoutes.length > 0 ? String(branchRoutes[0].id) : '')
      } else if (availableRoutes.length > 0) {
        const firstRoute = availableRoutes[0]
        branchId = firstRoute.branchId ? String(firstRoute.branchId) : ''
        routeId = String(firstRoute.id)
      }
      if (branchId || routeId) {
        setLedgerBranchId(branchId)
        setLedgerRouteId(routeId)
        setFilterDraft(prev => ({ ...prev, branchId, routeId }))
      }
    }
    if (branchId || routeId) {
      fetchCustomers({ branchId: branchId || undefined, routeId: routeId || undefined })
    }
  }, [user, filterDraft.branchId, filterDraft.routeId, ledgerBranchId, ledgerRouteId, availableBranches, availableRoutes, staffHasNoAssignments, branchesRoutesLoading])

  // Load customer from URL parameter
  useEffect(() => {
    const customerIdParam = searchParams.get('customerId')
    if (customerIdParam) {
      const customerId = parseInt(customerIdParam)
      if (!isNaN(customerId)) {
        const customer = customers.find(c => c.id === customerId)
        if (customer) {
          setSelectedCustomer(customer)
        } else if (customers.length > 0) {
          // Customer not found in list, try to fetch it
          customersAPI.getCustomer(customerId).then(response => {
            if (response?.success && response?.data) {
              setSelectedCustomer(response.data)
            }
          }).catch(err => console.error('Failed to load customer from URL:', err))
        }
      }
    }
  }, [searchParams, customers])

  // Load customer data when selected or date range changes (debounced to prevent excessive calls)
  useEffect(() => {
    if (selectedCustomer) {
      // Reset in-progress guard so date/customer changes always trigger a fresh load
      ledgerLoadInProgressRef.current = null
      const timeoutId = setTimeout(() => {
        loadCustomerData(selectedCustomer.id)
      }, 300) // 300ms debounce
      return () => clearTimeout(timeoutId)
    }
  }, [selectedCustomer?.id, dateRange.from, dateRange.to])

  // Load staff users only (branches/routes from shared context)
  useEffect(() => {
    const load = async () => {
      try {
        if (isAdminOrOwner(user)) {
          const uRes = await adminAPI.getUsers().catch(() => ({ success: false }))
          if (uRes?.success && uRes?.data) {
            const staffList = Array.isArray(uRes.data) ? uRes.data : (uRes.data?.items || [])
            setStaffUsers(staffList)
          }
        } else if (user) {
          setStaffUsers([user])
        }
        setStaffAssignmentsLoaded(true)
      } catch (err) {
        console.error('Failed to load staff users:', err)
        setStaffAssignmentsLoaded(true)
      }
    }
    load()
  }, [user])

  const availableStaff = useMemo(() => {
    if (!user) return []
    if (isAdminOrOwner(user)) return staffUsers
    // Staff can only see themselves
    return staffUsers.filter(u => u.id === user.id)
  }, [staffUsers, user])

  // Auto-select filters for Staff: default to first assigned branch and first route of that branch
  useEffect(() => {
    if (user && !isAdminOrOwner(user) && !loading) {
      if (!ledgerBranchId && availableBranches.length > 0) {
        const branchIdStr = availableBranches[0].id.toString()
        const branchRoutes = availableRoutes.filter(r => r.branchId === availableBranches[0].id)
        const routeIdStr = branchRoutes.length > 0 ? branchRoutes[0].id.toString() : ''
        setLedgerBranchId(branchIdStr)
        setLedgerRouteId(routeIdStr)
        setFilterDraft(prev => ({ ...prev, branchId: branchIdStr, routeId: routeIdStr }))
      }
      // NOTE: Do NOT auto-set staffId for staff users. Staff should see ALL customer transactions
      // (from any creator). The staffId filter is only for admin/owner to filter by specific staff.
    }
  }, [user, availableBranches, availableRoutes, ledgerBranchId, ledgerRouteId, ledgerStaffId, loading])

  // Auto-fill branch/route from selected customer (Staff and Owner) - when customer selected, set filters
  useEffect(() => {
    if (!selectedCustomer?.id) return
    if (availableBranches.length === 0 || availableRoutes.length === 0) return
    const bid = selectedCustomer.branchId != null ? Number(selectedCustomer.branchId) : null
    const rid = selectedCustomer.routeId != null ? Number(selectedCustomer.routeId) : null
    if (bid != null && availableBranches.some(b => b.id === bid)) {
      setLedgerBranchId(String(bid))
      setFilterDraft(prev => ({ ...prev, branchId: String(bid) }))
    }
    if (rid != null && availableRoutes.some(r => r.id === rid)) {
      setLedgerRouteId(String(rid))
      setFilterDraft(prev => ({ ...prev, routeId: String(rid) }))
    }
  }, [selectedCustomer?.id, selectedCustomer?.branchId, selectedCustomer?.routeId, availableBranches, availableRoutes])

  // If customer selected but has no branchId/routeId, fetch full customer and set branch/route
  useEffect(() => {
    if (!selectedCustomer?.id) return
    if (selectedCustomer.id === 'cash' || selectedCustomer.id === 0) return // Cash customer has no DB record
    if (selectedCustomer.branchId != null || selectedCustomer.routeId != null) return
    let cancelled = false
    customersAPI.getCustomer(selectedCustomer.id)
      .then(res => {
        if (cancelled) return
        const data = res?.data ?? res
        if (!data?.id || (data.branchId == null && data.routeId == null)) return
        const bid = data.branchId != null ? Number(data.branchId) : null
        const rid = data.routeId != null ? Number(data.routeId) : null
        if (bid != null && availableBranches.some(b => b.id === bid)) {
          setLedgerBranchId(String(bid))
          setFilterDraft(prev => ({ ...prev, branchId: String(bid) }))
        }
        if (rid != null && availableRoutes.some(r => r.id === rid)) {
          setLedgerRouteId(String(rid))
          setFilterDraft(prev => ({ ...prev, routeId: String(rid) }))
        }
        setSelectedCustomer(prev => prev && prev.id === data.id ? { ...prev, branchId: data.branchId, routeId: data.routeId } : prev)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedCustomer?.id, availableBranches, availableRoutes])

  // Refresh data when window regains focus or when data is updated (e.g., returning from POS edit, payment made)
  useEffect(() => {
    const handleRefresh = () => {
      if (selectedCustomer) {
        ledgerLoadInProgressRef.current = null
        loadCustomerData(selectedCustomer.id)
        fetchCustomers()
      }
    }
    window.addEventListener('focus', handleRefresh)
    window.addEventListener('dataUpdated', handleRefresh)
    window.addEventListener('paymentCreated', handleRefresh)
    return () => {
      window.removeEventListener('focus', handleRefresh)
      window.removeEventListener('dataUpdated', handleRefresh)
      window.removeEventListener('paymentCreated', handleRefresh)
    }
  }, [selectedCustomer])

  // Server-side search for customer dropdown (debounced)
  const fetchCustomerSearch = useCallback(async (query, page = 1, append = false) => {
    setSearchDropdownLoading(true)
    try {
      const params = {
        page,
        pageSize: CUSTOMER_SEARCH_PAGE_SIZE,
        branchId: filterDraft.branchId ? parseInt(filterDraft.branchId, 10) : undefined,
        routeId: filterDraft.routeId ? parseInt(filterDraft.routeId, 10) : undefined
      }
      if (query && query.trim()) params.search = query.trim()
      const res = await customersAPI.getCustomers(params)
      const items = res?.data?.items ?? res?.items ?? []
      const total = res?.data?.totalCount ?? res?.totalCount ?? items.length
      setSearchDropdownTotal(total)
      setSearchDropdownPage(page)
      setSearchDropdownResults(append ? prev => [...prev, ...items] : items)
    } catch (err) {
      if (!err?._handledByInterceptor) toast.error('Failed to search customers')
      setSearchDropdownResults(append ? prev => prev : [])
    } finally {
      setSearchDropdownLoading(false)
    }
  }, [filterDraft.branchId, filterDraft.routeId])

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!searchTerm?.trim()) {
      fetchCustomerSearch('', 1, false)
      return
    }
    searchDebounceRef.current = setTimeout(() => {
      fetchCustomerSearch(searchTerm, 1, false)
    }, 300)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchTerm, filterDraft.branchId, filterDraft.routeId, fetchCustomerSearch])

  // Keep filterCustomers for any legacy usage; sync filteredCustomers from searchDropdownResults when dropdown visible
  useEffect(() => {
    filterCustomers()
  }, [customers, searchTerm])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // F2 - Focus search
      if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      // F4 - Add Payment
      if (e.key === 'F4' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        if (selectedCustomer) {
          setShowPaymentModal(true)
        }
      }
      // F5 - View Statement
      if (e.key === 'F5' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        if (selectedCustomer) {
          handleExportStatement()
        }
      }
      // F7 - Export PDF
      if (e.key === 'F7' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        if (selectedCustomer) {
          handleExportPDF()
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [selectedCustomer])

  const fetchCustomers = async (opts = {}) => {
    try {
      setLoading(true)
      const params = { page: 1, pageSize: 1000 }
      if (opts.branchId) params.branchId = typeof opts.branchId === 'number' ? opts.branchId : parseInt(opts.branchId, 10)
      if (opts.routeId) params.routeId = typeof opts.routeId === 'number' ? opts.routeId : parseInt(opts.routeId, 10)
      const response = await customersAPI.getCustomers(params)
      if (response.success && response.data) {
        setCustomers(response.data.items || [])
      }
    } catch (error) {
      console.error('Failed to load customers:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to load customers')
    } finally {
      setLoading(false)
    }
  }

  const filterCustomers = () => {
    let filtered = customers
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(c =>
        c.name?.toLowerCase().includes(term) ||
        c.phone?.includes(term) ||
        c.trn?.toLowerCase().includes(term) ||
        c.address?.toLowerCase().includes(term)
      )
    }
    setFilteredCustomers(filtered)
  }

  // ============================================================================
  // DATA VALIDATION & RECONCILIATION FUNCTIONS - GUARANTEE REAL DATA INTEGRITY
  // ============================================================================

  /**
   * Validate and reconcile customer data to ensure 100% accuracy
   * Returns validation report with any discrepancies found
   */
  const validateAndReconcileCustomerData = async (customerId, ledgerData, invoicesData, paymentsData, customerData) => {
    const validationReport = {
      isValid: true,
      errors: [],
      warnings: [],
      discrepancies: []
    }

    try {
      // 1. VALIDATE CUSTOMER ID CONSISTENCY
      if (!customerId || customerId <= 0) {
        validationReport.isValid = false
        validationReport.errors.push('Invalid customer ID')
        return validationReport
      }

      // 2. VALIDATE ALL INVOICES BELONG TO CUSTOMER
      const invalidInvoices = invoicesData.filter(inv => {
        const invCustomerId = inv.customerId || inv.customerID
        return invCustomerId !== customerId &&
          parseInt(invCustomerId) !== parseInt(customerId)
      })
      if (invalidInvoices.length > 0) {
        validationReport.isValid = false
        validationReport.errors.push(`${invalidInvoices.length} invoice(s) do not belong to customer ${customerId}`)
        validationReport.discrepancies.push({
          type: 'INVOICE_MISMATCH',
          count: invalidInvoices.length,
          details: invalidInvoices.map(inv => ({ id: inv.id, invoiceNo: inv.invoiceNo, customerId: inv.customerId }))
        })
      }

      // 3. VALIDATE ALL PAYMENTS BELONG TO CUSTOMER
      const invalidPayments = paymentsData.filter(p => {
        const paymentCustomerId = p.customerId || p.customerID
        return paymentCustomerId !== customerId &&
          parseInt(paymentCustomerId) !== parseInt(customerId)
      })
      if (invalidPayments.length > 0) {
        validationReport.isValid = false
        validationReport.errors.push(`${invalidPayments.length} payment(s) do not belong to customer ${customerId}`)
        validationReport.discrepancies.push({
          type: 'PAYMENT_MISMATCH',
          count: invalidPayments.length,
          details: invalidPayments.map(p => ({ id: p.id, amount: p.amount, customerId: p.customerId }))
        })
      }

      // 4. RECONCILE BALANCE - Calculate from actual transactions
      if (customerData) {
        const calculatedTotalSales = invoicesData.reduce((sum, inv) => sum + (parseFloat(inv.grandTotal) || 0), 0)
        const calculatedTotalPayments = paymentsData.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)
        const calculatedBalance = calculatedTotalSales - calculatedTotalPayments
        const storedBalance = parseFloat(customerData.balance) || 0

        // Allow small rounding differences (0.01)
        const balanceDifference = Math.abs(calculatedBalance - storedBalance)
        if (balanceDifference > 0.01) {
          validationReport.warnings.push(`Balance discrepancy detected: Calculated=${calculatedBalance.toFixed(2)}, Stored=${storedBalance.toFixed(2)}, Difference=${balanceDifference.toFixed(2)}`)
          validationReport.discrepancies.push({
            type: 'BALANCE_MISMATCH',
            calculated: calculatedBalance,
            stored: storedBalance,
            difference: balanceDifference
          })
        }
      }

      // 5. VALIDATE PAYMENT-INVOICE LINKAGE
      const paymentInvoiceMismatches = []
      paymentsData.forEach(payment => {
        if (payment.saleId || payment.invoiceId) {
          const linkedInvoiceId = payment.saleId || payment.invoiceId
          const linkedInvoice = invoicesData.find(inv => inv.id === linkedInvoiceId)
          if (linkedInvoice) {
            // Verify payment customer matches invoice customer
            const paymentCustomerId = payment.customerId || payment.customerID
            const invoiceCustomerId = linkedInvoice.customerId || linkedInvoice.customerID
            if (paymentCustomerId !== invoiceCustomerId &&
              parseInt(paymentCustomerId) !== parseInt(invoiceCustomerId)) {
              paymentInvoiceMismatches.push({
                paymentId: payment.id,
                invoiceId: linkedInvoiceId,
                paymentCustomerId,
                invoiceCustomerId
              })
            }
          }
        }
      })
      if (paymentInvoiceMismatches.length > 0) {
        validationReport.warnings.push(`${paymentInvoiceMismatches.length} payment-invoice linkage mismatch(es)`)
        validationReport.discrepancies.push({
          type: 'PAYMENT_INVOICE_LINKAGE_MISMATCH',
          count: paymentInvoiceMismatches.length,
          details: paymentInvoiceMismatches
        })
      }

      // 6. VALIDATE LEDGER ENTRIES CONSISTENCY
      if (ledgerData && ledgerData.length > 0) {
        const ledgerTotalDebit = ledgerData.reduce((sum, entry) => sum + (parseFloat(entry.debit) || 0), 0)
        const ledgerTotalCredit = ledgerData.reduce((sum, entry) => sum + (parseFloat(entry.credit) || 0), 0)
        const invoiceTotal = invoicesData.reduce((sum, inv) => sum + (parseFloat(inv.grandTotal) || 0), 0)
        const paymentTotal = paymentsData.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)

        // Ledger debit should match invoice total (within rounding)
        const debitDifference = Math.abs(ledgerTotalDebit - invoiceTotal)
        if (debitDifference > 0.01) {
          validationReport.warnings.push(`Ledger debit mismatch: Ledger=${ledgerTotalDebit.toFixed(2)}, Invoices=${invoiceTotal.toFixed(2)}`)
        }

        // Ledger credit should match payment total (within rounding)
        const creditDifference = Math.abs(ledgerTotalCredit - paymentTotal)
        if (creditDifference > 0.01) {
          validationReport.warnings.push(`Ledger credit mismatch: Ledger=${ledgerTotalCredit.toFixed(2)}, Payments=${paymentTotal.toFixed(2)}`)
        }
      }

      console.log('Data validation completed:', validationReport)
      return validationReport
    } catch (error) {
      console.error('Error during data validation:', error)
      validationReport.isValid = false
      validationReport.errors.push(`Validation error: ${error.message}`)
      return validationReport
    }
  }

  /**
   * Recalculate and verify customer balance from real data
   * CRITICAL: Prevents duplicate calls for same customer
   */
  const recalculateCustomerBalance = async (customerId) => {
    // Prevent duplicate calls for same customer
    if (recalculateInProgress.current.has(customerId)) {
      console.log(`Balance recalculation already in progress for customer ${customerId}`)
      return { success: false, message: 'Recalculation already in progress' }
    }

    recalculateInProgress.current.add(customerId)

    try {
      const response = await customersAPI.recalculateBalance(customerId)
      if (response.success) {
        console.log(`Balance recalculated for customer ${customerId}`)
        return { success: true, message: 'Balance recalculated successfully' }
      } else {
        // Don't log errors repeatedly
        if (!response._logged) {
          console.error('Balance recalculation failed:', response.message)
          response._logged = true
        }
        return { success: false, message: response.message || 'Failed to recalculate balance' }
      }
    } catch (error) {
      // Don't log 429 errors repeatedly
      if (error?.response?.status !== 429 && !error?._logged) {
        console.error('Error recalculating balance:', error)
        error._logged = true
      }
      return { success: false, message: error.message || 'Error recalculating balance' }
    } finally {
      setTimeout(() => {
        recalculateInProgress.current.delete(customerId)
      }, 1000)
    }
  }

  /**
   * Verify payment data integrity
   */
  const verifyPaymentIntegrity = (payments, invoices) => {
    const issues = []

    payments.forEach(payment => {
      // Check payment amount is positive
      if (parseFloat(payment.amount) <= 0) {
        issues.push({ type: 'INVALID_AMOUNT', paymentId: payment.id, amount: payment.amount })
      }

      // Check payment date is valid
      if (!payment.paymentDate || isNaN(new Date(payment.paymentDate).getTime())) {
        issues.push({ type: 'INVALID_DATE', paymentId: payment.id })
      }

      // If payment is linked to invoice, verify invoice exists and amount doesn't exceed invoice total
      if (payment.saleId || payment.invoiceId) {
        const linkedInvoiceId = payment.saleId || payment.invoiceId
        const linkedInvoice = invoices.find(inv => inv.id === linkedInvoiceId)
        if (!linkedInvoice) {
          issues.push({ type: 'MISSING_INVOICE', paymentId: payment.id, invoiceId: linkedInvoiceId })
        } else {
          const invoiceOutstanding = parseFloat(linkedInvoice.grandTotal) - (parseFloat(linkedInvoice.paidAmount) || 0)
          if (parseFloat(payment.amount) > invoiceOutstanding + 0.01) { // Allow small rounding
            issues.push({
              type: 'PAYMENT_EXCEEDS_OUTSTANDING',
              paymentId: payment.id,
              paymentAmount: payment.amount,
              invoiceOutstanding: invoiceOutstanding
            })
          }
        }
      }
    })

    return {
      isValid: issues.length === 0,
      issues
    }
  }

  const loadCustomerData = async (customerId) => {
    // Handle cash customer (customerId is null or special flag)
    const isCashCustomer = !customerId || customerId === 'cash' || customerId === 0

    // RISK-2 FIX: Block load when payment is in progress — prevents race where older load overwrites newer balance
    if (!isCashCustomer && paymentLoadingRef.current) {
      return
    }

    // RISK-2: Serialize ledger loads — prevent concurrent loads for same customer (older response overwriting newer)
    const loadKey = isCashCustomer ? 'cash' : String(customerId)
    if (ledgerLoadInProgressRef.current === loadKey) {
      return
    }
    ledgerLoadInProgressRef.current = loadKey

    if (isCashCustomer) {
      // Load cash customer ledger, invoices, and payments
      try {
        setLoading(true)
        setCustomerLedger([])
        setCustomerInvoices([])
        setCustomerPayments([])
        setOutstandingInvoices([])
        setCustomerSummary(null)

        // First, recalculate cash customer invoice statuses to fix any stale data
        try {
          await customersAPI.recalculateBalance('cash')
        } catch (recalcError) {
          // Silently ignore - this is just a fix-up operation
          console.log('Cash customer recalculate skipped:', recalcError?.message)
        }

        // Load ledger, sales, and payments in parallel
        const [ledgerRes, salesRes, paymentsRes] = await Promise.all([
          customersAPI.getCashCustomerLedger(),
          salesAPI.getSales({ page: 1, pageSize: 1000 }),
          paymentsAPI.getPayments({ page: 1, pageSize: 1000 }) // Get all payments
        ])

        if (ledgerRes.success && ledgerRes.data) {
          const ledgerData = (Array.isArray(ledgerRes.data) ? ledgerRes.data : []).map(entry => ({
            ...entry,
            debit: Number(entry.debit) || 0,
            credit: Number(entry.credit) || 0,
            balance: Number(entry.balance) || 0
          }))
          setCustomerLedger(ledgerData)
        }

        // Load cash customer sales (where customerId is null)
        if (salesRes.success && salesRes.data) {
          const allSales = salesRes.data.items || []
          const cashSales = allSales.filter(sale => !sale.customerId)
          setCustomerInvoices(cashSales)

          // Calculate outstanding invoices for cash customer
          const outstanding = cashSales.filter(sale => {
            const paid = sale.paidAmount || 0
            const total = sale.grandTotal || 0
            return paid < total
          })
          setOutstandingInvoices(outstanding)
        }

        // CRITICAL: Load cash customer payments (where customerId is null)
        if (paymentsRes.success && paymentsRes.data) {
          const allPayments = paymentsRes.data.items || []
          // Filter for cash customer payments (customerId is null or missing)
          const cashPayments = allPayments.filter(payment => {
            const paymentCustomerId = payment.customerId || payment.customerID
            return !paymentCustomerId || paymentCustomerId === null || paymentCustomerId === 0
          }).filter(p => {
            // Also filter by date range
            const paymentDate = new Date(p.paymentDate)
            const fromDate = new Date(dateRange.from)
            const toDate = new Date(dateRange.to)
            toDate.setHours(23, 59, 59, 999)
            return paymentDate >= fromDate && paymentDate <= toDate
          })
          setCustomerPayments(cashPayments)
          console.log(`Loaded ${cashPayments.length} cash customer payments`)
        }

        setCustomerSummary({
          totalDebit: ledgerRes.data?.reduce((sum, e) => sum + (e.debit || 0), 0) || 0,
          totalCredit: ledgerRes.data?.reduce((sum, e) => sum + (e.credit || 0), 0) || 0,
          balance: 0 // Cash customers always have 0 balance
        })
      } catch (error) {
        console.error('Failed to load cash customer data:', error)
        if (!error?._handledByInterceptor) toast.error('Failed to load cash customer ledger')
      } finally {
        ledgerLoadInProgressRef.current = null
        setLoading(false)
      }
      return
    }

    // CRITICAL: Validate customerId matches selected customer to prevent data mismatches
    if (!customerId || customerId <= 0) {
      console.error('Invalid customer ID:', customerId)
      ledgerLoadInProgressRef.current = null
      return
    }

    // Double-check that we're still loading for the same customer
    if (selectedCustomer && selectedCustomer.id !== customerId) {
      console.warn('Customer changed during load, aborting data load for customer:', customerId)
      ledgerLoadInProgressRef.current = null
      return
    }

    try {
      setLoading(true)

      // Clear data first to prevent showing stale data
      setCustomerLedger([])
      setCustomerInvoices([])
      setCustomerPayments([])
      setOutstandingInvoices([])
      setCustomerSummary(null)

      // Load all data in parallel
      // CRITICAL: Use Reports API which properly filters by customerId on backend
      // This ensures ALL customer invoices are retrieved, not just first 1000 from entire database
      // CRITICAL: Do NOT pass branchId/routeId/staffId - always fetch full ledger.
      // Passing them filters out sales with different/null branch - causes "No transactions found"
      // when customer has data under multiple branches or legacy null BranchId.
      const [ledgerRes, invoicesRes, outstandingRes, customerRes] = await Promise.all([
        customersAPI.getCustomerLedger(customerId, {
          fromDate: dateRange.from,
          toDate: dateRange.to
          // branchId, routeId, staffId intentionally omitted - full ledger
        }),
        reportsAPI.getSalesReport({
          page: 1,
          pageSize: 1000,
          customerId,
          fromDate: dateRange.from,
          toDate: dateRange.to
        }),
        customersAPI.getOutstandingInvoices(customerId),
        customersAPI.getCustomer(customerId)
      ])

      // CRITICAL: Verify we're still loading for the same customer after API calls
      if (selectedCustomer && selectedCustomer.id !== customerId) {
        console.warn('Customer changed after API calls, discarding data for customer:', customerId)
        ledgerLoadInProgressRef.current = null
        return
      }

      let ledgerData = []
      let invoicesData = []
      let outstandingData = []

      if (ledgerRes.success && ledgerRes.data) {
        ledgerData = Array.isArray(ledgerRes.data) ? ledgerRes.data : []
        // Normalize numeric fields to prevent NaN - backend may return null/undefined
        const validLedgerData = ledgerData.map(entry => ({
          ...entry,
          debit: Number(entry.debit) || 0,
          credit: Number(entry.credit) || 0,
          balance: Number(entry.balance) || 0
        }))
        setCustomerLedger(validLedgerData)
      }

      if (invoicesRes.success && invoicesRes.data) {
        const sales = invoicesRes.data.items || []
        // CRITICAL: Validate all invoices belong to this customer
        const validSales = sales.filter(sale => {
          // Ensure sale belongs to this customer
          return sale.customerId === customerId || sale.customerId === parseInt(customerId)
        })
        // Backend already filters by date range, so use validSales directly
        invoicesData = validSales
        setCustomerInvoices(invoicesData)
      }

      if (outstandingRes.success && outstandingRes.data) {
        outstandingData = Array.isArray(outstandingRes.data) ? outstandingRes.data : []
        // Validate outstanding invoices belong to this customer
        const validOutstanding = outstandingData.filter(inv => {
          return inv.customerId === customerId || inv.customerId === parseInt(customerId)
        })
        setOutstandingInvoices(validOutstanding)
      }

      if (customerRes.success && customerRes.data) {
        const customer = customerRes.data
        // Calculate summary using FRESH data filtered by date range (matching what's shown in tabs)
        // Filter ledger data by date range for accurate calculations
        const filteredLedgerData = ledgerData.filter(entry => {
          const entryDate = new Date(entry.date)
          const fromDate = new Date(dateRange.from)
          const toDate = new Date(dateRange.to)
          toDate.setHours(23, 59, 59, 999)
          return entryDate >= fromDate && entryDate <= toDate
        })

        // Calculate totals from filtered ledger data (matching LedgerStatementTab logic)
        // IMPORTANT: Only count invoice/sale debits as Total Sales, exclude refunds/other debits
        const totalSales = filteredLedgerData
          .filter(entry => entry.type === 'Invoice' || entry.type === 'Sale')
          .reduce((sum, entry) => sum + (Number(entry.debit) || 0), 0)
        const totalPayments = filteredLedgerData
          .filter(entry => entry.type === 'Payment')
          .reduce((sum, entry) => sum + (Number(entry.credit) || 0), 0)

        // Outstanding is the difference between sales and payments in the date range
        let outstanding = Number(totalSales) - Number(totalPayments)
        if (isNaN(outstanding)) outstanding = 0

        // Also store the customer's overall balance for reference
        let customerBalance = Number(customer.balance) || 0
        if (isNaN(customerBalance)) customerBalance = 0

        setCustomerSummary({
          totalSales,
          totalPayments,
          outstanding,
          customerBalance, // Store overall balance separately
          customer
        })
        // RISK-2: Update selectedCustomer with fresh balance so UI shows correct value
        if (selectedCustomer && selectedCustomer.id === customerId) {
          setSelectedCustomer(prev => prev ? { ...prev, balance: customerBalance } : prev)
        }
      }

      // Load payments separately
      const paymentsRes = await paymentsAPI.getPayments({ page: 1, pageSize: 1000, customerId })

      // CRITICAL: Verify we're still loading for the same customer after payment API call
      if (selectedCustomer && selectedCustomer.id !== customerId) {
        console.warn('Customer changed after payment API call, discarding data for customer:', customerId)
        ledgerLoadInProgressRef.current = null
        return
      }

      if (paymentsRes.success && paymentsRes.data) {
        const allPayments = paymentsRes.data.items || []
        // CRITICAL: Strictly filter payments by customerId to prevent mismatches
        const customerPayments = allPayments
          .filter(p => {
            // Ensure payment belongs to this customer (check both string and number)
            const paymentCustomerId = p.customerId || p.customerID
            return paymentCustomerId === customerId ||
              paymentCustomerId === parseInt(customerId) ||
              parseInt(paymentCustomerId) === parseInt(customerId)
          })
          .filter(p => {
            const paymentDate = new Date(p.paymentDate)
            const fromDate = new Date(dateRange.from)
            const toDate = new Date(dateRange.to)
            toDate.setHours(23, 59, 59, 999)
            return paymentDate >= fromDate && paymentDate <= toDate
          })
        setCustomerPayments(customerPayments)

        // SILENT VALIDATION: Only log errors, don't show toast floods
        // Only validate and show errors during manual reconciliation or critical operations
        const validationReport = await validateAndReconcileCustomerData(
          customerId,
          ledgerData,
          invoicesData,
          customerPayments,
          customerRes.success ? customerRes.data : null
        )

        // ONLY log validation errors to console - don't show toasts on every load
        if (!validationReport.isValid && validationReport.errors.length > 0) {
          console.error('DATA VALIDATION ERRORS:', validationReport.errors)
          // Don't show toast - this floods the UI on every refresh
          // Only auto-fix if it's a critical error (not just warnings)
        } else if (validationReport.warnings.length > 0) {
          console.warn('Data validation warnings:', validationReport.warnings)
          // Don't show toast or auto-recalculate - this causes refresh loops
        }

        // SILENT PAYMENT INTEGRITY CHECK - only log, don't show toast
        const paymentIntegrity = verifyPaymentIntegrity(customerPayments, invoicesData)
        if (!paymentIntegrity.isValid) {
          console.warn('Payment integrity issues:', paymentIntegrity.issues)
          // Don't show toast - this message is confusing and floods on every load
          // User can manually reconcile if needed using the Reconcile button
        }
      }
    } catch (error) {
      // CRITICAL: Prevent error flooding - only show error once
      if (!error._logged) {
        console.error('Failed to load customer data:', error)
        error._logged = true

        // Only show error if it's not a 429 (rate limit) or throttled request, and not already shown by interceptor
        if (error?.response?.status !== 429 && !error?.isThrottled && !error?.isRateLimited && !error?._handledByInterceptor) {
          toast.error('Failed to load customer data')
        }
      }

      // CRITICAL: Don't auto-retry on 429 errors - this causes infinite loops
      if (error?.response?.status === 429 || error?.isThrottled || error?.isRateLimited) {
        // Rate limited - don't retry automatically
        return
      }

      // CRITICAL: Prevent infinite retry loops - only retry once per error
      // Only attempt recovery for 500 errors, and only once
      if (error?.response?.status === 500 && !error._retryAttempted && !error._recoveryAttempted) {
        error._retryAttempted = true
        error._recoveryAttempted = true
        try {
          await recalculateCustomerBalance(customerId)
          // Retry after delay, but only once and only if still same customer
          setTimeout(() => {
            if (selectedCustomer && selectedCustomer.id === customerId && ledgerLoadInProgressRef.current !== loadKey) {
              loadCustomerData(customerId)
            }
          }, 5000) // 5 second delay before retry (increased to prevent flooding)
        } catch (recoveryError) {
          // Don't log recovery errors to prevent flooding
          if (!recoveryError._logged) {
            console.error('Recovery failed:', recoveryError)
            recoveryError._logged = true
          }
        }
      }
    } finally {
      ledgerLoadInProgressRef.current = null
      setLoading(false)
    }
  }

  const handleSelectCustomer = (customer) => {
    // CRITICAL: Clear all customer data when switching customers to prevent data mismatches
    setCustomerLedger([])
    setCustomerInvoices([])
    setCustomerPayments([])
    setOutstandingInvoices([])
    setCustomerSummary(null)
    setSelectedCustomer(customer)
    setSearchTerm('')
  }

  const doCreateCustomer = async (customerData) => {
    customerLoadingRef.current = true
    setCustomerLoading(true)
    try {
      const response = await customersAPI.createCustomer(customerData)
      if (response?.success) {
        toast.success('Customer added successfully!', { id: 'customer-add', duration: 4000 })
        setShowAddCustomerModal(false)
        setDuplicateCheckModal({ isOpen: false, message: '', customerData: null })
        resetCustomerForm()
        await Promise.all([
          fetchCustomers(),
          response?.data ? loadCustomerData(response.data.id) : Promise.resolve()
        ])
        if (response?.data) {
          setSelectedCustomer(response.data)
          setSearchTerm('')
        }
        window.dispatchEvent(new CustomEvent('customerCreated', { detail: response.data }))
        window.dispatchEvent(new CustomEvent('dataUpdated'))
        if (response?.data?.id) setSearchParams({ customerId: response.data.id })
      } else {
        toast.error(response?.message || 'Failed to create customer', { id: 'customer-add-error' })
      }
    } catch (error) {
      const errorMessage = error?.response?.data?.message ||
        (Array.isArray(error?.response?.data?.errors) ? error.response.data.errors.join(', ') : '') ||
        error?.message || 'Failed to create customer'
      if (!error?._handledByInterceptor) toast.error(errorMessage)
    } finally {
      customerLoadingRef.current = false
      setCustomerLoading(false)
    }
  }

  const handleAddCustomer = async (data) => {
    // Prevent multiple submissions using ref (synchronous check)
    if (customerLoadingRef.current || customerLoading) {
      console.log('Customer creation already in progress, ignoring duplicate submission')
      toast.error('Please wait, customer creation in progress...')
      return
    }

    if (!data || !data.name) {
      console.error('Customer data validation failed:', data)
      toast.error('Customer name is required')
      return
    }

    // Set loading state IMMEDIATELY (both ref and state)
    customerLoadingRef.current = true
    setCustomerLoading(true)

    try {
      // Ensure creditLimit is a number
      const customerData = {
        name: data.name?.trim() || '',
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        trn: data.trn?.trim() || null,
        address: data.address?.trim() || null,
        creditLimit: data.creditLimit ? parseFloat(data.creditLimit) : 0,
        paymentTerms: data.paymentTerms?.trim() || null,
        branchId: data.branchId ? parseInt(data.branchId, 10) : null,
        routeId: data.routeId ? parseInt(data.routeId, 10) : null
      }

      // Validate required field
      if (!customerData.name) {
        toast.error('Customer name is required')
        customerLoadingRef.current = false
        setCustomerLoading(false) // Reset loading state on validation error
        return
      }

      // Duplicate check: warn if another customer has same phone or email
      if (customerData.phone || customerData.email) {
        try {
          const res = await customersAPI.getCustomers({ pageSize: 200 })
          const list = res?.data?.items ?? res?.items ?? []
          const phoneMatch = customerData.phone && list.find(c => (c.phone || '').replace(/\s/g, '') === (customerData.phone || '').replace(/\s/g, ''))
          const emailMatch = customerData.email && list.find(c => (c.email || '').toLowerCase().trim() === (customerData.email || '').toLowerCase().trim())
          if (phoneMatch || emailMatch) {
            const msg = phoneMatch && emailMatch
              ? `Another customer (${phoneMatch.name}) has this phone and email. Add anyway?`
              : phoneMatch
                ? `Another customer (${phoneMatch.name}) has this phone number. Add anyway?`
                : `Another customer (${emailMatch.name}) has this email. Add anyway?`
            customerLoadingRef.current = false
            setCustomerLoading(false)
            setDuplicateCheckModal({ isOpen: true, message: msg, customerData })
            return
          }
        } catch (_) { /* Ignore duplicate check errors */ }
      }

      await doCreateCustomer(customerData)
    } catch (error) {
      console.error('Failed to create customer - Full error:', error)
      console.error('Error response:', error?.response)
      const errorMessage = error?.response?.data?.message ||
        (Array.isArray(error?.response?.data?.errors) ? error.response.data.errors.join(', ') : '') ||
        error?.message ||
        'Failed to create customer'
      if (!error?._handledByInterceptor) toast.error(errorMessage)
    } finally {
      // Reset loading state (both ref and state)
      customerLoadingRef.current = false
      setCustomerLoading(false)
    }
  }

  const handleEditCustomer = async (data) => {
    if (!editingCustomer || !editingCustomer.id) {
      toast.error('No customer selected for editing')
      return
    }

    customerLoadingRef.current = true
    setCustomerLoading(true)

    try {
      const customerData = {
        name: data.name?.trim() || '',
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        trn: data.trn?.trim() || null,
        address: data.address?.trim() || null,
        creditLimit: data.creditLimit ? parseFloat(data.creditLimit) : 0,
        paymentTerms: data.paymentTerms?.trim() || null,
        branchId: data.branchId ? parseInt(data.branchId, 10) : null,
        routeId: data.routeId ? parseInt(data.routeId, 10) : null
      }

      if (!customerData.name) {
        toast.error('Customer name is required')
        customerLoadingRef.current = false
        setCustomerLoading(false)
        return
      }

      const response = await customersAPI.updateCustomer(editingCustomer.id, customerData)

      if (response?.success) {
        toast.success('Customer updated successfully!', { id: 'customer-update', duration: 4000 })
        setShowEditCustomerModal(false)
        setEditingCustomer(null)
        resetCustomerForm()

        // Refresh data
        await Promise.all([
          fetchCustomers(),
          loadCustomerData(editingCustomer.id)
        ])

        // Update selected customer with new data
        if (response?.data) {
          setSelectedCustomer(response.data)
        }

        window.dispatchEvent(new CustomEvent('customerUpdated', { detail: response.data }))
        window.dispatchEvent(new CustomEvent('dataUpdated'))
      } else {
        toast.error(response?.message || 'Failed to update customer', { id: 'customer-update-error' })
      }
    } catch (error) {
      console.error('Failed to update customer:', error)
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to update customer'
      if (!error?._handledByInterceptor) toast.error(errorMessage)
    } finally {
      customerLoadingRef.current = false
      setCustomerLoading(false)
    }
  }

  /**
   * Manual reconciliation function - user can trigger to verify and fix data
   */
  const handleManualReconciliation = async () => {
    if (!selectedCustomer) {
      toast.error('Please select a customer first')
      return
    }

    const customerId = selectedCustomer.id
    toast.loading('Validating and reconciling data...', { id: 'reconciliation' })

    try {
      // First recalculate balance from backend
      const recalcResult = await recalculateCustomerBalance(customerId)

      if (recalcResult.success) {
        // Reload all data
        await loadCustomerData(customerId)
        toast.success('Data reconciled successfully!', { id: 'reconciliation' })
      } else {
        toast.error(`Reconciliation failed: ${recalcResult.message}`, { id: 'reconciliation' })
      }
    } catch (error) {
      console.error('Reconciliation error:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to reconcile data', { id: 'reconciliation' })
    }
  }

  const handlePaymentSubmit = async (data) => {
    if (paymentLoadingRef.current || paymentLoading) return
    if (!selectedCustomer) {
      toast.error('Please select a customer first')
      return
    }

    paymentLoadingRef.current = true
    setPaymentLoading(true)

    const idempotencyKey = crypto.randomUUID()
    const amount = parseFloat(data.amount)
    if (!amount || amount <= 0 || isNaN(amount) || !isFinite(amount)) {
      toast.error('Please enter a valid payment amount greater than 0')
      paymentLoadingRef.current = false
      setPaymentLoading(false)
      return
    }
    if (amount > 10000000) {
      toast.error('Payment amount exceeds maximum limit (10,000,000)')
      paymentLoadingRef.current = false
      setPaymentLoading(false)
      return
    }

    const isCashCustomer = !selectedCustomer.id || selectedCustomer.id === 'cash' || selectedCustomer.id === 0
    const isAllocate = payAllOutstandingMode && outstandingInvoices.length > 0

    // DUPLICATE PAYMENT CHECK: same customer + same amount + same day
    if (!isCashCustomer) {
      const paymentDateStr = data.paymentDate ? (data.paymentDate.includes('T') ? data.paymentDate.split('T')[0] : data.paymentDate) : new Date().toISOString().split('T')[0]
      let checkAmount = amount
      if (isAllocate) {
        checkAmount = outstandingInvoices
          .filter(inv => (Number(inv.balanceAmount) || 0) > 0)
          .reduce((s, inv) => s + (Number(inv.balanceAmount) || 0), 0)
      }
      try {
        const checkRes = await paymentsAPI.checkDuplicatePayment(parseInt(selectedCustomer.id), checkAmount, paymentDateStr)
        const hasDuplicate = checkRes?.data?.hasDuplicate || checkRes?.hasDuplicate
        if (hasDuplicate) {
          pendingPaymentRef.current = { data, idempotencyKey, isAllocate }
          setDuplicatePaymentModal({ isOpen: true, amount: checkAmount })
          paymentLoadingRef.current = false
          setPaymentLoading(false)
          return
        }
      } catch (err) {
        console.warn('Duplicate check failed, proceeding:', err)
      }
    }

    await executePaymentApi({ data, idempotencyKey, isAllocate })
  }

  const executePaymentApi = async ({ data, idempotencyKey, isAllocate }) => {
    paymentLoadingRef.current = true
    setPaymentLoading(true)
    const amount = parseFloat(data.amount)
    const isCashCustomer = !selectedCustomer.id || selectedCustomer.id === 'cash' || selectedCustomer.id === 0

    try {
      if (isAllocate) {
        const allocations = outstandingInvoices
          .filter(inv => (Number(inv.balanceAmount) || 0) > 0)
          .map(inv => ({ invoiceId: inv.id, amount: Number(inv.balanceAmount) || 0 }))
        const totalAlloc = allocations.reduce((s, a) => s + a.amount, 0)
        if (allocations.length === 0 || Math.abs(totalAlloc - amount) > 0.01) {
          toast.error('Outstanding amounts may have changed. Please refresh and try again.')
          paymentLoadingRef.current = false
          setPaymentLoading(false)
          return
        }
        const allocateData = {
          customerId: parseInt(selectedCustomer.id),
          amount: totalAlloc,
          mode: (data.method || data.mode || 'CASH').toUpperCase(),
          reference: data.ref || data.reference || null,
          paymentDate: data.paymentDate || new Date().toISOString(),
          allocations
        }
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Payment request timed out after 30 seconds')), 30000)
        )
        const response = await Promise.race([
          paymentsAPI.allocatePayment(allocateData),
          timeoutPromise
        ])
        if (response?.success) {
          toast.success(`Payment recorded: ${formatCurrency(amount)} across ${allocations.length} invoice(s)`, { id: 'payment-success', duration: 5000 })
          setShowPaymentModal(false)
          setPayAllOutstandingMode(false)
          setPaymentModalInvoiceId(null)
          resetPaymentForm()
          const isCash = false
          setBalanceRefreshSkeleton(true)
          try {
            await customersAPI.recalculateBalance(selectedCustomer.id)
          } catch (recalcErr) {
            console.warn('Balance recalc after payment:', recalcErr?.message)
          }
          await new Promise(r => setTimeout(r, 500))
          await loadCustomerData(selectedCustomer.id)
          const fetchResp = await customersAPI.getCustomers({ page: 1, pageSize: 1000 })
          if (fetchResp?.success && fetchResp?.data?.items) {
            setCustomers(fetchResp.data.items)
            const updated = fetchResp.data.items.find(c => c.id === selectedCustomer.id)
            if (updated) setSelectedCustomer(updated)
          }
          setTimeout(() => setBalanceRefreshSkeleton(false), 500)
          setTimeout(async () => {
            await loadCustomerData(selectedCustomer.id)
            const resp = await customersAPI.getCustomers({ page: 1, pageSize: 1000 })
            if (resp?.success && resp?.data?.items) {
              setCustomers(resp.data.items)
              const upd = resp.data.items.find(c => c.id === selectedCustomer.id)
              if (upd) setSelectedCustomer(upd)
            }
            window.dispatchEvent(new CustomEvent('paymentCreated', { detail: { customerId: selectedCustomer.id } }))
            window.dispatchEvent(new CustomEvent('dataUpdated'))
          }, 2000)
          window.dispatchEvent(new CustomEvent('paymentCreated', { detail: { customerId: selectedCustomer.id } }))
          window.dispatchEvent(new CustomEvent('dataUpdated'))
        } else {
          toast.error(response?.message || 'Failed to allocate payment', { id: 'payment-error' })
        }
        paymentLoadingRef.current = false
        setPaymentLoading(false)
        return
      }

      // createPayment flow
      const paymentData = {
        customerId: isCashCustomer ? null : parseInt(selectedCustomer.id),
        saleId: data.saleId ? parseInt(data.saleId) : null,
        amount: amount,
        mode: (data.method || data.mode || 'CASH').toUpperCase(), // Backend expects uppercase: CASH, CHEQUE, ONLINE, CREDIT
        reference: data.ref || data.reference || null,
        paymentDate: data.paymentDate || new Date().toISOString()
      }

      console.log('Submitting payment with data:', paymentData)
      console.log('Idempotency key:', idempotencyKey)

      // Add timeout to prevent hanging (30 seconds)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Payment request timed out after 30 seconds')), 30000)
      )

      console.log('Sending payment request to API...')
      const response = await Promise.race([
        paymentsAPI.createPayment(paymentData, idempotencyKey),
        timeoutPromise
      ])
      console.log('Payment API response received:', response)

      // Backend returns: { success: true, message: "...", data: { payment, invoice, customer } }
      if (response?.success) {
        const paymentResult = response?.data?.payment || response?.data
        const invoiceResult = response?.data?.invoice
        const mode = paymentResult?.mode || paymentResult?.method || data.method || 'CASH'
        const amount = paymentResult?.amount || data.amount

        const statusMsg = invoiceResult?.invoiceNo
          ? ` Invoice ${invoiceResult.invoiceNo} status: ${invoiceResult.status || invoiceResult.paymentStatus || 'PENDING'}`
          : ''
        toast.success(`Payment recorded: ${formatCurrency(amount)} (${mode})${statusMsg}`, { id: 'payment-success', duration: 5000 })

        setShowPaymentModal(false)
        setPaymentModalInvoiceId(null)
        resetPaymentForm() // Reset payment form after successful submission

        // RISK-2: Show "Refreshing balance…" so user knows to wait (skip for cash customer)
        const isCash = !selectedCustomer.id || selectedCustomer.id === 'cash' || selectedCustomer.id === 0
        if (!isCash) setBalanceRefreshSkeleton(true)

        // Bypass cooldown: direct recalc + short delay + load (payment is always a fresh event)
        try {
          await customersAPI.recalculateBalance(isCash ? 'cash' : selectedCustomer.id)
        } catch (recalcErr) {
          console.warn('Balance recalc after payment:', recalcErr?.message)
        }
        await new Promise(r => setTimeout(r, 500))
        await loadCustomerData(isCash ? 'cash' : selectedCustomer.id)
        const fetchResp = await customersAPI.getCustomers({ page: 1, pageSize: 1000 })
        if (fetchResp?.success && fetchResp?.data?.items) {
          setCustomers(fetchResp.data.items)
          if (!isCash) {
            const updated = fetchResp.data.items.find(c => c.id === selectedCustomer.id)
            if (updated) setSelectedCustomer(updated)
          }
        }

        if (!isCash) setTimeout(() => setBalanceRefreshSkeleton(false), 500)

        // Delayed refresh to catch backend eventual consistency (2s)
        setTimeout(async () => {
          await loadCustomerData(isCash ? 'cash' : selectedCustomer.id)
          const resp = await customersAPI.getCustomers({ page: 1, pageSize: 1000 })
          if (resp?.success && resp?.data?.items) {
            setCustomers(resp.data.items)
            if (!isCash) {
              const updated = resp.data.items.find(c => c.id === selectedCustomer.id)
              if (updated) setSelectedCustomer(updated)
            }
          }
          window.dispatchEvent(new CustomEvent('paymentCreated', { detail: { customerId: selectedCustomer.id, payment: paymentResult } }))
          window.dispatchEvent(new CustomEvent('dataUpdated'))
        }, 2000)

        window.dispatchEvent(new CustomEvent('paymentCreated', { detail: { customerId: selectedCustomer.id, payment: paymentResult } }))
        window.dispatchEvent(new CustomEvent('dataUpdated'))
      } else {
        toast.error(response?.message || 'Failed to save payment', { id: 'payment-error' })
      }
    } catch (error) {
      // Log error once (prevent flooding)
      if (!error._logged) {
        console.error('Payment error:', error?.response?.data || error?.message)
        error._logged = true
      }

      // Skip if interceptor already showed the error
      if (!error?._handledByInterceptor) {
        // Handle HTTP 409 Conflict (concurrent modification)
        if (error.message?.includes('CONFLICT') || error.response?.status === 409) {
          toast.error('Another user updated this invoice. Refreshing data...', {
            id: 'payment-error',
            duration: 5000
          })
          await loadCustomerData(selectedCustomer.id)
          const resp = await customersAPI.getCustomers({ page: 1, pageSize: 1000 })
          if (resp?.success && resp?.data?.items) setCustomers(resp.data.items)
        } else {
          let errorMsg = 'Failed to save payment'
          if (error?.response?.data?.message) {
            errorMsg = error.response.data.message
          } else if (error?.response?.data?.errors && Array.isArray(error.response.data.errors)) {
            errorMsg = error.response.data.errors.join(', ')
          } else if (error?.message) {
            errorMsg = error.message
          }
          toast.error(errorMsg, { id: 'payment-error', duration: 5000 })
        }
      }
    } finally {
      // Reset loading state (both ref and state)
      paymentLoadingRef.current = false
      setPaymentLoading(false)
    }
  }

  const handleExportPDF = async () => {
    if (!selectedCustomer || !selectedCustomer.id) {
      toast.error('Please select a customer first')
      return
    }
    if (pdfLoading) return

    const customerId = selectedCustomer.id
    setPdfLoading(true)
    try {
      if (!selectedCustomer || selectedCustomer.id !== customerId) {
        toast.error('Customer selection changed. Please try again.')
        return
      }

      const fromStr = dateRange.from.includes('T') ? dateRange.from.split('T')[0] : dateRange.from
      const toStr = dateRange.to.includes('T') ? dateRange.to.split('T')[0] : dateRange.to
      const pdfBlob = await customersAPI.getCustomerStatement(
        customerId,
        fromStr,
        toStr
      )

      const url = window.URL.createObjectURL(pdfBlob)
      const opened = window.open(url, '_blank')
      if (!opened) {
        const a = document.createElement('a')
        a.href = url
        a.download = `Ledger_${selectedCustomer.name}_${new Date().toISOString().split('T')[0]}.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 60000)
      toast.success('Statement PDF ready', { id: 'ledger-pdf', duration: 3000 })
    } catch (error) {
      console.error('Failed to export PDF:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to export PDF')
    } finally {
      setPdfLoading(false)
    }
  }

  const handleExportStatement = async () => {
    await handleExportPDF()
  }

  // WhatsApp Sharing Handler - Downloads PDF first, then opens WhatsApp
  const handleShareWhatsApp = async () => {
    if (!selectedCustomer || customerLedger.length === 0) {
      toast.error('No data to share')
      return
    }

    try {
      // First, download the PDF statement
      const fromDate = new Date(dateRange.from)
      const toDate = new Date(dateRange.to)
      let pdfBlob
      try {
        pdfBlob = await customersAPI.getCustomerStatement(selectedCustomer.id, fromDate.toISOString().split('T')[0], toDate.toISOString().split('T')[0])
      } catch (pdfError) {
        console.error('Failed to generate PDF:', pdfError)
        toast.error('Failed to generate PDF statement')
        return
      }

      // Create download link for PDF
      const pdfUrl = window.URL.createObjectURL(pdfBlob)
      const pdfLink = document.createElement('a')
      pdfLink.href = pdfUrl
      pdfLink.download = `statement_${selectedCustomer.name}_${new Date().toISOString().split('T')[0]}.pdf`
      document.body.appendChild(pdfLink)
      pdfLink.click()
      document.body.removeChild(pdfLink)
      window.URL.revokeObjectURL(pdfUrl)

      // Prepare WhatsApp message
      const filteredEntries = customerLedger.filter(entry => {
        const entryDate = new Date(entry.date)
        const fromDate = new Date(dateRange.from)
        const toDate = new Date(dateRange.to)
        toDate.setHours(23, 59, 59, 999)
        return entryDate >= fromDate && entryDate <= toDate
      })

      const totalDebit = filteredEntries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0)
      const totalCredit = filteredEntries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0)
      const lastBal = filteredEntries.length > 0 ? filteredEntries[filteredEntries.length - 1].balance : 0
      const closingBalance = Number(lastBal) || 0

      const message = `*Customer Ledger Statement*\n\n` +
        `*Customer:* ${selectedCustomer.name}\n` +
        `*TRN:* ${selectedCustomer.trn || 'N/A'}\n` +
        `*Phone:* ${selectedCustomer.phone || 'N/A'}\n` +
        `*Period:* ${new Date(dateRange.from).toLocaleDateString()} to ${new Date(dateRange.to).toLocaleDateString()}\n\n` +
        `*Summary:*\n` +
        `Total Sales: ${formatCurrency(totalDebit)}\n` +
        `Payments Received: ${formatCurrency(totalCredit)}\n` +
        `Outstanding: ${formatCurrency(totalDebit - totalCredit)}\n` +
        `Closing Balance: ${formatBalance(closingBalance)}\n\n` +
        `📎 PDF statement has been downloaded. Please attach it to this message.\n\n` +
        `_Generated on ${new Date().toLocaleString()}_`

      const phoneNumber = selectedCustomer.phone?.replace(/\D/g, '') || ''
      if (phoneNumber) {
        // Small delay to ensure PDF download starts
        setTimeout(() => {
          const url = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`
          window.open(url, '_blank')
          toast.success('PDF downloaded. Opening WhatsApp... Please attach the PDF file.', { id: 'statement-share', duration: 5000 })
        }, 500)
      } else {
        // Copy to clipboard if no phone
        navigator.clipboard.writeText(message)
        toast.success('PDF downloaded. Statement summary copied to clipboard!', { id: 'statement-copy', duration: 3000 })
      }
    } catch (error) {
      console.error('Share error:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to share statement')
    }
  }

  // Print Preview Handler
  const handlePrintPreview = () => {
    if (!selectedCustomer || customerLedger.length === 0) {
      toast.error('No data to print')
      return
    }

    // Create print window
    const printWindow = window.open('', '_blank')
    const filteredEntries = customerLedger.filter(entry => {
      const entryDate = new Date(entry.date)
      const fromDate = new Date(dateRange.from)
      const toDate = new Date(dateRange.to)
      toDate.setHours(23, 59, 59, 999)
      return entryDate >= fromDate && entryDate <= toDate
    })

    const totalDebit = filteredEntries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0)
    const totalCredit = filteredEntries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0)
    const lastBal = filteredEntries.length > 0 ? filteredEntries[filteredEntries.length - 1].balance : 0
    const closingBalance = Number(lastBal) || 0

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Customer Ledger Statement - ${selectedCustomer.name}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { color: #1e40af; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f3f4f6; font-weight: bold; }
            .debit-row { background-color: #fee2e2; }
            .credit-row { background-color: #dcfce7; }
            .summary { margin-top: 20px; padding: 15px; background-color: #f9fafb; border-radius: 5px; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          <h1>${companyName} - Customer Ledger</h1>
          <h2>Customer Ledger Statement</h2>
          <p><strong>Customer:</strong> ${selectedCustomer.name}</p>
          <p><strong>TRN:</strong> ${selectedCustomer.trn || 'N/A'}</p>
          <p><strong>Period:</strong> ${new Date(dateRange.from).toLocaleDateString()} to ${new Date(dateRange.to).toLocaleDateString()}</p>
          
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Invoice No</th>
                <th>Payment Mode</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Status</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              ${filteredEntries.map(entry => {
      const dateStr = entry.type === 'Payment'
        ? new Date(entry.date).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const rowClass = entry.debit > 0 ? 'debit-row' : entry.credit > 0 ? 'credit-row' : ''
      return `<tr class="${rowClass}">
                  <td>${dateStr}</td>
                  <td>${entry.type || ''}</td>
                  <td>${entry.reference || '-'}</td>
                  <td>${entry.paymentMode || entry.PaymentMode || '-'}</td>
                  <td>${(Number(entry.debit) || 0) > 0 ? formatCurrency(Number(entry.debit) || 0) : '-'}</td>
                  <td>${(Number(entry.credit) || 0) > 0 ? formatCurrency(Number(entry.credit) || 0) : '-'}</td>
                  <td>${(entry[STATUS_PROP] || '-')}</td>
                  <td>${formatBalance(Number(entry.balance) || 0)}</td>
                </tr>`
    }).join('')}
            </tbody>
            <tfoot>
              <tr style="background-color: #f3f4f6; font-weight: bold;">
                <td colspan="4">CLOSING BALANCE</td>
                <td>${formatCurrency(totalDebit)}</td>
                <td>${formatCurrency(totalCredit)}</td>
                <td>-</td>
                <td>${formatBalance(closingBalance)}</td>
              </tr>
            </tfoot>
          </table>
          
          <div class="summary">
            <h3>Summary</h3>
            <p>Total Debit: ${formatCurrency(totalDebit)}</p>
            <p>Total Credit: ${formatCurrency(totalCredit)}</p>
            <p>Net Balance: ${formatBalance(closingBalance)}</p>
          </div>
          
          <p style="margin-top: 30px; font-size: 12px; color: #666;">
            Generated on ${new Date().toLocaleString()}
          </p>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
    }, 250)
  }


  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'paid': return 'bg-green-100 text-green-800'
      case 'partial': return 'bg-yellow-100 text-yellow-800'
      case 'pending': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status) => {
    switch (status?.toLowerCase()) {
      case 'paid': return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'partial': return <Clock className="h-4 w-4 text-yellow-600" />
      case 'pending': return <XCircle className="h-4 w-4 text-red-600" />
      default: return <Clock className="h-4 w-4 text-gray-600" />
    }
  }


  if (user && !isAdminOrOwner(user) && staffAssignmentsLoaded && staffHasNoAssignments) {
    return (
      <div className="min-h-screen flex flex-col bg-neutral-50 items-center justify-center p-6">
        <div className="flex items-center gap-3 px-4 py-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 max-w-md">
          <AlertTriangle className="h-8 w-8 shrink-0" />
          <p className="text-sm font-medium">No branches or routes assigned. Contact your admin.</p>
        </div>
      </div>
    )
  }

  if (loading && !selectedCustomer) {
    return <LoadingCard message="Loading customers..." />
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 overflow-x-hidden w-full max-w-full">
      {/* TOP BAR - Header - Responsive */}
      <div className="bg-white border-b border-neutral-200 px-3 sm:px-6 py-2 sm:py-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
          <div className="flex items-center space-x-3 sm:space-x-6">
            {/* Return/Back Button */}
            <button
              onClick={() => navigate('/customers')}
              className="inline-flex items-center justify-center p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to Customers"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-xl font-bold text-gray-900">{companyName ? `${companyName} – Customer Ledger` : 'Customer Ledger'}</h1>
              <p className="text-xs sm:text-sm text-gray-600">CUSTOMER LEDGER MODULE</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <p className="text-sm text-gray-600">Date: {new Date().toLocaleDateString('en-GB')}</p>
              <p className="text-sm text-gray-600">User: {user?.name || 'Admin'} ({user?.role || 'Admin'})</p>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={handleExportPDF}
                disabled={pdfLoading}
                className="p-1 sm:p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                title="Export PDF (F7)"
              >
                <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                onClick={handleExportPDF}
                disabled={pdfLoading}
                className="p-1 sm:p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                title="Print (Ctrl+P)"
              >
                <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                onClick={() => {
                  if (selectedCustomer) {
                    ledgerLoadInProgressRef.current = null
                    loadCustomerData(selectedCustomer.id)
                  }
                }}
                className="p-1 sm:p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                title="Refresh"
                disabled={!selectedCustomer}
              >
                <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                onClick={handleManualReconciliation}
                className="p-1 sm:p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                title="Reconcile & Verify Data (Validates all transactions and recalculates balance)"
                disabled={!selectedCustomer || loading}
              >
                <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                className="p-1 sm:p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                title="Settings"
              >
                <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        {/* Branch / Route filters for customer list - visible before selecting a customer */}
        <div className="bg-neutral-100/80 border-b border-neutral-200 px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-neutral-600">Filter:</span>
          <select
            value={filterDraft.branchId}
            onChange={(e) => {
              const v = e.target.value
              setFilterDraft(prev => ({ ...prev, branchId: v, routeId: '' }))
              setLedgerBranchId(v)
              setLedgerRouteId('')
            }}
            className="border border-neutral-300 rounded px-2 py-1.5 text-sm bg-white min-w-[100px]"
            title="Filter customers by branch"
          >
            <option value="">All branches</option>
            {availableBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select
            value={filterDraft.routeId}
            onChange={(e) => {
              const v = e.target.value
              setFilterDraft(prev => ({ ...prev, routeId: v }))
              setLedgerRouteId(v)
            }}
            className="border border-neutral-300 rounded px-2 py-1.5 text-sm bg-white min-w-[100px]"
            title="Filter customers by route"
          >
            <option value="">All routes</option>
            {(filterDraft.branchId ? availableRoutes.filter(r => r.branchId === parseInt(filterDraft.branchId, 10)) : availableRoutes).map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        {/* TOP BAR - Customer Search: full width, design-lock */}
        <div className="bg-neutral-50 border-b border-neutral-200 p-3 sm:p-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-0 max-w-full lg:max-w-xl">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-neutral-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search customer (F2)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-neutral-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setShowAddCustomerModal(true)
            }}
            className="px-3 py-2 bg-primary-600 text-white text-sm rounded-md hover:bg-primary-700 active:bg-primary-800 flex items-center space-x-1.5 transition-colors whitespace-nowrap cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 min-h-[44px]"
            title="Add New Customer"
            type="button"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Customer</span>
          </button>
          {selectedCustomer && (
            <div className="px-3 py-2 bg-primary-50 text-primary-800 text-sm rounded-md font-semibold whitespace-nowrap min-w-0 truncate max-w-[200px] sm:max-w-none" title={selectedCustomer.name}>
              {selectedCustomer.name}
            </div>
          )}
          <div className="text-xs text-neutral-600 whitespace-nowrap ml-auto">
            {searchDropdownLoading ? 'Searching…' : (searchTerm || !selectedCustomer ? `${searchDropdownTotal} customer(s)` : `Total: ${customers.length}`)}
          </div>
        </div>

        {/* CUSTOMER SELECTION DROPDOWN - visible, z-50, full width */}
        {(searchTerm || !selectedCustomer) && (
          <div className="bg-white border-b border-neutral-200 max-h-96 overflow-y-auto overflow-x-hidden z-50 shadow-md">
            <div className="p-2 space-y-1">
              {/* Cash Customer Option */}
              <button
                onClick={() => {
                  setSelectedCustomer({ id: 'cash', name: 'Cash Customer', balance: 0 })
                  loadCustomerData('cash')
                }}
                className={`w-full text-left p-3 rounded-lg transition-colors text-sm border border-transparent ${selectedCustomer?.id === 'cash'
                  ? 'bg-primary-600 text-white'
                  : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-900 border-neutral-200'
                  }`}
              >
                <div className="font-semibold">Cash Customer</div>
                <div className={`text-xs ${selectedCustomer?.id === 'cash' ? 'text-primary-100' : 'text-neutral-500'}`}>
                  All cash sales and payments • Balance: AED 0.00
                </div>
              </button>
              {/* Regular Customers - server-side search results */}
              {searchDropdownLoading && searchDropdownResults.length === 0 && (
                <div className="p-3 text-sm text-neutral-500">Searching…</div>
              )}
              {!searchDropdownLoading && searchDropdownResults.length === 0 && searchTerm && (
                <div className="p-3 text-sm text-neutral-500">No customers found. Try a different search.</div>
              )}
              {searchDropdownResults.map((customer) => (
                <button
                  key={customer.id}
                  onClick={() => handleSelectCustomer(customer)}
                  className={`w-full text-left p-3 rounded-lg transition-colors text-sm border last:border-b-0 ${selectedCustomer?.id === customer.id
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white hover:bg-neutral-50 text-neutral-900 border-neutral-100'
                    }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-neutral-900 truncate">{customer.name}</p>
                      {customer.phone && <p className="text-xs text-neutral-500 truncate">{customer.phone}</p>}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className={`text-sm font-semibold ${customer.balance < 0 ? 'text-green-600' : customer.balance > 0 ? 'text-red-600' : 'text-neutral-600'}`}>
                        {formatBalance(customer.balance ?? 0)}
                      </p>
                      <p className="text-xs text-neutral-500">{customer.balance < 0 ? 'Credit' : customer.balance > 0 ? 'Outstanding' : 'Settled'}</p>
                    </div>
                  </div>
                </button>
              ))}
              {!searchDropdownLoading && searchDropdownResults.length > 0 && searchDropdownResults.length < searchDropdownTotal && (
                <button
                  type="button"
                  onClick={() => fetchCustomerSearch(searchTerm, searchDropdownPage + 1, true)}
                  className="w-full p-3 text-sm text-primary-600 hover:bg-primary-50 font-medium"
                >
                  Load more ({searchDropdownResults.length} of {searchDropdownTotal})
                </button>
              )}
            </div>
          </div>
        )}

        {/* MAIN LEDGER VIEW */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedCustomer ? (
            <div className="flex-1 flex items-center justify-center p-6 w-full">
              <div className="text-center w-full max-w-lg">
                <Users className="h-16 w-16 mx-auto mb-4 text-neutral-300" />
                <h3 className="text-lg font-medium text-neutral-900 mb-2">Search and select a customer to view ledger</h3>
                <p className="text-sm text-neutral-500">Use the search bar above (Press F2 to focus)</p>
              </div>
            </div>
          ) : (
            <>
              {/* Customer Info & Balance - full width, balance prominent */}
              <div className="bg-neutral-50 border-b border-neutral-200 px-4 py-3 sm:px-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-wrap">
                  {/* Customer Info */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="min-w-0">
                      <h2 className="text-base sm:text-lg font-bold text-neutral-900 truncate">{selectedCustomer.name}</h2>
                      <div className="flex items-center gap-2 text-xs sm:text-sm text-neutral-600 flex-wrap">
                        {selectedCustomer.id !== 'cash' && selectedCustomer.phone && <span>{selectedCustomer.phone}</span>}
                        {selectedCustomer.id !== 'cash' && selectedCustomer.email && <span className="hidden sm:inline">• {selectedCustomer.email}</span>}
                        {selectedCustomer.id !== 'cash' && selectedCustomer.trn && <span>TRN: {selectedCustomer.trn}</span>}
                        {selectedCustomer.id === 'cash' && <span className="text-primary-600 font-medium">All cash sales and payments</span>}
                      </div>
                    </div>
                  </div>
                  {/* Current Balance - prominent */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-neutral-600 mb-0.5">Current balance</p>
                    {balanceRefreshSkeleton ? (
                      <p className="text-lg text-neutral-500 animate-pulse">Refreshing balance…</p>
                    ) : (
                      <>
                        <p className={`text-xl sm:text-2xl font-bold ${(selectedCustomer.balance ?? 0) < 0 ? 'text-green-600' : (selectedCustomer.balance ?? 0) > 0 ? 'text-red-600' : 'text-neutral-900'}`}>
                          {formatCurrency(Math.abs(selectedCustomer.balance ?? 0))}
                        </p>
                        <p className="text-xs text-neutral-500">{(selectedCustomer.balance ?? 0) < 0 ? 'In credit' : (selectedCustomer.balance ?? 0) > 0 ? 'Outstanding' : 'Settled'}</p>
                      </>
                    )}
                  </div>

                  {/* Action Buttons - Compact */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {selectedCustomer.id !== 'cash' && (
                      <>
                        <button
                          onClick={() => {
                            // Open edit modal directly instead of navigating
                            setEditingCustomer(selectedCustomer)
                            // Pre-fill form with current customer data
                            customerForm.setValue('name', selectedCustomer.name)
                            customerForm.setValue('phone', selectedCustomer.phone || '')
                            customerForm.setValue('email', selectedCustomer.email || '')
                            customerForm.setValue('trn', selectedCustomer.trn || '')
                            customerForm.setValue('address', selectedCustomer.address || '')
                            customerForm.setValue('creditLimit', selectedCustomer.creditLimit || 0)
                            customerForm.setValue('paymentTerms', selectedCustomer.paymentTerms || '')
                            customerForm.setValue('branchId', selectedCustomer.branchId || '')
                            customerForm.setValue('routeId', selectedCustomer.routeId || '')
                            setShowEditCustomerModal(true)
                          }}
                          className="px-2 py-1 bg-primary-600 text-white text-xs rounded hover:bg-primary-700 flex items-center gap-1 transition-colors"
                          title="Edit Customer (F3)"
                        >
                          <Edit className="h-3 w-3" />
                          <span className="hidden sm:inline">Edit</span>
                        </button>
                        <button
                          onClick={() => {
                            setPayAllOutstandingMode(false)
                            setPaymentModalInvoiceId(null)
                            setShowPaymentModal(true)
                          }}
                          className="px-2 py-1 bg-primary-600 text-white text-xs rounded hover:bg-primary-700 flex items-center gap-1 transition-colors"
                          title="Add Payment (F4)"
                        >
                          <Plus className="h-3 w-3" />
                          <span className="hidden sm:inline">Payment</span>
                        </button>
                        {outstandingInvoices.length > 0 && (selectedCustomer.balance ?? 0) > 0 && (
                          <button
                            onClick={() => {
                              setPayAllOutstandingMode(true)
                              setPaymentModalInvoiceId(null)
                              const total = outstandingInvoices.reduce((s, inv) => s + (Number(inv.balanceAmount) || 0), 0)
                              setPaymentValue('amount', total)
                              setPaymentValue('saleId', '')
                              setPaymentValue('paymentDate', new Date().toISOString().split('T')[0])
                              setPaymentValue('method', 'CASH')
                              setShowPaymentModal(true)
                            }}
                            className="px-2 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700 flex items-center gap-1 transition-colors"
                            title="Pay all outstanding invoices in one payment"
                          >
                            <Wallet className="h-3 w-3" />
                            <span className="hidden sm:inline">Pay All</span>
                          </button>
                        )}
                      </>
                    )}
                    <button
                      onClick={handleExportStatement}
                      disabled={pdfLoading}
                      className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 flex items-center gap-1 transition-colors disabled:opacity-50"
                      title="Ledger Statement (F5)"
                    >
                      <FileText className="h-3 w-3" />
                      <span className="hidden lg:inline">{pdfLoading ? 'Loading...' : 'Statement'}</span>
                    </button>
                    <button
                      disabled={pdfLoading}
                      onClick={async () => {
                        if (pdfLoading) return
                        if (!selectedCustomer || !selectedCustomer.id) {
                          toast.error('Please select a customer first')
                          return
                        }
                        const loadingToast = toast.loading('Generating PDF...')
                        setPdfLoading(true)
                        try {
                          const fromDate = dateRange.from
                          const toDate = dateRange.to
                          const pdfBlob = await customersAPI.getCustomerPendingBillsPdf(
                            selectedCustomer.id,
                            fromDate,
                            toDate
                          )

                          const url = window.URL.createObjectURL(pdfBlob)
                          const opened = window.open(url, '_blank')
                          if (!opened) {
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `Pending_Bills_${selectedCustomer.name}_${fromDate}_to_${toDate}.pdf`
                            document.body.appendChild(a)
                            a.click()
                            document.body.removeChild(a)
                          }
                          setTimeout(() => window.URL.revokeObjectURL(url), 60000)
                          toast.success('Pending Bills PDF ready', { id: 'invoice-pdf-download', duration: 3000 })
                        } catch (error) {
                          console.error('Failed to export pending bills PDF:', error)
                          if (!error?._handledByInterceptor) toast.error(error.response?.data?.message || 'Failed to export PDF')
                        } finally {
                          toast.dismiss(loadingToast)
                          setPdfLoading(false)
                        }
                      }}
                      className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 flex items-center gap-1 transition-colors disabled:opacity-50"
                      title="Pending Bills PDF (Outstanding Invoices Only) - Uses Date Filter"
                    >
                      <DollarSign className="h-3 w-3" />
                      <span className="hidden lg:inline">{pdfLoading ? 'Loading...' : 'Pending Bills'}</span>
                    </button>
                    <button
                      onClick={handleExportPDF}
                      disabled={pdfLoading}
                      className="px-2 py-1 bg-neutral-700 text-white text-xs rounded hover:bg-neutral-800 flex items-center gap-1 transition-colors disabled:opacity-50"
                      title="Full Ledger PDF (F7)"
                    >
                      <Download className="h-3 w-3" />
                      <span className="hidden lg:inline">{pdfLoading ? 'Loading...' : 'PDF'}</span>
                    </button>
                    <button
                      onClick={handleShareWhatsApp}
                      className="px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 flex items-center transition-colors"
                      title="WhatsApp"
                    >
                      <Send className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => selectedCustomer && customerLedger.length > 0 && setShowSendStatementModal(true)}
                      disabled={!selectedCustomer || customerLedger.length === 0}
                      className="px-2 py-1 bg-primary-600 text-white text-xs rounded hover:bg-primary-700 flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Send statement via WhatsApp, email, or download PDF"
                    >
                      <Send className="h-3 w-3" />
                      <span className="hidden lg:inline">Send Statement</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Send Statement Modal */}
              {showSendStatementModal && selectedCustomer && (
                <Modal
                  isOpen={showSendStatementModal}
                  onClose={() => setShowSendStatementModal(false)}
                  title="Send Statement"
                >
                  <div className="space-y-4">
                    <p className="text-sm text-neutral-600">
                      Send account statement for <strong>{selectedCustomer.name}</strong> ({dateRange.from} to {dateRange.to})
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={() => {
                          handleShareWhatsApp()
                          setShowSendStatementModal(false)
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        <Send className="h-4 w-4" />
                        Share via WhatsApp
                      </button>
                      <button
                        disabled={pdfLoading}
                        onClick={async () => {
                          await handleExportPDF()
                          setShowSendStatementModal(false)
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                      >
                        <Download className="h-4 w-4" />
                        {pdfLoading ? 'Generating...' : 'Download PDF'}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const filteredEntries = customerLedger.filter(entry => {
                              const entryDate = new Date(entry.date)
                              const fromDate = new Date(dateRange.from)
                              const toDate = new Date(dateRange.to)
                              toDate.setHours(23, 59, 59, 999)
                              return entryDate >= fromDate && entryDate <= toDate
                            })
                            const totalDebit = filteredEntries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0)
                            const totalCredit = filteredEntries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0)
                            const lastBal = filteredEntries.length > 0 ? filteredEntries[filteredEntries.length - 1].balance : 0
                            const closingBalance = Number(lastBal) || 0
                            const message = `Customer Ledger Statement\n\nCustomer: ${selectedCustomer.name}\nTRN: ${selectedCustomer.trn || 'N/A'}\nPhone: ${selectedCustomer.phone || 'N/A'}\nPeriod: ${dateRange.from} to ${dateRange.to}\n\nSummary:\nTotal Sales: ${formatCurrency(totalDebit)}\nPayments Received: ${formatCurrency(totalCredit)}\nOutstanding: ${formatCurrency(totalDebit - totalCredit)}\nClosing Balance: ${formatBalance(closingBalance)}\n\nGenerated on ${new Date().toLocaleString()}`
                            await navigator.clipboard.writeText(message)
                            toast.success('Statement summary copied to clipboard', { id: 'statement-summary-copy', duration: 3000 })
                            setShowSendStatementModal(false)
                          } catch (e) {
                            if (!e?._handledByInterceptor) toast.error('Failed to copy')
                          }
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-600 text-white rounded-lg hover:bg-neutral-700 transition-colors"
                      >
                        <FileText className="h-4 w-4" />
                        Copy Summary
                      </button>
                    </div>
                  </div>
                </Modal>
              )}

              {/* Date Range & Branch/Route/Staff Filters — only show when customer selected */}
              {selectedCustomer && (
                <div className="bg-neutral-50 border-b border-neutral-200 px-3 py-2 sm:px-4 flex items-center gap-3 flex-wrap">
                  <label className="text-sm font-medium text-neutral-700">Date:</label>
                  <Input
                    type="date"
                    value={filterDraft.from}
                    onChange={(e) => setFilterDraft(prev => ({ ...prev, from: e.target.value }))}
                    className="w-36"
                  />
                  <span className="text-neutral-600">to</span>
                  <Input
                    type="date"
                    value={filterDraft.to}
                    onChange={(e) => setFilterDraft(prev => ({ ...prev, to: e.target.value }))}
                    className="w-36"
                  />
                  <span className="text-neutral-400 mx-1">|</span>

                  {/* Branch Filter */}
                  <select
                    value={filterDraft.branchId}
                    onChange={(e) => setFilterDraft(prev => ({ ...prev, branchId: e.target.value, routeId: '' }))}
                    className={`border border-neutral-300 rounded px-2 py-1.5 text-sm bg-white min-w-[100px] ${(!isAdminOrOwner(user) && availableBranches.length <= 1) ? 'bg-neutral-100 text-neutral-500 cursor-not-allowed' : ''}`}
                    disabled={!isAdminOrOwner(user) && availableBranches.length <= 1}
                    title="Filter by branch"
                  >
                    {isAdminOrOwner(user) && <option value="">All branches</option>}
                    {availableBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>

                  {/* Route Filter */}
                  <select
                    value={filterDraft.routeId}
                    onChange={(e) => setFilterDraft(prev => ({ ...prev, routeId: e.target.value }))}
                    className={`border border-neutral-300 rounded px-2 py-1.5 text-sm bg-white min-w-[100px] ${(!isAdminOrOwner(user) && availableRoutes.length <= 1) ? 'bg-neutral-100 text-neutral-500 cursor-not-allowed' : ''}`}
                    disabled={!isAdminOrOwner(user) && availableRoutes.length <= 1}
                    title="Filter by route"
                  >
                    {isAdminOrOwner(user) && <option value="">All routes</option>}
                    {(filterDraft.branchId ? availableRoutes.filter(r => r.branchId === parseInt(filterDraft.branchId, 10)) : availableRoutes).map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>

                  {/* Staff Filter */}
                  <select
                    value={filterDraft.staffId}
                    onChange={(e) => setFilterDraft(prev => ({ ...prev, staffId: e.target.value }))}
                    className={`border border-neutral-300 rounded px-2 py-1.5 text-sm bg-white min-w-[100px] ${(!isAdminOrOwner(user)) ? 'bg-neutral-100 text-neutral-500 cursor-not-allowed' : ''}`}
                    disabled={!isAdminOrOwner(user)}
                    title="Filter by staff"
                  >
                    {isAdminOrOwner(user) && <option value="">All staff</option>}
                    {availableStaff.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                  </select>

                  <button
                    type="button"
                    onClick={() => applyLedgerFilters(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded hover:bg-primary-700"
                    title="Filters auto-apply after 0.8s. Click to apply immediately."
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Apply Now
                  </button>
                  <span className="text-xs text-neutral-500 italic">
                    (Auto-applies in 0.8s)
                  </span>
                </div>
              )}

              {/* TAB SECTIONS - Full Width */}
              <div className="flex-1 flex flex-col overflow-hidden w-full min-w-0">
                <div className="border-b border-neutral-200 bg-white w-full sticky top-0 z-10">
                  <div className="overflow-x-auto w-full scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <div className="flex space-x-1 px-2 min-w-max">
                      {[
                        { id: 'ledger', name: 'Ledger', mobileName: 'Ledger', icon: FileText },
                        { id: 'invoices', name: 'Invoices', mobileName: 'Invoices', icon: FileText },
                        { id: 'payments', name: 'Payments', mobileName: 'Payments', icon: CreditCard },
                        { id: 'reports', name: 'Reports', mobileName: 'Reports', icon: TrendingUp }
                      ].map((tab) => {
                        const Icon = tab.icon
                        return (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-3 md:px-4 py-2.5 md:py-3 flex items-center space-x-1.5 md:space-x-2 border-b-2 transition-colors whitespace-nowrap text-xs md:text-sm ${activeTab === tab.id
                              ? 'border-primary-600 text-primary-600 font-medium bg-primary-50'
                              : 'border-transparent text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                              }`}
                          >
                            <Icon className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                            <span className="hidden sm:inline">{tab.name}</span>
                            <span className="sm:hidden">{tab.mobileName}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* TAB CONTENT - Full Width - Zero Padding; pb-20 for bottom nav on mobile */}
                <div className="flex-1 overflow-auto w-full pb-24 lg:pb-0" style={{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
                  {activeTab === 'ledger' && (
                    loading ? (
                      <div className="flex items-center justify-center h-full p-8">
                        <LoadingCard message="Loading ledger data..." />
                      </div>
                    ) : (
                      <LedgerStatementTab
                        ledgerEntries={customerLedger
                          .filter(entry => {
                            // CRITICAL: Validate entry belongs to selected customer (extra safety check)
                            if (!selectedCustomer) return false

                            const entryDate = new Date(entry.date)
                            const fromDate = new Date(dateRange.from)
                            const toDate = new Date(dateRange.to)
                            toDate.setHours(23, 59, 59, 999)
                            const inDateRange = entryDate >= fromDate && entryDate <= toDate
                            if (!inDateRange) return false

                            // Ledger entries from API don't have branchId/routeId - only date/type/amount.
                            // Do NOT filter by branch/route here - it would exclude all (undefined != null).
                            // Branch/route filters apply to customer list only; ledger shows full history.

                            // Apply status/type filters
                            if (ledgerFilters[STATUS_PROP] !== 'all') {
                              const entryStatusValue = entry[STATUS_PROP] || ''
                              const filterStatusValue = ledgerFilters[STATUS_PROP] || ''
                              const statusMatch = entryStatusValue?.toLowerCase() === filterStatusValue.toLowerCase()
                              if (!statusMatch && entry.type !== 'Payment') return false
                            }
                            if (ledgerFilters[TYPE_PROP] !== 'all') {
                              if (entry.type !== ledgerFilters[TYPE_PROP]) return false
                            }

                            return true
                          })}
                        customer={selectedCustomer}
                        onExportExcel={handleExportExcel}
                        onGeneratePDF={handleExportStatement}
                        onShareWhatsApp={handleShareWhatsApp}
                        onPrintPreview={handlePrintPreview}
                        onDeleteReturn={isAdminOrOwner(user) ? (returnId) => {
                          setDangerModal({
                            isOpen: true,
                            title: 'Delete return',
                            message: 'This will reverse stock, remove any refund payment and credit note for this return. This cannot be undone. Are you sure?',
                            confirmLabel: 'Delete return',
                            onConfirm: async () => {
                              try {
                                const response = await returnsAPI.deleteSaleReturn(returnId)
                                if (response?.success !== false) {
                                  toast.success('Return deleted successfully.', { id: 'return-delete', duration: 4000 })
                                  window.dispatchEvent(new CustomEvent('dataUpdated'))
                                  if (selectedCustomer) {
                                    ledgerLoadInProgressRef.current = null
                                    await loadCustomerData(selectedCustomer.id)
                                  }
                                } else {
                                  toast.error(response?.message || 'Failed to delete return')
                                }
                              } catch (error) {
                                if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to delete return')
                              }
                            }
                          })
                        } : undefined}
                        onSettleCredit={isAdminOrOwner(user) ? (entry) => {
                          setSettleCreditEntry(entry)
                          setShowSettleCreditModal(true)
                        } : undefined}
                        filters={ledgerFilters}
                        onFilterChange={(key, value) => {
                          setLedgerFilters(prev => {
                            const updated = { ...prev }
                            // Map 'status' key to maintain compatibility
                            // Use constant property name to prevent minifier from creating 'st' variable
                            if (key === STATUS_PROP) {
                              updated[STATUS_PROP] = value
                            } else if (key === TYPE_PROP) {
                              updated[TYPE_PROP] = value
                            } else {
                              updated[key] = value
                            }
                            return updated
                          })
                        }}
                      />
                    )
                  )}

                  {activeTab === 'invoices' && (
                    <InvoicesTab
                      invoices={customerInvoices}
                      outstandingInvoices={outstandingInvoices}
                      user={user}
                      onViewInvoice={(invoiceId) => {
                        setSelectedInvoiceForView(invoiceId)
                        setShowInvoiceModal(true)
                      }}
                      onViewPDF={async (invoiceId) => {
                        try {
                          const pdfBlob = await salesAPI.getInvoicePdf(invoiceId)
                          const url = window.URL.createObjectURL(pdfBlob)
                          window.open(url, '_blank')
                          setTimeout(() => window.URL.revokeObjectURL(url), 100)
                        } catch (error) {
                          if (!error?._handledByInterceptor) toast.error(error?.message || 'Failed to generate PDF')
                        }
                      }}
                      onEditInvoice={(invoiceId) => {
                        // Navigate to POS with edit mode using React Router
                        navigate(`/pos?editId=${invoiceId}`)
                      }}
                      onPayInvoice={(invoiceId) => {
                        setPaymentModalInvoiceId(invoiceId)
                        setShowPaymentModal(true)
                      }}
                      onUnlockInvoice={async (invoiceId) => {
                        setDangerModal({
                          isOpen: true,
                          title: 'Unlock Invoice',
                          message: 'Please provide a reason for unlocking this invoice:',
                          confirmLabel: 'Unlock Invoice',
                          showInput: true,
                          inputPlaceholder: 'Reason for unlocking',
                          onConfirm: async (reason) => {
                            if (!reason?.trim()) {
                              toast.error('Unlock reason is required')
                              return
                            }
                            try {
                              const response = await salesAPI.unlockInvoice(invoiceId, reason)
                              if (response.success) {
                                toast.success('Invoice unlocked successfully!', { id: 'invoice-unlock', duration: 4000 })
                                if (selectedCustomer) {
                                  await loadCustomerData(selectedCustomer.id)
                                }
                              } else {
                                toast.error(response.message || 'Failed to unlock invoice')
                              }
                            } catch (error) {
                              if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to unlock invoice')
                            }
                          }
                        })
                      }}
                      onDeleteInvoice={(invoiceId) => {
                        setDangerModal({
                          isOpen: true,
                          title: 'DELETE INVOICE',
                          message: 'WARNING: This will restore stock and cannot be undone!\n\nAre you sure you want to delete this invoice?',
                          confirmLabel: 'Delete Invoice',
                          requireTypedText: 'DELETE',
                          onConfirm: async () => {
                            try {
                              const response = await salesAPI.deleteSale(invoiceId)
                              if (response.success) {
                                toast.success('Invoice deleted successfully!', { id: 'invoice-delete', duration: 4000 })
                                window.dispatchEvent(new CustomEvent('dataUpdated'))
                                if (selectedCustomer) {
                                  ledgerLoadInProgressRef.current = null
                                  await loadCustomerData(selectedCustomer.id)
                                  await fetchCustomers()
                                }
                              } else {
                                toast.error(response.message || 'Failed to delete invoice')
                              }
                            } catch (error) {
                              if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to delete invoice')
                            }
                          }
                        })
                      }}
                      onReturnInvoice={(invoiceId) => navigate(`/returns/create?saleId=${invoiceId}`)}
                    />
                  )}

                  {activeTab === 'payments' && (
                    <PaymentsTab
                      payments={customerPayments}
                      user={user}
                      onViewReceipt={(paymentId) => {
                        setReceiptPreviewPaymentIds([paymentId])
                        setShowReceiptPreviewModal(true)
                      }}
                      onGenerateReceiptBatch={(paymentIds) => {
                        setReceiptPreviewPaymentIds(paymentIds)
                        setShowReceiptPreviewModal(true)
                      }}
                      onEditPayment={async (payment) => {
                        // Handle edit payment
                        setDangerModal({
                          isOpen: true,
                          title: 'Edit Payment Amount',
                          message: `Current amount: ${formatCurrency(payment.amount)}`,
                          confirmLabel: 'Next',
                          showInput: true,
                          inputType: 'number',
                          defaultValue: payment.amount,
                          inputPlaceholder: 'New amount',
                          onConfirm: (newAmount) => {
                            const amountValue = parseFloat(newAmount)
                            if (!newAmount || isNaN(amountValue) || amountValue <= 0) {
                              toast.error('Invalid amount. Please enter a valid positive number.')
                              return
                            }

                            const currentMode = payment.method || payment.mode || 'CASH'
                            // Open second modal for mode
                            setDangerModal({
                              isOpen: true,
                              title: 'Edit Payment Mode',
                              message: `Current mode: ${currentMode}\nOptions: CASH, CHEQUE, ONLINE, CREDIT`,
                              confirmLabel: 'Update Payment',
                              showInput: true,
                              defaultValue: currentMode,
                              inputPlaceholder: 'CASH, CHEQUE, ONLINE, or CREDIT',
                              onConfirm: async (newMode) => {
                                const modeUpper = newMode?.trim().toUpperCase()
                                if (!modeUpper || !['CASH', 'CHEQUE', 'ONLINE', 'CREDIT'].includes(modeUpper)) {
                                  toast.error('Invalid payment mode. Please select: CASH, CHEQUE, ONLINE, or CREDIT')
                                  return
                                }

                                try {
                                  toast.loading('Updating payment...', { id: 'update-payment' })

                                  const response = await paymentsAPI.updatePayment(payment.id, {
                                    amount: amountValue,
                                    mode: modeUpper,
                                    reference: payment.ref || payment.reference || null,
                                    paymentDate: payment.paymentDate
                                  })

                                  if (response?.success) {
                                    toast.success('Payment updated successfully', { id: 'update-payment' })
                                    // Refresh customer data
                                    if (selectedCustomer) {
                                      await loadCustomerData(selectedCustomer.id)
                                      await fetchCustomers()
                                      window.dispatchEvent(new CustomEvent('dataUpdated'))
                                    }
                                  } else {
                                    toast.error(response?.message || 'Failed to update payment', { id: 'update-payment' })
                                  }
                                } catch (error) {
                                  console.error('Error updating payment:', error)
                                  const errorMsg = error?.response?.data?.message || error?.message || 'Failed to update payment'
                                  if (!error?._handledByInterceptor) toast.error(errorMsg, { id: 'update-payment' })
                                }
                              }
                            })
                          }
                        })
                      }}
                      onDeletePayment={(payment) => {
                        setDangerModal({
                          isOpen: true,
                          title: 'DELETE PAYMENT',
                          message: `Amount: ${formatCurrency(payment.amount)}\nMode: ${payment.method || payment.mode || 'N/A'}\nDate: ${new Date(payment.paymentDate).toLocaleDateString('en-GB')}\n\nThis will reverse the payment effects on the invoice and customer balance.\n\nAre you sure you want to delete this payment?`,
                          confirmLabel: 'Delete Payment',
                          requireTypedText: 'DELETE', // As this is destructive and critical
                          onConfirm: async () => {
                            try {
                              toast.loading('Deleting payment...', { id: 'delete-payment' })
                              const response = await paymentsAPI.deletePayment(payment.id)
                              if (response?.success) {
                                toast.success('Payment deleted successfully', { id: 'delete-payment' })
                                // Refresh customer data
                                if (selectedCustomer) {
                                  await loadCustomerData(selectedCustomer.id)
                                  await fetchCustomers()
                                  window.dispatchEvent(new CustomEvent('dataUpdated'))
                                }
                              } else {
                                toast.error(response?.message || 'Failed to delete payment', { id: 'delete-payment' })
                              }
                            } catch (error) {
                              console.error('Error deleting payment:', error)
                              const errorMsg = error?.response?.data?.message || error?.message || 'Failed to delete payment'
                              if (!error?._handledByInterceptor) toast.error(errorMsg, { id: 'delete-payment' })
                            }
                          }
                        })
                      }}
                    />
                  )}

                  {activeTab === 'reports' && (
                    <ReportsTab
                      customer={selectedCustomer}
                      summary={customerSummary}
                      invoices={customerInvoices}
                      payments={customerPayments}
                      outstandingInvoices={outstandingInvoices}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Payment Entry Modal */}
      <PaymentEntryModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false)
          resetPaymentForm()
          setPaymentModalInvoiceId(null)
          setPayAllOutstandingMode(false)
        }}
        customer={selectedCustomer}
        invoiceId={paymentModalInvoiceId}
        outstandingInvoices={outstandingInvoices}
        allInvoices={customerInvoices}
        payAllOutstandingMode={payAllOutstandingMode}
        onSubmit={handlePaymentSubmit}
        register={paymentRegister}
        handleSubmit={handlePaymentFormSubmit}
        errors={paymentErrors}
        setValue={setPaymentValue}
        watch={watchPayment}
        loading={paymentLoading}
      />

      {/* Settle Credit Modal — Apply to invoice or Issue refund */}
      {showSettleCreditModal && settleCreditEntry && selectedCustomer && (
        <SettleCreditModal
          isOpen={showSettleCreditModal}
          onClose={() => {
            setShowSettleCreditModal(false)
            setSettleCreditEntry(null)
          }}
          entry={settleCreditEntry}
          customerId={selectedCustomer.id}
          customerName={selectedCustomer.name}
          outstandingInvoices={outstandingInvoices || []}
          onSuccess={async () => {
            setShowSettleCreditModal(false)
            setSettleCreditEntry(null)
            if (selectedCustomer) await loadCustomerData(selectedCustomer.id)
          }}
        />
      )}

      {/* Invoice Preview Modal */}
      {showInvoiceModal && selectedInvoiceForView && (
        <InvoicePreviewModal
          saleId={selectedInvoiceForView}
          invoiceNo={customerInvoices.find(inv => inv.id === selectedInvoiceForView)?.invoiceNo}
          onClose={() => {
            setShowInvoiceModal(false)
            setSelectedInvoiceForView(null)
          }}
          onPrint={async () => {
            try {
              const pdfBlob = await salesAPI.getInvoicePdf(selectedInvoiceForView)
              const url = window.URL.createObjectURL(pdfBlob)
              const printWindow = window.open(url, '_blank')
              if (printWindow) {
                printWindow.onload = () => {
                  printWindow.print()
                }
              }
              setTimeout(() => window.URL.revokeObjectURL(url), 100)
            } catch (error) {
              if (!error?._handledByInterceptor) toast.error(error?.message || 'Failed to print invoice')
            }
          }}
        />
      )}

      {/* Payment Receipt Preview Modal (from ledger) */}
      <ReceiptPreviewModal
        paymentIds={receiptPreviewPaymentIds}
        isOpen={showReceiptPreviewModal}
        onClose={() => {
          setShowReceiptPreviewModal(false)
          setReceiptPreviewPaymentIds([])
        }}
        onSuccess={async () => {
          if (selectedCustomer?.id) await loadCustomerData(selectedCustomer.id)
        }}
      />

      {/* Add Customer Modal */}
      <Modal
        isOpen={showAddCustomerModal}
        onClose={() => {
          setShowAddCustomerModal(false)
          resetCustomerForm()
        }}
        title="Add New Customer"
        size="lg"
      >
        <form
          onSubmit={handleCustomerSubmit((data) => {
            console.log('Customer form submitted with data:', data)
            handleAddCustomer(data)
          }, (errors) => {
            console.log('Customer form validation errors:', errors)
            const errorMessages = Object.values(errors).map(e => e?.message).filter(Boolean)
            if (errorMessages.length > 0) {
              toast.error(errorMessages[0] || 'Please fix the form errors')
            }
          })}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Enter customer name"
                className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${customerErrors.name ? 'border-red-500' : 'border-gray-300'
                  }`}
                {...customerRegister('name', { required: 'Customer name is required' })}
              />
              {customerErrors.name && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                placeholder="+971 50 123 4567 or 050 123 4567"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                {...customerRegister('phone', {
                  validate: (v) => {
                    const s = (v || '').trim()
                    if (!s) return true
                    const uaePhone = /^(\+971|0)(5[0-9]|[1-9])[0-9]{7}$/
                    return uaePhone.test(s.replace(/\s/g, '')) || 'Enter valid UAE phone (+971... or 05X...)'
                  }
                })}
              />
              {customerErrors.phone && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.phone.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                placeholder="customer@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                {...customerRegister('email')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">TRN (15 digits)</label>
              <input
                type="text"
                placeholder="UAE Tax Registration Number"
                maxLength={15}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                {...customerRegister('trn', {
                  validate: (v) => {
                    const s = (v || '').trim()
                    if (!s) return true
                    return /^\d{15}$/.test(s) || 'TRN must be exactly 15 digits'
                  }
                })}
              />
              {customerErrors.trn && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.trn.message}</p>
              )}
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                placeholder="Full address"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                {...customerRegister('address')}
              />
            </div>

            {branches.length > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Branch {branches.length > 0 && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${customerErrors.branchId ? 'border-red-500' : 'border-gray-300'}`}
                    {...customerRegister('branchId', {
                      required: branches.length > 0 ? 'Branch is required when company has branches' : false,
                      onChange: (e) => {
                        setCustomerValue('branchId', e.target.value)
                        setCustomerValue('routeId', '')
                      }
                    })}
                  >
                    <option value="">Select branch</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  {customerErrors.branchId && (
                    <p className="mt-1 text-sm text-red-600">{customerErrors.branchId.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Route {addModalBranchId && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${customerErrors.routeId ? 'border-red-500' : 'border-gray-300'}`}
                    {...customerRegister('routeId', {
                      required: addModalBranchId ? 'Route is required when branch is selected' : false
                    })}
                    disabled={!addModalBranchId}
                  >
                    <option value="">
                      {addModalBranchId ? 'Select route' : 'Select branch first'}
                    </option>
                    {(addModalBranchId ? routes.filter(r => r.branchId === parseInt(addModalBranchId, 10)) : []).map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  {customerErrors.routeId && (
                    <p className="mt-1 text-sm text-red-600">{customerErrors.routeId.message}</p>
                  )}
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Credit Limit (AED)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0 = unlimited"
                className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${customerErrors.creditLimit ? 'border-red-500' : 'border-gray-300'
                  }`}
                {...customerRegister('creditLimit', {
                  valueAsNumber: true,
                  min: { value: 0, message: 'Credit limit must be 0 or greater' }
                })}
              />
              {customerErrors.creditLimit && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.creditLimit.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Terms {(watchCustomer('creditLimit') || 0) > 0 && <span className="text-red-500">*</span>}
              </label>
              <select
                className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${customerErrors.paymentTerms ? 'border-red-500' : 'border-gray-300'}`}
                {...customerRegister('paymentTerms', {
                  validate: (v) => {
                    const creditLimit = watchCustomer('creditLimit')
                    const credit = typeof creditLimit === 'number' ? creditLimit : parseFloat(creditLimit) || 0
                    if (credit > 0 && (!v || !String(v).trim())) return 'Payment terms are required when credit limit is set'
                    return true
                  }
                })}
              >
                <option value="">Select payment terms</option>
                <option value="Cash on Delivery">Cash on Delivery</option>
                <option value="Net 7">Net 7</option>
                <option value="Net 15">Net 15</option>
                <option value="Net 30">Net 30</option>
                <option value="Net 60">Net 60</option>
                <option value="Custom">Custom</option>
              </select>
              {customerErrors.paymentTerms && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.paymentTerms.message}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => {
                setShowAddCustomerModal(false)
                resetCustomerForm()
              }}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={customerLoading || customerLoadingRef.current}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              style={{
                pointerEvents: (customerLoading || customerLoadingRef.current) ? 'none' : 'auto',
                cursor: (customerLoading || customerLoadingRef.current) ? 'not-allowed' : 'pointer',
                position: 'relative',
                zIndex: 10,
                minWidth: '120px'
              }}
            >
              {customerLoading || customerLoadingRef.current ? (
                <span className="flex items-center">
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </span>
              ) : (
                'Add Customer'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Customer Modal */}
      <Modal
        isOpen={showEditCustomerModal}
        onClose={() => {
          setShowEditCustomerModal(false)
          setEditingCustomer(null)
          resetCustomerForm()
        }}
        title="Edit Customer"
        size="lg"
      >
        <form
          onSubmit={handleCustomerSubmit((data) => {
            handleEditCustomer(data)
          }, (errors) => {
            const errorMessages = Object.values(errors).map(e => e?.message).filter(Boolean)
            if (errorMessages.length > 0) {
              toast.error(errorMessages[0] || 'Please fix the form errors')
            }
          })}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Enter customer name"
                className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${customerErrors.name ? 'border-red-500' : 'border-gray-300'
                  }`}
                {...customerRegister('name', { required: 'Customer name is required' })}
              />
              {customerErrors.name && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                placeholder="+971 50 123 4567 or 050 123 4567"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                {...customerRegister('phone', {
                  validate: (v) => {
                    const s = (v || '').trim()
                    if (!s) return true
                    const uaePhone = /^(\+971|0)(5[0-9]|[1-9])[0-9]{7}$/
                    return uaePhone.test(s.replace(/\s/g, '')) || 'Enter valid UAE phone (+971... or 05X...)'
                  }
                })}
              />
              {customerErrors.phone && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.phone.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                placeholder="customer@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                {...customerRegister('email')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">TRN (15 digits)</label>
              <input
                type="text"
                placeholder="UAE Tax Registration Number"
                maxLength={15}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                {...customerRegister('trn', {
                  validate: (v) => {
                    const s = (v || '').trim()
                    if (!s) return true
                    return /^\d{15}$/.test(s) || 'TRN must be exactly 15 digits'
                  }
                })}
              />
              {customerErrors.trn && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.trn.message}</p>
              )}
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                placeholder="Full address"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                {...customerRegister('address')}
              />
            </div>

            {branches.length > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    {...(function () {
                      const r = customerRegister('branchId')
                      return {
                        ...r,
                        onChange: (e) => {
                          r.onChange(e)
                          setCustomerValue('routeId', '')
                        }
                      }
                    })()}
                  >
                    <option value="">All branches</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Route</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    {...customerRegister('routeId')}
                    disabled={!watchCustomer('branchId')}
                  >
                    <option value="">
                      {watchCustomer('branchId') ? 'All routes' : 'Select branch first'}
                    </option>
                    {(watchCustomer('branchId') ? routes.filter(r => r.branchId === parseInt(watchCustomer('branchId'), 10)) : []).map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Credit Limit (AED)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0 = unlimited"
                className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${customerErrors.creditLimit ? 'border-red-500' : 'border-gray-300'
                  }`}
                {...customerRegister('creditLimit', {
                  valueAsNumber: true,
                  min: { value: 0, message: 'Credit limit must be 0 or greater' }
                })}
              />
              {customerErrors.creditLimit && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.creditLimit.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Terms {(watchCustomer('creditLimit') || 0) > 0 && <span className="text-red-500">*</span>}
              </label>
              <select
                className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${customerErrors.paymentTerms ? 'border-red-500' : 'border-gray-300'}`}
                {...customerRegister('paymentTerms', {
                  validate: (v) => {
                    const creditLimit = watchCustomer('creditLimit')
                    const credit = typeof creditLimit === 'number' ? creditLimit : parseFloat(creditLimit) || 0
                    if (credit > 0 && (!v || !String(v).trim())) return 'Payment terms are required when credit limit is set'
                    return true
                  }
                })}
              >
                <option value="">Select payment terms</option>
                <option value="Cash on Delivery">Cash on Delivery</option>
                <option value="Net 7">Net 7</option>
                <option value="Net 15">Net 15</option>
                <option value="Net 30">Net 30</option>
                <option value="Net 60">Net 60</option>
                <option value="Custom">Custom</option>
              </select>
              {customerErrors.paymentTerms && (
                <p className="mt-1 text-sm text-red-600">{customerErrors.paymentTerms.message}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => {
                setShowEditCustomerModal(false)
                setEditingCustomer(null)
                resetCustomerForm()
              }}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={customerLoading || customerLoadingRef.current}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {customerLoading || customerLoadingRef.current ? (
                <span className="flex items-center">
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </span>
              ) : (
                'Update Customer'
              )}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDangerModal
        isOpen={dangerModal.isOpen}
        title={dangerModal.title}
        message={dangerModal.message}
        confirmLabel={dangerModal.confirmLabel}
        requireTypedText={dangerModal.requireTypedText}
        showInput={dangerModal.showInput}
        inputPlaceholder={dangerModal.inputPlaceholder}
        defaultValue={dangerModal.defaultValue}
        inputType={dangerModal.inputType}
        onConfirm={dangerModal.onConfirm}
        onClose={() => setDangerModal(prev => ({ ...prev, isOpen: false }))}
      />

      <ConfirmDangerModal
        isOpen={duplicateCheckModal.isOpen}
        title="Possible Duplicate Customer"
        message={duplicateCheckModal.message}
        confirmLabel="Yes, add anyway"
        onConfirm={() => {
          if (duplicateCheckModal.customerData) {
            doCreateCustomer(duplicateCheckModal.customerData)
            setDuplicateCheckModal({ isOpen: false, message: '', customerData: null })
          }
        }}
        onClose={() => setDuplicateCheckModal({ isOpen: false, message: '', customerData: null })}
      />

      <ConfirmDangerModal
        isOpen={duplicatePaymentModal.isOpen}
        title="Possible Duplicate Payment"
        message={`A payment of ${formatCurrency(duplicatePaymentModal.amount)} was already recorded for this customer today. Record another payment anyway?`}
        confirmLabel="Yes, Record Another"
        onConfirm={async () => {
          if (pendingPaymentRef.current) {
            const { data, idempotencyKey, isAllocate } = pendingPaymentRef.current
            setDuplicatePaymentModal({ isOpen: false })
            pendingPaymentRef.current = null
            await executePaymentApi({ data, idempotencyKey, isAllocate })
          }
        }}
        onClose={() => {
          setDuplicatePaymentModal({ isOpen: false })
          pendingPaymentRef.current = null
        }}
      />
    </div>
  )
}

// Settle Credit Modal — Apply to invoice or Issue refund for Credit Issued returns
const SettleCreditModal = ({ isOpen, onClose, entry, customerId, customerName, outstandingInvoices, onSuccess }) => {
  const [creditNote, setCreditNote] = useState(null)
  const [loading, setLoading] = useState(false)
  const [applySaleId, setApplySaleId] = useState('')
  const [amountToApply, setAmountToApply] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [showRefundConfirm, setShowRefundConfirm] = useState(false)

  useEffect(() => {
    if (!isOpen || !customerId || !entry?.returnId) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const res = await returnsAPI.getCreditNotes({ customerId })
        const list = (res?.success && res?.data) ? res.data : []
        const cn = list.find(c => (c.linkedReturnId ?? c.LinkedReturnId) === entry.returnId)
        if (!cancelled) {
          if (!cn) {
            toast.error('Credit note not found for this return.')
            onClose()
            return
          }
          setCreditNote(cn)
          setApplySaleId('')
          setAmountToApply('')
        }
      } catch (e) {
        if (!cancelled) toast.error(e?.response?.data?.message || 'Failed to load credit note')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [isOpen, customerId, entry?.returnId, onClose])

  const remaining = creditNote ? (Number(creditNote.amount ?? creditNote.Amount) || 0) - (Number(creditNote.appliedAmount ?? creditNote.AppliedAmount) || 0) : 0
  const handleApply = async () => {
    const saleId = parseInt(applySaleId, 10)
    const amount = parseFloat(amountToApply)
    if (!creditNote || !saleId || amount <= 0 || amount > remaining) {
      toast.error('Select an invoice and enter a valid amount.')
      return
    }
    setActionLoading(true)
    try {
      const res = await returnsAPI.applyCreditNote(creditNote.id ?? creditNote.Id, { saleId, amountToApply: amount })
      if (res?.success !== false) {
        toast.success('Credit applied to invoice successfully.')
        onSuccess()
      } else {
        toast.error(res?.message || 'Failed to apply credit')
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to apply credit')
    } finally {
      setActionLoading(false)
    }
  }
  const handleRefundClick = () => {
    if (!creditNote || remaining <= 0) return
    setShowRefundConfirm(true)
  }

  const handleRefundConfirm = async () => {
    if (!creditNote || remaining <= 0) return
    setShowRefundConfirm(false)
    setActionLoading(true)
    try {
      const res = await returnsAPI.refundCreditNote(creditNote.id ?? creditNote.Id)
      if (res?.success !== false) {
        toast.success('Refund issued successfully.')
        onSuccess()
      } else {
        toast.error(res?.message || 'Failed to issue refund')
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to issue refund')
    } finally {
      setActionLoading(false)
    }
  }

  if (!isOpen) return null
  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title="Settle Credit" size="md">
      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : creditNote ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Return <strong>{entry.reference || entry.returnId}</strong> · Credit: <strong>{remaining.toFixed(2)} AED</strong> remaining
          </p>
          <div className="border-t pt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Apply to invoice</p>
            <select
              value={applySaleId}
              onChange={(e) => setApplySaleId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2"
            >
              <option value="">Select invoice</option>
              {(outstandingInvoices || []).filter(inv => (Number(inv.grandTotal) || 0) > 0).map(inv => (
                <option key={inv.id ?? inv.Id} value={inv.id ?? inv.Id}>
                  {inv.invoiceNo ?? inv.InvoiceNo} — {(inv.grandTotal ?? inv.GrandTotal ?? 0).toFixed(2)} AED
                </option>
              ))}
            </select>
            {(outstandingInvoices || []).length === 0 && (
              <p className="text-xs text-amber-700 mb-2">
                This customer has no outstanding invoices. Use <strong>Issue refund</strong> below to settle the credit in cash.
              </p>
            )}
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={remaining}
              value={amountToApply}
              onChange={(e) => setAmountToApply(e.target.value)}
              placeholder="Amount to apply"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2"
            />
            <button
              type="button"
              onClick={handleApply}
              disabled={actionLoading || !applySaleId || !amountToApply}
              className="inline-flex items-center px-3 py-2 bg-primary-600 text-white text-sm font-medium rounded hover:bg-primary-700 disabled:opacity-50"
            >
              {actionLoading ? 'Applying...' : 'Apply to invoice'}
            </button>
          </div>
          <div className="border-t pt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Issue refund</p>
            <button
              type="button"
              onClick={handleRefundClick}
              disabled={actionLoading || remaining <= 0}
              className="inline-flex items-center px-3 py-2 bg-amber-600 text-white text-sm font-medium rounded hover:bg-amber-700 disabled:opacity-50"
            >
              {actionLoading ? 'Processing...' : `Issue refund (${remaining.toFixed(2)} AED)`}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
    <ConfirmDangerModal
      isOpen={showRefundConfirm}
      onClose={() => setShowRefundConfirm(false)}
      onConfirm={handleRefundConfirm}
      title="Issue cash refund"
      message={remaining > 0 ? `Issue cash refund of ${remaining.toFixed(2)} AED for this credit?` : ''}
      confirmLabel="Issue refund"
    />
    </>
  )
}

// Ledger Statement Tab Component - Tally Style Redesign
// CRITICAL: Define default filters OUTSIDE component to prevent TDZ errors
const DEFAULT_LEDGER_FILTERS = { statusFilterValue: 'all', typeFilterValue: 'all' }

// Constants already defined at top of file - do not redefine here

const LedgerStatementTab = ({ ledgerEntries, customer, onExportExcel, onGeneratePDF, onShareWhatsApp, onPrintPreview, onDeleteReturn, onSettleCredit, filters, onFilterChange }) => {
  const navigate = useNavigate()
  // CRITICAL: Initialize safeFilters FIRST before any other code to prevent TDZ errors
  // Use constant property name to prevent minifier from creating 'st' from filters.status
  const hasFilters = filters && typeof filters === 'object'
  const filterStatusValue = (hasFilters && Object.prototype.hasOwnProperty.call(filters, STATUS_PROP)) ? filters[STATUS_PROP] : 'all'
  const filterTypeValue = (hasFilters && Object.prototype.hasOwnProperty.call(filters, TYPE_PROP)) ? filters[TYPE_PROP] : 'all'
  const safeFilters = { statusFilterValue: filterStatusValue, typeFilterValue: filterTypeValue }
  const safeOnFilterChange = onFilterChange || (() => {})
  
  const [displayLimit, setDisplayLimit] = React.useState(100) // Show first 100 entries by default
  const INITIAL_DISPLAY_LIMIT = 100
  const LOAD_MORE_INCREMENT = 100

  // Paginated entries
  const displayedEntries = React.useMemo(() => {
    return ledgerEntries.slice(0, displayLimit)
  }, [ledgerEntries, displayLimit])

  const hasMore = ledgerEntries.length > displayLimit
  const handleLoadMore = () => {
    setDisplayLimit(prev => prev + LOAD_MORE_INCREMENT)
  }

  // Always use the LAST entry of the full ledger (not paginated) for true closing balance
  const lastEntryBalance = ledgerEntries.length > 0 ? ledgerEntries[ledgerEntries.length - 1].balance : 0
  const closingBalance = Number(lastEntryBalance) || 0
  // Totals for summary cards and closing balance footer:
  // - Total Sales (debit) should only include invoice/sale rows
  // - Payments Received (credit) should only include payment rows
  const totalDebit = ledgerEntries.reduce(
    (sum, e) => sum + ((e.type === 'Invoice' || e.type === 'Sale') ? (Number(e.debit) || 0) : 0),
    0
  )
  const totalCredit = ledgerEntries.reduce(
    (sum, e) => sum + (e.type === 'Payment' ? (Number(e.credit) || 0) : 0),
    0
  )

  return (
    <div className="w-full h-full flex flex-col bg-neutral-50 min-w-0">
      {/* Summary Cards - border only per design lock */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-lg border border-neutral-200 p-3 border-l-4 border-l-primary-500">
          <div className="text-xs text-neutral-500 uppercase">Total Sales</div>
          <div className="text-lg font-bold text-neutral-900">{formatCurrency(Number(totalDebit) || 0)}</div>
        </div>
        <div className="bg-white rounded-lg border border-neutral-200 p-3 border-l-4 border-l-green-500">
          <div className="text-xs text-neutral-500 uppercase">Payments Received</div>
          <div className="text-lg font-bold text-green-600">{formatCurrency(Number(totalCredit) || 0)}</div>
        </div>
        <div className={`bg-white rounded-lg border border-neutral-200 p-3 border-l-4 ${closingBalance < 0 ? 'border-l-green-500' : closingBalance > 0 ? 'border-l-red-500' : 'border-l-neutral-500'
          }`}>
          <div className="text-xs text-neutral-500 uppercase">Closing Balance</div>
          <div className={`text-lg font-bold ${closingBalance < 0 ? 'text-green-600' : closingBalance > 0 ? 'text-red-600' : 'text-neutral-900'
            }`}>
            {formatBalance(Number(closingBalance) || 0)}
          </div>
        </div>
      </div>

      {/* Action Bar with Filters */}
      <div className="bg-white rounded-lg border border-neutral-200 mb-3 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-neutral-700">Ledger Statement</span>
          </div>
          <div className="flex items-center space-x-2 flex-wrap">
            <select
              value={safeFilters.statusFilterValue || 'all'}
              onChange={(e) => safeOnFilterChange('status', e.target.value)}
              className="px-2 py-1 text-xs border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="all">All Status</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
            </select>
            <select
              value={safeFilters.typeFilterValue || 'all'}
              onChange={(e) => safeOnFilterChange('type', e.target.value)}
              className="px-2 py-1 text-xs border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="all">All Types</option>
              <option value="Invoice">Invoices</option>
              <option value="Payment">Payments</option>
              <option value="Sale Return">Returns</option>
            </select>
            <button
              onClick={onPrintPreview}
              className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 flex items-center space-x-1"
              title="Print Preview"
            >
              <Eye className="h-3 w-3" />
              <span>Preview</span>
            </button>
            <button
              onClick={onExportExcel}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center space-x-1"
              title="Export to Excel"
            >
              <FileText className="h-3 w-3" />
              <span>Excel</span>
            </button>
            <button
              onClick={onGeneratePDF}
              className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 flex items-center space-x-1"
              title="Download PDF Statement"
            >
              <Printer className="h-3 w-3" />
              <span>PDF</span>
            </button>
            <button
              onClick={onShareWhatsApp}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center space-x-1"
              title="Share via WhatsApp"
            >
              <Send className="h-3 w-3" />
              <span>WhatsApp</span>
            </button>
          </div>
        </div>
      </div>

      {/* Ledger Table - Desktop - full width */}
      <div className="hidden md:block bg-white rounded-lg border border-neutral-200 flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="overflow-x-auto overflow-y-auto flex-1 min-w-0">
          {/* CRITICAL FIX: Ensure table doesn't overflow on tablets - add horizontal scroll wrapper */}
          <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[1000px] divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-100 sticky top-0 z-10 border-b-2 border-neutral-300">
                <tr>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-neutral-700 uppercase whitespace-nowrap border-r border-neutral-300">Date</th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-neutral-700 uppercase whitespace-nowrap border-r border-neutral-300">Type</th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-neutral-700 uppercase whitespace-nowrap border-r border-neutral-300">Invoice No</th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-neutral-700 uppercase whitespace-nowrap border-r border-neutral-300">Payment Mode</th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-neutral-700 uppercase whitespace-nowrap border-r border-neutral-300">Debit (AED)</th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-neutral-700 uppercase whitespace-nowrap border-r border-neutral-300">Credit (AED)</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold text-neutral-700 uppercase whitespace-nowrap border-r border-neutral-300">Status</th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-neutral-700 uppercase whitespace-nowrap border-r border-neutral-300">Balance</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold text-neutral-700 uppercase whitespace-nowrap">Actions</th>
                </tr>
              </thead>
            <tbody className="bg-white divide-y divide-neutral-200">
              {displayedEntries.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-4 py-8 text-center text-neutral-500">
                    No transactions found
                  </td>
                </tr>
              ) : (
                displayedEntries.map((entry, idx) => {
                  // CRITICAL: Initialize all variables at the top to prevent TDZ errors
                  // Use constant property name to prevent minifier from creating 'st' from entry.status
                  const invoiceNo = entry.reference || '-'
                  const entryStatus = entry[STATUS_PROP] ?? (entry.type === 'Payment' ? '-' : '-')
                  
                  // Format date - show time only for payments
                  const showTime = entry.type === 'Payment'
                  const dateStr = showTime
                    ? new Date(entry.date).toLocaleString('en-GB', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })
                    : new Date(entry.date).toLocaleDateString('en-GB', {
                      day: '2-digit', month: '2-digit', year: 'numeric'
                    })

                  // Color coding: Debit = light red, Credit = light green
                  const rowBgColor = entry.debit > 0
                    ? 'bg-red-50 hover:bg-red-100'
                    : entry.credit > 0
                      ? 'bg-green-50 hover:bg-green-100'
                      : 'hover:bg-neutral-50'

                  // CRITICAL: Inline statusColor calculation to prevent minifier conflicts
                  // Calculate status color directly in JSX to avoid TDZ issues
                  const getEntryStatusColor = () => {
                    if (entryStatus === 'Paid') return 'bg-green-100 text-green-800'
                    if (entryStatus === 'Partial') return 'bg-yellow-100 text-yellow-800'
                    if (entryStatus === 'Unpaid') return 'bg-red-100 text-red-800'
                    return ''
                  }

                  return (
                    <tr key={idx} className={rowBgColor}>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-neutral-900 border-r border-neutral-200">
                        {dateStr}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-neutral-900 border-r border-neutral-200">
                        {entry.type}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm font-semibold text-neutral-900 border-r border-neutral-200">
                        {invoiceNo}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-neutral-600 border-r border-neutral-200">
                        {entry.paymentMode || entry.PaymentMode || '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-right font-medium text-neutral-900 border-r border-neutral-200">
                        {(Number(entry.debit) || 0) > 0 ? formatCurrency(Number(entry.debit) || 0) : '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-right font-medium text-neutral-900 border-r border-neutral-200">
                        {(Number(entry.credit) || 0) > 0 ? formatCurrency(Number(entry.credit) || 0) : '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center border-r border-neutral-200">
                        {entryStatus !== '-' ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getEntryStatusColor()}`}>
                            {entryStatus}
                          </span>
                        ) : (
                          <span className="text-sm text-neutral-400">-</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 whitespace-nowrap text-sm text-right font-bold border-r border-neutral-200 ${(Number(entry.balance) || 0) < 0 ? 'text-green-600' : (Number(entry.balance) || 0) > 0 ? 'text-red-600' : 'text-neutral-900'
                        }`}>
                        {formatBalance(Number(entry.balance) || 0)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        {((entry.type === 'Sale' || entry.type === 'Invoice') && (entry.saleId ?? entry.SaleId)) ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/reports?tab=returns&saleId=${entry.saleId ?? entry.SaleId}`)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded hover:bg-amber-200"
                            title="Create return for this bill"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Return
                          </button>
                        ) : entry.type === 'Sale Return' && (entry.returnId ?? entry.ReturnId) ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const blob = await returnsAPI.getReturnBillPdf(entry.returnId ?? entry.ReturnId)
                                  const url = window.URL.createObjectURL(blob)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = `Return_${entry.reference || entry.returnId || entry.ReturnId}_${new Date().toISOString().split('T')[0]}.pdf`
                                  document.body.appendChild(a)
                                  a.click()
                                  window.URL.revokeObjectURL(url)
                                  document.body.removeChild(a)
                                  toast.success('Return bill PDF downloaded')
                                } catch (e) {
                                  if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to generate PDF')
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                              title="View / download return bill PDF"
                            >
                              <FileText className="h-3 w-3" />
                              Return bill
                            </button>
                            {onDeleteReturn && (
                              <button
                                type="button"
                                onClick={() => onDeleteReturn(entry.returnId ?? entry.ReturnId)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded hover:bg-red-200"
                                title="Delete this return"
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete return
                              </button>
                            )}
                            {(entry.status === 'Credit Issued' || entry.status === 'CreditIssued') && onSettleCredit && (
                              <button
                                type="button"
                                onClick={() => onSettleCredit(entry)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200"
                                title="Apply credit to invoice or issue refund"
                              >
                                <CreditCard className="h-3 w-3" />
                                Settle credit
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-neutral-400">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {hasMore && (
              <tfoot className="bg-neutral-50 border-t border-neutral-200">
                <tr>
                  <td colSpan="9" className="px-4 py-3 text-center">
                    <button
                      onClick={handleLoadMore}
                      className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 transition-colors"
                    >
                      Load More ({ledgerEntries.length - displayLimit} remaining)
                    </button>
                    <p className="text-xs text-neutral-500 mt-2">
                      Showing {displayLimit} of {ledgerEntries.length} entries
                    </p>
                  </td>
                </tr>
              </tfoot>
            )}
            <tfoot className="bg-neutral-100 sticky bottom-0 border-t-2 border-neutral-300">
              <tr>
                <td colSpan="4" className="px-3 py-2.5 text-right text-sm font-bold text-neutral-900 border-r border-neutral-300">
                  CLOSING BALANCE:
                </td>
                <td className="px-3 py-2.5 text-right text-sm font-bold text-neutral-900 border-r border-neutral-300">
                  {formatCurrency(Number(totalDebit) || 0)}
                </td>
                <td className="px-3 py-2.5 text-right text-sm font-bold text-neutral-900 border-r border-neutral-300">
                  {formatCurrency(Number(totalCredit) || 0)}
                </td>
                <td className="px-3 py-2.5 text-center text-sm font-bold text-neutral-900 border-r border-neutral-300">
                  -
                </td>
                <td className={`px-3 py-2.5 text-right text-sm font-bold border-r border-neutral-300 ${closingBalance < 0 ? 'text-green-600' : closingBalance > 0 ? 'text-red-600' : 'text-neutral-900'
                  }`}>
                  {formatBalance(Number(closingBalance) || 0)}
                </td>
                <td className="px-3 py-2.5 text-center text-sm font-bold">-</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      </div>

      {/* Ledger Cards - Mobile */}
      <div className="md:hidden flex-1 overflow-y-auto space-y-3 pb-4">
        {displayedEntries.length === 0 ? (
          <div className="bg-white rounded-lg border border-neutral-200 p-6 text-center text-neutral-500 text-sm">
            No transactions found
          </div>
        ) : (
          <>
            {displayedEntries.map((entry, idx) => {
            // CRITICAL: Initialize all variables at the top to prevent TDZ errors
            // Use constant property name to prevent minifier from creating 'st' from entry.status
            const entryStatus = entry[STATUS_PROP] ?? (entry.type === 'Payment' ? '-' : '-')
            const dateStr = entry.type === 'Payment'
              ? new Date(entry.date).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : new Date(entry.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
            return (
              <div key={idx} className={`rounded-lg border p-4 shadow-sm ${(Number(entry.debit) || 0) > 0 ? 'border-red-200 bg-red-50/50' : (Number(entry.credit) || 0) > 0 ? 'border-green-200 bg-green-50/50' : 'bg-white border-neutral-200'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-neutral-900">{entry.type}</p>
                    <p className="text-xs text-neutral-500">{entry.reference || '-'}</p>
                    <p className="text-xs text-neutral-600 mt-0.5">{dateStr}</p>
                  </div>
                  <span className={`text-sm font-bold ${(Number(entry.balance) || 0) < 0 ? 'text-green-600' : (Number(entry.balance) || 0) > 0 ? 'text-red-600' : 'text-neutral-900'}`}>
                    {formatBalance(Number(entry.balance) || 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs text-neutral-600 border-t border-neutral-200 pt-2">
                  <div className="flex gap-2">
                    <span>{(Number(entry.debit) || 0) > 0 ? formatCurrency(Number(entry.debit) || 0) : '-'}</span>
                    <span>{(Number(entry.credit) || 0) > 0 ? formatCurrency(Number(entry.credit) || 0) : '-'}</span>
                    {entryStatus && entryStatus !== '-' && (
                      <span className="font-medium">{entryStatus}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {((entry.type === 'Sale' || entry.type === 'Invoice') && (entry.saleId ?? entry.SaleId)) && (
                      <button
                        type="button"
                        onClick={() => navigate(`/reports?tab=returns&saleId=${entry.saleId ?? entry.SaleId}`)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded hover:bg-amber-200"
                        title="Create return for this bill"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Return
                      </button>
                    )}
                    {entry.type === 'Sale Return' && (entry.returnId ?? entry.ReturnId) && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const blob = await returnsAPI.getReturnBillPdf(entry.returnId ?? entry.ReturnId)
                              const url = window.URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = `Return_${entry.reference || entry.returnId || entry.ReturnId}_${new Date().toISOString().split('T')[0]}.pdf`
                              document.body.appendChild(a)
                              a.click()
                              window.URL.revokeObjectURL(url)
                              document.body.removeChild(a)
                              toast.success('Return bill PDF downloaded')
                            } catch (e) {
                              if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to generate PDF')
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                          title="View / download return bill PDF"
                        >
                          <FileText className="h-3 w-3" />
                          Return bill
                        </button>
                        {onDeleteReturn && (
                          <button
                            type="button"
                            onClick={() => onDeleteReturn(entry.returnId ?? entry.ReturnId)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded hover:bg-red-200"
                            title="Delete this return"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete return
                          </button>
                        )}
                        {(entry.status === 'Credit Issued' || entry.status === 'CreditIssued') && onSettleCredit && (
                          <button
                            type="button"
                            onClick={() => onSettleCredit(entry)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200"
                            title="Apply credit to invoice or issue refund"
                          >
                            <CreditCard className="h-3 w-3" />
                            Settle credit
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {hasMore && (
            <div className="bg-white rounded-lg border border-neutral-200 p-4 text-center">
              <button
                onClick={handleLoadMore}
                className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 transition-colors"
              >
                Load More ({ledgerEntries.length - displayLimit} remaining)
              </button>
              <p className="text-xs text-neutral-500 mt-2">
                Showing {displayLimit} of {ledgerEntries.length} entries
              </p>
            </div>
          )}
        </>
        )}
      </div>
    </div>
  )
}

// Invoices Tab Component
const InvoicesTab = ({ invoices, outstandingInvoices, user, onViewInvoice, onViewPDF, onEditInvoice, onPayInvoice, onUnlockInvoice, onDeleteInvoice, onReturnInvoice }) => {
  const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'owner'
  const canEdit = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'owner' // Admin and Owner can edit

  // Sort by date descending (latest first), then by id descending for stable order
  const sortedInvoices = React.useMemo(() => {
    return [...(invoices || [])].sort((a, b) => {
      const dA = new Date(a.invoiceDate || a.date || 0).getTime()
      const dB = new Date(b.invoiceDate || b.date || 0).getTime()
      if (dB !== dA) return dB - dA
      return (b.id ?? 0) - (a.id ?? 0)
    })
  }, [invoices])

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'paid': return 'bg-green-100 text-green-800'
      case 'partial': return 'bg-yellow-100 text-yellow-800'
      case 'pending': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status) => {
    switch (status?.toLowerCase()) {
      case 'paid': return <CheckCircle className="h-3.5 w-3.5 text-green-600 inline-block mr-1" aria-hidden />
      case 'partial': return <Clock className="h-3.5 w-3.5 text-yellow-600 inline-block mr-1" aria-hidden />
      case 'pending': return <XCircle className="h-3.5 w-3.5 text-red-600 inline-block mr-1" aria-hidden />
      default: return <Clock className="h-3.5 w-3.5 text-neutral-500 inline-block mr-1" aria-hidden />
    }
  }

  // Calculate days overdue for unpaid invoices
  const getDaysOverdue = (invoice) => {
    if (!invoice || invoice.paymentStatus === 'Paid') return null
    const paidAmount = invoice.paidAmount ?? 0
    const grandTotal = invoice.grandTotal || invoice.total || 0
    if (paidAmount >= grandTotal) return null // Fully paid
    
    const invoiceDate = new Date(invoice.invoiceDate || invoice.date || invoice.dueDate)
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : new Date(invoiceDate.getTime() + (30 * 24 * 60 * 60 * 1000)) // Default 30 days
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    dueDate.setHours(0, 0, 0, 0)
    const daysDiff = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24))
    return daysDiff > 0 ? daysDiff : null
  }

  const getAgingBadge = (daysOverdue) => {
    if (!daysOverdue || daysOverdue <= 0) return null
    let color = 'bg-yellow-100 text-yellow-800'
    let text = `${daysOverdue} days overdue`
    if (daysOverdue >= 90) {
      color = 'bg-red-100 text-red-800'
      text = `${daysOverdue} days overdue (Critical)`
    } else if (daysOverdue >= 60) {
      color = 'bg-orange-100 text-orange-800'
      text = `${daysOverdue} days overdue`
    } else if (daysOverdue >= 30) {
      color = 'bg-yellow-100 text-yellow-800'
      text = `${daysOverdue} days overdue`
    }
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color} ml-2`} title={text}>{text}</span>
  }

  const totalInvoices = sortedInvoices.length
  // Use table data for totals so footer matches visible rows (avoids stale outstandingInvoices)
  const totalPending = sortedInvoices.reduce((sum, inv) => {
    const paid = inv.paidAmount ?? 0
    const total = inv.grandTotal || inv.total || 0
    const balance = Math.max(0, total - paid)
    return sum + balance
  }, 0)
  const totalPaid = sortedInvoices
    .filter(inv => inv.paymentStatus === 'Paid')
    .reduce((sum, inv) => sum + (inv.grandTotal || 0), 0)

  return (
    <div className="w-full h-full flex flex-col">
      {/* Invoices Table - Desktop */}
      <div className="hidden md:flex bg-white overflow-hidden flex-1 flex-col w-full">
        <div className="overflow-x-auto overflow-y-auto flex-1 w-full">
          <table className="w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase whitespace-nowrap">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase">Invoice No</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase whitespace-nowrap">Amount</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase whitespace-nowrap">Paid</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase whitespace-nowrap">Balance</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase whitespace-nowrap">Status</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedInvoices.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                    No invoices found
                  </td>
                </tr>
              ) : (
                sortedInvoices.map((invoice) => {
                  // CRITICAL: Initialize all variables at top to prevent TDZ errors
                  // Use the actual paidAmount from backend, or calculate from grandTotal
                  const paidAmount = invoice.paidAmount ?? 0
                  const grandTotal = invoice.grandTotal || invoice.total || 0
                  const balance = grandTotal - paidAmount
                  // Use paymentStatus from backend if available, otherwise calculate
                  const invoiceStatus = invoice.paymentStatus || (balance === 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Pending')

                  return (
                    <tr key={invoice.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                        {new Date(invoice.invoiceDate || invoice.date).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-1.5">
                          <span>{invoice.invoiceNo || `INV-${invoice.id}`}</span>
                          {invoice.isLocked && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800" title="Invoice locked after 48 hours">
                              <Lock className="h-3 w-3 mr-0.5" />
                              Locked
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-right text-gray-900">
                        {formatCurrency(invoice.grandTotal || invoice.total || 0)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-right text-gray-900">
                        {formatCurrency(paidAmount)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-right text-gray-900">
                        {formatCurrency(balance)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center flex-wrap gap-1">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(invoiceStatus)}`}>
                            {getStatusIcon(invoiceStatus)} {invoiceStatus}
                          </span>
                          {getAgingBadge(getDaysOverdue(invoice))}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center text-sm">
                        <div className="flex items-center justify-center gap-1.5 sm:gap-2">
                          {/* Pay Button - Only show if invoice has outstanding balance */}
                          {balance > 0 && onPayInvoice && (
                            <button
                              onClick={() => onPayInvoice(invoice.id)}
                              className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs font-medium flex items-center gap-1 transition-colors shadow-sm"
                              title="Pay Invoice"
                            >
                              <Wallet className="h-3 w-3" />
                              <span className="hidden sm:inline">Pay</span>
                            </button>
                          )}
                          <button
                            onClick={() => onViewInvoice(invoice.id)}
                            className="text-blue-600 hover:text-blue-900 hover:bg-blue-50 p-1 rounded transition-colors"
                            title="View Invoice"
                          >
                            <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          </button>
                          {canEdit && onEditInvoice && !invoice.isLocked && (
                            <button
                              onClick={() => onEditInvoice(invoice.id)}
                              className="text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 p-1 rounded transition-colors"
                              title="Edit Invoice"
                            >
                              <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                          )}
                          {isAdmin && invoice.isLocked && onUnlockInvoice && (
                            <button
                              onClick={() => onUnlockInvoice(invoice.id)}
                              className="text-purple-600 hover:text-purple-900 hover:bg-purple-50 p-1 rounded transition-colors"
                              title="Unlock Invoice (Admin Only)"
                            >
                              <Unlock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                          )}
                          {isAdmin && onDeleteInvoice && (
                            <button
                              onClick={() => onDeleteInvoice(invoice.id)}
                              className="bg-red-50 text-red-600 hover:text-white hover:bg-red-600 border border-red-300 p-1.5 rounded transition-colors shadow-sm"
                              title="Delete Invoice (Admin Only)"
                            >
                              <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                          )}
                          {onReturnInvoice && (
                            <button
                              onClick={() => onReturnInvoice(invoice.id)}
                              className="text-amber-600 hover:text-amber-900 hover:bg-amber-50 p-1 rounded transition-colors"
                              title="Create return for this invoice"
                            >
                              <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => onViewPDF(invoice.id)}
                            className="text-green-600 hover:text-green-900 hover:bg-green-50 p-1 rounded transition-colors"
                            title="PDF"
                          >
                            <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            <tfoot className="bg-gray-50 sticky bottom-0">
              <tr>
                <td colSpan="2" className="px-3 py-2 text-sm font-bold text-gray-900">
                  Total Invoices: {totalInvoices}
                </td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right text-sm font-bold text-green-600">
                  Total Paid: {formatCurrency(totalPaid)}
                </td>
                <td className="px-3 py-2 text-right text-sm font-bold text-red-600">
                  Total Pending: {formatCurrency(totalPending)}
                </td>
                <td colSpan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Invoices Cards - Mobile */}
      <div className="md:hidden flex-1 overflow-y-auto space-y-3 pb-4">
        {sortedInvoices.length === 0 ? (
          <div className="bg-white rounded-lg border border-neutral-200 p-6 text-center text-neutral-500 text-sm">
            No invoices found
          </div>
        ) : (
          sortedInvoices.map((invoice) => {
            // CRITICAL: Initialize all variables at top to prevent TDZ errors
            const paidAmount = invoice.paidAmount ?? 0
            const grandTotal = invoice.grandTotal || invoice.total || 0
            const balance = grandTotal - paidAmount
            const invoiceStatus = invoice.paymentStatus || (balance === 0 ? 'Paid' : paidAmount > 0 ? 'Partial' : 'Pending')
            return (
              <div key={invoice.id} className="bg-white rounded-lg border border-neutral-200 p-4 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-neutral-900">{invoice.invoiceNo || `INV-${invoice.id}`}</p>
                    <p className="text-xs text-neutral-500">
                      {new Date(invoice.invoiceDate || invoice.date).toLocaleDateString('en-GB')}
                    </p>
                    {invoice.isLocked && (
                      <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                        <Lock className="h-3 w-3 mr-0.5" /> Locked
                      </span>
                    )}
                    {getAgingBadge(getDaysOverdue(invoice))}
                  </div>
                  <span className={`text-sm font-bold ${getStatusColor(invoiceStatus)} px-2 py-0.5 rounded`}>
                    {invoiceStatus}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-neutral-600 border-t border-neutral-100 pt-2 mb-3">
                  <span>Amount: {formatCurrency(grandTotal)}</span>
                  <span>Balance: {formatCurrency(balance)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {balance > 0 && onPayInvoice && (
                    <button
                      onClick={() => onPayInvoice(invoice.id)}
                      className="flex-1 min-w-0 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-xs font-medium flex items-center justify-center gap-1"
                    >
                      <Wallet className="h-3.5 w-3.5" /> Pay
                    </button>
                  )}
                  <button
                    onClick={() => onViewInvoice(invoice.id)}
                    className="px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-md text-xs font-medium flex items-center gap-1"
                    aria-label="View invoice"
                  >
                    <Eye className="h-3.5 w-3.5" /> View
                  </button>
                  {canEdit && onEditInvoice && !invoice.isLocked && (
                    <button
                      onClick={() => onEditInvoice(invoice.id)}
                      className="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded-md text-xs font-medium flex items-center gap-1"
                      aria-label="Edit invoice"
                    >
                      <Edit className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                  {isAdmin && invoice.isLocked && onUnlockInvoice && (
                    <button
                      onClick={() => onUnlockInvoice(invoice.id)}
                      className="px-3 py-2 text-purple-600 hover:bg-purple-50 rounded-md text-xs"
                      aria-label="Unlock invoice"
                    >
                      <Unlock className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {isAdmin && onDeleteInvoice && (
                    <button
                      onClick={() => onDeleteInvoice(invoice.id)}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                      aria-label="Delete invoice"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onReturnInvoice && (
                    <button
                      onClick={() => onReturnInvoice(invoice.id)}
                      className="px-3 py-2 text-amber-600 hover:bg-amber-50 rounded-md text-xs font-medium flex items-center gap-1"
                      aria-label="Create return"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Return
                    </button>
                  )}
                  <button
                    onClick={() => onViewPDF(invoice.id)}
                    className="px-3 py-2 text-green-600 hover:bg-green-50 rounded-md text-xs font-medium flex items-center gap-1"
                    aria-label="View PDF"
                  >
                    <FileText className="h-3.5 w-3.5" /> PDF
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// Payments Tab Component
const PaymentsTab = ({ payments, user, onViewReceipt, onEditPayment, onDeletePayment, onGenerateReceiptBatch }) => {
  const [selectedPaymentIds, setSelectedPaymentIds] = useState([])
  const userRole = user?.role?.toLowerCase()
  const canEditDelete = userRole === 'admin' || userRole === 'owner'

  const togglePaymentSelection = (id) => {
    setSelectedPaymentIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleSelectAllPayments = () => {
    if (selectedPaymentIds.length === payments.length) setSelectedPaymentIds([])
    else setSelectedPaymentIds(payments.map(p => p.id))
  }
  const selectedTotal = payments.filter(p => selectedPaymentIds.includes(p.id)).reduce((sum, p) => sum + (p.amount || 0), 0)

  return (
    <div className="w-full h-full flex flex-col">
      <div className="mb-4 flex justify-end flex-shrink-0">
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center space-x-2" aria-label="Filter by mode">
          <Filter className="h-4 w-4" />
          <span>Filter by Mode</span>
        </button>
      </div>

      {/* Payments Table - Desktop */}
      <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-0">
        <div className="overflow-x-auto overflow-y-auto h-full">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {onGenerateReceiptBatch && (
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={payments.length > 0 && selectedPaymentIds.length === payments.length}
                      onChange={toggleSelectAllPayments}
                      className="rounded border-gray-300"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Mode</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Related Invoice</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Reference / Remarks</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={onGenerateReceiptBatch ? 7 : 6} className="px-4 py-8 text-center text-gray-500">
                    No payments found
                  </td>
                </tr>
              ) : (
                payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-gray-50">
                    {onGenerateReceiptBatch && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedPaymentIds.includes(payment.id)}
                          onChange={() => togglePaymentSelection(payment.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {new Date(payment.paymentDate).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {payment.method || payment.mode || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                      {formatCurrency(payment.amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {payment.invoiceNo || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {payment.ref || payment.reference || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => onViewReceipt(payment.id)}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded transition-colors"
                          title="Print receipt (optional – when customer asks)"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        {canEditDelete && onEditPayment && (
                          <button
                            onClick={() => onEditPayment(payment)}
                            className="text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 p-1 rounded transition-colors"
                            title="Edit Payment"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                        )}
                        {canEditDelete && onDeletePayment && (
                          <button
                            onClick={() => onDeletePayment(payment)}
                            className="bg-red-50 text-red-600 hover:text-white hover:bg-red-600 border border-red-300 p-1 rounded transition-colors"
                            title="Delete Payment"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selection action bar - Generate Receipt */}
      {onGenerateReceiptBatch && selectedPaymentIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            {selectedPaymentIds.length} payment(s) selected — Total: {formatCurrency(selectedTotal)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onGenerateReceiptBatch(selectedPaymentIds)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
            >
              <Printer className="h-4 w-4" />
              Generate Receipt
            </button>
            <button
              type="button"
              onClick={() => setSelectedPaymentIds([])}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Payments Cards - Mobile */}
      <div className="md:hidden flex-1 overflow-y-auto space-y-3 pb-4">
        {payments.length === 0 ? (
          <div className="bg-white rounded-lg border border-neutral-200 p-6 text-center text-neutral-500 text-sm">
            No payments found
          </div>
        ) : (
          payments.map((payment) => (
            <div key={payment.id} className="bg-white rounded-lg border border-neutral-200 p-4 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-neutral-900">{formatCurrency(payment.amount)}</p>
                  <p className="text-xs text-neutral-500">{payment.method || payment.mode || '-'}</p>
                  <p className="text-xs text-neutral-600 mt-0.5">
                    {new Date(payment.paymentDate).toLocaleDateString('en-GB')}
                  </p>
                </div>
                {payment.invoiceNo && (
                  <span className="text-xs text-neutral-500">INV: {payment.invoiceNo}</span>
                )}
              </div>
              {(payment.ref || payment.reference) && (
                <p className="text-xs text-neutral-600 border-t border-neutral-100 pt-2 mb-3">
                  Ref: {payment.ref || payment.reference}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onViewReceipt(payment.id)}
                  className="px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-md text-xs font-medium flex items-center gap-1"
                  aria-label="Print receipt (optional)"
                  title="Print receipt when customer asks"
                >
                  <Printer className="h-3.5 w-3.5" /> Receipt
                </button>
                {canEditDelete && onEditPayment && (
                  <button
                    onClick={() => onEditPayment(payment)}
                    className="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded-md text-xs"
                    aria-label="Edit payment"
                  >
                    <Edit className="h-3.5 w-3.5" /> Edit
                  </button>
                )}
                {canEditDelete && onDeletePayment && (
                  <button
                    onClick={() => onDeletePayment(payment)}
                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md text-xs"
                    aria-label="Delete payment"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Reports Tab Component
const ReportsTab = ({ customer, summary, invoices, payments, outstandingInvoices }) => {
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Sales This Month</p>
              <p className="text-lg sm:text-2xl font-bold text-blue-600 mt-2">
                {formatCurrency(summary?.totalSales || 0)}
              </p>
            </div>
            <DollarSign className="h-6 w-6 sm:h-8 sm:w-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm font-medium text-gray-600">Payments Received</p>
              <p className="text-lg sm:text-2xl font-bold text-green-600 mt-2">
                {formatCurrency(summary?.totalPayments || 0)}
              </p>
            </div>
            <CreditCard className="h-6 w-6 sm:h-8 sm:w-8 text-green-600" />
          </div>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs sm:text-sm font-medium text-gray-600">Overdue Invoices</p>
              <p className="text-lg sm:text-2xl font-bold text-red-600 mt-2">
                {outstandingInvoices.filter(inv => inv.daysOverdue > 0).length}
              </p>
            </div>
            <Clock className="h-6 w-6 sm:h-8 sm:w-8 text-red-600" />
          </div>
        </div>
      </div>

      {/* Pending Bills List */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Pending Bills List</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Invoice No</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Paid</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Days Overdue</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {outstandingInvoices.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                    No pending bills
                  </td>
                </tr>
              ) : (
                outstandingInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {inv.invoiceNo}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {new Date(inv.invoiceDate).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      {formatCurrency(Number(inv.grandTotal) || 0)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                      {formatCurrency(Number(inv.paidAmount) || 0)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-red-600">
                      {formatCurrency(Number(inv.balanceAmount) || 0)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${inv.daysOverdue > 30 ? 'bg-red-100 text-red-800' :
                        inv.daysOverdue > 0 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                        {(Number(inv.daysOverdue) || 0)} days
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Payment Entry Modal Component
const PaymentEntryModal = ({
  isOpen,
  onClose,
  customer,
  invoiceId, // Pre-selected invoice ID (from Pay button)
  outstandingInvoices,
  allInvoices = [], // All customer invoices (not just outstanding)
  payAllOutstandingMode = false,
  onSubmit,
  register,
  handleSubmit,
  errors,
  setValue,
  watch,
  loading = false
}) => {
  const selectedSaleId = watch('saleId')

  // Combine outstanding and all invoices, prioritizing outstanding ones
  const allAvailableInvoices = useMemo(() => {
    // Add all invoices, but use outstanding invoice data if available (has balance info)
    const invoiceMap = new Map()

    // First add outstanding invoices
    outstandingInvoices.forEach(inv => {
      invoiceMap.set(inv.id, {
        ...inv,
        isOutstanding: true,
        balanceAmount: inv.balanceAmount || 0
      })
    })

    // Then add all other invoices that aren't outstanding
    allInvoices.forEach(inv => {
      if (!invoiceMap.has(inv.id)) {
        const paidAmount = inv.paidAmount || 0
        const grandTotal = inv.grandTotal || inv.total || 0
        const balanceAmount = grandTotal - paidAmount

        invoiceMap.set(inv.id, {
          id: inv.id,
          invoiceNo: inv.invoiceNo || `INV-${inv.id}`,
          invoiceDate: inv.invoiceDate || inv.date,
          grandTotal: grandTotal,
          paidAmount: paidAmount,
          balanceAmount: balanceAmount,
          isOutstanding: balanceAmount > 0,
          paymentStatus: inv.paymentStatus || (balanceAmount > 0 ? 'Pending' : 'Paid')
        })
      }
    })

    // Sort: outstanding first, then by date
    return Array.from(invoiceMap.values()).sort((a, b) => {
      if (a.isOutstanding !== b.isOutstanding) {
        return a.isOutstanding ? -1 : 1
      }
      return new Date(b.invoiceDate) - new Date(a.invoiceDate)
    })
  }, [outstandingInvoices, allInvoices])

  // Load invoice amount when modal opens with pre-selected invoice
  useEffect(() => {
    if (isOpen && invoiceId && !payAllOutstandingMode) {
      setValue('saleId', invoiceId.toString())
      // Find invoice and auto-fill amount
      const selectedInv = allAvailableInvoices.find(inv => inv.id === invoiceId)
      if (selectedInv) {
        setValue('amount', selectedInv.balanceAmount || selectedInv.outstandingAmount || 0)
      } else {
        // Try to fetch from API if not in list
        paymentsAPI.getInvoiceAmount(invoiceId).then(response => {
          if (response?.data?.success && response.data.data) {
            const inv = response.data.data
            setValue('amount', inv.outstandingAmount || 0)
          }
        }).catch(err => console.error('Failed to load invoice amount:', err))
      }
    } else if (isOpen && !invoiceId && !payAllOutstandingMode) {
      // Reset when modal opens without pre-selected invoice - use default values
      setValue('saleId', '')
      setValue('amount', '')
      setValue('paymentDate', new Date().toISOString().split('T')[0])
      setValue('method', 'CASH')
    } else if (isOpen && payAllOutstandingMode) {
      setValue('saleId', '')
      const total = outstandingInvoices.reduce((s, inv) => s + (Number(inv.balanceAmount) || 0), 0)
      setValue('amount', total)
      setValue('paymentDate', new Date().toISOString().split('T')[0])
      setValue('method', 'CASH')
    }
  }, [isOpen, invoiceId, payAllOutstandingMode, allAvailableInvoices, outstandingInvoices, setValue])

  // Auto-fill amount when invoice selection changes
  useEffect(() => {
    if (customer && selectedSaleId && isOpen) {
      const selectedInv = allAvailableInvoices.find(inv => inv.id === parseInt(selectedSaleId))
      if (selectedInv && selectedInv.balanceAmount > 0) {
        setValue('amount', selectedInv.balanceAmount)
      }
    }
  }, [selectedSaleId, customer, allAvailableInvoices, setValue, isOpen])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Add Payment for Customer – ${customer?.name || ''}`}
      size="lg"
    >
      <form onSubmit={handleSubmit((data) => {
        console.log('Payment form submitted with data:', data)
        onSubmit(data)
      }, (errors) => {
        console.log('Payment form validation errors:', errors)
        const errorMessages = Object.values(errors).map(e => e?.message).filter(Boolean)
        if (errorMessages.length > 0) {
          toast.error(errorMessages[0] || 'Please fix the form errors before submitting')
        }
      })} className="space-y-4">
        {payAllOutstandingMode && (
          <div className="col-span-2 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
            <p className="text-sm font-medium text-emerald-800 flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Pay All Outstanding
            </p>
            <p className="text-sm text-emerald-700 mt-1">
              Payment will be allocated across {outstandingInvoices.length} invoice(s) — Total: {formatCurrency(outstandingInvoices.reduce((s, inv) => s + (Number(inv.balanceAmount) || 0), 0))}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Date"
            type="date"
            defaultValue={new Date().toISOString().split('T')[0]}
            required
            error={errors.paymentDate?.message}
            {...register('paymentDate', { required: 'Date is required' })}
          />

          {!payAllOutstandingMode && (
            <Select
              label="Invoice Number (Optional)"
              options={[
                { value: '', label: '-- No Invoice (General Payment) --' },
                ...allAvailableInvoices.map(inv => ({
                  value: inv.id,
                  label: `${inv.invoiceNo} - ${formatCurrency(inv.grandTotal)} - ${inv.balanceAmount > 0 ? `Balance: ${formatCurrency(inv.balanceAmount)}` : 'Paid'}`
                }))
              ]}
              error={errors.saleId?.message}
              {...register('saleId')}
            />
          )}

          <Input
            label="Amount"
            type="number"
            step="0.01"
            placeholder="0.00"
            required
            error={errors.amount?.message}
            {...register('amount', {
              required: 'Amount is required',
              min: { value: 0.01, message: 'Amount must be greater than 0' }
            })}
          />

          <Select
            label="Payment Mode"
            options={[
              { value: 'CASH', label: 'Cash' },
              { value: 'CHEQUE', label: 'Cheque' },
              { value: 'ONLINE', label: 'Online Transfer' },
              { value: 'CREDIT', label: 'Credit' }
            ]}
            required
            error={errors.method?.message || errors.mode?.message}
            {...register('method', { required: 'Payment method is required' })}
          />

          <div className="col-span-2">
            <Input
              label="Reference / Remarks"
              placeholder="Cheque number, transaction reference, notes..."
              error={errors.ref?.message}
              {...register('ref')}
            />
          </div>
        </div>

        {!payAllOutstandingMode && selectedSaleId && (
          <div className={`border rounded-lg p-4 ${allAvailableInvoices.find(inv => inv.id === parseInt(selectedSaleId))?.isOutstanding
            ? 'bg-blue-50 border-blue-200'
            : 'bg-gray-50 border-gray-200'
            }`}>
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className={allAvailableInvoices.find(inv => inv.id === parseInt(selectedSaleId))?.isOutstanding ? 'text-blue-900' : 'text-gray-700'}>
                Selected Invoice Details:
              </span>
            </p>
            {(() => {
              const selectedInv = allAvailableInvoices.find(inv => inv.id === parseInt(selectedSaleId))
              if (selectedInv) {
                return (
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="font-medium text-gray-600">Invoice No:</span>
                        <span className="ml-2 font-semibold">{selectedInv.invoiceNo}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-600">Date:</span>
                        <span className="ml-2">{new Date(selectedInv.invoiceDate).toLocaleDateString('en-GB')}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-600">Total Amount:</span>
                        <span className="ml-2 font-semibold">{formatCurrency(selectedInv.grandTotal)}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-600">Paid:</span>
                        <span className="ml-2 font-semibold text-green-600">{formatCurrency(selectedInv.paidAmount)}</span>
                      </div>
                    </div>
                    {selectedInv.balanceAmount > 0 ? (
                      <div className="pt-2 border-t border-blue-300">
                        <p className="text-red-600 font-bold text-base">
                          Balance Due: {formatCurrency(selectedInv.balanceAmount)}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          Payment will be allocated to this invoice
                        </p>
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-gray-300">
                        <p className="text-green-600 font-semibold">
                          Invoice is fully paid
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          This payment will be recorded as a general payment (not allocated to invoice)
                        </p>
                      </div>
                    )}
                  </div>
                )
              }
              return null
            })()}
          </div>
        )}

        {!payAllOutstandingMode && !selectedSaleId && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800 flex items-center gap-2">
              <span className="font-medium">General Payment:</span>
              <span>This payment will not be allocated to any specific invoice. You can select an invoice above to allocate the payment.</span>
            </p>
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            style={{
              pointerEvents: loading ? 'none' : 'auto',
              cursor: loading ? 'not-allowed' : 'pointer',
              position: 'relative',
              zIndex: 10,
              minWidth: '140px'
            }}
          >
            {loading ? (
              <span className="flex items-center">
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </span>
            ) : (
              'Save Payment'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default CustomerLedgerPage


