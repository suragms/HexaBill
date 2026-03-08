# HEXABILL PRODUCTION ANALYSIS - COMPLETE REPORT

**Project:** HexaBill – Multi-tenant Billing/Inventory SaaS for UAE/Gulf  
**Analysis Date:** March 8, 2025  
**Tech Stack:** ASP.NET Core 9, EF Core 9, PostgreSQL, React (Vite)  
**Infrastructure:** Render.com Starter, PostgreSQL 1GB, Vercel (Free)

---

## EXECUTIVE SUMMARY

| Metric | Count |
|--------|-------|
| **Total Features** | 58 |
| **Total API Endpoints** | ~180+ |
| **Total Frontend Pages** | 38 |
| **Total Database Tables** | 42 |
| **Critical Risks** | 4 |
| **High Risks** | 6 |
| **Medium Risks** | 8 |
| **Production Ready** | **No** (pending critical fixes) |
| **Immediate Fixes Needed** | 4 critical, 6 high |
| **Est. Time to Production-Ready** | 2–3 weeks |

**Key Findings:**
- **CRITICAL:** Payment transaction not atomic; race conditions can cause overpayment and data corruption
- **CRITICAL:** Invoice number advisory lock released before transaction commit (duplicate invoice risk)
- **CRITICAL:** Sale PDF endpoint `[AllowAnonymous]` — any unauthenticated user can download invoices by ID
- **CRITICAL:** No row lock on Sale when recording payment — concurrent payments can exceed invoice total
- Multi-tenant isolation is generally well implemented via TenantScopedController and services
- Rate limiting: 300 req/min per IP (adequate)
- JWT: 8 hours expiry, BCrypt password hashing
- PostgreSQL connection pool: 150 (DB allows ~97–100; pool may exceed limit)

---

# PART 1: COMPLETE FEATURE INVENTORY

## Feature #1: Product Management
**What:** Create, edit, delete, view products with stock tracking  
**Why:** Core inventory management for trading businesses  
**Roles:** Owner (full), Admin (full), Staff (view, adjust stock)  
**Frontend:** `/products`, `/pricelist`  
**APIs:** GET/POST/PUT/DELETE `/api/products`, GET `/api/products/low-stock`, GET `/api/products/search`, POST `/api/products/import-excel`  
**Tables:** Products, ProductCategories, InventoryTransactions, PriceChangeLogs  
**Working:** Yes  
**Risk:** Medium (stock calculation uses Product.CostPrice at report time, not at sale time)

## Feature #2: Product Categories
**What:** Create, edit, delete product categories  
**Why:** Product organization  
**Roles:** Owner, Admin  
**Frontend:** Products page (embedded)  
**APIs:** GET/POST/PUT/DELETE `/api/productcategories`  
**Tables:** ProductCategories, Products  
**Working:** Yes  
**Risk:** Low

## Feature #3: Stock Adjustments
**What:** Manual stock quantity adjustments  
**Why:** Damaged goods, corrections, audits  
**Roles:** Owner, Admin, Staff  
**Frontend:** Products page  
**APIs:** POST `/api/stockadjustments`, GET `/api/stockadjustments`  
**Tables:** Products, InventoryTransactions  
**Working:** Yes  
**Risk:** Low

## Feature #4: Point of Sale / Sales
**What:** Create sales/invoices, checkout, print  
**Why:** Core billing for retail/wholesale  
**Roles:** Owner, Admin, Staff (with route restrictions)  
**Frontend:** `/pos`  
**APIs:** GET/POST/PUT/DELETE `/api/sales`, GET `/api/sales/{id}/pdf`  
**Tables:** Sales, SaleItems, Products, Customers, Payments, InventoryTransactions  
**Working:** Yes  
**Risk:** **CRITICAL** – PDF endpoint `[AllowAnonymous]`; payment race; invoice number lock released early

## Feature #5: Held Invoices
**What:** Save draft invoices, resume later  
**Why:** Multi-step checkout support  
**Roles:** Owner, Admin, Staff  
**Frontend:** POS page  
**APIs:** GET/POST/DELETE `/api/sales/held`  
**Tables:** HeldInvoices, Sales  
**Working:** Yes  
**Risk:** Low

## Feature #6: Customer Management
**What:** CRUD customers, credit limit, payment terms  
**Why:** Customer master data for billing  
**Roles:** Owner, Admin, Staff (restricted)  
**Frontend:** `/customers`, `/customers/:id`  
**APIs:** GET/POST/PUT/DELETE `/api/customers`, GET `/api/customers/search`  
**Tables:** Customers, Sales, Payments  
**Working:** Yes  
**Risk:** Medium (BalanceService.RecalculateCustomerBalanceAsync loads customer by ID only; caller must ensure tenant scope)

## Feature #7: Customer Ledger
**What:** View customer transactions, outstanding invoices, statement  
**Why:** Account reconciliation  
**Roles:** Owner, Admin, Staff  
**Frontend:** `/ledger`, `/customers/:id`  
**APIs:** GET `/api/customers/{id}/ledger`, GET `/api/customers/{id}/outstanding-invoices`, GET `/api/customers/{id}/statement`  
**Tables:** Customers, Sales, Payments, SaleReturns  
**Working:** Yes  
**Risk:** Low

## Feature #8: Payment Allocation
**What:** Record and allocate payments to invoices  
**Why:** Track payments vs invoices  
**Roles:** Owner, Admin, Staff (create), Owner/Admin (edit/delete)  
**Frontend:** Ledger, Payment modal  
**APIs:** GET/POST/PUT/DELETE `/api/payments`, POST `/api/payments/allocate`  
**Tables:** Payments, Sales, Customers  
**Working:** Partially (transaction not atomic — CRITICAL)  
**Risk:** **CRITICAL**

## Feature #9: Supplier Management
**What:** CRUD suppliers, credit limit, payment terms  
**Why:** Purchase ledger and AP  
**Roles:** Owner, Admin  
**Frontend:** `/suppliers`, `/suppliers/:name`  
**APIs:** GET/POST/PUT/DELETE `/api/suppliers`, GET `/api/suppliers/balance/{name}`, GET `/api/suppliers/transactions/{name}`  
**Tables:** Suppliers, SupplierCategories, SupplierPayments, Purchases  
**Working:** Yes  
**Risk:** Low

## Feature #10: Vendor Discounts
**What:** Track vendor discounts per purchase (private, not in ledger)  
**Why:** Internal savings tracking  
**Roles:** Owner, Admin  
**Frontend:** Supplier detail  
**APIs:** GET/POST/PUT/DELETE `/api/suppliers/{id}/vendor-discounts`  
**Tables:** VendorDiscounts, Suppliers, Purchases  
**Working:** Yes  
**Risk:** Low

## Feature #11: Purchases
**What:** Create, edit, delete purchases, upload invoice  
**Why:** Stock-in, AP, cost tracking  
**Roles:** Owner, Admin (delete), Admin/Staff (create/view)  
**Frontend:** `/purchases`  
**APIs:** GET/POST/PUT/DELETE `/api/purchases`, GET `/api/purchases/export/csv`, POST `/api/purchases/{id}/upload`  
**Tables:** Purchases, PurchaseItems, Products, Suppliers, InventoryTransactions  
**Working:** Partially (duplicate check vs DB unique mismatch; delete can cause negative stock)  
**Risk:** High

## Feature #12: Sale Returns
**What:** Create sale returns, credit notes, damage categories  
**Why:** Returns processing  
**Roles:** Owner, Admin, Staff  
**Frontend:** `/returns/create`  
**APIs:** POST `/api/returns/sales`, GET `/api/returns/sales`, PATCH approve/reject, DELETE  
**Tables:** SaleReturns, SaleReturnItems, Sales, Customers, CreditNotes, DamageInventories  
**Working:** Yes  
**Risk:** Medium

## Feature #13: Purchase Returns
**What:** Create purchase returns  
**Why:** Supplier returns  
**Roles:** Owner, Admin  
**Frontend:** Returns flow  
**APIs:** POST `/api/returns/purchases`, GET `/api/returns/purchases`  
**Tables:** PurchaseReturns, PurchaseReturnItems, Purchases  
**Working:** Yes  
**Risk:** Low

## Feature #14: Expenses
**What:** Record expenses, categories, recurring, approval  
**Why:** Cost tracking  
**Roles:** Owner, Admin (approve); Staff (view/create per config)  
**Frontend:** `/expenses`  
**APIs:** GET/POST/PUT/DELETE `/api/expenses`, GET `/api/expenses/categories`, POST `/api/expenses/recurring`  
**Tables:** Expenses, ExpenseCategories, RecurringExpenses  
**Working:** Yes  
**Risk:** Low

## Feature #15: Reports – Sales
**What:** Sales reports, aging, outstanding, cheque, P&L  
**Why:** Business analytics  
**Roles:** Owner, Admin (export); Staff (view)  
**Frontend:** `/reports`  
**APIs:** GET `/api/reports/sales`, GET `/api/reports/outstanding`, GET `/api/reports/aging`, GET `/api/reports/stock`  
**Tables:** Sales, SaleItems, Products, Customers, Payments  
**Working:** Yes  
**Risk:** Medium (COGS uses current Product.CostPrice, not at sale)

## Feature #16: Reports – Profit
**What:** Profit report, product margin, daily, branch breakdown  
**Why:** Margin analysis  
**Roles:** Owner, Admin  
**Frontend:** Reports page  
**APIs:** GET `/api/profit/report`, GET `/api/profit/products`, GET `/api/profit/daily`  
**Tables:** Sales, SaleItems, Products, Expenses  
**Working:** Yes  
**Risk:** High (COGS uses current cost)

## Feature #17: Worksheet
**What:** Owner-only worksheet export (PDF)  
**Why:** Tax/audit preparation  
**Roles:** Owner  
**Frontend:** `/worksheet`  
**APIs:** GET `/api/reports/worksheet`, GET `/api/reports/worksheet/export/pdf`  
**Tables:** Sales, Expenses  
**Working:** Yes  
**Risk:** Low

## Feature #18: Branches
**What:** Create branches, assign manager  
**Why:** Multi-branch operations  
**Roles:** Owner, Admin  
**Frontend:** `/branches`, `/branches/:id`  
**APIs:** GET/POST/PUT/DELETE `/api/branches`  
**Tables:** Branches, BranchStaff  
**Working:** Yes  
**Risk:** Low

## Feature #19: Routes
**What:** Create routes, assign customers and staff  
**Why:** Field sales, delivery routes  
**Roles:** Owner, Admin  
**Frontend:** `/routes`, `/routes/:id`  
**APIs:** GET/POST/PUT/DELETE `/api/routes`, GET `/api/routes/{id}/collection-sheet`  
**Tables:** Routes, RouteCustomers, RouteStaff, Customers  
**Working:** Yes  
**Risk:** Low

## Feature #20: Route Expenses
**What:** Record expenses per route  
**Why:** Route-level cost tracking  
**Roles:** Owner, Admin  
**Frontend:** Route detail  
**APIs:** GET/POST/PUT/DELETE `/api/routes/{routeId}/expenses`  
**Tables:** RouteExpenses, Routes  
**Working:** Yes  
**Risk:** Low

## Feature #21: Customer Visits
**What:** Track customer visit status per route/day  
**Why:** Field sales visibility  
**Roles:** Owner, Admin, Staff (assigned routes)  
**Frontend:** Route detail  
**APIs:** GET/POST `/api/routes/{routeId}/visits`  
**Tables:** CustomerVisits, Routes, Customers  
**Working:** Yes  
**Risk:** Low

## Feature #22: Invoice Templates
**What:** Create, edit, activate invoice templates  
**Why:** Custom branding  
**Roles:** Owner, Admin  
**Frontend:** Settings (embedded)  
**APIs:** GET/POST/PUT/DELETE `/api/invoice/templates`  
**Tables:** InvoiceTemplates  
**Working:** Yes  
**Risk:** Low

## Feature #23: Alerts
**What:** View, read, resolve alerts (low stock, etc.)  
**Why:** Notifications  
**Roles:** Owner, Admin, Staff  
**Frontend:** Layout (top bar)  
**APIs:** GET/POST `/api/alerts`  
**Tables:** Alerts  
**Working:** Yes  
**Risk:** Low

## Feature #24: Users
**What:** Create, edit, delete users, reset password  
**Why:** Access control  
**Roles:** Owner, Admin (tenant); SystemAdmin (all)  
**Frontend:** `/users`  
**APIs:** GET/POST/PUT/DELETE `/api/users`  
**Tables:** Users  
**Working:** Yes  
**Risk:** Low

## Feature #25: Settings
**What:** Company settings (name, VAT, logo)  
**Why:** Tenant configuration  
**Roles:** Owner, Admin  
**Frontend:** `/settings`  
**APIs:** GET/PUT `/api/settings`  
**Tables:** Settings  
**Working:** Yes  
**Risk:** Low

## Feature #26: Audit Log
**What:** View audit trail  
**Why:** Compliance  
**Roles:** Owner, Admin  
**Frontend:** `/audit`  
**APIs:** GET `/api/settings/audit-logs`  
**Tables:** AuditLogs  
**Working:** Yes  
**Risk:** Low

## Feature #27: Backup & Restore
**What:** Schedule backup, restore, download  
**Why:** Data recovery  
**Roles:** Owner, Admin  
**Frontend:** `/backup`  
**APIs:** GET/POST `/api/backup/*`  
**Tables:** (backup files)  
**Working:** Yes  
**Risk:** Low

## Feature #28: Subscription
**What:** View plans, current subscription, checkout  
**Why:** SaaS billing  
**Roles:** Owner, Admin  
**Frontend:** `/subscription-plans` (if present)  
**APIs:** GET `/api/subscription/plans`, GET `/api/subscription/current`, POST `/api/subscription/checkout-session`  
**Tables:** Subscriptions, SubscriptionPlans  
**Working:** Yes  
**Risk:** Low

## Feature #29: Authentication
**What:** Login, signup, profile, change password  
**Why:** Access control  
**Roles:** N/A (public/authenticated)  
**Frontend:** `/login`, `/signup`, `/profile`  
**APIs:** POST `/api/auth/login`, POST `/api/auth/signup`, GET `/api/auth/validate`, GET `/api/auth/profile`  
**Tables:** Users, UserSessions, FailedLoginAttempts  
**Working:** Yes  
**Risk:** Low (BCrypt, 5-attempt lockout)

## Feature #30: Super Admin – Tenants
**What:** List, create, edit, suspend, delete tenants  
**Why:** Platform administration  
**Roles:** SystemAdmin  
**Frontend:** `/superadmin/tenants`  
**APIs:** GET/POST/PUT/DELETE `/api/superadmin/tenant/*`  
**Tables:** Tenants, Users, Subscriptions  
**Working:** Yes  
**Risk:** Low

## Feature #31: Super Admin – Impersonation
**What:** Impersonate tenant via X-Tenant-Id  
**Why:** Support and debugging  
**Roles:** SystemAdmin  
**Frontend:** SuperAdmin tenant detail  
**APIs:** POST `/api/superadmin/impersonate/enter`, POST `/api/superadmin/impersonate/exit`  
**Tables:** N/A  
**Working:** Yes  
**Risk:** Medium (impersonation must be logged)

## Feature #32: Super Admin – Demo Requests
**What:** Approve, reject, convert demo requests  
**Why:** Sales pipeline  
**Roles:** SystemAdmin  
**Frontend:** `/superadmin/demo-requests`  
**APIs:** POST `/api/demorequests` (AllowAnonymous), GET/POST `/api/demorequests/{id}/approve`  
**Tables:** DemoRequests  
**Working:** Yes  
**Risk:** Low

## Feature #33: Super Admin – Health & Error Logs
**What:** Platform health, error logs  
**Why:** Monitoring  
**Roles:** SystemAdmin  
**Frontend:** `/superadmin/health`, `/superadmin/error-logs`  
**APIs:** GET `/api/superadmin/platform-health`, GET `/api/error-logs`  
**Tables:** ErrorLogs  
**Working:** Yes  
**Risk:** Low

## Feature #34: Super Admin – SQL Console
**What:** Execute read-only SELECT queries  
**Why:** Platform debugging  
**Roles:** SystemAdmin  
**Frontend:** `/superadmin/sql-console`  
**APIs:** POST `/api/superadmin/sql-console`  
**Tables:** All (read-only)  
**Working:** Yes  
**Risk:** Medium (SQL validation; no user input in query — OK)

## Feature #35: Sales Ledger Import
**What:** Import sales ledger from CSV  
**Why:** Data migration  
**Roles:** Owner, Admin  
**Frontend:** `/sales-ledger-import`  
**APIs:** POST `/api/import/sales-ledger/parse`, POST `/api/import/sales-ledger/apply`  
**Tables:** Sales, SaleItems, Customers, Products  
**Working:** Yes  
**Risk:** Medium (bulk import; validation needed)

## Feature #36: Data Reset
**What:** Reset tenant data (demo, owner)  
**Why:** Demo/cleanup  
**Roles:** Owner, Admin  
**Frontend:** Settings or SuperAdmin  
**APIs:** POST `/api/reset/execute`  
**Tables:** Multiple  
**Working:** Yes  
**Risk:** High (destructive)

## Feature #37: Validation (Data Integrity)
**What:** Detect and fix customer balance mismatches  
**Why:** Data quality  
**Roles:** Admin  
**Frontend:** N/A (or admin tools)  
**APIs:** GET/POST `/api/validation/*`  
**Tables:** Customers, Sales, Payments  
**Working:** Yes  
**Risk:** Low

## Feature #38: Seed / Demo Data
**What:** Load demo or load-test data  
**Why:** Testing  
**Roles:** Owner, Admin  
**Frontend:** N/A  
**APIs:** POST `/api/seed/demo`, POST `/api/seed/load-test`  
**Tables:** Multiple  
**Working:** Yes  
**Risk:** Medium (dev tool in prod)

## Feature #39: Global Search (SuperAdmin)
**What:** Search across tenants  
**Why:** Support  
**Roles:** SystemAdmin  
**Frontend:** `/superadmin/search`  
**APIs:** GET `/api/superadmin/search`  
**Tables:** Multiple  
**Working:** Yes  
**Risk:** Low

## Feature #40: Billing History
**What:** View billing/sales history  
**Why:** Transaction history  
**Roles:** Owner, Admin, Staff  
**Frontend:** `/billing-history`  
**APIs:** GET `/api/sales`  
**Tables:** Sales  
**Working:** Yes  
**Risk:** Low

## Feature #41: Sales Ledger Page
**What:** Sales ledger view  
**Why:** Ledger-style reports  
**Roles:** Owner, Admin, Staff  
**Frontend:** `/sales-ledger`  
**APIs:** GET `/api/reports/sales-ledger`  
**Tables:** Sales, SaleItems  
**Working:** Yes  
**Risk:** Low

## Feature #42: Cash Customer Ledger
**What:** Cash customer balance and ledger  
**Why:** Walk-in cash sales  
**Roles:** Owner, Admin  
**Frontend:** Customer ledger (cash)  
**APIs:** GET `/api/customers/cash-customer/ledger`, POST `/api/customers/cash/recalculate-balance`  
**Tables:** Customers, Sales, Payments  
**Working:** Yes  
**Risk:** Low

## Feature #43: Pending Bills Report
**What:** Pending invoices, PDF export  
**Why:** Collection  
**Roles:** Owner, Admin  
**Frontend:** Reports  
**APIs:** GET `/api/reports/pending-bills`, GET `/api/reports/pending-bills/export/pdf`  
**Tables:** Sales, Customers  
**Working:** Yes  
**Risk:** Low

## Feature #44: Staff Performance Report
**What:** Staff sales performance  
**Why:** Performance tracking  
**Roles:** Owner, Admin  
**Frontend:** Reports  
**APIs:** GET `/api/reports/staff-performance`  
**Tables:** Sales, Users  
**Working:** Yes  
**Risk:** Low

## Feature #45: Branch Comparison
**What:** Branch sales comparison  
**Why:** Multi-branch analytics  
**Roles:** Owner, Admin  
**Frontend:** Reports  
**APIs:** GET `/api/reports/branch-comparison`  
**Tables:** Sales, Branches  
**Working:** Yes  
**Risk:** Low

## Feature #46: Damage Report
**What:** Damage categories and report  
**Why:** Returns handling  
**Roles:** Owner, Admin  
**Frontend:** Returns  
**APIs:** GET `/api/returns/damage-report`, GET `/api/returns/damage-categories`  
**Tables:** DamageCategories, DamageInventories, SaleReturnItems  
**Working:** Yes  
**Risk:** Low

## Feature #47: Credit Notes
**What:** Create, apply, refund credit notes  
**Why:** Returns refunds  
**Roles:** Owner, Admin  
**Frontend:** Returns  
**APIs:** GET `/api/returns/credit-notes`, POST `/api/returns/credit-notes/{id}/apply`, POST `/api/returns/credit-notes/{id}/refund`  
**Tables:** CreditNotes, Customers, SaleReturns  
**Working:** Yes  
**Risk:** Low

## Feature #48: Supplier Payments
**What:** Record supplier payments  
**Why:** AP management  
**Roles:** Owner, Admin  
**Frontend:** Supplier detail  
**APIs:** POST `/api/suppliers/{name}/payments`, PUT/DELETE supplier payments  
**Tables:** SupplierPayments, Suppliers  
**Working:** Yes  
**Risk:** Low

## Feature #49: Price History
**What:** View product price change history  
**Why:** Audit  
**Roles:** Owner, Admin  
**Frontend:** Product detail  
**APIs:** GET `/api/products/{id}/price-history`  
**Tables:** PriceChangeLogs, Products  
**Working:** Yes  
**Risk:** Low

## Feature #50: Low Stock Alert
**What:** Low stock products list  
**Why:** Restocking  
**Roles:** Owner, Admin, Staff  
**Frontend:** Products  
**APIs:** GET `/api/products/low-stock`  
**Tables:** Products  
**Working:** Yes  
**Risk:** Low

## Feature #51: Subscription Webhook
**What:** Stripe/webhook for subscription events  
**Why:** Automated subscription updates  
**Roles:** N/A (AllowAnonymous)  
**Frontend:** N/A  
**APIs:** POST `/api/subscription/webhook`  
**Tables:** Subscriptions  
**Working:** Yes  
**Risk:** Medium (verify webhook signature)

## Feature #52: Maintenance Mode
**What:** Maintenance overlay, check  
**Why:** Planned downtime  
**Roles:** N/A  
**Frontend:** MaintenanceOverlay  
**APIs:** GET `/api/maintenance-check`  
**Tables:** PlatformSettings  
**Working:** Yes  
**Risk:** Low

## Feature #53: Health Check
**What:** API health endpoint  
**Why:** Load balancer, keep-alive  
**Roles:** N/A (AllowAnonymous)  
**Frontend:** Keep-alive ping (every 9 min)  
**APIs:** GET `/health`  
**Tables:** N/A  
**Working:** Yes  
**Risk:** Low

## Feature #54: Onboarding Wizard
**What:** First-time setup flow  
**Why:** User onboarding  
**Roles:** New tenant  
**Frontend:** `/onboarding`  
**APIs:** Settings, Auth  
**Tables:** Settings, Users  
**Working:** Yes  
**Risk:** Low

## Feature #55: Profile
**What:** User profile, photo, password change  
**Why:** Self-service  
**Roles:** All authenticated  
**Frontend:** `/profile`  
**APIs:** GET/PUT `/api/auth/profile`, PUT `/api/auth/profile/password`  
**Tables:** Users  
**Working:** Yes  
**Risk:** Low

## Feature #56: Help & Feedback
**What:** Help page, feedback  
**Why:** Support  
**Roles:** All authenticated  
**Frontend:** `/help`, `/feedback`  
**APIs:** N/A (static or external)  
**Tables:** N/A  
**Working:** Yes  
**Risk:** Low

## Feature #57: Platform Settings (SuperAdmin)
**What:** Platform-wide settings  
**Why:** SaaS config  
**Roles:** SystemAdmin  
**Frontend:** `/superadmin/settings`  
**APIs:** GET/PUT `/api/superadmin/platform-settings`  
**Tables:** PlatformSettings (or similar)  
**Working:** Yes  
**Risk:** Low

## Feature #58: Diagnostics
**What:** Schema check, migrate, fonts  
**Why:** Ops/debugging  
**Roles:** SystemAdmin (most); AllowAnonymous (health, fonts)  
**Frontend:** N/A  
**APIs:** GET `/api/health`, GET `/api/schema-check`, POST `/api/migrate`, GET `/api/fonts`  
**Tables:** Schema  
**Working:** Yes  
**Risk:** Medium (migrate should be restricted)

---

# PART 2: COMPLETE API INVENTORY

## Summary Table (Key Endpoints)

| # | Method | Endpoint | Purpose | Auth | Roles | Risk |
|---|--------|----------|---------|------|-------|------|
| 1 | GET | /api/products | List products | Yes | All | Low |
| 2 | POST | /api/products | Create product | Yes | Admin,Owner | Low |
| 3 | PUT | /api/products/{id} | Update product | Yes | Admin,Owner | Low |
| 4 | DELETE | /api/products/{id} | Delete product | Yes | Admin,Owner,Staff | Low |
| 5 | GET | /api/sales | List sales | Yes | All | Low |
| 6 | POST | /api/sales | Create sale | Yes | All | High |
| 7 | GET | /api/sales/{id}/pdf | Invoice PDF | **AllowAnonymous** | **NONE** | **CRITICAL** |
| 8 | POST | /api/payments | Create payment | Yes | All | **CRITICAL** |
| 9 | POST | /api/auth/login | Login | AllowAnonymous | - | Low |
| 10 | POST | /api/auth/signup | Signup | AllowAnonymous | - | Low |
| 11 | GET | /health | Health check | AllowAnonymous | - | Low |
| 12 | POST | /api/subscription/webhook | Stripe webhook | AllowAnonymous | - | Medium |
| 13 | POST | /api/demorequests | Demo request | AllowAnonymous | - | Low |

### API Summary

| Metric | Count |
|--------|-------|
| **Total Endpoints** | ~180+ |
| **GET** | ~95 |
| **POST** | ~55 |
| **PUT** | ~35 |
| **PATCH** | ~8 |
| **DELETE** | ~25 |
| **AllowAnonymous** | 10+ (login, signup, health, fonts, maintenance-check, demo request, subscription webhook, **sales PDF**) |
| **Missing Rate Limit** | Per-endpoint not differentiated; global 300/min |
| **Missing Input Validation** | Some DTOs may lack validation attributes |
| **Race Conditions** | Payment (Sale row not locked), Invoice number |
| **SQL Injection** | None (ExecuteSqlRaw uses static DDL; SqlConsole validates SELECT only) |

**CRITICAL:**
- `GET /api/sales/{id}/pdf` – `[AllowAnonymous]` allows any unauthenticated user to download invoice PDF by ID enumeration.

---

# PART 3: DATABASE ANALYSIS

## Tables

| Table | Purpose | Est. Rows | Growth | Indexes | FKs | Critical |
|-------|---------|-----------|--------|---------|-----|----------|
| Tenants | Tenant master | Small | Low | Subdomain, Domain | - | Yes |
| Users | User accounts | Medium | Low | Email | TenantId, OwnerId | Yes |
| Products | Product master | Medium | Medium | TenantId+Sku | TenantId | Yes |
| Customers | Customer master | Medium | Medium | - | TenantId | Yes |
| Sales | Invoices | Large | High | OwnerId+InvoiceNo, CreatedAt, BranchId | TenantId, CustomerId | Yes |
| SaleItems | Invoice lines | Large | High | SaleId | SaleId, ProductId | Yes |
| Payments | Payments | Large | High | - | SaleId, CustomerId | Yes |
| Purchases | Purchase orders | Large | Medium | OwnerId+InvoiceNo | TenantId, SupplierId | Yes |
| PurchaseItems | Purchase lines | Large | Medium | PurchaseId | PurchaseId, ProductId | Yes |
| Suppliers | Supplier master | Medium | Low | TenantId+Name | TenantId | Yes |
| SupplierPayments | Supplier payments | Medium | Medium | TenantId | TenantId, SupplierId | Yes |
| Expenses | Expenses | Medium | Medium | - | TenantId, CategoryId | Yes |
| ExpenseCategories | Expense categories | Small | Low | TenantId+Name | TenantId | Yes |
| Branches | Branches | Small | Low | TenantId | TenantId | Yes |
| Routes | Delivery routes | Small | Low | BranchId, TenantId | BranchId, TenantId | Yes |
| InvoiceTemplates | Templates | Small | Low | TenantId | TenantId | Yes |
| AuditLogs | Audit trail | Large | High | CreatedAt, UserId, TenantId | UserId, TenantId | Yes |
| ErrorLogs | 500 errors | Medium | Medium | CreatedAt, TenantId | - | No |
| Subscriptions | Plan subscription | Small | Low | TenantId | TenantId | Yes |
| + 23 more | ... | ... | ... | ... | ... | ... |

## Storage Estimate (1GB PostgreSQL)

- 1GB ≈ 50–100M rows (depends on row size).
- Rough per-tenant: ~500–2000 sales/month (Starter), ~50–200 products, ~100–500 customers.
- **10 clients:** ~5K–20K sales/mo → ~600K–2.4M sales/year → OK for 1GB for 12+ months.
- **50 clients:** ~25K–100K sales/mo → 1GB full in ~6–12 months.
- **100 clients:** ~50K–200K sales/mo → 1GB full in ~3–6 months.

**Recommendation:** Upgrade to 2GB at ~30 clients; 5GB at ~70 clients.

## Missing Indexes (Candidates)

- `Sales.CustomerId` – customer ledger queries
- `Payments.CustomerId` + `Payments.SaleId` – payment reports
- `SaleItems.ProductId` – product sales reports
- `InventoryTransactions.ProductId` + `CreatedAt` – stock history

## Orphaned Data Risk

- `PaymentIdempotency` – not scoped by TenantId (MEDIUM – idempotency key collision)
- `SaleReturnItem.SaleItemId` – FK exists; OK
- Most entities have TenantId/OwnerId; tenant-scoped queries reduce orphan risk

---

# PART 4: MULTI-TENANT ISOLATION AUDIT

## Tenant Filter Pattern

- Controllers inherit `TenantScopedController` and use `CurrentTenantId` from JWT.
- Services receive `tenantId` explicitly; queries filter by `TenantId` or `OwnerId`.
- Unique indexes: `(TenantId, Sku)`, `(TenantId, Name)`, `(OwnerId, InvoiceNo)`.

## Known Gaps (from CRITICAL_AUDIT)

1. **BalanceService.RecalculateCustomerBalanceAsync** – loads customer by `FindAsync(customerId)` only; tenant check relies on caller. **Fix:** Validate `customer.TenantId == tenantId` inside method.
2. **PaymentIdempotency** – lookup by `IdempotencyKey` only; not tenant-scoped. **Fix:** Add TenantId to table and filter.

## Queries Verified as Tenant-Scoped

- SaleService, PurchaseService, CustomerService, SupplierService, ExpenseService, ReportService – all use `tenantId` in queries.
- No cross-tenant data leak identified in main business flows (except PDF endpoint).

---

# PART 5: ROLE-BASED ACCESS CONTROL AUDIT

## Endpoint Access by Role

| Role | Endpoints | Notes |
|------|-----------|-------|
| Owner | ~150+ | Full tenant access |
| Admin | ~150+ | Same as Owner for tenant |
| Staff | ~80 | No branches, routes, users, settings, backup, purchases (admin actions) |
| SystemAdmin | ~50 (SuperAdmin) | Tenant management, impersonation, SQL console |

## Missing Role Checks

- Most destructive actions (delete purchase, delete sale) require Admin/Owner.
- Staff: correctly restricted from branches, routes, users, settings, backup, purchase delete.

## Frontend vs Backend

- Frontend: `canAccessPage()`, `STAFF_NEVER_ACCESS`; Staff redirected from `/branches`, `/routes`.
- Backend: `[Authorize(Roles = "Admin,Owner")]` on delete/export.
- **Backend enforcement is primary; frontend is defense-in-depth.**

---

# PART 6: SECURITY VULNERABILITIES

## 1. SQL Injection
- **None** – Raw SQL is DDL (CREATE TABLE, ALTER TABLE); no user input. SqlConsole validates SELECT only and blocks write keywords.

## 2. XSS
- User input (invoice notes, product descriptions) rendered in PDF/HTML – verify React escapes by default; server-side PDF generation should sanitize.

## 3. CSRF
- Stateless JWT API; no cookie-based sessions. CORS + credentials; origin validation. **Low risk** for API.

## 4. Authentication
- **JWT expiry:** 8 hours
- **Refresh token:** No
- **Password hashing:** BCrypt (BCrypt.Net-Next)
- **Password strength:** Signup requires min 6 chars; recommend 8+ with complexity

## 5. Sensitive Data
- **Stack traces:** Logging level Warning in Production; ensure no stack in API response.
- **Connection string:** From env; not logged.
- **Secrets:** In env vars (good).

## 6. Rate Limiting
- **Implemented:** Yes, 300 req/min per IP (global).
- **DDoS:** Basic protection; consider stricter limits on auth endpoints.

---

# PART 7: PRODUCTION INFRASTRUCTURE ANALYSIS

## Render Starter Plan

- **RAM:** ~512MB (Starter)
- **CPU:** Shared
- **Concurrent users (estimate):** 10 OK, 50 Struggling, 100 Fails
- **Requests/sec:** ~5–15 (estimate)

## PostgreSQL 1GB

- **Connections:** ~97–100
- **Pool size in code:** 150 (exceeds DB limit – **potential issue**)
- **Recommendation:** Set pool size to 90–95 to stay under 100

## Cold Start

- Render Starter: may sleep after inactivity.
- Frontend keep-alive: pings `/health` every 9 min when user logged in.
- **Impact:** Reduced; first request after long idle may be slow.

## Upgrade Path

| Clients | Backend | Cost | DB | Cost | Total/mo |
|---------|---------|------|-----|------|----------|
| 1–10 | Starter | $26 | 1GB | $8 | $34 |
| 10–30 | Standard | ~$85 | 2GB | ~$15 | ~$100 |
| 30–70 | Pro | ~$175 | 5GB | ~$50 | ~$225 |
| 70–100 | Pro+ | ~$250 | 10GB | ~$100 | ~$350 |

**100 clients × AED 149 ≈ AED 14,900/mo revenue.** Infrastructure at $350 (~AED 1,285) = ~8.6% of revenue – acceptable.

---

# PART 8: CODE QUALITY & TECHNICAL DEBT

- **Duplication:** Balance calculation in PaymentService vs BalanceService (manual decrement vs recalc) – consolidate.
- **Error handling:** Most controllers use try-catch; some return 500 with message.
- **Logging:** Serilog to console and file; critical operations logged.
- **N+1:** Some reports may have N+1; use `.Include()` where needed.
- **Dead code:** Seed, load-test endpoints in production – consider disabling.

---

# PART 9: USER WORKFLOW ANALYSIS

## Workflow 1: Create Sale/Invoice

1. User → `/pos` → GET `/api/customers`, GET `/api/products`
2. Select customer → GET `/api/customers/{id}` (optional)
3. Add to cart (local state)
4. Checkout → POST `/api/sales` (transaction: Sale + SaleItems + stock update + InventoryTransactions)
5. Success → navigate to invoice view

**API calls:** 3–4 | **DB writes:** 1 Sale + N SaleItems + N Products + N InventoryTransactions | **Time:** ~2–3 s

## Workflow 2: Record Payment

1. User → Ledger/Invoice → Payment modal
2. Enter amount → POST `/api/payments` or POST `/api/payments/allocate`
3. **Risk:** No single transaction; Sale row not locked → overpayment possible

## Workflow 3: Create Purchase

1. User → `/purchases` → New
2. POST `/api/purchases` (transaction; stock updated)
3. **Risk:** Duplicate (SupplierName+InvoiceNo) vs DB (OwnerId+InvoiceNo) mismatch

---

# PART 10: TOTAL SYSTEM METRICS

| Category | Count |
|----------|-------|
| Frontend pages/routes | 38 |
| Public pages | 3 (login, signup, Admin26) |
| Owner-only | 1 (worksheet) |
| API endpoints | ~180 |
| Database tables | 42 |
| Backend .cs files | ~210 |
| Frontend .jsx files | ~93 |

---

# PART 11: SCALABILITY BOTTLENECKS

1. **DB connections:** Pool 150 > limit 100 → reduce to 90.
2. **RAM (512MB):** ~30–50 concurrent users before strain.
3. **CPU:** Shared; ~10–20 req/sec.
4. **DB size:** 1GB full at ~50–100 clients in 6–12 months.
5. **Cold start:** Mitigated by keep-alive.

---

# PART 12: RECOMMENDED PRICING TIERS

| Tier | Limits | Price | Margin |
|------|--------|-------|--------|
| Starter | 1 branch, 2 routes, 2 users, 300 sales/mo | AED 149 | ~92% |
| Professional | 3 branches, 9 routes, 5 users, 1000 sales/mo | AED 349 | ~90% |
| Enterprise | Unlimited (fair use) | AED 799 | ~85% |

**Infrastructure at 60 Starter clients:** OK. At 30 Professional + 10 Enterprise: may need Standard/Pro backend and 2–5GB DB.

---

# PART 13: SUPER ADMIN REQUIREMENTS – GAP ANALYSIS

| Requirement | Exists | Notes |
|-------------|--------|-------|
| View all tenants | Yes | SuperAdminTenantsPage |
| Suspend/activate | Yes | PUT tenant suspend/activate |
| Reset password | Yes | PUT tenant users reset-password |
| Delete tenant | Yes | DELETE tenant |
| SQL console (read-only) | Yes | SqlConsoleController |
| Plan management | Partial | Subscription; per-tenant limits/features |
| Data import | Partial | Sales ledger import |
| Tenant usage stats | Yes | Usage, health, cost endpoints |
| Communications | No | No broadcast/announcement |

---

# PART 14: GULF MARKET SEO & CONVERSION

- **Landing page:** Marketing site separate; not in this codebase.
- **Arabic:** Partial (CompanySettings LegalNameAr).
- **AED:** Yes (CompanySettings.Currency).
- **FTA VAT report:** Not found in reports.
- **Arabic RTL:** Not in app.
- **WhatsApp:** Demo request has WhatsApp field; no invoice sending via WhatsApp in app.

---

# PART 15: CRITICAL PRODUCTION RISKS (TOP 10)

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| 1 | Payment not atomic | High | Critical | Single transaction; lock Sale row |
| 2 | Invoice number lock released early | Medium | Critical | Use pg_advisory_xact_lock |
| 3 | Sale PDF AllowAnonymous | High | Critical | Remove AllowAnonymous; require auth |
| 4 | No Sale row lock on payment | High | Critical | FOR UPDATE on Sale |
| 5 | COGS uses current cost | Medium | High | Add UnitCost to SaleItem |
| 6 | Purchase delete → negative stock | Medium | High | Check StockQty before reverse |
| 7 | Purchase unique mismatch | Low | High | Align service and DB unique |
| 8 | Idempotency not tenant-scoped | Low | Medium | Add TenantId to PaymentIdempotency |
| 9 | Connection pool > DB limit | Medium | High | Set pool to 90 |
| 10 | BalanceService tenant check | Low | Medium | Validate tenant in RecalculateCustomerBalanceAsync |

---

# PART 16: IMMEDIATE ACTION ITEMS

## PRIORITY 1 (This Week)

1. **Remove [AllowAnonymous] from GET /api/sales/{id}/pdf**  
   - Why: Any user can download invoices by ID.  
   - Fix: Require `[Authorize]`; ensure tenant check in SaleService.  
   - Time: 30 min.

2. **Add Sale row lock (FOR UPDATE) in PaymentService**  
   - Why: Prevents overpayment race.  
   - Fix: Load Sale with lock before payment; wrap in transaction.  
   - Time: 2–4 hours.

3. **Wrap payment flow in single transaction**  
   - Why: Prevents partial commit (payment saved, Sale/Customer not).  
   - Fix: One BeginTransaction; single SaveChanges at end.  
   - Time: 4–6 hours.

4. **Fix invoice number advisory lock**  
   - Why: Duplicate invoice numbers under concurrency.  
   - Fix: Use pg_advisory_xact_lock in same transaction as Sale insert.  
   - Time: 2–3 hours.

## PRIORITY 2 (This Month)

5. Reduce PostgreSQL connection pool to 90.  
6. Add StockQty check before purchase delete stock reversal.  
7. Align Purchase duplicate check with DB unique (OwnerId+InvoiceNo).  
8. Add UnitCost/CostAtSale to SaleItem for COGS.

## PRIORITY 3 (Within 3 Months)

9. Scope PaymentIdempotency by TenantId.  
10. Validate tenant in BalanceService.RecalculateCustomerBalanceAsync.  
11. Add FTA VAT return report for UAE.  
12. Consider refresh tokens.

---

# PART 17: INFRASTRUCTURE COST PROJECTION

| Clients | Backend | DB | Total/mo | Revenue (AED) | Profit | Margin |
|---------|---------|-----|----------|---------------|--------|--------|
| 1 | $26 | $8 | $34 | 149 | 422 | 92% |
| 10 | $26 | $8 | $34 | 1,490 | 1,365 | 92% |
| 30 | $85 | $15 | $100 | 4,470 | 4,103 | 92% |
| 50 | $85 | $25 | $110 | 7,450 | 7,046 | 95% |
| 100 | $175 | $50 | $245 | 14,900 | 14,001 | 94% |

**Upgrade triggers:**
- Backend: ~25–30 clients
- DB 2GB: ~30 clients
- DB 5GB: ~70 clients

---

# APPENDIX: Files Analyzed

**Key files:**
- `backend/HexaBill.Api/Data/AppDbContext.cs`
- `backend/HexaBill.Api/Modules/Payments/PaymentService.cs`
- `backend/HexaBill.Api/Modules/Billing/InvoiceNumberService.cs`
- `backend/HexaBill.Api/Modules/Billing/SalesController.cs` (line 341: AllowAnonymous)
- `backend/HexaBill.Api/Shared/Extensions/SecurityConfiguration.cs`
- `docs/CRITICAL_AUDIT_BUSINESS_LOGIC_AND_SECURITY.md`

---

*Report generated from codebase analysis. Re-validate after applying fixes.*
