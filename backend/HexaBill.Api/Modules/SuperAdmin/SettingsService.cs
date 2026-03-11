/*
 * Settings Service - Owner-Specific Company Settings Management
 * Purpose: Allow each owner to configure their company details for invoices/statements
 * Author: AI Assistant
 * Date: 2024-12-24
 */

using HexaBill.Api.Data;
using HexaBill.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace HexaBill.Api.Modules.SuperAdmin
{
    public class LogoMetadata
    {
        public string LogoUrl { get; set; } = "";
        public DateTime? UploadedAt { get; set; }
        public double FileSizeKb { get; set; }
        public string OriginalName { get; set; } = "";
    }

    public interface ISettingsService
    {
        Task<Dictionary<string, string>> GetOwnerSettingsAsync(int tenantId);
        Task<bool> UpdateOwnerSettingAsync(int tenantId, string key, string value);
        Task<bool> UpdateOwnerSettingsBulkAsync(int tenantId, Dictionary<string, string> settings);
        Task<CompanySettings> GetCompanySettingsAsync(int tenantId);
        Task<LogoMetadata?> GetLogoMetadataAsync(int tenantId);
        Task ClearLogoAsync(int tenantId);
    }

    public class SettingsService : ISettingsService
    {
        private readonly AppDbContext _context;

        public SettingsService(AppDbContext context)
        {
            _context = context;
        }

        /// <summary>
        /// Get all settings for a specific owner/tenant.
        /// Settings table has composite PK (Key, OwnerId); we also store TenantId. Query by OwnerId or TenantId so legacy and new rows both work.
        /// ROBUST FIX: Check for Value column first, add if missing, then use raw SQL to avoid EF Core issues
        /// </summary>
        public async Task<Dictionary<string, string>> GetOwnerSettingsAsync(int tenantId)
        {
            // CRITICAL: Check if Value column exists BEFORE attempting EF Core query
            // This prevents EF Core from generating invalid SQL
            if (_context.Database.IsNpgsql())
            {
                var connection = _context.Database.GetDbConnection();
                var wasOpen = connection.State == System.Data.ConnectionState.Open;
                if (!wasOpen) await connection.OpenAsync();
                try
                {
                    // Check if Value column exists
                    using var checkCmd = connection.CreateCommand();
                    checkCmd.CommandText = @"
                        SELECT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_schema = 'public' 
                            AND table_name = 'Settings' 
                            AND column_name IN ('Value', 'value')
                        )";
                    bool hasValueColumn = false;
                    using (var checkReader = await checkCmd.ExecuteReaderAsync())
                    {
                        if (await checkReader.ReadAsync())
                        {
                            hasValueColumn = checkReader.GetBoolean(0);
                        }
                    }
                    
                    // If column doesn't exist, try to add it
                    if (!hasValueColumn)
                    {
                        try
                        {
                            using var addCmd = connection.CreateCommand();
                            addCmd.CommandText = @"ALTER TABLE ""Settings"" ADD COLUMN IF NOT EXISTS ""Value"" character varying(2000) NULL;";
                            await addCmd.ExecuteNonQueryAsync();
                            hasValueColumn = true; // Assume it was added successfully
                        }
                        catch (Exception addEx)
                        {
                            // Column may already exist or permission issue - continue with raw SQL
                        }
                    }
                    
                    // Always use raw SQL to avoid EF Core column name issues
                    string? valueColumnName = null;
                    using var findColumnCmd = connection.CreateCommand();
                    findColumnCmd.CommandText = @"
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_schema = 'public' 
                        AND table_name = 'Settings' 
                        AND column_name IN ('Value', 'value')
                        LIMIT 1";
                    using (var findReader = await findColumnCmd.ExecuteReaderAsync())
                    {
                        if (await findReader.ReadAsync())
                        {
                            valueColumnName = findReader.GetString(0);
                        }
                    }
                    
                    // Use raw SQL with correct column name
                    using var command = connection.CreateCommand();
                    if (!string.IsNullOrEmpty(valueColumnName))
                    {
                        var quotedColumn = valueColumnName == "Value" ? @"""Value""" : "value";
                        command.CommandText = $@"
                            SELECT ""Key"", {quotedColumn}
                            FROM ""Settings""
                            WHERE ""OwnerId"" = @tenantId OR ""TenantId"" = @tenantId";
                        var param = command.CreateParameter();
                        param.ParameterName = "@tenantId";
                        param.Value = tenantId;
                        command.Parameters.Add(param);

                        var settings = new Dictionary<string, string>();
                        using var reader = await command.ExecuteReaderAsync();
                        while (await reader.ReadAsync())
                        {
                            var key = reader.GetString(0);
                            var value = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
                            settings[key] = value;
                        }

                        if (settings.Any())
                        {
                            return settings;
                        }
                    }
                    
                    // No Value column or no settings found - return defaults
                    return GetDefaultSettings();
                }
                finally
                {
                    if (!wasOpen && connection.State == System.Data.ConnectionState.Open)
                        await connection.CloseAsync();
                }
            }
            
            // For non-PostgreSQL databases, use EF Core normally
            try
            {
                var list = await _context.Settings
                    .Where(s => s.OwnerId == tenantId || s.TenantId == tenantId)
                    .ToListAsync();

                var settings = list
                    .GroupBy(s => s.Key)
                    .ToDictionary(g => g.Key, g => g.OrderByDescending(s => s.OwnerId == tenantId).First().Value ?? string.Empty);

                return settings.Any() ? settings : GetDefaultSettings();
            }
            catch (Exception ex)
            {
                return GetDefaultSettings();
            }
        }

        /// <summary>
        /// Update a single setting. Table PK is (Key, OwnerId). Find by OwnerId first, then TenantId; when adding use OwnerId = tenantId.
        /// </summary>
        public async Task<bool> UpdateOwnerSettingAsync(int tenantId, string key, string value)
        {
            try
            {
                var setting = await _context.Settings
                    .FirstOrDefaultAsync(s => s.Key == key && s.OwnerId == tenantId);
                if (setting == null)
                    setting = await _context.Settings
                        .FirstOrDefaultAsync(s => s.Key == key && s.TenantId == tenantId);

                if (setting != null)
                {
                    setting.Value = value;
                    setting.UpdatedAt = DateTime.UtcNow;
                }
                else
                {
                    _context.Settings.Add(new Setting
                    {
                        Key = key,
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        Value = value,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow
                    });
                }

                await _context.SaveChangesAsync();
                return true;
            }
            catch (Exception ex)
            {
                return false;
            }
        }

        /// <summary>
        /// Update multiple settings in bulk. PK is (Key, OwnerId). Find by OwnerId then TenantId; when adding set OwnerId = tenantId to avoid duplicate key.
        /// </summary>
        public async Task<bool> UpdateOwnerSettingsBulkAsync(int tenantId, Dictionary<string, string> settings)
        {
            if (settings == null || settings.Count == 0)
                return true;

            foreach (var kvp in settings)
            {
                var key = kvp.Key?.Trim();
                if (string.IsNullOrEmpty(key) || key.Length > 100)
                    continue;

                var setting = await _context.Settings
                    .FirstOrDefaultAsync(s => s.Key == key && s.OwnerId == tenantId);
                if (setting == null)
                    setting = await _context.Settings
                        .FirstOrDefaultAsync(s => s.Key == key && s.TenantId == tenantId);

                var value = kvp.Value ?? string.Empty;

                if (setting != null)
                {
                    setting.Value = value;
                    setting.UpdatedAt = DateTime.UtcNow;
                }
                else
                {
                    _context.Settings.Add(new Setting
                    {
                        Key = key,
                        OwnerId = tenantId,
                        TenantId = tenantId,
                        Value = value,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow
                    });
                }
            }

            await _context.SaveChangesAsync();
            return true;
        }

        /// <summary>
        /// Get company settings as CompanySettings object for invoice generation
        /// </summary>
        public async Task<CompanySettings> GetCompanySettingsAsync(int tenantId)
        {
            var settingsDict = await GetOwnerSettingsAsync(tenantId);
            

            return new CompanySettings
            {
                LegalNameEn = settingsDict.GetValueOrDefault("COMPANY_NAME_EN", "HexaBill"),
                LegalNameAr = settingsDict.GetValueOrDefault("COMPANY_NAME_AR", "فروزن ماجيك لتجارة العامة - ذ.م.م - ش.ش.و"),
                VatNumber = settingsDict.GetValueOrDefault("COMPANY_TRN", "105274438800003"),
                Address = settingsDict.GetValueOrDefault("COMPANY_ADDRESS", "Abu Dhabi, United Arab Emirates"),
                Mobile = settingsDict.GetValueOrDefault("COMPANY_PHONE", "+971 56 955 22 52"),
                VatEffectiveDate = settingsDict.GetValueOrDefault("VAT_EFFECTIVE_DATE", "01-01-2026"),
                VatLegalText = settingsDict.GetValueOrDefault("VAT_LEGAL_TEXT", "VAT registered under Federal Decree-Law No. 8 of 2017, UAE"),
                Currency = settingsDict.GetValueOrDefault("CURRENCY", "AED"),
                VatPercent = decimal.TryParse(settingsDict.GetValueOrDefault("VAT_PERCENT", "5"), out var vat) ? vat : 5.0m,
                InvoicePrefix = settingsDict.GetValueOrDefault("INVOICE_PREFIX", "FM"),
                LogoPath = settingsDict.GetValueOrDefault("LOGO_PUBLIC_URL", settingsDict.GetValueOrDefault("COMPANY_LOGO", settingsDict.GetValueOrDefault("LOGO_PATH", "/uploads/logo.png"))),
                LogoStorageKey = GetLogoStorageKeyForInvoice(settingsDict)
            };
        }

        /// <summary>Resolve logo storage key for PDF: prefer LOGO_STORAGE_KEY; fallback to key derived from COMPANY_LOGO when it looks like a storage path (so invoice header shows uploaded logo).</summary>
        private static string? GetLogoStorageKeyForInvoice(Dictionary<string, string> settingsDict)
        {
            if (settingsDict.TryGetValue("LOGO_STORAGE_KEY", out var keyVal) && !string.IsNullOrWhiteSpace(keyVal))
                return keyVal;
            var companyLogo = settingsDict.GetValueOrDefault("COMPANY_LOGO", settingsDict.GetValueOrDefault("LOGO_PUBLIC_URL", ""));
            if (string.IsNullOrWhiteSpace(companyLogo) || !companyLogo.Contains("tenants/", StringComparison.OrdinalIgnoreCase) || !companyLogo.Contains("logos/", StringComparison.OrdinalIgnoreCase))
                return null;
            var idx = companyLogo.IndexOf("tenants/", StringComparison.OrdinalIgnoreCase);
            return companyLogo.Substring(idx).Split('?')[0].Trim();
        }

        /// <summary>Get logo metadata for GET /api/settings/logo or GET /api/Admin/logo.</summary>
        public async Task<LogoMetadata?> GetLogoMetadataAsync(int tenantId)
        {
            var dict = await GetOwnerSettingsAsync(tenantId);
            var url = dict.GetValueOrDefault("LOGO_PUBLIC_URL", dict.GetValueOrDefault("COMPANY_LOGO", ""));
            if (string.IsNullOrWhiteSpace(url)) return null;
            var bytesStr = dict.GetValueOrDefault("LOGO_FILE_SIZE_BYTES", "");
            var fileSizeKb = double.TryParse(bytesStr, out var b) ? Math.Round(b / 1024.0, 2) : 0;
            var uploadedAt = dict.GetValueOrDefault("LOGO_UPLOADED_AT", "");
            DateTime? dt = DateTime.TryParse(uploadedAt, out var parsed) ? parsed : null;
            return new LogoMetadata
            {
                LogoUrl = url,
                UploadedAt = dt,
                FileSizeKb = fileSizeKb,
                OriginalName = dict.GetValueOrDefault("LOGO_ORIGINAL_NAME", "")
            };
        }

        /// <summary>Clear logo settings. Does NOT delete files from storage.</summary>
        public async Task ClearLogoAsync(int tenantId)
        {
            var keys = new[] { "LOGO_STORAGE_KEY", "LOGO_PUBLIC_URL", "LOGO_ORIGINAL_NAME", "LOGO_MIME_TYPE", "LOGO_FILE_SIZE_BYTES", "LOGO_UPLOADED_AT", "LOGO_UPLOADED_BY_USER_ID", "COMPANY_LOGO", "LOGO_PATH" };
            foreach (var key in keys)
            {
                var setting = await _context.Settings
                    .FirstOrDefaultAsync(s => s.Key == key && (s.OwnerId == tenantId || s.TenantId == tenantId));
                if (setting != null)
                {
                    setting.Value = "";
                    setting.UpdatedAt = DateTime.UtcNow;
                }
            }
            await _context.SaveChangesAsync();
        }

        /// <summary>
        /// Get default settings template
        /// </summary>
        private Dictionary<string, string> GetDefaultSettings()
        {
            return new Dictionary<string, string>
            {
                { "COMPANY_NAME_EN", "HexaBill" },
                { "COMPANY_NAME_AR", "فروزن ماجيك لتجارة العامة - ذ.م.م - ش.ش.و" },
                { "COMPANY_TRN", "105274438800003" },
                { "COMPANY_ADDRESS", "Abu Dhabi, United Arab Emirates" },
                { "COMPANY_PHONE", "+971 56 955 22 52" },
                { "VAT_PERCENT", "5" },
                { "CURRENCY", "AED" },
                { "INVOICE_PREFIX", "FM" },
                { "VAT_EFFECTIVE_DATE", "01-01-2026" },
                { "VAT_LEGAL_TEXT", "VAT registered under Federal Decree-Law No. 8 of 2017, UAE" },
                { "LOGO_PATH", "/uploads/logo.png" },
                { "LOW_STOCK_GLOBAL_THRESHOLD", "" } // Optional: alert when stock <= this for products with ReorderLevel 0 (#55)
            };
        }
    }
}
