import { useState, useEffect, useRef } from 'react'
import { Plus, Edit, Trash2, Eye, Save, Search, X, Filter, Calendar, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react'
import { purchasesAPI, productsAPI, settingsAPI } from '../../services'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'

const PurchasesPage = () => {
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState(null)

  // Filter states - CRITICAL FIX: Default to 'all' to show all purchases without filtering
  const [filterPeriod, setFilterPeriod] = useState('all') // Show all purchases by default
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [showAnalyticsMobile, setShowAnalyticsMobile] = useState(false) // Mobile: collapse long stats by default

  // Analytics state
  const [analytics, setAnalytics] = useState(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)

  const [formData, setFormData] = useState({
    supplierName: '',
    invoiceNo: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    expenseCategory: 'Inventory', // Default category
    paymentType: 'Credit', // Cash, Credit, Partial
    amountPaid: '',
    items: []
  })
  const [products, setProducts] = useState([])
  const [productSearchTerm, setProductSearchTerm] = useState('')
  const [showProductSearch, setShowProductSearch] = useState(false)
  const searchInputRef = useRef(null)
  const formRef = useRef(null) // CRITICAL: Ref for scrolling to form
  const [vatPercent, setVatPercent] = useState(5) // From company settings; fallback when settings unavailable (TODO #5)
  const [dangerModal, setDangerModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    onConfirm: () => { }
  })

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB')
  }

  useEffect(() => {
    loadPurchases()
    loadProducts()
    loadAnalytics()
    // CRITICAL FIX: Reload when filters change to show filtered data automatically
  }, [currentPage, filterPeriod, startDate, endDate, supplierSearch, categoryFilter])

  useEffect(() => {
    if (showProductSearch && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [showProductSearch])

  // Fetch VAT from company settings (no hardcoded 5% — TODO #5)
  useEffect(() => {
    const fetchVat = async () => {
      try {
        const res = await settingsAPI.getCompanySettings()
        if (res?.success && res?.data?.vatPercent != null) {
          const v = parseFloat(res.data.vatPercent)
          if (!Number.isNaN(v) && v >= 0) setVatPercent(v)
        }
      } catch (_) { /* keep default */ }
    }
    fetchVat()
  }, [])

  const loadPurchases = async () => {
    try {
      setLoading(true)
      const params = { page: currentPage, pageSize: 10 }

      // Apply date filters based on period
      const dateRange = getDateRangeFromPeriod(filterPeriod)
      if (dateRange.startDate) params.startDate = dateRange.startDate
      if (dateRange.endDate) params.endDate = dateRange.endDate

      // Custom date range
      if (filterPeriod === 'custom') {
        if (startDate) params.startDate = startDate
        if (endDate) params.endDate = endDate
      }

      // Apply supplier filter
      if (supplierSearch) params.supplierName = supplierSearch

      // Apply category filter
      if (categoryFilter) params.category = categoryFilter

      const response = await purchasesAPI.getPurchases(params)
      if (response.success) {
        setPurchases(response.data.items)
        setTotalPages(response.data.totalPages)
      }
    } catch (error) {
      toast.error('Failed to load purchases')
    } finally {
      setLoading(false)
    }
  }

  const loadAnalytics = async () => {
    try {
      setLoadingAnalytics(true)
      const params = {}

      // Apply date filters for analytics
      const dateRange = getDateRangeFromPeriod(filterPeriod)
      if (dateRange.startDate) params.startDate = dateRange.startDate
      if (dateRange.endDate) params.endDate = dateRange.endDate

      if (filterPeriod === 'custom') {
        if (startDate) params.startDate = startDate
        if (endDate) params.endDate = endDate
      }

      const response = await purchasesAPI.getPurchaseAnalytics(params)
      if (response.success) {
        // Validate and sanitize analytics data to prevent calculation errors
        const sanitizedAnalytics = {
          totalAmount: Number(response.data.totalAmount) || 0,
          totalCount: Number(response.data.totalCount) || 0,
          totalItems: Number(response.data.totalItems) || 0,
          todayTotal: Number(response.data.todayTotal) || 0,
          todayCount: Number(response.data.todayCount) || 0,
          yesterdayTotal: Number(response.data.yesterdayTotal) || 0,
          yesterdayCount: Number(response.data.yesterdayCount) || 0,
          thisWeekTotal: Number(response.data.thisWeekTotal) || 0,
          thisWeekCount: Number(response.data.thisWeekCount) || 0,
          lastWeekTotal: Number(response.data.lastWeekTotal) || 0,
          lastWeekCount: Number(response.data.lastWeekCount) || 0,
          topSupplierToday: response.data.topSupplierToday || null,
          topSupplierTodayAmount: Number(response.data.topSupplierTodayAmount) || 0,
          topSupplierWeek: response.data.topSupplierWeek || null,
          topSupplierWeekAmount: Number(response.data.topSupplierWeekAmount) || 0,
          dailyStats: (response.data.dailyStats || []).map(stat => ({
            date: stat.date,
            totalAmount: Number(stat.totalAmount) || 0,
            count: Number(stat.count) || 0,
            itemCount: Number(stat.itemCount) || 0
          })),
          supplierStats: (response.data.supplierStats || []).map(stat => ({
            supplierName: stat.supplierName || 'Unknown',
            totalAmount: Number(stat.totalAmount) || 0,
            count: Number(stat.count) || 0,
            itemCount: Number(stat.itemCount) || 0
          }))
        }
        setAnalytics(sanitizedAnalytics)
      }
    } catch (error) {
      console.error('Failed to load analytics:', error)
      // Set empty analytics to prevent UI errors
      setAnalytics({
        totalAmount: 0,
        totalCount: 0,
        totalItems: 0,
        todayTotal: 0,
        todayCount: 0,
        yesterdayTotal: 0,
        yesterdayCount: 0,
        thisWeekTotal: 0,
        thisWeekCount: 0,
        lastWeekTotal: 0,
        lastWeekCount: 0,
        topSupplierToday: null,
        topSupplierTodayAmount: 0,
        topSupplierWeek: null,
        topSupplierWeekAmount: 0,
        dailyStats: [],
        supplierStats: []
      })
    } finally {
      setLoadingAnalytics(false)
    }
  }

  const getDateRangeFromPeriod = (period) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    switch (period) {
      case 'today':
        return { startDate: today.toISOString().split('T')[0], endDate: today.toISOString().split('T')[0] }

      case 'yesterday': {
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        return { startDate: yesterday.toISOString().split('T')[0], endDate: yesterday.toISOString().split('T')[0] }
      }

      case 'week': {
        const startOfWeek = new Date(today)
        startOfWeek.setDate(today.getDate() - today.getDay())
        return { startDate: startOfWeek.toISOString().split('T')[0], endDate: today.toISOString().split('T')[0] }
      }

      case 'lastWeek': {
        const startOfLastWeek = new Date(today)
        startOfLastWeek.setDate(today.getDate() - today.getDay() - 7)
        const endOfLastWeek = new Date(startOfLastWeek)
        endOfLastWeek.setDate(startOfLastWeek.getDate() + 6)
        return { startDate: startOfLastWeek.toISOString().split('T')[0], endDate: endOfLastWeek.toISOString().split('T')[0] }
      }

      case 'month': {
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
        return { startDate: startOfMonth.toISOString().split('T')[0], endDate: today.toISOString().split('T')[0] }
      }

      default:
        return {}
    }
  }

  const loadProducts = async () => {
    try {
      const response = await productsAPI.getProducts({ pageSize: 100 })
      if (response.success) {
        setProducts(response.data.items || [])
      }
    } catch (error) {
      console.error('Failed to load products')
    }
  }

  const searchProducts = async (query) => {
    if (!query || query.length < 2) {
      loadProducts()
      return
    }
    try {
      const response = await productsAPI.searchProducts(query, 20)
      if (response.success) {
        setProducts(response.data || [])
      }
    } catch (error) {
      console.error('Failed to search products')
    }
  }

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (productSearchTerm) {
        searchProducts(productSearchTerm)
      }
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [productSearchTerm])

  const addItem = (product) => {
    // CRITICAL FIX: Use sellPrice for purchase cost if costPrice is not available
    // This ensures price auto-fills correctly when product is selected
    const unitCost = product.costPrice || product.sellPrice || 0

    const newItem = {
      productId: product.id,
      productName: product.nameEn,
      sku: product.sku,
      unitType: product.unitType,
      qty: 1,
      unitCost: unitCost,
      stockQty: product.stockQty ?? 0
    }
    setFormData({
      ...formData,
      items: [...formData.items, newItem]
    })
    setShowProductSearch(false)
    setProductSearchTerm('')
  }

  const updateItem = (index, field, value) => {
    const newItems = [...formData.items]

    // Handle empty string for number fields
    const numValue = value === '' ? '' : (field === 'qty' || field === 'unitCost' ? Number(value) : value)
    newItems[index] = { ...newItems[index], [field]: numValue }

    setFormData({ ...formData, items: newItems })
  }

  const removeItem = (index) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index)
    })
  }

  const calculateTotal = () => {
    return formData.items.reduce((sum, item) => {
      const qty = typeof item.qty === 'number' ? item.qty : 0
      const unitCost = typeof item.unitCost === 'number' ? item.unitCost : 0
      return sum + (qty * unitCost)
    }, 0)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (formData.items.length === 0) {
      toast.error('Please add at least one item')
      return
    }

    // Validate all items have valid quantities and unit costs
    const invalidItems = formData.items.filter(item => {
      const qty = typeof item.qty === 'number' ? item.qty : parseFloat(item.qty)
      const unitCost = typeof item.unitCost === 'number' ? item.unitCost : parseFloat(item.unitCost)
      return isNaN(qty) || qty <= 0 || isNaN(unitCost) || unitCost < 0
    })

    if (invalidItems.length > 0) {
      toast.error('All items must have valid quantity (> 0) and unit cost (>= 0)')
      return
    }

    const totalAmount = calculateTotal() * (1 + vatPercent / 100)
    if (formData.paymentType === 'Partial') {
      const paid = parseFloat(formData.amountPaid)
      if (isNaN(paid) || paid <= 0) {
        toast.error('Please enter amount paid (greater than 0) for partial payment.')
        return
      }
      if (paid > totalAmount) {
        toast.error(`Amount paid (AED ${paid.toFixed(2)}) cannot exceed total amount (AED ${totalAmount.toFixed(2)}).`)
        return
      }
    }

    try {
      const purchaseDate = formData.purchaseDate || new Date().toISOString().split('T')[0]
      const amountPaidNum = formData.paymentType === 'Partial' && formData.amountPaid !== '' && formData.amountPaid != null
        ? parseFloat(formData.amountPaid) : (formData.paymentType === 'Cash' ? totalAmount : 0)
      const purchaseData = {
        supplierName: (formData.supplierName || '').trim(),
        invoiceNo: (formData.invoiceNo || '').trim(),
        purchaseDate,
        expenseCategory: formData.expenseCategory || 'Inventory',
        paymentType: formData.paymentType || 'Credit',
        amountPaid: amountPaidNum > 0 ? amountPaidNum : null,
        items: formData.items.map(item => ({
          productId: Number(item.productId),
          unitType: (item.unitType || 'PCS').trim().toUpperCase(),
          qty: typeof item.qty === 'number' ? item.qty : parseFloat(item.qty) || 0,
          unitCost: typeof item.unitCost === 'number' ? item.unitCost : parseFloat(item.unitCost) || 0
        }))
      }

      let response
      if (editingPurchase) {
        response = await purchasesAPI.updatePurchase(editingPurchase.id, purchaseData)
        if (response.success) {
          toast.success('Purchase updated successfully!', { id: 'purchase-update', duration: 4000 })
        } else {
          toast.error(response.message || 'Failed to update purchase')
        }
      } else {
        response = await purchasesAPI.createPurchase(purchaseData)
        if (response.success) {
          toast.success('Purchase created successfully!', { id: 'purchase-create', duration: 4000 })
        } else {
          toast.error(response.message || 'Failed to create purchase', { id: 'purchase-create' })
        }
      }

      if (response.success) {
        setShowForm(false)
        setEditingPurchase(null)
        setFormData({
          supplierName: '',
          invoiceNo: '',
          purchaseDate: new Date().toISOString().split('T')[0],
          expenseCategory: 'Inventory',
          paymentType: 'Credit',
          amountPaid: '',
          items: []
        })
        loadPurchases()
        loadProducts() // Refresh products to show updated stock
      }
    } catch (error) {
      console.error('Purchase submit error:', error)
      const data = error?.response?.data
      const errors = data?.errors
      const message = data?.message || error?.message || 'Failed to save purchase'
      const errorMsg = (Array.isArray(errors) && errors.length && errors[0]) || message
      // Clear messages for common cases: duplicate invoice, stock, tenant
      if (typeof errorMsg === 'string' && (errorMsg.includes('already exists') || errorMsg.includes('duplicate') || errorMsg.includes('Invoice')))
        toast.error(`Duplicate invoice: ${errorMsg}`, { duration: 6000 })
      else if (typeof errorMsg === 'string' && (errorMsg.includes('stock') || errorMsg.includes('Stock')))
        toast.error(`Stock error: ${errorMsg}`, { duration: 6000 })
      else
        toast.error(editingPurchase ? `Update failed: ${errorMsg}` : `Create failed: ${errorMsg}`, { duration: 6000 })
    }
  }

  const handleNewPurchase = () => {
    setEditingPurchase(null)
    setFormData({
      supplierName: '',
      invoiceNo: '',
      purchaseDate: new Date().toISOString().split('T')[0],
      expenseCategory: 'Inventory', // Reset to default
      items: []
    })
    setShowForm(true)

    // CRITICAL FIX: Scroll to form after it opens
    setTimeout(() => {
      if (formRef.current) {
        formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 100) // Small delay to ensure form is rendered
  }

  const handleEditPurchase = (purchase) => {
    setEditingPurchase(purchase)
    setFormData({
      supplierName: purchase.supplierName || '',
      invoiceNo: purchase.invoiceNo || '',
      purchaseDate: purchase.purchaseDate ? new Date(purchase.purchaseDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      expenseCategory: purchase.expenseCategory || 'Inventory',
      paymentType: purchase.paymentType || 'Credit',
      amountPaid: purchase.amountPaid != null && purchase.amountPaid !== '' ? String(purchase.amountPaid) : '',
      items: purchase.items?.map(item => ({
        productId: item.productId,
        productName: item.productName || item.product?.nameEn || '',
        sku: item.product?.sku || item.sku || '',
        unitType: item.unitType || 'CRTN',
        qty: item.qty || 0,
        unitCost: item.unitCost || 0,
        stockQty: item.product?.stockQty ?? item.stockQty ?? null
      })) || []
    })
    setShowForm(true)
  }

  const handleDeletePurchase = (purchase) => {
    const confirmMessage = `Invoice: ${purchase.invoiceNo}\n` +
      `Supplier: ${purchase.supplierName}\n` +
      `Amount: AED ${purchase.totalAmount.toFixed(2)}\n` +
      `Items: ${purchase.items?.length || 0}\n\n` +
      `This will reverse all stock changes and remove inventory transactions.`

    setDangerModal({
      isOpen: true,
      title: 'Delete Purchase?',
      message: confirmMessage,
      confirmLabel: 'Delete Purchase',
      onConfirm: async () => {
        try {
          const response = await purchasesAPI.deletePurchase(purchase.id)
          if (response.success) {
            toast.success(`Purchase deleted! Stock reversed for ${response.data.itemsCount} items.`, { id: 'purchase-delete', duration: 4000 })
            loadPurchases()
            loadProducts()
          } else {
            toast.error(response.message || 'Failed to delete purchase', { id: 'purchase-delete' })
          }
        } catch (error) {
          console.error('Delete purchase error:', error)
          const errorMsg = error?.response?.data?.message || error?.message || 'Failed to delete purchase'
          toast.error(`Delete failed: ${errorMsg}`)
        }
      }
    })
  }

  // TALLY ERP PURCHASE VOUCHER STYLE
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-50 pb-20 overflow-x-hidden max-w-full">
      {/* Top Bar - Mobile Responsive - FIXED POSITION */}
      <div className="bg-primary-100 border-b-2 border-primary-200 px-2 sm:px-4 py-2 sticky top-0 z-20 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-primary-800">Purchase Voucher</h1>
            <div className="text-xs text-primary-600">Date: {new Date().toLocaleDateString('en-GB')}</div>
          </div>
          <button
            onClick={handleNewPurchase}
            className="px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 bg-primary-600 text-white rounded font-medium hover:bg-primary-700 flex items-center justify-center text-xs sm:text-sm w-full sm:w-auto min-h-[44px]"
          >
            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
            <span className="hidden sm:inline">New Purchase</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      <div className="p-2 sm:p-4 overflow-x-hidden max-w-full">
        {/* Analytics Dashboard - Mobile: compact 2 cards + "More stats" toggle; Desktop: full */}
        {analytics && (
          <>
            <div className="mb-4 grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              {/* Today's Total */}
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 rounded-lg border-2 border-primary-300 p-2 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs sm:text-sm font-bold text-primary-800">Today's Purchases</h3>
                  <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                </div>
                <div className="text-xl sm:text-2xl font-bold text-blue-700">AED {analytics.todayTotal?.toFixed(2) || '0.00'}</div>
                <div className="text-xs text-blue-600 mt-1">{analytics.todayCount || 0} purchase(s)</div>
                {analytics.yesterdayTotal > 0 && (
                  <div className="flex items-center mt-2 text-xs">
                    {analytics.todayTotal > analytics.yesterdayTotal ? (
                      <>
                        <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
                        <span className="text-green-600 font-medium">
                          +{((analytics.todayTotal - analytics.yesterdayTotal) / analytics.yesterdayTotal * 100).toFixed(1)}% vs yesterday
                        </span>
                      </>
                    ) : analytics.todayTotal < analytics.yesterdayTotal ? (
                      <>
                        <TrendingDown className="h-3 w-3 text-red-600 mr-1" />
                        <span className="text-red-600 font-medium">
                          {((analytics.todayTotal - analytics.yesterdayTotal) / analytics.yesterdayTotal * 100).toFixed(1)}% vs yesterday
                        </span>
                      </>
                    ) : (
                      <span className="text-primary-600">Same as yesterday</span>
                    )}
                  </div>
                )}
              </div>

              {/* This Week's Total */}
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg border-2 border-primary-300 p-2 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs sm:text-sm font-bold text-green-900">This Week</h3>
                  <BarChart3 className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
                </div>
                <div className="text-xl sm:text-2xl font-bold text-green-700">AED {analytics.thisWeekTotal?.toFixed(2) || '0.00'}</div>
                <div className="text-xs text-green-600 mt-1">{analytics.thisWeekCount || 0} purchase(s)</div>
                {analytics.lastWeekTotal > 0 && (
                  <div className="flex items-center mt-2 text-xs">
                    {analytics.thisWeekTotal > analytics.lastWeekTotal ? (
                      <>
                        <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
                        <span className="text-green-600 font-medium">
                          +{((analytics.thisWeekTotal - analytics.lastWeekTotal) / analytics.lastWeekTotal * 100).toFixed(1)}% vs last week
                        </span>
                      </>
                    ) : analytics.thisWeekTotal < analytics.lastWeekTotal ? (
                      <>
                        <TrendingDown className="h-3 w-3 text-red-600 mr-1" />
                        <span className="text-red-600 font-medium">
                          {((analytics.thisWeekTotal - analytics.lastWeekTotal) / analytics.lastWeekTotal * 100).toFixed(1)}% vs last week
                        </span>
                      </>
                    ) : (
                      <span className="text-primary-600">Same as last week</span>
                    )}
                  </div>
                )}
              </div>

              {/* Top Supplier Today - hidden on mobile when analytics collapsed */}
              <div className="hidden sm:block bg-gradient-to-br from-primary-50 to-primary-100 rounded-lg border-2 border-primary-300 p-2 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs sm:text-sm font-bold text-orange-900">Top Supplier (Today)</h3>
                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-orange-600" />
                </div>
                {analytics.topSupplierToday ? (
                  <>
                    <div className="text-sm sm:text-base font-bold text-orange-700 truncate">{analytics.topSupplierToday}</div>
                    <div className="text-xs text-orange-600 mt-1">AED {analytics.topSupplierTodayAmount?.toFixed(2)}</div>
                  </>
                ) : (
                  <div className="text-sm text-primary-500">No purchases today</div>
                )}
              </div>

              {/* Top Supplier This Week - hidden on mobile when analytics collapsed */}
              <div className="hidden sm:block bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg border-2 border-primary-300 p-2 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs sm:text-sm font-bold text-purple-900">Top Supplier (Week)</h3>
                  <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
                </div>
                {analytics.topSupplierWeek ? (
                  <>
                    <div className="text-sm sm:text-base font-bold text-purple-700 truncate">{analytics.topSupplierWeek}</div>
                    <div className="text-xs text-purple-600 mt-1">AED {analytics.topSupplierWeekAmount?.toFixed(2)}</div>
                  </>
                ) : (
                  <div className="text-sm text-primary-500">No purchases this week</div>
                )}
              </div>
            </div>

            {/* Mobile: toggle for more stats to avoid long vertical scroll */}
            <div className="sm:hidden mb-3">
              <button
                type="button"
                onClick={() => setShowAnalyticsMobile(!showAnalyticsMobile)}
                className="w-full py-2 px-3 rounded-lg border-2 border-primary-200 bg-primary-50 text-primary-800 text-sm font-medium"
              >
                {showAnalyticsMobile ? 'Hide stats & charts' : 'View stats & charts'}
              </button>
            </div>

            {/* Charts and Graphs Section - hidden on mobile unless expanded */}
            <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 ${!showAnalyticsMobile ? 'hidden sm:grid' : ''}`}>
              {/* Daily Trend Chart - Last 7 Days */}
              <div className="bg-white rounded-lg border-2 border-blue-300 shadow-sm p-4">
                <h3 className="text-sm font-bold text-primary-800 mb-3 flex items-center">
                  <BarChart3 className="h-4 w-4 mr-2 text-blue-600" />
                  Daily Purchase Trend (Last 7 Days)
                </h3>
                {analytics.dailyStats && analytics.dailyStats.length > 0 ? (
                  <div className="space-y-2">
                    {analytics.dailyStats.slice(0, 7).map((day, index) => {
                      const maxAmount = Math.max(...analytics.dailyStats.slice(0, 7).map(d => d.totalAmount || 0))
                      const percentage = maxAmount > 0 ? (day.totalAmount / maxAmount) * 100 : 0
                      const isToday = new Date(day.date).toDateString() === new Date().toDateString()

                      return (
                        <div key={index} className="flex items-center gap-2">
                          <div className="text-xs font-medium text-primary-700 w-20">
                            {new Date(day.date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
                            {isToday && <span className="ml-1 text-blue-600 font-bold">(Today)</span>}
                          </div>
                          <div className="flex-1 bg-primary-50 rounded-full h-6 relative">
                            <div
                              className={`h-6 rounded-full flex items-center justify-end pr-2 transition-all ${isToday ? 'bg-gradient-to-r from-blue-500 to-blue-600' : 'bg-gradient-to-r from-lime-400 to-lime-500'
                                }`}
                              style={{ width: `${Math.max(percentage, 5)}%` }}
                            >
                              <span className="text-xs font-bold text-white">AED {day.totalAmount?.toFixed(0) || 0}</span>
                            </div>
                          </div>
                          <div className="text-xs text-primary-600 w-12 text-right">{day.count || 0}x</div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-primary-500 text-center py-8">No purchase data available</div>
                )}
              </div>

              {/* Top 5 Suppliers Chart */}
              <div className="bg-white rounded-lg border-2 border-primary-300 shadow-sm p-4">
                <h3 className="text-sm font-bold text-primary-800 mb-3 flex items-center">
                  <TrendingUp className="h-4 w-4 mr-2 text-green-600" />
                  Top 5 Suppliers (Total Spending)
                </h3>
                {analytics.supplierStats && analytics.supplierStats.length > 0 ? (
                  <div className="space-y-2">
                    {analytics.supplierStats.slice(0, 5).map((supplier, index) => {
                      const maxAmount = analytics.supplierStats[0]?.totalAmount || 1
                      const percentage = (supplier.totalAmount / maxAmount) * 100

                      return (
                        <div key={index} className="flex items-center gap-2">
                          <div className="text-lg font-bold text-primary-400 w-6">{index + 1}</div>
                          <div className="flex-1">
                            <div className="text-xs font-medium text-primary-800 truncate mb-1">{supplier.supplierName}</div>
                            <div className="bg-primary-50 rounded-full h-5 relative">
                              <div
                                className="h-5 rounded-full bg-gradient-to-r from-green-400 to-green-600 flex items-center justify-between px-2 transition-all"
                                style={{ width: `${Math.max(percentage, 10)}%` }}
                              >
                                <span className="text-xs font-bold text-white">AED {supplier.totalAmount?.toFixed(0) || 0}</span>
                              </div>
                            </div>
                            <div className="text-xs text-primary-500 mt-0.5">{supplier.count || 0} purchase(s), {supplier.itemCount || 0} item(s)</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-primary-500 text-center py-8">No supplier data available</div>
                )}
              </div>
            </div>

            {/* Detailed Supplier Insights - hidden on mobile unless expanded */}
            <div className={`bg-white rounded-lg border-2 border-primary-300 shadow-sm mb-4 ${!showAnalyticsMobile ? 'hidden sm:block' : ''}`}>
              <div className="bg-primary-100 border-b-2 border-primary-300 p-3">
                <h3 className="text-sm font-bold text-primary-800 flex items-center">
                  <BarChart3 className="h-4 w-4 mr-2 text-purple-600" />
                  Supplier Insights & Statistics
                </h3>
              </div>
              <div className="p-4">
                {analytics.supplierStats && analytics.supplierStats.length > 0 ? (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-purple-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-bold text-primary-700 border-r border-primary-200">Rank</th>
                            <th className="px-3 py-2 text-left font-bold text-primary-700 border-r border-primary-200">Supplier Name</th>
                            <th className="px-3 py-2 text-right font-bold text-primary-700 border-r border-primary-200">Total Spent</th>
                            <th className="px-3 py-2 text-center font-bold text-primary-700 border-r border-primary-200">Purchases</th>
                            <th className="px-3 py-2 text-center font-bold text-primary-700 border-r border-primary-200">Total Items</th>
                            <th className="px-3 py-2 text-right font-bold text-primary-700">Avg Per Purchase</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-100">
                          {analytics.supplierStats.map((supplier, index) => {
                            const avgPerPurchase = supplier.count > 0 ? supplier.totalAmount / supplier.count : 0
                            const isTopSupplier = index === 0

                            return (
                              <tr key={index} className={`hover:bg-purple-50 ${isTopSupplier ? 'bg-purple-50 font-semibold' : ''}`}>
                                <td className="px-3 py-2 border-r border-purple-100">
                                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${index === 0 ? 'bg-yellow-400 text-yellow-900' :
                                    index === 1 ? 'bg-primary-200 text-primary-800' :
                                      index === 2 ? 'bg-orange-300 text-orange-900' :
                                        'bg-primary-100 text-purple-700'
                                    } text-xs font-bold`}>
                                    {index + 1}
                                  </span>
                                </td>
                                <td className="px-3 py-2 border-r border-purple-100">
                                  <div className="font-medium text-primary-800">{supplier.supplierName}</div>
                                  {isTopSupplier && <span className="text-xs text-green-600 font-bold">🏆 Top Supplier</span>}
                                </td>
                                <td className="px-3 py-2 text-right border-r border-purple-100">
                                  <span className="font-bold text-green-700">AED {supplier.totalAmount?.toFixed(2) || '0.00'}</span>
                                </td>
                                <td className="px-3 py-2 text-center border-r border-purple-100">
                                  <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-medium">{supplier.count || 0}</span>
                                </td>
                                <td className="px-3 py-2 text-center border-r border-purple-100">
                                  <span className="text-primary-700">{supplier.itemCount || 0}</span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <span className="text-orange-600 font-medium">AED {avgPerPurchase.toFixed(2)}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot className="bg-primary-100 font-bold">
                          <tr>
                            <td colSpan="2" className="px-3 py-2 border-r border-primary-200">TOTAL</td>
                            <td className="px-3 py-2 text-right border-r border-primary-200">
                              <span className="text-green-700">AED {analytics.totalAmount?.toFixed(2) || '0.00'}</span>
                            </td>
                            <td className="px-3 py-2 text-center border-r border-primary-200">
                              <span className="text-blue-700">{analytics.totalCount || 0}</span>
                            </td>
                            <td className="px-3 py-2 text-center border-r border-primary-200">
                              <span className="text-primary-700">{analytics.totalItems || 0}</span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span className="text-orange-600">
                                AED {analytics.totalCount > 0 ? (analytics.totalAmount / analytics.totalCount).toFixed(2) : '0.00'}
                              </span>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-3">
                      {analytics.supplierStats.map((supplier, index) => {
                        const avgPerPurchase = supplier.count > 0 ? supplier.totalAmount / supplier.count : 0
                        const isTopSupplier = index === 0

                        return (
                          <div key={index} className="bg-white rounded-lg shadow-sm border border-primary-200 p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${index === 0 ? 'bg-yellow-400 text-yellow-900' :
                                  index === 1 ? 'bg-primary-200 text-primary-800' :
                                    index === 2 ? 'bg-orange-300 text-orange-900' :
                                      'bg-primary-100 text-purple-700'
                                  } text-xs font-bold`}>
                                  {index + 1}
                                </span>
                                <div>
                                  <p className="text-sm font-semibold text-primary-800">{supplier.supplierName}</p>
                                  {isTopSupplier && <span className="text-xs text-green-600 font-bold">🏆 Top Supplier</span>}
                                </div>
                              </div>
                              <p className="text-base font-bold text-green-700">{formatCurrency(supplier.totalAmount || 0)}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-purple-100">
                              <div>
                                <p className="text-xs text-primary-500">Purchases</p>
                                <p className="text-sm font-medium text-blue-700">{supplier.count || 0}</p>
                              </div>
                              <div>
                                <p className="text-xs text-primary-500">Total Items</p>
                                <p className="text-sm font-medium text-primary-700">{supplier.itemCount || 0}</p>
                              </div>
                              <div className="col-span-2">
                                <p className="text-xs text-primary-500">Avg Per Purchase</p>
                                <p className="text-sm font-medium text-orange-600">{formatCurrency(avgPerPurchase)}</p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {/* Mobile Total Card */}
                      <div className="bg-primary-100 rounded-lg border-2 border-primary-300 p-4 mt-4">
                        <p className="text-sm font-bold text-primary-800 mb-3">TOTAL</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-xs text-primary-600">Total Spent</p>
                            <p className="text-sm font-bold text-green-700">{formatCurrency(analytics.totalAmount || 0)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-primary-600">Total Purchases</p>
                            <p className="text-sm font-bold text-blue-700">{analytics.totalCount || 0}</p>
                          </div>
                          <div>
                            <p className="text-xs text-primary-600">Total Items</p>
                            <p className="text-sm font-bold text-primary-700">{analytics.totalItems || 0}</p>
                          </div>
                          <div>
                            <p className="text-xs text-primary-600">Avg Per Purchase</p>
                            <p className="text-sm font-bold text-orange-600">
                              {formatCurrency(analytics.totalCount > 0 ? (analytics.totalAmount / analytics.totalCount) : 0)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-primary-500 text-center py-8">No supplier data available</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Filters Section */}
        <div className="bg-white rounded-lg border-2 border-lime-300 shadow-sm mb-4 p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-primary-800 flex items-center">
                <Filter className="h-4 w-4 mr-2" />
                Filters & Search
              </h3>
              {/* CRITICAL FIX: Show active filter status */}
              {filterPeriod !== 'all' && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                  {filterPeriod === 'today' && 'Today'}
                  {filterPeriod === 'yesterday' && 'Yesterday'}
                  {filterPeriod === 'week' && 'This Week'}
                  {filterPeriod === 'lastWeek' && 'Last Week'}
                  {filterPeriod === 'month' && 'This Month'}
                  {filterPeriod === 'custom' && 'Custom Range'}
                </span>
              )}
              {loading && (
                <span className="flex items-center gap-1 text-blue-600 text-xs">
                  <div className="animate-spin h-3 w-3 border-2 border-primary-600 border-t-transparent rounded-full"></div>
                  Loading...
                </span>
              )}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="text-xs sm:text-sm px-2 sm:px-3 py-1 bg-lime-100 hover:bg-lime-200 border border-lime-300 rounded"
            >
              {showFilters ? 'Hide' : 'Show'} Filters
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              {/* Period Filter */}
              <div>
                <label className="block text-xs font-medium text-primary-700 mb-1">Period</label>
                <select
                  className="w-full px-2 py-1.5 text-xs border-2 border-lime-300 rounded"
                  value={filterPeriod}
                  onChange={(e) => setFilterPeriod(e.target.value)}
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This Week</option>
                  <option value="lastWeek">Last Week</option>
                  <option value="month">This Month</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>

              {/* Custom Date Range */}
              {filterPeriod === 'custom' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-primary-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      className="w-full px-2 py-1.5 text-xs border-2 border-lime-300 rounded"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-primary-700 mb-1">End Date</label>
                    <input
                      type="date"
                      className="w-full px-2 py-1.5 text-xs border-2 border-lime-300 rounded"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Supplier Search */}
              <div>
                <label className="block text-xs font-medium text-primary-700 mb-1">Supplier Name</label>
                <input
                  type="text"
                  placeholder="Search supplier..."
                  className="w-full px-2 py-1.5 text-xs border-2 border-lime-300 rounded"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                />
              </div>

              {/* Category Filter */}
              <div>
                <label className="block text-xs font-medium text-primary-700 mb-1">Category</label>
                <select
                  className="w-full px-2 py-1.5 text-xs border-2 border-lime-300 rounded"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">All Categories</option>
                  <option value="Inventory">Inventory</option>
                  <option value="Supplies">Supplies</option>
                  <option value="Equipment">Equipment</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Clear Filters */}
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setFilterPeriod('all')
                    setStartDate('')
                    setEndDate('')
                    setSupplierSearch('')
                    setCategoryFilter('')
                  }}
                  className="w-full px-2 py-1.5 text-xs bg-red-100 hover:bg-red-200 border border-red-300 rounded text-red-700 font-medium"
                >
                  Clear All Filters
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Purchase Form - Tally Style - mobile: single column, no horizontal scroll */}
        {showForm && (
          <div ref={formRef} className="bg-white rounded-lg border-2 border-lime-300 shadow-lg p-4 sm:p-6 mb-6 w-full max-w-full overflow-hidden">
            <div className="flex items-center justify-between mb-3 sm:mb-4 border-b-2 border-lime-400 pb-2">
              <h2 className="text-base sm:text-lg font-bold text-primary-800">
                {editingPurchase ? 'Edit Purchase Entry' : 'New Purchase Entry'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-primary-500 hover:text-primary-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4 mb-4 sm:mb-6">
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-1">Supplier Name *</label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 border-2 border-lime-300 rounded text-sm"
                    value={formData.supplierName}
                    onChange={(e) => setFormData({ ...formData, supplierName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-1">Invoice No *</label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 border-2 border-lime-300 rounded text-sm"
                    value={formData.invoiceNo}
                    onChange={(e) => setFormData({ ...formData, invoiceNo: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-1">Purchase Date *</label>
                  <input
                    type="date"
                    required
                    className="w-full px-3 py-2 border-2 border-lime-300 rounded text-sm"
                    value={formData.purchaseDate}
                    onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-1">Expense Category *</label>
                  <select
                    required
                    className="w-full px-3 py-2 border-2 border-lime-300 rounded text-sm"
                    value={formData.expenseCategory}
                    onChange={(e) => setFormData({ ...formData, expenseCategory: e.target.value })}
                  >
                    <option value="Inventory">Inventory (Stock Items)</option>
                    <option value="Supplies">Supplies (Office/Packaging)</option>
                    <option value="Equipment">Equipment (Machinery/Tools)</option>
                    <option value="Maintenance">Maintenance & Repairs</option>
                    <option value="Other">Other Expenses</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4 mb-4 sm:mb-6">
                <div>
                  <label className="block text-sm font-medium text-primary-700 mb-1">Payment Type</label>
                  <select
                    className="w-full px-3 py-2 border-2 border-lime-300 rounded text-sm"
                    value={formData.paymentType || 'Credit'}
                    onChange={(e) => setFormData({ ...formData, paymentType: e.target.value })}
                  >
                    <option value="Cash">Cash (full payment)</option>
                    <option value="Credit">Credit (pay later)</option>
                    <option value="Partial">Partial (part paid now)</option>
                  </select>
                </div>
                {formData.paymentType === 'Partial' && (
                  <div>
                    <label className="block text-sm font-medium text-primary-700 mb-1">Amount Paid (AED) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-full px-3 py-2 border-2 border-lime-300 rounded text-sm"
                      value={formData.amountPaid ?? ''}
                      onChange={(e) => setFormData({ ...formData, amountPaid: e.target.value })}
                      placeholder="Enter amount paid now"
                    />
                  </div>
                )}
              </div>

              {/* Product Search */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-primary-700 mb-1">Add Product (F3)</label>
                <div className="relative">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search products..."
                    className="w-full px-3 py-2 border-2 border-lime-300 rounded text-sm"
                    value={productSearchTerm}
                    onChange={(e) => {
                      setProductSearchTerm(e.target.value)
                      setShowProductSearch(true)
                    }}
                    onFocus={() => setShowProductSearch(true)}
                  />
                  <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-primary-400" />
                </div>

                {showProductSearch && products.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-w-md bg-white border-2 border-lime-300 rounded shadow-lg max-h-64 overflow-y-auto">
                    {products.map((product) => (
                      <div
                        key={product.id}
                        className="p-2 border-b border-lime-200 hover:bg-lime-50 cursor-pointer"
                        onClick={() => addItem(product)}
                      >
                        <div className="flex justify-between">
                          <div>
                            <p className="font-medium text-sm">{product.nameEn}</p>
                            <p className="text-xs text-primary-500">SKU: {product.sku}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">AED {product.costPrice?.toFixed(2) || '0.00'}</p>
                            <p className="text-xs text-primary-500">Stock: {product.stockQty}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Items - Mobile: vertical cards (no horizontal scroll); Desktop: table */}
              <div className="mb-6 w-full max-w-full">
                <div className="bg-lime-100 p-2 border-b-2 border-lime-400">
                  <h3 className="text-sm font-bold text-primary-800">Items</h3>
                </div>

                {/* Mobile: compact cards per item */}
                <div className="md:hidden space-y-2 max-h-[320px] overflow-y-auto border-2 border-lime-300 border-t-0 rounded-b-lg p-2" style={{ WebkitOverflowScrolling: 'touch' }}>
                  {formData.items.length === 0 ? (
                    <p className="text-center text-primary-500 text-sm py-4">No items. Search and add products above.</p>
                  ) : (
                    formData.items.map((item, index) => {
                      const qty = typeof item.qty === 'number' ? item.qty : parseFloat(item.qty) || 0
                      const cost = typeof item.unitCost === 'number' ? item.unitCost : parseFloat(item.unitCost) || 0
                      const subtotal = qty * cost
                      const vat = subtotal * (vatPercent / 100)
                      const total = subtotal + vat
                      return (
                        <div key={index} className="bg-lime-50 rounded-lg border border-lime-300 p-3">
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-primary-800 text-sm truncate">{item.productName}</p>
                              <p className="text-xs text-primary-500">{item.sku}</p>
                              <p className="text-xs text-primary-600">Stock: {item.stockQty != null && item.stockQty !== '' ? Number(item.stockQty) : '—'}</p>
                            </div>
                            <button type="button" onClick={() => removeItem(index)} className="shrink-0 text-red-600 p-1" aria-label="Remove">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <label className="text-xs text-primary-500">Qty</label>
                              <input type="number" min="0" step="0.01" className="w-full px-2 py-1 border border-lime-300 rounded text-sm" value={item.qty === '' ? '' : item.qty} onChange={(e) => updateItem(index, 'qty', e.target.value)} />
                            </div>
                            <div>
                              <label className="text-xs text-primary-500">Unit</label>
                              <select className="w-full px-2 py-1 border border-lime-300 rounded text-xs uppercase" value={item.unitType || 'PCS'} onChange={(e) => updateItem(index, 'unitType', e.target.value)}>
                                <option value="PCS">PCS</option>
                                <option value="CRTN">CRTN</option>
                                <option value="KG">KG</option>
                                <option value="BOX">BOX</option>
                                <option value="PKG">PKG</option>
                                <option value="BAG">BAG</option>
                                <option value="LTR">LTR</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-primary-500">Unit cost (AED)</label>
                              <input type="number" min="0" step="0.01" className="w-full px-2 py-1 border border-lime-300 rounded text-sm" value={item.unitCost === '' ? '' : item.unitCost} onChange={(e) => updateItem(index, 'unitCost', e.target.value)} />
                            </div>
                            <div className="flex flex-col justify-end">
                              <span className="text-xs text-primary-500">Total</span>
                              <span className="text-sm font-bold text-green-700">AED {total.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                  {formData.items.length > 0 && (
                    <div className="pt-2 border-t border-lime-300 mt-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-primary-600">Subtotal</span>
                        <span className="font-medium">AED {calculateTotal().toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-orange-600">VAT ({vatPercent}%)</span>
                        <span className="font-medium text-orange-600">AED {(calculateTotal() * (vatPercent / 100)).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-base font-bold text-green-700 mt-1">
                        <span>Total</span>
                        <span>AED {(calculateTotal() * (1 + vatPercent / 100)).toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto overflow-y-auto max-h-[400px] w-full max-w-full border-2 border-lime-300 border-t-0 rounded-b-lg" style={{ WebkitOverflowScrolling: 'touch' }}>
                  <table className="w-full text-xs border-collapse min-w-[640px]">
                    <thead className="bg-lime-100 sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-2 border-r border-lime-300 text-left">SL</th>
                        <th className="px-2 py-2 border-r border-lime-300 text-left">Description</th>
                        <th className="px-2 py-2 border-r border-lime-300 text-left">Unit</th>
                        <th className="px-2 py-2 border-r border-lime-300 text-left">Stock</th>
                        <th className="px-2 py-2 border-r border-lime-300 text-left">Qty</th>
                        <th className="px-2 py-2 border-r border-lime-300 text-left">Unit Cost</th>
                        <th className="px-2 py-2 border-r border-lime-300 text-left">Subtotal</th>
                        <th className="px-2 py-2 border-r border-lime-300 text-left">VAT ({vatPercent}%)</th>
                        <th className="px-2 py-2 text-left">Total</th>
                        <th className="px-2 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-lime-200">
                      {formData.items.length === 0 ? (
                        <tr>
                          <td colSpan="10" className="px-4 py-8 text-center text-primary-500">
                            No items. Search and add products.
                          </td>
                        </tr>
                      ) : (
                        formData.items.map((item, index) => (
                          <tr key={index} className="hover:bg-lime-50">
                            <td className="px-2 py-2 border-r border-lime-200 text-center">{index + 1}</td>
                            <td className="px-2 py-2 border-r border-lime-200">
                              <div>
                                <p className="font-medium">{item.productName}</p>
                                <p className="text-primary-500">{item.sku}</p>
                              </div>
                            </td>
                            <td className="px-2 py-2 border-r border-lime-200">
                              <select
                                className="w-full px-1 py-1 border border-lime-300 rounded text-xs uppercase"
                                value={item.unitType || 'CRTN'}
                                onChange={(e) => updateItem(index, 'unitType', e.target.value)}
                              >
                                <option value="CRTN">CRTN</option>
                                <option value="KG">KG</option>
                                <option value="PIECE">PIECE</option>
                                <option value="BOX">BOX</option>
                                <option value="PKG">PKG</option>
                                <option value="BAG">BAG</option>
                                <option value="PC">PC</option>
                                <option value="UNIT">UNIT</option>
                                <option value="CTN">CTN</option>
                                <option value="PCS">PCS</option>
                                <option value="LTR">LTR</option>
                                <option value="MTR">MTR</option>
                              </select>
                            </td>
                            <td className="px-2 py-2 border-r border-lime-200 text-primary-600">
                              {item.stockQty != null && item.stockQty !== '' ? Number(item.stockQty) : '—'}
                            </td>
                            <td className="px-2 py-2 border-r border-lime-200">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="w-20 px-1 py-1 border border-lime-300 rounded text-xs"
                                value={item.qty === '' ? '' : item.qty}
                                onChange={(e) => updateItem(index, 'qty', e.target.value)}
                              />
                            </td>
                            <td className="px-2 py-2 border-r border-lime-200">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="w-20 px-1 py-1 border border-lime-300 rounded text-xs"
                                value={item.unitCost === '' ? '' : item.unitCost}
                                onChange={(e) => updateItem(index, 'unitCost', e.target.value)}
                              />
                            </td>
                            <td className="px-2 py-2 border-r border-lime-200 text-primary-600">
                              AED {(() => {
                                const qty = typeof item.qty === 'number' ? item.qty : 0
                                const cost = typeof item.unitCost === 'number' ? item.unitCost : 0
                                const subtotal = qty * cost
                                return subtotal.toFixed(2)
                              })()}
                            </td>
                            <td className="px-2 py-2 border-r border-lime-200 text-orange-600">
                              AED {(() => {
                                const qty = typeof item.qty === 'number' ? item.qty : 0
                                const cost = typeof item.unitCost === 'number' ? item.unitCost : 0
                                const subtotal = qty * cost
                                const vat = subtotal * (vatPercent / 100)
                                return vat.toFixed(2)
                              })()}
                            </td>
                            <td className="px-2 py-2 font-bold text-green-700">
                              AED {(() => {
                                const qty = typeof item.qty === 'number' ? item.qty : 0
                                const cost = typeof item.unitCost === 'number' ? item.unitCost : 0
                                const subtotal = qty * cost
                                const vat = subtotal * (vatPercent / 100)
                                const total = subtotal + vat
                                return total.toFixed(2)
                              })()}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                type="button"
                                onClick={() => removeItem(index)}
                                className="text-red-600 hover:text-red-800"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot className="bg-lime-100">
                      <tr>
                        <td colSpan="5" className="px-2 py-2 text-right font-bold border-r border-lime-300">Totals:</td>
                        <td className="px-2 py-2 font-bold text-primary-700 border-r border-lime-300">
                          AED {calculateTotal().toFixed(2)}
                        </td>
                        <td className="px-2 py-2 font-bold text-orange-600 border-r border-lime-300">
                          AED {(calculateTotal() * (vatPercent / 100)).toFixed(2)}
                        </td>
                        <td className="px-2 py-2 font-bold text-green-700">
                          AED {(calculateTotal() * (1 + vatPercent / 100)).toFixed(2)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border-2 border-lime-300 rounded text-sm font-medium hover:bg-lime-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-600 text-white rounded text-sm font-medium hover:bg-primary-700 flex items-center min-h-[44px]"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save Purchase
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Purchases List - Tally Style - contained, no horizontal page scroll */}
        <div className="bg-white rounded-lg border-2 border-lime-300 shadow-sm w-full max-w-full overflow-hidden">
          <div className="p-4 border-b-2 border-lime-400 bg-lime-100">
            <h3 className="text-sm font-bold text-primary-800">Purchase List</h3>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
          ) : (
            <>
              {/* Desktop Table - scroll contained, no page overflow */}
              <div className="hidden md:block overflow-x-auto max-w-full" style={{ WebkitOverflowScrolling: 'touch' }}>
                <table className="w-full text-xs min-w-[600px]">
                  <thead className="bg-lime-100">
                    <tr>
                      <th className="px-3 py-2 border-r border-lime-300 text-left">Invoice No</th>
                      <th className="px-3 py-2 border-r border-lime-300 text-left">Supplier</th>
                      <th className="px-3 py-2 border-r border-lime-300 text-left">Date</th>
                      <th className="px-3 py-2 border-r border-lime-300 text-right">Subtotal</th>
                      <th className="px-3 py-2 border-r border-lime-300 text-right">VAT ({vatPercent}%)</th>
                      <th className="px-3 py-2 border-r border-lime-300 text-right">Total</th>
                      <th className="px-3 py-2 border-r border-lime-300 text-center">Items</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-lime-200">
                    {purchases.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="px-4 py-8 text-center">
                          <div className="text-primary-500">
                            {filterPeriod === 'today' ? (
                              <>
                                <p className="font-medium text-primary-700 mb-1">No purchases found for today</p>
                                <p className="text-sm">Change filter to "All Time" to see all purchases or create a new purchase</p>
                              </>
                            ) : filterPeriod !== 'all' ? (
                              <>
                                <p className="font-medium text-primary-700 mb-1">No purchases found for selected period</p>
                                <p className="text-sm">Try changing the date range or clear filters</p>
                              </>
                            ) : (
                              <>
                                <p className="font-medium text-primary-700 mb-1">No purchases found</p>
                                <p className="text-sm">Create your first purchase to get started</p>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      purchases.map((purchase) => (
                        <tr key={purchase.id} className="hover:bg-lime-50">
                          <td className="px-3 py-2 font-medium">{purchase.invoiceNo}</td>
                          <td className="px-3 py-2">{purchase.supplierName}</td>
                          <td className="px-3 py-2">{new Date(purchase.purchaseDate).toLocaleDateString('en-GB')}</td>
                          <td className="px-3 py-2 text-right">
                            {purchase.subtotal ? (
                              <span className="text-primary-700">AED {purchase.subtotal.toFixed(2)}</span>
                            ) : (
                              <span className="text-primary-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {purchase.vatTotal ? (
                              <span className="text-orange-600 font-medium">AED {purchase.vatTotal.toFixed(2)}</span>
                            ) : (
                              <span className="text-primary-400 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-green-700">AED {purchase.totalAmount.toFixed(2)}</td>
                          <td className="px-3 py-2 text-center">{purchase.items?.length || 0}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-center space-x-2">
                              <button
                                onClick={() => handleEditPurchase(purchase)}
                                className="bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-300 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                                title="Edit Purchase"
                                aria-label="Edit Purchase"
                              >
                                <Edit className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeletePurchase(purchase)}
                                className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-300 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                                title="Delete Purchase"
                                aria-label="Delete Purchase"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3 p-4">
                {purchases.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-primary-500">
                      {filterPeriod === 'today' ? (
                        <>
                          <p className="font-medium text-primary-700 mb-1">No purchases found for today</p>
                          <p className="text-sm">Change filter to "All Time" to see all purchases or create a new purchase</p>
                        </>
                      ) : filterPeriod !== 'all' ? (
                        <>
                          <p className="font-medium text-primary-700 mb-1">No purchases found for selected period</p>
                          <p className="text-sm">Try changing the date range or clear filters</p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-primary-700 mb-1">No purchases found</p>
                          <p className="text-sm">Create your first purchase to get started</p>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  purchases.map((purchase) => (
                    <div key={purchase.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-sm font-semibold text-primary-800">{purchase.supplierName}</p>
                          <p className="text-xs text-primary-500">#{purchase.invoiceNo}</p>
                        </div>
                        <p className="text-base font-bold text-primary-800">{formatCurrency(purchase.totalAmount || 0)}</p>
                      </div>
                      <div className="flex items-center justify-between text-xs text-primary-500 mt-2">
                        <span>{formatDate(purchase.purchaseDate)}</span>
                        <span>{purchase.items?.length || 0} item(s)</span>
                      </div>
                      {purchase.subtotal && purchase.vatTotal && (
                        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-gray-100">
                          <div>
                            <p className="text-xs text-primary-500">Subtotal</p>
                            <p className="text-xs font-medium text-primary-700">{formatCurrency(purchase.subtotal)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-primary-500">VAT ({vatPercent}%)</p>
                            <p className="text-xs font-medium text-orange-600">{formatCurrency(purchase.vatTotal)}</p>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
                        <button
                          onClick={() => handleEditPurchase(purchase)}
                          className="bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-300 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                          title="Edit Purchase"
                        >
                          <Edit className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeletePurchase(purchase)}
                          className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-300 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                          title="Delete Purchase"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {totalPages > 1 && (
            <div className="p-4 border-t border-lime-300 flex justify-center space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 border border-lime-300 rounded text-xs disabled:opacity-50"
              >
                Previous
              </button>
              <span className="px-4 py-1 text-xs">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border border-lime-300 rounded text-xs disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Confirm Danger Modal */}
      <ConfirmDangerModal
        isOpen={dangerModal.isOpen}
        title={dangerModal.title}
        message={dangerModal.message}
        confirmLabel={dangerModal.confirmLabel}
        onConfirm={dangerModal.onConfirm}
        onClose={() => setDangerModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}

export default PurchasesPage

