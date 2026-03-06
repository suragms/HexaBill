import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Building2, ArrowLeft, Plus, Pencil, MapPin, Filter, DollarSign, Trash2, Edit, Users, UserPlus, BarChart3, TrendingUp, ArrowRightLeft } from 'lucide-react'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import { branchesAPI, expensesAPI, customersAPI, adminAPI } from '../../services'
import Modal from '../../components/Modal'
import { Input, TextArea } from '../../components/Form'
import { isAdminOrOwner } from '../../utils/roles'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'
import { useAuth } from '../../hooks/useAuth'

const TABS = ['overview', 'routes', 'staff', 'customers', 'expenses', 'performance', 'report']

const BranchDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { branches: contextBranches, routes: contextRoutes } = useBranchesRoutes()
  const [activeTab, setActiveTab] = useState('overview')
  const [branch, setBranch] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddRouteModal, setShowAddRouteModal] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', address: '' })
  const [routeName, setRouteName] = useState('')
  const [saving, setSaving] = useState(false)
  // Applied dates (drive API calls); draft dates (staged until Apply clicked)
  const getDefaultFrom = () => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().split('T')[0]
  }
  const [fromDate, setFromDate] = useState(getDefaultFrom)
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0])
  const [dateDraft, setDateDraft] = useState(() => ({
    from: getDefaultFrom(),
    to: new Date().toISOString().split('T')[0]
  }))
  // Branch-level expenses
  const [branchExpenses, setBranchExpenses] = useState([])
  const [branchExpensesLoading, setBranchExpensesLoading] = useState(false)
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false)
  const [expenseForm, setExpenseForm] = useState({ categoryId: '', amount: '', date: new Date().toISOString().split('T')[0], note: '' })
  const [expenseCategories, setExpenseCategories] = useState([])
  const [expenseSaving, setExpenseSaving] = useState(false)
  const [selectedExpenseForEdit, setSelectedExpenseForEdit] = useState(null)
  const [expenseDangerModal, setExpenseDangerModal] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} })
  const [branchCustomers, setBranchCustomers] = useState([])
  const [branchCustomersLoading, setBranchCustomersLoading] = useState(false)
  const [branchStaff, setBranchStaff] = useState([])
  const [showAssignStaffModal, setShowAssignStaffModal] = useState(false)
  const [staffToAssignList, setStaffToAssignList] = useState([])
  const [assignStaffLoading, setAssignStaffLoading] = useState(false)
  const [assignStaffLoadError, setAssignStaffLoadError] = useState(null)
  const [assignStaffSaving, setAssignStaffSaving] = useState(false)
  const [removeStaffSavingId, setRemoveStaffSavingId] = useState(null)
  const [showTransferCustomerModal, setShowTransferCustomerModal] = useState(false)
  const [selectedCustomerForTransfer, setSelectedCustomerForTransfer] = useState(null)
  const [transferTargetBranchId, setTransferTargetBranchId] = useState('')
  const [transferTargetRouteId, setTransferTargetRouteId] = useState('')
  const [transferSaving, setTransferSaving] = useState(false)
  const allBranches = (contextBranches || []).filter(b => b.id !== parseInt(id, 10))
  const allRoutes = contextRoutes || []
  const fetchBranchExpenses = useCallback(async () => {
    if (!id) return
    try {
      setBranchExpensesLoading(true)
      const res = await expensesAPI.getExpenses({
        branchId: parseInt(id, 10),
        fromDate,
        toDate,
        pageSize: 100
      })
      if (res?.success && res?.data?.items) {
        setBranchExpenses(res.data.items)
      } else {
        setBranchExpenses([])
      }
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to load branch expenses')
      setBranchExpenses([])
    } finally {
      setBranchExpensesLoading(false)
    }
  }, [id, fromDate, toDate])
  const fetchExpenseCategories = useCallback(async () => {
    try {
      const res = await expensesAPI.getExpenseCategories()
      if (res?.success && res?.data && Array.isArray(res.data)) {
        setExpenseCategories(res.data.map(c => ({ value: c.id, label: c.name })))
      } else {
        setExpenseCategories([])
      }
    } catch {
      setExpenseCategories([])
    }
  }, [])
  useEffect(() => {
    if (!id) return
    const loadBranch = async () => {
      try {
        const res = await branchesAPI.getBranch(id)
        if (res?.success && res?.data) {
          setBranch(res.data)
          setEditForm({ name: res.data.name || '', address: res.data.address || '' })
        } else setBranch(null)
      } catch {
        setBranch(null)
      }
    }
    loadBranch()
  }, [id])

  useEffect(() => {
    if (!id) return
    const loadSummary = async () => {
      try {
        setLoading(true)
        setSummaryError(null)
        const res = await branchesAPI.getBranchSummary(id, fromDate, toDate)
        if (res?.success && res?.data) {
          setSummary(res.data)
          setSummaryError(null)
        } else {
          setSummary(null)
          setSummaryError(res?.message || 'No data returned')
        }
      } catch (e) {
        const msg = e?.response?.data?.message || e?.message || 'Failed to load branch summary'
        if (!e?._handledByInterceptor) toast.error(msg)
        setSummaryError(msg)
        setSummary(null)
      } finally {
        setLoading(false)
      }
    }
    loadSummary()
  }, [id, fromDate, toDate])
  useEffect(() => {
    fetchBranchExpenses()
  }, [fetchBranchExpenses])

  useEffect(() => {
    if (activeTab === 'customers' && id) {
      setBranchCustomersLoading(true)
      customersAPI.getCustomers({ branchId: parseInt(id, 10), pageSize: 200 })
        .then(res => {
          if (res?.success && res?.data?.items) setBranchCustomers(res.data.items)
          else setBranchCustomers([])
        })
        .catch(() => setBranchCustomers([]))
        .finally(() => setBranchCustomersLoading(false))
    }
  }, [activeTab, id])

  useEffect(() => {
    if (activeTab === 'staff' && id) {
      adminAPI.getUsers()
        .then(res => {
          if (res?.success && res?.data) {
            const bid = parseInt(id, 10)
            const items = res.data?.items ?? (Array.isArray(res.data) ? res.data : [])
            const staff = items.filter(u => (u.assignedBranchIds || []).includes(bid))
            setBranchStaff(staff)
          } else setBranchStaff([])
        })
        .catch(() => setBranchStaff([]))
    }
  }, [activeTab, id])

  // allBranches and allRoutes from shared context (no fetch when modal opens)

  const applyDateRange = () => {
    setFromDate(dateDraft.from)
    setToDate(dateDraft.to)
  }

  const retrySummary = () => {
    setSummaryError(null)
    if (!id) return
    setLoading(true)
    branchesAPI.getBranchSummary(id, fromDate, toDate)
      .then(res => {
        if (res?.success && res?.data) {
          setSummary(res.data)
          setSummaryError(null)
        } else {
          setSummaryError(res?.message || 'No data returned')
        }
      })
      .catch(e => {
        setSummaryError(e?.response?.data?.message || e?.message || 'Failed to load')
        setSummary(null)
      })
      .finally(() => setLoading(false))
  }

  const canManage = isAdminOrOwner(user)

  const branchRouteIds = (summary?.routes ?? []).map(r => r.routeId ?? r.id)
  const routeIdToName = Object.fromEntries((summary?.routes ?? []).map(r => [r.routeId ?? r.id, r.routeName ?? r.name ?? '']))

  const openAssignStaffModal = async () => {
    setShowAssignStaffModal(true)
    setAssignStaffLoadError(null)
    setAssignStaffLoading(true)
    setStaffToAssignList([])
    try {
      const res = await adminAPI.getUsers()
      const rawData = res?.data
      const items = Array.isArray(rawData) ? rawData : (rawData?.items ?? [])
      const bid = parseInt(id, 10)
      const alreadyAssignedIds = new Set(branchStaff.map(u => u.id))
      const staff = items.filter(u => (u.role || '').toLowerCase() === 'staff' && !alreadyAssignedIds.has(u.id))
      setStaffToAssignList(staff)
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Failed to load users'
      setAssignStaffLoadError(msg)
      toast.error(msg)
    } finally {
      setAssignStaffLoading(false)
    }
  }

  const handleAssignStaff = async (user) => {
    const bid = parseInt(id, 10)
    if ((user.assignedBranchIds || []).includes(bid)) return
    const nextBranchIds = [...(user.assignedBranchIds || []), bid]
    try {
      setAssignStaffSaving(true)
      const res = await adminAPI.updateUser(user.id, {
        assignedBranchIds: nextBranchIds,
        assignedRouteIds: user.assignedRouteIds || []
      })
      if (res?.success) {
        toast.success(`${user.name} assigned to this branch`)
        setShowAssignStaffModal(false)
        const listRes = await adminAPI.getUsers()
        const items = listRes?.success && listRes?.data ? (listRes.data?.items ?? (Array.isArray(listRes.data) ? listRes.data : [])) : []
        setBranchStaff(items.filter(u => (u.assignedBranchIds || []).includes(bid)))
      } else toast.error(res?.message || 'Failed to assign')
    } catch (e) {
      if (!e?._handledByInterceptor) {
        const msg = e?.response?.data?.message || e?.response?.data?.errors?.[0] || e?.message || 'Failed to assign'
        toast.error(msg)
      }
    } finally {
      setAssignStaffSaving(false)
    }
  }

  const handleRemoveStaff = async (user) => {
    const bid = parseInt(id, 10)
    const nextBranchIds = (user.assignedBranchIds || []).filter(b => b !== bid)
    const nextRouteIds = (user.assignedRouteIds || []).filter(rid => !branchRouteIds.includes(rid))
    try {
      setRemoveStaffSavingId(user.id)
      const res = await adminAPI.updateUser(user.id, {
        assignedBranchIds: nextBranchIds,
        assignedRouteIds: nextRouteIds
      })
      if (res?.success) {
        toast.success(`${user.name} removed from this branch`)
        setBranchStaff(prev => prev.filter(u => u.id !== user.id))
      } else toast.error(res?.message || 'Failed to remove')
    } catch (e) {
      if (!e?._handledByInterceptor) {
        const msg = e?.response?.data?.message || e?.response?.data?.errors?.[0] || e?.message || 'Failed to remove'
        toast.error(msg)
      }
    } finally {
      setRemoveStaffSavingId(null)
    }
  }

  const handleEditBranch = async (e) => {
    e?.preventDefault()
    if (!editForm.name?.trim()) {
      toast.error('Branch name is required')
      return
    }
    try {
      setSaving(true)
      const res = await branchesAPI.updateBranch(id, {
        name: editForm.name.trim(),
        address: editForm.address?.trim() || undefined
      })
      if (res?.success) {
        toast.success('Branch updated')
        setShowEditModal(false)
        setBranch(prev => prev ? { ...prev, name: editForm.name.trim(), address: editForm.address?.trim() || '' } : null)
        const sumRes = await branchesAPI.getBranchSummary(id, fromDate, toDate)
        if (sumRes?.success && sumRes?.data) setSummary(sumRes.data)
      } else toast.error(res?.message || 'Failed to update')
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to update branch')
    } finally {
      setSaving(false)
    }
  }

  const handleAddRoute = async (e) => {
    e?.preventDefault()
    if (!routeName?.trim()) {
      toast.error('Route name is required')
      return
    }
    try {
      setSaving(true)
      const res = await routesAPI.createRoute({ name: routeName.trim(), branchId: parseInt(id, 10) })
      if (res?.success) {
        toast.success('Route created')
        setShowAddRouteModal(false)
        setRouteName('')
        const sumRes = await branchesAPI.getBranchSummary(id, fromDate, toDate)
        if (sumRes?.success && sumRes?.data) setSummary(sumRes.data)
      } else toast.error(res?.message || 'Failed to create route')
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to create route')
    } finally {
      setSaving(false)
    }
  }

  const openAddExpenseModal = () => {
    setExpenseForm({ categoryId: '', amount: '', date: new Date().toISOString().split('T')[0], note: '' })
    setSelectedExpenseForEdit(null)
    fetchExpenseCategories()
    setShowAddExpenseModal(true)
  }
  const handleExpenseSubmit = async (e) => {
    e?.preventDefault()
    const catId = expenseForm.categoryId ? parseInt(expenseForm.categoryId, 10) : null
    const amt = parseFloat(expenseForm.amount)
    if (!catId || !expenseForm.date || isNaN(amt) || amt <= 0) {
      toast.error('Category, date and a positive amount are required')
      return
    }
    if (amt > 999999.99) {
      toast.error('Amount cannot exceed 999,999.99 AED')
      return
    }
    if (amt !== Math.round(amt * 100) / 100) {
      toast.error('Amount must have at most 2 decimal places')
      return
    }
    const expDate = new Date(expenseForm.date)
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    if (expDate > today) {
      toast.error('Expense date cannot be in the future')
      return
    }
    const twoYearsAgo = new Date()
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
    if (expDate < twoYearsAgo) {
      toast.error('Expense date cannot be older than 2 years')
      return
    }
    try {
      setExpenseSaving(true)
      const payload = {
        categoryId: catId,
        amount: amt,
        date: new Date(expenseForm.date).toISOString(),
        note: expenseForm.note?.trim() || '',
        branchId: parseInt(id, 10)
      }
      if (selectedExpenseForEdit) {
        const res = await expensesAPI.updateExpense(selectedExpenseForEdit.id, payload)
        if (res?.success) {
          toast.success('Expense updated', { id: 'branch-expense-save' })
          setShowAddExpenseModal(false)
          fetchBranchExpenses()
          const sumRes = await branchesAPI.getBranchSummary(id, fromDate, toDate)
          if (sumRes?.success && sumRes?.data) setSummary(sumRes.data)
        } else toast.error(res?.message || 'Failed to update')
      } else {
        const res = await expensesAPI.createExpense(payload)
        if (res?.success) {
          toast.success('Expense added', { id: 'branch-expense-save' })
          setShowAddExpenseModal(false)
          fetchBranchExpenses()
          const sumRes = await branchesAPI.getBranchSummary(id, fromDate, toDate)
          if (sumRes?.success && sumRes?.data) setSummary(sumRes.data)
        } else toast.error(res?.message || 'Failed to add')
      }
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to save expense')
    } finally {
      setExpenseSaving(false)
    }
  }
  const handleEditExpense = (exp) => {
    setSelectedExpenseForEdit(exp)
    setExpenseForm({
      categoryId: String(exp.categoryId || ''),
      amount: String(exp.amount || ''),
      date: exp.date ? new Date(exp.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      note: exp.note || ''
    })
    fetchExpenseCategories()
    setShowAddExpenseModal(true)
  }
  const handleTransferCustomer = async (e) => {
    e?.preventDefault()
    if (!selectedCustomerForTransfer) return
    const targetBranchId = transferTargetBranchId ? parseInt(transferTargetBranchId, 10) : null
    const targetRouteId = transferTargetRouteId ? parseInt(transferTargetRouteId, 10) : null
    
    if (!targetBranchId) {
      toast.error('Please select a target branch')
      return
    }
    
    try {
      setTransferSaving(true)
      const res = await customersAPI.updateCustomer(selectedCustomerForTransfer.id, {
        name: selectedCustomerForTransfer.name,
        phone: selectedCustomerForTransfer.phone || '',
        email: selectedCustomerForTransfer.email || '',
        trn: selectedCustomerForTransfer.trn || '',
        address: selectedCustomerForTransfer.address || '',
        creditLimit: selectedCustomerForTransfer.creditLimit || 0,
        paymentTerms: selectedCustomerForTransfer.paymentTerms || '',
        customerType: selectedCustomerForTransfer.customerType || 'Credit',
        branchId: targetBranchId,
        routeId: targetRouteId
      })
      if (res?.success) {
        toast.success(`Customer transferred to ${allBranches.find(b => b.id === targetBranchId)?.name || 'branch'}`)
        setShowTransferCustomerModal(false)
        setSelectedCustomerForTransfer(null)
        setTransferTargetBranchId('')
        setTransferTargetRouteId('')
        // Refresh customers list
        if (activeTab === 'customers') {
          setBranchCustomersLoading(true)
          customersAPI.getCustomers({ branchId: parseInt(id, 10), pageSize: 200 })
            .then(res => {
              if (res?.success && res?.data?.items) setBranchCustomers(res.data.items)
              else setBranchCustomers([])
            })
            .catch(() => setBranchCustomers([]))
            .finally(() => setBranchCustomersLoading(false))
        }
      } else {
        toast.error(res?.message || 'Failed to transfer customer')
      }
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to transfer customer')
    } finally {
      setTransferSaving(false)
    }
  }

  const handleDeleteExpense = (exp) => {
    setExpenseDangerModal({
      isOpen: true,
      title: 'Delete Branch Expense?',
      message: `Delete ${exp.categoryName || 'this'} expense of ${formatCurrency(exp.amount || 0)}?`,
      onConfirm: async () => {
        try {
          const res = await expensesAPI.deleteExpense(exp.id)
          if (res?.success) {
            toast.success('Expense deleted', { id: 'branch-expense-delete' })
            fetchBranchExpenses()
            const sumRes = await branchesAPI.getBranchSummary(id, fromDate, toDate)
            if (sumRes?.success && sumRes?.data) setSummary(sumRes.data)
          } else toast.error(res?.message || 'Failed to delete')
        } catch (err) {
          if (!err?._handledByInterceptor) toast.error(err?.message || 'Failed to delete')
        }
        setExpenseDangerModal(prev => ({ ...prev, isOpen: false }))
      }
    })
  }
  const branchExpensesTotal = branchExpenses.reduce((s, e) => s + (e.amount || 0), 0)

  if (loading && !summary && !branch) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary-600 border-t-transparent" />
      </div>
    )
  }

  const displayBranch = branch || (summary ? { name: summary.branchName, address: '' } : null)
  if (!displayBranch) {
    return (
      <div className="p-6">
        <p className="text-neutral-600">Branch not found.</p>
        <Link to="/branches" className="text-primary-600 hover:underline mt-2 inline-block">Back to Branches</Link>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Link to="/branches" className="inline-flex items-center gap-1 text-primary-600 hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Back to Branches
        </Link>
        {canManage && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowEditModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-neutral-300 rounded-lg hover:bg-neutral-50 text-sm font-medium"
            >
              <Pencil className="h-4 w-4" />
              Edit Branch
            </button>
            <button
              type="button"
              onClick={() => setShowAddRouteModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Route
            </button>
          </div>
        )}
      </div>
      {summaryError && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>Failed to load summary. Check backend logs.</span>
          <button type="button" onClick={retrySummary} className="shrink-0 font-medium text-amber-700 hover:underline">Retry</button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-primary-50">
          <Building2 className="h-5 w-5 text-primary-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">{displayBranch.name}</h1>
          {displayBranch.address ? (
            <p className="text-xs text-neutral-500 flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {displayBranch.address}
            </p>
          ) : (
            <p className="text-xs text-neutral-500">Branch summary</p>
          )}
        </div>
      </div>

      <div className="border-b border-neutral-200 mb-3 overflow-x-auto">
        <nav className="-mb-px flex gap-2 min-w-max">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2 px-1.5 border-b-2 font-medium text-xs whitespace-nowrap shrink-0 ${activeTab === tab ? 'border-primary-600 text-primary-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            <div className="bg-white rounded-lg border border-neutral-200 p-2.5">
              <p className="text-xs text-neutral-500">Total Sales</p>
              {loading ? <div className="h-6 flex items-center"><div className="animate-spin rounded-full h-3 w-3 border-2 border-primary-600 border-t-transparent" /></div> : <p className="text-base font-semibold text-neutral-900">{formatCurrency(summary?.totalSales ?? 0)}</p>}
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-2.5">
              <p className="text-xs text-neutral-500">Paid</p>
              {loading ? <div className="h-6 flex items-center"><div className="animate-spin rounded-full h-3 w-3 border-2 border-primary-600 border-t-transparent" /></div> : <p className="text-base font-semibold text-emerald-600">{formatCurrency(summary?.totalPayments ?? 0)}</p>}
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-2.5">
              <p className="text-xs text-neutral-500">Unpaid</p>
              {loading ? <div className="h-6 flex items-center"><div className="animate-spin rounded-full h-3 w-3 border-2 border-primary-600 border-t-transparent" /></div> : <p className="text-base font-semibold text-amber-600">{formatCurrency(summary?.unpaidAmount ?? 0)}</p>}
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-2.5">
              <p className="text-xs text-neutral-500">COGS</p>
              {loading ? <div className="h-6 flex items-center"><div className="animate-spin rounded-full h-3 w-3 border-2 border-primary-600 border-t-transparent" /></div> : <p className="text-base font-semibold text-neutral-900">{formatCurrency(summary?.costOfGoodsSold ?? 0)}</p>}
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-2.5">
              <p className="text-xs text-neutral-500">Expenses</p>
              {loading ? <div className="h-6 flex items-center"><div className="animate-spin rounded-full h-3 w-3 border-2 border-primary-600 border-t-transparent" /></div> : <p className="text-base font-semibold text-neutral-900">{formatCurrency(summary?.totalExpenses ?? 0)}</p>}
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-2.5">
              <p className="text-xs text-neutral-500">Profit / Loss</p>
              {loading ? <div className="h-6 flex items-center"><div className="animate-spin rounded-full h-3 w-3 border-2 border-primary-600 border-t-transparent" /></div> : <p className={`text-base font-semibold ${(summary?.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(summary?.profit ?? 0)}</p>}
            </div>
          </div>
          <p className="text-xs text-neutral-500 mb-1">Date range: {fromDate} to {toDate}</p>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input type="date" value={dateDraft.from} onChange={(e) => setDateDraft(prev => ({ ...prev, from: e.target.value }))} className="border border-neutral-300 rounded px-2 py-1 text-xs" />
            <span className="text-neutral-500 text-sm">to</span>
            <input type="date" value={dateDraft.to} onChange={(e) => setDateDraft(prev => ({ ...prev, to: e.target.value }))} className="border border-neutral-300 rounded px-2 py-1 text-xs" />
            <button type="button" onClick={applyDateRange} className="inline-flex items-center gap-1 px-2 py-1 bg-primary-600 text-white text-xs font-medium rounded hover:bg-primary-700"><Filter className="h-3 w-3" />Apply</button>
          </div>
          <h2 className="text-sm font-medium text-neutral-800 mb-2">Routes</h2>
          {(!summary?.routes || summary.routes.length === 0) ? (
            <p className="text-sm text-neutral-500">No routes in this branch.{canManage && ' Click "Add Route" to create one.'}</p>
          ) : (
            <ul className="space-y-1.5">
              {summary.routes?.map((r) => (
                <li key={r.routeId || r.id} className="flex items-center justify-between py-2 px-2.5 bg-white rounded border border-neutral-200 text-sm">
                  <Link
                    to={`/routes/${r.routeId || r.id}?fromDate=${fromDate}&toDate=${toDate}`}
                    className="font-medium text-primary-600 hover:underline"
                  >
                    {r.routeName || r.name}
                  </Link>
                  <div className="flex gap-3 flex-wrap text-xs">
                    {(r.invoiceCount ?? 0) > 0 && <span className="text-neutral-500">{r.invoiceCount} inv.</span>}
                    <span className="text-neutral-600">Sales: {formatCurrency(r.totalSales)}</span>
                    <span className="text-neutral-600">Exp: {formatCurrency(r.totalExpenses)}</span>
                    <span className={r.profit >= 0 ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>P/L: {formatCurrency(r.profit)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {activeTab === 'routes' && (
        <div>
          <p className="text-xs text-neutral-500 mb-1">Date range: {fromDate} to {toDate}</p>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input type="date" value={dateDraft.from} onChange={(e) => setDateDraft(prev => ({ ...prev, from: e.target.value }))} className="border border-neutral-300 rounded px-2 py-1 text-xs" />
            <span className="text-neutral-500 text-sm">to</span>
            <input type="date" value={dateDraft.to} onChange={(e) => setDateDraft(prev => ({ ...prev, to: e.target.value }))} className="border border-neutral-300 rounded px-2 py-1 text-xs" />
            <button type="button" onClick={applyDateRange} className="inline-flex items-center gap-1 px-2 py-1 bg-primary-600 text-white text-xs font-medium rounded hover:bg-primary-700"><Filter className="h-3 w-3" />Apply</button>
          </div>
          {(!summary?.routes || summary.routes.length === 0) ? (
            <p className="text-sm text-neutral-500 py-4">No routes yet. {canManage && 'Click "Add Route" above.'}</p>
          ) : (
            <div className="overflow-x-auto border border-neutral-200 rounded-lg">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-neutral-600 uppercase">Route</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Invoices</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Sales</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Expenses</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Profit / Loss</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {summary.routes?.map((r) => (
                  <tr key={r.routeId || r.id} className="hover:bg-neutral-50">
                      <td className="px-2 py-1.5">
                        <Link
                          to={`/routes/${r.routeId || r.id}?fromDate=${fromDate}&toDate=${toDate}`}
                          className="font-medium text-primary-600 hover:underline"
                        >
                          {r.routeName || r.name}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-right text-neutral-600">{r.invoiceCount ?? 0}</td>
                      <td className="px-2 py-1.5 text-right">{formatCurrency(r.totalSales)}</td>
                      <td className="px-2 py-1.5 text-right">{formatCurrency(r.totalExpenses)}</td>
                      <td className={`px-2 py-1.5 text-right font-medium ${(r.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(r.profit)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Link
                          to={`/routes/${r.routeId || r.id}?fromDate=${fromDate}&toDate=${toDate}`}
                          className="text-primary-600 hover:underline text-xs"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'staff' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-neutral-500">Staff assigned to this branch. You can assign or remove from here.</p>
            {canManage && (
              <button
                type="button"
                onClick={openAssignStaffModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
              >
                <UserPlus className="h-4 w-4" />
                Assign staff
              </button>
            )}
          </div>
          {branchStaff.length === 0 ? (
            <p className="text-neutral-500 py-6">No staff assigned to this branch. {canManage && 'Click "Assign staff" or assign from the Users page.'}</p>
          ) : (
            <div className="overflow-x-auto border border-neutral-200 rounded-lg">
              <table className="min-w-[520px] w-full divide-y divide-neutral-200">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase whitespace-nowrap">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase whitespace-nowrap">Email</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase min-w-[140px]" title="Assigned routes (this branch)">
                      <span className="hidden sm:inline">Assigned routes (this branch)</span>
                      <span className="sm:hidden">Routes</span>
                    </th>
                    {canManage && <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase whitespace-nowrap">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {branchStaff.map(u => {
                    const routeNames = (u.assignedRouteIds || [])
                      .filter(rid => branchRouteIds.includes(rid))
                      .map(rid => routeIdToName[rid] || `Route #${rid}`)
                    return (
                      <tr key={u.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-2 font-medium whitespace-nowrap">{u.name}</td>
                        <td className="px-4 py-2 text-sm text-neutral-600 min-w-[140px]">{u.email || '—'}</td>
                        <td className="px-4 py-2 text-sm min-w-[120px]">{routeNames.length ? routeNames.join(', ') : '—'}</td>
                        {canManage && (
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveStaff(u)}
                              disabled={removeStaffSavingId === u.id}
                              className="text-red-600 hover:bg-red-50 rounded px-2 py-1 text-sm font-medium disabled:opacity-50"
                            >
                              {removeStaffSavingId === u.id ? 'Removing…' : 'Remove'}
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {showAssignStaffModal && (
            <Modal
              isOpen={true}
              title="Assign staff to this branch"
              onClose={() => !assignStaffSaving && setShowAssignStaffModal(false)}
              size="md"
            >
              {assignStaffLoading ? (
                <div className="py-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" /></div>
              ) : assignStaffLoadError ? (
                <div className="py-4">
                  <p className="text-red-600 mb-4">{assignStaffLoadError}</p>
                  <button type="button" onClick={openAssignStaffModal} className="px-3 py-2 bg-primary-600 text-white rounded text-sm hover:bg-primary-700">Retry</button>
                </div>
              ) : staffToAssignList.length === 0 ? (
                <p className="text-neutral-500 py-4">No other staff to assign. Create Staff users from the Users page first, or all Staff are already assigned to this branch.</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {staffToAssignList.map(u => (
                    <li key={u.id} className="flex items-center justify-between p-2 rounded border border-neutral-200 hover:bg-neutral-50">
                      <span className="font-medium">{u.name}</span>
                      <span className="text-sm text-neutral-500">{u.email}</span>
                      <button
                        type="button"
                        onClick={() => handleAssignStaff(u)}
                        disabled={assignStaffSaving}
                        className="px-3 py-1 bg-primary-600 text-white rounded text-sm hover:bg-primary-700 disabled:opacity-50"
                      >
                        Assign
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Modal>
          )}
        </div>
      )}

      {activeTab === 'customers' && (
        <div>
          <p className="text-sm text-neutral-500 mb-4">Customers in this branch (from branch/route assignment).</p>
          {branchCustomersLoading ? (
            <div className="py-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" /></div>
          ) : branchCustomers.length === 0 ? (
            <p className="text-neutral-500 py-6">No customers in this branch. Add customers and assign them to a route in this branch.</p>
          ) : (
            <div className="overflow-x-auto border border-neutral-200 rounded-lg">
              <table className="min-w-full divide-y divide-neutral-200">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Customer</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Phone</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase">Balance</th>
                    {canManage && <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {branchCustomers.map(c => (
                    <tr key={c.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-4 py-2 text-sm">{c.phone || '—'}</td>
                      <td className="px-4 py-2 text-sm text-right">{formatCurrency(c.balance ?? c.pendingBalance ?? 0)}</td>
                      {canManage && (
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" onClick={() => navigate(`/ledger?customerId=${c.id}`)} className="text-primary-600 hover:underline text-sm">Ledger</button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomerForTransfer(c)
                                setTransferTargetBranchId('')
                                setTransferTargetRouteId('')
                                setShowTransferCustomerModal(true)
                              }}
                              className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-primary-600"
                              title="Transfer to another branch"
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              Transfer
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'expenses' && (
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium text-neutral-800 flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Branch Expenses
          </h2>
          {canManage && (
            <button
              type="button"
              onClick={openAddExpenseModal}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Expense
            </button>
          )}
        </div>
        <p className="text-sm text-neutral-500 mb-3">
          Branch-level overhead (rent, utilities, etc.) for {displayBranch.name}. Monthly total: {formatCurrency(branchExpensesTotal)}
        </p>
        {branchExpensesLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" />
          </div>
        ) : branchExpenses.length === 0 ? (
          <p className="text-neutral-500 py-4 bg-white rounded-lg border border-neutral-200 text-center">
            No branch expenses in this period. {canManage && 'Click "Add Expense" to record rent, utilities, etc.'}
          </p>
        ) : (
          <div className="overflow-x-auto border border-neutral-200 rounded-lg">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Category</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Amount</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Description</th>
                  {canManage && <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white">
                {branchExpenses.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 text-sm text-neutral-900">
                      {e.date ? new Date(e.date).toLocaleDateString('en-GB') : '-'}
                    </td>
                    <td className="px-4 py-2 text-sm text-neutral-900">{e.categoryName || 'Uncategorized'}</td>
                    <td className="px-4 py-2 text-sm font-medium text-neutral-900">{formatCurrency(e.amount || 0)}</td>
                    <td className="px-4 py-2 text-sm text-neutral-500 max-w-[200px] truncate">{e.note || '-'}</td>
                    {canManage && (
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleEditExpense(e)}
                          className="p-1 text-primary-600 hover:bg-primary-50 rounded"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(e)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded ml-1"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {activeTab === 'performance' && (
        <div>
          <p className="text-sm text-neutral-500 mb-2">Date range: {fromDate} to {toDate}</p>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <input type="date" value={dateDraft.from} onChange={(e) => setDateDraft(prev => ({ ...prev, from: e.target.value }))} className="border border-neutral-300 rounded px-2 py-1 text-sm" />
            <span className="text-neutral-500">to</span>
            <input type="date" value={dateDraft.to} onChange={(e) => setDateDraft(prev => ({ ...prev, to: e.target.value }))} className="border border-neutral-300 rounded px-2 py-1 text-sm" />
            <button type="button" onClick={applyDateRange} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded hover:bg-primary-700"><Filter className="h-3.5 w-3.5" />Apply</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-neutral-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-primary-600" />
                <p className="text-sm text-neutral-500">Growth %</p>
              </div>
              {loading ? (
                <div className="h-7 flex items-center"><div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-600 border-t-transparent" /></div>
              ) : (
                <p className={`text-lg font-semibold ${(summary?.growthPercent ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {summary?.growthPercent != null ? `${summary.growthPercent >= 0 ? '+' : ''}${summary.growthPercent.toFixed(1)}%` : '—'}
                </p>
              )}
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-primary-600" />
                <p className="text-sm text-neutral-500">Collections Ratio</p>
              </div>
              {loading ? (
                <div className="h-7 flex items-center"><div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-600 border-t-transparent" /></div>
              ) : (
                <p className="text-lg font-semibold text-neutral-900">
                  {summary?.collectionsRatio != null ? `${summary.collectionsRatio.toFixed(1)}%` : '—'}
                </p>
              )}
              {summary?.collectionsRatio != null && (
                <p className="text-xs text-neutral-500 mt-1">
                  {formatCurrency(summary.totalPayments ?? 0)} / {formatCurrency(summary.totalSales ?? 0)}
                </p>
              )}
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-primary-600" />
                <p className="text-sm text-neutral-500">Avg Invoice Size</p>
              </div>
              {loading ? (
                <div className="h-7 flex items-center"><div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-600 border-t-transparent" /></div>
              ) : (
                <p className="text-lg font-semibold text-neutral-900">
                  {summary?.averageInvoiceSize != null ? formatCurrency(summary.averageInvoiceSize) : '—'}
                </p>
              )}
              {summary?.invoiceCount != null && (
                <p className="text-xs text-neutral-500 mt-1">{summary.invoiceCount} invoice{summary.invoiceCount !== 1 ? 's' : ''}</p>
              )}
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-primary-600" />
                <p className="text-sm text-neutral-500">Total Customers</p>
              </div>
              <p className="text-lg font-semibold text-neutral-900">{branchCustomers.length}</p>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-neutral-200 p-4">
            <h3 className="text-md font-medium text-neutral-800 mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Performance Summary
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-neutral-500">Total Sales</p>
                <p className="text-xl font-semibold text-neutral-900">{formatCurrency(summary?.totalSales ?? 0)}</p>
              </div>
              <div>
                <p className="text-sm text-neutral-500">Total Payments Collected</p>
                <p className="text-xl font-semibold text-emerald-600">{formatCurrency(summary?.totalPayments ?? 0)}</p>
              </div>
              <div>
                <p className="text-sm text-neutral-500">Profit Margin</p>
                <p className={`text-xl font-semibold ${(summary?.totalSales ?? 0) > 0 && ((summary?.profit ?? 0) / (summary?.totalSales ?? 1) * 100) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {(summary?.totalSales ?? 0) > 0 ? `${((summary?.profit ?? 0) / summary.totalSales * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div>
                <p className="text-sm text-neutral-500">Profit</p>
                <p className={`text-xl font-semibold ${(summary?.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCurrency(summary?.profit ?? 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'report' && (
        <div>
          <p className="text-sm text-neutral-500 mb-2">Date range: {fromDate} to {toDate}</p>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <input type="date" value={dateDraft.from} onChange={(e) => setDateDraft(prev => ({ ...prev, from: e.target.value }))} className="border border-neutral-300 rounded px-2 py-1 text-sm" />
            <span className="text-neutral-500">to</span>
            <input type="date" value={dateDraft.to} onChange={(e) => setDateDraft(prev => ({ ...prev, to: e.target.value }))} className="border border-neutral-300 rounded px-2 py-1 text-sm" />
            <button type="button" onClick={applyDateRange} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded hover:bg-primary-700"><Filter className="h-3.5 w-3.5" />Apply</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-neutral-200 p-4">
              <p className="text-sm text-neutral-500">Total Sales</p>
              <p className="text-xl font-semibold text-neutral-900">{formatCurrency(summary?.totalSales ?? 0)}</p>
            </div>
            <div className="bg-white rounded-lg border border-neutral-200 p-4">
              <p className="text-sm text-neutral-500">Total Expenses (Branch + Routes)</p>
              <p className="text-xl font-semibold text-neutral-900">{formatCurrency(summary?.totalExpenses ?? 0)}</p>
            </div>
          </div>
          <h3 className="text-sm font-medium text-neutral-800 mb-2 flex items-center gap-2"><BarChart3 className="h-4 w-4" />Route performance in this branch</h3>
          {summary?.routes?.length > 0 ? (
            <div className="overflow-x-auto border border-neutral-200 rounded-lg">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-xs font-medium text-neutral-600 uppercase">Route</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Invoices</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Sales</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Expenses</th>
                    <th className="px-2 py-1.5 text-right text-xs font-medium text-neutral-600 uppercase">Profit / Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {summary.routes.map((r) => (
                    <tr key={r.routeId || r.id}>
                      <td className="px-2 py-1.5 font-medium">{r.routeName || r.name}</td>
                      <td className="px-2 py-1.5 text-right">{r.invoiceCount ?? 0}</td>
                      <td className="px-2 py-1.5 text-right">{formatCurrency(r.totalSales)}</td>
                      <td className="px-2 py-1.5 text-right">{formatCurrency(r.totalExpenses)}</td>
                      <td className={`px-2 py-1.5 text-right font-medium ${(r.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-neutral-500 py-4">No routes in this branch to report on.</p>
          )}
        </div>
      )}

      {showEditModal && (
        <Modal isOpen title="Edit Branch" onClose={() => !saving && setShowEditModal(false)}>
          <form onSubmit={handleEditBranch} className="space-y-4">
            <Input
              label="Branch Name"
              value={editForm.name}
              onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
              required
            />
            <Input label="Address (optional)" value={editForm.address} onChange={(e) => setEditForm(prev => ({ ...prev, address: e.target.value }))} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showAddRouteModal && (
        <Modal isOpen title="Add Route" onClose={() => !saving && setShowAddRouteModal(false)}>
          <form onSubmit={handleAddRoute} className="space-y-4">
            <p className="text-sm text-neutral-600">Adding route to branch: <strong>{displayBranch.name}</strong></p>
            <Input label="Route Name" value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="e.g. Route A" required />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddRouteModal(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Creating...' : 'Create Route'}</button>
            </div>
          </form>
        </Modal>
      )}

      {showAddExpenseModal && (
        <Modal
          isOpen
          title={selectedExpenseForEdit ? 'Edit Branch Expense' : 'Add Branch Expense'}
          onClose={() => !expenseSaving && setShowAddExpenseModal(false)}
        >
          <form onSubmit={handleExpenseSubmit} className="space-y-4">
            <p className="text-sm text-neutral-600">Branch: <strong>{displayBranch.name}</strong></p>
            <div>
              <label className="block text-sm font-semibold text-neutral-700 mb-1">Category <span className="text-red-500">*</span></label>
              <select
                value={expenseForm.categoryId}
                onChange={(e) => setExpenseForm(prev => ({ ...prev, categoryId: e.target.value }))}
                className="block w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-neutral-900 sm:text-sm"
                required
              >
                <option value="">Select category</option>
                {expenseCategories.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Input
              label="Amount"
              type="number"
              step="0.01"
              min="0.01"
              value={expenseForm.amount}
              onChange={(e) => setExpenseForm(prev => ({ ...prev, amount: e.target.value }))}
              required
            />
            <Input
              label="Date"
              type="date"
              value={expenseForm.date}
              onChange={(e) => setExpenseForm(prev => ({ ...prev, date: e.target.value }))}
              required
            />
            <TextArea
              label="Description"
              placeholder="Optional note..."
              value={expenseForm.note}
              onChange={(e) => setExpenseForm(prev => ({ ...prev, note: e.target.value }))}
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddExpenseModal(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={expenseSaving} className="px-4 py-2 bg-primary-600 text-white rounded-lg disabled:opacity-50">
                {expenseSaving ? 'Saving...' : selectedExpenseForEdit ? 'Update' : 'Add Expense'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDangerModal
        isOpen={expenseDangerModal.isOpen}
        title={expenseDangerModal.title}
        message={expenseDangerModal.message}
        onClose={() => setExpenseDangerModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={expenseDangerModal.onConfirm}
        confirmLabel="Delete"
      />

      {showTransferCustomerModal && selectedCustomerForTransfer && (
        <Modal
          isOpen
          title="Transfer Customer to Another Branch"
          onClose={() => !transferSaving && setShowTransferCustomerModal(false)}
        >
          <form onSubmit={handleTransferCustomer} className="space-y-4">
            <div className="bg-neutral-50 p-3 rounded-lg">
              <p className="text-sm font-medium text-neutral-900">Customer: {selectedCustomerForTransfer.name}</p>
              <p className="text-xs text-neutral-500">Current Branch: {displayBranch.name}</p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Target Branch <span className="text-red-500">*</span></label>
              <select
                value={transferTargetBranchId}
                onChange={(e) => {
                  setTransferTargetBranchId(e.target.value)
                  setTransferTargetRouteId('') // Reset route when branch changes
                }}
                required
                className="block w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              >
                <option value="">Select branch</option>
                {allBranches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Target Route (optional)</label>
              <select
                value={transferTargetRouteId}
                onChange={(e) => setTransferTargetRouteId(e.target.value)}
                disabled={!transferTargetBranchId}
                className="block w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm disabled:bg-neutral-100 disabled:cursor-not-allowed"
              >
                <option value="">No route assignment</option>
                {allRoutes
                  .filter(r => transferTargetBranchId && r.branchId === parseInt(transferTargetBranchId, 10))
                  .map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
              </select>
              {!transferTargetBranchId && (
                <p className="text-xs text-neutral-500 mt-1">Select a branch first to see available routes</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTransferCustomerModal(false)}
                disabled={transferSaving}
                className="px-4 py-2 border border-neutral-300 rounded-lg text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={transferSaving}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
              >
                {transferSaving ? 'Transferring...' : 'Transfer Customer'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

export default BranchDetailPage

