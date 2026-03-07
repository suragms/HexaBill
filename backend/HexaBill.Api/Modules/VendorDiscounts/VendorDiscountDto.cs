/*
Purpose: DTOs for Vendor Discounts API (private tracking only; not in ledger or reports).
Author: HexaBill
Date: 2025
*/

namespace HexaBill.Api.Modules.VendorDiscounts
{
    public class VendorDiscountDto
    {
        public int Id { get; set; }
        public int SupplierId { get; set; }
        public int? PurchaseId { get; set; }
        public string? PurchaseInvoiceNo { get; set; }
        public decimal Amount { get; set; }
        public DateTime DiscountDate { get; set; }
        public string DiscountType { get; set; } = string.Empty;
        public string Reason { get; set; } = string.Empty;
        public string? CreatedByUserName { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public class CreateOrUpdateVendorDiscountRequest
    {
        public int? PurchaseId { get; set; }
        public decimal Amount { get; set; }
        public DateTime DiscountDate { get; set; }
        public string DiscountType { get; set; } = string.Empty;
        public string Reason { get; set; } = string.Empty;
    }

    public class VendorDiscountListWithTotalDto
    {
        public List<VendorDiscountDto> Items { get; set; } = new();
        public decimal TotalSavings { get; set; }
    }
}
