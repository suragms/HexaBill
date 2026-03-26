import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  Download,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Filter,
  RefreshCw,
  Users,
  AlertCircle,
  UserPlus,
  DollarSign,
  Inbox,
  ArrowLeft
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { formatCurrency, formatBalance, formatBalanceWithColor } from '../../utils/currency'
import { isAdminOrOwner } from '../../utils/roles'  // CRITICAL: Multi-tenant role checking
import { validateEmail } from '../../utils/validation'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'
import { LoadingCard, LoadingButton } from '../../components/Loading'
import { Input, Select, TextArea } from '../../components/Form'
import Modal from '../../components/Modal'
import { customersAPI } from '../../services'
import { TabNavigation } from '../../components/ui'
import { useDebounce } from '../../hooks/useDebounce'
import toast from 'react-hot-toast'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'

const CustomersPage = () => {
  const { user } = useAuth()
  const { branches, routes } = useBranchesRoutes()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [customers, setCustomers] = useState([])
  const [filteredCustomers, setFilteredCustomers] = useState([])
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('search') || '')
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'all')
  const [currentPage, setCurrentPage] = useState(() => Number(searchParams.get('page')) || 1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const PAGE_SIZE_OPTIONS = [25, 50, 100]
  const [pageSize, setPageSize] = useState(100)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showLedgerModal, setShowLedgerModal] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [ledgerData, setLedgerData] = useState([])
  const [saving, setSaving] = useState(false)
  const [dangerModal, setDangerModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    requireTypedText: null,
    onConfirm: () => { }
  })
  const [duplicateConfirm, setDuplicateConfirm] = useState({ isOpen: false, data: null, existingName: '' })

  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors }
  } = useForm()

  const selectedBranchId = watch('branchId')

  // Fetch page 1 on mount and when search or page size changes (PRODUCTION_MASTER_TODO #42: pagination)
  useEffect(() => {
    fetchCustomers(1)
  }, [debouncedSearchTerm, pageSize])

  // Handle ?edit=ID URL parameter from Customer Ledger
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (editId && customers.length > 0) {
      const customerToEdit = customers.find(c => c.id === parseInt(editId))
      if (customerToEdit) {
        handleEdit(customerToEdit)
        // Remove the edit parameter from URL after opening modal
        setSearchParams({})
      } else {
        // Customer not found - show error and remove param
        console.error(`Customer with ID ${editId} not found`)
        toast.error(`Customer with ID ${editId} not found. Showing all customers.`)
        setSearchParams({})
      }
    } else if (editId && !loading && customers.length === 0) {
      // Customers loaded but empty - customer doesn't exist
      toast.error(`Customer with ID ${editId} not found.`)
      setSearchParams({})
    }
  }, [customers, searchParams, loading, setSearchParams])

  // Sync filter state to URL so filters survive navigation and browser back
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchTerm) params.set('search', searchTerm)
    if (activeTab && activeTab !== 'all') params.set('tab', activeTab)
    if (currentPage > 1) params.set('page', String(currentPage))
    const editParam = searchParams.get('edit')
    if (editParam) params.set('edit', editParam)
    setSearchParams(params, { replace: true })
  }, [searchTerm, activeTab, currentPage])

  useEffect(() => {
    filterCustomers()
  }, [customers, activeTab])

  const fetchCustomers = async (page = 1, append = false) => {
    try {
      setLoading(true)
      // Server-side search: pass search term to API
      const searchParam = debouncedSearchTerm || undefined
      const response = await customersAPI.getCustomers({ 
        page, 
        pageSize,
        search: searchParam
      })
      if (response.success && response.data) {
        const newCustomers = response.data.items || []
        if (append) {
          setCustomers(prev => [...prev, ...newCustomers])
        } else {
          setCustomers(newCustomers)
        }
        setTotalPages(response.data.totalPages || 1)
        setTotalCount(response.data.totalCount || 0)
        setHasMore(page < (response.data.totalPages || 1))
        setCurrentPage(page)
      } else {
        if (!append) setCustomers([])
      }
    } catch (error) {
      console.error('Failed to load customers:', error)
      // Only show error if it's not a network error (handled by interceptor)
      if (!error?._handledByInterceptor && (error.response || (!error.code || error.code !== 'ERR_NETWORK'))) {
        toast.error(error?.response?.data?.message || 'Failed to load customers')
      }
      if (!append) setCustomers([])
    } finally {
      setLoading(false)
    }
  }

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      fetchCustomers(currentPage + 1, true)
    }
  }

  const filterCustomers = () => {
    let filtered = customers

    // Apply tab filter (client-side filtering for tabs, search is server-side)
    if (activeTab === 'outstanding') {
      // Outstanding: customers with positive balance (owe money)
      filtered = filtered.filter(c => (c.balance || 0) > 0)
    } else if (activeTab === 'active') {
      // Active: customers with transactions in last 90 days
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
      filtered = filtered.filter(c => {
        if (!c.lastActivity) return false
        const lastActivityDate = new Date(c.lastActivity)
        return lastActivityDate >= ninetyDaysAgo
      })
    } else if (activeTab === 'inactive') {
      // Inactive: customers with no transactions in last 90 days
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
      filtered = filtered.filter(c => {
        if (!c.lastActivity) return true // No activity = inactive
        const lastActivityDate = new Date(c.lastActivity)
        return lastActivityDate < ninetyDaysAgo
      })
    }

    // Note: Search is now handled server-side via API, so we don't filter here
    setFilteredCustomers(filtered)
  }

  const onSubmit = async (data) => {
    if (saving) {
      toast.error('Please wait, operation in progress...')
      return
    }

    // Payment terms required when credit limit > 0
    const creditLimitNum = Number(data.creditLimit) || 0
    if (creditLimitNum > 0 && !(data.paymentTerms || '').trim()) {
      toast.error('Payment terms are required when credit limit is set')
      return
    }

    // Duplicate phone/email warning (Add only)
    if (!selectedCustomer) {
      const phoneNorm = (data.phone || '').trim().replace(/\s/g, '')
      const emailNorm = (data.email || '').trim().toLowerCase()
      const duplicate = customers.find(c => {
        const cPhone = (c.phone || '').replace(/\s/g, '')
        const cEmail = (c.email || '').trim().toLowerCase()
        return (phoneNorm && cPhone === phoneNorm) || (emailNorm && cEmail && cEmail === emailNorm)
      })
      if (duplicate) {
        setDuplicateConfirm({ isOpen: true, data, existingName: duplicate.name })
        return
      }
    }

    try {
      setSaving(true)
      const payload = {
        ...data,
        branchId: data.branchId ? parseInt(data.branchId, 10) : null,
        routeId: data.routeId ? parseInt(data.routeId, 10) : null
      }
      let response
      if (selectedCustomer) {
        response = await customersAPI.updateCustomer(selectedCustomer.id, payload)
      } else {
        response = await customersAPI.createCustomer(payload)
      }

      if (response.success) {
        toast.success(selectedCustomer ? 'Customer updated successfully!' : 'Customer added successfully!')
        // Refresh customer list without page reload
        await fetchCustomers()
        reset()
        setShowAddModal(false)
        setShowEditModal(false)
        setSelectedCustomer(null)
      } else {
        toast.error(response.message || 'Failed to save customer')
      }
    } catch (error) {
      console.error('Failed to save customer:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  const handleDuplicateConfirmAdd = async () => {
    if (!duplicateConfirm.data) {
      setDuplicateConfirm({ isOpen: false, data: null, existingName: '' })
      return
    }
    const data = duplicateConfirm.data
    setDuplicateConfirm({ isOpen: false, data: null, existingName: '' })
    const payload = {
      ...data,
      branchId: data.branchId ? parseInt(data.branchId, 10) : null,
      routeId: data.routeId ? parseInt(data.routeId, 10) : null
    }
    try {
      setSaving(true)
      const response = await customersAPI.createCustomer(payload)
      if (response.success) {
        toast.success('Customer added successfully!')
        await fetchCustomers()
        reset()
        setShowAddModal(false)
      } else {
        toast.error(response.message || 'Failed to save customer')
      }
    } catch (error) {
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (customer) => {
    setSelectedCustomer(customer)
    setValue('name', customer.name)
    setValue('phone', customer.phone)
    setValue('email', customer.email)
    setValue('trn', customer.trn)
    setValue('address', customer.address)
    setValue('creditLimit', customer.creditLimit)
    setValue('customerType', customer.customerType || 'Credit')
    setValue('branchId', customer.branchId || '')
    setValue('routeId', customer.routeId || '')
    setValue('paymentTerms', customer.paymentTerms || '')
    setShowEditModal(true)
  }

  const handleExportCustomers = () => {
    try {
      // Create CSV content
      const headers = ['Name', 'Phone', 'Email', 'TRN', 'Address', 'Customer Type', 'Credit Limit', 'Payment Terms', 'Balance', 'Branch', 'Route']
      const rows = customers.map(c => [
        c.name || '',
        c.phone || '',
        c.email || '',
        c.trn || '',
        c.address || '',
        c.customerType || 'Credit',
        (c.creditLimit || 0).toString(),
        c.paymentTerms || '',
        (c.balance || 0).toString(),
        branches.find(b => b.id === c.branchId)?.name || '',
        routes.find(r => r.id === c.routeId)?.name || ''
      ])
      
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(','))
      ].join('\n')
      
      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `customers_export_${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Customers exported successfully')
    } catch (error) {
      console.error('Failed to export customers:', error)
      toast.error('Failed to export customers')
    }
  }

  const handleImportCustomers = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      if (lines.length < 2) {
        toast.error('CSV file must have at least a header row and one data row')
        return
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
      const nameIndex = headers.findIndex(h => h.toLowerCase().includes('name'))
      const phoneIndex = headers.findIndex(h => h.toLowerCase().includes('phone'))
      const emailIndex = headers.findIndex(h => h.toLowerCase().includes('email'))
      
      if (nameIndex === -1 || phoneIndex === -1) {
        toast.error('CSV must have "Name" and "Phone" columns')
        return
      }

      let successCount = 0
      let errorCount = 0

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
        const name = values[nameIndex]
        const phone = values[phoneIndex]
        
        if (!name || !phone) {
          errorCount++
          continue
        }

        const customerData = {
          name,
          phone,
          email: values[emailIndex] || '',
          trn: headers.includes('TRN') ? values[headers.findIndex(h => h.toLowerCase() === 'trn')] || '' : '',
          address: headers.includes('Address') ? values[headers.findIndex(h => h.toLowerCase() === 'address')] || '' : '',
          customerType: headers.includes('Customer Type') ? values[headers.findIndex(h => h.toLowerCase().includes('type'))] || 'Credit' : 'Credit',
          creditLimit: headers.includes('Credit Limit') ? parseFloat(values[headers.findIndex(h => h.toLowerCase().includes('limit'))] || '0') : 0,
          paymentTerms: headers.includes('Payment Terms') ? values[headers.findIndex(h => h.toLowerCase().includes('terms'))] || '' : '',
          branchId: headers.includes('Branch') ? (() => {
            const branchName = values[headers.findIndex(h => h.toLowerCase() === 'branch')] || ''
            return branches.find(b => b.name === branchName)?.id || null
          })() : null,
          routeId: headers.includes('Route') ? (() => {
            const routeName = values[headers.findIndex(h => h.toLowerCase() === 'route')] || ''
            return routes.find(r => r.name === routeName)?.id || null
          })() : null
        }

        try {
          const response = await customersAPI.createCustomer(customerData)
          if (response.success) {
            successCount++
          } else {
            errorCount++
          }
        } catch (error) {
          errorCount++
        }
      }

      toast.success(`Import completed: ${successCount} successful, ${errorCount} failed`)
      await fetchCustomers(1, false)
      event.target.value = '' // Reset file input
    } catch (error) {
      console.error('Failed to import customers:', error)
      toast.error('Failed to import customers')
      event.target.value = ''
    }
  }

  const handleSendStatement = async (customerId) => {
    try {
      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - 30) // Last 30 days
      const toDate = new Date()
      const blob = await customersAPI.getCustomerStatement(customerId, fromDate.toISOString().split('T')[0], toDate.toISOString().split('T')[0])
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `customer_statement_${customerId}_${new Date().toISOString().split('T')[0]}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Statement downloaded successfully')
    } catch (error) {
      console.error('Failed to download statement:', error)
      toast.error('Failed to download statement')
    }
  }

  const handleDelete = (customerId) => {
    const customer = customers.find(c => c.id === customerId)
    const customerName = customer?.name || 'Customer'

    // First check if customer has transactions
    const hasTransactions = (customer?.balance || 0) !== 0

    if (hasTransactions) {
      // Customer has transactions - offer force delete option
      setDangerModal({
        isOpen: true,
        title: 'Force Delete Customer?',
        message: `WARNING: This customer has transactions. Force Delete will permanently delete:
          • Customer: ${customerName}
          • All Sales/Invoices
          • All Payments
          • All Sale Returns
          • Stock will be restored
          
          THIS CANNOT BE UNDONE!`,
        confirmLabel: 'Force Delete Everything',
        requireTypedText: `DELETE ${customerName.toUpperCase()}`,
        onConfirm: () => performDelete(customerId, true, customerName)
      })
    } else {
      // No transactions - regular delete
      setDangerModal({
        isOpen: true,
        title: 'Delete Customer?',
        message: `Are you sure you want to delete "${customerName}"? This action cannot be undone!`,
        confirmLabel: 'Delete Customer',
        onConfirm: () => performDelete(customerId, false, customerName)
      })
    }
  }

  const performDelete = async (customerId, forceDelete, customerName) => {
    try {
      const response = await customersAPI.deleteCustomer(customerId, forceDelete)
      if (response.success) {
        const summary = response.data
        if (forceDelete && summary) {
          toast.success(
            `Customer "${customerName}" and all data deleted!\n` +
            `Deleted: ${summary.salesDeleted} sales, ${summary.paymentsDeleted} payments, ${summary.saleReturnsDeleted} returns.` +
            (summary.stockRestored ? ' Stock restored.' : ''),
            { duration: 5000 }
          )
        } else {
          toast.success('Customer deleted successfully!')
        }
        // Update state directly without full page reload
        setCustomers(prev => prev.filter(c => c.id !== customerId))
        setFilteredCustomers(prev => prev.filter(c => c.id !== customerId))
      } else {
        toast.error(response.message || 'Failed to delete customer')
      }
    } catch (error) {
      console.error('Failed to delete customer:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to delete customer')
    }
  }

  const handleViewLedger = async (customer) => {
    setSelectedCustomer(customer)
    try {
      const response = await customersAPI.getCustomerLedger(customer.id)
      if (response.success) {
        setLedgerData(response.data || [])
      }
      setShowLedgerModal(true)
    } catch (error) {
      if (!error?._handledByInterceptor) toast.error('Failed to load ledger data')
      setShowLedgerModal(true)
    }
  }

  const handleRecalculateBalance = async (customerId) => {
    try {
      toast.loading('Recalculating balance...')
      const response = await customersAPI.recalculateBalance(customerId)
      if (response.success) {
        toast.success('Balance recalculated successfully!')
        fetchCustomers() // Refresh customer list
      } else {
        toast.error(response.message || 'Failed to recalculate balance')
      }
    } catch (error) {
      console.error('Failed to recalculate balance:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to recalculate balance')
    }
  }

  const handleExportStatement = async () => {
    if (!selectedCustomer) return

    try {
      toast.loading('Generating statement PDF...')
      const blob = await customersAPI.getCustomerStatement(selectedCustomer.id)

      // Create download link
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `customer_statement_${selectedCustomer.id}_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)

      toast.success('Statement exported successfully!')
    } catch (error) {
      console.error('Failed to export statement:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to export statement')
    }
  }

  const handleShareWhatsApp = () => {
    const message = `Customer Statement for ${selectedCustomer?.name}\n\nPlease find attached the statement for the period.`
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`
    window.open(whatsappUrl, '_blank')
  }

  const tabs = [
    { id: 'all', label: 'All Customers', icon: Users },
    { id: 'active', label: 'Active', icon: UserPlus },
    { id: 'outstanding', label: 'Outstanding', icon: AlertCircle, badge: customers.filter(c => (c.balance || 0) > 0).length },
    { id: 'inactive', label: 'Inactive', icon: Users }
  ]

  if (loading) {
    return <LoadingCard message="Loading customers..." />
  }

  return (
    <div className="space-y-4 max-w-full overflow-x-hidden">
      {/* Modern Header - Responsive */}
      <div className="bg-white border-b border-gray-200 shadow-sm -mx-6 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="inline-flex items-center justify-center p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Customers</h1>
              <p className="text-xs sm:text-sm text-gray-600 mt-1">Manage customer information and accounts</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button
              onClick={() => fetchCustomers()}
              className="inline-flex items-center px-3 sm:px-4 py-1.5 sm:py-2 border border-gray-300 rounded-lg shadow-sm text-xs sm:text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              Refresh
            </button>
            <button
              onClick={() => {
                reset({ branchId: '', routeId: '', name: '', phone: '', email: '', trn: '', creditLimit: '', customerType: 'retail', paymentTerms: '', address: '' })
                setShowAddModal(true)
              }}
              className="inline-flex items-center px-3 sm:px-4 py-1.5 sm:py-2 border border-transparent rounded-lg shadow-sm text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 min-h-[44px]"
            >
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              Add Customer
            </button>
          </div>
        </div>

        {/* Modern Tabs */}
        <div className="mt-4">
          <TabNavigation
            tabs={tabs}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
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
                placeholder="Search customers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={handleExportCustomers}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </button>
            <button
              onClick={() => document.getElementById('csv-import-input')?.click()}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Inbox className="h-4 w-4 mr-2" />
              Import
            </button>
            <input
              id="csv-import-input"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImportCustomers}
            />
          </div>
        </div>
      </div>

      {/* Customers Table - Responsive */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-4 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-4 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Credit Limit
                </th>
                <th className="px-4 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Balance
                </th>
                <th className="px-4 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Order
                </th>
                <th className="px-4 sm:px-6 py-2 sm:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 sm:px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Inbox className="h-12 w-12 text-gray-400 mb-3" />
                      <p className="text-gray-500 text-sm font-medium">No customers found</p>
                      <p className="text-gray-500 text-xs mt-1">Try adjusting your search or filters. Add customers to start creating invoices from POS or Sales Ledger.</p>
                      <button
                        onClick={() => {
                        reset({ branchId: '', routeId: '', name: '', phone: '', email: '', trn: '', creditLimit: '', customerType: 'retail', paymentTerms: '', address: '' })
                        setShowAddModal(true)
                      }}
                        className="mt-4 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Customer
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50">
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                      <div>
                        <button
                          onClick={() => navigate(`/customers/${customer.id}`, { state: { returnTo: location.pathname + location.search } })}
                          className="text-xs sm:text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {customer.name}
                        </button>
                        <div className="text-xs text-gray-500">{customer.trn}</div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                      <div className="text-xs sm:text-sm text-gray-900">{customer.phone}</div>
                      <div className="text-xs text-gray-500">{customer.email}</div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                      {formatCurrency(customer.creditLimit)}
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                      <span className={`text-xs sm:text-sm font-medium ${customer.balance < 0 ? 'text-green-600' : customer.balance > 0 ? 'text-red-600' : 'text-gray-600'
                        }`}>
                        {formatBalance(customer.balance)}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-gray-900">
                      {customer.lastOrderDate || 'No orders'}
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm font-medium">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <button
                          onClick={() => handleViewLedger(customer)}
                          className="bg-blue-50 text-blue-600 hover:text-white hover:bg-blue-600 border border-blue-300 p-1.5 sm:p-2 rounded transition-colors shadow-sm flex items-center gap-1"
                          title="View Ledger"
                          aria-label="View Ledger"
                        >
                          <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          <span className="hidden sm:inline text-xs font-medium">View</span>
                        </button>
                        <button
                          onClick={() => handleSendStatement(customer.id)}
                          className="bg-green-50 text-green-600 hover:text-white hover:bg-green-600 border border-green-300 p-1.5 sm:p-2 rounded transition-colors shadow-sm flex items-center gap-1"
                          title="Send Statement"
                          aria-label="Send Statement"
                        >
                          <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          <span className="hidden sm:inline text-xs font-medium">Statement</span>
                        </button>
                        <button
                          onClick={() => handleEdit(customer)}
                          className="bg-indigo-50 text-indigo-600 hover:text-white hover:bg-indigo-600 border border-indigo-300 p-1.5 sm:p-2 rounded transition-colors shadow-sm flex items-center gap-1"
                          title="Edit Customer"
                          aria-label="Edit Customer"
                        >
                          <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          <span className="hidden sm:inline text-xs font-medium">Edit</span>
                        </button>
                        {isAdminOrOwner(user) && (
                          <button
                            onClick={() => handleDelete(customer.id)}
                            className="bg-red-50 text-red-600 hover:text-white hover:bg-red-600 border border-red-300 p-1.5 sm:p-2 rounded transition-colors shadow-sm flex items-center gap-1"
                            title="Delete Customer (Admin Only)"
                            aria-label="Delete Customer (Admin Only)"
                          >
                            <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline text-xs font-medium">Delete</span>
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

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-gray-200">
          {filteredCustomers.map((customer) => (
            <div key={customer.id} className="p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <button
                    onClick={() => navigate(`/customers/${customer.id}`, { state: { returnTo: location.pathname + location.search } })}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {customer.name}
                  </button>
                  <div className="text-xs text-gray-500 mt-1">{customer.phone}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleViewLedger(customer)}
                    className="bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-300 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                    title="View Ledger"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    onClick={() => handleSendStatement(customer.id)}
                    className="bg-green-50 text-green-600 hover:bg-green-600 hover:text-white border border-green-300 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                    title="Send Statement"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Statement
                  </button>
                  <button
                    onClick={() => handleEdit(customer)}
                    className="bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white border border-indigo-300 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                    title="Edit Customer"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  {user?.role?.toLowerCase() === 'admin' && (
                    <button
                      onClick={() => handleDelete(customer.id)}
                      className="bg-red-50 text-red-600 hover:text-white hover:bg-red-600 border border-red-300 px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                      title="Delete Customer (Admin Only)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Balance:</span>
                  <span className={`ml-1 font-medium ${customer.balance < 0 ? 'text-green-600' : customer.balance > 0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                    {formatBalance(customer.balance)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Limit:</span>
                  <span className="ml-1">{formatCurrency(customer.creditLimit)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pagination — page size and next/prev to avoid loading thousands at once (#42) */}
      {totalCount > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-700">
                Showing <span className="font-medium">{customers.length}</span> of <span className="font-medium">{totalCount}</span> customers
                {filteredCustomers.length !== customers.length && (
                  <span className="ml-2 text-gray-500">
                    ({filteredCustomers.length} after filters)
                  </span>
                )}
              </span>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                Per page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    Load More ({totalCount - customers.length} remaining)
                  </>
                )}
              </button>
            )}
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchCustomers(1)}
                  disabled={currentPage === 1 || loading}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  First
                </button>
                <button
                  onClick={() => fetchCustomers(currentPage - 1)}
                  disabled={currentPage === 1 || loading}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => fetchCustomers(currentPage + 1)}
                  disabled={currentPage >= totalPages || loading}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
                <button
                  onClick={() => fetchCustomers(totalPages)}
                  disabled={currentPage >= totalPages || loading}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Last
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          reset()
          setSaving(false)
        }}
        title="Add New Customer"
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Customer Name"
              placeholder="ABC Restaurant"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Customer name is required' })}
            />

            <Input
              label="Phone Number"
              placeholder="+971 50 123 4567"
              required
              error={errors.phone?.message}
              {...register('phone', { required: 'Phone number is required' })}
            />

            <Input
              label="Email Address"
              type="email"
              placeholder="info@abcrestaurant.com"
              error={errors.email?.message}
              {...register('email', { validate: (v) => !v || validateEmail(v) ? true : 'Enter a valid email address' })}
            />

            <Input
              label="TRN Number"
              placeholder="TRN123456789"
              error={errors.trn?.message}
              {...register('trn')}
            />

            <Input
              label="Credit Limit"
              type="number"
              placeholder="50000"
              error={errors.creditLimit?.message}
              {...register('creditLimit', {
                valueAsNumber: true,
                min: { value: 0, message: 'Credit limit must be positive' }
              })}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Type</label>
              <select
                {...register('customerType')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="Credit">Credit (Can have outstanding balance)</option>
                <option value="Cash">Cash (Must pay immediately)</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">Credit customers can have outstanding balance, Cash customers must pay immediately</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
              <select
                {...register('paymentTerms')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select payment terms</option>
                <option value="Cash on Delivery">Cash on Delivery</option>
                <option value="Net 7">Net 7</option>
                <option value="Net 15">Net 15</option>
                <option value="Net 30">Net 30</option>
                <option value="Net 60">Net 60</option>
                <option value="Net 90">Net 90</option>
                <option value="Custom">Custom</option>
              </select>
              <p className="mt-1 text-xs text-amber-600">Required when Credit Limit &gt; 0</p>
            </div>

            {/* Branch and Route (PRODUCTION_MASTER_TODO #10) */}
            {branches.length > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                  <select
                    className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.branchId ? 'border-red-500' : 'border-gray-300'}`}
                    {...register('branchId', {
                      onChange: (e) => {
                        setValue('branchId', e.target.value)
                        setValue('routeId', '')
                      }
                    })}
                  >
                    <option value="">Select branch (optional)</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Route</label>
                  <select
                    className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${errors.routeId ? 'border-red-500' : 'border-gray-300'}`}
                    {...register('routeId')}
                    disabled={!selectedBranchId}
                  >
                    <option value="">
                      {selectedBranchId ? 'Select route (optional)' : 'Select branch first'}
                    </option>
                    {(selectedBranchId ? routes.filter(r => r.branchId === parseInt(selectedBranchId, 10)) : []).map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="md:col-span-2">
              <TextArea
                label="Address"
                placeholder="Dubai Marina, Dubai, UAE"
                rows={3}
                error={errors.address?.message}
                {...register('address')}
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setShowAddModal(false)
                reset()
              }}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <LoadingButton type="submit" loading={saving}>
              Add Customer
            </LoadingButton>
          </div>
        </form>
      </Modal>

      {/* Duplicate phone/email confirm */}
      {duplicateConfirm.isOpen && (
        <Modal
          isOpen
          title="Duplicate phone or email"
          onClose={() => setDuplicateConfirm({ isOpen: false, data: null, existingName: '' })}
        >
          <p className="text-sm text-gray-600 mb-4">
            A customer named <strong>{duplicateConfirm.existingName}</strong> already has this phone number or email. Add anyway?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDuplicateConfirm({ isOpen: false, data: null, existingName: '' })}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDuplicateConfirmAdd}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add anyway'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Customer Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false)
          setSelectedCustomer(null)
          reset()
          setSaving(false)
        }}
        title="Edit Customer"
        size="lg"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Customer Name"
              placeholder="ABC Restaurant"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Customer name is required' })}
            />

            <Input
              label="Phone Number"
              placeholder="+971 50 123 4567"
              required
              error={errors.phone?.message}
              {...register('phone', { required: 'Phone number is required' })}
            />

            <Input
              label="Email Address"
              type="email"
              placeholder="info@abcrestaurant.com"
              error={errors.email?.message}
              {...register('email', { validate: (v) => !v || validateEmail(v) ? true : 'Enter a valid email address' })}
            />

            <Input
              label="TRN Number"
              placeholder="TRN123456789"
              error={errors.trn?.message}
              {...register('trn')}
            />

            <Input
              label="Credit Limit"
              type="number"
              placeholder="50000"
              error={errors.creditLimit?.message}
              {...register('creditLimit', {
                valueAsNumber: true,
                min: { value: 0, message: 'Credit limit must be positive' }
              })}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Type</label>
              <select
                {...register('customerType')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="Credit">Credit (Can have outstanding balance)</option>
                <option value="Cash">Cash (Must pay immediately)</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">Credit customers can have outstanding balance, Cash customers must pay immediately</p>
            </div>

            <div className="md:col-span-2">
              <TextArea
                label="Address"
                placeholder="Dubai Marina, Dubai, UAE"
                rows={3}
                error={errors.address?.message}
                {...register('address')}
              />
            </div>

            {/* Branch and Route Assignment */}
            {branches.length > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Branch {branches.length > 0 && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${errors.branchId ? 'border-red-500' : 'border-gray-300'}`}
                    {...register('branchId', {
                      required: branches.length > 0 ? 'Branch is required when company has branches' : false,
                      onChange: (e) => {
                        setValue('branchId', e.target.value)
                        setValue('routeId', '') // Clear route when branch changes
                      }
                    })}
                  >
                    <option value="">Select branch</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  {errors.branchId && (
                    <p className="mt-1 text-sm text-red-600">{errors.branchId.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Route {selectedBranchId && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${errors.routeId ? 'border-red-500' : 'border-gray-300'}`}
                    {...register('routeId', {
                      required: selectedBranchId ? 'Route is required when branch is selected' : false
                    })}
                    disabled={!selectedBranchId}
                  >
                    <option value="">
                      {selectedBranchId ? 'Select route' : 'Select branch first'}
                    </option>
                    {(selectedBranchId ? routes.filter(r => r.branchId === parseInt(selectedBranchId, 10)) : []).map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  {errors.routeId && (
                    <p className="mt-1 text-sm text-red-600">{errors.routeId.message}</p>
                  )}
                </div>
              </>
            )}

            {/* Payment Terms */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
              <select
                {...register('paymentTerms')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select payment terms</option>
                <option value="Cash on Delivery">Cash on Delivery</option>
                <option value="Net 7">Net 7</option>
                <option value="Net 15">Net 15</option>
                <option value="Net 30">Net 30</option>
                <option value="Net 60">Net 60</option>
                <option value="Net 90">Net 90</option>
                <option value="Custom">Custom</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">Required when credit limit &gt; 0</p>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setShowEditModal(false)
                setSelectedCustomer(null)
                reset()
              }}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <LoadingButton type="submit" loading={saving}>
              Update Customer
            </LoadingButton>
          </div>
        </form>
      </Modal>

      {/* Customer Ledger Modal */}
      <Modal
        isOpen={showLedgerModal}
        onClose={() => {
          setShowLedgerModal(false)
          setSelectedCustomer(null)
        }}
        title={`Customer Ledger - ${selectedCustomer?.name}`}
        size="xl"
        allowFullscreen={true}
      >
        <div className="space-y-6">
          {/* Customer Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-500">Current Balance</p>
                <p className={`text-lg font-semibold ${selectedCustomer?.balance < 0 ? 'text-green-600' : selectedCustomer?.balance > 0 ? 'text-red-600' : 'text-gray-600'
                  }`}>
                  {formatBalance(selectedCustomer?.balance || 0)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Credit Limit</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatCurrency(selectedCustomer?.creditLimit || 0)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Available Credit</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatCurrency((selectedCustomer?.creditLimit || 0) - (selectedCustomer?.balance || 0))}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex justify-end gap-2 mb-4">
            <button
              onClick={() => {
                // Use React Router navigation instead of full page reload
                navigate(`/ledger?customerId=${selectedCustomer?.id}`, { state: { returnTo: location.pathname + location.search } })
                setShowLedgerModal(false)
              }}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <CreditCard className="h-4 w-4 mr-2" />
              Open Ledger
            </button>
          </div>

          {/* Ledger Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reference
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Debit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Credit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {ledgerData.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-8 text-center text-gray-500 text-sm">
                      No transactions found
                    </td>
                  </tr>
                ) : (
                  ledgerData.map((entry, idx) => (
                    <tr key={idx}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(entry.date).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.reference}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.debit > 0 ? formatCurrency(entry.debit) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.credit > 0 ? formatCurrency(entry.credit) : '-'}
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${entry.balance < 0 ? 'text-green-600' : entry.balance > 0 ? 'text-red-600' : 'text-gray-900'
                        }`}>
                        {formatBalance(entry.balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3">
            <button
              onClick={handleShareWhatsApp}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <Phone className="h-4 w-4 mr-2" />
              Share via WhatsApp
            </button>
            <button
              onClick={handleExportStatement}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Download className="h-4 w-4 mr-2" />
              Export Statement
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDangerModal
        isOpen={dangerModal.isOpen}
        title={dangerModal.title}
        message={dangerModal.message}
        confirmLabel={dangerModal.confirmLabel}
        requireTypedText={dangerModal.requireTypedText}
        onConfirm={dangerModal.onConfirm}
        onClose={() => setDangerModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}

export default CustomersPage
