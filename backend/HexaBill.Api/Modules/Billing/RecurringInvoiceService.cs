/*
Purpose: Recurring invoice service - CRUD and background processing
Author: HexaBill
Date: 2025
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;

namespace HexaBill.Api.Modules.Billing
{
    public interface IRecurringInvoiceService
    {
        Task<List<RecurringInvoiceDto>> GetRecurringInvoicesAsync(int tenantId);
        Task<RecurringInvoiceDto?> CreateRecurringInvoiceAsync(CreateRecurringInvoiceRequest request, int userId, int tenantId);
        Task<bool> DeleteRecurringInvoiceAsync(int id, int tenantId);
        Task ProcessDueRecurringInvoicesAsync(CancellationToken ct = default);
    }

    public class RecurringInvoiceDto
    {
        public int Id { get; set; }
        public int CustomerId { get; set; }
        public string? CustomerName { get; set; }
        public int? BranchId { get; set; }
        public int? RouteId { get; set; }
        public RecurrenceFrequency Frequency { get; set; }
        public int? DayOfRecurrence { get; set; }
        public DateTime StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public DateTime NextRunDate { get; set; }
        public DateTime? LastRunDate { get; set; }
        public bool IsActive { get; set; }
        public List<RecurringInvoiceItemDto> Items { get; set; } = new();
    }

    public class RecurringInvoiceItemDto
    {
        public int ProductId { get; set; }
        public string? ProductName { get; set; }
        public decimal Qty { get; set; }
        public decimal UnitPrice { get; set; }
        public string UnitType { get; set; } = "CRTN";
    }

    public class CreateRecurringInvoiceRequest
    {
        public int CustomerId { get; set; }
        public int? BranchId { get; set; }
        public int? RouteId { get; set; }
        public RecurrenceFrequency Frequency { get; set; }
        public int? DayOfRecurrence { get; set; }
        public DateTime StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public string? Notes { get; set; }
        public List<RecurringInvoiceItemRequest> Items { get; set; } = new();
    }

    public class RecurringInvoiceItemRequest
    {
        public int ProductId { get; set; }
        public decimal Qty { get; set; }
        public decimal UnitPrice { get; set; }
        public string UnitType { get; set; } = "CRTN";
    }

    public class RecurringInvoiceService : IRecurringInvoiceService
    {
        private readonly AppDbContext _context;
        private readonly ISaleService _saleService;
        private readonly ILogger<RecurringInvoiceService> _logger;

        public RecurringInvoiceService(AppDbContext context, ISaleService saleService, ILogger<RecurringInvoiceService> logger)
        {
            _context = context;
            _saleService = saleService;
            _logger = logger;
        }

        public async Task<List<RecurringInvoiceDto>> GetRecurringInvoicesAsync(int tenantId)
        {
            var list = await _context.RecurringInvoices
                .Where(r => r.TenantId == tenantId)
                .Include(r => r.Customer)
                .Include(r => r.Items).ThenInclude(i => i.Product)
                .OrderBy(r => r.NextRunDate)
                .ToListAsync();
            return list.Select(r => new RecurringInvoiceDto
            {
                Id = r.Id,
                CustomerId = r.CustomerId,
                CustomerName = r.Customer?.Name,
                BranchId = r.BranchId,
                RouteId = r.RouteId,
                Frequency = r.Frequency,
                DayOfRecurrence = r.DayOfRecurrence,
                StartDate = r.StartDate,
                EndDate = r.EndDate,
                NextRunDate = r.NextRunDate,
                LastRunDate = r.LastRunDate,
                IsActive = r.IsActive,
                Items = r.Items.Select(i => new RecurringInvoiceItemDto
                {
                    ProductId = i.ProductId,
                    ProductName = i.Product?.NameEn,
                    Qty = i.Qty,
                    UnitPrice = i.UnitPrice,
                    UnitType = i.UnitType
                }).ToList()
            }).ToList();
        }

        public async Task<RecurringInvoiceDto?> CreateRecurringInvoiceAsync(CreateRecurringInvoiceRequest request, int userId, int tenantId)
        {
            var next = ComputeNextRunDate(request.StartDate, request.Frequency, request.DayOfRecurrence);
            var rec = new RecurringInvoice
            {
                TenantId = tenantId,
                CustomerId = request.CustomerId,
                BranchId = request.BranchId,
                RouteId = request.RouteId,
                Frequency = request.Frequency,
                DayOfRecurrence = request.DayOfRecurrence,
                StartDate = request.StartDate,
                EndDate = request.EndDate,
                NextRunDate = next,
                IsActive = true,
                Notes = request.Notes,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _context.RecurringInvoices.Add(rec);
            await _context.SaveChangesAsync();
            foreach (var item in request.Items)
            {
                _context.RecurringInvoiceItems.Add(new RecurringInvoiceItem
                {
                    RecurringInvoiceId = rec.Id,
                    ProductId = item.ProductId,
                    Qty = item.Qty,
                    UnitPrice = item.UnitPrice,
                    UnitType = item.UnitType ?? "CRTN"
                });
            }
            await _context.SaveChangesAsync();
            return (await GetRecurringInvoicesAsync(tenantId)).FirstOrDefault(r => r.Id == rec.Id);
        }

        public async Task<bool> DeleteRecurringInvoiceAsync(int id, int tenantId)
        {
            var rec = await _context.RecurringInvoices.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId);
            if (rec == null) return false;
            _context.RecurringInvoices.Remove(rec);
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task ProcessDueRecurringInvoicesAsync(CancellationToken ct = default)
        {
            var today = DateTime.UtcNow.Date;
            var due = await _context.RecurringInvoices
                .Where(r => r.IsActive && r.NextRunDate <= today
                    && (!r.EndDate.HasValue || r.EndDate.Value >= today))
                .Include(r => r.Customer)
                .Include(r => r.Items).ThenInclude(i => i.Product)
                .ToListAsync(ct);
            foreach (var rec in due)
            {
                try
                {
                    var saleReq = new CreateSaleRequest
                    {
                        CustomerId = rec.CustomerId,
                        BranchId = rec.BranchId,
                        RouteId = rec.RouteId,
                        InvoiceDate = rec.NextRunDate,
                        Notes = $"Recurring invoice (template #{rec.Id})",
                        Items = rec.Items.Select(i => new SaleItemRequest
                        {
                            ProductId = i.ProductId,
                            Qty = i.Qty,
                            UnitPrice = i.UnitPrice,
                            UnitType = string.IsNullOrWhiteSpace(i.UnitType) ? "CRTN" : i.UnitType
                        }).ToList()
                    };
                    await _saleService.CreateSaleAsync(saleReq, rec.CreatedBy, rec.TenantId);
                    rec.LastRunDate = rec.NextRunDate;
                    rec.NextRunDate = ComputeNextRunDate(rec.NextRunDate, rec.Frequency, rec.DayOfRecurrence);
                    rec.UpdatedAt = DateTime.UtcNow;
                    await _context.SaveChangesAsync(ct);
                    _logger.LogInformation("Recurring invoice {Id} processed for tenant {TenantId}", rec.Id, rec.TenantId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to process recurring invoice {Id}", rec.Id);
                }
            }
        }

        private static DateTime ComputeNextRunDate(DateTime from, RecurrenceFrequency freq, int? dayOf)
        {
            return freq switch
            {
                RecurrenceFrequency.Weekly => from.AddDays(7),
                RecurrenceFrequency.Monthly => from.AddMonths(1),
                RecurrenceFrequency.Yearly => from.AddYears(1),
                _ => from.AddDays(1) // Daily
            };
        }
    }
}
