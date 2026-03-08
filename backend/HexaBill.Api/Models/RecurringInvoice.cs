/*
Purpose: Recurring invoice template for automated invoice generation
Author: HexaBill
Date: 2025
*/
using System.ComponentModel.DataAnnotations;

namespace HexaBill.Api.Models
{
    public class RecurringInvoice
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int CustomerId { get; set; }
        public int? BranchId { get; set; }
        public int? RouteId { get; set; }
        public RecurrenceFrequency Frequency { get; set; }
        public int? DayOfRecurrence { get; set; }
        public DateTime StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public DateTime NextRunDate { get; set; }
        public DateTime? LastRunDate { get; set; }
        public bool IsActive { get; set; } = true;
        public string? Notes { get; set; }
        public int CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }

        public virtual Customer Customer { get; set; } = null!;
        public virtual Branch? Branch { get; set; }
        public virtual HexaBill.Api.Models.Route? Route { get; set; }
        public virtual ICollection<RecurringInvoiceItem> Items { get; set; } = new List<RecurringInvoiceItem>();
    }

    public class RecurringInvoiceItem
    {
        public int Id { get; set; }
        public int RecurringInvoiceId { get; set; }
        public int ProductId { get; set; }
        public decimal Qty { get; set; }
        public decimal UnitPrice { get; set; }
        [MaxLength(20)]
        public string UnitType { get; set; } = "CRTN";

        public virtual RecurringInvoice RecurringInvoice { get; set; } = null!;
        public virtual Product Product { get; set; } = null!;
    }
}
