/*
Purpose: Products controller for inventory management
Author: AI Assistant
Date: 2024
*/
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using HexaBill.Api.Modules.Inventory;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions; // MULTI-TENANT: Add helpers for TenantScopedController
using Microsoft.Extensions.DependencyInjection;
using HexaBill.Api.Modules.SuperAdmin;

namespace HexaBill.Api.Modules.Inventory
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize] // MULTI-TENANT: Require authentication for all endpoints
    public class ProductsController : TenantScopedController // MULTI-TENANT: Use TenantScopedController
    {
        private readonly IProductService _productService;
        private readonly IExcelImportService _excelImportService;
        private readonly HexaBill.Api.Shared.Security.IFileUploadService? _fileUploadService;
        private readonly ISettingsService _settingsService;

        public ProductsController(IProductService productService, IExcelImportService excelImportService, IServiceProvider serviceProvider, ISettingsService settingsService)
        {
            _productService = productService;
            _excelImportService = excelImportService;
            _fileUploadService = serviceProvider.GetService<HexaBill.Api.Shared.Security.IFileUploadService>();
            _settingsService = settingsService;
        }

        private async Task<int?> GetGlobalLowStockThresholdAsync()
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0) return null;
            var settings = await _settingsService.GetOwnerSettingsAsync(tenantId);
            var raw = settings.TryGetValue("LOW_STOCK_GLOBAL_THRESHOLD", out var v) ? v : null;
            if (string.IsNullOrWhiteSpace(raw) || !int.TryParse(raw.Trim(), out int threshold) || threshold <= 0) return null;
            return threshold;
        }

        [HttpGet]
        public async Task<ActionResult<ApiResponse<PagedResponse<ProductDto>>>> GetProducts(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] string? search = null,
            [FromQuery] bool lowStock = false,
            [FromQuery] string? unitType = null,
            [FromQuery] int? categoryId = null,
            [FromQuery] bool includeInactive = false)
        {
            try
            {
                // CRITICAL: Get tenantId from JWT token
                // Super Admin (owner_id = 0) - for now, return empty list since they should use dedicated admin endpoints
                var tenantId = CurrentTenantId;
                
                // Super Admin handling - if owner_id is 0, show all products (for system overview)
                if (IsSystemAdmin)
                {
                    // For Super Admin, we need to query all products or show message
                    // For now, show all products (no owner filter)
                    var context = HttpContext.RequestServices.GetRequiredService<HexaBill.Api.Data.AppDbContext>();
                    var query = context.Products.AsQueryable();
                    
                    if (!string.IsNullOrEmpty(search))
                    {
                        query = query.Where(p => p.NameEn.Contains(search) || 
                                               p.NameAr!.Contains(search) || 
                                               p.Sku.Contains(search));
                    }
                    if (lowStock)
                    {
                        query = query.Where(p => p.StockQty <= p.ReorderLevel);
                    }
                    if (!string.IsNullOrEmpty(unitType))
                    {
                        query = query.Where(p => p.UnitType == unitType);
                    }
                    
                    var totalCount = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(query);
                    var products = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToListAsync(
                        query.OrderBy(p => p.NameEn)
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
                                DescriptionAr = p.DescriptionAr
                            }));
                    
                    return Ok(new ApiResponse<PagedResponse<ProductDto>>
                    {
                        Success = true,
                        Message = $"SUPER ADMIN VIEW: {totalCount} products from ALL owners",
                        Data = new PagedResponse<ProductDto>
                        {
                            Items = products,
                            TotalCount = totalCount,
                            Page = page,
                            PageSize = pageSize,
                            TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
                        }
                    });
                }
                
                var globalThreshold = await GetGlobalLowStockThresholdAsync();
                var result = await _productService.GetProductsAsync(tenantId, page, pageSize, search, lowStock, unitType, categoryId, includeInactive, globalThreshold);
                return Ok(new ApiResponse<PagedResponse<ProductDto>>
                {
                    Success = true,
                    Message = "Products retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PagedResponse<ProductDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<ApiResponse<ProductDto>>> GetProduct(int id)
        {
            try
            {
                // CRITICAL: Get tenantId from JWT token
                var tenantId = CurrentTenantId;
                var result = await _productService.GetProductByIdAsync(id, tenantId);
                if (result == null)
                {
                    return NotFound(new ApiResponse<ProductDto>
                    {
                        Success = false,
                        Message = "Product not found"
                    });
                }

                return Ok(new ApiResponse<ProductDto>
                {
                    Success = true,
                    Message = "Product retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<ProductDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost]
        public async Task<ActionResult<ApiResponse<ProductDto>>> CreateProduct([FromBody] CreateProductRequest? request)
        {
            if (request == null)
            {
                return BadRequest(new ApiResponse<ProductDto> { Success = false, Message = "Request body is required." });
            }
            try
            {
                // CRITICAL: Get tenantId from JWT token
                var tenantId = CurrentTenantId;
                var result = await _productService.CreateProductAsync(request, tenantId);
                return CreatedAtAction(nameof(GetProduct), new { id = result.Id }, new ApiResponse<ProductDto>
                {
                    Success = true,
                    Message = "Product created successfully",
                    Data = result
                });
            }
            catch (UnauthorizedAccessException ex)
            {
                return Unauthorized(new ApiResponse<ProductDto>
                {
                    Success = false,
                    Message = "Session invalid or expired. Please log in again.",
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(new ApiResponse<ProductDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException ex)
            {
                var errorMessage = ex.InnerException?.Message ?? ex.Message;
                var isUniqueViolation = errorMessage.Contains("UNIQUE") || errorMessage.Contains("unique") 
                    || errorMessage.Contains("duplicate") || errorMessage.Contains("23505");
                if (isUniqueViolation)
                {
                    return Conflict(new ApiResponse<ProductDto>
                    {
                        Success = false,
                        Message = "Product with this SKU already exists for this tenant. Use a different SKU.",
                        Errors = new List<string> { errorMessage }
                    });
                }
                Console.WriteLine($"❌ Database Error in CreateProduct: {errorMessage}");
                return StatusCode(500, new ApiResponse<ProductDto>
                {
                    Success = false,
                    Message = "Database error while creating product.",
                    Errors = new List<string> { errorMessage }
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ CreateProduct Error: {ex.Message}");
                Console.WriteLine($"❌ Stack Trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"❌ Inner Exception: {ex.InnerException.Message}");
                }
                return StatusCode(500, new ApiResponse<ProductDto>
                {
                    Success = false,
                    Message = $"An error occurred: {ex.Message}",
                    Errors = new List<string> { ex.Message, ex.InnerException?.Message ?? "" }
                });
            }
        }

        [HttpPut("{id}")]
        public async Task<ActionResult<ApiResponse<ProductDto>>> UpdateProduct(int id, [FromBody] CreateProductRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                int? userId = userIdClaim != null && int.TryParse(userIdClaim.Value, out int uid) ? uid : null;
                
                // CRITICAL: Get tenantId from JWT token
                var tenantId = CurrentTenantId;
                var result = await _productService.UpdateProductAsync(id, request, tenantId, userId);
                if (result == null)
                {
                    return NotFound(new ApiResponse<ProductDto>
                    {
                        Success = false,
                        Message = "Product not found"
                    });
                }

                return Ok(new ApiResponse<ProductDto>
                {
                    Success = true,
                    Message = "Product updated successfully",
                    Data = result
                });
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(new ApiResponse<ProductDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<ProductDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("{id}/activate")]
        [Authorize(Roles = "Owner,Admin")]
        public async Task<ActionResult<ApiResponse<object>>> ActivateProduct(int id)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var result = await _productService.ActivateProductAsync(id, tenantId);
                if (!result)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Product not found"
                    });
                }

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = "Product activated successfully"
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpDelete("{id}")]
        [Authorize(Roles = "Owner,Admin")]
        public async Task<ActionResult<ApiResponse<object>>> DeleteProduct(int id)
        {
            try
            {
                // CRITICAL: Get tenantId from JWT token
                var tenantId = CurrentTenantId;
                var result = await _productService.DeleteProductAsync(id, tenantId);
                if (!result)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Product not found"
                    });
                }

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = "Product deactivated successfully (soft delete)"
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("{id}/adjust-stock")]
        [Authorize(Roles = "Owner,Admin,Staff")]
        public async Task<ActionResult<ApiResponse<object>>> AdjustStock(int id, [FromBody] StockAdjustmentRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                // CRITICAL: Get tenantId from JWT token
                var tenantId = CurrentTenantId;
                var result = await _productService.AdjustStockAsync(id, request.ChangeQty, request.Reason, userId, tenantId);
                if (!result)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Product not found"
                    });
                }

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = "Stock adjusted successfully"
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("low-stock")]
        public async Task<ActionResult<ApiResponse<List<ProductDto>>>> GetLowStockProducts()
        {
            try
            {
                // CRITICAL: Get tenantId from JWT token. #55: use global low-stock threshold from settings if set
                var tenantId = CurrentTenantId;
                var globalThreshold = await GetGlobalLowStockThresholdAsync();
                
                // AUDIT-6 FIX: Add pagination support
                var page = int.TryParse(Request.Query["page"].ToString(), out var p) ? p : 1;
                var pageSize = int.TryParse(Request.Query["pageSize"].ToString(), out var ps) ? Math.Min(ps, 100) : 50;
                
                var result = await _productService.GetLowStockProductsAsync(tenantId, page, pageSize, globalThreshold);
                return Ok(new ApiResponse<PagedResponse<ProductDto>>
                {
                    Success = true,
                    Message = "Low stock products retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PagedResponse<ProductDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("search")]
        public async Task<ActionResult<ApiResponse<List<ProductDto>>>> SearchProducts(
            [FromQuery] string q,
            [FromQuery] int limit = 20)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(q))
                {
                    return BadRequest(new ApiResponse<List<ProductDto>>
                    {
                        Success = false,
                        Message = "Search query is required"
                    });
                }

                // CRITICAL: Get tenantId from JWT token
                var tenantId = CurrentTenantId;
                var result = await _productService.SearchProductsAsync(q, tenantId, limit);
                return Ok(new ApiResponse<List<ProductDto>>
                {
                    Success = true,
                    Message = "Products retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<ProductDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("{id}/price-history")]
        public async Task<ActionResult<ApiResponse<List<PriceChangeLogDto>>>> GetPriceHistory(int id)
        {
            try
            {
                // CRITICAL: Get tenantId from JWT token
                var tenantId = CurrentTenantId;
                var result = await _productService.GetPriceChangeHistoryAsync(id, tenantId);
                return Ok(new ApiResponse<List<PriceChangeLogDto>>
                {
                    Success = true,
                    Message = "Price history retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<PriceChangeLogDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("import-excel")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<ExcelImportResult>>> ImportProductsFromExcel(IFormFile file)
        {
            try
            {
                if (file == null || file.Length == 0)
                {
                    return BadRequest(new ApiResponse<ExcelImportResult>
                    {
                        Success = false,
                        Message = "No file uploaded"
                    });
                }

                if (!file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) &&
                    !file.FileName.EndsWith(".xls", StringComparison.OrdinalIgnoreCase))
                {
                    return BadRequest(new ApiResponse<ExcelImportResult>
                    {
                        Success = false,
                        Message = "Invalid file type. Please upload an Excel file (.xlsx or .xls)"
                    });
                }

                var userIdClaim = User.FindFirst("UserId") ?? 
                                  User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier) ?? 
                                  User.FindFirst("id");
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId) || userId == 0)
                {
                    return Unauthorized(new ApiResponse<ExcelImportResult>
                    {
                        Success = false,
                        Message = "Invalid user authentication"
                    });
                }

                using var stream = file.OpenReadStream();
                var result = await _excelImportService.ImportProductsFromExcelAsync(stream, file.FileName, userId);

                return Ok(new ApiResponse<ExcelImportResult>
                {
                    Success = true,
                    Message = $"Import completed: {result.Imported} new, {result.Updated} updated, {result.Skipped} skipped, {result.Errors} errors",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<ExcelImportResult>
                {
                    Success = false,
                    Message = "An error occurred during import",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("reset-all-stock")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<object>>> ResetAllStock()
        {
            try
            {
                // BUG #2.11 FIX: Enhanced error handling for Reset All Stock endpoint
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier) ?? 
                                 User.FindFirst("UserId") ?? 
                                 User.FindFirst("id");
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId) || userId == 0)
                {
                    return Unauthorized(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid user authentication"
                    });
                }

                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                if (tenantId <= 0)
                {
                    return BadRequest(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid tenant context"
                    });
                }

                var result = await _productService.ResetAllStockAsync(userId, tenantId);
                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = $"Stock reset successfully for {result} products",
                    Data = new { ProductsUpdated = result }
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ ResetAllStock Error: {ex.Message}");
                Console.WriteLine(ex.StackTrace);
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner Exception: {ex.InnerException.Message}");
                }
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred while resetting stock",
                    Errors = new List<string> { ex.Message, ex.InnerException?.Message }.Where(e => !string.IsNullOrEmpty(e)).ToList()
                });
            }
        }

        /// <summary>Recompute product stock from InventoryTransactions (SUM of ChangeQty). Use to repair stock drift.</summary>
        [HttpPost("recompute-stock")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<object>>> RecomputeStockFromMovements()
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return BadRequest(new ApiResponse<object> { Success = false, Message = "Invalid tenant context." });
                var count = await _productService.RecomputeStockFromMovementsAsync(tenantId);
                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = $"Stock recomputed from inventory movements for {count} products.",
                    Data = new { ProductsUpdated = count }
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "Recompute failed",
                    Errors = new List<string> { ex.Message }
                });
            }
        }
    }

    public class StockAdjustmentRequest
    {
        public decimal ChangeQty { get; set; }
        public string Reason { get; set; } = string.Empty;
    }
}

