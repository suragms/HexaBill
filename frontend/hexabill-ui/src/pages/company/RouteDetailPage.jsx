import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MapPin, ArrowLeft, Plus, Trash2, Edit, Printer, Users, UserPlus, Receipt, BarChart3, TrendingUp, DollarSign, FileText, Calendar } from 'lucide-react'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import { routesAPI, salesAPI, expensesAPI, adminAPI, branchesAPI } from '../../services'
import Modal from '../../components/Modal'
import { Input } from '../../components/Form'
import { isAdminOrOwner } from '../../utils/roles'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import { useAuth } from '../../hooks/useAuth'

const EXPENSE_CATEGORIES = ['Fuel', 'Staff', 'Delivery', 'Vehicle Maintenance', 'Toll/Parking', 'Misc']
const ROUTE_TABS = ['overview', 'customers', 'sales', 'expenses', 'staff', 'performance']

const RouteDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('overview')
  const [route, setRoute] = useState(null)
  const [summary, setSummary] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const urlFrom = searchParams.get('fromDate')
  const urlTo = searchParams.get('toDate')
  const computedDefaultFrom = (() => {
    if (urlFrom) return urlFrom
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })()
  const computedDefaultTo = urlTo || new Date().toISOString().split('T')[0]

  const [fromDate, setFromDate] = useState(computedDefaultFrom)
  const [toDate, setToDate] = useState(computedDefaultTo)
  const [dateDraftFrom, setDateDraftFrom] = useState(computedDefaultFrom)
  const [dateDraftTo, setDateDraftTo] = useState(computedDefaultTo)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expenseCategory, setExpenseCategory] = useState('Misc')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0])
  const [expenseDescription, setExpenseDescription] = useState('')
  const [selectedExpenseForEdit, setSelectedExpenseForEdit] = useState(null)
  const [dangerModal, setDangerModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => { }
  })
  const [collectionSheet, setCollectionSheet] = useState(null)
  const [collectionSheetDate, setCollectionSheetDate] = useState(new Date().toISOString().split('T')[0])
  const [loadingSheet, setLoadingSheet] = useState(false)
  const [routeSales, setRouteSales] = useState([])
  const [routeSalesLoading, setRouteSalesLoading] = useState(false)
  const [generalExpenses, setGeneralExpenses] = useState([])
  const [generalExpensesLoading, setGeneralExpensesLoading] = useState(false)
  const [showTodaysRoute, setShowTodaysRoute] = useState(false)
  const [todaysRouteCustomers, setTodaysRouteCustomers] = useState([])
  const [updatingVisitStatus, setUpdatingVisitStatus] = useState(null) // { customerId: status }
  const [showAssignRouteStaffModal, setShowAssignRouteStaffModal] = useState(false)
  const [routeStaffToAssign, setRouteStaffToAssign] = useState([])
  const [routeStaffAssignLoading, setRouteStaffAssignLoading] = useState(false)
  const [routeStaffAssignSaving, setRouteStaffAssignSaving] = useState(false)
  const [routeStaffRemovingId, setRouteStaffRemovingId] = useState(null)
  const [showEditRouteModal, setShowEditRouteModal] = useState(false)
  const [editRouteForm, setEditRouteForm] = useState({ name: '', branchId: '' })
  const [branches, setBranches] = useState([])
  const [savingRouteEdit, setSavingRouteEdit] = useState(false)

  const canManage = isAdminOrOwner(user)

  const loadRoute = async () => {
    if (!id) return
    try {
      const res = await routesAPI.getRoute(id)
      if (res?.success && res?.data) setRoute(res.data)
      else setRoute(null)
    } catch (e) {
      setRoute(null)
      if (e?.response?.status === 404) {
        toast.error('Route not found')
      }
    }
  }

  const loadSummary = async () => {
    if (!id) return
    try {
      const res = await routesAPI.getRouteSummary(id, fromDate, toDate)
      if (res?.success && res?.data) setSummary(res.data)
      else setSummary(null)
    } catch {
      setSummary(null)
    }
  }

  const loadExpenses = async () => {
    if (!id) return
    try {
      const res = await routesAPI.getRouteExpenses(id, fromDate, toDate)
      if (res?.success && res?.data) setExpenses(res.data)
      else setExpenses([])
    } catch {
      setExpenses([])
    }
  }

  const applyDateRange = () => {
    setFromDate(dateDraftFrom)
    setToDate(dateDraftTo)
  }

  const openAssignRouteStaffModal = async () => {
    setShowAssignRouteStaffModal(true)
    setRouteStaffAssignLoading(true)
    setRouteStaffToAssign([])
    try {
      const res = await adminAPI.getUsers()
      const items = Array.isArray(res?.data) ? res.data : (res?.data?.items ?? [])
      const currentIds = new Set([
        ...(route?.staff || []).map(s => s.userId),
        route?.assignedUserId ? route.assignedUserId : null
      ].filter(Boolean))
      const available = items.filter(u => (u.role || '').toLowerCase() === 'staff' && !currentIds.has(u.id))
      setRouteStaffToAssign(available)
    } catch (e) {
      toast.error('Failed to load staff')
    } finally {
      setRouteStaffAssignLoading(false)
    }
  }

  const handleAssignRouteStaff = async (staffUser) => {
    try {
      setRouteStaffAssignSaving(true)
      const res = await routesAPI.assignStaff(route.id, staffUser.id)
      if (res?.success) {
        toast.success(`${staffUser.name} assigned to this route`)
        setShowAssignRouteStaffModal(false)
        const updated = await routesAPI.getRoute(route.id)
        if (updated?.success && updated?.data) setRoute(updated.data)
      } else {
        toast.error(res?.message || 'Failed to assign staff')
      }
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to assign staff')
    } finally {
      setRouteStaffAssignSaving(false)
    }
  }

  const handleRemoveRouteStaff = async (staffUser) => {
    try {
      setRouteStaffRemovingId(staffUser.userId || staffUser.id)
      const res = await routesAPI.unassignStaff(route.id, staffUser.userId || staffUser.id)
      if (res?.success) {
        toast.success(`${staffUser.userName || staffUser.name} removed from this route`)
        const updated = await routesAPI.getRoute(route.id)
        if (updated?.success && updated?.data) setRoute(updated.data)
      } else {
        toast.error(res?.message || 'Failed to remove staff')
      }
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to remove staff')
    } finally {
      setRouteStaffRemovingId(null)
    }
  }

  // Load route on mount; load summary/expenses when id or applied date range changes.
  useEffect(() => {
    if (!id) return
    setLoading(true)
    loadRoute().finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!id || !route) return
    setLoading(true)
    Promise.all([loadSummary(), loadExpenses()]).finally(() => setLoading(false))
  }, [id, fromDate, toDate, route])

  useEffect(() => {
    if (activeTab === 'sales' && id) {
      setRouteSalesLoading(true)
      salesAPI.getSales({ routeId: parseInt(id, 10), pageSize: 100 })
        .then(res => {
          const items = res?.data?.items ?? res?.items ?? []
          setRouteSales(Array.isArray(items) ? items : [])
        })
        .catch(() => setRouteSales([]))
        .finally(() => setRouteSalesLoading(false))
    }
  }, [activeTab, id])

  useEffect(() => {
    if (activeTab === 'expenses' && id && route?.branchId) {
      setGeneralExpensesLoading(true)
      expensesAPI.getExpenses({ branchId: route.branchId, pageSize: 100 })
        .then(res => {
          const items = res?.data?.items ?? res?.items ?? []
          setGeneralExpenses(Array.isArray(items) ? items : [])
        })
        .catch(() => setGeneralExpenses([]))
        .finally(() => setGeneralExpensesLoading(false))
    }
  }, [activeTab, id, route?.branchId])

  const handleAddExpense = async (e) => {
    e?.preventDefault()
    const amount = parseFloat(expenseAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    try {
      setSaving(true)
      const res = await routesAPI.createRouteExpense(id, {
        category: expenseCategory,
        amount: amount,
        expenseDate: expenseDate,
        description: expenseDescription?.trim() || undefined
      })
      if (res?.success) {
        toast.success('Expense added', { id: 'route-expense-add' })
        setShowExpenseModal(false)
        resetExpenseForm()
        loadExpenses()
        loadSummary()
      } else {
        toast.error(res?.message || 'Failed to add expense')
      }
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to add expense')
    } finally {
      setSaving(false)
    }
  }

  const resetExpenseForm = () => {
    setExpenseCategory('Misc')
    setExpenseAmount('')
    setExpenseDate(new Date().toISOString().split('T')[0])
    setExpenseDescription('')
    setSelectedExpenseForEdit(null)
  }

  const openAddExpenseModal = () => {
    resetExpenseForm()
    setShowExpenseModal(true)
  }

  const openEditExpenseModal = (expense) => {
    setSelectedExpenseForEdit(expense)
    setExpenseCategory(expense.category || 'Misc')
    setExpenseAmount(String(expense.amount ?? ''))
    setExpenseDate((expense.expenseDate || expense.ExpenseDate || '').toString().split('T')[0] || new Date().toISOString().split('T')[0])
    setExpenseDescription(expense.description || expense.Description || '')
    setShowExpenseModal(true)
  }

  const handleUpdateExpense = async (e) => {
    e?.preventDefault()
    if (!selectedExpenseForEdit) return
    const amount = parseFloat(expenseAmount)
    if (isNaN(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    try {
      setSaving(true)
      const res = await routesAPI.updateRouteExpense(id, selectedExpenseForEdit.id, {
        category: expenseCategory,
        amount: amount,
        expenseDate: expenseDate,
        description: expenseDescription?.trim() || undefined
      })
      if (res?.success) {
        toast.success('Expense updated', { id: 'route-expense-update' })
        setShowExpenseModal(false)
        resetExpenseForm()
        loadExpenses()
        loadSummary()
      } else {
        toast.error(res?.message || 'Failed to update expense')
      }
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to update expense')
    } finally {
      setSaving(false)
    }
  }

  const openCollectionSheet = async () => {
    if (!id) return
    setLoadingSheet(true)
    try {
      const res = await routesAPI.getRouteCollectionSheet(id, collectionSheetDate)
      if (res?.success && res?.data) setCollectionSheet(res.data)
      else setCollectionSheet(null)
    } catch {
      setCollectionSheet(null)
      toast.error('Failed to load collection sheet')
    } finally {
      setLoadingSheet(false)
    }
  }

  const handleUpdateVisitStatus = async (customerId, status, notes, paymentCollected) => {
    if (!id) return
    const key = `${customerId}-${status}`
    setUpdatingVisitStatus(key)
    try {
      const res = await routesAPI.updateCustomerVisit(id, customerId, {
        visitDate: collectionSheetDate,
        status: status,
        notes: notes || undefined,
        paymentCollected: paymentCollected || undefined
      })
      if (res?.success) {
        toast.success(`Status updated to ${status === 'PaymentCollected' ? 'Payment Collected' : status}`, { id: `visit-${customerId}` })
        // Refresh collection sheet to get updated data
        const refreshRes = await routesAPI.getRouteCollectionSheet(id, collectionSheetDate)
        if (refreshRes?.success && refreshRes?.data) {
          setCollectionSheet(refreshRes.data)
        }
      } else {
        toast.error(res?.message || 'Failed to update visit status')
      }
    } catch (e) {
      if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to update visit status')
    } finally {
      setUpdatingVisitStatus(null)
    }
  }

  const closeCollectionSheet = () => setCollectionSheet(null)

  const printCollectionSheet = () => {
    window.print()
  }

  const handleDeleteExpense = (expenseId) => {
    setDangerModal({
      isOpen: true,
      title: 'Delete expense?',
      message: 'This expense will be permanently removed from this route.',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          const res = await routesAPI.deleteRouteExpense(id, expenseId)
          if (res?.success) {
            toast.success('Expense deleted', { id: 'route-expense-delete' })
            loadExpenses()
            loadSummary()
          } else {
            toast.error(res?.message || 'Failed to delete')
          }
        } catch (e) {
          if (!e?._handledByInterceptor) toast.error(e?.message || 'Failed to delete')
        }
      }
    })
  }

  if (loading && !route) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary-600 border-t-transparent" />
      </div>
    )
  }

  if (!route && !loading) {
    return (
      <div className="p-6">
        <p className="text-neutral-600">Route not found.</p>
        <Link to="/routes" className="text-primary-600 hover:underline mt-2 inline-block">Back to Routes</Link>
      </div>
    )
  }

  const openEditRouteModal = async () => {
    setEditRouteForm({ name: route.name || '', branchId: String(route.branchId ?? '') })
    try {
      const res = await branchesAPI.getBranches()
      const list = res?.data ?? res?.items ?? (Array.isArray(res) ? res : [])
      setBranches(Array.isArray(list) ? list : [])
    } catch {
      setBranches([])
    }
    setShowEditRouteModal(true)
  }

  const handleUpdateRoute = async (e) => {
    e?.preventDefault()
    if (!editRouteForm.name?.trim()) {
      toast.error('Route name is required')
      return
    }
    const branchId = editRouteForm.branchId ? parseInt(editRouteForm.branchId, 10) : null
    if (!branchId) {
      toast.error('Please select a branch')
      return
    }
    try {
      setSavingRouteEdit(true)
      const res = await routesAPI.updateRoute(route.id, {
        name: editRouteForm.name.trim(),
        branchId,
        assignedStaffIds: route.assignedStaffIds || (route.staff || []).map(s => s.userId ?? s.userId) || []
      })
      if (res?.success) {
        toast.success('Route updated')
        setShowEditRouteModal(false)
        loadRoute()
      } else {
        toast.error(res?.message || 'Failed to update route')
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to update route')
    } finally {
      setSavingRouteEdit(false)
    }
  }

  const openDeleteRouteConfirm = () => {
    setDangerModal({
      isOpen: true,
      title: 'Delete route?',
      message: `Delete "${route.name}"? Customers and staff will be unassigned. This cannot be undone.`,
      confirmLabel: 'Delete route',
      onConfirm: async () => {
        try {
          const res = await routesAPI.deleteRoute(route.id)
          if (res?.success !== false) {
            toast.success('Route deleted')
            navigate('/branches?tab=routes')
          } else {
            toast.error(res?.message || 'Failed to delete route')
          }
        } catch (err) {
          toast.error(err?.response?.data?.message || err?.message || 'Failed to delete route')
        } finally {
          setDangerModal(prev => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/branches?tab=routes" className="inline-flex items-center gap-1 text-primary-600 hover:underline mb-4">
        <ArrowLeft className="h-4 w-4" />
        Back to Routes
      </Link>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary-50">
            <MapPin className="h-6 w-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">{route.name}</h1>
            <p className="text-sm text-neutral-500">{route.branchName ?? '—'}</p>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openEditRouteModal}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-neutral-300 rounded-lg text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <Edit className="h-4 w-4" />
              Edit route
            </button>
            <button
              type="button"
              onClick={openDeleteRouteConfirm}
              className="inline-flex items-center gap-1 px-3 py-1.5 border border-red-200 text-red-700 rounded-lg text-sm hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete route
            </button>
          </div>
        )}
      </div>

      <div className="border-b border-neutral-200 mb-4 overflow-x-auto">
        <nav className="-mb-px flex gap-4 min-w-max">
          {ROUTE_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 px-2 border-b-2 font-medium text-sm whitespace-nowrap shrink-0 ${activeTab === tab ? 'border-primary-600 text-primary-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input type="date" value={dateDraftFrom} onChange={(e) => setDateDraftFrom(e.target.value)} className="border border-neutral-300 rounded px-2 py-1 text-sm" />
            <input type="date" value={dateDraftTo} onChange={(e) => setDateDraftTo(e.target.value)} className="border border-neutral-300 rounded px-2 py-1 text-sm" />
            <button type="button" onClick={applyDateRange} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium">Apply</button>
          </div>
          {summary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
              <div className="bg-white rounded-lg border border-neutral-200 p-4">
                <p className="text-sm text-neutral-500">Total Sales</p>
                <p className="text-lg font-semibold text-neutral-900">{formatCurrency(summary.totalSales)}</p>
              </div>
              <div className="bg-white rounded-lg border border-neutral-200 p-4">
                <p className="text-sm text-neutral-500">Paid</p>
                <p className="text-lg font-semibold text-emerald-600">{formatCurrency(summary.totalPayments ?? 0)}</p>
              </div>
              <div className="bg-white rounded-lg border border-neutral-200 p-4">
                <p className="text-sm text-neutral-500">Unpaid / Pending</p>
                <p className="text-lg font-semibold text-amber-600">{formatCurrency(summary.unpaidAmount ?? 0)}</p>
              </div>
              <div className="bg-white rounded-lg border border-neutral-200 p-4">
                <p className="text-sm text-neutral-500">Total Expenses</p>
                <p className="text-lg font-semibold text-neutral-900">{formatCurrency(summary.totalExpenses)}</p>
              </div>
              <div className="bg-white rounded-lg border border-neutral-200 p-4">
                <p className="text-sm text-neutral-500">Profit</p>
                <p className={`text-lg font-semibold ${summary.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(summary.profit)}</p>
              </div>
            </div>
          )}
          {route.branchId && (
            <p className="text-sm text-neutral-500">
              Branch: <Link to={`/branches/${route.branchId}`} className="text-primary-600 hover:underline">{route.branchName || 'View'}</Link>
            </p>
          )}
        </>
      )}

      {activeTab === 'customers' && (
        <div>
          {(!route.customers || route.customers.length === 0) ? (
            <p className="text-neutral-500 py-6">No customers on this route. Add customers and assign them to this route.</p>
          ) : (
            <div className="overflow-x-auto border border-neutral-200 rounded-lg">
              <table className="min-w-full divide-y divide-neutral-200">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Customer</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {route.customers.map(rc => (
                    <tr key={rc.customerId || rc.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-medium">{rc.customerName}</td>
                      <td className="px-4 py-2 text-right"><button type="button" onClick={() => navigate(`/ledger?customerId=${rc.customerId}`)} className="text-primary-600 hover:underline text-sm">Ledger</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'sales' && (
        <div>
          {routeSalesLoading ? (
            <div className="py-8 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" /></div>
          ) : routeSales.length === 0 ? (
            <p className="text-neutral-500 py-6">No invoices for this route yet.</p>
          ) : (
            <div className="overflow-x-auto border border-neutral-200 rounded-lg">
              <table className="min-w-full divide-y divide-neutral-200">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Invoice No</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Customer</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Date</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase">Total</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase">Status</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {routeSales.map(s => (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 font-medium">{s.invoiceNumber || s.invoiceNo || s.id}</td>
                      <td className="px-4 py-2 text-sm">{s.customerName || '—'}</td>
                      <td className="px-4 py-2 text-sm">{s.invoiceDate ? new Date(s.invoiceDate).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-2 text-sm text-right">{formatCurrency(s.grandTotal ?? s.total ?? 0)}</td>
                      <td className="px-4 py-2 text-right"><span className={`px-2 py-0.5 rounded text-xs font-medium ${(s.status || '').toLowerCase() === 'paid' ? 'bg-green-100 text-green-700' : (s.status || '').toLowerCase() === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{s.status || 'Pending'}</span></td>
                      <td className="px-4 py-2 text-right"><button type="button" onClick={() => navigate(`/sales-ledger?invoiceId=${s.id}`)} className="text-primary-600 hover:underline text-sm">View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'expenses' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h2 className="text-lg font-medium text-neutral-800">Route Expenses</h2>
            {canManage && (
              <button
                type="button"
                onClick={openAddExpenseModal}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
              >
                <Plus className="h-4 w-4" />
                Add Route Expense
              </button>
            )}
          </div>
          
          {/* Route Expenses Section */}
          <div className="mb-6">
            <h3 className="text-md font-medium text-neutral-700 mb-3">Route-Specific Expenses (Fuel, Staff, Delivery, etc.)</h3>
            {expenses.length === 0 ? (
              <p className="text-neutral-500 text-sm py-2">No route expenses in this date range.</p>
            ) : (
              <ul className="space-y-2">
                {expenses.map((e) => (
                  <li key={e.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-neutral-200">
                    <div>
                      <span className="font-medium">{e.category}</span>
                      <span className="text-neutral-600 ml-2">{formatCurrency(e.amount)}</span>
                      {e.description && <p className="text-sm text-neutral-500">{e.description}</p>}
                      <p className="text-xs text-neutral-400">{e.expenseDate?.split('T')[0]}</p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditExpenseModal(e)}
                          className="p-1.5 text-primary-600 hover:bg-primary-50 rounded"
                          aria-label="Edit expense"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(e.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                          aria-label="Delete expense"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {expenses.length > 0 && (
              <p className="text-sm text-neutral-600 mt-2">
                Route Expenses Total: <span className="font-semibold">{formatCurrency(expenses.reduce((sum, e) => sum + (e.amount || 0), 0))}</span>
              </p>
            )}
          </div>

          {/* General Expenses Section */}
          {route?.branchId && (
            <div className="mb-6">
              <h3 className="text-md font-medium text-neutral-700 mb-3">Branch-Level Expenses (Rent, Utilities, etc.)</h3>
              {generalExpensesLoading ? (
                <div className="py-4 flex justify-center"><div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-600 border-t-transparent" /></div>
              ) : generalExpenses.length === 0 ? (
                <p className="text-neutral-500 text-sm py-2">No branch-level expenses allocated to this route's branch.</p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {generalExpenses.map((e) => (
                      <li key={e.id} className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg border border-neutral-200">
                        <div>
                          <span className="font-medium">{e.categoryName || 'Uncategorized'}</span>
                          <span className="text-neutral-600 ml-2">{formatCurrency(e.amount || 0)}</span>
                          {e.note && <p className="text-sm text-neutral-500">{e.note}</p>}
                          <p className="text-xs text-neutral-400">{e.date ? new Date(e.date).toLocaleDateString() : '—'}</p>
                        </div>
                        <span className="text-xs text-neutral-500">Branch Expense</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-neutral-600 mt-2">
                    Branch Expenses Total: <span className="font-semibold">{formatCurrency(generalExpenses.reduce((sum, e) => sum + (e.amount || 0), 0))}</span>
                  </p>
                </>
              )}
            </div>
          )}

          {/* Combined Total */}
          {(expenses.length > 0 || generalExpenses.length > 0) && (
            <div className="bg-primary-50 rounded-lg border border-primary-200 p-4">
              <p className="text-sm font-medium text-neutral-700 mb-1">Combined Expenses Total</p>
              <p className="text-xl font-semibold text-primary-700">
                {formatCurrency(
                  expenses.reduce((sum, e) => sum + (e.amount || 0), 0) +
                  generalExpenses.reduce((sum, e) => sum + (e.amount || 0), 0)
                )}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Note: Route expenses are specific to this route. Branch expenses are shared across all routes in the branch.
              </p>
            </div>
          )}
        </>
      )}

      {activeTab === 'staff' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-neutral-500">Staff assigned to this route.</p>
            {canManage && (
              <button
                type="button"
                onClick={openAssignRouteStaffModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
              >
                <UserPlus className="h-4 w-4" />
                Assign Staff
              </button>
            )}
          </div>
          <div className="space-y-3 mb-4">
            {route?.assignedStaffName && (
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
                <p className="text-sm text-neutral-500">Primary assigned staff</p>
                <p className="font-medium">{route.assignedStaffName}</p>
              </div>
            )}
            {(!route?.staff || route.staff.length === 0) && !route?.assignedStaffName ? (
              <p className="text-neutral-500 py-6">No staff assigned to this route. Click "Assign Staff" above.</p>
            ) : (
              <div className="overflow-x-auto border border-neutral-200 rounded-lg">
                <table className="min-w-full divide-y divide-neutral-200">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-neutral-600 uppercase">Name</th>
                      {canManage && <th className="px-4 py-2 text-right text-xs font-medium text-neutral-600 uppercase">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 bg-white">
                    {route?.assignedStaffName && (
                      <tr>
                        <td className="px-4 py-2 font-medium">{route.assignedStaffName} (Primary)</td>
                        {canManage && <td className="px-4 py-2 text-right"><span className="text-xs text-neutral-400">Primary</span></td>}
                      </tr>
                    )}
                    {(route?.staff || []).filter(s => s.userName !== route.assignedStaffName).map(s => (
                      <tr key={s.userId}>
                        <td className="px-4 py-2 font-medium">{s.userName}</td>
                        {canManage && (
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveRouteStaff(s)}
                              disabled={routeStaffRemovingId === s.userId}
                              className="text-red-600 hover:bg-red-50 rounded px-2 py-1 text-sm font-medium disabled:opacity-50"
                            >
                              {routeStaffRemovingId === s.userId ? 'Removing…' : 'Remove'}
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

          {showAssignRouteStaffModal && (
            <Modal
              isOpen={true}
              title="Assign staff to this route"
              onClose={() => !routeStaffAssignSaving && setShowAssignRouteStaffModal(false)}
              size="md"
            >
              {routeStaffAssignLoading ? (
                <div className="py-8 flex justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-600 border-t-transparent" />
                </div>
              ) : routeStaffToAssign.length === 0 ? (
                <p className="text-neutral-500 py-4">No other staff to assign. All staff are already assigned or there are no Staff users created yet.</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {routeStaffToAssign.map(u => (
                    <li key={u.id} className="flex items-center justify-between p-2 rounded border border-neutral-200 hover:bg-neutral-50">
                      <div>
                        <span className="font-medium">{u.name}</span>
                        <span className="text-sm text-neutral-500 ml-2">{u.email}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAssignRouteStaff(u)}
                        disabled={routeStaffAssignSaving}
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

      {activeTab === 'performance' && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input type="date" value={dateDraftFrom} onChange={(e) => setDateDraftFrom(e.target.value)} className="border border-neutral-300 rounded px-2 py-1 text-sm" />
            <input type="date" value={dateDraftTo} onChange={(e) => setDateDraftTo(e.target.value)} className="border border-neutral-300 rounded px-2 py-1 text-sm" />
            <button type="button" onClick={applyDateRange} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium">Apply</button>
          </div>
          {summary && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg border border-neutral-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="h-4 w-4 text-primary-600" />
                    <p className="text-sm text-neutral-500">Total Sales</p>
                  </div>
                  <p className="text-xl font-semibold text-neutral-900">{formatCurrency(summary.totalSales)}</p>
                </div>
                <div className="bg-white rounded-lg border border-neutral-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-primary-600" />
                    <p className="text-sm text-neutral-500">Total Expenses</p>
                  </div>
                  <p className="text-xl font-semibold text-neutral-900">{formatCurrency(summary.totalExpenses)}</p>
                </div>
                <div className="bg-white rounded-lg border border-neutral-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="h-4 w-4 text-primary-600" />
                    <p className="text-sm text-neutral-500">Net Profit</p>
                  </div>
                  <p className={`text-xl font-semibold ${summary.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(summary.profit)}</p>
                </div>
                <div className="bg-white rounded-lg border border-neutral-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Receipt className="h-4 w-4 text-primary-600" />
                    <p className="text-sm text-neutral-500">Profit Margin</p>
                  </div>
                  <p className={`text-xl font-semibold ${summary.totalSales > 0 && (summary.profit / summary.totalSales * 100) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {summary.totalSales > 0 ? `${(summary.profit / summary.totalSales * 100).toFixed(1)}%` : '—'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-lg border border-neutral-200 p-4">
                  <p className="text-sm text-neutral-500">Cost of Goods Sold</p>
                  <p className="text-lg font-semibold text-neutral-900">{formatCurrency(summary.costOfGoodsSold || 0)}</p>
                </div>
                <div className="bg-white rounded-lg border border-neutral-200 p-4">
                  <p className="text-sm text-neutral-500">Gross Profit</p>
                  <p className={`text-lg font-semibold ${(summary.totalSales - (summary.costOfGoodsSold || 0)) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(summary.totalSales - (summary.costOfGoodsSold || 0))}
                  </p>
                </div>
                <div className="bg-white rounded-lg border border-neutral-200 p-4">
                  <p className="text-sm text-neutral-500">Gross Margin</p>
                  <p className={`text-lg font-semibold ${summary.totalSales > 0 && ((summary.totalSales - (summary.costOfGoodsSold || 0)) / summary.totalSales * 100) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {summary.totalSales > 0 ? `${((summary.totalSales - (summary.costOfGoodsSold || 0)) / summary.totalSales * 100).toFixed(1)}%` : '—'}
                  </p>
                </div>
              </div>
              <div className="bg-white rounded-lg border border-neutral-200 p-4">
                <h3 className="text-md font-medium text-neutral-800 mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Performance Summary
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-neutral-500">Invoice Count</p>
                    <p className="text-lg font-semibold text-neutral-900">{summary.invoiceCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-neutral-500">Average Invoice Size</p>
                    <p className="text-lg font-semibold text-neutral-900">
                      {(summary.invoiceCount ?? 0) > 0 ? formatCurrency(summary.totalSales / (summary.invoiceCount ?? 1)) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-neutral-500">Visits Recorded</p>
                    <p className="text-lg font-semibold text-neutral-900">{summary.visitCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-neutral-500">Expense Ratio</p>
                    <p className="text-lg font-semibold text-neutral-900">
                      {summary.totalSales > 0 ? `${(summary.totalExpenses / summary.totalSales * 100).toFixed(1)}%` : '—'}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-neutral-500">Customer count on route: {route?.customers?.length ?? 0}</p>
              </div>
            </>
          )}
          {!summary && !loading && (
            <p className="text-neutral-500">Select a date range and click Apply to load performance metrics.</p>
          )}
          <p className="mt-4 text-sm text-neutral-500 flex items-center gap-1"><BarChart3 className="h-4 w-4" />Route performance metrics for selected date range.</p>
        </div>
      )}

      {showExpenseModal && (
        <Modal
          isOpen={true}
          title={selectedExpenseForEdit ? 'Edit route expense' : 'Add route expense'}
          onClose={() => !saving && (setShowExpenseModal(false), resetExpenseForm())}
        >
          <form onSubmit={selectedExpenseForEdit ? handleUpdateExpense : handleAddExpense} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-neutral-700">Category</label>
              <select
                value={expenseCategory}
                onChange={(e) => setExpenseCategory(e.target.value)}
                className="block w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-xl shadow-sm text-neutral-900 sm:text-sm"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <Input
              label="Amount"
              type="number"
              step="0.01"
              min="0"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              required
              placeholder="0.00"
            />
            <Input
              label="Date"
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              required
            />
            <Input
              label="Description (optional)"
              value={expenseDescription}
              onChange={(e) => setExpenseDescription(e.target.value)}
              placeholder="Notes"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setShowExpenseModal(false); resetExpenseForm() }} className="px-4 py-2 border border-neutral-300 rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg disabled:opacity-50">
                {saving ? 'Saving...' : selectedExpenseForEdit ? 'Update' : 'Add'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {collectionSheet && (
        <Modal isOpen={true} title="Daily Collection Sheet" onClose={closeCollectionSheet} size="lg">
          <div id="collection-sheet-print" className="space-y-4 print:space-y-2">
            <style>{`
              @media print {
                body * { visibility: hidden; }
                #collection-sheet-print, #collection-sheet-print * { visibility: visible; }
                #collection-sheet-print { position: absolute; left: 0; top: 0; width: 100%; }
                .print\\:hidden { display: none !important; }
                table { page-break-inside: avoid; }
                tr { page-break-inside: avoid; }
              }
            `}</style>
            <div className="text-sm text-neutral-600 print:text-xs border-b border-neutral-300 pb-3 print:pb-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p><strong>Route:</strong> {collectionSheet.routeName}</p>
                  <p><strong>Branch:</strong> {collectionSheet.branchName}</p>
                </div>
                <div>
                  <p><strong>Date:</strong> {collectionSheet.date}</p>
                  {collectionSheet.staffName && <p><strong>Staff:</strong> {collectionSheet.staffName}</p>}
                </div>
              </div>
            </div>
            <table className="w-full border-collapse text-sm print:text-xs">
              <thead>
                <tr className="border-b-2 border-neutral-400 bg-neutral-100 print:bg-neutral-200">
                  <th className="text-left py-2 px-2 print:py-1 print:px-1 font-semibold">#</th>
                  <th className="text-left py-2 px-2 print:py-1 print:px-1 font-semibold">Customer</th>
                  <th className="text-left py-2 px-2 print:py-1 print:px-1 font-semibold">Phone</th>
                  <th className="text-right py-2 px-2 print:py-1 print:px-1 font-semibold">Outstanding</th>
                  <th className="text-right py-2 px-2 print:py-1 print:px-1 font-semibold">Today&apos;s Invoice</th>
                  <th className="text-center py-2 px-2 print:py-1 print:px-1 font-semibold print:hidden">Visit Status</th>
                  <th className="text-center py-2 px-2 print:py-1 print:px-1 font-semibold print:w-16">Status</th>
                </tr>
              </thead>
              <tbody>
                {collectionSheet.customers?.map((c, i) => {
                  const statusColors = {
                    'NotVisited': 'bg-neutral-100 text-neutral-600',
                    'Visited': 'bg-blue-100 text-blue-700',
                    'NotHome': 'bg-amber-100 text-amber-700',
                    'PaymentCollected': 'bg-emerald-100 text-emerald-700',
                    'Rescheduled': 'bg-purple-100 text-purple-700'
                  }
                  const statusLabels = {
                    'NotVisited': 'Not Visited',
                    'Visited': 'Visited',
                    'NotHome': 'Not Home',
                    'PaymentCollected': 'Payment Collected',
                    'Rescheduled': 'Rescheduled'
                  }
                  const currentStatus = c.visitStatus || 'NotVisited'
                  const isUpdating = updatingVisitStatus === `${c.customerId}-${currentStatus}`
                  return (
                    <tr key={c.customerId} className="border-b border-neutral-200 print:border-neutral-300">
                      <td className="py-2 px-2 print:py-1 print:px-1">{i + 1}</td>
                      <td className="py-2 px-2 print:py-1 print:px-1 font-medium">{c.customerName}</td>
                      <td className="py-2 px-2 print:py-1 print:px-1">{c.phone || '—'}</td>
                      <td className="py-2 px-2 print:py-1 print:px-1 text-right font-medium">{formatCurrency(c.outstandingBalance)}</td>
                      <td className="py-2 px-2 print:py-1 print:px-1 text-right">{c.todayInvoiceAmount != null ? formatCurrency(c.todayInvoiceAmount) : '—'}</td>
                      <td className="py-2 px-2 print:py-1 print:px-1 text-center print:hidden">
                        <select
                          value={currentStatus}
                          onChange={(e) => {
                            const newStatus = e.target.value
                            const paymentAmount = newStatus === 'PaymentCollected' && c.outstandingBalance > 0 ? c.outstandingBalance : null
                            handleUpdateVisitStatus(c.customerId, newStatus, c.visitNotes, paymentAmount)
                          }}
                          disabled={isUpdating}
                          className={`text-xs px-2 py-1 rounded border font-medium ${statusColors[currentStatus] || statusColors['NotVisited']} disabled:opacity-50`}
                        >
                          <option value="NotVisited">Not Visited</option>
                          <option value="Visited">Visited</option>
                          <option value="NotHome">Not Home</option>
                          <option value="PaymentCollected">Payment Collected</option>
                          <option value="Rescheduled">Rescheduled</option>
                        </select>
                        {isUpdating && <span className="ml-2 text-xs text-neutral-500">Updating...</span>}
                      </td>
                      <td className="py-2 px-2 print:py-1 print:px-1 text-center hidden print:table-cell">
                        <div className={`w-6 h-6 border-2 rounded inline-block ${currentStatus === 'PaymentCollected' ? 'bg-emerald-200 border-emerald-400' : currentStatus === 'Visited' ? 'bg-blue-200 border-blue-400' : currentStatus === 'NotHome' ? 'bg-amber-200 border-amber-400' : 'border-neutral-400'}`} title={statusLabels[currentStatus] || currentStatus}></div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-400 bg-neutral-100 print:bg-neutral-200 font-semibold">
                  <td colSpan="5" className="py-2 px-2 print:py-1 print:px-1 text-right">Total Outstanding:</td>
                  <td colSpan="2" className="py-2 px-2 print:py-1 print:px-1 text-right">{formatCurrency(collectionSheet.totalOutstanding)}</td>
                </tr>
                <tr className="border-t border-neutral-300 bg-neutral-50 print:bg-neutral-100">
                  <td colSpan="7" className="py-2 px-2 print:py-1 print:px-1 text-xs text-neutral-600 print:text-xs">
                    <div className="flex flex-wrap gap-4 print:gap-2">
                      <span><span className="inline-block w-3 h-3 rounded-full bg-neutral-200 border border-neutral-400 mr-1"></span> Not Visited</span>
                      <span><span className="inline-block w-3 h-3 rounded-full bg-blue-200 border border-blue-400 mr-1"></span> Visited</span>
                      <span><span className="inline-block w-3 h-3 rounded-full bg-amber-200 border border-amber-400 mr-1"></span> Not Home</span>
                      <span><span className="inline-block w-3 h-3 rounded-full bg-emerald-200 border border-emerald-400 mr-1"></span> Payment Collected</span>
                      <span><span className="inline-block w-3 h-3 rounded-full bg-purple-200 border border-purple-400 mr-1"></span> Rescheduled</span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
            <div className="flex justify-between pt-4 print:hidden">
              <button type="button" onClick={closeCollectionSheet} className="px-4 py-2 border border-neutral-300 rounded-lg">
                Close
              </button>
              <button type="button" onClick={printCollectionSheet} className="inline-flex items-center gap-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                <Printer className="h-4 w-4" />
                Print
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Route modal */}
      {showEditRouteModal && (
        <Modal
          isOpen={true}
          title="Edit route"
          onClose={() => !savingRouteEdit && setShowEditRouteModal(false)}
        >
          <form onSubmit={handleUpdateRoute} className="space-y-4">
            <Input
              label="Route name"
              value={editRouteForm.name}
              onChange={(e) => setEditRouteForm(prev => ({ ...prev, name: e.target.value }))}
              required
              placeholder="e.g. North Route"
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-neutral-700">Branch</label>
              <select
                value={editRouteForm.branchId}
                onChange={(e) => setEditRouteForm(prev => ({ ...prev, branchId: e.target.value }))}
                required
                className="block w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              >
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowEditRouteModal(false)} className="px-4 py-2 border border-neutral-300 rounded-lg text-sm text-neutral-700 hover:bg-neutral-50">
                Cancel
              </button>
              <button type="submit" disabled={savingRouteEdit} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">
                {savingRouteEdit ? 'Saving...' : 'Update route'}
              </button>
            </div>
          </form>
        </Modal>
      )}

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

export default RouteDetailPage

