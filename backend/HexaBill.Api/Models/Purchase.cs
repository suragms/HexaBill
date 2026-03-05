/*
Purpose: Purchase and PurchaseItem models for supplier purchases
Author: AI Assistant
Date: 2024
*/
using System.ComponentModel.DataAnnotations;

namespace HexaBill.Api.Models
{
    public class Purchase
    {
        public int Id { get; set; }
        
        // MULTI-TENANT: Owner identification for data isolation (legacy, will be removed after migration)
        public int OwnerId { get; set; }
        
        // MULTI-TENANT: Tenant identification (new, replaces OwnerId)
        public int? TenantId { get; set; }
        
        /// <summary>Optional FK to Suppliers; kept for backward compatibility with SupplierName.</summary>
        public int? SupplierId { get; set; }
        [Required]
        [MaxLength(200)]
        public string SupplierName { get; set; } = string.Empty;
        [Required]
        [MaxLength(100)]
        public string InvoiceNo { get; set; } = string.Empty;
        
        [MaxLength(200)]
        public string? ExternalReference { get; set; } // For idempotency - unique external reference
        
        [MaxLength(100)]
        public string? ExpenseCategory { get; set; } // Track purchase expense type (e.g., "Inventory", "Supplies", "Equipment")
        
        public DateTime PurchaseDate { get; set; }
        
        // VAT TRACKING FIELDS (Added for accurate profit calculations)
        public decimal? Subtotal { get; set; } // Amount before VAT (nullable for backward compatibility)
        public decimal? VatTotal { get; set; } // VAT amount (5% in UAE, nullable for backward compatibility)
        public decimal TotalAmount { get; set; } // Grand total (Subtotal + VAT) - kept for backward compatibility

        /// <summary>Cash = full payment at purchase; Credit = pay later; Partial = part paid now.</summary>
        [MaxLength(20)]
        public string? PaymentType { get; set; } // Cash, Credit, Partial
        /// <summary>Amount paid at purchase (when PaymentType is Partial or Cash).</summary>
        public decimal? AmountPaid { get; set; }
        /// <summary>Due date for credit (PurchaseDate + credit terms). Overdue when DueDate &lt; Today and Balance &gt; 0.</summary>
        public DateTime? DueDate { get; set; }

        public string? InvoiceFilePath { get; set; }
        public string? InvoiceFileName { get; set; }
        public int CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; }

        // Navigation properties
        public virtual Supplier? Supplier { get; set; }
        public virtual ICollection<PurchaseItem> Items { get; set; } = new List<PurchaseItem>();
        public virtual User CreatedByUser { get; set; } = null!;
    }

    public class PurchaseItem
    {
        public int Id { get; set; }
        public int PurchaseId { get; set; }
        public int ProductId { get; set; }
        [Required]
        [MaxLength(20)]
        public string UnitType { get; set; } = "CRTN";
        public decimal Qty { get; set; }
        public decimal UnitCost { get; set; } // Cost per unit INCLUDING VAT (for backward compatibility)
        
        // VAT TRACKING FIELDS (Added for accurate cost tracking)
        public decimal? UnitCostExclVat { get; set; } // Cost per unit EXCLUDING VAT (nullable for backward compatibility)
        public decimal? VatAmount { get; set; } // VAT amount for this line (nullable for backward compatibility)
        
        public decimal LineTotal { get; set; } // Total INCLUDING VAT (for backward compatibility)

        // Navigation properties
        public virtual Purchase Purchase { get; set; } = null!;
        public virtual Product Product { get; set; } = null!;
    }
}

