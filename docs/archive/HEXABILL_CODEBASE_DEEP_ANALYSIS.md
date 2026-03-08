# HEXABILL FULL CODEBASE DEEP ANALYSIS

**Senior SaaS architect technical audit**  
**Date:** 2026-02-25 (updated)  
**Scope:** Entire HexaBill codebase — facts from code, no guessing

---

## 1. PROJECT STRUCTURE ANALYSIS

### 1.1 Full Folder Structure

```
HexaBillAd-main/
├── backend/
│   └── HexaBill.Api/                    # ASP.NET Core 9 API
│       ├── Modules/                    # Feature modules (16 modules)
│       │   ├── Auth/                   # Authentication, JWT, Signup, LoginLockout
│       │   ├── Automation/             # EmailAutomationProvider (TODO: not implemented)
│       │   ├── Billing/                # SaleService, SaleValidationService, Returns, PDF, InvoiceNumber, InvoiceTemplate
│       │   ├── Branches/               # BranchService, RouteService, CustomerVisits, RouteExpenses
│       │   ├── Customers/              # CustomerService, BalanceService
│       │   ├── Expenses/               # ExpenseService
│       │   ├── Import/                 # SalesLedgerImport
│       │   ├── Inventory/              # ProductService, StockAdjustmentService
│       │   ├── Notifications/          # AlertService
│       │   ├── Payments/               # PaymentService
│       │   ├── Purchases/              # PurchaseService, SupplierService
│       │   ├── Reports/                # ReportService, ProfitService
│       │   ├── Seed/                   # Data seeding
│       │   ├── Subscription/           # Stripe subscription management
│       │   ├── SuperAdmin/             # Platform administration (12+ services)
│       │   └── Users/                  # User management
│       ├── Shared/
│       │   ├── Authorization/          # AdminOrOwnerPolicy, AdminOrOwnerOrStaffPolicy
│       │   ├── Extensions/             # SecurityConfiguration, TenantIdExtensions
│       │   ├── Middleware/             # JWT, TenantContext, Subscription, Audit, Exception handling
│       │   ├── Security/               # R2FileUpload, FileUpload
│       │   ├── Services/               # AuditService, TenantContext, RouteScope, ErrorLog, SalesSchemaService
│       │   └── Validation/             # ValidationService, CurrencyService
│       ├── BackgroundJobs/             # TrialExpiryCheck, DailyBackupScheduler, BalanceReconciliationJob
│       ├── Data/                       # AppDbContext
│       ├── Models/                     # 43+ entity/DTO files
│       ├── Migrations/                 # EF Core migrations (PostgreSQL)
│       ├── Scripts/                    # SQL scripts, FIX_PRODUCTION_MIGRATIONS.sql
│       ├── Templates/                  # Invoice templates
│       ├── Fonts/                      # PDF fonts
│       └── Program.cs
├── frontend/
│   └── hexabill-ui/                    # React 18 + Vite 5
│       └── src/
│           ├── pages/                  # 44 page components
│           │   ├── company/            # 32 tenant pages
│           │   └── superadmin/         # 11 SuperAdmin pages
│           ├── components/
│           ├── hooks/
│           ├── services/
│           ├── utils/                  # roles.js (Staff page access)
│           └── security/
├── render.yaml                         # Render Docker deploy
├── vercel.json                         # Vercel SPA deploy
├── MIGRATION_INSTRUCTIONS.md
├── NOT_BUILT.md
├── PRODUCTION_VERIFICATION.md
└── DATABASE_SCHEMA.md
```

### 1.2 Technology Identification

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18.3.1, Vite 5.0.8, Tailwind CSS 3.3.6, Zustand 5.0.8, Recharts 2.8.0, Axios 1.6.0 |
| **Backend** | ASP.NET Core 9.0, .NET 9.0 |
| **Database** | PostgreSQL (Npgsql 9.0.1, EF Core 9.0) — SQLite for local dev |
| **Auth** | JWT Bearer, BCrypt.Net-Next |
| **PDF** | QuestPDF |
| **Excel** | EPPlus |
| **Payments** | Stripe.net |
| **Storage** | AWSSDK.S3 / Cloudflare R2 |

### 1.3 What Is Clean

- **Modular backend** — Feature folders (Auth, Billing, Customers, etc.) with clear separation
- **Multi-tenant pattern** — TenantId on 25+ entities; middleware enforces; InvoiceTemplate and ExpenseCategory **now tenant-scoped** (fixed 2026-02)
- **Index strategy** — AddPerformanceIndexes.sql defines composite indexes for tenant+date, tenant+branch
- **Concurrency tokens** — RowVersion on Sale, Product, Customer, Payment
- **Idempotency** — PaymentIdempotencies table
- **Audit trail** — AuditService with field-level change tracking
- **Role-based access** — Admin, Owner, Staff, SystemAdmin with PageAccess for Staff
- **SaleValidationService** — Extracted from SaleService (lock, edit window, unlock)
- **ReportService** — GetSummaryReportAsync cached 5 min (IMemoryCache)
- **BalanceService** — 4 aggregates run in parallel (Task.WhenAll)
- **BalanceReconciliationJob** — Nightly job for async balance verification

### 1.4 What Is Messy

- **Console.WriteLine in production** — 60+ occurrences: SaleService (~25), ComprehensiveBackupService (~60), ResetService, SuperAdminTenantController, SuperAdminController, PlatformSettingsController, UsersController, PostgreSqlErrorMonitoringMiddleware, SecurityConfiguration, FixMissingColumns, BackfillPurchaseVAT
- **OwnerId vs TenantId dual schema** — OwnerId still on Alerts, AuditLogs, Settings; migration scripts exist; inconsistent filtering in legacy code
- **PRODUCTION_MASTER_TODO comments** — 15+ references (#6, #7, #9, #22, #31, #33, #34, #37, #38, #43, #44, #45, #47, #49, #57) — mostly documentation; some are unimplemented features (see NOT_BUILT.md)
- **Large monolithic services** — SaleService ~2,900 lines; ReportService ~2,600 lines; SuperAdminTenantService ~1,300 lines

### 1.5 What Causes Future Merge Conflicts

- **SaleService.cs** — 2,900+ lines; many responsibilities (CRUD, PDF, validation, balance, reconciliation)
- **ReportService.cs** — 2,600+ lines; single class handles all report types
- **SuperAdminTenantService.cs** — 1,300+ lines
- **ComprehensiveBackupService.cs** — 1,500+ lines; restore, backup, CSV, PDF, S3, manifest
- **AppDbContext.OnModelCreating** — 530+ lines

### 1.6 Tight Coupling

- **BalanceService** — Full recalc per invoice/payment event (4 parallel aggregates, but no incremental engine)
- **SaleService** → BalanceService, AlertService, PdfService, InvoiceNumberService, ValidationService — Heavy orchestration
- **ReportService** → SalesSchemaService — Runtime column detection `SalesHasBranchIdAndRouteIdAsync()` on reports
- **Settings** — Key-value with composite PK (Key, OwnerId); TenantId nullable

### 1.7 Environment Config

- **Backend:** .env.example — DATABASE_URL, JwtSettings__SecretKey, ALLOWED_ORIGINS, R2_*, SMTP_*, STRIPE_API_KEY
- **Frontend:** env.example — VITE_API_BASE_URL (localhost or production URL)
- **Render:** render.yaml — Docker, rootDir backend/HexaBill.Api, healthCheckPath /health
- **Vercel:** vercel.json — Root must be repo root; buildCommand cd frontend/hexabill-ui

---

## 2. FEATURE EXTRACTION

### 2.1 Invoice System

| Aspect | Status | Notes |
|--------|--------|-------|
| Create/Update/Delete | ✅ Complete | SaleService, soft delete, 8-hour edit window, locking via SaleValidationService |
| Invoice numbering | ✅ Complete | InvoiceNumberService, per-tenant sequence |
| PDF generation | ✅ Complete | QuestPDF, tenant-scoped templates |
| Templates | ✅ Fixed | InvoiceTemplateService filters by TenantId |
| Versioning | ✅ Complete | InvoiceVersions, DataJson, DiffSummary |
| Held/draft | ✅ Complete | HeldInvoices |
| Duplicate prevention | ✅ Complete | ExternalReference unique, RowVersion |

**Scalability:** List paginated (max 100/page). Full Include on Customer, Items, Product — N+1 risk at scale.

### 2.2 VAT Calculation

| Aspect | Status | Notes |
|--------|--------|-------|
| Sales VAT | ✅ Complete | Sale.VatTotal, SaleItem.VatAmount |
| Purchase VAT | ⚠️ Half-built | VatTotal nullable; BackfillPurchaseVAT.cs for legacy |
| Rate | ⚠️ Configurable | Via Settings; fallback 5% in code |

### 2.3 Credit Sales

| Aspect | Status | Notes |
|--------|--------|-------|
| Credit limit | ✅ Complete | Customer.CreditLimit |
| Pending balance | ✅ Complete | Customer.PendingBalance, TotalSales, TotalPayments |
| Recalculation | ⚠️ Inefficient | Full recalc (4 parallel aggregates) per event; no incremental engine |
| Validation | ✅ Complete | CanCustomerReceiveCreditAsync |
| Mismatch detection | ✅ Complete | DetectAllBalanceMismatchesAsync, FixBalanceMismatchAsync |
| Nightly job | ✅ Added | BalanceReconciliationJob (configurable time) |

### 2.4 Inventory

| Aspect | Status | Notes |
|--------|--------|-------|
| Products CRUD | ✅ Complete | ProductService, ConversionToBase |
| Stock adjustments | ✅ Complete | StockAdjustmentService |
| Low stock alerts | ✅ Complete | ReorderLevel |
| Categories | ✅ Complete | ProductCategories, tenant-scoped |
| Damage tracking | ✅ Complete | DamageCategories, SaleReturnItem.DamageCategoryId |

### 2.5 Reporting Engine

| Report | Status | Caching |
|--------|--------|--------|
| Summary | ✅ Complete | 5-min IMemoryCache |
| Sales, Product, Customer, Aging, Stock | ✅ Complete | None |
| Ledger, Staff performance | ✅ Complete | None |
| AI suggestions | ✅ Complete | None |

**Scaling:** No materialized views. DetectAllBalanceMismatchesAsync iterates all customers — O(n).

### 2.6 Dashboard

- DashboardController.GetDashboardBatch — single endpoint
- Metrics: Sales today, outstanding, low stock, recent transactions
- Staff scope: Route-restricted

### 2.7 Role-Based Permissions

| Role | Capability |
|------|------------|
| SystemAdmin | tenant_id=0, full platform |
| Owner/Admin | Full tenant access |
| Staff | PageAccess (pos, invoices, products, customers, expenses, reports); RouteStaff/BranchStaff scoped |

**Staff never:** users, settings, backup, branches, routes, purchases (enforced in roles.js + backend)

### 2.8 Audit Logs

- AuditService — Action, EntityType, EntityId, OldValues, NewValues (JSON)
- Indexes: TenantId, UserId, CreatedAt, (EntityType, EntityId)
- **Retention:** AUDIT_RETENTION_POLICY.md exists; no automatic purge in code

### 2.9 Customer Ledger

- CustomerLedgerPage.jsx, BalanceService, ReportService.GetComprehensiveSalesLedgerAsync
- Date normalization, inclusive end date

### 2.10 Expense Module

- ExpenseService — CRUD, category (tenant-scoped), branch/route, recurring
- **ExpenseCategory** — TenantId added; GetExpenseCategoriesAsync filters by tenant
- RecurringExpenses, approval workflow (Draft/Approved/Rejected)

### 2.11 Purchase Module

- PurchaseService, PurchaseReturns
- SupplierService exists; Purchase uses SupplierName (string), not FK in many cases

---

## 3. DATABASE ANALYSIS

### 3.1 Tables (40+)

Tenants, Users, SubscriptionPlans, Subscriptions, Branches, Routes, BranchStaff, RouteStaff, RouteCustomers, RouteExpenses, CustomerVisits, Products, ProductCategories, PriceChangeLogs, InventoryTransactions, Customers, Sales, SaleItems, SaleReturns, SaleReturnItems, Payments, PaymentIdempotencies, Purchases, PurchaseItems, PurchaseReturns, PurchaseReturnItems, Expenses, ExpenseCategories, RecurringExpenses, InvoiceVersions, InvoiceTemplates, DamageCategories, Settings, AuditLogs, Alerts, ErrorLogs, HeldInvoices, UserSessions, FailedLoginAttempts, DemoRequests

### 3.2 Tenant Isolation (Current State)

| Entity | TenantId | Status |
|--------|----------|--------|
| InvoiceTemplates | ✅ | Migration 20260225120000 |
| ExpenseCategories | ✅ | Migration 20260225130000 |
| Expenses | ✅ | FIX_PRODUCTION_MIGRATIONS section 6b |
| 25+ others | ✅ | TenantId FK |

**Production:** Run FIX_PRODUCTION_MIGRATIONS.sql sections 6b, 7, 8 if 42703 errors occur.

### 3.3 Index Usage

- AddPerformanceIndexes.sql — 40+ composite indexes
- Unique: (TenantId, Sku) Products; (TenantId, Name) ExpenseCategories; Email Users

### 3.4 Scaling Assessment

| Scenario | Assessment |
|----------|------------|
| 100+ concurrent | **Risky** — BalanceService full recalc per event; no connection pool config visible |
| 10M invoices | **Risky** — No partitioning; AuditLogs/InvoiceVersions unbounded |
| Credit calculation | **Not efficient** — Full recalc; parallel aggregates help but not incremental |

---

## 4. ARCHITECTURE STRENGTH

### 4.1 Maturity Level

**Between MVP and production-ready.** Core billing, inventory, reporting work. Multi-tenant isolation correct after migrations. InvoiceTemplate and ExpenseCategory tenant-scope fixed. BalanceService optimized (parallel aggregates, nightly job). ReportService summary cached.

### 4.2 What Will Break First Under Load

1. **BalanceService** — Full recalc per invoice/payment; high-frequency tenants hit DB hard
2. **ReportService** — Most reports uncached; multiple sequential queries
3. **SaleService.GetSalesAsync** — Include(Customer, Items, Product) — large result sets
4. **AuditLogs** — Unbounded; no retention/archive in code
5. **DetectAllBalanceMismatchesAsync** — O(n) over all customers

### 4.3 Security

| Risk | Severity | Status |
|------|----------|--------|
| InvoiceTemplate cross-tenant | High | **Fixed** — TenantId, filter by tenant |
| ExpenseCategory cross-tenant | Medium | **Fixed** — TenantId, unique (TenantId, Name) |
| Console.WriteLine PII leakage | Low | **Not fixed** — 60+ in production code |
| SQL console (SuperAdmin) | Medium | Exists; read-only, blacklist |

### 4.4 Data Integrity

- Balance drift detection; ReconcileAllPaymentStatusAsync
- Stock: RowVersion, atomic adjustment
- Invoice number: Unique (OwnerId, InvoiceNo) with IsDeleted

---

## 5. BUSINESS CAPABILITY (CODE ONLY)

### 5.1 What HexaBill ACTUALLY Solves

- B2B invoicing — Create, edit (8hr), lock, PDF, version history
- Credit sales — Credit limit, pending balance, payment terms
- Multi-branch / route sales — Branches, routes, route staff, customer visits
- Inventory — Products, categories, stock, adjustments, low stock, damage
- Purchases — PO entry, returns (supplier name, not FK)
- Expenses — Categories (tenant-scoped), recurring, approval
- Payments — Modes, idempotency
- Returns — Sale returns, purchase returns, damage categories
- Reporting — Sales, product, customer, aging, stock, profit, ledger
- Multi-tenant SaaS — Tenant isolation, Stripe subscriptions
- Audit — Field-level change tracking
- Roles — Owner, Admin, Staff (page + route scope)

### 5.2 Partially Solves

- VAT — Sales complete; purchase backfill
- Profit — Cash-based (Sales - COGS - Expenses)
- Supplier — SupplierService; Purchase uses SupplierName string
- API — HasApiAccess in plan; no public API in code

### 5.3 Does NOT Solve (see NOT_BUILT.md)

- Public API / webhooks
- Offboarding export ZIP
- Bulk tenant actions
- Email backup delivery
- Accrual accounting
- Incremental balance engine
- Report materialized views / Redis
- AuditLogs retention/archive

---

## 6. MARKETING POSITIONING (REAL CODE)

### 6.1 Real Positioning

**Multi-tenant B2B billing & route sales for distributors/wholesalers**

- Branches, routes, route staff, customer visits
- Credit sales with limits and aging
- Arabic + English (NameEn, NameAr)
- UAE-focused (currency AED)
- Stripe subscriptions

### 6.2 Real Competitive Edge

- Route-based sales — Route staff, customer visits, route expenses
- 8-hour invoice edit window — Lock, version history with diff
- Damage categories on returns — AffectsStock, AffectsLedger, IsResaleable
- Held/draft invoices — POS hold and resume
- Tenant-scoped templates — Per-tenant branding (fixed)

### 6.3 Real Limitations

- No public API
- Credit: full recalc, not incremental
- Profit: cash-based only
- No automated backup email
- Console.WriteLine in production (debug output)

---

## 7. REFACTOR RECOMMENDATION

### 7.1 Immediate (Before Marketing)

1. **Replace Console.WriteLine** — Use ILogger in SaleService, ComprehensiveBackupService, ResetService, SuperAdmin*, SecurityConfiguration, etc.
2. **Run production migrations** — Sections 6b, 7, 8 of FIX_PRODUCTION_MIGRATIONS.sql if 42703
3. **Document NOT_BUILT** — Already in NOT_BUILT.md; keep updated

### 7.2 Medium Term

- Split **SaleService** — SaleCrudService, SalePdfService (SaleValidationService done)
- Split **ReportService** — Per-report-type services
- **BalanceEngine** — Incremental or event-sourced; or move recalc to background job only
- **AuditLogs retention** — Implement policy from AUDIT_RETENTION_POLICY.md

### 7.3 Long Term

- Report caching (Redis) for heavy reports
- Materialized views for daily/monthly aggregates
- Date-partitioning AuditLogs, InvoiceVersions
- Complete OwnerId → TenantId migration; remove OwnerId

---

## APPENDIX: Key Paths & Counts

| Area | Count |
|------|-------|
| Backend modules | 16 |
| Frontend pages | 44 |
| Database tables | 40 |
| Console.WriteLine remaining | 60+ |
| PRODUCTION_MASTER_TODO refs | 15+ |

**Key files:**
- SaleService.cs — ~2,900 lines
- ReportService.cs — ~2,600 lines
- ComprehensiveBackupService.cs — ~1,500 lines
- SuperAdminTenantService.cs — ~1,300 lines
- BalanceService.cs — ~356 lines (optimized)

---

**End of Analysis.** Facts from code only. Use for positioning, refactor planning, scaling strategy.
