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
import { formatCurrency, roundMoney } from '../../utils/currency'
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

function BulkVatForm ({ noVatExpenses, onApply, onCancel, submitting }) {
  const [interpretation, setInterpretation] = useState('add-on-top')
  const vatRate = 0.05
  const preview = noVatExpenses.slice(0, 10).map(e => {
    const amount = Number(e.amount) || 0
    let oldAmount = amount
    let newNet = amount
    let newVat = 0
    let newTotal = amount
    if (interpretation === 'add-on-top') {
      newVat = roundMoney(amount * vatRate)
      newTotal = amount + newVat
    } else {
      newNet = roundMoney(amount / (1 + vatRate))
      newVat = amount - newNet
      newTotal = amount
    }
    return { id: e.id, categoryName: e.categoryName, oldAmount, newNet, newVat, newTotal }
  })
  const handleApply = () => {
    onApply({
      allNoVat: true,
      interpretation,
      vatRate: 0.05,
      isTaxClaimable: true,
      taxType: 'Standard',
      isEntertainment: false
    })
  }
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Interpretation</p>
        <label className="flex items-center gap-2 mb-1">
          <input type="radio" name="bulkVatInterp" value="add-on-top" checked={interpretation === 'add-on-top'} onChange={() => setInterpretation('add-on-top')} />
          <span className="text-sm">Add VAT on top (amount was net)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="bulkVatInterp" value="extract-from-amount" checked={interpretation === 'extract-from-amount'} onChange={() => setInterpretation('extract-from-amount')} />
          <span className="text-sm">Extract VAT from amount (amount included VAT)</span>
        </label>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Preview (first {preview.length} of {noVatExpenses.length})</p>
        <div className="overflow-x-auto border border-gray-200 rounded text-xs">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Category</th>
                <th className="px-2 py-1 text-right">Old amount</th>
                <th className="px-2 py-1 text-right">New net</th>
                <th className="px-2 py-1 text-right">VAT</th>
                <th className="px-2 py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {preview.map(row => (
                <tr key={row.id} className="border-t border-gray-100">
                  <td className="px-2 py-1">{row.categoryName || '-'}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(row.oldAmount)}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(row.newNet)}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(row.newVat)}</td>
                  <td className="px-2 py-1 text-right">{formatCurrency(row.newTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <LoadingButton type="button" loading={submitting} onClick={handleApply} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Apply VAT to {noVatExpenses.length} expense(s)
        </LoadingButton>
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  )
}

function CategoryVatEditInline ({ category, onSave, onCancel }) {
  const [defaultVatRate, setDefaultVatRate] = useState(category.defaultVatRate ?? 0)
  const [defaultTaxType, setDefaultTaxType] = useState(category.defaultTaxType || 'Standard')
  const [defaultIsTaxClaimable, setDefaultIsTaxClaimable] = useState(!!category.defaultIsTaxClaimable)
  const [defaultIsEntertainment, setDefaultIsEntertainment] = useState(!!category.defaultIsEntertainment)
  const [vatDefaultLocked, setVatDefaultLocked] = useState(!!category.vatDefaultLocked)
  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      defaultVatRate: Number(defaultVatRate),
      defaultTaxType,
      defaultIsTaxClaimable,
      defaultIsEntertainment,
      vatDefaultLocked
    })
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Default VAT rate</label>
        <select
          value={defaultVatRate}
          onChange={(e) => setDefaultVatRate(Number(e.target.value))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2"
        >
          <option value={0}>0%</option>
          <option value={0.05}>5%</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Tax type</label>
        <select
          value={defaultTaxType}
          onChange={(e) => setDefaultTaxType(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2"
        >
          <option value="Standard">Standard</option>
          <option value="Petroleum">Petroleum</option>
          <option value="Exempt">Exempt</option>
          <option value="OutOfScope">OutOfScope</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="catItc" checked={defaultIsTaxClaimable} onChange={(e) => setDefaultIsTaxClaimable(e.target.checked)} className="rounded border-gray-300" />
        <label htmlFor="catItc" className="text-sm text-gray-700">ITC claimable</label>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="catEnt" checked={defaultIsEntertainment} onChange={(e) => setDefaultIsEntertainment(e.target.checked)} className="rounded border-gray-300" />
        <label htmlFor="catEnt" className="text-sm text-gray-700">Entertainment (50% cap)</label>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="catLock" checked={vatDefaultLocked} onChange={(e) => setVatDefaultLocked(e.target.checked)} className="rounded border-gray-300" />
        <label htmlFor="catLock" className="text-sm text-gray-700">Lock VAT for this category</label>
      </div>
      <div className="flex gap-2 pt-2">
        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  )
}

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
  const [showCategorySettingsModal, setShowCategorySettingsModal] = useState(false)
  const [editingCategoryVat, setEditingCategoryVat] = useState(null)
  const [filterNoVatOnly, setFilterNoVatOnly] = useState(false)
  const [showBulkVatModal, setShowBulkVatModal] = useState(false)
  const [selectedExpenseIds, setSelectedExpenseIds] = useState([])
  const [bulkVatSubmitting, setBulkVatSubmitting] = useState(false)
  const [quickBulkVatInterpretation, setQuickBulkVatInterpretation] = useState('add-on-top')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors }
  } = useForm({
    defaultValues: { vatInclusive: true }
  })

  const watchedBranchId = watch('branchId')

  const fetchCategories = useCallback(async () => {
    try {
      const response = await expensesAPI.getExpenseCategories()
      if (response?.success && response?.data && Array.isArray(response.data)) {
        setCategories(response.data)
      } else {
        setCategories([])
      }
    } catch (error) {
      console.error('Failed to load categories:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to load expense categories')
      setCategories([])
    }
  }, [])

  const categoryOptions = [
    { value: '', label: categories.length === 0 ? 'No categories – add one first' : 'Select category...' },
    ...categories.map(cat => ({
      value: String(cat.id),
      label: cat.name,
      color: cat.colorCode
    }))
  ]
  const watchedCategoryId = watch('category')
  const selectedCategory = watchedCategoryId
    ? categories.find(c => c.id === parseInt(watchedCategoryId, 10))
    : null
  const vatLockedByCategory = selectedCategory?.vatDefaultLocked === true

  const noVatExpenses = filteredExpenses.filter(e => e.vatAmount == null)
  const noVatCount = noVatExpenses.length
  const displayExpenses = filterNoVatOnly ? noVatExpenses : filteredExpenses

  useEffect(() => {
    if (!selectedCategory || showEditModal) return
    setValue('withVat', selectedCategory.defaultVatRate > 0)
    setValue('taxType', selectedCategory.defaultTaxType || 'Standard')
    setValue('isTaxClaimable', !!selectedCategory.defaultIsTaxClaimable)
    setValue('isEntertainment', !!selectedCategory.defaultIsEntertainment)
  }, [watchedCategoryId, selectedCategory?.id, showEditModal, setValue])


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

        const total = expenseList.reduce((sum, expense) => {
          const paid = expense.totalAmount != null ? Number(expense.totalAmount) : (Number(expense.amount) || 0) + (Number(expense.vatAmount) || 0) || (Number(expense.amount) || 0)
          return sum + paid
        }, 0)
        const totalVat = expenseList.reduce((sum, expense) => sum + (Number(expense.vatAmount) || 0), 0)
        const totalClaimableVat = expenseList.reduce((sum, expense) => sum + (Number(expense.claimableVat ?? expense.ClaimableVat) || 0), 0)
        const categoryTotals = expenseList.reduce((acc, expense) => {
          const cat = expense.categoryName || 'Other'
          const paid = expense.totalAmount != null ? Number(expense.totalAmount) : (Number(expense.amount) || 0) + (Number(expense.vatAmount) || 0) || (Number(expense.amount) || 0)
          acc[cat] = (acc[cat] || 0) + paid
          return acc
        }, {})

        setExpenseSummary({
          total,
          totalVat,
          totalClaimableVat,
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
      const catId = parseInt(data.category, 10)
      if (isNaN(catId) || catId <= 0) {
        toast.error('Please select a category')
        return
      }
      const amt = parseFloat(data.amount)
      if (isNaN(amt) || amt <= 0) {
        toast.error('Please enter a valid amount greater than 0')
        return
      }
      const expenseDate = data.date ? new Date(data.date).toISOString() : new Date().toISOString()

      if (selectedExpense) {
        const response = await expensesAPI.updateExpense(selectedExpense.id, {
          branchId: data.branchId ? parseInt(data.branchId, 10) : null,
          routeId: data.routeId ? parseInt(data.routeId, 10) : null,
          categoryId: catId,
          amount: amt,
          date: expenseDate,
          note: data.note || '',
          withVat: !!data.withVat,
          vatInclusive: !!data.vatInclusive,
          taxType: data.taxType || 'Standard',
          isTaxClaimable: !!data.isTaxClaimable,
          isEntertainment: !!data.isEntertainment,
          partialCreditPct: data.partialCreditPct != null ? parseFloat(data.partialCreditPct) : 100
        })

        if (response?.success) {
          toast.success('Expense updated successfully!', { id: 'expense-update', duration: 4000 })
          window.dispatchEvent(new CustomEvent('dataUpdated'))
        } else {
          toast.error(response?.message || 'Failed to update expense', { id: 'expense-update' })
          return
        }
      } else {
        const response = await expensesAPI.createExpense({
          branchId: data.branchId ? parseInt(data.branchId, 10) : null,
          routeId: data.routeId ? parseInt(data.routeId, 10) : null,
          categoryId: catId,
          amount: amt,
          date: expenseDate,
          note: data.note || '',
          attachmentUrl: null,
          recurringExpenseId: data.recurringExpenseId ? parseInt(data.recurringExpenseId, 10) : null,
          withVat: !!data.withVat,
          vatInclusive: !!data.vatInclusive,
          taxType: data.taxType || 'Standard',
          isTaxClaimable: !!data.isTaxClaimable,
          isEntertainment: !!data.isEntertainment,
          partialCreditPct: data.partialCreditPct != null ? parseFloat(data.partialCreditPct) : 100
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
                categoryId: catId,
                amount: amt,
                date: expenseDate,
                note: data.note || '',
                attachmentUrl: uploadResponse.data,
                recurringExpenseId: data.recurringExpenseId ? parseInt(data.recurringExpenseId, 10) : null,
                withVat: !!data.withVat,
                vatInclusive: !!data.vatInclusive,
                taxType: data.taxType || 'Standard',
                isTaxClaimable: !!data.isTaxClaimable,
                isEntertainment: !!data.isEntertainment,
                partialCreditPct: data.partialCreditPct != null ? parseFloat(data.partialCreditPct) : 100
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
          window.dispatchEvent(new CustomEvent('dataUpdated'))
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
      const errMsg = error?.response?.data?.message || error?.response?.data?.errors?.[0] || 'Failed to save expense. Check category, amount, and date.'
      if (!error?._handledByInterceptor) toast.error(errMsg)
    }
  }

  const handleEdit = (expense) => {
    setSelectedExpense(expense)
    setValue('category', expense.categoryId != null ? String(expense.categoryId) : '')
    setValue('amount', expense.amount || 0)
    setValue('branchId', expense.branchId ? String(expense.branchId) : '')
    setValue('routeId', expense.routeId ? String(expense.routeId) : '')
    setValue('recurringExpenseId', expense.recurringExpenseId ? String(expense.recurringExpenseId) : '')
    const expenseDate = expense.date
      ? new Date(expense.date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
    setValue('date', expenseDate)
    setValue('note', expense.note || '')
    setValue('withVat', !!(expense.vatAmount != null && expense.vatAmount > 0))
    setValue('taxType', expense.taxType || 'Standard')
    setValue('isTaxClaimable', expense.isTaxClaimable !== false)
    setValue('isEntertainment', !!expense.isEntertainment)
    setValue('partialCreditPct', expense.partialCreditPct != null ? expense.partialCreditPct : 100)
    setValue('vatInclusive', (expense.vatInclusive ?? expense.VatInclusive) === true) // use persisted flag when available; else default false for legacy
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
        await fetchExpenses()
        window.dispatchEvent(new CustomEvent('dataUpdated'))
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
            window.dispatchEvent(new CustomEvent('dataUpdated'))
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
            window.dispatchEvent(new CustomEvent('dataUpdated'))
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

  const CHART_PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#6366F1', '#06B6D4', '#EAB308']

  const chartData = expenseSummary ? Object.entries(expenseSummary.categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount], index) => ({
      name: category,
      value: amount,
      color: CHART_PALETTE[index % CHART_PALETTE.length]
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
              <>
              <button
                type="button"
                onClick={() => setShowCategorySettingsModal(true)}
                className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <Tag className="h-4 w-4" />
                <span className="hidden sm:inline">Category VAT</span>
              </button>
              <button
                onClick={() => setShowRecurringModal(true)}
                className="px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 bg-purple-600 text-white rounded font-medium hover:bg-purple-700 flex items-center justify-center text-xs sm:text-sm flex-1 sm:flex-none min-h-[44px]"
                title="Manage recurring expenses"
              >
                <Repeat className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Recurring</span>
                <span className="sm:hidden">Repeat</span>
              </button>
              </>
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
            <button
              onClick={() => setFilterNoVatOnly(prev => !prev)}
              className={`px-2 py-1 text-xs rounded ${filterNoVatOnly ? 'bg-amber-200 text-amber-900' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
            >
              No VAT data only {filterNoVatOnly ? '(on)' : ''}
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
                  if (e.target.value !== '') setSelectedExpenseIds([])
                }}
              />
            </div>
          </div>
        </div>

        {noVatCount > 0 && isAdminOrOwner(user) && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-amber-800">
              {noVatCount} expense(s) have no VAT data.
            </span>
            <button
              type="button"
              onClick={() => setShowBulkVatModal(true)}
              className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700"
            >
              Review & Update
            </button>
          </div>
        )}

        {/* Summary Cards - Mobile Responsive */}
        {expenseSummary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
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

            <div className="bg-white rounded-xl border border-neutral-200 p-3 sm:p-4">
              <div className="flex items-center">
                <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-amber-600 flex-shrink-0" />
                <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-amber-600">Total VAT</p>
                  <p className="text-base sm:text-xl lg:text-2xl font-bold text-amber-900 truncate">
                    {formatCurrency(expenseSummary.totalVat ?? 0)}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-green-200 p-3 sm:p-4">
              <div className="flex items-center">
                <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-green-600 flex-shrink-0" />
                <div className="ml-2 sm:ml-3 lg:ml-4 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-green-600">Claimable VAT (Box 9b)</p>
                  <p className="text-base sm:text-xl lg:text-2xl font-bold text-green-900 truncate">
                    {formatCurrency(expenseSummary.totalClaimableVat ?? 0)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">After entertainment cap & petroleum exclusion. Mark expenses as Tax claimable (ITC) to include in Box 9b.</p>
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

        {/* Bulk selection bar - visible whenever any expense is selected */}
        {selectedExpenseIds.length > 0 && (() => {
          const selectedExpenses = displayExpenses.filter(e => selectedExpenseIds.includes(e.id))
          const selectedNoVatCount = selectedExpenses.filter(e => e.vatAmount == null).length
          const allSelectedAreNoVat = selectedNoVatCount === selectedExpenseIds.length && selectedNoVatCount > 0
          return (
          <div className="bg-primary-50 border border-primary-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-primary-800">{selectedExpenseIds.length} selected</span>
            {isAdminOrOwner(user) && (
              <>
                {allSelectedAreNoVat && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-600 mr-1">VAT:</span>
                    <div className="inline-flex rounded-lg border border-amber-300 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setQuickBulkVatInterpretation('add-on-top')}
                        className={`px-2.5 py-1.5 text-xs font-medium ${quickBulkVatInterpretation === 'add-on-top' ? 'bg-amber-600 text-white' : 'bg-white text-gray-700 hover:bg-amber-50'}`}
                        title="Amount was net; add 5% on top"
                      >
                        Add on top
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickBulkVatInterpretation('extract-from-amount')}
                        className={`px-2.5 py-1.5 text-xs font-medium ${quickBulkVatInterpretation === 'extract-from-amount' ? 'bg-amber-600 text-white' : 'bg-white text-gray-700 hover:bg-amber-50'}`}
                        title="Amount included VAT; extract net and VAT"
                      >
                        Extract from amount
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const res = await expensesAPI.bulkVatUpdate({
                            expenseIds: selectedExpenseIds,
                            interpretation: quickBulkVatInterpretation,
                            vatRate: 0.05,
                            isTaxClaimable: true,
                            taxType: 'Standard',
                            isEntertainment: false
                          })
                          if (res?.success && res?.data) {
                            toast.success(`Applied 5% VAT to ${res.data.updated} expense(s)`)
                            setSelectedExpenseIds([])
                            await fetchExpenses()
                            window.dispatchEvent(new CustomEvent('dataUpdated'))
                          } else toast.error(res?.message || 'Update failed')
                        } catch (err) {
                          toast.error(err?.response?.data?.message || 'Update failed')
                        }
                      }}
                      className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700"
                    >
                      Apply 5% VAT to selected ({selectedNoVatCount})
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await expensesAPI.bulkSetClaimable({ expenseIds: selectedExpenseIds, isTaxClaimable: true })
                      if (res?.success && res?.data) {
                        toast.success(`Updated ${res.data.updated} expense(s) as VAT claimable`)
                        setSelectedExpenseIds([])
                        fetchExpenses()
                        window.dispatchEvent(new CustomEvent('dataUpdated'))
                      } else toast.error(res?.message || 'Update failed')
                    } catch (err) {
                      toast.error(err?.response?.data?.message || 'Update failed')
                    }
                  }}
                  className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                >
                  Mark as VAT claimable
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await expensesAPI.bulkSetClaimable({ expenseIds: selectedExpenseIds, isTaxClaimable: false })
                      if (res?.success && res?.data) {
                        toast.success(`Updated ${res.data.updated} expense(s) as not claimable`)
                        setSelectedExpenseIds([])
                        fetchExpenses()
                        window.dispatchEvent(new CustomEvent('dataUpdated'))
                      } else toast.error(res?.message || 'Update failed')
                    } catch (err) {
                      toast.error(err?.response?.data?.message || 'Update failed')
                    }
                  }}
                  className="px-3 py-1.5 bg-neutral-600 text-white text-sm font-medium rounded-lg hover:bg-neutral-700"
                >
                  Mark as not claimable
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setSelectedExpenseIds([])}
              className="px-3 py-1.5 border border-neutral-300 rounded-lg text-sm text-gray-700 hover:bg-neutral-100"
            >
              Clear selection
            </button>
          </div>
          )
        })()}

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
                    <th className="px-2 py-3 text-center font-semibold text-gray-700 border-r border-neutral-200 w-10">
                      <input
                        type="checkbox"
                        checked={displayExpenses.length > 0 && displayExpenses.every(e => selectedExpenseIds.includes(e.id))}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedExpenseIds(displayExpenses.map(ex => ex.id))
                          else setSelectedExpenseIds(prev => prev.filter(id => !displayExpenses.some(ex => ex.id === id)))
                        }}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Category</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Branch</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Route</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700 border-r border-neutral-200">Amount</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700 border-r border-neutral-200">VAT</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700 border-r border-neutral-200">Claimable VAT</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700 border-r border-neutral-200">Total</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-neutral-200">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Note</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {displayExpenses.length === 0 ? (
                    <tr>
                      <td colSpan="13" className="px-6 py-8 text-center text-gray-500">
                        {user && !isAdminOrOwner(user)
                          ? 'No expenses in your assigned branch(es) for this period.'
                          : 'No expenses found'}
                      </td>
                    </tr>
                  ) : (
                    displayExpenses.map((expense) => (
                      <tr key={expense.id} className="hover:bg-neutral-50">
                        <td className="px-2 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedExpenseIds.includes(expense.id)}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedExpenseIds(prev => [...prev, expense.id])
                              else setSelectedExpenseIds(prev => prev.filter(id => id !== expense.id))
                            }}
                            className="rounded border-gray-300"
                          />
                        </td>
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
                          {expense.vatAmount != null && expense.vatAmount > 0 && ((expense.vatInclusive ?? expense.VatInclusive) === true || (expense.vatInclusive ?? expense.VatInclusive) === false) && (
                            <span className={`ml-1 text-xs font-normal ${(expense.vatInclusive ?? expense.VatInclusive) ? 'text-blue-600' : 'text-gray-500'}`} title={(expense.vatInclusive ?? expense.VatInclusive) ? 'Amount was entered VAT-inclusive' : 'Amount was entered VAT-exclusive'}>
                              ({(expense.vatInclusive ?? expense.VatInclusive) ? 'Incl.' : 'Excl.'})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right text-gray-700">
                          {expense.vatAmount != null ? formatCurrency(expense.vatAmount) : '-'}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right text-green-700">
                          {expense.claimableVat != null || expense.ClaimableVat != null ? formatCurrency(expense.claimableVat ?? expense.ClaimableVat) : '-'}
                          {expense.isEntertainment && (expense.claimableVat != null || expense.ClaimableVat != null) && (
                            <span className="ml-1 text-xs text-amber-600" title="50% cap">50%</span>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-right font-medium text-gray-900">
                          {expense.totalAmount != null ? formatCurrency(expense.totalAmount) : (expense.vatAmount != null ? formatCurrency((Number(expense.amount) || 0) + (Number(expense.vatAmount) || 0)) : formatCurrency(expense.amount))}
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
              {displayExpenses.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {user && !isAdminOrOwner(user)
                    ? 'No expenses in your assigned branch(es) for this period.'
                    : 'No expenses found'}
                </div>
              ) : (
                displayExpenses.map((expense) => (
                  <div key={expense.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-start gap-2 flex-1">
                        <input
                          type="checkbox"
                          checked={selectedExpenseIds.includes(expense.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedExpenseIds(prev => [...prev, expense.id])
                            else setSelectedExpenseIds(prev => prev.filter(id => id !== expense.id))
                          }}
                          className="mt-1 rounded border-gray-300"
                        />
                        <div className="flex-1 min-w-0">
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
                      </div>
                      <div className="text-right ml-2">
                        <p className="text-base font-bold text-red-600">{formatCurrency(expense.totalAmount != null ? expense.totalAmount : (expense.vatAmount != null ? (Number(expense.amount) || 0) + (Number(expense.vatAmount) || 0) : expense.amount))}</p>
                        {expense.vatAmount != null && <p className="text-xs text-gray-500">VAT {formatCurrency(expense.vatAmount)}</p>}
                      </div>
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

      {/* Add Expense Modal - 4-col horizontal layout, minimal vertical scroll */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          reset()
        }}
        title="Add New Expense"
        size="xl"
      >
        <form onSubmit={handleSubmit(onSubmit)} className="max-h-[80vh] overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
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
                options={categoryOptions}
                required
                error={errors.category?.message}
                {...register('category', { required: 'Category is required' })}
              />
            </div>

            <Input
              label={watch('withVat') && watch('vatInclusive') ? 'Amount (incl. VAT)' : 'Amount (excl. VAT)'}
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
            {watch('withVat') && Number(watch('amount')) > 0 && (() => {
              const amt = Number(watch('amount')) || 0
              const inclusive = !!watch('vatInclusive')
              const net = inclusive ? roundMoney(amt / 1.05) : amt
              const vat = inclusive ? roundMoney(amt - net) : roundMoney(amt * 0.05)
              const total = inclusive ? amt : roundMoney(amt + vat)
              return (
                <div className="rounded bg-gray-50 border border-gray-200 px-2 py-1 text-xs col-span-2 lg:col-span-4 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span><span className="text-gray-600">Net:</span> <span className="font-medium">{formatCurrency(net)}</span></span>
                  <span><span className="text-gray-600">VAT:</span> <span className="font-medium">{formatCurrency(vat)}</span></span>
                  <span><span className="text-gray-600">Total:</span> <span className="font-semibold">{formatCurrency(total)}</span>{inclusive ? ' ✓' : ''}</span>
                </div>
              )
            })()}

            {vatLockedByCategory ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 col-span-2 lg:col-span-4">
                VAT from category ({selectedCategory?.defaultVatRate ? `${(selectedCategory.defaultVatRate * 100).toFixed(0)}%` : '0%'}
                {selectedCategory?.defaultIsTaxClaimable ? ', Claimable' : ''}{selectedCategory?.defaultIsEntertainment ? ', 50% cap' : ''})
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 col-span-2 lg:col-span-4">
                  <input type="checkbox" id="withVat" {...register('withVat')} className="rounded border-gray-300" />
                  <label htmlFor="withVat" className="text-sm text-gray-700">Include VAT (5%)</label>
                  {watch('withVat') && (
                    <span className="flex items-center gap-1.5 ml-2">
                      <input type="checkbox" id="vatInclusive" {...register('vatInclusive')} className="rounded border-gray-300" />
                      <label htmlFor="vatInclusive" className="text-xs text-blue-700">VAT-inclusive</label>
                    </span>
                  )}
                </div>
                {watch('withVat') && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 col-span-2 lg:col-span-4">
                    <Select label="Tax type" options={[{ value: 'Standard', label: 'Standard' }, { value: 'Petroleum', label: 'Petroleum' }, { value: 'Exempt', label: 'Exempt' }]} {...register('taxType')} />
                    <div className="flex items-center gap-1.5 self-center">
                      <input type="checkbox" id="isTaxClaimable" {...register('isTaxClaimable')} className="rounded border-gray-300" />
                      <label htmlFor="isTaxClaimable" className="text-xs text-gray-700">ITC claimable</label>
                    </div>
                    <div className="flex items-center gap-1.5 self-center">
                      <input type="checkbox" id="isEntertainment" {...register('isEntertainment')} className="rounded border-gray-300" />
                      <label htmlFor="isEntertainment" className="text-xs text-gray-700">Entertainment (50%)</label>
                    </div>
                    <Input label="Partial %" type="number" min={0} max={100} step={1} placeholder="100" {...register('partialCreditPct')} className="py-1.5" />
                  </div>
                )}
              </>
            )}

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
              placeholder="Description..."
              rows={1}
              error={errors.note?.message}
              {...register('note')}
              className="min-h-[60px]"
            />

            {/* Receipt/Attachment - inline */}
            <div className="col-span-2 lg:col-span-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="cursor-pointer inline-flex items-center px-3 py-1.5 border border-gray-300 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {attachmentFile ? attachmentFile.name : 'Receipt (opt)'}
                  <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleAttachmentChange} />
                </label>
                {attachmentPreview && (
                  <span className="flex items-center gap-1">
                    {attachmentFile?.type?.startsWith('image/') ? (
                      <img src={attachmentPreview} alt="" className="h-8 w-8 object-cover rounded" />
                    ) : <FileText className="h-5 w-5 text-blue-600" />}
                    <button type="button" onClick={() => { setAttachmentFile(null); setAttachmentPreview(null) }} className="text-red-600 p-0.5"><X className="h-4 w-4" /></button>
                  </span>
                )}
                <span className="text-xs text-gray-500">JPG, PNG, PDF (10MB)</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
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
                options={categoryOptions}
                required
                error={errors.category?.message}
                {...register('category', { required: 'Category is required' })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Amount (excl. VAT)"
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
            {watch('withVat') && Number(watch('amount')) > 0 && (() => {
              const amt = Number(watch('amount')) || 0
              const inclusive = !!watch('vatInclusive')
              const net = inclusive ? roundMoney(amt / 1.05) : amt
              const vat = inclusive ? roundMoney(amt - net) : roundMoney(amt * 0.05)
              const total = inclusive ? amt : roundMoney(amt + vat)
              return (
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm space-y-0.5">
                  <p><span className="text-gray-600">Net: </span><span className="font-medium">{formatCurrency(net)}</span></p>
                  <p><span className="text-gray-600">VAT (5%): </span><span className="font-medium">{formatCurrency(vat)}</span></p>
                  <p><span className="text-gray-600">Total: </span><span className="font-semibold">{formatCurrency(total)}</span>{inclusive ? ' ✓' : ''}</p>
                </div>
              )
            })()}

            {selectedExpense && selectedExpense.vatAmount == null && !vatLockedByCategory && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm text-amber-800">No VAT data.</span>
                <button type="button" onClick={() => { setValue('withVat', true); setValue('taxType', 'Standard'); setValue('isTaxClaimable', true); }} className="text-sm px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700">Add 5% VAT</button>
                <button type="button" onClick={() => { setValue('withVat', false); }} className="text-sm px-2 py-1 border border-amber-300 rounded hover:bg-amber-100">Keep as No VAT</button>
              </div>
            )}
            {vatLockedByCategory ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                VAT auto-set from category default ({selectedCategory?.defaultVatRate ? `${(selectedCategory.defaultVatRate * 100).toFixed(0)}%` : '0%'}
                {selectedCategory?.defaultIsTaxClaimable ? ', Claimable' : ', Non-claimable'}
                {selectedCategory?.defaultIsEntertainment ? ', Entertainment (50% cap)' : ''}).
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="editWithVat" {...register('withVat')} className="rounded border-gray-300" />
                  <label htmlFor="editWithVat" className="text-sm text-gray-700">Include VAT (5%)</label>
                </div>
                {watch('withVat') && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                    <p className="text-xs text-blue-800">
                      Select whether the amount you enter is <strong>inclusive</strong> (total with VAT) or <strong>exclusive</strong> (net, VAT added on top).
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input type="checkbox" id="editVatInclusive" {...register('vatInclusive')} className="rounded border-gray-300" />
                      <label htmlFor="editVatInclusive" className="text-sm text-blue-800 font-medium">Amount includes VAT (VAT-inclusive)</label>
                      <span
                        className="text-blue-600 cursor-help border border-blue-400 rounded-full w-4 h-4 inline-flex items-center justify-center text-xs font-bold"
                        title="Inclusive: enter the total on the receipt (e.g. 105 AED); VAT is extracted. Exclusive: enter net only (e.g. 100 AED); 5% VAT is added."
                      >
                        ?
                      </span>
                    </div>
                  </div>
                )}
                {watch('withVat') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l-2 border-gray-200">
                    <Select
                      label="Tax type"
                      options={[
                        { value: 'Standard', label: 'Standard' },
                        { value: 'Petroleum', label: 'Petroleum (no ITC)' },
                        { value: 'Exempt', label: 'Exempt' }
                      ]}
                      {...register('taxType')}
                    />
                    <div className="flex items-center gap-2 pt-6">
                      <input type="checkbox" id="editIsTaxClaimable" {...register('isTaxClaimable')} className="rounded border-gray-300" />
                      <label htmlFor="editIsTaxClaimable" className="text-sm text-gray-700">Tax claimable (ITC)</label>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" id="editIsEntertainment" {...register('isEntertainment')} className="rounded border-gray-300" />
                      <label htmlFor="editIsEntertainment" className="text-sm text-gray-700">Entertainment (50% cap)</label>
                    </div>
                    <Input label="Partial credit %" type="number" min={0} max={100} step={1} placeholder="100" {...register('partialCreditPct')} />
                  </div>
                )}
              </>
            )}

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

      {/* Bulk VAT Update Modal */}
      <Modal
        isOpen={showBulkVatModal}
        onClose={() => setShowBulkVatModal(false)}
        title="Bulk VAT update"
      >
        {noVatCount === 0 ? (
          <p className="text-gray-600">No expenses with missing VAT data.</p>
        ) : (
          <BulkVatForm
            noVatExpenses={noVatExpenses}
            onApply={async (payload) => {
              setBulkVatSubmitting(true)
              try {
                const res = await expensesAPI.bulkVatUpdate(payload)
                if (res?.success && res?.data) {
                  toast.success(`Updated ${res.data.updated} expense(s). Recalculate VAT Return if needed.`)
                  await fetchExpenses()
                  setShowBulkVatModal(false)
                  window.dispatchEvent(new CustomEvent('dataUpdated'))
                } else toast.error(res?.message || 'Update failed')
              } catch (e) {
                toast.error(e?.response?.data?.message || 'Update failed')
              } finally {
                setBulkVatSubmitting(false)
              }
            }}
            onCancel={() => setShowBulkVatModal(false)}
            submitting={bulkVatSubmitting}
          />
        )}
      </Modal>

      {/* Category VAT settings modal */}
      <Modal
        isOpen={showCategorySettingsModal}
        onClose={() => { setShowCategorySettingsModal(false); setEditingCategoryVat(null) }}
        title="Expense category VAT defaults"
      >
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center justify-between py-2 border-b border-gray-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900">{cat.name}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                  {cat.defaultVatRate ? `${(cat.defaultVatRate * 100).toFixed(0)}% VAT` : '0% VAT'}
                </span>
                {cat.defaultIsTaxClaimable && <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">Claimable</span>}
                {cat.defaultIsEntertainment && <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">Entertainment</span>}
                {cat.vatDefaultLocked && <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">Locked</span>}
              </div>
              <button
                type="button"
                onClick={() => setEditingCategoryVat({ ...cat })}
                className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
              >
                Edit
              </button>
            </div>
          ))}
          {categories.length === 0 && <p className="text-gray-500 text-sm">No categories yet.</p>}
        </div>
      </Modal>

      {/* Edit category VAT defaults modal */}
      <Modal
        isOpen={!!editingCategoryVat}
        onClose={() => setEditingCategoryVat(null)}
        title={editingCategoryVat ? `VAT defaults: ${editingCategoryVat.name}` : ''}
      >
        {editingCategoryVat && (
          <CategoryVatEditInline
            category={editingCategoryVat}
            onSave={async (data) => {
              try {
                const res = await expensesAPI.updateCategory(editingCategoryVat.id, data)
                if (res?.success) {
                  toast.success('Category updated')
                  await fetchCategories()
                  setEditingCategoryVat(null)
                  setShowCategorySettingsModal(false)
                } else toast.error(res?.message || 'Update failed')
              } catch (e) {
                toast.error(e?.response?.data?.message || 'Update failed')
              }
            }}
            onCancel={() => setEditingCategoryVat(null)}
          />
        )}
      </Modal>

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

