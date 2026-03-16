/*
Purpose: FTA VAT return validation (V001–V012) and assurance rules to prevent wrong calculation.
- V001: VAT amount vs net×rate; V002: VatScenario required; V004: no duplicate refs; V005: petroleum; V008: not both 13a/13b.
- V009: Box1a/1b must match sum of output lines minus credit notes (assurance).
- V010: Box12 = Box9b + Box10 - Box11 (recoverable formula).
- V011: Box13a/13b = max(0, 1b-12) / max(0, 12-1b) (net VAT formula).
- V012: zero invoice zero VAT; V014: input lines claimable vs Box9b (warning).
Author: HexaBill
Date: 2026
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;
using HexaBill.Api.Shared.Services;

namespace HexaBill.Api.Modules.Reports
{
    public interface IVatReturnValidationService
    {
        Task<bool> IsTransactionDateInLockedPeriodAsync(int tenantId, DateTime transactionDate);
        Task<List<ValidationIssueDto>> ValidatePeriodAsync(int tenantId, DateTime from, DateTime to, VatReturn201Dto? precomputed = null);
    }

    public class VatReturnValidationService : IVatReturnValidationService
    {
        private readonly AppDbContext _context;

        public VatReturnValidationService(AppDbContext context)
        {
            _context = context;
        }

        /// <summary>Returns true if the transaction date falls within any locked VAT return period for the tenant.</summary>
        /// <remarks>Compares timestamps only (no .Date on column) to avoid date_trunc(unknown, text) when column was ever TEXT.</remarks>
        public async Task<bool> IsTransactionDateInLockedPeriodAsync(int tenantId, DateTime transactionDate)
        {
            var startOfDay = transactionDate.Date.ToUniversalTime();
            var endOfDay = startOfDay.AddDays(1).AddTicks(-1);
            var locked = await _context.VatReturnPeriods
                .AnyAsync(p => p.TenantId == tenantId
                    && p.Status == "Locked"
                    && p.PeriodStart <= endOfDay
                    && p.PeriodEnd >= startOfDay);
            return locked;
        }

        /// <summary>Run validation rules for the period; optionally use precomputed return for box checks.</summary>
        public async Task<List<ValidationIssueDto>> ValidatePeriodAsync(int tenantId, DateTime from, DateTime to, VatReturn201Dto? precomputed = null)
        {
            var issues = new List<ValidationIssueDto>();
            var fromUtc = from.ToUtcKind();
            var toEnd = to.Date.AddDays(1).ToUtcKind();

            // V-PURCH-EXP-ZERO: Purchases/expenses exist in period but Box12 (Input VAT) is 0 — guide user
            if (precomputed != null && precomputed.Box12 == 0)
            {
                var pc = precomputed.PurchaseCountInPeriod;
                var ec = precomputed.ExpenseCountInPeriod;
                if (pc > 0 || ec > 0)
                {
                    var parts = new List<string>();
                    if (pc > 0) parts.Add($"{pc} purchase(s)");
                    if (ec > 0) parts.Add($"{ec} expense(s)");
                    issues.Add(new ValidationIssueDto
                    {
                        RuleId = "V-PURCH-EXP-ZERO",
                        Severity = "Warning",
                        Message = $"Total Purchase and Expense VAT shows 0.00 but you have {string.Join(" and ", parts)} in this period. Only purchases with Tax claimable = Yes and VAT > 0, and expenses with Tax claimable (ITC) = Yes and VAT in this period are included. Check the Purchases and Expenses pages.",
                        EntityRef = "VATReturn:Input"
                    });
                }
            }

            // V-PERIOD-DATE: sales outside selected VAT period — one aggregated message (not one per invoice)
            var outOfRangeSales = await _context.Sales
                .Where(s => (s.TenantId != null ? s.TenantId == tenantId : s.OwnerId == tenantId)
                    && !s.IsDeleted
                    && (s.InvoiceDate < fromUtc || s.InvoiceDate >= toEnd))
                .Select(s => new { s.InvoiceNo, s.InvoiceDate })
                .OrderBy(s => s.InvoiceDate)
                .Take(3)
                .ToListAsync();
            var outOfRangeCount = await _context.Sales
                .Where(s => (s.TenantId != null ? s.TenantId == tenantId : s.OwnerId == tenantId)
                    && !s.IsDeleted
                    && (s.InvoiceDate < fromUtc || s.InvoiceDate >= toEnd))
                .CountAsync();
            if (outOfRangeCount > 0)
            {
                var sample = outOfRangeSales.Count > 0
                    ? string.Join(", ", outOfRangeSales.Select(s => $"{s.InvoiceNo} ({s.InvoiceDate:yyyy-MM-dd})"))
                    : "";
                var msg = outOfRangeCount == 1
                    ? $"1 invoice is outside this period{(string.IsNullOrEmpty(sample) ? "" : ": " + sample)}. Choose a period that includes your sales dates."
                    : $"{outOfRangeCount} invoices are outside this period{(string.IsNullOrEmpty(sample) ? "" : ", e.g. " + sample)}. Choose a period that includes your sales dates.";
                issues.Add(new ValidationIssueDto
                {
                    RuleId = "V-PERIOD-DATE",
                    Severity = "Warning",
                    Message = msg,
                    EntityRef = "VATReturn:Period"
                });
            }

            // V002: All sales in period have VatScenario
            var salesWithoutScenario = await _context.Sales
                .Where(s => (s.TenantId != null ? s.TenantId == tenantId : s.OwnerId == tenantId)
                    && !s.IsDeleted && s.InvoiceDate >= fromUtc && s.InvoiceDate < toEnd
                    && string.IsNullOrWhiteSpace(s.VatScenario))
                .Select(s => new { s.Id, s.InvoiceNo })
                .ToListAsync();
            foreach (var s in salesWithoutScenario)
            {
                issues.Add(new ValidationIssueDto
                {
                    RuleId = "V002",
                    Severity = "Blocking",
                    Message = "Sale must have VatScenario set (Standard, ZeroRated, Exempt, OutOfScope, etc.).",
                    EntityRef = $"Sale:{s.Id}:{s.InvoiceNo}"
                });
            }

            // V012: Zero invoice has 0 VAT
            var zeroInvoicesWithVat = await _context.Sales
                .Where(s => (s.TenantId != null ? s.TenantId == tenantId : s.OwnerId == tenantId)
                    && !s.IsDeleted && s.InvoiceDate >= fromUtc && s.InvoiceDate < toEnd
                    && s.IsZeroInvoice && s.VatTotal != 0)
                .Select(s => new { s.Id, s.InvoiceNo })
                .ToListAsync();
            foreach (var s in zeroInvoicesWithVat)
            {
                issues.Add(new ValidationIssueDto
                {
                    RuleId = "V012",
                    Severity = "Blocking",
                    Message = "Zero value invoice must have zero VAT.",
                    EntityRef = $"Sale:{s.Id}:{s.InvoiceNo}"
                });
            }

            // V004: No duplicate ExternalReference in period
            var dupRefs = await _context.Sales
                .Where(s => (s.TenantId != null ? s.TenantId == tenantId : s.OwnerId == tenantId)
                    && !s.IsDeleted && s.InvoiceDate >= fromUtc && s.InvoiceDate < toEnd
                    && s.ExternalReference != null)
                .GroupBy(s => s.ExternalReference)
                .Where(g => g.Count() > 1)
                .Select(g => g.Key)
                .ToListAsync();
            foreach (var refKey in dupRefs)
            {
                issues.Add(new ValidationIssueDto
                {
                    RuleId = "V004",
                    Severity = "Blocking",
                    Message = "Duplicate invoice external reference in period.",
                    EntityRef = refKey
                });
            }

            // V005: Petroleum expense should not be claimable (informational)
            // EF cannot translate string.Equals(..., OrdinalIgnoreCase) to SQL; use exact match so it translates.
            var petroleumClaimable = await _context.Expenses
                .Where(e => (e.TenantId != null ? e.TenantId == tenantId : e.OwnerId == tenantId)
                    && e.Date >= fromUtc && e.Date < toEnd
                    && e.TaxType == TaxTypes.Petroleum
                    && e.IsTaxClaimable)
                .Select(e => new { e.Id })
                .ToListAsync();
            foreach (var e in petroleumClaimable)
            {
                issues.Add(new ValidationIssueDto
                {
                    RuleId = "V005",
                    Severity = "Warning",
                    Message = "Petroleum expense should not be marked as tax claimable.",
                    EntityRef = $"Expense:{e.Id}"
                });
            }

            // V001: VatAmount vs Net×Rate tolerance (per sale line - simplified: sale level)
            var salesForV001 = await _context.Sales
                .Where(s => (s.TenantId != null ? s.TenantId == tenantId : s.OwnerId == tenantId)
                    && !s.IsDeleted && s.InvoiceDate >= fromUtc && s.InvoiceDate < toEnd
                    && !s.IsZeroInvoice && s.VatTotal > 0)
                .ToListAsync();
            foreach (var s in salesForV001)
            {
                var expectedVat = VatCalculator.Round(s.Subtotal * 0.05m);
                var diff = Math.Abs(s.VatTotal - expectedVat);
                if (diff > 0.01m)
                {
                    issues.Add(new ValidationIssueDto
                    {
                        RuleId = "V001",
                        Severity = "Blocking",
                        Message = $"VAT amount {s.VatTotal} does not match 5% of net {s.Subtotal} (expected {expectedVat}).",
                        EntityRef = $"Sale:{s.Id}:{s.InvoiceNo}"
                    });
                }
            }

            // V008: Not both 13a and 13b > 0 (need precomputed)
            if (precomputed != null)
            {
                if (precomputed.Box13a > 0 && precomputed.Box13b > 0)
                {
                    issues.Add(new ValidationIssueDto
                    {
                        RuleId = "V008",
                        Severity = "Blocking",
                        Message = "Cannot have both payable (13a) and refundable (13b) VAT in the same period.",
                        EntityRef = null
                    });
                }

                // --- Assurance: advance tracking to prevent wrong calculation ---
                const decimal tolerance = 0.02m;
                const decimal toleranceBox1 = 0.05m; // Box1a/1b are sum of rounded line values; allow rounding drift

                // V009: Standard-rated output lines (sales minus output credit notes) must match Box1a and Box1b
                var standardOutputNet = precomputed.OutputLines?.Where(l => string.Equals(l.VatScenario, "Standard", StringComparison.OrdinalIgnoreCase)).Sum(l => l.NetAmount) ?? 0;
                var standardOutputVat = precomputed.OutputLines?.Where(l => string.Equals(l.VatScenario, "Standard", StringComparison.OrdinalIgnoreCase)).Sum(l => l.VatAmount) ?? 0;
                var creditOutputNet = precomputed.CreditNoteLines?.Where(c => string.Equals(c.Side, "Output", StringComparison.OrdinalIgnoreCase)).Sum(c => c.NetAmount) ?? 0;
                var creditOutputVat = precomputed.CreditNoteLines?.Where(c => string.Equals(c.Side, "Output", StringComparison.OrdinalIgnoreCase)).Sum(c => c.VatAmount) ?? 0;
                var expectedBox1a = standardOutputNet - creditOutputNet;
                var expectedBox1b = standardOutputVat - creditOutputVat;
                if (Math.Abs(precomputed.Box1a - expectedBox1a) > toleranceBox1 || Math.Abs(precomputed.Box1b - expectedBox1b) > toleranceBox1)
                {
                    issues.Add(new ValidationIssueDto
                    {
                        RuleId = "V009",
                        Severity = "Blocking",
                        Message = $"Box 1a/1b consistency: calculated from lines (1a={expectedBox1a:N2}, 1b={expectedBox1b:N2}) does not match return (1a={precomputed.Box1a:N2}, 1b={precomputed.Box1b:N2}).",
                        EntityRef = "VatReturn:Box1"
                    });
                }

                // V010: Box12 = Box9b + Box10 - Box11 (recoverable tax formula)
                var expectedBox12 = precomputed.Box9b + precomputed.Box10 - precomputed.Box11;
                if (expectedBox12 < 0) expectedBox12 = 0;
                if (Math.Abs(precomputed.Box12 - expectedBox12) > tolerance)
                {
                    issues.Add(new ValidationIssueDto
                    {
                        RuleId = "V010",
                        Severity = "Blocking",
                        Message = $"Box 12 (recoverable) must equal Box9b + Box10 - Box11. Expected {expectedBox12:N2}, got {precomputed.Box12:N2}.",
                        EntityRef = "VatReturn:Box12"
                    });
                }

                // V011: Box13a = max(0, Box1b - Box12), Box13b = max(0, Box12 - Box1b)
                var expected13a = Math.Max(0, precomputed.Box1b - precomputed.Box12);
                var expected13b = Math.Max(0, precomputed.Box12 - precomputed.Box1b);
                if (Math.Abs(precomputed.Box13a - expected13a) > tolerance || Math.Abs(precomputed.Box13b - expected13b) > tolerance)
                {
                    issues.Add(new ValidationIssueDto
                    {
                        RuleId = "V011",
                        Severity = "Blocking",
                        Message = $"Net VAT (13a/13b) must follow formula: 13a=max(0,1b-12), 13b=max(0,12-1b). Expected 13a={expected13a:N2}, 13b={expected13b:N2}; got 13a={precomputed.Box13a:N2}, 13b={precomputed.Box13b:N2}.",
                        EntityRef = "VatReturn:Box13"
                    });
                }

                // V014: Input lines claimable sum vs Box9b (warning; Box9b is rounded per-line so small drift allowed)
                const decimal toleranceInput = 0.10m;
                var inputClaimableSum = precomputed.InputLines?.Sum(l => l.ClaimableVat) ?? 0;
                if (precomputed.Box9b >= 0 && inputClaimableSum >= 0 && Math.Abs(precomputed.Box9b - inputClaimableSum) > toleranceInput)
                {
                    issues.Add(new ValidationIssueDto
                    {
                        RuleId = "V014",
                        Severity = "Warning",
                        Message = $"Input lines claimable VAT sum ({inputClaimableSum:N2}) differs from Box 9b ({precomputed.Box9b:N2}). Verify purchases/expenses.",
                        EntityRef = "VatReturn:Box9b"
                    });
                }
            }

            return issues;
        }
    }
}
