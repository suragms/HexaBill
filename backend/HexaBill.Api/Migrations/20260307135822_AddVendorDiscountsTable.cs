using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HexaBill.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVendorDiscountsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CategoryId",
                table: "Suppliers",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NormalizedName",
                table: "Suppliers",
                type: "TEXT",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<decimal>(
                name: "AmountPaid",
                table: "Purchases",
                type: "decimal(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DueDate",
                table: "Purchases",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PaymentType",
                table: "Purchases",
                type: "TEXT",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SupplierId",
                table: "Purchases",
                type: "INTEGER",
                nullable: true);

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
                name: "VendorDiscounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TenantId = table.Column<int>(type: "INTEGER", nullable: false),
                    SupplierId = table.Column<int>(type: "INTEGER", nullable: false),
                    PurchaseId = table.Column<int>(type: "INTEGER", nullable: true),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    DiscountDate = table.Column<DateTime>(type: "TEXT", nullable: false),
                    DiscountType = table.Column<string>(type: "TEXT", maxLength: 50, nullable: false),
                    Reason = table.Column<string>(type: "TEXT", maxLength: 500, nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedBy = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VendorDiscounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VendorDiscounts_Purchases_PurchaseId",
                        column: x => x.PurchaseId,
                        principalTable: "Purchases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_VendorDiscounts_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_VendorDiscounts_Users_CreatedBy",
                        column: x => x.CreatedBy,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Suppliers_CategoryId",
                table: "Suppliers",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_SupplierId",
                table: "Purchases",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplierCategories_TenantId_Name",
                table: "SupplierCategories",
                columns: new[] { "TenantId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VendorDiscounts_CreatedBy",
                table: "VendorDiscounts",
                column: "CreatedBy");

            migrationBuilder.CreateIndex(
                name: "IX_VendorDiscounts_PurchaseId",
                table: "VendorDiscounts",
                column: "PurchaseId");

            migrationBuilder.CreateIndex(
                name: "IX_VendorDiscounts_SupplierId",
                table: "VendorDiscounts",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_VendorDiscounts_TenantId",
                table: "VendorDiscounts",
                column: "TenantId");

            migrationBuilder.AddForeignKey(
                name: "FK_Purchases_Suppliers_SupplierId",
                table: "Purchases",
                column: "SupplierId",
                principalTable: "Suppliers",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Suppliers_SupplierCategories_CategoryId",
                table: "Suppliers",
                column: "CategoryId",
                principalTable: "SupplierCategories",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Purchases_Suppliers_SupplierId",
                table: "Purchases");

            migrationBuilder.DropForeignKey(
                name: "FK_Suppliers_SupplierCategories_CategoryId",
                table: "Suppliers");

            migrationBuilder.DropTable(
                name: "SupplierCategories");

            migrationBuilder.DropTable(
                name: "VendorDiscounts");

            migrationBuilder.DropIndex(
                name: "IX_Suppliers_CategoryId",
                table: "Suppliers");

            migrationBuilder.DropIndex(
                name: "IX_Purchases_SupplierId",
                table: "Purchases");

            migrationBuilder.DropColumn(
                name: "CategoryId",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "NormalizedName",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "AmountPaid",
                table: "Purchases");

            migrationBuilder.DropColumn(
                name: "DueDate",
                table: "Purchases");

            migrationBuilder.DropColumn(
                name: "PaymentType",
                table: "Purchases");

            migrationBuilder.DropColumn(
                name: "SupplierId",
                table: "Purchases");
        }
    }
}
