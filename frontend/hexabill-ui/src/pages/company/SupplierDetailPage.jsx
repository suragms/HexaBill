import { useState, useEffect, useMemo } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, DollarSign, FileText, CreditCard, Calendar, Download, Banknote, Pencil, Tag, Plus, Trash2 } from 'lucide-react'
import { suppliersAPI, purchasesAPI } from '../../services'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import Modal from '../../components/Modal'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'

const DISCOUNT_TYPES = [
  'Cash Discount',
  'Free Products',
  'Promotional Offer',
  'Negotiated Discount'
]

const baseTabs = [
  { id: 'summary', label: 'Summary', icon: FileText },
  { id: 'ledger', label: 'Ledger', icon: DollarSign },
  { id: 'purchases', label: 'Purchase History', icon: FileText },
  { id: 'payments', label: 'Payment History', icon: CreditCard }
]

const SupplierDetailPage = () => {
  const { name } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const supplierName = name ? decodeURIComponent(name) : ''
  const [activeTab, setActiveTab] = useState('summary')
  const [balance, setBalance] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [showRecordPayment, setShowRecordPayment] = useState(() => searchParams.get('recordPayment') === '1')
  const [saving, setSaving] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    paymentDate: new Date().toISOString().split('T')[0],
    mode: 'Cash',
    reference: '',
    notes: ''
  })
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [preFillPayment, setPreFillPayment] = useState({ amount: '', reference: '' })
  const [showOverpaymentConfirm, setShowOverpaymentConfirm] = useState(false)
  const [supplierInfo, setSupplierInfo] = useState(null)
  // Vendor Discounts (Owner/Admin only; not in ledger or reports)
  const [vendorDiscounts, setVendorDiscounts] = useState([])
  const [totalSavings, setTotalSavings] = useState(0)
  const [showVendorDiscountModal, setShowVendorDiscountModal] = useState(false)
  const [editingVendorDiscount, setEditingVendorDiscount] = useState(null)
  const [vendorDiscountForm, setVendorDiscountForm] = useState({
    purchaseId: '',
    amount: '',
    discountDate: new Date().toISOString().split('T')[0],
    discountType: 'Cash Discount',
    reason: ''
  })
  const [savingVendorDiscount, setSavingVendorDiscount] = useState(false)
  const [showDeleteVendorDiscountConfirm, setShowDeleteVendorDiscountConfirm] = useState(false)
  const [deleteVendorDiscountId, setDeleteVendorDiscountId] = useState(null)

  const canUseVendorDiscounts = isAdminOrOwner(user) && supplierInfo?.id
  const showVendorDiscountsTab = isAdminOrOwner(user) && supplierInfo != null
  const tabs = useMemo(() => {
    const t = [...baseTabs]
    if (showVendorDiscountsTab) t.push({ id: 'vendor-discounts', label: 'Vendor Discounts', icon: Tag })
    return t
  }, [showVendorDiscountsTab])

  useEffect(() => {
    if (supplierName) {
      loadData()
    }
  }, [supplierName, activeTab, fromDate, toDate, showRecordPayment])

  const loadData = async () => {
    if (!supplierName) return
    try {
      setLoading(true)
      let supplierData = null
      try {
        const supplierRes = await suppliersAPI.getSupplier(supplierName)
        if (supplierRes?.success && supplierRes?.data) {
          supplierData = supplierRes.data
          setSupplierInfo(supplierRes.data)
        } else setSupplierInfo(null)
      } catch (_) {
        setSupplierInfo(null)
      }
      if (activeTab === 'summary' || activeTab === 'ledger' || activeTab === 'purchases') {
        const balanceRes = await suppliersAPI.getSupplierBalance(supplierName)
        if (balanceRes?.success && balanceRes?.data) setBalance(balanceRes.data)
      }
      if (activeTab === 'summary' || activeTab === 'ledger') {
        const transactionsRes = await suppliersAPI.getSupplierTransactions(supplierName, fromDate || undefined, toDate || undefined)
        if (transactionsRes?.success && transactionsRes?.data) setTransactions(transactionsRes.data)
      }
      if (activeTab === 'purchases' || activeTab === 'ledger' || activeTab === 'summary' || showRecordPayment) {
        const res = await purchasesAPI.getPurchases({ supplierName, pageSize: 100 })
        if (res?.success && res?.data?.items) setPurchases(res.data.items)
        else setPurchases([])
      }
      if (activeTab === 'payments') {
        const res = await suppliersAPI.getSupplierTransactions(supplierName, fromDate || undefined, toDate || undefined)
        if (res?.success && res?.data) {
          const payments = (res.data || []).filter(t => (t.type || '').toLowerCase() === 'payment')
          setTransactions(payments)
        } else setTransactions([])
      }
      if (activeTab === 'vendor-discounts' && supplierData?.id) {
        try {
          const res = await suppliersAPI.getVendorDiscounts(supplierData.id)
          if (res?.success && res?.data) {
            setVendorDiscounts(res.data.items || [])
            setTotalSavings(res.data.totalSavings ?? 0)
          } else {
            setVendorDiscounts([])
            setTotalSavings(0)
          }
        } catch (_) {
          setVendorDiscounts([])
          setTotalSavings(0)
        }
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '-')
  const payments = (transactions || []).filter(t => (t.type || '').toLowerCase() === 'payment')

  const submitRecordPayment = async () => {
    const amount = parseFloat(paymentForm.amount)
    if (!amount || amount <= 0) return
    try {
      setSaving(true)
      const res = await suppliersAPI.recordPayment(supplierName, {
        amount,
        paymentDate: paymentForm.paymentDate,
        mode: paymentForm.mode,
        reference: paymentForm.reference?.trim() || undefined,
        notes: paymentForm.notes?.trim() || undefined
      })
      if (res?.success) {
        toast.success('Payment recorded. Bills and reports updated (FIFO).')
        setShowRecordPayment(false)
        setShowOverpaymentConfirm(false)
        setPreFillPayment({ amount: '', reference: '' })
        setPaymentForm({ amount: '', paymentDate: new Date().toISOString().split('T')[0], mode: 'Cash', reference: '', notes: '' })
        await loadData()
        const resPurchases = await purchasesAPI.getPurchases({ supplierName, pageSize: 100 })
        if (resPurchases?.success && resPurchases?.data?.items) setPurchases(resPurchases.data.items)
      } else toast.error(res?.message || 'Failed to record payment')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to record payment')
    } finally {
      setSaving(false)
    }
  }

  const handleRecordPayment = async (e) => {
    e.preventDefault()
    const amount = parseFloat(paymentForm.amount)
    if (!amount || amount <= 0) {
      toast.error('Please enter a valid amount')
      return
    }
    const outstanding = balance?.netPayable ?? 0
    if (outstanding > 0 && amount > outstanding) {
      setShowOverpaymentConfirm(true)
      return
    }
    await submitRecordPayment()
  }

  const handleExportCsv = () => {
    const headers = ['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Balance']
    const rows = transactions.map(t => [
      formatDate(t.date),
      t.type,
      t.reference || '',
      t.debit?.toFixed(2) || '0.00',
      t.credit?.toFixed(2) || '0.00',
      t.balance?.toFixed(2) || '0.00'
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `supplier_ledger_${(supplierName || 'export').replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported to CSV')
  }

  const openAddVendorDiscount = () => {
    setEditingVendorDiscount(null)
    setVendorDiscountForm({
      purchaseId: '',
      amount: '',
      discountDate: new Date().toISOString().split('T')[0],
      discountType: 'Cash Discount',
      reason: ''
    })
    setShowVendorDiscountModal(true)
  }

  const openEditVendorDiscount = (row) => {
    setEditingVendorDiscount(row)
    setVendorDiscountForm({
      purchaseId: row.purchaseId ?? '',
      amount: String(row.amount ?? ''),
      discountDate: row.discountDate ? new Date(row.discountDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      discountType: row.discountType || 'Cash Discount',
      reason: row.reason || ''
    })
    setShowVendorDiscountModal(true)
  }

  const saveVendorDiscount = async (e) => {
    e.preventDefault()
    if (!supplierInfo?.id) return
    const amount = parseFloat(vendorDiscountForm.amount)
    if (!amount || amount < 0.01) {
      toast.error('Amount must be at least 0.01')
      return
    }
    if (!vendorDiscountForm.reason?.trim() || vendorDiscountForm.reason.trim().length < 3) {
      toast.error('Reason is required (min 3 characters)')
      return
    }
    const payload = {
      amount,
      discountDate: vendorDiscountForm.discountDate,
      discountType: vendorDiscountForm.discountType,
      reason: vendorDiscountForm.reason.trim()
    }
    if (vendorDiscountForm.purchaseId) payload.purchaseId = parseInt(vendorDiscountForm.purchaseId, 10)
    setSavingVendorDiscount(true)
    try {
      if (editingVendorDiscount) {
        const res = await suppliersAPI.updateVendorDiscount(supplierInfo.id, editingVendorDiscount.id, payload)
        if (res?.success) {
          toast.success('Vendor discount updated')
          setShowVendorDiscountModal(false)
          loadData()
        } else toast.error(res?.message || 'Update failed')
      } else {
        const res = await suppliersAPI.createVendorDiscount(supplierInfo.id, payload)
        if (res?.success) {
          toast.success('Vendor discount added')
          setShowVendorDiscountModal(false)
          loadData()
        } else toast.error(res?.message || 'Create failed')
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save')
    } finally {
      setSavingVendorDiscount(false)
    }
  }

  const confirmDeleteVendorDiscount = async () => {
    if (!supplierInfo?.id || !deleteVendorDiscountId) return
    try {
      const res = await suppliersAPI.deleteVendorDiscount(supplierInfo.id, deleteVendorDiscountId)
      if (res?.success) {
        toast.success('Vendor discount deleted')
        setShowDeleteVendorDiscountConfirm(false)
        setDeleteVendorDiscountId(null)
        loadData()
      } else toast.error(res?.message || 'Delete failed')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete')
    }
  }

  const getDiscountTypeBadgeClass = (type) => {
    const t = (type || '').toLowerCase()
    if (t.includes('cash')) return 'bg-green-100 text-green-800'
    if (t.includes('free')) return 'bg-blue-100 text-blue-800'
    if (t.includes('promo')) return 'bg-purple-100 text-purple-800'
    if (t.includes('negotiated')) return 'bg-amber-100 text-amber-800'
    return 'bg-neutral-100 text-neutral-700'
  }

  if (!supplierName) {
    return (
      <div className="w-full p-4 sm:p-6">
        <Link to="/suppliers" className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 font-medium mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Suppliers
        </Link>
        <p className="text-primary-600">Invalid or missing supplier. Please choose a supplier from the <Link to="/suppliers" className="underline font-medium">Suppliers list</Link>.</p>
      </div>
    )
  }

  return (
    <div className="w-full p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to="/suppliers" className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 font-medium">
          <ArrowLeft className="h-4 w-4" /> Back to Suppliers
        </Link>
        <span className="text-primary-400">|</span>
        <Link to="/suppliers" className="text-sm text-primary-600 hover:text-primary-800 underline">View all suppliers</Link>
        <Link to={`/suppliers?edit=${encodeURIComponent(supplierName)}`} className="inline-flex items-center gap-1 text-sm text-amber-700 hover:text-amber-800 font-medium">
          <Pencil className="h-4 w-4" /> Edit supplier
        </Link>
      </div>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-primary-900">Supplier Ledger: {supplierName}</h1>
          {supplierInfo?.id && supplierInfo.isActive === false && (
            <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-300">Deactivated</span>
          )}
        </div>
        <p className="text-primary-600 mt-1">Outstanding balance, transactions and payments — same as Customer Ledger</p>
      </div>

      {/* Summary data cards above tabs */}
      {(balance != null || purchases.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-lg border-2 border-primary-200 p-3 shadow-sm">
            <p className="text-xs font-semibold text-primary-600 uppercase tracking-wide">Outstanding</p>
            <p className="text-lg font-bold text-amber-700">{formatCurrency(balance?.netPayable ?? 0)}</p>
          </div>
          <div className="bg-white rounded-lg border-2 border-primary-200 p-3 shadow-sm">
            <p className="text-xs font-semibold text-primary-600 uppercase tracking-wide">Unpaid bills</p>
            <p className="text-lg font-bold text-primary-800">
              {purchases.filter(p => (p.paymentStatus || '').toLowerCase() !== 'paid' || (p.balanceAmount || 0) > 0).length}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 border-b border-primary-200 pb-2">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-t font-medium text-sm ${
              activeTab === t.id ? 'bg-primary-100 text-primary-800 border-b-2 border-primary-600 -mb-[2px]' : 'text-primary-600 hover:bg-primary-50'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {activeTab === 'ledger' && (
            <button type="button" onClick={handleExportCsv} className="flex items-center gap-1 px-3 py-2 bg-primary-100 hover:bg-primary-200 rounded-lg text-sm font-medium">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setPreFillPayment({ amount: '', reference: '' })
              setShowRecordPayment(!showRecordPayment)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm"
          >
            <DollarSign className="h-4 w-4" /> Record Payment
          </button>
        </div>
      </div>

      {showRecordPayment && (
        <div className="mb-6 bg-lime-50 border-2 border-lime-300 rounded-lg p-4 w-full">
          <h3 className="font-semibold text-primary-800 mb-2">Record Payment</h3>
          <p className="text-xs text-primary-600 mb-3">Payment is applied to <strong>oldest unpaid/partial bills first (FIFO)</strong>. Summary, Ledger and Reports use this same logic.</p>
          {preFillPayment.reference && (
            <p className="text-xs text-green-700 mb-2 bg-green-100 px-2 py-1 rounded">Amount pre-filled for invoice <strong>{preFillPayment.reference}</strong>. You can change it; FIFO still applies.</p>
          )}

          {purchases.length > 0 && (
            <div className="mb-4 rounded-lg border border-lime-400 bg-white overflow-hidden">
              <h4 className="text-xs font-semibold text-primary-800 px-3 py-2 bg-lime-100 border-b border-lime-300">Bills for this supplier — see which are Paid / Partial / Unpaid</h4>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-primary-50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium text-primary-800">Invoice No</th>
                      <th className="text-left p-2 font-medium text-primary-800">Date</th>
                      <th className="text-right p-2 font-medium text-primary-800">Total</th>
                      <th className="text-right p-2 font-medium text-primary-800">Paid</th>
                      <th className="text-right p-2 font-medium text-primary-800">Balance</th>
                      <th className="text-center p-2 font-medium text-primary-800">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.map(p => (
                      <tr key={p.id} className="border-t border-primary-100 hover:bg-primary-50/50">
                        <td className="p-2 font-medium">{p.invoiceNo}</td>
                        <td className="p-2">{formatDate(p.purchaseDate)}</td>
                        <td className="p-2 text-right">{formatCurrency(p.totalAmount || 0)}</td>
                        <td className="p-2 text-right text-green-700">{formatCurrency(p.paidAmount || 0)}</td>
                        <td className="p-2 text-right text-amber-700">{formatCurrency(p.balanceAmount || 0)}</td>
                        <td className="p-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded font-medium ${
                            (p.paymentStatus || '').toLowerCase() === 'paid' ? 'bg-green-100 text-green-800' :
                            (p.paymentStatus || '').toLowerCase() === 'partial' ? 'bg-amber-100 text-amber-800' :
                            'bg-neutral-100 text-neutral-700'
                          }`}>
                            {p.paymentStatus || 'Unpaid'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <form onSubmit={handleRecordPayment} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-primary-700 mb-1">Amount (AED) *</label>
              <input type="number" step="0.01" min="0.01" required value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-primary-700 mb-1">Date *</label>
              <input type="date" required value={paymentForm.paymentDate} onChange={e => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-primary-700 mb-1">Mode</label>
              <select value={paymentForm.mode} onChange={e => setPaymentForm({ ...paymentForm, mode: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2">
                <option value="Cash">Cash</option>
                <option value="Bank">Bank</option>
                <option value="Cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-primary-700 mb-1">Reference</label>
              <input type="text" value={paymentForm.reference} onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2" placeholder="Cheque no, etc." />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-primary-700 mb-1">Notes</label>
              <input type="text" value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2" />
            </div>
            <div className="sm:col-span-2 flex gap-2 items-end">
              <button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                {saving ? 'Saving...' : 'Save Payment'}
              </button>
              <button type="button" onClick={() => { setShowRecordPayment(false); setPreFillPayment({ amount: '', reference: '' }) }} className="px-4 py-2 border-2 border-primary-300 rounded-lg hover:bg-primary-50 font-medium">Cancel</button>
            </div>
          </form>
          {balance?.netPayable > 0 && parseFloat(paymentForm.amount) > balance.netPayable && (
            <p className="text-amber-600 text-sm mt-2">Amount exceeds outstanding ({formatCurrency(balance.netPayable)}). You may be overpaying.</p>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-primary-500">Loading...</div>
      ) : (
        <>
          {activeTab === 'summary' && balance && (
            <div className="bg-white rounded-lg border-2 border-lime-300 p-6">
              <h2 className="text-lg font-bold text-primary-800 mb-4">Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <p className="text-sm text-blue-700 font-medium">Total Purchases</p>
                  <p className="text-xl font-bold text-blue-900">{formatCurrency(balance.totalPurchases || 0)}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                  <p className="text-sm text-green-700 font-medium">Total Payments</p>
                  <p className="text-xl font-bold text-green-900">{formatCurrency(balance.totalPayments || 0)}</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                  <p className="text-sm text-amber-700 font-medium">Outstanding</p>
                  <p className="text-xl font-bold text-amber-900">{formatCurrency(balance.netPayable || 0)}</p>
                </div>
                <div className="bg-neutral-50 rounded-lg p-4 border border-neutral-200">
                  <p className="text-sm text-neutral-700 font-medium">Last Payment</p>
                  <p className="text-lg font-bold text-neutral-900">{formatDate(balance.lastPaymentDate)}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ledger' && (
            <div className="bg-white rounded-lg border-2 border-lime-300 overflow-hidden w-full">
              {/* Summary: Total paid, Pending balance */}
              {balance != null && (
                <div className="p-4 bg-primary-50 border-b-2 border-lime-300 flex flex-wrap gap-6 items-center">
                  <span className="text-sm"><span className="font-semibold text-primary-700">Total purchases (Debits):</span> <span className="font-bold text-primary-900">{formatCurrency(balance.totalPurchases || 0)}</span></span>
                  <span className="text-sm"><span className="font-semibold text-green-700">Total paid (Credits):</span> <span className="font-bold text-green-800">{formatCurrency(balance.totalPayments || 0)}</span></span>
                  <span className="text-sm"><span className="font-semibold text-amber-700">Pending balance:</span> <span className="font-bold text-amber-800">{formatCurrency(balance.netPayable || 0)}</span></span>
                </div>
              )}
              <div className="p-4 border-b border-lime-300 flex flex-wrap gap-2 items-center">
                <Calendar className="h-4 w-4 text-primary-500" />
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="border-2 border-lime-300 rounded px-2 py-1 text-sm" />
                <span className="text-primary-500">to</span>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="border-2 border-lime-300 rounded px-2 py-1 text-sm" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-primary-100">
                    <tr>
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Reference</th>
                      <th className="text-right p-2" title="Purchase amount (increases what you owe)">Debit</th>
                      <th className="text-right p-2" title="Payment (reduces what you owe)">Credit</th>
                      <th className="text-right p-2">Running balance</th>
                      <th className="text-center p-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr><td colSpan={7} className="p-4 text-center text-primary-500">No transactions</td></tr>
                    ) : (
                      transactions.map((t, i) => {
                        const isPurchase = (t.type || '').toLowerCase() === 'purchase'
                        const purchaseMatch = isPurchase ? purchases.find(p => (p.invoiceNo || '') === (t.reference || '')) : null
                        const hasBalance = purchaseMatch && (purchaseMatch.balanceAmount || 0) > 0
                        return (
                          <tr key={i} className="border-t border-primary-100 hover:bg-primary-50">
                            <td className="p-2">{formatDate(t.date)}</td>
                            <td className="p-2 font-medium">{t.type}</td>
                            <td className="p-2">{t.reference || '-'}</td>
                            <td className="p-2 text-right">{t.debit > 0 ? formatCurrency(t.debit) : '-'}</td>
                            <td className="p-2 text-right">{t.credit > 0 ? formatCurrency(t.credit) : '-'}</td>
                            <td className="p-2 text-right font-medium">{formatCurrency(t.balance)}</td>
                            <td className="p-2 text-center">
                              {hasBalance ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPaymentForm(prev => ({ ...prev, amount: String(purchaseMatch.balanceAmount || 0) }))
                                    setPreFillPayment({ amount: String(purchaseMatch.balanceAmount || 0), reference: purchaseMatch.invoiceNo || '' })
                                    setShowRecordPayment(true)
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 hover:bg-green-200 rounded text-xs font-medium"
                                  title={`Pay ${formatCurrency(purchaseMatch.balanceAmount)} towards this bill (FIFO)`}
                                >
                                  <Banknote className="h-3.5 w-3.5" /> Pay
                                </button>
                              ) : (
                                <span className="text-primary-400 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {balance != null && transactions.length > 0 && (
                <div className="p-3 bg-primary-50 border-t border-lime-300 text-sm font-medium text-primary-800">
                  Total paid: {formatCurrency(balance.totalPayments || 0)} &nbsp;|&nbsp; Pending balance: {formatCurrency(balance.netPayable || 0)}
                </div>
              )}
            </div>
          )}

          {activeTab === 'purchases' && (
            <div className="bg-white rounded-lg border-2 border-lime-300 overflow-hidden">
              <p className="text-xs text-primary-500 px-4 py-2 border-b border-lime-200 bg-lime-50/50">Each bill shows Paid / Partial / Unpaid. Click Pay to record payment (FIFO).</p>
              {balance != null && (
                <div className="px-4 py-2 border-b border-lime-200 bg-primary-50/50 text-xs font-medium text-primary-800">
                  Total paid: {formatCurrency(balance.totalPayments || 0)} &nbsp;|&nbsp; Pending balance: {formatCurrency(balance.netPayable || 0)}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-primary-100">
                    <tr>
                      <th className="text-left p-2">Invoice No</th>
                      <th className="text-left p-2">Date</th>
                      <th className="text-right p-2">Total</th>
                      <th className="text-right p-2">Paid</th>
                      <th className="text-right p-2">Balance</th>
                      <th className="text-center p-2">Status</th>
                      <th className="text-center p-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchases.length === 0 ? (
                      <tr><td colSpan={7} className="p-4 text-center text-primary-500">No purchases</td></tr>
                    ) : (
                      purchases.map(p => {
                        const hasBalance = (p.balanceAmount || 0) > 0
                        return (
                          <tr key={p.id} className="border-t border-primary-100 hover:bg-primary-50">
                            <td className="p-2 font-medium">{p.invoiceNo}</td>
                            <td className="p-2">{formatDate(p.purchaseDate)}</td>
                            <td className="p-2 text-right">{formatCurrency(p.totalAmount || 0)}</td>
                            <td className="p-2 text-right text-green-600">{formatCurrency(p.paidAmount || 0)}</td>
                            <td className="p-2 text-right text-amber-600">{formatCurrency(p.balanceAmount || 0)}</td>
                            <td className="p-2 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                (p.paymentStatus || '').toLowerCase() === 'paid' ? 'bg-green-100 text-green-800' :
                                (p.paymentStatus || '').toLowerCase() === 'partial' ? 'bg-amber-100 text-amber-800' :
                                'bg-neutral-100 text-neutral-700'
                              }`}>
                                {p.paymentStatus || 'Unpaid'}
                              </span>
                            </td>
                            <td className="p-2 text-center">
                              {hasBalance ? (
                                <button type="button" onClick={() => { setPaymentForm(prev => ({ ...prev, amount: String(p.balanceAmount || 0) })); setPreFillPayment({ amount: String(p.balanceAmount || 0), reference: p.invoiceNo || '' }); setShowRecordPayment(true) }} className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 hover:bg-green-200 rounded text-xs font-medium">
                                  <Banknote className="h-3.5 w-3.5" /> Pay
                                </button>
                              ) : (
                                <span className="text-primary-400 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'payments' && (
            <div className="bg-white rounded-lg border-2 border-lime-300 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-primary-100">
                    <tr>
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">Reference</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Balance After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length === 0 ? (
                      <tr><td colSpan={4} className="p-4 text-center text-primary-500">No payments</td></tr>
                    ) : (
                      payments.map((t, i) => (
                        <tr key={i} className="border-t border-primary-100 hover:bg-primary-50">
                          <td className="p-2">{formatDate(t.date)}</td>
                          <td className="p-2">{t.reference || '-'}</td>
                          <td className="p-2 text-right font-medium text-green-700">{formatCurrency(t.credit || 0)}</td>
                          <td className="p-2 text-right">{formatCurrency(t.balance)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'vendor-discounts' && (
            <div className="bg-white rounded-lg border-2 border-lime-300 overflow-hidden">
              {!canUseVendorDiscounts ? (
                <div className="p-6 text-center">
                  {!supplierInfo?.id ? (
                    <p className="text-primary-600">Add this supplier to the directory to track vendor discounts.</p>
                  ) : (
                    <p className="text-amber-700 font-medium">Access Restricted. Vendor Discounts are only available to Owner and Admin.</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="p-4 border-b border-lime-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-bold text-green-800">Total Savings: {formatCurrency(totalSavings)}</p>
                      <p className="text-xs text-primary-500 mt-0.5">Private tracking – not reflected in ledger or reports.</p>
                    </div>
                    <button
                      type="button"
                      onClick={openAddVendorDiscount}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm"
                    >
                      <Plus className="h-4 w-4" /> Add Vendor Discount
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-primary-100">
                        <tr>
                          <th className="text-left p-2">Date</th>
                          <th className="text-left p-2">Purchase Ref</th>
                          <th className="text-left p-2">Type</th>
                          <th className="text-right p-2">Amount</th>
                          <th className="text-left p-2">Reason</th>
                          <th className="text-left p-2">Added By</th>
                          <th className="text-center p-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendorDiscounts.length === 0 ? (
                          <tr><td colSpan={7} className="p-6 text-center text-primary-500">No vendor discounts recorded yet.</td></tr>
                        ) : (
                          vendorDiscounts.map((row) => (
                            <tr key={row.id} className="border-t border-primary-100 hover:bg-primary-50">
                              <td className="p-2">{formatDate(row.discountDate)}</td>
                              <td className="p-2">{row.purchaseInvoiceNo || '—'}</td>
                              <td className="p-2">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getDiscountTypeBadgeClass(row.discountType)}`}>
                                  {row.discountType}
                                </span>
                              </td>
                              <td className="p-2 text-right font-bold">{formatCurrency(row.amount)}</td>
                              <td className="p-2 max-w-xs truncate" title={row.reason}>{row.reason || '—'}</td>
                              <td className="p-2 text-primary-600">{row.createdByUserName || '—'}</td>
                              <td className="p-2 text-center">
                                <button type="button" onClick={() => openEditVendorDiscount(row)} className="text-indigo-600 hover:text-indigo-800 p-1" title="Edit"><Pencil className="h-4 w-4 inline" /></button>
                                <button type="button" onClick={() => { setDeleteVendorDiscountId(row.id); setShowDeleteVendorDiscountConfirm(true) }} className="text-red-600 hover:text-red-800 p-1 ml-1" title="Delete"><Trash2 className="h-4 w-4 inline" /></button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDangerModal
        isOpen={showOverpaymentConfirm}
        onClose={() => setShowOverpaymentConfirm(false)}
        onConfirm={() => submitRecordPayment()}
        title="Record overpayment?"
        message={balance ? `Amount (${formatCurrency(parseFloat(paymentForm.amount) || 0)}) exceeds outstanding (${formatCurrency(balance.netPayable)}). Record overpayment?` : ''}
        confirmLabel="Record overpayment"
      />

      <Modal
        isOpen={showVendorDiscountModal}
        onClose={() => { setShowVendorDiscountModal(false); setEditingVendorDiscount(null) }}
        title={editingVendorDiscount ? 'Edit Vendor Discount' : 'Add Vendor Discount'}
        size="md"
      >
        <form onSubmit={saveVendorDiscount} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Related Purchase (optional)</label>
            <select
              value={vendorDiscountForm.purchaseId}
              onChange={e => setVendorDiscountForm({ ...vendorDiscountForm, purchaseId: e.target.value })}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            >
              <option value="">— None —</option>
              {purchases.filter(p => (p.paymentStatus || '').toLowerCase() !== 'paid' || (p.balanceAmount || 0) > 0).map(p => (
                <option key={p.id} value={p.id}>{p.invoiceNo} – {formatCurrency(p.balanceAmount || 0)} balance</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Discount Amount (AED) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={vendorDiscountForm.amount}
              onChange={e => setVendorDiscountForm({ ...vendorDiscountForm, amount: e.target.value })}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Discount Date *</label>
            <input
              type="date"
              required
              max={new Date().toISOString().split('T')[0]}
              value={vendorDiscountForm.discountDate}
              onChange={e => setVendorDiscountForm({ ...vendorDiscountForm, discountDate: e.target.value })}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Discount Type *</label>
            <select
              value={vendorDiscountForm.discountType}
              onChange={e => setVendorDiscountForm({ ...vendorDiscountForm, discountType: e.target.value })}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            >
              {DISCOUNT_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Reason / Notes *</label>
            <textarea
              required
              minLength={3}
              rows={3}
              placeholder="e.g., 5% bulk order discount, 10 boxes free"
              value={vendorDiscountForm.reason}
              onChange={e => setVendorDiscountForm({ ...vendorDiscountForm, reason: e.target.value })}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            />
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            This discount will be tracked privately and will NOT affect ledger, cash flow, or any reports.
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowVendorDiscountModal(false); setEditingVendorDiscount(null) }} className="px-4 py-2 border-2 border-primary-300 rounded-lg hover:bg-primary-50 font-medium">Cancel</button>
            <button type="submit" disabled={savingVendorDiscount} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
              {savingVendorDiscount ? 'Saving...' : 'Save Discount'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDangerModal
        isOpen={showDeleteVendorDiscountConfirm}
        onClose={() => { setShowDeleteVendorDiscountConfirm(false); setDeleteVendorDiscountId(null) }}
        onConfirm={confirmDeleteVendorDiscount}
        title="Delete vendor discount?"
        message="Delete this vendor discount record? This cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  )
}

export default SupplierDetailPage
