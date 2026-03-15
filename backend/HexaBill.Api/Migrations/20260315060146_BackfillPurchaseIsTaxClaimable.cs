using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HexaBill.Api.Migrations
{
    /// <inheritdoc />
    public partial class BackfillPurchaseIsTaxClaimable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<decimal>(
                name: "RoundOff",
                table: "Sales",
                type: "decimal(18,2)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<decimal>(
                name: "UnitPrice",
                table: "RecurringInvoiceItems",
                type: "decimal(18,2)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<decimal>(
                name: "Qty",
                table: "RecurringInvoiceItems",
                type: "decimal(18,2)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<decimal>(
                name: "RoundOff",
                table: "HeldInvoices",
                type: "decimal(18,2)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "TEXT");

            migrationBuilder.AddColumn<bool>(
                name: "VatInclusive",
                table: "Expenses",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "DefaultIsEntertainment",
                table: "ExpenseCategories",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "DefaultIsTaxClaimable",
                table: "ExpenseCategories",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "DefaultTaxType",
                table: "ExpenseCategories",
                type: "TEXT",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "DefaultVatRate",
                table: "ExpenseCategories",
                type: "TEXT",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<bool>(
                name: "VatDefaultLocked",
                table: "ExpenseCategories",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            // Backfill: Set IsTaxClaimable = true for purchases that have VAT so they appear in VAT Return Box 9b
            migrationBuilder.Sql(@"
                UPDATE ""Purchases""
                SET ""IsTaxClaimable"" = 1
                WHERE ""IsTaxClaimable"" = 0
                  AND (""VatTotal"" > 0
                       OR (""TotalAmount"" > 0 AND ""Subtotal"" IS NOT NULL AND ""TotalAmount"" > ""Subtotal""))
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "VatInclusive",
                table: "Expenses");

            migrationBuilder.DropColumn(
                name: "DefaultIsEntertainment",
                table: "ExpenseCategories");

            migrationBuilder.DropColumn(
                name: "DefaultIsTaxClaimable",
                table: "ExpenseCategories");

            migrationBuilder.DropColumn(
                name: "DefaultTaxType",
                table: "ExpenseCategories");

            migrationBuilder.DropColumn(
                name: "DefaultVatRate",
                table: "ExpenseCategories");

            migrationBuilder.DropColumn(
                name: "VatDefaultLocked",
                table: "ExpenseCategories");

            migrationBuilder.AlterColumn<decimal>(
                name: "RoundOff",
                table: "Sales",
                type: "TEXT",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,2)");

            migrationBuilder.AlterColumn<decimal>(
                name: "UnitPrice",
                table: "RecurringInvoiceItems",
                type: "TEXT",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,2)");

            migrationBuilder.AlterColumn<decimal>(
                name: "Qty",
                table: "RecurringInvoiceItems",
                type: "TEXT",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,2)");

            migrationBuilder.AlterColumn<decimal>(
                name: "RoundOff",
                table: "HeldInvoices",
                type: "TEXT",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,2)");
        }
    }
}
