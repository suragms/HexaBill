/*
Purpose: Real-time balance tracking service for customers
Author: AI Assistant
Date: 2025-11-11
Description: Handles all customer balance calculations, validations, and updates
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Modules.Notifications;

namespace HexaBill.Api.Modules.Customers
{
    public interface IBalanceService
    {
        Task RecalculateCustomerBalanceAsync(int customerId);
        Task UpdateCustomerBalanceOnInvoiceCreatedAsync(int customerId, decimal invoiceTotal);
        Task UpdateCustomerBalanceOnInvoiceDeletedAsync(int customerId, decimal invoiceTotal);
        Task UpdateCustomerBalanceOnInvoiceEditedAsync(int customerId, decimal oldTotal, decimal newTotal);
        Task UpdateCustomerBalanceOnPaymentCreatedAsync(int customerId, decimal paymentAmount);
        Task UpdateCustomerBalanceOnPaymentDeletedAsync(int customerId, decimal paymentAmount);
        Task<BalanceValidationResult> ValidateCustomerBalanceAsync(int customerId);
        Task<List<BalanceMismatch>> DetectAllBalanceMismatchesAsync(int? tenantId = null);
        Task<bool> FixBalanceMismatchAsync(int customerId);
        Task<bool> CanCustomerReceiveCreditAsync(int customerId, decimal additionalAmount);
    }

    public class BalanceService : IBalanceService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<BalanceService> _logger;
        private readonly IAlertService _alertService;

        public BalanceService(
            AppDbContext context,
            ILogger<BalanceService> logger,
            IAlertService alertService)
        {
            _context = context;
            _logger = logger;
            _alertService = alertService;
        }

        /// <summary>
        /// Recalculate customer balance from scratch using actual database data.
        /// UNIFIED: TotalPayments = CLEARED only, excluding refund payments (SaleReturnId != null).
        /// PendingBalance = TotalSales - TotalPayments - TotalSalesReturns + RefundsPaid (matches CustomerService).
        /// </summary>
        public async Task RecalculateCustomerBalanceAsync(int customerId)
        {
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var customer = await _context.Customers.FindAsync(customerId);
                if (customer == null)
                {
                    _logger.LogWarning("Customer {CustomerId} not found for balance recalculation", customerId);
                    return;
                }

                var tenantId = customer.TenantId;

                // OPTIMIZATION: Run 4 aggregates in parallel (1 round-trip latency vs 4 sequential)
                var totalSalesTask = _context.Sales
                    .Where(s => s.CustomerId == customerId && s.TenantId == tenantId && !s.IsDeleted)
                    .SumAsync(s => (decimal?)s.GrandTotal);
                var totalPaymentsTask = _context.Payments
                    .Where(p => p.CustomerId == customerId && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED && p.SaleReturnId == null)
                    .SumAsync(p => (decimal?)p.Amount);
                var totalSalesReturnsTask = _context.SaleReturns
                    .Where(sr => sr.CustomerId == customerId && sr.TenantId == tenantId)
                    .SumAsync(sr => (decimal?)sr.GrandTotal);
                var refundsPaidTask = _context.Payments
                    .Where(p => p.CustomerId == customerId && p.TenantId == tenantId && p.SaleReturnId != null)
                    .SumAsync(p => (decimal?)p.Amount);

                await Task.WhenAll(totalSalesTask, totalPaymentsTask, totalSalesReturnsTask, refundsPaidTask);

                var totalSales = await totalSalesTask ?? 0m;
                var totalPayments = await totalPaymentsTask ?? 0m;
                var totalSalesReturns = await totalSalesReturnsTask ?? 0m;
                var refundsPaid = await refundsPaidTask ?? 0m;

                // PendingBalance = TotalSales - TotalPayments - TotalSalesReturns + RefundsPaid
                var pendingBalance = totalSales - totalPayments - totalSalesReturns + refundsPaid;

                // Update customer record
                customer.TotalSales = totalSales;
                customer.TotalPayments = totalPayments;
                customer.PendingBalance = pendingBalance;
                customer.Balance = pendingBalance; // Keep legacy field in sync
                customer.UpdatedAt = DateTime.UtcNow;

                // Update LastPaymentDate
                var lastPayment = await _context.Payments
                    .Where(p => p.CustomerId == customerId && p.TenantId == tenantId)
                    .OrderByDescending(p => p.PaymentDate)
                    .FirstOrDefaultAsync();
                customer.LastPaymentDate = lastPayment?.PaymentDate;

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                _logger.LogInformation(
                    "Customer {CustomerId} balance recalculated: TotalSales={TotalSales}, TotalPayments(Cleared)={TotalPayments}, Returns={Returns}, RefundsPaid={Refunds}, PendingBalance={Pending}",
                    customerId, totalSales, totalPayments, totalSalesReturns, refundsPaid, pendingBalance);
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                _logger.LogError(ex, "Failed to recalculate balance for customer {CustomerId}. Inner: {InnerMessage}, InnerInner: {InnerInnerMessage}",
                    customerId, ex.InnerException?.Message, ex.InnerException?.InnerException?.Message);
                throw;
            }
        }

        /// <summary>
        /// Update customer balance when invoice is created. Uses full recalc so returns/refunds are included.
        /// </summary>
        public async Task UpdateCustomerBalanceOnInvoiceCreatedAsync(int customerId, decimal invoiceTotal)
        {
            await RecalculateCustomerBalanceAsync(customerId);

            _logger.LogInformation(
                "Customer {CustomerId} balance updated on invoice created: +{Amount}",
                customerId, invoiceTotal);
        }

        /// <summary>
        /// Update customer balance when invoice is deleted. Uses full recalc so returns/refunds are included.
        /// </summary>
        public async Task UpdateCustomerBalanceOnInvoiceDeletedAsync(int customerId, decimal invoiceTotal)
        {
            await RecalculateCustomerBalanceAsync(customerId);
            _logger.LogInformation("Customer {CustomerId} balance updated on invoice deleted: -{Amount}", customerId, invoiceTotal);
        }

        /// <summary>
        /// Update customer balance when invoice is edited. Uses full recalc so returns/refunds are included.
        /// </summary>
        public async Task UpdateCustomerBalanceOnInvoiceEditedAsync(int customerId, decimal oldTotal, decimal newTotal)
        {
            await RecalculateCustomerBalanceAsync(customerId);
            _logger.LogInformation("Customer {CustomerId} balance updated on invoice edited: Delta={Delta}", customerId, newTotal - oldTotal);
        }

        /// <summary>
        /// Update customer balance when payment is created. Uses full recalc so returns/refunds are included.
        /// </summary>
        public async Task UpdateCustomerBalanceOnPaymentCreatedAsync(int customerId, decimal paymentAmount)
        {
            await RecalculateCustomerBalanceAsync(customerId);
            _logger.LogInformation("Customer {CustomerId} balance updated on payment created: +{Amount}", customerId, paymentAmount);
        }

        /// <summary>
        /// Update customer balance when payment is deleted. Uses full recalc so returns/refunds are included.
        /// </summary>
        public async Task UpdateCustomerBalanceOnPaymentDeletedAsync(int customerId, decimal paymentAmount)
        {
            await RecalculateCustomerBalanceAsync(customerId);
            _logger.LogInformation("Customer {CustomerId} balance updated on payment deleted: -{Amount}", customerId, paymentAmount);
        }

        /// <summary>
        /// Validate customer balance against actual data
        /// </summary>
        public async Task<BalanceValidationResult> ValidateCustomerBalanceAsync(int customerId)
        {
            var customer = await _context.Customers.FindAsync(customerId);
            if (customer == null)
            {
                return new BalanceValidationResult
                {
                    IsValid = false,
                    ErrorMessage = "Customer not found"
                };
            }

            var tenantId = customer.TenantId;

            // Calculate actual values from database (same formula as RecalculateCustomerBalanceAsync)
            // Run 4 aggregates in parallel (1 round-trip latency vs 4 sequential)
            var actualTotalSalesTask = _context.Sales
                .Where(s => s.CustomerId == customerId && s.TenantId == tenantId && !s.IsDeleted)
                .SumAsync(s => (decimal?)s.GrandTotal);
            var actualTotalPaymentsTask = _context.Payments
                .Where(p => p.CustomerId == customerId && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED && p.SaleReturnId == null)
                .SumAsync(p => (decimal?)p.Amount);
            var totalSalesReturnsTask = _context.SaleReturns
                .Where(sr => sr.CustomerId == customerId && sr.TenantId == tenantId)
                .SumAsync(sr => (decimal?)sr.GrandTotal);
            var refundsPaidTask = _context.Payments
                .Where(p => p.CustomerId == customerId && p.TenantId == tenantId && p.SaleReturnId != null)
                .SumAsync(p => (decimal?)p.Amount);

            await Task.WhenAll(actualTotalSalesTask, actualTotalPaymentsTask, totalSalesReturnsTask, refundsPaidTask);

            var actualTotalSales = await actualTotalSalesTask ?? 0m;
            var actualTotalPayments = await actualTotalPaymentsTask ?? 0m;
            var totalSalesReturns = await totalSalesReturnsTask ?? 0m;
            var refundsPaid = await refundsPaidTask ?? 0m;

            var actualPendingBalance = actualTotalSales - actualTotalPayments - totalSalesReturns + refundsPaid;

            // Check for mismatches (allow 0.01 tolerance for rounding)
            var salesMismatch = Math.Abs(customer.TotalSales - actualTotalSales) > 0.01m;
            var paymentsMismatch = Math.Abs(customer.TotalPayments - actualTotalPayments) > 0.01m;
            var balanceMismatch = Math.Abs(customer.PendingBalance - actualPendingBalance) > 0.01m;

            if (salesMismatch || paymentsMismatch || balanceMismatch)
            {
                _logger.LogWarning(
                    "Balance mismatch for customer {CustomerId}: Stored(Sales={StoredSales}, Payments={StoredPayments}, Pending={StoredPending}) " +
                    "vs Actual(Sales={ActualSales}, Payments={ActualPayments}, Pending={ActualPending})",
                    customerId, customer.TotalSales, customer.TotalPayments, customer.PendingBalance,
                    actualTotalSales, actualTotalPayments, actualPendingBalance);

                // Create alert for admin (tenant-specific)
                await _alertService.CreateAlertAsync(
                    AlertType.BalanceMismatch,
                    $"Balance mismatch for customer {customer.Name}",
                    $"Stored: {customer.PendingBalance:C}, Actual: {actualPendingBalance:C}",
                    AlertSeverity.Warning,
                    new Dictionary<string, object> {
                        { "CustomerId", customerId },
                        { "StoredPending", customer.PendingBalance },
                        { "ActualPending", actualPendingBalance }
                    },
                    customer.TenantId);

                return new BalanceValidationResult
                {
                    IsValid = false,
                    StoredTotalSales = customer.TotalSales,
                    ActualTotalSales = actualTotalSales,
                    StoredTotalPayments = customer.TotalPayments,
                    ActualTotalPayments = actualTotalPayments,
                    StoredPendingBalance = customer.PendingBalance,
                    ActualPendingBalance = actualPendingBalance
                };
            }

            return new BalanceValidationResult { IsValid = true };
        }

        /// <summary>
        /// Detect all balance mismatches across customers.
        /// When tenantId is null (Super Admin), scans all. Otherwise filters by tenant for data isolation.
        /// </summary>
        public async Task<List<BalanceMismatch>> DetectAllBalanceMismatchesAsync(int? tenantId = null)
        {
            var mismatches = new List<BalanceMismatch>();
            var query = _context.Customers.AsQueryable();
            if (tenantId.HasValue && tenantId.Value > 0)
            {
                query = query.Where(c => c.TenantId == tenantId.Value);
            }
            var customers = await query.ToListAsync();

            foreach (var customer in customers)
            {
                var validation = await ValidateCustomerBalanceAsync(customer.Id);
                if (!validation.IsValid)
                {
                    mismatches.Add(new BalanceMismatch
                    {
                        CustomerId = customer.Id,
                        CustomerName = customer.Name,
                        StoredPending = validation.StoredPendingBalance,
                        ActualPending = validation.ActualPendingBalance,
                        Difference = validation.StoredPendingBalance - validation.ActualPendingBalance
                    });
                }
            }

            return mismatches;
        }

        /// <summary>
        /// Fix balance mismatch for a specific customer
        /// </summary>
        public async Task<bool> FixBalanceMismatchAsync(int customerId)
        {
            try
            {
                await RecalculateCustomerBalanceAsync(customerId);
                var validation = await ValidateCustomerBalanceAsync(customerId);
                return validation.IsValid;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to fix balance mismatch for customer {CustomerId}", customerId);
                return false;
            }
        }

        /// <summary>
        /// Check if customer can receive additional credit (pending balance check)
        /// </summary>
        public async Task<bool> CanCustomerReceiveCreditAsync(int customerId, decimal additionalAmount)
        {
            var customer = await _context.Customers.FindAsync(customerId);
            if (customer == null) return false;

            // Calculate new pending balance if invoice is created
            var newPending = customer.PendingBalance + additionalAmount;

            // Check if new pending exceeds credit limit
            if (newPending > customer.CreditLimit)
            {
                _logger.LogWarning(
                    "Customer {CustomerId} credit limit exceeded: Current={Current}, Additional={Additional}, Limit={Limit}",
                    customerId, customer.PendingBalance, additionalAmount, customer.CreditLimit);

                // Create alert (tenant-specific)
                await _alertService.CreateAlertAsync(
                    AlertType.ValidationError,
                    $"Credit limit exceeded for {customer.Name}",
                    $"Attempted amount: {additionalAmount:C}, Current pending: {customer.PendingBalance:C}, Credit limit: {customer.CreditLimit:C}",
                    AlertSeverity.Warning,
                    new Dictionary<string, object> {
                        { "CustomerId", customerId },
                        { "AttemptedAmount", additionalAmount },
                        { "CreditLimit", customer.CreditLimit }
                    },
                    customer.TenantId);

                return false;
            }

            return true;
        }
    }

    // DTOs for balance validation
    public class BalanceValidationResult
    {
        public bool IsValid { get; set; }
        public string? ErrorMessage { get; set; }
        public decimal StoredTotalSales { get; set; }
        public decimal ActualTotalSales { get; set; }
        public decimal StoredTotalPayments { get; set; }
        public decimal ActualTotalPayments { get; set; }
        public decimal StoredPendingBalance { get; set; }
        public decimal ActualPendingBalance { get; set; }
    }

    public class BalanceMismatch
    {
        public int CustomerId { get; set; }
        public string CustomerName { get; set; } = string.Empty;
        public decimal StoredPending { get; set; }
        public decimal ActualPending { get; set; }
        public decimal Difference { get; set; }
    }
}
