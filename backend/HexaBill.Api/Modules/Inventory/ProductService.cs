/*
Purpose: Product service for inventory management
Author: AI Assistant
Date: 2024
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;

namespace HexaBill.Api.Modules.Inventory
{
    public interface IProductService
    {
        // MULTI-TENANT: All methods now require tenantId for data isolation
        Task<PagedResponse<ProductDto>> GetProductsAsync(int tenantId, int page = 1, int pageSize = 10, string? search = null, bool lowStock = false, string? unitType = null, int? categoryId = null, bool includeInactive = false, int? globalLowStockThreshold = null);
        Task<bool> ActivateProductAsync(int id, int tenantId);
        Task<ProductDto?> GetProductByIdAsync(int id, int tenantId);
        Task<ProductDto> CreateProductAsync(CreateProductRequest request, int tenantId);
        Task<ProductDto?> UpdateProductAsync(int id, CreateProductRequest request, int tenantId, int? userId = null);
        Task<bool> DeleteProductAsync(int id, int tenantId);
        Task<bool> AdjustStockAsync(int productId, decimal changeQty, string reason, int userId, int tenantId);
        Task<PagedResponse<ProductDto>> GetLowStockProductsAsync(int tenantId, int page = 1, int pageSize = 50, int? globalLowStockThreshold = null);
        Task<List<ProductDto>> SearchProductsAsync(string query, int tenantId, int limit = 20);
        Task<List<PriceChangeLogDto>> GetPriceChangeHistoryAsync(int productId, int tenantId);
        Task<int> ResetAllStockAsync(int userId, int tenantId);
        Task<BulkPriceUpdateResponse> BulkUpdatePricesAsync(BulkPriceUpdateRequest request, int tenantId, int? userId = null);
        /// <summary>Recompute Product.StockQty from InventoryTransactions (SUM of ChangeQty per product). Use to repair drift.</summary>
        Task<int> RecomputeStockFromMovementsAsync(int tenantId);
    }

    public class ProductService : IProductService
    {
        private readonly AppDbContext _context;

        public ProductService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<PagedResponse<ProductDto>> GetProductsAsync(int tenantId, int page = 1, int pageSize = 10, string? search = null, bool lowStock = false, string? unitType = null, int? categoryId = null, bool includeInactive = false, int? globalLowStockThreshold = null)
        {
            // CRITICAL: Filter by tenantId for data isolation
            // By default, only show active products (IsActive = true)
            // Set includeInactive = true to show all products including deactivated ones
            
            // Try to include Category, but handle gracefully if table doesn't exist yet
            IQueryable<Product> query;
            try
            {
                query = _context.Products
                    .Include(p => p.Category) // Include category for display
                    .Where(p => p.TenantId == tenantId)
                    .AsQueryable();
            }
            catch
            {
                // Fallback if Category navigation doesn't work (migration not run)
                query = _context.Products
                    .Where(p => p.TenantId == tenantId)
                    .AsQueryable();
            }

            // Filter by active status unless explicitly including inactive products
            if (!includeInactive)
            {
                query = query.Where(p => p.IsActive);
            }

            if (!string.IsNullOrEmpty(search))
            {
                // Try to include category in search, but handle if Category navigation doesn't exist
                try
                {
                    query = query.Where(p => p.NameEn.Contains(search) || 
                                           p.NameAr!.Contains(search) || 
                                           p.Sku.Contains(search) ||
                                           (p.Barcode != null && p.Barcode.Contains(search)) ||
                                           (p.Category != null && p.Category.Name.Contains(search)));
                }
                catch
                {
                    // Fallback search without category (if migration not run)
                    query = query.Where(p => p.NameEn.Contains(search) || 
                                           p.NameAr!.Contains(search) || 
                                           p.Sku.Contains(search) ||
                                           (p.Barcode != null && p.Barcode.Contains(search)));
                }
            }

            if (lowStock)
            {
                // #55: Per-product ReorderLevel, or global fallback for products with ReorderLevel 0
                if (globalLowStockThreshold.HasValue && globalLowStockThreshold.Value > 0)
                    query = query.Where(p => (p.ReorderLevel > 0 && p.StockQty <= p.ReorderLevel) || (p.ReorderLevel == 0 && p.StockQty <= globalLowStockThreshold.Value));
                else
                    query = query.Where(p => p.ReorderLevel > 0 && p.StockQty <= p.ReorderLevel);
            }

            if (!string.IsNullOrEmpty(unitType))
            {
                query = query.Where(p => p.UnitType == unitType);
            }

            if (categoryId.HasValue && categoryId.Value > 0)
            {
                try
                {
                    query = query.Where(p => p.CategoryId == categoryId.Value);
                }
                catch
                {
                    // CategoryId column might not exist yet - skip filter
                }
            }

            var totalCount = await query.CountAsync();
            
            // Try to select with Category, fallback if it doesn't exist
            List<ProductDto> products;
            try
            {
                products = await query
                    .OrderBy(p => p.NameEn)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .Select(p => new ProductDto
                    {
                        Id = p.Id,
                        Sku = p.Sku,
                        Barcode = p.Barcode,
                        NameEn = p.NameEn,
                        NameAr = p.NameAr,
                        UnitType = p.UnitType,
                        ConversionToBase = p.ConversionToBase,
                        CostPrice = p.CostPrice,
                        SellPrice = p.SellPrice,
                        StockQty = p.StockQty,
                        ReorderLevel = p.ReorderLevel,
                        ExpiryDate = p.ExpiryDate,
                        DescriptionEn = p.DescriptionEn,
                        DescriptionAr = p.DescriptionAr,
                        CategoryId = p.CategoryId,
                        CategoryName = p.Category != null ? p.Category.Name : null,
                        ImageUrl = p.ImageUrl,
                        IsActive = p.IsActive
                    })
                    .ToListAsync();
            }
            catch
            {
                // Fallback if CategoryId or Category navigation doesn't exist
                products = await query
                    .OrderBy(p => p.NameEn)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .Select(p => new ProductDto
                    {
                        Id = p.Id,
                        Sku = p.Sku,
                        Barcode = p.Barcode ?? null,
                        NameEn = p.NameEn,
                        NameAr = p.NameAr,
                        UnitType = p.UnitType,
                        ConversionToBase = p.ConversionToBase,
                        CostPrice = p.CostPrice,
                        SellPrice = p.SellPrice,
                        StockQty = p.StockQty,
                        ReorderLevel = p.ReorderLevel,
                        ExpiryDate = p.ExpiryDate,
                        DescriptionEn = p.DescriptionEn,
                        DescriptionAr = p.DescriptionAr,
                        CategoryId = null,
                        CategoryName = null,
                        ImageUrl = null,
                        IsActive = p.IsActive
                    })
                    .ToListAsync();
            }

            return new PagedResponse<ProductDto>
            {
                Items = products,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
            };
        }

        public async Task<ProductDto?> GetProductByIdAsync(int id, int tenantId)
        {
            // CRITICAL: Verify product belongs to owner
            Product? product;
            try
            {
                product = await _context.Products
                    .Include(p => p.Category)
                    .Where(p => p.Id == id && p.TenantId == tenantId)
                    .FirstOrDefaultAsync();
            }
            catch
            {
                // Fallback if Category navigation doesn't exist
                product = await _context.Products
                    .Where(p => p.Id == id && p.TenantId == tenantId)
                    .FirstOrDefaultAsync();
            }
                
            if (product == null) return null;

            return new ProductDto
            {
                Id = product.Id,
                Sku = product.Sku,
                Barcode = product.Barcode,
                NameEn = product.NameEn,
                NameAr = product.NameAr,
                UnitType = product.UnitType,
                ConversionToBase = product.ConversionToBase,
                CostPrice = product.CostPrice,
                SellPrice = product.SellPrice,
                StockQty = product.StockQty,
                ReorderLevel = product.ReorderLevel,
                ExpiryDate = product.ExpiryDate,
                DescriptionEn = product.DescriptionEn,
                DescriptionAr = product.DescriptionAr,
                CategoryId = product.CategoryId,
                CategoryName = product.Category != null ? product.Category.Name : null,
                ImageUrl = product.ImageUrl,
                IsActive = product.IsActive
            };
        }

        public async Task<ProductDto> CreateProductAsync(CreateProductRequest request, int tenantId)
        {
            // Validate input
            if (string.IsNullOrWhiteSpace(request.NameEn))
                throw new InvalidOperationException("Product name is required");
            
            if (!InputValidator.ValidateSKU(request.Sku))
                throw new InvalidOperationException("Invalid SKU format");
            
            if (!InputValidator.ValidatePrice(request.SellPrice) || !InputValidator.ValidatePrice(request.CostPrice))
                throw new InvalidOperationException("Invalid price. Prices must be between 0 and 1,000,000");

            // CRITICAL: Check SKU uniqueness within owner's scope only
            if (await _context.Products.AnyAsync(p => p.Sku == request.Sku && p.TenantId == tenantId))
            {
                throw new InvalidOperationException("SKU already exists");
            }

            // Check barcode uniqueness if provided (barcode should be unique per tenant)
            if (!string.IsNullOrWhiteSpace(request.Barcode))
            {
                if (await _context.Products.AnyAsync(p => p.Barcode == request.Barcode && p.TenantId == tenantId))
                {
                    throw new InvalidOperationException("Barcode already exists for another product");
                }
            }

            var product = new Product
            {
                TenantId = tenantId,
                OwnerId = tenantId,
                Sku = InputValidator.SanitizeString(request.Sku, 50),
                Barcode = !string.IsNullOrWhiteSpace(request.Barcode) ? InputValidator.SanitizeString(request.Barcode, 100) : null,
                NameEn = InputValidator.SanitizeString(request.NameEn, 200),
                NameAr = InputValidator.SanitizeString(request.NameAr, 200),
                UnitType = InputValidator.SanitizeString(request.UnitType, 50),
                ConversionToBase = request.ConversionToBase > 0 ? request.ConversionToBase : 1,
                CostPrice = request.CostPrice >= 0 ? request.CostPrice : 0,
                SellPrice = request.SellPrice >= 0 ? request.SellPrice : 0,
                // StockQty removed - stock must be set via stock adjustment flow for proper audit trail
                StockQty = 0, // Always start at 0, use stock adjustment for opening stock
                ReorderLevel = request.ReorderLevel >= 0 ? request.ReorderLevel : 0,
                ExpiryDate = request.ExpiryDate.HasValue ? request.ExpiryDate.Value.ToUtcKind() : null,
                DescriptionEn = InputValidator.SanitizeString(request.DescriptionEn, 1000),
                DescriptionAr = InputValidator.SanitizeString(request.DescriptionAr, 1000),
                CategoryId = request.CategoryId > 0 ? request.CategoryId : null, // Validate category belongs to tenant
                ImageUrl = !string.IsNullOrWhiteSpace(request.ImageUrl) ? InputValidator.SanitizeString(request.ImageUrl, 500) : null,
                IsActive = true, // New products are active by default
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            // Validate category belongs to tenant if provided
            if (product.CategoryId.HasValue)
            {
                var categoryExists = await _context.ProductCategories
                    .AnyAsync(c => c.Id == product.CategoryId.Value && c.TenantId == tenantId && c.IsActive);
                if (!categoryExists)
                {
                    product.CategoryId = null; // Reset to null if invalid category
                }
            }

            _context.Products.Add(product);
            await _context.SaveChangesAsync();

            // Reload with category for DTO
            await _context.Entry(product).Reference(p => p.Category).LoadAsync();

            return new ProductDto
            {
                Id = product.Id,
                Sku = product.Sku,
                Barcode = product.Barcode,
                NameEn = product.NameEn,
                NameAr = product.NameAr,
                UnitType = product.UnitType,
                ConversionToBase = product.ConversionToBase,
                CostPrice = product.CostPrice,
                SellPrice = product.SellPrice,
                StockQty = product.StockQty,
                ReorderLevel = product.ReorderLevel,
                ExpiryDate = product.ExpiryDate,
                DescriptionEn = product.DescriptionEn,
                DescriptionAr = product.DescriptionAr,
                CategoryId = product.CategoryId,
                CategoryName = product.Category != null ? product.Category.Name : null,
                IsActive = product.IsActive
            };
        }

        public async Task<ProductDto?> UpdateProductAsync(int id, CreateProductRequest request, int tenantId, int? userId = null)
        {
            // Validate input
            if (string.IsNullOrWhiteSpace(request.NameEn))
                throw new InvalidOperationException("Product name is required");
            
            if (!InputValidator.ValidateSKU(request.Sku))
                throw new InvalidOperationException("Invalid SKU format");
            
            if (!InputValidator.ValidatePrice(request.SellPrice) || !InputValidator.ValidatePrice(request.CostPrice))
                throw new InvalidOperationException("Invalid price. Prices must be between 0 and 1,000,000");

            // CRITICAL: Verify product belongs to owner before updating
            var product = await _context.Products
                .Where(p => p.Id == id && p.TenantId == tenantId)
                .FirstOrDefaultAsync();
                
            if (product == null) return null;

            // CRITICAL: Check SKU uniqueness within owner's scope
            if (await _context.Products.AnyAsync(p => p.Sku == request.Sku && p.Id != id && p.TenantId == tenantId))
            {
                throw new InvalidOperationException("SKU already exists");
            }

            // Log price change if sell price changed
            if (product.SellPrice != request.SellPrice && userId.HasValue)
            {
                var priceChange = request.SellPrice - product.SellPrice;
                var percentageChange = product.SellPrice > 0 ? (priceChange / product.SellPrice) * 100 : 0;
                
                var priceLog = new PriceChangeLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    ProductId = id,
                    OldPrice = product.SellPrice,
                    NewPrice = request.SellPrice,
                    PriceDifference = percentageChange,
                    ChangedBy = userId.Value,
                    Reason = $"Product price updated",
                    ChangedAt = DateTime.UtcNow
                };
                
                _context.PriceChangeLogs.Add(priceLog);
                
                // Optional: Notify admin if price change > 10%
                if (Math.Abs(percentageChange) > 10)
                {
                    Console.WriteLine($"?? PRICE ALERT: Product {product.NameEn} price changed by {percentageChange:F2}% (was {product.SellPrice:C}, now {request.SellPrice:C})");
                }
            }

            product.Sku = InputValidator.SanitizeString(request.Sku, 50);
            product.Barcode = !string.IsNullOrWhiteSpace(request.Barcode) ? InputValidator.SanitizeString(request.Barcode, 100) : null;
            product.NameEn = InputValidator.SanitizeString(request.NameEn, 200);
            product.NameAr = InputValidator.SanitizeString(request.NameAr, 200);
            product.UnitType = InputValidator.SanitizeString(request.UnitType, 50);
            product.ConversionToBase = request.ConversionToBase > 0 ? request.ConversionToBase : product.ConversionToBase;
            product.CostPrice = request.CostPrice >= 0 ? request.CostPrice : product.CostPrice;
            product.SellPrice = request.SellPrice >= 0 ? request.SellPrice : product.SellPrice;
            product.StockQty = request.StockQty >= 0 ? request.StockQty : product.StockQty;
            product.ReorderLevel = request.ReorderLevel >= 0 ? request.ReorderLevel : product.ReorderLevel;
            product.ExpiryDate = request.ExpiryDate.HasValue ? request.ExpiryDate.Value.ToUtcKind() : null;
            product.DescriptionEn = InputValidator.SanitizeString(request.DescriptionEn, 1000);
            product.DescriptionAr = InputValidator.SanitizeString(request.DescriptionAr, 1000);
            product.ImageUrl = !string.IsNullOrWhiteSpace(request.ImageUrl) ? InputValidator.SanitizeString(request.ImageUrl, 500) : null;
            
            // Update category if provided
            if (request.CategoryId.HasValue && request.CategoryId.Value > 0)
            {
                try
                {
                    // Validate category belongs to tenant
                    var categoryExists = await _context.ProductCategories
                        .AnyAsync(c => c.Id == request.CategoryId.Value && c.TenantId == tenantId && c.IsActive);
                    if (categoryExists)
                    {
                        product.CategoryId = request.CategoryId.Value;
                    }
                    else
                    {
                        product.CategoryId = null; // Reset if invalid
                    }
                }
                catch
                {
                    // ProductCategories table might not exist yet - just set to null
                    product.CategoryId = null;
                }
            }
            else
            {
                product.CategoryId = null; // Clear category if not provided
            }
            
            product.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            // Reload with category for DTO
            await _context.Entry(product).Reference(p => p.Category).LoadAsync();

            return new ProductDto
            {
                Id = product.Id,
                Sku = product.Sku,
                Barcode = product.Barcode,
                NameEn = product.NameEn,
                NameAr = product.NameAr,
                UnitType = product.UnitType,
                ConversionToBase = product.ConversionToBase,
                CostPrice = product.CostPrice,
                SellPrice = product.SellPrice,
                StockQty = product.StockQty,
                ReorderLevel = product.ReorderLevel,
                ExpiryDate = product.ExpiryDate,
                DescriptionEn = product.DescriptionEn,
                DescriptionAr = product.DescriptionAr,
                CategoryId = product.CategoryId,
                CategoryName = product.Category != null ? product.Category.Name : null,
                IsActive = product.IsActive
            };
        }

        public async Task<bool> DeleteProductAsync(int id, int tenantId)
        {
            // CRITICAL: Verify product belongs to owner before deletion
            var product = await _context.Products
                .Where(p => p.Id == id && p.TenantId == tenantId)
                .FirstOrDefaultAsync();
                
            if (product == null) return false;

            // Soft delete: Deactivate product instead of removing it
            // This preserves product history in old invoices while hiding it from POS
            product.IsActive = false;
            product.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> ActivateProductAsync(int id, int tenantId)
        {
            // Reactivate a deactivated product
            var product = await _context.Products
                .Where(p => p.Id == id && p.TenantId == tenantId)
                .FirstOrDefaultAsync();
                
            if (product == null) return false;

            product.IsActive = true;
            product.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> AdjustStockAsync(int productId, decimal changeQty, string reason, int userId, int tenantId)
        {
            var strategy = _context.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                // CRITICAL: Verify product belongs to owner
                var product = await _context.Products
                    .Where(p => p.Id == productId && p.TenantId == tenantId)
                    .FirstOrDefaultAsync();
                    
                if (product == null) return false;

                // PROD-19: Atomic stock adjustment
                var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"UPDATE ""Products"" 
                       SET ""StockQty"" = ""StockQty"" + {changeQty}, 
                           ""UpdatedAt"" = {DateTime.UtcNow}
                       WHERE ""Id"" = {productId} 
                         AND ""TenantId"" = {tenantId}");
                
                if (rowsAffected == 0)
                {
                    throw new InvalidOperationException($"Product {productId} not found or does not belong to your tenant.");
                }
                
                await _context.Entry(product).ReloadAsync();

                // Create inventory transaction
                var inventoryTransaction = new InventoryTransaction
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    ProductId = productId,
                    ChangeQty = changeQty,
                    TransactionType = TransactionType.Adjustment,
                    Reason = reason,
                    CreatedAt = DateTime.UtcNow
                };

                _context.InventoryTransactions.Add(inventoryTransaction);

                // Create audit log
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Stock Adjustment",
                    Details = $"Product: {product.NameEn}, Change: {changeQty}, Reason: {reason}",
                    CreatedAt = DateTime.UtcNow
                };

                _context.AuditLogs.Add(auditLog);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();
                return true;
                }
                catch
                {
                    await transaction.RollbackAsync();
                    return false;
                }
            });
        }

        public async Task<PagedResponse<ProductDto>> GetLowStockProductsAsync(int tenantId, int page = 1, int pageSize = 50, int? globalLowStockThreshold = null)
        {
            // CRITICAL: Filter by tenantId and only active products. #55: per-product ReorderLevel or global fallback
            // AUDIT-6 FIX: Add pagination to prevent memory exhaustion with large product catalogs
            pageSize = Math.Min(pageSize, 100); // Max 100 items per page
            
            var query = _context.Products.Where(p => p.TenantId == tenantId && p.IsActive);
            if (globalLowStockThreshold.HasValue && globalLowStockThreshold.Value > 0)
                query = query.Where(p => (p.ReorderLevel > 0 && p.StockQty <= p.ReorderLevel) || (p.ReorderLevel == 0 && p.StockQty <= globalLowStockThreshold.Value));
            else
                query = query.Where(p => p.ReorderLevel > 0 && p.StockQty <= p.ReorderLevel);
            
            var totalCount = await query.CountAsync();
            
            var products = await query
                .OrderBy(p => p.StockQty) // Order by stock quantity (lowest first) before pagination
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(p => new ProductDto
                {
                    Id = p.Id,
                    Sku = p.Sku,
                    NameEn = p.NameEn,
                    NameAr = p.NameAr,
                    UnitType = p.UnitType,
                    ConversionToBase = p.ConversionToBase,
                    CostPrice = p.CostPrice,
                    SellPrice = p.SellPrice,
                    StockQty = p.StockQty,
                    ReorderLevel = p.ReorderLevel,
                    ExpiryDate = p.ExpiryDate,
                    DescriptionEn = p.DescriptionEn,
                    DescriptionAr = p.DescriptionAr,
                    IsActive = p.IsActive
                })
                .ToListAsync();

            return new PagedResponse<ProductDto>
            {
                Items = products,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
            };
        }

        public async Task<List<ProductDto>> SearchProductsAsync(string query, int tenantId, int limit = 20)
        {
            var searchTerm = query.ToLower();
            // CRITICAL: Filter by tenantId and only active products (for POS/search)
            List<ProductDto> products;
            try
            {
                products = await _context.Products
                    .Include(p => p.Category)
                    .Where(p => p.TenantId == tenantId && p.IsActive &&
                               (p.NameEn.ToLower().Contains(searchTerm) || 
                               (p.NameAr != null && p.NameAr.ToLower().Contains(searchTerm)) || 
                               p.Sku.ToLower().Contains(searchTerm) ||
                               (p.Barcode != null && p.Barcode.ToLower().Contains(searchTerm)) ||
                               (p.Category != null && p.Category.Name.ToLower().Contains(searchTerm))))
                    .OrderBy(p => p.NameEn)
                    .Take(limit)
                    .Select(p => new ProductDto
                    {
                        Id = p.Id,
                        Sku = p.Sku,
                        Barcode = p.Barcode,
                        NameEn = p.NameEn,
                        NameAr = p.NameAr,
                        UnitType = p.UnitType,
                        ConversionToBase = p.ConversionToBase,
                        CostPrice = p.CostPrice,
                        SellPrice = p.SellPrice,
                        StockQty = p.StockQty,
                        ReorderLevel = p.ReorderLevel,
                        ExpiryDate = p.ExpiryDate,
                        DescriptionEn = p.DescriptionEn,
                        DescriptionAr = p.DescriptionAr,
                        CategoryId = p.CategoryId,
                        CategoryName = p.Category != null ? p.Category.Name : null,
                        ImageUrl = p.ImageUrl,
                        IsActive = p.IsActive
                    })
                    .ToListAsync();
            }
            catch
            {
                // Fallback if Category navigation doesn't exist
                products = await _context.Products
                    .Where(p => p.TenantId == tenantId && p.IsActive &&
                               (p.NameEn.ToLower().Contains(searchTerm) || 
                               (p.NameAr != null && p.NameAr.ToLower().Contains(searchTerm)) || 
                               p.Sku.ToLower().Contains(searchTerm) ||
                               (p.Barcode != null && p.Barcode.ToLower().Contains(searchTerm))))
                    .OrderBy(p => p.NameEn)
                    .Take(limit)
                    .Select(p => new ProductDto
                    {
                        Id = p.Id,
                        Sku = p.Sku,
                        Barcode = p.Barcode,
                        NameEn = p.NameEn,
                        NameAr = p.NameAr,
                        UnitType = p.UnitType,
                        ConversionToBase = p.ConversionToBase,
                        CostPrice = p.CostPrice,
                        SellPrice = p.SellPrice,
                        StockQty = p.StockQty,
                        ReorderLevel = p.ReorderLevel,
                        ExpiryDate = p.ExpiryDate,
                        DescriptionEn = p.DescriptionEn,
                        DescriptionAr = p.DescriptionAr,
                        CategoryId = null,
                        CategoryName = null,
                        ImageUrl = null,
                        IsActive = p.IsActive
                    })
                    .ToListAsync();
            }

            return products;
        }

        public async Task<BulkPriceUpdateResponse> BulkUpdatePricesAsync(BulkPriceUpdateRequest request, int tenantId, int? userId = null)
        {
            var response = new BulkPriceUpdateResponse();
            
            try
            {
                // Build query with filters
                var query = _context.Products
                    .Where(p => p.TenantId == tenantId && p.IsActive)
                    .AsQueryable();

                // Apply filters
                if (!string.IsNullOrEmpty(request.UnitType))
                {
                    query = query.Where(p => p.UnitType == request.UnitType);
                }

                if (request.CategoryId.HasValue && request.CategoryId.Value > 0)
                {
                    query = query.Where(p => p.CategoryId == request.CategoryId.Value);
                }

                var products = await query.ToListAsync();
                var updatedCount = 0;

                foreach (var product in products)
                {
                    try
                    {
                        decimal? newSellPrice = null;
                        decimal? newCostPrice = null;

                        // Calculate new prices based on update type
                        if (request.UpdateSellPrice)
                        {
                            if (request.UpdateType == "percentage")
                            {
                                newSellPrice = product.SellPrice * (1 + request.Value / 100);
                            }
                            else if (request.UpdateType == "fixed")
                            {
                                newSellPrice = product.SellPrice + request.Value;
                            }
                            
                            // Ensure price doesn't go negative
                            if (newSellPrice.HasValue && newSellPrice.Value < 0)
                            {
                                response.Errors.Add($"Product {product.NameEn} (SKU: {product.Sku}): Sell price would be negative");
                                continue;
                            }
                        }

                        if (request.UpdateCostPrice)
                        {
                            if (request.UpdateType == "percentage")
                            {
                                newCostPrice = product.CostPrice * (1 + request.Value / 100);
                            }
                            else if (request.UpdateType == "fixed")
                            {
                                newCostPrice = product.CostPrice + request.Value;
                            }
                            
                            // Ensure price doesn't go negative
                            if (newCostPrice.HasValue && newCostPrice.Value < 0)
                            {
                                response.Errors.Add($"Product {product.NameEn} (SKU: {product.Sku}): Cost price would be negative");
                                continue;
                            }
                        }

                        // Update prices
                        if (newSellPrice.HasValue)
                        {
                            var oldPrice = product.SellPrice;
                            product.SellPrice = Math.Round(newSellPrice.Value, 2);
                            
                            // Log price change
                            if (userId.HasValue && oldPrice != product.SellPrice)
                            {
                                var priceChange = product.SellPrice - oldPrice;
                                var percentageChange = oldPrice > 0 ? (priceChange / oldPrice) * 100 : 0;
                                
                                var priceLog = new PriceChangeLog
                                {
                                    OwnerId = tenantId,
                                    TenantId = tenantId,
                                    ProductId = product.Id,
                                    OldPrice = oldPrice,
                                    NewPrice = product.SellPrice,
                                    PriceDifference = percentageChange,
                                    ChangedBy = userId.Value,
                                    Reason = $"Bulk price update: {request.UpdateType} {request.Value}{(request.UpdateType == "percentage" ? "%" : " AED")}",
                                    ChangedAt = DateTime.UtcNow
                                };
                                
                                _context.PriceChangeLogs.Add(priceLog);
                            }
                        }

                        if (newCostPrice.HasValue)
                        {
                            product.CostPrice = Math.Round(newCostPrice.Value, 2);
                        }

                        product.UpdatedAt = DateTime.UtcNow;
                        updatedCount++;
                    }
                    catch (Exception ex)
                    {
                        response.Errors.Add($"Error updating product {product.NameEn} (SKU: {product.Sku}): {ex.Message}");
                    }
                }

                await _context.SaveChangesAsync();
                response.ProductsUpdated = updatedCount;

                return response;
            }
            catch (Exception ex)
            {
                response.Errors.Add($"Bulk update failed: {ex.Message}");
                return response;
            }
        }

        public async Task<List<PriceChangeLogDto>> GetPriceChangeHistoryAsync(int productId, int tenantId)
        {
            // CRITICAL: Filter by tenantId
            var logs = await _context.PriceChangeLogs
                .Where(p => p.ProductId == productId && p.TenantId == tenantId)
                .OrderByDescending(p => p.ChangedAt)
                .Include(p => p.ChangedByUser)
                .Select(p => new PriceChangeLogDto
                {
                    Id = p.Id,
                    ProductId = p.ProductId,
                    OldPrice = p.OldPrice,
                    NewPrice = p.NewPrice,
                    PriceDifference = p.PriceDifference,
                    ChangedBy = p.ChangedBy,
                    ChangedByName = p.ChangedByUser != null ? p.ChangedByUser.Name : "Unknown",
                    Reason = p.Reason,
                    ChangedAt = p.ChangedAt
                })
                .ToListAsync();

            return logs;
        }

        public async Task<int> ResetAllStockAsync(int userId, int tenantId)
        {
            // CRITICAL: Only reset products owned by this owner
            var products = await _context.Products
                .Where(p => p.TenantId == tenantId)
                .ToListAsync();
            var count = 0;

            foreach (var product in products)
            {
                if (product.StockQty != 0)
                {
                    // Log stock adjustment
                    var adjustment = new InventoryTransaction
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        ProductId = product.Id,
                        ChangeQty = -product.StockQty,
                        TransactionType = TransactionType.Adjustment,
                        Reason = "Admin stock reset - All stock reset to zero",
                        CreatedAt = DateTime.UtcNow
                    };
                    _context.InventoryTransactions.Add(adjustment);

                    product.StockQty = 0;
                    product.UpdatedAt = DateTime.UtcNow;
                    count++;
                }
            }

            await _context.SaveChangesAsync();
            return count;
        }

        /// <summary>Recompute stock from inventory movements. Stock = SUM(ChangeQty) per product. Run to fix drift.</summary>
        public async Task<int> RecomputeStockFromMovementsAsync(int tenantId)
        {
            var updated = await _context.Database.ExecuteSqlInterpolatedAsync($@"
                UPDATE ""Products"" p
                SET ""StockQty"" = COALESCE((
                    SELECT SUM(it.""ChangeQty"") FROM ""InventoryTransactions"" it
                    WHERE it.""ProductId"" = p.""Id"" AND (it.""TenantId"" = p.""TenantId"" OR (it.""TenantId"" IS NULL AND p.""TenantId"" IS NULL))
                ), 0),
                ""UpdatedAt"" = (now() AT TIME ZONE 'utc')
                WHERE p.""TenantId"" = {tenantId}");
            return updated;
        }
    }
}

