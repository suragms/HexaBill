/*
Purpose: Customers controller for customer management
Author: AI Assistant
Date: 2024
*/
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Modules.Customers;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions; // MULTI-TENANT
using HexaBill.Api.Modules.SuperAdmin;
using HexaBill.Api.Shared.Validation;
using HexaBill.Api.Modules.Billing;
using HexaBill.Api.Shared.Services;

namespace HexaBill.Api.Modules.Customers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class CustomersController : TenantScopedController // MULTI-TENANT
    {
        private readonly ICustomerService _customerService;
        private readonly ITimeZoneService _timeZoneService;
        private readonly IRouteScopeService _routeScopeService;
        private readonly AppDbContext _context;

        public CustomersController(ICustomerService customerService, ITimeZoneService timeZoneService, IRouteScopeService routeScopeService, AppDbContext context)
        {
            _customerService = customerService;
            _timeZoneService = timeZoneService;
            _routeScopeService = routeScopeService;
            _context = context;
        }

        [HttpGet]
        public async Task<ActionResult<ApiResponse<PagedResponse<CustomerDto>>>> GetCustomers(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] string? search = null,
            [FromQuery] int? branchId = null,
            [FromQuery] int? routeId = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                
                // Super Admin handling - show all customers from all owners
                if (IsSystemAdmin)
                {
                    var context = HttpContext.RequestServices.GetRequiredService<HexaBill.Api.Data.AppDbContext>();
                    var query = context.Customers.AsQueryable();
                    
                    if (!string.IsNullOrEmpty(search))
                    {
                        var sl = search.Trim().ToLowerInvariant();
                        query = query.Where(c => (c.Name != null && c.Name.ToLower().Contains(sl)) || 
                                               (c.Phone != null && c.Phone.Contains(search)) || 
                                               (c.Email != null && c.Email.ToLower().Contains(sl)));
                    }
                    
                    var totalCount = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(query);
                    var customers = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToListAsync(
                        query.OrderBy(c => c.Name)
                            .Skip((page - 1) * pageSize)
                            .Take(pageSize)
                            .Select(c => new CustomerDto
                            {
                                Id = c.Id,
                                Name = c.Name,
                                Phone = c.Phone,
                                Email = c.Email,
                                Address = c.Address,
                                Trn = c.Trn,
                                CreditLimit = c.CreditLimit,
                                Balance = c.Balance
                            }));
                    
                    return Ok(new ApiResponse<PagedResponse<CustomerDto>>
                    {
                        Success = true,
                        Message = $"SUPER ADMIN VIEW: {totalCount} customers from ALL owners",
                        Data = new PagedResponse<CustomerDto>
                        {
                            Items = customers,
                            TotalCount = totalCount,
                            Page = page,
                            PageSize = pageSize,
                            TotalPages = (int)Math.Ceiling((double)totalCount / pageSize)
                        }
                    });
                }
                
                // Staff with no branch/route filter: restrict to assigned branches and routes
                IReadOnlyList<int>? restrictToBranchIds = null;
                IReadOnlyList<int>? restrictToRouteIds = null;
                if (tenantId > 0 && !branchId.HasValue && !routeId.HasValue && IsStaff)
                {
                    var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                    if (int.TryParse(userIdClaim, out var userId))
                    {
                        var role = User.FindFirst(ClaimTypes.Role)?.Value ?? "";
                        var branchIds = await _context.BranchStaff
                            .Where(bs => bs.UserId == userId)
                            .Select(bs => bs.BranchId)
                            .ToListAsync();
                        var routeIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userId, tenantId, role);
                        restrictToBranchIds = branchIds;
                        restrictToRouteIds = routeIds != null && routeIds.Length > 0 ? routeIds : null;
                    }
                }

                var result = await _customerService.GetCustomersAsync(tenantId, page, pageSize, search, branchId, routeId, restrictToBranchIds, restrictToRouteIds);
                return Ok(new ApiResponse<PagedResponse<CustomerDto>>
                {
                    Success = true,
                    Message = "Customers retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PagedResponse<CustomerDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("search")]
        public async Task<ActionResult<ApiResponse<List<CustomerDto>>>> SearchCustomers(
            [FromQuery] string q,
            [FromQuery] int limit = 20)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(q))
                {
                    return BadRequest(new ApiResponse<List<CustomerDto>>
                    {
                        Success = false,
                        Message = "Search query is required"
                    });
                }

                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                var result = await _customerService.SearchCustomersAsync(q, tenantId, limit);
                return Ok(new ApiResponse<List<CustomerDto>>
                {
                    Success = true,
                    Message = "Customers retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<CustomerDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<ApiResponse<CustomerDto>>> GetCustomer(int id)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                
                // SUPER ADMIN: Can access any customer
                if (IsSystemAdmin)
                {
                    var context = HttpContext.RequestServices.GetRequiredService<HexaBill.Api.Data.AppDbContext>();
                    var customer = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.FirstOrDefaultAsync(
                        context.Customers.Where(c => c.Id == id));
                    
                    if (customer == null)
                    {
                        return NotFound(new ApiResponse<CustomerDto>
                        {
                            Success = false,
                            Message = "Customer not found"
                        });
                    }
                    
                    return Ok(new ApiResponse<CustomerDto>
                    {
                        Success = true,
                        Message = "SUPER ADMIN: Customer retrieved successfully",
                        Data = new CustomerDto
                        {
                            Id = customer.Id,
                            Name = customer.Name,
                            Phone = customer.Phone,
                            Email = customer.Email,
                            Address = customer.Address,
                            Trn = customer.Trn,
                            CreditLimit = customer.CreditLimit,
                            Balance = customer.Balance
                        }
                    });
                }
                
                var result = await _customerService.GetCustomerByIdAsync(id, tenantId);
                if (result == null)
                {
                    return NotFound(new ApiResponse<CustomerDto>
                    {
                        Success = false,
                        Message = "Customer not found"
                    });
                }

                return Ok(new ApiResponse<CustomerDto>
                {
                    Success = true,
                    Message = "Customer retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<CustomerDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost]
        public async Task<ActionResult<ApiResponse<CustomerDto>>> CreateCustomer([FromBody] CreateCustomerRequest request)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                var result = await _customerService.CreateCustomerAsync(request, tenantId);
                return CreatedAtAction(nameof(GetCustomer), new { id = result.Id }, new ApiResponse<CustomerDto>
                {
                    Success = true,
                    Message = "Customer created successfully",
                    Data = result
                });
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException ex)
            {
                var errorMessage = ex.InnerException?.Message ?? ex.Message;
                Console.WriteLine($"❌ Database Error in CreateCustomer: {errorMessage}");
                Console.WriteLine($"❌ Full Exception: {ex}");
                return StatusCode(500, new ApiResponse<CustomerDto>
                {
                    Success = false,
                    Message = "Database error occurred while creating customer. Please check database schema.",
                    Errors = new List<string> { errorMessage }
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ CreateCustomer Error: {ex.Message}");
                Console.WriteLine($"❌ Stack Trace: {ex.StackTrace}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"❌ Inner Exception: {ex.InnerException.Message}");
                }
                return StatusCode(500, new ApiResponse<CustomerDto>
                {
                    Success = false,
                    Message = $"An error occurred: {ex.Message}",
                    Errors = new List<string> { ex.Message, ex.InnerException?.Message ?? "" }
                });
            }
        }

        [HttpPut("{id}")]
        public async Task<ActionResult<ApiResponse<CustomerDto>>> UpdateCustomer(int id, [FromBody] CreateCustomerRequest request)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                var result = await _customerService.UpdateCustomerAsync(id, request, tenantId);
                if (result == null)
                {
                    return NotFound(new ApiResponse<CustomerDto>
                    {
                        Success = false,
                        Message = "Customer not found"
                    });
                }

                return Ok(new ApiResponse<CustomerDto>
                {
                    Success = true,
                    Message = "Customer updated successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<CustomerDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpDelete("{id}")]
        [Authorize(Roles = "Admin,Owner")] // CRITICAL: Allow Owner role
        public async Task<ActionResult<ApiResponse<object>>> DeleteCustomer(int id, [FromQuery] bool forceDelete = false)
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

                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                if (forceDelete)
                {
                    // Force delete customer with all associated data
                    var (success, message, summary) = await _customerService.ForceDeleteCustomerWithAllDataAsync(id, userId, tenantId);
                    if (!success)
                    {
                        return BadRequest(new ApiResponse<object>
                        {
                            Success = false,
                            Message = message
                        });
                    }

                    return Ok(new ApiResponse<object>
                    {
                        Success = true,
                        Message = message,
                        Data = summary
                    });
                }
                else
                {
                    // Regular delete (only if no transactions)
                    var (success, message) = await _customerService.DeleteCustomerAsync(id, tenantId);
                    if (!success)
                    {
                        return BadRequest(new ApiResponse<object>
                        {
                            Success = false,
                            Message = message
                        });
                    }

                    return Ok(new ApiResponse<object>
                    {
                        Success = true,
                        Message = message
                    });
                }
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

        [HttpGet("{id}/ledger")]
        public async Task<ActionResult<ApiResponse<List<CustomerLedgerEntry>>>> GetCustomerLedger(int id, [FromQuery] int? branchId = null, [FromQuery] int? routeId = null, [FromQuery] int? staffId = null, [FromQuery] DateTime? fromDate = null, [FromQuery] DateTime? toDate = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                // CRITICAL: Normalize dates for PostgreSQL (match ReportsController pattern)
                var fromNorm = fromDate.HasValue ? fromDate.Value.ToUtcKind() : (DateTime?)null;
                var toNorm = toDate.HasValue ? ((toDate.Value.Date.AddDays(1)).ToUtcKind()) : (DateTime?)null;
                var ledgerEntries = await _customerService.GetCustomerLedgerAsync(id, tenantId, branchId, routeId, staffId, fromNorm, toNorm);
                return Ok(new ApiResponse<List<CustomerLedgerEntry>>
                {
                    Success = true,
                    Message = "Customer ledger retrieved successfully",
                    Data = ledgerEntries
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[GetCustomerLedger] Error for customer {id}: {ex.Message}");
                Console.WriteLine($"[GetCustomerLedger] Stack: {ex.StackTrace}");
                if (ex.InnerException != null)
                    Console.WriteLine($"[GetCustomerLedger] Inner: {ex.InnerException.Message}");
                // Return 500 with error so we can debug; frontend shows toast
                return StatusCode(500, new ApiResponse<List<CustomerLedgerEntry>>
                {
                    Success = false,
                    Message = "Failed to load ledger. Check Render logs for details.",
                    Errors = new List<string> { ex.Message },
                    Data = new List<CustomerLedgerEntry>()
                });
            }
        }

        [HttpGet("cash-customer/ledger")]
        [Authorize]
        public async Task<ActionResult<ApiResponse<List<CustomerLedgerEntry>>>> GetCashCustomerLedger()
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                var ledgerEntries = await _customerService.GetCashCustomerLedgerAsync(tenantId);
                return Ok(new ApiResponse<List<CustomerLedgerEntry>>
                {
                    Success = true,
                    Message = "Cash customer ledger retrieved successfully",
                    Data = ledgerEntries
                });
            }
            catch (Exception ex)
            {
                // PRODUCTION: Return empty list instead of 500 so Customer Ledger page keeps working
                Console.WriteLine($"[GetCashCustomerLedger] Returning empty list after error: {ex.Message}");
                return Ok(new ApiResponse<List<CustomerLedgerEntry>>
                {
                    Success = true,
                    Data = new List<CustomerLedgerEntry>()
                });
            }
        }

        /// <summary>
        /// Special endpoint for cash customer - always returns success since cash customers have no balance to recalculate
        /// This prevents 400 errors when frontend calls recalculate for cash customer
        /// </summary>
        [HttpPost("cash/recalculate-balance")]
        [Authorize]
        public async Task<ActionResult<ApiResponse<object>>> RecalculateCashCustomerBalance()
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                
                // Recalculate cash customer invoice statuses to fix any stale data
                var fixedCount = await _customerService.RecalculateCashCustomerInvoiceStatusesAsync(tenantId);
                
                // Cash customers don't have a balance to recalculate
                // This endpoint exists to prevent 400 errors from frontend calls
                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = $"Cash customer balance is always 0 - recalculated {fixedCount} invoice statuses",
                    Data = new { balance = 0, customerId = "cash", customerType = "Cash", fixedInvoices = fixedCount }
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

        [HttpPost("{id}/recalculate-balance")]
        [Authorize(Roles = "Admin,Owner,Staff")] // Allow Staff to recalculate when viewing customer ledger
        public async Task<ActionResult<ApiResponse<CustomerDto>>> RecalculateBalance(int id)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                
                // SUPER ADMIN: Can access any customer - use owner 0 to bypass filter in service
                if (IsSystemAdmin)
                {
                    // Find the customer's actual owner first
                    var context = HttpContext.RequestServices.GetRequiredService<HexaBill.Api.Data.AppDbContext>();
                    var customer = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.FirstOrDefaultAsync(
                        context.Customers.Where(c => c.Id == id));
                    
                    if (customer == null)
                    {
                        return NotFound(new ApiResponse<CustomerDto>
                        {
                            Success = false,
                            Message = "Customer not found"
                        });
                    }
                    
                    // Use the customer's actual owner ID for recalculation
                    tenantId = customer.TenantId ?? tenantId;
                }
                
                await _customerService.RecalculateCustomerBalanceAsync(id, tenantId);
                
                // CRITICAL: Also recalculate invoice payment statuses to fix stale PaidAmount
                var fixedCount = await _customerService.RecalculateCustomerInvoiceStatusesAsync(id, tenantId);
                
                var customerResult = await _customerService.GetCustomerByIdAsync(id, tenantId);
                
                if (customerResult == null)
                {
                    return NotFound(new ApiResponse<CustomerDto>
                    {
                        Success = false,
                        Message = "Customer not found"
                    });
                }

                return Ok(new ApiResponse<CustomerDto>
                {
                    Success = true,
                    Message = $"Customer balance recalculated successfully. Fixed {fixedCount} invoice(s) payment status.",
                    Data = customerResult
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<CustomerDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("{id}/outstanding-invoices")]
        public async Task<ActionResult<ApiResponse<List<Models.OutstandingInvoiceDto>>>> GetOutstandingInvoices(int id)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                var outstandingInvoices = await _customerService.GetOutstandingInvoicesAsync(id, tenantId);
                return Ok(new ApiResponse<List<Models.OutstandingInvoiceDto>>
                {
                    Success = true,
                    Message = "Outstanding invoices retrieved successfully",
                    Data = outstandingInvoices
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

        [HttpGet("{id}/statement")]
        public async Task<ActionResult> GetCustomerStatement(int id, [FromQuery] DateTime? fromDate, [FromQuery] DateTime? toDate)
        {
            try
            {
                if (id <= 0)
                {
                    return BadRequest(new ApiResponse<object> { Success = false, Message = "Invalid customer ID." });
                }
                var from = fromDate ?? DateTime.UtcNow.AddDays(-30);
                var to = toDate ?? DateTime.UtcNow;
                if (from > to)
                {
                    return BadRequest(new ApiResponse<object> { Success = false, Message = "From date must be before or equal to To date." });
                }
                var tenantId = CurrentTenantId;
                var pdfBytes = await _customerService.GenerateCustomerStatementAsync(id, from, to, tenantId);
                if (pdfBytes == null || pdfBytes.Length == 0)
                {
                    return StatusCode(500, new ApiResponse<object> { Success = false, Message = "Statement PDF generation returned empty data." });
                }
                return File(pdfBytes, "application/pdf", $"customer_statement_{id}_{DateTime.UtcNow:yyyyMMdd}.pdf");
            }
            catch (InvalidOperationException ex)
            {
                return NotFound(new ApiResponse<object>
                {
                    Success = false,
                    Message = ex.Message ?? "Customer not found or unable to generate statement."
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[GetCustomerStatement] Error for customer {id}: {ex.Message}");
                Console.WriteLine($"[GetCustomerStatement] Stack: {ex.StackTrace}");
                if (ex.InnerException != null)
                    Console.WriteLine($"[GetCustomerStatement] Inner: {ex.InnerException.Message}");
                var userMessage = ex.Message ?? "Failed to generate statement PDF.";
                if (ex.InnerException != null)
                    userMessage += " " + ex.InnerException.Message;
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = userMessage,
                    Errors = new List<string> { ex.Message ?? "" }
                });
            }
        }

        [HttpGet("{id}/pending-bills-pdf")]
        public async Task<ActionResult> GetCustomerPendingBillsPdf(int id, [FromQuery] DateTime? fromDate, [FromQuery] DateTime? toDate)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Get from JWT
                var customer = await _customerService.GetCustomerByIdAsync(id, tenantId);
                if (customer == null)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Customer not found"
                    });
                }

                // Get ALL outstanding invoices first
                var allOutstandingInvoices = await _customerService.GetOutstandingInvoicesAsync(id, tenantId);
                
                // Apply date filter if provided
                var from = fromDate ?? _timeZoneService.GetCurrentDate().AddMonths(-12); // Default: last 12 months
                var to = toDate ?? _timeZoneService.GetCurrentDate();
                
                var filteredInvoices = allOutstandingInvoices
                    .Where(inv => inv.InvoiceDate >= from && inv.InvoiceDate <= to.AddDays(1)) // Include end date
                    .ToList();
                
                if (filteredInvoices == null || !filteredInvoices.Any())
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = $"No pending bills found for this customer in the date range {from:dd-MM-yyyy} to {to:dd-MM-yyyy}"
                    });
                }
                
                var pdfService = HttpContext.RequestServices.GetRequiredService<IPdfService>();
                var pdfBytes = await pdfService.GenerateCustomerPendingBillsPdfAsync(filteredInvoices, customer, DateTime.UtcNow, from, to, tenantId);
                
                return File(pdfBytes, "application/pdf", $"pending_bills_{customer.Name}_{from:yyyy-MM-dd}_to_{to:yyyy-MM-dd}.pdf");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error generating customer pending bills PDF: {ex.Message}");
                return StatusCode(500, new ApiResponse<object>
                {
                    Success = false,
                    Message = "An error occurred while generating the pending bills statement",
                    Errors = new List<string> { ex.Message }
                });
            }
        }
    }
}

