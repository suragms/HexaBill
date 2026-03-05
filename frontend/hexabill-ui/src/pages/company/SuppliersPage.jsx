import { useState, useEffect } from 'react'
import { Eye } from 'lucide-react'
import { suppliersAPI } from '../../services'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'

const SuppliersPage = () => {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [ledgerModal, setLedgerModal] = useState({
    isOpen: false,
    supplierName: null,
    summary: null,
    transactions: [],
    loading: false
  })

  const loadSuppliers = async () => {
    try {
      setLoading(true)
      const res = await suppliersAPI.getAllSuppliersSummary()
      const data = res?.data ?? res
      setSuppliers(Array.isArray(data) ? data : [])
    } catch (_) {
      toast.error('Failed to load suppliers')
      setSuppliers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSuppliers()
  }, [])

  const openLedger = async (supplier) => {
    const name = supplier?.supplierName ?? supplier?.SupplierName ?? ''
    if (!name) return
    setLedgerModal({ isOpen: true, supplierName: name, summary: supplier, transactions: [], loading: true })
    try {
      const [balanceRes, txRes] = await Promise.all([
        suppliersAPI.getSupplierBalance(name),
        suppliersAPI.getSupplierTransactions(name)
      ])
      const balance = balanceRes?.data ?? balanceRes
      const list = txRes?.data ?? txRes ?? []
      setLedgerModal(prev => ({
        ...prev,
        summary: balance ? {
          totalPurchases: balance.totalPurchases ?? balance.TotalPurchases ?? 0,
          totalPayments: balance.totalPayments ?? balance.TotalPayments ?? 0,
          netPayable: balance.netPayable ?? balance.NetPayable ?? 0,
          overdueAmount: balance.overdueAmount ?? balance.OverdueAmount ?? 0,
          lastPurchaseDate: balance.lastPurchaseDate ?? balance.LastPurchaseDate
        } : prev.summary,
        transactions: Array.isArray(list) ? list : [],
        loading: false
      }))
    } catch (_) {
      setLedgerModal(prev => ({ ...prev, transactions: [], loading: false }))
    }
  }

  const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—')

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-50 pb-20">
      <div className="bg-primary-100 border-b-2 border-primary-200 px-4 py-3 sticky top-0 z-20 shadow-sm">
        <h1 className="text-lg font-bold text-primary-800">Suppliers</h1>
        <p className="text-sm text-primary-600">Manage suppliers and view outstanding balances</p>
      </div>

      <div className="p-4 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
          </div>
        ) : (
          <div className="bg-white rounded-lg border-2 border-lime-300 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-lime-100">
                  <tr>
                    <th className="px-3 py-2 text-left border-r border-lime-300">Supplier</th>
                    <th className="px-3 py-2 text-left border-r border-lime-300">Phone</th>
                    <th className="px-3 py-2 text-right border-r border-lime-300">Outstanding</th>
                    <th className="px-3 py-2 text-right border-r border-lime-300">Overdue</th>
                    <th className="px-3 py-2 text-left border-r border-lime-300">Last Purchase</th>
                    <th className="px-3 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-lime-200">
                  {suppliers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-primary-500">
                        No suppliers yet. Create a supplier when adding a purchase.
                      </td>
                    </tr>
                  ) : (
                    suppliers.map((s) => (
                      <tr key={s.supplierName || s.SupplierName} className="hover:bg-lime-50">
                        <td className="px-3 py-2 font-medium text-primary-800">{s.supplierName ?? s.SupplierName}</td>
                        <td className="px-3 py-2 text-primary-600">{s.phone ?? s.Phone ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-medium text-primary-700">
                          AED {(s.netPayable ?? s.NetPayable ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {(s.overdueAmount ?? s.OverdueAmount ?? 0) > 0 ? (
                            <span className="text-red-600 font-medium">AED {(s.overdueAmount ?? s.OverdueAmount).toFixed(2)}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 text-primary-600">{formatDate(s.lastPurchaseDate ?? s.LastPurchaseDate)}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => openLedger(s)}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View Ledger
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Ledger Modal */}
      {ledgerModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setLedgerModal(prev => ({ ...prev, isOpen: false }))}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-lime-300">
              <h3 className="text-lg font-bold text-primary-800">Supplier Ledger: {ledgerModal.supplierName}</h3>
              {ledgerModal.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                  <div><span className="text-primary-500">Total Purchases</span><br /><span className="font-medium">{formatCurrency(ledgerModal.summary.totalPurchases)}</span></div>
                  <div><span className="text-primary-500">Total Paid</span><br /><span className="font-medium">{formatCurrency(ledgerModal.summary.totalPayments)}</span></div>
                  <div><span className="text-primary-500">Outstanding</span><br /><span className="font-medium text-primary-700">{formatCurrency(ledgerModal.summary.netPayable)}</span></div>
                  <div><span className="text-primary-500">Overdue</span><br /><span className="font-medium text-red-600">{formatCurrency(ledgerModal.summary.overdueAmount ?? 0)}</span></div>
                </div>
              )}
            </div>
            <div className="p-4 overflow-auto flex-1">
              {ledgerModal.loading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" /></div>
              ) : ledgerModal.transactions.length === 0 ? (
                <p className="text-primary-500 text-sm">No transactions</p>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr><th className="text-left py-1">Date</th><th className="text-left py-1">Type</th><th className="text-left py-1">Reference</th><th className="text-right py-1">Debit</th><th className="text-right py-1">Credit</th><th className="text-right py-1">Balance</th></tr></thead>
                  <tbody>
                    {ledgerModal.transactions.map((t, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-1">{formatDate(t.date)}</td>
                        <td className="py-1">{t.type}</td>
                        <td className="py-1">{t.reference ?? '—'}</td>
                        <td className="py-1 text-right">{t.debit ? formatCurrency(t.debit) : '—'}</td>
                        <td className="py-1 text-right">{t.credit ? formatCurrency(t.credit) : '—'}</td>
                        <td className="py-1 text-right font-medium">{formatCurrency(t.balance ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-4 border-t border-lime-300">
              <button
                type="button"
                onClick={() => setLedgerModal(prev => ({ ...prev, isOpen: false }))}
                className="px-3 py-2 bg-primary-600 text-white rounded text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SuppliersPage
