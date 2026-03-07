/*
Purpose: Vendor Discounts service interface (Owner/Admin only; data not used in ledger or reports).
Author: HexaBill
Date: 2025
*/

namespace HexaBill.Api.Modules.VendorDiscounts
{
    public interface IVendorDiscountService
    {
        Task<VendorDiscountListWithTotalDto> GetSupplierDiscountsWithTotalAsync(int supplierId, int tenantId);
        Task<VendorDiscountDto?> GetByIdAsync(int id, int supplierId, int tenantId);
        Task<VendorDiscountDto> CreateVendorDiscountAsync(int supplierId, CreateOrUpdateVendorDiscountRequest dto, int currentUserId, int tenantId);
        Task<VendorDiscountDto?> UpdateVendorDiscountAsync(int id, int supplierId, CreateOrUpdateVendorDiscountRequest dto, int tenantId);
        Task<bool> DeleteVendorDiscountAsync(int id, int supplierId, int tenantId);
    }
}
