import React from 'react'
import { useBranding } from '../contexts/TenantBrandingContext'
import { getApiBaseUrlNoSuffix } from '../services/apiConfig'
import api from '../services/api'

const Logo = ({ className = '', showText = true, size = 'default' }) => {
  const { companyName, companyLogo } = useBranding()
  const [logoError, setLogoError] = React.useState(false)
  const [logoKey, setLogoKey] = React.useState(0)
  const [logoBlobUrl, setLogoBlobUrl] = React.useState(null)

  React.useEffect(() => {
    setLogoError(false)
    setLogoKey(prev => prev + 1)
  }, [companyLogo])

  // For storage URLs, fetch with auth and use blob URL so browser doesn't send unauthenticated request (401)
  const logoUrlClean = companyLogo ? companyLogo.split('?')[0] : null
  const isStorageUrl = logoUrlClean && (logoUrlClean.includes('/api/storage/') || logoUrlClean.includes('storage/tenants/'))

  const blobUrlRef = React.useRef(null)
  React.useEffect(() => {
    if (!isStorageUrl || !logoUrlClean) {
      setLogoBlobUrl(null)
      return
    }
    const path = logoUrlClean.includes('/api/') ? logoUrlClean.split('/api/')[1] : logoUrlClean.replace(/^\//, '')
    if (!path) {
      setLogoBlobUrl(null)
      return
    }
    let cancelled = false
    api.get(path, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        if (res?.data && res.data.size > 0) {
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
          blobUrlRef.current = URL.createObjectURL(res.data)
          setLogoBlobUrl(blobUrlRef.current)
        }
      })
      .catch(() => { if (!cancelled) setLogoBlobUrl(null) })
    return () => {
      cancelled = true
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      setLogoBlobUrl(null)
    }
  }, [isStorageUrl, logoUrlClean])

  React.useEffect(() => {
    const handleLogoUpdate = () => setLogoKey(prev => prev + 1)
    window.addEventListener('logo-updated', handleLogoUpdate)
    return () => window.removeEventListener('logo-updated', handleLogoUpdate)
  }, [])

  const sizeClasses = {
    small: 'h-8 w-8',
    default: 'h-10 w-10',
    large: 'h-16 w-16',
    xl: 'h-24 w-24'
  }

  const textSizeClasses = {
    small: 'text-sm',
    default: 'text-base',
    large: 'text-2xl',
    xl: 'text-3xl'
  }

  const apiBase = getApiBaseUrlNoSuffix()
  const pathForSrc = logoUrlClean?.startsWith('http') ? logoUrlClean : logoUrlClean ? (logoUrlClean.startsWith('/') ? logoUrlClean : `/uploads/${logoUrlClean}`) : null
  const directLogoSrc = !isStorageUrl && pathForSrc
    ? (pathForSrc.startsWith('http') ? `${pathForSrc}?t=${Date.now()}` : `${apiBase}${pathForSrc.startsWith('/') ? '' : '/'}${pathForSrc}?t=${Date.now()}`)
    : null
  const logoSrc = isStorageUrl ? logoBlobUrl : directLogoSrc

  return (
    <div className={`flex items-center space-x-3 ${className}`}>
      <div className={`${sizeClasses[size]} ${!logoSrc && (companyName === 'HexaBill' || !companyName) ? '' : 'bg-primary-600 rounded-lg'} flex items-center justify-center overflow-hidden flex-shrink-0`}>
{logoSrc && !logoError ? (
          <img
            src={logoSrc}
            alt={companyName}
            className="w-full h-full object-contain"
            onError={() => setLogoError(true)}
          />
        ) : companyName === 'HexaBill' || !companyName ? (
          <img src="/hexabill-logo.svg" alt="HexaBill" className="w-full h-full object-contain" />
        ) : (
          <span className="text-white font-bold text-xl">{companyName.charAt(0).toUpperCase()}</span>
        )}
      </div>
      {showText && (
        <div className={`font-bold tracking-tight text-neutral-900 ${textSizeClasses[size]} hidden sm:block truncate`}>
          {companyName}
        </div>
      )}
    </div>
  )
}

export default Logo

