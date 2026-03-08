# Run This Migration on Render (Fix Expenses 42703 + errorMissingColumn)

**If deploy failed with "HexaBill.Api.csproj not found":** In Render Dashboard → your Web Service → Settings → **Root Directory** must be **empty** (repo root). Then redeploy.

Your production DB is missing `TenantId` on **Expenses** and **ExpenseCategories**. Run the SQL below **once** in Render PSQL, then restart the API.

---

## Step 1: Open Render PSQL

1. Go to **https://dashboard.render.com**
2. Click your **PostgreSQL** service (e.g. `hexabill` or the one linked to your API)
3. In the left sidebar, click **Connect** (or **Shell**)
4. Choose **PSQL** (or **Connect** and copy the PSQL command if shown)
5. You get a terminal connected to your DB

---

## Step 2: Paste and run the SQL

1. Open this file in your repo:  
   **`backend/HexaBill.Api/Scripts/RUN_ON_RENDER_PSQL.sql`**
2. **Select all** (Ctrl+A) and **copy**
3. In the Render PSQL terminal, **paste** and press **Enter**
4. Wait until it finishes (you should see `CREATE INDEX`, `UPDATE`, etc. without errors)

---

## Step 3: Restart the API

1. In Render Dashboard, open your **Web Service** (HexaBill API)
2. **Manual Deploy** → **Clear build cache & deploy**  
   **or** just **Restart** the service

---

## Or run from your PC (MigrationFixer – no psql needed)

```powershell
cd backend/HexaBill.Api/MigrationFixer
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@HOST/DATABASE'   # use your Render external DB URL
dotnet run
```

Then restart the API on Render.

---

## If you have psql installed

```bash
# Install PostgreSQL client if needed (Windows: https://www.postgresql.org/download/windows/)
# Then run (use your external DB URL from Render):
set PGPASSWORD=YOUR_PASSWORD
psql -h dpg-d68jhpk9c44c73ft047g-a.singapore-postgres.render.com -U hexabill_user -d hexabill "sslmode=require" -f backend/HexaBill.Api/Scripts/RUN_ON_RENDER_PSQL.sql
```

---

After this, **expenses**, **expense categories**, and **backup CSV export** should work.  
If you still see errors, check Render **Logs** for your API and fix any remaining missing columns using the full **FIX_PRODUCTION_MIGRATIONS.sql** (sections 1–8).
