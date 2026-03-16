/*
Purpose: Sale service for POS billing and invoice management
Author: AI Assistant
Date: 2024
*/
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;
using System.Text.Json;
using HexaBill.Api.Modules.Notifications;
using HexaBill.Api.Modules.Customers;
using HexaBill.Api.Modules.Reports;
using HexaBill.Api.Modules.SuperAdmin;
using HexaBill.Api.Shared.Exceptions;
using HexaBill.Api.Shared.Services;
using HexaBill.Api.Shared.Validation;
using Npgsql;

namespace HexaBill.Api.Modules.Billing
{
    public interface ISaleService
    {
        // MULTI-TENANT: All methods now require tenantId for data isolation. Optional branchId/routeId filter; staff scope applied when userId and role provided.
        Task<PagedResponse<SaleDto>> GetSalesAsync(int tenantId, int page = 1, int pageSize = 10, string? search = null, int? branchId = null, int? routeId = null, int? userIdForStaff = null, string? roleForStaff = null);
        Task<SaleDto?> GetSaleByIdAsync(int id, int tenantId, HashSet<int>? allowedRouteIdsForStaff = null);
        Task<SaleDto> CreateSaleAsync(CreateSaleRequest request, int userId, int tenantId);
        Task<SaleDto> CreateSaleWithOverrideAsync(CreateSaleRequest request, string reason, int userId, int tenantId);
        Task<SaleDto> UpdateSaleAsync(int saleId, CreateSaleRequest request, int userId, int tenantId, string? editReason = null, byte[]? expectedRowVersion = null);
        Task<bool> DeleteSaleAsync(int saleId, int userId, int tenantId);
        Task<string> GenerateInvoiceNumberAsync(int tenantId);
        Task<byte[]> GenerateInvoicePdfAsync(int saleId, int tenantId, string? format = "A4");
        Task<bool> CanEditInvoiceAsync(int saleId, int userId, string userRole, int tenantId);
        Task<bool> UnlockInvoiceAsync(int saleId, int userId, string unlockReason, int tenantId);
        Task<List<InvoiceVersion>> GetInvoiceVersionsAsync(int saleId, int tenantId);
        Task<SaleDto?> RestoreInvoiceVersionAsync(int saleId, int versionNumber, int userId, int tenantId);
        Task<bool> LockOldInvoicesAsync(int tenantId); // Background job to lock invoices after 8 hours
        Task<List<SaleDto>> GetDeletedSalesAsync(int tenantId); // Get all deleted sales for audit trail
        Task<ReconciliationResult> ReconcileAllPaymentStatusAsync(int tenantId, int userId); // CRITICAL: Sync all Sale.PaymentStatus with actual payments
        Task<bool> ReconcileSalePaymentStatusAsync(int saleId, int tenantId); // Reconcile single sale payment status
    }

    public class SaleService : ISaleService
    {
        private readonly AppDbContext _context;
        private readonly IPdfService _pdfService;
        private readonly IComprehensiveBackupService _backupService;
        private readonly IInvoiceNumberService _invoiceNumberService;
        private readonly IValidationService _validationService;
        private readonly IAlertService _alertService;
        private readonly IBalanceService _balanceService;
        private readonly ITimeZoneService _timeZoneService;
        private readonly IRouteScopeService _routeScopeService;
        private readonly ISalesSchemaService _salesSchema;
        private readonly ISaleValidationService _saleValidation;
        private readonly IVatReturnValidationService _vatValidation;
        private readonly ILogger<SaleService> _logger;

        public SaleService(
            AppDbContext context, 
            IPdfService pdfService, 
            IComprehensiveBackupService backupService,
            IInvoiceNumberService invoiceNumberService,
            IValidationService validationService,
            IAlertService alertService,
            IBalanceService balanceService,
            ITimeZoneService timeZoneService,
            IRouteScopeService routeScopeService,
            ISalesSchemaService salesSchema,
            ISaleValidationService saleValidation,
            IVatReturnValidationService vatValidation,
            ILogger<SaleService> logger)
        {
            _context = context;
            _saleValidation = saleValidation;
            _vatValidation = vatValidation;
            _logger = logger;
            _pdfService = pdfService;
            _backupService = backupService;
            _invoiceNumberService = invoiceNumberService;
            _validationService = validationService;
            _alertService = alertService;
            _balanceService = balanceService;
            _timeZoneService = timeZoneService;
            _routeScopeService = routeScopeService;
            _salesSchema = salesSchema;
        }

        public async Task<PagedResponse<SaleDto>> GetSalesAsync(int tenantId, int page = 1, int pageSize = 10, string? search = null, int? branchId = null, int? routeId = null, int? userIdForStaff = null, string? roleForStaff = null)
        {
            try
            {
                // OPTIMIZATION: Use AsNoTracking for read-only queries and limit page size
                pageSize = Math.Min(pageSize, 100); // Max 100 items per page for performance
                
                // CRITICAL: Filter by tenantId for data isolation
                // SUPER ADMIN (TenantId = 0): See ALL tenants' data
                var query = _context.Sales
                    .AsNoTracking() // Performance: No change tracking needed for read-only
                    .Include(s => s.Customer)
                    .Include(s => s.Items)
                        .ThenInclude(i => i.Product)
                    .Include(s => s.CreatedByUser)
                    .Include(s => s.LastModifiedByUser)
                    .AsQueryable();

                // CRITICAL: Tenant filter - Skip for super admin (TenantId = 0)
                if (tenantId > 0)
                {
                    query = query.Where(s => s.TenantId == tenantId);
                }
                // Super admin (TenantId = 0) sees ALL tenants

                var hasBranchRoute = await _salesSchema.SalesHasBranchIdAndRouteIdAsync();
                if (hasBranchRoute)
                {
                    // Staff scope: restrict to assigned routes only
                    if (tenantId > 0 && userIdForStaff.HasValue && !string.IsNullOrEmpty(roleForStaff) && roleForStaff.Trim().Equals("Staff", StringComparison.OrdinalIgnoreCase))
                    {
                        var restrictedRouteIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userIdForStaff.Value, tenantId, roleForStaff);
                        if (restrictedRouteIds != null)
                        {
                            if (restrictedRouteIds.Length == 0)
                                return new PagedResponse<SaleDto> { Items = new List<SaleDto>(), TotalCount = 0, Page = page, PageSize = pageSize, TotalPages = 0 };
                            query = query.Where(s => s.RouteId != null && restrictedRouteIds.Contains(s.RouteId.Value));
                        }
                    }
                    if (branchId.HasValue) query = query.Where(s => s.BranchId == branchId.Value);
                    if (routeId.HasValue) query = query.Where(s => s.RouteId == routeId.Value);
                }

                // Filter deleted sales (after migration)
                query = query.Where(s => !s.IsDeleted);

                if (!string.IsNullOrEmpty(search))
                {
                    query = query.Where(s => s.InvoiceNo.Contains(search) || 
                                           (s.Customer != null && s.Customer.Name.Contains(search)));
                }

                var totalCount = await query.CountAsync();
                
                // Load into memory first to avoid database column issues
                var salesList = await query
                    .OrderByDescending(s => s.InvoiceDate)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .ToListAsync();

                var sales = salesList.Select(s => new SaleDto
                {
                    Id = s.Id,
                    OwnerId = s.TenantId ?? 0, // CRITICAL: Must include tenantId for PDF generation (mapped to OwnerId for compatibility)
                    InvoiceNo = s.InvoiceNo,
                    InvoiceDate = s.InvoiceDate,
                    CustomerId = s.CustomerId,
                    CustomerName = s.Customer != null ? s.Customer.Name : null,
                    Subtotal = s.Subtotal,
                    VatTotal = s.VatTotal,
                    Discount = s.Discount,
                    RoundOff = s.RoundOff,
                    GrandTotal = s.GrandTotal,
                    PaymentStatus = s.PaymentStatus.ToString(),
                    Notes = s.Notes,
                    Items = s.Items.Select(i => new SaleItemDto
                    {
                        Id = i.Id,
                        ProductId = i.ProductId,
                        ProductName = i.Product?.NameEn ?? "Unknown",
                        UnitType = i.UnitType,
                        Qty = i.Qty,
                        UnitPrice = i.UnitPrice,
                        Discount = i.Discount,
                        VatAmount = i.VatAmount,
                        LineTotal = i.LineTotal
                    }).ToList(),
                    CreatedAt = s.CreatedAt,
                    CreatedBy = s.CreatedByUser != null ? s.CreatedByUser.Name : "Unknown",
                    Version = s.Version,
                    IsLocked = s.IsLocked,
                    LastModifiedAt = s.LastModifiedAt,
                    LastModifiedBy = s.LastModifiedByUser != null ? s.LastModifiedByUser.Name : null,
                    EditReason = s.EditReason,
                    IsZeroInvoice = s.IsZeroInvoice,
                    RowVersion = s.RowVersion != null && s.RowVersion.Length > 0 
                        ? Convert.ToBase64String(s.RowVersion) 
                        : null
                }).ToList();

                return new PagedResponse<SaleDto>
                {
                    Items = sales,
                    TotalCount = totalCount,
                    Page = page,
                    PageSize = pageSize,
                    TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "GetSalesAsync Error: {Message}", ex.Message);
                if (ex.InnerException != null)
                {
                    _logger.LogError(ex.InnerException, "Inner Exception: {Message}", ex.InnerException.Message);
                }
                throw;
            }
        }

        public async Task<SaleDto?> GetSaleByIdAsync(int id, int tenantId, HashSet<int>? allowedRouteIdsForStaff = null)
        {
            // CRITICAL: When Sales.BranchId/RouteId columns don't exist (e.g. production), use projection only.
            var hasBranchRoute = await _salesSchema.SalesHasBranchIdAndRouteIdAsync();
            if (hasBranchRoute)
            {
                try
                {
                    return await GetSaleByIdWithBranchRouteAsync(id, tenantId, allowedRouteIdsForStaff);
                }
                catch (Exception ex)
                {
                    var pg = ex is PostgresException p ? p : ex.InnerException as PostgresException;
                    if (pg?.SqlState == "42703") // undefined_column (e.g. BranchId/RouteId missing)
                    {
                        SalesSchemaService.ClearColumnCheckCacheStatic();
                        return await GetSaleByIdProjectionAsync(id, tenantId);
                    }
                    throw;
                }
            }
            return await GetSaleByIdProjectionAsync(id, tenantId);
        }

        private async Task<SaleDto?> GetSaleByIdWithBranchRouteAsync(int id, int tenantId, HashSet<int>? allowedRouteIdsForStaff)
        {
            IQueryable<Sale> baseQuery = _context.Sales
                .AsNoTracking()
                .Where(s => s.Id == id && !s.IsDeleted);
            if (tenantId > 0) baseQuery = baseQuery.Where(s => s.TenantId == tenantId);

            var sale = await baseQuery
                .Include(s => s.Customer)
                .Include(s => s.Items).ThenInclude(i => i.Product)
                .Include(s => s.CreatedByUser)
                .Include(s => s.LastModifiedByUser)
                .FirstOrDefaultAsync();
            if (sale == null) return null;
            if (allowedRouteIdsForStaff != null && (!sale.RouteId.HasValue || !allowedRouteIdsForStaff.Contains(sale.RouteId.Value)))
                return null;

            return MapSaleToDto(sale, sale.BranchId, sale.RouteId);
        }

        private async Task<SaleDto?> GetSaleByIdProjectionAsync(int id, int tenantId)
        {
            var baseQuery = _context.Sales.AsNoTracking().Where(s => s.Id == id && !s.IsDeleted);
            if (tenantId > 0) baseQuery = baseQuery.Where(s => s.TenantId == tenantId);

            var header = await baseQuery
                .Select(s => new
                {
                    s.Id,
                    s.TenantId,
                    s.InvoiceNo,
                    s.InvoiceDate,
                    s.CustomerId,
                    s.Subtotal,
                    s.VatTotal,
                    s.Discount,
                    s.RoundOff,
                    s.GrandTotal,
                    s.PaymentStatus,
                    s.Notes,
                    s.CreatedAt,
                    s.CreatedBy,
                    s.Version,
                    s.IsLocked,
                    s.LastModifiedAt,
                    s.LastModifiedBy,
                    s.EditReason,
                    s.IsZeroInvoice,
                    s.RowVersion
                })
                .FirstOrDefaultAsync();
            if (header == null) return null;

            var customer = header.CustomerId.HasValue
                ? await _context.Customers.AsNoTracking().Where(c => c.Id == header.CustomerId.Value).Select(c => new { c.Name }).FirstOrDefaultAsync()
                : null;
            var items = await _context.SaleItems.AsNoTracking()
                .Where(si => si.SaleId == id)
                .Include(si => si.Product)
                .ToListAsync();
            var createdByUser = await _context.Users.AsNoTracking().Where(u => u.Id == header.CreatedBy).Select(u => new { u.Name }).FirstOrDefaultAsync();
            var lastModifiedByUser = header.LastModifiedBy.HasValue
                ? await _context.Users.AsNoTracking().Where(u => u.Id == header.LastModifiedBy!.Value).Select(u => new { u.Name }).FirstOrDefaultAsync()
                : null;

            return new SaleDto
            {
                Id = header.Id,
                OwnerId = header.TenantId ?? 0,
                InvoiceNo = header.InvoiceNo,
                InvoiceDate = header.InvoiceDate,
                CustomerId = header.CustomerId,
                BranchId = null,
                RouteId = null,
                CustomerName = customer?.Name,
                Subtotal = header.Subtotal,
                VatTotal = header.VatTotal,
                Discount = header.Discount,
                RoundOff = header.RoundOff,
                GrandTotal = header.GrandTotal,
                PaymentStatus = header.PaymentStatus.ToString(),
                Notes = header.Notes,
                Items = items.Select(i => new SaleItemDto
                {
                    Id = i.Id,
                    ProductId = i.ProductId,
                    ProductName = i.Product?.NameEn ?? $"Product {i.ProductId}",
                    UnitType = string.IsNullOrWhiteSpace(i.UnitType) ? (i.Product?.UnitType ?? "CRTN") : i.UnitType.ToUpper(),
                    Qty = i.Qty,
                    UnitPrice = i.UnitPrice,
                    Discount = i.Discount,
                    VatAmount = i.VatAmount,
                    LineTotal = i.LineTotal
                }).ToList(),
                CreatedAt = header.CreatedAt,
                CreatedBy = createdByUser?.Name ?? "Unknown",
                Version = header.Version,
                IsLocked = header.IsLocked,
                LastModifiedAt = header.LastModifiedAt,
                LastModifiedBy = lastModifiedByUser?.Name,
                EditReason = header.EditReason,
                IsZeroInvoice = header.IsZeroInvoice,
                RowVersion = header.RowVersion != null && header.RowVersion.Length > 0 ? Convert.ToBase64String(header.RowVersion) : null
            };
        }

        private static SaleDto MapSaleToDto(Sale sale, int? branchId, int? routeId)
        {
            return new SaleDto
            {
                Id = sale.Id,
                OwnerId = sale.TenantId ?? 0,
                InvoiceNo = sale.InvoiceNo,
                InvoiceDate = sale.InvoiceDate,
                CustomerId = sale.CustomerId,
                BranchId = branchId,
                RouteId = routeId,
                CustomerName = sale.Customer?.Name,
                Subtotal = sale.Subtotal,
                VatTotal = sale.VatTotal,
                Discount = sale.Discount,
                RoundOff = sale.RoundOff,
                GrandTotal = sale.GrandTotal,
                PaymentStatus = sale.PaymentStatus.ToString(),
                Notes = sale.Notes,
                Items = sale.Items.Select(i => new SaleItemDto
                {
                    Id = i.Id,
                    ProductId = i.ProductId,
                    ProductName = i.Product?.NameEn ?? $"Product {i.ProductId}",
                    UnitType = string.IsNullOrWhiteSpace(i.UnitType) ? (i.Product?.UnitType ?? "CRTN") : i.UnitType.ToUpper(),
                    Qty = i.Qty,
                    UnitPrice = i.UnitPrice,
                    Discount = i.Discount,
                    VatAmount = i.VatAmount,
                    LineTotal = i.LineTotal
                }).ToList(),
                CreatedAt = sale.CreatedAt,
                CreatedBy = sale.CreatedByUser?.Name ?? "Unknown",
                Version = sale.Version,
                IsLocked = sale.IsLocked,
                LastModifiedAt = sale.LastModifiedAt,
                LastModifiedBy = sale.LastModifiedByUser?.Name,
                EditReason = sale.EditReason,
                IsZeroInvoice = sale.IsZeroInvoice,
                RowVersion = sale.RowVersion != null && sale.RowVersion.Length > 0 ? Convert.ToBase64String(sale.RowVersion) : null
            };
        }

        public async Task<SaleDto> CreateSaleAsync(CreateSaleRequest request, int userId, int tenantId)
        {
            // Retry logic for invoice number conflicts (race condition handling)
            const int maxRetries = 5;
            Exception? lastException = null;
            
            for (int retryCount = 0; retryCount < maxRetries; retryCount++)
            {
                try
                {
                    return await CreateSaleInternalAsync(request, userId, tenantId);
                }
                catch (DbUpdateException ex) when (IsInvoiceNumberConflict(ex))
                {
                    lastException = ex;
                    
                    if (retryCount < maxRetries - 1)
                    {
                        // Race condition: Another transaction saved the same invoice number
                        _logger.LogWarning("Invoice number conflict detected (attempt {Attempt}/{Max}). Retrying with new number", retryCount + 1, maxRetries);
                        
                        // Clear the invoice number to force regeneration
                        request.InvoiceNo = null;
                        
                        // Exponential backoff: 50ms, 100ms, 200ms, 400ms
                        await Task.Delay(50 * (int)Math.Pow(2, retryCount));
                    }
                }
                catch (Exception ex)
                {
                    // Log non-duplicate errors
                    _logger.LogError(ex, "CreateSaleAsync Error: {Type}, Message: {Message}", ex.GetType().Name, ex.Message);
                    if (ex.InnerException != null)
                    {
                        _logger.LogError(ex.InnerException, "Inner Exception: {Type}, Message: {Message}", ex.InnerException.GetType().Name, ex.InnerException.Message);
                    }
                    throw; // Re-throw non-duplicate errors immediately
                }
            }
            
            // All retries exhausted
            _logger.LogError("Failed to create sale after {Retries} attempts due to invoice number conflicts", maxRetries);
            throw new InvalidOperationException(
                "Unable to generate unique invoice number after multiple attempts. This may be due to high concurrent activity. Please try again.",
                lastException
            );
        }
        
        // Helper method to detect invoice number conflict errors
        private bool IsInvoiceNumberConflict(DbUpdateException ex)
        {
            if (ex.InnerException == null) return false;
            
            var innerMessage = ex.InnerException.Message ?? string.Empty;
            return innerMessage.Contains("IX_Sales_InvoiceNo", StringComparison.OrdinalIgnoreCase) ||
                   innerMessage.Contains("duplicate key", StringComparison.OrdinalIgnoreCase);
        }
        
        private async Task<SaleDto> CreateSaleInternalAsync(CreateSaleRequest request, int userId, int tenantId)
        {
            // Log incoming request for debugging
            _logger.LogDebug("CreateSaleInternalAsync called with InvoiceNo: {InvoiceNo} for TenantId: {TenantId}, UserId: {UserId}", request.InvoiceNo ?? "NULL", tenantId, userId);
                    
            // NpgsqlRetryingExecutionStrategy does not support user-initiated transactions; wrap in execution strategy.
            var strategy = _context.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
            // Use serializable isolation to prevent concurrent invoice number conflicts
            using var transaction = await _context.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
            try
            {
                // CRITICAL FIX: Generate invoice number INSIDE transaction to prevent race conditions
                // The advisory lock in InvoiceNumberService will be held during transaction commit
                string invoiceNo;
                if (!string.IsNullOrWhiteSpace(request.InvoiceNo))
                {
                    _logger.LogDebug("Frontend provided invoice number: {InvoiceNo}", request.InvoiceNo);
                    invoiceNo = request.InvoiceNo.Trim();
                }
                else
                {
                    // CRITICAL: Use transaction-scoped advisory lock so the number is unique until commit (Fix 3)
                    if (_context.Database.IsNpgsql())
                        await _context.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock({0})", 1000000 + tenantId);
                    invoiceNo = await _invoiceNumberService.GenerateNextInvoiceNumberInTransactionAsync(tenantId);
                    _logger.LogDebug("Auto-generated invoice number: {InvoiceNo} for TenantId: {TenantId}", invoiceNo, tenantId);
                }

                // IDEMPOTENCY CHECK: If ExternalReference provided, check for duplicate (tenant-scoped)
                if (!string.IsNullOrWhiteSpace(request.ExternalReference))
                {
                    var existingSale = await _context.Sales
                        .FirstOrDefaultAsync(s => s.ExternalReference == request.ExternalReference && s.TenantId == tenantId && !s.IsDeleted);
                    if (existingSale != null)
                    {
                        _logger.LogWarning("Duplicate external reference detected: {Ref}. Returning existing sale ID: {Id}", request.ExternalReference, existingSale.Id);
                        await transaction.CommitAsync();
                        return await GetSaleByIdAsync(existingSale.Id, tenantId);
                    }
                }

                // CRITICAL: Check if invoice number already exists (owner-scoped)
                // FIXED: Only check finalized sales to avoid false positives from draft/stuck invoices
                // This check happens INSIDE transaction to prevent duplicates
                var duplicateInvoice = await _context.Sales
                    .FirstOrDefaultAsync(s => s.InvoiceNo == invoiceNo && s.TenantId == tenantId && !s.IsDeleted && s.IsFinalized);
                
                if (duplicateInvoice != null)
                {
                    _logger.LogWarning("Invoice {InvoiceNo} already exists for owner {TenantId} (ID: {Id}). Throwing error to trigger retry", invoiceNo, tenantId, duplicateInvoice.Id);
                    
                    // Send admin alert (tenant-specific)
                    await _alertService.CreateAlertAsync(
                        AlertType.DuplicateInvoice,
                        "Duplicate Invoice Number",
                        $"Invoice number {invoiceNo} already exists for owner {tenantId} (Sale ID: {duplicateInvoice.Id})",
                        AlertSeverity.Error,
                        null,
                        tenantId
                    );
                    
                    // Throw to trigger retry with new number
                    throw new DbUpdateException("Duplicate invoice number", new Exception("IX_Sales_InvoiceNo"));
                }
                
                // Validate invoice number format if manually provided
                if (!string.IsNullOrWhiteSpace(request.InvoiceNo))
                {
                    var isValid = await _invoiceNumberService.ValidateInvoiceNumberAsync(invoiceNo, tenantId);
                    if (!isValid)
                    {
                        throw new InvalidOperationException($"Invoice number '{invoiceNo}' is invalid. Please use a different number.");
                    }
                }
                _logger.LogDebug("Using invoice number: {InvoiceNo}", invoiceNo);

                var invoiceDate = request.InvoiceDate ?? _timeZoneService.ConvertToUtc(_timeZoneService.GetCurrentTime());
                if (await _vatValidation.IsTransactionDateInLockedPeriodAsync(tenantId, invoiceDate))
                    throw new VatPeriodLockedException("VAT return period is locked for this invoice date. You cannot add or edit transactions in a locked period.");

                // CRITICAL MULTI-TENANT FIX: Validate customer belongs to this owner and load customer
                Customer? customer = null;
                if (request.CustomerId.HasValue)
                {
                    customer = await _context.Customers
                        .FirstOrDefaultAsync(c => c.Id == request.CustomerId.Value && c.TenantId == tenantId);
                    
                    if (customer == null)
                    {
                        throw new InvalidOperationException($"Customer with ID {request.CustomerId.Value} not found for your account. Please verify the customer exists.");
                    }
                }

                // PROD-12: Validate Route belongs to tenant and Branch if RouteId provided
                if (request.RouteId.HasValue)
                {
                    var route = await _context.Routes.FirstOrDefaultAsync(r => r.Id == request.RouteId.Value && r.TenantId == tenantId);
                    if (route == null)
                        throw new InvalidOperationException($"Route with ID {request.RouteId.Value} not found or does not belong to your tenant.");
                    
                    // PROD-12: Validate Route.BranchId matches Sale.BranchId if BranchId provided
                    if (request.BranchId.HasValue && route.BranchId != request.BranchId.Value)
                    {
                        throw new InvalidOperationException(
                            $"Sale belongs to Branch {request.BranchId.Value}, but Route {request.RouteId.Value} belongs to Branch {route.BranchId}. " +
                            "Sale and Route must belong to the same Branch.");
                    }
                    
                    // PROD-12: Validate Customer.RouteId matches Sale.RouteId if Customer has RouteId
                    if (customer != null && customer.RouteId.HasValue && customer.RouteId.Value != request.RouteId.Value)
                    {
                        throw new InvalidOperationException(
                            $"Customer {customer.Id} belongs to Route {customer.RouteId.Value}, but Sale is being assigned to Route {request.RouteId.Value}. " +
                            "Customer and Sale must belong to the same Route.");
                    }
                }

                // RISK-4 FIX: Staff route lock — validate Staff can only assign invoices to their assigned routes
                var creatingUser = await _context.Users.AsNoTracking()
                    .FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
                var userRole = creatingUser?.Role.ToString() ?? "";
                if (request.RouteId.HasValue && tenantId > 0 &&
                    userRole.Equals("Staff", StringComparison.OrdinalIgnoreCase))
                {
                    var allowedRouteIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userId, tenantId, userRole);
                    if (allowedRouteIds != null && allowedRouteIds.Length > 0)
                    {
                        if (!allowedRouteIds.Contains(request.RouteId.Value))
                        {
                            throw new UnauthorizedAccessException(
                                "You can only create invoices for routes assigned to you. The selected route is not in your assigned routes.");
                        }
                    }
                    else
                    {
                        // Staff with no assigned routes cannot assign any route
                        throw new UnauthorizedAccessException(
                            "You have no routes assigned. Contact your admin to get route access.");
                    }
                }

                // Calculate totals — VAT% from company settings (tenant-scoped), not hardcoded. PRODUCTION_MASTER_TODO #37
                var vatPercent = await GetVatPercentAsync(tenantId);
                var isZeroInvoice = request.IsZeroInvoice;
                decimal subtotal = 0;
                decimal vatTotal = 0;

                var saleItems = new List<SaleItem>();
                var inventoryTransactions = new List<InventoryTransaction>();

                // Use validation service for robust validation
                var validationErrors = new List<string>();
                foreach (var item in request.Items)
                {
                    // Validate quantity
                    var qtyResult = await _validationService.ValidateQuantityAsync(item.Qty);
                    if (!qtyResult.IsValid)
                    {
                        validationErrors.AddRange(qtyResult.Errors.Select(e => $"Item {item.ProductId}: {e}"));
                    }

                    // Validate price
                    var priceResult = await _validationService.ValidatePriceAsync(item.UnitPrice);
                    if (!priceResult.IsValid)
                    {
                        validationErrors.AddRange(priceResult.Errors.Select(e => $"Item {item.ProductId}: {e}"));
                    }

                    // Validate stock availability
                    var stockResult = await _validationService.ValidateStockAvailabilityAsync(item.ProductId, item.Qty);
                    if (!stockResult.IsValid)
                    {
                        validationErrors.AddRange(stockResult.Errors);
                    }
                    else if (stockResult.Warnings.Any())
                    {
                        // Log warnings but don't fail
                        foreach (var warning in stockResult.Warnings)
                        {
                            _logger.LogWarning("Stock Warning: {Warning}", warning);
                        }
                    }
                }

                if (validationErrors.Any())
                {
                    throw new InvalidOperationException(string.Join("\n", validationErrors));
                }

                // CRITICAL FIX: Validate ALL stock availability BEFORE updating any stock
                // This prevents partial updates where Product A stock is decremented but Product B fails
                var stockValidationErrors = new List<string>();
                var productStockChecks = new List<(int ProductId, decimal RequiredQty, string ProductName)>();
                
                foreach (var item in request.Items)
                {
                    // CRITICAL MULTI-TENANT FIX: Filter product by tenantId to prevent cross-owner access
                    var product = await _context.Products
                        .AsNoTracking() // Use AsNoTracking for read-only validation
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);

                    if (product == null)
                    {
                        stockValidationErrors.Add($"Product with ID {item.ProductId} not found for your account.");
                        continue;
                    }

                    // Calculate base quantity
                    var baseQty = item.Qty * product.ConversionToBase;

                    // Validate stock availability
                    if (product.StockQty < baseQty)
                    {
                        stockValidationErrors.Add($"Insufficient stock for {product.NameEn}. Available: {product.StockQty}, Required: {baseQty}");
                    }
                    else
                    {
                        productStockChecks.Add((product.Id, baseQty, product.NameEn));
                    }
                }

                // If any stock validation fails, throw before updating any stock
                if (stockValidationErrors.Any())
                {
                    throw new InvalidOperationException(string.Join("\n", stockValidationErrors));
                }

                // Now update stock atomically - all validations passed
                foreach (var item in request.Items)
                {
                    // CRITICAL MULTI-TENANT FIX: Filter product by tenantId to prevent cross-owner access
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);

                    if (product == null)
                        throw new InvalidOperationException($"Product with ID {item.ProductId} not found for your account. Please verify the product exists.");

                    // Calculate base quantity
                    var baseQty = item.Qty * product.ConversionToBase;

                    // Calculate line totals: Total = qty × price, VAT = Total × vatPercent%, Amount = Total + VAT. Zero invoice: force 0.
                    var rowTotal = isZeroInvoice ? 0 : (item.UnitPrice * item.Qty);
                    var vatAmount = isZeroInvoice ? 0 : Math.Round(rowTotal * (vatPercent / 100), 2, MidpointRounding.AwayFromZero);
                    var lineAmount = rowTotal + vatAmount;

                    subtotal += rowTotal;
                    vatTotal += vatAmount;

                    // Create sale item (FTA: VatRate, VatScenario)
                    var saleItem = new SaleItem
                    {
                        ProductId = item.ProductId,
                        UnitType = string.IsNullOrWhiteSpace(item.UnitType) ? "CRTN" : item.UnitType.ToUpper(),
                        Qty = item.Qty,
                        UnitPrice = isZeroInvoice ? 0 : item.UnitPrice,
                        Discount = 0,
                        VatAmount = vatAmount,
                        LineTotal = lineAmount,
                        VatRate = isZeroInvoice ? 0 : (vatPercent / 100m),
                        VatScenario = isZeroInvoice ? Shared.Services.VatScenarios.OutOfScope : Shared.Services.VatScenarios.Standard
                    };

                    saleItems.Add(saleItem);

                    // PROD-19: Atomic stock update to prevent race conditions
                    // Use SQL UPDATE to atomically decrement stock and prevent concurrent update issues
                    var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                        $@"UPDATE ""Products"" 
                           SET ""StockQty"" = ""StockQty"" - {baseQty}, 
                               ""UpdatedAt"" = {DateTime.UtcNow}
                           WHERE ""Id"" = {product.Id} 
                             AND ""TenantId"" = {tenantId}
                             AND ""StockQty"" >= {baseQty}");
                    
                    if (rowsAffected == 0)
                    {
                        // Stock was insufficient or product was modified concurrently
                        throw new InvalidOperationException(
                            $"Insufficient stock for {product.NameEn}. Available stock may have changed. Please refresh and try again.");
                    }
                    
                    // Reload product to get updated stock value and RowVersion
                    await _context.Entry(product).ReloadAsync();

                    // Create inventory transaction
                    var inventoryTransaction = new InventoryTransaction
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        ProductId = item.ProductId,
                        ChangeQty = -baseQty,
                        TransactionType = TransactionType.Sale,
                        RefId = null, // Will be updated after sale is created
                        CreatedAt = DateTime.UtcNow
                    };

                    inventoryTransactions.Add(inventoryTransaction);
                }

                // Round-off: ±1.00 AED max; applied after VAT (VAT unchanged)
                var roundOff = request.RoundOff;
                if (Math.Abs(roundOff) > 1.0m)
                    throw new InvalidOperationException("Round-off cannot exceed ±AED 1.00");
                // Apply global discount and round-off: FinalTotal = SubTotal + VatTotal - Discount + RoundOff
                var grandTotal = Math.Round((subtotal + vatTotal - request.Discount + roundOff), 2);

                // CREDIT LIMIT VALIDATION: Check if sale would exceed customer credit limit
                bool creditLimitExceeded = false;
                string? creditLimitWarning = null;
                if (customer != null && customer.CreditLimit > 0)
                {
                    // Calculate current outstanding balance (unpaid amount)
                    // For credit customers, outstanding = PendingBalance (which tracks unpaid sales)
                    decimal currentOutstanding = customer.PendingBalance;
                    
                    // Calculate what the new outstanding balance would be after this sale
                    // Only count unpaid portion of this sale (grandTotal - any payments provided)
                    decimal unpaidAmountFromThisSale = grandTotal;
                    if (request.Payments != null && request.Payments.Any())
                    {
                        var clearedPayments = request.Payments
                            .Where(p => p.Method.ToUpper() == "CASH" || p.Method.ToUpper() == "ONLINE" || p.Method.ToUpper() == "DEBIT")
                            .Sum(p => p.Amount);
                        unpaidAmountFromThisSale = Math.Max(0, grandTotal - clearedPayments);
                    }
                    
                    decimal newOutstandingBalance = currentOutstanding + unpaidAmountFromThisSale;
                    
                    if (newOutstandingBalance > customer.CreditLimit)
                    {
                        creditLimitExceeded = true;
                        creditLimitWarning = $"Customer credit limit of {customer.CreditLimit:C} exceeded. Current outstanding: {currentOutstanding:C}, New sale amount: {grandTotal:C}, New outstanding balance: {newOutstandingBalance:C}";
                        _logger.LogWarning("Credit Limit Warning: {Warning}", creditLimitWarning);
                    }
                }

                // Create sale
                // CRITICAL: Stock is decremented in this transaction (lines 276-290)
                // IsFinalized = true means stock has been decremented and invoice is finalized
                
                // CASH CUSTOMER LOGIC: If no customer ID (cash customer), auto-mark as paid with cash payment
                bool isCashCustomer = !request.CustomerId.HasValue;
                decimal initialPaidAmount = 0;
                SalePaymentStatus initialPaymentStatus = SalePaymentStatus.Pending;
                
                if (isCashCustomer)
                {
                    // Cash customer = instant payment, mark as paid immediately
                    initialPaidAmount = grandTotal;
                    initialPaymentStatus = SalePaymentStatus.Paid;
                }
                
                var sale = new Sale
                {
                    OwnerId = tenantId,
                    TenantId = tenantId,
                    InvoiceNo = invoiceNo,
                    ExternalReference = request.ExternalReference,
                    InvoiceDate = request.InvoiceDate ?? _timeZoneService.ConvertToUtc(_timeZoneService.GetCurrentTime()),
                    CustomerId = request.CustomerId,
                    BranchId = request.BranchId,
                    RouteId = request.RouteId,
                    Subtotal = subtotal,
                    VatTotal = vatTotal,
                    Discount = request.Discount,
                    RoundOff = roundOff,
                    GrandTotal = grandTotal,
                    TotalAmount = grandTotal,
                    PaidAmount = initialPaidAmount,
                    PaymentStatus = initialPaymentStatus,
                    IsFinalized = true,
                    Notes = request.Notes,
                    IsZeroInvoice = isZeroInvoice,
                    VatScenario = isZeroInvoice ? Shared.Services.VatScenarios.OutOfScope : (vatTotal > 0 ? Shared.Services.VatScenarios.Standard : Shared.Services.VatScenarios.ZeroRated),
                    CreatedBy = userId,
                    CreatedAt = DateTime.UtcNow
                };

                _context.Sales.Add(sale);
                await _context.SaveChangesAsync();

                // Update sale items with sale ID
                foreach (var item in saleItems)
                {
                    item.SaleId = sale.Id;
                }

                _context.SaleItems.AddRange(saleItems);

                // Update inventory transactions with sale ID
                foreach (var invTx in inventoryTransactions)
                {
                    invTx.RefId = sale.Id;
                }

                _context.InventoryTransactions.AddRange(inventoryTransactions);

                // Process payments if provided (e.g., cash/online payment at POS)
                decimal totalPaid = 0;
                if (request.Payments != null && request.Payments.Any())
                {
                    // DUPLICATE CASH PAYMENT PREVENTION
                    var cashPayments = request.Payments.Where(p => p.Method.ToUpper() == "CASH").ToList();
                    if (cashPayments.Count > 1)
                    {
                        // Send admin alert (tenant-specific)
                        await _alertService.CreateAlertAsync(
                            AlertType.DuplicatePayment,
                            "Duplicate Cash Payment",
                            $"Multiple cash payments detected for invoice {invoiceNo}. Only first payment will be processed.",
                            AlertSeverity.Warning,
                            null,
                            tenantId
                        );
                        
                        // Keep only first cash payment
                        var firstCash = cashPayments.First();
                        request.Payments = request.Payments.Where(p => p != firstCash || !cashPayments.Skip(1).Contains(p)).ToList();
                    }
                    
                    foreach (var paymentRequest in request.Payments)
                    {
                        if (paymentRequest.Amount <= 0) continue; // Payment amount must be greater than zero
                        var paymentMode = Enum.Parse<PaymentMode>(paymentRequest.Method.ToUpper());
                        var paymentStatus = paymentMode == PaymentMode.CHEQUE 
                            ? PaymentStatus.PENDING 
                            : (paymentMode == PaymentMode.CASH || paymentMode == PaymentMode.ONLINE || paymentMode == PaymentMode.DEBIT 
                                ? PaymentStatus.CLEARED 
                                : PaymentStatus.PENDING);

                        var paymentDate = DateTime.UtcNow;
                        
                        // Create payment using EF Core (PostgreSQL compatible)
                        var payment = new Payment
                        {
                            OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                            TenantId = tenantId, // CRITICAL: Set new TenantId
                            SaleId = sale.Id,
                            CustomerId = request.CustomerId,
                            Amount = paymentRequest.Amount,
                            Mode = paymentMode,
                            Reference = paymentRequest.Ref,
                            Status = paymentStatus,
                            PaymentDate = paymentDate,
                            CreatedBy = userId,
                            CreatedAt = paymentDate,
                            UpdatedAt = paymentDate,
                            RowVersion = new byte[0]
                        };
                        
                        _context.Payments.Add(payment);
                        await _context.SaveChangesAsync(); // Save to get payment ID generated
                        
                        totalPaid += paymentRequest.Amount;
                        
                        // Update invoice if payment is immediately cleared
                        if (paymentStatus == PaymentStatus.CLEARED)
                        {
                            sale.PaidAmount += paymentRequest.Amount;
                            sale.LastPaymentDate = payment.PaymentDate;
                        }
                    }

                    // Update payment status based on total paid (zero invoice = nothing to pay, so Paid)
                    if (grandTotal == 0 || totalPaid >= grandTotal)
                    {
                        sale.PaymentStatus = SalePaymentStatus.Paid;
                    }
                    else if (totalPaid > 0)
                    {
                        sale.PaymentStatus = SalePaymentStatus.Partial;
                    }
                    else
                    {
                        sale.PaymentStatus = SalePaymentStatus.Pending;
                    }

                    // Update customer balance if any payments are cleared
                    if (request.CustomerId.HasValue)
                    {
                        var clearedAmount = request.Payments
                            .Where(p => p.Method.ToUpper() == "CASH" || p.Method.ToUpper() == "ONLINE" || p.Method.ToUpper() == "DEBIT")
                            .Sum(p => p.Amount);
                        
                        if (clearedAmount > 0)
                        {
                            // PROD-4: Filter by TenantId for tenant isolation
                            var customerEntity = await _context.Customers
                                .FirstOrDefaultAsync(c => c.Id == request.CustomerId.Value && c.TenantId == tenantId);
                            if (customerEntity != null)
                            {
                                customerEntity.Balance -= clearedAmount;
                                customerEntity.LastActivity = DateTime.UtcNow;
                                customerEntity.UpdatedAt = DateTime.UtcNow;
                            }
                        }
                    }
                }
                else
                {
                    // No payment provided: zero-invoice = nothing to pay (Paid); otherwise Pending
                    if (grandTotal == 0)
                    {
                        sale.PaymentStatus = SalePaymentStatus.Paid;
                        sale.PaidAmount = 0;
                    }
                    else
                    {
                        sale.PaymentStatus = SalePaymentStatus.Pending;
                        sale.PaidAmount = 0;
                    }

                    // New sale increases customer balance (customer owes more)
                    if (request.CustomerId.HasValue)
                    {
                        // AUDIT-4 FIX: Add TenantId filter to prevent cross-tenant customer balance modification
                        var customerEntity = await _context.Customers
                            .FirstOrDefaultAsync(c => c.Id == request.CustomerId.Value && c.TenantId == tenantId);
                        if (customerEntity != null)
                        {
                            customerEntity.Balance += grandTotal;
                            customerEntity.LastActivity = DateTime.UtcNow;
                            customerEntity.UpdatedAt = DateTime.UtcNow;
                        }
                    }
                }

                // Create audit log
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Sale Created",
                    Details = $"Invoice: {invoiceNo}, Total: {grandTotal:C}",
                    CreatedAt = DateTime.UtcNow
                };

                _context.AuditLogs.Add(auditLog);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                // ✅ REAL-TIME BALANCE UPDATE: Update customer balance after invoice creation
                if (request.CustomerId.HasValue)
                {
                    try
                    {
                        await _balanceService.UpdateCustomerBalanceOnInvoiceCreatedAsync(
                            request.CustomerId.Value,
                            grandTotal);
                        
                        // Also update for any cleared payments
                        if (request.Payments != null && request.Payments.Any())
                        {
                            var clearedAmount = request.Payments
                                .Where(p => p.Method.ToUpper() == "CASH" || p.Method.ToUpper() == "ONLINE" || p.Method.ToUpper() == "DEBIT")
                                .Sum(p => p.Amount);
                            
                            if (clearedAmount > 0)
                            {
                                await _balanceService.UpdateCustomerBalanceOnPaymentCreatedAsync(
                                    request.CustomerId.Value,
                                    clearedAmount);
                            }
                        }
                    }
                    catch (Exception balanceEx)
                    {
                        _logger.LogWarning(balanceEx, "Failed to update balance: {Message}", balanceEx.Message);
                        // Don't fail the sale, but create alert
                        await _alertService.CreateAlertAsync(
                            AlertType.BalanceMismatch,
                            "Failed to update customer balance after invoice creation",
                            $"Invoice: {invoiceNo}, Customer: {request.CustomerId}",
                            AlertSeverity.Warning,
                            null,
                            tenantId);
                    }
                }

                // Auto-backup after successful invoice save
                try
                {
                    var savedSale = await GetSaleByIdAsync(sale.Id, tenantId);
                    if (savedSale != null)
                    {
                        // CRITICAL: Generate and save PDF - ensure it completes successfully
                        try
                        {
                            var pdfBytes = await _pdfService.GenerateInvoicePdfAsync(savedSale);
                            if (pdfBytes == null || pdfBytes.Length == 0)
                            {
                                _logger.LogError("PDF Generation Failed: Generated PDF is empty for invoice {InvoiceNo}", savedSale.InvoiceNo);
                            }
                            else
                            {
                                _logger.LogDebug("PDF Generated Successfully: {Bytes} bytes for invoice {InvoiceNo}", pdfBytes.Length, savedSale.InvoiceNo);
                            }
                        }
                        catch (Exception pdfEx)
                        {
                            _logger.LogError(pdfEx, "CRITICAL: PDF Generation Failed for invoice {InvoiceNo}: {Message}", savedSale.InvoiceNo, pdfEx.Message);
                            // Log but don't fail sale creation - PDF can be regenerated later
                        }
                        
                        // Create backup (background task, don't block)
                        // AUDIT-8 FIX: Pass tenantId to backup
                        var backupTenantId = tenantId; // Capture for closure
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                await _backupService.CreateFullBackupAsync(backupTenantId, exportToDesktop: true);
                                _logger.LogInformation("Auto-backup completed to Desktop");
                            }
                            catch (Exception backupEx)
                            {
                                _logger.LogWarning(backupEx, "Auto-backup failed: {Message}", backupEx.Message);
                            }
                        });
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to generate PDF after invoice save: {Message}", ex.Message);
                    // Don't fail the sale creation if PDF generation fails
                }

                // Return sale DTO with credit limit warnings if applicable
                var saleDto = await GetSaleByIdAsync(sale.Id, tenantId) ?? throw new InvalidOperationException("Failed to retrieve created sale");
                saleDto.CreditLimitExceeded = creditLimitExceeded;
                saleDto.CreditLimitWarning = creditLimitWarning;
                return saleDto;
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                
                // Log detailed error for debugging
                _logger.LogError(ex, "CreateSaleAsync Error: {Type}, Message: {Message}", ex.GetType().Name, ex.Message);
                if (ex.InnerException != null)
                {
                    _logger.LogError(ex.InnerException, "Inner Exception: {Type}, Message: {Message}", ex.InnerException.GetType().Name, ex.InnerException.Message);
                }
                
                // Re-throw to be caught by controller
                throw;
            }
            });
        }

        public async Task<SaleDto> CreateSaleWithOverrideAsync(CreateSaleRequest request, string reason, int userId, int tenantId)
        {
            var strategyCreateWithOverride = _context.Database.CreateExecutionStrategy();
            return await strategyCreateWithOverride.ExecuteAsync(async () =>
            {
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Similar to CreateSaleAsync but without stock validation
                var invoiceNo = await GenerateInvoiceNumberAsync(tenantId);
                var vatPercent = await GetVatPercentAsync(tenantId);
                decimal subtotal = 0;
                decimal vatTotal = 0;

                var saleItems = new List<SaleItem>();
                var inventoryTransactions = new List<InventoryTransaction>();

                foreach (var item in request.Items)
                {
                    // PROD-4: Filter by TenantId for tenant isolation
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                    if (product == null)
                        throw new InvalidOperationException($"Product with ID {item.ProductId} not found for your account. Please verify the product exists.");

                    var baseQty = item.Qty * product.ConversionToBase;
                    // Calculate line totals: Total = qty × price, VAT = Total × vatPercent%, Amount = Total + VAT
                    var rowTotal = item.UnitPrice * item.Qty;
                    var vatAmount = Math.Round(rowTotal * (vatPercent / 100), 2);
                    var lineAmount = rowTotal + vatAmount;

                    subtotal += rowTotal;
                    vatTotal += vatAmount;

                    var saleItem = new SaleItem
                    {
                        ProductId = item.ProductId,
                        UnitType = item.UnitType,
                        Qty = item.Qty,
                        UnitPrice = item.UnitPrice,
                        Discount = 0, // No per-item discount
                        VatAmount = vatAmount,
                        LineTotal = lineAmount
                    };

                    saleItems.Add(saleItem);

                    // PROD-19: Atomic stock update (admin override allows negative stock)
                    var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                        $@"UPDATE ""Products"" 
                           SET ""StockQty"" = ""StockQty"" - {baseQty}, 
                               ""UpdatedAt"" = {DateTime.UtcNow}
                           WHERE ""Id"" = {product.Id} 
                             AND ""TenantId"" = {tenantId}");
                    
                    if (rowsAffected == 0)
                    {
                        throw new InvalidOperationException($"Product {product.Id} not found or does not belong to your tenant.");
                    }
                    
                    await _context.Entry(product).ReloadAsync();

                    var inventoryTransaction = new InventoryTransaction
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        ProductId = item.ProductId,
                        ChangeQty = -baseQty,
                        TransactionType = TransactionType.Sale,
                        RefId = null,
                        Reason = $"Admin Override: {reason}",
                        CreatedAt = DateTime.UtcNow
                    };

                    inventoryTransactions.Add(inventoryTransaction);
                }

                // Round-off: ±1.00 AED max
                var roundOffOverride = request.RoundOff;
                if (Math.Abs(roundOffOverride) > 1.0m)
                    throw new InvalidOperationException("Round-off cannot exceed ±AED 1.00");
                var grandTotal = Math.Round((subtotal + vatTotal - request.Discount + roundOffOverride), 2);

                // CASH CUSTOMER LOGIC: If no customer ID (cash customer), auto-mark as paid with cash payment
                bool isCashCustomerOverride = !request.CustomerId.HasValue;
                decimal initialPaidAmountOverride = 0;
                SalePaymentStatus initialPaymentStatusOverride = SalePaymentStatus.Pending;
                
                if (isCashCustomerOverride)
                {
                    // Cash customer = instant payment, mark as paid immediately
                    initialPaidAmountOverride = grandTotal;
                    initialPaymentStatusOverride = SalePaymentStatus.Paid;
                }

                var sale = new Sale
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    InvoiceNo = invoiceNo,
                    InvoiceDate = DateTime.UtcNow,
                    CustomerId = request.CustomerId,
                    Subtotal = subtotal,
                    VatTotal = vatTotal,
                    Discount = request.Discount,
                    RoundOff = roundOffOverride,
                    GrandTotal = grandTotal,
                    TotalAmount = grandTotal, // Set TotalAmount = GrandTotal
                    PaidAmount = initialPaidAmountOverride, // Cash customer = paid immediately
                    PaymentStatus = initialPaymentStatusOverride, // Cash customer = Paid status
                    IsFinalized = true, // Invoice is finalized - stock decremented
                    Notes = request.Notes,
                    CreatedBy = userId,
                    CreatedAt = DateTime.UtcNow
                };

                _context.Sales.Add(sale);
                await _context.SaveChangesAsync();

                foreach (var item in saleItems)
                {
                    item.SaleId = sale.Id;
                }

                _context.SaleItems.AddRange(saleItems);

                foreach (var invTx in inventoryTransactions)
                {
                    invTx.RefId = sale.Id;
                }

                _context.InventoryTransactions.AddRange(inventoryTransactions);

                // Process payments
                decimal totalPaid = 0;
                
                // CASH CUSTOMER: Auto-create cash payment if no customer ID
                if (isCashCustomerOverride)
                {
                    // Create automatic cash payment for cash customer
                    var cashPayment = new Payment
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        SaleId = sale.Id,
                        CustomerId = null, // Cash customer has no customer ID
                        Amount = grandTotal,
                        Mode = PaymentMode.CASH,
                        Reference = "CASH",
                        Status = PaymentStatus.CLEARED, // Cash is always cleared
                        PaymentDate = DateTime.UtcNow,
                        CreatedBy = userId,
                        CreatedAt = DateTime.UtcNow
                    };
                    _context.Payments.Add(cashPayment);
                    totalPaid = grandTotal;
                }
                else if (request.Payments != null && request.Payments.Any())
                {
                    var payments = request.Payments.Select(p => {
                        var paymentMode = Enum.Parse<PaymentMode>(p.Method.ToUpper());
                        var paymentStatus = paymentMode == PaymentMode.CHEQUE 
                            ? PaymentStatus.PENDING 
                            : (paymentMode == PaymentMode.CASH || paymentMode == PaymentMode.ONLINE || paymentMode == PaymentMode.DEBIT 
                                ? PaymentStatus.CLEARED 
                                : PaymentStatus.PENDING);
                        
                        return new Payment
                        {
                            OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                            TenantId = tenantId, // CRITICAL: Set new TenantId
                            SaleId = sale.Id,
                            CustomerId = request.CustomerId,
                            Amount = p.Amount,
                            Mode = paymentMode,
                            Reference = p.Ref,
                            Status = paymentStatus,
                            PaymentDate = DateTime.UtcNow,
                            CreatedBy = userId,
                            CreatedAt = DateTime.UtcNow
                        };
                    }).ToList();

                    _context.Payments.AddRange(payments);

                    totalPaid = payments.Sum(p => p.Amount);
                    if (totalPaid >= grandTotal)
                    {
                        sale.PaymentStatus = SalePaymentStatus.Paid;
                    }
                    else if (totalPaid > 0)
                    {
                        sale.PaymentStatus = SalePaymentStatus.Partial;
                    }
                }

                // Recalculate customer balance from all transactions (fixes fake balance issue)
                if (request.CustomerId.HasValue)
                {
                    var customerService = new CustomerService(_context);
                    await customerService.RecalculateCustomerBalanceAsync(request.CustomerId.Value, tenantId);
                }

                // Create audit log for override
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Sale Created (Admin Override)",
                    Details = $"Invoice: {invoiceNo}, Total: {grandTotal:C}, Reason: {reason}",
                    CreatedAt = DateTime.UtcNow
                };

                _context.AuditLogs.Add(auditLog);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                // Auto-backup after successful invoice save
                try
                {
                    var savedSale = await GetSaleByIdAsync(sale.Id, tenantId);
                    if (savedSale != null)
                    {
                        // CRITICAL: Generate and save PDF - ensure it completes successfully
                        try
                        {
                            var pdfBytes = await _pdfService.GenerateInvoicePdfAsync(savedSale);
                            if (pdfBytes == null || pdfBytes.Length == 0)
                            {
                                _logger.LogError("PDF Generation Failed: Generated PDF is empty for invoice {InvoiceNo}", savedSale.InvoiceNo);
                            }
                            else
                            {
                                _logger.LogDebug("PDF Generated Successfully: {Bytes} bytes for invoice {InvoiceNo}", pdfBytes.Length, savedSale.InvoiceNo);
                            }
                        }
                        catch (Exception pdfEx)
                        {
                            _logger.LogError(pdfEx, "CRITICAL: PDF Generation Failed for invoice {InvoiceNo}: {Message}", savedSale.InvoiceNo, pdfEx.Message);
                            // Log but don't fail sale creation - PDF can be regenerated later
                        }
                        
                        // Create backup (background task, don't block)
                        // AUDIT-8 FIX: Pass tenantId to backup
                        var backupTenantId = tenantId; // Capture for closure
                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                await _backupService.CreateFullBackupAsync(backupTenantId, exportToDesktop: true);
                                _logger.LogInformation("Auto-backup completed to Desktop");
                            }
                            catch (Exception backupEx)
                            {
                                _logger.LogWarning(backupEx, "Auto-backup failed: {Message}", backupEx.Message);
                            }
                        });
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to generate PDF after invoice save: {Message}", ex.Message);
                    // Don't fail the sale creation if PDF generation fails
                }

                return await GetSaleByIdAsync(sale.Id, tenantId) ?? throw new InvalidOperationException("Failed to retrieve created sale");
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
            });
        }

        public async Task<string> GenerateInvoiceNumberAsync(int tenantId)
        {
            // CRITICAL: Delegate to InvoiceNumberService with tenantId for owner-scoped numbering
            return await _invoiceNumberService.GenerateNextInvoiceNumberAsync(tenantId);
        }

        public async Task<SaleDto> UpdateSaleAsync(int saleId, CreateSaleRequest request, int userId, int tenantId, string? editReason = null, byte[]? expectedRowVersion = null)
        {
            var strategyUpdate = _context.Database.CreateExecutionStrategy();
            return await strategyUpdate.ExecuteAsync(async () =>
            {
            // Use serializable isolation level to prevent concurrent edits
            using var transaction = await _context.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
            try
            {
                // CRITICAL: Get existing sale with owner verification
                var existingSale = await _context.Sales
                    .Include(s => s.Items)
                    .ThenInclude(i => i.Product)
                    .AsNoTracking() // First read to check version
                    .FirstOrDefaultAsync(s => s.Id == saleId && s.TenantId == tenantId);

                if (existingSale == null)
                    throw new InvalidOperationException("Sale not found");

                if (existingSale.IsDeleted)
                    throw new InvalidOperationException("Cannot edit deleted sale");

                if (await _vatValidation.IsTransactionDateInLockedPeriodAsync(tenantId, existingSale.InvoiceDate))
                    throw new VatPeriodLockedException("VAT return period is locked for this invoice date. You cannot add or edit transactions in a locked period.");

                // PROD-4: Verify user exists and belongs to tenant
                var user = await _context.Users
                    .FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
                if (user == null)
                    throw new InvalidOperationException("User not found or does not belong to your tenant");
                
                // Allow Admin, Owner, and Staff to edit invoices
                // Staff can edit invoices they created or invoices in their assigned branch/route
                if (user.Role != UserRole.Admin && user.Role != UserRole.Owner && user.Role != UserRole.Staff)
                {
                    throw new InvalidOperationException("Only Admin, Owner, and Staff users can edit invoices");
                }
                
                // Staff can edit if they created it OR if it's in their assigned branch/route
                if (user.Role == UserRole.Staff)
                {
                    // Check if staff created this invoice OR if it's in their assigned branch/route
                    var staffCanEdit = existingSale.CreatedBy == userId;
                    
                    // If staff has branch/route assignments, check if invoice matches
                    if (!staffCanEdit && existingSale.BranchId.HasValue)
                    {
                        // Check if staff is assigned to this branch
                        var branchStaff = await _context.BranchStaff
                            .Where(bs => bs.UserId == userId)
                            .Include(bs => bs.Branch)
                            .Where(bs => bs.Branch.TenantId == tenantId && bs.BranchId == existingSale.BranchId.Value)
                            .AnyAsync();
                        
                        if (branchStaff)
                        {
                            staffCanEdit = true;
                        }
                        else if (existingSale.RouteId.HasValue)
                        {
                            // Check if staff is assigned to this route
                            var routeStaff = await _context.RouteStaff
                                .Where(rs => rs.UserId == userId)
                                .Include(rs => rs.Route)
                                .Where(rs => rs.Route.TenantId == tenantId && rs.RouteId == existingSale.RouteId.Value)
                                .AnyAsync();
                            
                            staffCanEdit = routeStaff;
                        }
                    }
                    
                    if (!staffCanEdit)
                    {
                        throw new InvalidOperationException("Staff can only edit invoices they created or invoices in their assigned branch/route");
                    }
                }

                // CONCURRENCY CHECK: Verify version hasn't changed (another user edited it)
                if (expectedRowVersion != null && expectedRowVersion.Length > 0)
                {
                    // PROD-4: Filter by TenantId for tenant isolation
                    var currentSale = await _context.Sales
                        .FirstOrDefaultAsync(s => s.Id == saleId && s.TenantId == tenantId);
                    if (currentSale == null)
                        throw new InvalidOperationException("Sale not found or does not belong to your tenant");

                    // Compare RowVersion bytes to detect concurrent modification
                    if (currentSale.RowVersion != null && currentSale.RowVersion.Length > 0)
                    {
                        if (!currentSale.RowVersion.SequenceEqual(expectedRowVersion))
                        {
                            await transaction.RollbackAsync();
                            throw new InvalidOperationException(
                                $"CONFLICT: This invoice was modified by another user. " +
                                $"Current version: {currentSale.Version}. " +
                                $"Last modified by: {currentSale.LastModifiedByUser?.Name ?? "Unknown"} at {currentSale.LastModifiedAt:g}. " +
                                $"Please refresh and try again."
                            );
                        }
                    }
                }

                // Check if another user is currently editing (check LastModifiedAt within last 30 seconds)
                var recentlyModified = existingSale.LastModifiedAt.HasValue && 
                    (DateTime.UtcNow - existingSale.LastModifiedAt.Value).TotalSeconds < 30 &&
                    existingSale.LastModifiedBy != userId;

                if (recentlyModified)
                {
                    // PROD-4: Filter by TenantId for tenant isolation
                    var modifier = await _context.Users
                        .FirstOrDefaultAsync(u => u.Id == existingSale.LastModifiedBy && u.TenantId == tenantId);
                    throw new InvalidOperationException(
                        $"WARNING: Another user ({modifier?.Name ?? "Unknown"}) is currently editing this invoice. " +
                        $"Please wait a few seconds and refresh before saving."
                    );
                }

                // Now load with tracking for updates
                // PROD-4: Filter by TenantId for tenant isolation
                var saleForUpdate = await _context.Sales
                    .Include(s => s.Items)
                    .ThenInclude(i => i.Product)
                    .FirstOrDefaultAsync(s => s.Id == saleId && s.TenantId == tenantId);
                
                if (saleForUpdate == null)
                    throw new InvalidOperationException("Sale not found or does not belong to your tenant");

                if (saleForUpdate == null)
                    throw new InvalidOperationException("Sale not found");

                // Create version snapshot before editing
                var versionSnapshot = new
                {
                    Sale = new
                    {
                        saleForUpdate.Id,
                        saleForUpdate.InvoiceNo,
                        saleForUpdate.InvoiceDate,
                        saleForUpdate.CustomerId,
                        saleForUpdate.Subtotal,
                        saleForUpdate.VatTotal,
                        saleForUpdate.Discount,
                        saleForUpdate.GrandTotal,
                        saleForUpdate.PaymentStatus,
                        saleForUpdate.Version
                    },
                    Items = saleForUpdate.Items.Select(i => new
                    {
                        i.Id,
                        i.ProductId,
                        i.UnitType,
                        i.Qty,
                        i.UnitPrice,
                        i.Discount,
                        i.VatAmount,
                        i.LineTotal
                    }).ToList()
                };

                var versionJson = JsonSerializer.Serialize(versionSnapshot);
                var newVersion = saleForUpdate.Version + 1;
                var oldTotalsForAudit = new { GrandTotal = saleForUpdate.GrandTotal, Subtotal = saleForUpdate.Subtotal, Discount = saleForUpdate.Discount, VatTotal = saleForUpdate.VatTotal };

                // Use validation service for robust validation
                var validationResult = await _validationService.ValidateSaleEditAsync(saleId, request.Items);

                if (!validationResult.IsValid)
                {
                    await transaction.RollbackAsync();
                    throw new InvalidOperationException(
                        "VALIDATION FAILED:\n" +
                        string.Join("\n", validationResult.Errors) +
                        "\n\nPlease correct the errors and try again."
                    );
                }

                // STOCK CONFLICT PREVENTION: Check all products have sufficient stock BEFORE making changes
                var stockConflicts = new List<string>();
                foreach (var item in request.Items)
                {
                    // PROD-4: Filter by TenantId for tenant isolation
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                    if (product == null)
                    {
                        stockConflicts.Add($"Product ID {item.ProductId} not found for your account");
                        continue;
                    }

                    var baseQty = item.Qty * product.ConversionToBase;
                    
                    // Calculate current available stock (after restoring old quantities)
                    var oldItem = saleForUpdate.Items?.FirstOrDefault(i => i != null && i.ProductId == item.ProductId);
                    var oldBaseQty = (oldItem != null && product != null) ? oldItem.Qty * product.ConversionToBase : 0;
                    var availableAfterRestore = (product?.StockQty ?? 0) + oldBaseQty;

                    if (availableAfterRestore < baseQty)
                    {
                        stockConflicts.Add(
                            $"{product.NameEn}: Available: {availableAfterRestore}, Required: {baseQty}"
                        );
                    }
                }

                if (stockConflicts.Any())
                {
                    await transaction.RollbackAsync();
                    throw new InvalidOperationException(
                        "STOCK CONFLICT: Insufficient stock for the following products:\n" +
                        string.Join("\n", stockConflicts) +
                        "\n\nPlease check current stock levels and adjust quantities."
                    );
                }

                // REVERSE OLD TRANSACTIONS: Restore stock and reverse inventory transactions
                if (saleForUpdate.Items != null && saleForUpdate.Items.Any())
                {
                    foreach (var oldItem in saleForUpdate.Items)
                    {
                        if (oldItem != null)
                        {
                            // PROD-4: Filter by TenantId for tenant isolation
                            var product = await _context.Products
                                .FirstOrDefaultAsync(p => p.Id == oldItem.ProductId && p.TenantId == tenantId);
                            if (product != null)
                            {
                                // PROD-19: Atomic stock restore
                                var oldBaseQty = oldItem.Qty * product.ConversionToBase;
                                var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                                    $@"UPDATE ""Products"" 
                                       SET ""StockQty"" = ""StockQty"" + {oldBaseQty}, 
                                           ""UpdatedAt"" = {DateTime.UtcNow}
                                       WHERE ""Id"" = {product.Id} 
                                         AND ""TenantId"" = {tenantId}");
                                
                                if (rowsAffected > 0)
                                {
                                    await _context.Entry(product).ReloadAsync();
                                }
                            }
                        }
                    }
                }

                // REVERSE customer balance will be recalculated after new amounts are set

                // Calculate new totals — VAT% from company settings (tenant-scoped)
                var vatPercent = await GetVatPercentAsync(tenantId);
                var isZeroInvoice = request.IsZeroInvoice;
                decimal subtotal = 0;
                decimal vatTotal = 0;

                var newSaleItems = new List<SaleItem>();
                var inventoryTransactions = new List<InventoryTransaction>();

                // Additional validation using validation service (already validated above, but double-check)
                var additionalValidationErrors = new List<string>();
                foreach (var item in request.Items)
                {
                    var qtyResult = await _validationService.ValidateQuantityAsync(item.Qty);
                    if (!qtyResult.IsValid)
                    {
                        additionalValidationErrors.AddRange(qtyResult.Errors.Select(e => $"Item {item.ProductId}: {e}"));
                    }

                    var priceResult = await _validationService.ValidatePriceAsync(item.UnitPrice);
                    if (!priceResult.IsValid)
                    {
                        additionalValidationErrors.AddRange(priceResult.Errors.Select(e => $"Item {item.ProductId}: {e}"));
                    }
                }

                if (additionalValidationErrors.Any())
                {
                    await transaction.RollbackAsync();
                    throw new InvalidOperationException(string.Join("\n", additionalValidationErrors));
                }

                // Process new items (same logic as CreateSaleAsync)
                // Note: Stock has already been restored from old items above
                foreach (var item in request.Items)
                {
                    // CRITICAL MULTI-TENANT FIX: Filter product by tenantId to prevent cross-owner access
                    var product = await _context.Products.FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                    if (product == null)
                        throw new InvalidOperationException($"Product with ID {item.ProductId} not found for your account. Please verify the product exists.");

                    var baseQty = item.Qty * product.ConversionToBase;

                    // Check stock availability (stock was already restored from old items)
                    // But we need to account for items already processed in this loop
                    // Find if this product appears multiple times in the request
                    var qtyAlreadyProcessed = newSaleItems
                        .Where(si => si.ProductId == item.ProductId)
                        .Sum(si => si.Qty * product.ConversionToBase);
                    
                    var availableStock = product.StockQty - qtyAlreadyProcessed;
                    
                    if (availableStock < baseQty)
                    {
                        throw new InvalidOperationException(
                            $"Insufficient stock for {product.NameEn}. " +
                            $"Available: {availableStock}, Required: {baseQty}. " +
                            $"Note: Stock from old invoice items has been restored."
                        );
                    }

                    var rowTotal = isZeroInvoice ? 0 : (item.UnitPrice * item.Qty);
                    var vatAmount = isZeroInvoice ? 0 : Math.Round(rowTotal * (vatPercent / 100), 2, MidpointRounding.AwayFromZero);
                    var lineAmount = rowTotal + vatAmount;

                    subtotal += rowTotal;
                    vatTotal += vatAmount;

                    var saleItem = new SaleItem
                    {
                        SaleId = saleId,
                        ProductId = item.ProductId,
                        UnitType = string.IsNullOrWhiteSpace(item.UnitType) ? "CRTN" : item.UnitType.ToUpper(),
                        Qty = item.Qty,
                        UnitPrice = isZeroInvoice ? 0 : item.UnitPrice,
                        Discount = 0,
                        VatAmount = vatAmount,
                        LineTotal = lineAmount,
                        VatRate = isZeroInvoice ? 0 : (vatPercent / 100m),
                        VatScenario = isZeroInvoice ? Shared.Services.VatScenarios.OutOfScope : Shared.Services.VatScenarios.Standard
                    };
                    newSaleItems.Add(saleItem);

                    // PROD-19: Atomic stock update for edited invoice
                    // Old stock was already restored above
                    // Now decrement stock for new quantities (delta calculation)
                    var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                        $@"UPDATE ""Products"" 
                           SET ""StockQty"" = ""StockQty"" - {baseQty}, 
                               ""UpdatedAt"" = {DateTime.UtcNow}
                           WHERE ""Id"" = {product.Id} 
                             AND ""TenantId"" = {tenantId}
                             AND ""StockQty"" >= {baseQty}");
                    
                    if (rowsAffected == 0)
                    {
                        throw new InvalidOperationException(
                            $"Insufficient stock for {product.NameEn}. Available stock may have changed. Please refresh and try again.");
                    }
                    
                    await _context.Entry(product).ReloadAsync();

                    // Create inventory transaction
                    inventoryTransactions.Add(new InventoryTransaction
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        ProductId = item.ProductId,
                        ChangeQty = -baseQty,
                        TransactionType = TransactionType.Sale,
                        RefId = saleId,
                        Reason = $"Sale Updated: {existingSale.InvoiceNo}",
                        CreatedAt = DateTime.UtcNow
                    });
                }

                var roundOffUpdate = request.RoundOff;
                if (Math.Abs(roundOffUpdate) > 1.0m)
                    throw new InvalidOperationException("Round-off cannot exceed ±AED 1.00");
                var grandTotal = Math.Round((subtotal + vatTotal - request.Discount + roundOffUpdate), 2);

                // Delete old sale items
                if (saleForUpdate.Items != null && saleForUpdate.Items.Any())
                {
                    _context.SaleItems.RemoveRange(saleForUpdate.Items);
                }

                // Update sale (PRESERVE InvoiceNo - do not change it on edit)
                // InvoiceNo is set once during creation and should never change
                saleForUpdate.Subtotal = subtotal;
                saleForUpdate.VatTotal = vatTotal;
                saleForUpdate.Discount = request.Discount;
                saleForUpdate.RoundOff = roundOffUpdate;
                saleForUpdate.GrandTotal = grandTotal;
                saleForUpdate.TotalAmount = grandTotal;
                saleForUpdate.IsZeroInvoice = isZeroInvoice;
                saleForUpdate.VatScenario = isZeroInvoice ? Shared.Services.VatScenarios.OutOfScope : (vatTotal > 0 ? Shared.Services.VatScenarios.Standard : Shared.Services.VatScenarios.ZeroRated);
                
                // Admin and Staff: Update invoice date if provided
                if (request.InvoiceDate.HasValue)
                {
                    saleForUpdate.InvoiceDate = request.InvoiceDate.Value;
                }
                
                // Handle paid_amount adjustment if new total is less than paid amount
                if (grandTotal < saleForUpdate.PaidAmount)
                {
                    // Customer has overpaid - adjust balance and paid_amount
                    var excessAmount = saleForUpdate.PaidAmount - grandTotal;
                    saleForUpdate.PaidAmount = grandTotal; // Cap paid amount at new total
                    
                    // Update customer balance (reduce what customer owes)
                    if (saleForUpdate.CustomerId.HasValue)
                    {
                        // PROD-4: Filter by TenantId for tenant isolation
                        var customer = await _context.Customers
                            .FirstOrDefaultAsync(c => c.Id == saleForUpdate.CustomerId.Value && c.TenantId == tenantId);
                        if (customer != null)
                        {
                            customer.Balance -= excessAmount; // Customer owes less (credit)
                            customer.UpdatedAt = DateTime.UtcNow;
                        }
                    }
                    
                    // Create audit log for adjustment
                    var adjustmentLog = new AuditLog
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        UserId = userId,
                        Action = "Invoice Edit - Paid Amount Adjustment",
                        Details = $"Invoice {saleForUpdate.InvoiceNo}: GrandTotal reduced from {saleForUpdate.GrandTotal + excessAmount:C} to {grandTotal:C}. Excess payment of {excessAmount:C} credited to customer balance.",
                        CreatedAt = DateTime.UtcNow
                    };
                    _context.AuditLogs.Add(adjustmentLog);
                }
                
                saleForUpdate.Notes = request.Notes;
                saleForUpdate.LastModifiedBy = userId;
                saleForUpdate.LastModifiedAt = DateTime.UtcNow;
                saleForUpdate.Version = newVersion;
                saleForUpdate.EditReason = editReason;
                // InvoiceNo is NOT updated - preserve original invoice number
                
                // Add new sale items
                _context.SaleItems.AddRange(newSaleItems);

                // Add inventory transactions
                _context.InventoryTransactions.AddRange(inventoryTransactions);

                // ============================================================
                // CRITICAL FIX: Properly handle CASH ↔ CREDIT conversion
                // ============================================================
                
                // Determine if this is a CASH or CREDIT sale
                bool isNewCashSale = !request.CustomerId.HasValue; // No customer = Cash customer
                bool wasOldCashSale = !existingSale.CustomerId.HasValue;
                int? oldCustomerId = existingSale.CustomerId;
                int? newCustomerId = request.CustomerId;
                
                _logger.LogInformation(
                    "SALE UPDATE Invoice {InvoiceNo}. Old: CustomerId={OldCustomerId}, GrandTotal={OldGrandTotal}, Paid={OldPaid}, Status={OldStatus}. New: CustomerId={NewCustomerId}, GrandTotal={NewGrandTotal}",
                    existingSale.InvoiceNo,
                    oldCustomerId?.ToString() ?? "CASH",
                    existingSale.GrandTotal,
                    existingSale.PaidAmount,
                    existingSale.PaymentStatus,
                    newCustomerId?.ToString() ?? "CASH",
                    grandTotal);
                
                // Get old payments to properly reverse their effects
                var oldPayments = await _context.Payments.Where(p => p.SaleId == saleId).ToListAsync();
                
                // STEP 1: Reverse ALL old invoice effects (balance + payments)
                if (oldCustomerId.HasValue)
                {
                    // PROD-4: Filter by TenantId for tenant isolation
                    var oldCustomer = await _context.Customers
                        .FirstOrDefaultAsync(c => c.Id == oldCustomerId.Value && c.TenantId == tenantId);
                        if (oldCustomer != null)
                        {
                            // Remove old invoice from old customer's balance
                            decimal oldOutstanding = existingSale.GrandTotal - existingSale.PaidAmount;
                            oldCustomer.Balance -= oldOutstanding;
                            oldCustomer.UpdatedAt = DateTime.UtcNow;
                            _logger.LogInformation(
                                "Removed old invoice from Customer {CustomerId}: -{Outstanding}",
                                oldCustomerId,
                                oldOutstanding);
                        }
                }
                
                // Reverse old payment effects on customer balance (if any)
                if (oldPayments != null && oldPayments.Any())
                {
                    foreach (var oldPayment in oldPayments)
                    {
                        if (oldPayment.Status == PaymentStatus.CLEARED && oldPayment.CustomerId.HasValue)
                        {
                            // AUDIT-4 FIX: Add TenantId filter to prevent cross-tenant customer balance modification
                            var customer = await _context.Customers
                                .FirstOrDefaultAsync(c => c.Id == oldPayment.CustomerId.Value && c.TenantId == tenantId);
                            if (customer != null)
                            {
                                // Reverse old payment: customer owes more
                                customer.Balance += oldPayment.Amount;
                                customer.UpdatedAt = DateTime.UtcNow;
                                _logger.LogInformation(
                                    "Reversed old payment from Customer {CustomerId}: +{Amount}",
                                    oldPayment.CustomerId,
                                    oldPayment.Amount);
                            }
                        }
                    }
                    
                    // Delete all old payments
                    _context.Payments.RemoveRange(oldPayments);
                }

                // STEP 2: Update CustomerId in sale
                saleForUpdate.CustomerId = newCustomerId;

                // STEP 3: Process NEW payment logic based on sale type
                if (isNewCashSale)
                {
                    // ===== CASH SALE (No Customer) =====
                    // Cash sales are ALWAYS paid immediately with cash
                    saleForUpdate.PaymentStatus = SalePaymentStatus.Paid;
                    saleForUpdate.PaidAmount = grandTotal;
                    saleForUpdate.LastPaymentDate = DateTime.UtcNow;
                    
                    // Create automatic cash payment for cash sale
                    var cashPayment = new Payment
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        SaleId = saleId,
                        CustomerId = null, // No customer for cash sale
                        Amount = grandTotal,
                        Mode = PaymentMode.CASH,
                        Reference = "CASH",
                        Status = PaymentStatus.CLEARED,
                        PaymentDate = DateTime.UtcNow,
                        CreatedBy = userId,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow,
                        RowVersion = new byte[0]
                    };
                    _context.Payments.Add(cashPayment);
                    
                    _logger.LogInformation(
                        "CASH SALE: Auto-created cash payment for {Amount}, Status={Status}",
                        grandTotal,
                        SalePaymentStatus.Paid);
                }
                else if (request.Payments != null && request.Payments.Any())
                {
                    // ===== CREDIT SALE with PAYMENTS =====
                    // Customer provided, process payment records
                    decimal totalPaidCleared = 0;
                    
                    foreach (var p in request.Payments)
                    {
                        if (string.IsNullOrWhiteSpace(p.Method))
                        {
                            throw new InvalidOperationException("Payment method cannot be empty");
                        }
                        
                        // Try to parse payment mode, handle invalid values
                        PaymentMode paymentMode;
                        try
                        {
                            paymentMode = Enum.Parse<PaymentMode>(p.Method.ToUpper());
                        }
                        catch (ArgumentException)
                        {
                            throw new InvalidOperationException($"Invalid payment method: {p.Method}. Valid methods are: Cash, Cheque, Online, Credit, Debit");
                        }
                        
                        var paymentStatus = paymentMode == PaymentMode.CHEQUE 
                            ? PaymentStatus.PENDING 
                            : (paymentMode == PaymentMode.CASH || paymentMode == PaymentMode.ONLINE || paymentMode == PaymentMode.DEBIT 
                                ? PaymentStatus.CLEARED 
                                : PaymentStatus.PENDING);
                        
                        if (p.Amount <= 0)
                        {
                            throw new InvalidOperationException("Payment amount must be greater than zero. Please enter a valid amount.");
                        }
                        
                        var paymentDate = DateTime.UtcNow;
                        
                        // Create payment using EF Core (works with PostgreSQL)
                        var payment = new Payment
                        {
                            OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                            TenantId = tenantId, // CRITICAL: Set new TenantId
                            SaleId = saleId,
                            CustomerId = request.CustomerId,
                            Amount = p.Amount,
                            Mode = paymentMode,
                            Reference = p.Ref,
                            Status = paymentStatus,
                            PaymentDate = paymentDate,
                            CreatedBy = userId,
                            CreatedAt = paymentDate,
                            UpdatedAt = paymentDate,
                            RowVersion = new byte[0]
                        };
                        
                        _context.Payments.Add(payment);
                        
                        // Track cleared payments only
                        if (paymentStatus == PaymentStatus.CLEARED)
                        {
                            totalPaidCleared += p.Amount;
                        }
                    }
                    
                    // Save all payments at once
                    await _context.SaveChangesAsync();

                    // Update sale payment status based on CLEARED payments only
                    saleForUpdate.PaidAmount = totalPaidCleared;
                    if (totalPaidCleared >= grandTotal)
                    {
                        saleForUpdate.PaymentStatus = SalePaymentStatus.Paid;
                        saleForUpdate.LastPaymentDate = DateTime.UtcNow;
                    }
                    else if (totalPaidCleared > 0)
                    {
                        saleForUpdate.PaymentStatus = SalePaymentStatus.Partial;
                        saleForUpdate.LastPaymentDate = DateTime.UtcNow;
                    }
                    else
                    {
                        saleForUpdate.PaymentStatus = SalePaymentStatus.Pending;
                        saleForUpdate.LastPaymentDate = null;
                    }
                    
                    _logger.LogInformation(
                        "CREDIT SALE with payments: Paid {Paid} of {GrandTotal}, Status={Status}",
                        totalPaidCleared,
                        grandTotal,
                        saleForUpdate.PaymentStatus);
                }
                else
                {
                    // ===== CREDIT SALE with NO PAYMENTS =====
                    // Customer owes full amount
                    saleForUpdate.PaymentStatus = SalePaymentStatus.Pending;
                    saleForUpdate.PaidAmount = 0;
                    saleForUpdate.LastPaymentDate = null;
                    
                    _logger.LogInformation(
                        "CREDIT SALE (unpaid): Outstanding {GrandTotal}, Status={Status}",
                        grandTotal,
                        SalePaymentStatus.Pending);
                }
                
                // STEP 4: Add new invoice to new customer's balance (if credit sale)
                if (newCustomerId.HasValue)
                {
                    // PROD-4: Filter by TenantId for tenant isolation
                    var newCustomer = await _context.Customers
                        .FirstOrDefaultAsync(c => c.Id == newCustomerId.Value && c.TenantId == tenantId);
                    if (newCustomer == null)
                    {
                        throw new InvalidOperationException($"Customer with ID {newCustomerId.Value} not found or does not belong to your tenant");
                    }
                    
                    // Add new invoice outstanding to customer balance
                    decimal newOutstanding = grandTotal - saleForUpdate.PaidAmount;
                    newCustomer.Balance += newOutstanding;
                    newCustomer.LastActivity = DateTime.UtcNow;
                    newCustomer.UpdatedAt = DateTime.UtcNow;
                    
                    // Apply new cleared payments to customer balance
                    if (saleForUpdate.PaidAmount > 0)
                    {
                        newCustomer.Balance -= saleForUpdate.PaidAmount;
                    }
                    
                    Console.WriteLine($"   ✅ Added new invoice to Customer {newCustomerId}: +{newOutstanding:C}, Payments: -{saleForUpdate.PaidAmount:C}");
                }

                // Recalculate customer balance with new amount
                if (request.CustomerId.HasValue)
                {
                    var customerService = new CustomerService(_context);
                    await customerService.RecalculateCustomerBalanceAsync(request.CustomerId.Value, tenantId);
                    
                    // Update customer LastActivity
                    // PROD-4: Filter by TenantId for tenant isolation
                    var customer = await _context.Customers
                        .FirstOrDefaultAsync(c => c.Id == request.CustomerId.Value && c.TenantId == tenantId);
                    if (customer != null)
                    {
                        customer.LastActivity = DateTime.UtcNow;
                        customer.UpdatedAt = DateTime.UtcNow;
                        await _context.SaveChangesAsync();
                    }
                }

                // Calculate diff summary for better audit trail
                var diffSummary = CalculateInvoiceDiff(versionSnapshot, request, saleForUpdate, user.Name, newVersion);
                
                // Save InvoiceVersion snapshot
                var invoiceVersion = new InvoiceVersion
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    SaleId = saleId,
                    VersionNumber = saleForUpdate.Version - 1, // Previous version
                    CreatedById = userId,
                    CreatedAt = DateTime.UtcNow,
                    DataJson = versionJson,
                    EditReason = editReason,
                    DiffSummary = diffSummary // Enhanced diff summary
                };
                _context.InvoiceVersions.Add(invoiceVersion);

                // Create audit log with old/new values for edits
                var newTotalsForAudit = new { GrandTotal = saleForUpdate.GrandTotal, Subtotal = saleForUpdate.Subtotal, Discount = saleForUpdate.Discount, VatTotal = saleForUpdate.VatTotal };
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId,
                    TenantId = tenantId,
                    UserId = userId,
                    Action = "Sale Updated",
                    EntityType = "Sale",
                    EntityId = saleId,
                    Details = $"Invoice: {saleForUpdate.InvoiceNo} updated to Version {newVersion}. Reason: {editReason ?? "N/A"}",
                    OldValues = JsonSerializer.Serialize(oldTotalsForAudit),
                    NewValues = JsonSerializer.Serialize(newTotalsForAudit),
                    CreatedAt = DateTime.UtcNow
                };
                _context.AuditLogs.Add(auditLog);

                // Save changes - this will also update RowVersion automatically
                await _context.SaveChangesAsync();
                
                // Verify no concurrent modification occurred during save
                await _context.Entry(saleForUpdate).ReloadAsync();
                if (saleForUpdate.Version != newVersion)
                {
                    await transaction.RollbackAsync();
                    throw new InvalidOperationException(
                        "CONFLICT DETECTED: Invoice was modified during your edit. " +
                        $"Please refresh and try again. Current version: {saleForUpdate.Version}"
                    );
                }

                await transaction.CommitAsync();

                return await GetSaleByIdAsync(saleId, tenantId) ?? throw new InvalidOperationException("Failed to retrieve updated sale");
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                
                _logger.LogError(
                    ex,
                    "UpdateSaleAsync Error for SaleId {SaleId}. Type={Type}, Message={Message}",
                    saleId,
                    ex.GetType().Name,
                    ex.Message);

                if (ex.InnerException != null)
                {
                    _logger.LogError(
                        ex.InnerException,
                        "UpdateSaleAsync Inner Exception for SaleId {SaleId}. Type={Type}, Message={Message}",
                        saleId,
                        ex.InnerException.GetType().Name,
                        ex.InnerException.Message);
                }
                
                // Re-throw to be caught by controller
                throw;
            }
            });
        }

        public async Task<bool> DeleteSaleAsync(int saleId, int userId, int tenantId)
        {
            var strategyDelete = _context.Database.CreateExecutionStrategy();
            return await strategyDelete.ExecuteAsync(async () =>
            {
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // CRITICAL: Verify sale belongs to owner
                var sale = await _context.Sales
                    .Include(s => s.Items)
                    .ThenInclude(i => i.Product)
                    .FirstOrDefaultAsync(s => s.Id == saleId && s.TenantId == tenantId);

                if (sale == null)
                    return false;

                if (sale.IsDeleted)
                    return true; // Already deleted

                if (await _vatValidation.IsTransactionDateInLockedPeriodAsync(tenantId, sale.InvoiceDate))
                    throw new VatPeriodLockedException("VAT return period is locked for this invoice date. You cannot delete transactions in a locked period.");

                // REVERSE TRANSACTIONS: Restore stock when invoice is canceled/deleted
                // Only restore if invoice was finalized (stock was decremented)
                if (sale.IsFinalized)
                {
                    foreach (var item in sale.Items)
                    {
                        // PROD-4: Filter by TenantId for tenant isolation
                        var product = await _context.Products
                            .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                        if (product != null)
                        {
                            var baseQty = item.Qty * product.ConversionToBase;
                            // PROD-19: Atomic stock restore
                            var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                                $@"UPDATE ""Products"" 
                                   SET ""StockQty"" = ""StockQty"" + {baseQty}, 
                                       ""UpdatedAt"" = {DateTime.UtcNow}
                                   WHERE ""Id"" = {product.Id} 
                                     AND ""TenantId"" = {tenantId}");
                            
                            if (rowsAffected > 0)
                            {
                                await _context.Entry(product).ReloadAsync();
                            }

                            // Create reversal transaction
                            _context.InventoryTransactions.Add(new InventoryTransaction
                            {
                                OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                                TenantId = tenantId, // CRITICAL: Set new TenantId
                                ProductId = product.Id,
                                ChangeQty = baseQty,
                                TransactionType = TransactionType.Adjustment,
                                Reason = $"Sale Deleted/Canceled: {sale.InvoiceNo}",
                                CreatedAt = DateTime.UtcNow
                            });
                        }
                    }
                }

                // CRITICAL: Delete or void all related payments
                var relatedPayments = await _context.Payments
                    .Where(p => p.SaleId == saleId)
                    .ToListAsync();

                foreach (var payment in relatedPayments)
                {
                    // If payment was cleared, reverse its effects before deletion
                    if (payment.Status == PaymentStatus.CLEARED)
                    {
                        // Reverse customer balance adjustment
                        if (payment.CustomerId.HasValue)
                        {
                            // PROD-4: Filter by TenantId for tenant isolation
                            var customer = await _context.Customers
                                .FirstOrDefaultAsync(c => c.Id == payment.CustomerId.Value && c.TenantId == tenantId);
                            if (customer != null)
                            {
                                customer.Balance += payment.Amount; // Reverse: customer owes more
                                customer.UpdatedAt = DateTime.UtcNow;
                            }
                        }
                    }
                    
                    // Delete payment record
                    _context.Payments.Remove(payment);
                }

                // CRITICAL: Reset sale payment status and amounts
                sale.PaidAmount = 0;
                sale.PaymentStatus = SalePaymentStatus.Pending;
                sale.LastPaymentDate = null;

                // Recalculate customer balance (after payment deletion)
                if (sale.CustomerId.HasValue)
                {
                    var customerService = new CustomerService(_context);
                    await customerService.RecalculateCustomerBalanceAsync(sale.CustomerId.Value, tenantId);
                }

                // Soft delete
                sale.IsDeleted = true;
                sale.DeletedBy = userId;
                sale.DeletedAt = DateTime.UtcNow;

                // Create audit log
                // PROD-4: Filter by TenantId for tenant isolation
                var user = await _context.Users
                    .FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Sale Deleted",
                    Details = $"Invoice: {sale.InvoiceNo}, Total: {sale.GrandTotal:C}, Customer: {sale.Customer?.Name ?? "Cash"}, Deleted by: {user?.Name ?? "Unknown"}",
                    CreatedAt = DateTime.UtcNow
                };
                _context.AuditLogs.Add(auditLog);

                // Create alert for invoice deletion (tenant-specific)
                await _alertService.CreateAlertAsync(
                    AlertType.InvoiceDeleted,
                    $"Invoice {sale.InvoiceNo} deleted",
                    $"Deleted by {user?.Name ?? "Unknown"}. Total: {sale.GrandTotal:C}, Customer: {sale.Customer?.Name ?? "Cash"}",
                    AlertSeverity.Warning,
                    new Dictionary<string, object> {
                        { "InvoiceNo", sale.InvoiceNo },
                        { "InvoiceId", sale.Id },
                        { "GrandTotal", sale.GrandTotal },
                        { "CustomerId", sale.CustomerId ?? 0 },
                        { "DeletedBy", user?.Name ?? "Unknown" }
                    },
                    tenantId
                );

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                // ✅ REAL-TIME BALANCE UPDATE: Update customer balance after invoice deletion
                if (sale.CustomerId.HasValue)
                {
                    try
                    {
                        await _balanceService.UpdateCustomerBalanceOnInvoiceDeletedAsync(
                            sale.CustomerId.Value,
                            sale.GrandTotal);
                        
                        // Reverse any cleared payments
                        foreach (var payment in relatedPayments.Where(p => p.Status == PaymentStatus.CLEARED))
                        {
                            await _balanceService.UpdateCustomerBalanceOnPaymentDeletedAsync(
                                sale.CustomerId.Value,
                                payment.Amount);
                        }
                    }
                    catch (Exception balanceEx)
                    {
                        Console.WriteLine($"⚠️ Failed to update balance after deletion: {balanceEx.Message}");
                        // Create alert for admin (tenant-specific)
                        await _alertService.CreateAlertAsync(
                            AlertType.BalanceMismatch,
                            "Failed to update customer balance after invoice deletion",
                            $"Invoice: {sale.InvoiceNo}, Customer: {sale.CustomerId}",
                            AlertSeverity.Warning,
                            null,
                            tenantId);
                    }
                }

                return true;
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
            });
        }

        public async Task<byte[]> GenerateInvoicePdfAsync(int saleId, int tenantId, string? format = "A4")
        {
            var formatNormalized = string.IsNullOrWhiteSpace(format) ? "A4" : format.Trim();
            if (!new[] { "A4", "A5", "80mm", "58mm" }.Contains(formatNormalized, StringComparer.OrdinalIgnoreCase))
                formatNormalized = "A4";

            try
            {
                Console.WriteLine($"\n📄 PDF Generation: Starting for sale {saleId}, tenantId={tenantId}, format={formatNormalized}");
                
                // CRITICAL: Build query - super admin (tenantId=0) can access any sale
                IQueryable<Sale> query = _context.Sales.Where(s => s.Id == saleId);
                
                // Filter by owner only if not super admin
                if (tenantId > 0)
                {
                    query = query.Where(s => s.TenantId == tenantId);
                }
                
                var sale = await query
                    .Include(s => s.Customer)
                    .Include(s => s.Items)
                        .ThenInclude(i => i.Product)
                    .FirstOrDefaultAsync();

                if (sale == null)
                {
                    Console.WriteLine($"❌ PDF Generation: Sale with ID {saleId} not found");
                    throw new InvalidOperationException($"Sale with ID {saleId} not found");
                }
                
                Console.WriteLine($"✅ PDF Generation: Sale {saleId} found - {sale.Items?.Count ?? 0} items");
                
                var saleDto = new SaleDto
                {
                    Id = sale.Id,
                    OwnerId = sale.TenantId ?? 0, // CRITICAL: Must pass tenantId to PDF service for correct settings (mapped to OwnerId)
                    InvoiceNo = sale.InvoiceNo ?? $"INV-{saleId}",
                    InvoiceDate = sale.InvoiceDate,
                    CustomerId = sale.CustomerId,
                    CustomerName = sale.Customer?.Name ?? "Cash Customer",
                    Subtotal = sale.Subtotal,
                    VatTotal = sale.VatTotal,
                    RoundOff = sale.RoundOff,
                    GrandTotal = sale.GrandTotal,
                    PaymentStatus = sale.PaymentStatus.ToString(),
                    PaidAmount = sale.PaidAmount,
                    IsZeroInvoice = sale.IsZeroInvoice,
                    Items = sale.Items?.Select(i => new SaleItemDto
                    {
                        Id = i.Id,
                        ProductId = i.ProductId,
                        ProductName = i.Product?.NameEn ?? $"Product {i.ProductId}",
                        Qty = i.Qty,
                        UnitPrice = i.UnitPrice,
                        UnitType = i.Product?.UnitType ?? "CRTN",
                        LineTotal = i.LineTotal,
                        VatAmount = i.VatAmount
                    }).ToList() ?? new List<SaleItemDto>()
                };

                Console.WriteLine($"✅ PDF Generation: Calling PdfService (format={formatNormalized})...");
                var pdfBytes = await _pdfService.GenerateInvoicePdfAsync(saleDto, formatNormalized);
                
                Console.WriteLine($"✅ PDF Generation: SUCCESS! Generated {pdfBytes?.Length ?? 0} bytes");
                return pdfBytes ?? Array.Empty<byte>();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ PDF Error: {ex.Message}");
                throw;
            }
        }

        public Task<bool> CanEditInvoiceAsync(int saleId, int userId, string userRole, int tenantId)
            => _saleValidation.CanEditInvoiceAsync(saleId, userId, userRole, tenantId);

        public Task<bool> UnlockInvoiceAsync(int saleId, int userId, string unlockReason, int tenantId)
            => _saleValidation.UnlockInvoiceAsync(saleId, userId, unlockReason, tenantId);

        public async Task<List<InvoiceVersion>> GetInvoiceVersionsAsync(int saleId, int tenantId)
        {
            // CRITICAL: Only return versions for sales owned by this owner
            return await _context.InvoiceVersions
                .Include(v => v.CreatedByUser)
                .Where(v => v.SaleId == saleId && v.TenantId == tenantId)
                .OrderByDescending(v => v.VersionNumber)
                .ToListAsync();
        }

        public Task<bool> LockOldInvoicesAsync(int tenantId)
            => _saleValidation.LockOldInvoicesAsync(tenantId);

        private string CalculateInvoiceDiff(dynamic oldVersion, CreateSaleRequest newRequest, Sale oldSale, string editorName, int newVersion)
        {
            var changes = new List<string>();
            
            // Compare totals
            var oldTotal = oldSale.GrandTotal;
            var newTotal = (newRequest.Items?.Sum(i => i.UnitPrice * i.Qty) ?? 0m) * 1.05m - newRequest.Discount;
            if (Math.Abs(oldTotal - newTotal) > 0.01m)
            {
                changes.Add($"GrandTotal: {oldTotal:C} → {newTotal:C}");
            }
            
            // Compare discount
            if (Math.Abs((oldSale.Discount) - newRequest.Discount) > 0.01m)
            {
                changes.Add($"Discount: {oldSale.Discount:C} → {newRequest.Discount:C}");
            }
            
            // Compare item counts
            var oldItemCount = oldSale.Items?.Count ?? 0;
            var newItemCount = newRequest.Items?.Count ?? 0;
            if (oldItemCount != newItemCount)
            {
                changes.Add($"Items: {oldItemCount} → {newItemCount}");
            }
            
            // Compare customer
            if (oldSale.CustomerId != newRequest.CustomerId)
            {
                changes.Add($"Customer changed");
            }
            
            var summary = changes.Any() 
                ? $"Edited by {editorName} - Version {newVersion}. Changes: {string.Join(", ", changes)}"
                : $"Edited by {editorName} - Version {newVersion}";
            
            return summary;
        }

        public async Task<SaleDto?> RestoreInvoiceVersionAsync(int saleId, int versionNumber, int userId, int tenantId)
        {
            var strategyRestore = _context.Database.CreateExecutionStrategy();
            return await strategyRestore.ExecuteAsync(async () =>
            {
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // CRITICAL: Get the version to restore with owner verification
                var version = await _context.InvoiceVersions
                    .FirstOrDefaultAsync(v => v.SaleId == saleId && v.VersionNumber == versionNumber && v.TenantId == tenantId);
                
                if (version == null)
                    throw new InvalidOperationException($"Version {versionNumber} not found for invoice {saleId}");
                
                // Deserialize the old version data
                var oldData = JsonSerializer.Deserialize<dynamic>(version.DataJson);
                if (oldData == null)
                    throw new InvalidOperationException("Failed to deserialize version data");
                
                // Get current sale
                // AUDIT-4 FIX: Add TenantId filter to prevent cross-tenant sale access
                var currentSale = await _context.Sales
                    .Include(s => s.Items)
                    .FirstOrDefaultAsync(s => s.Id == saleId && s.TenantId == tenantId);
                
                if (currentSale == null)
                    throw new InvalidOperationException("Sale not found or does not belong to your tenant");
                
                // Create version snapshot of current state before restore
                var currentSnapshot = new
                {
                    Sale = new
                    {
                        currentSale.Id,
                        currentSale.InvoiceNo,
                        currentSale.InvoiceDate,
                        currentSale.CustomerId,
                        currentSale.Subtotal,
                        currentSale.VatTotal,
                        currentSale.Discount,
                        currentSale.GrandTotal,
                        currentSale.PaymentStatus,
                        currentSale.Version
                    },
                    Items = currentSale.Items.Select(i => new
                    {
                        i.Id,
                        i.ProductId,
                        i.UnitType,
                        i.Qty,
                        i.UnitPrice,
                        i.Discount,
                        i.VatAmount,
                        i.LineTotal
                    }).ToList()
                };
                
                var currentVersionJson = JsonSerializer.Serialize(currentSnapshot);
                var newVersion = currentSale.Version + 1;
                
                // Restore old items - reverse current stock changes first
                foreach (var item in currentSale.Items)
                {
                    // PROD-4: Filter by TenantId for tenant isolation
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                    if (product != null)
                    {
                        var baseQty = item.Qty * product.ConversionToBase;
                        // PROD-19: Atomic stock restore
                        var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                            $@"UPDATE ""Products"" 
                               SET ""StockQty"" = ""StockQty"" + {baseQty}, 
                                   ""UpdatedAt"" = {DateTime.UtcNow}
                               WHERE ""Id"" = {product.Id} 
                                 AND ""TenantId"" = {tenantId}");
                        
                        if (rowsAffected > 0)
                        {
                            await _context.Entry(product).ReloadAsync();
                        }
                    }
                }
                
                // Delete current items
                _context.SaleItems.RemoveRange(currentSale.Items);
                
                // TODO: Restore old items from version.DataJson
                // This requires deserializing and recreating SaleItems
                // For now, this is a placeholder - full implementation requires parsing the JSON structure
                
                // Save version snapshot
                var restoreVersion = new InvoiceVersion
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    SaleId = saleId,
                    VersionNumber = currentSale.Version,
                    CreatedById = userId,
                    CreatedAt = DateTime.UtcNow,
                    DataJson = currentVersionJson,
                    EditReason = $"Restored to version {versionNumber}",
                    DiffSummary = $"Restored to version {versionNumber} by user {userId}"
                };
                _context.InvoiceVersions.Add(restoreVersion);
                
                // Create audit log
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Invoice Version Restored",
                    Details = $"Invoice {currentSale.InvoiceNo} restored to version {versionNumber}",
                    CreatedAt = DateTime.UtcNow
                };
                _context.AuditLogs.Add(auditLog);
                
                await _context.SaveChangesAsync();
                await transaction.CommitAsync();
                
                return await GetSaleByIdAsync(saleId, tenantId);
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
            });
        }

        /// <summary>VAT% from company settings (tenant-scoped). Fallback 5 when not set. PRODUCTION_MASTER_TODO #37.</summary>
        private async Task<decimal> GetVatPercentAsync(int tenantId)
        {
            try
            {
                var setting = await _context.Settings
                    .FirstOrDefaultAsync(s => s.Key == "VAT_PERCENT" && s.OwnerId == tenantId);
                return decimal.TryParse(setting?.Value, out decimal vatPercent) ? vatPercent : 5;
            }
            catch (Exception ex)
            {
                var pgEx = ex as Npgsql.PostgresException ?? ex.InnerException as Npgsql.PostgresException;
                if (pgEx != null && pgEx.SqlState == "42703" && pgEx.MessageText.Contains("Value"))
                {
                    // Settings.Value column doesn't exist - use default VAT 5%
                    return 5;
                }
                // Log other errors but continue with default
                Console.WriteLine($"⚠️ Error loading VAT percent: {ex.Message}");
                return 5;
            }
        }

        /// <summary>
        /// Get all deleted sales for audit trail (Admin only)
        /// </summary>
        public async Task<List<SaleDto>> GetDeletedSalesAsync(int tenantId)
        {
            // CRITICAL: Only return deleted sales for this owner
            var deletedSales = await _context.Sales
                .Include(s => s.Customer)
                .Include(s => s.Items)
                    .ThenInclude(i => i.Product)
                .Include(s => s.DeletedByUser)
                .Where(s => s.TenantId == tenantId && s.IsDeleted)
                .OrderByDescending(s => s.DeletedAt)
                .Take(100) // Limit to last 100 deleted sales
                .ToListAsync();

            return deletedSales.Select(s => new SaleDto
            {
                Id = s.Id,
                OwnerId = s.TenantId ?? 0, // CRITICAL: Must include tenantId for audit trail (mapped to OwnerId)
                InvoiceNo = s.InvoiceNo,
                InvoiceDate = s.InvoiceDate,
                CustomerId = s.CustomerId,
                CustomerName = s.Customer?.Name,
                Subtotal = s.Subtotal,
                VatTotal = s.VatTotal,
                Discount = s.Discount,
                RoundOff = s.RoundOff,
                GrandTotal = s.GrandTotal,
                PaymentStatus = s.PaymentStatus.ToString(),
                Notes = s.Notes,
                CreatedAt = s.CreatedAt,
                DeletedBy = s.DeletedByUser?.Name,
                DeletedAt = s.DeletedAt,
                EditReason = s.EditReason,
                IsZeroInvoice = s.IsZeroInvoice,
                Items = s.Items.Select(i => new SaleItemDto
                {
                    Id = i.Id,
                    ProductId = i.ProductId,
                    ProductName = i.Product?.NameEn ?? "Unknown",
                    UnitType = i.UnitType,
                    Qty = i.Qty,
                    UnitPrice = i.UnitPrice,
                    Discount = i.Discount,
                    VatAmount = i.VatAmount,
                    LineTotal = i.LineTotal
                }).ToList()
            }).ToList();
        }

        /// <summary>
        /// CRITICAL: Reconcile payment status for a single sale based on actual payments
        /// This ensures Sale.PaymentStatus matches the calculated status from Payments table
        /// </summary>
        public async Task<bool> ReconcileSalePaymentStatusAsync(int saleId, int tenantId)
        {
            try
            {
                var sale = await _context.Sales
                    .FirstOrDefaultAsync(s => s.Id == saleId && s.TenantId == tenantId && !s.IsDeleted);
                
                if (sale == null) return false;
                
                // Calculate actual paid amount from all non-VOID payments
                var actualPaidAmount = await _context.Payments
                    .Where(p => p.SaleId == saleId && p.TenantId == tenantId && p.Status != PaymentStatus.VOID)
                    .SumAsync(p => p.Amount);
                
                // Determine correct status
                var correctStatus = actualPaidAmount >= sale.GrandTotal 
                    ? SalePaymentStatus.Paid 
                    : actualPaidAmount > 0 
                        ? SalePaymentStatus.Partial 
                        : SalePaymentStatus.Pending;
                
                // Update if different
                if (sale.PaymentStatus != correctStatus || sale.PaidAmount != actualPaidAmount)
                {
                    var oldStatus = sale.PaymentStatus;
                    var oldPaidAmount = sale.PaidAmount;
                    
                    sale.PaymentStatus = correctStatus;
                    sale.PaidAmount = actualPaidAmount;
                    sale.LastModifiedAt = DateTime.UtcNow;
                    
                    await _context.SaveChangesAsync();
                    
                    Console.WriteLine($"✅ Reconciled Sale {sale.InvoiceNo}: Status {oldStatus}->{correctStatus}, PaidAmount {oldPaidAmount}->{actualPaidAmount}");
                }
                
                return true;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error reconciling sale {saleId}: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// CRITICAL: Reconcile ALL sales payment status for an owner
        /// This fixes any discrepancies between Sale.PaymentStatus and actual payments
        /// </summary>
        public async Task<ReconciliationResult> ReconcileAllPaymentStatusAsync(int tenantId, int userId)
        {
            var result = new ReconciliationResult
            {
                TotalSales = 0,
                SalesFixed = 0,
                SalesWithDuplicatePayments = new List<DuplicatePaymentInfo>(),
                SalesWithOverpayment = new List<OverpaymentInfo>(),
                Errors = new List<string>()
            };
            
            try
            {
                // Get all non-deleted sales for this owner
                var sales = await _context.Sales
                    .Where(s => s.TenantId == tenantId && !s.IsDeleted)
                    .ToListAsync();
                
                result.TotalSales = sales.Count;
                
                // Get all payment totals per sale
                var paymentTotals = await _context.Payments
                    .Where(p => p.TenantId == tenantId && p.SaleId.HasValue && p.Status != PaymentStatus.VOID)
                    .GroupBy(p => p.SaleId!.Value)
                    .Select(g => new { SaleId = g.Key, TotalPaid = g.Sum(p => p.Amount), PaymentCount = g.Count() })
                    .ToDictionaryAsync(x => x.SaleId, x => new { x.TotalPaid, x.PaymentCount });
                
                // Check for duplicate payments (same sale, same amount, within 1 minute)
                var duplicates = await _context.Payments
                    .Where(p => p.TenantId == tenantId && p.SaleId.HasValue && p.Status != PaymentStatus.VOID)
                    .GroupBy(p => new { p.SaleId, p.Amount })
                    .Where(g => g.Count() > 1)
                    .Select(g => new { g.Key.SaleId, g.Key.Amount, Count = g.Count() })
                    .ToListAsync();
                
                foreach (var dup in duplicates)
                {
                    var sale = sales.FirstOrDefault(s => s.Id == dup.SaleId);
                    result.SalesWithDuplicatePayments.Add(new DuplicatePaymentInfo
                    {
                        SaleId = dup.SaleId ?? 0,
                        InvoiceNo = sale?.InvoiceNo ?? "Unknown",
                        Amount = dup.Amount,
                        DuplicateCount = dup.Count
                    });
                }
                
                // Fix each sale
                foreach (var sale in sales)
                {
                    try
                    {
                        var paymentInfo = paymentTotals.GetValueOrDefault(sale.Id);
                        var actualPaidAmount = paymentInfo?.TotalPaid ?? 0;
                        
                        // Determine correct status
                        var correctStatus = actualPaidAmount >= sale.GrandTotal 
                            ? SalePaymentStatus.Paid 
                            : actualPaidAmount > 0 
                                ? SalePaymentStatus.Partial 
                                : SalePaymentStatus.Pending;
                        
                        // Check for overpayment
                        if (actualPaidAmount > sale.GrandTotal + 0.01m)
                        {
                            result.SalesWithOverpayment.Add(new OverpaymentInfo
                            {
                                SaleId = sale.Id,
                                InvoiceNo = sale.InvoiceNo,
                                InvoiceTotal = sale.GrandTotal,
                                TotalPaid = actualPaidAmount,
                                Overpayment = actualPaidAmount - sale.GrandTotal
                            });
                        }
                        
                        // Update if different
                        if (sale.PaymentStatus != correctStatus || Math.Abs(sale.PaidAmount - actualPaidAmount) > 0.01m)
                        {
                            Console.WriteLine($"📋 Fixing Sale {sale.InvoiceNo}: Status {sale.PaymentStatus}->{correctStatus}, PaidAmount {sale.PaidAmount}->{actualPaidAmount}");
                            
                            sale.PaymentStatus = correctStatus;
                            sale.PaidAmount = actualPaidAmount;
                            sale.LastModifiedAt = DateTime.UtcNow;
                            
                            result.SalesFixed++;
                        }
                    }
                    catch (Exception saleEx)
                    {
                        result.Errors.Add($"Error fixing sale {sale.InvoiceNo}: {saleEx.Message}");
                    }
                }
                
                // Save all changes
                await _context.SaveChangesAsync();
                
                // Create audit log
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Payment Status Reconciliation",
                    Details = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        TotalSales = result.TotalSales,
                        SalesFixed = result.SalesFixed,
                        DuplicatesFound = result.SalesWithDuplicatePayments.Count,
                        OverpaymentsFound = result.SalesWithOverpayment.Count,
                        Errors = result.Errors.Count
                    }),
                    CreatedAt = DateTime.UtcNow
                };
                _context.AuditLogs.Add(auditLog);
                await _context.SaveChangesAsync();
                
                Console.WriteLine($"✅ Reconciliation complete: {result.SalesFixed}/{result.TotalSales} sales fixed, {result.SalesWithDuplicatePayments.Count} duplicates found, {result.SalesWithOverpayment.Count} overpayments found");
                
                return result;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error during reconciliation: {ex.Message}");
                result.Errors.Add($"Fatal error: {ex.Message}");
                return result;
            }
        }
    }
    
    // DTOs for reconciliation
    public class ReconciliationResult
    {
        public int TotalSales { get; set; }
        public int SalesFixed { get; set; }
        public List<DuplicatePaymentInfo> SalesWithDuplicatePayments { get; set; } = new();
        public List<OverpaymentInfo> SalesWithOverpayment { get; set; } = new();
        public List<string> Errors { get; set; } = new();
    }
    
    public class DuplicatePaymentInfo
    {
        public int SaleId { get; set; }
        public string InvoiceNo { get; set; } = "";
        public decimal Amount { get; set; }
        public int DuplicateCount { get; set; }
    }
    
    public class OverpaymentInfo
    {
        public int SaleId { get; set; }
        public string InvoiceNo { get; set; } = "";
        public decimal InvoiceTotal { get; set; }
        public decimal TotalPaid { get; set; }
        public decimal Overpayment { get; set; }
    }
}

