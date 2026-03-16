/*
Purpose: Tenant context middleware for multi-tenant SaaS isolation
Author: AI Assistant
Date: 2026
*/
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;

namespace HexaBill.Api.Shared.Middleware
{
    /// <summary>
    /// Middleware that validates tenant and sets context for every request
    /// MUST be registered AFTER authentication, BEFORE authorization
    /// </summary>
    public class TenantContextMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<TenantContextMiddleware> _logger;
        private readonly IWebHostEnvironment _env;

        public TenantContextMiddleware(RequestDelegate next, ILogger<TenantContextMiddleware> logger, IWebHostEnvironment env)
        {
            _next = next;
            _logger = logger;
            _env = env;
        }

        public async Task InvokeAsync(HttpContext context, AppDbContext dbContext)
        {
            // Skip for public endpoints
            var path = context.Request.Path.Value?.ToLowerInvariant() ?? "";
            if (path.StartsWith("/api/auth") ||
                path.StartsWith("/health") ||
                path == "/" ||
                path.StartsWith("/swagger"))
            {
                await _next(context);
                return;
            }

            // Skip if not authenticated
            if (!context.User.Identity?.IsAuthenticated ?? true)
            {
                await _next(context);
                return;
            }

            try
            {
                // Extract tenant_id from JWT claim - check multiple claim type formats (JWT serialization may vary)
                var tenantIdClaim = context.User.FindFirst("tenant_id")?.Value
                    ?? context.User.FindFirst("owner_id")?.Value
                    ?? context.User.Claims.FirstOrDefault(c => c.Type.EndsWith("tenant_id", StringComparison.OrdinalIgnoreCase))?.Value
                    ?? context.User.Claims.FirstOrDefault(c => c.Type.EndsWith("owner_id", StringComparison.OrdinalIgnoreCase))?.Value;

                if (string.IsNullOrEmpty(tenantIdClaim))
                {
                    _logger.LogWarning("No tenant_id or owner_id claim found in token for user {UserId}",
                        context.User.FindFirst("id")?.Value);
                    
                    // SystemAdmin may not have tenant_id - allow to proceed
                    context.Items["TenantId"] = 0; // 0 = SystemAdmin
                    await _next(context);
                    return;
                }

                if (!int.TryParse(tenantIdClaim, out int tenantId))
                {
                    _logger.LogError("Invalid tenant_id format in token: {TenantIdClaim}", tenantIdClaim);
                    context.Response.StatusCode = 401;
                    await context.Response.WriteAsync("Invalid tenant context");
                    return;
                }

                // SystemAdmin has TenantId = 0 (or null in database)
                if (tenantId == 0)
                {
                    context.Items["TenantId"] = 0;
                    await _next(context);
                    return;
                }

                // Validate tenant exists and is active
                // TEMPORARY FIX: Handle missing FeaturesJson column until migration runs
                Tenant? tenant = null;
                try
                {
                    tenant = await dbContext.Tenants
                        .AsNoTracking()
                        .FirstOrDefaultAsync(t => t.Id == tenantId);
                }
                catch (Exception ex)
                {
                    // Check if this is a PostgresException about missing FeaturesJson column
                    // EF Core may wrap it, so check both the exception itself and inner exceptions
                    var pgEx = ex as Npgsql.PostgresException 
                        ?? ex.InnerException as Npgsql.PostgresException
                        ?? (ex.InnerException?.InnerException as Npgsql.PostgresException);
                    
                    if (pgEx != null && pgEx.SqlState == "42703" && pgEx.MessageText.Contains("FeaturesJson"))
                    {
                        // FeaturesJson column doesn't exist yet - try to add it, then use raw SQL query
                        _logger.LogWarning("FeaturesJson column not found - attempting to add column and use raw SQL query.");
                        var connection = dbContext.Database.GetDbConnection();
                        var wasOpen = connection.State == System.Data.ConnectionState.Open;
                        if (!wasOpen) await connection.OpenAsync();
                        
                        try
                        {
                            // Try to add the column if it doesn't exist
                            try
                            {
                                using var addColumnCmd = connection.CreateCommand();
                                addColumnCmd.CommandText = @"ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""FeaturesJson"" character varying(2000) NULL;";
                                await addColumnCmd.ExecuteNonQueryAsync();
                                _logger.LogInformation("✅ Successfully added FeaturesJson column to Tenants table");
                            }
                            catch (Exception addColumnEx)
                            {
                                // Column may already exist or we don't have permission - that's OK, continue with raw SQL
                                _logger.LogWarning(addColumnEx, "Could not add FeaturesJson column (may already exist or permission issue) - continuing with raw SQL");
                            }
                            
                            // Always use raw SQL fallback after attempting to add column
                            // This ensures we get the tenant even if EF Core model cache hasn't refreshed yet
                            // Check if FeaturesJson column exists before including it in SELECT
                            bool hasFeaturesJson = false;
                            try
                            {
                                using var checkColumnCmd = connection.CreateCommand();
                                checkColumnCmd.CommandText = @"
                                    SELECT EXISTS (
                                        SELECT 1 FROM information_schema.columns 
                                        WHERE table_schema = 'public' 
                                        AND table_name = 'Tenants' 
                                        AND column_name = 'FeaturesJson'
                                    )";
                                using (var checkReader = await checkColumnCmd.ExecuteReaderAsync())
                                {
                                    if (await checkReader.ReadAsync())
                                    {
                                        hasFeaturesJson = checkReader.GetBoolean(0);
                                    }
                                }
                            }
                            catch (Exception checkEx)
                            {
                                _logger.LogWarning(checkEx, "Could not check for FeaturesJson column - assuming it doesn't exist");
                                hasFeaturesJson = false;
                            }
                            
                            // Query tenant using raw SQL (without FeaturesJson if column doesn't exist)
                            using var command = connection.CreateCommand();
                            if (hasFeaturesJson)
                            {
                                command.CommandText = @"
                                    SELECT ""Id"", ""Name"", ""Subdomain"", ""Domain"", ""Country"", ""Currency"", 
                                           ""VatNumber"", ""CompanyNameEn"", ""CompanyNameAr"", ""Address"", 
                                           ""Phone"", ""Email"", ""LogoPath"", ""Status"", ""CreatedAt"", 
                                           ""TrialEndDate"", ""SuspendedAt"", ""SuspensionReason"",
                                           ""FeaturesJson""
                                    FROM ""Tenants""
                                    WHERE ""Id"" = @tenantId";
                            }
                            else
                            {
                                command.CommandText = @"
                                    SELECT ""Id"", ""Name"", ""Subdomain"", ""Domain"", ""Country"", ""Currency"", 
                                           ""VatNumber"", ""CompanyNameEn"", ""CompanyNameAr"", ""Address"", 
                                           ""Phone"", ""Email"", ""LogoPath"", ""Status"", ""CreatedAt"", 
                                           ""TrialEndDate"", ""SuspendedAt"", ""SuspensionReason""
                                    FROM ""Tenants""
                                    WHERE ""Id"" = @tenantId";
                            }
                            var param = command.CreateParameter();
                            param.ParameterName = "@tenantId";
                            param.Value = tenantId;
                            command.Parameters.Add(param);
                            
                            using var reader = await command.ExecuteReaderAsync();
                            if (await reader.ReadAsync())
                            {
                                var fieldCount = reader.FieldCount;
                                tenant = new Tenant
                                {
                                    Id = reader.GetInt32(0),
                                    Name = reader.GetString(1),
                                    Subdomain = reader.IsDBNull(2) ? null : reader.GetString(2),
                                    Domain = reader.IsDBNull(3) ? null : reader.GetString(3),
                                    Country = reader.GetString(4),
                                    Currency = reader.GetString(5),
                                    VatNumber = reader.IsDBNull(6) ? null : reader.GetString(6),
                                    CompanyNameEn = reader.IsDBNull(7) ? null : reader.GetString(7),
                                    CompanyNameAr = reader.IsDBNull(8) ? null : reader.GetString(8),
                                    Address = reader.IsDBNull(9) ? null : reader.GetString(9),
                                    Phone = reader.IsDBNull(10) ? null : reader.GetString(10),
                                    Email = reader.IsDBNull(11) ? null : reader.GetString(11),
                                    LogoPath = reader.IsDBNull(12) ? null : reader.GetString(12),
                                    Status = (TenantStatus)reader.GetInt32(13),
                                    CreatedAt = reader.GetDateTime(14),
                                    TrialEndDate = reader.IsDBNull(15) ? null : reader.GetDateTime(15),
                                    SuspendedAt = reader.IsDBNull(16) ? null : reader.GetDateTime(16),
                                    SuspensionReason = reader.IsDBNull(17) ? null : reader.GetString(17),
                                    FeaturesJson = hasFeaturesJson && fieldCount > 18 && !reader.IsDBNull(18) ? reader.GetString(18) : null
                                };
                                _logger.LogInformation("✅ Successfully retrieved tenant {TenantId} using raw SQL fallback", tenantId);
                            }
                            else
                            {
                                _logger.LogWarning("Tenant {TenantId} not found in database (raw SQL query returned no rows)", tenantId);
                            }
                        }
                        catch (Exception rawSqlEx)
                        {
                            // If raw SQL also fails, log and let it fall through to tenant == null check
                            _logger.LogError(rawSqlEx, "❌ Raw SQL fallback query also failed for tenant {TenantId}", tenantId);
                            tenant = null; // Ensure tenant is null so we can handle it below
                        }
                        finally
                        {
                            if (!wasOpen && connection.State == System.Data.ConnectionState.Open)
                                await connection.CloseAsync();
                        }
                    }
                    else
                    {
                        // Re-throw if it's not the FeaturesJson column error
                        throw;
                    }
                }

                if (tenant == null)
                {
                    // SECURITY: Development tenant fallback REMOVED - never substitute another tenant (cross-tenant data leakage risk)
                    _logger.LogWarning("Tenant {TenantId} not found in database", tenantId);
                    context.Response.StatusCode = 403;
                    await context.Response.WriteAsync("Tenant not found");
                    return;
                }

                // Check tenant status - in Development, auto-activate suspended/expired tenants
                var wouldBlock = tenant.Status == TenantStatus.Suspended ||
                    tenant.Status == TenantStatus.Expired ||
                    (tenant.Status == TenantStatus.Trial && tenant.TrialEndDate.HasValue && tenant.TrialEndDate.Value < DateTime.UtcNow);

                if (wouldBlock && _env.IsDevelopment())
                {
                    _logger.LogInformation("Development: Auto-activating tenant {TenantId} ({Name}) - was {Status}", tenant.Id, tenant.Name, tenant.Status);
                    try
                    {
                        var dbTenant = await dbContext.Tenants.FindAsync(tenantId);
                        if (dbTenant != null)
                        {
                            dbTenant.Status = TenantStatus.Active;
                            dbTenant.TrialEndDate = null;
                            await dbContext.SaveChangesAsync();
                        }
                    }
                    catch (Exception activateEx)
                    {
                        // If FeaturesJson column is missing, skip activation (non-critical)
                        var pgEx = activateEx as Npgsql.PostgresException 
                            ?? activateEx.InnerException as Npgsql.PostgresException
                            ?? (activateEx.InnerException?.InnerException as Npgsql.PostgresException);
                        if (pgEx != null && pgEx.SqlState == "42703" && pgEx.MessageText.Contains("FeaturesJson"))
                        {
                            _logger.LogWarning("Skipping tenant activation due to missing FeaturesJson column");
                        }
                        else
                        {
                            throw;
                        }
                    }
                    // CRITICAL: Must not fall through to 403 - continue to set tenant context
                }
                else if (wouldBlock)
                {
                    // Production: block suspended/expired tenants
                    var reason = tenant.Status == TenantStatus.Suspended ? "Tenant account is suspended"
                        : tenant.Status == TenantStatus.Expired ? "Tenant trial has expired"
                        : "Tenant trial has expired";
                    _logger.LogWarning("Tenant {TenantId} blocked: {Status}", tenantId, tenant.Status);
                    context.Response.StatusCode = 403;
                    await context.Response.WriteAsync(reason);
                    return;
                }

                // Set tenant context
                context.Items["TenantId"] = tenantId;

                // Set PostgreSQL session variable for RLS only when using PostgreSQL (SQLite does not support SET)
                var connString = (dbContext.Database.GetConnectionString() ?? "").Trim();
                var isSqlite = connString.StartsWith("Data Source=", StringComparison.OrdinalIgnoreCase) ||
                              connString.Contains(".db", StringComparison.OrdinalIgnoreCase);
                var isPostgres = connString.StartsWith("Host=", StringComparison.OrdinalIgnoreCase) ||
                                connString.StartsWith("Server=", StringComparison.OrdinalIgnoreCase);
                if (!isSqlite && isPostgres)
                {
                    try
                    {
                        // PostgreSQL SET does not accept parameterized $1; use set_config which does
                        await dbContext.Database.ExecuteSqlRawAsync(
                            "SELECT set_config('app.tenant_id', {0}, true)",
                            tenantId.ToString());
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to set PostgreSQL session variable app.tenant_id");
                    }
                }

                await _next(context);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in TenantContextMiddleware");
                context.Response.StatusCode = 500;
                await context.Response.WriteAsync("Internal server error");
            }
        }
    }

    public static class TenantContextMiddlewareExtensions
    {
        public static IApplicationBuilder UseTenantContext(this IApplicationBuilder builder)
        {
            return builder.UseMiddleware<TenantContextMiddleware>();
        }
    }
}
