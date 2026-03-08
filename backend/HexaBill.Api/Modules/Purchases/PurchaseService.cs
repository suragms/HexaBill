/*
Purpose: Purchase service for supplier purchase management
Author: AI Assistant
Date: 2024
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;

namespace HexaBill.Api.Modules.Purchases
{
    public interface IPurchaseService
    {
        Task<PagedResponse<PurchaseDto>> GetPurchasesAsync(int tenantId, int page = 1, int pageSize = 10, DateTime? startDate = null, DateTime? endDate = null, string? supplierName = null, string? category = null, string? status = null);
        Task<PurchaseDto?> GetPurchaseByIdAsync(int id, int tenantId);
        Task<PurchaseDto> CreatePurchaseAsync(CreatePurchaseRequest request, int userId, int tenantId);
        Task<PurchaseDto?> UpdatePurchaseAsync(int id, CreatePurchaseRequest request, int userId, int tenantId);
        Task<bool> DeletePurchaseAsync(int id, int userId, int tenantId);
        Task<PurchaseAnalyticsDto> GetPurchaseAnalyticsAsync(int tenantId, DateTime? startDate = null, DateTime? endDate = null);
        Task<PurchasePendingSummaryDto> GetPendingSummaryAsync(int tenantId);
    }

    public class PurchaseService : IPurchaseService
    {
        private readonly AppDbContext _context;

        public PurchaseService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<PagedResponse<PurchaseDto>> GetPurchasesAsync(int tenantId, int page = 1, int pageSize = 10, DateTime? startDate = null, DateTime? endDate = null, string? supplierName = null, string? category = null, string? status = null)
        {
            // CRITICAL FIX: Ensure DateTimes are UTC for PostgreSQL
            if (startDate.HasValue)
            {
                startDate = startDate.Value.ToUtcKind();
            }
            if (endDate.HasValue)
            {
                endDate = endDate.Value.ToUtcKind();
            }

            var query = _context.Purchases
                .Include(p => p.Items)
                    .ThenInclude(i => i.Product)
                .AsQueryable();

            // CRITICAL: Multi-tenant data isolation - Skip filter for super admin (TenantId = 0)
            if (tenantId > 0)
            {
                query = query.Where(p => p.TenantId == tenantId);
            }
            // Super admin (TenantId = 0) sees ALL owners

            // Apply date range filter
            if (startDate.HasValue)
            {
                query = query.Where(p => p.PurchaseDate >= startDate.Value);
            }
            if (endDate.HasValue)
            {
                // FIX: Don't use .Date in database query
                var endOfDay = endDate.Value.AddDays(1).AddTicks(-1);
                query = query.Where(p => p.PurchaseDate <= endOfDay);
            }

            // Apply supplier name filter
            if (!string.IsNullOrWhiteSpace(supplierName))
            {
                query = query.Where(p => p.SupplierName.ToLower().Contains(supplierName.ToLower()));
            }

            // Apply category filter
            if (!string.IsNullOrWhiteSpace(category))
            {
                query = query.Where(p => p.ExpenseCategory == category);
            }

            var totalCount = await query.CountAsync();
            var purchaseEntities = await query
                .OrderByDescending(p => p.PurchaseDate)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            var supplierNames = purchaseEntities.Select(p => p.SupplierName).Distinct().ToList();
            var paymentStatusByPurchaseId = new Dictionary<int, (decimal PaidAmount, decimal BalanceAmount, string PaymentStatus)>();

            foreach (var supName in supplierNames)
            {
                var totalPayments = await _context.SupplierPayments
                    .Where(sp => sp.TenantId == tenantId && sp.SupplierName == supName)
                    .SumAsync(sp => (decimal?)sp.Amount) ?? 0;

                var supplierPurchases = await _context.Purchases
                    .Where(p => p.TenantId == tenantId && p.SupplierName == supName)
                    .OrderBy(p => p.PurchaseDate)
                    .Select(p => new { p.Id, p.TotalAmount })
                    .ToListAsync();

                decimal remainingPaymentPool = totalPayments;
                foreach (var sp in supplierPurchases)
                {
                    var paidForThis = Math.Min(sp.TotalAmount, Math.Max(0, remainingPaymentPool));
                    remainingPaymentPool -= paidForThis;
                    var balance = sp.TotalAmount - paidForThis;
                    var payStatus = paidForThis <= 0 ? "Unpaid" : paidForThis >= sp.TotalAmount ? "Paid" : "Partial";
                    paymentStatusByPurchaseId[sp.Id] = (paidForThis, balance, payStatus);
                }
            }

            var purchases = purchaseEntities.Select(p =>
            {
                var (paidAmount, balanceAmount, paymentStatus) = paymentStatusByPurchaseId.TryGetValue(p.Id, out var v) ? v : (0m, p.TotalAmount, "Unpaid");
                return new PurchaseDto
                {
                    Id = p.Id,
                    SupplierName = p.SupplierName,
                    InvoiceNo = p.InvoiceNo,
                    PurchaseDate = p.PurchaseDate,
                    ExpenseCategory = p.ExpenseCategory,
                    Subtotal = p.Subtotal,
                    VatTotal = p.VatTotal,
                    TotalAmount = p.TotalAmount,
                    PaidAmount = paidAmount,
                    BalanceAmount = balanceAmount,
                    PaymentStatus = paymentStatus,
                    Items = p.Items.Select(i => new PurchaseItemDto
                    {
                        Id = i.Id,
                        ProductId = i.ProductId,
                        ProductName = i.Product != null ? i.Product.NameEn : $"Unknown Product {i.ProductId}",
                        UnitType = i.UnitType,
                        Qty = i.Qty,
                        UnitCost = i.UnitCost,
                        UnitCostExclVat = i.UnitCostExclVat,
                        VatAmount = i.VatAmount,
                        LineTotal = i.LineTotal
                    }).ToList()
                };
            }).ToList();

            if (!string.IsNullOrWhiteSpace(status) && !status.Equals("all", StringComparison.OrdinalIgnoreCase))
            {
                var statusLower = status.ToLowerInvariant();
                purchases = purchases.Where(p => string.Equals(p.PaymentStatus, statusLower, StringComparison.OrdinalIgnoreCase)).ToList();
            }

            return new PagedResponse<PurchaseDto>
            {
                Items = purchases,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
            };
        }

        public async Task<PurchaseDto?> GetPurchaseByIdAsync(int id, int tenantId)
        {
            // CRITICAL: Multi-tenant data isolation - Skip filter for super admin (TenantId = 0)
            IQueryable<Purchase> baseQuery = _context.Purchases.Where(p => p.Id == id);
            
            if (tenantId > 0)
            {
                baseQuery = baseQuery.Where(p => p.TenantId == tenantId);
            }
            
            var purchase = await baseQuery
                .Include(p => p.Items)
                    .ThenInclude(i => i.Product)
                .FirstOrDefaultAsync();

            if (purchase == null) return null;

            var totalPayments = await _context.SupplierPayments
                .Where(sp => sp.TenantId == tenantId && sp.SupplierName == purchase.SupplierName)
                .SumAsync(sp => (decimal?)sp.Amount) ?? 0;
            var supplierPurchases = await _context.Purchases
                .Where(p => p.TenantId == tenantId && p.SupplierName == purchase.SupplierName)
                .OrderBy(p => p.PurchaseDate)
                .Select(p => new { p.Id, p.TotalAmount })
                .ToListAsync();
            decimal pool = totalPayments;
            decimal paidForThis = 0;
            foreach (var sp in supplierPurchases)
            {
                var paid = Math.Min(sp.TotalAmount, Math.Max(0, pool));
                pool -= paid;
                if (sp.Id == purchase.Id) { paidForThis = paid; break; }
            }
            var balanceAmount = purchase.TotalAmount - paidForThis;
            var paymentStatus = paidForThis <= 0 ? "Unpaid" : paidForThis >= purchase.TotalAmount ? "Paid" : "Partial";

            return new PurchaseDto
            {
                Id = purchase.Id,
                SupplierName = purchase.SupplierName,
                InvoiceNo = purchase.InvoiceNo,
                PurchaseDate = purchase.PurchaseDate,
                ExpenseCategory = purchase.ExpenseCategory,
                Subtotal = purchase.Subtotal,
                VatTotal = purchase.VatTotal,
                TotalAmount = purchase.TotalAmount,
                PaidAmount = paidForThis,
                BalanceAmount = balanceAmount,
                PaymentStatus = paymentStatus,
                Items = purchase.Items.Select(i => new PurchaseItemDto
                {
                    Id = i.Id,
                    ProductId = i.ProductId,
                    ProductName = i.Product.NameEn,
                    UnitType = i.UnitType,
                    Qty = i.Qty,
                    UnitCost = i.UnitCost,
                    UnitCostExclVat = i.UnitCostExclVat,
                    VatAmount = i.VatAmount,
                    LineTotal = i.LineTotal
                }).ToList()
            };
        }

        public async Task<PurchaseDto> CreatePurchaseAsync(CreatePurchaseRequest request, int userId, int tenantId)
        {
            // DEFENSIVE VALIDATION: Check request integrity
            if (request == null)
                throw new ArgumentNullException(nameof(request), "Request cannot be null");
            
            if (string.IsNullOrWhiteSpace(request.SupplierName))
                throw new InvalidOperationException("Supplier name is required");
            
            if (string.IsNullOrWhiteSpace(request.InvoiceNo))
                throw new InvalidOperationException("Invoice number is required");
            
            if (request.Items == null || request.Items.Count == 0)
                throw new InvalidOperationException("Purchase must have at least one item");
            
            // Validate each item has required fields
            foreach (var item in request.Items)
            {
                if (item.ProductId <= 0)
                    throw new InvalidOperationException($"Invalid product ID: {item.ProductId}");
                
                if (item.Qty <= 0)
                    throw new InvalidOperationException($"Quantity must be positive");
                
                if (item.UnitCost < 0)
                    throw new InvalidOperationException($"Unit cost cannot be negative");
                
                if (string.IsNullOrWhiteSpace(item.UnitType))
                    throw new InvalidOperationException("Unit type is required for all items");
            }
            
            // Validate unique supplier + invoice number within owner scope
            var existing = await _context.Purchases
                .FirstOrDefaultAsync(p => 
                    p.TenantId == tenantId && // CRITICAL: Check within owner scope only
                    p.SupplierName.ToLower() == request.SupplierName.ToLower() && 
                    p.InvoiceNo == request.InvoiceNo);
            
            if (existing != null)
            {
                throw new InvalidOperationException(
                    $"Purchase invoice '{request.InvoiceNo}' from supplier '{request.SupplierName}' already exists.");
            }
            
            // CRITICAL: NpgsqlRetryingExecutionStrategy does not support user-initiated transactions.
            // Wrap in CreateExecutionStrategy().ExecuteAsync() so the transaction is retriable.
            var strategy = _context.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                // VAT CALCULATION LOGIC
                // CRITICAL: Purchase bills show Unit Cost EXCLUDING VAT (like sales invoices)
                // Default: Costs EXCLUDE VAT (matching real purchase invoices)
                bool includesVat = request.IncludesVat ?? false; // Changed from true to false
                decimal vatPercent = request.VatPercent ?? 5m; // Default 5% VAT for UAE
                
                decimal subtotal = 0;
                decimal vatTotal = 0;
                decimal totalAmount = 0;
                var purchaseItems = new List<PurchaseItem>();
                var inventoryTransactions = new List<InventoryTransaction>();

                foreach (var item in request.Items)
                {
                    // CRITICAL: Verify product exists and belongs to owner
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                    if (product == null)
                        throw new InvalidOperationException($"Product with ID {item.ProductId} not found or does not belong to your company.");

                    // Calculate quantities safely
                    if (item.Qty <= 0 || item.Qty > 1000000)
                        throw new InvalidOperationException($"Invalid quantity {item.Qty} for product '{product.NameEn}'. Must be between 0.01 and 1,000,000.");
                    
                    var conversionToBase = product.ConversionToBase > 0 ? product.ConversionToBase : 1m;
                    var baseQty = item.Qty * conversionToBase;
                    if (baseQty <= 0)
                        throw new InvalidOperationException($"Calculated base quantity is invalid. Please check conversion ratio for product '{product.NameEn}'.");
                    
                    // Validate cost
                    if (item.UnitCost < 0 || item.UnitCost > 10000000)
                        throw new InvalidOperationException($"Invalid unit cost {item.UnitCost} for product '{product.NameEn}'. Must be between 0 and 10,000,000.");

                    // CRITICAL VAT CALCULATION
                    decimal unitCostExclVat;
                    decimal unitCostInclVat;
                    decimal itemVatAmount;
                    
                    if (includesVat)
                    {
                        // Cost includes VAT - need to extract VAT amount
                        // Formula: UnitCostExclVat = UnitCost / (1 + VatPercent/100)
                        unitCostInclVat = item.UnitCost;
                        unitCostExclVat = item.UnitCost / (1 + (vatPercent / 100));
                        itemVatAmount = unitCostInclVat - unitCostExclVat;
                    }
                    else
                    {
                        // Cost excludes VAT - need to add VAT
                        unitCostExclVat = item.UnitCost;
                        itemVatAmount = unitCostExclVat * (vatPercent / 100);
                        unitCostInclVat = unitCostExclVat + itemVatAmount;
                    }
                    
                    var lineSubtotal = item.Qty * unitCostExclVat;
                    var lineVat = item.Qty * itemVatAmount;
                    var lineTotal = item.Qty * unitCostInclVat;
                    
                    subtotal += lineSubtotal;
                    vatTotal += lineVat;
                    totalAmount += lineTotal;

                    var purchaseItem = new PurchaseItem
                    {
                        ProductId = item.ProductId,
                        UnitType = item.UnitType,
                        Qty = item.Qty,
                        UnitCost = item.UnitCost, // Store ORIGINAL entered cost (not calculated)
                        UnitCostExclVat = unitCostExclVat, // NEW: Cost excluding VAT
                        VatAmount = itemVatAmount, // NEW: VAT amount per unit
                        LineTotal = lineTotal
                    };

                    purchaseItems.Add(purchaseItem);

                    // Calculate base quantity and update stock (reuse validated baseQty from above)
                    // PROD-19: Atomic stock update; InventoryTransaction added below for reconciliation.
                    // If stock still shows 0 in UI, use Products page "Recompute Stock" to sync from InventoryTransactions.
                    var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                        $@"UPDATE ""Products"" 
                           SET ""StockQty"" = ""StockQty"" + {baseQty}, 
                               ""UpdatedAt"" = {DateTime.UtcNow}
                           WHERE ""Id"" = {product.Id} 
                             AND ""TenantId"" = {tenantId}");
                    
                    if (rowsAffected == 0)
                        throw new InvalidOperationException($"Product {product.Id} not found or does not belong to your tenant. Verify Product.TenantId is set and matches your company.");
                    
                    // Reload product to get updated stock value and RowVersion
                    await _context.Entry(product).ReloadAsync();
                    product.UpdatedAt = DateTime.UtcNow;
                    
                    // CRITICAL: Update cost price with VAT-EXCLUDED cost
                    // This ensures profit calculations are accurate (guard against ConversionToBase 0 to avoid DivideByZero)
                    if (unitCostExclVat > 0 && conversionToBase > 0)
                    {
                        var costPerBaseUnit = unitCostExclVat / conversionToBase;
                        product.CostPrice = costPerBaseUnit;
                    }

                    // Create inventory transaction (set tenant/owner for multi-tenant)
                    var inventoryTransaction = new InventoryTransaction
                    {
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        ProductId = item.ProductId,
                        ChangeQty = baseQty,
                        TransactionType = TransactionType.Purchase,
                        RefId = null, // Will be updated after purchase is created
                        CreatedAt = DateTime.UtcNow
                    };

                    inventoryTransactions.Add(inventoryTransaction);
                }

                var purchaseDate = request.PurchaseDate == default ? DateTime.UtcNow : request.PurchaseDate.ToUtcKind();
                var purchase = new Purchase
                {
                    OwnerId = tenantId,
                    TenantId = tenantId,
                    SupplierName = request.SupplierName,
                    InvoiceNo = request.InvoiceNo,
                    PurchaseDate = purchaseDate, // CRITICAL: Ensure UTC kind for PostgreSQL
                    ExpenseCategory = request.ExpenseCategory, // Track expense category
                    Subtotal = subtotal, // NEW: Amount before VAT
                    VatTotal = vatTotal, // NEW: VAT amount
                    TotalAmount = totalAmount, // Grand total (for backward compatibility)
                    CreatedBy = userId,
                    CreatedAt = DateTime.UtcNow
                };

                _context.Purchases.Add(purchase);
                await _context.SaveChangesAsync();

                // Update purchase items with purchase ID
                foreach (var item in purchaseItems)
                {
                    item.PurchaseId = purchase.Id;
                }

                _context.PurchaseItems.AddRange(purchaseItems);

                // Update inventory transactions with purchase ID
                foreach (var invTx in inventoryTransactions)
                {
                    invTx.RefId = purchase.Id;
                }

                _context.InventoryTransactions.AddRange(inventoryTransactions);

                // Create audit log (set tenant/owner for multi-tenant)
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId,
                    TenantId = tenantId,
                    UserId = userId,
                    Action = "Purchase Created",
                    Details = $"Supplier: {request.SupplierName}, Invoice: {request.InvoiceNo}, Total: {totalAmount:C}",
                    CreatedAt = DateTime.UtcNow
                };

                _context.AuditLogs.Add(auditLog);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return await GetPurchaseByIdAsync(purchase.Id, tenantId) ?? throw new InvalidOperationException("Failed to retrieve created purchase");
                }
                catch
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            });
        }

        public async Task<PurchaseDto?> UpdatePurchaseAsync(int id, CreatePurchaseRequest request, int userId, int tenantId)
        {
            var purchase = await _context.Purchases
                .Where(p => p.Id == id && p.TenantId == tenantId) // CRITICAL: Owner check
                .Include(p => p.Items)
                .FirstOrDefaultAsync();

            if (purchase == null)
                return null;

            // NpgsqlRetryingExecutionStrategy does not support user-initiated transactions; wrap in execution strategy.
            var strategy = _context.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                // Reverse old stock changes (guard ConversionToBase <= 0)
                foreach (var oldItem in purchase.Items)
                {
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == oldItem.ProductId && p.TenantId == tenantId);
                    if (product != null)
                    {
                        var conv = product.ConversionToBase > 0 ? product.ConversionToBase : 1m;
                        var oldBaseQty = oldItem.Qty * conv;
                        // PROD-19: Atomic stock reverse (remove old purchase stock)
                        var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                            $@"UPDATE ""Products"" 
                               SET ""StockQty"" = ""StockQty"" - {oldBaseQty}, 
                                   ""UpdatedAt"" = {DateTime.UtcNow}
                               WHERE ""Id"" = {product.Id} 
                                 AND ""TenantId"" = {tenantId}");
                        
                        if (rowsAffected > 0)
                        {
                            await _context.Entry(product).ReloadAsync();
                        }
                    }
                }

                // Remove old items and transactions
                _context.PurchaseItems.RemoveRange(purchase.Items);
                var oldTransactions = await _context.InventoryTransactions
                    .Where(t => t.RefId == id && t.TransactionType == TransactionType.Purchase)
                    .ToListAsync();
                _context.InventoryTransactions.RemoveRange(oldTransactions);

                // Update purchase details
                purchase.SupplierName = request.SupplierName;
                purchase.InvoiceNo = request.InvoiceNo ?? purchase.InvoiceNo;
                purchase.PurchaseDate = request.PurchaseDate == default ? purchase.PurchaseDate : request.PurchaseDate.ToUtcKind();
                purchase.ExpenseCategory = request.ExpenseCategory;

                // VAT CALCULATION LOGIC (same as CreatePurchase)
                // CRITICAL: Purchase bills show Unit Cost EXCLUDING VAT (like sales invoices)
                bool includesVat = request.IncludesVat ?? false; // Changed from true to false
                decimal vatPercent = request.VatPercent ?? 5m;
                
                decimal subtotal = 0;
                decimal vatTotal = 0;
                decimal totalAmount = 0;
                
                // Add new items and update stock
                foreach (var item in request.Items)
                {
                    // CRITICAL: Verify product belongs to owner
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                    if (product == null)
                        throw new InvalidOperationException($"Product with ID {item.ProductId} not found or does not belong to your company");

                    var conversionToBase = product.ConversionToBase > 0 ? product.ConversionToBase : 1m;
                    var baseQty = item.Qty * conversionToBase;
                    
                    // CRITICAL VAT CALCULATION
                    decimal unitCostExclVat;
                    decimal unitCostInclVat;
                    decimal itemVatAmount;
                    
                    if (includesVat)
                    {
                        unitCostInclVat = item.UnitCost;
                        unitCostExclVat = item.UnitCost / (1 + (vatPercent / 100));
                        itemVatAmount = unitCostInclVat - unitCostExclVat;
                    }
                    else
                    {
                        unitCostExclVat = item.UnitCost;
                        itemVatAmount = unitCostExclVat * (vatPercent / 100);
                        unitCostInclVat = unitCostExclVat + itemVatAmount;
                    }
                    
                    var lineSubtotal = item.Qty * unitCostExclVat;
                    var lineVat = item.Qty * itemVatAmount;
                    var lineTotal = item.Qty * unitCostInclVat;
                    
                    subtotal += lineSubtotal;
                    vatTotal += lineVat;
                    totalAmount += lineTotal;

                    var purchaseItem = new PurchaseItem
                    {
                        PurchaseId = id,
                        ProductId = item.ProductId,
                        UnitType = item.UnitType,
                        Qty = item.Qty,
                        UnitCost = item.UnitCost, // Store ORIGINAL entered cost (not calculated)
                        UnitCostExclVat = unitCostExclVat,
                        VatAmount = itemVatAmount,
                        LineTotal = lineTotal
                    };
                    _context.PurchaseItems.Add(purchaseItem);

                    // Update stock with new quantity
                    // PROD-19: Atomic stock update to prevent race conditions
                    var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                        $@"UPDATE ""Products"" 
                           SET ""StockQty"" = ""StockQty"" + {baseQty}, 
                               ""UpdatedAt"" = {DateTime.UtcNow}
                           WHERE ""Id"" = {product.Id} 
                             AND ""TenantId"" = {tenantId}");
                    
                    if (rowsAffected == 0)
                    {
                        throw new InvalidOperationException($"Product {product.Id} not found or does not belong to your tenant.");
                    }
                    
                    // Reload product to get updated stock value and RowVersion
                    await _context.Entry(product).ReloadAsync();
                    product.UpdatedAt = DateTime.UtcNow;
                    
                    if (unitCostExclVat > 0 && conversionToBase > 0)
                    {
                        product.CostPrice = unitCostExclVat / conversionToBase;
                    }

                    var inventoryTransaction = new InventoryTransaction
                    {
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        ProductId = item.ProductId,
                        ChangeQty = baseQty,
                        TransactionType = TransactionType.Purchase,
                        RefId = id,
                        Reason = $"Purchase Updated: {request.InvoiceNo}",
                        CreatedAt = DateTime.UtcNow
                    };
                    _context.InventoryTransactions.Add(inventoryTransaction);
                }

                purchase.Subtotal = subtotal;
                purchase.VatTotal = vatTotal;
                purchase.TotalAmount = totalAmount;

                // Create audit log for update
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId,
                    TenantId = tenantId,
                    UserId = userId,
                    Action = "Purchase Updated",
                    Details = $"Updated Purchase: Supplier={purchase.SupplierName}, Invoice={purchase.InvoiceNo}, Total={totalAmount:C}, Items={request.Items.Count}",
                    CreatedAt = DateTime.UtcNow
                };
                _context.AuditLogs.Add(auditLog);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return await GetPurchaseByIdAsync(id, tenantId);
                }
                catch
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            });
        }

        public async Task<bool> DeletePurchaseAsync(int id, int userId, int tenantId)
        {
            var purchase = await _context.Purchases
                .Where(p => p.Id == id && p.TenantId == tenantId) // CRITICAL: Owner check
                .Include(p => p.Items)
                .FirstOrDefaultAsync();

            if (purchase == null)
                return false;

            // Prevent orphaned payments: block delete if supplier balance after delete would be negative
            var supplierName = purchase.SupplierName;
            var totalPurchases = await _context.Purchases
                .Where(p => p.TenantId == tenantId && p.SupplierName == supplierName)
                .SumAsync(p => (decimal?)p.TotalAmount) ?? 0;
            var totalReturns = await _context.PurchaseReturns
                .Include(pr => pr.Purchase)
                .Where(pr => pr.Purchase.TenantId == tenantId && pr.Purchase.SupplierName == supplierName)
                .SumAsync(pr => (decimal?)pr.GrandTotal) ?? 0;
            var totalPayments = await _context.SupplierPayments
                .Where(sp => sp.TenantId == tenantId && sp.SupplierName == supplierName)
                .SumAsync(sp => (decimal?)sp.Amount) ?? 0;
            var currentNetPayable = totalPurchases - totalReturns - totalPayments;
            var balanceAfterDelete = currentNetPayable - purchase.TotalAmount;
            if (balanceAfterDelete < 0)
                throw new InvalidOperationException(
                    $"Cannot delete this purchase. The supplier has payments that would exceed remaining purchases, leaving a credit balance of {balanceAfterDelete:N2}. Reverse or adjust payments first, or delete payments before deleting the purchase.");

            // NpgsqlRetryingExecutionStrategy does not support user-initiated transactions; wrap in execution strategy.
            var strategy = _context.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                // CRITICAL: Validate stock before reversing - prevent negative stock
                foreach (var item in purchase.Items)
                {
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                    if (product != null)
                    {
                        var conv = product.ConversionToBase > 0 ? product.ConversionToBase : 1m;
                        var baseQty = item.Qty * conv;
                        if (product.StockQty < baseQty)
                            throw new InvalidOperationException(
                                $"Cannot delete purchase: Product '{product.NameEn}' would have negative stock (current: {product.StockQty}, removing: {baseQty}). Adjust sales or returns first.");
                    }
                }

                // CRITICAL: Reverse all stock changes before deleting (guard ConversionToBase <= 0)
                foreach (var item in purchase.Items)
                {
                    // PROD-4: Filter by TenantId for tenant isolation
                    var product = await _context.Products
                        .FirstOrDefaultAsync(p => p.Id == item.ProductId && p.TenantId == tenantId);
                    if (product != null)
                    {
                        var conv = product.ConversionToBase > 0 ? product.ConversionToBase : 1m;
                        var baseQty = item.Qty * conv;
                        // PROD-19: Atomic stock reverse (remove purchase stock on delete)
                        var rowsAffected = await _context.Database.ExecuteSqlInterpolatedAsync(
                            $@"UPDATE ""Products"" 
                               SET ""StockQty"" = ""StockQty"" - {baseQty}, 
                                   ""UpdatedAt"" = {DateTime.UtcNow}
                               WHERE ""Id"" = {product.Id} 
                                 AND ""TenantId"" = {tenantId}");
                        
                        if (rowsAffected > 0)
                        {
                            await _context.Entry(product).ReloadAsync();
                        }
                    }
                }

                // Remove all inventory transactions related to this purchase
                var inventoryTransactions = await _context.InventoryTransactions
                    .Where(t => t.RefId == id && t.TransactionType == TransactionType.Purchase)
                    .ToListAsync();
                _context.InventoryTransactions.RemoveRange(inventoryTransactions);

                // Remove all purchase items
                _context.PurchaseItems.RemoveRange(purchase.Items);

                // Remove the purchase record
                _context.Purchases.Remove(purchase);

                // Create audit log for deletion
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Purchase Deleted",
                    Details = $"Deleted Purchase: Supplier={purchase.SupplierName}, Invoice={purchase.InvoiceNo}, Total={purchase.TotalAmount:C}, Items={purchase.Items.Count}",
                    CreatedAt = DateTime.UtcNow
                };
                _context.AuditLogs.Add(auditLog);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return true;
                }
                catch (Exception ex)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            });
        }

        public async Task<PurchaseAnalyticsDto> GetPurchaseAnalyticsAsync(int tenantId, DateTime? startDate = null, DateTime? endDate = null)
        {
            // CRITICAL FIX: Ensure DateTimes are UTC for PostgreSQL
            if (startDate.HasValue)
            {
                startDate = startDate.Value.ToUtcKind();
            }
            if (endDate.HasValue)
            {
                endDate = endDate.Value.ToUtcKind();
            }

            var query = _context.Purchases
                .Where(p => p.TenantId == tenantId) // CRITICAL: Multi-tenant filter
                .Include(p => p.Items)
                .AsQueryable();

            // Apply date filters if provided
            if (startDate.HasValue)
            {
                query = query.Where(p => p.PurchaseDate >= startDate.Value);
            }
            if (endDate.HasValue)
            {
                // FIX: Don't use .Date in database query - convert to UTC first
                var endOfDay = endDate.Value.AddDays(1).AddTicks(-1);
                query = query.Where(p => p.PurchaseDate <= endOfDay);
            }

            var purchases = await query.ToListAsync();

            // Calculate totals
            var totalAmount = purchases.Sum(p => p.TotalAmount);
            var totalCount = purchases.Count;
            var totalItems = purchases.Sum(p => p.Items.Count);

            // Daily breakdown - FIX: .GroupBy().Date creates Unspecified DateTimes
            var dailyStats = purchases
                .GroupBy(p => new { p.PurchaseDate.Year, p.PurchaseDate.Month, p.PurchaseDate.Day })
                .Select(g => new DailyPurchaseStat
                {
                    Date = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc),
                    TotalAmount = g.Sum(p => p.TotalAmount),
                    Count = g.Count(),
                    ItemCount = g.Sum(p => p.Items.Count)
                })
                .OrderByDescending(d => d.Date)
                .ToList();

            // Supplier breakdown
            var supplierStats = purchases
                .GroupBy(p => p.SupplierName)
                .Select(g => new SupplierPurchaseStat
                {
                    SupplierName = g.Key,
                    TotalAmount = g.Sum(p => p.TotalAmount),
                    Count = g.Count(),
                    ItemCount = g.Sum(p => p.Items.Count)
                })
                .OrderByDescending(s => s.TotalAmount)
                .ToList();

            // Today's stats - CRITICAL FIX: Never use .Date property, it creates Unspecified
            // Create UTC midnight directly with DateTimeKind.Utc
            var utcNow = DateTime.UtcNow;
            var today = new DateTime(utcNow.Year, utcNow.Month, utcNow.Day, 0, 0, 0, DateTimeKind.Utc);
            var todayEnd = today.AddDays(1);
            var todayPurchases = purchases.Where(p => p.PurchaseDate >= today && p.PurchaseDate < todayEnd).ToList();
            var todayTotal = todayPurchases.Sum(p => p.TotalAmount);
            var todayCount = todayPurchases.Count;

            // Yesterday's stats - CRITICAL FIX: Use UTC-kind DateTime
            var yesterday = today.AddDays(-1);
            var yesterdayPurchases = purchases.Where(p => p.PurchaseDate >= yesterday && p.PurchaseDate < today).ToList();
            var yesterdayTotal = yesterdayPurchases.Sum(p => p.TotalAmount);
            var yesterdayCount = yesterdayPurchases.Count;

            // This week's stats - CRITICAL FIX: Use UTC-kind DateTime
            var startOfWeek = today.AddDays(-(int)today.DayOfWeek);
            var thisWeekPurchases = purchases.Where(p => p.PurchaseDate >= startOfWeek).ToList();
            var thisWeekTotal = thisWeekPurchases.Sum(p => p.TotalAmount);
            var thisWeekCount = thisWeekPurchases.Count;

            // Last week's stats - CRITICAL FIX: Use UTC-kind DateTime
            var startOfLastWeek = startOfWeek.AddDays(-7);
            var endOfLastWeek = startOfWeek;
            var lastWeekPurchases = purchases.Where(p => p.PurchaseDate >= startOfLastWeek && p.PurchaseDate < endOfLastWeek).ToList();
            var lastWeekTotal = lastWeekPurchases.Sum(p => p.TotalAmount);
            var lastWeekCount = lastWeekPurchases.Count;

            // Top supplier today
            var topSupplierToday = todayPurchases
                .GroupBy(p => p.SupplierName)
                .Select(g => new { Supplier = g.Key, Total = g.Sum(p => p.TotalAmount) })
                .OrderByDescending(s => s.Total)
                .FirstOrDefault();

            // Top supplier this week
            var topSupplierWeek = thisWeekPurchases
                .GroupBy(p => p.SupplierName)
                .Select(g => new { Supplier = g.Key, Total = g.Sum(p => p.TotalAmount) })
                .OrderByDescending(s => s.Total)
                .FirstOrDefault();

            return new PurchaseAnalyticsDto
            {
                TotalAmount = totalAmount,
                TotalCount = totalCount,
                TotalItems = totalItems,
                TodayTotal = todayTotal,
                TodayCount = todayCount,
                YesterdayTotal = yesterdayTotal,
                YesterdayCount = yesterdayCount,
                ThisWeekTotal = thisWeekTotal,
                ThisWeekCount = thisWeekCount,
                LastWeekTotal = lastWeekTotal,
                LastWeekCount = lastWeekCount,
                TopSupplierToday = topSupplierToday?.Supplier,
                TopSupplierTodayAmount = topSupplierToday?.Total ?? 0,
                TopSupplierWeek = topSupplierWeek?.Supplier,
                TopSupplierWeekAmount = topSupplierWeek?.Total ?? 0,
                DailyStats = dailyStats,
                SupplierStats = supplierStats
            };
        }

        /// <summary>Total pending to pay (purchase balances) and counts by status: Unpaid, Partial, Paid.</summary>
        public async Task<PurchasePendingSummaryDto> GetPendingSummaryAsync(int tenantId)
        {
            var supplierNames = await _context.Purchases
                .Where(p => p.TenantId == tenantId)
                .Select(p => p.SupplierName)
                .Distinct()
                .ToListAsync();

            var paymentStatusByPurchaseId = new Dictionary<int, (decimal PaidAmount, decimal BalanceAmount, string PaymentStatus)>();

            foreach (var supName in supplierNames)
            {
                var totalPayments = await _context.SupplierPayments
                    .Where(sp => sp.TenantId == tenantId && sp.SupplierName == supName)
                    .SumAsync(sp => (decimal?)sp.Amount) ?? 0;

                var supplierPurchases = await _context.Purchases
                    .Where(p => p.TenantId == tenantId && p.SupplierName == supName)
                    .OrderBy(p => p.PurchaseDate)
                    .Select(p => new { p.Id, p.TotalAmount })
                    .ToListAsync();

                decimal remainingPaymentPool = totalPayments;
                foreach (var sp in supplierPurchases)
                {
                    var paidForThis = Math.Min(sp.TotalAmount, Math.Max(0, remainingPaymentPool));
                    remainingPaymentPool -= paidForThis;
                    var balance = sp.TotalAmount - paidForThis;
                    var payStatus = paidForThis <= 0 ? "Unpaid" : paidForThis >= sp.TotalAmount ? "Paid" : "Partial";
                    paymentStatusByPurchaseId[sp.Id] = (paidForThis, balance, payStatus);
                }
            }

            decimal totalPendingToPay = 0;
            int unpaidCount = 0, partialCount = 0, paidCount = 0;
            foreach (var kv in paymentStatusByPurchaseId)
            {
                var (_, balance, status) = kv.Value;
                if (string.Equals(status, "Unpaid", StringComparison.OrdinalIgnoreCase)) { unpaidCount++; totalPendingToPay += balance; }
                else if (string.Equals(status, "Partial", StringComparison.OrdinalIgnoreCase)) { partialCount++; totalPendingToPay += balance; }
                else if (string.Equals(status, "Paid", StringComparison.OrdinalIgnoreCase)) paidCount++;
                else { unpaidCount++; totalPendingToPay += balance; }
            }

            return new PurchasePendingSummaryDto
            {
                TotalPendingToPay = totalPendingToPay,
                UnpaidCount = unpaidCount,
                PartialCount = partialCount,
                PaidCount = paidCount
            };
        }
    }

    public class PurchasePendingSummaryDto
    {
        public decimal TotalPendingToPay { get; set; }
        public int UnpaidCount { get; set; }
        public int PartialCount { get; set; }
        public int PaidCount { get; set; }
    }

    public class PurchaseDto
    {
        public int Id { get; set; }
        public string SupplierName { get; set; } = string.Empty;
        public string InvoiceNo { get; set; } = string.Empty;
        public DateTime PurchaseDate { get; set; }
        public string? ExpenseCategory { get; set; } // Expense category
            
        // VAT FIELDS (for accurate reporting)
        public decimal? Subtotal { get; set; } // Amount before VAT
        public decimal? VatTotal { get; set; } // VAT amount
        public decimal TotalAmount { get; set; } // Grand total

        // Payment tracking (Phase 4)
        public decimal PaidAmount { get; set; }
        public decimal BalanceAmount { get; set; }
        public string? PaymentStatus { get; set; } // Unpaid, Partial, Paid
            
        public List<PurchaseItemDto> Items { get; set; } = new();
    }

    public class PurchaseItemDto
    {
        public int Id { get; set; }
        public int ProductId { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public string UnitType { get; set; } = string.Empty;
        public decimal Qty { get; set; }
        public decimal UnitCost { get; set; } // Cost INCLUDING VAT (for backward compatibility)
        public decimal? UnitCostExclVat { get; set; } // Cost EXCLUDING VAT
        public decimal? VatAmount { get; set; } // VAT amount for this line
        public decimal LineTotal { get; set; } // Total INCLUDING VAT
    }

    public class PurchaseAnalyticsDto
    {
        public decimal TotalAmount { get; set; }
        public int TotalCount { get; set; }
        public int TotalItems { get; set; }
        public decimal TodayTotal { get; set; }
        public int TodayCount { get; set; }
        public decimal YesterdayTotal { get; set; }
        public int YesterdayCount { get; set; }
        public decimal ThisWeekTotal { get; set; }
        public int ThisWeekCount { get; set; }
        public decimal LastWeekTotal { get; set; }
        public int LastWeekCount { get; set; }
        public string? TopSupplierToday { get; set; }
        public decimal TopSupplierTodayAmount { get; set; }
        public string? TopSupplierWeek { get; set; }
        public decimal TopSupplierWeekAmount { get; set; }
        public List<DailyPurchaseStat> DailyStats { get; set; } = new();
        public List<SupplierPurchaseStat> SupplierStats { get; set; } = new();
    }

    public class DailyPurchaseStat
    {
        public DateTime Date { get; set; }
        public decimal TotalAmount { get; set; }
        public int Count { get; set; }
        public int ItemCount { get; set; }
    }

    public class SupplierPurchaseStat
    {
        public string SupplierName { get; set; } = string.Empty;
        public decimal TotalAmount { get; set; }
        public int Count { get; set; }
        public int ItemCount { get; set; }
    }
}

