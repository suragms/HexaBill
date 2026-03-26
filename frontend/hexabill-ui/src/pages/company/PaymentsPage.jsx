import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router-dom'
import { 
  Plus, 
  Search, 
  Filter, 
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  CreditCard,
  DollarSign,
  Calendar,
  Eye,
  Edit,
  Download,
  FileText,
  User,
  Phone,
  Mail,
  MapPin,
  Printer
} from 'lucide-react'
import { formatCurrency, formatBalance, formatBalanceWithColor } from '../../utils/currency'
import { LoadingCard, LoadingButton } from '../../components/Loading'
import { Input, Select } from '../../components/Form'
import Modal from '../../components/Modal'
import { paymentsAPI, customersAPI, salesAPI } from '../../services'
import { useDebounce } from '../../hooks/useDebounce'
import toast from 'react-hot-toast'
import { showToast } from '../../utils/toast'

const PaymentsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false) // Separate state for form submission
  const [payments, setPayments] = useState([])
  const [filteredPayments, setFilteredPayments] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterMethod, setFilterMethod] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [customers, setCustomers] = useState([])
  const [sales, setSales] = useState([])
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [receiptPayment, setReceiptPayment] = useState(null)
  const [outstandingInvoices, setOutstandingInvoices] = useState([])
  const [loadingInvoices, setLoadingInvoices] = useState(false)
  const [showBulkPaymentModal, setShowBulkPaymentModal] = useState(false)
  const [bulkPayments, setBulkPayments] = useState([{ customerId: '', amount: '', method: 'Cash', paymentDate: new Date().toISOString().split('T')[0] }])
  const [selectedPaymentIds, setSelectedPaymentIds] = useState([])
  const [showReceiptPreviewModal, setShowReceiptPreviewModal] = useState(false)
  const [receiptPreviewPaymentIds, setReceiptPreviewPaymentIds] = useState([])

  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors }
  } = useForm()

  const paymentMethod = watch('method')
  const selectedSaleId = watch('saleId')
  const selectedCustomerId = watch('customerId')

  // Load customer details and outstanding invoices when selected
  useEffect(() => {
    let isMounted = true
    
    const loadCustomerDetails = async () => {
      if (selectedCustomerId && isMounted) {
        try {
          setLoadingInvoices(true)
          const [customerRes, invoicesRes] = await Promise.all([
            customersAPI.getCustomer(selectedCustomerId),
            customersAPI.getOutstandingInvoices(selectedCustomerId)
          ])
          if (isMounted) {
            if (customerRes.success && customerRes.data) {
              setSelectedCustomerDetails(customerRes.data)
            }
            if (invoicesRes.success && invoicesRes.data) {
              setOutstandingInvoices(invoicesRes.data || [])
            }
          }
        } catch (error) {
          console.error('Failed to load customer details:', error)
          if (isMounted) {
            setOutstandingInvoices([])
          }
        } finally {
          if (isMounted) {
            setLoadingInvoices(false)
          }
        }
      } else if (isMounted) {
        setSelectedCustomerDetails(null)
        setOutstandingInvoices([])
      }
    }
    loadCustomerDetails()
    
    return () => {
      isMounted = false
    }
  }, [selectedCustomerId])

  useEffect(() => {
    let isMounted = true
    
    // Define fetchData before using it
    const fetchDataSafe = async () => {
      if (!isMounted) return
      
      try {
        setLoading(true)
        
        // PERFORMANCE FIX: Remove unnecessary salesAPI.getSales() call
        // Invoices load dynamically when customer is selected via getOutstandingInvoices()
        // This saves loading 100 sales on every page load
        const [paymentsRes, customersRes] = await Promise.all([
          paymentsAPI.getPayments({ page: 1, pageSize: 100 }),
          customersAPI.getCustomers({ page: 1, pageSize: 100 })
        ])
        
        if (!isMounted) return
        
        if (paymentsRes.success && paymentsRes.data) {
          setPayments(paymentsRes.data.items || paymentsRes.data || [])
        } else {
          setPayments([])
        }
        
        if (customersRes.success && customersRes.data) {
          setCustomers(customersRes.data.items || customersRes.data || [])
        } else {
          setCustomers([])
        }
        
        // Sales are no longer loaded on page load - they load dynamically when customer is selected
        setSales([])
      } catch (error) {
        if (!isMounted) return
        console.error('Failed to load payments data:', error)
        toast.error(error.response?.data?.message || 'Failed to load payments data')
        setPayments([])
        setCustomers([])
        setSales([])
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }
    
    fetchDataSafe()
    
    // Auto-refresh DISABLED - prevents UI interruption during user actions
    // User can manually refresh with refresh button
    
    // Check for customerId in URL params (from quick payment entry)
    const customerIdParam = searchParams.get('customerId')
    if (customerIdParam && isMounted) {
      setShowAddModal(true)
      setValue('customerId', parseInt(customerIdParam))
      // Clear URL param
      setSearchParams({})
    }
    
    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  useEffect(() => {
    filterPayments()
  }, [payments, debouncedSearchTerm, filterMethod, filterStatus])

  const fetchDataRef = useRef(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      
      // PERFORMANCE FIX: Remove unnecessary salesAPI.getSales() call
      // Invoices load dynamically when customer is selected
      const [paymentsRes, customersRes] = await Promise.all([
        paymentsAPI.getPayments({ page: 1, pageSize: 100 }),
        customersAPI.getCustomers({ page: 1, pageSize: 100 })
      ])
      
      if (paymentsRes.success && paymentsRes.data) {
        setPayments(paymentsRes.data.items || paymentsRes.data || [])
      } else {
        console.warn('Payments response:', paymentsRes)
        setPayments([])
      }
      
      if (customersRes.success && customersRes.data) {
        setCustomers(customersRes.data.items || customersRes.data || [])
      } else {
        console.warn('Customers response:', customersRes)
        setCustomers([])
      }
      
      // Sales are no longer loaded - they load dynamically when customer is selected
      setSales([])
    } catch (error) {
      console.error('Failed to load payments data:', error)
      console.error('Error details:', error.response?.data || error.message)
      toast.error(error.response?.data?.message || 'Failed to load payments data')
      setPayments([])
      setCustomers([])
      setSales([])
    } finally {
      setLoading(false)
    }
  }

  fetchDataRef.current = fetchData

  // Listen for data update events to refresh when payments are made (uses ref to avoid stale closure)
  useEffect(() => {
    const handleDataUpdate = () => {
      if (fetchDataRef.current) fetchDataRef.current()
    }
    window.addEventListener('dataUpdated', handleDataUpdate)
    window.addEventListener('paymentCreated', handleDataUpdate)
    return () => {
      window.removeEventListener('dataUpdated', handleDataUpdate)
      window.removeEventListener('paymentCreated', handleDataUpdate)
    }
  }, [])

  const filterPayments = () => {
    let filtered = payments

    // Apply search filter
    if (debouncedSearchTerm) {
      filtered = filtered.filter(payment =>
        (payment.invoiceNo || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (payment.customerName || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (payment.ref || payment.reference || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      )
    }

    // Apply method filter (use normalized method)
    if (filterMethod) {
      filtered = filtered.filter(payment =>
        getPaymentMethod(payment).toLowerCase() === filterMethod.toLowerCase()
      )
    }

    // Apply status filter (use normalized method/chequeStatus)
    if (filterStatus) {
      if (filterStatus === 'completed') {
        filtered = filtered.filter(payment => {
          const method = getPaymentMethod(payment)
          const cs = getChequeStatus(payment)
          if (method === 'Cash' || method === 'Online') return true
          if (method === 'Cheque' && cs === 'Cleared') return true
          return false
        })
      } else if (filterStatus === 'pending') {
        filtered = filtered.filter(payment => {
          const method = getPaymentMethod(payment)
          const cs = getChequeStatus(payment)
          if (method === 'Pending') return true
          if (method === 'Cheque' && (cs === 'Pending' || cs === 'Returned')) return true
          return false
        })
      } else if (filterStatus === 'credit') {
        filtered = filtered.filter(payment => {
          const method = getPaymentMethod(payment)
          const cs = getChequeStatus(payment)
          return method === 'Pending' || (method === 'Cheque' && cs === 'Pending')
        })
      }
    }

    setFilteredPayments(filtered)
  }

  const onSubmit = async (data) => {
    // Prevent multiple submissions
    if (submitting) {
      toast.error('Please wait, operation in progress...')
      return
    }
    
    // Validate required fields
    if (!data.customerId && !data.saleId) {
      toast.error('Please select either a customer or an invoice')
      return
    }
    
    if (!data.amount || parseFloat(data.amount) <= 0) {
      toast.error('Please enter a valid payment amount')
      return
    }
    
    // VALIDATION FIX: Check payment amount ≤ outstanding balance
    const paymentAmount = parseFloat(data.amount)
    if (data.saleId) {
      // If invoice is selected, validate against invoice outstanding balance
      const selectedInvoice = outstandingInvoices.find(inv => inv.id === parseInt(data.saleId, 10))
      if (selectedInvoice && paymentAmount > selectedInvoice.balanceAmount + 0.01) {
        toast.error(`Payment amount (${paymentAmount.toFixed(2)} AED) exceeds outstanding balance (${selectedInvoice.balanceAmount.toFixed(2)} AED). Maximum allowed: ${selectedInvoice.balanceAmount.toFixed(2)} AED`)
        return
      }
    } else if (data.customerId && selectedCustomerDetails) {
      // If only customer is selected (no invoice), validate against customer balance
      const customerBalance = Math.abs(selectedCustomerDetails.balance || 0)
      if (customerBalance > 0 && paymentAmount > customerBalance + 0.01) {
        toast.error(`Payment amount (${paymentAmount.toFixed(2)} AED) exceeds customer outstanding balance (${customerBalance.toFixed(2)} AED). Maximum allowed: ${customerBalance.toFixed(2)} AED`)
        return
      }
    }
    
    try {
      setSubmitting(true)
      
      // Prepare payment data with proper types
      let paymentDate = data.paymentDate
      
      // If paymentDate is a date string (YYYY-MM-DD), convert to ISO string
      if (paymentDate && typeof paymentDate === 'string' && paymentDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Convert YYYY-MM-DD to ISO string (adds time component)
        paymentDate = new Date(paymentDate + 'T00:00:00').toISOString()
      } else if (!paymentDate) {
        paymentDate = new Date().toISOString()
      }
      
      const paymentData = {
        saleId: data.saleId ? parseInt(data.saleId, 10) : null,
        customerId: data.customerId ? parseInt(data.customerId, 10) : null,
        amount: parseFloat(data.amount),
        mode: data.method, // Backend expects 'Mode' not 'method'
        reference: data.ref || null, // Backend expects 'Reference' not 'ref'
        paymentDate: paymentDate
      }

      const response = await paymentsAPI.createPayment(paymentData)
      
      if (response.success) {
        toast.success(selectedPayment ? 'Payment updated successfully!' : 'Payment added successfully!')
        // Reload data by calling the API directly (fetchData is now inline in useEffect)
        try {
          setLoading(true)
          const [paymentsRes, customersRes, salesRes] = await Promise.all([
            paymentsAPI.getPayments({ page: 1, pageSize: 100 }),
            customersAPI.getCustomers({ page: 1, pageSize: 100 }),
            salesAPI.getSales({ page: 1, pageSize: 100 })
          ])
          if (paymentsRes.success && paymentsRes.data) {
            setPayments(paymentsRes.data.items || paymentsRes.data || [])
          }
          if (customersRes.success && customersRes.data) {
            setCustomers(customersRes.data.items || customersRes.data || [])
          }
          if (salesRes.success && salesRes.data) {
            setSales(salesRes.data.items || salesRes.data || [])
          }
        } catch (error) {
          console.error('Failed to reload data:', error)
        } finally {
          setLoading(false)
        }
        reset()
        setShowAddModal(false)
        setShowEditModal(false)
        setSelectedPayment(null)
        // Trigger global update event
        window.dispatchEvent(new CustomEvent('paymentCreated', { detail: { payment: response.data } }))
        window.dispatchEvent(new CustomEvent('dataUpdated'))
      } else {
        toast.error(response.message || 'Failed to save payment')
      }
    } catch (error) {
      console.error('Failed to save payment:', error)
      toast.error(error?.response?.data?.message || error?.response?.data?.errors?.join(', ') || 'Failed to save payment')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (payment) => {
    setSelectedPayment(payment)
    setValue('saleId', payment.saleId)
    setValue('customerId', payment.customerId)
    setValue('amount', payment.amount)
    setValue('method', payment.method)
    setValue('ref', payment.ref)
    // Format payment date for date input (YYYY-MM-DD)
    const paymentDate = payment.paymentDate ? new Date(payment.paymentDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    setValue('paymentDate', paymentDate)
    setShowEditModal(true)
  }

  const handleViewReceipt = (payment) => {
    setReceiptPayment(payment)
    setShowReceiptModal(true)
  }

  const openReceiptPreview = (ids) => {
    setReceiptPreviewPaymentIds(Array.isArray(ids) ? ids : [ids])
    setShowReceiptPreviewModal(true)
  }

  const handleGenerateReceiptFromBar = () => {
    if (selectedPaymentIds.length === 0) return
    openReceiptPreview(selectedPaymentIds)
  }

  const togglePaymentSelection = (id) => {
    setSelectedPaymentIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAllPayments = () => {
    if (selectedPaymentIds.length === filteredPayments.length) {
      setSelectedPaymentIds([])
    } else {
      setSelectedPaymentIds(filteredPayments.map(p => p.id))
    }
  }

  const selectedTotal = filteredPayments
    .filter(p => selectedPaymentIds.includes(p.id))
    .reduce((sum, p) => sum + (p.amount || 0), 0)

  const handleDownloadReceipt = async (payment) => {
    try {
      // IMPROVEMENT: One-click receipt download from payments list
      if (payment.saleId) {
        // If payment has an invoice, download invoice PDF
        const response = await salesAPI.getInvoicePdf(payment.saleId)
        const blob = response instanceof Blob ? response : new Blob([response], { type: 'application/pdf' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `payment_receipt_${payment.invoiceNo || payment.id}_${new Date().toISOString().split('T')[0]}.pdf`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        toast.success('Receipt downloaded successfully')
      } else {
        // For payments without invoices, show receipt modal instead
        showToast.info('Opening receipt preview...')
        setReceiptPayment(payment)
        setShowReceiptModal(true)
      }
    } catch (error) {
      console.error('Failed to download receipt:', error)
      toast.error(error?.response?.data?.message || 'Failed to download receipt')
    }
  }

  const handleChequeStatusUpdate = async (paymentId, status) => {
    try {
      // FIX: Use correct API endpoint for updating payment status
      const response = await paymentsAPI.updatePaymentStatus(paymentId, status)
      if (response.success) {
        toast.success(`Cheque status updated to ${status}`)
        fetchData()
        // Trigger global update event to refresh customer balances
        window.dispatchEvent(new CustomEvent('dataUpdated'))
      } else {
        toast.error(response.message || 'Failed to update cheque status')
      }
    } catch (error) {
      console.error('Failed to update cheque status:', error)
      toast.error(error?.response?.data?.message || 'Failed to update cheque status')
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      })
    } catch (error) {
      return dateString
    }
  }

  const getStatusIcon = (status, chequeStatus, method) => {
    // If payment method is Pending, show pending status
    if (method === 'Pending') {
      return <Clock className="h-5 w-5 text-yellow-500" />
    }
    
    // For Cheque, use chequeStatus
    if (method === 'Cheque') {
      if (chequeStatus === 'Cleared') {
        return <CheckCircle className="h-5 w-5 text-green-500" />
      } else if (chequeStatus === 'Returned') {
        return <XCircle className="h-5 w-5 text-red-500" />
      }
      return <Clock className="h-5 w-5 text-yellow-500" />
    }
    
    // For Cash/Online, payment is completed
    return <CheckCircle className="h-5 w-5 text-green-500" />
  }

  // Normalize API response: backend sends mode/status (camelCase); support chequeStatus if present (PRODUCTION_MASTER_TODO #39)
  const getPaymentMethod = (p) => (p.method || p.mode || '').toLowerCase().replace(/^./, (c) => c.toUpperCase())
  const getChequeStatus = (p) => p.chequeStatus || (p.status === 'CLEARED' ? 'Cleared' : p.status === 'RETURNED' ? 'Returned' : p.status === 'VOID' ? 'Void' : 'Pending')

  const getStatusColor = (status, chequeStatus, method) => {
    // If payment method is Pending, show pending status
    if (method === 'Pending') {
      return 'bg-yellow-100 text-yellow-800'
    }
    
    // For Cheque, use chequeStatus
    if (method === 'Cheque') {
      if (chequeStatus === 'Cleared') {
        return 'bg-green-100 text-green-800'
      } else if (chequeStatus === 'Returned') {
        return 'bg-red-100 text-red-800'
      }
      return 'bg-yellow-100 text-yellow-800'
    }
    
    // For Cash/Online, payment is completed
    return 'bg-green-100 text-green-800'
  }

  if (loading) {
    return <LoadingCard message="Loading payments..." />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-gray-600">Manage customer payments and cheque status. Customer balance reflects cleared payments only; mark cheques as cleared when they clear.</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          <button
            onClick={() => fetchData()}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 min-h-[44px]"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Payment
          </button>
          <button
            onClick={() => setShowBulkPaymentModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 min-h-[44px]"
            title="Add multiple payments at once"
          >
            <Plus className="h-4 w-4 mr-2" />
            Bulk Payment
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search payments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex space-x-3">
            <select
              value={filterMethod}
              onChange={(e) => setFilterMethod(e.target.value)}
              className="w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">All Methods</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
              <option value="Online">Online</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">All Status</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="credit">Credit</option>
            </select>
            {(filterMethod || filterStatus) && (
              <button
                onClick={() => {
                  setFilterMethod('')
                  setFilterStatus('')
                }}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <Filter className="h-4 w-4 mr-2" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Payments Table - Desktop */}
      <div className="hidden md:block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={filteredPayments.length > 0 && selectedPaymentIds.length === filteredPayments.length}
                    onChange={toggleSelectAllPayments}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Invoice
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Method
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reference
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <CreditCard className="h-12 w-12 text-gray-400 mb-4" />
                      <p className="text-gray-500 text-lg font-medium">No payments found</p>
                      <p className="text-gray-500 text-sm mt-1">
                        {searchTerm ? 'Try adjusting your search criteria' : 'Get started by adding a new payment'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredPayments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedPaymentIds.includes(payment.id)}
                        onChange={() => togglePaymentSelection(payment.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{payment.invoiceNo || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{payment.customerName || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(payment.amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <CreditCard className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">{getPaymentMethod(payment)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {payment.ref || payment.reference || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {getStatusIcon(payment.status, getChequeStatus(payment), getPaymentMethod(payment))}
                        <span className={`ml-2 inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(payment.status, getChequeStatus(payment), getPaymentMethod(payment))}`}>
                          {getPaymentMethod(payment) === 'Cheque' ? getChequeStatus(payment) : (getPaymentMethod(payment) === 'Pending' ? 'Pending' : 'Completed')}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(payment.paymentDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEdit(payment)}
                          className="text-indigo-600 hover:text-indigo-900"
                          title="Edit Payment"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openReceiptPreview([payment.id])}
                          className="text-indigo-600 hover:text-indigo-900"
                          title="Generate Payment Receipt"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleViewReceipt(payment)}
                          className="text-blue-600 hover:text-blue-900"
                          title="View Receipt"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDownloadReceipt(payment)}
                          className="text-green-600 hover:text-green-900"
                          title="Download Receipt"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        {getPaymentMethod(payment) === 'Cheque' && getChequeStatus(payment) === 'Pending' && (
                          <div className="inline-flex space-x-1 ml-2">
                            <button
                              onClick={() => handleChequeStatusUpdate(payment.id, 'Cleared')}
                              className="text-green-600 hover:text-green-900 text-xs px-2 py-1 border border-green-300 rounded"
                            >
                              Mark cleared
                            </button>
                            <button
                              onClick={() => handleChequeStatusUpdate(payment.id, 'Returned')}
                              className="text-red-600 hover:text-red-900 text-xs px-2 py-1 border border-red-300 rounded"
                            >
                              Return
                            </button>
                          </div>
                        )}
                        {getPaymentMethod(payment) === 'Cheque' && getChequeStatus(payment) === 'Cleared' && (
                          <button
                            onClick={() => handleChequeStatusUpdate(payment.id, 'Pending')}
                            className="text-amber-600 hover:text-amber-900 text-xs px-2 py-1 border border-amber-300 rounded"
                            title="Revert to pending (e.g. cheque not yet cleared)"
                          >
                            Mark pending
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
      {selectedPaymentIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            {selectedPaymentIds.length} payment(s) selected — Total: {formatCurrency(selectedTotal)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleGenerateReceiptFromBar}
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

      {/* Payment Receipt Preview Modal (from ledger) */}
      <ReceiptPreviewModal
        paymentIds={receiptPreviewPaymentIds}
        isOpen={showReceiptPreviewModal}
        onClose={() => {
          setShowReceiptPreviewModal(false)
          setReceiptPreviewPaymentIds([])
          setSelectedPaymentIds([])
        }}
        onSuccess={fetchData}
      />

      {/* Payments Cards - Mobile */}
      <div className="md:hidden space-y-3">
        {filteredPayments.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <CreditCard className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 text-lg font-medium">No payments found</p>
            <p className="text-gray-500 text-sm mt-1">
              {searchTerm ? 'Try adjusting your search criteria' : 'Get started by adding a new payment'}
            </p>
          </div>
        ) : (
          filteredPayments.map((payment) => (
            <div key={payment.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{payment.customerName || 'Unknown'}</p>
                  <p className="text-xs text-gray-500">{payment.invoiceNo || 'General Payment'}</p>
                </div>
                <p className="text-base font-bold text-gray-900">{formatCurrency(payment.amount)}</p>
              </div>
              <div className="flex items-center gap-3 mb-3 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <CreditCard className="h-3.5 w-3.5" />
                  <span>{getPaymentMethod(payment)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{formatDate(payment.paymentDate)}</span>
                </div>
                {payment.ref && (
                  <span className="truncate max-w-[100px]">Ref: {payment.ref}</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {getStatusIcon(payment.status, getChequeStatus(payment), getPaymentMethod(payment))}
                  <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusColor(payment.status, getChequeStatus(payment), getPaymentMethod(payment))}`}>
                    {getPaymentMethod(payment) === 'Cheque' ? getChequeStatus(payment) : (getPaymentMethod(payment) === 'Pending' ? 'Pending' : 'Completed')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(payment)}
                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg"
                    title="Edit"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openReceiptPreview([payment.id])}
                    className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg"
                    title="Payment Receipt"
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleViewReceipt(payment)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                    title="Receipt"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDownloadReceipt(payment)}
                    className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  {getPaymentMethod(payment) === 'Cheque' && getChequeStatus(payment) === 'Pending' && (
                    <>
                      <button
                        onClick={() => handleChequeStatusUpdate(payment.id, 'Cleared')}
                        className="text-xs px-2 py-1 text-green-700 bg-green-50 border border-green-200 rounded-lg"
                      >
                        Mark cleared
                      </button>
                      <button
                        onClick={() => handleChequeStatusUpdate(payment.id, 'Returned')}
                        className="text-xs px-2 py-1 text-red-700 bg-red-50 border border-red-200 rounded-lg"
                      >
                        Return
                      </button>
                    </>
                  )}
                  {getPaymentMethod(payment) === 'Cheque' && getChequeStatus(payment) === 'Cleared' && (
                    <button
                      onClick={() => handleChequeStatusUpdate(payment.id, 'Pending')}
                      className="text-xs px-2 py-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg"
                    >
                      Mark pending
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Payment Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          reset()
        }}
        title="Add New Payment"
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Select
              label="Customer (Optional - if not selecting invoice)"
              options={[
                { value: '', label: 'Select Customer' },
                ...customers.map(customer => ({
                  value: customer.id,
                  label: `${customer.name} ${customer.phone ? `(${customer.phone})` : ''} - Balance: ${formatBalance(customer.balance || 0)}`
                }))
              ]}
              error={errors.customerId?.message}
              {...register('customerId', { 
                validate: (value) => {
                  if (!value && !selectedSaleId) {
                    return 'Please select either a customer or an invoice'
                  }
                  return true
                }
              })}
            />

            <Select
              label="Invoice/Sale (Optional - if not selecting customer)"
              options={[
                { value: '', label: 'Select Invoice' },
                // PERFORMANCE FIX: Only show outstanding invoices (loads dynamically when customer selected)
                // Removed fallback to sales list (which was loaded unnecessarily on page load)
                ...(selectedCustomerId && outstandingInvoices.length > 0
                  ? outstandingInvoices.map(inv => ({
                      value: inv.id,
                      label: `${inv.invoiceNo} - Balance: ${formatCurrency(inv.balanceAmount)} ${inv.daysOverdue > 0 ? `(${inv.daysOverdue} days overdue)` : ''}`
                    }))
                  : [])
              ]}
              error={errors.saleId?.message}
              disabled={selectedCustomerId && loadingInvoices}
              {...register('saleId', { 
                validate: (value) => {
                  if (!value && !selectedCustomerId) {
                    return 'Please select either an invoice or a customer'
                  }
                  return true
                }
              })}
            />

            <Select
              label="Payment Method"
              options={[
                { value: 'Cash', label: 'Cash' },
                { value: 'Cheque', label: 'Cheque' },
                { value: 'Online', label: 'Online Transfer' },
                { value: 'Pending', label: 'Pending/Credit' }
              ]}
              required
              error={errors.method?.message}
              {...register('method', { required: 'Payment method is required' })}
            />

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

            <Input
              label="Payment Date"
              type="date"
              required
              error={errors.paymentDate?.message}
              defaultValue={new Date().toISOString().split('T')[0]}
              {...register('paymentDate', { required: 'Payment date is required' })}
            />

            {/* Auto-fill amount from selected invoice */}
            {selectedSaleId && outstandingInvoices.length > 0 && (
              <div className="md:col-span-2">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-blue-900 mb-2">Selected Invoice Details:</p>
                  {(() => {
                    const selectedInv = outstandingInvoices.find(inv => inv.id === parseInt(selectedSaleId))
                    if (selectedInv) {
                      return (
                        <div className="space-y-1 text-sm">
                          <p><span className="font-medium">Invoice:</span> {selectedInv.invoiceNo}</p>
                          <p><span className="font-medium">Total:</span> {formatCurrency(selectedInv.grandTotal)}</p>
                          <p><span className="font-medium">Paid:</span> {formatCurrency(selectedInv.paidAmount)}</p>
                          <p className="text-red-600 font-semibold">
                            <span className="font-medium">Balance Due:</span> {formatCurrency(selectedInv.balanceAmount)}
                            {selectedInv.daysOverdue > 0 && (
                              <span className="ml-2 text-orange-600">({selectedInv.daysOverdue} days overdue)</span>
                            )}
                          </p>
                          <button
                            type="button"
                            onClick={() => setValue('amount', selectedInv.balanceAmount)}
                            className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline"
                          >
                            Fill Full Balance Amount
                          </button>
                        </div>
                      )
                    }
                    return null
                  })()}
                </div>
              </div>
            )}

            {/* Outstanding Invoices List for Selected Customer */}
            {selectedCustomerId && outstandingInvoices.length > 0 && !selectedSaleId && (
              <div className="md:col-span-2">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-yellow-900 mb-3">
                    Outstanding Invoices for {selectedCustomerDetails?.name || 'Customer'}:
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {outstandingInvoices.map((inv) => (
                      <div key={inv.id} className="bg-white border border-yellow-200 rounded p-3 flex justify-between items-center hover:bg-yellow-50">
                        <div>
                          <p className="font-medium text-sm">{inv.invoiceNo}</p>
                          <p className="text-xs text-gray-600">
                            {new Date(inv.invoiceDate).toLocaleDateString()} • 
                            {inv.daysOverdue > 0 ? (
                              <span className="text-red-600 font-semibold"> {inv.daysOverdue} days overdue</span>
                            ) : (
                              <span className="text-green-600"> Not due yet</span>
                            )}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-red-600">{formatCurrency(inv.balanceAmount)}</p>
                          <button
                            type="button"
                            onClick={() => {
                              setValue('saleId', inv.id)
                              setValue('amount', inv.balanceAmount)
                            }}
                            className="text-xs text-blue-600 hover:text-blue-800 underline mt-1"
                          >
                            Select & Fill
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {paymentMethod === 'Cheque' && (
              <>
                <Input
                  label="Cheque Number"
                  placeholder="CHQ001"
                  error={errors.ref?.message}
                  {...register('ref')}
                />
                <Input
                  label="Bank Name"
                  placeholder="Emirates NBD"
                  error={errors.bankName?.message}
                  {...register('bankName')}
                />
              </>
            )}

            {paymentMethod === 'Online' && (
              <Input
                label="Transaction Reference"
                placeholder="TXN123456"
                error={errors.ref?.message}
                {...register('ref')}
              />
            )}

            <div className="md:col-span-2">
              <Input
                label="Notes"
                placeholder="Additional payment notes..."
                error={errors.notes?.message}
                {...register('notes')}
              />
            </div>
          </div>

          {/* Customer Details Section */}
          {selectedCustomerDetails && (
            <div className="mt-6 border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2" />
                Customer Details
              </h3>
              <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start">
                  <User className="h-4 w-4 text-gray-400 mt-1 mr-2" />
                  <div>
                    <p className="text-xs text-gray-500">Name</p>
                    <p className="text-sm font-medium text-gray-900">{selectedCustomerDetails.name}</p>
                  </div>
                </div>
                {selectedCustomerDetails.phone && (
                  <div className="flex items-start">
                    <Phone className="h-4 w-4 text-gray-400 mt-1 mr-2" />
                    <div>
                      <p className="text-xs text-gray-500">Phone</p>
                      <p className="text-sm font-medium text-gray-900">{selectedCustomerDetails.phone}</p>
                    </div>
                  </div>
                )}
                {selectedCustomerDetails.email && (
                  <div className="flex items-start">
                    <Mail className="h-4 w-4 text-gray-400 mt-1 mr-2" />
                    <div>
                      <p className="text-xs text-gray-500">Email</p>
                      <p className="text-sm font-medium text-gray-900">{selectedCustomerDetails.email}</p>
                    </div>
                  </div>
                )}
                {selectedCustomerDetails.address && (
                  <div className="flex items-start md:col-span-2">
                    <MapPin className="h-4 w-4 text-gray-400 mt-1 mr-2" />
                    <div>
                      <p className="text-xs text-gray-500">Address</p>
                      <p className="text-sm font-medium text-gray-900">{selectedCustomerDetails.address}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start">
                  <DollarSign className="h-4 w-4 text-gray-400 mt-1 mr-2" />
                  <div>
                    <p className="text-xs text-gray-500">Account Balance</p>
                    <p className={`text-sm font-medium ${(selectedCustomerDetails.balance || 0) < 0 ? 'text-green-600' : (selectedCustomerDetails.balance || 0) > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                      {formatBalance(selectedCustomerDetails.balance || 0)}
                    </p>
                  </div>
                </div>
                {selectedCustomerDetails.trn && (
                  <div className="flex items-start">
                    <FileText className="h-4 w-4 text-gray-400 mt-1 mr-2" />
                    <div>
                      <p className="text-xs text-gray-500">TRN</p>
                      <p className="text-sm font-medium text-gray-900">{selectedCustomerDetails.trn}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setShowAddModal(false)
                reset()
              }}
              disabled={submitting}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <LoadingButton type="submit" loading={submitting}>
              {submitting ? 'Submitting...' : 'Add Payment'}
            </LoadingButton>
          </div>
        </form>
      </Modal>

      {/* Edit Payment Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false)
          setSelectedPayment(null)
          reset()
        }}
        title="Edit Payment"
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Select
              label="Customer (Optional - if not selecting invoice)"
              options={[
                { value: '', label: 'Select Customer' },
                ...customers.map(customer => ({
                  value: customer.id,
                  label: `${customer.name} ${customer.phone ? `(${customer.phone})` : ''} - Balance: ${formatBalance(customer.balance || 0)}`
                }))
              ]}
              error={errors.customerId?.message}
              {...register('customerId', { 
                validate: (value) => {
                  if (!value && !selectedSaleId) {
                    return 'Please select either a customer or an invoice'
                  }
                  return true
                }
              })}
            />

            <Select
              label="Invoice/Sale (Optional - if not selecting customer)"
              options={[
                { value: '', label: 'Select Invoice' },
                // PERFORMANCE FIX: Only show outstanding invoices (loads dynamically when customer selected)
                ...(selectedCustomerId && outstandingInvoices.length > 0
                  ? outstandingInvoices.map(inv => ({
                      value: inv.id,
                      label: `${inv.invoiceNo} - Balance: ${formatCurrency(inv.balanceAmount)} ${inv.daysOverdue > 0 ? `(${inv.daysOverdue} days overdue)` : ''}`
                    }))
                  : [])
              ]}
              error={errors.saleId?.message}
              disabled={selectedCustomerId && loadingInvoices}
              {...register('saleId', { 
                validate: (value) => {
                  if (!value && !selectedCustomerId) {
                    return 'Please select either an invoice or a customer'
                  }
                  return true
                }
              })}
            />

            <Select
              label="Payment Method"
              options={[
                { value: 'Cash', label: 'Cash' },
                { value: 'Cheque', label: 'Cheque' },
                { value: 'Online', label: 'Online Transfer' },
                { value: 'Pending', label: 'Pending/Credit' }
              ]}
              required
              error={errors.method?.message}
              {...register('method', { required: 'Payment method is required' })}
            />

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

            <Input
              label="Payment Date"
              type="date"
              required
              error={errors.paymentDate?.message}
              {...register('paymentDate', { required: 'Payment date is required' })}
            />

            {paymentMethod === 'Cheque' && (
              <>
                <Input
                  label="Cheque Number"
                  placeholder="CHQ001"
                  error={errors.ref?.message}
                  {...register('ref')}
                />
                <Input
                  label="Bank Name"
                  placeholder="Emirates NBD"
                  error={errors.bankName?.message}
                  {...register('bankName')}
                />
              </>
            )}

            {paymentMethod === 'Online' && (
              <Input
                label="Transaction Reference"
                placeholder="TXN123456"
                error={errors.ref?.message}
                {...register('ref')}
              />
            )}

            <div className="md:col-span-2">
              <Input
                label="Notes"
                placeholder="Additional payment notes..."
                error={errors.notes?.message}
                {...register('notes')}
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setShowEditModal(false)
                setSelectedPayment(null)
                reset()
              }}
              disabled={submitting}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <LoadingButton type="submit" loading={submitting}>
              {submitting ? 'Updating...' : 'Update Payment'}
            </LoadingButton>
          </div>
        </form>
      </Modal>

      {/* Bulk Payment Modal */}
      <Modal
        isOpen={showBulkPaymentModal}
        onClose={() => {
          setShowBulkPaymentModal(false)
          setBulkPayments([{ customerId: '', amount: '', method: 'Cash', paymentDate: new Date().toISOString().split('T')[0] }])
        }}
        title="Bulk Payment Entry"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 mb-4">
            Add multiple payments at once. Each row represents one payment.
          </p>
          {bulkPayments.map((payment, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Payment #{index + 1}</span>
                {bulkPayments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setBulkPayments(bulkPayments.filter((_, i) => i !== index))
                    }}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Select
                  label="Customer"
                  options={[
                    { value: '', label: 'Select Customer' },
                    ...customers.map(customer => ({
                      value: customer.id,
                      label: `${customer.name} ${customer.phone ? `(${customer.phone})` : ''} - Balance: ${formatBalance(customer.balance || 0)}`
                    }))
                  ]}
                  value={payment.customerId}
                  onChange={(e) => {
                    const updated = [...bulkPayments]
                    updated[index].customerId = e.target.value
                    setBulkPayments(updated)
                  }}
                />
                <Input
                  label="Amount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={payment.amount}
                  onChange={(e) => {
                    const updated = [...bulkPayments]
                    updated[index].amount = e.target.value
                    setBulkPayments(updated)
                  }}
                />
                <Select
                  label="Payment Method"
                  options={[
                    { value: 'Cash', label: 'Cash' },
                    { value: 'Cheque', label: 'Cheque' },
                    { value: 'Online', label: 'Online Transfer' }
                  ]}
                  value={payment.method}
                  onChange={(e) => {
                    const updated = [...bulkPayments]
                    updated[index].method = e.target.value
                    setBulkPayments(updated)
                  }}
                />
                <Input
                  label="Payment Date"
                  type="date"
                  value={payment.paymentDate}
                  onChange={(e) => {
                    const updated = [...bulkPayments]
                    updated[index].paymentDate = e.target.value
                    setBulkPayments(updated)
                  }}
                />
              </div>
            </div>
          ))}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => {
                setBulkPayments([...bulkPayments, { customerId: '', amount: '', method: 'Cash', paymentDate: new Date().toISOString().split('T')[0] }])
              }}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Plus className="h-4 w-4 inline mr-2" />
              Add Another Payment
            </button>
            <div className="space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowBulkPaymentModal(false)
                  setBulkPayments([{ customerId: '', amount: '', method: 'Cash', paymentDate: new Date().toISOString().split('T')[0] }])
                }}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <LoadingButton
                onClick={async () => {
                  // Validate all payments
                  const invalidPayments = bulkPayments.filter(p => !p.customerId || !p.amount || parseFloat(p.amount) <= 0)
                  if (invalidPayments.length > 0) {
                    toast.error('Please fill all required fields for all payments')
                    return
                  }

                  try {
                    setSubmitting(true)
                    let successCount = 0
                    let errorCount = 0

                    // Process each payment sequentially to avoid race conditions
                    for (const payment of bulkPayments) {
                      try {
                        const paymentDate = payment.paymentDate ? new Date(payment.paymentDate + 'T00:00:00').toISOString() : new Date().toISOString()
                        const paymentData = {
                          customerId: parseInt(payment.customerId, 10),
                          amount: parseFloat(payment.amount),
                          mode: payment.method,
                          paymentDate: paymentDate
                        }
                        const response = await paymentsAPI.createPayment(paymentData)
                        if (response.success) {
                          successCount++
                        } else {
                          errorCount++
                        }
                      } catch (error) {
                        console.error(`Failed to create payment ${bulkPayments.indexOf(payment) + 1}:`, error)
                        errorCount++
                      }
                    }

                    if (successCount > 0) {
                      toast.success(`Successfully created ${successCount} payment(s)${errorCount > 0 ? `. ${errorCount} failed.` : ''}`)
                      setShowBulkPaymentModal(false)
                      setBulkPayments([{ customerId: '', amount: '', method: 'Cash', paymentDate: new Date().toISOString().split('T')[0] }])
                      fetchData()
                      window.dispatchEvent(new CustomEvent('dataUpdated'))
                    } else {
                      toast.error('Failed to create payments. Please check the errors and try again.')
                    }
                  } catch (error) {
                    console.error('Failed to create bulk payments:', error)
                    toast.error('Failed to create bulk payments')
                  } finally {
                    setSubmitting(false)
                  }
                }}
                loading={submitting}
              >
                Save All Payments ({bulkPayments.length})
              </LoadingButton>
            </div>
          </div>
        </div>
      </Modal>

      {/* Payment Receipt/Invoice Modal */}
      <Modal
        isOpen={showReceiptModal}
        onClose={() => {
          setShowReceiptModal(false)
          setReceiptPayment(null)
        }}
        title="Payment Receipt / Tax Invoice"
        size="lg"
      >
        {receiptPayment && (
          <div className="space-y-6">
            {/* Receipt Header */}
            <div className="border-b pb-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">PAYMENT RECEIPT</h3>
                  <p className="text-sm text-gray-500 mt-1">Payment ID: #{receiptPayment.id}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(receiptPayment.paymentDate)}</p>
                </div>
              </div>
            </div>

            {/* Customer Information */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                <User className="h-4 w-4 mr-2" />
                Customer Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500">Customer Name</p>
                  <p className="text-sm font-medium text-gray-900">{receiptPayment.customerName || 'Cash Customer'}</p>
                </div>
                {receiptPayment.invoiceNo && (
                  <div>
                    <p className="text-xs text-gray-500">Invoice Number</p>
                    <p className="text-sm font-medium text-gray-900">{receiptPayment.invoiceNo}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Details */}
            <div className="border rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <tr>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      Payment received via {getPaymentMethod(receiptPayment)}
                      {(receiptPayment.ref || receiptPayment.reference) && <span className="text-gray-500"> - Ref: {receiptPayment.ref || receiptPayment.reference}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">
                      {formatCurrency(receiptPayment.amount)}
                    </td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="px-4 py-3 text-sm font-bold text-gray-900">Total Amount</td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-900 text-right">
                      {formatCurrency(receiptPayment.amount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Payment Status */}
            <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
              <div>
                <p className="text-xs text-gray-500">Payment Status</p>
                <p className="text-sm font-medium text-gray-900">
                  {getPaymentMethod(receiptPayment) === 'Cheque' ? getChequeStatus(receiptPayment) : 'Completed'}
                </p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleDownloadReceipt(receiptPayment)}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Receipt
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default PaymentsPage
