# Money Flow & Balance Formula Audit

This document summarizes the **real money flow** and **balance calculation** across the app, and the fixes applied so that returns and refunds are handled consistently everywhere.

## Correct balance formula (single source of truth)

**Pending balance (what the customer still owes):**

- **TotalSales** = sum of `Sales.GrandTotal` (non-deleted, for that customer/tenant).
- **TotalPayments** = sum of `Payments.Amount` where **Status = CLEARED** and **SaleReturnId == null** (exclude refund payments).
- **TotalSalesReturns** = sum of `SaleReturns.GrandTotal` (for that customer/tenant).
- **RefundsPaid** = sum of `Payments.Amount` where **SaleReturnId != null** (refund payments).

**Formula:**

```text
PendingBalance = TotalSales - TotalPayments - TotalSalesReturns + RefundsPaid
```

Returns reduce what the customer owes; refunds paid are money out, so they are added back when comparing to “cleared” payments (which exclude refunds).

---

## What was wrong and what was fixed

### 1. **BalanceService** (fixed)

- **Issue:** Used `PendingBalance = TotalSales - TotalPayments` and did not exclude refund payments from `TotalPayments` or subtract returns / add refunds.
- **Impact:** After returns/refunds, stored customer balance could be wrong. Incremental updates (invoice/payment created/deleted) also used this simplified formula and could overwrite the correct value.
- **Fix:**
  - `RecalculateCustomerBalanceAsync` now uses the full formula (with `TenantId`, `SaleReturnId`, `SaleReturns`).
  - All incremental update methods (`UpdateCustomerBalanceOnInvoiceCreatedAsync`, etc.) now call `RecalculateCustomerBalanceAsync` so every update uses the same formula.

### 2. **PdfService (invoice footer balance)** (fixed)

- **Issue:** `GetCustomerPendingBalanceInfoAsync` used `TotalBalanceDue = TotalSales - TotalPayments` and did not exclude refunds or include returns/refunds.
- **Impact:** Invoice PDF could show an incorrect “balance due” for customers with returns or refunds.
- **Fix:** Same formula as above: payments exclude refunds (`SaleReturnId == null`), and `TotalBalanceDue = TotalSales - TotalPayments - TotalSalesReturns + RefundsPaid`.

### 3. **DataValidationMiddleware** (fixed)

- **Issue:** Validation compared `StoredPendingBalance` to `TotalSales - TotalPayments` only.
- **Impact:** Customers with returns/refunds were reported as “balance mismatch” even when stored balance was correct.
- **Fix:** Validation now computes the correct formula (with `SaleReturns` and refund payments) per customer and compares to stored balance.

### 4. **ValidationService.ValidateCustomerBalanceAsync** (fixed)

- **Issue:** `calculatedBalance = totalSales - totalPayments` (no returns, no refunds, and payments did not exclude refunds).
- **Impact:** Validation and “fix balance” flows could use the wrong expected balance.
- **Fix:** Same formula: payments exclude `SaleReturnId != null`, and `calculatedBalance = totalSales - totalPayments - totalSalesReturns + refundsPaid`.

---

## Where the formula is already correct

- **CustomerService:** `RecalculateCustomerBalanceAsync` and `RecalculateAllCustomerBalancesAsync` already use the full formula (returns + refunds, payments exclude refunds).
- **ReportService:** `GetComprehensiveSalesLedgerAsync` uses the correct formula for pending balance and refunds in period.
- **Ledger (CustomerService):** `GetCustomerLedgerAsync` / `GetCashCustomerLedgerAsync` show return rows with correct status (Refunded / Credit Issued / Pending Refund) and refund payments as “Refund” (debit); balance logic is consistent.

---

## Branch / route “UnpaidAmount” (unchanged by this audit)

- **BranchService** and **RouteService** compute **UnpaidAmount** as `totalSales - totalPayments` for a **period** and **branch/route** (not per-customer balance).
- They do **not** currently subtract returns or add refunds for that period/branch/route. If you need “unpaid for branch/route in period” to include returns/refunds in that period, that would require separate changes (e.g. filter returns/refunds by branch/route and date).

---

## Summary

- **Single formula everywhere for customer balance:**  
  `PendingBalance = TotalSales - TotalPayments - TotalSalesReturns + RefundsPaid`  
  with **TotalPayments** = cleared payments only and **excluding** refund payments (`SaleReturnId == null`).
- **BalanceService, PdfService, DataValidationMiddleware, and ValidationService** now all use this formula, so:
  - Stored balance is correct after returns/refunds.
  - Invoice footer balance is correct.
  - Validation no longer reports false mismatches for customers with returns/refunds.
  - No double-counting of refunds and no treating returns as “unpaid” in these flows.

If you see any remaining mismatch or wrong calculation on a specific page or report, point to that screen/API and we can align it to this formula as well.
