# HexaBill Architecture Overview

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | ASP.NET Core 9, Entity Framework Core 9 |
| Database | PostgreSQL (multi-tenant, shared schema) |
| Frontend | React 18, Vite |
| Hosting | Render (backend), Vercel (frontend) |
| Domain | Backend (Render), Frontend (Vercel), DB (Render Singapore) |

---

## High-Level Architecture

```
[Browser]
    |
    v
[Vercel CDN] --> frontend/hexabill-ui (React SPA)
    |
    v
[Render API] --> backend/HexaBill.Api
    |
    v
[PostgreSQL] (multi-tenant, shared schema)
```

---

## Data Flow

- **Auth:** JWT-based; `X-Tenant-Id` header for tenant scoping
- **API:** REST; ~210 endpoints across modules (Billing, Reports, Branches, etc.)
- **Multi-tenant:** Tenant-scoped queries via `TenantId`; Super Admin can impersonate tenants

---

## Project Structure

- **backend/HexaBill.Api/** – ASP.NET Core API, Modules/* for feature areas
- **frontend/hexabill-ui/** – React SPA, pages/, components/, services/
- **docs/** – Analysis, deployment, migrations

---

## References

- [HEXABILL_ULTIMATE_DEEP_ANALYSIS.md](HEXABILL_ULTIMATE_DEEP_ANALYSIS.md) – Full system analysis
- [DATABASE_SCHEMA.md](../DATABASE_SCHEMA.md) – Database schema
- [deployment.md](deployment.md) – Render + Vercel deployment
