import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, Plus, ChevronRight, MapPin, LayoutGrid, Users, ArrowLeft, Edit2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { branchesAPI, routesAPI, adminAPI } from '../../services'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'
import { useAuth } from '../../hooks/useAuth'
import Modal from '../../components/Modal'
import { Input } from '../../components/Form'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import { isAdminOrOwner } from '../../utils/roles'

const BranchesPage = () => {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'routes' ? 'routes' : 'branches'
  const [activeTab, setActiveTab] = useState(initialTab)
  const { branches: contextBranches, routes: contextRoutes, refresh: refreshBranchesRoutes } = useBranchesRoutes()

  const [branches, setBranches] = useState([])
  const [routes, setRoutes] = useState([])
  const [staffUsers, setStaffUsers] = useState([])
  const [loading, setLoading] = useState(true)

  // Modal states
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [showRouteModal, setShowRouteModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingRoute, setEditingRoute] = useState(null) // { id, name, branchId, assignedStaffIds }
  const [routeToDelete, setRouteToDelete] = useState(null)

  // Filter state for routes
  const [routeBranchFilter, setRouteBranchFilter] = useState('')

  // Form states
  const [branchForm, setBranchForm] = useState({ name: '', address: '', assignedStaffIds: [] })
  const [routeForm, setRouteForm] = useState({ name: '', branchId: '', assignedStaffIds: [] })

  const canManage = isAdminOrOwner(user)

  useEffect(() => {
    // Update URL when tab changes
    setSearchParams({ tab: activeTab })
  }, [activeTab, setSearchParams])

  const fetchBranches = async () => {
    setBranches(contextBranches || [])
  }

  const fetchRoutes = async () => {
    const branchId = routeBranchFilter ? parseInt(routeBranchFilter, 10) : null
    const list = branchId
      ? (contextRoutes || []).filter(r => r.branchId === branchId)
      : (contextRoutes || [])
    setRoutes(list)
  }

  const fetchStaff = async () => {
    if (!canManage) return
    try {
      const res = await adminAPI.getUsers()
      if (res?.success && res?.data) {
        // adminAPI.getUsers returns { items: [], ... } or [] depending on backend
        const users = Array.isArray(res.data) ? res.data : (res.data.items || [])
        // Filter for Staff role if needed, or just show all users that can be assigned
        const staff = users.filter(u => u.role === 'Staff')
        setStaffUsers(staff)
      }
    } catch (err) {
      if (!err?.isConnectionBlocked) console.error('Fetch staff error:', err)
    }
  }

  // Initial load from context
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      fetchBranches()
      fetchRoutes()
      await fetchStaff()
      setLoading(false)
    }
    loadData()
  }, [contextBranches, contextRoutes, routeBranchFilter])

  // Refetch routes when filter changes
  useEffect(() => {
    fetchRoutes()
  }, [routeBranchFilter, contextRoutes])

  const handleCreateBranch = async (e) => {
    e?.preventDefault()
    if (!branchForm.name?.trim()) {
      toast.error('Branch name is required')
      return
    }
    try {
      setSaving(true)
      const res = await branchesAPI.createBranch({
        name: branchForm.name.trim(),
        address: branchForm.address?.trim() || undefined,
        assignedStaffIds: branchForm.assignedStaffIds
      })
      if (res?.success) {
        toast.success('Branch created')
        setShowBranchModal(false)
        setBranchForm({ name: '', address: '', assignedStaffIds: [] })
        refreshBranchesRoutes()
      } else {
        toast.error(res?.message || 'Failed to create branch')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create branch')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateRoute = async (e) => {
    e?.preventDefault()
    if (!routeForm.name?.trim()) {
      toast.error('Route name is required')
      return
    }
    const bid = routeForm.branchId ? parseInt(routeForm.branchId, 10) : null
    if (!bid) {
      toast.error('Please select a branch')
      return
    }
    try {
      setSaving(true)
      if (editingRoute) {
        const res = await routesAPI.updateRoute(editingRoute.id, {
          name: routeForm.name.trim(),
          branchId: bid,
          assignedStaffIds: routeForm.assignedStaffIds || []
        })
        if (res?.success) {
          toast.success('Route updated')
          setShowRouteModal(false)
          setEditingRoute(null)
          setRouteForm({ name: '', branchId: '', assignedStaffIds: [] })
          refreshBranchesRoutes()
        } else {
          toast.error(res?.message || 'Failed to update route')
        }
      } else {
        const res = await routesAPI.createRoute({
          name: routeForm.name.trim(),
          branchId: bid,
          assignedStaffIds: routeForm.assignedStaffIds
        })
        if (res?.success) {
          toast.success('Route created')
          setShowRouteModal(false)
          setRouteForm({ name: '', branchId: '', assignedStaffIds: [] })
          refreshBranchesRoutes()
        } else {
          toast.error(res?.message || 'Failed to create route')
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || (editingRoute ? 'Failed to update route' : 'Failed to create route'))
    } finally {
      setSaving(false)
    }
  }

  const openEditRoute = (r) => {
    setEditingRoute(r)
    setRouteForm({
      name: r.name || '',
      branchId: String(r.branchId ?? ''),
      assignedStaffIds: Array.isArray(r.assignedStaffIds) ? [...r.assignedStaffIds] : []
    })
    setShowRouteModal(true)
  }

  const openAddRouteModal = () => {
    setEditingRoute(null)
    if (routeBranchFilter) setRouteForm(prev => ({ ...prev, name: '', branchId: routeBranchFilter, assignedStaffIds: [] }))
    else if (branches.length > 0) setRouteForm(prev => ({ ...prev, name: '', branchId: String(branches[0].id), assignedStaffIds: [] }))
    else setRouteForm({ name: '', branchId: '', assignedStaffIds: [] })
    setShowRouteModal(true)
  }

  const handleDeleteRoute = async () => {
    if (!routeToDelete) return
    try {
      const res = await routesAPI.deleteRoute(routeToDelete.id)
      if (res?.success !== false) {
        toast.success('Route deleted')
        setRouteToDelete(null)
        refreshBranchesRoutes()
      } else {
        toast.error(res?.message || 'Failed to delete route')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete route')
      setRouteToDelete(null)
    }
  }

  const toggleBranchStaff = (staffId) => {
    setBranchForm(prev => {
      const exists = prev.assignedStaffIds.includes(staffId)
      return {
        ...prev,
        assignedStaffIds: exists
          ? prev.assignedStaffIds.filter(id => id !== staffId)
          : [...prev.assignedStaffIds, staffId]
      }
    })
  }

  const toggleRouteStaff = (staffId) => {
    setRouteForm(prev => {
      const exists = prev.assignedStaffIds.includes(staffId)
      return {
        ...prev,
        assignedStaffIds: exists
          ? prev.assignedStaffIds.filter(id => id !== staffId)
          : [...prev.assignedStaffIds, staffId]
      }
    })
  }

  if (loading && branches.length === 0 && routes.length === 0) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Go Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold text-neutral-900 flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-primary-600" />
            Branches & Routes
          </h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200 mb-6 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setActiveTab('branches')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'branches'
            ? 'border-primary-600 text-primary-600'
            : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
        >
          <Building2 className="h-4 w-4" />
          Branches
        </button>
        <button
          onClick={() => setActiveTab('routes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'routes'
            ? 'border-primary-600 text-primary-600'
            : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
        >
          <MapPin className="h-4 w-4" />
          Routes
        </button>
      </div>

      {/* Tab Content: Branches */}
      {activeTab === 'branches' && (
        <div className="animate-fadeIn">
          <div className="flex justify-end mb-4">
            {canManage && (
              <button
                type="button"
                onClick={() => setShowBranchModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Add Branch
              </button>
            )}
          </div>

          {branches.length === 0 ? (
            <div className="bg-white rounded-lg border border-neutral-200 p-8 text-center">
              <p className="text-neutral-600 font-medium">Add your first branch to organize locations and routes.</p>
              <p className="text-neutral-500 text-sm mt-1">Branches help you manage multiple warehouses or offices and assign routes to them.</p>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setShowBranchModal(true)}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
                >
                  <Plus className="h-4 w-4" />
                  Add Branch
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {branches.map((b) => (
                <li key={b.id}>
                  <Link
                    to={`/branches/${b.id}`}
                    className="flex items-center justify-between p-4 bg-white rounded-lg border border-neutral-200 hover:border-primary-300 hover:shadow-sm transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary-50">
                        <Building2 className="h-5 w-5 text-primary-600" />
                      </div>
                      <div>
                        <p className="font-medium text-neutral-900">{b.name}</p>
                        {b.address && <p className="text-sm text-neutral-500">{b.address}</p>}
                        <p className="text-xs text-neutral-400">{b.routeCount || 0} route(s)</p>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-neutral-400" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tab Content: Routes */}
      {activeTab === 'routes' && (
        <div className="animate-fadeIn">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-sm text-neutral-600">Filter by Branch:</span>
              <select
                value={routeBranchFilter}
                onChange={(e) => setRouteBranchFilter(e.target.value)}
                className="border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[150px]"
              >
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={openAddRouteModal}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Add Route
              </button>
            )}
          </div>

          {routes.length === 0 ? (
            <div className="bg-white rounded-lg border border-neutral-200 p-8 text-center">
              {branches.length === 0 ? (
                <>
                  <p className="text-neutral-600 font-medium">Create a branch first, then add routes.</p>
                  <p className="text-neutral-500 text-sm mt-1">Routes belong to a branch and are used for delivery or field sales.</p>
                </>
              ) : (
                <>
                  <p className="text-neutral-600 font-medium">Add a route under a branch for delivery or field sales.</p>
                  <p className="text-neutral-500 text-sm mt-1">You can assign staff and customers to routes.</p>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => { setRouteForm(prev => ({ ...prev, branchId: branches[0]?.id || '', name: '', assignedStaffIds: [] })); setEditingRoute(null); setShowRouteModal(true) }}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
                    >
                      <Plus className="h-4 w-4" />
                      Add Route
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {routes.map((r) => (
                <li key={r.id} className="bg-white rounded-lg border border-neutral-200 hover:border-primary-300 transition overflow-hidden">
                  <div className="flex items-center gap-2 p-4">
                    <Link
                      to={`/routes/${r.id}`}
                      className="flex flex-1 items-center gap-3 min-w-0"
                    >
                      <div className="p-2 rounded-lg bg-primary-50 shrink-0">
                        <MapPin className="h-5 w-5 text-primary-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-900">{r.name}</p>
                        <p className="text-sm text-neutral-500">{r.branchName ?? '—'}</p>
                        <p className="text-xs text-neutral-400">{r.customerCount ?? 0} customer(s), {r.staffCount ?? 0} staff</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-neutral-400 shrink-0" />
                    </Link>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); openEditRoute(r) }}
                          className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition"
                          title="Edit route"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setRouteToDelete(r) }}
                          className="p-2 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete route"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Add Branch Modal */}
      {showBranchModal && (
        <Modal
          isOpen={true}
          title="Add Branch"
          onClose={() => !saving && setShowBranchModal(false)}
        >
          <form onSubmit={handleCreateBranch} className="space-y-4">
            <Input
              label="Branch name"
              value={branchForm.name}
              onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
              required
              placeholder="e.g. Main Warehouse"
            />
            <Input
              label="Address (optional)"
              value={branchForm.address}
              onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
              placeholder="Full address"
            />

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Assign Staff</label>
              <div className="border border-neutral-300 rounded-lg max-h-48 overflow-y-auto p-2 bg-neutral-50">
                {staffUsers.length === 0 ? (
                  <p className="text-sm text-neutral-500 text-center py-2">No staff users found.</p>
                ) : (
                  <div className="space-y-2">
                    {staffUsers.map(staff => (
                      <label key={staff.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded transition">
                        <input
                          type="checkbox"
                          checked={branchForm.assignedStaffIds.includes(staff.id)}
                          onChange={() => toggleBranchStaff(staff.id)}
                          className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                        />
                        <div>
                          <p className="text-sm font-medium text-neutral-900">{staff.name}</p>
                          <p className="text-xs text-neutral-500">{staff.email}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowBranchModal(false)} className="px-4 py-2 border border-neutral-300 rounded-lg text-sm text-neutral-700 hover:bg-neutral-50">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Create Branch'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Route confirmation */}
      <ConfirmDangerModal
        isOpen={!!routeToDelete}
        onClose={() => setRouteToDelete(null)}
        onConfirm={handleDeleteRoute}
        title="Delete route"
        message={routeToDelete ? `Delete route "${routeToDelete.name}"? Customers and staff will be unassigned. This cannot be undone.` : ''}
        confirmLabel="Delete route"
      />

      {/* Add / Edit Route Modal */}
      {showRouteModal && (
        <Modal
          isOpen={true}
          title={editingRoute ? 'Edit Route' : 'Add Route'}
          onClose={() => { if (!saving) { setShowRouteModal(false); setEditingRoute(null); setRouteForm({ name: '', branchId: '', assignedStaffIds: [] }) } }}
        >
          <form onSubmit={handleCreateRoute} className="space-y-4">
            <Input
              label="Route name"
              value={routeForm.name}
              onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })}
              required
              placeholder="e.g. North Route"
            />
            <div className="space-y-1">
              <label className="block text-sm font-medium text-neutral-700">Branch</label>
              <select
                value={routeForm.branchId}
                onChange={(e) => setRouteForm({ ...routeForm, branchId: e.target.value })}
                required
                className="block w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              >
                <option value="">Select branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">Assign Staff</label>
              <div className="border border-neutral-300 rounded-lg max-h-48 overflow-y-auto p-2 bg-neutral-50">
                {staffUsers.length === 0 ? (
                  <p className="text-sm text-neutral-500 text-center py-2">No staff users found.</p>
                ) : (
                  <div className="space-y-2">
                    {staffUsers.map(staff => (
                      <label key={staff.id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded transition">
                        <input
                          type="checkbox"
                          checked={routeForm.assignedStaffIds.includes(staff.id)}
                          onChange={() => toggleRouteStaff(staff.id)}
                          className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
                        />
                        <div>
                          <p className="text-sm font-medium text-neutral-900">{staff.name}</p>
                          <p className="text-xs text-neutral-500">{staff.email}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setShowRouteModal(false); setEditingRoute(null); setRouteForm({ name: '', branchId: '', assignedStaffIds: [] }) }} className="px-4 py-2 border border-neutral-300 rounded-lg text-sm text-neutral-700 hover:bg-neutral-50">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">
                {saving ? 'Saving...' : (editingRoute ? 'Update Route' : 'Create Route')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

export default BranchesPage

