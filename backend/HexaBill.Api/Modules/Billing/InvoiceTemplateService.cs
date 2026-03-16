/*
Purpose: Invoice template service for managing dynamic invoice templates
Author: AI Assistant
Date: 2024
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using System.Text;
using System.Text.RegularExpressions;

namespace HexaBill.Api.Modules.Billing
{
    public interface IInvoiceTemplateService
    {
        Task<List<InvoiceTemplateDto>> GetTemplatesAsync(int tenantId);
        Task<InvoiceTemplateDto?> GetTemplateByIdAsync(int id, int tenantId);
        Task<InvoiceTemplateDto?> GetActiveTemplateAsync(int tenantId);
        Task<InvoiceTemplateDto> CreateTemplateAsync(CreateInvoiceTemplateRequest request, int userId, int tenantId);
        Task<InvoiceTemplateDto?> UpdateTemplateAsync(int id, UpdateInvoiceTemplateRequest request, int userId, int tenantId);
        Task<bool> ActivateTemplateAsync(int id, int userId, int tenantId);
        Task<bool> DeleteTemplateAsync(int id, int tenantId);
        Task<string> RenderTemplateAsync(int templateId, int tenantId, SaleDto sale, InvoiceTemplateService.CompanySettings settings);
        Task<string> RenderActiveTemplateAsync(int tenantId, SaleDto sale, InvoiceTemplateService.CompanySettings settings);
        Task<string> RenderTemplateHtmlAsync(string htmlTemplate, SaleDto sale, InvoiceTemplateService.CompanySettings settings);
    }

    public class InvoiceTemplateService : IInvoiceTemplateService
    {
        private readonly AppDbContext _context;

        public InvoiceTemplateService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<InvoiceTemplateDto>> GetTemplatesAsync(int tenantId)
        {
            return await _context.InvoiceTemplates
                .Where(t => t.TenantId == tenantId)
                .Include(t => t.CreatedByUser)
                .OrderByDescending(t => t.CreatedAt)
                .Select(t => new InvoiceTemplateDto
                {
                    Id = t.Id,
                    Name = t.Name,
                    Version = t.Version,
                    CreatedBy = t.CreatedBy,
                    CreatedByName = t.CreatedByUser.Name,
                    CreatedAt = t.CreatedAt,
                    UpdatedAt = t.UpdatedAt,
                    IsActive = t.IsActive,
                    Description = t.Description
                })
                .ToListAsync();
        }

        public async Task<InvoiceTemplateDto?> GetTemplateByIdAsync(int id, int tenantId)
        {
            var template = await _context.InvoiceTemplates
                .Where(t => t.TenantId == tenantId)
                .Include(t => t.CreatedByUser)
                .FirstOrDefaultAsync(t => t.Id == id);

            if (template == null) return null;

            return new InvoiceTemplateDto
            {
                Id = template.Id,
                Name = template.Name,
                Version = template.Version,
                CreatedBy = template.CreatedBy,
                CreatedByName = template.CreatedByUser.Name,
                CreatedAt = template.CreatedAt,
                UpdatedAt = template.UpdatedAt,
                IsActive = template.IsActive,
                Description = template.Description,
                HtmlCode = template.HtmlCode,
                CssCode = template.CssCode
            };
        }

        public async Task<InvoiceTemplateDto?> GetActiveTemplateAsync(int tenantId)
        {
            var template = await _context.InvoiceTemplates
                .Where(t => t.TenantId == tenantId)
                .Include(t => t.CreatedByUser)
                .FirstOrDefaultAsync(t => t.IsActive);

            if (template == null) return null;

            return new InvoiceTemplateDto
            {
                Id = template.Id,
                Name = template.Name,
                Version = template.Version,
                CreatedBy = template.CreatedBy,
                CreatedByName = template.CreatedByUser.Name,
                CreatedAt = template.CreatedAt,
                UpdatedAt = template.UpdatedAt,
                IsActive = template.IsActive,
                Description = template.Description,
                HtmlCode = template.HtmlCode,
                CssCode = template.CssCode
            };
        }

        public async Task<InvoiceTemplateDto> CreateTemplateAsync(CreateInvoiceTemplateRequest request, int userId, int tenantId)
        {
            // Deactivate all other templates for this tenant if this one should be active
            if (request.IsActive)
            {
                await _context.InvoiceTemplates
                    .Where(t => t.TenantId == tenantId && t.IsActive)
                    .ExecuteUpdateAsync(t => t.SetProperty(x => x.IsActive, false));
            }

            var template = new InvoiceTemplate
            {
                TenantId = tenantId,
                Name = request.Name,
                Version = request.Version ?? "1.0",
                HtmlCode = request.HtmlCode,
                CssCode = request.CssCode,
                IsActive = request.IsActive,
                Description = request.Description,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow
            };

            _context.InvoiceTemplates.Add(template);
            await _context.SaveChangesAsync();

            await _context.Entry(template).Reference(t => t.CreatedByUser).LoadAsync();

            return new InvoiceTemplateDto
            {
                Id = template.Id,
                Name = template.Name,
                Version = template.Version,
                CreatedBy = template.CreatedBy,
                CreatedByName = template.CreatedByUser.Name,
                CreatedAt = template.CreatedAt,
                UpdatedAt = template.UpdatedAt,
                IsActive = template.IsActive,
                Description = template.Description,
                HtmlCode = template.HtmlCode,
                CssCode = template.CssCode
            };
        }

        public async Task<InvoiceTemplateDto?> UpdateTemplateAsync(int id, UpdateInvoiceTemplateRequest request, int userId, int tenantId)
        {
            var template = await _context.InvoiceTemplates.FirstOrDefaultAsync(t => t.Id == id && t.TenantId == tenantId);
            if (template == null) return null;

            // Deactivate all other templates for this tenant if this one should be active
            if (request.IsActive.HasValue && request.IsActive.Value && !template.IsActive)
            {
                await _context.InvoiceTemplates
                    .Where(t => t.TenantId == tenantId && t.IsActive && t.Id != id)
                    .ExecuteUpdateAsync(t => t.SetProperty(x => x.IsActive, false));
            }

            if (!string.IsNullOrEmpty(request.Name))
                template.Name = request.Name;
            if (!string.IsNullOrEmpty(request.Version))
                template.Version = request.Version;
            if (!string.IsNullOrEmpty(request.HtmlCode))
                template.HtmlCode = request.HtmlCode;
            if (request.CssCode != null)
                template.CssCode = request.CssCode;
            if (request.IsActive.HasValue)
                template.IsActive = request.IsActive.Value;
            if (request.Description != null)
                template.Description = request.Description;

            template.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();
            await _context.Entry(template).Reference(t => t.CreatedByUser).LoadAsync();

            return new InvoiceTemplateDto
            {
                Id = template.Id,
                Name = template.Name,
                Version = template.Version,
                CreatedBy = template.CreatedBy,
                CreatedByName = template.CreatedByUser.Name,
                CreatedAt = template.CreatedAt,
                UpdatedAt = template.UpdatedAt,
                IsActive = template.IsActive,
                Description = template.Description,
                HtmlCode = template.HtmlCode,
                CssCode = template.CssCode
            };
        }

        public async Task<bool> ActivateTemplateAsync(int id, int userId, int tenantId)
        {
            var template = await _context.InvoiceTemplates.FirstOrDefaultAsync(t => t.Id == id && t.TenantId == tenantId);
            if (template == null) return false;

            // Deactivate all other templates for this tenant
            await _context.InvoiceTemplates
                .Where(t => t.TenantId == tenantId && t.IsActive && t.Id != id)
                .ExecuteUpdateAsync(t => t.SetProperty(x => x.IsActive, false));

            template.IsActive = true;
            template.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> DeleteTemplateAsync(int id, int tenantId)
        {
            var template = await _context.InvoiceTemplates.FirstOrDefaultAsync(t => t.Id == id && t.TenantId == tenantId);
            if (template == null) return false;

            // Don't allow deleting the active template
            if (template.IsActive)
                throw new InvalidOperationException("Cannot delete the active template. Please activate another template first.");

            _context.InvoiceTemplates.Remove(template);
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<string> RenderTemplateAsync(int templateId, int tenantId, SaleDto sale, CompanySettings settings)
        {
            var template = await _context.InvoiceTemplates.FirstOrDefaultAsync(t => t.Id == templateId && t.TenantId == tenantId);
            if (template == null)
                throw new InvalidOperationException($"Template {templateId} not found");

            return await RenderTemplateHtmlAsync(template.HtmlCode, sale, settings);
        }

        public async Task<string> RenderActiveTemplateAsync(int tenantId, SaleDto sale, CompanySettings settings)
        {
            var template = await _context.InvoiceTemplates.FirstOrDefaultAsync(t => t.TenantId == tenantId && t.IsActive);
            if (template == null)
            {
                // Fallback to default template
                var defaultTemplatePath = Path.Combine(Directory.GetCurrentDirectory(), "Templates", "invoice-template-hd.html");
                if (File.Exists(defaultTemplatePath))
                {
                    var defaultHtml = await File.ReadAllTextAsync(defaultTemplatePath);
                    return await RenderTemplateHtmlAsync(defaultHtml, sale, settings);
                }
                throw new InvalidOperationException("No active template found and default template not available");
            }

            return await RenderTemplateHtmlAsync(template.HtmlCode, sale, settings);
        }

        public async Task<string> RenderTemplateHtmlAsync(string htmlTemplate, SaleDto sale, CompanySettings settings)
        {
            // Get customer TRN (tenant-scoped)
            var customerTrn = await GetCustomerTrnAsync(sale.CustomerId, sale.OwnerId);
            var trnDisplay = string.IsNullOrWhiteSpace(customerTrn) ? "" : customerTrn;

            // Replace company placeholders
            var hasLogoPlaceholder = htmlTemplate.Contains("{{company_logo_img}}") || htmlTemplate.Contains("{{company_logo_data_uri}}");
            var processedHtml = htmlTemplate
                .Replace("{{company_name_en}}", settings.CompanyNameEn ?? "")
                .Replace("{{company_name_ar}}", settings.CompanyNameAr ?? "")
                .Replace("{{company_address}}", settings.CompanyAddress ?? "")
                .Replace("{{company_phone}}", settings.CompanyPhone ?? "")
                .Replace("{{company_trn}}", settings.CompanyTrn ?? "")
                .Replace("{{currency}}", settings.Currency ?? "AED");

            // Logo: from company Settings (tenant-scoped). Top-left placeholder 120x56, object-fit contain so no crop.
            var logoImgTag = "";
            var logoDataUri = "";
            if (settings.LogoImageBytes != null && settings.LogoImageBytes.Length > 0)
            {
                try
                {
                    var b64 = Convert.ToBase64String(settings.LogoImageBytes);
                    logoDataUri = "data:image/png;base64," + b64;
                    logoImgTag = $"<img src=\"{logoDataUri}\" alt=\"\" style=\"max-height:56px;max-width:120px;width:auto;height:auto;object-fit:contain;display:block;\" />";
                }
                catch { /* ignore */ }
            }
            processedHtml = processedHtml.Replace("{{company_logo_img}}", logoImgTag).Replace("{{company_logo_data_uri}}", logoDataUri);

            // If the active template does not have an explicit logo placeholder but we do have a logo,
            // inject a top-left logo into the <body> so invoices always show the company logo.
            if (!hasLogoPlaceholder && !string.IsNullOrEmpty(logoDataUri))
            {
                var injectedLogo = $"<img src=\"{logoDataUri}\" alt=\"\" style=\"position:absolute;top:8px;left:8px;max-height:56px;max-width:120px;width:auto;height:auto;object-fit:contain;z-index:10;\" />";

                if (Regex.IsMatch(processedHtml, "<body[^>]*>", RegexOptions.IgnoreCase))
                {
                    processedHtml = Regex.Replace(
                        processedHtml,
                        "<body([^>]*)>",
                        m => m.Value + Environment.NewLine + injectedLogo,
                        RegexOptions.IgnoreCase);
                }
                else
                {
                    processedHtml = injectedLogo + processedHtml;
                }
            }

            // Replace invoice placeholders
            var amountInWords = ConvertToWords(sale.GrandTotal);
            // Format date consistently (dd-MM-yyyy format for UAE)
            var formattedDate = sale.InvoiceDate.ToString("dd-MM-yyyy");
            processedHtml = processedHtml
                .Replace("{{invoice_no}}", sale.InvoiceNo)
                .Replace("{{date}}", formattedDate)
                .Replace("{{customer_name}}", sale.CustomerName ?? "Cash Customer")
                .Replace("{{customer_trn}}", trnDisplay)
                .Replace("{{subtotal}}", sale.Subtotal.ToString("N2"))
                .Replace("{{vat_amount}}", sale.VatTotal.ToString("N2"))
                .Replace("{{grand_total}}", sale.GrandTotal.ToString("N2"))
                .Replace("{{amount_in_words}}", amountInWords);

            // Generate items rows HTML - Column order: SL.No, Description, Unit (numeric qty), Qty (unit type), Unit Price, Total, Amount (with VAT shown)
            var itemsRowsHtml = new System.Text.StringBuilder();
            int itemIndex = 1;
            foreach (var item in sale.Items ?? new List<SaleItemDto>())
            {
                var lineTotal = item.UnitPrice * item.Qty;
                // Combined Amount column: Shows LineTotal with VAT breakdown below
                itemsRowsHtml.AppendLine($@"
                <tr>
                    <td class=""center"">{itemIndex}</td>
                    <td>{System.Net.WebUtility.HtmlEncode(item.ProductName ?? "")}</td>
                    <td class=""center"">{item.Qty.ToString("0.##")}</td>
                    <td class=""center"">{System.Net.WebUtility.HtmlEncode(item.UnitType ?? "")}</td>
                    <td class=""right"">{item.UnitPrice.ToString("N2")}</td>
                    <td class=""right"">{lineTotal.ToString("N2")}</td>
                    <td class=""right""><strong>{item.LineTotal.ToString("N2")}</strong><br/><span style=""font-size:7pt;color:#666;"">(+{item.VatAmount.ToString("N2")} VAT)</span></td>
                </tr>");
                itemIndex++;
            }

            // Fill remaining rows - up to 15 total rows
            int filledRows = sale.Items?.Count ?? 0;
            int maxTotalRows = 15;
            int emptyRowsNeeded = Math.Max(0, maxTotalRows - filledRows);
            
            for (int i = 0; i < emptyRowsNeeded; i++)
            {
                int rowNumber = filledRows + i + 1;
                itemsRowsHtml.AppendLine($@"
                <tr>
                    <td class=""center"">{rowNumber}</td>
                    <td>&nbsp;</td>
                    <td class=""center""></td>
                    <td class=""center""></td>
                    <td class=""right"">0.00</td>
                    <td class=""right"">0.00</td>
                    <td class=""right"">0.00</td>
                </tr>");
            }

            processedHtml = processedHtml.Replace("{{items}}", itemsRowsHtml.ToString());

            return processedHtml;
        }

        /// <summary>CRITICAL: Tenant-scoped to prevent cross-tenant data leakage.</summary>
        private async Task<string> GetCustomerTrnAsync(int? customerId, int tenantId)
        {
            if (!customerId.HasValue) return "";
            var customer = await _context.Customers
                .AsNoTracking()
                .Where(c => c.Id == customerId.Value && c.TenantId == tenantId)
                .Select(c => c.Trn)
                .FirstOrDefaultAsync();
            return customer ?? "";
        }

        // Helper method to convert numbers to words for invoice
        private string ConvertToWords(decimal amount)
        {
            try
            {
                if (amount == 0) return "Zero Dirhams Only";
                
                var integerPart = (long)Math.Floor(amount);
                var decimalPart = (int)Math.Round((amount - integerPart) * 100);
                
                string words = ConvertIntegerToWords(integerPart);
                
                if (decimalPart > 0)
                {
                    words += $" and {ConvertIntegerToWords(decimalPart)} Fils";
                }
                
                words += " Dirhams Only";
                return words;
            }
            catch
            {
                return amount.ToString("0.00") + " AED";
            }
        }
        
        private string ConvertIntegerToWords(long number)
        {
            if (number == 0) return "Zero";
            
            if (number < 0)
                return "Minus " + ConvertIntegerToWords(Math.Abs(number));
            
            string words = "";
            
            if ((number / 1000000000) > 0)
            {
                words += ConvertIntegerToWords(number / 1000000000) + " Billion ";
                number %= 1000000000;
            }
            
            if ((number / 1000000) > 0)
            {
                words += ConvertIntegerToWords(number / 1000000) + " Million ";
                number %= 1000000;
            }
            
            if ((number / 1000) > 0)
            {
                words += ConvertIntegerToWords(number / 1000) + " Thousand ";
                number %= 1000;
            }
            
            if ((number / 100) > 0)
            {
                words += ConvertIntegerToWords(number / 100) + " Hundred ";
                number %= 100;
            }
            
            if (number > 0)
            {
                var units = new[] { "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen" };
                var tens = new[] { "Zero", "Ten", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety" };
                
                if (number < 20)
                    words += units[number];
                else
                {
                    words += tens[number / 10];
                    if ((number % 10) > 0)
                        words += " " + units[number % 10];
                }
            }
            
            return words.Trim();
        }

        // Nested class for company settings
        public class CompanySettings
        {
            public string CompanyNameEn { get; set; } = "";
            public string CompanyNameAr { get; set; } = "";
            public string CompanyAddress { get; set; } = "";
            public string CompanyPhone { get; set; } = "";
            public string CompanyTrn { get; set; } = "";
            public string Currency { get; set; } = "AED";
            public decimal VatPercent { get; set; } = 5.0m;
            public string InvoicePrefix { get; set; } = "INV";
            public string VatEffectiveDate { get; set; } = "";
            public string VatLegalText { get; set; } = "";
            /// <summary>Logo image bytes (PNG) for PDF header. Null when no logo.</summary>
            public byte[]? LogoImageBytes { get; set; }
        }
    }
}

