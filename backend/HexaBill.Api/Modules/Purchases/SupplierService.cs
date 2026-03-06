/*
Purpose: Supplier service for supplier ledger and management
Author: AI Assistant
Date: 2025
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;

namespace HexaBill.Api.Modules.Purchases
{
    public interface ISupplierService
    {
        Task<SupplierBalanceDto> GetSupplierBalanceAsync(int tenantId, string supplierName);
        Task<List<SupplierTransactionDto>> GetSupplierTransactionsAsync(int tenantId, string supplierName, DateTime? fromDate = null, DateTime? toDate = null);
        Task<List<SupplierSummaryDto>> GetAllSuppliersSummaryAsync(int tenantId);
        Task<SupplierPaymentDto> CreateSupplierPaymentAsync(int tenantId, string supplierName, decimal amount, DateTime paymentDate, SupplierPaymentMode mode, string? reference, string? notes, int userId);
        Task<List<string>> SearchSupplierNamesAsync(int tenantId, string query, int limit = 20);
        Task<SupplierDto> CreateSupplierAsync(int tenantId, CreateSupplierRequest request);
    }

    public class SupplierService : ISupplierService
    {
        private readonly AppDbContext _context;

        public SupplierService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<SupplierBalanceDto> GetSupplierBalanceAsync(int tenantId, string supplierName)
        {
            // Calculate total purchases (what we owe) + OWNER FILTER
            var totalPurchases = await _context.Purchases
                .Where(p => p.TenantId == tenantId && p.SupplierName == supplierName)
                .SumAsync(p => (decimal?)p.TotalAmount) ?? 0;

            // Calculate total purchase returns (credit) + OWNER FILTER
            var totalPurchaseReturns = await _context.PurchaseReturns
                .Include(pr => pr.Purchase)
                .Where(pr => pr.Purchase.TenantId == tenantId && pr.Purchase.SupplierName == supplierName)
                .SumAsync(pr => (decimal?)pr.GrandTotal) ?? 0;

            // Calculate total payments (credit)
            var totalPayments = await _context.SupplierPayments
                .Where(sp => sp.TenantId == tenantId && sp.SupplierName == supplierName)
                .SumAsync(sp => (decimal?)sp.Amount) ?? 0;

            // Net payable = Purchases - Returns - Payments
            var netPayable = totalPurchases - totalPurchaseReturns - totalPayments;

            var lastPaymentDate = await _context.SupplierPayments
                .Where(sp => sp.TenantId == tenantId && sp.SupplierName == supplierName)
                .OrderByDescending(sp => sp.PaymentDate)
                .Select(sp => (DateTime?)sp.PaymentDate)
                .FirstOrDefaultAsync();

            return new SupplierBalanceDto
            {
                SupplierName = supplierName,
                TotalPurchases = totalPurchases,
                TotalReturns = totalPurchaseReturns,
                TotalPayments = totalPayments,
                NetPayable = netPayable,
                LastPurchaseDate = await _context.Purchases
                    .Where(p => p.TenantId == tenantId && p.SupplierName == supplierName)
                    .OrderByDescending(p => p.PurchaseDate)
                    .Select(p => (DateTime?)p.PurchaseDate)
                    .FirstOrDefaultAsync(),
                LastPaymentDate = lastPaymentDate
            };
        }

        public async Task<List<SupplierTransactionDto>> GetSupplierTransactionsAsync(int tenantId, string supplierName, DateTime? fromDate = null, DateTime? toDate = null)
        {
            var transactions = new List<SupplierTransactionDto>();

            // Purchases (debits) + OWNER FILTER
            var purchasesQuery = _context.Purchases
                .Where(p => p.TenantId == tenantId && p.SupplierName == supplierName);

            if (fromDate.HasValue)
                purchasesQuery = purchasesQuery.Where(p => p.PurchaseDate >= fromDate.Value);
            if (toDate.HasValue)
                purchasesQuery = purchasesQuery.Where(p => p.PurchaseDate <= toDate.Value.AddDays(1));

            var purchases = await purchasesQuery
                .OrderBy(p => p.PurchaseDate)
                .ToListAsync();

            foreach (var purchase in purchases)
            {
                transactions.Add(new SupplierTransactionDto
                {
                    Date = purchase.PurchaseDate,
                    Type = "Purchase",
                    Reference = purchase.InvoiceNo,
                    Debit = purchase.TotalAmount,
                    Credit = 0,
                    Balance = 0 // Will calculate running balance
                });
            }

            // Purchase Returns (credits) + OWNER FILTER
            var returnsQuery = _context.PurchaseReturns
                .Include(pr => pr.Purchase)
                .Where(pr => pr.Purchase.TenantId == tenantId && pr.Purchase.SupplierName == supplierName);

            if (fromDate.HasValue)
                returnsQuery = returnsQuery.Where(pr => pr.ReturnDate >= fromDate.Value);
            if (toDate.HasValue)
                returnsQuery = returnsQuery.Where(pr => pr.ReturnDate <= toDate.Value.AddDays(1));

            var purchaseReturns = await returnsQuery
                .OrderBy(pr => pr.ReturnDate)
                .ToListAsync();

            foreach (var returnItem in purchaseReturns)
            {
                transactions.Add(new SupplierTransactionDto
                {
                    Date = returnItem.ReturnDate,
                    Type = "Return",
                    Reference = returnItem.ReturnNo,
                    Debit = 0,
                    Credit = returnItem.GrandTotal,
                    Balance = 0
                });
            }

            // Supplier Payments (credits)
            var paymentsQuery = _context.SupplierPayments
                .Where(sp => sp.TenantId == tenantId && sp.SupplierName == supplierName);

            if (fromDate.HasValue)
                paymentsQuery = paymentsQuery.Where(sp => sp.PaymentDate >= fromDate.Value);
            if (toDate.HasValue)
                paymentsQuery = paymentsQuery.Where(sp => sp.PaymentDate <= toDate.Value.AddDays(1));

            var payments = await paymentsQuery.OrderBy(sp => sp.PaymentDate).ToListAsync();

            foreach (var payment in payments)
            {
                transactions.Add(new SupplierTransactionDto
                {
                    Date = payment.PaymentDate,
                    Type = "Payment",
                    Reference = payment.Reference ?? $"Payment #{payment.Id}",
                    Debit = 0,
                    Credit = payment.Amount,
                    Balance = 0
                });
            }

            // Sort by date and calculate running balance
            transactions = transactions.OrderBy(t => t.Date).ToList();
            decimal runningBalance = 0;
            foreach (var transaction in transactions)
            {
                runningBalance += transaction.Debit - transaction.Credit;
                transaction.Balance = runningBalance;
            }

            return transactions;
        }

        public async Task<List<SupplierSummaryDto>> GetAllSuppliersSummaryAsync(int tenantId)
        {
            var fromPurchases = await _context.Purchases
                .Where(p => p.TenantId == tenantId)
                .Select(p => p.SupplierName)
                .Distinct()
                .ToListAsync();
            var fromSuppliersTable = await _context.Suppliers
                .Where(s => s.TenantId == tenantId && s.IsActive)
                .Select(s => s.Name)
                .ToListAsync();
            var supplierNames = fromPurchases.Union(fromSuppliersTable, StringComparer.OrdinalIgnoreCase).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            var summaries = new List<SupplierSummaryDto>();

            foreach (var supplierName in supplierNames)
            {
                var balance = await GetSupplierBalanceAsync(tenantId, supplierName);

                var invoiceCount = await _context.Purchases
                    .Where(p => p.TenantId == tenantId && p.SupplierName == supplierName)
                    .CountAsync();

                var supplier = await _context.Suppliers
                    .Where(s => s.TenantId == tenantId && s.Name == supplierName)
                    .Select(s => new { s.Phone, s.CreditLimit })
                    .FirstOrDefaultAsync();

                summaries.Add(new SupplierSummaryDto
                {
                    SupplierName = supplierName,
                    NetPayable = balance.NetPayable,
                    TotalPurchases = balance.TotalPurchases,
                    TotalPaid = balance.TotalPayments,
                    LastPurchaseDate = balance.LastPurchaseDate,
                    LastPaymentDate = balance.LastPaymentDate,
                    InvoiceCount = invoiceCount,
                    Overdue = 0, // TODO: Add due date to Purchase for overdue calculation
                    Phone = supplier?.Phone,
                    CreditLimit = supplier?.CreditLimit ?? 0
                });
            }

            return summaries.OrderByDescending(s => s.NetPayable).ToList();
        }

        public async Task<SupplierPaymentDto> CreateSupplierPaymentAsync(int tenantId, string supplierName, decimal amount, DateTime paymentDate, SupplierPaymentMode mode, string? reference, string? notes, int userId)
        {
            if (amount <= 0)
                throw new ArgumentException("Payment amount must be positive.", nameof(amount));
            // Phase 11.2: Validate PaymentDate not future
            var today = DateTime.UtcNow.Date;
            var payDate = paymentDate.ToUtcKind().Date;
            if (payDate > today)
                throw new ArgumentException("Payment date cannot be in the future. Please use today's date or earlier.", nameof(paymentDate));

            var payment = new SupplierPayment
            {
                TenantId = tenantId,
                SupplierName = supplierName,
                Amount = amount,
                PaymentDate = paymentDate == default ? DateTime.UtcNow : paymentDate.ToUtcKind(),
                Mode = mode,
                Reference = reference,
                Notes = notes,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow
            };

            _context.SupplierPayments.Add(payment);
            await _context.SaveChangesAsync();

            return new SupplierPaymentDto
            {
                Id = payment.Id,
                SupplierName = payment.SupplierName,
                Amount = payment.Amount,
                PaymentDate = payment.PaymentDate,
                Mode = payment.Mode.ToString(),
                Reference = payment.Reference,
                Notes = payment.Notes,
                CreatedAt = payment.CreatedAt
            };
        }

        public async Task<List<string>> SearchSupplierNamesAsync(int tenantId, string query, int limit = 20)
        {
            if (string.IsNullOrWhiteSpace(query) || query.Length < 2)
                return new List<string>();

            var term = query.Trim().ToLower();

            var fromPurchases = await _context.Purchases
                .Where(p => p.TenantId == tenantId && p.SupplierName.ToLower().Contains(term))
                .Select(p => p.SupplierName)
                .Distinct()
                .Take(limit)
                .ToListAsync();

            var fromSuppliers = await _context.Suppliers
                .Where(s => s.TenantId == tenantId && s.IsActive && s.Name.ToLower().Contains(term))
                .Select(s => s.Name)
                .Take(limit)
                .ToListAsync();

            var merged = fromPurchases.Union(fromSuppliers).Distinct(StringComparer.OrdinalIgnoreCase).Take(limit).ToList();
            return merged;
        }

        public async Task<SupplierDto> CreateSupplierAsync(int tenantId, CreateSupplierRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Name))
                throw new ArgumentException("Supplier name is required.", nameof(request));

            var name = request.Name.Trim();
            var normalized = name.ToLowerInvariant();
            var exists = await _context.Suppliers
                .AnyAsync(s => s.TenantId == tenantId && s.Name.ToLower() == normalized);
            if (exists)
                throw new ArgumentException($"A supplier with the name \"{name}\" already exists.", nameof(request));

            var supplier = new Supplier
            {
                TenantId = tenantId,
                Name = name,
                NormalizedName = normalized,
                Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone!.Trim(),
                Email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email!.Trim(),
                Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address!.Trim(),
                CreditLimit = request.CreditLimit ?? 0,
                PaymentTerms = string.IsNullOrWhiteSpace(request.PaymentTerms) ? null : request.PaymentTerms!.Trim(),
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _context.Suppliers.Add(supplier);
            await _context.SaveChangesAsync();

            return new SupplierDto
            {
                Id = supplier.Id,
                Name = supplier.Name,
                Phone = supplier.Phone,
                Email = supplier.Email,
                Address = supplier.Address,
                CreditLimit = supplier.CreditLimit,
                PaymentTerms = supplier.PaymentTerms
            };
        }
    }

    // DTOs
    public class CreateSupplierRequest
    {
        public string Name { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? Address { get; set; }
        public decimal? CreditLimit { get; set; }
        public string? PaymentTerms { get; set; }
    }

    public class SupplierDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? Address { get; set; }
        public decimal CreditLimit { get; set; }
        public string? PaymentTerms { get; set; }
    }

    // DTOs (existing)
    public class SupplierBalanceDto
    {
        public string SupplierName { get; set; } = string.Empty;
        public decimal TotalPurchases { get; set; }
        public decimal TotalReturns { get; set; }
        public decimal TotalPayments { get; set; }
        public decimal NetPayable { get; set; }
        public DateTime? LastPurchaseDate { get; set; }
        public DateTime? LastPaymentDate { get; set; }
    }

    public class SupplierPaymentDto
    {
        public int Id { get; set; }
        public string SupplierName { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public DateTime PaymentDate { get; set; }
        public string Mode { get; set; } = string.Empty;
        public string? Reference { get; set; }
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class SupplierTransactionDto
    {
        public DateTime Date { get; set; }
        public string Type { get; set; } = string.Empty;
        public string Reference { get; set; } = string.Empty;
        public decimal Debit { get; set; }
        public decimal Credit { get; set; }
        public decimal Balance { get; set; }
    }

    public class SupplierSummaryDto
    {
        public string SupplierName { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public decimal NetPayable { get; set; }
        public decimal TotalPurchases { get; set; }
        public decimal TotalPaid { get; set; }
        public DateTime? LastPurchaseDate { get; set; }
        public DateTime? LastPaymentDate { get; set; }
        public int InvoiceCount { get; set; }
        public decimal Overdue { get; set; }
        public decimal CreditLimit { get; set; }
    }
}

