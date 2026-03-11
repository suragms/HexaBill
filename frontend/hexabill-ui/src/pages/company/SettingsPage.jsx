import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import {
  Upload,
  Save,
  Building2,
  DollarSign,
  Globe,
  Image,
  Trash2,
  Eye,
  Download,
  Database,
  RefreshCw,
  Trash,
  HardDrive,
  FolderDown,
  Shield,
  History,
  RotateCcw
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Input, Select, TextArea } from '../../components/Form'
import { LoadingButton } from '../../components/Loading'
import Modal from '../../components/Modal'
import { LoadingCard } from '../../components/Loading'
import { TabNavigation } from '../../components/ui'
import { adminAPI, settingsAPI } from '../../services'
import api from '../../services/api'
import { clearAllCache, clearCache } from '../../services/api'
import { getApiBaseUrlNoSuffix } from '../../services/apiConfig'
import toast from 'react-hot-toast'
import { showToast } from '../../utils/toast'
import { isAdminOrOwner } from '../../utils/roles'  // CRITICAL: Multi-tenant role checking
import { useBranding } from '../../contexts/TenantBrandingContext'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'

const SettingsPage = () => {
  const { user } = useAuth()
  const { refresh: refreshBranding } = useBranding()
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logoPreview, setLogoPreview] = useState(null)
  const [showLogoModal, setShowLogoModal] = useState(false)
  const [backups, setBackups] = useState([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [activeTab, setActiveTab] = useState(location.state?.tab === 'backup' ? 'backup' : 'company')
  const [showClearDataModal, setShowClearDataModal] = useState(false)
  const [clearDataConfirmation, setClearDataConfirmation] = useState('')
  const [clearDataCheckbox, setClearDataCheckbox] = useState(false)
  const [loadingClearData, setLoadingClearData] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [showTemplatePreview, setShowTemplatePreview] = useState(false)
  const [logoBlobUrl, setLogoBlobUrl] = useState(null)
  const [showInvoicePreview, setShowInvoicePreview] = useState(false)
  const [logoLoadFailed, setLogoLoadFailed] = useState(false)
  const [settings, setSettings] = useState({
    companyNameEn: 'HexaBill',
    companyNameAr: 'هيكسابيل',
    companyTrn: '',
    companyAddress: '',
    companyPhone: '',
    companyEmail: '',
    defaultCurrency: 'AED',
    vatPercentage: 5,
    invoiceTemplate: '',
    logoUrl: '',
    cloudBackupEnabled: false,
    cloudBackupClientId: '',
    cloudBackupClientSecret: '',
    cloudBackupRefreshToken: '',
    cloudBackupFolderId: '',
    lowStockGlobalThreshold: '', // #55: optional global fallback when product ReorderLevel is 0
    returnPolicyHeader: '',
    returnPolicyBody: '',
    returnPolicyFooter: '',
    returnBillTitle: 'SALES RETURN NOTE'
  })

  const [dangerModal, setDangerModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    onConfirm: () => { }
  })

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty }
  } = useForm({
    defaultValues: settings
  })

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [initialSettings, setInitialSettings] = useState(null)

  const currencyOptions = [
    { value: 'AED', label: 'AED - UAE Dirham' },
    { value: 'INR', label: 'INR - Indian Rupee' },
    { value: 'USD', label: 'USD - US Dollar' },
    { value: 'EUR', label: 'EUR - Euro' }
  ]

  useEffect(() => {
    if (location.state?.tab === 'backup') setActiveTab('backup')
  }, [location.state?.tab])

  // Track unsaved changes
  useEffect(() => {
    const subscription = watch((value, { name, type }) => {
      if (type === 'change' && initialSettings) {
        const hasChanges = JSON.stringify(value) !== JSON.stringify(initialSettings)
        setHasUnsavedChanges(hasChanges)
      }
    })
    return () => subscription.unsubscribe()
  }, [watch, initialSettings])

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
        return e.returnValue
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    fetchSettings()
    if (isAdminOrOwner(user)) {
      fetchBackups()
    }

    // Update app icon on mount if logo exists
    const updateIconOnMount = async () => {
      try {
        const response = await adminAPI.getSettings()
        if (response.success) {
          // Canonical key: COMPANY_LOGO; fallbacks for legacy data
          const logoUrl = response.data.COMPANY_LOGO ||
            response.data.LOGO_URL ||
            response.data.company_logo ||
            response.data.logoUrl ||
            ''
          if (logoUrl) {
            await updateAppIcon(logoUrl)
          }
        }
      } catch (error) {
        console.error('Error loading logo for icon:', error)
      }
    }
    updateIconOnMount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load logo as blob when URL is /api/storage/... (requires auth)
  const logoBlobUrlRef = useRef(null)
  useEffect(() => {
    const url = settings.logoUrl
    if (!url || !url.includes('/api/storage/')) {
      if (logoBlobUrlRef.current) {
        URL.revokeObjectURL(logoBlobUrlRef.current)
        logoBlobUrlRef.current = null
        setLogoBlobUrl(null)
      }
      return
    }
    const path = url.replace(/^\/api\/?/, '')
    api.get(path, { responseType: 'blob' })
      .then((res) => {
        const blob = res.data
        if (blob && blob.size > 0) {
          if (logoBlobUrlRef.current) URL.revokeObjectURL(logoBlobUrlRef.current)
          const objectUrl = URL.createObjectURL(blob)
          logoBlobUrlRef.current = objectUrl
          setLogoBlobUrl(objectUrl)
        }
      })
      .catch(() => setLogoBlobUrl(null))
    return () => {
      if (logoBlobUrlRef.current) {
        URL.revokeObjectURL(logoBlobUrlRef.current)
        logoBlobUrlRef.current = null
      }
    }
  }, [settings.logoUrl])

  // Reset logo-not-found when URL or preview changes
  useEffect(() => {
    setLogoLoadFailed(false)
  }, [settings.logoUrl, logoPreview])

  const fetchBackups = async () => {
    try {
      setLoadingBackups(true)
      const response = await adminAPI.getBackups()
      if (response.success) {
        setBackups(response.data || [])
      }
    } catch (error) {
      console.error('Failed to load backups:', error)
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleCreateBackup = async () => {
    try {
      setLoadingBackups(true)
      const response = await adminAPI.createBackup()
      if (response.success) {
        toast.success('Backup created successfully!')
        await fetchBackups()
      } else {
        toast.error(response.message || 'Failed to create backup')
      }
    } catch (error) {
      if (!error?._handledByInterceptor) toast.error('Failed to create backup')
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleCreateFullBackup = async (exportToDesktop = false) => {
    try {
      setLoadingBackups(true)
      const response = await adminAPI.createFullBackup(exportToDesktop)
      if (response.success) {
        toast.success(exportToDesktop
          ? 'Full backup created and exported to Desktop!'
          : 'Full backup created successfully!')
        await fetchBackups()
      } else {
        toast.error(response.message || 'Failed to create full backup')
      }
    } catch (error) {
      toast.error('Failed to create full backup')
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleDownloadBackup = async (fileName) => {
    try {
      const blob = await adminAPI.downloadBackup(fileName)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Backup downloaded')
    } catch (error) {
      if (!error?._handledByInterceptor) toast.error('Failed to download backup')
    }
  }

  const handleDeleteBackup = (fileName) => {
    setDangerModal({
      isOpen: true,
      title: 'Delete Backup?',
      message: `Are you sure you want to delete ${fileName}? This action cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          const response = await adminAPI.deleteBackup(fileName)
          if (response.success) {
            toast.success('Backup deleted')
            await fetchBackups()
          } else {
            toast.error(response.message || 'Failed to delete backup')
          }
        } catch (error) {
          if (!error?._handledByInterceptor) toast.error('Failed to delete backup')
        }
      }
    })
  }

  const handleRestoreBackup = (fileName) => {
    setDangerModal({
      isOpen: true,
      title: 'Restore Database?',
      message: `This will restore the database from ${fileName}. All CURRENT transactional data will be replaced. This action cannot be reversed.`,
      confirmLabel: 'Restore Now',
      onConfirm: async () => {
        try {
          const response = await adminAPI.restoreBackup(fileName)
          if (response.success) {
            toast.success('Backup restored successfully! Refreshing data...')
            await fetchSettings()
            await fetchBackups()
            setTimeout(() => {
              navigate(0)
            }, 1000)
          } else {
            toast.error(response.message || 'Failed to restore backup')
          }
        } catch (error) {
          if (!error?._handledByInterceptor) toast.error('Failed to restore backup')
        }
      }
    })
  }

  const handleClearAllData = async () => {
    if (!clearDataCheckbox || clearDataConfirmation.trim().toUpperCase() !== 'CLEAR') {
      toast.error('Check the box and type CLEAR to confirm')
      return
    }
    try {
      setLoadingClearData(true)
      const response = await settingsAPI.clearData()
      if (response?.success) {
        toast.success(response.message || 'All transactional data has been cleared.')
        setShowClearDataModal(false)
        setClearDataConfirmation('')
        setClearDataCheckbox(false)
        setTimeout(() => navigate(0), 1500)
      } else {
        toast.error(response?.message || 'Failed to clear data')
      }
    } catch (error) {
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to clear data')
    } finally {
      setLoadingClearData(false)
    }
  }

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getSettings()
      if (response.success && response.data) {
        // Map backend keys to frontend keys. Canonical logo key: COMPANY_LOGO (backend sets it on upload).
        const logoUrl = response.data.COMPANY_LOGO ||
          response.data.COMPANY_LOGO_URL ||
          response.data.company_logo ||
          response.data.logoUrl ||
          ''

        const mappedSettings = {
          companyNameEn: response.data.COMPANY_NAME_EN || response.data.companyNameEn || '',
          companyNameAr: response.data.COMPANY_NAME_AR || response.data.companyNameAr || '',
          companyTrn: response.data.COMPANY_TRN || response.data.companyTrn || '',
          companyAddress: response.data.COMPANY_ADDRESS || response.data.companyAddress || '',
          companyPhone: response.data.COMPANY_PHONE || response.data.companyPhone || '',
          companyEmail: response.data.COMPANY_EMAIL || response.data.companyEmail || '',
          defaultCurrency: response.data.CURRENCY || response.data.defaultCurrency || 'AED',
          vatPercentage: parseFloat(response.data.VAT_PERCENT || response.data.vatPercentage || '5'),
          invoiceTemplate: response.data.INVOICE_TEMPLATE || response.data.invoiceTemplate || '',
          logoUrl: logoUrl,
          cloudBackupEnabled: response.data.CLOUD_BACKUP_ENABLED === 'true' || response.data.cloudBackupEnabled === true,
          cloudBackupClientId: response.data.CLOUD_BACKUP_CLIENT_ID || response.data.cloudBackupClientId || '',
          cloudBackupClientSecret: response.data.CLOUD_BACKUP_CLIENT_SECRET || response.data.cloudBackupClientSecret || '',
          cloudBackupRefreshToken: response.data.CLOUD_BACKUP_REFRESH_TOKEN || response.data.cloudBackupRefreshToken || '',
          cloudBackupFolderId: response.data.CLOUD_BACKUP_FOLDER_ID || response.data.cloudBackupFolderId || '',
          lowStockGlobalThreshold: response.data.LOW_STOCK_GLOBAL_THRESHOLD ?? response.data.lowStockGlobalThreshold ?? '',
          returnPolicyHeader: response.data.RETURN_POLICY_HEADER ?? response.data.returnPolicyHeader ?? '',
          returnPolicyBody: response.data.RETURN_POLICY_BODY ?? response.data.returnPolicyBody ?? '',
          returnPolicyFooter: response.data.RETURN_POLICY_FOOTER ?? response.data.returnPolicyFooter ?? '',
          returnBillTitle: response.data.RETURN_BILL_TITLE ?? response.data.returnBillTitle ?? 'SALES RETURN NOTE'
        }
        setSettings(mappedSettings)
        setInitialSettings(JSON.parse(JSON.stringify(mappedSettings))) // Deep copy for comparison
        // Set form values
        Object.keys(mappedSettings).forEach(key => {
          setValue(key, mappedSettings[key], { shouldDirty: false })
        })
        setHasUnsavedChanges(false)
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
      if (!error?._handledByInterceptor) toast.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = async (data) => {
    try {
      setSaving(true)
      // Map frontend keys to backend keys
      const backendSettings = {
        COMPANY_NAME_EN: data.companyNameEn || '',
        COMPANY_NAME_AR: data.companyNameAr || '',
        COMPANY_TRN: data.companyTrn || '',
        COMPANY_ADDRESS: data.companyAddress || '',
        COMPANY_PHONE: data.companyPhone || '',
        COMPANY_EMAIL: data.companyEmail || '',
        CURRENCY: data.defaultCurrency || 'AED',
        VAT_PERCENT: data.vatPercentage?.toString() || '5',
        INVOICE_TEMPLATE: data.invoiceTemplate || '',
        CLOUD_BACKUP_ENABLED: data.cloudBackupEnabled?.toString() || 'false',
        CLOUD_BACKUP_CLIENT_ID: data.cloudBackupClientId || '',
        CLOUD_BACKUP_CLIENT_SECRET: data.cloudBackupClientSecret || '',
        CLOUD_BACKUP_REFRESH_TOKEN: data.cloudBackupRefreshToken || '',
        CLOUD_BACKUP_FOLDER_ID: data.cloudBackupFolderId || '',
        LOW_STOCK_GLOBAL_THRESHOLD: (data.lowStockGlobalThreshold !== undefined && data.lowStockGlobalThreshold !== null && String(data.lowStockGlobalThreshold).trim() !== '') ? String(data.lowStockGlobalThreshold).trim() : '',
        RETURN_POLICY_HEADER: data.returnPolicyHeader ?? '',
        RETURN_POLICY_BODY: data.returnPolicyBody ?? '',
        RETURN_POLICY_FOOTER: data.returnPolicyFooter ?? '',
        RETURN_BILL_TITLE: (data.returnBillTitle && data.returnBillTitle.trim() !== '') ? data.returnBillTitle.trim() : 'SALES RETURN NOTE'
      }

      // Only include logoUrl if it's set
      if (data.logoUrl) {
        backendSettings.COMPANY_LOGO = data.logoUrl
      }

      const response = await adminAPI.updateSettings(backendSettings)
      if (response.success) {
        clearAllCache()
        // Explicit cache clearing for settings endpoints
        clearCache('/api/settings')
        clearCache('/api/settings/company')
        setSettings(data)
        setInitialSettings(JSON.parse(JSON.stringify(data))) // Update initial state
        setHasUnsavedChanges(false)
        // Reset form dirty state
        Object.keys(data).forEach(key => {
          setValue(key, data[key], { shouldDirty: false })
        })
        // Refresh branding with delay to ensure server has processed
        await refreshBranding()
        setTimeout(async () => {
          await refreshBranding()
          window.dispatchEvent(new Event('logo-updated'))
        }, 500)
        toast.success('Settings saved successfully!', { id: 'settings-save' })
      } else {
        toast.error(response.message || 'Failed to save settings')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      if (!error?._handledByInterceptor) {
        const msg = error?.response?.data?.message || error?.response?.data?.errors?.[0] || error?.message || 'Failed to save settings'
        toast.error(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    // Allowed: PNG, JPG, WEBP only (no SVG/GIF for security)
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload PNG, JPG or WEBP only.')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB.')
      return
    }

    try {
      setUploadingLogo(true)
      setSaving(true)

      const reader = new FileReader()
      reader.onload = (e) => setLogoPreview(e.target.result)
      reader.readAsDataURL(file)

      const response = await adminAPI.uploadLogo(file)
      if (response?.success) {
        const logoUrl = response.data?.logoUrl ?? response.data?.data?.logoUrl ?? response.data ?? ''
        clearAllCache()
        clearCache('/api/settings')
        clearCache('/api/settings/company')
        setSettings(prev => ({ ...prev, logoUrl }))
        setValue('logoUrl', logoUrl)
        await updateAppIcon(logoUrl)
        setSettings(prev => ({ ...prev, logoUrl }))
        setValue('logoUrl', logoUrl, { shouldDirty: true })
        setHasUnsavedChanges(true)
        await refreshBranding()
        setTimeout(() => { window.dispatchEvent(new Event('logo-updated')) }, 300)
        toast.success('Logo uploaded successfully.', { id: 'logo-upload' })
        setShowLogoModal(false)
        await fetchSettings()
      } else {
        toast.error(response?.message || 'Failed to upload logo')
      }
    } catch (error) {
      console.error('Logo upload error:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to upload logo')
    } finally {
      setUploadingLogo(false)
      setSaving(false)
    }
  }

  const handleLogoDelete = async () => {
    try {
      setSaving(true)
      const response = await adminAPI.deleteLogo()
      if (response?.success) {
        setLogoPreview(null)
        setLogoBlobUrl(null)
        setSettings(prev => ({ ...prev, logoUrl: '' }))
        setValue('logoUrl', '')
        await updateAppIcon('/vite.svg')
        await refreshBranding()
        toast.success('Logo removed.')
        await fetchSettings()
      } else {
        toast.error(response?.message || 'Failed to delete logo')
      }
    } catch (error) {
      console.error('Logo delete error:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to delete logo')
    } finally {
      setSaving(false)
    }
  }

  // Update app icon and manifest when logo changes
  const updateAppIcon = async (logoUrl) => {
    try {
      // Get full URL for logo
      const apiBaseUrl = getApiBaseUrlNoSuffix()
      const fullLogoUrl = logoUrl.startsWith('http') ? logoUrl : `${apiBaseUrl}${logoUrl.startsWith('/') ? '' : '/'}${logoUrl}`

      // Update favicon in document
      const favicon = document.querySelector("link[rel='icon']") || document.createElement('link')
      favicon.rel = 'icon'
      favicon.type = logoUrl.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
      favicon.href = fullLogoUrl
      if (!document.querySelector("link[rel='icon']")) {
        document.head.appendChild(favicon)
      }

      // Update apple-touch-icon for iOS
      let appleIcon = document.querySelector("link[rel='apple-touch-icon']")
      if (!appleIcon) {
        appleIcon = document.createElement('link')
        appleIcon.rel = 'apple-touch-icon'
        document.head.appendChild(appleIcon)
      }
      appleIcon.href = fullLogoUrl

      // Update manifest.webmanifest dynamically
      const manifestLink = document.querySelector("link[rel='manifest']")
      if (manifestLink) {
        try {
          const manifestResponse = await fetch('/manifest.webmanifest')
          const manifest = await manifestResponse.json()

          // Update icons in manifest
          manifest.icons = [
            {
              src: fullLogoUrl,
              sizes: "192x192",
              type: "image/png"
            },
            {
              src: fullLogoUrl,
              sizes: "512x512",
              type: "image/png"
            },
            {
              src: fullLogoUrl,
              sizes: "any",
              type: logoUrl.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
            }
          ]

          // Update manifest file (this requires backend support or we store in localStorage)
          // For now, we'll update the link to force refresh
          manifestLink.href = `/manifest.webmanifest?t=${Date.now()}`

          // Store manifest in localStorage for dynamic updates
          localStorage.setItem('appManifest', JSON.stringify(manifest))
        } catch (err) {
          console.warn('Could not update manifest:', err)
        }
      }

      console.log('✅ App icon updated successfully')
    } catch (error) {
      console.error('Error updating app icon:', error)
    }
  }

  if (loading) {
    return <LoadingCard message="Loading settings..." />
  }

  const tabs = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'billing', label: 'Billing', icon: DollarSign },
    { id: 'email', label: 'Email', icon: Globe },
    { id: 'notifications', label: 'Notifications', icon: Shield },
    ...(isAdminOrOwner(user) ? [{ id: 'backup', label: 'Backup', icon: Database }] : [])
  ]

  const renderTemplatePreview = (templateHtml) => {
    if (!templateHtml) return '<p class="text-neutral-500">No template defined</p>'
    
    // Sample data for preview
    const sampleData = {
      company_name_en: settings.companyNameEn || 'HexaBill',
      company_name_ar: settings.companyNameAr || 'هيكسابيل',
      company_address: settings.companyAddress || 'Abu Dhabi, UAE',
      company_phone: settings.companyPhone || '+971 56 955 22 52',
      company_trn: settings.companyTrn || '105274438800003',
      currency: settings.defaultCurrency || 'AED',
      invoice_no: 'INV-2026-001',
      invoiceNo: 'INV-2026-001',
      INVOICE_NO: 'INV-2026-001',
      date: new Date().toLocaleDateString('en-GB'),
      DATE: new Date().toLocaleDateString('en-GB'),
      customer_name: 'Sample Customer',
      CUSTOMER_NAME: 'Sample Customer',
      customer_trn: '123456789012345',
      CUSTOMER_TRN: '123456789012345',
      subtotal: '1,000.00',
      SUBTOTAL: '1,000.00',
      vat_amount: '50.00',
      VAT_AMOUNT: '50.00',
      vat_total: '50.00',
      VAT_TOTAL: '50.00',
      grand_total: '1,050.00',
      GRAND_TOTAL: '1,050.00',
      amount_in_words: 'One Thousand and Fifty Dirhams Only',
      items: `
        <tr>
          <td class="center">1</td>
          <td>Sample Product 1</td>
          <td class="center">10</td>
          <td class="center">PCS</td>
          <td class="right">50.00</td>
          <td class="right">500.00</td>
          <td class="right"><strong>525.00</strong><br/><span style="font-size:7pt;color:#666;">(+25.00 VAT)</span></td>
        </tr>
        <tr>
          <td class="center">2</td>
          <td>Sample Product 2</td>
          <td class="center">5</td>
          <td class="center">BOX</td>
          <td class="right">100.00</td>
          <td class="right">500.00</td>
          <td class="right"><strong>525.00</strong><br/><span style="font-size:7pt;color:#666;">(+25.00 VAT)</span></td>
        </tr>
      `
    }

    // Replace all placeholders
    let preview = templateHtml
    Object.keys(sampleData).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'gi')
      preview = preview.replace(regex, sampleData[key])
    })

    return preview
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600">Manage your company settings and preferences</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          {hasUnsavedChanges && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-600 font-medium">● Unsaved changes</span>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md shadow-sm text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
          <button 
            type="button"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Settings
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <TabNavigation tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Company Tab */}
        {activeTab === 'company' && (
          <>
            {/* Company Information */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center mb-6">
                <Building2 className="h-6 w-6 text-primary-600 mr-3" />
                <h2 className="text-lg font-semibold text-neutral-900">Company Information</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                  label="Company Name (English)"
                  placeholder="HexaBill"
                  required
                  error={errors.companyNameEn?.message}
                  {...register('companyNameEn', { required: 'Company name is required' })}
                />

                <Input
                  label="Company Name (Arabic)"
                  placeholder="ستار بلس لتجارة المواد الغذائية"
                  error={errors.companyNameAr?.message}
                  {...register('companyNameAr')}
                />

                <Input
                  label="TRN Number"
                  placeholder="TRN123456789"
                  error={errors.companyTrn?.message}
                  {...register('companyTrn')}
                />

                <Input
                  label="Phone Number"
                  placeholder="+971 4 123 4567"
                  error={errors.companyPhone?.message}
                  {...register('companyPhone')}
                />

                <Input
                  label="Email Address"
                  type="email"
                  placeholder="info@hexabill.com"
                  error={errors.companyEmail?.message}
                  {...register('companyEmail')}
                />

                <div className="md:col-span-2">
                  <TextArea
                    label="Address"
                    placeholder="Dubai, UAE"
                    rows={3}
                    error={errors.companyAddress?.message}
                    {...register('companyAddress')}
                  />
                </div>
              </div>
            </div>

            {/* Logo Upload */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center mb-6">
                <Image className="h-6 w-6 text-primary-600 mr-3" />
                <h2 className="text-lg font-semibold text-neutral-900">Company Logo</h2>
              </div>

              <div className="flex items-center space-x-6">
                {/* Logo Preview */}
                <div className="flex-shrink-0">
                  {logoPreview || logoBlobUrl || (settings.logoUrl && !settings.logoUrl.includes('/api/storage/') && !settings.logoUrl.includes('storage/tenants/')) ? (
                    <div className="relative">
                      <img
                        src={logoPreview || logoBlobUrl || (settings.logoUrl?.startsWith('http') ? settings.logoUrl : `${getApiBaseUrlNoSuffix()}${settings.logoUrl?.startsWith('/') ? '' : '/'}${settings.logoUrl}`)}
                        alt="Company Logo"
                        className="h-24 w-24 object-contain border border-gray-200 rounded-lg"
                        onError={(e) => {
                          e.target.style.display = 'none'
                          if (settings.logoUrl && !logoPreview) setLogoLoadFailed(true)
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleLogoDelete}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="h-24 w-24 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center">
                      <Image className="h-8 w-8 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* Upload Controls */}
                <div className="flex-1">
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowLogoModal(true)}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {logoPreview || settings.logoUrl ? 'Change Logo' : 'Upload Logo'}
                    </button>
                    {(logoPreview || settings.logoUrl) && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowInvoicePreview(true)}
                          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 ml-2"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Preview on Invoice
                        </button>
                      </>
                    )}

                    {logoLoadFailed && (
                      <p className="text-sm text-amber-600">
                        Logo not found. Please re-upload.
                      </p>
                    )}
                    <p className="text-sm text-gray-500">
                      PNG, JPG, WEBP — Max 5MB. Your logo appears on all invoices and documents.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Return Template (Print template for return bill) */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center mb-6">
                <RotateCcw className="h-6 w-6 text-primary-600 mr-3" />
                <h2 className="text-lg font-semibold text-neutral-900">Return Template</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">Print template for the sales return bill PDF. Set the document title and return policy text. Header and footer appear at the top and bottom of the return document.</p>
              <div className="space-y-4">
                <Input
                  label="Return document title"
                  placeholder="SALES RETURN NOTE"
                  error={errors.returnBillTitle?.message}
                  {...register('returnBillTitle')}
                />
                <p className="text-xs text-neutral-500 -mt-2">Title shown on the return bill PDF (e.g. SALES RETURN NOTE or RETURN BILL).</p>
                <TextArea
                  label="Return Policy Header"
                  placeholder="Returns accepted within 7 days of purchase. Contact support for returns."
                  rows={2}
                  error={errors.returnPolicyHeader?.message}
                  {...register('returnPolicyHeader')}
                />
                <TextArea
                  label="Return Policy Body"
                  placeholder="Items must be returned in original packaging. Damaged or used items may not be eligible for return. Refunds are processed within 5-7 business days."
                  rows={4}
                  error={errors.returnPolicyBody?.message}
                  {...register('returnPolicyBody')}
                />
                <TextArea
                  label="Return Policy Footer"
                  placeholder="For questions about returns, contact us at support@company.com"
                  rows={2}
                  error={errors.returnPolicyFooter?.message}
                  {...register('returnPolicyFooter')}
                />
              </div>
            </div>
          </>
        )}

        {/* Billing Tab */}
        {activeTab === 'billing' && (
          <>
            {/* Business Settings */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center mb-6">
                <DollarSign className="h-6 w-6 text-primary-600 mr-3" />
                <h2 className="text-lg font-semibold text-neutral-900">Business Settings</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Select
                    label="Default Currency"
                    options={currencyOptions}
                    error={errors.defaultCurrency?.message}
                    {...register('defaultCurrency', { required: 'Default currency is required' })}
                  />
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ Changing currency only updates the label. Historical invoices will still show original amounts. Currency conversion is not supported.
                  </p>
                </div>

                <Input
                  label="VAT Percentage"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="5"
                  error={errors.vatPercentage?.message}
                  {...register('vatPercentage', {
                    required: 'VAT percentage is required',
                    min: { value: 0, message: 'VAT must be 0 or greater' },
                    max: { value: 100, message: 'VAT must be 100 or less' }
                  })}
                />
                <Input
                  label="Low stock global threshold (optional)"
                  type="number"
                  min={0}
                  placeholder="e.g. 10"
                  error={errors.lowStockGlobalThreshold?.message}
                  {...register('lowStockGlobalThreshold', {
                    min: { value: 0, message: 'Must be 0 or greater' }
                  })}
                />
                <p className="text-xs text-neutral-500">
                  When set, products with reorder level 0 are treated as low stock when quantity is at or below this value. Leave empty to use only each product&apos;s reorder level.
                </p>
              </div>
            </div>

            {/* Invoice Template */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center mb-6">
                <Globe className="h-6 w-6 text-primary-600 mr-3" />
                <h2 className="text-lg font-semibold text-neutral-900">Invoice Template</h2>
              </div>

              <div className="space-y-4">
                <TextArea
                  label="Custom Invoice Template (HTML)"
                  placeholder="Enter custom HTML template for invoices..."
                  rows={8}
                  error={errors.invoiceTemplate?.message}
                  {...register('invoiceTemplate')}
                />

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowTemplatePreview(!showTemplatePreview)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    {showTemplatePreview ? 'Hide Preview' : 'Preview Template'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setValue('invoiceTemplate', '')
                      showToast.info('Template reset to default')
                    }}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Reset to Default
                  </button>
                </div>

                {showTemplatePreview && (
                  <div className="mt-4 border border-neutral-200 rounded-lg p-4 bg-neutral-50">
                    <h3 className="text-sm font-semibold text-neutral-700 mb-2">Template Preview (with sample data)</h3>
                    <div 
                      className="bg-white border border-neutral-300 rounded p-4 max-h-96 overflow-auto"
                      dangerouslySetInnerHTML={{ __html: renderTemplatePreview(watch('invoiceTemplate')) }}
                    />
                    <p className="text-xs text-neutral-500 mt-2">
                      This preview shows how your template will look with sample invoice data. Actual invoices will use real customer and product data.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Email Settings Tab */}
        {activeTab === 'email' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-6">
              <Globe className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-lg font-semibold text-neutral-900">Email Settings</h2>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-neutral-600 mb-4">
                Configure SMTP settings to enable email notifications and invoice delivery.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-800">
                  <strong>Note:</strong> Email functionality is not yet implemented. This feature will allow you to:
                </p>
                <ul className="list-disc list-inside text-sm text-amber-700 mt-2 space-y-1">
                  <li>Send invoices to customers via email</li>
                  <li>Receive payment reminders and notifications</li>
                  <li>Configure SMTP server settings (Gmail, Outlook, custom SMTP)</li>
                  <li>Set up email templates for automated communications</li>
                </ul>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="SMTP Server"
                  placeholder="smtp.gmail.com"
                  disabled
                  className="opacity-60"
                />
                <Input
                  label="SMTP Port"
                  type="number"
                  placeholder="587"
                  disabled
                  className="opacity-60"
                />
                <Input
                  label="Email Address"
                  type="email"
                  placeholder="your-email@example.com"
                  disabled
                  className="opacity-60"
                />
                <Input
                  label="Password/App Password"
                  type="password"
                  placeholder="••••••••"
                  disabled
                  className="opacity-60"
                />
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="enableEmail"
                  disabled
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded opacity-60"
                />
                <label htmlFor="enableEmail" className="ml-2 block text-sm text-gray-500">
                  Enable email notifications (Coming soon)
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Notification Settings Tab */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-6">
              <Shield className="h-6 w-6 text-primary-600 mr-3" />
              <h2 className="text-lg font-semibold text-neutral-900">Notification Settings</h2>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-neutral-600 mb-4">
                Configure how and when you receive notifications for important events.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-800">
                  <strong>Note:</strong> Notification settings are not yet implemented. This feature will allow you to:
                </p>
                <ul className="list-disc list-inside text-sm text-amber-700 mt-2 space-y-1">
                  <li>Configure notification channels (Email, SMS, WhatsApp, In-App)</li>
                  <li>Set up alerts for low stock, overdue payments, new orders</li>
                  <li>Customize notification preferences per event type</li>
                  <li>Schedule daily/weekly summary reports</li>
                </ul>
              </div>
              <div className="space-y-4">
                <div className="border border-neutral-200 rounded-lg p-4">
                  <h3 className="text-md font-medium text-neutral-800 mb-3">Payment Reminders</h3>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input type="checkbox" disabled className="h-4 w-4 text-indigo-600 opacity-60" />
                      <span className="ml-2 text-sm text-gray-500">Email notification for overdue payments</span>
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" disabled className="h-4 w-4 text-indigo-600 opacity-60" />
                      <span className="ml-2 text-sm text-gray-500">SMS notification for overdue payments</span>
                    </label>
                  </div>
                </div>
                <div className="border border-neutral-200 rounded-lg p-4">
                  <h3 className="text-md font-medium text-neutral-800 mb-3">Inventory Alerts</h3>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input type="checkbox" disabled className="h-4 w-4 text-indigo-600 opacity-60" />
                      <span className="ml-2 text-sm text-gray-500">Alert when product stock is low</span>
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" disabled className="h-4 w-4 text-indigo-600 opacity-60" />
                      <span className="ml-2 text-sm text-gray-500">Daily inventory summary</span>
                    </label>
                  </div>
                </div>
                <div className="border border-neutral-200 rounded-lg p-4">
                  <h3 className="text-md font-medium text-neutral-800 mb-3">Sales & Orders</h3>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input type="checkbox" disabled className="h-4 w-4 text-indigo-600 opacity-60" />
                      <span className="ml-2 text-sm text-gray-500">Notify on new orders</span>
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" disabled className="h-4 w-4 text-indigo-600 opacity-60" />
                      <span className="ml-2 text-sm text-gray-500">Weekly sales report</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Backup Tab */}
        {activeTab === 'backup' && isAdminOrOwner(user) && (
          <>
            {/* Cloud Backup Settings */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center mb-6">
                <Globe className="h-6 w-6 text-purple-600 mr-3" />
                <h2 className="text-lg font-semibold text-neutral-900">Cloud Backup Settings</h2>
              </div>

              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="cloudBackupEnabled"
                    {...register('cloudBackupEnabled')}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <label htmlFor="cloudBackupEnabled" className="ml-2 block text-sm text-gray-900">
                    Enable Google Drive Cloud Backup
                  </label>
                </div>

                {watch('cloudBackupEnabled') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6 border-l-2 border-purple-200">
                    <Input
                      label="Client ID"
                      type="text"
                      placeholder="your-client-id.apps.googleusercontent.com"
                      error={errors.cloudBackupClientId?.message}
                      {...register('cloudBackupClientId')}
                    />
                    <Input
                      label="Client Secret"
                      type="password"
                      placeholder="your-client-secret"
                      error={errors.cloudBackupClientSecret?.message}
                      {...register('cloudBackupClientSecret')}
                    />
                    <Input
                      label="Refresh Token"
                      type="password"
                      placeholder="your-refresh-token"
                      error={errors.cloudBackupRefreshToken?.message}
                      {...register('cloudBackupRefreshToken')}
                    />
                    <Input
                      label="Folder ID (Optional)"
                      type="text"
                      placeholder="Leave empty for root folder"
                      error={errors.cloudBackupFolderId?.message}
                      {...register('cloudBackupFolderId')}
                    />
                  </div>
                )}

                <p className="text-sm text-gray-500 pl-6">
                  Configure Google Drive OAuth credentials to enable automatic cloud backups.
                  See documentation for setup instructions.
                </p>
              </div>
            </div>

            {/* Platform Backup — full DB/files for system admin */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="mb-6">
                <div className="flex items-center mb-4">
                  <Database className="h-6 w-6 text-indigo-600 mr-3" />
                  <h2 className="text-lg font-semibold text-neutral-900">Platform Backup</h2>
                </div>
                <p className="text-sm text-gray-500 mb-4">Full database and files for system administration. Use &quot;My Data Export&quot; (Backup menu) to export only your company&apos;s data.</p>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCreateBackup}
                    disabled={loadingBackups}
                    className="inline-flex items-center px-4 py-2 border border-indigo-300 rounded-md shadow-sm text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
                    title="Create database backup only"
                  >
                    <Database className="h-4 w-4 mr-2" />
                    {loadingBackups ? 'Creating...' : 'Database Backup'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCreateFullBackup(false)}
                    disabled={loadingBackups}
                    className="inline-flex items-center px-4 py-2 border border-green-300 rounded-md shadow-sm text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50"
                    title="Create FULL backup (database + files)"
                  >
                    <HardDrive className="h-4 w-4 mr-2" />
                    {loadingBackups ? 'Creating...' : 'Full Backup (ZIP)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCreateFullBackup(true)}
                    disabled={loadingBackups}
                    className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
                    title="Create FULL backup and save to Desktop"
                  >
                    <FolderDown className="h-4 w-4 mr-2" />
                    {loadingBackups ? 'Exporting...' : 'Export to Desktop'}
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
                  <span>Available Backups:</span>
                  <button
                    type="button"
                    onClick={fetchBackups}
                    disabled={loadingBackups}
                    className="text-indigo-600 hover:text-indigo-700 disabled:opacity-50 flex items-center"
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${loadingBackups ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {loadingBackups ? (
                  <div className="text-center py-4 text-gray-500">Loading backups...</div>
                ) : backups.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg">
                    No backups found. Create your first backup.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {backups.map((fileName, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{fileName}</p>
                          <p className="text-xs text-gray-500">
                            {fileName.includes('_')
                              ? new Date(fileName.split('_')[1]?.replace('.db', '') || fileName.split('_')[1]?.replace('.sql', '') || '').toLocaleString()
                              : 'Date unknown'}
                          </p>
                        </div>
                        <div className="flex items-center space-x-2 ml-4">
                          <button
                            type="button"
                            onClick={() => handleDownloadBackup(fileName)}
                            className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
                            title="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRestoreBackup(fileName)}
                            className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded"
                            title="Restore"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteBackup(fileName)}
                            className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded"
                            title="Delete"
                          >
                            <Trash className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Clear all data - Owner/Admin only */}
            <div className="mt-8 bg-white rounded-lg border-2 border-red-200 shadow-sm p-6">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-red-900 uppercase tracking-wider">Clear transactional data</h3>
                  <p className="text-sm text-red-700 mt-1">
                    Same as &quot;reset company data&quot;. Wipes sales, purchases, expenses, and returns. Keeps users, products, and customers; resets stock and balances to zero.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setClearDataConfirmation('')
                    setClearDataCheckbox(false)
                    setShowClearDataModal(true)
                  }}
                  className="bg-white text-red-600 border-2 border-red-300 px-6 py-2.5 rounded-xl font-bold hover:bg-red-600 hover:text-white transition-all shadow-sm flex items-center gap-2 flex-shrink-0"
                >
                  <History className="h-5 w-5" />
                  Clear all data
                </button>
              </div>
            </div>
          </>
        )}

        {/* Save Button */}
        <div className="flex justify-end">
          <LoadingButton
            type="submit"
            loading={saving}
            className="px-8 py-3"
          >
            <Save className="h-4 w-4 mr-2" />
            Save Settings
          </LoadingButton>
        </div>
      </form>

      {/* Logo Upload Modal */}
      <Modal
        isOpen={showLogoModal}
        onClose={() => !uploadingLogo && setShowLogoModal(false)}
        title="Upload Company Logo"
        size="md"
      >
        <div className="space-y-6">
          <div className={`border-2 border-dashed rounded-lg p-6 text-center transition ${uploadingLogo ? 'border-blue-400 bg-blue-50/50' : 'border-gray-300'}`}>
            {uploadingLogo ? (
              <div className="flex flex-col items-center justify-center py-2">
                <RefreshCw className="mx-auto h-12 w-12 text-blue-600 animate-spin" />
                <span className="mt-3 block text-sm font-medium text-gray-700">Uploading…</span>
                <span className="mt-1 block text-xs text-gray-500">Logo will appear in header and profile when done.</span>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <div className="mt-4">
                  <label htmlFor="logo-upload" className="cursor-pointer">
                    <span className="mt-2 block text-sm font-medium text-gray-900">Click to upload logo</span>
                    <span className="mt-1 block text-sm text-gray-500">PNG, JPG, WEBP up to 5MB</span>
                  </label>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={handleLogoUpload}
                    className="sr-only"
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowLogoModal(false)}
              disabled={uploadingLogo}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploadingLogo ? 'Uploading…' : 'Cancel'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Invoice preview modal - how logo and company look on invoice */}
      <Modal
        isOpen={showInvoicePreview}
        onClose={() => setShowInvoicePreview(false)}
        title="Preview on Invoice"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">This is how your company header will appear on printed invoices.</p>
          <div className="border-2 border-gray-200 rounded-lg p-4 bg-white">
            <div className="grid grid-cols-[140px_1fr_140px] gap-4 items-center">
              <div className="flex justify-center">
                {(logoPreview || logoBlobUrl || (settings.logoUrl && !settings.logoUrl.includes('/api/storage/') && !settings.logoUrl.includes('storage/tenants/'))) && (
                  <img
                    src={logoPreview || logoBlobUrl || (settings.logoUrl?.startsWith('http') ? settings.logoUrl : `${getApiBaseUrlNoSuffix()}${settings.logoUrl?.startsWith('/') ? '' : '/'}${settings.logoUrl}`)}
                    alt="Company Logo"
                    className="max-w-[140px] max-h-[80px] object-contain"
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                )}
              </div>
              <div className="text-center">
                <h3 className="font-bold text-base uppercase">{settings.companyNameEn || 'Company Name'}</h3>
                {settings.companyNameAr && <p className="text-sm text-gray-700" dir="rtl">{settings.companyNameAr}</p>}
                <p className="text-xs text-gray-500 mt-0.5">Mob: {settings.companyPhone || '—'} {settings.companyAddress && `, ${settings.companyAddress}`}</p>
              </div>
              <div className="text-right text-sm">
                <p>TRN: No : {settings.companyTrn || '—'}</p>
                <p className="mt-1">DATE: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')}</p>
              </div>
            </div>
            <div className="border-t-2 border-b-2 border-gray-300 mt-3 py-2 text-center font-bold text-sm">TAX INVOICE</div>
          </div>
          <p className="text-xs text-gray-500">This is a preview only. Actual invoice uses real transaction data.</p>
          <div className="flex justify-end">
            <button type="button" onClick={() => setShowInvoicePreview(false)} className="px-4 py-2 bg-gray-800 text-white rounded-md text-sm font-medium hover:bg-gray-700">Close</button>
          </div>
        </div>
      </Modal>

      {/* Clear all data modal - serious confirmation */}
      <Modal
        isOpen={showClearDataModal}
        onClose={() => {
          setShowClearDataModal(false)
          setClearDataConfirmation('')
          setClearDataCheckbox(false)
        }}
        title="Danger: Clear all company data"
        size="md"
        closeOnOverlayClick={false}
      >
        <div className="space-y-5 border-2 border-red-600 rounded-xl p-1">
          <div className="bg-red-600 p-4 rounded-xl text-white flex items-start space-x-3">
            <Shield className="h-10 w-10 opacity-80 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-lg leading-tight text-white mb-1">Reset all transactional data</h4>
              <p className="text-sm text-red-100 leading-snug">
                This will permanently delete all sales, purchases, expenses, and returns for your company. Users, products, and customers are kept; stock and balances are set to zero.
              </p>
              <p className="text-sm font-bold text-white mt-2">This action cannot be undone.</p>
            </div>
          </div>
          <div className="space-y-3 bg-red-50 border border-red-200 rounded-lg p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={clearDataCheckbox}
                onChange={(e) => setClearDataCheckbox(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm font-medium text-red-800">I understand this will permanently delete all transactional data.</span>
            </label>
            <div>
              <label className="block text-xs font-bold text-red-700 uppercase tracking-wider mb-1">Type CLEAR to confirm</label>
              <input
                type="text"
                className="w-full px-4 py-3 border-2 border-red-300 rounded-xl bg-white text-red-800 font-bold focus:ring-2 focus:ring-red-400 outline-none transition-all"
                placeholder="CLEAR"
                value={clearDataConfirmation}
                onChange={(e) => setClearDataConfirmation(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowClearDataModal(false)
                setClearDataConfirmation('')
                setClearDataCheckbox(false)
              }}
              className="flex-1 px-4 py-3 text-gray-600 font-bold hover:bg-gray-100 rounded-xl transition-all border border-gray-300"
            >
              Cancel
            </button>
            <LoadingButton
              onClick={handleClearAllData}
              loading={loadingClearData}
              disabled={clearDataConfirmation.trim().toUpperCase() !== 'CLEAR' || !clearDataCheckbox}
              className="flex-2 px-8 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg border-2 border-red-700 disabled:opacity-50 disabled:grayscale transition-all"
            >
              Clear all data
            </LoadingButton>
          </div>
        </div>
      </Modal>

      <ConfirmDangerModal
        isOpen={dangerModal.isOpen}
        title={dangerModal.title}
        message={dangerModal.message}
        confirmLabel={dangerModal.confirmLabel}
        onConfirm={dangerModal.onConfirm}
        onClose={() => setDangerModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}

export default SettingsPage

