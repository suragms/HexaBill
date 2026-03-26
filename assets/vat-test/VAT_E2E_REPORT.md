# VAT Return E2E Test Report

**Date**: 2026-03-12  
**Plan**: Browser VAT Return Flow Verification

---

## Summary

| Phase | Status | Notes |
|-------|--------|------|
| Pre-test (DB, migrations) | ✅ Complete | Local uses SQLite; migrations have duplicate-column errors but app runs |
| Owner credentials | ✅ Complete | `owner1@hexabill.com` / `Owner1@123` - login verified |
| Backend + Frontend | ✅ Running | API: 5000, UI: 5173 |
| Login, create sale | ⚠️ Partial | Login OK; POS Add Product Row blocked by fixed bottom nav |
| Screenshots | ⚠️ Partial | 01, 03, 04 captured (04 shows VAT error) |
| VAT vs Ledger | ⏸️ Blocked | VAT Return failed; cannot compare |
| REAL vs FALSE | ⏸️ Blocked | See below |

---

## Findings

### 1. VAT Return API Error (REAL BUG – FIXED)

**Error**: `SQLite Error 1: 'no such table: VatReturnPeriods'`

**Cause**: Local dev uses SQLite. Migration `20260310151454_AddVatReturnEngineFields` creates `VatReturnPeriods`, but migrations fail due to duplicate column errors. The table was never created.

**Fix applied**: Added SQLite startup creation in `Program.cs` (lines ~753–790). On SQLite, the app now runs:

- `CREATE TABLE IF NOT EXISTS VatReturnPeriods (...)`
- Indexes for `TenantId` and `TenantId_PeriodStart_PeriodEnd`

**Action required**: **Restart the backend** for the fix to take effect.

---

### 2. POS Add Product Row Blocked (REAL UX BUG)

**Issue**: The fixed bottom navigation bar overlaps the "Add Product Row" button. Clicks are intercepted by the nav.

**Fix applied**:
- `PosPage.jsx`: Added `pb-24 lg:pb-0` to root div and `pb-20 lg:pb-2` to Add Row container.
- Helps on some viewports; browser automation may still hit the nav.

**Workaround**: Create a sale via API (see `create-sale-for-vat-test.js`).

---

### 3. Sales Ledger

- Date range: 2026-01-01 to 2026-03-31 (Q1 2026)
- Result: "No transactions found" (expected with no sales)

---

### 4. Analysis – REAL vs FALSE

| Check | Result | Verdict |
|-------|--------|---------|
| VAT shows 0 when Ledger has data | N/A | No sales created |
| Date alignment | N/A | Not testable until sale exists |
| VatReturnPeriods table | Fixed | Startup creation added for SQLite |

**Conclusion**: Cannot determine whether there was a VAT vs Ledger mismatch until:
1. Backend is restarted (VatReturnPeriods fix).
2. At least one sale is created in Q1 2026.

---

## Screenshots

- `01-login-dashboard.png` – Post-login (if saved)
- `03-sales-ledger-with-data.png` – Sales Ledger (no data)
- `04-vat-return-overview.png` – VAT error screen

---

## Next Steps (Re-test)

1. **Restart backend** – Required for VatReturnPeriods table creation.
2. **Create sale**: Use POS (ensure Add Product Row is visible, or resize to lg+ to hide bottom nav) or run:
   ```powershell
   # Get token: Login at http://localhost:5173, DevTools > Application > Local Storage
   $token = "paste-your-jwt-here"
   $env:TOKEN = $token
   node assets/vat-test/create-sale-for-vat-test.js
   ```
3. Open **VAT Return** → select Q1 2026 → Apply.
4. Compare Box 1a/1b with Sales Ledger totals (same date range).

---

## Code Changes Summary

| File | Change |
|------|--------|
| `backend/HexaBill.Api/Program.cs` | SQLite: create VatReturnPeriods table at startup if missing |
| `frontend/hexabill-ui/src/pages/company/PosPage.jsx` | Bottom padding for Add Product Row above fixed nav |
