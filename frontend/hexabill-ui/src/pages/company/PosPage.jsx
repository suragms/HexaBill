import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Save,
  Printer,
  User,
  Calculator,
  AlertTriangle,
  X,
  ChevronDown,
  MessageCircle,
  Mail,
  Download,
  CheckCircle,
  Lock,
  Bookmark,
  RotateCcw,
  Package,
  RefreshCw
} from 'lucide-react'
import { productsAPI, salesAPI, customersAPI, settingsAPI } from '../../services'
import { formatCurrency, formatBalance, formatBalanceWithColor } from '../../utils/currency'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'
import { useBranding } from '../../contexts/TenantBrandingContext'
import toast from 'react-hot-toast'
import { showToast } from '../../utils/toast'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import PrintOptionsModal from '../../components/PrintOptionsModal'

import { getApiBaseUrl } from '../../services/apiConfig'
const API_BASE_URL = getApiBaseUrl()

/** Map API PaymentMode (e.g. CASH) to POS payment dropdown values (Cash, Debit, …). */
function normalizeApiPaymentMethodToUi(method) {
  if (!method) return 'Cash'
  const u = String(method).toUpperCase()
  const map = { CASH: 'Cash', CHEQUE: 'Cheque', ONLINE: 'Online', CREDIT: 'Credit', DEBIT: 'Debit' }
  return map[u] || (String(method).charAt(0).toUpperCase() + String(method).slice(1).toLowerCase())
}

const PosPage = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { companyName } = useBranding()
  const { branches, routes, staffHasNoAssignments, loading: branchesRoutesLoading, refresh: refreshBranchesRoutes } = useBranchesRoutes()
  const [searchParams, setSearchParams] = useSearchParams()
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [cart, setCart] = useState([])
  // Track if customer was intentionally changed by user during edit mode
  const [customerChangedDuringEdit, setCustomerChangedDuringEdit] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customerSearchTerm, setCustomerSearchTerm] = useState('')
  const [showCustomerSearch, setShowCustomerSearch] = useState(false)
  const [showQuickCustomerDropdown, setShowQuickCustomerDropdown] = useState(false)
  const [showProductDropdown, setShowProductDropdown] = useState({})
  const [productSearchTerms, setProductSearchTerms] = useState({}) // Search term for each row
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [discount, setDiscount] = useState(0)
  const [discountInput, setDiscountInput] = useState('')
  const [roundOff, setRoundOff] = useState(0)
  const [roundOffInput, setRoundOffInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [showInvoiceOptionsModal, setShowInvoiceOptionsModal] = useState(false)
  const [showPrintFormatModal, setShowPrintFormatModal] = useState(false)
  const [lastCreatedInvoice, setLastCreatedInvoice] = useState(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editingSaleId, setEditingSaleId] = useState(null)
  const [editingSale, setEditingSale] = useState(null)
  const [loadingSale, setLoadingSale] = useState(false)
  const [editReason, setEditReason] = useState('')
  const [showEditReasonModal, setShowEditReasonModal] = useState(false)
  const [showEditConfirmModal, setShowEditConfirmModal] = useState(false) // Confirm dialog for editing paid invoices
  const [pendingSaveData, setPendingSaveData] = useState(null) // Store data when awaiting confirmation
  const [invoiceDate, setInvoiceDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0] // YYYY-MM-DD format
  })
  const [showPaymentSheet, setShowPaymentSheet] = useState(false) // Mobile: payment in bottom sheet
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [nextInvoiceNumberPreview, setNextInvoiceNumberPreview] = useState('')
  const [isZeroInvoice, setIsZeroInvoice] = useState(false) // Free sample / zero value invoice (FTA)
  // VAT from company settings; fallback only when settings unavailable (PRODUCTION_MASTER_TODO #4)
  const FALLBACK_VAT_PERCENT = 5
  const [vatPercent, setVatPercent] = useState(FALLBACK_VAT_PERCENT)

  // Hold/Resume invoice — saved to server
  const [heldInvoices, setHeldInvoices] = useState([])
  const [loadingHeldInvoices, setLoadingHeldInvoices] = useState(false)
  const [showHoldModal, setShowHoldModal] = useState(false)
  const [showResumeModal, setShowResumeModal] = useState(false)
  const [holdNameInput, setHoldNameInput] = useState('')

  const [dangerModal, setDangerModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    showInput: false,
    inputPlaceholder: '',
    defaultValue: '',
    onConfirm: () => { }
  })

  const customerInputRef = useRef(null)
  const productSearchRefs = useRef({})
  const lastAddedRowIndexRef = useRef(null)

  // Auto-check Free sample when all cart items with qty>0 have unitPrice 0
  useEffect(() => {
    const itemsWithQty = cart.filter(item => item.productId && (Number(item.qty) || 0) > 0)
    const hasPricedItem = itemsWithQty.some(item => (Number(item.unitPrice) || 0) > 0)
    const allZeroPrice = itemsWithQty.length > 0 && itemsWithQty.every(item => (Number(item.unitPrice) || 0) === 0)
    if (hasPricedItem) setIsZeroInvoice(false)
    else if (allZeroPrice) setIsZeroInvoice(true)
  }, [cart])

  // Define loadProducts before useEffect
  const loadProducts = useCallback(async () => {
    try {
      setLoadingProducts(true)
      const response = await productsAPI.getProducts({ pageSize: 200 })
      if (response.success) {
        setProducts(response.data.items || [])
      }
    } catch (error) {
      if (!error?._handledByInterceptor) toast.error('Failed to load products')
    } finally {
      setLoadingProducts(false)
    }
  }, [])

  const loadCustomers = useCallback(async () => {
    try {
      const params = { pageSize: 100 }
      if (selectedBranchId) params.branchId = parseInt(selectedBranchId, 10)
      if (selectedRouteId) params.routeId = parseInt(selectedRouteId, 10)
      const response = await customersAPI.getCustomers(params)
      if (response.success && response.data?.items) {
        // Dedupe by id so the same customer never appears twice (e.g. after invoice or refetch)
        const byId = new Map()
        response.data.items.forEach(c => { if (c?.id != null && !byId.has(c.id)) byId.set(c.id, c) })
        setCustomers(Array.from(byId.values()))
      }
    } catch (error) {
      if (!error?._handledByInterceptor) toast.error('Failed to load customers')
    }
  }, [selectedBranchId, selectedRouteId])

  // Auto-select branch and route when only one option (all users: Owner, Admin, Staff)
  useEffect(() => {
    if (!user) return

    // Auto-select Branch if only 1 is available
    if (branches.length === 1 && !selectedBranchId) {
      setSelectedBranchId(String(branches[0].id))
    }

    // Auto-select Route if only 1 is available (considering branch filter)
    const availableRoutes = selectedBranchId
      ? routes.filter(r => r.branchId === parseInt(selectedBranchId, 10))
      : routes

    if (availableRoutes.length === 1 && !selectedRouteId) {
      setSelectedRouteId(String(availableRoutes[0].id))
    }
  }, [branches, routes, user, selectedBranchId, selectedRouteId])

  // Auto-fill Branch and Route from selected customer (Owner/Staff see customer's assigned branch/route)
  // BUG #4 FIX: Wait for branches/routes to load before setting (prevents race condition)
  useEffect(() => {
    if (!selectedCustomer?.id) return
    // Wait for branches and routes to be loaded before auto-selecting
    if (branches.length === 0 || routes.length === 0) return
    
    const bid = selectedCustomer.branchId != null ? Number(selectedCustomer.branchId) : null
    const rid = selectedCustomer.routeId != null ? Number(selectedCustomer.routeId) : null
    if (bid != null && branches.some(b => b.id === bid)) {
      setSelectedBranchId(String(bid))
    }
    if (rid != null && routes.some(r => r.id === rid)) {
      setSelectedRouteId(String(rid))
    }
  }, [selectedCustomer?.id, selectedCustomer?.branchId, selectedCustomer?.routeId, branches, routes])

  // If customer was selected but has no branchId/routeId (e.g. stale list or temp object), fetch full customer and set branch/route
  useEffect(() => {
    if (!selectedCustomer?.id || selectedCustomer.id === 'cash') return
    const hasBranchOrRoute = selectedCustomer.branchId != null || selectedCustomer.routeId != null
    if (hasBranchOrRoute) return
    let cancelled = false
    customersAPI.getCustomer(selectedCustomer.id)
      .then(res => {
        if (cancelled) return
        const data = res?.data ?? res
        if (!data?.id) return
        const bid = data.branchId != null ? Number(data.branchId) : null
        const rid = data.routeId != null ? Number(data.routeId) : null
        if (bid != null && branches.some(b => b.id === bid)) setSelectedBranchId(String(bid))
        if (rid != null && routes.some(r => r.id === rid)) setSelectedRouteId(String(rid))
        setSelectedCustomer(prev => prev && prev.id === data.id ? { ...prev, branchId: data.branchId, routeId: data.routeId } : prev)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedCustomer?.id])

  // Fetch VAT percentage from company settings (no hardcoded business rule)
  useEffect(() => {
    const fetchVatPercent = async () => {
      try {
        const response = await settingsAPI.getCompanySettings()
        if (response?.success && response?.data?.vatPercent != null) {
          const fromSettings = parseFloat(response.data.vatPercent)
          if (!Number.isNaN(fromSettings) && fromSettings >= 0) setVatPercent(fromSettings)
        }
      } catch (error) {
        if (!error?.isConnectionBlocked) console.error('Failed to fetch VAT percentage:', error)
        // Keep FALLBACK_VAT_PERCENT on error (display only; backend uses company settings for sale creation)
      }
    }
    fetchVatPercent()
  }, [])

  // Fetch next invoice number for display (real number instead of "Auto-generated")
  useEffect(() => {
    if (!user) return
    let cancelled = false
    salesAPI.getNextInvoiceNumber()
      .then(res => {
        if (cancelled) return
        const num = res?.data ?? res?.invoiceNo ?? res
        if (typeof num === 'string' && num) setNextInvoiceNumberPreview(num)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user])

  // Load sale for editing
  const loadSaleForEdit = useCallback(async (saleId) => {
    try {
      setLoadingSale(true)
      const response = await salesAPI.getSale(saleId)
      if (response.success && response.data) {
        const sale = response.data
        setIsEditMode(true)
        setEditingSaleId(saleId)
        setEditingSale(sale) // Store the full sale object

        // Set customer - try to find in customers array, or create temporary customer object
        if (sale.customerId) {
          if (customers.length > 0) {
            const customer = customers.find(c => c.id === sale.customerId)
            if (customer) {
              setSelectedCustomer(customer)
            } else {
              // Customer not found in list, create temporary customer object
              setSelectedCustomer({
                id: sale.customerId,
                name: sale.customerName || 'Unknown Customer',
                phone: '',
                email: '',
                address: ''
              })
            }
          } else {
            // Customers not loaded yet, create temporary customer object
            // Will be updated when customers load
            setSelectedCustomer({
              id: sale.customerId,
              name: sale.customerName || 'Unknown Customer',
              phone: '',
              email: '',
              address: ''
            })
          }
        }

        // Set discount, notes, zero invoice
        setIsZeroInvoice(!!sale.isZeroInvoice)
        if (sale.discount) {
          setDiscount(sale.discount)
          setDiscountInput(sale.discount.toString())
        } else {
          setDiscountInput('')
        }
        const ro = sale.roundOff != null ? Number(sale.roundOff) : 0
        setRoundOff(ro)
        setRoundOffInput(ro === 0 ? '' : ro.toString())
        if (sale.notes) setNotes(sale.notes)

        if (sale.branchId != null && branches?.some(b => b.id === sale.branchId)) {
          setSelectedBranchId(String(sale.branchId))
        }
        if (sale.routeId != null && routes?.some(r => r.id === sale.routeId)) {
          setSelectedRouteId(String(sale.routeId))
        }

        // Load cart items from sale
        if (sale.items && sale.items.length > 0) {
          const cartItems = sale.items.map(item => ({
            productId: item.productId,
            productName: item.productName || '',
            unitType: item.unitType || '',
            qty: item.qty || 0,
            unitPrice: item.unitPrice || 0,
            discount: item.discount || 0, // Per-item discount
            vatAmount: item.vatAmount || 0,
            lineTotal: item.lineTotal || 0
          }))
          setCart(cartItems)
        }

        // Payment method / amount (API returns PaymentMode like CASH; map to UI labels)
        if (sale.payments && sale.payments.length > 0) {
          const payment = sale.payments[0]
          setPaymentMethod(normalizeApiPaymentMethodToUi(payment.method))
          setPaymentAmount(payment.amount != null ? String(payment.amount) : '')
        } else {
          const st = (sale.paymentStatus || '').toLowerCase()
          if (sale.customerId && (st === 'pending' || st === 'partial')) {
            setPaymentMethod('Pending')
            const out = (Number(sale.grandTotal) || 0) - (Number(sale.paidAmount) || 0)
            setPaymentAmount(out > 0 ? String(out) : '')
          } else {
            setPaymentMethod('Cash')
            setPaymentAmount('')
          }
        }

        // Load invoice date from sale
        if (sale.invoiceDate) {
          const date = new Date(sale.invoiceDate)
          setInvoiceDate(date.toISOString().split('T')[0])
        }

        toast.success(`Invoice ${sale.invoiceNo || saleId} loaded for editing`, { id: 'invoice-load', duration: 3000 })
      } else {
        toast.error(response.message || 'Failed to load invoice')
        // Clear edit mode if failed
        setIsEditMode(false)
        setEditingSaleId(null)
        setSearchParams({}) // Clear URL param
      }
    } catch (error) {
      console.error('Failed to load sale for edit:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load invoice for editing')
      setIsEditMode(false)
      setEditingSaleId(null)
      setSearchParams({}) // Clear URL param
    } finally {
      setLoadingSale(false)
    }
  }, [customers, branches, routes, setSearchParams])

  // When branches/routes load after opening edit, apply sale branch/route if not yet selected
  useEffect(() => {
    if (!isEditMode || !editingSale) return
    const bid = editingSale.branchId
    const rid = editingSale.routeId
    if (bid != null && branches?.length && branches.some(b => b.id === bid)) {
      setSelectedBranchId(String(bid))
    }
    if (rid != null && routes?.length && routes.some(r => r.id === rid)) {
      setSelectedRouteId(String(rid))
    }
  }, [isEditMode, editingSale, branches, routes])

  useEffect(() => {
    loadProducts()
    loadCustomers()
    // Branches/routes from shared context - no per-page fetch
    // Auto-refresh products and customers every 60 seconds (reduced frequency)
    // Only refresh if page is visible and not in edit mode
    const refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && !isEditMode && !loading) {
        loadProducts()
        loadCustomers()
      }
    }, 60000) // 60 seconds - reduced from 15

    // Click outside handler for product dropdowns - use mousedown to prevent conflicts
    const handleClickOutside = (e) => {
      // Only close if clicking outside the dropdown container
      const dropdownContainer = e.target.closest('.product-dropdown-container')
      if (!dropdownContainer) {
        setShowProductDropdown({})
        // Clear search terms when clicking outside
        setProductSearchTerms({})
      }
    }

    // Auto-refresh when page becomes visible (user returns from other tab/window)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadProducts()
        loadCustomers()
      }
    }

    // Use mousedown instead of click to avoid conflicts with onClick handlers
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(refreshInterval)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadProducts, loadCustomers])

  // Held invoices are now stored server-side - no localStorage needed

  // Check for editId in URL - load sale even if customers aren't loaded yet
  useEffect(() => {
    const editIdParam = searchParams.get('editId')
    if (editIdParam && !isEditMode && !loadingSale) {
      const saleId = parseInt(editIdParam)
      if (saleId && !isNaN(saleId)) {
        loadSaleForEdit(saleId)
      }
    }
  }, [searchParams, isEditMode, loadingSale, loadSaleForEdit])

  // Explicit refresh for Phase 3: refetch products, customers, branches/routes (Staff: only assigned)
  const [refreshingData, setRefreshingData] = useState(false)
  const handleRefreshData = async () => {
    if (refreshingData) return
    setRefreshingData(true)
    try {
      await Promise.all([loadProducts(), loadCustomers(), refreshBranchesRoutes()])
      toast.success('Data refreshed')
    } catch (_) {
      toast.error('Refresh failed')
    } finally {
      setRefreshingData(false)
    }
  }

  // Listen for data update events to refresh when payments are made
  useEffect(() => {
    const handleDataUpdate = () => {
      // Only refresh products and customers, not the current edit mode
      loadProducts()
      loadCustomers()
    }

    window.addEventListener('dataUpdated', handleDataUpdate)

    return () => {
      window.removeEventListener('dataUpdated', handleDataUpdate)
    }
  }, [loadProducts, loadCustomers])

  // Refetch customers when user returns to POS (fixes customer list not showing after tab switch or navigation)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadCustomers()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [loadCustomers])

  // Update customer when customers are loaded and we're in edit mode
  // CRITICAL: Only set customer on INITIAL load, not when user changes it
  useEffect(() => {
    // Skip if user has intentionally changed the customer during edit
    if (customerChangedDuringEdit) {
      return
    }

    if (isEditMode && editingSale && editingSale.customerId && customers.length > 0) {
      const customer = customers.find(c => c.id === editingSale.customerId)
      // Only set if customer found and current selection doesn't match
      if (customer && (!selectedCustomer || selectedCustomer.id !== customer.id)) {
        setSelectedCustomer(customer)
      }
    }
  }, [customers, isEditMode, editingSale, customerChangedDuringEdit])

  // UX: After adding a row, scroll to and focus the new product field (design lock: Add Bill auto-scroll)
  useEffect(() => {
    const idx = lastAddedRowIndexRef.current
    if (idx === null) return
    lastAddedRowIndexRef.current = null
    const el = productSearchRefs.current[idx]
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
        setTimeout(() => el.focus(), 300)
      })
    }
  }, [cart.length])

  const filteredCustomers = customers
    .filter((c, i, arr) => arr.findIndex(x => String(x.id) === String(c.id)) === i)
    .filter(customer =>
      customer.name?.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
      customer.phone?.includes(customerSearchTerm)
    )

  // Filter products based on search term for each row
  const getFilteredProducts = (rowIndex) => {
    const searchTerm = productSearchTerms[rowIndex] || ''
    if (!searchTerm.trim()) {
      // Show all products when no search (or first 50 for better performance)
      return products.slice(0, 50)
    }

    const term = searchTerm.toLowerCase()
    const filtered = products.filter(product =>
      product.nameEn?.toLowerCase().includes(term) ||
      product.nameAr?.toLowerCase().includes(term) ||
      product.sku?.toLowerCase().includes(term) ||
      product.barcode?.toLowerCase().includes(term)
    )
    // Show up to 50 results for better visibility
    return filtered.slice(0, 50)
  }

  const addToCart = (product, rowIndex = null) => {
    // CRITICAL FIX: Ensure price is populated - use sellPrice or costPrice as fallback
    const unitPrice = product.sellPrice || product.costPrice || 0

    // OPTIMISTIC UI: Instant update - React state updates are already synchronous and instant
    const qty = 1
    const itemDiscount = 0 // Default discount per item
    const rowTotal = (qty * unitPrice) - itemDiscount
    const vatAmount = Math.round((rowTotal * (vatPercent / 100)) * 100) / 100
    const lineTotal = rowTotal + vatAmount

    // If rowIndex is provided, replace that specific row
    if (rowIndex !== null && rowIndex >= 0 && rowIndex < cart.length) {
      const newCart = [...cart]
      newCart[rowIndex] = {
        productId: product.id,
        productName: product.nameEn,
        sku: product.sku,
        unitType: product.unitType || 'CRTN', // Fallback to CRTN if null
        qty: qty,
        unitPrice: unitPrice, // FIXED: Use calculated unitPrice
        discount: itemDiscount, // Per-item discount
        vatAmount: vatAmount,
        lineTotal: lineTotal
      }
      setCart(newCart)

      // Close dropdown IMMEDIATELY for this row
      setShowProductDropdown(prev => ({ ...prev, [rowIndex]: false }))
      setProductSearchTerms(prev => {
        const newTerms = { ...prev }
        delete newTerms[rowIndex]
        return newTerms
      })

      // Silent - cart update is visual feedback
    } else {
      // Otherwise, check if product already exists in cart
      const existingItemIndex = cart.findIndex(item => item.productId === product.id)

      if (existingItemIndex !== -1) {
        // Increment quantity of existing item
        setCart(cart.map((item, idx) => {
          if (idx === existingItemIndex) {
            const newQty = (typeof item.qty === 'number' ? item.qty : 0) + 1
            const itemDiscount = typeof item.discount === 'number' ? item.discount : 0
            const rowTotal = (newQty * item.unitPrice) - itemDiscount
            const vatAmount = Math.round((rowTotal * (vatPercent / 100)) * 100) / 100
            const lineTotal = rowTotal + vatAmount
            return { ...item, qty: newQty, discount: itemDiscount, vatAmount, lineTotal }
          }
          return item
        }))
        // Silent - quantity update is visual feedback
      } else {
        // Add new item to cart
        setCart([...cart, {
          productId: product.id,
          productName: product.nameEn,
          sku: product.sku,
          unitType: product.unitType || 'CRTN', // Fallback to CRTN if null
          qty: qty,
          unitPrice: unitPrice, // FIXED: Use calculated unitPrice
          discount: itemDiscount, // Per-item discount
          vatAmount: vatAmount,
          lineTotal: lineTotal
        }])
        // Silent - cart update is visual feedback
      }

      // Close all dropdowns
      setShowProductDropdown({})
    }
  }

  const addEmptyRow = () => {
    const newIndex = cart.length
    lastAddedRowIndexRef.current = newIndex
    setCart([...cart, {
      productId: null,
      productName: '',
      sku: '',
      unitType: '',
      qty: '',
      unitPrice: '',
      discount: 0,
      vatAmount: 0,
      lineTotal: 0
    }])
  }

  const updateCartItem = (index, field, value) => {
    const newCart = [...cart]

    // Handle empty string for number fields
    const numValue = value === '' ? '' : (field === 'qty' || field === 'unitPrice' ? Number(value) : value)
    newCart[index] = { ...newCart[index], [field]: numValue }

    // Calculate: Total = (Qty × Price) - Discount, VAT = Total × vatPercent%, Amount = Total + VAT
    const qty = typeof newCart[index].qty === 'number' ? newCart[index].qty : 0
    const unitPrice = typeof newCart[index].unitPrice === 'number' ? newCart[index].unitPrice : 0
    const itemDiscount = typeof newCart[index].discount === 'number' ? newCart[index].discount : 0

    if (unitPrice > 0 && qty > 0) {
      const rowTotal = (qty * unitPrice) - itemDiscount
      const vatAmount = Math.round((rowTotal * (vatPercent / 100)) * 100) / 100
      const lineTotal = rowTotal + vatAmount

      newCart[index].vatAmount = vatAmount
      newCart[index].lineTotal = lineTotal
    } else {
      newCart[index].vatAmount = 0
      newCart[index].lineTotal = 0
    }

    setCart(newCart)
  }

  const removeFromCart = (index) => {
    const item = cart[index]
    setCart(cart.filter((_, i) => i !== index))
    // Silent - removal is visual feedback
  }

  const calculateTotals = () => {
    if (isZeroInvoice) return { subtotal: 0, vatTotal: 0, grandTotal: 0 }
    const subtotal = cart.reduce((sum, item) => {
      const qty = typeof item.qty === 'number' ? item.qty : 0
      const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : 0
      const itemDiscount = typeof item.discount === 'number' ? item.discount : 0
      const rowTotal = (qty * unitPrice) - itemDiscount
      return sum + rowTotal
    }, 0)

    const vatTotal = cart.reduce((sum, item) => sum + (item.vatAmount || 0), 0)
    const discountValue = typeof discount === 'number' ? discount : 0
    const roundOffValue = typeof roundOff === 'number' ? roundOff : 0
    const grandTotal = subtotal + vatTotal - discountValue + roundOffValue

    return { subtotal, vatTotal, grandTotal }
  }

  const handleAutoRoundOff = () => {
    if (isZeroInvoice) return
    const subtotal = cart.reduce((sum, item) => {
      const qty = typeof item.qty === 'number' ? item.qty : 0
      const unitPrice = typeof item.unitPrice === 'number' ? item.unitPrice : 0
      const itemDiscount = typeof item.discount === 'number' ? item.discount : 0
      return sum + (qty * unitPrice) - itemDiscount
    }, 0)
    const vatTotal = cart.reduce((sum, item) => sum + (item.vatAmount || 0), 0)
    const discountValue = typeof discount === 'number' ? discount : 0
    const calcTotal = subtotal + vatTotal - discountValue
    const rounded = Math.round(calcTotal)
    const diff = rounded - calcTotal
    if (Math.abs(diff) <= 1) {
      const v = parseFloat(diff.toFixed(2))
      setRoundOff(v)
      setRoundOffInput(v === 0 ? '0' : v.toString())
    }
  }

  const handleDownloadPdf = async (saleId, invoiceNo) => {
    try {
      const response = await salesAPI.getInvoicePdf(saleId)
      const blob = response instanceof Blob ? response : new Blob([response], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${invoiceNo || 'invoice'}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Invoice PDF downloaded', { id: 'invoice-pdf-download', duration: 3000 })
    } catch (error) {
      console.error('Failed to download PDF:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to download PDF')
    }
  }

  /** One-click print for specified format (A4, A5, 80mm, 58mm). Opens PDF in new tab and triggers print dialog. */
  const handlePrintFormat = async (format) => {
    if (!lastCreatedInvoice?.id) {
      toast.error('No invoice to print. Save the invoice first.')
      return
    }
    const toastId = `print-${format}-toast`
    try {
      toast.loading(`Preparing ${format}...`, { id: toastId })
      const blob = await salesAPI.getInvoicePdf(lastCreatedInvoice.id, { format })
      const blobUrl = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob], { type: 'application/pdf' }))
      const printWindow = window.open(blobUrl, '_blank', 'noopener,noreferrer')
      if (printWindow) {
        printWindow.onload = () => {
          try {
            printWindow.print()
            toast.dismiss(toastId)
            toast.success('Print dialog opened')
          } catch (e) {
            toast.dismiss(toastId)
            toast.error('Could not open print dialog')
          }
          setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
        }
        setTimeout(() => {
          toast.dismiss(toastId)
          toast.success('PDF opened. Use Ctrl+P to print if needed.')
          setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
        }, 2500)
      } else {
        URL.revokeObjectURL(blobUrl)
        toast.dismiss(toastId)
        toast.error('Pop-up blocked. Allow pop-ups for this site.')
      }
    } catch (error) {
      console.error('Print error:', error)
      toast.dismiss(toastId)
      if (!error?._handledByInterceptor) toast.error(error?.message || 'Failed to prepare PDF')
    }
  }

  const handleQuickPrintA4 = () => handlePrintFormat('A4')

  const handlePrintReceipt = async () => {
    console.log('Print Receipt Called')
    console.log('  - lastCreatedInvoice:', lastCreatedInvoice)

    if (!lastCreatedInvoice) {
      toast.error('No invoice to print. Please create an invoice first.')
      console.error('lastCreatedInvoice is null or undefined')
      return
    }

    const saleId = lastCreatedInvoice.id
    const invoiceNo = lastCreatedInvoice.invoiceNo

    console.log(`  - Sale ID: ${saleId}, Invoice No: ${invoiceNo}`)

    if (!saleId) {
      toast.error('Invalid sale ID. Cannot print invoice.')
      console.error('Sale ID is missing from lastCreatedInvoice')
      return
    }

    try {
      toast.loading('Generating PDF for printing...', { id: 'print-toast' })

      // Get the PDF blob - ensure it's a proper PDF file, not a link
      let pdfBlob
      try {
        pdfBlob = await salesAPI.getInvoicePdf(saleId)
      } catch (apiError) {
        console.error('PDF API Error:', apiError)
        toast.dismiss('print-toast')
        if (!apiError?._handledByInterceptor) toast.error(apiError.message || 'Failed to generate PDF. Please try again.')
        return
      }

      if (!pdfBlob) {
        toast.dismiss('print-toast')
        throw new Error('No PDF data received from server')
      }

      // Ensure it's a proper Blob (PDF file), not a string/link
      let blob
      if (pdfBlob instanceof Blob) {
        blob = pdfBlob
      } else if (typeof pdfBlob === 'string') {
        // If it's a string (link), that's an error
        toast.dismiss('print-toast')
        throw new Error('Received link instead of PDF file. PDF generation may have failed.')
      } else {
        blob = new Blob([pdfBlob], { type: 'application/pdf' })
      }

      // Validate blob is actually a PDF
      if (blob.size === 0) {
        toast.dismiss('print-toast')
        throw new Error('PDF is empty - invoice may not exist or PDF generation failed')
      }

      // Verify it's actually a PDF by checking type
      if (blob.type && !blob.type.includes('pdf')) {
        toast.dismiss('print-toast')
        throw new Error('Invalid file type received. Expected PDF file.')
      }

      // Create object URL from blob (PDF file, not a link)
      const pdfUrl = URL.createObjectURL(blob)

      // Use iframe approach to avoid pop-up blockers (works on mobile and desktop)
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = 'none'
      iframe.style.display = 'none'
      iframe.src = pdfUrl

      document.body.appendChild(iframe)

      // Function to trigger print from iframe
      const triggerPrint = () => {
        try {
          // Wait a bit for PDF to load in iframe
          setTimeout(() => {
            try {
              const iframeWindow = iframe.contentWindow
              if (iframeWindow) {
                iframeWindow.focus()
                iframeWindow.print()
                toast.dismiss('print-toast')
                toast.success('Print dialog opened')
              } else {
                // Fallback: try direct print
                window.print()
                toast.dismiss('print-toast')
                toast.success('Print dialog opened')
              }
            } catch (printErr) {
              console.error('Print trigger error:', printErr)
              // Fallback: download PDF and let user print manually
              const a = document.createElement('a')
              a.href = pdfUrl
              a.download = `invoice_${invoiceNo}.pdf`
              a.style.display = 'none'
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)

              toast.dismiss('print-toast')
              showToast.info('PDF downloaded. Please open it and print manually.')
            }

            // Clean up iframe and URL after delay
            setTimeout(() => {
              if (iframe.parentNode) {
                document.body.removeChild(iframe)
              }
              URL.revokeObjectURL(pdfUrl)
            }, 10000)
          }, 1000) // Wait 1 second for PDF to load
        } catch (err) {
          console.error('Print setup error:', err)
          toast.dismiss('print-toast')
          if (!err?._handledByInterceptor) toast.error('Failed to open print dialog. PDF downloaded instead.')

          // Fallback: download PDF
          const a = document.createElement('a')
          a.href = pdfUrl
          a.download = `invoice_${invoiceNo}.pdf`
          a.style.display = 'none'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)

          setTimeout(() => {
            if (iframe.parentNode) {
              document.body.removeChild(iframe)
            }
            URL.revokeObjectURL(pdfUrl)
          }, 1000)
        }
      }

      // Wait for iframe to load PDF
      iframe.onload = () => {
        triggerPrint()
      }

      // Fallback: trigger print after timeout even if onload doesn't fire
      setTimeout(() => {
        if (iframe.parentNode) {
          triggerPrint()
        }
      }, 2000)

    } catch (error) {
      console.error('Print error:', error)
      console.error('Error details:', {
        message: error?.message,
        response: error?.response?.data,
        status: error?.response?.status
      })

      toast.dismiss('print-toast')

      // Extract error message
      let errorMessage = 'Failed to prepare invoice for printing'

      if (error?.response?.status === 401) {
        errorMessage = 'Authentication required. Please login again.'
      } else if (error?.response?.status === 404) {
        errorMessage = 'Invoice not found. The invoice may have been deleted.'
      } else if (error?.response?.status >= 500) {
        errorMessage = 'Server error. Please try again later.'
      } else if (error?.response?.data?.message) {
        errorMessage = error.response.data.message
      } else if (error?.message) {
        errorMessage = error.message
      }

      toast.error(errorMessage)

      // Automatically try to download as fallback
      setTimeout(async () => {
        try {
          toast.loading('Downloading PDF as alternative...', { id: 'download-toast' })
          await handleDownloadPdf(saleId, invoiceNo)
          toast.dismiss('download-toast')
          toast.success('PDF downloaded. Open it and print manually.')
        } catch (downloadErr) {
          console.error('Download fallback also failed:', downloadErr)
          toast.dismiss('download-toast')
          if (!downloadErr?._handledByInterceptor) toast.error('Failed to download PDF. Please try again later.')
        }
      }, 1000)
    }
  }

  const handleWhatsAppShare = async () => {
    if (!lastCreatedInvoice) return

    try {
      const saleId = lastCreatedInvoice.id
      const invoiceNo = lastCreatedInvoice.invoiceNo || `INV-${saleId}`
      const customerName = selectedCustomer?.name || 'Cash Customer'
      const totals = calculateTotals()
      const date = new Date().toLocaleDateString()

      const message = `*Invoice ${invoiceNo}*\n\n` +
        `Customer: ${customerName}\n` +
        `Date: ${date}\n` +
        `Total: ${formatCurrency(totals.grandTotal)}\n\n` +
        `Please find the invoice attached.`

      const encodedMessage = encodeURIComponent(message)

      // Generate PDF blob first - ensure it's a PDF file, not a link
      toast.loading('Generating PDF for sharing...', { id: 'whatsapp-share' })

      let pdfBlob
      try {
        pdfBlob = await salesAPI.getInvoicePdf(saleId)
      } catch (apiError) {
        console.error('PDF API Error:', apiError)
        toast.dismiss('whatsapp-share')
        if (!apiError?._handledByInterceptor) toast.error(apiError.message || 'Failed to generate PDF. Please try again.')
        return
      }

      // Validate it's a proper PDF blob, not a string/link
      if (!pdfBlob) {
        toast.dismiss('whatsapp-share')
        toast.error('No PDF data received from server')
        return
      }

      let blob
      if (pdfBlob instanceof Blob) {
        blob = pdfBlob
      } else if (typeof pdfBlob === 'string') {
        // If it's a string (link), that's an error - we need the PDF file
        toast.dismiss('whatsapp-share')
        toast.error('Received link instead of PDF file. PDF generation may have failed.')
        return
      } else {
        blob = new Blob([pdfBlob], { type: 'application/pdf' })
      }

      // Validate blob is actually a PDF file
      if (blob.size === 0) {
        toast.dismiss('whatsapp-share')
        toast.error('PDF is empty - invoice may not exist or PDF generation failed')
        return
      }

      // Verify it's actually a PDF by checking type
      if (blob.type && !blob.type.includes('pdf')) {
        toast.dismiss('whatsapp-share')
        toast.error('Invalid file type received. Expected PDF file.')
        return
      }

      // Download PDF file (not a link) so user can attach it
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.style.display = 'none'
      a.download = `invoice_${invoiceNo}.pdf`
      document.body.appendChild(a)
      a.click()

      // Clean up download link
      setTimeout(() => {
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }, 100)

      // Open WhatsApp to customer when phone available (#56)
      const { getWhatsAppShareUrl } = await import('../../utils/whatsapp')
      const whatsappUrl = getWhatsAppShareUrl(message, selectedCustomer?.phone)
      window.open(whatsappUrl, '_blank')

      toast.dismiss('whatsapp-share')
      toast.success('PDF downloaded. WhatsApp opened. Please attach the downloaded PDF file.')
    } catch (error) {
      console.error('WhatsApp share error:', error)
      toast.dismiss('whatsapp-share')
      if (!error?._handledByInterceptor) toast.error(error.message || 'Failed to share via WhatsApp')
    }
  }

  const handleEmailShare = async () => {
    if (!lastCreatedInvoice) return

    const saleId = lastCreatedInvoice.id
    const invoiceNo = lastCreatedInvoice.invoiceNo || `INV-${saleId}`
    let customerEmail = selectedCustomer?.email

    const sendEmail = async (email) => {
      try {
        toast.loading('Sending email...', { id: 'email-share' })
        const response = await salesAPI.sendInvoiceEmail(saleId, email)
        if (response.success) {
          toast.success(`Invoice sent to ${email}`, { id: 'email-share' })
        } else {
          toast.error(response.message || 'Failed to send email', { id: 'email-share' })
        }
      } catch (emailError) {
        console.error('Email send error:', emailError)
        toast.dismiss('email-share')
        // Fallback: Create mailto link
        const subject = encodeURIComponent(`Invoice ${invoiceNo}`)
        const body = encodeURIComponent(`Please find invoice ${invoiceNo} attached.\n\nThank you for your business!`)
        window.location.href = `mailto:${email}?subject=${subject}&body=${body}`
        showToast.info('Email client opened. Please attach the PDF manually if needed.')
      }
    }

    if (!customerEmail) {
      setDangerModal({
        isOpen: true,
        title: 'Send Invoice to Email',
        message: 'Enter the customer email address:',
        confirmLabel: 'Send Email',
        showInput: true,
        inputPlaceholder: 'customer@example.com',
        onConfirm: (val) => {
          if (!val?.trim()) {
            toast.error('Email address required')
            return
          }
          sendEmail(val.trim())
        }
      })
      return
    }

    await sendEmail(customerEmail)
  }

  const handleCloseInvoiceOptions = async () => {
    setShowInvoiceOptionsModal(false)
    setLastCreatedInvoice(null)
    // Refresh all data after billing
    await Promise.all([
      loadProducts(),
      loadCustomers()
    ])
    // Clear cart and reset for new invoice
    handleNewInvoice()
  }

  const handleSave = async () => {
    // Prevent multiple clicks
    if (loading || loadingSale) {
      toast.error('Please wait, operation in progress...')
      return
    }

    if (cart.length === 0) {
      toast.error('Cart is empty')
      return
    }

    // Filter out empty rows. Allow unitPrice 0 when Free sample / Zero invoice is checked.
    const validCart = cart.filter(item => item.productId && item.qty > 0 && (isZeroInvoice ? true : (item.unitPrice > 0)))
    if (validCart.length === 0) {
      toast.error(isZeroInvoice ? 'Please add at least one product (qty > 0) for free sample.' : 'Please add at least one valid product with price > 0, or check "Free sample / Zero invoice" for zero-cost items.')
      return
    }

    // Validate quantities and prices (allow 0 price when Free sample)
    for (const item of validCart) {
      if (item.qty <= 0 || item.qty > 100000) {
        toast.error(`Invalid quantity for ${item.productName || 'product'}. Must be between 1 and 100,000.`)
        return
      }
      if (!isZeroInvoice && (item.unitPrice <= 0 || item.unitPrice > 1000000)) {
        toast.error(`Invalid price for ${item.productName || 'product'}. Must be between 0.01 and 1,000,000, or check "Free sample / Zero invoice" for zero-cost.`)
        return
      }
    }

    // CRITICAL: Show confirmation dialog for editing PAID or PARTIAL invoices
    if (isEditMode && editingSale) {
      const paymentStatus = editingSale.paymentStatus?.toLowerCase() || ''
      if (paymentStatus === 'paid' || paymentStatus === 'partial') {
        // Store data and show confirmation modal
        const totals = calculateTotals()
        const routeIdNumConfirm = selectedRouteId ? parseInt(selectedRouteId, 10) : null
        const selectedRouteConfirm = routeIdNumConfirm && routes?.length ? routes.find(r => Number(r.id) === routeIdNumConfirm) : null
        const branchIdNumConfirm = selectedRouteConfirm?.branchId != null ? Number(selectedRouteConfirm.branchId) : (selectedBranchId ? parseInt(selectedBranchId, 10) : null)

        // Validate payment amount before showing confirmation
        if (paymentMethod !== 'Pending' && paymentAmount) {
          const paymentAmountNum = parseFloat(paymentAmount)
          if (!isNaN(paymentAmountNum) && paymentAmountNum > totals.grandTotal) {
            toast.error(`Payment amount (${formatCurrency(paymentAmountNum)}) cannot exceed invoice total (${formatCurrency(totals.grandTotal)})`)
            return
          }
        }
        if (paymentMethod !== 'Pending' && totals.grandTotal > 0) {
          const effectiveAmount = (paymentAmount && !isNaN(parseFloat(paymentAmount))) ? parseFloat(paymentAmount) : totals.grandTotal
          if (effectiveAmount <= 0) {
            toast.error('Payment amount must be greater than zero. Enter the amount received or leave blank to use the invoice total.')
            return
          }
        }
        const saleData = {
          customerId: selectedCustomer?.id || null,
          items: validCart.map(item => ({
            productId: item.productId,
            unitType: item.unitType || 'CRTN',
            qty: Number(item.qty) || 0,
            unitPrice: isZeroInvoice ? 0 : (Number(item.unitPrice) || 0),
            discount: Number(item.discount) || 0
          })).filter(item => item.productId && item.qty > 0 && (isZeroInvoice || item.unitPrice > 0)),
          discount: isZeroInvoice ? 0 : (discount || 0),
          roundOff: isZeroInvoice ? 0 : (roundOff ?? 0),
          isZeroInvoice: !!isZeroInvoice,
          payments: (paymentMethod !== 'Pending' && totals.grandTotal > 0)
            ? [{
                method: paymentMethod,
                amount: (paymentAmount && !isNaN(parseFloat(paymentAmount)) && parseFloat(paymentAmount) > 0)
                  ? parseFloat(paymentAmount)
                  : totals.grandTotal
              }]
            : [],
          notes: notes || null,
          editReason: editReason || undefined,
          invoiceDate: invoiceDate ? `${invoiceDate}T12:00:00.000Z` : undefined,
          branchId: branchIdNumConfirm || undefined,
          routeId: routeIdNumConfirm || undefined
        }
        setPendingSaveData(saleData)
        setShowEditConfirmModal(true)
        return
      }
    }

    setLoading(true)
    try {
      const totals = calculateTotals()

      // Validate items before creating sale data
      if (!validCart || validCart.length === 0) {
        toast.error('Please add at least one product to the invoice')
        setLoading(false)
        return
      }

      // CRITICAL: Validate payment amount does not exceed grand total
      if (paymentMethod !== 'Pending' && paymentAmount) {
        const paymentAmountNum = parseFloat(paymentAmount)
        if (!isNaN(paymentAmountNum) && paymentAmountNum > totals.grandTotal) {
          toast.error(`Payment amount (${formatCurrency(paymentAmountNum)}) cannot exceed invoice total (${formatCurrency(totals.grandTotal)})`)
          setLoading(false)
          return
        }
      }
      // Payment amount must be greater than zero when recording a payment (non–zero invoice)
      if (paymentMethod !== 'Pending' && totals.grandTotal > 0) {
        const effectiveAmount = (paymentAmount && !isNaN(parseFloat(paymentAmount))) ? parseFloat(paymentAmount) : totals.grandTotal
        if (effectiveAmount <= 0) {
          toast.error('Payment amount must be greater than zero. Enter the amount received or leave blank to use the invoice total.')
          setLoading(false)
          return
        }
      }

      // Use the route's branch so backend never gets branch/route mismatch (backend validates route.BranchId === request.BranchId)
      const routeIdNum = selectedRouteId ? parseInt(selectedRouteId, 10) : null
      const selectedRoute = routeIdNum && routes?.length ? routes.find(r => Number(r.id) === routeIdNum) : null
      const branchIdNum = selectedRoute?.branchId != null ? Number(selectedRoute.branchId) : (selectedBranchId ? parseInt(selectedBranchId, 10) : null)

      const saleData = {
        customerId: selectedCustomer?.id || null,
        items: validCart.map(item => ({
          productId: item.productId,
          unitType: item.unitType || 'CRTN',
          qty: Number(item.qty) || 0,
          unitPrice: isZeroInvoice ? 0 : (Number(item.unitPrice) || 0),
          discount: Number(item.discount) || 0
        })).filter(item => item.productId && item.qty > 0 && (isZeroInvoice || item.unitPrice > 0)),
        discount: isZeroInvoice ? 0 : (discount || 0),
        roundOff: isZeroInvoice ? 0 : (roundOff ?? 0),
        isZeroInvoice: !!isZeroInvoice,
        // Only send payments with amount > 0 (zero invoice = no payment record; backend also skips amount <= 0)
        payments: (paymentMethod !== 'Pending' && totals.grandTotal > 0)
          ? [{
              method: paymentMethod,
              amount: (paymentAmount && !isNaN(parseFloat(paymentAmount)) && parseFloat(paymentAmount) > 0)
                ? parseFloat(paymentAmount)
                : totals.grandTotal
            }]
          : [],
        notes: notes || null,
        editReason: isEditMode ? editReason : undefined,
        invoiceDate: invoiceDate ? `${invoiceDate}T12:00:00.000Z` : undefined,
        branchId: branchIdNum || undefined,
        routeId: routeIdNum || undefined
      }

      // Final validation
      if (!saleData.items || saleData.items.length === 0) {
        toast.error('Please add at least one valid product to the invoice')
        setLoading(false)
        return
      }

      // Credit sales (Pending payment) require a customer for ledger and balance tracking
      if (paymentMethod === 'Pending' && !selectedCustomer?.id) {
        toast.error('Please select a customer for credit sales. Credit invoices must be linked to a customer.')
        setLoading(false)
        return
      }

      // Require branch and route only when the tenant has branches/routes configured (so revenue attribution is possible)
      const hasBranchesOrRoutes = (branches?.length ?? 0) > 0 || (routes?.length ?? 0) > 0
      if (hasBranchesOrRoutes && (!selectedBranchId || !selectedRouteId)) {
        toast.error('Please select Branch and Route before checkout. This ensures proper revenue attribution.', {
          duration: 6000,
          id: 'branch-route-required'
        })
        setLoading(false)
        return
      }

      // Only admins and owners can edit invoices
      if (isEditMode && user?.role?.toLowerCase() !== 'admin' && user?.role?.toLowerCase() !== 'owner') {
        toast.error('Only Administrators and Owners can edit invoices')
        setLoading(false)
        return
      }

      let response
      if (isEditMode && editingSaleId) {
        // Update existing sale - include RowVersion for concurrency control
        const updateData = {
          customerId: saleData.customerId,
          items: saleData.items,
          discount: saleData.discount,
          roundOff: saleData.roundOff ?? 0,
          payments: saleData.payments || [],
          notes: saleData.notes || null,
          isZeroInvoice: !!saleData.isZeroInvoice,
          ...(saleData.branchId != null && { branchId: saleData.branchId }),
          ...(saleData.routeId != null && { routeId: saleData.routeId }),
          ...(saleData.editReason && { editReason: saleData.editReason }),
          ...(editingSale?.rowVersion && { rowVersion: editingSale.rowVersion }),
          ...(saleData.invoiceDate && { invoiceDate: saleData.invoiceDate })
        }

        // Log the update request for debugging
        console.log('Updating invoice:', {
          saleId: editingSaleId,
          updateData,
          hasRowVersion: !!editingSale?.rowVersion,
          itemsCount: updateData.items?.length
        })

        response = await salesAPI.updateSale(editingSaleId, updateData)
        if (response.success) {
          const invoiceNo = response.data?.invoiceNo
          const saleId = response.data?.id
          toast.success(`Invoice ${invoiceNo || editingSaleId} updated successfully!`, { id: 'invoice-update', duration: 4000 })

          window.dispatchEvent(new CustomEvent('dataUpdated'))

          // Refresh products and customers after update (non-blocking for better UX)
          Promise.all([
            loadProducts(),
            loadCustomers(),
          ]).catch(err => console.error('Error refreshing data:', err))

          // Clear edit mode and URL param
          setIsEditMode(false)
          setEditingSaleId(null)
          setEditingSale(null)
          setEditReason('')
          setCustomerChangedDuringEdit(false) // Reset customer change tracking
          setSearchParams({})

          // Store invoice data and show options modal
          if (saleId) {
            setLastCreatedInvoice({
              id: saleId,
              invoiceNo: invoiceNo,
              data: response.data
            })
            setShowInvoiceOptionsModal(true)

            // If we came from customer ledger, offer to go back
            const cameFromLedger = document.referrer.includes('/ledger')
            if (cameFromLedger) {
              setTimeout(() => {
                setDangerModal({
                  isOpen: true,
                  title: 'Update Successful',
                  message: 'Invoice updated successfully! Would you like to return to Customer Ledger?',
                  confirmLabel: 'Go to Ledger',
                  onConfirm: () => navigate('/ledger')
                })
              }, 1000)
            }
          } else {
            // Clear cart and reset for new invoice
            handleNewInvoice()
          }
        } else {
          const errorMsg = response.message || response.errors?.[0] || 'Failed to update invoice'
          toast.error(errorMsg)
        }
      } else {
        // Create new sale
        console.log('📤 Sending Create Sale Request:')
        console.log('  - Full saleData:', JSON.stringify(saleData, null, 2))
        console.log('  - Items count:', saleData.items?.length)
        console.log('  - Items detail:', saleData.items)
        console.log('  - Customer ID:', saleData.customerId)
        console.log('  - Grand Total:', totals.grandTotal)
        console.log('  - Discount:', saleData.discount)
        console.log('  - Payments:', saleData.payments)

        response = await salesAPI.createSale(saleData)

        console.log('Create Sale Response:', response)

        if (response.success) {
          const invoiceNo = response.data?.invoiceNo
          const saleId = response.data?.id

          if (!saleId) {
            console.error('Sale created but no ID returned:', response.data)
            toast.error('Invoice created but ID missing. Please refresh and check Sales list.')
            setLoading(false)
            return
          }

          toast.success(invoiceNo ? `Invoice #${invoiceNo} created successfully` : 'Invoice created successfully', { id: 'invoice-save', duration: 5000 })

          // Notify all pages (Sales Ledger, Customer Ledger, Dashboard) to refresh
          window.dispatchEvent(new CustomEvent('dataUpdated'))

          // Refresh products and customers after billing (non-blocking for better UX)
          Promise.all([
            loadProducts(),
            loadCustomers()
          ]).catch(err => console.error('Error refreshing data:', err))

          // Store invoice data and show options modal
          if (saleId) {
            setLastCreatedInvoice({
              id: saleId,
              invoiceNo: invoiceNo,
              data: response.data
            })
            setShowInvoiceOptionsModal(true)
          } else {
            // Clear cart and reset for new invoice if no saleId
            handleNewInvoice()
          }
        } else {
          toast.error(response.message || 'Failed to save sale')
        }
      }
    } catch (error) {
      console.error('Error saving/updating invoice:', error)
      console.error('Error details:', {
        message: error?.message,
        response: error?.response?.data,
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        isEditMode,
        url: error?.config?.url,
        method: error?.config?.method
      })

      if (isEditMode) {
        // Update-specific error handling
        let errorMsg = 'Failed to update invoice. Please try again.'

        if (error?.response) {
          // Server responded with error
          const responseData = error.response.data
          if (responseData?.message) {
            errorMsg = responseData.message
          } else if (responseData?.errors && Array.isArray(responseData.errors) && responseData.errors.length > 0) {
            errorMsg = responseData.errors[0]
          } else if (responseData?.error) {
            errorMsg = responseData.error
          } else if (error.response.status === 500) {
            errorMsg = 'Server error occurred. Please check backend logs for details.'
          } else if (error.response.status === 401) {
            errorMsg = 'Unauthorized. Please log in again.'
          } else if (error.response.status === 403) {
            errorMsg = 'You do not have permission to update invoices.'
          }
          if (error.response.status === 409 && editingSaleId) {
            toast.error(`Conflict: ${errorMsg}`, { duration: 8000 })
            loadSaleForEdit(editingSaleId).catch(() => {})
            return
          }
        } else if (error?.message) {
          // Network or other error
          errorMsg = error.message
        }

        toast.error(errorMsg, { duration: 6000 })
      } else {
        // Create-specific error handling
        let errorMsg = 'Failed to save sale'

        if (error.response?.status === 400) {
          // Extract detailed error message (support both camelCase and PascalCase from backend)
          const responseData = error.response.data || {}
          const msg = responseData.message ?? responseData.Message
          const errs = responseData.errors ?? responseData.Errors
          const responseJson = JSON.stringify(responseData, null, 2)
          console.log('400 Bad Request - Full Response:', responseJson)

          if (msg) {
            errorMsg = msg
          } else if (errs) {
            if (Array.isArray(errs)) {
              errorMsg = errs.join('\n')
            } else if (typeof errs === 'object') {
              const errorMessages = Object.entries(errs)
                .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
                .join('\n')
              errorMsg = errorMessages || 'Validation failed'
            }
          } else if (responseData?.title) {
            errorMsg = responseData.title
          } else {
            errorMsg = 'Bad request - check product/stock, branch-route match, and try again.'
          }
        } else if (error.response?.status === 403) {
          const apiMsg = error.response?.data?.message || ''
          const noRouteCase = (Array.isArray(error.response?.data?.errors) && error.response.data.errors.includes('NO_ROUTE_ASSIGNED')) || staffHasNoAssignments || (user?.role?.toLowerCase() === 'staff' && !selectedRouteId)
          errorMsg = apiMsg || (noRouteCase ? 'You have no route assigned. Ask your admin to assign you to a route before creating invoices.' : 'Access denied. You do not have permission to create this invoice.')
        } else if (error.response?.status === 500) {
          errorMsg = error.response?.data?.message || 'Server error. Check backend logs or try again.'
        } else if (error.response?.data?.message) {
          errorMsg = error.response.data.message
        } else if (error.message) {
          errorMsg = error.message
        }

        toast.error(errorMsg, { duration: 8000 })

        // Log detailed error for debugging (stringify so "Object" shows actual content)
        console.log('Error occurred during save')
        console.log('Backend Error Response:', error.response?.data != null ? JSON.stringify(error.response.data, null, 2) : error.response?.data)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleNewInvoice = () => {
    setCart([])
    setSelectedCustomer(null)
    setPaymentMethod('Pending') // Default to credit invoice
    setPaymentAmount('')
    setNotes('')
    setDiscount(0)
    setDiscountInput('')
    setRoundOff(0)
    setRoundOffInput('')
    setIsZeroInvoice(false)
    setProductSearchTerms({}) // Clear all search terms
    setIsEditMode(false)
    setEditingSaleId(null)
    setEditingSale(null)
    setEditReason('')
    setCustomerChangedDuringEdit(false) // Reset customer change tracking
    setSearchParams({}) // Clear URL params
    setShowProductDropdown({}) // Close all dropdowns
    setLastCreatedInvoice(null)
    salesAPI.getNextInvoiceNumber().then(res => {
      const num = res?.data ?? res?.invoiceNo ?? res
      if (typeof num === 'string' && num) setNextInvoiceNumberPreview(num)
    }).catch(() => {})
    // Reset invoice date to today
    const today = new Date()
    setInvoiceDate(today.toISOString().split('T')[0])
  }

  const handleRepeatLastInvoice = async () => {
    try {
      setLoadingSale(true)
      const response = await salesAPI.getLastInvoice()
      if (response.success && response.data) {
        const lastSale = response.data
        // Load the sale for editing (reuse existing edit logic)
        const saleId = lastSale.id
        setSearchParams({ edit: saleId.toString() })
      } else {
        toast.error('No previous invoice found')
      }
    } catch (error) {
      toast.error('Failed to load last invoice: ' + (error.response?.data?.message || error.message))
    } finally {
      setLoadingSale(false)
    }
  }

  const handleHold = () => {
    const validItems = cart.filter(item => item.productId && (item.qty > 0 || item.qty === ''))
    if (validItems.length === 0) {
      toast.error('Add at least one item before holding')
      return
    }
    setHoldNameInput('')
    setShowHoldModal(true)
  }

  const handleHoldConfirm = async () => {
    const name = (holdNameInput || 'Held Invoice').trim()
    const validCart = cart.filter(item => item.productId && (Number(item.qty) > 0) && (Number(item.unitPrice) >= 0))
    if (validCart.length === 0) {
      toast.error('No valid items to hold')
      setShowHoldModal(false)
      return
    }
    try {
      const invoiceData = {
        cart: validCart,
        selectedCustomer: selectedCustomer ? { id: selectedCustomer.id, name: selectedCustomer.name } : null,
        invoiceDate,
        notes,
        discount,
        discountInput,
        roundOff: roundOff ?? 0,
        roundOffInput: roundOffInput ?? '',
        selectedBranchId,
        selectedRouteId
      }
      const response = await salesAPI.holdInvoice(name, invoiceData, roundOff ?? 0)
      if (response.success) {
        setHeldInvoices(prev => [{
          id: response.data.id,
          name: response.data.name,
          ...response.data.invoiceData,
          roundOff: response.data.roundOff != null ? response.data.roundOff : (roundOff ?? 0),
          createdAt: response.data.createdAt
        }, ...prev])
        handleNewInvoice()
        setShowHoldModal(false)
        toast.success(`Invoice held as "${name}"`)
      }
    } catch (error) {
      toast.error('Failed to hold invoice: ' + (error.response?.data?.message || error.message))
    }
  }

  const handleResume = (held) => {
    setCart(held.cart || [])
    const cust = held.selectedCustomer
    setSelectedCustomer(cust ? customers.find(c => c.id === cust.id) || cust : null)
    setInvoiceDate(held.invoiceDate || new Date().toISOString().split('T')[0])
    setNotes(held.notes || '')
    setDiscount(held.discount ?? 0)
    setDiscountInput(String(held.discountInput ?? ''))
    const ro = held.roundOff != null ? Number(held.roundOff) : 0
    setRoundOff(ro)
    setRoundOffInput(held.roundOffInput != null ? String(held.roundOffInput) : (ro === 0 ? '' : ro.toString()))
    setSelectedBranchId(held.selectedBranchId || '')
    setSelectedRouteId(held.selectedRouteId || '')
    setIsEditMode(false)
    setEditingSaleId(null)
    setEditingSale(null)
    setHeldInvoices(prev => prev.filter(h => h.id !== held.id))
    setShowResumeModal(false)
    toast.success(`Resumed "${held.name}"`)
  }

  const handleRemoveHeld = async (held) => {
    try {
      await salesAPI.deleteHeldInvoice(held.id)
      setHeldInvoices(prev => prev.filter(h => h.id !== held.id))
      toast.success('Held invoice removed')
    } catch (error) {
      toast.error('Failed to remove held invoice: ' + (error.response?.data?.message || error.message))
    }
  }

  // Disable form inputs while saving or loading a sale for edit (fixes ReferenceError: isFormDisabled is not defined)
  const isFormDisabled = loading || loadingSale

  const totals = calculateTotals()

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col max-w-full overflow-x-hidden pb-24 lg:pb-0">
      {/* TAX INVOICE Header - compact on mobile (16px), navy primary */}
      <div className="bg-primary-900 text-white px-4 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 flex-shrink-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold mb-0.5 sm:mb-1 drop-shadow-md truncate">TAX INVOICE</h1>
            <p className="text-xs sm:text-sm text-blue-100">{companyName} · فاتورة ضريبية</p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 lg:space-x-4 w-full sm:w-auto">
            <button
              onClick={() => setShowCustomerSearch(true)}
              disabled={isFormDisabled}
              className="flex-1 sm:flex-none px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium bg-white text-blue-700 border-2 border-white rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors flex items-center justify-center shadow-md min-w-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <User className="h-3 w-3 sm:h-3.5 sm:w-3.5 lg:h-4 lg:w-4 mr-1 sm:mr-1.5 lg:mr-2 flex-shrink-0" />
              <span className="truncate text-xs sm:text-sm">{selectedCustomer ? selectedCustomer.name : 'Select Customer'}</span>
            </button>
            <button
              onClick={handleHold}
              disabled={isFormDisabled || cart.filter(i => i.productId && (Number(i.qty) > 0)).length === 0}
              className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium bg-amber-600 text-white border-2 border-amber-700 rounded-lg hover:bg-amber-700 transition-colors shadow-md flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              title="Hold current invoice to resume later"
            >
              <Bookmark className="h-3 w-3 sm:h-3.5" />
              Hold
            </button>
            <button
              onClick={() => setShowResumeModal(true)}
              disabled={isFormDisabled || heldInvoices.length === 0 || loadingHeldInvoices}
              className={`px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors shadow-md flex-shrink-0 flex items-center gap-1 relative ${heldInvoices.length > 0 ? 'bg-emerald-600 text-white border-2 border-emerald-700 hover:bg-emerald-700' : 'bg-gray-400 text-gray-200 border-2 border-gray-500 cursor-not-allowed'}`}
              title={heldInvoices.length > 0 ? `${heldInvoices.length} held invoice(s) - click to resume` : 'No held invoices'}
            >
              <RotateCcw className="h-3 w-3 sm:h-3.5" />
              Resume
              {heldInvoices.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] text-[10px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center px-1">
                  {heldInvoices.length}
                </span>
              )}
            </button>
            <button
              onClick={handleRepeatLastInvoice}
              disabled={isFormDisabled || loadingSale}
              className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium bg-purple-600 text-white border-2 border-purple-700 rounded-lg hover:bg-purple-700 transition-colors shadow-md flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              title="Repeat last invoice"
            >
              <RotateCcw className="h-3 w-3 sm:h-3.5" />
              Repeat
            </button>
            <button
              onClick={handleNewInvoice}
              className="px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium bg-blue-800 text-white border-2 border-blue-900 rounded-lg hover:bg-blue-900 transition-colors shadow-md flex-shrink-0"
            >
              New Invoice
            </button>
          </div>
        </div>
      </div>

      {/* Hold Invoice Modal */}
      {showHoldModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Hold Invoice</h3>
            <p className="text-sm text-gray-600 mb-3">Save this invoice to resume later. Enter a name (optional):</p>
            <input
              type="text"
              placeholder="e.g. Customer interrupted, Table 5"
              value={holdNameInput}
              onChange={(e) => setHoldNameInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleHoldConfirm()}
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowHoldModal(false)}
                className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleHoldConfirm}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700"
              >
                Hold
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume Held Invoice Modal */}
      {showResumeModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Resume Held Invoice</h3>
              <button onClick={() => setShowResumeModal(false)} className="p-1 rounded hover:bg-gray-100">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {heldInvoices.length === 0 ? (
                <p className="text-sm text-gray-500">No held invoices.</p>
              ) : (
                heldInvoices.map((held) => {
                  const itemCount = (held.cart || []).filter(i => i.productId).length
                  const subtotal = (held.cart || []).reduce((s, i) => s + (Number(i.lineTotal) || 0), 0)
                  return (
                    <div key={held.id} className="border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">{held.name}</p>
                        <p className="text-xs text-gray-500">
                          {itemCount} item(s) · AED {subtotal.toFixed(2)}
                          {held.selectedCustomer?.name && ` · ${held.selectedCustomer.name}`}
                        </p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleResume(held)}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700"
                        >
                          Resume
                        </button>
                        <button
                          onClick={() => handleRemoveHeld(held)}
                          className="px-2 py-1.5 text-xs font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Discard"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}



      {/* Edit Mode Indicator */}
      {isEditMode && (
        <div className="bg-yellow-500 text-white px-3 sm:px-6 py-2 flex items-center justify-center gap-2 shadow-md">
          <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5" />
          <span className="text-sm sm:text-base font-semibold">
            EDIT MODE: Updating Invoice #{editingSaleId} - Changes will update stock and customer balance
          </span>
        </div>
      )}

      {/* Loading Sale Indicator */}
      {loadingSale && (
        <div className="bg-blue-500 text-white px-3 sm:px-6 py-2 flex items-center justify-center gap-2 shadow-md">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          <span className="text-sm sm:text-base font-semibold">Loading invoice for editing...</span>
        </div>
      )}

      {/* Customer & invoice info - compact on mobile (16px), single row */}
      <div className="bg-white border-b border-[#E5E7EB] px-4 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 flex-shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-2 lg:gap-4 text-xs sm:text-sm overflow-x-auto">
          <div className="bg-white rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 shadow-sm border border-blue-200 flex items-center gap-1 flex-wrap">
            <span className="font-medium text-blue-700">Invoice No:</span>
            <span className={`ml-1 sm:ml-0 font-semibold font-mono text-xs sm:text-sm ${isEditMode ? 'text-primary-700' : 'text-[#0F172A]'
              }`}>
              {isEditMode && editingSale ? editingSale.invoiceNo : (lastCreatedInvoice?.invoiceNo || nextInvoiceNumberPreview || '(Auto-generated)')}
            </span>
            {isEditMode && <span className="ml-2 text-xs text-blue-600">(Read-only)</span>}
            <button
              type="button"
              onClick={lastCreatedInvoice?.id ? handleQuickPrintA4 : undefined}
              disabled={!lastCreatedInvoice?.id}
              title={lastCreatedInvoice?.id ? 'Quick print (A4)' : 'Save invoice first to print'}
              className="p-1 rounded hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed text-blue-600"
              aria-label={lastCreatedInvoice?.id ? 'Quick print invoice' : 'Save invoice first to print'}
            >
              <Printer className="h-4 w-4" />
            </button>
          </div>
          <div className="bg-[#F8FAFC] rounded-xl px-3 py-2 border border-[#E5E7EB] relative">
            <span className="font-medium text-primary-700 block mb-0.5">Customer:</span>
            {selectedCustomer ? (
              <div className="flex items-center gap-2">
                <span className="text-[#0F172A] font-semibold">{selectedCustomer.name}</span>
                <button
                  type="button"
                  onClick={() => setShowCustomerSearch(true)}
                  className="text-xs text-primary-600 hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative mt-1">
                <input
                  type="text"
                  placeholder="Search customer (name/phone)..."
                  value={customerSearchTerm}
                  onChange={(e) => {
                    setCustomerSearchTerm(e.target.value)
                    setShowQuickCustomerDropdown(true)
                  }}
                  onFocus={() => setShowQuickCustomerDropdown(true)}
                  onBlur={() => setTimeout(() => setShowQuickCustomerDropdown(false), 150)}
                  className="w-full px-2 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {showQuickCustomerDropdown && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                    <div
                      className="p-2 hover:bg-primary-50 cursor-pointer border-b border-neutral-100"
                      onMouseDown={(e) => { e.preventDefault(); setSelectedCustomer(null); setCustomerSearchTerm(''); setShowQuickCustomerDropdown(false); if (isEditMode) setCustomerChangedDuringEdit(true) }}
                    >
                      <p className="font-medium text-neutral-900">Cash Customer</p>
                    </div>
                    {customers.filter((c, i, arr) => arr.findIndex(x => String(x.id) === String(c.id)) === i).filter(c =>
                      c.name?.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
                      c.phone?.includes(customerSearchTerm)
                    ).slice(0, 8).map((c) => (
                      <div
                        key={c.id}
                        className="p-2 hover:bg-primary-50 cursor-pointer"
                        onMouseDown={(e) => { e.preventDefault(); setSelectedCustomer(c); setCustomerSearchTerm(''); setShowQuickCustomerDropdown(false); if (isEditMode) setCustomerChangedDuringEdit(true) }}
                      >
                        <p className="font-medium text-neutral-900">{c.name}</p>
                        {c.phone && <p className="text-xs text-neutral-500">{c.phone}</p>}
                      </div>
                    ))}
                    {customerSearchTerm && customers.filter((c, i, arr) => arr.findIndex(x => String(x.id) === String(c.id)) === i).filter(c =>
                      c.name?.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
                      c.phone?.includes(customerSearchTerm)
                    ).length === 0 && (
                        <div className="p-3 text-sm text-neutral-500 text-center">No customers found</div>
                      )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="bg-[#F8FAFC] rounded-xl px-3 py-2 border border-[#E5E7EB]">
            <span className="font-medium text-primary-700">Address:</span>
            <span className="ml-2 text-[#0F172A]">
              {selectedCustomer?.address || '-'}
            </span>
          </div>
          <div className="bg-white rounded-lg px-3 py-2 shadow-sm border border-blue-200">
            <span className="font-medium text-blue-700">TRN:</span>
            <span className="ml-2 text-gray-900 font-mono">
              {selectedCustomer?.trn || '-'}
            </span>
          </div>
          {selectedCustomer && selectedCustomer.id !== 'cash' && (
            <div className="bg-[#F8FAFC] rounded-xl px-3 py-2 border border-[#E5E7EB]">
              <span className="font-medium text-primary-700">Balance:</span>
              <span className={`ml-2 font-bold ${selectedCustomer?.balance < 0 ? 'text-[#10B981]' : selectedCustomer?.balance > 0 ? 'text-primary-600' : 'text-[#475569]'}`}>
                {formatBalance(selectedCustomer?.balance || 0)}
              </span>
            </div>
          )}
        </div>
        {/* Credit limit warning — when balance + invoice total exceeds limit */}
        {selectedCustomer && selectedCustomer.id !== 'cash' && (() => {
          const creditLimit = Number(selectedCustomer?.creditLimit) || 0
          const customerBalance = Number(selectedCustomer?.balance) || 0
          const invoiceTotal = totals.grandTotal || 0
          const totalAfterInvoice = customerBalance + invoiceTotal
          if (creditLimit > 0 && totalAfterInvoice > creditLimit) {
            return (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600 flex-shrink-0" />
                <span className="text-xs sm:text-sm text-amber-800 font-medium">
                  Credit limit exceeded: Balance {formatBalance(customerBalance)} + This invoice {formatCurrency(invoiceTotal)} = {formatBalance(totalAfterInvoice)} (Limit: {formatCurrency(creditLimit)})
                </span>
              </div>
            )
          }
          return null
        })()}
      </div>

      {/* Main Content - pb-20 for bottom nav on mobile; mobile: no duplicate summary (only sticky bottom bar) */}
      <div className="flex-1 flex flex-col overflow-hidden overflow-x-hidden w-full pb-24 lg:pb-0">
        {/* Invoice Info Row - compact on mobile (16px padding) */}
        <div className="bg-white border-b border-[#E5E7EB] px-4 md:px-6 py-2 md:py-3 flex-shrink-0">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium text-neutral-600">Invoice No:</span>
              <span className="ml-2 text-neutral-900 font-mono">
                {isEditMode && editingSale ? editingSale.invoiceNo : (lastCreatedInvoice?.invoiceNo || nextInvoiceNumberPreview || '(Auto-generated)')}
              </span>
            </div>
            <div className="text-right flex items-center justify-end gap-3 flex-wrap">
{staffHasNoAssignments && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm w-full sm:w-auto">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <span>No branches or routes assigned. Contact your admin.</span>
                </div>
              )}
              {/* Branch Selector */}
              {!staffHasNoAssignments && (
                <div className="flex items-center gap-2">
                  <label className="font-medium text-neutral-600 hidden sm:inline">Branch:</label>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => {
                      setSelectedBranchId(e.target.value)
                      // Reset route when branch changes
                      setSelectedRouteId('')
                    }}
                    disabled={branchesRoutesLoading || branches.length === 0 || (!isAdminOrOwner(user) && branches.length === 1)}
                    className="px-2 py-1.5 border border-neutral-300 rounded-lg text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">{branchesRoutesLoading ? 'Loading...' : branches.length === 0 ? 'No branches' : 'Select Branch'}</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Route Selector */}
              {!staffHasNoAssignments && (
                <div className="flex items-center gap-2">
                  <label className="font-medium text-neutral-600 hidden sm:inline">Route:</label>
                  <select
                    value={selectedRouteId}
                    onChange={(e) => setSelectedRouteId(e.target.value)}
                    disabled={branchesRoutesLoading || routes.length === 0 || !selectedBranchId || (!isAdminOrOwner(user) && (selectedBranchId ? routes.filter(r => r.branchId === parseInt(selectedBranchId, 10)) : routes).length <= 1)}
                    className="px-2 py-1.5 border border-neutral-300 rounded-lg text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">{branchesRoutesLoading ? 'Loading...' : routes.length === 0 ? 'No routes' : (selectedBranchId ? 'Select Route' : 'Select Branch first')}</option>
                    {routes
                      // Filter routes by selected branch if a branch is selected
                      .filter(r => !selectedBranchId || r.branchId === parseInt(selectedBranchId))
                      .map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <label className="font-medium text-neutral-600 hidden sm:inline">Date:</label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="px-3 py-1.5 border border-neutral-300 rounded-lg text-neutral-900 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
                />
              </div>
              <button
                type="button"
                onClick={handleRefreshData}
                disabled={refreshingData}
                className="inline-flex items-center gap-1.5 px-2 py-1.5 text-sm border border-neutral-300 rounded-lg hover:bg-neutral-50 disabled:opacity-60"
                title="Refresh products, customers, and branch/route list (Staff: only assigned)"
              >
                <RefreshCw className={`h-4 w-4 ${refreshingData ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </div>

        {/* Items Table - FULL WIDTH TALLY STYLE (Desktop) / CARD LAYOUT (Mobile) */}
        <div className="flex-1 overflow-hidden bg-neutral-50 min-w-0" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="flex-1 overflow-y-auto px-2 py-2 md:pb-2"> {/* Removed fixed bottom padding for mobile - now fully scrollable */}
            {/* Desktop Table View - with horizontal scroll on small screens */}
            <div className="hidden md:block bg-white rounded-lg border-2 border-gray-300 shadow-lg overflow-x-auto">
              <div>
                <table className="w-full text-xs sm:text-sm border-collapse" style={{ tableLayout: 'auto' }}>
                  <thead className="bg-gray-100 border-2 border-gray-300">
                    <tr>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-left font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-12 text-xs sm:text-sm">SL<br /><span className="text-xs sm:text-xs font-normal text-gray-600">رقم</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-left font-bold text-gray-900 border-r-2 border-gray-300 w-80 text-xs sm:text-sm">Description<br /><span className="text-xs sm:text-xs font-normal text-gray-600">التفاصيل</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-center font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-28 text-xs sm:text-sm">Unit<br /><span className="text-xs sm:text-xs font-normal text-gray-600">الوحدة</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-center font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-24 text-xs sm:text-sm">Qty<br /><span className="text-xs sm:text-xs font-normal text-gray-600">الكمية</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-right font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-32 text-xs sm:text-sm">Unit Price<br /><span className="text-xs sm:text-xs font-normal text-gray-600">سعر الوحدة</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-right font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-28 text-xs sm:text-sm">Total<br /><span className="text-xs sm:text-xs font-normal text-gray-600">الإجمالي</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-right font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-24 text-xs sm:text-sm">Discount<br /><span className="text-xs sm:text-xs font-normal text-gray-600">خصم</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-right font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-28 text-xs sm:text-sm">Vat:{vatPercent}%<br /><span className="text-xs sm:text-xs font-normal text-gray-600">ضريبة {vatPercent}%</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-right font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-32 text-xs sm:text-sm">Amount<br /><span className="text-xs sm:text-xs font-normal text-gray-600">المبلغ</span></th>
                      <th className="px-2 sm:px-3 py-2 sm:py-3 text-center font-bold text-gray-900 border-r-2 border-gray-300 whitespace-nowrap w-24 text-xs sm:text-sm">Actions<br /><span className="text-xs sm:text-xs font-normal text-gray-600">إجراءات</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {cart.length === 0 ? (
                      <tr>
                        <td colSpan="10" className="px-4 py-12 text-center text-gray-500 text-base">
                          No items in cart. Click + to add products
                        </td>
                      </tr>
                    ) : (
                      cart.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50 border-b border-gray-200">
                          <td className="px-2 sm:px-3 py-3 sm:py-4 text-center border-r-2 border-gray-200 font-medium text-sm align-middle">{index + 1}</td>
                          <td className="px-2 sm:px-3 py-3 sm:py-4 border-r-2 border-gray-200 min-h-[80px] align-top" style={{ position: 'relative', overflow: 'visible' }}>
                            <div className="relative product-dropdown-container" style={{ zIndex: showProductDropdown[index] ? 9999 : 1 }}>
                              {item.productId ? (
                                <div className="py-2 flex items-start gap-2">
                                  {/* Product Image Thumbnail */}
                                  {(() => {
                                    const product = products.find(p => p.id === item.productId)
                                    const imageUrl = product?.imageUrl || product?.image || null
                                    return imageUrl ? (
                                      <img 
                                        src={imageUrl} 
                                        alt={item.productName}
                                        className="w-12 h-12 object-cover rounded border border-gray-200 flex-shrink-0"
                                        onError={(e) => { e.target.style.display = 'none' }}
                                      />
                                    ) : (
                                      <div className="w-12 h-12 bg-gray-100 rounded border border-gray-200 flex-shrink-0 flex items-center justify-center">
                                        <Package className="h-6 w-6 text-gray-400" />
                                      </div>
                                    )
                                  })()}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-gray-900 text-base leading-snug break-words">{item.productName}</p>
                                    <p className="text-xs text-gray-500 mt-1.5">{item.sku}</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="relative product-dropdown-container">
                                  <div className="flex gap-1">
                                    <input
                                      type="text"
                                      ref={(el) => productSearchRefs.current[index] = el}
                                      value={productSearchTerms[index] || ''}
                                      disabled={isFormDisabled}
                                      onChange={(e) => {
                                        const searchValue = e.target.value
                                        setProductSearchTerms(prev => ({ ...prev, [index]: searchValue }))
                                        // Auto-open dropdown when user starts typing OR when empty (to browse all)
                                        if (!showProductDropdown[index]) {
                                          setShowProductDropdown(prev => ({ ...prev, [index]: true }))
                                        }
                                      }}
                                      onFocus={() => {
                                        if (isFormDisabled) return
                                        // Always show dropdown when focused (even if empty - allows browsing all products)
                                        setShowProductDropdown(prev => ({ ...prev, [index]: true }))
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      placeholder="Type to search product..."
                                      className="flex-1 px-3 py-3 border-2 border-blue-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white min-h-[52px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    {/* Barcode Scanner Input */}
                                    <input
                                      type="text"
                                      disabled={isFormDisabled}
                                      onKeyDown={async (e) => {
                                        if (e.key === 'Enter' && e.target.value.trim()) {
                                          const barcode = e.target.value.trim()
                                          const product = products.find(p => 
                                            p.barcode?.toLowerCase() === barcode.toLowerCase() ||
                                            p.sku?.toLowerCase() === barcode.toLowerCase()
                                          )
                                          if (product) {
                                            addToCart(product, index)
                                            e.target.value = ''
                                            toast.success(`Added ${product.nameEn}`)
                                          } else {
                                            toast.error(`Product not found for barcode: ${barcode}`)
                                          }
                                        }
                                      }}
                                      placeholder="📷 Scan"
                                      className="w-20 px-2 py-3 border-2 border-purple-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-purple-50 min-h-[52px] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Scan barcode or enter product code"
                                    />
                                  </div>
                                  {showProductDropdown[index] && (
                                    <>
                                      {/* Arrow pointing down */}
                                      <div className="absolute z-[9999] top-full left-4 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[10px] border-l-transparent border-r-transparent border-t-blue-400" style={{ marginTop: '-1px' }}></div>
                                      {/* Dropdown - Positioned ABOVE table overflow with HIGHEST z-index */}
                                      <div
                                        className="fixed bg-white border-2 border-blue-400 rounded-lg shadow-lg z-[10000]"
                                        style={{
                                          maxHeight: '500px',
                                          width: '600px',
                                          overflowY: 'auto',
                                          overflowX: 'hidden',
                                          top: `${productSearchRefs.current[index]?.getBoundingClientRect().bottom + 2}px`,
                                          left: `${productSearchRefs.current[index]?.getBoundingClientRect().left}px`,
                                          boxShadow: '0 10px 25px rgba(0,0,0,0.3)'
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {(() => {
                                          if (loadingProducts) {
                                            return (
                                              <div className="p-4 text-center">
                                                <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                                                <p className="text-sm text-gray-500 mt-2">Loading products...</p>
                                              </div>
                                            )
                                          }

                                          const filtered = getFilteredProducts(index)
                                          const searchTerm = productSearchTerms[index] || ''
                                          const totalProducts = products.length
                                          const showingCount = filtered.length
                                          const hasMore = totalProducts > showingCount
                                          
                                          // Show "Browse All" message when no search term
                                          const isBrowsingAll = !searchTerm.trim()

                                          return filtered.length > 0 ? (
                                            <>
                                              {/* Show browse message when no search term */}
                                              {isBrowsingAll && (
                                                <div className="p-3 bg-blue-50 border-b border-blue-200">
                                                  <p className="text-sm text-blue-700 font-medium">
                                                    📦 Browsing all products ({showingCount} shown, {totalProducts} total)
                                                  </p>
                                                  <p className="text-xs text-blue-600 mt-1">
                                                    Type to search or scroll to browse
                                                  </p>
                                                </div>
                                              )}
                                              
                                              {/* Product list */}
                                              {filtered.map((product) => (
                                                <div
                                                  key={product.id}
                                                  className="p-2.5 border-b border-gray-200 hover:bg-blue-50 cursor-pointer transition-colors active:bg-blue-100"
                                                  onMouseDown={(e) => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                  }}
                                                  onClick={(e) => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    addToCart(product, index)
                                                  }}
                                                >
                                                  <div className="flex items-center justify-between w-full">
                                                    <div className="flex-1 min-w-0">
                                                      <p className="font-medium text-sm text-gray-900 truncate">{product.nameEn}</p>
                                                      <p className="text-xs text-gray-600">AED {product.sellPrice.toFixed(2)}</p>
                                                    </div>
                                                    <div className="text-right ml-2 flex-shrink-0">
                                                      <p className={`text-xs font-semibold ${product.stockQty <= (product.reorderLevel || 0) ? 'text-red-600' : 'text-green-600'}`}>
                                                        Stock: {product.stockQty} {product.unitType || 'KG'}
                                                      </p>
                                                      {product.stockQty <= (product.reorderLevel || 0) && (
                                                        <p className="text-xs text-red-500">Low Stock!</p>
                                                      )}
                                                    </div>
                                                  </div>
                                                </div>
                                              ))}
                                              {/* Show more indicator */}
                                              {hasMore && (
                                                <div className="p-2 bg-blue-50 border-t border-blue-200 text-center">
                                                  <p className="text-xs text-blue-700 font-medium">
                                                    Showing {showingCount} of {totalProducts} products. Type to search for more...
                                                  </p>
                                                </div>
                                              )}
                                            </>
                                          ) : (
                                            <div className="p-3 text-center">
                                              <p className="text-sm text-gray-500">No products found</p>
                                              <p className="text-xs text-gray-500 mt-1">Try a different search term</p>
                                            </div>
                                          )
                                        })()}
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          {/* Unit Column: Editable numeric quantity (1.5, 1, 0.5) */}
                          <td className="px-2 sm:px-3 py-3 sm:py-4 border-r-2 border-gray-200 align-middle">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={isFormDisabled}
                              className="w-full px-3 py-3 border-2 border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500 text-base font-semibold min-h-[52px] disabled:opacity-50 disabled:cursor-not-allowed"
                              value={item.qty === '' ? '' : item.qty}
                              onChange={(e) => updateCartItem(index, 'qty', e.target.value)}
                              placeholder="1.5"
                            />
                          </td>
                          {/* Unit Type Column: Display product's UnitType (read-only to prevent stock calculation errors) */}
                          <td className="px-2 sm:px-3 py-3 sm:py-4 border-r-2 border-gray-200 align-middle">
                            {item.productId ? (
                              <div className="w-full px-3 py-3 border-2 border-gray-200 rounded-lg text-center text-base font-medium uppercase min-h-[52px] bg-gray-50">
                                {item.unitType || 'CRTN'}
                              </div>
                            ) : (
                              <select
                                disabled={isFormDisabled}
                                className="w-full px-3 py-3 border-2 border-gray-300 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500 text-base font-medium uppercase min-h-[52px] disabled:opacity-50 disabled:cursor-not-allowed"
                                value={item.unitType || 'CRTN'}
                                onChange={(e) => updateCartItem(index, 'unitType', e.target.value)}
                              >
                                <option value="CRTN">CRTN</option>
                                <option value="KG">KG</option>
                                <option value="PIECE">PIECE</option>
                                <option value="BOX">BOX</option>
                                <option value="PKG">PKG</option>
                                <option value="BAG">BAG</option>
                                <option value="PC">PC</option>
                                <option value="UNIT">UNIT</option>
                              </select>
                            )}
                          </td>
                          <td className="px-2 sm:px-3 py-3 sm:py-4 border-r-2 border-gray-200 align-middle">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={isFormDisabled}
                              className="w-full px-3 py-3 border-2 border-gray-300 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-base font-semibold min-h-[52px] disabled:opacity-50 disabled:cursor-not-allowed"
                              value={item.unitPrice === '' ? '' : item.unitPrice}
                              onChange={(e) => updateCartItem(index, 'unitPrice', e.target.value)}
                            />
                          </td>
                          <td className="px-2 sm:px-3 py-3 sm:py-4 text-right border-r-2 border-gray-200 font-semibold text-base align-middle">
                            {(() => {
                              const qty = typeof item.qty === 'number' ? item.qty : 0
                              const price = typeof item.unitPrice === 'number' ? item.unitPrice : 0
                              const itemDiscount = typeof item.discount === 'number' ? item.discount : 0
                              return ((qty * price) - itemDiscount).toFixed(2)
                            })()}
                          </td>
                          <td className="px-2 sm:px-3 py-3 sm:py-4 border-r-2 border-gray-200 align-middle">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={isFormDisabled}
                              className="w-full px-2 py-2 border-2 border-gray-300 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium min-h-[40px] disabled:opacity-50 disabled:cursor-not-allowed"
                              value={item.discount === '' || item.discount === undefined ? '' : item.discount}
                              onChange={(e) => updateCartItem(index, 'discount', e.target.value)}
                              placeholder="0.00"
                            />
                          </td>
                          <td className="px-2 sm:px-3 py-3 sm:py-4 text-right border-r-2 border-gray-200 font-semibold text-base align-middle">
                            {item.vatAmount.toFixed(2)}
                          </td>
                          <td className="px-2 sm:px-3 py-3 sm:py-4 text-right font-bold border-r-2 border-gray-200 text-base align-middle">
                            {item.lineTotal.toFixed(2)}
                          </td>
                          <td className="px-2 sm:px-3 py-3 sm:py-4 text-center align-middle border-r-2 border-gray-200">
                            <button
                              onClick={() => removeFromCart(index)}
                              disabled={isFormDisabled}
                              className="text-red-600 hover:text-red-800 hover:bg-red-50 p-2 rounded-lg transition-colors inline-flex items-center justify-center min-w-[44px] min-h-[44px] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Delete item"
                              aria-label="Delete item"
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Card Layout - design lock: border only, 44px touch, auto-scroll on add */}
            <div className="md:hidden space-y-3">
              <button
                onClick={addEmptyRow}
                disabled={isFormDisabled}
                className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center justify-center text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform min-h-[44px]"
              >
                <Plus className="h-5 w-5 mr-2" />
                Add Product to Bill
              </button>

              {cart.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-neutral-300 p-8 text-center">
                  <div className="text-neutral-400 mb-2">
                    <Calculator className="h-12 w-12 mx-auto" />
                  </div>
                  <p className="text-neutral-600 font-medium">No items in cart</p>
                  <p className="text-neutral-500 text-sm mt-1">Tap &apos;Add Product to Bill&apos; above</p>
                </div>
              ) : (
                cart.map((item, index) => (
                  <div key={index} className="bg-white rounded-xl border border-neutral-200 p-4">
                    {/* Header: Product Name or Search */}
                    <div className="bg-neutral-50 p-3 border-b border-neutral-200">
                      <div className="flex items-start gap-2 mb-2">
                        {/* Product Image Thumbnail */}
                        {item.productId && (() => {
                          const product = products.find(p => p.id === item.productId)
                          const imageUrl = product?.imageUrl || product?.image || null
                          return imageUrl ? (
                            <img 
                              src={imageUrl} 
                              alt={item.productName}
                              className="w-10 h-10 object-cover rounded border border-gray-200 flex-shrink-0"
                              onError={(e) => { e.target.style.display = 'none' }}
                            />
                          ) : (
                            <div className="w-10 h-10 bg-gray-100 rounded border border-gray-200 flex-shrink-0 flex items-center justify-center">
                              <Package className="h-5 w-5 text-gray-400" />
                            </div>
                          )
                        })()}
                        <div className="flex-1 min-w-0">
                          {item.productId ? (
                            <div>
                              <p className="font-bold text-neutral-900 text-sm">#{index + 1} {item.productName}</p>
                              <p className="text-xs text-neutral-600">{item.sku}</p>
                            </div>
                          ) : null}
                        </div>
                        <button
                          onClick={() => removeFromCart(index)}
                          disabled={isFormDisabled}
                          className="text-error hover:text-error/90 p-2 rounded-lg hover:bg-error/10 min-w-[44px] min-h-[44px] flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label="Delete item"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                      {!item.productId && (
                        <div className="relative w-full mt-2">
                          <p className="text-xs text-neutral-600 mb-1">#{index + 1} Select Product:</p>
                          <input
                            type="text"
                            ref={(el) => productSearchRefs.current[index] = el}
                            value={productSearchTerms[index] || ''}
                            disabled={isFormDisabled}
                            onChange={(e) => {
                              const searchValue = e.target.value
                              setProductSearchTerms(prev => ({ ...prev, [index]: searchValue }))
                              if (searchValue.trim() && !showProductDropdown[index]) {
                                setShowProductDropdown(prev => ({ ...prev, [index]: true }))
                              }
                            }}
                            onFocus={() => {
                              if (isFormDisabled) return
                              setShowProductDropdown(prev => ({ ...prev, [index]: true }))
                            }}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Search product name or code..."
                            className="product-search w-full px-3 py-2.5 border border-neutral-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          {showProductDropdown[index] && (
                            <div
                              className="fixed bg-white border border-neutral-200 rounded-lg shadow-md z-[9998]"
                              style={{
                                maxHeight: '60vh',
                                width: 'calc(100vw - 32px)',
                                top: `${productSearchRefs.current[index]?.getBoundingClientRect().bottom + 4}px`,
                                left: '16px'
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {(() => {
                                if (loadingProducts) {
                                  return (
                                    <div className="p-4 text-center">
                                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                                      <p className="text-sm text-gray-500 mt-2">Loading products...</p>
                                    </div>
                                  )
                                }

                                const filtered = getFilteredProducts(index)
                                return filtered.length > 0 ? (
                                  <div className="divide-y divide-gray-200">
                                    {filtered.map((product) => (
                                      <div
                                        key={product.id}
                                        className="p-3 hover:bg-primary-50 active:bg-primary-100 cursor-pointer"
                                        onMouseDown={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                        }}
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          addToCart(product, index)
                                        }}
                                      >
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm text-gray-900 truncate">{product.nameEn}</p>
                                            <p className="text-xs text-gray-600 mt-0.5">AED {product.sellPrice.toFixed(2)}</p>
                                          </div>
                                          <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded ${product.stockQty > (product.reorderLevel || 0) ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                                            }`}>
                                            Stock: {product.stockQty}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="p-4 text-center text-neutral-500 text-sm">
                                    No products found
                                  </div>
                                )
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Body: Input Fields - Large Touch Targets - Mobile Only */}
                    <div className="p-3 space-y-2">
                      {/* Row 1: Quantity and Unit - min-h-11 (44px) touch targets */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">Quantity</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={isFormDisabled}
                            className="w-full min-h-[44px] px-3 py-2.5 border border-neutral-300 rounded-lg text-center text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            value={item.qty === '' ? '' : item.qty}
                            onChange={(e) => updateCartItem(index, 'qty', e.target.value)}
                            placeholder="1"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-1">Unit Type</label>
                          <select
                            disabled={isFormDisabled}
                            className="w-full min-h-[44px] px-2 py-2.5 border border-neutral-300 rounded-lg text-center text-sm font-bold uppercase focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            value={item.unitType || 'CRTN'}
                            onChange={(e) => updateCartItem(index, 'unitType', e.target.value)}
                          >
                            <option value="CRTN">CRTN</option>
                            <option value="KG">KG</option>
                            <option value="PIECE">PIECE</option>
                            <option value="BOX">BOX</option>
                            <option value="PKG">PKG</option>
                            <option value="BAG">BAG</option>
                            <option value="PC">PC</option>
                            <option value="UNIT">UNIT</option>
                          </select>
                        </div>
                      </div>

                      {/* Row 2: Unit Price */}
                      <div>
                        <label className="block text-xs font-bold text-neutral-700 mb-1">Unit Price (AED)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={isFormDisabled}
                          className="w-full px-3 py-2.5 border border-neutral-300 rounded-lg text-right text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          value={item.unitPrice === '' ? '' : item.unitPrice}
                          onChange={(e) => updateCartItem(index, 'unitPrice', e.target.value)}
                          placeholder="0.00"
                        />
                      </div>

                      {/* Row 3: Calculated Values - Read Only */}
                      <div className="bg-neutral-50 rounded-lg p-2 border border-neutral-200">
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="text-center">
                            <p className="text-neutral-600 font-medium">Total</p>
                            <p className="font-bold text-neutral-900">{(() => {
                              const qty = typeof item.qty === 'number' ? item.qty : 0
                              const price = typeof item.unitPrice === 'number' ? item.unitPrice : 0
                              return (qty * price).toFixed(2)
                            })()}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-neutral-600 font-medium">VAT {vatPercent}%</p>
                            <p className="font-bold text-neutral-900">{item.vatAmount.toFixed(2)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-neutral-600 font-medium">Amount</p>
                            <p className="font-bold text-success text-sm">{item.lineTotal.toFixed(2)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Add Row Button - Desktop Only; pb-safe ensures clickable above fixed bottom nav on tablet */}
          <div className="hidden md:block px-2 py-2 pb-20 lg:pb-2">
            <button
              onClick={addEmptyRow}
              disabled={isFormDisabled}
              className="w-full md:w-auto px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center justify-center md:justify-start text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Product Row
            </button>
          </div>
        </div>

        {/* Bottom - Totals, Discount & Payment. Mobile: moved to bottom sheet; desktop: 3-column */}
        <div className="bg-white border-t border-[#E5E7EB] p-4 flex-shrink-0 md:static">
          {/* DESKTOP: Original 3-column Layout */}
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 lg:gap-4">
            {/* Totals Box - Compact with No Number Wrapping */}
            <div className="bg-gray-50 rounded-lg border-2 border-gray-300 p-2 sm:p-3">
              <h3 className="text-xs sm:text-sm font-bold text-gray-900 mb-1.5 sm:mb-2 border-b border-gray-400 pb-1">Totals</h3>
              <div className="space-y-1 sm:space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-gray-700">INV.Amount</span>
                  <span className="font-bold text-xs sm:text-sm text-gray-900 whitespace-nowrap">AED {totals.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-gray-700">VAT {vatPercent}%</span>
                  <span className="font-bold text-xs sm:text-sm text-gray-900 whitespace-nowrap">AED {totals.vatTotal.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between items-center text-red-700">
                    <span className="text-xs font-medium">Discount</span>
                    <span className="font-bold text-xs sm:text-sm whitespace-nowrap">-AED {discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-xs font-medium text-gray-700">Round Off / تقريب</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={handleAutoRoundOff} disabled={isFormDisabled || isZeroInvoice} className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50">Auto</button>
                    <input
                      type="number"
                      step="0.01"
                      min="-1"
                      max="1"
                      value={roundOffInput === '' && roundOff === 0 ? '' : roundOffInput}
                      onChange={(e) => {
                        const v = e.target.value
                        setRoundOffInput(v)
                        const n = v === '' ? 0 : parseFloat(v)
                        setRoundOff(isNaN(n) ? 0 : n)
                      }}
                      onBlur={() => {
                        const n = roundOffInput === '' ? 0 : parseFloat(roundOffInput)
                        if (!isNaN(n)) {
                          setRoundOff(n)
                          setRoundOffInput(n === 0 ? '' : n.toFixed(2))
                        }
                      }}
                      disabled={isFormDisabled || isZeroInvoice}
                      className="w-20 text-right border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-50"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs sm:text-sm font-bold border-t border-gray-400 pt-1.5">
                  <span className="text-gray-800">Total / المجموع</span>
                  <span className="text-green-700 text-sm sm:text-base whitespace-nowrap">AED {totals.grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Zero invoice / Free sample (FTA) */}
              {!isEditMode && (
                <div className="mt-2 pt-1.5 border-t border-gray-300 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="pos-zero-invoice"
                    checked={isZeroInvoice}
                    onChange={(e) => {
                      const v = !!e.target.checked
                      setIsZeroInvoice(v)
                      if (v) {
                        setDiscount(0)
                        setDiscountInput('0')
                      }
                    }}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="pos-zero-invoice" className="text-xs font-medium text-gray-700">Free sample / Zero invoice</label>
                  {isZeroInvoice && <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">0 VAT</span>}
                </div>
              )}
              {/* Optional Discount Field - Compact */}
              <div className="mt-2 pt-1.5 border-t border-gray-300">
                <label className="block text-xs font-medium text-gray-700 mb-1">Discount</label>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={isFormDisabled || isZeroInvoice}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="0.00"
                  value={discountInput}
                  onChange={(e) => {
                    const value = e.target.value
                    // Allow empty, numbers, and one decimal point
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setDiscountInput(value)
                      // Update numeric discount for calculations
                      const numValue = value === '' ? 0 : parseFloat(value)
                      setDiscount(isNaN(numValue) ? 0 : numValue)
                    }
                  }}
                  onBlur={() => {
                    // Format on blur: if empty, set to 0, otherwise format to 2 decimals
                    if (discountInput === '' || discountInput === '0' || discountInput === '0.') {
                      setDiscountInput('')
                      setDiscount(0)
                    } else {
                      const numValue = parseFloat(discountInput)
                      if (!isNaN(numValue)) {
                        setDiscountInput(numValue.toFixed(2))
                        setDiscount(numValue)
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* Payment Info Box - Compact */}
            <div className="bg-gray-50 rounded-lg border-2 border-gray-300 p-2 sm:p-3">
              <h3 className="text-xs sm:text-sm font-bold text-gray-900 mb-1.5 sm:mb-2 border-b border-gray-400 pb-1">
                Payment <span className="text-xs font-normal text-gray-500">(Optional)</span>
              </h3>
              <div className="space-y-1.5 sm:space-y-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
                  <select
                    disabled={isFormDisabled}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="Pending">Credit Invoice</option>
                    <option value="Cash">Cash</option>
                    <option value="Debit">Debit (Card)</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Online">Online</option>
                  </select>
                </div>

                {paymentMethod !== 'Pending' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={isFormDisabled}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      placeholder="Full amount if empty"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                    />
                    {/* Quick Amount Buttons */}
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[100, 500, 1000, 2000, 5000].map(amount => (
                        <button
                          key={amount}
                          type="button"
                          disabled={isFormDisabled}
                          onClick={() => {
                            const totals = calculateTotals()
                            const maxAmount = Math.min(amount, totals.grandTotal)
                            setPaymentAmount(maxAmount.toFixed(2))
                          }}
                          className="px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 active:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {amount}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    disabled={isFormDisabled}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    rows="2"
                    placeholder="Notes..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Save Button Box - Compact */}
            <div className="flex flex-col justify-end">
              <button
                onClick={handleSave}
                disabled={loading || loadingSale || cart.length === 0}
                title={cart.length === 0 && !loading && !loadingSale ? 'Add at least one item to checkout' : undefined}
                className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg font-bold text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-lg transition-all active:scale-95 ${isEditMode
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
              >
                {(loading || loadingSale) ? (
                  <div className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-b-2 border-white mr-1.5"></div>
                ) : (
                  <Save className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5" />
                )}
                <span className="text-xs sm:text-sm">{isEditMode ? 'Update Invoice' : 'Save Invoice'}</span>
              </button>
              <p className="text-xs text-gray-500 text-center mt-1">Auto-backup enabled</p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: Sticky bottom bar — single total + one CTA (opens payment sheet) */}
      <div className="md:hidden fixed bottom-14 left-0 right-0 z-40 bg-white border-t border-[#E5E7EB] px-4 py-3 flex items-center justify-between gap-4" style={{ boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
        <div>
          <span className="text-xs text-[#475569] block">Total</span>
          <span className="text-lg font-bold text-[#10B981]">AED {totals.grandTotal.toFixed(2)}</span>
        </div>
        <button
          onClick={() => (cart.length > 0 ? setShowPaymentSheet(true) : null)}
          disabled={loading || loadingSale || cart.length === 0}
          title={cart.length === 0 && !loading && !loadingSale ? 'Add at least one item to checkout' : undefined}
          className="flex-1 max-w-[200px] px-4 py-3 rounded-xl font-bold text-sm bg-primary-600 text-white hover:bg-primary-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {(loading || loadingSale) ? (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
          ) : (
            <CheckCircle className="h-5 w-5" />
          )}
          <span>{isEditMode ? 'Update' : 'Checkout'}</span>
        </button>
      </div>

      {/* Mobile: Payment bottom sheet (discount, payment, notes, confirm) — CTA always visible above bottom nav */}
      {showPaymentSheet && (
        <div className="md:hidden fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPaymentSheet(false)} aria-hidden />
          <div className="relative bg-white rounded-t-xl shadow-xl max-h-[90vh] flex flex-col animate-slideUp">
            <div className="flex-shrink-0 px-4 pt-4 pb-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-[#0F172A]">Payment</h3>
                <button type="button" onClick={() => setShowPaymentSheet(false)} className="p-2 rounded-lg hover:bg-[#F8FAFC] transition-colors" aria-label="Close">
                  <X className="h-5 w-5 text-[#475569]" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[#475569]">Subtotal</span>
                <span className="font-medium text-[#0F172A]">AED {totals.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#475569]">VAT {vatPercent}%</span>
                <span className="font-medium text-[#0F172A]">AED {totals.vatTotal.toFixed(2)}</span>
              </div>
              <div className="pt-2 border-t border-[#E5E7EB]">
                <label className="block text-xs font-medium text-[#475569] mb-1">Discount (AED)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-xl text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="0.00"
                  value={discountInput}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^\d*\.?\d*$/.test(v)) {
                      setDiscountInput(v)
                      setDiscount(v === '' ? 0 : (parseFloat(v) || 0))
                    }
                  }}
                />
              </div>
              <div className="pt-2">
                <label className="block text-xs font-medium text-[#475569] mb-1">Round Off / تقريب (AED)</label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={handleAutoRoundOff} disabled={isZeroInvoice} className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded border border-[#E5E7EB]">Auto</button>
                  <input
                    type="number"
                    step="0.01"
                    min="-1"
                    max="1"
                    className="flex-1 px-3 py-2 border border-[#E5E7EB] rounded-xl text-[#0F172A] text-right focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="0.00"
                    value={roundOffInput === '' && roundOff === 0 ? '' : roundOffInput}
                    onChange={(e) => {
                      const v = e.target.value
                      setRoundOffInput(v)
                      setRoundOff(v === '' ? 0 : (parseFloat(v) || 0))
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-between pt-2 font-semibold">
                <span className="text-[#0F172A]">Grand Total / المجموع</span>
                <span className="text-[#10B981]">AED {totals.grandTotal.toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Payment method</label>
                <select
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-xl text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="Pending">Credit (Pay later)</option>
                  <option value="Cash">Cash</option>
                  <option value="Debit">Debit (Card)</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Online">Online</option>
                </select>
              </div>
              {paymentMethod !== 'Pending' && (
                <div>
                  <label className="block text-xs font-medium text-[#475569] mb-1">Amount (AED)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 border border-[#E5E7EB] rounded-xl text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder={totals.grandTotal.toFixed(2)}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                  />
                  {/* Quick Amount Buttons */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {[100, 500, 1000, 2000, 5000].map(amount => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => {
                          const totals = calculateTotals()
                          const maxAmount = Math.min(amount, totals.grandTotal)
                          setPaymentAmount(maxAmount.toFixed(2))
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 active:bg-blue-200 transition-colors"
                      >
                        {amount} AED
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Notes (optional)</label>
                <textarea
                  className="w-full px-3 py-2 border border-[#E5E7EB] rounded-xl text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  rows={2}
                  placeholder="Notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-shrink-0 px-4 pt-3 pb-4 border-t border-[#E5E7EB] bg-white" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
              <button
                onClick={async () => {
                  await handleSave()
                  setShowPaymentSheet(false)
                }}
                disabled={loading || loadingSale || cart.length === 0}
                title={cart.length === 0 && !loading && !loadingSale ? 'Add at least one item to checkout' : undefined}
                className="w-full py-3.5 rounded-xl font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors duration-150 min-h-[48px]"
              >
                {(loading || loadingSale) ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                ) : (
                  <CheckCircle className="h-5 w-5" />
                )}
                <span>{isEditMode ? 'Update Invoice' : 'Save & Generate Invoice'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Search Modal */}
      {showCustomerSearch && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg border-2 border-blue-300 shadow-xl w-full max-w-md">
            <div className="p-4 border-b-2 border-blue-300 bg-blue-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Select Customer</h3>
              <button
                onClick={() => {
                  setShowCustomerSearch(false)
                  setCustomerSearchTerm('')
                }}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Close customer search"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <div className="relative mb-4">
                <input
                  ref={customerInputRef}
                  type="text"
                  placeholder="Search customers (F4)..."
                  className="w-full px-3 py-2 border-2 border-blue-300 rounded text-sm"
                  value={customerSearchTerm}
                  onChange={(e) => setCustomerSearchTerm(e.target.value)}
                />
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                <div
                  className="p-3 border border-blue-200 rounded-lg hover:bg-blue-50 cursor-pointer bg-blue-50"
                  onClick={() => {
                    setSelectedCustomer(null)
                    // Track that user intentionally changed customer during edit
                    if (isEditMode) {
                      setCustomerChangedDuringEdit(true)
                    }
                    setShowCustomerSearch(false)
                    setCustomerSearchTerm('')
                  }}
                >
                  <p className="font-medium text-gray-900">Cash Customer</p>
                </div>
                {filteredCustomers.map((customer) => (
                  <div
                    key={customer.id}
                    className="p-3 border border-blue-200 rounded-lg hover:bg-blue-50 cursor-pointer"
                    onClick={() => {
                      setSelectedCustomer(customer)
                      // Track that user intentionally changed customer during edit
                      if (isEditMode) {
                        setCustomerChangedDuringEdit(true)
                      }
                      setShowCustomerSearch(false)
                      setCustomerSearchTerm('')
                    }}
                  >
                    <p className="font-medium text-gray-900">{customer.name}</p>
                    <p className="text-xs text-gray-500">{customer.phone}</p>
                    {customer.address && <p className="text-xs text-gray-500">{customer.address}</p>}
                    <p className={`text-xs font-medium ${customer.balance < 0 ? 'text-green-600' : customer.balance > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                      Balance: {formatBalance(customer.balance || 0)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Reason Modal */}
      {showEditReasonModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-yellow-50">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center">
                  <AlertTriangle className="h-6 w-6 text-yellow-600 mr-2" />
                  Edit Reason Required
                </h2>
                <p className="text-sm text-gray-600 mt-1">Staff users must provide a reason for editing invoices</p>
              </div>
              <button
                onClick={() => setShowEditReasonModal(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close edit reason modal"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reason for Editing Invoice:
              </label>
              <textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Enter reason for editing this invoice (e.g., 'Wrong quantity entered', 'Customer requested change', etc.)"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                rows={4}
                autoFocus
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={async () => {
                    if (!editReason.trim()) {
                      toast.error('Please provide a reason for editing')
                      return
                    }
                    setShowEditReasonModal(false)
                    // Proceed with save - the editReason is already in state
                    // Re-trigger save by setting loading and calling the save logic
                    setLoading(true)
                    try {
                      const totals = calculateTotals()
                      const routeIdNum = selectedRouteId ? parseInt(selectedRouteId, 10) : null
                      const selectedRoute = routeIdNum && routes?.length ? routes.find(r => Number(r.id) === routeIdNum) : null
                      const branchIdNum = selectedRoute?.branchId != null ? Number(selectedRoute.branchId) : (selectedBranchId ? parseInt(selectedBranchId, 10) : null)
                      const saleData = {
                        customerId: selectedCustomer?.id || null,
                        items: cart.filter(item => item.productId && item.qty > 0 && (isZeroInvoice || item.unitPrice > 0)).map(item => ({
                          productId: item.productId,
                          unitType: item.unitType || 'CRTN',
                          qty: Number(item.qty),
                          unitPrice: isZeroInvoice ? 0 : Number(item.unitPrice),
                          discount: Number(item.discount) || 0
                        })),
                        discount: isZeroInvoice ? 0 : (discount || 0),
                        roundOff: isZeroInvoice ? 0 : (roundOff ?? 0),
                        isZeroInvoice: !!isZeroInvoice,
                        payments: (paymentMethod !== 'Pending' && (totals.grandTotal || 0) > 0)
                          ? [{
                              method: paymentMethod,
                              amount: (paymentAmount && !isNaN(parseFloat(paymentAmount)) && parseFloat(paymentAmount) > 0)
                                ? parseFloat(paymentAmount)
                                : totals.grandTotal
                            }]
                          : [],
                        notes: notes || null,
                        invoiceDate: invoiceDate ? `${invoiceDate}T12:00:00.000Z` : undefined
                      }
                      const updateData = {
                        customerId: saleData.customerId,
                        items: saleData.items,
                        discount: saleData.discount,
                        roundOff: saleData.roundOff ?? 0,
                        payments: saleData.payments || [],
                        notes: saleData.notes || null,
                        isZeroInvoice: !!saleData.isZeroInvoice,
                        ...(branchIdNum != null && { branchId: branchIdNum }),
                        ...(routeIdNum != null && { routeId: routeIdNum }),
                        editReason: editReason.trim(),
                        ...(editingSale?.rowVersion && { rowVersion: editingSale.rowVersion }),
                        ...(saleData.invoiceDate && { invoiceDate: saleData.invoiceDate })
                      }
                      const response = await salesAPI.updateSale(editingSaleId, updateData)
                      if (response.success) {
                        const invoiceNo = response.data?.invoiceNo
                        const saleId = response.data?.id
                        toast.success(`Invoice ${invoiceNo || editingSaleId} updated successfully!`, { id: 'invoice-update', duration: 4000 })
                        window.dispatchEvent(new CustomEvent('dataUpdated'))
                        await Promise.all([
                          loadProducts(),
                          loadCustomers(),
                        ])
                        setIsEditMode(false)
                        setEditingSaleId(null)
                        setEditingSale(null)
                        setEditReason('')
                        setCustomerChangedDuringEdit(false) // Reset customer change tracking
                        setSearchParams({})
                        if (saleId) {
                          setLastCreatedInvoice({
                            id: saleId,
                            invoiceNo: invoiceNo,
                            data: response.data
                          })
                          setShowInvoiceOptionsModal(true)
                        } else {
                          handleNewInvoice()
                        }
                      } else {
                        const errorMsg = response.message || response.errors?.[0] || 'Failed to update invoice'
                        toast.error(errorMsg)
                      }
                    } catch (error) {
                      console.error('Error updating invoice:', error)
                      const errorMsg = error?.response?.data?.message ||
                        error?.response?.data?.errors?.[0] ||
                        error?.message ||
                        'Failed to update invoice. Please try again.'
                      if (!error?._handledByInterceptor) toast.error(errorMsg)
                    } finally {
                      setLoading(false)
                    }
                  }}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Continue
                </button>
                <button
                  onClick={() => {
                    setShowEditReasonModal(false)
                    setEditReason('')
                    setLoading(false)
                  }}
                  className="flex-1 px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CRITICAL: Edit Confirmation Modal for PAID/PARTIAL Invoices */}
      {showEditConfirmModal && editingSale && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-orange-50">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center">
                  <AlertTriangle className="h-6 w-6 text-orange-600 mr-2" />
                  Confirm Invoice Edit
                </h2>
                <p className="text-sm text-gray-600 mt-1">Invoice: {editingSale?.invoiceNo || editingSaleId}</p>
              </div>
              <button
                onClick={() => {
                  setShowEditConfirmModal(false)
                  setPendingSaveData(null)
                }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close edit confirmation modal"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-yellow-800 font-medium mb-2">Warning: This invoice has payments</p>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>• Status: <span className="font-bold">{editingSale?.paymentStatus?.toUpperCase() || 'Unknown'}</span></li>
                  <li>• Total: <span className="font-bold">{formatCurrency(editingSale?.grandTotal || 0)}</span></li>
                  <li>• Paid: <span className="font-bold">{formatCurrency(editingSale?.paidAmount || 0)}</span></li>
                  {editingSale?.paidAmount < editingSale?.grandTotal && (
                    <li>• Outstanding: <span className="font-bold text-red-600">{formatCurrency((editingSale?.grandTotal || 0) - (editingSale?.paidAmount || 0))}</span></li>
                  )}
                </ul>
              </div>

              <p className="text-gray-700 mb-4">
                Editing this invoice may affect payment records and customer balances. Are you sure you want to continue?
              </p>

              {selectedCustomer && customerChangedDuringEdit && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-blue-800 text-sm">
                    <strong>Customer Change:</strong> {editingSale?.customerName || 'Original Customer'} → {selectedCustomer?.name || 'Cash Customer'}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setShowEditConfirmModal(false)
                    setLoading(true)
                    try {
                      const saleData = pendingSaveData
                      // Must match main handleSave updateData: omitting isZeroInvoice/roundOff/branch/route broke updates (wrong totals / validation).
                      const updateData = {
                        customerId: saleData.customerId,
                        items: saleData.items,
                        discount: saleData.discount,
                        roundOff: saleData.roundOff ?? 0,
                        payments: saleData.payments || [],
                        notes: saleData.notes || null,
                        isZeroInvoice: !!saleData.isZeroInvoice,
                        ...(saleData.branchId != null && { branchId: saleData.branchId }),
                        ...(saleData.routeId != null && { routeId: saleData.routeId }),
                        ...(saleData.editReason && { editReason: saleData.editReason }),
                        ...(editingSale?.rowVersion && { rowVersion: editingSale.rowVersion }),
                        ...(saleData.invoiceDate && { invoiceDate: saleData.invoiceDate })
                      }
                      const response = await salesAPI.updateSale(editingSaleId, updateData)
                      if (response.success) {
                        const invoiceNo = response.data?.invoiceNo
                        const saleId = response.data?.id
                        toast.success(`Invoice ${invoiceNo || editingSaleId} updated successfully!`, { id: 'invoice-update', duration: 4000 })
                        window.dispatchEvent(new CustomEvent('dataUpdated'))
                        await Promise.all([
                          loadProducts(),
                          loadCustomers(),
                        ])
                        setIsEditMode(false)
                        setEditingSaleId(null)
                        setEditingSale(null)
                        setEditReason('')
                        setCustomerChangedDuringEdit(false)
                        setSearchParams({})
                        setPendingSaveData(null)
                        if (saleId) {
                          setLastCreatedInvoice({
                            id: saleId,
                            invoiceNo: invoiceNo,
                            data: response.data
                          })
                          setShowInvoiceOptionsModal(true)
                        } else {
                          handleNewInvoice()
                        }
                      } else {
                        const errorMsg = response.message || response.errors?.[0] || 'Failed to update invoice'
                        toast.error(errorMsg)
                      }
                    } catch (error) {
                      console.error('Error updating invoice:', error)
                      const errorMsg = error?.response?.data?.message ||
                        error?.response?.data?.errors?.[0] ||
                        error?.message ||
                        'Failed to update invoice. Please try again.'
                      if (error?.response?.status === 409 && editingSaleId) {
                        toast.error(`Conflict: ${errorMsg}`, { duration: 8000 })
                        loadSaleForEdit(editingSaleId).catch(() => {})
                      } else if (!error?._handledByInterceptor) {
                        toast.error(errorMsg)
                      }
                    } finally {
                      setLoading(false)
                    }
                  }}
                  className="flex-1 px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
                >
                  Yes, Update Invoice
                </button>
                <button
                  onClick={() => {
                    setShowEditConfirmModal(false)
                    setPendingSaveData(null)
                  }}
                  className="flex-1 px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print format selector (A4, A5, 80mm, 58mm) - shown when user clicks Print from success modal (success modal is closed first so this is visible) */}
      {showPrintFormatModal && lastCreatedInvoice && (
        <PrintOptionsModal
          saleId={lastCreatedInvoice.id}
          invoiceNo={lastCreatedInvoice.invoiceNo}
          onClose={() => setShowPrintFormatModal(false)}
          onPrint={() => setShowPrintFormatModal(false)}
        />
      )}

      {/* Invoice Options Modal */}
      {showInvoiceOptionsModal && lastCreatedInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-green-50">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center">
                  <CheckCircle className="h-6 w-6 text-green-600 mr-2" />
                  Invoice Generated Successfully!
                </h2>
                <p className="text-sm text-gray-600 mt-1">Invoice: {lastCreatedInvoice.invoiceNo}</p>
              </div>
              <button
                onClick={handleCloseInvoiceOptions}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close invoice options"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Payment status: Paid / Partial / Pending (invoice payment status, not "saving") */}
              {lastCreatedInvoice.data?.paymentStatus && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm text-gray-600">Status:</span>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      (lastCreatedInvoice.data.paymentStatus || '').toLowerCase() === 'paid'
                        ? 'bg-green-100 text-green-800'
                        : (lastCreatedInvoice.data.paymentStatus || '').toLowerCase() === 'partial'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {lastCreatedInvoice.data.paymentStatus}
                  </span>
                </div>
              )}
              <p className="text-gray-700 mb-4">What would you like to do with this invoice?</p>

              {/* Action Buttons - 4 direct format buttons for one-click print */}
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {['A4', 'A5', '80mm', '58mm'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => handlePrintFormat(fmt)}
                      className="inline-flex items-center gap-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors shadow-sm"
                      title={`Print ${fmt}`}
                    >
                      <Printer className="h-4 w-4" />
                      {fmt}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handleDownloadPdf(lastCreatedInvoice.id, lastCreatedInvoice.invoiceNo)}
                  className="w-full flex items-center justify-center px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors shadow-md"
                >
                  <Download className="h-5 w-5 mr-2" />
                  Download PDF
                </button>

                <button
                  onClick={handleWhatsAppShare}
                  className="w-full flex items-center justify-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-md"
                >
                  <MessageCircle className="h-5 w-5 mr-2" />
                  Share via WhatsApp
                </button>

                <button
                  onClick={handleEmailShare}
                  className="w-full flex items-center justify-center px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shadow-md"
                >
                  <Mail className="h-5 w-5 mr-2" />
                  Send via Email
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end p-6 border-t border-gray-200 bg-gray-50">
              <button
                onClick={handleCloseInvoiceOptions}
                className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDangerModal
        isOpen={dangerModal.isOpen}
        title={dangerModal.title}
        message={dangerModal.message}
        confirmLabel={dangerModal.confirmLabel}
        showInput={dangerModal.showInput}
        inputPlaceholder={dangerModal.inputPlaceholder}
        defaultValue={dangerModal.defaultValue}
        onConfirm={dangerModal.onConfirm}
        onClose={() => setDangerModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}

export default PosPage

