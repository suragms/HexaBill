import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import {
  Plus,
  Search,
  Edit,
  Trash2,
  UserPlus,
  Shield,
  ShieldAlert,
  User,
  Users,
  Mail,
  Phone,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  TrendingDown,
  ShoppingCart,
  TrendingUp,
  BookOpen,
  Wallet,
  BarChart3,
  Activity,
  Package,
  Zap,
  FileText,
  Copy,
  Monitor
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { LoadingCard } from '../../components/Loading'
import Modal from '../../components/Modal'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import { adminAPI } from '../../services'
import toast from 'react-hot-toast'
import { isAdminOrOwner, isOwner, getRoleDisplayName } from '../../utils/roles'  // CRITICAL: Multi-tenant role checking
import { validateEmail } from '../../utils/validation'
import { useBranchesRoutes } from '../../contexts/BranchesRoutesContext'

const DASHBOARD_ITEMS = [
  { id: 'salesToday', label: 'Sales Today Card', icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
  { id: 'expensesToday', label: 'Expenses Today Card', icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
  { id: 'purchasesToday', label: 'Purchases Today Card', icon: ShoppingCart, color: 'text-orange-600', bg: 'bg-orange-50' },
  { id: 'salesLedger', label: 'Sales Ledger Link', icon: BookOpen, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'expenses', label: 'Expenses Link', icon: Wallet, color: 'text-purple-600', bg: 'bg-purple-50' },
  { id: 'salesTrend', label: 'Sales Trend Chart', icon: BarChart3, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'quickStats', label: 'Quick Stats Summary', icon: Activity, color: 'text-cyan-600', bg: 'bg-cyan-50' },
  { id: 'lowStockAlert', label: 'Low Stock Alerts', icon: Package, color: 'text-yellow-600', bg: 'bg-yellow-50' },
  { id: 'quickActions', label: 'Quick Actions', icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50' },
  { id: 'pendingBills', label: 'Pending Bills Table', icon: FileText, color: 'text-rose-600', bg: 'bg-rose-50' }
]

// Page-level access permissions (can be toggled for staff)
const PAGE_ACCESS_ITEMS = [
  { id: 'pos', label: 'POS / Billing', icon: ShoppingCart, color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'invoices', label: 'Invoices', icon: FileText, color: 'text-indigo-600', bg: 'bg-indigo-50' },
  { id: 'products', label: 'Products', icon: Package, color: 'text-green-600', bg: 'bg-green-50' },
  { id: 'customers', label: 'Customers', icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
  { id: 'expenses', label: 'Expenses', icon: Wallet, color: 'text-red-600', bg: 'bg-red-50' },
  { id: 'reports', label: 'Reports', icon: BarChart3, color: 'text-emerald-600', bg: 'bg-emerald-50' }
]

const DashboardAccessControl = ({ selectedPermissions, onToggle, onSelectAll, onClearAll }) => (
  <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-blue-900 flex items-center">
        <Shield className="h-4 w-4 mr-1.5" />
        Dashboard access
      </h3>
      <div className="flex space-x-2">
        <button type="button" onClick={onSelectAll} className="text-xs font-medium text-blue-600 hover:text-blue-800">All</button>
        <span className="text-blue-200">|</span>
        <button type="button" onClick={onClearAll} className="text-xs font-medium text-blue-600 hover:text-blue-800">None</button>
      </div>
    </div>
    <div className="mb-3 p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-start text-xs text-amber-800">
      <ShieldAlert className="h-4 w-4 text-amber-600 mr-2 flex-shrink-0 mt-0.5" />
      <div>
        <strong>Restricted Metrics:</strong> "Profit Today" card is locked — visible to Admin & Owner only.
        Staff members can never see profit data, even if assigned all other permissions.
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
      {DASHBOARD_ITEMS.map(item => {
        const Icon = item.icon
        const isSelected = selectedPermissions.includes(item.id)
        return (
          <label
            key={item.id}
            className={`flex items-center p-2 rounded-lg cursor-pointer transition-all border ${isSelected
              ? 'bg-white border-blue-200 shadow-sm ring-1 ring-blue-100'
              : 'bg-white/40 border-transparent opacity-70 hover:bg-white hover:opacity-100'
              }`}
          >
            <div className="relative flex items-center w-full">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(item.id)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded transition-all cursor-pointer"
              />
              <div className={`ml-3 p-1.5 rounded-md ${item.bg}`}>
                <Icon className={`h-3.5 w-3.5 ${item.color}`} />
              </div>
              <div className="ml-2 flex flex-col">
                <span className="text-xs font-medium text-gray-700">{item.label}</span>
                {item.note && <span className="text-xs text-gray-500 italic font-normal leading-none">{item.note}</span>}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  </div>
)

const PageAccessControl = ({ selectedPageAccess, onToggle, onSelectAll, onClearAll }) => (
  <div className="bg-purple-50/50 rounded-lg p-3 border border-purple-100">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-purple-900 flex items-center">
        <Shield className="h-4 w-4 mr-1.5" />
        Page access
      </h3>
      <div className="flex space-x-2">
        <button type="button" onClick={onSelectAll} className="text-xs font-medium text-purple-600 hover:text-purple-800">All</button>
        <span className="text-purple-200">|</span>
        <button type="button" onClick={onClearAll} className="text-xs font-medium text-purple-600 hover:text-purple-800">None</button>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {PAGE_ACCESS_ITEMS.map(item => {
        const Icon = item.icon
        const isSelected = selectedPageAccess.includes(item.id)
        return (
          <label key={item.id} className={`flex items-center p-2 rounded-lg cursor-pointer transition-all border ${isSelected ? 'bg-white border-purple-200 shadow-sm' : 'bg-white/40 border-transparent opacity-70 hover:bg-white hover:opacity-100'}`}>
            <input type="checkbox" checked={isSelected} onChange={() => onToggle(item.id)} className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded cursor-pointer" />
            <div className={`ml-3 p-1.5 rounded-md ${item.bg}`}><Icon className={`h-3.5 w-3.5 ${item.color}`} /></div>
            <span className="ml-2 text-xs font-medium text-gray-700">{item.label}</span>
          </label>
        )
      })}
    </div>
  </div>
)

const UserAssignments = ({ branches, routes, assignedBranches, assignedRoutes, setAssignedBranches, setAssignedRoutes }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div className="bg-white p-3 rounded-lg border border-gray-200">
      <h3 className="font-semibold text-gray-900 mb-2 flex items-center">
        <span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span>
        Assigned Branches
      </h3>
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {branches.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No branches found.</p>
        ) : (
          branches.map(branch => (
            <label key={branch.id} className="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
              <input
                type="checkbox"
                checked={assignedBranches.includes(branch.id)}
                onChange={(e) => {
                  if (e.target.checked) setAssignedBranches([...assignedBranches, branch.id])
                  else setAssignedBranches(assignedBranches.filter(id => id !== branch.id))
                }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{branch.name}</span>
            </label>
          ))
        )}
      </div>
    </div>

    <div className="bg-white p-3 rounded-lg border border-gray-200">
      <h3 className="font-semibold text-gray-900 mb-2 flex items-center">
        <span className="w-2 h-2 rounded-full bg-purple-500 mr-2"></span>
        Assigned Routes
      </h3>
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {routes.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No routes found.</p>
        ) : (
          routes.map(route => (
            <label key={route.id} className="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
              <input
                type="checkbox"
                checked={assignedRoutes.includes(route.id)}
                onChange={(e) => {
                  if (e.target.checked) setAssignedRoutes([...assignedRoutes, route.id])
                  else setAssignedRoutes(assignedRoutes.filter(id => id !== route.id))
                }}
                className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <div className="flex flex-col">
                <span className="text-sm text-gray-700">{route.name}</span>
                <span className="text-xs text-gray-500">{branches.find(b => b.id === route.branchId)?.name}</span>
              </div>
            </label>
          ))
        )}
      </div>
    </div>
  </div>
)

const UsersPage = () => {
  const { user: currentUser, updateUser } = useAuth()
  const { branches, routes } = useBranchesRoutes()
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState([])
  const [filteredUsers, setFilteredUsers] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showCredentialsModal, setShowCredentialsModal] = useState(false)
  const [createdCredentials, setCreatedCredentials] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [loadingAction, setLoadingAction] = useState(false)
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [activityUser, setActivityUser] = useState(null)
  const [activityLogs, setActivityLogs] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [showSessionsModal, setShowSessionsModal] = useState(false)
  const [userToDelete, setUserToDelete] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  const [userModalTab, setUserModalTab] = useState('details') // 'details' | 'access' | 'assignments'
  const [assignedBranches, setAssignedBranches] = useState([])
  const [assignedRoutes, setAssignedRoutes] = useState([])

  // Dashboard permissions state
  const [selectedPermissions, setSelectedPermissions] = useState(
    DASHBOARD_ITEMS.map(i => i.id) // Default all on
  )

  // Page access state (which pages Staff can open)
  const [selectedPageAccess, setSelectedPageAccess] = useState(
    PAGE_ACCESS_ITEMS.map(i => i.id) // Default all
  )

  const togglePermission = (id) => {
    setSelectedPermissions(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  const selectAllPermissions = () => {
    setSelectedPermissions(DASHBOARD_ITEMS.map(i => i.id))
  }

  const clearAllPermissions = () => {
    setSelectedPermissions([])
  }

  const togglePageAccess = (id) => {
    setSelectedPageAccess(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }
  const selectAllPageAccess = () => setSelectedPageAccess(PAGE_ACCESS_ITEMS.map(i => i.id))
  const clearAllPageAccess = () => setSelectedPageAccess([])

  const openAddModal = () => {
    setUserModalTab('details')
    resetAdd()
    setSelectedPermissions(DASHBOARD_ITEMS.map(i => i.id))
    setSelectedPageAccess(PAGE_ACCESS_ITEMS.map(i => i.id))
    setAssignedBranches([])
    setAssignedRoutes([])
    setShowAddModal(true)
  }

  const {
    register: registerAdd,
    handleSubmit: handleSubmitAdd,
    reset: resetAdd,
    watch: watchAdd,
    formState: { errors: errorsAdd }
  } = useForm()
  const addFormRole = watchAdd('role')
  const addFormPassword = watchAdd('password') ?? ''

  const getPasswordStrength = (pwd) => {
    if (!pwd || pwd.length === 0) return { score: 0, label: '', color: 'bg-gray-200' }
    const weakList = ['123456', '12345678', '1234', 'password', 'qwerty', 'abc123', 'admin', 'letmein']
    if (weakList.some(w => pwd.toLowerCase().includes(w)) || pwd.length < 6) return { score: 1, label: 'Too weak', color: 'bg-red-500' }
    let score = 0
    if (pwd.length >= 8) score++
    if (pwd.length >= 10) score++
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++
    if (/\d/.test(pwd)) score++
    if (/[^a-zA-Z0-9]/.test(pwd)) score++
    if (score <= 1) return { score: 1, label: 'Weak', color: 'bg-red-500' }
    if (score <= 3) return { score: 3, label: 'Fair', color: 'bg-amber-500' }
    if (score <= 4) return { score: 4, label: 'Good', color: 'bg-lime-500' }
    return { score: 5, label: 'Strong', color: 'bg-green-600' }
  }
  const passwordStrength = getPasswordStrength(addFormPassword)

  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    reset: resetEdit,
    formState: { errors: errorsEdit },
    setValue: setEditValue
  } = useForm()

  const {
    register: registerPassword,
    handleSubmit: handleSubmitPassword,
    reset: resetPassword,
    formState: { errors: errorsPassword }
  } = useForm()

  useEffect(() => {
    if (isAdminOrOwner(currentUser)) {
      fetchUsers()
    }
  }, [])

  useEffect(() => {
    filterUsers()
  }, [users, searchTerm])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getUsers()
      if (response?.success && response?.data) {
        setUsers(response.data.items || [])
      } else {
        setUsers([])
      }
    } catch (error) {
      console.error('Error loading users:', error)
      toast.error('Failed to load users')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  const filterUsers = () => {
    if (!searchTerm) {
      setFilteredUsers(users)
      return
    }

    const filtered = users.filter(user =>
      user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.role?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    setFilteredUsers(filtered)
  }

  // Helper function to filter out profitToday permission (never assignable to staff)
  const filterProfitPermission = (permissions, role) => {
    const filtered = permissions.filter(p => p.trim() !== 'profitToday')
    // Warn if profitToday was attempted to be assigned
    if (permissions.includes('profitToday') && role?.toLowerCase() === 'staff') {
      console.warn('Attempted to assign profitToday permission to staff - filtered out')
    }
    return filtered
  }

  const handleCreateUser = async (data) => {
    try {
      setLoadingAction(true)
      // Filter out profitToday - never assignable to staff
      const cleanPermissions = filterProfitPermission(selectedPermissions, data.role)
      const payload = {
        ...data,
        dashboardPermissions: cleanPermissions.join(','),
        pageAccess: selectedPageAccess.join(','),
        assignedBranchIds: assignedBranches,
        assignedRouteIds: assignedRoutes
      }
      const response = await adminAPI.createUser(payload)
      if (response?.success) {
        setShowAddModal(false)
        resetAdd()
        fetchUsers()
        setCreatedCredentials({ email: data.email, password: data.password || '' })
        setShowCredentialsModal(true)
        toast.success('User created. Copy credentials below.')
      } else {
        toast.error(response?.message || 'Failed to create user')
      }
    } catch (error) {
      console.error('Error creating user:', error)
      toast.error(error?.response?.data?.message || 'Failed to create user')
    } finally {
      setLoadingAction(false)
    }
  }

  const handleUpdateUser = async (data) => {
    if (!data.name?.trim()) {
      toast.error('Name is required')
      return
    }
    const validRoles = ['Owner', 'Admin', 'Staff']
    if (data.role && !validRoles.includes(data.role)) {
      toast.error('Role must be Owner, Admin, or Staff')
      return
    }
    try {
      setLoadingAction(true)
      // Filter out profitToday - never assignable to staff
      const cleanPermissions = filterProfitPermission(selectedPermissions, data.role || selectedUser?.role)
      const payload = {
        ...data,
        dashboardPermissions: cleanPermissions.join(','),
        pageAccess: selectedPageAccess.join(','),
        assignedBranchIds: assignedBranches,
        assignedRouteIds: assignedRoutes
      }
      const response = await adminAPI.updateUser(selectedUser.id, payload)
      if (response?.success) {
        toast.success('User updated successfully!')
        // If updating self, update local state immediately
        if (selectedUser.id === currentUser?.id || selectedUser.id === currentUser?.UserId) {
          updateUser({ dashboardPermissions: payload.dashboardPermissions })
        }
        setShowEditModal(false)
        resetEdit()
        setSelectedUser(null)
        fetchUsers()
      } else {
        toast.error(response?.message || 'Failed to update user')
      }
    } catch (error) {
      console.error('Error updating user:', error)
      const msg = error?.response?.data?.message || error?.response?.data?.errors?.[0] || 'Failed to update user'
      toast.error(msg)
    } finally {
      setLoadingAction(false)
    }
  }

  const handleDeleteUser = (user) => {
    setUserToDelete(user)
  }

  const performDeleteUser = () => {
    if (!userToDelete) return
    const user = userToDelete
    setUserToDelete(null)
    setLoadingAction(true)
    adminAPI.deleteUser(user.id)
      .then((res) => {
        if (res?.success) {
          toast.success('User deleted')
          fetchUsers()
        } else {
          toast.error(res?.message || 'Failed to delete user')
        }
      })
      .catch((err) => {
        if (!err?._handledByInterceptor) {
          toast.error(err?.response?.data?.message || 'Cannot delete: user may have associated records')
        }
      })
      .finally(() => setLoadingAction(false))
  }

  const handleResetPassword = async (data) => {
    try {
      setLoadingAction(true)
      const response = await adminAPI.resetPassword(selectedUser.id, data)
      if (response?.success) {
        toast.success('Password reset successfully!')
        setShowPasswordModal(false)
        resetPassword()
        setSelectedUser(null)
      } else {
        toast.error(response?.message || 'Failed to reset password')
      }
    } catch (error) {
      console.error('Error resetting password:', error)
      toast.error(error?.response?.data?.message || 'Failed to reset password')
    } finally {
      setLoadingAction(false)
    }
  }

  const openEditModal = (user) => {
    setUserModalTab('details')
    setSelectedUser(user)
    setEditValue('name', user.name)
    setEditValue('phone', user.phone || '')
    setEditValue('role', user.role)

    // Set dashboard permissions from user
    // Filter out profitToday - it should never be assignable to staff
    if (user.dashboardPermissions) {
      const permissions = user.dashboardPermissions.split(',').filter(p => p.trim() !== 'profitToday')
      setSelectedPermissions(permissions)
    } else {
      setSelectedPermissions(DASHBOARD_ITEMS.map(i => i.id))
    }

    setShowEditModal(true)

    setAssignedBranches(user.assignedBranchIds || [])
    setAssignedRoutes(user.assignedRouteIds || [])

    if (user.pageAccess) {
      setSelectedPageAccess(user.pageAccess.split(',').map(s => s.trim()).filter(Boolean))
    } else {
      setSelectedPageAccess(PAGE_ACCESS_ITEMS.map(i => i.id))
    }
  }

  const openPasswordModal = (user) => {
    setSelectedUser(user)
    setShowPasswordModal(true)
  }

  if (!isAdminOrOwner(currentUser)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center max-w-md">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">Only administrators and owners can access this page.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return <LoadingCard message="Loading users..." />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-50">
      <div className="p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
              <User className="h-6 w-6 mr-2 text-blue-600" />
              User Management
            </h1>
            <p className="text-gray-600">Manage admin and staff users</p>
          </div>
          <div className="mt-4 sm:mt-0 flex space-x-3">
            <button
              onClick={fetchUsers}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </button>
            <button
              onClick={() => {
                setShowSessionsModal(true)
                setSessionsLoading(true)
                setSessions([])
                adminAPI.getSessions().then((res) => {
                  if (res?.success && Array.isArray(res.data)) setSessions(res.data)
                  else setSessions([])
                }).catch(() => setSessions([])).finally(() => setSessionsLoading(false))
              }}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition flex items-center"
            >
              <Monitor className="h-4 w-4 mr-2" />
              Sessions
            </button>
            <button
              onClick={openAddModal}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition flex items-center"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search users by name, email, or role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Users Table - min-width so mobile can scroll horizontally to see all columns */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full divide-y divide-gray-200">
              <thead className="bg-gradient-to-r from-blue-900 to-blue-800 text-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Assigned (Branch / Route)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Last login
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-6 py-8 text-center">
                      {searchTerm ? (
                        <p className="text-gray-500 text-sm">No users found matching your search</p>
                      ) : (
                        <>
                          <p className="text-gray-600 font-medium">Invite staff and assign them to branches or routes.</p>
                          <p className="text-gray-500 text-sm mt-1">Add your first user to get started.</p>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {user.role?.toLowerCase() === 'owner' ? (
                            <ShieldAlert className="h-5 w-5 text-red-600 mr-2" />
                          ) : user.role?.toLowerCase() === 'admin' ? (
                            <Shield className="h-5 w-5 text-yellow-500 mr-2" />
                          ) : (
                            <User className="h-5 w-5 text-blue-500 mr-2" />
                          )}
                          <span className="text-sm font-medium text-gray-900">{user.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-600">
                          <Mail className="h-4 w-4 mr-2" />
                          {user.email}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {user.phone || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {/* BUG #2.9 FIX: Online/Offline status indicator using LastActiveAt */}
                        {(() => {
                          const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0
                          const now = Date.now()
                          const fiveMinutesAgo = now - (5 * 60 * 1000) // 5 minutes in milliseconds
                          const isOnline = lastActive > 0 && lastActive > fiveMinutesAgo

                          return (
                            <div className="flex items-center">
                              <span
                                className={`inline-block w-3 h-3 rounded-full mr-2 flex-shrink-0 ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
                                title={isOnline
                                  ? 'Online - Active in last 5 minutes'
                                  : (user.lastActiveAt
                                    ? `Offline - Last active: ${new Date(user.lastActiveAt).toLocaleString()}`
                                    : 'No activity recorded')}
                              />
                              <span className={`text-xs font-medium ${isOnline ? 'text-green-700' : 'text-gray-500'}`}>
                                {isOnline ? 'Online' : 'Offline'}
                              </span>
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full w-fit ${user.role?.toLowerCase() === 'owner'
                            ? 'bg-red-100 text-red-800'
                            : user.role?.toLowerCase() === 'admin'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-blue-100 text-blue-800'
                            }`}>
                            {getRoleDisplayName(user)}
                          </span>
                          {user.role?.toLowerCase() === 'owner' && (
                            <span className="text-xs text-gray-500">Company owner</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 max-w-[280px]">
                        {user.role?.toLowerCase() === 'staff' ? (
                          (() => {
                            const branchIds = user.assignedBranchIds || []
                            const routeIds = user.assignedRouteIds || []
                            const branchNames = branchIds.map(bid => branches.find(b => b.id === bid)?.name).filter(Boolean)
                            const routeNames = routeIds.map(rid => routes.find(r => r.id === rid)?.name).filter(Boolean)
                            const hasAny = branchNames.length > 0 || routeNames.length > 0
                            return (
                              <div className="flex flex-wrap gap-1">
                                {!hasAny && <span className="text-amber-600 text-xs">Not assigned</span>}
                                {branchNames.length > 0 && (
                                  <span className="text-xs text-gray-500 mr-1">Branches:</span>
                                )}
                                {branchNames.map((name, i) => (
                                  <span key={`b-${i}`} className="inline-flex px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800" title="Branch">{name}</span>
                                ))}
                                {routeNames.length > 0 && branchNames.length > 0 && <span className="text-gray-300">·</span>}
                                {routeNames.length > 0 && (
                                  <span className="text-xs text-gray-500 mr-1">Routes:</span>
                                )}
                                {routeNames.map((name, i) => (
                                  <span key={`r-${i}`} className="inline-flex px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-800" title="Route">{name}</span>
                                ))}
                              </div>
                            )
                          })()
                        ) : user.role?.toLowerCase() === 'admin' ? (
                          (() => {
                            const branchIds = user.assignedBranchIds || []
                            const routeIds = user.assignedRouteIds || []
                            const branchNames = branchIds.map(bid => branches.find(b => b.id === bid)?.name).filter(Boolean)
                            const routeNames = routeIds.map(rid => routes.find(r => r.id === rid)?.name).filter(Boolean)
                            const hasAny = branchNames.length > 0 || routeNames.length > 0
                            if (!hasAny) return <span className="text-neutral-400">—</span>
                            return (
                              <div className="flex flex-wrap gap-1">
                                {branchNames.map((name, i) => (
                                  <span key={`b-${i}`} className="inline-flex px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800">{name}</span>
                                ))}
                                {routeNames.map((name, i) => (
                                  <span key={`r-${i}`} className="inline-flex px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-800">{name}</span>
                                ))}
                              </div>
                            )
                          })()
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => {
                              const text = `Email: ${user.email}`
                              navigator.clipboard.writeText(text).then(() => toast.success('Email copied'))
                            }}
                            className="text-gray-500 hover:text-gray-800 p-2 hover:bg-gray-100 rounded transition"
                            title="Copy email"
                          >
                            <Copy className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => {
                              setActivityUser(user)
                              setShowActivityModal(true)
                              setActivityLogs([])
                              setActivityLoading(true)
                              adminAPI.getUserActivity(user.id).then((res) => {
                                if (res?.success && Array.isArray(res.data)) setActivityLogs(res.data)
                                else setActivityLogs([])
                              }).catch(() => setActivityLogs([])).finally(() => setActivityLoading(false))
                            }}
                            className="text-gray-500 hover:text-indigo-700 p-2 hover:bg-indigo-50 rounded transition"
                            title="View activity"
                          >
                            <Activity className="h-5 w-5" />
                          </button>
                          {(isOwner(currentUser) || user.role?.toLowerCase() !== 'owner') && (
                            <button
                              onClick={() => openEditModal(user)}
                              className="text-blue-600 hover:text-blue-900 p-2 hover:bg-blue-50 rounded transition"
                              title="Edit User"
                            >
                              <Edit className="h-5 w-5" />
                            </button>
                          )}
                          {(isOwner(currentUser) || user.role?.toLowerCase() !== 'owner') && (
                            <button
                              onClick={() => openPasswordModal(user)}
                              className="text-green-600 hover:text-green-900 p-2 hover:bg-green-50 rounded transition"
                              title="Reset Password"
                            >
                              <CheckCircle2 className="h-5 w-5" />
                            </button>
                          )}
                          {user.id !== currentUser?.id && user.role?.toLowerCase() !== 'owner' && (
                            <button
                              onClick={() => handleDeleteUser(user)}
                              className="text-red-600 hover:text-red-900 p-2 hover:bg-red-50 rounded transition"
                              title="Delete User"
                            >
                              <Trash2 className="h-5 w-5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center">
              <Shield className="h-8 w-8 text-yellow-500 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Admins</p>
                <p className="text-2xl font-bold text-gray-900">
                  {users.filter(u => u.role?.toLowerCase() === 'admin').length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center">
              <User className="h-8 w-8 text-blue-500 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Staff</p>
                <p className="text-2xl font-bold text-gray-900">
                  {users.filter(u => u.role?.toLowerCase() === 'staff').length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center">
              <UserPlus className="h-8 w-8 text-green-500 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total</p>
                <p className="text-2xl font-bold text-gray-900">{users.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add User Modal - tabbed for shorter vertical layout */}
      {/* Copy credentials modal - shown once after creating a user */}
      <Modal
        isOpen={showCredentialsModal && !!createdCredentials}
        onClose={() => {
          setShowCredentialsModal(false)
          setCreatedCredentials(null)
        }}
        title="User created – copy credentials"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Share these with the user. Password cannot be shown again.</p>
          <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm space-y-1">
            <p><span className="text-gray-500">Email:</span> {createdCredentials?.email}</p>
            {createdCredentials?.password && <p><span className="text-gray-500">Password:</span> {createdCredentials.password}</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              const text = createdCredentials?.password
                ? `Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`
                : `Email: ${createdCredentials?.email}`
              navigator.clipboard.writeText(text).then(() => toast.success('Credentials copied'))
            }}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Copy className="h-4 w-4" />
            Copy credentials
          </button>
        </div>
      </Modal>

      {/* User Activity Modal */}
      <Modal
        isOpen={showActivityModal}
        onClose={() => { setShowActivityModal(false); setActivityUser(null); setActivityLogs([]) }}
        title={activityUser ? `Activity: ${activityUser.name}` : 'User activity'}
      >
        <div className="min-h-[200px] max-h-[60vh] overflow-auto">
          {activityLoading ? (
            <div className="flex items-center justify-center py-8"><LoadingCard /></div>
          ) : activityLogs.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No activity recorded for this user.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Action</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activityLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{log.action || '—'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-xs truncate" title={log.details || ''}>{log.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>

      {/* Sessions modal: who is logged in / recent logins */}
      <Modal
        isOpen={showSessionsModal}
        onClose={() => { setShowSessionsModal(false); setSessions([]) }}
        title="Recent sessions"
      >
        <p className="text-sm text-gray-500 mb-3">Recent logins for your company. Each row is one login event.</p>
        <div className="min-h-[200px] max-h-[60vh] overflow-auto">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8"><LoadingCard /></div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No sessions found.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">User</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Email</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Login at</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Device / IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900">{s.userName || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{s.userEmail || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{s.loginAt ? new Date(s.loginAt).toLocaleString() : '—'}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate" title={s.userAgent || s.ipAddress || ''}>
                      {s.ipAddress || '—'}
                      {s.userAgent ? ` · ${String(s.userAgent).substring(0, 40)}${String(s.userAgent).length > 40 ? '…' : ''}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          resetAdd()
        }}
        title="Add User"
      >
        <form onSubmit={handleSubmitAdd(handleCreateUser)} className="flex flex-col max-h-[85vh]">
          <div className="flex border-b border-gray-200 mb-3">
            <button
              type="button"
              onClick={() => setUserModalTab('details')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${userModalTab === 'details' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => setUserModalTab('access')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${userModalTab === 'access' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Dashboard access
            </button>
            <button
              type="button"
              onClick={() => setUserModalTab('assignments')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${userModalTab === 'assignments' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Assignments
            </button>
            <button
              type="button"
              onClick={() => setUserModalTab('pageAccess')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${userModalTab === 'pageAccess' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Page access
            </button>
          </div>
          <div className="overflow-y-auto min-h-0 flex-1 space-y-3">
            {userModalTab === 'details' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Name *</label>
                  <input
                    type="text"
                    {...registerAdd('name', { required: 'Name is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                  {errorsAdd.name && <p className="text-red-500 text-xs mt-0.5">{errorsAdd.name.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Email *</label>
                  <input
                    type="email"
                    {...registerAdd('email', {
                      required: 'Email is required',
                      validate: (v) => (v && validateEmail(v)) ? true : 'Enter a valid email address'
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                  {errorsAdd.email && <p className="text-red-500 text-xs mt-0.5">{errorsAdd.email.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Password *</label>
                  <input
                    type="password"
                    {...registerAdd('password', {
                      required: 'Password is required',
                      minLength: { value: 8, message: 'At least 8 characters' },
                      validate: (v) => {
                        if (!v) return true
                        const weak = ['123456', '12345678', '1234', 'password', 'qwerty', 'abc123', 'admin', 'letmein']
                        if (weak.some(w => v.toLowerCase().includes(w))) return 'Avoid common passwords (e.g. 1234, password)'
                        if (v.length < 8) return 'At least 8 characters'
                        if (!/[a-z]/.test(v) || !/[A-Z]/.test(v)) return 'Use both upper and lower case letters'
                        if (!/\d/.test(v)) return 'Include at least one number'
                        return true
                      }
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                  {addFormPassword.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden flex gap-0.5">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div
                            key={i}
                            className={`flex-1 rounded ${i <= passwordStrength.score ? passwordStrength.color : 'bg-gray-200'}`}
                          />
                        ))}
                      </div>
                      <span className={`text-xs font-medium ${passwordStrength.score <= 1 ? 'text-red-600' : passwordStrength.score <= 3 ? 'text-amber-600' : 'text-green-600'}`}>
                        {passwordStrength.label}
                      </span>
                    </div>
                  )}
                  {errorsAdd.password && <p className="text-red-500 text-xs mt-0.5">{errorsAdd.password.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Role *</label>
                  <select
                    {...registerAdd('role', { required: 'Role is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  >
                    <option value="">Select role</option>
                    {isOwner(currentUser) && <option value="Owner">Owner</option>}
                    <option value="Admin">Admin</option>
                    <option value="Staff">Staff</option>
                  </select>
                  {errorsAdd.role && <p className="text-red-500 text-xs mt-0.5">{errorsAdd.role.message}</p>}
                  {addFormRole === 'Owner' && (
                    <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-800">
                        <strong>Co-owner:</strong> This user will have full access, including the ability to manage or delete other users and all company data. Only create another Owner if you intend a co-owner.
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Phone</label>
                  <input
                    type="text"
                    {...registerAdd('phone')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </>
            )}
            {userModalTab === 'access' && (
              <DashboardAccessControl
                selectedPermissions={selectedPermissions}
                onToggle={togglePermission}
                onSelectAll={selectAllPermissions}
                onClearAll={clearAllPermissions}
              />
            )}
            {userModalTab === 'assignments' && (
              <UserAssignments
                branches={branches}
                routes={routes}
                assignedBranches={assignedBranches}
                assignedRoutes={assignedRoutes}
                setAssignedBranches={setAssignedBranches}
                setAssignedRoutes={setAssignedRoutes}
              />
            )}
            {userModalTab === 'pageAccess' && (
              <PageAccessControl
                selectedPageAccess={selectedPageAccess}
                onToggle={togglePageAccess}
                onSelectAll={selectAllPageAccess}
                onClearAll={clearAllPageAccess}
              />
            )}
          </div>
          <div className="flex justify-end space-x-2 pt-3 mt-3 border-t border-gray-200 shrink-0">
            <button
              type="button"
              onClick={() => { setShowAddModal(false); resetAdd(); }}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
              disabled={loadingAction}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              disabled={loadingAction}
            >
              {loadingAction ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal - tabbed */}
      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false)
          resetEdit()
          setSelectedUser(null)
        }}
        title="Edit User"
      >
        <form onSubmit={handleSubmitEdit(handleUpdateUser)} className="flex flex-col max-h-[85vh]">
          <div className="flex border-b border-gray-200 mb-3">
            <button
              type="button"
              onClick={() => setUserModalTab('details')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${userModalTab === 'details' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => setUserModalTab('access')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${userModalTab === 'access' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Dashboard access
            </button>
            <button
              type="button"
              onClick={() => setUserModalTab('assignments')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${userModalTab === 'assignments' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Assignments
            </button>
            <button
              type="button"
              onClick={() => setUserModalTab('pageAccess')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${userModalTab === 'pageAccess' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Page access
            </button>
          </div>
          <div className="overflow-y-auto min-h-0 flex-1 space-y-3">
            {userModalTab === 'details' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Name *</label>
                  <input
                    type="text"
                    {...registerEdit('name', { required: 'Name is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                  {errorsEdit.name && <p className="text-red-500 text-xs mt-0.5">{errorsEdit.name.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Email</label>
                  <input
                    type="email"
                    value={selectedUser?.email || ''}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 cursor-not-allowed text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-0.5">Email cannot be changed</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Role *</label>
                  <select
                    {...registerEdit('role', { required: 'Role is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  >
                    <option value="">Select role</option>
                    {isOwner(currentUser) && <option value="Owner">Owner</option>}
                    <option value="Admin">Admin</option>
                    <option value="Staff">Staff</option>
                  </select>
                  {errorsEdit.role && <p className="text-red-500 text-xs mt-0.5">{errorsEdit.role.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-0.5">Phone</label>
                  <input
                    type="text"
                    {...registerEdit('phone')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </>
            )}
            {userModalTab === 'access' && (
              <DashboardAccessControl
                selectedPermissions={selectedPermissions}
                onToggle={togglePermission}
                onSelectAll={selectAllPermissions}
                onClearAll={clearAllPermissions}
              />
            )}
            {userModalTab === 'assignments' && (
              <UserAssignments
                branches={branches}
                routes={routes}
                assignedBranches={assignedBranches}
                assignedRoutes={assignedRoutes}
                setAssignedBranches={setAssignedBranches}
                setAssignedRoutes={setAssignedRoutes}
              />
            )}
            {userModalTab === 'pageAccess' && (
              <PageAccessControl
                selectedPageAccess={selectedPageAccess}
                onToggle={togglePageAccess}
                onSelectAll={selectAllPageAccess}
                onClearAll={clearAllPageAccess}
              />
            )}
          </div>
          <div className="flex justify-end space-x-2 pt-3 mt-3 border-t border-gray-200 shrink-0">
            <button
              type="button"
              onClick={() => { setShowEditModal(false); resetEdit(); setSelectedUser(null); }}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
              disabled={loadingAction}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              disabled={loadingAction}
            >
              {loadingAction ? 'Updating...' : 'Update User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={showPasswordModal}
        onClose={() => {
          setShowPasswordModal(false)
          resetPassword()
          setSelectedUser(null)
        }}
        title="Reset Password"
      >
        <form onSubmit={handleSubmitPassword(handleResetPassword)} className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-gray-700">
              Reset password for <strong>{selectedUser?.name}</strong> ({selectedUser?.email})
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password *</label>
            <input
              type="password"
              {...registerPassword('newPassword', {
                required: 'Password is required',
                minLength: { value: 6, message: 'Password must be at least 6 characters' }
              })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {errorsPassword.newPassword && <p className="text-red-500 text-xs mt-1">{errorsPassword.newPassword.message}</p>}
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowPasswordModal(false)
                resetPassword()
                setSelectedUser(null)
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
              disabled={loadingAction}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition"
              disabled={loadingAction}
            >
              {loadingAction ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDangerModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={performDeleteUser}
        title="Delete user"
        message={userToDelete ? `Are you sure you want to delete ${userToDelete.name}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        requireTypedText="DELETE"
      />
    </div>
  )
}

export default UsersPage


