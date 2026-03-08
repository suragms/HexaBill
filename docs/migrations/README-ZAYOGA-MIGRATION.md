# ZAYOGA Purchase / Expense / Product migration

**Status:** This migration has **not** been run yet. The file `zayoga-purchases-expenses-products.json` is required in `backend/data/` but was not present. Invoices were rebuilt (241 invoices, next #242); purchases, expenses, and products still need this JSON and then:  
`cd backend/Scripts` → `node migrate-zayoga-purchases-expenses-products.js --execute`.

Script: **backend/Scripts/migrate-zayoga-purchases-expenses-products.js**

Imports purchases, expenses, and products from a single JSON file with strict totals validation. No partial insert: if validation fails, the script aborts and no data is written.

## Totals to validate (tolerance 0.01 AED)

- Purchase total = **49,792.12** AED  
- Expense total = **91,187.50** AED  
- Unpaid purchases total = **16,524.11** AED  
- Row counts: 18 purchases, 21 expenses, 10 products (warnings only if different)

## JSON file

Place **zayoga-purchases-expenses-products.json** in `backend/data/` (or set env `ZAYOGA_DATA_JSON` to the path).

Format:

```json
{
  "purchases": [
    { "purchase_number": "P001", "vendor": "Supplier Name", "date": "DD-MM-YYYY", "amount": 1000.50, "status": "Paid" }
  ],
  "expenses": [
    { "expense_number": "E001", "date": "DD-MM-YYYY", "amount": 500, "total": 500, "note": "Optional" }
  ],
  "products": [
    { "product_name": "Item", "sku": "SKU-1", "unit": "PIECE", "quantity": 10, "last_cost": 5.00 }
  ]
}
```

- **purchases:** `purchase_number` → `InvoiceNo`, `vendor` → `SupplierName`, `date` → `PurchaseDate`, `amount` → `TotalAmount`. `status` (Paid/Unpaid) used only for validation of unpaid total.
- **expenses:** `amount` or `total` → `Amount`, `date` → `Date`. Script uses first active ExpenseCategory (or creates "Other").
- **products:** `product_name` → `NameEn`, `quantity` → `StockQty`, `last_cost` → `CostPrice`. Idempotent by tenant + SKU/NameEn.

## Run

```bash
cd backend/Scripts
node migrate-zayoga-purchases-expenses-products.js           # dry run
node migrate-zayoga-purchases-expenses-products.js --execute  # apply (ZAYOGA tenant only)
```

Uses **backend/HexaBill.Api/.env** for DB connection (same as rebuild script). All inserts are tenant-scoped to ZAYOGA (tenant by Email = info@zayoga.ae). Re-runs are idempotent: existing purchases (by TenantId + InvoiceNo), expenses (by TenantId + Note), and products (by TenantId + SKU/Name) are skipped or updated.
