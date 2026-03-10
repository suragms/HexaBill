/*
Purpose: Payments controller for payment tracking
Author: AI Assistant
Date: 2024
Updated: 2025 - Complete rewrite per spec for proper payment/invoice/balance tracking
*/
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Modules.Payments;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;
using HexaBill.Api.Modules.Customers;

namespace HexaBill.Api.Modules.Payments
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class PaymentsController : TenantScopedController // MULTI-TENANT: Owner-scoped payments
    {
        private readonly IPaymentService _paymentService;
        private readonly IPaymentReceiptService _receiptService;
        private readonly ILogger<PaymentsController> _logger;

        public PaymentsController(IPaymentService paymentService, IPaymentReceiptService receiptService, ILogger<PaymentsController> logger)
        {
            _paymentService = paymentService;
            _receiptService = receiptService;
            _logger = logger;
        }

        [HttpGet("duplicate-check")]
        public async Task<ActionResult<ApiResponse<object>>> CheckDuplicatePayment(
            [FromQuery] int customerId,
            [FromQuery] decimal amount,
            [FromQuery] string paymentDate)
        {
            try
            {
                if (customerId <= 0 || amount <= 0 || string.IsNullOrWhiteSpace(paymentDate))
                {
                    return Ok(new ApiResponse<object> { Success = true, Data = new { hasDuplicate = false } });
                }
                if (!DateTime.TryParse(paymentDate, out var date))
                {
                    return Ok(new ApiResponse<object> { Success = true, Data = new { hasDuplicate = false } });
                }
                var tenantId = CurrentTenantId;
                var hasDuplicate = await _paymentService.CheckDuplicatePaymentAsync(tenantId, customerId, amount, date);
                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Data = new { hasDuplicate }
                });
            }
            catch (Exception ex)
            {
                // Fail open: return hasDuplicate=false so payment flow can proceed (Render/DB transient errors)
                Console.WriteLine($"⚠️ Duplicate-check failed (proceeding): {ex.Message}");
                return Ok(new ApiResponse<object> { Success = true, Data = new { hasDuplicate = false } });
            }
        }

        [HttpGet]
        public async Task<ActionResult<ApiResponse<PagedResponse<PaymentDto>>>> GetPayments(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.GetPaymentsAsync(tenantId, page, pageSize);
                return Ok(new ApiResponse<PagedResponse<PaymentDto>>
                {
                    Success = true,
                    Message = "Payments retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PagedResponse<PaymentDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<ApiResponse<PaymentDto>>> GetPayment(int id)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.GetPaymentByIdAsync(id, tenantId);
                if (result == null)
                {
                    return NotFound(new ApiResponse<PaymentDto>
                    {
                        Success = false,
                        Message = "Payment not found"
                    });
                }

                return Ok(new ApiResponse<PaymentDto>
                {
                    Success = true,
                    Message = "Payment retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PaymentDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost]
        public async Task<ActionResult<ApiResponse<CreatePaymentResponse>>> CreatePayment(
            [FromBody] CreatePaymentRequest request,
            [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey = null)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier) 
                    ?? User.FindFirst("UserId") 
                    ?? User.FindFirst("sub");
                
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<CreatePaymentResponse>
                    {
                        Success = false,
                        Message = "Invalid user authentication"
                    });
                }

                // Generate idempotency key if not provided (for safety)
                if (string.IsNullOrEmpty(idempotencyKey))
                {
                    idempotencyKey = Guid.NewGuid().ToString();
                }

                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.CreatePaymentAsync(request, userId, tenantId, idempotencyKey);
                return CreatedAtAction(nameof(GetPayment), new { id = result.Payment.Id }, new ApiResponse<CreatePaymentResponse>
                {
                    Success = true,
                    Message = "Payment created successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<CreatePaymentResponse>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
            catch (InvalidOperationException ex)
            {
                // Handle concurrency conflicts and validation errors
                if (ex.Message.Contains("modified by another user") || ex.Message.Contains("CONFLICT"))
                {
                    return StatusCode(409, new ApiResponse<CreatePaymentResponse>
                    {
                        Success = false,
                        Message = ex.Message
                    });
                }
                return BadRequest(new ApiResponse<CreatePaymentResponse>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<CreatePaymentResponse>
                {
                    Success = false,
                    Message = "An error occurred while creating payment",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPut("{id}/status")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<object>>> UpdatePaymentStatus(int id, [FromBody] PaymentStatusRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)
                    ?? User.FindFirst("UserId")
                    ?? User.FindFirst("sub");
                
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                if (!Enum.TryParse<PaymentStatus>(request.Status, out var status))
                {
                    return BadRequest(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid payment status. Must be PENDING, CLEARED, RETURNED, or VOID"
                    });
                }

                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.UpdatePaymentStatusAsync(id, status, userId, tenantId);
                if (!result)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Payment not found"
                    });
                }

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = $"Payment status updated to {request.Status}"
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("customers/{customerId}/outstanding-invoices")]
        public async Task<ActionResult<ApiResponse<List<Models.OutstandingInvoiceDto>>>> GetOutstandingInvoices(int customerId)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.GetOutstandingInvoicesAsync(customerId, tenantId);
                return Ok(new ApiResponse<List<Models.OutstandingInvoiceDto>>
                {
                    Success = true,
                    Message = "Outstanding invoices retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<OutstandingInvoiceDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("invoices/{invoiceId}/amount")]
        public async Task<ActionResult<ApiResponse<InvoiceAmountDto>>> GetInvoiceAmount(int invoiceId)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.GetInvoiceAmountAsync(invoiceId, tenantId);
                return Ok(new ApiResponse<InvoiceAmountDto>
                {
                    Success = true,
                    Message = "Invoice amount retrieved successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return NotFound(new ApiResponse<InvoiceAmountDto>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<InvoiceAmountDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("allocate")]
        public async Task<ActionResult<ApiResponse<CreatePaymentResponse>>> AllocatePayment(
            [FromBody] AllocatePaymentRequest request,
            [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey = null)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier) 
                    ?? User.FindFirst("UserId") 
                    ?? User.FindFirst("sub");
                
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<CreatePaymentResponse>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                // Generate idempotency key if not provided
                if (string.IsNullOrEmpty(idempotencyKey))
                {
                    idempotencyKey = Guid.NewGuid().ToString();
                }

                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.AllocatePaymentAsync(request, userId, tenantId, idempotencyKey);
                return Ok(new ApiResponse<CreatePaymentResponse>
                {
                    Success = true,
                    Message = "Payment allocated successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<CreatePaymentResponse>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<CreatePaymentResponse>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPut("{id}")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<PaymentDto>>> UpdatePayment(int id, [FromBody] UpdatePaymentRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)
                    ?? User.FindFirst("UserId")
                    ?? User.FindFirst("sub");
                
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<PaymentDto>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.UpdatePaymentAsync(id, request, userId, tenantId);
                if (result == null)
                {
                    return NotFound(new ApiResponse<PaymentDto>
                    {
                        Success = false,
                        Message = "Payment not found"
                    });
                }

                return Ok(new ApiResponse<PaymentDto>
                {
                    Success = true,
                    Message = "Payment updated successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PaymentDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpDelete("{id}")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<object>>> DeletePayment(int id)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)
                    ?? User.FindFirst("UserId")
                    ?? User.FindFirst("sub");
                
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _paymentService.DeletePaymentAsync(id, userId, tenantId);
                if (!result)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Payment not found"
                    });
                }

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = "Payment deleted successfully"
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>
        /// CRITICAL: Clean up duplicate payments for an invoice
        /// Keeps the first payment, deletes duplicates, fixes balances
        /// </summary>
        [HttpPost("cleanup-duplicates/{invoiceId}")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<DuplicateCleanupResult>>> CleanupDuplicatePayments(int invoiceId)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)
                    ?? User.FindFirst("UserId")
                    ?? User.FindFirst("sub");
                
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<DuplicateCleanupResult>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                var tenantId = CurrentTenantId;
                var context = HttpContext.RequestServices.GetRequiredService<HexaBill.Api.Data.AppDbContext>();
                
                // Get invoice
                var invoice = await context.Sales
                    .FirstOrDefaultAsync(s => s.Id == invoiceId && s.TenantId == tenantId && !s.IsDeleted);
                
                if (invoice == null)
                {
                    return NotFound(new ApiResponse<DuplicateCleanupResult>
                    {
                        Success = false,
                        Message = "Invoice not found"
                    });
                }
                
                // Get all payments for this invoice
                var payments = await context.Payments
                    .Where(p => p.SaleId == invoiceId && p.TenantId == tenantId && p.Status != PaymentStatus.VOID)
                    .OrderBy(p => p.CreatedAt)
                    .ToListAsync();
                
                var result = new DuplicateCleanupResult
                {
                    InvoiceNo = invoice.InvoiceNo,
                    InvoiceTotal = invoice.GrandTotal,
                    OriginalPaymentCount = payments.Count,
                    DeletedPayments = new List<DeletedPaymentInfo>()
                };
                
                // Group by amount to find duplicates
                var grouped = payments.GroupBy(p => p.Amount).ToList();
                var paymentsToDelete = new List<Payment>();
                
                foreach (var group in grouped)
                {
                    if (group.Count() > 1)
                    {
                        // Keep first, mark rest for deletion
                        var toDelete = group.Skip(1).ToList();
                        paymentsToDelete.AddRange(toDelete);
                        
                        foreach (var payment in toDelete)
                        {
                            result.DeletedPayments.Add(new DeletedPaymentInfo
                            {
                                PaymentId = payment.Id,
                                Amount = payment.Amount,
                                Mode = payment.Mode.ToString(),
                                CreatedAt = payment.CreatedAt
                            });
                        }
                    }
                }
                
                // Calculate what the new paid amount should be
                var keptPayments = payments.Except(paymentsToDelete).ToList();
                var newPaidAmount = keptPayments.Sum(p => p.Amount);
                
                // Delete duplicate payments
                foreach (var payment in paymentsToDelete)
                {
                    context.Payments.Remove(payment);
                }
                
                // Update invoice
                invoice.PaidAmount = newPaidAmount;
                invoice.PaymentStatus = newPaidAmount >= invoice.GrandTotal 
                    ? SalePaymentStatus.Paid 
                    : newPaidAmount > 0 
                        ? SalePaymentStatus.Partial 
                        : SalePaymentStatus.Pending;
                
                result.NewPaymentCount = keptPayments.Count;
                result.NewPaidAmount = newPaidAmount;
                result.NewStatus = invoice.PaymentStatus.ToString();
                
                // Create audit log
                var auditLog = new AuditLog
                {
                    UserId = userId,
                    Action = "Duplicate Payments Cleanup",
                    Details = System.Text.Json.JsonSerializer.Serialize(result),
                    CreatedAt = DateTime.UtcNow
                };
                context.AuditLogs.Add(auditLog);
                
                await context.SaveChangesAsync();
                
                // Recalculate customer balance
                if (invoice.CustomerId.HasValue)
                {
                    var customerService = HttpContext.RequestServices.GetRequiredService<ICustomerService>();
                    await customerService.RecalculateCustomerBalanceAsync(invoice.CustomerId.Value, tenantId);
                }
                
                return Ok(new ApiResponse<DuplicateCleanupResult>
                {
                    Success = true,
                    Message = $"Cleanup complete: Deleted {result.DeletedPayments.Count} duplicate payment(s). Invoice {invoice.InvoiceNo} now shows {newPaidAmount:F2} AED paid.",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"\u274c CleanupDuplicatePayments Error: {ex.Message}");
                return StatusCode(500, new ApiResponse<DuplicateCleanupResult>
                {
                    Success = false,
                    Message = $"An error occurred: {ex.Message}",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("{paymentId}/receipt")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<ActionResult<ApiResponse<object>>> GeneratePaymentReceipt(int paymentId)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0) return Forbid();
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier) ?? User.FindFirst("UserId");
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId)) return Unauthorized(new ApiResponse<object> { Success = false, Message = "Invalid user" });
                var detail = await _receiptService.GenerateReceiptAsync(tenantId, paymentId, userId);
                var existing = await _receiptService.GetReceiptByPaymentIdAsync(paymentId, tenantId);
                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Data = new { detail, receiptNumber = detail.ReceiptNumber, receiptId = existing?.Id }
                });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new ApiResponse<object> { Success = false, Message = ex.Message });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<object> { Success = false, Message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Receipt generation failed for payment {PaymentId}: {Message}. Inner: {InnerMessage}", paymentId, ex.Message, ex.InnerException?.Message);
                return StatusCode(500, new ApiResponse<object> { Success = false, Message = "Receipt could not be loaded. Please try again or contact support." });
            }
        }

        [HttpPost("receipt/batch")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<ActionResult<ApiResponse<object>>> GeneratePaymentReceiptBatch([FromBody] PaymentReceiptBatchRequest request)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0) return Forbid();
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier) ?? User.FindFirst("UserId");
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId)) return Unauthorized(new ApiResponse<object> { Success = false, Message = "Invalid user" });
                if (request?.PaymentIds == null || !request.PaymentIds.Any()) return BadRequest(new ApiResponse<object> { Success = false, Message = "At least one payment must be selected to generate a receipt." });
                var (detail, receipts) = await _receiptService.GenerateBatchReceiptAsync(tenantId, request.PaymentIds, userId);
                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Data = new { detail, receipts }
                });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new ApiResponse<object> { Success = false, Message = ex.Message });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<object> { Success = false, Message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Batch receipt generation failed: {Message}. Inner: {InnerMessage}", ex.Message, ex.InnerException?.Message);
                return StatusCode(500, new ApiResponse<object> { Success = false, Message = "Receipt could not be loaded. Please try again or contact support." });
            }
        }

        [HttpGet("receipt/by-payment/{paymentId}")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<ActionResult<ApiResponse<PaymentReceiptDto>>> GetReceiptByPayment(int paymentId)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var rec = await _receiptService.GetReceiptByPaymentIdAsync(paymentId, tenantId);
                if (rec == null) return NotFound(new ApiResponse<PaymentReceiptDto> { Success = false, Message = "Receipt not found" });
                return Ok(new ApiResponse<PaymentReceiptDto> { Success = true, Data = rec });
            }
            catch { return StatusCode(500, new ApiResponse<PaymentReceiptDto> { Success = false, Message = "Error" }); }
        }

        [HttpGet("customers/{customerId}/receipts")]
        [Authorize(Roles = "Admin,Owner,Manager")]
        public async Task<ActionResult<ApiResponse<List<PaymentReceiptDto>>>> GetCustomerReceipts(int customerId)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var list = await _receiptService.GetReceiptsByCustomerAsync(customerId, tenantId);
                return Ok(new ApiResponse<List<PaymentReceiptDto>> { Success = true, Data = list });
            }
            catch { return StatusCode(500, new ApiResponse<List<PaymentReceiptDto>> { Success = false, Message = "Error" }); }
        }
    }

    public class PaymentStatusRequest
    {
        public string Status { get; set; } = string.Empty; // PENDING, CLEARED, RETURNED, VOID
    }
    
    public class DuplicateCleanupResult
    {
        public string InvoiceNo { get; set; } = "";
        public decimal InvoiceTotal { get; set; }
        public int OriginalPaymentCount { get; set; }
        public int NewPaymentCount { get; set; }
        public decimal NewPaidAmount { get; set; }
        public string NewStatus { get; set; } = "";
        public List<DeletedPaymentInfo> DeletedPayments { get; set; } = new();
    }
    
    public class DeletedPaymentInfo
    {
        public int PaymentId { get; set; }
        public decimal Amount { get; set; }
        public string Mode { get; set; } = "";
        public DateTime CreatedAt { get; set; }
    }
}
