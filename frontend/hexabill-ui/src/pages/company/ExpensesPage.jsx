import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import {
  Plus,
  Search,
  Filter,
  RefreshCw,
  DollarSign,
  Calendar,
  Tag,
  Edit,
  Trash2,
  TrendingDown,
  PieChart,
  X,
  Save,
  Upload,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Repeat,
  Download,
  Eye
} from 'lucide-react'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import { showToast } from '../../utils/toast'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'
import { LoadingCard, LoadingButton } from '../../components/Loading'
import { Input, Select, TextArea } from '../../components/Form'
import Modal from '../../components/Modal'
import { expensesAPI } from '../../services'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip
} from 'recharts'

const ExpensesPage = () => {
  const { user } = useAuth()
  const { branches, routes } = useBranchesRoutes()
  const [loading, setLoading] = useState(true)
  const [expenses, setExpenses] = useState([])
  const [filteredExpenses, setFilteredExpenses] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [expenseSummary, setExpenseSummary] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  })
  const [groupBy, setGroupBy] = useState('') // '', 'weekly', 'monthly', 'yearly'
  const [showAggregated, setShowAggregated] = useState(false)
  const [aggregatedData, setAggregatedData] = useState([])
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

  const [categories, setCategories] = useState([])
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [attachmentFile, setAttachmentFile] = useState(null)
  const [attachmentPreview, setAttachmentPreview] = useState(null)
  const [showRecurringModal, setShowRecurringModal] = useState(false)
  const [recurringExpenses, setRecurringExpenses] = useState([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors }
  } = useForm()

  const watchedBranchId = watch('branchId')

  const fetchCategories = useCallback(async () => {
    try {
      const response = await expensesAPI.getExpenseCategories()
      if (response?.success && response?.data && Array.isArray(response.data)) {
        const categoryOptions = response.data.map(cat => ({
          value: cat.id,
          label: cat.name,
          color: cat.colorCode
        }))
        setCategories(categoryOptions)
      } else {
        setCategories([])
      }
    } catch (error) {
      console.error('Failed to load categories:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to load expense categories')
      setCategories([])
    }
  }, [])


  const fetchExpenses = useCallback(async () => {
    try {
      setLoading(true)
      const params = {
        page: currentPage,
        pageSize: 10,
        fromDate: dateRange.from,
        toDate: dateRange.to
      }

      // Fetch aggregated view if enabled
      if (showAggregated && groupBy) {
        try {
          const aggResponse = await expensesAPI.getExpensesAggregated({
            fromDate: dateRange.from,
            toDate: dateRange.to,
            groupBy: groupBy
          })
          if (aggResponse?.success && aggResponse?.data) {
            setAggregatedData(aggResponse.data)
          } else {
            // Handle case where no data is returned
            setAggregatedData([])
            if (aggResponse?.message) {
              console.warn('Aggregated expenses warning:', aggResponse.message)
            }
          }
        } catch (error) {
          console.error('Error loading aggregated expenses:', error)
          const errorMessage = error?.response?.data?.message || error?.message || 'Failed to load aggregated expenses'
          if (!error?._handledByInterceptor) toast.error(errorMessage)
          setAggregatedData([])
          // Don't fail the entire fetch if aggregated view fails
        }
      }

      const response = await expensesAPI.getExpenses(params)
      if (response?.success && response?.data) {
        const expenseList = response.data.items || []
        setExpenses(expenseList)
        setFilteredExpenses(expenseList)
        setTotalPages(response.data.totalPages || 1)

        const total = expenseList.reduce((sum, expense) => sum + (expense.amount || 0), 0)
        const categoryTotals = expenseList.reduce((acc, expense) => {
          const cat = expense.categoryName || 'Other'
          acc[cat] = (acc[cat] || 0) + (expense.amount || 0)
          return acc
        }, {})

        setExpenseSummary({
          total,
          categoryTotals,
          averagePerDay: total / 30,
          topCategory: Object.keys(categoryTotals).length > 0
            ? Object.keys(categoryTotals).reduce((a, b) =>
              categoryTotals[a] > categoryTotals[b] ? a : b
            )
            : 'N/A'
        })
      } else {
        setExpenses([])
        setFilteredExpenses([])
        setTotalPages(1)
        setExpenseSummary(null)
      }
    } catch (error) {
      console.error('Error loading expenses:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to load expenses')
      setExpenses([])
      setFilteredExpenses([])
      setExpenseSummary(null)
    } finally {
      setLoading(false)
    }
  }, [currentPage, dateRange, showAggregated, groupBy])

  const filterExpenses = useCallback(() => {
    if (!searchTerm) {
      setFilteredExpenses(expenses)
      return
    }

    const filtered = expenses.filter(expense =>
      expense.categoryName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      expense.note?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    setFilteredExpenses(filtered)
  }, [expenses, searchTerm])

  const handleExportCsv = async () => {
    try {
      setExportingCsv(true)
      const params = {
        fromDate: dateRange.from,
        toDate: dateRange.to
      }
      if (selectedBranchId) params.branchId = selectedBranchId
      const blob = await expensesAPI.exportCsv(params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `expenses_${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('CSV downloaded')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to export CSV')
    } finally {
      setExportingCsv(false)
    }
  }

  // Auto-select branch if only 1 for staff (branches/routes from shared context)
  useEffect(() => {
    if (user && !isAdminOrOwner(user) && branches?.length === 1) {
      setSelectedBranchId(String(branches[0].id))
      setValue('branchId', branches[0].id)
    }
  }, [user, branches, setValue])

  // Filter routes when branch changes
  useEffect(() => {
    if (watchedBranchId) {
      const branchId = parseInt(watchedBranchId, 10)
      setSelectedBranchId(watchedBranchId)
      // Routes will be filtered in the dropdown based on selectedBranchId
    } else {
      setSelectedBranchId('')
    }
  }, [watchedBranchId])

  // Load recurring expenses for owners/admins
  useEffect(() => {
    const loadRecurringExpenses = async () => {
      if (isAdminOrOwner(user)) {
        try {
          const response = await expensesAPI.getRecurringExpenses()
          if (response?.success && response?.data) {
            setRecurringExpenses(response.data)
          }
        } catch (error) {
          console.error('Failed to load recurring expenses:', error)
        }
      }
    }
    loadRecurringExpenses()
  }, [user])

  useEffect(() => {
    fetchCategories()
    fetchExpenses()
  }, [fetchCategories, fetchExpenses])

  useEffect(() => {
    filterExpenses()
  }, [filterExpenses])

  const onSubmit = async (data) => {
    try {
      const expenseDate = data.date ? new Date(data.date).toISOString() : new Date().toISOString()

      if (selectedExpense) {
        const response = await expensesAPI.updateExpense(selectedExpense.id, {
          branchId: data.branchId ? parseInt(data.branchId, 10) : null,
          categoryId: parseInt(data.category),
          amount: parseFloat(data.amount),
          date: expenseDate,
          note: data.note || ''
        })

        if (response?.success) {
          toast.success('Expense updated successfully!', { id: 'expense-update', duration: 4000 })
        } else {
          toast.error(response?.message || 'Failed to update expense', { id: 'expense-update' })
          return
        }
      } else {
        const response = await expensesAPI.createExpense({
          branchId: data.branchId ? parseInt(data.branchId, 10) : null,
          routeId: data.routeId ? parseInt(data.routeId, 10) : null,
          categoryId: parseInt(data.category),
          amount: parseFloat(data.amount),
          date: expenseDate,
          note: data.note || '',
          attachmentUrl: null, // Will be uploaded after creation
          recurringExpenseId: data.recurringExpenseId ? parseInt(data.recurringExpenseId, 10) : null
        })
        
        // Upload attachment after expense creation
        if (attachmentFile && response?.success && response?.data?.id) {
          setUploadingAttachment(true)
          try {
            const uploadResponse = await expensesAPI.uploadAttachment(response.data.id, attachmentFile)
            if (uploadResponse?.success) {
              // Update expense with attachment URL
              await expensesAPI.updateExpense(response.data.id, {
                branchId: data.branchId ? parseInt(data.branchId, 10) : null,
                routeId: data.routeId ? parseInt(data.routeId, 10) : null,
                categoryId: parseInt(data.category),
                amount: parseFloat(data.amount),
                date: expenseDate,
                note: data.note || '',
                attachmentUrl: uploadResponse.data,
                recurringExpenseId: data.recurringExpenseId ? parseInt(data.recurringExpenseId, 10) : null
              })
            }
          } catch (error) {
            console.error('Failed to upload attachment:', error)
            toast.error('Expense created but attachment upload failed')
          } finally {
            setUploadingAttachment(false)
          }
        }

        if (response?.success) {
          toast.success('Expense added successfully!', { id: 'expense-add', duration: 4000 })
        } else {
          toast.error(response?.message || 'Failed to create expense', { id: 'expense-add' })
          return
        }
      }

      reset()
      setShowAddModal(false)
      setShowEditModal(false)
      setSelectedExpense(null)
      setAttachmentFile(null)
      setAttachmentPreview(null)
      setCurrentPage(1)
      fetchExpenses()
    } catch (error) {
      console.error('Error saving expense:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to save expense')
    }
  }

  const handleEdit = (expense) => {
    setSelectedExpense(expense)
    setValue('category', expense.categoryId || '')
    setValue('amount', expense.amount || 0)
    setValue('branchId', expense.branchId ? String(expense.branchId) : '')
    setValue('routeId', expense.routeId ? String(expense.routeId) : '')
    setValue('recurringExpenseId', expense.recurringExpenseId ? String(expense.recurringExpenseId) : '')
    const expenseDate = expense.date
      ? new Date(expense.date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
    setValue('date', expenseDate)
    setValue('note', expense.note || '')
    setAttachmentPreview(expense.attachmentUrl ? `/uploads/${expense.attachmentUrl}` : null)
    setShowEditModal(true)
  }
  
  const handleAttachmentChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf']
      if (!allowedTypes.includes(file.type)) {
        toast.error('Invalid file type. Allowed: JPG, PNG, GIF, PDF')
        return
      }
      
      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        toast.error('File size too large. Maximum 10MB allowed.')
        return
      }
      
      setAttachmentFile(file)
      
      // Create preview for images
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onloadend = () => {
          setAttachmentPreview(reader.result)
        }
        reader.readAsDataURL(file)
      } else {
        setAttachmentPreview(null)
      }
    }
  }
  
  const handleApproveExpense = async (expenseId) => {
    try {
      const response = await expensesAPI.approveExpense(expenseId)
      if (response?.success) {
        toast.success('Expense approved successfully!')
        fetchExpenses()
      } else {
        toast.error(response?.message || 'Failed to approve expense')
      }
    } catch (error) {
      console.error('Failed to approve expense:', error)
      toast.error(error?.response?.data?.message || 'Failed to approve expense')
    }
  }
  
  const handleRejectExpense = async (expenseId) => {
    setDangerModal({
      isOpen: true,
      title: 'Reject Expense',
      message: 'Please provide a reason for rejecting this expense:',
      confirmLabel: 'Reject Expense',
      showInput: true,
      inputPlaceholder: 'Rejection reason',
      defaultValue: '',
      onConfirm: async (reason) => {
        try {
          const response = await expensesAPI.rejectExpense(expenseId, reason)
          if (response?.success) {
            toast.success('Expense rejected successfully!')
            fetchExpenses()
          } else {
            toast.error(response?.message || 'Failed to reject expense')
          }
        } catch (error) {
          console.error('Failed to reject expense:', error)
          toast.error(error?.response?.data?.message || 'Failed to reject expense')
        }
      }
    })
  }
  
  const handleDownloadAttachment = (expense) => {
    if (expense.attachmentUrl) {
      const url = `/uploads/${expense.attachmentUrl}`
      window.open(url, '_blank')
    }
  }
  
  const getStatusIcon = (status) => {
    switch (status?.toLowerCase()) {
      case 'approved':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'rejected':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />
      default:
        return <CheckCircle className="h-4 w-4 text-green-500" />
    }
  }
  
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'approved':
        return 'bg-green-100 text-green-800'
      case 'rejected':
        return 'bg-red-100 text-red-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-green-100 text-green-800'
    }
  }

  const handleDelete = (expenseId) => {
    const expense = expenses.find(e => e.id === expenseId)
    setDangerModal({
      isOpen: true,
      title: 'Delete Expense?',
      message: `Are you sure you want to delete this ${expense?.categoryName || ''} expense of ${formatCurrency(expense?.amount || 0)}?`,
      confirmLabel: 'Delete Expense',
      onConfirm: async () => {
        try {
          const response = await expensesAPI.deleteExpense(expenseId)

          if (response?.success) {
            toast.success('Expense deleted successfully!', { id: 'expense-delete', duration: 4000 })
            fetchExpenses()
          } else {
            toast.error(response?.message || 'Failed to delete expense', { id: 'expense-delete' })
          }
        } catch (error) {
          console.error('Error deleting expense:', error)
          toast.error(error?.response?.data?.message || 'Failed to delete expense')
        }
      }
    })
  }

  const getCategoryColor = (category) => {
    const colors = {
      'Rent': '#EF4444',
      'Utilities': '#F59E0B',
      'Staff Salary': '#10B981',
      'Marketing': '#3B82F6',
      'Fuel': '#8B5CF6',
      'Delivery': '#F97316',
      'Meals': '#EC4899',
      'Maintenance': '#6B7280',
      'Insurance': '#14B8A6',
      'Other': '#84CC16'
    }
    return colors[category] || '#6B7280'
  }

  const chartData = expenseSummary ? Object.entries(expenseSummary.categoryTotals).map(([category, amount]) => ({
    name: category,
    value: amount,
    color: getCategoryColor(category)
  })) : []

  const handleCreateCategory = async (categoryName) => {
    if (!categoryName || !categoryName.trim()) {
      toast.error('Category name is required')
      return
    }

    try {
      setCreatingCategory(true)
      const response = await expensesAPI.createCategory({
        name: categoryName.trim(),
        colorCode: '#3B82F6'
      })
      if (response?.success) {
        toast.success('Category created successfully!', { id: 'category-add', duration: 4000 })
        await fetchCategories()
        setValue('category', response.data.id.toString())
      } else {
        toast.error(response?.message || 'Failed to create category')
      }
    } catch (error) {
      console.error('Error creating category:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to create category')
    } finally {
      setCreatingCategory(false)
    }
  }

  const openCategoryPrompt = () => {
    setDangerModal({
      isOpen: true,
      title: 'New Expense Category',
      message: 'Enter the name for the new expense category:',
      confirmLabel: 'Create Category',
      showInput: true,
      inputPlaceholder: 'Category Name',
      defaultValue: '',
      onConfirm: (val) => handleCreateCategory(val)
    })
  }

  if (loading) {
    return <LoadingCard message="Loading expenses..." />
  }

  // TALLY ERP LEDGER STYLE
  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Top Bar - Mobile Responsive */}
      <div className="bg-white border-b border-neutral-200 px-2 sm:px-4 py-2">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Expenses Ledger</h1>
            <div className="text-xs text-gray-600">Date: {new Date().toLocaleDateString('en-GB')}</div>
            {user && !isAdminOrOwner(user) && (
              <p className="text-xs text-blue-700 mt-0.5">Totals and list are for your assigned branch(es).</p>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={fetchExpenses}
              className="px-2 sm:px-3 py-1 text-xs font-medium bg-white border border-blue-300 rounded hover:bg-blue-50 flex items-center justify-center flex-1 sm:flex-none"
            >
              <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-1" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exportingCsv}
              className="px-2 sm:px-3 py-1 text-xs font-medium bg-white border border-green-300 rounded hover:bg-green-50 flex items-center justify-center flex-1 sm:flex-none disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-1" />
              <span className="hidden sm:inline">{exportingCsv ? 'Exporting…' : 'Export CSV'}</span>
              <span className="sm:hidden">{exportingCsv ? '…' : 'CSV'}</span>
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700 flex items-center justify-center text-xs sm:text-sm flex-1 sm:flex-none min-h-[44px]"
            >
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">Add Expense</span>
              <span className="sm:hidden">Add</span>
            </button>
            {isAdminOrOwner(user) && (
              <button
                onClick={() => setShowRecurringModal(true)}
                className="px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 bg-purple-600 text-white rounded font-medium hover:bg-purple-700 flex items-center justify-center text-xs sm:text-sm flex-1 sm:flex-none min-h-[44px]"
                title="Manage recurring expenses"
              >
                <Repeat className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Recurring</span>
                <span className="sm:hidden">Repeat</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-2 sm:p-4">
        {/* Filters */}
        <div className="bg-white rounded-xl border border-neutral-200 p-3 sm:p-4 mb-4">
          <div className="flex items-center mb-3">
            <Filter className="h-4 w-4 text-blue-600 mr-2" />
            <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
          </div>

          {/* Date Range Presets */}
          <div className="mb-3 flex flex-wrap gap-2">
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
                from.setDate(from.getDate() - from.getDay()) // Start of week
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <div className="flex items-end gap-2">
              <Select
                label="Group By"
                options={[
                  { value: '', label: 'None' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'yearly', label: 'Yearly' }
                ]}
                value={groupBy}
                onChange={(e) => {
                  setGroupBy(e.target.value)
                  setShowAggregated(e.target.value !== '')
                }}
              />
            </div>
          </div>
        </div>

        {/* Summary Cards - Mobile Responsive */}
        {expenseSummary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="bg-white rounded-xl border border-neutral-200 p-3 sm:p-4">
              <div className="flex items-center">
                <TrendingDown className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-red-600 flex-shrink-0" />
                <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-red-600">Total Expenses</p>
                  <p className="text-base sm:text-xl lg:text-2xl font-bold text-red-900 truncate">
                    {formatCurrency(expenseSummary.total)}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-3 sm:p-4">
              <div className="flex items-center">
                <Calendar className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-blue-600 flex-shrink-0" />
                <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-blue-600">Average per Day</p>
                  <p className="text-base sm:text-xl lg:text-2xl font-bold text-blue-900 truncate">
                    {formatCurrency(expenseSummary.averagePerDay)}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-3 sm:p-4">
              <div className="flex items-center">
                <Tag className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-green-600 flex-shrink-0" />
                <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-green-600">Top Category</p>
                  <p className="text-base sm:text-xl lg:text-2xl font-bold text-green-900 truncate">
                    {expenseSummary.topCategory}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chart - Tally Style */}
        {chartData.length > 0 && (
          <div className="bg-white rounded-xl border border-neutral-200 p-4 mb-6">
            <div className="flex items-center mb-4 border-b border-neutral-200 pb-2">
              <PieChart className="h-6 w-6 text-blue-600 mr-2" />
              <h3 className="text-lg font-semibold text-gray-900">Expense Breakdown</h3>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Search and Filters - Tally Style */}
        <div className="bg-white rounded-xl border border-neutral-200 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search expenses..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full border border-neutral-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Aggregated View */}
        {showAggregated && aggregatedData.length > 0 && (
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden mb-6">
            <div className="p-3 border-b border-neutral-200 bg-neutral-50">
              <h3 className="text-sm font-bold text-gray-900">
                Expenses Aggregated by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
              </h3>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Period</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700 border-r border-neutral-200">Total Amount</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-neutral-200">Count</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">By Category</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {aggregatedData.map((agg, idx) => (
                    <tr key={idx} className="hover:bg-neutral-50">
                      <td className="px-4 py-4 whitespace-nowrap font-medium text-gray-900">
                        {agg.period}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right font-bold text-gray-900">
                        {formatCurrency(agg.totalAmount || 0)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-center text-gray-600">
                        {agg.count || 0}
                      </td>
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          {agg.byCategory && agg.byCategory.length > 0 ? (
                            agg.byCategory.map((cat, catIdx) => (
                              <div key={catIdx} className="flex justify-between text-xs">
                                <span className="text-gray-700">{cat.categoryName}:</span>
                                <span className="font-medium text-gray-900 ml-2">
                                  {formatCurrency(cat.totalAmount || 0)} ({cat.count || 0})
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="text-gray-500 text-xs">No categories</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3 p-4">
              {aggregatedData.map((agg, idx) => (
                <div key={idx} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{agg.period}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{agg.count || 0} expense{agg.count !== 1 ? 's' : ''}</p>
                    </div>
                    <p className="text-base font-bold text-red-600">{formatCurrency(agg.totalAmount || 0)}</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-700 mb-2">By Category:</p>
                    <div className="space-y-1">
                      {agg.byCategory && agg.byCategory.length > 0 ? (
                        agg.byCategory.map((cat, catIdx) => (
                          <div key={catIdx} className="flex justify-between text-xs">
                            <span className="text-gray-600">{cat.categoryName}:</span>
                            <span className="font-medium text-gray-900">
                              {formatCurrency(cat.totalAmount || 0)} ({cat.count || 0})
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-gray-500 text-xs">No categories</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expenses Table - Tally Ledger Style */}
        {!showAggregated && (
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="p-3 border-b border-neutral-200 bg-neutral-50">
              <h3 className="text-sm font-bold text-gray-900">Expenses Ledger</h3>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Category</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Branch</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Route</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700 border-r border-neutral-200">Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Note</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-6 py-8 text-center text-gray-500">
                        {user && !isAdminOrOwner(user)
                          ? 'No expenses in your assigned branch(es) for this period.'
                          : 'No expenses found'}
                      </td>
                    </tr>
                  ) : (
                    filteredExpenses.map((expense) => (
                      <tr key={expense.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div
                              className="w-3 h-3 rounded-full mr-3"
                              style={{ backgroundColor: expense.categoryColor || '#6B7280' }}
                            />
                            <span className="font-medium text-gray-900">{expense.categoryName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-r border-neutral-200">
                          {expense.branchName || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-r border-neutral-200">
                          {expense.routeName || '-'}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right font-medium text-gray-900">
                          {formatCurrency(expense.amount)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-gray-900">
                          {expense.date ? new Date(expense.date).toLocaleDateString('en-GB') : '-'}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            {getStatusIcon(expense.status)}
                            <span className={`ml-2 inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(expense.status)}`}>
                              {expense.status || 'Approved'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-gray-900">
                          {expense.note || '-'}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-center space-x-2">
                          {expense.attachmentUrl && (
                            <button
                              onClick={() => handleDownloadAttachment(expense)}
                              className="text-blue-600 hover:text-blue-900"
                              title="View Receipt"
                            >
                              <FileText className="h-4 w-4" />
                            </button>
                          )}
                          {isAdminOrOwner(user) && expense.status === 'Pending' && (
                            <>
                              <button
                                onClick={() => handleApproveExpense(expense.id)}
                                className="text-green-600 hover:text-green-900"
                                title="Approve"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleRejectExpense(expense.id)}
                                className="text-red-600 hover:text-red-900"
                                title="Reject"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {isAdminOrOwner(user) && (
                            <>
                              <button
                                onClick={() => handleEdit(expense)}
                                className="text-indigo-600 hover:text-indigo-900"
                                title="Edit expense"
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(expense.id)}
                                className="text-red-600 hover:text-red-900"
                                title="Delete expense"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3 p-4">
              {filteredExpenses.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {user && !isAdminOrOwner(user)
                    ? 'No expenses in your assigned branch(es) for this period.'
                    : 'No expenses found'}
                </div>
              ) : (
                filteredExpenses.map((expense) => (
                  <div key={expense.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center mb-1">
                          <div
                            className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
                            style={{ backgroundColor: expense.categoryColor || '#6B7280' }}
                          />
                          <p className="text-sm font-semibold text-gray-900">{expense.categoryName || 'Uncategorized'}</p>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{expense.note || 'No description'}</p>
                        {(expense.branchName || expense.routeName) && (
                          <p className="text-xs text-blue-600 mt-1">
                            {expense.branchName && `Branch: ${expense.branchName}`}
                            {expense.branchName && expense.routeName && ' · '}
                            {expense.routeName && `Route: ${expense.routeName}`}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {expense.status === 'Approved' && <CheckCircle className="h-3 w-3 text-green-500" />}
                          {expense.status === 'Rejected' && <XCircle className="h-3 w-3 text-red-500" />}
                          {expense.status === 'Pending' && <Clock className="h-3 w-3 text-yellow-500" />}
                          <span className={`text-xs font-semibold ${
                            expense.status === 'Approved' ? 'text-green-700' :
                            expense.status === 'Rejected' ? 'text-red-700' :
                            'text-yellow-700'
                          }`}>
                            {expense.status || 'Approved'}
                          </span>
                          {expense.attachmentUrl && (
                            <button
                              onClick={() => handleDownloadAttachment(expense)}
                              className="text-blue-600 hover:text-blue-900"
                              title="View receipt"
                            >
                              <FileText className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-base font-bold text-red-600 ml-2">{formatCurrency(expense.amount)}</p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mt-3 pt-3 border-t border-gray-200">
                      <div className="flex items-center gap-3">
                        <span>{expense.date ? new Date(expense.date).toLocaleDateString('en-GB') : '-'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isAdminOrOwner(user) && expense.status === 'Pending' && (
                          <>
                            <button
                              onClick={() => handleApproveExpense(expense.id)}
                              className="text-green-600 hover:text-green-900 p-1"
                              title="Approve"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleRejectExpense(expense.id)}
                              className="text-red-600 hover:text-red-900 p-1"
                              title="Reject"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {isAdminOrOwner(user) && (
                          <>
                            <button
                              onClick={() => handleEdit(expense)}
                              className="text-indigo-600 hover:text-indigo-900 p-1"
                              title="Edit expense"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(expense.id)}
                              className="text-red-600 hover:text-red-900 p-1"
                              title="Delete expense"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center mt-4 pb-4">
                <div className="flex space-x-2">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 border border-neutral-200 rounded-lg text-xs disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="flex items-center px-4 text-xs">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 border border-neutral-200 rounded-lg text-xs disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Expense Modal - Tally Style */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          reset()
        }}
        title="Add New Expense"
        size="md"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Category <span className="text-red-500">*</span>
                </label>
                {isAdminOrOwner(user) && (
                  <button
                    type="button"
                    onClick={openCategoryPrompt}
                    disabled={creatingCategory}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 disabled:opacity-50"
                    title="Create new category"
                  >
                    <Plus className="h-3 w-3" />
                    {creatingCategory ? 'Creating...' : 'New Category'}
                  </button>
                )}
              </div>
              <Select
                options={categories}
                required
                error={errors.category?.message}
                {...register('category', { required: 'Category is required' })}
              />
            </div>

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
              label="Date"
              type="date"
              required
              error={errors.date?.message}
              {...register('date', { required: 'Date is required' })}
            />

            {/* BRANCH/ROUTE ASSIGNMENT FIX: Add Branch and Route dropdowns */}
            <Select
              label="Branch (Optional)"
              options={[
                { value: '', label: 'Company Level (No Branch)' },
                ...branches.map(branch => ({
                  value: branch.id,
                  label: branch.name
                }))
              ]}
              error={errors.branchId?.message}
              {...register('branchId', {
                onChange: (e) => {
                  setValue('branchId', e.target.value)
                  setValue('routeId', '')
                }
              })}
            />
            {branches.length > 0 && (
              <Select
                label="Route (Optional)"
                options={[
                  { value: '', label: watchedBranchId ? 'Select route' : 'Select branch first' },
                  ...(watchedBranchId ? routes.filter(r => r.branchId === parseInt(watchedBranchId, 10)) : []).map(r => ({
                    value: r.id,
                    label: r.name
                  }))
                ]}
                error={errors.routeId?.message}
                {...register('routeId')}
              />
            )}

            <TextArea
              label="Note"
              placeholder="Expense description..."
              rows={3}
              error={errors.note?.message}
              {...register('note')}
            />

            {/* ATTACHMENT FIX: Add receipt/attachment upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Receipt/Attachment (Optional)
              </label>
              <div className="mt-1 flex items-center gap-3">
                <label className="cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                  <Upload className="h-4 w-4 mr-2" />
                  {attachmentFile ? attachmentFile.name : 'Choose File'}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf"
                    onChange={handleAttachmentChange}
                  />
                </label>
                {attachmentPreview && (
                  <div className="flex items-center gap-2">
                    {attachmentFile?.type?.startsWith('image/') ? (
                      <img src={attachmentPreview} alt="Preview" className="h-12 w-12 object-cover rounded border" />
                    ) : (
                      <FileText className="h-8 w-8 text-blue-600" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAttachmentFile(null)
                        setAttachmentPreview(null)
                      }}
                      className="text-red-600 hover:text-red-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">Supported: JPG, PNG, GIF, PDF (Max 10MB)</p>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setShowAddModal(false)
                setAttachmentFile(null)
                setAttachmentPreview(null)
                reset()
              }}
              className="px-4 py-2 border border-neutral-200 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-neutral-50"
            >
              Cancel
            </button>
            <LoadingButton
              type="submit"
              loading={uploadingAttachment}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 flex items-center min-h-[44px]"
            >
              <Save className="h-4 w-4 mr-2" />
              {uploadingAttachment ? 'Uploading...' : 'Add Expense'}
            </LoadingButton>
          </div>
        </form>
      </Modal>

      {/* Edit Expense Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false)
          setSelectedExpense(null)
          reset()
        }}
        title="Edit Expense"
        size="md"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Category <span className="text-red-500">*</span>
                </label>
                {isAdminOrOwner(user) && (
                  <button
                    type="button"
                    onClick={openCategoryPrompt}
                    disabled={creatingCategory}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 disabled:opacity-50"
                    title="Create new category"
                  >
                    <Plus className="h-3 w-3" />
                    {creatingCategory ? 'Creating...' : 'New Category'}
                  </button>
                )}
              </div>
              <Select
                options={categories}
                required
                error={errors.category?.message}
                {...register('category', { required: 'Category is required' })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                label="Date"
                type="date"
                required
                error={errors.date?.message}
                {...register('date', { required: 'Date is required' })}
              />
            </div>

            {/* BRANCH/ROUTE ASSIGNMENT FIX: Add Branch and Route dropdowns in edit modal */}
            <Select
              label="Branch (Optional)"
              options={[
                { value: '', label: 'Company Level (No Branch)' },
                ...branches.map(branch => ({
                  value: branch.id,
                  label: branch.name
                }))
              ]}
              error={errors.branchId?.message}
              {...register('branchId', {
                onChange: (e) => {
                  setValue('branchId', e.target.value)
                  setValue('routeId', '')
                }
              })}
            />
            {branches.length > 0 && (
              <Select
                label="Route (Optional)"
                options={[
                  { value: '', label: watchedBranchId ? 'Select route' : 'Select branch first' },
                  ...(watchedBranchId ? routes.filter(r => r.branchId === parseInt(watchedBranchId, 10)) : []).map(r => ({
                    value: r.id,
                    label: r.name
                  }))
                ]}
                error={errors.routeId?.message}
                {...register('routeId')}
              />
            )}

            <TextArea
              label="Note"
              placeholder="Expense description..."
              rows={3}
              error={errors.note?.message}
              {...register('note')}
            />

            {/* ATTACHMENT FIX: Add receipt/attachment upload in edit modal */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Receipt/Attachment (Optional)
              </label>
              <div className="mt-1 flex items-center gap-3">
                <label className="cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                  <Upload className="h-4 w-4 mr-2" />
                  {attachmentFile ? attachmentFile.name : (selectedExpense?.attachmentUrl ? 'Change File' : 'Choose File')}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf"
                    onChange={handleAttachmentChange}
                  />
                </label>
                {attachmentPreview && (
                  <div className="flex items-center gap-2">
                    {attachmentFile?.type?.startsWith('image/') ? (
                      <img src={attachmentPreview} alt="Preview" className="h-12 w-12 object-cover rounded border" />
                    ) : (
                      <FileText className="h-8 w-8 text-blue-600" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAttachmentFile(null)
                        setAttachmentPreview(null)
                      }}
                      className="text-red-600 hover:text-red-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {selectedExpense?.attachmentUrl && !attachmentFile && (
                  <button
                    type="button"
                    onClick={() => handleDownloadAttachment(selectedExpense)}
                    className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-sm"
                  >
                    <Eye className="h-4 w-4" />
                    View Current
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">Supported: JPG, PNG, GIF, PDF (Max 10MB)</p>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setShowEditModal(false)
                setSelectedExpense(null)
                setAttachmentFile(null)
                setAttachmentPreview(null)
                reset()
              }}
              className="px-4 py-2 border border-neutral-200 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-neutral-50"
            >
              Cancel
            </button>
            <LoadingButton
              type="submit"
              loading={uploadingAttachment}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 flex items-center min-h-[44px]"
            >
              <Save className="h-4 w-4 mr-2" />
              {uploadingAttachment ? 'Uploading...' : 'Update Expense'}
            </LoadingButton>
          </div>
        </form>
      </Modal>
      {/* Recurring Expenses Modal */}
      {isAdminOrOwner(user) && (
        <Modal
          isOpen={showRecurringModal}
          onClose={() => {
            setShowRecurringModal(false)
          }}
          title="Recurring Expenses"
          size="lg"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 mb-4">
              Set up expenses that repeat automatically (e.g., monthly rent, weekly fuel).
            </p>
            
            <button
              onClick={() => {
                // TODO: Open create recurring expense form
                showToast.info('Recurring expense creation coming soon')
              }}
              className="w-full px-4 py-2 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 flex items-center justify-center min-h-[44px]"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Recurring Expense
            </button>

            {recurringExpenses.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Repeat className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>No recurring expenses configured</p>
                <p className="text-xs mt-1">Create one to automate expense entry</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recurringExpenses.map((recurring) => (
                  <div key={recurring.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{recurring.categoryName}</p>
                        <p className="text-sm text-gray-600">{formatCurrency(recurring.amount)}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {recurring.frequency} • {recurring.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            // TODO: Edit recurring expense
                            showToast.info('Edit recurring expense coming soon')
                          }}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            // TODO: Delete recurring expense
                            showToast.info('Delete recurring expense coming soon')
                          }}
                          className="text-red-600 hover:text-red-900"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Edit Expense Modal same as add modal but with title change */}
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

export default ExpensesPage

