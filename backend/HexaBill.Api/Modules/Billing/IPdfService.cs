using HexaBill.Api.Models;

namespace HexaBill.Api.Modules.Billing
{
    public interface IPdfService
    {
        Task<byte[]> GenerateInvoicePdfAsync(SaleDto sale, string format = "A4");
        Task<byte[]> GenerateCombinedInvoicePdfAsync(List<SaleDto> sales);
        Task<byte[]> GenerateSalesLedgerPdfAsync(SalesLedgerReportDto ledgerReport, DateTime fromDate, DateTime toDate, int tenantId);
        Task<byte[]> GeneratePendingBillsPdfAsync(List<PendingBillDto> pendingBills, DateTime fromDate, DateTime toDate, int tenantId);
        Task<byte[]> GenerateCustomerPendingBillsPdfAsync(List<OutstandingInvoiceDto> outstandingInvoices, CustomerDto customer, DateTime asOfDate, DateTime fromDate, DateTime toDate, int tenantId);
        /// <summary>Monthly P&amp;L export for accountant (#58).</summary>
        Task<byte[]> GenerateProfitLossPdfAsync(ProfitReportDto report, DateTime fromDate, DateTime toDate, int tenantId);
        /// <summary>Owner-only worksheet PDF: period and totals (sales, purchases, expenses, received, pending).</summary>
        Task<byte[]> GenerateWorksheetPdfAsync(WorksheetReportDto dto, DateTime fromDate, DateTime toDate, int tenantId);
    }
}
