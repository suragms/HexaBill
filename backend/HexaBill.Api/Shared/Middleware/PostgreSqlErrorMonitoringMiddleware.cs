/*
 * CRITICAL: PostgreSQL Error Monitoring & Detection Middleware
 * Purpose: Advanced error tracking for PostgreSQL DateTime issues and other critical bugs
 * Author: AI Assistant
 * Date: 2024-12-26
 */

using System.Diagnostics;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using HexaBill.Api.Shared.Services;
using HexaBill.Api.Shared.Extensions;

namespace HexaBill.Api.Shared.Middleware
{
    public class PostgreSqlErrorMonitoringMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<PostgreSqlErrorMonitoringMiddleware> _logger;
        private static readonly Dictionary<string, int> _errorCounts = new();
        private static readonly object _lockObject = new();

        public PostgreSqlErrorMonitoringMiddleware(RequestDelegate next, ILogger<PostgreSqlErrorMonitoringMiddleware> logger)
        {
            _next = next;
            _logger = logger;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var stopwatch = Stopwatch.StartNew();
            var requestPath = context.Request.Path.Value ?? "unknown";
            var requestMethod = context.Request.Method;
            // PROD-18: Use correlation ID from RequestLoggingMiddleware if available, otherwise create one
            var correlationId = context.GetCorrelationIdOrNull() ?? Guid.NewGuid().ToString("N")[..12];
            context.SetCorrelationId(correlationId); // Ensure it's set

            _logger.LogInformation("🔍 [CorrelationId: {CorrelationId}] {Method} {Path} - Request started", 
                correlationId, requestMethod, requestPath);

            try
            {
                await _next(context);
                
                stopwatch.Stop();
                _logger.LogInformation("✅ [CorrelationId: {CorrelationId}] {Method} {Path} - Completed in {ElapsedMs}ms (Status: {StatusCode})", 
                    correlationId, requestMethod, requestPath, stopwatch.ElapsedMilliseconds, context.Response.StatusCode);
            }
            catch (Exception ex)
            {
                stopwatch.Stop();
                await HandleExceptionAsync(context, ex, requestPath, requestMethod, correlationId, stopwatch.ElapsedMilliseconds);
            }
        }

        private async Task HandleExceptionAsync(HttpContext context, Exception exception, string requestPath, 
            string requestMethod, string correlationId, long elapsedMs)
        {
            var errorDetails = new StringBuilder();
            errorDetails.AppendLine($"❌ CRITICAL ERROR DETECTED");
            errorDetails.AppendLine($"Correlation ID: {correlationId}");
            errorDetails.AppendLine($"Endpoint: {requestMethod} {requestPath}");
            errorDetails.AppendLine($"Time Elapsed: {elapsedMs}ms");
            errorDetails.AppendLine($"Timestamp: {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
            errorDetails.AppendLine($"Exception Type: {exception.GetType().Name}");
            errorDetails.AppendLine($"Message: {exception.Message}");
            
            // Check for specific PostgreSQL errors
            var errorType = ClassifyError(exception);
            errorDetails.AppendLine($"Error Classification: {errorType}");
            
            // Track error frequency
            TrackErrorFrequency(errorType);
            
            // Detailed PostgreSQL error analysis
            if (IsPostgreSqlError(exception, out var pgException) && pgException != null)
            {
                errorDetails.AppendLine("\n🔴 POSTGRESQL ERROR DETAILS:");
                AnalyzePostgreSqlError(pgException, errorDetails);
            }

            // DateTime.Kind specific detection
            if (IsDateTimeKindError(exception))
            {
                errorDetails.AppendLine("\n⚠️ DATETIME.KIND ERROR DETECTED:");
                errorDetails.AppendLine("This is a DateTime.Kind=Unspecified error!");
                errorDetails.AppendLine("SOLUTION: Ensure all DateTime values use .ToUtcKind() before PostgreSQL queries");
                errorDetails.AppendLine($"Stack Trace Preview: {exception.StackTrace?.Split('\n').FirstOrDefault()?.Trim()}");
                
                // Extract the problematic line from stack trace
                var stackLines = exception.StackTrace?.Split('\n') ?? Array.Empty<string>();
                foreach (var line in stackLines.Take(5))
                {
                    if (line.Contains("HexaBill.Api"))
                    {
                        errorDetails.AppendLine($"  → {line.Trim()}");
                    }
                }
            }

            // Log full inner chain for any exception (so INVALID_OPERATION shows real cause e.g. 42703 / missing column)
            var inner = exception?.InnerException;
            var depth = 0;
            if (inner != null)
            {
                errorDetails.AppendLine("\n📊 INNER EXCEPTION CHAIN:");
                while (inner != null && depth < 5)
                {
                    errorDetails.AppendLine($"Inner[{depth}]: {inner.GetType().Name}: {inner.Message}");
                    if (inner is Npgsql.PostgresException pgEx)
                        errorDetails.AppendLine($"  SQL State: {pgEx.SqlState}, Detail: {pgEx.Detail}");
                    if (exception is DbUpdateException dbEx && depth == 0)
                    {
                        var firstEntry = dbEx.Entries?.FirstOrDefault();
                        errorDetails.AppendLine($"  Failed Entity: {firstEntry?.Entity?.GetType().Name ?? "Unknown"}, State: {firstEntry?.State}");
                    }
                    inner = inner.InnerException;
                    depth++;
                }
            }

            // Log the full error details
            _logger.LogError(exception, errorDetails.ToString());
            
            // Also log to console for immediate visibility
            Console.WriteLine("\n" + new string('=', 80));
            Console.WriteLine(errorDetails.ToString());
            Console.WriteLine(new string('=', 80) + "\n");

            // Skip persisting to ErrorLogs when the error is missing column / ResolvedAt (avoids second failure if ErrorLogs schema is behind)
            if (!IsMissingColumnOrErrorLogsException(exception))
            {
            // Persist to ErrorLogs (SuperAdmin visibility)
            try
            {
                using var scope = context.RequestServices.CreateScope();
                var errorLogService = scope.ServiceProvider.GetService<IErrorLogService>();
                if (errorLogService != null)
                {
                    int? tenantId = null;
                    if (context.User?.Identity?.IsAuthenticated == true)
                        tenantId = context.User.GetTenantIdOrNullForSystemAdmin();
                    var userIdClaim = context.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                        ?? context.User?.FindFirst("id")?.Value;
                    int? userId = int.TryParse(userIdClaim, out var uid) ? uid : null;
                    await errorLogService.LogAsync(
                        correlationId,
                        errorType,
                        exception.Message.Length > 500 ? exception.Message[..500] : exception.Message,
                        exception.StackTrace,
                        requestPath,
                        requestMethod,
                        tenantId,
                        userId);
                }
            }
            catch { /* do not fail response */ }
            }

            // Enterprise structured response
            context.Response.StatusCode = 500;
            context.Response.ContentType = "application/json";
            var utc = DateTime.UtcNow;
            var response = new
            {
                errorCode = errorType,
                message = GetUserFriendlyMessage(errorType),
                traceId = correlationId,
                correlationId = correlationId,
                timestamp = utc
            };
            await context.Response.WriteAsJsonAsync(response);
        }

        private string ClassifyError(Exception exception)
        {
            if (IsDateTimeKindError(exception))
                return "DATETIME_KIND_UNSPECIFIED";

            // Unwrap any exception type: if 42703 (undefined column) is in the chain, classify as missing column (production schema behind).
            if (HasInnerPostgresState(exception, "42703"))
                return "EF_MISSING_COLUMN_42703";

            if (exception is NpgsqlException npgEx)
            {
                return npgEx.SqlState switch
                {
                    "22007" => "POSTGRESQL_INVALID_DATETIME",
                    "22008" => "POSTGRESQL_DATETIME_OVERFLOW",
                    "42P01" => "POSTGRESQL_TABLE_NOT_FOUND",
                    "23505" => "POSTGRESQL_UNIQUE_VIOLATION",
                    "23503" => "POSTGRESQL_FOREIGN_KEY_VIOLATION",
                    "08006" => "POSTGRESQL_CONNECTION_FAILURE",
                    _ => $"POSTGRESQL_ERROR_{npgEx.SqlState}"
                };
            }

            if (exception is DbUpdateException)
                return "EF_CORE_UPDATE_ERROR";

            if (exception is InvalidOperationException)
                return "INVALID_OPERATION";

            if (exception is ArgumentException)
                return "INVALID_ARGUMENT";

            return "GENERAL_ERROR";
        }

        /// <summary>True if exception chain contains a PostgreSQL error with the given SqlState (e.g. 42703 = undefined column).</summary>
        private static bool HasInnerPostgresState(Exception exception, string sqlState)
        {
            var inner = exception?.InnerException;
            var depth = 0;
            while (inner != null && depth < 5)
            {
                if (inner is Npgsql.PostgresException pgEx && string.Equals(pgEx.SqlState, sqlState, StringComparison.Ordinal))
                    return true;
                inner = inner.InnerException;
                depth++;
            }
            return false;
        }

        /// <summary>True if exception indicates missing column/table (e.g. ErrorLogs.ResolvedAt). Skip ErrorLog persist to avoid second failure.</summary>
        private static bool IsMissingColumnOrErrorLogsException(Exception exception)
        {
            if (HasInnerPostgresState(exception, "42703"))
                return true;
            var msg = exception?.Message ?? "";
            return msg.Contains("errorMissingColumn", StringComparison.OrdinalIgnoreCase)
                || msg.Contains("ResolvedAt", StringComparison.OrdinalIgnoreCase);
        }

        private bool IsDateTimeKindError(Exception exception)
        {
            var message = exception.Message?.ToLower() ?? "";
            return message.Contains("datetime with kind=unspecified") ||
                   message.Contains("datetimekind.unspecified") ||
                   message.Contains("only utc is supported") ||
                   (exception is ArgumentException && message.Contains("datetime") && message.Contains("kind"));
        }

        private bool IsPostgreSqlError(Exception exception, out NpgsqlException? pgException)
        {
            pgException = null;
            
            if (exception is NpgsqlException npgEx)
            {
                pgException = npgEx;
                return true;
            }

            if (exception.InnerException is NpgsqlException innerNpgEx)
            {
                pgException = innerNpgEx;
                return true;
            }

            return false;
        }

        private void AnalyzePostgreSqlError(NpgsqlException pgException, StringBuilder errorDetails)
        {
            errorDetails.AppendLine($"SQL State: {pgException.SqlState ?? "Unknown"}");
            errorDetails.AppendLine($"Message: {pgException.Message}");
            
            // Try to get additional details from Data collection
            if (pgException.Data.Count > 0)
            {
                errorDetails.AppendLine("Additional Details:");
                foreach (var key in pgException.Data.Keys)
                {
                    errorDetails.AppendLine($"  {key}: {pgException.Data[key]}");
                }
            }

            // Provide specific solutions
            errorDetails.AppendLine("\n💡 SOLUTION HINTS:");
            switch (pgException.SqlState)
            {
                case "22007":
                case "22008":
                    errorDetails.AppendLine("  - Check DateTime values being sent to PostgreSQL");
                    errorDetails.AppendLine("  - Ensure all DateTime use .ToUtcKind() extension method");
                    errorDetails.AppendLine("  - Verify DateTimeKind is set to UTC");
                    break;
                case "23505":
                    errorDetails.AppendLine("  - Duplicate key violation - check for unique constraint conflicts");
                    break;
                case "23503":
                    errorDetails.AppendLine("  - Foreign key violation - ensure referenced records exist");
                    break;
                case "08006":
                    errorDetails.AppendLine("  - Database connection lost - check network and database status");
                    break;
            }
        }

        private void TrackErrorFrequency(string errorType)
        {
            lock (_lockObject)
            {
                if (!_errorCounts.ContainsKey(errorType))
                    _errorCounts[errorType] = 0;
                
                _errorCounts[errorType]++;

                if (_errorCounts[errorType] % 5 == 0)
                {
                    _logger.LogWarning("⚠️ ERROR FREQUENCY ALERT: {ErrorType} has occurred {Count} times", 
                        errorType, _errorCounts[errorType]);
                }
            }
        }

        private string GetUserFriendlyMessage(string errorType)
        {
            return errorType switch
            {
                "DATETIME_KIND_UNSPECIFIED" => "Data loading error. Our team has been notified and is working on a fix.",
                "POSTGRESQL_INVALID_DATETIME" => "Date/time format error. Please refresh and try again.",
                "POSTGRESQL_CONNECTION_FAILURE" => "Database connection issue. Please try again in a moment.",
                "POSTGRESQL_UNIQUE_VIOLATION" => "This record already exists. Please check your input.",
                _ => "An error occurred while processing your request. Please try again."
            };
        }

        public static Dictionary<string, int> GetErrorStatistics()
        {
            lock (_lockObject)
            {
                return new Dictionary<string, int>(_errorCounts);
            }
        }
    }
}
