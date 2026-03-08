/*
Purpose: Supplier ledger credit (e.g. vendor discount) – reduces supplier outstanding.
Author: HexaBill
Date: 2025
*/
using System.ComponentModel.DataAnnotations;

namespace HexaBill.Api.Models
{
    public class SupplierLedgerCredit
    {
        public int Id { get; set; }

        public int TenantId { get; set; }

        [Required]
        [MaxLength(200)]
        public string SupplierName { get; set; } = string.Empty;

        public decimal Amount { get; set; }

        public DateTime CreditDate { get; set; }

        [Required]
        [MaxLength(50)]
        public string CreditType { get; set; } = string.Empty; // e.g. Cash Discount, Promotional

        [MaxLength(500)]
        public string? Notes { get; set; }

        public int CreatedBy { get; set; }

        public DateTime CreatedAt { get; set; }
    }
}
