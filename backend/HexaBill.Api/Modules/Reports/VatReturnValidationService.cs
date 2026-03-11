/*
Purpose: FTA VAT return validation rules (V001–V012) and locked-period check.
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
            // Use translatable condition: EF cannot translate string.Equals(..., OrdinalIgnoreCase) to SQL
            var petroleumClaimable = await _context.Expenses
                .Where(e => (e.TenantId != null ? e.TenantId == tenantId : e.OwnerId == tenantId)
                    && e.Date >= fromUtc && e.Date < toEnd
                    && e.TaxType != null && e.TaxType.ToLower() == "petroleum"
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
            }

            return issues;
        }
    }
}
