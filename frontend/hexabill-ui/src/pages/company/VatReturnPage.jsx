import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  FileText,
  RefreshCw,
  Lock,
  Send,
  Download,
  ArrowLeft,
  Calendar,
  LayoutDashboard,
  TrendingUp,
  ShoppingCart,
  Receipt,
  FileX,
  ShieldCheck,
  History,
  AlertTriangle,
  CheckCircle
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import { reportsAPI } from '../../services'
import { LoadingCard } from '../../components/Loading'
import TabNavigation from '../../components/ui/TabNavigation'

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
  const [activeTab, setActiveTab] = useState('summary')
  const [validationExpanded, setValidationExpanded] = useState(false)

  const fetchVatReturn = useCallback(async (fromOverride, toOverride) => {
    const f = fromOverride ?? fromDate
    const t = toOverride ?? toDate
    if (!f || !t) return
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
  const issues = v?.validationIssues || []
  const blocking = issues.filter(i => i.severity === 'Blocking')
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
  const purchaseLines = (v?.inputLines || []).filter(l => (l.type || '').toLowerCase() === 'purchase')
  const expenseLines = (v?.inputLines || []).filter(l => (l.type || '').toLowerCase() === 'expense')
  const daysUntilDue = v?.dueDate ? Math.ceil((new Date(v.dueDate) - new Date()) / 86400000) : null

  const tabs = [
    { id: 'summary', label: 'Summary', icon: LayoutDashboard },
    { id: 'sales', label: 'Sales', icon: TrendingUp, badge: v?.outputLines?.length ?? 0 },
    { id: 'purchases', label: 'Purchases', icon: ShoppingCart, badge: purchaseLines.length },
    { id: 'expenses', label: 'Expenses', icon: Receipt, badge: expenseLines.length },
    { id: 'creditnotes', label: 'Credit Notes', icon: FileX, badge: (v?.creditNoteLines?.length ?? 0) + (v?.reverseChargeLines?.length ?? 0) },
    { id: 'validation', label: 'Validation', icon: ShieldCheck, badge: issues.length || '✓' },
    { id: 'history', label: 'History', icon: History }
  ]

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

          {/* No transactions info */}
          {v && (!v.outputLines?.length) && (!v.inputLines?.length) && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              No transactions found for this period. FTA boxes below show zeros.
            </div>
          )}

          {/* Tab navigation */}
          <TabNavigation tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

          {/* Tab content */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {activeTab === 'summary' && (
              <>
          {/* Top summary cards – key totals for period (all AED) */}
          <p className="text-xs text-gray-500 px-4 mb-1">Totals for selected period (AED)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6 p-4">
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
                {(v.box13a || 0) > 0 ? formatCurrency(v.box13a) : formatCurrency(v.box13b ?? 0)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{(v.box13a || 0) > 0 ? 'Box 13a' : 'Box 13b'}</p>
            </div>
            <div className="rounded-lg border-2 border-amber-200 p-4 bg-amber-50/50">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">Filing Deadline</p>
              <p className="text-lg font-bold text-amber-900 mt-1">
                {daysUntilDue != null ? (daysUntilDue > 0 ? `${daysUntilDue} days` : 'Overdue') : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{v.dueDate ? new Date(v.dueDate).toLocaleDateString('en-GB') : ''}</p>
            </div>
            <div className="rounded-lg border-2 border-slate-200 p-4 bg-slate-50/50">
              <p className="text-xs font-medium text-slate-700 uppercase tracking-wide">Transactions</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{v.transactionCount ?? 0}</p>
              <p className="text-xs text-gray-500 mt-0.5">In this period</p>
            </div>
            {(v.petroleumExcluded != null && Number(v.petroleumExcluded) > 0) && (
              <div className="rounded-lg border-2 border-orange-200 p-4 bg-orange-50/50">
                <p className="text-xs font-medium text-orange-700 uppercase tracking-wide">Petroleum Excluded</p>
                <p className="text-xl font-bold text-orange-900 mt-1">{formatCurrency(v.petroleumExcluded)}</p>
                <p className="text-xs text-gray-500 mt-0.5">Excise — Box 9 excluded</p>
              </div>
            )}
          </div>

          {/* FTA 201 Summary – table-style layout so totals per section are clear */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">FTA Form 201 Summary</h2>
            <p className="text-xs text-gray-500 mb-4">Box values for this period — use tabs above for line-level detail.</p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left font-medium text-gray-700 border-b border-gray-200">Section</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-700 border-b border-gray-200">Box</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700 border-b border-gray-200">Amount (AED)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr className="bg-blue-50/50"><td className="px-3 py-2 font-medium text-gray-800" rowSpan="5">1 – Sales (Output VAT)</td><td className="px-3 py-2 text-gray-600">1a Taxable (net)</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box1a)}</td></tr>
                  <tr className="bg-blue-50/50"><td className="px-3 py-2 text-gray-600">1b VAT on taxable</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box1b)}</td></tr>
                  <tr className="bg-blue-50/50"><td className="px-3 py-2 text-gray-600">2 Zero-rated</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box2)}</td></tr>
                  <tr className="bg-blue-50/50"><td className="px-3 py-2 text-gray-600">3 Exempt</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box3)}</td></tr>
                  <tr className="bg-blue-50/50"><td className="px-3 py-2 text-gray-600">4 Reverse charge</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box4)}</td></tr>
                  <tr className="bg-green-50/50"><td className="px-3 py-2 font-medium text-gray-800" rowSpan="4">2 – Purchases (Input VAT)</td><td className="px-3 py-2 text-gray-600">9b Recoverable input</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box9b)}</td></tr>
                  <tr className="bg-green-50/50"><td className="px-3 py-2 text-gray-600">10 Reverse ch. VAT</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box10)}</td></tr>
                  <tr className="bg-green-50/50"><td className="px-3 py-2 text-gray-600">11 Input adj.</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.box11)}</td></tr>
                  <tr className="bg-green-50/50"><td className="px-3 py-2 text-gray-600">12 Total recoverable</td><td className="px-3 py-2 text-right font-bold">{formatCurrency(v.box12)}</td></tr>
                  <tr className="bg-slate-100/50"><td className="px-3 py-2 font-medium text-gray-800" rowSpan="3">3 – Payable / Refund</td><td className="px-3 py-2 text-gray-600">13a Payable</td><td className="px-3 py-2 text-right font-bold">{formatCurrency(v.box13a)}</td></tr>
                  <tr className="bg-slate-100/50"><td className="px-3 py-2 text-gray-600">13b Refundable</td><td className="px-3 py-2 text-right font-bold">{formatCurrency(v.box13b ?? 0)}</td></tr>
                  <tr className="bg-slate-100/50"><td className="px-3 py-2 text-gray-600">Petroleum excluded</td><td className="px-3 py-2 text-right font-medium">{formatCurrency(v.petroleumExcluded ?? 0)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
              </>
            )}

            {activeTab === 'sales' && (
          <>
          {/* Output VAT Table */}
          {(v.outputLines?.length > 0) ? (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <h3 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">Output VAT (Sales)</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Ref</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Date</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Customer</th>
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
                        <td className="px-4 py-2">{line.customerName ?? line.CustomerName ?? '—'}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.netAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.vatAmount)}</td>
                        <td className="px-4 py-2">{line.vatScenario || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td colSpan="3" className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.outputLines.reduce((s, l) => s + (Number(l.netAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(v.outputLines.reduce((s, l) => s + (Number(l.vatAmount) || 0), 0))}</td>
                      <td className="px-4 py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500 text-sm">No sales in this period.</div>
          )}
          </>
            )}

            {activeTab === 'purchases' && (
          <>
          {purchaseLines.length > 0 ? (
            <div className="overflow-hidden">
              <h3 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">Input VAT (Purchases)</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Ref</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Date</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Supplier</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Net (AED)</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">VAT Paid</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Claimable</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">ITC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {purchaseLines.map((line, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">{line.reference}</td>
                        <td className="px-4 py-2">{line.date ? (typeof line.date === 'string' ? line.date.slice(0, 10) : new Date(line.date).toISOString().slice(0, 10)) : '-'}</td>
                        <td className="px-4 py-2">{line.supplierName ?? line.SupplierName ?? '—'}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.netAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.vatAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.claimableVat)}</td>
                        <td className="px-4 py-2">{line.isTaxClaimable ? '✓' : '✗'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td colSpan="3" className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(purchaseLines.reduce((s, l) => s + (Number(l.netAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(purchaseLines.reduce((s, l) => s + (Number(l.vatAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(purchaseLines.reduce((s, l) => s + (Number(l.claimableVat) || 0), 0))}</td>
                      <td className="px-4 py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500 text-sm">No purchases in this period.</div>
          )}
          </>
            )}

            {activeTab === 'expenses' && (
          <>
          {expenseLines.length > 0 ? (
            <div className="overflow-hidden">
              <h3 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">Input VAT (Expenses)</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Ref</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Date</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Category</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Net (AED)</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">VAT Paid</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Claimable</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Tax Type</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">ITC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {expenseLines.map((line, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">{line.reference}</td>
                        <td className="px-4 py-2">{line.date ? (typeof line.date === 'string' ? line.date.slice(0, 10) : new Date(line.date).toISOString().slice(0, 10)) : '-'}</td>
                        <td className="px-4 py-2">{line.categoryName ?? line.CategoryName ?? '—'}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.netAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.vatAmount)}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(line.claimableVat)}</td>
                        <td className="px-4 py-2">{line.taxType ?? '—'}</td>
                        <td className="px-4 py-2">{line.isTaxClaimable ? '✓' : '✗'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td colSpan="3" className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(expenseLines.reduce((s, l) => s + (Number(l.netAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(expenseLines.reduce((s, l) => s + (Number(l.vatAmount) || 0), 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(expenseLines.reduce((s, l) => s + (Number(l.claimableVat) || 0), 0))}</td>
                      <td colSpan="2" className="px-4 py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500 text-sm">No expenses in this period.</div>
          )}
          </>
            )}

            {activeTab === 'creditnotes' && (
          <>
          {(v.creditNoteLines?.length > 0 || v.reverseChargeLines?.length > 0) ? (
            <div className="p-4 space-y-6">
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

          {(v.petroleumExcluded != null && Number(v.petroleumExcluded) !== 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="font-medium text-amber-900">Petroleum / Excise excluded</h3>
              <p className="text-sm text-amber-800 mt-1">Total excluded from Box 9 (Excise): {formatCurrency(v.petroleumExcluded)}</p>
              <p className="text-xs text-amber-700 mt-1">These expenses are subject to Excise Tax and are not included in VAT Return Box 9.</p>
            </div>
          )}
            </div>
          ) : (
            <div className="p-6 text-center text-gray-500 text-sm">No credit notes or reverse charge in this period.</div>
          )}
          </>
            )}

            {activeTab === 'validation' && (
              <div className="p-4">
                {issues.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                    <p className="font-medium text-green-800">All validation checks passed</p>
                    <p className="text-sm text-green-700 mt-1">Period is ready to lock.</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {issues.map((i, idx) => (
                      <li key={idx} className={`flex items-start gap-2 p-3 rounded-lg border ${i.severity === 'Blocking' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-gray-200">{i.ruleId}</span>
                        <span className="text-sm flex-1">{i.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="p-6 text-center text-gray-500 text-sm">
                Period history: use Recalculate and Lock to manage periods. History list can be added here.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default VatReturnPage
