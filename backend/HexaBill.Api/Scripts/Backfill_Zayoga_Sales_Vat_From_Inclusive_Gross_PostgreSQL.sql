-- =============================================================================
-- ZAYOGA (TenantId=6): Backfill Subtotal/VatTotal from VAT-inclusive GrandTotal
-- =============================================================================
-- Problem: ZayogaMigration inserted Subtotal = GrandTotal and VatTotal = 0 for
-- standard-rated sales, so VAT Return and ledgers showed zero output VAT.
-- This script splits each qualifying row as UAE 5% VAT-inclusive:
--   net  = ROUND(GrandTotal / 1.05, 2)  (away from zero, matches app rounding)
--   vat  = ROUND(GrandTotal - net, 2)
-- GrandTotal is NOT changed (totals vs CSV reconciliation stay the same).
--
-- Run once on Render Postgres (or local), e.g.:
--   dotnet run --project backend/HexaBill.Api/Scripts/RunSql -- Backfill_Zayoga_Sales_Vat_From_Inclusive_Gross_PostgreSQL.sql
--
-- Before run: if DATABASE_URL or .env was ever shared publicly, rotate DB password
-- and other secrets (RENDER_API_KEY, VERCEL_TOKEN, JWT secret) in the dashboard.
-- =============================================================================

BEGIN;

-- Preview (optional): uncomment to see how many rows match
-- SELECT COUNT(*) AS rows_to_fix
-- FROM "Sales"
-- WHERE "TenantId" = 6
--   AND NOT "IsDeleted"
--   AND NOT "IsZeroInvoice"
--   AND COALESCE(TRIM("VatScenario"), '') = 'Standard'
--   AND "VatTotal" = 0
--   AND "GrandTotal" > 0
--   AND ABS("Subtotal" - "GrandTotal") < 0.0001;

UPDATE "Sales" s
SET
  "Subtotal" = ROUND(s."GrandTotal" / 1.05, 2),
  "VatTotal" = ROUND(s."GrandTotal" - ROUND(s."GrandTotal" / 1.05, 2), 2)
WHERE s."TenantId" = 6
  AND NOT s."IsDeleted"
  AND NOT s."IsZeroInvoice"
  AND COALESCE(TRIM(s."VatScenario"), '') = 'Standard'
  AND s."VatTotal" = 0
  AND s."GrandTotal" > 0
  AND ABS(s."Subtotal" - s."GrandTotal") < 0.0001;

-- Single-line migrated items: UnitPrice and LineTotal were both set to gross; VatAmount/VatRate were 0.
UPDATE "SaleItems" si
SET
  "UnitPrice" = ROUND(si."LineTotal" / 1.05, 2),
  "VatAmount" = ROUND(si."LineTotal" - ROUND(si."LineTotal" / 1.05, 2), 2),
  "VatRate" = 0.05,
  "VatScenario" = 'Standard'
FROM "Sales" s
WHERE si."SaleId" = s."Id"
  AND s."TenantId" = 6
  AND NOT s."IsDeleted"
  AND NOT s."IsZeroInvoice"
  AND si."VatRate" = 0
  AND si."VatAmount" = 0
  AND si."LineTotal" > 0
  AND ABS(si."UnitPrice" - si."LineTotal") < 0.0001;

COMMIT;

-- Post-checks (expected: Total Sales AED unchanged; VAT sum > 0)
SELECT 'Sales count' AS metric, COUNT(*)::text AS value FROM "Sales" WHERE "TenantId" = 6 AND NOT "IsDeleted";
SELECT 'Total GrandTotal AED (unchanged vs migration)' AS metric, ROUND(SUM("GrandTotal")::numeric, 2)::text AS value FROM "Sales" WHERE "TenantId" = 6 AND NOT "IsDeleted";
SELECT 'Total VatTotal AED (after backfill)' AS metric, ROUND(SUM("VatTotal")::numeric, 2)::text AS value FROM "Sales" WHERE "TenantId" = 6 AND NOT "IsDeleted";
