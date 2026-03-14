/*Purpose: PDF service for generating invoices using QuestPDF
Author: AI Assistant
Date: 2024
*/
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using System.IO;
using HexaBill.Api.Modules.SuperAdmin;
using HexaBill.Api.Shared.Security;
using HexaBill.Api.Shared.Services;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Hosting;

namespace HexaBill.Api.Modules.Billing
{
    public class PdfService : IPdfService
    {
        private readonly AppDbContext _context;
        private readonly IInvoiceTemplateService _templateService;
        private readonly IFontService _fontService;
        private readonly ISettingsService _settingsService;
        private readonly IStorageService _storageService;
        private readonly ILogger<PdfService> _logger;
        private readonly IWebHostEnvironment _env;
        private readonly string _arabicFont;
        private readonly string _englishFont;

        public PdfService(AppDbContext context, IInvoiceTemplateService templateService, IFontService fontService, ISettingsService settingsService, IStorageService storageService, ILogger<PdfService> logger, IWebHostEnvironment env)
        {
            _context = context;
            _templateService = templateService;
            _fontService = fontService;
            _settingsService = settingsService;
            _storageService = storageService;
            _logger = logger;
            _env = env;
            
            QuestPDF.Settings.License = LicenseType.Community;
            
            // CRITICAL FIX FOR ARABIC PRINTING:
            // 1. Disable glyph checking - allows Arabic with fallback fonts
            // 2. Force font embedding in PDF output
            // 3. Register custom Arabic fonts from Fonts folder
            QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;
            
            // Enable font embedding for print compatibility
            QuestPDF.Settings.EnableCaching = true;
            
            // Register custom fonts for Arabic support
            _fontService.RegisterFonts();
            _arabicFont = _fontService.GetArabicFontFamily();
            _englishFont = _fontService.GetEnglishFontFamily();
            
            _logger.LogInformation("PDF Service initialized with Arabic font: {Font}", _arabicFont);
            
            // Disable debugging in production for better performance
            #if DEBUG
            QuestPDF.Settings.EnableDebugging = true;
            #else
            QuestPDF.Settings.EnableDebugging = false;
            #endif
        }

        public async Task<byte[]> GenerateInvoicePdfAsync(SaleDto sale, string format = "A4")
        {
            var formatNormalized = (format ?? "A4").Trim();
            if (string.IsNullOrEmpty(formatNormalized) || !new[] { "A4", "A5", "80mm", "58mm" }.Contains(formatNormalized, StringComparer.OrdinalIgnoreCase))
                formatNormalized = "A4";

            try
            {
                _logger.LogDebug("Generating PDF for sale {SaleId}, Invoice {InvoiceNo}, format {Format}, Items count: {Count}", sale.Id, sale.InvoiceNo, formatNormalized, sale.Items?.Count ?? 0);
                
                if (sale.Items == null || !sale.Items.Any())
                {
                    throw new InvalidOperationException($"Sale {sale.Id} has no items. Cannot generate PDF.");
                }
                
                var settings = await GetCompanySettingsAsync(sale.OwnerId); // Use OwnerId from SaleDto
                
                // CRITICAL: Get customer's pending balance for invoice footer acknowledgment (A4 only)
                var customerPendingInfo = await GetCustomerPendingBalanceInfoAsync(sale.CustomerId, sale.OwnerId);
                _logger.LogDebug("Company: {CompanyName}", settings.CompanyNameEn);
                
                var customerTrn = await GetCustomerTrnAsync(sale.CustomerId);
                var trnDisplay = string.IsNullOrWhiteSpace(customerTrn) ? "" : customerTrn;
                _logger.LogDebug("Customer TRN: {Trn}", trnDisplay);

                // A5, 80mm, 58mm: use QuestPDF layouts directly (no HTML template path)
                if (formatNormalized.Equals("A5", StringComparison.OrdinalIgnoreCase))
                {
                    return await Task.FromResult(GenerateInvoicePdfA5(sale, settings, trnDisplay));
                }
                if (formatNormalized.Equals("80mm", StringComparison.OrdinalIgnoreCase))
                {
                    return await Task.FromResult(GenerateInvoicePdf80mm(sale, settings, trnDisplay));
                }
                if (formatNormalized.Equals("58mm", StringComparison.OrdinalIgnoreCase))
                {
                    return await Task.FromResult(GenerateInvoicePdf58mm(sale, settings, trnDisplay));
                }

                // A4: try HTML template (for preview/other use), then build QuestPDF A4
                string? templateHtml = null;
                try
                {
                    var templateSettings = new InvoiceTemplateService.CompanySettings
                    {
                        CompanyNameEn = settings.CompanyNameEn,
                        CompanyNameAr = settings.CompanyNameAr,
                        CompanyAddress = settings.CompanyAddress,
                        CompanyPhone = settings.CompanyPhone,
                        CompanyTrn = settings.CompanyTrn,
                        Currency = settings.Currency,
                        LogoImageBytes = settings.LogoImageBytes
                    };
                    
                    templateHtml = await _templateService.RenderActiveTemplateAsync(sale.OwnerId, sale, templateSettings);
                    _logger.LogDebug("Using active invoice template from database");
                }
                catch (Exception ex)
                {
                    _logger.LogDebug("Database template not available: {Message}", ex.Message);
                    try
                    {
                        var templatePath = Path.Combine(Directory.GetCurrentDirectory(), "Templates", "invoice-template.html");
                        if (File.Exists(templatePath))
                        {
                            var templateFileContent = await File.ReadAllTextAsync(templatePath);
                            var templateSettings = new InvoiceTemplateService.CompanySettings
                            {
                                CompanyNameEn = settings.CompanyNameEn,
                                CompanyNameAr = settings.CompanyNameAr,
                                CompanyAddress = settings.CompanyAddress,
                                CompanyPhone = settings.CompanyPhone,
                                CompanyTrn = settings.CompanyTrn,
                                Currency = settings.Currency,
                                LogoImageBytes = settings.LogoImageBytes
                            };
                            templateHtml = await _templateService.RenderTemplateHtmlAsync(templateFileContent, sale, templateSettings);
                            _logger.LogDebug("Using invoice template from file");
                        }
                    }
                    catch (Exception fileEx)
                    {
                        _logger.LogDebug("Template file also failed: {Message}", fileEx.Message);
                    }
                }

                var document = Document.Create(container =>
                {
                    container.Page(page =>
                    {
                        // A4 Portrait: 210mm x 297mm with minimal margins
                        page.Size(PageSizes.A4);
                        page.Margin(5, Unit.Millimetre);
                        page.PageColor(Colors.White);
                        
                        // CRITICAL FIX: Arabic font for print compatibility
                        // Using embedded custom font for production
                        page.DefaultTextStyle(x => x
                            .FontSize(10f)
                            .FontFamily(_arabicFont)
                        );

                        page.Content().Column(column =>
                        {
                            column.Spacing(0);

                            column.Item().Padding(3).Column(innerColumn =>
                            {
                                innerColumn.Spacing(0);

                                // Invoice header: one clear block — logo (left) | company name + address (center) | date (right)
                                var hasLogo = settings.LogoImageBytes != null && settings.LogoImageBytes.Length > 0;
                                var invoiceDateStr = FormatInvoiceDate(sale.InvoiceDate, settings);

                                // Row 1: Logo | Company block (name EN, AR, address) | Date
                                innerColumn.Item().Row(headerRow =>
                                {
                                    if (hasLogo)
                                        headerRow.ConstantItem(130).AlignLeft().AlignMiddle()
                                            .Width(120).Height(56).Image(settings.LogoImageBytes!).FitArea();
                                    headerRow.RelativeItem().AlignCenter().Column(nameCol =>
                                    {
                                        nameCol.Item().Text(settings.CompanyNameEn.ToUpper())
                                            .FontSize(18)
                                            .Bold()
                                            .AlignCenter();
                                        nameCol.Item().PaddingTop(1).Text(settings.CompanyNameAr)
                                            .FontSize(16)
                                            .Bold()
                                            .FontFamily(_arabicFont)
                                            .DirectionFromRightToLeft()
                                            .AlignCenter();
                                        nameCol.Item().PaddingTop(2).Text($"Mob: {settings.CompanyPhone}, {settings.CompanyAddress}")
                                            .FontSize(12)
                                            .Bold()
                                            .AlignCenter();
                                    });
                                    headerRow.ConstantItem(80).AlignRight().AlignMiddle()
                                        .Text($"DATE: {invoiceDateStr}").FontSize(10).Bold();
                                });

                                // Row 2: TRN full width, then separator
                                innerColumn.Item().PaddingTop(2).Row(trnRow =>
                                {
                                    trnRow.AutoItem().Text("TRN : No : ").FontSize(10).Bold();
                                    trnRow.AutoItem().Text(settings.CompanyTrn).FontSize(10).Bold();
                                });

                                // TAX INVOICE title - compact with borders
                                innerColumn.Item().PaddingTop(2).PaddingBottom(2).BorderTop(1f).BorderBottom(1f).PaddingVertical(2)
                                    .Text("TAX INVOICE")
                                    .FontSize(12)
                                    .Bold()
                                    .AlignCenter();

                                // Customer Info - Invoice No and Customer Name on separate lines (left), TRN inline (right)
                                innerColumn.Item().PaddingTop(1).PaddingBottom(1).Row(custRow => {
                                    custRow.RelativeItem(65).Column(col => {
                                        col.Item().Text(text => {
                                            text.Span("INVOICE : NO : ").FontSize(10).Bold();
                                            text.Span(sale.InvoiceNo ?? "").FontSize(10).Bold();
                                        });
                                        col.Item().Text(text => {
                                            text.Span("Customer Name : ").FontSize(10).Bold();
                                            text.Span(string.IsNullOrWhiteSpace(sale.CustomerName) ? "Cash Customer" : sale.CustomerName).FontSize(10).Bold();
                                        });
                                    });
                                    custRow.RelativeItem(35).AlignRight().Text(text => {
                                        text.Span("CUSTOMER TRN : NO : ").FontSize(10).Bold();
                                        text.Span(trnDisplay).FontSize(10).Bold();
                                    });
                                });

                                innerColumn.Item().Border(0.5f).Table(table =>
                                {
                                    // Column widths matching RAFCO 11: balanced equal widths
                                    table.ColumnsDefinition(columns =>
                                    {
                                        columns.RelativeColumn(6);   // SL.No
                                        columns.RelativeColumn(35);  // Description
                                        columns.RelativeColumn(8);   // Unit
                                        columns.RelativeColumn(8);   // Qty
                                        columns.RelativeColumn(12);  // Unit Price
                                        columns.RelativeColumn(11);  // Total
                                        columns.RelativeColumn(9);   // VAT 5%
                                        columns.RelativeColumn(11);  // Amount
                                    });

                                    table.Header(header =>
                                    {
                                        void AddHeader(string arabic, string eng)
                                        {
                                            header.Cell().Border(0.5f).PaddingVertical(3).PaddingHorizontal(2).Column(col =>
                                            {
                                                if (!string.IsNullOrEmpty(arabic))
                                                {
                                                    col.Item().AlignCenter()
                                                        .Text(arabic)
                                                        .FontSize(9)
                                                        .FontFamily(_arabicFont)
                                                        .DirectionFromRightToLeft();
                                                }
                                                col.Item().AlignCenter().Text(eng).FontSize(9);
                                            });
                                        }

                                        AddHeader("ر.م", "SL.No");
                                        AddHeader("الوصف", "Description");
                                        AddHeader("الوحدة", "Unit");
                                        AddHeader("الكمية", "Qty");
                                        AddHeader("سعر الوحدة", "Unit Price");
                                        AddHeader("الإجمالي", "Total");
                                        AddHeader("ض.ق.م ٥٪", "Vat:5%");
                                        AddHeader("المبلغ", "Amount");
                                    });

                                    int itemCount = sale.Items != null ? sale.Items.Count : 0;
                                    
                                    // RESTORED: Full page table height - 15 rows to fill page properly
                                    int minRowsForHeight = 15;
                                    float rowHeight = 25f; // Original height for full page
                                    float totalItemsHeight = itemCount * rowHeight;
                                    float minTableHeight = minRowsForHeight * rowHeight;
                                    
                                    if (itemCount > 0 && sale.Items != null)
                                    {
                                        for (int i = 0; i < itemCount; i++)
                                        {
                                            var item = sale.Items[i];
                                            
                                            // Add vertical borders between columns, no horizontal borders between rows
                                            table.Cell().BorderLeft(0.5f).BorderRight(0.5f).PaddingVertical(3).PaddingHorizontal(1).AlignCenter().Text((i + 1).ToString()).FontSize(9);
                                            table.Cell().BorderLeft(0.5f).BorderRight(0.5f).PaddingVertical(3).PaddingHorizontal(2).AlignLeft().Text(item.ProductName ?? "").FontSize(9);
                                            table.Cell().BorderLeft(0.5f).BorderRight(0.5f).PaddingVertical(3).PaddingHorizontal(1).AlignCenter().Text(item.Qty.ToString("0.##")).FontSize(9);
                                            
                                            var unitTypeText = string.IsNullOrWhiteSpace(item.UnitType) ? "CRTN" : item.UnitType.ToUpper();
                                            table.Cell().BorderLeft(0.5f).BorderRight(0.5f).PaddingVertical(3).PaddingHorizontal(1).AlignCenter().Text(unitTypeText).FontSize(9);
                                            
                                            // CRITICAL FIX: Right-align all monetary columns for professional invoice format
                                            table.Cell().BorderLeft(0.5f).BorderRight(0.5f).PaddingVertical(3).PaddingHorizontal(1).AlignRight().Text(item.UnitPrice.ToString("0.00")).FontSize(9);
                                            
                                            var lineNet = item.Qty * item.UnitPrice;
                                            table.Cell().BorderLeft(0.5f).BorderRight(0.5f).PaddingVertical(3).PaddingHorizontal(1).AlignRight().Text(lineNet.ToString("0.00")).FontSize(9);
                                            table.Cell().BorderLeft(0.5f).BorderRight(0.5f).PaddingVertical(3).PaddingHorizontal(1).AlignRight().Text(item.VatAmount.ToString("0.00")).FontSize(9);
                                            table.Cell().BorderLeft(0.5f).BorderRight(0.5f).PaddingVertical(3).PaddingHorizontal(1).AlignRight().Text(item.LineTotal.ToString("0.00")).FontSize(9);
                                        }
                                    }
                                    
                                    // Add spacer row to maintain table height if needed
                                    if (itemCount < minRowsForHeight)
                                    {
                                        float spacerHeight = minTableHeight - totalItemsHeight - (3 * rowHeight); // 3 summary rows
                                        if (spacerHeight > 0)
                                        {
                                            // Add spacer cells with vertical borders for each column (8 columns total)
                                            for (int col = 0; col < 8; col++)
                                            {
                                                table.Cell().BorderLeft(0.5f).BorderRight(0.5f).Height(spacerHeight).Text("");
                                            }
                                        }
                                    }

                                    // Summary rows - ALL totals in rightmost Amount column
                                    // Row 1: INV. Amount (Subtotal)
                                    table.Cell().ColumnSpan(7).Border(0.5f).PaddingVertical(2).PaddingHorizontal(2).Row(row => {
                                        row.AutoItem().Text("INV.Amount").FontSize(10);
                                        row.RelativeItem();
                                        row.AutoItem().Text("مبلغ الفاتورة").FontSize(10).FontFamily(_arabicFont).DirectionFromRightToLeft();
                                    });
                                    table.Cell().Border(0.5f).PaddingVertical(2).PaddingHorizontal(2).AlignRight().Text(sale.Subtotal.ToString("0.00")).FontSize(10);
                                    
                                    // Row 2: VAT 5%
                                    table.Cell().ColumnSpan(7).Border(0.5f).PaddingVertical(2).PaddingHorizontal(2).Row(row => {
                                        row.AutoItem().Text("VAT 5%").FontSize(10);
                                        row.RelativeItem();
                                        row.AutoItem().Text("ضريبة ٥٪").FontSize(10).FontFamily(_arabicFont).DirectionFromRightToLeft();
                                    });
                                    table.Cell().Border(0.5f).PaddingVertical(2).PaddingHorizontal(2).AlignRight().Text(sale.VatTotal.ToString("0.00")).FontSize(10);
                                    
                                    // Row 2.5: Round Off (only when non-zero)
                                    if (sale.RoundOff != 0)
                                    {
                                        table.Cell().ColumnSpan(7).Border(0.5f).PaddingVertical(2).PaddingHorizontal(2).Row(row => {
                                            row.AutoItem().Text("Round Off").FontSize(10);
                                            row.RelativeItem();
                                            row.AutoItem().Text("تقريب").FontSize(10).FontFamily(_arabicFont).DirectionFromRightToLeft();
                                        });
                                        var roundOffText = sale.RoundOff > 0 ? "+" + sale.RoundOff.ToString("0.00") : sale.RoundOff.ToString("0.00");
                                        table.Cell().Border(0.5f).PaddingVertical(2).PaddingHorizontal(2).AlignRight().Text(roundOffText).FontSize(10);
                                    }
                                    
                                    // Row 3: Total Amount
                                    var amountInWords = ConvertToWords(sale.GrandTotal);
                                    // Shorten amount in words if too long
                                    if (amountInWords.Length > 80)
                                    {
                                        amountInWords = amountInWords.Substring(0, 77) + "...";
                                    }
                                    
                                    table.Cell().ColumnSpan(7).Border(0.5f).PaddingVertical(2).PaddingHorizontal(2).Text(text => {
                                        text.Span("Total Amount ").FontSize(10);
                                        text.Span("............. ").FontSize(8);
                                        text.Span(amountInWords).FontSize(8).Italic();
                                        text.Span(" ............. ").FontSize(8);
                                        text.Span(" درهم فقط").FontSize(10).FontFamily(_arabicFont).DirectionFromRightToLeft();
                                    });
                                    table.Cell().Border(0.5f).PaddingVertical(2).PaddingHorizontal(2).AlignRight().Text(sale.GrandTotal.ToString("0.00")).FontSize(10);
                                });

                                // Footer Section - optimized with CUSTOMER BALANCE
                                innerColumn.Item().PaddingTop(1).Column(footerCol =>
                                {
                                    // Acknowledgement text
                                    footerCol.Item().AlignLeft().Text("Received the above goods in good order")
                                        .FontSize(8);

                                    // Signature section - two columns - more compact
                                    footerCol.Item().PaddingTop(2).Row(sigRow =>
                                    {
                                        // Left column: Receiver's info
                                        sigRow.RelativeItem().Column(leftCol => {
                                            leftCol.Item().Text("Receive's Name: " + new string('.', 30)).FontSize(8);
                                            leftCol.Item().PaddingTop(1).Text("Receiver's Sign: " + new string('.', 30)).FontSize(8);
                                        });
                                        
                                        // Right column: Company name
                                        sigRow.RelativeItem().Column(rightCol => {
                                            rightCol.Item().AlignRight().Text($"For {settings.CompanyNameEn}").FontSize(8);
                                            rightCol.Item().AlignRight().Text(new string('.', 35)).FontSize(8);
                                        });
                                    });
                                    
                                    // Edit Reason - show if invoice was edited
                                    if (!string.IsNullOrWhiteSpace(sale.EditReason))
                                    {
                                        footerCol.Item().PaddingTop(1).BorderTop(0.5f).PaddingTop(1).Text(text => {
                                            text.Span("Edit Reason: ").FontSize(7).Bold();
                                            text.Span(sale.EditReason).FontSize(7).FontColor(Colors.Orange.Medium);
                                        });
                                    }
                                    
                                    // COMPACT: Customer Balance - single line, minimal spacing
                                    if (sale.CustomerId.HasValue && customerPendingInfo.TotalPendingBills > 0)
                                    {
                                        footerCol.Item().PaddingTop(2).AlignRight().Text(text => {
                                            text.Span($"Pending: {customerPendingInfo.TotalPendingBills} | ").FontSize(7);
                                            text.Span($"Balance: {settings.Currency} {customerPendingInfo.TotalBalanceDue:N2}").FontSize(7).Bold().FontColor(Colors.Red.Medium);
                                            text.Span(" الرصيد").FontSize(7).FontFamily(_arabicFont).DirectionFromRightToLeft();
                                        });
                                    }
                                });
                            });
                        });
                    });
                });

                _logger.LogInformation("   PDF document created successfully, generating bytes...");
                byte[] pdfBytes;
                try
                {
                    pdfBytes = document.GeneratePdf();
                    _logger.LogInformation($"\u2705 PDF generated: {pdfBytes.Length} bytes");
                }
                catch (Exception pdfEx) when (pdfEx.Message.Contains("conflicting size constraints") || pdfEx.Message.Contains("more space"))
                {
                    // FALLBACK: Layout overflow - retry without customer balance
                    _logger.LogInformation($"\u26a0\ufe0f PDF layout overflow, retrying without customer balance...");
                    _logger.LogInformation($"   Original error: {pdfEx.Message}");
                                    
                    // Generate simpler PDF without customer balance section
                    var fallbackDoc = Document.Create(container =>
                    {
                        container.Page(page =>
                        {
                            page.Size(PageSizes.A4);
                            page.Margin(5, Unit.Millimetre);
                            page.PageColor(Colors.White);
                            page.DefaultTextStyle(x => x.FontSize(10f).FontFamily(_arabicFont));
                            page.Content().Column(col =>
                            {
                                col.Item().Text($"{settings.CompanyNameEn}").FontSize(16).Bold().AlignCenter();
                                col.Item().Text($"Invoice: {sale.InvoiceNo} | Date: {sale.InvoiceDate:dd-MM-yyyy}").FontSize(10).AlignCenter();
                                col.Item().Text($"Customer: {sale.CustomerName ?? "Cash"}").FontSize(10);
                                col.Item().PaddingTop(10).Table(tbl =>
                                {
                                    tbl.ColumnsDefinition(c => { c.RelativeColumn(5); c.RelativeColumn(30); c.RelativeColumn(10); c.RelativeColumn(15); c.RelativeColumn(15); c.RelativeColumn(15); });
                                    tbl.Header(h => { h.Cell().Text("#"); h.Cell().Text("Product"); h.Cell().Text("Qty"); h.Cell().Text("Price"); h.Cell().Text("VAT"); h.Cell().Text("Total"); });
                                    if (sale.Items != null)
                                    {
                                        for (int i = 0; i < sale.Items.Count; i++)
                                        {
                                            var it = sale.Items[i];
                                            tbl.Cell().Text((i + 1).ToString());
                                            tbl.Cell().Text(it.ProductName ?? "");
                                            tbl.Cell().Text(it.Qty.ToString("0.##"));
                                            tbl.Cell().Text(it.UnitPrice.ToString("0.00"));
                                            tbl.Cell().Text(it.VatAmount.ToString("0.00"));
                                            tbl.Cell().Text(it.LineTotal.ToString("0.00"));
                                        }
                                    }
                                });
                                col.Item().PaddingTop(10).AlignRight().Text($"Subtotal: {sale.Subtotal:N2}");
                                col.Item().AlignRight().Text($"VAT: {sale.VatTotal:N2}");
                                col.Item().AlignRight().Text($"TOTAL: {sale.GrandTotal:N2}").Bold();
                            });
                        });
                    });
                    pdfBytes = fallbackDoc.GeneratePdf();
                    _logger.LogInformation($"\u2705 Fallback PDF generated: {pdfBytes.Length} bytes");
                }
                catch (Exception pdfEx)
                {
                    _logger.LogError(pdfEx, "PDF Generation Failed: {Message}", pdfEx.Message);
                    _logger.LogError("Inner Exception: {Message}", pdfEx.InnerException?.Message ?? "None");
                    _logger.LogError("Stack Trace: {StackTrace}", pdfEx.StackTrace);
                    throw new InvalidOperationException($"Failed to generate PDF: {pdfEx.Message}", pdfEx);
                }
                
                if (pdfBytes == null || pdfBytes.Length == 0)
                {
                    throw new InvalidOperationException("PDF generation returned empty bytes");
                }
                
                // Save PDF to disk for backup
                try
                {
                    await SavePdfToDiskAsync(sale, pdfBytes);
                }
                catch (Exception saveEx)
                {
                    _logger.LogInformation($"?? Failed to save PDF to disk: {saveEx.Message}");
                    // Don't throw - PDF generation succeeded, just saving to disk failed
                }
                
                return pdfBytes;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PDF Generation Error: {Message}", ex.Message);
                _logger.LogError("Stack trace: {StackTrace}", ex.StackTrace);
                throw;
            }
        }

        /// <summary>A5 (148x210mm) compact invoice - same Gulf VAT content as A4, smaller margins and fonts.</summary>
        private byte[] GenerateInvoicePdfA5(SaleDto sale, InvoiceTemplateService.CompanySettings settings, string trnDisplay)
        {
            var invoiceDateStr = FormatInvoiceDate(sale.InvoiceDate, settings);
            var document = Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(148, 210, Unit.Millimetre);
                    page.Margin(3, Unit.Millimetre);
                    page.PageColor(Colors.White);
                    page.DefaultTextStyle(x => x.FontSize(8f).FontFamily(_arabicFont));

                    page.Content().Column(column =>
                    {
                        column.Spacing(0);
                        column.Item().Padding(2).Column(inner =>
                        {
                            inner.Spacing(0);
                            // Header: company name, TRN, tax invoice
                            inner.Item().Row(r =>
                            {
                                r.RelativeItem().AlignCenter().Column(c =>
                                {
                                    c.Item().Text(settings.CompanyNameEn.ToUpper()).FontSize(12).Bold().AlignCenter();
                                    if (!string.IsNullOrEmpty(settings.CompanyNameAr))
                                        c.Item().Text(settings.CompanyNameAr).FontSize(10).Bold().FontFamily(_arabicFont).DirectionFromRightToLeft().AlignCenter();
                                    c.Item().Text($"TRN: {settings.CompanyTrn}").FontSize(7);
                                    c.Item().Text($"Mob: {settings.CompanyPhone} | {settings.CompanyAddress}").FontSize(6);
                                });
                            });
                            inner.Item().PaddingTop(1).PaddingBottom(1).BorderTop(0.5f).BorderBottom(0.5f)
                                .Text("TAX INVOICE").FontSize(10).Bold().AlignCenter();
                            inner.Item().PaddingTop(1).Row(r =>
                            {
                                r.RelativeItem().Text($"Inv: {sale.InvoiceNo} | Date: {invoiceDateStr}").FontSize(7);
                                r.RelativeItem().AlignRight().Text($"Cust TRN: {trnDisplay}").FontSize(7);
                            });
                            inner.Item().Text($"Customer: {sale.CustomerName ?? "Cash Customer"}").FontSize(7);

                            // Items table - compact
                            inner.Item().PaddingTop(1).Border(0.5f).Table(table =>
                            {
                                table.ColumnsDefinition(c =>
                                {
                                    c.ConstantColumn(12); c.RelativeColumn(25); c.ConstantColumn(10);
                                    c.ConstantColumn(10); c.ConstantColumn(12); c.ConstantColumn(10); c.ConstantColumn(12);
                                });
                                table.Header(h =>
                                {
                                    h.Cell().Border(0.5f).Padding(1).AlignCenter().Text("#").FontSize(6);
                                    h.Cell().Border(0.5f).Padding(1).AlignCenter().Text("Description").FontSize(6);
                                    h.Cell().Border(0.5f).Padding(1).AlignCenter().Text("Unit").FontSize(6);
                                    h.Cell().Border(0.5f).Padding(1).AlignCenter().Text("Qty").FontSize(6);
                                    h.Cell().Border(0.5f).Padding(1).AlignCenter().Text("Price").FontSize(6);
                                    h.Cell().Border(0.5f).Padding(1).AlignCenter().Text("Total").FontSize(6);
                                    h.Cell().Border(0.5f).Padding(1).AlignCenter().Text("VAT 5%").FontSize(6);
                                    h.Cell().Border(0.5f).Padding(1).AlignCenter().Text("Amount").FontSize(6);
                                });
                                if (sale.Items != null)
                                {
                                    for (int i = 0; i < sale.Items.Count; i++)
                                    {
                                        var item = sale.Items[i];
                                        table.Cell().Border(0.5f).Padding(1).AlignCenter().Text((i + 1).ToString()).FontSize(6);
                                        table.Cell().Border(0.5f).Padding(1).AlignLeft().Text(item.ProductName ?? "").FontSize(6);
                                        table.Cell().Border(0.5f).Padding(1).AlignCenter().Text(item.UnitType ?? "CRTN").FontSize(6);
                                        table.Cell().Border(0.5f).Padding(1).AlignCenter().Text(item.Qty.ToString("0.##")).FontSize(6);
                                        table.Cell().Border(0.5f).Padding(1).AlignRight().Text(item.UnitPrice.ToString("0.00")).FontSize(6);
                                        table.Cell().Border(0.5f).Padding(1).AlignRight().Text((item.LineTotal - item.VatAmount).ToString("0.00")).FontSize(6);
                                        table.Cell().Border(0.5f).Padding(1).AlignRight().Text(item.VatAmount.ToString("0.00")).FontSize(6);
                                        table.Cell().Border(0.5f).Padding(1).AlignRight().Text(item.LineTotal.ToString("0.00")).FontSize(6);
                                    }
                                }
                                table.Cell().ColumnSpan(7).Border(0.5f).Padding(1).Text("Subtotal").FontSize(6);
                                table.Cell().Border(0.5f).Padding(1).AlignRight().Text(sale.Subtotal.ToString("0.00")).FontSize(6);
                                table.Cell().ColumnSpan(7).Border(0.5f).Padding(1).Text("VAT 5%").FontSize(6);
                                table.Cell().Border(0.5f).Padding(1).AlignRight().Text(sale.VatTotal.ToString("0.00")).FontSize(6);
                                if (sale.RoundOff != 0)
                                {
                                    table.Cell().ColumnSpan(7).Border(0.5f).Padding(1).Text("Round Off").FontSize(6);
                                    table.Cell().Border(0.5f).Padding(1).AlignRight().Text(sale.RoundOff.ToString("0.00")).FontSize(6);
                                }
                                table.Cell().ColumnSpan(7).Border(0.5f).Padding(1).Text("Total (" + (settings.Currency ?? "AED") + ")").FontSize(7).Bold();
                                table.Cell().Border(0.5f).Padding(1).AlignRight().Text(sale.GrandTotal.ToString("0.00")).FontSize(7).Bold();
                            });
                            inner.Item().PaddingTop(2).AlignCenter().Text("Thank you for your business").FontSize(6);
                        });
                    });
                });
            });
            return document.GeneratePdf();
        }

        /// <summary>80mm thermal receipt - Gulf VAT: supplier, TRN, inv no, date, items (Item|Qty|Total), subtotal, VAT 5%, total, AED.</summary>
        private byte[] GenerateInvoicePdf80mm(SaleDto sale, InvoiceTemplateService.CompanySettings settings, string trnDisplay)
        {
            var invoiceDateStr = FormatInvoiceDate(sale.InvoiceDate, settings);
            var document = Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(80, 350, Unit.Millimetre);
                    page.Margin(2, Unit.Millimetre);
                    page.PageColor(Colors.White);
                    page.DefaultTextStyle(x => x.FontSize(7f).FontFamily(_englishFont));

                    page.Content().Column(column =>
                    {
                        column.Spacing(0);
                        column.Item().AlignCenter().Text(settings.CompanyNameEn).FontSize(9).Bold();
                        column.Item().AlignCenter().Text($"TRN: {settings.CompanyTrn}").FontSize(6);
                        column.Item().AlignCenter().Text(settings.CompanyAddress).FontSize(5);
                        column.Item().AlignCenter().Text("TAX INVOICE").FontSize(8).Bold();
                        column.Item().AlignCenter().Text($"#{sale.InvoiceNo} | {invoiceDateStr}").FontSize(6);
                        column.Item().Text($"Customer: {sale.CustomerName ?? "Cash"}").FontSize(6);
                        if (!string.IsNullOrEmpty(trnDisplay))
                            column.Item().Text($"Cust TRN: {trnDisplay}").FontSize(5);
                        column.Item().PaddingVertical(1).LineHorizontal(0.5f);

                        column.Item().Table(t =>
                        {
                            t.ColumnsDefinition(c => { c.RelativeColumn(50); c.ConstantColumn(12); c.ConstantColumn(18); });
                            t.Header(h =>
                            {
                                h.Cell().Padding(1).Text("Item").FontSize(6).Bold();
                                h.Cell().Padding(1).AlignRight().Text("Qty").FontSize(6).Bold();
                                h.Cell().Padding(1).AlignRight().Text("Total").FontSize(6).Bold();
                            });
                            if (sale.Items != null)
                                foreach (var item in sale.Items)
                                {
                                    t.Cell().Padding(1).Text(item.ProductName ?? "").FontSize(6);
                                    t.Cell().Padding(1).AlignRight().Text(item.Qty.ToString("0.##")).FontSize(6);
                                    t.Cell().Padding(1).AlignRight().Text(item.LineTotal.ToString("0.00")).FontSize(6);
                                }
                        });
                        column.Item().LineHorizontal(0.5f);
                        column.Item().Row(r => { r.RelativeItem().Text("Subtotal"); r.AutoItem().Text(sale.Subtotal.ToString("0.00")); });
                        column.Item().Row(r => { r.RelativeItem().Text("VAT 5%"); r.AutoItem().Text(sale.VatTotal.ToString("0.00")); });
                        if (sale.RoundOff != 0)
                            column.Item().Row(r => { r.RelativeItem().Text("Round Off"); r.AutoItem().Text(sale.RoundOff.ToString("0.00")); });
                        column.Item().Row(r => { r.RelativeItem().Text("TOTAL (" + (settings.Currency ?? "AED") + ")").Bold(); r.AutoItem().Text(sale.GrandTotal.ToString("0.00")).Bold(); });
                        column.Item().PaddingTop(2).AlignCenter().Text("Thank you").FontSize(5);
                    });
                });
            });
            return document.GeneratePdf();
        }

        /// <summary>58mm thermal receipt - same Gulf VAT fields, very compact.</summary>
        private byte[] GenerateInvoicePdf58mm(SaleDto sale, InvoiceTemplateService.CompanySettings settings, string trnDisplay)
        {
            var invoiceDateStr = FormatInvoiceDate(sale.InvoiceDate, settings);
            var document = Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Size(58, 350, Unit.Millimetre);
                    page.Margin(1.5f, Unit.Millimetre);
                    page.PageColor(Colors.White);
                    page.DefaultTextStyle(x => x.FontSize(5f).FontFamily(_englishFont));

                    page.Content().Column(column =>
                    {
                        column.Spacing(0);
                        column.Item().AlignCenter().Text(settings.CompanyNameEn).FontSize(7).Bold();
                        column.Item().AlignCenter().Text($"TRN:{settings.CompanyTrn}").FontSize(5);
                        column.Item().AlignCenter().Text("TAX INV").FontSize(6).Bold();
                        column.Item().AlignCenter().Text($"{sale.InvoiceNo} {invoiceDateStr}").FontSize(5);
                        column.Item().Text($"Cust:{sale.CustomerName ?? "Cash"}").FontSize(5);
                        if (!string.IsNullOrEmpty(trnDisplay))
                            column.Item().Text($"TRN:{trnDisplay}").FontSize(4);
                        column.Item().LineHorizontal(0.5f);

                        column.Item().Table(t =>
                        {
                            t.ColumnsDefinition(c => { c.RelativeColumn(55); c.ConstantColumn(12); c.ConstantColumn(16); });
                            t.Header(h =>
                            {
                                h.Cell().Padding(0.5f).Text("Item").FontSize(5).Bold();
                                h.Cell().Padding(0.5f).AlignRight().Text("Qty").FontSize(5).Bold();
                                h.Cell().Padding(0.5f).AlignRight().Text("Total").FontSize(5).Bold();
                            });
                            if (sale.Items != null)
                                foreach (var item in sale.Items)
                                {
                                    t.Cell().Padding(0.5f).Text(item.ProductName ?? "").FontSize(5);
                                    t.Cell().Padding(0.5f).AlignRight().Text(item.Qty.ToString("0.##")).FontSize(5);
                                    t.Cell().Padding(0.5f).AlignRight().Text(item.LineTotal.ToString("0.00")).FontSize(5);
                                }
                        });
                        column.Item().LineHorizontal(0.5f);
                        column.Item().Row(r => { r.RelativeItem().Text("Sub").FontSize(5); r.AutoItem().Text(sale.Subtotal.ToString("0.00")).FontSize(5); });
                        column.Item().Row(r => { r.RelativeItem().Text("VAT5%").FontSize(5); r.AutoItem().Text(sale.VatTotal.ToString("0.00")).FontSize(5); });
                        if (sale.RoundOff != 0)
                            column.Item().Row(r => { r.RelativeItem().Text("Rnd").FontSize(5); r.AutoItem().Text(sale.RoundOff.ToString("0.00")).FontSize(5); });
                        column.Item().Row(r => { r.RelativeItem().Text("TOTAL").FontSize(6).Bold(); r.AutoItem().Text(sale.GrandTotal.ToString("0.00")).FontSize(6).Bold(); });
                        column.Item().AlignCenter().Text(settings.Currency ?? "AED").FontSize(5);
                        column.Item().PaddingTop(1).AlignCenter().Text("Thank you").FontSize(4);
                    });
                });
            });
            return document.GeneratePdf();
        }

        public async Task<byte[]> GenerateCombinedInvoicePdfAsync(List<SaleDto> sales)
        {
            try
            {
                _logger.LogInformation($"?? Generating combined PDF for {sales.Count} invoices");
                
                if (sales == null || !sales.Any())
                {
                    throw new InvalidOperationException("No sales provided for combined PDF generation.");
                }
                
                var settings = await GetCompanySettingsAsync(sales[0].OwnerId); // All sales belong to same owner
                
                // PROD-10: Pre-fetch all customer TRNs to avoid blocking .Result calls in synchronous context
                var customerTrnMap = new Dictionary<int?, string>();
                foreach (var sale in sales)
                {
                    if (sale.CustomerId.HasValue && !customerTrnMap.ContainsKey(sale.CustomerId))
                    {
                        var customerTrn = await GetCustomerTrnAsync(sale.CustomerId);
                        customerTrnMap[sale.CustomerId] = customerTrn ?? "";
                    }
                }
                
                var document = Document.Create(container =>
                {
                    foreach (var sale in sales)
                    {
                        var customerTrn = sale.CustomerId.HasValue && customerTrnMap.TryGetValue(sale.CustomerId, out var trn) ? trn : null;
                        
                        container.Page(page =>
                        {
                            page.Size(PageSizes.A4);
                            page.Margin(10, Unit.Millimetre);
                            page.PageColor(Colors.White);
                            page.DefaultTextStyle(x => x.FontSize(11f));

                            page.Footer().Column(footerCol =>
                            {
                                footerCol.Item().AlignRight().PaddingRight(10).PaddingBottom(5).Text(text =>
                                {
                                    text.Span("Page ").FontSize(8).FontColor(Colors.Grey.Darken1);
                                    text.CurrentPageNumber().FontSize(8).FontColor(Colors.Grey.Darken1);
                                    text.Span(" of ").FontSize(8).FontColor(Colors.Grey.Darken1);
                                    text.TotalPages().FontSize(8).FontColor(Colors.Grey.Darken1);
                                });
                            });

                            page.Content().Column(column =>
                            {
                                RenderInvoiceContent(column, sale, settings, customerTrn);
                            });
                        });
                    }
                });

                _logger.LogInformation("   Combined PDF document created successfully, generating bytes...");
                byte[] pdfBytes;
                try
                {
                    pdfBytes = document.GeneratePdf();
                    _logger.LogInformation($"? Combined PDF generated: {pdfBytes.Length} bytes");
                }
                catch (Exception pdfEx)
                {
                    _logger.LogError(pdfEx, "Combined PDF Generation Failed: {Message}", pdfEx.Message);
                    throw new InvalidOperationException($"Failed to generate combined PDF: {pdfEx.Message}", pdfEx);
                }
                
                if (pdfBytes == null || pdfBytes.Length == 0)
                {
                    throw new InvalidOperationException("Combined PDF generation returned empty bytes");
                }
                
                return pdfBytes;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Combined PDF Generation Error: {Message}", ex.Message);
                throw;
            }
        }

        private void RenderInvoiceContent(ColumnDescriptor column, SaleDto sale, InvoiceTemplateService.CompanySettings settings, string? customerTrn = null)
        {
            var trnDisplay = string.IsNullOrWhiteSpace(customerTrn) ? "" : customerTrn;
            column.Spacing(0);

            column.Item().Border(2).Padding(8).Column(innerColumn =>
            {
                innerColumn.Spacing(0);

                // Starplus-style header: 3 columns when logo present, else centred text
                var hasLogo = settings.LogoImageBytes != null && settings.LogoImageBytes.Length > 0;
if (hasLogo)
                    {
                        innerColumn.Item().Row(headerRow =>
                        {
                            headerRow.ConstantItem(140).AlignCenter().AlignMiddle().Column(col =>
                            {
                                col.Item().Width(160).Height(80).Image(settings.LogoImageBytes!).FitArea();
                            });
                        headerRow.RelativeItem().AlignCenter().AlignMiddle().Column(col =>
                        {
                            col.Item().Text(settings.CompanyNameEn.ToUpper()).FontSize(16).Bold().AlignCenter();
                            col.Item().PaddingTop(1).Text(settings.CompanyNameAr).FontSize(10).AlignCenter();
                            var contactInfo = $"Mob : {settings.CompanyPhone}, {settings.CompanyAddress}";
                            col.Item().PaddingTop(1).Text(contactInfo).FontSize(9).AlignCenter();
                        });
                        headerRow.ConstantItem(140).AlignRight().AlignMiddle().Column(col =>
                        {
                            col.Item().Text($"TRN : No : {settings.CompanyTrn}").FontSize(9);
                            col.Item().PaddingTop(2).AlignRight().Text($"DATE : {FormatInvoiceDate(sale.InvoiceDate, settings)}").FontSize(9);
                        });
                    });
                }
                else
                {
                    innerColumn.Item().Text(settings.CompanyNameEn.ToUpper())
                        .FontSize(18).Bold().AlignCenter();
                    innerColumn.Item().PaddingTop(2).Text(settings.CompanyNameAr)
                        .FontSize(10).AlignCenter();
                    var contactInfo = $"Mob : {settings.CompanyPhone}, {settings.CompanyAddress}";
                    innerColumn.Item().PaddingTop(2).Text(contactInfo).FontSize(9).AlignCenter();
                    innerColumn.Item().PaddingTop(2).Row(trnDateRow =>
                    {
                        trnDateRow.RelativeItem().Text($"TRN : No : {settings.CompanyTrn}").FontSize(9);
                        trnDateRow.RelativeItem().AlignRight().Text($"DATE : {FormatInvoiceDate(sale.InvoiceDate, settings)}").FontSize(9);
                    });
                }

                innerColumn.Item().PaddingTop(6).BorderTop(2).BorderBottom(2).PaddingVertical(4).Text("TAX INVOICE")
                    .FontSize(14)
                    .Bold()
                    .AlignCenter();

                innerColumn.Item().PaddingTop(5).Table(metaTable =>
                {
                    metaTable.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn();
                        columns.RelativeColumn();
                        columns.RelativeColumn();
                    });

                    metaTable.Cell().Padding(3).Text($"INVOICE : NO : {sale.InvoiceNo}").FontSize(9).Bold();
                    metaTable.Cell().Padding(3).AlignCenter().Text($"DATE : {FormatInvoiceDate(sale.InvoiceDate, settings)}").FontSize(9).Bold();
                    metaTable.Cell().Padding(3).AlignRight().Text($"CUSTOMER TRN : NO : {trnDisplay}").FontSize(9).Bold();
                    
                    var customerDisplayName = string.IsNullOrWhiteSpace(sale.CustomerName) ? "Cash Customer" : sale.CustomerName;
                    metaTable.Cell().ColumnSpan(3).Padding(3).Text($"Customer Name : {customerDisplayName}").FontSize(9).Bold();
                });

                innerColumn.Item().Border(1).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.RelativeColumn(5);
                        columns.RelativeColumn(36);
                        columns.RelativeColumn(7);
                        columns.RelativeColumn(7);
                        columns.RelativeColumn(11);
                        columns.RelativeColumn(10);
                        columns.RelativeColumn(7);
                        columns.RelativeColumn(17);
                    });

                    table.Header(header =>
                    {
                        void AddHeader(string eng, string arabic = "")
                        {
                            header.Cell().Border(1).Background(Colors.White).PaddingVertical(2).PaddingHorizontal(1).Column(col =>
                            {
                                if (!string.IsNullOrEmpty(arabic))
                                {
                                    col.Item().AlignCenter().Text(arabic).FontSize(6).Bold().FontFamily(_arabicFont).DirectionFromRightToLeft();
                                }
                                col.Item().AlignCenter().Text(eng).FontSize(7.5f).Bold();
                            });
                        }

                        AddHeader("SL.No", "ر.م");
                        AddHeader("Description", "الوصف");
                        AddHeader("Unit", "الوحدة");
                        AddHeader("Qty", "الكمية");
                        AddHeader("Unit Price", "سعر الوحدة");
                        AddHeader("Total", "الإجمالي");
                        AddHeader("Vat 5%", "ض.ق.م ٥٪");
                        AddHeader("Amount", "المبلغ");
                    });

                    int itemCount = sale.Items != null ? sale.Items.Count : 0;
                    if (itemCount > 0 && sale.Items != null)
                    {
                        for (int i = 0; i < itemCount; i++)
                        {
                            var item = sale.Items[i];
                            
                            table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                                col.Item().AlignCenter().Text((i + 1).ToString()).FontSize(8f).Bold();
                            });
                            
                            table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(2).Column(col => {
                                col.Item().AlignLeft().Text(item.ProductName ?? "").FontSize(8f).Bold();
                            });
                            
                            table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                                col.Item().AlignCenter().Text(item.Qty.ToString("0.##")).FontSize(8f).Bold();
                            });
                            
                            table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                                col.Item().AlignCenter().Text(item.UnitType ?? "").FontSize(8f).Bold();
                            });
                            
                            table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                                col.Item().AlignRight().Text(item.UnitPrice.ToString("N2")).FontSize(8f).Bold();
                            });
                            
                            var lineNet = item.Qty * item.UnitPrice;
                            table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                                col.Item().AlignRight().Text(lineNet.ToString("N2")).FontSize(8f).Bold();
                            });
                            
                            table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                                col.Item().AlignRight().Text(item.VatAmount.ToString("N2")).FontSize(8f).Bold();
                            });
                            
                            table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                                col.Item().AlignRight().Text(item.LineTotal.ToString("N2")).FontSize(8f).Bold();
                            });
                        }
                    }

                    int maxTotalRows = 16;
                    int emptyRowsNeeded = Math.Max(0, maxTotalRows - itemCount);
                    
                    for (int i = 0; i < emptyRowsNeeded; i++)
                    {
                        int rowNumber = itemCount + i + 1;
                        table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignCenter().Text(rowNumber.ToString()).FontSize(8f);
                        });
                        
                        table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignLeft().Text("").FontSize(8f);
                        });
                        
                        table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignCenter().Text("").FontSize(8f);
                        });
                        
                        table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignCenter().Text("").FontSize(8f);
                        });
                        
                        table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignRight().Text("").FontSize(8f);
                        });
                        
                        table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignRight().Text("0.00").FontSize(8f);
                        });
                        
                        table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignRight().Text("0.00").FontSize(8f);
                        });
                        
                        table.Cell().Border(1).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignRight().Text("0.00").FontSize(8f);
                        });
                    }

                    table.Cell().ColumnSpan(5).Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(2).AlignRight().Column(col => {
                        col.Item().Text("INV.Amount").FontSize(9).Bold();
                        col.Item().PaddingTop(1).Text("مبلغ الفاتورة").FontSize(6).FontFamily(_arabicFont).DirectionFromRightToLeft();
                    });
                    table.Cell().Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                        col.Item().AlignRight().Text(sale.Subtotal.ToString("N2")).FontSize(11).Bold();
                    });
                    table.Cell().Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                        col.Item().AlignRight().Text(sale.VatTotal.ToString("N2")).FontSize(11).Bold();
                    });
                    table.Cell().Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                        col.Item().Text("");
                    });

                    table.Cell().ColumnSpan(6).Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(2).AlignRight().Column(col => {
                        col.Item().Text("VAT 5%").FontSize(9).Bold();
                        col.Item().PaddingTop(1).Text("ضريبة ٥٪").FontSize(6).FontFamily(_arabicFont).DirectionFromRightToLeft();
                    });
                    table.Cell().Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                        col.Item().Text("");
                    });
                    table.Cell().Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                        col.Item().Text("");
                    });

                    if (sale.RoundOff != 0)
                    {
                        table.Cell().ColumnSpan(6).Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(2).AlignRight().Column(col => {
                            col.Item().Text("Round Off / تقريب").FontSize(9).Bold();
                        });
                        table.Cell().Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(1).Column(col => { col.Item().Text(""); });
                        table.Cell().Border(1).Height(20).PaddingVertical(1).PaddingHorizontal(1).Column(col => {
                            col.Item().AlignRight().Text((sale.RoundOff > 0 ? "+" : "") + sale.RoundOff.ToString("N2")).FontSize(10).Bold();
                        });
                    }

                    table.Cell().ColumnSpan(6).Border(1).Height(20).PaddingVertical(2).PaddingHorizontal(2).AlignRight().Column(col => {
                        col.Item().Text("Total Amount").FontSize(9).Bold();
                        col.Item().PaddingTop(1).Text(new string('.', 45) + " درهم فقط").FontSize(9).Bold().FontFamily(_arabicFont).DirectionFromRightToLeft();
                    });
                    table.Cell().Border(1).Height(20).PaddingVertical(2).PaddingHorizontal(1).Column(col => {
                        col.Item().Text("");
                    });
                    table.Cell().Border(2).Height(20).PaddingVertical(2).PaddingHorizontal(1).Column(col => {
                        col.Item().AlignRight().Text(sale.GrandTotal.ToString("N2")).FontSize(11).Bold();
                    });
                });

                innerColumn.Item().PaddingTop(3).BorderTop(1);

                innerColumn.Item().PaddingTop(6).Column(footerCol =>
                {
                    footerCol.Item().AlignCenter().Text("Received the above goods in good order")
                        .FontSize(9)
                        .Bold();
                    
                    footerCol.Item().PaddingTop(2).AlignCenter().Text("استلمنا البضاعة أعلاه بحالة جيدة")
                        .FontSize(7).FontFamily(_arabicFont).DirectionFromRightToLeft();

                    footerCol.Item().PaddingTop(8).Table(sigTable =>
                    {
                        sigTable.ColumnsDefinition(columns =>
                        {
                            columns.RelativeColumn();
                            columns.RelativeColumn();
                        });
                        
                        sigTable.Cell().AlignLeft().Column(sigCol =>
                        {
                            sigCol.Item().Text("Receiver's Name").FontSize(9);
                            sigCol.Item().PaddingTop(4).Text(new string('.', 50)).FontSize(9);
                            sigCol.Item().PaddingTop(6).Text("Receiver's Sign").FontSize(9);
                            sigCol.Item().PaddingTop(4).Text(new string('.', 50)).FontSize(9);
                        });
                        
                        sigTable.Cell().AlignRight().Column(sigCol =>
                        {
                            sigCol.Item().Text($"For {settings.CompanyNameEn}").FontSize(9);
                            sigCol.Item().PaddingTop(4).Text(new string('.', 50)).FontSize(9);
                        });
                    });
                });
            });
        }

        private async Task<InvoiceTemplateService.CompanySettings> GetCompanySettingsAsync(int tenantId)
        {
            // DATA ISOLATION: Load company settings (and logo) for this tenant only. Invoice PDF uses sale.OwnerId so each tenant sees only their logo.
            var companySettings = await _settingsService.GetCompanySettingsAsync(tenantId);

            // Validate required settings are present
            if (string.IsNullOrWhiteSpace(companySettings.LegalNameEn))
            {
                _logger.LogWarning("Company LegalNameEn is empty for tenant {TenantId}", tenantId);
            }
            if (string.IsNullOrWhiteSpace(companySettings.VatNumber))
            {
                _logger.LogWarning("Company VatNumber is empty for tenant {TenantId}", tenantId);
            }

            var dto = new InvoiceTemplateService.CompanySettings
            {
                CompanyNameEn = companySettings.LegalNameEn ?? "Company Name",
                CompanyNameAr = companySettings.LegalNameAr ?? "",
                CompanyAddress = companySettings.Address ?? "",
                CompanyTrn = companySettings.VatNumber ?? "",
                CompanyPhone = companySettings.Mobile ?? "",
                Currency = companySettings.Currency ?? "AED",
                VatPercent = companySettings.VatPercent,
                InvoicePrefix = companySettings.InvoicePrefix ?? "INV",
                VatEffectiveDate = companySettings.VatEffectiveDate ?? "",
                VatLegalText = companySettings.VatLegalText ?? ""
            };
            // Logo: read from storage using key stored in Settings (uploaded in Settings page). Per-tenant isolation via tenantId.
            if (!string.IsNullOrWhiteSpace(companySettings.LogoStorageKey))
            {
                try
                {
                    var logoBytes = await _storageService.ReadBytesAsync(companySettings.LogoStorageKey);
                    dto.LogoImageBytes = logoBytes;
                    _logger.LogInformation("Invoice PDF: logo loaded for tenant {TenantId}, {Bytes} bytes.", tenantId, logoBytes?.Length ?? 0);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Invoice PDF: logo load failed for tenant {TenantId}, key={Key}. Invoice will render with text-only header. On Render, set R2 storage (R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY) so logo persists across deploys.", tenantId, companySettings.LogoStorageKey);
                }
            }
            else if (!string.IsNullOrWhiteSpace(companySettings.LogoPath) && companySettings.LogoPath.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var webRoot = _env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
                    var uploadsPath = Path.Combine(webRoot, "uploads");
                    var relativePath = companySettings.LogoPath.TrimStart('/').Replace("uploads/", "", StringComparison.OrdinalIgnoreCase);
                    var fullPath = Path.Combine(uploadsPath, relativePath);
                    if (File.Exists(fullPath))
                    {
                        var logoBytes = await File.ReadAllBytesAsync(fullPath);
                        dto.LogoImageBytes = logoBytes;
                        _logger.LogInformation("Invoice PDF: logo loaded from legacy path for tenant {TenantId}, {Bytes} bytes.", tenantId, logoBytes.Length);
                    }
                    else
                        _logger.LogInformation("Invoice PDF: legacy logo file not found for tenant {TenantId} at {Path}. Header will be text-only.", tenantId, fullPath);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Invoice PDF: legacy logo load failed for tenant {TenantId}. Invoice will render with text-only header.", tenantId);
                }
            }
            else if (string.IsNullOrWhiteSpace(companySettings.LogoStorageKey) && string.IsNullOrWhiteSpace(companySettings.LogoPath))
            {
                _logger.LogInformation("Invoice PDF: no logo set for tenant {TenantId}. Header will be text-only.", tenantId);
            }
            else
            {
                _logger.LogInformation("Invoice PDF: logo not available for tenant {TenantId}. LogoStorageKey empty, LogoPath='{LogoPath}' (not a legacy /uploads/ path). Header will be text-only.", tenantId, companySettings.LogoPath ?? "");
            }

            // Fallback: logo from base64 in DB (survives container restarts)
            if (dto.LogoImageBytes == null || dto.LogoImageBytes.Length == 0)
            {
                var base64Setting = await _settingsService.GetSettingValueAsync(tenantId, "LOGO_BASE64_DATA_URI");
                if (!string.IsNullOrWhiteSpace(base64Setting) && base64Setting.Contains(",", StringComparison.Ordinal))
                {
                    var parts = base64Setting.Split(",", 2, StringSplitOptions.None);
                    if (parts.Length == 2)
                    {
                        try
                        {
                            dto.LogoImageBytes = Convert.FromBase64String(parts[1].Trim());
                            _logger.LogInformation("Invoice PDF: logo loaded from base64 DB fallback for tenant {TenantId}, {Bytes} bytes.", tenantId, dto.LogoImageBytes.Length);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Invoice PDF: base64 logo decode failed for tenant {TenantId}.", tenantId);
                        }
                    }
                }
            }

            return dto;
        }
        
        /// <summary>
        /// Format date according to company settings or default format
        /// </summary>
        private string FormatInvoiceDate(DateTime date, InvoiceTemplateService.CompanySettings? settings = null)
        {
            // Default format: dd-MM-yyyy (UAE standard)
            // Can be extended to use settings.DateFormat if added to CompanySettings
            return date.ToString("dd-MM-yyyy");
        }

        /// <summary>Shared report header: logo left | company name + address + TRN centre | date right; then line; then optional subtitle.</summary>
        private static void RenderCompanyHeader(ColumnDescriptor col, InvoiceTemplateService.CompanySettings settings, string? subtitle, string dateText)
        {
            var hasLogo = settings.LogoImageBytes != null && settings.LogoImageBytes.Length > 0;
            col.Item().Row(row =>
            {
                if (hasLogo)
                    row.ConstantItem(80).AlignLeft().AlignMiddle().Width(80).Height(40).Image(settings.LogoImageBytes!).FitArea();
                row.RelativeItem().AlignCenter().AlignMiddle().Column(centerCol =>
                {
                    centerCol.Item().AlignCenter().Text(settings.CompanyNameEn ?? "Company").FontSize(10).Bold();
                    if (!string.IsNullOrWhiteSpace(settings.CompanyAddress))
                        centerCol.Item().AlignCenter().Text(settings.CompanyAddress).FontSize(8);
                    if (!string.IsNullOrWhiteSpace(settings.CompanyTrn))
                        centerCol.Item().AlignCenter().Text($"TRN: {settings.CompanyTrn}").FontSize(8);
                });
                row.ConstantItem(100).AlignRight().AlignMiddle().Text(dateText).FontSize(9);
            });
            col.Item().Height(3);
            col.Item().LineHorizontal(1).LineColor(Colors.Grey.Medium);
            col.Item().Height(2);
            if (!string.IsNullOrWhiteSpace(subtitle))
                col.Item().Text(subtitle).FontSize(14).Bold().AlignCenter();
        }

        private async Task<string> GetCustomerTrnAsync(int? customerId)
        {
            if (!customerId.HasValue) return "";
            
            var customer = await _context.Customers.FindAsync(customerId.Value);
            return customer?.Trn ?? "";
        }

        /// <summary>
        /// CRITICAL: Get customer's pending balance info for invoice footer
        /// This is calculated in REAL-TIME from the database to ensure accuracy
        /// </summary>
        private async Task<CustomerPendingBalanceInfo> GetCustomerPendingBalanceInfoAsync(int? customerId, int tenantId)
        {
            if (!customerId.HasValue)
            {
                return new CustomerPendingBalanceInfo();
            }

            try
            {
                // VALIDATION: Get customer with owner check
                var customer = await _context.Customers
                    .AsNoTracking()
                    .FirstOrDefaultAsync(c => c.Id == customerId.Value && c.TenantId == tenantId);

                if (customer == null)
                {
                    return new CustomerPendingBalanceInfo();
                }

                // CRITICAL: Calculate REAL pending balance from database (matches CustomerService/BalanceService)
                // Formula: TotalSales - TotalPayments (cleared, excl refunds) - TotalSalesReturns + RefundsPaid
                var totalSales = await _context.Sales
                    .Where(s => s.CustomerId == customerId.Value 
                               && s.TenantId == tenantId 
                               && !s.IsDeleted)
                    .SumAsync(s => (decimal?)s.GrandTotal) ?? 0m;

                // Cleared payments only; exclude refund payments (SaleReturnId != null)
                var totalPayments = await _context.Payments
                    .Where(p => p.CustomerId == customerId.Value 
                               && p.TenantId == tenantId 
                               && p.Status == PaymentStatus.CLEARED 
                               && p.SaleReturnId == null)
                    .SumAsync(p => (decimal?)p.Amount) ?? 0m;

                var totalSalesReturns = await _context.SaleReturns
                    .Where(sr => sr.CustomerId == customerId.Value && sr.TenantId == tenantId)
                    .SumAsync(sr => (decimal?)sr.GrandTotal) ?? 0m;

                var refundsPaid = await _context.Payments
                    .Where(p => p.CustomerId == customerId.Value 
                               && p.TenantId == tenantId 
                               && p.SaleReturnId != null)
                    .SumAsync(p => (decimal?)p.Amount) ?? 0m;

                // Count of pending invoices
                var totalPendingBills = await _context.Sales
                    .Where(s => s.CustomerId == customerId.Value 
                               && s.TenantId == tenantId 
                               && !s.IsDeleted
                               && (s.PaymentStatus == SalePaymentStatus.Pending || s.PaymentStatus == SalePaymentStatus.Partial))
                    .CountAsync();

                // Pending balance = TotalSales - TotalPayments - TotalSalesReturns + RefundsPaid
                var totalBalanceDue = totalSales - totalPayments - totalSalesReturns + refundsPaid;

                _logger.LogInformation($"\n?? Customer Balance Calculation for Invoice Footer:");
                _logger.LogInformation($"   Customer ID: {customerId.Value}");
                _logger.LogInformation($"   Total Sales: {totalSales:N2}");
                _logger.LogInformation($"   Total Payments: {totalPayments:N2}");
                _logger.LogInformation($"   Returns: {totalSalesReturns:N2}, RefundsPaid: {refundsPaid:N2}");
                _logger.LogInformation($"   Pending Bills Count: {totalPendingBills}");
                _logger.LogInformation($"   Total Balance Due: {totalBalanceDue:N2}\n");

                return new CustomerPendingBalanceInfo
                {
                    CustomerId = customerId.Value,
                    CustomerName = customer.Name,
                    TotalPendingBills = totalPendingBills,
                    TotalSales = totalSales,
                    TotalPayments = totalPayments,
                    PreviousBalance = Math.Max(0, totalBalanceDue), // Show only if positive (owing)
                    TotalBalanceDue = Math.Max(0, totalBalanceDue)  // Never show negative
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error calculating customer pending balance: {Message}", ex.Message);
                return new CustomerPendingBalanceInfo();
            }
        }

        /// <summary>
        /// DTO for customer pending balance information shown on invoice footer
        /// </summary>
        private class CustomerPendingBalanceInfo
        {
            public int CustomerId { get; set; }
            public string CustomerName { get; set; } = string.Empty;
            public int TotalPendingBills { get; set; }
            public decimal TotalSales { get; set; }
            public decimal TotalPayments { get; set; }
            public decimal PreviousBalance { get; set; }
            public decimal TotalBalanceDue { get; set; }
        }

        private async Task SavePdfToDiskAsync(SaleDto sale, byte[] pdfBytes)
        {
            try
            {
                if (pdfBytes == null || pdfBytes.Length == 0)
                {
                    _logger.LogInformation($"?? Cannot save PDF to disk: PDF bytes are empty for invoice {sale.InvoiceNo}");
                    return;
                }

                // Create invoices directory if it doesn't exist
                var invoicesDir = Path.Combine(Directory.GetCurrentDirectory(), "invoices");
                if (!Directory.Exists(invoicesDir))
                {
                    Directory.CreateDirectory(invoicesDir);
                    _logger.LogInformation($"?? Created invoices directory: {invoicesDir}");
                }

                // Save PDF file
                var fileName = $"INV-{sale.InvoiceNo}.pdf";
                var filePath = Path.Combine(invoicesDir, fileName);
                await System.IO.File.WriteAllBytesAsync(filePath, pdfBytes);
                
                // Verify file was saved
                if (System.IO.File.Exists(filePath))
                {
                    var fileInfo = new System.IO.FileInfo(filePath);
                    _logger.LogInformation($"?? PDF saved to disk: {fileName} ({fileInfo.Length} bytes)");
                }
                else
                {
                    _logger.LogInformation($"? PDF file not found after save attempt: {filePath}");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to save PDF to disk: {Message}", ex.Message);
                _logger.LogError("Stack Trace: {StackTrace}", ex.StackTrace);
                // Don't throw - PDF generation succeeded, just saving to disk failed
            }
        }

        private async Task<string?> GetCustomInvoiceTemplateAsync()
        {
            var setting = await _context.Settings
                .FirstOrDefaultAsync(s => s.Key == "INVOICE_TEMPLATE");
            return setting?.Value;
        }

        private async Task<byte[]> GeneratePdfFromHtmlTemplateAsync(string htmlTemplate, SaleDto sale, InvoiceTemplateService.CompanySettings settings)
        {
            try
            {
                // Get customer TRN
                var customerTrn = await GetCustomerTrnAsync(sale.CustomerId);
                var trnDisplay = string.IsNullOrWhiteSpace(customerTrn) ? "" : customerTrn;

                // Replace template variables
                var processedHtml = htmlTemplate
                    .Replace("{{invoiceNo}}", sale.InvoiceNo)
                    .Replace("{{INVOICE_NO}}", sale.InvoiceNo)
                    .Replace("{{DATE}}", sale.InvoiceDate.ToString("dd-MM-yyyy"))
                    .Replace("{{date}}", sale.InvoiceDate.ToString("dd-MM-yyyy"))
                    .Replace("{{CUSTOMER_NAME}}", sale.CustomerName ?? "Cash Customer")
                    .Replace("{{customer_name}}", sale.CustomerName ?? "Cash Customer")
                    .Replace("{{CUSTOMER_TRN}}", trnDisplay)
                    .Replace("{{customer_trn}}", trnDisplay)
                    .Replace("{{company_name_en}}", settings.CompanyNameEn)
                    .Replace("{{company_name_ar}}", settings.CompanyNameAr)
                    .Replace("{{company_address}}", settings.CompanyAddress)
                    .Replace("{{company_phone}}", settings.CompanyPhone)
                    .Replace("{{company_trn}}", settings.CompanyTrn)
                    .Replace("{{currency}}", settings.Currency)
                    .Replace("{{SUBTOTAL}}", sale.Subtotal.ToString("N2"))
                    .Replace("{{subtotal}}", sale.Subtotal.ToString("N2"))
                    .Replace("{{VAT_TOTAL}}", sale.VatTotal.ToString("N2"))
                    .Replace("{{vat_total}}", sale.VatTotal.ToString("N2"))
                    .Replace("{{GRAND_TOTAL}}", sale.GrandTotal.ToString("N2"))
                    .Replace("{{grand_total}}", sale.GrandTotal.ToString("N2"));

                // Generate items rows HTML - Combined VAT and Amount in single column
                var itemsRowsHtml = "";
                int itemIndex = 1;
                foreach (var item in sale.Items)
                {
                    var lineNet = item.Qty * item.UnitPrice;
                    itemsRowsHtml += $@"
                <tr>
                    <td class=""text-center"">{itemIndex}</td>
                    <td style=""text-align:left; padding-left:4px;"">{item.ProductName ?? ""}</td>
                    <td class=""text-center"">{item.Qty.ToString("0.##")}</td>
                    <td class=""text-center"">{item.UnitType ?? ""}</td>
                    <td class=""text-right"">{item.UnitPrice.ToString("0.00")}</td>
                    <td class=""text-right"">{lineNet.ToString("0.00")}</td>
                    <td class=""text-right""><strong>{item.LineTotal.ToString("0.00")}</strong><br/><span style=""font-size:7pt;color:#666;"">(+{item.VatAmount.ToString("0.00")} VAT)</span></td>
                </tr>";
                    itemIndex++;
                }

                // Generate filler rows HTML (to make 16 total rows) - 7 columns to match
                int itemCount = sale.Items?.Count ?? 0;
                int targetRows = 16;
                int emptyRowsNeeded = Math.Max(0, targetRows - itemCount);
                var fillerRowsHtml = "";
                for (int i = 0; i < emptyRowsNeeded; i++)
                {
                    fillerRowsHtml += $@"
                <tr class=""empty-row"">
                    <td class=""text-center""></td>
                    <td style=""text-align:left;""></td>
                    <td class=""text-center""></td>
                    <td class=""text-center""></td>
                    <td class=""text-right""></td>
                    <td class=""text-right"">0.00</td>
                    <td class=""text-right"">0.00</td>
                </tr>";
                }

                // Replace items placeholder
                processedHtml = processedHtml.Replace("${ITEMS_ROWS}", itemsRowsHtml);
                processedHtml = processedHtml.Replace("{{#items}}", "").Replace("{{/items}}", "");
                processedHtml = processedHtml.Replace("{{items}}", itemsRowsHtml);
                
                // Replace filler rows placeholder
                processedHtml = processedHtml.Replace("{{#filler_rows}}", "").Replace("{{/filler_rows}}", "");
                processedHtml = processedHtml.Replace("{{filler_rows}}", fillerRowsHtml);

                // For now, use QuestPDF with HTML rendering, or fall back to default
                // TODO: Install a proper HTML-to-PDF library (e.g., DinkToPdf, PuppeteerSharp)
                // For now, we'll log a warning and use the default template
                _logger.LogInformation("?? Custom HTML template found but HTML-to-PDF conversion not fully implemented.");
                _logger.LogInformation("   Falling back to default QuestPDF template.");
                _logger.LogInformation("   To enable full HTML template support, install DinkToPdf or PuppeteerSharp package.");
                
                // Fall back to default template for now
                // In production, you would convert HTML to PDF here
                throw new NotImplementedException("HTML template support requires HTML-to-PDF library. Please use default template or install DinkToPdf/PuppeteerSharp.");
            }
            catch (NotImplementedException)
            {
                throw; // Re-throw to use fallback
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing HTML template: {Message}", ex.Message);
                throw; // Fall back to default template
            }
        }

        public async Task<byte[]> GenerateSalesLedgerPdfAsync(SalesLedgerReportDto ledgerReport, DateTime fromDate, DateTime toDate, int tenantId)
        {
            try
            {
                var settings = await GetCompanySettingsAsync(tenantId);
                
                var document = Document.Create(container =>
                {
                    container.Page(page =>
                    {
                        page.Size(PageSizes.A4.Landscape()); // Landscape for wide table
                        page.Margin(15, Unit.Millimetre);
                        page.PageColor(Colors.White);
                        page.DefaultTextStyle(x => x.FontSize(8));

                        // Header
                        page.Header().Column(headerCol =>
                        {
                            RenderCompanyHeader(headerCol, settings, "SALES LEDGER REPORT", $"Period: {fromDate:dd-MM-yyyy} to {toDate:dd-MM-yyyy}");
                            headerCol.Item().Height(5);
                        });

                        // Content
                        page.Content().PaddingVertical(5).Column(contentCol =>
                        {
                            // Summary Section
                            contentCol.Item().Table(summaryTable =>
                            {
                                summaryTable.ColumnsDefinition(columns =>
                                {
                                    columns.RelativeColumn(2.5f);
                                    columns.RelativeColumn(2.5f);
                                    columns.RelativeColumn(2.5f);
                                    columns.RelativeColumn(2.5f);
                                });

                                summaryTable.Cell().Border(1).Padding(4).Text("Total Sales").FontSize(9).Bold();
                                summaryTable.Cell().Border(1).Padding(4).Text("Total Payments").FontSize(9).Bold();
                            summaryTable.Cell().Border(1).Padding(4).Text("Total Real Pending").FontSize(9).Bold();
                            summaryTable.Cell().Border(1).Padding(4).Text("Total Real Got Payment").FontSize(9).Bold();

                                summaryTable.Cell().Border(1).Padding(4).AlignRight().Text(ledgerReport.Summary.TotalSales.ToString("N2")).FontSize(9);
                                summaryTable.Cell().Border(1).Padding(4).AlignRight().Text(ledgerReport.Summary.TotalPayments.ToString("N2")).FontSize(9);
                                summaryTable.Cell().Border(1).Padding(4).AlignRight().Text(ledgerReport.Summary.TotalDebit.ToString("N2")).FontSize(9);
                                summaryTable.Cell().Border(1).Padding(4).AlignRight().Text(ledgerReport.Summary.TotalCredit.ToString("N2")).FontSize(9);
                            });

                            contentCol.Item().Height(5);

                            // Ledger Table
                            contentCol.Item().Table(table =>
                            {
                                table.ColumnsDefinition(columns =>
                                {
                                    columns.RelativeColumn(1.2f);  // Date
                                    columns.RelativeColumn(0.8f);  // Type
                                    columns.RelativeColumn(1.2f);  // Invoice No
                                    columns.RelativeColumn(2f);    // Customer
                                    columns.RelativeColumn(1f);    // Payment Mode
                                    columns.RelativeColumn(1f);   // Real Pending
                                    columns.RelativeColumn(1f);   // Real Got Payment
                                    columns.RelativeColumn(0.8f);  // Status
                                    columns.RelativeColumn(1f);   // Plan Date
                                    columns.RelativeColumn(1.2f);  // Balance
                                });

                                // Header
                                table.Header(header =>
                                {
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("Date").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("Type").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("Invoice No").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("Customer").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("Payment Mode").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text("Real Pending").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text("Real Got Payment").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("Status").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("Plan Date").FontSize(8).Bold();
                                    header.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text("Balance").FontSize(8).Bold();
                                });

                                // Rows
                                foreach (var entry in ledgerReport.Entries)
                                {
                                    var rowBg = entry.Type == "Payment" ? Colors.Green.Lighten5 : Colors.White;
                                    
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(entry.Date.ToString("dd-MM-yyyy")).FontSize(7);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(entry.Type).FontSize(7);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(entry.InvoiceNo).FontSize(7);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(entry.CustomerName ?? "Cash").FontSize(7);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(entry.PaymentMode ?? "-").FontSize(7);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text(entry.RealPending > 0 ? entry.RealPending.ToString("N2") : "-").FontSize(7).FontColor(Colors.Red.Medium);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text(entry.RealGotPayment > 0 ? entry.RealGotPayment.ToString("N2") : "-").FontSize(7).FontColor(Colors.Green.Medium);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(entry.Status).FontSize(7);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(entry.PlanDate?.ToString("dd-MM-yyyy") ?? "-").FontSize(7);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text(entry.CustomerBalance.ToString("N2")).FontSize(7)
                                        .FontColor(entry.CustomerBalance < 0 ? Colors.Green.Medium : entry.CustomerBalance > 0 ? Colors.Red.Medium : Colors.Black);
                                }
                            });
                        });

                        // Footer
                        page.Footer().Column(footerCol =>
                        {
                            footerCol.Item().BorderTop(1).PaddingTop(3).Row(row =>
                            {
                                row.RelativeItem().Text($"Generated on {DateTime.Now:dd-MM-yyyy HH:mm}")
                                    .FontSize(7);
                                row.RelativeItem().AlignRight().Column(col =>
                                {
                                    col.Item().Text(text =>
                                    {
                                        text.Span("Page ").FontSize(7);
                                        text.CurrentPageNumber().FontSize(7).Bold();
                                        text.Span(" of ").FontSize(7);
                                        text.TotalPages().FontSize(7).Bold();
                                    });
                                });
                            });
                        });
                    });
                });

                return document.GeneratePdf();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Sales Ledger PDF Generation Error: {Message}", ex.Message);
                throw;
            }
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

        public async Task<byte[]> GeneratePendingBillsPdfAsync(List<PendingBillDto> pendingBills, DateTime fromDate, DateTime toDate, int tenantId)
        {
            try
            {
                var settings = await GetCompanySettingsAsync(tenantId);
                
                var document = Document.Create(container =>
                {
                    container.Page(page =>
                    {
                        page.Size(PageSizes.A4);
                        page.Margin(15, Unit.Millimetre);
                        page.PageColor(Colors.White);
                        
                        page.DefaultTextStyle(x => x.FontFamily(_englishFont).FontSize(10));

                        page.Content().Column(column =>
                        {
                            column.Item().Column(headerCol => RenderCompanyHeader(headerCol, settings, "PENDING BILLS REPORT", $"{fromDate:dd-MM-yyyy} to {toDate:dd-MM-yyyy}"));
                            column.Item().PaddingBottom(5).Text($"Generated: {DateTime.Now:dd-MM-yyyy HH:mm}").FontSize(9).FontColor(Colors.Grey.Medium);
                            // Table
                            column.Item().Table(table =>
                            {
                                table.ColumnsDefinition(columns =>
                                {
                                    columns.ConstantColumn(40); // Invoice No
                                    columns.RelativeColumn(2); // Customer
                                    columns.ConstantColumn(50); // Date
                                    columns.ConstantColumn(50); // Due Date
                                    columns.ConstantColumn(50); // Total
                                    columns.ConstantColumn(50); // Paid
                                    columns.ConstantColumn(50); // Balance
                                    columns.ConstantColumn(35); // Days Overdue
                                });
                                
                                // Header
                                table.Header(header =>
                                {
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).Text("Invoice").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).Text("Customer").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).Text("Invoice Date").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).Text("Due Date").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).AlignRight().Text("Total").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).AlignRight().Text("Paid").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).AlignRight().Text("Balance").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).AlignCenter().Text("Overdue").FontSize(8).Bold().FontColor(Colors.White);
                                });
                                
                                // Rows
                                foreach (var bill in pendingBills)
                                {
                                    var rowBg = bill.DaysOverdue > 30 ? Colors.Red.Lighten4 
                                        : bill.DaysOverdue > 0 ? Colors.Orange.Lighten4 
                                        : Colors.White;
                                    
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(bill.InvoiceNo ?? "-").FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(bill.CustomerName ?? "Cash Customer").FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(bill.InvoiceDate.ToString("dd-MM-yyyy")).FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(bill.DueDate?.ToString("dd-MM-yyyy") ?? "-").FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text($"{bill.GrandTotal:N2}").FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text($"{bill.PaidAmount:N2}").FontSize(8).FontColor(Colors.Green.Medium);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text($"{bill.BalanceAmount:N2}").FontSize(8).Bold().FontColor(Colors.Red.Medium);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignCenter().Text(bill.DaysOverdue > 0 ? bill.DaysOverdue.ToString() : "-").FontSize(8).FontColor(bill.DaysOverdue > 30 ? Colors.Red.Darken1 : bill.DaysOverdue > 0 ? Colors.Orange.Darken1 : Colors.Grey.Medium);
                                }
                                
                                // Footer Totals
                                var totalGrand = pendingBills.Sum(b => b.GrandTotal);
                                var totalPaid = pendingBills.Sum(b => b.PaidAmount);
                                var totalBalance = pendingBills.Sum(b => b.BalanceAmount);
                                
                                table.Cell().ColumnSpan(4).Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text("TOTAL:").FontSize(9).Bold();
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text($"{totalGrand:N2}").FontSize(9).Bold();
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text($"{totalPaid:N2}").FontSize(9).Bold().FontColor(Colors.Green.Medium);
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text($"{totalBalance:N2}").FontSize(9).Bold().FontColor(Colors.Red.Medium);
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("");
                            });
                            
                            // Summary Stats
                            column.Item().PaddingTop(15).PaddingBottom(5).Row(row =>
                            {
                                row.RelativeItem().Text(text =>
                                {
                                    text.Span("Total Invoices: ").Bold();
                                    text.Span(pendingBills.Count.ToString());
                                });
                                
                                row.RelativeItem().Text(text =>
                                {
                                    text.Span("Overdue Invoices: ").Bold();
                                    text.Span(pendingBills.Count(b => b.DaysOverdue > 0).ToString()).FontColor(Colors.Red.Medium);
                                });
                                
                                row.RelativeItem().Text(text =>
                                {
                                    text.Span("Critical (>30 days): ").Bold();
                                    text.Span(pendingBills.Count(b => b.DaysOverdue > 30).ToString()).FontColor(Colors.Red.Darken1);
                                });
                            });
                        });
                        
                        page.Footer().AlignCenter().Text(x =>
                        {
                            x.CurrentPageNumber();
                            x.Span(" / ");
                            x.TotalPages();
                        });
                    });
                });
                
                return document.GeneratePdf();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating pending bills PDF: {Message}", ex.Message);
                _logger.LogInformation($"? Stack Trace: {ex.StackTrace}");
                throw;
            }
        }

        /// <summary>Monthly P&amp;L PDF for accountant (#58).</summary>
        public async Task<byte[]> GenerateProfitLossPdfAsync(ProfitReportDto report, DateTime fromDate, DateTime toDate, int tenantId)
        {
            try
            {
                var settings = await GetCompanySettingsAsync(tenantId);
                var currency = settings.Currency ?? "AED";
                var document = Document.Create(container =>
                {
                    container.Page(page =>
                    {
                        page.Size(PageSizes.A4);
                        page.Margin(15, Unit.Millimetre);
                        page.PageColor(Colors.White);
                        page.DefaultTextStyle(x => x.FontFamily(_englishFont).FontSize(10));
                        page.Content().Column(column =>
                        {
                            column.Item().Column(headerCol => RenderCompanyHeader(headerCol, settings, "Profit & Loss Statement", $"{fromDate:dd-MMM-yyyy} to {toDate:dd-MMM-yyyy}"));
                            column.Item().PaddingTop(8).PaddingBottom(5).Text($"Generated: {DateTime.UtcNow:dd-MMM-yyyy HH:mm} UTC").FontSize(9).FontColor(Colors.Grey.Medium);
                            column.Item().PaddingTop(12).Table(table =>
                            {
                                table.ColumnsDefinition(columns => { columns.RelativeColumn(2); columns.ConstantColumn(90); });
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(4).Text("Total Sales").Bold();
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(4).AlignRight().Text($"{report.TotalSales:N2} {currency}");
                                table.Cell().Border(1).Padding(4).Text("Cost of Goods Sold");
                                table.Cell().Border(1).Padding(4).AlignRight().Text($"-{report.CostOfGoodsSold:N2} {currency}");
                                table.Cell().Border(1).Background(Colors.Green.Lighten4).Padding(4).Text("Gross Profit").Bold();
                                table.Cell().Border(1).Background(Colors.Green.Lighten4).Padding(4).AlignRight().Text($"{report.GrossProfit:N2} {currency}").Bold();
                                table.Cell().Border(1).Padding(4).Text($"Margin: {report.GrossProfitMargin:F1}%").FontSize(9).FontColor(Colors.Grey.Medium);
                                table.Cell().Border(1).Padding(4);
                                table.Cell().Border(1).Padding(4).Text("Total Expenses");
                                table.Cell().Border(1).Padding(4).AlignRight().Text($"-{report.TotalExpenses:N2} {currency}");
                                table.Cell().Border(1).Background(report.NetProfit >= 0 ? Colors.Green.Lighten3 : Colors.Red.Lighten3).Padding(6).Text("Net Profit / Loss").Bold().FontSize(12);
                                table.Cell().Border(1).Background(report.NetProfit >= 0 ? Colors.Green.Lighten3 : Colors.Red.Lighten3).Padding(6).AlignRight().Text($"{report.NetProfit:N2} {currency}").Bold().FontSize(12);
                                table.Cell().Border(1).Padding(4).Text($"Net Margin: {report.NetProfitMargin:F2}%").FontSize(9).FontColor(Colors.Grey.Medium);
                                table.Cell().Border(1).Padding(4);
                            });
                        });
                    });
                });
                return document.GeneratePdf();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating P&L PDF: {Message}", ex.Message);
                throw;
            }
        }

        public async Task<byte[]> GenerateWorksheetPdfAsync(WorksheetReportDto dto, DateTime fromDate, DateTime toDate, int tenantId)
        {
            try
            {
                var settings = await GetCompanySettingsAsync(tenantId);
                var currency = settings.Currency ?? "AED";
                var document = Document.Create(container =>
                {
                    container.Page(page =>
                    {
                        page.Size(PageSizes.A4);
                        page.Margin(15, Unit.Millimetre);
                        page.PageColor(Colors.White);
                        page.DefaultTextStyle(x => x.FontFamily(_englishFont).FontSize(10));
                        page.Content().Column(column =>
                        {
                            column.Item().Column(headerCol => RenderCompanyHeader(headerCol, settings, "Worksheet", $"{fromDate:dd-MMM-yyyy} to {toDate:dd-MMM-yyyy}"));
                            column.Item().PaddingTop(8).PaddingBottom(5).Text($"Generated: {DateTime.UtcNow:dd-MMM-yyyy HH:mm} UTC").FontSize(9).FontColor(Colors.Grey.Medium);
                            column.Item().PaddingTop(12).Table(table =>
                            {
                                table.ColumnsDefinition(columns => { columns.RelativeColumn(2); columns.ConstantColumn(90); });
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(4).Text("Total Sales").Bold();
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(4).AlignRight().Text($"{dto.TotalSales:N2} {currency}");
                                table.Cell().Border(1).Padding(4).Text("Total Purchases");
                                table.Cell().Border(1).Padding(4).AlignRight().Text($"{dto.TotalPurchases:N2} {currency}");
                                table.Cell().Border(1).Padding(4).Text("Total Expenses");
                                table.Cell().Border(1).Padding(4).AlignRight().Text($"{dto.TotalExpenses:N2} {currency}");
                                table.Cell().Border(1).Padding(4).Text("Total Received");
                                table.Cell().Border(1).Padding(4).AlignRight().Text($"{dto.TotalReceived:N2} {currency}");
                                table.Cell().Border(1).Background(Colors.Blue.Lighten4).Padding(4).Text("Pending Amount").Bold();
                                table.Cell().Border(1).Background(Colors.Blue.Lighten4).Padding(4).AlignRight().Text($"{dto.PendingAmount:N2} {currency}").Bold();
                            });
                        });
                    });
                });
                return document.GeneratePdf();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating Worksheet PDF: {Message}", ex.Message);
                throw;
            }
        }

        public async Task<byte[]> GenerateCustomerPendingBillsPdfAsync(List<OutstandingInvoiceDto> outstandingInvoices, CustomerDto customer, DateTime asOfDate, DateTime fromDate, DateTime toDate, int tenantId)
        {
            try
            {
                var settings = await GetCompanySettingsAsync(tenantId);
                
                var document = Document.Create(container =>
                {
                    container.Page(page =>
                    {
                        page.Size(PageSizes.A4);
                        page.Margin(15, Unit.Millimetre);
                        page.PageColor(Colors.White);
                        
                        page.DefaultTextStyle(x => x.FontFamily(_englishFont).FontSize(10));

                        page.Content().Column(column =>
                        {
                            column.Item().Column(headerCol => RenderCompanyHeader(headerCol, settings, "CUSTOMER PENDING BILLS STATEMENT", $"{fromDate:dd-MM-yyyy} to {toDate:dd-MM-yyyy}"));
                            column.Item().PaddingBottom(5).AlignCenter().Text($"As of: {asOfDate:dd-MM-yyyy}").FontSize(10).FontColor(Colors.Grey.Darken1);
                            // Customer Info
                            column.Item().PaddingVertical(10).BorderTop(1).BorderBottom(1).BorderColor(Colors.Grey.Medium).Row(row =>
                            {
                                row.RelativeItem().Column(col =>
                                {
                                    col.Item().Text(text =>
                                    {
                                        text.Span("Customer: ").Bold();
                                        text.Span(customer.Name);
                                    });
                                    col.Item().Text(text =>
                                    {
                                        text.Span("Phone: ").Bold();
                                        text.Span(customer.Phone ?? "N/A");
                                    });
                                    col.Item().Text(text =>
                                    {
                                        text.Span("TRN: ").Bold();
                                        text.Span(customer.Trn ?? "N/A");
                                    });
                                });
                                
                                row.RelativeItem().Column(col =>
                                {
                                    col.Item().AlignRight().Text(text =>
                                    {
                                        text.Span("Statement Date: ").Bold();
                                        text.Span(asOfDate.ToString("dd-MM-yyyy"));
                                    });
                                    col.Item().AlignRight().Text(text =>
                                    {
                                        text.Span("Total Balance: ").Bold();
                                        text.Span($"{customer.Balance:N2} AED").FontColor(customer.Balance > 0 ? Colors.Red.Medium : Colors.Green.Medium);
                                    });
                                });
                            });
                            
                            // Table
                            column.Item().PaddingTop(10).Table(table =>
                            {
                                table.ColumnsDefinition(columns =>
                                {
                                    columns.ConstantColumn(50); // Invoice No
                                    columns.ConstantColumn(70); // Date
                                    columns.RelativeColumn(); // Description
                                    columns.ConstantColumn(70); // Total
                                    columns.ConstantColumn(70); // Paid
                                    columns.ConstantColumn(80); // Balance
                                    columns.ConstantColumn(50); // Days
                                });
                                
                                // Header
                                table.Header(header =>
                                {
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).Text("Invoice").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).Text("Invoice Date").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).Text("Description").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).AlignRight().Text("Total").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).AlignRight().Text("Paid").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).AlignRight().Text("Balance").FontSize(8).Bold().FontColor(Colors.White);
                                    header.Cell().Background(Colors.Blue.Darken2).Border(1).Padding(3).AlignCenter().Text("Days").FontSize(8).Bold().FontColor(Colors.White);
                                });
                                
                                // Rows
                                foreach (var invoice in outstandingInvoices)
                                {
                                    var daysOverdue = invoice.DaysOverdue > 0 ? invoice.DaysOverdue : 0;
                                    var rowBg = daysOverdue > 30 ? Colors.Red.Lighten4 
                                        : daysOverdue > 0 ? Colors.Orange.Lighten4 
                                        : Colors.White;
                                    
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(invoice.InvoiceNo ?? "-").FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text(invoice.InvoiceDate.ToString("dd-MM-yyyy")).FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).Text("Unpaid Invoice").FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text($"{invoice.GrandTotal:N2}").FontSize(8);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text($"{invoice.PaidAmount:N2}").FontSize(8).FontColor(Colors.Green.Medium);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignRight().Text($"{invoice.BalanceAmount:N2}").FontSize(8).Bold().FontColor(Colors.Red.Medium);
                                    table.Cell().Border(1).Background(rowBg).Padding(2).AlignCenter().Text(daysOverdue > 0 ? daysOverdue.ToString() : "-").FontSize(8).FontColor(daysOverdue > 30 ? Colors.Red.Darken1 : daysOverdue > 0 ? Colors.Orange.Darken1 : Colors.Grey.Medium);
                                }
                                
                                // Footer Totals
                                var totalGrand = outstandingInvoices.Sum(b => b.GrandTotal);
                                var totalPaid = outstandingInvoices.Sum(b => b.PaidAmount);
                                var totalBalance = outstandingInvoices.Sum(b => b.BalanceAmount);
                                
                                table.Cell().ColumnSpan(3).Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text("TOTAL PENDING:").FontSize(9).Bold();
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text($"{totalGrand:N2}").FontSize(9).Bold();
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text($"{totalPaid:N2}").FontSize(9).Bold().FontColor(Colors.Green.Medium);
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).AlignRight().Text($"{totalBalance:N2}").FontSize(9).Bold().FontColor(Colors.Red.Medium);
                                table.Cell().Border(1).Background(Colors.Grey.Lighten3).Padding(3).Text("");
                            });
                            
                            // Summary
                            column.Item().PaddingTop(15).Row(row =>
                            {
                                row.RelativeItem().Text(text =>
                                {
                                    text.Span("Total Pending Invoices: ").Bold();
                                    text.Span(outstandingInvoices.Count.ToString());
                                });
                                
                                row.RelativeItem().AlignRight().Text(text =>
                                {
                                    text.Span("Amount to Collect: ").Bold();
                                    text.Span($"{outstandingInvoices.Sum(i => i.BalanceAmount):N2} AED").FontColor(Colors.Red.Medium).FontSize(12).Bold();
                                });
                            });
                            
                            // Footer note
                            column.Item().PaddingTop(20).BorderTop(1).BorderColor(Colors.Grey.Medium).PaddingTop(5).Text("Please settle all outstanding invoices at your earliest convenience.")
                                .FontSize(8)
                                .Italic()
                                .FontColor(Colors.Grey.Medium);
                        });
                        
                        page.Footer().AlignCenter().Text(x =>
                        {
                            x.Span("Page ");
                            x.CurrentPageNumber();
                            x.Span(" of ");
                            x.TotalPages();
                        });
                    });
                });
                
                return document.GeneratePdf();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating customer pending bills PDF: {Message}", ex.Message);
                _logger.LogInformation($"? Stack Trace: {ex.StackTrace}");
                throw;
            }
        }

    }
}

