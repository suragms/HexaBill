/*
Purpose: Supplier master for purchase credit and payable tracking
Author: HexaBill Production Fixes
*/
using System.ComponentModel.DataAnnotations;

namespace HexaBill.Api.Models
{
    public class Supplier
    {
        public int Id { get; set; }
        public int? TenantId { get; set; }
        [Required]
        [MaxLength(200)]
        public string Name { get; set; } = string.Empty;
        /// <summary>Normalized name for unique constraint (TenantId, NormalizedName).</summary>
        [MaxLength(200)]
        public string NormalizedName { get; set; } = string.Empty;
        [MaxLength(50)]
        public string? Phone { get; set; }
        [MaxLength(500)]
        public string? Address { get; set; }
        public int? CategoryId { get; set; }
        public decimal OpeningBalance { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public virtual SupplierCategory? Category { get; set; }
        public virtual ICollection<Purchase> Purchases { get; set; } = new List<Purchase>();
        public virtual ICollection<SupplierPayment> Payments { get; set; } = new List<SupplierPayment>();
    }
}
