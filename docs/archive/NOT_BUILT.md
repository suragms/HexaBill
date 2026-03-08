# HexaBill — What Is NOT Built

**Purpose:** Avoid marketing over-promise. This document lists features that are *not* implemented, despite plans or comments.

---

## Not Implemented

| Item | Status | Notes |
|------|--------|-------|
| **Public API / webhooks** | Not built | `SubscriptionPlan.HasApiAccess` exists; no API key, webhook, or public REST API routes |
| **Offboarding export** | Not built | Tenant export ZIP (PRODUCTION_MASTER_TODO #52) |
| **Bulk tenant actions** | Not built | PRODUCTION_MASTER_TODO #48 |
| **Email backup delivery** | Not built | SuperAdminController: "Implement email service to send backup file" |
| **Onboarding tracker** | Not built | PRODUCTION_MASTER_TODO #46 |
| **SQL console (SuperAdmin)** | Partial | Exists but raw SQL execution; use with caution |
| **Automated backup email** | Not built | Backup completes; email send not implemented |
| **Subscription history (per-tenant)** | Not built | PRODUCTION_MASTER_TODO #51 |
| **Tenant invoice list (SuperAdmin)** | Not built | PRODUCTION_MASTER_TODO #50 |
| **Diagnostics/tenant export (SuperAdmin)** | Partial | Some diagnostics; full export flow incomplete |
| **Accrual-based profit** | Not built | Profit is cash-based only (Sales - Purchases - Expenses) |
| **Supplier master (FK)** | Partial | `SupplierService` exists; `Purchase` uses `SupplierName` string, not FK |
| **Full VAT on purchases** | Partial | Sales VAT complete; purchase VAT backfill script exists for legacy |
| **Incremental balance engine** | Not built | Balance recalculated fully per event; no event-sourced ledger |
| **Report caching** | Not built | All reports query live data; no materialized views or Redis |
| **AuditLogs retention/archive** | Not built | No retention policy or date-partitioning |

---

## Do Not Market As

- "Public API available"
- "Webhook integrations"
- "Accrual accounting / full P&L"
- "Real-time incremental balance"
- "Automated backup delivery via email"
- "Bulk tenant management"

---

**Last updated:** 2026-02-25
