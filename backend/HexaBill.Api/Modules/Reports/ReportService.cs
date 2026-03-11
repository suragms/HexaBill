/*
 * Purpose: Report service for analytics and AI suggestions
 * Single profit definition (PRODUCTION_MASTER_TODO #38): Profit = GrandTotal(Sales) - COGS - Expenses.
 * COGS = SaleItems (Qty × ConversionToBase × CostPrice). Use same in ProfitService and dashboard.
 */
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;
using HexaBill.Api.Modules.Payments;
using HexaBill.Api.Modules.Billing;
using HexaBill.Api.Modules.SuperAdmin;
using HexaBill.Api.Modules.Inventory;
using HexaBill.Api.Shared.Services;
using HexaBill.Api.Shared.Validation;

namespace HexaBill.Api.Modules.Reports
{
    public interface IReportService
    {
        Task<SummaryReportDto> GetSummaryReportAsync(int tenantId, DateTime? fromDate = null, DateTime? toDate = null, int? branchId = null, int? routeId = null, int? userIdForStaff = null, string? roleForStaff = null, bool skipCache = false);
        Task<PagedResponse<SaleDto>> GetSalesReportAsync(int tenantId, DateTime fromDate, DateTime toDate, int? customerId = null, string? status = null, int page = 1, int pageSize = 10, int? branchId = null, int? routeId = null, int? userIdForStaff = null, string? roleForStaff = null, string? search = null);
        Task<EnhancedSalesReportDto> GetEnhancedSalesReportAsync(int tenantId, DateTime fromDate, DateTime toDate, string granularity = "day", int? productId = null, int? customerId = null, string? status = null, int page = 1, int pageSize = 50);
        Task<List<ProductSalesDto>> GetProductSalesReportAsync(int tenantId, DateTime fromDate, DateTime toDate, int top = 20);
        Task<List<ProductSalesDto>> GetEnhancedProductSalesReportAsync(int tenantId, DateTime fromDate, DateTime toDate, int? productId = null, string? unitType = null, bool lowStockOnly = false);
        Task<PagedResponse<CustomerDto>> GetOutstandingCustomersAsync(int tenantId, int page = 1, int pageSize = 100, int days = 30);
        Task<CustomerReportDto> GetCustomerReportAsync(int tenantId, DateTime fromDate, DateTime toDate, decimal? minOutstanding = null);
        Task<PagedResponse<PaymentDto>> GetChequeReportAsync(int tenantId, int page = 1, int pageSize = 100);
        Task<AISuggestionsDto> GetAISuggestionsAsync(int tenantId, int periodDays = 30);
        Task<PagedResponse<PendingBillDto>> GetPendingBillsAsync(int tenantId, DateTime? fromDate = null, DateTime? toDate = null, int? customerId = null, string? search = null, string? status = null, int page = 1, int pageSize = 100);
        Task<AgingReportDto> GetAgingReportAsync(int tenantId, DateTime asOfDate, int? customerId = null);
        Task<StockReportDto> GetStockReportAsync(int tenantId, bool lowOnly = false);
        Task<List<ExpenseByCategoryDto>> GetExpensesByCategoryAsync(int tenantId, DateTime fromDate, DateTime toDate, int? branchId = null);
        Task<List<SalesVsExpensesDto>> GetSalesVsExpensesAsync(int tenantId, DateTime fromDate, DateTime toDate, string groupBy = "day");
        Task<SalesLedgerReportDto> GetComprehensiveSalesLedgerAsync(int tenantId, DateTime? fromDate = null, DateTime? toDate = null, int? branchId = null, int? routeId = null, int? staffId = null, int? userIdForStaff = null, string? roleForStaff = null);
        Task<List<StaffPerformanceDto>> GetStaffPerformanceAsync(int tenantId, DateTime fromDate, DateTime toDate, int? routeId = null); // FIX: Add route filter parameter
        /// <summary>Worksheet report for Owner: sales, purchases, expenses, total received (payments in period), pending receivables.</summary>
        Task<WorksheetReportDto> GetWorksheetReportAsync(int tenantId, DateTime fromDate, DateTime toDate);
        /// <summary>AP aging: what we owe to suppliers by age bucket (0-30, 31-60, 61-90, 90+ days).</summary>
        Task<ApAgingReportDto> GetApAgingReportAsync(int tenantId, DateTime asOfDate);
    }

    public class ReportService : IReportService
    {
        private readonly AppDbContext _context;
        private readonly IRouteScopeService _routeScopeService;
        private readonly ISettingsService _settingsService;
        private readonly IProductService _productService;
        private readonly ISalesSchemaService _salesSchema;
        private readonly IMemoryCache _cache;
        private readonly ILogger<ReportService> _logger;
        private readonly ITimeZoneService _timeZoneService;
        private static readonly TimeSpan SummaryReportCacheDuration = TimeSpan.FromMinutes(5);
        /// <summary>Short cache for "today" so dashboard Refresh and auto-refresh show live data.</summary>
        private static readonly TimeSpan SummaryReportTodayCacheDuration = TimeSpan.FromSeconds(30);

        public ReportService(AppDbContext context, IRouteScopeService routeScopeService, ISettingsService settingsService, IProductService productService, ISalesSchemaService salesSchema, IMemoryCache cache, ILogger<ReportService> logger, ITimeZoneService timeZoneService)
        {
            _context = context;
            _routeScopeService = routeScopeService;
            _settingsService = settingsService;
            _productService = productService;
            _salesSchema = salesSchema;
            _cache = cache;
            _logger = logger;
            _timeZoneService = timeZoneService;
        }

        /// <summary>True if the exception (or inner) is PostgreSQL 42703 undefined_column. Handles wrapped exceptions from EF/Npgsql and message-based detection.</summary>
        private static bool IsMissingColumn42703(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (e is PostgresException pg && pg.SqlState == "42703") return true;
                var msg = e.Message ?? "";
                if (msg.Contains("42703", StringComparison.Ordinal) || (msg.Contains("column", StringComparison.OrdinalIgnoreCase) && msg.Contains("does not exist", StringComparison.OrdinalIgnoreCase)))
                    return true;
            }
            return false;
        }

        public async Task<SummaryReportDto> GetSummaryReportAsync(int tenantId, DateTime? fromDate = null, DateTime? toDate = null, int? branchId = null, int? routeId = null, int? userIdForStaff = null, string? roleForStaff = null, bool skipCache = false)
        {
            if (skipCache)
                return await GetSummaryReportInternalAsync(tenantId, fromDate, toDate, branchId, routeId, userIdForStaff, roleForStaff);

            // Build cache key from normalized date range (use tenant timezone for "today")
            var today = _timeZoneService.GetCurrentDate();
            var startForKey = fromDate.HasValue ? new DateTime(fromDate.Value.Year, fromDate.Value.Month, fromDate.Value.Day, 0, 0, 0, DateTimeKind.Utc) : today;
            var endForKey = toDate.HasValue ? toDate.Value.AddDays(1) : today.AddDays(1);
            var cacheKey = $"report:summary:{tenantId}:{startForKey:yyyyMMdd}:{endForKey:yyyyMMdd}:{branchId}:{routeId}:{userIdForStaff}:{roleForStaff ?? ""}";

            // Use short cache when range is a single day (e.g. "Today") so dashboard Refresh and auto-refresh show live data
            var isSingleDay = fromDate.HasValue && toDate.HasValue && fromDate.Value.Date == toDate.Value.Date;
            var cacheDuration = isSingleDay ? SummaryReportTodayCacheDuration : SummaryReportCacheDuration;

            return await _cache.GetOrCreateAsync(cacheKey, async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = cacheDuration;
                return await GetSummaryReportInternalAsync(tenantId, fromDate, toDate, branchId, routeId, userIdForStaff, roleForStaff);
            });
        }

        private async Task<SummaryReportDto> GetSummaryReportInternalAsync(int tenantId, DateTime? fromDate, DateTime? toDate, int? branchId, int? routeId, int? userIdForStaff, string? roleForStaff)
        {
            try
            {
                // P5: Use tenant timezone (e.g. Asia/Dubai) for "today" so dashboard metrics match tenant day
                var today = _timeZoneService.GetCurrentDate();
                DateTime startDate;
                DateTime endDate;

                if (fromDate.HasValue)
                {
                    var fromLocal = new DateTime(fromDate.Value.Year, fromDate.Value.Month, fromDate.Value.Day, 0, 0, 0, DateTimeKind.Unspecified);
                    startDate = _timeZoneService.ConvertToUtc(fromLocal);
                }
                else
                {
                    startDate = today;
                }

                if (toDate.HasValue)
                {
                    var toEndLocal = new DateTime(toDate.Value.Year, toDate.Value.Month, toDate.Value.Day, 0, 0, 0, DateTimeKind.Unspecified).AddDays(1);
                    endDate = _timeZoneService.ConvertToUtc(toEndLocal).ToUtcKind();
                }
                else
                {
                    endDate = today.AddDays(1).ToUtcKind();
                }

                _logger.LogDebug("GetSummaryReportAsync called with tenantId={TenantId}, fromDate: {FromDate}, toDate: {ToDate}", tenantId, startDate.ToString("yyyy-MM-dd"), endDate.ToString("yyyy-MM-dd"));
                _logger.LogDebug("Date range: {Start} to {End}", startDate.ToString("yyyy-MM-dd HH:mm:ss"), endDate.ToString("yyyy-MM-dd HH:mm:ss"));

                var hasSalesBranchRoute = await _salesSchema.SalesHasBranchIdAndRouteIdAsync();

                decimal salesToday = 0;
                decimal purchasesToday = 0;
                decimal expensesToday = 0;

                try
                {
                    // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                    var salesQuery = _context.Sales
                        .Where(s => !s.IsDeleted && s.InvoiceDate >= startDate && s.InvoiceDate < endDate);
                    if (tenantId > 0)
                    {
                        salesQuery = salesQuery.Where(s => s.TenantId == tenantId);
                    }
                    if (hasSalesBranchRoute)
                    {
                        if (branchId.HasValue) salesQuery = salesQuery.Where(s => s.BranchId == null || s.BranchId == branchId.Value);
                        if (routeId.HasValue) salesQuery = salesQuery.Where(s => s.RouteId == null || s.RouteId == routeId.Value);
                    }
                    if (hasSalesBranchRoute && tenantId > 0 && userIdForStaff.HasValue && string.Equals(roleForStaff, "Staff", StringComparison.OrdinalIgnoreCase))
                    {
                        var restrictedRouteIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userIdForStaff.Value, tenantId, roleForStaff ?? "");
                        if (restrictedRouteIds != null && restrictedRouteIds.Length > 0)
                        {
                            salesQuery = salesQuery.Where(s => s.RouteId != null && restrictedRouteIds.Contains(s.RouteId.Value));
                        }
                        else if (restrictedRouteIds != null && restrictedRouteIds.Length == 0)
                        {
                            var staffBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == userIdForStaff.Value).Select(bs => bs.BranchId).ToListAsync();
                            if (staffBranchIds.Count > 0)
                                salesQuery = salesQuery.Where(s => s.BranchId == null || staffBranchIds.Contains(s.BranchId.Value));
                            else
                                salesQuery = salesQuery.Where(s => false);
                        }
                    }
                    var salesCount = await salesQuery.CountAsync();
                    _logger.LogDebug("Found {SalesCount} sales records in date range (SuperAdmin: {IsSuperAdmin})", salesCount, tenantId == 0);
                    salesToday = await salesQuery.SumAsync(s => (decimal?)s.GrandTotal) ?? 0;
                    _logger.LogDebug("Total sales today: {SalesToday}", salesToday);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error calculating salesToday: {Message}", ex.Message);
                    salesToday = 0;
                }

                decimal returnsToday = 0;
                int returnsCountToday = 0;
                try
                {
                    var returnsQuery = _context.SaleReturns
                        .Where(r => r.ReturnDate >= startDate && r.ReturnDate < endDate);
                    if (tenantId > 0)
                        returnsQuery = returnsQuery.Where(r => r.TenantId == tenantId);
                    if (hasSalesBranchRoute)
                    {
                        if (branchId.HasValue)
                            returnsQuery = returnsQuery.Where(r => r.BranchId == null || r.BranchId == branchId.Value);
                        if (routeId.HasValue)
                            returnsQuery = returnsQuery.Where(r => r.RouteId == null || r.RouteId == routeId.Value);
                    }
                    if (hasSalesBranchRoute && tenantId > 0 && userIdForStaff.HasValue && string.Equals(roleForStaff, "Staff", StringComparison.OrdinalIgnoreCase))
                    {
                        var restrictedRouteIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userIdForStaff.Value, tenantId, roleForStaff ?? "");
                        if (restrictedRouteIds != null && restrictedRouteIds.Length > 0)
                        {
                            returnsQuery = returnsQuery.Where(r => r.RouteId != null && restrictedRouteIds.Contains(r.RouteId.Value));
                        }
                        else if (restrictedRouteIds != null && restrictedRouteIds.Length == 0)
                        {
                            var staffBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == userIdForStaff.Value).Select(bs => bs.BranchId).ToListAsync();
                            if (staffBranchIds.Count > 0)
                                returnsQuery = returnsQuery.Where(r => r.BranchId == null || staffBranchIds.Contains(r.BranchId.Value));
                            else
                                returnsQuery = returnsQuery.Where(r => false);
                        }
                    }
                    returnsCountToday = await returnsQuery.CountAsync();
                    returnsToday = await returnsQuery.SumAsync(r => (decimal?)r.GrandTotal) ?? 0;
                    _logger.LogDebug("Returns today: count={Count}, total={Total}", returnsCountToday, returnsToday);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error calculating returnsToday: {Message}", ex.Message);
                    returnsToday = 0;
                    returnsCountToday = 0;
                }

                decimal damageLossToday = 0;
                try
                {
                    var damageLossQuery = _context.SaleReturnItems
                        .Where(sri => sri.SaleReturn.ReturnDate >= startDate && sri.SaleReturn.ReturnDate < endDate
                            && sri.Condition != null
                            && (sri.Condition.ToLower() == "damaged" || sri.Condition.ToLower() == "writeoff"));
                    if (tenantId > 0)
                        damageLossQuery = damageLossQuery.Where(sri => sri.SaleReturn.TenantId == tenantId);
                    if (hasSalesBranchRoute)
                    {
                        if (branchId.HasValue)
                            damageLossQuery = damageLossQuery.Where(sri => sri.SaleReturn.BranchId == null || sri.SaleReturn.BranchId == branchId.Value);
                        if (routeId.HasValue)
                            damageLossQuery = damageLossQuery.Where(sri => sri.SaleReturn.RouteId == null || sri.SaleReturn.RouteId == routeId.Value);
                    }
                    damageLossToday = await damageLossQuery.SumAsync(sri => (decimal?)sri.LineTotal) ?? 0;
                }
                catch (Exception ex)
                {
                    // SaleReturnItems.Condition or SaleReturn.BranchId/RouteId may not exist (42703)
                    damageLossToday = 0;
                    if (!IsMissingColumn42703(ex))
                        _logger.LogError(ex, "Error calculating damageLossToday: {Message}", ex.Message);
                }

                decimal netSalesToday = salesToday - returnsToday;

                try
                {
                    // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                    var purchasesQuery = _context.Purchases
                        .Where(p => p.PurchaseDate >= startDate && p.PurchaseDate < endDate);
                    if (tenantId > 0)
                    {
                        purchasesQuery = purchasesQuery.Where(p => p.TenantId == tenantId);
                    }
                    var purchasesCount = await purchasesQuery.CountAsync();
                    _logger.LogDebug("Found {Count} purchase records in date range (SuperAdmin: {IsSuperAdmin})", purchasesCount, tenantId == 0);
                    purchasesToday = await purchasesQuery.SumAsync(p => (decimal?)p.TotalAmount) ?? 0;
                    _logger.LogDebug("Total purchases today: {PurchasesToday}", purchasesToday);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error calculating purchasesToday: {Message}", ex.Message);
                    purchasesToday = 0;
                }

                try
                {
                    // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                    var expensesQuery = _context.Expenses
                        .Where(e => e.Date >= startDate && e.Date < endDate);
                    if (tenantId > 0)
                    {
                        expensesQuery = expensesQuery.Where(e => e.TenantId == tenantId);
                    }
                    var expensesCount = await expensesQuery.CountAsync();
                    _logger.LogDebug("Found {Count} expense records in date range (SuperAdmin: {IsSuperAdmin})", expensesCount, tenantId == 0);
                    expensesToday = await expensesQuery.SumAsync(e => (decimal?)e.Amount) ?? 0;
                    _logger.LogDebug("Total expenses today: {ExpensesToday}", expensesToday);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error calculating expensesToday: {Message}", ex.Message);
                    expensesToday = 0;
                }

                // CRITICAL FIX: Calculate COGS (Cost of Goods Sold) from actual sales, not purchases
                // COGS = Sum of (SaleItem.Qty × Product.ConversionToBase × Product.CostPrice) for all items sold in period
                decimal cogsToday = 0;
                try
                {
                    // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                    // When Sales has no BranchId/RouteId, project without them to avoid 42703
                    List<(int SaleId, decimal Qty, int ProductId)> saleItemsData;
                    if (hasSalesBranchRoute)
                    {
                        var saleItemsQuery = from si in _context.SaleItems
                                            join s in _context.Sales on si.SaleId equals s.Id
                                            where s.InvoiceDate >= startDate && s.InvoiceDate < endDate && !s.IsDeleted
                                            select new { si.SaleId, si.Qty, si.ProductId, s.TenantId, s.BranchId, s.RouteId };
                        if (tenantId > 0) saleItemsQuery = saleItemsQuery.Where(x => x.TenantId == tenantId);
                        if (branchId.HasValue) saleItemsQuery = saleItemsQuery.Where(x => x.BranchId == branchId.Value);
                        if (routeId.HasValue) saleItemsQuery = saleItemsQuery.Where(x => x.RouteId == routeId.Value);
                        if (tenantId > 0 && userIdForStaff.HasValue && string.Equals(roleForStaff, "Staff", StringComparison.OrdinalIgnoreCase))
                        {
                            var restrictedRouteIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userIdForStaff.Value, tenantId, roleForStaff ?? "");
                            if (restrictedRouteIds != null && restrictedRouteIds.Length > 0)
                                saleItemsQuery = saleItemsQuery.Where(x => x.RouteId != null && restrictedRouteIds.Contains(x.RouteId.Value));
                            else if (restrictedRouteIds != null && restrictedRouteIds.Length == 0)
                                saleItemsQuery = saleItemsQuery.Where(x => false);
                        }
                        var data = await saleItemsQuery.ToListAsync();
                        saleItemsData = data.Select(x => (x.SaleId, x.Qty, x.ProductId)).ToList();
                    }
                    else
                    {
                        var saleItemsQuery = from si in _context.SaleItems
                                            join s in _context.Sales on si.SaleId equals s.Id
                                            where s.InvoiceDate >= startDate && s.InvoiceDate < endDate && !s.IsDeleted
                                            select new { si.SaleId, si.Qty, si.ProductId, s.TenantId };
                        if (tenantId > 0) saleItemsQuery = saleItemsQuery.Where(x => x.TenantId == tenantId);
                        var data = await saleItemsQuery.ToListAsync();
                        saleItemsData = data.Select(x => (x.SaleId, x.Qty, x.ProductId)).ToList();
                    }
                    
                    // Get Product CostPrice and ConversionToBase separately (avoid loading entire entity)
                    var productIds = saleItemsData.Select(si => si.ProductId).Distinct().ToList();
                    var productData = await _context.Products
                        .Where(p => productIds.Contains(p.Id))
                        .Select(p => new { p.Id, p.CostPrice, p.ConversionToBase })
                        .ToDictionaryAsync(p => p.Id, p => new { p.CostPrice, p.ConversionToBase });
                    
                    // Calculate COGS: Convert sale quantity to base units, then multiply by cost price per base unit
                    cogsToday = saleItemsData
                        .Where(si => productData.ContainsKey(si.ProductId))
                        .Sum(si =>
                        {
                            var product = productData[si.ProductId];
                            var conversionFactor = product.ConversionToBase > 0 ? product.ConversionToBase : 1m;
                            var baseQty = si.Qty * conversionFactor;
                            var cogs = baseQty * product.CostPrice;
                            return cogs;
                        });
                    
                    _logger.LogDebug("Calculated COGS from {Count} sale items: {Cogs}", saleItemsData.Count, cogsToday);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error calculating COGS: {Message}", ex.Message);
                    cogsToday = 0;
                }

                // Profit = Net Sales (Sales - Returns) - COGS - Expenses. VendorDiscounts are not included in P&L.
                var grossProfit = netSalesToday - cogsToday;
                var profitToday = grossProfit - expensesToday;
                
                _logger.LogDebug("Report profit: Sales={Sales}, Returns={Returns}, NetSales={NetSales}, COGS={Cogs}, GrossProfit={GrossProfit}, Expenses={Expenses}, Profit={Profit}",
                    salesToday, returnsToday, netSalesToday, cogsToday, grossProfit, expensesToday, profitToday);

                List<ProductDto> lowStockProducts = new List<ProductDto>();
                try
                {
                    // #55: Per-product ReorderLevel or global fallback. AUDIT-6 FIX: Use paginated ProductService instead of loading all into memory
                    int? globalThreshold = null;
                    if (tenantId > 0)
                    {
                        var settings = await _settingsService.GetOwnerSettingsAsync(tenantId);
                        if (settings.TryGetValue("LOW_STOCK_GLOBAL_THRESHOLD", out var v) && !string.IsNullOrWhiteSpace(v) && int.TryParse(v.Trim(), out int gt) && gt > 0)
                            globalThreshold = gt;
                    }
                    var paged = await _productService.GetLowStockProductsAsync(tenantId, page: 1, pageSize: 10, globalThreshold);
                    lowStockProducts = paged.Items ?? new List<ProductDto>();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error loading low stock products: {Message}", ex.Message);
                    lowStockProducts = new List<ProductDto>();
                }

                List<SaleDto> pendingInvoices = new List<SaleDto>();
                int pendingBillsCount = 0;
                decimal pendingBillsAmount = 0;
                int paidBillsCount = 0;
                decimal paidBillsAmount = 0;
                try
                {
                    // PERFORMANCE FIX: Filter in database instead of loading all sales into RAM
                    // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                    // Use actual balance calculation: GrandTotal - PaidAmount > 0.01m
                    
                    // Build base query for tenant filtering
                    var baseSalesQuery = _context.Sales.Where(s => !s.IsDeleted);
                    if (tenantId > 0)
                    {
                        baseSalesQuery = baseSalesQuery.Where(s => s.TenantId == tenantId);
                    }
                    
                    // Pending bills: Filter in database (balance > 0.01m)
                    var pendingBillsQuery = baseSalesQuery
                        .Where(s => (s.GrandTotal - s.PaidAmount) > 0.01m); // Filter in SQL
                    
                    pendingBillsCount = await pendingBillsQuery.CountAsync(); // Count in database
                    pendingBillsAmount = await pendingBillsQuery.SumAsync(s => (decimal?)(s.GrandTotal - s.PaidAmount)) ?? 0m; // Sum in database
                    
                    // Paid bills: Filter in database (balance <= 0.01m)
                    var paidBillsQuery = baseSalesQuery
                        .Where(s => (s.GrandTotal - s.PaidAmount) <= 0.01m); // Filter in SQL
                    
                    paidBillsCount = await paidBillsQuery.CountAsync(); // Count in database
                    paidBillsAmount = await paidBillsQuery.SumAsync(s => (decimal?)s.GrandTotal) ?? 0m; // Sum in database
                    
                    _logger.LogDebug("Pending Bills: {Count} invoices, Amount: {Amount}; Paid: {PaidCount}, Amount: {PaidAmount}", pendingBillsCount, pendingBillsAmount, paidBillsCount, paidBillsAmount);
                    
                    // Get pending invoices for display (with customer info) - Limited to top 10 for performance
                    // CRITICAL: Get pending invoices with actual balance calculation
                    var pendingInvoicesQuery = from s in _context.Sales
                                               join c in _context.Customers on s.CustomerId equals c.Id into customerGroup
                                               from c in customerGroup.DefaultIfEmpty()
                                               where !s.IsDeleted && 
                                                     (s.GrandTotal - s.PaidAmount) > 0.01m // Actual balance > 0
                                               select new { Sale = s, Customer = c };
                    
                    // Apply tenant filter if needed
                    if (tenantId > 0)
                    {
                        pendingInvoicesQuery = pendingInvoicesQuery.Where(x => x.Sale.TenantId == tenantId);
                    }
                    
                    // Apply branch/route filters only when Sales has these columns
                    if (hasSalesBranchRoute)
                    {
                        if (branchId.HasValue)
                            pendingInvoicesQuery = pendingInvoicesQuery.Where(x => x.Sale.BranchId == branchId.Value);
                        if (routeId.HasValue)
                            pendingInvoicesQuery = pendingInvoicesQuery.Where(x => x.Sale.RouteId == routeId.Value);
                    }
                    if (hasSalesBranchRoute && tenantId > 0 && userIdForStaff.HasValue && string.Equals(roleForStaff, "Staff", StringComparison.OrdinalIgnoreCase))
                    {
                        var restrictedRouteIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userIdForStaff.Value, tenantId, roleForStaff ?? "");
                        if (restrictedRouteIds != null && restrictedRouteIds.Length > 0)
                            pendingInvoicesQuery = pendingInvoicesQuery.Where(x => x.Sale.RouteId != null && restrictedRouteIds.Contains(x.Sale.RouteId.Value));
                        else if (restrictedRouteIds != null && restrictedRouteIds.Length == 0)
                            pendingInvoicesQuery = pendingInvoicesQuery.Where(x => false);
                    }
                    
                    pendingInvoices = await pendingInvoicesQuery
                        .OrderByDescending(x => x.Sale.InvoiceDate)
                        .Take(10)
                        .Select(x => new SaleDto
                        {
                            Id = x.Sale.Id,
                            InvoiceNo = x.Sale.InvoiceNo,
                            InvoiceDate = x.Sale.InvoiceDate,
                            CustomerId = x.Sale.CustomerId,
                            CustomerName = x.Customer != null ? x.Customer.Name : null,
                            Subtotal = x.Sale.Subtotal,
                            VatTotal = x.Sale.VatTotal,
                            Discount = x.Sale.Discount,
                            RoundOff = x.Sale.RoundOff,
                            GrandTotal = x.Sale.GrandTotal,
                            PaidAmount = x.Sale.PaidAmount,
                            PaymentStatus = x.Sale.PaymentStatus.ToString(),
                            Notes = x.Sale.Notes,
                            Items = new List<SaleItemDto>() // Empty list for summary view
                        })
                        .ToListAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error loading pending invoices: {Message}", ex.Message);
                    if (ex.InnerException != null)
                    {
                        if (ex.InnerException != null)
                            _logger.LogError(ex.InnerException, "Inner exception: {Message}", ex.InnerException.Message);
                    }
                    pendingInvoices = new List<SaleDto>();
                    pendingBillsCount = 0;
                }

                // Calculate invoice counts
                // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                var invoicesTodayQuery = _context.Sales
                    .Where(s => !s.IsDeleted && s.InvoiceDate >= today && s.InvoiceDate < today.AddDays(1));
                if (tenantId > 0) invoicesTodayQuery = invoicesTodayQuery.Where(s => s.TenantId == tenantId);
                var invoicesToday = await invoicesTodayQuery.CountAsync();
                
                var startOfWeek = today.AddDays(-(int)today.DayOfWeek);
                var invoicesWeeklyQuery = _context.Sales
                    .Where(s => !s.IsDeleted && s.InvoiceDate >= startOfWeek && s.InvoiceDate < today.AddDays(1));
                if (tenantId > 0) invoicesWeeklyQuery = invoicesWeeklyQuery.Where(s => s.TenantId == tenantId);
                var invoicesWeekly = await invoicesWeeklyQuery.CountAsync();
                
                var startOfMonth = new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Utc);
                var invoicesMonthlyQuery = _context.Sales
                    .Where(s => !s.IsDeleted && s.InvoiceDate >= startOfMonth && s.InvoiceDate < today.AddDays(1));
                if (tenantId > 0) invoicesMonthlyQuery = invoicesMonthlyQuery.Where(s => s.TenantId == tenantId);
                var invoicesMonthly = await invoicesMonthlyQuery.CountAsync();

                // Calculate branch breakdown (only if no specific branchId/routeId filter is applied and Sales has BranchId/RouteId)
                List<DashboardBranchSummaryDto> branchBreakdown = new List<DashboardBranchSummaryDto>();
                if (!branchId.HasValue && !routeId.HasValue && tenantId > 0 && hasSalesBranchRoute) // Only show breakdown when columns exist
                {
                    try
                    {
                        // AUDIT-6 FIX: Use single grouped query instead of loop (reduces database round trips)
                        // Get branch names first (lightweight query)
                        var branchNames = await _context.Branches
                            .Where(b => b.TenantId == tenantId)
                            .Select(b => new { b.Id, b.Name })
                            .ToDictionaryAsync(b => b.Id, b => b.Name);

                        // Single grouped query for sales by branch
                        var branchSalesStats = await _context.Sales
                            .Where(s => !s.IsDeleted 
                                && s.TenantId == tenantId
                                && s.BranchId.HasValue
                                && s.InvoiceDate >= startDate 
                                && s.InvoiceDate < endDate)
                            .GroupBy(s => s.BranchId.Value)
                            .Select(g => new
                            {
                                BranchId = g.Key,
                                Sales = g.Sum(s => (decimal?)s.GrandTotal) ?? 0m,
                                InvoiceCount = g.Count()
                            })
                            .ToListAsync();

                        // Single grouped query for expenses by branch
                        var branchExpensesStats = await _context.Expenses
                            .Where(e => e.TenantId == tenantId
                                && e.BranchId.HasValue
                                && e.Date >= startDate 
                                && e.Date < endDate)
                            .GroupBy(e => e.BranchId.Value)
                            .Select(g => new
                            {
                                BranchId = g.Key,
                                Expenses = g.Sum(e => (decimal?)e.Amount) ?? 0m
                            })
                            .ToDictionaryAsync(x => x.BranchId, x => x.Expenses);

                        // Payments by branch (via Sale.BranchId)
                        var branchPaymentsStats = await _context.Payments
                            .Where(p => p.TenantId == tenantId && p.SaleId.HasValue
                                && p.PaymentDate >= startDate && p.PaymentDate < endDate)
                            .Join(_context.Sales.Where(s => !s.IsDeleted && s.BranchId.HasValue),
                                p => p.SaleId!.Value, s => s.Id, (p, s) => new { p.Amount, s.BranchId })
                            .GroupBy(x => x.BranchId!.Value)
                            .Select(g => new { BranchId = g.Key, Paid = g.Sum(x => (decimal?)x.Amount) ?? 0m })
                            .ToDictionaryAsync(x => x.BranchId, x => x.Paid);

                        // Combine results
                        foreach (var salesStat in branchSalesStats)
                        {
                            var branchName = branchNames.GetValueOrDefault(salesStat.BranchId, "Unknown");
                            var expenses = branchExpensesStats.GetValueOrDefault(salesStat.BranchId, 0m);
                            var paid = branchPaymentsStats.GetValueOrDefault(salesStat.BranchId, 0m);
                            var profit = salesStat.Sales - expenses;
                            var unpaid = salesStat.Sales > paid ? salesStat.Sales - paid : 0m;

                            branchBreakdown.Add(new DashboardBranchSummaryDto
                            {
                                BranchId = salesStat.BranchId,
                                BranchName = branchName,
                                Sales = salesStat.Sales,
                                Expenses = expenses,
                                Profit = profit,
                                InvoiceCount = salesStat.InvoiceCount,
                                UnpaidAmount = unpaid,
                                PaidAmount = paid
                            });
                        }

                        // Order by sales descending
                        branchBreakdown = branchBreakdown.OrderByDescending(b => b.Sales).ToList();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error calculating branch breakdown: {Message}", ex.Message);
                        branchBreakdown = new List<DashboardBranchSummaryDto>();
                    }
                }

                // Calculate daily sales trend using fromDate/toDate parameters
                List<DailySalesDto> dailySalesTrend = new List<DailySalesDto>();
                try
                {
                    // Use provided date range or default to last 7 days
                    var trendFromDate = startDate;
                    var trendToDate = endDate;
                    
                    // If date range is too large (>90 days), limit to last 90 days for performance
                    var daysDiff = (trendToDate - trendFromDate).TotalDays;
                    if (daysDiff > 90)
                    {
                        trendFromDate = trendToDate.AddDays(-90);
                        _logger.LogWarning("Date range too large ({Days} days), limiting to last 90 days for daily sales trend", daysDiff);
                    }
                    
                    // Build query with proper date range
                    var dailySalesQuery = _context.Sales
                        .Where(s => !s.IsDeleted 
                            && s.InvoiceDate >= trendFromDate 
                            && s.InvoiceDate < trendToDate.AddDays(1));
                    
                    // Apply tenant filter
                    if (tenantId > 0)
                    {
                        dailySalesQuery = dailySalesQuery.Where(s => s.TenantId == tenantId);
                    }
                    
                    // Apply branch/route filter only when Sales has these columns
                    if (hasSalesBranchRoute)
                    {
                        if (branchId.HasValue)
                            dailySalesQuery = dailySalesQuery.Where(s => s.BranchId == branchId.Value);
                        if (routeId.HasValue)
                            dailySalesQuery = dailySalesQuery.Where(s => s.RouteId == routeId.Value);
                    }
                    
                    // Group by date and calculate totals
                    var dailySalesData = await dailySalesQuery
                        .GroupBy(s => s.InvoiceDate.Date)
                        .Select(g => new
                        {
                            Date = g.Key,
                            Sales = g.Sum(s => s.GrandTotal),
                            InvoiceCount = g.Count()
                        })
                        .OrderBy(x => x.Date)
                        .ToListAsync();
                    
                    // Fill in missing days with zero sales
                    var currentDate = trendFromDate.Date;
                    var endDateForLoop = trendToDate.Date;
                    
                    while (currentDate <= endDateForLoop)
                    {
                        var dateStr = currentDate.ToString("yyyy-MM-dd");
                        var dayData = dailySalesData.FirstOrDefault(d => d.Date.Date == currentDate);
                        
                        dailySalesTrend.Add(new DailySalesDto
                        {
                            Date = dateStr,
                            Sales = dayData != null ? dayData.Sales : 0m,
                            InvoiceCount = dayData != null ? dayData.InvoiceCount : 0
                        });
                        
                        currentDate = currentDate.AddDays(1);
                    }
                    
                    _logger.LogDebug("Daily sales trend calculated for {Count} days (from {From} to {To})", dailySalesTrend.Count, trendFromDate.ToString("yyyy-MM-dd"), trendToDate.ToString("yyyy-MM-dd"));
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error calculating daily sales trend: {Message}", ex.Message);
                    dailySalesTrend = new List<DailySalesDto>();
                }

                // Calculate top customers for the period
                List<TopCustomerDto> topCustomers = new List<TopCustomerDto>();
                try
                {
                    var topCustomersQuery = from s in _context.Sales
                                           join c in _context.Customers on s.CustomerId equals c.Id
                                         where !s.IsDeleted 
                                             && s.InvoiceDate >= startDate 
                                             && s.InvoiceDate < endDate
                                               && s.CustomerId != null
                                           group s by new { c.Id, c.Name } into g
                                           select new TopCustomerDto
                                           {
                                               CustomerId = g.Key.Id,
                                               CustomerName = g.Key.Name ?? "Unknown",
                                               TotalSales = g.Sum(s => s.GrandTotal),
                                               InvoiceCount = g.Count()
                                           };
                    
                    if (tenantId > 0)
                    {
                        topCustomersQuery = from s in _context.Sales
                                           join c in _context.Customers on s.CustomerId equals c.Id
                                           where !s.IsDeleted 
                                               && s.TenantId == tenantId
                                               && s.InvoiceDate >= startDate 
                                               && s.InvoiceDate < endDate
                                               && s.CustomerId != null
                                           group s by new { c.Id, c.Name } into g
                                           select new TopCustomerDto
                                           {
                                               CustomerId = g.Key.Id,
                                               CustomerName = g.Key.Name ?? "Unknown",
                                               TotalSales = g.Sum(s => s.GrandTotal),
                                               InvoiceCount = g.Count()
                                           };
                    }
                    
                    if (hasSalesBranchRoute && branchId.HasValue)
                    {
                        topCustomersQuery = topCustomersQuery.Where(tc => 
                            _context.Sales.Any(s => s.CustomerId == tc.CustomerId && s.BranchId == branchId.Value));
                    }
                    
                    topCustomers = await topCustomersQuery
                        .OrderByDescending(c => c.TotalSales)
                        .Take(5)
                        .ToListAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error calculating top customers: {Message}", ex.Message);
                    topCustomers = new List<TopCustomerDto>();
                }

                // Calculate top products for the period
                List<TopProductDto> topProducts = new List<TopProductDto>();
                try
                {
                    var topProductsQuery = from si in _context.SaleItems
                                           join s in _context.Sales on si.SaleId equals s.Id
                                           join p in _context.Products on si.ProductId equals p.Id
                                         where !s.IsDeleted 
                                             && s.InvoiceDate >= startDate 
                                             && s.InvoiceDate < endDate
                                           group si by new { p.Id, p.NameEn, si.UnitType } into g
                                           select new TopProductDto
                                           {
                                               ProductId = g.Key.Id,
                                               ProductName = g.Key.NameEn ?? "Unknown",
                                               TotalSales = g.Sum(si => si.LineTotal),
                                               TotalQty = g.Sum(si => si.Qty),
                                               UnitType = g.Key.UnitType ?? "PIECE"
                                           };
                    
                    if (tenantId > 0)
                    {
                        topProductsQuery = from si in _context.SaleItems
                                           join s in _context.Sales on si.SaleId equals s.Id
                                           join p in _context.Products on si.ProductId equals p.Id
                                           where !s.IsDeleted 
                                               && s.TenantId == tenantId
                                               && s.InvoiceDate >= startDate 
                                               && s.InvoiceDate < endDate
                                           group si by new { p.Id, p.NameEn, si.UnitType } into g
                                           select new TopProductDto
                                           {
                                               ProductId = g.Key.Id,
                                               ProductName = g.Key.NameEn ?? "Unknown",
                                               TotalSales = g.Sum(si => si.LineTotal),
                                               TotalQty = g.Sum(si => si.Qty),
                                               UnitType = g.Key.UnitType ?? "PIECE"
                                           };
                    }
                    
                    if (hasSalesBranchRoute && branchId.HasValue)
                    {
                        topProductsQuery = from si in _context.SaleItems
                                           join s in _context.Sales on si.SaleId equals s.Id
                                           join p in _context.Products on si.ProductId equals p.Id
                                           where !s.IsDeleted 
                                               && s.BranchId == branchId.Value
                                               && s.InvoiceDate >= startDate 
                                               && s.InvoiceDate < endDate
                                           group si by new { p.Id, p.NameEn, si.UnitType } into g
                                           select new TopProductDto
                                           {
                                               ProductId = g.Key.Id,
                                               ProductName = g.Key.NameEn ?? "Unknown",
                                               TotalSales = g.Sum(si => si.LineTotal),
                                               TotalQty = g.Sum(si => si.Qty),
                                               UnitType = g.Key.UnitType ?? "PIECE"
                                           };
                        if (tenantId > 0)
                        {
                            topProductsQuery = from si in _context.SaleItems
                                               join s in _context.Sales on si.SaleId equals s.Id
                                               join p in _context.Products on si.ProductId equals p.Id
                                               where !s.IsDeleted 
                                                   && s.TenantId == tenantId
                                                   && s.BranchId == branchId.Value
                                                   && s.InvoiceDate >= startDate 
                                                   && s.InvoiceDate < endDate
                                               group si by new { p.Id, p.NameEn, si.UnitType } into g
                                               select new TopProductDto
                                               {
                                                   ProductId = g.Key.Id,
                                                   ProductName = g.Key.NameEn ?? "Unknown",
                                                   TotalSales = g.Sum(si => si.LineTotal),
                                                   TotalQty = g.Sum(si => si.Qty),
                                                   UnitType = g.Key.UnitType ?? "PIECE"
                                               };
                        }
                    }
                    
                    topProducts = await topProductsQuery
                        .OrderByDescending(p => p.TotalSales)
                        .Take(5)
                        .ToListAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error calculating top products: {Message}", ex.Message);
                    topProducts = new List<TopProductDto>();
                }

                var result = new SummaryReportDto
                {
                    SalesToday = salesToday,
                    ReturnsToday = returnsToday,
                    NetSalesToday = netSalesToday,
                    ReturnsCountToday = returnsCountToday,
                    DamageLossToday = damageLossToday,
                    PurchasesToday = purchasesToday,
                    ExpensesToday = expensesToday,
                    CogsToday = cogsToday,
                    ProfitToday = profitToday,
                    LowStockProducts = lowStockProducts,
                    PendingInvoices = pendingInvoices,
                    PendingBills = pendingBillsCount,
                    PendingBillsAmount = pendingBillsAmount,
                    PaidBills = paidBillsCount,
                    PaidBillsAmount = paidBillsAmount,
                    InvoicesToday = invoicesToday,
                    InvoicesWeekly = invoicesWeekly,
                    InvoicesMonthly = invoicesMonthly,
                    BranchBreakdown = branchBreakdown,
                    DailySalesTrend = dailySalesTrend,
                    TopCustomersToday = topCustomers,
                    TopProductsToday = topProducts
                };
                
                _logger.LogDebug("SummaryReportDto created: Sales={Sales}, COGS={Cogs}, Purchases={Purchases}, Expenses={Expenses}, Profit={Profit}", salesToday, cogsToday, purchasesToday, expensesToday, profitToday);
                
                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Critical error in GetSummaryReportAsync: {Message}", ex.Message);
                if (ex.InnerException != null)
                {
                    _logger.LogError(ex.InnerException, "Inner exception: {Message}", ex.InnerException.Message);
                }
                
                // Return a safe default response
                return new SummaryReportDto
                {
                    SalesToday = 0,
                    ReturnsToday = 0,
                    NetSalesToday = 0,
                    ReturnsCountToday = 0,
                    DamageLossToday = 0,
                    PurchasesToday = 0,
                    ExpensesToday = 0,
                    ProfitToday = 0,
                    LowStockProducts = new List<ProductDto>(),
                    PendingInvoices = new List<SaleDto>(),
                    PendingBills = 0,
                    PendingBillsAmount = 0,
                    PaidBills = 0,
                    PaidBillsAmount = 0,
                    InvoicesToday = 0,
                    InvoicesWeekly = 0,
                    InvoicesMonthly = 0
                };
            }
        }

        public async Task<WorksheetReportDto> GetWorksheetReportAsync(int tenantId, DateTime fromDate, DateTime toDate)
        {
            var summary = await GetSummaryReportAsync(tenantId, fromDate, toDate, null, null, null, null, skipCache: true);

            var fromLocal = new DateTime(fromDate.Year, fromDate.Month, fromDate.Day, 0, 0, 0, DateTimeKind.Unspecified);
            var toEndLocal = new DateTime(toDate.Year, toDate.Month, toDate.Day, 0, 0, 0, DateTimeKind.Unspecified).AddDays(1);
            var startUtc = _timeZoneService.ConvertToUtc(fromLocal);
            var endUtc = _timeZoneService.ConvertToUtc(toEndLocal).ToUtcKind();

            // TotalReceived = customer payments (not refunds) in period; exclude VOID
            var totalReceived = await _context.Payments
                .Where(p => (p.TenantId == tenantId || (p.TenantId == null && p.OwnerId == tenantId))
                    && p.SaleReturnId == null
                    && p.Status != PaymentStatus.VOID
                    && p.PaymentDate >= startUtc
                    && p.PaymentDate < endUtc)
                .SumAsync(p => (decimal?)p.Amount) ?? 0m;

            return new WorksheetReportDto
            {
                TotalSales = summary.SalesToday,
                TotalPurchases = summary.PurchasesToday,
                TotalExpenses = summary.ExpensesToday,
                TotalReceived = totalReceived,
                PendingAmount = summary.PendingBillsAmount
            };
        }

        public async Task<ApAgingReportDto> GetApAgingReportAsync(int tenantId, DateTime asOfDate)
        {
            var supplierNames = await _context.Purchases
                .Where(p => p.TenantId == tenantId && p.SupplierName != null && p.SupplierName != "")
                .Select(p => p.SupplierName!)
                .Distinct()
                .ToListAsync();

            var items = new List<ApAgingItemDto>();
            foreach (var supplierName in supplierNames)
            {
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
                decimal totalLedgerCredits;
                try
                {
                    totalLedgerCredits = await _context.SupplierLedgerCredits
                        .Where(slc => slc.TenantId == tenantId && slc.SupplierName == supplierName)
                        .SumAsync(slc => (decimal?)slc.Amount) ?? 0;
                }
                catch (PostgresException ex) when (ex.SqlState == "42P01")
                {
                    totalLedgerCredits = 0;
                }
                var balance = totalPurchases - totalReturns - totalPayments - totalLedgerCredits;
                if (balance <= 0.01m) continue;

                var lastPurchaseDate = await _context.Purchases
                    .Where(p => p.TenantId == tenantId && p.SupplierName == supplierName)
                    .OrderByDescending(p => p.PurchaseDate)
                    .Select(p => (DateTime?)p.PurchaseDate)
                    .FirstOrDefaultAsync();
                var refDate = lastPurchaseDate ?? asOfDate;
                var daysOverdue = (asOfDate.Date - refDate.Date).Days;
                string bucket;
                if (daysOverdue <= 30) bucket = "0-30";
                else if (daysOverdue <= 60) bucket = "31-60";
                else if (daysOverdue <= 90) bucket = "61-90";
                else bucket = "90+";

                items.Add(new ApAgingItemDto
                {
                    SupplierName = supplierName,
                    Balance = balance,
                    DaysOverdue = daysOverdue,
                    AgingBucket = bucket,
                    OldestPurchaseDate = lastPurchaseDate
                });
            }

            var bucket0_30 = new ApAgingBucket
            {
                Items = items.Where(i => i.AgingBucket == "0-30").ToList(),
                Total = items.Where(i => i.AgingBucket == "0-30").Sum(i => i.Balance),
                Count = items.Count(i => i.AgingBucket == "0-30")
            };
            var bucket31_60 = new ApAgingBucket
            {
                Items = items.Where(i => i.AgingBucket == "31-60").ToList(),
                Total = items.Where(i => i.AgingBucket == "31-60").Sum(i => i.Balance),
                Count = items.Count(i => i.AgingBucket == "31-60")
            };
            var bucket61_90 = new ApAgingBucket
            {
                Items = items.Where(i => i.AgingBucket == "61-90").ToList(),
                Total = items.Where(i => i.AgingBucket == "61-90").Sum(i => i.Balance),
                Count = items.Count(i => i.AgingBucket == "61-90")
            };
            var bucket90Plus = new ApAgingBucket
            {
                Items = items.Where(i => i.AgingBucket == "90+").ToList(),
                Total = items.Where(i => i.AgingBucket == "90+").Sum(i => i.Balance),
                Count = items.Count(i => i.AgingBucket == "90+")
            };

            return new ApAgingReportDto
            {
                Bucket0_30 = bucket0_30,
                Bucket31_60 = bucket31_60,
                Bucket61_90 = bucket61_90,
                Bucket90Plus = bucket90Plus,
                TotalOutstanding = items.Sum(i => i.Balance),
                Items = items.OrderByDescending(i => i.DaysOverdue).ToList()
            };
        }

        public async Task<PagedResponse<SaleDto>> GetSalesReportAsync(
            int tenantId,
            DateTime fromDate, 
            DateTime toDate, 
            int? customerId = null,
            string? status = null,
            int page = 1, 
            int pageSize = 10,
            int? branchId = null,
            int? routeId = null,
            int? userIdForStaff = null,
            string? roleForStaff = null,
            string? search = null)
        {
            // CRITICAL FIX: Use < instead of <= for toDate comparison
            var query = _context.Sales
                .Where(s => !s.IsDeleted && s.InvoiceDate >= fromDate && s.InvoiceDate < toDate);
            if (tenantId > 0)
            {
                query = query.Where(s => s.TenantId == tenantId);
            }
            var hasSalesBranchRoute = await _salesSchema.SalesHasBranchIdAndRouteIdAsync();
            if (hasSalesBranchRoute)
            {
                // Include null BranchId/RouteId records (legacy data)
                if (branchId.HasValue) query = query.Where(s => s.BranchId == null || s.BranchId == branchId.Value);
                if (routeId.HasValue) query = query.Where(s => s.RouteId == null || s.RouteId == routeId.Value);
                if (tenantId > 0 && userIdForStaff.HasValue && string.Equals(roleForStaff, "Staff", StringComparison.OrdinalIgnoreCase))
                {
                    var restrictedRouteIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userIdForStaff.Value, tenantId, roleForStaff ?? "");
                    if (restrictedRouteIds != null && restrictedRouteIds.Length > 0)
                    {
                        query = query.Where(s => s.RouteId != null && restrictedRouteIds.Contains(s.RouteId.Value));
                    }
                    else if (restrictedRouteIds != null && restrictedRouteIds.Length == 0)
                    {
                        var branchIds = await _context.BranchStaff
                            .Where(bs => bs.UserId == userIdForStaff.Value)
                            .Select(bs => bs.BranchId)
                            .ToListAsync();
                        if (branchIds.Count > 0)
                        {
                            query = query.Where(s => s.BranchId == null || branchIds.Contains(s.BranchId.Value));
                        }
                        else
                        {
                            query = query.Where(s => false);
                        }
                    }
                }
            }
            
            _logger.LogDebug("GetSalesReportAsync: fromDate={From}, toDate={To}, customerId={CustomerId}, SuperAdmin={IsSuperAdmin}", fromDate.ToString("yyyy-MM-dd HH:mm:ss"), toDate.ToString("yyyy-MM-dd HH:mm:ss"), customerId, tenantId == 0);
            
            // Apply customer filter
            if (customerId.HasValue)
            {
                query = query.Where(s => s.CustomerId == customerId.Value);
            }
            
            // Apply status filter (Pending, Paid, Partial)
            if (!string.IsNullOrWhiteSpace(status))
            {
                var statusUpper = status.ToUpper();
                if (statusUpper == "PENDING" || statusUpper == "UNPAID")
                {
                    // Pending: balance > 0.01
                    query = query.Where(s => (s.GrandTotal - s.PaidAmount) > 0.01m);
                }
                else if (statusUpper == "PAID")
                {
                    // Paid: balance <= 0.01
                    query = query.Where(s => (s.GrandTotal - s.PaidAmount) <= 0.01m);
                }
                else if (statusUpper == "PARTIAL")
                {
                    // Partial: paid > 0 but balance > 0.01
                    query = query.Where(s => s.PaidAmount > 0 && (s.GrandTotal - s.PaidAmount) > 0.01m);
                }
            }
            
            // BUG #2.5 FIX: Apply search filter (invoice number or customer name) - server-side filtering
            if (!string.IsNullOrWhiteSpace(search))
            {
                var searchLower = search.ToLowerInvariant();
                query = query.Where(s => 
                    s.InvoiceNo.ToLower().Contains(searchLower) ||
                    (s.Customer != null && s.Customer.Name.ToLower().Contains(searchLower))
                );
            }
            
            var totalCount = await query.CountAsync();
            
            // When Sales has no BranchId/RouteId columns, project without them to avoid 42703
            List<SaleDto> sales;
            if (hasSalesBranchRoute)
            {
                sales = await (from s in query
                              join c in _context.Customers on s.CustomerId equals c.Id into customerGroup
                              from c in customerGroup.DefaultIfEmpty()
                              orderby s.InvoiceDate descending
                              select new SaleDto
                              {
                                  Id = s.Id,
                                  InvoiceNo = s.InvoiceNo,
                                  InvoiceDate = s.InvoiceDate,
                                  CustomerId = s.CustomerId,
                                  BranchId = s.BranchId,
                                  RouteId = s.RouteId,
                                  CustomerName = c != null ? c.Name : null,
                                  Subtotal = s.Subtotal,
                                  VatTotal = s.VatTotal,
                                  Discount = s.Discount,
                                  RoundOff = s.RoundOff,
                                  GrandTotal = s.GrandTotal,
                                  PaidAmount = s.PaidAmount,
                                  PaymentStatus = s.PaymentStatus.ToString(),
                                  Notes = s.Notes,
                                  Items = new List<SaleItemDto>()
                              })
                              .Skip((page - 1) * pageSize)
                              .Take(pageSize)
                              .ToListAsync();
            }
            else
            {
                sales = await (from s in query
                              join c in _context.Customers on s.CustomerId equals c.Id into customerGroup
                              from c in customerGroup.DefaultIfEmpty()
                              orderby s.InvoiceDate descending
                              select new SaleDto
                              {
                                  Id = s.Id,
                                  InvoiceNo = s.InvoiceNo,
                                  InvoiceDate = s.InvoiceDate,
                                  CustomerId = s.CustomerId,
                                  BranchId = null,
                                  RouteId = null,
                                  CustomerName = c != null ? c.Name : null,
                                  Subtotal = s.Subtotal,
                                  VatTotal = s.VatTotal,
                                  Discount = s.Discount,
                                  RoundOff = s.RoundOff,
                                  GrandTotal = s.GrandTotal,
                                  PaidAmount = s.PaidAmount,
                                  PaymentStatus = s.PaymentStatus.ToString(),
                                  Notes = s.Notes,
                                  Items = new List<SaleItemDto>()
                              })
                              .Skip((page - 1) * pageSize)
                              .Take(pageSize)
                              .ToListAsync();
            }
            
            _logger.LogDebug("Sales Report: {Total} total sales, returning {Count} for page {Page}", totalCount, sales.Count, page);

            return new PagedResponse<SaleDto>
            {
                Items = sales,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
            };
        }

        public async Task<List<ProductSalesDto>> GetProductSalesReportAsync(int tenantId, DateTime fromDate, DateTime toDate, int top = 20)
        {
            try
            {
                // First, get the grouped sales data
                // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                var baseQuery = from si in _context.SaleItems
                                join s in _context.Sales on si.SaleId equals s.Id
                                where !s.IsDeleted && s.InvoiceDate >= fromDate && s.InvoiceDate < toDate
                                select new { si, s };
                
                if (tenantId > 0)
                {
                    baseQuery = baseQuery.Where(x => x.s.TenantId == tenantId);
                }
                
                var groupedData = await (from x in baseQuery
                                        group x.si by x.si.ProductId into g
                                        select new
                                        {
                                            ProductId = g.Key,
                                            TotalQty = g.Sum(si => si.Qty),
                                            TotalAmount = g.Sum(si => si.LineTotal),
                                            TotalSales = g.Count()
                                        })
                                        .OrderByDescending(x => x.TotalAmount)
                                        .Take(top)
                                        .ToListAsync();

                // If no data, return empty list
                if (!groupedData.Any())
                {
                    return new List<ProductSalesDto>();
                }

                // Get product IDs to fetch product details
                // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                var productIds = groupedData.Select(x => x.ProductId).ToList();
                var productsQuery = _context.Products.Where(p => productIds.Contains(p.Id));
                if (tenantId > 0)
                {
                    productsQuery = productsQuery.Where(p => p.TenantId == tenantId);
                }
                var products = await productsQuery
                    .Select(p => new { p.Id, p.NameEn, p.Sku })
                    .ToListAsync();

                // Combine the data
                var productSales = groupedData.Select(g =>
                {
                    var product = products.FirstOrDefault(p => p.Id == g.ProductId);
                    return new ProductSalesDto
                    {
                        ProductId = g.ProductId,
                        ProductName = product != null ? (product.NameEn ?? "Unknown") : "Deleted Product",
                        Sku = product != null ? (product.Sku ?? "N/A") : "N/A",
                        TotalQty = g.TotalQty,
                        TotalAmount = g.TotalAmount,
                        TotalSales = g.TotalSales
                    };
                }).ToList();

                return productSales;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in GetProductSalesReportAsync: {Message}", ex.Message);
                if (ex.InnerException != null)
                {
                    _logger.LogError(ex.InnerException, "Inner exception: {Message}", ex.InnerException.Message);
                }
                // Return empty list instead of throwing
                return new List<ProductSalesDto>();
            }
        }

        public async Task<PagedResponse<CustomerDto>> GetOutstandingCustomersAsync(int tenantId, int page = 1, int pageSize = 100, int days = 30)
        {
            try
            {
                // CRITICAL: Get customers with outstanding balance > 0.01 (PendingBalance = what they owe, #7)
                // AUDIT-6 FIX: Add pagination to prevent memory exhaustion with many outstanding customers
                pageSize = Math.Min(pageSize, 100); // Max 100 items per page
                
                var query = _context.Customers
                    .Where(c => c.TenantId == tenantId && c.PendingBalance > 0.01m);
                
                var totalCount = await query.CountAsync();
                
                var customers = await query
                    .OrderByDescending(c => c.PendingBalance)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .Select(c => new CustomerDto
                    {
                        Id = c.Id,
                        Name = c.Name ?? "Unknown",
                        Phone = c.Phone,
                        Email = c.Email,
                        Trn = c.Trn,
                        Address = c.Address,
                        CreditLimit = c.CreditLimit,
                        Balance = c.PendingBalance,
                        PendingBalance = c.PendingBalance
                    })
                    .ToListAsync();

                _logger.LogDebug("GetOutstandingCustomersAsync: Found {Total} customers with outstanding balance (showing page {Page})", totalCount, page);
                if (customers.Any())
                {
                    _logger.LogDebug("Total outstanding: {Total}, Highest: {Highest} ({Name})", customers.Sum(c => c.Balance), customers.First().Balance, customers.First().Name);
                }
                
                return new PagedResponse<CustomerDto>
                {
                    Items = customers,
                    TotalCount = totalCount,
                    Page = page,
                    PageSize = pageSize,
                    TotalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in GetOutstandingCustomersAsync: {Message}", ex.Message);
                if (ex.InnerException != null)
                {
                    _logger.LogError(ex.InnerException, "Inner exception: {Message}", ex.InnerException.Message);
                }
                // Return empty paged response instead of throwing
                return new PagedResponse<CustomerDto>
                {
                    Items = new List<CustomerDto>(),
                    TotalCount = 0,
                    Page = page,
                    PageSize = pageSize,
                    TotalPages = 0
                };
            }
        }

        public async Task<PagedResponse<PaymentDto>> GetChequeReportAsync(int tenantId, int page = 1, int pageSize = 100)
        {
            // AUDIT-6 FIX: Add pagination to prevent memory exhaustion with many cheque payments
            pageSize = Math.Min(pageSize, 100); // Max 100 items per page
            
            var query = _context.Payments
                .Where(p => p.TenantId == tenantId && p.Mode == PaymentMode.CHEQUE)
                .Include(p => p.Sale)
                .Include(p => p.Customer);
            
            var totalCount = await query.CountAsync();
            
            var cheques = await query
                .OrderByDescending(p => p.PaymentDate)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(p => new PaymentDto
                {
                    Id = p.Id,
                    SaleId = p.SaleId,
                    InvoiceNo = p.Sale != null ? p.Sale.InvoiceNo : null,
                    CustomerId = p.CustomerId,
                    CustomerName = p.Customer != null ? p.Customer.Name : null,
                    Amount = p.Amount,
                    Mode = p.Mode.ToString(),
                    Reference = p.Reference,
                    Status = p.Status.ToString(),
                    PaymentDate = p.PaymentDate,
                    CreatedBy = p.CreatedBy,
                    CreatedAt = p.CreatedAt
                })
                .ToListAsync();

            return new PagedResponse<PaymentDto>
            {
                Items = cheques,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
            };
        }

        public async Task<AISuggestionsDto> GetAISuggestionsAsync(int tenantId, int periodDays = 30)
        {
            try
            {
                var fromDate = DateTime.UtcNow.Date.AddDays(-periodDays).ToUtcKind();

                // Top sellers - Safe query with null checks
                List<ProductDto> topSellers = new List<ProductDto>();
                try
                {
                    topSellers = await _context.SaleItems
                        .Include(si => si.Sale)
                        .Include(si => si.Product)
                        .Where(si => si.Sale != null && si.Sale.TenantId == tenantId && si.Sale.InvoiceDate >= fromDate && si.Product != null)
                        .GroupBy(si => new { 
                            si.ProductId, 
                            ProductName = si.Product != null ? si.Product.NameEn : "Unknown", 
                            ProductSku = si.Product != null ? si.Product.Sku : "N/A",
                            UnitType = si.Product != null ? si.Product.UnitType : "KG",
                            CostPrice = si.Product != null ? si.Product.CostPrice : 0,
                            SellPrice = si.Product != null ? si.Product.SellPrice : 0,
                            StockQty = si.Product != null ? si.Product.StockQty : 0,
                            ReorderLevel = si.Product != null ? si.Product.ReorderLevel : 0
                        })
                        .Select(g => new ProductDto
                        {
                            Id = g.Key.ProductId,
                            Sku = g.Key.ProductSku,
                            NameEn = g.Key.ProductName,
                            UnitType = g.Key.UnitType,
                            ConversionToBase = 1,
                            CostPrice = g.Key.CostPrice,
                            SellPrice = g.Key.SellPrice,
                            StockQty = g.Key.StockQty,
                            ReorderLevel = g.Key.ReorderLevel
                        })
                        .Take(5)
                        .ToListAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error fetching top sellers: {Message}", ex.Message);
                }

                // Restock candidates (low stock)
                List<ProductDto> restockCandidates = new List<ProductDto>();
                try
                {
                    restockCandidates = await _context.Products
                        .Where(p => p.TenantId == tenantId && p.StockQty <= p.ReorderLevel)
                        .OrderBy(p => p.StockQty)
                        .Take(5)
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
                            DescriptionEn = p.DescriptionEn,
                            DescriptionAr = p.DescriptionAr
                        })
                        .ToListAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error fetching restock candidates: {Message}", ex.Message);
                }

                // Low margin products
                List<ProductDto> lowMarginProducts = new List<ProductDto>();
                try
                {
                    // AUDIT-6 FIX: Move OrderBy and Take(5) to database query (don't load all products into memory)
                    lowMarginProducts = await _context.Products
                        .Where(p => p.TenantId == tenantId && p.SellPrice > 0 && (p.SellPrice - p.CostPrice) / p.SellPrice < 0.2m)
                        .OrderBy(p => p.SellPrice > 0 ? (p.SellPrice - p.CostPrice) / p.SellPrice : 0)
                        .Take(5)
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
                            DescriptionEn = p.DescriptionEn,
                            DescriptionAr = p.DescriptionAr
                        })
                        .ToListAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error fetching low margin products: {Message}", ex.Message);
                }

                // Pending customers
                List<CustomerDto> pendingCustomers = new List<CustomerDto>();
                try
                {
                    pendingCustomers = await _context.Customers
                        .Where(c => c.TenantId == tenantId && c.Balance > 0)
                        .OrderByDescending(c => c.Balance)
                        .Take(5)
                        .Select(c => new CustomerDto
                        {
                            Id = c.Id,
                            Name = c.Name,
                            Phone = c.Phone,
                            Trn = c.Trn,
                            Address = c.Address,
                            CreditLimit = c.CreditLimit,
                            Balance = c.Balance
                        })
                        .ToListAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error fetching pending customers: {Message}", ex.Message);
                }

                // Promotion candidates
                List<ProductDto> promotionCandidates = new List<ProductDto>();
                try
                {
                    promotionCandidates = await _context.Products
                        .Where(p => p.TenantId == tenantId && p.SellPrice > 0 && (p.SellPrice - p.CostPrice) / p.SellPrice > 0.3m && p.StockQty <= p.ReorderLevel * 2)
                        .OrderByDescending(p => p.SellPrice > 0 ? (p.SellPrice - p.CostPrice) / p.SellPrice : 0)
                        .Take(5)
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
                            DescriptionEn = p.DescriptionEn,
                            DescriptionAr = p.DescriptionAr
                        })
                        .ToListAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error fetching promotion candidates: {Message}", ex.Message);
                }

                return new AISuggestionsDto
                {
                    TopSellers = topSellers,
                    RestockCandidates = restockCandidates,
                    LowMarginProducts = lowMarginProducts,
                    PendingCustomers = pendingCustomers,
                    PromotionCandidates = promotionCandidates
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Critical error in GetAISuggestionsAsync: {Message}", ex.Message);
                // Return empty suggestions instead of crashing
                return new AISuggestionsDto
                {
                    TopSellers = new List<ProductDto>(),
                    RestockCandidates = new List<ProductDto>(),
                    LowMarginProducts = new List<ProductDto>(),
                    PendingCustomers = new List<CustomerDto>(),
                    PromotionCandidates = new List<ProductDto>()
                };
            }
        }

        public async Task<PagedResponse<PendingBillDto>> GetPendingBillsAsync(
            int tenantId,
            DateTime? fromDate = null,
            DateTime? toDate = null,
            int? customerId = null,
            string? search = null,
            string? status = null,
            int page = 1,
            int pageSize = 100)
        {
            // CRITICAL: Single SQL aggregation — filter by balance in database, project to DTO (no load-all in memory)
            // PRODUCTION_MASTER_TODO #33
            // AUDIT-6 FIX: Add pagination to prevent memory exhaustion with many pending bills
            pageSize = Math.Min(pageSize, 100); // Max 100 items per page
            
            var utcNow = DateTime.UtcNow;
            var today = new DateTime(utcNow.Year, utcNow.Month, utcNow.Day, 0, 0, 0, DateTimeKind.Utc);

            var query = from s in _context.Sales
                        join c in _context.Customers on s.CustomerId equals c.Id into cGrp
                        from c in cGrp.DefaultIfEmpty()
                        where !s.IsDeleted
                              && (s.PaymentStatus == SalePaymentStatus.Pending || s.PaymentStatus == SalePaymentStatus.Partial)
                              && (s.GrandTotal - s.PaidAmount) > 0.01m
                        select new { s, c };

            if (tenantId > 0)
                query = query.Where(x => x.s.TenantId == tenantId);

            if (fromDate.HasValue && toDate.HasValue)
            {
                var from = new DateTime(fromDate.Value.Year, fromDate.Value.Month, fromDate.Value.Day, 0, 0, 0, DateTimeKind.Utc);
                var toEnd = toDate.Value.AddDays(1).AddTicks(-1).ToUtcKind();
                query = query.Where(x => x.s.InvoiceDate >= from && x.s.InvoiceDate < toEnd);
            }

            if (customerId.HasValue)
                query = query.Where(x => x.s.CustomerId == customerId.Value);

            if (!string.IsNullOrEmpty(status))
            {
                var statusLower = status.ToLower();
                if (statusLower == "pending")
                    query = query.Where(x => x.s.PaymentStatus == SalePaymentStatus.Pending);
                else if (statusLower == "partial")
                    query = query.Where(x => x.s.PaymentStatus == SalePaymentStatus.Partial);
                else if (statusLower == "overdue")
                {
                    var cutoff = today.AddDays(-30);
                    query = query.Where(x => x.s.InvoiceDate < cutoff && x.s.PaymentStatus != SalePaymentStatus.Paid);
                }
            }

            if (!string.IsNullOrEmpty(search))
                query = query.Where(x => x.s.InvoiceNo.Contains(search) || (x.c != null && x.c.Name.Contains(search)));

            // Get total count before pagination
            var totalCount = await query.CountAsync();

            // Project to DTO in database, then paginate
            // AUDIT-6 FIX: Move sorting to database query before pagination
            var list = await query
                .Select(x => new PendingBillDto
                {
                    Id = x.s.Id,
                    InvoiceNo = x.s.InvoiceNo,
                    InvoiceDate = x.s.InvoiceDate,
                    DueDate = x.s.DueDate ?? x.s.InvoiceDate.AddDays(30),
                    CustomerId = x.s.CustomerId,
                    CustomerName = x.c != null ? x.c.Name : null,
                    GrandTotal = x.s.GrandTotal,
                    PaidAmount = x.s.PaidAmount,
                    BalanceAmount = x.s.GrandTotal - x.s.PaidAmount,
                    PaymentStatus = x.s.PaymentStatus.ToString(),
                    DaysOverdue = 0 // Will be calculated below
                })
                .OrderByDescending(x => x.InvoiceDate) // Sort by date first (simpler for DB)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            // Calculate DaysOverdue in memory (lightweight, already paginated)
            foreach (var dto in list)
            {
                var due = dto.DueDate ?? dto.InvoiceDate.AddDays(30);
                dto.DaysOverdue = due < today ? (today - due).Days : 0;
            }

            // Sort by DaysOverdue then InvoiceDate (in-memory, small dataset)
            list = list
                .OrderByDescending(pb => pb.DaysOverdue)
                .ThenByDescending(pb => pb.InvoiceDate)
                .ToList();

            return new PagedResponse<PendingBillDto>
            {
                Items = list,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling(totalCount / (double)pageSize)
            };
        }

        public async Task<List<ExpenseByCategoryDto>> GetExpensesByCategoryAsync(int tenantId, DateTime fromDate, DateTime toDate, int? branchId = null)
        {
            try
            {
                // CRITICAL: Super admin (TenantId = 0) sees ALL owners
                var baseQuery = from e in _context.Expenses
                               join c in _context.ExpenseCategories on e.CategoryId equals c.Id into categoryGroup
                               from category in categoryGroup.DefaultIfEmpty()
                               where e.Date >= fromDate && e.Date <= toDate
                               select new { e, category };
                
                if (tenantId > 0)
                {
                    baseQuery = baseQuery.Where(x => x.e.TenantId == tenantId);
                }
                if (branchId.HasValue)
                {
                    baseQuery = baseQuery.Where(x => x.e.BranchId == branchId.Value);
                }
                
                var expenses = await (from x in baseQuery
                                     group x by new { 
                                         x.e.CategoryId,
                                         CategoryName = x.category != null ? x.category.Name : "Uncategorized",
                                         CategoryColor = x.category != null ? x.category.ColorCode : "#6B7280"
                                     } into g
                                     select new ExpenseByCategoryDto
                                     {
                                         CategoryId = g.Key.CategoryId,
                                         CategoryName = g.Key.CategoryName,
                                         CategoryColor = g.Key.CategoryColor,
                                         TotalAmount = g.Sum(x => x.e.Amount),
                                         ExpenseCount = g.Count()
                                     })
                                     .OrderByDescending(x => x.TotalAmount)
                                     .ToListAsync();

                return expenses;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in GetExpensesByCategoryAsync: {Message}", ex.Message);
                if (ex.InnerException != null)
                {
                    _logger.LogError(ex.InnerException, "Inner exception: {Message}", ex.InnerException.Message);
                }
                // Return empty list instead of throwing
                return new List<ExpenseByCategoryDto>();
            }
        }

        public async Task<List<SalesVsExpensesDto>> GetSalesVsExpensesAsync(int tenantId, DateTime fromDate, DateTime toDate, string groupBy = "day")
        {
            List<SalesVsExpensesDto> result = new List<SalesVsExpensesDto>();
            // CRITICAL: Super admin (TenantId = 0) sees ALL owners

            if (groupBy == "month")
            {
                // Group by month
                var salesBaseQuery = _context.Sales.Where(s => s.InvoiceDate >= fromDate && s.InvoiceDate < toDate);
                if (tenantId > 0) salesBaseQuery = salesBaseQuery.Where(s => s.TenantId == tenantId);
                var salesData = await salesBaseQuery
                    .GroupBy(s => new { Year = s.InvoiceDate.Year, Month = s.InvoiceDate.Month })
                    .Select(g => new
                    {
                        Period = $"{g.Key.Year}-{g.Key.Month:D2}",
                        Date = new DateTime(g.Key.Year, g.Key.Month, 1, 0, 0, 0, DateTimeKind.Utc),
                        Sales = g.Sum(s => s.GrandTotal)
                    })
                    .ToListAsync();

                var purchasesBaseQuery = _context.Purchases.Where(p => p.PurchaseDate >= fromDate && p.PurchaseDate < toDate);
                if (tenantId > 0) purchasesBaseQuery = purchasesBaseQuery.Where(p => p.TenantId == tenantId);
                var purchasesData = await purchasesBaseQuery
                    .GroupBy(p => new { Year = p.PurchaseDate.Year, Month = p.PurchaseDate.Month })
                    .Select(g => new
                    {
                        Period = $"{g.Key.Year}-{g.Key.Month:D2}",
                        Date = new DateTime(g.Key.Year, g.Key.Month, 1, 0, 0, 0, DateTimeKind.Utc),
                        Purchases = g.Sum(p => p.TotalAmount)
                    })
                    .ToListAsync();

                var expensesBaseQuery = _context.Expenses.Where(e => e.Date >= fromDate && e.Date < toDate);
                if (tenantId > 0) expensesBaseQuery = expensesBaseQuery.Where(e => e.TenantId == tenantId);
                var expensesData = await expensesBaseQuery
                    .GroupBy(e => new { Year = e.Date.Year, Month = e.Date.Month })
                    .Select(g => new
                    {
                        Period = $"{g.Key.Year}-{g.Key.Month:D2}",
                        Date = new DateTime(g.Key.Year, g.Key.Month, 1, 0, 0, 0, DateTimeKind.Utc),
                        Expenses = g.Sum(e => e.Amount)
                    })
                    .ToListAsync();

                var allPeriods = salesData.Select(s => s.Period)
                    .Union(purchasesData.Select(p => p.Period))
                    .Union(expensesData.Select(e => e.Period))
                    .Distinct()
                    .OrderBy(p => p)
                    .ToList();

                foreach (var period in allPeriods)
                {
                    var sale = salesData.FirstOrDefault(s => s.Period == period);
                    var purchase = purchasesData.FirstOrDefault(p => p.Period == period);
                    var expense = expensesData.FirstOrDefault(e => e.Period == period);

                    result.Add(new SalesVsExpensesDto
                    {
                        Period = period,
                        Date = sale?.Date ?? purchase?.Date ?? expense?.Date ?? new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, DateTime.UtcNow.Day, 0, 0, 0, DateTimeKind.Utc), // CRITICAL FIX: Never use .Date
                        Sales = sale?.Sales ?? 0,
                        Purchases = purchase?.Purchases ?? 0,
                        Expenses = expense?.Expenses ?? 0,
                        Profit = (sale?.Sales ?? 0) - (purchase?.Purchases ?? 0) - (expense?.Expenses ?? 0)
                    });
                }
            }
            else
            {
                // PROD-8 FIX: Use server-side aggregation instead of loading all records into memory
                // Group by day - Use database GROUP BY instead of loading all records
                var salesQuery = _context.Sales.Where(s => s.InvoiceDate >= fromDate && s.InvoiceDate < toDate);
                if (tenantId > 0) salesQuery = salesQuery.Where(s => s.TenantId == tenantId);
                
                // Server-side aggregation: Group by date components in database
                var salesData = await salesQuery
                    .GroupBy(s => new { 
                        Year = s.InvoiceDate.Year, 
                        Month = s.InvoiceDate.Month, 
                        Day = s.InvoiceDate.Day 
                    })
                    .Select(g => new
                    {
                        Period = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc).ToString("yyyy-MM-dd"),
                        Date = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc),
                        Sales = g.Sum(s => s.GrandTotal)
                    })
                    .ToListAsync();

                var purchasesQuery = _context.Purchases.Where(p => p.PurchaseDate >= fromDate && p.PurchaseDate < toDate);
                if (tenantId > 0) purchasesQuery = purchasesQuery.Where(p => p.TenantId == tenantId);
                
                // Server-side aggregation for purchases
                var purchasesData = await purchasesQuery
                    .GroupBy(p => new { 
                        Year = p.PurchaseDate.Year, 
                        Month = p.PurchaseDate.Month, 
                        Day = p.PurchaseDate.Day 
                    })
                    .Select(g => new
                    {
                        Period = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc).ToString("yyyy-MM-dd"),
                        Date = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc),
                        Purchases = g.Sum(p => p.TotalAmount)
                    })
                    .ToListAsync();

                var expensesQuery = _context.Expenses.Where(e => e.Date >= fromDate && e.Date < toDate);
                if (tenantId > 0) expensesQuery = expensesQuery.Where(e => e.TenantId == tenantId);
                
                // Server-side aggregation for expenses
                var expensesData = await expensesQuery
                    .GroupBy(e => new { 
                        Year = e.Date.Year, 
                        Month = e.Date.Month, 
                        Day = e.Date.Day 
                    })
                    .Select(g => new
                    {
                        Period = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc).ToString("yyyy-MM-dd"),
                        Date = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc),
                        Expenses = g.Sum(e => e.Amount)
                    })
                    .ToListAsync();

                var allPeriods = salesData.Select(s => s.Period)
                    .Union(purchasesData.Select(p => p.Period))
                    .Union(expensesData.Select(e => e.Period))
                    .Distinct()
                    .OrderBy(p => p)
                    .ToList();

                foreach (var period in allPeriods)
                {
                    var sale = salesData.FirstOrDefault(s => s.Period == period);
                    var purchase = purchasesData.FirstOrDefault(p => p.Period == period);
                    var expense = expensesData.FirstOrDefault(e => e.Period == period);

                    result.Add(new SalesVsExpensesDto
                    {
                        Period = period,
                        Date = sale?.Date ?? purchase?.Date ?? expense?.Date ?? new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, DateTime.UtcNow.Day, 0, 0, 0, DateTimeKind.Utc), // CRITICAL FIX: Never use .Date
                        Sales = sale?.Sales ?? 0,
                        Purchases = purchase?.Purchases ?? 0,
                        Expenses = expense?.Expenses ?? 0,
                        Profit = (sale?.Sales ?? 0) - (purchase?.Purchases ?? 0) - (expense?.Expenses ?? 0)
                    });
                }
            }

            return result;
        }

        // Enhanced Sales Report with Granularity
        public async Task<EnhancedSalesReportDto> GetEnhancedSalesReportAsync(int tenantId, DateTime fromDate, DateTime toDate, string granularity = "day", int? productId = null, int? customerId = null, string? status = null, int page = 1, int pageSize = 50)
        {
            // CRITICAL: Super admin (TenantId = 0) sees ALL owners
            var query = _context.Sales
                .Include(s => s.Items)
                    .ThenInclude(i => i.Product)
                .Include(s => s.Customer)
                .Where(s => !s.IsDeleted && s.InvoiceDate >= fromDate && s.InvoiceDate < toDate)
                .AsQueryable();
            
            if (tenantId > 0)
            {
                query = query.Where(s => s.TenantId == tenantId);
            }

            if (productId.HasValue)
            {
                query = query.Where(s => s.Items.Any(i => i.ProductId == productId.Value));
            }

            if (customerId.HasValue)
            {
                query = query.Where(s => s.CustomerId == customerId.Value);
            }

            if (!string.IsNullOrEmpty(status))
            {
                var statusEnum = Enum.Parse<SalePaymentStatus>(status, true);
                query = query.Where(s => s.PaymentStatus == statusEnum);
            }

            var totalCount = await query.CountAsync();
            var sales = await query
                .OrderByDescending(s => s.InvoiceDate)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            // PROD-8 FIX: Calculate summary using server-side aggregation instead of loading all records
            var summaryQuery = query.Select(s => new
            {
                GrandTotal = s.GrandTotal,
                Subtotal = s.Subtotal,
                VatTotal = s.VatTotal
            });
            
            var summary = new SummaryInfo
            {
                TotalSales = await summaryQuery.SumAsync(s => s.GrandTotal),
                NetSales = await summaryQuery.SumAsync(s => s.Subtotal),
                VatCollected = await summaryQuery.SumAsync(s => s.VatTotal),
                TotalInvoices = totalCount,
                AvgOrderValue = totalCount > 0 ? await summaryQuery.AverageAsync(s => s.GrandTotal) : 0
            };

            // PROD-8 FIX: Generate series using server-side aggregation instead of loading all records
            var series = new List<SalesSeriesDto>();
            if (granularity == "day")
            {
                // Server-side aggregation: Group by date components in database
                var seriesData = await query
                    .GroupBy(s => new { s.InvoiceDate.Year, s.InvoiceDate.Month, s.InvoiceDate.Day })
                    .Select(g => new SalesSeriesDto
                    {
                        Period = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc).ToString("yyyy-MM-dd"),
                        Date = new DateTime(g.Key.Year, g.Key.Month, g.Key.Day, 0, 0, 0, DateTimeKind.Utc),
                        Amount = g.Sum(s => s.GrandTotal),
                        Count = g.Count()
                    })
                    .OrderBy(s => s.Date)
                    .ToListAsync();
                series = seriesData;
            }
            else if (granularity == "week")
            {
                // For week grouping, we need to load dates but aggregate amounts server-side
                var weekGroups = await query
                    .Select(s => new { s.InvoiceDate, s.GrandTotal })
                    .ToListAsync();
                var grouped = weekGroups.GroupBy(s => System.Globalization.CultureInfo.CurrentCulture.Calendar.GetWeekOfYear(s.InvoiceDate, System.Globalization.CalendarWeekRule.FirstDay, DayOfWeek.Sunday));
                series = grouped.Select(g => new SalesSeriesDto
                {
                    Period = $"Week {g.Key}",
                    Date = g.Min(s => s.InvoiceDate),
                    Amount = g.Sum(s => s.GrandTotal),
                    Count = g.Count()
                }).OrderBy(s => s.Date).ToList();
            }
            else if (granularity == "month")
            {
                // Server-side aggregation: Group by month in database
                var seriesData = await query
                    .GroupBy(s => new { s.InvoiceDate.Year, s.InvoiceDate.Month })
                    .Select(g => new SalesSeriesDto
                    {
                        Period = $"{g.Key.Year}-{g.Key.Month:D2}",
                        Date = new DateTime(g.Key.Year, g.Key.Month, 1, 0, 0, 0, DateTimeKind.Utc),
                        Amount = g.Sum(s => s.GrandTotal),
                        Count = g.Count()
                    })
                    .OrderBy(s => s.Date)
                    .ToListAsync();
                series = seriesData;
            }

            // Map sales to report items
            var reportItems = sales.Select(s => new SalesReportItemDto
            {
                InvoiceId = s.Id,
                Date = s.InvoiceDate,
                InvoiceNo = s.InvoiceNo,
                CustomerId = s.CustomerId,
                CustomerName = s.Customer?.Name,
                Items = s.Items.Take(2).Select(i => new ProductSummaryDto
                {
                    ProductId = i.ProductId,
                    ProductName = i.Product?.NameEn ?? "Unknown",
                    Qty = i.Qty,
                    Price = i.UnitPrice
                }).ToList(),
                Qty = s.Items.Sum(i => i.Qty),
                Gross = s.Subtotal,
                Vat = s.VatTotal,
                Discount = s.Discount,
                Net = s.GrandTotal,
                PaymentStatus = s.PaymentStatus.ToString()
            }).ToList();

            return new EnhancedSalesReportDto
            {
                Summary = summary,
                Series = series,
                Data = new PagedResponse<SalesReportItemDto>
                {
                    Items = reportItems,
                    TotalCount = totalCount,
                    Page = page,
                    PageSize = pageSize,
                    TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
                }
            };
        }

        // Enhanced Product Sales Report with Margin Analysis
        public async Task<List<ProductSalesDto>> GetEnhancedProductSalesReportAsync(int tenantId, DateTime fromDate, DateTime toDate, int? productId = null, string? unitType = null, bool lowStockOnly = false)
        {
            var query = from si in _context.SaleItems
                       join s in _context.Sales on si.SaleId equals s.Id
                       join p in _context.Products on si.ProductId equals p.Id
                       where s.TenantId == tenantId && !s.IsDeleted && s.InvoiceDate >= fromDate && s.InvoiceDate < toDate
                       select new { si, s, p };

            if (productId.HasValue)
            {
                query = query.Where(x => x.p.Id == productId.Value);
            }

            if (!string.IsNullOrEmpty(unitType))
            {
                query = query.Where(x => x.p.UnitType == unitType);
            }

            var grouped = await query
                .GroupBy(x => x.p.Id)
                .Select(g => new
                {
                    ProductId = g.Key,
                    Product = g.First().p,
                    TotalQty = g.Sum(x => x.si.Qty),
                    TotalAmount = g.Sum(x => x.si.LineTotal),
                    TotalSales = g.Count(),
                    CostValue = g.Sum(x => x.p.CostPrice * x.si.Qty)
                })
                .ToListAsync();

            var result = grouped.Select(g => new ProductSalesDto
            {
                ProductId = g.ProductId,
                ProductName = g.Product.NameEn ?? "Unknown",
                Sku = g.Product.Sku ?? "N/A",
                UnitType = g.Product.UnitType.ToString(),
                TotalQty = g.TotalQty,
                TotalAmount = g.TotalAmount,
                CostValue = g.CostValue,
                GrossProfit = g.TotalAmount - g.CostValue,
                MarginPercent = g.TotalAmount > 0 ? ((g.TotalAmount - g.CostValue) / g.TotalAmount) * 100 : 0,
                TotalSales = g.TotalSales,
                StockOnHand = g.Product.StockQty,
                ReorderLevel = g.Product.ReorderLevel,
                IsLowStock = g.Product.StockQty <= g.Product.ReorderLevel
            })
            .OrderByDescending(p => p.TotalAmount)
            .ToList();

            if (lowStockOnly)
            {
                result = result.Where(p => p.IsLowStock).ToList();
            }

            return result;
        }

        // Customer Report with Outstanding Analysis
        public async Task<CustomerReportDto> GetCustomerReportAsync(int tenantId, DateTime fromDate, DateTime toDate, decimal? minOutstanding = null)
        {
            var customers = await _context.Customers
                .Where(c => c.TenantId == tenantId)
                .ToListAsync();
            var customerReports = new List<CustomerReportItemDto>();

            foreach (var customer in customers)
            {
                var sales = await _context.Sales
                    .Where(s => !s.IsDeleted && s.CustomerId == customer.Id && s.InvoiceDate >= fromDate && s.InvoiceDate < toDate)
                    .ToListAsync();

                var payments = await _context.Payments
                    .Where(p => p.CustomerId == customer.Id && p.PaymentDate >= fromDate && p.PaymentDate <= toDate)
                    .ToListAsync();

                var totalSales = sales.Sum(s => s.GrandTotal);
                var totalPayments = payments.Sum(p => p.Amount);
                var outstanding = customer.Balance; // Use calculated balance

                // Calculate avg days to pay
                var paidInvoices = sales.Where(s => s.PaymentStatus == SalePaymentStatus.Paid).ToList();
                var avgDaysToPay = 0m;
                if (paidInvoices.Any())
                {
                    var daysList = new List<int>();
                    foreach (var inv in paidInvoices)
                    {
                        var firstPayment = payments.Where(p => p.SaleId == inv.Id).OrderBy(p => p.PaymentDate).FirstOrDefault();
                        if (firstPayment != null)
                        {
                            // CRITICAL FIX: TimeSpan subtraction, not .Date property
                            daysList.Add((firstPayment.PaymentDate - inv.InvoiceDate).Days);
                        }
                    }
                    if (daysList.Any())
                    {
                        avgDaysToPay = (decimal)daysList.Average();
                    }
                }

                var lastPayment = payments.OrderByDescending(p => p.PaymentDate).FirstOrDefault();

                if (minOutstanding == null || outstanding >= minOutstanding.Value)
                {
                    customerReports.Add(new CustomerReportItemDto
                    {
                        CustomerId = customer.Id,
                        CustomerName = customer.Name ?? "Unknown",
                        Trn = customer.Trn,
                        TotalSales = totalSales,
                        TotalPayments = totalPayments,
                        Outstanding = outstanding,
                        AvgDaysToPay = avgDaysToPay,
                        LastPaymentDate = lastPayment?.PaymentDate,
                        LastPaymentMode = lastPayment?.Mode.ToString()
                    });
                }
            }

            var summary = new CustomerReportSummary
            {
                TotalCustomers = customerReports.Count,
                TotalSales = customerReports.Sum(c => c.TotalSales),
                TotalPayments = customerReports.Sum(c => c.TotalPayments),
                TotalOutstanding = customerReports.Sum(c => c.Outstanding),
                AvgDaysToPay = customerReports.Any() ? customerReports.Average(c => c.AvgDaysToPay) : 0
            };

            return new CustomerReportDto
            {
                Customers = customerReports.OrderByDescending(c => c.Outstanding).ToList(),
                Summary = summary
            };
        }

        // Aging Report with Buckets
        public async Task<AgingReportDto> GetAgingReportAsync(int tenantId, DateTime asOfDate, int? customerId = null)
        {
            var salesQuery = _context.Sales
                .Include(s => s.Customer)
                .Where(s => s.TenantId == tenantId && !s.IsDeleted && s.PaymentStatus != SalePaymentStatus.Paid)
                .AsQueryable();

            if (customerId.HasValue)
            {
                salesQuery = salesQuery.Where(s => s.CustomerId == customerId.Value);
            }

            var sales = await salesQuery.ToListAsync();
            var invoices = new List<AgingInvoiceDto>();

            // PRODUCTION_MASTER_TODO #9: Use remaining balance (GrandTotal - PaidAmount), not total. PaidAmount = cleared only.
            foreach (var sale in sales)
            {
                var paidAmount = sale.PaidAmount; // CLEARED-only, matches customer balance and invoice status
                var balance = sale.GrandTotal - paidAmount;
                if (balance <= 0.01m) continue;

                // CRITICAL FIX: TimeSpan subtraction, not .Date property
                var daysOverdue = (asOfDate - sale.InvoiceDate).Days;
                string bucket;
                if (daysOverdue <= 30) bucket = "0-30";
                else if (daysOverdue <= 60) bucket = "31-60";
                else if (daysOverdue <= 90) bucket = "61-90";
                else bucket = "90+";

                invoices.Add(new AgingInvoiceDto
                {
                    Id = sale.Id,
                    InvoiceNo = sale.InvoiceNo,
                    InvoiceDate = sale.InvoiceDate,
                    CustomerId = sale.CustomerId,
                    CustomerName = sale.Customer?.Name,
                    GrandTotal = sale.GrandTotal,
                    PaidAmount = paidAmount,
                    BalanceAmount = balance,
                    DaysOverdue = daysOverdue,
                    AgingBucket = bucket
                });
            }

            var bucket0_30 = new AgingBucket
            {
                Invoices = invoices.Where(i => i.AgingBucket == "0-30").ToList(),
                Total = invoices.Where(i => i.AgingBucket == "0-30").Sum(i => i.BalanceAmount),
                Count = invoices.Count(i => i.AgingBucket == "0-30")
            };

            var bucket31_60 = new AgingBucket
            {
                Invoices = invoices.Where(i => i.AgingBucket == "31-60").ToList(),
                Total = invoices.Where(i => i.AgingBucket == "31-60").Sum(i => i.BalanceAmount),
                Count = invoices.Count(i => i.AgingBucket == "31-60")
            };

            var bucket61_90 = new AgingBucket
            {
                Invoices = invoices.Where(i => i.AgingBucket == "61-90").ToList(),
                Total = invoices.Where(i => i.AgingBucket == "61-90").Sum(i => i.BalanceAmount),
                Count = invoices.Count(i => i.AgingBucket == "61-90")
            };

            var bucket90Plus = new AgingBucket
            {
                Invoices = invoices.Where(i => i.AgingBucket == "90+").ToList(),
                Total = invoices.Where(i => i.AgingBucket == "90+").Sum(i => i.BalanceAmount),
                Count = invoices.Count(i => i.AgingBucket == "90+")
            };

            return new AgingReportDto
            {
                Bucket0_30 = bucket0_30,
                Bucket31_60 = bucket31_60,
                Bucket61_90 = bucket61_90,
                Bucket90Plus = bucket90Plus,
                TotalOutstanding = invoices.Sum(i => i.BalanceAmount),
                Invoices = invoices.OrderByDescending(i => i.DaysOverdue).ToList()
            };
        }

        // Stock Report with Restock Alerts
        public async Task<StockReportDto> GetStockReportAsync(int tenantId, bool lowOnly = false)
        {
            var productsQuery = _context.Products
                .Where(p => p.TenantId == tenantId)
                .AsQueryable();

            if (lowOnly)
            {
                productsQuery = productsQuery.Where(p => p.StockQty <= p.ReorderLevel);
            }

            var products = await productsQuery.ToListAsync();

            // Get reserved quantities (pending sales)
            var reservedByProduct = await _context.SaleItems
                .Include(si => si.Sale)
                .Where(si => !si.Sale.IsDeleted && si.Sale.PaymentStatus == SalePaymentStatus.Pending)
                .GroupBy(si => si.ProductId)
                .Select(g => new { ProductId = g.Key, Reserved = g.Sum(si => si.Qty) })
                .ToListAsync();

            var stockItems = products.Select(p =>
            {
                var reserved = reservedByProduct.FirstOrDefault(r => r.ProductId == p.Id)?.Reserved ?? 0;
                var available = p.StockQty - reserved;

                // Calculate predicted days to stockout (based on 30-day avg sales)
                // CRITICAL FIX: Never use .Date property, it creates Unspecified
                var utcNow = DateTime.UtcNow;
                var last30Days = new DateTime(utcNow.Year, utcNow.Month, utcNow.Day, 0, 0, 0, DateTimeKind.Utc).AddDays(-30);
                var avgDailySales = _context.SaleItems
                    .Include(si => si.Sale)
                    .Where(si => si.ProductId == p.Id && !si.Sale.IsDeleted && si.Sale.InvoiceDate >= last30Days)
                    .Sum(si => (decimal?)si.Qty) ?? 0;
                avgDailySales = avgDailySales / 30;
                var predictedDays = avgDailySales > 0 && available > 0 ? (int)(available / avgDailySales) : (int?)null;

                return new StockItemDto
                {
                    ProductId = p.Id,
                    ProductName = p.NameEn ?? "Unknown",
                    Sku = p.Sku ?? "N/A",
                    UnitType = p.UnitType.ToString(),
                    OnHand = p.StockQty,
                    Reserved = reserved,
                    Available = available,
                    ReorderLevel = p.ReorderLevel,
                    SafetyStock = p.ReorderLevel,
                    LastPurchaseDate = _context.Purchases
                        .Include(pi => pi.Items)
                        .Where(pi => pi.Items.Any(pi => pi.ProductId == p.Id))
                        .OrderByDescending(pi => pi.PurchaseDate)
                        .Select(pi => (DateTime?)pi.PurchaseDate)
                        .FirstOrDefault(),
                    IsLowStock = available <= p.ReorderLevel,
                    PredictedDaysToStockOut = predictedDays
                };
            }).ToList();

            var summary = new StockSummary
            {
                TotalSKUs = products.Count,
                LowStockCount = stockItems.Count(i => i.IsLowStock),
                OutOfStockCount = stockItems.Count(i => i.Available <= 0),
                StockValue = products.Sum(p => p.StockQty * p.CostPrice)
            };

            return new StockReportDto
            {
                Summary = summary,
                Items = stockItems.OrderByDescending(i => i.IsLowStock).ThenBy(i => i.Available).ToList()
            };
        }

        /// <summary>Raw SQL to load returns for ledger when SaleReturns.BranchId may not exist. Selects Id, ReturnDate, ReturnNo, CustomerId, GrandTotal, VatTotal.</summary>
        private async Task<List<(int Id, DateTime ReturnDate, string? ReturnNo, int? CustomerId, decimal GrandTotal, decimal VatTotal)>> GetSalesLedgerReturnsRawAsync(int tenantId, DateTime from, DateTime to, int? staffId)
        {
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                string sql = @"SELECT ""Id"", ""ReturnDate"", ""ReturnNo"", ""CustomerId"", ""GrandTotal"", COALESCE(""VatTotal"", 0) FROM ""SaleReturns"" WHERE ""TenantId"" = @p0 AND ""ReturnDate"" >= @p1 AND ""ReturnDate"" < @p2";
                if (staffId.HasValue) sql += " AND \"CreatedBy\" = @p3";
                sql += " ORDER BY \"ReturnDate\", \"Id\"";
                using var cmd = conn.CreateCommand();
                cmd.CommandText = sql;
                var p0 = cmd.CreateParameter(); p0.ParameterName = "p0"; p0.Value = tenantId; cmd.Parameters.Add(p0);
                var p1 = cmd.CreateParameter(); p1.ParameterName = "p1"; p1.Value = from; cmd.Parameters.Add(p1);
                var p2 = cmd.CreateParameter(); p2.ParameterName = "p2"; p2.Value = to; cmd.Parameters.Add(p2);
                if (staffId.HasValue) { var p3 = cmd.CreateParameter(); p3.ParameterName = "p3"; p3.Value = staffId.Value; cmd.Parameters.Add(p3); }
                var list = new List<(int Id, DateTime ReturnDate, string? ReturnNo, int? CustomerId, decimal GrandTotal, decimal VatTotal)>();
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        list.Add((
                            reader.GetInt32(0),
                            reader.GetDateTime(1),
                            reader.IsDBNull(2) ? null : reader.GetString(2),
                            reader.IsDBNull(3) ? (int?)null : reader.GetInt32(3),
                            reader.GetDecimal(4),
                            reader.IsDBNull(5) ? 0m : reader.GetDecimal(5)));
                    }
                }
                return list;
            }
            finally { if (!wasOpen) await conn.CloseAsync(); }
        }

        /// <summary>Raw SQL to load sales for ledger when Sales.BranchId may not exist. Selects Id, InvoiceNo, InvoiceDate, CustomerId, GrandTotal, Subtotal, VatTotal.</summary>
        private async Task<List<(int Id, string InvoiceNo, DateTime InvoiceDate, int? CustomerId, decimal GrandTotal, decimal Subtotal, decimal VatTotal)>> GetSalesLedgerSalesRawAsync(int tenantId, DateTime from, DateTime to, int? staffId)
        {
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                string sql = @"SELECT ""Id"", ""InvoiceNo"", ""InvoiceDate"", ""CustomerId"", ""GrandTotal"", COALESCE(""Subtotal"", 0), COALESCE(""VatTotal"", 0) FROM ""Sales"" WHERE ""TenantId"" = @p0 AND ""IsDeleted"" = false AND ""InvoiceDate"" >= @p1 AND ""InvoiceDate"" < @p2";
                if (staffId.HasValue) sql += " AND \"CreatedBy\" = @p3";
                sql += " ORDER BY \"InvoiceDate\", \"Id\"";
                using var cmd = conn.CreateCommand();
                cmd.CommandText = sql;
                var p0 = cmd.CreateParameter(); p0.ParameterName = "p0"; p0.Value = tenantId; cmd.Parameters.Add(p0);
                var p1 = cmd.CreateParameter(); p1.ParameterName = "p1"; p1.Value = from; cmd.Parameters.Add(p1);
                var p2 = cmd.CreateParameter(); p2.ParameterName = "p2"; p2.Value = to; cmd.Parameters.Add(p2);
                if (staffId.HasValue) { var p3 = cmd.CreateParameter(); p3.ParameterName = "p3"; p3.Value = staffId.Value; cmd.Parameters.Add(p3); }
                var list = new List<(int Id, string InvoiceNo, DateTime InvoiceDate, int? CustomerId, decimal GrandTotal, decimal Subtotal, decimal VatTotal)>();
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        var customerId = reader.IsDBNull(3) ? (int?)null : reader.GetInt32(3);
                        list.Add((reader.GetInt32(0), reader.IsDBNull(1) ? "" : reader.GetString(1), reader.GetDateTime(2), customerId, reader.GetDecimal(4), reader.IsDBNull(5) ? 0m : reader.GetDecimal(5), reader.IsDBNull(6) ? 0m : reader.GetDecimal(6)));
                    }
                }
                return list;
            }
            finally { if (!wasOpen) await conn.CloseAsync(); }
        }

        public async Task<SalesLedgerReportDto> GetComprehensiveSalesLedgerAsync(int tenantId, DateTime? fromDate = null, DateTime? toDate = null, int? branchId = null, int? routeId = null, int? staffId = null, int? userIdForStaff = null, string? roleForStaff = null)
        {
            var from = (fromDate ?? DateTime.UtcNow.Date.AddDays(-365)).ToUtcKind();
            var to = (toDate ?? DateTime.UtcNow.Date).AddDays(1).AddTicks(-1).ToUtcKind();
            // PRODUCTION FIX: On PostgreSQL use raw SQL for sales list so we never reference BranchId (column may not exist).
            List<(int Id, string InvoiceNo, DateTime InvoiceDate, int? CustomerId, decimal GrandTotal, decimal Subtotal, decimal VatTotal)> sales;
            if (_context.Database.IsNpgsql())
            {
                sales = await GetSalesLedgerSalesRawAsync(tenantId, from, to, staffId);
            }
            else
            {
                var salesQuery = _context.Sales
                    .Where(s => s.TenantId == tenantId && !s.IsDeleted && s.InvoiceDate >= from && s.InvoiceDate < to);
                if (staffId.HasValue) salesQuery = salesQuery.Where(s => s.CreatedBy == staffId.Value);
                var projected = await salesQuery
                    .OrderBy(s => s.InvoiceDate)
                    .ThenBy(s => s.Id)
                    .Select(s => new { s.Id, s.InvoiceNo, s.InvoiceDate, s.CustomerId, s.GrandTotal, s.Subtotal, s.VatTotal })
                    .ToListAsync();
                sales = projected.Select(x => (x.Id, x.InvoiceNo, x.InvoiceDate, x.CustomerId, x.GrandTotal, x.Subtotal, x.VatTotal)).ToList();
            }

            var saleIds = sales.Select(s => s.Id).ToHashSet();

            // Get payments within date range (exclude refund payments - they are Type "Refund" and reduce balance differently)
            var paymentsQuery = _context.Payments
                .Where(p => p.TenantId == tenantId && p.SaleReturnId == null && p.PaymentDate >= from && p.PaymentDate <= to);
            if (branchId.HasValue || routeId.HasValue || staffId.HasValue)
                paymentsQuery = paymentsQuery.Where(p => !p.SaleId.HasValue || saleIds.Contains(p.SaleId.Value));
            var payments = await paymentsQuery
                .OrderBy(p => p.PaymentDate)
                .ThenBy(p => p.Id)
                .ToListAsync();

            // Get returns in same date range. On PostgreSQL use raw SQL so we never select BranchId/RouteId (columns may not exist).
            List<(int Id, DateTime ReturnDate, string? ReturnNo, int? CustomerId, decimal GrandTotal, decimal VatTotal)> returns;
            if (_context.Database.IsNpgsql())
            {
                returns = await GetSalesLedgerReturnsRawAsync(tenantId, from, to, staffId);
            }
            else
            {
                var returnsQuery = _context.SaleReturns
                    .Where(r => r.TenantId == tenantId && r.ReturnDate >= from && r.ReturnDate < to);
                if (staffId.HasValue) returnsQuery = returnsQuery.Where(r => r.CreatedBy == staffId.Value);
                var projected = await returnsQuery
                    .OrderBy(r => r.ReturnDate).ThenBy(r => r.Id)
                    .Select(r => new { r.Id, r.ReturnDate, r.ReturnNo, r.CustomerId, r.GrandTotal, r.VatTotal })
                    .ToListAsync();
                returns = projected.Select(x => (x.Id, x.ReturnDate, (string?)x.ReturnNo, x.CustomerId, x.GrandTotal, x.VatTotal)).ToList();
            }

            // Get payment totals per sale for status calculation (exclude refunds)
            var salePayments = await _context.Payments
                .Where(p => p.TenantId == tenantId && p.SaleId.HasValue && p.SaleReturnId == null)
                .GroupBy(p => p.SaleId!.Value)
                .Select(g => new { SaleId = g.Key, TotalPaid = g.Sum(p => p.Amount) })
                .ToDictionaryAsync(x => x.SaleId, x => x.TotalPaid);

            // Load all customers in one query for efficiency (include return customers)
            var customerIds = sales.Select(s => s.CustomerId).Concat(payments.Select(p => p.CustomerId)).Concat(returns.Select(r => r.CustomerId))
                .Where(id => id.HasValue)
                .Distinct()
                .ToList();
            var customers = await _context.Customers
                .Where(c => c.TenantId == tenantId && customerIds.Contains(c.Id))
                .ToDictionaryAsync(c => c.Id, c => c.Name);

            // Build ledger entries
            var ledgerEntries = new List<SalesLedgerEntryDto>();
            
            // Track per-customer balances (not global)
            // Use 0 as key for null customer IDs
            var customerBalances = new Dictionary<int, decimal>();

            // Add sales entries (Debit)
            foreach (var sale in sales)
            {
                var paidAmount = salePayments.GetValueOrDefault(sale.Id, 0m);
                var balance = sale.GrandTotal - paidAmount;
                
                // Determine status
                string status = "Unpaid";
                if (balance <= 0.01m)
                {
                    status = "Paid";
                }
                else if (paidAmount > 0)
                {
                    status = "Partial";
                }

                // Calculate Plan Date (Due Date = Invoice Date + 30 days)
                var planDate = sale.InvoiceDate.AddDays(30);

                // Update customer balance
                var customerKey = sale.CustomerId ?? 0;
                if (!customerBalances.ContainsKey(customerKey))
                {
                    customerBalances[customerKey] = 0m;
                }
                customerBalances[customerKey] += sale.GrandTotal; // Add debit

                // Payment mode: Show "NOT PAID" if unpaid, otherwise show payment mode from related payments
                string paymentModeDisplay = "NOT PAID";
                if (status == "Paid" || status == "Partial")
                {
                    // Get payment mode from first payment for this sale
                    var firstPayment = payments.FirstOrDefault(p => p.SaleId == sale.Id);
                    if (firstPayment != null)
                    {
                        paymentModeDisplay = firstPayment.Mode.ToString().ToUpper();
                    }
                    else if (status == "Paid")
                    {
                        paymentModeDisplay = "PAID";
                    }
                }

                // Calculate real pending (GrandTotal - PaidAmount)
                var realPending = sale.GrandTotal - paidAmount;
                
                ledgerEntries.Add(new SalesLedgerEntryDto
                {
                    Date = sale.InvoiceDate,
                    Type = "Sale",
                    InvoiceNo = sale.InvoiceNo,
                    CustomerId = sale.CustomerId,
                    CustomerName = sale.CustomerId.HasValue && customers.ContainsKey(sale.CustomerId.Value)
                        ? customers[sale.CustomerId.Value]
                        : "Cash Customer",
                    PaymentMode = paymentModeDisplay,
                    GrandTotal = sale.GrandTotal, // CRITICAL: Full invoice amount
                    PaidAmount = paidAmount, // CRITICAL: Amount already paid for this invoice
                    RealPending = realPending > 0 ? realPending : 0,
                    RealGotPayment = paidAmount, // CRITICAL: Show actual paid amount for sales (not 0)
                    Status = status,
                    CustomerBalance = customerBalances[customerKey],
                    PlanDate = planDate,
                    SaleId = sale.Id,
                    Subtotal = sale.Subtotal,
                    VatTotal = sale.VatTotal
                });
            }

            // Add payment entries (Credit)
            foreach (var payment in payments)
            {
                var found = payment.SaleId.HasValue ? sales.FirstOrDefault(s => s.Id == payment.SaleId.Value) : default;
                bool hasRelatedSale = found.Id != 0 && payment.SaleId.HasValue && found.Id == payment.SaleId.Value;

                var invoiceNo = hasRelatedSale ? found.InvoiceNo : (payment.Reference ?? "-");
                var paidAmount = salePayments.GetValueOrDefault(hasRelatedSale ? found.Id : 0, 0m);
                var saleBalance = hasRelatedSale ? found.GrandTotal - paidAmount : 0m;
                
                string status = "Partial";
                if (hasRelatedSale)
                {
                    if (saleBalance <= 0.01m) status = "Paid";
                    else if (paidAmount > 0) status = "Partial";
                    else status = "Unpaid";
                }

                // Update customer balance
                var paymentCustomerKey = payment.CustomerId ?? 0;
                if (!customerBalances.ContainsKey(paymentCustomerKey))
                {
                    customerBalances[paymentCustomerKey] = 0m;
                }
                customerBalances[paymentCustomerKey] -= payment.Amount; // Subtract credit

                ledgerEntries.Add(new SalesLedgerEntryDto
                {
                    Date = payment.PaymentDate,
                    Type = "Payment",
                    InvoiceNo = invoiceNo,
                    CustomerId = payment.CustomerId,
                    CustomerName = payment.CustomerId.HasValue && customers.ContainsKey(payment.CustomerId.Value)
                        ? customers[payment.CustomerId.Value]
                        : "Cash Customer",
                    PaymentMode = payment.Mode.ToString().ToUpper(),
                    GrandTotal = payment.Amount, // CRITICAL: Payment amount
                    PaidAmount = 0, // Payments don't have paidAmount (they ARE the payment)
                    RealPending = 0, // Payments don't have pending
                    RealGotPayment = payment.Amount, // Real payment received
                    Status = status,
                    CustomerBalance = customerBalances[paymentCustomerKey],
                    PlanDate = null, // Payments don't have plan dates
                    PaymentId = payment.Id,
                    SaleId = payment.SaleId,
                    Subtotal = 0,
                    VatTotal = 0
                });
            }

            // Add return entries (Credit - reduces customer balance)
            foreach (var ret in returns)
            {
                var customerKey = ret.CustomerId ?? 0;
                if (!customerBalances.ContainsKey(customerKey))
                {
                    customerBalances[customerKey] = 0m;
                }
                customerBalances[customerKey] -= ret.GrandTotal;

                ledgerEntries.Add(new SalesLedgerEntryDto
                {
                    Date = ret.ReturnDate,
                    Type = "Return",
                    InvoiceNo = ret.ReturnNo ?? "-",
                    CustomerId = ret.CustomerId,
                    CustomerName = ret.CustomerId.HasValue && customers.ContainsKey(ret.CustomerId.Value)
                        ? customers[ret.CustomerId.Value]
                        : "Cash Customer",
                    PaymentMode = "",
                    GrandTotal = ret.GrandTotal,
                    PaidAmount = 0,
                    RealPending = 0,
                    RealGotPayment = ret.GrandTotal,
                    Status = "Returned",
                    CustomerBalance = customerBalances[customerKey],
                    PlanDate = null,
                    ReturnId = ret.Id,
                    Subtotal = 0,
                    VatTotal = ret.VatTotal
                });
            }

            // Sort by date, then by type (Sale=0, Return=1, Payment=2)
            ledgerEntries = ledgerEntries
                .OrderBy(e => e.Date)
                .ThenBy(e => e.Type == "Sale" ? 0 : e.Type == "Return" ? 1 : 2)
                .ToList();

            // Calculate summary totals - CORRECTED CALCULATIONS
            // 1. Total Sales = Sum of GrandTotal from all sales in date range
            var totalSales = sales.Sum(s => s.GrandTotal);
            
            // 2. Total Payments = Sum of payments linked to sales in this period ONLY
            // CRITICAL: Only count payments that are linked to sales in the date range
            // This ensures: Total Payments <= Total Sales (logically correct)
            // We use salePayments dictionary which already has the correct totals per sale
            var saleIdsInPeriod = sales.Select(s => s.Id).ToHashSet();
            var totalPayments = salePayments
                .Where(kvp => saleIdsInPeriod.Contains(kvp.Key))
                .Sum(kvp => kvp.Value);
            
            // Alternative: Sum from payments directly (for verification)
            var totalPaymentsFromPayments = payments
                .Where(p => p.SaleId.HasValue && saleIdsInPeriod.Contains(p.SaleId.Value))
                .Sum(p => p.Amount);
            
            // Use the higher value to ensure accuracy (should be same, but handle edge cases)
            totalPayments = Math.Max(totalPayments, totalPaymentsFromPayments);
            
            // CRITICAL: Ensure payments never exceed sales (logically impossible)
            totalPayments = Math.Min(totalPayments, totalSales);
            
            // 3. Real Pending = Sum of unpaid amounts (GrandTotal - PaidAmount) from sales only
            var totalRealPending = ledgerEntries
                .Where(e => e.Type == "Sale")
                .Sum(e => e.RealPending);
            
            // 4. Total Real Got Payment = Total Payments (same value, different name)
            var totalRealGotPayment = totalPayments;
            
            // 5. Total Returns and Net Sales (ERP)
            var totalReturns = returns.Sum(r => r.GrandTotal);
            var netSales = totalSales - totalReturns;

            // Refunds paid (money out) in period - so balance = Sales - Payments - Returns + RefundsPaid
            var refundsPaid = await _context.Payments
                .Where(p => p.TenantId == tenantId && p.SaleReturnId != null && p.PaymentDate >= from && p.PaymentDate <= to)
                .SumAsync(p => (decimal?)p.Amount) ?? 0m;

            // 6. Pending Balance = Total Sales - Total Payments - Total Returns + RefundsPaid (never treat returns as unpaid)
            var pendingBalance = totalSales - totalPayments - totalReturns + refundsPaid;
            var netCashIn = totalPayments - refundsPaid;

            return new SalesLedgerReportDto
            {
                Entries = ledgerEntries,
                Summary = new SalesLedgerSummary
                {
                    TotalDebit = totalRealPending,
                    TotalCredit = totalRealGotPayment,
                    OutstandingBalance = pendingBalance,
                    TotalSales = totalSales,
                    TotalPayments = totalPayments,
                    TotalReturns = totalReturns,
                    NetSales = netSales,
                    RefundsPaid = refundsPaid,
                    NetCashIn = netCashIn,
                    TotalSalesVat = sales.Sum(s => s.VatTotal),
                    TotalReturnsVat = returns.Sum(r => r.VatTotal),
                    TotalVat = sales.Sum(s => s.VatTotal) - returns.Sum(r => r.VatTotal)
                }
            };
        }

        public async Task<List<StaffPerformanceDto>> GetStaffPerformanceAsync(int tenantId, DateTime fromDate, DateTime toDate, int? routeId = null) // FIX: Add route filter parameter
        {
            var from = fromDate.ToUtcKind();
            var to = toDate.AddDays(1).AddTicks(-1).ToUtcKind();

            if (!await _salesSchema.SalesHasBranchIdAndRouteIdAsync())
                return new List<StaffPerformanceDto>();

            // PROD-7 FIX: Batch all queries to avoid N+1 problem
            // Load all staff users in one query
            var staffUsers = await _context.Users
                .Where(u => u.TenantId == tenantId && u.Role == UserRole.Staff)
                .Select(u => new { u.Id, u.Name })
                .ToListAsync();

            if (!staffUsers.Any())
                return new List<StaffPerformanceDto>();

            var staffIds = staffUsers.Select(s => s.Id).ToList();

            // Batch load all RouteStaff relationships in one query
            var allRouteStaff = await _context.RouteStaff
                .Where(rs => staffIds.Contains(rs.UserId))
                .Select(rs => new { rs.UserId, rs.RouteId })
                .ToListAsync();

            // Batch load all Routes assigned to staff in one query
            var allAssignedRoutes = await _context.Routes
                .Where(r => r.TenantId == tenantId && r.AssignedStaffId != null && staffIds.Contains(r.AssignedStaffId.Value))
                .Select(r => new { r.Id, r.AssignedStaffId, r.Name })
                .ToListAsync();

            // Get all route IDs that any staff member is assigned to
            var allRouteIds = allRouteStaff.Select(rs => rs.RouteId)
                .Union(allAssignedRoutes.Select(r => r.Id))
                .Distinct()
                .ToList();

            // Batch load all route names in one query
            var routeNamesDict = await _context.Routes
                .Where(r => allRouteIds.Contains(r.Id))
                .Select(r => new { r.Id, r.Name })
                .ToDictionaryAsync(r => r.Id, r => r.Name);

            // Batch load all sales for all staff in one query
            var allSalesQuery = _context.Sales
                .Where(s => s.TenantId == tenantId && !s.IsDeleted 
                    && staffIds.Contains(s.CreatedBy)
                    && s.InvoiceDate >= from && s.InvoiceDate < to);
            
            if (routeId.HasValue)
                allSalesQuery = allSalesQuery.Where(s => s.RouteId == routeId.Value);

            var allSales = await allSalesQuery.ToListAsync();

            // Group sales by staff member
            var salesByStaff = allSales.GroupBy(s => s.CreatedBy).ToDictionary(g => g.Key, g => g.ToList());

            var result = new List<StaffPerformanceDto>();

            // Process each staff member using in-memory data
            foreach (var staff in staffUsers)
            {
                // Get route IDs for this staff member from batch-loaded data
                var routeIdsFromRouteStaff = allRouteStaff
                    .Where(rs => rs.UserId == staff.Id)
                    .Select(rs => rs.RouteId)
                    .ToList();
                
                var routeIdsFromAssigned = allAssignedRoutes
                    .Where(r => r.AssignedStaffId == staff.Id)
                    .Select(r => r.Id)
                    .ToList();
                
                var allRouteIdsForStaff = routeIdsFromRouteStaff.Union(routeIdsFromAssigned).Distinct().ToList();

                // Get route names from batch-loaded dictionary
                var routeNames = allRouteIdsForStaff
                    .Where(id => routeNamesDict.ContainsKey(id))
                    .Select(id => routeNamesDict[id])
                    .ToList();
                
                var assignedRoutes = routeNames.Any() ? string.Join(", ", routeNames) : "-";

                // Get sales for this staff member, filtered by assigned routes
                var staffSales = salesByStaff.ContainsKey(staff.Id) 
                    ? salesByStaff[staff.Id] 
                    : new List<Sale>();

                // Filter sales by assigned routes if staff has routes
                if (allRouteIdsForStaff.Any())
                {
                    staffSales = staffSales
                        .Where(s => s.RouteId != null && allRouteIdsForStaff.Contains(s.RouteId.Value))
                        .ToList();
                }
                else
                {
                    // Staff with no routes assigned should show 0 performance
                    staffSales = new List<Sale>();
                }

                var invoicesCreated = staffSales.Count;
                var totalBilled = staffSales.Sum(s => s.GrandTotal);
                var cashCollected = staffSales.Sum(s => s.PaidAmount);
                var collectionRate = totalBilled > 0 ? (double)(cashCollected / totalBilled * 100) : 0;

                var avgDaysToPay = 0.0;
                var paidSales = staffSales.Where(s => s.PaidAmount > 0 && s.LastPaymentDate.HasValue).ToList();
                if (paidSales.Any())
                {
                    avgDaysToPay = paidSales.Average(s => (s.LastPaymentDate!.Value - s.InvoiceDate).TotalDays);
                }

                result.Add(new StaffPerformanceDto
                {
                    UserId = staff.Id,
                    UserName = staff.Name ?? "Unknown",
                    AssignedRoutes = assignedRoutes,
                    InvoicesCreated = invoicesCreated,
                    TotalBilled = totalBilled,
                    CashCollected = cashCollected,
                    CollectionRatePercent = (decimal)Math.Round(collectionRate, 1),
                    AvgDaysToPay = Math.Round(avgDaysToPay, 1)
                });
            }

            return result.OrderByDescending(r => r.TotalBilled).ToList();
        }
    }

    public class ProductSalesDto
    {
        public int ProductId { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public string Sku { get; set; } = string.Empty;
        public string UnitType { get; set; } = string.Empty;
        public decimal TotalQty { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal? CostValue { get; set; }
        public decimal? GrossProfit { get; set; }
        public decimal? MarginPercent { get; set; }
        public int TotalSales { get; set; }
        public decimal StockOnHand { get; set; }
        public decimal ReorderLevel { get; set; }
        public bool IsLowStock { get; set; }
    }
}

