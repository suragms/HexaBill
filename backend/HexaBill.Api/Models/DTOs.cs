/*
Purpose: Data Transfer Objects for API communication
Author: AI Assistant
Date: 2024
*/
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace HexaBill.Api.Models
{
    // Auth DTOs
    public class LoginRequest
    {
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;
        [Required]
        public string Password { get; set; } = string.Empty;
        public bool RememberMe { get; set; }
    }

    public class LoginResponse
    {
        public string Token { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public int UserId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string CompanyName { get; set; } = string.Empty;
        public string? DashboardPermissions { get; set; }
        /// <summary>Comma-separated page access for Staff. Frontend uses for route guards.</summary>
        public string? PageAccess { get; set; }
        public DateTime ExpiresAt { get; set; }
        /// <summary>Tenant ID (0 = Super Admin, >0 = tenant user). Used by frontend for access control.</summary>
        public int? TenantId { get; set; }
        public List<int> AssignedBranchIds { get; set; } = new();
        public List<int> AssignedRouteIds { get; set; } = new();
    }

    public class RegisterRequest
    {
        [Required]
        [MaxLength(100)]
        public string Name { get; set; } = string.Empty;
        [Required]
        [EmailAddress]
        [MaxLength(100)]
        public string Email { get; set; } = string.Empty;
        [Required]
        [MinLength(6)]
        public string Password { get; set; } = string.Empty;
        [Required]
        public string Role { get; set; } = "Staff";
        [MaxLength(20)]
        public string? Phone { get; set; }
        [MaxLength(500)]
        public string? DashboardPermissions { get; set; }
        [MaxLength(500)]
        public string? PageAccess { get; set; }
    }

    public class RegisterResponse
    {
        public int UserId { get; set; }
        public string Email { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
    }

    public class VerifyEmailRequest
    {
        [Required]
        public string Token { get; set; } = string.Empty;
    }

    public class ResendVerificationRequest
    {
        [Required]
        [EmailAddress]
        public string Email { get; set; } = string.Empty;
    }

    // UserDto is in UserDto.cs to avoid duplicate

    public class CreateUserRequest
    {
        [Required]
        [MaxLength(100)]
        public string Name { get; set; } = string.Empty;
        [Required]
        [EmailAddress]
        [MaxLength(100)]
        public string Email { get; set; } = string.Empty;
        [Required]
        [MinLength(6)]
        [MaxLength(100)]
        public string Password { get; set; } = string.Empty;
        [Required]
        [MaxLength(50)]
        public string Role { get; set; } = "Staff";
        [MaxLength(20)]
        public string? Phone { get; set; }
        [MaxLength(500)]
        public string? DashboardPermissions { get; set; }
        [MaxLength(500)]
        public string? PageAccess { get; set; }
        public List<int>? AssignedBranchIds { get; set; }
        public List<int>? AssignedRouteIds { get; set; }
    }

    public class UpdateUserRequest
    {
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public string? Role { get; set; }
        public string? DashboardPermissions { get; set; }
        [MaxLength(500)]
        public string? PageAccess { get; set; }
        public List<int>? AssignedBranchIds { get; set; }
        public List<int>? AssignedRouteIds { get; set; }
    }

    public class ResetPasswordRequest
    {
        [Required]
        [MinLength(6)]
        public string NewPassword { get; set; } = string.Empty;
    }

    public class UnlockLoginRequest
    {
        [Required]
        public string Email { get; set; } = string.Empty;
    }

    public class LockLoginRequest
    {
        [Required]
        public string Email { get; set; } = string.Empty;
        public int DurationMinutes { get; set; } = 15;
    }

    // Product DTOs
    public class ProductDto
    {
        public int Id { get; set; }
        public string Sku { get; set; } = string.Empty;
        public string? Barcode { get; set; }
        public string NameEn { get; set; } = string.Empty;
        public string? NameAr { get; set; }
        public string UnitType { get; set; } = string.Empty;
        public decimal ConversionToBase { get; set; }
        public decimal CostPrice { get; set; }
        public decimal SellPrice { get; set; }
        public decimal StockQty { get; set; }
        public int ReorderLevel { get; set; }
        public DateTime? ExpiryDate { get; set; }
        public string? DescriptionEn { get; set; }
        public string? DescriptionAr { get; set; }
        public int? CategoryId { get; set; }
        public string? CategoryName { get; set; }
        public string? ImageUrl { get; set; }
        public bool IsActive { get; set; } = true;
    }

    public class CreateProductRequest
    {
        [Required]
        [MaxLength(50)]
        public string Sku { get; set; } = string.Empty;
        [MaxLength(100)]
        public string? Barcode { get; set; }
        [Required]
        [MaxLength(200)]
        public string NameEn { get; set; } = string.Empty;
        [MaxLength(200)]
        public string? NameAr { get; set; }
        [Required]
        [MaxLength(20)]
        public string UnitType { get; set; } = string.Empty;
        [Required]
        [Range(0.0001, 999999.99, ErrorMessage = "ConversionToBase must be greater than 0")]
        public decimal ConversionToBase { get; set; }
        [Required]
        [Range(0, 99999999.99, ErrorMessage = "CostPrice must be non-negative")]
        public decimal CostPrice { get; set; }
        [Required]
        [Range(0, 99999999.99, ErrorMessage = "SellPrice must be non-negative")]
        public decimal SellPrice { get; set; }
        [Range(0, 99999999.99, ErrorMessage = "StockQty must be non-negative")]
        public decimal StockQty { get; set; } = 0;
        [Range(0, int.MaxValue, ErrorMessage = "ReorderLevel must be non-negative")]
        public int ReorderLevel { get; set; } = 0;
        public DateTime? ExpiryDate { get; set; }
        [MaxLength(500)]
        public string? DescriptionEn { get; set; }
        [MaxLength(500)]
        public string? DescriptionAr { get; set; }
        public int? CategoryId { get; set; }
        [MaxLength(500)]
        public string? ImageUrl { get; set; }
    }

    public class PriceChangeLogDto
    {
        public int Id { get; set; }
        public int ProductId { get; set; }
        public decimal OldPrice { get; set; }
        public decimal NewPrice { get; set; }
        public decimal PriceDifference { get; set; }
        public int ChangedBy { get; set; }
        public string? ChangedByName { get; set; }
        public string? Reason { get; set; }
        public DateTime ChangedAt { get; set; }
    }

    public class ProductCategoryDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string? ColorCode { get; set; }
        public int ProductCount { get; set; }
    }

    public class CreateProductCategoryRequest
    {
        [Required]
        [MaxLength(100)]
        public string Name { get; set; } = string.Empty;
        [MaxLength(200)]
        public string? Description { get; set; }
        [MaxLength(7)]
        [RegularExpression(@"^#[0-9A-Fa-f]{6}$", ErrorMessage = "ColorCode must be a valid hex color (e.g., #FF5733)")]
        public string? ColorCode { get; set; }
    }

    public class BulkPriceUpdateRequest
    {
        [MaxLength(20)]
        public string? UnitType { get; set; }
        public int? CategoryId { get; set; }
        public bool UpdateSellPrice { get; set; }
        public bool UpdateCostPrice { get; set; }
        [MaxLength(20)]
        [RegularExpression(@"^(percentage|fixed)$", ErrorMessage = "UpdateType must be 'percentage' or 'fixed'")]
        public string UpdateType { get; set; } = "percentage"; // "percentage" | "fixed"
        [Range(-100, 1000, ErrorMessage = "Value must be between -100 and 1000 for percentage, or positive for fixed")]
        public decimal Value { get; set; }
        public List<BulkPriceUpdateItem> Items { get; set; } = new();
    }

    public class BulkPriceUpdateItem
    {
        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "ProductId must be greater than 0")]
        public int ProductId { get; set; }
        [Required]
        [Range(0, 99999999.99, ErrorMessage = "NewPrice must be non-negative")]
        public decimal NewPrice { get; set; }
    }

    public class BulkPriceUpdateResponse
    {
        public int Updated { get; set; }
        public int ProductsUpdated { get; set; }
        public int Failed { get; set; }
        public List<string> Errors { get; set; } = new();
    }

    // Sale DTOs
    public class CreateSaleRequest
    {
        public int? CustomerId { get; set; }
        public int? BranchId { get; set; }
        public int? RouteId { get; set; }
        [Required]
        [MinLength(1, ErrorMessage = "At least one item is required")]
        public List<SaleItemRequest> Items { get; set; } = new();
        public List<PaymentRequest>? Payments { get; set; }
        [MaxLength(500)]
        public string? Notes { get; set; }
        [Range(0, 99999999.99, ErrorMessage = "Discount must be non-negative")]
        public decimal Discount { get; set; } = 0;
        /// <summary>Round-off adjustment (e.g. -0.20). Range ±1.00 AED. Applied after VAT.</summary>
        public decimal RoundOff { get; set; } = 0m;
        [MaxLength(100)]
        public string? InvoiceNo { get; set; } // Optional: Manual invoice number (if not provided, auto-generate)
        [MaxLength(200)]
        public string? ExternalReference { get; set; } // For idempotency - unique external reference (e.g., POS terminal ID, mobile app transaction ID)
        public DateTime? InvoiceDate { get; set; } // Optional: Custom invoice date (defaults to today if not provided) - Admin and Staff can set
        public DateTime? DueDate { get; set; } // Optional: Payment due date for credit customers
        /// <summary>True = zero value invoice / free sample; all line amounts and VAT forced to 0.</summary>
        public bool IsZeroInvoice { get; set; }
    }

    public class UpdateSaleRequest
    {
        public int? CustomerId { get; set; }
        [Required]
        [MinLength(1, ErrorMessage = "At least one item is required")]
        public List<SaleItemRequest> Items { get; set; } = new();
        public List<PaymentRequest>? Payments { get; set; }
        [MaxLength(500)]
        public string? Notes { get; set; }
        [Range(0, 99999999.99, ErrorMessage = "Discount must be non-negative")]
        public decimal Discount { get; set; } = 0;
        /// <summary>Round-off adjustment (e.g. -0.20). Range ±1.00 AED.</summary>
        public decimal RoundOff { get; set; } = 0m;
        [MaxLength(500)]
        public string? EditReason { get; set; } // Required for Staff users
        public string? RowVersion { get; set; } // Base64 encoded RowVersion for concurrency control
        public DateTime? InvoiceDate { get; set; } // Optional: Custom invoice date - Admin and Staff can modify
        public DateTime? DueDate { get; set; } // Optional: Payment due date for credit customers
        public bool IsZeroInvoice { get; set; }
    }

    public class UnlockInvoiceRequest
    {
        [Required]
        public string Reason { get; set; } = string.Empty; // Reason for unlocking
    }

    public class SaleItemRequest
    {
        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "ProductId must be greater than 0")]
        public int ProductId { get; set; }
        [Required]
        [MaxLength(20)]
        public string UnitType { get; set; } = string.Empty;
        [Required]
        [Range(0.0001, 999999.99, ErrorMessage = "Qty must be greater than 0")]
        public decimal Qty { get; set; }
        [Required]
        [Range(0, 99999999.99, ErrorMessage = "UnitPrice must be non-negative")]
        public decimal UnitPrice { get; set; }
    }

    public class PaymentRequest
    {
        [Required]
        public string Method { get; set; } = string.Empty;
        [Required]
        public decimal Amount { get; set; }
        public string? Ref { get; set; }
    }

    public class ValidateInvoiceNumberRequest
    {
        [Required]
        public string InvoiceNumber { get; set; } = string.Empty;
        public int? ExcludeSaleId { get; set; }
    }

    public class SaleDto
    {
        public int Id { get; set; }
        public int OwnerId { get; set; } // MULTI-TENANT: Owner identification
        public string InvoiceNo { get; set; } = string.Empty;
        public DateTime InvoiceDate { get; set; }
        public int? CustomerId { get; set; }
        public int? BranchId { get; set; }
        public int? RouteId { get; set; }
        public string? CustomerName { get; set; }
        public decimal Subtotal { get; set; }
        public decimal VatTotal { get; set; }
        public decimal Discount { get; set; }
        public decimal RoundOff { get; set; }
        public decimal GrandTotal { get; set; }
        public decimal PaidAmount { get; set; } // CRITICAL: Include for balance calculation and accurate reporting
        public string PaymentStatus { get; set; } = string.Empty;
        public DateTime? DueDate { get; set; } // Payment due date for credit customers
        public string? Notes { get; set; }
        public List<SaleItemDto> Items { get; set; } = new();
        public DateTime CreatedAt { get; set; }
        public string CreatedBy { get; set; } = string.Empty;
        public int Version { get; set; } = 1; // Version number for tracking edits
        public bool IsLocked { get; set; } = false; // Locked after 8 hours
        public DateTime? LastModifiedAt { get; set; }
        public string? LastModifiedBy { get; set; }
        public string? RowVersion { get; set; } // Base64 encoded for concurrency control
        public string? DeletedBy { get; set; } // Deleted by (for audit trail)
        public DateTime? DeletedAt { get; set; } // Deleted at (for audit trail)
        public bool CreditLimitExceeded { get; set; } = false; // True if sale exceeds customer credit limit
        public string? CreditLimitWarning { get; set; } // Warning message if credit limit exceeded
        public string? EditReason { get; set; }
        public bool IsZeroInvoice { get; set; }
    }

    public class SaleItemDto
    {
        public int Id { get; set; }
        public int ProductId { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public string UnitType { get; set; } = string.Empty;
        public decimal Qty { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal Discount { get; set; }
        public decimal VatAmount { get; set; }
        public decimal LineTotal { get; set; }
    }

    public class HoldInvoiceRequest
    {
        public string? Name { get; set; }
        public string? Notes { get; set; }
        public object? InvoiceData { get; set; }
        /// <summary>Round-off amount (e.g. -0.20). Range ±1.00 AED.</summary>
        public decimal RoundOff { get; set; } = 0m;
    }

    public class HeldInvoiceDto
    {
        public int Id { get; set; }
        public int SaleId { get; set; }
        public string? Name { get; set; }
        public string? Notes { get; set; }
        public object? InvoiceData { get; set; }
        public decimal RoundOff { get; set; }
        public DateTime? CreatedAt { get; set; }
    }

    public class PaymentReceiptDto
    {
        public int Id { get; set; }
        public string ReceiptNumber { get; set; } = string.Empty;
        public int PaymentId { get; set; }
        public DateTime GeneratedAt { get; set; }
    }

    public class PaymentReceiptDetailDto
    {
        public string ReceiptNumber { get; set; } = string.Empty;
        public DateTime ReceiptDate { get; set; }
        public string CompanyName { get; set; } = string.Empty;
        public string? CompanyNameAr { get; set; }
        public string? CompanyTrn { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string ReceivedFrom { get; set; } = string.Empty;
        public string? CustomerTrn { get; set; }
        public decimal AmountReceived { get; set; }
        public string AmountInWords { get; set; } = string.Empty;
        public string PaymentMethod { get; set; } = string.Empty;
        public string? Reference { get; set; }
        public List<PaymentReceiptInvoiceLineDto> Invoices { get; set; } = new();
        public decimal? PreviousBalance { get; set; }
        public decimal AmountPaid { get; set; }
        public decimal? RemainingBalance { get; set; }
    }

    public class PaymentReceiptInvoiceLineDto
    {
        public string InvoiceNo { get; set; } = string.Empty;
        public DateTime InvoiceDate { get; set; }
        public decimal InvoiceTotal { get; set; }
        public decimal AmountApplied { get; set; }
    }

    public class PaymentReceiptBatchRequest
    {
        [JsonPropertyName("paymentIds")]
        public List<int> PaymentIds { get; set; } = new();
    }

    // Purchase DTOs
    public class CreatePurchaseRequest
    {
        [Required]
        [MaxLength(200)]
        public string SupplierName { get; set; } = string.Empty;
        [Required]
        [MaxLength(100)]
        public string InvoiceNo { get; set; } = string.Empty;
        [Required]
        public DateTime PurchaseDate { get; set; }
        [MaxLength(100)]
        public string? ExpenseCategory { get; set; } // Optional expense category (e.g., "Inventory", "Supplies", "Equipment")
        
        // VAT HANDLING (Optional - if not provided, system will auto-calculate assuming costs include VAT)
        public bool? IncludesVat { get; set; } // True if costs include VAT, False if VAT should be added, Null for auto-detection
        [Range(0, 100, ErrorMessage = "VatPercent must be between 0 and 100")]
        public decimal? VatPercent { get; set; } // VAT percentage (default 5% for UAE)

        // Payment: Cash = full at purchase, Credit = pay later, Partial = part paid now
        [MaxLength(20)]
        public string? PaymentType { get; set; } // Cash, Credit, Partial
        [Range(0, 99999999.99, ErrorMessage = "AmountPaid must be non-negative")]
        public decimal? AmountPaid { get; set; } // Required when PaymentType is Partial; when Cash, can be set to TotalAmount
        
        [Required]
        [MinLength(1, ErrorMessage = "At least one item is required")]
        public List<PurchaseItemRequest> Items { get; set; } = new();
    }

    public class PurchaseItemRequest
    {
        [Required]
        [Range(1, int.MaxValue, ErrorMessage = "ProductId must be greater than 0")]
        public int ProductId { get; set; }
        [Required]
        [MaxLength(20)]
        public string UnitType { get; set; } = string.Empty;
        [Required]
        [Range(0.0001, 999999.99, ErrorMessage = "Qty must be greater than 0")]
        public decimal Qty { get; set; }
        [Required]
        [Range(0, 99999999.99, ErrorMessage = "UnitCost must be non-negative")]
        public decimal UnitCost { get; set; } // Default: cost INCLUDING VAT (unless IncludesVat=false in parent)
    }

    // Customer DTOs
    public class CustomerDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? Trn { get; set; }
        public string? Address { get; set; }
        public decimal CreditLimit { get; set; }
        public string? PaymentTerms { get; set; }
        public decimal Balance { get; set; }
        
        /// <summary>
        /// Customer type: "Credit" or "Cash"
        /// Credit customers can have outstanding balance, Cash customers must pay immediately
        /// </summary>
        public string CustomerType { get; set; } = "Credit";
        
        // Real-time balance tracking fields
        public decimal TotalSales { get; set; }
        public decimal TotalPayments { get; set; }
        public decimal PendingBalance { get; set; }
        public DateTime? LastPaymentDate { get; set; }
        public DateTime? LastActivity { get; set; }
        public int? BranchId { get; set; }
        public int? RouteId { get; set; }
    }

    public class CreateCustomerRequest
    {
        [Required]
        [MaxLength(200)]
        public string Name { get; set; } = string.Empty;
        [MaxLength(20)]
        public string? Phone { get; set; }
        [EmailAddress]
        [MaxLength(100)]
        public string? Email { get; set; }
        [MaxLength(50)]
        public string? Trn { get; set; }
        [MaxLength(500)]
        public string? Address { get; set; }
        [Range(0, 99999999.99, ErrorMessage = "CreditLimit must be non-negative")]
        public decimal CreditLimit { get; set; }
        [MaxLength(100)]
        public string? PaymentTerms { get; set; }
        
        /// <summary>
        /// Customer type: "Credit" or "Cash"
        /// Credit customers can have outstanding balance, Cash customers must pay immediately
        /// Default is "Credit"
        /// </summary>
        [MaxLength(20)]
        public string CustomerType { get; set; } = "Credit";
        public int? BranchId { get; set; }
        public int? RouteId { get; set; }
    }

    public class CustomerLedgerEntry
    {
        public DateTime Date { get; set; }
        public string Type { get; set; } = string.Empty;
        public string Reference { get; set; } = string.Empty;
        public string? PaymentMode { get; set; } // Cash, Cheque, Online, etc.
        public string? Remarks { get; set; } // Payment reference, notes, etc.
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public decimal Balance { get; set; }
        public int? SaleId { get; set; } // For linking to invoices
        public int? PaymentId { get; set; } // For linking to payments
        public int? ReturnId { get; set; } // For linking to returns (delete action)
        public string? Status { get; set; } // Paid, Partial, Unpaid; for returns: Refunded, Credit Issued, Pending Refund
        public decimal PaidAmount { get; set; } // Amount paid for invoice
    }

    // Expense DTOs
    public class ExpenseDto
    {
        public int Id { get; set; }
        public int? BranchId { get; set; }
        public string? BranchName { get; set; }
        public int? RouteId { get; set; }
        public string? RouteName { get; set; }
        public int CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public string CategoryColor { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public DateTime Date { get; set; }
        public string? Note { get; set; }
        public string? AttachmentUrl { get; set; }
        public string? Status { get; set; }
        public int? RecurringExpenseId { get; set; }
        public int? ApprovedBy { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public string? RejectionReason { get; set; }
        public string? CreatedByName { get; set; }
        public decimal? VatAmount { get; set; }
        public decimal? TotalAmount { get; set; }
        public string? TaxType { get; set; }
        public bool IsTaxClaimable { get; set; }
        public bool IsEntertainment { get; set; }
        public decimal PartialCreditPct { get; set; }
        public decimal? ClaimableVat { get; set; }
        public decimal? VatRate { get; set; }
    }

    public class ExpenseCategoryDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string ColorCode { get; set; } = string.Empty;
        public decimal DefaultVatRate { get; set; }
        public string DefaultTaxType { get; set; } = "Standard";
        public bool DefaultIsTaxClaimable { get; set; }
        public bool DefaultIsEntertainment { get; set; }
        public bool VatDefaultLocked { get; set; }
    }

    public class CreateExpenseRequest
    {
        public int? BranchId { get; set; }
        public int? RouteId { get; set; }
        [Required]
        public int CategoryId { get; set; }
        [Required]
        public decimal Amount { get; set; }
        [Required]
        public DateTime Date { get; set; }
        public string? Note { get; set; }
        public string? AttachmentUrl { get; set; }
        public int? RecurringExpenseId { get; set; }
        public bool WithVat { get; set; }
        [MaxLength(32)]
        public string? TaxType { get; set; }
        public bool IsTaxClaimable { get; set; } = true;
        public bool IsEntertainment { get; set; }
        [Range(0, 100)]
        public decimal PartialCreditPct { get; set; } = 100;
    }

    public class ApproveExpenseRequest
    {
        public bool Approved { get; set; }
        public string? RejectionReason { get; set; }
    }

    public class BulkVatUpdateRequest
    {
        public List<int>? ExpenseIds { get; set; }
        public int? CategoryId { get; set; }
        public bool AllNoVat { get; set; }
        public string Interpretation { get; set; } = "add-on-top"; // add-on-top | extract-from-amount
        public decimal VatRate { get; set; } = 0.05m;
        public bool IsTaxClaimable { get; set; } = true;
        public string TaxType { get; set; } = "Standard";
        public bool IsEntertainment { get; set; }
    }

    public class BulkVatUpdateResult
    {
        public int Updated { get; set; }
        public int Skipped { get; set; }
        public List<string> Errors { get; set; } = new();
    }

    public class BulkSetClaimableRequest
    {
        public List<int> ExpenseIds { get; set; } = new();
        public bool IsTaxClaimable { get; set; }
    }

    public class RecurringExpenseDto
    {
        public int Id { get; set; }
        public string Description { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string Frequency { get; set; } = "Monthly";
        public int? CategoryId { get; set; }
        public int? BranchId { get; set; }
        public string? BranchName { get; set; }
        public string? CategoryName { get; set; }
        public string? Note { get; set; }
        public int? DayOfRecurrence { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime? CreatedAt { get; set; }
    }

    public class CreateRecurringExpenseRequest
    {
        public string Description { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string Frequency { get; set; } = "Monthly";
        public int? CategoryId { get; set; }
        public int? BranchId { get; set; }
        public string? Note { get; set; }
        public int? DayOfRecurrence { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
    }

    // Report DTOs
    public class DashboardBranchSummaryDto
    {
        public int BranchId { get; set; }
        public string BranchName { get; set; } = string.Empty;
        public decimal Sales { get; set; }
        public decimal Expenses { get; set; }
        public decimal Profit { get; set; }
        public int InvoiceCount { get; set; }
        public decimal UnpaidAmount { get; set; }
        public decimal PaidAmount { get; set; }
    }

    public class DailySalesDto
    {
        public string Date { get; set; } = string.Empty;
        public decimal Sales { get; set; }
        public int InvoiceCount { get; set; }
    }

    public class TopCustomerDto
    {
        public int CustomerId { get; set; }
        public string CustomerName { get; set; } = string.Empty;
        public decimal TotalSales { get; set; }
        public int InvoiceCount { get; set; }
    }

    public class TopProductDto
    {
        public int ProductId { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public decimal TotalSales { get; set; }
        public decimal TotalQty { get; set; }
        public string UnitType { get; set; } = string.Empty;
    }

    public class SummaryReportDto
    {
        public decimal SalesToday { get; set; }
        public decimal ReturnsToday { get; set; }
        public decimal NetSalesToday { get; set; }
        public int ReturnsCountToday { get; set; }
        /// <summary>Sum of return line amounts where condition is damaged or write-off (ERP damage loss).</summary>
        public decimal DamageLossToday { get; set; }
        public decimal PurchasesToday { get; set; }
        public decimal ExpensesToday { get; set; }
        public decimal CogsToday { get; set; }
        public decimal? ProfitToday { get; set; }
        public List<ProductDto> LowStockProducts { get; set; } = new();
        public List<SaleDto> PendingInvoices { get; set; } = new();
        public int PendingBills { get; set; }
        public decimal PendingBillsAmount { get; set; }
        public int PaidBills { get; set; }
        public decimal PaidBillsAmount { get; set; }
        public int InvoicesToday { get; set; }
        public int InvoicesWeekly { get; set; }
        public int InvoicesMonthly { get; set; }
        public List<DashboardBranchSummaryDto> BranchBreakdown { get; set; } = new();
        public List<DailySalesDto> DailySalesTrend { get; set; } = new();
        public List<TopCustomerDto> TopCustomersToday { get; set; } = new();
        public List<TopProductDto> TopProductsToday { get; set; } = new();
    }

    /// <summary>Owner-only worksheet summary: totals for a period plus customer payments received and pending receivables.</summary>
    public class WorksheetReportDto
    {
        public decimal TotalSales { get; set; }
        public decimal TotalPurchases { get; set; }
        public decimal TotalExpenses { get; set; }
        /// <summary>Customer payments received in the selected date range (excludes refunds).</summary>
        public decimal TotalReceived { get; set; }
        /// <summary>Outstanding receivables (pending bills amount).</summary>
        public decimal PendingAmount { get; set; }
    }

    public class AISuggestionsDto
    {
        public List<ProductDto> TopSellers { get; set; } = new();
        public List<ProductDto> RestockCandidates { get; set; } = new();
        public List<ProductDto> LowMarginProducts { get; set; } = new();
        public List<CustomerDto> PendingCustomers { get; set; } = new();
        public List<ProductDto> PromotionCandidates { get; set; } = new();
    }

    public class StaffPerformanceDto
    {
        public int UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string AssignedRoutes { get; set; } = string.Empty;
        public int InvoicesCreated { get; set; }
        public decimal TotalBilled { get; set; }
        public decimal CashCollected { get; set; }
        public decimal CollectionRatePercent { get; set; }
        public double AvgDaysToPay { get; set; }
    }

    public class PendingBillDto
    {
        public int Id { get; set; }
        public string InvoiceNo { get; set; } = string.Empty;
        public DateTime InvoiceDate { get; set; }
        public DateTime? DueDate { get; set; }
        public int? CustomerId { get; set; }
        public string? CustomerName { get; set; }
        public decimal GrandTotal { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal BalanceAmount { get; set; }
        public string PaymentStatus { get; set; } = string.Empty;
        public int DaysOverdue { get; set; }
    }

    public class ExpenseAggregateDto
    {
        public string Period { get; set; } = string.Empty; // e.g., "January 2025", "Week 5, 2025", "2025"
        public DateTime PeriodStart { get; set; }
        public DateTime PeriodEnd { get; set; }
        public decimal TotalAmount { get; set; }
        public int Count { get; set; }
        public List<ExpenseCategoryTotalDto> ByCategory { get; set; } = new();
    }

    public class ExpenseCategoryTotalDto
    {
        public string CategoryName { get; set; } = string.Empty;
        public decimal TotalAmount { get; set; }
        public int Count { get; set; }
    }

    public class ExpenseByCategoryDto
    {
        public int CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public string CategoryColor { get; set; } = string.Empty;
        public decimal TotalAmount { get; set; }
        public int ExpenseCount { get; set; }
    }

    public class SalesVsExpensesDto
    {
        public string Period { get; set; } = string.Empty; // "2024-01-15" or "2024-01"
        public DateTime Date { get; set; }
        public decimal Sales { get; set; }
        public decimal Purchases { get; set; }
        public decimal Expenses { get; set; }
        public decimal? Profit { get; set; }
    }

    // Branch + Route DTOs
    public class BranchDto
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Address { get; set; }
        public DateTime CreatedAt { get; set; }
        public int RouteCount { get; set; }
        public List<int> AssignedStaffIds { get; set; } = new();
    }

    public class RouteDto
    {
        public int Id { get; set; }
        public int BranchId { get; set; }
        public string BranchName { get; set; } = string.Empty;
        public int TenantId { get; set; }
        public string Name { get; set; } = string.Empty;
        public int? AssignedStaffId { get; set; }
        public string? AssignedStaffName { get; set; }
        public DateTime CreatedAt { get; set; }
        public int CustomerCount { get; set; }
        public int StaffCount { get; set; }
        public List<int> AssignedStaffIds { get; set; } = new();
    }

    public class RouteDetailDto : RouteDto
    {
        public List<RouteCustomerDto> Customers { get; set; } = new();
        public List<RouteStaffDto> Staff { get; set; } = new();
        public decimal TotalSales { get; set; }
        public decimal TotalExpenses { get; set; }
        public decimal Profit { get; set; }
    }

    public class RouteCustomerDto
    {
        public int Id { get; set; }
        public int CustomerId { get; set; }
        public string CustomerName { get; set; } = string.Empty;
        public DateTime AssignedAt { get; set; }
    }

    public class RouteStaffDto
    {
        public int Id { get; set; }
        public int UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public DateTime AssignedAt { get; set; }
    }

    /// <summary>Collection sheet entry for daily route collection - printable for drivers.</summary>
    public class RouteCollectionSheetEntryDto
    {
        public int CustomerId { get; set; }
        public string CustomerName { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public decimal OutstandingBalance { get; set; }
        public decimal? TodayInvoiceAmount { get; set; }
        public string? Remarks { get; set; }
        public string? VisitStatus { get; set; }
        public string? VisitNotes { get; set; }
        public decimal? PaymentCollected { get; set; }
    }

    public class RouteCollectionSheetDto
    {
        public string RouteName { get; set; } = string.Empty;
        public string BranchName { get; set; } = string.Empty;
        public string Date { get; set; } = string.Empty;
        public string? StaffName { get; set; }
        public List<RouteCollectionSheetEntryDto> Customers { get; set; } = new();
        public decimal TotalOutstanding { get; set; }
    }

    public class RouteExpenseDto
    {
        public int Id { get; set; }
        public int RouteId { get; set; }
        public string Category { get; set; } = string.Empty; // Fuel, Staff, Delivery, Misc
        public decimal Amount { get; set; }
        public DateTime ExpenseDate { get; set; }
        public string? Description { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class CreateBranchRequest
    {
        [Required]
        [MaxLength(200)]
        public string Name { get; set; } = string.Empty;
        [MaxLength(500)]
        public string? Address { get; set; }
        public List<int>? AssignedStaffIds { get; set; }
    }

    public class CreateRouteRequest
    {
        [Required]
        public int BranchId { get; set; }
        [Required]
        [MaxLength(200)]
        public string Name { get; set; } = string.Empty;
        public int? AssignedStaffId { get; set; }
        public List<int>? AssignedStaffIds { get; set; }
    }

    public class CreateRouteExpenseRequest
    {
        public int RouteId { get; set; }
        public string Category { get; set; } = "Misc"; // Fuel, Staff, Delivery, Misc
        public decimal Amount { get; set; }
        public DateTime ExpenseDate { get; set; }
        [MaxLength(500)]
        public string? Description { get; set; }
    }

    public class CustomerVisitDto
    {
        public int Id { get; set; }
        public int RouteId { get; set; }
        public int CustomerId { get; set; }
        public string CustomerName { get; set; } = string.Empty;
        public DateTime VisitDate { get; set; }
        public string Status { get; set; } = "NotVisited";
        public string? Notes { get; set; }
        public decimal? PaymentCollected { get; set; }
        public decimal? AmountCollected { get => PaymentCollected; set => PaymentCollected = value; }
        public int? StaffId { get; set; }
        public string? StaffName { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class UpdateCustomerVisitRequest
    {
        public DateTime VisitDate { get; set; }
        public string Status { get; set; } = "NotVisited";
        public string? Notes { get; set; }
        public decimal? PaymentCollected { get; set; }
    }

    public class UpdateVisitStatusRequest
    {
        public int CustomerId { get; set; }
        public DateTime VisitDate { get; set; }
        public string Status { get; set; } = "NotVisited";
        public string? Notes { get; set; }
        public decimal? PaymentCollected { get; set; }
        public decimal? AmountCollected { get => PaymentCollected; set => PaymentCollected = value; }
    }

    public class RouteSummaryDto
    {
        public int RouteId { get; set; }
        public string RouteName { get; set; } = string.Empty;
        public string BranchName { get; set; } = string.Empty;
        public decimal TotalSales { get; set; }
        public decimal TotalReturns { get; set; }
        public decimal NetSales { get; set; }
        public decimal TotalExpenses { get; set; }
        public decimal CostOfGoodsSold { get; set; }
        public decimal Profit { get; set; }
        /// <summary>Number of invoices (sales) in the date range. Used by Route Performance tab.</summary>
        public int InvoiceCount { get; set; }
        /// <summary>Number of customer visits recorded in the date range. Used by Route Performance tab.</summary>
        public int VisitCount { get; set; }
        /// <summary>Total payments received for this route's sales in the period.</summary>
        public decimal TotalPayments { get; set; }
        /// <summary>Unpaid amount (sales minus payments) for this route in the period.</summary>
        public decimal UnpaidAmount { get; set; }
    }

    public class BranchSummaryDto
    {
        public int BranchId { get; set; }
        public string BranchName { get; set; } = string.Empty;
        public decimal TotalSales { get; set; }
        public decimal TotalReturns { get; set; }
        public decimal NetSales { get; set; }
        public decimal TotalExpenses { get; set; }
        public decimal CostOfGoodsSold { get; set; }
        public decimal Profit { get; set; }
        public List<RouteSummaryDto> Routes { get; set; } = new();
        public decimal? GrowthPercent { get; set; }
        public decimal? CollectionsRatio { get; set; }
        public decimal AverageInvoiceSize { get; set; }
        public int InvoiceCount { get; set; }
        public decimal TotalPayments { get; set; }
        /// <summary>Unpaid/pending amount (TotalSales - TotalPayments) in the period.</summary>
        public decimal UnpaidAmount { get; set; }
    }

    public class BranchComparisonItemDto : BranchSummaryDto
    {
        public new decimal? GrowthPercent { get; set; }
    }

    // Common DTOs
    public class ApiResponse<T>
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public T? Data { get; set; }
        public List<string>? Errors { get; set; }
    }

    // Invoice Template DTOs
    public class InvoiceTemplateDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Version { get; set; } = "1.0";
        public int CreatedBy { get; set; }
        public string CreatedByName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public bool IsActive { get; set; }
        public string? Description { get; set; }
        public string? HtmlCode { get; set; } // Only included when fetching single template
        public string? CssCode { get; set; } // Only included when fetching single template
    }

    public class CreateInvoiceTemplateRequest
    {
        [Required]
        [MaxLength(200)]
        public string Name { get; set; } = string.Empty;
        [MaxLength(50)]
        public string? Version { get; set; }
        [Required]
        public string HtmlCode { get; set; } = string.Empty;
        public string? CssCode { get; set; }
        public bool IsActive { get; set; } = false;
        [MaxLength(1000)]
        public string? Description { get; set; }
    }

    public class UpdateInvoiceTemplateRequest
    {
        [MaxLength(200)]
        public string? Name { get; set; }
        [MaxLength(50)]
        public string? Version { get; set; }
        public string? HtmlCode { get; set; }
        public string? CssCode { get; set; }
        public bool? IsActive { get; set; }
        [MaxLength(1000)]
        public string? Description { get; set; }
    }

    public class PagedResponse<T>
    {
        public List<T> Items { get; set; } = new();
        public int TotalCount { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public int TotalPages { get; set; }
    }

    // Return DTOs
    /// <summary>Disposition at create: RefundNow = pay back now (creates refund payment); CreditIssued = keep as credit; AdjustNextInvoice = pending adjustment.</summary>
    public static class ReturnType
    {
        public const string RefundNow = "RefundNow";
        public const string CreditIssued = "CreditIssued";
        public const string AdjustNextInvoice = "AdjustNextInvoice";
    }

    public class CreateSaleReturnRequest
    {
        [Required]
        public int SaleId { get; set; }
        [Required]
        public List<SaleReturnItemRequest> Items { get; set; } = new();
        public string? Reason { get; set; }
        public bool RestoreStock { get; set; } = true;
        public bool IsBadItem { get; set; } = false;
        public decimal? Discount { get; set; }
        /// <summary>When true and invoice is paid, create a credit note linked to this return (for refund/future adjustment). Backward compat: if ReturnType not set, true => CreditIssued, false => PendingRefund.</summary>
        public bool CreateCreditNote { get; set; }
        /// <summary>RefundNow = refund now (creates refund payment, RefundStatus Refunded); CreditIssued = keep as credit; AdjustNextInvoice = pending. If not set, derived from CreateCreditNote.</summary>
        [MaxLength(20)]
        public string? ReturnType { get; set; }
    }

    public class SaleReturnItemRequest
    {
        [Required]
        public int SaleItemId { get; set; }
        [Required]
        public decimal Qty { get; set; }
        public string? Reason { get; set; }
        public int? DamageCategoryId { get; set; }
        /// <summary>True = add back to sellable stock; false = do not add (damaged). If null, derived from Condition or DamageCategory or header.</summary>
        public bool? StockEffect { get; set; }
        /// <summary>Condition per line: resellable, damaged, writeoff. Maps to StockEffect when provided.</summary>
        [MaxLength(20)]
        public string? Condition { get; set; }
    }

    public class SaleReturnDto
    {
        public int Id { get; set; }
        public int SaleId { get; set; }
        public string SaleInvoiceNo { get; set; } = string.Empty;
        public int? CustomerId { get; set; }
        public string? CustomerName { get; set; }
        public string ReturnNo { get; set; } = string.Empty;
        public DateTime ReturnDate { get; set; }
        public decimal GrandTotal { get; set; }
        public string? Reason { get; set; }
        public string Status { get; set; } = string.Empty;
        public bool IsBadItem { get; set; }
        public int? BranchId { get; set; }
        public string? BranchName { get; set; }
        public int? RouteId { get; set; }
        public string? RouteName { get; set; }
        public string? ReturnType { get; set; }
        public string? ReturnCategory { get; set; }
        public int CreatedBy { get; set; }
        public string? CreatedByName { get; set; }
        public List<SaleReturnItemDto>? Items { get; set; }
    }

    public class SaleReturnItemDto
    {
        public int Id { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public decimal QtyReturned { get; set; }
        public string? Reason { get; set; }
        public string? DamageCategoryName { get; set; }
        public string? Condition { get; set; }
        /// <summary>Line total (incl. VAT). For PDF display only; use UnitPrice + VatAmount for FTA-compliant breakdown.</summary>
        public decimal Amount { get; set; }
        /// <summary>Unit price excl. VAT (FTA-compliant return note).</summary>
        public decimal UnitPrice { get; set; }
        /// <summary>VAT amount for this line (FTA-compliant return note).</summary>
        public decimal VatAmount { get; set; }
    }

    public class DamageCategoryDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public bool AffectsStock { get; set; }
        public bool IsResaleable { get; set; }
        public int SortOrder { get; set; }
    }

    public class CreditNoteDto
    {
        public int Id { get; set; }
        public int CustomerId { get; set; }
        public string? CustomerName { get; set; }
        public int LinkedReturnId { get; set; }
        public string? LinkedReturnNo { get; set; }
        public decimal Amount { get; set; }
        public decimal AppliedAmount { get; set; }
        public string Currency { get; set; } = "AED";
        public string Status { get; set; } = "unused";
        public DateTime CreatedAt { get; set; }
        public string? CreatedByName { get; set; }
    }

    /// <summary>One line in the Damage Report: return line where condition is damaged or write-off.</summary>
    public class DamageReportEntryDto
    {
        public int ReturnId { get; set; }
        public string ReturnNo { get; set; } = string.Empty;
        public DateTime ReturnDate { get; set; }
        public string? InvoiceNo { get; set; }
        public string? CustomerName { get; set; }
        public string? ProductName { get; set; }
        public decimal Qty { get; set; }
        public string Condition { get; set; } = string.Empty; // damaged | writeoff
        public decimal LineTotal { get; set; }
        public string? BranchName { get; set; }
        public string? RouteName { get; set; }
    }

    public class CreatePurchaseReturnRequest
    {
        [Required]
        public int PurchaseId { get; set; }
        [Required]
        public List<PurchaseReturnItemRequest> Items { get; set; } = new();
        public string? Reason { get; set; }
    }

    public class PurchaseReturnItemRequest
    {
        [Required]
        public int PurchaseItemId { get; set; }
        [Required]
        public decimal Qty { get; set; }
        public string? Reason { get; set; }
    }

    public class PurchaseReturnDto
    {
        public int Id { get; set; }
        public int PurchaseId { get; set; }
        public string PurchaseInvoiceNo { get; set; } = string.Empty;
        public string ReturnNo { get; set; } = string.Empty;
        public DateTime ReturnDate { get; set; }
        public decimal GrandTotal { get; set; }
        public string? Reason { get; set; }
        public string Status { get; set; } = string.Empty;
    }

    // Profit DTOs
    public class ProfitReportDto
    {
        public DateTime FromDate { get; set; }
        public DateTime ToDate { get; set; }
        public decimal TotalSales { get; set; }
        public decimal TotalSalesVat { get; set; }
        public decimal TotalSalesWithVat { get; set; }
        public decimal CostOfGoodsSold { get; set; }
        public decimal GrossProfit { get; set; }
        public decimal GrossProfitMargin { get; set; }
        public decimal TotalExpenses { get; set; }
        public decimal NetProfit { get; set; }
        public decimal NetProfitMargin { get; set; }
        public decimal TotalPurchases { get; set; }
        public List<DailyProfitDto> DailyProfit { get; set; } = new(); // CRITICAL: Daily profit breakdown
    }

    public class ProductProfitDto
    {
        public int ProductId { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public decimal QuantitySold { get; set; }
        public decimal TotalSales { get; set; }
        public decimal TotalCost { get; set; }
        public decimal Profit { get; set; }
        public decimal ProfitMargin { get; set; }
    }

    public class DailyProfitDto
    {
        public DateTime Date { get; set; }
        public decimal Sales { get; set; }
        public decimal Expenses { get; set; }
        public decimal Profit { get; set; }
    }

    /// <summary>Branch-wise profit breakdown (PRODUCTION_MASTER_TODO #57). Same formula: Net = Sales - COGS - Expenses.</summary>
    public class BranchProfitDto
    {
        public int BranchId { get; set; }
        public string BranchName { get; set; } = string.Empty;
        public decimal Sales { get; set; }
        public decimal CostOfGoodsSold { get; set; }
        public decimal GrossProfit { get; set; }
        public decimal Expenses { get; set; }
        public decimal NetProfit { get; set; }
        public decimal GrossProfitMarginPercent { get; set; }
        public decimal NetProfitMarginPercent { get; set; }
        public int InvoiceCount { get; set; }
    }

    // Outstanding Invoice DTO
    public class OutstandingInvoiceDto
    {
        public int Id { get; set; }
        public string InvoiceNo { get; set; } = string.Empty;
        public DateTime InvoiceDate { get; set; }
        public decimal GrandTotal { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal BalanceAmount { get; set; }
        public string PaymentStatus { get; set; } = string.Empty;
        public int DaysOverdue { get; set; }
    }

    // Delete Customer Summary DTO
    public class DeleteCustomerSummary
    {
        public string CustomerName { get; set; } = string.Empty;
        public int SalesDeleted { get; set; }
        public int PaymentsDeleted { get; set; }
        public int SaleReturnsDeleted { get; set; }
        public bool StockRestored { get; set; }
    }

    // Backup DTOs
    public class PreviewImportRequest
    {
        public string? FileName { get; set; }
        public string? UploadedFilePath { get; set; }
    }

    public class ImportWithResolutionRequest
    {
        public string? FileName { get; set; }
        public string? UploadedFilePath { get; set; }
        public Dictionary<int, string>? ConflictResolutions { get; set; } // conflictId -> resolution ("merge", "skip", "overwrite", "create_new")
    }

    public class RestoreBackupRequestDto
    {
        public string FileName { get; set; } = string.Empty;
        public string? UploadedFilePath { get; set; }
    }

    // Enhanced Sales Report DTOs
    public class EnhancedSalesReportDto
    {
        public SummaryInfo Summary { get; set; } = new();
        public List<SalesSeriesDto> Series { get; set; } = new();
        public PagedResponse<SalesReportItemDto> Data { get; set; } = new();
    }

    public class SummaryInfo
    {
        public decimal TotalSales { get; set; }
        public decimal NetSales { get; set; }
        public decimal VatCollected { get; set; }
        public decimal AvgOrderValue { get; set; }
        public int TotalInvoices { get; set; }
    }

    public class SalesSeriesDto
    {
        public string Period { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public decimal Amount { get; set; }
        public int Count { get; set; }
    }

    public class SalesReportItemDto
    {
        public int InvoiceId { get; set; }
        public DateTime Date { get; set; }
        public string InvoiceNo { get; set; } = string.Empty;
        public int? CustomerId { get; set; }
        public string? CustomerName { get; set; }
        public List<ProductSummaryDto> Items { get; set; } = new();
        public decimal Qty { get; set; }
        public decimal Gross { get; set; }
        public decimal Vat { get; set; }
        public decimal Discount { get; set; }
        public decimal Net { get; set; }
        public string PaymentStatus { get; set; } = string.Empty;
    }

    public class ProductSummaryDto
    {
        public int ProductId { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public decimal Qty { get; set; }
        public decimal Price { get; set; }
    }

    // Aging Report DTOs
    public class AgingReportDto
    {
        public AgingBucket Bucket0_30 { get; set; } = new();
        public AgingBucket Bucket31_60 { get; set; } = new();
        public AgingBucket Bucket61_90 { get; set; } = new();
        public AgingBucket Bucket90Plus { get; set; } = new();
        public decimal TotalOutstanding { get; set; }
        public List<AgingInvoiceDto> Invoices { get; set; } = new();
    }

    public class AgingBucket
    {
        public decimal Total { get; set; }
        public int Count { get; set; }
        public List<AgingInvoiceDto> Invoices { get; set; } = new();
    }

    public class AgingInvoiceDto
    {
        public int Id { get; set; }
        public string InvoiceNo { get; set; } = string.Empty;
        public DateTime InvoiceDate { get; set; }
        public int? CustomerId { get; set; }
        public string? CustomerName { get; set; }
        public decimal GrandTotal { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal BalanceAmount { get; set; }
        public int DaysOverdue { get; set; }
        public string AgingBucket { get; set; } = string.Empty;
    }

    // AP (Accounts Payable) Aging Report DTOs
    public class ApAgingReportDto
    {
        public ApAgingBucket Bucket0_30 { get; set; } = new();
        public ApAgingBucket Bucket31_60 { get; set; } = new();
        public ApAgingBucket Bucket61_90 { get; set; } = new();
        public ApAgingBucket Bucket90Plus { get; set; } = new();
        public decimal TotalOutstanding { get; set; }
        public List<ApAgingItemDto> Items { get; set; } = new();
    }

    public class ApAgingBucket
    {
        public decimal Total { get; set; }
        public int Count { get; set; }
        public List<ApAgingItemDto> Items { get; set; } = new();
    }

    public class ApAgingItemDto
    {
        public string SupplierName { get; set; } = string.Empty;
        public decimal Balance { get; set; }
        public int DaysOverdue { get; set; }
        public string AgingBucket { get; set; } = string.Empty;
        public DateTime? OldestPurchaseDate { get; set; }
    }

    // Stock Report DTOs
    public class StockReportDto
    {
        public StockSummary Summary { get; set; } = new();
        public List<StockItemDto> Items { get; set; } = new();
    }

    public class StockSummary
    {
        public int TotalSKUs { get; set; }
        public int LowStockCount { get; set; }
        public int OutOfStockCount { get; set; }
        public decimal StockValue { get; set; }
    }

    public class StockItemDto
    {
        public int ProductId { get; set; }
        public string ProductName { get; set; } = string.Empty;
        public string Sku { get; set; } = string.Empty;
        public string UnitType { get; set; } = string.Empty;
        public decimal OnHand { get; set; }
        public decimal Reserved { get; set; }
        public decimal Available { get; set; }
        public decimal ReorderLevel { get; set; }
        public decimal SafetyStock { get; set; }
        public DateTime? LastPurchaseDate { get; set; }
        public bool IsLowStock { get; set; }
        public int? PredictedDaysToStockOut { get; set; }
    }

    // Customer Report DTOs
    public class CustomerReportDto
    {
        public List<CustomerReportItemDto> Customers { get; set; } = new();
        public CustomerReportSummary Summary { get; set; } = new();
    }

    public class CustomerReportItemDto
    {
        public int CustomerId { get; set; }
        public string CustomerName { get; set; } = string.Empty;
        public string? Trn { get; set; }
        public decimal TotalSales { get; set; }
        public decimal TotalPayments { get; set; }
        public decimal Outstanding { get; set; }
        public decimal AvgDaysToPay { get; set; }
        public DateTime? LastPaymentDate { get; set; }
        public string? LastPaymentMode { get; set; }
    }

    public class CustomerReportSummary
    {
        public int TotalCustomers { get; set; }
        public decimal TotalSales { get; set; }
        public decimal TotalPayments { get; set; }
        public decimal TotalOutstanding { get; set; }
        public decimal AvgDaysToPay { get; set; }
    }

    // Comprehensive Sales Ledger DTOs
    public class SalesLedgerEntryDto
    {
        public DateTime Date { get; set; }
        public string Type { get; set; } = string.Empty; // "Sale", "Payment", or "Return"
        public string InvoiceNo { get; set; } = string.Empty;
        public int? CustomerId { get; set; }
        public string? CustomerName { get; set; }
        public string? PaymentMode { get; set; } // "CASH", "ONLINE", "NOT PAID", etc.
        public decimal GrandTotal { get; set; } // CRITICAL: Full invoice amount (for sales) or payment amount (for payments)
        public decimal PaidAmount { get; set; } // CRITICAL: Amount paid for this invoice (for sales) or 0 (for payments)
        public decimal RealPending { get; set; } // Real pending amount (for sales: GrandTotal - PaidAmount, for payments: 0)
        public decimal RealGotPayment { get; set; } // Real payment received (for payments: Amount, for sales: PaidAmount from invoice)
        public string Status { get; set; } = string.Empty; // "Paid", "Unpaid", "Pending", "Partial"
        public decimal CustomerBalance { get; set; } // Per-customer running balance
        public DateTime? PlanDate { get; set; } // Due date (Invoice Date + 30 days)
        public int? SaleId { get; set; }
        public int? PaymentId { get; set; }
        public int? ReturnId { get; set; }
        /// <summary>VAT amount (for Sale/Return; 0 for Payment). Gulf VAT reporting.</summary>
        public decimal VatTotal { get; set; }
        /// <summary>Net amount before VAT (for Sale/Return; 0 for Payment).</summary>
        public decimal Subtotal { get; set; }
    }

    public class SalesLedgerReportDto
    {
        public List<SalesLedgerEntryDto> Entries { get; set; } = new();
        public SalesLedgerSummary Summary { get; set; } = new();
    }

    public class SalesLedgerSummary
    {
        public decimal TotalDebit { get; set; }
        public decimal TotalCredit { get; set; }
        public decimal OutstandingBalance { get; set; }
        public decimal TotalSales { get; set; }
        public decimal TotalPayments { get; set; }
        public decimal TotalReturns { get; set; }
        public decimal NetSales { get; set; }
        public decimal RefundsPaid { get; set; }
        public decimal NetCashIn { get; set; }
        /// <summary>Total VAT from sales (output VAT). Gulf VAT reporting.</summary>
        public decimal TotalSalesVat { get; set; }
        /// <summary>Total VAT from returns (reduces output VAT).</summary>
        public decimal TotalReturnsVat { get; set; }
        /// <summary>Net output VAT (sales VAT minus returns VAT).</summary>
        public decimal TotalVat { get; set; }
    }

    /// <summary>FTA VAT 201 Return - UAE quarterly VAT filing format.</summary>
    public class VatReturnDto
    {
        public int Quarter { get; set; }
        public int Year { get; set; }
        public DateTime FromDate { get; set; }
        public DateTime ToDate { get; set; }
        /// <summary>Box 1: Value of standard-rated supplies (taxable).</summary>
        public decimal Box1_TaxableSupplies { get; set; }
        /// <summary>Box 2: Value of zero-rated supplies.</summary>
        public decimal Box2_ZeroRatedSupplies { get; set; }
        /// <summary>Box 3: Value of exempt supplies.</summary>
        public decimal Box3_ExemptSupplies { get; set; }
        /// <summary>Box 4: Tax amount on standard-rated supplies (output VAT).</summary>
        public decimal Box4_TaxOnTaxableSupplies { get; set; }
        /// <summary>Box 5: Value of supplies subject to reverse charge.</summary>
        public decimal Box5_ReverseCharge { get; set; }
        /// <summary>Box 6: Total value of supplies due to authority (Box 4 + Box 5).</summary>
        public decimal Box6_TotalDue { get; set; }
        /// <summary>Box 7: Tax on goods/services not entitled to credit.</summary>
        public decimal Box7_TaxNotCreditable { get; set; }
        /// <summary>Box 8: Total recoverable tax (input VAT).</summary>
        public decimal Box8_RecoverableTax { get; set; }
        /// <summary>Box 9: Net VAT due to authority (Box 6 - Box 8).</summary>
        public decimal Box9_NetVatDue { get; set; }
    }

    /// <summary>FTA Form 201 VAT return with boxes 1a–13b and detail lines.</summary>
    public class VatReturn201Dto
    {
        public string PeriodLabel { get; set; } = string.Empty;
        public DateTime PeriodStart { get; set; }
        public DateTime PeriodEnd { get; set; }
        public DateTime DueDate { get; set; }
        public string Status { get; set; } = "Draft";
        public DateTime? CalculatedAt { get; set; }
        public int? PeriodId { get; set; }
        public decimal Box1a { get; set; }
        public decimal Box1b { get; set; }
        public decimal Box2 { get; set; }
        public decimal Box3 { get; set; }
        public decimal Box4 { get; set; }
        public decimal Box9b { get; set; }
        public decimal Box10 { get; set; }
        public decimal Box11 { get; set; }
        public decimal Box12 { get; set; }
        public decimal Box13a { get; set; }
        public decimal Box13b { get; set; }
        public decimal PetroleumExcluded { get; set; }
        public int TransactionCount { get; set; }
        public List<VatReturnOutputLineDto> OutputLines { get; set; } = new();
        public List<VatReturnInputLineDto> InputLines { get; set; } = new();
        public List<VatReturnCreditNoteLineDto> CreditNoteLines { get; set; } = new();
        public List<VatReturnReverseChargeLineDto> ReverseChargeLines { get; set; } = new();
        public List<ValidationIssueDto> ValidationIssues { get; set; } = new();
    }

    public class VatReturnOutputLineDto
    {
        public string Type { get; set; } = "Sale"; // Sale | CreditNote
        public string Reference { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public decimal NetAmount { get; set; }
        public decimal VatAmount { get; set; }
        public string? VatScenario { get; set; }
        public string CustomerName { get; set; } = string.Empty;
        public int? SaleId { get; set; }
    }

    public class VatReturnInputLineDto
    {
        public string Type { get; set; } = "Purchase"; // Purchase | Expense
        public string Reference { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public decimal NetAmount { get; set; }
        public decimal VatAmount { get; set; }
        public decimal ClaimableVat { get; set; }
        public string? TaxType { get; set; }
        public string SupplierName { get; set; } = string.Empty;
        public string CategoryName { get; set; } = string.Empty;
        public int? SourceId { get; set; }
        public bool IsEntertainment { get; set; }
        public bool IsTaxClaimable { get; set; }
    }

    public class VatReturnCreditNoteLineDto
    {
        public string Reference { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public decimal NetAmount { get; set; }
        public decimal VatAmount { get; set; }
        public string Side { get; set; } = "Output"; // Output | Input
    }

    public class VatReturnReverseChargeLineDto
    {
        public string Reference { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public decimal NetAmount { get; set; }
        public decimal ReverseChargeVat { get; set; }
    }

    public class ValidationIssueDto
    {
        public string RuleId { get; set; } = string.Empty; // V001–V012
        public string Severity { get; set; } = "Warning"; // Blocking | Warning
        public string Message { get; set; } = string.Empty;
        public string? EntityRef { get; set; }
    }

    public class VatReturnPeriodDto
    {
        public int Id { get; set; }
        public string PeriodLabel { get; set; } = string.Empty;
        public DateTime PeriodStart { get; set; }
        public DateTime PeriodEnd { get; set; }
        public DateTime DueDate { get; set; }
        public string Status { get; set; } = string.Empty;
        public decimal Box13a { get; set; }
        public decimal Box13b { get; set; }
        public DateTime? CalculatedAt { get; set; }
        public DateTime? LockedAt { get; set; }
    }

    public class VatReturnCalculateRequest
    {
        public DateTime? From { get; set; }
        public DateTime? To { get; set; }
    }
}

