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
  CheckCircle,
  Activity,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import { formatCurrency } from '../../utils/currency'
import toast from 'react-hot-toast'
import { reportsAPI } from '../../services'

function trackVatEvent(eventType, data = {}) {
  reportsAPI.trackVatEvent({ eventType, page: 'VatReturn', ...data }).catch(() => {})
}
import { LoadingCard } from '../../components/Loading'

/** Format date as YYYY-MM-DD using local date (avoid toISOString() which shifts day in some timezones). */
function toLocalDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** FTA quarterly periods: Feb-Apr (Q1), May-Jul (Q2), Aug-Oct (Q3), Nov-Jan (Q4 cross-year). Q4-{year} = Nov (year-1) to Jan (year). */
function quarterToRangeFta(quarter, year) {
  const ranges = {
    1: { from: [year, 1, 1], to: [year, 3, 30] },       // Feb 1, Apr 30 (JS months 0-based)
    2: { from: [year, 4, 1], to: [year, 6, 31] },       // May 1, Jul 31
    3: { from: [year, 7, 1], to: [year, 9, 31] },       // Aug 1, Oct 31
    4: { from: [year - 1, 10, 1], to: [year, 0, 31] }   // Nov 1 (prev year), Jan 31
  }
  const r = ranges[quarter] || ranges[1]
  const from = new Date(r.from[0], r.from[1], r.from[2])
  const to = new Date(r.to[0], r.to[1], r.to[2])
  return { from: toLocalDateStr(from), to: toLocalDateStr(to) }
}

/** Get FTA quarter (1-4) and label year for current month. Jan -> Q4; Feb-Apr -> Q1; May-Jul -> Q2; Aug-Oct -> Q3; Nov-Dec -> Q4. */
function getFtaQuarterForMonth(month, year) {
  const m = month + 1 // 1-12
  if (m === 1) return { quarter: 4, year } // Jan = Q4 of same year (Nov prev - Jan)
  if (m >= 2 && m <= 4) return { quarter: 1, year }
  if (m >= 5 && m <= 7) return { quarter: 2, year }
  if (m >= 8 && m <= 10) return { quarter: 3, year }
  return { quarter: 4, year: year + 1 } // Nov, Dec = Q4 of next year (Nov-Dec this year, Jan next)
}

/** Mirrors backend: FTA quarters (Feb-Apr, May-Jul, Aug-Oct, Nov-Jan), standard quarters, or full calendar year. */
function isSupportedVatPeriod(fromStr, toStr) {
  if (!fromStr || !toStr || !/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) return false
  const from = new Date(fromStr)
  const to = new Date(toStr)
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return false
  const mFrom = from.getMonth() + 1
  const dFrom = from.getDate()
  const mTo = to.getMonth() + 1
  const dTo = to.getDate()
  const lastDayOfTo = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate()
  const yFrom = from.getFullYear()
  const yTo = to.getFullYear()
  // Full calendar year
  if (dFrom === 1 && mFrom === 1 && mTo === 12 && dTo === lastDayOfTo && yFrom === yTo) return true
  // FTA quarters: Feb-Apr, May-Jul, Aug-Oct, Nov-Jan (cross-year)
  if (dFrom === 1 && dTo === lastDayOfTo) {
    if (mFrom === 2 && mTo === 4 && yFrom === yTo) return true
    if (mFrom === 5 && mTo === 7 && yFrom === yTo) return true
    if (mFrom === 8 && mTo === 10 && yFrom === yTo) return true
    if (mFrom === 11 && mTo === 1 && yTo === yFrom + 1) return true
  }
  // Standard quarters: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec (same year)
  if (dFrom !== 1 || dTo !== lastDayOfTo || yFrom !== yTo) return false
  const monthsInclusive = (yTo - yFrom) * 12 + (mTo - mFrom) + 1
  if (monthsInclusive !== 3) return false
  return [1, 4, 7, 10].includes(mFrom)
}

/**
 * Snap invalid range to nearest supported FTA quarter or full year.
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

  // Cross-year: likely FTA Q4 (Nov-Jan)
  if (fromYear !== toYear) {
    if (toYear === fromYear + 1 && from.getMonth() === 10 && to.getMonth() === 0 && daysDiff >= 60 && daysDiff <= 95) {
      return { from: `${fromYear}-11-01`, to: `${toYear}-01-31` }
    }
    // Old logic: Dec-Mar snap to Q1 (Jan-Mar) - keep for backward compat
    if (toYear === fromYear + 1 && from.getMonth() === 11 && to.getMonth() <= 2 && daysDiff <= 93) {
      return quarterToRangeFta(1, toYear) // FTA Q1 = Feb-Apr
    }
    return null
  }

  const y = fromYear
  if (daysDiff >= 300) return { from: `${y}-01-01`, to: `${y}-12-31` }
  if (daysDiff > 93) return null
  // Same year: snap to FTA quarter containing the range end
  const toMonth = to.getMonth() + 1
  let q = 1
  if (toMonth >= 2 && toMonth <= 4) q = 1
  else if (toMonth >= 5 && toMonth <= 7) q = 2
  else if (toMonth >= 8 && toMonth <= 10) q = 3
  else if (toMonth === 11 || toMonth === 12 || toMonth === 1) q = 4
  return quarterToRangeFta(q, toMonth === 1 ? y : (toMonth >= 11 ? y + 1 : y))
}

const VatReturnPage = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const now = new Date()
  const { quarter: initQ, year: initY } = getFtaQuarterForMonth(now.getMonth(), now.getFullYear())
  const initRange = quarterToRangeFta(initQ, initY)
  const [fromDate, setFromDate] = useState(() => {
    const from = searchParams.get('from')
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) return from
    return initRange.from
  })
  const [toDate, setToDate] = useState(() => {
    const to = searchParams.get('to')
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) return to
    return initRange.to
  })
  const [quarter, setQuarter] = useState(initQ)
  const [year, setYear] = useState(initY)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null) // null | 'access' | { message: string }
  const [vatReturn, setVatReturn] = useState(null)
  const [ledgerFallback, setLedgerFallback] = useState(null) // { totalSalesNet, totalSalesVat } when VAT return has 0 sales but ledger has data
  const [validationExpanded, setValidationExpanded] = useState(false)
  const [trackingExpanded, setTrackingExpanded] = useState(false)

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
        const snapFrom = new Date(snap.from)
        const snapTo = new Date(snap.to)
        const mFrom = snapFrom.getMonth() + 1
        const mTo = snapTo.getMonth() + 1
        const snapQ = (mFrom === 2 && mTo === 4) ? 1 : (mFrom === 5 && mTo === 7) ? 2 : (mFrom === 8 && mTo === 10) ? 3 : (mFrom === 11 && mTo === 1) ? 4 : 1
        const snapY = snapQ === 4 ? snapTo.getFullYear() : snapFrom.getFullYear()
        setQuarter(snapQ)
        setYear(snapY)
        setSearchParams({ from: snap.from, to: snap.to })
        toast.success(`Adjusted to full quarter: ${snap.from} to ${snap.to}`)
      } else {
        setLoadError({
          message: 'VAT period must be a full quarter (Q1–Q4: Feb-Apr, May-Jul, Aug-Oct, Nov-Jan) or a full calendar year (01-Jan to 31-Dec).',
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
        if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
          const ins = Array.isArray(dto?.inputLines) ? dto.inputLines : (Array.isArray(dto?.InputLines) ? dto.InputLines : [])
          const outs = Array.isArray(dto?.outputLines) ? dto.outputLines : (Array.isArray(dto?.OutputLines) ? dto.OutputLines : [])
          console.debug('[VAT Return] Loaded', { period: `${fromFinal}–${toFinal}`, inputLines: ins.length, outputLines: outs.length, box1a: dto?.box1a ?? dto?.Box1a, box12: dto?.box12 ?? dto?.Box12 })
        }
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
        const snapFrom = new Date(snap.from)
        const snapTo = new Date(snap.to)
        const m = snapFrom.getMonth() + 1
        const snapQ = m === 2 ? 1 : m === 5 ? 2 : m === 8 ? 3 : m === 11 ? 4 : 1
        setQuarter(snapQ)
        setYear(snapQ === 4 ? snapTo.getFullYear() : snapFrom.getFullYear())
        setSearchParams({ from: snap.from, to: snap.to })
        fetchVatReturn(snap.from, snap.to)
      } else {
        const { quarter: q, year: y } = getFtaQuarterForMonth(now.getMonth(), now.getFullYear())
        const { from: f, to: t } = quarterToRangeFta(q, y)
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

  // Sync year dropdown when fromDate/toDate represent "This Year" (e.g. 2025-01-01 to 2025-12-31)
  useEffect(() => {
    if (!fromDate || !toDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return
    const y = parseInt(fromDate.slice(0, 4), 10)
    if (fromDate === `${y}-01-01` && toDate === `${y}-12-31`) {
      setYear(y)
    }
  }, [fromDate, toDate])

  // Refresh when sales, purchases, or expenses are updated from other pages
  useEffect(() => {
    const handler = () => { if (fromDate && toDate) fetchVatReturn(fromDate, toDate) }
    window.addEventListener('dataUpdated', handler)
    return () => window.removeEventListener('dataUpdated', handler)
  }, [fromDate, toDate, fetchVatReturn])

  const handlePeriodPreset = (preset) => {
    if (preset.startsWith('Q')) {
      const q = parseInt(preset.slice(1), 10)
      const { from, to } = quarterToRangeFta(q, year)
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
  const box2 = v != null ? Number(v.box2 ?? v.Box2 ?? 0) : 0
  const box3 = v != null ? Number(v.box3 ?? v.Box3 ?? 0) : 0
  const box9b = v != null ? Number(v.box9b ?? v.Box9b ?? 0) : 0
  const box12 = v != null ? Number(v.box12 ?? v.Box12 ?? 0) : 0
  const box13a = v != null ? Number(v.box13a ?? v.Box13a ?? 0) : 0
  const box13b = v != null ? Number(v.box13b ?? v.Box13b ?? 0) : 0
  // Defensive: API may return camelCase or PascalCase; ensure arrays so Overview/tabs always show data
  const rawOutputLines = Array.isArray(v?.outputLines) ? v.outputLines : (Array.isArray(v?.OutputLines) ? v.OutputLines : [])
  const rawInputLines = Array.isArray(v?.inputLines) ? v.inputLines : (Array.isArray(v?.InputLines) ? v.InputLines : [])
  const rawCreditNoteLines = Array.isArray(v?.creditNoteLines) ? v.creditNoteLines : (Array.isArray(v?.CreditNoteLines) ? v.CreditNoteLines : [])

  // Fallback: some older deployments only populate box totals (Box1/Box12) but not detail arrays.
  // In that case, synthesize one summary line per side so tabs never look "all zero" when Overview has values.
  const outputLines = rawOutputLines.length > 0 || (box1a === 0 && box1b === 0 && box2 === 0 && box3 === 0)
    ? rawOutputLines
    : [{
        type: 'Sale',
        reference: 'Summary',
        date: v?.periodEnd || (fromDate ? new Date(fromDate) : new Date()),
        netAmount: box1a + box2 + box3,
        vatAmount: box1b,
        vatScenario: 'Summary',
        customerName: ''
      }]

  const inputLines = rawInputLines.length > 0 || box12 === 0
    ? rawInputLines
    : [{
        type: 'Expense',
        reference: 'Summary',
        date: v?.periodEnd || (fromDate ? new Date(fromDate) : new Date()),
        netAmount: 0,
        vatAmount: box12,
        claimableVat: box12,
        taxType: 'Summary',
        supplierName: '',
        categoryName: '',
        isEntertainment: false,
        isTaxClaimable: true
      }]

  const creditNoteLines = rawCreditNoteLines
  const purchaseCountInPeriod = v != null ? (v.purchaseCountInPeriod ?? v.PurchaseCountInPeriod ?? 0) : 0
  const expenseCountInPeriod = v != null ? (v.expenseCountInPeriod ?? v.ExpenseCountInPeriod ?? 0) : 0
  useEffect(() => {
    if (v && box12 === 0 && (purchaseCountInPeriod > 0 || expenseCountInPeriod > 0)) {
      trackVatEvent('ZeroWarning', { periodFrom: fromDate, periodTo: toDate, hasZeros: true, box12: 0, purchaseCount: purchaseCountInPeriod, expenseCount: expenseCountInPeriod })
      setTrackingExpanded(true)
    }
  }, [v?.periodStart, box12, purchaseCountInPeriod, expenseCountInPeriod, fromDate, toDate])
  const purchasesExcludedReasons = v?.purchasesExcludedReasons ?? v?.PurchasesExcludedReasons ?? null
  const expensesExcludedReasons = v?.expensesExcludedReasons ?? v?.ExpensesExcludedReasons ?? null
  const totalInputNet = inputLines.reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  // Totals per tab (same filters as tables; coerce to number to avoid wrong/zero from strings)
  const salesLinesForTotal = outputLines.filter(line => ((line.vatScenario ?? line.VatScenario) || '').toLowerCase() !== 'exempt')
  const totalSalesNet = salesLinesForTotal.reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  const totalSalesVat = salesLinesForTotal.reduce((s, l) => s + (Number(l.vatAmount ?? l.VatAmount) || 0), 0)
  const purchaseLines = inputLines.filter(l => ((l.type ?? l.Type) ?? '').toString().toLowerCase() === 'purchase')
  const totalPurchasesNet = purchaseLines.reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  const totalPurchasesVat = purchaseLines.reduce((s, l) => s + (Number(l.claimableVat ?? l.ClaimableVat) || 0), 0)
  const expenseLines = inputLines.filter(l => ((l.type ?? l.Type) ?? '').toString().toLowerCase() === 'expense')
  const totalExpensesNet = expenseLines.reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  const totalExpensesVat = expenseLines.reduce((s, l) => s + (Number(l.claimableVat ?? l.ClaimableVat) || 0), 0)
  const totalCreditNotesNet = creditNoteLines.reduce((s, l) => s + (Number(l.netAmount ?? l.NetAmount) || 0), 0)
  const totalCreditNotesVat = creditNoteLines.reduce((s, l) => s + (Number(l.vatAmount ?? l.VatAmount) || 0), 0)
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
    const yFrom = parseInt(fromDate.slice(0, 4), 10)
    const mFrom = parseInt(fromDate.slice(5, 7), 10)
    const dFrom = parseInt(fromDate.slice(8, 10), 10)
    const mTo = parseInt(toDate.slice(5, 7), 10)
    const dTo = parseInt(toDate.slice(8, 10), 10)
    const yTo = parseInt(toDate.slice(0, 4), 10)
    const lastDay = new Date(yTo, mTo, 0).getDate()
    if (dFrom === 1 && dTo === lastDay) {
      if (mFrom === 2 && mTo === 4) return `Q1-${yFrom}`
      if (mFrom === 5 && mTo === 7) return `Q2-${yFrom}`
      if (mFrom === 8 && mTo === 10) return `Q3-${yFrom}`
      if (mFrom === 11 && mTo === 1) return `Q4-${yTo}`
    }
    if (mFrom === 1 && dFrom === 1 && mTo === 12 && dTo === 31) return `${yFrom}`
    return null
  })()
  const periodLabel = derivedPeriodLabel || v?.periodLabel || (fromDate && toDate ? `${fromDate} to ${toDate}` : `Q${quarter} ${year}`)
  const daysUntilDue = v?.dueDate ? Math.ceil((new Date(v.dueDate) - new Date()) / 86400000) : null

  // Which preset (if any) matches current from/to — for button highlight
  const activePreset = (() => {
    if (!fromDate || !toDate || !isSupportedVatPeriod(fromDate, toDate)) return null
    const yFrom = parseInt(fromDate.slice(0, 4), 10)
    const yTo = parseInt(toDate.slice(0, 4), 10)
    if (fromDate === `${yFrom}-01-01` && toDate === `${yFrom}-12-31`) return 'thisYear'
    for (let q = 1; q <= 4; q++) {
      const y = q === 4 ? yTo : yFrom
      const { from, to } = quarterToRangeFta(q, y)
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
          Use Q1–Q4 (Feb-Apr, May-Jul, Aug-Oct, Nov-Jan) or <strong>This Year</strong> for FTA returns. If all values show 0.00, try the suggested period above or the quarter when you had sales/purchases. Custom range must be a full quarter or full year (e.g. 2025-11-01 to 2026-01-31 for Q4).
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
              onClick={() => {
                setTrackingExpanded(prev => !prev)
                trackVatEvent('TrackingPanel', { action: trackingExpanded ? 'collapse' : 'expand', periodFrom: fromDate, periodTo: toDate })
              }}
              className={`inline-flex items-center gap-1 px-3 py-2 border rounded-md text-sm ${trackingExpanded ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-300 hover:bg-gray-50'}`}
            >
              <Activity className="h-4 w-4" /> VAT Tracking
              {trackingExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!fromDate || !toDate) { toast.error('Set From/To dates then recalculate'); return }
                trackVatEvent('Recalculate', { periodFrom: fromDate, periodTo: toDate })
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
                trackVatEvent('ExportCsv', { periodFrom: fromDate, periodTo: toDate })
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
              <span className="font-medium">Warnings:</span>
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                {issues.slice(0, 5).map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
                {issues.length > 5 && (
                  <li className="text-amber-600">…and {issues.length - 5} more</li>
                )}
              </ul>
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
              <p className="mt-1 text-blue-700">Showing: {fromDate} – {toDate}. If you have sales/expenses in another year, pick <strong>This Year</strong> for that year and click <strong>Refresh</strong>. FTA boxes show zeros until the period includes your invoice/purchase/expense dates.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await reportsAPI.getVatReturnSuggestPeriod()
                      const d = res?.data?.data ?? res?.data
                      if (d?.from && d?.to) {
                        setFromDate(d.from)
                        setToDate(d.to)
                        setSearchParams({ from: d.from, to: d.to })
                        if (d.label && /^Q\d-\d{4}$/.test(d.label)) {
                          const [, q, y] = d.label.match(/Q(\d)-(\d{4})/)
                          setQuarter(parseInt(q, 10))
                          setYear(parseInt(y, 10))
                        } else if (d.label && /^\d{4}$/.test(d.label)) {
                          setYear(parseInt(d.label, 10))
                        }
                        fetchVatReturn(d.from, d.to)
                        toast.success(`Loaded ${d.label || `${d.from} to ${d.to}`}`)
                      } else toast.error('Could not suggest period')
                    } catch (err) {
                      toast.error(err?.response?.data?.message || 'Failed to load period')
                    }
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                >
                  Load period where I have data
                </button>
                <button
                  type="button"
                  onClick={() => handlePeriodPreset('thisYear')}
                  className="px-3 py-1.5 border border-blue-600 text-blue-700 text-sm font-medium rounded-md hover:bg-blue-50"
                >
                  Load This Year ({year || new Date().getFullYear()})
                </button>
                {(year || new Date().getFullYear()) >= 2025 && (
                  <button
                    type="button"
                    onClick={() => {
                      const prevYear = (year || new Date().getFullYear()) - 1
                      const from = `${prevYear}-01-01`
                      const to = `${prevYear}-12-31`
                      setFromDate(from)
                      setToDate(to)
                      setYear(prevYear)
                      setSearchParams({ from, to })
                      fetchVatReturn(from, to)
                    }}
                    className="px-3 py-1.5 border border-blue-600 text-blue-700 text-sm font-medium rounded-md hover:bg-blue-50"
                  >
                    Try previous year ({(year || new Date().getFullYear()) - 1})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Hint when Total Sales is 0: suggest the year that contains the out-of-period invoice dates */}
          {v && displayBox1a === 0 && displayBox1b === 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-medium">Total Sales is 0.00 for this period ({fromDate} – {toDate}).</p>
              <p className="mt-1 text-amber-700">VAT only includes invoices whose <strong>invoice date</strong> falls in this range. If your dashboard shows sales for other dates, pick a period that includes those dates.</p>
              {issues.some(i => (i.message || '').toLowerCase().includes('outside')) && (() => {
                const dateMatch = issues.find(i => (i.message || '').match(/\d{4}-\d{2}-\d{2}/))
                const fullMatch = dateMatch?.message?.match(/(\d{4})-(\d{2})-(\d{2})/)
                const invYear = fullMatch ? parseInt(fullMatch[1], 10) : null
                const invMonth = fullMatch ? parseInt(fullMatch[2], 10) : null
                const y = (Number.isInteger(invYear) && invYear >= 2020 && invYear <= 2030) ? invYear : (year || new Date().getFullYear())
                // Infer FTA quarter from invoice month: Feb-Apr=Q1, May-Jul=Q2, Aug-Oct=Q3, Nov-Jan=Q4
                let ftaQ = null
                let ftaY = y
                if (Number.isInteger(invMonth) && invMonth >= 1 && invMonth <= 12) {
                  if (invMonth >= 2 && invMonth <= 4) { ftaQ = 1; ftaY = invYear }
                  else if (invMonth >= 5 && invMonth <= 7) { ftaQ = 2; ftaY = invYear }
                  else if (invMonth >= 8 && invMonth <= 10) { ftaQ = 3; ftaY = invYear }
                  else if (invMonth === 11 || invMonth === 12) { ftaQ = 4; ftaY = invYear + 1 }
                  else if (invMonth === 1) { ftaQ = 4; ftaY = invYear }
                }
                const ftaRange = ftaQ ? quarterToRangeFta(ftaQ, ftaY) : null
                return (
                  <>
                    <p className="mt-2 text-amber-700">To include those invoices, choose a period that contains their dates.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ftaRange && (
                        <button
                          type="button"
                          onClick={() => {
                            setFromDate(ftaRange.from)
                            setToDate(ftaRange.to)
                            setQuarter(ftaQ)
                            setYear(ftaY)
                            setSearchParams({ from: ftaRange.from, to: ftaRange.to })
                            fetchVatReturn(ftaRange.from, ftaRange.to)
                          }}
                          className="text-amber-800 font-semibold underline hover:no-underline"
                        >
                          Try: FTA Q{ftaQ} {ftaY} ({ftaRange.from} – {ftaRange.to})
                        </button>
                      )}
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
                        Or: This Year ({y})
                      </button>
                    </div>
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

          {/* VAT Tracking Panel – tab status, values, workflow */}
          {trackingExpanded && (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-primary-600" /> VAT Tracking & Workflow
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <div className={`p-2 rounded border ${displayBox1a > 0 || displayBox1b > 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  <p className="text-xs font-medium text-slate-600">Overview / Sales</p>
                  <p className="text-sm font-bold text-slate-800">{formatCurrency(displayBox1a)} / {formatCurrency(displayBox1b)}</p>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-xs ${displayBox1b > 0 ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}`}>
                    {displayBox1b > 0 ? 'OK' : 'Zero'}
                  </span>
                </div>
                <div className={`p-2 rounded border ${totalPurchasesVat > 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  <p className="text-xs font-medium text-slate-600">Purchases</p>
                  <p className="text-sm font-bold text-slate-800">{formatCurrency(totalPurchasesVat)}</p>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-xs ${totalPurchasesVat > 0 ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}`}>
                    {totalPurchasesVat > 0 ? 'OK' : purchaseCountInPeriod > 0 ? 'Action' : 'Zero'}
                  </span>
                </div>
                <div className={`p-2 rounded border ${totalExpensesVat > 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  <p className="text-xs font-medium text-slate-600">Expenses</p>
                  <p className="text-sm font-bold text-slate-800">{formatCurrency(totalExpensesVat)}</p>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-xs ${totalExpensesVat > 0 ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}`}>
                    {totalExpensesVat > 0 ? 'OK' : expenseCountInPeriod > 0 ? 'Action' : 'Zero'}
                  </span>
                </div>
                <div className={`p-2 rounded border ${displayBox12 > 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  <p className="text-xs font-medium text-slate-600">Box 12 (Input VAT)</p>
                  <p className="text-sm font-bold text-slate-800">{formatCurrency(displayBox12)}</p>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-xs ${displayBox12 > 0 ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}`}>
                    {displayBox12 > 0 ? 'OK' : 'Zero'}
                  </span>
                </div>
              </div>
              <div className="text-xs text-slate-600 mb-3">Workflow — fix zero values:</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { navigate('/purchases'); trackVatEvent('WorkflowClick', { step: 'purchases', target: '/purchases' }) }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm hover:bg-slate-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Purchases
                </button>
                <button
                  type="button"
                  onClick={() => { navigate('/expenses'); trackVatEvent('WorkflowClick', { step: 'expenses', target: '/expenses' }) }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 rounded text-sm hover:bg-slate-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Expenses
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!fromDate || !toDate) { toast.error('Set From/To dates first'); return }
                    trackVatEvent('WorkflowClick', { step: 'refresh', target: 'fetchVatReturn' })
                    await fetchVatReturn(fromDate, toDate)
                    toast.success('Refreshed')
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-100 border border-primary-300 rounded text-sm text-primary-800 hover:bg-primary-200"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
                <span className="text-xs text-slate-500 self-center ml-1">Mark ITC on Purchases/Expenses, then Refresh.</span>
              </div>
              {(purchasesExcludedReasons || expensesExcludedReasons) && (
                <p className="mt-2 text-xs text-amber-700">
                  {[purchasesExcludedReasons?.TaxClaimableNo && `${purchasesExcludedReasons.TaxClaimableNo} purchase(s) not tax claimable`, purchasesExcludedReasons?.VatZero && `${purchasesExcludedReasons.VatZero} with zero VAT`, expensesExcludedReasons?.TaxClaimableNo && `${expensesExcludedReasons.TaxClaimableNo} expense(s) not tax claimable`].filter(Boolean).join('; ')}
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

          {/* VAT Return Summary – always rendered for print from any tab; visible in flow when Overview active */}
          <div
            className={`vat-return-print-area bg-white rounded-lg border border-gray-200 overflow-hidden ${activeTab !== 'overview' ? 'fixed -left-[9999px] w-[210mm] overflow-hidden opacity-0 pointer-events-none' : 'mt-4'}`}
            aria-hidden={activeTab !== 'overview'}
          >
            <div className="p-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">VAT Return Summary</h2>
              <p className="text-xs text-gray-500 mb-4">Period: {periodLabel} ({fromDate} – {toDate})</p>
              {!outputLines.length && !inputLines.length && !creditNoteLines.length && (
                <p className="text-gray-600 py-4 rounded-lg bg-gray-50 border border-gray-200 px-4 mb-4">No data for this period.</p>
              )}
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
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(totalInputNet || totalPurchasesNet + totalExpensesNet)}</td>
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
              {(v?.petroleumExcluded ?? 0) > 0 && (
                <p className="mt-3 text-xs text-amber-700">Petroleum excluded: {formatCurrency(v.petroleumExcluded)}</p>
              )}
            </div>
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
                  {v?.dueDate ? new Date(v.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                </p>
                {daysUntilDue != null && daysUntilDue <= 0 && <p className="text-xs font-medium text-red-600">Overdue</p>}
                {daysUntilDue != null && daysUntilDue > 0 && <p className="text-xs text-gray-500">{daysUntilDue} days left</p>}
              </div>
            </div>
          </div>

          {/* Transactions-related tabs – simple tables, no dashboards */}
          {activeTab === 'transactions' && (
            <div className="mt-4 bg-white rounded-lg border border-gray-200 p-4 space-y-4">
              <h2 className="text-sm font-semibold text-gray-900">All VAT Transactions</h2>
              <p className="text-xs text-gray-500 mb-2">Combined view of sales outputs and purchase/expense inputs used in this VAT period.</p>
              {!outputLines.length && !inputLines.length && (
                <p className="text-gray-600 py-4 rounded-lg bg-gray-50 border border-gray-200 px-4">No data for this period.</p>
              )}
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
              {salesLinesForTotal.length === 0 && (
                <p className="mt-2 text-gray-600 py-4 rounded-lg bg-gray-50 border border-gray-200 px-4">No data for this period.</p>
              )}
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
                <>
                  <p className="mt-2 text-gray-600 py-4 rounded-lg bg-gray-50 border border-gray-200 px-4">No data for this period.</p>
                  <p className="mt-2 text-xs text-gray-600">Only purchases in this period with <strong>Tax claimable</strong> and VAT &gt; 0 appear. Check that purchase dates fall in {fromDate} – {toDate} and that items are marked tax claimable on the Purchases page.</p>
                  {purchaseCountInPeriod > 0 && purchasesExcludedReasons && Object.keys(purchasesExcludedReasons).length > 0 && (
                    <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      {purchaseCountInPeriod} purchase(s) in this period: {[
                        purchasesExcludedReasons.TaxClaimableNo > 0 && `${purchasesExcludedReasons.TaxClaimableNo} not marked Tax claimable`,
                        purchasesExcludedReasons.VatZero > 0 && `${purchasesExcludedReasons.VatZero} with zero VAT`
                      ].filter(Boolean).join('; ')}. Edit on the <strong>Purchases</strong> page (set ITC = Yes).
                    </p>
                  )}
                </>
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
                <>
                  <p className="mt-2 text-gray-600 py-4 rounded-lg bg-gray-50 border border-gray-200 px-4">No data for this period.</p>
                  <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    No claimable expenses in this period. On the <strong>Expenses</strong> page, mark expenses as <strong>Tax claimable (ITC)</strong> and ensure they have VAT. Then click <strong>Refresh</strong> or <strong>Recalculate</strong> here to update.
                  </p>
                  {expenseCountInPeriod > 0 && expensesExcludedReasons && Object.keys(expensesExcludedReasons).length > 0 && (
                    <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      {expenseCountInPeriod} expense(s) in this period: {[
                        expensesExcludedReasons.TaxClaimableNo > 0 && `${expensesExcludedReasons.TaxClaimableNo} not marked Tax claimable`,
                        expensesExcludedReasons.ClaimableZero > 0 && `${expensesExcludedReasons.ClaimableZero} with no claimable VAT`,
                        expensesExcludedReasons.Petroleum > 0 && `${expensesExcludedReasons.Petroleum} petroleum (excluded)`
                      ].filter(Boolean).join('; ')}. Edit on the <strong>Expenses</strong> page.
                    </p>
                  )}
                </>
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
              {creditNoteLines.length === 0 && (
                <p className="mt-2 text-gray-600 py-4 rounded-lg bg-gray-50 border border-gray-200 px-4">No data for this period.</p>
              )}
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
