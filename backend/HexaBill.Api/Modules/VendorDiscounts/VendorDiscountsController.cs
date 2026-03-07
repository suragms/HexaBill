/*
Purpose: Vendor Discounts API – Owner/Admin only; data is private and NOT used in ledger or reports.
Author: HexaBill
Date: 2025
*/
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using HexaBill.Api.Models;

namespace HexaBill.Api.Modules.VendorDiscounts
{
    [ApiController]
    [Route("api/suppliers/{supplierId:int}/vendor-discounts")]
    [Authorize(Roles = "Owner,Admin")]
    public class VendorDiscountsController : HexaBill.Api.Shared.Extensions.TenantScopedController
    {
        private readonly IVendorDiscountService _service;

        public VendorDiscountsController(IVendorDiscountService service)
        {
            _service = service;
        }

        /// <summary>Get all vendor discounts for the supplier and total savings. Owner/Admin only.</summary>
        [HttpGet]
        public async Task<ActionResult<ApiResponse<VendorDiscountListWithTotalDto>>> GetVendorDiscounts(int supplierId)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return Forbid();

                var result = await _service.GetSupplierDiscountsWithTotalAsync(supplierId, tenantId);
                return Ok(new ApiResponse<VendorDiscountListWithTotalDto>
                {
                    Success = true,
                    Message = "Vendor discounts retrieved successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<VendorDiscountListWithTotalDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<VendorDiscountListWithTotalDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>Get a single vendor discount by id. Owner/Admin only.</summary>
        [HttpGet("{id:int}")]
        public async Task<ActionResult<ApiResponse<VendorDiscountDto>>> GetVendorDiscount(int supplierId, int id)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return Forbid();

                var result = await _service.GetByIdAsync(id, supplierId, tenantId);
                if (result == null)
                    return NotFound(new ApiResponse<VendorDiscountDto> { Success = false, Message = "Vendor discount not found." });

                return Ok(new ApiResponse<VendorDiscountDto>
                {
                    Success = true,
                    Message = "Vendor discount retrieved successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<VendorDiscountDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>Create a new vendor discount. Owner/Admin only.</summary>
        [HttpPost]
        public async Task<ActionResult<ApiResponse<VendorDiscountDto>>> CreateVendorDiscount(int supplierId, [FromBody] CreateOrUpdateVendorDiscountRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out int userId))
                    return Unauthorized(new ApiResponse<VendorDiscountDto> { Success = false, Message = "Invalid user." });

                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return Forbid();

                if (request == null)
                    return BadRequest(new ApiResponse<VendorDiscountDto> { Success = false, Message = "Request body is required." });

                var result = await _service.CreateVendorDiscountAsync(supplierId, request, userId, tenantId);
                return CreatedAtAction(nameof(GetVendorDiscount), new { supplierId, id = result.Id }, new ApiResponse<VendorDiscountDto>
                {
                    Success = true,
                    Message = "Vendor discount created successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<VendorDiscountDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<VendorDiscountDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>Update an existing vendor discount. Owner/Admin only.</summary>
        [HttpPut("{id:int}")]
        public async Task<ActionResult<ApiResponse<VendorDiscountDto>>> UpdateVendorDiscount(int supplierId, int id, [FromBody] CreateOrUpdateVendorDiscountRequest request)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return Forbid();

                if (request == null)
                    return BadRequest(new ApiResponse<VendorDiscountDto> { Success = false, Message = "Request body is required." });

                var result = await _service.UpdateVendorDiscountAsync(id, supplierId, request, tenantId);
                if (result == null)
                    return NotFound(new ApiResponse<VendorDiscountDto> { Success = false, Message = "Vendor discount not found." });

                return Ok(new ApiResponse<VendorDiscountDto>
                {
                    Success = true,
                    Message = "Vendor discount updated successfully",
                    Data = result
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<VendorDiscountDto>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<VendorDiscountDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        /// <summary>Soft-delete a vendor discount. Owner/Admin only.</summary>
        [HttpDelete("{id:int}")]
        public async Task<ActionResult<ApiResponse<object>>> DeleteVendorDiscount(int supplierId, int id)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0)
                    return Forbid();

                var deleted = await _service.DeleteVendorDiscountAsync(id, supplierId, tenantId);
                if (!deleted)
                    return NotFound(new ApiResponse<object> { Success = false, Message = "Vendor discount not found." });

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = "Vendor discount deleted successfully"
                });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new ApiResponse<object>
                {
                    Success = false,
                    Message = ex.Message,
                    Errors = new List<string> { ex.Message }
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
    }
}
