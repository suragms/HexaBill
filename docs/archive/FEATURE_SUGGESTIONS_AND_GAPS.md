# HexaBill – Feature Suggestions, Gaps & Business-Owner View

**Purpose:** Analyze current code and flow, list what’s missing, what to avoid, what to add, and which pages to plan — from a **business owner** perspective.

---

## 1. Current state (short)

- **Sales:** POS → create sale → stock & customer balance updated. Customer Ledger shows invoices, payments, delete (Admin/Owner). Sales Ledger lists sales; returns supported.
- **Purchases & suppliers:** Create purchase; Supplier Ledger with balance, transactions, record payment (FIFO). **Recently added:** data cards (outstanding, unpaid bills), Edit/Delete supplier (Admin/Owner) with confirmation.
- **Reports:** Summary, sales, P&amp;L, outstanding (customers), aging (receivables), stock, expenses, branch comparison, staff performance. Export PDF/Excel/CSV. Profit hidden from Staff.
- **Expenses, customers, products, branches/routes, users, backup:** Present with role-based access. Staff cannot access Purchases, Suppliers, Users, Settings, Backup, Branches, Routes.

---

## 2. What’s missing / what to avoid

### Missing

| Area | Gap | Impact |
|------|-----|--------|
| **Billing History** | `BillingHistoryPage.jsx` exists but is **not** in `App.jsx` routes | Page is dead unless linked; users can’t open “Billing History” from app. |
| **AP aging** | Reports have **customer** aging (receivables). No **Accounts Payable aging** (supplier-wise by age). | Owner can’t see “how much we owe to whom and how old” in one report. |
| **Supplier-wise outstanding report** | No report that aggregates outstanding by supplier (like aging but for payables). | Harder to prioritize which suppliers to pay first. |
| **Tenant audit in UI** | Audit exists in backend/Super Admin; **tenant users** don’t see “who changed what” in their company. | Less transparency for corrections and compliance. |
| **Confirmations** | Some flows still use `window.confirm` (Users delete, Customer refund, overpayment, category delete, ProductForm). | Inconsistent UX; better to use `ConfirmDangerModal` everywhere. |
| **Record payment role** | Supplier “Record Payment” API has no role check; any tenant user can call it. Staff can’t open Suppliers in nav, but API doesn’t enforce. | Small security gap if Staff get access later or via direct API. |
| **Void vs delete invoice** | Only “delete” exists; no “void” (mark as cancelled, keep for audit). | Business may want to keep a record of cancelled invoices. |
| **Export from lists** | Purchases list and Expenses list don’t have “Export CSV” in UI (reports do). | Less convenient for ad‑hoc analysis. |

### Avoid

- **Don’t** add balance/total logic only on the client — keep single source of truth on server (you already do).
- **Don’t** skip confirmation on any destructive action (delete payment, delete user, delete invoice, deactivate supplier, etc.).
- **Don’t** expose profit/P&amp;L or sensitive reports to Staff without product decision (currently hidden — keep or document).
- **Don’t** allow Owner/Admin–only actions without checking `IsAdmin`/`IsOwner` on the backend (you already do for supplier update/delete).

---

## 3. What to add (prioritized)

### High (business impact)

1. **Accounts Payable aging (or supplier outstanding) report**  
   - Backend: either extend aging to suppliers (buckets 0–30, 31–60, 61–90, 90+) or add a “supplier outstanding” report.  
   - Frontend: new tab/section in Reports (e.g. “Outstanding (Payables)” or “AP Aging”) with table and optional export.

2. **Wire Billing History into the app**  
   - Add route in `App.jsx`, e.g. `/billing-history` or `/ledger/history`, and a nav link (e.g. under Sales or Ledger) so owners can open “Billing History”.

3. **Tenant-facing audit (optional)**  
   - Expose a simple “Activity log” or “Audit” in Settings or Reports (Admin/Owner): who did what and when (e.g. “User X deleted invoice Y”, “User Z recorded payment”). Backend already has audit; need a tenant-scoped API and a small UI.

### Medium (UX & consistency)

4. **Replace remaining `window.confirm` with `ConfirmDangerModal`**  
   - UsersPage (delete user), CustomerLedgerPage (cash refund), SupplierDetailPage (overpayment), ProductForm, SupplierLedgerModal, ProductsPage (category delete).  
   - Same copy and “Cancel / Confirm” pattern as elsewhere.

5. **Optional: Restrict supplier Record Payment to Admin/Owner**  
   - In `SuppliersController`, add role check on `RecordPayment` (e.g. `[Authorize(Roles = "Admin,Owner")]` or use `IsAdmin`) if you want only owners/admins to record supplier payments.

6. **Export from Purchases and Expenses lists**  
   - “Export CSV” on Purchases page and Expenses page (current filters), calling existing or new export endpoints so owners can pull lists into Excel.

### Lower (nice to have)

7. **Void invoice**  
   - Add “Void” (mark as cancelled, no stock reversal or balance change if already applied, or with a defined rule). Keeps audit trail without “deleting”.

8. **Dashboard / Reports: link to AP**  
   - On Dashboard or Reports summary, a small card or link “Payables: AED X” linking to Suppliers or the new AP aging report.

---

## 4. Page-by-page plan (what to touch)

| Page | Suggest |
|------|--------|
| **App.jsx** | Add route for `BillingHistoryPage` (e.g. `/billing-history`) and ensure nav links to it where it makes sense. |
| **ReportsPage** | Add tab or section “Outstanding (Payables)” / “AP Aging” when backend is ready; reuse existing export pattern. |
| **SupplierDetailPage** | Replace overpayment `window.confirm` with `ConfirmDangerModal` (optional, medium priority). |
| **SuppliersPage** | Already has data cards, Edit, Delete with confirmation; no change needed for current plan. |
| **CustomerLedgerPage** | Replace refund `window.confirm` with `ConfirmDangerModal`. |
| **UsersPage** | Replace delete user `window.confirm` with `ConfirmDangerModal`. |
| **ProductsPage** | Replace category delete `window.confirm` with `ConfirmDangerModal`. |
| **ProductForm** | Replace any `window.confirm` with `ConfirmDangerModal`. |
| **SupplierLedgerModal** | Replace `window.confirm` with `ConfirmDangerModal`. |
| **Layout / nav** | Add “Billing History” link (e.g. under Sales or Ledger) if you add the route. |
| **PurchasesPage** | Add “Export CSV” button (and optional date range) that exports current list. |
| **ExpensesPage** | Add “Export CSV” for current list. |
| **Settings or Reports** | If you add tenant audit API, add a simple “Activity log” / “Audit” view (Admin/Owner). |

---

## 5. Business-owner checklist

- **Real profit:** P&amp;L and profit reports exist (Sales − COGS − Expenses). Dashboard and Reports show profit for Admin/Owner. ✅  
- **Who owes us (receivables):** Outstanding and Aging reports. ✅  
- **Who we owe (payables):** Supplier Ledger per supplier ✅; **missing:** one AP aging / supplier-outstanding report.  
- **Edit/delete with care:** Suppliers: Edit + Delete (soft) with confirmation ✅. Invoices: Delete with confirmation ✅. Payments: confirmations in place; standardize remaining with `ConfirmDangerModal`.  
- **Backup/restore:** Present with clear warning. ✅  
- **Audit:** Backend/Super Admin ✅; tenant-visible audit = optional add.  
- **Growth:** Reports (P&amp;L, margins, branch comparison, staff performance) support decisions. Adding AP aging and Billing History improves payables and billing visibility.

---

## 6. Summary

- **Do next:**  
  - Add **AP aging (or supplier outstanding) report** and **wire Billing History** into routes and nav.  
  - Optionally **replace remaining `window.confirm`** with `ConfirmDangerModal` and add **Export CSV** on Purchases and Expenses lists.  
- **Keep doing:** Server-side balances, Admin/Owner checks on destructive/sensitive actions, confirmation on deletes.  
- **Avoid:** Client-only totals, unconfirmed destructive actions, exposing profit to Staff unless intended.

File paths: `frontend/hexabill-ui/src/App.jsx`, `pages/company/ReportsPage.jsx`, `BillingHistoryPage.jsx`, `SuppliersController.cs`, `ReportService.cs` / `ReportsController.cs`, and the pages listed in the table above.
