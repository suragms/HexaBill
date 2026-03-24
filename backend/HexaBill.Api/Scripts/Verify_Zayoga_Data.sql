-- ZAYOGA TenantId=6 Verification
-- Run: dotnet run --project backend\HexaBill.Api\Scripts\RunSql -- Verify_Zayoga_Data.sql

SELECT 'Sales count: ' || COUNT(*)::text FROM "Sales" WHERE "TenantId"=6;
SELECT 'Duplicate InvoiceNo: ' || COALESCE(SUM(cnt)::text, '0') FROM (SELECT COUNT(*) AS cnt FROM "Sales" WHERE "TenantId"=6 GROUP BY "OwnerId", "InvoiceNo" HAVING COUNT(*)>1) t;
SELECT 'Total Sales AED: ' || ROUND(SUM("GrandTotal")::numeric,2)::text FROM "Sales" WHERE "TenantId"=6;
SELECT 'Total Paid AED: ' || ROUND(SUM("PaidAmount")::numeric,2)::text FROM "Sales" WHERE "TenantId"=6;
SELECT 'Outstanding AED: ' || ROUND(SUM("GrandTotal"-"PaidAmount")::numeric,2)::text FROM "Sales" WHERE "TenantId"=6;
SELECT 'Total output VAT (Sales.VatTotal): ' || COALESCE(ROUND(SUM("VatTotal")::numeric,2)::text, '0') FROM "Sales" WHERE "TenantId"=6 AND NOT "IsDeleted";
SELECT 'Payment modes: ' || string_agg("Mode" || '=' || cnt::text, ', ') FROM (SELECT "Mode", COUNT(*) AS cnt FROM "Payments" WHERE "TenantId"=6 GROUP BY "Mode") m;
