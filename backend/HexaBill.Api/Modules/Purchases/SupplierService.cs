/*
Purpose: Supplier service for supplier ledger and management
Author: AI Assistant
Date: 2025
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;

namespace HexaBill.Api.Modules.Purchases
{
    public interface ISupplierService
    {
        /// <summary>Get or create a supplier by name (for Purchase creation).</summary>
        Task<Supplier> GetOrCreateByNameAsync(int tenantId, string supplierName);
        /// <summary>Search suppliers by name for autocomplete.</summary>
        Task<List<SupplierSearchDto>> SearchAsync(int tenantId, string? q, int limit = 20);
        Task<SupplierBalanceDto> GetSupplierBalanceAsync(int tenantId, string supplierName);
        Task<List<SupplierTransactionDto>> GetSupplierTransactionsAsync(int tenantId, string supplierName, DateTime? fromDate = null, DateTime? toDate = null);
        Task<List<SupplierSummaryDto>> GetAllSuppliersSummaryAsync(int tenantId);
    }

    public static class SupplierNormalize
    {
        public static string Normalize(string name) => string.IsNullOrWhiteSpace(name) ? "" : name.Trim().ToUpperInvariant();
    }

    public class SupplierService : ISupplierService
    {
        private readonly AppDbContext _context;

        public SupplierService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<Supplier> GetOrCreateByNameAsync(int tenantId, string supplierName)
        {
            if (string.IsNullOrWhiteSpace(supplierName))
                throw new ArgumentException("Supplier name is required.", nameof(supplierName));
            var normalized = SupplierNormalize.Normalize(supplierName);
            var supplier = await _context.Suppliers
                .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.NormalizedName == normalized);
            if (supplier != null) return supplier;
            supplier = new Supplier
            {
                TenantId = tenantId,
                Name = supplierName.Trim(),
                NormalizedName = normalized,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };
            _context.Suppliers.Add(supplier);
            await _context.SaveChangesAsync();
            return supplier;
        }

        public async Task<List<SupplierSearchDto>> SearchAsync(int tenantId, string? q, int limit = 20)
        {
            var query = _context.Suppliers
                .Where(s => s.TenantId == tenantId && s.IsActive);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var term = q.Trim().ToUpperInvariant();
                query = query.Where(s => s.Name.ToUpper().Contains(term) || (s.NormalizedName != null && s.NormalizedName.Contains(term)));
            }
            return await query
                .OrderBy(s => s.Name)
                .Take(limit)
                .Select(s => new SupplierSearchDto { Id = s.Id, Name = s.Name, Phone = s.Phone })
                .ToListAsync();
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

            // Total supplier payments (credit) - by supplier name via SupplierId
            var supplierIds = await _context.Suppliers
                .Where(s => s.TenantId == tenantId && s.NormalizedName == SupplierNormalize.Normalize(supplierName))
                .Select(s => s.Id)
                .ToListAsync();
            var totalPayments = await _context.SupplierPayments
                .Where(sp => supplierIds.Contains(sp.SupplierId))
                .SumAsync(sp => (decimal?)sp.Amount) ?? 0;

            // Net payable = Purchases - Returns - Payments
            var netPayable = totalPurchases - totalPurchaseReturns - totalPayments;

            return new SupplierBalanceDto
            {
                SupplierName = supplierName,
                TotalPurchases = totalPurchases,
                TotalReturns = totalPurchaseReturns,
                NetPayable = netPayable,
                LastPurchaseDate = await _context.Purchases
                    .Where(p => p.TenantId == tenantId && p.SupplierName == supplierName)
                    .OrderByDescending(p => p.PurchaseDate)
                    .Select(p => p.PurchaseDate)
                    .FirstOrDefaultAsync()
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

            // Supplier payments (credits) - by supplier name
            var supplierIds = await _context.Suppliers
                .Where(s => s.TenantId == tenantId && s.NormalizedName == SupplierNormalize.Normalize(supplierName))
                .Select(s => s.Id)
                .ToListAsync();
            var paymentsQuery = _context.SupplierPayments.Where(sp => supplierIds.Contains(sp.SupplierId));
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
            var supplierNames = await _context.Purchases
                .Where(p => p.TenantId == tenantId)
                .Select(p => p.SupplierName)
                .Distinct()
                .ToListAsync();

            var summaries = new List<SupplierSummaryDto>();

            foreach (var supplierName in supplierNames)
            {
                var balance = await GetSupplierBalanceAsync(tenantId, supplierName);
                summaries.Add(new SupplierSummaryDto
                {
                    SupplierName = supplierName,
                    NetPayable = balance.NetPayable,
                    TotalPurchases = balance.TotalPurchases,
                    LastPurchaseDate = balance.LastPurchaseDate
                });
            }

            return summaries.OrderByDescending(s => s.NetPayable).ToList();
        }
    }

    // DTOs
    public class SupplierBalanceDto
    {
        public string SupplierName { get; set; } = string.Empty;
        public decimal TotalPurchases { get; set; }
        public decimal TotalReturns { get; set; }
        public decimal NetPayable { get; set; }
        public DateTime? LastPurchaseDate { get; set; }
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
        public decimal NetPayable { get; set; }
        public decimal TotalPurchases { get; set; }
        public DateTime? LastPurchaseDate { get; set; }
    }

    public class SupplierSearchDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Phone { get; set; }
    }
}

