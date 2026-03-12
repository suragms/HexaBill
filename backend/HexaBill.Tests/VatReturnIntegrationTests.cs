/*
 * VAT return integration tests: seeded local sales data and VAT calculation/save.
 * Verifies GetVatReturn201Async returns correct boxes and VatReturnPeriod save gets Id.
 */
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using HexaBill.Api.Data;
using HexaBill.Api.Models;
using HexaBill.Api.Modules.Reports;
using HexaBill.Api.Shared.Extensions;
using HexaBill.Api.Shared.Services;

namespace HexaBill.Tests;

public class VatReturnIntegrationTests
{
    private static DbContextOptions<AppDbContext> CreateInMemoryOptions()
    {
        return new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: "VatReturnTest_" + Guid.NewGuid())
            .Options;
    }

    private static async Task<AppDbContext> CreateSeededContextAsync()
    {
        var options = CreateInMemoryOptions();
        var context = new AppDbContext(options);
        await context.Database.EnsureCreatedAsync();

        var tenantId = 1;
        var invoiceDate = new DateTime(2025, 6, 15, 10, 0, 0, DateTimeKind.Utc);

        context.Sales.Add(new Sale
        {
            TenantId = tenantId,
            OwnerId = tenantId,
            InvoiceNo = "INV-VAT-TEST-001",
            InvoiceDate = invoiceDate,
            Subtotal = 1000.00m,
            VatTotal = 50.00m,
            Discount = 0,
            GrandTotal = 1050.00m,
            TotalAmount = 1050.00m,
            IsDeleted = false,
            IsZeroInvoice = false,
            VatScenario = "Standard",
            CreatedBy = 1,
            CreatedAt = DateTime.UtcNow
        });

        // Seed one purchase + expense with recoverable VAT so Input VAT path is covered
        context.Purchases.Add(new Purchase
        {
            TenantId = tenantId,
            OwnerId = tenantId,
            InvoiceNo = "BILL-001",
            PurchaseDate = invoiceDate,
            Subtotal = 500m,
            VatTotal = 25m,
            IsReverseCharge = false,
            IsTaxClaimable = true
        });

        context.Expenses.Add(new Expense
        {
            TenantId = tenantId,
            OwnerId = tenantId,
            Date = invoiceDate,
            Amount = 200m,
            VatAmount = 10m,
            ClaimableVat = 10m,
            TaxType = TaxTypes.Standard,
            IsEntertainment = false,
            IsTaxClaimable = true
        });

        await context.SaveChangesAsync();
        return context;
    }

    [Fact]
    public async Task GetVatReturn201Async_WithSeededSale_ReturnsNonZeroBox1aAndBox1b()
    {
        await using var context = await CreateSeededContextAsync();
        var logger = NullLogger<VatReturnReportService>.Instance;
        var service = new VatReturnReportService(context, logger);

        var from = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var toExclusive = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var result = await service.GetVatReturn201Async(1, from, toExclusive);

        Assert.NotNull(result);
        Assert.Equal(1000.00m, result.Box1a);
        Assert.Equal(50.00m, result.Box1b);
        Assert.True(result.Box9b > 0);
        Assert.True(result.Box12 > 0);
        Assert.True(result.TransactionCount >= 1);
        var blocking = result.ValidationIssues?.Where(i => string.Equals(i.Severity, "Blocking", StringComparison.OrdinalIgnoreCase)).ToList() ?? new List<ValidationIssueDto>();
        Assert.Empty(blocking);
    }

    [Fact]
    public async Task GetVatReturn201Async_NoSalesInPeriod_ReturnsZeroBox1aBox1b()
    {
        await using var context = await CreateSeededContextAsync();
        var logger = NullLogger<VatReturnReportService>.Instance;
        var service = new VatReturnReportService(context, logger);

        var from = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var toExclusive = new DateTime(2024, 12, 31, 23, 59, 59, DateTimeKind.Utc).AddSeconds(1);

        var result = await service.GetVatReturn201Async(1, from, toExclusive);

        Assert.NotNull(result);
        Assert.Equal(0, result.Box1a);
        Assert.Equal(0, result.Box1b);
    }

    [Fact]
    public async Task GetVatReturn201Async_InputVatGreaterThanOutput_ProducesRefund()
    {
        await using var context = await CreateSeededContextAsync();
        var logger = NullLogger<VatReturnReportService>.Instance;
        var service = new VatReturnReportService(context, logger);

        // Narrow period to only cover purchases/expenses by zeroing out sales
        foreach (var sale in context.Sales)
        {
            sale.VatTotal = 0;
            sale.Subtotal = 0;
        }
        await context.SaveChangesAsync();

        var from = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var toExclusive = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var result = await service.GetVatReturn201Async(1, from, toExclusive);

        Assert.True(result.Box1b == 0);
        Assert.True(result.Box12 > 0);
        Assert.True(result.Box13b > 0); // refundable
        Assert.Equal(0, result.Box13a);
    }

    [Fact]
    public async Task VatReturnPeriod_Save_ReceivesGeneratedId()
    {
        var options = CreateInMemoryOptions();
        await using var context = new AppDbContext(options);
        await context.Database.EnsureCreatedAsync();

        var fromDate = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var toDate = new DateTime(2025, 3, 31, 0, 0, 0, DateTimeKind.Utc);
        var dueDate = new DateTime(2025, 4, 28, 0, 0, 0, DateTimeKind.Utc);

        var period = new VatReturnPeriod
        {
            TenantId = 1,
            PeriodStart = fromDate.ToUtcKind(),
            PeriodEnd = toDate.ToUtcKind(),
            DueDate = dueDate.ToUtcKind(),
            PeriodLabel = "Q1-2025",
            Status = "Calculated",
            Box1a = 100m,
            Box1b = 5m,
            Box2 = 0,
            Box3 = 0,
            Box4 = 0,
            Box9b = 0,
            Box10 = 0,
            Box11 = 0,
            Box12 = 0,
            Box13a = 5m,
            Box13b = 0,
            PetroleumExcluded = 0,
            CalculatedAt = DateTime.UtcNow
        };

        context.VatReturnPeriods.Add(period);
        await context.SaveChangesAsync();

        Assert.True(period.Id > 0, "VatReturnPeriod.Id should be generated after save.");
    }
}
