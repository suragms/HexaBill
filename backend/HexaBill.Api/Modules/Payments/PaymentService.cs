/*
Purpose: Payment service for payment tracking with atomic transactions
Author: AI Assistant
Date: 2024
Updated: 2025 - Complete rewrite per spec for proper payment/invoice/balance tracking
*/
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions; // CRITICAL: For ToUtcKind() extension
using HexaBill.Api.Modules.Notifications;
using HexaBill.Api.Modules.Customers;
using HexaBill.Api.Modules.Billing;
using HexaBill.Api.Shared.Validation;

namespace HexaBill.Api.Modules.Payments
{
    public interface IPaymentService
    {
        Task<bool> CheckDuplicatePaymentAsync(int tenantId, int customerId, decimal amount, DateTime paymentDate);
        Task<PagedResponse<PaymentDto>> GetPaymentsAsync(int tenantId, int page = 1, int pageSize = 10);
        Task<PaymentDto?> GetPaymentByIdAsync(int id, int tenantId);
        Task<CreatePaymentResponse> CreatePaymentAsync(CreatePaymentRequest request, int userId, int tenantId, string? idempotencyKey = null);
        Task<bool> UpdatePaymentStatusAsync(int paymentId, PaymentStatus status, int userId, int tenantId);
        Task<PaymentDto?> UpdatePaymentAsync(int paymentId, UpdatePaymentRequest request, int userId, int tenantId);
        Task<bool> DeletePaymentAsync(int paymentId, int userId, int tenantId);
        Task<List<Models.OutstandingInvoiceDto>> GetOutstandingInvoicesAsync(int customerId, int tenantId);
        Task<InvoiceAmountDto> GetInvoiceAmountAsync(int invoiceId, int tenantId);
        Task<CreatePaymentResponse> AllocatePaymentAsync(AllocatePaymentRequest request, int userId, int tenantId, string? idempotencyKey = null);
    }

    public class PaymentService : IPaymentService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<PaymentService> _logger;
        private readonly IValidationService _validationService;
        private readonly IBalanceService _balanceService;
        private readonly IAlertService _alertService;

        public PaymentService(
            AppDbContext context, 
            ILogger<PaymentService> logger, 
            IValidationService validationService,
            IBalanceService balanceService,
            IAlertService alertService)
        {
            _context = context;
            _logger = logger;
            _validationService = validationService;
            _balanceService = balanceService;
            _alertService = alertService;
        }

        public async Task<bool> CheckDuplicatePaymentAsync(int tenantId, int customerId, decimal amount, DateTime paymentDate)
        {
            var dayStart = paymentDate.Date;
            var dayEnd = dayStart.AddDays(1);
            var exists = await _context.Payments
                .AnyAsync(p =>
                    p.TenantId == tenantId &&
                    p.CustomerId == customerId &&
                    Math.Abs(p.Amount - amount) < 0.01m &&
                    p.PaymentDate >= dayStart &&
                    p.PaymentDate < dayEnd);
            return exists;
        }

        public async Task<PagedResponse<PaymentDto>> GetPaymentsAsync(int tenantId, int page = 1, int pageSize = 10)
        {
            var query = _context.Payments
                .Where(p => p.TenantId == tenantId) // CRITICAL: Multi-tenant filter
                .Include(p => p.Sale)
                .Include(p => p.Customer)
                .Include(p => p.CreatedByUser)
                .AsQueryable();

            var totalCount = await query.CountAsync();
            var payments = await query
                .OrderByDescending(p => p.PaymentDate)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(p => new PaymentDto
                {
                    Id = p.Id,
                    SaleId = p.SaleId,
                    InvoiceNo = p.Sale != null ? p.Sale.InvoiceNo : null,
                    CustomerId = p.CustomerId,
                    CustomerName = p.Customer != null ? p.Customer.Name : null,
                    Amount = p.Amount,
                    Mode = p.Mode.ToString(),
                    Reference = p.Reference,
                    Status = p.Status.ToString(),
                    PaymentDate = p.PaymentDate,
                    CreatedBy = p.CreatedBy,
                    CreatedAt = p.CreatedAt
                })
                .ToListAsync();

            return new PagedResponse<PaymentDto>
            {
                Items = payments,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
                TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
            };
        }

        public async Task<PaymentDto?> GetPaymentByIdAsync(int id, int tenantId)
        {
            var payment = await _context.Payments
                .Where(p => p.Id == id && p.TenantId == tenantId) // CRITICAL: Multi-tenant filter
                .Include(p => p.Sale)
                .Include(p => p.Customer)
                .Include(p => p.CreatedByUser)
                .FirstOrDefaultAsync();

            if (payment == null) return null;

            return new PaymentDto
            {
                Id = payment.Id,
                SaleId = payment.SaleId,
                InvoiceNo = payment.Sale?.InvoiceNo,
                CustomerId = payment.CustomerId,
                CustomerName = payment.Customer?.Name,
                Amount = payment.Amount,
                Mode = payment.Mode.ToString(),
                Reference = payment.Reference,
                Status = payment.Status.ToString(),
                PaymentDate = payment.PaymentDate,
                CreatedBy = payment.CreatedBy,
                CreatedAt = payment.CreatedAt
            };
        }

        public async Task<CreatePaymentResponse> CreatePaymentAsync(CreatePaymentRequest request, int userId, int tenantId, string? idempotencyKey = null)
        {
            // Validate request
            if (request.Amount <= 0)
                throw new ArgumentException("Payment amount must be greater than zero. Please enter a valid amount.");

            // NOTE: CustomerId can be null for CASH sales (walk-in customers)
            // Only require CustomerId for invoice-linked payments
            if (!request.CustomerId.HasValue && !request.SaleId.HasValue)
                throw new ArgumentException("Please select a customer or invoice before recording payment.");

            // Check idempotency if key provided
            if (!string.IsNullOrEmpty(idempotencyKey))
            {
                var existingRequest = await _context.PaymentIdempotencies
                    .FirstOrDefaultAsync(pr => pr.IdempotencyKey == idempotencyKey);
                
                if (existingRequest != null)
                {
                    // Return existing payment response
                    var existingPayment = await GetPaymentByIdAsync(existingRequest.PaymentId, tenantId);
                    if (existingPayment != null)
                    {
                        var sale = existingRequest.Payment?.Sale;
                        var customer = existingRequest.Payment?.Customer;
                        
                        Console.WriteLine($"⚠️ DUPLICATE PAYMENT DETECTED (Idempotency Key): {idempotencyKey}");
                        return new CreatePaymentResponse
                        {
                            Payment = existingPayment,
                            Invoice = sale != null ? new InvoiceSummaryDto
                            {
                                Id = sale.Id,
                                InvoiceNo = sale.InvoiceNo,
                                TotalAmount = sale.GrandTotal,
                                PaidAmount = sale.PaidAmount,
                                OutstandingAmount = sale.GrandTotal - sale.PaidAmount,
                                Status = sale.PaymentStatus.ToString()
                            } : null,
                            Customer = customer != null ? new CustomerSummaryDto
                            {
                                Id = customer.Id,
                                Name = customer.Name,
                                Balance = customer.Balance
                            } : null
                        };
                    }
                }
            }

            // Phase 1 Fix: Single transaction + Sale row lock (FOR UPDATE) to prevent overpayment and half-saves.
            var strategy = _context.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    Sale? invoiceSale = null;
                    if (request.SaleId.HasValue)
                    {
                        // Fix 1: Lock Sale row so two concurrent payments cannot both pass outstanding check (FOR UPDATE).
                        if (_context.Database.IsNpgsql())
                        {
                            invoiceSale = await _context.Sales
                                .FromSqlRaw(@"SELECT * FROM ""Sales"" WHERE ""Id"" = {0} AND ""TenantId"" = {1} AND NOT ""IsDeleted"" FOR UPDATE", request.SaleId.Value, tenantId)
                                .FirstOrDefaultAsync();
                        }
                        else
                        {
                            invoiceSale = await _context.Sales
                                .FirstOrDefaultAsync(s => s.Id == request.SaleId.Value && s.TenantId == tenantId && !s.IsDeleted);
                        }

                        if (invoiceSale == null)
                            throw new ArgumentException($"Invoice with ID {request.SaleId.Value} not found.");

                        if (request.CustomerId.HasValue && invoiceSale.CustomerId.HasValue && invoiceSale.CustomerId.Value != request.CustomerId.Value)
                            throw new ArgumentException($"Invoice {invoiceSale.InvoiceNo} belongs to a different customer. Expected customer ID: {invoiceSale.CustomerId.Value}, got: {request.CustomerId.Value}");

                        if (invoiceSale.CustomerId.HasValue && !request.CustomerId.HasValue)
                            request.CustomerId = invoiceSale.CustomerId;

                        var actualPaidAmount = await _context.Payments
                            .Where(p => p.SaleId == request.SaleId.Value && p.TenantId == tenantId && p.Status != PaymentStatus.VOID)
                            .SumAsync(p => p.Amount);
                        var realOutstanding = invoiceSale.GrandTotal - actualPaidAmount;

                        if (realOutstanding <= 0)
                            throw new ArgumentException($"Invoice {invoiceSale.InvoiceNo} is already fully paid. Total: {invoiceSale.GrandTotal:F2} AED, Paid: {actualPaidAmount:F2} AED. No more payments allowed.");

                        if (request.Amount > realOutstanding + 0.01m)
                            throw new ArgumentException($"Payment amount ({request.Amount:F2} AED) exceeds outstanding balance ({realOutstanding:F2} AED). Maximum allowed: {realOutstanding:F2} AED");

                        var recentDuplicatePayment = await _context.Payments
                            .Where(p => p.SaleId == request.SaleId.Value && p.Amount == request.Amount && p.TenantId == tenantId
                                && p.Status != PaymentStatus.VOID && p.CreatedAt >= DateTime.UtcNow.AddMinutes(-2))
                            .FirstOrDefaultAsync();
                        if (recentDuplicatePayment != null)
                            throw new ArgumentException($"A payment of {request.Amount:F2} AED was already recorded for invoice {invoiceSale.InvoiceNo} just now. Please refresh and verify before trying again.");

                        var validationResult = await _validationService.ValidatePaymentAmountAsync(request.SaleId, request.CustomerId, request.Amount);
                        if (!validationResult.IsValid)
                            throw new ArgumentException(string.Join(" ", validationResult.Errors));
                    }

                    PaymentStatus paymentStatus = request.Mode == "CHEQUE" || request.Mode == "CREDIT"
                        ? PaymentStatus.PENDING
                        : (request.Mode == "CASH" || request.Mode == "ONLINE" ? PaymentStatus.CLEARED : PaymentStatus.PENDING);
                    var paymentMode = Enum.Parse<PaymentMode>(request.Mode);
                    var paymentDate = (request.PaymentDate ?? DateTime.UtcNow).ToUtcKind();

                    var payment = new Payment
                    {
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        SaleId = request.SaleId,
                        CustomerId = request.CustomerId,
                        Amount = request.Amount,
                        Mode = paymentMode,
                        Reference = request.Reference,
                        Status = paymentStatus,
                        PaymentDate = paymentDate,
                        CreatedBy = userId,
                        CreatedAt = paymentDate,
                        UpdatedAt = paymentDate
                    };
                    _context.Payments.Add(payment);

                    if (request.SaleId.HasValue && invoiceSale != null)
                    {
                        var clearedSum = await _context.Payments
                            .Where(p => p.SaleId == request.SaleId.Value && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED)
                            .SumAsync(p => p.Amount);
                        var newPaidAmount = clearedSum + (paymentStatus == PaymentStatus.CLEARED ? request.Amount : 0);
                        invoiceSale.PaidAmount = newPaidAmount;
                        invoiceSale.LastPaymentDate = payment.PaymentDate;
                        var shortfall = invoiceSale.GrandTotal - newPaidAmount;
                        invoiceSale.PaymentStatus = shortfall <= SalePaymentHelpers.SettlementToleranceAed ? SalePaymentStatus.Paid
                            : (newPaidAmount > 0 ? SalePaymentStatus.Partial : SalePaymentStatus.Pending);
                    }

                    Customer? updatedCustomer = null;
                    if (paymentStatus == PaymentStatus.CLEARED && request.CustomerId.HasValue)
                    {
                        var customer = await _context.Customers
                            .FirstOrDefaultAsync(c => c.Id == request.CustomerId.Value && c.TenantId == tenantId);
                        if (customer != null)
                        {
                            customer.Balance = Math.Round(customer.Balance - request.Amount, 2, MidpointRounding.AwayFromZero);
                            customer.LastActivity = DateTime.UtcNow;
                            customer.UpdatedAt = DateTime.UtcNow;
                            updatedCustomer = customer;
                        }
                    }

                    await _context.SaveChangesAsync();

                    var auditLog = new AuditLog
                    {
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        UserId = userId,
                        Action = "Payment Created",
                        Details = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            PaymentId = payment.Id,
                            InvoiceId = request.SaleId,
                            CustomerId = request.CustomerId,
                            Amount = request.Amount,
                            Mode = request.Mode,
                            Status = paymentStatus.ToString(),
                            Reference = request.Reference
                        }),
                        CreatedAt = DateTime.UtcNow
                    };
                    _context.AuditLogs.Add(auditLog);

                    if (!string.IsNullOrEmpty(idempotencyKey))
                    {
                        _context.PaymentIdempotencies.Add(new PaymentIdempotency
                        {
                            IdempotencyKey = idempotencyKey,
                            PaymentId = payment.Id,
                            UserId = userId,
                            CreatedAt = DateTime.UtcNow,
                            ResponseSnapshot = System.Text.Json.JsonSerializer.Serialize(new { PaymentId = payment.Id, InvoiceId = request.SaleId, CustomerId = request.CustomerId, Amount = request.Amount })
                        });
                    }
                    await _context.SaveChangesAsync();
                    await transaction.CommitAsync();

                    var paymentId = payment.Id;
                    return new CreatePaymentResponse
                    {
                        Payment = await GetPaymentByIdAsync(paymentId, tenantId) ?? throw new InvalidOperationException("Failed to retrieve payment"),
                        Invoice = invoiceSale != null ? new InvoiceSummaryDto
                        {
                            Id = invoiceSale.Id,
                            InvoiceNo = invoiceSale.InvoiceNo,
                            TotalAmount = invoiceSale.GrandTotal,
                            PaidAmount = invoiceSale.PaidAmount,
                            OutstandingAmount = invoiceSale.GrandTotal - invoiceSale.PaidAmount,
                            Status = invoiceSale.PaymentStatus.ToString()
                        } : null,
                        Customer = updatedCustomer != null ? new CustomerSummaryDto
                        {
                            Id = updatedCustomer.Id,
                            Name = updatedCustomer.Name,
                            Balance = updatedCustomer.Balance
                        } : null
                    };
                }
                catch (DbUpdateConcurrencyException ex)
                {
                    try { await transaction.RollbackAsync(); } catch { }
                    throw new InvalidOperationException("Invoice was modified by another user. Please refresh and try again.", ex);
                }
                catch (DbUpdateException ex)
                {
                    try { await transaction.RollbackAsync(); } catch { }
                    var errorMessage = ex.InnerException?.Message ?? ex.Message;
                    throw new InvalidOperationException($"Database error: {errorMessage}", ex);
                }
                catch
                {
                    try { await transaction.RollbackAsync(); } catch { }
                    throw;
                }
            });
        }

        public async Task<bool> UpdatePaymentStatusAsync(int paymentId, PaymentStatus status, int userId, int tenantId)
        {
            // CRITICAL FIX: Wrap in transaction to ensure atomicity of payment, sale, and customer updates
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Add owner filter to the query
                var payment = await _context.Payments
                    .Where(p => p.Id == paymentId && p.TenantId == tenantId)
                    .Include(p => p.Sale)
                    .Include(p => p.Customer)
                    .FirstOrDefaultAsync();
                
                if (payment == null)
                {
                    await transaction.RollbackAsync();
                    return false;
                }

                var oldStatus = payment.Status;
                payment.Status = status;
                payment.UpdatedAt = DateTime.UtcNow;

            // CRITICAL FIX: Handle status changes correctly
            // Since CreatePaymentAsync updates Sale.PaidAmount for ALL payment types (including PENDING),
            // but only updates Customer.Balance for CLEARED payments, we need to handle transitions carefully:
            // - PENDING → CLEARED: Only update Customer.Balance (PaidAmount already added)
            // - PENDING → VOID: Reverse PaidAmount only (Balance was never affected)
            // - CLEARED → VOID/RETURNED: Reverse both PaidAmount and Balance
            // - CLEARED → PENDING: Reverse Balance only (keep PaidAmount)

            if (oldStatus == PaymentStatus.PENDING && status == PaymentStatus.CLEARED)
            {
                // Recalculate sale PaidAmount from cleared payments (this payment now counts)
                if (payment.SaleId.HasValue)
                {
                    var sale = await _context.Sales.FirstOrDefaultAsync(s => s.Id == payment.SaleId.Value);
                    if (sale != null)
                    {
                        var clearedSum = await _context.Payments
                            .Where(p => p.SaleId == sale.Id && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED && p.Id != paymentId)
                            .SumAsync(p => (decimal?)p.Amount) ?? 0;
                        clearedSum += payment.Amount;
                        sale.PaidAmount = clearedSum;
                        sale.LastPaymentDate = payment.PaymentDate;
                        var sf = sale.GrandTotal - clearedSum;
                        sale.PaymentStatus = sf <= SalePaymentHelpers.SettlementToleranceAed ? SalePaymentStatus.Paid
                            : clearedSum > 0 ? SalePaymentStatus.Partial : SalePaymentStatus.Pending;
                    }
                }
                if (payment.CustomerId.HasValue)
                {
                    await _balanceService.RecalculateCustomerBalanceAsync(payment.CustomerId.Value);
                }
            }
            // If voiding/returning - recalc Sale.PaidAmount from CLEARED only (this payment excluded after save)
            else if ((status == PaymentStatus.VOID || status == PaymentStatus.RETURNED) && oldStatus != PaymentStatus.VOID)
            {
                Console.WriteLine($"📋 Status change: {oldStatus} → {status} for payment {paymentId} - Reversing effects");
                if (payment.SaleId.HasValue)
                {
                    var sale = await _context.Sales
                        .FirstOrDefaultAsync(s => s.Id == payment.SaleId.Value && s.TenantId == tenantId);
                    if (sale != null)
                    {
                        // Recalc from CLEARED only; exclude this payment (it is being set to VOID/RETURNED)
                        var newPaidAmount = await _context.Payments
                            .Where(p => p.SaleId == sale.Id && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED && p.Id != paymentId)
                            .SumAsync(p => p.Amount);
                        sale.PaidAmount = newPaidAmount;
                        sale.LastPaymentDate = await _context.Payments
                            .Where(p => p.SaleId == sale.Id && p.Status != PaymentStatus.VOID && p.Status != PaymentStatus.RETURNED && p.Id != paymentId)
                            .OrderByDescending(p => p.PaymentDate)
                            .Select(p => p.PaymentDate)
                            .FirstOrDefaultAsync();
                        var sf2 = sale.GrandTotal - sale.PaidAmount;
                        sale.PaymentStatus = sf2 <= SalePaymentHelpers.SettlementToleranceAed ? SalePaymentStatus.Paid
                            : sale.PaidAmount > 0 ? SalePaymentStatus.Partial : SalePaymentStatus.Pending;
                    }
                }

                if (payment.CustomerId.HasValue)
                {
                    await _balanceService.RecalculateCustomerBalanceAsync(payment.CustomerId.Value);
                }
            }
            // If changing from CLEARED to PENDING - reverse Customer.Balance and recalc Sale.PaidAmount (this payment no longer cleared)
            else if (oldStatus == PaymentStatus.CLEARED && status == PaymentStatus.PENDING)
            {
                Console.WriteLine($"📋 Status change: CLEARED → PENDING for payment {paymentId}");
                if (payment.SaleId.HasValue)
                {
                    var sale = await _context.Sales.FirstOrDefaultAsync(s => s.Id == payment.SaleId.Value && s.TenantId == tenantId);
                    if (sale != null)
                    {
                        sale.PaidAmount = Math.Max(0, sale.PaidAmount - payment.Amount);
                        var sf3 = sale.GrandTotal - sale.PaidAmount;
                        sale.PaymentStatus = sf3 <= SalePaymentHelpers.SettlementToleranceAed ? SalePaymentStatus.Paid
                            : sale.PaidAmount > 0 ? SalePaymentStatus.Partial : SalePaymentStatus.Pending;
                    }
                }
                if (payment.CustomerId.HasValue)
                {
                    await _balanceService.RecalculateCustomerBalanceAsync(payment.CustomerId.Value);
                }
            }

            // Create audit log
            var auditLog = new AuditLog
            {
                OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                TenantId = tenantId, // CRITICAL: Set new TenantId
                UserId = userId,
                Action = "Payment Status Updated",
                Details = System.Text.Json.JsonSerializer.Serialize(new
                {
                    PaymentId = paymentId,
                    OldStatus = oldStatus.ToString(),
                    NewStatus = status.ToString()
                }),
                CreatedAt = DateTime.UtcNow
            };

                _context.AuditLogs.Add(auditLog);
                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return true;
            }
            catch (Exception ex)
            {
                try { await transaction.RollbackAsync(); } catch { }
                Console.WriteLine($"❌ Error updating payment status: {ex.Message}");
                throw;
            }
        }

        public async Task<PaymentDto?> UpdatePaymentAsync(int paymentId, UpdatePaymentRequest request, int userId, int tenantId)
        {
            // CRITICAL FIX: Wrap in transaction to ensure atomicity of payment, sale, and customer updates
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Add owner filter
                var payment = await _context.Payments
                    .Where(p => p.Id == paymentId && p.TenantId == tenantId)
                    .Include(p => p.Sale)
                    .Include(p => p.Customer)
                    .FirstOrDefaultAsync();
                
                if (payment == null)
                {
                    await transaction.RollbackAsync();
                    return null;
                }

            var oldAmount = payment.Amount;
            var oldStatus = payment.Status;
            var wasCleared = oldStatus == PaymentStatus.CLEARED;
            var wasNonVoid = oldStatus != PaymentStatus.VOID;

            // Reverse Customer.Balance only if old status was CLEARED (balance uses CLEARED only)
            if (wasCleared && payment.CustomerId.HasValue)
            {
                var customer = await _context.Customers
                    .FirstOrDefaultAsync(c => c.Id == payment.CustomerId.Value && c.TenantId == tenantId);
                if (customer != null)
                    customer.Balance += oldAmount;
            }

            // Update payment fields
            if (request.Amount.HasValue && request.Amount.Value > 0)
                    payment.Amount = request.Amount.Value;

            if (!string.IsNullOrEmpty(request.Mode))
            {
                if (Enum.TryParse<PaymentMode>(request.Mode, out var mode))
                        payment.Mode = mode;
            }

            if (request.Reference != null)
                    payment.Reference = request.Reference;

            if (request.PaymentDate.HasValue)
                    payment.PaymentDate = request.PaymentDate.Value;

            payment.UpdatedAt = DateTime.UtcNow;

            // Determine new status based on mode (if changed)
            if (!string.IsNullOrEmpty(request.Mode))
            {
                if (request.Mode == "CHEQUE" || request.Mode == "CREDIT")
                        payment.Status = PaymentStatus.PENDING;
                else if (request.Mode == "CASH" || request.Mode == "ONLINE")
                        payment.Status = PaymentStatus.CLEARED;
            }

            var newAmount = payment.Amount;
            var newStatus = payment.Status;
            var isNowCleared = newStatus == PaymentStatus.CLEARED;

            // Recalc Sale.PaidAmount from CLEARED only: other CLEARED payments + this one if now CLEARED (we've updated entity in memory)
            if (payment.SaleId.HasValue)
            {
                var sale = await _context.Sales
                    .FirstOrDefaultAsync(s => s.Id == payment.SaleId.Value && s.TenantId == tenantId);
                if (sale != null)
                {
                    var otherCleared = await _context.Payments
                        .Where(p => p.SaleId == sale.Id && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED && p.Id != paymentId)
                        .SumAsync(p => p.Amount);
                    sale.PaidAmount = otherCleared + (isNowCleared ? newAmount : 0);
                    sale.LastPaymentDate = payment.PaymentDate;
                    sale.PaymentStatus = sale.PaidAmount >= sale.GrandTotal ? SalePaymentStatus.Paid
                        : sale.PaidAmount > 0 ? SalePaymentStatus.Partial : SalePaymentStatus.Pending;
                    Console.WriteLine($"📋 UpdatePayment: Sale {sale.InvoiceNo} PaidAmount now: {sale.PaidAmount}");
                }
            }
            if (isNowCleared && payment.CustomerId.HasValue)
            {
                var customer = await _context.Customers
                    .FirstOrDefaultAsync(c => c.Id == payment.CustomerId.Value && c.TenantId == tenantId);
                if (customer != null)
                {
                    customer.Balance -= newAmount;
                    customer.LastActivity = DateTime.UtcNow;
                    customer.UpdatedAt = DateTime.UtcNow;
                }
            }

            // Create audit log
            var auditLog = new AuditLog
            {
                OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                TenantId = tenantId, // CRITICAL: Set new TenantId
                UserId = userId,
                Action = "Payment Updated",
                Details = System.Text.Json.JsonSerializer.Serialize(new
                {
                    PaymentId = paymentId,
                    OldAmount = oldAmount,
                    NewAmount = newAmount,
                    OldStatus = oldStatus.ToString(),
                    NewStatus = newStatus.ToString()
                }),
                CreatedAt = DateTime.UtcNow
            };

                _context.AuditLogs.Add(auditLog);

                // CRITICAL FIX: Recalculate customer balance BEFORE SaveChangesAsync
                // This ensures balance is always accurate after payment update
                if (payment.CustomerId.HasValue)
                {
                    var customerService = new HexaBill.Api.Modules.Customers.CustomerService(_context);
                    var customer = await _context.Customers
                        .FirstOrDefaultAsync(c => c.Id == payment.CustomerId.Value && c.TenantId == tenantId);
                    if (customer != null)
                    {
                        await customerService.RecalculateCustomerBalanceAsync(payment.CustomerId.Value, customer.TenantId ?? 0);
                        Console.WriteLine($"✅ Customer balance recalculated after payment update. New balance: {customer.Balance}");
                    }
                }

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return await GetPaymentByIdAsync(paymentId, tenantId);
            }
            catch (Exception ex)
            {
                try { await transaction.RollbackAsync(); } catch { }
                Console.WriteLine($"❌ Error updating payment: {ex.Message}");
                throw;
            }
        }

        public async Task<bool> DeletePaymentAsync(int paymentId, int userId, int tenantId)
        {
            // CRITICAL FIX: Wrap in transaction to ensure atomicity of payment deletion and sale/customer updates
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var payment = await _context.Payments
                    .Where(p => p.Id == paymentId && p.TenantId == tenantId)
                    .Include(p => p.Sale)
                    .Include(p => p.Customer)
                    .FirstOrDefaultAsync();
                
                if (payment == null)
                {
                    await transaction.RollbackAsync();
                    return false;
                }

            var wasCleared = payment.Status == PaymentStatus.CLEARED;
            var wasNonVoid = payment.Status != PaymentStatus.VOID;

            // Recalc Sale.PaidAmount from CLEARED only (excluding this payment which is being deleted)
            if (payment.SaleId.HasValue)
            {
                var sale = await _context.Sales
                    .FirstOrDefaultAsync(s => s.Id == payment.SaleId.Value && s.TenantId == tenantId);
                if (sale != null)
                {
                    var newPaidAmount = await _context.Payments
                        .Where(p => p.SaleId == sale.Id && p.TenantId == tenantId && p.Status == PaymentStatus.CLEARED && p.Id != paymentId)
                        .SumAsync(p => p.Amount);
                    sale.PaidAmount = newPaidAmount;
                    sale.LastPaymentDate = await _context.Payments
                        .Where(p => p.SaleId == sale.Id && p.Status != PaymentStatus.VOID && p.Id != paymentId)
                        .OrderByDescending(p => p.PaymentDate)
                        .Select(p => p.PaymentDate)
                        .FirstOrDefaultAsync();
                    sale.PaymentStatus = sale.PaidAmount >= sale.GrandTotal ? SalePaymentStatus.Paid
                        : sale.PaidAmount > 0 ? SalePaymentStatus.Partial : SalePaymentStatus.Pending;
                    Console.WriteLine($"📋 DeletePayment: Sale {sale.InvoiceNo} PaidAmount now: {sale.PaidAmount}, Status: {sale.PaymentStatus}");
                }
            }
            if (wasNonVoid)
            {

                // Only reverse Customer.Balance for CLEARED payments (balance is only affected by cleared payments)
                if (wasCleared && payment.CustomerId.HasValue)
                {
                    var customer = await _context.Customers
                        .FirstOrDefaultAsync(c => c.Id == payment.CustomerId.Value && c.TenantId == tenantId);
                    if (customer != null)
                    {
                        customer.Balance += payment.Amount; // Reverse: customer owes more
                        customer.LastActivity = DateTime.UtcNow;
                        customer.UpdatedAt = DateTime.UtcNow;
                    }
                }
            }

            // Delete idempotency records
            var idempotencies = await _context.PaymentIdempotencies
                .Where(pi => pi.PaymentId == paymentId)
                .ToListAsync();
            _context.PaymentIdempotencies.RemoveRange(idempotencies);

            // Delete payment
            _context.Payments.Remove(payment);

            // Create audit log
            var auditLog = new AuditLog
            {
                OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                TenantId = tenantId, // CRITICAL: Set new TenantId
                UserId = userId,
                Action = "Payment Deleted",
                Details = System.Text.Json.JsonSerializer.Serialize(new
                {
                    PaymentId = paymentId,
                    Amount = payment.Amount,
                    Mode = payment.Mode.ToString(),
                    Status = payment.Status.ToString(),
                    SaleId = payment.SaleId,
                    CustomerId = payment.CustomerId
                }),
                CreatedAt = DateTime.UtcNow
            };

                _context.AuditLogs.Add(auditLog);

                // CRITICAL FIX: Recalculate customer balance BEFORE SaveChangesAsync
                // This ensures balance is always accurate after payment deletion
                if (payment.CustomerId.HasValue)
                {
                    var customerService = new HexaBill.Api.Modules.Customers.CustomerService(_context);
                    var customer = await _context.Customers
                        .FirstOrDefaultAsync(c => c.Id == payment.CustomerId.Value && c.TenantId == tenantId);
                    if (customer != null)
                    {
                        await customerService.RecalculateCustomerBalanceAsync(payment.CustomerId.Value, customer.TenantId ?? 0);
                        Console.WriteLine($"✅ Customer balance recalculated after payment deletion. New balance: {customer.Balance}");
                    }
                }

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();
                return true;
            }
            catch (Exception ex)
            {
                try { await transaction.RollbackAsync(); } catch { }
                Console.WriteLine($"❌ Error deleting payment: {ex.Message}");
                throw;
            }
        }

        public async Task<List<Models.OutstandingInvoiceDto>> GetOutstandingInvoicesAsync(int customerId, int tenantId)
        {
            var sales = await _context.Sales
                .Where(s => s.CustomerId == customerId && s.TenantId == tenantId && !s.IsDeleted)
                .Where(s => s.PaymentStatus == SalePaymentStatus.Pending || s.PaymentStatus == SalePaymentStatus.Partial)
                .Select(s => new Models.OutstandingInvoiceDto
                {
                    Id = s.Id,
                    InvoiceNo = s.InvoiceNo,
                    InvoiceDate = s.InvoiceDate,
                    GrandTotal = s.GrandTotal,
                    PaidAmount = s.PaidAmount,
                    BalanceAmount = s.GrandTotal - s.PaidAmount,
                    PaymentStatus = s.PaymentStatus.ToString(),
                    DaysOverdue = (int)(DateTime.UtcNow - s.InvoiceDate).TotalDays
                })
                .OrderBy(s => s.InvoiceDate)
                .ToListAsync();

            return sales;
        }

        public async Task<InvoiceAmountDto> GetInvoiceAmountAsync(int invoiceId, int tenantId)
        {
            var sale = await _context.Sales
                .Where(s => s.Id == invoiceId && s.TenantId == tenantId && !s.IsDeleted)
                .FirstOrDefaultAsync();
            
            if (sale == null)
                throw new ArgumentException("Invoice not found");

            return new InvoiceAmountDto
            {
                Id = sale.Id,
                InvoiceNo = sale.InvoiceNo,
                TotalAmount = sale.GrandTotal,
                PaidAmount = sale.PaidAmount,
                OutstandingAmount = sale.GrandTotal - sale.PaidAmount,
                Status = sale.PaymentStatus.ToString()
            };
        }

        public async Task<CreatePaymentResponse> AllocatePaymentAsync(AllocatePaymentRequest request, int userId, int tenantId, string? idempotencyKey = null)
        {
            if (request.Amount <= 0)
                throw new ArgumentException("Payment amount must be greater than zero");

            if (!request.CustomerId.HasValue)
                throw new ArgumentException("Customer ID is required");

            // Check idempotency if key provided
            if (!string.IsNullOrEmpty(idempotencyKey))
            {
                var existingRequest = await _context.PaymentIdempotencies
                    .FirstOrDefaultAsync(pr => pr.IdempotencyKey == idempotencyKey);
                
                if (existingRequest != null)
                {
                    var existingPayment = await GetPaymentByIdAsync(existingRequest.PaymentId, tenantId);
                    if (existingPayment != null)
                    {
                        var sale = existingRequest.Payment?.Sale;
                        var customer = existingRequest.Payment?.Customer;
                        
                        return new CreatePaymentResponse
                        {
                            Payment = existingPayment,
                            Invoice = sale != null ? new InvoiceSummaryDto
                            {
                                Id = sale.Id,
                                InvoiceNo = sale.InvoiceNo,
                                TotalAmount = sale.GrandTotal,
                                PaidAmount = sale.PaidAmount,
                                OutstandingAmount = sale.GrandTotal - sale.PaidAmount,
                                Status = sale.PaymentStatus.ToString()
                            } : null,
                            Customer = customer != null ? new CustomerSummaryDto
                            {
                                Id = customer.Id,
                                Name = customer.Name,
                                Balance = customer.Balance
                            } : null
                        };
                    }
                }
            }

            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var customer = await _context.Customers
                    .FirstOrDefaultAsync(c => c.Id == request.CustomerId.Value && c.TenantId == tenantId);
                if (customer == null)
                    throw new ArgumentException("Customer not found");

                // Get outstanding invoices ordered by date (oldest first)
                var outstandingInvoices = await GetOutstandingInvoicesAsync(request.CustomerId.Value, tenantId);
                outstandingInvoices = outstandingInvoices.OrderBy(i => i.InvoiceDate).ToList();

                decimal remainingAmount = request.Amount;
                var allocatedPayments = new List<Payment>();

                // Allocate to invoices
                foreach (var allocation in request.Allocations ?? new List<AllocationItem>())
                {
                    if (remainingAmount <= 0) break;

                    var invoice = outstandingInvoices.FirstOrDefault(i => i.Id == allocation.InvoiceId);
                    if (invoice == null) continue;

                    var allocationAmount = Math.Min(allocation.Amount, Math.Min(remainingAmount, invoice.BalanceAmount));

                    if (allocationAmount <= 0) continue;

                    // Determine payment status
                    PaymentStatus paymentStatus;
                    if (request.Mode == "CHEQUE")
                        paymentStatus = PaymentStatus.PENDING;
                    else if (request.Mode == "CASH" || request.Mode == "ONLINE")
                        paymentStatus = PaymentStatus.CLEARED;
                    else
                        paymentStatus = PaymentStatus.PENDING;

                    // Create payment - use raw SQL to insert both old and new columns during transition
                    var modeValue = request.Mode;
                    var statusValue = paymentStatus.ToString();
                    var methodValue = modeValue; // Sync old Method column
                    var chequeStatusValue = paymentStatus switch
                    {
                        PaymentStatus.PENDING => "Pending",
                        PaymentStatus.CLEARED => "Cleared",
                        PaymentStatus.RETURNED => "Returned",
                        PaymentStatus.VOID => "Cleared",
                        _ => "Pending"
                    };

                    var paymentDate = request.PaymentDate ?? DateTime.UtcNow;
                    
                    // Create payment using EF Core (will handle Mode/Status columns)
                    var payment = new Payment
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        SaleId = allocation.InvoiceId,
                        CustomerId = request.CustomerId.Value,
                        Amount = Math.Round(allocationAmount, 2, MidpointRounding.AwayFromZero),
                        Mode = Enum.Parse<PaymentMode>(modeValue),
                        Reference = request.Reference,
                        Status = paymentStatus,
                        PaymentDate = paymentDate,
                        CreatedBy = userId,
                        CreatedAt = DateTime.UtcNow
                    };

                    _context.Payments.Add(payment);
                    await _context.SaveChangesAsync(); // Save to get ID
                    
                    allocatedPayments.Add(payment);

                    // Update invoice if payment is cleared
                    if (paymentStatus == PaymentStatus.CLEARED)
                    {
                        var sale = await _context.Sales
                            .FirstOrDefaultAsync(s => s.Id == allocation.InvoiceId && s.TenantId == tenantId);
                        if (sale != null)
                        {
                            sale.PaidAmount = Math.Round(sale.PaidAmount + allocationAmount, 2, MidpointRounding.AwayFromZero);
                            sale.LastPaymentDate = payment.PaymentDate;

                            if (sale.PaidAmount >= sale.GrandTotal)
                                sale.PaymentStatus = SalePaymentStatus.Paid;
                            else if (sale.PaidAmount > 0)
                                sale.PaymentStatus = SalePaymentStatus.Partial;
                        }
                    }

                    remainingAmount -= allocationAmount;
                }

                // CRITICAL FIX: Recalculate customer balance INSIDE transaction
                // This ensures balance is correct AND if recalculation fails, the whole transaction fails
                if (request.CustomerId.HasValue)
                {
                    var customerService = new HexaBill.Api.Modules.Customers.CustomerService(_context);
                    await customerService.RecalculateCustomerBalanceAsync(request.CustomerId.Value, customer.TenantId ?? 0);
                    Console.WriteLine($"✅ Customer balance recalculated after allocation. New balance will be available after reload.");
                }

                // Create audit log
                var auditLog = new AuditLog
                {
                    OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                    TenantId = tenantId, // CRITICAL: Set new TenantId
                    UserId = userId,
                    Action = "Bulk Payment Allocated",
                    Details = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        CustomerId = request.CustomerId,
                        TotalAmount = request.Amount,
                        Mode = request.Mode,
                        Allocations = request.Allocations
                    }),
                    CreatedAt = DateTime.UtcNow
                };

                _context.AuditLogs.Add(auditLog);

                // Save changes with optimistic concurrency check
                try
                {
                    await _context.SaveChangesAsync();
                    
                    // Create idempotency record if key provided
                    if (!string.IsNullOrEmpty(idempotencyKey) && allocatedPayments.Any())
                    {
                        var firstPayment = allocatedPayments.First();
                        var responseSnapshot = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            PaymentId = firstPayment.Id,
                            CustomerId = request.CustomerId,
                            TotalAmount = request.Amount,
                            Allocations = request.Allocations
                        });
                        
                        var paymentIdempotency = new PaymentIdempotency
                        {
                            IdempotencyKey = idempotencyKey,
                            PaymentId = firstPayment.Id,
                            UserId = userId,
                            CreatedAt = DateTime.UtcNow,
                            ResponseSnapshot = responseSnapshot
                        };
                        
                        _context.PaymentIdempotencies.Add(paymentIdempotency);
                        await _context.SaveChangesAsync();
                    }
                    
                    await transaction.CommitAsync();
                }
                catch (DbUpdateConcurrencyException ex)
                {
                    try { await transaction.RollbackAsync(); } catch { }
                    throw new InvalidOperationException("Invoice was modified by another user. Please refresh and try again.", ex);
                }

                // Reload customer
                await _context.Entry(customer).ReloadAsync();

                // CRITICAL FIX: Validate allocatedPayments is not empty before accessing
                if (allocatedPayments.Count == 0)
                {
                    throw new InvalidOperationException("No payments were allocated. Please check invoice allocation criteria.");
                }

                return new CreatePaymentResponse
                {
                    Payment = await GetPaymentByIdAsync(allocatedPayments.First().Id, tenantId) ?? throw new InvalidOperationException("Failed to retrieve payment"),
                    Customer = new CustomerSummaryDto
                    {
                        Id = customer.Id,
                        Name = customer.Name,
                        Balance = customer.Balance
                    }
                };
            }
            catch (Exception ex)
            {
                try { await transaction.RollbackAsync(); } catch { }
                _logger.LogError(ex, "Error allocating payment");
                throw;
            }
        }
    }

    // DTOs
    public class PaymentDto
    {
        public int Id { get; set; }
        public int? SaleId { get; set; }
        public string? InvoiceNo { get; set; }
        public int? CustomerId { get; set; }
        public string? CustomerName { get; set; }
        public decimal Amount { get; set; }
        public string Mode { get; set; } = string.Empty;
        public string? Reference { get; set; }
        public string Status { get; set; } = string.Empty;
        public DateTime PaymentDate { get; set; }
        public int CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class CreatePaymentRequest
    {
        public int? SaleId { get; set; }
        public int? CustomerId { get; set; }
        public decimal Amount { get; set; }
        public string Mode { get; set; } = string.Empty; // CASH, CHEQUE, ONLINE, CREDIT
        public string? Reference { get; set; }
        public DateTime? PaymentDate { get; set; }
    }

    public class UpdatePaymentRequest
    {
        public decimal? Amount { get; set; }
        public string? Mode { get; set; } // CASH, CHEQUE, ONLINE, CREDIT
        public string? Reference { get; set; }
        public DateTime? PaymentDate { get; set; }
    }

    public class CreatePaymentResponse
    {
        public PaymentDto Payment { get; set; } = null!;
        public InvoiceSummaryDto? Invoice { get; set; }
        public CustomerSummaryDto? Customer { get; set; }
    }

    public class InvoiceSummaryDto
    {
        public int Id { get; set; }
        public string InvoiceNo { get; set; } = string.Empty;
        public decimal TotalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal OutstandingAmount { get; set; }
        public string Status { get; set; } = string.Empty;
    }

    public class CustomerSummaryDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public decimal Balance { get; set; }
    }

    // OutstandingInvoiceDto moved to HexaBill.Api.Models.DTOs to avoid duplication

    public class InvoiceAmountDto
    {
        public int Id { get; set; }
        public string InvoiceNo { get; set; } = string.Empty;
        public decimal TotalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal OutstandingAmount { get; set; }
        public string Status { get; set; } = string.Empty;
    }

    public class AllocatePaymentRequest
    {
        public int? CustomerId { get; set; }
        public decimal Amount { get; set; }
        public string Mode { get; set; } = string.Empty;
        public string? Reference { get; set; }
        public DateTime? PaymentDate { get; set; }
        public List<AllocationItem>? Allocations { get; set; }
    }

    public class AllocationItem
    {
        public int InvoiceId { get; set; }
        public decimal Amount { get; set; }
    }
}
