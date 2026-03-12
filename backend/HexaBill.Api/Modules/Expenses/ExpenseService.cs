/*
Purpose: Expense service for expense tracking
Author: AI Assistant
Date: 2024
*/
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Modules.Reports;
using HexaBill.Api.Shared.Exceptions;
using HexaBill.Api.Shared.Extensions;
using HexaBill.Api.Shared.Services;

namespace HexaBill.Api.Modules.Expenses
{
    public interface IExpenseService
    {
        Task<PagedResponse<ExpenseDto>> GetExpensesAsync(int tenantId, int page = 1, int pageSize = 10, string? category = null, DateTime? fromDate = null, DateTime? toDate = null, string? groupBy = null, int? branchId = null, IReadOnlyList<int>? staffAllowedBranchIds = null);
        Task<List<ExpenseAggregateDto>> GetExpensesAggregatedAsync(int tenantId, DateTime fromDate, DateTime toDate, string groupBy = "monthly", IReadOnlyList<int>? staffAllowedBranchIds = null); // weekly, monthly, yearly
        Task<ExpenseDto?> GetExpenseByIdAsync(int id, int tenantId, IReadOnlyList<int>? staffAllowedBranchIds = null);
        Task<ExpenseDto> CreateExpenseAsync(CreateExpenseRequest request, int userId, int tenantId, IReadOnlyList<int>? staffAllowedBranchIds = null, IReadOnlyList<int>? staffAllowedRouteIds = null);
        Task<ExpenseDto?> UpdateExpenseAsync(int id, CreateExpenseRequest request, int userId, int tenantId, IReadOnlyList<int>? staffAllowedBranchIds = null, IReadOnlyList<int>? staffAllowedRouteIds = null);
        Task<bool> DeleteExpenseAsync(int id, int userId, int tenantId);
        Task<List<string>> GetExpenseCategoriesAsync(int tenantId);
        Task<BulkVatUpdateResult> BulkVatUpdateAsync(int tenantId, BulkVatUpdateRequest request);
        Task<BulkVatUpdateResult> BulkSetClaimableAsync(int tenantId, BulkSetClaimableRequest request);
    }

    public class ExpenseService : IExpenseService
    {
        private readonly AppDbContext _context;
        private readonly IVatReturnValidationService _vatValidation;
        private readonly ILogger<ExpenseService> _logger;

        public ExpenseService(AppDbContext context, IVatReturnValidationService vatValidation, ILogger<ExpenseService> logger)
        {
            _context = context;
            _vatValidation = vatValidation;
            _logger = logger;
        }

        public async Task<PagedResponse<ExpenseDto>> GetExpensesAsync(int tenantId, int page = 1, int pageSize = 10, string? category = null, DateTime? fromDate = null, DateTime? toDate = null, string? groupBy = null, int? branchId = null, IReadOnlyList<int>? staffAllowedBranchIds = null)
        {
            // OPTIMIZATION: Use AsNoTracking and limit page size
            pageSize = Math.Min(pageSize, 100); // Max 100 items per page
            
            var query = _context.Expenses
                .AsNoTracking() // Performance: No change tracking needed
                .Where(e => e.TenantId == tenantId) // CRITICAL: Multi-tenant filter
                .Include(e => e.Category)
                .Include(e => e.Branch)
                .Include(e => e.CreatedByUser)
                .AsQueryable();

            // Staff: only see expenses for their assigned branches (and expenses with no branch if any). If Staff has no branches assigned, they see nothing.
            if (staffAllowedBranchIds != null)
            {
                if (staffAllowedBranchIds.Count == 0)
                    query = query.Where(e => false);
                else
                    query = query.Where(e => e.BranchId == null || staffAllowedBranchIds.Contains(e.BranchId.Value));
            }

            if (branchId.HasValue)
            {
                query = query.Where(e => e.BranchId == branchId.Value);
            }

            if (!string.IsNullOrEmpty(category))
            {
                query = query.Where(e => e.Category.Name == category);
            }

            if (fromDate.HasValue)
            {
                query = query.Where(e => e.Date >= fromDate.Value);
            }

            if (toDate.HasValue)
            {
                query = query.Where(e => e.Date <= toDate.Value);
            }

            var totalCount = await query.CountAsync();
            var expenses = await query
                .OrderByDescending(e => e.Date)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(e => new ExpenseDto
                {
                    Id = e.Id,
                    BranchId = e.BranchId,
                    BranchName = e.Branch != null ? e.Branch.Name : null,
                    RouteId = e.RouteId,
                    RouteName = e.Route != null ? e.Route.Name : null,
                    CategoryId = e.CategoryId,
                    CategoryName = e.Category != null ? e.Category.Name : "",
                    CategoryColor = e.Category != null ? e.Category.ColorCode : "#6B7280",
                    Amount = e.Amount,
                    Date = e.Date,
                    Note = e.Note,
                    AttachmentUrl = e.AttachmentUrl,
                    Status = e.Status.ToString(),
                    RecurringExpenseId = e.RecurringExpenseId,
                    ApprovedBy = e.ApprovedBy,
                    ApprovedAt = e.ApprovedAt,
                    RejectionReason = e.RejectionReason,
                    CreatedByName = e.CreatedByUser != null ? e.CreatedByUser.Name : "",
                    VatAmount = e.VatAmount,
                    TotalAmount = e.TotalAmount,
                    TaxType = e.TaxType,
                    IsTaxClaimable = e.IsTaxClaimable,
                    IsEntertainment = e.IsEntertainment,
                    PartialCreditPct = e.PartialCreditPct,
                    ClaimableVat = e.ClaimableVat,
                    VatRate = e.VatRate,
                    VatInclusive = e.VatInclusive
                })
                .ToListAsync();

            return new PagedResponse<ExpenseDto>
            {
                Items = expenses,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
            };
        }

        public async Task<List<ExpenseAggregateDto>> GetExpensesAggregatedAsync(int tenantId, DateTime fromDate, DateTime toDate, string groupBy = "monthly", IReadOnlyList<int>? staffAllowedBranchIds = null)
        {
            try
            {
                // Ensure dates are properly set (start of day to end of day)
                // CRITICAL FIX: Never use .Date property, it creates Unspecified
                var from = new DateTime(fromDate.Year, fromDate.Month, fromDate.Day, 0, 0, 0, DateTimeKind.Utc);
                var to = toDate.AddDays(1).AddTicks(-1).ToUtcKind(); // End of day - FIX: Don't use .Date
                
                _logger.LogDebug("GetExpensesAggregatedAsync: tenantId={TenantId}, fromDate={From}, toDate={To}, groupBy={GroupBy}", tenantId, from, to, groupBy);
                
                var query = _context.Expenses
                    .Include(e => e.Category)
                    .Where(e => e.TenantId == tenantId && e.Date >= from && e.Date <= to) // CRITICAL: Multi-tenant filter
                    .AsQueryable();

                if (staffAllowedBranchIds != null)
                {
                    if (staffAllowedBranchIds.Count == 0)
                        query = query.Where(e => false);
                    else
                        query = query.Where(e => e.BranchId == null || staffAllowedBranchIds.Contains(e.BranchId.Value));
                }

                // Check if there are any expenses
                var expenseCount = await query.CountAsync();
                _logger.LogDebug("Found {Count} expenses in date range", expenseCount);
                
                if (expenseCount == 0)
                {
                    _logger.LogDebug("No expenses found in date range, returning empty list");
                    return new List<ExpenseAggregateDto>();
                }

                List<ExpenseAggregateDto> aggregates;

                if (groupBy?.ToLower() == "weekly")
                {
                    // Group by week - load all data first to avoid nested GroupBy issues
                    var allExpenses = await query.ToListAsync();
                    aggregates = allExpenses
                        .GroupBy(e => {
                            var date = e.Date;
                            var startOfYear = new DateTime(date.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                            var daysSinceStart = (date - startOfYear).Days;
                            var weekNumber = (daysSinceStart / 7) + 1;
                            return new { Year = date.Year, Week = weekNumber };
                        })
                        .Select(g => {
                            var expensesInGroup = g.ToList();
                            var categoryGroups = expensesInGroup
                                .GroupBy(e => e.Category?.Name ?? "Uncategorized")
                                .ToList();
                            
                            return new ExpenseAggregateDto
                            {
                                Period = $"Week {g.Key.Week}, {g.Key.Year}",
                                PeriodStart = expensesInGroup.Min(e => e.Date),
                                PeriodEnd = expensesInGroup.Max(e => e.Date),
                                TotalAmount = expensesInGroup.Sum(e => e.Amount),
                                Count = expensesInGroup.Count,
                                ByCategory = categoryGroups.Select(cg => new ExpenseCategoryTotalDto
                                {
                                    CategoryName = cg.Key,
                                    TotalAmount = cg.Sum(e => e.Amount),
                                    Count = cg.Count()
                                }).ToList()
                            };
                        })
                        .OrderBy(a => a.PeriodStart)
                        .ToList();
                }
                else if (groupBy?.ToLower() == "yearly")
                {
                    // Group by year - load all data first
                    var allExpenses = await query.ToListAsync();
                    aggregates = allExpenses
                        .GroupBy(e => e.Date.Year)
                        .Select(g => {
                            var expensesInGroup = g.ToList();
                            var categoryGroups = expensesInGroup
                                .GroupBy(e => e.Category?.Name ?? "Uncategorized")
                                .ToList();
                            
                            return new ExpenseAggregateDto
                            {
                                Period = g.Key.ToString(),
                                PeriodStart = new DateTime(g.Key, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                                PeriodEnd = new DateTime(g.Key, 12, 31, 23, 59, 59, DateTimeKind.Utc),
                                TotalAmount = expensesInGroup.Sum(e => e.Amount),
                                Count = expensesInGroup.Count,
                                ByCategory = categoryGroups.Select(cg => new ExpenseCategoryTotalDto
                                {
                                    CategoryName = cg.Key,
                                    TotalAmount = cg.Sum(e => e.Amount),
                                    Count = cg.Count()
                                }).ToList()
                            };
                        })
                        .OrderBy(a => a.PeriodStart)
                        .ToList();
                }
                else
                {
                    // Default: Group by month - load all data first
                    var allExpenses = await query.ToListAsync();
                    aggregates = allExpenses
                        .GroupBy(e => new { e.Date.Year, e.Date.Month })
                        .Select(g => {
                            var expensesInGroup = g.ToList();
                            var categoryGroups = expensesInGroup
                                .GroupBy(e => e.Category?.Name ?? "Uncategorized")
                                .ToList();
                            
                            return new ExpenseAggregateDto
                            {
                                Period = $"{new DateTime(g.Key.Year, g.Key.Month, 1, 0, 0, 0, DateTimeKind.Utc):MMMM yyyy}",
                                PeriodStart = new DateTime(g.Key.Year, g.Key.Month, 1, 0, 0, 0, DateTimeKind.Utc),
                                PeriodEnd = new DateTime(g.Key.Year, g.Key.Month, DateTime.DaysInMonth(g.Key.Year, g.Key.Month), 23, 59, 59, DateTimeKind.Utc),
                                TotalAmount = expensesInGroup.Sum(e => e.Amount),
                                Count = expensesInGroup.Count,
                                ByCategory = categoryGroups.Select(cg => new ExpenseCategoryTotalDto
                                {
                                    CategoryName = cg.Key,
                                    TotalAmount = cg.Sum(e => e.Amount),
                                    Count = cg.Count()
                                }).ToList()
                            };
                        })
                        .OrderBy(a => a.PeriodStart)
                        .ToList();
                }

                return aggregates;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in GetExpensesAggregatedAsync: {Message}", ex.Message);
                _logger.LogError("Stack trace: {StackTrace}", ex.StackTrace);
                throw;
            }
        }

        public async Task<ExpenseDto?> GetExpenseByIdAsync(int id, int tenantId, IReadOnlyList<int>? staffAllowedBranchIds = null)
        {
            var expense = await _context.Expenses
                .Where(e => e.Id == id && e.TenantId == tenantId) // CRITICAL: Multi-tenant filter
                .Include(e => e.Category)
                .Include(e => e.Branch)
                .Include(e => e.Route)
                .Include(e => e.CreatedByUser)
                .FirstOrDefaultAsync();
            if (expense == null) return null;
            if (staffAllowedBranchIds != null)
            {
                if (staffAllowedBranchIds.Count == 0) return null;
                if (expense.BranchId.HasValue && !staffAllowedBranchIds.Contains(expense.BranchId.Value)) return null;
            }

            return new ExpenseDto
            {
                Id = expense.Id,
                BranchId = expense.BranchId,
                BranchName = expense.Branch?.Name,
                RouteId = expense.RouteId,
                RouteName = expense.Route?.Name,
                CategoryId = expense.CategoryId,
                CategoryName = expense.Category.Name,
                CategoryColor = expense.Category.ColorCode,
                Amount = expense.Amount,
                Date = expense.Date,
                Note = expense.Note,
                AttachmentUrl = expense.AttachmentUrl,
                Status = expense.Status.ToString(),
                RecurringExpenseId = expense.RecurringExpenseId,
                ApprovedBy = expense.ApprovedBy,
                ApprovedAt = expense.ApprovedAt,
                RejectionReason = expense.RejectionReason,
                CreatedByName = expense.CreatedByUser?.Name ?? "",
                VatAmount = expense.VatAmount,
                TotalAmount = expense.TotalAmount,
                TaxType = expense.TaxType,
                IsTaxClaimable = expense.IsTaxClaimable,
                IsEntertainment = expense.IsEntertainment,
                PartialCreditPct = expense.PartialCreditPct,
                ClaimableVat = expense.ClaimableVat,
                VatRate = expense.VatRate,
                VatInclusive = expense.VatInclusive
            };
        }

        public async Task<ExpenseDto> CreateExpenseAsync(CreateExpenseRequest request, int userId, int tenantId, IReadOnlyList<int>? staffAllowedBranchIds = null, IReadOnlyList<int>? staffAllowedRouteIds = null)
        {
            // NpgsqlRetryingExecutionStrategy does not support user-initiated transactions unless wrapped in CreateExecutionStrategy
            return await _context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    if (staffAllowedBranchIds != null)
                    {
                        if (staffAllowedBranchIds.Count == 0)
                            throw new InvalidOperationException("You have no branch assigned. Ask an admin to assign you to a branch before adding expenses.");
                        if (request.BranchId.HasValue && !staffAllowedBranchIds.Contains(request.BranchId.Value))
                            throw new InvalidOperationException("You can only add expenses to your assigned branch(es).");
                    }
                    if (staffAllowedRouteIds != null && request.RouteId.HasValue)
                    {
                        if (staffAllowedRouteIds.Count == 0 || !staffAllowedRouteIds.Contains(request.RouteId.Value))
                            throw new InvalidOperationException("You can only add expenses to your assigned route(s).");
                    }

                    var category = await _context.ExpenseCategories
                        .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.TenantId == tenantId);
                    if (category == null)
                    {
                        throw new InvalidOperationException($"Category with ID {request.CategoryId} not found");
                    }

                    if (await _vatValidation.IsTransactionDateInLockedPeriodAsync(tenantId, request.Date))
                        throw new VatPeriodLockedException("VAT return period is locked for this date. You cannot add or edit transactions in a locked period.");

                    // Determine status: Staff expenses are Pending, Owner/Admin are Approved
                    var isStaff = staffAllowedBranchIds != null;
                    var expenseStatus = isStaff ? ExpenseStatus.Pending : ExpenseStatus.Approved;

                    // Category VAT defaults: when VatDefaultLocked, use category defaults; otherwise use request
                    bool withVat; string taxType; bool isClaimable; bool isEnt; decimal partialPct;
                    if (category.VatDefaultLocked)
                    {
                        withVat = category.DefaultVatRate > 0;
                        taxType = category.DefaultTaxType ?? "Standard";
                        isClaimable = category.DefaultIsTaxClaimable;
                        isEnt = category.DefaultIsEntertainment;
                        partialPct = 100m;
                    }
                    else
                    {
                        withVat = request.WithVat;
                        taxType = request.TaxType ?? "Standard";
                        isClaimable = request.IsTaxClaimable;
                        isEnt = request.IsEntertainment;
                        partialPct = request.PartialCreditPct;
                    }
                    var isInclusive = request.VatInclusive == true;
                    var vatResult = withVat && !string.Equals(taxType, TaxTypes.Petroleum, StringComparison.OrdinalIgnoreCase)
                        ? (isInclusive
                            ? VatCalculator.ForExpenseInclusive(request.Amount, taxType, isClaimable, isEnt, partialPct)
                            : VatCalculator.ForExpense(request.Amount, taxType, isClaimable, isEnt, partialPct))
                        : null;
                    var expense = new Expense
                    {
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        BranchId = request.BranchId,
                        RouteId = request.RouteId,
                        CategoryId = request.CategoryId,
                        Amount = vatResult != null && isInclusive ? vatResult.NetAmount : request.Amount,
                        Date = request.Date.ToUtcKind(),
                        Note = request.Note,
                        AttachmentUrl = request.AttachmentUrl,
                        Status = expenseStatus,
                        RecurringExpenseId = request.RecurringExpenseId,
                        CreatedBy = userId,
                        CreatedAt = DateTime.UtcNow,
                        VatRate = vatResult?.VatRate,
                        VatAmount = vatResult?.VatAmount,
                        TotalAmount = vatResult != null ? vatResult.TotalAmount : (decimal?)null,
                        IsTaxClaimable = isClaimable,
                        TaxType = taxType,
                        IsEntertainment = isEnt,
                        PartialCreditPct = partialPct,
                        ClaimableVat = vatResult?.ClaimableVat,
                        VatInclusive = request.VatInclusive
                    };

                    // Auto-approve if owner/admin
                    if (!isStaff)
                    {
                        expense.ApprovedBy = userId;
                        expense.ApprovedAt = DateTime.UtcNow;
                    }

                    _context.Expenses.Add(expense);
                    await _context.SaveChangesAsync();

                    // Create audit log
                    var auditLog = new AuditLog
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        UserId = userId,
                        Action = "Expense Created",
                        Details = $"Category: {category.Name}, Amount: {request.Amount:C}",
                        CreatedAt = DateTime.UtcNow
                    };

                    _context.AuditLogs.Add(auditLog);
                    await _context.SaveChangesAsync();
                    await transaction.CommitAsync();

                    await _context.Entry(expense).Reference(e => e.Category).LoadAsync();
                    await _context.Entry(expense).Reference(e => e.CreatedByUser).LoadAsync();

                    return new ExpenseDto
                    {
                        Id = expense.Id,
                        BranchId = expense.BranchId,
                        BranchName = null,
                        RouteId = expense.RouteId,
                        RouteName = null,
                        CategoryId = expense.CategoryId,
                        CategoryName = expense.Category.Name,
                        CategoryColor = expense.Category.ColorCode,
                        Amount = expense.Amount,
                        Date = expense.Date,
                        Note = expense.Note,
                        AttachmentUrl = expense.AttachmentUrl,
                        Status = expense.Status.ToString(),
                        RecurringExpenseId = expense.RecurringExpenseId,
                        ApprovedBy = expense.ApprovedBy,
                        ApprovedAt = expense.ApprovedAt,
                        RejectionReason = expense.RejectionReason,
                        CreatedByName = expense.CreatedByUser?.Name ?? "",
                        VatAmount = expense.VatAmount,
                        TotalAmount = expense.TotalAmount,
                        TaxType = expense.TaxType,
                        IsTaxClaimable = expense.IsTaxClaimable,
                        IsEntertainment = expense.IsEntertainment,
                        PartialCreditPct = expense.PartialCreditPct,
                        ClaimableVat = expense.ClaimableVat,
                        VatRate = expense.VatRate,
                        VatInclusive = expense.VatInclusive
                    };
                }
                catch (Exception ex)
                {
                    await transaction.RollbackAsync();
                    _logger.LogError(ex, "Error creating expense: {Message}", ex.Message);
                    throw;
                }
            });
        }

        public async Task<ExpenseDto?> UpdateExpenseAsync(int id, CreateExpenseRequest request, int userId, int tenantId, IReadOnlyList<int>? staffAllowedBranchIds = null, IReadOnlyList<int>? staffAllowedRouteIds = null)
        {
            return await _context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    var expense = await _context.Expenses
                    .Where(e => e.Id == id && e.TenantId == tenantId) // CRITICAL: Multi-tenant filter
                    .Include(e => e.Category)
                    .Include(e => e.Branch)
                    .Include(e => e.Route)
                    .FirstOrDefaultAsync();
                    if (expense == null)
                    {
                        await transaction.RollbackAsync();
                        return null;
                    }
                    if (staffAllowedBranchIds != null)
                    {
                        if (staffAllowedBranchIds.Count == 0) return null;
                        if (expense.BranchId.HasValue && !staffAllowedBranchIds.Contains(expense.BranchId.Value))
                            return null;
                        if (request.BranchId.HasValue && !staffAllowedBranchIds.Contains(request.BranchId.Value))
                            throw new InvalidOperationException("You can only assign expenses to your assigned branch(es).");
                    }
                    if (staffAllowedRouteIds != null && request.RouteId.HasValue)
                    {
                        if (staffAllowedRouteIds.Count == 0 || !staffAllowedRouteIds.Contains(request.RouteId.Value))
                            throw new InvalidOperationException("You can only assign expenses to your assigned route(s).");
                    }

                    var category = await _context.ExpenseCategories
                        .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.TenantId == tenantId);
                    if (category == null)
                    {
                        throw new InvalidOperationException($"Category with ID {request.CategoryId} not found");
                    }

                    if (await _vatValidation.IsTransactionDateInLockedPeriodAsync(tenantId, request.Date))
                        throw new VatPeriodLockedException("VAT return period is locked for this date. You cannot add or edit transactions in a locked period.");

                    expense.BranchId = request.BranchId;
                    expense.RouteId = request.RouteId;
                    expense.CategoryId = request.CategoryId;
                    expense.Amount = request.Amount;
                    expense.Date = request.Date.ToUtcKind();
                    expense.Note = request.Note;
                    expense.AttachmentUrl = request.AttachmentUrl;
                    expense.RecurringExpenseId = request.RecurringExpenseId;
                    bool withVat; string taxType; bool isClaimable; bool isEnt; decimal partialPct;
                    if (category.VatDefaultLocked)
                    {
                        withVat = category.DefaultVatRate > 0;
                        taxType = category.DefaultTaxType ?? "Standard";
                        isClaimable = category.DefaultIsTaxClaimable;
                        isEnt = category.DefaultIsEntertainment;
                        partialPct = 100m;
                    }
                    else
                    {
                        withVat = request.WithVat;
                        taxType = request.TaxType ?? "Standard";
                        isClaimable = request.IsTaxClaimable;
                        isEnt = request.IsEntertainment;
                        partialPct = request.PartialCreditPct;
                    }
                    var isInclusive = request.VatInclusive == true;
                    var vatResult = withVat && !string.Equals(taxType, TaxTypes.Petroleum, StringComparison.OrdinalIgnoreCase)
                        ? (isInclusive
                            ? VatCalculator.ForExpenseInclusive(request.Amount, taxType, isClaimable, isEnt, partialPct)
                            : VatCalculator.ForExpense(request.Amount, taxType, isClaimable, isEnt, partialPct))
                        : null;
                    expense.Amount = vatResult != null && isInclusive ? vatResult.NetAmount : request.Amount;
                    expense.VatRate = vatResult?.VatRate;
                    expense.VatAmount = vatResult?.VatAmount;
                    expense.TotalAmount = vatResult != null ? vatResult.TotalAmount : (decimal?)null;
                    expense.IsTaxClaimable = isClaimable;
                    expense.TaxType = taxType;
                    expense.IsEntertainment = isEnt;
                    expense.PartialCreditPct = partialPct;
                    expense.ClaimableVat = vatResult?.ClaimableVat;
                    expense.VatInclusive = request.VatInclusive;

                    await _context.SaveChangesAsync();

                    var auditLog = new AuditLog
                    {
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        UserId = userId,
                        Action = "Expense Updated",
                        Details = $"Expense ID: {id}, Category: {category.Name}, Amount: {request.Amount:C}",
                        CreatedAt = DateTime.UtcNow
                    };

                    _context.AuditLogs.Add(auditLog);
                    await _context.SaveChangesAsync();
                    await transaction.CommitAsync();

                    await _context.Entry(expense).Reference(e => e.Category).LoadAsync();
                    await _context.Entry(expense).Reference(e => e.Branch).LoadAsync();
                    await _context.Entry(expense).Reference(e => e.Route).LoadAsync();
                    await _context.Entry(expense).Reference(e => e.CreatedByUser).LoadAsync();

                    return new ExpenseDto
                    {
                        Id = expense.Id,
                        BranchId = expense.BranchId,
                        BranchName = expense.Branch?.Name,
                        RouteId = expense.RouteId,
                        RouteName = expense.Route?.Name,
                        CategoryId = expense.CategoryId,
                        CategoryName = expense.Category.Name,
                        CategoryColor = expense.Category.ColorCode,
                        Amount = expense.Amount,
                        Date = expense.Date,
                        Note = expense.Note,
                        AttachmentUrl = expense.AttachmentUrl,
                        Status = expense.Status.ToString(),
                        RecurringExpenseId = expense.RecurringExpenseId,
                        ApprovedBy = expense.ApprovedBy,
                        ApprovedAt = expense.ApprovedAt,
                        RejectionReason = expense.RejectionReason,
                        CreatedByName = expense.CreatedByUser?.Name ?? "",
                        VatAmount = expense.VatAmount,
                        TotalAmount = expense.TotalAmount,
                        TaxType = expense.TaxType,
                        IsTaxClaimable = expense.IsTaxClaimable,
                        IsEntertainment = expense.IsEntertainment,
                        PartialCreditPct = expense.PartialCreditPct,
                        ClaimableVat = expense.ClaimableVat,
                        VatRate = expense.VatRate,
                        VatInclusive = expense.VatInclusive
                    };
                }
                catch (Exception ex)
                {
                    await transaction.RollbackAsync();
                    _logger.LogError(ex, "Error updating expense: {Message}", ex.Message);
                    throw;
                }
            });
        }

        public async Task<bool> DeleteExpenseAsync(int id, int userId, int tenantId)
        {
            return await _context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    var expense = await _context.Expenses
                        .Where(e => e.Id == id && e.TenantId == tenantId)
                        .Include(e => e.Category)
                        .FirstOrDefaultAsync();
                    if (expense == null)
                    {
                        await transaction.RollbackAsync();
                        return false;
                    }

                    if (await _vatValidation.IsTransactionDateInLockedPeriodAsync(tenantId, expense.Date))
                        throw new VatPeriodLockedException("VAT return period is locked for this date. You cannot delete transactions in a locked period.");

                    var categoryName = expense.Category.Name;
                    var amount = expense.Amount;

                    _context.Expenses.Remove(expense);
                    await _context.SaveChangesAsync();

                    var auditLog = new AuditLog
                    {
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        UserId = userId,
                        Action = "Expense Deleted",
                        Details = $"Expense ID: {id}, Category: {categoryName}, Amount: {amount:C}",
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
                    _logger.LogError(ex, "Error deleting expense: {Message}", ex.Message);
                    throw;
                }
            });
        }

        public async Task<List<string>> GetExpenseCategoriesAsync(int tenantId)
        {
            return await _context.ExpenseCategories
                .Where(c => c.TenantId == tenantId && c.IsActive)
                .OrderBy(c => c.Name)
                .Select(c => c.Name)
                .ToListAsync();
        }

        public async Task<BulkVatUpdateResult> BulkVatUpdateAsync(int tenantId, BulkVatUpdateRequest request)
        {
            var result = new BulkVatUpdateResult();
            IQueryable<Expense> query = _context.Expenses
                .Where(e => e.TenantId == tenantId && e.VatRate == null);

            if (request.ExpenseIds != null && request.ExpenseIds.Count > 0)
                query = query.Where(e => request.ExpenseIds.Contains(e.Id));
            else if (request.CategoryId.HasValue)
                query = query.Where(e => e.CategoryId == request.CategoryId.Value);
            else if (!request.AllNoVat)
                return result;

            var expenses = await query.ToListAsync();
            var interpretation = request.Interpretation?.Trim().ToLowerInvariant() ?? "add-on-top";
            var vatRate = request.VatRate;
            var taxType = request.TaxType ?? "Standard";
            var isClaimable = request.IsTaxClaimable;
            var isEnt = request.IsEntertainment;

            foreach (var expense in expenses)
            {
                try
                {
                    if (await _vatValidation.IsTransactionDateInLockedPeriodAsync(tenantId, expense.Date))
                    {
                        result.Skipped++;
                        result.Errors.Add($"Expense ID {expense.Id}: period locked");
                        continue;
                    }
                    decimal netAmount;
                    decimal vatAmount;
                    decimal totalAmount;
                    bool extract = string.Equals(interpretation, "extract-from-amount", StringComparison.OrdinalIgnoreCase);
                    if (extract)
                    {
                        totalAmount = expense.Amount;
                        netAmount = Math.Round(expense.Amount / (1 + vatRate), 2, MidpointRounding.AwayFromZero);
                        vatAmount = totalAmount - netAmount;
                        expense.Amount = netAmount;
                        expense.VatRate = vatRate;
                        expense.VatAmount = vatAmount;
                        expense.TotalAmount = totalAmount;
                        expense.IsTaxClaimable = isClaimable;
                        expense.TaxType = taxType;
                        expense.IsEntertainment = isEnt;
                        expense.ClaimableVat = isClaimable ? (isEnt ? Math.Round(vatAmount * 0.5m, 2) : vatAmount) : 0;
                    }
                    else
                    {
                        netAmount = expense.Amount;
                        var vatResult = !string.Equals(taxType, TaxTypes.Petroleum, StringComparison.OrdinalIgnoreCase)
                            ? VatCalculator.ForExpense(netAmount, taxType, isClaimable, isEnt, 100m)
                            : null;
                        if (vatResult != null)
                        {
                            expense.VatRate = vatResult.VatRate;
                            expense.VatAmount = vatResult.VatAmount;
                            expense.TotalAmount = vatResult.TotalAmount;
                            expense.IsTaxClaimable = isClaimable;
                            expense.TaxType = taxType;
                            expense.IsEntertainment = isEnt;
                            expense.ClaimableVat = vatResult.ClaimableVat;
                        }
                        else
                        {
                            expense.VatRate = 0;
                            expense.VatAmount = 0;
                            expense.TotalAmount = expense.Amount;
                            expense.IsTaxClaimable = false;
                            expense.TaxType = taxType;
                            expense.IsEntertainment = isEnt;
                            expense.ClaimableVat = 0;
                        }
                    }
                    result.Updated++;
                }
                catch (Exception ex)
                {
                    result.Skipped++;
                    result.Errors.Add($"Expense ID {expense.Id}: {ex.Message}");
                }
            }
            await _context.SaveChangesAsync();
            return result;
        }

        public async Task<BulkVatUpdateResult> BulkSetClaimableAsync(int tenantId, BulkSetClaimableRequest request)
        {
            var result = new BulkVatUpdateResult();
            if (request?.ExpenseIds == null || request.ExpenseIds.Count == 0)
                return result;

            var expenses = await _context.Expenses
                .Where(e => e.TenantId == tenantId && request.ExpenseIds.Contains(e.Id))
                .ToListAsync();

            var isClaimable = request.IsTaxClaimable;

            foreach (var expense in expenses)
            {
                try
                {
                    if (await _vatValidation.IsTransactionDateInLockedPeriodAsync(tenantId, expense.Date))
                    {
                        result.Skipped++;
                        result.Errors.Add($"Expense ID {expense.Id}: period locked");
                        continue;
                    }
                    expense.IsTaxClaimable = isClaimable;
                    expense.ClaimableVat = isClaimable && (expense.VatAmount ?? 0) > 0
                        ? (expense.IsEntertainment ? Math.Round((expense.VatAmount ?? 0) * 0.5m, 2) : (expense.VatAmount ?? 0))
                        : 0;
                    result.Updated++;
                }
                catch (Exception ex)
                {
                    result.Skipped++;
                    result.Errors.Add($"Expense ID {expense.Id}: {ex.Message}");
                }
            }

            await _context.SaveChangesAsync();
            return result;
        }
    }
}

