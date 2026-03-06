/*
Purpose: Supplier model for supplier management
Author: HexaBill ERP Redesign
Date: 2025
*/
using System.ComponentModel.DataAnnotations;

namespace HexaBill.Api.Models
{
    public class Supplier
    {
        public int Id { get; set; }

        public int TenantId { get; set; }

        [Required]
        [MaxLength(200)]
        public string Name { get; set; } = string.Empty;

        /// <summary>Lowercase name for unique index (TenantId, NormalizedName). Required by DB.</summary>
        [Required]
        [MaxLength(200)]
        public string NormalizedName { get; set; } = string.Empty;

        [MaxLength(50)]
        public string? Phone { get; set; }

        [MaxLength(200)]
        public string? Email { get; set; }

        [MaxLength(500)]
        public string? Address { get; set; }

        public decimal CreditLimit { get; set; }

        [MaxLength(100)]
        public string? PaymentTerms { get; set; }

        public bool IsActive { get; set; } = true;

        public DateTime CreatedAt { get; set; }

        public DateTime UpdatedAt { get; set; }
    }
}
