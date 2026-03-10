/*
Purpose: Generate payment receipts (proof of payment, not tax invoice).

Business logic:
- Single payment: one receipt with one invoice line (invoice no, date, total, amount applied).
- Multiple payments (multi-bill): one combined receipt with total amount received and a table of
  all invoices/bills and amount applied to each. Optional – print only when customer requests.
- Receipt shows: received from, amount received (and in words), payment method, optional reference,
  and per-invoice breakdown when multiple payments/invoices are included.
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Modules.SuperAdmin;

namespace HexaBill.Api.Modules.Payments
{
    public interface IPaymentReceiptService
    {
        Task<PaymentReceiptDetailDto> GenerateReceiptAsync(int tenantId, int paymentId, int userId);
        Task<(PaymentReceiptDetailDto Detail, List<PaymentReceiptDto> Receipts)> GenerateBatchReceiptAsync(int tenantId, List<int> paymentIds, int userId);
        Task<PaymentReceiptDto?> GetReceiptByPaymentIdAsync(int paymentId, int tenantId);
        Task<List<PaymentReceiptDto>> GetReceiptsByCustomerAsync(int customerId, int tenantId);
    }

    public class PaymentReceiptService : IPaymentReceiptService
    {
        private readonly AppDbContext _context;
        private readonly ISettingsService _settingsService;

        public PaymentReceiptService(AppDbContext context, ISettingsService settingsService)
        {
            _context = context;
            _settingsService = settingsService;
        }

        public async Task<PaymentReceiptDetailDto> GenerateReceiptAsync(int tenantId, int paymentId, int userId)
        {
            var (detail, _) = await GenerateBatchReceiptAsync(tenantId, new List<int> { paymentId }, userId);
            return detail;
        }

        public async Task<(PaymentReceiptDetailDto Detail, List<PaymentReceiptDto> Receipts)> GenerateBatchReceiptAsync(int tenantId, List<int> paymentIds, int userId)
        {
            if (paymentIds == null || !paymentIds.Any())
                throw new ArgumentException("At least one payment ID is required.");
            var distinctIds = paymentIds.Distinct().ToList();
            var payments = await _context.Payments
                .Where(p => p.TenantId == tenantId && distinctIds.Contains(p.Id))
                .Include(p => p.Sale)
                .Include(p => p.Customer)
                .OrderBy(p => p.PaymentDate)
                .ToListAsync();
            if (payments.Count != distinctIds.Count)
                throw new InvalidOperationException("One or more payments not found or do not belong to your tenant.");
            var settings = await _settingsService.GetCompanySettingsAsync(tenantId);
            var receipts = new List<PaymentReceiptDto>();
            var invoiceLines = new List<PaymentReceiptInvoiceLineDto>();
            decimal totalAmount = 0;
            string receivedFrom = "";
            int? customerId = null;
            foreach (var pay in payments)
            {
                var receiptNo = await GetNextReceiptNumberAsync(tenantId);
                var rec = new PaymentReceipt
                {
                    TenantId = tenantId,
                    ReceiptNumber = receiptNo,
                    PaymentId = pay.Id,
                    GeneratedAt = DateTime.UtcNow,
                    GeneratedByUserId = userId
                };
                _context.PaymentReceipts.Add(rec);
                await _context.SaveChangesAsync();
                receipts.Add(new PaymentReceiptDto { Id = rec.Id, ReceiptNumber = rec.ReceiptNumber, PaymentId = rec.PaymentId, GeneratedAt = rec.GeneratedAt });
                totalAmount += pay.Amount;
                if (pay.Customer != null)
                {
                    receivedFrom = pay.Customer.Name ?? "";
                    customerId = pay.CustomerId;
                }
                if (pay.Sale != null)
                {
                    invoiceLines.Add(new PaymentReceiptInvoiceLineDto
                    {
                        InvoiceNo = pay.Sale.InvoiceNo ?? "",
                        InvoiceDate = pay.Sale.InvoiceDate,
                        InvoiceTotal = pay.Sale.GrandTotal,
                        AmountApplied = pay.Amount
                    });
                }
            }
            if (payments.Count == 1 && payments[0].Customer != null)
                receivedFrom = payments[0].Customer.Name ?? "";
            else if (payments.Count > 1 && customerId.HasValue)
            {
                var cust = await _context.Customers.FindAsync(customerId.Value);
                receivedFrom = cust?.Name ?? "Multiple";
            }
            decimal? previousBalance = null;
            decimal? remainingBalance = null;
            if (customerId.HasValue)
            {
                var balance = await _context.Customers.Where(c => c.Id == customerId.Value).Select(c => c.PendingBalance).FirstOrDefaultAsync();
                previousBalance = balance;
                remainingBalance = balance - totalAmount;
            }
            var detail = new PaymentReceiptDetailDto
            {
                ReceiptNumber = receipts.Count == 1 ? receipts[0].ReceiptNumber : $"{receipts[0].ReceiptNumber} (+{receipts.Count - 1} more)",
                ReceiptDate = payments[0].PaymentDate,
                CompanyName = settings.LegalNameEn ?? "Company",
                CompanyNameAr = settings.LegalNameAr,
                CompanyTrn = settings.VatNumber,
                CompanyAddress = settings.Address,
                CompanyPhone = settings.Mobile,
                ReceivedFrom = receivedFrom,
                CustomerTrn = customerId.HasValue ? (await _context.Customers.Where(c => c.Id == customerId.Value).Select(c => c.Trn).FirstOrDefaultAsync()) : null,
                AmountReceived = totalAmount,
                AmountInWords = AmountToWords(totalAmount),
                PaymentMethod = payments.Count == 1 ? payments[0].Mode.ToString() : "Multiple",
                Reference = payments.Count == 1 ? payments[0].Reference : null,
                Invoices = invoiceLines,
                PreviousBalance = previousBalance,
                AmountPaid = totalAmount,
                RemainingBalance = remainingBalance
            };
            return (detail, receipts);
        }

        public async Task<PaymentReceiptDto?> GetReceiptByPaymentIdAsync(int paymentId, int tenantId)
        {
            return await _context.PaymentReceipts
                .Where(r => r.PaymentId == paymentId && r.TenantId == tenantId)
                .OrderByDescending(r => r.GeneratedAt)
                .Select(r => new PaymentReceiptDto { Id = r.Id, ReceiptNumber = r.ReceiptNumber, PaymentId = r.PaymentId, GeneratedAt = r.GeneratedAt })
                .FirstOrDefaultAsync();
        }

        public async Task<List<PaymentReceiptDto>> GetReceiptsByCustomerAsync(int customerId, int tenantId)
        {
            return await _context.PaymentReceipts
                .Where(r => r.TenantId == tenantId && r.Payment.CustomerId == customerId)
                .OrderByDescending(r => r.GeneratedAt)
                .Select(r => new PaymentReceiptDto { Id = r.Id, ReceiptNumber = r.ReceiptNumber, PaymentId = r.PaymentId, GeneratedAt = r.GeneratedAt })
                .ToListAsync();
        }

        private async Task<string> GetNextReceiptNumberAsync(int tenantId)
        {
            var year = DateTime.UtcNow.Year;
            var prefix = $"REC-{year}-";
            var max = await _context.PaymentReceipts
                .Where(r => r.TenantId == tenantId && r.ReceiptNumber.StartsWith(prefix))
                .Select(r => r.ReceiptNumber)
                .ToListAsync();
            var maxNum = max
                .Select(s => s.Length > prefix.Length && int.TryParse(s.AsSpan(prefix.Length), out var n) ? n : 0)
                .DefaultIfEmpty(0)
                .Max();
            return prefix + (maxNum + 1).ToString("D4");
        }

        private static string AmountToWords(decimal amount)
        {
            var whole = (int)Math.Floor(amount);
            var frac = (int)Math.Round((amount - whole) * 100);
            if (whole == 0 && frac == 0) return "Zero Dirhams Only";
            var words = WholeToWords(whole);
            if (frac > 0) words += " and " + frac + "/100";
            return words + " Dirhams Only";
        }

        private static string WholeToWords(int n)
        {
            if (n == 0) return "Zero";
            var units = new[] { "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine" };
            var teens = new[] { "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen" };
            var tens = new[] { "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety" };
            if (n < 10) return units[n];
            if (n < 20) return teens[n - 10];
            if (n < 100) return tens[n / 10] + (n % 10 > 0 ? " " + units[n % 10] : "");
            if (n < 1000) return units[n / 100] + " Hundred" + (n % 100 > 0 ? " " + WholeToWords(n % 100) : "");
            if (n < 1000000) return WholeToWords(n / 1000) + " Thousand" + (n % 1000 > 0 ? " " + WholeToWords(n % 1000) : "");
            return WholeToWords(n / 1000000) + " Million" + (n % 1000000 > 0 ? " " + WholeToWords(n % 1000000) : "");
        }
    }
}
