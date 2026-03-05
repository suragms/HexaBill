/*
Purpose: Supplier payment records for credit/partial payment tracking
Author: HexaBill Production Fixes
*/
using System.ComponentModel.DataAnnotations;

namespace HexaBill.Api.Models
{
    public class SupplierPayment
    {
        public int Id { get; set; }
        public int? TenantId { get; set; }
        public int SupplierId { get; set; }
        public decimal Amount { get; set; }
        public DateTime PaymentDate { get; set; }
        [MaxLength(200)]
        public string? Reference { get; set; }
        /// <summary>Optional link to a purchase (e.g. partial payment against invoice).</summary>
        public int? PurchaseId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public virtual Supplier Supplier { get; set; } = null!;
        public virtual Purchase? Purchase { get; set; }
    }
}
