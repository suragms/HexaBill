import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, DollarSign, FileText, CreditCard, Calendar, Download, Banknote, Pencil, Trash2 } from 'lucide-react'
import { suppliersAPI, purchasesAPI } from '../../services'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import Modal from '../../components/Modal'
const DISCOUNT_TYPES = [
  'Cash Discount',
  'Free Products',
  'Promotional Offer',
  'Negotiated Discount'
]

const tabs = [
  { id: 'summary', label: 'Summary', icon: FileText },
  { id: 'ledger', label: 'Ledger', icon: DollarSign },
  { id: 'purchases', label: 'Purchase History', icon: FileText },
  { id: 'payments', label: 'Payment History', icon: CreditCard }
]

const SupplierDetailPage = () => {
  const { name } = useParams()
  const [searchParams] = useSearchParams()
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
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false)
  const [editingPayment, setEditingPayment] = useState(null)
  const [editPaymentForm, setEditPaymentForm] = useState({ amount: '', paymentDate: '', mode: 'Cash', reference: '', notes: '' })
  const [savingEditPayment, setSavingEditPayment] = useState(false)
  const [showDeletePaymentConfirm, setShowDeletePaymentConfirm] = useState(false)
  const [deletePaymentId, setDeletePaymentId] = useState(null)
  const [deletingPayment, setDeletingPayment] = useState(false)
  const [supplierInfo, setSupplierInfo] = useState(null)
  // Record entry type: Payment vs Ledger Credit (vendor discount)
  const [recordEntryType, setRecordEntryType] = useState('payment')
  const [ledgerCreditForm, setLedgerCreditForm] = useState({
    amount: '',
    creditDate: new Date().toISOString().split('T')[0],
    creditType: 'Cash Discount',
    notes: ''
  })

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

  const submitLedgerCredit = async () => {
    const amount = parseFloat(ledgerCreditForm.amount)
    if (!amount || amount <= 0) return
    try {
      setSaving(true)
      const res = await suppliersAPI.createLedgerCredit(supplierName, {
        amount,
        creditDate: ledgerCreditForm.creditDate,
        creditType: ledgerCreditForm.creditType,
        notes: ledgerCreditForm.notes?.trim() || undefined
      })
      if (res?.success) {
        toast.success('Ledger credit recorded. Outstanding updated.')
        setShowRecordPayment(false)
        setLedgerCreditForm({ amount: '', creditDate: new Date().toISOString().split('T')[0], creditType: 'Cash Discount', notes: '' })
        setRecordEntryType('payment')
        await loadData()
      } else toast.error(res?.message || 'Failed to record ledger credit')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to record ledger credit')
    } finally {
      setSaving(false)
    }
  }

  const handleRecordPayment = async (e) => {
    e.preventDefault()
    if (recordEntryType === 'ledgerCredit') {
      const amount = parseFloat(ledgerCreditForm.amount)
      if (!amount || amount <= 0) {
        toast.error('Please enter a valid amount')
        return
      }
      if (!ledgerCreditForm.creditType?.trim()) {
        toast.error('Please select a vendor discount type')
        return
      }
      await submitLedgerCredit()
      return
    }
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

  const openEditPayment = (t) => {
    if (!t?.paymentId) return
    const d = t.date ? new Date(t.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    setEditingPayment(t)
    setEditPaymentForm({
      amount: String(t.credit ?? 0),
      paymentDate: d,
      mode: t.mode || 'Cash',
      reference: t.reference || '',
      notes: t.notes || ''
    })
    setShowEditPaymentModal(true)
  }

  const saveEditPayment = async (e) => {
    e.preventDefault()
    if (!editingPayment?.paymentId || !supplierName) return
    const amount = parseFloat(editPaymentForm.amount)
    if (!amount || amount <= 0) {
      toast.error('Please enter a valid amount')
      return
    }
    setSavingEditPayment(true)
    try {
      const res = await suppliersAPI.updatePayment(supplierName, editingPayment.paymentId, {
        amount,
        paymentDate: editPaymentForm.paymentDate,
        mode: editPaymentForm.mode,
        reference: editPaymentForm.reference?.trim() || undefined,
        notes: editPaymentForm.notes?.trim() || undefined
      })
      if (res?.success) {
        toast.success('Payment updated')
        setShowEditPaymentModal(false)
        setEditingPayment(null)
        loadData()
      } else toast.error(res?.message || 'Update failed')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update payment')
    } finally {
      setSavingEditPayment(false)
    }
  }

  const confirmDeletePayment = async () => {
    if (!deletePaymentId || !supplierName) return
    setDeletingPayment(true)
    try {
      const res = await suppliersAPI.deletePayment(supplierName, deletePaymentId)
      if (res?.success) {
        toast.success('Payment deleted')
        setShowDeletePaymentConfirm(false)
        setDeletePaymentId(null)
        loadData()
      } else toast.error(res?.message || 'Delete failed')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete payment')
    } finally {
      setDeletingPayment(false)
    }
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
          <h3 className="font-semibold text-primary-800 mb-2">Record entry</h3>
          <div className="flex flex-wrap gap-4 mb-3">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="radio" name="recordEntryType" checked={recordEntryType === 'payment'} onChange={() => setRecordEntryType('payment')} className="text-green-600" />
              <span className="text-sm font-medium text-primary-800">Payment</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="radio" name="recordEntryType" checked={recordEntryType === 'ledgerCredit'} onChange={() => setRecordEntryType('ledgerCredit')} className="text-green-600" />
              <span className="text-sm font-medium text-primary-800">Ledger Credit (Vendor discount)</span>
            </label>
          </div>

          {recordEntryType === 'payment' && (
            <>
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
            </>
          )}
          {recordEntryType === 'ledgerCredit' && (
            <p className="text-xs text-primary-600 mb-3">Ledger credits (e.g. vendor discounts) reduce outstanding. They appear in the Ledger tab and in reports.</p>
          )}

          <form onSubmit={handleRecordPayment} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {recordEntryType === 'payment' ? (
              <>
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
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-primary-700 mb-1">Amount (AED) *</label>
                  <input type="number" step="0.01" min="0.01" required value={ledgerCreditForm.amount} onChange={e => setLedgerCreditForm({ ...ledgerCreditForm, amount: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-primary-700 mb-1">Date *</label>
                  <input type="date" required value={ledgerCreditForm.creditDate} onChange={e => setLedgerCreditForm({ ...ledgerCreditForm, creditDate: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-primary-700 mb-1">Vendor discount type *</label>
                  <select value={ledgerCreditForm.creditType} onChange={e => setLedgerCreditForm({ ...ledgerCreditForm, creditType: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2">
                    {DISCOUNT_TYPES.map(t => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-primary-700 mb-1">Notes</label>
                  <input type="text" value={ledgerCreditForm.notes} onChange={e => setLedgerCreditForm({ ...ledgerCreditForm, notes: e.target.value })} className="w-full border-2 border-lime-300 rounded px-3 py-2" placeholder="Optional" />
                </div>
              </>
            )}
            <div className="sm:col-span-2 flex gap-2 items-end">
              <button type="submit" disabled={saving} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                {saving ? 'Saving...' : recordEntryType === 'ledgerCredit' ? 'Save Ledger Credit' : 'Save Payment'}
              </button>
              <button type="button" onClick={() => { setShowRecordPayment(false); setPreFillPayment({ amount: '', reference: '' }); setRecordEntryType('payment') }} className="px-4 py-2 border-2 border-primary-300 rounded-lg hover:bg-primary-50 font-medium">Cancel</button>
            </div>
          </form>
          {recordEntryType === 'payment' && balance?.netPayable > 0 && parseFloat(paymentForm.amount) > balance.netPayable && (
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
                  {(balance.totalLedgerCredits || 0) > 0 && (
                    <span className="text-sm"><span className="font-semibold text-teal-700">Ledger credits:</span> <span className="font-bold text-teal-800">{formatCurrency(balance.totalLedgerCredits || 0)}</span></span>
                  )}
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
                      <th className="text-left p-2">Mode</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Balance After</th>
                      <th className="text-center p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length === 0 ? (
                      <tr><td colSpan={6} className="p-4 text-center text-primary-500">No payments</td></tr>
                    ) : (
                      payments.map((t, i) => (
                        <tr key={t.paymentId ?? i} className="border-t border-primary-100 hover:bg-primary-50">
                          <td className="p-2">{formatDate(t.date)}</td>
                          <td className="p-2">{t.reference || '-'}</td>
                          <td className="p-2">{t.mode || '-'}</td>
                          <td className="p-2 text-right font-medium text-green-700">{formatCurrency(t.credit || 0)}</td>
                          <td className="p-2 text-right">{formatCurrency(t.balance)}</td>
                          <td className="p-2 text-center">
                            {t.paymentId != null ? (
                              <span className="inline-flex items-center gap-1">
                                <button type="button" onClick={() => openEditPayment(t)} className="text-indigo-600 hover:text-indigo-800 p-1" title="Edit"><Pencil className="h-4 w-4 inline" /></button>
                                <button type="button" onClick={() => { setDeletePaymentId(t.paymentId); setShowDeletePaymentConfirm(true) }} className="text-red-600 hover:text-red-800 p-1" title="Delete"><Trash2 className="h-4 w-4 inline" /></button>
                              </span>
                            ) : (
                              <span className="text-primary-400 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
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
        isOpen={showEditPaymentModal}
        onClose={() => { if (!savingEditPayment) { setShowEditPaymentModal(false); setEditingPayment(null) } }}
        title="Edit Payment"
        size="md"
      >
        <form onSubmit={saveEditPayment} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Amount (AED) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={editPaymentForm.amount}
              onChange={e => setEditPaymentForm(f => ({ ...f, amount: e.target.value }))}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Payment Date *</label>
            <input
              type="date"
              required
              max={new Date().toISOString().split('T')[0]}
              value={editPaymentForm.paymentDate}
              onChange={e => setEditPaymentForm(f => ({ ...f, paymentDate: e.target.value }))}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Mode</label>
            <select
              value={editPaymentForm.mode}
              onChange={e => setEditPaymentForm(f => ({ ...f, mode: e.target.value }))}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            >
              <option value="Cash">Cash</option>
              <option value="Bank">Bank</option>
              <option value="Cheque">Cheque</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Reference</label>
            <input
              type="text"
              value={editPaymentForm.reference}
              onChange={e => setEditPaymentForm(f => ({ ...f, reference: e.target.value }))}
              placeholder="Optional"
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-700 mb-1">Notes</label>
            <textarea
              value={editPaymentForm.notes}
              onChange={e => setEditPaymentForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
              rows={2}
              className="w-full border-2 border-primary-200 rounded-lg px-3 py-2"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowEditPaymentModal(false); setEditingPayment(null) }} className="px-4 py-2 border-2 border-primary-300 rounded-lg hover:bg-primary-50 font-medium">Cancel</button>
            <button type="submit" disabled={savingEditPayment} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
              {savingEditPayment ? 'Saving...' : 'Update Payment'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDangerModal
        isOpen={showDeletePaymentConfirm}
        onClose={() => { if (!deletingPayment) { setShowDeletePaymentConfirm(false); setDeletePaymentId(null) } }}
        onConfirm={confirmDeletePayment}
        title="Delete payment?"
        message="This payment will be removed. Ledger and outstanding balance will be recalculated. This cannot be undone."
        confirmLabel={deletingPayment ? 'Deleting...' : 'Delete'}
      />
    </div>
  )
}

export default SupplierDetailPage
