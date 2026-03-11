# HexaBill – Local run & test checklist

Use this list to run the app locally, test each page, click main actions, and record results/errors.  
**Note:** I cannot take screenshots or use a browser myself; you (or QA) should run through this and save screenshots/results.

---

## How to run locally

| Step | Command | Expected |
|------|--------|----------|
| 1. Backend | `cd backend\HexaBill.Api` then `dotnet run` | Server listening on **http://localhost:5000**; Swagger at http://localhost:5000/swagger |
| 2. Frontend | `cd frontend\hexabill-ui` then `npm run dev` | Vite ready at **http://localhost:5173** |
| 3. Login | Open http://localhost:5173 → Login | Use **admin@hexabill.com** / **Admin123!** (if seed ran; see errors below) |

---

## Errors / conflicts / failures found when running locally

These were observed when starting the backend with the **SQLite** database (appsettings default). Fix or note them when testing.

### Database / migrations (SQLite)

| # | Error | Where | Impact |
|---|--------|--------|--------|
| 1 | Pending migrations (10) – auto-apply failed: `duplicate column name: LanguagePreference` | Program.cs / Migrations | Some migrations already partially applied; schema out of sync. |
| 2 | `no such table: DamageCategories` | Seed / startup | Damage categories seed skipped. |
| 3 | `no such column: e.TenantId` on ExpenseCategories | User/tenant seeding | **“CRITICAL: User seeding failed - admin login will not work!”** – tenant login may fail if DB was never fully migrated. |
| 4 | `no such column: s.IsZeroInvoice` on Sales | AlertService / diagnostics | Overdue-invoice alert check fails; other Sales queries may fail. |
| 5 | `no such table: main.CustomerVisits` | AddPerformanceIndexes.sql | Index creation skipped. |
| 6 | Many `ALTER TABLE ... ADD COLUMN` failed (columns already exist) | Column fixer / migrations | Expected when schema was manually or partially updated; column fixer reports “0 added, 60 already existed”. |

### Recommendations

- **FIXED:** DatabaseFixer now adds missing columns (ExpenseCategories.TenantId, Sales.IsZeroInvoice/VatScenario, VAT/expense columns). Expense category seeding is non-fatal. Stop any running API before `dotnet build`; restart API once if login fails so fixer runs first.
- If login fails: confirm tenant/user seed ran (check logs for “Admin user verified” or “admin@hexabill.com”). If “User seeding failed” appeared, fix ExpenseCategories schema (add TenantId if required by model) and re-run or re-seed.

### Production (Render / PostgreSQL)

- On Render, run **Scripts/RUN_ON_RENDER_PSQL.sql** once (Connect → PSQL). It now includes a **Sales** data fix: `UPDATE Sales SET Subtotal = COALESCE(Subtotal, 0), VatTotal = COALESCE(VatTotal, 0)` and adds **IsZeroInvoice** / **VatScenario** if missing, so VAT return and iteration over Sales don’t throw in production.

### Build / tests (current state)

- **Backend build:** Succeeds (0 errors; nullable warnings only).
- **Backend unit tests:** 15 passed (VatCalculatorTests, StorageKeyTests, etc.).
- **Frontend build:** Succeeds (`npm run build`).
- **Frontend lint:** Fails (no ESLint config in repo).

---

## Page-by-page test checklist

For each page: open the URL, do the actions, then note **Pass / Fail** and any error message. Save a screenshot per page (or per section) and name it e.g. `01-login.png`, `02-dashboard.png`.

---

### Auth & onboarding

| # | Page | URL | Actions | What to save/check | Screenshot |
|---|------|-----|--------|--------------------|------------|
| 1 | Login | `/login` | Enter admin@hexabill.com, Admin123! → **Login** | Redirect to dashboard or error message | `01-login.png` |
| 2 | Signup | `/signup` | (Optional) Fill form → **Sign up** | Success or validation/error message | `02-signup.png` |
| 3 | Onboarding | `/onboarding` | Step through wizard; **Save** each step | All steps complete; no console errors | `03-onboarding.png` |

---

### Main app (after login)

| # | Page | URL | Actions | What to save/check | Screenshot |
|---|------|-----|--------|--------------------|------------|
| 4 | Dashboard | `/dashboard` | Load page; click any quick action or link | Tiles load; no 500/403 | `04-dashboard.png` |
| 5 | Products | `/products` | Open list; **Add product** → fill → **Save** | List loads; new product appears | `05-products.png` |
| 6 | Price list | `/pricelist` | Open; change price if any → **Save** | Data loads; save success | `06-pricelist.png` |
| 7 | Purchases | `/purchases` | Open list; **Add purchase** (if available) → **Save** | List and totals (e.g. Total VAT) load | `07-purchases.png` |
| 8 | Suppliers | `/suppliers` | Open list; open one supplier (if any) | List and detail load | `08-suppliers.png` |
| 9 | POS | `/pos` | Add item to cart; **Complete sale** (or cancel) | Sale completes or clear error | `09-pos.png` |
| 10 | Customer ledger | `/ledger` | Open; pick customer; view transactions | Ledger and balance load | `10-ledger.png` |
| 11 | **Expenses** | `/expenses` | Open; **Add expense** → fill (VAT, amount) → **Save**; tick rows → **Bulk action** (e.g. Mark as VAT claimable); switch to **Aggregated** view | Table shows Claimable VAT column; summary cards (Total VAT, Claimable VAT Box 9b); bulk bar when items selected; aggregated view clears selection | `11-expenses.png` |
| 12 | Sales ledger | `/sales-ledger` | Open; set date range → **Apply**; check VAT column and Total VAT | Report and VAT column load | `12-sales-ledger.png` |
| 13 | Billing history | `/billing-history` | Open list; open one sale (if any) | List and detail load | `13-billing-history.png` |
| 14 | **VAT return** | `/vat-return` | Set period (e.g. Q1 + year) → **Apply**; open **Summary**, **Sales**, **Purchases**, **Expenses**, **Credit Notes**, **Validation**, **History** tabs | No 500; KPIs and FTA 201 summary; tables show Customer/Supplier/Category; validation issues if any; SYS001 banner only if backend returned partial/error | `14-vat-return.png` |
| 15 | Reports | `/reports` | Open; switch tabs (Dashboard, Product sales, etc.); run one report | Reports load; no 500 | `15-reports.png` |
| 16 | Worksheet | `/worksheet` | Open; set filters → load | Data or empty state | `16-worksheet.png` |
| 17 | Returns | `/returns/create` | (Optional) Create return → **Save** | Success or error | `17-returns.png` |
| 18 | Branches | `/branches` | Open list; open one branch (if any) | List/detail (non-Staff) | `18-branches.png` |
| 19 | Routes | `/routes` | Open list; open one route (if any) | List/detail (non-Staff) | `19-routes.png` |
| 20 | Customers | `/customers` | Open list; **Add customer** → **Save**; open one | List and detail load | `20-customers.png` |
| 21 | Users | `/users` | Open list; (Admin) add/edit user if allowed | List loads; role visible | `21-users.png` |
| 22 | **Settings** | `/settings` | Open; update company name or VAT % → **Save**; open **Logo** → Upload/Change logo | Save success; logo preview (or blob load) | `22-settings.png` |
| 23 | Audit log | `/audit` | Open; set filters → **Search** | Log entries or empty | `23-audit.png` |
| 24 | Backup | `/backup` | Open; (optional) **Backup now** or download | Page loads; no crash | `24-backup.png` |
| 25 | Profile | `/profile` | Open; (optional) change name/photo → **Save** | Save success | `25-profile.png` |
| 26 | Help | `/help` | Open and scroll | Content visible | `26-help.png` |
| 27 | Feedback | `/feedback` | Open form | Form loads | `27-feedback.png` |

---

### Super Admin (if you have super-admin login)

| # | Page | URL | Actions | What to save/check | Screenshot |
|---|------|-----|--------|--------------------|------------|
| 28 | Super Admin dashboard | `/superadmin/dashboard` | Open | Tiles/links load | `28-sa-dashboard.png` |
| 29 | Tenants | `/superadmin/tenants` | Open list; open one tenant | List and detail load | `29-sa-tenants.png` |
| 30 | Health | `/superadmin/health` | Open | Status / checks | `30-sa-health.png` |
| 31 | Error logs | `/superadmin/error-logs` | Open | Log list or empty | `31-sa-errors.png` |
| 32 | Settings | `/superadmin/settings` | Open | Page loads | `32-sa-settings.png` |

---

## Buttons & save points to hit (summary)

- **Login:** Login
- **Products:** Add product, Save
- **Expenses:** Add expense, Save; select rows → bulk “Mark as VAT claimable”; switch to Aggregated view
- **VAT return:** Apply period; open every tab (Summary, Sales, Purchases, Expenses, Credit Notes, Validation, History)
- **Settings:** Save company settings; Upload/Change logo
- **Reports:** Run at least one report per tab
- **POS:** Complete one sale
- **Customers:** Add customer, Save
- **Purchases:** Add purchase (if available), Save

---

## Result template (copy and fill)

```
Date: ___________
Tester: ___________
Browser: ___________

Backend: http://localhost:5000  [ ] Up  [ ] Down
Frontend: http://localhost:5173 [ ] Up  [ ] Down

Login: [ ] Pass  [ ] Fail — Notes: _________________
Dashboard: [ ] Pass  [ ] Fail — Notes: _________________
...
Expenses (bulk + Claimable VAT): [ ] Pass  [ ] Fail — Notes: _________________
VAT return (all tabs): [ ] Pass  [ ] Fail — Notes: _________________
...

Errors seen (paste or list):
-
-
```

---

## Quick command reference

```bash
# Terminal 1 – API
cd backend\HexaBill.Api
dotnet run

# Terminal 2 – UI
cd frontend\hexabill-ui
npm run dev

# Backend tests
cd backend
dotnet test HexaBill.Tests\HexaBill.Tests.csproj
```

Screenshots: save in a folder e.g. `HexaBilngApp/screenshots/` with names like `01-login.png`, `11-expenses.png`, `14-vat-return.png`.
