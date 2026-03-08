/*
Purpose: Suppliers controller for supplier ledger
Author: AI Assistant
Date: 2025
*/
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Modules.Purchases;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;

namespace HexaBill.Api.Modules.Purchases
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class SuppliersController : TenantScopedController // MULTI-TENANT: Owner-scoped suppliers
    {
        private readonly ISupplierService _supplierService;

        public SuppliersController(ISupplierService supplierService)
        {
            _supplierService = supplierService;
        }

        [HttpGet("balance/{supplierName}")]
        public async Task<ActionResult<ApiResponse<SupplierBalanceDto>>> GetSupplierBalance(string supplierName)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _supplierService.GetSupplierBalanceAsync(tenantId, supplierName);
                return Ok(new ApiResponse<SupplierBalanceDto>
                {
                    Success = true,
                    Message = "Supplier balance retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<SupplierBalanceDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("transactions/{supplierName}")]
        public async Task<ActionResult<ApiResponse<List<SupplierTransactionDto>>>> GetSupplierTransactions(
            string supplierName,
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _supplierService.GetSupplierTransactionsAsync(tenantId, supplierName, fromDate, toDate);
                return Ok(new ApiResponse<List<SupplierTransactionDto>>
                {
                    Success = true,
                    Message = "Supplier transactions retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<SupplierTransactionDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("summary")]
        public async Task<ActionResult<ApiResponse<List<SupplierSummaryDto>>>> GetAllSuppliersSummary()
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _supplierService.GetAllSuppliersSummaryAsync(tenantId);
                return Ok(new ApiResponse<List<SupplierSummaryDto>>
                {
                    Success = true,
                    Message = "Suppliers summary retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<SupplierSummaryDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("search")]
        public async Task<ActionResult<ApiResponse<List<string>>>> SearchSuppliers([FromQuery] string q, [FromQuery] int limit = 20)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var result = await _supplierService.SearchSupplierNamesAsync(tenantId, q ?? "", limit);
                return Ok(new ApiResponse<List<string>>
                {
                    Success = true,
                    Message = "Suppliers search completed",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<string>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>Create a new supplier (name, phone, email, address, credit limit, payment terms).</summary>
        [HttpPost]
        public async Task<ActionResult<ApiResponse<SupplierDto>>> CreateSupplier([FromBody] CreateSupplierRequest request)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return Forbid();
                if (request == null)
                    return BadRequest(new ApiResponse<SupplierDto> { Success = false, Message = "Request body is required." });
                if (string.IsNullOrWhiteSpace(request.Name))
                    return BadRequest(new ApiResponse<SupplierDto> { Success = false, Message = "Supplier name is required." });
                var result = await _supplierService.CreateSupplierAsync(tenantId, request);
                return Ok(new ApiResponse<SupplierDto>
                {
                    Success = true,
                    Message = "Supplier created successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<SupplierDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (DbUpdateException ex)
            {
                var inner = ex.InnerException?.Message ?? ex.Message;
                if (inner.Contains("duplicate") || inner.Contains("unique") || inner.Contains("IX_Suppliers"))
                    return BadRequest(new ApiResponse<SupplierDto> { Success = false, Message = "A supplier with this name already exists.", Errors = new List<string> { inner } });
                return BadRequest(new ApiResponse<SupplierDto> { Success = false, Message = inner, Errors = new List<string> { inner } });
            }
            catch (Exception ex)
            {
                var msg = ex.InnerException?.Message ?? ex.Message;
                return StatusCode(500, new ApiResponse<SupplierDto>
                {
                    Success = false,
                    Message = msg,
                    Errors = new List<string> { msg }
                });
            }
        }

        /// <summary>Get a single supplier by name (for edit form).</summary>
        [HttpGet("by-name/{supplierName}")]
        public async Task<ActionResult<ApiResponse<SupplierDto>>> GetSupplierByName(string supplierName)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var name = Uri.UnescapeDataString(supplierName ?? "");
                var result = await _supplierService.GetSupplierByNameAsync(tenantId, name);
                if (result == null)
                    return NotFound(new ApiResponse<SupplierDto> { Success = false, Message = "Supplier not found." });
                return Ok(new ApiResponse<SupplierDto>
                {
                    Success = true,
                    Message = "Supplier retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<SupplierDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>Update supplier (Owner/Admin only).</summary>
        [HttpPut("{supplierName}")]
        public async Task<ActionResult<ApiResponse<SupplierDto>>> UpdateSupplier(string supplierName, [FromBody] UpdateSupplierRequest request)
        {
            if (!IsAdmin)
                return Forbid();
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return Forbid();
                var name = Uri.UnescapeDataString(supplierName ?? "");
                if (string.IsNullOrWhiteSpace(name))
                    return BadRequest(new ApiResponse<SupplierDto> { Success = false, Message = "Supplier name is required." });
                if (request == null)
                    return BadRequest(new ApiResponse<SupplierDto> { Success = false, Message = "Request body is required." });
                var result = await _supplierService.UpdateSupplierAsync(tenantId, name, request);
                return Ok(new ApiResponse<SupplierDto>
                {
                    Success = true,
                    Message = "Supplier updated successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<SupplierDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Exception ex)
            {
                var msg = ex.InnerException?.Message ?? ex.Message;
                return StatusCode(500, new ApiResponse<SupplierDto>
                {
                    Success = false,
                    Message = msg,
                    Errors = new List<string> { msg }
                });
            }
        }

        /// <summary>Soft-delete supplier (Owner/Admin only). Existing purchases remain.</summary>
        [HttpDelete("{supplierName}")]
        public async Task<ActionResult<ApiResponse<object>>> DeleteSupplier(string supplierName)
        {
            if (!IsAdmin)
                return Forbid();
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return Forbid();
                var name = Uri.UnescapeDataString(supplierName ?? "");
                if (string.IsNullOrWhiteSpace(name))
                    return BadRequest(new ApiResponse<object> { Success = false, Message = "Supplier name is required." });
                await _supplierService.DeleteSupplierAsync(tenantId, name);
                return NoContent();
            }
            catch (ArgumentException ex)
            {
                return NotFound(new ApiResponse<object>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Exception ex)
            {
                var msg = ex.InnerException?.Message ?? ex.Message;
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = msg,
                    Errors = new List<string> { msg }
                });
            }
        }

        [HttpPost("{supplierName}/payments")]
        [Authorize(Roles = "Admin,Owner,SystemAdmin")]
        public async Task<ActionResult<ApiResponse<SupplierPaymentDto>>> RecordPayment(
            string supplierName,
            [FromBody] RecordSupplierPaymentRequest request)
        {
            try
            {
                if (request == null || request.Amount <= 0)
                {
                    return BadRequest(new ApiResponse<SupplierPaymentDto>
                    {
                        Success = false,
                        Message = "Amount must be positive."
                    });
                }

                var tenantId = CurrentTenantId;
                var userIdClaim = User.FindFirst("UserId") ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier) ?? User.FindFirst("id");
                var userId = int.TryParse(userIdClaim?.Value ?? "0", out var uid) ? uid : 1;

                var result = await _supplierService.CreateSupplierPaymentAsync(
                    tenantId,
                    Uri.UnescapeDataString(supplierName),
                    request.Amount,
                    request.PaymentDate,
                    request.Mode,
                    request.Reference,
                    request.Notes,
                    userId);

                return Ok(new ApiResponse<SupplierPaymentDto>
                {
                    Success = true,
                    Message = "Payment recorded successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<SupplierPaymentDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<SupplierPaymentDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>Create a ledger credit (e.g. vendor discount) for the supplier; reduces outstanding.</summary>
        [HttpPost("{supplierName}/ledger-credits")]
        [Authorize(Roles = "Admin,Owner,SystemAdmin")]
        public async Task<ActionResult<ApiResponse<SupplierLedgerCreditDto>>> CreateLedgerCredit(
            string supplierName,
            [FromBody] CreateLedgerCreditRequest request)
        {
            try
            {
                if (request == null || request.Amount <= 0)
                    return BadRequest(new ApiResponse<SupplierLedgerCreditDto> { Success = false, Message = "Amount must be positive." });
                if (string.IsNullOrWhiteSpace(request.CreditType))
                    return BadRequest(new ApiResponse<SupplierLedgerCreditDto> { Success = false, Message = "Credit type is required (e.g. Cash Discount, Promotional)." });

                var tenantId = CurrentTenantId;
                var userIdClaim = User.FindFirst("UserId") ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier) ?? User.FindFirst("id");
                var userId = int.TryParse(userIdClaim?.Value ?? "0", out var uid) ? uid : 1;

                var result = await _supplierService.CreateLedgerCreditAsync(
                    tenantId,
                    Uri.UnescapeDataString(supplierName),
                    request.Amount,
                    request.CreditDate,
                    request.CreditType,
                    request.Notes,
                    userId);

                return Ok(new ApiResponse<SupplierLedgerCreditDto>
                {
                    Success = true,
                    Message = "Ledger credit created successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<SupplierLedgerCreditDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<SupplierLedgerCreditDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPut("{supplierName}/payments/{paymentId:int}")]
        [Authorize(Roles = "Admin,Owner,SystemAdmin")]
        public async Task<ActionResult<ApiResponse<SupplierPaymentDto>>> UpdatePayment(string supplierName, int paymentId, [FromBody] RecordSupplierPaymentRequest request)
        {
            try
            {
                if (request == null || request.Amount <= 0)
                    return BadRequest(new ApiResponse<SupplierPaymentDto> { Success = false, Message = "Amount must be positive." });
                var tenantId = CurrentTenantId;
                var result = await _supplierService.UpdateSupplierPaymentAsync(tenantId, paymentId, request.Amount, request.PaymentDate, request.Mode, request.Reference, request.Notes);
                if (result == null)
                    return NotFound(new ApiResponse<SupplierPaymentDto> { Success = false, Message = "Payment not found." });
                return Ok(new ApiResponse<SupplierPaymentDto> { Success = true, Message = "Payment updated.", Data = result });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<SupplierPaymentDto> { Success = false, Message = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<SupplierPaymentDto> { Success = false, Message = ex.Message });
            }
        }

        [HttpDelete("{supplierName}/payments/{paymentId:int}")]
        [Authorize(Roles = "Admin,Owner,SystemAdmin")]
        public async Task<ActionResult<ApiResponse<object>>> DeletePayment(string supplierName, int paymentId)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var deleted = await _supplierService.DeleteSupplierPaymentAsync(tenantId, paymentId);
                if (!deleted)
                    return NotFound(new ApiResponse<object> { Success = false, Message = "Payment not found." });
                return Ok(new ApiResponse<object> { Success = true, Message = "Payment deleted." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<object> { Success = false, Message = ex.Message });
            }
        }
    }

    public class RecordSupplierPaymentRequest
    {
        public decimal Amount { get; set; }
        public DateTime PaymentDate { get; set; }
        public SupplierPaymentMode Mode { get; set; }
        public string? Reference { get; set; }
        public string? Notes { get; set; }
    }

    public class CreateLedgerCreditRequest
    {
        public decimal Amount { get; set; }
        public DateTime CreditDate { get; set; }
        public string CreditType { get; set; } = string.Empty; // e.g. Cash Discount, Promotional, Negotiated, Free Products
        public string? Notes { get; set; }
    }
}

