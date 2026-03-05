using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HexaBill.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSuppliersAndSupplierPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ManagerUserId",
                table: "Branches");

            migrationBuilder.AddColumn<string>(
                name: "FeaturesJson",
                table: "Tenants",
                type: "TEXT",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RefundStatus",
                table: "SaleReturns",
                type: "TEXT",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SupplierId",
                table: "Purchases",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SaleReturnId",
                table: "Payments",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AppliedAmount",
                table: "CreditNotes",
                type: "TEXT",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.RestartSequence(
                name: "invoice_number_seq",
                startValue: 1L);

            migrationBuilder.CreateTable(
                name: "SupplierCategories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TenantId = table.Column<int>(type: "INTEGER", nullable: true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupplierCategories", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Suppliers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TenantId = table.Column<int>(type: "INTEGER", nullable: true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    NormalizedName = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Phone = table.Column<string>(type: "TEXT", maxLength: 50, nullable: true),
                    Address = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    CategoryId = table.Column<int>(type: "INTEGER", nullable: true),
                    OpeningBalance = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Suppliers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Suppliers_SupplierCategories_CategoryId",
                        column: x => x.CategoryId,
                        principalTable: "SupplierCategories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "SupplierPayments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TenantId = table.Column<int>(type: "INTEGER", nullable: true),
                    SupplierId = table.Column<int>(type: "INTEGER", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    PaymentDate = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Reference = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    PurchaseId = table.Column<int>(type: "INTEGER", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupplierPayments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SupplierPayments_Purchases_PurchaseId",
                        column: x => x.PurchaseId,
                        principalTable: "Purchases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_SupplierPayments_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_SupplierId",
                table: "Purchases",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_SaleReturnId",
                table: "Payments",
                column: "SaleReturnId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceTemplates_TenantId",
                table: "InvoiceTemplates",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_CreditNotes_CreatedBy",
                table: "CreditNotes",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_SupplierCategories_TenantId_Name",
                table: "SupplierCategories",
                columns: new[] { "TenantId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SupplierPayments_PaymentDate",
                table: "SupplierPayments",
                column: "PaymentDate");

            migrationBuilder.CreateIndex(
                name: "IX_SupplierPayments_PurchaseId",
                table: "SupplierPayments",
                column: "PurchaseId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplierPayments_SupplierId",
                table: "SupplierPayments",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_Suppliers_CategoryId",
                table: "Suppliers",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Suppliers_TenantId_NormalizedName",
                table: "Suppliers",
                columns: new[] { "TenantId", "NormalizedName" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Payments_SaleReturns_SaleReturnId",
                table: "Payments",
                column: "SaleReturnId",
                principalTable: "SaleReturns",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Purchases_Suppliers_SupplierId",
                table: "Purchases",
                column: "SupplierId",
                principalTable: "Suppliers",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Payments_SaleReturns_SaleReturnId",
                table: "Payments");

            migrationBuilder.DropForeignKey(
                name: "FK_Purchases_Suppliers_SupplierId",
                table: "Purchases");

            migrationBuilder.DropTable(
                name: "SupplierPayments");

            migrationBuilder.DropTable(
                name: "Suppliers");

            migrationBuilder.DropTable(
                name: "SupplierCategories");

            migrationBuilder.DropIndex(
                name: "IX_Purchases_SupplierId",
                table: "Purchases");

            migrationBuilder.DropIndex(
                name: "IX_Payments_SaleReturnId",
                table: "Payments");

            migrationBuilder.DropIndex(
                name: "IX_InvoiceTemplates_TenantId",
                table: "InvoiceTemplates");

            migrationBuilder.DropIndex(
                name: "IX_CreditNotes_CreatedBy",
                table: "CreditNotes");

            migrationBuilder.DropColumn(
                name: "FeaturesJson",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "RefundStatus",
                table: "SaleReturns");

            migrationBuilder.DropColumn(
                name: "SupplierId",
                table: "Purchases");

            migrationBuilder.DropColumn(
                name: "SaleReturnId",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "AppliedAmount",
                table: "CreditNotes");

            migrationBuilder.AddColumn<int>(
                name: "ManagerUserId",
                table: "Branches",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.RestartSequence(
                name: "invoice_number_seq",
                startValue: 2000L);
        }
    }
}
