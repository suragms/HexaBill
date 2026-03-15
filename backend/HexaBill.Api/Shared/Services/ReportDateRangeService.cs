/*
 * Purpose: Single source of truth for report/ledger date ranges.
 * Ensures Sales Ledger, VAT Return, Purchases, and Expenses all use the SAME
 * date filter convention so data never mismatches.
 * Author: HexaBill
 * Date: 2026
 */
using HexaBill.Api.Shared.Extensions;

namespace HexaBill.Api.Shared.Services
{
    /// <summary>
    /// CRITICAL: Use this for ALL report date ranges. Ensures Sales Ledger, VAT Return,
    /// Purchase page, and Expenses page fetch the SAME data for a given period.
    /// Convention: fromInclusive = start of first day (00:00 UTC), toExclusive = start of day AFTER last day (00:00).
    /// So period [2025-01-01, 2025-12-31] => from=2025-01-01 00:00, to=2026-01-01 00:00.
    /// </summary>
    public static class ReportDateRangeService
    {
        /// <summary>
        /// Convert user-supplied inclusive dates (e.g. 2025-01-01 to 2025-12-31) to the
        /// backend range convention: from = start of first day, to = start of next day (exclusive).
        /// Use for: Sales (InvoiceDate), VAT Return Sales - filter: date >= from AND date &lt; to.
        /// </summary>
        public static (DateTime fromUtc, DateTime toUtcExclusive) ToExclusiveRange(DateTime fromInclusive, DateTime toInclusive)
        {
            var from = new DateTime(fromInclusive.Year, fromInclusive.Month, fromInclusive.Day, 0, 0, 0, DateTimeKind.Unspecified).ToUtcKind();
            var to = new DateTime(toInclusive.Year, toInclusive.Month, toInclusive.Day, 0, 0, 0, DateTimeKind.Unspecified).AddDays(1).ToUtcKind();
            return (from, to);
        }

        /// <summary>
        /// Same as ToExclusiveRange but for DateOnly comparison (Purchases, Expenses in VAT Return).
        /// Returns the calendar dates - use DateOnly.FromDateTime(col) >= fromOnly AND <= toOnly.
        /// </summary>
        public static (DateOnly fromOnly, DateOnly toOnly) ToDateOnlyRange(DateTime fromInclusive, DateTime toInclusive)
        {
            var fromOnly = DateOnly.FromDateTime(fromInclusive);
            var toOnly = DateOnly.FromDateTime(toInclusive);
            return (fromOnly, toOnly);
        }

        /// <summary>
        /// For consumers that use inclusive end (e.g. Purchase page, some Expense queries):
        /// toEndOfDay = last moment of toInclusive (23:59:59.999). Filter: date >= from AND date &lt;= toEndOfDay.
        /// </summary>
        public static (DateTime fromUtc, DateTime toEndOfDayUtc) ToInclusiveEndRange(DateTime fromInclusive, DateTime toInclusive)
        {
            var from = new DateTime(fromInclusive.Year, fromInclusive.Month, fromInclusive.Day, 0, 0, 0, DateTimeKind.Unspecified).ToUtcKind();
            var toEnd = new DateTime(toInclusive.Year, toInclusive.Month, toInclusive.Day, 0, 0, 0, DateTimeKind.Unspecified).AddDays(1).AddTicks(-1).ToUtcKind();
            return (from, toEnd);
        }
    }
}
