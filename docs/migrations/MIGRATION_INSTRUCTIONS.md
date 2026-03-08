# Data Isolation Fixes - Migration Instructions

## ⚠️ Production: Expenses Will Fail Until You Run the Fix

If you deployed to **Render** (or any host) and see:

- **Error creating expense category: 42703: column e.TenantId does not exist**
- **CSV exports failed: 42703: column e0.TenantId does not exist**
- **User seeding failed** / **Menu** / **errorMissingColumn** (often caused by missing columns)

Then your **production database has not had the schema update**. The app code expects `TenantId` on **Expenses** and **ExpenseCategories**; without it, expenses and backup CSV export will fail.

**Fix (one-time):**

1. **Render Dashboard** → Your **PostgreSQL** service → **Connect** → **PSQL** (or use local `psql $DATABASE_URL`).
2. Run **`backend/HexaBill.Api/Scripts/RUN_ON_RENDER_PSQL.sql`** (includes ErrorLogs.ResolvedAt + sections 6b, 7, 8). Or run sections 6b, 7, 8 of `FIX_PRODUCTION_MIGRATIONS.sql`.
3. **Restart** the API service on Render.

**Alternative (from PC):** `cd backend/HexaBill.Api/MigrationFixer`, set `DATABASE_URL`, run `dotnet run`.

After that, expenses and related features will work. See **Production Fix** below for the same steps in detail.

---

## Summary of Changes

Four fixes have been implemented:

1. **InvoiceTemplate tenant scope** - Added TenantId, backfill in migration, all reads filter by tenant
2. **ExpenseCategory tenant scope** - Added TenantId, (TenantId, Name) unique, Return write-off per tenant
3. **Console.WriteLine removed** - Replaced with ILogger in PdfService, ExpenseService, ExpensesController, SettingsController, ValidationService
4. **OwnerId → TenantId** - New code uses TenantId; ensure data migration has run

## Production Fix: 42703 column TenantId does not exist

If you see **Error creating expense category: 42703: column e.TenantId does not exist** (or similar TenantId errors on Expenses/ExpenseCategories/InvoiceTemplates) in production:

1. Open Render Dashboard → Your PostgreSQL service → **Connect** → **PSQL**
2. Run **Sections 6b, 7, and 8** of `backend/HexaBill.Api/Scripts/FIX_PRODUCTION_MIGRATIONS.sql`:
   - **6b**: Add TenantId to Expenses, backfill from OwnerId
   - **7**: Add TenantId to ExpenseCategories, backfill, create unique (TenantId, Name)
   - **8**: Add TenantId to InvoiceTemplates, backfill from Users

Or run the full script from local (with DATABASE_URL set):

```bash
psql $DATABASE_URL -f backend/HexaBill.Api/Scripts/FIX_PRODUCTION_MIGRATIONS.sql
```

Restart the API after running.

## Database Migrations to Run (Local / CI)

### 1. EF Core Migrations (InvoiceTemplate, ExpenseCategory)

```bash
cd backend/HexaBill.Api
dotnet ef database update
```

This applies:
- `20260225120000_AddInvoiceTemplateTenantId` - Adds TenantId to InvoiceTemplates, backfills from CreatedBy user
- `20260225130000_AddExpenseCategoryTenantId` - Adds TenantId to ExpenseCategories, backfills from Expenses, new unique index (TenantId, Name)

### 2. OwnerId → TenantId Data Migration (if not already run)

If your database still has NULL TenantId where OwnerId is populated, run:

```bash
psql -d your_database -f backend/HexaBill.Api/Scripts/archive/MigrateOwnerIdToTenantId.sql
```

This copies OwnerId → TenantId for Users, Sales, Customers, Products, etc.

### 3. Verify

- Login as different tenants; each sees only their invoice templates and expense categories
- PDF generation uses the correct tenant's template
- Return write-off category is created per tenant when needed
