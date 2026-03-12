/*
Purpose: FTA VAT 201 Return report - UAE quarterly VAT filing
Author: HexaBill
Date: 2025
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;
using HexaBill.Api.Shared.Services;

namespace HexaBill.Api.Modules.Reports
{
    public interface IVatReturnReportService
    {
        Task<VatReturnDto> GetVatReturnAsync(int tenantId, int quarter, int year);
        Task<VatReturn201Dto> GetVatReturn201Async(int tenantId, DateTime fromDate, DateTime toDate);
    }

    public class VatReturnReportService : IVatReturnReportService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<VatReturnReportService> _logger;

        public VatReturnReportService(AppDbContext context, ILogger<VatReturnReportService> logger)
        {
            _context = context;
            _logger = logger;
        }

        public async Task<VatReturnDto> GetVatReturnAsync(int tenantId, int quarter, int year)
        {
            var (fromDate, toDate) = QuarterToDateRange(quarter, year);
            var dto = await GetVatReturn201Async(tenantId, fromDate, toDate);
            return new VatReturnDto
            {
                Quarter = quarter,
                Year = year,
                FromDate = fromDate,
                ToDate = toDate,
                Box1_TaxableSupplies = dto.Box1a,
                Box2_ZeroRatedSupplies = dto.Box2,
                Box3_ExemptSupplies = dto.Box3,
                Box4_TaxOnTaxableSupplies = dto.Box1b,
                Box5_ReverseCharge = dto.Box4,
                Box6_TotalDue = dto.Box1b,
                Box7_TaxNotCreditable = 0,
                Box8_RecoverableTax = dto.Box12,
                Box9_NetVatDue = dto.Box13a
            };
        }

        public async Task<VatReturn201Dto> GetVatReturn201Async(int tenantId, DateTime fromDate, DateTime toDate)
        {
            try
            {
                return await GetVatReturn201InternalAsync(tenantId, fromDate, toDate);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "VAT return calculation failed for tenant {TenantId}. {Message}", tenantId, ex.Message);
                var (periodLabel, dueDate) = GetPeriodLabelAndDue(fromDate.ToUtcKind(), toDate.Date.AddDays(1).ToUtcKind());
                return new VatReturn201Dto
                {
                    PeriodLabel = periodLabel,
                    PeriodStart = fromDate,
                    PeriodEnd = toDate,
                    DueDate = dueDate,
                    Status = "Draft",
                    ValidationIssues = new List<ValidationIssueDto>
                    {
                        new ValidationIssueDto
                        {
                            RuleId = "SYS001",
                            Severity = "Blocking",
                            Message = $"Calculation error: {ex.Message}. Check for missing VatScenario on sales or NULL Subtotal/VatTotal."
                        }
                    }
                };
            }
        }

        private async Task<VatReturn201Dto> GetVatReturn201InternalAsync(int tenantId, DateTime fromDate, DateTime toDate)
        {
            // Controller passes UTC range: fromDate = period start, toDate = exclusive end (start of next day in tenant TZ).
            var from = fromDate.ToUtcKind();
            var to = toDate.ToUtcKind();
            var outputLines = new List<VatReturnOutputLineDto>();
            var inputLines = new List<VatReturnInputLineDto>();
            var creditNoteLines = new List<VatReturnCreditNoteLineDto>();
            var reverseChargeLines = new List<VatReturnReverseChargeLineDto>();

            // Resolve tenant: prefer TenantId, fallback OwnerId for backward compatibility
            var salesInPeriod = await _context.Sales
                .Include(s => s.Customer)
                .Where(s => (s.TenantId != null ? s.TenantId == tenantId : s.OwnerId == tenantId) && !s.IsDeleted
                    && s.InvoiceDate >= from && s.InvoiceDate < to)
                .OrderBy(s => s.InvoiceDate)
                .ToListAsync();

            decimal box1a = 0, box1b = 0, box2 = 0, box3 = 0;
            int standardRatedCount = 0;
            foreach (var s in salesInPeriod)
            {
                if (s.IsZeroInvoice) continue;
                // Null-guard VatScenario so IsStandardRated and string comparisons never see null
                if (string.IsNullOrWhiteSpace(s.VatScenario))
                    s.VatScenario = "Standard";
                var isStandard = IsStandardRated(s);
                var net = s.Subtotal;
                var vat = s.VatTotal;
                if (isStandard)
                {
                    standardRatedCount++;
                    box1a += VatCalculator.Round(net);
                    box1b += VatCalculator.Round(vat);
                    outputLines.Add(new VatReturnOutputLineDto
                    {
                        Type = "Sale",
                        Reference = s.InvoiceNo ?? s.Id.ToString(),
                        Date = s.InvoiceDate,
                        NetAmount = net,
                        VatAmount = vat,
                        VatScenario = s.VatScenario ?? "Standard",
                        CustomerName = s.Customer?.Name ?? "",
                        SaleId = s.Id
                    });
                }
                else if (string.Equals(s.VatScenario, VatScenarios.ZeroRated, StringComparison.OrdinalIgnoreCase))
                {
                    box2 += VatCalculator.Round(net);
                    outputLines.Add(new VatReturnOutputLineDto { Type = "Sale", Reference = s.InvoiceNo ?? s.Id.ToString(), Date = s.InvoiceDate, NetAmount = net, VatAmount = 0, VatScenario = "ZeroRated", CustomerName = s.Customer?.Name ?? "", SaleId = s.Id });
                }
                else if (string.Equals(s.VatScenario, VatScenarios.Exempt, StringComparison.OrdinalIgnoreCase))
                {
                    box3 += VatCalculator.Round(net);
                    outputLines.Add(new VatReturnOutputLineDto { Type = "Sale", Reference = s.InvoiceNo ?? s.Id.ToString(), Date = s.InvoiceDate, NetAmount = net, VatAmount = 0, VatScenario = "Exempt", CustomerName = s.Customer?.Name ?? "", SaleId = s.Id });
                }
            }

            if (standardRatedCount == 0 && salesInPeriod.Count > 0)
                _logger.LogInformation("VAT Return: 0 standard-rated sales in period (from {Count} sales). Check VatScenario on sales.", salesInPeriod.Count);

            // Sale returns (output credit notes): reduce Box 1a/1b
            var returnsInPeriod = await _context.SaleReturns
                .Where(sr => (sr.TenantId != null ? sr.TenantId == tenantId : sr.OwnerId == tenantId)
                    && sr.ReturnDate >= from && sr.ReturnDate < to)
                .ToListAsync();
            decimal returnsNet = 0, returnsVat = 0;
            foreach (var sr in returnsInPeriod)
            {
                var srNet = sr.Subtotal;
                var srVat = sr.VatTotal;
                returnsNet += VatCalculator.Round(srNet);
                returnsVat += VatCalculator.Round(srVat);
                creditNoteLines.Add(new VatReturnCreditNoteLineDto
                {
                    Reference = sr.ReturnNo ?? sr.Id.ToString(),
                    Date = sr.ReturnDate,
                    NetAmount = srNet,
                    VatAmount = srVat,
                    Side = "Output"
                });
            }
            box1a = Math.Max(0, box1a - returnsNet);
            box1b = Math.Max(0, box1b - returnsVat);

            // Box 4: Reverse charge base (purchases)
            var purchasesInPeriod = await _context.Purchases
                .Include(p => p.Supplier)
                .Where(p => (p.TenantId != null ? p.TenantId == tenantId : p.OwnerId == tenantId)
                    && p.PurchaseDate >= from && p.PurchaseDate < to)
                .ToListAsync();

            decimal box4 = 0, box9b = 0, box10 = 0;
            foreach (var p in purchasesInPeriod)
            {
                if (p.IsReverseCharge)
                {
                    var rcNet = p.Subtotal ?? 0;
                    var rcVat = p.ReverseChargeVat ?? p.VatTotal ?? 0;
                    box4 += VatCalculator.Round(rcNet);
                    box10 += VatCalculator.Round(p.IsTaxClaimable ? rcVat : 0);
                    reverseChargeLines.Add(new VatReturnReverseChargeLineDto
                    {
                        Reference = p.InvoiceNo ?? p.Id.ToString(),
                        Date = p.PurchaseDate,
                        NetAmount = rcNet,
                        ReverseChargeVat = rcVat
                    });
                }
                else if (p.IsTaxClaimable && (p.VatTotal ?? 0) > 0)
                {
                    box9b += VatCalculator.Round(p.VatTotal ?? 0);
                    inputLines.Add(new VatReturnInputLineDto
                    {
                        Type = "Purchase",
                        Reference = p.InvoiceNo ?? p.Id.ToString(),
                        Date = p.PurchaseDate,
                        NetAmount = p.Subtotal ?? 0,
                        VatAmount = p.VatTotal ?? 0,
                        ClaimableVat = p.VatTotal ?? 0,
                        TaxType = "Standard",
                        SupplierName = p.SupplierName ?? p.Supplier?.Name ?? "",
                        SourceId = p.Id,
                        IsTaxClaimable = p.IsTaxClaimable
                    });
                }
            }

            // Expenses: Box 9b (claimable, non-petroleum) and PetroleumExcluded
            var expensesInPeriod = await _context.Expenses
                .Include(e => e.Category)
                .Where(e => (e.TenantId != null ? e.TenantId == tenantId : e.OwnerId == tenantId)
                    && e.Date >= from && e.Date < to)
                .ToListAsync();

            decimal petroleumExcluded = 0;
            foreach (var e in expensesInPeriod)
            {
                if (string.Equals(e.TaxType, TaxTypes.Petroleum, StringComparison.OrdinalIgnoreCase))
                {
                    petroleumExcluded += VatCalculator.Round(e.Amount);
                    continue;
                }
                var claimable = e.ClaimableVat ?? 0;
                if (e.IsTaxClaimable && claimable > 0)
                {
                    box9b += VatCalculator.Round(claimable);
                    inputLines.Add(new VatReturnInputLineDto
                    {
                        Type = "Expense",
                        Reference = e.Id.ToString(),
                        Date = e.Date,
                        NetAmount = e.Amount,
                        VatAmount = e.VatAmount ?? 0,
                        ClaimableVat = claimable,
                        TaxType = e.TaxType ?? "Standard",
                        CategoryName = e.Category?.Name ?? "",
                        SourceId = e.Id,
                        IsEntertainment = e.IsEntertainment,
                        IsTaxClaimable = e.IsTaxClaimable
                    });
                }
            }

            // Box 11: Input credit notes (purchase returns VAT) - if we support input credit note VAT later
            decimal box11 = 0;
            var purchaseReturnsInPeriod = await _context.PurchaseReturns
                .Where(pr => (pr.TenantId != null ? pr.TenantId == tenantId : pr.OwnerId == tenantId)
                    && pr.ReturnDate >= from && pr.ReturnDate < to)
                .ToListAsync();
            foreach (var pr in purchaseReturnsInPeriod)
                box11 += VatCalculator.Round(pr.VatTotal);

            // Box 12 = Box9b + Box10 - Box11
            var box12 = box9b + box10 - box11;
            if (box12 < 0) box12 = 0;

            var box13a = Math.Max(0, box1b - box12);
            var box13b = Math.Max(0, box12 - box1b);

            // to is exclusive end; last day of period for display is to - 1 day
            var periodEndInclusive = to.AddDays(-1).Date;
            var (periodLabel, dueDate) = GetPeriodLabelAndDue(fromDate, periodEndInclusive);
            int txCount = salesInPeriod.Count + returnsInPeriod.Count + purchasesInPeriod.Count + expensesInPeriod.Count;
            if (txCount == 0)
                _logger.LogInformation("VAT return: no transactions for tenant {TenantId}, period {From} to {To}. Sales={Sales}, Purchases={Purchases}, Expenses={Expenses}.", tenantId, fromDate.ToString("yyyy-MM-dd"), periodEndInclusive.ToString("yyyy-MM-dd"), salesInPeriod.Count, purchasesInPeriod.Count, expensesInPeriod.Count);

            return new VatReturn201Dto
            {
                PeriodLabel = periodLabel,
                PeriodStart = fromDate,
                PeriodEnd = periodEndInclusive,
                DueDate = dueDate,
                Status = "Draft",
                Box1a = VatCalculator.Round(box1a),
                Box1b = VatCalculator.Round(box1b),
                Box2 = VatCalculator.Round(box2),
                Box3 = VatCalculator.Round(box3),
                Box4 = VatCalculator.Round(box4),
                Box9b = VatCalculator.Round(box9b),
                Box10 = VatCalculator.Round(box10),
                Box11 = VatCalculator.Round(box11),
                Box12 = VatCalculator.Round(box12),
                Box13a = VatCalculator.Round(box13a),
                Box13b = VatCalculator.Round(box13b),
                PetroleumExcluded = VatCalculator.Round(petroleumExcluded),
                TransactionCount = txCount,
                OutputLines = outputLines,
                InputLines = inputLines,
                CreditNoteLines = creditNoteLines,
                ReverseChargeLines = reverseChargeLines
            };
        }

        private static bool IsStandardRated(Sale s)
        {
            if (string.Equals(s.VatScenario, VatScenarios.ZeroRated, StringComparison.OrdinalIgnoreCase))
                return false;
            if (string.Equals(s.VatScenario, VatScenarios.Exempt, StringComparison.OrdinalIgnoreCase))
                return false;
            if (string.Equals(s.VatScenario, VatScenarios.Standard, StringComparison.OrdinalIgnoreCase))
                return true;
            // Null/empty or typo (e.g. "standrad"): treat as standard if sale has VAT so box1b is not understated
            return s.VatTotal > 0;
        }

        private static (string label, DateTime due) GetPeriodLabelAndDue(DateTime from, DateTime to)
        {
            var months = (to.Year - from.Year) * 12 + (to.Month - from.Month);
            if (months <= 1)
            {
                var label = from.ToString("MMM-yyyy", System.Globalization.CultureInfo.InvariantCulture);
                var due = new DateTime(from.Year, from.Month, 1).AddMonths(2).AddDays(27); // e.g. Jan -> 28 Feb
                return (label, due);
            }
            if (months <= 3)
            {
                var q = (from.Month - 1) / 3 + 1;
                var label = $"Q{q}-{from.Year}";
                var endMonth = from.Month + 2;
                var year = from.Year;
                if (endMonth > 12) { endMonth -= 12; year++; }
                var due = new DateTime(year, endMonth, 28);
                return (label, due);
            }
            return (from.ToString("yyyy", System.Globalization.CultureInfo.InvariantCulture), to.AddMonths(1));
        }

        public static (DateTime from, DateTime to) QuarterToDateRange(int quarter, int year)
        {
            return quarter switch
            {
                1 => (new DateTime(year, 1, 1), new DateTime(year, 3, 31)),
                2 => (new DateTime(year, 4, 1), new DateTime(year, 6, 30)),
                3 => (new DateTime(year, 7, 1), new DateTime(year, 9, 30)),
                4 => (new DateTime(year, 10, 1), new DateTime(year, 12, 31)),
                _ => (new DateTime(year, 1, 1), new DateTime(year, 3, 31))
            };
        }
    }
}
