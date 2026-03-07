/*
Purpose: Expenses controller for expense tracking
Author: AI Assistant
Date: 2024
*/
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using HexaBill.Api.Modules.Expenses;
using HexaBill.Api.Models;
using HexaBill.Api.Data;
using HexaBill.Api.Shared.Extensions;
using HexaBill.Api.Shared.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System.Security.Claims;
using System.IO;

namespace HexaBill.Api.Modules.Expenses
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ExpensesController : TenantScopedController // MULTI-TENANT: Owner-scoped expenses
    {
        private readonly IExpenseService _expenseService;
        private readonly AppDbContext _context;
        private readonly IRouteScopeService _routeScopeService;
        private readonly ILogger<ExpensesController> _logger;

        public ExpensesController(IExpenseService expenseService, AppDbContext context, IRouteScopeService routeScopeService, ILogger<ExpensesController> logger)
        {
            _expenseService = expenseService;
            _context = context;
            _routeScopeService = routeScopeService;
            _logger = logger;
        }

        [HttpGet]
        public async Task<ActionResult<ApiResponse<PagedResponse<ExpenseDto>>>> GetExpenses(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] string? category = null,
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] string? groupBy = null, // weekly, monthly, yearly
            [FromQuery] int? branchId = null)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                IReadOnlyList<int>? staffBranchIds = null;
                if (IsStaff && User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value is { } uidStr && int.TryParse(uidStr, out var uid))
                {
                    staffBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == uid).Select(bs => bs.BranchId).ToListAsync();
                }
                var result = await _expenseService.GetExpensesAsync(tenantId, page, pageSize, category, fromDate, toDate, groupBy, branchId, staffBranchIds);
                return Ok(new ApiResponse<PagedResponse<ExpenseDto>>
                {
                    Success = true,
                    Message = "Expenses retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<PagedResponse<ExpenseDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("export/csv")]
        [Authorize(Roles = "Admin,Owner,SystemAdmin")]
        public async Task<ActionResult> ExportExpensesCsv(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] string? category = null,
            [FromQuery] int? branchId = null)
        {
            try
            {
                var tenantId = CurrentTenantId;
                if (tenantId <= 0 && !IsSystemAdmin) return Forbid();
                IReadOnlyList<int>? staffBranchIds = null;
                if (IsStaff && User.FindFirst(ClaimTypes.NameIdentifier)?.Value is { } uidStr && int.TryParse(uidStr, out var uid))
                    staffBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == uid).Select(bs => bs.BranchId).ToListAsync();
                var result = await _expenseService.GetExpensesAsync(tenantId, 1, 10000, category, fromDate, toDate, null, branchId, staffBranchIds);
                var rows = new List<string> { "Date,Category,Amount,Note,Status,Branch" };
                foreach (var e in result.Items ?? new List<ExpenseDto>())
                {
                    var date = e.Date.ToString("yyyy-MM-dd");
                    var cat = EscapeCsv(e.CategoryName ?? "");
                    var note = EscapeCsv(e.Note ?? "");
                    var branch = EscapeCsv(e.BranchName ?? "");
                    var st = EscapeCsv(e.Status ?? "");
                    rows.Add($"{date},{cat},{e.Amount:F2},{note},{st},{branch}");
                }
                var csv = string.Join("\n", rows);
                var bytes = System.Text.Encoding.UTF8.GetBytes(csv);
                var fileName = $"expenses_{DateTime.UtcNow:yyyy-MM-dd}.csv";
                return File(bytes, "text/csv", fileName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Export expenses CSV failed");
                return StatusCode(500, new ApiResponse<object> { Success = false, Message = ex.Message });
            }
        }

        private static string EscapeCsv(string value)
        {
            if (string.IsNullOrEmpty(value)) return "";
            if (value.Contains(',') || value.Contains('"') || value.Contains('\n')) return "\"" + value.Replace("\"", "\"\"") + "\"";
            return value;
        }

        [HttpGet("aggregated")]
        public async Task<ActionResult<ApiResponse<List<ExpenseAggregateDto>>>> GetExpensesAggregated(
            [FromQuery] DateTime? fromDate = null,
            [FromQuery] DateTime? toDate = null,
            [FromQuery] string groupBy = "monthly") // weekly, monthly, yearly
        {
            try
            {
                var from = (fromDate ?? DateTime.UtcNow.AddMonths(-6)).ToUtcKind();
                var to = (toDate ?? DateTime.UtcNow).ToUtcKind();
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                IReadOnlyList<int>? staffBranchIds = null;
                if (IsStaff && User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value is { } uidStr && int.TryParse(uidStr, out var uid))
                {
                    staffBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == uid).Select(bs => bs.BranchId).ToListAsync();
                }
                var result = await _expenseService.GetExpensesAggregatedAsync(tenantId, from, to, groupBy, staffBranchIds);
                return Ok(new ApiResponse<List<ExpenseAggregateDto>>
                {
                    Success = true,
                    Message = "Aggregated expenses retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<List<ExpenseAggregateDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<ApiResponse<ExpenseDto>>> GetExpense(int id)
        {
            try
            {
                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                IReadOnlyList<int>? staffBranchIds = null;
                if (IsStaff && User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value is { } uidStr && int.TryParse(uidStr, out var uid))
                {
                    staffBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == uid).Select(bs => bs.BranchId).ToListAsync();
                }
                var result = await _expenseService.GetExpenseByIdAsync(id, tenantId, staffBranchIds);
                if (result == null)
                {
                    return NotFound(new ApiResponse<ExpenseDto>
                    {
                        Success = false,
                        Message = "Expense not found"
                    });
                }

                return Ok(new ApiResponse<ExpenseDto>
                {
                    Success = true,
                    Message = "Expense retrieved successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<ExpenseDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost]
        public async Task<ActionResult<ApiResponse<ExpenseDto>>> CreateExpense([FromBody] CreateExpenseRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<ExpenseDto>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                IReadOnlyList<int>? staffBranchIds = null;
                IReadOnlyList<int>? staffRouteIds = null;
                if (IsStaff)
                {
                    staffBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == userId).Select(bs => bs.BranchId).ToListAsync();
                    var role = User.FindFirst(ClaimTypes.Role)?.Value ?? "";
                    var routeIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userId, tenantId, role);
                    staffRouteIds = routeIds;
                }
                var result = await _expenseService.CreateExpenseAsync(request, userId, tenantId, staffBranchIds, staffRouteIds);
                return CreatedAtAction(nameof(GetExpense), new { id = result.Id }, new ApiResponse<ExpenseDto>
                {
                    Success = true,
                    Message = "Expense created successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<ExpenseDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPut("{id}")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<ExpenseDto>>> UpdateExpense(int id, [FromBody] CreateExpenseRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<ExpenseDto>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                IReadOnlyList<int>? staffBranchIds = null;
                IReadOnlyList<int>? staffRouteIds = null;
                if (IsStaff)
                {
                    staffBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == userId).Select(bs => bs.BranchId).ToListAsync();
                    var role = User.FindFirst(ClaimTypes.Role)?.Value ?? "";
                    var routeIds = await _routeScopeService.GetRestrictedRouteIdsAsync(userId, tenantId, role);
                    staffRouteIds = routeIds;
                }
                var result = await _expenseService.UpdateExpenseAsync(id, request, userId, tenantId, staffBranchIds, staffRouteIds);
                if (result == null)
                {
                    return NotFound(new ApiResponse<ExpenseDto>
                    {
                        Success = false,
                        Message = "Expense not found"
                    });
                }

                return Ok(new ApiResponse<ExpenseDto>
                {
                    Success = true,
                    Message = "Expense updated successfully",
                    Data = result
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<ExpenseDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpDelete("{id}")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<object>>> DeleteExpense(int id)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                var tenantId = CurrentTenantId; // CRITICAL: Multi-tenant data isolation
                var result = await _expenseService.DeleteExpenseAsync(id, userId, tenantId);
                if (!result)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Expense not found"
                    });
                }

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = "Expense deleted successfully"
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

        [HttpGet("categories")]
        public async Task<ActionResult<ApiResponse<List<ExpenseCategoryDto>>>> GetCategories()
        {
            try
            {
                var tenantId = CurrentTenantId;
                var categories = await _context.ExpenseCategories
                    .Where(c => c.TenantId == tenantId && c.IsActive)
                    .OrderBy(c => c.Name)
                    .Select(c => new ExpenseCategoryDto
                    {
                        Id = c.Id,
                        Name = c.Name,
                        ColorCode = c.ColorCode
                    })
                    .ToListAsync();

                return Ok(new ApiResponse<List<ExpenseCategoryDto>>
                {
                    Success = true,
                    Message = "Categories retrieved successfully",
                    Data = categories
                });
            }
            catch (Exception ex)
            {
                var msg = ex.Message ?? "";
                var isDbOrColumn = ex is Microsoft.EntityFrameworkCore.DbUpdateException
                    || msg.Contains("TenantId", StringComparison.OrdinalIgnoreCase)
                    || msg.Contains("column", StringComparison.OrdinalIgnoreCase);
                if (isDbOrColumn)
                {
                    _logger.LogWarning(ex, "GetCategories failed (possible missing TenantId column or migration); returning empty list");
                    return Ok(new ApiResponse<List<ExpenseCategoryDto>>
                    {
                        Success = true,
                        Message = "Categories could not be loaded. Ensure ExpenseCategories has TenantId (run migrations).",
                        Data = new List<ExpenseCategoryDto>()
                    });
                }
                return StatusCode(500, new ApiResponse<List<ExpenseCategoryDto>>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("categories")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<ExpenseCategoryDto>>> CreateCategory([FromBody] CreateExpenseCategoryRequest request)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(request.Name))
                {
                    return BadRequest(new ApiResponse<ExpenseCategoryDto>
                    {
                        Success = false,
                        Message = "Category name is required",
                        Errors = new List<string> { "Name cannot be empty" }
                    });
                }

                var tenantId = CurrentTenantId;
                // Check if category with same name already exists (per tenant)
                var existingCategory = await _context.ExpenseCategories
                    .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Name.ToLower() == request.Name.ToLower());
                
                if (existingCategory != null)
                {
                    return BadRequest(new ApiResponse<ExpenseCategoryDto>
                    {
                        Success = false,
                        Message = "Category already exists",
                        Errors = new List<string> { $"A category named '{request.Name}' already exists" }
                    });
                }

                // Validate color code
                var colorCode = request.ColorCode;
                if (string.IsNullOrWhiteSpace(colorCode) || !colorCode.StartsWith("#"))
                {
                    colorCode = "#3B82F6"; // Default blue
                }

                var category = new ExpenseCategory
                {
                    TenantId = tenantId,
                    Name = request.Name.Trim(),
                    ColorCode = colorCode,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };

                _context.ExpenseCategories.Add(category);
                await _context.SaveChangesAsync();

                var categoryDto = new ExpenseCategoryDto
                {
                    Id = category.Id,
                    Name = category.Name,
                    ColorCode = category.ColorCode
                };

                return Ok(new ApiResponse<ExpenseCategoryDto>
                {
                    Success = true,
                    Message = "Category created successfully",
                    Data = categoryDto
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating expense category: {Message}", ex.Message);
                return StatusCode(500, new ApiResponse<ExpenseCategoryDto>
                {
                    Success = false,
                    Message = "An error occurred while creating the category",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("{id}/attachment")]
        [RequestSizeLimit(10 * 1024 * 1024)] // 10 MB
        public async Task<ActionResult<ApiResponse<string>>> UploadAttachment(int id, IFormFile file)
        {
            try
            {
                if (file == null || file.Length == 0)
                {
                    return BadRequest(new ApiResponse<string>
                    {
                        Success = false,
                        Message = "No file uploaded"
                    });
                }

                var tenantId = CurrentTenantId;
                var expense = await _context.Expenses
                    .FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
                
                if (expense == null)
                {
                    return NotFound(new ApiResponse<string>
                    {
                        Success = false,
                        Message = "Expense not found"
                    });
                }

                // Validate file type
                var allowedExtensions = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".gif" };
                var fileExtension = Path.GetExtension(file.FileName).ToLowerInvariant();
                if (!allowedExtensions.Contains(fileExtension))
                {
                    return BadRequest(new ApiResponse<string>
                    {
                        Success = false,
                        Message = "Invalid file type. Allowed: PDF, JPG, PNG, GIF"
                    });
                }

                // Create uploads directory if it doesn't exist
                var uploadsDir = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "expenses");
                if (!Directory.Exists(uploadsDir))
                {
                    Directory.CreateDirectory(uploadsDir);
                }

                // Generate unique filename
                var fileName = $"expense_{id}_{Guid.NewGuid()}{fileExtension}";
                var filePath = Path.Combine(uploadsDir, fileName);

                // Save file
                using (var stream = new FileStream(filePath, FileMode.Create))
                {
                    await file.CopyToAsync(stream);
                }

                // Update expense with attachment URL
                expense.AttachmentUrl = $"expenses/{fileName}";
                await _context.SaveChangesAsync();

                return Ok(new ApiResponse<string>
                {
                    Success = true,
                    Message = "Attachment uploaded successfully",
                    Data = expense.AttachmentUrl
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<string>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }

        [HttpPost("{id}/approve")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<object>>> ApproveExpense(int id)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                var tenantId = CurrentTenantId;
                var expense = await _context.Expenses
                    .FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
                
                if (expense == null)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Expense not found"
                    });
                }

                expense.Status = ExpenseStatus.Approved;
                expense.ApprovedBy = userId;
                expense.ApprovedAt = DateTime.UtcNow;
                expense.RejectionReason = null;
                await _context.SaveChangesAsync();

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = "Expense approved successfully"
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

        [HttpPost("{id}/reject")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<object>>> RejectExpense(int id, [FromBody] ApproveExpenseRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                var tenantId = CurrentTenantId;
                var expense = await _context.Expenses
                    .FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
                
                if (expense == null)
                {
                    return NotFound(new ApiResponse<object>
                    {
                        Success = false,
                        Message = "Expense not found"
                    });
                }

                expense.Status = ExpenseStatus.Rejected;
                expense.ApprovedBy = userId;
                expense.ApprovedAt = DateTime.UtcNow;
                expense.RejectionReason = request.RejectionReason;
                await _context.SaveChangesAsync();

                return Ok(new ApiResponse<object>
                {
                    Success = true,
                    Message = "Expense rejected successfully"
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

        [HttpGet("recurring")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<List<RecurringExpenseDto>>>> GetRecurringExpenses()
        {
            try
            {
                var tenantId = CurrentTenantId;
                var recurring = await _context.RecurringExpenses
                    .Where(r => r.TenantId == tenantId)
                    .Include(r => r.Category)
                    .Include(r => r.Branch)
                    .Select(r => new RecurringExpenseDto
                    {
                        Id = r.Id,
                        BranchId = r.BranchId,
                        BranchName = r.Branch != null ? r.Branch.Name : null,
                        CategoryId = r.CategoryId,
                        CategoryName = r.Category != null ? r.Category.Name : "",
                        Amount = r.Amount,
                        Note = r.Note,
                        Frequency = r.Frequency.ToString(),
                        DayOfRecurrence = r.DayOfRecurrence,
                        StartDate = r.StartDate,
                        EndDate = r.EndDate,
                        IsActive = r.IsActive,
                        CreatedAt = r.CreatedAt
                    })
                    .OrderByDescending(r => r.CreatedAt)
                    .ToListAsync();

                return Ok(new ApiResponse<List<RecurringExpenseDto>>
                {
                    Success = true,
                    Message = "Recurring expenses retrieved successfully",
                    Data = recurring
                });
            }
            catch (Exception ex)
            {
                // PRODUCTION: Return empty list instead of 500 when RecurringExpenses table does not exist (42P01). Do not log 42P01 to avoid ERROR noise.
                var msg = ex.Message ?? "";
                if (!msg.Contains("42P01") && !msg.Contains("RecurringExpenses") && !msg.Contains("does not exist"))
                    _logger.LogWarning("GetRecurringExpenses returning empty list after error: {Message}", msg);
                return Ok(new ApiResponse<List<RecurringExpenseDto>>
                {
                    Success = true,
                    Data = new List<RecurringExpenseDto>()
                });
            }
        }

        [HttpPost("recurring")]
        [Authorize(Roles = "Admin,Owner")]
        public async Task<ActionResult<ApiResponse<RecurringExpenseDto>>> CreateRecurringExpense([FromBody] CreateRecurringExpenseRequest request)
        {
            try
            {
                var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier);
                if (userIdClaim == null || !int.TryParse(userIdClaim.Value, out int userId))
                {
                    return Unauthorized(new ApiResponse<RecurringExpenseDto>
                    {
                        Success = false,
                        Message = "Invalid user"
                    });
                }

                if (!Enum.TryParse<RecurrenceFrequency>(request.Frequency, out var frequency))
                {
                    return BadRequest(new ApiResponse<RecurringExpenseDto>
                    {
                        Success = false,
                        Message = "Invalid frequency. Must be Daily, Weekly, Monthly, or Yearly"
                    });
                }

                var tenantId = CurrentTenantId;
                var category = await _context.ExpenseCategories
                    .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.TenantId == tenantId);
                if (category == null)
                {
                    return BadRequest(new ApiResponse<RecurringExpenseDto>
                    {
                        Success = false,
                        Message = "Category not found"
                    });
                }

                var recurring = new RecurringExpense
                {
                    OwnerId = tenantId,
                    TenantId = tenantId,
                    BranchId = request.BranchId,
                    CategoryId = request.CategoryId ?? 0,
                    Amount = request.Amount,
                    Note = request.Note,
                    Frequency = frequency,
                    DayOfRecurrence = request.DayOfRecurrence,
                    StartDate = request.StartDate.HasValue ? request.StartDate.Value.ToUtcKind() : DateTime.UtcNow,
                    EndDate = request.EndDate.HasValue ? request.EndDate.Value.ToUtcKind() : (DateTime?)null,
                    IsActive = true,
                    CreatedBy = userId,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow
                };

                _context.RecurringExpenses.Add(recurring);
                await _context.SaveChangesAsync();

                await _context.Entry(recurring).Reference(r => r.Category).LoadAsync();
                await _context.Entry(recurring).Reference(r => r.Branch).LoadAsync();

                var dto = new RecurringExpenseDto
                {
                    Id = recurring.Id,
                    BranchId = recurring.BranchId,
                    BranchName = recurring.Branch?.Name,
                    CategoryId = recurring.CategoryId,
                    CategoryName = recurring.Category.Name,
                    Amount = recurring.Amount,
                    Note = recurring.Note,
                    Frequency = recurring.Frequency.ToString(),
                    DayOfRecurrence = recurring.DayOfRecurrence,
                    StartDate = recurring.StartDate,
                    EndDate = recurring.EndDate,
                    IsActive = recurring.IsActive,
                    CreatedAt = recurring.CreatedAt
                };

                return Ok(new ApiResponse<RecurringExpenseDto>
                {
                    Success = true,
                    Message = "Recurring expense created successfully",
                    Data = dto
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponse<RecurringExpenseDto>
                {
                    Success = false,
                    Message = "An error occurred",
                    Errors = new List<string> { ex.Message }
                });
            }
        }
    }

    // Request DTO for creating expense category
    public class CreateExpenseCategoryRequest
    {
        public string Name { get; set; } = string.Empty;
        public string ColorCode { get; set; } = "#3B82F6";
    }
}

