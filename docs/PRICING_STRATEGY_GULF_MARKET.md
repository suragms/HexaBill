# HexaBill — SaaS Pricing Strategy & Gulf Market Analysis

**Product:** HexaBill — Multi-tenant billing/inventory SaaS  
**Target market:** UAE/GCC trading companies (wholesale/retail distributors)  
**Tech stack:** ASP.NET Core 9 + PostgreSQL + React  
**Date:** March 2026

---

## SECTION 1: PRICING TABLE

| Tier | Monthly (AED) | Yearly (AED) | Branches | Routes | Staff | Sales/mo | Products | Customers |
|------|---------------|--------------|----------|--------|-------|----------|----------|------------|
| **Starter** | 149 | 1,490 | 1 | 2 | 2 | 300 | 100 | 100 |
| **Professional** | 349 | 3,490 | 3 | 9 (3/branch) | 5 | 1,000 | 500 | 500 |
| **Enterprise** | 799 | 7,990 | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited |

**One-time setup fees (optional):**
- **Standard (14 days):** AED 2,000 — Account setup, 1hr training, basic template
- **Fast (7 days):** AED 3,500 — + 2hr training, data import (products/customers Excel), custom invoice template
- **Premium (3 days):** AED 8,000 — + on-site training, data migration from old system, custom reports

**Recommendation:** Charge setup to all new clients; waive 50% if they pay annually. Do not make setup recurring.

---

## PART 1: COMPLETE FEATURE INVENTORY

### CORE BILLING FEATURES

| Feature | Status | Classification |
|---------|--------|----------------|
| Sales/Invoice creation (POS) | ✅ | ESSENTIAL |
| Purchase management | ✅ | ESSENTIAL |
| Customer ledger (balance tracking) | ✅ | ESSENTIAL |
| Supplier ledger (AP) | ✅ | ESSENTIAL |
| Payment recording (cash/bank/cheque/credit) | ✅ | ESSENTIAL |
| Sale returns | ✅ | ESSENTIAL |
| Purchase returns | ✅ | STANDARD |
| Multi-currency | ❌ | — |
| Recurring invoices | ❌ | STANDARD (missing) |
| Quotations/Estimates | ❌ | STANDARD (missing) |
| Credit notes | ✅ (model exists) | STANDARD |
| Debit notes | ❌ | ADVANCED (missing) |

### INVENTORY FEATURES

| Feature | Status | Classification |
|---------|--------|----------------|
| Product management (create/edit/import) | ✅ | ESSENTIAL |
| Stock tracking (real-time) | ✅ | ESSENTIAL |
| Low stock alerts | ✅ | ESSENTIAL |
| Expiry date tracking | ❌ | STANDARD (missing) |
| Barcode support | ✅ (field + POS) | STANDARD |
| Stock adjustments | ✅ | ESSENTIAL |
| Inventory movements log | ✅ | STANDARD |
| Multi-unit (pieces, cartons, boxes) | ✅ (ConversionToBase) | ESSENTIAL |
| Cost tracking | ✅ (FIFO-style via purchase cost) | ESSENTIAL |
| Stock valuation reports | ✅ (reports) | STANDARD |

### BRANCH & ROUTE MANAGEMENT

| Feature | Status | Classification |
|---------|--------|----------------|
| Branch creation | ✅ | STANDARD |
| Route creation under branches | ✅ | STANDARD |
| Staff assignment to routes | ✅ | STANDARD |
| Route-wise sales tracking | ✅ | STANDARD |
| Route-wise expense tracking | ✅ | STANDARD |
| Branch-wise P&L | ✅ | STANDARD |
| Route performance analytics | ✅ | STANDARD |

### FINANCIAL REPORTS

| Feature | Status | Classification |
|---------|--------|----------------|
| Profit & Loss (P&L) | ✅ | ESSENTIAL |
| Sales reports | ✅ | ESSENTIAL |
| Purchase reports | ✅ | ESSENTIAL |
| Expense reports | ✅ | ESSENTIAL |
| Outstanding receivables | ✅ | ESSENTIAL |
| Outstanding payables (AP aging) | ✅ | ESSENTIAL |
| Customer-wise profitability | ✅ | STANDARD |
| Product-wise profitability | ✅ | STANDARD |
| VAT reports (UAE FTA format) | ⚠️ Partial (VAT on invoice; no FTA return) | ESSENTIAL (gap) |
| Trial balance | ❌ | ADVANCED |
| Balance sheet | ❌ | ADVANCED |

### UAE/GULF SPECIFIC

| Feature | Status | Classification |
|---------|--------|----------------|
| VAT 5% calculation | ✅ | ESSENTIAL |
| TRN fields | ✅ (Customer, company) | ESSENTIAL |
| Arabic / RTL | ❌ | STANDARD (missing) |
| Bilingual invoices | ⚠️ Template-based | STANDARD |
| AED default | ✅ | ESSENTIAL |
| UAE timezone | ✅ | ESSENTIAL |
| Custom invoice templates | ✅ | STANDARD |
| WhatsApp invoice sharing | ✅ (download + share) | STANDARD |

### MULTI-TENANT & USERS

| Feature | Status | Classification |
|---------|--------|----------------|
| Owner role | ✅ | ESSENTIAL |
| Admin role | ✅ | ESSENTIAL |
| Staff role (limited) | ✅ | ESSENTIAL |
| User management | ✅ | ESSENTIAL |
| Role-based permissions | ✅ | ESSENTIAL |
| Audit logs | ✅ | STANDARD |
| Activity tracking | ✅ | STANDARD |

### INTEGRATIONS & IMPORTS

| Feature | Status | Classification |
|---------|--------|----------------|
| Excel/CSV product import | ✅ | STANDARD |
| Excel/CSV customer import | ✅ | STANDARD |
| Backup & restore | ✅ | STANDARD |
| Data export (Excel/PDF) | ✅ (reports, purchases, expenses) | STANDARD |
| Email invoice sending | ⚠️ (API exists; SMTP config) | ESSENTIAL |
| Google Sheets / accounting export | ❌ | ADVANCED |

### ADVANCED FEATURES

| Feature | Status | Classification |
|---------|--------|----------------|
| Custom invoice templates (HTML) | ✅ | STANDARD |
| Invoice version history | ✅ | STANDARD |
| Held invoices (draft) | ✅ | STANDARD |
| Credit limit enforcement | ✅ | ESSENTIAL |
| Payment terms | ✅ | ESSENTIAL |
| Partial payments tracking | ✅ | ESSENTIAL |
| Multi-branch stock transfer | ❌ | PREMIUM |
| Batch/Lot tracking | ❌ | PREMIUM |

---

## PART 2: COMPETITOR ANALYSIS

### Hydrobooks (UAE desktop)

- **Pricing:** One-time AED 500–1,500 (no monthly).
- **Strengths:** Offline, one-time cost, FTA-compliant VAT, bilingual.
- **Weaknesses:** No cloud, no mobile, no multi-user, manual backups, single machine.

**HexaBill vs Hydrobooks:**
- **Better:** Cloud, multi-user, branches/routes, mobile-friendly UI, auto backup, real-time sync.
- **Missing:** FTA VAT return report, offline mode.
- **Position:** Starter at AED 149/mo ≈ AED 1,788/year; vs AED 1,500 one-time. Sell on “always updated, no reinstall, multi-device, multi-staff.”

### Zoho Books (Cloud)

- **Pricing:** Free to AED 60–280/month (UAE).
- **Strengths:** Full accounting, integrations, brand.
- **Weaknesses:** Not Gulf-focused, complex, higher price for similar scope.

**HexaBill vs Zoho Books:**
- **Better:** Gulf-focused (AED, TRN, trading workflows), branches + routes, simpler UX, lower entry price.
- **Missing:** Double-entry, some integrations, brand trust.
- **Position:** Professional AED 349 vs Zoho Professional ~AED 90 (but Zoho Standard AED 60). Compete on “built for UAE distributors” and branch/route.

### Tally (Gulf / India)

- **Pricing:** AED 600–2,000/year (desktop).
- **Strengths:** Full ERP, powerful, familiar.
- **Weaknesses:** Desktop, complex, no cloud.

**HexaBill vs Tally:**
- **Better:** Cloud, SaaS, mobile access, lower TCO for small/medium.
- **Missing:** Full double-entry, depth of Tally.
- **Position:** Enterprise AED 799/mo for multi-location, cloud, and support without desktop lock-in.

---

## PART 3: USAGE LIMIT ANALYSIS

**Current infra (from codebase):**
- **SubscriptionPlan:** MaxUsers, MaxInvoicesPerMonth, MaxCustomers, MaxProducts, MaxStorageMB.
- **TenantLimitsDto:** MaxRequestsPerMinute (200), MaxConcurrentUsers (100), MaxStorageMb (1024), MaxInvoicesPerMonth (1000).
- **Branches/Routes:** No hard DB limit; enforced by plan in middleware or app logic (Enterprise plan can unlock).

**Rough capacity (1GB DB, Render $26):**
- Small: 10 products, 20 customers, 5 sales/day → ~5–10 MB/month.
- Medium: 100 products, 200 customers, 30 sales/day → ~50–80 MB/month.
- Large: 500 products, 1,000 customers, 100 sales/day → ~200–400 MB/month.

**Tier limits (recommended):**
- **Starter:** 1 branch, 2 routes, 2 users, 300 sales/month, 100 products, 100 customers.
- **Professional:** 3 branches, 9 routes, 5 users, 1,000 sales/month, 500 products, 500 customers.
- **Enterprise:** Unlimited (fair use; monitor DB and CPU).

---

## PART 4: FEATURE ALLOCATION PER TIER

### STARTER (AED 149/mo)
- All **ESSENTIAL** features: POS, purchases, customer/supplier ledgers, payments, returns, VAT 5%, TRN, credit limit, payment terms, partial payments, P&L, sales/purchase/expense/outstanding reports, stock, low stock, adjustments, multi-unit, product/customer management, roles (Owner/Admin/Staff), audit.
- **Exclude:** Branches/routes (single location), advanced reports, custom templates, API, priority support.
- **Limits:** 1 branch, 2 routes, 2 users, 300 invoices/month, 100 products, 100 customers.

### PROFESSIONAL (AED 349/mo)
- Everything in Starter.
- **Add:** Branches & routes (up to plan limits), route-wise sales/expenses, branch P&L, AP aging, custom invoice templates, Excel import/export, backup/restore, barcode, WhatsApp share, audit log, activity.
- **Limits:** 3 branches, 9 routes, 5 users, 1,000 invoices/month, 500 products, 500 customers.

### ENTERPRISE (AED 799/mo)
- Everything in Professional.
- **Add:** Unlimited branches/routes/users/invoices/products/customers, advanced reports, API access (when built), priority support, optional dedicated DB (+AED 200/mo).
- **Limits:** None (fair use).

---

## PART 5: VALUE PROPOSITION

### Why Starter (AED 149/mo) vs Hydrobooks (AED 500–1,500 one-time)
- Cloud: access from anywhere; no single-PC lock-in.
- Multi-user: owner + 1 staff; Hydrobooks is single-user.
- Updates and backups included; no reinstall or manual backup.
- **ROI:** “Hydrobooks AED 1,500 over 1 year = AED 125/mo. For AED 24/mo more you get cloud + 2 users + backups.”
- **Payback:** If 2 hours/month saved on manual work at AED 50/hr = AED 100; subscription pays for itself.

### Why Professional (AED 349/mo) vs Zoho Books
- Built for UAE distributors: branches, routes, staff per route, route-wise P&L.
- Simpler than Zoho for trading workflows (inventory + ledger + routes).
- **Cost:** Zoho Professional ~AED 90/mo but limited users/features; HexaBill Professional includes branches/routes and higher limits at AED 349.

### Why Enterprise (AED 799/mo) vs Tally
- Cloud + mobile: no desktop install, no VPN.
- Per-seat and multi-location without Tally-level complexity.
- Recurring cost vs large upfront + annual Tally fee.

---

## PART 6: REVENUE PROJECTIONS (1 YEAR, 100 CLIENTS)

**Assumed mix:** 60 Starter, 30 Professional, 10 Enterprise.

**MRR:**
- Starter: 60 × 149 = AED 8,940  
- Professional: 30 × 349 = AED 10,470  
- Enterprise: 10 × 799 = AED 7,990  
- **Total MRR = AED 27,400**

**ARR:** 27,400 × 12 = **AED 328,800**

**One-time setup (50% of clients, avg AED 2,500):** 50 × 2,500 = **AED 125,000**

**Year 1 total revenue:** 328,800 + 125,000 = **AED 453,800**

**Costs (current):**
- Render backend: $26 × 12 ≈ AED 1,146  
- PostgreSQL 1GB: $7 × 12 ≈ AED 308  
- Vercel: $0  
- **Infrastructure: AED 1,454/year**

**At 100 clients:** Assume infra scaling to ~AED 9,700/year (e.g. DB + Render upgrade) and 1 support person at AED 10,000/mo = AED 120,000/year.  
**Total costs:** ~AED 130,000/year.  
**Profit:** 453,800 − 130,000 = **AED 323,800**.  
**Margin:** ~71%.

**Break-even (recurring only):** 130,000 / (27,400 × 12) ≈ 0.4 → **Already above break-even with 100 clients.**  
**Break-even MRR:** ~AED 10,834 (e.g. ~73 Starter or mix). **Break-even clients:** ~25–30 (depending on mix).

---

## PART 7: INFRASTRUCTURE SCALING PLAN

- **&lt; 10 clients:** Keep current (Render $26, DB $7). Monitor.
- **10–50 clients:** Consider DB 2GB, Render upgrade if response time drops. Budget ~$100/mo.
- **50–100 clients:** DB 5GB, Render 4GB or split, optional Vercel Pro. Budget ~AED 800/mo (~$220).
- **100+ clients:** Reinvest 10% of MRR into infra; offer Enterprise dedicated DB at +AED 200/mo.

---

## PART 8: MISSING FEATURES THAT JUSTIFY HIGHER PRICE

**Critical (must build):**
- **FTA-compliant VAT return report** — UAE requirement; enables “FTA-ready” positioning. Est. 2–3 weeks. Impact: +AED 20–50/mo perceived value.
- **Email invoice sending** — Backend/SMTP wiring; frontend exists. Est. 1 week. Impact: expected by all tiers.
- **Recurring invoices** — Repeat orders. Est. 2–3 weeks. Impact: Professional/Enterprise +AED 30/mo value.

**High value (Professional+):**
- Mobile app (PWA or native): 8–12 weeks; +AED 50/mo positioning.
- Barcode scanning (mobile): 2 weeks; already have barcode field.
- Stock transfer between branches: 3–4 weeks; Enterprise differentiator.
- Customer portal (view/pay): 4–6 weeks; premium add-on.

**Enterprise:**
- API access: 4–6 weeks (NOT_BUILT); charge +AED 200/mo or include in Enterprise.
- Custom fields/workflows: 6+ weeks; premium.

**Phase 1 (pre-launch):** FTA VAT report, email invoice.  
**Phase 2 (3 months):** Recurring invoices, PWA/mobile improvements, barcode scan.  
**Phase 3 (6 months):** API, stock transfer, customer portal.

---

## SUMMARY: RECOMMENDED PRICING

| Tier | AED/month | AED/year | Target |
|------|-----------|----------|--------|
| **Starter** | 149 | 1,490 | Single-location shops, small retailers |
| **Professional** | 349 | 3,490 | Multi-location distributors, growing businesses |
| **Enterprise** | 799 | 7,990 | Chains, franchises, unlimited usage |

**Setup:** AED 2,000 (standard) / AED 3,500 (fast) / AED 8,000 (premium). Waive 50% on annual.  
**At 100 clients:** ~AED 328k ARR + ~AED 125k setup = **~AED 454k Year 1 revenue;** break-even at ~25–30 clients on recurring alone.
