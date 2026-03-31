import React from 'react'
import axios from 'axios'
import camelcaseKeys from 'camelcase-keys'
import toast from 'react-hot-toast'
import { connectionManager } from './connectionManager'
import { showMaintenanceOverlay } from '../components/MaintenanceOverlay'
import { setSubscriptionGraceFromResponse } from '../components/SubscriptionGraceBanner'

// API base URL: single source of truth so production never uses localhost
import { getApiBaseUrl } from './apiConfig'
const API_BASE_URL = getApiBaseUrl()

// Error throttling to prevent flooding
let lastErrorToast = null
let errorToastCount = 0
let lastNetworkErrorToast = null
const ERROR_THROTTLE_MS = 3000 // Show max 1 error toast per 3 seconds for general errors
const SERVER_ERROR_THROTTLE_MS = 12000 // Show max 1 server (500) toast per 12 seconds to avoid spam
const NETWORK_ERROR_THROTTLE_MS = 15000 // Show max 1 network error toast per 15 seconds
let lastServerErrorToast = null

// Client-reported errors: queue when backend is down, send to backend when it's back (Super Admin sees in Error Logs)
const clientErrorQueue = []
const MAX_QUEUED_CLIENT_ERRORS = 50
function queueClientError(message, path) {
  const p = path || (typeof window !== 'undefined' ? window.location?.pathname : '') || ''
  clientErrorQueue.push({ message, path: p })
  if (clientErrorQueue.length > MAX_QUEUED_CLIENT_ERRORS) clientErrorQueue.shift()
}
function flushClientErrorsToBackend() {
  if (clientErrorQueue.length === 0) return
  const items = clientErrorQueue.splice(0, clientErrorQueue.length)
  const message = items[0]?.message || 'Service temporarily unavailable'
  const path = items.length === 1 ? (items[0]?.path || '') : `multiple (${items.length} requests failed)`
  api.post('/error-logs/client', { message, path, count: items.length }).catch(() => {})
}

// Request deduplication and throttling to prevent 429 errors
const pendingRequests = new Map()
const requestThrottle = new Map() // Track last request time per endpoint
const REQUEST_THROTTLE_MS = 50 // Only throttle very rapid duplicates (< 50ms) - prevents double-clicks
const MAX_CONCURRENT_REQUESTS = 20 // Increased concurrent requests limit

// Response caching with TTL to reduce API requests
const responseCache = new Map()
const CACHE_TTL = {
  '/api/reports/summary': 60000, // 60 seconds for dashboard summary
  '/api/dashboard/batch': 60000, // 60 seconds for dashboard batch
  '/api/settings': 300000, // 5 minutes for settings (rarely changes)
  '/api/settings/company': 300000, // 5 minutes for company settings
  '/api/branches': 120000, // 2 minutes for branches (changes infrequently)
  '/api/routes': 120000, // 2 minutes for routes (changes infrequently)
  '/api/alerts/unread-count': 30000, // 30 seconds for alert count
  default: 30000 // 30 seconds default cache TTL
}

// Get cache TTL for a URL
const getCacheTTL = (url) => {
  for (const [pattern, ttl] of Object.entries(CACHE_TTL)) {
    if (url.includes(pattern)) return ttl
  }
  return CACHE_TTL.default
}

// Clear cache entry (by exact key or by URL fragment so GET /settings is cleared when url is '/api/settings' or '/settings')
const clearCache = (url) => {
  if (!url) return
  responseCache.delete(url)
  const fragment = url.replace(/^\/api\/?/, '').replace(/^\//, '') || '' // 'settings' from '/api/settings' or '/settings'
  if (fragment) {
    for (const key of responseCache.keys()) {
      if (key.includes(fragment)) responseCache.delete(key)
    }
  }
}

// Clear all cache
const clearAllCache = () => {
  responseCache.clear()
}

// Generate request key for deduplication (never call toUpperCase on undefined)
// Include tenant ID so Super Admin impersonation does not serve one tenant's cached data to another
const getRequestKey = (config) => {
  if (!config) {
    return `UNKNOWN_${Date.now()}_${Math.random()}`
  }
  const method = config.method != null && config.method !== '' ? String(config.method).toUpperCase() : 'GET'
  const url = config.url != null ? String(config.url) : ''
  const params = config.params || {}
  const tenantId = config.headers?.['X-Tenant-Id'] ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_tenant_id') : null) ?? 'default'
  return `${method}_${url}_${JSON.stringify(params)}_tenant:${tenantId}`
}

/** Human-readable message from non-standard API / ProblemDetails / HTML error bodies (avoids generic "An error occurred"). */
function extractErrorMessageFromResponse(error) {
  const status = error.response?.status
  const data = error.response?.data
  if (data == null || data === '') {
    return status ? `Request failed (HTTP ${status}). Please try again.` : null
  }
  if (typeof data === 'string') {
    const t = data.trim()
    if (t.startsWith('<') || t.toLowerCase().includes('<!doctype')) {
      return status >= 500
        ? 'Server temporarily unavailable. Please try again in a moment.'
        : `Server returned an error (HTTP ${status || '?'}). Please try again.`
    }
    return t.length > 220 ? `${t.slice(0, 220)}…` : t
  }
  if (typeof data === 'object') {
    const m =
      data.message ||
      data.Message ||
      data.title ||
      data.Title ||
      data.detail ||
      data.Detail
    if (m) return String(m)
  }
  return status ? `Request failed (HTTP ${status}). Please try again.` : null
}

const showThrottledError = (message, isNetworkError = false, options = {}) => {
  const now = Date.now()
  const throttleTime = isNetworkError ? NETWORK_ERROR_THROTTLE_MS : ERROR_THROTTLE_MS
  const lastToast = isNetworkError ? lastNetworkErrorToast : lastErrorToast

  if (lastToast && (now - lastToast) < throttleTime && !options.forceShow) {
    errorToastCount++
    return // Skip this error, already showing one
  }

  if (isNetworkError) {
    lastNetworkErrorToast = now
  } else {
    lastErrorToast = now
  }

  errorToastCount = 1

  const withRetry = options.withRetry !== false && (isNetworkError || options.isServerError)
  const toastContent = withRetry
    ? (t) =>
        React.createElement(
          'span',
          { className: 'flex items-center gap-2' },
          message,
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                toast.dismiss(t.id)
                // Trigger data refresh events instead of full page reload
                window.dispatchEvent(new Event('dataUpdated'))
                window.dispatchEvent(new Event('connectionRestored'))
                // Small delay then check connection
                setTimeout(() => {
                  if (connectionManager.isConnected()) {
                    toast.success('Connection restored')
                  }
                }, 1000)
              },
              className: 'ml-2 px-2 py-1 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700'
            },
            'Retry'
          )
        )
    : message

  if (isNetworkError) {
    toast.error(withRetry ? toastContent : message, {
      duration: withRetry ? 12000 : 6000,
      id: 'network-error',
      position: 'top-center'
    })
  } else {
    toast.error(withRetry ? toastContent : message, { duration: withRetry ? 10000 : 4000 })
  }
}

// CRITICAL: Create axios instance with default method to prevent undefined errors
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds - show "request taking too long" instead of blank loading
  method: 'GET', // Default method to prevent undefined errors
  headers: {
    'Content-Type': 'application/json',
  },
})

// CRITICAL: Ensure defaults.method is ALWAYS set
// Axios uses this.defaults.method as fallback when config.method is undefined
// Use normal property assignment (not non-configurable) so axios can merge it properly
api.defaults.method = 'GET'

// Also ensure it's set on the axios instance itself
if (!api.defaults.method || typeof api.defaults.method !== 'string') {
  api.defaults.method = 'GET'
}

// CRITICAL: Store original axios request method to patch it
const originalRequest = api.request.bind(api)

// CRITICAL: Patch axios.request to ensure config.method is ALWAYS set before dispatchXhrRequest
// This is the LOWEST LEVEL - all methods (get, post, etc.) call this
api.request = function(configOrUrl, config) {
  // Handle axios.request(url, config) vs axios.request(config) signatures
  let finalConfig
  if (typeof configOrUrl === 'string') {
    // axios.request(url, config) signature
    finalConfig = config || {}
    finalConfig.url = configOrUrl
  } else {
    // axios.request(config) signature
    finalConfig = configOrUrl || {}
  }
  
  // CRITICAL: Normalize config IMMEDIATELY - before axios processes it
  if (!finalConfig || typeof finalConfig !== 'object' || Array.isArray(finalConfig)) {
    finalConfig = { method: 'GET', url: '', headers: {} }
  }
  
  // CRITICAL: Ensure method is ALWAYS a string before axios sees it
  // Axios calls toUpperCase() on config.method, so it MUST be a string
  if (!finalConfig.method || typeof finalConfig.method !== 'string' || finalConfig.method === '') {
    finalConfig.method = 'GET'
  } else {
    // Normalize to uppercase string
    finalConfig.method = String(finalConfig.method).trim().toUpperCase() || 'GET'
  }
  
  // Ensure url exists
  if (!finalConfig.url || typeof finalConfig.url !== 'string') {
    finalConfig.url = finalConfig.url != null ? String(finalConfig.url) : ''
  }
  
  // Ensure headers exists
  if (!finalConfig.headers || typeof finalConfig.headers !== 'object' || Array.isArray(finalConfig.headers)) {
    finalConfig.headers = {}
  }
  
  // CRITICAL: Ensure method is set as a normal enumerable property (not non-configurable)
  // Axios uses Object.assign/mergeConfig which copies enumerable properties
  // Making it non-configurable prevents axios from copying it to merged config objects
  finalConfig.method = String(finalConfig.method || 'GET').trim().toUpperCase() || 'GET'
  
  // Final validation - ensure method is definitely a string
  if (typeof finalConfig.method !== 'string' || finalConfig.method === '') {
    finalConfig.method = 'GET'
  }
  
  // CRITICAL: Wrap config in Proxy to ensure method is ALWAYS available
  // This prevents axios from calling toUpperCase() on undefined even if it creates new config objects
  const configProxy = new Proxy(finalConfig, {
    get(target, prop) {
      if (prop === 'method') {
        const value = target[prop]
        if (value === undefined || value === null || typeof value !== 'string' || value === '') {
          return 'GET'
        }
        return String(value).trim().toUpperCase() || 'GET'
      }
      return target[prop]
    },
    set(target, prop, value) {
      if (prop === 'method') {
        if (value === undefined || value === null || typeof value !== 'string' || value === '') {
          target[prop] = 'GET'
        } else {
          target[prop] = String(value).trim().toUpperCase() || 'GET'
        }
      } else {
        target[prop] = value
      }
      return true
    },
    has(target, prop) {
      if (prop === 'method') return true
      return prop in target
    }
  })
  
  // CRITICAL: Also ensure defaults.method is set (axios uses this as fallback)
  if (!api.defaults.method || typeof api.defaults.method !== 'string') {
    api.defaults.method = 'GET'
  }

  // Response cache check - BEFORE calling axios (prevents toUpperCase bug from returning response as config)
  const method = (finalConfig.method && typeof finalConfig.method === 'string')
    ? String(finalConfig.method).toUpperCase() : 'GET'
  // Never serve PDF/blob from JSON cache — JSON.stringify destroys Blob (breaks repeat exports/prints)
  if (method === 'GET' && !finalConfig._bypassCache && finalConfig.responseType !== 'blob') {
    const cacheKey = getRequestKey(finalConfig)
    const cached = responseCache.get(cacheKey)
    if (cached) {
      const cacheAge = Date.now() - cached.timestamp
      const ttl = getCacheTTL(finalConfig.url || '')
      if (cacheAge < ttl) {
        const cachedConfig = {
          method: 'GET',
          url: String(finalConfig.url || ''),
          headers: finalConfig.headers || {},
          _requestKey: cacheKey
        }
        const cachedResponse = {
          data: JSON.parse(JSON.stringify(cached.response.data)),
          status: cached.response.status || 200,
          statusText: cached.response.statusText || 'OK',
          headers: cached.response.headers || {},
          config: cachedConfig
        }
        return Promise.resolve(cachedResponse)
      }
      responseCache.delete(cacheKey)
    }
  }
  
  // Call original request with proxied config
  return originalRequest(configProxy)
}

// CRITICAL: Wrap axios methods to ensure config.method is always set
const originalGet = api.get.bind(api)
const originalPost = api.post.bind(api)
const originalPut = api.put.bind(api)
const originalPatch = api.patch.bind(api)
const originalDelete = api.delete.bind(api)

// Wrap methods to ensure method is always set (use PLAIN objects so axios mergeConfig never sees undefined method)
api.get = function(url, config) {
  if (config === undefined || config === null) {
    config = {}
  } else if (typeof config !== 'object' || Array.isArray(config)) {
    config = {}
  }
  const plain = {
    method: 'GET',
    url: config.url || url || '',
    headers: config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers) ? { ...config.headers } : {},
    params: config.params,
    ...config
  }
  plain.method = 'GET'
  return originalGet(url, plain)
}

api.post = function(url, data, config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}
  const normalizedConfig = { ...config, method: 'POST' }
  try {
    Object.defineProperty(normalizedConfig, 'method', {
      value: 'POST',
      writable: true,
      enumerable: true,
      configurable: true
    })
  } catch (e) {
    normalizedConfig.method = 'POST'
  }
  return originalPost(url, data, normalizedConfig)
}

api.put = function(url, data, config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}
  const normalizedConfig = { ...config, method: 'PUT' }
  try {
    Object.defineProperty(normalizedConfig, 'method', {
      value: 'PUT',
      writable: true,
      enumerable: true,
      configurable: true
    })
  } catch (e) {
    normalizedConfig.method = 'PUT'
  }
  return originalPut(url, data, normalizedConfig)
}

api.patch = function(url, data, config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}
  const normalizedConfig = { ...config, method: 'PATCH' }
  try {
    Object.defineProperty(normalizedConfig, 'method', {
      value: 'PATCH',
      writable: true,
      enumerable: true,
      configurable: true
    })
  } catch (e) {
    normalizedConfig.method = 'PATCH'
  }
  return originalPatch(url, data, normalizedConfig)
}

api.delete = function(url, config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}
  const normalizedConfig = { ...config, method: 'DELETE' }
  try {
    Object.defineProperty(normalizedConfig, 'method', {
      value: 'DELETE',
      writable: true,
      enumerable: true,
      configurable: true
    })
  } catch (e) {
    normalizedConfig.method = 'DELETE'
  }
  return originalDelete(url, normalizedConfig)
}

// Request interceptor to add auth token, check connection, and throttle requests
api.interceptors.request.use(
  (config) => {
    // CRITICAL: Normalize config IMMEDIATELY so axios never sees undefined method/url (prevents toUpperCase error)
    // Axios internally calls toUpperCase on config.method in dispatchXhrRequest via resolveConfig/mergeConfig
    // resolveConfig calls mergeConfig({}, config) which creates a NEW object, so we MUST ensure method is enumerable
    // This MUST be the FIRST thing we do - before any other checks
    
    // Step 1: Ensure config is an object (handle all edge cases)
    if (config === undefined || config === null) {
      config = { method: 'GET', url: '', headers: {} }
    } else if (typeof config !== 'object' || Array.isArray(config)) {
      config = { method: 'GET', url: '', headers: {} }
    }
    
    // Step 2: CRITICAL - Ensure method is ALWAYS a valid string BEFORE axios processes it
    // This prevents "Cannot read properties of undefined (reading 'toUpperCase')" errors
    // Axios calls resolveConfig which calls mergeConfig({}, config), creating a new object
    // mergeConfig uses Object.keys() or for...in, so method MUST be enumerable
    // We set it as a normal property (not Object.defineProperty with non-configurable) so mergeConfig copies it
    if (config.method === undefined || config.method === null || typeof config.method !== 'string' || config.method === '') {
      config.method = 'GET'
    } else {
      // Normalize method to uppercase string
      const methodStr = String(config.method).trim()
      config.method = methodStr ? methodStr.toUpperCase() : 'GET'
    }
    
    // CRITICAL: Also ensure method is set as a normal enumerable property (not non-configurable)
    // This ensures mergeConfig({}, config) will copy it to the new object
    // We do this AFTER setting it above to ensure it's definitely there
    config.method = config.method || 'GET'
    
    // Step 3: Ensure url is always a string (axios also accesses this directly)
    if (config.url === undefined || config.url === null || typeof config.url !== 'string') {
      config.url = config.url != null ? String(config.url) : ''
    }
    
    // Step 4: Ensure headers object exists
    if (!config.headers || typeof config.headers !== 'object' || Array.isArray(config.headers)) {
      config.headers = {}
    }
    
    // Step 5: CRITICAL - Final validation before returning (defensive programming)
    // This is the last chance to fix it before axios processes it
    // Use normal property assignment (not Object.defineProperty) so mergeConfig copies it
    if (typeof config.method !== 'string' || config.method === '') {
      config.method = 'GET'
    }
    
    // CRITICAL: One final check - ensure method exists and is a string
    // This is the absolute last chance before axios processes it
    // Set as normal property so mergeConfig({}, config) copies it
    if (!config.method || typeof config.method !== 'string') {
      config.method = 'GET'
    }
    
    // CRITICAL: Ensure method is uppercase (axios expects uppercase)
    config.method = String(config.method || 'GET').trim().toUpperCase() || 'GET'
    
    // CRITICAL: Return a PLAIN object so axios mergeConfig copies method correctly.
    // Never spread config (it may be a Proxy or lose method). Set method explicitly first.
    const safeMethod = (config && typeof config.method === 'string' && config.method)
      ? String(config.method).trim().toUpperCase() || 'GET'
      : 'GET'
    const plainConfig = {
      method: safeMethod,
      url: (config && config.url != null) ? String(config.url) : '',
      headers: config?.headers && typeof config.headers === 'object' && !Array.isArray(config.headers) ? { ...config.headers } : {},
      baseURL: config?.baseURL,
      timeout: config?.timeout,
      params: config?.params,
      data: config?.data
    }
    // Copy other enumerable keys from config without spreading (avoids Proxy/missing method)
    if (config && typeof config === 'object') {
      for (const key of Object.keys(config)) {
        if (!Object.prototype.hasOwnProperty.call(plainConfig, key))
          plainConfig[key] = config[key]
      }
    }
    plainConfig.method = String(plainConfig.method || 'GET').trim().toUpperCase() || 'GET'
    config = plainConfig

    // Check if we should allow this request
    if (!connectionManager.shouldAllowRequest()) {
      const error = new Error('Server connection unavailable. Please wait...')
      error.config = config
      error.isConnectionBlocked = true
      return Promise.reject(error)
    }

    // CRITICAL: Throttle requests to prevent 429 errors
    const requestKey = getRequestKey(config)
    const now = Date.now()
    const lastRequestTime = requestThrottle.get(requestKey) || 0
    const timeSinceLastRequest = now - lastRequestTime

    // CRITICAL: Remove aggressive throttling - only track, don't block
    // Only log very rapid duplicates for debugging, but allow all requests to proceed
    if (timeSinceLastRequest < REQUEST_THROTTLE_MS && !config._isRetry) {
      // Track duplicate for monitoring only - allow all requests to proceed
      if (pendingRequests.has(requestKey)) {
        // (no console log in production)
      }
    }

    // CRITICAL: Don't block requests - only track for monitoring
    // Remove all blocking logic - let server handle rate limiting
    // The server's 429 response will be handled gracefully

    // Track this request (for monitoring only, not blocking)
    config._requestKey = requestKey
    config._requestTime = now

    // Update throttle time (for tracking only)
    requestThrottle.set(requestKey, now)

    // Clean up old throttle entries periodically (prevent memory leaks)
    if (requestThrottle.size > 200) {
      const oneMinuteAgo = now - 60000
      for (const [key, time] of requestThrottle.entries()) {
        if (time < oneMinuteAgo) {
          requestThrottle.delete(key)
        }
      }
    }

    // Add auth token
    const token = localStorage.getItem('token')
    if (token) {
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${token}`
    }

    // MULTI-TENANT IMPERSONATION: Add impersonation header for Super Admin
    const selectedTenantId = localStorage.getItem('selected_tenant_id')
    if (selectedTenantId) {
      config.headers = config.headers || {}
      config.headers['X-Tenant-Id'] = selectedTenantId
    }

    // Add retry configuration (1 retry = 2 total attempts - reduces console spam when backend is failing)
    config._retryCount = config._retryCount || 0
    config._maxRetries = 1
    config._requestKey = requestKey // Store for cleanup in response interceptor

    // REMOVED: Cache short-circuit from request interceptor - it was returning a response object
    // as "config" which caused axios to call config.method.toUpperCase() on undefined.
    // Cache is handled in response interceptor (store) and in api.request (check) - see api.request patch below.

    // CRITICAL: Request interceptor must return config, not promise
    // Deduplication will be handled by tracking the request key
    
    // FINAL SAFEGUARD: Ensure method is ALWAYS set right before returning
    // This is the absolute last chance - axios will process this config next
    // CRITICAL: Set as a normal enumerable property so axios can copy it when merging configs
    // Use simple property assignment - axios needs to be able to copy this property
    const methodValue = String(config.method || 'GET').trim().toUpperCase() || 'GET'
    config.method = methodValue
    
    // Ensure it's definitely set and is a string
    if (typeof config.method !== 'string' || config.method === '') {
      config.method = 'GET'
    }
    
    // Final normalization - ensure uppercase
    config.method = String(config.method).trim().toUpperCase() || 'GET'
    
    // CRITICAL: Use Object.defineProperty to ensure method is ALWAYS enumerable
    // This prevents axios from losing it during mergeConfig operations
    try {
      Object.defineProperty(config, 'method', {
        value: String(config.method || 'GET').trim().toUpperCase() || 'GET',
        writable: true,
        enumerable: true, // CRITICAL: Must be enumerable for mergeConfig to copy it
        configurable: true // Allow modification
      })
    } catch (e) {
      // If defineProperty fails, ensure it's set normally
      config.method = String(config.method || 'GET').trim().toUpperCase() || 'GET'
    }
    
    return config
  },
  (error) => {
    // Ensure rejected config has method/url so error handlers don't throw
    if (error?.config) {
      error.config.method = error.config.method || 'GET'
      error.config.url = error.config.url ?? ''
    }
    return Promise.reject(error)
  }
)

// Recursively convert PascalCase keys to camelCase in API responses.
// Eliminates need for fallbacks like entry.grandTotal || entry.GrandTotal
const transformResponseKeys = (obj) => {
  if (obj == null) return obj
  if (Array.isArray(obj)) return obj.map(transformResponseKeys)
  if (typeof obj === 'object' && obj.constructor === Object) {
    return camelcaseKeys(obj, { deep: true })
  }
  return obj
}

// Response interceptor to handle errors and cleanup
// Offline detection and error handling
api.interceptors.response.use(
  (response) => {
    // Mark connection as successful on any successful response
    connectionManager.markConnected()
    // Send any client-reported errors (e.g. connection refused) to backend so Super Admin can see them
    flushClientErrorsToBackend()

    // Clean up pending request tracking
    if (response.config?._requestKey) {
      pendingRequests.delete(response.config._requestKey)
    }

    // Normalize PascalCase to camelCase in response data (skip Blobs — not JSON)
    if (response?.data != null && !(response.data instanceof Blob)) {
      try {
        if (typeof response.data === 'object') {
          response.data = transformResponseKeys(response.data)
        }
      } catch (_) { /* ignore transform errors */ }
    }

    // Response caching: Cache successful GET responses
    const respMethod = response.config?.method != null ? String(response.config.method).toUpperCase() : ''
    const isBlobBody =
      response.config?.responseType === 'blob' || (response.data != null && response.data instanceof Blob)
    if (respMethod === 'GET' &&
        !response.config?._bypassCache &&
        !isBlobBody &&
        response.status >= 200 &&
        response.status < 300) {
      const cacheKey = response.config._requestKey || getRequestKey(response.config)
      const ttl = getCacheTTL(response.config.url || '')
      responseCache.set(cacheKey, {
        response: {
          data: JSON.parse(JSON.stringify(response.data)), // Deep clone
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        },
        timestamp: Date.now(),
        ttl
      })
      
      // Clean up expired cache entries periodically
      if (responseCache.size > 100) {
        const now = Date.now()
        for (const [key, cached] of responseCache.entries()) {
          const cacheAge = now - cached.timestamp
          if (cacheAge >= cached.ttl) {
            responseCache.delete(key)
          }
        }
      }
    }

    // Subscription grace period: check for X-Subscription-Grace-Period header
    setSubscriptionGraceFromResponse(response)

    return response
  },
  async (error) => {
    // Handle connection blocked errors
    if (error.isConnectionBlocked) {
      return Promise.reject(error)
    }

    // Ping is best-effort; never trigger disconnect or toasts (avoids 404/network spam and health-check flood)
    const isPingRequest = (error.config?.url || '').includes('me/ping')
    if (isPingRequest) {
      error._handledByInterceptor = true
      return Promise.reject(error)
    }

    // Handle network/connection errors (includes timeout ECONNABORTED)
    const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout')
    const isNetworkError = !error.response && (
      isTimeout ||
      error.message === 'Network Error' ||
      error.code === 'ERR_NETWORK' ||
      error.code === 'ERR_CORS' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.message?.includes('Failed to fetch') ||
      error.message?.includes('NetworkError')
    )

    // BUG #3 FIX: Automatic retry with exponential backoff for transient errors (500/503/network)
    // CRITICAL: Never retry 401 (authentication) errors - they will always fail
    const retryableStatuses = [500, 503, 502, 504]
    const isRetryable = isNetworkError || (error.response && retryableStatuses.includes(error.response.status))
    const retryCount = error.config?._retryCount || 0
    const maxRetries = error.config?._maxRetries ?? 1
    const method = error.config?.method ? String(error.config.method).toUpperCase() : ''
    const isRetryableMethod = !method || ['GET', 'POST', 'PUT', 'PATCH'].includes(method)
    // Prevent retry loops on 401 - authentication errors should never be retried
    const is401Error = error.response?.status === 401
    const shouldRetry = isRetryable && retryCount < maxRetries && isRetryableMethod && !error.config?._skipRetry && !is401Error
    
    // Additional safety: If retry count exceeded, prevent further retries
    if (retryCount >= maxRetries) {
      error._handledByInterceptor = true
      if (!is401Error) {
        let serverMsg = error.response?.data?.message || error.response?.data?.errors?.[0]
        if (!serverMsg && error.response?.data instanceof Blob) {
          try {
            const text = await error.response.data.text()
            if (text.trim().startsWith('{')) {
              const j = JSON.parse(text)
              serverMsg =
                j.message ||
                j.Message ||
                j.detail ||
                j.Detail ||
                (Array.isArray(j.errors) && j.errors[0]) ||
                (Array.isArray(j.Errors) && j.Errors[0])
            }
          } catch (_) {
            /* ignore */
          }
        }
        if (!serverMsg) serverMsg = extractErrorMessageFromResponse(error)
        const msg = serverMsg || 'Request failed after multiple attempts. Please refresh the page.'
        showThrottledError(msg, false)
      }
      return Promise.reject(error)
    }

    if (shouldRetry) {
      // Exponential backoff: 2s, 4s, 8s
      const retryConfig = {
        ...error.config,
        _retryCount: retryCount + 1,
        _isRetry: true
      }
      retryConfig.method = (retryConfig.method != null && retryConfig.method !== '') ? String(retryConfig.method).toUpperCase() : 'GET'
      retryConfig.url = retryConfig.url != null ? String(retryConfig.url) : ''
      const delay = Math.pow(2, retryCount) * 1000

      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(api.request(retryConfig))
        }, delay)
      })
    }

    if (isNetworkError) {
      // Mark connection as failed
      connectionManager.markDisconnected()

      // Login page shows its own message for auth/login — avoid duplicate toast
      const isLoginRequest = (error.config?.url || '').includes('auth/login')
      const errorMsg = isTimeout
        ? 'The request timed out. If using Render free tier, the backend may be starting (cold start). Wait 30-60 seconds and try again.'
        : error.code === 'ERR_CORS'
          ? 'Service is temporarily unavailable. Please try again or contact support.'
          : 'Service temporarily unavailable. Please try again or contact support.'

      if (!isLoginRequest) showThrottledError(errorMsg, true)
      error._handledByInterceptor = true
      // Queue so Super Admin sees it in Error Logs when backend is back
      queueClientError(errorMsg, error.config?.url || (typeof window !== 'undefined' ? window.location?.pathname : ''))

      // Notify Login page so it can show the banner without an extra health check
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hexabill-backend-unavailable'))
      }

      return Promise.reject(error)
    }

    // Clean up pending request tracking on error (do this first)
    if (error.config?._requestKey) {
      pendingRequests.delete(error.config._requestKey)
    }

    // Handle 429 Too Many Requests - CRITICAL: Prevent request flooding
    if (error.response?.status === 429) {
      connectionManager.markConnected() // Server is responding

      const retryAfter = error.response?.headers?.['retry-after'] || 5
      const message = `Too many requests. Please wait ${retryAfter} seconds before trying again.`

      showThrottledError(message, false)
      error._handledByInterceptor = true

      // Don't log every 429 error to prevent console flooding
      if (errorToastCount === 1) {
        console.warn('⚠️ Rate limit exceeded (429). Requests are being throttled.')
      }

      return Promise.reject(error)
    }

    // Handle throttled requests (from interceptor) - silently reject
    if (error.isThrottled) {
      // Don't show error for throttled requests - they're expected behavior
      return Promise.reject(error)
    }

    // Handle rate limited requests
    if (error.isRateLimited) {
      showThrottledError('Too many requests in progress. Please wait...', false)
      error._handledByInterceptor = true
      return Promise.reject(error)
    }

    // Handle 400 Bad Request - validation errors (show errors array, object, or message)
    if (error.response?.status === 400) {
      connectionManager.markConnected()
      const body = error.response?.data
      const errors = body?.errors
      let message
      if (Array.isArray(errors) && errors.length > 0) {
        message = errors.join('. ')
      } else if (errors && typeof errors === 'object' && !Array.isArray(errors)) {
        // ASP.NET model validation: { "CategoryId": ["The CategoryId field is required."], ... }
        const flat = Object.values(errors).flat().filter(Boolean)
        message = flat.length > 0 ? flat.join('. ') : (body?.message || body?.title || 'Invalid request. Please check your input.')
      } else {
        message = body?.message || body?.title || 'Invalid request. Please check your input.'
      }
      showThrottledError(message, false)
      error._handledByInterceptor = true
      return Promise.reject(error)
    }

    // Handle 404 Not Found (with special message only for Branches/Routes list endpoints)
    if (error.response?.status === 404) {
      connectionManager.markConnected()
      const url = (error.config?.url || '').toLowerCase()
      const isBranchesOrRoutesList = /\/branches\/?(\?|$)/.test(url) || /\/routes\/?(\?|$)/.test(url)
      let msg
      if (isBranchesOrRoutesList && !sessionStorage.getItem('hexabill_branches_routes_404_shown')) {
        sessionStorage.setItem('hexabill_branches_routes_404_shown', '1')
        msg = 'Branches & Routes feature is currently unavailable. Please try again later or contact support.'
      } else {
        msg = error.response?.data?.message || 'Resource not found.'
      }
      showThrottledError(msg, false)
      error._handledByInterceptor = true
      return Promise.reject(error)
    }

    // Handle 502 Bad Gateway - show retry
    if (error.response?.status === 502) {
      connectionManager.markConnected()
      queueClientError('Server 502 Bad Gateway', error.config?.url)
      const msg = error.response?.data?.message || 'Server temporarily unavailable. Please try again.'
      showThrottledError(msg, false, { isServerError: true })
      error._handledByInterceptor = true
      return Promise.reject(error)
    }

    const url = (error.config?.url || '').toLowerCase()

    // Handle 403 Forbidden - tenant suspended/expired or insufficient permissions
    if (error.response?.status === 403) {
      connectionManager.markConnected()
      const body = error.response?.data
      const msg = typeof body === 'string'
        ? body
        : (body?.message || body?.errors?.[0] || 'Access denied')
      const isTenantBlock = /tenant|trial|suspended|expired/i.test(msg)
      const url = (error.config?.url || '').toLowerCase()
      const isAdminEndpoint = url.includes('/admin/') || url.includes('/backup/')
      const displayMsg = isTenantBlock
        ? `${msg} Please contact your administrator.`
        : isAdminEndpoint && !msg
          ? 'Admin or Owner access required for this feature.'
          : msg
      showThrottledError(displayMsg, false)
      error._handledByInterceptor = true
      return Promise.reject(error)
    }

    // Handle 503 Maintenance Mode - show branded maintenance screen, no toast
    if (error.response?.status === 503) {
      connectionManager.markConnected()
      const msg = error.response?.data?.message || 'System under maintenance. Back shortly.'
      showMaintenanceOverlay(msg)
      error._handledByInterceptor = true
      return Promise.reject(error)
    }

    // Handle 401 Unauthorized errors
    // CRITICAL: Never retry 401 errors - prevent infinite retry loops
    if (error.response?.status === 401) {
      connectionManager.markConnected() // Server is responding, just auth issue
      
      // Prevent retry loops on 401 - mark as handled immediately
      error._handledByInterceptor = true

      const hadToken = !!(error.config?.headers?.Authorization || localStorage.getItem('token'))
      const authFailure = error.response?.headers?.['x-auth-failure']
      const errorMessage = error.response?.data?.message || ''
      const tokenExpired = error.response?.headers?.['token-expired'] === 'true'
      const method = (error.config?.method || '').toUpperCase()
      const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      const retryCount = error.config?._retryCount || 0

      // If this is a retry attempt on 401, immediately logout to prevent loops
      if (retryCount > 0) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        toast.error('Authentication failed. Please login again.', { duration: 3000 })
        setTimeout(() => {
          window.location.href = '/login'
        }, 1500)
        return Promise.reject(error)
      }

      // Only logout + redirect when we HAD a token (user was logged in, now session invalid).
      // If we had no token, this is a public/unauthenticated request (e.g. login page) - don't redirect.
      // For mutating requests (POST/PUT), only force logout on clear token-expired - avoid false logout from timing/validation bugs
      const isAuthFailure = hadToken && (
        tokenExpired ||
        authFailure === 'Token-Expired' ||
        (!isMutating && (authFailure ||
          errorMessage.toLowerCase().includes('session') ||
          errorMessage.toLowerCase().includes('expired') ||
          errorMessage.toLowerCase().includes('token') ||
          errorMessage.toLowerCase().includes('authentication') ||
          errorMessage.toLowerCase().includes('login')))
      )

      if (isAuthFailure) {
        // Clear auth data
        localStorage.removeItem('token')
        localStorage.removeItem('user')

        // Show appropriate error message (only once)
        const message = errorMessage ||
          (tokenExpired ? 'Your session has expired. Please login again.' :
            'Authentication required. Please login again.')

        toast.error(message, { duration: 3000 })

        // Small delay to let the toast show before redirect
        setTimeout(() => {
          window.location.href = '/login'
        }, 1500)
      } else if (hadToken) {
        // Had token but 401 - for POST/PUT/DELETE, likely session expired; for GET, permission issue
        const msg = isMutating
          ? (errorMessage || 'Your session may have expired. Please log in again.')
          : (errorMessage || 'You are not authorized to perform this action')
        showThrottledError(msg)
      }
      // If no token: silent fail (e.g. BrandingProvider on login page) - no toast, no redirect
      
      return Promise.reject(error)
    } else if (error.response?.status >= 500) {
      connectionManager.markConnected()
      
      // BUG #3 FIX: Retry 500 errors automatically (handled above, but ensure we don't show error on retry)
      if (error.config?._isRetry) {
        // Don't show error toast for retries - they're automatic
        error._handledByInterceptor = true
        return Promise.reject(error)
      }
      // Duplicate payment check failure: do not show scary error; caller proceeds with payment
      const url = (error.config?.url || '').toLowerCase()
      if (url.includes('duplicate-check')) {
        error._handledByInterceptor = true
        return Promise.reject(error)
      }
      // Queue so Super Admin sees in Error Logs
      const baseMessage = error.response?.data?.message || 'Server error (500)'
      queueClientError(`Server 500: ${baseMessage}`, error.config?.url)
      // Server errors - throttle heavily to avoid repeated toasts for branches/routes/reports
      const now = Date.now()
      if (lastServerErrorToast && (now - lastServerErrorToast) < SERVER_ERROR_THROTTLE_MS) {
        return Promise.reject(error)
      }
      lastServerErrorToast = now
      const correlationId = error.response?.data?.correlationId || error.response?.headers?.['x-correlation-id']
      const errorMsg = correlationId ? `${baseMessage} (Ref: ${correlationId})` : baseMessage
      showThrottledError(errorMsg, false, { isServerError: true })
      error._handledByInterceptor = true
    } else if (error.response?.data?.message) {
      // Server is responding with message
      connectionManager.markConnected()
      const correlationId = error.response?.data?.correlationId || error.response?.headers?.['x-correlation-id']
      const baseMessage = error.response.data.message
      const errorMsg = correlationId ? `Something went wrong. Ref: ${correlationId}` : baseMessage
      showThrottledError(errorMsg)
      error._handledByInterceptor = true
    } else if (error.response?.data?.errors && Array.isArray(error.response.data.errors)) {
      // Server is responding with errors array
      connectionManager.markConnected()
      const correlationId = error.response?.data?.correlationId || error.response?.headers?.['x-correlation-id']
      const errorMsg = error.response.data.errors.join(', ')
      const finalMsg = correlationId ? `Something went wrong. Ref: ${correlationId}` : errorMsg
      showThrottledError(finalMsg)
      error._handledByInterceptor = true
    } else if (error.response?.data !== undefined && error.response?.data !== null) {
      // Server responded with a body but no message/errors (e.g. ProblemDetails shape, empty object)
      connectionManager.markConnected()
      const correlationId = error.response?.data?.correlationId || error.response?.headers?.['x-correlation-id']
      const extracted = extractErrorMessageFromResponse(error)
      const errorMsg = correlationId
        ? `${extracted || 'Something went wrong'} (Ref: ${correlationId})`
        : (extracted || 'An error occurred. Please try again.')
      showThrottledError(errorMsg)
      error._handledByInterceptor = true
    } else {
      // e.g. HTTP error with empty body
      connectionManager.markConnected()
      const extracted = extractErrorMessageFromResponse(error)
      showThrottledError(extracted || 'An error occurred. Please try again.')
      error._handledByInterceptor = true
    }

    return Promise.reject(error)
  }
)

export default api

// Export cache utilities for manual cache invalidation
export { clearCache, clearAllCache }
