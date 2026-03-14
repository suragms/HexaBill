# Run HexaBill Locally

## Prerequisites

- Node.js (for frontend)
- .NET 9 SDK (for backend)
- SQLite (backend uses `hexabill.db` by default from appsettings.json)

## 1. Stop any running instances

If you get **"file is locked by HexaBill.Api"** when building:

- Close the terminal where the API is running, or
- Press `Ctrl+C` in that terminal, or
- On Windows: Task Manager → End task "HexaBill.Api" / dotnet

## 2. Start backend

```powershell
cd backend\HexaBill.Api
dotnet run
```

Wait until you see: **Now listening on: http://localhost:5000**

- API: http://localhost:5000  
- Swagger: http://localhost:5000/swagger  
- Database: SQLite file `hexabill.db` in the same folder (created on first run)

## 3. Start frontend (new terminal)

```powershell
cd frontend\hexabill-ui
npm install
npm run dev
```

Wait until you see: **Local: http://localhost:5173/**

- App: http://localhost:5173  
- Frontend uses API at http://localhost:5000 when opened from localhost

## 4. Use the app

1. Open http://localhost:5173 in the browser.
2. Log in (create a user via seed or signup if needed).
3. **POS** → Create a sale → **Save** → **Print** → choose format (A4, A5, 80mm, 58mm).

## Fixes applied (so it runs)

- **SQLite "no such column: s.RoundOff"**: `Sales.RoundOff` and `HeldInvoices.RoundOff` are added at startup and in DatabaseFixer. Restart the API once so the ALTER TABLE runs.
- **Invoice print formats**: A4, A5, 80mm, 58mm are implemented. After save, click Print → select format → PDF opens.
- **Impersonation banner**: Shown only to System Admin when impersonating; normal tenant users no longer see it.

## If you see another "no such column" error

See [docs/SQLITE_MISSING_COLUMNS_FIX.md](SQLITE_MISSING_COLUMNS_FIX.md) for how to add the missing column to Program.cs and DatabaseFixer.cs, then restart the API.
