# Data Assurance: VAT Return, Sales Ledger, Purchases & Expenses

**Purpose:** Ensure Sales Ledger, Purchase page, Expenses page, and VAT Return use the **same data sources**, **same date logic**, and **same tenant isolation** so there are **no mismatches**. All four must show consistent numbers for a given period.

---

## 1. Data Sources & Date Columns

| Page / Report   | Table(s)       | Date Column    | Tenant Filter                                      |
|-----------------|----------------|----------------|----------------------------------------------------|
| **Sales Ledger**| `Sales`        | `InvoiceDate`  | `TenantId == X OR (TenantId IS NULL AND OwnerId == X)` |
| **VAT Return**  | Sales          | `InvoiceDate`  | Same as above                                      |
| **Purchases**   | `Purchases`    | `PurchaseDate` | `TenantId == X OR (TenantId IS NULL AND OwnerId == X)` |
| **Expenses**    | `Expenses`     | `Date`         | Same pattern                                       |
| **VAT Return**  | Purchases      | `PurchaseDate` | Same                                               |
| **VAT Return**  | Expenses       | `Date`         | Same                                               |

---

## 2. Date Range Convention & Period Rules

### VAT period rules (enforced by backend + frontend)

- **Allowed periods:** FTA quarters (Feb–Apr, May–Jul, Aug–Oct, Nov–Jan) or full calendar year (01-Jan to 31-Dec).
- **`toDate` = exclusive end:** Backend always uses `to = lastDay.AddDays(1) 00:00` so the last day is included.
- **Fallback (no from/to/quarter/year):** Last 3 months including **today** — `toDate` must be `today.AddDays(1)` so today’s sales are not excluded.

---

## 3. Date Range Convention (technical)

All APIs receive **inclusive** dates as `YYYY-MM-DD` from the frontend.

| Convention | Meaning | Use Case |
|------------|---------|----------|
| **Exclusive end** | `from = 2025-01-01 00:00`, `to = 2026-01-01 00:00` (exclusive) | Sales: `InvoiceDate >= from AND InvoiceDate < to` |
| **Inclusive end** | `toEnd = 2025-12-31 23:59:59.9999999` | Purchases / Expenses: `Date >= from AND Date <= toEnd` |
| **Calendar dates** | `DateOnly.FromDateTime(col) >= fromOnly AND <= toOnly` | VAT Return purchases/expenses (avoids timezone edge cases) |

---

## 4. Per-Module Logic (Backend)

### 4.1 Sales Ledger (`ReportService.GetComprehensiveSalesLedgerAsync`)

- **Input:** `fromDate`, `toDate` (inclusive YYYY-MM-DD).
- **Range:**
  - `from = fromDate.ToUtcKind()` (start of first day)
  - `to = toDate.AddDays(1).AddTicks(-1).ToUtcKind()` (last tick of last day)
- **Filter:** `InvoiceDate >= from AND InvoiceDate < to` (via `GetSalesLedgerSalesRawAsync`).

**Note:** The raw SQL uses `InvoiceDate < to`. With `to = end-of-day`, this correctly includes all sales on the last day. The implementation uses `to = toDate.AddDays(1).AddTicks(-1)` so `to` is end-of-day; the actual filter in the SQL is `InvoiceDate < to` — wait, that would exclude sales at 23:59:59.999. Let me check...

Actually in ReportService line 2358: `to = (toDate ?? ...).AddDays(1).AddTicks(-1)`. So if toDate = 2025-12-31 00:00, then to = 2025-12-31 23:59:59.9999999. The raw SQL uses `InvoiceDate < to`. So we get `InvoiceDate < 2025-12-31 23:59:59.9999999` — that includes 2025-12-31 00:00 through 2025-12-31 23:59:59.9999998. Good.

### 4.2 VAT Return – Sales (`VatReturnReportService.GetSalesInPeriodForVatAsync`)

- **Range:** `from = fromDate.ToUtcKind()`, `to = toDate.ToUtcKind()` where controller passes `toDate = lastDay.AddDays(1) 00:00` (exclusive).
- **Filter:** `InvoiceDate >= from AND InvoiceDate < to`.
- **CRITICAL:** Uses the **same SQL** as `ReportService.GetSalesLedgerSalesRawAsync` so VAT Return and Sales Ledger **always match**.

### 3.3 VAT Return – Purchases

- **Range:** `fromDateOnly = DateOnly.FromDateTime(from)`, `toDateOnly = DateOnly.FromDateTime(to.AddDays(-1))`.
- **Filter:** `DateOnly.FromDateTime(PurchaseDate) >= fromDateOnly AND DateOnly.FromDateTime(PurchaseDate) <= toDateOnly`.
- **Inclusion:** Only `IsTaxClaimable == true` and `VatTotal > 0` (or derived) contribute to Box 9b.
- **Aligns with Purchase page** for the same calendar period.

### 4.4 VAT Return – Expenses

- **Range:** Same `fromDateOnly` / `toDateOnly` as purchases.
- **Filter:** `DateOnly.FromDateTime(e.Date) >= fromDateOnly AND DateOnly.FromDateTime(e.Date) <= toDateOnly`.
- **Inclusion:** Only `Status == Approved`, `IsTaxClaimable == true`, and claimable VAT in period.
- **Aligns with Expenses page** for the same calendar period.

### 3.5 Purchase Page (`PurchaseService.GetPurchasesAsync`)

- **Input:** `startDate`, `endDate` (inclusive).
- **Range:** `startDate.ToUtcKind()`, `endOfDay = endDate.AddDays(1).AddTicks(-1)`.
- **Filter:** `PurchaseDate >= startDate AND PurchaseDate <= endOfDay`.
- **Result:** Same purchases as VAT Return for the same from/to dates.

### 4.6 Expenses Page (`ExpenseService.GetExpensesAggregatedAsync` / `GetExpensesAsync`)

- **Input:** `fromDate`, `toDate` (inclusive).
- **Range:** `from = start of first day`, `to = toDate.AddDays(1).AddTicks(-1)`.
- **Filter:** `e.Date >= from AND e.Date <= to`.
- **Result:** Same expenses as VAT Return for the same from/to dates (VAT Return further filters by Approved and IsTaxClaimable).

---

## 5. Shared Date Helper

**File:** `backend/HexaBill.Api/Shared/Services/ReportDateRangeService.cs`

Use this for **all** report date ranges:

- `ToExclusiveRange(from, to)` → `(fromUtc, toUtcExclusive)` for Sales.
- `ToInclusiveEndRange(from, to)` → `(fromUtc, toEndOfDayUtc)` for Purchases/Expenses.
- `ToDateOnlyRange(from, to)` → `(fromOnly, toOnly)` for calendar-date comparisons.

---

## 6. Frontend Date Passing

| Page         | Params             | Format   |
|--------------|--------------------|----------|
| Sales Ledger | `fromDate`, `toDate` | YYYY-MM-DD |
| VAT Return   | `from`, `to`       | YYYY-MM-DD |
| Purchases    | `startDate`, `endDate` | YYYY-MM-DD |
| Expenses     | `fromDate`, `toDate` | YYYY-MM-DD |

All use the same `YYYY-MM-DD` strings; backend parses them consistently.

---

## 7. Validation & Diagnostics

- **VatReturnValidationService** rule `V-PURCH-EXP-ZERO`: warns when Box 12 = 0 but purchases or expenses exist in the period.
- **VatReturn201Dto**: `PurchaseCountInPeriod`, `ExpenseCountInPeriod` help debug “purchases/expenses exist but VAT shows 0”.
- **Logging:** VAT return logs `OutputLines`, `InputLines`, `Box1a`, `Box9b`, `Box12` for traceability.

---

## 7. Checklist for No Mismatches

- [ ] Same tenant filter: `TenantId == X OR (TenantId IS NULL AND OwnerId == X)`.
- [ ] Same period: user selects e.g. `2025-01-01` to `2025-12-31` everywhere.
- [ ] Sales: VAT Return and Sales Ledger use the same raw SQL / same `InvoiceDate` filter.
- [ ] Purchases: VAT Return and Purchase page both include all rows in the calendar period (VAT Return then filters by `IsTaxClaimable`).
- [ ] Expenses: VAT Return and Expenses page both include all rows in the calendar period (VAT Return then filters by `Approved` and `IsTaxClaimable`).

---

## 9. Summary

| Consumer     | Sales Source   | Purchase Source | Expense Source | Date Logic          |
|-------------|----------------|-----------------|----------------|---------------------|
| Sales Ledger| Sales (InvoiceDate) | N/A           | N/A             | Exclusive end       |
| VAT Return  | Same as Ledger | Purchases       | Expenses       | Sales: exclusive; P/E: DateOnly |
| Purchase Page | N/A          | Purchases       | N/A             | Inclusive end-of-day |
| Expenses Page  | N/A          | N/A             | Expenses       | Inclusive end-of-day |

**Result:** For a given period (e.g. 2025-01-01 to 2025-12-31), Sales Ledger and VAT Return sales match; Purchase page and VAT Return purchases match (VAT Return further filters tax-claimable); Expenses page and VAT Return expenses match (VAT Return further filters approved + tax-claimable).
