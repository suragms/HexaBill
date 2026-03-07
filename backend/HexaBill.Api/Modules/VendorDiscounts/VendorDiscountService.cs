/*
Purpose: Vendor Discounts service – private tracking only; NOT used in ledger, balance, or reports.
Author: HexaBill
Date: 2025
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;

namespace HexaBill.Api.Modules.VendorDiscounts
{
    public class VendorDiscountService : IVendorDiscountService
    {
        private readonly AppDbContext _context;

        public VendorDiscountService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<VendorDiscountListWithTotalDto> GetSupplierDiscountsWithTotalAsync(int supplierId, int tenantId)
        {
            await EnsureSupplierExistsAsync(supplierId, tenantId);

            var list = await _context.VendorDiscounts
                .AsNoTracking()
                .Include(v => v.Purchase)
                .Include(v => v.CreatedByUser)
                .Where(v => v.SupplierId == supplierId && v.TenantId == tenantId && v.IsActive)
                .OrderByDescending(v => v.DiscountDate)
                .Select(v => new VendorDiscountDto
                {
                    Id = v.Id,
                    SupplierId = v.SupplierId,
                    PurchaseId = v.PurchaseId,
                    PurchaseInvoiceNo = v.Purchase != null ? v.Purchase.InvoiceNo : null,
                    Amount = v.Amount,
                    DiscountDate = v.DiscountDate,
                    DiscountType = v.DiscountType,
                    Reason = v.Reason,
                    CreatedByUserName = v.CreatedByUser != null ? v.CreatedByUser.Name : null,
                    CreatedAt = v.CreatedAt,
                    UpdatedAt = v.UpdatedAt
                })
                .ToListAsync();

            var totalSavings = list.Sum(v => v.Amount);

            return new VendorDiscountListWithTotalDto
            {
                Items = list,
                TotalSavings = totalSavings
            };
        }

        public async Task<VendorDiscountDto?> GetByIdAsync(int id, int supplierId, int tenantId)
        {
            var v = await _context.VendorDiscounts
                .AsNoTracking()
                .Include(x => x.Purchase)
                .Include(x => x.CreatedByUser)
                .FirstOrDefaultAsync(x => x.Id == id && x.SupplierId == supplierId && x.TenantId == tenantId && x.IsActive);
            if (v == null) return null;

            return new VendorDiscountDto
            {
                Id = v.Id,
                SupplierId = v.SupplierId,
                PurchaseId = v.PurchaseId,
                PurchaseInvoiceNo = v.Purchase?.InvoiceNo,
                Amount = v.Amount,
                DiscountDate = v.DiscountDate,
                DiscountType = v.DiscountType,
                Reason = v.Reason,
                CreatedByUserName = v.CreatedByUser?.Name,
                CreatedAt = v.CreatedAt,
                UpdatedAt = v.UpdatedAt
            };
        }

        public async Task<VendorDiscountDto> CreateVendorDiscountAsync(int supplierId, CreateOrUpdateVendorDiscountRequest dto, int currentUserId, int tenantId)
        {
            await ValidateSupplierAndPurchaseAsync(supplierId, dto.PurchaseId, tenantId);
            ValidateRequest(dto);

            var entity = new VendorDiscount
            {
                TenantId = tenantId,
                SupplierId = supplierId,
                PurchaseId = dto.PurchaseId,
                Amount = dto.Amount,
                DiscountDate = dto.DiscountDate.Kind == DateTimeKind.Utc ? dto.DiscountDate : DateTime.SpecifyKind(dto.DiscountDate, DateTimeKind.Utc),
                DiscountType = dto.DiscountType.Trim(),
                Reason = dto.Reason.Trim(),
                IsActive = true,
                CreatedBy = currentUserId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            _context.VendorDiscounts.Add(entity);
            await _context.SaveChangesAsync();

            await AuditAsync(tenantId, currentUserId, "VendorDiscount Created", $"Id: {entity.Id}, SupplierId: {supplierId}, Amount: {entity.Amount}, Type: {entity.DiscountType}");

            return (await GetByIdAsync(entity.Id, supplierId, tenantId))!;
        }

        public async Task<VendorDiscountDto?> UpdateVendorDiscountAsync(int id, int supplierId, CreateOrUpdateVendorDiscountRequest dto, int tenantId)
        {
            await ValidateSupplierAndPurchaseAsync(supplierId, dto.PurchaseId, tenantId);
            ValidateRequest(dto);

            var entity = await _context.VendorDiscounts
                .FirstOrDefaultAsync(x => x.Id == id && x.SupplierId == supplierId && x.TenantId == tenantId && x.IsActive);
            if (entity == null) return null;

            entity.PurchaseId = dto.PurchaseId;
            entity.Amount = dto.Amount;
            entity.DiscountDate = dto.DiscountDate.Kind == DateTimeKind.Utc ? dto.DiscountDate : DateTime.SpecifyKind(dto.DiscountDate, DateTimeKind.Utc);
            entity.DiscountType = dto.DiscountType.Trim();
            entity.Reason = dto.Reason.Trim();
            entity.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            var userId = entity.CreatedBy; // or pass currentUserId if we want to log who updated
            await AuditAsync(tenantId, userId, "VendorDiscount Updated", $"Id: {id}, SupplierId: {supplierId}, Amount: {entity.Amount}");

            return await GetByIdAsync(id, supplierId, tenantId);
        }

        public async Task<bool> DeleteVendorDiscountAsync(int id, int supplierId, int tenantId)
        {
            await EnsureSupplierExistsAsync(supplierId, tenantId);

            var entity = await _context.VendorDiscounts
                .FirstOrDefaultAsync(x => x.Id == id && x.SupplierId == supplierId && x.TenantId == tenantId && x.IsActive);
            if (entity == null) return false;

            entity.IsActive = false;
            entity.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            await AuditAsync(tenantId, entity.CreatedBy, "VendorDiscount Deleted", $"Id: {id}, SupplierId: {supplierId}, Amount: {entity.Amount}");
            return true;
        }

        private async Task EnsureSupplierExistsAsync(int supplierId, int tenantId)
        {
            var exists = await _context.Suppliers.AnyAsync(s => s.Id == supplierId && s.TenantId == tenantId);
            if (!exists)
                throw new ArgumentException("Supplier not found or does not belong to the current tenant.", nameof(supplierId));
        }

        private async Task ValidateSupplierAndPurchaseAsync(int supplierId, int? purchaseId, int tenantId)
        {
            var supplier = await _context.Suppliers
                .FirstOrDefaultAsync(s => s.Id == supplierId && s.TenantId == tenantId);
            if (supplier == null)
                throw new ArgumentException("Supplier not found or does not belong to the current tenant.", nameof(supplierId));

            if (purchaseId.HasValue && purchaseId.Value > 0)
            {
                var purchase = await _context.Purchases
                    .FirstOrDefaultAsync(p => p.Id == purchaseId.Value && (p.TenantId == tenantId || p.OwnerId == tenantId));
                if (purchase == null)
                    throw new ArgumentException("Purchase not found or does not belong to the current tenant.", nameof(purchaseId));
                var belongsToSupplier = purchase.SupplierId == supplierId ||
                    string.Equals(purchase.SupplierName, supplier.Name, StringComparison.OrdinalIgnoreCase);
                if (!belongsToSupplier)
                    throw new ArgumentException("Purchase does not belong to this supplier.", nameof(purchaseId));
            }
        }

        private static void ValidateRequest(CreateOrUpdateVendorDiscountRequest dto)
        {
            if (dto.Amount <= 0)
                throw new ArgumentException("Amount must be positive.", nameof(dto.Amount));
            if (dto.DiscountDate.Date > DateTime.UtcNow.Date)
                throw new ArgumentException("Discount date cannot be in the future.", nameof(dto.DiscountDate));
            if (string.IsNullOrWhiteSpace(dto.Reason) || dto.Reason.Trim().Length < 3)
                throw new ArgumentException("Reason is required and must be at least 3 characters.", nameof(dto.Reason));
            if (string.IsNullOrWhiteSpace(dto.DiscountType))
                throw new ArgumentException("Discount type is required.", nameof(dto.DiscountType));
        }

        private async Task AuditAsync(int tenantId, int userId, string action, string details)
        {
            _context.AuditLogs.Add(new AuditLog
            {
                OwnerId = tenantId,
                TenantId = tenantId,
                UserId = userId,
                Action = action,
                EntityType = "VendorDiscount",
                Details = details,
                CreatedAt = DateTime.UtcNow
            });
            await _context.SaveChangesAsync();
        }
    }
}
