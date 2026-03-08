# HexaBill – Duplicates, Pending, and Owner/Staff Improvements

**Purpose:** Single place for duplicate issues, pending work, and best features to add for Owner vs Staff.

---

## 1. DUPLICATE ISSUES (UI / PAGES / FUNCTIONS)

| Type | Where | Notes |
|------|--------|--------|
| **Icon reuse** | Layout.jsx | "Sales Ledger" and "Backup & Restore" both use `FileText`. Consider using `Archive` or `Database` for Backup to distinguish. |
| **Routes to same page** | App.jsx | `/reports` and `/reports/outstanding` both render `ReportsPage`. Not a bug – outstanding is a deep link; keep as is. |
| **No duplicate pages** | – | No duplicate component files (e.g. only one SuppliersPage, one CustomerLedgerPage). |
| **No duplicate API endpoints** | – | Supplier create is single POST /suppliers; no duplicate supplier or ledger endpoints found. |

**Verdict:** No critical duplicates. Optional: give Backup & Restore a different icon.

---

## 2. PENDING / TODO ITEMS (FROM CODEBASE)

| Priority | Item | Location | Suggestion |
|----------|------|----------|------------|
| **High** | Overdue on purchases | SupplierService.cs ~205 | Add due date to Purchase; compute Overdue in supplier summary. |
| **High** | VAT from company settings | PurchasesPage, PosPage, SaleService | Already use settings with fallback; ensure Settings has VAT% and it’s used everywhere. |
| **Medium** | Recurring expense: create/edit/delete | ExpensesPage.jsx ~1453, 1483, 1492 | Wire "Create recurring", "Edit", "Delete" to APIs or modals. |
| **Medium** | Export endpoints for reports | ReportsPage.jsx (branch, aging, cheque) | Add backend export (e.g. Excel/PDF) for branch, aging, cheque reports. |
| **Medium** | Feedback submit | FeedbackPage.jsx ~40 | Implement API call to submit feedback. |
| **Low** | Backup: Google Drive / email | ComprehensiveBackupService, SuperAdminController | Optional: implement Google Drive upload and email send for backups. |
| **Low** | PDF library | PdfService.cs ~1084 | Note to use a proper HTML-to-PDF library if needed. |
| **Low** | Invoice version restore | SaleService.cs ~2491 | Restore old items from version.DataJson when needed. |

---

## 3. OWNER VS STAFF – WHAT STAFF CAN DO TODAY

- **Staff can access:** Dashboard, Products, POS, Customer Ledger, Sales Ledger, Expenses, Help.  
- **Staff cannot access (hidden or redirected):** Branches & Routes, Users, Purchases, Suppliers, Reports, Settings, Backup & Restore.

So Staff can:
- Sell (POS), record expenses, view customer ledger and sales ledger, view products.
- Not: manage branches/routes, users, purchases, suppliers, reports, settings, or backup.

---

## 4. BEST FEATURES TO ADD (OWNER & STAFF BETTER)

### For owners (and admins)

| # | Feature | Why |
|---|---------|-----|
| 1 | **Overdue on supplier summary** | Show which supplier balances are past due (needs Purchase.DueDate + calculation). |
| 2 | **VAT % in Settings** | Single place to set default VAT; used in Purchases, POS, and reports. |
| 3 | **Report exports (Excel/PDF)** | Branch, aging, cheque reports – export for accountants. |
| 4 | **Recurring expenses UI** | Create / edit / delete recurring expenses from Expenses page. |
| 5 | **Dashboard “today” summary** | Today’s sales, collections, expenses on one card. |
| 6 | **Supplier ledger from Purchases** | From a purchase row, “Open supplier ledger” to jump to that supplier’s ledger. |

### For staff

| # | Feature | Why |
|---|---------|-----|
| 1 | **Route-only view** | Staff see only their assigned route(s) in Customer Ledger, Sales Ledger, POS (already partially there via branches/routes). Verify filters are strict. |
| 2 | **Daily collection target** | Show “Today’s collection target” vs “Collected” on POS or ledger so staff know how they’re doing. |
| 3 | **Simple “My day” view** | One screen: my route, today’s visits, today’s sales, today’s expenses (read-only for expenses if needed). |
| 4 | **Limited Reports for Staff** | Optional: allow Staff to see a single “My sales” or “My collections” report (no company-wide reports). |
| 5 | **Clear role label** | In header or profile: show “Logged in as Staff” or “Route: X” so staff see their context. |

### For both

| # | Feature | Why |
|---|---------|-----|
| 1 | **Feedback form** | Submit feedback from the app (wire FeedbackPage to API). |
| 2 | **Offline / PWA (optional)** | Cache products and customers for POS when network is weak. |
| 3 | **Keyboard shortcuts** | E.g. F3 for customer search on POS (if not already). |

---

## 5. RECOMMENDED PRIORITY ORDER

1. **Quick wins**  
   - Fix Backup & Restore icon (optional).  
   - Ensure VAT % is configurable in Settings and used in Purchases/POS.

2. **High value for owners**  
   - Overdue in supplier summary (Purchase.DueDate + logic).  
   - Report exports for branch/aging/cheque.

3. **Staff experience**  
   - Confirm route-only data in Ledger/POS.  
   - Add “My day” or “Today’s target vs collected” for staff.

4. **Then**  
   - Recurring expenses UI.  
   - Feedback API.  
   - Optional: Supplier ledger link from purchase row.

---

*Summary: No critical duplicate pages or APIs. A few TODOs (overdue, VAT, recurring expenses, exports, feedback). Biggest gains: owner = overdue + exports + VAT in Settings; staff = route-only clarity + daily target/“My day” view.*
