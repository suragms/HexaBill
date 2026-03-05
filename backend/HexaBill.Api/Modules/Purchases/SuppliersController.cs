/*
Purpose: Suppliers controller for supplier ledger
Author: AI Assistant
Date: 2025
*/
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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

        [HttpGet("search")]
        public async Task<ActionResult<ApiResponse<List<SupplierSearchDto>>>> Search([FromQuery] string? q = null, [FromQuery] int limit = 20)
        {
            try
            {
                var tenantId = CurrentTenantId;
                var result = await _supplierService.SearchAsync(tenantId, q, limit);
                return Ok(new ApiResponse<List<SupplierSearchDto>>
                {
                    Success = true,
                    Message = "Suppliers search completed",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<SupplierSearchDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
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
    }
}

