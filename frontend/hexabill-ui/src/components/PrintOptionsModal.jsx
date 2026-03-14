import { useState, useRef } from 'react'
import { X, Printer, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { salesAPI } from '../services'

const PrintOptionsModal = ({ saleId, invoiceNo, onClose, onPrint }) => {
  const [format, setFormat] = useState('A4')
  const [copies, setCopies] = useState(1)
  const [printer, setPrinter] = useState('default')
  const [orientation, setOrientation] = useState('portrait')
  const [printing, setPrinting] = useState(false)
  const printHandledRef = useRef(false)

  const handlePrint = async () => {
    if (!saleId) {
      toast.error('Invalid invoice. Cannot print.')
      return
    }
    printHandledRef.current = false
    setPrinting(true)
    try {
      const pdfOptions = { format }
      const blob = await salesAPI.getInvoicePdf(saleId, pdfOptions)
      if (!blob || (blob instanceof Blob && blob.size === 0)) {
        toast.error('PDF could not be generated')
        setPrinting(false)
        return
      }
      const blobUrl = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob], { type: 'application/pdf' }))
      const printWindow = window.open(blobUrl, '_blank', 'noopener,noreferrer')
      if (printWindow) {
        printWindow.onload = () => {
          if (printHandledRef.current) return
          printHandledRef.current = true
          try {
            printWindow.print()
            toast.success('Print dialog opened')
          } catch (e) {
            console.error('Print error:', e)
            toast.error('Could not open print dialog')
          }
          setPrinting(false)
          if (onPrint) onPrint()
          onClose()
          setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
        }
        setTimeout(() => {
          if (printHandledRef.current) return
          printHandledRef.current = true
          setPrinting(false)
          toast.success('PDF opened in new tab. Use Ctrl+P to print if needed.')
          if (onPrint) onPrint()
          onClose()
          setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
        }, 2500)
      } else {
        URL.revokeObjectURL(blobUrl)
        setPrinting(false)
        toast.error('Pop-up blocked. Allow pop-ups for this site, or use Download PDF from the previous screen.')
      }
    } catch (error) {
      console.error('Print error:', error)
      setPrinting(false)
      if (!error?._handledByInterceptor) toast.error(error?.message || 'Failed to generate PDF')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Print Options</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Format Selection - A4, A5, 80mm, 58mm (Gulf VAT compliant) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Print format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormat('A4')}
                className={`p-4 border-2 rounded-lg text-center transition-colors ${
                  format === 'A4'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileText className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                <span className="font-medium">A4 Invoice</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('A5')}
                className={`p-4 border-2 rounded-lg text-center transition-colors ${
                  format === 'A5'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileText className="h-8 w-8 mx-auto mb-2 text-blue-500" />
                <span className="font-medium">A5 Invoice</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('80mm')}
                className={`p-4 border-2 rounded-lg text-center transition-colors ${
                  format === '80mm'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Printer className="h-8 w-8 mx-auto mb-2 text-green-600" />
                <span className="font-medium">80mm Receipt</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('58mm')}
                className={`p-4 border-2 rounded-lg text-center transition-colors ${
                  format === '58mm'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Printer className="h-8 w-8 mx-auto mb-2 text-green-500" />
                <span className="font-medium">58mm Receipt</span>
              </button>
            </div>
          </div>

          {/* Copies - A4/A5 only */}
          {(format === 'A4' || format === 'A5') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Copies
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                className="w-full px-4 py-2 border border-gray-300 rounded-md"
              />
            </div>
          )}

          {/* Printer Selection (for future use) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Printer
            </label>
            <select
              value={printer}
              onChange={(e) => setPrinter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md"
            >
              <option value="default">Default Printer</option>
              <option value="browser">Browser Print Dialog</option>
            </select>
          </div>

          {/* Invoice Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">Invoice:</p>
            <p className="font-medium text-gray-900">{invoiceNo || `#${saleId}`}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end p-6 border-t border-gray-200 space-x-3">
          <button
            onClick={onClose}
            disabled={printing}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handlePrint}
            disabled={printing}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {printing ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Generating…
              </>
            ) : (
              <>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PrintOptionsModal

