import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Eye, RefreshCw, Phone, Plus, Pencil, Trash2 } from 'lucide-react'
import { suppliersAPI } from '../../services'
import { formatCurrency } from '../../utils/currency'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'

const SuppliersPage = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [suppliers, setSuppliers] = useState([])
  const [filteredSuppliers, setFilteredSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    creditLimit: '',
    paymentTerms: ''
  })
  const [creating, setCreating] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '', address: '', creditLimit: '', paymentTerms: '', isActive: true })
  const [editFormIsDeactivated, setEditFormIsDeactivated] = useState(false)
  const [editFormLoadFailed, setEditFormLoadFailed] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadSuppliers()
  }, [])

  const editFromUrl = searchParams.get('edit')
  useEffect(() => {
    if (!editFromUrl || loading || suppliers.length === 0) return
    const s = suppliers.find(sup => (sup.supplierName || '').toLowerCase() === editFromUrl.toLowerCase())
    if (s) {
      openEditModal(s)
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('edit'); return p }, { replace: true })
    }
  }, [editFromUrl, loading, suppliers])

  useEffect(() => {
    let list = suppliers
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      list = list.filter(s => (s.supplierName || '').toLowerCase().includes(term) || (s.phone || '').includes(term))
    }
    if (overdueOnly) {
      list = list.filter(s => (s.overdue || 0) > 0)
    }
    setFilteredSuppliers(list)
  }, [suppliers, searchTerm, overdueOnly])

  const loadSuppliers = async () => {
    try {
      setLoading(true)
      const response = await suppliersAPI.getAllSuppliersSummary()
      if (response?.success && response?.data) {
        setSuppliers(response.data)
      } else {
        setSuppliers([])
      }
    } catch (error) {
      console.error('Failed to load suppliers:', error)
      toast.error('Failed to load suppliers')
      setSuppliers([])
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '-'

  const openEditModal = async (s) => {
    setEditingSupplier(s)
    setShowEditModal(true)
    setEditFormIsDeactivated(false)
    setEditFormLoadFailed(false)
    try {
      const res = await suppliersAPI.getSupplier(s.supplierName)
      if (res?.success && res?.data) {
        const d = res.data
        setEditFormIsDeactivated(d.isActive === false)
        setEditForm({
          name: d.name || '',
          phone: d.phone || '',
          email: d.email || '',
          address: d.address || '',
          creditLimit: d.creditLimit != null ? String(d.creditLimit) : '',
          paymentTerms: d.paymentTerms || '',
          isActive: d.isActive !== false
        })
      } else {
        setEditFormLoadFailed(true)
        setEditForm({
          name: s.supplierName || '',
          phone: s.phone || '',
          email: '',
          address: '',
          creditLimit: s.creditLimit != null ? String(s.creditLimit) : '',
          paymentTerms: '',
          isActive: s.isActive !== false
        })
      }
    } catch (err) {
      console.error(err)
      setEditFormLoadFailed(true)
      if (err?.response?.status === 404) {
        toast.error('Supplier not in directory. Add from ledger or create to edit.')
      } else {
        toast.error('Could not load supplier details')
      }
      setEditForm({
        name: s.supplierName || '',
        phone: s.phone || '',
        email: '',
        address: '',
        creditLimit: s.creditLimit != null ? String(s.creditLimit) : '',
        paymentTerms: '',
        isActive: s.isActive !== false
      })
    }
  }

  const handleUpdateSupplier = async (e) => {
    e.preventDefault()
    if (!editingSupplier) return
    const name = (editForm.name || '').trim()
    if (!name) {
      toast.error('Supplier name is required')
      return
    }
    try {
      setUpdating(true)
      const res = await suppliersAPI.updateSupplier(editingSupplier.supplierName, {
        name,
        phone: editForm.phone?.trim() || undefined,
        email: editForm.email?.trim() || undefined,
        address: editForm.address?.trim() || undefined,
        creditLimit: editForm.creditLimit !== '' ? parseFloat(editForm.creditLimit) : undefined,
        paymentTerms: editForm.paymentTerms?.trim() || undefined,
        isActive: editForm.isActive
      })
      if (res?.success) {
        toast.success('Supplier updated successfully')
        setShowEditModal(false)
        setEditingSupplier(null)
        loadSuppliers()
      } else {
        toast.error(res?.message || 'Failed to update supplier')
      }
    } catch (err) {
      console.error(err)
      toast.error(err?.response?.data?.message || err?.message || 'Failed to update supplier')
    } finally {
      setUpdating(false)
    }
  }

  const handleDeleteSupplier = async () => {
    if (!deleteConfirm) return
    const { supplierName } = deleteConfirm
    try {
      setDeleting(true)
      await suppliersAPI.deleteSupplier(supplierName)
      toast.success('Supplier deactivated. Existing purchases remain.')
      setDeleteConfirm(null)
      loadSuppliers()
    } catch (err) {
      console.error(err)
      toast.error(err?.response?.data?.message || err?.message || 'Failed to delete supplier')
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateSupplier = async (e) => {
    e.preventDefault()
    const name = (createForm.name || '').trim()
    if (!name) {
      toast.error('Supplier name is required')
      return
    }
    try {
      setCreating(true)
      const res = await suppliersAPI.createSupplier({
        name,
        phone: createForm.phone?.trim() || undefined,
        email: createForm.email?.trim() || undefined,
        address: createForm.address?.trim() || undefined,
        creditLimit: createForm.creditLimit !== '' ? parseFloat(createForm.creditLimit) : undefined,
        paymentTerms: createForm.paymentTerms?.trim() || undefined
      })
      if (res?.success) {
        toast.success('Supplier created successfully')
        setShowCreateModal(false)
        setCreateForm({ name: '', phone: '', email: '', address: '', creditLimit: '', paymentTerms: '' })
        loadSuppliers()
      } else {
        toast.error(res?.message || 'Failed to create supplier')
      }
    } catch (err) {
      console.error(err)
      toast.error(err?.response?.data?.message || err?.message || 'Failed to create supplier')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="w-full p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-primary-900">Suppliers</h1>
        <p className="text-primary-600 mt-1 text-sm">Manage suppliers, create new ones, search the full list, and open Supplier Ledger for balances and payments.</p>
      </div>

      {/* Search bar + Add Supplier — always visible at top */}
      <div className="bg-white rounded-xl border-2 border-primary-200 shadow-sm mb-4 p-4 w-full">
        <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide mb-3">Search & create</p>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search suppliers by name or phone..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 border-2 border-lime-300 rounded-lg text-primary-900 placeholder:text-primary-400 focus:ring-2 focus:ring-primary-400 focus:border-primary-500"
              aria-label="Search suppliers"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="rounded" />
              <span className="text-sm text-primary-700">Overdue only</span>
            </label>
            <button onClick={loadSuppliers} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-primary-100 hover:bg-primary-200 rounded-lg font-medium shrink-0">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium shadow-sm shrink-0"
              aria-label="Add new supplier"
            >
              <Plus className="h-4 w-4" /> Add Supplier
            </button>
          </div>
        </div>
      </div>

      {/* Aggregate data cards above table (when there are suppliers) */}
      {!loading && filteredSuppliers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-lg border-2 border-primary-200 p-3 shadow-sm">
            <p className="text-xs font-semibold text-primary-600 uppercase tracking-wide">Total pending (all)</p>
            <p className="text-lg font-bold text-amber-700">
              {formatCurrency(filteredSuppliers.reduce((sum, s) => sum + (s.netPayable || 0), 0))}
            </p>
          </div>
          <div className="bg-white rounded-lg border-2 border-primary-200 p-3 shadow-sm">
            <p className="text-xs font-semibold text-primary-600 uppercase tracking-wide">Suppliers with balance</p>
            <p className="text-lg font-bold text-primary-800">
              {filteredSuppliers.filter(s => (s.netPayable || 0) > 0).length}
            </p>
          </div>
          <div className="bg-white rounded-lg border-2 border-primary-200 p-3 shadow-sm">
            <p className="text-xs font-semibold text-primary-600 uppercase tracking-wide">Total suppliers</p>
            <p className="text-lg font-bold text-primary-800">{filteredSuppliers.length}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border-2 border-lime-300 shadow-sm overflow-hidden w-full">
        <p className="text-xs text-primary-500 px-4 py-2 border-b border-lime-200 bg-lime-50/50">
          {!loading && filteredSuppliers.length > 0 ? `Showing ${filteredSuppliers.length} supplier${filteredSuppliers.length !== 1 ? 's' : ''}. Use search above to filter. Click &quot;Supplier Ledger&quot; to open full ledger.` : 'Supplier list — use search above to filter. Click &quot;Supplier Ledger&quot; to open full ledger.'}
        </p>
        {loading ? (
          <div className="p-8 text-center text-primary-500">Loading suppliers...</div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-primary-100">
                  <tr>
                    <th className="text-left p-3 font-medium text-primary-800">Supplier</th>
                    <th className="text-left p-3 font-medium text-primary-800">Phone</th>
                    <th className="text-right p-3 font-medium text-primary-800">Total Purchases</th>
                    <th className="text-right p-3 font-medium text-primary-800">Total Paid</th>
                    <th className="text-right p-3 font-medium text-primary-800">Outstanding</th>
                    <th className="text-right p-3 font-medium text-primary-800">Overdue</th>
                    <th className="text-center p-3 font-medium text-primary-800">Last Purchase</th>
                    <th className="text-center p-3 font-medium text-primary-800">Invoices</th>
                    <th className="text-center p-3 font-medium text-primary-800">Last Payment</th>
                    <th className="p-3 font-medium text-primary-800">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-8 text-center">
                        <div className="flex flex-col items-center gap-3 text-primary-600">
                          <p className="font-medium">{suppliers.length === 0 ? 'No suppliers yet' : 'No suppliers match your search or filter'}</p>
                          {suppliers.length === 0 ? (
                            <button type="button" onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700">
                              <Plus className="h-4 w-4" /> Add your first supplier
                            </button>
                          ) : (
                            <button type="button" onClick={() => { setSearchTerm(''); setOverdueOnly(false) }} className="text-sm text-primary-600 underline hover:text-primary-800">Clear search and filters</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredSuppliers.map((s, i) => (
                      <tr key={i} className="border-t border-primary-100 hover:bg-primary-50">
                        <td className="p-3 font-medium text-primary-900">
                          <span className="inline-flex items-center gap-2">{s.supplierName}
                            {s.isActive === false && <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-300">Deactivated</span>}
                          </span>
                        </td>
                        <td className="p-3 text-primary-600">{s.phone || '-'}</td>
                        <td className="p-3 text-right">{formatCurrency(s.totalPurchases || 0)}</td>
                        <td className="p-3 text-right text-green-700">{formatCurrency(s.totalPaid || 0)}</td>
                        <td className="p-3 text-right font-medium text-amber-700">{formatCurrency(s.netPayable || 0)}</td>
                        <td className="p-3 text-right">{formatCurrency(s.overdue || 0)}</td>
                        <td className="p-3 text-center text-sm">{formatDate(s.lastPurchaseDate)}</td>
                        <td className="p-3 text-center">{s.invoiceCount ?? '-'}</td>
                        <td className="p-3 text-center text-sm">{formatDate(s.lastPaymentDate)}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => navigate(`/suppliers/${encodeURIComponent(s.supplierName)}`)} className="flex items-center gap-1 px-2 py-1 bg-primary-100 hover:bg-primary-200 rounded text-sm font-medium">
                              <Eye className="h-4 w-4" /> Supplier Ledger
                            </button>
                            {s.id != null && (
                              <>
                                <button onClick={() => openEditModal(s)} className="flex items-center gap-1 px-2 py-1 bg-amber-100 hover:bg-amber-200 rounded text-sm font-medium" title="Edit supplier">
                                  <Pencil className="h-4 w-4" /> Edit
                                </button>
                                <button onClick={() => setDeleteConfirm(s)} className="flex items-center gap-1 px-2 py-1 bg-red-100 hover:bg-red-200 rounded text-sm font-medium text-red-800" title="Deactivate supplier">
                                  <Trash2 className="h-4 w-4" /> Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3 p-4">
              {filteredSuppliers.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-primary-600 font-medium mb-3">{suppliers.length === 0 ? 'No suppliers yet' : 'No suppliers match your search or filter'}</p>
                  {suppliers.length === 0 ? (
                    <button type="button" onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium">
                      <Plus className="h-4 w-4" /> Add your first supplier
                    </button>
                  ) : (
                    <button type="button" onClick={() => { setSearchTerm(''); setOverdueOnly(false) }} className="text-sm text-primary-600 underline">Clear search and filters</button>
                  )}
                </div>
              ) : (
                filteredSuppliers.map((s, i) => (
                  <div key={i} className="bg-primary-50 rounded-lg border border-primary-200 p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <span className="font-medium text-primary-900 inline-flex items-center gap-2">{s.supplierName}
                          {s.isActive === false && <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-300">Deactivated</span>}
                        </span>
                        {s.phone && <p className="text-sm text-primary-600 flex items-center gap-1"><Phone className="h-3 w-3" /> {s.phone}</p>}
                      </div>
                      <p className="font-bold text-amber-700">{formatCurrency(s.netPayable || 0)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm text-primary-600 mb-3">
                      <p>Purchases: {formatCurrency(s.totalPurchases || 0)}</p>
                      <p>Paid: {formatCurrency(s.totalPaid || 0)}</p>
                      <p>Last Purchase: {formatDate(s.lastPurchaseDate)}</p>
                      <p>Invoices: {s.invoiceCount ?? '-'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => navigate(`/suppliers/${encodeURIComponent(s.supplierName)}`)} className="flex-1 flex items-center justify-center gap-1 py-2 bg-primary-200 hover:bg-primary-300 rounded text-sm font-medium">
                        <Eye className="h-4 w-4" /> Ledger
                      </button>
                      {s.id != null && (
                        <>
                          <button onClick={() => openEditModal(s)} className="p-2 bg-amber-100 hover:bg-amber-200 rounded" title="Edit"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => setDeleteConfirm(s)} className="p-2 bg-red-100 hover:bg-red-200 rounded text-red-800" title="Deactivate"><Trash2 className="h-4 w-4" /></button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        isOpen={showCreateModal}
        onClose={() => !creating && setShowCreateModal(false)}
        title="Add Supplier"
        size="md"
      >
        <form onSubmit={handleCreateSupplier} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-primary-800 mb-1">Name <span className="text-red-600">*</span></label>
            <input
              type="text"
              value={createForm.name}
              onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Supplier name"
              className="w-full border-2 border-lime-300 rounded px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-800 mb-1">Phone</label>
            <input
              type="text"
              value={createForm.phone}
              onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="Phone"
              className="w-full border-2 border-lime-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-800 mb-1">Email</label>
            <input
              type="email"
              value={createForm.email}
              onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
              placeholder="Email"
              className="w-full border-2 border-lime-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-800 mb-1">Address</label>
            <textarea
              value={createForm.address}
              onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Address"
              rows={2}
              className="w-full border-2 border-lime-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-800 mb-1">Credit limit</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={createForm.creditLimit}
              onChange={e => setCreateForm(f => ({ ...f, creditLimit: e.target.value }))}
              placeholder="0"
              className="w-full border-2 border-lime-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-primary-800 mb-1">Payment terms</label>
            <input
              type="text"
              value={createForm.paymentTerms}
              onChange={e => setCreateForm(f => ({ ...f, paymentTerms: e.target.value }))}
              placeholder="e.g. Net 30"
              className="w-full border-2 border-lime-300 rounded px-3 py-2"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => !creating && setShowCreateModal(false)}
              className="px-4 py-2 border-2 border-primary-300 rounded font-medium text-primary-700 hover:bg-primary-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !createForm.name?.trim()}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded font-medium disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Supplier'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Supplier modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => !updating && (setShowEditModal(false), setEditingSupplier(null), setEditFormIsDeactivated(false), setEditFormLoadFailed(false))}
        title={
          <span className="flex items-center gap-2">
            Edit Supplier
            {editFormIsDeactivated && (
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800 border border-amber-300">Deactivated</span>
            )}
            {editFormLoadFailed && (
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-red-100 text-red-800 border border-red-300">View only</span>
            )}
          </span>
        }
        size="md"
      >
        {editingSupplier && (
          <form onSubmit={handleUpdateSupplier} className="space-y-4">
            {editFormLoadFailed && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Supplier could not be loaded. You can view details below but cannot save changes. Use Supplier Ledger to view transactions.
              </p>
            )}
            <div>
              <label className="block text-sm font-medium text-primary-800 mb-1">Name <span className="text-red-600">*</span></label>
              <input
                type="text"
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Supplier name"
                className="w-full border-2 border-lime-300 rounded px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-primary-800 mb-1">Phone</label>
              <input
                type="text"
                value={editForm.phone}
                onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="Phone"
                className="w-full border-2 border-lime-300 rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-primary-800 mb-1">Email</label>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Email"
                className="w-full border-2 border-lime-300 rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-primary-800 mb-1">Address</label>
              <textarea
                value={editForm.address}
                onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                placeholder="Address"
                rows={2}
                className="w-full border-2 border-lime-300 rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-primary-800 mb-1">Credit limit</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editForm.creditLimit}
                onChange={e => setEditForm(f => ({ ...f, creditLimit: e.target.value }))}
                placeholder="0"
                className="w-full border-2 border-lime-300 rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-primary-800 mb-1">Payment terms</label>
              <input
                type="text"
                value={editForm.paymentTerms}
                onChange={e => setEditForm(f => ({ ...f, paymentTerms: e.target.value }))}
                placeholder="e.g. Net 30"
                className="w-full border-2 border-lime-300 rounded px-3 py-2"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit-isActive"
                checked={editForm.isActive}
                onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))}
                className="rounded border-2 border-primary-300"
              />
              <label htmlFor="edit-isActive" className="text-sm font-medium text-primary-800">Active (supplier visible and can receive payments)</label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => !updating && (setShowEditModal(false), setEditingSupplier(null))}
                className="px-4 py-2 border-2 border-primary-300 rounded font-medium text-primary-700 hover:bg-primary-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updating || editFormLoadFailed || !editForm.name?.trim()}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded font-medium disabled:opacity-50"
              >
                {updating ? 'Updating...' : 'Update Supplier'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => !deleting && setDeleteConfirm(null)}
        title="Delete supplier?"
        size="sm"
      >
        {deleteConfirm && (
          <div className="space-y-4">
            <p className="text-primary-700">
              Delete supplier <strong>{deleteConfirm.supplierName}</strong>? This will deactivate the supplier. Existing purchases will remain.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => !deleting && setDeleteConfirm(null)}
                className="px-4 py-2 border-2 border-primary-300 rounded font-medium text-primary-700 hover:bg-primary-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteSupplier}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium disabled:opacity-50"
              >
                {deleting ? 'Deactivating...' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default SuppliersPage
