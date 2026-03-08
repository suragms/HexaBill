/*
Purpose: FTA VAT 201 Return report - UAE quarterly VAT filing
Author: HexaBill
Date: 2025
*/
using Microsoft.EntityFrameworkCore;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Shared.Extensions;

namespace HexaBill.Api.Modules.Reports
{
    public interface IVatReturnReportService
    {
        Task<VatReturnDto> GetVatReturnAsync(int tenantId, int quarter, int year);
    }

    public class VatReturnReportService : IVatReturnReportService
    {
        private readonly AppDbContext _context;

        public VatReturnReportService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<VatReturnDto> GetVatReturnAsync(int tenantId, int quarter, int year)
        {
            var (fromDate, toDate) = QuarterToDateRange(quarter, year);
            var from = fromDate.ToUtcKind();
            var to = toDate.AddDays(1).ToUtcKind();

            // Sales: taxable (with VAT) and zero-rated (VatTotal=0)
            var salesQuery = _context.Sales
                .Where(s => s.TenantId == tenantId && !s.IsDeleted
                    && s.InvoiceDate >= from && s.InvoiceDate < to);

            // Box 1: Value of standard-rated supplies (excl. VAT)
            var taxableSubtotal = await salesQuery.Where(s => s.VatTotal > 0)
                .SumAsync(s => (decimal?)s.Subtotal) ?? 0;
            var taxableVat = await salesQuery.Where(s => s.VatTotal > 0)
                .SumAsync(s => (decimal?)s.VatTotal) ?? 0;

            var zeroRated = await salesQuery.Where(s => s.VatTotal == 0)
                .SumAsync(s => (decimal?)s.GrandTotal) ?? 0;

            // Sale returns: reduce taxable and VAT
            var returnsQuery = _context.SaleReturns
                .Where(sr => sr.TenantId == tenantId
                    && sr.ReturnDate >= from && sr.ReturnDate < to);
            var returnsVat = await returnsQuery.SumAsync(sr => (decimal?)sr.VatTotal) ?? 0;
            var returnsSubtotal = await returnsQuery.SumAsync(sr => (decimal?)sr.Subtotal) ?? 0;

            // Box 1: Net taxable supplies value (excl. VAT)
            var box1 = taxableSubtotal - returnsSubtotal;
            if (box1 < 0) box1 = 0;

            // Box 4: Output VAT (tax on taxable supplies)
            var outputVat = taxableVat - returnsVat;
            if (outputVat < 0) outputVat = 0;

            // Purchases: input VAT (recoverable)
            var purchaseVat = await _context.Purchases
                .Where(p => p.TenantId == tenantId && p.PurchaseDate >= from && p.PurchaseDate < to)
                .SumAsync(p => (decimal?)p.VatTotal) ?? 0;

            var purchaseReturnVat = await _context.PurchaseReturns
                .Where(pr => pr.TenantId == tenantId && pr.ReturnDate >= from && pr.ReturnDate < to)
                .SumAsync(pr => (decimal?)pr.VatTotal) ?? 0;

            var inputVat = purchaseVat - purchaseReturnVat;
            if (inputVat < 0) inputVat = 0;

            // Box 9: Net VAT due
            var netVatDue = outputVat - inputVat;
            if (netVatDue < 0) netVatDue = 0;

            return new VatReturnDto
            {
                Quarter = quarter,
                Year = year,
                FromDate = fromDate,
                ToDate = toDate,
                Box1_TaxableSupplies = box1,
                Box2_ZeroRatedSupplies = zeroRated,
                Box3_ExemptSupplies = 0,
                Box4_TaxOnTaxableSupplies = outputVat,
                Box5_ReverseCharge = 0,
                Box6_TotalDue = outputVat,
                Box7_TaxNotCreditable = 0,
                Box8_RecoverableTax = inputVat,
                Box9_NetVatDue = netVatDue
            };
        }

        private static (DateTime from, DateTime to) QuarterToDateRange(int quarter, int year)
        {
            return quarter switch
            {
                1 => (new DateTime(year, 1, 1), new DateTime(year, 3, 31)),
                2 => (new DateTime(year, 4, 1), new DateTime(year, 6, 30)),
                3 => (new DateTime(year, 7, 1), new DateTime(year, 9, 30)),
                4 => (new DateTime(year, 10, 1), new DateTime(year, 12, 31)),
                _ => (new DateTime(year, 1, 1), new DateTime(year, 3, 31))
            };
        }
    }
}
