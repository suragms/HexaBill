import { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, Package, AlertTriangle, Search, Filter, RefreshCw, Download, Upload, MoreVertical, RotateCw, Tag, Image as ImageIcon, X } from 'lucide-react'
import { productsAPI, stockAdjustmentsAPI, productCategoriesAPI } from '../../services'
import ProductForm from '../../components/ProductForm'
import StockAdjustmentModal from '../../components/StockAdjustmentModal'
import ConfirmDangerModal from '../../components/ConfirmDangerModal'
import { TabNavigation, FilterPanel, ModernTable } from '../../components/ui'
import { useDebounce } from '../../hooks/useDebounce'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import toast from 'react-hot-toast'

const ProductsPage = () => {
  const { user } = useAuth()
  const canManageInventory = isAdminOrOwner(user) // Staff: no Import / Reset stock / Edit / Delete
  const canAdjustStock = !!user // All authenticated users can adjust stock (Staff included)

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [showStockModal, setShowStockModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [activeTab, setActiveTab] = useState('all') // 'all', 'lowStock', 'inactive'
  const [activeFilters, setActiveFilters] = useState({})
  const [categories, setCategories] = useState([])
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [productToDelete, setProductToDelete] = useState(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [categoryFormData, setCategoryFormData] = useState({ name: '', description: '', colorCode: '#3B82F6' })
  const [dangerModal, setDangerModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    requireTypedText: null,
    onConfirm: () => { }
  })

  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true)
      const params = {
        page: currentPage,
        pageSize: pageSize,
        search: debouncedSearchTerm || undefined,
        lowStock: activeTab === 'lowStock',
        unitType: activeFilters.unitType || undefined,
        categoryId: activeFilters.categoryId ? parseInt(activeFilters.categoryId) : undefined,
        includeInactive: activeTab === 'inactive' // Include inactive products when on inactive tab
      }
      
      // Filter inactive products client-side when on inactive tab
      // (Backend returns all products when includeInactive=true, we filter to only inactive)

      const response = await productsAPI.getProducts(params)
      if (response?.success && response?.data) {
        let items = response.data.items || []
        // Filter to only inactive products when on inactive tab
        if (activeTab === 'inactive') {
          items = items.filter(p => !p.isActive)
        }
        setProducts(items)
        setTotalPages(response.data.totalPages || 1)
        setTotalCount(response.data.totalCount || 0)
      } else {
        setProducts([])
        setTotalPages(1)
      }
    } catch (error) {
      console.error('Error loading products:', error)
      // Only show error if it's not a network error (handled by interceptor)
      if (!error?._handledByInterceptor && (error.response || (!error.code || error.code !== 'ERR_NETWORK'))) {
        toast.error(error?.response?.data?.message || 'Failed to load products')
      }
      setProducts([])
      setTotalPages(1)
    } finally {
      setLoading(false)
    }
  }, [currentPage, pageSize, debouncedSearchTerm, activeTab, activeFilters])

  useEffect(() => {
    loadProducts()
    // Auto-refresh products every 60 seconds (reduced frequency for better performance)
    // Only refresh if page is visible and not in edit mode
    const refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && !showForm && !showStockModal) {
        loadProducts()
      }
    }, 60000) // 60 seconds - reduced from 20

    return () => clearInterval(refreshInterval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debouncedSearchTerm, activeTab, activeFilters]) // Only refresh when filters change

  const handleCreateProduct = async (productData, imageFile) => {
    // Prevent multiple clicks
    if (saving) {
      toast.error('Please wait, operation in progress...')
      return
    }

    // Validate input
    if (!productData.nameEn || productData.nameEn.trim().length === 0) {
      toast.error('Product name is required')
      return
    }
    if (productData.sellPrice < 0 || productData.costPrice < 0) {
      toast.error('Prices cannot be negative')
      return
    }
    if (productData.sellPrice > 1000000 || productData.costPrice > 1000000) {
      toast.error('Prices are too high. Maximum is 1,000,000')
      return
    }

    try {
      setSaving(true)
      const payload = { ...productData, expiryDate: productData.expiryDate?.trim() || undefined }
      const response = await productsAPI.createProduct(payload)
      if (response?.success) {
        // Upload image if provided (for new products, upload after creation)
        if (imageFile && response.data?.id) {
          try {
            const uploadResponse = await productsAPI.uploadProductImage(response.data.id, imageFile)
            if (uploadResponse?.success) {
              toast.success('Product created and image uploaded successfully')
            } else {
              toast.success('Product created successfully, but image upload failed')
            }
          } catch (uploadError) {
            console.error('Error uploading image:', uploadError)
            toast.success('Product created successfully, but image upload failed')
          }
        } else {
          toast.success('Product created successfully')
        }
        setShowForm(false)
        loadProducts()
      } else {
        toast.error(response?.message || 'Failed to create product')
      }
    } catch (error) {
      console.error('Error creating product:', error)
      if (!error?._handledByInterceptor) {
        const data = error?.response?.data
        const status = error?.response?.status
        if (status === 409) {
          const msg = data?.message || 'This SKU already exists for your company.'
          toast.error(`${msg} Use a different SKU or edit the existing product.`, { duration: 6000 })
          loadProducts()
        } else {
          const msg = data?.message || error?.message || 'Failed to create product'
          const errors = data?.errors
          const fullMsg = errors?.length ? `${msg} (${errors.join(', ')})` : msg
          toast.error(fullMsg, { duration: 6000 })
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateProduct = async (id, productData, imageFile = null) => {
    // Prevent multiple clicks
    if (saving) {
      toast.error('Please wait, operation in progress...')
      return
    }

    if (!id) {
      toast.error('Invalid product ID')
      return
    }

    // Validate input
    if (!productData.nameEn || productData.nameEn.trim().length === 0) {
      toast.error('Product name is required')
      return
    }
    if (productData.sellPrice < 0 || productData.costPrice < 0) {
      toast.error('Prices cannot be negative')
      return
    }
    if (productData.sellPrice > 1000000 || productData.costPrice > 1000000) {
      toast.error('Prices are too high. Maximum is 1,000,000')
      return
    }

    try {
      setSaving(true)
      const payload = { ...productData, expiryDate: productData.expiryDate?.trim() || undefined }
      const response = await productsAPI.updateProduct(id, payload)
      if (response?.success) {
        if (imageFile) {
          try {
            const uploadResponse = await productsAPI.uploadProductImage(id, imageFile)
            if (uploadResponse?.success) {
              toast.success('Product updated and image uploaded successfully')
            } else {
              toast.success('Product updated successfully, but image upload failed')
            }
          } catch (uploadError) {
            console.error('Error uploading image:', uploadError)
            toast.success('Product updated successfully, but image upload failed')
          }
        } else {
          toast.success('Product updated successfully')
        }
        setShowForm(false)
        setEditingProduct(null)
        loadProducts()
      } else {
        toast.error(response?.message || 'Failed to update product')
      }
    } catch (error) {
      console.error('Error updating product:', error)

      // Handle 409 Conflict (concurrency issue)
      if (error?.response?.status === 409) {
        const errorMsg = error?.response?.data?.message || 'Product was modified by another user. Please refresh and try again.'
        toast.error(errorMsg, { duration: 5000 })
        // Refresh products list to get latest data
        loadProducts()
      } else {
        toast.error(error?.response?.data?.message || 'Failed to update product')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteClick = (product) => {
    setDangerModal({
      isOpen: true,
      title: 'Deactivate Product',
      message: `This will deactivate ${product.nameEn || product.sku}. The product will be hidden from POS but will still appear in old invoices. You can reactivate it later.`,
      confirmLabel: 'Deactivate Product',
      requireTypedText: 'DEACTIVATE',
      onConfirm: () => handleDeleteProduct(product.id)
    })
  }

  const handleDeleteProduct = async (productId) => {
    if (!productId) {
      toast.error('Invalid product ID')
      return
    }

    try {
      const response = await productsAPI.deleteProduct(productId)
      if (response?.success) {
        toast.success('Product deactivated successfully')
        loadProducts()
      } else {
        toast.error(response?.message || 'Failed to deactivate product')
      }
    } catch (error) {
      console.error('Error deactivating product:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to deactivate product')
    }
  }

  const handleActivateProduct = async (productId) => {
    if (!productId) {
      toast.error('Invalid product ID')
      return
    }

    try {
      const response = await productsAPI.activateProduct(productId)
      if (response?.success) {
        toast.success('Product activated successfully')
        loadProducts()
      } else {
        toast.error(response?.message || 'Failed to activate product')
      }
    } catch (error) {
      console.error('Error activating product:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to activate product')
    }
  }

  const handleStockAdjustment = (product) => {
    setSelectedProduct(product)
    setShowStockModal(true)
  }

  const handleStockAdjustmentSubmit = async (adjustmentData) => {
    try {
      if (!selectedProduct?.id) {
        toast.error('Invalid product selected')
        return
      }
      let response
      try {
        response = await productsAPI.adjustStock(selectedProduct.id, {
          changeQty: Number(adjustmentData.changeQty),
          reason: adjustmentData.reason || ''
        })
      } catch (err) {
        if (err?.response?.status === 404) {
          const currentStock = Number(selectedProduct.stockQty) || 0
          const changeQty = Number(adjustmentData.changeQty) || 0
          response = await stockAdjustmentsAPI.createAdjustment({
            productId: selectedProduct.id,
            newStock: currentStock + changeQty,
            reason: adjustmentData.reason || 'Manual adjustment'
          })
        } else {
          throw err
        }
      }
      if (response?.success) {
        toast.success('Stock adjusted successfully')
        setShowStockModal(false)
        setSelectedProduct(null)
        await loadProducts()
      } else {
        toast.error(response?.message || 'Failed to adjust stock')
      }
    } catch (error) {
      console.error('Error adjusting stock:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to adjust stock')
    }
  }

  const handleImportExcel = async () => {
    if (!importFile) {
      toast.error('Please select a file')
      return
    }

    try {
      setImporting(true)
      const response = await productsAPI.importExcel(importFile)
      if (response?.success) {
        setImportResult(response.data)
        toast.success(`Import completed: ${response.data.imported} new, ${response.data.updated} updated`)
      } else {
        toast.error(response?.message || 'Import failed')
      }
    } catch (error) {
      console.error('Error importing Excel:', error)
      if (!error?._handledByInterceptor) toast.error(error?.response?.data?.message || 'Failed to import Excel file')
    } finally {
      setImporting(false)
    }
  }

  const handleResetAllStock = () => {
    setDangerModal({
      isOpen: true,
      title: 'DANGER: Reset ALL Product Stock?',
      message: `This will set stock to 0 for ALL ${totalCount} products!
        This action:
        • Sets all product stock quantities to zero
        • Creates inventory adjustment records
        • Keeps all product names and details
        
        CANNOT BE UNDONE!`,
      confirmLabel: 'Reset All Stock Now',
      requireTypedText: 'RESET ALL STOCK',
      onConfirm: async () => {
        try {
          const response = await productsAPI.resetAllStock()
          if (response?.success) {
            const updatedCount = response.data?.productsUpdated || 0
            toast.success(`Stock reset complete! ${updatedCount} products set to zero stock.`, { duration: 5000 })
            await loadProducts() // Refresh to show updated stock
          } else {
            toast.error(response?.message || 'Failed to reset stock')
          }
        } catch (error) {
          console.error('Reset stock error:', error)
          if (!error?._handledByInterceptor) {
            const errorMsg = error?.response?.data?.message || error?.message || 'Failed to reset stock'
            toast.error(`Reset failed: ${errorMsg}`)
          }
        }
      }
    })
  }

  const tabs = [
    { id: 'all', label: 'All Products', icon: Package },
    { id: 'lowStock', label: 'Low Stock', icon: AlertTriangle, badge: products.filter(p => p.stockQty <= (p.reorderLevel || 0)).length },
    { id: 'inactive', label: 'Inactive', icon: Trash2, badge: products.filter(p => !p.isActive).length }
  ]

  const handleCreateCategory = async () => {
    if (!categoryFormData.name || !categoryFormData.name.trim()) {
      toast.error('Category name is required')
      return
    }

    try {
      const response = editingCategory
        ? await productCategoriesAPI.updateCategory(editingCategory.id, categoryFormData)
        : await productCategoriesAPI.createCategory(categoryFormData)
      
      if (response?.success) {
        toast.success(editingCategory ? 'Category updated successfully' : 'Category created successfully')
        setShowCategoryModal(false)
        setEditingCategory(null)
        setCategoryFormData({ name: '', description: '', colorCode: '#3B82F6' })
        // Reload categories
        const catResponse = await productCategoriesAPI.getCategories()
        if (catResponse?.success && catResponse?.data) {
          setCategories(catResponse.data)
        }
      } else {
        toast.error(response?.message || 'Failed to save category')
      }
    } catch (error) {
      console.error('Error saving category:', error)
      if (!error?._handledByInterceptor) {
        toast.error(error?.response?.data?.message || 'Failed to save category')
      }
    }
  }

  const handleDeleteCategory = async (categoryId) => {
    try {
      const response = await productCategoriesAPI.deleteCategory(categoryId)
      if (response?.success) {
        toast.success('Category deleted successfully')
        // Reload categories
        const catResponse = await productCategoriesAPI.getCategories()
        if (catResponse?.success && catResponse?.data) {
          setCategories(catResponse.data)
        }
      } else {
        toast.error(response?.message || 'Failed to delete category')
      }
    } catch (error) {
      console.error('Error deleting category:', error)
      if (!error?._handledByInterceptor) {
        toast.error(error?.response?.data?.message || 'Failed to delete category')
      }
    }
  }

  return (
    <div className="w-full space-y-4 lg:space-y-6">
      {/* Header — title left, actions right; filter bar full width */}
      <div className="bg-white border-b border-neutral-200 -mx-2 sm:-mx-4 lg:-mx-6 xl:-mx-10 px-4 sm:px-6 lg:px-8 xl:px-10 py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-neutral-900">Products</h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                {totalCount} Total
              </span>
            </div>
            <p className="text-xs sm:text-sm text-neutral-600 mt-0.5 sm:mt-1">Manage your inventory</p>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap gap-2 sm:space-x-3 w-full sm:w-auto">
            <button
              onClick={() => loadProducts()}
              className="inline-flex items-center justify-center px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 border border-neutral-300 rounded-lg text-xs sm:text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 transition-colors flex-1 sm:flex-none min-h-[44px] sm:min-h-0"
            >
              <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            {canManageInventory && (
              <button
                onClick={async () => {
                  try {
                    const res = await productsAPI.recomputeStock()
                    if (res?.success) {
                      const n = res?.data?.productsUpdated ?? 0
                      toast.success(`Stock recomputed from inventory movements (${n} products).`)
                      await loadProducts()
                    } else toast.error(res?.message || 'Recompute failed')
                  } catch (e) {
                    toast.error(e?.response?.data?.message || 'Recompute failed')
                  }
                }}
                className="inline-flex items-center justify-center px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 border border-primary-300 rounded-lg text-xs sm:text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors flex-1 sm:flex-none min-h-[44px] sm:min-h-0"
                title="Recompute stock from purchase/sale movements (fix drift)"
              >
                <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Recompute Stock</span>
                <span className="sm:hidden">Recompute</span>
              </button>
            )}
            {canManageInventory && (
              <button
                onClick={handleResetAllStock}
                className="inline-flex items-center justify-center px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 border border-error/30 rounded-lg text-xs sm:text-sm font-medium text-error bg-error/10 hover:bg-error/20 transition-colors flex-1 sm:flex-none min-h-[44px] sm:min-h-0"
                title="Reset all product stock to zero (Admin/Owner only)"
              >
                <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Reset Stock</span>
                <span className="sm:hidden">Reset</span>
              </button>
            )}
            {canManageInventory && (
              <>
                <button
                  onClick={() => {
                    setEditingCategory(null)
                    setCategoryFormData({ name: '', description: '', colorCode: '#3B82F6' })
                    setShowCategoryModal(true)
                  }}
                  className="inline-flex items-center justify-center px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 border border-neutral-300 rounded-lg text-xs sm:text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 transition-colors flex-1 sm:flex-none min-h-[44px] sm:min-h-0"
                  title="Manage Categories"
                >
                  <Tag className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Categories</span>
                  <span className="sm:hidden">Cats</span>
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center justify-center px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 border border-neutral-300 rounded-lg text-xs sm:text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 transition-colors flex-1 sm:flex-none min-h-[44px] sm:min-h-0"
                >
                  <Upload className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Import Excel</span>
                  <span className="sm:hidden">Import</span>
                </button>
              </>
            )}
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center justify-center px-2 sm:px-3 lg:px-4 py-1.5 sm:py-2 border border-transparent rounded-lg text-xs sm:text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors flex-1 sm:flex-none min-h-[44px]"
            >
              <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">Add Product</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </div>

        {/* Banner: any products with 0 stock after purchases → run Recompute Stock */}
        {products.length > 0 && (() => {
          const zeroCount = products.filter(p => (p.stockQty ?? 0) === 0).length
          const showBanner = zeroCount > 0 && canManageInventory
          if (!showBanner) return null
          return (
            <div className="mt-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-amber-900">
                <AlertTriangle className="inline h-4 w-4 mr-1.5 align-middle text-amber-600" />
                <strong>Stocks showing zero after purchases?</strong> Click <strong>Recompute Stock</strong> below to sync from purchase and sales movements ({zeroCount} product{zeroCount !== 1 ? 's' : ''} with 0 stock).
              </p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await productsAPI.recomputeStock()
                    if (res?.success) {
                      const n = res?.data?.productsUpdated ?? res?.data?.ProductsUpdated ?? 0
                      toast.success(res?.message || `Stock recomputed (${n} products).`)
                      await loadProducts()
                    } else toast.error(res?.message || 'Recompute failed')
                  } catch (e) {
                    toast.error(e?.response?.data?.message || 'Recompute failed')
                  }
                }}
                className="shrink-0 inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-200 text-amber-900 hover:bg-amber-300"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Recompute Stock
              </button>
            </div>
          )
        })()}

        {/* Modern Tabs */}
        <div className="mt-4">
          <TabNavigation
            tabs={tabs}
            activeTab={activeTab}
            onChange={(tab) => {
              setActiveTab(tab)
              setCurrentPage(1)
            }}
          />
        </div>
      </div>

      {/* Modern Search & Filters */}
      <FilterPanel
        searchPlaceholder="Search products by name, SKU..."
        onSearchChange={(value) => {
          setSearchTerm(value)
          setCurrentPage(1)
        }}
        filters={[
          {
            key: 'unitType', label: 'Qty Type', options: [
              { value: 'KG', label: 'KG' },
              { value: 'CRTN', label: 'CRTN' },
              { value: 'CTN', label: 'CTN' },
              { value: 'PIECE', label: 'PIECE' },
              { value: 'PCS', label: 'PCS' },
              { value: 'BOX', label: 'BOX' },
              { value: 'PKG', label: 'PKG' },
              { value: 'BAG', label: 'BAG' },
              { value: 'PC', label: 'PC' },
              { value: 'UNIT', label: 'UNIT' }
            ]
          },
          {
            key: 'categoryId', label: 'Category', options: [
              { value: '', label: 'All Categories' },
              ...categories.map(cat => ({ value: cat.id.toString(), label: cat.name }))
            ]
          }
        ]}
        activeFilters={activeFilters}
        onFilterChange={setActiveFilters}
      />

      {/* Modern Products Table */}
      <ModernTable
        data={products}
        loading={loading}
        columns={[
          {
            key: 'imageUrl',
            label: 'Image',
            sortable: false,
            render: (product) => {
              if (product.imageUrl) {
                return (
                  <div className="relative">
                    <img 
                      src={product.imageUrl.startsWith('http') || product.imageUrl.startsWith('/') 
                        ? product.imageUrl 
                        : `/uploads/${product.imageUrl}`}
                      alt={product.nameEn}
                      className="h-10 w-10 object-cover rounded border border-gray-200"
                      onError={(e) => {
                        e.target.style.display = 'none'
                        const placeholder = e.target.parentElement.querySelector('.image-placeholder')
                        if (placeholder) placeholder.style.display = 'flex'
                      }}
                    />
                    <div className="image-placeholder h-10 w-10 bg-gray-100 rounded border border-gray-200 flex items-center justify-center" style={{ display: 'none' }}>
                      <ImageIcon className="h-4 w-4 text-gray-400" />
                    </div>
                  </div>
                )
              }
              return (
                <div className="h-10 w-10 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                  <ImageIcon className="h-4 w-4 text-gray-400" />
                </div>
              )
            }
          },
          { key: 'sku', label: 'SKU', sortable: true },
          { 
            key: 'nameEn', 
            label: 'Name (EN)', 
            sortable: true,
            render: (product) => (
              <div className="flex items-center gap-2">
                <span>{product.nameEn}</span>
                {product.isActive === false && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                    Inactive
                  </span>
                )}
              </div>
            )
          },
          {
            key: 'barcode',
            label: 'Barcode',
            sortable: true,
            render: (product) => (
              product.barcode ? (
                <span className="font-mono text-xs text-gray-600">{product.barcode}</span>
              ) : (
                <span className="text-gray-400 text-xs">—</span>
              )
            )
          },
          {
            key: 'categoryName',
            label: 'Category',
            sortable: true,
            render: (product) => (
              product.categoryName ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                  {product.categoryName}
                </span>
              ) : (
                <span className="text-gray-400 text-xs">—</span>
              )
            )
          },
          { key: 'unitType', label: 'Qty', sortable: true },
          {
            key: 'stockQty',
            label: 'Stock',
            sortable: true,
            render: (product) => (
              <div className="flex items-center">
                <span className={product.stockQty <= (product.reorderLevel || 0) ? 'text-red-600 font-medium' : ''}>
                  {product.stockQty ?? 0}
                </span>
                {product.stockQty <= (product.reorderLevel || 0) && (
                  <AlertTriangle className="h-4 w-4 text-red-500 ml-1" />
                )}
              </div>
            )
          },
          { key: 'sellPrice', label: 'Price', sortable: true, render: (p) => `AED ${Number(p.sellPrice || 0).toFixed(2)}` },
          {
            key: 'expiryDate',
            label: 'Expiry',
            sortable: true,
            render: (product) => {
              if (!product.expiryDate) return <span className="text-gray-500 text-xs">No expiry</span>;
              const expiryDate = new Date(product.expiryDate);
              const today = new Date();
              const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

              if (daysUntilExpiry < 0) {
                return <span className="text-red-600 font-medium text-xs">Expired</span>;
              } else if (daysUntilExpiry <= 30) {
                return <span className="text-orange-600 font-medium text-xs">{daysUntilExpiry}d left</span>;
              } else {
                return <span className="text-gray-600 text-xs">{expiryDate.toLocaleDateString()}</span>;
              }
            }
          }
        ]}
        actions={(product) => (
          <div className="flex space-x-2">
            {canManageInventory && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingProduct(product)
                  setShowForm(true)
                }}
                className="bg-primary-50 text-primary-600 hover:text-white hover:bg-primary-600 border border-primary-200 p-1.5 sm:p-2 rounded transition-colors flex items-center gap-1 min-h-[44px] sm:min-h-0"
                title="Edit Product"
                aria-label="Edit Product"
              >
                <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline text-xs font-medium">Edit</span>
              </button>
            )}
            {canAdjustStock && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleStockAdjustment(product)
                }}
                className="bg-green-50 text-green-600 hover:text-white hover:bg-green-600 border border-green-300 p-1.5 sm:p-2 rounded transition-colors shadow-sm flex items-center gap-1"
                title="Adjust Stock"
                aria-label="Adjust Stock"
              >
                <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline text-xs font-medium">Stock</span>
              </button>
            )}
            {canManageInventory && (
              product.isActive === false ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleActivateProduct(product.id)
                  }}
                  className="bg-green-50 text-green-600 hover:text-white hover:bg-green-600 border border-green-300 p-1.5 sm:p-2 rounded transition-colors flex items-center gap-1 min-h-[44px] sm:min-h-0"
                  title="Activate Product"
                  aria-label="Activate Product"
                >
                  <RotateCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline text-xs font-medium">Activate</span>
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteClick(product)
                  }}
                  className="bg-error/10 text-error hover:text-white hover:bg-error border border-error/30 p-1.5 sm:p-2 rounded transition-colors flex items-center gap-1 min-h-[44px] sm:min-h-0"
                  title="Deactivate Product"
                  aria-label="Deactivate Product"
                >
                  <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline text-xs font-medium">Deactivate</span>
                </button>
              )
            )}
          </div>
        )}
      />

      {/* Pagination */}
      {
        (totalPages > 1 || totalCount > 10) && (
          <div className="flex flex-wrap justify-center items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-600">Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setCurrentPage(1)
                }}
                className="border border-neutral-300 rounded px-2 py-1 text-sm"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 border border-neutral-300 rounded-lg text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="flex items-center px-4 text-sm text-neutral-600">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 border border-neutral-300 rounded-lg text-sm font-medium text-neutral-700 bg-white hover:bg-neutral-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )
      }

      {/* Product Form Modal */}
      {
        showForm && (
          <ProductForm
            product={editingProduct}
            saving={saving}
            onSave={(data, imageFile) => editingProduct ? handleUpdateProduct(editingProduct.id, data, imageFile) : handleCreateProduct(data, imageFile)}
            onCancel={() => {
              setShowForm(false)
              setEditingProduct(null)
              setSaving(false)
            }}
          />
        )
      }

      {/* Stock Adjustment Modal */}
      {
        showStockModal && selectedProduct && (
          <StockAdjustmentModal
            product={selectedProduct}
            onSave={handleStockAdjustmentSubmit}
            onCancel={() => {
              setShowStockModal(false)
              setSelectedProduct(null)
            }}
          />
        )
      }

      {/* Excel Import Modal */}
      {
        showImportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900">Import Products from Excel</h2>
                  <button
                    onClick={() => {
                      setShowImportModal(false)
                      setImportFile(null)
                      setImportResult(null)
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>

                {!importResult ? (
                  <div className="space-y-4">
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-sm text-gray-600 mb-2">
                        Upload Excel file (.xlsx or .xls)
                      </p>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                        className="hidden"
                        id="excel-file-input"
                      />
                      <label
                        htmlFor="excel-file-input"
                        className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700"
                      >
                        Choose File
                      </label>
                      {importFile && (
                        <p className="mt-2 text-sm text-gray-700">
                          Selected: {importFile.name}
                        </p>
                      )}
                    </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm text-blue-800 mb-2">
                        <strong>How to Import Products:</strong>
                      </p>
                      <ol className="text-sm text-blue-800 list-decimal list-inside space-y-1 mb-3">
                        <li>Prepare your Excel file (.xlsx or .xls)</li>
                        <li>Include columns: Product Name, SKU, Price, Cost Price, Category, Brand, Unit</li>
                        <li>Click "Choose File" and select your Excel file</li>
                        <li>Click "Import" to automatically create products</li>
                      </ol>
                      <p className="text-sm text-blue-800">
                        <strong>Auto-Detection:</strong> The system automatically detects columns even if headers differ:
                        <br />• Product Name / Item Name / Description
                        <br />• SKU / Code / Barcode
                        <br />• Price / Rate / MRP / Sale Price
                        <br />• Cost Price / Purchase Price
                        <br />• Category / Brand
                        <br />• Unit / Size / Weight
                        <br />• Tax / GST / VAT percentage
                      </p>
                      <p className="text-xs text-blue-700 mt-2 italic">
                        Tip: Existing products with same SKU will be updated, new products will be created automatically.
                      </p>
                    </div>

                    <div className="flex justify-end space-x-3">
                      <button
                        onClick={() => {
                          setShowImportModal(false)
                          setImportFile(null)
                        }}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleImportExcel}
                        disabled={!importFile || importing}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {importing ? 'Importing...' : 'Import'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-lg ${importResult.errors > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
                      <h3 className="font-semibold mb-3 text-lg">Import Completed Successfully!</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                        <div className="bg-white p-2 rounded">
                          <div className="text-gray-600">Total Rows Processed</div>
                          <div className="text-xl font-bold text-gray-900">{importResult.totalRows}</div>
                        </div>
                        <div className="bg-white p-2 rounded">
                          <div className="text-green-600">New Products Created</div>
                          <div className="text-xl font-bold text-green-600">{importResult.imported}</div>
                        </div>
                        <div className="bg-white p-2 rounded">
                          <div className="text-blue-600">Existing Products Updated</div>
                          <div className="text-xl font-bold text-blue-600">{importResult.updated}</div>
                        </div>
                        <div className="bg-white p-2 rounded">
                          <div className="text-gray-600">Skipped (Duplicates)</div>
                          <div className="text-xl font-bold text-gray-600">{importResult.skipped}</div>
                        </div>
                        {importResult.errors > 0 && (
                          <div className="bg-white p-2 rounded col-span-2 border-2 border-red-300">
                            <div className="text-red-600 font-semibold">Errors Found</div>
                            <div className="text-xl font-bold text-red-600">{importResult.errors}</div>
                          </div>
                        )}
                      </div>
                      {importResult.createdCategories && importResult.createdCategories.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-xs text-gray-600 mb-1">Auto-created categories:</p>
                          <div className="flex flex-wrap gap-1">
                            {importResult.createdCategories.slice(0, 10).map((cat, idx) => (
                              <span key={idx} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                                {cat}
                              </span>
                            ))}
                            {importResult.createdCategories.length > 10 && (
                              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                                +{importResult.createdCategories.length - 10} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {importResult.createdBrands && importResult.createdBrands.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-600 mb-1">Auto-created brands:</p>
                          <div className="flex flex-wrap gap-1">
                            {importResult.createdBrands.slice(0, 10).map((brand, idx) => (
                              <span key={idx} className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                                {brand}
                              </span>
                            ))}
                            {importResult.createdBrands.length > 10 && (
                              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                                +{importResult.createdBrands.length - 10} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {importResult.errorMessages && importResult.errorMessages.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-40 overflow-y-auto">
                        <h4 className="font-semibold text-red-800 mb-2">Errors:</h4>
                        <ul className="text-sm text-red-700 space-y-1">
                          {importResult.errorMessages.slice(0, 10).map((msg, idx) => (
                            <li key={idx}>• {msg}</li>
                          ))}
                          {importResult.errorMessages.length > 10 && (
                            <li>... and {importResult.errorMessages.length - 10} more</li>
                          )}
                        </ul>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          setShowImportModal(false)
                          setImportFile(null)
                          setImportResult(null)
                          loadProducts()
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }

      <ConfirmDangerModal
        isOpen={dangerModal.isOpen}
        title={dangerModal.title}
        message={dangerModal.message}
        confirmLabel={dangerModal.confirmLabel}
        requireTypedText={dangerModal.requireTypedText}
        onConfirm={dangerModal.onConfirm}
        onClose={() => setDangerModal(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Category Management Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingCategory ? 'Edit Category' : 'Manage Categories'}
              </h2>
              <button
                onClick={() => {
                  setShowCategoryModal(false)
                  setEditingCategory(null)
                  setCategoryFormData({ name: '', description: '', colorCode: '#3B82F6' })
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Create/Edit Category Form */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-4">
                {editingCategory ? 'Edit Category' : 'Create New Category'}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Category Name *
                  </label>
                  <input
                    type="text"
                    value={categoryFormData.name}
                    onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
                    className="input"
                    placeholder="e.g., Dairy, Beverages, Snacks"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Description (Optional)
                  </label>
                  <textarea
                    value={categoryFormData.description}
                    onChange={(e) => setCategoryFormData({ ...categoryFormData, description: e.target.value })}
                    className="input"
                    rows="2"
                    placeholder="Category description"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Color
                  </label>
                  <input
                    type="color"
                    value={categoryFormData.colorCode}
                    onChange={(e) => setCategoryFormData({ ...categoryFormData, colorCode: e.target.value })}
                    className="h-10 w-20 rounded border border-gray-300"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateCategory}
                    disabled={!categoryFormData.name.trim()}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {editingCategory ? 'Update Category' : 'Create Category'}
                  </button>
                  {editingCategory && (
                    <button
                      onClick={() => {
                        setEditingCategory(null)
                        setCategoryFormData({ name: '', description: '', colorCode: '#3B82F6' })
                      }}
                      className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Categories List */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-4">Existing Categories</h3>
              {categories.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No categories created yet</p>
              ) : (
                <div className="space-y-2">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: cat.colorCode || '#3B82F6' }}
                        />
                        <div>
                          <div className="font-medium text-gray-900">{cat.name}</div>
                          {cat.description && (
                            <div className="text-xs text-gray-500">{cat.description}</div>
                          )}
                          <div className="text-xs text-gray-400">{cat.productCount || 0} products</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingCategory(cat)
                            setCategoryFormData({
                              name: cat.name,
                              description: cat.description || '',
                              colorCode: cat.colorCode || '#3B82F6'
                            })
                          }}
                          className="px-3 py-1 text-sm bg-primary-50 text-primary-600 rounded hover:bg-primary-100 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete category "${cat.name}"? Products in this category will be unassigned.`)) {
                              handleDeleteCategory(cat.id)
                            }
                          }}
                          className="px-3 py-1 text-sm bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div >
  )
}

export default ProductsPage

