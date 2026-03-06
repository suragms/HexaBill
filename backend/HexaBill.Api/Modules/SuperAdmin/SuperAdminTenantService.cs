/*
Purpose: Super Admin Tenant Management Service
Author: AI Assistant
Date: 2026-02-11
*/
using System.Globalization;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;
using HexaBill.Api.Modules.Subscription;
using Npgsql;

namespace HexaBill.Api.Modules.SuperAdmin
{
    public interface ISuperAdminTenantService
    {
        Task<PlatformDashboardDto> GetPlatformDashboardAsync();
        Task<PagedResponse<TenantDto>> GetTenantsAsync(int page = 1, int pageSize = 20, string? search = null, TenantStatus? status = null);
        Task<TenantDetailDto?> GetTenantByIdAsync(int tenantId);
        Task<(TenantDto Tenant, string GeneratedPassword)> CreateTenantAsync(CreateTenantRequest request);
        Task<TenantDto> UpdateTenantAsync(int tenantId, UpdateTenantRequest request);
        Task<bool> SuspendTenantAsync(int tenantId, string reason);
        Task<bool> ActivateTenantAsync(int tenantId);
        Task<TenantUsageMetricsDto> GetTenantUsageMetricsAsync(int tenantId);
        Task<TenantHealthDto> GetTenantHealthAsync(int tenantId);
        Task<TenantCostDto> GetTenantCostAsync(int tenantId);
        Task<bool> DeleteTenantAsync(int tenantId);
        
        // User Management for Tenants
        Task<UserDto> AddUserToTenantAsync(int tenantId, CreateUserRequest request);
        Task<UserDto> UpdateTenantUserAsync(int tenantId, int userId, UpdateUserRequest request);
        Task<bool> DeleteTenantUserAsync(int tenantId, int userId);
        Task<bool> ResetTenantUserPasswordAsync(int tenantId, int userId, string newPassword);
        Task<bool> ForceLogoutUserAsync(int tenantId, int userId, int adminUserId);
        Task<bool> ClearTenantDataAsync(int tenantId, int adminUserId);
        Task<SubscriptionDto?> UpdateTenantSubscriptionAsync(int tenantId, int planId, BillingCycle billingCycle);
        /// <summary>Duplicate data from source tenant to target tenant (Products, Settings). SystemAdmin only.</summary>
        Task<DuplicateDataResultDto> DuplicateDataToTenantAsync(int targetTenantId, int sourceTenantId, IReadOnlyList<string> dataTypes);
        /// <summary>Preview what would be copied: counts from source and existing counts in target. For UI before running duplicate.</summary>
        Task<DuplicateDataPreviewDto> GetDuplicateDataPreviewAsync(int targetTenantId, int sourceTenantId, IReadOnlyList<string> dataTypes);
        Task<TenantLimitsDto> GetTenantLimitsAsync(int tenantId);
        Task UpdateTenantLimitsAsync(int tenantId, TenantLimitsDto dto);
        /// <summary>Onboarding tracker: completion steps per tenant; list incomplete. See NOT_BUILT.md.</summary>
        Task<OnboardingReportDto> GetOnboardingReportAsync(bool incompleteOnly = false);
        /// <summary>Bulk tenant actions: extend trial, send announcement. See NOT_BUILT.md.</summary>
        Task<BulkActionResultDto> ExecuteBulkActionAsync(BulkActionRequest request);
        /// <summary>List tenant invoices (read-only, no impersonation). See NOT_BUILT.md.</summary>
        Task<PagedResponse<TenantInvoiceListItemDto>> GetTenantInvoicesAsync(int tenantId, int page = 1, int pageSize = 20);
        /// <summary>Subscription/payment history for tenant (when paid, renewals, payment method). See NOT_BUILT.md.</summary>
        Task<List<TenantPaymentHistoryItemDto>> GetTenantPaymentHistoryAsync(int tenantId);
        /// <summary>Export tenant key data (invoices, customers, products) as ZIP of CSVs for offboarding/compliance. See NOT_BUILT.md.</summary>
        Task<(Stream stream, string fileName)> ExportTenantDataAsync(int tenantId);
    }

    public class TenantPaymentHistoryItemDto
    {
        public int Id { get; set; }
        public string PlanName { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string BillingCycle { get; set; } = string.Empty;
        public DateTime StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public DateTime? ExpiresAt { get; set; }
        public DateTime? NextBillingDate { get; set; }
        public decimal Amount { get; set; }
        public string Currency { get; set; } = "AED";
        public string? PaymentMethod { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? CancelledAt { get; set; }
        public string? PaymentGatewaySubscriptionId { get; set; }
    }

    public class TenantInvoiceListItemDto
    {
        public int Id { get; set; }
        public string InvoiceNo { get; set; } = string.Empty;
        public DateTime InvoiceDate { get; set; }
        public string? CustomerName { get; set; }
        public decimal GrandTotal { get; set; }
        public decimal PaidAmount { get; set; }
        public string PaymentStatus { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
    }

    /// <summary>Internal DTO for tenant data export CSV. See NOT_BUILT.md.</summary>
    internal record ExportInvoiceRow(int Id, string InvoiceNo, DateTime InvoiceDate, string? CustomerName, decimal Subtotal, decimal VatTotal, decimal Discount, decimal GrandTotal, decimal PaidAmount, string Status, DateTime? DueDate, string? Notes, DateTime CreatedAt);

    internal record ExportCustomerRow(int Id, string Name, string? Phone, string? Email, string? Trn, string? Address, decimal CreditLimit, string CustomerType, string? PaymentTerms, DateTime CreatedAt);

    internal record ExportProductRow(int Id, string Sku, string? Barcode, string NameEn, string? NameAr, string UnitType, decimal ConversionToBase, decimal CostPrice, decimal SellPrice, decimal StockQty, int ReorderLevel, DateTime? ExpiryDate, bool IsActive, DateTime CreatedAt, DateTime UpdatedAt);

    public class BulkActionRequest
    {
        public List<int> TenantIds { get; set; } = new();
        public string Action { get; set; } = string.Empty; // "extend_trial" | "send_announcement"
        public int? Days { get; set; }
        public string? Title { get; set; }
        public string? Message { get; set; }
        public string? Severity { get; set; }
    }

    public class BulkActionItemResultDto
    {
        public int TenantId { get; set; }
        public string TenantName { get; set; } = string.Empty;
        public bool Success { get; set; }
        public string? ErrorMessage { get; set; }
    }

    public class BulkActionResultDto
    {
        public List<BulkActionItemResultDto> Results { get; set; } = new();
        public int SuccessCount { get; set; }
        public int FailureCount { get; set; }
    }

    public class TenantLimitsDto
    {
        public int MaxRequestsPerMinute { get; set; } = 200;
        public int MaxConcurrentUsers { get; set; } = 100;
        public int MaxStorageMb { get; set; } = 1024;
        public int MaxInvoicesPerMonth { get; set; } = 1000;
    }

    /// <summary>Tenant onboarding completion (5 steps: Company, VAT, Product, Customer, Invoice).</summary>
    public class TenantOnboardingDto
    {
        public int TenantId { get; set; }
        public string TenantName { get; set; } = string.Empty;
        public string? Status { get; set; }
        public bool Step1CompanyInfo { get; set; }
        public bool Step2VatSetup { get; set; }
        public bool Step3HasProduct { get; set; }
        public bool Step4HasCustomer { get; set; }
        public bool Step5HasInvoice { get; set; }
        public int CompletedSteps { get; set; }
        public bool IsComplete => CompletedSteps >= 5;
    }

    public class OnboardingReportDto
    {
        public List<TenantOnboardingDto> Tenants { get; set; } = new();
        public int TotalTenants { get; set; }
        public int CompleteCount { get; set; }
        public int IncompleteCount { get; set; }
    }

    public class SuperAdminTenantService : ISuperAdminTenantService
    {
        private readonly AppDbContext _context;
        private readonly ISubscriptionService _subscriptionService;

        /// <summary>
        /// Ensures FeaturesJson column exists in Tenants table (SQLite only).
        /// Called automatically when needed, but can be called proactively.
        /// Completely silent - never throws exceptions to avoid breaking requests.
        /// </summary>
        private async Task EnsureFeaturesJsonColumnExistsAsync()
        {
            if (_context.Database.IsNpgsql())
                return; // PostgreSQL uses migrations

            try
            {
                // Check if column exists first to avoid unnecessary ALTER TABLE
                var connection = _context.Database.GetDbConnection();
                var wasOpen = connection.State == System.Data.ConnectionState.Open;
                
                if (!wasOpen)
                {
                    await connection.OpenAsync();
                }

                try
                {
                    using var checkCommand = connection.CreateCommand();
                    checkCommand.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Tenants') WHERE name = 'FeaturesJson'";
                    var columnCount = await checkCommand.ExecuteScalarAsync();
                    var exists = columnCount != null && Convert.ToInt32(columnCount) > 0;
                    
                    if (!exists)
                    {
                        // Column doesn't exist, add it
                        using var alterCommand = connection.CreateCommand();
                        alterCommand.CommandText = "ALTER TABLE Tenants ADD COLUMN FeaturesJson TEXT NULL";
                        await alterCommand.ExecuteNonQueryAsync();
                    }
                }
                finally
                {
                    if (!wasOpen && connection.State == System.Data.ConnectionState.Open)
                    {
                        await connection.CloseAsync();
                    }
                }
            }
            catch
            {
                // Completely silent - swallow ALL exceptions
                // Column might already exist, or there might be a connection issue
                // DatabaseFixer will ensure it exists on startup anyway
                // Never throw - this should never break a request
            }
        }

        public SuperAdminTenantService(AppDbContext context, ISubscriptionService subscriptionService)
        {
            _context = context;
            _subscriptionService = subscriptionService;
        }

        public async Task<PlatformDashboardDto> GetPlatformDashboardAsync()
        {
            try
            {
                var totalTenants = await _context.Tenants.CountAsync();
                var activeTenants = await _context.Tenants.CountAsync(t => t.Status == TenantStatus.Active);
                var trialTenants = await _context.Tenants.CountAsync(t => t.Status == TenantStatus.Trial);
                var suspendedTenants = await _context.Tenants.CountAsync(t => t.Status == TenantStatus.Suspended);
                var expiredTenants = await _context.Tenants.CountAsync(t => t.Status == TenantStatus.Expired);
                
                var startOfMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);
                var newTenantsThisMonth = await _context.Tenants.CountAsync(t => t.CreatedAt >= startOfMonth);

                var totalInvoices = await _context.Sales.CountAsync(s => !s.IsDeleted);
                var totalUsers = await _context.Users.CountAsync(u => u.TenantId != null && u.TenantId > 0);
                var totalCustomers = await _context.Customers.CountAsync();
                var totalProducts = await _context.Products.CountAsync();

                var platformRevenue = await _context.Sales
                    .Where(s => !s.IsDeleted)
                    .SumAsync(s => (decimal?)s.GrandTotal) ?? 0;

                var tenantsWithSales = activeTenants + trialTenants;
                var avgSalesPerTenant = tenantsWithSales > 0
                    ? platformRevenue / tenantsWithSales
                    : 0;

                var topTenants = await _context.Sales
                    .Where(s => !s.IsDeleted && s.TenantId != null && s.TenantId > 0)
                    .GroupBy(s => s.TenantId!.Value)
                    .Select(g => new { TenantId = g.Key, TotalSales = g.Sum(s => s.GrandTotal) })
                    .OrderByDescending(x => x.TotalSales)
                    .Take(5)
                    .ToListAsync();
                var tenantIds = topTenants.Select(t => t.TenantId).ToList();
                var tenantNames = tenantIds.Any() 
                    ? await _context.Tenants
                        .Where(t => tenantIds.Contains(t.Id))
                        .ToDictionaryAsync(t => t.Id, t => t.Name)
                    : new Dictionary<int, string>();
                var topTenantsDto = topTenants
                    .Select(t => new TopTenantBySalesDto
                    {
                        TenantId = t.TenantId,
                        TenantName = tenantNames.GetValueOrDefault(t.TenantId, "?"),
                        TotalSales = t.TotalSales
                    })
                    .ToList();

                // Calculate MRR - handle case where Subscriptions table might not exist or be empty
                decimal mrr = 0;
                bool hasSubscriptionData = false;
                try
                {
                    if (await _context.Database.CanConnectAsync())
                    {
                        try
                        {
                            hasSubscriptionData = await _context.Subscriptions.AnyAsync();
                            if (hasSubscriptionData)
                            {
                                mrr = await _context.Subscriptions
                                    .Include(s => s.Plan)
                                    .Where(s => (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Trial) && s.Plan != null)
                                    .SumAsync(s => (decimal?)s.Plan!.MonthlyPrice) ?? 0;
                            }
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"MRR query failed (table may not exist): {ex.Message}");
                            mrr = 0;
                        }
                    }
                }
                catch
                {
                    mrr = 0;
                }

                var storageEstimate = totalInvoices + totalCustomers + totalProducts + totalUsers;
                var estimatedStorageUsedMb = (int)Math.Ceiling(storageEstimate * 0.002); // rough row-based proxy
                var isRealDatabaseSize = false;
                try
                {
                    // PostgreSQL: real database size in bytes -> MB
                    var sizeBytes = await _context.Database
                        .SqlQueryRaw<long>("SELECT pg_database_size(current_database()) AS \"Value\"")
                        .FirstOrDefaultAsync();
                    if (sizeBytes > 0)
                    {
                        estimatedStorageUsedMb = (int)Math.Ceiling(sizeBytes / (1024.0 * 1024.0));
                        isRealDatabaseSize = true;
                    }
                }
                catch
                {
                    // Not PostgreSQL or query failed: use row-based estimate
                }

                var storageFormulaDescription = isRealDatabaseSize
                    ? null
                    : "(invoices + customers + products + users) × 0.002 MB (row-based estimate)";

                // Trials expiring in next 7 days
                var now = DateTime.UtcNow;
                var weekFromNow = now.AddDays(7);
                var trialsExpiring = await _context.Tenants
                    .Where(t => t.Status == TenantStatus.Trial && t.TrialEndDate.HasValue && t.TrialEndDate.Value >= now && t.TrialEndDate.Value <= weekFromNow)
                    .OrderBy(t => t.TrialEndDate)
                    .Select(t => new TrialExpiringDto { TenantId = t.Id, Name = t.Name, TrialEndDate = t.TrialEndDate!.Value })
                    .Take(20)
                    .ToListAsync();
                
                // Calculate platform infrastructure cost
                // Formula: DB size cost + Storage cost + API requests cost
                var estimatedDbSizeMb = estimatedStorageUsedMb;
                var estimatedStorageMb = (int)Math.Ceiling(totalInvoices * 0.2); // PDF storage estimate
                var apiRequestsEstimate = totalInvoices * 10; // Rough estimate: 10 API calls per invoice
                var infraCostEstimate = (decimal)(estimatedDbSizeMb * 0.02 + estimatedStorageMb * 0.01 + apiRequestsEstimate * 0.00001);
                var margin = platformRevenue > 0 ? platformRevenue - infraCostEstimate : 0;
                var marginPercent = platformRevenue > 0 ? (margin / platformRevenue) * 100 : 0;

                return new PlatformDashboardDto
                {
                    TotalTenants = totalTenants,
                    ActiveTenants = activeTenants,
                    TrialTenants = trialTenants,
                    SuspendedTenants = suspendedTenants,
                    ExpiredTenants = expiredTenants,
                    NewTenantsThisMonth = newTenantsThisMonth,
                    TotalInvoices = totalInvoices,
                    TotalUsers = totalUsers,
                    TotalCustomers = totalCustomers,
                    TotalProducts = totalProducts,
                    PlatformRevenue = platformRevenue,
                    AvgSalesPerTenant = avgSalesPerTenant,
                    TopTenants = topTenantsDto,
                    Mrr = mrr,
                    HasSubscriptionData = hasSubscriptionData,
                    TrialsExpiringThisWeek = trialsExpiring,
                    StorageEstimate = storageEstimate,
                    EstimatedStorageUsedMb = estimatedStorageUsedMb,
                    IsRealDatabaseSize = isRealDatabaseSize,
                    StorageFormulaDescription = storageFormulaDescription,
                    InfraCostEstimate = infraCostEstimate,
                    Margin = margin,
                    MarginPercent = marginPercent,
                    LastUpdated = DateTime.UtcNow
                };
            }
            catch (Exception ex)
            {
                // Log the full exception for debugging
                System.Diagnostics.Debug.WriteLine($"GetPlatformDashboardAsync error: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"Stack trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    System.Diagnostics.Debug.WriteLine($"Inner exception: {ex.InnerException.Message}");
                }
                
                // Return a safe default dashboard instead of throwing
                // This prevents the 500 error and allows the UI to load
                return new PlatformDashboardDto
                {
                    TotalTenants = 0,
                    ActiveTenants = 0,
                    TrialTenants = 0,
                    SuspendedTenants = 0,
                    ExpiredTenants = 0,
                    TotalInvoices = 0,
                    TotalUsers = 0,
                    TotalCustomers = 0,
                    TotalProducts = 0,
                    PlatformRevenue = 0,
                    AvgSalesPerTenant = 0,
                    TopTenants = new List<TopTenantBySalesDto>(),
                    Mrr = 0,
                    HasSubscriptionData = false,
                    TrialsExpiringThisWeek = new List<TrialExpiringDto>(),
                    StorageEstimate = 0,
                    EstimatedStorageUsedMb = 0,
                    IsRealDatabaseSize = false,
                    StorageFormulaDescription = null,
                    InfraCostEstimate = 0,
                    Margin = 0,
                    MarginPercent = 0,
                    LastUpdated = DateTime.UtcNow
                };
            }
        }

        public async Task<OnboardingReportDto> GetOnboardingReportAsync(bool incompleteOnly = false)
        {
            var tenants = await _context.Tenants
                .AsNoTracking()
                .Select(t => new { t.Id, t.Name, t.Status, t.CompanyNameEn, t.VatNumber, t.Address })
                .ToListAsync();

            var tenantIds = tenants.Select(t => t.Id).ToList();
            var productCounts = await _context.Products
                .Where(p => p.TenantId != null && tenantIds.Contains(p.TenantId.Value))
                .GroupBy(p => p.TenantId!.Value)
                .Select(g => new { TenantId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.TenantId, x => x.Count);
            var customerCounts = await _context.Customers
                .Where(c => c.TenantId != null && tenantIds.Contains(c.TenantId.Value))
                .GroupBy(c => c.TenantId!.Value)
                .Select(g => new { TenantId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.TenantId, x => x.Count);
            var saleCounts = await _context.Sales
                .Where(s => !s.IsDeleted && s.TenantId != null && tenantIds.Contains(s.TenantId.Value))
                .GroupBy(s => s.TenantId!.Value)
                .Select(g => new { TenantId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.TenantId, x => x.Count);

            var list = new List<TenantOnboardingDto>();
            foreach (var t in tenants)
            {
                var step1 = !string.IsNullOrWhiteSpace(t.CompanyNameEn) || !string.IsNullOrWhiteSpace(t.Address);
                var step2 = !string.IsNullOrWhiteSpace(t.VatNumber);
                var step3 = productCounts.GetValueOrDefault(t.Id, 0) > 0;
                var step4 = customerCounts.GetValueOrDefault(t.Id, 0) > 0;
                var step5 = saleCounts.GetValueOrDefault(t.Id, 0) > 0;
                var completed = (step1 ? 1 : 0) + (step2 ? 1 : 0) + (step3 ? 1 : 0) + (step4 ? 1 : 0) + (step5 ? 1 : 0);
                if (incompleteOnly && completed >= 5) continue;
                list.Add(new TenantOnboardingDto
                {
                    TenantId = t.Id,
                    TenantName = t.Name ?? "",
                    Status = t.Status.ToString(),
                    Step1CompanyInfo = step1,
                    Step2VatSetup = step2,
                    Step3HasProduct = step3,
                    Step4HasCustomer = step4,
                    Step5HasInvoice = step5,
                    CompletedSteps = completed
                });
            }

            var totalTenants = await _context.Tenants.CountAsync();
            var completeCount = list.Count(x => x.IsComplete);
            var incompleteCount = list.Count - completeCount;
            if (incompleteOnly)
            {
                incompleteCount = list.Count;
                completeCount = totalTenants - incompleteCount;
            }
            return new OnboardingReportDto
            {
                Tenants = list,
                TotalTenants = totalTenants,
                CompleteCount = completeCount,
                IncompleteCount = incompleteCount
            };
        }

        public async Task<BulkActionResultDto> ExecuteBulkActionAsync(BulkActionRequest request)
        {
            var results = new List<BulkActionItemResultDto>();
            if (request?.TenantIds == null || request.TenantIds.Count == 0)
                return new BulkActionResultDto { Results = results, SuccessCount = 0, FailureCount = 0 };

            var action = (request.Action ?? "").Trim().ToLowerInvariant();
            if (action != "extend_trial" && action != "send_announcement")
                return new BulkActionResultDto { Results = results, SuccessCount = 0, FailureCount = 0 };

            var tenantIds = request.TenantIds.Distinct().Take(100).ToList();
            var tenants = await _context.Tenants
                .Where(t => tenantIds.Contains(t.Id))
                .ToDictionaryAsync(t => t.Id, t => t);

            foreach (var tenantId in tenantIds)
            {
                var name = tenants.GetValueOrDefault(tenantId)?.Name ?? $"Tenant {tenantId}";
                try
                {
                    if (action == "extend_trial")
                    {
                        var days = request.Days ?? 7;
                        if (days < 1 || days > 365) days = 7;
                        var tenant = await _context.Tenants.FindAsync(tenantId);
                        if (tenant == null)
                        {
                            results.Add(new BulkActionItemResultDto { TenantId = tenantId, TenantName = name, Success = false, ErrorMessage = "Tenant not found." });
                            continue;
                        }
                        var baseDate = tenant.TrialEndDate.HasValue && tenant.TrialEndDate.Value > DateTime.UtcNow
                            ? tenant.TrialEndDate.Value
                            : DateTime.UtcNow;
                        var newEnd = baseDate.AddDays(days);
                        tenant.TrialEndDate = newEnd;
                        var sub = await _context.Subscriptions
                            .Where(s => s.TenantId == tenantId && s.Status == SubscriptionStatus.Trial)
                            .OrderByDescending(s => s.CreatedAt)
                            .FirstOrDefaultAsync();
                        if (sub != null)
                            sub.TrialEndDate = newEnd;
                        await _context.SaveChangesAsync();
                        results.Add(new BulkActionItemResultDto { TenantId = tenantId, TenantName = name, Success = true });
                    }
                    else if (action == "send_announcement")
                    {
                        var title = (request.Title ?? "Platform announcement").Trim();
                        if (string.IsNullOrEmpty(title)) title = "Platform announcement";
                        var message = (request.Message ?? "").Trim();
                        var severity = (request.Severity ?? "Info").Trim();
                        if (string.IsNullOrEmpty(severity)) severity = "Info";
                        var alert = new Alert
                        {
                            TenantId = tenantId,
                            OwnerId = 0,
                            Type = "PlatformAnnouncement",
                            Title = title.Length > 200 ? title.Substring(0, 200) : title,
                            Message = message.Length > 2000 ? message.Substring(0, 2000) : message,
                            Severity = severity,
                            IsRead = false,
                            IsResolved = false,
                            CreatedAt = DateTime.UtcNow
                        };
                        _context.Alerts.Add(alert);
                        await _context.SaveChangesAsync();
                        results.Add(new BulkActionItemResultDto { TenantId = tenantId, TenantName = name, Success = true });
                    }
                }
                catch (Exception ex)
                {
                    results.Add(new BulkActionItemResultDto { TenantId = tenantId, TenantName = name, Success = false, ErrorMessage = ex.Message });
                }
            }

            return new BulkActionResultDto
            {
                Results = results,
                SuccessCount = results.Count(r => r.Success),
                FailureCount = results.Count(r => !r.Success)
            };
        }

        public async Task<PagedResponse<TenantInvoiceListItemDto>> GetTenantInvoicesAsync(int tenantId, int page = 1, int pageSize = 20)
        {
            pageSize = Math.Min(Math.Max(pageSize, 1), 100);
            var query = _context.Sales
                .AsNoTracking()
                .Where(s => s.TenantId == tenantId && !s.IsDeleted)
                .OrderByDescending(s => s.InvoiceDate)
                .ThenByDescending(s => s.Id);
            var totalCount = await query.CountAsync();
            var items = await query
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(s => new TenantInvoiceListItemDto
                {
                    Id = s.Id,
                    InvoiceNo = s.InvoiceNo ?? "",
                    InvoiceDate = s.InvoiceDate,
                    CustomerName = s.Customer != null ? s.Customer.Name : null,
                    GrandTotal = s.GrandTotal,
                    PaidAmount = s.PaidAmount,
                    PaymentStatus = s.PaymentStatus.ToString(),
                    CreatedAt = s.CreatedAt
                })
                .ToListAsync();
            var totalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize);
            return new PagedResponse<TenantInvoiceListItemDto>
            {
                Items = items,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = totalPages
            };
        }

        public async Task<List<TenantPaymentHistoryItemDto>> GetTenantPaymentHistoryAsync(int tenantId)
        {
            var list = await (from s in _context.Subscriptions.AsNoTracking()
                             join p in _context.SubscriptionPlans on s.PlanId equals p.Id into pj
                             from p in pj.DefaultIfEmpty()
                             where s.TenantId == tenantId
                             orderby s.CreatedAt descending
                             select new TenantPaymentHistoryItemDto
                             {
                                 Id = s.Id,
                                 PlanName = p != null ? p.Name : "Unknown",
                                 Status = s.Status.ToString(),
                                 BillingCycle = s.BillingCycle.ToString(),
                                 StartDate = s.StartDate,
                                 EndDate = s.EndDate,
                                 ExpiresAt = s.ExpiresAt,
                                 NextBillingDate = s.NextBillingDate,
                                 Amount = s.Amount,
                                 Currency = s.Currency ?? "AED",
                                 PaymentMethod = s.PaymentMethod,
                                 CreatedAt = s.CreatedAt,
                                 CancelledAt = s.CancelledAt,
                                 PaymentGatewaySubscriptionId = s.PaymentGatewaySubscriptionId
                             })
                .ToListAsync();
            return list;
        }

        /// <summary>Export tenant data as ZIP containing invoices.csv, customers.csv, products.csv. See NOT_BUILT.md.</summary>
        public async Task<(Stream stream, string fileName)> ExportTenantDataAsync(int tenantId)
        {
            var tenant = await _context.Tenants.AsNoTracking()
                .Where(t => t.Id == tenantId)
                .Select(t => new { t.Name })
                .FirstOrDefaultAsync();
            var safeName = string.IsNullOrEmpty(tenant?.Name) ? $"tenant-{tenantId}" : string.Join("_", (tenant!.Name).Split(Path.GetInvalidFileNameChars()));
            var fileName = $"export_{safeName}_{DateTime.UtcNow:yyyyMMdd_HHmmss}.zip";

            var mem = new MemoryStream();
            using (var zip = new ZipArchive(mem, ZipArchiveMode.Create, leaveOpen: true))
            {
                var sales = await _context.Sales.AsNoTracking()
                    .Where(s => (s.TenantId == tenantId || s.OwnerId == tenantId) && !s.IsDeleted)
                    .OrderBy(s => s.InvoiceDate)
                    .Select(s => new ExportInvoiceRow(s.Id, s.InvoiceNo ?? "", s.InvoiceDate, s.Customer != null ? s.Customer.Name : null, s.Subtotal, s.VatTotal, s.Discount, s.GrandTotal, s.PaidAmount, s.PaymentStatus.ToString(), s.DueDate, s.Notes, s.CreatedAt))
                    .ToListAsync();
                await AddZipEntry(zip, "invoices.csv", BuildInvoicesCsv(sales));

                var customers = await _context.Customers.AsNoTracking()
                    .Where(c => c.TenantId == tenantId || c.OwnerId == tenantId)
                    .OrderBy(c => c.Name)
                    .Select(c => new ExportCustomerRow(c.Id, c.Name, c.Phone, c.Email, c.Trn, c.Address, c.CreditLimit, c.CustomerType.ToString(), c.PaymentTerms, c.CreatedAt))
                    .ToListAsync();
                await AddZipEntry(zip, "customers.csv", BuildCustomersCsv(customers));

                var products = await _context.Products.AsNoTracking()
                    .Where(p => p.TenantId == tenantId || p.OwnerId == tenantId)
                    .OrderBy(p => p.Sku)
                    .Select(p => new ExportProductRow(p.Id, p.Sku ?? "", p.Barcode, p.NameEn, p.NameAr, p.UnitType ?? "", p.ConversionToBase, p.CostPrice, p.SellPrice, p.StockQty, p.ReorderLevel, p.ExpiryDate, p.IsActive, p.CreatedAt, p.UpdatedAt))
                    .ToListAsync();
                await AddZipEntry(zip, "products.csv", BuildProductsCsv(products));
            }

            mem.Position = 0;
            return (mem, fileName);
        }

        private static string EscapeCsv(string? value)
        {
            if (value == null) return "";
            if (value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
                return "\"" + value.Replace("\"", "\"\"") + "\"";
            return value;
        }

        private static async Task AddZipEntry(ZipArchive zip, string entryName, string content)
        {
            var entry = zip.CreateEntry(entryName, CompressionLevel.Fastest);
            await using var w = entry.Open();
            var bytes = Encoding.UTF8.GetBytes(content);
            await w.WriteAsync(bytes);
        }

        private static string BuildInvoicesCsv(List<ExportInvoiceRow> sales)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Id,InvoiceNo,InvoiceDate,CustomerName,Subtotal,VatTotal,Discount,GrandTotal,PaidAmount,Status,DueDate,Notes,CreatedAt");
            foreach (var s in sales)
            {
                sb.AppendLine(string.Join(",",
                    s.Id,
                    EscapeCsv(s.InvoiceNo),
                    s.InvoiceDate.ToString("o", CultureInfo.InvariantCulture),
                    EscapeCsv(s.CustomerName),
                    s.Subtotal.ToString(CultureInfo.InvariantCulture),
                    s.VatTotal.ToString(CultureInfo.InvariantCulture),
                    s.Discount.ToString(CultureInfo.InvariantCulture),
                    s.GrandTotal.ToString(CultureInfo.InvariantCulture),
                    s.PaidAmount.ToString(CultureInfo.InvariantCulture),
                    EscapeCsv(s.Status),
                    s.DueDate.HasValue ? s.DueDate.Value.ToString("o", CultureInfo.InvariantCulture) : "",
                    EscapeCsv(s.Notes),
                    s.CreatedAt.ToString("o", CultureInfo.InvariantCulture)));
            }
            return sb.ToString();
        }

        private static string BuildCustomersCsv(List<ExportCustomerRow> customers)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Id,Name,Phone,Email,Trn,Address,CreditLimit,CustomerType,PaymentTerms,CreatedAt");
            foreach (var c in customers)
            {
                sb.AppendLine(string.Join(",",
                    c.Id,
                    EscapeCsv(c.Name),
                    EscapeCsv(c.Phone),
                    EscapeCsv(c.Email),
                    EscapeCsv(c.Trn),
                    EscapeCsv(c.Address),
                    c.CreditLimit.ToString(CultureInfo.InvariantCulture),
                    EscapeCsv(c.CustomerType),
                    EscapeCsv(c.PaymentTerms),
                    c.CreatedAt.ToString("o", CultureInfo.InvariantCulture)));
            }
            return sb.ToString();
        }

        private static string BuildProductsCsv(List<ExportProductRow> products)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Id,Sku,Barcode,NameEn,NameAr,UnitType,ConversionToBase,CostPrice,SellPrice,StockQty,ReorderLevel,ExpiryDate,IsActive,CreatedAt,UpdatedAt");
            foreach (var p in products)
            {
                sb.AppendLine(string.Join(",",
                    p.Id,
                    EscapeCsv(p.Sku),
                    EscapeCsv(p.Barcode),
                    EscapeCsv(p.NameEn),
                    EscapeCsv(p.NameAr),
                    EscapeCsv(p.UnitType),
                    p.ConversionToBase.ToString(CultureInfo.InvariantCulture),
                    p.CostPrice.ToString(CultureInfo.InvariantCulture),
                    p.SellPrice.ToString(CultureInfo.InvariantCulture),
                    p.StockQty.ToString(CultureInfo.InvariantCulture),
                    p.ReorderLevel,
                    p.ExpiryDate.HasValue ? p.ExpiryDate.Value.ToString("o", CultureInfo.InvariantCulture) : "",
                    p.IsActive ? "true" : "false",
                    p.CreatedAt.ToString("o", CultureInfo.InvariantCulture),
                    p.UpdatedAt.ToString("o", CultureInfo.InvariantCulture)));
            }
            return sb.ToString();
        }

        public async Task<PagedResponse<TenantDto>> GetTenantsAsync(int page = 1, int pageSize = 20, string? search = null, TenantStatus? status = null)
        {
            pageSize = Math.Min(pageSize, 100); // Max 100 per page

            var query = _context.Tenants.AsQueryable();

            // Filter by status
            if (status.HasValue)
            {
                query = query.Where(t => t.Status == status.Value);
            }

            // Search filter
            if (!string.IsNullOrEmpty(search))
            {
                query = query.Where(t => 
                    t.Name.Contains(search) ||
                    (t.CompanyNameEn != null && t.CompanyNameEn.Contains(search)) ||
                    (t.Email != null && t.Email.Contains(search)));
            }

            var totalCount = await query.CountAsync();

            // Query tenants - DatabaseFixer should have added FeaturesJson column on startup
            var tenants = await query
                .OrderByDescending(t => t.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(t => new TenantDto
                {
                    Id = t.Id,
                    Name = t.Name,
                    CompanyNameEn = t.CompanyNameEn,
                    CompanyNameAr = t.CompanyNameAr,
                    Country = t.Country,
                    Currency = t.Currency,
                    Status = t.Status.ToString(),
                    CreatedAt = t.CreatedAt,
                    TrialEndDate = t.TrialEndDate,
                    SuspendedAt = t.SuspendedAt,
                    SuspensionReason = t.SuspensionReason,
                    Email = t.Email,
                    Phone = t.Phone,
                    VatNumber = t.VatNumber,
                    LogoPath = t.LogoPath
                })
                .ToListAsync();

            // BUG #2.1 FIX: Replace N+1 queries with batch GROUP BY queries (600 queries → 6 queries)
            var tenantIds = tenants.Select(t => t.Id).ToList();
            if (tenantIds.Any())
            {
                // Batch query 1: User counts per tenant
                var userCounts = (await _context.Users
                    .Where(u => tenantIds.Contains(u.TenantId ?? 0))
                    .GroupBy(u => u.TenantId ?? 0)
                    .Select(g => new { TenantId = g.Key, Count = g.Count() })
                    .ToListAsync())
                    .ToDictionary(x => x.TenantId, x => x.Count);

                // Batch query 2: Invoice counts per tenant
                var invoiceCounts = (await _context.Sales
                    .Where(s => s.TenantId.HasValue && tenantIds.Contains(s.TenantId.Value) && !s.IsDeleted)
                    .GroupBy(s => s.TenantId!.Value)
                    .Select(g => new { TenantId = g.Key, Count = g.Count() })
                    .ToListAsync())
                    .ToDictionary(x => x.TenantId, x => x.Count);

                // Batch query 3: Customer counts per tenant
                var customerCounts = (await _context.Customers
                    .Where(c => c.TenantId.HasValue && tenantIds.Contains(c.TenantId.Value))
                    .GroupBy(c => c.TenantId!.Value)
                    .Select(g => new { TenantId = g.Key, Count = g.Count() })
                    .ToListAsync())
                    .ToDictionary(x => x.TenantId, x => x.Count);

                // Batch query 4: Product counts per tenant
                var productCounts = (await _context.Products
                    .Where(p => p.TenantId.HasValue && tenantIds.Contains(p.TenantId.Value))
                    .GroupBy(p => p.TenantId!.Value)
                    .Select(g => new { TenantId = g.Key, Count = g.Count() })
                    .ToListAsync())
                    .ToDictionary(x => x.TenantId, x => x.Count);

                // Batch query 5: Total revenue per tenant
                var revenueTotals = (await _context.Sales
                    .Where(s => s.TenantId.HasValue && tenantIds.Contains(s.TenantId.Value) && !s.IsDeleted)
                    .GroupBy(s => s.TenantId!.Value)
                    .Select(g => new { TenantId = g.Key, Total = g.Sum(s => (decimal?)s.GrandTotal) ?? 0 })
                    .ToListAsync())
                    .ToDictionary(x => x.TenantId, x => x.Total);

                // Batch query 6: Last login per tenant (max CreatedAt from Users)
                var lastLogins = (await _context.Users
                    .Where(u => tenantIds.Contains(u.TenantId ?? 0))
                    .GroupBy(u => u.TenantId ?? 0)
                    .Select(g => new { TenantId = g.Key, LastLogin = g.Max(u => u.CreatedAt) })
                    .ToListAsync())
                    .ToDictionary(x => x.TenantId, x => x.LastLogin);

                // Batch query 7: Last activity per tenant (max of LastModifiedAt or CreatedAt from Sales)
                var lastActivities = (await _context.Sales
                    .Where(s => s.TenantId.HasValue && tenantIds.Contains(s.TenantId.Value))
                    .GroupBy(s => s.TenantId!.Value)
                    .Select(g => new { TenantId = g.Key, LastActivity = g.Max(s => (DateTime?)(s.LastModifiedAt ?? s.CreatedAt)) })
                    .ToListAsync())
                    .ToDictionary(x => x.TenantId, x => x.LastActivity);

                // Batch query 8: Plan name and MRR per tenant (latest active/trial subscription)
                // Fetch in memory then take latest per tenant (avoids EF/SQLite GroupBy+FirstOrDefault translation issues)
                var subsWithPlan = await _context.Subscriptions
                    .Where(s => tenantIds.Contains(s.TenantId) && (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Trial))
                    .Select(s => new { s.TenantId, s.CreatedAt, PlanName = s.Plan != null ? s.Plan.Name : null, MRR = s.Plan != null ? s.Plan.MonthlyPrice : 0m })
                    .ToListAsync();
                var subscriptionInfos = subsWithPlan
                    .GroupBy(s => s.TenantId)
                    .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.CreatedAt).First());

                // Map batch results to tenant DTOs
                foreach (var tenant in tenants)
                {
                    tenant.UserCount = userCounts.GetValueOrDefault(tenant.Id, 0);
                    tenant.InvoiceCount = invoiceCounts.GetValueOrDefault(tenant.Id, 0);
                    tenant.CustomerCount = customerCounts.GetValueOrDefault(tenant.Id, 0);
                    tenant.ProductCount = productCounts.GetValueOrDefault(tenant.Id, 0);
                    tenant.TotalRevenue = revenueTotals.GetValueOrDefault(tenant.Id, 0);
                    tenant.LastLogin = lastLogins.GetValueOrDefault(tenant.Id, default(DateTime));
                    tenant.LastActivity = lastActivities.GetValueOrDefault(tenant.Id, null);
                    var subInfo = subscriptionInfos.GetValueOrDefault(tenant.Id);
                    tenant.PlanName = subInfo?.PlanName;
                    tenant.Mrr = subInfo?.MRR ?? 0;
                }
            }

            return new PagedResponse<TenantDto>
            {
                Items = tenants,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
            };
        }

        public async Task<TenantDetailDto?> GetTenantByIdAsync(int tenantId)
        {
            var tenant = await _context.Tenants
                .FirstOrDefaultAsync(t => t.Id == tenantId);

            if (tenant == null) return null;

            // Get usage metrics (non-blocking: if it fails, still return tenant with null metrics)
            TenantUsageMetricsDto? metrics = null;
            try
            {
                metrics = await GetTenantUsageMetricsAsync(tenantId);
            }
            catch { /* allow tenant detail to load without metrics */ }

            // Get users
            var users = await _context.Users
                .Where(u => u.TenantId == tenantId)
                .Select(u => new TenantUserDto
                {
                    Id = u.Id,
                    Name = u.Name,
                    Email = u.Email,
                    Role = u.Role.ToString(),
                    CreatedAt = u.CreatedAt
                })
                .ToListAsync();

            // Get subscription (non-blocking: if it fails, still return tenant with null subscription)
            SubscriptionDto? subscription = null;
            try
            {
                subscription = await _subscriptionService.GetTenantSubscriptionAsync(tenantId);
            }
            catch { /* allow tenant detail to load without subscription */ }

            return new TenantDetailDto
            {
                Id = tenant.Id,
                Name = tenant.Name,
                CompanyNameEn = tenant.CompanyNameEn,
                CompanyNameAr = tenant.CompanyNameAr,
                Country = tenant.Country,
                Currency = tenant.Currency,
                Status = tenant.Status.ToString(),
                CreatedAt = tenant.CreatedAt,
                TrialEndDate = tenant.TrialEndDate,
                SuspendedAt = tenant.SuspendedAt,
                SuspensionReason = tenant.SuspensionReason,
                Email = tenant.Email,
                Phone = tenant.Phone,
                Address = tenant.Address,
                VatNumber = tenant.VatNumber,
                LogoPath = tenant.LogoPath,
                UsageMetrics = metrics,
                Users = users,
                Subscription = subscription
            };
        }

        public async Task<(TenantDto Tenant, string GeneratedPassword)> CreateTenantAsync(CreateTenantRequest request)
        {
            // Check for duplicate tenant name
            var normalizedName = request.Name.Trim();
            var existingTenantByName = await _context.Tenants
                .FirstOrDefaultAsync(t => t.Name.ToLower() == normalizedName.ToLower());
            
            if (existingTenantByName != null)
            {
                throw new InvalidOperationException($"Tenant with name '{normalizedName}' already exists");
            }

            // Check for duplicate email if provided
            string? normalizedEmail = null;
            if (!string.IsNullOrWhiteSpace(request.Email))
            {
                normalizedEmail = request.Email.Trim().ToLowerInvariant();
                var existingTenantByEmail = await _context.Tenants
                    .FirstOrDefaultAsync(t => t.Email != null && t.Email.ToLower() == normalizedEmail);
                
                if (existingTenantByEmail != null)
                {
                    throw new InvalidOperationException($"Tenant with email '{request.Email}' already exists");
                }

                // Also check if email is already used by a user
                var existingUserByEmail = await _context.Users
                    .FirstOrDefaultAsync(u => u.Email.ToLower() == normalizedEmail);
                
                if (existingUserByEmail != null)
                {
                    throw new InvalidOperationException($"Email '{request.Email}' is already registered by a user");
                }
            }
            else
            {
                // If email is not provided, we cannot create a user properly, but we'll proceed with tenant creation only?
                // Or should we require email? The screenshot shows Email as a field, but maybe not required asterisk?
                // Actually screenshot shows "Tenant Name * *" and "Email". Email looks like it might be required or at least standard.
                // But let's stick to the code flow. If email is null, skip user creation?
                // Better to throw or require it if we want "proper" addition.
                // Existing code allows email to be null.
            }

            // NpgsqlRetryingExecutionStrategy does not support user-initiated transactions unless run inside ExecuteAsync
            var strategy = _context.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    var trialEndDate = request.TrialEndDate;
                if (!trialEndDate.HasValue && request.TrialDays.HasValue)
                {
                    trialEndDate = DateTime.UtcNow.AddDays(request.TrialDays.Value);
                }
                else if (!trialEndDate.HasValue)
                {
                    trialEndDate = DateTime.UtcNow.AddDays(14); // Default 14 days
                }

                var tenant = new Tenant
                {
                    Name = normalizedName,
                    CompanyNameEn = request.CompanyNameEn ?? normalizedName,
                    CompanyNameAr = request.CompanyNameAr,
                    Country = request.Country ?? "AE",
                    Currency = request.Currency ?? "AED",
                    VatNumber = request.VatNumber,
                    Address = request.Address,
                    Phone = request.Phone,
                    Email = normalizedEmail,
                    Status = request.Status ?? TenantStatus.Trial,
                    CreatedAt = DateTime.UtcNow,
                    TrialEndDate = trialEndDate
                };

                _context.Tenants.Add(tenant);
                await _context.SaveChangesAsync();

                // Generate secure random password for owner user (security: never hardcode passwords)
                string generatedPassword = GenerateDefaultPassword();
                
                // Create Owner User if email is provided
                if (!string.IsNullOrEmpty(normalizedEmail))
                {
                    var passwordHash = BCrypt.Net.BCrypt.HashPassword(generatedPassword);
                    var ownerUser = new User
                    {
                        Name = "Admin", // Default name
                        Email = normalizedEmail,
                        PasswordHash = passwordHash,
                        Role = UserRole.Owner,
                        Phone = request.Phone,
                        TenantId = tenant.Id,
                        OwnerId = tenant.Id, // So JWT and legacy code get correct tenant
                        CreatedAt = DateTime.UtcNow
                    };

                    _context.Users.Add(ownerUser);
                    await _context.SaveChangesAsync();
                }

                // Return empty password if no email (no user created)
                if (string.IsNullOrEmpty(normalizedEmail))
                {
                    generatedPassword = string.Empty;
                }

                // Create Default Subscription
                // Get default plan (Basic plan - ID 1, or create if doesn't exist)
                var defaultPlan = await _context.SubscriptionPlans
                    .Where(p => p.IsActive)
                    .OrderBy(p => p.DisplayOrder)
                    .ThenBy(p => (double)p.MonthlyPrice)
                    .FirstOrDefaultAsync();

                if (defaultPlan == null)
                {
                    // Create default Basic plan if none exists
                    defaultPlan = new SubscriptionPlan
                    {
                        Name = "Basic",
                        Description = "Basic plan for small businesses",
                        MonthlyPrice = 99,
                        YearlyPrice = 990,
                        Currency = "AED",
                        MaxUsers = 5,
                        MaxInvoicesPerMonth = 100,
                        MaxCustomers = 500,
                        MaxProducts = 1000,
                        MaxStorageMB = 1024,
                        TrialDays = 14,
                        IsActive = true,
                        DisplayOrder = 1,
                        CreatedAt = DateTime.UtcNow
                    };
                    _context.SubscriptionPlans.Add(defaultPlan);
                    await _context.SaveChangesAsync();
                }

                try
                {
                    var initialSubStatus = (request.Status == TenantStatus.Active) ? SubscriptionStatus.Active : (SubscriptionStatus?)null;
                    await _subscriptionService.CreateSubscriptionAsync(
                        tenant.Id,
                        defaultPlan.Id,
                        BillingCycle.Monthly,
                        initialSubStatus
                    );
                }
                catch (Exception)
                {
                    // Ignore subscription creation errors for now to ensure tenant is returned
                    // But preferably we should log it
                }

                await transaction.CommitAsync();

                var tenantDto = new TenantDto
                {
                    Id = tenant.Id,
                    Name = tenant.Name,
                    CompanyNameEn = tenant.CompanyNameEn,
                    CompanyNameAr = tenant.CompanyNameAr,
                    Country = tenant.Country,
                    Currency = tenant.Currency,
                    Status = tenant.Status.ToString(),
                    CreatedAt = tenant.CreatedAt,
                    TrialEndDate = tenant.TrialEndDate,
                    Email = tenant.Email,
                    Phone = tenant.Phone,
                    VatNumber = tenant.VatNumber
                };

                    return (tenantDto, generatedPassword);
                }
                catch (Exception)
                {
                    await transaction.RollbackAsync();
                    throw;
                }
            });
        }

        /// <summary>Generate a secure random default password (no hardcoded passwords).</summary>
        private static string GenerateDefaultPassword()
        {
            const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#";
            var random = new byte[12];
            RandomNumberGenerator.Fill(random);
            return new string(random.Select(b => chars[b % chars.Length]).ToArray());
        }

        public async Task<TenantDto> UpdateTenantAsync(int tenantId, UpdateTenantRequest request)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null)
                throw new InvalidOperationException($"Tenant with ID {tenantId} not found");

            // Update properties
            if (!string.IsNullOrEmpty(request.Name))
                tenant.Name = request.Name;
            if (!string.IsNullOrEmpty(request.CompanyNameEn))
                tenant.CompanyNameEn = request.CompanyNameEn;
            if (!string.IsNullOrEmpty(request.CompanyNameAr))
                tenant.CompanyNameAr = request.CompanyNameAr;
            if (!string.IsNullOrEmpty(request.Country))
                tenant.Country = request.Country;
            if (!string.IsNullOrEmpty(request.Currency))
                tenant.Currency = request.Currency;
            if (request.VatNumber != null)
                tenant.VatNumber = request.VatNumber;
            if (request.Address != null)
                tenant.Address = request.Address;
            if (request.Phone != null)
                tenant.Phone = request.Phone;
            if (request.Email != null)
                tenant.Email = request.Email;
            if (request.Status.HasValue)
            {
                tenant.Status = request.Status.Value;

                // Sync subscription status to prevent reversion
                var subscription = await _context.Subscriptions
                    .Where(s => s.TenantId == tenantId)
                    .OrderByDescending(s => s.CreatedAt)
                    .FirstOrDefaultAsync();

                if (subscription != null)
                {
                    subscription.Status = request.Status.Value switch
                    {
                        TenantStatus.Active => SubscriptionStatus.Active,
                        TenantStatus.Trial => SubscriptionStatus.Trial,
                        TenantStatus.Suspended => SubscriptionStatus.Suspended,
                        TenantStatus.Expired => SubscriptionStatus.Expired,
                        _ => subscription.Status
                    };

                    // If manually activating, ensuring it doesn't immediately expire
                    if (subscription.Status == SubscriptionStatus.Active)
                    {
                        if (subscription.ExpiresAt.HasValue && subscription.ExpiresAt.Value < DateTime.UtcNow)
                        {
                            subscription.ExpiresAt = null; // Clear expiry or set to future
                        }
                    }
                    
                    // If trial, sync end date
                    if (subscription.Status == SubscriptionStatus.Trial && request.TrialEndDate.HasValue)
                    {
                        subscription.TrialEndDate = request.TrialEndDate.Value;
                    }
                }
            }
            if (request.TrialEndDate.HasValue)
            {
                tenant.TrialEndDate = request.TrialEndDate;
                // Sync to subscription so middleware and expiry jobs use updated date
                var sub = await _context.Subscriptions
                    .Where(s => s.TenantId == tenantId && s.Status == SubscriptionStatus.Trial)
                    .OrderByDescending(s => s.CreatedAt)
                    .FirstOrDefaultAsync();
                if (sub != null)
                    sub.TrialEndDate = request.TrialEndDate.Value;
            }

            await _context.SaveChangesAsync();

            return new TenantDto
            {
                Id = tenant.Id,
                Name = tenant.Name,
                CompanyNameEn = tenant.CompanyNameEn,
                CompanyNameAr = tenant.CompanyNameAr,
                Country = tenant.Country,
                Currency = tenant.Currency,
                Status = tenant.Status.ToString(),
                CreatedAt = tenant.CreatedAt,
                TrialEndDate = tenant.TrialEndDate
            };
        }

        public async Task<bool> SuspendTenantAsync(int tenantId, string reason)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null) return false;

            tenant.Status = TenantStatus.Suspended;
            tenant.SuspendedAt = DateTime.UtcNow;
            tenant.SuspensionReason = reason;

            // Sync subscription
            var subscription = await _context.Subscriptions
                .Where(s => s.TenantId == tenantId)
                .OrderByDescending(s => s.CreatedAt)
                .FirstOrDefaultAsync();

            if (subscription != null)
            {
                subscription.Status = SubscriptionStatus.Suspended;
            }

            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> ActivateTenantAsync(int tenantId)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null) return false;

            tenant.Status = TenantStatus.Active;
            tenant.SuspendedAt = null;
            tenant.SuspensionReason = null;

            // Sync subscription
            var subscription = await _context.Subscriptions
                .Where(s => s.TenantId == tenantId)
                .OrderByDescending(s => s.CreatedAt)
                .FirstOrDefaultAsync();

            if (subscription != null)
            {
                subscription.Status = SubscriptionStatus.Active;
                // Ensure not expired
                if (subscription.ExpiresAt.HasValue && subscription.ExpiresAt.Value < DateTime.UtcNow)
                {
                    subscription.ExpiresAt = null;
                }
            }

            await _context.SaveChangesAsync();
            return true;
        }


        public async Task<UserDto> AddUserToTenantAsync(int tenantId, CreateUserRequest request)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null) throw new InvalidOperationException("Tenant not found");

            var email = request.Email.Trim().ToLowerInvariant();
            
            var existingUser = await _context.Users.FirstOrDefaultAsync(u => u.Email.ToLower() == email);
            if (existingUser != null)
            {
                throw new InvalidOperationException("Email already registered");
            }

            if (!Enum.TryParse<UserRole>(request.Role, true, out var role))
            {
                throw new InvalidOperationException("Invalid role. Must be 'Admin' or 'Staff'");
            }

            var user = new User
            {
                Name = request.Name.Trim(),
                Email = email,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
                Role = role,
                Phone = request.Phone,
                TenantId = tenantId,
                CreatedAt = DateTime.UtcNow
            };

            _context.Users.Add(user);
            await _context.SaveChangesAsync();

            return new UserDto
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                Role = user.Role.ToString(),
                Phone = user.Phone,
                DashboardPermissions = user.DashboardPermissions,
                PageAccess = user.PageAccess,
                CreatedAt = user.CreatedAt
            };
        }

        public async Task<UserDto> UpdateTenantUserAsync(int tenantId, int userId, UpdateUserRequest request)
        {
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
            if (user == null) throw new InvalidOperationException("User not found in this tenant");

            if (!string.IsNullOrEmpty(request.Name)) user.Name = request.Name.Trim();
            if (!string.IsNullOrEmpty(request.Phone)) user.Phone = request.Phone.Trim();
            
            if (!string.IsNullOrEmpty(request.Role))
            {
                if (Enum.TryParse<UserRole>(request.Role, true, out var role))
                {
                    user.Role = role;
                }
                else
                {
                    throw new InvalidOperationException("Invalid role. Must be 'Admin' or 'Staff'");
                }
            }

            await _context.SaveChangesAsync();

            return new UserDto
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                Role = user.Role.ToString(),
                Phone = user.Phone,
                DashboardPermissions = user.DashboardPermissions,
                PageAccess = user.PageAccess,
                CreatedAt = user.CreatedAt
            };
        }

        public async Task<bool> DeleteTenantUserAsync(int tenantId, int userId)
        {
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
            if (user == null) return false;

            // Check if user is the last owner (optional safety)
            if (user.Role == UserRole.Owner)
            {
                var ownerCount = await _context.Users.CountAsync(u => u.TenantId == tenantId && u.Role == UserRole.Owner);
                if (ownerCount <= 1)
                {
                    throw new InvalidOperationException("Cannot delete the last owner of the company");
                }
            }

            _context.Users.Remove(user);
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> ResetTenantUserPasswordAsync(int tenantId, int userId, string newPassword)
        {
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
            if (user == null) return false;

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword);
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> ForceLogoutUserAsync(int tenantId, int userId, int adminUserId)
        {
            var user = await _context.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
            if (user == null) return false;

            user.SessionVersion++;
            await _context.SaveChangesAsync();

            _context.AuditLogs.Add(new AuditLog
            {
                TenantId = tenantId,
                OwnerId = 0,
                UserId = adminUserId,
                Action = "SuperAdmin:ForceLogoutUser",
                Details = $"Force logout user {user.Email} (Id={userId}) in tenant {tenantId}",
                CreatedAt = DateTime.UtcNow
            });
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<TenantUsageMetricsDto> GetTenantUsageMetricsAsync(int tenantId)
        {
            var invoiceCount = await _context.Sales.CountAsync(s => s.TenantId == tenantId && !s.IsDeleted);
            var customerCount = await _context.Customers.CountAsync(c => c.TenantId == tenantId);
            var productCount = await _context.Products.CountAsync(p => p.TenantId == tenantId);
            var userCount = await _context.Users.CountAsync(u => u.TenantId == tenantId);

            var totalRevenue = await _context.Sales
                .Where(s => s.TenantId == tenantId && !s.IsDeleted)
                .SumAsync(s => (decimal?)s.TotalAmount) ?? 0;

            var purchaseCount = await _context.Purchases.CountAsync(p => p.TenantId == tenantId);
            var totalPurchases = await _context.Purchases
                .Where(p => p.TenantId == tenantId)
                .SumAsync(p => (decimal?)p.TotalAmount) ?? 0;

            var expenseCount = await _context.Expenses.CountAsync(e => e.TenantId == tenantId);
            var totalExpenses = await _context.Expenses
                .Where(e => e.TenantId == tenantId)
                .SumAsync(e => (decimal?)e.Amount) ?? 0;

            var totalOutstanding = await _context.Customers
                .Where(c => c.TenantId == tenantId)
                .SumAsync(c => (decimal?)c.Balance) ?? 0;

            var storageEstimate = invoiceCount + customerCount + productCount + userCount + purchaseCount + expenseCount;

            // Get last activity (most recent sale, user, purchase or expense)
            var lastSaleDate = await _context.Sales
                .Where(s => s.TenantId == tenantId && !s.IsDeleted)
                .OrderByDescending(s => s.CreatedAt)
                .Select(s => (DateTime?)s.CreatedAt)
                .FirstOrDefaultAsync();

            var lastUserDate = await _context.Users
                .Where(u => u.TenantId == tenantId)
                .OrderByDescending(u => u.CreatedAt)
                .Select(u => (DateTime?)u.CreatedAt)
                .FirstOrDefaultAsync();

            var lastPurchaseDate = await _context.Purchases
                .Where(p => p.TenantId == tenantId)
                .OrderByDescending(p => p.CreatedAt)
                .Select(p => (DateTime?)p.CreatedAt)
                .FirstOrDefaultAsync();

            var lastExpenseDate = await _context.Expenses
                .Where(e => e.TenantId == tenantId)
                .OrderByDescending(e => e.CreatedAt)
                .Select(e => (DateTime?)e.CreatedAt)
                .FirstOrDefaultAsync();

            var dates = new[] { lastSaleDate, lastUserDate, lastPurchaseDate, lastExpenseDate }
                .Where(d => d.HasValue)
                .Select(d => d.Value)
                .ToList();

            var lastActivity = dates.Any() ? dates.Max() : (DateTime?)null;

            return new TenantUsageMetricsDto
            {
                InvoiceCount = invoiceCount,
                CustomerCount = customerCount,
                ProductCount = productCount,
                UserCount = userCount,
                PurchaseCount = purchaseCount,
                ExpenseCount = expenseCount,
                TotalRevenue = totalRevenue,
                TotalPurchases = totalPurchases,
                TotalExpenses = totalExpenses,
                TotalOutstanding = totalOutstanding,
                StorageEstimate = storageEstimate,
                LastActivity = lastActivity
            };
        }

        public async Task<TenantHealthDto> GetTenantHealthAsync(int tenantId)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null)
                return new TenantHealthDto { Score = 0, Level = "Red", RiskFactors = new List<string> { "Tenant not found" }, ScoreDescription = "Starts at 100. Deductions: trial expiring soon (−15 to −30), high outstanding vs revenue (−10 to −25), high storage (−20), no activity 30+ days (−10). Green ≥70, Yellow ≥40, Red <40." };

            var metrics = await GetTenantUsageMetricsAsync(tenantId);
            var riskFactors = new List<string>();
            int score = 100;

            if (tenant.TrialEndDate.HasValue && tenant.Status == TenantStatus.Trial)
            {
                var daysLeft = (tenant.TrialEndDate.Value - DateTime.UtcNow).TotalDays;
                if (daysLeft < 3) { score -= 30; riskFactors.Add("Trial expiring in < 3 days"); }
                else if (daysLeft < 7) { score -= 15; riskFactors.Add("Trial expiring in < 7 days"); }
            }

            var outstanding = await _context.Sales
                .Where(s => s.TenantId == tenantId && !s.IsDeleted && (s.PaymentStatus == SalePaymentStatus.Pending || s.PaymentStatus == SalePaymentStatus.Partial))
                .SumAsync(s => (decimal?)(s.GrandTotal - s.PaidAmount)) ?? 0;
            if (metrics.TotalRevenue > 0 && outstanding > 0)
            {
                var pct = (double)(outstanding / metrics.TotalRevenue * 100);
                if (pct > 30) { score -= 25; riskFactors.Add($"High outstanding ratio: {pct:F0}%"); }
                else if (pct > 15) { score -= 10; riskFactors.Add($"Elevated outstanding: {pct:F0}%"); }
            }

            var storagePct = metrics.StorageEstimate > 5000 ? 80 : (metrics.StorageEstimate * 100 / 5000);
            if (storagePct >= 80) { score -= 20; riskFactors.Add("Storage usage high"); }

            if (metrics.LastActivity.HasValue && (DateTime.UtcNow - metrics.LastActivity.Value).TotalDays > 30)
            { score -= 10; riskFactors.Add("Low activity (30+ days)"); }

            score = Math.Clamp(score, 0, 100);
            var level = score >= 70 ? "Green" : score >= 40 ? "Yellow" : "Red";
            var description = "Starts at 100. Deductions: trial expiring soon (−15 to −30), high outstanding vs revenue (−10 to −25), high storage (−20), no activity 30+ days (−10). Green ≥70, Yellow ≥40, Red <40.";
            return new TenantHealthDto { Score = score, Level = level, RiskFactors = riskFactors, ScoreDescription = description };
        }

        public async Task<TenantCostDto> GetTenantCostAsync(int tenantId)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null)
                return new TenantCostDto();

            var metrics = await GetTenantUsageMetricsAsync(tenantId);
            var invoiceCount = metrics.InvoiceCount;
            var rowCount = invoiceCount + metrics.CustomerCount + metrics.ProductCount + metrics.UserCount;
            var estimatedDbSizeMb = (int)Math.Ceiling(rowCount * 0.002);
            var estimatedStorageMb = (int)Math.Ceiling(invoiceCount * 0.2);
            var apiRequestsEstimate = invoiceCount * 10;
            var infraCostEstimate = (decimal)(estimatedDbSizeMb * 0.02 + estimatedStorageMb * 0.01 + apiRequestsEstimate * 0.00001);
            var revenue = metrics.TotalRevenue;
            var margin = revenue > 0 ? revenue - infraCostEstimate : 0;

            return new TenantCostDto
            {
                EstimatedDbSizeMb = estimatedDbSizeMb,
                EstimatedStorageMb = estimatedStorageMb,
                ApiRequestsEstimate = apiRequestsEstimate,
                InfraCostEstimate = infraCostEstimate,
                Revenue = revenue,
                Margin = margin
            };
        }

        /// <summary>
        /// Wipes all transactional data for the tenant. Preserves: Tenant, Users, Products, Customers,
        /// Subscriptions, Company Settings. Deletes: Sales, SaleItems, Payments, Expenses, Returns,
        /// Purchases, Alerts; resets Product.StockQty and Customer balances to 0. No backup is created — recommend creating a backup first if needed.
        /// </summary>
        public async Task<bool> ClearTenantDataAsync(int tenantId, int adminUserId)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null) return false;

            var strategy = _context.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                // Delete all transactional data for this tenant (subscription and settings are NOT touched)
                // FK order: Payments ref Sales → delete Payments first, then SaleItems, then Sales

                // Payments (must delete before Sales - FK_Payments_Sales_SaleId)
                await _context.Payments.Where(p => p.TenantId == tenantId).ExecuteDeleteAsync();

                // Sales and Sale Items
                var saleIds = await _context.Sales.Where(s => s.TenantId == tenantId).Select(s => s.Id).ToListAsync();
                if (saleIds.Any())
                {
                    await _context.SaleItems.Where(si => saleIds.Contains(si.SaleId)).ExecuteDeleteAsync();
                    await _context.Sales.Where(s => s.TenantId == tenantId).ExecuteDeleteAsync();
                }

                // Expenses
                await _context.Expenses.Where(e => e.TenantId == tenantId).ExecuteDeleteAsync();

                // Inventory Transactions
                await _context.InventoryTransactions.Where(i => i.TenantId == tenantId).ExecuteDeleteAsync();

                // Sales Returns (delete items first - FK constraint)
                var saleReturnIds = await _context.SaleReturns.Where(sr => sr.TenantId == tenantId).Select(sr => sr.Id).ToListAsync();
                if (saleReturnIds.Any())
                {
                    await _context.SaleReturnItems.Where(sri => saleReturnIds.Contains(sri.SaleReturnId)).ExecuteDeleteAsync();
                    await _context.SaleReturns.Where(sr => sr.TenantId == tenantId).ExecuteDeleteAsync();
                }

                // Purchase Returns (delete items first - FK constraint)
                var purchaseReturnIds = await _context.PurchaseReturns.Where(pr => pr.TenantId == tenantId).Select(pr => pr.Id).ToListAsync();
                if (purchaseReturnIds.Any())
                {
                    await _context.PurchaseReturnItems.Where(pri => purchaseReturnIds.Contains(pri.PurchaseReturnId)).ExecuteDeleteAsync();
                    await _context.PurchaseReturns.Where(pr => pr.TenantId == tenantId).ExecuteDeleteAsync();
                }

                // Purchases
                var purchaseIds = await _context.Purchases.Where(p => p.TenantId == tenantId).Select(p => p.Id).ToListAsync();
                if (purchaseIds.Any())
                {
                    await _context.PurchaseItems.Where(pi => purchaseIds.Contains(pi.PurchaseId)).ExecuteDeleteAsync();
                    await _context.Purchases.Where(p => p.TenantId == tenantId).ExecuteDeleteAsync();
                }

                // Reset stock quantities to 0 (keep products)
                await _context.Products
                    .Where(p => p.TenantId == tenantId && p.StockQty != 0)
                    .ExecuteUpdateAsync(p => p.SetProperty(x => x.StockQty, 0));

                // Reset customer balances and totals to 0 (keep customers)
                await _context.Customers
                    .Where(c => c.TenantId == tenantId)
                    .ExecuteUpdateAsync(c => c
                        .SetProperty(x => x.Balance, 0)
                        .SetProperty(x => x.PendingBalance, 0)
                        .SetProperty(x => x.TotalSales, 0)
                        .SetProperty(x => x.TotalPayments, 0));

                // Clear alerts
                await _context.Alerts.Where(a => a.TenantId == tenantId).ExecuteDeleteAsync();

                // Create audit log entry
                var auditLog = new AuditLog
                {
                    TenantId = tenantId,
                    OwnerId = tenantId,
                    UserId = adminUserId,
                    Action = "TENANT_DATA_CLEAR",
                    Details = $"Data cleared for tenant ID {tenantId} ({tenant.Name}).",
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
                    System.Diagnostics.Debug.WriteLine($"ClearTenantDataAsync error: {ex.Message}");
                    throw;
                }
            });
        }

        public async Task<SubscriptionDto?> UpdateTenantSubscriptionAsync(int tenantId, int planId, BillingCycle billingCycle)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null) return null;

            // Get existing subscription or create new one
            var subscription = await _context.Subscriptions
                .Where(s => s.TenantId == tenantId)
                .OrderByDescending(s => s.CreatedAt)
                .FirstOrDefaultAsync();

            if (subscription != null)
            {
                // Update existing
                return await _subscriptionService.UpdateSubscriptionAsync(subscription.Id, planId, billingCycle);
            }
            else
            {
                // Create new
                return await _subscriptionService.CreateSubscriptionAsync(tenantId, planId, billingCycle);
            }
        }

        /// <summary>Execute delete SQL; ignore 42P01 (relation does not exist) so DeleteTenant works when optional tables are missing.</summary>
        private async Task DeleteIgnoreMissingTableAsync(FormattableString sql)
        {
            try
            {
                await _context.Database.ExecuteSqlInterpolatedAsync(sql);
            }
            catch (PostgresException ex) when (ex.SqlState == "42P01") { /* table does not exist */ }
            catch (Exception ex) when (ex.InnerException is PostgresException pg && pg.SqlState == "42P01") { /* table does not exist */ }
        }

        public async Task<bool> DeleteTenantAsync(int tenantId)
        {
            var tenant = await _context.Tenants.FindAsync(tenantId);
            if (tenant == null) return false;

            // CRITICAL: Do NOT use CreateExecutionStrategy + BeginTransactionAsync - NpgsqlRetryingExecutionStrategy
            // does not support user-initiated transactions (causes 500). Run deletes directly.
            try
            {
                // AUDIT-1 FIX: Use ExecuteSqlInterpolatedAsync instead of ExecuteSqlRawAsync with {0} placeholders
                // This prevents SQL syntax errors and ensures proper parameterization
                
                // Delete all tenant data in correct order (respecting foreign keys)
                // 1. Delete dependent records first (child tables)
                
                // Delete PaymentIdempotencies first (optional table - may not exist)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""PaymentIdempotencies"" 
                       WHERE ""PaymentId"" IN (SELECT ""Id"" FROM ""Payments"" WHERE ""TenantId"" = {tenantId})
                          OR ""UserId"" IN (SELECT ""Id"" FROM ""Users"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete InvoiceTemplates (tenant-scoped)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""InvoiceTemplates"" 
                       WHERE ""TenantId"" = {tenantId}");
                
                // Delete SaleReturnItems FIRST - has FKs to SaleReturns, SaleItems, Products, DamageCategories
                // Must run before SaleItems so we don't violate SaleReturnItem.SaleItemId FK
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""SaleReturnItems"" 
                       WHERE ""SaleReturnId"" IN (SELECT ""Id"" FROM ""SaleReturns"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete SaleItems (has FK to Sales)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""SaleItems"" 
                       WHERE ""SaleId"" IN (SELECT ""Id"" FROM ""Sales"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete PurchaseItems (has FK to Purchases)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""PurchaseItems"" 
                       WHERE ""PurchaseId"" IN (SELECT ""Id"" FROM ""Purchases"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete PurchaseReturnItems (has FK to PurchaseReturns)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""PurchaseReturnItems"" 
                       WHERE ""PurchaseReturnId"" IN (SELECT ""Id"" FROM ""PurchaseReturns"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete InvoiceVersions (optional table)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""InvoiceVersions"" 
                       WHERE ""SaleId"" IN (SELECT ""Id"" FROM ""Sales"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete PriceChangeLogs (optional table)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""PriceChangeLogs"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete RouteCustomers (has FK to Routes)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""RouteCustomers"" 
                       WHERE ""RouteId"" IN (SELECT ""Id"" FROM ""Routes"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete Payments (has FK to Sales and Customers)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Payments"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete Expenses
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Expenses"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete RecurringExpenses (optional table - may not exist)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""RecurringExpenses"" WHERE ""TenantId"" = {tenantId} OR ""OwnerId"" = {tenantId}");
                
                // Delete InventoryTransactions
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""InventoryTransactions"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete ProductCategories
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""ProductCategories"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete DamageCategories (tenant-scoped; optional table - use ignore so delete company works when table missing)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""DamageCategories"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete UserSessions
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""UserSessions"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete CustomerVisits (optional table)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""CustomerVisits"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete HeldInvoices (optional table)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""HeldInvoices"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete Alerts (optional table)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""Alerts"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete BranchStaff (has FK to Branches)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""BranchStaff"" 
                       WHERE ""BranchId"" IN (SELECT ""Id"" FROM ""Branches"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete RouteStaff (has FK to Routes)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""RouteStaff"" 
                       WHERE ""RouteId"" IN (SELECT ""Id"" FROM ""Routes"" WHERE ""TenantId"" = {tenantId})");
                
                // Delete RouteExpenses
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""RouteExpenses"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete AuditLogs (check both TenantId and OwnerId)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""AuditLogs"" 
                       WHERE ""TenantId"" = {tenantId} OR ""OwnerId"" = {tenantId}");
                
                // Delete ErrorLogs (optional - table/column may not exist on some DBs)
                await DeleteIgnoreMissingTableAsync(
                    $@"DELETE FROM ""ErrorLogs"" WHERE ""TenantId"" = {tenantId}");
                
                // 2. Delete main records (parent tables)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Sales"" WHERE ""TenantId"" = {tenantId}");
                
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""SaleReturns"" WHERE ""TenantId"" = {tenantId}");
                
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Purchases"" WHERE ""TenantId"" = {tenantId}");
                
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""PurchaseReturns"" WHERE ""TenantId"" = {tenantId}");
                
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Customers"" WHERE ""TenantId"" = {tenantId}");
                
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Products"" WHERE ""TenantId"" = {tenantId}");
                
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Branches"" WHERE ""TenantId"" = {tenantId}");
                
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Routes"" WHERE ""TenantId"" = {tenantId}");
                
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Subscriptions"" WHERE ""TenantId"" = {tenantId}");
                
                // Delete Settings by both OwnerId AND TenantId (Settings has both columns)
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Settings"" 
                       WHERE ""OwnerId"" = {tenantId} OR ""TenantId"" = {tenantId}");
                
                // 3. Delete users (SystemAdmin users have TenantId = null, so they won't be affected)
                // AUDIT-1 FIX: Remove incorrect Role != 0 check - delete all users with this TenantId
                await _context.Database.ExecuteSqlInterpolatedAsync(
                    $@"DELETE FROM ""Users"" WHERE ""TenantId"" = {tenantId}");
                
                // 4. Finally delete the tenant
                _context.Tenants.Remove(tenant);
                await _context.SaveChangesAsync();
                
                return true;
            }
            catch (Exception ex)
            {
                throw new Exception($"Failed to delete tenant {tenantId}: {ex.Message}. Inner exception: {ex.InnerException?.Message ?? "None"}", ex);
            }
        }

        private const int PLATFORM_OWNER_ID = 0;

        public async Task<TenantLimitsDto> GetTenantLimitsAsync(int tenantId)
        {
            var key = $"TENANT_LIMITS_{tenantId}";
            var setting = await _context.Settings
                .FirstOrDefaultAsync(s => s.Key == key && s.OwnerId == PLATFORM_OWNER_ID);
            if (setting == null || string.IsNullOrEmpty(setting.Value))
                return new TenantLimitsDto();
            try
            {
                return System.Text.Json.JsonSerializer.Deserialize<TenantLimitsDto>(setting.Value) ?? new TenantLimitsDto();
            }
            catch { return new TenantLimitsDto(); }
        }

        public async Task UpdateTenantLimitsAsync(int tenantId, TenantLimitsDto dto)
        {
            var key = $"TENANT_LIMITS_{tenantId}";
            var value = System.Text.Json.JsonSerializer.Serialize(new TenantLimitsDto
            {
                MaxRequestsPerMinute = dto.MaxRequestsPerMinute > 0 ? dto.MaxRequestsPerMinute : 200,
                MaxConcurrentUsers = dto.MaxConcurrentUsers > 0 ? dto.MaxConcurrentUsers : 100,
                MaxStorageMb = dto.MaxStorageMb > 0 ? dto.MaxStorageMb : 1024,
                MaxInvoicesPerMonth = dto.MaxInvoicesPerMonth > 0 ? dto.MaxInvoicesPerMonth : 1000
            });
            var existing = await _context.Settings
                .FirstOrDefaultAsync(s => s.Key == key && s.OwnerId == PLATFORM_OWNER_ID);
            var now = DateTime.UtcNow;
            if (existing != null)
            {
                existing.Value = value;
                existing.UpdatedAt = now;
            }
            else
            {
                _context.Settings.Add(new Setting { Key = key, OwnerId = PLATFORM_OWNER_ID, Value = value, CreatedAt = now, UpdatedAt = now });
            }
            await _context.SaveChangesAsync();
        }

        public async Task<DuplicateDataResultDto> DuplicateDataToTenantAsync(int targetTenantId, int sourceTenantId, IReadOnlyList<string> dataTypes)
        {
            var result = new DuplicateDataResultDto { TargetTenantId = targetTenantId, SourceTenantId = sourceTenantId };
            var targetTenant = await _context.Tenants.FindAsync(targetTenantId);
            var sourceTenant = await _context.Tenants.FindAsync(sourceTenantId);
            if (targetTenant == null) { result.Message = "Target tenant not found."; return result; }
            if (sourceTenant == null) { result.Message = "Source tenant not found."; return result; }
            if (targetTenantId == sourceTenantId) { result.Message = "Source and target tenant must be different."; return result; }

            var types = dataTypes?.Select(t => t.Trim()).Where(t => !string.IsNullOrEmpty(t)).Select(t => t.ToLowerInvariant()).ToList() ?? new List<string>();
            if (types.Count == 0) { result.Message = "Select at least one data type (Products, Settings)."; return result; }

            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                if (types.Contains("products"))
                {
                    var sourceProducts = await _context.Products
                        .Where(p => (p.TenantId == sourceTenantId || p.OwnerId == sourceTenantId))
                        .ToListAsync();
                    foreach (var p in sourceProducts)
                    {
                        _context.Products.Add(new Product
                        {
                            Sku = p.Sku,
                            NameEn = p.NameEn,
                            NameAr = p.NameAr,
                            UnitType = p.UnitType,
                            ConversionToBase = p.ConversionToBase,
                            CostPrice = p.CostPrice,
                            SellPrice = p.SellPrice,
                            StockQty = 0,
                            ReorderLevel = p.ReorderLevel,
                            OwnerId = targetTenantId,
                            TenantId = targetTenantId,
                            DescriptionEn = p.DescriptionEn,
                            DescriptionAr = p.DescriptionAr,
                            CreatedAt = DateTime.UtcNow,
                            UpdatedAt = DateTime.UtcNow
                        });
                    }
                    result.ProductsCopied = sourceProducts.Count;
                }

                if (types.Contains("settings"))
                {
                    var sourceSettings = await _context.Settings
                        .Where(s => s.OwnerId == sourceTenantId)
                        .ToListAsync();
                    var existingKeys = await _context.Settings
                        .Where(s => s.OwnerId == targetTenantId)
                        .Select(s => s.Key)
                        .ToHashSetAsync();
                    int added = 0;
                    foreach (var s in sourceSettings)
                    {
                        if (existingKeys.Contains(s.Key)) continue;
                        _context.Settings.Add(new Setting { Key = s.Key, Value = s.Value, OwnerId = targetTenantId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
                        existingKeys.Add(s.Key);
                        added++;
                    }
                    result.SettingsCopied = added;
                }

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();
                result.Success = true;
                result.Message = $"Duplicated: {result.ProductsCopied} products, {result.SettingsCopied} settings.";
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                result.Message = ex.Message;
            }

            return result;
        }

        public async Task<DuplicateDataPreviewDto> GetDuplicateDataPreviewAsync(int targetTenantId, int sourceTenantId, IReadOnlyList<string> dataTypes)
        {
            var preview = new DuplicateDataPreviewDto { TargetTenantId = targetTenantId, SourceTenantId = sourceTenantId };
            var targetTenant = await _context.Tenants.FindAsync(targetTenantId);
            var sourceTenant = await _context.Tenants.FindAsync(sourceTenantId);
            if (targetTenant != null) preview.TargetName = targetTenant.Name;
            if (sourceTenant != null) preview.SourceName = sourceTenant.Name;
            if (targetTenant == null || sourceTenant == null || targetTenantId == sourceTenantId)
                return preview;

            var types = dataTypes?.Select(t => t.Trim()).Where(t => !string.IsNullOrEmpty(t)).Select(t => t.ToLowerInvariant()).ToList() ?? new List<string>();

            if (types.Contains("products"))
            {
                preview.SourceProductsCount = await _context.Products
                    .CountAsync(p => p.TenantId == sourceTenantId || p.OwnerId == sourceTenantId);
                preview.TargetProductsCount = await _context.Products
                    .CountAsync(p => p.TenantId == targetTenantId || p.OwnerId == targetTenantId);
            }
            if (types.Contains("settings"))
            {
                preview.SourceSettingsCount = await _context.Settings.CountAsync(s => s.OwnerId == sourceTenantId);
                preview.TargetSettingsCount = await _context.Settings.CountAsync(s => s.OwnerId == targetTenantId);
            }

            return preview;
        }
    }

    public class DuplicateDataPreviewDto
    {
        public int TargetTenantId { get; set; }
        public int SourceTenantId { get; set; }
        public string? SourceName { get; set; }
        public string? TargetName { get; set; }
        public int SourceProductsCount { get; set; }
        public int TargetProductsCount { get; set; }
        public int SourceSettingsCount { get; set; }
        public int TargetSettingsCount { get; set; }
    }

    public class DuplicateDataResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public int TargetTenantId { get; set; }
        public int SourceTenantId { get; set; }
        public int ProductsCopied { get; set; }
        public int SettingsCopied { get; set; }
    }

    // DTOs
    public class PlatformDashboardDto
    {
        public int TotalTenants { get; set; }
        public int ActiveTenants { get; set; }
        public int TrialTenants { get; set; }
        public int SuspendedTenants { get; set; }
        public int ExpiredTenants { get; set; }
        public int NewTenantsThisMonth { get; set; }
        public int TotalInvoices { get; set; }
        public int TotalUsers { get; set; }
        public int TotalCustomers { get; set; }
        public int TotalProducts { get; set; }
        public decimal PlatformRevenue { get; set; }
        public decimal AvgSalesPerTenant { get; set; }
        public List<TopTenantBySalesDto> TopTenants { get; set; } = new();
        public decimal Mrr { get; set; }
        /// <summary>True when Subscriptions table has at least one row; use to show "No subscription data" instead of 0.</summary>
        public bool HasSubscriptionData { get; set; }
        public List<TrialExpiringDto> TrialsExpiringThisWeek { get; set; } = new();
        public int StorageEstimate { get; set; }
        public int EstimatedStorageUsedMb { get; set; }
        /// <summary>True when value comes from pg_database_size (PostgreSQL); false when row-based estimate.</summary>
        public bool IsRealDatabaseSize { get; set; }
        /// <summary>When estimate: formula description for tooltip (e.g. row-based formula).</summary>
        public string? StorageFormulaDescription { get; set; }
        public decimal InfraCostEstimate { get; set; }
        public decimal Margin { get; set; }
        public decimal MarginPercent { get; set; }
        public DateTime LastUpdated { get; set; }
    }

    public class TopTenantBySalesDto
    {
        public int TenantId { get; set; }
        public string TenantName { get; set; } = string.Empty;
        public decimal TotalSales { get; set; }
    }

    public class TrialExpiringDto
    {
        public int TenantId { get; set; }
        public string Name { get; set; } = string.Empty;
        public DateTime TrialEndDate { get; set; }
    }

    public class TenantDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? CompanyNameEn { get; set; }
        public string? CompanyNameAr { get; set; }
        public string Country { get; set; } = string.Empty;
        public string Currency { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public DateTime? TrialEndDate { get; set; }
        public DateTime? SuspendedAt { get; set; }
        public string? SuspensionReason { get; set; }
        public string? Email { get; set; }
        public string? Phone { get; set; }
        public string? VatNumber { get; set; }
        public string? LogoPath { get; set; }

        // Metrics
        public int UserCount { get; set; }
        public int InvoiceCount { get; set; }
        public int CustomerCount { get; set; }
        public int ProductCount { get; set; }
        public decimal TotalRevenue { get; set; }
        public DateTime? LastLogin { get; set; }
        public DateTime? LastActivity { get; set; }
        public string? PlanName { get; set; }
        public decimal Mrr { get; set; }
    }

    public class TenantDetailDto : TenantDto
    {
        public string? Address { get; set; }
        public new string? LogoPath { get; set; }
        public TenantUsageMetricsDto UsageMetrics { get; set; } = new();
        public List<TenantUserDto> Users { get; set; } = new();
        public SubscriptionDto? Subscription { get; set; }
    }

    public class TenantUsageMetricsDto
    {
        public int InvoiceCount { get; set; }
        public int CustomerCount { get; set; }
        public int ProductCount { get; set; }
        public int UserCount { get; set; }
        public int PurchaseCount { get; set; }
        public int ExpenseCount { get; set; }
        public decimal TotalRevenue { get; set; }
        public decimal TotalPurchases { get; set; }
        public decimal TotalExpenses { get; set; }
        public decimal TotalOutstanding { get; set; }
        public int StorageEstimate { get; set; }
        public DateTime? LastActivity { get; set; }
    }

    public class TenantHealthDto
    {
        public int Score { get; set; }
        public string Level { get; set; } = "Green";
        public List<string> RiskFactors { get; set; } = new();
        /// <summary>Human-readable explanation of how the score is computed (for tooltip/breakdown in UI).</summary>
        public string? ScoreDescription { get; set; }
    }

    public class TenantCostDto
    {
        public int EstimatedDbSizeMb { get; set; }
        public int EstimatedStorageMb { get; set; }
        public int ApiRequestsEstimate { get; set; }
        public decimal InfraCostEstimate { get; set; }
        public decimal Revenue { get; set; }
        public decimal Margin { get; set; }
    }

    public class TenantUserDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
    }

    public class CreateTenantRequest
    {
        public string Name { get; set; } = string.Empty;
        public string? CompanyNameEn { get; set; }
        public string? CompanyNameAr { get; set; }
        public string? Country { get; set; }
        public string? Currency { get; set; }
        public string? VatNumber { get; set; }
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public TenantStatus? Status { get; set; }
        public DateTime? TrialEndDate { get; set; }
        public int? TrialDays { get; set; }
        /// <summary>Optional. Frontend sends window.location.origin so credentials modal shows production login URL.</summary>
        public string? ClientAppBaseUrl { get; set; }
    }

    public class UpdateTenantRequest
    {
        public string? Name { get; set; }
        public string? CompanyNameEn { get; set; }
        public string? CompanyNameAr { get; set; }
        public string? Country { get; set; }
        public string? Currency { get; set; }
        public string? VatNumber { get; set; }
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public TenantStatus? Status { get; set; }
        public DateTime? TrialEndDate { get; set; }
    }
}
