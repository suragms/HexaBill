import { useState, useEffect, useRef } from 'react'
import { Printer, X, Loader2 } from 'lucide-react'
import Modal from './Modal'
import { paymentsAPI } from '../services'
import { formatCurrency } from '../utils/currency'

/** Format date as dd-mm-yyyy for receipt and print. */
function toReceiptDate (d) {
  if (!d) return ''
  const date = new Date(d)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}-${month}-${year}`
}

/**
 * Payment receipt preview modal (proof of payment, not tax invoice).
 * - Single payment: one receipt with one invoice line.
 * - Multiple payments (multi-bill): one combined receipt with total received and a table of invoices/bills and amount applied to each.
 * Print is optional – only when the customer requests a copy.
 * Calls POST /payments/{id}/receipt or POST /payments/receipt/batch.
 */
export default function ReceiptPreviewModal ({ paymentIds = [], isOpen, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null) // { detail, receiptNumber, receiptId } or { detail, receipts }
  const printRef = useRef(null)

  useEffect(() => {
    if (!isOpen) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    if (!paymentIds?.length) {
      setData(null)
      setError('No payments selected. Please select at least one payment to generate a receipt.')
      setLoading(false)
      return
    }
    let cancelled = false
    setError(null)
    setLoading(true)
    const fetchReceipt = async () => {
      try {
        const res = paymentIds.length === 1
          ? await paymentsAPI.generateReceipt(paymentIds[0])
          : await paymentsAPI.generateReceiptBatch(paymentIds)
        if (cancelled) return
        const payload = res?.data
        const detail = payload?.detail ?? (payload?.receiptNumber ? payload : null)
        if (res?.success && detail) {
          setData({ ...payload, detail })
          onSuccess?.()
        } else {
          setError(res?.message || 'Receipt could not be loaded. Please try again or contact support.')
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err?.response?.data?.message || err?.message
          setError(msg || 'Receipt could not be loaded. Please try again or contact support.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchReceipt()
    return () => { cancelled = true }
  }, [isOpen, paymentIds, onSuccess])

  const handlePrint = () => {
    if (!printRef.current) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <!DOCTYPE html><html><head><title>Payment Receipt</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; padding: 20px; max-width: 520px; margin: 0 auto; font-size: 14px; color: #111; }
        .receipt-preview { padding: 16px; }
        .receipt-preview h1 { font-size: 20px; margin: 0 0 12px; font-weight: 700; }
        .receipt-separator { border-top: 1px solid #333 !important; }
        .receipt-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .receipt-table th, .receipt-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd; }
        .receipt-table th { font-weight: 600; }
        .receipt-table td:last-child, .receipt-table th:last-child,
        .receipt-table td:nth-child(3), .receipt-table th:nth-child(3) { text-align: right; }
        @media print { body { padding: 0; } .receipt-preview { border: none; box-shadow: none; } }
      </style></head><body>
      <div class="receipt-preview">
      ${printRef.current.innerHTML}
      </div>
      </body></html>
    `)
    win.document.close()
    win.focus()
    setTimeout(() => {
      win.print()
      win.close()
    }, 300)
  }

  const detail = data?.detail

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setData(null)
        setError(null)
        onClose()
      }}
      title="Payment Receipt / إيصال دفع"
    >
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
          {error}
        </div>
      )}
      {!loading && !error && data?.detail && (
        <>
          <div ref={printRef} className="receipt-preview rounded-lg border border-gray-200 bg-white p-6 text-left receipt-print-styles">
            <h1 className="text-xl font-bold text-gray-900 mb-2">PAYMENT RECEIPT</h1>
            <p className="text-sm text-gray-700">Receipt No: {detail.receiptNumber}</p>
            <p className="text-sm text-gray-700">Date: {toReceiptDate(detail.receiptDate)}</p>
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-700">Received From:</p>
              <p className="text-gray-900 font-medium">{detail.receivedFrom}</p>
            </div>
            <p className="text-sm text-gray-700 mt-2">Payment Method: {detail.paymentMethod}</p>
            {detail.reference && <p className="text-sm text-gray-500 mt-0.5">Reference: {detail.reference}</p>}
            <div className="receipt-separator mt-4 mb-4 border-t border-gray-300" aria-hidden="true" />
            {detail.invoices?.length > 0 && (
              <>
                <table className="receipt-table w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-400">
                      <th className="py-2 text-left font-semibold text-gray-800">Invoice</th>
                      <th className="py-2 text-left font-semibold text-gray-800">Date</th>
                      <th className="py-2 text-right font-semibold text-gray-800">Invoice Total</th>
                      <th className="py-2 text-right font-semibold text-gray-800">Paid Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.invoices.map((inv, i) => (
                      <tr key={i} className="border-b border-gray-200">
                        <td className="py-2">{inv.invoiceNo}</td>
                        <td className="py-2">{toReceiptDate(inv.invoiceDate)}</td>
                        <td className="py-2 text-right">{formatCurrency(inv.invoiceTotal)}</td>
                        <td className="py-2 text-right">{formatCurrency(inv.amountApplied)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="receipt-separator mt-4 mb-4 border-t border-gray-300" aria-hidden="true" />
              </>
            )}
            <p className="text-base font-bold text-gray-900">
              Total Paid: {formatCurrency(detail.amountReceived, 'AED')}
            </p>
            {detail.amountInWords && (
              <p className="text-xs text-gray-500 mt-1 italic">{detail.amountInWords}</p>
            )}
            <div className="mt-6 pt-4 border-t border-gray-200 text-xs text-gray-500">
              {detail.companyName && <p>{detail.companyName}</p>}
              {detail.companyAddress && <p>{detail.companyAddress}</p>}
              {detail.companyTrn && <p>TRN: {detail.companyTrn}</p>}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              title="Print when customer requests"
            >
              <Printer className="h-4 w-4" />
              Print receipt
            </button>
            <span className="text-xs text-gray-500 self-center">Optional — print when customer asks</span>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
