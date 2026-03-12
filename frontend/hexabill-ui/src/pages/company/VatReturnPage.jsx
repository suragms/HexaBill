import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  RefreshCw,
  Lock,
  Send,
  Download,
  ArrowLeft,
  Calendar,
  ShieldCheck,
  AlertTriangle,
  CheckCircle
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
  const [validationExpanded, setValidationExpanded] = useState(false)

  const isValidDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)

  const fetchVatReturn = useCallback(async (fromOverride, toOverride) => {
    const f = fromOverride ?? fromDate
    const t = toOverride ?? toDate
    if (!f || !t) {
      setLoadError({ message: 'Please select a valid date range.', status: null, url: null })
      setVatReturn(null)
      setLoading(false)
      return
    }
    if (!isValidDate(f) || !isValidDate(t)) {
      setLoadError({ message: 'Please select a valid date range (YYYY-MM-DD).', status: null, url: null })
      setVatReturn(null)
      setLoading(false)
      return
    }
    if (f > t) {
      setLoadError({ message: 'From date must be before or equal to To date.', status: null, url: null })
      setVatReturn(null)
      setLoading(false)
      return
    }
    setLoadError(null)
    setLoading(true)
    try {
      const params = { from: f, to: t }
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
      const url = err?.config?.url ?? err?.config?.baseURL ?? '(request URL not available)'
      if (status === 403) {
        setLoadError('access')
        if (!err?._handledByInterceptor) toast.error("You don't have permission to view VAT Return.")
      } else {
        setLoadError({
          message: msg,
          errors: Array.isArray(errors) ? errors : undefined,
          status: status ?? null,
          url: typeof url === 'string' ? url : null
        })
        if (!err?._handledByInterceptor) toast.error(msg)
      }
      setVatReturn(null)
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => {
    if (fromDate && toDate) fetchVatReturn(fromDate, toDate)
  }, [])

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
      fetchVatReturn(from, to)
    } else if (preset === 'thisYear') {
      const from = `${year}-01-01`
      const to = `${year}-12-31`
      setFromDate(from)
      setToDate(to)
      setSearchParams({ from, to })
      fetchVatReturn(from, to)
    }
  }

  const handleCustomApply = () => {
    if (!fromDate || !toDate) return
    setSearchParams({ from: fromDate, to: toDate })
    fetchVatReturn(fromDate, toDate)
  }

  const handleFromToChange = () => {
    if (fromDate && toDate) {
      setSearchParams({ from: fromDate, to: toDate })
      fetchVatReturn(fromDate, toDate)
    }
  }

  const v = vatReturn
  const hasFta201 = v && typeof v.box1a === 'number'
  const issues = (v?.validationIssues ?? v?.ValidationIssues ?? []).filter(Boolean)
  const blocking = issues.filter(i => (i.severity || '').toString() === 'Blocking')
  const hasV002 = issues.some(i => i.ruleId === 'V002')
  const hasSys001 = issues.some(i => i.ruleId === 'SYS001')
  const [backfilling, setBackfilling] = useState(false)
  const handleBackfillVatScenario = async () => {
    try {
      setBackfilling(true)
      const res = await reportsAPI.backfillVatScenario()
      if (res?.success && res?.data?.updated != null) {
        toast.success(res.message || `Updated ${res.data.updated} sale(s). Recalculating…`)
        await fetchVatReturn(fromDate, toDate)
      } else toast.error(res?.message || 'Backfill failed')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to fix VatScenario')
    } finally {
      setBackfilling(false)
    }
  }
  const periodLabel = v?.periodLabel || (fromDate && toDate ? `${fromDate} to ${toDate}` : `Q${quarter} ${year}`)
  const daysUntilDue = v?.dueDate ? Math.ceil((new Date(v.dueDate) - new Date()) / 86400000) : null

  return (
    <div className="w-full px-4 sm:px-6 py-6 space-y-4">
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
      <div className="bg-white rounded-lg border border-gray-200 p-3">
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
            <button
              type="button"
              onClick={handleCustomApply}
              className="px-4 py-2 bg-gray-800 text-white rounded-md text-sm hover:bg-gray-700"
            >
              Apply
            </button>
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
        {loadError && (
          <p className="mt-3 text-sm text-red-600">
            VAT data could not be loaded. Check your connection and period.
          </p>
        )}
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
            {loadError.status != null && (
              <p className="mt-1 text-xs text-red-600 font-mono">HTTP {loadError.status}</p>
            )}
            {loadError.url && (
              <p className="mt-1 text-xs text-red-600 font-mono break-all" title={loadError.url}>{loadError.url}</p>
            )}
            {(loadError.errors && loadError.errors.length > 0) && (
              <p className="mt-2 text-xs text-red-600 font-mono">Details: {loadError.errors[0]}</p>
            )}
            <button
              type="button"
              onClick={() => fetchVatReturn(fromDate, toDate)}
              className="mt-4 px-4 py-2 bg-red-100 text-red-800 rounded-md text-sm hover:bg-red-200"
            >
              Try again
            </button>
          </div>
        </div>
      ) : !vatReturn ? (
        <div className="py-12 text-center bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500">No VAT data for this period. Set date range or quarter/year and load.</p>
          <button
            type="button"
            onClick={() => fromDate && toDate && fetchVatReturn(fromDate, toDate)}
            className="mt-4 px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            Refresh / Load report
          </button>
        </div>
      ) : (
        <>
          {/* Actions bar – hidden when printing */}
          <div className="no-print flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">
              Showing: {fromDate} – {toDate} ({periodLabel})
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
                  if (res?.success && res?.data) {
                    setVatReturn(res.data)
                    setSearchParams({ from: fromDate, to: toDate })
                    toast.success('Recalculated')
                  }
                } catch (err) {
                  const msg = err?.response?.data?.message || err?.response?.data?.errors?.[0] || err?.message || 'Calculate failed'
                  toast.error(msg)
                }
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

          {/* SYS001 calculation error banner */}
          {hasSys001 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Calculation error — partial data shown.</p>
                <p className="text-sm text-red-700 mt-1">{issues.find(i => i.ruleId === 'SYS001')?.message}</p>
              </div>
            </div>
          )}

          {/* Validation issues – compact: group by rule so we don't use huge space for repeated messages */}
          {blocking.length > 0 && !hasSys001 && (() => {
            const grouped = blocking.reduce((acc, i) => {
              const key = `${i.ruleId || 'other'}|${i.message || ''}`
              if (!acc[key]) acc[key] = { ruleId: i.ruleId, message: i.message, count: 0 }
              acc[key].count++
              return acc
            }, {})
            const groups = Object.values(grouped)
            return (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-red-800">
                  {blocking.length} blocking issue{blocking.length !== 1 ? 's' : ''} — resolve before locking period.
                </p>
                <div className="flex items-center gap-2">
                  {hasV002 && isAdminOrOwner(user) && (
                    <button
                      type="button"
                      onClick={handleBackfillVatScenario}
                      disabled={backfilling}
                      className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50"
                    >
                      {backfilling ? 'Fixing…' : 'Fix missing VatScenario'}
                    </button>
                  )}
                  <button type="button" onClick={() => setValidationExpanded(!validationExpanded)} className="text-red-600 text-xs font-medium">
                    {validationExpanded ? 'Hide details' : 'Show details'}
                  </button>
                </div>
              </div>
              {validationExpanded && (
                <ul className="mt-2 space-y-1 text-sm text-red-700">
                  {groups.map((g, idx) => (
                    <li key={idx} className="flex items-baseline gap-2">
                      <span className="font-medium text-red-800">{g.ruleId}</span>
                      <span>{g.count > 1 ? `(${g.count})` : ''} {g.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            )
          })()}
          {issues.length > 0 && blocking.length === 0 && !hasSys001 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <span className="font-medium">Warnings:</span> {issues.map(i => i.message).join('; ')}
            </div>
          )}
          {issues.length === 0 && v && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <p className="text-sm text-green-800 font-medium">All validation checks passed</p>
            </div>
          )}

          {/* No transactions info – actionable message and period clarity */}
          {v && (!v.outputLines?.length) && (!v.inputLines?.length) && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              <p className="font-medium">No transactions in this period.</p>
              <p className="mt-1 text-blue-700">Showing: {fromDate} – {toDate}. Try another date range (e.g. Last quarter) or check that invoices, purchases, and expenses exist for the selected period. FTA boxes below show zeros.</p>
            </div>
          )}

          {/* Hint when Total Sales is 0 so user knows period may not cover their invoice dates */}
          {v && (v.box1a ?? 0) === 0 && (v.box1b ?? 0) === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-medium">Total Sales is 0.00 for this period ({fromDate} – {toDate}).</p>
              <p className="mt-1 text-amber-700">VAT only includes invoices whose <strong>invoice date</strong> falls in this range. If your dashboard shows sales for other dates, pick a period that includes those dates (e.g. same custom range as on the dashboard, or Q1–Q4 for the year when you had sales).</p>
            </div>
          )}

          {/* Simple 3-row VAT summary (HydroBooks-style) – printable */}
          <div className="vat-return-print-area bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">VAT Return Summary</h2>
              <p className="text-xs text-gray-500 mb-4">Period: {periodLabel} ({fromDate} – {toDate})</p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-gray-200 rounded-lg">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-left font-medium text-gray-700 border-b border-gray-200">S#</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-700 border-b border-gray-200">Description</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-700 border-b border-gray-200">Amount (AED)</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-700 border-b border-gray-200">VAT (AED)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="px-3 py-2 font-medium">1</td>
                      <td className="px-3 py-2 text-gray-700">Total Sales</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box1a ?? 0)}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box1b ?? 0)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium">2</td>
                      <td className="px-3 py-2 text-gray-700">Total Purchase and Expense</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box9b ?? 0)}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box12 ?? 0)}</td>
                    </tr>
                    <tr className={(v.box13a ?? 0) > 0 ? 'bg-red-50' : 'bg-green-50'}>
                      <td className="px-3 py-2 font-medium">3</td>
                      <td className="px-3 py-2 font-medium">Net VAT to Pay / Refundable</td>
                      <td className="px-3 py-2 text-right font-medium" colSpan="2">
                        <span className={(v.box13a ?? 0) > 0 ? 'text-red-700 font-bold' : 'text-green-700 font-bold'}>
                          {(v.box13a ?? 0) > 0 ? formatCurrency(v.box13a) : formatCurrency(v.box13b ?? v.Box13b ?? 0)}
                          {(v.box13a ?? 0) > 0 ? ' (Payable)' : ' (Refundable)'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {(v.petroleumExcluded ?? 0) > 0 && (
                <p className="mt-3 text-xs text-amber-700">Petroleum excluded: {formatCurrency(v.petroleumExcluded)}</p>
              )}
            </div>
            {/* Footer bar: Amount Due to FTA / Refund from FTA + filing deadline */}
            <div className={`border-t border-gray-200 px-4 py-4 flex flex-wrap items-center justify-between gap-4 ${(v.box13a ?? 0) > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
              <div>
                <p className="text-sm font-medium text-gray-700">{(v.box13a ?? 0) > 0 ? 'Amount Due to FTA' : 'Refund from FTA'}</p>
                <p className={`text-2xl font-bold mt-0.5 ${(v.box13a ?? 0) > 0 ? 'text-red-700' : 'text-green-700'}`}>
                  {(v.box13a ?? 0) > 0 ? formatCurrency(v.box13a) : formatCurrency(v.box13b ?? v.Box13b ?? 0)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">Filing deadline</p>
                <p className="text-lg font-semibold text-amber-900 mt-0.5">
                  {v.dueDate ? new Date(v.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                </p>
                {daysUntilDue != null && daysUntilDue <= 0 && <p className="text-xs font-medium text-red-600">Overdue</p>}
                {daysUntilDue != null && daysUntilDue > 0 && <p className="text-xs text-gray-500">{daysUntilDue} days left</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Tabs (transactions, sales, purchases, expenses, summary, creditnotes, validation, history) removed – simple 3-row summary only.
export default VatReturnPage
