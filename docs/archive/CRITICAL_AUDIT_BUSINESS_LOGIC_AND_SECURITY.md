# HexaBill – Critical Business Logic & Security Audit

**Scope:** Multi-tenant billing SaaS (ASP.NET Core 9, EF Core 9, PostgreSQL, React).  
**Risk level:** EXTREME – real money, VAT, stock, customer balances.

---

## CRITICAL ISSUES FOUND

### 1. CRITICAL – Payment creation not wrapped in a single transaction

**Location:** [PaymentService.cs](backend/HexaBill.Api/Modules/Payments/PaymentService.cs) – `CreatePaymentAsync` (approx. lines 137–450)

**Issue:** Payment insert is committed with the first `SaveChangesAsync()`. Sale update, customer balance update, audit log, and idempotency record are applied later. There is no single `BeginTransactionAsync()` wrapping the whole operation. Comment at 187–189 explicitly says not to use user-initiated transactions with Npgsql retry. As a result:

- If the second `SaveChangesAsync()` fails (e.g. concurrency, constraint), the **payment is already persisted** but Sale.PaidAmount and Customer.Balance are not updated.
- `RecalculateCustomerBalanceAsync` is called in the middle and runs its **own** transaction (it commits inside BalanceService). So payment is committed, then balance is recalculated and committed, then the main context tries to save Sale + Customer + Audit. Customer was already updated by recalc; the main context also applied `customer.Balance -= request.Amount` earlier, so you can end up with mixed logic (manual decrement vs. full recalc) and risk double-applying or overwriting.

**Impact:** Invoice shows wrong PaidAmount; customer balance does not match payments; reconciliation and reporting are wrong; possible overpayment or “ghost” payments.

**Reproduction:**

1. Record a payment for an invoice (CASH/CLEARED).
2. Simulate failure after payment insert (e.g. throw before second SaveChanges, or force a concurrency exception on Sale).
3. Payment row exists; Sale.PaidAmount and Customer.Balance are unchanged or inconsistent.

**Fix:** Use a single database transaction for the entire payment flow (payment insert, sale update, customer balance update, audit, idempotency), and ensure it works with the execution strategy (e.g. wrap in `ExecuteStrategy().ExecuteAsync` with one `BeginTransactionAsync()` and single `SaveChangesAsync()` at the end, or use a transaction that the strategy can retry). Do not commit payment before sale and customer are updated. Prefer either full balance recalc inside that transaction or a single, consistent formula (e.g. only recalc, no manual `Balance -= amount` in the same flow).

---

### 2. CRITICAL – Invoice number advisory lock released before transaction commit

**Location:** [InvoiceNumberService.cs](backend/HexaBill.Api/Modules/Billing/InvoiceNumberService.cs) – `GenerateNextInvoiceNumberFallbackAsync` (lines 56–134)

**Issue:** `pg_advisory_lock(lockId)` is taken, then the next number is computed and the lock is released in a `finally` block. The lock is **released before** the caller (SaleService) inserts the Sale and commits. So two concurrent requests can both get the same “next” number (e.g. 1001), then both insert; one succeeds, the other hits the unique constraint and retries (retry logic exists), but the design is fragile under high concurrency.

**Impact:** Duplicate invoice number risk under concurrency; retries and duplicate-key handling can mask the issue; at scale, more conflicts and “unable to generate unique invoice number” errors.

**Reproduction:**

1. Two users (or two tabs) create a sale at the same time with auto-generated invoice number.
2. Both call `GenerateNextInvoiceNumberAsync`; both get the same number after the lock is released.
3. One insert succeeds; the other fails on unique and retries (may get 1002). If the unique index were missing, both could commit.

**Fix:** Use **transaction-scoped** advisory lock so it is held until the transaction that uses the number commits or rolls back. In PostgreSQL: `pg_advisory_xact_lock(lockId)` inside the same transaction that inserts the Sale (e.g. in SaleService, after beginning the transaction, call `ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(@p0)", lockId)` then generate the invoice number in the same transaction). Do not use a lock that is released before the insert/commit.

---

### 3. CRITICAL – Record payment: no row-level lock on Sale (race condition)

**Location:** [PaymentService.cs](backend/HexaBill.Api/Modules/Payments/PaymentService.cs) – `CreatePaymentAsync` (lines 196–240)

**Issue:** Outstanding is calculated as `invoiceSale.GrandTotal - actualPaidAmount` and then the payment is inserted. The Sale row is **not** locked (no `FOR UPDATE`). Two concurrent requests for the same invoice can both read the same `actualPaidAmount`, both see the same “remaining” balance, and both insert a payment that “fits,” so total payments can exceed GrandTotal.

**Impact:** Overpayment; invoice marked paid with more money received than total; customer balance can go negative or wrong; regulatory and reconciliation issues.

**Reproduction:**

1. Invoice total 1000 AED, paid 0. Two users each record 600 AED at the same time.
2. Both read actualPaidAmount = 0, realOutstanding = 1000; both pass the “amount <= realOutstanding” check.
3. Both payments are inserted; total paid = 1200, overpayment 200.

**Fix:** Lock the Sale row for the duration of the payment transaction. For example, load the sale with a lock:

```csharp
invoiceSale = await _context.Sales
    .FromSqlRaw("SELECT * FROM \"Sales\" WHERE \"Id\" = {0} AND \"TenantId\" = {1} FOR UPDATE", request.SaleId.Value, tenantId)
    .FirstOrDefaultAsync();
```

Or use a single UPDATE that decrements a “reserved” amount. Recompute outstanding and enforce “amount <= outstanding” **after** acquiring the lock and (if possible) inside the same transaction as the payment insert.

---

### 4. HIGH – Purchase duplicate check vs DB unique index mismatch

**Location:**  
- [PurchaseService.cs](backend/HexaBill.Api/Modules/Purchases/PurchaseService.cs) (lines 257–267): duplicate check on `(TenantId, SupplierName, InvoiceNo)`.  
- [AppDbContext.cs](backend/HexaBill.Api/Data/AppDbContext.cs) (line 145): `HasIndex(e => new { e.OwnerId, e.InvoiceNo }).IsUnique()`.

**Issue:** Service enforces “same supplier + same invoice no = duplicate.” DB enforces “same OwnerId + same InvoiceNo = unique” (no SupplierName). So:

- Same tenant, Supplier A invoice "001", Supplier B invoice "001": service allows both; DB allows only one. Second insert fails with unique violation.
- Same tenant, same supplier, same invoice: both service and DB reject (service throws first).

**Impact:** User can enter a valid-looking purchase (different supplier, same invoice number) and get a DB error instead of a clear validation message; support and UX suffer.

**Reproduction:**

1. Create purchase: Supplier A, Invoice "001". Success.
2. Create purchase: Supplier B, Invoice "001". Service passes; SaveChanges throws unique constraint on (OwnerId, InvoiceNo).

**Fix:** Either:

- Align DB with business rule: unique index on `(TenantId, SupplierName, InvoiceNo)` (and migrate existing data), or  
- Align service with DB: treat duplicate as “same TenantId + InvoiceNo” and validate with message “Invoice number already used for another supplier in this company.”

---

### 5. HIGH – CreatePaymentAsync: no explicit transaction (see #1)

**Location:** [PaymentService.cs](backend/HexaBill.Api/Modules/Payments/PaymentService.cs) – `CreatePaymentAsync`

**Issue:** Already described in #1. Multiple SaveChanges and a separate RecalculateCustomerBalanceAsync transaction mean partial commits and mixed balance logic.

**Fix:** As in #1: one transaction for payment + sale + customer + audit; one consistent balance update strategy.

---

### 6. HIGH – COGS uses current Product.CostPrice, not cost at time of sale

**Location:** [ProfitService.cs](backend/HexaBill.Api/Modules/Reports/ProfitService.cs) (lines 63–74), [ReportService.cs](backend/HexaBill.Api/Modules/Reports/ReportService.cs) (dashboard COGS)

**Issue:** COGS = Sum(SaleItems: Qty × ConversionToBase × **Product.CostPrice**). CostPrice is the **current** value. If the product’s cost was updated after the sale (e.g. new purchase), P&L and gross profit for past periods change retroactively.

**Impact:** Historical P&L is not stable; margins and profit can be wrong for reporting and VAT; audits may question accuracy.

**Reproduction:**

1. Sell product at 100 AED (cost was 60 at sale time). Profit 40.
2. Later, update cost to 80 (e.g. new purchase).
3. Re-run P&L for that period: COGS now uses 80; profit shows 20. Historical numbers have changed.

**Fix:** Store “cost at time of sale” on SaleItem (e.g. `UnitCost` or `CostAtSale`). Populate it when the sale is created from the product’s current CostPrice (or purchase cost). Use that field for COGS in P&L and reports instead of Product.CostPrice.

---

### 7. MEDIUM – Delete purchase: no check that stock can be reversed

**Location:** [PurchaseService.cs](backend/HexaBill.Api/Modules/Purchases/PurchaseService.cs) – `DeletePurchaseAsync` (lines 668–690)

**Issue:** Balance-after-delete is checked (so delete is blocked if it would leave negative supplier balance). Stock is reversed with `StockQty -= baseQty` but there is **no** check that current `StockQty >= baseQty` for each product. If part of the purchased stock was already sold, reversal can make StockQty negative.

**Impact:** Negative stock; inventory reports and stock-based validations wrong; possible overselling.

**Reproduction:**

1. Purchase 10 units of product X; stock becomes 10.
2. Sell 8 units; stock becomes 2.
3. Delete the original purchase; code does StockQty -= 10; stock becomes -8.

**Fix:** Before reversing stock, for each purchase item check `product.StockQty >= baseQty` (or use an atomic UPDATE ... WHERE StockQty >= baseQty and check rows affected). If any product would go negative, throw a clear error: “Cannot delete: product X has only Y units; this purchase added Z. Reverse sales first or adjust stock.”

---

### 8. MEDIUM – Idempotency key not scoped by tenant

**Location:** [PaymentService.cs](backend/HexaBill.Api/Modules/Payments/PaymentService.cs) (lines 149–152), [PaymentIdempotency](backend/HexaBill.Api) (if key is global)

**Issue:** Idempotency is looked up by `IdempotencyKey` only. If the key is not tenant-scoped (e.g. in the table or query), two tenants could share the same key and one could get the other’s cached response (wrong payment/invoice).

**Impact:** Cross-tenant data leak or wrong response if keys collide across tenants.

**Reproduction:** Tenant A and B both send Idempotency-Key "abc". First request creates payment for A. Second request (B) might return A’s payment if lookup is global.

**Fix:** Scope idempotency by tenant: e.g. unique (TenantId, IdempotencyKey) and always filter by CurrentTenantId in the lookup.

---

### 9. MEDIUM – BalanceService.RecalculateCustomerBalanceAsync: no tenant filter on customer load

**Location:** [BalanceService.cs](backend/HexaBill.Api/Modules/Customers/BalanceService.cs) – `RecalculateCustomerBalanceAsync` (line 53: `FindAsync(customerId)`)

**Issue:** Customer is loaded by Id only. If the caller passes a customerId from another tenant (e.g. bug or malicious request), balance would be recalculated for that customer using aggregates that do use `tenantId` from the loaded customer. So the recalculation itself is tenant-scoped once customer is loaded, but the **access control** (who can trigger recalc for which customer) depends on the caller. Controllers must ensure they only pass customerIds that belong to CurrentTenantId.

**Impact:** If any API allows passing an arbitrary customerId without tenant check, one tenant could trigger recalc for another tenant’s customer (or at least cause confusion).

**Fix:** Ensure every caller of RecalculateCustomerBalanceAsync resolves customerId from a tenant-scoped context (e.g. from an invoice or payment that already passed tenant checks). Optionally add a tenantId parameter and validate `customer.TenantId == tenantId` inside the method and throw if not.

---

### 10. LOW – Purchase create: duplicate (SupplierName + InvoiceNo) race

**Location:** [PurchaseService.cs](backend/HexaBill.Api/Modules/Purchases/PurchaseService.cs) (lines 257–267)

**Issue:** Duplicate check is a query without a lock. Two concurrent requests with same supplier + invoice can both pass the check and then one fails on DB unique (OwnerId, InvoiceNo). So no silent duplicate, but first request gets a clean “already exists” and second gets a DB exception unless you catch and translate.

**Fix:** Prefer a unique constraint on (TenantId, SupplierName, InvoiceNo) as in #4; then you can rely on DB and catch unique violation to return a friendly message. Optionally use serializable transaction or advisory lock when generating/checking purchase key to avoid two inserts racing.

---

## Summary Table

| # | Severity  | Area              | Issue |
|---|-----------|-------------------|--------|
| 1 | CRITICAL  | Payment            | No single transaction for payment + sale + customer |
| 2 | CRITICAL  | Invoice number     | Advisory lock released before commit |
| 3 | CRITICAL  | Payment            | No row lock on Sale → overpayment race |
| 4 | HIGH      | Purchase           | Duplicate check vs DB unique mismatch |
| 5 | HIGH      | Payment            | Same as #1 (transaction) |
| 6 | HIGH      | P&L / COGS         | COGS uses current cost, not at sale |
| 7 | MEDIUM    | Purchase delete    | Stock reversal can go negative |
| 8 | MEDIUM    | Payment idempotency| Key not tenant-scoped |
| 9 | MEDIUM    | Balance recalc     | Customer load not tenant-validated in method |
| 10| LOW       | Purchase           | Duplicate check race (DB still enforces) |

---

## What is already in good shape

- **Create Purchase:** Single transaction; product existence and TenantId checked; quantities and costs validated; stock updated with atomic SQL; inventory transactions and audit logged. Duplicate (SupplierName + InvoiceNo) is checked (with #4/#10 caveats).
- **Create Sale:** Serializable transaction; invoice number from service (with #2 caveat); stock validated then decremented with `WHERE StockQty >= baseQty` (atomic); customer and route validated; credit limit check; idempotency (ExternalReference) for duplicate detection.
- **Delete Purchase:** Wrapped in transaction; balance-after-delete check prevents negative supplier balance; stock reversed and inventory transactions removed; audit log. Missing only “stock reversal cannot go negative” check (#7).
- **Delete Sale:** Sale soft-delete; related payments removed and customer balance reversed; stock reversed; RecalculateCustomerBalanceAsync used.
- **ProfitService:** Tenant filter applied; formula Profit = Sales - COGS - Expenses; COGS from SaleItems × Product (only issue is use of current CostPrice – #6).
- **BalanceService:** Balance derived from Sales, Payments (CLEARED), Returns, Refunds; TenantId used in aggregates; RecalculateCustomerBalanceAsync uses transaction.
- **Controllers:** PurchasesController uses CurrentTenantId; Delete Purchase and Create Purchase have role restrictions (Admin/Owner etc.).
- **Raw SQL:** Purchase and Sale stock updates use `ExecuteSqlInterpolatedAsync` (parameterized), not string concatenation – SQL injection risk mitigated.

---

## Recommended fix order

1. **#3** – Add Sale row lock (FOR UPDATE) when recording payment and enforce amount <= outstanding inside that transaction.  
2. **#1 / #5** – Wrap full payment flow (payment + sale + customer + audit) in one transaction; remove double balance update (manual decrement vs recalc).  
3. **#2** – Use `pg_advisory_xact_lock` (or equivalent) so invoice number lock is held until the sale transaction commits.  
4. **#7** – Before reversing stock on purchase delete, ensure each product has StockQty >= reversal qty (or use atomic UPDATE and check rows affected).  
5. **#4** – Align Purchase unique constraint with business rule (TenantId + SupplierName + InvoiceNo) or align validation with current DB and message.  
6. **#6** – Add “cost at time of sale” on SaleItem and use it for COGS in P&L and reports.  
7. **#8** – Scope payment idempotency by TenantId (table + lookup).  
8. **#9** – Add tenant check in RecalculateCustomerBalanceAsync or enforce at every caller.

---

## Data integrity queries (run periodically)

```sql
-- 1. Negative stock
SELECT "Id", "NameEn", "StockQty" FROM "Products" WHERE "StockQty" < 0;

-- 2. Sales total mismatch (Subtotal + VatTotal vs Total)
SELECT "Id", "InvoiceNo", "Subtotal", "VatTotal", "GrandTotal",
       ("Subtotal" + "VatTotal" - "GrandTotal") AS diff
FROM "Sales" WHERE "IsDeleted" = false AND ABS("Subtotal" + "VatTotal" - "GrandTotal") > 0.01;

-- 3. Customer balance vs calculated (CLEARED payments, non-void)
SELECT c."Id", c."Name", c."Balance",
       (COALESCE((SELECT SUM(s."GrandTotal") FROM "Sales" s WHERE s."CustomerId" = c."Id" AND s."TenantId" = c."TenantId" AND NOT s."IsDeleted"), 0)
        - COALESCE((SELECT SUM(p."Amount") FROM "Payments" p WHERE p."CustomerId" = c."Id" AND p."TenantId" = c."TenantId" AND p."Status" = 'CLEARED' AND p."SaleReturnId" IS NULL), 0)
       ) AS calculated
FROM "Customers" c
HAVING ABS(c."Balance" - calculated) > 0.01;

-- 4. Duplicate invoice numbers (Sales)
SELECT "InvoiceNo", "TenantId", COUNT(*) FROM "Sales" WHERE NOT "IsDeleted" GROUP BY "InvoiceNo", "TenantId" HAVING COUNT(*) > 1;

-- 5. Purchases: duplicate (TenantId, SupplierName, InvoiceNo) if you add such index later
-- SELECT "TenantId", "SupplierName", "InvoiceNo", COUNT(*) FROM "Purchases" GROUP BY "TenantId", "SupplierName", "InvoiceNo" HAVING COUNT(*) > 1;
```

---

*Audit completed against the codebase as of the analysis date. Re-validate after applying fixes.*
