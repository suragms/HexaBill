/*
Purpose: FTA VAT 201 Return report - UAE quarterly VAT filing.
All box calculations are validated by VatReturnValidationService (V001–V014) to prevent wrong calculation.
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
        Task<VatReturn201Dto> GetVatReturn201Async(int tenantId, DateTime fromDate, DateTime toDate, DateTime? fromCalendarInclusive, DateTime? toCalendarInclusive);
        Task<(string from, string to, string label)> GetSuggestedPeriodAsync(int tenantId);
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
            var (fromDate, toDate) = QuarterToDateRangeFta(quarter, year);
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
            return await GetVatReturn201Async(tenantId, fromDate, toDate, null, null);
        }

        /// <summary>Get VAT return. When fromCalendar and toCalendar are provided, filter by calendar dates (inclusive) so data matches dashboard regardless of timezone.</summary>
        public async Task<VatReturn201Dto> GetVatReturn201Async(int tenantId, DateTime fromDate, DateTime toDate, DateTime? fromCalendarInclusive, DateTime? toCalendarInclusive)
        {
            try
            {
                return await GetVatReturn201InternalAsync(tenantId, fromDate, toDate, fromCalendarInclusive, toCalendarInclusive);
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

        /// <summary>Load sales in period using same raw SQL as Sales Ledger on PostgreSQL so VAT Return and Ledger always match.</summary>
        private async Task<List<Sale>> GetSalesInPeriodForVatAsync(int tenantId, DateTime from, DateTime to)
        {
            if (!_context.Database.IsNpgsql())
            {
                return await _context.Sales
                    .Include(s => s.Customer)
                    .Where(s => (s.TenantId == tenantId || (s.TenantId == null && s.OwnerId == tenantId))
                        && !s.IsDeleted && s.InvoiceDate >= from && s.InvoiceDate < to)
                    .OrderBy(s => s.InvoiceDate)
                    .ToListAsync();
            }
            var conn = _context.Database.GetDbConnection();
            var wasOpen = conn.State == System.Data.ConnectionState.Open;
            if (!wasOpen) await conn.OpenAsync();
            try
            {
                // Exact same WHERE as ReportService.GetSalesLedgerSalesRawAsync so VAT Return shows same sales as Sales Ledger
                const string sql = @"SELECT ""Id"" FROM ""Sales"" WHERE (""TenantId"" = @p0 OR (""TenantId"" IS NULL AND ""OwnerId"" = @p0)) AND ""IsDeleted"" = false AND ""InvoiceDate"" >= @p1 AND ""InvoiceDate"" < @p2 ORDER BY ""InvoiceDate"", ""Id""";
                using var cmd = conn.CreateCommand();
                cmd.CommandText = sql;
                var p0 = cmd.CreateParameter(); p0.ParameterName = "p0"; p0.Value = tenantId; cmd.Parameters.Add(p0);
                var p1 = cmd.CreateParameter(); p1.ParameterName = "p1"; p1.Value = from; cmd.Parameters.Add(p1);
                var p2 = cmd.CreateParameter(); p2.ParameterName = "p2"; p2.Value = to; cmd.Parameters.Add(p2);
                var ids = new List<int>();
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                        ids.Add(reader.GetInt32(0));
                }
                if (ids.Count == 0) return new List<Sale>();
                return await _context.Sales
                    .Include(s => s.Customer)
                    .Where(s => ids.Contains(s.Id))
                    .OrderBy(s => s.InvoiceDate)
                    .ThenBy(s => s.Id)
                    .ToListAsync();
            }
            finally { if (!wasOpen) await conn.CloseAsync(); }
        }

        private async Task<VatReturn201Dto> GetVatReturn201InternalAsync(int tenantId, DateTime fromDate, DateTime toDate, DateTime? fromCalendarInclusive, DateTime? toCalendarInclusive)
        {
            // Use same range convention as Sales Ledger: from = start of day UTC, to = exclusive end (start of next day)
            var from = fromDate.ToUtcKind();
            var to = toDate.ToUtcKind();
            var outputLines = new List<VatReturnOutputLineDto>();
            var inputLines = new List<VatReturnInputLineDto>();
            var creditNoteLines = new List<VatReturnCreditNoteLineDto>();
            var reverseChargeLines = new List<VatReturnReverseChargeLineDto>();

            // CRITICAL: Use same query as Sales Ledger (raw SQL on PostgreSQL) so VAT Return and Ledger show identical sales
            var salesInPeriod = await GetSalesInPeriodForVatAsync(tenantId, from, to);
            if (salesInPeriod.Count == 0)
            {
                var anyForTenant = await _context.Sales.CountAsync(s => (s.TenantId == tenantId || s.OwnerId == tenantId) && !s.IsDeleted);
                _logger.LogWarning("VAT return: 0 sales in period {From}–{To} for tenant {TenantId}. Total sales for tenant in DB: {Total}. Check InvoiceDate (calendar) and tenant scope.", from.ToString("yyyy-MM-dd"), to.AddDays(-1).ToString("yyyy-MM-dd"), tenantId, anyForTenant);
            }

            decimal box1a = 0, box1b = 0, box2 = 0, box3 = 0;
            int standardRatedCount = 0;
            foreach (var s in salesInPeriod)
            {
                if (s.IsZeroInvoice) continue;
                // Null-guard VatScenario so IsStandardRated and string comparisons never see null
                if (string.IsNullOrWhiteSpace(s.VatScenario))
                    s.VatScenario = "Standard";
                var isStandard = IsStandardRated(s);
                // FIX: When Subtotal/VatTotal are 0 but GrandTotal > 0 (legacy or bad data), derive so VAT Return shows correct totals
                decimal net = s.Subtotal;
                decimal vat = s.VatTotal;
                if (net == 0 && vat == 0 && s.GrandTotal > 0)
                {
                    net = Math.Round(s.GrandTotal / 1.05m, 2);
                    vat = Math.Round(s.GrandTotal - net, 2);
                }
                // FIX: Zayoga-style migration stored VAT-inclusive gross in Subtotal with VatTotal=0 (Subtotal≈GrandTotal)
                else if (isStandard && vat == 0 && s.GrandTotal > 0 && Math.Abs(s.Subtotal - s.GrandTotal) < 0.01m)
                {
                    net = VatCalculator.Round(s.GrandTotal / (1m + VatCalculator.StandardRate));
                    vat = VatCalculator.Round(s.GrandTotal - net);
                }
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

            // Box 4: Reverse charge base (purchases) - use calendar date comparison to avoid timezone edge cases
            var fromDateOnly = DateOnly.FromDateTime(from);
            var toDateOnly = DateOnly.FromDateTime(to.AddDays(-1));
            var purchasesInPeriod = await _context.Purchases
                .Include(p => p.Supplier)
                .Include(p => p.Items)
                .Where(p => (p.TenantId != null ? p.TenantId == tenantId : p.OwnerId == tenantId)
                    && DateOnly.FromDateTime(p.PurchaseDate) >= fromDateOnly
                    && DateOnly.FromDateTime(p.PurchaseDate) <= toDateOnly)
                .ToListAsync();

            decimal box4 = 0, box9b = 0, box10 = 0;
            var purchExclTaxClaimable = 0;
            var purchExclVatZero = 0;
            foreach (var p in purchasesInPeriod)
            {
                if (p.IsReverseCharge)
                {
                    var rcNet = p.Subtotal ?? 0;
                    var rcVat = p.ReverseChargeVat ?? p.VatTotal ?? 0;
                    box4 += VatCalculator.Round(rcNet);
                    box10 += VatCalculator.Round(p.IsTaxClaimable ? rcVat : 0);
                    if (!p.IsTaxClaimable) purchExclTaxClaimable++;
                    reverseChargeLines.Add(new VatReturnReverseChargeLineDto
                    {
                        Reference = p.InvoiceNo ?? p.Id.ToString(),
                        Date = p.PurchaseDate,
                        NetAmount = rcNet,
                        ReverseChargeVat = rcVat
                    });
                }
                else if (p.IsTaxClaimable)
                {
                    // FIX: Derive VAT when null - legacy purchases may have missing VatTotal/Subtotal
                    var pVat = p.VatTotal ?? (p.Subtotal.HasValue && p.TotalAmount > 0 ? Math.Max(0, p.TotalAmount - p.Subtotal.Value) : 0);
                    if (pVat == 0 && p.Items != null && p.Items.Count > 0)
                    {
                        // Fallback: sum VAT from items (Qty * VatAmount) when VatTotal is null
                        var itemsVat = p.Items.Where(i => (i.VatAmount ?? 0) > 0).Sum(i => i.Qty * (i.VatAmount ?? 0));
                        if (itemsVat > 0)
                            pVat = itemsVat;
                        else if (p.TotalAmount > 0)
                            // Last resort: assume 5% VAT-inclusive (TotalAmount = net * 1.05)
                            pVat = VatCalculator.Round(p.TotalAmount - (p.TotalAmount / 1.05m));
                    }
                    if (pVat > 0)
                    {
                        box9b += VatCalculator.Round(pVat);
                        inputLines.Add(new VatReturnInputLineDto
                        {
                            Type = "Purchase",
                            Reference = p.InvoiceNo ?? p.Id.ToString(),
                            Date = p.PurchaseDate,
                            NetAmount = p.Subtotal ?? (p.TotalAmount > 0 ? Math.Max(0, p.TotalAmount - pVat) : 0),
                            VatAmount = pVat,
                            ClaimableVat = pVat,
                            TaxType = "Standard",
                            SupplierName = p.SupplierName ?? p.Supplier?.Name ?? "",
                            SourceId = p.Id,
                            IsTaxClaimable = p.IsTaxClaimable
                        });
                    }
                    else
                        purchExclVatZero++;
                }
                else
                    purchExclTaxClaimable++;
            }

            // Expenses: Box 9b (claimable, non-petroleum) and PetroleumExcluded - use calendar date comparison
            var expensesInPeriod = await _context.Expenses
                .Include(e => e.Category)
                .Where(e => (e.TenantId != null ? e.TenantId == tenantId : e.OwnerId == tenantId)
                    && e.Status == ExpenseStatus.Approved
                    && DateOnly.FromDateTime(e.Date) >= fromDateOnly
                    && DateOnly.FromDateTime(e.Date) <= toDateOnly)
                .ToListAsync();

            decimal petroleumExcluded = 0;
            var expExclTaxClaimable = 0;
            var expExclClaimableZero = 0;
            var expExclPetroleum = 0;
            foreach (var e in expensesInPeriod)
            {
                if (string.Equals(e.TaxType, TaxTypes.Petroleum, StringComparison.OrdinalIgnoreCase))
                {
                    petroleumExcluded += VatCalculator.Round(e.Amount);
                    expExclPetroleum++;
                    continue;
                }
                // Use ClaimableVat when set; when marked claimable but 0/null, use VatAmount; else derive from TotalAmount - Amount (VAT = total - net)
                var claimable = e.ClaimableVat ?? 0;
                if (e.IsTaxClaimable && claimable == 0 && (e.VatAmount ?? 0) > 0)
                    claimable = e.VatAmount ?? 0;
                if (e.IsTaxClaimable && claimable == 0 && (e.TotalAmount ?? 0) > 0 && e.Amount > 0 && (e.TotalAmount ?? 0) > e.Amount)
                    claimable = VatCalculator.Round((e.TotalAmount ?? 0) - e.Amount);
                if (e.IsTaxClaimable && claimable == 0 && e.Amount > 0 && (e.VatRate ?? 0) > 0)
                    claimable = VatCalculator.Round(e.Amount * (e.VatRate ?? 0) / 100m);
                if (e.IsTaxClaimable && claimable > 0)
                {
                    box9b += VatCalculator.Round(claimable);
                    // Net: when VatInclusive, net = Amount - VAT; otherwise Amount is net
                    var netAmount = (e.VatInclusive == true && (e.VatAmount ?? 0) > 0)
                        ? Math.Max(0, e.Amount - (e.VatAmount ?? 0))
                        : e.Amount;
                    var vatAmount = e.VatAmount ?? claimable;
                    inputLines.Add(new VatReturnInputLineDto
                    {
                        Type = "Expense",
                        Reference = e.Id.ToString(),
                        Date = e.Date,
                        NetAmount = netAmount,
                        VatAmount = vatAmount,
                        ClaimableVat = claimable,
                        TaxType = e.TaxType ?? "Standard",
                        CategoryName = e.Category?.Name ?? "",
                        SourceId = e.Id,
                        IsEntertainment = e.IsEntertainment,
                        IsTaxClaimable = e.IsTaxClaimable
                    });
                }
                else if (e.IsTaxClaimable)
                    expExclClaimableZero++;
                else
                    expExclTaxClaimable++;
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
            var (periodLabel, dueDate) = GetPeriodLabelAndDue(fromDate.Date, periodEndInclusive);
            int txCount = salesInPeriod.Count + returnsInPeriod.Count + purchasesInPeriod.Count + expensesInPeriod.Count;
            _logger.LogInformation("VAT return: tenant {TenantId}, period {From} to {To}: Sales={Sales}, Purchases={Purchases}, Expenses={Expenses}, TotalLines={Total}.",
                tenantId, fromDate.ToString("yyyy-MM-dd"), periodEndInclusive.ToString("yyyy-MM-dd"), salesInPeriod.Count, purchasesInPeriod.Count, expensesInPeriod.Count, txCount);

            // Assurance: pre-round box totals for DTO so validation (V009–V011) can cross-check
            // Defensive fallback: if box totals are non-zero but detail arrays are empty (e.g. older data or
            // partial deployments), emit synthetic summary lines so the frontend tabs never show all-zero tables
            // when Box1/Box12 have values. This keeps VAT Return UI consistent with Overview even if some
            // transactions could not be broken down line-by-line.
            if (outputLines.Count == 0 && (box1a != 0 || box1b != 0 || box2 != 0 || box3 != 0))
            {
                outputLines.Add(new VatReturnOutputLineDto
                {
                    Type = "Sale",
                    Reference = "Summary",
                    Date = periodEndInclusive,
                    NetAmount = box1a + box2 + box3,
                    VatAmount = box1b,
                    VatScenario = "Summary",
                    CustomerName = string.Empty,
                    SaleId = null
                });
            }

            if (inputLines.Count == 0 && box12 != 0)
            {
                inputLines.Add(new VatReturnInputLineDto
                {
                    Type = "Expense",
                    Reference = "Summary",
                    Date = periodEndInclusive,
                    NetAmount = 0,
                    VatAmount = box12,
                    ClaimableVat = box12,
                    TaxType = "Summary",
                    SupplierName = string.Empty,
                    CategoryName = string.Empty,
                    SourceId = null,
                    IsEntertainment = false,
                    IsTaxClaimable = true
                });
            }

            if (creditNoteLines.Count == 0 && (returnsNet != 0 || returnsVat != 0))
            {
                creditNoteLines.Add(new VatReturnCreditNoteLineDto
                {
                    Reference = "Summary",
                    Date = periodEndInclusive,
                    NetAmount = returnsNet,
                    VatAmount = returnsVat,
                    Side = "Output"
                });
            }

            var dto = new VatReturn201Dto
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
                PurchaseCountInPeriod = purchasesInPeriod.Count,
                ExpenseCountInPeriod = expensesInPeriod.Count,
                PurchasesExcludedReasons = (purchExclTaxClaimable > 0 || purchExclVatZero > 0) ? new Dictionary<string, int> { ["TaxClaimableNo"] = purchExclTaxClaimable, ["VatZero"] = purchExclVatZero } : null,
                ExpensesExcludedReasons = (expExclTaxClaimable > 0 || expExclClaimableZero > 0 || expExclPetroleum > 0) ? new Dictionary<string, int> { ["TaxClaimableNo"] = expExclTaxClaimable, ["ClaimableZero"] = expExclClaimableZero, ["Petroleum"] = expExclPetroleum } : null,
                OutputLines = outputLines,
                InputLines = inputLines,
                CreditNoteLines = creditNoteLines,
                ReverseChargeLines = reverseChargeLines
            };
            _logger.LogDebug("VAT return assurance: tenant {TenantId} Box1a={Box1a}, Box1b={Box1b}, Box9b={Box9b}, Box12={Box12}, Box13a={Box13a}, Box13b={Box13b}.",
                tenantId, dto.Box1a, dto.Box1b, dto.Box9b, dto.Box12, dto.Box13a, dto.Box13b);
            return dto;
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

        /// <summary>Compute period label and due date from calendar (inclusive) dates. Supports both standard and FTA quarters.</summary>
        public static (string label, DateTime due) GetPeriodLabelAndDue(DateTime fromInclusive, DateTime toInclusive)
        {
            var from = fromInclusive.Date;
            var to = toInclusive.Date;
            var months = (to.Year - from.Year) * 12 + (to.Month - from.Month) + 1;
            if (months <= 1)
            {
                var label = from.ToString("MMM-yyyy", System.Globalization.CultureInfo.InvariantCulture);
                var due = new DateTime(from.Year, from.Month, 1).AddMonths(2).AddDays(27);
                return (label, due);
            }
            if (months <= 4) // quarter (3 months) or slightly more
            {
                int q;
                int labelYear;
                // FTA quarters: Feb-Apr, May-Jul, Aug-Oct, Nov-Jan (cross-year)
                if (from.Month == 2 && to.Month == 4)
                {
                    q = 1;
                    labelYear = from.Year;
                }
                else if (from.Month == 5 && to.Month == 7)
                {
                    q = 2;
                    labelYear = from.Year;
                }
                else if (from.Month == 8 && to.Month == 10)
                {
                    q = 3;
                    labelYear = from.Year;
                }
                else if (from.Month == 11 && to.Month == 1 && to.Year == from.Year + 1)
                {
                    q = 4;
                    labelYear = to.Year; // Q4-2026 = Nov 2025 - Jan 2026
                }
                else
                {
                    // Fallback: standard quarters Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec
                    q = (from.Month - 1) / 3 + 1;
                    labelYear = from.Year;
                }
                var label = $"Q{q}-{labelYear}";
                var due = to.AddMonths(1);
                var dueDay = Math.Min(28, DateTime.DaysInMonth(due.Year, due.Month));
                var dueDate = new DateTime(due.Year, due.Month, dueDay);
                return (label, dueDate);
            }
            return (from.ToString("yyyy", System.Globalization.CultureInfo.InvariantCulture), to.AddMonths(1));
        }

        /// <summary>FTA quarterly periods: Feb-Apr, May-Jul, Aug-Oct, Nov-Jan. Q4-{year} = Nov (year-1) to Jan (year).</summary>
        public static (DateTime from, DateTime to) QuarterToDateRangeFta(int quarter, int year)
        {
            return quarter switch
            {
                1 => (new DateTime(year, 2, 1), new DateTime(year, 4, 30)),
                2 => (new DateTime(year, 5, 1), new DateTime(year, 7, 31)),
                3 => (new DateTime(year, 8, 1), new DateTime(year, 10, 31)),
                4 => (new DateTime(year - 1, 11, 1), new DateTime(year, 1, 31)),
                _ => QuarterToDateRangeFta(1, year)
            };
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

        /// <summary>Suggest the FTA quarter or full year with the most transactions for the tenant.</summary>
        public async Task<(string from, string to, string label)> GetSuggestedPeriodAsync(int tenantId)
        {
            var now = DateTime.UtcNow;
            var bestCount = 0;
            var bestFrom = "";
            var bestTo = "";
            var bestLabel = "";

            // Check last 2 years: each FTA quarter + full year
            for (var y = now.Year; y >= now.Year - 2; y--)
            {
                for (var q = 1; q <= 4; q++)
                {
                    var (f, t) = QuarterToDateRangeFta(q, y);
                    if (t < now.AddYears(-2) || f > now) continue;
                    var fromOnly = DateOnly.FromDateTime(f);
                    var toOnly = DateOnly.FromDateTime(t);
                    var salesCount = await _context.Sales
                        .CountAsync(s => (s.TenantId == tenantId || (s.TenantId == null && s.OwnerId == tenantId)) && !s.IsDeleted
                            && DateOnly.FromDateTime(s.InvoiceDate) >= fromOnly && DateOnly.FromDateTime(s.InvoiceDate) <= toOnly);
                    var purchCount = await _context.Purchases
                        .CountAsync(p => (p.TenantId == tenantId || (p.TenantId == null && p.OwnerId == tenantId))
                            && DateOnly.FromDateTime(p.PurchaseDate) >= fromOnly && DateOnly.FromDateTime(p.PurchaseDate) <= toOnly);
                    var expCount = await _context.Expenses
                        .CountAsync(e => (e.TenantId == tenantId || (e.TenantId == null && e.OwnerId == tenantId)) && e.Status == ExpenseStatus.Approved
                            && DateOnly.FromDateTime(e.Date) >= fromOnly && DateOnly.FromDateTime(e.Date) <= toOnly);
                    var total = salesCount + purchCount + expCount;
                    if (total > bestCount)
                    {
                        bestCount = total;
                        bestFrom = fromOnly.ToString("yyyy-MM-dd");
                        bestTo = toOnly.ToString("yyyy-MM-dd");
                        bestLabel = $"Q{q}-{y}";
                    }
                }
                // Full calendar year
                var (fy, fyEnd) = (new DateTime(y, 1, 1), new DateTime(y, 12, 31));
                var fyFrom = DateOnly.FromDateTime(fy);
                var fyTo = DateOnly.FromDateTime(fyEnd);
                var fySales = await _context.Sales
                    .CountAsync(s => (s.TenantId == tenantId || (s.TenantId == null && s.OwnerId == tenantId)) && !s.IsDeleted
                        && DateOnly.FromDateTime(s.InvoiceDate) >= fyFrom && DateOnly.FromDateTime(s.InvoiceDate) <= fyTo);
                var fyPurch = await _context.Purchases
                    .CountAsync(p => (p.TenantId == tenantId || (p.TenantId == null && p.OwnerId == tenantId))
                        && DateOnly.FromDateTime(p.PurchaseDate) >= fyFrom && DateOnly.FromDateTime(p.PurchaseDate) <= fyTo);
                var fyExp = await _context.Expenses
                    .CountAsync(e => (e.TenantId == tenantId || (e.TenantId == null && e.OwnerId == tenantId)) && e.Status == ExpenseStatus.Approved
                        && DateOnly.FromDateTime(e.Date) >= fyFrom && DateOnly.FromDateTime(e.Date) <= fyTo);
                var fyTotal = fySales + fyPurch + fyExp;
                if (fyTotal > bestCount)
                {
                    bestCount = fyTotal;
                    bestFrom = fyFrom.ToString("yyyy-MM-dd");
                    bestTo = fyTo.ToString("yyyy-MM-dd");
                    bestLabel = y.ToString(System.Globalization.CultureInfo.InvariantCulture);
                }
            }

            if (bestCount == 0)
            {
                var (defFrom, defTo) = QuarterToDateRangeFta(1, now.Year);
                return (defFrom.ToString("yyyy-MM-dd"), defTo.ToString("yyyy-MM-dd"), $"Q1-{now.Year}");
            }
            return (bestFrom, bestTo, bestLabel);
        }
    }
}
