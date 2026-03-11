using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Modules.Reports;
using HexaBill.Api.Models;
using HexaBill.Api.Data;
using HexaBill.Api.Shared.Extensions;
using Microsoft.Extensions.DependencyInjection;
using HexaBill.Api.Modules.Payments;
using HexaBill.Api.Modules.Billing;
using HexaBill.Api.Modules.Branches;
using HexaBill.Api.Shared.Validation;
using Npgsql;
using OfficeOpenXml;

namespace HexaBill.Api.Modules.Reports
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ReportsController : TenantScopedController // MULTI-TENANT: Owner-scoped reports
    {
        private readonly IReportService _reportService;
        private readonly IVatReturnReportService _vatReturnReportService;
        private readonly IVatReturnValidationService _vatValidation;
        private readonly AppDbContext _context;
        private readonly ITimeZoneService _timeZoneService;
        private readonly IBranchService _branchService;

        public ReportsController(IReportService reportService, IVatReturnReportService vatReturnReportService, IVatReturnValidationService vatValidation, AppDbContext context, ITimeZoneService timeZoneService, IBranchService branchService)
        {
            _reportService = reportService;
            _vatReturnReportService = vatReturnReportService;
            _vatValidation = vatValidation;
            _context = context;
            _timeZoneService = timeZoneService;
            _branchService = branchService;
        }

        // Staff can view reports but cannot export sensitive data
        private bool IsStaffOnly()
        {
            return User.IsInRole("Staff") && !User.IsInRole("Admin");
        }

        [HttpGet("vat-return")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<ActionResult<ApiResponse<VatReturn201Dto>>> GetVatReturn(
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] int? quarter,
            [FromQuery] int? year)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
                DateTime fromDate;
                DateTime toDate;
                if (from.HasValue && to.HasValue)
                {
                    fromDate = from.Value.ToUtcKind();
                    toDate = to.Value.ToUtcKind();
                    if (fromDate > toDate)
                        return BadRequest(new ApiResponse<object> { Success = false, Message = "From date must be before to date." });
                }
                else if (quarter.HasValue && year.HasValue && quarter >= 1 && quarter <= 4)
                {
                    var (f, t) = VatReturnReportService.QuarterToDateRange(quarter.Value, year.Value);
                    fromDate = f;
                    toDate = t;
                }
                else
                {
                    var gst = _timeZoneService.GetCurrentDate();
                    fromDate = gst.AddMonths(-3);
                    toDate = gst;
                }
                var result = await _vatReturnReportService.GetVatReturn201Async(tenantId, fromDate, toDate);
                var period = await _context.VatReturnPeriods
                    .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.PeriodStart == fromDate && p.PeriodEnd == toDate);
                if (period != null)
                {
                    result.PeriodId = period.Id;
                    result.Status = period.Status ?? result.Status;
                }
                var issues = await _vatValidation.ValidatePeriodAsync(tenantId, fromDate, toDate, result);
                result.ValidationIssues = issues;
                return Ok(new ApiResponse<VatReturn201Dto>
                {
                    Success = true,
                    Message = "VAT return retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("vat-return/periods")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<ActionResult<ApiResponse<List<VatReturnPeriodDto>>>> GetVatReturnPeriods()
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
            var list = await _context.VatReturnPeriods
                .Where(p => p.TenantId == tenantId)
                .OrderByDescending(p => p.PeriodEnd)
                .Take(50)
                .Select(p => new VatReturnPeriodDto
                {
                    Id = p.Id,
                    PeriodLabel = p.PeriodLabel,
                    PeriodStart = p.PeriodStart,
                    PeriodEnd = p.PeriodEnd,
                    DueDate = p.DueDate,
                    Status = p.Status,
                    Box13a = p.Box13a,
                    Box13b = p.Box13b,
                    CalculatedAt = p.CalculatedAt,
                    LockedAt = p.LockedAt
                })
                .ToListAsync();
            return Ok(new ApiResponse<List<VatReturnPeriodDto>>
            {
                Success = true,
                Data = list
            });
        }

        [HttpPost("vat-return/calculate")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<ActionResult<ApiResponse<VatReturn201Dto>>> CalculateVatReturn([FromBody] VatReturnCalculateRequest request)
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
            if (request?.From == null || request.To == null)
                return BadRequest(new ApiResponse<VatReturn201Dto> { Success = false, Message = "From and To dates are required." });
            var from = request.From.Value.ToUtcKind();
            var to = request.To.Value.ToUtcKind();
            if (from > to)
                return BadRequest(new ApiResponse<VatReturn201Dto> { Success = false, Message = "From must be before To." });
            var dto = await _vatReturnReportService.GetVatReturn201Async(tenantId, from, to);
            var (periodLabel, dueDate) = GetPeriodLabelAndDue(from, to);
            var period = await _context.VatReturnPeriods
                .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.PeriodStart == from.Date && p.PeriodEnd == to.Date);
            if (period == null)
            {
                period = new VatReturnPeriod
                {
                    TenantId = tenantId,
                    PeriodStart = from.Date,
                    PeriodEnd = to.Date,
                    PeriodLabel = periodLabel,
                    DueDate = dueDate,
                    Status = "Calculated",
                    Box1a = dto.Box1a,
                    Box1b = dto.Box1b,
                    Box2 = dto.Box2,
                    Box3 = dto.Box3,
                    Box4 = dto.Box4,
                    Box9b = dto.Box9b,
                    Box10 = dto.Box10,
                    Box11 = dto.Box11,
                    Box12 = dto.Box12,
                    Box13a = dto.Box13a,
                    Box13b = dto.Box13b,
                    PetroleumExcluded = dto.PetroleumExcluded,
                    CalculatedAt = DateTime.UtcNow
                };
                _context.VatReturnPeriods.Add(period);
            }
            else
            {
                period.Box1a = dto.Box1a;
                period.Box1b = dto.Box1b;
                period.Box2 = dto.Box2;
                period.Box3 = dto.Box3;
                period.Box4 = dto.Box4;
                period.Box9b = dto.Box9b;
                period.Box10 = dto.Box10;
                period.Box11 = dto.Box11;
                period.Box12 = dto.Box12;
                period.Box13a = dto.Box13a;
                period.Box13b = dto.Box13b;
                period.PetroleumExcluded = dto.PetroleumExcluded;
                period.CalculatedAt = DateTime.UtcNow;
                period.Status = period.Status == "Locked" ? "Locked" : "Calculated";
            }
            await _context.SaveChangesAsync();
            dto.PeriodId = period.Id;
            dto.Status = period.Status;
            dto.CalculatedAt = period.CalculatedAt;
            dto.ValidationIssues = await _vatValidation.ValidatePeriodAsync(tenantId, from, to, dto);
            return Ok(new ApiResponse<VatReturn201Dto> { Success = true, Data = dto });
        }

        [HttpPost("vat-return/periods/{id:int}/lock")]
        [Authorize(Roles = "Owner,Admin")]
        public async Task<ActionResult<ApiResponse<object>>> LockVatReturnPeriod(int id)
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
            var period = await _context.VatReturnPeriods.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (period == null) return NotFound(new ApiResponse<object> { Success = false, Message = "Period not found." });
            if (string.Equals(period.Status, "Locked", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new ApiResponse<object> { Success = false, Message = "Period is already locked." });
            var from = period.PeriodStart; var to = period.PeriodEnd;
            var dto = await _vatReturnReportService.GetVatReturn201Async(tenantId, from, to);
            var issues = await _vatValidation.ValidatePeriodAsync(tenantId, from, to, dto);
            var blocking = issues.Where(i => string.Equals(i.Severity, "Blocking", StringComparison.OrdinalIgnoreCase)).ToList();
            if (blocking.Any())
                return StatusCode(422, new ApiResponse<object> { Success = false, Message = "Cannot lock: resolve blocking validation issues first.", Errors = blocking.Select(i => i.Message).ToList() });
            var userId = int.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid) ? uid : 0;
            period.Status = "Locked";
            period.LockedAt = DateTime.UtcNow;
            period.LockedByUserId = userId;
            await _context.SaveChangesAsync();
            return Ok(new ApiResponse<object> { Success = true, Message = "Period locked." });
        }

        [HttpPost("vat-return/periods/{id:int}/submit")]
        [Authorize(Roles = "Owner,Admin")]
        public async Task<ActionResult<ApiResponse<object>>> SubmitVatReturnPeriod(int id)
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
            var period = await _context.VatReturnPeriods.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (period == null) return NotFound(new ApiResponse<object> { Success = false, Message = "Period not found." });
            var userId = int.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid) ? uid : 0;
            period.SubmittedAt = DateTime.UtcNow;
            period.SubmittedByUserId = userId;
            if (!string.Equals(period.Status, "Locked", StringComparison.OrdinalIgnoreCase))
                period.Status = "Submitted";
            await _context.SaveChangesAsync();
            return Ok(new ApiResponse<object> { Success = true, Message = "Submitted." });
        }

        [HttpGet("vat-return/validation")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<ActionResult<ApiResponse<List<ValidationIssueDto>>>> GetVatReturnValidation(
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] int? periodId)
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
            DateTime fromDate, toDate;
            if (periodId.HasValue)
            {
                var p = await _context.VatReturnPeriods.FirstOrDefaultAsync(x => x.Id == periodId && x.TenantId == tenantId);
                if (p == null) return NotFound(new ApiResponse<List<ValidationIssueDto>> { Success = false });
                fromDate = p.PeriodStart; toDate = p.PeriodEnd;
            }
            else if (from.HasValue && to.HasValue)
            {
                fromDate = from.Value.ToUtcKind(); toDate = to.Value.ToUtcKind();
            }
            else
                return BadRequest(new ApiResponse<List<ValidationIssueDto>> { Success = false, Message = "Provide from/to or periodId." });
            var dto = await _vatReturnReportService.GetVatReturn201Async(tenantId, fromDate, toDate);
            var issues = await _vatValidation.ValidatePeriodAsync(tenantId, fromDate, toDate, dto);
            return Ok(new ApiResponse<List<ValidationIssueDto>> { Success = true, Data = issues });
        }

        private static (string label, DateTime due) GetPeriodLabelAndDue(DateTime from, DateTime to)
        {
            var months = (to.Year - from.Year) * 12 + (to.Month - from.Month);
            if (months <= 1)
            {
                var label = from.ToString("MMM-yyyy", System.Globalization.CultureInfo.InvariantCulture);
                var due = new DateTime(from.Year, from.Month, 1).AddMonths(2).AddDays(27);
                return (label, due);
            }
            if (months <= 3)
            {
                var q = (from.Month - 1) / 3 + 1;
                var label = $"Q{q}-{from.Year}";
                var endMonth = from.Month + 2;
                var y = from.Year;
                if (endMonth > 12) { endMonth -= 12; y++; }
                return (label, new DateTime(y, endMonth, 28));
            }
            return (from.Year.ToString(), to.AddMonths(1));
        }

        [HttpGet("vat-return/export/excel")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<IActionResult> ExportVatReturnExcelFta201(
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] int? periodId)
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
            DateTime fromDate, toDate;
            string label;
            if (periodId.HasValue)
            {
                var p = await _context.VatReturnPeriods.FirstOrDefaultAsync(x => x.Id == periodId && x.TenantId == tenantId);
                if (p == null) return NotFound();
                fromDate = p.PeriodStart; toDate = p.PeriodEnd; label = p.PeriodLabel;
            }
            else if (from.HasValue && to.HasValue)
            {
                fromDate = from.Value.ToUtcKind(); toDate = to.Value.ToUtcKind();
                label = $"{fromDate:yyyy-MM-dd}_{toDate:yyyy-MM-dd}";
            }
            else
                return BadRequest("Provide from/to or periodId.");
            var data = await _vatReturnReportService.GetVatReturn201Async(tenantId, fromDate, toDate);
            ExcelPackage.LicenseContext = LicenseContext.NonCommercial;
            using var package = new ExcelPackage();
            var sheet = package.Workbook.Worksheets.Add("FTA 201 Summary");
            sheet.Cells[1, 1].Value = "FTA Form 201 VAT Return";
            sheet.Cells[2, 1].Value = "Period"; sheet.Cells[2, 2].Value = $"{fromDate:dd-MMM-yyyy} to {toDate:dd-MMM-yyyy}";
            int row = 3;
            sheet.Cells[row, 1].Value = "1a Value of taxable supplies"; sheet.Cells[row, 2].Value = data.Box1a; row++;
            sheet.Cells[row, 1].Value = "1b VAT on taxable supplies"; sheet.Cells[row, 2].Value = data.Box1b; row++;
            sheet.Cells[row, 1].Value = "2 Zero-rated"; sheet.Cells[row, 2].Value = data.Box2; row++;
            sheet.Cells[row, 1].Value = "3 Exempt"; sheet.Cells[row, 2].Value = data.Box3; row++;
            sheet.Cells[row, 1].Value = "4 Reverse charge"; sheet.Cells[row, 2].Value = data.Box4; row++;
            sheet.Cells[row, 1].Value = "9b Recoverable input VAT"; sheet.Cells[row, 2].Value = data.Box9b; row++;
            sheet.Cells[row, 1].Value = "10 Reverse charge VAT"; sheet.Cells[row, 2].Value = data.Box10; row++;
            sheet.Cells[row, 1].Value = "11 Input adjustments"; sheet.Cells[row, 2].Value = data.Box11; row++;
            sheet.Cells[row, 1].Value = "12 Total recoverable"; sheet.Cells[row, 2].Value = data.Box12; row++;
            sheet.Cells[row, 1].Value = "13a Payable"; sheet.Cells[row, 2].Value = data.Box13a; row++;
            sheet.Cells[row, 1].Value = "13b Refundable"; sheet.Cells[row, 2].Value = data.Box13b; row++;
            sheet.Cells[row, 1].Value = "Petroleum excluded"; sheet.Cells[row, 2].Value = data.PetroleumExcluded;
            sheet.Cells["A1:B20"].AutoFitColumns();
            var bytes = package.GetAsByteArray();
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"VAT-Return-{label}.xlsx");
        }

        [HttpGet("vat-return/export/csv")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<IActionResult> ExportVatReturnCsv(
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] int? periodId)
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
            DateTime fromDate, toDate;
            string label;
            if (periodId.HasValue)
            {
                var p = await _context.VatReturnPeriods.FirstOrDefaultAsync(x => x.Id == periodId && x.TenantId == tenantId);
                if (p == null) return NotFound();
                fromDate = p.PeriodStart; toDate = p.PeriodEnd; label = p.PeriodLabel;
            }
            else if (from.HasValue && to.HasValue)
            {
                fromDate = from.Value.ToUtcKind(); toDate = to.Value.ToUtcKind();
                label = $"{fromDate:yyyy-MM-dd}_{toDate:yyyy-MM-dd}";
            }
            else
                return BadRequest("Provide from/to or periodId.");
            var data = await _vatReturnReportService.GetVatReturn201Async(tenantId, fromDate, toDate);
            var lines = new List<string> { "Type,Reference,Date,NetAmount,VatAmount,ClaimableVat,VatScenario" };
            foreach (var line in data.OutputLines)
                lines.Add($"Output,{line.Reference},{line.Date:yyyy-MM-dd},{line.NetAmount},{line.VatAmount},,{line.VatScenario}");
            foreach (var line in data.InputLines)
                lines.Add($"Input,{line.Reference},{line.Date:yyyy-MM-dd},{line.NetAmount},{line.VatAmount},{line.ClaimableVat},{line.TaxType}");
            foreach (var line in data.CreditNoteLines)
                lines.Add($"CreditNote,{line.Reference},{line.Date:yyyy-MM-dd},{line.NetAmount},{line.VatAmount},{line.Side},");
            foreach (var line in data.ReverseChargeLines)
                lines.Add($"ReverseCharge,{line.Reference},{line.Date:yyyy-MM-dd},{line.NetAmount},{line.ReverseChargeVat},,");
            var csv = string.Join("\r\n", lines);
            var bytes = System.Text.Encoding.UTF8.GetBytes(csv);
            return File(bytes, "text/csv", $"VAT-Return-{label}.csv");
        }

        [HttpGet("vat-return/export")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<IActionResult> ExportVatReturnExcel(
            [FromQuery] int quarter = 1,
            [FromQuery] int year = 2026,
            [FromQuery] string format = "xlsx")
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
                if (quarter < 1 || quarter > 4 || year < 2020 || year > 2030)
                    return BadRequest("Invalid quarter (1-4) or year");
                var data = await _vatReturnReportService.GetVatReturnAsync(tenantId, quarter, year);

                ExcelPackage.LicenseContext = LicenseContext.NonCommercial;
                using var package = new ExcelPackage();
                var sheet = package.Workbook.Worksheets.Add("VAT Return");
                sheet.Cells[1, 1].Value = $"FTA VAT 201 Return - Q{quarter} {year}";
                sheet.Cells[1, 1, 1, 2].Merge = true;
                sheet.Cells[2, 1].Value = "Period"; sheet.Cells[2, 2].Value = $"{data.FromDate:dd-MMM-yyyy} to {data.ToDate:dd-MMM-yyyy}";
                sheet.Cells[3, 1].Value = "Box"; sheet.Cells[3, 2].Value = "Amount (AED)";
                int row = 4;
                sheet.Cells[row, 1].Value = "Box 1: Taxable supplies"; sheet.Cells[row, 2].Value = data.Box1_TaxableSupplies; row++;
                sheet.Cells[row, 1].Value = "Box 2: Zero-rated supplies"; sheet.Cells[row, 2].Value = data.Box2_ZeroRatedSupplies; row++;
                sheet.Cells[row, 1].Value = "Box 3: Exempt supplies"; sheet.Cells[row, 2].Value = data.Box3_ExemptSupplies; row++;
                sheet.Cells[row, 1].Value = "Box 4: Tax on taxable supplies"; sheet.Cells[row, 2].Value = data.Box4_TaxOnTaxableSupplies; row++;
                sheet.Cells[row, 1].Value = "Box 5: Reverse charge"; sheet.Cells[row, 2].Value = data.Box5_ReverseCharge; row++;
                sheet.Cells[row, 1].Value = "Box 6: Total due"; sheet.Cells[row, 2].Value = data.Box6_TotalDue; row++;
                sheet.Cells[row, 1].Value = "Box 7: Tax not creditable"; sheet.Cells[row, 2].Value = data.Box7_TaxNotCreditable; row++;
                sheet.Cells[row, 1].Value = "Box 8: Recoverable tax"; sheet.Cells[row, 2].Value = data.Box8_RecoverableTax; row++;
                sheet.Cells[row, 1].Value = "Box 9: Net VAT due"; sheet.Cells[row, 2].Value = data.Box9_NetVatDue;
                sheet.Cells["A1:B13"].AutoFitColumns();
                var bytes = package.GetAsByteArray();
                return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    $"VAT-Return-Q{quarter}-{year}.xlsx");
            }
            catch (Exception ex)
            {
                return StatusCode(500, ex.Message);
            }
        }

        [HttpGet("staff-performance")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<List<StaffPerformanceDto>>>> GetStaffPerformance(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int? routeId = null) // FIX: Add route filter parameter
        {
            try
            {
                var tenantId = CurrentTenantId;
                var from = fromDate ?? DateTime.UtcNow.Date.AddDays(-30);
                var to = toDate ?? DateTime.UtcNow.Date;
                // FIX: Pass routeId filter to service (if provided, filter by route)
                var result = await _reportService.GetStaffPerformanceAsync(tenantId, from, to, routeId);
                return Ok(new ApiResponse<List<StaffPerformanceDto>>
                {
                    Success = true,
                    Message = "Staff performance report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<StaffPerformanceDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("branch-comparison")]
        public async Task<ActionResult<ApiResponse<List<BranchComparisonItemDto>>>> GetBranchComparison(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0 && !IsSystemAdmin) return Forbid();

                var gstNow = _timeZoneService.GetCurrentDate();
                var to = (toDate ?? gstNow).ToUtcKind();
                var from = (fromDate ?? gstNow.AddDays(-30)).ToUtcKind();
                var periodDays = (int)(to - from).TotalDays;
                if (periodDays <= 0) periodDays = 30;

                var branches = await _branchService.GetBranchesAsync(tenantId);
                if (branches == null || branches.Count == 0)
                {
                    return Ok(new ApiResponse<List<BranchComparisonItemDto>>
                    {
                        Success = true,
                        Message = "No branches found",
                        Data = new List<BranchComparisonItemDto>()
                    });
                }

                var result = new List<BranchComparisonItemDto>();
                foreach (var branch in branches)
                {
                    var current = await _branchService.GetBranchSummaryAsync(branch.Id, tenantId, from, to.AddDays(1));
                    if (current == null) continue;

                    var prevTo = from.AddDays(-1);
                    var prevFrom = prevTo.AddDays(-periodDays);
                    var prev = await _branchService.GetBranchSummaryAsync(branch.Id, tenantId, prevFrom, prevTo.AddDays(1));

                    decimal? growth = null;
                    if (prev != null && prev.TotalSales > 0)
                    {
                        growth = (decimal)((current.TotalSales - prev.TotalSales) / prev.TotalSales * 100);
                    }
                    else if (prev != null && current.TotalSales > 0)
                    {
                        growth = 100;
                    }

                    result.Add(new BranchComparisonItemDto
                    {
                        BranchId = current.BranchId,
                        BranchName = current.BranchName,
                        TotalSales = current.TotalSales,
                        TotalExpenses = current.TotalExpenses,
                        Profit = current.Profit,
                        Routes = current.Routes,
                        GrowthPercent = growth
                    });
                }

                // Include "Unassigned" row for sales with BranchId==null and RouteId==null (legacy data)
                try
                {
                    var unassigned = await _branchService.GetUnassignedSalesSummaryAsync(tenantId, from, to.AddDays(1));
                    if (unassigned != null && unassigned.TotalSales > 0)
                    {
                        result.Add(new BranchComparisonItemDto
                        {
                            BranchId = unassigned.BranchId,
                            BranchName = unassigned.BranchName,
                            TotalSales = unassigned.TotalSales,
                            TotalExpenses = unassigned.TotalExpenses,
                            Profit = unassigned.Profit,
                            Routes = unassigned.Routes,
                            GrowthPercent = null
                        });
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Warning: Could not load unassigned sales for branch report: {ex.Message}");
                }

                result = result.OrderByDescending(x => x.TotalSales).ToList();

                return Ok(new ApiResponse<List<BranchComparisonItemDto>>
                {
                    Success = true,
                    Message = "Branch comparison retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in GetBranchComparison: {ex.Message}");
                return Ok(new ApiResponse<List<BranchComparisonItemDto>> { Success = true, Data = new List<BranchComparisonItemDto>() });
            }
        }

        [HttpGet("summary")]
        public async Task<ActionResult<ApiResponse<SummaryReportDto>>> GetSummaryReport(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int? branchId = null,
            [FromQuery] int? routeId = null,
            [FromQuery] bool refresh = false)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var userId = int.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid) ? uid : (int?)null;
                var role = User.FindFirst(ClaimTypes.Role)?.Value;
                var result = await _reportService.GetSummaryReportAsync(tenantId, fromDate, toDate, branchId, routeId, userId, role, skipCache: refresh);
                
                // SECURITY: Hide profit from Staff
                if (IsStaffOnly())
                {
                    result.ProfitToday = null;
                }

                Console.WriteLine($"? GetSummaryReport returning data: Sales={result.SalesToday}, Expenses={result.ExpensesToday}, PendingBills={result.PendingBills}");
                return Ok(new ApiResponse<SummaryReportDto>
                {
                    Success = true,
                    Message = "Summary report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                // PRODUCTION: Return empty summary instead of 500 so Dashboard keeps working
                Console.WriteLine($"[GetSummaryReport] Returning empty data after error: {ex.Message}");
                return Ok(new ApiResponse<SummaryReportDto>
                {
                    Success = true,
                    Data = new SummaryReportDto()
                });
            }
        }

        /// <summary>Owner-only worksheet summary: Total Sales, Purchases, Expenses, Total Received (payments in period), Pending Amount.</summary>
        [HttpGet("worksheet")]
        [Authorize(Roles = "Owner,SystemAdmin")]
        public async Task<ActionResult<ApiResponse<WorksheetReportDto>>> GetWorksheetReport(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
                var gst = _timeZoneService.GetCurrentDate();
                var from = (fromDate ?? gst).ToUtcKind();
                var to = (toDate ?? gst).ToUtcKind();
                var result = await _reportService.GetWorksheetReportAsync(tenantId, from, to);
                return Ok(new ApiResponse<WorksheetReportDto>
                {
                    Success = true,
                    Message = "Worksheet report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<WorksheetReportDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>Owner-only: export worksheet as PDF.</summary>
        [HttpGet("worksheet/export/pdf")]
        [Authorize(Roles = "Owner,SystemAdmin")]
        public async Task<ActionResult> ExportWorksheetPdf(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
                var gst = _timeZoneService.GetCurrentDate();
                var from = (fromDate ?? gst).ToUtcKind();
                var to = (toDate ?? gst).ToUtcKind();
                var dto = await _reportService.GetWorksheetReportAsync(tenantId, from, to);
                var pdfService = HttpContext.RequestServices.GetRequiredService<IPdfService>();
                var pdfBytes = await pdfService.GenerateWorksheetPdfAsync(dto, from, to, tenantId);
                var fileName = $"worksheet_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}.pdf";
                return File(pdfBytes, "application/pdf", fileName);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred while exporting the worksheet",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("sales")]
        public async Task<ActionResult<ApiResponse<PagedResponse<SaleDto>>>> GetSalesReport(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int? customerId = null,
            [FromQuery] string? status = null,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] int? branchId = null,
            [FromQuery] int? routeId = null,
            [FromQuery] string? search = null) // BUG #2.5 FIX: Add search parameter
        {
            try
            {
                var tenantId = CurrentTenantId;
                var gstNow = _timeZoneService.GetCurrentDate();
                var from = (fromDate ?? gstNow.AddDays(-30)).ToUtcKind();
                var to = ((toDate ?? gstNow).AddDays(1)).ToUtcKind();
                var userId = int.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid) ? uid : (int?)null;
                var role = User.FindFirst(ClaimTypes.Role)?.Value;
                var result = await _reportService.GetSalesReportAsync(tenantId, from, to, customerId, status, page, pageSize, branchId, routeId, userId, role, search);
                return Ok(new ApiResponse<PagedResponse<SaleDto>>
                {
                    Success = true,
                    Message = "Sales report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                // Log the full exception details for debugging
                Console.WriteLine($"Error in GetSalesReport: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
                }
                
                return StatusCode(500, new ApiResponse<PagedResponse<SaleDto>>
                {
                    Success = false,
                    Message = "An error occurred while generating the sales report",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("product-sales")]
        public async Task<ActionResult<ApiResponse<List<ProductSalesDto>>>> GetProductSalesReport(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int top = 20)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                // CRITICAL FIX: Always add 1 day to toDate for inclusive range
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = ((toDate ?? _timeZoneService.GetCurrentDate()).AddDays(1)).ToUtcKind();
                var result = await _reportService.GetProductSalesReportAsync(tenantId, from, to, top);

                // SECURITY: Hide profit from Staff
                if (IsStaffOnly())
                {
                    foreach (var p in result)
                    {
                        p.CostValue = null;
                        p.GrossProfit = null;
                        p.MarginPercent = null;
                    }
                }

                return Ok(new ApiResponse<List<ProductSalesDto>>
                {
                    Success = true,
                    Message = "Product sales report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                // Log the full exception details for debugging
                Console.WriteLine($"Error in GetProductSalesReport: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
                }
                
                return StatusCode(500, new ApiResponse<List<ProductSalesDto>>
                {
                    Success = false,
                    Message = "An error occurred while generating the product sales report",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("outstanding")]
        public async Task<ActionResult<ApiResponse<PagedResponse<CustomerDto>>>> GetOutstandingCustomers(
            [FromQuery] int days = 30,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 100)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                // AUDIT-6 FIX: Add pagination support
                var result = await _reportService.GetOutstandingCustomersAsync(tenantId, page, pageSize, days);
                return Ok(new ApiResponse<PagedResponse<CustomerDto>>
                {
                    Success = true,
                    Message = "Outstanding customers retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PagedResponse<CustomerDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("cheque")]
        public async Task<ActionResult<ApiResponse<PagedResponse<PaymentDto>>>> GetChequeReport(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 100)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                // AUDIT-6 FIX: Add pagination support
                var result = await _reportService.GetChequeReportAsync(tenantId, page, pageSize);
                return Ok(new ApiResponse<PagedResponse<PaymentDto>>
                {
                    Success = true,
                    Message = "Cheque report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PagedResponse<PaymentDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("ai-suggestions")]
        public async Task<ActionResult<ApiResponse<AISuggestionsDto>>> GetAISuggestions(
            [FromQuery] int periodDays = 30)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _reportService.GetAISuggestionsAsync(tenantId, periodDays);

                // SECURITY: Hide profit-sensitive suggestions from Staff
                if (IsStaffOnly())
                {
                    result.LowMarginProducts = new List<ProductDto>();
                    result.PromotionCandidates = new List<ProductDto>();
                }

                return Ok(new ApiResponse<AISuggestionsDto>
                {
                    Success = true,
                    Message = "AI suggestions retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<AISuggestionsDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("pending")]
        [HttpGet("pending-bills")] // Alternative route name per spec
        public async Task<ActionResult<ApiResponse<PagedResponse<PendingBillDto>>>> GetPendingBills(
            [FromQuery] DateTime? from = null,
            [FromQuery] DateTime? to = null,
            [FromQuery] int? customerId = null,
            [FromQuery] int days = 30, // Legacy parameter for backward compatibility
            [FromQuery] string? search = null,
            [FromQuery] string? status = null,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 100)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                // CRITICAL: Only apply date filter when BOTH from and to are explicitly provided.
                // When omitted, show ALL pending/overdue bills (no date filter) so overdue is visible.
                DateTime? fromDate = (from.HasValue && to.HasValue) ? from.Value.ToUtcKind() : null;
                DateTime? toDate = (from.HasValue && to.HasValue) ? to.Value.ToUtcKind() : null;
                
                // AUDIT-6 FIX: Add pagination support
                var result = await _reportService.GetPendingBillsAsync(
                    tenantId,
                    fromDate,
                    toDate,
                    customerId,
                    search,
                    status,
                    page,
                    pageSize);
                return Ok(new ApiResponse<PagedResponse<PendingBillDto>>
                {
                    Success = true,
                    Message = "Pending bills retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PagedResponse<PendingBillDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("expenses")]
        [Authorize]
        public async Task<ActionResult<ApiResponse<List<ExpenseByCategoryDto>>>> GetExpensesByCategory(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int? branchId = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                var result = await _reportService.GetExpensesByCategoryAsync(tenantId, from, to, branchId);
                return Ok(new ApiResponse<List<ExpenseByCategoryDto>>
                {
                    Success = true,
                    Message = "Expense breakdown retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<ExpenseByCategoryDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("sales-vs-expenses")]
        [Authorize]
        public async Task<ActionResult<ApiResponse<List<SalesVsExpensesDto>>>> GetSalesVsExpenses(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] string groupBy = "day")
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                var result = await _reportService.GetSalesVsExpensesAsync(tenantId, from, to, groupBy);

                // SECURITY: Hide profit from Staff
                if (IsStaffOnly())
                {
                    foreach (var item in result)
                    {
                        item.Profit = null;
                    }
                }

                return Ok(new ApiResponse<List<SalesVsExpensesDto>>
                {
                    Success = true,
                    Message = "Sales vs Expenses data retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<SalesVsExpensesDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("export/pdf")]
        [Authorize(Roles = "Admin,Owner")] // MULTI-TENANT: Both Admin and Owner can export
        public Task<ActionResult> ExportReportPdf(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
            var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();

            // Generate PDF report using existing PdfService or create summary
            // For now, return a simple response - can be enhanced with QuestPDF
            return Task.FromResult<ActionResult>(Ok(new ApiResponse<object>
            {
                Success = true,
                Message = "PDF export endpoint ready. Implementation requires PDF generation library.",
                Data = new { fromDate = from, toDate = to, message = "Use GET /api/reports/summary for data" }
            }));
        }

        [HttpGet("export/excel")]
        [Authorize(Roles = "Admin,Owner")] // MULTI-TENANT: Both Admin and Owner can export
        public Task<ActionResult> ExportReportExcel(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
            var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();

            // Excel export would use EPPlus or ClosedXML
            // For now, return a response indicating endpoint is ready
            return Task.FromResult<ActionResult>(Ok(new ApiResponse<object>
            {
                Success = true,
                Message = "Excel export endpoint ready. Implementation requires EPPlus library.",
                Data = new { fromDate = from, toDate = to, message = "Use GET /api/reports/summary for data" }
            }));
        }

        [HttpGet("export/csv")]
        [Authorize(Roles = "Admin,Owner")] // MULTI-TENANT: Both Admin and Owner can export
        public async Task<ActionResult> ExportReportCsv(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();

                // Get sales data
                var salesData = await _reportService.GetSalesReportAsync(tenantId, from, to, null, null, 1, 1000);
                var csvContent = "InvoiceNo,InvoiceDate,CustomerName,GrandTotal,PaymentStatus\n";
                
                foreach (var sale in salesData.Items)
                {
                    csvContent += $"{sale.InvoiceNo},{sale.InvoiceDate:yyyy-MM-dd},{sale.CustomerName ?? ""},{sale.GrandTotal},{sale.PaymentStatus}\n";
                }

                var bytes = System.Text.Encoding.UTF8.GetBytes(csvContent);
                return File(bytes, "text/csv", $"reports_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}.csv");
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("sales-enhanced")]
        public async Task<ActionResult<ApiResponse<EnhancedSalesReportDto>>> GetEnhancedSalesReport(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] string granularity = "day",
            [FromQuery] int? productId = null,
            [FromQuery] int? customerId = null,
            [FromQuery] string? status = null,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                var result = await _reportService.GetEnhancedSalesReportAsync(tenantId, from, to, granularity, productId, customerId, status, page, pageSize);
                return Ok(new ApiResponse<EnhancedSalesReportDto>
                {
                    Success = true,
                    Message = "Enhanced sales report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<EnhancedSalesReportDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("products-enhanced")]
        public async Task<ActionResult<ApiResponse<List<ProductSalesDto>>>> GetEnhancedProductSalesReport(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int? productId = null,
            [FromQuery] string? unitType = null,
            [FromQuery] bool lowStockOnly = false)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                var result = await _reportService.GetEnhancedProductSalesReportAsync(tenantId, from, to, productId, unitType, lowStockOnly);
                return Ok(new ApiResponse<List<ProductSalesDto>>
                {
                    Success = true,
                    Message = "Enhanced product sales report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<ProductSalesDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("customers-enhanced")]
        public async Task<ActionResult<ApiResponse<CustomerReportDto>>> GetCustomerReport(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] decimal? minOutstanding = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                var result = await _reportService.GetCustomerReportAsync(tenantId, from, to, minOutstanding);
                return Ok(new ApiResponse<CustomerReportDto>
                {
                    Success = true,
                    Message = "Customer report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<CustomerReportDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("aging")]
        public async Task<ActionResult<ApiResponse<AgingReportDto>>> GetAgingReport(
            [FromQuery] DateTime? asOfDate = null,
            [FromQuery] int? customerId = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var asOf = (asOfDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                var result = await _reportService.GetAgingReportAsync(tenantId, asOf, customerId);
                return Ok(new ApiResponse<AgingReportDto>
                {
                    Success = true,
                    Message = "Aging report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<AgingReportDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("ap-aging")]
        public async Task<ActionResult<ApiResponse<ApAgingReportDto>>> GetApAgingReport(
            [FromQuery] DateTime? asOfDate = null)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var asOf = (asOfDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                var result = await _reportService.GetApAgingReportAsync(tenantId, asOf);
                return Ok(new ApiResponse<ApAgingReportDto>
                {
                    Success = true,
                    Message = "AP aging report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<ApAgingReportDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("stock")]
        public async Task<ActionResult<ApiResponse<StockReportDto>>> GetStockReport(
            [FromQuery] bool lowOnly = false)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _reportService.GetStockReportAsync(tenantId, lowOnly);
                return Ok(new ApiResponse<StockReportDto>
                {
                    Success = true,
                    Message = "Stock report retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<StockReportDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("sales-ledger")]
        public async Task<ActionResult<ApiResponse<SalesLedgerReportDto>>> GetComprehensiveSalesLedger(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int? branchId = null,
            [FromQuery] int? routeId = null,
            [FromQuery] int? staffId = null)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var userId = int.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var uid) ? uid : (int?)null;
                var role = User.FindFirst(ClaimTypes.Role)?.Value;
                var result = await _reportService.GetComprehensiveSalesLedgerAsync(tenantId, fromDate, toDate, branchId, routeId, staffId, userId, role);
                return Ok(new ApiResponse<SalesLedgerReportDto>
                {
                    Success = true,
                    Message = "Comprehensive sales ledger retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                // Return 500 with real error so we can fix the cause (was hiding with empty data and data never showed).
                var msg = ex.Message + (ex.InnerException != null ? " | " + ex.InnerException.Message : "");
                Console.WriteLine($"[GetComprehensiveSalesLedger] ERROR: {msg}");
                Console.WriteLine($"[GetComprehensiveSalesLedger] Stack: {ex.StackTrace}");
                return StatusCode(500, new ApiResponse<SalesLedgerReportDto>
                {
                    Success = false,
                    Message = "Sales ledger failed: " + msg,
                    Data = new SalesLedgerReportDto { Entries = new List<SalesLedgerEntryDto>(), Summary = new SalesLedgerSummary() },
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("sales-ledger/export/pdf")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult> ExportSalesLedgerPdf(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] string? type = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                
                var ledgerReport = await _reportService.GetComprehensiveSalesLedgerAsync(tenantId, from, to);
                
                // Filter by type if provided
                if (!string.IsNullOrWhiteSpace(type) && (type.Equals("Sale", StringComparison.OrdinalIgnoreCase) || type.Equals("Payment", StringComparison.OrdinalIgnoreCase)))
                {
                    var filteredEntries = ledgerReport.Entries
                        .Where(e => e.Type.Equals(type, StringComparison.OrdinalIgnoreCase))
                        .ToList();
                    
                    // Recalculate summary for filtered entries
                    var totalRealPending = filteredEntries.Sum(e => e.RealPending);
                    var totalRealGotPayment = filteredEntries.Sum(e => e.RealGotPayment);
                    var totalSales = filteredEntries.Where(e => e.Type == "Sale").Sum(e => e.RealPending);
                    var totalPayments = filteredEntries.Where(e => e.Type == "Payment").Sum(e => e.RealGotPayment);
                    
                    ledgerReport = new SalesLedgerReportDto
                    {
                        Entries = filteredEntries,
                        Summary = new SalesLedgerSummary
                        {
                            TotalDebit = totalRealPending,
                            TotalCredit = totalRealGotPayment,
                            OutstandingBalance = 0, // Not used anymore
                            TotalSales = totalSales,
                            TotalPayments = totalPayments
                        }
                    };
                }
                
                var pdfService = HttpContext.RequestServices.GetRequiredService<IPdfService>();
                var pdfBytes = await pdfService.GenerateSalesLedgerPdfAsync(ledgerReport, from, to, tenantId);
                
                var fileName = !string.IsNullOrWhiteSpace(type)
                    ? $"sales_ledger_{type.ToLower()}_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}.pdf"
                    : $"sales_ledger_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}.pdf";
                
                return File(pdfBytes, "application/pdf", fileName);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error exporting sales ledger PDF: {ex.Message}");
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred while exporting the sales ledger",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("pending-bills/export/pdf")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult> ExportPendingBillsPdf(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] int? customerId = null,
            [FromQuery] string? status = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = (fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30)).ToUtcKind();
                var to = (toDate ?? _timeZoneService.GetCurrentDate()).ToUtcKind();
                
                // AUDIT-6 FIX: Add pagination support (use default page/pageSize for PDF export)
                var pendingBillsResult = await _reportService.GetPendingBillsAsync(tenantId, from, to, customerId, null, status, 1, 1000);
                var pendingBills = pendingBillsResult?.Items ?? new List<PendingBillDto>();
                
                if (pendingBills == null || !pendingBills.Any())
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "No pending bills found for the specified period"
                    });
                }
                
                var pdfService = HttpContext.RequestServices.GetRequiredService<IPdfService>();
                var pdfBytes = await pdfService.GeneratePendingBillsPdfAsync(pendingBills, from, to, tenantId);
                
                var fileName = $"pending_bills_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}.pdf";
                
                return File(pdfBytes, "application/pdf", fileName);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error exporting pending bills PDF: {ex.Message}");
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred while exporting the pending bills report",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("sales/export/html")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult> ExportSalesReportHtml(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var from = fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30);
                var to = toDate ?? _timeZoneService.GetCurrentDate();
                
                var salesData = await _reportService.GetSalesReportAsync(tenantId, from, to, null, null, 1, 10000);
                var settings = await GetCompanySettingsAsync(tenantId);
                
                var html = await GenerateSalesReportHtmlAsync(salesData, settings, from, to);
                var bytes = System.Text.Encoding.UTF8.GetBytes(html);
                
                return File(bytes, "text/html", $"sales_report_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}.html");
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("cash/export/html")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult> ExportCashReportHtml(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            try
            {
                var from = fromDate ?? _timeZoneService.GetCurrentDate().AddDays(-30);
                var to = toDate ?? _timeZoneService.GetCurrentDate();
                
                var payments = await _context.Payments
                    .Include(p => p.Customer)
                    .Where(p => p.TenantId == CurrentTenantId && p.PaymentDate >= from && p.PaymentDate <= to) // MULTI-TENANT
                    .OrderBy(p => p.PaymentDate)
                    .ToListAsync();
                
                var expenses = await _context.Expenses
                    .Where(e => e.TenantId == CurrentTenantId && e.Date >= from && e.Date <= to) // MULTI-TENANT
                    .OrderBy(e => e.Date)
                    .ToListAsync();
                
                var settings = await GetCompanySettingsAsync(CurrentTenantId);
                var html = await GenerateCashReportHtmlAsync(payments, expenses, settings, from, to);
                var bytes = System.Text.Encoding.UTF8.GetBytes(html);
                
                return File(bytes, "text/html", $"cash_report_{from:yyyy-MM-dd}_{to:yyyy-MM-dd}.html");
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        private async Task<InvoiceTemplateService.CompanySettings> GetCompanySettingsAsync(int tenantId)
        {
            Dictionary<string, string> settings;
            try
            {
                settings = await _context.Settings
                    .Where(s => s.TenantId == tenantId)  // CRITICAL: Filter by owner
                    .ToDictionaryAsync(s => s.Key, s => s.Value ?? "");
            }
            catch (Exception ex)
            {
                var pgEx = ex as Npgsql.PostgresException ?? ex.InnerException as Npgsql.PostgresException;
                if (pgEx != null && pgEx.SqlState == "42703" && pgEx.MessageText.Contains("Value"))
                {
                    // Settings.Value column doesn't exist - use SettingsService which handles this
                    var settingsService = HttpContext.RequestServices.GetRequiredService<HexaBill.Api.Modules.SuperAdmin.ISettingsService>();
                    settings = await settingsService.GetOwnerSettingsAsync(tenantId);
                }
                else
                {
                    // Return empty settings if error
                    settings = new Dictionary<string, string>();
                }
            }
            return new InvoiceTemplateService.CompanySettings
            {
                CompanyNameEn = settings.GetValueOrDefault("COMPANY_NAME_EN", ""),
                CompanyNameAr = settings.GetValueOrDefault("COMPANY_NAME_AR", ""),
                CompanyAddress = settings.GetValueOrDefault("COMPANY_ADDRESS", ""),
                CompanyPhone = settings.GetValueOrDefault("COMPANY_PHONE", ""),
                CompanyTrn = settings.GetValueOrDefault("COMPANY_TRN", ""),
                Currency = settings.GetValueOrDefault("CURRENCY", "AED")
            };
        }

        private async Task<string> GenerateSalesReportHtmlAsync(PagedResponse<SaleDto> salesData, InvoiceTemplateService.CompanySettings settings, DateTime from, DateTime to)
        {
            var templatePath = Path.Combine(Directory.GetCurrentDirectory(), "Templates", "sales-report-template.html");
            var template = await System.IO.File.ReadAllTextAsync(templatePath);
            
            var salesRows = new System.Text.StringBuilder();
            foreach (var sale in salesData.Items)
            {
                var itemsCount = sale.Items?.Count ?? 0;
                salesRows.AppendLine($@"
                <tr>
                    <td>{sale.InvoiceDate:dd-MM-yyyy}</td>
                    <td>{sale.InvoiceNo}</td>
                    <td>{System.Net.WebUtility.HtmlEncode(sale.CustomerName ?? "Cash")}</td>
                    <td class=""text-center"">{itemsCount}</td>
                    <td class=""text-right"">{sale.Subtotal:N2}</td>
                    <td class=""text-right"">{sale.VatTotal:N2}</td>
                    <td class=""text-right"">{sale.Discount:N2}</td>
                    <td class=""text-right"">{sale.GrandTotal:N2}</td>
                    <td class=""text-center"">{sale.PaymentStatus}</td>
                </tr>");
            }
            
            var totalSubtotal = salesData.Items.Sum(s => s.Subtotal);
            var totalVat = salesData.Items.Sum(s => s.VatTotal);
            var totalDiscount = salesData.Items.Sum(s => s.Discount);
            var totalGrandTotal = salesData.Items.Sum(s => s.GrandTotal);
            
            return template
                .Replace("{{company_name_en}}", settings.CompanyNameEn)
                .Replace("{{company_name_ar}}", settings.CompanyNameAr)
                .Replace("{{company_address}}", settings.CompanyAddress)
                .Replace("{{company_phone}}", settings.CompanyPhone)
                .Replace("{{company_trn}}", settings.CompanyTrn)
                .Replace("{{from_date}}", from.ToString("dd-MM-yyyy"))
                .Replace("{{to_date}}", to.ToString("dd-MM-yyyy"))
                .Replace("{{generated_date}}", DateTime.UtcNow.ToString("dd-MM-yyyy HH:mm"))
                .Replace("{{sales_rows}}", salesRows.ToString())
                .Replace("{{total_subtotal}}", totalSubtotal.ToString("N2"))
                .Replace("{{total_vat}}", totalVat.ToString("N2"))
                .Replace("{{total_discount}}", totalDiscount.ToString("N2"))
                .Replace("{{total_grand_total}}", totalGrandTotal.ToString("N2"))
                .Replace("{{currency}}", settings.Currency);
        }

        private async Task<string> GenerateCashReportHtmlAsync(List<Payment> payments, List<Expense> expenses, InvoiceTemplateService.CompanySettings settings, DateTime from, DateTime to)
        {
            var templatePath = Path.Combine(Directory.GetCurrentDirectory(), "Templates", "cash-report-template.html");
            var template = await System.IO.File.ReadAllTextAsync(templatePath);
            
            var cashRows = new System.Text.StringBuilder();
            decimal runningBalance = 0;
            
            // Add payments (cash in)
            foreach (var payment in payments.Where(p => p.Mode == PaymentMode.CASH))
            {
                runningBalance += payment.Amount;
                cashRows.AppendLine($@"
                <tr>
                    <td>{payment.PaymentDate:dd-MM-yyyy}</td>
                    <td>Payment</td>
                    <td>{payment.Reference ?? payment.Sale?.InvoiceNo ?? "-"}</td>
                    <td>{System.Net.WebUtility.HtmlEncode(payment.Customer?.Name ?? "Cash Customer")}</td>
                    <td class=""text-center"">CASH</td>
                    <td class=""text-right"">{payment.Amount:N2}</td>
                    <td class=""text-right"">0.00</td>
                    <td class=""text-right"">{runningBalance:N2}</td>
                </tr>");
            }
            
            // Add expenses (cash out)
            foreach (var expense in expenses)
            {
                runningBalance -= expense.Amount;
                cashRows.AppendLine($@"
                <tr>
                    <td>{expense.Date:dd-MM-yyyy}</td>
                    <td>Expense</td>
                    <td>{expense.Note ?? "-"}</td>
                    <td>{System.Net.WebUtility.HtmlEncode(expense.Category?.Name ?? "General")}</td>
                    <td class=""text-center"">CASH</td>
                    <td class=""text-right"">0.00</td>
                    <td class=""text-right"">{expense.Amount:N2}</td>
                    <td class=""text-right"">{runningBalance:N2}</td>
                </tr>");
            }
            
            var totalCashIn = payments.Where(p => p.Mode == PaymentMode.CASH).Sum(p => p.Amount);
            var totalCashOut = expenses.Sum(e => e.Amount);
            var netCashFlow = totalCashIn - totalCashOut;
            
            return template
                .Replace("{{company_name_en}}", settings.CompanyNameEn)
                .Replace("{{company_name_ar}}", settings.CompanyNameAr)
                .Replace("{{company_address}}", settings.CompanyAddress)
                .Replace("{{company_phone}}", settings.CompanyPhone)
                .Replace("{{company_trn}}", settings.CompanyTrn)
                .Replace("{{from_date}}", from.ToString("dd-MM-yyyy"))
                .Replace("{{to_date}}", to.ToString("dd-MM-yyyy"))
                .Replace("{{generated_date}}", DateTime.UtcNow.ToString("dd-MM-yyyy HH:mm"))
                .Replace("{{cash_rows}}", cashRows.ToString())
                .Replace("{{total_cash_in}}", totalCashIn.ToString("N2"))
                .Replace("{{total_cash_out}}", totalCashOut.ToString("N2"))
                .Replace("{{net_cash_flow}}", netCashFlow.ToString("N2"))
                .Replace("{{closing_balance}}", runningBalance.ToString("N2"))
                .Replace("{{currency}}", settings.Currency);
        }
    }
}

