# SQLite Missing Columns – Fixes Applied

When the app runs with **SQLite** (e.g. local dev with `hexabill.db`), migrations sometimes do not run or fail. That can cause errors like:

- `SQLite Error 1: 'no such column: s.RoundOff'`

## What was fixed

### 1. RoundOff column (Sales and HeldInvoices)

- **Error:** `no such column: s.RoundOff`
- **Cause:** The migration `AddRoundOffToSalesAndHeldInvoices` had not been applied to the SQLite database.
- **Fix:**
  - **Program.cs** (SQLite startup): Added `ALTER TABLE Sales ADD COLUMN RoundOff ...` and `ALTER TABLE HeldInvoices ADD COLUMN RoundOff ...` so the columns are created at startup when using SQLite.
  - **DatabaseFixer.cs**: Added the same columns to the fixer list so they are added if migrations fail and the fixer runs.
  - **DatabaseFixer.cs**: Added init commands to set `RoundOff = 0` for any existing rows where it is NULL.

After restarting the API, the RoundOff columns exist and the error should stop.

### 2. Payments.SaleReturnId

- **Error:** `no such column: p.SaleReturnId` (Sales ledger, VAT, customer balance).
- **Cause:** The column was only added in the PostgreSQL startup block.
- **Fix:** Program.cs SQLite block now runs `ALTER TABLE Payments ADD COLUMN SaleReturnId INTEGER NULL` at the top (with RoundOff). DatabaseFixer also adds this column.

### 3. Purchases columns (AmountPaid, PaymentType, SupplierId, DueDate)

- **Error:** "Failed to load purchases" / "Failed to retrieve analytic" (500) when EF materializes Purchase entities.
- **Cause:** These columns were only added for PostgreSQL.
- **Fix:** Program.cs SQLite block and DatabaseFixer now add: `AmountPaid REAL NULL`, `PaymentType TEXT NULL`, `SupplierId INTEGER NULL`, `DueDate TEXT NULL` on the Purchases table.

### 4. How SQLite column fixes work in this app

1. **Startup (Program.cs)**  
   When the app starts with SQLite, it runs a block of `ALTER TABLE ... ADD COLUMN` statements (Users, Expenses, Sales, HeldInvoices, etc.). Each is in a try/catch so existing columns are skipped.

2. **DatabaseFixer**  
   If migrations fail during startup, the app still runs and calls `DatabaseFixer.FixMissingColumnsAsync`. That runs a full list of `ALTER TABLE` and `UPDATE` commands so missing columns are added and data initialised.

3. **Migrations**  
   For **PostgreSQL**, normal EF Core migrations are used. For **SQLite**, the same migration files exist but may not run in some environments; the startup block and DatabaseFixer are the safety net.

## If you see another "no such column" error

1. Note the table and column (e.g. `s.RoundOff` → table **Sales**, column **RoundOff**).
2. Add the column in two places:
   - **Program.cs**: In the `else if (ctx.Database.IsSqlite())` block, add:
     - `try { ctx.Database.ExecuteSqlRaw("ALTER TABLE <Table> ADD COLUMN <Column> <Type> ..."); } catch { }`
   - **DatabaseFixer.cs**: In the `commands` array, add a tuple:
     - `("ALTER TABLE <Table> ADD COLUMN <Column> ...", "<Table>", "<Column>")`
3. For nullable columns use `NULL`; for required use `NOT NULL DEFAULT <value>` (or the right type for SQLite, e.g. `REAL`/`INTEGER`/`TEXT`).
4. Restart the API so the new ALTER runs at startup.

## Payment receipts and invoice templates

You asked for **payment receipt** print formats (like invoice: A4, A5, 80mm, 58mm). Right now only **invoice** PDFs have multiple formats. Payment receipts would need similar changes:

- Backend: payment receipt PDF endpoint(s) to accept a `format` parameter and use different layouts.
- Frontend: where payment receipts are printed, add a format selector (e.g. A4, 80mm, 58mm).

That is a separate feature and can be done after the RoundOff and SQLite fixes are verified.
