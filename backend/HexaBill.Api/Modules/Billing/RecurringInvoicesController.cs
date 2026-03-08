/*
Purpose: Recurring invoices API
Author: HexaBill
Date: 2025
*/
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;

namespace HexaBill.Api.Modules.Billing
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Admin,Owner")]
    public class RecurringInvoicesController : TenantScopedController
    {
        private readonly IRecurringInvoiceService _service;

        public RecurringInvoicesController(IRecurringInvoiceService service)
        {
            _service = service;
        }

        [HttpGet]
        public async Task<ActionResult<ApiResponse<List<RecurringInvoiceDto>>>> GetRecurringInvoices()
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0) return Forbid();
            var list = await _service.GetRecurringInvoicesAsync(tenantId);
            return Ok(new ApiResponse<List<RecurringInvoiceDto>>
            {
                Success = true,
                Data = list
            });
        }

        [HttpPost]
        public async Task<ActionResult<ApiResponse<RecurringInvoiceDto>>> CreateRecurringInvoice([FromBody] CreateRecurringInvoiceRequest request)
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0) return Forbid();
            var userId = int.TryParse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var uid) ? uid : 0;
            if (userId == 0) return Unauthorized();
            var result = await _service.CreateRecurringInvoiceAsync(request, userId, tenantId);
            if (result == null) return BadRequest(new ApiResponse<RecurringInvoiceDto> { Success = false, Message = "Failed to create" });
            return Ok(new ApiResponse<RecurringInvoiceDto> { Success = true, Data = result });
        }

        [HttpDelete("{id}")]
        public async Task<ActionResult<ApiResponse<bool>>> DeleteRecurringInvoice(int id)
        {
            var tenantId = CurrentTenantId;
            if (tenantId <= 0) return Forbid();
            var ok = await _service.DeleteRecurringInvoiceAsync(id, tenantId);
            if (!ok) return NotFound(new ApiResponse<bool> { Success = false, Message = "Not found" });
            return Ok(new ApiResponse<bool> { Success = true, Data = true });
        }
    }
}
