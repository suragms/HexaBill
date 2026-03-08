import { useState } from 'react'
import { X, Printer, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { salesAPI } from '../services'

const PrintOptionsModal = ({ saleId, invoiceNo, onClose, onPrint }) => {
  const [format, setFormat] = useState('A4')
  const [copies, setCopies] = useState(1)
  const [printer, setPrinter] = useState('default')
  const [orientation, setOrientation] = useState('portrait')

  const handlePrint = async () => {
    try {
      // Fetch PDF via authenticated api (required after removing AllowAnonymous from backend)
      const pdfOptions = format === 'A4' ? {} : { format: 'thermal', width: format === 'thermal58' ? 58 : 80 }
      const blob = await salesAPI.getInvoicePdf(saleId, pdfOptions)
      const blobUrl = URL.createObjectURL(blob)
      const printWindow = window.open(blobUrl, '_blank')
      if (printWindow) {
        printWindow.onload = () => {
          setTimeout(() => {
            if (format === 'A4') printWindow.print()
            URL.revokeObjectURL(blobUrl)
          }, 250)
        }
        toast.success(format === 'A4' ? 'Invoice opened for printing' : 'Thermal format opened')
      } else {
        URL.revokeObjectURL(blobUrl)
        toast.error('Please allow pop-ups for this site to print')
      }

      if (onPrint) onPrint()
      onClose()
    } catch (error) {
      console.error('Print error:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to open print dialog')
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
          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setFormat('A4')}
                className={`p-4 border-2 rounded-lg text-center transition-colors ${
                  format === 'A4'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileText className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                <span className="font-medium">A4</span>
              </button>
              <button
                onClick={() => setFormat('thermal58')}
                className={`p-4 border-2 rounded-lg text-center transition-colors ${
                  format === 'thermal58'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Printer className="h-8 w-8 mx-auto mb-2 text-green-600" />
                <span className="font-medium">Thermal 58mm</span>
              </button>
            </div>
          </div>

          {/* Copies */}
          {format === 'A4' && (
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
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handlePrint}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </button>
        </div>
      </div>
    </div>
  )
}

export default PrintOptionsModal

