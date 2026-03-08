/*
Purpose: Recurring Invoices - list and manage automated invoice templates
Author: HexaBill
Date: 2025
*/
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { recurringInvoicesAPI } from '../../services'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import { FileText, Plus, Trash2 } from 'lucide-react'

const FREQ_LABELS = { 0: 'Daily', 1: 'Weekly', 2: 'Monthly', 3: 'Yearly' }

const RecurringInvoicesPage = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState([])

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const res = await recurringInvoicesAPI.getRecurringInvoices()
      if (res?.success && Array.isArray(res?.data)) {
        setList(res.data)
      } else {
        setList([])
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load recurring invoices')
      setList([])
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this recurring invoice?')) return
    try {
      const res = await recurringInvoicesAPI.deleteRecurringInvoice(id)
      if (res?.success) {
        toast.success('Deleted')
        load()
      } else {
        toast.error(res?.message || 'Delete failed')
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Delete failed')
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Recurring Invoices</h1>
          <p className="text-sm text-neutral-500 mt-1">Automated invoices generated on schedule</p>
        </div>
        <button
          onClick={() => toast('Create form coming soon. Use API for now.')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Plus className="h-5 w-5" />
          Add Recurring Invoice
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-neutral-500">Loading...</div>
      ) : list.length === 0 ? (
        <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-12 text-center">
          <FileText className="h-12 w-12 text-neutral-400 mx-auto mb-3" />
          <p className="text-neutral-600">No recurring invoices yet</p>
          <p className="text-sm text-neutral-500 mt-1">Create one to automatically generate invoices on a schedule</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-neutral-200 rounded-lg">
          <table className="min-w-full divide-y divide-neutral-200">
            <thead>
              <tr className="bg-neutral-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600">Frequency</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600">Next Run</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-neutral-600">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-neutral-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-neutral-200 hover:bg-neutral-50">
                  <td className="px-4 py-3 text-sm text-neutral-900">{r.customerName || `Customer #${r.customerId}`}</td>
                  <td className="px-4 py-3 text-sm text-neutral-600">{FREQ_LABELS[r.frequency] ?? 'Unknown'}</td>
                  <td className="px-4 py-3 text-sm text-neutral-600">
                    {r.nextRunDate ? new Date(r.nextRunDate).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${r.isActive ? 'bg-green-100 text-green-800' : 'bg-neutral-200 text-neutral-600'}`}>
                      {r.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default RecurringInvoicesPage
