# ZAYOGA – Final Verified Totals

**Company:** ZAYOGA GENERAL TRADING-SOLE PROPRIETORSHIP LLC  
**TenantId:** 6 (resolve via `SELECT "Id" FROM "Tenants" WHERE "Email" = 'info@zayoga.ae'`)

---

## Expected financial totals (source: CSV migration)

| Metric | Value |
|--------|--------|
| **Total Invoices** | 241 |
| **Total Sales** | 56,513.16 AED |
| **Total Received** | 45,648.75 AED |
| **Total Outstanding (Pending Bills)** | 10,864.41 AED |
| **Paid Invoices** | 178 |
| **Unpaid Invoices** | 63 |

---

## Where the UI should show these

- **Reports → Outstanding tab:** 10,864.41 AED total, 63 unpaid invoices (no date filter – shows all pending).
- **Reports → Sales / Summary:** Total sales 56,513.16 AED when date range includes 2025 (e.g. 01-01-2025 to 31-12-2026).
- **Customer Ledger:** For any customer with invoices, Ledger / Invoices / Payments tabs show data when date range includes 2025 (default is now 2 years).
- **Dashboard “This Month”:** Can be 0 if there are no sales in the current month (migrated data is mostly 2025).

---

## Verification commands

```bash
cd backend/scripts
node verify-zayoga.js    # Compare DB to expected totals
node audit-zayoga.js     # Full audit + balance repair + JSON outputs
```

---

## If UI showed Pending = 0 or Ledger empty

1. **Outstanding tab:** Now requests all pending bills with no date filter → should show 10,864.41 AED and 63 bills.
2. **Date filter:** Customer Ledger and Reports default to 2 years so 2025 data is included.
3. **Ledger:** There is no `ledger_entries` table; ledger is built from Sales + Payments. If a customer shows empty, ensure the customer has sales (e.g. “AL ANSARI” in CSV; “AL ANSARI EXCHANGE” may be a different customer with 0 sales).

---

*Generated as part of ZAYOGA migration reconciliation.*
