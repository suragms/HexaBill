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

/** Format date as YYYY-MM-DD using local date (avoid toISOString() which shifts day in some timezones). */
function toLocalDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function quarterToRange(quarter, year) {
  const startMonth = (quarter - 1) * 3
  const from = new Date(year, startMonth, 1)
  const to = new Date(year, startMonth + 3, 0)
  return {
    from: toLocalDateStr(from),
    to: toLocalDateStr(to)
  }
}

/** Mirrors backend: only full quarter (Q1–Q4) or full calendar year is valid. */
function isSupportedVatPeriod(fromStr, toStr) {
  if (!fromStr || !toStr || !/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) return false
  const from = new Date(fromStr)
  const to = new Date(toStr)
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return false
  const y = from.getFullYear()
  const mFrom = from.getMonth() + 1
  const dFrom = from.getDate()
  const mTo = to.getMonth() + 1
  const dTo = to.getDate()
  const lastDayOfTo = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate()
  // Full calendar year
  if (dFrom === 1 && mFrom === 1 && mTo === 12 && dTo === lastDayOfTo && from.getFullYear() === to.getFullYear()) return true
  // Exact quarter: 3 months, same year, start on 1 Jan/Apr/Jul/Oct
  if (from.getFullYear() !== to.getFullYear()) return false
  if (dFrom !== 1 || dTo !== lastDayOfTo) return false
  const monthsInclusive = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1
  if (monthsInclusive !== 3) return false
  const startMonth = from.getMonth() + 1
  return [1, 4, 7, 10].includes(startMonth)
}

/**
 * If the range is not valid but can be unambiguously mapped to a quarter or full year,
 * return the corrected boundaries. Handles:
 * - Same-year quarter (e.g. 30-09–30-12 → Q4 01-10–31-12)
 * - Cross-year "almost Q1" (e.g. 31-12-2025–30-03-2026 → Q1 2026: 01-01–31-03)
 * - Same-year full year (≥300 days → 01-01–31-12)
 * Returns null if we should not snap.
 */
function snapToSupportedVatPeriod(fromStr, toStr) {
  if (!fromStr || !toStr || !/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) return null
  const from = new Date(fromStr)
  const to = new Date(toStr)
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return null
  const daysDiff = Math.round((to - from) / 86400000)
  const fromYear = from.getFullYear()
  const toYear = to.getFullYear()

  if (fromYear !== toYear) {
    if (toYear === fromYear + 1 && from.getMonth() === 11 && to.getMonth() <= 2 && daysDiff >= 1 && daysDiff <= 93) {
      return { from: `${toYear}-01-01`, to: `${toYear}-03-31` }
    }
    return null
  }

  const y = fromYear
  if (daysDiff >= 300) return { from: `${y}-01-01`, to: `${y}-12-31` }
  if (daysDiff > 93) return null
  const toMonth = to.getMonth() + 1
  const quarter = Math.ceil(toMonth / 3)
  const startMonth = (quarter - 1) * 3
  const snappedFrom = new Date(y, startMonth, 1)
  const snappedTo = new Date(y, startMonth + 3, 0)
  return {
    from: toLocalDateStr(snappedFrom),
    to: toLocalDateStr(snappedTo)
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
  const [ledgerFallback, setLedgerFallback] = useState(null) // { totalSalesNet, totalSalesVat } when VAT return has 0 sales but ledger has data
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
    let fromFinal = f
    let toFinal = t
    if (!isSupportedVatPeriod(f, t)) {
      const snap = snapToSupportedVatPeriod(f, t)
      if (snap) {
        fromFinal = snap.from
        toFinal = snap.to
        setFromDate(snap.from)
        setToDate(snap.to)
        setQuarter(Math.ceil((new Date(snap.from).getMonth() + 1) / 3))
        setYear(new Date(snap.from).getFullYear())
        setSearchParams({ from: snap.from, to: snap.to })
        toast.success(`Adjusted to full quarter: ${snap.from} to ${snap.to}`)
      } else {
        setLoadError({
          message: 'VAT period must be a full quarter (Q1–Q4) or a full calendar year (01-Jan to 31-Dec).',
          status: 400,
          url: null
        })
        setVatReturn(null)
        setLoading(false)
        return
      }
    }
    setLoadError(null)
    setLoading(true)
    try {
      const params = { from: fromFinal, to: toFinal }
      const res = await reportsAPI.getVatReturn(params)
      // CRITICAL: Unwrap inner DTO (API returns { success, data: dto } or nested { data: { data: dto } })
      const dto = res?.data?.data ?? res?.data ?? null
      const success = res?.success !== false && dto != null
      if (success) {
        setVatReturn(dto)
        setLoadError(null)
        // When VAT return has 0 sales but we have a period, fetch Sales Ledger for same period so Overview shows real totals
        const hasNoSales = !(dto.outputLines?.length || dto.OutputLines?.length) && (Number(dto.box1a ?? dto.Box1a ?? 0) === 0)
        if (hasNoSales && fromFinal && toFinal) {
          try {
            const ledgerRes = await reportsAPI.getComprehensiveSalesLedger({ fromDate: fromFinal, toDate: toFinal })
            const summary = ledgerRes?.data?.summary ?? ledgerRes?.data?.Summary ?? ledgerRes?.summary ?? null
            if (summary) {
              const totalSales = Number(summary.totalSales ?? summary.TotalSales ?? 0)
              const totalSalesVat = Number(summary.totalSalesVat ?? summary.TotalSalesVat ?? 0)
              if (totalSales > 0 || totalSalesVat > 0) {
                const net = totalSales - totalSalesVat
                setLedgerFallback({ totalSalesNet: net >= 0 ? net : totalSales, totalSalesVat: totalSalesVat })
              } else setLedgerFallback(null)
            } else setLedgerFallback(null)
          } catch (_) { setLedgerFallback(null) }
        } else setLedgerFallback(null)
      } else {
        setVatReturn(dto ?? null)
        setLedgerFallback(null)
        if (!res?.success && res?.message) {
          setLoadError({ message: res.message, status: res?.status ?? null, url: null })
        } else {
          setLoadError(null)
        }
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
      setLedgerFallback(null)
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  // On first load: if URL has invalid VAT period, try snap-to-quarter else fall back to current quarter
  useEffect(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (from && to && !isSupportedVatPeriod(from, to)) {
      const snap = snapToSupportedVatPeriod(from, to)
      if (snap) {
        setFromDate(snap.from)
        setToDate(snap.to)
        setQuarter(Math.ceil((new Date(snap.from).getMonth() + 1) / 3))
        setYear(new Date(snap.from).getFullYear())
        setSearchParams({ from: snap.from, to: snap.to })
        fetchVatReturn(snap.from, snap.to)
      } else {
        const q = Math.ceil((now.getMonth() + 1) / 3)
        const y = now.getFullYear()
        const { from: f, to: t } = quarterToRange(q, y)
        setFromDate(f)
        setToDate(t)
        setQuarter(q)
        setYear(y)
        setSearchParams({ from: f, to: t })
        fetchVatReturn(f, t)
      }
      return
    }
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

  // Refresh when sales, purchases, or expenses are updated from other pages
  useEffect(() => {
    const handler = () => { if (fromDate && toDate) fetchVatReturn(fromDate, toDate) }
    window.addEventListener('dataUpdated', handler)
    return () => window.removeEventListener('dataUpdated', handler)
  }, [fromDate, toDate, fetchVatReturn])

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

  const [activeTab, setActiveTab] = useState('overview') // overview | transactions | sales | purchases | expenses | creditNotes | validation
  const v = vatReturn
  // Normalize API response: support both camelCase and PascalCase; coerce to number so totals always display correctly
  const box1a = v != null ? Number(v.box1a ?? v.Box1a ?? 0) : 0
  const box1b = v != null ? Number(v.box1b ?? v.Box1b ?? 0) : 0
  const box9b = v != null ? Number(v.box9b ?? v.Box9b ?? 0) : 0
  const box12 = v != null ? Number(v.box12 ?? v.Box12 ?? 0) : 0
  const box13a = v != null ? Number(v.box13a ?? v.Box13a ?? 0) : 0
  const box13b = v != null ? Number(v.box13b ?? v.Box13b ?? 0) : 0
  const outputLines = v?.outputLines ?? v?.OutputLines ?? []
  const inputLines = v?.inputLines ?? v?.InputLines ?? []
  const creditNoteLines = v?.creditNoteLines ?? v?.CreditNoteLines ?? []
  const totalInputNet = (inputLines || []).reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  // Totals per tab (same filters as tables; coerce to number to avoid wrong/zero from strings)
  const salesLinesForTotal = (outputLines || []).filter(line => ((line.vatScenario ?? line.VatScenario) || '').toLowerCase() !== 'exempt')
  const totalSalesNet = salesLinesForTotal.reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  const totalSalesVat = salesLinesForTotal.reduce((s, l) => s + (Number(l.vatAmount ?? l.VatAmount) || 0), 0)
  const purchaseLines = (inputLines || []).filter(l => ((l.type ?? l.Type) ?? '').toString().toLowerCase() === 'purchase')
  const totalPurchasesNet = purchaseLines.reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  const totalPurchasesVat = purchaseLines.reduce((s, l) => s + (Number(l.claimableVat ?? l.ClaimableVat) || 0), 0)
  const expenseLines = (inputLines || []).filter(l => ((l.type ?? l.Type) ?? '').toString().toLowerCase() === 'expense')
  const totalExpensesNet = expenseLines.reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  const totalExpensesVat = expenseLines.reduce((s, l) => s + (Number(l.claimableVat ?? l.ClaimableVat) || 0), 0)
  const totalCreditNotesNet = (creditNoteLines || []).reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  const totalCreditNotesVat = (creditNoteLines || []).reduce((s, l) => s + (Number(l.vatAmount ?? l.VatAmount) || 0), 0)
  // REAL CALCULATION FLOW: Use (1) line totals when API boxes are 0 but we have lines, (2) Sales Ledger fallback when VAT return has 0 sales but ledger has data.
  const displayBox1a = (box1a === 0 && salesLinesForTotal.length > 0)
    ? totalSalesNet
    : (box1a === 0 && ledgerFallback) ? (ledgerFallback.totalSalesNet ?? 0) : box1a
  const displayBox1b = (box1b === 0 && salesLinesForTotal.length > 0)
    ? totalSalesVat
    : (box1b === 0 && ledgerFallback) ? (ledgerFallback.totalSalesVat ?? 0) : box1b
  const displayBox12 = (box12 === 0 && (purchaseLines.length > 0 || expenseLines.length > 0)) ? (totalPurchasesVat + totalExpensesVat) : box12
  const displayBox13a = Math.max(0, displayBox1b - displayBox12)
  const displayBox13b = Math.max(0, displayBox12 - displayBox1b)
  const hasFta201 = v && (typeof box1a === 'number' || typeof v.box1a === 'number')
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
  // Derive period label from dates when it's a full quarter - prevents wrong API label (e.g. Q4-2025 for Jan-Mar 2026)
  const derivedPeriodLabel = (() => {
    if (!fromDate || !toDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return null
    const y = parseInt(fromDate.slice(0, 4), 10)
    const mFrom = parseInt(fromDate.slice(5, 7), 10)
    const dFrom = parseInt(fromDate.slice(8, 10), 10)
    const mTo = parseInt(toDate.slice(5, 7), 10)
    const dTo = parseInt(toDate.slice(8, 10), 10)
    const lastDay = new Date(y, mTo, 0).getDate()
    if (dFrom === 1 && mTo - mFrom === 2 && dTo === lastDay && [1, 4, 7, 10].includes(mFrom))
      return `Q${Math.ceil(mFrom / 3)}-${y}`
    if (mFrom === 1 && dFrom === 1 && mTo === 12 && dTo === 31) return `${y}`
    return null
  })()
  const periodLabel = derivedPeriodLabel || v?.periodLabel || (fromDate && toDate ? `${fromDate} to ${toDate}` : `Q${quarter} ${year}`)
  const daysUntilDue = v?.dueDate ? Math.ceil((new Date(v.dueDate) - new Date()) / 86400000) : null

  // Which preset (if any) matches current from/to — for button highlight
  const activePreset = (() => {
    if (!fromDate || !toDate || !isSupportedVatPeriod(fromDate, toDate)) return null
    const y = new Date(fromDate).getFullYear()
    if (fromDate === `${y}-01-01` && toDate === `${y}-12-31`) return 'thisYear'
    for (let q = 1; q <= 4; q++) {
      const { from, to } = quarterToRange(q, y)
      if (from === fromDate && to === toDate) return `Q${q}`
    }
    return null
  })()

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
                className={`px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 ${activePreset === `Q${q}` ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-300'}`}
              >
                Q{q}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handlePeriodPreset('thisYear')}
              className={`px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 ${activePreset === 'thisYear' ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-300'}`}
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
            {fromDate && toDate && (
              <button
                type="button"
                onClick={() => fetchVatReturn(fromDate, toDate)}
                disabled={loading}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
                title="Refresh VAT data"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            )}
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
        <p className="mt-2 text-xs text-gray-500">
          Use Q1–Q4 or <strong>This Year</strong> for FTA returns. If all values show 0.00, try <strong>This Year</strong> or the quarter when you had sales/purchases. Custom range must be a full quarter or full year (e.g. 2025-01-01 to 2025-12-31).
        </p>
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
                  const dto = res?.data?.data ?? res?.data ?? null
                  const ok = res?.success === true || (res?.success !== false && dto != null)
                  if (ok && dto) {
                    setVatReturn(dto)
                    setSearchParams({ from: fromDate, to: toDate })
                    toast.success('Recalculated')
                    // When API returns 0 sales, fetch Sales Ledger for same period so Overview shows real totals
                    const hasNoSales = !(dto.outputLines?.length || dto.OutputLines?.length) && (Number(dto.box1a ?? dto.Box1a ?? 0) === 0)
                    if (hasNoSales && fromDate && toDate) {
                      try {
                        const ledgerRes = await reportsAPI.getComprehensiveSalesLedger({ fromDate, toDate })
                        const summary = ledgerRes?.data?.summary ?? ledgerRes?.data?.Summary ?? ledgerRes?.summary ?? null
                        if (summary && (Number(summary.totalSales ?? summary.TotalSales ?? 0) > 0 || Number(summary.totalSalesVat ?? summary.TotalSalesVat ?? 0) > 0)) {
                          const totalSales = Number(summary.totalSales ?? summary.TotalSales ?? 0)
                          const totalSalesVat = Number(summary.totalSalesVat ?? summary.TotalSalesVat ?? 0)
                          const net = totalSales - totalSalesVat
                          setLedgerFallback({ totalSalesNet: net >= 0 ? net : totalSales, totalSalesVat: totalSalesVat })
                        } else setLedgerFallback(null)
                      } catch (_) { setLedgerFallback(null) }
                    } else setLedgerFallback(null)
                  } else if (!dto) toast.error(res?.message || 'Recalculate returned no data')
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
          {v && !outputLines.length && !inputLines.length && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              <p className="font-medium">No transactions in this period.</p>
              <p className="mt-1 text-blue-700">Showing: {fromDate} – {toDate}. Try <strong>This Year</strong> (button above) or the quarter when you had sales. FTA boxes below show zeros until the period includes your invoice/purchase/expense dates.</p>
              <button
                type="button"
                onClick={() => handlePeriodPreset('thisYear')}
                className="mt-2 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
              >
                Load This Year ({year || new Date().getFullYear()})
              </button>
            </div>
          )}

          {/* Hint when Total Sales is 0: suggest the year that contains the out-of-period invoice dates */}
          {v && displayBox1a === 0 && displayBox1b === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-medium">Total Sales is 0.00 for this period ({fromDate} – {toDate}).</p>
              <p className="mt-1 text-amber-700">VAT only includes invoices whose <strong>invoice date</strong> falls in this range. If your dashboard shows sales for other dates, pick a period that includes those dates.</p>
              {issues.some(i => (i.message || '').toLowerCase().includes('outside')) && (() => {
                // Parse warning messages for "YYYY-MM-DD" to suggest the correct year (e.g. 2025-10-25 → 2025)
                const dateMatch = issues.find(i => (i.message || '').match(/\d{4}-\d{2}-\d{2}/))
                const suggestedYear = dateMatch ? parseInt((dateMatch.message || '').match(/(\d{4})-\d{2}-\d{2}/)?.[1] || '', 10) : null
                const y = (Number.isInteger(suggestedYear) && suggestedYear >= 2020 && suggestedYear <= 2030) ? suggestedYear : (year || new Date().getFullYear())
                return (
                  <>
                    <p className="mt-2 text-amber-700">To include those invoices, choose a period that contains their dates (e.g. This Year {y}).</p>
                    <p className="mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          const from = `${y}-01-01`
                          const to = `${y}-12-31`
                          setFromDate(from)
                          setToDate(to)
                          setYear(y)
                          setSearchParams({ from, to })
                          fetchVatReturn(from, to)
                        }}
                        className="text-amber-800 font-semibold underline hover:no-underline"
                      >
                        Suggest period: This Year ({y})
                      </button>
                    </p>
                  </>
                )
              })()}
              {!issues.some(i => (i.message || '').toLowerCase().includes('outside')) && (
                <p className="mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const y = year || new Date().getFullYear()
                      const from = `${y}-01-01`
                      const to = `${y}-12-31`
                      setFromDate(from)
                      setToDate(to)
                      setSearchParams({ from, to })
                      fetchVatReturn(from, to)
                    }}
                    className="text-amber-800 font-semibold underline hover:no-underline"
                  >
                    Suggest period: This Year ({year || new Date().getFullYear()})
                  </button>
                </p>
              )}
            </div>
          )}

          {/* Tabs navigation */}
          <div className="mt-4 border-b border-gray-200">
            <nav className="-mb-px flex flex-wrap gap-4 text-sm" aria-label="VAT tabs">
              {[
                { id: 'overview', label: 'Overview' },
                { id: 'transactions', label: 'Transactions' },
                { id: 'sales', label: 'Sales' },
                { id: 'purchases', label: 'Purchases' },
                { id: 'expenses', label: 'Expenses' },
                { id: 'creditNotes', label: 'Credit Notes' },
                { id: 'validation', label: 'Validation' }
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`whitespace-nowrap border-b-2 pb-2 px-1 ${
                    activeTab === tab.id ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Overview tab – simple FTA-style summary only */}
          {activeTab === 'overview' && (
            <div className="mt-4 vat-return-print-area bg-white rounded-lg border border-gray-200 overflow-hidden">
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
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(displayBox1a)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(displayBox1b)}</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium">2</td>
                        <td className="px-3 py-2 text-gray-700">Total Purchase and Expense (net)</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(totalInputNet)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(displayBox12)}</td>
                      </tr>
                      <tr className={displayBox13a > 0 ? 'bg-red-50' : 'bg-green-50'}>
                        <td className="px-3 py-2 font-medium">3</td>
                        <td className="px-3 py-2 font-medium">Net VAT to Pay / Refundable</td>
                        <td className="px-3 py-2 text-right font-medium" colSpan="2">
                          <span className={displayBox13a > 0 ? 'text-red-700 font-bold' : 'text-green-700 font-bold'}>
                            {displayBox13a > 0 ? formatCurrency(displayBox13a) : formatCurrency(displayBox13b)}
                            {displayBox13a > 0 ? ' (Payable)' : ' (Refundable)'}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 p-2 rounded bg-gray-50 border border-gray-200 text-xs text-gray-700">
                  <p className="font-medium text-gray-800">Overview totals are correct.</p>
                  <p className="mt-1">Net VAT to Pay = Sales VAT (Box 1b) − Input VAT (Box 12: purchases + claimable expenses). If Expense VAT shows 0, only expenses marked <strong>Tax claimable (ITC)</strong> on the Expenses page with VAT in this period are included. After adding or editing expenses, click <strong>Refresh</strong> or <strong>Recalculate</strong> to update.</p>
                </div>
                {(v.petroleumExcluded ?? 0) > 0 && (
                  <p className="mt-3 text-xs text-amber-700">Petroleum excluded: {formatCurrency(v.petroleumExcluded)}</p>
                )}
              </div>
              {/* Footer bar: Amount Due to FTA / Refund from FTA + filing deadline */}
              <div className={`border-t border-gray-200 px-4 py-4 flex flex-wrap items-center justify-between gap-4 ${displayBox13a > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                <div>
                  <p className="text-sm font-medium text-gray-700">{displayBox13a > 0 ? 'Amount Due to FTA' : 'Refund from FTA'}</p>
                  <p className={`text-2xl font-bold mt-0.5 ${displayBox13a > 0 ? 'text-red-700' : 'text-green-700'}`}>
                    {displayBox13a > 0 ? formatCurrency(displayBox13a) : formatCurrency(displayBox13b)}
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
          )}

          {/* Transactions-related tabs – simple tables, no dashboards */}
          {activeTab === 'transactions' && (
            <div className="mt-4 bg-white rounded-lg border border-gray-200 p-4 space-y-4">
              <h2 className="text-sm font-semibold text-gray-900">All VAT Transactions</h2>
              <p className="text-xs text-gray-500 mb-2">Combined view of sales outputs and purchase/expense inputs used in this VAT period.</p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border border-gray-200 rounded-lg">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-2 py-1 text-left border-b">Type</th>
                      <th className="px-2 py-1 text-left border-b">Reference</th>
                      <th className="px-2 py-1 text-left border-b">Date</th>
                      <th className="px-2 py-1 text-right border-b">Net</th>
                      <th className="px-2 py-1 text-right border-b">VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outputLines.map((line, idx) => (
                      <tr key={`out-${idx}`} className="border-t">
                        <td className="px-2 py-1 text-gray-700">Output</td>
                        <td className="px-2 py-1">{line.reference ?? line.Reference ?? ''}</td>
                        <td className="px-2 py-1">{(line.date ?? line.Date) && new Date(line.date ?? line.Date).toLocaleDateString('en-GB')}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(line.netAmount ?? line.NetAmount ?? 0)}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(line.vatAmount ?? line.VatAmount ?? 0)}</td>
                      </tr>
                    ))}
                    {inputLines.map((line, idx) => (
                      <tr key={`in-${idx}`} className="border-t">
                        <td className="px-2 py-1 text-gray-700">Input</td>
                        <td className="px-2 py-1">{line.reference ?? line.Reference ?? ''}</td>
                        <td className="px-2 py-1">{(line.date ?? line.Date) && new Date(line.date ?? line.Date).toLocaleDateString('en-GB')}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(line.netAmount ?? line.NetAmount ?? 0)}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(line.vatAmount ?? line.VatAmount ?? line.claimableVat ?? line.ClaimableVat ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'sales' && (
            <div className="mt-4 bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900">Sales Invoices (Output VAT)</h2>
              <div className="overflow-x-auto mt-2">
                <table className="min-w-full text-xs border border-gray-200 rounded-lg">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-2 py-1 text-left border-b">Invoice</th>
                      <th className="px-2 py-1 text-left border-b">Customer</th>
                      <th className="px-2 py-1 text-left border-b">Scenario</th>
                      <th className="px-2 py-1 text-right border-b">Net</th>
                      <th className="px-2 py-1 text-right border-b">VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outputLines
                      .filter(line => ((line.vatScenario ?? line.VatScenario) || '').toLowerCase() !== 'exempt')
                      .map((line, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-2 py-1">{line.reference ?? line.Reference ?? ''}</td>
                          <td className="px-2 py-1">{line.customerName ?? line.CustomerName ?? ''}</td>
                          <td className="px-2 py-1">{line.vatScenario ?? line.VatScenario ?? ''}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(line.netAmount ?? line.NetAmount ?? 0)}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(line.vatAmount ?? line.VatAmount ?? 0)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
                      <td className="px-2 py-2" colSpan={3}>Total</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(totalSalesNet)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(totalSalesVat)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'purchases' && (
            <div className="mt-4 bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900">Purchases (Input VAT)</h2>
              {purchaseLines.length === 0 && (
                <p className="mt-2 text-xs text-gray-600">Only purchases in this period with <strong>Tax claimable</strong> and VAT &gt; 0 appear. Check that purchase dates fall in {fromDate} – {toDate} and that items are marked tax claimable on the Purchases page.</p>
              )}
              <div className="overflow-x-auto mt-2">
                <table className="min-w-full text-xs border border-gray-200 rounded-lg">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-2 py-1 text-left border-b">Bill</th>
                      <th className="px-2 py-1 text-left border-b">Supplier</th>
                      <th className="px-2 py-1 text-left border-b">Tax Type</th>
                      <th className="px-2 py-1 text-right border-b">Net</th>
                      <th className="px-2 py-1 text-right border-b">Claimable VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseLines.map((line, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-2 py-1">{line.reference ?? line.Reference ?? ''}</td>
                          <td className="px-2 py-1">{line.supplierName ?? line.SupplierName ?? ''}</td>
                          <td className="px-2 py-1">{line.taxType ?? line.TaxType ?? ''}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(line.netAmount ?? line.NetAmount ?? 0)}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(line.claimableVat ?? line.ClaimableVat ?? 0)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
                      <td className="px-2 py-2" colSpan={3}>Total</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(totalPurchasesNet)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(totalPurchasesVat)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'expenses' && (
            <div className="mt-4 bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900">Expenses (Input VAT)</h2>
              {expenseLines.length === 0 && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  No claimable expenses in this period. On the <strong>Expenses</strong> page, mark expenses as <strong>Tax claimable (ITC)</strong> and ensure they have VAT. Then click <strong>Refresh</strong> or <strong>Recalculate</strong> here to update.
                </p>
              )}
              <div className="overflow-x-auto mt-2">
                <table className="min-w-full text-xs border border-gray-200 rounded-lg">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-2 py-1 text-left border-b">Expense</th>
                      <th className="px-2 py-1 text-left border-b">Category</th>
                      <th className="px-2 py-1 text-left border-b">Tax Type</th>
                      <th className="px-2 py-1 text-right border-b">Net</th>
                      <th className="px-2 py-1 text-right border-b">Claimable VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inputLines
                      .filter(line => (line.type ?? line.Type) === 'Expense')
                      .map((line, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-2 py-1">{line.reference ?? line.Reference ?? ''}</td>
                          <td className="px-2 py-1">{line.categoryName ?? line.CategoryName ?? ''}</td>
                          <td className="px-2 py-1">{line.taxType ?? line.TaxType ?? ''}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(line.netAmount ?? line.NetAmount ?? 0)}</td>
                          <td className="px-2 py-1 text-right">{formatCurrency(line.claimableVat ?? line.ClaimableVat ?? 0)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
                      <td className="px-2 py-2" colSpan={3}>Total</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(totalExpensesNet)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(totalExpensesVat)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'creditNotes' && (
            <div className="mt-4 bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900">Credit Notes (Sales & Purchases)</h2>
              <div className="overflow-x-auto mt-2">
                <table className="min-w-full text-xs border border-gray-200 rounded-lg">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-2 py-1 text-left border-b">Reference</th>
                      <th className="px-2 py-1 text-left border-b">Side</th>
                      <th className="px-2 py-1 text-left border-b">Date</th>
                      <th className="px-2 py-1 text-right border-b">Net</th>
                      <th className="px-2 py-1 text-right border-b">VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditNoteLines.map((line, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-2 py-1">{line.reference ?? line.Reference ?? ''}</td>
                        <td className="px-2 py-1">{line.side ?? line.Side ?? ''}</td>
                        <td className="px-2 py-1">{(line.date ?? line.Date) && new Date(line.date ?? line.Date).toLocaleDateString('en-GB')}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(line.netAmount ?? line.NetAmount ?? 0)}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(line.vatAmount ?? line.VatAmount ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
                      <td className="px-2 py-2" colSpan={3}>Total</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(totalCreditNotesNet)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(totalCreditNotesVat)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'validation' && (
            <div className="mt-4">
              {/* Reuse the existing validation banner + details for this tab as the main content */}
              {blocking.length > 0 || hasSys001 || issues.length > 0 ? (
                <div className="space-y-3">
                  {/* existing banners already rendered above; just show a short reminder here */}
                  <p className="text-sm text-gray-600">
                    Validation issues for this VAT period are shown above. Resolve all <span className="font-medium">Blocking</span> items before locking or submitting.
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-green-200 p-4 text-sm text-green-800">
                  <p className="font-medium">No validation issues for this period.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default VatReturnPage
