import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { adminAPI } from '../services'
import { clearAllCache } from '../services/api'
import { getApiBaseUrlNoSuffix } from '../services/apiConfig'
import { useAuth } from '../hooks/useAuth'

const BrandingContext = createContext()

export const useBranding = () => {
  const context = useContext(BrandingContext)
  if (!context) {
    return {
      companyName: 'HexaBill',
      companyLogo: null,
      primaryColor: '#2563EB',
      loading: false,
      refresh: () => {},
    }
  }
  return context
}

export const BrandingProvider = ({ children }) => {
  const { impersonatedTenantId } = useAuth()
  const location = useLocation()
  const [branding, setBranding] = useState({
    companyName: 'HexaBill',
    companyLogo: null,
    primaryColor: '#2563EB',
    accentColor: '#10B981',
    loading: true,
  })

  const updateFavicon = useCallback((logoUrl) => {
    if (!logoUrl) return
    try {
      const base = getApiBaseUrlNoSuffix()
      const path = logoUrl.startsWith('http') ? logoUrl : (logoUrl.startsWith('/') ? logoUrl : `/uploads/${logoUrl}`)
      const href = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`
      const link = document.querySelector("link[rel*='icon']") || document.createElement('link')
      link.rel = 'shortcut icon'
      link.href = href
      if (logoUrl.endsWith('.svg')) link.type = 'image/svg+xml'
      else link.type = 'image/x-icon'
      document.getElementsByTagName('head')[0].appendChild(link)
    } catch (e) {
      console.warn('Favicon update failed:', e)
    }
  }, [])

  const loadBranding = useCallback(async () => {
    // Skip API on login page to avoid ERR_CONNECTION_REFUSED flood when backend is down
    const path = typeof window !== 'undefined' ? window.location.pathname : ''
    if (path === '/login' || path === '/Admin26') {
      setBranding(prev => ({ ...prev, companyName: 'HexaBill', loading: false }))
      return
    }
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      setBranding(prev => ({ ...prev, companyName: 'HexaBill', loading: false }))
      return
    }
    setBranding(prev => ({ ...prev, loading: true }))
    try {
      // Prefer logo data URI (survives container restarts; no blob revoke)
      let logoDisplay = null
      try {
        const logoRes = await adminAPI.getLogoDataUri()
        const dataUri = logoRes?.data ?? logoRes
        if (typeof dataUri === 'string' && dataUri.startsWith('data:'))
          logoDisplay = dataUri
      } catch (_) { /* fallback to URL */ }

      const response = await adminAPI.getSettings()
      const data = response?.data ?? response
      if (data) {
        const name = data.COMPANY_NAME_EN || data.companyNameEn || data.companyName || 'HexaBill'
        const logoUrl = data.COMPANY_LOGO || data.LOGO_PUBLIC_URL || data.logoUrl || data.companyLogo || data.company_logo || null
        const primary = data.primaryColor || data.primary_color || '#2563EB'
        const accent = data.accentColor || data.accent_color || '#10B981'

        if (!logoDisplay && logoUrl) {
          const apiBase = getApiBaseUrlNoSuffix()
          let fullLogoUrl = logoUrl.startsWith('http') ? logoUrl : (logoUrl.startsWith('/') ? `${apiBase}${logoUrl}` : `${apiBase}/uploads/${logoUrl}`)
          logoDisplay = `${fullLogoUrl}${fullLogoUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
        }

        setBranding(prev => ({
          ...prev,
          companyName: name,
          companyLogo: logoDisplay,
          primaryColor: primary,
          accentColor: accent,
          loading: false,
        }))

        document.title = name
        if (logoDisplay && !logoDisplay.includes('/api/storage/') && !logoDisplay.includes('storage/tenants/'))
          updateFavicon(logoDisplay)
      } else {
        setBranding(prev => ({ ...prev, companyLogo: logoDisplay, loading: false }))
      }
    } catch (error) {
      setBranding(prev => ({ ...prev, companyName: 'HexaBill', loading: false }))
    }
  }, [updateFavicon])

  useEffect(() => {
    loadBranding()
  }, [loadBranding])

  // After login or refresh: refetch branding when user navigates into the app (so logo/settings show)
  useEffect(() => {
    const path = location.pathname || ''
    if (path !== '/login' && path !== '/Admin26' && typeof localStorage !== 'undefined' && localStorage.getItem('token')) {
      loadBranding()
    }
  }, [location.pathname, loadBranding])

  // After Super Admin impersonation, clear cache and refetch settings/logo for the selected tenant
  useEffect(() => {
    if (impersonatedTenantId != null) {
      clearAllCache()
      loadBranding()
    }
  }, [impersonatedTenantId, loadBranding])

  // Refetch branding when app becomes visible again (after refresh, switching tabs, or coming back)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && typeof localStorage !== 'undefined' && localStorage.getItem('token')) {
        const path = window.location.pathname || ''
        if (path !== '/login' && path !== '/Admin26') {
          loadBranding()
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [loadBranding])

  // When Settings (or any component) uploads a logo, set logo immediately from event then refetch
  useEffect(() => {
    const handleLogoUpdated = (event) => {
      const logoUrl = event?.detail?.logoUrl
      if (typeof logoUrl === 'string' && logoUrl.trim()) {
        const apiBase = getApiBaseUrlNoSuffix()
        const fullLogoUrl = logoUrl.startsWith('http')
          ? logoUrl
          : logoUrl.startsWith('/')
            ? `${apiBase}${logoUrl}`
            : `${apiBase}/uploads/${logoUrl}`
        const logoDisplay = `${fullLogoUrl}${fullLogoUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
        setBranding(prev => ({ ...prev, companyLogo: logoDisplay, loading: false }))
        if (!fullLogoUrl.includes('/api/storage/') && !fullLogoUrl.includes('storage/tenants/'))
          updateFavicon(logoDisplay)
      }
      loadBranding()
    }
    window.addEventListener('logo-updated', handleLogoUpdated)
    return () => window.removeEventListener('logo-updated', handleLogoUpdated)
  }, [loadBranding, updateFavicon])

  return (
    <BrandingContext.Provider value={{ ...branding, refresh: loadBranding }}>
      {children}
    </BrandingContext.Provider>
  )
}
