# ZAYOGA Rebuild Data

- **zayoga-241-master.json** – Optional. If present, `rebuild-zayoga-invoices.js` uses this first. Format: `{ "company": "...", "invoice_count": 241, "invoices": [ { "invoice_number", "invoice_date", "customer_name", "type", "amount", "received_amount", "balance_amount", "status", "payment_status" }, ... ], "totals": { "total_sales", "total_received", "total_balance" } }`. Dates as `DD-MM-YYYY` or `YYYY-MM-DD`.
- **zayoga-master.json** – Fallback. Same script uses this if `zayoga-241-master.json` is missing. Supports `customer: { name }` and `invoice_date` in either format.

Run rebuild (after placing one of the JSON files here):
```bash
cd backend/Scripts
node rebuild-zayoga-invoices.js          # dry run
node rebuild-zayoga-invoices.js --execute # apply (ZAYOGA-only)
```

Ledger and Invoice tabs in the UI show data from Sales + Payments; no separate ledger table. Filters: company (tenant), date range, branch/route; the script does not change schema.

---

## Next invoice number (e.g. 242 for ZAYOGA)

The backend generates the next invoice number per tenant from the **maximum numeric part** of `InvoiceNo` in the `Sales` table (finalized, non-deleted). So if the DB has invoices 0001…0241, the next will be **0242**.

- **If the UI shows “241 invoices” but the next number is not 242:** Ensure all 241 sales exist in the DB with the correct `InvoiceNo` (e.g. 0238, 0239, 0240, 0241). Run the rebuild script with `zayoga-241-master.json` (or equivalent) and `--execute` so the DB has all 241 rows; then the next created invoice will be 242.
- **If CSV/JSON have 241 and the DB has fewer:** Run `node rebuild-zayoga-invoices.js --execute` from `backend/Scripts` after placing the master JSON in `backend/data/`. The script syncs/creates sales for the ZAYOGA tenant; after that, the next invoice number will be 242 (or max+1).
- **ZAYOGA tenant ID:** The script and API use the tenant id for the ZAYOGA company (from your DB). Ensure you are logged in as that company when creating the next invoice so the sequence is correct.

**Current data:** `zayoga-master.json` in this folder contains 241 invoices (numeric 1–241). After running the rebuild with this file (or with `zayoga-241-master.json` with 241 entries), the next generated invoice number will be **242**.
