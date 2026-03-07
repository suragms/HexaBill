/*
Purpose: VendorDiscount model for owner-only tracking of supplier discounts (not reflected in ledger or reports).
Author: HexaBill
Date: 2025
*/
using System.ComponentModel.DataAnnotations;

namespace HexaBill.Api.Models
{
    public class VendorDiscount
    {
        public int Id { get; set; }

        public int TenantId { get; set; }

        public int SupplierId { get; set; }
        public virtual Supplier Supplier { get; set; } = null!;

        /// <summary>Optional link to a specific purchase (e.g. bulk order discount).</summary>
        public int? PurchaseId { get; set; }
        public virtual Purchase? Purchase { get; set; }

        [Required]
        [Range(0.01, double.MaxValue, ErrorMessage = "Amount must be positive.")]
        public decimal Amount { get; set; }

        public DateTime DiscountDate { get; set; }

        [Required]
        [MaxLength(50)]
        public string DiscountType { get; set; } = string.Empty; // Cash Discount, Free Products, Promotional, Negotiated

        [Required]
        [MinLength(3)]
        [MaxLength(500)]
        public string Reason { get; set; } = string.Empty;

        public bool IsActive { get; set; } = true;

        public int CreatedBy { get; set; }
        public virtual User CreatedByUser { get; set; } = null!;

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
