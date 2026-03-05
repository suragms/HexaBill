/*
Purpose: Optional categorization for suppliers
Author: HexaBill Production Fixes
*/
using System.ComponentModel.DataAnnotations;

namespace HexaBill.Api.Models
{
    public class SupplierCategory
    {
        public int Id { get; set; }
        public int? TenantId { get; set; }
        [Required]
        [MaxLength(100)]
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public virtual ICollection<Supplier> Suppliers { get; set; } = new List<Supplier>();
    }
}
