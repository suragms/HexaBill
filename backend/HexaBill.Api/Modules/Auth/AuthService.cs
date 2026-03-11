/*
Purpose: Authentication service for user login and JWT token management
Author: AI Assistant
Date: 2024
*/
using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using Microsoft.AspNetCore.Http;
using Npgsql;

namespace HexaBill.Api.Modules.Auth
{
    public interface IAuthService
    {
        Task<LoginResponse?> LoginAsync(LoginRequest request);
        Task<RegisterResponse> RegisterAsync(RegisterRequest request, int createdByUserId, int tenantId);
        Task<bool> ValidateTokenAsync(string token);
        Task<User?> GetUserByIdAsync(int userId);
        Task<UserProfileDto?> UpdateProfileAsync(int userId, UpdateProfileRequest request);
        Task<UserProfileDto?> SetProfilePhotoAsync(int userId, string profilePhotoUrl);
        Task<bool> ChangePasswordAsync(int userId, string currentPassword, string newPassword);
        Task<(List<int> BranchIds, List<int> RouteIds)> GetUserAssignmentsAsync(int userId);
    }

    public class UserProfileDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public string Role { get; set; } = string.Empty;
        public int tenantId { get; set; }
        public string? DashboardPermissions { get; set; }
        public DateTime CreatedAt { get; set; }
        public string? ProfilePhotoUrl { get; set; }
        public string? LanguagePreference { get; set; }
    }

    public class UpdateProfileRequest
    {
        public string Name { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public string? LanguagePreference { get; set; }
    }

    public class AuthService : IAuthService
    {
        private readonly AppDbContext _context;
        private readonly IConfiguration _configuration;
        private readonly IHttpContextAccessor? _httpContextAccessor;

        public AuthService(AppDbContext context, IConfiguration configuration, IHttpContextAccessor? httpContextAccessor = null)
        {
            _context = context;
            _configuration = configuration;
            _httpContextAccessor = httpContextAccessor;
        }

        public async Task<LoginResponse?> LoginAsync(LoginRequest request)
        {
            // Normalize email to lowercase for case-insensitive comparison
            var normalizedEmail = request.Email?.Trim().ToLowerInvariant() ?? string.Empty;
            var password = request.Password?.Trim() ?? string.Empty;

            if (string.IsNullOrEmpty(normalizedEmail) || string.IsNullOrEmpty(password))
            {
                return null;
            }

            // Single indexed query by email (no full table scan). Uses exact match so DB index is used.
            // Emails are stored normalized (lowercase, trimmed) on register; existing users may need to use lowercase to login.
            // Do not use AsNoTracking: we update LastLoginAt and TenantId and call SaveChangesAsync.
            var user = await _context.Users
                .FirstOrDefaultAsync(u => u.Email == normalizedEmail);

            if (user == null)
            {
                return null;
            }

            // Block login if tenant is suspended (optional: load tenant; skip if tenant not found)
            try
            {
                var tenantId = user.TenantId ?? 0;
                if (tenantId > 0)
                {
                    var tenant = await _context.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId);
                    if (tenant != null && tenant.Status == TenantStatus.Suspended)
                    {
                        return null; // or throw with "Account suspended" - frontend will show invalid credentials
                    }
                }
            }
            catch { /* non-fatal */ }

            // Fix legacy users: if they have OwnerId but no TenantId, set TenantId = OwnerId so JWT and frontend get correct tenant
            if (!user.TenantId.HasValue && user.OwnerId.HasValue && user.OwnerId.Value > 0)
            {
                user.TenantId = user.OwnerId.Value;
                await _context.SaveChangesAsync();
            }

            // Verify password - with better error handling (use trimmed password)
            try
            {
                if (string.IsNullOrEmpty(user.PasswordHash))
                {
                    return null;
                }

                if (!BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
                {
                    return null;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Password verification error for {normalizedEmail}: {ex.Message}");
                return null;
            }

            // Update last login timestamp
            user.LastLoginAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            // Record session for "who is logged in" / session list
            try
            {
                var tenantId = user.TenantId ?? 0;
                string? userAgent = null;
                string? ipAddress = null;
                if (_httpContextAccessor?.HttpContext != null)
                {
                    userAgent = _httpContextAccessor.HttpContext.Request.Headers["User-Agent"].FirstOrDefault();
                    ipAddress = _httpContextAccessor.HttpContext.Connection.RemoteIpAddress?.ToString();
                }
                _context.UserSessions.Add(new UserSession
                {
                    UserId = user.Id,
                    TenantId = tenantId,
                    LoginAt = DateTime.UtcNow,
                    UserAgent = userAgent != null && userAgent.Length > 500 ? userAgent.Substring(0, 500) : userAgent,
                    IpAddress = ipAddress != null && ipAddress.Length > 45 ? ipAddress.Substring(0, 45) : ipAddress
                });
                await _context.SaveChangesAsync();
            }
            catch { /* session recording is optional */ }

            // Determine token expiry: 30 days if RememberMe, otherwise 8 hours.
            var expiryHours = request.RememberMe ? 24 * 30 : 8;
            var token = GenerateJwtToken(user, expiryHours);

            string companyName = "HexaBill";
            List<int> assignedBranchIds = new List<int>();
            List<int> assignedRouteIds = new List<int>();
            try
            {
                companyName = await GetCompanyNameAsync();
                assignedBranchIds = await _context.BranchStaff.Where(bs => bs.UserId == user.Id).Select(bs => bs.BranchId).ToListAsync();
                assignedRouteIds = await _context.RouteStaff.Where(rs => rs.UserId == user.Id).Select(rs => rs.RouteId).ToListAsync();
            }
            catch { /* do not fail login if Settings/BranchStaff/RouteStaff query fails (e.g. missing column) */ }

            return new LoginResponse
            {
                Token = token,
                Role = user.Role.ToString(),
                UserId = user.Id,
                Name = user.Name,
                CompanyName = companyName,
                DashboardPermissions = user.DashboardPermissions,
                PageAccess = user.PageAccess,
                ExpiresAt = DateTime.UtcNow.AddHours(expiryHours),
                TenantId = user.TenantId ?? 0,
                AssignedBranchIds = assignedBranchIds,
                AssignedRouteIds = assignedRouteIds
            };
        }

        public async Task<RegisterResponse> RegisterAsync(RegisterRequest request, int createdByUserId, int tenantId)
        {
            // Normalize email
            var normalizedEmail = request.Email?.Trim().ToLowerInvariant() ?? string.Empty;
            
            if (string.IsNullOrEmpty(normalizedEmail))
            {
                throw new InvalidOperationException("Email is required");
            }

            // Check if email already exists (single indexed query, no full table scan; exact match for index use)
            var existingUser = await _context.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Email == normalizedEmail);

            if (existingUser != null)
            {
                throw new InvalidOperationException("Email already exists");
            }

            // Validate role
            if (!Enum.TryParse<UserRole>(request.Role, out var role))
            {
                role = UserRole.Staff; // Default to Staff if invalid
            }

            // Hash password
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);

            // Create new user
            var user = new User
            {
                Name = request.Name.Trim(),
                Email = normalizedEmail,
                PasswordHash = passwordHash,
                Role = role,
                Phone = request.Phone?.Trim(),
                DashboardPermissions = request.DashboardPermissions,
                PageAccess = request.PageAccess,
                TenantId = tenantId,
                OwnerId = tenantId, // MIGRATION: Setting legacy OwnerId for compatibility
                CreatedAt = DateTime.UtcNow
            };

            _context.Users.Add(user);
            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException pgEx && pgEx.SqlState == "23505")
            {
                // BUG #8 FIX: Handle concurrent registration race condition (unique violation)
                // Two admins creating users with same email simultaneously both pass the check, then both try to insert
                throw new InvalidOperationException("Email already registered");
            }

            // Log action in audit log if AuditLogs table exists
            try
            {
                var creator = await _context.Users.FindAsync(createdByUserId);
                if (creator != null)
                {
                    var auditLog = new AuditLog
                    {
                        OwnerId = tenantId, // CRITICAL: Set legacy OwnerId
                        TenantId = tenantId, // CRITICAL: Set new TenantId
                        UserId = createdByUserId,
                        Action = "User Created",
                        Details = $"Created user: {user.Email} with role {user.Role}",
                        CreatedAt = DateTime.UtcNow
                    };
                    _context.AuditLogs.Add(auditLog);
                    await _context.SaveChangesAsync();
                }
            }
            catch
            {
                // Audit logging is optional, continue if it fails
            }

            return new RegisterResponse
            {
                UserId = user.Id,
                Email = user.Email,
                Name = user.Name,
                Role = user.Role.ToString(),
                Message = "User created successfully"
            };
        }

        private string GetJwtSecretKey()
        {
            return Environment.GetEnvironmentVariable("JWT_SECRET_KEY")
                ?? _configuration["JwtSettings:SecretKey"]
                ?? throw new InvalidOperationException("JWT SecretKey not configured. Set JwtSettings:SecretKey or JWT_SECRET_KEY.");
        }

        public Task<bool> ValidateTokenAsync(string token)
        {
            try
            {
                var tokenHandler = new JwtSecurityTokenHandler();
                var key = Encoding.UTF8.GetBytes(GetJwtSecretKey());
                
                tokenHandler.ValidateToken(token, new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(key),
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.Zero
                }, out SecurityToken validatedToken);

                return Task.FromResult(true);
            }
            catch
            {
                return Task.FromResult(false);
            }
        }

        public async Task<User?> GetUserByIdAsync(int userId)
        {
            return await _context.Users.FindAsync(userId);
        }

        public async Task<UserProfileDto?> UpdateProfileAsync(int userId, UpdateProfileRequest request)
        {
            var user = await _context.Users.FindAsync(userId);
            if (user == null)
            {
                return null;
            }

            // Update profile fields
            user.Name = request.Name.Trim();
            if (!string.IsNullOrEmpty(request.Phone))
            {
                user.Phone = request.Phone.Trim();
            }
            if (request.LanguagePreference != null)
            {
                user.LanguagePreference = request.LanguagePreference.Trim();
                if (string.IsNullOrEmpty(user.LanguagePreference))
                    user.LanguagePreference = null;
            }

            await _context.SaveChangesAsync();

            return new UserProfileDto
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                Phone = user.Phone,
                Role = user.Role.ToString(),
                tenantId = user.TenantId ?? 0,
                CreatedAt = user.CreatedAt,
                ProfilePhotoUrl = user.ProfilePhotoUrl,
                LanguagePreference = user.LanguagePreference
            };
        }

        public async Task<UserProfileDto?> SetProfilePhotoAsync(int userId, string profilePhotoUrl)
        {
            var user = await _context.Users.FindAsync(userId);
            if (user == null) return null;
            user.ProfilePhotoUrl = profilePhotoUrl;
            await _context.SaveChangesAsync();
            return new UserProfileDto
            {
                Id = user.Id,
                Name = user.Name,
                Email = user.Email,
                Phone = user.Phone,
                Role = user.Role.ToString(),
                tenantId = user.TenantId ?? 0,
                CreatedAt = user.CreatedAt,
                ProfilePhotoUrl = user.ProfilePhotoUrl,
                LanguagePreference = user.LanguagePreference
            };
        }

        public async Task<bool> ChangePasswordAsync(int userId, string currentPassword, string newPassword)
        {
            var user = await _context.Users.FindAsync(userId);
            if (user == null)
            {
                return false;
            }

            // Verify current password
            if (!BCrypt.Net.BCrypt.Verify(currentPassword, user.PasswordHash))
            {
                return false;
            }

            // Hash and update new password
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword);
            await _context.SaveChangesAsync();

            return true;
        }

        public async Task<(List<int> BranchIds, List<int> RouteIds)> GetUserAssignmentsAsync(int userId)
        {
            var branchIds = await _context.BranchStaff
                .Where(bs => bs.UserId == userId)
                .Select(bs => bs.BranchId)
                .ToListAsync();

            var routeIds = await _context.RouteStaff
                .Where(rs => rs.UserId == userId)
                .Select(rs => rs.RouteId)
                .ToListAsync();

            return (branchIds, routeIds);
        }

        private string GenerateJwtToken(User user, int? customExpiryHours = null)
        {
            var tokenHandler = new JwtSecurityTokenHandler();
            var key = Encoding.UTF8.GetBytes(GetJwtSecretKey());
            var jwtSettings = _configuration.GetSection("JwtSettings");
            var issuer = jwtSettings["Issuer"] ?? "HexaBill.Api";
            var audience = jwtSettings["Audience"] ?? "HexaBill.Api";
            var expiryHours = customExpiryHours ?? (int.TryParse(jwtSettings["ExpiryInHours"], out int hours) ? hours : 8);
            
            var roleValue = NormalizeRoleForPolicy(user.Role.ToString());
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim("UserId", user.Id.ToString()),
                new Claim(ClaimTypes.Email, user.Email),
                new Claim(ClaimTypes.Role, roleValue),
                new Claim(ClaimTypes.Name, user.Name),
                new Claim("owner_id", user.TenantId?.ToString() ?? "0"),
                new Claim("tenant_id", user.TenantId?.ToString() ?? "0"),
                new Claim("session_version", user.SessionVersion.ToString())
            };
            if (!user.TenantId.HasValue)
                claims.Add(new Claim(ClaimTypes.Role, "SystemAdmin"));
            var tokenDescriptor = new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(claims),
                Issuer = issuer,
                Audience = audience,
                Expires = DateTime.UtcNow.AddHours(expiryHours),
                SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature)
            };

            var token = tokenHandler.CreateToken(tokenDescriptor);
            return tokenHandler.WriteToken(token);
        }

        /// <summary>Normalize role string so [Authorize(Roles = "Admin,Owner,Manager")] matches (e.g. "manager" -> "Manager").</summary>
        private static string NormalizeRoleForPolicy(string? role)
        {
            if (string.IsNullOrWhiteSpace(role)) return "Staff";
            var r = role.Trim();
            if (r.Length == 0) return "Staff";
            return char.ToUpperInvariant(r[0]) + r.Substring(1).ToLowerInvariant();
        }

        private async Task<string> GetCompanyNameAsync()
        {
            var setting = await _context.Settings
                .FirstOrDefaultAsync(s => s.Key == "COMPANY_NAME_EN");
            
            return setting?.Value ?? "HexaBill";
        }
    }
}

