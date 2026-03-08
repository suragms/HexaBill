# Production Verification Checklist

Use this checklist when deploying or troubleshooting Ledger, Reports, and Dashboard in production (Render + Vercel).

**Full step-by-step:** See [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).

## Environment Variables

| Item | Location | Action |
|------|----------|--------|
| `VITE_API_BASE_URL` | Vercel env | Set to `https://hexabill.onrender.com` (no trailing slash). apiConfig adds `/api` automatically. |
| `DATABASE_URL` | Render env | Must point to production PostgreSQL. Use internal URL when backend runs on Render. |
| `ALLOWED_ORIGINS` | Render env | Must include your Vercel frontend URL (e.g. `https://hexabill.vercel.app`). CORS fallback allows `*.vercel.app` and `hexabill.company`. |
| `JwtSettings__SecretKey` or `JWT_SECRET_KEY` | Render env | Required. Generate: `openssl rand -base64 48`. render.yaml may auto-generate via `generateValue: true`. |

## Backend (Render)

- **Migrations**: Run `dotnet ef database update` or your migration command in Render Shell after deploy.
- **Logs**: Check Render Logs for `[GetCustomerLedger]` when opening Customer Ledger page. Shows `customerId`, `tenantId`, `from`, `toEnd`, `salesCount`.

## Frontend (Vercel)

- **Root Directory**: Must be **empty** (repo root). vercel.json uses `cd frontend/hexabill-ui` — this fails if Root Directory is `frontend/hexabill-ui`.
- **API base**: [apiConfig.js](frontend/hexabill-ui/src/services/apiConfig.js) uses `PRODUCTION_API` when hostname is not localhost. If `VITE_API_BASE_URL` is set, it overrides.
- **Date format**: Dates are sent as `YYYY-MM-DD` via `toYYYYMMDD()` in services. No changes needed.

## Backend (Render) – Docker

- **Root Directory**: Must be **empty** (repo root). If set to `backend/HexaBill.Api`, deploy fails with "HexaBill.Api.csproj not found" because the Dockerfile uses `COPY backend/HexaBill.Api/...` (repo-root context).
- **Dockerfile**: `backend/HexaBill.Api/Dockerfile`; context = repo root.
- **Health check**: `/health` — verify `GET https://hexabill.onrender.com/health` returns 200.

## Production DB Fix (42703 TenantId errors)

If you see `column e.TenantId does not exist`, `column e0.TenantId does not exist`, or **expenses / CSV export failing**:
1. Render Dashboard → PostgreSQL → Connect → PSQL.
2. Run sections **6b, 7, 8** of `backend/HexaBill.Api/Scripts/FIX_PRODUCTION_MIGRATIONS.sql` (or the full file).
3. Restart the API. See [MIGRATION_INSTRUCTIONS.md](MIGRATION_INSTRUCTIONS.md).

**Backup:** On Render, backup uses `DATABASE_URL` when `ConnectionStrings__DefaultConnection` is not set; no extra env var needed.

## Live Verification

- **Backend health**: `GET https://hexabill.onrender.com/health` → `{"status":"ok","timestamp":"..."}`
- **API base**: Frontend must call `https://hexabill.onrender.com/api` (set `VITE_API_BASE_URL=https://hexabill.onrender.com` on Vercel).

## API Quick Test

- Ledger: `GET https://hexabill.onrender.com/api/customers/{customerId}/ledger?fromDate=2024-01-01&toDate=2026-12-31` (with auth)
- Reports: `GET https://hexabill.onrender.com/api/reports/sales?fromDate=2024-01-01&toDate=2026-12-31` (with auth)

## Troubleshooting

### manifest.webmanifest 401

If `manifest.webmanifest` returns 401 on preview URLs (e.g. `billing-app-suragsunils-projects.vercel.app`):

- **Cause**: Vercel [Deployment Protection](https://vercel.com/docs/security/deployment-protection) requires auth for preview deployments.
- **Fix**: Vercel Dashboard → Project → Settings → Deployment Protection → set to **"Only Production Deployments"** so previews are public, or use the production URL (e.g. `billing-app-nine-sage.vercel.app`).

### Ledger 500 (hexabill-api.onrender.com)

- **Check Render Logs**: Look for `[GetCustomerLedger] Error` and `GetCustomerLedgerAsync` stack traces.
- **Schema mismatch**: If PostgreSQL is missing columns in SaleReturns (e.g. migrations not applied), the backend now falls back to a safe projection. Ensure migrations are run: `dotnet ef database update` in Render Shell.
- **Date range**: Verify `fromDate`/`toDate` are valid (YYYY-MM-DD). Very large ranges can cause timeouts.

## Recent Fixes (Ledger & Reports)

1. **Ledger date normalization**: Dates now use `ToUtcKind()` and inclusive end date (AddDays(1)) to match Sales Report.
2. **Branch report "Unassigned"**: Sales with `BranchId==null` and `RouteId==null` now appear in Branch comparison as "Unassigned".
3. **Ledger 500 schema fallback**: SaleReturns query now catches PostgreSQL `undefined_column` and falls back to a projection that excludes optional columns (BranchId, RouteId, ReturnType) when missing.
