import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  FileText,
  RefreshCw,
  Lock,
  Send,
  Download,
  ArrowLeft,
  Calendar
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import { reportsAPI } from '../../services'
import { LoadingCard } from '../../components/Loading'

function quarterToRange(quarter, year) {
  const startMonth = (quarter - 1) * 3
  const from = new Date(year, startMonth, 1)
  const to = new Date(year, startMonth + 3, 0)
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0]
  }
}

const VatReturnPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const now = new Date()
  const [fromDate, setFromDate] = useState(() => {
    const from = searchParams.get('from')
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) return from
    const q = Math.ceil((now.getMonth() + 1) / 3)
    return quarterToRange(q, now.getFullYear()).from
  })
  const [toDate, setToDate] = useState(() => {
    const to = searchParams.get('to')
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) return to
    const q = Math.ceil((now.getMonth() + 1) / 3)
    return quarterToRange(q, now.getFullYear()).to
  })
  const [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3))
  const [year, setYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null) // null | 'access' | { message: string }
  const [vatReturn, setVatReturn] = useState(null)

  const fetchVatReturn = useCallback(async (forceRefresh = false) => {
    setLoadError(null)
    setLoading(true)
    try {
      const params = (fromDate && toDate) ? { from: fromDate, to: toDate } : { quarter, year }
      const res = await reportsAPI.getVatReturn(params)
      if (res?.success && res?.data) {
        setVatReturn(res.data)
      } else {
        setVatReturn(null)
      }
    } catch (err) {
      const status = err?.response?.status
      const data = err?.response?.data
      const msg = data?.message || err?.message || 'Failed to load VAT return'
      const errors = data?.errors
      if (status === 403) {
        setLoadError('access')
        if (!err?._handledByInterceptor) toast.error("You don't have permission to view VAT Return.")
      } else {
        setLoadError({ message: msg, errors: Array.isArray(errors) ? errors : undefined })
        if (!err?._handledByInterceptor) toast.error(msg)
      }
      setVatReturn(null)
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, quarter, year])

  useEffect(() => {
    fetchVatReturn()
  }, [fetchVatReturn])

  // Sync URL with period
  useEffect(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (from && to) {
      setFromDate(from)
      setToDate(to)
    }
  }, [searchParams.get('from'), searchParams.get('to')])

  const handlePeriodPreset = (preset) => {
    if (preset.startsWith('Q')) {
      const q = parseInt(preset.slice(1), 10)
      const { from, to } = quarterToRange(q, year)
      setFromDate(from)
      setToDate(to)
      setQuarter(q)
      setSearchParams({ from, to })
    } else if (preset === 'thisYear') {
      const from = `${year}-01-01`
      const to = `${year}-12-31`
      setFromDate(from)
      setToDate(to)
      setSearchParams({ from, to })
    }
  }

  const handleFromToChange = () => {
    setSearchParams({ from: fromDate, to: toDate })
  }

  const v = vatReturn
  const hasFta201 = v && typeof v.box1a === 'number'
  const issues = v?.validationIssues || []
  const blocking = issues.filter(i => i.severity === 'Blocking')
  const periodLabel = v?.periodLabel || (fromDate && toDate ? `${fromDate} to ${toDate}` : `Q${quarter} ${year}`)

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            aria-label="Back to Dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">VAT Return (FTA Form 201)</h1>
            <p className="text-sm text-gray-500">UAE Federal Tax Authority VAT return</p>
          </div>
        </div>
      </div>

      {/* Period selector */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Period</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map(q => (
              <button
                key={q}
                type="button"
                onClick={() => handlePeriodPreset(`Q${q}`)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Q{q}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handlePeriodPreset('thisYear')}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
            >
              This Year
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              onBlur={handleFromToChange}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              onBlur={handleFromToChange}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {[2024, 2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingCard message="Loading VAT return..." />
      ) : loadError === 'access' ? (
        <div className="py-12 text-center">
          <div className="max-w-md mx-auto rounded-lg border border-amber-200 bg-amber-50 p-6">
            <p className="text-amber-800 font-medium">You don&apos;t have access to VAT Return</p>
            <p className="mt-2 text-sm text-amber-700">This report is for Admin, Owner, or Manager.</p>
          </div>
        </div>
      ) : loadError && typeof loadError === 'object' ? (
        <div className="py-12 text-center">
          <div className="max-w-md mx-auto rounded-lg border border-red-200 bg-red-50 p-6">
            <p className="text-red-800 font-medium">Error loading VAT return</p>
            <p className="mt-2 text-sm text-red-700">{loadError.message}</p>
            {(loadError.errors && loadError.errors.length > 0) && (
              <p className="mt-2 text-xs text-red-600 font-mono">Details: {loadError.errors[0]}</p>
            )}
            <button
              type="button"
              onClick={() => fetchVatReturn(true)}
              className="mt-4 px-4 py-2 bg-red-100 text-red-800 rounded-md text-sm hover:bg-red-200"
            >
              Try again
            </button>
          </div>
        </div>
      ) : !vatReturn || !hasFta201 ? (
        <div className="py-12 text-center bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500">No VAT data for this period. Set date range or quarter/year and load.</p>
          <button
            type="button"
            onClick={() => fetchVatReturn(true)}
            className="mt-4 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            Refresh / Load report
          </button>
        </div>
      ) : (
        <>
          {/* Actions bar */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">
              Period: {periodLabel}
              {(v.status || '').toLowerCase() === 'locked' && (
                <span className="ml-2 inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Locked</span>
              )}
              {(v.status || '').toLowerCase() === 'submitted' && (
                <span className="ml-2 inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Submitted</span>
              )}
            </span>
            <button
              type="button"
              onClick={async () => {
                if (!fromDate || !toDate) { toast.error('Set From/To dates then recalculate'); return }
                try {
                  const res = await reportsAPI.calculateVatReturn(fromDate, toDate)
                  if (res?.success && res?.data) { setVatReturn(res.data); toast.success('Recalculated') }
                } catch (err) { toast.error(err?.response?.data?.message || 'Calculate failed') }
              }}
              className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" /> Recalculate
            </button>
            {isAdminOrOwner(user) && v.periodId != null && (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    if (blocking.length > 0) { toast.error('Resolve blocking validation issues before locking'); return }
                    if ((v.status || '').toLowerCase() === 'locked') { toast.error('Period is already locked'); return }
                    if (!window.confirm('Lock this VAT period? No further edits to transactions in this period will be allowed.')) return
                    try {
                      const res = await reportsAPI.lockVatReturnPeriod(v.periodId)
                      if (res?.success) { setVatReturn(prev => ({ ...prev, status: 'Locked' })); toast.success('Period locked') }
                      else toast.error(res?.message || 'Lock failed')
                    } catch (err) { toast.error(err?.response?.data?.message || 'Lock failed') }
                  }}
                  disabled={blocking.length > 0 || (v.status || '').toLowerCase() === 'locked'}
                  className="inline-flex items-center gap-1 px-3 py-2 border border-amber-500 text-amber-700 rounded-md text-sm hover:bg-amber-50 disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" /> Lock period
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await reportsAPI.submitVatReturnPeriod(v.periodId)
                      if (res?.success) { setVatReturn(prev => ({ ...prev, status: 'Submitted' })); toast.success('VAT return submitted (placeholder)') }
                      else toast.error(res?.message || 'Submit failed')
                    } catch (err) { toast.error(err?.response?.data?.message || 'Submit failed') }
                  }}
                  className="inline-flex items-center gap-1 px-3 py-2 border border-green-600 text-green-700 rounded-md text-sm hover:bg-green-50"
                >
                  <Send className="h-4 w-4" /> Submit
                </button>
              </>
            )}
            <button
              type="button"
              onClick={async () => {
                try {
                  const blob = await reportsAPI.exportVatReturnExcel(fromDate && toDate ? { from: fromDate, to: toDate } : { quarter, year })
                  const url = window.URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `VAT-Return-${periodLabel.replace(/\s/g, '-')}.xlsx`
                  a.click()
                  window.URL.revokeObjectURL(url)
                  toast.success('Excel exported')
                } catch (err) { toast.error(err?.response?.data?.message || 'Export failed') }
              }}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded-md text-sm hover:bg-primary-700"
            >
              <Download className="h-4 w-4" /> Export Excel
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const blob = await reportsAPI.exportVatReturnCsv(fromDate && toDate ? { from: fromDate, to: toDate } : { quarter, year })
                  const url = window.URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `VAT-Return-${periodLabel.replace(/\s/g, '-')}.csv`
                  a.click()
                  window.URL.revokeObjectURL(url)
                  toast.success('CSV exported')
                } catch (err) { toast.error(err?.response?.data?.message || 'Export failed') }
              }}
              className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
            >
              Print / PDF
            </button>
          </div>

          {/* Validation issues */}
          {blocking.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">Validation (blocking): resolve before locking period.</p>
              <ul className="mt-2 list-disc list-inside text-sm text-red-700">
                {blocking.map((i, idx) => <li key={idx}>{i.message}</li>)}
              </ul>
            </div>
          )}
          {issues.length > 0 && blocking.length === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <span className="font-medium">Warnings:</span> {issues.map(i => i.message).join('; ')}
            </div>
          )}

          {/* Top summary cards - Output VAT, Input VAT, Payable/Refund */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg border-2 border-blue-200 p-4">
              <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">Output VAT</p>
              <p className="text-xl font-bold text-blue-900 mt-1">{formatCurrency(v.box1b)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Box 1b – Standard rated sales VAT</p>
            </div>
            <div className="bg-white rounded-lg border-2 border-green-200 p-4">
              <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Input VAT</p>
              <p className="text-xl font-bold text-green-900 mt-1">{formatCurrency(v.box12)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Box 12 – Total recoverable</p>
            </div>
            <div className={`rounded-lg border-2 p-4 ${(v.box13a || 0) > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <p className={`text-xs font-medium uppercase tracking-wide ${(v.box13a || 0) > 0 ? 'text-red-700' : 'text-green-700'}`}>
                {(v.box13a || 0) > 0 ? 'VAT Payable' : 'VAT Refundable'}
              </p>
              <p className={`text-xl font-bold mt-1 ${(v.box13a || 0) > 0 ? 'text-red-900' : 'text-green-900'}`}>
                {(v.box13a || 0) > 0 ? formatCurrency(v.box13a) : formatCurrency(v.box13b)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{(v.box13a || 0) > 0 ? 'Box 13a' : 'Box 13b'}</p>
            </div>
          </div>

          {/* FTA 201 Summary */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">FTA Form 201 Summary</h2>
            <p className="text-sm text-gray-600 mb-3">Section 1 – Sales (Output VAT)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-4">
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">1a Taxable (net)</p><p className="font-semibold">{formatCurrency(v.box1a)}</p></div>
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">1b VAT on taxable</p><p className="font-semibold">{formatCurrency(v.box1b)}</p></div>
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">2 Zero-rated</p><p className="font-semibold">{formatCurrency(v.box2)}</p></div>
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">3 Exempt</p><p className="font-semibold">{formatCurrency(v.box3)}</p></div>
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">4 Reverse charge</p><p className="font-semibold">{formatCurrency(v.box4)}</p></div>
            </div>
            <p className="text-sm text-gray-600 mb-3">Section 2 – Purchases (Input VAT)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-4">
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">9b Recoverable input</p><p className="font-semibold">{formatCurrency(v.box9b)}</p></div>
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">10 Reverse ch. VAT</p><p className="font-semibold">{formatCurrency(v.box10)}</p></div>
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">11 Input adj.</p><p className="font-semibold">{formatCurrency(v.box11)}</p></div>
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">12 Total recoverable</p><p className="font-semibold">{formatCurrency(v.box12)}</p></div>
            </div>
            <p className="text-sm text-gray-600 mb-3">Section 3 – VAT summary (Payable / Refund)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              <div className="border rounded-lg p-3 bg-primary-50"><p className="text-xs text-gray-500">13a Payable</p><p className="font-bold">{formatCurrency(v.box13a)}</p></div>
              <div className="border rounded-lg p-3 bg-green-50"><p className="text-xs text-gray-500">13b Refundable</p><p className="font-bold">{formatCurrency(v.box13b)}</p></div>
              <div className="border rounded-lg p-3"><p className="text-xs text-gray-500">Petroleum excluded</p><p className="font-semibold">{formatCurrency(v.petroleumExcluded)}</p></div>
            </div>
          </div>

          {/* Output VAT Table */}
          {(v.outputLines?.length > 0) && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <h3 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">Output VAT</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Ref</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Date</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Net (AED)</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">VAT (AED)</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Scenario</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {v.outputLines.map((line, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">{line.reference}</td>
                        <td className="px-4 py-2">{line.date ? (typeof line.date === 'string' ? line.date.slice(0, 10) : new Date(line.date).toISOString().slice(0, 10)) : '-'}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.netAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.vatAmount)}</td>
                        <td className="px-4 py-2">{line.vatScenario || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td colSpan="2" className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.outputLines.reduce((s, l) => s + (Number(l.netAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.outputLines.reduce((s, l) => s + (Number(l.vatAmount) || 0), 0))}</td>
                      <td className="px-4 py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Input VAT Table */}
          {(v.inputLines?.length > 0) && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <h3 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">Input VAT (claimable)</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Ref</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Date</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Net (AED)</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">VAT (AED)</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Claimable (AED)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {v.inputLines.map((line, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">{line.reference}</td>
                        <td className="px-4 py-2">{line.date ? (typeof line.date === 'string' ? line.date.slice(0, 10) : new Date(line.date).toISOString().slice(0, 10)) : '-'}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.netAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.vatAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.claimableVat)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td colSpan="2" className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.inputLines.reduce((s, l) => s + (Number(l.netAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.inputLines.reduce((s, l) => s + (Number(l.vatAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.inputLines.reduce((s, l) => s + (Number(l.claimableVat) || 0), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Credit Notes Table */}
          {(v.creditNoteLines?.length > 0) && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <h3 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">Credit notes</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Ref</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Date</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Net (AED)</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">VAT (AED)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {v.creditNoteLines.map((line, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">{line.reference}</td>
                        <td className="px-4 py-2">{line.date ? (typeof line.date === 'string' ? line.date.slice(0, 10) : new Date(line.date).toISOString().slice(0, 10)) : '-'}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.netAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.vatAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td colSpan="2" className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.creditNoteLines.reduce((s, l) => s + (Number(l.netAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.creditNoteLines.reduce((s, l) => s + (Number(l.vatAmount) || 0), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Reverse Charge Table */}
          {(v.reverseChargeLines?.length > 0) && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <h3 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">Reverse charge</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Ref</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Net (AED)</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">VAT (AED)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {v.reverseChargeLines.map((line, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">{line.reference}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.netAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.reverseChargeVat)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.reverseChargeLines.reduce((s, l) => s + (Number(l.netAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.reverseChargeLines.reduce((s, l) => s + (Number(l.reverseChargeVat) || 0), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Petroleum / Excise excluded (informational) */}
          {(v.petroleumExcluded != null && Number(v.petroleumExcluded) !== 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="font-medium text-amber-900">Petroleum / Excise excluded</h3>
              <p className="text-sm text-amber-800 mt-1">Total excluded from Box 9 (Excise): {formatCurrency(v.petroleumExcluded)}</p>
              <p className="text-xs text-amber-700 mt-1">These expenses are subject to Excise Tax and are not included in VAT Return Box 9.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default VatReturnPage
