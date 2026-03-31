/*
Purpose: Customer service for customer management
Author: AI Assistant
Date: 2024
*/
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Modules.Billing;
using HexaBill.Api.Shared.Extensions;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace HexaBill.Api.Modules.Customers
{
    public interface ICustomerService
    {
        // MULTI-TENANT: All methods now require tenantId for data isolation
        Task<PagedResponse<CustomerDto>> GetCustomersAsync(int tenantId, int page = 1, int pageSize = 10, string? search = null, int? branchId = null, int? routeId = null, IReadOnlyList<int>? restrictToBranchIds = null, IReadOnlyList<int>? restrictToRouteIds = null);
        Task<CustomerDto?> GetCustomerByIdAsync(int id, int tenantId);
        Task<CustomerDto> CreateCustomerAsync(CreateCustomerRequest request, int tenantId);
        Task<CustomerDto?> UpdateCustomerAsync(int id, CreateCustomerRequest request, int tenantId);
        Task<(bool Success, string Message)> DeleteCustomerAsync(int id, int tenantId);
        Task<(bool Success, string Message, DeleteCustomerSummary? Summary)> ForceDeleteCustomerWithAllDataAsync(int customerId, int userId, int tenantId);
        Task<List<CustomerLedgerEntry>> GetCustomerLedgerAsync(int customerId, int tenantId, int? branchId = null, int? routeId = null, int? staffId = null, DateTime? fromDate = null, DateTime? toDate = null);
        Task<List<CustomerLedgerEntry>> GetCashCustomerLedgerAsync(int tenantId);
        Task<byte[]> GenerateCustomerStatementAsync(int customerId, DateTime fromDate, DateTime toDate, int tenantId);
        Task<List<CustomerDto>> SearchCustomersAsync(string query, int tenantId, int limit = 20);
        Task RecalculateCustomerBalanceAsync(int customerId, int tenantId);
        Task RecalculateAllCustomerBalancesAsync(int tenantId);
        Task<List<Models.OutstandingInvoiceDto>> GetOutstandingInvoicesAsync(int customerId, int tenantId);
        Task<int> RecalculateCustomerInvoiceStatusesAsync(int customerId, int tenantId);
        Task<int> RecalculateCashCustomerInvoiceStatusesAsync(int tenantId);
    }

    /// <summary>Minimal sale data for statement PDF; avoids selecting BranchId/RouteId when they don't exist in DB.</summary>
    internal class StatementSaleRow
    {
        public int Id { get; set; }
        public DateTime InvoiceDate { get; set; }
        public string? InvoiceNo { get; set; }
        public decimal GrandTotal { get; set; }
    }

    public class CustomerService : ICustomerService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<CustomerService> _logger;

        // Cache BranchId column check result to avoid repeated database queries
        private static bool? _cachedHasBranchIdColumn = null;
        private static DateTime? _cacheTimestamp = null;
        private static readonly TimeSpan CacheExpiry = TimeSpan.FromMinutes(30); // Refresh cache every 30 minutes
        private static readonly object _cacheLock = new object();

        public CustomerService(AppDbContext context, ILogger<CustomerService> logger)
        {
            _context = context;
            _logger = logger;
            QuestPDF.Settings.License = LicenseType.Community;
        }

        // Backwards-compatible constructor for existing manual instantiations
        public CustomerService(AppDbContext context) : this(context, NullLogger<CustomerService>.Instance)
        {
        }
        
        /// <summary>
        /// Check if BranchId column exists in Sales table (cached result)
        /// </summary>
        private async Task<bool> CheckBranchIdColumnExistsAsync()
        {
            lock (_cacheLock)
            {
                // Return cached result if still valid
                if (_cachedHasBranchIdColumn.HasValue && _cacheTimestamp.HasValue)
                {
                    var cacheAge = DateTime.UtcNow - _cacheTimestamp.Value;
                    if (cacheAge < CacheExpiry)
                    {
                        return _cachedHasBranchIdColumn.Value;
                    }
                }
            }
            
            // Cache expired or not set - check database
            bool hasColumn = false;
            if (_context.Database.IsNpgsql())
            {
                try
                {
                    var connection = _context.Database.GetDbConnection();
                    var wasOpen = connection.State == System.Data.ConnectionState.Open;
                    if (!wasOpen) await connection.OpenAsync();
                    
                    try
                    {
                        using var checkCmd = connection.CreateCommand();
                        checkCmd.CommandText = @"
                            SELECT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_schema = 'public' 
                                AND table_name = 'Sales' 
                                AND column_name = 'BranchId'
                            )";
                        using (var checkReader = await checkCmd.ExecuteReaderAsync())
                        {
                            if (await checkReader.ReadAsync())
                            {
                                hasColumn = checkReader.GetBoolean(0);
                            }
                        }
                    }
                    finally
                    {
                        if (!wasOpen) await connection.CloseAsync();
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not check BranchId column existence when loading customers");
                    // Default to false (safer - skip filters) if check fails
                    hasColumn = false;
                }
            }
            else
            {
                // For non-PostgreSQL databases, assume column exists
                hasColumn = true;
            }
            
            // Update cache
            lock (_cacheLock)
            {
                _cachedHasBranchIdColumn = hasColumn;
                _cacheTimestamp = DateTime.UtcNow;
            }
            
            return hasColumn;
        }

        /// <summary>True if the exception indicates a missing column (SQLite or PostgreSQL 42703). Used in exception filters for schema fallback.</summary>
        private static bool IsMissingColumnException(Exception ex)
        {
            if (ex == null) return false;
            if (ex is Microsoft.Data.Sqlite.SqliteException sqlEx && (sqlEx.Message?.Contains("no such column", StringComparison.OrdinalIgnoreCase) == true))
                return true;
            if (ex is Npgsql.PostgresException pgEx && (pgEx.SqlState == "42703" || (pgEx.Message?.Contains("column", StringComparison.OrdinalIgnoreCase) == true)))
                return true;
            return false;
        }

        /// <summary>True if the exception (or inner) is PostgreSQL 42703 undefined_column. Handles wrapped exceptions and message-based detection.</summary>
        private static bool Is42703(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                if (e is Npgsql.PostgresException pg && pg.SqlState == "42703") return true;
                var msg = e.Message ?? "";
                if (msg.Contains("42703", StringComparison.Ordinal) || (msg.Contains("column", StringComparison.OrdinalIgnoreCase) && msg.Contains("does not exist", StringComparison.OrdinalIgnoreCase)))
                    return true;
            }
            return false;
        }

        /// <summary>Raw SQL for statement opening sales sum when Sales.BranchId does not exist (42703). Selects only GrandTotal.</summary>
        private async Task<decimal> GetStatementOpeningSalesRawAsync(int customerId, int tenantId, DateTime fromDate)
        {
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"SELECT COALESCE(SUM(""GrandTotal""), 0) FROM ""Sales"" WHERE ""CustomerId"" = @p0 AND ""TenantId"" = @p1 AND ""IsDeleted"" = false AND ""InvoiceDate"" < @p2";
                var p0 = cmd.CreateParameter(); p0.ParameterName = "p0"; p0.Value = customerId; cmd.Parameters.Add(p0);
                var p1 = cmd.CreateParameter(); p1.ParameterName = "p1"; p1.Value = tenantId; cmd.Parameters.Add(p1);
                var p2 = cmd.CreateParameter(); p2.ParameterName = "p2"; p2.Value = fromDate; cmd.Parameters.Add(p2);
                var result = await cmd.ExecuteScalarAsync();
                return result is decimal d ? d : (result is double dbl ? (decimal)dbl : 0m);
            }
            finally { if (!wasOpen) await conn.CloseAsync(); }
        }

        /// <summary>Raw SQL for statement sales list when Sales.BranchId does not exist (42703). Selects only Id, InvoiceDate, InvoiceNo, GrandTotal.</summary>
        private async Task<List<StatementSaleRow>> GetStatementSalesRawAsync(int customerId, int tenantId, DateTime fromDate, DateTime toEnd)
        {
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"SELECT ""Id"", ""InvoiceDate"", ""InvoiceNo"", ""GrandTotal"" FROM ""Sales"" WHERE ""CustomerId"" = @p0 AND ""TenantId"" = @p1 AND ""IsDeleted"" = false AND ""InvoiceDate"" >= @p2 AND ""InvoiceDate"" <= @p3 ORDER BY ""InvoiceDate"", ""Id""";
                var p0 = cmd.CreateParameter(); p0.ParameterName = "p0"; p0.Value = customerId; cmd.Parameters.Add(p0);
                var p1 = cmd.CreateParameter(); p1.ParameterName = "p1"; p1.Value = tenantId; cmd.Parameters.Add(p1);
                var p2 = cmd.CreateParameter(); p2.ParameterName = "p2"; p2.Value = fromDate; cmd.Parameters.Add(p2);
                var p3 = cmd.CreateParameter(); p3.ParameterName = "p3"; p3.Value = toEnd; cmd.Parameters.Add(p3);
                var list = new List<StatementSaleRow>();
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        list.Add(new StatementSaleRow
                        {
                            Id = reader.GetInt32(0),
                            InvoiceDate = reader.GetDateTime(1),
                            InvoiceNo = reader.IsDBNull(2) ? null : reader.GetString(2),
                            GrandTotal = reader.GetDecimal(3)
                        });
                    }
                }
                return list;
            }
            finally { if (!wasOpen) await conn.CloseAsync(); }
        }

        /// <summary>Raw SQL for single Sale InvoiceNo when Sales.BranchId does not exist (42703).</summary>
        private async Task<string?> GetSaleInvoiceNoRawAsync(int saleId)
        {
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"SELECT ""InvoiceNo"" FROM ""Sales"" WHERE ""Id"" = @p0 AND ""IsDeleted"" = false LIMIT 1";
                var p0 = cmd.CreateParameter(); p0.ParameterName = "p0"; p0.Value = saleId; cmd.Parameters.Add(p0);
                var result = await cmd.ExecuteScalarAsync();
                return result?.ToString();
            }
            finally { if (!wasOpen) await conn.CloseAsync(); }
        }

        /// <summary>Raw SQL for statement opening sales returns sum when SaleReturns.BranchId may not exist.</summary>
        private async Task<decimal> GetStatementOpeningSalesReturnsRawAsync(int customerId, int tenantId, DateTime fromDate)
        {
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                using var cmd = conn.CreateCommand();
                // Status is stored as text (EF HasConversion<string>); never compare to integer — PostgreSQL 42883 text = integer
                cmd.CommandText = @"SELECT COALESCE(SUM(""GrandTotal""), 0) FROM ""SaleReturns"" WHERE ""CustomerId"" = @p0 AND ""TenantId"" = @p1 AND ""ReturnDate"" < @p2 AND ""Status"" = @p3";
                var p0 = cmd.CreateParameter(); p0.ParameterName = "p0"; p0.Value = customerId; cmd.Parameters.Add(p0);
                var p1 = cmd.CreateParameter(); p1.ParameterName = "p1"; p1.Value = tenantId; cmd.Parameters.Add(p1);
                var p2 = cmd.CreateParameter(); p2.ParameterName = "p2"; p2.Value = fromDate; cmd.Parameters.Add(p2);
                var p3 = cmd.CreateParameter(); p3.ParameterName = "p3"; p3.Value = nameof(ReturnStatus.Approved); cmd.Parameters.Add(p3);
                var result = await cmd.ExecuteScalarAsync();
                return result is decimal d ? d : (result is double dbl ? (decimal)dbl : 0m);
            }
            finally { if (!wasOpen) await conn.CloseAsync(); }
        }

        /// <summary>Raw SQL for statement sales returns list when SaleReturns.BranchId may not exist. Returns ReturnDate, ReturnNo, GrandTotal.</summary>
        private async Task<List<(DateTime ReturnDate, string? ReturnNo, decimal GrandTotal)>> GetStatementSalesReturnsRawAsync(int customerId, int tenantId, DateTime fromDate, DateTime toEnd)
        {
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"SELECT ""ReturnDate"", ""ReturnNo"", ""GrandTotal"" FROM ""SaleReturns"" WHERE ""CustomerId"" = @p0 AND ""TenantId"" = @p1 AND ""ReturnDate"" >= @p2 AND ""ReturnDate"" <= @p3 AND ""Status"" = @p4 ORDER BY ""ReturnDate"", ""Id""";
                var p0 = cmd.CreateParameter(); p0.ParameterName = "p0"; p0.Value = customerId; cmd.Parameters.Add(p0);
                var p1 = cmd.CreateParameter(); p1.ParameterName = "p1"; p1.Value = tenantId; cmd.Parameters.Add(p1);
                var p2 = cmd.CreateParameter(); p2.ParameterName = "p2"; p2.Value = fromDate; cmd.Parameters.Add(p2);
                var p3 = cmd.CreateParameter(); p3.ParameterName = "p3"; p3.Value = toEnd; cmd.Parameters.Add(p3);
                var p4 = cmd.CreateParameter(); p4.ParameterName = "p4"; p4.Value = nameof(ReturnStatus.Approved); cmd.Parameters.Add(p4);
                var list = new List<(DateTime ReturnDate, string? ReturnNo, decimal GrandTotal)>();
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        list.Add((reader.GetDateTime(0), reader.IsDBNull(1) ? null : reader.GetString(1), reader.GetDecimal(2)));
                    }
                }
                return list;
            }
            finally { if (!wasOpen) await conn.CloseAsync(); }
        }

        public async Task<PagedResponse<CustomerDto>> GetCustomersAsync(int tenantId, int page = 1, int pageSize = 10, string? search = null, int? branchId = null, int? routeId = null, IReadOnlyList<int>? restrictToBranchIds = null, IReadOnlyList<int>? restrictToRouteIds = null)
        {
            // NOTE: DatabaseFixer should only run at application startup (Program.cs)
            // Calling it here could interfere with transactions if this method is called
            // during a transaction. Columns should exist from migrations.
            
            // OPTIMIZATION: Limit page size and use AsNoTracking
            pageSize = Math.Min(pageSize, 100); // Max 100 items per page
            
            // CRITICAL: Filter by tenantId for data isolation
            var query = _context.Customers
                .Where(c => c.TenantId == tenantId)
                .AsNoTracking() // Performance: No change tracking needed
                .AsQueryable();

            // FIX: When both branchId and routeId are provided, include customers that match branch OR are on route OR are unassigned
            // Unassigned (BranchId=null AND RouteId=null) must appear in POS so Select Customer shows all customers
            if (branchId.HasValue && routeId.HasValue)
            {
                // Get customers assigned to this route via RouteCustomers table
                var routeCustomerIds = await _context.RouteCustomers
                    .Where(rc => rc.RouteId == routeId.Value)
                    .Select(rc => rc.CustomerId)
                    .ToListAsync();
                
                // Include: match branch, match route, on route via RouteCustomers, OR unassigned (can be served from any branch/route)
                query = query.Where(c => 
                    c.BranchId == branchId.Value || 
                    c.RouteId == routeId.Value || 
                    routeCustomerIds.Contains(c.Id) ||
                    (c.BranchId == null && c.RouteId == null));
            }
            else if (branchId.HasValue)
            {
                query = query.Where(c => c.BranchId == branchId.Value || (c.BranchId == null && c.RouteId == null));
            }
            else if (routeId.HasValue)
            {
                // Customers on route: either Customer.RouteId or in RouteCustomers, or unassigned
                var routeCustomerIds = await _context.RouteCustomers
                    .Where(rc => rc.RouteId == routeId.Value)
                    .Select(rc => rc.CustomerId)
                    .ToListAsync();
                query = query.Where(c => c.RouteId == routeId.Value || routeCustomerIds.Contains(c.Id) || (c.BranchId == null && c.RouteId == null));
            }
            // Staff with no branch/route filter: restrict to assigned branches and routes
            if (!branchId.HasValue && !routeId.HasValue && (restrictToBranchIds != null || restrictToRouteIds != null))
            {
                var hasBranch = restrictToBranchIds != null && restrictToBranchIds.Count > 0;
                var hasRoute = restrictToRouteIds != null && restrictToRouteIds.Count > 0;
                if (!hasBranch && !hasRoute)
                {
                    // Staff with no assignments: return empty result (frontend will show helpful message)
                    // This is intentional - staff must be assigned to branches/routes to see customers
                    query = query.Where(c => false);
                    Console.WriteLine("⚠️ Staff user has no branch/route assignments - returning empty customer list");
                }
                else
                {
                    List<int> routeCustomerIdsForRestrict = new List<int>();
                    if (hasRoute)
                    {
                        routeCustomerIdsForRestrict = await _context.RouteCustomers
                            .Where(rc => restrictToRouteIds!.Contains(rc.RouteId))
                            .Select(rc => rc.CustomerId)
                            .Distinct()
                            .ToListAsync();
                    }
                    // Include customers from assigned branches OR assigned routes (via RouteCustomers table)
                    query = query.Where(c =>
                        (hasBranch && c.BranchId.HasValue && restrictToBranchIds!.Contains(c.BranchId.Value)) ||
                        (hasRoute && (c.RouteId.HasValue && restrictToRouteIds!.Contains(c.RouteId.Value) || routeCustomerIdsForRestrict.Contains(c.Id))));
                    
                    Console.WriteLine($"✅ Staff user filtered to {restrictToBranchIds?.Count ?? 0} branches and {restrictToRouteIds?.Count ?? 0} routes");
                }
            }

            if (!string.IsNullOrEmpty(search))
            {
                var searchLower = search.Trim().ToLowerInvariant();
                query = query.Where(c => (c.Name != null && c.Name.ToLower().Contains(searchLower)) || 
                                        (c.Phone != null && c.Phone.Contains(search)) ||
                                        (c.Email != null && c.Email.ToLower().Contains(searchLower)) ||
                                        (c.Trn != null && c.Trn.Contains(search)));
            }

            var totalCount = await query.CountAsync();
            
            // Load into memory first to avoid column ordinal issues
            var customersList = await query
                .OrderBy(c => c.Name)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            var customers = customersList.Select(c => new CustomerDto
                {
                    Id = c.Id,
                Name = c.Name ?? string.Empty,
                    Phone = c.Phone,
                    Email = c.Email,
                    Trn = c.Trn,
                    Address = c.Address,
                    CreditLimit = c.CreditLimit,
                    PaymentTerms = c.PaymentTerms,
                    Balance = c.Balance,
                    CustomerType = c.CustomerType.ToString(),
                    TotalSales = c.TotalSales,
                    TotalPayments = c.TotalPayments,
                    PendingBalance = c.PendingBalance,
                    LastPaymentDate = c.LastPaymentDate,
                    LastActivity = c.LastActivity,
                    BranchId = c.BranchId,
                    RouteId = c.RouteId
            }).ToList();

            return new PagedResponse<CustomerDto>
            {
                Items = customers,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
            };
        }

        public async Task<CustomerDto?> GetCustomerByIdAsync(int id, int tenantId)
        {
            // NOTE: DatabaseFixer should only run at application startup (Program.cs)
            // Columns should exist from migrations.
            
            // CRITICAL: Filter by both id and tenantId
            var customer = await _context.Customers
                .Where(c => c.Id == id && c.TenantId == tenantId)
                .FirstOrDefaultAsync();
            if (customer == null) return null;

            return new CustomerDto
            {
                Id = customer.Id,
                Name = customer.Name ?? string.Empty,
                Phone = customer.Phone,
                Email = customer.Email,
                Trn = customer.Trn,
                Address = customer.Address,
                CreditLimit = customer.CreditLimit,
                PaymentTerms = customer.PaymentTerms,
                Balance = customer.Balance,
                CustomerType = customer.CustomerType.ToString(),
                TotalSales = customer.TotalSales,
                TotalPayments = customer.TotalPayments,
                PendingBalance = customer.PendingBalance,
                LastPaymentDate = customer.LastPaymentDate,
                BranchId = customer.BranchId,
                RouteId = customer.RouteId
            };
        }

        public async Task<CustomerDto> CreateCustomerAsync(CreateCustomerRequest request, int tenantId)
        {
            // Validate input first
            if (string.IsNullOrWhiteSpace(request.Name))
                throw new ArgumentException("Customer name is required");

            // NOTE: DatabaseFixer should NOT be called here - it uses the same connection
            // and ALTER TABLE commands in SQLite commit any pending transaction.
            // DatabaseFixer runs at application startup, so columns should already exist.
            // If columns are missing, that's a migration issue that needs to be fixed separately.

            // CRITICAL: Do NOT use BeginTransactionAsync - NpgsqlRetryingExecutionStrategy does not support
            // user-initiated transactions (causes 500). Run operations directly.
            try
            {
                // CRITICAL: Ensure CreditLimit is always set to a valid non-null value
                // Handle all edge cases: null, negative, or missing values
                decimal creditLimit = 0;
                try
                {
                    // Try to parse the value, default to 0 if invalid
                    if (request.CreditLimit >= 0)
                    {
                        creditLimit = request.CreditLimit;
                    }
                    else
                    {
                        creditLimit = 0;
                    }
                }
                catch
                {
                    creditLimit = 0; // Always default to 0 if anything goes wrong
                }
                
                // Explicitly validate the value before creating entity
                if (creditLimit < 0) creditLimit = 0;
                
                Console.WriteLine($"🔍 Creating customer with CreditLimit: {creditLimit}");
                
                // Ensure RowVersion is always a valid non-empty byte array
                var rowVersion = Array.Empty<byte>();
                if (rowVersion == null || rowVersion.Length == 0)
                {
                    rowVersion = new byte[] { 0 };
                }
                
                // CRITICAL: Check for duplicate customer name within tenant scope
                var duplicateName = await _context.Customers
                    .AnyAsync(c => c.TenantId == tenantId && 
                                   c.Name.Trim().ToLower() == request.Name.Trim().ToLower());
                
                if (duplicateName)
                {
                    throw new InvalidOperationException($"Customer with name '{request.Name}' already exists. Please use a different name.");
                }

                // Check for duplicate phone number if provided (within tenant scope)
                if (!string.IsNullOrWhiteSpace(request.Phone))
                {
                    var duplicatePhone = await _context.Customers
                        .AnyAsync(c => c.TenantId == tenantId && 
                                       !string.IsNullOrWhiteSpace(c.Phone) &&
                                       c.Phone.Trim() == request.Phone.Trim());
                    
                    if (duplicatePhone)
                    {
                        throw new InvalidOperationException($"Customer with phone number '{request.Phone}' already exists. Please use a different phone number.");
                    }
                }

                var customer = new Customer
                {
                    TenantId = tenantId, // CRITICAL: Set owner_id
                    Name = request.Name.Trim(),
                    Phone = request.Phone?.Trim(),
                    Email = request.Email?.Trim(),
                    Trn = request.Trn?.Trim(),
                    Address = request.Address?.Trim(),
                    CreditLimit = creditLimit, // Explicitly set - must never be NULL
                    PaymentTerms = string.IsNullOrWhiteSpace(request.PaymentTerms) ? null : request.PaymentTerms.Trim(),
                    Balance = 0m, // Explicitly set to 0 decimal - must never be NULL
                    CustomerType = ParseCustomerType(request.CustomerType), // Parse and set customer type
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                    RowVersion = rowVersion, // Always set to valid byte array
                    BranchId = request.BranchId,
                    RouteId = request.RouteId
                };
                
                // Double-check before adding to context
                if (customer.CreditLimit < 0)
                {
                    customer.CreditLimit = 0;
                }
                
                Console.WriteLine($"🔍 Customer entity CreditLimit value: {customer.CreditLimit}");

                _context.Customers.Add(customer);
                
                // CRITICAL FIX: Save changes normally and let EF Core handle it
                // The database schema is now fixed to have proper defaults
                await _context.SaveChangesAsync();
                
                // PROD-12: Link customer to route with validation
                if (request.RouteId.HasValue && request.RouteId.Value > 0)
                {
                    // Validate Route exists and belongs to tenant
                    var route = await _context.Routes.FirstOrDefaultAsync(r => r.Id == request.RouteId.Value && r.TenantId == tenantId);
                    if (route == null)
                        throw new InvalidOperationException($"Route with ID {request.RouteId.Value} not found or does not belong to your tenant.");
                    
                    // PROD-12: Validate Route.BranchId matches Customer.BranchId if Customer has a BranchId
                    if (customer.BranchId.HasValue && route.BranchId != customer.BranchId.Value)
                    {
                        throw new InvalidOperationException(
                            $"Customer belongs to Branch {customer.BranchId.Value}, but Route {request.RouteId.Value} belongs to Branch {route.BranchId}. " +
                            "Customer and Route must belong to the same Branch.");
                    }
                    
                    if (!await _context.RouteCustomers.AnyAsync(rc => rc.RouteId == request.RouteId.Value && rc.CustomerId == customer.Id))
                    {
                        _context.RouteCustomers.Add(new RouteCustomer
                        {
                            RouteId = request.RouteId.Value,
                            CustomerId = customer.Id,
                            AssignedAt = DateTime.UtcNow
                        });
                        await _context.SaveChangesAsync();
                    }
                }
                
                // Use the customer entity directly - SaveChanges already populated it with all values
                // No need to fetch fresh - this avoids transaction scope issues
                Console.WriteLine($"✅ Customer created successfully: {customer.Name} (ID: {customer.Id})");

                return new CustomerDto
                {
                    Id = customer.Id,
                    Name = customer.Name ?? string.Empty,
                    Phone = customer.Phone,
                    Email = customer.Email,
                    Trn = customer.Trn,
                    Address = customer.Address,
                    CreditLimit = customer.CreditLimit,
                    PaymentTerms = customer.PaymentTerms,
                    Balance = customer.Balance,
                    CustomerType = customer.CustomerType.ToString(),
                    TotalSales = customer.TotalSales,
                    TotalPayments = customer.TotalPayments,
                    PendingBalance = customer.PendingBalance,
                    LastPaymentDate = customer.LastPaymentDate,
                    BranchId = customer.BranchId,
                    RouteId = customer.RouteId
                };
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine($"❌ Customer creation timed out after 30 seconds");
                throw new InvalidOperationException("Customer creation timed out. Please try again.");
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException ex)
            {
                var errorMessage = ex.InnerException?.Message ?? ex.Message;
                Console.WriteLine($"❌ Database Error in CreateCustomerAsync: {errorMessage}");
                Console.WriteLine($"❌ Full Exception: {ex}");
                throw new InvalidOperationException($"Database error: {errorMessage}", ex);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ CreateCustomerAsync Error: {ex.Message}");
                Console.WriteLine($"❌ Stack Trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"❌ Inner Exception: {ex.InnerException.Message}");
                }
                throw;
            }
        }

        public async Task<CustomerDto?> UpdateCustomerAsync(int id, CreateCustomerRequest request, int tenantId)
        {
            // CRITICAL: Filter by both id and tenantId
            var customer = await _context.Customers
                .Where(c => c.Id == id && c.TenantId == tenantId)
                .FirstOrDefaultAsync();
            if (customer == null) return null;

            // Store old type for validation
            var oldCustomerType = customer.CustomerType;
            var newCustomerType = ParseCustomerType(request.CustomerType);

            // CRITICAL VALIDATION: Prevent changing from Credit to Cash if customer has outstanding balance
            if (oldCustomerType == CustomerType.Credit && newCustomerType == CustomerType.Cash)
            {
                if (customer.PendingBalance > 0.01m)
                {
                    throw new InvalidOperationException(
                        $"Cannot change customer type from Credit to Cash. " +
                        $"Customer has outstanding balance of {customer.PendingBalance:N2}. " +
                        $"Please collect all payments first.");
                }
            }

            // CRITICAL: Check for duplicate customer name (excluding current customer)
            var duplicateName = await _context.Customers
                .AnyAsync(c => c.TenantId == tenantId && 
                               c.Id != id &&
                               c.Name.Trim().ToLower() == request.Name.Trim().ToLower());
            
            if (duplicateName)
            {
                throw new InvalidOperationException($"Customer with name '{request.Name}' already exists. Please use a different name.");
            }

            // Check for duplicate phone number if provided (excluding current customer)
            if (!string.IsNullOrWhiteSpace(request.Phone))
            {
                var duplicatePhone = await _context.Customers
                    .AnyAsync(c => c.TenantId == tenantId && 
                                   c.Id != id &&
                                   !string.IsNullOrWhiteSpace(c.Phone) &&
                                   c.Phone.Trim() == request.Phone.Trim());
                
                if (duplicatePhone)
                {
                    throw new InvalidOperationException($"Customer with phone number '{request.Phone}' already exists. Please use a different phone number.");
                }
            }

            customer.Name = request.Name;
            customer.Phone = request.Phone;
            customer.Email = request.Email;
            customer.Trn = request.Trn;
            customer.Address = request.Address;
            customer.CreditLimit = request.CreditLimit;
            customer.PaymentTerms = string.IsNullOrWhiteSpace(request.PaymentTerms) ? null : request.PaymentTerms.Trim();
            customer.CustomerType = newCustomerType;
            customer.BranchId = request.BranchId;
            customer.RouteId = request.RouteId;
            customer.UpdatedAt = DateTime.UtcNow;

            // PROD-12: Validate Route/Branch consistency before updating RouteCustomers
            if (request.RouteId.HasValue && request.RouteId.Value > 0)
            {
                // Validate Route exists and belongs to tenant
                var route = await _context.Routes.FirstOrDefaultAsync(r => r.Id == request.RouteId.Value && r.TenantId == tenantId);
                if (route == null)
                    throw new InvalidOperationException($"Route with ID {request.RouteId.Value} not found or does not belong to your tenant.");
                
                // PROD-12: Validate Route.BranchId matches Customer.BranchId if Customer has a BranchId
                if (customer.BranchId.HasValue && route.BranchId != customer.BranchId.Value)
                {
                    throw new InvalidOperationException(
                        $"Customer belongs to Branch {customer.BranchId.Value}, but Route {request.RouteId.Value} belongs to Branch {route.BranchId}. " +
                        "Customer and Route must belong to the same Branch.");
                }
            }

            // Sync RouteCustomers: ensure customer is linked to the selected route only
            var existingRouteCustomers = await _context.RouteCustomers.Where(rc => rc.CustomerId == customer.Id).ToListAsync();
            _context.RouteCustomers.RemoveRange(existingRouteCustomers);
            if (request.RouteId.HasValue && request.RouteId.Value > 0)
            {
                _context.RouteCustomers.Add(new RouteCustomer
                {
                    RouteId = request.RouteId.Value,
                    CustomerId = customer.Id,
                    AssignedAt = DateTime.UtcNow
                });
            }

            // Log customer type change if it changed
            if (oldCustomerType != newCustomerType)
            {
                Console.WriteLine($"🔄 Customer {customer.Name} type changed from {oldCustomerType} to {newCustomerType}");
            }

            await _context.SaveChangesAsync();

            return new CustomerDto
            {
                Id = customer.Id,
                Name = customer.Name ?? string.Empty,
                Phone = customer.Phone,
                Email = customer.Email,
                Trn = customer.Trn,
                Address = customer.Address,
                CreditLimit = customer.CreditLimit,
                PaymentTerms = customer.PaymentTerms,
                Balance = customer.Balance,
                CustomerType = customer.CustomerType.ToString(),
                TotalSales = customer.TotalSales,
                TotalPayments = customer.TotalPayments,
                PendingBalance = customer.PendingBalance,
                LastPaymentDate = customer.LastPaymentDate,
                BranchId = customer.BranchId,
                RouteId = customer.RouteId
            };
        }

        /// <summary>
        /// Helper method to parse customer type from string
        /// </summary>
        private static CustomerType ParseCustomerType(string? customerType)
        {
            if (string.IsNullOrWhiteSpace(customerType))
                return CustomerType.Credit; // Default to Credit
            
            if (Enum.TryParse<CustomerType>(customerType, true, out var result))
                return result;
            
            // Handle case-insensitive matching
            return customerType.Trim().ToLower() switch
            {
                "cash" => CustomerType.Cash,
                "credit" => CustomerType.Credit,
                _ => CustomerType.Credit // Default to Credit for unknown values
            };
        }

        public async Task<(bool Success, string Message)> DeleteCustomerAsync(int id, int tenantId)
        {
            // CRITICAL: Filter by both id and tenantId
            var customer = await _context.Customers
                .Where(c => c.Id == id && c.TenantId == tenantId)
                .FirstOrDefaultAsync();
            if (customer == null) return (false, "Customer not found");

            // Check for related sales
            var hasSales = await _context.Sales.AnyAsync(s => s.CustomerId == id && s.TenantId == tenantId && !s.IsDeleted);
            var hasPayments = await _context.Payments.AnyAsync(p => p.CustomerId == id && p.TenantId == tenantId);
            
            if (hasSales || hasPayments)
            {
                // Option 1: Prevent deletion if customer has transactions
                var salesCount = await _context.Sales.CountAsync(s => s.CustomerId == id && s.TenantId == tenantId && !s.IsDeleted);
                var paymentsCount = await _context.Payments.CountAsync(p => p.CustomerId == id && p.TenantId == tenantId);
                return (false, $"Cannot delete customer. Customer has {salesCount} sale(s) and {paymentsCount} payment(s). Please delete related transactions first or use force delete with all data.");
            }

            // Safe to delete - no related transactions
            _context.Customers.Remove(customer);
            await _context.SaveChangesAsync();
            return (true, "Customer deleted successfully");
        }

        /// <summary>
        /// Force delete customer and ALL associated data (Admin only)
        /// This will delete: Sales, Payments, Sale Returns, and restore stock
        /// </summary>
        public async Task<(bool Success, string Message, DeleteCustomerSummary? Summary)> ForceDeleteCustomerWithAllDataAsync(int customerId, int userId, int tenantId)
        {
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // CRITICAL: Filter by both customerId and tenantId
                var customer = await _context.Customers
                    .Where(c => c.Id == customerId && c.TenantId == tenantId)
                    .FirstOrDefaultAsync();
                if (customer == null)                 return (false, "Customer not found", null);

                var summary = new DeleteCustomerSummary
                {
                    CustomerName = customer.Name,
                    SalesDeleted = 0,
                    PaymentsDeleted = 0,
                    SaleReturnsDeleted = 0,
                    StockRestored = false
                };

                // 1. Get all sales for this customer
                var sales = await _context.Sales
                    .Include(s => s.Items)
                    .ThenInclude(i => i.Product)
                    .Where(s => s.CustomerId == customerId && s.TenantId == tenantId)
                    .ToListAsync();

                // 2. For each sale, restore stock and delete sale items
                foreach (var sale in sales)
                {
                    // Restore stock for each item
                    foreach (var item in sale.Items)
                    {
                        var product = item.Product;
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

                            // Create inventory transaction for audit
                            _context.InventoryTransactions.Add(new InventoryTransaction
                            {
                                OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                                TenantId = tenantId, // CRITICAL: Set new TenantId
                                ProductId = product.Id,
                                ChangeQty = baseQty,
                                TransactionType = TransactionType.Adjustment,
                                Reason = $"Customer Deleted: {customer.Name} - Sale {sale.InvoiceNo}",
                                CreatedAt = DateTime.UtcNow
                            });
                        }
                    }

                    // Delete sale items
                    _context.SaleItems.RemoveRange(sale.Items);
                    summary.StockRestored = true;
                }

                // 3. Delete all sales (hard delete)
                summary.SalesDeleted = sales.Count;
                _context.Sales.RemoveRange(sales);

                // 4. Delete all payments
                var payments = await _context.Payments
                    .Where(p => p.CustomerId == customerId && p.TenantId == tenantId)
                    .ToListAsync();
                summary.PaymentsDeleted = payments.Count;
                _context.Payments.RemoveRange(payments);

                // 5. Delete all sale returns
                var saleReturns = await _context.SaleReturns
                    .Where(sr => sr.CustomerId == customerId && sr.TenantId == tenantId)
                    .ToListAsync();
                summary.SaleReturnsDeleted = saleReturns.Count;
                
                // Delete sale return items first
                foreach (var saleReturn in saleReturns)
                {
                    var returnItems = await _context.SaleReturnItems
                        .Where(sri => sri.SaleReturnId == saleReturn.Id)
                        .ToListAsync();
                    _context.SaleReturnItems.RemoveRange(returnItems);
                }
                
                _context.SaleReturns.RemoveRange(saleReturns);

                // 6. Delete customer
                _context.Customers.Remove(customer);

                // 7. Create audit log
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Customer Force Deleted",
                    Details = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        CustomerId = customerId,
                        CustomerName = customer.Name,
                        SalesDeleted = summary.SalesDeleted,
                        PaymentsDeleted = summary.PaymentsDeleted,
                        SaleReturnsDeleted = summary.SaleReturnsDeleted,
                        StockRestored = summary.StockRestored
                    }),
                    CreatedAt = DateTime.UtcNow
                };
                _context.AuditLogs.Add(auditLog);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                var message = $"Customer '{customer.Name}' and all associated data deleted successfully. " +
                             $"Deleted: {summary.SalesDeleted} sales, {summary.PaymentsDeleted} payments, {summary.SaleReturnsDeleted} returns." +
                             (summary.StockRestored ? " Stock restored." : "");

                return (true, message, summary);
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                return (false, $"Error deleting customer: {ex.Message}", null);
            }
        }


        /// <summary>
        /// Get unified customer ledger - Tally-style single-entry flow without duplicates.
        /// Optional filters: branchId, routeId, staffId (CreatedBy), fromDate, toDate.
        /// </summary>
        public async Task<List<CustomerLedgerEntry>> GetCustomerLedgerAsync(int customerId, int tenantId, int? branchId = null, int? routeId = null, int? staffId = null, DateTime? fromDate = null, DateTime? toDate = null)
        {
            try
            {
                // CRITICAL: Ensure customerId is valid and filter out any null CustomerId records
                if (customerId <= 0)
                    throw new ArgumentException("Invalid customer ID");

                // Sales: apply optional branch/route/staff/date filters
                // CRITICAL: For PostgreSQL, normalize dates with ToUtcKind (matches ReportsController)
                var from = fromDate.HasValue ? fromDate.Value.ToUtcKind() : (DateTime?)null;
                var toEnd = toDate.HasValue ? toDate.Value.ToUtcKind() : (DateTime?)null;
                // Note: Controller passes toDate as exclusive end (AddDays(1) applied), so use toEnd directly
                var salesQuery = _context.Sales
                    .Where(s => s.CustomerId.HasValue && s.CustomerId.Value == customerId && s.TenantId == tenantId && !s.IsDeleted);
            
                // Apply date filters (columns always exist)
                if (from.HasValue) salesQuery = salesQuery.Where(s => s.InvoiceDate >= from.Value);
                if (toEnd.HasValue) salesQuery = salesQuery.Where(s => s.InvoiceDate < toEnd.Value);
                
                // CRITICAL: For PostgreSQL, check if BranchId column exists before applying filters
                // Skip branch/route/staff filters if column doesn't exist to prevent 500 errors
                // Use cached result to avoid repeated database queries
                bool hasBranchIdColumn = await CheckBranchIdColumnExistsAsync();
                
                if (hasBranchIdColumn)
                {
                    Console.WriteLine($"✅ BranchId column exists (cached), applying branch/route/staff filters");
                }
                else
                {
                    Console.WriteLine($"⚠️ Warning: BranchId column doesn't exist in Sales table (cached), skipping branch/route/staff filters");
                }
                
                // Apply filters only if column exists. Include sales with null BranchId/RouteId so legacy data still shows.
                if (hasBranchIdColumn)
                {
                    if (branchId.HasValue) salesQuery = salesQuery.Where(s => s.BranchId == null || s.BranchId == branchId.Value);
                    if (routeId.HasValue) salesQuery = salesQuery.Where(s => s.RouteId == null || s.RouteId == routeId.Value);
                    if (staffId.HasValue) salesQuery = salesQuery.Where(s => s.CreatedBy == staffId.Value);
                }
                
                // CRITICAL: Project to only columns we need. Avoids "column s.BranchId does not exist" when
                // production DB has not run AddBranchAndRoute migration (EF would otherwise SELECT all columns).
                var salesData = await salesQuery
                    .Select(s => new { s.Id, s.InvoiceNo, s.InvoiceDate, s.GrandTotal })
                    .OrderBy(s => s.InvoiceDate)
                    .ThenBy(s => s.Id)
                    .ToListAsync();

                Console.WriteLine($"[GetCustomerLedger] customerId={customerId}, tenantId={tenantId}, from={from?.ToString("yyyy-MM-dd")}, toEnd={toEnd?.ToString("yyyy-MM-dd")}, salesCount={salesData.Count}, branchId={branchId}, routeId={routeId}");

            var filteredSaleIds = new HashSet<int>(salesData.Select(s => s.Id));

            var paymentsQuery = _context.Payments
                .Where(p => p.CustomerId.HasValue && p.CustomerId.Value == customerId && p.TenantId == tenantId && p.SaleReturnId == null && p.Status != PaymentStatus.VOID);
            var payments = await paymentsQuery
                .OrderBy(p => p.PaymentDate)
                .ThenBy(p => p.Id)
                .ToListAsync();
            payments = payments.Where(p => !p.SaleId.HasValue || filteredSaleIds.Contains(p.SaleId.Value)).ToList();
            if (from.HasValue) payments = payments.Where(p => p.PaymentDate >= from.Value).ToList();
            if (toEnd.HasValue) payments = payments.Where(p => p.PaymentDate < toEnd.Value).ToList();

            // Sales returns: filter by date if provided (returns don't have branch/route)
            // CRITICAL FIX: SQLite may not have BranchId/RouteId columns in SaleReturns table
            // Use projection to only select columns we actually use, avoiding BranchId/RouteId
            var salesReturnsQuery = _context.SaleReturns
                .Where(sr => sr.CustomerId.HasValue && sr.CustomerId.Value == customerId && sr.TenantId == tenantId && sr.Status == ReturnStatus.Approved);
            if (from.HasValue) salesReturnsQuery = salesReturnsQuery.Where(sr => sr.ReturnDate >= from.Value);
            if (toEnd.HasValue) salesReturnsQuery = salesReturnsQuery.Where(sr => sr.ReturnDate < toEnd.Value);
            
            // CRITICAL FIX: SQLite may not have BranchId, RouteId, or ReturnType columns
            // Use try-catch to handle missing columns gracefully
            List<SaleReturn> salesReturns;
            try
            {
                // Try to query with all columns first (for PostgreSQL)
                salesReturns = await salesReturnsQuery
                    .OrderBy(sr => sr.ReturnDate)
                    .ToListAsync();
            }
            catch (Exception dbEx) when (IsMissingColumnException(dbEx))
            {
                // Schema mismatch (SQLite missing columns or PostgreSQL migrations not applied) - use safe projection
                Console.WriteLine($"⚠️ Schema fallback - using projection to exclude possibly missing columns: {dbEx.Message}");
                var salesReturnsData = await salesReturnsQuery
                    .Select(sr => new
                    {
                        sr.Id,
                        sr.CustomerId,
                        sr.TenantId,
                        sr.ReturnDate,
                        sr.ReturnNo,
                        sr.GrandTotal,
                        sr.Subtotal,
                        sr.VatTotal,
                        sr.Discount,
                        sr.SaleId,
                        sr.Status,
                        sr.Reason,
                        sr.IsBadItem,
                        sr.RestoreStock,
                        sr.CreatedAt,
                        sr.CreatedBy,
                        sr.OwnerId
                        // Intentionally exclude BranchId, RouteId, and ReturnType - they may not exist in SQLite
                    })
                    .OrderBy(sr => sr.ReturnDate)
                    .ToListAsync();
                
                // Map back to SaleReturn objects (without BranchId/RouteId/ReturnType)
                salesReturns = salesReturnsData.Select(sr => new SaleReturn
                {
                    Id = sr.Id,
                    CustomerId = sr.CustomerId,
                    TenantId = sr.TenantId,
                    ReturnDate = sr.ReturnDate,
                    ReturnNo = sr.ReturnNo,
                    GrandTotal = sr.GrandTotal,
                    Subtotal = sr.Subtotal,
                    VatTotal = sr.VatTotal,
                    Discount = sr.Discount,
                    SaleId = sr.SaleId,
                    Status = sr.Status,
                    ReturnType = null, // May not exist in SQLite
                    Reason = sr.Reason,
                    IsBadItem = sr.IsBadItem,
                    RestoreStock = sr.RestoreStock,
                    CreatedAt = sr.CreatedAt,
                    CreatedBy = sr.CreatedBy,
                    OwnerId = sr.OwnerId
                    // BranchId and RouteId remain null (default) - they're not used in ledger anyway
                }).ToList();
            }

            // Create lookup for invoice numbers by SaleId
            var invoiceLookup = salesData.ToDictionary(s => s.Id, s => s.InvoiceNo);

            // Get payment totals for each sale to calculate status (exclude refunds)
            // Cleared amounts only — matches invoice paid state elsewhere (pending cheques do not count)
            var salePayments = await _context.Payments
                .Where(p => p.CustomerId.HasValue && p.CustomerId.Value == customerId && p.TenantId == tenantId && p.SaleId.HasValue && p.SaleReturnId == null && p.Status == PaymentStatus.CLEARED)
                .GroupBy(p => p.SaleId!.Value)
                .Select(g => new { SaleId = g.Key, TotalPaid = g.Sum(p => p.Amount) })
                .ToDictionaryAsync(x => x.SaleId, x => x.TotalPaid);

            // Build unified transaction list - ONE entry per transaction (with ReturnId for delete action)
            var allTransactions = new List<(DateTime Date, string Type, string InvoiceNo, string? PaymentMode, decimal Debit, decimal Credit, string Status, int? SaleId, int? PaymentId, string? Remarks, int? ReturnId)>();

            // Add sales (Invoices) - DEBIT entries
            foreach (var sale in salesData)
            {
                var paidAmount = salePayments.GetValueOrDefault(sale.Id, 0);
                var balance = sale.GrandTotal - paidAmount;
                var status = balance <= SalePaymentHelpers.SettlementToleranceAed ? "Paid" 
                    : paidAmount > 0 ? "Partial" 
                    : "Unpaid";
                
                allTransactions.Add((
                    sale.InvoiceDate,
                    "Invoice",
                    sale.InvoiceNo,
                    (string?)null,
                    sale.GrandTotal,
                    0m,
                    status,
                    sale.Id,
                    (int?)null,
                    (string?)null,
                    (int?)null
                ));
            }

            // Add payments - CREDIT entries (show linked invoice number if available)
            foreach (var payment in payments)
            {
                var invoiceNo = payment.SaleId.HasValue && invoiceLookup.ContainsKey(payment.SaleId.Value)
                    ? invoiceLookup[payment.SaleId.Value]
                    : (payment.Reference ?? "");
                
                allTransactions.Add((
                    payment.PaymentDate,
                    "Payment",
                    invoiceNo,
                    payment.Mode.ToString(),
                    0m,
                    payment.Amount,
                    "",
                    payment.SaleId,
                    payment.Id,
                    payment.Reference,
                    (int?)null
                ));
            }

            // Add sales returns - CREDIT entries; Status = Refunded | Credit Issued | Pending Refund (never Unpaid)
            foreach (var saleReturn in salesReturns)
            {
                var refundStatus = string.IsNullOrWhiteSpace(saleReturn.RefundStatus)
                    ? "Credit Issued"
                    : saleReturn.RefundStatus switch
                    {
                        "Refunded" => "Refunded",
                        "CreditIssued" => "Credit Issued",
                        "PendingRefund" => "Pending Refund",
                        _ => "Credit Issued"
                    };
                allTransactions.Add((
                    saleReturn.ReturnDate,
                    "Sale Return",
                    saleReturn.ReturnNo,
                    (string?)null,
                    0m,
                    saleReturn.GrandTotal,
                    refundStatus,
                    (int?)null,
                    (int?)null,
                    (string?)null,
                    saleReturn.Id
                ));
            }

            // Refund payments (money out) - show as "Refund" rows, ordered after linked Sale Return
            var refundPaymentsQuery = _context.Payments
                .Where(p => p.CustomerId == customerId && p.TenantId == tenantId && p.SaleReturnId != null);
            if (from.HasValue) refundPaymentsQuery = refundPaymentsQuery.Where(p => p.PaymentDate >= from.Value);
            if (toEnd.HasValue) refundPaymentsQuery = refundPaymentsQuery.Where(p => p.PaymentDate < toEnd.Value);
            var refundPayments = await refundPaymentsQuery.OrderBy(p => p.PaymentDate).ThenBy(p => p.Id).ToListAsync();
            foreach (var payment in refundPayments)
            {
                allTransactions.Add((
                    payment.PaymentDate,
                    "Refund",
                    "Refund",
                    payment.Mode.ToString(),
                    payment.Amount,
                    0m,
                    "Paid",
                    (int?)null,
                    payment.Id,
                    (string?)null,
                    payment.SaleReturnId
                ));
            }

            // NEW GROUPED LOGIC: Invoice → Payment (if paid) → Next Invoice → Payment → etc.
            // Group payments by their linked SaleId (invoice)
            var paymentsBySaleId = allTransactions
                .Where(t => t.Type == "Payment" && t.SaleId.HasValue)
                .GroupBy(t => t.SaleId!.Value)
                .ToDictionary(g => g.Key, g => g.OrderBy(p => p.Date).ThenBy(p => p.PaymentId ?? int.MaxValue).ToList());
            
            // Get standalone payments (not linked to any invoice)
            var standalonePayments = allTransactions
                .Where(t => t.Type == "Payment" && !t.SaleId.HasValue)
                .OrderBy(t => t.Date)
                .ThenBy(t => t.PaymentId ?? int.MaxValue)
                .ToList();
            
            var standaloneReturns = allTransactions
                .Where(t => t.Type == "Sale Return")
                .OrderBy(t => t.Date)
                .ThenBy(t => t.ReturnId ?? int.MaxValue)
                .ToList();
            var refundsByReturnId = allTransactions
                .Where(t => t.Type == "Refund" && t.ReturnId.HasValue)
                .GroupBy(t => t.ReturnId!.Value)
                .ToDictionary(g => g.Key, g => g.OrderBy(x => x.Date).ThenBy(x => x.PaymentId ?? int.MaxValue).ToList());
            
            // Get invoices sorted by date
            var invoices = allTransactions
                .Where(t => t.Type == "Invoice")
                .OrderBy(t => t.Date)
                .ThenBy(t => t.SaleId ?? int.MaxValue)
                .ToList();

            // Build grouped transaction list: Invoice → Its Payments → Next Invoice → Its Payments (with ReturnId)
            var groupedTransactions = new List<(DateTime Date, string Type, string InvoiceNo, string? PaymentMode, decimal Debit, decimal Credit, string Status, int? SaleId, int? PaymentId, string? Remarks, int? ReturnId)>();
            
            foreach (var invoice in invoices)
            {
                groupedTransactions.Add(invoice);
                if (invoice.SaleId.HasValue && paymentsBySaleId.ContainsKey(invoice.SaleId.Value))
                {
                    foreach (var payment in paymentsBySaleId[invoice.SaleId.Value])
                        groupedTransactions.Add(payment);
                }
            }
            groupedTransactions.AddRange(standalonePayments);
            foreach (var ret in standaloneReturns)
            {
                groupedTransactions.Add(ret);
                if (ret.ReturnId.HasValue && refundsByReturnId.TryGetValue(ret.ReturnId.Value, out var refs))
                    foreach (var r in refs) groupedTransactions.Add(r);
            }

            var ledgerEntries = new List<CustomerLedgerEntry>();
            var seenTransactions = new HashSet<(int? SaleId, int? PaymentId, int? ReturnId, DateTime Date, decimal Amount)>();
            decimal runningBalance = 0;

            foreach (var transaction in groupedTransactions)
            {
                var transactionKey = (transaction.SaleId, transaction.PaymentId, transaction.ReturnId, transaction.Date, transaction.Debit + transaction.Credit);
                if (seenTransactions.Contains(transactionKey))
                {
                    Console.WriteLine($"⚠️ Duplicate transaction detected and skipped: SaleId={transaction.SaleId}, PaymentId={transaction.PaymentId}, ReturnId={transaction.ReturnId}, Date={transaction.Date:yyyy-MM-dd}, Amount={transaction.Debit + transaction.Credit}");
                    continue;
                }
                seenTransactions.Add(transactionKey);
                runningBalance += transaction.Debit - transaction.Credit;
                ledgerEntries.Add(new CustomerLedgerEntry
                {
                    Date = transaction.Date,
                    Type = transaction.Type,
                    Reference = transaction.InvoiceNo,
                    PaymentMode = transaction.PaymentMode,
                    Remarks = transaction.Remarks,
                    Debit = transaction.Debit,
                    Credit = transaction.Credit,
                    Balance = runningBalance,
                    SaleId = transaction.SaleId,
                    PaymentId = transaction.PaymentId,
                    ReturnId = transaction.ReturnId,
                    Status = transaction.Status,
                    PaidAmount = 0
                });
            }

                Console.WriteLine($"✅ Ledger entries generated: {ledgerEntries.Count} unique transactions for customer {customerId}");
                return ledgerEntries;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error in GetCustomerLedgerAsync for customer {customerId}, tenant {tenantId}: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
                }
                throw; // Re-throw to be caught by controller
            }
        }

        /// <summary>
        /// Get cash customer ledger - All sales and payments with null CustomerId
        /// Same format as regular customer ledger but for cash customers
        /// </summary>
        public async Task<List<CustomerLedgerEntry>> GetCashCustomerLedgerAsync(int tenantId)
        {
            try
            {
                // Get ALL cash customer sales (CustomerId is null) - Filter by tenantId
                var sales = await _context.Sales
                .Where(s => s.CustomerId == null && s.TenantId == tenantId && !s.IsDeleted)
                .OrderBy(s => s.InvoiceDate)
                .ThenBy(s => s.Id)
                .ToListAsync();

            var payments = await _context.Payments
                .Where(p => p.CustomerId == null && p.TenantId == tenantId && p.SaleReturnId == null)
                .OrderBy(p => p.PaymentDate)
                .ThenBy(p => p.Id)
                .ToListAsync();

            // Get sales returns for cash customers (CustomerId is null) - Filter by tenantId
            var salesReturns = await _context.SaleReturns
                .Where(sr => sr.CustomerId == null && sr.TenantId == tenantId)
                .OrderBy(sr => sr.ReturnDate)
                .ToListAsync();

            // Create lookup for invoice numbers by SaleId
            var invoiceLookup = sales.ToDictionary(s => s.Id, s => s.InvoiceNo);

            var salePayments = await _context.Payments
                .Where(p => p.CustomerId == null && p.TenantId == tenantId && p.SaleId.HasValue && p.SaleReturnId == null && p.Status == PaymentStatus.CLEARED)
                .GroupBy(p => p.SaleId!.Value)
                .Select(g => new { SaleId = g.Key, TotalPaid = g.Sum(p => p.Amount) })
                .ToDictionaryAsync(x => x.SaleId, x => x.TotalPaid);

            var refundPaymentsCash = await _context.Payments
                .Where(p => p.CustomerId == null && p.TenantId == tenantId && p.SaleReturnId != null)
                .OrderBy(p => p.PaymentDate)
                .ThenBy(p => p.Id)
                .ToListAsync();
            var refundsByReturnIdCash = refundPaymentsCash.GroupBy(p => p.SaleReturnId!.Value).ToDictionary(g => g.Key, g => g.ToList());

            // Build transaction list: Invoice → Its Payments → Next Invoice → Its Payments (with ReturnId for returns)
            var groupedTransactions = new List<(DateTime Date, string Type, string InvoiceNo, string? PaymentMode, decimal Debit, decimal Credit, string Status, int? SaleId, int? PaymentId, string? Remarks, int? ReturnId)>();

            foreach (var sale in sales)
            {
                var paidAmount = salePayments.GetValueOrDefault(sale.Id, 0m);
                var balance = sale.GrandTotal - paidAmount;
                string status = balance <= SalePaymentHelpers.SettlementToleranceAed ? "Paid" : paidAmount > 0 ? "Partial" : "Unpaid";
                var firstPayment = payments.FirstOrDefault(p => p.SaleId == sale.Id);
                var paymentMode = (string?)(firstPayment?.Mode.ToString().ToUpper() ?? "NOT PAID");

                groupedTransactions.Add((
                    sale.InvoiceDate,
                    "Sale",
                    sale.InvoiceNo,
                    paymentMode,
                    sale.GrandTotal,
                    0m,
                    status,
                    sale.Id,
                    (int?)null,
                    sale.Notes,
                    (int?)null
                ));

                foreach (var payment in payments.Where(p => p.SaleId == sale.Id).OrderBy(p => p.PaymentDate).ThenBy(p => p.Id))
                {
                    groupedTransactions.Add((
                        payment.PaymentDate,
                        "Payment",
                        sale.InvoiceNo,
                        (string?)payment.Mode.ToString().ToUpper(),
                        0m,
                        payment.Amount,
                        "Paid",
                        sale.Id,
                        (int?)payment.Id,
                        (string?)payment.Reference,
                        (int?)null
                    ));
                }
            }

            var standalonePayments = payments
                .Where(p => !p.SaleId.HasValue)
                .OrderBy(p => p.PaymentDate)
                .ThenBy(p => p.Id)
                .Select(p => (
                    p.PaymentDate,
                    "Payment",
                    p.Reference ?? "-",
                    (string?)p.Mode.ToString().ToUpper(),
                    0m,
                    p.Amount,
                    "Paid",
                    (int?)null,
                    (int?)p.Id,
                    (string?)p.Reference,
                    (int?)null
                ));
            groupedTransactions.AddRange(standalonePayments);

            foreach (var returnItem in salesReturns)
            {
                var refundStatus = string.IsNullOrWhiteSpace(returnItem.RefundStatus)
                    ? "Credit Issued"
                    : returnItem.RefundStatus switch
                    {
                        "Refunded" => "Refunded",
                        "CreditIssued" => "Credit Issued",
                        "PendingRefund" => "Pending Refund",
                        _ => "Credit Issued"
                    };
                groupedTransactions.Add((
                    returnItem.ReturnDate,
                    "Sale Return",
                    returnItem.ReturnNo ?? "-",
                    (string?)"RETURN",
                    0m,
                    returnItem.GrandTotal,
                    refundStatus,
                    (int?)null,
                    (int?)null,
                    (string?)returnItem.Reason,
                    returnItem.Id
                ));
                if (refundsByReturnIdCash.TryGetValue(returnItem.Id, out var refPayments))
                {
                    foreach (var refP in refPayments)
                    {
                        groupedTransactions.Add((
                            refP.PaymentDate,
                            "Refund",
                            "Refund",
                            (string?)refP.Mode.ToString(),
                            refP.Amount,
                            0m,
                            "",
                            (int?)null,
                            (int?)refP.Id,
                            (string?)null,
                            refP.SaleReturnId
                        ));
                    }
                }
            }

            var ledgerEntries = new List<CustomerLedgerEntry>();
            decimal runningBalance = 0;

            foreach (var transaction in groupedTransactions.OrderBy(t => t.Date).ThenBy(t => t.Type == "Payment" ? 1 : 0))
            {
                runningBalance += transaction.Debit - transaction.Credit;
                ledgerEntries.Add(new CustomerLedgerEntry
                {
                    Date = transaction.Date,
                    Type = transaction.Type,
                    Reference = transaction.InvoiceNo,
                    PaymentMode = transaction.PaymentMode,
                    Remarks = transaction.Remarks,
                    Debit = transaction.Debit,
                    Credit = transaction.Credit,
                    Balance = runningBalance,
                    SaleId = transaction.SaleId,
                    PaymentId = transaction.PaymentId,
                    ReturnId = transaction.ReturnId,
                    Status = transaction.Status,
                    PaidAmount = 0
                });
            }

                Console.WriteLine($"✅ Cash customer ledger entries generated: {ledgerEntries.Count} transactions");
                return ledgerEntries;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error in GetCashCustomerLedgerAsync for tenant {tenantId}: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
                }
                throw; // Re-throw to be caught by controller
            }
        }

        public async Task<byte[]> GenerateCustomerStatementAsync(int customerId, DateTime fromDate, DateTime toDate, int tenantId)
        {
            try
            {
                // Initialize QuestPDF license and prevent font glyph errors on Linux (Render)
                QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
                QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;

                // CRITICAL: toDate is often midnight - include full end day
                var toEnd = toDate.Date.AddDays(1).AddTicks(-1);
                
            // CRITICAL: Filter by both customerId and tenantId
            var customer = await _context.Customers
                .Where(c => c.Id == customerId && c.TenantId == tenantId)
                .FirstOrDefaultAsync();
            if (customer == null)
                throw new InvalidOperationException("Customer not found");

            // Get company settings - try TenantId first, fallback to OwnerId for legacy data
            var settings = await _context.Settings
                .Where(s => s.TenantId == tenantId)
                .ToDictionaryAsync(s => s.Key, s => s.Value);
            if (settings.Count == 0)
            {
                settings = await _context.Settings
                    .Where(s => s.OwnerId == tenantId)
                    .ToDictionaryAsync(s => s.Key, s => s.Value);
            }
            var companyName = settings.GetValueOrDefault("COMPANY_NAME_EN") ?? "HexaBill";
                var companyAddress = settings.GetValueOrDefault("COMPANY_ADDRESS") ?? "Mussafah 44 - Abu Dhabi";
            var companyTrn = settings.GetValueOrDefault("COMPANY_TRN") ?? "";
            var currency = settings.GetValueOrDefault("CURRENCY") ?? "AED";
                
                // Validate required data
                if (string.IsNullOrEmpty(companyName))
                    companyName = "HexaBill";
                if (string.IsNullOrEmpty(companyAddress))
                    companyAddress = "Mussafah 44 - Abu Dhabi";

            // CRITICAL: Ensure customerId is valid
            if (customerId <= 0)
                throw new InvalidOperationException("Invalid customer ID");

            // CRITICAL: Calculate opening balance and sales list. On PostgreSQL use raw SQL so we never reference BranchId (column may not exist).
            decimal openingSales;
            List<StatementSaleRow> sales;
            if (_context.Database.IsNpgsql())
            {
                openingSales = await GetStatementOpeningSalesRawAsync(customerId, tenantId, fromDate);
                sales = await GetStatementSalesRawAsync(customerId, tenantId, fromDate, toEnd);
            }
            else
            {
                openingSales = await _context.Sales
                    .Where(s => s.CustomerId.HasValue && s.CustomerId.Value == customerId && s.TenantId == tenantId && !s.IsDeleted && s.InvoiceDate < fromDate)
                    .Select(s => new { s.GrandTotal })
                    .SumAsync(s => (decimal?)s.GrandTotal) ?? 0;
                var salesData = await _context.Sales
                    .Where(s => s.CustomerId.HasValue && s.CustomerId.Value == customerId && s.TenantId == tenantId &&
                               !s.IsDeleted &&
                               s.InvoiceDate >= fromDate &&
                               s.InvoiceDate <= toEnd)
                    .Select(s => new { s.Id, s.InvoiceDate, s.InvoiceNo, s.GrandTotal })
                    .OrderBy(s => s.InvoiceDate)
                    .ThenBy(s => s.Id)
                    .ToListAsync();
                sales = salesData.Select(s => new StatementSaleRow { Id = s.Id, InvoiceDate = s.InvoiceDate, InvoiceNo = s.InvoiceNo, GrandTotal = s.GrandTotal }).ToList();
            }

            // Include ALL payments (not just CLEARED) to match ledger tab logic
            var openingPayments = await _context.Payments
                .Where(p => p.CustomerId.HasValue && p.CustomerId.Value == customerId && p.TenantId == tenantId && p.PaymentDate < fromDate)
                .SumAsync(p => (decimal?)p.Amount) ?? 0;
            
            // Include sales returns (credit) in opening balance. On PostgreSQL use raw SQL so we never touch SaleReturns.BranchId.
            decimal openingSalesReturns;
            List<(DateTime ReturnDate, string? ReturnNo, decimal GrandTotal)> salesReturnsList;
            if (_context.Database.IsNpgsql())
            {
                openingSalesReturns = await GetStatementOpeningSalesReturnsRawAsync(customerId, tenantId, fromDate);
                salesReturnsList = await GetStatementSalesReturnsRawAsync(customerId, tenantId, fromDate, toEnd);
            }
            else
            {
                openingSalesReturns = await _context.SaleReturns
                    .Where(sr => sr.CustomerId.HasValue && sr.CustomerId.Value == customerId && sr.TenantId == tenantId && sr.ReturnDate < fromDate)
                    .SumAsync(sr => (decimal?)sr.GrandTotal) ?? 0;
                var returnsData = await _context.SaleReturns
                    .Where(sr => sr.CustomerId.HasValue && sr.CustomerId.Value == customerId && sr.TenantId == tenantId &&
                               sr.ReturnDate >= fromDate && sr.ReturnDate <= toEnd)
                    .OrderBy(sr => sr.ReturnDate)
                    .Select(sr => new { sr.ReturnDate, sr.ReturnNo, sr.GrandTotal })
                    .ToListAsync();
                salesReturnsList = returnsData.Select(x => (x.ReturnDate, (string?)x.ReturnNo, x.GrandTotal)).ToList();
            }
            
            // Opening balance = Sales (debit) - Payments (credit) - Returns (credit)
            var openingBalance = openingSales - openingPayments - openingSalesReturns;

            var payments = await _context.Payments
                .Where(p => p.CustomerId.HasValue && p.CustomerId.Value == customerId && p.TenantId == tenantId &&
                           p.PaymentDate >= fromDate && 
                           p.PaymentDate <= toEnd)
                .OrderBy(p => p.PaymentDate)
                .ThenBy(p => p.Id)
                .ToListAsync();

                // Get payment details for each sale to calculate status - STRICT filtering
                var salePayments = await _context.Payments
                    .Where(p => p.CustomerId.HasValue && p.CustomerId.Value == customerId && p.TenantId == tenantId && p.SaleId.HasValue)
                    .GroupBy(p => p.SaleId!.Value)
                    .Select(g => new { SaleId = g.Key, TotalPaid = g.Sum(p => p.Amount) })
                    .ToDictionaryAsync(x => x.SaleId, x => x.TotalPaid);

                // Combine and sort all transactions with invoice status
                // Format: (Date, Particulars (just number), Reference (same), Debit, Credit, Status, PaidAmount, BalanceAmount, PaymentMode)
                var allTransactions = new List<(DateTime Date, string Particulars, string Reference, decimal Debit, decimal Credit, string Status, decimal PaidAmount, decimal BalanceAmount, string PaymentMode)>();
            
            foreach (var sale in sales)
            {
                    var paidAmount = salePayments.GetValueOrDefault(sale.Id, 0);
                    var balanceAmount = sale.GrandTotal - paidAmount;
                    var status = paidAmount >= sale.GrandTotal ? "Paid" 
                        : paidAmount > 0 ? "Partial" 
                        : "Unpaid";
                    
                    // Just the invoice number, no "Invoice" prefix
                    allTransactions.Add((sale.InvoiceDate, sale.InvoiceNo ?? "", sale.InvoiceNo ?? "", sale.GrandTotal, 0, status, paidAmount, balanceAmount, ""));
            }
            
            foreach (var payment in payments)
            {
                    // If payment is linked to an invoice, show invoice number in reference
                    string invoiceRef = "";
                    if (payment.SaleId.HasValue)
                    {
                        // First check in current date range sales
                        var linkedSale = sales.FirstOrDefault(s => s.Id == payment.SaleId.Value);
                        if (linkedSale != null)
                        {
                            invoiceRef = linkedSale.InvoiceNo ?? "";
                        }
                        else
                        {
                            // If not in current range, fetch InvoiceNo. On PostgreSQL use raw SQL only (no EF on Sales).
                            if (_context.Database.IsNpgsql())
                                invoiceRef = await GetSaleInvoiceNoRawAsync(payment.SaleId.Value) ?? "";
                            else
                            {
                                try
                                {
                                    var saleFromDb = await _context.Sales
                                        .Where(s => s.Id == payment.SaleId.Value && !s.IsDeleted)
                                        .Select(s => s.InvoiceNo)
                                        .FirstOrDefaultAsync();
                                    invoiceRef = saleFromDb ?? "";
                                }
                                catch (PostgresException pgEx) when (pgEx.SqlState == "42703")
                                {
                                    invoiceRef = await GetSaleInvoiceNoRawAsync(payment.SaleId.Value) ?? "";
                                }
                            }
                        }
                    }
                    
                    // If no invoice linked, use payment reference or leave empty
                    if (string.IsNullOrEmpty(invoiceRef))
                    {
                        invoiceRef = payment.Reference ?? "";
                    }
                    
                    // Just the reference number, no "Payment" prefix - payment mode is separate column
                    allTransactions.Add((payment.PaymentDate, invoiceRef, invoiceRef, 0, payment.Amount, "", 0, 0, payment.Mode.ToString()));
            }

            foreach (var saleReturn in salesReturnsList)
            {
                    allTransactions.Add((saleReturn.ReturnDate, saleReturn.ReturnNo ?? "", saleReturn.ReturnNo ?? "", 0, saleReturn.GrandTotal, "", 0, 0, ""));
            }

                // NEW GROUPED LOGIC FOR PDF: Invoice → Payment (if paid) → Next Invoice → Payment → etc.
                // CRITICAL: Use same logic as GetCustomerLedgerAsync to prevent duplicates
                // Create invoice lookup by SaleId - use GroupBy to avoid ToDictionary duplicate-key exception
                var invoiceLookupBySaleId = sales
                    .GroupBy(s => s.Id)
                    .ToDictionary(g => g.Key, g => g.First().InvoiceNo ?? "");
                
                // Group payments by their linked SaleId - GroupBy ensures no duplicate key
                var paymentsBySaleId = payments
                    .Where(p => p.SaleId.HasValue)
                    .GroupBy(p => p.SaleId!.Value)
                    .ToDictionary(g => g.Key, g => g.OrderBy(p => p.PaymentDate).ThenBy(p => p.Id).ToList());
                
                // Get standalone payments (not linked to any invoice)
                var standalonePayments = payments
                    .Where(p => !p.SaleId.HasValue)
                    .OrderBy(p => p.PaymentDate)
                    .ThenBy(p => p.Id)
                    .ToList();
                
                // Get sales returns (standalone)
                var standaloneReturns = salesReturnsList
                    .OrderBy(sr => sr.ReturnDate)
                    .ToList();

                // Build grouped transaction list: Invoice → Its Payments → Next Invoice → Its Payments
                var groupedTransactions = new List<(DateTime Date, string Particulars, string Reference, decimal Debit, decimal Credit, string Status, decimal PaidAmount, decimal BalanceAmount, string PaymentMode)>();
                
                // Process each invoice with its payments immediately after
                foreach (var sale in sales.OrderBy(s => s.InvoiceDate).ThenBy(s => s.Id))
                {
                    var paidAmount = salePayments.GetValueOrDefault(sale.Id, 0);
                    var balanceAmount = sale.GrandTotal - paidAmount;
                    var status = paidAmount >= sale.GrandTotal ? "Paid" 
                        : paidAmount > 0 ? "Partial" 
                        : "Unpaid";
                    
                    // Add the invoice first
                    groupedTransactions.Add((
                        sale.InvoiceDate, 
                        sale.InvoiceNo ?? "", 
                        sale.InvoiceNo ?? "", 
                        sale.GrandTotal, 
                        0, 
                        status, 
                        paidAmount, 
                        balanceAmount, 
                        ""
                    ));
                    
                    // Immediately add all payments for this invoice (if any)
                    if (paymentsBySaleId.ContainsKey(sale.Id))
                    {
                        foreach (var payment in paymentsBySaleId[sale.Id])
                        {
                            groupedTransactions.Add((
                                payment.PaymentDate, 
                                sale.InvoiceNo ?? "", // Show invoice number for linked payments
                                sale.InvoiceNo ?? "", 
                                0, 
                                payment.Amount, 
                                "", 
                                0, 
                                0, 
                                payment.Mode.ToString()
                            ));
                        }
                    }
                }
                
                // Add standalone payments (not linked to invoices) at the end, sorted by date
                foreach (var payment in standalonePayments)
                {
                    groupedTransactions.Add((
                        payment.PaymentDate, 
                        payment.Reference ?? "", 
                        payment.Reference ?? "", 
                        0, 
                        payment.Amount, 
                        "", 
                        0, 
                        0, 
                        payment.Mode.ToString()
                    ));
                }
                
                // Add sales returns at the end, sorted by date
                foreach (var saleReturn in standaloneReturns)
                {
                    groupedTransactions.Add((
                        saleReturn.ReturnDate, 
                        saleReturn.ReturnNo ?? "", 
                        saleReturn.ReturnNo ?? "", 
                        0, 
                        saleReturn.GrandTotal, 
                        "", 
                        0, 
                        0, 
                        ""
                    ));
                }
                
                // Use grouped transactions instead of allTransactions
                allTransactions = groupedTransactions;

            // CRITICAL: Closing balance will be calculated from running balance in the PDF loop
            // This ensures it matches the ledger tab exactly
            // We'll use the final runningBalance from the transaction loop
            // For summary section, we'll calculate it here too
            decimal calculatedClosingBalance = openingBalance;
            foreach (var transaction in allTransactions)
            {
                calculatedClosingBalance += transaction.Debit - transaction.Credit;
            }
            var closingBalance = calculatedClosingBalance; // For summary section only - table uses runningBalance from loop

                // Generate PDF using QuestPDF - CheckIfAllTextGlyphsAreAvailable=false prevents Linux font errors
                byte[] pdfBytes;
                try
                {
            var document = Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(PageSizes.A4);
                        page.Margin(15, Unit.Millimetre); // Reduced margin for more space
                    page.PageColor(Colors.White);
                        page.DefaultTextStyle(x => x.FontSize(9).FontFamily("Arial")); // QuestPDF fallback when Arial missing on Linux

                        // Header - Professional Design
                    page.Header()
                        .Column(column =>
                        {
                            // Top border line
                            column.Item().BorderTop(2).BorderColor(Colors.Black).PaddingBottom(5);
                            
                            column.Item().Row(row =>
                            {
                                row.RelativeItem().Column(col =>
                                {
                                    col.Item().Text(companyName)
                                        .FontSize(16)
                                        .Bold()
                                        .FontColor(Colors.Black);
                                    col.Item().PaddingTop(2).Text(companyAddress)
                                        .FontSize(10)
                                        .FontColor(Colors.Grey.Darken2);
                                    if (!string.IsNullOrEmpty(companyTrn))
                                    {
                                        col.Item().Text($"TRN: {companyTrn}")
                                            .FontSize(9)
                                            .FontColor(Colors.Grey.Darken2);
                                    }
                                });

                                row.RelativeItem().Column(col =>
                                {
                                    col.Item().Text("CUSTOMER LEDGER STATEMENT")
                                        .FontSize(18)
                                        .Bold()
                                        .FontColor(Colors.Black)
                                        .AlignRight();
                                    col.Item().PaddingTop(3).Text($"Period: {fromDate:dd-MM-yyyy} to {toDate:dd-MM-yyyy}")
                                        .FontSize(10)
                                        .FontColor(Colors.Grey.Darken2)
                                        .AlignRight();
                                    col.Item().Text($"Generated: {DateTime.UtcNow:dd-MM-yyyy HH:mm}")
                                        .FontSize(9)
                                        .FontColor(Colors.Grey.Medium)
                                        .AlignRight();
                                });
                            });

                            column.Item().PaddingTop(8).BorderBottom(2).BorderColor(Colors.Black);

                            // Customer Details and Summary Section
                            column.Item().PaddingTop(12).Row(row =>
                            {
                                row.RelativeItem().Column(col =>
                                {
                                    col.Item().PaddingBottom(3).Text("CUSTOMER DETAILS")
                                        .FontSize(11)
                                        .Bold()
                                        .FontColor(Colors.Black);
                                    col.Item().PaddingBottom(2).Row(detailRow =>
                                    {
                                        detailRow.ConstantItem(80).Text("Name:")
                                            .FontSize(9)
                                        .Bold();
                                        detailRow.RelativeItem().Text(customer.Name)
                                        .FontSize(9);
                                    });
                                    if (!string.IsNullOrEmpty(customer.Phone))
                                    {
                                        col.Item().PaddingBottom(2).Row(detailRow =>
                                        {
                                            detailRow.ConstantItem(80).Text("Phone:")
                                                .FontSize(9)
                                                .Bold();
                                            detailRow.RelativeItem().Text(customer.Phone)
                                            .FontSize(9);
                                        });
                                    }
                                    if (!string.IsNullOrEmpty(customer.Email))
                                    {
                                        col.Item().PaddingBottom(2).Row(detailRow =>
                                        {
                                            detailRow.ConstantItem(80).Text("Email:")
                                                .FontSize(9)
                                                .Bold();
                                            detailRow.RelativeItem().Text(customer.Email)
                                            .FontSize(9);
                                        });
                                    }
                                    if (!string.IsNullOrEmpty(customer.Trn))
                                    {
                                        col.Item().PaddingBottom(2).Row(detailRow =>
                                        {
                                            detailRow.ConstantItem(80).Text("TRN:")
                                                .FontSize(9)
                                                .Bold();
                                            detailRow.RelativeItem().Text(customer.Trn)
                                            .FontSize(9);
                                        });
                                    }
                                    if (!string.IsNullOrEmpty(customer.Address))
                                    {
                                        col.Item().PaddingBottom(2).Row(detailRow =>
                                        {
                                            detailRow.ConstantItem(80).Text("Address:")
                                                .FontSize(9)
                                                .Bold();
                                            detailRow.RelativeItem().Text(customer.Address)
                                            .FontSize(9);
                                        });
                                    }
                                });

                                row.ConstantItem(250).Column(col =>
                                {
                                    col.Item().PaddingBottom(5).Border(1).BorderColor(Colors.Black)
                                        .Background(Colors.Grey.Lighten4)
                                        .Padding(8)
                                        .Column(summaryCol =>
                                        {
                                            summaryCol.Item().Text("SUMMARY")
                                                .FontSize(11)
                                        .Bold()
                                                .FontColor(Colors.Black)
                                                .AlignCenter();
                                            
                                            var openingBalanceText = openingBalance == 0 
                                                ? "0.00" 
                                                : openingBalance > 0 
                                                    ? $"{openingBalance:N2} Dr" 
                                                    : $"{Math.Abs(openingBalance):N2} Cr";
                                            
                                            var closingBalanceText = closingBalance == 0 
                                                ? "0.00" 
                                                : closingBalance > 0 
                                                    ? $"{closingBalance:N2} Dr" 
                                                    : $"{Math.Abs(closingBalance):N2} Cr";
                                            
                                            summaryCol.Item().PaddingTop(5).Row(sumRow =>
                                            {
                                                sumRow.RelativeItem().Text("Opening Balance:")
                                        .FontSize(9)
                                                    .Bold();
                                                sumRow.ConstantItem(90).Text($"{openingBalanceText} {currency}")
                                                    .FontSize(9)
                                                    .Bold()
                                        .AlignRight();
                                            });
                                            summaryCol.Item().PaddingTop(3).Row(sumRow =>
                                            {
                                                sumRow.RelativeItem().Text("Closing Balance:")
                                                    .FontSize(10)
                                                    .Bold();
                                                sumRow.ConstantItem(90).Text($"{closingBalanceText} {currency}")
                                        .FontSize(10)
                                        .Bold()
                                                    .FontColor(Colors.Black)
                                        .AlignRight();
                                            });
                                        });
                                });
                            });

                            column.Item().Height(12);
                        });

                    // Content - Ledger Table
                    page.Content()
                        .Column(column =>
                        {
                            column.Item().Table(table =>
                            {
                                // Use relative columns to fit page width (A4 = ~210mm, margins = 15mm each = 180mm available)
                                table.ColumnsDefinition(columns =>
                                {
                                    columns.RelativeColumn(1.2f); // Date
                                    columns.RelativeColumn(0.8f); // Type
                                    columns.RelativeColumn(1.0f); // Invoice Number
                                    columns.RelativeColumn(0.9f); // Payment Mode
                                    columns.RelativeColumn(1.1f); // Debit
                                    columns.RelativeColumn(1.1f); // Credit
                                    columns.RelativeColumn(0.8f); // Status
                                    columns.RelativeColumn(1.2f); // Balance
                                });

                                // Header row with borders - Compact Format
                                table.Header(header =>
                                {
                                    header.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(4)
                                            .Background(Colors.Grey.Darken1)
                                            .Text("Date")
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(Colors.White)
                                            .AlignCenter();
                                    });
                                    header.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(4)
                                            .Background(Colors.Grey.Darken1)
                                            .Text("Type")
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(Colors.White)
                                            .AlignCenter();
                                    });
                                    header.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(4)
                                            .Background(Colors.Grey.Darken1)
                                            .Text("Invoice No")
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(Colors.White)
                                            .AlignCenter();
                                    });
                                    header.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(4)
                                            .Background(Colors.Grey.Darken1)
                                            .Text("Mode")
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(Colors.White)
                                            .AlignCenter();
                                    });
                                    header.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(4)
                                            .Background(Colors.Grey.Darken1)
                                            .Text("Debit")
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(Colors.White)
                                            .AlignCenter();
                                    });
                                    header.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(4)
                                            .Background(Colors.Grey.Darken1)
                                            .Text("Credit")
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(Colors.White)
                                            .AlignCenter();
                                    });
                                    header.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(4)
                                            .Background(Colors.Grey.Darken1)
                                            .Text("Status")
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(Colors.White)
                                            .AlignCenter();
                                    });
                                    header.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(4)
                                            .Background(Colors.Grey.Darken1)
                                            .Text("Balance")
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(Colors.White)
                                            .AlignCenter();
                                    });
                                });

                                // Calculate running balance for PDF (same as ledger tab)
                                decimal runningBalance = openingBalance;
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten3)
                                        .Text(fromDate.AddDays(-1).ToString("dd-MM-yyyy"))
                                        .FontSize(8)
                                        .Bold();
                                });
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten3)
                                        .Text("OPENING")
                                        .FontSize(8)
                                        .Bold();
                                });
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten3)
                                        .Text("")
                                        .FontSize(8);
                                });
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten3)
                                        .Text("")
                                        .FontSize(8);
                                });
                                table.Cell().Element(cell =>
                                {
                                    var openingDebit = openingBalance > 0 ? openingBalance.ToString("N2") : "-";
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten3)
                                        .Text(openingDebit)
                                        .FontSize(8)
                                        .Bold()
                                        .FontColor(openingBalance > 0 ? Colors.Red.Darken2 : Colors.Black)
                                        .AlignRight();
                                });
                                table.Cell().Element(cell =>
                                {
                                    var openingCredit = openingBalance < 0 ? Math.Abs(openingBalance).ToString("N2") : "-";
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten3)
                                        .Text(openingCredit)
                                        .FontSize(8)
                                        .Bold()
                                        .FontColor(openingBalance < 0 ? Colors.Green.Darken2 : Colors.Black)
                                        .AlignRight();
                                });
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten3)
                                        .Text("")
                                        .FontSize(8);
                                });
                                table.Cell().Element(cell =>
                                {
                                    string openingBalanceText;
                                    QuestPDF.Infrastructure.Color balanceColor;
                                    
                                    if (openingBalance == 0)
                                    {
                                        openingBalanceText = "0.00";
                                        balanceColor = Colors.Black;
                                    }
                                    else if (openingBalance > 0)
                                    {
                                        openingBalanceText = $"{openingBalance:N2} Dr";
                                        balanceColor = Colors.Red.Darken2;
                                    }
                                    else
                                    {
                                        openingBalanceText = $"{Math.Abs(openingBalance):N2} Cr";
                                        balanceColor = Colors.Green.Darken2;
                                    }
                                    
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten3)
                                        .Text(openingBalanceText)
                                        .FontSize(8)
                                        .Bold()
                                        .FontColor(balanceColor)
                                        .AlignRight();
                                });

                                // Transaction rows
                                foreach (var transaction in allTransactions)
                                {
                                    runningBalance += transaction.Debit - transaction.Credit;

                                    // Determine background color based on status
                                    var bgColor = Colors.White;
                                    if (!string.IsNullOrEmpty(transaction.Status))
                                    {
                                        bgColor = transaction.Status == "Paid" ? Colors.Green.Lighten4
                                            : transaction.Status == "Partial" ? Colors.Yellow.Lighten4
                                            : Colors.Red.Lighten4;
                                    }

                                    // Format date: date only (no time to save space)
                                    var dateStr = transaction.Date.ToString("dd-MM-yyyy");
                                    var isPayment = transaction.Debit == 0 && transaction.Credit > 0;

                                    // Date
                                    table.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(3)
                                            .Background(bgColor)
                                            .Text(dateStr)
                                            .FontSize(8);
                                    });
                                    // Type
                                    var transactionType = isPayment ? "Payment" 
                                        : (transaction.Debit > 0 ? "Invoice" : "Return");
                                    table.Cell().Element(cell =>
                                    {
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(3)
                                            .Background(bgColor)
                                            .Text(transactionType)
                                            .FontSize(8)
                                            .Bold();
                                    });
                                    // Invoice Number
                                    table.Cell().Element(cell =>
                                    {
                                        var invoiceNo = string.IsNullOrEmpty(transaction.Particulars) ? "-" : transaction.Particulars;
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(3)
                                            .Background(bgColor)
                                            .Text(invoiceNo)
                                            .FontSize(8)
                                            .Bold();
                                    });
                                    // Payment Mode
                                    table.Cell().Element(cell =>
                                    {
                                        var paymentMode = string.IsNullOrEmpty(transaction.PaymentMode) ? "-" : transaction.PaymentMode;
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(3)
                                            .Background(bgColor)
                                            .Text(paymentMode)
                                            .FontSize(8);
                                    });
                                    // Debit - Always show if > 0, with proper formatting
                                    table.Cell().Element(cell =>
                                    {
                                        var debitText = transaction.Debit > 0 ? transaction.Debit.ToString("N2") : "-";
                                        var cellContent = cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(3)
                                            .Background(bgColor)
                                            .Text(debitText)
                                            .FontSize(8)
                                            .FontColor(transaction.Debit > 0 ? Colors.Red.Darken2 : Colors.Black);
                                        
                                        if (transaction.Debit > 0)
                                        {
                                            cellContent.Bold();
                                        }
                                        
                                        cellContent.AlignRight();
                                    });
                                    // Credit - Always show if > 0, with proper formatting
                                    table.Cell().Element(cell =>
                                    {
                                        var creditText = transaction.Credit > 0 ? transaction.Credit.ToString("N2") : "-";
                                        var cellContent = cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(3)
                                            .Background(bgColor)
                                            .Text(creditText)
                                            .FontSize(8)
                                            .FontColor(transaction.Credit > 0 ? Colors.Green.Darken2 : Colors.Black);
                                        
                                        if (transaction.Credit > 0)
                                        {
                                            cellContent.Bold();
                                        }
                                        
                                        cellContent.AlignRight();
                                    });
                                    // Status
                                    table.Cell().Element(cell =>
                                    {
                                        var statusText = string.IsNullOrEmpty(transaction.Status) ? "-" : transaction.Status;
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(3)
                                            .Background(bgColor)
                                            .Text(statusText)
                                            .FontSize(8)
                                            .Bold()
                                            .AlignCenter();
                                    });
                                    // Balance - Format with Dr/Cr notation (NO NEGATIVE NUMBERS)
                                    table.Cell().Element(cell =>
                                    {
                                        string balanceText;
                                        QuestPDF.Infrastructure.Color balanceColor;
                                        
                                        if (runningBalance == 0)
                                        {
                                            balanceText = "0.00";
                                            balanceColor = Colors.Black;
                                        }
                                        else if (runningBalance > 0)
                                        {
                                            balanceText = $"{runningBalance:N2} Dr";
                                            balanceColor = Colors.Red.Darken2;
                                        }
                                        else
                                        {
                                            balanceText = $"{Math.Abs(runningBalance):N2} Cr";
                                            balanceColor = Colors.Green.Darken2;
                                        }
                                        
                                        cell.Border(1).BorderColor(Colors.Black)
                                            .Padding(3)
                                            .Background(bgColor)
                                            .Text(balanceText)
                                            .FontSize(8)
                                            .Bold()
                                            .FontColor(balanceColor)
                                            .AlignRight();
                                    });
                                }

                                // CRITICAL: Closing balance row - Use final runningBalance from loop (matches ledger tab exactly)
                                // The runningBalance variable now contains the final balance after all transactions
                                var finalClosingBalance = runningBalance; // This is the final running balance from the loop
                                
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten2)
                                        .Text(toDate.ToString("dd-MM-yyyy"))
                                        .FontSize(8)
                                        .Bold();
                                });
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten2)
                                        .Text("CLOSING")
                                        .FontSize(8)
                                        .Bold();
                                });
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten2)
                                        .Text("-")
                                        .FontSize(8)
                                        .AlignCenter();
                                });
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten2)
                                        .Text("-")
                                        .FontSize(8)
                                        .AlignCenter();
                                });
                                table.Cell().Element(cell =>
                                {
                                    // Closing debit: show only if balance is positive (customer owes)
                                    var closingDebit = finalClosingBalance > 0 ? finalClosingBalance.ToString("N2") : "-";
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten2)
                                        .Text(closingDebit)
                                        .FontSize(8)
                                        .Bold()
                                        .FontColor(finalClosingBalance > 0 ? Colors.Red.Darken2 : Colors.Black)
                                        .AlignRight();
                                });
                                table.Cell().Element(cell =>
                                {
                                    // Closing credit: show only if balance is negative (customer has credit)
                                    var closingCredit = finalClosingBalance < 0 ? Math.Abs(finalClosingBalance).ToString("N2") : "-";
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten2)
                                        .Text(closingCredit)
                                        .FontSize(8)
                                        .Bold()
                                        .FontColor(finalClosingBalance < 0 ? Colors.Green.Darken2 : Colors.Black)
                                        .AlignRight();
                                });
                                table.Cell().Element(cell =>
                                {
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten2)
                                        .Text("-")
                                        .FontSize(8)
                                        .AlignCenter();
                                });
                                table.Cell().Element(cell =>
                                {
                                    // CRITICAL: Use finalClosingBalance (from running balance loop) - matches ledger tab exactly
                                    string closingBalanceText;
                                    QuestPDF.Infrastructure.Color balanceColor;
                                    
                                    if (finalClosingBalance == 0)
                                    {
                                        closingBalanceText = "0.00";
                                        balanceColor = Colors.Black;
                                    }
                                    else if (finalClosingBalance > 0)
                                    {
                                        closingBalanceText = $"{finalClosingBalance:N2} Dr";
                                        balanceColor = Colors.Red.Darken2;
                                    }
                                    else
                                    {
                                        closingBalanceText = $"{Math.Abs(finalClosingBalance):N2} Cr";
                                        balanceColor = Colors.Green.Darken2;
                                    }
                                    
                                    cell.Border(1).BorderColor(Colors.Black)
                                        .Padding(3)
                                        .Background(Colors.Grey.Lighten2)
                                        .Text(closingBalanceText)
                                        .FontSize(9)
                                        .Bold()
                                        .FontColor(balanceColor)
                                        .AlignRight();
                                });
                            });

                            // Footer summary - Professional Format
                            column.Item().PaddingTop(15).Row(row =>
                            {
                                row.RelativeItem();
                                row.ConstantItem(350).Border(1).BorderColor(Colors.Black)
                                    .Background(Colors.Grey.Lighten4)
                                    .Padding(10)
                                    .Column(col =>
                                {
                                        col.Item().Text("TOTALS SUMMARY")
                                            .FontSize(11)
                                            .Bold()
                                            .FontColor(Colors.Black)
                                            .AlignCenter();
                                        
                                        col.Item().PaddingTop(8).Row(sumRow =>
                                    {
                                        sumRow.RelativeItem().Text("Total Debit:")
                                                .FontSize(10)
                                            .Bold();
                                        sumRow.ConstantItem(100).Text($"{allTransactions.Sum(t => t.Debit):N2} {currency}")
                                                .FontSize(10)
                                            .Bold()
                                                .FontColor(Colors.Red.Darken2)
                                            .AlignRight();
                                    });
                                        col.Item().PaddingTop(5).Row(sumRow =>
                                    {
                                        sumRow.RelativeItem().Text("Total Credit:")
                                                .FontSize(10)
                                            .Bold();
                                        sumRow.ConstantItem(100).Text($"{allTransactions.Sum(t => t.Credit):N2} {currency}")
                                                .FontSize(10)
                                            .Bold()
                                                .FontColor(Colors.Green.Darken2)
                                            .AlignRight();
                                    });
                                        col.Item().PaddingTop(8).BorderTop(2).BorderColor(Colors.Black).Row(sumRow =>
                                    {
                                            // CRITICAL: Use calculated closing balance (matches running balance from loop)
                                            var netBalance = closingBalance; // This matches finalClosingBalance from table
                                            string netBalanceText;
                                            QuestPDF.Infrastructure.Color netColor;
                                            
                                            if (netBalance == 0)
                                            {
                                                netBalanceText = $"0.00 {currency}";
                                                netColor = Colors.Black;
                                            }
                                            else if (netBalance > 0)
                                            {
                                                netBalanceText = $"{netBalance:N2} {currency} Dr";
                                                netColor = Colors.Red.Darken2;
                                            }
                                            else
                                            {
                                                netBalanceText = $"{Math.Abs(netBalance):N2} {currency} Cr";
                                                netColor = Colors.Green.Darken2;
                                            }
                                            
                                            sumRow.RelativeItem().Text("NET BALANCE:")
                                                .FontSize(11)
                                            .Bold()
                                                .FontColor(Colors.Black);
                                            sumRow.ConstantItem(120).Text(netBalanceText)
                                                .FontSize(11)
                                                .Bold()
                                                .FontColor(netColor)
                                            .AlignRight();
                                    });
                                });
                            });
                        });

                    // Footer with Signatures
                    page.Footer()
                        .Column(column =>
                        {
                            column.Item().PaddingTop(15).Row(row =>
                            {
                                row.RelativeItem().Column(col =>
                                {
                                    col.Item().Text("For " + companyName)
                                        .FontSize(9)
                                        .Bold();
                                    col.Item().Height(40); // Space for signature
                                    col.Item().BorderTop(1).BorderColor(Colors.Black).PaddingTop(2)
                                        .Text("Authorized Signatory")
                                        .FontSize(8)
                                        .AlignCenter();
                                });
                                row.RelativeItem().Column(col =>
                                {
                                    col.Item().Text("Receiver's Sign:")
                                        .FontSize(9)
                                        .Bold()
                                        .AlignRight();
                                    col.Item().Height(40); // Space for signature
                                    col.Item().BorderTop(1).BorderColor(Colors.Black).PaddingTop(2)
                                        .Text("Customer Signature")
                                        .FontSize(8)
                                        .AlignCenter();
                                });
                            });
                            
                            column.Item().PaddingTop(5).BorderTop(1).BorderColor(Colors.Grey.Medium)
                        .AlignCenter()
                        .DefaultTextStyle(x => x.FontSize(8).FontColor(Colors.Grey.Medium))
                        .Text(x =>
                        {
                            x.CurrentPageNumber();
                            x.Span(" / ");
                            x.TotalPages();
                                });
                        });
                });
            });

            pdfBytes = document.GeneratePdf();
                }
                catch (Exception pdfEx)
                {
                    Console.WriteLine($"[GenerateCustomerStatementAsync] QuestPDF failed for customer {customerId}: {pdfEx.Message}");
                    Console.WriteLine($"[GenerateCustomerStatementAsync] QuestPDF Stack: {pdfEx.StackTrace}");
                    if (pdfEx.InnerException != null)
                        Console.WriteLine($"[GenerateCustomerStatementAsync] QuestPDF Inner: {pdfEx.InnerException.Message}");
                    throw new InvalidOperationException($"Failed to generate PDF. {pdfEx.Message}", pdfEx);
                }
            return pdfBytes;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Error generating customer statement PDF: {ex.Message}");
                Console.WriteLine($"❌ Stack Trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"❌ Inner Exception: {ex.InnerException.Message}");
                }
                throw; // Re-throw to be handled by controller
            }
        }

        public async Task<List<CustomerDto>> SearchCustomersAsync(string query, int tenantId, int limit = 20)
        {
            // NOTE: DatabaseFixer should only run at application startup (Program.cs)
            // Columns should exist from migrations.
            
            var searchTerm = query.ToLower();
            
            // Load into memory first to avoid column ordinal issues - Filter by tenantId
            var customersList = await _context.Customers
                .Where(c => c.TenantId == tenantId &&
                           (c.Name.ToLower().Contains(searchTerm) || 
                           (c.Phone != null && c.Phone.Contains(searchTerm)) ||
                           (c.Email != null && c.Email.ToLower().Contains(searchTerm)) ||
                           (c.Trn != null && c.Trn.Contains(searchTerm))))
                .OrderBy(c => c.Name)
                .Take(limit)
                .ToListAsync();

            var customers = customersList.Select(c => new CustomerDto
                {
                    Id = c.Id,
                Name = c.Name ?? string.Empty,
                    Phone = c.Phone,
                    Email = c.Email,
                    Trn = c.Trn,
                    Address = c.Address,
                    CreditLimit = c.CreditLimit,
                    Balance = c.Balance,
                    CustomerType = c.CustomerType.ToString(),
                    TotalSales = c.TotalSales,
                    TotalPayments = c.TotalPayments,
                    PendingBalance = c.PendingBalance,
                    LastPaymentDate = c.LastPaymentDate
            }).ToList();

            return customers;
        }

        /// <summary>
        /// Recalculates customer balance from all transactions (sales and payments)
        /// CRITICAL: Updates ALL balance fields (TotalSales, TotalPayments, PendingBalance, Balance)
        /// This fixes the "fake balance" issue by recalculating from actual data
        /// </summary>
        public async Task RecalculateCustomerBalanceAsync(int customerId, int tenantId)
        {
            // CRITICAL: Filter by both customerId and tenantId
            var customer = await _context.Customers
                .Where(c => c.Id == customerId && c.TenantId == tenantId)
                .FirstOrDefaultAsync();
            if (customer == null)
            {
                Console.WriteLine($"⚠️ Customer {customerId} not found for balance recalculation");
                return;
            }

            // Calculate total sales (debits) - exclude deleted
            var totalSales = await _context.Sales
                .Where(s => s.CustomerId == customerId && s.TenantId == tenantId && !s.IsDeleted)
                .SumAsync(s => (decimal?)s.GrandTotal) ?? 0m;

            // CLEARED only; exclude refund payments (SaleReturnId != null) - they are money out, not in
            var totalPayments = await _context.Payments
                .Where(p => p.CustomerId == customerId && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED && p.SaleReturnId == null)
                .SumAsync(p => (decimal?)p.Amount) ?? 0m;

            var totalSalesReturns = await _context.SaleReturns
                .Where(sr => sr.CustomerId == customerId && sr.TenantId == tenantId && sr.Status == ReturnStatus.Approved)
                .SumAsync(sr => (decimal?)sr.GrandTotal) ?? 0m;

            var refundsPaid = await _context.Payments
                .Where(p => p.CustomerId == customerId && p.TenantId == tenantId && p.SaleReturnId != null && p.Status != PaymentStatus.VOID)
                .SumAsync(p => (decimal?)p.Amount) ?? 0m;

            var pendingBalance = totalSales - totalPayments - totalSalesReturns + refundsPaid;

            // Get last payment date
            var lastPaymentDate = await _context.Payments
                .Where(p => p.CustomerId == customerId && p.TenantId == tenantId)
                .OrderByDescending(p => p.PaymentDate)
                .Select(p => (DateTime?)p.PaymentDate)
                .FirstOrDefaultAsync();

            // CRITICAL: Update ALL balance tracking fields
            customer.TotalSales = totalSales;
            customer.TotalPayments = totalPayments;
            customer.PendingBalance = pendingBalance;
            customer.Balance = pendingBalance; // Keep legacy field in sync
            customer.LastPaymentDate = lastPaymentDate;
            customer.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();
            Console.WriteLine($"✅ Recalculated balance for {customer.Name}: PendingBalance={pendingBalance:N2} (Sales: {totalSales:N2}, Payments: {totalPayments:N2}, Returns: {totalSalesReturns:N2}, RefundsPaid: {refundsPaid:N2})");
        }

        /// <summary>
        /// Recalculates balances for all customers (useful for fixing corrupted data)
        /// CRITICAL: Updates ALL balance fields (TotalSales, TotalPayments, PendingBalance, Balance)
        /// </summary>
        public async Task RecalculateAllCustomerBalancesAsync(int tenantId)
        {
            // CRITICAL: Filter by tenantId
            var customers = await _context.Customers
                .Where(c => c.TenantId == tenantId)
                .ToListAsync();
            
            int fixedCount = 0;
            foreach (var customer in customers)
            {
                var totalSales = await _context.Sales
                    .Where(s => s.CustomerId == customer.Id && s.TenantId == tenantId && !s.IsDeleted)
                    .SumAsync(s => (decimal?)s.GrandTotal) ?? 0m;

                var totalPayments = await _context.Payments
                    .Where(p => p.CustomerId == customer.Id && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED && p.SaleReturnId == null)
                    .SumAsync(p => (decimal?)p.Amount) ?? 0m;

                var totalSalesReturns = await _context.SaleReturns
                    .Where(sr => sr.CustomerId == customer.Id && sr.TenantId == tenantId && sr.Status == ReturnStatus.Approved)
                    .SumAsync(sr => (decimal?)sr.GrandTotal) ?? 0m;

                var refundsPaid = await _context.Payments
                    .Where(p => p.CustomerId == customer.Id && p.TenantId == tenantId && p.SaleReturnId != null && p.Status != PaymentStatus.VOID)
                    .SumAsync(p => (decimal?)p.Amount) ?? 0m;

                var pendingBalance = totalSales - totalPayments - totalSalesReturns + refundsPaid;
                
                // Get last payment date
                var lastPaymentDate = await _context.Payments
                    .Where(p => p.CustomerId == customer.Id && p.TenantId == tenantId)
                    .OrderByDescending(p => p.PaymentDate)
                    .Select(p => (DateTime?)p.PaymentDate)
                    .FirstOrDefaultAsync();

                // Check if any field needs updating
                if (customer.TotalSales != totalSales || 
                    customer.TotalPayments != totalPayments || 
                    customer.PendingBalance != pendingBalance ||
                    customer.Balance != pendingBalance)
                {
                    fixedCount++;
                }

                // CRITICAL: Update ALL balance tracking fields
                customer.TotalSales = totalSales;
                customer.TotalPayments = totalPayments;
                customer.PendingBalance = pendingBalance;
                customer.Balance = pendingBalance; // Keep legacy field in sync
                customer.LastPaymentDate = lastPaymentDate;
                customer.UpdatedAt = DateTime.UtcNow;
            }

            await _context.SaveChangesAsync();
            Console.WriteLine($"✅ Recalculated balances for {customers.Count} customers, fixed {fixedCount} with discrepancies");
        }

        public async Task<List<Models.OutstandingInvoiceDto>> GetOutstandingInvoicesAsync(int customerId, int tenantId)
        {
            // Get all unpaid or partially paid sales for this customer
            var sales = await _context.Sales
                .Where(s => s.CustomerId == customerId && s.TenantId == tenantId && 
                           !s.IsDeleted &&
                           (s.PaymentStatus == SalePaymentStatus.Pending || s.PaymentStatus == SalePaymentStatus.Partial))
                .OrderByDescending(s => s.InvoiceDate)
                .ToListAsync();

            var outstandingInvoices = new List<Models.OutstandingInvoiceDto>();

            foreach (var sale in sales)
            {
                // Use Sale.PaidAmount directly (maintained atomically by PaymentService)
                var paidAmount = sale.PaidAmount;
                var balanceAmount = sale.GrandTotal - paidAmount;

                // Only include if there's still a balance
                if (balanceAmount > 0)
                {
                    // CRITICAL: Use DueDate from sale, fallback to 30 days if not set
                    var dueDate = sale.DueDate ?? sale.InvoiceDate.AddDays(30);
                    var daysOverdue = dueDate < DateTime.Today ? (DateTime.Today - dueDate).Days : 0;

                outstandingInvoices.Add(new Models.OutstandingInvoiceDto
                {
                    Id = sale.Id,
                    InvoiceNo = sale.InvoiceNo,
                    InvoiceDate = sale.InvoiceDate,
                    GrandTotal = sale.GrandTotal,
                    PaidAmount = paidAmount,
                    BalanceAmount = balanceAmount,
                    PaymentStatus = sale.PaymentStatus.ToString(),
                    DaysOverdue = daysOverdue
                });
                }
            }

            return outstandingInvoices.OrderByDescending(i => i.DaysOverdue).ThenByDescending(i => i.InvoiceDate).ToList();
        }

        /// <summary>
        /// CRITICAL: Recalculates PaymentStatus and PaidAmount for ALL invoices of a customer
        /// This fixes stale/incorrect payment status in sales table
        /// </summary>
        public async Task<int> RecalculateCustomerInvoiceStatusesAsync(int customerId, int tenantId)
        {
            var sales = await _context.Sales
                .Where(s => s.CustomerId == customerId && s.TenantId == tenantId && !s.IsDeleted)
                .ToListAsync();

            int fixedCount = 0;
            foreach (var sale in sales)
            {
                // Calculate ACTUAL paid amount from Payments table
                var actualPaid = await _context.Payments
                    .Where(p => p.SaleId == sale.Id && p.TenantId == tenantId && p.Status != PaymentStatus.VOID)
                    .SumAsync(p => (decimal?)p.Amount) ?? 0m;

                var oldPaid = sale.PaidAmount;
                var oldStatus = sale.PaymentStatus;

                // Update PaidAmount
                sale.PaidAmount = actualPaid;

                // Update PaymentStatus based on actual paid
                if (actualPaid >= sale.GrandTotal)
                    sale.PaymentStatus = SalePaymentStatus.Paid;
                else if (actualPaid > 0)
                    sale.PaymentStatus = SalePaymentStatus.Partial;
                else
                    sale.PaymentStatus = SalePaymentStatus.Pending;

                if (oldPaid != actualPaid || oldStatus != sale.PaymentStatus)
                {
                    fixedCount++;
                    Console.WriteLine($"\u2705 Fixed Invoice {sale.InvoiceNo}: PaidAmount {oldPaid}->{actualPaid}, Status {oldStatus}->{sale.PaymentStatus}");
                }
            }

            if (fixedCount > 0)
                await _context.SaveChangesAsync();

            Console.WriteLine($"\u2705 Recalculated {sales.Count} invoices for customer {customerId}, fixed {fixedCount}");
            return fixedCount;
        }

        /// <summary>
        /// CRITICAL: Recalculates PaymentStatus and PaidAmount for ALL cash customer invoices (where CustomerId is NULL)
        /// This fixes stale/incorrect payment status in sales table for cash transactions
        /// </summary>
        public async Task<int> RecalculateCashCustomerInvoiceStatusesAsync(int tenantId)
        {
            // Find all cash customer sales (CustomerId is NULL)
            var sales = await _context.Sales
                .Where(s => s.CustomerId == null && s.TenantId == tenantId && !s.IsDeleted)
                .ToListAsync();

            int fixedCount = 0;
            foreach (var sale in sales)
            {
                // Calculate ACTUAL paid amount from Payments table
                var actualPaid = await _context.Payments
                    .Where(p => p.SaleId == sale.Id && p.TenantId == tenantId && p.Status != PaymentStatus.VOID)
                    .SumAsync(p => (decimal?)p.Amount) ?? 0m;

                var oldPaid = sale.PaidAmount;
                var oldStatus = sale.PaymentStatus;

                // Update PaidAmount
                sale.PaidAmount = actualPaid;

                // Update PaymentStatus based on actual paid
                if (actualPaid >= sale.GrandTotal)
                    sale.PaymentStatus = SalePaymentStatus.Paid;
                else if (actualPaid > 0)
                    sale.PaymentStatus = SalePaymentStatus.Partial;
                else
                    sale.PaymentStatus = SalePaymentStatus.Pending;

                if (oldPaid != actualPaid || oldStatus != sale.PaymentStatus)
                {
                    fixedCount++;
                    Console.WriteLine($"\u2705 Fixed Cash Invoice {sale.InvoiceNo}: PaidAmount {oldPaid}->{actualPaid}, Status {oldStatus}->{sale.PaymentStatus}");
                }
            }

            if (fixedCount > 0)
                await _context.SaveChangesAsync();

            Console.WriteLine($"\u2705 Recalculated {sales.Count} cash customer invoices, fixed {fixedCount}");
            return fixedCount;
        }
    }
}

